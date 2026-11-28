/**
 * engine/routing/router —— 同档多源模型路由（task-51 MVP；提案 task-48 方案 A）
 *
 * 纯选择/状态逻辑（零 IO）：来源=core `modelSourcesOf()` 归一；优先级分组 + quota 池化打分
 * （task-135：组内剩余额度×weight 降序，耗尽跳过；缺省不配=行为与现状一致）+ 可用性
 * （冷却/熔断）+ **预算预检**；失败分类/冷却/half-open 状态由调用方持久化 daemon_kv。
 * 设计口径：预算不足默认 HOLD（不静默升贵源、不擅自降档）；400/拒答不换源；全部不可用
 * fail-closed 可读原因。审计事件由调用方复用既有事件词（本件不落账）。
 * task-157（docs/quality/supply-quota-gating.md §1/§2.5）：失败分类委托 core `classifySupplyError`
 * （显式分类表替字符串启发式；`classifyFailure` 为薄包装）；选择面按供给级配额池
 * （`SelectInput.quota`）跳过同池源并记因；池状态机/认领生命周期在 routing/quota-gate.ts。
 */
import { classifySupplyError, quotaBlockOf, quotaPoolKeyOf, quotaPoolVerdict, type ErrorClassification, type ErrorKind, type SupplyQuotaState } from '@studio-next/core'
import type { ModelSourceSpec, TierId } from '@studio-next/core'
import type { PriceEntry, TokenCounts } from '@studio-next/contract'

export type FailureClass = 'quota' | 'rate_limit' | 'server' | 'timeout' | 'network' | 'auth' | 'config' | 'parse' | 'bad_request' | 'refusal'

/** core ErrorKind → 路由 FailureClass（overload=5xx 族走 server 冷却档；worker_dead/quality 只在收割面） */
const FAILURE_CLASS_OF: Readonly<Record<ErrorKind, FailureClass>> = {
  auth: 'auth',
  quota: 'quota',
  rate_limit: 'rate_limit',
  overload: 'server',
  server: 'server',
  timeout: 'timeout',
  network: 'network',
  config: 'config',
  parse: 'parse',
  bad_request: 'bad_request',
  refusal: 'refusal',
  worker_dead: 'server',
  quality: 'server',
}

export interface SourceRuntimeState {
  consecutiveFailures: number
  cooldownUntil: number
  lastFailureClass?: FailureClass
  lastFailureAt?: number
  lastSuccessAt?: number
  halfOpen: boolean
}

export type RoutingState = Record<string, SourceRuntimeState>

export interface BudgetContext {
  /** 任务剩余预算 USD（缺省=不限；来源=已预留折叠 + task budget_cap） */
  ticketRemainingUsd?: number
  /** 公司当日剩余预算 USD（缺省=不限；来源=日闭/成本目录口径） */
  companyRemainingUsd?: number
  /** 显式允许“预算不足时降档到更便宜源”（默认 false=HOLD） */
  allowBudgetDowngrade?: boolean
}

export interface SelectInput {
  readonly tier: TierId
  readonly sources: readonly ModelSourceSpec[]
  readonly state: RoutingState
  readonly now: number
  /** 估算 token（与 budget-gate 同源；缺省按任务书保守估算由调用方给） */
  readonly tokens: TokenCounts
  readonly budget?: BudgetContext
  /** 供给级配额池（task-157；docs/quality/supply-quota-gating.md §2.5）：缺省=不门控（现行为） */
  readonly quota?: SupplyQuotaState
  /** 本单持有的探针认领票（恢复期单探针：持票放行 probe-mine，他单 skip 记 quota-probe-pending） */
  readonly probeTicket?: string
}

export type SelectOutcome =
  | {
      readonly ok: true
      readonly source: ModelSourceSpec
      readonly estimatedUsd: number
      readonly halfOpen: boolean
      readonly skipped: readonly string[]
    }
  | {
      readonly ok: false
      readonly reason: 'ALL_SOURCES_UNAVAILABLE' | 'BUDGET_EXCEEDED'
      readonly detail: string
      readonly source?: ModelSourceSpec
      readonly estimatedUsd?: number
      readonly skipped: readonly string[]
    }

/** 缺省冷却（可按 source.cooldown 覆盖；task-57 F2：与设计文档/magpie 参考对齐） */
export const COOLDOWN_DEFAULTS = {
  /** 429/quota：15m 起，8d 上限（Retry-After/reset 可缩短） */
  quota: { baseMs: 15 * 60_000, maxMs: 8 * 24 * 60 * 60_000 },
  /** 5xx：1m 起，10m 上限 */
  server: { baseMs: 60_000, maxMs: 10 * 60_000 },
  /** 其余可换源类（timeout/network/auth/parse）：60s 起，8h 上限 */
  general: { baseMs: 60_000, maxMs: 8 * 60 * 60_000 },
} as const
/** 兼容旧导出：通用类默认（非 quota/5xx） */
export const DEFAULT_COOLDOWN_BASE_MS = COOLDOWN_DEFAULTS.general.baseMs
export const DEFAULT_COOLDOWN_MAX_MS = COOLDOWN_DEFAULTS.general.maxMs
export const DEFAULT_CIRCUIT_AFTER = 3

export function emptyRoutingState(): RoutingState {
  return {}
}

/** 单源估算（与 core createModelCatalog 同公式；cache 桶缺省按 0） */
export function estimateSourceCost(source: Pick<ModelSourceSpec, 'price'>, tokens: TokenCounts): number {
  const price = source.price
  const cacheRead = tokens.cache_read ?? tokens.cached ?? 0
  const cacheCreation = tokens.cache_creation ?? 0
  return (
    (tokens.input / 1e6) * price.inputPerM +
    (tokens.output / 1e6) * price.outputPerM +
    (cacheRead / 1e6) * (price.cacheReadPerM ?? 0) +
    (cacheCreation / 1e6) * (price.cacheCreationPerM ?? 0)
  )
}

function stateOf(state: RoutingState, id: string): SourceRuntimeState {
  const seen = state[id]
  return seen ?? { consecutiveFailures: 0, cooldownUntil: 0, halfOpen: false }
}

/**
 * quota 有效剩余（task-135 池化）：参与池化才返回数值，否则 undefined（不参与=不跳过不打分）。
 * - 不参与：quota 缺省/不配、kind=unbounded、或 limitUsd 与 remainingUsd 均未申报
 *   （旧「只登记」形态如 {kind: monthly, limitUsd: 0}——limitUsd 0 视为未申报，严格兼容）；
 * - 参与：remainingUsd 缺省回退 limitUsd；resetAt 到期（now ≥ resetAt）视为窗口重置→满额
 *   limitUsd（rolling 语义；无 limitUsd 则仍用申报 remaining）。
 */
export function quotaRemainingOf(source: ModelSourceSpec, now: number): number | undefined {
  const q = source.quota
  if (q === undefined || q.kind === 'unbounded') return undefined
  const declared = q.remainingUsd ?? (q.limitUsd !== undefined && q.limitUsd > 0 ? q.limitUsd : undefined)
  if (declared === undefined) return undefined
  if (q.resetAt !== undefined && q.resetAt !== null && q.resetAt > 0 && now >= q.resetAt && q.limitUsd !== undefined) {
    return q.limitUsd
  }
  return declared
}

/** 池化打分（同 priority 组内降序）：score=剩余×weight；不参与者=0（排末尾但不跳过） */
function quotaScoreOf(source: ModelSourceSpec, now: number): number {
  const remaining = quotaRemainingOf(source, now)
  if (remaining === undefined) return 0
  return remaining * (source.quota?.weight ?? 1)
}

function defaultCooldownFor(cls: FailureClass): { baseMs: number; maxMs: number } {
  if (cls === 'quota' || cls === 'rate_limit') return COOLDOWN_DEFAULTS.quota
  if (cls === 'server') return COOLDOWN_DEFAULTS.server
  return COOLDOWN_DEFAULTS.general
}

function cooldownFor(source: ModelSourceSpec, failures: number, cls: FailureClass): number {
  const defaults = defaultCooldownFor(cls)
  const base = source.cooldown?.baseMs ?? defaults.baseMs
  const max = source.cooldown?.maxMs ?? defaults.maxMs
  return Math.min(max, base * Math.pow(2, Math.max(0, failures - 1)))
}

/**
 * 选择源（caller 应在 dispatch 前调用）：
 * - 只有 enabled、未冷却的源可选；按 priority 升序分组，**组内按 quota 池化打分**
 *   （score=剩余额度×weight 降序；quota 缺省/不配=全员 0 分=维持 id 稳定序，严格兼容），
 *   组间/并列以 id 稳定；
 * - quota 参与且有效剩余 ≤0 → 跳过并记因（quota-exhausted）；全耗尽与其余跳过合并
 *   → ALL_SOURCES_UNAVAILABLE 可读 fail-closed；
 * - 预算预检只看**当前优先候选**：超任务/公司剩余预算 → BUDGET_EXCEEDED（HOLD），
 *   不静默跳到更贵/更便宜源；`allowBudgetDowngrade=true` 才继续尝试后续源，
 *   且**全源均因预算被跳过时收尾仍判 BUDGET_EXCEEDED**（§5「true 且全源超帽 → 仍 HOLD」
 *   ——不冒认 ALL_SOURCES_UNAVAILABLE；混合原因=冷却/额度耗尽+超帽除外）；
 * - 冷却到期源以 half-open 候选参与一次（由调用方在成功/失败后 record）；
 * - 供给级配额池（task-157 §2.5）：源 provider 所在池窗口未到 → 跳过记 `quota-window`；
 *   恢复期仅持票探针放行（他单记 `quota-probe-pending`）。
 */
export function selectModelSource(input: SelectInput): SelectOutcome {
  const enabled = input.sources
    .filter((s) => s.enabled !== false)
    .sort((a, b) =>
      a.priority - b.priority
      || quotaScoreOf(b, input.now) - quotaScoreOf(a, input.now)
      || a.id.localeCompare(b.id)
    )
  const skipped: string[] = []
  if (enabled.length === 0) {
    return { ok: false, reason: 'ALL_SOURCES_UNAVAILABLE', detail: `tier=${input.tier} 无可用来源（全部 disabled）`, skipped }
  }
  // 首个因预算超帽被跳过的源（allowBudgetDowngrade=true 全源超帽时以其收尾判 BUDGET_EXCEEDED）
  let firstBudgetSkip: { source: ModelSourceSpec; estimatedUsd: number; detail: string } | undefined
  let budgetSkips = 0
  for (const source of enabled) {
    const st = stateOf(input.state, source.id)
    if (st.cooldownUntil > input.now) {
      skipped.push(`${source.id}:cooldown(until=${String(st.cooldownUntil)})`)
      continue
    }
    const quotaSkip = quotaSkipOf(input, source)
    if (quotaSkip !== undefined) {
      skipped.push(quotaSkip)
      continue
    }
    const quotaRemaining = quotaRemainingOf(source, input.now)
    if (quotaRemaining !== undefined && quotaRemaining <= 0) {
      skipped.push(`${source.id}:quota-exhausted(remaining=$${quotaRemaining.toFixed(4)})`)
      continue
    }
    const halfOpen = st.cooldownUntil > 0 && st.cooldownUntil <= input.now
    const estimatedUsd = estimateSourceCost(source, input.tokens)
    const ticketLeft = input.budget?.ticketRemainingUsd
    const companyLeft = input.budget?.companyRemainingUsd
    const overTicket = ticketLeft !== undefined && estimatedUsd > ticketLeft
    const overCompany = companyLeft !== undefined && estimatedUsd > companyLeft
    if (overTicket || overCompany) {
      const detail = overTicket
        ? `BUDGET_EXCEEDED;tier=${input.tier};source=${source.id};estimated=$${estimatedUsd.toFixed(4)};ticketRemaining=$${(ticketLeft ?? 0).toFixed(4)}`
        : `BUDGET_EXCEEDED;tier=${input.tier};source=${source.id};estimated=$${estimatedUsd.toFixed(4)};companyRemaining=$${(companyLeft ?? 0).toFixed(4)}`
      skipped.push(`${source.id}:budget`)
      budgetSkips += 1
      if (firstBudgetSkip === undefined) firstBudgetSkip = { source, estimatedUsd, detail }
      if (input.budget?.allowBudgetDowngrade === true) continue
      return { ok: false, reason: 'BUDGET_EXCEEDED', detail, source, estimatedUsd, skipped }
    }
    return { ok: true, source, estimatedUsd, halfOpen, skipped }
  }
  // allowBudgetDowngrade=true 且**全部**源均因预算超帽被跳过 → 收尾仍判 BUDGET_EXCEEDED
  //（HOLD 可达——设计 §5；execute 侧 MODEL_ROUTING_BUDGET_HOLD 由此触发）；混合原因
  //（冷却/额度耗尽+超帽）保持 ALL_SOURCES_UNAVAILABLE，不冒认全源超帽。
  if (firstBudgetSkip !== undefined && budgetSkips === skipped.length) {
    return { ok: false, reason: 'BUDGET_EXCEEDED', detail: firstBudgetSkip.detail, source: firstBudgetSkip.source, estimatedUsd: firstBudgetSkip.estimatedUsd, skipped }
  }
  return { ok: false, reason: 'ALL_SOURCES_UNAVAILABLE', detail: `tier=${input.tier} 全部源不可用（冷却/禁用/额度耗尽）：${skipped.join('、')}`, skipped }
}

/** 失败分类映射冷却（429/额度优先用 retryAfter；400/拒答不产生冷却，用于“不换源”） */
export function isFailoverClass(cls: FailureClass): boolean {
  return cls === 'quota' || cls === 'rate_limit' || cls === 'server' || cls === 'timeout' || cls === 'network' || cls === 'parse' || cls === 'auth' || cls === 'config'
}

/** 供给级配额池跳过记因（未配池=open 不跳过；形状见 docs/quality/supply-quota-gating.md §2.5） */
function quotaSkipOf(input: SelectInput, source: ModelSourceSpec): string | undefined {
  if (input.quota === undefined) return undefined
  const pool = quotaPoolKeyOf(source.provider)
  const verdict = quotaPoolVerdict(input.quota, pool, input.probeTicket ?? '', input.now)
  if (verdict === 'blocked') {
    const block = quotaBlockOf(input.quota, pool, input.now)
    if (block === undefined) return undefined
    const resetAt = block.resetAt !== undefined ? `;resetAt=${new Date(block.resetAt).toISOString()}` : ''
    return `${source.id}:quota-window(window=${block.window}${resetAt};until=${new Date(block.blockedUntil).toISOString()})`
  }
  // probe-other：恢复期已有他单探针在途 → 跳过；open/probe-mine 放行；probe-claimable → 放行，认领在
  // 决策级门控或派发即认领（quota-gate `quotaProbeNote`，同一 core 转移 claimQuotaProbe）二处之一成立
  return verdict === 'probe-other' ? `${source.id}:quota-probe-pending(ticket=${input.quota.pools[pool]?.probe?.ticket ?? 'n/a'})` : undefined
}

/** 失败分类（task-57 F1；task-157 起为 core `classifySupplyError` 的薄包装——显式分类表见 docs/quality/supply-quota-gating.md §1.1） */
export function classifyFailure(err: unknown): FailureClass {
  return FAILURE_CLASS_OF[classifySupplyError(err, 0).kind]
}

/** 失败登记：返回**新**状态（不原地改）；400/拒答不冷却且不触发换源（调用方按 isFailoverClass 判断）。
 *  返回 `cls`=core 全量分类（kind/retryability/quotaWindow/resetAt/providerCode/evidence——审计段与池登记用，task-157） */
export function recordSourceFailure(state: RoutingState, source: ModelSourceSpec, err: unknown, now: number, retryAfterMs?: number): { state: RoutingState; class: FailureClass; cooldownMs: number; cls: ErrorClassification } {
  const cls = classifySupplyError(err, now)
  const failureClass = FAILURE_CLASS_OF[cls.kind]
  const prev = stateOf(state, source.id)
  if (!isFailoverClass(failureClass)) {
    return { state: { ...state, [source.id]: { ...prev, lastFailureClass: failureClass, lastFailureAt: now } }, class: failureClass, cooldownMs: 0, cls }
  }
  const failures = prev.consecutiveFailures + 1
  const circuitAfter = source.cooldown?.circuitAfter ?? DEFAULT_CIRCUIT_AFTER
  const baseCooldown = cooldownFor(source, failures, failureClass)
  const cooldownMax = source.cooldown?.maxMs ?? defaultCooldownFor(failureClass).maxMs
  // Retry-After/reset 可缩短（task-157：显式 retryAfterMs 优先，其次分类解析出的 resetAt）
  const retryAfter = retryAfterMs ?? (cls.resetAt !== undefined ? cls.resetAt - now : undefined)
  const cooldownMs = (failureClass === 'quota' || failureClass === 'rate_limit') && retryAfter !== undefined ? Math.min(cooldownMax, retryAfter) : baseCooldown
  const next: SourceRuntimeState = {
    consecutiveFailures: failures,
    cooldownUntil: now + cooldownMs,
    lastFailureClass: failureClass,
    lastFailureAt: now,
    halfOpen: failures >= circuitAfter,
    ...(prev.lastSuccessAt !== undefined ? { lastSuccessAt: prev.lastSuccessAt } : {}),
  }
  return { state: { ...state, [source.id]: next }, class: failureClass, cooldownMs, cls }
}

/** 成功登记：清零失败/冷却（half-open 成功即恢复） */
export function recordSourceSuccess(state: RoutingState, source: ModelSourceSpec, now: number): RoutingState {
  return { ...state, [source.id]: { consecutiveFailures: 0, cooldownUntil: 0, halfOpen: false, lastSuccessAt: now } }
}

/** daemon_kv 持久化（JSON；坏值保守重置为空状态，不崩） */
export function serializeRoutingState(state: RoutingState): string {
  return JSON.stringify({ version: 1, sources: state })
}
export function deserializeRoutingState(raw: string | null): RoutingState {
  if (raw === null || raw === '') return {}
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; sources?: unknown }
    if (parsed.version !== 1 || typeof parsed.sources !== 'object' || parsed.sources === null) return {}
    const out: RoutingState = {}
    for (const [id, value] of Object.entries(parsed.sources as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue
      const v = value as Record<string, unknown>
      out[id] = {
        consecutiveFailures: typeof v['consecutiveFailures'] === 'number' && v['consecutiveFailures'] >= 0 ? v['consecutiveFailures'] : 0,
        cooldownUntil: typeof v['cooldownUntil'] === 'number' && v['cooldownUntil'] >= 0 ? v['cooldownUntil'] : 0,
        halfOpen: v['halfOpen'] === true,
        ...(typeof v['lastFailureClass'] === 'string' ? { lastFailureClass: v['lastFailureClass'] as FailureClass } : {}),
        ...(typeof v['lastFailureAt'] === 'number' ? { lastFailureAt: v['lastFailureAt'] } : {}),
        ...(typeof v['lastSuccessAt'] === 'number' ? { lastSuccessAt: v['lastSuccessAt'] } : {}),
      }
    }
    return out
  } catch {
    return {}
  }
}

/** 价格字段类型别名（导出供调用方构造 source 配置时复用） */
export type SourcePrice = PriceEntry
