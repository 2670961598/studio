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
 *   - IssueCreate.description 可写且 IssueRecord 回传（task-43 F2：验收块需 get() 可读；事件流仍留痕）
 *   - IssueCreate 无 lane，lane 只能经 setField 补
 *   - 建单落位（docs/25-§3.2 IssueCreate.initialState）：显式入参 > provision
 *     states[0]（流程初态）> 默认 open；provision 存在时显式入参必须在 states 声明集内
 *     （否则显式报错，不静默落错态）
 *
 * M2 修正（单子自研切换 task-134；runbook 2026-11-19 §七.1 在案）：
 *   - scanIssueIds 旧版只认 `LOCAL-N` 前缀（ticketNo gate），迁移保留的外源 ID
 *     （`studio-dev-N`）对 list() 不可见=前缀盲区。现放宽为「票形 id」——
 *     `[A-Za-z0-9][A-Za-z0-9._-]*`（点/下划线/连字符合法，禁空/禁前导分隔符）。
 *     get/comments/links/activity 面原本就吃任意 id，本修只扩 list()/建单扫的可见集。
 *   - createIssue 自增号=全树 LOCAL-N 最大号+1（旧版取排序末位 id 的号——混 id 树上
 *     末位可能是外源 id（ticketNo=null→0+1=1），会与既有 LOCAL-1 撞号；纯 LOCAL 树
 *     行为逐位不变）。
 *   - deriveIssue 旧版 updated 只定格 created 事件 ts（transition/field-set 不前进），
 *     与本头注「updated = 末事件 ts」的冻结口径矛盾——M2 真实数据（185 张 lane 单）
 *     对账时暴露。现对齐口径：每事件 ts 即 updated。既有测试（M1 fixture 无 lane、
 *     created==updated；lifecycle 步进时钟断言）在两口径下均绿，行为无回退。
 *
 * M5 尾 #5（发号下限代码化；plan/09 §二.5/§五，2026-11-21）：
 *   - createIssue 自增号 = max(全树 LOCAL-N 最大号, 发号下限) + 1。下限源=
 *     `<platformRoot>/id-floor.json`（形如 {"min":99}；可选、不存在=无下限）。
 *     替换 2026-11-20 切单时的 LOCAL-99 占位单数据 hack（sentinel-logs/
 *     单子切换执行记录-2026-11-20.md §三：树内 max=28，用 Archived 占位单抬号到
 *     LOCAL-100 防与历史 demo LOCAL-1..28 撞号）。ops 专用文件：daemon 只读不写，
 *     人工只能由 ops/迁移脚本落盘。floor 只抬下限不压上界（低于树内 max 时仍取
 *     max+1）、只影响新发号——既有单号/list/get/activity 语义零改动。
 */
import { readdirSync } from 'node:fs'
import type { IssueCreate, IssueQuery, IssueRecord, TicketId } from '@studio-next/contract'
import { appendActivity } from './activity.ts'
import { LocalPlatformError } from './errors.ts'
import { readProvision } from './fields.ts'
import { appendJsonl, fileExists, isPlainObject, readJsonl, readTextIfExists } from './fsutil.ts'
import { idFloorPath, issuePath, issuesDir } from './layout.ts'

const ISSUE_PREFIX = 'LOCAL-'

/** 未 provision 时的初始状态 */
export const DEFAULT_INITIAL_STATE = 'open'

/**
 * provision 声明状态全集（DEV-43）：states ∪ typeInbox 值 ∪ entities 实体状态集。
 * 显式 initialState 的合法性集（null=未 provision，不闸）。派生面——调用点在
 * createIssue 建单校验，读取每单一次（事件日志平台，无热缓存诉求）。
 */
function provisionStateSet(prov: ReturnType<typeof readProvision>): Set<string> | null {
  if (prov === null) return null
  const out = new Set<string>(prov.states)
  for (const inbox of Object.values(prov.typeInbox ?? {})) out.add(inbox)
  for (const profile of Object.values(prov.entities ?? {})) {
    for (const s of profile.states) out.add(s)
  }
  return out
}

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

// 已导出（2026-11-23 公司门户，docs/plan/11-§三）：只读消费面（daemon portal）需要
// 单条原始事件流渲染时间线；与 listIssues/getIssue 同为纯读函数（零写盘）。
export function parseIssueEvents(root: string, id: TicketId): IssueEvent[] {
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

/** 票形 id 判定（M2 修：list()/建单扫的可见集口径——外源保留 id 如 studio-dev-N 亦票形） */
function isTicketStem(stem: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(stem)
}

export function compareTicketIds(a: TicketId, b: TicketId): number {
  const na = ticketNo(a)
  const nb = ticketNo(b)
  if (na !== null && nb !== null) return na - nb
  return a < b ? -1 : a > b ? 1 : 0
}

/** 扫描 issues/ 下全部票形单据 id（升序；不问前缀——M2 修，见头注） */
function scanIssueIds(root: string): TicketId[] {
  const dir = issuesDir(root)
  const out: TicketId[] = []
  if (fileExists(dir)) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.jsonl')) continue
      const stem = name.slice(0, -'.jsonl'.length)
      if (isTicketStem(stem)) out.push(stem)
    }
  }
  return out.sort(compareTicketIds)
}

/**
 * 平台级发号下限（M5 尾 #5，见文件头注）：读 `<root>/id-floor.json`（形如 {"min":99}）。
 * 可选——文件不存在=无下限（返回 null，发号退回 M2 全树 max+1 口径，行为逐位不变）。
 * 在场即严检、明报不静默：非合法 JSON / 顶层非对象 / 缺 min / 非数字 / 非安全整数 /
 * 负值 ⇒ LocalPlatformError(CONFIG_INVALID, 'bad-id-floor')——发号撞号是事故，宁可拒建单。
 * ops 专用文件（daemon 只读不写）；每次建单直读盘、无缓存——重复读幂等，同内容必同值。
 */
export function readIdFloor(root: string): number | null {
  const path = idFloorPath(root)
  const text = readTextIfExists(path)
  if (text === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new LocalPlatformError('CONFIG_INVALID', 'bad-id-floor', `${path}: 不是合法 JSON：${String(err)}`)
  }
  const min = isPlainObject(parsed) ? parsed['min'] : undefined
  if (typeof min !== 'number' || !Number.isSafeInteger(min) || min < 0) {
    throw new LocalPlatformError(
      'CONFIG_INVALID',
      'bad-id-floor',
      `${path}: 发号下限必须形如 {"min": 非负整数}（ops 专用文件，daemon 只读）`,
    )
  }
  return min
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
    if (field === 'description') {
      rec.description = value
      return
    }
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
      if (ev.input.description !== undefined) rec.description = ev.input.description
      if (ev.input.type !== undefined) rec.type = ev.input.type
      if (ev.input.dept !== undefined) rec.dept = ev.input.dept
      if (ev.input.level !== undefined) rec.level = ev.input.level
      if (ev.input.assignee !== undefined) rec.assignee = ev.input.assignee
      if (ev.input.parent !== undefined) rec.parent = ev.input.parent
    } else if (ev.type === 'transitioned') {
      if (rec === null) throw new LocalPlatformError('CONFIG_INVALID', 'corrupt-issue-log', `单据 ${id} 首事件不是 created`)
      rec.state = ev.to
      rec.updated = ev.ts // updated=末事件 ts（冻结口径；M2 修——旧版漏前进，见头注）
    } else {
      if (rec === null) throw new LocalPlatformError('CONFIG_INVALID', 'corrupt-issue-log', `单据 ${id} 首事件不是 created`)
      applySetField(rec, ev.field, ev.value)
      rec.updated = ev.ts
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
  // 初始 state（DEV-43 docs/18-§2.1.1 解析序）：显式入参 > typeInbox[type]（provision 按单据
  // 类型查收件态）> states[0]（流程初态）> 默认 open（定格进 created 事件，派生自洽）。
  // 校验先于单据 IO：provision 存在时显式入参必须在合法集内（states ∪ typeInbox 值 ∪
  // entities 实体状态集——多实体档案面的任一声明的态都可显式落位，不静默落错态）。
  const prov = readProvision(root)
  const legalStates = provisionStateSet(prov)
  if (input.initialState !== undefined && legalStates !== null && !legalStates.has(input.initialState)) {
    throw new LocalPlatformError(
      'CONFIG_INVALID',
      'bad-create-input',
      `initialState=${input.initialState} 不在 provision 声明状态集内（states/typeInbox/entities 并集）`,
    )
  }
  const firstState =
    input.initialState
    ?? (input.type !== undefined ? prov?.typeInbox?.[input.type] : undefined)
    ?? prov?.states[0]
    ?? DEFAULT_INITIAL_STATE
  // 自增号=max(全树 LOCAL-N 最大号, 发号下限)+1。树内 max 仍是 M2 口径（混 id 树上排序
  // 末位可能是外源 id，取 max 才不撞号；纯 LOCAL 树=旧版行为逐位不变）；floor=M5 尾 #5
  // 平台级下限（id-floor.json，可选、ops 专用）——只抬下限不压上界：floor 低于树内 max
  // 时仍取 max+1，floor 高于树内 max 时从 floor+1 起号（切换现场：max=28、floor=99→LOCAL-100）
  const ids = scanIssueIds(root)
  const floor = readIdFloor(root)
  let nextNo = 1
  for (const existing of ids) {
    const n = ticketNo(existing)
    if (n !== null && n >= nextNo) nextNo = n + 1
  }
  if (floor !== null && floor >= nextNo) nextNo = floor + 1
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
