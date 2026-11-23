/**
 * portal/tickets-view —— 单子列表筛选/排序/导出的纯函数层（v3 第二刀，§十.2）。
 *
 * 依据：docs/plan/11-公司门户-2026-11-23.md §十.2（states/assignee/sort/dir 加法式参数＋
 * 导出端点同源筛选）。单源原则：页面 /tickets 与 /api/tickets/export 共用本件，
 * data.ts 的 ticketList 亦委托 filterTickets/sortTickets（既有单 state 语义逐字节不变）。
 * 零 IO、零写面（导出只读已取到的内存列表——三事实源写入者不变，§十.0）。
 */
import type { IssueRecord } from '@studio-next/contract'

/** 导出行上限（§十.2：5000 行；超出截断并如实标 capped） */
export const TICKETS_EXPORT_MAX_ROWS = 5000
/** states 多选参数上限（防查询串拉爆；超量截断不报错） */
export const TICKETS_STATES_MAX = 16

export type TicketSortKey = 'updated' | 'id'
export type TicketSortDir = 'asc' | 'desc'

/** 单子列表查询（页面/API/导出共用；states 空数组=不过滤状态） */
export interface TicketQuery {
  readonly states: readonly string[]
  readonly assignee: string | undefined
  readonly search: string
  readonly sort: TicketSortKey
  readonly dir: TicketSortDir
}

/** 缺省查询（全部状态 · 不筛负责人 · 更新时间倒序——与既有列表缺省一致） */
export const DEFAULT_TICKET_QUERY: TicketQuery = { states: [], assignee: undefined, search: '', sort: 'updated', dir: 'desc' }

/**
 * `states=a,b,c` 查询参解析：逗号分隔、去空白、去空段、去重、上限 16；
 * 非法（超长段）按段丢弃不报错——筛选参数宽容、发送类参数才严格。
 */
export function parseStatesParam(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return []
  const seen = new Set<string>()
  for (const part of raw.split(',')) {
    const state = part.trim()
    if (state === '' || state.length > 64) continue
    seen.add(state)
    if (seen.size >= TICKETS_STATES_MAX) break
  }
  return [...seen]
}

/** 排序参数解析（白名单外落缺省——链接可手工改坏不炸页面） */
export function parseSortParam(raw: string | undefined): TicketSortKey {
  return raw === 'id' ? 'id' : 'updated'
}

/** 方向参数解析（白名单外落缺省 desc） */
export function parseDirParam(raw: string | undefined): TicketSortDir {
  return raw === 'asc' ? 'asc' : 'desc'
}

/** 关键字过滤（单号/标题/负责人子串，大小写不敏感——与既有 ticketList 同口径） */
function matchSearch(t: IssueRecord, needle: string): boolean {
  return t.id.toLowerCase().includes(needle) || t.title.toLowerCase().includes(needle) || (t.assignee ?? '').toLowerCase().includes(needle)
}

/** 筛选（states 多选∈／assignee 全等／search 子串）；零拷贝入参、返回新数组 */
export function filterTickets(items: readonly IssueRecord[], q: Pick<TicketQuery, 'states' | 'assignee' | 'search'>): IssueRecord[] {
  const needle = q.search.trim().toLowerCase()
  return items.filter((t) => {
    if (q.states.length > 0 && !q.states.includes(t.state)) return false
    if (q.assignee !== undefined && q.assignee !== '' && t.assignee !== q.assignee) return false
    if (needle !== '' && !matchSearch(t, needle)) return false
    return true
  })
}

/** 排序（updated=ISO 字符串序；id=localeCompare；dir 只翻转主键——tiebreak 恒 id 升序，确定性） */
export function sortTickets(items: readonly IssueRecord[], sort: TicketSortKey, dir: TicketSortDir): IssueRecord[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...items].sort((a, b) => {
    const primary = sort === 'id' ? a.id.localeCompare(b.id) : a.updated.localeCompare(b.updated)
    if (primary !== 0) return primary * sign
    return a.id.localeCompare(b.id)
  })
}

/** 筛选＋排序一步（ticketList/导出端点共用） */
export function queryTickets(items: readonly IssueRecord[], q: TicketQuery): IssueRecord[] {
  return sortTickets(filterTickets(items, q), q.sort, q.dir)
}

/** 单子 → 导出/API 行（id/title/state/assignee/dept/lane/level/parent/updated；缺失字段省略） */
export function ticketRow(t: IssueRecord): Record<string, unknown> {
  return {
    id: t.id,
    title: t.title,
    state: t.state,
    ...(t.assignee !== undefined ? { assignee: t.assignee } : {}),
    ...(t.dept !== undefined ? { dept: t.dept } : {}),
    ...(t.lane !== undefined ? { lane: t.lane } : {}),
    ...(t.level !== undefined ? { level: t.level } : {}),
    ...(t.parent !== undefined ? { parent: t.parent } : {}),
    updated: t.updated,
  }
}

/** CSV 单元格转义：含 逗号/引号/换行 即整体加引号，内部引号翻倍（RFC 4180 口径） */
export function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

const CSV_HEADER = ['单号', '标题', '状态', '负责人', '部门', '泳道', '等级', '父单', '更新时间'] as const

/** 单子列表 → CSV 文本（UTF-8 BOM 前缀——Excel 直开不乱码；§十.2） */
export function ticketsCsv(items: readonly IssueRecord[]): string {
  const rows = items.map((t) =>
    [t.id, t.title, t.state, t.assignee ?? '', t.dept ?? '', t.lane ?? '', t.level !== undefined ? String(t.level) : '', t.parent ?? '', t.updated]
      .map((v) => csvCell(v))
      .join(','),
  )
  return `\uFEFF${[CSV_HEADER.join(','), ...rows].join('\r\n')}\r\n`
}

/** 导出 JSON 回包（items 恒 ≤5000；capped 如实上报） */
export function ticketsExportJson(items: readonly IssueRecord[], totalBeforeCap: number): Record<string, unknown> {
  return { ok: true, total: totalBeforeCap, returned: items.length, capped: totalBeforeCap > items.length, items: items.map(ticketRow) }
}

/** 导出文件名（UTC 日期戳；免宿主信息） */
export function ticketsExportName(format: 'csv' | 'json', nowMs: number): string {
  const d = new Date(nowMs)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const day = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
  return `tickets-${day}.${format}`
}
