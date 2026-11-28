/**
 * closeout-idempotency —— task-158 / FIX-04 ①（Kimi 总审 P0-04）：attempt 收口幂等键
 *
 * 依据：docs/quality/idempotent-closeout.md §1（幂等键）／§5（测试面）；
 *       docs/sentinel-logs/全面Review拆分-2026-11-28.md §2.1 FIX-04 验收 ①②⑥；
 *       docs/quality/reviews/2026-11-28/00-overall-review.md §2.1 P0-04。
 * 现场（只读取证）：LOCAL-437/442 于 03:52:03.719Z/.806Z 与 .768Z/.824Z 各落两次「新单」
 * 回退——boot 孤儿扫描 GATE_FAIL 与 STALL 消亡面 GATE_FAIL WORKER_DEAD 同 attempt 并发直写。
 * 修法：收口键 `ticket@attempt`——同步认领（L1）+ 写前现读门（L2）；同键多次触发只生效一次。
 *
 * 断言面（V3 真栈：fake 只替代外部端口，决策/台账/事务/看门狗全真跑）：
 *   T1 重放 LOCAL-437/442（boot 扫描 × 消亡面）：两种到达序各只一次「新单」回退、零双连击
 *   T2 同拍收割失败面 × 消亡面 → 单回退、单连击（断路阈 2 不误熔断=连击恰一次的行为证据）
 *   T5 认领冲突单测（同键重复／旧誓迟到／新誓顶替／写失败释放／现读改态释放）
 *   T6 重复 CLOSE／重复扫描／重复重派对账 → 零副作用
 */
import { afterAll, describe, expect, it } from 'vitest'
import type { IssueQuery, IssueRecord, TicketId } from '@studio-next/contract'
import type { EngineConfig } from '../../../src/engine/engine.ts'
import {
  claimAttemptCloseout,
  closeoutAnchored,
  closeoutAttemptOf,
  closeoutKeyOf,
  closeoutSkipNote,
  settleAttemptCloseout,
  yieldAttemptCloseout,
  type AttemptCloseoutRegistry,
} from '../../../src/engine/recovery/closeout.ts'
import {
  createTicket,
  createWorkStack,
  disposeWorkStacks,
  eventsNamed,
  eventsOf,
  issueOf,
  restartWorkStack,
  runTicks,
  tick,
  type WorkTestStack,
} from '../records/fixtures/work-stack.ts'

afterAll(async () => {
  await disposeWorkStacks()
})

/** fake 平台 issues 面的可替换视图（注入「窗口」：延迟投递=并发到达序的确定性构造） */
interface IssuesFace {
  list(q: IssueQuery): Promise<IssueRecord[]>
  get(id: TicketId): Promise<IssueRecord>
  transition(id: TicketId, toState: string): Promise<IssueRecord>
}
function issuesOf(stack: WorkTestStack): IssuesFace {
  return stack.platform.issues as unknown as IssuesFace
}

function notesWith(stack: WorkTestStack, ticket: TicketId, name: 'STALL' | 'GATE_FAIL', needle: string): string[] {
  return eventsNamed(stack.ledger, ticket, name)
    .map((e) => e.note ?? '')
    .filter((n) => n.includes(needle))
}

function stallResultOf(report: Awaited<ReturnType<typeof tick>>, ticket: TicketId) {
  return report.actionResults.find((r) => r.actionType === 'stall_alarm' && r.ticket === ticket)
}

/**
 * LOCAL-437/442 同型现场：平台=已派发、工人消亡（dispose 语义=句柄没了、工位留 running）、
 * daemon 无 inflight；随后 **daemon 重启**（同平台/台账上新引擎：inflight/泳道租约/收口认领表
 * 归零＝boot 扫描所见的真实世界）；时钟越过静默阈 → 下一拍消亡面（无在途句柄）达阈咬合。
 */
async function deadWorkerStack(label: string, overrides: Partial<EngineConfig> = {}) {
  const stack = await createWorkStack(label, { stallKillAfterAlarms: 1, ...overrides })
  stack.mode.value = 'stalled'
  const ticket = await createTicket(stack, 'LOCAL-437 类：已派发、工人消亡、daemon 无 inflight')
  await tick(stack)
  expect((await issueOf(stack, ticket)).state).toBe('已派发')
  expect(stack.ledger.listWorkRecords({ issue: ticket }).map((r) => r.attempt)).toEqual([1])
  await stack.engine.dispose()
  const restarted = restartWorkStack(stack, { stallKillAfterAlarms: 1, ...overrides })
  restarted.clock.advance(61_000)
  return { stack: restarted, ticket }
}

describe('T1 重放 LOCAL-437/442：boot 扫描 × 消亡面同 attempt 并发 → 只一次「新单」回退', () => {
  it('到达序 A：扫描先认领（卡在现读门）、同拍消亡面到达 → 认领重复=零平台写；扫描落唯一回退且带 closeout 锚', async () => {
    const { stack, ticket } = await deadWorkerStack('fix04-t1a')
    const issues = issuesOf(stack)
    const realGet = issues.get.bind(issues)
    let release: () => void = () => undefined
    let sweepAtRead: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const reached = new Promise<void>((resolve) => { sweepAtRead = resolve })
    let first = true
    issues.get = async (id) => {
      if (first && id === ticket) {
        first = false
        sweepAtRead()
        await gate // 扫描已认领、卡在 L2 现读=并发窗口
      }
      return realGet(id)
    }
    const sweep = stack.engine.recoverOrphans() // boot 扫描（serve 启动面 fire-and-forget 同构）
    await reached
    const report = await tick(stack) // 同拍：消亡面到达
    release()
    const result = await sweep

    // ② 重复事件不新增 attempt；① 只一次「新单」回退
    expect(result).toMatchObject({ scanned: 1, recovered: 1, duplicates: 0, failed: 0 })
    expect((await issueOf(stack, ticket)).state).toBe('新单')
    const gateFails = eventsNamed(stack.ledger, ticket, 'GATE_FAIL')
    expect(gateFails).toHaveLength(1)
    expect(gateFails[0]?.note ?? '').toContain('boot-orphan-recovery')
    expect(gateFails[0]?.note ?? '').toContain(`ticket=${ticket};`)
    expect(gateFails[0]?.note ?? '').toContain(`from=已派发;to=新单`)
    expect((gateFails[0]?.note ?? '').endsWith(`;closeout=${ticket}@1;source=boot-orphan`)).toBe(true)
    expect(notesWith(stack, ticket, 'STALL', 'rollback=新单')).toHaveLength(0)
    expect(notesWith(stack, ticket, 'GATE_FAIL', 'WORKER_DEAD')).toHaveLength(0)
    expect(eventsNamed(stack.ledger, ticket, 'ESCALATE')).toHaveLength(0)
    // 消亡面动作：幂等跳过（零平台写、不计 mutation、不进 errors）且 detail 明报
    expect(stallResultOf(report, ticket)).toMatchObject({ ok: true, skipped: true })
    expect(stallResultOf(report, ticket)?.detail).toContain(`收口重复：${ticket}@1 已由 boot-orphan 认领`)
    expect(report.errors.some((e) => e.includes(ticket))).toBe(false)
    expect(stack.ledger.listWorkRecords({ issue: ticket })).toHaveLength(1)

    // 回退后：镜像重决策自动重派 attempt=2 → 全链 CLOSE（消亡面未连击=不熔断）
    stack.mode.value = 'ok'
    await runTicks(stack, 9)
    const names = eventsOf(stack.ledger, ticket).map((e) => e.event)
    expect(names.filter((n) => n === 'DISPATCH')).toHaveLength(2)
    expect(names.at(-1)).toBe('CLOSE')
    expect(eventsNamed(stack.ledger, ticket, 'ESCALATE')).toHaveLength(0)
  })

  it('到达序 B：消亡面先收口、扫描凭旧快照迟到 → 认领重复：不二次回退、不落扫描事件，duplicates 计账', async () => {
    const { stack, ticket } = await deadWorkerStack('fix04-t1b')
    const issues = issuesOf(stack)
    const realList = issues.list.bind(issues)
    let release: () => void = () => undefined
    let snapshotted: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const reached = new Promise<void>((resolve) => { snapshotted = resolve })
    let first = true
    issues.list = async (q) => {
      const rows = await realList(q) // 快照已取（已派发）——投递延迟=旧快照窗口
      if (first) {
        first = false
        snapshotted()
        await gate
      }
      return rows
    }
    const sweep = stack.engine.recoverOrphans()
    await reached
    await tick(stack) // 消亡面先咬合：STALL + GATE_FAIL WORKER_DEAD + 连击×1
    release()
    const result = await sweep

    expect(result).toMatchObject({ scanned: 1, recovered: 0, duplicates: 1, failed: 0 })
    expect((await issueOf(stack, ticket)).state).toBe('新单')
    const gateFails = eventsNamed(stack.ledger, ticket, 'GATE_FAIL')
    expect(gateFails).toHaveLength(1)
    expect(gateFails[0]?.note ?? '').toContain('WORKER_DEAD')
    // closeout 锚落在 task-157 冻结的 errorKind 尾段之前（尾锚不动）
    expect(gateFails[0]?.note ?? '').toMatch(new RegExp(`;closeout=${ticket}@1;source=stall-worker-dead;errorKind=worker_dead;retryable=true$`))
    expect(notesWith(stack, ticket, 'GATE_FAIL', 'boot-orphan-recovery')).toHaveLength(0)
    expect(notesWith(stack, ticket, 'STALL', 'rollback=新单')).toHaveLength(1)
    expect(eventsNamed(stack.ledger, ticket, 'STALL').at(-1)?.note ?? '').toContain(`closeout=${ticket}@1;source=stall-worker-dead`)
    expect(stack.ledger.listWorkRecords({ issue: ticket })).toHaveLength(1)
    stack.mode.value = 'ok'
    await runTicks(stack, 9)
    const names = eventsOf(stack.ledger, ticket).map((e) => e.event)
    expect(names.filter((n) => n === 'DISPATCH')).toHaveLength(2)
    expect(names.at(-1)).toBe('CLOSE')
    expect(eventsNamed(stack.ledger, ticket, 'ESCALATE')).toHaveLength(0)
  })

  it('L2 现读门（跨重启：认领后平台已被他方回退）→ state-changed 零写；认领释放后同键可再认领', async () => {
    const { stack, ticket } = await deadWorkerStack('fix04-t1c')
    const issues = issuesOf(stack)
    const realGet = issues.get.bind(issues)
    let release: () => void = () => undefined
    let sweepAtRead: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const reached = new Promise<void>((resolve) => { sweepAtRead = resolve })
    let first = true
    issues.get = async (id) => {
      if (first && id === ticket) {
        first = false
        sweepAtRead()
        await gate
      }
      return realGet(id)
    }
    const eventsBefore = eventsOf(stack.ledger, ticket).length
    const sweep = stack.engine.recoverOrphans()
    await reached
    await issues.transition(ticket, '新单') // 旧进程期写者已回退（认领表随进程丢失）
    release()
    const result = await sweep

    expect(result).toMatchObject({ recovered: 0, duplicates: 0, skippedNotDispatched: 1, failed: 0 })
    expect(eventsOf(stack.ledger, ticket).length).toBe(eventsBefore) // 零收口事件
    // 认领已释放：平台回到已派发（新誓再派后再消亡）→ 同键可再认领、照常收口
    issues.get = realGet
    await issues.transition(ticket, '已派发')
    const again = await stack.engine.recoverOrphans()
    expect(again).toMatchObject({ recovered: 1, duplicates: 0 })
    expect(eventsNamed(stack.ledger, ticket, 'GATE_FAIL')).toHaveLength(1)
    expect((await issueOf(stack, ticket)).state).toBe('新单')
  })
})

describe('T2 同拍：收割失败面 × 消亡面 → 单回退、单连击', () => {
  it('收割失败（GATE_FAIL 回退+连击）先收口，消亡面同拍到达 → 幂等跳过：不二次回退、不二次连击（断路阈 2 不误熔断）', async () => {
    const stack = await createWorkStack('fix04-t2', { stallAfterMs: 1, stallKillAfterAlarms: 2, breakerThreshold: 2 })
    stack.mode.value = 'stalled'
    const ticket = await createTicket(stack, '同拍收割失败 × 消亡面')
    await runTicks(stack, 2) // 派发 attempt=1；次拍首告警只叫（阈 2）且收割增量泵开始消费驻留流
    // 工人中途消亡注入：直呼 fake kill 放行驻留流（零事件 EOF——下一拍收割=四要件全缺；
    // fake 会话号=首誓确定值，fakes.ts launch sessionSeq）
    await stack.adapter.kill({ executor: stack.adapter.name, sessionId: `${stack.adapter.name}-1`, pid: 0 }, 0)
    const report = await tick(stack) // 拍首决策=已派发（第二告警达阈入队）→ 收割失败面回退 → 消亡面同拍到达

    expect(report.errors.some((e) => e.includes(ticket))).toBe(false)
    const gateFails = eventsNamed(stack.ledger, ticket, 'GATE_FAIL')
    expect(gateFails).toHaveLength(1)
    expect(gateFails[0]?.note ?? '').not.toContain('WORKER_DEAD')
    // closeout 锚落在 errorKind 尾段之前（GATE_FAIL 尾仍=task-157 错误分类段）
    expect(gateFails[0]?.note ?? '').toMatch(new RegExp(`;closeout=${ticket}@1;source=harvest-fail;errorKind=quality;retryable=false;provider=-;account=-$`))
    expect(notesWith(stack, ticket, 'GATE_FAIL', 'WORKER_DEAD')).toHaveLength(0)
    expect(notesWith(stack, ticket, 'STALL', 'rollback=新单')).toHaveLength(0)
    expect(eventsNamed(stack.ledger, ticket, 'ESCALATE')).toHaveLength(0)
    expect(stallResultOf(report, ticket)).toMatchObject({ ok: true, skipped: true })
    expect(stallResultOf(report, ticket)?.detail).toContain(`收口重复：${ticket}@1 已由 harvest-fail 认领`)
    expect((await issueOf(stack, ticket)).state).toBe('新单')
    expect(stack.ledger.listWorkRecords({ issue: ticket })).toHaveLength(1)

    // 行为证据：连击恰一次（阈 2 不熔断）→ 重派 attempt=2 → CLOSE；二次连击则 CIRCUIT_BREAK+压派
    stack.mode.value = 'ok'
    await runTicks(stack, 9)
    const names = eventsOf(stack.ledger, ticket).map((e) => e.event)
    expect(names.filter((n) => n === 'DISPATCH')).toHaveLength(2)
    expect(names.at(-1)).toBe('CLOSE')
    expect(eventsNamed(stack.ledger, ticket, 'ESCALATE')).toHaveLength(0)
    expect(eventsNamed(stack.ledger, ticket, 'GATE_PASS')).toHaveLength(1)
  })
})

describe('T5 认领冲突（closeout.ts 纯函数面）', () => {
  it('同键二次认领=duplicate（持有者可辨）；新誓顶替旧誓=claimed；旧誓迟到=stale；键=ticket@attempt', () => {
    const registry: AttemptCloseoutRegistry = new Map()
    expect(closeoutKeyOf('LOCAL-437', 8)).toBe('LOCAL-437@8')
    expect(claimAttemptCloseout(registry, 'LOCAL-437', 8, 'boot-orphan')).toEqual({ kind: 'claimed', ticket: 'LOCAL-437', key: 'LOCAL-437@8', attempt: 8, source: 'boot-orphan' })
    expect(claimAttemptCloseout(registry, 'LOCAL-437', 8, 'stall-worker-dead')).toMatchObject({ kind: 'duplicate', holder: 'boot-orphan', heldAttempt: 8 })
    expect(claimAttemptCloseout(registry, 'LOCAL-437', 9, 'harvest-fail')).toMatchObject({ kind: 'claimed', key: 'LOCAL-437@9', source: 'harvest-fail' })
    expect(claimAttemptCloseout(registry, 'LOCAL-437', 8, 'stall-kill')).toMatchObject({ kind: 'stale', holder: 'harvest-fail', heldAttempt: 9 })
    expect(registry.get('LOCAL-437')).toEqual({ attempt: 9, source: 'harvest-fail' }) // 旧誓迟到不顶替在册新誓
  })

  it('未认领（duplicate/stale）结算：不读不写直返其类；明报文案携键与持有者', async () => {
    const registry: AttemptCloseoutRegistry = new Map()
    const claim = claimAttemptCloseout(registry, 'T-1', 2, 'boot-orphan')
    const dup = claimAttemptCloseout(registry, 'T-1', 2, 'stall-worker-dead')
    expect(claim.kind).toBe('claimed')
    let reads = 0
    let writes = 0
    const settle = {
      read: async () => { reads += 1; return { id: 'T-1', state: '已派发' } as IssueRecord },
      write: async () => { writes += 1 },
    }
    expect(await settleAttemptCloseout({ registry, claim: dup, ...settle })).toBe('duplicate')
    expect(await settleAttemptCloseout({ registry, claim: claimAttemptCloseout(registry, 'T-1', 1, 'stale-epoch'), ...settle })).toBe('stale')
    expect(reads).toBe(0)
    expect(writes).toBe(0)
    expect(closeoutSkipNote(dup)).toBe('收口重复：T-1@2 已由 boot-orphan 认领——幂等不重复回退/不重复连击')
    expect(closeoutSkipNote(claimAttemptCloseout(registry, 'T-1', 1, 'stale-epoch'))).toBe('收口过期：T-1@1 为旧 attempt（在册 boot-orphan@2）——幂等跳过')
  })

  it('write 抛错=释放认领后原样上抛（下次触发可再认领）；现读改态=state-changed 零写并释放；胜出=note 尾缀携 closeout 锚', async () => {
    const registry: AttemptCloseoutRegistry = new Map()
    const claim = claimAttemptCloseout(registry, 'T-1', 3, 'harvest-fail')
    if (claim.kind !== 'claimed') throw new Error('前置：须认领成功')
    await expect(settleAttemptCloseout({ registry, claim, write: async () => { throw new Error('disk full') } })).rejects.toThrow('disk full')
    expect(registry.has('T-1')).toBe(false)
    // 现读抛错同款：释放后上抛（平台暂不可达不悬挂认领）
    const retry = claimAttemptCloseout(registry, 'T-1', 3, 'boot-orphan')
    if (retry.kind !== 'claimed') throw new Error('前置：须再认领成功')
    await expect(settleAttemptCloseout({ registry, claim: retry, read: async () => { throw new Error('yt down') }, expectedState: '已派发', write: async () => undefined })).rejects.toThrow('yt down')
    expect(registry.has('T-1')).toBe(false)
    // 现读改态：已非已派发 → 零写 + 释放
    const third = claimAttemptCloseout(registry, 'T-1', 3, 'boot-orphan')
    if (third.kind !== 'claimed') throw new Error('前置：须三度认领成功')
    let writes = 0
    const verdict = await settleAttemptCloseout({
      registry,
      claim: third,
      read: async () => ({ id: 'T-1', state: '新单' } as IssueRecord),
      expectedState: '已派发',
      write: async () => { writes += 1 },
    })
    expect(verdict).toBe('state-changed')
    expect(writes).toBe(0)
    expect(registry.has('T-1')).toBe(false)
    expect(closeoutSkipNote(third)).toBe('收口跳过：T-1@3 平台态已非已派发（已回退/已收口——幂等不双写）')
    // 胜出：suffix 注入 write（事件 note 尾锚）；在册保持=同键此后恒 duplicate
    const last = claimAttemptCloseout(registry, 'T-1', 3, 'stall-kill')
    if (last.kind !== 'claimed') throw new Error('前置：须认领成功')
    const suffixes: string[] = []
    expect(await settleAttemptCloseout({ registry, claim: last, write: async (suffix) => { suffixes.push(suffix) } })).toBe('won')
    expect(suffixes).toEqual([';closeout=T-1@3;source=stall-kill'])
    expect(claimAttemptCloseout(registry, 'T-1', 3, 'boot-orphan')).toMatchObject({ kind: 'duplicate', holder: 'stall-kill' })
  })

  it('closeout 锚落 errorKind 尾段之前（task-157 尾锚 `…;errorKind=…;retryable=…` 不动）；无尾段=直接追加', () => {
    const suffix = ';closeout=T-1@1;source=harvest-fail'
    expect(closeoutAnchored('GATE_FAIL：四要件缺【终态】;rollback=新单;errorKind=quota;retryable=false;provider=glm;account=-', suffix))
      .toBe('GATE_FAIL：四要件缺【终态】;rollback=新单;closeout=T-1@1;source=harvest-fail;errorKind=quota;retryable=false;provider=glm;account=-')
    expect(closeoutAnchored('STALL：…;rollback=新单', suffix)).toBe(`STALL：…;rollback=新单${suffix}`)
    expect(closeoutAnchored('', suffix)).toBe(suffix)
    // 段解析两序皆成立：closeout/source/errorKind 各取各值
    const anchored = closeoutAnchored('x;rollback=新单;errorKind=worker_dead;retryable=true', suffix)
    expect(anchored.match(/;(closeout|source|errorKind|retryable)=([^;]*)/g)).toEqual([';closeout=T-1@1', ';source=harvest-fail', ';errorKind=worker_dead', ';retryable=true'])
  })

  it('在册誓号：在途条目 attempt 优先 → 最新工时行 attempt → 0（无账退化单键）', () => {
    const rt = { ledger: { listWorkRecords: () => [{ attempt: 1 }, { attempt: 7 }, { attempt: 3 }] } } as unknown as Parameters<typeof closeoutAttemptOf>[0]
    expect(closeoutAttemptOf(rt, 'LOCAL-437')).toBe(7)
    expect(closeoutAttemptOf(rt, 'LOCAL-437', { attempt: 4 })).toBe(4)
    expect(closeoutAttemptOf({ ledger: { listWorkRecords: () => [] } } as unknown as Parameters<typeof closeoutAttemptOf>[0], 'T-9')).toBe(0)
  })

  it('新派发让位（yieldAttemptCloseout）：同号/降号删旧认领；正常递增保留旧认领防迟到', () => {
    const registry: AttemptCloseoutRegistry = new Map()
    claimAttemptCloseout(registry, 'T-1', 2, 'boot-orphan')
    yieldAttemptCloseout(registry, 'T-1', 3) // 正常递增：保留旧认领防迟到
    expect(registry.get('T-1')).toEqual({ attempt: 2, source: 'boot-orphan' })
    yieldAttemptCloseout(registry, 'T-1', 2) // 同号复用：让位
    expect(registry.has('T-1')).toBe(false)
    claimAttemptCloseout(registry, 'T-1', 3, 'boot-orphan')
    yieldAttemptCloseout(registry, 'T-1', 1) // 降号复用：让位
    expect(registry.has('T-1')).toBe(false)
  })
})

describe('T6 重复 CLOSE / 重复扫描 / 重复重派对账 → 零副作用', () => {
  it('已 CLOSE 单：两次 recoverOrphans + 续推 3 拍 → 仍恰一次 CLOSE、零新事件、零新 attempt、平台态不动', async () => {
    const stack = await createWorkStack('fix04-t6-closed')
    const ticket = await createTicket(stack, 'T6 已终局单')
    await runTicks(stack, 8)
    expect(eventsNamed(stack.ledger, ticket, 'CLOSE')).toHaveLength(1)
    const eventsBefore = eventsOf(stack.ledger, ticket).length
    const stateBefore = (await issueOf(stack, ticket)).state
    const first = await stack.engine.recoverOrphans()
    const second = await stack.engine.recoverOrphans()
    const reports = await runTicks(stack, 3)
    expect(first).toMatchObject({ recovered: 0, duplicates: 0, failed: 0 })
    expect(second).toMatchObject({ recovered: 0, duplicates: 0, failed: 0 })
    expect(eventsOf(stack.ledger, ticket).length).toBe(eventsBefore)
    expect((await issueOf(stack, ticket)).state).toBe(stateBefore)
    expect(stack.ledger.listWorkRecords({ issue: ticket })).toHaveLength(1)
    expect(reports.every((r) => r.errors.length === 0)).toBe(true)
  })

  it('工人消亡单：两次并发 boot 扫描（重启期重复扫描同构）→ 只一次回退、duplicates 恰一；重派 attempt=2 恰一次', async () => {
    const { stack, ticket } = await deadWorkerStack('fix04-t6-scan')
    const [a, b] = await Promise.all([stack.engine.recoverOrphans(), stack.engine.recoverOrphans()])
    expect(a.recovered + b.recovered).toBe(1)
    expect(a.duplicates + b.duplicates).toBe(1)
    expect(a.failed + b.failed).toBe(0)
    const gateFails = eventsNamed(stack.ledger, ticket, 'GATE_FAIL')
    expect(gateFails).toHaveLength(1)
    expect(gateFails[0]?.note ?? '').toMatch(/;closeout=T-\d+@1;source=boot-orphan$/)
    expect((await issueOf(stack, ticket)).state).toBe('新单')
    stack.mode.value = 'ok'
    await runTicks(stack, 9)
    const events = eventsOf(stack.ledger, ticket).map((e) => e.event)
    expect(events.filter((n) => n === 'DISPATCH')).toHaveLength(2)
    expect(events.at(-1)).toBe('CLOSE')
  })
})

describe('T7 誓号复用：新派发让位旧认领（同号新誓不得被永判 duplicate 卡死在已派发）', () => {
  it('崩溃窗后台账（平台已派发＋工时行 attempt=1 直写在册、DISPATCH 事件未提交）：孤儿回退在册后重派同号 attempt=1 → 新誓收口照常回退、后续 attempt=2 闭环', async () => {
    const stack = await createWorkStack('fix04-t7-reuse', { stallKillAfterAlarms: 1, breakerThreshold: 3 })
    stack.mode.value = 'stalled'
    const ticket = await createTicket(stack, 'T7 誓号复用')
    // 前置形态（派发序「工时行直写 → 平台迁已派发 → DISPATCH 事件拍末才提交」的崩溃窗）：
    // 台账有工时行无 DISPATCH 事件 → attemptOf（=DISPATCH 计数+1）此后仍给 attempt=1
    await stack.platform.issues.transition(ticket, '已派发')
    stack.ledger.insertWorkRecord({
      id: 'wr-crash-window', issue: ticket, person_id: 'AGENT-1', executor: stack.adapter.name, session_id: 'fake-work-crash',
      lane: 'core', started_at: stack.clock.now(), attempt: 1, status: 'running',
    })
    const sweep = await stack.engine.recoverOrphans() // boot 孤儿扫描：回退 T@1（认领在册保留）
    expect(sweep).toMatchObject({ recovered: 1, duplicates: 0, failed: 0 })
    expect((await issueOf(stack, ticket)).state).toBe('新单')
    await runTicks(stack, 2) // 重派（同号 attempt=1）＋次拍收割增量泵开始消费驻留流
    expect(stack.ledger.listWorkRecords({ issue: ticket }).map((r) => r.attempt)).toEqual([1, 1])
    expect((await issueOf(stack, ticket)).state).toBe('已派发')
    // 同进程（首认领已由新派发让位）：新誓工人被杀 → 次拍收割失败面收口回退新单
    await stack.adapter.kill({ executor: stack.adapter.name, sessionId: `${stack.adapter.name}-1`, pid: 0 }, 0)
    const report = await tick(stack)
    const gateFails = eventsNamed(stack.ledger, ticket, 'GATE_FAIL')
    expect(gateFails).toHaveLength(2)
    expect(gateFails[1]?.note ?? '').toContain(`;closeout=${ticket}@1;source=harvest-fail`)
    expect((await issueOf(stack, ticket)).state).toBe('新单')
    expect(report.errors.some((e) => e.includes('收口重复'))).toBe(false)
    // 第三誓 attempt=2（DISPATCH 计数=1）→ 正常闭环
    stack.mode.value = 'ok'
    await runTicks(stack, 9)
    expect(eventsNamed(stack.ledger, ticket, 'CLOSE')).toHaveLength(1)
    expect(eventsNamed(stack.ledger, ticket, 'ESCALATE')).toHaveLength(0)
  })
})

describe('T8 认领前后台账抛错（endWorkRecord / attemptFor）→ 不悬挂认领，下一拍/下次扫描自愈', () => {
  it('STALL kill 面：endWorkRecord 瞬时抛错 → 认领释放，下一拍成功回退新单而非永久 duplicate 卡死', async () => {
    const stack = await createWorkStack('fix04-t8-stall-kill', { stallAfterMs: 10_000, stallKillAfterAlarms: 1 })
    stack.mode.value = 'stalled'
    const ticket = await createTicket(stack, 'T8 stall-kill endWorkRecord 抛错')
    await tick(stack) // 派发 attempt=1
    expect((await issueOf(stack, ticket)).state).toBe('已派发')
    stack.clock.advance(15_000)

    const ledgerFace = stack.ledger as unknown as { endWorkRecord: typeof stack.ledger.endWorkRecord }
    const realEndWorkRecord = stack.ledger.endWorkRecord.bind(stack.ledger)
    let failOnce = true
    ledgerFace.endWorkRecord = (...args) => {
      if (failOnce) {
        failOnce = false
        throw new Error('SQLITE_IOERR: endWorkRecord')
      }
      return realEndWorkRecord(...args)
    }

    const r1 = await tick(stack) // A 面认领 stall-kill → kill → endWorkRecord 抛错
    expect(r1.errors.some((e) => e.includes('SQLITE_IOERR: endWorkRecord'))).toBe(true)
    expect((await issueOf(stack, ticket)).state).toBe('已派发')

    const r2 = await tick(stack) // 下一拍瞬时错误已消：未悬挂认领 → 正常回退新单（非 duplicate）
    expect(r2.errors.some((e) => e.includes('收口重复'))).toBe(false)
    expect((await issueOf(stack, ticket)).state).toBe('新单')
    stack.mode.value = 'ok'
    await runTicks(stack, 9)
    expect(eventsNamed(stack.ledger, ticket, 'CLOSE')).toHaveLength(1)
  })

  it('收割失败面：endWorkRecord 瞬时抛错 → 认领释放，下一拍重试回退新单而非永久 duplicate', async () => {
    const stack = await createWorkStack('fix04-t8-harvest-fail', { stallKillAfterAlarms: 0 })
    stack.mode.value = 'no_report'
    const ticket = await createTicket(stack, 'T8 failHarvest endWorkRecord 抛错')
    await tick(stack) // 派发 attempt=1
    expect((await issueOf(stack, ticket)).state).toBe('已派发')

    const ledgerFace = stack.ledger as unknown as { endWorkRecord: typeof stack.ledger.endWorkRecord }
    const realEndWorkRecord = stack.ledger.endWorkRecord.bind(stack.ledger)
    let failOnce = true
    ledgerFace.endWorkRecord = (...args) => {
      if (failOnce) {
        failOnce = false
        throw new Error('SQLITE_IOERR: endWorkRecord')
      }
      return realEndWorkRecord(...args)
    }

    const r1 = await tick(stack) // failHarvest 认领 harvest-fail → endWorkRecord 抛错
    expect(r1.errors.some((e) => e.includes('SQLITE_IOERR: endWorkRecord'))).toBe(true)
    expect((await issueOf(stack, ticket)).state).toBe('已派发')

    const r2 = await tick(stack) // 下一拍重试：未悬挂认领 → 正常落 GATE_FAIL 回退新单
    expect(r2.errors.some((e) => e.includes('收口重复'))).toBe(false)
    expect((await issueOf(stack, ticket)).state).toBe('新单')
    const gateFails = eventsNamed(stack.ledger, ticket, 'GATE_FAIL')
    expect(gateFails).toHaveLength(1)
    expect(gateFails[0]?.note ?? '').toContain(`;closeout=${ticket}@1;source=harvest-fail`)
    stack.mode.value = 'ok'
    await runTicks(stack, 9)
    expect(eventsNamed(stack.ledger, ticket, 'CLOSE')).toHaveLength(1)
  })

  it('孤儿扫描面：attemptFor（listWorkRecords）瞬时抛错一次 → 不悬挂认领，下一次扫描可恢复（非永久 duplicate）', async () => {
    const { stack, ticket } = await deadWorkerStack('fix04-t8-orphan-attempt-for')
    const ledgerFace = stack.ledger as unknown as { listWorkRecords: typeof stack.ledger.listWorkRecords }
    const realListWorkRecords = stack.ledger.listWorkRecords.bind(stack.ledger)
    let calls = 0
    ledgerFace.listWorkRecords = (...args) => {
      calls += 1
      // 第 1 次=closeoutAttemptOf，第 2 次=attemptFor（此前位于 claimAttemptCloseout 之后无保护）
      if (calls === 2) throw new Error('SQLITE_IOERR: attemptFor listWorkRecords')
      return realListWorkRecords(...args)
    }

    await expect(stack.engine.recoverOrphans()).rejects.toThrow('SQLITE_IOERR: attemptFor listWorkRecords')
    expect((await issueOf(stack, ticket)).state).toBe('已派发')

    // 下一次扫描瞬时错误已消：未悬挂认领 → 正常回退新单（recovered=1, duplicates=0）而非永久 duplicate
    const retry = await stack.engine.recoverOrphans()
    expect(retry).toMatchObject({ scanned: 1, recovered: 1, duplicates: 0, failed: 0 })
    expect((await issueOf(stack, ticket)).state).toBe('新单')
    const gateFails = eventsNamed(stack.ledger, ticket, 'GATE_FAIL')
    expect(gateFails).toHaveLength(1)
    expect(gateFails[0]?.note ?? '').toContain(`;closeout=${ticket}@1;source=boot-orphan`)
  })
})
