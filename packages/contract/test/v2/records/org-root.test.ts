/**
 * org-root.test.ts —— NEG-ORG-09/11/12/13/14/15 的 **V1 形状腿**（MIG-03 / IMPL-03-01）
 *
 * 依据：v2/17 §4.1（七行 NEG-ORG-09..15；本文件落 09/11/12/13/14/15 六行）＋§4.1 末的 N 参数正例面
 *   （N=1/N=3/N=5 不写死 3）；v2/11 §2.2（AUTH-01/02/03/04）、§3.1（LIFE-01）、§3.2（LIFE-08）、§四（PERF-01）；
 *   v2/15 §七（SEC-ROOT-02..05）；v2/03 §2.2/§3.1/§3.3（G9/G8、单元缺位、根授予）；v2/01 I-16。
 *
 * 口径（V1＝契约/形状层）：只断言「形状拒绝条件」与「放行路径必须不存在」，不打桩 LLM、不做真机腿；
 * 启动面 `CONFIG_INVALID` 拒启与网关逃逸属 V3（07-06/07-10 领土），本文件不代证。
 */
import { describe, expect, it } from 'vitest'
import {
  checkRootActionPreflight,
  validateAuthExercise,
  validateAuthGrant,
  validateCredentialReference,
} from '../../../src/records/auth.ts'
import { checkUnitDomainDisjoint, validateAppointment, validateOrgEvent } from '../../../src/records/life.ts'
import { validatePerformanceEvaluation } from '../../../src/records/perf.ts'
import type { AppointmentContext } from '../../../src/records/life.ts'
import {
  AT,
  appointmentPayload,
  credentialPayload,
  envelope,
  exercisePayload,
  issuePaths,
  orgVacancyPayload,
  perfPayload,
  rootGrantPayload,
  unitClaims,
} from './fixtures.ts'

/** G9 外部老板线的合法判定输入（NEG-ORG-09 的对照面） */
const G9_EXTERNAL: AppointmentContext = {
  positionGrade: 'G9',
  appointingAuthorityClass: 'external_owner',
  nominatorClass: 'external_owner',
}

/** 根动作 preflight 的合法判定输入 */
const ROOT_OK = {
  actorClass: 'internal_boss',
  grantorClass: 'external_owner',
  proofVerified: true,
  fingerprintMatches: true,
} as const

const IN_SCOPE_ACTION = { action_scope: ['approve_internal_hard_action'], at: AT }

describe('NEG-ORG-09：无有效 root_delegation 的最高宰相（缺证明/验签不过/指纹不符/内部程序补位）', () => {
  it('G9 任命缺 root_delegation_ref → 拒（缺失即任命不得生效）', () => {
    const payload = appointmentPayload()
    delete payload['root_delegation_ref']
    const outcome = validateAppointment(envelope('REC-LIFE-01', payload), G9_EXTERNAL)
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.root_delegation_ref')
  })

  it('root_delegation_ref 指向非 REC-AUTH-01 → 拒（内部程序不得补位）', () => {
    const outcome = validateAppointment(
      envelope('REC-LIFE-01', appointmentPayload({ root_delegation_ref: { refType: 'REC-DEC-01', refId: 'dec-9', refVersion: '1.0.0' } })),
      G9_EXTERNAL,
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.root_delegation_ref.refType')
  })

  it('根授予验签不过 → 签发面 preflight 拒', () => {
    const outcome = checkRootActionPreflight(envelope('REC-AUTH-01', rootGrantPayload()), IN_SCOPE_ACTION, {
      ...ROOT_OK,
      proofVerified: false,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.external_signature')
  })

  it('root key 指纹不符 → 签发面 preflight 拒', () => {
    const outcome = checkRootActionPreflight(envelope('REC-AUTH-01', rootGrantPayload()), IN_SCOPE_ACTION, {
      ...ROOT_OK,
      fingerprintMatches: false,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.key_fingerprint')
  })

  it('根授予的授予人不是外部老板 → 拒（只能由外部老板签发）', () => {
    const outcome = validateAuthGrant(envelope('REC-AUTH-01', rootGrantPayload()), {
      grantorClass: 'internal_boss',
      proofVerified: true,
      fingerprintMatches: true,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.grantor')
  })

  it('对照面：证明/指纹/范围/期限齐备且外部老板签发 → 放行', () => {
    const outcome = checkRootActionPreflight(envelope('REC-AUTH-01', rootGrantPayload()), IN_SCOPE_ACTION, ROOT_OK)
    expect(outcome).toEqual({ ok: true })
  })
})

describe('NEG-ORG-11：子 agent 持 root key（凭据类别闸＋行使身份闸）', () => {
  it('credential_class=root 挂在非最高宰相名下 → 拒（供给面已破）', () => {
    const outcome = validateCredentialReference(envelope('REC-AUTH-04', credentialPayload()), {
      holderClass: 'internal_position',
      boundGrantClass: 'root_delegation',
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.credential_class')
  })

  it('root 凭据绑定 grant_class=delegation → 拒（root 必绑 root_delegation）', () => {
    const outcome = validateCredentialReference(envelope('REC-AUTH-04', credentialPayload()), {
      holderClass: 'internal_boss',
      boundGrantClass: 'delegation',
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.bound_grant')
  })

  it('子 agent 取 on_behalf_of=internal_boss → 拒（该值仅最高宰相本人可用）', () => {
    const outcome = validateAuthExercise(
      envelope('REC-AUTH-02', exercisePayload({ on_behalf_of: 'internal_boss', root_use: true, root_delegation_ref: { refType: 'REC-AUTH-01', refId: 'root-1', refVersion: '1.0.0' } })),
      { actorClass: 'derived_executor' },
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.on_behalf_of')
  })

  it('scoped 凭据原地改类为 root → 拒（升级须新授予＋新凭据记录）', () => {
    const outcome = validateCredentialReference(envelope('REC-AUTH-04', credentialPayload()), {
      holderClass: 'internal_boss',
      boundGrantClass: 'root_delegation',
      previousClass: 'scoped',
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.credential_class')
  })

  it('对照面：最高宰相持 root 且绑定 root_delegation → 放行', () => {
    const outcome = validateCredentialReference(envelope('REC-AUTH-04', credentialPayload()), {
      holderClass: 'internal_boss',
      boundGrantClass: 'root_delegation',
    })
    expect(outcome).toEqual({ ok: true })
  })
})

describe('NEG-ORG-12：root 超范围（scope 外/term 外/非最高宰相行 root）', () => {
  it('动作越出 root_delegation 的 scope → 签发面拒（违约，处置走外部撤回/轮换）', () => {
    const outcome = checkRootActionPreflight(
      envelope('REC-AUTH-01', rootGrantPayload()),
      { action_scope: ['external_audit'], at: AT },
      ROOT_OK,
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('request.action_scope')
  })

  it('动作时刻越出 root_delegation 的 term → 拒（期限外签发＝无权）', () => {
    const outcome = checkRootActionPreflight(
      envelope('REC-AUTH-01', rootGrantPayload()),
      { action_scope: ['approve_internal_hard_action'], at: '2028-01-01T00:00:00Z' },
      ROOT_OK,
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('request.at')
  })

  it('一级单元首长行 root → 拒（「对内是老板」不构成内部程序合法性）', () => {
    const outcome = checkRootActionPreflight(envelope('REC-AUTH-01', rootGrantPayload()), IN_SCOPE_ACTION, {
      ...ROOT_OK,
      actorClass: 'internal_position',
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('actorClass')
  })

  it('已撤回/到期的 root 不得用于新签发 → 拒', () => {
    const outcome = checkRootActionPreflight(envelope('REC-AUTH-01', rootGrantPayload()), IN_SCOPE_ACTION, {
      ...ROOT_OK,
      revokedOrExpired: true,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.term')
  })
})

describe('NEG-ORG-13：N 个一级单元的域边界（域重叠＝结构违规；N 不写死 3）', () => {
  it('两个单元对同一域各自主张权威 → 判负（域重叠/双主表）', () => {
    const outcome = checkUnitDomainDisjoint([
      { unitId: 'unit-1', domain: 'delivery' },
      { unitId: 'unit-2', domain: 'delivery' },
    ])
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('claims.1.domain')
  })

  it('同一单元主张两个域 → 判负（一单元一域）', () => {
    const outcome = checkUnitDomainDisjoint([
      { unitId: 'unit-1', domain: 'delivery' },
      { unitId: 'unit-1', domain: 'research' },
    ])
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('claims.1.unitId')
  })

  it('N=1（退化单层）一单元一域 → 放行', () => {
    expect(checkUnitDomainDisjoint(unitClaims(1))).toEqual({ ok: true })
  })

  it('N=3 三单元一域一权 → 放行（N 是配置参数，不是规范常量）', () => {
    expect(checkUnitDomainDisjoint(unitClaims(3))).toEqual({ ok: true })
  })

  it('N=5 五单元一域一权 → 放行（不写死 3 的对照面）', () => {
    expect(checkUnitDomainDisjoint(unitClaims(5))).toEqual({ ok: true })
  })
})

describe('NEG-ORG-14：单元缺位静默（缺位不登记/缺位期新增 G8/空编无复审期限）', () => {
  it('unit_vacancy 缺 vacancy_rule → 拒（须直管＋缺位期禁新增 G8）', () => {
    const payload = orgVacancyPayload()
    delete payload['vacancy_rule']
    const outcome = validateOrgEvent(envelope('REC-LIFE-08', payload))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.vacancy_rule')
  })

  it('unit_vacancy 缺复审期限 → 拒（空编/缺位合法但必须可见，不得静默）', () => {
    const payload = orgVacancyPayload()
    delete payload['review_terms']
    const outcome = validateOrgEvent(envelope('REC-LIFE-08', payload))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.review_terms')
  })

  it('一级单元类事件缺 unit_ref（N 计数前后值）→ 拒', () => {
    const payload = orgVacancyPayload()
    delete payload['unit_ref']
    const outcome = validateOrgEvent(envelope('REC-LIFE-08', payload))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.unit_ref')
  })

  it('N 变更把单元数写死 3 → 拒（N≥1、默认 1，写死＝结构判据造假）', () => {
    const payload = orgVacancyPayload({
      event_kind: 'unit_count_change',
      unit_ref: { unitId: 'unit-2', unit_count_before: 2, unit_count_after: 3 },
    })
    const outcome = validateOrgEvent(envelope('REC-LIFE-08', payload))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.unit_ref.unit_count_after')
  })

  it('缺位期该单元新增 G8（无紧急例外双角色记录）→ 拒', () => {
    const outcome = validateAppointment(envelope('REC-LIFE-01', appointmentPayload()), {
      positionGrade: 'G8_unit_head',
      appointingAuthorityClass: 'internal_boss',
      nominatorClass: 'internal_position',
      unitVacant: true,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.dual_role_record')
  })

  it('对照面：登记齐全的 unit_vacancy → 放行', () => {
    expect(validateOrgEvent(envelope('REC-LIFE-08', orgVacancyPayload()))).toEqual({ ok: true })
  })
})

describe('NEG-ORG-15：自审自称独立（审计标注闸；唯一独立是 external）', () => {
  it('同体自审却填 audit_class=external → 拒（不得自称独立）', () => {
    const payload = perfPayload({
      evaluator_and_independence: {
        evaluator_ref: { refType: 'REC-LIFE-01', refId: 'rec-1', refVersion: '1.0.0' },
        audit_class: 'external',
        independence_claimed: true,
      },
    })
    const outcome = validatePerformanceEvaluation(envelope('REC-PERF-01', payload, { proofBoundary: '证明：五维结论；不证明：外部独立' }), {
      sameBody: true,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.evaluator_and_independence.audit_class')
  })

  it('内部老板自审却声明独立 → 拒（自审必标「内部老板自审」）', () => {
    const payload = perfPayload({
      evaluator_and_independence: {
        evaluator_ref: { refType: 'REC-LIFE-01', refId: 'rec-1', refVersion: '1.0.0' },
        audit_class: 'internal_boss_self_audit',
        independence_claimed: true,
      },
    })
    const outcome = validatePerformanceEvaluation(envelope('REC-PERF-01', payload, { proofBoundary: '证明：五维；不证明：独立' }), { sameBody: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.evaluator_and_independence.independence_claimed')
  })

  it('外部锚未建成却填 external → 拒（GAP-V2-03 fail-closed）', () => {
    const payload = perfPayload({
      evaluator_and_independence: {
        evaluator_ref: { refType: 'REC-LIFE-01', refId: 'rec-1', refVersion: '1.0.0' },
        audit_class: 'external',
        independence_claimed: true,
      },
    })
    const outcome = validatePerformanceEvaluation(envelope('REC-PERF-01', payload, { proofBoundary: '证明：五维；不证明：独立' }), {
      sameBody: false,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.evaluator_and_independence.audit_class')
  })

  it('对照面：同体自审标 internal_boss_self_audit 且不声明独立 → 放行', () => {
    const payload = perfPayload({
      evaluator_and_independence: {
        evaluator_ref: { refType: 'REC-LIFE-01', refId: 'rec-1', refVersion: '1.0.0' },
        audit_class: 'internal_boss_self_audit',
        independence_claimed: false,
      },
    })
    const outcome = validatePerformanceEvaluation(envelope('REC-PERF-01', payload, { proofBoundary: '证明：五维结论；不证明：独立' }), {
      sameBody: true,
    })
    expect(outcome).toEqual({ ok: true })
  })
})
