/**
 * Studio Next · panel —— 面板（:8787 监控面已落地；:8789 公司概览待 v0.7）
 *
 * 定位（docs/17-§8，需求 C1/C3）：两面分端口，口径分离、共用台账不共用报表（F3-07）。
 *
 *   :8787 框架监控（机器的温度计，内部）—— v0.3 首刀 + 全量口径补齐（docs/16-§四、17-§8）：
 *     端面全 GET 全只读：/api/health、/api/jobs（due 标记）、/api/runs（在途优先）、
 *     /api/workers（v0 台账聚合口径）、/api/events（queryEvents 包装：company/issue/
 *     order=desc/event= 四维）、/api/events/stream（SSE 轮询新事件，Last-Event-ID 续传）、
 *     /api/snapshot、/api/breakers（断路器告警：CIRCUIT_BREAK 族事件 (单号,签名) 聚合）、
 *     /api/costs（成本趋势：LLM 岛/收割/预算三类按 UTC 日分列——docs/26 C1 展示面）、
 *     /（HTML 单页：六区块卡片 + fetch 轮询 + SSE）。
 *     数据全部读 SQLite 台账（WAL 单写多读，panel 零写）；漂移告警待 daemon 侧判据冻结。
 *
 *   :8789 公司概览（老板的公司，制作人/内部）—— 待 v0.7：
 *     路由 `/<company-slug>/...`；tab=概览/组织/人事/财务/项目/报表/编辑中心；
 *     编辑中心=人事变动草稿→三档批示（D2）→daemon 单点写回；
 *     页面全部等级无关渲染；三连问页面直答（C1）。
 *
 * 实现纪律：Hono + streamSSE（浏览器自动重连，不引 WebSocket）；纯函数层（views.ts）
 * 与服务器层（server.ts）分离——app.fetch() 进程内可测，servePanel 是薄监听壳。
 *
 * TODO：
 *   [x] v0.3 :8787 只读面：jobs / runs / workers(v0 口径) / 事件流 SSE / HTML 单页
 *   [x] daemon bin 子命令 `studio-next panel --db <路径> [--port 8787]`
 *   [x] 断路器告警卡 + 成本趋势卡（17-§8 全量口径——store queryEvents order:'desc'
 *       与 budgets 数据源已备；事件流增强 order=desc + event= 维）
 *   [ ] 漂移告警卡（17-§8 另半张：模型行为/成本漂移判据未冻结，待 daemon 机制落地）
 *   [ ] budgets 全量读面（store 现 only queryBudgets by-scope——panel 以镜像枚举 scope
 *       近似，见 views.COSTS_BUDGETS_BASIS_NOTE；store 增 listBudgets 后替换）
 *   [ ] workers 真源切换（daemon 内存态，v0.4 接管后台账近似口径整体替换）
 *   [ ] :8789 slug 路由 + 公司清单页（v0.7）
 *   [ ] 组织/人事/财务/项目/报表 tab（服务端聚合，不整树前端渲染）
 *   [ ] 编辑中心：草稿态 → 批示 → 写回链路（带前值快照可逐字 diff）
 *   [ ] 界面截图基线（进 CI，防 UI 回归）
 */

/** 包名常量 */
export const PACKAGE_NAME = '@studio-next/panel'

/** 状态标记：:8787 监控面（v0.3 + 断路器/成本全量口径）已落地；:8789 公司概览待 v0.7 */
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

// 服务器层：Hono app 工厂 + 真监听壳（server.ts）
export { DEFAULT_STREAM_INTERVAL_MS, MAX_PAGE_SIZE, createPanelApp, servePanel } from './server.ts'
export type { PanelApp, PanelAppOptions, PanelHandle, ServePanelOptions } from './server.ts'
