/**
 * @唤醒解析器（纯核心，零 IO）—— Matrix 房间消息 → InvokeIntent(kind='mention')
 *
 * 协议依据：docs/21-§四（@唤醒、有界对话纪律）、docs/22（唤起源只产意图）、docs/25-§3.4（invoke 端口）。
 *
 * 识别规则：
 *   - @工号：默认样式 ^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$（AGENT-3、WORKER-12）；必须含连字符段，
 *     借此排除 @TODO/@NOTE 类普通大写词误报。可用 agentIdPattern 覆盖。
 *   - @角色词：roles 映射表（@宰相 → PRIME-0），键为不带 @ 的角色词，可配。
 *   - 完整 MXID 形式（@AGENT-3:localhost）按其工号段识别，同样可唤起。
 *
 * 防误报（docs/21-§三/§四：频道内容按不可信输入对待）：
 *   - 围栏代码块（``` / ~~~）内的 @ 不算
 *   - 引用行（> 开头，含 Matrix 回复 fallback 引文）内的 @ 不算
 *   - 行内代码（`…`）内的 @ 不算
 *   - 紧贴词中缀的 @ 不算（邮箱 user@AGENT-3 不唤起）
 *   - 仅 m.text（或未标 msgtype）可唤起：m.notice/m.image 等一律返回空（bot 回声不唤起）
 *
 * 非唤醒消息返回空数组；同一条消息 @同一对象多次只产一条意图（一次@一人）。
 */
import type { CompanySlug, PersonId, InvokeIntent } from '@studio-next/contract'

/** 唤起源名（InvokeIntent.source 的固定值） */
export const MENTION_SOURCE_NAME = 'matrix'

/** 默认工号样式：大写字母/数字 + 至少一个连字符段（AGENT-3、PRIME-0、WORKER-12） */
export const DEFAULT_AGENT_ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/

/** 解析器配置（每个公司实例一份；角色词映射表可配） */
export interface MentionParserConfig {
  company: CompanySlug
  /** 角色词 → 工号（@宰相 → PRIME-0）；键为不带 @ 的角色词 */
  roles?: Readonly<Record<string, PersonId>>
  /** 工号识别样式（默认 DEFAULT_AGENT_ID_PATTERN） */
  agentIdPattern?: RegExp
}

/**
 * 归一化的 Matrix 房间消息（解析器输入；由 extractRoomMessages 从 sync 响应提取，
 * 也可由测试直接构造）
 */
export interface MatrixRoomMessage {
  eventId: string
  roomId: string
  sender: string
  /** 房间别名（#slug-大厅:localhost）；缺省时 channel 回退为 roomId */
  roomAlias?: string
  /** m.text / m.notice / m.image …；未标视为 m.text */
  msgtype?: string
  body: string
}

/** mention 意图的 payload 形状（原文 + room/channel + 命中详情） */
export interface MentionPayload {
  /** 被 @ 的对象（工号） */
  target: PersonId
  /** 命中的原始词（含 @，如 '@AGENT-3'） */
  mention: string
  /** 消息原文（未清洗的 content.body） */
  text: string
  eventId: string
  sender: string
  /** room_id */
  room: string
  /** 频道（roomAlias ?? roomId） */
  channel: string
}

/** sync 响应的结构子集（client.SyncResponse 结构满足之；纯层不 import 网络层） */
export interface SyncLike {
  next_batch?: unknown
  rooms?: {
    join?: Readonly<Record<string, { timeline?: { events?: readonly unknown[] } } | undefined>>
  }
}

/** @词元扫描：@ +（字母或 CJK 起头的词字符序列） */
const MENTION_TOKEN = /@([A-Za-z\u4e00-\u9fff][0-9A-Za-z_\-\u4e00-\u9fff]*)/gu
/** 词中缀（@ 前紧贴这些字符则不算唤起，如邮箱） */
const WORD_INFIX = /[0-9A-Za-z_-]/

/**
 * 清洗为「可对话文本」：剔除围栏代码块行、引用行、行内代码段。
 * 剔除方向刻意保守——宁可漏报（少唤起），不可误报（乱唤起）。
 */
export function stripNonConversational(body: string): string {
  const kept: string[] = []
  let inFence = false
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trimStart()
    if (line.startsWith('```') || line.startsWith('~~~')) {
      inFence = !inFence
      continue // 开/闭围栏行本身也不参与
    }
    if (inFence) continue
    if (line.startsWith('>')) continue // 引用行（含 Matrix 回复 fallback）
    kept.push(rawLine)
  }
  return kept.join('\n').replace(/```[^`]*```/g, ' ').replace(/`[^`\n]*`/g, ' ')
}

/**
 * 从 sync 响应提取房间文本消息（纯投影）：
 * 只取 type=m.room.message 且 event_id/sender/body 均合法的事件；其余形状原样丢弃。
 */
export function extractRoomMessages(sync: SyncLike): MatrixRoomMessage[] {
  const out: MatrixRoomMessage[] = []
  const join = sync.rooms?.join
  if (join === undefined) return out
  for (const [roomId, room] of Object.entries(join)) {
    const events = room?.timeline?.events
    if (events === undefined) continue
    for (const raw of events) {
      const ev = raw as
        | { event_id?: unknown; type?: unknown; sender?: unknown; content?: unknown }
        | null
      if (ev === null || typeof ev !== 'object') continue
      if (ev.type !== 'm.room.message') continue
      if (typeof ev.event_id !== 'string' || typeof ev.sender !== 'string') continue
      const content = ev.content as { msgtype?: unknown; body?: unknown } | null | undefined
      if (typeof content?.body !== 'string') continue
      out.push({
        eventId: ev.event_id,
        roomId,
        sender: ev.sender,
        ...(typeof content.msgtype === 'string' ? { msgtype: content.msgtype } : {}),
        body: content.body,
      })
    }
  }
  return out
}

/**
 * 解析一条房间消息 → 零或多条 mention 意图。
 * 意图按原文首次出现顺序输出；@同一对象去重；kind='mention'、source='matrix'。
 */
export function parseMentions(
  message: MatrixRoomMessage,
  config: MentionParserConfig,
): InvokeIntent[] {
  if (message.msgtype !== undefined && message.msgtype !== 'm.text') return []
  const pattern = config.agentIdPattern ?? DEFAULT_AGENT_ID_PATTERN
  const roles = config.roles
  const text = stripNonConversational(message.body)
  const channel = message.roomAlias ?? message.roomId

  const seen = new Set<PersonId>()
  const intents: InvokeIntent[] = []
  for (const match of text.matchAll(MENTION_TOKEN)) {
    const token = match[1]
    if (token === undefined) continue
    const at = match.index ?? 0
    const prev = at > 0 ? (text[at - 1] ?? '') : ''
    if (prev !== '' && WORD_INFIX.test(prev)) continue // 词中缀 @（邮箱等）不算
    const target: PersonId | undefined = roles !== undefined && token in roles
      ? roles[token]
      : pattern.test(token)
        ? token
        : undefined
    if (target === undefined || seen.has(target)) continue
    seen.add(target)
    const payload: MentionPayload = {
      target,
      mention: `@${token}`,
      text: message.body,
      eventId: message.eventId,
      sender: message.sender,
      room: message.roomId,
      channel,
    }
    intents.push({
      kind: 'mention',
      company: config.company,
      source: MENTION_SOURCE_NAME,
      payload,
    })
  }
  return intents
}
