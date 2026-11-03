/**
 * engine/conversation/store-reload —— 会话文件装载/签名纯件（studio-dev-654b 先拆后增）
 *
 * 20-§十五.三（600 行阈「先拆再增」）：store.ts 在 654a 后 583/600（余 17），654b 需新增
 * 跨进程重载的上下文排除/轮次查询等读面；按 Lead 纪律先把「装载/签名/bindings 解析」抽到本件
 * （零状态、纯 IO→数据结构），store.ts 只留读写成编排，保持 <520 行。
 *
 * 边界：本件不持实例状态；坏行只回调 onProblem（不回显正文），不抛。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import {
  parseConversationLine,
  type BindRecord,
  type ConversationRole,
  type PersonState,
  type RawRecord,
} from './store-types.ts'

/** 文件签名（size:mtimeMs；不存在=undefined）——跨进程读面重载的唯一判据（不轮询 sleep） */
export function fileSignature(file: string): string | undefined {
  if (!existsSync(file)) return undefined
  const info = statSync(file)
  return `${String(info.size)}:${String(info.mtimeMs)}`
}

/** 空 PersonState（一个工号的读面缓存初值） */
export function emptyPersonState(): PersonState {
  return {
    records: [],
    eventIds: new Set(),
    clientMsgIds: new Map(),
    turns: new Map(),
    replies: new Map(),
    delivered: new Set(),
    failureNotices: new Set(),
    lastProblemAt: 0,
  }
}

/**
 * 装载某工号会话文件并重建 state（append-only 全量重放；坏行跳过并回调计数）。
 * 文件不存在=空 state（不建文件）。
 */
export function loadPersonState(args: {
  readonly person: string
  readonly file: string
  readonly noteProblem: (message: string) => void
}): PersonState {
  const state = emptyPersonState()
  if (!existsSync(args.file)) return state
  const text = readFileSync(args.file, 'utf8')
  for (const [index, line] of text.split('\n').entries()) {
    if (line.trim() === '') continue
    const where = `${args.person}.jsonl:${index + 1}`
    const record = parseConversationLine(line, where, args.noteProblem)
    if (record === undefined || record.kind === 'bind') continue
    state.records.push(record)
    applyRecord(state, record)
  }
  return state
}

/** 单行记录 → state 索引（装载与增量写共用口径） */
export function applyRecord(state: PersonState, record: RawRecord): void {
  if (record.kind === 'msg' && record.eventId !== undefined) state.eventIds.add(record.eventId)
  if (record.kind === 'msg' && record.clientMsgId !== undefined) state.clientMsgIds.set(record.clientMsgId, record.id)
  if (record.kind === 'clear') {
    // clear 只影响上下文读面（activeMessages 顺序扫描），无需额外状态
    return
  }
  if (record.kind === 'turn') {
    state.turns.set(record.issue, {
      issue: record.issue,
      person: record.person,
      room: record.room,
      eventId: record.eventId,
      at: record.at,
      attempt: record.attempt,
      done: state.turns.get(record.issue)?.done ?? false,
    })
  }
  if (record.kind === 'turn-done') {
    const turn = state.turns.get(record.issue)
    if (turn !== undefined) turn.done = true
  }
  if (record.kind === 'reply') {
    state.replies.set(record.id, {
      id: record.id,
      at: record.at,
      person: record.person,
      room: record.room,
      text: record.text,
      kind: record.replyKind,
      ...(record.forIssue !== undefined ? { forIssue: record.forIssue } : {}),
    })
  }
  if (record.kind === 'delivered') state.delivered.add(record.reply)
  if (record.kind === 'failure-notice') state.failureNotices.add(`${record.issue}#${record.attempt}`)
}

/** 本房最后一条 clear 之后的消息（含 system；调用方按需过滤）——纯读，不触 IO */
export function activeMessagesOf(state: PersonState, room: string): Array<{
  readonly id: string
  readonly at: number
  readonly person: string
  readonly room: string
  readonly role: ConversationRole
  readonly text: string
  readonly eventId?: string
}> {
  const out: Array<{
    readonly id: string
    readonly at: number
    readonly person: string
    readonly room: string
    readonly role: ConversationRole
    readonly text: string
    readonly eventId?: string
  }> = []
  for (const record of state.records) {
    if (record.kind === 'clear' && record.room === room) {
      out.length = 0
      continue
    }
    if (record.kind !== 'msg' || record.room !== room) continue
    out.push({
      id: record.id,
      at: record.at,
      person: record.person,
      room: record.room,
      role: record.role,
      text: record.text,
      ...(record.eventId !== undefined ? { eventId: record.eventId } : {}),
    })
  }
  return out
}

/** 装载 `_bindings.jsonl` 到目标 Map（同房后写覆盖先写；坏行跳过并回调） */
export function loadBindingsInto(
  target: Map<string, BindRecord>,
  args: { readonly file: string; readonly noteProblem: (message: string) => void },
): void {
  if (!existsSync(args.file)) return
  const text = readFileSync(args.file, 'utf8')
  for (const [index, line] of text.split('\n').entries()) {
    if (line.trim() === '') continue
    const raw = parseConversationLine(line, `_bindings.jsonl:${index + 1}`, args.noteProblem)
    if (raw === undefined || raw.kind !== 'bind') continue
    target.set(raw.room, raw)
  }
}
