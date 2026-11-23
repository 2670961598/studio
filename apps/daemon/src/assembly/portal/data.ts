/**
 * portal/data —— 公司门户数据层（全部只读；缺件降级不臆造）。
 *
 * 依据：docs/plan/11-公司门户-2026-11-23.md §三（数据来源／降级矩阵／安全）。
 * 三事实源纪律不破：平台单子/公司目录/台账均零写（§七 不做项）。
 *
 * 只读口径：
 *   - 单子：@studio-next/localplatform 只读出口（listIssues/getIssue/parseIssueEvents——
 *     绕开 createLocalPlatform 构造即 ensureDir 的写面）；平台根缺失→空列表＋available=false，
 *     绝不 mkdir。
 *   - 台账：store openLedger 只读查询（queryEvents；--db 缺失由装配层拒启，与 :8791 同判例）。
 *   - 公司目录：packages/company loadCompanyDirectory（校验不过由装配层拒启）；
 *     mission 单行提取与 cli/overview.ts extractMission 同口径（契约 CompanySnapshot 尚无
 *     mission 字段——拟稿注记，§三）。
 *   - 报表：node:fs stat 扫描＋查看端白名单（§三.安全——路径越界 400）。
 */
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync, type Stats } from 'node:fs'
import path from 'node:path'
import type { CompanySnapshot, EventRecord, IssueRecord, TicketId } from '@studio-next/contract'
import { getIssue, listIssues, parseIssueEvents, type IssueEvent } from '@studio-next/localplatform'
import type { Ledger } from '@studio-next/store'
import { createSessionArchive, type DecompressFn, type SessionArchive } from './sessions.ts'

/** 单据事件时间线项（渲染面 view model） */
export interface TicketEventView {
  readonly kind: 'created' | 'transitioned' | 'field-set'
  readonly ts: string
  readonly from: string | undefined
  readonly to: string | undefined
  readonly field: string | undefined
  readonly value: string | undefined
}

export interface TicketDetailView {
  readonly record: IssueRecord
  readonly created: string
  readonly events: readonly TicketEventView[]
  readonly description: string
  readonly acceptance: string | null
}

export interface TicketListResult {
  readonly available: boolean
  readonly total: number
  readonly items: readonly IssueRecord[]
  readonly states: readonly { readonly state: string; readonly count: number }[]
}

export interface ChatStatsView {
  readonly available: boolean
  readonly rooms: number
  readonly messages: number
}

export interface PortalStats {
  readonly tickets: { readonly available: boolean; readonly total: number; readonly active: number; readonly delivered: number }
  readonly ledger: { readonly todayEvents: number; readonly todayCostUsd: number | null }
  readonly chat: ChatStatsView
  readonly org: { readonly departments: number; readonly people: number }
  readonly daemonOnline: boolean
}

export interface ReportFileView {
  readonly relPath: string
  readonly name: string
  readonly sizeBytes: number
  readonly mtimeMs: number
}

export type ReportViewResult =
  | { readonly ok: true; readonly file: ReportFileView; readonly text: string; readonly truncated: boolean }
  | { readonly ok: false; readonly status: 400 | 404; readonly code: string; readonly message: string }

export type TicketDetailResult =
  | { readonly ok: true; readonly view: TicketDetailView }
  | { readonly ok: false; readonly status: 400 | 404 | 500; readonly code: string; readonly message: string }

/** 装配注入（CLI 层已做拒启闸：公司目录校验、db 存在） */
export interface PortalDataOptions {
  readonly company: CompanySnapshot
  readonly companyDir: string
  readonly mission: string
  readonly platformRoot: string | null
  readonly ledger: Ledger
  /** 聊天统计（best-effort：装配层注入 transport 查询；失败/超时→available:false） */
  readonly chatStats: () => Promise<ChatStatsView>
  /** 会话轨迹解压面（缺省 zstd CLI；测试注入 fake——§九.1） */
  readonly sessionDecompress?: DecompressFn
}

/** 单子列表 TTL（全树派生秒级；人看页面可接受——§三） */
const TICKET_TTL_MS = 5_000
/** daemon 在线：最近 HEARTBEAT 龄上限（engine/jobs/freshness 同族口径） */
const HEARTBEAT_FRESH_MS = 10 * 60_000
/** 报表占位件（cli/overview.ts scanReportFiles 同口径） */
const REPORT_PLACEHOLDER_FILES = new Set(['.gitkeep', '.DS_Store'])
/** 报表查看允许的后缀（§1.2——仅 .md/.txt/.json 渲染为文本） */
const REPORT_ALLOWED_EXTS = new Set(['.md', '.txt', '.json'])
/** 报表查看大小上限（超出截断提示，不整页拒） */
const REPORT_MAX_BYTES = 1024 * 1024

const isDelivered = (state: string): boolean => state.includes('交付')
const isArchived = (state: string): boolean => /archived/i.test(state)

/** 装配层用：mission 单行提取（cli/overview.ts extractMission 同口径——§三） */
export function extractMission(orgConfigSrc: string | undefined): string {
  if (orgConfigSrc === undefined) return ''
  const m = /^[ \t]*mission:[ \t]*(\S.*)$/m.exec(orgConfigSrc)
  const raw = m?.[1]?.trim()
  if (raw === undefined || raw === '') return ''
  let value = raw
  if ((value.startsWith('"') && value.endsWith('"') && value.length >= 2) || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)) {
    value = value.slice(1, -1)
  } else {
    const hash = value.indexOf(' #')
    if (hash >= 0) value = value.slice(0, hash)
  }
  return value.trim()
}

export function createPortalData(opts: PortalDataOptions) {
  // —— 单子面（TTL 缓存；平台根缺失=空列表 available=false） ——
  let ticketCache: { at: number; list: IssueRecord[] } | null = null
  const allTickets = (): IssueRecord[] => {
    if (opts.platformRoot === null) return []
    if (ticketCache !== null && Date.now() - ticketCache.at < TICKET_TTL_MS) return ticketCache.list
    try {
      const list = listIssues(opts.platformRoot, {})
      ticketCache = { at: Date.now(), list }
      return list
    } catch {
      // 平台根损坏（如坏 id-floor）：不缓存失败，本面降级空列表（API available:false 不冒充）
      return []
    }
  }
  const byUpdatedDesc = (list: readonly IssueRecord[]): IssueRecord[] => [...list].sort((a, b) => b.updated.localeCompare(a.updated))

  const stateCounts = (): { state: string; count: number }[] => {
    const counts = new Map<string, number>()
    for (const t of allTickets()) counts.set(t.state, (counts.get(t.state) ?? 0) + 1)
    return [...counts.entries()].map(([state, count]) => ({ state, count })).sort((a, b) => b.count - a.count || a.state.localeCompare(b.state))
  }

  const ticketList = (q: { state?: string | undefined; search?: string | undefined }): TicketListResult => {
    const all = allTickets()
    let filtered = all
    if (q.state !== undefined) filtered = filtered.filter((t) => t.state === q.state)
    if (q.search !== undefined && q.search !== '') {
      const needle = q.search.toLowerCase()
      filtered = filtered.filter(
        (t) => t.id.toLowerCase().includes(needle) || t.title.toLowerCase().includes(needle) || (t.assignee ?? '').toLowerCase().includes(needle),
      )
    }
    return { available: opts.platformRoot !== null, total: filtered.length, items: byUpdatedDesc(filtered), states: stateCounts() }
  }

  const ticketDetail = (id: string): TicketDetailResult => {
    if (opts.platformRoot === null) {
      return { ok: false, status: 404, code: 'platform-not-mounted', message: '未接单子平台（--platform-root）——门户只读不代建' }
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
      return { ok: false, status: 400, code: 'bad-ticket-id', message: `单号 ${id} 不是票形 id（^[A-Za-z0-9][A-Za-z0-9._-]*$）` }
    }
    let events: IssueEvent[]
    try {
      events = parseIssueEvents(opts.platformRoot, id as TicketId)
    } catch {
      return { ok: false, status: 404, code: 'issue-not-found', message: `单据不存在：${id}` }
    }
    if (events.length === 0) {
      return { ok: false, status: 404, code: 'issue-not-found', message: `单据不存在：${id}` }
    }
    let record: IssueRecord
    try {
      record = getIssue(opts.platformRoot, id as TicketId)
    } catch (err) {
      return { ok: false, status: 500, code: 'corrupt-issue-log', message: err instanceof Error ? err.message : String(err) }
    }
    return { ok: true, view: detailOf(record, events) }
  }

  /** description 内「## 验收口径」段拆出（engine/split 子单装配同锚——§1.2） */
  const detailOf = (record: IssueRecord, events: readonly IssueEvent[]): TicketDetailView => {
    const desc = record.description ?? ''
    const m = /^##[^\n]*验收[^\n]*$/m.exec(desc)
    const idx = m?.index
    const acceptance = m !== null && idx !== undefined ? desc.slice(idx + m[0].length).trim() : null
    const description = acceptance !== null && idx !== undefined ? desc.slice(0, idx).trim() : desc
    const views: TicketEventView[] = []
    let prevState: string | undefined
    for (const ev of events) {
      if (ev.type === 'created') {
        views.push({ kind: 'created', ts: ev.ts, from: undefined, to: ev.state, field: undefined, value: undefined })
        prevState = ev.state
      } else if (ev.type === 'transitioned') {
        views.push({ kind: 'transitioned', ts: ev.ts, from: prevState, to: ev.to, field: undefined, value: undefined })
        prevState = ev.to
      } else {
        views.push({ kind: 'field-set', ts: ev.ts, from: undefined, to: undefined, field: ev.field, value: textValue(ev.value) })
      }
    }
    return { record, created: events[0]?.ts ?? record.updated, events: views, description, acceptance }
  }

  // —— 台账面（只读查询） ——
  const startOfUtcDay = (): number => {
    const d = new Date()
    d.setUTCHours(0, 0, 0, 0)
    return d.getTime()
  }

  const todayLedger = (): EventRecord[] => opts.ledger.queryEvents({ since: startOfUtcDay() })

  const daemonOnline = (): boolean => opts.ledger.queryEvents({ since: Date.now() - HEARTBEAT_FRESH_MS }).some((e) => e.event === 'HEARTBEAT')

  const stats = async (): Promise<PortalStats> => {
    const all = allTickets()
    const today = todayLedger()
    const costEvents = today.filter((e) => e.cost_usd !== undefined)
    const chat = await opts.chatStats()
    return {
      tickets: {
        available: opts.platformRoot !== null,
        total: all.length,
        active: all.filter((t) => !isDelivered(t.state) && !isArchived(t.state)).length,
        delivered: all.filter((t) => isDelivered(t.state)).length,
      },
      ledger: { todayEvents: today.length, todayCostUsd: costEvents.length > 0 ? costEvents.reduce((s, e) => s + (e.cost_usd ?? 0), 0) : null },
      chat,
      org: { departments: opts.company.departments.length, people: opts.company.people.length },
      daemonOnline: daemonOnline(),
    }
  }

  const activity = (limit: number): EventRecord[] => opts.ledger.queryEvents({ order: 'desc', limit })

  const recentTickets = (n: number): IssueRecord[] => byUpdatedDesc(allTickets()).slice(0, n)

  // —— 组织面（快照派生 view model） ——
  const deptNameByPath = new Map(opts.company.departments.map((d) => [d.path, d.name]))
  const deptDepth = (d: { parent: string | null }): number => {
    let depth = 0
    let cur = d.parent
    while (cur !== null) {
      depth += 1
      const parent = opts.company.departments.find((x) => x.path === cur)
      cur = parent?.parent ?? null
      if (depth > 16) break // 环保险（装载校验已闸，双保险不悬挂）
    }
    return depth
  }
  const org = () => ({
    departments: opts.company.departments.map((d) => ({ ...d, depth: deptDepth(d), leaderName: opts.company.people.find((p) => p.id === d.leader)?.name ?? d.leader })),
    people: [...opts.company.people]
      .map((p) => ({ ...p, deptName: deptNameByPath.get(p.dept) ?? p.dept }))
      .sort((a, b) => a.deptName.localeCompare(b.deptName, 'zh-Hans-CN') || a.id.localeCompare(b.id)),
  })

  // —— 报表面（只读扫描＋查看白名单） ——
  const reportsRoot = path.resolve(opts.companyDir, 'reports')

  const reports = (): ReportFileView[] => {
    if (!existsSync(reportsRoot)) return []
    const out: ReportFileView[] = []
    const walk = (dir: string, prefix: string): void => {
      let entries
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        return // 目录级不可读：该子树退缺（cli/overview.ts scanReportFiles 同口径）
      }
      for (const entry of entries) {
        if (REPORT_PLACEHOLDER_FILES.has(entry.name)) continue
        const abs = path.join(dir, entry.name)
        const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
        if (entry.isDirectory()) {
          walk(abs, rel)
          continue
        }
        if (!entry.isFile()) continue
        try {
          const st = statSync(abs)
          out.push({ relPath: `reports/${rel}`, name: entry.name, sizeBytes: st.size, mtimeMs: st.mtimeMs })
        } catch {
          // 单件 stat 失败跳过（辅助列尽力而为，同上口径）
        }
      }
    }
    walk(reportsRoot, '')
    return out.sort((a, b) => a.relPath.localeCompare(b.relPath))
  }

  const reportView = (rawPath: string): ReportViewResult => {
    if (typeof rawPath !== 'string' || !rawPath.startsWith('reports/')) {
      return { ok: false, status: 400, code: 'path-out-of-reports', message: '路径必须位于 reports/ 内（门户只渲染公司报表目录）' }
    }
    const rest = rawPath.slice('reports/'.length)
    if (rest === '') {
      return { ok: false, status: 400, code: 'path-out-of-reports', message: '路径必须指向具体文件' }
    }
    const segments = rest.split('/')
    for (const seg of segments) {
      if (seg === '' || seg === '.' || seg === '..' || seg.includes('\\') || seg.includes('\0')) {
        return { ok: false, status: 400, code: 'path-out-of-reports', message: '路径含非法段（不允许相对段/反斜杠/空段）' }
      }
    }
    if (!REPORT_ALLOWED_EXTS.has(path.extname(rest).toLowerCase())) {
      return { ok: false, status: 400, code: 'path-bad-ext', message: '仅支持渲染 .md / .txt / .json 文件' }
    }
    const abs = path.resolve(reportsRoot, ...segments)
    if (abs !== reportsRoot && !abs.startsWith(`${reportsRoot}${path.sep}`)) {
      return { ok: false, status: 400, code: 'path-out-of-reports', message: '路径越出报表目录（已拒绝）' }
    }
    let st: Stats
    try {
      st = statSync(abs)
    } catch {
      return { ok: false, status: 404, code: 'report-not-found', message: '报表文件不存在' }
    }
    if (!st.isFile()) {
      return { ok: false, status: 404, code: 'report-not-found', message: '路径不是普通文件' }
    }
    const truncated = st.size > REPORT_MAX_BYTES
    const toRead = truncated ? REPORT_MAX_BYTES : st.size
    // 定长读（不整读超大件；截断只影响展示，文件本身零改动）
    const buf = Buffer.alloc(toRead)
    const fd = openSync(abs, 'r')
    try {
      readSync(fd, buf, 0, toRead, 0)
    } finally {
      closeSync(fd)
    }
    return {
      ok: true,
      file: { relPath: rawPath, name: segments[segments.length - 1] ?? rest, sizeBytes: st.size, mtimeMs: st.mtimeMs },
      text: buf.toString('utf8'),
      truncated,
    }
  }

  // —— 会话档案面（只读；工位树 = <companyDir>/../.AIWS——§九.1；解压面可注入） ——
  const sessions: SessionArchive = createSessionArchive({
    aiwsRoot: path.resolve(opts.companyDir, '..', '.AIWS'),
    ...(opts.sessionDecompress !== undefined ? { decompress: opts.sessionDecompress } : {}),
  })

  return {
    company: () => opts.company,
    mission: () => opts.mission,
    companyDir: () => opts.companyDir,
    platformRoot: () => opts.platformRoot,
    ticketList,
    ticketDetail,
    recentTickets,
    stats,
    activity,
    daemonOnline,
    org,
    reports,
    reportView,
    sessions: () => sessions,
  }
}

export type PortalData = ReturnType<typeof createPortalData>

function textValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return 'undefined'
  try {
    return JSON.stringify(value) ?? 'null'
  } catch {
    return String(value)
  }
}
