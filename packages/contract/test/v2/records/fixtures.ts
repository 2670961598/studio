/**
 * rec 域 V1 形状测试夹具（MIG-03 / IMPL-03-01）
 *
 * 定位：只造「合法最少记录」基座与字段覆盖入口，**不含断言**（断言在各 *.test.ts）。
 * 每族基座对齐 v2/11 各族字段表；`overrides` 用于把基座改成待判负的形态。
 *
 * 依据：v2/11 §〇.5（信封生效槽）、§2.2/§3.1/§3.2/§四（各族字段表）、§十四（迁移边前置记录）；
 *       v2/17 §4.1（NEG-ORG-09..15、NEG-REC-01/02/03 的 V1 腿）。
 */
import type { RecordValidationOutcome } from '../../../src/records/envelope.ts'
import { PERF_DIMENSIONS } from '../../../src/records/perf.ts'

/** 固定时刻（带偏移；纯夹具不取系统时间） */
export const AT = '2026-10-28T00:00:00Z'
/** 任期/授权期限区间（条款期，非生效窗口） */
export const TERM = { from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z' }

/** 记录引用（记录类型＋ID＋版本） */
export interface TestRecordRef {
  refType: string
  refId: string
  refVersion: string
}

/** 非记录对象引用（ID＋版本） */
export interface TestObjectRef {
  refId: string
  refVersion: string
}

export function ref(refType: string, refId = 'rec-1', refVersion = '1.0.0'): TestRecordRef {
  return { refType, refId, refVersion }
}

export function oref(refId = 'object-1', refVersion = '1.0.0'): TestObjectRef {
  return { refId, refVersion }
}

/** 决定面（§0.3-1；effective_state 与信封同值） */
export function decisionFace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    decided_by: 'g9.internal-boss',
    authority_ref: ref('REC-AUTH-01'),
    rationale: '依 v2/11 §3.1 逐条核验五条件',
    basis_refs: [ref('REC-LIFE-05')],
    scope_judged: { judged: ['权源', '资格', '禁配'], not_judged: ['绩效归因'] },
    dissent_position: '无异议',
    effective_state: 'effective',
    effective_time: AT,
    ...overrides,
  }
}

/** 记录信封（§0.5：effective/effectiveTime 齐；producer 具名） */
export function envelope(recordType: string, payload: unknown, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recordId: 'rec-0001',
    recordType,
    schemaRef: { schemaId: 'studio-next.records.v2', schemaVersion: '1.0.0' },
    specVersion: '2.0.0',
    companyRef: 'company-a',
    producedAt: AT,
    producer: { decidedBy: 'g9.internal-boss', writtenBy: 'daemon:records' },
    basisRefs: [oref('basis-1')],
    payload,
    effectiveState: 'effective',
    effectiveTime: { from: AT },
    ...overrides,
  }
}

// —— AUTH 授权链 ——

/** REC-AUTH-01 根授予（合法基座：外部老板签发＋证明字段齐） */
export function rootGrantPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    grantor: oref('external-owner'),
    grantee: oref('g9.internal-boss'),
    parent_grant: ref('REC-LIFE-07', 'founding-record-1'),
    grant_class: 'root_delegation',
    scope: {
      purpose: '以内部老板身份签发内部硬动作',
      object: '经营权限',
      included: ['approve_internal_hard_action', 'appoint_g8'],
      forbidden: ['外部审计', '清算'],
    },
    conditions: [],
    term: TERM,
    delegable: true,
    withdrawal_terms: '外部老板随时撤回/轮换；后代停用为完成条件',
    conflict_check_ref: ref('REC-LIFE-05'),
    key_fingerprint: 'sha256:operating-root-key-fp',
    external_signature: oref('signature-artifact-1'),
    proof_mode: 'ritual_and_key',
    external_veto_configured: false,
    ...overrides,
  }
}

/** REC-AUTH-01 普通转授（+2 链内逐级） */
export function delegationGrantPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = rootGrantPayload()
  delete base['key_fingerprint']
  delete base['external_signature']
  delete base['proof_mode']
  delete base['external_veto_configured']
  return {
    ...base,
    grant_class: 'delegation',
    grantor: oref('g9.internal-boss'),
    grantee: oref('unit-head-1'),
    parent_grant: ref('REC-AUTH-01'),
    ...overrides,
  }
}

export function exercisePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    exercised_grant: ref('REC-AUTH-01'),
    action_ref: oref('action-1'),
    within_scope: [{ item: 'appoint_g8', within: true }],
    exercised_at: AT,
    on_behalf_of: 'self',
    root_use: false,
    ...overrides,
  }
}

export function withdrawalPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    withdrawn_grant: ref('REC-AUTH-01'),
    reason: 'active_withdrawal',
    effective_time: AT,
    in_flight_inventory: ['在途硬动作 1 件'],
    descendants: [
      {
        descendant_type: 'sub_agent',
        identity_ref: 'desc-1',
        credential: { credential_class: 'scoped', logical_reference: 'cred-scoped-1' },
        deactivation_evidence: '撤销回执 + 注入停止确认',
        reconcile_entry: 'reconcile:desc-1',
      },
    ],
    deactivation_evidence: { kind: 'revocation_receipt', evidence_ref: 'evidence-revocation-1' },
    runtime_stop_evidence: ref('REC-EVD-02'),
    credential_actions: ['scoped 凭据已吊销'],
    residual_side_effects: [],
    withdrawn_grant_class: 'root_delegation',
    ...overrides,
  }
}

export function credentialPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    credential_class: 'root',
    logical_reference: 'cred-root.company-a',
    bound_grant: ref('REC-AUTH-01'),
    permitted_operations: ['approve_internal_hard_action'],
    valid_window: TERM,
    revocation_state: 'active',
    exposure_scope: '仅最高宰相进程内注入面',
    ...overrides,
  }
}

export function leasePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    holder: oref('daemon-arbiter'),
    scope: ['events_append'],
    granted_at: AT,
    expires_at: '2026-10-28T01:00:00Z',
    renewable: true,
    ...overrides,
  }
}

export function fencePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    epoch: 7,
    token_ref: 'fence-token-ref-7',
    issued_by: oref('authority-endpoint-1'),
    rejections: [],
    recognized_by: [oref('writer-a')],
    last_verified_at: AT,
    ...overrides,
  }
}

export function activationPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fact_domain: 'events',
    requirement_ref: oref('authority-requirement-1'),
    chosen_endpoint: oref('endpoint-1'),
    unmet_requirements: [],
    activation_generation: 2,
    previous_generation: 1,
    review_due: AT,
    old_writer_stop: { method: '旧写者停写确认', evidence_ref: 'evidence-stop-1' },
    in_flight_migration: ['在途事件 3 条已迁移'],
    fencing_mode: 'exclusive_handover',
    scope_judged: { judged: ['事实域', '端点', '代次'], not_judged: ['业务授权', '验收'] },
    dissent_position: '无异议',
    decision_face: decisionFace(),
    ...overrides,
  }
}

export function incapacityPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subject: oref('subject-1'),
    failure_class: 'unreachable',
    evidence: ['三次探测超时'],
    judged_by: oref('successor-position-1'),
    scope_and_term: '至恢复条件核验完成',
    freeze_effect: ['该主体签发面冻结'],
    recovery_preconditions: ['as-of 对账', '缺口清单', '时效性再验证'],
    notified: [oref('external-owner')],
    dissent_position: '无异议',
    decision_face: decisionFace(),
    ...overrides,
  }
}

// —— AUTH 通用骨架（§2.1 八条） ——

export function commandRequestPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    command_kind: 'external_request',
    target_ref: oref('target-1'),
    expected_version: '3',
    requested_effect: '把工作 W-07 迁移到待验收并附证据包',
    claimed_authority: [ref('REC-AUTH-01')],
    scope: ['transition'],
    idempotency_key: {
      companyRef: 'company-a',
      recordType: 'REC-CMD-01',
      subjectId: 'w-07',
      operationClass: 'transition',
      requesterSequence: 'req-1',
    },
    issued_at: AT,
    received_at: AT,
    source_verification: 'verified',
    payload_digest: 'sha256:request-body',
    ...overrides,
  }
}

export function authorityCheckPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    checked_command: ref('REC-CMD-01'),
    resolved_grants: [ref('REC-AUTH-01')],
    policy_verdict: 'permitted',
    conflict_check: '禁配结论：无冲突（REC-LIFE-05）',
    delegation_chain_ok: true,
    effective_scope: ['transition'],
    ...overrides,
  }
}

export function genericDecisionPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    decided_by: 'g9.internal-boss',
    decision_kind: '主体分类结论',
    subject_ref: oref('subject-1'),
    verdict: '按公司层级 2 级处理',
    conditions: [],
    rationale: '按 v2/02 §一 主体分类口径判定',
    basis_refs: [ref('REC-LIFE-05')],
    scope_judged: { judged: ['分类'], not_judged: ['任职生效'] },
    dissent_position: '无异议',
    effective_state: 'effective',
    effective_time: AT,
    external_effect_state: 'no_external_effect',
    ...overrides,
  }
}

export function receiptPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    acknowledges: ref('REC-CMD-01'),
    ack_kind: 'executed',
    resulting_version: '4',
    retryable: false,
    side_effect_possible: false,
    reconcile_hint: '以平台活动流对账（REC-EVT-02）',
    ...overrides,
  }
}

export function correctionPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    corrects: [ref('REC-AUTH-01')],
    correction_kind: 'supersede',
    corrected_fields: [{ field: 'scope.included', old_value: 'appoint_g8', new_value: 'appoint_g8,appoint_dept_head' }],
    affected_conclusions: ['REC-CMD-02'],
    authority_ref: ref('REC-AUTH-01'),
    effective_from: AT,
    original_preserved: true,
    ...overrides,
  }
}

export function eventPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_kind: 'platform_comment_observed',
    actor_ref: 'unit-head-1',
    occurred_at: AT,
    observed_at: AT,
    payload_summary: '平台出现一条评论（不驱动迁移）',
    source_kind: 'platform_activity_stream',
    cursor: 'cursor-42',
    event_completeness: 'complete',
    ...overrides,
  }
}

export function reconciliationPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scope: '出工段×采集区间',
    baseline_cursor: 'cursor-40',
    compared_sources: ['platform_activity_stream', 'local_store_events'],
    difference_classes: [],
    per_item_disposition: [],
    completeness_claim: 'complete',
    blocking_effect: false,
    ...overrides,
  }
}

export function unknownRegistryPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    unknown_scope: '平台活动流 cursor-43 之后',
    reason: '来源不可达（HTTP 503）',
    last_known: 'cursor-42',
    impact: '工作 W-07 完成面显示未知（非零、非健康）',
    owner: 'unit-head-1',
    review_by: AT,
    ...overrides,
  }
}

// —— LIFE ——

/** REC-LIFE-01 G9 任命（合法基座：必引 root_delegation、五条件齐、接受已落） */
export function appointmentPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    appointment_kind: 'appointment',
    position_ref: oref('position-g9'),
    holder_ref: oref('holder-h1'),
    nomination_ref: ref('REC-LIFE-01', 'nomination-1'),
    appointing_authority_ref: ref('REC-AUTH-01'),
    decision_basis_ref: ref('REC-DEC-01'),
    root_delegation_ref: ref('REC-AUTH-01', 'root-delegation-1'),
    scope: { duties: '公司整体经营', forbidden: ['外部审计'] },
    term: { from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z', expiry_disposition: '届满不自动续任' },
    qualification_refs: [ref('REC-CAP-02')],
    conflict_check_ref: ref('REC-LIFE-05'),
    acceptance_state: 'accepted',
    acceptance_time: AT,
    entry_gate_results: {
      authority: { satisfied: true },
      qualification: { satisfied: true },
      conflict: { satisfied: true },
      handover: { satisfied: true },
      acceptance: { satisfied: true },
    },
    idempotency_four_tuple: {
      position_ref: oref('position-g9'),
      holder_ref: oref('holder-h1'),
      term_start: '2026-01-01T00:00:00Z',
      proposed_version: '1.0.0',
    },
    decision_face: decisionFace(),
    ...overrides,
  }
}

export function transitionPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    from_state: 'active',
    to_state: 'handover',
    trigger_ref: ref('REC-LIFE-01'),
    authority_ref: ref('REC-AUTH-01'),
    precondition_results: [{ item: '转岗决定已作出', satisfied: true, basis: 'REC-LIFE-01' }],
    expected_version: '2',
    actual_actor: 'g9.internal-boss',
    dissent_position: '无异议',
    review_terms: { deadline: AT },
    side_effects: [],
    evidence_refs: [ref('REC-LIFE-01')],
    produced_refs: [],
    decision_face: decisionFace(),
    ...overrides,
  }
}

export function settlementPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subject: ref('REC-LIFE-01'),
    face: 'settlement_face',
    checklist_items: [{ item: '记忆', state: 'closed' }],
    reservations: [],
    verified_scope: '只判是否关闭，不重作工作验收',
    dissent: '无异议',
    decision_face: decisionFace(),
    ...overrides,
  }
}

export function orgVacancyPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_kind: 'unit_vacancy',
    structure_evidence: ['在编结构核对：3 个单元行，其中 unit-2 的 headRef 空缺'],
    decided_by: 'g9.internal-boss',
    unit_ref: { unitId: 'unit-2', unit_count_before: 3, unit_count_after: 3 },
    review_terms: { deadline: AT, fallback: '超期补设或降级二选一' },
    vacancy_rule: {
      acting_management: '最高宰相直管 unit-2',
      no_new_g8_during_vacancy: true,
      emergency_exception: { triggered: false },
    },
    dissent_position: '无异议',
    ...overrides,
  }
}

export function identityTransitionPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    from_state: 'active',
    to_state: 'suspended',
    decided_by: 'g9.internal-boss',
    basis: ['具名中止决定已作出'],
    notice: '已通知全部在位者与相对方',
    dissent_position: '无异议',
    generation_effect: '权威代次冻结，不得沿用',
    decision_face: decisionFace(),
    ...overrides,
  }
}

export function continuityPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operation: 'merge',
    terminal_roles: {
      external_receiver_ref: oref('external-receiver'),
      residual_subject_ref: oref('external-owner'),
      distinct_confirmed: true,
    },
    parties: [
      { party_ref: oref('company-a'), role: '存续方', identity_state: 'active' },
      { party_ref: oref('company-b'), role: '被并入方', identity_state: 'liquidated' },
    ],
    identity_arrangement: '存续方身份不变，被并入方逐项承继',
    commitments_assumed: [],
    obligations_assumed: [],
    appointments: [],
    lineage_links: ['双谱系联接：company-a ← company-b'],
    authority_plan: '按 v2/03 §七 逐项重认',
    conflicts_kept: [],
    dissent_and_remedy: '无异议；救济入口按公司申诉链',
    scope_judged: { judged: ['身份承继', '承诺承接'], not_judged: ['清算金额'] },
    decision_face: decisionFace(),
    ...overrides,
  }
}

/** 一级单元域主张（NEG-ORG-13 判据输入） */
export function unitClaims(count: number): { unitId: string; domain: string }[] {
  return Array.from({ length: count }, (_v, index) => ({ unitId: `unit-${index + 1}`, domain: `domain-${index + 1}` }))
}

// —— PERF ——

export function perfDimensions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {}
  for (const dimension of PERF_DIMENSIONS) base[dimension] = `${dimension}维结论：达成`
  return { ...base, ...overrides }
}

export function perfPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subject: ref('REC-LIFE-01'),
    layer: '任职者绩效',
    dimensions: perfDimensions(),
    window_and_distribution: {
      window_from: '2026-09-01T00:00:00Z',
      window_to: '2026-10-01T00:00:00Z',
      task_distribution: '交付 4 件、维持 1 件',
    },
    uncertainty: { note: '证据充分', evidence_weak: false, conclusion: '可归因' },
    evaluator_and_independence: {
      evaluator_ref: ref('REC-LIFE-01', 'evaluator-1'),
      audit_class: 'superior_audit',
      independence_claimed: false,
    },
    appeal_entry: { entry_ref: ref('REC-ACC-01'), deadline: AT },
    input_refs: [ref('REC-WORK-09'), ref('REC-WORK-08'), ref('REC-EVD-04')],
    ...overrides,
  }
}

/** 判定结论的 issue 路径（合法返回空数组——断言「拒在哪一条」用） */
export function issuePaths(outcome: RecordValidationOutcome): string[] {
  return outcome.ok ? [] : outcome.issues.map((issue) => issue.path)
}
