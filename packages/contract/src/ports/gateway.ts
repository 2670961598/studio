/**
 * 网关协议 —— wkey/署名/动作词白名单（docs/25-§4.1，依据 17-§7、24-§二）
 * GATEWAY_ACTIONS 与内部 MCP（studio-tools）工具集同一张表；
 * 状态推进不在白名单内（agent 永远拿不到改状态通道）。
 *
 * 【接口位·不占动词】报表操作（recompute/republish/archive，DEV-36 月报最小闭环随件预留）
 * 的载荷/结果/handler 类型槽在 @studio-next/company reports.ts（ReportOperationsPort 系）；
 * 依 docs/49 §162-170 MCP 缓办令本刀不扩本白名单——将来接线路径=本表增动词（批示流）→
 * daemon 实现 handler → 网关注册，届时删本注并同步 studio-tools 工具集。
 */
import type { TicketId } from './kernel.ts'

export const GATEWAY_ACTIONS = [
  'comment',
  'heartbeat',
  'article',
  'kb-search',
  'evidence-write',
  'budget-query',
] as const

export type GatewayAction = (typeof GATEWAY_ACTIONS)[number]

/** wkey 按单签发、关单吊销；scope/TTL/nonce；fail-closed */
export interface WkeyClaims {
  ticket: TicketId
  scope: GatewayAction[]
  ttl: string
  nonce: string
}
