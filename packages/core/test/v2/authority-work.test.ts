/**
 * test/v2/authority-work —— 授权链纯判定（PORT-AUTH 面）＋开工五门三值（v2/04 §四）
 *
 * 依据：docs/v2/14 §1.2（PORT-AUTH verify/withdraw 判定面）、v2/11 REC-AUTH-01/02/03
 *       （父授予包含、on_behalf_of、撤回后代枚举与停用证据）、v2/04 §四/§五（开工五门、
 *       三值结论、重判触发）、v2/09 ENU-31/130/137/138/139（四态与停用证据/授权子类型/
 *       证明模式/行使身份）、ENU-08/12（受理五取值/开工三值）；docs/plan/04 §三（V1 负例）。
 *
 * 零 IO：不 import fs/net/child_process；时点全部显式传入（epoch 毫秒），不看真实时钟。
 */
import { describe, expect, it } from 'vitest'
import type { ExerciseClaimInput, GrantLink, WithdrawalRequestInput } from '../../src/authority.ts'
import {
  checkWithdrawalCompleteness,
  descendantGrants,
  isEffectivelyWithdrawn,
  rootDelegationFailure,
  verifyGrantChain,
} from '../../src/authority.ts'
import type { WorkReadinessInput } from '../../src/work-readiness.ts'
import { judgeWorkReadiness, isValidCondition, requiresWorkRejudgment } from '../../src/work-readiness.ts'

// ─────────────────────────────────────────────────────────────────────────────
// 一、授权链夹具（最小输入接口；不是记录形状）
// ─────────────────────────────────────────────────────────────────────────────

const ROOT: GrantLink = {
  grantId: 'g-root',
  grantClass: 'root_delegation',
  grantor: 'external-boss',
  grantorKind: 'external_boss',
  grantee: 'internal-boss',
  purpose: 'company.operations',
  scope: ['issue.work', 'sign.contract', 'deploy.prod'],
  reservedScopes: ['deploy.prod'],
  conditions: ['audit.read'],
  term: { fromMs: 0 },
  delegable: true,
  proof: { proofMode: 'ritual_and_key', keyFingerprint: 'sha256:abcd', externalSignatureRef: 'sig-1' },
}

const DELEGATION: GrantLink = {
  grantId: 'g-dev',
  grantClass: 'delegation',
  grantor: 'internal-boss',
  grantorKind: 'internal_position',
  grantee: 'dept-head',
  parentGrantId: 'g-root',
  purpose: 'company.operations',
  scope: ['issue.work'],
  conditions: ['audit.read', 'dept.quorum'],
  term: { fromMs: 10, untilMs: 1000 },
  delegable: false,
}

const SUB_DELEGATION: GrantLink = {
  ...DELEGATION,
  grantId: 'g-sub',
  grantor: 'dept-head',
  grantee: 'team-lead',
  parentGrantId: 'g-dev',
  scope: ['issue.work'],
}

function claim(overrides: Partial<ExerciseClaimInput> = {}): ExerciseClaimInput {
  return {
    grantId: 'g-dev',
    exercisedBy: 'dept-head',
    action: 'issue.work',
    scope: ['issue.work'],
    onBehalfOf: 'self',
    atMs: 100,
    ...overrides,
  }
}

function kindsOf(verdict: { readonly refusals: readonly { readonly kind: string }[] }): string[] {
  return verdict.refusals.map((refusal) => refusal.kind)
}

describe('PORT-AUTH verify：父范围包含与链完整性（I-6「授权不放大」）', () => {
  it('合法链（root_delegation → delegation）→ permitted，链序自根到叶', () => {
    const verdict = verifyGrantChain({ grants: [ROOT, DELEGATION], claim: claim() })
    expect(verdict.state).toBe('permitted')
    expect(verdict.chain).toEqual(['g-root', 'g-dev'])
    expect(verdict.refusals).toEqual([])
  })

  it('明细外扩（scope 超出父）→ prohibited scope-widening；超出授予本身亦拒', () => {
    const widened: GrantLink = { ...DELEGATION, scope: ['issue.work', 'admin.root'] }
    const verdict = verifyGrantChain({ grants: [ROOT, widened], claim: claim() })
    expect(verdict.state).toBe('prohibited')
    expect(kindsOf(verdict)).toContain('scope-widening')
    const outside = verifyGrantChain({ grants: [ROOT, DELEGATION], claim: claim({ scope: ['sign.contract'], action: 'sign.contract' }) })
    expect(outside.state).toBe('prohibited')
    expect(kindsOf(outside)).toContain('scope-widening')
  })

  it('期限不得外扩且主张时点须在全链期限内', () => {
    // 父有界而子越界＝期限外扩；父无界时子可自定到期（不得反向：期限只可收紧）
    const boundedRoot: GrantLink = { ...ROOT, term: { fromMs: 0, untilMs: 500 } }
    const longer: GrantLink = { ...DELEGATION, term: { fromMs: 10, untilMs: 5000 } }
    expect(kindsOf(verifyGrantChain({ grants: [boundedRoot, longer], claim: claim() }))).toContain('term-outside')
    const expired = verifyGrantChain({ grants: [ROOT, DELEGATION], claim: claim({ atMs: 1000 }) })
    expect(expired.state).toBe('prohibited')
    expect(kindsOf(expired)).toContain('instant-outside-term')
  })

  it('条件不得被稀释（子须完整携带父条件，可追加）', () => {
    const diluted: GrantLink = { ...DELEGATION, conditions: ['dept.quorum'] }
    expect(kindsOf(verifyGrantChain({ grants: [ROOT, diluted], claim: claim() }))).toContain('condition-widening')
  })

  it('父不可再授（delegable=false）仍有子授予 → not-delegable', () => {
    const bad: GrantLink = { ...DELEGATION }
    const child: GrantLink = { ...SUB_DELEGATION }
    const verdict = verifyGrantChain({ grants: [ROOT, bad, child], claim: claim({ grantId: 'g-sub', exercisedBy: 'team-lead' }) })
    expect(kindsOf(verdict)).toContain('not-delegable')
  })

  it('主体不连续（子 grantor ≠ 父 grantee）→ chain-discontinuous', () => {
    const discontinuous: GrantLink = { ...DELEGATION, grantor: 'someone-else' }
    expect(kindsOf(verifyGrantChain({ grants: [ROOT, discontinuous], claim: claim() }))).toContain('chain-discontinuous')
  })

  it('断链/环 → prohibited（parent-missing / chain-cycle）；未知授予 → uncovered（与 prohibited 不同态）', () => {
    const broken: GrantLink = { ...DELEGATION, parentGrantId: 'g-nope' }
    expect(kindsOf(verifyGrantChain({ grants: [broken], claim: claim() }))).toContain('parent-missing')
    const cycleA: GrantLink = { ...DELEGATION, grantId: 'g-a', parentGrantId: 'g-b' }
    const cycleB: GrantLink = { ...DELEGATION, grantId: 'g-b', parentGrantId: 'g-a' }
    expect(kindsOf(verifyGrantChain({ grants: [cycleA, cycleB], claim: claim({ grantId: 'g-a' }) }))).toContain('chain-cycle')
    const unknown = verifyGrantChain({ grants: [ROOT, DELEGATION], claim: claim({ grantId: 'g-missing' }) })
    expect(unknown.state).toBe('uncovered')
    expect(kindsOf(unknown)).toEqual(['grant-not-found'])
  })
})

describe('PORT-AUTH verify：root_delegation 范围/期限/证明与 on_behalf_of', () => {
  it('根授予证明缺项/非 ritual_and_key/指纹空/无签名或离线件 → root-proof-invalid', () => {
    // 缺证明面：显式省略键（exactOptionalPropertyTypes 下不得写 proof: undefined）
    const rootWithoutProof: GrantLink = {
      grantId: ROOT.grantId,
      grantClass: ROOT.grantClass,
      grantor: ROOT.grantor,
      grantorKind: ROOT.grantorKind,
      grantee: ROOT.grantee,
      purpose: ROOT.purpose,
      scope: ROOT.scope,
      conditions: ROOT.conditions,
      term: ROOT.term,
      delegable: ROOT.delegable,
    }
    const variants: readonly GrantLink[] = [
      rootWithoutProof,
      { ...ROOT, proof: { ...ROOT.proof!, proofMode: 'record_only' } },
      { ...ROOT, proof: { ...ROOT.proof!, keyFingerprint: '  ' } },
      { ...ROOT, proof: { proofMode: 'ritual_and_key', keyFingerprint: 'sha256:abcd' } },
    ]
    for (const variant of variants) {
      expect(rootDelegationFailure(variant)?.kind).toBe('root-proof-invalid')
      expect(kindsOf(verifyGrantChain({ grants: [variant, DELEGATION], claim: claim() }))).toContain('root-proof-invalid')
    }
  })

  it('根授予 grantor 非外部老板 → root-grantor-not-external（最高宰相/agent 不得自签根）', () => {
    const selfSigned: GrantLink = { ...ROOT, grantorKind: 'internal_position' }
    expect(rootDelegationFailure(selfSigned)?.kind).toBe('root-grantor-not-external')
    expect(rootDelegationFailure({ ...ROOT, parentGrantId: 'g-parent' })?.kind).toBe('root-parent-present')
  })

  it('on_behalf_of=internal_boss：仅根授予的被授予者本人可行使，且 withheld_scope 必空', () => {
    const rootUse = verifyGrantChain({
      grants: [ROOT],
      claim: claim({ grantId: 'g-root', exercisedBy: 'internal-boss', action: 'sign.contract', scope: ['sign.contract'], onBehalfOf: 'internal_boss' }),
    })
    expect(rootUse.state).toBe('permitted')
    // 子 agent（持普通 delegation）取 internal_boss → prohibited
    const subAgent = verifyGrantChain({ grants: [ROOT, DELEGATION], claim: claim({ onBehalfOf: 'internal_boss' }) })
    expect(subAgent.state).toBe('prohibited')
    expect(kindsOf(subAgent)).toContain('on-behalf-of-forbidden')
    // withheld_scope 非空（保留面）→ prohibited
    const withheld = verifyGrantChain({
      grants: [ROOT],
      claim: claim({ grantId: 'g-root', exercisedBy: 'internal-boss', action: 'sign.contract', scope: ['sign.contract'], onBehalfOf: 'internal_boss', withheldScope: ['deploy.prod'] }),
    })
    expect(kindsOf(withheld)).toContain('withheld-scope-not-empty')
  })

  it('保留区（reservedScopes）→ reserved 态（命中但须指定位置决定，不自行放行）', () => {
    const reserved = verifyGrantChain({
      grants: [ROOT],
      claim: claim({ grantId: 'g-root', exercisedBy: 'internal-boss', action: 'deploy.prod', scope: ['deploy.prod'], onBehalfOf: 'self' }),
    })
    expect(reserved.state).toBe('reserved')
    expect(reserved.refusals).toEqual([])
  })

  it('撤回：祖先已撤回则后代不可用（parent-withdrawn）；isEffectivelyWithdrawn 沿父链判定', () => {
    const withdrawnRoot: GrantLink = { ...ROOT, withdrawnAtMs: 50 }
    const verdict = verifyGrantChain({ grants: [withdrawnRoot, DELEGATION], claim: claim() })
    expect(verdict.state).toBe('prohibited')
    expect(kindsOf(verdict)).toContain('parent-withdrawn')
    expect(isEffectivelyWithdrawn([withdrawnRoot, DELEGATION], 'g-dev')).toBe(true)
    expect(isEffectivelyWithdrawn([ROOT, DELEGATION], 'g-dev')).toBe(false)
  })

  it('确定性：同 grants 同 claim 两次判定逐字段相等（零 IO 纯函数）', () => {
    const first = verifyGrantChain({ grants: [ROOT, DELEGATION], claim: claim() })
    const second = verifyGrantChain({ grants: [ROOT, DELEGATION], claim: claim() })
    expect(second).toEqual(first)
  })
})

describe('PORT-AUTH withdraw：后代枚举＋停用证据＋无后代确认＋轮换后继', () => {
  const request = (overrides: Partial<WithdrawalRequestInput> = {}): WithdrawalRequestInput => ({
    rootGrantId: 'g-root',
    withdrawnAtMs: 500,
    enumeratedDescendants: ['g-dev'],
    deactivationEvidence: [{ grantId: 'g-dev', kind: 'revocation_receipt', evidenceRef: 'ev-1' }],
    ...overrides,
  })

  it('后代逐项枚举且有停用证据 → complete（含多级后代）', () => {
    expect(descendantGrants([ROOT, DELEGATION], 'g-root')).toEqual(['g-dev'])
    expect(descendantGrants([ROOT, DELEGATION, SUB_DELEGATION], 'g-root')).toEqual(['g-dev', 'g-sub'])
    const multi = checkWithdrawalCompleteness({
      grants: [ROOT, DELEGATION, SUB_DELEGATION],
      request: request({
        enumeratedDescendants: ['g-dev', 'g-sub'],
        deactivationEvidence: [
          { grantId: 'g-dev', kind: 'revocation_receipt', evidenceRef: 'ev-1' },
          { grantId: 'g-sub', kind: 'fence_rejection_record', evidenceRef: 'ev-2' },
        ],
      }),
    })
    expect(multi.complete).toBe(true)
  })

  it('后代未全枚举／已枚举无停用证据 → 不得记完成（missing / unevidenced 逐项指名）', () => {
    const missing = checkWithdrawalCompleteness({ grants: [ROOT, DELEGATION, SUB_DELEGATION], request: request() })
    expect(missing.complete).toBe(false)
    expect(missing.missing).toContain('g-sub')
    const unevidenced = checkWithdrawalCompleteness({ grants: [ROOT, DELEGATION], request: request({ deactivationEvidence: [] }) })
    expect(unevidenced.complete).toBe(false)
    expect(unevidenced.unevidenced).toEqual(['g-dev'])
  })

  it('无后代须显式确认＋探测方法（空数组不得冒充「查过了」）；轮换须 successor_grant', () => {
    const silent = checkWithdrawalCompleteness({
      grants: [ROOT],
      request: request({ enumeratedDescendants: [], deactivationEvidence: [] }),
    })
    expect(silent.complete).toBe(false)
    expect(silent.findings).toContain('no-descendants-not-confirmed')
    const confirmed = checkWithdrawalCompleteness({
      grants: [ROOT],
      request: request({ enumeratedDescendants: [], deactivationEvidence: [], noDescendantsConfirmed: true, probeMethod: 'process-scan+vault-list' }),
    })
    expect(confirmed.complete).toBe(true)
    const rotation = checkWithdrawalCompleteness({
      grants: [ROOT, DELEGATION],
      request: request({ rotation: true }),
    })
    expect(rotation.complete).toBe(false)
    expect(rotation.findings).toContain('successor-grant-missing')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 二、开工五门（v2/04 §四；三值 ENU-12）
// ─────────────────────────────────────────────────────────────────────────────

const CONDITION = { description: '补授权决定', ownerRef: 'boss', dueAtMs: 9_000 }

function baseInput(overrides: Partial<WorkReadinessInput> = {}): WorkReadinessInput {
  return {
    authority: { state: 'permitted', evidenceRef: 'auth-1' },
    capability: { qualificationRef: 'qual-1', evaluatedAtMs: 100, validUntilMs: 200 },
    prohibition: { state: 'clear', evidenceRef: 'ban-1' },
    resource: { state: 'sufficient', evidenceRef: 'res-1', nextReviewAtMs: 150 },
    acceptance: {
      intake: 'accepted',
      acceptanceCriteria: ['REPORT 落盘', '闸门 exit=0'],
      verificationPositionRef: 'verify-1',
    },
    ...overrides,
  }
}

describe('开工五门：三值结论（缺门=不可开工，不 fail-open）', () => {
  it('五门全过 → ready（逐门结论＋留痕引用齐备）', () => {
    const verdict = judgeWorkReadiness(baseInput())
    expect(verdict.verdict).toBe('ready')
    expect(verdict.gates.every((gate) => gate.verdict === 'pass')).toBe(true)
    expect(verdict.missingGates).toEqual([])
    expect(verdict.conditions).toEqual([])
    expect(verdict.evidenceRefs.length).toBeGreaterThanOrEqual(5)
  })

  it('缺任一/全部门 → not_ready（缺门不是 pass；missingGates 逐门列出）', () => {
    const empty = judgeWorkReadiness({})
    expect(empty.verdict).toBe('not_ready')
    expect(empty.missingGates).toEqual(['authority', 'capability', 'prohibition', 'resource', 'acceptance'])
    // 缺resource门：显式省略该键（不写 resource: undefined）
    const partial = judgeWorkReadiness({
      authority: { state: 'permitted', evidenceRef: 'auth-1' },
      capability: { qualificationRef: 'qual-1', evaluatedAtMs: 100, validUntilMs: 200 },
      prohibition: { state: 'clear', evidenceRef: 'ban-1' },
      acceptance: { intake: 'accepted', acceptanceCriteria: ['x'], verificationPositionRef: 'verify-1' },
    })
    expect(partial.verdict).toBe('not_ready')
    expect(partial.missingGates).toEqual(['resource'])
  })

  it('资源门：unknown≠充足、缺省≠0 → not_ready', () => {
    const unknown = judgeWorkReadiness(baseInput({ resource: { state: 'unknown', evidenceRef: 'res-x', nextReviewAtMs: null } }))
    expect(unknown.verdict).toBe('not_ready')
    expect(unknown.gates.find((gate) => gate.gate === 'resource')?.verdict).toBe('unknown')
    const insufficient = judgeWorkReadiness(baseInput({ resource: { state: 'insufficient', evidenceRef: 'res-0', nextReviewAtMs: null } }))
    expect(insufficient.verdict).toBe('not_ready')
  })

  it('能力门：过期/有效期不可知 → not_ready（资格未证在有效期内不得开工）', () => {
    const expired = judgeWorkReadiness(baseInput({ capability: { qualificationRef: 'q', evaluatedAtMs: 300, validUntilMs: 200 } }))
    expect(expired.verdict).toBe('not_ready')
    expect(expired.gates.find((gate) => gate.gate === 'capability')?.reason).toBe('capability-expired')
    const unknown = judgeWorkReadiness(baseInput({ capability: { qualificationRef: 'q', evaluatedAtMs: 100, validUntilMs: null } }))
    expect(unknown.gates.find((gate) => gate.gate === 'capability')?.verdict).toBe('unknown')
    expect(unknown.verdict).toBe('not_ready')
  })

  it('禁止门：明确禁止与未覆盖都不可开工（未覆盖按保留事项转呈，不是允许）', () => {
    const hit = judgeWorkReadiness(baseInput({ prohibition: { state: 'prohibited', evidenceRef: 'ban-2' } }))
    expect(hit.verdict).toBe('not_ready')
    expect(hit.gates.find((gate) => gate.gate === 'prohibition')?.reason).toBe('prohibition-hit')
    const uncovered = judgeWorkReadiness(baseInput({ prohibition: { state: 'uncovered', evidenceRef: 'ban-3' } }))
    expect(uncovered.verdict).toBe('not_ready')
    expect(uncovered.gates.find((gate) => gate.gate === 'prohibition')?.reason).toBe('prohibition-uncovered')
  })

  it('权源门：prohibited/uncovered → not_ready；reserved 须附条件（条件三要素齐备）', () => {
    expect(judgeWorkReadiness(baseInput({ authority: { state: 'prohibited', evidenceRef: 'a' } })).verdict).toBe('not_ready')
    expect(judgeWorkReadiness(baseInput({ authority: { state: 'uncovered', evidenceRef: 'a' } })).verdict).toBe('not_ready')
    const reservedUndecided = judgeWorkReadiness(baseInput({ authority: { state: 'reserved', evidenceRef: 'a' } }))
    expect(reservedUndecided.verdict).toBe('not_ready')
    expect(reservedUndecided.gates.find((gate) => gate.gate === 'authority')?.reason).toBe('authority-reserved-undecided')
    const reservedConditional = judgeWorkReadiness(baseInput({ authority: { state: 'reserved', evidenceRef: 'a', condition: CONDITION } }))
    expect(reservedConditional.verdict).toBe('conditional_ready')
    expect(reservedConditional.conditions).toHaveLength(1)
  })

  it('接受门：受理拒绝/暂缓/转呈、口径为空、责任位置空缺 → not_ready；附条件受理须条件齐备', () => {
    for (const intake of ['rejected', 'hold', 'referred'] as const) {
      expect(judgeWorkReadiness(baseInput({ acceptance: { intake, acceptanceCriteria: ['x'], verificationPositionRef: 'v' } })).verdict).toBe('not_ready')
    }
    const emptyCriteria = judgeWorkReadiness(baseInput({ acceptance: { intake: 'accepted', acceptanceCriteria: ['  '], verificationPositionRef: 'v' } }))
    expect(emptyCriteria.verdict).toBe('not_ready')
    expect(emptyCriteria.gates.find((gate) => gate.gate === 'acceptance')?.reason).toBe('acceptance-criteria-empty')
    const noPosition = judgeWorkReadiness(baseInput({ acceptance: { intake: 'accepted', acceptanceCriteria: ['x'] } }))
    expect(noPosition.verdict).toBe('not_ready')
    expect(noPosition.gates.find((gate) => gate.gate === 'acceptance')?.reason).toBe('acceptance-position-missing')
    const conditionalMissing = judgeWorkReadiness(baseInput({ acceptance: { intake: 'conditional_accepted', acceptanceCriteria: ['x'], verificationPositionRef: 'v' } }))
    expect(conditionalMissing.verdict).toBe('not_ready')
    const conditional = judgeWorkReadiness(
      baseInput({ acceptance: { intake: 'conditional_accepted', acceptanceCriteria: ['x'], verificationPositionRef: 'v', condition: CONDITION } }),
    )
    expect(conditional.verdict).toBe('conditional_ready')
  })

  it('附条件三要素校验与重判触发（未知变化亦须重判＝fail-closed）', () => {
    expect(isValidCondition(CONDITION)).toBe(true)
    expect(isValidCondition({ description: 'd', ownerRef: '', dueAtMs: 1 })).toBe(false)
    expect(isValidCondition({ description: 'd', ownerRef: 'o', dueAtMs: Number.NaN })).toBe(false)
    for (const change of [
      'scope_change',
      'resource_change',
      'capability_degraded',
      'capability_replaced',
      'holder_change',
      'execution_config_change',
      'new_prohibition',
      'information_falsified',
      'external_condition_change',
      'effect_level_upgrade',
    ]) {
      expect(requiresWorkRejudgment(change)).toBe(true)
    }
    expect(requiresWorkRejudgment('unexpected_change')).toBe(true)
    expect(requiresWorkRejudgment('none')).toBe(false)
  })

  it('确定性：同输入两次判定逐字段相等（纯函数，无宿主读取）', () => {
    const input = baseInput({ authority: { state: 'reserved', evidenceRef: 'a', condition: CONDITION } })
    expect(judgeWorkReadiness(input)).toEqual(judgeWorkReadiness(input))
  })
})
