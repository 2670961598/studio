/**
 * mainloop-records —— 主循环记录族生产写面接线（studio-dev-527）定向红→绿
 *
 * 依据：docs/17-§2「记录族生产写面」段（相位×记录类型×写入者映射表）；docs/17-§6（收割四要件
 * 不改判据）；docs/v2/11 §〇.2（请求型/决定型分型）／§0.4-4（重放零第二副作用）／§0.4-5（幂等
 * 五元组）／§5.2（WORK-06 边集前置记录）／§六（EVD-01 出工段）／§七/§八/§十（ACC/CHG/REV 前置链）。
 *
 * 用例纪律（V2 新套件）：真 SQLite 台账＋真引擎＋fake 外部端口（fixtures/work-stack.ts），
 * 不 mock 记录面；红例=面关（records 0 行＋对账报缺），绿例=面开（REC-WORK-01 落地、幂等、
 * 前置不齐拒写不臆造）。断言只认库内事实（sqlite 直查；非单测自证桩）。
 */
import { afterAll, describe, expect, it } from 'vitest'
import { createHistFace, type Ledger } from '@studio-next/store'
import {
  BLOCKED_RECORD_FAMILIES,
  PLATFORM_STATES,
  PLATFORM_TO_WORK_STATE,
  assertStateMapComplete,
  blockedDraftFor,
  buildEnvelope,
  createRecordWire,
  reconcileProjection,
  workEdgeOf,
  workIntakeDraft,
  workTransitionDraft,
  type RecordWire,
} from '../../../src/engine/records/index.ts'
import { createTicket, createWorkStack, disposeWorkStacks, eventsOf, runTicks, type WorkTestStack } from './fixtures/work-stack.ts'

afterAll(async () => {
  await disposeWorkStacks()
})

const COMPANY = 'demo'

/** 记录面读口（真表；与写面同一 db 句柄之外独立开 hist——读面不共享写面事务） */
function histOf(ledger: Ledger) {
  return createHistFace(ledger.db)
}

/** 建带记录写面的真栈 */
async function stackWithRecords(label: string): Promise<{ stack: WorkTestStack; wire: RecordWire }> {
  let wire: RecordWire | undefined
  const stack = await createWorkStack(label, {}, {
    recordsOf: ({ ledger, company }) => {
      wire = createRecordWire({ hist: histOf(ledger), company })
      return wire
    },
  })
  if (wire === undefined) throw new Error('recordsOf 未被夹具调用（夹具契约破坏）')
  return { stack, wire }
}

describe('记录族生产写面·相位 1（REC-WORK-01 意图信封；绿）', () => {
  it('一张单经采集拍→records 出现 REC-WORK-01 行，events 面仍完整（DISPATCH 照落）', async () => {
    const { stack } = await stackWithRecords('rec-intake')
    const ticket = await createTicket(stack, '记录写面单')
    await runTicks(stack, 2) // 拍1 采集写意图 → 拍2 派发

    const rows = histOf(stack.ledger).query({ company: COMPANY, type: 'REC-WORK-01' })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.idempotencyKey?.subjectId).toBe(ticket)
    expect(rows[0]?.producer?.writtenBy).toBe('daemon:engine/records')

    // events 保留为可重建投影：DISPATCH 仍照旧落账（记录写面不改事件写面语义）
    const events = eventsOf(stack.ledger, ticket)
    expect(events.some((event) => event.event === 'DISPATCH')).toBe(true)
    expect(events.length).toBeGreaterThan(0)
  })

  it('同 recordId 幂等：重放同单同内容→deduped、零第二行（§0.4-4）', async () => {
    const { stack, wire } = await stackWithRecords('rec-idem')
    const ticket = await createTicket(stack, '幂等单')
    await runTicks(stack, 2)
    const issue = await stack.platform.issues.get(ticket)

    const replay = wire.intake({ issue, at: Date.parse('2026-11-01T00:00:05.000Z'), actor: 'AGENT-1', source: 'test.replay' })
    expect(replay.ok).toBe(true)
    if (replay.ok) expect(replay.deduped).toBe(true)

    const rows = histOf(stack.ledger).query({ company: COMPANY, type: 'REC-WORK-01' })
    expect(rows).toHaveLength(1)
    expect(wire.counters.deduped).toBeGreaterThan(0)
  })
})

describe('记录族生产写面·面关对照（红）', () => {
  it('未注入写面（缺省）：records 0 行，且对账把「已派发单无意图信封」报成 missing', async () => {
    const stack = await createWorkStack('rec-off')
    const ticket = await createTicket(stack, '面关单')
    await runTicks(stack, 2)

    const hist = histOf(stack.ledger)
    expect(hist.query({ company: COMPANY })).toHaveLength(0)

    const allEvents = stack.ledger.queryEvents({})
    expect(allEvents.some((event) => event.event === 'DISPATCH' && event.issue === ticket)).toBe(true)
    const reconciled = reconcileProjection(hist.query({ company: COMPANY }), allEvents)
    expect(reconciled.settled).toBe(false)
    expect(reconciled.differences.some((d: { kind: string; subjectId: string }) => d.kind === 'missing' && d.subjectId === ticket)).toBe(true)
  })

  it('面开场景对账一致：REC-WORK-01 全量覆盖已派发单（settled=true）', async () => {
    const { stack } = await stackWithRecords('rec-settle')
    await createTicket(stack, '对账单')
    await runTicks(stack, 2)
    const hist = histOf(stack.ledger)
    const reconciled = reconcileProjection(hist.query({ company: COMPANY }), stack.ledger.queryEvents({}))
    expect(reconciled.settled).toBe(true)
    expect(reconciled.differences).toEqual([])
  })
})

describe('决定型记录前置闸（拒写不臆造）', () => {
  it('REC-WORK-06：已派发→证据就绪（M-10）缺 REC-WORK-08/REC-EVD-03 → 拒写', async () => {
    const outcome = workTransitionDraft({
      ticket: 'DEMO-1',
      attempt: 1,
      fromPlatformState: PLATFORM_STATES.dispatched,
      toPlatformState: PLATFORM_STATES.evidenceReady,
      at: Date.parse('2026-11-01T00:00:00.000Z'),
      actor: 'AGENT-1',
      company: COMPANY,
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.code).toBe('record-prereq-missing')
      expect(outcome.reason).toContain('REC-WORK-08')
      expect(outcome.reason).toContain('§14.1')
    }
  })

  it('写面同一闸：迁移拒写返回 refused 结果且 records 表零行', async () => {
    const { stack, wire } = await stackWithRecords('rec-refuse')
    await createTicket(stack, '拒写单')
    await runTicks(stack, 2) // 派发拍：REC-WORK-06 尝试写入但前置不齐

    expect(wire.counters.refused).toBeGreaterThan(0)
    const rows = histOf(stack.ledger).query({ company: COMPANY, type: 'REC-WORK-06' })
    expect(rows).toHaveLength(0)
  })

  it('回退边（已交付→已派发）不在 §14.1 边集 → 拒写（不冒充迁移）', async () => {
    const outcome = workTransitionDraft({
      ticket: 'DEMO-1',
      attempt: 1,
      fromPlatformState: PLATFORM_STATES.delivered,
      toPlatformState: PLATFORM_STATES.dispatched,
      at: Date.parse('2026-11-01T00:00:00.000Z'),
      actor: 'AGENT-1',
      company: COMPANY,
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('边集内无对应边')
    expect(workEdgeOf(PLATFORM_STATES.delivered, PLATFORM_STATES.dispatched)).toBeUndefined()
  })

  it('问责/变更/复盘三族：写面已接但前置链未注册 → 逐族拒写并给阻断件（§七/§八/§十）', () => {
    for (const recordType of ['REC-ACC-01', 'REC-CHG-01', 'REC-REV-01'] as const) {
      const outcome = blockedDraftFor(recordType)
      expect(outcome.ok).toBe(false)
      if (!outcome.ok) {
        expect(outcome.code).toBe('record-prereq-missing')
        expect(outcome.reason).toContain(BLOCKED_RECORD_FAMILIES[recordType]!.blocker)
      }
    }
    expect(BLOCKED_RECORD_FAMILIES['REC-ACC-01']?.ref).toBe('v2/11 §七')
    expect(BLOCKED_RECORD_FAMILIES['REC-CHG-01']?.ref).toBe('v2/11 §八')
    expect(BLOCKED_RECORD_FAMILIES['REC-REV-01']?.ref).toBe('v2/11 §十')
  })
})

describe('形状闸与状态桥接（契约面不改）', () => {
  it('REC-WORK-01 草案过 contract 形状闸；坏 payload（缺 intake_owner）被 path 级拒收', async () => {
    const { stack } = await stackWithRecords('rec-shape')
    const ticket = await createTicket(stack, '形状单')
    const issue = await stack.platform.issues.get(ticket)
    const good = workIntakeDraft({ issue, at: Date.parse('2026-11-01T00:00:00.000Z'), actor: 'AGENT-1', source: 'test', company: COMPANY })
    expect(good.ok).toBe(true)
    if (good.ok) {
      const built = buildEnvelope(good.draft, { company: COMPANY })
      expect(built.ok).toBe(true)
      const bad = { ...good.draft, payload: { raw_content: 'x' } }
      const rejected = buildEnvelope(bad, { company: COMPANY })
      expect(rejected.ok).toBe(false)
      if (!rejected.ok) {
        expect(rejected.code).toBe('record-shape-invalid')
        expect(rejected.issues.some((issue: { path: string }) => issue.path.startsWith('payload.'))).toBe(true)
      }
    }
  })

  it('状态桥接表：平台六态全覆盖、十态反查自检通过（漂移即硬错）', () => {
    expect(() => assertStateMapComplete()).not.toThrow()
    for (const state of Object.values(PLATFORM_STATES)) {
      expect(PLATFORM_TO_WORK_STATE[state]).toBeDefined()
    }
    // 核心桥接断言（docs/18-§2.1 ↔ v2/11 §14.1）：已派发=in_progress、证据就绪=awaiting_review
    expect(PLATFORM_TO_WORK_STATE[PLATFORM_STATES.dispatched]).toBe('in_progress')
    expect(PLATFORM_TO_WORK_STATE[PLATFORM_STATES.evidenceReady]).toBe('awaiting_review')
  })
})
