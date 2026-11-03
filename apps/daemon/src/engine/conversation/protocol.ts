/**
 * 制作人-岗位持久对话 · 消费侧协议（不可信输入二次校验 + 命令解析）
 *
 * 为什么在 daemon 侧再校验一次（这与 matrix 源侧校验不是重复实现，是信任边界）：
 *   - docs/21-§三：频道内容按不可信输入对待；意图 payload 可能来自伪造源/上游漂移，
 *     消费件必须按自己的形状闸收窄（既有 `checkMentionPayload` 同款纪律）；
 *   - daemon 不依赖 `@studio-next/matrix`（docs/25-§一.2 依赖方向冻结）：共享 guard 若放
 *     matrix 包会反向依赖；放 contract 又等于扩契约面。故本件是 daemon 侧唯一判据，
 *     与源侧解析器各自独立（双层校验，非同一实现复制）。
 *
 * 形状（docs/v2/14-§1.9）：`{target:'', mention:'DM', text, eventId, sender, room,
 * channel, conversation:{v:1}}`——target 空串是契约（绑定归本侧，源侧不猜岗位）。
 */

/** 会话负载版本（与 matrix `CONVERSATION_PAYLOAD_VERSION` 同值；各侧独立常量，漂移由测试钉） */
export const CONVERSATION_PAYLOAD_VERSION = 1

/**
 * 会话轮次的冻结验收命令（docs/21-§七.4，studio-dev-646）：REPORT 正文=回给制作人的话，
 * 只要求非空；**不复用工程单全局 acceptance**（否则对话题等 deliverables/plan.md，
 * 结构性 GATE_FAIL）。gateRunner/任务书装配两处同源引用本常量。
 */
export const CONVERSATION_ACCEPTANCE: readonly string[] = ['test -s REPORT.md']

export interface ConversationDmPayload {
  target: ''
  mention: 'DM'
  text: string
  eventId: string
  sender: string
  room: string
  channel: string
  conversation: { v: number }
}

/** 严格形状闸（字段缺失/类型不符/版本不符一律 false，不猜） */
export function isConversationPayload(payload: unknown): payload is ConversationDmPayload {
  if (typeof payload !== 'object' || payload === null) return false
  const p = payload as Record<string, unknown>
  if (p.target !== '') return false
  if (p.mention !== 'DM') return false
  for (const key of ['text', 'eventId', 'sender', 'room', 'channel'] as const) {
    if (typeof p[key] !== 'string') return false
  }
  const marker = p.conversation
  if (typeof marker !== 'object' || marker === null) return false
  return (marker as { v?: unknown }).v === CONVERSATION_PAYLOAD_VERSION
}

/** 命令（纯函数；消费件与测试同源）：'/bind PRIME-0' → {name:'bind',person:'PRIME-0'} */
export type ConversationCommand =
  | { name: 'bind'; person?: string }
  | { name: 'clear'; reason?: string }
  | { name: 'status' }
  | { name: 'help' }
  | { name: 'unknown'; raw: string }

/**
 * 命令解析：只认 `/` 前缀命令；为兼容制作人习惯额外接受单词 `clear`（docs/21-§七.4）。
 * 非命令返回 undefined（普通消息）。命令参数原样保留（工号大写化；原因文本不截断）。
 */
export function parseConversationCommand(text: string): ConversationCommand | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/') && trimmed.toLowerCase() !== 'clear') return undefined
  const body = trimmed.startsWith('/') ? trimmed.slice(1).trim() : trimmed
  const [head = '', ...rest] = body.split(/\s+/)
  const name = head.toLowerCase()
  const arg = rest.join(' ').trim()
  if (name === 'bind') return arg === '' ? { name: 'bind' } : { name: 'bind', person: arg.toUpperCase() }
  if (name === 'clear') return arg === '' ? { name: 'clear' } : { name: 'clear', reason: arg }
  if (name === 'status') return { name: 'status' }
  if (name === 'help') return { name: 'help' }
  return { name: 'unknown', raw: trimmed }
}
