/**
 * @唤醒解析器（纯核心，零 IO）—— Matrix 房间消息 → InvokeIntent(kind='mention')
 *
 * 协议依据：docs/21-§四（@唤醒、有界对话纪律）、docs/22（唤起源只产意图）、docs/25-§3.4（invoke 端口）。
 *
 * 识别规则（两路互补，各自独立可命中——105-刀A A-4，F2/F3 事故教训）：
 *   - 正文词元路：@工号（默认样式 ^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$，AGENT-3、WORKER-12；
 *     必须含连字符段，借此排除 @TODO/@NOTE 类普通大写词误报）、@角色词（roles 映射表，
 *     @宰相 → PRIME-0）、完整 MXID 形式（@AGENT-3:localhost 按其工号段识别）。
 *   - m.mentions.user_ids 路（v1.5 意图元数据）：客户端 pill 点选产生的结构化提及
 *     （正文可能无 @ 词元）——MXID localpart 大写化后按同一 roles/工号样式解析；
 *     bot 自身（selfUserId）与发送者本人不算唤醒。
 *
 * 防误报（docs/21-§三/§四：频道内容按不可信输入对待）：
 *   - 围栏代码块（``` / ~~~）内的 @ 不算
 *   - 引用行（> 开头，含 Matrix 回复 fallback 引文）内的 @ 不算
 *   - 行内代码（`…`）内的 @ 不算
 *   - 紧贴词中缀的 @ 不算（邮箱 user@AGENT-3 不唤起）
 *   - 仅 m.text（或未标 msgtype）可唤起：m.notice/m.image 等一律返回空（bot 回声不唤起）
 *
 * 幂等（105-刀A A-1，21A-§5.10 勘误后口径）：dedupKey=Matrix eventId 源侧设置（本层
 * 即「源侧」——意图产出点）；引擎幂等键=(source,kind,company,dedupKey)——同一条消息
 * @多个对象产多条同 dedupKey 意图，引擎侧按一次@一人纪律折叠（首目标物化）。
 *
 * 非唤醒消息返回空数组；同一条消息 @同一对象多次只产一条意图（一次@一人）。
 */
import type { CompanySlug, PersonId, InvokeIntent } from '@studio-next/contract'

/** 唤醒源名（InvokeIntent.source 的固定值） */
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
  /** 网关 bot 自身的 MXID：m.mentions.user_ids 命中 bot 不算唤醒（bot 被提及=对网关说话，非唤醒岗位） */
  selfUserId?: string
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
  /** v1.5 意图元数据（结构化提及）：content.m.mentions 的投影——只保 user_ids（105-刀A A-4） */
  mentions?: { userIds?: string[] }
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

/** MXID localpart：@prime-0:localhost → 'prime-0'（原样，不大写——大小写归解析面处理） */
function localpartOf(mxid: string): string | undefined {
  const m = /^@([^:]+):/.exec(mxid)
  return m?.[1]
}

/**
 * 从 sync 响应提取房间文本消息（纯投影）：
 * 只取 type=m.room.message 且 event_id/sender/body 均合法的事件；其余形状原样丢弃。
 * content.m.mentions.user_ids（v1.5 意图元数据）投影为 mentions.userIds（105-刀A A-4）。
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
      const content = ev.content as
        | { msgtype?: unknown; body?: unknown; 'm.mentions'?: unknown }
        | null
        | undefined
      if (typeof content?.body !== 'string') continue
      // m.mentions 投影（防御性：room/user_ids 形状不符整个丢弃，不猜）
      const rawMentions = content['m.mentions']
      let mentions: { userIds?: string[] } | undefined
      if (rawMentions !== null && typeof rawMentions === 'object') {
        const ids = (rawMentions as { user_ids?: unknown }).user_ids
        if (Array.isArray(ids) && ids.every((id) => typeof id === 'string')) {
          mentions = { userIds: ids }
        }
      }
      out.push({
        eventId: ev.event_id,
        roomId,
        sender: ev.sender,
        ...(typeof content.msgtype === 'string' ? { msgtype: content.msgtype } : {}),
        body: content.body,
        ...(mentions !== undefined ? { mentions } : {}),
      })
    }
  }
  return out
}

/**
 * 解析一条房间消息 → 零或多条 mention 意图。
 * 正文词元按原文首次出现顺序输出；m.mentions.user_ids（结构化提及）补在其后——
 * 两路命中同一目标去重（一次@一人）；kind='mention'、source='matrix'、
 * dedupKey=eventId（105-刀A A-1 源侧契约）。
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

  /** 目标词 → 工号（roles 词优先，其次工号样式）；未命中返回 undefined */
  const resolveToken = (token: string): PersonId | undefined =>
    roles !== undefined && token in roles
      ? roles[token]
      : pattern.test(token)
        ? token
        : undefined

  const push = (target: PersonId, mention: string): void => {
    if (seen.has(target)) return
    seen.add(target)
    const payload: MentionPayload = {
      target,
      mention,
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
      dedupKey: message.eventId, // 幂等键源侧设置（25-§3.4 v1.3 裁决 1，21A-§5.10 勘误后口径）
      payload,
    })
  }

  // 路 1：正文 @词元
  for (const match of text.matchAll(MENTION_TOKEN)) {
    const token = match[1]
    if (token === undefined) continue
    const at = match.index ?? 0
    const prev = at > 0 ? (text[at - 1] ?? '') : ''
    if (prev !== '' && WORD_INFIX.test(prev)) continue // 词中缀 @（邮箱等）不算
    // 完整 MXID 形式（@AGENT-3:localhost）：截 localpart 参与解析
    const bareToken = token.includes(':') ? (token.split(':', 1)[0] ?? token) : token
    const target = resolveToken(bareToken)
    if (target === undefined) continue
    push(target, `@${bareToken}`)
  }

  // 路 2：m.mentions.user_ids（结构化提及，正文可无 @ 词元）
  for (const mxid of message.mentions?.userIds ?? []) {
    if (mxid === config.selfUserId) continue // bot 被提及=对网关说话，非唤醒岗位
    if (mxid === message.sender) continue // 发送者提及自己不算唤醒
    const local = localpartOf(mxid)
    if (local === undefined) continue
    // localpart 习惯小写（21A-§5.9：localpart=工号小写）→ 大写化对齐默认工号样式；
    // 自定义样式（agentIdPattern）可能按原大小写写 → 先原文后大写两试，各自过同一解析面
    const target = resolveToken(local) ?? resolveToken(local.toUpperCase())
    if (target === undefined) continue
    push(target, `@${target}`)
  }

  return intents
}
