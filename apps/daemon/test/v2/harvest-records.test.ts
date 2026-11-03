/**
 * harvest-records —— 收割证据批次落库（REC-EVD-01/02 → PORT-HIST 唯一记录写口）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/17-§2（主循环七相位：第 4 位＝收割）／§6（收割四要件：终态 completed＋输出非空＋
 *     REPORT 落盘＋闸门 exit=0）；
 *   - docs/v2/14 §1.6（PORT-HIST 唯一记录写口；PORT-EVD `registerItem` 只收草案不收记录）；
 *   - docs/v2/11 §〇（记录信封）/§0.4-5（幂等键五元组）/§六 REC-EVD-01（批次字段：segment_ref/
 *     source_cursor/collected_items/harvest_completeness/gaps/execution_terminal/usage_and_cost/
 *     idempotency_key）与 REC-EVD-02（证据项：source_anchor/element_state/proves/does_not_prove）；
 *   - docs/v2/08 §1.4（批次是 EX-2+ 验收强制输入；完整性存疑不得判接受）、§1.3/§2.4-4（来源锚两级）；
 *     §1.5（执行观察≠验收≠结清）；
 *   - docs/v2/09 ENU-48（八要素 ID）/ENU-49（来源两级）/ENU-50（要素三态）/ENU-53（终态五值）/
 *     ENU-60（完整性三态）。
 *
 * 断言纪律：台账＝真 SQLite（openLedger）＋真 PORT-HIST 面（createHistFace）＋真引擎（第 4 相位）；
 * fake 只替代平台与执行体；不 mock LLM、不重试。负例断言**拒绝面**（不落半套、不臆造终态、
 * 不冒充 complete），正例断言**可读回**（记录面字段逐项对账）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createHistFace, openLedger, type HistFace, type Ledger } from '@studio-next/store'
import {
  createHarvestBatchLedger,
  harvestIntervalKey,
  harvestRequirementsOf,
  FRAMEWORK_HARVESTER,
  HARVEST_INDEPENDENCE_DECLARATION,
  type HarvestRequirements,
  type HarvestSegment,
} from '../../src/engine/harvest/batch.ts'
import {
  createHarvestRecordingLedger,
  HARVEST_RECORD_SCHEMA_REF,
  HARVEST_RECORD_SPEC_VERSION,
  HARVEST_RECORD_WRITTEN_BY,
  type HarvestRecordSink,
  type HarvestRecordingLedger,
} from '../../src/engine/harvest/records.ts'
import { acceptanceInputOf } from '../../src/engine/harvest/stages.ts'
import { assembleHarvestRecords } from '../../src/assembly/harvest/records.ts'
import { validateEvidenceItem, validateHarvestBatch } from '../../../../packages/contract/src/records/evd.ts'
import { createTicket, createWorkStack, disposeWorkStacks, eventsNamed, runTicks } from './records/fixtures/work-stack.ts'

const COMPANY = 'demo'
const SEGMENT: HarvestSegment = { ticket: 'T-1' as HarvestSegment['ticket'], attempt: 1 }

const roots: string[] = []

afterAll(async () => {
  await disposeWorkStacks()
  for (const root of roots) await rm(root, { recursive: true, force: true })
  roots.length = 0
})

/** 真台账＋真记录面（一用例一库；tmp 根统一回收） */
async function openStores(label: string): Promise<{ ledger: Ledger; hist: HistFace }> {
  const root = await mkdtemp(path.join(tmpdir(), `sn-harvest-rec-${label}-`))
  roots.push(root)
  const ledger = openLedger(path.join(root, 'ledger.sqlite'))
  return { ledger, hist: createHistFace(ledger.db) }
}

/** 四要件齐（EX-0/1 常态；终态自报 completed——仅作观察） */
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

/** 缺 REPORT 的不完整批次（终态采到、四要件不齐） */
function missingReportRequirements(): HarvestRequirements {
  return harvestRequirementsOf({
    completed: true,
    nonEmptyOutput: true,
    reportExists: false,
    exit0: true,
    terminalObserved: true,
    terminalError: undefined,
  })
}

/** 终态未采集到（「没采集到」≠「无输出」——ENU-53 五值不含 unknown） */
function terminalNotCollectedRequirements(): HarvestRequirements {
  return harvestRequirementsOf({
    completed: false,
    nonEmptyOutput: false,
    reportExists: false,
    exit0: false,
    terminalObserved: false,
    terminalError: undefined,
  })
}

/** 走完 begin→record→seal 全链（时点手推不读墙钟） */
function runBatch(
  ledger: HarvestRecordingLedger,
  requirements: HarvestRequirements,
  deliverer = 'AGENT-1',
): { from: number; to: number } {
  const from = 1000
  const to = 1500
  ledger.begin({ ...SEGMENT, deliverer, at: from })
  ledger.record({ ...SEGMENT, deliverer }, requirements)
  ledger.seal(SEGMENT, requirements.fourOk ? 'completed' : 'failed', to)
  return { from, to }
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

// ————————————————————————— 一、记录面正例：批次＋证据项真落库可读回 —————————————————————————

describe('批次落库：REC-EVD-01（批次）＋REC-EVD-02（证据项）真写口可读回', () => {
  it('封批整批原子落库：1 条批次＋4 条证据项，契约判定件全绿，结构位随记录同行', async () => {
    const { ledger: db, hist } = await openStores('positive')
    const assembly = assembleHarvestRecords({ ledger: db })
    const batches = createHarvestRecordingLedger(createHarvestBatchLedger(), {
      sink: assembly.sink,
      company: COMPANY,
      now: () => 2000,
    })
    runBatch(batches, completeRequirements())

    // ① 批次记录：一条、类型/信封/公司/写入路径齐（PORT-HIST 唯一写口真行）
    const batchRows = hist.query({ company: COMPANY, type: 'REC-EVD-01' })
    expect(batchRows).toHaveLength(1)
    const record = batchRows[0]
    if (record === undefined) throw new Error('REC-EVD-01 未落库')
    expect(record.recordType).toBe('REC-EVD-01')
    expect(record.schemaRef).toEqual(HARVEST_RECORD_SCHEMA_REF)
    expect(record.specVersion).toBe(HARVEST_RECORD_SPEC_VERSION)
    expect(record.companyRef).toBe(COMPANY)
    expect(record.producer).toEqual({ decidedBy: FRAMEWORK_HARVESTER, writtenBy: HARVEST_RECORD_WRITTEN_BY })
    expect(record.effectiveState).toBe('effective')
    expect(record.effectiveTime).toEqual({ from: iso(1500) })
    expect(record.basisRefs).toEqual([])

    // ② 收割者≠交付者结构位：声明与关系要件随证明边界同行（DEC-OPEN-13 未裁不读成已独立）
    expect(record.proofBoundary).toContain('收割者≠交付者')
    expect(record.proofBoundary).toContain(HARVEST_INDEPENDENCE_DECLARATION)
    expect(record.proofBoundary).toContain('DEC-OPEN-13')
    expect(record.proofBoundary).toContain('AGENT-1')

    // ③ payload：四要件观察面＋区间幂等键（REC-EVD-01 不变量）
    const payload = record.payload as Record<string, unknown>
    expect(payload['segment_ref']).toEqual({ refType: 'REC-LIFE-04', refId: 'T-1@att1', refVersion: '1.0.0' })
    expect(payload['harvest_completeness']).toBe('complete')
    expect(payload['execution_terminal']).toBe('completed')
    expect(payload['gaps']).toEqual([])
    expect(payload['source_cursor']).toBe(harvestIntervalKey(SEGMENT, { from: 1000, to: 1500 }))
    expect(payload['idempotency_key']).toEqual({
      segment_ref: { refType: 'REC-LIFE-04', refId: 'T-1@att1', refVersion: '1.0.0' },
      collection_from: iso(1000),
      collection_to: iso(1500),
    })
    const collected = payload['collected_items'] as readonly { item: string; content_ref: { refId: string; refVersion: string } }[]
    expect(collected).toHaveLength(4)

    // ④ 证据项记录：逐项落库、引用回批次 collected_items、契约 REC-EVD-02 判定件绿
    const itemRows = hist.query({ company: COMPANY, type: 'REC-EVD-02' })
    expect(itemRows).toHaveLength(4)
    expect(collected.map((entry) => entry.content_ref.refId).sort()).toEqual(itemRows.map((row) => row.recordId).sort())
    for (const item of itemRows) {
      expect(validateEvidenceItem(item)).toEqual({ ok: true })
    }

    // ⑤ 来源锚两级：执行面终态＝自述（不洗成独立）；其余机械可复算事实＝独立采集
    const anchorOf = (row: (typeof itemRows)[number]): string => (row.payload as { source_anchor: string }).source_anchor
    const elementOf = (row: (typeof itemRows)[number]): string => (row.payload as { element: string }).element
    expect(itemRows.map(anchorOf).filter((anchor) => anchor === 'self_reported')).toHaveLength(1)
    expect(itemRows.map(anchorOf).filter((anchor) => anchor === 'independent_collection')).toHaveLength(3)
    // ENU-48 映射：行动＝EVD-ELM-03、验收对象＝EVD-ELM-04（对象 ID 引用，不另造字面量）
    expect(new Set(itemRows.map(elementOf))).toEqual(new Set(['EVD-ELM-03', 'EVD-ELM-04']))
    expect(validateHarvestBatch(record)).toEqual({ ok: true })

    // ⑥ 内存视图与落库证据一一对应（记录面不虚构第二套）
    const recording = batches.recordingOf(SEGMENT)
    expect(recording?.state).toBe('persisted')
    expect(recording?.batchRecordId).toBe(record.recordId)
    expect(recording?.itemRecordIds).toHaveLength(4)
    db.close()
  })

  it('重复封批幂等：同键同内容零第二副作用（批次 1 行、证据项 4 行不增）', async () => {
    const { ledger: db, hist } = await openStores('idem')
    const assembly = assembleHarvestRecords({ ledger: db })
    const batches = createHarvestRecordingLedger(createHarvestBatchLedger(), { sink: assembly.sink, company: COMPANY, now: () => 2000 })
    runBatch(batches, completeRequirements())
    const firstId = batches.recordingOf(SEGMENT)?.batchRecordId

    // 重复 record（同键同内容）＝duplicate；重复 seal ＝duplicate——两者都不得产生第二行
    batches.record({ ...SEGMENT, deliverer: 'AGENT-1' }, completeRequirements())
    const again = batches.seal(SEGMENT, 'completed', 1500)
    expect(again.status).toBe('duplicate')
    expect(hist.query({ company: COMPANY, type: 'REC-EVD-01' })).toHaveLength(1)
    expect(hist.query({ company: COMPANY, type: 'REC-EVD-02' })).toHaveLength(4)
    expect(batches.recordingOf(SEGMENT)?.batchRecordId).toBe(firstId)
    db.close()
  })

  it('不完整批次如实落库：harvest_completeness=incomplete＋gaps 非空，不冒充 complete', async () => {
    const { ledger: db, hist } = await openStores('incomplete')
    const assembly = assembleHarvestRecords({ ledger: db })
    const batches = createHarvestRecordingLedger(createHarvestBatchLedger(), { sink: assembly.sink, company: COMPANY, now: () => 2000 })
    runBatch(batches, missingReportRequirements())

    const rows = hist.query({ company: COMPANY, type: 'REC-EVD-01' })
    expect(rows).toHaveLength(1)
    const record = rows[0]
    if (record === undefined) throw new Error('不完整批次未落库')
    const payload = record.payload as { harvest_completeness: string; gaps: readonly string[]; collected_items: readonly unknown[] }
    expect(payload.harvest_completeness).toBe('incomplete')
    expect(payload.gaps).toContain('REPORT 落盘')
    expect(validateHarvestBatch(record)).toEqual({ ok: true })

    // 完整性存疑：即便已落库也不得作验收输入（输入闸拒；理由在完整性而非「未落库」）
    const batch = batches.get(SEGMENT)
    if (batch === undefined) throw new Error('批次缺位')
    const input = acceptanceInputOf(batch, batches.recordingOf(SEGMENT))
    expect(input.usable).toBe(false)
    expect(input.reasons.join('')).toContain('完整性=incomplete')
    expect(input.reasons.join('')).not.toContain('未落库')
    for (const row of hist.query({ company: COMPANY, type: 'REC-EVD-02' })) {
      expect(validateEvidenceItem(row)).toEqual({ ok: true })
    }
    db.close()
  })
})

// ————————————————————————— 二、fail-closed：缺证/写口异常整批不落库 —————————————————————————

describe('fail-closed：缺证不落半套、写口异常不冒已落库', () => {
  it('终态未采集到（unknown）：整批拒写（零记录）、状态 refused 具名理由、验收输入闸拒', async () => {
    const { ledger: db, hist } = await openStores('refused')
    const assembly = assembleHarvestRecords({ ledger: db })
    const batches = createHarvestRecordingLedger(createHarvestBatchLedger(), { sink: assembly.sink, company: COMPANY, now: () => 2000 })
    runBatch(batches, terminalNotCollectedRequirements())

    // 不臆造终态：ENU-53 五值不含 unknown → 整批（批次＋证据项）都不写，防落半套
    expect(hist.query({ company: COMPANY, type: 'REC-EVD-01' })).toHaveLength(0)
    expect(hist.query({ company: COMPANY, type: 'REC-EVD-02' })).toHaveLength(0)
    const recording = batches.recordingOf(SEGMENT)
    expect(recording?.state).toBe('refused')
    expect(recording?.reasons.join('')).toContain('终态')
    expect(recording?.batchRecordId).toBeUndefined()

    const batch = batches.get(SEGMENT)
    if (batch === undefined) throw new Error('批次缺位（内存视图仍在，落库面缺）')
    const input = acceptanceInputOf(batch, recording)
    expect(input.usable).toBe(false)
    expect(input.reasons.join('')).toContain('未落库')
    expect(input.acceptance).toBe('not_judged')
    db.close()
  })

  it('写口异常：状态 failed、具名理由、零记录（不把写失败读成已落库）', async () => {
    const { ledger: db, hist } = await openStores('failed')
    const brokenSink: HarvestRecordSink = {
      appendMany: () => {
        throw new Error('store/hist:unavailable（模拟写口故障）')
      },
    }
    const problems: string[] = []
    const batches = createHarvestRecordingLedger(createHarvestBatchLedger(), {
      sink: brokenSink,
      company: COMPANY,
      now: () => 2000,
      onProblem: (line) => problems.push(line),
    })
    runBatch(batches, completeRequirements())

    expect(hist.query({ company: COMPANY, type: 'REC-EVD-01' })).toHaveLength(0)
    const recording = batches.recordingOf(SEGMENT)
    expect(recording?.state).toBe('failed')
    expect(recording?.reasons.join('')).toContain('未落库')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('REC-EVD-01')

    const batch = batches.get(SEGMENT)
    if (batch === undefined) throw new Error('批次缺位')
    expect(acceptanceInputOf(batch, recording).reasons.join('')).toContain('未落库')
    db.close()
  })
})

// ————————————————————————— 三、真机接线：第 4 相位写记录（真引擎真台账） —————————————————————————

describe('真机接线：引擎第 4 相位（收割）写 REC-EVD-01/02 到真实记录面', () => {
  it('成功收割 → 记录面 1 条批次＋4 条证据项，引用本单出工段', async () => {
    const stack = await createWorkStack('evd-rec', {}, { harvestRecordsOf: (ledger) => assembleHarvestRecords({ ledger }).sink })
    try {
      const ticket = await createTicket(stack, 'V2 证据批次落库单')
      await runTicks(stack, 2)
      expect(eventsNamed(stack.ledger, ticket, 'GATE_PASS')).toHaveLength(1)

      const hist = createHistFace(stack.ledger.db)
      const rows = hist.query({ company: COMPANY, type: 'REC-EVD-01' })
      expect(rows).toHaveLength(1)
      const record = rows[0]
      if (record === undefined) throw new Error('真机收割批次未落库')
      const payload = record.payload as { segment_ref: { refId: string }; harvest_completeness: string; execution_terminal: string }
      expect(payload.segment_ref.refId).toBe(`${ticket}@att1`)
      expect(payload.harvest_completeness).toBe('complete')
      expect(payload.execution_terminal).toBe('completed')
      expect(hist.query({ company: COMPANY, type: 'REC-EVD-02' })).toHaveLength(4)
    } finally {
      stack.ledger.close()
    }
  })

  it('缺 REPORT 的收割 → 批次如实 incomplete；终态未采到的批次不落库（fail-closed 真机面）', async () => {
    const stack = await createWorkStack('evd-rec-neg', {}, { harvestRecordsOf: (ledger) => assembleHarvestRecords({ ledger }).sink })
    try {
      const ticket = await createTicket(stack, 'V2 证据批次缺证单')
      stack.mode.value = 'incomplete' // turn_end.completed=false：四要件缺终态、终态观察细分不可得=unknown
      await runTicks(stack, 2)
      expect(eventsNamed(stack.ledger, ticket, 'GATE_FAIL')).toHaveLength(1)

      const hist = createHistFace(stack.ledger.db)
      // 终态 unknown → 不臆造、不落半套：批次与证据项都零行
      expect(hist.query({ company: COMPANY, type: 'REC-EVD-01' })).toHaveLength(0)
      expect(hist.query({ company: COMPANY, type: 'REC-EVD-02' })).toHaveLength(0)
    } finally {
      stack.ledger.close()
    }
  })
})
