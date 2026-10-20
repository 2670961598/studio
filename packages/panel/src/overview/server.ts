/**
 * overview server —— :8789 公司概览面服务器层（v0.7 首刀：读面）
 *
 * 依据：docs/16-§四 v0.7（公司面 :8789/<slug>/ 可看组织/人事/财务/进度——编辑中心归后续刀）、
 * docs/04-§七（概览路由按公司目录 slug：/<slug>/... 直达、未知名 404、根路径列公司清单）、
 * docs/17-§8（:8789 端面）与 §1（公司目录=组织事实源）。
 *
 * 端面（全部 GET、全部只读，无任何写路径；全 HTML 服务端渲染零前端依赖）：
 *   GET /                        公司清单（多公司时按 slug 列出，04-§七）
 *   GET /<slug>/  | /<slug>      概览卡：公司名/等级/使命/部门数/人数/平台绑定（snapshot）
 *   GET /<slug>/org              组织树：部门嵌套树（parent 链）+ 各部 leader/lanes/functions
 *   GET /<slug>/people           人事列表：PersonRef 表（工号/姓名/login/等级/部门）+ 档案正文链接
 *   GET /<slug>/people/<工号>    人事档案：md 原文渲染为 pre 块（01-C2-04；转义后进 pre）
 *   GET /<slug>/progress         进度：ticket_mirror 按状态聚合计数（有 ledger 时）
 *   GET /<slug>/finance          财务：budgets 三口径分列 + 事件 LLM 成本按日 + 月报段
 *                                （reports 表 type='monthly' + json_ref 快照 headline，有 ledger 时）
 *   未注册 slug / 未知工号 / 未知子路径 → 404 HTML 页
 *
 * 注入纪律（与 :8787 createPanelApp 同款）：panel 不 import company 包——组织数据经
 * snapshotProvider 注入（() => CompanySnapshot，wiring 侧用 loadCompanyDirectory 装载），
 * 档案正文经 readPersonFile 注入，报表快照经 readReportFile 注入（json_ref → JSON 正文），
 * 台账经 openLedger 工厂注入（懒调恰一次并缓存，句柄归注入方）。
 * 无 ledger 的公司：progress/finance 两页如实显示「无台账数据」，不臆造空聚合。
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
import { Hono } from 'hono'
import { configInvalid } from '@studio-next/contract'
import { SLUG_RE } from '@studio-next/company'
import type { CompanySnapshot } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { listenHono, type HonoShellHandle, type ListenHonoOptions } from '../server.ts'
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
  /** 概览路由 slug（04-§七；须与 snapshot.slug 一致——per-request 校验，错位即 500 明报） */
  slug: string
  /** 公司快照工厂（每请求调用——读面取当前目录状态；重读或缓存归 wiring 侧定夺） */
  snapshotProvider: () => CompanySnapshot
  /** 使命（可选注入位——契约快照无此字段，拟稿见文件头注） */
  mission?: string
  /** 人事档案原文读取（工号 → md 全文）；缺省=无档案正文（people 页不出现档案链接） */
  readPersonFile?: (personId: string) => string | undefined
  /** 报表快照原文读取（公司目录相对 json_ref → JSON 全文）；缺省=finance 页月报行「快照不可读」 */
  readReportFile?: (jsonRef: string) => string | undefined
  /** 台账工厂（懒调恰一次并缓存；句柄归注入方管）；缺省=无台账（progress/finance 降级面） */
  openLedger?: () => Ledger
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
 * 公司概览 app 工厂。构造闸：companies 非空、slug 形状合法、无重复 slug（重复=路由二义，
 * 拒启不静默取先）。per-request 闸：snapshot.slug 与注册 slug 错位 → 抛错 500（wiring 错接，
 * 如实明报）。snapshotProvider 每请求直调（目录变更下一请求即见——读面无缓存语义）。
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
    if (registry.has(source.slug)) {
      configInvalid(`overview/duplicate-slug:${source.slug}`, `slug ${source.slug} 重复挂载（路由二义——每 slug 恰一家公司）`)
    }
    registry.set(source.slug, { source, cachedLedger: null })
  }

  const app: OverviewApp = new Hono()

  app.onError((err, c) => c.html(renderNotFoundPage(`内部错误：${errText(err)}`), 500))
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

  // 根路径：公司清单（04-§七）
  app.get('/', (c) => {
    const entries = [...registry.values()].map((rt) => ({ slug: rt.source.slug, snapshot: rt.source.snapshotProvider() }))
    return c.html(renderCompanyListPage(entries))
  })

  // 概览卡（/slug 与 /slug/ 同页——trailing slash 容忍）
  const companyCard = (slug: string): { html: string; notFound: boolean } => {
    const resolved = resolveCompany(slug)
    if (resolved === undefined) return { html: renderNotFoundPage(`公司 ${slug}`), notFound: true }
    return { html: renderCompanyPage(slug, resolved.snapshot, resolved.source.mission), notFound: false }
  }
  app.get('/:slug/', (c) => {
    const r = companyCard(c.req.param('slug'))
    return r.notFound ? c.html(r.html, 404) : c.html(r.html)
  })
  app.get('/:slug', (c) => {
    const r = companyCard(c.req.param('slug'))
    return r.notFound ? c.html(r.html, 404) : c.html(r.html)
  })

  // 组织树：部门嵌套 + 悬空/成环诚实标记
  app.get('/:slug/org', (c) => {
    const slug = c.req.param('slug')
    const resolved = resolveCompany(slug)
    if (resolved === undefined) return c.html(renderNotFoundPage(`/${slug}/org`), 404)
    return c.html(renderOrgPage(slug, resolved.snapshot))
  })

  // 人事列表：PersonRef 表 + 档案正文链接（仅正文可读者）
  app.get('/:slug/people', (c) => {
    const slug = c.req.param('slug')
    const resolved = resolveCompany(slug)
    if (resolved === undefined) return c.html(renderNotFoundPage(`/${slug}/people`), 404)
    const readPersonFile = resolved.source.readPersonFile
    const hasBody = (personId: string): boolean => readPersonFile !== undefined && readPersonFile(personId) !== undefined
    return c.html(renderPeoplePage(slug, resolved.snapshot, hasBody))
  })

  // 人事档案：md 原文进 pre 块（转义后）；未知工号 404；在册但正文缺失 → 如实说明页
  app.get('/:slug/people/:personId', (c) => {
    const slug = c.req.param('slug')
    const personId = c.req.param('personId')
    const resolved = resolveCompany(slug)
    if (resolved === undefined) return c.html(renderNotFoundPage(`/${slug}/people/${personId}`), 404)
    const person = resolved.snapshot.people.find((p) => p.id === personId)
    if (person === undefined) return c.html(renderNotFoundPage(`工号 ${personId}`), 404)
    return c.html(renderPersonPage(slug, person, resolved.source.readPersonFile?.(personId)))
  })

  // 进度：ticket_mirror 按状态聚合（有 ledger 时；无 ledger 如实降级）
  app.get('/:slug/progress', (c) => {
    const slug = c.req.param('slug')
    const resolved = resolveCompany(slug)
    if (resolved === undefined) return c.html(renderNotFoundPage(`/${slug}/progress`), 404)
    const progress = resolved.ledger === undefined ? undefined : buildProgressSnapshot(resolved.ledger.listTicketMirrors(), slug)
    return c.html(renderProgressPage(slug, resolved.snapshot, progress))
  })

  // 财务：budgets 三口径分列 + LLM 成本按日 + 月报段（reports 表 type='monthly' +
  // json_ref 快照 headline——04-§三渲染约定；有 ledger 时；无 ledger 如实降级）
  app.get('/:slug/finance', (c) => {
    const slug = c.req.param('slug')
    const resolved = resolveCompany(slug)
    if (resolved === undefined) return c.html(renderNotFoundPage(`/${slug}/finance`), 404)
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
    return c.html(renderFinancePage(slug, resolved.snapshot, finance))
  })

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
 * 真监听壳：可选拆 ledgerPath（存在性闸 + openLedger 一次，句柄归本壳）→ createOverviewApp
 * → listenHono（label=overview）。close() 依次断连 → 关 server → 关 ledger（如有）。
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
  const injected = companies.map((source) =>
    ledger === undefined ? source : { ...source, openLedger: () => ledger as Ledger },
  )
  const app = createOverviewApp({ companies: injected })
  return listenHono(app, port, {
    ...(hostname !== undefined ? { hostname } : {}),
    label: 'overview',
    onClose: () => ledger?.close(),
  })
}
