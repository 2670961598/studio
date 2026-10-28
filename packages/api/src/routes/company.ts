/**
 * API-01 GET /v1/company —— 公司维视图（挂载公司单一事实源）
 *
 * 依据：docs/v2/14 §四（信息面；?company= 读写同一解析规则；跨公司一致性）；
 * docs/v2/15 §三 SEC-WD-01（公司维必带/错绑 4xx）。
 *
 * 行为：?company= 缺省=挂载公司；给出必须同维（否则 403）。读源返回的 companyId/slug
 * 两槽都必须与挂载公司一致，否则 503 不服务（跨公司读隔离 fail-closed）。
 */
import { Hono } from 'hono'
import type { ApiEnv, ApiRouteDeps, ApiCompanyView } from '../types.ts'
import {
  isNonEmptyString,
  nowIso,
  readContextFor,
  resolveCompanyDimension,
  sourceCompanyMismatch,
  viewShapeInvalid,
  viewUnavailable,
} from '../http.ts'

export function createCompanyRoute(deps: ApiRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>()

  app.get('/v1/company', (c) => {
    const resolved = resolveCompanyDimension(c, deps)
    if (!resolved.ok) return resolved.response

    const view = deps.readers.company(
      readContextFor(
        deps,
        ['company.companyId', 'company.slug', 'company.name', 'company.platform', 'company.description'],
        'external-api-company',
      ),
    )
    if (view === undefined) return viewUnavailable(c, 'company', '读源未提供公司投影')
    if (view.companyId !== deps.company.companyId || view.slug !== deps.company.slug) {
      return sourceCompanyMismatch(c, 'company', 'mismatch')
    }
    if (!isNonEmptyString(view.name)) return viewShapeInvalid(c, 'company', 'name 须为非空字符串')

    // 白名单序列化：只出五槽（读源多给的字段不经本面外露）
    const company: ApiCompanyView = {
      companyId: view.companyId,
      slug: view.slug,
      name: view.name,
      ...(view.platform !== undefined ? { platform: view.platform } : {}),
      ...(view.description !== undefined ? { description: view.description } : {}),
    }
    return c.json({ ok: true, company, generatedAt: nowIso(deps), readOnly: true })
  })

  return app
}
