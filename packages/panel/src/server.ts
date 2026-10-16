/**
 * server —— :8787 监控面服务器层（v0.3 首刀 + 全量口径补齐）
 *
 * 依据：docs/16-§四 v0.3（验收「信息覆盖：jobs/runs/workers/事件流齐备」）、docs/17-§8
 * （:8787 端面全量口径：jobs/runs/workers 实时流 SSE/事件流/断路器与漂移告警/成本趋势
 * ——全部读 SQLite；断路器+成本两卡本刀补齐，漂移告警待判据冻结）、docs/16-§二
 * （Web 选型 Hono + streamSSE，已登记）。
 *
 * 端面（全部 GET、全部只读，无任何写路径）：
 *   GET /                    极简 HTML 单页（零前端依赖、内联 CSS；六区块卡片+SSE 事件流）
 *   GET /api/health          {ok, schema_version}
 *   GET /api/jobs            listJobs 投影（含 due 标记，判据同 store.dueJobs）
 *   GET /api/runs?limit=     work_records 近况（在途优先，started_at 降序）
 *   GET /api/workers         v0 聚合口径（见 views.ts 头注：真 workers=daemon 内存态，v0.4 替换）
 *   GET /api/events?limit=&company=&issue=&order=&event=
 *                            queryEvents 包装（缺省升序——store 冻结语义；order=desc 透传
 *                            store 读面取「最近 N 条」；event= 事件名维 panel 侧过滤——store
 *                            读面无此维，过滤后截 limit，坏事件名 400）
 *   GET /api/events/stream   SSE：轮询台账新事件（按 lastEventId/ULID 游标过滤），断开干净停止
 *   GET /api/snapshot        buildDashboardSnapshot 一次收集（页面轮询单请求）
 *   GET /api/breakers?days=  断路器告警卡（近 N 天可配缺省 7 上限 90）：CIRCUIT_BREAK 族
 *                            事件按 (issue,错误签名) 聚合——见 views.aggregateBreakers 头注
 *   GET /api/costs?days=     成本趋势卡（近 N 天可配缺省 7 上限 90）：LLM 岛(events)/收割
 *                            (work_records)/预算三类(budgets) 三口径按 UTC 日分列——docs/26 C1
 *
 * 只读纪律：panel 对 SQLite **零写**。台账 WAL（单写多读）使 panel 与 daemon 写进程同库并存
 * 天然安全（store/driver.ts journal_mode=WAL）。注意 openLedger 对不存在的路径会建库迁移
 * （=写），故 servePanel 前置 existsSync 闸：库不存在即拒启，不代建。
 *
 * 依赖纪律：本包仅 hono（16-§二 已登记）。**不引 @hono/node-server**——真监听壳用 node:http
 * 手写 ~60 行 fetch 适配器（含请求体收集 [:8788 POST 面]、流式回写与断连取消，SSE 可用）。
 *
 * ledger 注入：openLedger 为工厂，app 内懒调用**恰一次**并缓存（句柄生命周期归注入方——
 * servePanel 开/关自己的句柄；测试注入共享库零文件依赖）。工厂抛错 → 该次请求 503，不缓存失败。
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync } from 'node:fs'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'
import path from 'node:path'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { configInvalid, isEventName, type EventRecord } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import {
  DEFAULT_BREAKER_DAYS,
  DEFAULT_COSTS_DAYS,
  DEFAULT_PAGE_SIZE,
  MAX_BREAKER_DAYS,
  MAX_COSTS_DAYS,
  aggregateActiveWorkers,
  buildBreakerSnapshot,
  buildCostsSnapshot,
  buildDashboardSnapshot,
  jobViews,
  recentRunSlice,
  renderDashboardPage,
} from './views.ts'

// —— 参数缺省与夹取 ——

/** 默认 SSE 轮询间隔（任务口径：间隔可配默认 2s） */
export const DEFAULT_STREAM_INTERVAL_MS = 2000
/** 页大小上限（监控面单响应防拉爆） */
export const MAX_PAGE_SIZE = 200

/** createPanelApp 选项 */
export interface PanelAppOptions {
  /** ledger 工厂（懒调恰一次并缓存；句柄归注入方管） */
  openLedger: () => Ledger
  /** runs/events 默认条数（缺省 20） */
  pageSize?: number
  /** SSE 轮询间隔 ms（缺省 2000；非正整数落回缺省） */
  streamIntervalMs?: number
}

function clampLimit(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return Math.min(parsed, MAX_PAGE_SIZE)
}

/** 窗口天数夹取（/api/breakers、/api/costs 共用）：非正整数/非数 → 缺省；超上限夹到上限 */
function clampDays(raw: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return Math.min(parsed, max)
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// —— SSE 游标（按 lastEventId/ULID 过滤新事件） ——

/** 事件游标：(ts, id) 双键稳定序——与 store queryEvents 的 ORDER BY ts ASC, id ASC 同序 */
interface EventCursor {
  ts: number
  id: string
}

/** 库空（或从零开始）时的游标原点 */
const CURSOR_DAWN: EventCursor = { ts: -1, id: '' }

function latestCursor(ledger: Ledger): EventCursor {
  const all = ledger.queryEvents()
  const last = all.length > 0 ? all[all.length - 1] : undefined
  return last === undefined ? CURSOR_DAWN : { ts: last.ts, id: last.id }
}

/** 断线重连（Last-Event-ID）：定位该事件为游标（自身不重发）；id 已不在库（回滚/换库）→ 从最新起 */
function resolveCursor(lastEventId: string | undefined, ledger: Ledger): EventCursor {
  if (lastEventId === undefined || lastEventId === '') return latestCursor(ledger)
  for (const ev of ledger.queryEvents()) {
    if (ev.id === lastEventId) return { ts: ev.ts, id: ev.id }
  }
  return latestCursor(ledger)
}

/** 游标之后的新事件（复用 queryEvents 读面：since 闭区间取回后按 (ts,id) 双键过滤） */
function eventsAfter(ledger: Ledger, cursor: EventCursor): EventRecord[] {
  const batch = ledger.queryEvents({ since: cursor.ts < 0 ? 0 : cursor.ts })
  return batch.filter((ev) => ev.ts > cursor.ts || (ev.ts === cursor.ts && ev.id > cursor.id))
}

// —— Hono 应用（可注入 ledger 工厂；app.fetch() 进程内可测，零端口零文件） ——

/** createPanelApp 返回的 app 类型（Hono 实例；测试用 app.request() 进程内驱动） */
export type PanelApp = Hono

export function createPanelApp(opts: PanelAppOptions): PanelApp {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE
  const intervalMs =
    opts.streamIntervalMs !== undefined && Number.isInteger(opts.streamIntervalMs) && opts.streamIntervalMs > 0
      ? opts.streamIntervalMs
      : DEFAULT_STREAM_INTERVAL_MS

  // 懒开缓存：恰调一次工厂；失败不缓存（下个请求重试），抛错由 onError 兜成 503
  let cached: Ledger | null = null
  const getLedger = (): Ledger => {
    if (cached === null) cached = opts.openLedger()
    return cached
  }

  const app: PanelApp = new Hono()

  app.onError((err, c) => c.json({ ok: false, error: errText(err) }, 500))

  app.get('/api/health', (c) => {
    const ledger = getLedger()
    return c.json({ ok: true, schema_version: ledger.version() })
  })

  app.get('/api/jobs', (c) => {
    const ledger = getLedger()
    const jobs = jobViews(ledger.listJobs(), Date.now())
    return c.json({ total: jobs.length, due: jobs.filter((j) => j.due).length, jobs })
  })

  app.get('/api/runs', (c) => {
    const ledger = getLedger()
    const limit = clampLimit(c.req.query('limit'), pageSize)
    const all = ledger.listWorkRecords()
    return c.json({
      total: all.length,
      inFlight: all.filter((r) => r.ended_at === undefined).length,
      runs: recentRunSlice(all, limit),
    })
  })

  app.get('/api/workers', (c) => {
    const ledger = getLedger()
    return c.json(aggregateActiveWorkers(ledger.listWorkRecords(), ledger.listSessions()))
  })

  app.get('/api/events', (c) => {
    const ledger = getLedger()
    const company = c.req.query('company')
    const issue = c.req.query('issue')
    const event = c.req.query('event')
    const order = c.req.query('order')
    const limit = c.req.query('limit')
    // order 白名单（store 读面同枚举）：非 asc/desc 是客户端错——4xx 不劳 store 抛 500
    if (order !== undefined && order !== 'asc' && order !== 'desc') {
      return c.json({ ok: false, error: `order=${order} 须为 'asc' | 'desc'` }, 400)
    }
    // event 维走契约事件名闸（冻结枚举 ∪ GW_/REPORT_ 前缀族）；坏名=客户端错 4xx
    if (event !== undefined && !isEventName(event)) {
      return c.json({ ok: false, error: `event=${event} 不是台账事件名（冻结枚举 ∪ GW_*/REPORT_* 前缀族）` }, 400)
    }
    const query: Parameters<Ledger['queryEvents']>[0] = {}
    if (company !== undefined) query.company = company
    if (issue !== undefined) query.issue = issue
    if (order !== undefined) query.order = order
    if (event === undefined && limit !== undefined) query.limit = clampLimit(limit, pageSize)
    // event 过滤维 store 读面没有——panel 侧滤；limit 在过滤后截（「最近 N 条该类事件」
    // 而非「最近 N 条事件里的该类」），v0 量级全量拉回可承受（同 snapshot 全扫口径）。
    // 无 limit=全量（首刀语义不变）；无 event 时 limit 已由 store 面（asc/desc 同序）处理。
    const fetched: EventRecord[] = ledger.queryEvents(query)
    const events =
      event === undefined
        ? fetched
        : limit === undefined
          ? fetched.filter((ev) => ev.event === event)
          : fetched.filter((ev) => ev.event === event).slice(0, clampLimit(limit, pageSize))
    return c.json({ count: events.length, events })
  })

  // 断路器告警卡（17-§8）：CIRCUIT_BREAK 族事件 (issue,错误签名) 聚合——口径见 views.ts
  app.get('/api/breakers', (c) =>
    c.json(buildBreakerSnapshot(getLedger(), { days: clampDays(c.req.query('days'), DEFAULT_BREAKER_DAYS, MAX_BREAKER_DAYS) })),
  )

  // 成本趋势卡（17-§8 / docs/26 C1）：LLM 岛 / 收割 / 预算三类按 UTC 日分列不相加
  app.get('/api/costs', (c) =>
    c.json(buildCostsSnapshot(getLedger(), { days: clampDays(c.req.query('days'), DEFAULT_COSTS_DAYS, MAX_COSTS_DAYS) })),
  )

  app.get('/api/snapshot', (c) => c.json(buildDashboardSnapshot(getLedger(), { recentRuns: pageSize })))

  // SSE 事件流：轮询台账新事件，按 (ts,id) 游标过滤；Last-Event-ID 断线续传；断开干净停止
  app.get('/api/events/stream', (c) =>
    streamSSE(c, async (stream) => {
      const ledger = getLedger()
      let cursor = resolveCursor(c.req.header('Last-Event-ID'), ledger)
      let aborted = false
      stream.onAbort(() => {
        aborted = true
      })
      // ready：告知当前游标（浏览器据此持 lastEventId 断线续传）；retry 建议重连间隔
      await stream.writeSSE({
        event: 'ready',
        ...(cursor.id !== '' ? { id: cursor.id } : {}),
        data: JSON.stringify({ lastEventId: cursor.id === '' ? null : cursor.id }),
        retry: 5000,
      })
      // 轮询循环。hono 4.13 语义（实测源码 dist/utils/stream.js）：write 对已断流静默吞错、
      // sleep 不随断连 reject、Node 下请求 signal 不接线——**唯一停止信号是本旗标**
      // （由响应体被取消触发：真壳里=客户端断开→适配器销毁管道；进程内=reader.cancel）。
      while (!aborted) {
        try {
          for (const ev of eventsAfter(ledger, cursor)) {
            if (aborted) break
            await stream.writeSSE({ id: ev.id, event: 'ledger', data: JSON.stringify(ev) })
            cursor = { ts: ev.ts, id: ev.id }
          }
        } catch {
          break // 库句柄已关（servePanel 关停竞态）等读面异常：停轮询即净停（监控流不抢救）
        }
        await stream.sleep(intervalMs)
      }
    }),
  )

  app.get('/', (c) => c.html(renderDashboardPage()))

  return app
}

// —— 真监听壳（薄）：node:http fetch 适配器 + 生命周期 ——
// ①② 提取为共用件（:8787 servePanel 与 :8789 serveOverview 同一实现——overview/server.ts 复用）：
// toWebRequest / forwardResponse / listenHono 导出；错误兜底文案按 label 参数化。

/** servePanel 选项 */
export interface ServePanelOptions extends PanelAppOptions {
  /** 绑定地址（缺省 127.0.0.1——:8787 是内部监控面，默认只绑本机） */
  hostname?: string
}

/** servePanel 返回句柄：真端口 + 优雅关闭（断 SSE 长连、关 server、关 ledger） */
export type PanelHandle = HonoShellHandle

/** 请求侧逐出的逐跳头（host 走 URL、其余由 node:http 自管） */
const HOP_BY_HOP_REQUEST = new Set(['host', 'connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade'])
/** 回写侧逐出的逐跳头（node:http 自管 chunked/连接语义） */
const HOP_BY_HOP_RESPONSE = new Set(['connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade'])

/**
 * IncomingMessage → 标准 Request；断连经 AbortSignal 传给 hono。
 * v0.9 起 :8788 对外面有 POST 请求体：非 GET/HEAD 方法收集 body 为 Buffer（Request BodyInit）。
 * 客户端键注入：socket.remoteAddress 以 `x-sn-client-key` 头写入（**覆写**同名入站头——
 * 外部不可伪造），供对外面配额按客户端分桶；:8787/:8789 不读此头，行为不变。
 */
export async function toWebRequest(req: IncomingMessage, signal: AbortSignal): Promise<Request> {
  const host = typeof req.headers.host === 'string' && req.headers.host !== '' ? req.headers.host : '127.0.0.1'
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP_REQUEST.has(key)) continue
    if (value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) headers.append(key, item)
  }
  const clientKey = req.socket.remoteAddress
  if (clientKey !== undefined) headers.set('x-sn-client-key', clientKey)
  let body: Uint8Array | null = null
  const method = req.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    body = Buffer.concat(chunks)
  }
  return new Request(`http://${host}${req.url ?? '/'}`, { method, headers, body, signal })
}

/** Response → ServerResponse 流式回写（SSE 走同一条 pipe 路径）；客户端断开 → 取消上游流 */
export async function forwardResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {}
  response.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_RESPONSE.has(key)) headers[key] = value
  })
  res.writeHead(response.status, headers)
  if (response.body === null) {
    res.end()
    return
  }
  const nodeStream = Readable.fromWeb(response.body as unknown as NodeWebReadableStream<Uint8Array>)
  res.on('close', () => {
    if (!res.writableEnded) nodeStream.destroy()
  })
  await new Promise<void>((resolve) => {
    nodeStream.on('error', () => {
      res.destroy()
      resolve()
    })
    res.on('close', () => resolve())
    nodeStream.pipe(res)
  })
}

/** 共用监听壳句柄：真端口 + 优雅关闭（断长连含 SSE、关 server、调 onClose 关注入方资源） */
export interface HonoShellHandle {
  port: number
  hostname: string
  close(): Promise<void>
}

/** listenHono 选项 */
export interface ListenHonoOptions {
  /** 绑定地址（缺省 127.0.0.1——内部面板默认只绑本机） */
  hostname?: string
  /** server 关闭后回调（关 ledger 等注入方资源；缺省无） */
  onClose?: () => void
  /** 内部错误兜底文案标记（缺省 'panel'；overview 传 'overview'） */
  label?: string
}

/**
 * 共用真监听壳：Hono app → node:http 监听（fetch 适配器含流式回写与断连取消，SSE 可用）。
 * close() 依次：断全部连接（含 SSE 长连）→ 关 server → onClose()（注入方资源）。
 */
export async function listenHono(app: Hono, port: number, opts?: ListenHonoOptions): Promise<HonoShellHandle> {
  const label = opts?.label ?? 'panel'
  const server = createServer((req, res) => {
    const controller = new AbortController()
    res.on('close', () => controller.abort())
    void toWebRequest(req, controller.signal)
      .then((request) => app.fetch(request))
      .then((response: Response) => forwardResponse(res, response))
      .catch(() => {
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: `${label} internal error` }))
        } else {
          res.destroy()
        }
      })
  })

  const hostname = opts?.hostname ?? '127.0.0.1'
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, hostname, () => {
      server.off('error', reject)
      resolve()
    })
  })

  return {
    port: (server.address() as AddressInfo).port,
    hostname,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      opts?.onClose?.()
    },
  }
}

/**
 * 真监听壳：打开库文件（不存在即拒——零写纪律不代建库）→ createPanelApp → 监听。
 * 句柄 close() 依次：断全部连接（含 SSE 长连）→ 关 server → 关 ledger。
 */
export async function servePanel(port: number, dbPath: string, opts?: ServePanelOptions): Promise<PanelHandle> {
  const resolved = path.resolve(dbPath)
  if (!existsSync(resolved)) {
    configInvalid(`panel/db-not-found:${resolved}`, `台账库不存在：${resolved}（panel 只读不代建库——先由 daemon/回填侧建库）`)
  }
  const ledger = openLedger(resolved)
  const app = createPanelApp({ ...opts, openLedger: () => ledger })
  return listenHono(app, port, {
    ...(opts?.hostname !== undefined ? { hostname: opts.hostname } : {}),
    onClose: () => ledger.close(),
  })
}
