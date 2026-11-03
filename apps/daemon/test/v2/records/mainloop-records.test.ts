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
import type { ReadContext } from '@studio-next/contract'
import { createHistFace, type Ledger } from '@studio-next/store'
import {
  BLOCKED_RECORD_FAMILIES,
  UNBLOCKED_RECORD_FAMILIES,
  PLATFORM_STATES,
  PLATFORM_TO_WORK_STATE,
  PLATFORM_COMPOSITE_EDGES,
  assertStateMapComplete,
  blockedDraftFor,
  buildEnvelope,
  createRecordWire,
  reconcileProjection,
  workEdgeOf,
  workEdgesOf,
  workIntakeDraft,
  workTransitionDrafts,
  type RecordWire,
} from '../../../src/engine/records/index.ts'
import { createTicket, createWorkStack, disposeWorkStacks, eventsOf, runTicks, type WorkTestStack } from './fixtures/work-stack.ts'

afterAll(async () => {
  await disposeWorkStacks()
})

const COMPANY = 'demo'
/** 读上下文（v2/14 §0.2-1：读方法必带；公司维=被测公司，两槽同填——V2 身份表落位前同值） */
const READ_CTX: ReadContext = {
  readScope: { company: { companyId: COMPANY, slug: COMPANY }, fields: ['record.payload'], purpose: 'mainloop-records 测试读回' },
  caller: { callerId: 'AGENT-1', kind: 'employment', personId: 'AGENT-1' },
}

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

    const rows = histOf(stack.ledger).query({ company: COMPANY, type: 'REC-WORK-01' }, READ_CTX)
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

    const rows = histOf(stack.ledger).query({ company: COMPANY, type: 'REC-WORK-01' }, READ_CTX)
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
    expect(hist.query({ company: COMPANY }, READ_CTX)).toHaveLength(0)

    const allEvents = stack.ledger.queryEvents({})
    expect(allEvents.some((event) => event.event === 'DISPATCH' && event.issue === ticket)).toBe(true)
    const reconciled = reconcileProjection(hist.query({ company: COMPANY }, READ_CTX), allEvents)
    expect(reconciled.settled).toBe(false)
    expect(reconciled.differences.some((d: { kind: string; subjectId: string }) => d.kind === 'missing' && d.subjectId === ticket)).toBe(true)
  })

  it('面开场景对账一致：REC-WORK-01 全量覆盖已派发单（settled=true）', async () => {
    const { stack } = await stackWithRecords('rec-settle')
    await createTicket(stack, '对账单')
    await runTicks(stack, 2)
    const hist = histOf(stack.ledger)
    const reconciled = reconcileProjection(hist.query({ company: COMPANY }, READ_CTX), stack.ledger.queryEvents({}))
    expect(reconciled.settled).toBe(true)
    expect(reconciled.differences).toEqual([])
  })
})

describe('决定型记录前置闸（拒写不臆造）', () => {
  it('REC-WORK-06：已派发→证据就绪（M-10）缺 REC-WORK-08/REC-EVD-03 → 拒写', async () => {
    const outcome = workTransitionDrafts({
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
    const rows = histOf(stack.ledger).query({ company: COMPANY, type: 'REC-WORK-06' }, READ_CTX)
    expect(rows).toHaveLength(0)
  })

  it('回退边（已交付→已派发）不在 §14.1 边集 → 拒写（不冒充迁移）', async () => {
    const outcome = workTransitionDrafts({
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

  it('刀D 三族：写面已解除阻断（UNBLOCKED 留表），前置不齐仍逐族拒写（§七/§八/§十）', () => {
    for (const recordType of ['REC-ACC-01', 'REC-CHG-01', 'REC-REV-01'] as const) {
      expect(UNBLOCKED_RECORD_FAMILIES[recordType]).toBeDefined()
      expect(BLOCKED_RECORD_FAMILIES[recordType]).toBeUndefined()
      const outcome = blockedDraftFor(recordType)
      expect(outcome.ok).toBe(false)
      if (!outcome.ok) {
        expect(outcome.code).toBe('record-prereq-missing')
        expect(outcome.reason).toContain('写面已解除阻断')
        expect(outcome.reason).toContain(UNBLOCKED_RECORD_FAMILIES[recordType]!.gate)
      }
    }
    expect(UNBLOCKED_RECORD_FAMILIES['REC-ACC-01']?.ref).toBe('v2/11 §七')
    expect(UNBLOCKED_RECORD_FAMILIES['REC-CHG-01']?.ref).toBe('v2/11 §八/§14.4-2')
    expect(UNBLOCKED_RECORD_FAMILIES['REC-REV-01']?.ref).toBe('v2/11 §十')
  })
})

const DECISION = {
  decidedBy: 'PRIME-0',
  authorityRef: { refType: 'REC-AUTH-01', refId: 'rec-auth-01:demo:PRIME-0', refVersion: '1.0.0' },
  rationale: 'L0 直派：受理与开工在同一派发决定内完成（docs/17-§2 状态桥接）',
  basisRefs: [{ refType: 'REC-WORK-02', refId: 'rec-work-02:demo:DEMO-L0', refVersion: '1.0.0' }],
  scopeJudged: { judged: ['受理', '开工'], notJudged: ['验收', '结清'] },
  dissentPosition: '无异议',
  effectiveFrom: '2026-11-03T00:00:00.000Z',
} as const

const PREREQ_TYPES = ['REC-WORK-02', 'REC-WORK-03', 'REC-WORK-04', 'REC-WORK-05'] as const

/** 声明式前置引用（测试用；引用存在性闸归 #560 missingRefsOf——本件只验路径/逐边门控） */
const PREREQ_REFS = PREREQ_TYPES.map((refType) => ({
  refType,
  refId: `${refType.toLowerCase()}:demo:DEMO-L0`,
  refVersion: '1.0.0',
}))

const L0_ARGS = {
  ticket: 'DEMO-L0',
  attempt: 1,
  fromPlatformState: PLATFORM_STATES.fresh,
  toPlatformState: PLATFORM_STATES.dispatched,
  at: Date.parse('2026-11-03T00:00:00.000Z'),
  actor: 'ENG-1',
  company: COMPANY,
} as const

describe('L0 直派复合路径（studio-dev-592：M-01→M-05 逐边登记，不新增边）', () => {
  it('跨态主干解析为既有边的有序复合路径（M-01→M-05），不是表外边', () => {
    const edges = workEdgesOf(PLATFORM_STATES.fresh, PLATFORM_STATES.dispatched)
    expect(edges.map((edge) => edge.edge)).toEqual(['M-01', 'M-05'])
    expect(edges[0]?.from).toBe('intake')
    expect(edges[0]?.to).toBe('pending_start')
    expect(edges[1]?.from).toBe('pending_start')
    expect(edges[1]?.to).toBe('in_progress')
    expect(PLATFORM_COMPOSITE_EDGES[`${PLATFORM_STATES.fresh}→${PLATFORM_STATES.dispatched}`]).toEqual(['M-01', 'M-05'])
  })

  it('红：无逐边前置 → 整条路径拒写，拒因逐边点名（不再「无对应边」）', () => {
    const outcome = workTransitionDrafts(L0_ARGS)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.reason).toContain('复合路径 M-01→M-05')
      expect(outcome.reason).toContain('REC-WORK-02')
      expect(outcome.reason).toContain('REC-WORK-04')
      expect(outcome.reason).not.toContain('无对应边')
    }
  })

  it('红：只补 M-01 前置（02/03）→ M-05 缺 04/05，整条路径仍拒写（不写半条）', () => {
    const outcome = workTransitionDrafts({ ...L0_ARGS, evidenceRefs: PREREQ_REFS.slice(0, 2), decision: DECISION })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.reason).toContain('边 M-05')
      expect(outcome.reason).toContain('REC-WORK-04')
      expect(outcome.reason).toContain('REC-WORK-05')
      expect(outcome.reason).toContain('不写半条')
    }
  })

  it('绿：逐边前置齐＋决定面齐 → 两条草案 M-01/M-05（生产者三分按 §14.1）', () => {
    const outcome = workTransitionDrafts({ ...L0_ARGS, evidenceRefs: PREREQ_REFS, decision: DECISION })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.drafts.map((draft) => draft.recordId.split(':').at(-1))).toEqual(['M-01', 'M-05'])
    const [m01, m05] = outcome.drafts
    const p01 = m01?.payload as { producer_type: string; evidence_refs: { refType: string }[]; from_state: string; to_state: string }
    const p05 = m05?.payload as { producer_type: string; evidence_refs: { refType: string }[]; from_state: string; to_state: string }
    expect(p01.producer_type).toBe('decisive')
    expect(p05.producer_type).toBe('initiator')
    expect(p01.evidence_refs.map((ref) => ref.refType)).toEqual(['REC-WORK-02', 'REC-WORK-03'])
    expect(p05.evidence_refs.map((ref) => ref.refType)).toEqual(['REC-WORK-04', 'REC-WORK-05'])
    expect([p01.from_state, p01.to_state]).toEqual(['intake', 'pending_start'])
    expect([p05.from_state, p05.to_state]).toEqual(['pending_start', 'in_progress'])
  })

  it('绿：写面按路径落两行 REC-WORK-06（边号区分、重放幂等零第二副作用）', async () => {
    const { stack } = await stackWithRecords('rec-l0-path')
    const hist = histOf(stack.ledger)
    const wire = createRecordWire({ hist, company: COMPANY })
    const args = { ticket: L0_ARGS.ticket, attempt: L0_ARGS.attempt, fromState: L0_ARGS.fromPlatformState, toState: L0_ARGS.toPlatformState, at: L0_ARGS.at, actor: L0_ARGS.actor, evidenceRefs: PREREQ_REFS, decision: DECISION }
    const first = wire.transition(args)
    expect(first.ok).toBe(true)
    const rows = hist.query({ company: COMPANY, type: 'REC-WORK-06' }, READ_CTX)
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.recordId.split(':').at(-1)).sort()).toEqual(['M-01', 'M-05'])
    const replay = wire.transition(args)
    expect(replay.ok).toBe(true)
    if (replay.ok) expect(replay.deduped).toBe(true)
    expect(hist.query({ company: COMPANY, type: 'REC-WORK-06' }, READ_CTX)).toHaveLength(2)
  })

  it('红：非法回退仍拒写且留痕（日志明报表外边＋合法出口，零行）', async () => {
    const { stack } = await stackWithRecords('rec-l0-red')
    const logs: string[] = []
    const wire = createRecordWire({ hist: histOf(stack.ledger), company: COMPANY, log: (line) => logs.push(line) })
    const result = wire.transition({
      ticket: L0_ARGS.ticket,
      attempt: L0_ARGS.attempt,
      at: L0_ARGS.at,
      actor: L0_ARGS.actor,
      fromState: PLATFORM_STATES.delivered,
      toState: PLATFORM_STATES.dispatched,
      evidenceRefs: PREREQ_REFS,
      decision: DECISION,
    })
    expect(result.ok).toBe(false)
    expect(logs.some((line) => line.includes('拒写 REC-WORK-06') && line.includes('无对应边') && line.includes('合法出口'))).toBe(true)
    expect(histOf(stack.ledger).query({ company: COMPANY, type: 'REC-WORK-06' }, READ_CTX)).toHaveLength(0)
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
