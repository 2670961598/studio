/**
 * API-10..13 POST /v1/requests・/v1/explore・/v1/tasks・/v1/intel —— 触发面
 *
 * 依据：docs/v2/14 §四（触发面：只产意图（REC-WORK-01）；202=已入队≠已受理；
 * outcome 五值只在查询时出现；只落单不派工）；plan/05 IMPL-06-08。
 *
 * 行为：四条路由共用 `handleIntake` 管线；路径决定 requestKind（body 不得改写）。
 * 本文件不出现任何派工/执行/台账代码——写面唯一经注入的 gate（PORT-GATE）。
 */
import { Hono } from 'hono'
import type { ApiEnv, ApiRouteDeps } from '../types.ts'
import { handleIntake } from '../intake.ts'
import type { TriggerKind } from '../intake.ts'

/** 路由路径 → requestKind（四槽之一）；新增端点须先改 v2/14 §四端点族表 */
export const TRIGGER_ROUTES: readonly Readonly<{ readonly path: string; readonly kind: TriggerKind }>[] = Object.freeze([
  { path: '/v1/requests', kind: 'request' },
  { path: '/v1/explore', kind: 'explore' },
  { path: '/v1/tasks', kind: 'task' },
  { path: '/v1/intel', kind: 'intel' },
])

export function createRequestsRoute(deps: ApiRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>()
  for (const route of TRIGGER_ROUTES) {
    app.post(route.path, (c) => handleIntake(c, deps, route.kind))
  }
  return app
}
