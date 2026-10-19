/**
 * 单据面 —— issues/<id>.jsonl 事件流（append-only）+ 派生读取。
 *
 * 事件三型（每行一条）：
 *   { type: 'created',      ts, state, input }   初始 state 在建单时定格（provision 或默认）
 *   { type: 'transitioned', ts, to }              状态只能经此推进（18-§二 状态权威在平台侧）
 *   { type: 'field-set',    ts, field, value }    字段写入
 *
 * 当前 state / 各字段 = 折叠事件派生；updated = 末事件 ts。
 * 「建单后再改 provision」不影响历史单据（初始 state 已定格在 created 事件里，派生自洽）。
 *
 * 端口缺口注记（只记录不改 contract）：
 *   - IssueQuery.project 无处可读（IssueRecord/IssueCreate 均无 project 维）——
 *     LocalFile 是单项目平台，该过滤维忽略（不能凭空造数据）
 *   - IssueCreate.description 可写但 IssueRecord 无此字段，get() 查不回（事件里有留痕）
 *   - IssueCreate 无 lane，lane 只能经 setField 补
 *   - 建单落位（docs/25-§3.2 IssueCreate.initialState）：显式入参 > provision
 *     states[0]（流程初态）> 默认 open；provision 存在时显式入参必须在 states 声明集内
 *     （否则显式报错，不静默落错态）
 */
import { readdirSync } from 'node:fs'
import type { IssueCreate, IssueQuery, IssueRecord, TicketId } from '@studio-next/contract'
import { appendActivity } from './activity.ts'
import { LocalPlatformError } from './errors.ts'
import { readProvision } from './fields.ts'
import { appendJsonl, fileExists, readJsonl } from './fsutil.ts'
import { issuePath, issuesDir } from './layout.ts'

const ISSUE_PREFIX = 'LOCAL-'

/** 未 provision 时的初始状态 */
export const DEFAULT_INITIAL_STATE = 'open'

/** setField 可写的记录字段（string 族；level 另走数字校验） */
const SETTABLE_STRING_FIELDS = ['title', 'description', 'type', 'dept', 'lane', 'assignee', 'parent'] as const

export type IssueEvent =
  | { type: 'created'; ts: string; state: string; input: IssueCreate }
  | { type: 'transitioned'; ts: string; to: string }
  | { type: 'field-set'; ts: string; field: string; value: unknown }

export function isIssueEvent(v: unknown): v is IssueEvent {
  if (typeof v !== 'object' || v === null) return false
  const ev = v as Record<string, unknown>
  if (ev['type'] === 'created') {
    return typeof ev['ts'] === 'string' && typeof ev['state'] === 'string' && typeof ev['input'] === 'object'
  }
  if (ev['type'] === 'transitioned') {
    return typeof ev['ts'] === 'string' && typeof ev['to'] === 'string'
  }
  if (ev['type'] === 'field-set') {
    return typeof ev['ts'] === 'string' && typeof ev['field'] === 'string' && 'value' in ev
  }
  return false
}

function parseIssueEvents(root: string, id: TicketId): IssueEvent[] {
  const path = issuePath(root, id)
  return readJsonl(path).map((line, i) => {
    if (!isIssueEvent(line)) {
      throw new LocalPlatformError('CONFIG_INVALID', 'corrupt-issue-log', `${path}: 第 ${i + 1} 行不是合法单据事件`)
    }
    return line
  })
}

function ticketNo(id: TicketId): number | null {
  if (!id.startsWith(ISSUE_PREFIX)) return null
  const digits = id.slice(ISSUE_PREFIX.length)
  if (!/^\d+$/.test(digits)) return null
  const n = Number(digits)
  return Number.isSafeInteger(n) ? n : null
}

export function compareTicketIds(a: TicketId, b: TicketId): number {
  const na = ticketNo(a)
  const nb = ticketNo(b)
  if (na !== null && nb !== null) return na - nb
  return a < b ? -1 : a > b ? 1 : 0
}

/** 扫描 issues/ 下本前缀的单据 id（升序） */
function scanIssueIds(root: string): TicketId[] {
  const dir = issuesDir(root)
  const out: TicketId[] = []
  if (fileExists(dir)) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.jsonl')) continue
      const stem = name.slice(0, -'.jsonl'.length)
      if (ticketNo(stem) !== null) out.push(stem)
    }
  }
  return out.sort(compareTicketIds)
}

function validateIssueCreate(input: IssueCreate): void {
  if (typeof input.title !== 'string' || input.title.trim() === '') {
    throw new LocalPlatformError('CONFIG_INVALID', 'bad-create-input', 'title 必填且非空')
  }
  for (const field of ['description', 'type', 'dept', 'assignee', 'parent'] as const) {
    const v = input[field]
    if (v !== undefined && typeof v !== 'string') {
      throw new LocalPlatformError('CONFIG_INVALID', 'bad-create-input', `${field} 必须是字符串`)
    }
  }
  if (input.level !== undefined && (typeof input.level !== 'number' || !Number.isInteger(input.level))) {
    throw new LocalPlatformError('CONFIG_INVALID', 'bad-create-input', 'level 必须是整数')
  }
  if (input.initialState !== undefined && (typeof input.initialState !== 'string' || input.initialState.trim() === '')) {
    throw new LocalPlatformError('CONFIG_INVALID', 'bad-create-input', 'initialState 必须是非空字符串')
  }
}

/** setField 应用一条字段写入到记录上（写入前校验 + 派生时复用同一函数，保证口径一致） */
function applySetField(rec: IssueRecord, field: string, value: unknown): void {
  if (field === 'state') {
    throw new LocalPlatformError(
      'CONFIG_INVALID',
      'state-via-set-field',
      '状态只能经 transition() 推进，setField 不接受 state（docs/18-§二）',
    )
  }
  if (field === 'level') {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new LocalPlatformError('CONFIG_INVALID', 'bad-field-value', 'level 必须是整数')
    }
    rec.level = value
    return
  }
  if ((SETTABLE_STRING_FIELDS as readonly string[]).includes(field)) {
    if (typeof value !== 'string') {
      throw new LocalPlatformError('CONFIG_INVALID', 'bad-field-value', `${field} 必须是字符串`)
    }
    if (field === 'title' && value.trim() === '') {
      throw new LocalPlatformError('CONFIG_INVALID', 'bad-field-value', 'title 不能置空')
    }
    if (field === 'description') return // 事件留痕；IssueRecord 无此字段（端口缺口注记见头注）
    rec[field as 'type' | 'dept' | 'lane' | 'assignee' | 'parent'] = value
    return
  }
  throw new LocalPlatformError('CONFIG_INVALID', 'unknown-field', `未知字段：${field}`)
}

/** 折叠事件 → IssueRecord（末事件 ts 即 updated；派生态对齐台账哲学） */
export function deriveIssue(id: TicketId, events: IssueEvent[]): IssueRecord {
  let rec: IssueRecord | null = null
  for (const ev of events) {
    if (ev.type === 'created') {
      validateIssueCreate(ev.input)
      rec = { id, title: ev.input.title, state: ev.state, updated: ev.ts }
      if (ev.input.type !== undefined) rec.type = ev.input.type
      if (ev.input.dept !== undefined) rec.dept = ev.input.dept
      if (ev.input.level !== undefined) rec.level = ev.input.level
      if (ev.input.assignee !== undefined) rec.assignee = ev.input.assignee
      if (ev.input.parent !== undefined) rec.parent = ev.input.parent
    } else if (ev.type === 'transitioned') {
      if (rec === null) throw new LocalPlatformError('CONFIG_INVALID', 'corrupt-issue-log', `单据 ${id} 首事件不是 created`)
      rec.state = ev.to
    } else {
      if (rec === null) throw new LocalPlatformError('CONFIG_INVALID', 'corrupt-issue-log', `单据 ${id} 首事件不是 created`)
      applySetField(rec, ev.field, ev.value)
    }
  }
  if (rec === null) {
    throw new LocalPlatformError('CONFIG_INVALID', 'corrupt-issue-log', `单据 ${id} 事件流为空`)
  }
  return rec
}

function requireIssue(root: string, id: TicketId): IssueEvent[] {
  const events = parseIssueEvents(root, id)
  if (events.length === 0) {
    throw new LocalPlatformError('EXTERNAL_REJECT', 'issue-not-found', `单据不存在：${id}`)
  }
  return events
}

export function getIssue(root: string, id: TicketId): IssueRecord {
  return deriveIssue(id, requireIssue(root, id))
}

function matchesQuery(rec: IssueRecord, q: IssueQuery): boolean {
  if (q.stateIn !== undefined && !q.stateIn.includes(rec.state)) return false
  if (q.assignee !== undefined && rec.assignee !== q.assignee) return false
  if (q.lane !== undefined && rec.lane !== q.lane) return false
  // ISO-8601 UTC 字典序即时间序（本实现全部时间戳都是 toISOString 产物）
  if (q.updatedSince !== undefined && !(rec.updated > q.updatedSince)) return false
  // q.project：单项目平台，忽略（端口缺口注记见头注）
  return true
}

export function listIssues(root: string, q: IssueQuery): IssueRecord[] {
  const out: IssueRecord[] = []
  for (const id of scanIssueIds(root)) {
    const rec = deriveIssue(id, parseIssueEvents(root, id))
    if (matchesQuery(rec, q)) out.push(rec)
  }
  return out
}

export function createIssue(root: string, now: () => string, input: IssueCreate): IssueRecord {
  validateIssueCreate(input)
  // 初始 state：显式入参 > provisioned states[0]（流程初态）> 默认 open（定格进 created 事件，派生自洽）
  // 校验先于单据 IO：provision 存在时显式入参必须在 states 声明集内（不静默落错态）
  const prov = readProvision(root)
  if (input.initialState !== undefined && prov !== null && !prov.states.includes(input.initialState)) {
    throw new LocalPlatformError(
      'CONFIG_INVALID',
      'bad-create-input',
      `initialState=${input.initialState} 不在 provision states 声明集 [${prov.states.join(',')}] 内`,
    )
  }
  const firstState = input.initialState ?? prov?.states[0] ?? DEFAULT_INITIAL_STATE
  const ids = scanIssueIds(root)
  const last = ids[ids.length - 1]
  const nextNo = last === undefined ? 1 : (ticketNo(last) ?? 0) + 1
  const id = `${ISSUE_PREFIX}${nextNo}`
  appendJsonl(issuePath(root, id), { type: 'created', ts: now(), state: firstState, input })
  appendActivity(root, now, { issue: id, kind: 'created' })
  return deriveIssue(id, parseIssueEvents(root, id))
}

export function transitionIssue(root: string, now: () => string, id: TicketId, toState: string): IssueRecord {
  if (typeof toState !== 'string' || toState.trim() === '') {
    throw new LocalPlatformError('CONFIG_INVALID', 'bad-state', '目标状态必须非空')
  }
  requireIssue(root, id)
  // guard 不强制执行（LocalFile 是契约靶子；规则落盘见 guards.ts 头注）
  appendJsonl(issuePath(root, id), { type: 'transitioned', ts: now(), to: toState })
  appendActivity(root, now, { issue: id, kind: 'transitioned' })
  return deriveIssue(id, parseIssueEvents(root, id))
}

export function setIssueField(root: string, now: () => string, id: TicketId, field: string, value: unknown): void {
  const rec = getIssue(root, id)
  applySetField(rec, field, value) // 仅做写入前校验（非法字段/值在此拦截），改动弃置
  appendJsonl(issuePath(root, id), { type: 'field-set', ts: now(), field, value })
  appendActivity(root, now, { issue: id, kind: 'field-set' })
}
