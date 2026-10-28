/**
 * API-07 GET /v1/reports —— 报表文件清单（只出清单，不出正文）
 *
 * 依据：docs/v2/14 §四（信息面）；docs/v2/15 §三 SEC-WD-01（跨公司读隔离）。
 *
 * 行为：读源返回的文件条目按公司维过滤；白名单只出 file/bytes/generatedAt——读源
 * 即便带 `content` 正文也不经本面外露（正文端点未获批前不开口）。
 */
import { Hono } from 'hono'
import type { ApiEnv, ApiReportEntry, ApiRouteDeps } from '../types.ts'
import { isFiniteNumber, isNonEmptyString, nowIso, readContextFor, resolveCompanyDimension, viewShapeInvalid, viewUnavailable } from '../http.ts'
import { scopeRows } from './read.ts'

/** 单条目白名单投影（正文槽不在本面） */
export function pickReport(value: unknown): ApiReportEntry | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  const file = row['file']
  if (!isNonEmptyString(file)) return undefined
  const bytes = row['bytes']
  const generatedAt = row['generatedAt']
  return {
    company: typeof row['company'] === 'string' ? row['company'] : '',
    file,
    ...(isFiniteNumber(bytes) ? { bytes } : {}),
    ...(isNonEmptyString(generatedAt) ? { generatedAt } : {}),
  }
}

export function createReportsRoute(deps: ApiRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>()

  app.get('/v1/reports', (c) => {
    const resolved = resolveCompanyDimension(c, deps)
    if (!resolved.ok) return resolved.response

    const rows = deps.readers.reports(readContextFor(deps, ['reports.list'], 'external-api-reports'))
    if (rows === undefined) return viewUnavailable(c, 'reports', '读源未提供报表清单')
    const scoped = scopeRows(rows, deps.company)
    const reports: Array<Record<string, unknown>> = []
    for (const row of scoped) {
      const picked = pickReport(row)
      if (picked === undefined) return viewShapeInvalid(c, 'reports', '报表条目缺 file 或类型错')
      reports.push({
        file: picked.file,
        ...(picked.bytes !== undefined ? { bytes: picked.bytes } : {}),
        ...(picked.generatedAt !== undefined ? { generatedAt: picked.generatedAt } : {}),
      })
    }
    return c.json({
      ok: true,
      reports,
      total: reports.length,
      company: deps.company.slug,
      generatedAt: nowIso(deps),
      readOnly: true,
    })
  })

  return app
}
