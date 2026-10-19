/**
 * external server —— :8788 对外 API 服务器层（v0.9 首刀：HTTP 信息/触发端点骨架）
 *
 * 依据：docs/16-§四 v0.9（mock 外部 agent 跑通「提需求→读进度」；名片带版本；**越权调用
 * 全部 fail-closed**）、docs/17-§8（:8788 端面）、docs/25-§4.2（EXTERNAL_AI_TOOLS 十名——
 * 对外 MCP 后续面；本刀 HTTP 骨架先行）、docs/00-§四 D4/D5/D6。
 *
 * 端面（信息端点全 GET 全公开——D5 人事全公开=信息面不限；触发端点凭证必带）：
 *   GET  /                     索引（service/version/端点清单——与 agent-card 端点表同源）
 *   GET  /v1/agent-card        名片（snapshot 生成：name/slug/version=框架版本/端点清单/联系位）
 *   GET  /v1/company           挂载公司清单（发现入口；?company= 取单家）
 *   GET  /v1/org?company=      组织树平面投影 + 悬空/成环 warns
 *   GET  /v1/people?company=   人事派工索引（PersonRef 直出）
 *   GET  /v1/projects          项目卡（N1 一公司一项目；镜像按状态聚合）
 *   GET  /v1/issues?state=&company=&limit=   ticket_mirror 读面（state 精确过滤）
 *   GET  /v1/finance?company=  成本三口径分列（复用 overview buildFinanceSnapshot——对齐 8787 口径）
 *   GET  /v1/reports?company=  报表文件清单（正文 v0 不出——待批）
 *   POST /v1/requests          外部需求落单（**只落单不派工**；X-SN-Token 必带；幂等键防重）
 *   GET  /v1/events            SSE 订阅 v0 占位（501——subscription 语义归后续刀）
 *
 * 越权三闸（全部 fail-closed，16-§四 验收口径）：
 *   ① 无凭证 401｜坏凭证 403｜令牌未配置=触发面全 401（不开后门）；
 *   ② 配额：IP 每分钟 N 次内存计数（N 可配缺省 30——D6 最小拟稿），超限 429；
 *   ③ 触发面只经注入的 platform.issues.create 一个写原语（类型面收窄，本包不碰 gateway/
 *      transition/comments——写闸归 daemon 装配）；未装配 platform 或台账 → 501 明报不静默。
 *
 * 幂等键（拟稿待批）：store kv 记 `external:idem:<slug>:<key>` → {issue, ts}（TTL 24h 读侧判）。
 * 同键重复 → 返回同单号且不再触平台；TTL 过期 → 视为 miss 可覆盖（重落新单）。
 *
 * 台账写纪律（头注待批）：本面信息端点对 SQLite 零写；触发端点的 kv 幂等记录是**唯一台账写点**
 * （daemon_kv 表 upsert）。仓纪律「daemon=台账唯一写入者」（02 F2）与本写点的并存方式两选一：
 * 生产装配把 :8788 挂进 daemon 进程（本面零跨进程写），或幂等面改独立存储——走批示流定夺。
 * ticket_mirror 同步不在本面：镜像归 daemon 采集相位（17-§2 权威源=平台活动流），本面落单后
 * 由主循环收进镜像，/v1/issues 因此最终一致（冒烟演示中以「模拟 daemon 采集」步骤呈现）。
 *
 * 注入纪律（与 :8787/:8789 同款）：panel 不 import company 包——snapshot 经 snapshotProvider
 * 注入；台账经 openLedger 工厂注入（懒调恰一次缓存，句柄归注入方）；报表清单经 listReports
 * 注入；触发写原语经 platform 注入（收窄面 ExternalPlatformWrite——FlowPlatform 结构兼容）。
 */
import { existsSync } from 'node:fs'
import { createHash, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import { Hono } from 'hono'
import { configInvalid } from '@studio-next/contract'
import { SLUG_RE } from '@studio-next/company'
import type { CompanySnapshot, IssueCreate, IssueRecord } from '@studio-next/contract'
import { openLedger, type Ledger, type TicketMirrorRecord } from '@studio-next/store'
import { MAX_PAGE_SIZE, listenHono, type HonoShellHandle, type ListenHonoOptions } from '../server.ts'
import { buildFinanceSnapshot } from '../overview/views.ts'
import {
  EXTERNAL_ENDPOINTS,
  FRAMEWORK_VERSION,
  REPORTS_BODY_NOTE,
  buildAgentCard,
  buildIdempotentValue,
  buildProjectCards,
  deptView,
  filterIssues,
  issueView,
  orgWarns,
  parseIdempotentValue,
  personView,
} from './views.ts'
import type { ReportFile } from './views.ts'

/** 单家挂载公司的数据源（全注入——panel 不直接碰公司目录/库文件/平台凭据） */
export interface ExternalCompanySource {
  /** 公司 slug（须与 snapshot.slug 一致——per-request 校验，错位即 500 明报） */
  slug: string
  /** 公司快照工厂（每请求调用——读面取当前目录状态；缓存策略归 wiring 侧） */
  snapshotProvider: () => CompanySnapshot
  /** 台账工厂（懒调恰一次并缓存；句柄归注入方管）；缺省=无台账（issues/finance 如实降级、触发面 501） */
  openLedger?: () => Ledger
  /** 报表目录文件清单（v0 只出清单不出正文）；缺省=未挂载报表面 */
  listReports?: () => ReportFile[]
  /** 名片联系位（拟稿注入位——org-config 无此字段，契约面增字段走批示） */
  contact?: string
}

/**
 * 触发面写原语（platform.issues.create 的收窄位）：写闸归 daemon 装配（gated-platform/
 * gateway 在 wiring 侧包好再注入），本包只声明「落单」一个动作——transition/comments 等写
 * 路径在类型面即不可达（fail-closed 的结构性一环，非自律）。
 */
export interface ExternalPlatformWrite {
  issues: { create(input: IssueCreate): Promise<IssueRecord> }
}

// —— 参数缺省（拟稿值均待批，见文件头注与各常量行注） ——

/** 配额缺省：IP 每分钟触发 30 次（D6「配额仅为防滥用」的最小面——拟稿） */
export const DEFAULT_REQUESTS_PER_MINUTE = 30
/** 配额窗口（固定窗，ms） */
export const QUOTA_WINDOW_MS = 60_000
/** 幂等键 TTL 缺省：24h（拟稿） */
export const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000
/** /v1/issues 缺省页大小（与 :8787 DEFAULT_PAGE_SIZE 同值） */
export const DEFAULT_EXTERNAL_PAGE_SIZE = 20
/** 请求体上限（字节；触发面防拉爆——Content-Length 预检） */
export const MAX_REQUEST_BODY_BYTES = 100_000
/** 令牌头（ports.yaml 拟稿键 X-SN-Token——25-§四 外围协议定稿后固化） */
export const TOKEN_HEADER = 'x-sn-token'
/** 客户端键头（监听壳从 socket 注入——见 ../server.ts toWebRequest；外部不可伪造） */
export const CLIENT_KEY_HEADER = 'x-sn-client-key'
/** 幂等 kv 键前缀（daemon_kv 命名空间：与 daemon 侧 'activity.cursor' 等既有键不撞） */
export const IDEMPOTENCY_KV_PREFIX = 'external:idem:'
/** 外部需求单类型（落单类型名——平台侧可见的来源标记） */
export const EXTERNAL_REQUEST_TYPE = '外部需求'

/** createExternalApp 选项 */
export interface ExternalAppOptions {
  companies: ExternalCompanySource[]
  /**
   * 触发面令牌（ports.yaml 拟稿键 X-SN-Token 的值位）。**缺省=触发面全 401**（fail-closed：
   * 令牌未配置不开后门）；空串视同未配置。
   */
  token?: string
  /** 触发面写原语（daemon 装配注入）；缺省=触发面 501（信息面不受影响） */
  platform?: ExternalPlatformWrite
  /** IP 每分钟触发上限（缺省 30——拟稿；非正整数落回缺省） */
  requestsPerMinute?: number
  /** 时钟（缺省 Date.now；测试注入） */
  now?: () => number
  /** 幂等键 TTL ms（缺省 24h——拟稿；非正数落回缺省） */
  idempotencyTtlMs?: number
}

/** createExternalApp 返回的 app 类型（Hono 实例；测试用 app.request() 进程内驱动） */
export type ExternalApp = Hono

/** 运行期注册表行：数据源 + 懒开缓存的 ledger */
interface CompanyRuntime {
  source: ExternalCompanySource
  cachedLedger: Ledger | null
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** slug 形状闸：SLUG_RE 单表（@studio-next/company validator——init/org-config/panel 共一张表，docs/43-附录A-4） */

/** 限数字符串长度的非空校验（触发面请求字段） */
function reqString(v: unknown, field: string, maxLen: number): string | { error: string } {
  if (typeof v !== 'string') return { error: `${field} 须为字符串` }
  const trimmed = v.trim()
  if (trimmed === '') return { error: `${field} 不得为空` }
  if (trimmed.length > maxLen) return { error: `${field} 长度超限（>${String(maxLen)} 字符）` }
  return trimmed
}

/** 令牌恒时比较（先 sha256 等长化再 timingSafeEqual——长度差不泄露） */
function tokenMatches(expected: string, presented: string): boolean {
  const a = createHash('sha256').update(expected).digest()
  const b = createHash('sha256').update(presented).digest()
  return timingSafeEqual(a, b)
}

/**
 * 对外 app 工厂。构造闸：companies 非空、slug 形状合法、无重复 slug（同 overview）。
 * per-request 闸：snapshot.slug 与注册 slug 错位 → 500 明报（wiring 错接）。
 * 公司解析规则：?company= 给出 → 必须在册（否则 404）；缺省 → 恰一家时自动选中、
 * 多家时 400 明示须给参（fail-closed：不静默取首家）。
 */
export function createExternalApp(opts: ExternalAppOptions): ExternalApp {
  if (opts.companies.length === 0) {
    configInvalid('external/no-companies', '对外面至少挂载一家公司（companies 为空——wiring 错接）')
  }
  const registry = new Map<string, CompanyRuntime>()
  for (const source of opts.companies) {
    if (!SLUG_RE.test(source.slug)) {
      configInvalid(
        `external/bad-slug:${source.slug}`,
        `slug 必须形如 my-corp（小写字母/数字/连字符），实得 ${JSON.stringify(source.slug)}`,
      )
    }
    if (registry.has(source.slug)) {
      configInvalid(`external/duplicate-slug:${source.slug}`, `slug ${source.slug} 重复挂载（路由二义——每 slug 恰一家公司）`)
    }
    registry.set(source.slug, { source, cachedLedger: null })
  }

  const token = typeof opts.token === 'string' && opts.token !== '' ? opts.token : undefined
  const perMinute =
    opts.requestsPerMinute !== undefined && Number.isInteger(opts.requestsPerMinute) && opts.requestsPerMinute > 0
      ? opts.requestsPerMinute
      : DEFAULT_REQUESTS_PER_MINUTE
  const now = opts.now ?? ((): number => Date.now())
  const ttlMs =
    opts.idempotencyTtlMs !== undefined && Number.isInteger(opts.idempotencyTtlMs) && opts.idempotencyTtlMs > 0
      ? opts.idempotencyTtlMs
      : DEFAULT_IDEMPOTENCY_TTL_MS

  // —— 配额（IP 每分钟固定窗内存计数——D6 最小面；跨进程/持久归后续刀） ——
  interface QuotaWindow {
    start: number
    count: number
  }
  const quotaWindows = new Map<string, QuotaWindow>()
  const takeQuota = (clientKey: string): { allowed: boolean; retryAfterMs: number } => {
    const t = now()
    if (quotaWindows.size > 4096) {
      // 机会式清扫过期窗（防键空间无界增长；活性键不受影响）
      for (const [key, win] of quotaWindows) {
        if (t - win.start >= QUOTA_WINDOW_MS) quotaWindows.delete(key)
      }
    }
    let win = quotaWindows.get(clientKey)
    if (win === undefined || t - win.start >= QUOTA_WINDOW_MS) {
      win = { start: t, count: 0 }
      quotaWindows.set(clientKey, win)
    }
    if (win.count >= perMinute) {
      return { allowed: false, retryAfterMs: QUOTA_WINDOW_MS - (t - win.start) }
    }
    win.count += 1
    return { allowed: true, retryAfterMs: 0 }
  }

  const app: ExternalApp = new Hono()

  app.onError((err, c) => c.json({ ok: false, code: 'INTERNAL', error: errText(err) }, 500))
  app.notFound((c) => c.json({ ok: false, code: 'NOT_FOUND', error: `未知端点：${c.req.method} ${c.req.path}` }, 404))

  /** 公司解析（见工厂头注规则）；不在册=undefined；快照 slug 错位=抛错（onError 500） */
  const resolveCompany = (slug: string | undefined): CompanyRuntime | undefined | 'ambiguous' => {
    if (slug !== undefined) return registry.get(slug)
    if (registry.size === 1) return registry.values().next().value
    return 'ambiguous'
  }
  const ledgerOf = (rt: CompanyRuntime): Ledger | undefined => {
    if (rt.source.openLedger === undefined) return undefined
    if (rt.cachedLedger === null) rt.cachedLedger = rt.source.openLedger()
    return rt.cachedLedger
  }
  /** 快照装载 + slug 错位闸（各消费 snapshotProvider 的端点统一走此闸——错位=500 明报） */
  const snapshotOf = (rt: CompanyRuntime): CompanySnapshot => {
    const snapshot = rt.source.snapshotProvider()
    if (snapshot.slug !== rt.source.slug) {
      throw new Error(`slug 错位：注册 ${rt.source.slug} 但快照 slug=${snapshot.slug}（wiring 错接——注册 slug 须与 org-config company.slug 一致）`)
    }
    return snapshot
  }
  /** scoped 端点的公司解析三态归一：404（未挂载）/400（多家未给参）/成功 */
  const scoped = (c: { req: { query: (k: string) => string | undefined } }): { rt: CompanyRuntime; slug: string } | { json: { status: number; body: unknown } } => {
    const rt = resolveCompany(c.req.query('company'))
    if (rt === undefined) {
      return { json: { status: 404, body: { ok: false, code: 'UNKNOWN_COMPANY', error: `公司未挂载：${c.req.query('company') ?? ''}` } } }
    }
    if (rt === 'ambiguous') {
      return {
        json: {
          status: 400,
          body: { ok: false, code: 'COMPANY_REQUIRED', error: `多家公司挂载，须给 ?company=<slug>（候选：${[...registry.keys()].join('、')}）` },
        },
      }
    }
    snapshotOf(rt) // slug 错位闸（抛错 → onError 500）
    return { rt, slug: rt.source.slug }
  }
  const clampLimit = (raw: string | undefined): number => {
    const parsed = Number.parseInt(raw ?? '', 10)
    if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_EXTERNAL_PAGE_SIZE
    return Math.min(parsed, MAX_PAGE_SIZE)
  }
  /**
   * 镜像收集（/v1/projects 与 /v1/issues 共用）：按**台账实例**去重（多司共享一库时
   * flatMap 会重复拉同一份行），再滤到挂载公司集——未挂载公司的镜像行不经本面外露。
   */
  const collectMirrors = (runtimes: ReadonlyArray<CompanyRuntime>): TicketMirrorRecord[] => {
    const seenLedgers = new Set<Ledger>()
    const rows: TicketMirrorRecord[] = []
    const slugs = new Set(runtimes.map((rt) => rt.source.slug))
    for (const rt of runtimes) {
      const l = ledgerOf(rt)
      if (l === undefined || seenLedgers.has(l)) continue
      seenLedgers.add(l)
      rows.push(...l.listTicketMirrors())
    }
    return rows.filter((m) => slugs.has(m.company))
  }

  // —— 信息端点（全公开：D5 人事全公开=信息面不限） ——

  // 索引（端点清单与 agent-card.endpoints 同源——EXTERNAL_ENDPOINTS 单一事实源）
  app.get('/', (c) => c.json({ ok: true, service: 'studio-next external api', version: FRAMEWORK_VERSION, endpoints: EXTERNAL_ENDPOINTS }))

  app.get('/v1/agent-card', (c) => {
    const picked = scoped(c)
    if ('json' in picked) return c.json(picked.json.body as object, picked.json.status as 400 | 404)
    const snapshot = snapshotOf(picked.rt)
    return c.json({
      ok: true,
      card: buildAgentCard(snapshot, {
        ...(picked.rt.source.contact !== undefined ? { contact: picked.rt.source.contact } : {}),
      }),
    })
  })

  app.get('/v1/company', (c) => {
    const wanted = c.req.query('company')
    const sources = wanted !== undefined ? [registry.get(wanted)].filter((v): v is CompanyRuntime => v !== undefined) : [...registry.values()]
    if (wanted !== undefined && sources.length === 0) {
      return c.json({ ok: false, code: 'UNKNOWN_COMPANY', error: `公司未挂载：${wanted}` }, 404)
    }
    const companies = sources.map((rt) => {
      const s = snapshotOf(rt)
      return {
        slug: s.slug,
        name: s.name,
        level: s.level,
        charter_ref: s.charter,
        platform: s.platform.platform,
        departments: s.departments.length,
        people: s.people.length,
        jobs: s.jobs.length,
      }
    })
    return c.json({ ok: true, count: companies.length, companies })
  })

  app.get('/v1/org', (c) => {
    const picked = scoped(c)
    if ('json' in picked) return c.json(picked.json.body as object, picked.json.status as 400 | 404)
    const snapshot = snapshotOf(picked.rt)
    return c.json({
      ok: true,
      company: picked.slug,
      departments: snapshot.departments.map(deptView),
      warns: orgWarns(snapshot),
    })
  })

  app.get('/v1/people', (c) => {
    const picked = scoped(c)
    if ('json' in picked) return c.json(picked.json.body as object, picked.json.status as 400 | 404)
    const snapshot = snapshotOf(picked.rt)
    return c.json({ ok: true, company: picked.slug, count: snapshot.people.length, people: snapshot.people.map(personView) })
  })

  app.get('/v1/projects', (c) => {
    const company = c.req.query('company')
    const runtimes = company !== undefined ? [registry.get(company)].filter((v): v is CompanyRuntime => v !== undefined) : [...registry.values()]
    if (company !== undefined && runtimes.length === 0) {
      return c.json({ ok: false, code: 'UNKNOWN_COMPANY', error: `公司未挂载：${company}` }, 404)
    }
    const mirrors = collectMirrors(runtimes)
    const snapshots = runtimes.map((rt) => snapshotOf(rt))
    return c.json({ ok: true, projects: buildProjectCards(snapshots, mirrors) })
  })

  app.get('/v1/issues', (c) => {
    const company = c.req.query('company')
    const runtimes = company !== undefined ? [registry.get(company)].filter((v): v is CompanyRuntime => v !== undefined) : [...registry.values()]
    if (company !== undefined && runtimes.length === 0) {
      return c.json({ ok: false, code: 'UNKNOWN_COMPANY', error: `公司未挂载：${company}` }, 404)
    }
    const mirrors = collectMirrors(runtimes)
    if (runtimes.every((rt) => rt.source.openLedger === undefined)) {
      return c.json({ ok: true, count: mirrors.length, issues: mirrors.map(issueView), note: '无台账数据（openLedger 未注入——挂载 --db 后可读）' })
    }
    const state = c.req.query('state')
    const rows = filterIssues(mirrors, { ...(state !== undefined ? { state } : {}), limit: clampLimit(c.req.query('limit')) })
    return c.json({ ok: true, count: rows.length, issues: rows.map(issueView) })
  })

  app.get('/v1/finance', (c) => {
    const picked = scoped(c)
    if ('json' in picked) return c.json(picked.json.body as object, picked.json.status as 400 | 404)
    const ledger = ledgerOf(picked.rt)
    if (ledger === undefined) {
      return c.json({ ok: true, company: picked.slug, finance: null, note: '无台账数据（openLedger 未注入）' })
    }
    const snapshot = snapshotOf(picked.rt)
    const finance = buildFinanceSnapshot({
      slug: picked.slug,
      budgets: ledger.listBudgets(),
      mirrors: ledger.listTicketMirrors(),
      peopleIds: new Set(snapshot.people.map((p) => p.id)),
      events: ledger.queryEvents({ company: picked.slug }),
    })
    return c.json({ ok: true, company: picked.slug, finance })
  })

  app.get('/v1/reports', (c) => {
    const picked = scoped(c)
    if ('json' in picked) return c.json(picked.json.body as object, picked.json.status as 400 | 404)
    const listReports = picked.rt.source.listReports
    if (listReports === undefined) {
      return c.json({ ok: true, company: picked.slug, reports: [], note: '未挂载报表面（listReports 未注入）' })
    }
    const reports = listReports()
    return c.json({ ok: true, company: picked.slug, count: reports.length, reports, note: REPORTS_BODY_NOTE })
  })

  // SSE 订阅 v0 占位（subscription 语义归后续刀——头注待批：游标形态/事件过滤面/断线续传）
  app.get('/v1/events', (c) =>
    c.json(
      {
        ok: false,
        code: 'NOT_IMPLEMENTED',
        error: 'SSE 订阅 v0 占位（events.subscribe 语义归后续刀——25-§4.2 EXTERNAL_AI_TOOLS 十名冻结，本刀只做 HTTP 信息/触发端点骨架）',
      },
      501,
    ),
  )

  // —— 触发端点（凭证必带——三闸顺序：鉴权 → 配额 → 装配就绪 → 入参 → 幂等 → 落单） ——

  app.post('/v1/requests', async (c) => {
    // ① 鉴权（fail-closed：未配令牌=全 401；无头 401；坏令牌 403）
    if (token === undefined) {
      return c.json({ ok: false, code: 'UNAUTHENTICATED', error: '触发面未配置令牌（fail-closed：全部拒绝——配 --token 启用）' }, 401)
    }
    const presented = c.req.header(TOKEN_HEADER)
    if (presented === undefined || presented === '') {
      return c.json({ ok: false, code: 'UNAUTHENTICATED', error: `缺少 ${TOKEN_HEADER} 头（触发面凭证必带）` }, 401)
    }
    if (!tokenMatches(token, presented)) {
      return c.json({ ok: false, code: 'FORBIDDEN', error: '令牌不匹配' }, 403)
    }

    // ② 配额（按客户端键固定窗计数；仅计过鉴权的触发尝试——401/403 不耗配额）
    const clientKey = c.req.header(CLIENT_KEY_HEADER) ?? 'unknown'
    const quota = takeQuota(clientKey)
    if (!quota.allowed) {
      return c.json(
        {
          ok: false,
          code: 'RATE_LIMITED',
          error: `触发过于频繁（每分钟 ${String(perMinute)} 次——D6 配额防滥用）`,
          limit: perMinute,
          windowMs: QUOTA_WINDOW_MS,
          retryAfterMs: quota.retryAfterMs,
        },
        429,
      )
    }

    // ③ 装配就绪（platform + 台账缺一即 501 明报——不静默降级为「可读不可写」的半触发面）
    const picked = scoped(c)
    if ('json' in picked) return c.json(picked.json.body as object, picked.json.status as 400 | 404)
    const platform = opts.platform
    const ledger = ledgerOf(picked.rt)
    if (platform === undefined || ledger === undefined) {
      return c.json(
        { ok: false, code: 'TRIGGER_UNAVAILABLE', error: `触发面未装配（${platform === undefined ? 'platform' : '台账'}未注入——只落单不派工的写原语归 daemon 装配）` },
        501,
      )
    }

    // ④ 入参（Content-Length 预检 + JSON 解析 + 三字段校验）
    const contentLength = Number.parseInt(c.req.header('content-length') ?? '', 10)
    if (Number.isInteger(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
      return c.json({ ok: false, code: 'PAYLOAD_TOO_LARGE', error: `请求体超限（>${String(MAX_REQUEST_BODY_BYTES)} 字节）` }, 413)
    }
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, code: 'BAD_REQUEST', error: '请求体不是合法 JSON' }, 400)
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return c.json({ ok: false, code: 'BAD_REQUEST', error: '请求体须为 JSON 对象 {title, body, idempotencyKey}' }, 400)
    }
    const raw = body as Record<string, unknown>
    const title = reqString(raw['title'], 'title', 500)
    if (typeof title === 'object') return c.json({ ok: false, code: 'BAD_REQUEST', error: title.error }, 400)
    const reqBody = reqString(raw['body'], 'body', 20_000)
    if (typeof reqBody === 'object') return c.json({ ok: false, code: 'BAD_REQUEST', error: reqBody.error }, 400)
    const idemKey = reqString(raw['idempotencyKey'], 'idempotencyKey', 200)
    if (typeof idemKey === 'object') return c.json({ ok: false, code: 'BAD_REQUEST', error: idemKey.error }, 400)

    // ⑤ 幂等（同键且未过期 → 返回同单号，不再触平台；kv 坏值=miss 覆盖——见 views.parseIdempotentValue）
    const kvKey = `${IDEMPOTENCY_KV_PREFIX}${picked.slug}:${idemKey}`
    const existing = parseIdempotentValue(ledger.kvGet(kvKey))
    if (existing !== undefined && now() - existing.ts <= ttlMs) {
      return c.json({
        ok: true,
        request: { issue: existing.issue, company: picked.slug, type: EXTERNAL_REQUEST_TYPE, idempotent: true },
      })
    }

    // ⑥ 落单（只落单不派工：唯一写原语 platform.issues.create；派工归 daemon 主循环）
    let record: IssueRecord
    try {
      record = await platform.issues.create({ title, description: reqBody, type: EXTERNAL_REQUEST_TYPE })
    } catch (err) {
      return c.json({ ok: false, code: 'PLATFORM_ERROR', error: `落单失败：${errText(err)}` }, 502)
    }
    ledger.kvSet(kvKey, buildIdempotentValue(record.id, now()))
    return c.json(
      {
        ok: true,
        request: {
          issue: record.id,
          title: record.title,
          state: record.state,
          type: record.type ?? EXTERNAL_REQUEST_TYPE,
          company: picked.slug,
          idempotent: false,
        },
      },
      201,
    )
  })

  return app
}

// —— 真监听壳（薄）：复用共用 listenHono（node:http fetch 适配器含请求体转发与 SSE 流式回写） ——

/** serveExternal 选项 */
export interface ServeExternalOptions extends Omit<ListenHonoOptions, 'onClose' | 'label'> {
  /** 台账库路径（可选）：给出则全部挂载公司共用；**必须已存在**（触发面 kv 写入不代建库——先由 daemon 建库） */
  ledgerPath?: string
  /** 触发面令牌（缺省=触发面全 401） */
  token?: string
  /** 触发面写原语（daemon 装配注入；缺省=触发面 501） */
  platform?: ExternalPlatformWrite
  /** IP 每分钟触发上限（缺省 30） */
  requestsPerMinute?: number
  /** 时钟（测试注入） */
  now?: () => number
  /** 幂等键 TTL ms（缺省 24h） */
  idempotencyTtlMs?: number
}

/** serveExternal 返回句柄（同 :8787/:8789 形状） */
export type ExternalHandle = HonoShellHandle

/**
 * 真监听壳：可选拆 ledgerPath（存在性闸 + openLedger 一次）→ createExternalApp → listenHono
 * （label=external）。绑定面（D4 拟稿反转说明）：缺省 **127.0.0.1**——D4 的「默认局域网」是
 * 部署意图，安全缺省取只绑本机，对局域网开放须显式 hostname: '0.0.0.0'（bin --lan 旗标）。
 * close() 依次：断全部连接 → 关 server → 关 ledger（如有）。
 */
export async function serveExternal(
  port: number,
  companies: ExternalCompanySource[],
  opts?: ServeExternalOptions,
): Promise<ExternalHandle> {
  const { ledgerPath, token, platform, requestsPerMinute, now, idempotencyTtlMs, hostname } = opts ?? {}
  let ledger: Ledger | undefined
  if (ledgerPath !== undefined) {
    const resolved = path.resolve(ledgerPath)
    if (!existsSync(resolved)) {
      configInvalid(
        `external/db-not-found:${resolved}`,
        `台账库不存在：${resolved}（external 不代建库——先由 daemon/回填侧建库，或去掉 --db 以只读面起）`,
      )
    }
    ledger = openLedger(resolved)
  }
  const injected = companies.map((source) =>
    ledger === undefined ? source : { ...source, openLedger: () => ledger as Ledger },
  )
  const app = createExternalApp({
    companies: injected,
    ...(token !== undefined ? { token } : {}),
    ...(platform !== undefined ? { platform } : {}),
    ...(requestsPerMinute !== undefined ? { requestsPerMinute } : {}),
    ...(now !== undefined ? { now } : {}),
    ...(idempotencyTtlMs !== undefined ? { idempotencyTtlMs } : {}),
  })
  return listenHono(app, port, {
    ...(hostname !== undefined ? { hostname } : {}),
    label: 'external',
    onClose: () => ledger?.close(),
  })
}
