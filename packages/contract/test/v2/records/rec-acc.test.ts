/**
 * rec-acc.test.ts —— ACC 问责救济族「一族一正一负」（MIG-03 / IMPL-03-02；NEG-REC-06 底行）
 *
 * 依据：v2/17 §4.3 NEG-REC-06（无申辩窗口/裁判不独立/争议期间抵销/不经程序改任命，V1＋V3——
 *   本文件落 V1 形状腿）｜v2/11 §七（ACC 两类字段/不变量/出口）、§〇.3-2（ACC-02 决定面）、
 *   §〇.7-1（ACC 族 proof_boundary 必填）｜v2/09 ENU-37 问责结论、ENU-38 救济类别。
 */
import { describe, expect, it } from 'vitest'
import { validateAccountabilityCase, validateRemedyDecision } from '../../../src/records/acc.ts'
import { AT, decisionFace, envelope, issuePaths, oref, ref } from './fixtures.ts'

function casePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subject_ref: ref('REC-LIFE-01'),
    matter_refs: [ref('REC-WORK-17'), ref('REC-EVD-04')],
    inquiry_materials: {
      allegations: ['验收结论与证据不符'],
      explanations: ['口径在期间被变更'],
      adverse_information: ['未按口径暂停'],
      silence_treated_as_report_exception: false,
    },
    defense_window: { deadline: AT, overdue_disposition: '逾期按窗口条款处置并留痕' },
    arbiter: { verified_by: 'audit-1', control_basis_ref: ref('REC-LIFE-05') },
    conclusion: 'attribution_undetermined',
    consequence_routing: { performance_input_ref: ref('REC-PERF-01') },
    dissent_position: '无异议；救济入口见申诉链',
    proof_boundary: '证明问责过程与结论；不证明民事/外部责任',
    ...overrides,
  }
}

function remedyPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    case_ref: ref('REC-ACC-01'),
    remedy_kind: 'record_correction',
    beneficiaries: [{ beneficiary_ref: oref('holder-h1'), application_entry: '申诉入口' }],
    executor: oref('unit-head-1'),
    execution_evidence: [ref('REC-COR-01')],
    settlement_confirmation: { settled: true, confirmed_by: 'audit-1', confirmed_at: AT },
    non_compensable_boundary: '不可补偿损害不由公司或受益委托方单方认定',
    affected_party_channel: '受影响者异议通道（I-15）',
    dissent_position: '无异议',
    decision_face: decisionFace(),
    proof_boundary: '证明救济处置与执行证据；不证明损害已终局消解',
    ...overrides,
  }
}

describe('ACC 两类正例（§七 字段齐备）', () => {
  it('01 问责案例：申辩窗口有期限＋独立裁判＋「暂不能归因」合法结论 → 放行', () => {
    expect(validateAccountabilityCase(envelope('REC-ACC-01', casePayload()))).toEqual({ ok: true })
  })

  it('02 救济决定：决定面齐＋执行证据＋不可补偿边界＋受影响者通道 → 放行', () => {
    expect(validateRemedyDecision(envelope('REC-ACC-02', remedyPayload()))).toEqual({ ok: true })
  })

  it('02 执行不能＝未决登记（未结清但保留义务）→ 放行', () => {
    const payload = remedyPayload({ settlement_confirmation: { settled: false, confirmed_by: null, confirmed_at: null } })
    expect(validateRemedyDecision(envelope('REC-ACC-02', payload))).toEqual({ ok: true })
  })
})

describe('NEG-REC-06 问责救济拒绝条件（窗口/独立性/抵销/绕程序）', () => {
  it('无申辩窗口（既无期限也无复审条件）→ 拒（I-11）', () => {
    const outcome = validateAccountabilityCase(
      envelope('REC-ACC-01', casePayload({ defense_window: { overdue_disposition: '逾期处置' } })),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.defense_window')
  })

  it('裁判与被问责者同体 → 拒（独立裁判不成立）', () => {
    const outcome = validateAccountabilityCase(envelope('REC-ACC-01', casePayload()), { arbiterSameAsSubject: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.arbiter')
  })

  it('独立性自填 → 拒（自填即拒收）', () => {
    const outcome = validateAccountabilityCase(
      envelope('REC-ACC-01', casePayload({ arbiter: { verified_by: 'audit-1', control_basis_ref: ref('REC-LIFE-05'), self_declared: true } })),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.arbiter')
  })

  it('后果流向绕过 v2/03 程序改变任命 → 拒（E-6 断言面）', () => {
    const outcome = validateAccountabilityCase(envelope('REC-ACC-01', casePayload()), {
      routesAppointmentChangeWithoutProcedure: true,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.consequence_routing')
  })

  it('争议期间以内部收益抵销 → 拒（I-15）', () => {
    const outcome = validateRemedyDecision(envelope('REC-ACC-02', remedyPayload()), { offsettingDuringDispute: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.non_compensable_boundary')
  })

  it('声明已结清却无具名确认者 → 拒（执行不能＝未决登记）', () => {
    const payload = remedyPayload({ settlement_confirmation: { settled: true, confirmed_by: null, confirmed_at: AT } })
    const outcome = validateRemedyDecision(envelope('REC-ACC-02', payload))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.settlement_confirmation.confirmed_by')
  })

  it('无执行证据却声明救济结清 → 拒', () => {
    const payload = remedyPayload({ execution_evidence: [] })
    const outcome = validateRemedyDecision(envelope('REC-ACC-02', payload), { claimsSettledWithoutEvidence: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome).some((path) => path.includes('execution_evidence'))).toBe(true)
  })
})
