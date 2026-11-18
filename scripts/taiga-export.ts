#!/usr/bin/env node
/**
 * taiga-export —— Taiga 项目 userstories 全量只读导出（task-134）
 *
 * 只读纪律：
 *   - 数据面**只 GET**（列表/详情/评论/历史/父子关系/字典全 GET）；
 *     唯一的非 GET 是登录换 JWT（POST /api/v1/auth，Taiga 无 Basic 认证，JWT 必经）——
 *     该调用不产生/不改写任何业务数据，等价只读。
 *   - 凭据只从 env TAIGA_USERNAME / TAIGA_PASSWORD 读（外部 source 凭据文件后注入）；
 *     本脚本**不读任何文件凭据、不打印用户名/密码/token**（错误信息也不含）。
 *   - 不写 Taiga、不 commit、不部署；产物=本地快照 JSON（缺省 /tmp，可 --out-dir）。
 *
 * 请求约定（docs/32 真机口径，9000 端口实测）：
 *   - 分页 ?page=&page_size=（缺省 100）+ 响应头 x-pagination-count（总数）/
 *     x-paginated-by（服务端页大小）/x-pagination-current；以 count 头为权威，
 *     取满即止；短页且无头才按「短页即止」收敛。
 *   - 列表序列化器**不回显 description**（实测），每单须 GET /userstories/{id} 详情；
 *     自定义属性值不随实体回显，须 GET /userstories/custom-attributes-values/{id}。
 *   - 评论=history 条目（comment 非空且非 is_hidden/is_snapshot）：
 *     GET /history/userstory/{id}（服务端分页，新→旧）。
 *   - 父子面：US↔US 无父子模型、epic 挂接 API 不可写（links.ts 真机定版）——导出侧
 *     只如实记录 US 的 epics 字段（若回显）+ US→task 派生链（GET /tasks?project= 客户端
 *     归并）；parent 字段保留位（本实例恒 null，不伪造）。
 *
 * 韧性：429/5xx/网络错/超时指数退避重试 ≤3 次（500ms→1s→2s，429 优先尊重 Retry-After，
 *   上限 15s）；单请求 30s 超时（AbortSignal.timeout）；401 静默重登一次。
 *
 * 用法：
 *   node scripts/taiga-export.ts [--taiga-url <url>] [--project <slug>] \
 *     [--out-dir <dir>] [--page-size 100] [--concurrency 6]
 *   env：TAIGA_USERNAME / TAIGA_PASSWORD（必填，不打印）
 *
 * 退出码：0=成功且校验通过；1=导出完成但计数校验失败（快照仍落盘，manifest.verified=false）；
 *   2=用法/凭据/配置错误；3=导出中途失败（不落盘半截快照）。
 */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import process from 'node:process'

// ---------- 常量 ----------
const DEFAULT_TAIGA_URL = 'http://127.0.0.1:9000'
const DEFAULT_PROJECT = 'studio-dev'
const DEFAULT_OUT_DIR = '/tmp'
const DEFAULT_PAGE_SIZE = 100
const DEFAULT_CONCURRENCY = 6
const REQUEST_TIMEOUT_MS = 30_000
const MAX_RETRIES = 3
const BASE_BACKOFF_MS = 500
const MAX_BACKOFF_MS = 15_000
const MAX_PAGES = 2000 // 防御上限：count 头异常时不空转
const PROGRESS_EVERY = 50

const EXIT = { ok: 0, verifyFail: 1, usage: 2, runtime: 3 } as const

// ---------- 小工具 ----------
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 本地时间戳 YYYYMMDD-HHMM（文件名用） */
function timestampLocal(d = new Date()): string {
  return `${String(d.getFullYear())}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`
}

// JSON 防御取值（Taiga 形状以实测为准，不做全量 schema）
function asObj(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}
function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function asStr(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}
function asNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function asBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}
function normName(s: string): string {
  return s.trim().toLowerCase().replace(/[\s_-]/g, '')
}

class ExportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExportError'
  }
}

// ---------- HTTP（零依赖：全局 fetch） ----------
interface FetchResult {
  json: unknown
  header(name: string): string | null
}

interface HttpStats {
  get: number
  post: number
  retries: number
  relogins: number
}

class Http {
  private readonly baseUrl: string
  private readonly username: string
  private readonly password: string
  private readonly pageSize: number
  private token: string | null = null
  readonly stats: HttpStats = { get: 0, post: 0, retries: 0, relogins: 0 }

  constructor(baseUrl: string, username: string, password: string, pageSize: number) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.username = username
    this.password = password
    this.pageSize = pageSize
  }

  url(pathname: string, query: Record<string, string>): string {
    const qs = Object.entries(query)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&')
    return `${this.baseUrl}/api/v1${pathname}${qs === '' ? '' : `?${qs}`}`
  }

  /** 指数退避（429 尊重 Retry-At/Retry-After 秒数，封顶 15s） */
  private async backoffDelay(attempt: number, res: Response | null): Promise<number> {
    if (res !== null) {
      for (const h of ['retry-after', 'retry-at']) {
        const raw = res.headers.get(h)
        if (raw !== null && /^\d+(\.\d+)?$/.test(raw.trim())) {
          return Math.min(MAX_BACKOFF_MS, Math.max(0, Number(raw) * 1000))
        }
      }
    }
    return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt)
  }

  /** 登录换 JWT（POST /auth；唯一非 GET——无业务写入）。失败信息不含凭据。 */
  private async login(): Promise<void> {
    const url = this.url('/auth', {})
    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'normal', username: this.username, password: this.password }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        this.stats.post++
      } catch (err) {
        if (attempt >= MAX_RETRIES) throw new ExportError(`login failed (network): ${errText(err)}`)
        this.stats.retries++
        await sleep(await this.backoffDelay(attempt, null))
        continue
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= MAX_RETRIES) throw new ExportError(`login failed: HTTP ${String(res.status)}（重试 ${String(MAX_RETRIES)} 次后仍失败）`)
        this.stats.retries++
        await sleep(await this.backoffDelay(attempt, res))
        continue
      }
      if (!res.ok) throw new ExportError(`login failed: HTTP ${String(res.status)}（凭据不回显；检查 TAIGA_USERNAME/TAIGA_PASSWORD）`)
      const body = asObj(await res.json().catch(() => null))
      const token = asStr(body['auth_token'])
      if (token === null || token === '') throw new ExportError('login failed: the response is missing auth_token')
      this.token = token
      return
    }
  }

  /** 数据面 GET：429/5xx/网络错/超时退避重试 ≤3；401 重登一次；只打印路径与状态，不打印头/体 */
  async get(pathname: string, query: Record<string, string>): Promise<FetchResult> {
    let relogined = false
    for (let attempt = 0; ; attempt++) {
      if (this.token === null) await this.login()
      const url = this.url(pathname, query)
      let res: Response
      try {
        res = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: `Bearer ${this.token ?? ''}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        this.stats.get++
      } catch (err) {
        if (attempt >= MAX_RETRIES) throw new ExportError(`GET ${pathname} network failure (retried ${String(attempt)} times): ${errText(err)}`)
        this.stats.retries++
        await sleep(await this.backoffDelay(attempt, null))
        continue
      }
      if (res.status === 401) {
        if (relogined) throw new ExportError(`GET ${pathname} still 401 after re-login (credentials or permissions rejected; credentials not echoed)`)
        relogined = true
        this.stats.relogins++
        this.token = null
        await this.login()
        continue
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= MAX_RETRIES) throw new ExportError(`GET ${pathname} still ${String(res.status)} after ${String(MAX_RETRIES)} retries`)
        this.stats.retries++
        await sleep(await this.backoffDelay(attempt, res))
        continue
      }
      if (!res.ok) {
        const detail = await res
          .json()
          .then((v) => asStr(asObj(v)['_error_message']) ?? asStr(asObj(v)['detail']))
          .catch(() => null)
        throw new ExportError(`GET ${pathname} HTTP ${String(res.status)}${detail === null ? '' : `：${detail}`}`)
      }
      let json: unknown
      try {
        json = await res.json()
      } catch (err) {
        throw new ExportError(`GET ${pathname} response is not valid JSON: ${errText(err)}`)
      }
      const captured = res
      return { json, header: (name: string) => captured.headers.get(name) }
    }
  }

  /**
   * 分页取尽：page 从 1 起；x-pagination-count 为权威（取满即止）；count 头缺失时
   * 按「短页即止」收敛；空页兜底防死循环。返回逐页统计供校验。
   */
  async paginate(
    pathname: string,
    baseQuery: Record<string, string>,
  ): Promise<{ items: unknown[]; pages: PageStat[]; totalHeader: number | null; serverPageSize: number | null }> {
    const items: unknown[] = []
    const pages: PageStat[] = []
    let totalHeader: number | null = null
    let serverPageSize: number | null = null
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { json, header } = await this.get(pathname, { ...baseQuery, page: String(page), page_size: String(this.pageSize) })
      const batch = asArr(json)
      items.push(...batch)
      const countRaw = header('x-pagination-count')
      const count = countRaw !== null && /^\d+$/.test(countRaw.trim()) ? Number(countRaw.trim()) : null
      if (count !== null) {
        if (totalHeader === null) totalHeader = count
        else if (count !== totalHeader) throw new ExportError(`GET ${pathname} x-pagination-count drifts across pages (page ${String(page)}: ${String(count)} ≠ ${String(totalHeader)}——rerun the export to get a consistent snapshot)`)
      }
      if (serverPageSize === null) {
        const by = header('x-paginated-by')
        serverPageSize = by !== null && /^\d+$/.test(by.trim()) ? Number(by.trim()) : null
      }
      pages.push({ page, items: batch.length, countHeader: count, serverPageSize })
      if (totalHeader !== null && items.length >= totalHeader) break
      if (batch.length === 0) break
      if (totalHeader === null && batch.length < this.pageSize) break
    }
    return { items, pages, totalHeader, serverPageSize }
  }
}

interface PageStat {
  page: number
  items: number
  countHeader: number | null
  serverPageSize: number | null
}

// ---------- 导出记录形状 ----------
interface PersonRecord {
  id: number
  username: string | null
  fullName: string | null
}

interface CommentRecord {
  id: string
  author: string
  createdAt: string
  body: string
}

interface HistoryRecord {
  id: string
  user: string
  createdAt: string
  type: number | null
  key: string | null
  comment: string
  isHidden: boolean
  isSnapshot: boolean
  valuesDiff: unknown
}

interface EpicLink {
  id: number
  ref: number
  idDisplay: string
  subject: string
}

interface ChildTaskLink {
  ref: number
  idDisplay: string
  subject: string
  status: string | null
}

interface StoryRecord {
  id: number
  ref: number
  idDisplay: string
  subject: string
  status: { id: number; name: string; isClosed: boolean } | null
  type: string | null
  severity: string | null
  priority: string | null
  assignee: PersonRecord | null
  owner: PersonRecord | null
  created: string | null
  modified: string | null
  description: string | null
  version: number | null
  tags: string[]
  isBlocked: boolean | null
  customAttributes: Record<string, string>
  comments: CommentRecord[]
  history: HistoryRecord[]
  parent: { ref: number; idDisplay: string; subject: string } | null
  epics: EpicLink[]
  childTasks: ChildTaskLink[]
}

// ---------- CLI ----------
interface Args {
  baseUrl: string
  slug: string
  outDir: string
  pageSize: number
  concurrency: number
}

function usage(): string {
  return [
    '用法：node scripts/taiga-export.ts [--taiga-url <url>] [--project <slug>] [--out-dir <dir>] [--page-size <n>] [--concurrency <n>]',
    'env：TAIGA_USERNAME / TAIGA_PASSWORD（必填；只从 env 读，不打印）',
    `缺省：--taiga-url ${DEFAULT_TAIGA_URL}（或 env TAIGA_URL）｜--project ${DEFAULT_PROJECT}（或 env TAIGA_PROJECT）｜--out-dir ${DEFAULT_OUT_DIR}`,
  ].join('\n')
}

function parseArgs(argv: string[]): Args {
  const opts = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t === '--help' || t === '-h') throw new ExportError(usage())
    if (!t.startsWith('--')) throw new ExportError(`未知参数：${t}\n${usage()}`)
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) throw new ExportError(`参数缺值：${t}\n${usage()}`)
    opts.set(t.slice(2), v)
    i++
  }
  const numOpt = (name: string, dflt: number): number => {
    const raw = opts.get(name)
    if (raw === undefined) return dflt
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 1 || n > 1000) throw new ExportError(`--${name} 须为 1..1000 整数（实得 ${raw}）`)
    return n
  }
  return {
    baseUrl: opts.get('taiga-url') ?? process.env['TAIGA_URL'] ?? DEFAULT_TAIGA_URL,
    slug: opts.get('project') ?? process.env['TAIGA_PROJECT'] ?? DEFAULT_PROJECT,
    outDir: opts.get('out-dir') ?? DEFAULT_OUT_DIR,
    pageSize: numOpt('page-size', DEFAULT_PAGE_SIZE),
    concurrency: numOpt('concurrency', DEFAULT_CONCURRENCY),
  }
}

// ---------- 并发池 ----------
async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) break
      const r = await fn(items[i] as T, i)
      out[i] = r
    }
  })
  await Promise.all(workers)
  return out
}

// ---------- 主流程 ----------
async function main(): Promise<number> {
  const startedAt = new Date()
  const args = parseArgs(process.argv.slice(2))
  const username = process.env['TAIGA_USERNAME'] ?? ''
  const password = process.env['TAIGA_PASSWORD'] ?? ''
  if (username === '' || password === '') {
    process.stderr.write('taiga-export：缺 env TAIGA_USERNAME / TAIGA_PASSWORD（由外部 source 凭据文件注入；本脚本不读文件、不打印）\n')
    return EXIT.usage
  }
  const http = new Http(args.baseUrl, username, password, args.pageSize)
  process.stderr.write(`[taiga-export] target=${args.baseUrl}/api/v1 project=${args.slug} pageSize=${String(args.pageSize)} concurrency=${String(args.concurrency)}（只读；凭据不回显）\n`)

  // ① 项目
  const projRes = await http.get('/projects/by_slug', { slug: args.slug })
  const proj = asObj(projRes.json)
  const projectId = asNum(proj['id'])
  const projectName = asStr(proj['name']) ?? args.slug
  if (projectId === null) throw new ExportError(`项目 ${args.slug} 响应缺 id（by_slug）`)
  process.stderr.write(`[taiga-export] project: name=${JSON.stringify(projectName)} slug=${args.slug} id=${String(projectId)}\n`)

  // ② 字典（全 GET，一次拉全）
  const [statusPages, attrDefPages, memberPages, epicPages, taskPages, taskStatusPages] = await Promise.all([
    http.paginate('/userstory-statuses', { project: String(projectId) }),
    http.paginate('/userstory-custom-attributes', { project: String(projectId) }),
    http.paginate('/memberships', { project: String(projectId) }),
    http.paginate('/epics', { project: String(projectId) }),
    http.paginate('/tasks', { project: String(projectId) }),
    http.paginate('/task-statuses', { project: String(projectId) }),
  ])
  const statusById = new Map<number, { name: string; isClosed: boolean }>()
  for (const raw of statusPages.items) {
    const o = asObj(raw)
    const id = asNum(o['id'])
    if (id !== null) statusById.set(id, { name: asStr(o['name']) ?? `status-${String(id)}`, isClosed: asBool(o['is_closed']) ?? false })
  }
  const taskStatusById = new Map<number, string>()
  for (const raw of taskStatusPages.items) {
    const o = asObj(raw)
    const id = asNum(o['id'])
    if (id !== null) taskStatusById.set(id, asStr(o['name']) ?? `status-${String(id)}`)
  }
  // 自定义属性：id→name；type/severity/priority 优先按属性名匹配（本仓 type/dept/level/lane 为自定义维）
  const attrNameById = new Map<number, string>()
  for (const raw of attrDefPages.items) {
    const o = asObj(raw)
    const id = asNum(o['id'])
    const name = asStr(o['name'])
    if (id !== null && name !== null) attrNameById.set(id, name)
  }
  const matchAttr = (candidates: readonly string[]): string | null => {
    const wanted = candidates.map(normName)
    for (const [id, name] of attrNameById) if (wanted.includes(normName(name))) return String(id)
    return null
  }
  const attrIdType = matchAttr(['type', '类型'])
  const attrIdSeverity = matchAttr(['severity', '严重性', '严重度'])
  const attrIdPriority = matchAttr(['priority', '优先级', '优先'])
  const attrValue = (values: Record<string, string>, attrId: string | null): string | null => {
    if (attrId === null) return null
    const v = values[attrId]
    return typeof v === 'string' && v !== '' ? v : null
  }
  // 成员：userId→{username, fullName}
  const memberById = new Map<number, PersonRecord>()
  for (const raw of memberPages.items) {
    const o = asObj(raw)
    const uid = asNum(o['user']) ?? asNum(asObj(o['user_extra_info'])['pk'])
    if (uid === null) continue
    const extra = asObj(o['user_extra_info'])
    memberById.set(uid, {
      id: uid,
      username: asStr(o['username']) ?? asStr(extra['username']) ?? null,
      fullName: asStr(o['full_name']) ?? asStr(o['user_full_name']) ?? asStr(extra['full_name_display']) ?? null,
    })
  }
  const personOf = (uid: number | null, extraRaw: unknown): PersonRecord | null => {
    if (uid === null) return null
    const hit = memberById.get(uid)
    if (hit !== undefined) return hit
    const extra = asObj(extraRaw)
    return { id: uid, username: asStr(extra['username']) ?? null, fullName: asStr(extra['full_name_display']) ?? null }
  }
  // epic：id→{ref, subject}
  const epicById = new Map<number, { ref: number; subject: string }>()
  for (const raw of epicPages.items) {
    const o = asObj(raw)
    const id = asNum(o['id'])
    const ref = asNum(o['ref'])
    if (id !== null && ref !== null) epicById.set(id, { ref, subject: asStr(o['subject']) ?? '' })
  }
  // US→task 派生链（父子对来源之一）：user_story 内部 id → 子 task（ref 升序）
  const tasksByStory = new Map<number, { ref: number; subject: string; status: number | null }[]>()
  for (const raw of taskPages.items) {
    const o = asObj(raw)
    const usId = asNum(o['user_story'])
    const ref = asNum(o['ref'])
    if (usId === null || ref === null) continue
    const list = tasksByStory.get(usId) ?? []
    list.push({ ref, subject: asStr(o['subject']) ?? '', status: asNum(o['status']) })
    tasksByStory.set(usId, list)
  }
  process.stderr.write(
    `[taiga-export] lookups: usStatuses=${String(statusById.size)} customAttrs=${String(attrNameById.size)} members=${String(memberById.size)} epics=${String(epicById.size)} tasks=${String([...tasksByStory.values()].reduce((a, b) => a + b.length, 0))} taskStatuses=${String(taskStatusById.size)}\n`,
  )

  // ③ userstories 分页取尽
  const storyPages = await http.paginate('/userstories', { project: String(projectId) })
  const totalHeader = storyPages.totalHeader
  const listCount = storyPages.items.length
  process.stderr.write(`[taiga-export] userstories: totalHeader=${totalHeader === null ? '缺失' : String(totalHeader)} pages=${String(storyPages.pages.length)} listItems=${String(listCount)}\n`)
  if (listCount === 0) process.stderr.write('[taiga-export] 注意：列表为空（确认 slug 与权限）——仍产出空快照\n')

  // ④ 每单：详情（列表不回显 description）+ 自定义属性值 + history（评论=其中 comment 条目）
  let done = 0
  const stories = await mapPool(storyPages.items, args.concurrency, async (listRaw): Promise<StoryRecord> => {
    const listObj = asObj(listRaw)
    const id = asNum(listObj['id'])
    if (id === null) throw new ExportError(`userstory list item is missing id: ${JSON.stringify(listRaw).slice(0, 120)}`)
    const detailRes = await http.get(`/userstories/${String(id)}`, {})
    const d = asObj(detailRes.json)
    // 自定义属性值（实体序列化器不回显——docs/32 实测）
    const attrValues: Record<string, string> = {}
    const attrRes = await http.get(`/userstories/custom-attributes-values/${String(id)}`, {})
    const av = asObj(asObj(attrRes.json)['attributes_values'])
    for (const [k, v] of Object.entries(av)) {
      if (v !== null && v !== undefined) attrValues[k] = String(v)
    }
    const namedAttrs: Record<string, string> = {}
    for (const [k, v] of Object.entries(attrValues)) {
      const name = attrNameById.get(Number(k)) ?? `attr-${k}`
      namedAttrs[name] = v
    }
    // history（服务端新→旧、分页）
    const hist = await http.paginate(`/history/userstory/${String(id)}`, {})
    const history: HistoryRecord[] = hist.items.map((raw): HistoryRecord => {
      const o = asObj(raw)
      const user = asObj(o['user'])
      return {
        id: asStr(o['id']) ?? '<no-id>',
        user: asStr(user['username']) ?? asStr(user['name']) ?? asStr(o['user_string']) ?? '<unknown>',
        createdAt: asStr(o['created_at']) ?? '',
        type: asNum(o['type']),
        key: asStr(o['key']),
        comment: asStr(o['comment']) ?? '',
        isHidden: asBool(o['is_hidden']) ?? false,
        isSnapshot: asBool(o['is_snapshot']) ?? false,
        valuesDiff: o['values_diff'] ?? o['diff'] ?? null,
      }
    })
    const comments: CommentRecord[] = history
      .filter((h) => h.comment !== '' && !h.isHidden && !h.isSnapshot)
      .map((h) => ({ id: h.id, author: h.user, createdAt: h.createdAt, body: h.comment }))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)) // 评论升序稳定输出
    const ref = asNum(d['ref']) ?? asNum(listObj['ref'])
    if (ref === null) throw new ExportError(`userstory ${String(id)} missing ref`)
    const statusId = asNum(d['status'])
    const statusHit = statusId !== null ? statusById.get(statusId) : undefined
    const epicLinks: EpicLink[] = asArr(d['epics'])
      .map((e) => asNum(e))
      .filter((e): e is number => e !== null)
      .map((eid) => {
        const hit = epicById.get(eid)
        const eref = hit?.ref ?? -1
        return { id: eid, ref: eref, idDisplay: eref >= 0 ? `${args.slug}-${String(eref)}` : `${args.slug}-epic-${String(eid)}`, subject: hit?.subject ?? '' }
      })
    const childTasks: ChildTaskLink[] = [...(tasksByStory.get(id) ?? [])]
      .sort((a, b) => a.ref - b.ref)
      .map((t) => ({ ref: t.ref, idDisplay: `${args.slug}-${String(t.ref)}`, subject: t.subject, status: t.status !== null ? taskStatusById.get(t.status) ?? null : null }))
    done++
    if (done % PROGRESS_EVERY === 0 || done === listCount) process.stderr.write(`[taiga-export] stories ${String(done)}/${String(listCount)}\n`)
    return {
      id,
      ref,
      idDisplay: `${args.slug}-${String(ref)}`,
      subject: asStr(d['subject']) ?? asStr(listObj['subject']) ?? '',
      status: statusId !== null ? { id: statusId, name: statusHit?.name ?? `status-${String(statusId)}`, isClosed: statusHit?.isClosed ?? asBool(d['is_closed']) ?? false } : null,
      type: attrValue(attrValues, attrIdType),
      severity: attrValue(attrValues, attrIdSeverity),
      priority: attrValue(attrValues, attrIdPriority),
      assignee: personOf(asNum(d['assigned_to']), d['assigned_to_extra_info']),
      owner: personOf(asNum(d['owner']), d['owner_extra_info']),
      created: asStr(d['created_date']),
      modified: asStr(d['modified_date']),
      description: asStr(d['description']),
      version: asNum(d['version']),
      tags: asArr(d['tags']).filter((t): t is string => typeof t === 'string'),
      isBlocked: asBool(d['is_blocked']),
      customAttributes: namedAttrs,
      comments,
      history,
      parent: null, // US↔US has no parent model (links.ts finalized on real machine)——keep the slot, do not fabricate
      epics: epicLinks,
      childTasks,
    }
  })

  // ⑤ 快照与 manifest（contentSha256=除 manifest 外内容的 sha256；整文件 sha256 打印到 stdout）
  const finishedAt = new Date()
  const commentTotal = stories.reduce((a, s) => a + s.comments.length, 0)
  const historyTotal = stories.reduce((a, s) => a + s.history.length, 0)
  const epicPairs = stories.reduce((a, s) => a + s.epics.length, 0)
  const childTaskPairs = stories.reduce((a, s) => a + s.childTasks.length, 0)
  const pageSum = storyPages.pages.reduce((a, p) => a + p.items, 0)
  const distinctIds = new Set(stories.map((s) => s.id)).size
  const distinctRefs = new Set(stories.map((s) => s.ref)).size

  // 计数校验（task-134 验收：分页合计=导出数=count 头；末页完整；无重复）
  const verifyNotes: string[] = []
  let verified = true
  if (totalHeader === null) {
    verified = false
    verifyNotes.push('x-pagination-count header missing——unable to cross-verify total count with server side')
  } else if (totalHeader !== stories.length) {
    verified = false
    verifyNotes.push(`导出数 ${String(stories.length)} ≠ x-pagination-count ${String(totalHeader)}`)
  }
  if (pageSum !== stories.length) {
    verified = false
    verifyNotes.push(`分页合计 ${String(pageSum)} ≠ 导出数 ${String(stories.length)}`)
  }
  if (distinctIds !== stories.length || distinctRefs !== stories.length) {
    verified = false
    verifyNotes.push(`存在重复（distinct id=${String(distinctIds)} ref=${String(distinctRefs)} vs 导出 ${String(stories.length)}）`)
  }
  const lastPage = storyPages.pages.length > 0 ? storyPages.pages[storyPages.pages.length - 1] : undefined
  if (lastPage !== undefined && totalHeader !== null && storyPages.serverPageSize !== null && storyPages.serverPageSize > 0) {
    const expectedPages = Math.ceil(totalHeader / storyPages.serverPageSize)
    const expectedLast = totalHeader - (expectedPages - 1) * storyPages.serverPageSize
    if (storyPages.pages.length !== expectedPages || lastPage.items !== expectedLast) {
      verified = false
      verifyNotes.push(`末页不完整（pages=${String(storyPages.pages.length)}/${String(expectedPages)}，末页 ${String(lastPage.items)}/${String(expectedLast)}）`)
    } else {
      verifyNotes.push(`末页完整（${String(expectedPages)} 页 × serverPageSize=${String(storyPages.serverPageSize)}，末页 ${String(expectedLast)} 条）`)
    }
  } else if (verified) {
    verifyNotes.push('serverPageSize 不可知——按 count 头+分页合计校验')
  }

  const content = {
    schema: 'taiga-export/v1',
    task: 'task-134 Taiga 全量只读导出（userstories）',
    exportedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    source: {
      api: `${args.baseUrl}/api/v1`,
      projectSlug: args.slug,
      access: 'read-only（数据面只 GET；登录换 JWT 为唯一非 GET，无业务写入；凭据来自 env，不回显）',
    },
    project: { id: projectId, name: projectName, slug: args.slug, description: asStr(proj['description']) },
    lookups: {
      userstoryStatuses: statusById.size,
      customAttributes: [...attrNameById.entries()].map(([id, name]) => ({ id, name })),
      memberships: memberById.size,
      epics: epicById.size,
      tasks: [...tasksByStory.values()].reduce((a, b) => a + b.length, 0),
      taskStatuses: taskStatusById.size,
    },
    fieldNotes: {
      idDisplay: `${args.slug}-<ref>（Taiga 无 id_display 字段，按本仓 TicketId 约定构造）`,
      type: attrIdType !== null ? `自定义属性「${attrNameById.get(Number(attrIdType)) ?? attrIdType}」的值` : '本实例无 type 属性（US 原生无 type 字段）',
      severity: attrIdSeverity !== null ? `自定义属性「${attrNameById.get(Number(attrIdSeverity)) ?? attrIdSeverity}」的值` : '本实例无 severity 属性（US 原生无 severity 字段）',
      priority: attrIdPriority !== null ? `自定义属性「${attrNameById.get(Number(attrIdPriority)) ?? attrIdPriority}」的值` : '本实例无 priority 属性（US 原生无 priority 字段）',
      parent: '恒 null——Taiga US↔US 无父子模型（links.ts 真机定版），不伪造',
      epic: 'US 详情 epics 字段（若实例回显）；epic 挂接 API 不可写，见 docs/32',
      childTasks: 'GET /tasks?project= 按 user_story 归并的派生子任务（ref/idDisplay/subject/status）',
      comments: 'history 条目中 comment 非空且非隐藏/快照（升序）',
    },
    stories,
  }
  const contentSha = createHash('sha256').update(JSON.stringify(content), 'utf8').digest('hex')
  const manifest = {
    project: { id: projectId, name: projectName, slug: args.slug },
    projectTotalStories: totalHeader, // x-pagination-count（首页即回，逐页一致性已校）
    exportedStories: stories.length,
    commentTotal,
    historyTotal,
    parentChildPairs: { epic: epicPairs, childTask: childTaskPairs, total: epicPairs + childTaskPairs },
    pagination: {
      pageSizeRequested: args.pageSize,
      serverPageSize: storyPages.serverPageSize,
      pagesFetched: storyPages.pages.length,
      pageItems: storyPages.pages.map((p) => p.items),
      totalHeader,
      pageSum,
      verified,
      verifyNotes,
    },
    requests: { ...http.stats, timeoutMs: REQUEST_TIMEOUT_MS, maxRetries: MAX_RETRIES, methods: 'GET only（/auth 登录除外）' },
    exportedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    contentSha256: contentSha, // sha256 of 「除 manifest 外全部内容」的 JSON.stringify
  }
  const snapshot = { ...content, manifest }

  // ⑥ 落盘 + 整文件 sha256（打印，不进文件——文件内是 contentSha256）
  const outPath = `${args.outDir.replace(/\/+$/, '')}/taiga-export-${args.slug}-${timestampLocal(finishedAt)}.json`
  await mkdir(args.outDir, { recursive: true })
  const fileBody = `${JSON.stringify(snapshot, null, 2)}\n`
  await writeFile(outPath, fileBody, 'utf8')
  const fileSha = createHash('sha256').update(fileBody, 'utf8').digest('hex')

  // ⑦ 摘要（stdout；不含任何凭据/token）
  const line = (s: string): void => process.stdout.write(`${s}\n`)
  line(`[taiga-export] project=${JSON.stringify(projectName)}（slug=${args.slug}, id=${String(projectId)}）`)
  line(`[taiga-export] 总数(count头)=${totalHeader === null ? '缺失' : String(totalHeader)} 导出=${String(stories.length)} 分页合计=${String(pageSum)} 评论=${String(commentTotal)} history条目=${String(historyTotal)}`)
  line(`[taiga-export] 父子对：epic=${String(epicPairs)} 子task=${String(childTaskPairs)} 合计=${String(epicPairs + childTaskPairs)}`)
  line(`[taiga-export] 分页：pages=${String(storyPages.pages.length)} 请求pageSize=${String(args.pageSize)} serverPageSize=${storyPages.serverPageSize === null ? '未知' : String(storyPages.serverPageSize)} 逐页=${JSON.stringify(manifest.pagination.pageItems)}`)
  line(`[taiga-export] 校验：${verified ? '通过 ✔' : '失败 ✘'}${verifyNotes.length > 0 ? `（${verifyNotes.join('；')}）` : ''}`)
  line(`[taiga-export] 请求：GET=${String(http.stats.get)} POST=${String(http.stats.post)}（仅登录） 重试=${String(http.stats.retries)} 重登=${String(http.stats.relogins)}`)
  line(`[taiga-export] 快照：${outPath}`)
  line(`[taiga-export] contentSha256=${contentSha}`)
  line(`[taiga-export] fileSha256=${fileSha}`)
  return verified ? EXIT.ok : EXIT.verifyFail
}

try {
  process.exitCode = await main()
} catch (err) {
  if (err instanceof ExportError && err.message.startsWith('用法')) {
    process.stderr.write(`${err.message}\n`)
    process.exitCode = EXIT.usage
  } else {
    process.stderr.write(`[taiga-export] 失败：${errText(err)}\n`)
    process.exitCode = EXIT.runtime
  }
}
