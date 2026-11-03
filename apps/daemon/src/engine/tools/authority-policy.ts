/**
 * authority-policy —— 授权闸模式面（studio-dev-579：shadow→enforce 接线路径的机器可读形态）
 *
 * 依据（实现单引用）：
 *   - docs/v2/15 §一 SEC-FC-08（授权闸长期 shadow 放行＋判定证据只进日志＝禁止形态；
 *     目标＝证据先落账再放行、模式可读数、enforce 有期限/里程碑）；
 *   - docs/v2/08 §1.9（授权判定证据 EVD 实例：events 落点、可复算字段、SQL 读面）；
 *   - docs/17-§2（主循环七相位：写路径经 gated-platform 收口）、docs/17-§6（收割四要件：
 *     判定必须留痕）。
 *
 * 边界：零 IO、零时钟读取——本件只做模式判定与配置值收窄；启动判期由装配处用注入时钟调用。
 */
import { configInvalid } from '@studio-next/contract'
import type { AuthorityMode } from './authority-gate.ts'

/** daemon.yaml 键：true=无主张也拒（enforce）；缺省/false=影子观测（shadow） */
export const AUTHORITY_REQUIRE_CLAIM_KEY = 'authorityRequireClaim' as const

/**
 * daemon.yaml 键：shadow 的失效日（ISO `YYYY-MM-DD`，UTC 零点）。
 * shadow 且已过该日＝启动即 `CONFIG_INVALID/authority-enforce-overdue` 拒启——不许无限期
 * 影子放行；确需延期的，改本键并留批示依据（显式、可审计）。
 */
export const AUTHORITY_ENFORCE_BY_KEY = 'authorityEnforceBy' as const

/** 由开关派生判定模式（单点映射；gate 内不再各自判断） */
export function authorityModeOf(requireClaim: boolean): AuthorityMode {
  return requireClaim ? 'enforce' : 'shadow'
}

/** ISO 日期 → UTC 零点 epoch ms（严格形状：坏值＝CONFIG_INVALID，不猜不取整） */
export function parseAuthorityEnforceByMs(value: string): number {
  const text = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    configInvalid('authority-enforce-by-invalid', `${AUTHORITY_ENFORCE_BY_KEY} 须为 ISO 日期 YYYY-MM-DD（实得 ${value}）`)
  }
  const ms = Date.parse(`${text}T00:00:00.000Z`)
  // 形状合法但日历越界（2026-02-31）→ Date.parse 归一后往返不一致，拒
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== text) {
    configInvalid('authority-enforce-by-invalid', `${AUTHORITY_ENFORCE_BY_KEY} 不是合法日历日（实得 ${value}）`)
  }
  return ms
}

/**
 * 启动判期（fail-closed）：shadow 已过失效日＝拒启，不静默续影子。
 * enforce 模式不受期限约束（期限只用来终结 shadow）。
 */
export function assertAuthorityModeNotOverdue(options: {
  readonly requireClaim: boolean
  readonly enforceByMs?: number
  readonly nowMs: number
}): void {
  if (options.requireClaim) return
  if (options.enforceByMs === undefined) return
  if (options.nowMs < options.enforceByMs) return
  configInvalid(
    'authority-enforce-overdue',
    `授权闸仍为 shadow 且已过 ${AUTHORITY_ENFORCE_BY_KEY}（${new Date(options.enforceByMs).toISOString()}）：` +
      '授予记录生产者/主张携带接线完成后须设 authorityRequireClaim: true；确需延期须显式改期并留批示依据',
  )
}
