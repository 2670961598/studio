/**
 * breaker —— 断路器纯逻辑（docs/17-§6 末 / §10，需求 F1-10；DEV-46 半开修订）
 *
 * 规格依据（实现单引用）：
 *   - docs/17-§6 末：同(单号,错误签名)连击 3 → 停重派 + 回首批位 + 自动开 bug 单 + 面板标记；
 *     DEV-46 修订（2026-10-20 studio-dev-78 实证后）：停重派=**冷却窗内**停——窗过放行一次
 *     半开试探（成功=复位、失败=回全开续冷却），熔断不再是死锁终态。
 *   - F1-10：断路后冷却窗内零新 DISPATCH（HOLD_BREAKER_OPEN 由 decide 依快照压制）；
 *     冷却窗过=半开试探派发（DISPATCH 携 breakerProbe 锚）。异常同样计 attempt
 *     （账目归 daemon，本模块只管连击与熔断）。
 *   - docs/17-§10：报错升级电路在 core——本文件即其纯逻辑核。
 *
 * 语义裁定（拟稿待批点，汇报后走批示流）：
 *   - 「连击」= 同单**同签名连续**命中：换签名即断前一连击（streak 语义），
 *     而非同单各签名各自累计（interleaved 语义）。docs 未明说，本刀取连击字面义。
 *   - 「回首批位」的状态迁移（已派发→新单/待批，见 flows 默认 rollback_edges）由 daemon
 *     依 trip 结果执行；本模块只返回事实与 open_bug 动作，不迁态（零 IO、不碰平台）。
 *   - 熔断后同一签名再报错：保持熔断，不再开新 bug 单（bug 单只开一次）。
 *   - 成功信号复位：清该单全部连击记录（不做签名级保留）——半开试探成功即走此路。
 *   - 【DEV-46】熔断时刻 trippedAt 入记录：熔断态=trippedAt 在册（而非连击数≥阈——
 *     熔断后换签名连击归 1，熔断态仍保持，修复「换签名即静默解除熔断」的旧缝）；
 *     熔断中任何再报错（含半开试探失败）刷新 trippedAt=冷却窗重起；bug 单不重开
 *     （trippedAt 在册即非「首次熔断」）。
 *
 * 纯函数纪律：状态不可变（每次返回新 Map）；零 IO、零时间/随机内取（时刻一律入参）。
 */

import type { TicketId } from '@studio-next/contract'
import type { OpenBugAction } from './decide.ts'

/** 冷却窗缺省（拟稿 30min，DEV-46——studio-dev-78 实证后的自愈等待面） */
export const DEFAULT_BREAKER_COOLDOWN_MS = 30 * 60_000

/** 熔断阈值配置（N 参数化；默认 3 = docs/17-§6 冻结值；cooldownMs 拟稿待批） */
export interface BreakerConfig {
  threshold: number
  /** 半开前置冷却窗 ms（缺省 DEFAULT_BREAKER_COOLDOWN_MS；0=熔断即半开——负对照/测试用） */
  cooldownMs?: number
}

export const DEFAULT_BREAKER_CONFIG: BreakerConfig = {
  threshold: 3,
  cooldownMs: DEFAULT_BREAKER_COOLDOWN_MS,
}

/** 单条连击记录：当前签名 + 连续命中数 + 熔断时刻（在册=熔断中；DEV-46） */
export interface StrikeEntry {
  signature: string
  count: number
  /** 熔断时刻 epoch-ms（undefined=未熔断）；冷却窗起算点——在册期间任何再报错刷新之 */
  trippedAt?: number
}

/**
 * 断路器状态：ticket → 连击记录。
 * 用 Map 表达（纯数据，无方法）；不可变约定：所有更新返回新 Map，调用方整体替换。
 */
export type BreakerState = ReadonlyMap<TicketId, StrikeEntry>

/** 空状态（初始态） */
export function emptyBreakerState(): BreakerState {
  return new Map()
}

/** 查连击数（decide 快照来源；无记录=0） */
export function breakerStrikes(state: BreakerState, ticket: TicketId): number {
  return state.get(ticket)?.count ?? 0
}

/** 当前连击签名（无记录=null） */
export function breakerSignature(state: BreakerState, ticket: TicketId): string | null {
  return state.get(ticket)?.signature ?? null
}

/** 熔断时刻（无熔断=undefined；decide 半开快照来源，DEV-46） */
export function breakerTrippedAt(state: BreakerState, ticket: TicketId): number | undefined {
  return state.get(ticket)?.trippedAt
}

/** onWorkerError / onSuccess 的共同返回形（任务书冻结签名） */
export interface BreakerResult {
  /** 是否处于/进入熔断 */
  tripped: boolean
  /** 新状态（不可变更新；未变化时返回原引用） */
  newState: BreakerState
  /** 熔断瞬间产生的动作（open_bug，code=BREAKER_TRIPPED）；其余时刻为 null */
  action: OpenBugAction | null
}

/**
 * worker 报错入账：同单同签名连击 +1；达阈值 N 熔断——冷却窗内停重派+回首批位+自动开
 * bug 单（bug 只开一次）。换签名：断旧连击、新签名从 1 起（连击字面义，见头注）。
 * 已熔断单再报错（含半开试探失败）：保持熔断、trippedAt 刷新（冷却窗重起）、不再开
 * bug 单——半开「失败=回全开续冷却」的落点（DEV-46）。
 * 时刻入参（core 禁 Date.now）：now 即本击入账时刻 epoch-ms。
 */
export function onWorkerError(
  state: BreakerState,
  ticket: TicketId,
  errorSignature: string,
  now: number,
  config: BreakerConfig = DEFAULT_BREAKER_CONFIG,
): BreakerResult {
  const prev = state.get(ticket)
  const sameSignature = prev !== undefined && prev.signature === errorSignature
  const count = sameSignature ? prev.count + 1 : 1
  const wasTripped = prev !== undefined && prev.trippedAt !== undefined
  const tripped = wasTripped || count >= config.threshold
  const entry: StrikeEntry = {
    signature: errorSignature,
    count,
    ...(tripped ? { trippedAt: now } : {}),
  }

  const newState = new Map(state)
  newState.set(ticket, entry)

  // 首次熔断才开 bug 单（trippedAt 在册期间的再报错只续冷却，DEV-46）
  if (!wasTripped && count >= config.threshold) {
    return {
      tripped: true,
      newState,
      action: {
        type: 'open_bug',
        code: 'BREAKER_TRIPPED',
        ticket,
        errorSignature,
        strikes: count,
      },
    }
  }
  return { tripped, newState, action: null }
}

/**
 * 成功信号：复位该单（清全部连击记录）——半开试探成功即走此路（GATE_PASS 面）。
 * 复位本身是台账事件（BREAKER_RESET，events 枚举含 RESUME/CIRCUIT_BREAK 族），
 * 但不是动作——action 恒 null，decide 下一拍自然恢复可派发。
 */
export function onSuccess(state: BreakerState, ticket: TicketId): BreakerResult {
  if (!state.has(ticket)) {
    return { tripped: false, newState: state, action: null }
  }
  const newState = new Map(state)
  newState.delete(ticket)
  return { tripped: false, newState, action: null }
}
