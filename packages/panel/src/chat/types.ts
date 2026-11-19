/**
 * chat/types —— 面板自研聊天室视图的类型与稳定错误面（M4-3 最小刀）
 *
 * 依据：docs/plan/06-自研单子与聊天室切换-2026-11-19.md §四.1（聊天室 UI 用 panel 新页，
 * 复用 chatd rooms/messages/inbox/wake）、§M3（面板聊天室 UI）；docs/plan/07-边界提案-
 * workbench-transport与chatd入表-2026-11-19.md §2.1/§五（panel→workbench-transport 边随
 * 面板 UI 实现单落）；Transport v1 DTO/错误码冻结源 packages/workbench-transport/src/types.ts
 * （本包只消费不镜像不扩改）。
 *
 * 边界：panel 对 chatd **只经本 Port**——结构同形注入（daemon 判例
 * assembly/serve/chatd-mention-source.ts ChatdTransportPort）：真连=workbench-transport
 * 客户端（./wiring.ts），测试=内存 mock。本文件零 IO。
 */

// Transport v1 冻结 DTO（类型只读引渡——不镜像拷贝，协议升级时类型面随包走）
import type {
  InboxResult,
  MessagePage,
  ReadResult,
  Room,
  SendResult,
  WbErrorCode,
} from '@studio-next/workbench-transport'

export type { InboxResult, MessagePage, ReadResult, Room, SendResult, WbErrorCode }

/**
 * 面板聊天室所需 transport 最小面（WorkbenchTransport 结构满足——token 附加形参随 params
 * 上帧，服务端 params.token 常时比较恰好收到；注入面留给测试 mock 与装配）。
 * rooms.list 参面系 M4-3 随面板接线补齐（此前无参面——token 无法随行，client.ts 头注同款）。
 */
export interface ChatPanelTransport {
  listRooms(input: { token?: string }): Promise<readonly Room[]>
  listMessages(input: { roomId: string; actorId: string; limit?: number; token?: string }): Promise<MessagePage>
  sendMessage(input: { roomId: string; senderId: string; body: string; mentions?: readonly string[]; idempotencyKey?: string; token?: string }): Promise<SendResult>
  read(input: { roomId: string; actorId: string; upToRoomSeq: number; idempotencyKey?: string; token?: string }): Promise<ReadResult>
  inbox(input: { actorId: string; roomIds?: readonly string[]; token?: string }): Promise<InboxResult>
}

/** 面板本地稳定错误码（与透传的 WB_* 词表不相交——WB_* 唯一源在 transport 包，不自造 WB 码） */
export type ChatPanelErrorCode = WbErrorCode | 'CHAT_PANEL_DISABLED' | 'CHAT_INVALID_ARGUMENT' | 'CHAT_PANEL_INTERNAL'

/** 唯一错误体：{ ok:false, error:{ code, message, retryable? } }（code 稳定；透传面原样） */
export interface ChatPanelErrorBody {
  readonly ok: false
  readonly error: { readonly code: ChatPanelErrorCode; readonly message: string; readonly retryable?: boolean }
}

/** WB_* 稳定码 → HTTP 状态（透传分类面；面板本地码另配） */
export const WB_HTTP_STATUS: Readonly<Record<WbErrorCode, number>> = {
  WB_INVALID_ARGUMENT: 400,
  WB_ROOM_NOT_FOUND: 404,
  WB_MESSAGE_NOT_FOUND: 404,
  WB_WAKE_NOT_FOUND: 404,
  WB_WAKE_NOT_CLAIMABLE: 409,
  WB_IDEMPOTENCY_CONFLICT: 409,
  WB_TIMEOUT: 503,
  WB_UNAVAILABLE: 503,
  WB_NOT_CONNECTED: 503,
  WB_PROTOCOL: 502,
  WB_INTERNAL: 502,
}

/** 消息窗口缺省/上限（chatd messages.list 同口径：缺省 50、服务端上限 200） */
export const DEFAULT_CHAT_LIMIT = 50
export const MAX_CHAT_LIMIT = 200
/** 发送正文上限（对齐 panel 对话页 MAX_MESSAGE_TEXT；chatd 只查非空，面板侧防拉爆） */
export const MAX_CHAT_BODY_CHARS = 4000
/** 页面轮询间隔缺省（对齐对话页 DEFAULT_CONVERSATION_POLL_MS） */
export const DEFAULT_CHAT_POLL_MS = 2000
/** 缺省操作者标识（chatd 端按房间成员校验 sender——非成员发送回 WB_INVALID_ARGUMENT 透传） */
export const DEFAULT_CHAT_ACTOR_ID = 'panel'
