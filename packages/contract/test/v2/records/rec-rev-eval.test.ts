/**
 * rec-rev-eval.test.ts —— REV 复盘＋EVAL 结构评价「一族一正一负」
 * （MIG-03 / IMPL-03-02；NEG-REC-09 底行）
 *
 * 依据：v2/17 §4.3 NEG-REC-09（复盘追认化/评价掩盖协调失败/评价未被接收，V1——本文件落 V1 形状腿）｜
 *   v2/11 §十（REV/EVAL 字段与不变量）｜v2/05 OBJ-04/OBJ-05｜v2/09 ENU-79｜v2/01 I-3/I-11/R-22。
 */
import { describe, expect, it } from 'vitest'
import { validateReview } from '../../../src/records/rev.ts'
import { validateStructuralEvaluation } from '../../../src/records/eval.ts'
import { TERM, decisionFace, envelope, issuePaths, oref, ref } from './fixtures.ts'

function reviewPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scope: { matters: [ref('REC-WORK-12')], window: { from: TERM.from, to: TERM.to } },
    inputs: {
      acceptance_refs: [ref('REC-WORK-09')],
      cost_account_ref: ref('REC-EVD-04'),
      counterparty_feedback: ['相对方对时点有异议'],
      affected_party_feedback: [],
      contrary_examples: ['同一口径在另一单上失效'],
      unfulfilled_commitments: [ref('REC-WORK-15')],
    },
    findings: [{ finding: '口径变更未同步验收位置', basis_refs: [ref('REC-WORK-17')] }],
    outputs: {
      personal_experience_refs: [ref('REC-MEM-01')],
      method_rule_candidates: [ref('REC-CHG-01')],
      structural_issues: [ref('REC-EVAL-01')],
    },
    independence: { decided_by: 'audit-1', independence_note: '复盘位置不由被交付方单独作出' },
    dissent_position: '无异议；复盘结论自身可被异议与重开',
    decision_face: decisionFace(),
    ...overrides,
  }
}

function evaluationPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: { kind: '部门结构', ref: oref('dept-1') },
    criteria: {
      existence_reason: '承担资产部职责',
      cost: '每季 2 人月',
      vacancy_state: '无空编',
      coordination_failure_masking: '当前无新增层级主张',
      overall_resource_trend: '整体资源持平',
    },
    inputs: {
      org_performance_basis: [ref('REC-OBS-01')],
      resource_account_ref: ref('REC-EVD-04'),
      exception_trend_refs: [ref('REC-WORK-17')],
    },
    conclusion: 'maintain',
    decision_routing: { decision_body: 'g9.internal-boss', procedure_ref: ref('REC-LIFE-08') },
    dissent_position: '无异议',
    decision_face: decisionFace(),
    ...overrides,
  }
}

describe('REV/EVAL 正例（§十 字段齐备）', () => {
  it('REV-01 复盘：输入含代价账与反例、产出三去向、异议位置齐 → 放行', () => {
    expect(validateReview(envelope('REC-REV-01', reviewPayload()))).toEqual({ ok: true })
  })

  it('EVAL-01 结构评价：判据五面＋组织绩效输入＋决定去向 → 放行', () => {
    expect(validateStructuralEvaluation(envelope('REC-EVAL-01', evaluationPayload()))).toEqual({ ok: true })
  })
})

describe('NEG-REC-09 复盘/结构评价拒绝条件（追认化/掩盖协调失败/未被接收）', () => {
  it('以复盘结论补授权（复盘≠追认）→ 拒', () => {
    const outcome = validateReview(envelope('REC-REV-01', reviewPayload()), { usedToRatifyAuthorization: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.outputs')
  })

  it('以复盘结论改写验收历史 → 拒', () => {
    const outcome = validateReview(envelope('REC-REV-01', reviewPayload()), { rewritesAcceptanceHistory: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.inputs.acceptance_refs')
  })

  it('负价值漏记 → 拒（I-3）', () => {
    const outcome = validateReview(envelope('REC-REV-01', reviewPayload()), { negativeValueOmitted: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.inputs.cost_account_ref')
  })

  it('方法与规则候选直接生效（未入变更链）→ 拒', () => {
    const outcome = validateReview(envelope('REC-REV-01', reviewPayload()), { methodCandidateTakesEffectDirectly: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.outputs.method_rule_candidates')
  })

  it('以新增层级掩盖协调失败 → 拒（R-22 语义）', () => {
    const outcome = validateStructuralEvaluation(envelope('REC-EVAL-01', evaluationPayload()), {
      addsLayerToMaskCoordinationFailure: true,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.conclusion')
  })

  it('评价未被接收却当作已闭环 → 拒（I-11）', () => {
    const outcome = validateStructuralEvaluation(envelope('REC-EVAL-01', evaluationPayload()), { received: false })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.decision_routing')
  })

  it('评价位置处于被评价结构自审位 → 拒（分层审计上提）', () => {
    const outcome = validateStructuralEvaluation(envelope('REC-EVAL-01', evaluationPayload()), {
      evaluatorInSelfReviewPosition: true,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.decision_face.decided_by')
  })

  it('复盘位置独立性自填 → 拒', () => {
    const outcome = validateReview(
      envelope('REC-REV-01', reviewPayload({ independence: { decided_by: 'audit-1', independence_note: '自认独立', self_declared: true } })),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.independence')
  })

  it('复盘缺反例与未兑现承诺输入（只捡有利证据）→ 由输入槽位必填兜底：缺 cost_account 即拒', () => {
    const payload = reviewPayload()
    delete (payload['inputs'] as Record<string, unknown>)['cost_account_ref']
    const outcome = validateReview(envelope('REC-REV-01', payload))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome).some((path) => path.includes('cost_account_ref'))).toBe(true)
  })

  it('EVAL 结论值集封闭（借用验收四值「accepted」→ 拒）', () => {
    const outcome = validateStructuralEvaluation(envelope('REC-EVAL-01', evaluationPayload({ conclusion: 'accepted' })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome).some((path) => path.includes('conclusion'))).toBe(true)
  })

  it('EVAL 输入缺组织绩效口径（无依据的结构建议）→ 拒', () => {
    const outcome = validateStructuralEvaluation(
      envelope('REC-EVAL-01', evaluationPayload({ inputs: { org_performance_basis: [], resource_account_ref: ref('REC-EVD-04'), exception_trend_refs: [] } })),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome).some((path) => path.includes('org_performance_basis'))).toBe(true)
  })
})
