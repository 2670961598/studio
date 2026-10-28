/**
 * WORK 族测试夹具（MIG-03 / IMPL-03-02）——REC-WORK 21 类正例基座与字段覆盖入口
 *
 * 定位：只造「合法最少记录」基座，**不含断言**（断言在 rec-work-intent.test.ts / rec-work-exec.test.ts）。
 * 依据：v2/11 §5.1..§5.4 各族字段表；§14.1 迁移边；v2/09 ENU-03/07/10/11/12/14/15/16/17/19/23/26/124。
 * 纪律：本件是**非 test 辅助件**（`*.test.ts` 才进 V2 套件），只写可擦除语法。
 */
import { GATE_NAMES, HANDOVER_ITEMS, WORK_SETTLEMENT_ITEMS } from '../../../src/records/work.ts'
import { AT, TERM, decisionFace, oref, ref } from './fixtures.ts'

// —— WORK 夹具（本族正例基座；负例用 overrides 改形） ——

export function workIntakePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    raw_content: '请把 W-07 交付到待验收并附证据包',
    source: 'platform:intake-1',
    identity_mapping: '外部账号 external-1 → holder-h1',
    authenticity_state: 'verified',
    received_at: AT,
    intake_owner: 'unit-head-1',
    intake_deadline: AT,
    known_constraints: ['不得触外部审计面'],
    requested_state: 'awaiting_review',
    ...overrides,
  }
}

export function intakeDecisionPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    intent_ref: ref('REC-WORK-01'),
    decided_by: 'unit-head-1',
    authority_ref: ref('REC-AUTH-01'),
    work_type: 'create',
    type_basis: '有明确产物与可判定验收口径',
    outcome: 'accepted',
    scope_judged: { judged: ['主类型', '受理'], not_judged: ['开工', '验收', '价值'] },
    reason: '五要件可定义，来源已核验',
    conditions: [],
    dissent_position: '无异议',
    decision_face: decisionFace(),
    ...overrides,
  }
}

export function workContractPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contract_id: 'contract-w07',
    revision: '1.0.0',
    source_clause: '平台单据 W-07（提出方：外部委托方）',
    commitment_ref: ref('REC-WORK-15'),
    acceptance_criteria: {
      judged: '产物可用且证据包齐备',
      how: '按当时验收口径逐项核对',
      who: 'unit-head-2',
      when: AT,
      effect_level_ref: ref('REC-WORK-07'),
    },
    deadlines: { delivery_by: AT, review_points: [AT], expiry_semantics: '到期无处置即悬置并升级' },
    responsibility_positions: {
      work_owner: 'holder-h1',
      acceptor: 'unit-head-2',
      committer: 'g9.internal-boss',
      recorder: 'daemon:records',
    },
    risk_classification_ref: ref('REC-WORK-07'),
    resources_and_info: ['预算 1 单元', '只读输入已齐'],
    collaboration_and_handover: '无协作；换人走交接包',
    ...overrides,
  }
}

export function gateResults(overrides: Array<Record<string, unknown>> = []): Record<string, unknown>[] {
  return GATE_NAMES.map((gate, index) => ({
    gate,
    criteria_ref: oref(`criteria-${index + 1}`),
    verdict: 'ready',
    materials: [oref(`material-${index + 1}`)],
    ...(overrides[index] ?? {}),
  }))
}

export function startDecisionPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contract_ref: ref('REC-WORK-03'),
    decided_by: 'holder-h1',
    authority_ref: ref('REC-AUTH-02'),
    gate_results: gateResults(),
    judge_role: GATE_NAMES.map((gate) => ({ gate, role: { 权: '授权者', 能力: '认定位置', 资源: '资源责任者', 信息: '信息持有者', 禁止: '禁止清单所有者' }[gate] })),
    verdict: 'ready',
    conditions: [],
    repudiation_triggers: ['范围变化', '资源变化', '效果级升级'],
    resource_baseline: {
      subject: 'w-07',
      quota_ref: oref('quota-1'),
      entries: [{ resource_ref: oref('budget-1'), sufficient: true, basis: '额度快照 as-of' }],
      as_of: AT,
      gaps: [],
    },
    decided_at: AT,
    dissent_position: '无异议',
    decision_face: decisionFace(),
    ...overrides,
  }
}

export function planLockPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    definition_revision: '1.0.0',
    contract_ref: ref('REC-WORK-03'),
    qualification_refs: [ref('REC-CAP-02')],
    capability_descriptors: [{ capability_ref: ref('REC-CAP-01'), digest: 'sha256:cap-1' }],
    execution_config: 'dsh@default',
    binding_profile_ref: oref('BIND-DSH-01'),
    rule_profile_version: 'rule-profile@1.0.0',
    known_incapabilities: ['无外部独立审计通道'],
    substitution_plan: '不可替换，能力退化即暂停',
    resource_reservations: [
      { resource_ref: oref('budget-1'), amount: 1, unit: 'unit', period: TERM, quota_ref: oref('quota-1') },
    ],
    ...overrides,
  }
}

export function transitionPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    state_family: 'work',
    from_state: 'intake',
    to_state: 'pending_start',
    producer_type: 'decisive',
    trigger_ref: ref('REC-WORK-02'),
    authority_ref: ref('REC-AUTH-01'),
    precondition_results: [{ item: '合同五要件齐备', satisfied: true, basis: 'REC-WORK-03' }],
    expected_version: '2',
    actual_actor: 'unit-head-1',
    dissent_position: '无异议',
    occurred_at: AT,
    observed_at: AT,
    recorded_at: AT,
    side_effects: [],
    evidence_refs: [ref('REC-WORK-02'), ref('REC-WORK-03')],
    produced_refs: [],
    decision_face: decisionFace(),
    ...overrides,
  }
}

export function effectLevelPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subject_ref: ref('REC-WORK-03'),
    effect_level: 'EX-1',
    reversibility: '可逆（无外部可见副作用）',
    affected_rights: [],
    classified_by: 'unit-head-1',
    basis: ['产物仅在内部工作区'],
    dispute: [],
    effect_on_procedure: ['低侧三件：终态/自报/抽样复核'],
    scope_judged: { judged: ['效果级'], not_judged: ['验收', '价值', '资源充足'] },
    dissent_position: '无异议',
    decision_face: decisionFace(),
    ...overrides,
  }
}

export function completionPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    work_ref: ref('REC-WORK-03'),
    effect_level_ref: ref('REC-WORK-07'),
    completion_basis: ['终态事件', '非空输出', 'REPORT 落盘', '闸门 exit=0'].map((element) => ({ element, state: 'present' })),
    collector_identity: {
      collector: 'harvester-1',
      independence: '收割者≠交付者（独立收割通道）',
      self_reported: false,
      harvest_batch_ref: ref('REC-EVD-01'),
    },
    harvest_ref: ref('REC-EVD-01'),
    sampling_ref: ref('REC-EVD-02'),
    gaps: [],
    proof_boundary: '证明执行面终态与四要件齐备；不证明验收通过、价值为正',
    ...overrides,
  }
}

export function acceptancePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    work_ref: ref('REC-WORK-03'),
    criteria_revision: '1.0.0',
    verdict: 'accepted',
    reworkable: true,
    scope_judged: { judged: ['是否满足验收口径'], not_judged: ['价值', '结清', '后续变更'] },
    judged_by: 'unit-head-2',
    independence_verified_by: { verified_by: 'audit-1', control_basis_ref: ref('REC-LIFE-05') },
    evidence_refs: [ref('REC-EVD-03'), ref('REC-EVD-02')],
    conditions: [],
    basis_and_dissent: { basis: ['证据包八要素齐备'], dissent_position: '无异议', reply_deadline: AT },
    effect_level_applied: ref('REC-WORK-07'),
    acceptance_kind: 'artifact',
    decision_face: decisionFace(),
    ...overrides,
  }
}

export function reworkPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    triggered_by: ref('REC-WORK-09'),
    cause_class: 'criteria',
    scope: '仅重做验收口径覆盖部分',
    count: 1,
    threshold_state: { threshold: 2, reached: false },
    deadline: AT,
    ...overrides,
  }
}

export function reopenPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reopened_refs: [ref('REC-WORK-09')],
    new_evidence: [oref('evidence-new-1')],
    standard_applied: '新证据标准：关键证据项可复核',
    affected_scope: '仅影响本次验收结论，其余保持原状',
    review_action: {
      position: 'unit-head-0',
      scope: '仅复核本次结论',
      deadline: AT,
      conclusion_route: '复核后按新事项受理或维持原终态',
    },
    decided_by: 'unit-head-0',
    dissent_position: '无异议',
    original_annotation: '原结论已标「已被重开」',
    ...overrides,
  }
}

export function settlementPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const items = WORK_SETTLEMENT_ITEMS.map((item) => ({ item, state: 'closed' }))
  return {
    work_ref: ref('REC-WORK-03'),
    items,
    settled_state: 'fully_settled',
    reservations: [],
    derived_face_evidence: [],
    value_ref: ref('REC-EVD-04'),
    memory_disposition_refs: [ref('REC-MEM-03')],
    verified_by: 'audit-2',
    independence: { verified_by: 'audit-2', control_basis_ref: ref('REC-LIFE-05') },
    verified_scope: '只判「是否关闭」，不重作验收判断、不判价值',
    dissent_position: '无异议',
    decision_face: decisionFace(),
    ...overrides,
  }
}

export function handoverPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    context: { kind: '换人', work_ref: ref('REC-WORK-03'), contract_ref: ref('REC-WORK-03') },
    items: HANDOVER_ITEMS.map((item) => ({ item, present: true })),
    continuity_answers: {
      why: ref('REC-WORK-02'),
      progress: ref('REC-WORK-09'),
      owed: ref('REC-WORK-12'),
      next_criteria: ref('REC-WORK-04'),
    },
    derived_face: [
      {
        descendant_type: 'sub_agent',
        identity_ref: 'desc-1',
        credential_logical_reference: 'cred-scoped-1',
        deactivation_or_fence_evidence: '撤销回执＋注入停止确认',
      },
    ],
    submission: { submitted_by: 'holder-h1', at: AT },
    verification: { verified_by: 'holder-h2', conclusion: '十项齐备且四问可答' },
    acceptance: { accepted: true, conditions: [] },
    dissent_position: '无异议',
    ...overrides,
  }
}

export function commitmentChangePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    commitment_ref: ref('REC-WORK-15'),
    stages: ['application', 'acceptance', 'counterparty_statement', 'decision'].map((stage) => ({
      stage,
      at: AT,
      actor: 'g9.internal-boss',
      materials: [ref('REC-WORK-15')],
    })),
    elements: {
      original_commitment_ref: ref('REC-WORK-15'),
      proposed_change: '交付时点顺延一个复审点',
      reason_and_evidence: ['外部依赖到货延迟'],
      alternative_or_compensation: '增加中间交付物',
      counterparty_opinion: '相对方要求给出补偿方案',
      disposition_if_declined: '维持原承诺并承担逾期后果',
    },
    deadlock_clock: AT,
    original_terms_stand: true,
    outcome: 'negotiate_substitute',
    ...overrides,
  }
}

export function collaborationPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action_kind: 'dispatch',
    work_ref: ref('REC-WORK-03'),
    from: oref('unit-head-1'),
    to: oref('unit-head-2'),
    carried_terms: ['合同版本 1.0.0', '验收口径版本 1.0.0'],
    deadline: AT,
    response: null,
    no_response_effect: 'escalate_on_expiry',
    ...overrides,
  }
}

export function obligationPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    definition_ref: ref('REC-WORK-15'),
    form: 'action',
    holder: oref('holder-h1'),
    authority_source: ref('REC-AUTH-02'),
    acceptance_state: 'accepted',
    counterparty: oref('external-owner'),
    trigger_state: '承诺生效触发',
    due_state: { due: AT, review_point: AT },
    completion: {
      criteria_version: '1.0.0',
      evidence_refs: [ref('REC-WORK-16')],
      judged_by: 'unit-head-2',
      conclusion: '已履行',
    },
    disposition: 'none',
    parent_and_delegation: { parent_ref: null, delegation_ref: null },
    closed_or_assumed: { closed: true, assumed: false },
    ...overrides,
  }
}

export function commitmentPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    commitment_kind: 'specific',
    committed_by: oref('g9.internal-boss'),
    counterparty: { class_or_ref: '外部委托方', representative: 'ext-rep-1', objection_channel: '外部异议通道' },
    content: { what: '按期交付 W-07', conditions: ['资源到位'], fulfillment_criteria: '验收通过且相对方确认' },
    term: { due: AT, expiry_semantics: '到期未履行按违约处置' },
    consequence: '按合同条款承担后果',
    revision_chain: [],
    consent_state: 'accepted',
    ...overrides,
  }
}

export function fulfillmentPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    commitment_ref: ref('REC-WORK-15'),
    work_refs: [ref('REC-WORK-09')],
    merge_rule: '单工作对应',
    derived_status: 'at_risk',
    derivation_refs: [ref('REC-WORK-09')],
    ...overrides,
  }
}

export function exceptionPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subject_ref: ref('REC-WORK-03'),
    exception_class: 'criteria_invalid',
    judged_against: '原口径 v1（已失效，无可比口径）',
    impact_scope: '仅影响 W-07 验收判断',
    discovered_by: 'harvester-1',
    receiver: 'unit-head-1',
    escalation_target: { position: 'g9.internal-boss', deadline: AT, re_escalate_to: 'external-owner' },
    response_deadline: AT,
    review_condition: '下个复审点',
    terminal: null,
    dissent_position: '无异议',
    ...overrides,
  }
}

export function emergencyStopPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    trigger: '发现对外写入可能越界',
    boundary_ref: ref('REC-AUTH-01'),
    actions_taken: ['停止对外写入', '保全现场快照'],
    not_authorized: ['未进入禁止面', '未追认原动作'],
    evidence_preserved: [oref('snapshot-1')],
    notified: [oref('g9.internal-boss')],
    independent_review: { position: 'audit-1', deadline: AT, conclusion: '保全范围内，未越界' },
    effect_on_original: '不追认原动作、不等于恢复、不推广为常态',
    ...overrides,
  }
}

export function maintPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    work_ref: ref('REC-WORK-03'),
    criteria_revision: '1.0.0',
    result_kind: 'standby',
    state_indicators: [{ indicator: '界内时间比例', material_ref: oref('state-material-1') }],
    process_indicators: [{ indicator: '覆盖与响应', material_ref: oref('process-material-1') }],
    sampling_refs: [ref('REC-EVD-05')],
    verdict: 'maintained',
    review_cycle: { cycle: '每季复审', exit_terms: '终止时说明从何时起不再维持', risk_successor: 'unit-head-1' },
    proof_boundary: '证明维持成立；不证明长期价值',
    ...overrides,
  }
}

export const PROOF = { proofBoundary: '证明边界：本记录证明所述判断，不证明未列范围' }
