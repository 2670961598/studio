/**
 * packages/api/src/types.ts —— 对外 API 的注入面与视图类型（API-01..16）
 *
 * 依据（实现单引用）：
 *   - plan/05 IMPL-06-07/08（只读族 API-01..09；触发/订阅族 API-10..16）；
 *   - docs/v2/14 §四（API- 端点族：GET 走只读投影、POST 走 PORT-GATE；只落单不派工；
 *     「API 进程零库零平台」；触发面公共槽 company｜requestKind｜dedupKey｜commissioner｜
 *     dispatcherAnchor｜body｜correlation；幂等键四槽；快照未命中=503；跨公司读写同一
 *     解析规则；凭证三档）；
 *   - docs/v2/15 §三 SEC-WD-01（写调用必带公司维、错绑 4xx）与 §五 SEC-RD-01（读面
 *     携带 readScope/callerContext）；SEC-FC-07（非测试装配 gated-only）；
 *   - docs/v2/16 §三 api 行（真实装配落 apps/daemon/src/assembly/api/；端点与视图序列化
 *     唯一源＝packages/api/src/）。
 *
 * 边界（类型即闸）：
 *   - 本件只定义 **API 响应视图** 与 **同进程注入契约**，不定义 PORT-/REC- 形状——
 *     端口形状唯一源仍是 `packages/contract/src/ports/`（v2/14 §二 F5 单点表）。
 *     `ApiObservationReadFace` 是 PORT-OBS 的 Pick 收窄（reportFault 等写槽不注入），
 *     `gate` 复用 `GatePort`；两者都不新增端口。
 *   - `ApiReadSources` 是装配面注入的**只读投影读取器**（数据来源＝PORT-OBS 投影/只读
 *     台账视图），不是库句柄：方法拿 `ReadContext`（公司维＋知悉范围＋调用者），返回
 *     已投影好的 API 视图或 `undefined`（源未命中）。API 进程因此不持 SQLite/平台句柄。
 *   - 注入面不出现 platform/ledger/db/engine/scheduler/launch/dispatch 槽——派工与收割
 *     是「显式不存在的第三级」（v2/14 §四），写面唯一经 `gate`（PORT-GATE）。
 *   - `IntentAuth` 的 `public` 档不在落单类型内（只读面专用）；触发面必须 partner/signed；
 *     `credentialClass='root'` 的凭据在 API 面一律拒绝（v2/15 §七 root 不入接口面）。
 */
import type { Hono } from 'hono'
import type {
  CallerRef,
  CompanyRef,
  GatePort,
  IntentAuth,
  ObservationPort,
  ProjectionState,
  ReadContext,
} from '@studio-next/contract'

/** PORT-OBS 只读子口（snapshot/clock/newId/health；reportFault 等写槽不注入） */
export type ApiObservationReadFace = Pick<ObservationPort, 'snapshot' | 'clock' | 'newId' | 'health'>

// ─────────────────────────────────────────────────────────────────────────────
// 一、只读族 API-01..09 的响应视图（白名单序列化；字段级最小面）
// ─────────────────────────────────────────────────────────────────────────────

/** 公司维视图（API-01；两槽与注入面同源，跨公司读隔离的比对键） */
export interface ApiCompanyView {
  readonly companyId: string
  readonly slug: string
  readonly name: string
  readonly platform?: string
  readonly description?: string
}

/** 组织部门行（API-02；只出组织平面事实，不出人员明细） */
export interface ApiOrgDepartmentView {
  readonly path: string
  readonly name: string
  readonly parent?: string
  readonly headcount?: number
  readonly relations?: readonly string[]
}

/** 组织树投影（API-02）：悬空/成环如实入 warnings，不静默补链 */
export interface ApiOrgView {
  /** 公司维（slug 或 companyId）；与挂载公司不符＝503 不服务（NEG-SEC-02） */
  readonly company: string
  readonly departments: readonly ApiOrgDepartmentView[]
  readonly warnings: readonly string[]
}

/** 聚合分组（API-03 people 默认只出聚合，不出花名册） */
export interface ApiPeopleGroup {
  readonly key: string
  readonly count: number
}

/** 人事聚合视图（API-03；无人员级明细槽——默认聚合是类型事实） */
export interface ApiPeopleView {
  readonly company: string
  readonly total: number
  readonly byDepartment: readonly ApiPeopleGroup[]
  readonly byLevel: readonly ApiPeopleGroup[]
  readonly byStatus?: readonly ApiPeopleGroup[]
}

/** 状态计数（项目卡/单据面共用） */
export interface ApiStateCount {
  readonly state: string
  readonly count: number
}

/** 项目卡（API-04） */
export interface ApiProjectView {
  readonly company: string
  readonly projectId: string
  readonly name: string
  readonly platform?: string
  readonly totalIssues?: number
  readonly byState?: readonly ApiStateCount[]
}

/** 单据读面单行（API-05；可重建投影的对外最小面） */
export interface ApiIssueView {
  readonly company: string
  readonly issueId: string
  readonly title: string
  readonly state: string
  readonly updatedAt?: string
  readonly assignee?: string
  readonly labels?: readonly string[]
}

/** 单据读面查询（limit 由路由夹取；state 精确过滤） */
export interface ApiIssueQuery {
  readonly state?: string
  readonly limit: number
  readonly cursor?: string
}

/** 单据读面分页（nextCursor 缺省＝末页，不是「可能还有」） */
export interface ApiIssuePage {
  readonly items: readonly ApiIssueView[]
  readonly nextCursor?: string
  readonly total?: number
}

/** 财务三源（API-06）：预算／事件／月报；缺一＝unknown，不补 0 */
export const FINANCE_SOURCES = ['budget', 'events', 'monthly'] as const
export type ApiFinanceSource = (typeof FINANCE_SOURCES)[number]

/**
 * 财务账段（API-06）。状态复用 PORT-OBS 六态值集（v2/09 ENU-52）：
 * 只有 observed/derived 允许携 `value`；unknown/stale/conflicted/gapped 不得有数值槽
 * （与 `MetricReading` 同判据——未知不显示为 0）。
 */
export interface ApiFinanceSegment {
  readonly source: ApiFinanceSource
  readonly state: ProjectionState
  readonly value?: number
  readonly unit?: string
  readonly stateNote?: string
  readonly lastTrustedCursor?: string
}

/** 财务摘要视图（API-06；三源逐段列示） */
export interface ApiFinanceView {
  readonly company: string
  readonly currency: string
  readonly window: Readonly<{ from: string; to: string }>
  readonly segments: readonly ApiFinanceSegment[]
}

/** 报表文件清单条目（API-07；只出清单，不出正文） */
export interface ApiReportEntry {
  readonly company: string
  readonly file: string
  readonly bytes?: number
  readonly generatedAt?: string
}

/** 端点规格（Agent Card 端点表；与 API_ENDPOINTS 同源） */
export interface ApiEndpointSpec {
  readonly id: string
  readonly method: 'GET' | 'POST' | 'GET|POST'
  readonly path: string
  readonly auth: 'none' | 'partner' | 'signed'
  readonly note: string
}

/** Agent Card 视图（API-09；公司定义生成，带版本与有效期） */
export interface ApiAgentCardView {
  /** 公司维（slug 或 companyId）；与挂载公司不符＝503 */
  readonly company: string
  readonly name: string
  readonly slug: string
  readonly version: string
  readonly validFrom: string
  readonly validUntil: string
  readonly description?: string
  readonly capabilities?: readonly string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、只读投影读取器（装配面注入；API 进程零库）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 只读投影读取器。每个方法都收 `ReadContext`：公司维＋知悉范围＋调用者随读必带
 * （SEC-RD-01 字段承载），装配侧据此在同进程内取 PORT-OBS 投影/只读台账视图。
 * `undefined`＝该视图源未命中/未提供（路由映射 503；不得以空对象冒充）。
 */
export interface ApiReadSources {
  company(rc: ReadContext): ApiCompanyView | undefined
  org(rc: ReadContext): ApiOrgView | undefined
  people(rc: ReadContext): ApiPeopleView | undefined
  projects(rc: ReadContext): readonly ApiProjectView[] | undefined
  issues(query: ApiIssueQuery, rc: ReadContext): ApiIssuePage | undefined
  finance(rc: ReadContext): ApiFinanceView | undefined
  reports(rc: ReadContext): readonly ApiReportEntry[] | undefined
  agentCard(rc: ReadContext): ApiAgentCardView | undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// 三、触发面认证（凭证目录/签名校验的注入位；API 不持秘密值表）
// ─────────────────────────────────────────────────────────────────────────────

/** 认证输入（方法/路径/头；payload 摘要由触发面自行计算） */
export interface ApiAuthInput {
  readonly method: string
  readonly path: string
  readonly headers: Headers
}

/** 凭据分级另轴（v2/15 §七 SEC-ROOT-01..05）：root 只由最高宰相持有、不入接口面 */
export type ApiCredentialClass = 'scoped' | 'root'

/**
 * 认证结果。成功＝给出 `IntentAuth`（partner/signed 两档，public 不在落单类型内）＋
 * 调用者身份；失败＝401/403＋机器可判定 subcause（fail-closed，不回落匿名）。
 */
export type ApiIntakeAuthResult =
  | {
      readonly ok: true
      readonly auth: IntentAuth
      readonly caller: CallerRef
      readonly credentialClass?: ApiCredentialClass
    }
  | {
      readonly ok: false
      readonly status: 401 | 403
      readonly subcause: string
      readonly detail?: string
    }

/** 触发面认证器（凭据目录条目校验/签名校验由装配侧实现；本包不存秘密值） */
export type ApiIntakeAuthenticator = (input: ApiAuthInput) => ApiIntakeAuthResult | Promise<ApiIntakeAuthResult>

// ─────────────────────────────────────────────────────────────────────────────
// 四、入站签名 hooks（API-15）与出站订阅（API-16）
// ─────────────────────────────────────────────────────────────────────────────

/** 一个已登记的入站 source（值经装配注入，不入仓；source 名进意图四槽） */
export interface ApiHookSource {
  readonly source: string
  /** HMAC-SHA256 验签 secret（运行时注入；禁止进日志/响应/台账） */
  readonly signingSecret: string
  /** 重放窗口/时间戳容差 ms（缺省 5 分钟；上限 1 小时） */
  readonly toleranceMs?: number
}

/** SSE 事件（id 用于断线续传与去重） */
export interface ApiEventFeedItem {
  readonly id: string
  readonly event: string
  readonly data: string
}

/** 一页事件（`after` 由 Last-Event-ID 提供；空页不得变成空流） */
export interface ApiEventFeedPage {
  readonly items: readonly ApiEventFeedItem[]
}

/** 事件源读取器（装配侧从 PORT-OBS/事件投影供给；API 不自开库） */
export interface ApiEventFeed {
  read(after: string | undefined, rc: ReadContext): ApiEventFeedPage | Promise<ApiEventFeedPage>
}

/** 出站订阅策略（allowlist 为空＝全部拒绝；SSRF 硬拒内网/回环） */
export interface ApiSubscriptionPolicy {
  readonly allowlist: readonly string[]
  readonly allowInsecureHttp?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// 五、应用装配面（同进程注入；无 platform/ledger/engine 槽）
// ─────────────────────────────────────────────────────────────────────────────

/** `createApiApp` 入参（fail-closed：缺任一必填槽＝构造期 CONFIG_INVALID） */
export interface ApiAppOptions {
  /** 本进程挂载公司维（SEC-WD-01；读写同一解析规则） */
  readonly company: CompanyRef
  /** PORT-OBS 只读子口（时钟/标识/投影读面；写槽不注入） */
  readonly obs: ApiObservationReadFace
  /** PORT-GATE gated 入口（写面唯一入口；裸 FlowPlatform 不满足 GatePort） */
  readonly gate: GatePort
  /** 只读投影读取器（API-01..07/09；零库，由装配侧供给） */
  readonly readers: ApiReadSources
  /** 触发面认证器（partner/signed；失败 fail-closed） */
  readonly auth: ApiIntakeAuthenticator
  /** 入站 hooks 登记表（缺省＝hooks 面 501 明报，不空转） */
  readonly hooks?: readonly ApiHookSource[]
  /** SSE 事件源（缺省＝/v1/events 501 带原因，禁空流） */
  readonly events?: ApiEventFeed
  /** 出站订阅策略（缺省＝/v1/subscriptions 501 明报） */
  readonly subscriptions?: ApiSubscriptionPolicy
  /** 装配日志出口（缺省 no-op；只作装配序证据） */
  readonly log?: (line: string) => void
}

/** 路由层可见的已校验依赖（app.ts 收窄后下发） */
export interface ApiRouteDeps {
  readonly company: CompanyRef
  readonly obs: ApiObservationReadFace
  readonly gate: GatePort
  readonly readers: ApiReadSources
  readonly auth: ApiIntakeAuthenticator
  readonly hooks: readonly ApiHookSource[]
  readonly events: ApiEventFeed | undefined
  readonly subscriptions: ApiSubscriptionPolicy | undefined
  readonly log: (line: string) => void
}

/** Hono 环境变量（traceId 由应用级中间件注入；错误体与审计同源） */
export interface ApiEnv {
  Variables: {
    traceId: string
  }
}

/** 对外 API 的 Hono 应用类型（测试用 `app.request()` 进程内驱动） */
export type ApiApp = Hono<ApiEnv>
