/**
 * 制作人-岗位持久对话（Matrix DM）意图解析器 —— 纯核心，零 IO
 *
 * 协议依据：docs/21-§七（制作人-岗位持久对话通道，studio-dev-646 Phase 1）、
 * docs/v2/14-§1.9（会话面 CONV-，复用 PORT-GATE.notify 的房间定向，不新增 PORT）。
 *
 * 与 @唤醒解析器的分工（两路互斥，不是叠加）：
 *   - 白名单 DM 房（`conversationRooms`）里的消息**一律走本解析器**——DM 是持久会话，
 *     `@工号` 在 DM 里只是正文（若同时产 mention 意图会双派单，违反一次一人纪律）。
 *   - 非 DM 房的频道消息仍走 mentions.ts（既有 @唤醒语义零变更）。
 *
 * 为什么要 `target:''`：岗位绑定是 daemon 侧的会话事实（`_bindings.jsonl`），源侧只看房间/
 * 发送者，不猜岗位——绑定解析归会话消费件（docs/21-§七.2）。payload 仍带全 mention 形状
 * （target/mention/text/eventId/sender/room）以便复用既有意图承载与幂等键，另加
 * `conversation:{v:1}` 作为会话分流标记（零新 kind、零新事件名）。
 *
 * 防误报/防伪造（docs/21-§三：频道内容按不可信输入对待）：
 *   - 只接受 `m.text`（或未标 msgtype）；
 *   - 只接受发送者＝配置的 `matrixProducerMxid`（制作人本人）；
 *   - 只接受 `dmRooms` 白名单内的 room_id；
 *   - 空正文不产意图（命令/正文都靠正文承载）。
 *
 * 幂等：`dedupKey=eventId`（源侧设置，21A-§5.10 勘误后口径不变）。
 */
import type { CompanySlug, InvokeIntent } from '@studio-next/contract'
import type { MatrixRoomMessage } from './mentions.ts'

/** 会话负载版本（append-only 演进；消费件按版本分派） */
export const CONVERSATION_PAYLOAD_VERSION = 1

/** DM 意图 payload（结构=mention payload + conversation 标记；target 由消费件解析） */
export interface ConversationDmPayload {
  /** 空串：绑定工号归 daemon 会话面解析（源侧不猜岗位） */
  target: ''
  /** 展示用唤醒词（DM 不是 @；消费件按 conversation 标记分流） */
  mention: 'DM'
  text: string
  eventId: string
  sender: string
  room: string
  channel: string
  conversation: { v: number }
}

export interface DmParserConfig {
  company: CompanySlug
  /** 制作人 MXID（daemon.yaml matrixProducerMxid）：只接受此人消息 */
  producerUserId: string
  /** DM 房白名单（room_id）；缺省=不产 DM 意图（fail-closed——源侧不猜房间语义） */
  rooms?: readonly string[]
}

/** 缺省工号样式（与 mentions.ts DEFAULT_AGENT_ID_PATTERN 同源；此处独立导出防跨文件耦合） */
export const DM_PERSON_ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/

/**
 * 一条房间消息 → 零或一条会话意图。
 * 条件不满足一律返回 undefined（不产意图、不抛错——源侧不解释，消费件/日志负责观测）。
 */
export function parseDmMessage(
  message: MatrixRoomMessage,
  config: DmParserConfig,
): InvokeIntent | undefined {
  if (message.msgtype !== undefined && message.msgtype !== 'm.text') return undefined
  if (message.sender !== config.producerUserId) return undefined
  if (config.rooms === undefined || !config.rooms.includes(message.roomId)) return undefined
  if (message.body.trim() === '') return undefined
  const payload: ConversationDmPayload = {
    target: '',
    mention: 'DM',
    text: message.body,
    eventId: message.eventId,
    sender: message.sender,
    room: message.roomId,
    channel: message.roomAlias ?? message.roomId,
    conversation: { v: CONVERSATION_PAYLOAD_VERSION },
  }
  return {
    kind: 'mention', // 零新 kind：复用 mention 承载与幂等键（docs/v2/14-§1.9）
    company: config.company,
    source: 'matrix',
    dedupKey: message.eventId,
    payload,
  }
}
