/**
 * rec-evd.test.ts —— EVD 证据族「一族一正一负」（MIG-03 / IMPL-03-02；NEG-REC-05 底行）
 *
 * 依据：v2/17 §4.3 NEG-REC-05（事件冒验收/回执冒验收/验收冒结清 X2/X3/X4；自供不成独立；对账差异判负，
 *   V1＋V3——本文件落 V1 形状腿）｜v2/11 §六（EVD 六类字段与不变量）、§十五-2（EX-2+ 必引收割批次且
 *   采集者独立；撤回完成＝后代清单＋停用证据）｜v2/09 ENU-49/50/51/53/54/55/60/135。
 */
import { describe, expect, it } from 'vitest'
import {
  EVIDENCE_ELEMENT_IDS,
  validateEvidenceItem,
  validateEvidencePackage,
  validateHarvestBatch,
  validatePostAudit,
  validateRevocationEvidence,
  validateValueEvaluation,
} from '../../../src/records/evd.ts'
import { AT, envelope, issuePaths, oref, ref } from './fixtures.ts'

const PROOF = { proofBoundary: '证明边界：本记录证明所述判断，不证明未列范围' }

function harvestPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    segment_ref: ref('REC-LIFE-04'),
    source_cursor: 'cursor-1',
    collected_items: [{ item: 'action-log', content_ref: oref('artifact-1') }],
    harvest_completeness: 'complete',
    gaps: [],
    execution_terminal: 'completed',
    usage_and_cost: {
      usage: [{ item: 'tokens', amount: 100, unit: 'token' }],
      cost: [{ item: 'model', amount: 1, unit: 'usd-cent' }],
    },
    idempotency_key: { segment_ref: ref('REC-LIFE-04'), collection_from: AT, collection_to: AT },
    ...overrides,
  }
}

function evidenceItemPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    element: 'EVD-ELM-01',
    content_ref: oref('raw-1'),
    formed_at: AT,
    observed_at: AT,
    source_chain: ['collector-1 → store'],
    source_anchor: 'independent_collection',
    element_state: 'present',
    knowledge_scope: '仅本次工作',
    integrity_state: 'digest-verified',
    proves: '权源与本次行动引用',
    does_not_prove: '验收通过',
    ...overrides,
  }
}

function allElements(): Record<string, unknown> {
  const map: Record<string, unknown> = {}
  for (const element of EVIDENCE_ELEMENT_IDS) map[element] = { ref: oref(`material-${element}`) }
  return map
}

function evidencePackagePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    work_ref: ref('REC-WORK-03'),
    contract_revision: '1.0.0',
    elements_present: allElements(),
    self_check: { checklist_ref: ref('REC-EVD-01'), conclusion: '八要素自检齐备', self_reported: true },
    sufficiency_claim: '证据足以判定本次验收',
    unresolved: [],
    dissent_entries: [],
    ...overrides,
  }
}

function valueAccount(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { entries: [{ item: '条目', amount: 1, note: '可复算' }], basis: '账目依据', ...overrides }
}

function valuePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    work_ref: ref('REC-WORK-03'),
    acceptance_ref: ref('REC-WORK-09'),
    artifact_account: valueAccount(),
    state_account: valueAccount(),
    impact_account: valueAccount(),
    cost_account: valueAccount(),
    negative_value_items: [],
    external_feedback: [{ party: '外部委托方', feedback_ref: oref('feedback-1') }],
    conclusion: 'positive',
    uncertainty_and_dissent: { uncertainty: '价值量级为定性判断', dissent_position: '无异议' },
    judged_by: 'audit-1',
    independence: { verified_by: 'audit-1', control_basis_ref: ref('REC-LIFE-05') },
    proof_boundary: '证明四本账与价值结论；不证明相对方满意',
    ...overrides,
  }
}

function postAuditPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scope: 'EX-0/1 低档结论批次',
    audit_class: 'superior_audit',
    conclusion: 'no_violation',
    audited_by: 'unit-head-3',
    independence_verified_by: { verified_by: 'audit-2', control_basis_ref: ref('REC-LIFE-05') },
    basis_refs: [ref('REC-WORK-08')],
    findings: [],
    deadline: AT,
    overdue_disposition: '逾期未审计＝异常并标注「未经事后审计」',
    dissent_position: '无异议',
    ...overrides,
  }
}

function revocationPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subject: ref('REC-AUTH-03'),
    descendants_inventory: [
      {
        descendant_type: 'sub_agent',
        identity_ref: 'desc-1',
        credential: { credential_class: 'scoped', logical_reference: 'cred-scoped-1' },
        deactivation_evidence: '撤销回执＋注入停止确认',
        reconcile_entry: 'reconcile:desc-1',
      },
    ],
    deactivation_evidence: { kind: 'revocation_receipt', evidence_ref: 'evidence-revocation-1' },
    residual_watch_ref: ref('REC-OBS-03'),
    ...overrides,
  }
}

describe('EVD 六类正例（§六 字段齐备）', () => {
  it('01 收割批次：完整性 complete＋执行终态五值＋幂等区间键 → 放行', () => {
    expect(validateHarvestBatch(envelope('REC-EVD-01', harvestPayload()))).toEqual({ ok: true })
  })

  it('02 证据项：独立采集＋要素在场＋证明边界齐 → 放行', () => {
    expect(validateEvidenceItem(envelope('REC-EVD-02', evidenceItemPayload(), PROOF))).toEqual({ ok: true })
  })

  it('03 证据包：八要素逐项在场＋自检标注自述 → 放行', () => {
    expect(validateEvidencePackage(envelope('REC-EVD-03', evidencePackagePayload()))).toEqual({ ok: true })
  })

  it('04 价值评估：四本账分列＋外部反馈在场＋判断者独立 → 放行', () => {
    expect(validateValueEvaluation(envelope('REC-EVD-04', valuePayload()))).toEqual({ ok: true })
  })

  it('05 事后审计：专用结论集 no_violation＋上级审计标注 → 放行', () => {
    expect(validatePostAudit(envelope('REC-EVD-05', postAuditPayload()))).toEqual({ ok: true })
  })

  it('RVK 撤回完成：后代清单＋停用证据 → 放行', () => {
    expect(validateRevocationEvidence(envelope('REC-EVD-RVK', revocationPayload()))).toEqual({ ok: true })
  })

  it('RVK 无后代但给显式确认方法（探测方法＋最后时点）→ 放行', () => {
    const payload = revocationPayload({
      descendants_inventory: [],
      no_descendant_confirmation: { probe_method: '逐项探测派生登记与凭据目录', last_probed_at: AT },
    })
    expect(validateRevocationEvidence(envelope('REC-EVD-RVK', payload))).toEqual({ ok: true })
  })
})

describe('NEG-REC-05 证据族拒绝条件（X2/X3/X4、自供不成独立、对账差异判负）', () => {
  it('完整性存疑的收割批次被当作验收输入 → 拒（不得判接受）', () => {
    const outcome = validateHarvestBatch(envelope('REC-EVD-01', harvestPayload({ harvest_completeness: 'incomplete' })), {
      usedAsAcceptanceInput: true,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.harvest_completeness')
  })

  it('采集为空且无缺口（把「没采集到」当「无输出」）→ 拒', () => {
    const outcome = validateHarvestBatch(envelope('REC-EVD-01', harvestPayload({ collected_items: [], gaps: [] })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.gaps')
  })

  it('自述证据单独支撑 EX-2+ → 拒（ENU-49）', () => {
    const outcome = validateEvidenceItem(
      envelope('REC-EVD-02', evidenceItemPayload({ source_anchor: 'self_reported' }), PROOF),
      { forEx2Acceptance: true },
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.source_anchor')
  })

  it('不适用要素留空（无理由无判者）→ 拒（ENU-50）', () => {
    const outcome = validateEvidenceItem(
      envelope('REC-EVD-02', evidenceItemPayload({ element_state: 'not_applicable' }), PROOF),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.element_state')
  })

  it('证据包缺要素键（八要素不齐）→ 拒（L3E-12）', () => {
    const elements = allElements()
    delete elements['EVD-ELM-08']
    const outcome = validateEvidencePackage(envelope('REC-EVD-03', evidencePackagePayload({ elements_present: elements })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome).some((path) => path.includes('elements_present'))).toBe(true)
  })

  it('EX-2+ 验收引用了带缺项的证据包 → 拒', () => {
    const elements = allElements()
    elements['EVD-ELM-03'] = { missing_reason: '外部材料不可得' }
    const outcome = validateEvidencePackage(
      envelope('REC-EVD-03', evidencePackagePayload({ elements_present: elements })),
      { forEx2Acceptance: true },
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.elements_present.EVD-ELM-03')
  })

  it('外部反馈为空却判正价值 → 拒（治 L3E-03）', () => {
    const outcome = validateValueEvaluation(envelope('REC-EVD-04', valuePayload({ external_feedback: [] })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.conclusion')
  })

  it('价值评估四本账塌缩（缺 cost_account）→ 拒（不得压成总分）', () => {
    const payload = valuePayload()
    delete payload['cost_account']
    const outcome = validateValueEvaluation(envelope('REC-EVD-04', payload))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.cost_account')
  })

  it('事后审计借用验收四值 → 拒（审计不是第二次验收）', () => {
    const outcome = validatePostAudit(envelope('REC-EVD-05', postAuditPayload({ conclusion: 'accepted' })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome).some((path) => path.includes('conclusion'))).toBe(true)
  })

  it('外部审计通道未建成却填 external → 拒（fail-closed）', () => {
    const outcome = validatePostAudit(envelope('REC-EVD-05', postAuditPayload({ audit_class: 'external' })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.audit_class')
  })

  it('无后代且无显式确认方法（留空视为零）→ 拒（I-6）', () => {
    const outcome = validateRevocationEvidence(envelope('REC-EVD-RVK', revocationPayload({ descendants_inventory: [] })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.no_descendant_confirmation')
  })

  it('后代未全枚举 → 拒（撤回完成须覆盖后代全集）', () => {
    const outcome = validateRevocationEvidence(envelope('REC-EVD-RVK', revocationPayload()), {
      liveDescendants: ['desc-1', 'desc-2'],
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.descendants_inventory')
  })

  it('收割批次幂等键重复投递 → 拒（去重）', () => {
    const outcome = validateHarvestBatch(envelope('REC-EVD-01', harvestPayload()), { duplicateDelivery: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.idempotency_key')
  })
})
