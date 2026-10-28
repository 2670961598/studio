/**
 * API-05 GET /v1/issues —— 单据读面（可重建投影；?state=&limit=&cursor=）
 *
 * 依据：docs/v2/14 §四（信息面；GET 走只读投影）；docs/v2/15 §三 SEC-WD-01
 * （跨公司读隔离）。
 *
 * 行为：state 精确过滤交给读源（与 :8787 口径同向）；本面再按挂载公司过滤行、
 * 夹取 limit、白名单序列化（issueId/title/state/updatedAt/assignee/labels）。
 * 读源未命中=503（不是空列表冒充「没有」）。
 */
import { Hono } from 'hono'
import type { ApiEnv, ApiIssueQuery, ApiIssueView, ApiRouteDeps } from '../types.ts'
import {
  MAX_TEXT_FIELD_LENGTH,
  clampLimit,
  invalidRequest,
  isNonEmptyString,
  nowIso,
  readContextFor,
  resolveCompanyDimension,
  viewShapeInvalid,
  viewUnavailable,
} from '../http.ts'
import { asArray, scopeRows } from './read.ts'

/** 单行白名单投影 */
export function pickIssue(value: unknown): ApiIssueView | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  const issueId = row['issueId']
  const title = row['title']
  const state = row['state']
  if (!isNonEmptyString(issueId) || typeof title !== 'string' || !isNonEmptyString(state)) return undefined
  const updatedAt = row['updatedAt']
  const assignee = row['assignee']
  const labels = row['labels']
  return {
    company: typeof row['company'] === 'string' ? row['company'] : '',
    issueId,
    title,
    state,
    ...(isNonEmptyString(updatedAt) ? { updatedAt } : {}),
    ...(isNonEmptyString(assignee) ? { assignee } : {}),
    ...(Array.isArray(labels)
      ? { labels: labels.filter((item): item is string => typeof item === 'string') }
      : {}),
  }
}

export function createIssuesRoute(deps: ApiRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>()

  app.get('/v1/issues', (c) => {
    const resolved = resolveCompanyDimension(c, deps)
    if (!resolved.ok) return resolved.response

    const state = c.req.query('state')
    if (state !== undefined && (state.trim() === '' || state.length > MAX_TEXT_FIELD_LENGTH)) {
      return invalidRequest(c, 'state', `state 须为 1..${String(MAX_TEXT_FIELD_LENGTH)} 字符`)
    }
    const cursor = c.req.query('cursor')
    if (cursor !== undefined && cursor.length > MAX_TEXT_FIELD_LENGTH) {
      return invalidRequest(c, 'cursor', `cursor 长度超限（>${String(MAX_TEXT_FIELD_LENGTH)}）`)
    }
    const limit = clampLimit(c.req.query('limit'))
    const query: ApiIssueQuery = {
      limit,
      ...(state !== undefined ? { state } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
    }

    const page = deps.readers.issues(query, readContextFor(deps, ['issues.list'], 'external-api-issues'))
    if (page === undefined) return viewUnavailable(c, 'issues', '读源未提供单据投影')
    const rows = asArray(page.items)
    if (rows === undefined) return viewShapeInvalid(c, 'issues', 'items 须为数组')

    const sameCompany = scopeRows(rows, deps.company)
    const crossCompanyFiltered = sameCompany.length !== rows.length
    const scoped = sameCompany.slice(0, limit)
    const items: ApiIssueView[] = []
    for (const row of scoped) {
      const picked = pickIssue(row)
      if (picked === undefined) {
        return viewShapeInvalid(c, 'issues', '单据行缺 issueId/title/state 或类型错')
      }
      items.push({
        company: deps.company.slug,
        issueId: picked.issueId,
        title: picked.title,
        state: picked.state,
        ...(picked.updatedAt !== undefined ? { updatedAt: picked.updatedAt } : {}),
        ...(picked.assignee !== undefined ? { assignee: picked.assignee } : {}),
        ...(picked.labels !== undefined ? { labels: picked.labels } : {}),
      })
    }

    return c.json({
      ok: true,
      items,
      ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
      // 别家行被过滤时不透出读源 total（避免以计数泄漏跨公司行数）
      ...(typeof page.total === 'number' && Number.isFinite(page.total) && !crossCompanyFiltered
        ? { total: page.total }
        : {}),
      company: deps.company.slug,
      generatedAt: nowIso(deps),
      readOnly: true,
    })
  })

  return app
}
