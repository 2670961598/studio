/**
 * harvest-recon —— IMPL-06-03「engine 拆分·收割域」V1+V3 契约（NEG-EVD-01；收割批次）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/plan/05 IMPL-06-03（领土 `apps/daemon/test/v2/harvest-recon.test.ts`；冻结验收
 *     「NEG-EVD-01（X2/X3/X4 分级）；DEC-OPEN-13 未裁只落结构位（收割者≠交付者声明）；
 *     `bun run test:v2 -- apps/daemon/test/v2` 绿」）；
 *   - docs/v2/17 §一 V1/V3（V1＝契约/对象不变量；V3＝fake 只替代外部端口：fake 平台/
 *     执行体，内部记录与状态机真跑）、NEG-EVD-01（自述与独立两分——对账差异非空即判负）、
 *     NEG-REC-05（X2 事件冒验收／X3 回执冒验收／X4 验收冒结清）；
 *   - docs/v2/08 §1.3（来源锚两级：自述不得单独支撑 EX-2+）、§1.4（收割批次是 EX-2+
 *     验收判断的强制输入；收割者≠交付者；最小主体形态=DEC-OPEN-13 未裁）、§1.5（五类
 *     判断不合并）、§2.2（独立角色供给表；单人/低层形态须明示标注，不得自称独立）；
 *   - docs/v2/11 §六 REC-EVD-01（区间幂等键去重/「无输出」与「没采集到」两件事/完整性
 *     存疑不得判接受）、REC-EVD-02（自述 vs 独立采集）、REC-WORK-12（结清核验者≠责任者）；
 *   - docs/v2/14 §1.6 PORT-EVD（harvest 幂等键＝出工段×采集区间；registerItem 收草案）；
 *   - docs/plan/03 §MIG-06 入口条件（DEC-OPEN-13 硬闸：未裁前只落结构位，不虚构独立
 *     收割通道）。
 *
 * 断言纪律：负例断言**拒绝面与结构位**（不得把未裁读成已独立、不得用事件/回执/验收
 * 互推）；内部判定/批次簿真跑、台账真 SQLite；fake 只替代平台与执行体（**不 mock LLM**）；
 * 不重试。集成腿用 records/fixtures 真栈夹具（导入不改）。
 */
import { afterAll, describe, expect, it } from 'vitest'
import {
  createHarvestBatchLedger,
  FRAMEWORK_HARVESTER,
  HARVEST_INDEPENDENCE_DECLARATION,
  harvestIntervalKey,
  harvestRequirementsOf,
  harvesterSlotOf,
  type HarvestBatchLedger,
  type HarvestRequirements,
  type HarvestSegment,
} from '../../src/engine/harvest/batch.ts'
import { acceptanceInputOf, gradeHarvestStages } from '../../src/engine/harvest/stages.ts'
import { createTicket, createWorkStack, disposeWorkStacks, eventsNamed, runTicks } from './records/fixtures/work-stack.ts'

afterAll(async () => {
  await disposeWorkStacks()
})

// ————————————————————————— 夹具（真件：批次簿内存投影；四要件输入） —————————————————————————

/** 四要件齐（EX-0/1 常态；`execution_terminal` 自报 completed——仅作观察） */
function completeRequirements(): HarvestRequirements {
  return harvestRequirementsOf({
    completed: true,
    nonEmptyOutput: true,
    reportExists: true,
    exit0: true,
    terminalObserved: true,
    terminalError: undefined,
  })
}

/** 四要件不齐（缺终态与非空输出；终态被观察≠完成——「无输出」与「没采集到」两件事） */
function incompleteRequirements(): HarvestRequirements {
  return harvestRequirementsOf({
    completed: false,
    nonEmptyOutput: false,
    reportExists: true,
    exit0: true,
    terminalObserved: true,
    terminalError: undefined,
  })
}

interface Seeded {
  readonly ledger: HarvestBatchLedger
  readonly segment: HarvestSegment
}

/** 建段并完成「begin→record→seal」全链（一用例一簿；时点手推不读墙钟） */
function seedSealed(deliverer = 'AGENT-1', requirements: HarvestRequirements = completeRequirements(), at = 1000): Seeded {
  const ledger = createHarvestBatchLedger()
  const segment: HarvestSegment = { ticket: 'T-1' as HarvestSegment['ticket'], attempt: 1 }
  ledger.begin({ ...segment, deliverer, at })
  ledger.record({ ...segment, deliverer }, requirements)
  ledger.seal(segment, requirements.fourOk ? 'completed' : 'failed', at + 500)
  return { ledger, segment }
}

// ————————————————————————— 一、NEG-EVD-01：X2/X3/X4 分级（三判不合并） —————————————————————————

describe('NEG-EVD-01 X2/X3/X4 分级：执行观察 ≠ 验收 ≠ 结清', () => {
  it('X2 事件冒验收：四要件齐＋execution_terminal=completed 只到「执行观察」，验收/结清恒 not_judged', () => {
    const { ledger, segment } = seedSealed()
    const batch = ledger.get(segment)
    expect(batch).toBeDefined()
    if (batch === undefined) return

    // ① 执行面：四要件齐＝complete，终态只作观察（不得压缩为布尔面）
    expect(batch.completeness).toBe('complete')
    expect(batch.executionTerminal).toBe('completed')
    expect(batch.gaps).toEqual([])

    // ② 三判分级：执行 observed；验收/结清 not_judged（本件无验收权——X2 结构性拒绝）
    const stages = gradeHarvestStages()
    const stageOf = (name: string) => stages.find((s) => s.stage === name)
    expect(stageOf('execution')?.state).toBe('observed')
    expect(stageOf('acceptance')?.state).toBe('not_judged')
    expect(stageOf('settlement')?.state).toBe('not_judged')
    expect(stageOf('acceptance')?.doesNotProve.join('')).toContain('X2')
    expect(stageOf('acceptance')?.doesNotProve.join('')).toContain('X3')
    expect(stageOf('settlement')?.doesNotProve.join('')).toContain('X4')

    // ③ 批次视图无 accepted/settled 面——执行完成不得冒充工作已接受（自身字段即可证伪）
    expect('accepted' in batch).toBe(false)
    expect('settled' in batch).toBe(false)

    // ④ 作验收输入：可用（完整性齐）也不产出验收判断（acceptance 恒 not_judged）
    const input = acceptanceInputOf(batch)
    expect(input.usable).toBe(true)
    expect(input.acceptance).toBe('not_judged')
    expect(input.settlement).toBe('not_judged')
    expect(input.independentPositionRequired).toContain('验者≠交付者')
  })

  it('X3 回执冒验收：闸门退出码/宿主回执是机械可复算事实，不证符合口径', () => {
    const { ledger, segment } = seedSealed()
    const batch = ledger.get(segment)
    if (batch === undefined) throw new Error('批次缺位')

    const receipt = batch.items.find((item) => item.sourceKind === 'gate_exit_receipt')
    expect(receipt).toBeDefined()
    // 回执只证「被机械采集」，证明边界显式排除验收（X3）
    expect(receipt?.proofBoundary.proves.join('')).toContain('退出码')
    expect(receipt?.proofBoundary.doesNotProve.join('')).toContain('X3')
    expect(receipt?.proofBoundary.doesNotProve.join('')).toContain('验收合格')
    // 回执在场不抬升判断：验收仍 not_judged
    expect(gradeHarvestStages().find((s) => s.stage === 'acceptance')?.state).toBe('not_judged')
  })

  it('X4 验收冒结清：结清核验者≠责任者；验收接受不推出结清', () => {
    const settlement = gradeHarvestStages().find((s) => s.stage === 'settlement')
    expect(settlement?.state).toBe('not_judged')
    expect(settlement?.judgedBy).toContain('核验者≠责任者')
    expect(settlement?.doesNotProve.join('')).toContain('X4')
    expect(settlement?.doesNotProve.join('')).toContain('接受不推出结清')
  })

  it('EX-2+ 独立闭合：DEC-OPEN-13 未裁＝undetermined（批次只作输入，不得读成已独立）', () => {
    const { ledger, segment } = seedSealed()
    const batch = ledger.get(segment)
    if (batch === undefined) throw new Error('批次缺位')
    const input = acceptanceInputOf(batch)
    expect(input.ex2Closure).toBe('undetermined')
    expect(input.notes.join('')).toContain('DEC-OPEN-13')
    expect(input.independentPositionRequired).toContain('DEC-OPEN-13')
  })
})

// ————————————————————————— 二、重复批次幂等（REC-EVD-01 区间键） —————————————————————————

describe('重复批次幂等：区间键去重零第二副作用，同键异内容拒', () => {
  it('同段同区间重复封批＝duplicate：只一条批次，证据项不增，键稳定', () => {
    const { ledger, segment } = seedSealed()
    const first = ledger.get(segment)
    if (first === undefined) throw new Error('批次缺位')
    const key = first.idempotencyKey
    expect(key).toBe(harvestIntervalKey(segment, { from: 1000, to: 1500 }))
    const itemCount = first.items.length

    // 重复交付（同一段同一区间第二次 seal）：duplicate——零第二副作用
    const again = ledger.seal(segment, 'completed', 2500)
    expect(again.status).toBe('duplicate')
    expect(again.duplicateOf).toBe(key)
    expect(ledger.all()).toHaveLength(1)
    expect(ledger.get(segment)?.items).toHaveLength(itemCount)
    // 区间/键不被第二次交付重算（迟到交付不改首批区间）
    expect(ledger.get(segment)?.interval.to).toBe(1500)
    expect(ledger.get(segment)?.idempotencyKey).toBe(key)
  })

  it('同键同内容重复 record＝duplicate（不追加证据）；重复 begin 不新开批次（增量泵收）', () => {
    const { ledger, segment } = seedSealed()
    const before = ledger.get(segment)
    if (before === undefined) throw new Error('批次缺位')
    const dup = ledger.record({ ...segment, deliverer: 'AGENT-1' }, completeRequirements())
    expect(dup.status).toBe('duplicate')
    expect(ledger.get(segment)?.items).toHaveLength(before.items.length)
    // 跨拍续收：同段重复 begin 返回同一批次（resumed 语义，键仍在）
    const resumed = ledger.begin({ ...segment, deliverer: 'AGENT-1', at: 9999 })
    expect(resumed.interval.from).toBe(before.interval.from)
    expect(ledger.all()).toHaveLength(1)
  })

  it('同键异内容：封批前判 conflict（不得作验收输入）；封批后拒第二次交付且首批保持权威', () => {
    // 封批前：先记完整，再记不完整 → conflict（未封＝无权威内容）
    const ledger = createHarvestBatchLedger()
    const segment: HarvestSegment = { ticket: 'T-2' as HarvestSegment['ticket'], attempt: 1 }
    ledger.begin({ ...segment, deliverer: 'AGENT-1', at: 1000 })
    ledger.record({ ...segment, deliverer: 'AGENT-1' }, completeRequirements())
    const conflict = ledger.record({ ...segment, deliverer: 'AGENT-1' }, incompleteRequirements())
    expect(conflict.status).toBe('conflict')
    const conflicted = ledger.get(segment)
    if (conflicted === undefined) throw new Error('批次缺位')
    expect(conflicted.status).toBe('conflict')
    expect(acceptanceInputOf(conflicted).usable).toBe(false)
    expect(acceptanceInputOf(conflicted).reasons.join('')).toContain('幂等冲突')

    // 封批后：异内容重复交付被拒，首批内容/可用性不变（对账差异不得洗掉首批）
    const first = seedSealed()
    const authoritative = first.ledger.get(first.segment)
    if (authoritative === undefined) throw new Error('批次缺位')
    const late = first.ledger.record({ ...first.segment, deliverer: 'AGENT-1' }, incompleteRequirements())
    expect(late.status).toBe('conflict')
    expect(first.ledger.get(first.segment)?.requirements?.fourOk).toBe(true)
    expect(acceptanceInputOf(first.ledger.get(first.segment) as typeof authoritative).usable).toBe(true)
    expect(first.ledger.all()).toHaveLength(1)
  })

  it('不同出工段＝不同区间键：多誓各自成批，互不压缩（重誓不是重复批次）', () => {
    const ledger = createHarvestBatchLedger()
    const requirements = completeRequirements()
    for (const attempt of [1, 2]) {
      const segment: HarvestSegment = { ticket: 'T-3' as HarvestSegment['ticket'], attempt }
      ledger.begin({ ...segment, deliverer: 'AGENT-1', at: 1000 * attempt })
      ledger.record({ ...segment, deliverer: 'AGENT-1' }, requirements)
      expect(ledger.seal(segment, 'completed', 1000 * attempt + 500).status).toBe('sealed')
    }
    const keys = ledger.all().map((batch) => batch.idempotencyKey)
    expect(ledger.all()).toHaveLength(2)
    expect(new Set(keys).size).toBe(2)
  })
})

// ————————————————————————— 三、收割者≠交付者结构位（DEC-OPEN-13） —————————————————————————

describe('收割者≠交付者结构位：声明不丢，DEC-OPEN-13 未裁不虚构独立通道', () => {
  it('结构位：harvester=框架机械通道常量，deliverer=入口工号，independence 恒 undetermined', () => {
    const slot = harvesterSlotOf({ deliverer: 'AGENT-1' })
    expect(slot.harvester).toBe(FRAMEWORK_HARVESTER)
    expect(slot.deliverer).toBe('AGENT-1')
    expect(slot.differsFromDeliverer).toBe(true)
    expect(slot.independence).toBe('undetermined')
    expect(slot.pendingDecision).toBe('DEC-OPEN-13')
    expect(slot.declaration).toBe(HARVEST_INDEPENDENCE_DECLARATION)
    // 声明须如实：只落结构位、不虚构独立收割通道
    expect(slot.declaration).toContain('结构位')
    expect(slot.declaration).toContain('不虚构独立收割通道')
    expect(slot.declaration).not.toContain('已独立')
  })

  it('声明不丢：成功/失败/重复交付三面批次携带同一结构位（同一声明串）', () => {
    const complete = seedSealed('AGENT-7')
    const failedSeed: HarvestBatchLedger = createHarvestBatchLedger()
    const failedSegment: HarvestSegment = { ticket: 'T-9' as HarvestSegment['ticket'], attempt: 1 }
    failedSeed.begin({ ...failedSegment, deliverer: 'AGENT-7', at: 1000 })
    failedSeed.record({ ...failedSegment, deliverer: 'AGENT-7' }, incompleteRequirements())
    failedSeed.seal(failedSegment, 'failed', 1500)
    failedSeed.seal(failedSegment, 'failed', 2500) // 重复交付面

    const completeBatch = complete.ledger.get(complete.segment)
    const failedBatch = failedSeed.get(failedSegment)
    if (completeBatch === undefined || failedBatch === undefined) throw new Error('批次缺位')
    expect(completeBatch.harvester).toEqual(failedBatch.harvester)
    expect(completeBatch.harvester.declaration).toBe(HARVEST_INDEPENDENCE_DECLARATION)
    expect(failedBatch.harvester.declaration).toBe(HARVEST_INDEPENDENCE_DECLARATION)
    expect(failedBatch.completeness).not.toBe('complete')
    expect(acceptanceInputOf(failedBatch).notes).toContain(HARVEST_INDEPENDENCE_DECLARATION)
  })

  it('收割者=交付者（自供）＝关系要件不成立：结构位如实记 false，批次不得作验收输入', () => {
    const slot = harvesterSlotOf({ deliverer: FRAMEWORK_HARVESTER })
    expect(slot.differsFromDeliverer).toBe(false)
    const { ledger, segment } = seedSealed(FRAMEWORK_HARVESTER)
    const batch = ledger.get(segment)
    if (batch === undefined) throw new Error('批次缺位')
    const input = acceptanceInputOf(batch)
    expect(input.usable).toBe(false)
    expect(input.reasons.join('')).toContain('收割者=交付者')
  })
})

// ————————————————————————— 四、缺证据不冒充完成（fake 栈真跑） —————————————————————————

describe('缺证据不冒充完成：四要件不齐→GATE_FAIL；缺证据批次不因后续成功被冒认', () => {
  it('fake 执行体缺终态→GATE_FAIL（无 GATE_PASS），批次 incomplete＋gaps 可见、不可作验收输入', async () => {
    const stack = await createWorkStack('evd01')
    stack.mode.value = 'incomplete' // 执行面 turn_end.completed=false（四要件缺「终态」）
    const ticket = await createTicket(stack, 'V2 收割证据单')
    await runTicks(stack, 2)

    // ① 事件面：失败显式（GATE_FAIL 携缺项），无完成冒充
    const gateFails = eventsNamed(stack.ledger, ticket, 'GATE_FAIL')
    expect(gateFails).toHaveLength(1)
    expect(gateFails[0]?.note ?? '').toContain('四要件缺【终态 completed】')
    expect(eventsNamed(stack.ledger, ticket, 'GATE_PASS')).toHaveLength(0)

    // ② 批次面：一条批次、封批 failed、完整性 incomplete、gaps 非空（没采集到的面不静默）
    const batches = stack.engine.harvestBatches.all()
    expect(batches).toHaveLength(1)
    const batch = batches[0]
    if (batch === undefined) throw new Error('批次缺位')
    expect(batch.status).toBe('sealed')
    expect(batch.completeness).toBe('incomplete')
    expect(batch.gaps.length).toBeGreaterThan(0)
    expect(batch.gaps).toContain('终态 completed')
    // 终态被观察到但非完成：五值细分不可得＝unknown（不从布尔臆造）
    expect(batch.executionTerminal).toBe('unknown')

    // ③ 缺证据不得冒充完成/验收：批次不可作验收输入，且结构位声明在场
    const input = acceptanceInputOf(batch)
    expect(input.usable).toBe(false)
    expect(input.reasons.join('')).toContain('完整性=incomplete')
    expect(input.acceptance).toBe('not_judged')
    expect(batch.harvester.declaration).toBe(HARVEST_INDEPENDENCE_DECLARATION)

    // ④ 后续成功不回溯洗白前一批（区间键隔离，first 保持 incomplete）
    stack.mode.value = 'ok'
    await runTicks(stack, 2)
    expect(eventsNamed(stack.ledger, ticket, 'GATE_PASS')).toHaveLength(1)
    const after = stack.engine.harvestBatches.all()
    expect(after).toHaveLength(2)
    expect(after[0]?.segment.attempt).toBe(1)
    expect(after[0]?.completeness).toBe('incomplete')
    expect(after[1]?.segment.attempt).toBe(2)
    expect(after[1]?.completeness).toBe('complete')
    expect(after[1]?.harvester.declaration).toBe(HARVEST_INDEPENDENCE_DECLARATION)
    // 两批键不同（出工段隔离）；成功批可作验收输入（仍不产出验收判断）
    expect(after[0]?.idempotencyKey).not.toBe(after[1]?.idempotencyKey)
    expect(acceptanceInputOf(after[0] as (typeof after)[number]).usable).toBe(false)
    expect(acceptanceInputOf(after[1] as (typeof after)[number]).acceptance).toBe('not_judged')
  })
})
