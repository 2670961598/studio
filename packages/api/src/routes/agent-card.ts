/**
 * API-09 GET /v1/agent-card —— A2A 名片（公司定义生成，带版本与有效期）
 *
 * 依据：docs/v2/14 §四（API-09；A2A 只做 exporter，名片带版本与有效期）；
 * docs/v2/15 §三 SEC-WD-01（跨公司读隔离）。
 *
 * 行为：读源给出公司定义生成的卡片视图；本面校验 slug/company 与挂载公司同维、version
 * 非空、validFrom/validUntil 可解析且顺序正确——任一不成立＝503（不伪造版本/有效期）。
 * 有效期状态（pending/active/expired）如实计算，不从「今天」补出新鲜日期。
 * 端点表复用 API_ENDPOINTS（与路由挂载同源）。
 */
import { Hono } from 'hono'
import type { ApiAgentCardView, ApiEnv, ApiRouteDeps } from '../types.ts'
import { API_ENDPOINTS } from '../catalog.ts'
import { checkViewCompany, isNonEmptyString, nowIso, resolveCompanyDimension, viewShapeInvalid } from '../http.ts'
import { loadScopedView } from './read.ts'

/** 有效期三态（到点未生效≠已生效；过期≠重新发一张） */
export type AgentCardValidityState = 'pending' | 'active' | 'expired'

function parseTime(value: string): number | undefined {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function createAgentCardRoute(deps: ApiRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>()

  app.get('/v1/agent-card', (c) => {
    const resolved = resolveCompanyDimension(c, deps)
    if (!resolved.ok) return resolved.response

    const loaded = loadScopedView(
      c,
      deps,
      'agent-card',
      ['agent-card'],
      'external-api-agent-card',
      (rc) => deps.readers.agentCard(rc),
    )
    if (!loaded.ok) return loaded.response
    const view = loaded.value

    // 公司维双槽：company 与 slug 任一不符/缺失都 503（跨公司读隔离）
    const check = checkViewCompany(view.company, deps.company)
    if (check !== 'ok') return viewShapeInvalid(c, 'agent-card', 'company 与挂载公司不一致')
    if (view.slug !== deps.company.slug) return viewShapeInvalid(c, 'agent-card', 'slug 与挂载公司不一致')
    if (!isNonEmptyString(view.version)) return viewShapeInvalid(c, 'agent-card', 'version 必填（名片带版本）')
    if (!isNonEmptyString(view.name)) return viewShapeInvalid(c, 'agent-card', 'name 必填')
    const from = parseTime(view.validFrom)
    const until = parseTime(view.validUntil)
    if (from === undefined || until === undefined) {
      return viewShapeInvalid(c, 'agent-card', 'validFrom/validUntil 须为可解析时间（名片带有效期）')
    }
    if (until <= from) return viewShapeInvalid(c, 'agent-card', 'validUntil 必须晚于 validFrom')

    const checkedAt = nowIso(deps)
    const nowMs = parseTime(checkedAt) ?? Date.now()
    const state: AgentCardValidityState = nowMs < from ? 'pending' : nowMs > until ? 'expired' : 'active'

    const card: ApiAgentCardView = {
      company: deps.company.slug,
      name: view.name,
      slug: view.slug,
      version: view.version,
      validFrom: view.validFrom,
      validUntil: view.validUntil,
      ...(view.description !== undefined ? { description: view.description } : {}),
      ...(Array.isArray(view.capabilities)
        ? { capabilities: view.capabilities.filter((item): item is string => typeof item === 'string') }
        : {}),
    }
    return c.json({
      ok: true,
      card,
      validity: { state, from: view.validFrom, to: view.validUntil, checkedAt },
      endpoints: API_ENDPOINTS,
      generatedAt: checkedAt,
      readOnly: true,
    })
  })

  return app
}
