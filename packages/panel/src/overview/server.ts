/**
 * overview server —— :8789 公司概览面服务器层（v0.7 首刀读面 + DEV-12 执行刀二换装）
 *
 * 依据：docs/16-§四 v0.7（公司面 :8789/<slug>/ 可看组织/人事/财务/进度——编辑中心归后续刀）、
 * docs/04-§七（概览路由按公司目录 slug：/<slug>/... 直达、未知名 404、根路径列公司清单）、
 * docs/17-§8（:8789 端面）与 §1（公司目录=组织事实源）、docs/37-§5.1/§8（换装路线 I：
 * vendor 进仓零构建；服务器层只加路由不改语义——刀一落 /vendor+/ui，本刀复用同套）。
 *
 * 端面（全部 GET、全部只读，无任何写路径）：
 *   —— 换装面（DEV-12 刀二，同套 :8787 Naive UI + ECharts：单壳多页，路径即路由）——
 *   GET /                        公司清单（换装壳；SPA 按 pathname 切页）
 *   GET /<slug>/  | /<slug>      概览 tab（换装壳；未知 slug 404 HTML）
 *   GET /<slug>/org|people|progress|finance   对应 tab（换装壳）
 *   GET /<slug>/people/<工号>    档案（换装壳；未知工号 404 HTML）
 *   —— JSON 读面（换装页的数据源；快照时间标注=asOf+snapshotMeta 双时间戳）——
 *   GET /api/overview/companies            公司清单 payload
 *   GET /api/overview/<slug>/snapshot      概览卡 payload
 *   GET /api/overview/<slug>/org           组织树 payload（悬空/成环诚实标记）
 *   GET /api/overview/<slug>/people        花名册 payload（hasBody）
 *   GET /api/overview/<slug>/people/<工号> 档案 payload（body=null=在册但正文缺失）
 *   GET /api/overview/<slug>/progress      单据状态聚合 payload（无台账=null）
 *   GET /api/overview/<slug>/finance       三口径分列+LLM 按日 payload（无台账=null）
 *   —— 旧版回滚面（v0.7 首刀服务端渲染五读面整组迁此，换装验证期保留，退役评估归后续刀）——
 *   GET /legacy 与 /legacy/<slug>/…（路径与旧版同构：/ /<slug>/ /org /people /people/<工号>
 *     /progress /finance）
 *   —— 静态面（与 :8787 同套件：static.ts 的 /vendor/:file 白名单三件 + /ui/* 目录服务）——
 *
 * 路由保留字：slug `legacy`（旧版回滚面占用单段路径 /legacy——构造闸拒挂载，wiring 错接
 * 明报不静默遮蔽）。
 *
 * 注入纪律（与 :8787 createPanelApp 同款）：panel 不 import company 包——组织数据经
 * snapshotProvider 注入（() => CompanySnapshot，wiring 侧用 loadCompanyDirectory 装载），
 * 档案正文经 readPersonFile 注入，报表快照经 readReportFile 注入（json_ref → JSON 正文），
 * 台账经 openLedger 工厂注入（懒调恰一次并缓存，句柄归注入方）。
 * 无 ledger 的公司：progress/finance 两页如实显示「无台账数据」，不臆造空聚合。
 *
 * 热重载（DEV-12：快照时间标注或目录监听——两条都落，IO 归 wiring 侧 reload.ts）：
 * snapshotProvider 每请求直调（读面无缓存语义——wiring 给静态闭包则页面恒旧、给热源则
 * 目录变更下一请求即见）；snapshotInfo 注入位把装载时刻/代数/监听态透出到 JSON 读面。
 *
 * 只读纪律：overview 对 SQLite 零写（WAL 单写多读同库并存安全，与 :8787 同款）。serveOverview
 * 前置 existsSync 闸：库不存在即拒启，不代建。
 *
 * 【拟稿待批点】mission 注入位：契约 CompanySnapshot 无 mission 字段（charter 有、mission 无），
 * 本刀以 OverviewCompanySource.mission?: string 注入位承接；wiring 侧（apps/daemon bin）从
 * org-config.yaml 单行提取近似（块标量形态漏读 → 页面如实显示「未提供」）。正解=contract
 * CompanySnapshot 增 mission 字段（契约面变更走批示，归后续单）。
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { Hono, type Context } from 'hono'
import { configInvalid } from '@studio-next/contract'
import { SLUG_RE } from '@studio-next/company'
import type { CompanySnapshot } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { listenHono, type HonoShellHandle, type ListenHonoOptions } from '../server.ts'
import { mountPanelStatic } from '../static.ts'
import { OVERVIEW_LEGACY_BASE, renderOverviewShell } from './shell.ts'
import type { SnapshotInfo } from './reload.ts'
import {
  buildCompaniesPayload,
  buildCompanySnapshotPayload,
  buildFinancePayload,
  buildOrgPayload,
  buildPeoplePayload,
  buildPersonPayload,
  buildProgressPayload,
} from './api.ts'
import {
  buildFinanceSnapshot,
  buildProgressSnapshot,
  renderCompanyListPage,
  renderCompanyPage,
  renderFinancePage,
  renderNotFoundPage,
  renderOrgPage,
  renderPeoplePage,
  renderPersonPage,
  renderProgressPage,
} from './views.ts'

/** 单家挂载公司的数据源（全注入——panel 不直接碰公司目录与库文件） */
export interface OverviewCompanySource {
  /** 概览路由 slug（04-§七；须与 snapshot.slug 一致——per-request 校验，错位即 500 明报；不得为保留字 legacy） */
  slug: string
  /** 公司快照工厂（每请求调用——读面取当前目录状态；静态闭包或热源（reload.ts）归 wiring 侧定夺） */
  snapshotProvider: () => CompanySnapshot
  /** 使命（可选注入位——契约快照无此字段，拟稿见文件头注） */
  mission?: string | undefined
  /** 人事档案原文读取（工号 → md 全文）；缺省=无档案正文（people 页不出现档案链接） */
  readPersonFile?: ((personId: string) => string | undefined) | undefined
  /** 报表快照原文读取（公司目录相对 json_ref → JSON 全文）；缺省=finance 页月报行「快照不可读」 */
  readReportFile?: ((jsonRef: string) => string | undefined) | undefined
  /** 台账工厂（懒调恰一次并缓存；句柄归注入方管）；缺省=无台账（progress/finance 降级面） */
  openLedger?: (() => Ledger) | undefined
  /**
   * 快照装载信息（DEV-12 快照时间标注）：at=装载时刻、version=代数、watching=目录监听态、
   * lastError=最近热重载失败。热源（reload.ts mountHotCompanySource）自动注入；静态挂载
   * 缺省（JSON 读面省略 snapshotMeta 字段，不臆造）。
   */
  snapshotInfo?: (() => SnapshotInfo) | undefined
}

/** createOverviewApp 选项 */
export interface OverviewAppOptions {
  companies: OverviewCompanySource[]
}

/** createOverviewApp 返回的 app 类型（Hono 实例；测试用 app.request() 进程内驱动） */
export type OverviewApp = Hono

/** slug 形状闸：SLUG_RE 单表（@studio-next/company validator——init/org-config/panel 共一张表，docs/43-附录A-4） */

/** 运行期注册表行：数据源 + 懒开缓存的 ledger（工厂失败不缓存，下个请求重试） */
interface CompanyRuntime {
  source: OverviewCompanySource
  cachedLedger: Ledger | null
}

/** 一次请求的公司解析结果 */
interface ResolvedCompany {
  snapshot: CompanySnapshot
  source: OverviewCompanySource
  /** 无台账=undefined（progress/finance 降级面） */
  ledger: Ledger | undefined
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 公司概览 app 工厂。构造闸：companies 非空、slug 形状合法且非保留字 legacy、无重复 slug
 * （重复=路由二义，拒启不静默取先）。per-request 闸：snapshot.slug 与注册 slug 错位 → 抛错
 * （HTML 面 500 页、/api/* 面 500 JSON——wiring 错接，如实明报）。snapshotProvider 每请求直调
 * （目录变更下一请求即见——读面无缓存语义）。
 */
export function createOverviewApp(opts: OverviewAppOptions): OverviewApp {
  if (opts.companies.length === 0) {
    configInvalid('overview/no-companies', '概览面至少挂载一家公司（companies 为空——wiring 错接）')
  }
  const registry = new Map<string, CompanyRuntime>()
  for (const source of opts.companies) {
    if (!SLUG_RE.test(source.slug)) {
      configInvalid(
        `overview/bad-slug:${source.slug}`,
        `slug 必须形如 my-corp（小写字母/数字/连字符——它是概览路由 /<slug>/ 的 URL 片段，04-§七），实得 ${JSON.stringify(source.slug)}`,
      )
    }
    if (source.slug === 'legacy') {
      configInvalid(
        'overview/reserved-slug:legacy',
        'slug `legacy` 是概览面保留字（/legacy=旧版只读面回滚路由，DEV-12 换装起的既定占用）——请改公司目录 slug',
      )
    }
    if (registry.has(source.slug)) {
      configInvalid(`overview/duplicate-slug:${source.slug}`, `slug ${source.slug} 重复挂载（路由二义——每 slug 恰一家公司）`)
    }
    registry.set(source.slug, { source, cachedLedger: null })
  }

  const app: OverviewApp = new Hono()

  app.onError((err, c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.json({ error: 'internal', message: errText(err) }, 500)
    }
    return c.html(renderNotFoundPage(`内部错误：${errText(err)}`), 500)
  })
  app.notFound((c) => c.html(renderNotFoundPage(c.req.path), 404))

  /** 解析公司：未知 slug → undefined（404）；快照 slug 错位 → 抛错（onError 500 明报） */
  const resolveCompany = (slug: string): ResolvedCompany | undefined => {
    const runtime = registry.get(slug)
    if (runtime === undefined) return undefined
    const snapshot = runtime.source.snapshotProvider()
    if (snapshot.slug !== slug) {
      throw new Error(`slug 错位：路由 ${slug} 但快照 slug=${snapshot.slug}（wiring 错接——注册 slug 须与 org-config company.slug 一致）`)
    }
    let ledger: Ledger | undefined
    if (runtime.source.openLedger !== undefined) {
      if (runtime.cachedLedger === null) runtime.cachedLedger = runtime.source.openLedger()
      ledger = runtime.cachedLedger
    }
    return { snapshot, source: runtime.source, ledger }
  }

  /** 快照装载信息（快照时间标注——注入位缺省=undefined，JSON 面省略） */
  const infoOf = (source: OverviewCompanySource): SnapshotInfo | undefined => source.snapshotInfo?.()

  // ———— JSON 读面（换装页数据源；asOf=取数时刻，snapshotMeta=快照装载标注） ————

  app.get('/api/overview/companies', (c) => {
    const entries = [...registry.values()].map((rt) => {
      const snapshot = rt.source.snapshotProvider()
      if (snapshot.slug !== rt.source.slug) {
        throw new Error(`slug 错位：路由 ${rt.source.slug} 但快照 slug=${snapshot.slug}（wiring 错接——注册 slug 须与 org-config company.slug 一致）`)
      }
      return { slug: rt.source.slug, snapshot, mission: rt.source.mission, info: infoOf(rt.source) }
    })
    return c.json(buildCompaniesPayload(entries, Date.now()))
  })

  const apiCompany = (c: Context, build: (resolved: ResolvedCompany) => Response): Response => {
    const slug = c.req.param('slug') ?? '' // 路由参数必在（:slug 段非空）；宽化 Context 的联合类型收拢
    const resolved = resolveCompany(slug)
    if (resolved === undefined) return c.json({ error: 'unknown-slug', slug }, 404)
    return build(resolved)
  }

  app.get('/api/overview/:slug/snapshot', (c) =>
    apiCompany(c, (r) => c.json(buildCompanySnapshotPayload(r.source.slug, r.snapshot, r.source.mission, Date.now(), infoOf(r.source)))),
  )

  app.get('/api/overview/:slug/org', (c) => apiCompany(c, (r) => c.json(buildOrgPayload(r.source.slug, r.snapshot, Date.now(), infoOf(r.source)))))

  app.get('/api/overview/:slug/people', (c) => {
    const slug = c.req.param('slug')
    return apiCompany(c, (r) => {
      const readPersonFile = r.source.readPersonFile
      const hasBody = (personId: string): boolean => readPersonFile !== undefined && readPersonFile(personId) !== undefined
      return c.json(buildPeoplePayload(slug, r.snapshot, hasBody, Date.now(), infoOf(r.source)))
    })
  })

  app.get('/api/overview/:slug/people/:personId', (c) => {
    const slug = c.req.param('slug')
    const personId = c.req.param('personId')
    return apiCompany(c, (r) => {
      const person = r.snapshot.people.find((p) => p.id === personId)
      if (person === undefined) return c.json({ error: 'unknown-person', slug, personId }, 404)
      return c.json(buildPersonPayload(slug, person, r.source.readPersonFile?.(personId), Date.now(), infoOf(r.source)))
    })
  })

  app.get('/api/overview/:slug/progress', (c) => {
    const slug = c.req.param('slug')
    return apiCompany(c, (r) => {
      const progress = r.ledger === undefined ? null : buildProgressSnapshot(r.ledger.listTicketMirrors(), slug)
      return c.json(buildProgressPayload(slug, progress, Date.now(), infoOf(r.source)))
    })
  })

  app.get('/api/overview/:slug/finance', (c) =>
    apiCompany(c, (r) => {
      const finance =
        r.ledger === undefined
          ? null
          : buildFinanceSnapshot({
              slug: r.source.slug,
              budgets: r.ledger.listBudgets(),
              mirrors: r.ledger.listTicketMirrors(),
              peopleIds: new Set(r.snapshot.people.map((p) => p.id)),
              events: r.ledger.queryEvents({ company: r.source.slug }),
            })
      return c.json(buildFinancePayload(r.source.slug, finance, Date.now(), infoOf(r.source)))
    }),
  )

  // ———— 旧版回滚面（v0.7 首刀服务端渲染五读面整组迁此；退役评估归后续刀） ————

  app.get('/legacy', (c) => {
    const entries = [...registry.values()].map((rt) => ({ slug: rt.source.slug, snapshot: rt.source.snapshotProvider() }))
    return c.html(renderCompanyListPage(entries, OVERVIEW_LEGACY_BASE))
  })

  const legacyCard = (slug: string): { html: string; notFound: boolean } => {
    const resolved = resolveCompany(slug)
    if (resolved === undefined) return { html: renderNotFoundPage(`公司 ${slug}`, OVERVIEW_LEGACY_BASE), notFound: true }
    return { html: renderCompanyPage(slug, resolved.snapshot, resolved.source.mission, OVERVIEW_LEGACY_BASE), notFound: false }
  }
  app.get('/legacy/:slug/', (c) => {
    const r = legacyCard(c.req.param('slug'))
    return r.notFound ? c.html(r.html, 404) : c.html(r.html)
  })
  app.get('/legacy/:slug', (c) => {
    const r = legacyCard(c.req.param('slug'))
    return r.notFound ? c.html(r.html, 404) : c.html(r.html)
  })

  app.get('/legacy/:slug/org', (c) => {
    const slug = c.req.param('slug')
    const resolved = resolveCompany(slug)
    if (resolved === undefined) return c.html(renderNotFoundPage(`/${slug}/org`, OVERVIEW_LEGACY_BASE), 404)
    return c.html(renderOrgPage(slug, resolved.snapshot, OVERVIEW_LEGACY_BASE))
  })

  app.get('/legacy/:slug/people', (c) => {
    const slug = c.req.param('slug')
    const resolved = resolveCompany(slug)
    if (resolved === undefined) return c.html(renderNotFoundPage(`/${slug}/people`, OVERVIEW_LEGACY_BASE), 404)
    const readPersonFile = resolved.source.readPersonFile
    const hasBody = (personId: string): boolean => readPersonFile !== undefined && readPersonFile(personId) !== undefined
    return c.html(renderPeoplePage(slug, resolved.snapshot, hasBody, OVERVIEW_LEGACY_BASE))
  })

  app.get('/legacy/:slug/people/:personId', (c) => {
    const slug = c.req.param('slug')
    const personId = c.req.param('personId')
    const resolved = resolveCompany(slug)
    if (resolved === undefined) return c.html(renderNotFoundPage(`/${slug}/people/${personId}`, OVERVIEW_LEGACY_BASE), 404)
    const person = resolved.snapshot.people.find((p) => p.id === personId)
    if (person === undefined) return c.html(renderNotFoundPage(`工号 ${personId}`, OVERVIEW_LEGACY_BASE), 404)
    return c.html(renderPersonPage(slug, person, resolved.source.readPersonFile?.(personId), OVERVIEW_LEGACY_BASE))
  })

  app.get('/legacy/:slug/progress', (c) => {
    const slug = c.req.param('slug')
    const resolved = resolveCompany(slug)
    if (resolved === undefined) return c.html(renderNotFoundPage(`/${slug}/progress`, OVERVIEW_LEGACY_BASE), 404)
    const progress = resolved.ledger === undefined ? undefined : buildProgressSnapshot(resolved.ledger.listTicketMirrors(), slug)
    return c.html(renderProgressPage(slug, resolved.snapshot, progress, OVERVIEW_LEGACY_BASE))
  })

  app.get('/legacy/:slug/finance', (c) => {
    const slug = c.req.param('slug')
    const resolved = resolveCompany(slug)
    if (resolved === undefined) return c.html(renderNotFoundPage(`/${slug}/finance`, OVERVIEW_LEGACY_BASE), 404)
    const finance =
      resolved.ledger === undefined
        ? undefined
        : buildFinanceSnapshot({
            slug,
            budgets: resolved.ledger.listBudgets(),
            mirrors: resolved.ledger.listTicketMirrors(),
            peopleIds: new Set(resolved.snapshot.people.map((p) => p.id)),
            events: resolved.ledger.queryEvents({ company: slug }),
            reports: resolved.ledger.listReports({ company: slug, type: 'monthly' }),
            ...(resolved.source.readReportFile !== undefined ? { readReportFile: resolved.source.readReportFile } : {}),
          })
    return c.html(renderFinancePage(slug, resolved.snapshot, finance, OVERVIEW_LEGACY_BASE))
  })

  // ———— 换装面：单壳多页（SPA 按 pathname 切页；shell 纯函数零 IO） ————
  // 注册序纪律：本组 /:slug 参数路由必须最后注册——先于 /legacy 字面族会被 /:slug 吞掉
  // （Hono 按注册序匹配；本文件实际次序：JSON API → /legacy 族 → 本组 → 静态面）。

  // 根路径：公司清单（换装壳）
  app.get('/', (c) => c.html(renderOverviewShell('公司清单 · Studio Next 公司概览')))

  // 概览壳（/slug 与 /slug/ 同页——trailing slash 容忍；未知 slug 404 HTML）
  const shellCard = (slug: string): { html: string; notFound: boolean } => {
    const resolved = resolveCompany(slug)
    if (resolved === undefined) return { html: renderNotFoundPage(`公司 ${slug}`), notFound: true }
    return { html: renderOverviewShell(`${resolved.snapshot.name} · Studio Next 公司概览`), notFound: false }
  }
  app.get('/:slug/', (c) => {
    const r = shellCard(c.req.param('slug'))
    return r.notFound ? c.html(r.html, 404) : c.html(r.html)
  })
  app.get('/:slug', (c) => {
    const r = shellCard(c.req.param('slug'))
    return r.notFound ? c.html(r.html, 404) : c.html(r.html)
  })

  // tab 页同壳（org/people/progress/finance；未知 slug 404 HTML——路径即路由，SPA 自取数）
  const shellTab = (c: Context, slug: string): Response => {
    const r = shellCard(slug)
    return r.notFound ? c.html(r.html, 404) : c.html(r.html)
  }
  app.get('/:slug/org', (c) => shellTab(c, c.req.param('slug')))
  app.get('/:slug/people', (c) => shellTab(c, c.req.param('slug')))
  app.get('/:slug/progress', (c) => shellTab(c, c.req.param('slug')))
  app.get('/:slug/finance', (c) => shellTab(c, c.req.param('slug')))

  // 档案页同壳（未知工号 404 HTML——与旧版同判）
  app.get('/:slug/people/:personId', (c) => {
    const slug = c.req.param('slug')
    const personId = c.req.param('personId')
    const resolved = resolveCompany(slug)
    if (resolved === undefined) return c.html(renderNotFoundPage(`/${slug}/people/${personId}`), 404)
    if (resolved.snapshot.people.find((p) => p.id === personId) === undefined) {
      return c.html(renderNotFoundPage(`工号 ${personId}`), 404)
    }
    return c.html(renderOverviewShell(`${personId} 档案 · Studio Next 公司概览`))
  })

  // ———— 静态面（与 :8787 同套件：/vendor/:file 白名单 + /ui/* 目录服务） ————

  mountPanelStatic(app)

  return app
}

// —— 真监听壳（薄）：复用 :8787 的 node:http fetch 适配器（listenHono） ——

/** serveOverview 选项 */
export interface ServeOverviewOptions extends Omit<ListenHonoOptions, 'onClose' | 'label'> {
  /**
   * 台账库路径（可选）：给出则全部挂载公司共用（公司维=slug 分区——events/mirror/budgets
   * 都带公司 scope）；必须已存在（只读不代建库，与 servePanel 同纪律）。
   */
  ledgerPath?: string
}

/** serveOverview 返回句柄（同 :8787 PanelHandle 形状） */
export type OverviewHandle = HonoShellHandle

/**
 * 台账注入代理：活转发各字段（spread 会把热源的可选字段冻结成装载瞬间的值——
 * mission/档案映射须随热重载换新；openLedger 恒指向本壳打开的库，句柄归本壳）。
 */
function withLedger(source: OverviewCompanySource, ledger: Ledger): OverviewCompanySource {
  return {
    get slug() {
      return source.slug
    },
    snapshotProvider: () => source.snapshotProvider(),
    get mission() {
      return source.mission
    },
    get readPersonFile() {
      return source.readPersonFile
    },
    get snapshotInfo() {
      return source.snapshotInfo
    },
    openLedger: () => ledger,
  }
}

/**
 * 真监听壳：可选拆 ledgerPath（存在性闸 + openLedger 一次，句柄归本壳）→ createOverviewApp
 * → listenHono（label=overview）。close() 依次断连 → 关 server → 关 ledger（如有）。
 * 热源（reload.ts mountHotCompanySource）直接作 companies 传入即可——快照时间标注随
 * snapshotInfo 自动透出，目录监听的生命周期归 wiring 侧（bin.ts 收尾 close）。
 */
export async function serveOverview(
  port: number,
  companies: OverviewCompanySource[],
  opts?: ServeOverviewOptions,
): Promise<OverviewHandle> {
  const { ledgerPath, hostname } = opts ?? {}
  let ledger: Ledger | undefined
  if (ledgerPath !== undefined) {
    const resolved = path.resolve(ledgerPath)
    if (!existsSync(resolved)) {
      configInvalid(
        `overview/db-not-found:${resolved}`,
        `台账库不存在：${resolved}（overview 只读不代建库——先由 daemon/回填侧建库，或去掉 --db 以无台账面起）`,
      )
    }
    ledger = openLedger(resolved)
  }
  const injected = companies.map((source) => (ledger === undefined ? source : withLedger(source, ledger)))
  const app = createOverviewApp({ companies: injected })
  return listenHono(app, port, {
    ...(hostname !== undefined ? { hostname } : {}),
    label: 'overview',
    onClose: () => ledger?.close(),
  })
}
