/**
 * API-16 GET/POST /v1/subscriptions —— 出站订阅登记/查询
 *
 * 依据：docs/v2/14 §四（API-16：allowlist＋SSRF 拒＋退避＋死信（REC-EVT-03）＋重放窗）；
 * docs/v2/15 §三 SEC-WD-01（写公司维）、§四 SEC-T5（出站凭据不经提示词）。
 *
 * 行为：
 *   - POST＝登记**意图**（requestKind=subscription，经 PORT-GATE；202=已入队≠已受理）：
 *     callback URL 必须过 allowlist 与 SSRF 闸（https-only 缺省；回环/内网/IP 字面量/
 *     带凭据 URL/非标端口一律拒）；同键同内容=200、异内容=409（四槽幂等）；
 *   - GET＝本进程已入队登记的只读投影（明确标注非权威；权威登记归 daemon 侧）。
 *     两方法都要触发面认证（订阅回调 URL 是敏感面，不公开）。
 *   - 未装配策略＝501 带原因（不空收）。
 *
 * 残留缺口（如实登记）：不做 DNS 解析/防 rebinding（无网络 IO）；退避/死信/重放窗的
 * 实际投递归 daemon 侧投递器（目标未证），本面只把策略槽随意图交给下游。
 */
import { Hono } from 'hono'
import type { ExternalIntent, IntentKey } from '@studio-next/contract'
import type { ApiEnv, ApiRouteDeps } from '../types.ts'
import {
  apiError,
  invalidRequest,
  isNonEmptyString,
  nowIso,
  optionalString,
  payloadDigest,
  portFailureResponse,
  readJsonBody,
  rejectUnknownKeys,
  requiredString,
  resolveRequestCompany,
} from '../http.ts'
import { authenticateIntakeRequest, respondIntentReceipt } from '../intake.ts'

/** 订阅登记顶层槽 */
const SUBSCRIPTION_BODY_KEYS = ['company', 'dedupKey', 'callbackUrl', 'events', 'correlation'] as const

/** 单次登记的事件名上限与条目数上限（防拉爆/防超长回调） */
const MAX_EVENT_NAME_LENGTH = 100
const MAX_EVENT_NAMES = 32
const MAX_REGISTRATIONS = 256

/** 本进程登记投影（只读视图；不是台账——权威登记归 daemon） */
interface SubscriptionRegistration {
  readonly callbackUrl: string
  readonly events: readonly string[]
  readonly dedupKey: string
  readonly intentRef: string
  readonly enqueuedAt: string
}

type UrlCheck =
  | { readonly ok: true; readonly href: string }
  | { readonly ok: false; readonly status: 403 | 422; readonly subcause: string; readonly detail: string }

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/
const PRIVATE_V4_RE =
  /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/

/** 内网/回环/本地名（SSRF 硬拒；allowlist 也不能把私网放进来） */
function isPrivateHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.endsWith('.local') || host.endsWith('.internal')) return true
  if (IPV4_RE.test(host)) {
    if (PRIVATE_V4_RE.test(host)) return true
    // 其余 IPv4 字面量同样拒（不做 DNS/路由面判断；目标是「只去 allowlist 域名」）
    return true
  }
  if (host.includes(':')) return true // IPv6 字面量（含 [::1]）
  return false
}

/**
 * 回调 URL 校验（fail-closed）：
 *   scheme https（显式策略才放 http）；无 userinfo；端口 ∈ {缺省,443[,80]}；
 *   host 非 IP 字面量/本地名/私网；host 必须命中 allowlist（精确或子域）。
 * 空 allowlist＝全拒。
 */
export function validateCallbackUrl(raw: unknown, allowlist: readonly string[], allowInsecureHttp: boolean): UrlCheck {
  if (!isNonEmptyString(raw)) {
    return { ok: false, status: 422, subcause: 'subscription-url-invalid', detail: 'callbackUrl 须为非空字符串' }
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, status: 422, subcause: 'subscription-url-invalid', detail: 'callbackUrl 不是合法 URL' }
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, status: 403, subcause: 'subscription-url-credentials', detail: '回调 URL 不得携带凭据（userinfo）' }
  }
  const scheme = url.protocol.toLowerCase()
  if (scheme !== 'https:' && scheme !== 'http:') {
    return { ok: false, status: 403, subcause: 'subscription-scheme-not-allowed', detail: '回调只收 http(s)（缺省 https）' }
  }
  if (scheme === 'http:' && !allowInsecureHttp) {
    return { ok: false, status: 403, subcause: 'subscription-scheme-not-allowed', detail: '缺省 https-only；http 须策略显式 allowInsecureHttp' }
  }
  const allowedPort = scheme === 'https:' ? '443' : '80'
  if (url.port !== '' && url.port !== allowedPort) {
    return { ok: false, status: 403, subcause: 'subscription-port-not-allowed', detail: `只收缺省端口/${allowedPort}` }
  }
  const host = url.hostname.toLowerCase()
  if (host.length > 253) {
    return { ok: false, status: 422, subcause: 'subscription-url-invalid', detail: 'host 长度超限' }
  }
  if (isPrivateHost(host)) {
    return { ok: false, status: 403, subcause: 'subscription-ssrf-rejected', detail: '回环/内网/IP 字面量/本地名一律拒（SSRF）' }
  }
  const allowed = allowlist.some((entry) => host === entry || host.endsWith(`.${entry}`))
  if (!allowed) {
    return { ok: false, status: 403, subcause: 'subscription-host-not-allowed', detail: 'host 不在 allowlist（空 allowlist＝全拒）' }
  }
  return { ok: true, href: url.href }
}

/** 事件名数组校验（可选；给出须为 1..32 个非空短串） */
function parseEvents(value: unknown): { readonly ok: true; readonly events: readonly string[] } | { readonly ok: false } {
  if (value === undefined) return { ok: true, events: [] }
  if (!Array.isArray(value) || value.length > MAX_EVENT_NAMES) return { ok: false }
  const events: string[] = []
  for (const item of value) {
    if (!isNonEmptyString(item) || item.length > MAX_EVENT_NAME_LENGTH) return { ok: false }
    events.push(item)
  }
  return { ok: true, events }
}

export function createSubscriptionsRoute(deps: ApiRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>()
  const registrations: SubscriptionRegistration[] = []

  app.post('/v1/subscriptions', async (c) => {
    if (deps.subscriptions === undefined) {
      return apiError(c, 501, 'subscriptions-not-wired', 'unsupported', 'subscriptions-not-wired', {
        reason: '出站订阅未装配（无 allowlist/策略）——不空收、不静默 200',
      })
    }
    const authenticated = await authenticateIntakeRequest(c, deps)
    if (!authenticated.ok) return authenticated.response

    const parsed = await readJsonBody(c)
    if (!parsed.ok) return parsed.response
    const unknown = rejectUnknownKeys(c, parsed.value, SUBSCRIPTION_BODY_KEYS)
    if (unknown !== undefined) return unknown

    const company = resolveRequestCompany(c, deps, parsed.value['company'])
    if (!company.ok) return company.response

    const dedupKey = requiredString(c, parsed.value, 'dedupKey')
    if (!dedupKey.ok) return dedupKey.response
    const callbackRaw = requiredString(c, parsed.value, 'callbackUrl', 2048)
    if (!callbackRaw.ok) return callbackRaw.response
    const urlCheck = validateCallbackUrl(
      callbackRaw.value,
      deps.subscriptions.allowlist,
      deps.subscriptions.allowInsecureHttp === true,
    )
    if (!urlCheck.ok) {
      // 坏 URL＝422（fieldPath=callbackUrl）；安全拒绝（SSRF/allowlist/scheme/port）＝403
      if (urlCheck.status === 422) return invalidRequest(c, 'callbackUrl', urlCheck.detail)
      return apiError(c, urlCheck.status, 'subscription-rejected', 'rejected_forbidden', urlCheck.subcause, {
        detail: urlCheck.detail,
      })
    }
    const events = parseEvents(parsed.value['events'])
    if (!events.ok) {
      return invalidRequest(c, 'events', `events 须为 ≤${String(MAX_EVENT_NAMES)} 个非空短字符串`)
    }
    const correlation = optionalString(c, parsed.value, 'correlation')
    if (!correlation.ok) return correlation.response

    const intentKey: IntentKey = {
      company: company.company,
      source: 'http',
      requestKind: 'subscription',
      key: dedupKey.value,
    }
    const intent: ExternalIntent = {
      ...intentKey,
      toolScope: 'intake_comment',
      auth: authenticated.auth,
      commissioner: { mapped: true, caller: authenticated.caller },
      dispatcherAnchor: { defaulted: true, resolvedBy: 'intake_governance_position' },
      submittedBy: authenticated.caller,
      body: {
        callbackUrl: urlCheck.href,
        events: events.events,
        // 投递策略随意图交给下游投递器（退避/死信 REC-EVT-03 归 daemon；本面不投递）
        delivery: { mode: 'at-least-once', deadLetter: 'REC-EVT-03' },
      },
      payloadDigest: payloadDigest({
        requestKind: 'subscription',
        callbackUrl: urlCheck.href,
        events: events.events,
        ...(correlation.value !== undefined ? { correlation: correlation.value } : {}),
      }),
      receivedAt: nowIso(deps),
      ...(correlation.value !== undefined ? { correlation: correlation.value } : {}),
    }
    const result = deps.gate.receiveIntent(intent, {
      company: company.company,
      caller: authenticated.caller,
      authority: [],
      signature: { actorKind: 'system', actorRef: 'api:subscriptions', onBehalfOf: authenticated.caller.callerId },
    })
    if (result.kind === 'err') return portFailureResponse(c, result.error, 'intent-rejected')

    if (!result.value.deduped) {
      registrations.push({
        callbackUrl: urlCheck.href,
        events: events.events,
        dedupKey: dedupKey.value,
        intentRef: result.value.intentRef,
        enqueuedAt: nowIso(deps),
      })
      if (registrations.length > MAX_REGISTRATIONS) registrations.splice(0, registrations.length - MAX_REGISTRATIONS)
    }
    deps.log(`[api] subscription intent enqueued：host=${new URL(urlCheck.href).hostname} key=${dedupKey.value}`)
    return respondIntentReceipt(c, result.value)
  })

  app.get('/v1/subscriptions', async (c) => {
    if (deps.subscriptions === undefined) {
      return apiError(c, 501, 'subscriptions-not-wired', 'unsupported', 'subscriptions-not-wired', {
        reason: '出站订阅未装配（无 allowlist/策略）——不空收、不静默 200',
      })
    }
    const authenticated = await authenticateIntakeRequest(c, deps)
    if (!authenticated.ok) return authenticated.response

    const items = registrations.map((entry) => ({
      callbackUrl: entry.callbackUrl,
      events: entry.events,
      dedupKey: entry.dedupKey,
      intentRef: entry.intentRef,
      enqueuedAt: entry.enqueuedAt,
    }))
    return c.json({
      ok: true,
      items,
      total: items.length,
      note: '本进程投影（非权威）：登记已入队≠已受理；权威登记/投递态归 daemon 侧',
      generatedAt: nowIso(deps),
      readOnly: true,
    })
  })


  return app
}
