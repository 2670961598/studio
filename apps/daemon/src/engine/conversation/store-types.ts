/**
 * engine/conversation/store-types.ts —— 会话存储的形状/行族/纯解析件（从 store.ts 真拆）
 *
 * 20-§十五.三（600 行阈「先拆再增」）：类型与行解析零 IO，抽到独立件让 store.ts 只留
 * 读写编排；行族契约见 store.ts 头注（docs/21-§七.1、docs/v2/14-§1.9）。
 */
/** 工号样式（与 matrix DM_PERSON_ID_PATTERN 同源；路径安全第一道闸——防 ../ 穿越） */
export const CONVERSATION_PERSON_ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/

export type ConversationRole = 'producer' | 'person' | 'system'
export type ReplyKind = 'reply' | 'notice'

export interface ConversationMessageInput {
  person: string
  room: string
  role: ConversationRole
  text: string
  /** Matrix eventId（入站幂等键；命令/system 行可省） */
  eventId?: string
}

export interface ConversationMessage {
  id: string
  at: number
  person: string
  room: string
  role: ConversationRole
  text: string
  eventId?: string
}

export interface ConversationTurn {
  issue: string
  person: string
  room: string
  eventId: string
  at: number
  attempt: number
  done: boolean
}

export interface PendingReply {
  id: string
  at: number
  person: string
  room: string
  text: string
  kind: ReplyKind
  forIssue?: string
}

export interface ClearReceipt {
  room: string
  person: string
  /** 清空的消息条数（审计；不物理删除） */
  count: number
  /** 清空前最后一条消息 id（无消息=undefined） */
  before?: string
  at: number
}

export interface ContextWindow {
  /** 已格式化的上下文正文（最旧→最新；空窗口=''） */
  text: string
  /** 实际纳入条数 */
  included: number
  /** 因窗口/预算丢弃的更早条数 */
  omitted: number
}

export interface ConversationStoreOptions {
  /** 会话目录（daemon.yaml conversationDir / 缺省 <rootDir>/conversations） */
  dir: string
  now?: () => number
  id?: () => string
  /** 观测面（畸形行/写失败只落此日志，不抛——会话面不阻主循环） */
  log?: (line: string) => void
  /** 单条消息落盘上限（防单行无限膨胀；超出截断并标注） */
  maxStoredChars?: number
  /** 单条消息注入任务书上限（docs/21-§七.3 冻结值 2000） */
  maxMessageChars?: number
}

export type RawRecord =
  | { v: 1; kind: 'msg'; id: string; at: number; person: string; room: string; role: ConversationRole; text: string; eventId?: string }
  | { v: 1; kind: 'clear'; id: string; at: number; person: string; room: string; by: string; reason?: string; before?: string; count: number }
  | { v: 1; kind: 'turn'; id: string; at: number; person: string; room: string; eventId: string; issue: string; attempt: number }
  | { v: 1; kind: 'turn-done'; id: string; at: number; person: string; issue: string }
  | { v: 1; kind: 'reply'; id: string; at: number; person: string; room: string; text: string; replyKind: ReplyKind; forIssue?: string }
  | { v: 1; kind: 'delivered'; id: string; at: number; person: string; reply: string }
  | { v: 1; kind: 'failure-notice'; id: string; at: number; person: string; issue: string; attempt: number }

export type BindRecord = {
  v: 1
  kind: 'bind'
  id: string
  at: number
  room: string
  person: string
  by: string
  reason: 'explicit' | 'default'
}

export interface PersonState {
  records: RawRecord[]
  eventIds: Set<string>
  turns: Map<string, ConversationTurn>
  replies: Map<string, PendingReply>
  delivered: Set<string>
  failureNotices: Set<string>
  lastProblemAt: number
}

export const ROLE_LABEL: Record<ConversationRole, string> = {
  producer: '制作人',
  person: '岗位',
  system: '系统',
}

/** 单行安全 JSON（换行一律由 JSON 转义；此处只做落盘上限截断） */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…（原文 ${text.length} 字，已截断）`
}


/**
 * 一行 JSONL → 行族记录（纯函数，零 IO）。畸形行只报位置+原因（不回显正文），返回 undefined。
 * bind 只出现在 `_bindings.jsonl`；person 文件里出现 bind 行由调用方跳过（不静默当消息）。
 */
export function parseConversationLine(
  line: string,
  where: string,
  onProblem: (message: string) => void,
): RawRecord | BindRecord | undefined {
  try {
    const parsed = JSON.parse(line) as unknown
    if (typeof parsed !== 'object' || parsed === null) throw new Error('非对象')
    const record = parsed as { v?: unknown; kind?: unknown; id?: unknown; at?: unknown; person?: unknown }
    if (record.v !== 1 || typeof record.kind !== 'string' || typeof record.id !== 'string' || typeof record.at !== 'number') {
      throw new Error('v/kind/id/at 形状不符')
    }
    if (record.kind === 'bind') {
      const bind = parsed as { room?: unknown; by?: unknown; reason?: unknown }
      if (typeof bind.room !== 'string' || typeof bind.by !== 'string' || (bind.reason !== 'explicit' && bind.reason !== 'default')) {
        throw new Error('bind 字段形状不符')
      }
      return parsed as BindRecord
    }
    if (typeof record.person !== 'string') throw new Error('person 缺失')
    const raw = parsed as Record<string, unknown>
    if ((record.kind === 'msg' || record.kind === 'reply') && (typeof raw.room !== 'string' || typeof raw.text !== 'string')) {
      throw new Error(`${record.kind} 缺 room/text`)
    }
    if (record.kind === 'turn' && (typeof raw.issue !== 'string' || typeof raw.room !== 'string')) throw new Error('turn 缺 issue/room')
    if (record.kind === 'msg' && raw.role !== 'producer' && raw.role !== 'person' && raw.role !== 'system') throw new Error('msg role 非法')
    return parsed as RawRecord
  } catch (err) {
    onProblem(`[conversation] 会话行解析失败（跳过，不猜）：${where}：${err instanceof Error ? err.message : String(err)}`)
    return undefined
  }
}
