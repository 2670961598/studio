/**
 * 网关协议 —— wkey/署名/动作词白名单（docs/25-§4.1，依据 17-§7、24-§二）
 * GATEWAY_ACTIONS 与内部 MCP（studio-tools）工具集同一张表；
 * 状态推进不在白名单内（agent 永远拿不到改状态通道）。
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
