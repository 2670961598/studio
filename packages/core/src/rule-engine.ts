/**
 * rule-engine —— 规则求值档的**两阶段**求值门面：typecheckRuleProfile → evaluateRule
 *
 * 依据（MIG-03 / IMPL-03-07；docs/plan/05 该单；docs/v2/16 core 行「规则两阶段求值目标拆分」）：
 *   - v2/10 §六 RULE-01..08（唯一主表）：档身份/版本化与变更链（RULE-01）、输入声明（02）、
 *     表达式封闭树（03）、封闭类型系统与全子树静态检查（04）、缺失/空值/未知与方向表（05）、
 *     算子/三值/限额/步数（06）、结果恰七字段四值不合并（07）、确定性（08）；
 *   - v2/10 §6.3 相位修正（静态声明错→typecheck；输入到达错→inputBinding；策略消费侧→policy）
 *     与限额十项（七项可收紧生效值＝min(档内, 调用侧) 入 limitsApplied；三项档内固定）；
 *   - v2/10 §八封闭码表（E-RULE-001..010、W-RULE-001/002；相位由 spec.ts 单点决定）；
 *   - v2/01 §七.6（两阶段：静态判定先于求值，求值不得改写声明面）；
 *   - v2/14 §1.1/§1.2（PORT-DEF「草案当已批准＝拒」「禁当前最新」、PORT-AUTH 判定面——
 *     本件承担档引用解析与判定纯核，端口接线归后续波）；
 *   - docs/v2/17 NEG-RULE-01..10、NEG-ENG-03（负例落 test/v2/rule-engine-neg.test.ts）。
 *
 * 两阶段不可合并：`evaluateRule` 只接受 `typecheckRuleProfile` 产出的 `CheckedProfileCall`
 * （型别标记＋运行期字段），静态面未过的输入没有求值通道。
 *
 * 零 IO：摘要用 node:crypto 纯计算；求值不接收时钟、不读环境/文件/网络/随机/模型（RULE-08）。
 */

import type { Diagnostic, DigestFace, EvalOutcome, LimitsApplied, RuleProfileRef, RuleProfileSpec } from './spec.ts'
import { LIMITS_APPLIED_NAMES, makeDiagnostic, ruleTypeName } from './spec.ts'
import { semanticDigestOfJson } from './jcs.ts'
import type { RuleExpr } from './rule/expr.ts'
import { expressionShape, typecheckExpression } from './rule/expr.ts'
import { bindInputs } from './rule/bind.ts'
import type { EvalState } from './rule/eval.ts'
import { EvalHalt, evaluateExpression } from './rule/eval.ts'
import type { KnownRuleProfile } from './rule/profile.ts'
import { validateRuleProfile } from './rule/profile.ts'
import { checkKnownProfile, readInputDecl, readProfileRef } from './rule/decl.ts'

// 子域再导出（单一公开面在 rule-engine；子文件不构成第二导出面）
export { validateRuleProfile, SUPPORTED_RULE_OPERATORS } from './rule/profile.ts'
export type { KnownRuleProfile, ProfileTypecheckResult } from './rule/profile.ts'
export { resolvePolicyDirection, checkProfileUpgrade, assertProfileRefStable } from './rule/policy.ts'
export type { PolicyDirection, ProfileChangeEvidence, ProfileUpgradeVerdict } from './rule/policy.ts'

// ─────────────────────────────────────────────────────────────────────────────
// 一、两阶段前半：静态面（typecheck）
// ─────────────────────────────────────────────────────────────────────────────

/** `typecheckRuleProfile` 输入：待验档、待验规则与（可选）档登记表 */
export interface RuleTypecheckInput {
  readonly profile: unknown
  readonly rule: unknown
  /** 档登记表：给了就必须能解析到档且未被撤回（拒绝未知档/未知版本/已撤回档——RULE-01） */
  readonly known?: readonly KnownRuleProfile[]
}

/** 已过静态面的调用（`typechecked` 是双闸的型别标记；evaluateRule 只收此型） */
export interface CheckedProfileCall {
  readonly typechecked: true
  readonly profile: RuleProfileSpec
  readonly expression: RuleExpr
  readonly inputDecl: import('./spec.ts').InputDecl
  readonly diagnostics: readonly Diagnostic[]
  readonly referencedPaths: readonly string[]
}

/** 两阶段前半结果 */
export type RuleTypecheckResult =
  | { readonly ok: true; readonly call: CheckedProfileCall; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
}

/**
 * 两阶段前半（**静态面一次过**）：档结构 → 登记表（未知/撤回）→ 档引用一致性 →
 * 输入声明 → 表达式全子树类型检查 → 根类型必须是 Bool。失败即不得求值。
 */
export function typecheckRuleProfile(input: RuleTypecheckInput): RuleTypecheckResult {
  const diagnostics: Diagnostic[] = []
  const profileResult = validateRuleProfile(input.profile)
  diagnostics.push(...profileResult.diagnostics)
  if (!profileResult.ok) return { ok: false, diagnostics }
  const profile = profileResult.profile
  checkKnownProfile(profile, input.known, diagnostics)
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return { ok: false, diagnostics }
  const rule = asRecord(input.rule)
  if (rule === null) {
    diagnostics.push(makeDiagnostic('E-RULE-001', '', 'rule/rule-shape'))
    return { ok: false, diagnostics }
  }
  const ref = readProfileRef(rule['ruleProfileRef'], profile, diagnostics)
  if (ref === null) return { ok: false, diagnostics }
  const inputDecl = readInputDecl(rule['inputDecl'], diagnostics)
  if (inputDecl === null) return { ok: false, diagnostics }
  const expressionRaw = rule['expression']
  const staticResult = typecheckExpression(expressionRaw, { profile, inputDecl })
  diagnostics.push(...staticResult.diagnostics)
  if (staticResult.failed) return { ok: false, diagnostics }
  if (staticResult.type.kind !== 'Bool') {
    diagnostics.push(makeDiagnostic('E-RULE-003', '', 'rule/top-level-type', [ruleTypeName(staticResult.type)]))
    return { ok: false, diagnostics }
  }
  const call: CheckedProfileCall = {
    typechecked: true,
    profile,
    expression: expressionRaw as RuleExpr,
    inputDecl,
    diagnostics,
    referencedPaths: staticResult.referencedPaths,
  }
  return { ok: true, call, diagnostics }
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、两阶段后半：求值（evaluate）与恰七字段结果（RULE-07）
// ─────────────────────────────────────────────────────────────────────────────

/** 求值选项：调用侧收紧（生效值＝min(档内声明, 调用侧)）与可选轨迹 */
export interface EvaluateOptions {
  readonly limits?: Partial<LimitsApplied>
  readonly trace?: boolean
}

/**
 * 求值结果（RULE-07 恰七字段：outcome/profileRef/inputsDigest/steps/limitsApplied/
 * diagnostics/trace(可选)）。四值不合并——`unknown`＝输入不足、`refused`＝求值中止，
 * refused 不得读成 false。
 *
 * `inputsDigest` 为 `null` 只在一种情形出现：输入不在 jcs@1 域内（ENC-02/04 域外值、
 * 非 JSON 值），此时求值在摘要前即 refused，**不存在**可报告的语义摘要——不造 digest
 * 比造一个更接近 ENC-05（摘要只证规范字节一致）。
 */
export interface RuleEvaluation {
  readonly outcome: EvalOutcome
  readonly profileRef: RuleProfileRef
  readonly inputsDigest: DigestFace | null
  readonly steps: number
  readonly limitsApplied: LimitsApplied
  readonly diagnostics: readonly Diagnostic[]
  readonly trace?: readonly string[]
}

function mergeLimits(profile: RuleProfileSpec, overrides: Partial<LimitsApplied> | undefined): LimitsApplied {
  const merged: Record<string, number> = {}
  for (const name of LIMITS_APPLIED_NAMES) {
    const declared = profile.limits.ceiling[name]
    const requested = overrides?.[name]
    const tightened = typeof requested === 'number' && Number.isFinite(requested) ? Math.floor(requested) : declared
    merged[name] = Math.max(1, Math.min(declared, tightened))
  }
  return merged as unknown as LimitsApplied
}

function profileRefOf(profile: RuleProfileSpec): RuleProfileRef {
  return { profileId: profile.profileId, version: profile.version, digest: profile.semanticDigest }
}

function buildResult(input: {
  readonly profile: RuleProfileSpec
  readonly outcome: EvalOutcome
  readonly inputsDigest: DigestFace | null
  readonly steps: number
  readonly limits: LimitsApplied
  readonly diagnostics: readonly Diagnostic[]
  readonly trace?: readonly string[]
}): RuleEvaluation {
  const result: RuleEvaluation = {
    outcome: input.outcome,
    profileRef: profileRefOf(input.profile),
    inputsDigest: input.inputsDigest,
    steps: input.steps,
    limitsApplied: input.limits,
    diagnostics: input.diagnostics,
  }
  return input.trace === undefined ? result : { ...result, trace: input.trace }
}

function refused(
  call: CheckedProfileCall,
  inputs: {
    readonly limits: LimitsApplied
    readonly inputsDigest: DigestFace | null
    readonly diagnostics: readonly Diagnostic[]
    readonly steps?: number
    readonly trace?: readonly string[]
  },
): RuleEvaluation {
  return buildResult({
    profile: call.profile,
    outcome: 'refused',
    inputsDigest: inputs.inputsDigest,
    steps: inputs.steps ?? 0,
    limits: inputs.limits,
    diagnostics: inputs.diagnostics,
    ...(inputs.trace === undefined ? {} : { trace: inputs.trace }),
  })
}

const TRACE_LIMIT = 256

/**
 * 两阶段后半：输入摘要 → 限额合并 → 形状限额 → 输入绑定 → 求值 → 四值映射。
 * 任何超限/中止一律记 `refused`（不是 false）；四值映射只由求值面的值形态决定。
 */
export function evaluateRule(call: CheckedProfileCall, inputs: unknown, options: EvaluateOptions = {}): RuleEvaluation {
  const limitsApplied = mergeLimits(call.profile, options.limits)
  const digestResult = semanticDigestOfJson(inputs)
  if (!digestResult.ok) {
    return refused(call, {
      limits: limitsApplied,
      inputsDigest: null,
      diagnostics: [...call.diagnostics, ...digestResult.diagnostics],
    })
  }
  const inputsDigest = digestResult.value
  const shape = expressionShape(call.expression)
  if (shape.nodes > limitsApplied.maxNodes) {
    return refused(call, {
      limits: limitsApplied,
      inputsDigest,
      diagnostics: [...call.diagnostics, makeDiagnostic('E-RULE-008', '', 'rule/limit-nodes', [shape.nodes, limitsApplied.maxNodes])],
    })
  }
  if (shape.depth > limitsApplied.maxDepth) {
    return refused(call, {
      limits: limitsApplied,
      inputsDigest,
      diagnostics: [...call.diagnostics, makeDiagnostic('E-RULE-008', '', 'rule/limit-depth', [shape.depth, limitsApplied.maxDepth])],
    })
  }
  const binding = bindInputs(call.inputDecl, inputs, call.referencedPaths, limitsApplied)
  if (!binding.ok) {
    return refused(call, {
      limits: limitsApplied,
      inputsDigest,
      diagnostics: [...call.diagnostics, ...binding.diagnostics],
    })
  }
  const trace: string[] | null = options.trace === true ? [] : null
  const state: EvalState = {
    limits: {
      applied: limitsApplied,
      fixed: call.profile.limits.fixed,
      patternModel: call.profile.patternModel,
      determinism: call.profile.determinism,
    },
    table: binding.table,
    steps: 0,
    diagnostics: [],
    trace,
  }
  const diagnostics: Diagnostic[] = [...call.diagnostics, ...binding.diagnostics]
  let outcome: EvalOutcome
  try {
    const evaluated = evaluateExpression(call.expression, state)
    if (typeof evaluated === 'symbol' || evaluated.kind !== 'Bool') {
      // 三值面：unknown（输入不足/null 未声明）不是 false
      outcome = 'unknown'
    } else {
      outcome = evaluated.value ? 'true' : 'false'
    }
  } catch (error) {
    if (!(error instanceof EvalHalt)) throw error
    diagnostics.push(error.diagnostic)
    outcome = 'refused'
  }
  diagnostics.push(...state.diagnostics)
  let traceOut: readonly string[] | undefined
  if (trace !== null) {
    traceOut = trace.length > TRACE_LIMIT ? [...trace.slice(0, TRACE_LIMIT), '…truncated'] : trace
  }
  return buildResult({
    profile: call.profile,
    outcome,
    inputsDigest,
    steps: state.steps,
    limits: limitsApplied,
    diagnostics,
    ...(traceOut === undefined ? {} : { trace: traceOut }),
  })
}
