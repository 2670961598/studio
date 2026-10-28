/**
 * API-02 GET /v1/org —— 组织树平面投影
 *
 * 依据：docs/v2/14 §四（信息面；组织树悬空/成环如实标记）；docs/v2/15 §三 SEC-WD-01
 * （跨公司读隔离）。
 *
 * 行为：只出部门平面事实（path/name/parent/headcount/relations）；悬空/成环由读源在
 * warnings 里如实给出，本面不补链、不隐藏。读源公司维不符＝503。
 */
import { Hono } from 'hono'
import type { ApiEnv, ApiOrgDepartmentView, ApiRouteDeps } from '../types.ts'
import { isNonEmptyString, nowIso, resolveCompanyDimension, viewShapeInvalid } from '../http.ts'
import { asArray, loadScopedView } from './read.ts'

/** 单部门行白名单投影（坏行=形状错误——不跳过静默缩小组织树） */
function pickDepartment(value: unknown): ApiOrgDepartmentView | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  const path = row['path']
  const name = row['name']
  if (!isNonEmptyString(path) || !isNonEmptyString(name)) return undefined
  const parent = row['parent']
  const headcount = row['headcount']
  const relations = row['relations']
  return {
    path,
    name,
    ...(isNonEmptyString(parent) ? { parent } : {}),
    ...(typeof headcount === 'number' && Number.isFinite(headcount) ? { headcount } : {}),
    ...(Array.isArray(relations) ? { relations: relations.filter((item): item is string => typeof item === 'string') } : {}),
  }
}

export function createOrgRoute(deps: ApiRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>()

  app.get('/v1/org', (c) => {
    const resolved = resolveCompanyDimension(c, deps)
    if (!resolved.ok) return resolved.response

    const loaded = loadScopedView(
      c,
      deps,
      'org',
      ['org.departments', 'org.warnings'],
      'external-api-org',
      (rc) => deps.readers.org(rc),
    )
    if (!loaded.ok) return loaded.response
    const view = loaded.value

    const rawDepartments = asArray(view.departments)
    if (rawDepartments === undefined) return viewShapeInvalid(c, 'org', 'departments 须为数组')
    const departments: ApiOrgDepartmentView[] = []
    for (const row of rawDepartments) {
      const picked = pickDepartment(row)
      if (picked === undefined) return viewShapeInvalid(c, 'org', '部门行缺 path/name 或类型错')
      departments.push(picked)
    }
    const rawWarnings = asArray(view.warnings)
    if (rawWarnings === undefined) return viewShapeInvalid(c, 'org', 'warnings 须为数组（悬空/成环如实标记）')
    const warnings = rawWarnings.filter((item): item is string => typeof item === 'string')

    return c.json({
      ok: true,
      org: {
        // 公司维统一回写挂载公司（读源值已过闸；不把读源原值直接透出）
        company: deps.company.slug,
        departments,
        warnings,
      },
      generatedAt: nowIso(deps),
      readOnly: true,
    })
  })

  return app
}
