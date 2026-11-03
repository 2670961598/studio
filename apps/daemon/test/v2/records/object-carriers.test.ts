/**
 * 五对象记录载体生产写面（studio-dev-537）——定向红→绿套件
 *
 * 依据：docs/17-§2（相位 4 收割）、docs/17-§6（收割四要件）；docs/v2/05 §三，v2/11 §七/§八/§十；
 *       docs/v2/17 §六.2（NEG-REC-06/07/09）；本单验收②定向红→绿。
 *
 * 面：真 SQLite 台账（openLedger，tmp 目录）+ 真 HIST 写口（createHistFace）——不 mock 记录面。
 * 每个用例独立库；afterAll 整根删除。红面=写口未接（records 0 行）/ 缺证/缺位置；
 * 绿面=五类记录落库、幂等重放零第二行、拒绝不落半条。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createHistFace, openLedger, type HistFace, type Ledger } from '@studio-next/store'
import {
  createObjectRecordWire,
  type ObjectRecordPositions,
  type ObjectRecordWire,
} from '../../../src/engine/records/object-wire.ts'
import { carrierEnvelope, type ObjectCarrierMeta } from '../../../src/engine/records/object-carriers.ts'
import type {
  AccountabilityCasePayload,
  ChangeSegmentPayload,
  RecordRef,
  RemedyDecisionPayload,
  ReviewPayload,
  StructuralEvaluationPayload,
} from '@studio-next/contract/records'

const AT = '2026-11-03T00:00:00.000Z'
const AT_LATER = '2026-11-04T00:00:00.000Z'

const roots: string[] = []
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

interface Face {
  readonly ledger: Ledger
  readonly hist: HistFace
  readonly wire: ObjectRecordWire
  readonly logs: string[]
}

async function makeFace(positions: ObjectRecordPositions = { accountabilityArbiter: 'QA-3', arbiterControlBasisRef: workRef() }): Promise<Face> {
  const root = await mkdtemp(path.join(tmpdir(), 'sn-obj-537-'))
  roots.push(root)
  const ledger = openLedger(path.join(root, 'ledger.sqlite'))
  const hist = createHistFace(ledger.db)
  const logs: string[] = []
  const wire = createObjectRecordWire({ hist, company: 'demo', now: () => Date.parse(AT), positions, log: (line) => logs.push(line) })
  return { ledger, hist, wire, logs }
}

/** 记录引用（供 payload 槽位；含真实落库的 REC-WORK-01 为主证据） */
function workRef(): RecordRef {
  return { refType: 'REC-WORK-01', refId: 'rec-work-01:demo:T-1', refVersion: '1.0.0' }
}

/** 种子：REC-WORK-01（#527 记录族写面产物；本单只消费不生产） */
function seedWorkRecord(hist: HistFace): RecordRef {
  hist.append({
    recordId: 'rec-work-01:demo:T-1',
    recordType: 'REC-WORK-01',
    schemaRef: { schemaId: 'studio-next.records.v2', schemaVersion: '1.0.0' },
    specVersion: '2.0.0',
    companyRef: 'demo',
    producedAt: AT,
    producer: { decidedBy: 'AGENT-1', writtenBy: 'test:seed' },
    basisRefs: [],
    payload: {
      raw_content: '种子工单',
      source: 'platform.activity',
      identity_mapping: 'demo#T-1',
      authenticity_state: 'verified',
      received_at: AT,
      intake_owner: 'AGENT-1',
      intake_deadline: AT_LATER,
      known_constraints: [],
      requested_state: 'intake',
    },
    effectiveState: 'effective',
    effectiveTime: { from: AT },
    idempotencyKey: { companyRef: 'demo', recordType: 'REC-WORK-01', subjectId: 'T-1', operationClass: 'intake', requesterSequence: '1' },
  })
  return workRef()
}

function meta(subjectId: string, operationClass: string, decidedBy = 'QA-3'): ObjectCarrierMeta {
  return { company: 'demo', subjectId, operationClass, requesterSequence: '1', producedAt: AT, decidedBy, writtenBy: 'test:object-wire' }
}

function decisionFace(decidedBy = 'QA-3'): Record<string, unknown> {
  return {
    decided_by: decidedBy,
    authority_ref: workRef(),
    rationale: '依据已落库记录作出',
    basis_refs: [workRef()],
    scope_judged: { judged: ['本事项'], not_judged: ['本事项之外'] },
    dissent_position: '无异议',
    effective_state: 'effective',
    effective_time: AT,
  }
}

function accCasePayload(): AccountabilityCasePayload {
  return {
    subject_ref: workRef(),
    matter_refs: [workRef()],
    inquiry_materials: { allegations: ['收割四要件未齐'], explanations: [], adverse_information: [], silence_treated_as_report_exception: true },
    defense_window: { deadline: AT_LATER, overdue_disposition: '逾期按报告异常处理' },
    arbiter: { verified_by: 'QA-3', control_basis_ref: workRef() },
    conclusion: 'attribution_undetermined',
    consequence_routing: {},
    dissent_position: '书面异议',
    proof_boundary: '只证明开案与程序位；不证明责任成立',
  }
}

function remedyPayload(): RemedyDecisionPayload {
  return {
    case_ref: workRef(),
    remedy_kind: 'independent_re_review',
    beneficiaries: [{ beneficiary_ref: { refId: 'AGENT-1', refVersion: '1.0.0' }, application_entry: 'ticket' }],
    executor: { refId: 'QA-3', refVersion: '1.0.0' },
    execution_evidence: [workRef()],
    settlement_confirmation: { settled: false, confirmed_by: null, confirmed_at: null },
    non_compensable_boundary: '不可补偿损害不因结算消灭',
    affected_party_channel: 'ticket 评论',
    dissent_position: '无异议',
    decision_face: decisionFace() as RemedyDecisionPayload['decision_face'],
    proof_boundary: '证明救济决定与未结清状态',
  }
}

function changePayload(): ChangeSegmentPayload {
  return {
    chain_id: 'chain-1',
    segment: 'activation_approval',
    subject: { refId: 'asset-1', refVersion: '1.0.0' },
    subject_kind: 'config',
    decided_by: 'QA-3',
    authority_ref: workRef(),
    basis_refs: [workRef()],
    impact_assessment: { tasks: [], information: [], permissions: [], commitments: [], evidence: [], qualifications: [], in_flight_side_effects: [] },
    criteria_version: '1.0.0',
    no_override: true,
    rollback_path: { stop_conditions: ['退化'], monitoring: ['探针'], rollback_steps: ['回滚字节'] },
    dissent_position: '无异议',
    effective_state: 'effective',
    effective_time: AT,
  }
}

function reviewPayload(): ReviewPayload {
  return {
    scope: { matters: [workRef()], window: { from: AT, to: AT_LATER } },
    inputs: {
      acceptance_refs: [],
      cost_account_ref: workRef(),
      counterparty_feedback: [],
      affected_party_feedback: [],
      contrary_examples: [],
      unfulfilled_commitments: [],
    },
    findings: [{ finding: '根因=流程缺口', basis_refs: [workRef()] }],
    outputs: { personal_experience_refs: [], method_rule_candidates: [], structural_issues: [] },
    independence: { decided_by: 'QA-3', independence_note: '复盘位置独立于交付方' },
    dissent_position: '书面异议',
    decision_face: decisionFace() as ReviewPayload['decision_face'],
  }
}

function evalPayload(): StructuralEvaluationPayload {
  return {
    object: { kind: 'department', ref: { refId: 'departments/工程部', refVersion: '1.0.0' } },
    criteria: {
      existence_reason: '存在理由',
      cost: '成本',
      vacancy_state: '空编',
      coordination_failure_masking: '不以新增层级掩盖',
      overall_resource_trend: '持平',
    },
    inputs: { org_performance_basis: [workRef()], resource_account_ref: workRef(), exception_trend_refs: [] },
    conclusion: 'maintain',
    decision_routing: { decision_body: '制作人', procedure_ref: workRef() },
    dissent_position: '无异议',
    decision_face: decisionFace() as StructuralEvaluationPayload['decision_face'],
  }
}

/** GATE_FAIL 事件（相位 4 收割失败真事件形状；contract 闸在 ledger.appendEvent） */
function appendGateFail(ledger: Ledger, ticket = 'T-1'): void {
  ledger.appendEvent({
    id: '01HQ0000000000000000000537',
    ts: Date.parse(AT),
    company: 'demo',
    issue: ticket,
    event: 'GATE_FAIL',
    actor: 'AGENT-1',
    attempt: 1,
    level: 2,
    dept: 'departments/工程部',
    tokens: { input: 0 },
    note: '四要件未齐：REPORT 缺失；exit=1',
  })
}

describe('五对象记录载体·生产写口（绿）', () => {
  it('五类载体均落 records 表（真 SQLite；observe 计数=1/1/1/1/1）', async () => {
    const face = await makeFace()
    seedWorkRecord(face.hist)
    expect(face.wire.openAccountabilityCase(meta('T-1', 'acc-case-open'), accCasePayload()).ok).toBe(true)
    expect(face.wire.decideRemedy(meta('T-1', 'acc-remedy'), remedyPayload()).ok).toBe(true)
    expect(face.wire.recordChangeSegment(meta('cand-1', 'chg-activation'), changePayload(), { previousSegment: 'independent_verification' }).ok).toBe(true)
    expect(face.wire.recordReview(meta('T-1', 'review'), reviewPayload()).ok).toBe(true)
    expect(face.wire.recordStructuralEvaluation(meta('departments/工程部', 'eval'), evalPayload()).ok).toBe(true)
    const observed = face.wire.observe()
    expect(observed.counts).toEqual({ 'REC-ACC-01': 1, 'REC-ACC-02': 1, 'REC-CHG-01': 1, 'REC-REV-01': 1, 'REC-EVAL-01': 1 })
    expect(observed.differences).toBe(0)
  })

  it('幂等重放：同 recordId/幂等键同内容=返回既有、零第二行（§0.4-4）', async () => {
    const face = await makeFace()
    seedWorkRecord(face.hist)
    expect(face.wire.recordReview(meta('T-1', 'review'), reviewPayload()).ok).toBe(true)
    const replay = face.wire.recordReview(meta('T-1', 'review'), reviewPayload())
    expect(replay.ok && replay.ref.appended).toBe(false)
    expect(face.hist.query({ company: 'demo', type: 'REC-REV-01' })).toHaveLength(1)
  })

  it('相位 4 收割钩：GATE_FAIL → REC-ACC-01 开案（独立裁判位置在场）', async () => {
    const face = await makeFace()
    seedWorkRecord(face.hist)
    appendGateFail(face.ledger)
    const outcome = face.wire.afterHarvest(face.ledger, { ticket: 'T-1', attempt: 1, outcome: 'failed', personId: 'AGENT-1' })
    expect(outcome.status).toBe('written')
    const rows = face.hist.query({ company: 'demo', type: 'REC-ACC-01' })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.payload).toMatchObject({ conclusion: 'attribution_undetermined' })
    // 重放（同 attempt）零第二行
    expect(face.wire.afterHarvest(face.ledger, { ticket: 'T-1', attempt: 1, outcome: 'failed', personId: 'AGENT-1' }).status).toBe('written')
    expect(face.hist.query({ company: 'demo', type: 'REC-ACC-01' })).toHaveLength(1)
  })

  it('收割完成（completed）=零对象载体：不由收割面代作复盘/评价（不伪造决定者）', async () => {
    const face = await makeFace()
    const outcome = face.wire.afterHarvest(face.ledger, { ticket: 'T-1', attempt: 1, outcome: 'completed', personId: 'AGENT-1' })
    expect(outcome).toEqual({ status: 'skipped', reason: 'completed（复盘/评价不由收割面代作——不伪造决定者）' })
    expect(face.hist.query({ company: 'demo' })).toHaveLength(0)
  })
})

describe('五对象记录载体·fail-closed（红）', () => {
  it('形状闸：payload 缺必填字段 → 拒写、records 零行', async () => {
    const face = await makeFace()
    seedWorkRecord(face.hist)
    const broken = { ...accCasePayload(), subject_ref: undefined } as unknown as AccountabilityCasePayload
    const outcome = face.wire.openAccountabilityCase(meta('T-1', 'acc-case-open'), broken)
    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? '' : outcome.code).toBe('shape-refused')
    expect(face.hist.query({ company: 'demo', type: 'REC-ACC-01' })).toHaveLength(0)
  })

  it('不变量闸：诱导「段不可跳」→ 拒写、records 零行（§八 段序）', async () => {
    const face = await makeFace()
    seedWorkRecord(face.hist)
    const outcome = face.wire.recordChangeSegment(meta('cand-1', 'chg-activation'), changePayload(), { previousSegment: 'candidate' })
    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? '' : outcome.code).toBe('shape-refused')
    expect(face.hist.query({ company: 'demo', type: 'REC-CHG-01' })).toHaveLength(0)
  })

  it('证据闭包：引用未落库记录 → 拒写（不造悬空引用；依赖 #527 先落）', async () => {
    const face = await makeFace() // 不种子 REC-WORK-01
    const outcome = face.wire.recordReview(meta('T-1', 'review'), reviewPayload())
    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? '' : outcome.code).toBe('evidence-missing')
    expect(face.hist.query({ company: 'demo' })).toHaveLength(0)
  })

  it('独立位置缺位：afterHarvest 拒绝以 daemon 冒充裁判（position-missing）', async () => {
    const face = await makeFace({})
    seedWorkRecord(face.hist)
    appendGateFail(face.ledger)
    const outcome = face.wire.afterHarvest(face.ledger, { ticket: 'T-1', attempt: 1, outcome: 'failed', personId: 'AGENT-1' })
    expect(outcome).toEqual({ status: 'refused', code: 'position-missing', detail: '独立裁判位置/控制依据引用未配置（OBJECT positions）——问责载体不开面' })
    expect(face.hist.query({ company: 'demo', type: 'REC-ACC-01' })).toHaveLength(0)
  })

  it('无 GATE_FAIL 事件：拒写（不凭猜测开案）', async () => {
    const face = await makeFace()
    seedWorkRecord(face.hist)
    const outcome = face.wire.afterHarvest(face.ledger, { ticket: 'T-1', attempt: 1, outcome: 'failed', personId: 'AGENT-1' })
    expect(outcome.status).toBe('refused')
    expect(face.hist.query({ company: 'demo', type: 'REC-ACC-01' })).toHaveLength(0)
  })

  it('面关对照（红基线）：未接写口=records 零行；接写口=对应行出现（同一真库）', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sn-obj-red-'))
    roots.push(root)
    const ledger = openLedger(path.join(root, 'ledger.sqlite'))
    const hist = createHistFace(ledger.db)
    seedWorkRecord(hist)
    appendGateFail(ledger)
    // 红：无写口 —— records 只有种子行
    expect(hist.query({ company: 'demo', type: 'REC-ACC-01' })).toHaveLength(0)
    // 绿：接生产装配面（同 afterHarvest 调用面）
    const wire = createObjectRecordWire({ hist, company: 'demo', now: () => Date.parse(AT), positions: { accountabilityArbiter: 'QA-3', arbiterControlBasisRef: workRef() } })
    expect(wire.afterHarvest(ledger, { ticket: 'T-1', attempt: 1, outcome: 'failed', personId: 'AGENT-1' }).status).toBe('written')
    expect(hist.query({ company: 'demo', type: 'REC-ACC-01' })).toHaveLength(1)
  })

  it('信封元闸：决定者/写入者缺失 → 构造期抛错（不落半条）', () => {
    expect(() => carrierEnvelope('REC-REV-01', { ...meta('T-1', 'review'), decidedBy: ' ' }, reviewPayload())).toThrow(/decidedBy/)
  })
})
