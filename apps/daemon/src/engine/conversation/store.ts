/**
 * 制作人-岗位持久对话 · 会话存储（append-only JSONL，daemon 唯一读写）
 *
 * 协议依据：docs/21-§七.1/§七.4（会话不是单据；clear 留审计；出站 reply 队列）、
 * docs/v2/14-§1.9（会话面存储契约：`<rootDir>/conversations/<工号>.jsonl` + `_bindings.jsonl`）。
 *
 * 为什么不进 SQLite 台账 / 不进公司 git 契约包（docs/21-§七.1）：
 *   - 会话是运行期资产，不是组织人事事实（公司 git 目录）也不是可重建投影（events 台账）；
 *   - 纯文本 append-only：可 `jq` 复核、可重放重建、clear 是显式审计行（不物理删除）；
 *   - 无 schema migration：跨版本可读；台账只留 PATROL 审计锚（不复制正文）。
 *
 * 行的不变量：一行一 JSON，字段 `v/kind/at/id` 恒在；解析失败的行跳过并计数（不猜、不崩）。
 * 并发面：daemon 单线程同步写（appendFileSync）——本单不引入跨进程写者。
 *
 * 行族（v=1）：
 *   msg            {person,room,role:'producer'|'person'|'system',text,eventId?}
 *   clear          {person,room,by,reason?,before?,count}    ← 审计：谁/何时/清空面
 *   turn           {person,room,eventId,issue,attempt}       ← 单轮派单锚（会话→单）
 *   turn-done      {person,issue}                            ← 本轮出站已回写
 *   reply          {person,room,text,replyKind:'reply'|'notice',forIssue?} ← 出站队列
 *   delivered      {reply}                                   ← 送达回执（出队）
 *   failure-notice {person,issue,attempt}                    ← 失败回执去重（同轮同 attempt 一次）
 * 绑定文件：bind {room,person,by,reason:'explicit'|'default'}（同房后写覆盖先写）
 */
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  CONVERSATION_PERSON_ID_PATTERN,
  ROLE_LABEL,
  clip,
  parseConversationLine,
  type BindRecord,
  type ClearReceipt,
  type ContextWindow,
  type ConversationMessage,
  type ConversationMessageInput,
  type ConversationStoreOptions,
  type ConversationTurn,
  type PendingReply,
  type PersonState,
  type RawRecord,
  type ReplyKind,
} from './store-types.ts'

// 类型面再出口（既有导入路径 `./store.ts` 零漂移；实体定义单源=store-types.ts）
export { CONVERSATION_PERSON_ID_PATTERN } from './store-types.ts'
export type {
  ClearReceipt,
  ContextWindow,
  ConversationMessage,
  ConversationMessageInput,
  ConversationRole,
  ConversationStoreOptions,
  ConversationTurn,
  PendingReply,
  ReplyKind,
} from './store-types.ts'

/**
 * 会话存储（构造期建目录/装载绑定；按人懒加载消息文件）。
 * 写入失败只抛给调用方（消费件捕获并明报——不静默吞错）；读面畸形行跳过并计数。
 */
export class ConversationStore {
  readonly dir: string
  private readonly now: () => number
  private readonly makeId: () => string
  private readonly log: (line: string) => void
  private readonly maxStoredChars: number
  private readonly maxMessageChars: number
  private readonly persons = new Map<string, PersonState>()
  private readonly bindings = new Map<string, BindRecord>()
  private problems = 0

  constructor(options: ConversationStoreOptions) {
    this.dir = path.resolve(options.dir)
    this.now = options.now ?? ((): number => Date.now())
    this.makeId = options.id ?? ((): string => randomUUID())
    this.log = options.log ?? ((): void => {})
    this.maxStoredChars = options.maxStoredChars ?? 20_000
    this.maxMessageChars = options.maxMessageChars ?? 2000
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    this.loadBindings()
  }

  /** 绑定（同房后写覆盖先写；append-only 审计） */
  bind(room: string, person: string, by: string, reason: 'explicit' | 'default'): BindRecord {
    this.assertPerson(person)
    if (room.trim() === '') throw new Error('conversation/store: room 不能为空')
    const record: BindRecord = { v: 1, kind: 'bind', id: this.makeId(), at: this.now(), room, person, by, reason }
    this.appendLine(this.bindingsPath(), record)
    this.bindings.set(room, record)
    return record
  }

  /** 房间当前绑定（无=undefined——消费件按缺省岗位策略处理） */
  bindingOf(room: string): { person: string; at: number; reason: 'explicit' | 'default'; by: string } | undefined {
    const found = this.bindings.get(room)
    return found === undefined ? undefined : { person: found.person, at: found.at, reason: found.reason, by: found.by }
  }

  /**
   * 追加一条会话消息。eventId 幂等：同人同 eventId 重复投递返回既有消息（不双写）。
   * 返回 undefined 仅当 eventId 已存在（幂等命中）。
   */
  appendMessage(input: ConversationMessageInput): ConversationMessage | undefined {
    this.assertPerson(input.person)
    if (input.room.trim() === '') throw new Error('conversation/store: room 不能为空')
    const state = this.ensurePerson(input.person)
    if (input.eventId !== undefined) {
      if (state.eventIds.has(input.eventId)) return undefined
      state.eventIds.add(input.eventId)
    }
    const record: RawRecord = {
      v: 1,
      kind: 'msg',
      id: this.makeId(),
      at: this.now(),
      person: input.person,
      room: input.room,
      role: input.role,
      text: clip(input.text, this.maxStoredChars),
      ...(input.eventId !== undefined ? { eventId: input.eventId } : {}),
    }
    this.appendLine(this.personPath(input.person), record)
    state.records.push(record)
    return record
  }

  /** 幂等查询：同人同 eventId 是否已入会话（跨重启有效——靠文件装载） */
  hasEvent(person: string, eventId: string): boolean {
    return this.ensurePerson(person).eventIds.has(eventId)
  }

  /**
   * clear：追加审计行，上下文从下一条消息起归零；**不物理删除**任何历史行。
   * 返回清空条数/清空前末消息 id（审计可见）。
   */
  clear(room: string, person: string, by: string, reason?: string): ClearReceipt {
    this.assertPerson(person)
    const state = this.ensurePerson(person)
    const active = this.activeMessages(state, room)
    const before = active.length > 0 ? active[active.length - 1]?.id : undefined
    const at = this.now()
    const record: RawRecord = {
      v: 1,
      kind: 'clear',
      id: this.makeId(),
      at,
      person,
      room,
      by,
      ...(reason !== undefined && reason !== '' ? { reason } : {}),
      ...(before !== undefined ? { before } : {}),
      count: active.length,
    }
    this.appendLine(this.personPath(person), record)
    state.records.push(record)
    return { room, person, count: active.length, ...(before !== undefined ? { before } : {}), at }
  }

  /**
   * 上下文窗口（docs/21-§七.3 冻结策略）：本房、最近一次 clear 之后、按 limit 取最近，
   * 再从最旧丢到总字数 ≤ maxChars；单条超 maxMessageChars 截断。空窗口返回 ''。
   */
  context(
    person: string,
    room: string,
    opts: { limit: number; maxChars: number },
  ): ContextWindow {
    const state = this.ensurePerson(person)
    const active = this.activeMessages(state, room).filter((m) => m.role !== 'system')
    const limited = active.slice(Math.max(0, active.length - Math.max(0, opts.limit)))
    const omittedByLimit = active.length - limited.length
    const bodyChars = (m: ConversationMessage): number =>
      Math.min(m.text.length, this.maxMessageChars) + ROLE_LABEL[m.role].length + 3
    let kept = [...limited]
    let omittedByBudget = 0
    let total = kept.reduce((sum, m) => sum + bodyChars(m), 0)
    while (kept.length > 0 && total > opts.maxChars) {
      const dropped = kept.shift()
      if (dropped === undefined) break
      total -= bodyChars(dropped)
      omittedByBudget += 1
    }
    const omitted = omittedByLimit + omittedByBudget
    if (kept.length === 0) return { text: '', included: 0, omitted }
    const lines: string[] = []
    if (omitted > 0) lines.push(`（更早 ${omitted} 条已省略）`)
    for (const m of kept) {
      const text = m.text.length <= this.maxMessageChars ? m.text : `${m.text.slice(0, this.maxMessageChars)}\n…（超长截断）`
      const label = m.role === 'person' ? m.person : ROLE_LABEL[m.role]
      lines.push(`${label}：${text}`)
    }
    return { text: lines.join('\n'), included: kept.length, omitted }
  }

  /** 登记单轮派单锚（同 issue 幂等；返回既有/新建） */
  recordTurn(input: { issue: string; person: string; room: string; eventId: string; attempt: number }): ConversationTurn {
    this.assertPerson(input.person)
    const state = this.ensurePerson(input.person)
    const existing = state.turns.get(input.issue)
    if (existing !== undefined) return existing
    const record: RawRecord = {
      v: 1,
      kind: 'turn',
      id: this.makeId(),
      at: this.now(),
      person: input.person,
      room: input.room,
      eventId: input.eventId,
      issue: input.issue,
      attempt: input.attempt,
    }
    this.appendLine(this.personPath(input.person), record)
    state.records.push(record)
    const turn: ConversationTurn = { ...input, at: record.at, done: false }
    state.turns.set(input.issue, turn)
    return turn
  }

  turnOf(issue: string): (ConversationTurn & { person: string }) | undefined {
    for (const [person, state] of this.persons) {
      const turn = state.turns.get(issue)
      if (turn !== undefined) return { ...turn, person }
    }
    for (const file of this.personFiles()) {
      const person = path.basename(file, '.jsonl')
      if (!CONVERSATION_PERSON_ID_PATTERN.test(person)) continue
      const state = this.ensurePerson(person)
      const turn = state.turns.get(issue)
      if (turn !== undefined) return { ...turn, person }
    }
    return undefined
  }

  /** 本轮出站已回写（append-only 标记；重复调用幂等） */
  markTurnDone(issue: string): boolean {
    const found = this.turnOf(issue)
    if (found === undefined || found.done) return false
    const record: RawRecord = { v: 1, kind: 'turn-done', id: this.makeId(), at: this.now(), person: found.person, issue }
    this.appendLine(this.personPath(found.person), record)
    const state = this.ensurePerson(found.person)
    state.records.push(record)
    const turn = state.turns.get(issue)
    if (turn !== undefined) turn.done = true
    return true
  }

  /** 出站队列：reply/notice 入队（发送失败积压，下一拍重试） */
  enqueueReply(input: { person: string; room: string; text: string; kind: ReplyKind; forIssue?: string }): PendingReply {
    this.assertPerson(input.person)
    const state = this.ensurePerson(input.person)
    const record: RawRecord = {
      v: 1,
      kind: 'reply',
      id: this.makeId(),
      at: this.now(),
      person: input.person,
      room: input.room,
      text: clip(input.text, this.maxStoredChars),
      replyKind: input.kind,
      ...(input.forIssue !== undefined ? { forIssue: input.forIssue } : {}),
    }
    this.appendLine(this.personPath(input.person), record)
    state.records.push(record)
    const reply: PendingReply = {
      id: record.id,
      at: record.at,
      person: input.person,
      room: input.room,
      text: record.text,
      kind: input.kind,
      ...(input.forIssue !== undefined ? { forIssue: input.forIssue } : {}),
    }
    state.replies.set(record.id, reply)
    return reply
  }

  /** 待发送队列（按入队序；limit 有界——会话面不占满主循环） */
  pendingReplies(limit: number): PendingReply[] {
    const out: PendingReply[] = []
    for (const file of this.personFiles()) {
      const person = path.basename(file, '.jsonl')
      if (!CONVERSATION_PERSON_ID_PATTERN.test(person)) continue
      const state = this.ensurePerson(person)
      for (const reply of state.replies.values()) {
        if (state.delivered.has(reply.id)) continue
        out.push(reply)
      }
    }
    out.sort((a, b) => a.at - b.at)
    return out.slice(0, Math.max(0, limit))
  }

  /** 送达回执（出队；重复回执幂等） */
  markDelivered(replyId: string): boolean {
    for (const [person, state] of this.persons) {
      if (!state.replies.has(replyId) || state.delivered.has(replyId)) continue
      const record: RawRecord = { v: 1, kind: 'delivered', id: this.makeId(), at: this.now(), person, reply: replyId }
      this.appendLine(this.personPath(person), record)
      state.records.push(record)
      state.delivered.add(replyId)
      return true
    }
    for (const file of this.personFiles()) {
      const person = path.basename(file, '.jsonl')
      if (!CONVERSATION_PERSON_ID_PATTERN.test(person) || this.persons.has(person)) continue
      const state = this.ensurePerson(person)
      if (!state.replies.has(replyId) || state.delivered.has(replyId)) continue
      const record: RawRecord = { v: 1, kind: 'delivered', id: this.makeId(), at: this.now(), person, reply: replyId }
      this.appendLine(this.personPath(person), record)
      state.records.push(record)
      state.delivered.add(replyId)
      return true
    }
    return false
  }

  /** 失败回执去重（同轮同 attempt 只发一次；跨重启有效） */
  failureNoticeSent(issue: string, attempt: number): boolean {
    for (const file of this.personFiles()) {
      const person = path.basename(file, '.jsonl')
      if (!CONVERSATION_PERSON_ID_PATTERN.test(person)) continue
      if (this.ensurePerson(person).failureNotices.has(`${issue}#${attempt}`)) return true
    }
    return false
  }

  recordFailureNotice(person: string, issue: string, attempt: number): void {
    this.assertPerson(person)
    const state = this.ensurePerson(person)
    const key = `${issue}#${attempt}`
    if (state.failureNotices.has(key)) return
    const record: RawRecord = { v: 1, kind: 'failure-notice', id: this.makeId(), at: this.now(), person, issue, attempt }
    this.appendLine(this.personPath(person), record)
    state.records.push(record)
    state.failureNotices.add(key)
  }

  /** 只读统计（/status 回执与观测面） */
  stats(person: string): { messages: number; turns: number; pendingReplies: number; problems: number } {
    const state = this.ensurePerson(person)
    return {
      messages: state.records.filter((r) => r.kind === 'msg').length,
      turns: state.turns.size,
      pendingReplies: [...state.replies.values()].filter((r) => !state.delivered.has(r.id)).length,
      problems: this.problems,
    }
  }

  /** 该房最近一次 clear 之后的消息（内部/测试同源） */
  private activeMessages(state: PersonState, room: string): ConversationMessage[] {
    const out: ConversationMessage[] = []
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

  private personFiles(): string[] {
    if (!existsSync(this.dir)) return []
    return readdirSync(this.dir)
      .filter((name) => name.endsWith('.jsonl') && !name.startsWith('_'))
      .map((name) => path.join(this.dir, name))
  }

  private ensurePerson(person: string): PersonState {
    this.assertPerson(person)
    const existing = this.persons.get(person)
    if (existing !== undefined) return existing
    const state: PersonState = {
      records: [],
      eventIds: new Set(),
      turns: new Map(),
      replies: new Map(),
      delivered: new Set(),
      failureNotices: new Set(),
      lastProblemAt: 0,
    }
    this.persons.set(person, state)
    const file = this.personPath(person)
    if (!existsSync(file)) return state
    const text = readFileSync(file, 'utf8')
    for (const [index, line] of text.split('\n').entries()) {
      if (line.trim() === '') continue
      const record = parseConversationLine(line, `${person}.jsonl:${index + 1}`, (message) => this.noteProblem(message))
      if (record === undefined || record.kind === 'bind') continue
      state.records.push(record)
      if (record.kind === 'msg' && record.eventId !== undefined) state.eventIds.add(record.eventId)
      if (record.kind === 'clear') {
        // clear 只影响上下文读面（activeMessages 顺序扫描），无需额外状态
        continue
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
    return state
  }

  private loadBindings(): void {
    const file = this.bindingsPath()
    if (!existsSync(file)) return
    const text = readFileSync(file, 'utf8')
    for (const [index, line] of text.split('\n').entries()) {
      if (line.trim() === '') continue
      const raw = parseConversationLine(line, `_bindings.jsonl:${index + 1}`, (message) => this.noteProblem(message))
      if (raw === undefined || raw.kind !== 'bind') continue
      this.bindings.set(raw.room, raw)
    }
  }

  /** 畸形行计数+日志（只报位置/原因，不回显正文——会话正文按敏感内容对待） */
  private noteProblem(message: string): void {
    this.problems += 1
    this.log(message)
  }

  private appendLine(file: string, record: RawRecord | BindRecord): void {
    const line = `${JSON.stringify(record)}\n`
    // 目录已在构造期建好；文件首次创建即 0600（会话正文按敏感内容对待：不落日志/不回显）
    const created = !existsSync(file)
    appendFileSync(file, line, { encoding: 'utf8', mode: 0o600 })
    if (created) {
      try {
        chmodSync(file, 0o600)
      } catch (err) {
        this.log(`[conversation] 会话文件 chmod 0600 失败（不阻断写）：${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  private personPath(person: string): string {
    this.assertPerson(person)
    return path.join(this.dir, `${person}.jsonl`)
  }

  private bindingsPath(): string {
    return path.join(this.dir, '_bindings.jsonl')
  }

  private assertPerson(person: string): void {
    if (!CONVERSATION_PERSON_ID_PATTERN.test(person)) {
      throw new Error(`conversation/store: 非法工号 ${person}（只允许大写字母/数字与连字符段——路径安全闸）`)
    }
  }
}

/** 目录存在性只读探测（装配面 fail-fast：不可写由首次写暴露，不在启动期造文件） */
export function conversationDirReady(dir: string): boolean {
  return existsSync(dir) && statSync(dir).isDirectory()
}
