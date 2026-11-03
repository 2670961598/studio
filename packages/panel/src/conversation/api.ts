/**
 * conversation/api —— 面板对话页的纯函数层（鉴权/校验/投影/摘要；studio-dev-647 · Phase 2）
 *
 * 依据（实现单引用）：
 *   - docs/21-§7.2：双端同步契约（同源/同序/幂等/clear 重置/有界拉取）；
 *   - docs/v2/14-§8.1：写鉴权 fail-closed（未配置=503、缺=401、错=403）与请求形状；
 *   - docs/v2/15-§0.2-1：读面缺省拒、越权不得以空集冒充「没有」。
 *
 * 边界：本件零 IO 零 Hono（可单测）；常量时间比对用 node:crypto，不落盘、不记令牌。
 */
import { timingSafeEqual } from 'node:crypto'
import {
  MAX_CLEAR_REASON,
  MAX_HISTORY_ENTRIES,
  MAX_MESSAGE_TEXT,
  type ConversationEntry,
  type ConversationMessage,
  type ConversationSummary,
  type ConversationView,
} from './types.ts'

/** 写凭据请求头（docs/v2/14-§8.1） */
export const PRODUCER_TOKEN_HEADER = 'x-studio-producer-token'

/** 制作人工号缺省（与单据读面 PRIME-0 一致） */
export const DEFAULT_PRODUCER_ID = 'PRIME-0'

/** 工号形状：大写字母开头，字母/数字/连字符分段（PRIME-0、ENG-10、AGENT-1） */
const PERSON_ID_RE = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/

/** 幂等键形状：ULID/UUID/随机串皆可，限定字符与长度防注入 */
const CLIENT_MSG_ID_RE = /^[A-Za-z0-9_-]{8,64}$/

/** 工号合法性（长度 2..32 且形状匹配） */
export function isPersonId(value: string): boolean {
  return value.length >= 2 && value.length <= 32 && PERSON_ID_RE.test(value)
}

/** 写策略：token=null 表未配置（写面 fail-closed）；producerId=署名 actorRef */
export interface ConversationWritePolicy {
  readonly token: string | null
  readonly producerId: string
}

/** 合法写权限（署名主体固定 person，协议不承载 control/system） */
export interface ConversationWriteAuthority {
  readonly kind: 'producer'
  readonly ref: string
}

/** 鉴权失败：status/failure/subcause 直接映射 HTTP（不降级、不回退匿名） */
export interface ConversationWriteDenied {
  readonly ok: false
  readonly status: 401 | 403 | 503
  readonly failure: string
  readonly subcause: string
}

/** 鉴权成功 */
export interface ConversationWriteAllowed {
  readonly ok: true
  readonly authority: ConversationWriteAuthority
}

export type ConversationWriteAuthResult = ConversationWriteAllowed | ConversationWriteDenied

/** 从环境读写策略（缺 token / 工号非法 → token=null，写面全拒） */
export function loadConversationWritePolicy(env: Record<string, string | undefined>): ConversationWritePolicy {
  const rawToken = env.STUDIO_PANEL_PRODUCER_TOKEN?.trim() ?? ''
  const rawId = env.STUDIO_PANEL_PRODUCER_ID?.trim() ?? ''
  const producerId = rawId === '' ? DEFAULT_PRODUCER_ID : rawId
  if (!isPersonId(producerId)) return { token: null, producerId: DEFAULT_PRODUCER_ID }
  if (rawToken === '') return { token: null, producerId }
  return { token: rawToken, producerId }
}

/** 常量时间字符串比对（长度不同直接 false——不泄露长度以外的信息） */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * 写鉴权（fail-closed）：未配置令牌=503；缺令牌=401；不匹配=403。
 * 身份只取服务端配置 producerId，**不读客户端自报身份头**（docs/v2/14-§8.1）。
 */
export function authorizeConversationWrite(
  headerToken: string | undefined,
  policy: ConversationWritePolicy,
): ConversationWriteAuthResult {
  if (policy.token === null) {
    return { ok: false, status: 503, failure: 'rejected_unavailable', subcause: 'write-token-not-configured' }
  }
  if (headerToken === undefined || headerToken === '') {
    return { ok: false, status: 401, failure: 'rejected_unauthorized', subcause: 'producer-token-missing' }
  }
  if (!safeEqual(headerToken, policy.token)) {
    return { ok: false, status: 403, failure: 'rejected_forbidden', subcause: 'producer-token-invalid' }
  }
  return { ok: true, authority: { kind: 'producer', ref: policy.producerId } }
}

/** 校验结果（ok=false 带 subcause，供 HTTP 400 细分） */
export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly subcause: string }

/** 追加消息请求体（客户端只填文本与幂等键；personId 来自路径） */
export interface SendMessageBody {
  readonly text: string
  readonly clientMsgId?: string
}

/** clear 请求体 */
export interface ClearConversationBody {
  readonly reason?: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 只允许白名单键（严格形状：多余键=客户端错，不静默忽略） */
function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

/** 解析 send body：text 1..4000；clientMsgId 可选（8..64 安全字符） */
export function parseSendMessageBody(raw: unknown): Parsed<SendMessageBody> {
  if (!isPlainObject(raw)) return { ok: false, subcause: 'body-not-object' }
  if (!hasOnlyKeys(raw, ['text', 'clientMsgId'])) return { ok: false, subcause: 'body-unknown-key' }
  if (typeof raw.text !== 'string') return { ok: false, subcause: 'text-not-string' }
  const text = raw.text.trim()
  if (text === '') return { ok: false, subcause: 'text-empty' }
  if (text.length > MAX_MESSAGE_TEXT) return { ok: false, subcause: 'text-too-long' }
  if (raw.clientMsgId === undefined) return { ok: true, value: { text } }
  if (typeof raw.clientMsgId !== 'string' || !CLIENT_MSG_ID_RE.test(raw.clientMsgId)) {
    return { ok: false, subcause: 'client-msg-id-invalid' }
  }
  return { ok: true, value: { text, clientMsgId: raw.clientMsgId } }
}

/** 解析 clear body：reason 可选 0..200 */
export function parseClearConversationBody(raw: unknown): Parsed<ClearConversationBody> {
  if (!isPlainObject(raw)) return { ok: false, subcause: 'body-not-object' }
  if (!hasOnlyKeys(raw, ['reason'])) return { ok: false, subcause: 'body-unknown-key' }
  if (raw.reason === undefined) return { ok: true, value: {} }
  if (typeof raw.reason !== 'string') return { ok: false, subcause: 'reason-not-string' }
  const reason = raw.reason.trim()
  if (reason.length > MAX_CLEAR_REASON) return { ok: false, subcause: 'reason-too-long' }
  return { ok: true, value: reason === '' ? {} : { reason } }
}

/** 解析 after 游标：缺省=undefined；非整数/负数=客户端错 */
export function parseAfterSeq(raw: string | undefined): Parsed<number | undefined> {
  if (raw === undefined || raw === '') return { ok: true, value: undefined }
  if (!/^\d+$/.test(raw)) return { ok: false, subcause: 'after-not-integer' }
  const value = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(value) || value < 0) return { ok: false, subcause: 'after-out-of-range' }
  return { ok: true, value }
}

/** 最后一条 clear（无则 null） */
function lastClear(entries: readonly ConversationEntry[]): Extract<ConversationEntry, { kind: 'clear' }> | null {
  let found: Extract<ConversationEntry, { kind: 'clear' }> | null = null
  for (const entry of entries) {
    if (entry.kind === 'clear' && (found === null || entry.seq > found.seq)) found = entry
  }
  return found
}

/**
 * 历史投影：只返回最后 clear 之后的消息；`after` 只做增量过滤。
 * `reset=true` = 客户端游标在 clear 之前——必须整屏重置（忽略 after，回全量有效历史）。
 */
export function projectConversationView(
  personId: string,
  entries: readonly ConversationEntry[],
  after?: number,
): ConversationView {
  const ordered = [...entries].sort((a, b) => a.seq - b.seq)
  const clear = lastClear(ordered)
  const clearSeq = clear === null ? 0 : clear.seq
  const visible = ordered.filter(
    (entry): entry is ConversationMessage => entry.kind === 'message' && entry.seq > clearSeq,
  )
  const version = ordered.length === 0 ? 0 : ordered[ordered.length - 1]!.seq
  const reset = after !== undefined && clear !== null && after < clear.seq
  const filtered = after === undefined || reset ? visible : visible.filter((message) => message.seq > after)
  const bounded = filtered.length > MAX_HISTORY_ENTRIES ? filtered.slice(-MAX_HISTORY_ENTRIES) : filtered
  return {
    personId,
    version,
    clearedAt: clear === null ? null : clear.at,
    clearSeq,
    messages: bounded,
    reset,
  }
}

/** 会话摘要：有效消息数/最后一条/最后 clear 时刻（列表页用） */
export function summarizeConversation(personId: string, entries: readonly ConversationEntry[]): ConversationSummary {
  const ordered = [...entries].sort((a, b) => a.seq - b.seq)
  const clear = lastClear(ordered)
  const clearSeq = clear === null ? 0 : clear.seq
  const visible = ordered.filter(
    (entry): entry is ConversationMessage => entry.kind === 'message' && entry.seq > clearSeq,
  )
  const last = visible.length === 0 ? null : visible[visible.length - 1]!
  return {
    personId,
    lastAt: last === null ? null : last.at,
    lastText: last === null ? null : last.text.length > 80 ? `${last.text.slice(0, 80)}…` : last.text,
    count: visible.length,
    clearedAt: clear === null ? null : clear.at,
  }
}

/** 会话列表面向 store.list 的兜底排序：最近活跃优先，空会话按工号稳定序 */
export function compareConversationSummaries(a: ConversationSummary, b: ConversationSummary): number {
  const left = a.lastAt ?? -1
  const right = b.lastAt ?? -1
  if (left !== right) return right - left
  return a.personId.localeCompare(b.personId)
}
