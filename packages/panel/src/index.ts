/**
 * Studio Next · panel —— 面板（:8787 监控面已落地；:8789 公司概览 v0.7 首刀已落地——独立入口 ./overview）
 *
 * 定位（docs/17-§8，需求 C1/C3）：两面分端口，口径分离、共用台账不共用报表（F3-07）。
 *
 *   :8787 框架监控（机器的温度计，内部）—— v0.3 首刀 + 全量口径补齐（docs/16-§四、17-§8）：
 *     端面全 GET 全只读：/api/health、/api/jobs（due 标记）、/api/runs（在途优先）、
 *     /api/workers（v0 台账聚合口径）、/api/events（queryEvents 包装：company/issue/
 *     order=desc/event= 四维）、/api/events/stream（SSE 轮询新事件，Last-Event-ID 续传）、
 *     /api/snapshot、/api/breakers（断路器告警：CIRCUIT_BREAK 族事件 (单号,签名) 聚合）、
 *     /api/costs（成本趋势：LLM 岛/收割/预算三类按 UTC 日分列——docs/26 C1 展示面）、
 *     /（Vue 页壳：importmap + /ui/main.js——Naive UI + ECharts 换装，docs/37-§5.1 路线 I；
 *     旧单页迁 /legacy 保回滚）、/vendor/:file 与 /ui/*（静态面，static.ts）。
 *     数据全部读 SQLite 台账（WAL 单写多读，panel 零写）；漂移告警待 daemon 侧判据冻结。
 *
 *   :8789 公司概览（老板的公司，制作人/内部）—— v0.7 首刀 + DEV-12 换装刀二（读面，独立入口
 *     ./overview——packages/panel/src/overview/，不另开包：沿 16-§一 九包结构）：
 *     路由 /<slug>/…（04-§七：按挂载公司目录 slug，未出名 404，根路径列公司清单）；
 *     概览/组织/人事/进度/财务五读面（全 GET 只读）；刀二起换装同套 :8787（Naive UI +
 *     ECharts，单壳多页 + /api/overview/* JSON 读面），旧服务端渲染面整组迁 /legacy 作回滚面；
 *     热重载双能力（reload.ts）：快照时间标注（snapshotMeta 随 JSON 读面透出）+ 公司目录
 *     fs.watch(recursive) 防抖热重载（重载失败保旧图）。项目/报表 tab 与编辑中心归后续刀。
 *
 *   :8788 对外 API（外部 AI 的面，对外）—— v0.9 首刀（信息/触发骨架，独立入口 ./external）：
 *     信息端点全 GET 全公开（D5：company/org/people/projects/issues/finance/reports）；
 *     触发端点 POST /v1/requests（X-SN-Token 必带，只落单不派工，幂等键防重，IP 配额 429）；
 *     /v1/agent-card（名片带版本）+ SSE 订阅 v0 占位（501）。越权调用全部 fail-closed。
 *
 * 实现纪律：Hono + streamSSE（浏览器自动重连，不引 WebSocket）；纯函数层（views.ts）
 * 与服务器层（server.ts）分离——app.fetch() 进程内可测，serve* 是薄监听壳
 * （listenHono 共用件：:8787/:8789 同一 node:http fetch 适配器）。
 *
 * TODO：
 *   [x] v0.3 :8787 只读面：jobs / runs / workers(v0 口径) / 事件流 SSE / HTML 单页
 *   [x] daemon bin 子命令 `studio-next panel --db <路径> [--port 8787]`
 *   [x] 断路器告警卡 + 成本趋势卡（17-§8 全量口径——store queryEvents order:'desc'
 *       与 budgets 数据源已备；事件流增强 order=desc + event= 维）
 *   [x] :8787 换装刀一（DEV-11，按 DEV-1 方案/docs/37-§5.1 路线 I）：vendor 三件进仓 +
 *       /vendor/*、/ui/* 静态路由 + Vue/Naive UI/ECharts 页壳；旧单页保留 /legacy
 *   [x] :8789 slug 路由 + 公司清单页（v0.7 首刀，./overview）
 *   [x] 组织/人事/进度/财务读面 tab（服务端聚合，不整树前端渲染；v0.7 首刀）
 *   [x] daemon bin 子命令 `studio-next overview --company <目录>… [--db <库路径>] [--port 8789]`
 *   [x] :8789 换装刀二（DEV-12）：同套 :8787 换装（ui/overview/* + shell.ts 复用刀一 vendor/
 *       importmap/主题件）+ /api/overview/* JSON 读面 + 热重载（快照时间标注 + 目录监听，
 *       reload.ts mountHotCompanySource——bin overview 接线）；旧五读面整组迁 /legacy
 *   [x] :8788 对外 API 信息/触发端点骨架 + agent-card（v0.9 首刀，./external——独立入口）
 *   [ ] 漂移告警卡（17-§8 另半张：模型行为/成本漂移判据未冻结，待 daemon 机制落地）
 *   [ ] budgets 全量读面（store 现 only queryBudgets by-scope——panel 以镜像枚举 scope
 *       近似，见 views.COSTS_BUDGETS_BASIS_NOTE；store 增 listBudgets 后替换）
 *   [ ] workers 真源切换（daemon 内存态，v0.4 接管后台账近似口径整体替换）
 *   [ ] :8789 项目/报表 tab（v0.7 后续刀）
 *   [ ] 编辑中心：草稿态 → 批示 → 写回链路（带前值快照可逐字 diff；daemon 单点写回）
 *   [ ] :8788 SSE 订阅真实现（events.subscribe 语义归后续刀——现 501 占位）
 *   [ ] :8788 触发端点扩面（explore/tasks/intel，17-§8 端面）与对外 MCP server（25-§4.2）
 *   [ ] :8788 台账写纪律批示（触发面 kv 幂等写 vs daemon 唯一写入者——见 external/server.ts 头注）
 *   [ ] 界面截图基线（进 CI，防 UI 回归）
 */

/** 包名常量 */
export const PACKAGE_NAME = '@studio-next/panel'

/** 状态标记：:8787 监控面（v0.3 + 断路器/成本全量口径）与 :8789 公司概览读面（v0.7 首刀）已落地 */
export const PACKAGE_STATUS = 'partial'

// 纯函数层：快照 / 聚合 / 单页渲染（零 IO 零 Hono，views.ts）
export {
  BREAKERS_V0_NOTE,
  COSTS_BUDGETS_BASIS_NOTE,
  COSTS_NOTE,
  DAY_MS,
  DEFAULT_BREAKER_DAYS,
  DEFAULT_COSTS_DAYS,
  DEFAULT_PAGE_SIZE,
  MAX_BREAKER_DAYS,
  MAX_COSTS_DAYS,
  WORKERS_V0_NOTE,
  aggregateActiveWorkers,
  aggregateBreakers,
  buildBreakerSnapshot,
  buildCostsSnapshot,
  buildDashboardSnapshot,
  dayKeyOf,
  dayStartOf,
  eventDistribution,
  isBreakerEvent,
  jobViews,
  parseBreakerNote,
  recentRunSlice,
  renderDashboardPage,
} from './views.ts'
export type {
  ActiveWorker,
  BreakerNoteFields,
  BreakerSnapshot,
  BreakerStatus,
  CostsSnapshot,
  DailyCostPoint,
  DashboardSnapshot,
  JobView,
  SnapshotEvents,
  SnapshotJobs,
  SnapshotOptions,
  SnapshotRuns,
  SnapshotWorkers,
} from './views.ts'

// 页壳层：Vue 壳 + importmap（shell.ts——纯函数零 IO）
export { PANEL_IMPORTMAP, PANEL_LEGACY_ROUTE, PANEL_UI_ENTRY, renderDashboardShell } from './shell.ts'

// 静态层：/vendor/* 与 /ui/* 路由（static.ts——本刀唯一新增 IO 文件）
export { VENDOR_FILES, mountPanelStatic } from './static.ts'
export type { PanelStaticOptions } from './static.ts'

// 服务器层：Hono app 工厂 + 真监听壳（server.ts）
export {
  DEFAULT_STREAM_INTERVAL_MS,
  MAX_PAGE_SIZE,
  createPanelApp,
  forwardResponse,
  listenHono,
  servePanel,
  toWebRequest,
} from './server.ts'
export type { HonoShellHandle, ListenHonoOptions, PanelApp, PanelAppOptions, PanelHandle, ServePanelOptions } from './server.ts'
