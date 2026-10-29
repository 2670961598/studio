/**
 * neg-org.test.ts —— NEG-ORG 族覆盖补强（contract 记录判定面；MIG-08 补强单）
 *
 * 依据：docs/v2/17 §4.1 NEG-ORG-01（必设岗空编静默）、NEG-ORG-03（权源解析＋跳级任免）、
 *   NEG-ORG-04（审计分层：同层自审→上提一层；顶层=所有者自审明示）；
 *   docs/v2/03 §2.2/§3.3 规则 1/3/§4.2/§八；docs/v2/11 §3.1/§3.2/§十；docs/v2/15 §七（根权面）。
 *
 * 口径（只测生产面真实机制，不造假）：
 *   - NEG-ORG-01：`validateOrgEvent`（REC-LIFE-08）对 vacancy_register 的复审期限闸
 *     （payload superRefine 真实拒绝）＋ company 投影腿见 company/test/v2/neg-org.test.ts；
 *   - NEG-ORG-03：`validateAppointment`（REC-LIFE-01）的跨空缺层说明闸（缺 vacancy_layer_note
 *     ＝向空缺层征虚拟附议＝程序非法）与 G8 部门首长 +1 提议记录闸；
 *   - NEG-ORG-04：`validateStructuralEvaluation`（REC-EVAL-01）的自审位闸（评价位置处于被评价
 *     结构的自审位→拒，按分层审计上提）；顶层「内部老板自审明示」腿已在既有 ORG 15 行覆盖，
 *     本文件不复算。
 *
 * 仍 target（本文件不写假测试）：ORG 族 02/05/08 三行（表 A′ 权力归属/悬空无输入面与拒绝机制；
 *   部门自改硬核在 company/contract 生产面无判据；老板缺席处置仅静态策略投影、无拒绝入口），
 *   以及 03 的「根授予解析不到设立记录」腿（validateAuthGrant 只验证明/签发人/指纹，不解析
 *   parent_grant 是否落到设立记录）。
 *
 * 变异验证（本文件断言对应的生产守卫，逐条临时移除→红，还原→绿）：
 *   - life.ts OrgEventPayloadSchema.superRefine 的「空编/单元缺位必附复审期限」规则（ORG-01）；
 *   - life.ts validateAppointment 的 `crosses` 含 `ctx.crossesVacancy`（ORG-03）；
 *   - eval.ts validateStructuralEvaluation 的 `evaluatorInSelfReviewPosition` 分支（ORG-04）。
 */
import { describe, expect, it } from 'vitest'
import { validateStructuralEvaluation } from '../../src/records/eval.ts'
import { validateAppointment, validateOrgEvent } from '../../src/records/life.ts'
import type { AppointmentContext } from '../../src/records/life.ts'
import {
  appointmentPayload,
  decisionFace,
  envelope,
  issuePaths,
  oref,
  orgVacancyPayload,
  ref,
} from './records/fixtures.ts'

// ───────────────────────── NEG-ORG-01：空编登记必附复审期限 ─────────────────────────

describe('NEG-ORG-01 · 必设岗空编登记（复审期限＋超期处置二选一必答）', () => {
  it('vacancy_register 缺 review_terms（空编静默）→ 记录拒收', () => {
    const payload = orgVacancyPayload({ event_kind: 'vacancy_register' })
    delete payload['unit_ref']
    delete payload['vacancy_rule']
    delete payload['review_terms']
    const outcome = validateOrgEvent(envelope('REC-LIFE-08', payload))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.review_terms')
  })

  it('vacancy_register 带复审期限与超期处置 → 放行（缺口可见即合法）', () => {
    const payload = orgVacancyPayload({ event_kind: 'vacancy_register' })
    delete payload['unit_ref']
    delete payload['vacancy_rule']
    expect(validateOrgEvent(envelope('REC-LIFE-08', payload))).toEqual({ ok: true })
  })

  it('对照面：vacancy_register 复审期限与超期处置二选一留空（只给 deadline 缺 fallback）→ 拒', () => {
    const payload = orgVacancyPayload({ event_kind: 'vacancy_register' })
    delete payload['unit_ref']
    delete payload['vacancy_rule']
    payload['review_terms'] = { deadline: '2026-12-31T00:00:00Z' }
    const outcome = validateOrgEvent(envelope('REC-LIFE-08', payload))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome).some((path) => path.startsWith('payload.review_terms'))).toBe(true)
  })
})

// ───────────────────────── NEG-ORG-03：跳级任免须向实际存在的层征 +1 ─────────────────────────

const G9_EXTERNAL: AppointmentContext = {
  positionGrade: 'G9',
  appointingAuthorityClass: 'external_owner',
  nominatorClass: 'external_owner',
}

const G8_DEPT_HEAD: AppointmentContext = {
  positionGrade: 'G8_dept_head',
  appointingAuthorityClass: 'internal_boss',
  nominatorClass: 'internal_boss',
}

describe('NEG-ORG-03 · 权源解析与跳级任免（跨空缺层须 vacancy_layer_note；+2 不得绕过 +1）', () => {
  it('跨空缺层任免缺 vacancy_layer_note → 拒（向空缺层征虚拟附议＝程序非法）', () => {
    const outcome = validateAppointment(envelope('REC-LIFE-01', appointmentPayload()), {
      ...G9_EXTERNAL,
      crossesVacancy: true,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.vacancy_layer_note')
  })

  it('对照面：跨空缺层带「缺失事实＋替代评价来源＋理由」→ 放行（不设虚拟附议）', () => {
    const payload = appointmentPayload({
      vacancy_layer_note: {
        skipped_layers: [
          { layer: 'G8-部门首长', missing_fact: '空编' },
          { layer: 'G8-单元首长', missing_fact: '未设岗' },
        ],
        substitute_evaluation_source: '跨单元互审＋外部审计抽样',
        rationale: '中间层无在位者，按 v2/03 §3.3 规则 3 逐层记缺失事实',
      },
    })
    const outcome = validateAppointment(envelope('REC-LIFE-01', payload), { ...G9_EXTERNAL, crossesVacancy: true })
    expect(outcome).toEqual({ ok: true })
  })

  it('G8 部门首长任命缺 +1 提议记录（decision_basis_ref 非提议类型）→ 拒', () => {
    const outcome = validateAppointment(
      envelope('REC-LIFE-01', appointmentPayload({ decision_basis_ref: ref('REC-RCP-01', 'receipt-1') })),
      G8_DEPT_HEAD,
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.decision_basis_ref.refType')
  })

  it('对照面：G8 部门首长任命引一级单元首长提议（REC-DEC-01）→ 放行', () => {
    expect(validateAppointment(envelope('REC-LIFE-01', appointmentPayload()), G8_DEPT_HEAD)).toEqual({ ok: true })
  })
})

// ───────────────────────── NEG-ORG-04：审计分层（自审位须上提一层） ─────────────────────────

function structuralEvaluationPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: { kind: '部门结构', ref: oref('dept-engineering') },
    criteria: {
      existence_reason: '承接交付域职责',
      cost: '两个 G8 岗位＋一处 D8 部门',
      vacancy_state: '部门首长在编，无空编',
      coordination_failure_masking: '不新增层级，仅评价现有结构',
      overall_resource_trend: '持平',
    },
    inputs: {
      org_performance_basis: [ref('REC-PERF-01')],
      resource_account_ref: ref('REC-WORK-12'),
      exception_trend_refs: [ref('REC-OBS-03')],
    },
    conclusion: 'maintain',
    decision_routing: { decision_body: 'g9.internal-boss', procedure_ref: ref('REC-DEC-01') },
    dissent_position: '无异议',
    decision_face: decisionFace(),
    ...overrides,
  }
}

describe('NEG-ORG-04 · 审计分层（同层自审/审计者=本次评价者→上提一层）', () => {
  it('评价位置处于被评价结构的自审位 → 拒（按 v2/03 分层审计上提一层）', () => {
    const outcome = validateStructuralEvaluation(envelope('REC-EVAL-01', structuralEvaluationPayload()), {
      evaluatorInSelfReviewPosition: true,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.decision_face.decided_by')
  })

  it('自审结论被当作已闭环（未被接收）→ 拒（I-11：评价未被接收＝异常）', () => {
    const outcome = validateStructuralEvaluation(envelope('REC-EVAL-01', structuralEvaluationPayload()), {
      received: false,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.decision_routing')
  })

  it('对照面：分层上提后的评价位置（非自审位）＋已接收 → 放行', () => {
    expect(validateStructuralEvaluation(envelope('REC-EVAL-01', structuralEvaluationPayload()))).toEqual({ ok: true })
  })
})
