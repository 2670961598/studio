/**
 * API-08 GET /v1/requests/status —— 回执查询（读投影快照）
 *
 * 依据：docs/v2/14 §四（「快照未命中=503 非 404——查不到≠没有」；三边界不串味）；
 * docs/v2/14 §0.2-3（意图保留键四槽：公司×来源×种类×票据或去重键）；
 * docs/v2/15 §三 SEC-WD-01（公司维）、§五 SEC-RD-01（readScope/caller）。
 *
 * 行为：用四槽键调 PORT-GATE.receipt。`Ok(undefined)`＝本进程投影快照未命中→503
 * receipt-not-in-snapshot（**不得** 404——404 只留给路由不存在）；`Err` 按失败类映射；
 * 回执只出白名单字段，且 outcome 必须仍是 queued（受理结论不在入口回执里）。
 */
import { Hono } from 'hono'
import type { IntentKey } from '@studio-next/contract'
import type { ApiEnv, ApiRouteDeps } from '../types.ts'
import {
  MAX_TEXT_FIELD_LENGTH,
  apiError,
  invalidRequest,
  isNonEmptyString,
  nowIso,
  pickIntentReceipt,
  readContextFor,
  resolveCompanyDimension,
  portFailureResponse,
} from '../http.ts'

export function createRequestStatusRoute(deps: ApiRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>()

  app.get('/v1/requests/status', (c) => {
    const resolved = resolveCompanyDimension(c, deps)
    if (!resolved.ok) return resolved.response

    const dedupKey = c.req.query('dedupKey') ?? c.req.query('key')
    if (!isNonEmptyString(dedupKey) || dedupKey.length > MAX_TEXT_FIELD_LENGTH) {
      return invalidRequest(c, 'dedupKey', `dedupKey 必填（1..${String(MAX_TEXT_FIELD_LENGTH)} 字符）`)
    }
    const source = c.req.query('source') ?? 'http'
    const requestKind = c.req.query('requestKind') ?? c.req.query('kind') ?? 'request'
    if (!isNonEmptyString(source) || source.length > MAX_TEXT_FIELD_LENGTH) {
      return invalidRequest(c, 'source', 'source 须为非空字符串')
    }
    if (!isNonEmptyString(requestKind) || requestKind.length > MAX_TEXT_FIELD_LENGTH) {
      return invalidRequest(c, 'requestKind', 'requestKind 须为非空字符串')
    }

    const key: IntentKey = {
      company: resolved.company,
      source,
      requestKind,
      key: dedupKey,
    }
    const result = deps.gate.receipt(key, readContextFor(deps, ['intent.receipt'], 'external-api-request-status'))
    if (result.kind === 'err') return portFailureResponse(c, result.error)
    if (result.value === undefined) {
      // 快照未命中≠不存在（v2/14 §四三边界）；对外 503 带原因，绝不 404
      return apiError(c, 503, 'receipt-not-in-snapshot', 'unavailable', 'receipt-not-in-snapshot', {
        reason: '回执查询命中本进程投影快照的空缺位——「查不到」≠「没有」；以 daemon 侧权威记录对账（REC-EVT-02）',
      })
    }
    const receipt = pickIntentReceipt(result.value)
    if (receipt === undefined) {
      return apiError(c, 503, 'receipt-invalid', 'degraded', 'receipt-outcome-invalid', {
        reason: '回执 outcome 不是 queued 或形状不符——入口回执不承载受理结论',
      })
    }
    return c.json({ ok: true, receipt, snapshot: 'hit', generatedAt: nowIso(deps), readOnly: true })
  })

  return app
}
