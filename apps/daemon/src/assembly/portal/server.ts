/**
 * portal/server —— 公司门户 Hono app 工厂＋真监听壳（CLI `panel --portal` 装配位）。
 *
 * 依据：docs/plan/11-公司门户-2026-11-23.md §一.1（五页同端口）／§1.3（只读 JSON API
 * 形状 {ok,…}）／§三（数据来源·降级矩阵·安全）。
 *
 * 端面（页面全 GET、门户自身零写）：
 *   页面：/ /tickets /tickets/:id /chat /org /reports?q=&limit=&page= /reports/view?path=
 *         /sessions?person=&ticket=&q= /sessions/:ticket/:attempt?tab=&sessionId=
 *         /sessions/:ticket/:attempt/file?path=（§九.1 v2 第一刀）
 *   API ：/api/stats /api/activity?limit= /api/tickets?state=&q=&limit=&offset=
 *         /api/tickets/:id /api/org /api/reports?q=&limit=&offset= ＋ /api/chat/*
 *         /api/sessions?person=&ticket=&q= /api/sessions/:ticket/:attempt?sessionId=
 *         （createChatApp 同端口挂载，其发送/已读写面经 chatd 网关——事实源写入者不变）
 * 聊天复用：/chat 与 /api/chat/* 整体来自 @studio-next/panel/chat 的 createChatApp——
 * portal 显式注入 pageRenderer（非路由排序覆盖），业务脚本/降级卡零复制（§三）。
 *
 * 纪律：token 仅驻内存（注入 transport 调用参数；永不打印/落日志/进页面）；监控面 :8791
 * 独立不并入、门户不出其链接（§七 不做项）。
 */
import { readFileSync } from 'node:fs'
import { Hono } from 'hono'
import { listenHono, type HonoShellHandle } from '@studio-next/panel'
import { createChatApp, type ChatAppOptions } from '@studio-next/panel/chat'
import { loadCompanyDirectory, readDirectoryFiles } from '@studio-next/company'
import type { CompanySnapshot } from '@studio-next/contract'
import { openLedger } from '@studio-next/store'
import { chatPageRenderer, orgBody, REPORTS_DEFAULT_LIMIT, REPORTS_MAX_LIMIT, reportViewBody, reportsBody } from './pages-side.ts'
import { activityJson, overviewBody, ticketDetailBody, ticketJson, ticketsBody } from './pages-core.ts'
import { parseSessionsTab, sessionsDetailBody, sessionsFileBody, sessionsListBody } from './pages-sessions.ts'
import { SESSIONS_PERSON_RE, SESSIONS_TICKET_RE, type AttemptFileResult } from './sessions.ts'
import { createPortalData, extractMission, type ChatStatsView, type PortalData } from './data.ts'
import { emptyState, esc, icon } from './html.ts'
import { portalShell, type ShellOptions } from './layout.ts'

/** 缺省端口（§一.1；--portal-port 覆盖；监控 :8791 不动） */
export const PORTAL_DEFAULT_PORT = 8800

/**
 * 门户聊天缺省操作者工号（--chat-actor 缺省值）：面板生产 env PANEL_CHAT_ACTOR 同值。
 * 取 PRIME-0 而非面板包缺省 'panel'——门户面向公司成员，'panel' 非 chatd 房间成员，
 * 消息面会吃 WB_INVALID_ARGUMENT（actor is not a room member）。
 */
export const PORTAL_DEFAULT_CHAT_ACTOR = 'PRIME-0'

/** 聊天统计 TTL/超时：概览页不被卡死的 chatd 拖住（§三 降级矩阵） */
const CHAT_TTL_MS = 15_000
const CHAT_TIMEOUT_MS = 1_500
/** API 分页上限（§三——limit 钳位而非报错） */
const API_MAX_LIMIT = 100
const ACTIVITY_MAX_LIMIT = 200
/** 单据 id 合法形（与 localplatform ticket id 同正则） */
const TICKET_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

const jsonError = (code: string, message: string) => ({ ok: false as const, error: { code, message } })

/** 非负整数参数（缺省/空串=默认值；非法=null；上限钳位） */
function intParam(raw: string | undefined, def: number, min: number, max: number): number | null {
  if (raw === undefined || raw === '') return def
  if (!/^\d{1,9}$/.test(raw)) return null
  return Math.min(max, Math.max(min, Number.parseInt(raw, 10)))
}

/** 文本参数：absent→undefined；过长/含控制字符→null（防查询串注入换行等） */
function textParam(raw: string | undefined, max: number): string | null | undefined {
  if (raw === undefined) return undefined
  if (raw.length > max) return null
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null
  return raw
}

/**
 * 聊天统计（best-effort）：createChatApp 的 transport.listRooms → 房间数＋headRoomSeq
 * 合计（=累计消息数，chatd §headRoomSeq 语义）。TTL 缓存＋1500ms 超时；transport 未配或
 * socket 死→available:false（页面「—」，API 如实）。
 */
export function createChatStats(chat: ChatAppOptions): () => Promise<ChatStatsView> {
  let cache: { at: number; value: ChatStatsView } | null = null
  return async () => {
    if (cache !== null && Date.now() - cache.at < CHAT_TTL_MS) return cache.value
    const unavailable: ChatStatsView = { available: false, rooms: 0, messages: 0 }
    if (chat.transport === null || chat.transport === undefined) {
      cache = { at: Date.now(), value: unavailable }
      return unavailable
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const auth = chat.token !== undefined ? { token: chat.token } : {}
      const rooms = await Promise.race([
        chat.transport.listRooms(auth),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('chatd 统计超时')), CHAT_TIMEOUT_MS)
        }),
      ])
      const value: ChatStatsView = { available: true, rooms: rooms.length, messages: rooms.reduce((s, r) => s + r.headRoomSeq, 0) }
      cache = { at: Date.now(), value }
      return value
    } catch {
      cache = { at: Date.now(), value: unavailable } // 失败也短暂缓存：死 socket 不逐页重探
      return unavailable
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}

export interface PortalAppOptions {
  readonly data: PortalData
  readonly chat: ChatAppOptions
  readonly version: string
}

function errorBody(status: number, code: string, message: string): string {
  return `<div class="banner danger">${icon('activity')}<div class="grow"><b>${esc(code)}</b> — ${esc(message)}</div></div>
<div class="card"><div class="card-body">${emptyState('dot', `HTTP ${String(status)}`, '用浏览器返回上一页，或从左侧导航重新进入。')}</div></div>`
}

/** 门户 Hono app（纯工厂——测试可 app.request() 直打，不占端口） */
export function createPortalApp(opts: PortalAppOptions): Hono {
  const data = opts.data
  // 聊天未读导航徽标（§二 组件）：transport 已配才注入（脚本取 /api/chat/rooms?actor= 聚合，
  // 失败/无未读→徽标保持 hidden——chatd 缺不占导航位）
  const chatBadge = opts.chat.transport === null ? undefined : { actor: opts.chat.defaultActorId ?? 'panel' }
  const shell = (title: string, active: string, body: string, so?: { mainAsDiv?: boolean }): string => {
    const shellOpts: ShellOptions = {
      company: data.company(),
      title,
      active,
      online: data.daemonOnline(),
      version: opts.version,
      body,
      ...(so ?? {}),
      ...(chatBadge !== undefined ? { chatBadge } : {}),
    }
    return portalShell(shellOpts)
  }

  const app = new Hono()
  app.onError((err, c) => {
    const message = err instanceof Error ? err.message : String(err)
    if (c.req.path.startsWith('/api/')) return c.json(jsonError('portal-internal', message), 500)
    return c.html(shell('出错了', '', errorBody(500, 'portal-internal', message)), 500)
  })
  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) return c.json(jsonError('not-found', `无此端点：${c.req.path}`), 404)
    return c.html(shell('未找到', '', errorBody(404, 'not-found', `页面不存在：${c.req.path}`)), 404)
  })

  // —— 页面 ——
  app.get('/', async (c) => c.html(shell('概览', 'overview', overviewBody(data, await data.stats()))))
  app.get('/tickets', (c) => {
    const state = textParam(c.req.query('state'), 64)
    const search = textParam(c.req.query('q'), 100)
    const size = intParam(c.req.query('size'), 25, 10, 100)
    const page = intParam(c.req.query('page'), 1, 1, 1_000_000)
    if (state === null || search === null || size === null || page === null) {
      return c.html(shell('单子', 'tickets', errorBody(400, 'bad-query', '查询参数非法：state/q 过长或含控制字符；page/size 须为整数')), 400)
    }
    return c.html(shell('单子', 'tickets', ticketsBody(data, { state, search: search ?? '', page, size })))
  })
  app.get('/tickets/:id', (c) => {
    const id = c.req.param('id')
    if (!TICKET_ID_RE.test(id)) return c.html(shell('单子', 'tickets', errorBody(400, 'bad-ticket-id', `单号 ${id} 不是票形 id（^[A-Za-z0-9][A-Za-z0-9._-]*$）`)), 400)
    const r = data.ticketDetail(id)
    if (!r.ok) return c.html(shell('单子', 'tickets', errorBody(r.status, r.code, r.message)), r.status)
    return c.html(shell(r.view.record.title, 'tickets', ticketDetailBody(r.view, data.sessions().forTicket(id))))
  })
  app.get('/org', (c) => {
    const dept = textParam(c.req.query('dept'), 128)
    if (dept === null) return c.html(shell('组织', 'org', errorBody(400, 'bad-query', '查询参数非法：dept 过长或含控制字符')), 400)
    if (dept !== undefined && !data.org().departments.some((d) => d.path === dept)) {
      return c.html(shell('组织', 'org', errorBody(400, 'bad-dept', `部门路径 ${dept} 不在组织快照内（从架构图节点点击进入）`)), 400)
    }
    return c.html(shell('组织', 'org', orgBody(data, dept)))
  })
  app.get('/reports', (c) => {
    const search = textParam(c.req.query('q'), 120)
    const limit = intParam(c.req.query('limit'), REPORTS_DEFAULT_LIMIT, 1, REPORTS_MAX_LIMIT)
    const page = intParam(c.req.query('page'), 1, 1, 1_000_000)
    if (search === null || limit === null || page === null) {
      return c.html(shell('报表', 'reports', errorBody(400, 'bad-query', '查询参数非法：q 过长或含控制字符；limit/page 须为整数')), 400)
    }
    const all = data.reports()
    const needle = (search ?? '').trim().toLowerCase()
    const matched = needle === '' ? all : all.filter((f) => f.relPath.toLowerCase().includes(needle))
    const pages = Math.max(1, Math.ceil(matched.length / limit))
    const cur = Math.min(page, pages)
    const from = (cur - 1) * limit
    return c.html(
      shell(
        '报表',
        'reports',
        reportsBody(matched.slice(from, from + limit), {
          q: (search ?? '').trim(),
          limit,
          page: cur,
          totalAll: all.length,
          totalMatch: matched.length,
        }),
      ),
    )
  })
  app.get('/reports/view', (c) => {
    const raw = c.req.query('path')
    if (raw === undefined) return c.html(shell('报表', 'reports', errorBody(400, 'path-out-of-reports', '缺少 path 参数')), 400)
    const r = data.reportView(raw)
    if (!r.ok) return c.html(shell('报表', 'reports', errorBody(r.status, r.code, r.message)), r.status)
    return c.html(shell(r.file.relPath, 'reports', reportViewBody(r)))
  })

  // —— 会话档案（§九.1 v2 第一刀：.AIWS 工位轨迹只读浏览；person 越界 400） ——
  app.get('/sessions', (c) => {
    const person = textParam(c.req.query('person'), 64)
    const ticket = textParam(c.req.query('ticket'), 128)
    const search = textParam(c.req.query('q'), 120)
    const size = intParam(c.req.query('size'), 25, 10, 100)
    const page = intParam(c.req.query('page'), 1, 1, 1_000_000)
    if (person === null || ticket === null || search === null || size === null || page === null) {
      return c.html(shell('会话', 'sessions', errorBody(400, 'bad-query', '查询参数非法：person/ticket/q 过长或含控制字符；page/size 须为整数')), 400)
    }
    const archive = data.sessions()
    if (person !== undefined && !SESSIONS_PERSON_RE.test(person)) {
      return c.html(shell('会话', 'sessions', errorBody(400, 'bad-person', `岗位 ${person} 不是工号形 id（^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$）`)), 400)
    }
    if (ticket !== undefined && !SESSIONS_TICKET_RE.test(ticket)) {
      return c.html(shell('会话', 'sessions', errorBody(400, 'bad-ticket-id', `单号 ${ticket} 不是票形 id（^[A-Za-z0-9][A-Za-z0-9._-]*$）`)), 400)
    }
    if (person !== undefined && archive.available() && !archive.persons().includes(person)) {
      return c.html(shell('会话', 'sessions', errorBody(400, 'bad-person', `岗位 ${person} 不在工位档案树内（先从 /org 或 /sessions 列表选岗位）`)), 400)
    }
    return c.html(shell('会话', 'sessions', sessionsListBody(archive, { person: person ?? '', ticket: ticket ?? '', q: (search ?? '').trim(), page, size })))
  })
  app.get('/sessions/:ticket/:attempt', async (c) => {
    const ticket = c.req.param('ticket')
    const attempt = c.req.param('attempt')
    const person = textParam(c.req.query('person'), 64)
    const sessionId = textParam(c.req.query('sessionId'), 96)
    if (person === null || sessionId === null) {
      return c.html(shell('会话', 'sessions', errorBody(400, 'bad-query', '查询参数非法：person/sessionId 过长或含控制字符')), 400)
    }
    const tab = parseSessionsTab(c.req.query('tab'))
    const r = await data
      .sessions()
      .detail(ticket, attempt, { ...(person !== undefined ? { person } : {}), ...(sessionId !== undefined && sessionId !== '' ? { sessionId } : {}) })
    if (!r.ok) return c.html(shell('会话', 'sessions', errorBody(r.status, r.code, r.message)), r.status)
    const { view } = r
    const readFile = (rel: string): AttemptFileResult => data.sessions().fileView(view.ticket, `att${String(view.attempt)}`, rel)
    return c.html(shell(`${view.ticket} 会话`, 'sessions', sessionsDetailBody(view, tab, readFile)))
  })
  app.get('/sessions/:ticket/:attempt/file', (c) => {
    const ticket = c.req.param('ticket')
    const attempt = c.req.param('attempt')
    const rel = c.req.query('path') ?? ''
    const r = data.sessions().fileView(ticket, attempt, rel)
    const attNum = /^att(\d{1,4})$/.exec(attempt)
    const person = attNum === null ? '' : (data.sessions().forTicket(ticket).find((x) => x.attempt === Number.parseInt(attNum[1] ?? '0', 10))?.person ?? '')
    const ctx = { ticket, attempt: attNum === null ? 0 : Number.parseInt(attNum[1] ?? '0', 10), person }
    return c.html(shell(r.ok ? r.file.relPath : '文件预览', 'sessions', sessionsFileBody(ctx, r)), r.ok ? 200 : r.status)
  })

  // —— 只读 JSON API（§1.3：统一 {ok,…}；错误码可读） ——
  app.get('/api/stats', async (c) => c.json({ ok: true, stats: await data.stats() }))
  app.get('/api/activity', (c) => {
    const limit = intParam(c.req.query('limit'), 50, 1, ACTIVITY_MAX_LIMIT)
    if (limit === null) return c.json(jsonError('bad-query', 'limit 须为 1-200 整数'), 400)
    const events = data.activity(limit)
    return c.json({ ok: true, count: events.length, events: events.map(activityJson) })
  })
  app.get('/api/tickets', (c) => {
    const state = textParam(c.req.query('state'), 64)
    const search = textParam(c.req.query('q'), 100)
    const limit = intParam(c.req.query('limit'), 50, 1, API_MAX_LIMIT)
    const offset = intParam(c.req.query('offset'), 0, 0, 1_000_000)
    if (state === null || search === null || limit === null || offset === null) {
      return c.json(jsonError('bad-query', '查询参数非法：state/q 过长或含控制字符；limit/offset 须为非负整数'), 400)
    }
    const r = data.ticketList({ state, search })
    return c.json({
      ok: true,
      available: r.available,
      total: r.total,
      limit,
      offset,
      states: r.states,
      items: r.items.slice(offset, offset + limit).map(ticketJson),
    })
  })
  app.get('/api/tickets/:id', (c) => {
    const id = c.req.param('id')
    if (!TICKET_ID_RE.test(id)) return c.json(jsonError('bad-ticket-id', `单号 ${id} 不是票形 id（^[A-Za-z0-9][A-Za-z0-9._-]*$）`), 400)
    const r = data.ticketDetail(id)
    if (!r.ok) return c.json(jsonError(r.code, r.message), r.status)
    return c.json({ ok: true, ticket: ticketJson(r.view.record), description: r.view.description, acceptance: r.view.acceptance, events: r.view.events })
  })
  app.get('/api/org', (c) => {
    const o = data.org()
    const company = data.company()
    return c.json({ ok: true, company: { slug: company.slug, name: company.name, level: company.level }, departments: o.departments, people: o.people })
  })
  app.get('/api/sessions', (c) => {
    const person = textParam(c.req.query('person'), 64)
    const ticket = textParam(c.req.query('ticket'), 128)
    const search = textParam(c.req.query('q'), 120)
    const limit = intParam(c.req.query('limit'), 50, 1, API_MAX_LIMIT)
    const offset = intParam(c.req.query('offset'), 0, 0, 1_000_000)
    if (person === null || ticket === null || search === null || limit === null || offset === null) {
      return c.json(jsonError('bad-query', '查询参数非法：person/ticket/q 过长或含控制字符；limit/offset 须为非负整数'), 400)
    }
    const archive = data.sessions()
    if (person !== undefined && !SESSIONS_PERSON_RE.test(person)) return c.json(jsonError('bad-person', `岗位 ${person} 不是工号形 id`), 400)
    if (ticket !== undefined && !SESSIONS_TICKET_RE.test(ticket)) return c.json(jsonError('bad-ticket-id', `单号 ${ticket} 不是票形 id`), 400)
    if (person !== undefined && archive.available() && !archive.persons().includes(person)) {
      return c.json(jsonError('bad-person', `岗位 ${person} 不在工位档案树内`), 400)
    }
    const r = archive.list({ ...(person !== undefined ? { person } : {}), ...(ticket !== undefined ? { ticket } : {}), ...(search !== undefined && search !== '' ? { q: search } : {}), limit, offset })
    return c.json({ ok: true, available: r.available, total: r.total, scanned: r.scanned, capped: r.capped, limit, offset, items: r.items })
  })
  app.get('/api/sessions/:ticket/:attempt', async (c) => {
    const ticket = c.req.param('ticket')
    const attempt = c.req.param('attempt')
    const person = textParam(c.req.query('person'), 64)
    const sessionId = textParam(c.req.query('sessionId'), 96)
    if (person === null || sessionId === null) return c.json(jsonError('bad-query', '查询参数非法：person/sessionId 过长或含控制字符'), 400)
    const r = await data.sessions().detail(ticket, attempt, { ...(person !== undefined ? { person } : {}), ...(sessionId !== undefined && sessionId !== '' ? { sessionId } : {}) })
    if (!r.ok) return c.json(jsonError(r.code, r.message), r.status)
    const { view } = r
    const transcript = view.transcript.available ? { available: true, ...(view.transcript.sourceTruncated === true ? { sourceTruncated: true } : {}) } : { available: false, code: view.transcript.code ?? 'unavailable', message: view.transcript.message ?? '' }
    return c.json({
      ok: true,
      ticket: view.ticket,
      person: view.person,
      dept: view.dept,
      attempt: view.attempt,
      updatedAtMs: view.updatedAtMs,
      sessionId: view.sessionId,
      files: view.files,
      sessions: view.sessions,
      events: view.events,
      usage: view.usage,
      transcript,
    })
  })
  app.get('/api/reports', (c) => {
    // 可选 q/limit/offset（§1.3 补订）：缺省=全清单（现契约形状零变化）；limit=0 亦=不截断
    const search = textParam(c.req.query('q'), 120)
    const limit = intParam(c.req.query('limit'), 0, 0, REPORTS_MAX_LIMIT)
    const offset = intParam(c.req.query('offset'), 0, 0, 1_000_000)
    if (search === null || limit === null || offset === null) {
      return c.json(jsonError('bad-query', '查询参数非法：q 过长或含控制字符；limit/offset 须为非负整数'), 400)
    }
    const all = data.reports()
    const needle = (search ?? '').trim().toLowerCase()
    const matched = needle === '' ? all : all.filter((f) => f.relPath.toLowerCase().includes(needle))
    const files = limit === 0 ? matched.slice(offset) : matched.slice(offset, offset + limit)
    return c.json({ ok: true, total: matched.length, ...(search !== undefined ? { q: (search ?? '').trim() } : {}), files })
  })

  // —— 聊天（createChatApp 同端口挂载：GET /chat ＋ /api/chat/*；portal 只注入壳渲染器） ——
  app.route('/', createChatApp({ ...opts.chat, pageRenderer: chatPageRenderer(shell) }))

  return app
}

export interface PortalServeOptions {
  readonly companyDir: string
  readonly dbPath: string
  readonly platformRoot: string | null
  readonly chat: ChatAppOptions
  readonly port?: number
  readonly hostname?: string
}

/** 版本面：apps/daemon/package.json 单源（cli/main.ts cliVersion 同判例，不引 env 仿冒） */
export function portalVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version?: string }
  return pkg.version ?? 'unknown'
}

/** 公司目录装载（校验不过抛错拒启——与 overview 同判例；文本含 file:line 修法线索） */
export async function mountCompany(companyDir: string): Promise<{ snapshot: CompanySnapshot; mission: string }> {
  const files = await readDirectoryFiles(companyDir)
  const mounted = loadCompanyDirectory(files)
  if (!mounted.ok) {
    const lines = mounted.issues.map((i) => `  - ${i.file}:${String(i.line)} [${i.rule}] ${i.fix}`).join('\n')
    throw new Error(`公司目录校验不过（拒启，不代建不修补）：\n${lines}`)
  }
  return { snapshot: mounted.snapshot, mission: extractMission(files['org-config.yaml']) }
}

/** 真监听壳：装载公司目录＋开台账（库须已存在——CLI 层前置闸）→ app → listenHono */
export async function servePortal(opts: PortalServeOptions): Promise<HonoShellHandle> {
  const mounted = await mountCompany(opts.companyDir)
  const ledger = openLedger(opts.dbPath)
  const data = createPortalData({
    company: mounted.snapshot,
    companyDir: opts.companyDir,
    mission: mounted.mission,
    platformRoot: opts.platformRoot,
    ledger,
    chatStats: createChatStats(opts.chat),
  })
  const app = createPortalApp({ data, chat: opts.chat, version: portalVersion() })
  return listenHono(app, opts.port ?? PORTAL_DEFAULT_PORT, {
    ...(opts.hostname !== undefined ? { hostname: opts.hostname } : {}),
    label: 'portal',
    onClose: () => ledger.close(),
  })
}
