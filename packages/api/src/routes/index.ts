/**
 * packages/api/src/routes/index.ts —— 路由总装（API-01..16；一个 app，无独立监听）
 *
 * 依据：docs/v2/14 §四端点族表（API-01..16）；plan/05 IMPL-06-07/08（Hono app 装配/
 * 导出）。挂载顺序按族：只读族 → 回执/名片 → 触发族 → 订阅/SSE；路径互不遮蔽。
 *
 * 本文件不引入任何平台/台账/执行依赖：所有能力来自 `ApiRouteDeps`（company/obs/gate/
 * readers/auth/hooks/events/subscriptions）——写面唯一经 PORT-GATE（gate）。
 */
import { Hono } from 'hono'
import type { ApiEnv, ApiRouteDeps } from '../types.ts'
import { createCompanyRoute } from './company.ts'
import { createOrgRoute } from './org.ts'
import { createPeopleRoute } from './people.ts'
import { createProjectsRoute } from './projects.ts'
import { createIssuesRoute } from './issues.ts'
import { createFinanceRoute } from './finance.ts'
import { createReportsRoute } from './reports.ts'
import { createRequestStatusRoute } from './request-status.ts'
import { createAgentCardRoute } from './agent-card.ts'
import { createRequestsRoute } from './requests.ts'
import { createHooksRoute } from './hooks.ts'
import { createSubscriptionsRoute } from './subscriptions.ts'
import { createEventsRoute } from './events-sse.ts'

/** 路由总装（返回挂载好 16 个 API- 端点的 Hono 应用） */
export function createRoutes(deps: ApiRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>()

  // 只读族 API-01..07
  app.route('/', createCompanyRoute(deps))
  app.route('/', createOrgRoute(deps))
  app.route('/', createPeopleRoute(deps))
  app.route('/', createProjectsRoute(deps))
  app.route('/', createIssuesRoute(deps))
  app.route('/', createFinanceRoute(deps))
  app.route('/', createReportsRoute(deps))

  // 回执/名片 API-08..09（回执先于 /v1/requests，防路径歧义）
  app.route('/', createRequestStatusRoute(deps))
  app.route('/', createAgentCardRoute(deps))

  // 触发族 API-10..13
  app.route('/', createRequestsRoute(deps))

  // 订阅/SSE API-14..16
  app.route('/', createEventsRoute(deps))
  app.route('/', createHooksRoute(deps))
  app.route('/', createSubscriptionsRoute(deps))

  return app
}
