/**
 * Studio Next · panel/overview —— :8789 公司概览面（v0.7 首刀：读面；独立入口）
 *
 * 定位（docs/16-§四 v0.7、docs/04-§七、docs/17-§8）：`/<slug>/...` 按挂载公司路由的只读面；
 * 本刀落概览/组织/人事/进度/财务五读面；项目/报表 tab 与编辑中心（草稿→批示→写回）归后续刀。
 * 分层与 :8787 同款：views.ts 纯函数层（零 IO 零 Hono）+ server.ts 服务器层（路由/注入/监听壳）。
 * 零新依赖（hono/contract/store 均为 panel 既有依赖）；公司目录装载归 wiring 侧（apps/daemon bin）。
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

export { createOverviewApp, serveOverview } from './server.ts'
export type { OverviewApp, OverviewAppOptions, OverviewCompanySource, OverviewHandle, ServeOverviewOptions } from './server.ts'
