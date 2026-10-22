/**
 * Studio Next · panel/overview —— :8789 公司概览面（v0.7 首刀读面 + DEV-12 执行刀二换装；独立入口）
 *
 * 定位（docs/16-§四 v0.7、docs/04-§七、docs/17-§8、docs/37-§5.1）：`/<slug>/...` 按挂载公司
 * 路由的只读面；六读面（概览/组织/人事/进度/财务/报表）+ 公司清单。DEV-12 刀二同套 :8787
 * 换装（vendor 三件/importmap/ui 模块复用刀一）+ JSON 读面（/api/overview/*）+ 热重载（快照
 * 时间标注 + 目录监听，reload.ts）；旧服务端渲染面整组迁 /legacy 作回滚面。报表 tab=127-B
 * v1（metadata-only 清单＋新鲜度灯＋公司级汇总；正文端点待批示）。项目 tab 与编辑中心
 * （草稿→批示→写回）归后续刀。
 * 分层：views.ts 纯函数层（零 IO 零 Hono）+ api.ts JSON 投影层（零 IO 零 Hono）+
 * shell.ts 换装壳（纯函数）+ server.ts 服务器层（路由/注入/监听壳）+ reload.ts 热重载 IO 层。
 * 零新依赖（hono/contract/store 均为 panel 既有依赖；前端 vendor 由刀一进仓）；公司目录
 * 装载归 wiring 侧（apps/daemon bin）。
 */
export {
  FINANCE_NOTE,
  PROGRESS_NOTE,
  buildFinanceSnapshot,
  buildOrgTree,
  buildProgressSnapshot,
  escapeHtml,
  renderCompanyListPage,
  renderCompanyPage,
  renderFinancePage,
  renderNotFoundPage,
  renderOrgPage,
  renderOrgTree,
  renderPeoplePage,
  renderPersonPage,
  renderProgressPage,
} from './views.ts'
export type { FinanceBudgets, FinanceLlmDay, FinanceSnapshot, OrgTree, OrgTreeNode, ProgressSnapshot } from './views.ts'

export {
  buildCompaniesPayload,
  buildCompanySnapshotPayload,
  buildFinancePayload,
  buildOrgPayload,
  buildPeoplePayload,
  buildPersonPayload,
  buildProgressPayload,
  buildReportsPayload,
  snapshotMetaJson,
} from './api.ts'
export type {
  CompaniesPayload,
  CompanySnapshotPayload,
  FinancePayload,
  OrgPayload,
  OrgTreeNodeJson,
  PeoplePayload,
  PersonPayload,
  ProgressPayload,
  ReportsPayload,
  SnapshotMetaJson,
} from './api.ts'

export {
  COMPANY_GROUP,
  OTHER_GROUP,
  REPORT_LIGHT_TEXT,
  REPORTS_BODY_NOTE,
  REPORTS_V2_NOTE,
  buildReportsSnapshot,
} from './reports.ts'
export type {
  DeptReportGroup,
  ReportFileMeta,
  ReportItemRow,
  ReportJobLight,
  ReportLight,
  ReportsSnapshot,
  ReportsSnapshotInput,
} from './reports.ts'

export { OVERVIEW_LEGACY_BASE, OVERVIEW_LEGACY_ROUTE, OVERVIEW_UI_ENTRY, renderOverviewShell } from './shell.ts'

export { mountHotCompanySource } from './reload.ts'
export type { HotCompanyHandle, HotCompanySourceOptions, HotOverviewCompanySource, SnapshotInfo } from './reload.ts'

export { createOverviewApp, serveOverview } from './server.ts'
export type { OverviewApp, OverviewAppOptions, OverviewCompanySource, OverviewHandle, ServeOverviewOptions } from './server.ts'
