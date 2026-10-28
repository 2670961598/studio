/**
 * API-04 GET /v1/projects —— 项目卡（只出挂载公司行）
 *
 * 依据：docs/v2/14 §四（信息面）；docs/v2/15 §三 SEC-WD-01（跨公司读隔离）。
 *
 * 行为：读源返回的行按公司维过滤（别家行丢弃，不外露）；单行白名单
 * projectId/name/platform/totalIssues/byState。总数按过滤后行数如实给出。
 */
import { Hono } from 'hono'
import type { ApiEnv, ApiProjectView, ApiRouteDeps, ApiStateCount } from '../types.ts'
import { isFiniteNumber, isNonEmptyString, nowIso, readContextFor, resolveCompanyDimension, viewShapeInvalid, viewUnavailable } from '../http.ts'
import { asArray, scopeRows } from './read.ts'

/** 状态计数数组白名单投影 */
function pickStateCounts(value: unknown): ApiStateCount[] | undefined {
  if (value === undefined) return undefined
  const rows = asArray(value)
  if (rows === undefined) return undefined
  const counts: ApiStateCount[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) return undefined
    const entry = row as Record<string, unknown>
    const state = entry['state']
    const count = entry['count']
    if (!isNonEmptyString(state) || !isFiniteNumber(count) || count < 0) return undefined
    counts.push({ state, count })
  }
  return counts
}

/** 单项目卡白名单投影 */
export function pickProject(value: unknown): ApiProjectView | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  const projectId = row['projectId']
  const name = row['name']
  if (!isNonEmptyString(projectId) || !isNonEmptyString(name)) return undefined
  const platform = row['platform']
  const totalIssues = row['totalIssues']
  const byState = pickStateCounts(row['byState'])
  if (byState === undefined && row['byState'] !== undefined) return undefined
  return {
    company: typeof row['company'] === 'string' ? row['company'] : '',
    projectId,
    name,
    ...(isNonEmptyString(platform) ? { platform } : {}),
    ...(isFiniteNumber(totalIssues) ? { totalIssues } : {}),
    ...(byState !== undefined ? { byState } : {}),
  }
}

export function createProjectsRoute(deps: ApiRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>()

  app.get('/v1/projects', (c) => {
    const resolved = resolveCompanyDimension(c, deps)
    if (!resolved.ok) return resolved.response

    const rows = deps.readers.projects(
      readContextFor(deps, ['projects.cards'], 'external-api-projects'),
    )
    if (rows === undefined) return viewUnavailable(c, 'projects', '读源未提供项目投影')
    const scoped = scopeRows(rows, deps.company)
    const items: Array<Record<string, unknown>> = []
    for (const row of scoped) {
      const picked = pickProject(row)
      if (picked === undefined) return viewShapeInvalid(c, 'projects', '项目行缺 projectId/name 或类型错')
      items.push({
        projectId: picked.projectId,
        name: picked.name,
        ...(picked.platform !== undefined ? { platform: picked.platform } : {}),
        ...(picked.totalIssues !== undefined ? { totalIssues: picked.totalIssues } : {}),
        ...(picked.byState !== undefined ? { byState: picked.byState } : {}),
      })
    }
    return c.json({
      ok: true,
      items,
      total: items.length,
      company: deps.company.slug,
      generatedAt: nowIso(deps),
      readOnly: true,
    })
  })

  return app
}
