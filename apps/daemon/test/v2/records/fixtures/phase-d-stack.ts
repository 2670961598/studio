/**
 * phase-d-stack —— 刀D 记录族定向红→绿/进程级证据共用夹具（studio-dev-561）
 *
 * 依据：docs/17-§2「记录族生产写面」段·刀D；docs/v2/11 §5.2/§5.4/§六/§七/§八/§十/§十三。
 *
 * 纪律：真 SQLite 台账（openLedger）＋真 wire；只造**前置记录**（WORK-01/LIFE-01/MEM-03/EVD-04），
 * 不替断言。payload 字段全部按 contract 形状，族内不变量交 contract 判定件。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { IssueRecord } from '@studio-next/contract'
import { createHistFace, openLedger, type HistFace, type Ledger } from '@studio-next/store'
import {
  RECORD_SCHEMA_REF,
  RECORD_SPEC_VERSION,
  createRecordWire,
  type DraftRecordRef,
  type RecordChangeSegmentArgs,
  type RecordWire,
} from '../../../../src/engine/records/index.ts'

export const COMPANY = 'demo'
export const T0 = Date.parse('2026-11-03T00:00:00.000Z')

/** epoch-ms → 契约 timestamp */
export function iso(ms: number): string {
  return new Date(ms).toISOString()
}

/** 记录引用（refType/refId/refVersion） */
export function ref(type: string, id: string, version = '1.0.0'): DraftRecordRef {
  return { refType: type, refId: id, refVersion: version }
}

/** 真台账＋真写面（一用例一库） */
export interface PhaseDStack {
  readonly root: string
  readonly ledger: Ledger
  readonly hist: HistFace
  readonly wire: RecordWire
  readonly logs: readonly string[]
  cleanup(): Promise<void>
}

/** 建独立台账（写入同一 cwd 下的 tmp；调用方负责 cleanup） */
export async function createPhaseDStack(label: string): Promise<PhaseDStack> {
  const root = await mkdtemp(path.join(tmpdir(), `sn-phase-d-${label}-`))
  const ledger = openLedger(path.join(root, 'ledger.sqlite'))
  const hist = createHistFace(ledger.db)
  const logs: string[] = []
  const wire = createRecordWire({ hist, company: COMPANY, log: (line) => logs.push(line) })
  return {
    root,
    ledger,
    hist,
    wire,
    logs,
    cleanup: async () => {
      ledger.close()
      await rm(root, { recursive: true, force: true })
    },
  }
}

/** 打开指定路径的台账（进程级证据用；不建 tmp、不自动删） */
export function openPhaseDStack(dbPath: string): PhaseDStack {
  const ledger = openLedger(dbPath)
  const hist = createHistFace(ledger.db)
  const logs: string[] = []
  const wire = createRecordWire({ hist, company: COMPANY, log: (line) => logs.push(line) })
  return { root: path.dirname(dbPath), ledger, hist, wire, logs, cleanup: async () => ledger.close() }
}

/** 种一条 REC-WORK-01（意图信封）作为工作/合同引用 */
export function seedWork(wire: RecordWire): DraftRecordRef {
  const issue: IssueRecord = {
    id: 'DEMO-561',
    title: '刀D 记录族生产写面',
    state: 'new',
    updated: iso(T0),
  }
  const result = wire.intake({ issue, at: T0, actor: 'AGENT-1', source: 'test.phase-d' })
  if (!result.ok) throw new Error(`seed WORK-01 失败：${result.reason}`)
  return ref('REC-WORK-01', result.recordId)
}

/**
 * 种一条 REC-LIFE-01（任命）作为 ACC-01 的 subject_ref。
 * 只造形状合法的最小任命；任命判定/五条件核验归刀B，本夹具不冒充其结论。
 */
export function seedLife(hist: HistFace, auth: DraftRecordRef): DraftRecordRef {
  const at = iso(T0)
  const envelope = {
    recordId: 'rec-life-01:demo:AGENT-1',
    recordType: 'REC-LIFE-01',
    schemaRef: RECORD_SCHEMA_REF,
    specVersion: RECORD_SPEC_VERSION,
    companyRef: COMPANY,
    producedAt: at,
    producer: { decidedBy: 'AGENT-0', writtenBy: 'test:phase-d' },
    basisRefs: [],
    payload: {
      appointment_kind: 'appointment',
      position_ref: { refId: 'pos-1', refVersion: '1.0.0' },
      holder_ref: { refId: 'AGENT-1', refVersion: '1.0.0' },
      nomination_ref: auth,
      appointing_authority_ref: auth,
      decision_basis_ref: auth,
      scope: { duties: 'd', forbidden: [] },
      term: { from: at, to: iso(T0 + 86_400_000), expiry_disposition: 'retire' },
      qualification_refs: [],
      conflict_check_ref: ref('REC-LIFE-05', 'life5-1'),
      acceptance_state: 'accepted',
      entry_gate_results: {
        authority: { satisfied: true },
        qualification: { satisfied: true },
        conflict: { satisfied: true },
        handover: { satisfied: true },
        acceptance: { satisfied: true },
      },
      idempotency_four_tuple: {
        position_ref: { refId: 'pos-1', refVersion: '1.0.0' },
        holder_ref: { refId: 'AGENT-1', refVersion: '1.0.0' },
        term_start: at,
        proposed_version: '1.0.0',
      },
      decision_face: {
        decided_by: 'AGENT-0',
        authority_ref: auth,
        rationale: 'seed',
        basis_refs: [auth],
        scope_judged: { judged: ['appointment'], not_judged: [] },
        dissent_position: '无异议',
        effective_state: 'effective',
        effective_time: at,
      },
    },
    effectiveState: 'effective',
    effectiveTime: { from: at },
    proofBoundary: '夹具：仅证明任职记录形状合法，不证明任命程序与五条件结论（归刀B）。',
  }
  const appended = hist.append(envelope)
  return ref('REC-LIFE-01', appended.recordId)
}

/** 前置件：MEM-03 分流凭证＋EVD-04 价值评估（按相位顺序写） */
export function seedPrereqs(wire: RecordWire, work: DraftRecordRef): { memory: DraftRecordRef; value: DraftRecordRef } {
  const auth = ref('REC-AUTH-01', 'auth-1')
  const memory = wire.memoryDisposal({
    ticket: 'DEMO-561',
    at: T0 + 1_000,
    independentPosition: 'AGENT-2',
    requestedBy: 'AGENT-1',
    payload: {
      operation: 'archive',
      target_entries: [ref('REC-MEM-01', 'mem-1')],
      authorizations: [{ layer: 'work', authorized_by: 'AGENT-2' }],
      reason_and_impact: { reason: '结清分流', impact_scope: '本单', irrecoverable_notice: '不可恢复须确认' },
      retained_obligations: [],
      disposal_evidence: {
        route: 'archive',
        archive_location: 'archive://work/DEMO-561',
        acceptance_ref: ref('REC-WORK-09', 'ARCHIVE-1'),
      },
      notice: { notified: [{ refId: 'AGENT-1', refVersion: '1.0.0' }], residue_statement: '外部副本可能仍存在' },
    },
  })
  if (!memory.ok) throw new Error(`seed MEM-03 失败：${memory.reason}`)
  const value = wire.valueEvaluation({
    ticket: 'DEMO-561',
    at: T0 + 2_000,
    payload: {
      work_ref: work,
      acceptance_ref: null,
      artifact_account: { entries: [{ item: 'artifact', amount: 1, note: '交付件' }], basis: '归档清单' },
      state_account: { entries: [{ item: 'state', amount: 1, note: '终态' }], basis: '台账' },
      impact_account: { entries: [{ item: 'impact', amount: null, note: '不可量化' }], basis: '相对方反馈' },
      cost_account: { entries: [{ item: 'tokens', amount: 100, note: '实测用量' }], basis: 'usage' },
      negative_value_items: ['rework'],
      external_feedback: [{ party: 'counterparty', feedback_ref: { refId: 'FB-1', refVersion: '1.0.0' } }],
      conclusion: 'positive',
      uncertainty_and_dissent: { uncertainty: '样本有限', dissent_position: '无异议' },
      judged_by: 'AGENT-3',
      independence: { verified_by: 'AGENT-4', control_basis_ref: auth },
      proof_boundary: '夹具：四本账为测试数据，不证明真实价值。',
    },
  })
  if (!value.ok) throw new Error(`seed EVD-04 失败：${value.reason}`)
  return { memory: ref('REC-MEM-03', memory.recordId), value: ref('REC-EVD-04', value.recordId) }
}

/** 绿例入参集合（七族＋ACC-02；前置件已由 seedWork/seedLife/seedPrereqs 落库） */
export function greenInputs(args: {
  readonly work: DraftRecordRef
  readonly life: DraftRecordRef
  readonly memory: DraftRecordRef
  readonly value: DraftRecordRef
}) {
  const auth = ref('REC-AUTH-01', 'auth-1')
  const at = T0 + 10_000
  const time = iso(at)
  const face = {
    decidedBy: 'AGENT-5',
    authorityRef: auth,
    rationale: '结清/复盘决定',
    basisRefs: [auth],
    scopeJudged: { judged: ['scope'], notJudged: [] },
    dissentPosition: '无异议',
    effectiveFrom: time,
  }
  const decisionFace = {
    decided_by: face.decidedBy,
    authority_ref: auth,
    rationale: face.rationale,
    basis_refs: [auth],
    scope_judged: { judged: ['scope'], not_judged: [] },
    dissent_position: '无异议',
    effective_state: 'effective' as const,
    effective_time: time,
  }
  return {
    settlement: {
      ticket: 'DEMO-561',
      attempt: 1,
      at,
      payload: {
        work_ref: args.work,
        items: [{ item: 'artifact' as const, state: 'closed' as const }],
        reservations: [],
        derived_face_evidence: [],
        memory_disposition_refs: [args.memory],
        value_ref: args.value,
        verified_by: 'AGENT-5',
        independence: { verified_by: 'AGENT-5', control_basis_ref: auth },
        verified_scope: '只判是否关闭',
        dissent_position: '无异议',
        decision_face: decisionFace,
      },
    },
    exception: {
      ticket: 'DEMO-561',
      attempt: 1,
      at,
      payload: {
        subject_ref: args.work,
        exception_class: 'rule_deviation' as const,
        judged_against: 'rule v1',
        impact_scope: '本单',
        discovered_by: 'AGENT-1',
        receiver: 'AGENT-2',
        escalation_target: { position: 'AGENT-3', deadline: time, re_escalate_to: 'AGENT-4' },
        response_deadline: time,
        review_condition: '复核后关闭',
        terminal: null,
        dissent_position: '无异议',
      },
    },
    accountability: {
      ticket: 'DEMO-561',
      at,
      payload: {
        subject_ref: args.life,
        matter_refs: [args.work, args.value],
        inquiry_materials: {
          allegations: ['a'],
          explanations: ['e'],
          adverse_information: ['x'],
          silence_treated_as_report_exception: true,
        },
        defense_window: { deadline: time, overdue_disposition: '按窗口条款处置并留痕' },
        arbiter: { verified_by: 'AGENT-6', control_basis_ref: auth },
        conclusion: 'established' as const,
        consequence_routing: {},
        dissent_position: '无异议',
        proof_boundary: '夹具：问责结论为测试数据。',
      },
    },
    change: [
      {
        ticket: 'CHG-561',
        at,
        payload: {
          chain_id: 'chg-561',
          segment: 'candidate' as const,
          subject: { refId: 'rule-1', refVersion: '1.0.0' },
          subject_kind: 'rule' as const,
          decided_by: 'AGENT-7',
          authority_ref: auth,
          basis_refs: [auth],
          impact_assessment: {
            tasks: [], information: [], permissions: [], commitments: [], evidence: [], qualifications: [], in_flight_side_effects: [],
          },
          criteria_version: '1.0.0',
          no_override: true,
          rollback_path: { stop_conditions: ['s'], monitoring: ['m'], rollback_steps: ['r'] },
          dissent_position: '无异议',
          effective_state: 'effective' as const,
          effective_time: time,
        },
      },
    ],
    review: {
      ticket: 'DEMO-561',
      at,
      payload: {
        scope: { matters: [args.work], window: { from: iso(T0), to: time } },
        inputs: {
          acceptance_refs: [],
          cost_account_ref: args.value,
          counterparty_feedback: [],
          affected_party_feedback: [],
          contrary_examples: [],
          unfulfilled_commitments: [],
        },
        findings: [{ finding: 'f', basis_refs: [args.value] }],
        outputs: { personal_experience_refs: [], method_rule_candidates: [], structural_issues: [] },
        independence: { decided_by: 'AGENT-8', independence_note: '独立复盘位置' },
        dissent_position: '无异议',
        decision_face: { ...decisionFace, decided_by: 'AGENT-8' },
      },
    },
  }
}


/** 写变更链五段（candidate→实质分类→验证授权→独立验证→激活批准；段序由 contract/草案判） */
export function writeChangeChain(stack: PhaseDStack, at: number, auth: DraftRecordRef): DraftRecordRef[] {
  const time = iso(at)
  const impact = { tasks: [], information: [], permissions: [], commitments: [], evidence: [], qualifications: [], in_flight_side_effects: [] }
  const rollback = { stop_conditions: ['s'], monitoring: ['m'], rollback_steps: ['r'] }
  const common = {
    chain_id: 'chg-561',
    subject: { refId: 'rule-1', refVersion: '1.0.0' },
    subject_kind: 'rule' as const,
    authority_ref: auth,
    basis_refs: [auth],
    impact_assessment: impact,
    criteria_version: '1.0.0',
    no_override: true as const,
    rollback_path: rollback,
    dissent_position: '无异议',
    effective_state: 'effective' as const,
    effective_time: time,
  }
  const segments: Array<RecordChangeSegmentArgs & { readonly decidedBy: string }> = [
    { ticket: 'CHG-561', at, decidedBy: 'AGENT-7', payload: { ...common, segment: 'candidate', decided_by: 'AGENT-7' } },
    {
      ticket: 'CHG-561', at, decidedBy: 'AGENT-7',
      context: { previousSegment: 'candidate' },
      payload: {
        ...common, segment: 'substantive_classification', decided_by: 'AGENT-7',
        classification_basis: { criteria: ['c'], classification: 'substantive', beneficiary_involvement: 'none' },
      },
    },
    {
      ticket: 'CHG-561', at, decidedBy: 'AGENT-10',
      context: { previousSegment: 'substantive_classification', gateDeciders: { verification_authorization: 'AGENT-10' } },
      payload: { ...common, segment: 'verification_authorization', decided_by: 'AGENT-10' },
    },
    {
      ticket: 'CHG-561', at, decidedBy: 'AGENT-11',
      context: { previousSegment: 'verification_authorization', gateDeciders: { verification_authorization: 'AGENT-10', independent_verification: 'AGENT-11' } },
      payload: { ...common, segment: 'independent_verification', decided_by: 'AGENT-11' },
    },
    {
      ticket: 'CHG-561', at, decidedBy: 'AGENT-12',
      context: { previousSegment: 'independent_verification', gateDeciders: { verification_authorization: 'AGENT-10', independent_verification: 'AGENT-11', activation_approval: 'AGENT-12' } },
      payload: { ...common, segment: 'activation_approval', decided_by: 'AGENT-12' },
    },
  ]
  const refs: DraftRecordRef[] = []
  let previous: DraftRecordRef | undefined
  for (const segment of segments) {
    const { decidedBy: _decidedBy, ...args } = segment
    const result = stack.wire.changeSegment({ ...args, ...(previous !== undefined ? { previousSegmentRef: previous } : {}) })
    if (!result.ok) throw new Error(`写变更链段 ${segment.payload.segment} 失败：${result.reason}`)
    previous = ref('REC-CHG-01', result.recordId)
    refs.push(previous)
  }
  return refs
}

/** 绿例全场景（七族＋ACC-02；进程级证据与单测共用，避免两套实现） */
export function writeGreenScenario(stack: PhaseDStack): {
  readonly work: DraftRecordRef
  readonly life: DraftRecordRef
  readonly memory: DraftRecordRef
  readonly value: DraftRecordRef
  readonly writes: readonly string[]
} {
  const auth = ref('REC-AUTH-01', 'auth-1')
  const work = seedWork(stack.wire)
  const life = seedLife(stack.hist, auth)
  const prereq = seedPrereqs(stack.wire, work)
  const inputs = greenInputs({ work, life, memory: prereq.memory, value: prereq.value })

  const writes: string[] = []
  const settlement = stack.wire.settlement(inputs.settlement)
  if (!settlement.ok) throw new Error(`写 WORK-12 失败：${settlement.reason}`)
  writes.push(settlement.recordId)
  const exception = stack.wire.exception(inputs.exception)
  if (!exception.ok) throw new Error(`写 WORK-17 失败：${exception.reason}`)
  writes.push(exception.recordId)
  const accountability = stack.wire.accountability(inputs.accountability)
  if (!accountability.ok) throw new Error(`写 ACC-01 失败：${accountability.reason}`)
  writes.push(accountability.recordId)

  const remedy = stack.wire.remedy({
    ticket: 'DEMO-561',
    at: T0 + 11_000,
    payload: {
      case_ref: ref('REC-ACC-01', accountability.recordId),
      remedy_kind: 'record_correction',
      beneficiaries: [{ beneficiary_ref: { refId: 'AGENT-3', refVersion: '1.0.0' }, application_entry: 'entry' }],
      executor: { refId: 'AGENT-9', refVersion: '1.0.0' },
      execution_evidence: [ref('REC-WORK-17', exception.recordId)],
      settlement_confirmation: { settled: false, confirmed_by: null, confirmed_at: null },
      non_compensable_boundary: '不可补偿损害不以责任结算代替终局',
      affected_party_channel: '申诉通道',
      dissent_position: '无异议',
      decision_face: {
        decided_by: 'AGENT-6', authority_ref: auth, rationale: '救济', basis_refs: [auth],
        scope_judged: { judged: ['remedy'], not_judged: [] }, dissent_position: '无异议',
        effective_state: 'effective', effective_time: iso(T0 + 11_000),
      },
      proof_boundary: '夹具：救济决定为测试数据。',
    },
  })
  if (!remedy.ok) throw new Error(`写 ACC-02 失败：${remedy.reason}`)
  writes.push(remedy.recordId)

  const review = stack.wire.review(inputs.review)
  if (!review.ok) throw new Error(`写 REV-01 失败：${review.reason}`)
  writes.push(review.recordId)
  writes.push(...writeChangeChain(stack, T0 + 12_000, auth).map((entry) => entry.refId))
  return { work, life, memory: prereq.memory, value: prereq.value, writes }
}
