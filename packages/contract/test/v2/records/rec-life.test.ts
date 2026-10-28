/**
 * rec-life.test.ts —— LIFE 生命周期族「一族一正一负」（MIG-03 / IMPL-03-01；NEG-REC-02 底行）
 *
 * 依据：v2/17 §3.4（LIFE 11：NEG-REC-02 拆身份避禁配/无限期暂停/未结清宣称退役/终态复活/虚记层级/空编静默，
 *   V1＋V3——本文件只落 **V1 形状腿**）｜v2/11 §3.1/§3.2（LIFE-01..11 字段与不变量）、§14.2（L-01..L-10）、
 *   §14.3（身份四态边）、§十五-2（跨记录不变量：G9 必引 root_delegation、绩效/出工前置、终止两角）。
 */
import { describe, expect, it } from 'vitest'
import {
  validateAppointment,
  validateContinuityDecision,
  validateEmploymentSettlement,
  validateEmploymentTransition,
  validateIdentityTransition,
  validateOrgEvent,
} from '../../../src/records/life.ts'
import type { AppointmentContext } from '../../../src/records/life.ts'
import {
  appointmentPayload,
  continuityPayload,
  decisionFace,
  envelope,
  identityTransitionPayload,
  issuePaths,
  orgVacancyPayload,
  settlementPayload,
  transitionPayload,
} from './fixtures.ts'

const G9_EXTERNAL: AppointmentContext = {
  positionGrade: 'G9',
  appointingAuthorityClass: 'external_owner',
  nominatorClass: 'external_owner',
}

describe('LIFE-01 任命与任职关系（正例）', () => {
  it('G9 任命：引 root_delegation、外部老板任免与提名、五条件齐备且接受 → 放行', () => {
    expect(validateAppointment(envelope('REC-LIFE-01', appointmentPayload()), G9_EXTERNAL)).toEqual({ ok: true })
  })

  it('跳级任免带 vacancy_layer_note（缺失事实逐层点名＋替代评价来源＋理由）→ 放行', () => {
    const payload = appointmentPayload({
      vacancy_layer_note: {
        skipped_layers: [
          { layer: 'G8-dept-1', missing_fact: '空编' },
          { layer: 'G8-dept-2', missing_fact: '未设岗' },
        ],
        substitute_evaluation_source: '跨层评价＋外部审计抽样',
        rationale: '中间层空缺且无在位者，按 v2/03 §3.3 规则 3 逐层说明',
      },
    })
    const outcome = validateAppointment(envelope('REC-LIFE-01', payload), { ...G9_EXTERNAL, rankGap: 3 })
    expect(outcome).toEqual({ ok: true })
  })
})

describe('NEG-REC-02 LIFE 拒绝条件（拆身份避禁配/虚记层级/不经程序生效）', () => {
  it('任命缺累计禁配结论（conflict_check_ref）→ 拒（禁配未查不得任命）', () => {
    const payload = appointmentPayload()
    delete payload['conflict_check_ref']
    const outcome = validateAppointment(envelope('REC-LIFE-01', payload), G9_EXTERNAL)
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.conflict_check_ref')
  })

  it('G9 由内部位置任免 → 拒（任免最高宰相是保留给外部的动作）', () => {
    const outcome = validateAppointment(envelope('REC-LIFE-01', appointmentPayload()), {
      ...G9_EXTERNAL,
      appointingAuthorityClass: 'internal_boss',
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.appointing_authority_ref')
  })

  it('职级差 >2 却无 vacancy_layer_note → 拒（虚记层级/向空缺层征附议＝程序非法）', () => {
    const outcome = validateAppointment(envelope('REC-LIFE-01', appointmentPayload()), { ...G9_EXTERNAL, rankGap: 3 })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.vacancy_layer_note')
  })

  it('五条件未齐备却置生效 → 拒（决定≠接受，五条件齐备才可生效）', () => {
    const payload = appointmentPayload({
      acceptance_time: undefined,
      entry_gate_results: {
        authority: { satisfied: true },
        qualification: { satisfied: false },
        conflict: { satisfied: true },
        handover: { satisfied: true },
        acceptance: { satisfied: true },
      },
    })
    const outcome = validateAppointment(envelope('REC-LIFE-01', payload), G9_EXTERNAL)
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.entry_gate_results')
  })
})

describe('LIFE-02 任职状态迁移（正例＋非法迁移/无限期暂停）', () => {
  it('对照面：L-07 在岗→交接中，带期限且异议=「无异议」→ 放行', () => {
    expect(validateEmploymentTransition(envelope('REC-LIFE-02', transitionPayload()))).toEqual({ ok: true })
  })

  it('终态复活：已退役→在岗 → 拒（表外即非法，返回合法出口）', () => {
    const outcome = validateEmploymentTransition(
      envelope('REC-LIFE-02', transitionPayload({ from_state: 'retired', to_state: 'active' })),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.to_state')
    const message = outcome.ok ? '' : outcome.issues.map((issue) => issue.message).join('|')
    expect(message).toContain('合法出口')
  })

  it('无限期暂停（既无期限也无复审条件）→ 拒（I-11）', () => {
    const outcome = validateEmploymentTransition(envelope('REC-LIFE-02', transitionPayload({ to_state: 'suspended', review_terms: {} })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.review_terms')
  })

  it('未结清宣称退役（L-09 未引 REC-LIFE-03 结清面）→ 拒', () => {
    const outcome = validateEmploymentTransition(
      envelope('REC-LIFE-02', transitionPayload({ from_state: 'settling', to_state: 'retired', evidence_refs: [{ refType: 'REC-RCP-01', refId: 'rcp-1', refVersion: '1.0.0' }] })),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.evidence_refs')
  })

  it('已结清（L-09 引 REC-LIFE-03）→ 放行', () => {
    const outcome = validateEmploymentTransition(
      envelope('REC-LIFE-02', transitionPayload({ from_state: 'settling', to_state: 'retired', evidence_refs: [{ refType: 'REC-LIFE-03', refId: 'life-03-1', refVersion: '1.0.0' }] })),
    )
    expect(outcome).toEqual({ ok: true })
  })

  it('异议「—」且无来源引用 → 拒（缺载且无「无异议」表示）', () => {
    const outcome = validateEmploymentTransition(envelope('REC-LIFE-02', transitionPayload({ dissent_position: '—' })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.dissent_position')
  })

  it('异议「无异议」→ 不得拒写（只可因「缺载且无表示」拒写）', () => {
    expect(validateEmploymentTransition(envelope('REC-LIFE-02', transitionPayload({ dissent_position: '无异议' })))).toEqual({ ok: true })
  })
})

describe('LIFE-03 任职结清核验（两段式；reservation 须列责任者与到期）', () => {
  it('对照面：结清面逐项 closed → 放行', () => {
    expect(validateEmploymentSettlement(envelope('REC-LIFE-03', settlementPayload()))).toEqual({ ok: true })
  })

  it('保留事项缺责任者/到期 → 拒（ENU-126）', () => {
    const outcome = validateEmploymentSettlement(
      envelope('REC-LIFE-03', settlementPayload({ checklist_items: [{ item: '授权与访问', state: 'reservation' }] })),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.checklist_items.0')
  })
})

describe('LIFE-07/08/09 组织侧（终态不复活/空编静默/终止两角同体）', () => {
  it('身份迁移 active→suspended（具名决定＋通知＋代次冻结）→ 放行', () => {
    expect(validateIdentityTransition(envelope('REC-LIFE-07', identityTransitionPayload()))).toEqual({ ok: true })
  })

  it('终态复活：liquidated→active → 拒（O-05 禁止边，只能新设身份逐项承继）', () => {
    const outcome = validateIdentityTransition(
      envelope('REC-LIFE-07', identityTransitionPayload({ from_state: 'liquidated', to_state: 'active' })),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.to_state')
  })

  it('空编静默：vacancy_register 无复审期限 → 拒（超期补设或降级二选一必答）', () => {
    const payload = orgVacancyPayload()
    delete payload['review_terms']
    const outcome = validateOrgEvent(envelope('REC-LIFE-08', { ...payload, event_kind: 'vacancy_register', vacancy_rule: undefined }))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.review_terms')
  })

  it('终止两角同体（external_receiver 与 residual_subject 同引用）→ 拒（I-16）', () => {
    const outcome = validateContinuityDecision(
      envelope('REC-LIFE-09', continuityPayload({
        terminal_roles: { external_receiver_ref: { refId: 'same-1', refVersion: '1.0.0' }, residual_subject_ref: { refId: 'same-1', refVersion: '1.0.0' }, distinct_confirmed: true },
      })),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.terminal_roles')
  })

  it('对照面：终止两角分设且 distinct_confirmed=true → 放行', () => {
    expect(validateContinuityDecision(envelope('REC-LIFE-09', continuityPayload()))).toEqual({ ok: true })
  })

  it('存续方为清算态 → 拒（存续方只能 active）', () => {
    const outcome = validateContinuityDecision(
      envelope('REC-LIFE-09', continuityPayload({
        parties: [
          { party_ref: { refId: 'company-a', refVersion: '1.0.0' }, role: '存续方', identity_state: 'liquidated' },
          { party_ref: { refId: 'company-b', refVersion: '1.0.0' }, role: '被并入方', identity_state: 'active' },
        ],
      })),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.parties.0.identity_state')
  })

  it('决定面生效槽与信封不一致（信封 effective / 决定面 pending）→ 拒（§0.5）', () => {
    const outcome = validateIdentityTransition(
      envelope('REC-LIFE-07', identityTransitionPayload({ decision_face: decisionFace({ effective_state: 'pending', effective_time: undefined }) })),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.effective_state')
  })

  it('CL 判据不是结构事实（structure_evidence 空）→ 拒（只改 level 字段无效）', () => {
    const outcome = validateOrgEvent(envelope('REC-LIFE-08', orgVacancyPayload({ structure_evidence: [] })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.structure_evidence')
  })
})
