/**
 * judge-gates —— micro-judge 原语·纯策略面：三帽 + 降级原因枚举 + 按址熔断 + 拍闸 + roles 机制点
 *
 * 依据（studio-dev-160 提案 §6.2/§6.4/§8，制作人 2026-10-22 全批；单 164=§6.7 单A）：
 *   - 三帽（§6.2；缺省值=提案批示值，改动走批示）：
 *       ① 单次事前估算闸（perCallUsd=$0.01）——launch 前估超即降级（不落账不派 judge 版）；
 *       ② 按址日帽（perSiteDailyUsd=$0.50）——当日该址已结实际之和+本次估算超帽即降级；
 *       ③ 公司日帽（companyDailyUsd=$5.00）——当日全部 judge 址已结实际之和+本次估算超帽即降级。
 *       另有**事后超耗**面：resultStats 实际 > 单次帽 → 裁决**弃用**（over-spend 降级），
 *       实际仍落账且计熔断（超耗是真信号，不是免费事故）。
 *   - 降级原因枚举（JUDGE_FALLBACK_REASONS 冻结）：机器可比对（事件 note/熔断签名消费）；
 *     一切降级**一律回退机械规则**（不重试——LLM_FAIL 处置分叉，17-§9）。
 *   - 按址熔断（§6.2）：同址**同因**连续 3 次降级 → 熔断（site-open：机械规则直答，
 *     不再唤起）；自然日界自动复位（与 DEV-46 断路的半开冷却不同源——judge 熔断的
 *     复位是日界不是冷却窗，故独立实现不复用 core/breaker.ts）；手动复位=清状态
 *     （调用方删状态即复位）。熔断达成时自动开 bug 单的接线归 daemon 侧（本件只出判定）。
 *   - 有界延迟（§8 红队 3 / §6.6-R2）：拍级口径——每址每拍至多 1 次判断调用、每拍
 *     全公司至多 2 次、拍级墙钟预算 12s（超时即杀即降级）；拍闸在 launch 前预检
 *     （已用墙钟+本次超时 > 预算 → tick-clock 降级，不点火）。
 *   - roles 机制点（§6.4，红队 1）：micro-judge 走 models.yaml `roles.micro_judge`，
 *     **必须显式登记为 low**——未登记或非 low → CONFIG_INVALID 拒启动（缺位不静默
 *     用 high/默认档：判断调用用高档=成本事故，机制点拦在启动面）。「roles 是开放
 *     键」与「micro_judge 必 low」并存：开放键=公司可加角色；必 low=该角色的档约束。
 *
 * 纯函数纪律：同 judge.ts——零 IO、时钟/日期键由调用方注入（dayKey 由 daemon 用
 * 公司时区折算后传入）；状态是值不是引用（返回新状态，调用方持久化/重放无副作用）。
 */
import { configInvalid } from '@studio-next/contract'
import { TIER_IDS } from './models.ts'

// ————————————————————————— 三帽（§6.2 批示缺省） —————————————————————————

/** judge 三帽（美元；缺省=studio-dev-160 提案批示值——改帽走批示，不进代码常量默改） */
export interface JudgeCaps {
  readonly perCallUsd: number
  readonly perSiteDailyUsd: number
  readonly companyDailyUsd: number
}

/** 三帽缺省：$0.01/次 + $0.50/址/日 + $5/公司/日（提案 §6.2，制作人 2026-10-22 全批） */
export const DEFAULT_JUDGE_CAPS: JudgeCaps = {
  perCallUsd: 0.01,
  perSiteDailyUsd: 0.5,
  companyDailyUsd: 5,
}

/** 事前闸结论：pass=可派；refuse=降级（原因即 JUDGE_FALLBACK 原因枚举成员） */
export type JudgePreCallDecision =
  | { readonly kind: 'pass' }
  | { readonly kind: 'refuse'; readonly reason: 'estimate-over-cap' | 'site-daily-cap' | 'company-daily-cap' }

/**
 * 单次事前闸（三帽的 launch 前预检——「不落账不派 judge 版」的判定面）：
 *   estimateUsd > 单次帽 → estimate-over-cap；
 *   siteSpentUsd + estimateUsd > 址日帽 → site-daily-cap（已结实际+本次估算，预留语义）；
 *   companySpentUsd + estimateUsd > 公司日帽 → company-daily-cap。
 * 调用方约定：refuse 即降级机械规则并落 refusal 语义（JUDGE_FALLBACK 事件），不 launch。
 */
export function judgePreCallGate(input: {
  estimateUsd: number
  siteSpentUsd: number
  companySpentUsd: number
  caps?: JudgeCaps
}): JudgePreCallDecision {
  const caps = input.caps ?? DEFAULT_JUDGE_CAPS
  if (input.estimateUsd > caps.perCallUsd) return { kind: 'refuse', reason: 'estimate-over-cap' }
  if (input.siteSpentUsd + input.estimateUsd > caps.perSiteDailyUsd) return { kind: 'refuse', reason: 'site-daily-cap' }
  if (input.companySpentUsd + input.estimateUsd > caps.companyDailyUsd) return { kind: 'refuse', reason: 'company-daily-cap' }
  return { kind: 'pass' }
}

/** 事后超耗判定：实际 > 单次帽 → 裁决弃用（over-spend 降级；实际仍落账仍计熔断） */
export function judgeOverSpend(actualUsd: number, caps?: JudgeCaps): boolean {
  return actualUsd > (caps ?? DEFAULT_JUDGE_CAPS).perCallUsd
}

// ————————————————————————— 降级原因枚举（冻结） —————————————————————————

/**
 * JUDGE_FALLBACK 原因枚举（§6.2 冻结面；机器可比对——事件 note/熔断签名/面板分组共用）：
 *   - bad-json / op-not-in-vocab / params-domain：三道闸（judge.ts，LLM_FAIL judge/* 同源）
 *   - timeout：墙钟超时（杀进程后收到的终局）
 *   - output-truncated：超时且已有部分输出（截断与坏 JSON 的区分面——真信号不同）
 *   - refusal：模型拒绝回答（适配器层收到的显式拒绝形态）
 *   - estimate-over-cap / site-daily-cap / company-daily-cap：三帽事前降级
 *   - over-spend：事后超耗（裁决弃用）
 *   - tick-quota / tick-clock：拍闸（址拍额/拍墙钟，§8 红队 3）
 *   - site-open：按址熔断中（机械规则直答）
 *   - no-model：judge 注册位缺席/价目表缺席（装配面拒派——哨兵原因，非模型行为）
 * 只增不改，加项走批示（词表纪律同 EVENT_NAMES）。
 */
export type JudgeFallbackReason =
  | 'bad-json'
  | 'timeout'
  | 'op-not-in-vocab'
  | 'params-domain'
  | 'refusal'
  | 'estimate-over-cap'
  | 'site-daily-cap'
  | 'company-daily-cap'
  | 'output-truncated'
  | 'over-spend'
  | 'tick-quota'
  | 'tick-clock'
  | 'site-open'
  | 'no-model'

/** 原因枚举清单（机器可读；测试断言穷尽性） */
export const JUDGE_FALLBACK_REASONS: readonly JudgeFallbackReason[] = [
  'bad-json',
  'timeout',
  'op-not-in-vocab',
  'params-domain',
  'refusal',
  'estimate-over-cap',
  'site-daily-cap',
  'company-daily-cap',
  'output-truncated',
  'over-spend',
  'tick-quota',
  'tick-clock',
  'site-open',
  'no-model',
]

// ————————————————————————— 按址熔断（§6.2；同因连续 3 次） —————————————————————————

/**
 * 按址熔断状态（值语义：onJudgeFallback/onJudgeSuccess 返回新值，调用方持有并持久化）。
 * openSinceDay=undefined 即闭合；dayKey=自然日键（公司时区折算，调用方注入——
 * 纯函数不碰时钟）。
 */
export interface JudgeSiteBreakerState {
  readonly site: string
  /** 连续同因降级的当前原因（成功即清） */
  readonly lastReason?: JudgeFallbackReason
  /** 连续次数（同因累计；换因归 1；**跨自然日归 1**——签名不隔夜） */
  readonly streak: number
  /** 熔断起始日键（=dayKey 时熔断中；日界差≠闭合——比较由 isJudgeSiteOpen 判） */
  readonly openSinceDay?: string
  /** 最近一次降级所在日键（跨日判据：lastDayKey≠当次 dayKey → 签名复位重累计） */
  readonly lastDayKey?: string
}

/** 熔断阈值：同因连续 3 次降级即熔断（提案 §6.2 冻结值） */
export const JUDGE_BREAKER_THRESHOLD = 3

/** 初始态（闭合、无签名） */
export function initialJudgeBreaker(site: string): JudgeSiteBreakerState {
  return { site, streak: 0 }
}

/**
 * 记一次降级：同因 streak++，异因归 1；达阈值（3）→ openSinceDay=当次 dayKey。
 * 注意：**熔断中的调用不会到这**（site-open 在熔断判定后直接降级，不再唤起——
 * 熔断中的降级不累计签名）；本函数只收「真唤起后降级」的信号。
 */
export function onJudgeFallback(
  state: JudgeSiteBreakerState,
  reason: JudgeFallbackReason,
  dayKey: string,
): JudgeSiteBreakerState {
  // 跨自然日=复位信号：签名不隔夜累计（昨日连因不连坐今日）；旧熔断标记随日翻闭合
  const sameDay = state.lastDayKey === dayKey
  const streak = sameDay && state.lastReason === reason ? state.streak + 1 : 1
  const open = streak >= JUDGE_BREAKER_THRESHOLD
  // 熔断中不该到这（site-open 短路不唤起）；防御性保留同日旧标记，异日一律清
  const openSinceDay = open || state.openSinceDay === dayKey ? dayKey : undefined
  return {
    site: state.site,
    lastReason: reason,
    streak,
    lastDayKey: dayKey,
    ...(openSinceDay !== undefined ? { openSinceDay } : {}),
  }
}

/** 记一次成功：签名清零（成功即证明该址该因已消——连续性断） */
export function onJudgeSuccess(state: JudgeSiteBreakerState): JudgeSiteBreakerState {
  return { site: state.site, streak: 0 }
}

/**
 * 熔断判定：openSinceDay 存在且 == 当前 dayKey → 熔断中（site-open，机械规则直答）；
 * 日界差（自然日过去了）→ 自动复位（闭合——返 false，调用方下次降级重累计）。
 * 手动复位=调用方弃状态回 initialJudgeBreaker。
 */
export function isJudgeSiteOpen(state: JudgeSiteBreakerState, dayKey: string): boolean {
  return state.openSinceDay === dayKey
}

// ————————————————————————— 拍闸（§8 红队 3：有界延迟口径） —————————————————————————

/** 拍级限额（提案 §6.6-R2 冻结缺省——改限走批示） */
export interface JudgeTickLimits {
  /** 每址每拍至多判断调用次数 */
  readonly maxCallsPerSitePerTick: number
  /** 每拍全公司至多判断调用次数 */
  readonly maxCallsPerTick: number
  /** 拍级墙钟预算（毫秒）——已用+本次超时 > 预算 → tick-clock 降级不点火 */
  readonly tickBudgetMs: number
}

/** 拍级缺省：1 次/址/拍 + 2 次/拍 + 12s 墙钟（提案 §6.6-R2） */
export const DEFAULT_JUDGE_TICK_LIMITS: JudgeTickLimits = {
  maxCallsPerSitePerTick: 1,
  maxCallsPerTick: 2,
  tickBudgetMs: 12_000,
}

/** 拍内判断调用计数（调用方每拍构造一次，invoke 后累计——值语义由调用方维护） */
export interface JudgeTickState {
  readonly tickId: string
  readonly calls: number
  readonly callsBySite: Readonly<Record<string, number>>
  readonly clockMs: number
}

/** 新拍初始态 */
export function initialJudgeTick(tickId: string): JudgeTickState {
  return { tickId, calls: 0, callsBySite: {}, clockMs: 0 }
}

/** 拍闸结论：ok=可唤起；refuse=降级（tick-quota=次数额尽；tick-clock=墙钟预算尽） */
export type JudgeTickDecision =
  | { readonly kind: 'ok' }
  | { readonly kind: 'refuse'; readonly reason: 'tick-quota' | 'tick-clock' }

/**
 * 拍闸（launch 前预检）：址拍额/拍总额/拍墙钟三限——任一超即降级（不点火）。
 * timeoutMs 是本次调用的墙钟上限（结果也计入 clockMs 累计——记账面在调用库）。
 */
export function judgeTickGate(
  tick: JudgeTickState,
  site: string,
  timeoutMs: number,
  limits?: JudgeTickLimits,
): JudgeTickDecision {
  const l = limits ?? DEFAULT_JUDGE_TICK_LIMITS
  if ((tick.callsBySite[site] ?? 0) >= l.maxCallsPerSitePerTick || tick.calls >= l.maxCallsPerTick) {
    return { kind: 'refuse', reason: 'tick-quota' }
  }
  if (tick.clockMs + timeoutMs > l.tickBudgetMs) {
    return { kind: 'refuse', reason: 'tick-clock' }
  }
  return { kind: 'ok' }
}

/** 记一次完成的调用（成功/降级都计——墙钟是真消耗；clockMs 累计实际用时） */
export function onJudgeTickCall(
  tick: JudgeTickState,
  site: string,
  elapsedMs: number,
): JudgeTickState {
  return {
    tickId: tick.tickId,
    calls: tick.calls + 1,
    callsBySite: { ...tick.callsBySite, [site]: (tick.callsBySite[site] ?? 0) + 1 },
    clockMs: tick.clockMs + elapsedMs,
  }
}

// ————————————————————————— roles 机制点（§6.4 红队 1） —————————————————————————

/** judge 角色名（models.yaml roles 键；开放键中的保留约束位——必显式登记 low） */
export const JUDGE_ROLE = 'micro_judge'

/**
 * 启动闸：models.yaml roles 的 micro_judge 必须**显式登记为 low**（§6.4）。
 * 未登记（roles 开放键——缺位不是错，但 judge 面开启时缺位=配置不完整）或非 low
 * → CONFIG_INVALID 拒启动（不静默高档——判断调用用 high/mid=成本事故，机制点
 * 拦在装配面）。调用点：serve 装配期发现 judge 注册位在场即调本闸。
 */
export function assertJudgeRoleLow(roles: Readonly<Record<string, string>>): void {
  const tier = roles[JUDGE_ROLE]
  if (tier === undefined) {
    configInvalid(
      'judge/role-unregistered',
      `models.yaml roles 未登记 ${JUDGE_ROLE}——judge 注册位在场时必须显式 ${JUDGE_ROLE}: low（判断调用低档小模型，studio-dev-160 §6.4）`,
    )
  }
  if (tier !== 'low') {
    configInvalid(
      'judge/role-not-low',
      `models.yaml roles.${JUDGE_ROLE}="${tier}"——micro-judge 必须绑 low 档（三档仅 ${TIER_IDS.join('/')}；高档判断=成本事故，红队 1 机制点）`,
    )
  }
}
