/**
 * WorkbenchTransport v1 —— 冻结协议基线（P1-1a）
 *
 * 传输：Unix domain socket；帧=单行 JSON（NDJSON），request/response 以 `id` 关联。
 * 本文件是 v1 DTO/错误码/claim-ack 语义的唯一冻结源；改动=version 升级，不得静默扩字段。
 */

export const WORKBENCH_TRANSPORT_PROTOCOL = 'workbench-transport/v1' as const
export type WorkbenchTransportProtocol = typeof WORKBENCH_TRANSPORT_PROTOCOL

/** 稳定错误码（客户端/服务端不得自造；新增=protocol version 升级） */
export const WB_ERROR_CODES = [
  'WB_UNAVAILABLE',
  'WB_TIMEOUT',
  'WB_NOT_CONNECTED',
  'WB_PROTOCOL',
  'WB_INVALID_ARGUMENT',
  'WB_ROOM_NOT_FOUND',
  'WB_MESSAGE_NOT_FOUND',
  'WB_WAKE_NOT_FOUND',
  'WB_WAKE_NOT_CLAIMABLE',
  'WB_IDEMPOTENCY_CONFLICT',
  'WB_INTERNAL',
] as const
export type WbErrorCode = (typeof WB_ERROR_CODES)[number]

export interface WbError {
  readonly code: WbErrorCode
  readonly message: string
  readonly retryable?: boolean
  readonly details?: Readonly<Record<string, unknown>>
}

export type WbMethod =
  | 'health'
  | 'rooms.list'
  | 'rooms.create'
  | 'messages.send'
  | 'messages.list'
  | 'read'
  | 'inbox'
  | 'wakes.claim'
  | 'wakes.ack'

export interface WbRequest {
  readonly id: string
  readonly method: WbMethod
  readonly params?: unknown
}
export type WbResponse = { readonly id: string; readonly ok: true; readonly result: unknown } | { readonly id: string; readonly ok: false; readonly error: WbError }

export interface HealthResult {
  readonly ok: true
  readonly protocol: WorkbenchTransportProtocol
  readonly server: string
  readonly startedAt: number
}
export interface Room {
  readonly roomId: string
  readonly kind: 'broadcast' | 'group' | 'dm'
  readonly name: string
  readonly memberIds: readonly string[]
  readonly headRoomSeq: number
}
export interface Message {
  readonly seq: number
  readonly roomSeq: number
  readonly roomId: string
  readonly senderId: string
  readonly body: string
  readonly mentions: readonly string[]
  readonly createdAt: number
}
export interface SendResult {
  readonly seq: number
  readonly roomSeq: number
  readonly messageId: string
  readonly replayed: boolean
}
export interface MessagePage {
  readonly items: readonly Message[]
  readonly nextCursor: string | null
  readonly hasMore: boolean
}
export interface ReadResult {
  readonly roomId: string
  readonly actorId: string
  readonly lastReadRoomSeq: number
  readonly unread: number
  readonly replayed: boolean
}
export interface InboxResult {
  readonly actorId: string
  readonly unread: number
  readonly mentions: number
  readonly pendingWakeIds: readonly string[]
  readonly rooms: readonly { readonly roomId: string; readonly unread: number; readonly pendingWakes: number }[]
}
export interface Wake {
  readonly wakeId: string
  readonly actorId: string
  readonly roomId: string
  readonly sourceSeq: number
  readonly cause: 'mention' | 'mention_all' | 'dm' | 'room'
  readonly status: 'pending' | 'claimed' | 'acked'
  readonly claimedBy: string | null
  readonly claimedUntil: number | null
  readonly createdAt: number
  readonly ackedAt: number | null
}
export interface ClaimResult {
  readonly claimed: readonly string[]
  readonly alreadyClaimed: readonly string[]
  readonly wakes: readonly Wake[]
  readonly replayed: boolean
}
export interface AckResult {
  readonly acked: readonly string[]
  readonly alreadyAcked: readonly string[]
  readonly replayed: boolean
}
