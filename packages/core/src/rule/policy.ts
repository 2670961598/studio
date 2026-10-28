/**
 * rule/policy —— 策略消费侧判定：方向表（RULE-05）与档升级变更链（RULE-01）
 *
 * 依据：
 *   - v2/10 §6.2 RULE-05 方向表（政策四态 ENU-31：`permitted` 条件 unknown→不命中；
 *     `reserved`→命中（须指定位置决定）；`prohibited`→命中（禁止优先）；`uncovered` 与
 *     「无命中」→不得执行且两情形诊断必须区分）；§6.3 相位修正（策略消费侧判定归
 *     `policy`，**策略/审计违规不得配 typecheck 码**）；§八 W-RULE-001（policy：条件解析
 *     出 unknown，按方向表处理）；
 *   - v2/10 §6.2 RULE-01（档升级属变更链：新修订＋新档＋独立验证＋新激活，不得静默改变
 *     既有判定；已撤回档不得新引用，既有引用按原版解释）；v2/10 §八 E-RULE-010（policy：
 *     档版本与引用不一致或已撤回）；
 *   - docs/plan/04 §三 NEG-RULE-08（if 条件 unknown 不求值分支）、NEG-RULE-09（未知档/
 *     未知版本/已撤回档）、NEG-RULE-10（档升级未走变更链即改变既有判定→判负）。
 *
 * 零 IO：不读时钟（证据引用由调用方给），不读环境。
 */

import type { Diagnostic, EvalOutcome, PolicyState, RuleProfileRef, RuleProfileSpec } from '../spec.ts'
import { POLICY_STATES, compareSemver, makeDiagnostic, parseSemver } from '../spec.ts'

// ─────────────────────────────────────────────────────────────────────────────
// 一、方向表（RULE-05）
// ─────────────────────────────────────────────────────────────────────────────

/** 方向判定：hit＝规则命中；miss＝不命中；not-executable＝不得执行（保留/未覆盖/中止） */
export interface PolicyDirection {
  readonly decision: 'hit' | 'miss' | 'not-executable'
  /** `reserved` 命中须指定位置决定（方向表：reserved→命中，须指定位置） */
  readonly requiresPosition: boolean
  readonly diagnostic: Diagnostic | null
}

function unknownDiagnostic(messageKey: string, args: readonly (string | number | boolean)[]): Diagnostic {
  return makeDiagnostic('W-RULE-001', '', messageKey, args)
}

/**
 * 求值结论 × 政策四态 → 执行方向（v2/10 §6.2 RULE-05 方向表）：
 *   `permitted` 条件 unknown → **不命中**（不是命中，也不是「不能判定」）；
 *   `reserved` → 命中，且须指定位置决定；
 *   `prohibited` → 命中（禁止优先；unknown 也不得放行）；
 *   `uncovered` → 不得执行（与「无命中」的 miss 用不同 messageKey 区分）；
 *   refused（求值中止）→ 不得执行——refused 不得读成 false，也不得当作未命中。
 * 一切 unknown 面产生 W-RULE-001（policy 相位，唯一码）。
 */
export function resolvePolicyDirection(input: { readonly state: PolicyState; readonly outcome: EvalOutcome }): PolicyDirection {
  if (!(POLICY_STATES as readonly string[]).includes(input.state)) {
    // 封闭四态之外不可能出现；防御性按未覆盖处理（不得放行）
    return {
      decision: 'not-executable',
      requiresPosition: true,
      diagnostic: unknownDiagnostic('rule/direction/unknown-state', [String(input.state)]),
    }
  }
  if (input.state === 'uncovered') {
    return {
      decision: 'not-executable',
      requiresPosition: true,
      diagnostic: unknownDiagnostic(input.outcome === 'unknown' ? 'rule/direction/uncovered-unknown' : 'rule/direction/uncovered', [input.outcome]),
    }
  }
  if (input.outcome === 'refused') {
    return {
      decision: 'not-executable',
      requiresPosition: false,
      diagnostic: unknownDiagnostic('rule/direction/refused', [input.state]),
    }
  }
  if (input.outcome === 'true') return { decision: 'hit', requiresPosition: false, diagnostic: null }
  if (input.outcome === 'false') return { decision: 'miss', requiresPosition: false, diagnostic: null }
  if (input.state === 'prohibited') {
    return { decision: 'hit', requiresPosition: false, diagnostic: unknownDiagnostic('rule/direction/prohibited-unknown', []) }
  }
  if (input.state === 'reserved') {
    return { decision: 'hit', requiresPosition: true, diagnostic: unknownDiagnostic('rule/direction/reserved-unknown', []) }
  }
  return { decision: 'miss', requiresPosition: false, diagnostic: unknownDiagnostic('rule/direction/permitted-unknown', []) }
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、档升级与判定稳定性（RULE-01；NEG-RULE-10）
// ─────────────────────────────────────────────────────────────────────────────

/** 档升级证据（变更链三联；缺一即不得静默改变既有判定） */
export interface ProfileChangeEvidence {
  readonly changeRecordRef?: string
  readonly verificationRef?: string
  readonly activationRef?: string
}

/** 档升级判定结果 */
export interface ProfileUpgradeVerdict {
  readonly ok: boolean
  readonly diagnostics: readonly Diagnostic[]
}

function policyError(diagnostics: Diagnostic[], location: string, messageKey: string, args: readonly (string | number | boolean)[] = []): void {
  diagnostics.push(makeDiagnostic('E-RULE-010', location, messageKey, args))
}

/**
 * 档升级判定（§6.2 RULE-01）：profileId 不变、版本严格上移、变更链三联齐备。
 * 缺任一证据 → E-RULE-010；「先升级后补流程」不是合法路径（判负面）。
 */
export function checkProfileUpgrade(input: {
  readonly previous: RuleProfileSpec
  readonly next: RuleProfileSpec
  readonly evidence: ProfileChangeEvidence
}): ProfileUpgradeVerdict {
  const diagnostics: Diagnostic[] = []
  if (input.previous.profileId !== input.next.profileId) {
    policyError(diagnostics, '/profileId', 'rule/upgrade-profile-id', [input.previous.profileId, input.next.profileId])
  }
  const previousVersion = parseSemver(input.previous.version)
  const nextVersion = parseSemver(input.next.version)
  if (previousVersion === null || nextVersion === null || compareSemver(nextVersion, previousVersion) <= 0) {
    policyError(diagnostics, '/version', 'rule/profile-version-order', [input.previous.version, input.next.version])
  }
  for (const key of ['changeRecordRef', 'verificationRef', 'activationRef'] as const) {
    const value = input.evidence[key]
    if (value === undefined || value === '') policyError(diagnostics, `/evidence/${key}`, 'rule/change-chain-missing', [key])
  }
  return { ok: diagnostics.length === 0, diagnostics }
}

/** 既有引用的档版本必须逐字一致：不得按「当前最新」解释旧引用（§1.3/RULE-01） */
export function assertProfileRefStable(reference: RuleProfileRef, profile: RuleProfileSpec): readonly Diagnostic[] {
  return reference.profileId === profile.profileId && reference.version === profile.version
    ? []
    : [makeDiagnostic('E-RULE-010', '/ruleProfileRef', 'rule/profile-ref-mismatch', [reference.profileId, reference.version])]
}
