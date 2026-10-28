/**
 * API-03 GET /v1/people —— 人事聚合视图（默认只出聚合）
 *
 * 依据：docs/v2/14 §四（「people 默认只出聚合」）；docs/v2/15 §五 SEC-RD-01（读面
 * 知悉范围）、§三 SEC-WD-01（跨公司读隔离）。
 *
 * 行为：只出 total 与分组计数，**类型上没有人员级明细槽**——读源即使多给花名册字段，
 * 也经白名单序列化挡在本面之外（不是靠自律，是构造新对象）。
 */
import { Hono } from 'hono'
import type { ApiEnv, ApiPeopleGroup, ApiPeopleView, ApiRouteDeps } from '../types.ts'
import { isFiniteNumber, nowIso, resolveCompanyDimension, viewShapeInvalid } from '../http.ts'
import { asArray, loadScopedView } from './read.ts'

/** 分组数组白名单投影（坏行=形状错误，不静默丢组） */
function pickGroups(value: unknown): ApiPeopleGroup[] | undefined {
  const rows = asArray(value)
  if (rows === undefined) return undefined
  const groups: ApiPeopleGroup[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) return undefined
    const entry = row as Record<string, unknown>
    const key = entry['key']
    const count = entry['count']
    if (typeof key !== 'string' || !isFiniteNumber(count) || count < 0) return undefined
    groups.push({ key, count })
  }
  return groups
}

export function createPeopleRoute(deps: ApiRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>()

  app.get('/v1/people', (c) => {
    const resolved = resolveCompanyDimension(c, deps)
    if (!resolved.ok) return resolved.response

    const loaded = loadScopedView(
      c,
      deps,
      'people',
      ['people.aggregate'],
      'external-api-people',
      (rc) => deps.readers.people(rc),
    )
    if (!loaded.ok) return loaded.response
    const view = loaded.value

    if (!isFiniteNumber(view.total) || view.total < 0) {
      return viewShapeInvalid(c, 'people', 'total 须为非负有限数')
    }
    const byDepartment = pickGroups(view.byDepartment)
    const byLevel = pickGroups(view.byLevel)
    if (byDepartment === undefined) return viewShapeInvalid(c, 'people', 'byDepartment 须为 {key,count} 数组')
    if (byLevel === undefined) return viewShapeInvalid(c, 'people', 'byLevel 须为 {key,count} 数组')
    const byStatus = view.byStatus === undefined ? undefined : pickGroups(view.byStatus)
    if (byStatus === undefined && view.byStatus !== undefined) {
      return viewShapeInvalid(c, 'people', 'byStatus 须为 {key,count} 数组')
    }

    // 白名单序列化：无人员级明细（API-03「默认只出聚合」）
    const people: ApiPeopleView = {
      company: deps.company.slug,
      total: view.total,
      byDepartment,
      byLevel,
      ...(byStatus !== undefined ? { byStatus } : {}),
    }
    return c.json({ ok: true, people, generatedAt: nowIso(deps), readOnly: true })
  })

  return app
}
