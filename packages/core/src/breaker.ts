/**
 * breaker —— 断路器纯逻辑（docs/17-§6 末 / §10，需求 F1-10）
 *
 * 规格依据（实现单引用）：
 *   - docs/17-§6 末：同(单号,错误签名)连击 3 → 停重派 + 回首批位 + 自动开 bug 单 + 面板标记。
 *   - F1-10：断路后零新 DISPATCH（停重派由 decide 依快照压制，HOLD_BREAKER_OPEN）；
 *     异常同样计 attempt（账目归 daemon，本模块只管连击与熔断）。
 *   - docs/17-§10：报错升级电路在 core——本文件即其纯逻辑核。
 *
 * 语义裁定（拟稿待批点，汇报后走批示流）：
 *   - 「连击」= 同单**同签名连续**命中：换签名即断前一连击（streak 语义），
 *     而非同单各签名各自累计（interleaved 语义）。docs 未明说，本刀取连击字面义。
 *   - 「回首批位」的状态迁移（已派发→新单/待批，见 flows 默认 rollback_edges）由 daemon
 *     依 trip 结果执行；本模块只返回事实与 open_bug 动作，不迁态（零 IO、不碰平台）。
 *   - 熔断后同一签名再报错：保持熔断，不再开新 bug 单（bug 单只开一次）。
 *   - 成功信号复位：清该单全部连击记录（不做签名级保留）。
 *
 * 纯函数纪律：状态不可变（每次返回新 Map）；零 IO、零时间/随机内取。
 */

import type { TicketId } from '@studio-next/contract'
import type { OpenBugAction } from './decide.ts'

/** 熔断阈值配置（N 参数化；默认 3 = docs/17-§6 冻结值） */
export interface BreakerConfig {
  threshold: number
}

export const DEFAULT_BREAKER_CONFIG: BreakerConfig = { threshold: 3 }

/** 单条连击记录：当前签名 + 连续命中数 */
export interface StrikeEntry {
  signature: string
  count: number
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
 * worker 报错入账：同单同签名连击 +1；达阈值 N 熔断——停重派+回首批位+自动开 bug 单。
 * 换签名：断旧连击、新签名从 1 起（连击字面义，见头注）。
 * 已熔断单再报错：保持熔断、连击续计、不再开 bug 单。
 */
export function onWorkerError(
  state: BreakerState,
  ticket: TicketId,
  errorSignature: string,
  config: BreakerConfig = DEFAULT_BREAKER_CONFIG,
): BreakerResult {
  const prev = state.get(ticket)
  const sameSignature = prev !== undefined && prev.signature === errorSignature
  const count = sameSignature ? prev.count + 1 : 1
  const entry: StrikeEntry = { signature: errorSignature, count }

  const newState = new Map(state)
  newState.set(ticket, entry)

  const wasTripped = prev !== undefined && sameSignature && prev.count >= config.threshold
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
  return { tripped: count >= config.threshold, newState, action: null }
}

/**
 * 成功信号：复位该单（清全部连击记录）。
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
