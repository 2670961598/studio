/**
 * rec-chg-cap.test.ts —— CHG 变更链＋CAP 能力供给「一族一正一负」
 * （MIG-03 / IMPL-03-02；NEG-REC-07／NEG-REC-08 底行）
 *
 * 依据：v2/17 §4.3 NEG-REC-07（两道门合并/受益方单方分类/判据变更覆盖原结论 R-8/R-24/无验证生效为零）
 *   ＋NEG-REC-08（E-3/E-4/E-11：换能力不重认/降验收口径冒完成/职级高即资格/声明超证据），V1＋V3——
 *   本文件落 V1 形状腿）｜v2/11 §八（CHG-01 段记录）、§九（CAP 四类）、§14.4（能力状态链/变更链段）｜
 *   v2/09 ENU-77/78/39/72/73。
 */
import { describe, expect, it } from 'vitest'
import { validateChangeSegment, nextChangeSegments } from '../../../src/records/chg.ts'
import {
  validateCapabilityActivation,
  validateCapabilityDeclaration,
  validateCapabilityReceipt,
  validateQualificationDecision,
} from '../../../src/records/cap.ts'
import { AT, decisionFace, envelope, issuePaths, oref, ref } from './fixtures.ts'

const PROOF = { proofBoundary: '证明边界：本记录证明所述判断，不证明未列范围' }

// —— CHG 夹具 ——

function impactAssessment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tasks: [],
    information: [],
    permissions: [],
    commitments: [],
    evidence: [],
    qualifications: [],
    in_flight_side_effects: [],
    ...overrides,
  }
}

function segmentPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chain_id: 'chain-1',
    segment: 'candidate',
    subject: oref('rule-1'),
    subject_kind: 'rule',
    decided_by: 'unit-head-1',
    authority_ref: ref('REC-AUTH-01'),
    basis_refs: [ref('REC-WORK-17')],
    impact_assessment: impactAssessment(),
    criteria_version: 'criteria@1.0.0',
    no_override: true,
    rollback_path: {
      stop_conditions: ['撤回率升高'],
      monitoring: ['MON-14 变更与进化'],
      rollback_steps: ['回退旧版本并清理'],
    },
    dissent_position: '无异议',
    effective_state: 'effective',
    effective_time: AT,
    ...overrides,
  }
}

// —— CAP 夹具 ——

function claim(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    中立能力与类型: '工具型能力声明',
    实现与来源: 'studio-next 内置，MIT',
    宿主与绑定: 'dsh 宿主，本地绑定',
    依赖与冲突: '无冲突',
    输入输出与已知限制: '输入 JSON，输出结论；不支持流式',
    副作用请求: ['request_read', 'request_write'],
    生命周期: { supported: ['start', 'stop', 'retire'], unsupported: ['snapshot'] },
    观测与成本: '可给真实事件，无成本盲区',
    证据与已知不能: '声明由能力部作出，证明范围仅本地',
    ...overrides,
  }
}

function declarationPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    claim: claim(),
    claimant: 'capability-dept',
    version: '1.0.0',
    evidence_refs: [ref('REC-CAP-RECEIPT')],
    ...overrides,
  }
}

function qualificationPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subject: ref('REC-CAP-01'),
    scope: 'W-07 任务内的只读检索',
    conclusion: 'recognized',
    conditions: [],
    term: { expires_at: AT, renewal_rule: '过期即失效，不默认延续' },
    evidence_refs: [ref('REC-CAP-RECEIPT')],
    decided_by: 'audit-1',
    independence: { verified_by: 'audit-1', control_basis_ref: ref('REC-LIFE-05'), structurally_unavailable: false },
    review_and_invalidation: {
      review_point: AT,
      invalidation_rule: '运行时偏离即失效',
      dispute_entry: '资格争议入口',
    },
    ...overrides,
  }
}

function receiptPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    receipt_kind: 'probing',
    capability_ref: ref('REC-CAP-01'),
    capability_digest: 'sha256:cap-1',
    probe_method: { method: '按探针清单逐项执行', checklist_ref: oref('PRB-01') },
    environment: { host_form: 'dsh', environment: 'local', version: '1.0.0' },
    result: { proved: true, evidence_refs: [oref('probe-log-1')], negative_findings: [] },
    collector_identity: { collector: 'host-receipt', channel: '宿主回执', independent: true },
    observed_at: AT,
    ...overrides,
  }
}

function diff(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { added: [], removed: [], basis_ref: oref('diff-basis-1'), ...overrides }
}

function activationPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chain_ref: ref('REC-CHG-01'),
    capability_set: [{ capability_ref: ref('REC-CAP-01'), version: '1.0.0' }],
    permission_diff: diff(),
    secret_class_diff: diff({ basis_ref: oref('diff-basis-2') }),
    supply_confirmation_ref: ref('REC-CAP-RECEIPT'),
    in_flight_pinning: [ref('REC-WORK-05')],
    approval_basis: ['独立验证通过且有供给确认'],
    rollback_path: '回退旧版本并在途钉旧版',
    dissent_position: '无异议',
    decision_face: decisionFace(),
    proof_boundary: '证明激活批准边界与双差分；不证明运行时已生效',
    ...overrides,
  }
}

describe('CHG-01 变更链段正例（段序/三门/判据版本）', () => {
  it('首段 candidate：链标识＋对象类别＋影响评估＋回退路径 → 放行', () => {
    expect(validateChangeSegment(envelope('REC-CHG-01', segmentPayload()))).toEqual({ ok: true })
  })

  it('实质分类段：classification_basis 齐备且受益方未单方分类 → 放行', () => {
    const payload = segmentPayload({
      segment: 'substantive_classification',
      classification_basis: {
        criteria: ['是否触及判据资产'],
        classification: '判据变更（须走三门）',
        beneficiary_involvement: '受益方仅提供材料，不参与分类',
      },
    })
    expect(validateChangeSegment(envelope('REC-CHG-01', payload), { previousSegment: 'candidate' })).toEqual({ ok: true })
  })

  it('激活批准段：三段验证齐备后成立（不跳段）→ 放行', () => {
    const payload = segmentPayload({ segment: 'activation_approval' })
    expect(validateChangeSegment(envelope('REC-CHG-01', payload), { previousSegment: 'independent_verification' })).toEqual({ ok: true })
  })

  it('受控生效段：三门段已成立＋controlled_rollout 齐备 → 放行', () => {
    const payload = segmentPayload({
      segment: 'controlled_effective',
      controlled_rollout: { scope: '仅内部工作区', fencing: '独占交接', monitoring: ['MON-14'] },
    })
    const outcome = validateChangeSegment(envelope('REC-CHG-01', payload), {
      previousSegment: 'activation_approval',
      establishedSegments: ['verification_authorization', 'independent_verification', 'activation_approval'],
    })
    expect(outcome).toEqual({ ok: true })
  })

  it('段序表：后验观察之后只能进入 保留/停止/恢复/修复 分支', () => {
    expect(nextChangeSegments('post_review')).toEqual(['retain', 'stop', 'restore', 'repair'])
    expect(nextChangeSegments('post_chain_duty')).toEqual([])
    expect(nextChangeSegments(undefined)).toEqual(['candidate'])
  })
})

describe('NEG-REC-07 变更链拒绝条件（跳段/三门合并/受益方分类/R-8/无验证生效）', () => {
  it('跳段（candidate 之后直接验证授权）→ 拒（不可跳段）', () => {
    const payload = segmentPayload({ segment: 'verification_authorization' })
    const outcome = validateChangeSegment(envelope('REC-CHG-01', payload), { previousSegment: 'candidate' })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.segment')
  })

  it('三门由同一位置作出 → 拒（三门不合并）', () => {
    const payload = segmentPayload({ segment: 'activation_approval', decided_by: 'same-decider' })
    const outcome = validateChangeSegment(envelope('REC-CHG-01', payload), {
      previousSegment: 'independent_verification',
      gateDeciders: {
        verification_authorization: 'same-decider',
        independent_verification: 'same-decider',
        activation_approval: 'same-decider',
      },
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.decided_by')
  })

  it('判据变更覆盖原结论 → 拒（R-8：新口径只向前适用）', () => {
    const outcome = validateChangeSegment(envelope('REC-CHG-01', segmentPayload({ no_override: false })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.no_override')
  })

  it('受控生效前无验证段 → 拒（无验证生效为零）', () => {
    const payload = segmentPayload({
      segment: 'controlled_effective',
      controlled_rollout: { scope: '全公司', fencing: '无', monitoring: ['MON-14'] },
    })
    const outcome = validateChangeSegment(envelope('REC-CHG-01', payload), {
      previousSegment: 'activation_approval',
      establishedSegments: [],
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome).filter((path) => path === 'payload.segment').length).toBe(3)
  })

  it('受益方单方作出实质分类 → 拒（R-24）', () => {
    const payload = segmentPayload({
      segment: 'substantive_classification',
      classification_basis: { criteria: ['类型'], classification: '提示词微调', beneficiary_involvement: '受益方自定' },
    })
    const outcome = validateChangeSegment(envelope('REC-CHG-01', payload), {
      previousSegment: 'candidate',
      classifiedByBeneficiary: true,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.decided_by')
  })
})

describe('CAP 四类正例（§九 字段齐备）', () => {
  it('01 能力声明：九维齐备＋明确不支持项 → 放行', () => {
    expect(validateCapabilityDeclaration(envelope('REC-CAP-01', declarationPayload()))).toEqual({ ok: true })
  })

  it('02 资格认定：独立认定位置＋期限＋复审与失效规则 → 放行', () => {
    expect(validateQualificationDecision(envelope('REC-CAP-02', qualificationPayload()))).toEqual({ ok: true })
  })

  it('RECEIPT 能力回执：宿主回执＋proved＋环境范围 → 放行', () => {
    expect(validateCapabilityReceipt(envelope('REC-CAP-RECEIPT', receiptPayload()))).toEqual({ ok: true })
  })

  it('RECEIPT 负向结果（not_proved 含负向发现）→ 放行', () => {
    const payload = receiptPayload({ result: { proved: false, evidence_refs: [oref('probe-log-2')], negative_findings: ['挂载后不可见'] } })
    expect(validateCapabilityReceipt(envelope('REC-CAP-RECEIPT', payload))).toEqual({ ok: true })
  })

  it('ACTIVATE 能力激活批准：双差分单列＋供给确认＋在途钉旧版 → 放行', () => {
    expect(validateCapabilityActivation(envelope('REC-CAP-ACTIVATE', activationPayload(), PROOF))).toEqual({ ok: true })
  })
})

describe('NEG-REC-08 能力供给拒绝条件（自证/职级即资格/自报冒生效/三门倒推）', () => {
  it('认定者＝提供方或直接受益方 → 拒（E-4 自证）', () => {
    const outcome = validateQualificationDecision(envelope('REC-CAP-02', qualificationPayload()), {
      providerOrBeneficiaryIsDecider: true,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.decided_by')
  })

  it('以职级高/安装成功作为资格依据 → 拒（E-11）', () => {
    const outcome = validateQualificationDecision(envelope('REC-CAP-02', qualificationPayload()), { rankOrInstallOnly: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.evidence_refs')
  })

  it('独立性结构性不可得却给「承认」→ 拒（E-13）', () => {
    const payload = qualificationPayload({
      independence: { verified_by: 'audit-1', control_basis_ref: ref('REC-LIFE-05'), structurally_unavailable: true },
    })
    const outcome = validateQualificationDecision(envelope('REC-CAP-02', payload))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.independence')
  })

  it('自报线索冒充「已生效」证明 → 拒（采集者独立性）', () => {
    const payload = receiptPayload({ collector_identity: { collector: 'executor-self', channel: '自报线索', independent: false } })
    const outcome = validateCapabilityReceipt(envelope('REC-CAP-RECEIPT', payload), { claimsEffective: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.collector_identity')
  })

  it('not_proved 却无负向发现（探测不能记录负向结果）→ 拒', () => {
    const payload = receiptPayload({ result: { proved: false, evidence_refs: [oref('probe-log-3')], negative_findings: [] } })
    const outcome = validateCapabilityReceipt(envelope('REC-CAP-RECEIPT', payload))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.result.negative_findings')
  })

  it('「验证已通过」倒推激活批准 → 拒（三门不合并）', () => {
    const outcome = validateCapabilityActivation(envelope('REC-CAP-ACTIVATE', activationPayload(), PROOF), {
      inferredFromVerification: true,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('recordType')
  })

  it('权限差分与秘密差分被合并 → 拒（HCL-2 双差分须单列）', () => {
    const outcome = validateCapabilityActivation(envelope('REC-CAP-ACTIVATE', activationPayload(), PROOF), { diffsMerged: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.permission_diff')
  })

  it('在途出工未钉旧版 → 拒（新版本不自动适用于在途）', () => {
    const outcome = validateCapabilityActivation(
      envelope('REC-CAP-ACTIVATE', activationPayload({ in_flight_pinning: [] }), PROOF),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.in_flight_pinning')
  })

  it('声明超证据（无证据引用声称已验证）→ 拒', () => {
    const outcome = validateCapabilityDeclaration(envelope('REC-CAP-01', declarationPayload({ evidence_refs: [] })), {
      claimsBeyondEvidence: true,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.evidence_refs')
  })

  it('生命周期维无「明确不支持」项（隐藏限制）→ 拒', () => {
    const payload = declarationPayload({
      claim: claim({ 生命周期: { supported: ['start', 'stop'], unsupported: [] } }),
    })
    const outcome = validateCapabilityDeclaration(envelope('REC-CAP-01', payload))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.claim.生命周期.unsupported')
  })
})
