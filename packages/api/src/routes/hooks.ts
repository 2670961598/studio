/**
 * API-15 POST /v1/hooks/{source} —— 入站签名（HMAC＋时间戳＋nonce＋重放窗＋载荷上限）
 *
 * 依据：docs/v2/14 §四（API-15；产意图同触发面收口）；docs/v2/15 §四 SEC-T5（webhook
 * 验签 secret 只经运行时注入）、§二 SEC-SIG-01（signed 署名）。
 *
 * 行为：
 *   ① 未登记 hooks＝501 带原因（不是 200 空收）；
 *   ② 未知 source＝404；载荷超限＝413；签名/窗口/重放失败＝401（签名有效也拒绝）；
 *   ③ 通过后按触发面同一条链产意图（source=hook source，requestKind=hook），
 *      202=已入队≠已受理；幂等键四槽同触发面（同键同内容=200、异内容=409）。
 */
import { Hono } from 'hono'
import type { CallContext, CommissionerRef, ExternalIntent, IntentKey } from '@studio-next/contract'
import type { ApiEnv, ApiRouteDeps } from '../types.ts'
import {
  MAX_TEXT_FIELD_LENGTH,
  apiError,
  invalidRequest,
  isNonEmptyString,
  isRecord,
  nowIso,
  optionalString,
  parseCaller,
  payloadDigest,
  portFailureResponse,
  readRawBody,
  resolveRequestCompany,
} from '../http.ts'
import { parseCommissioner, parseDispatcherAnchor, respondIntentReceipt } from '../intake.ts'
import { HOOK_DELIVERY_HEADER, createHookVerifier } from '../signature.ts'

/** 入站 hooks 的 requestKind（四槽之一；路径/协议事实，body 不改写） */
export const HOOK_REQUEST_KIND = 'hook'

/** hook 载荷兜底：body.body 对象优先，否则整包即载荷 */
function hookPayload(body: Record<string, unknown>): Record<string, unknown> | undefined {
  const inner = body['body']
  if (inner !== undefined) return isRecord(inner) ? inner : undefined
  return body
}

function commissionerOnBehalfOf(commissioner: CommissionerRef): string {
  return commissioner.mapped ? commissioner.caller.callerId : `external:${commissioner.externalPrincipal}`
}

export function createHooksRoute(deps: ApiRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>()
  const verify = createHookVerifier(() => {
    try {
      const parsed = Date.parse(deps.obs.clock().now)
      return Number.isFinite(parsed) ? parsed : Date.now()
    } catch {
      return Date.now()
    }
  })

  app.post('/v1/hooks/:source', async (c) => {
    if (deps.hooks.length === 0) {
      return apiError(c, 501, 'hooks-not-wired', 'unsupported', 'hooks-not-wired', {
        reason: '入站 hooks 未装配（无登记 source）——不空收、不静默 200；装配 hooks 后生效',
      })
    }
    const sourceName = c.req.param('source')
    const source = deps.hooks.find((entry) => entry.source === sourceName)
    if (source === undefined) {
      return apiError(c, 404, 'unknown-hook-source', 'unsupported', 'unknown-hook-source', {
        detail: 'source 未登记（fail-closed；不做签名校验前的存在性猜测）',
      })
    }

    const raw = await readRawBody(c)
    if (!raw.ok) return raw.response

    const verified = verify(source, c.req.raw.headers, raw.raw)
    if (!verified.ok) {
      return apiError(c, verified.status, 'hook-signature-rejected', 'rejected_authority', verified.subcause, {
        ...(verified.detail !== undefined ? { detail: verified.detail } : {}),
      })
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw.raw)
    } catch {
      return invalidRequest(c, '$', 'hook 载荷不是合法 JSON')
    }
    if (!isRecord(parsed)) return invalidRequest(c, '$', 'hook 载荷须为 JSON 对象')

    const company = resolveRequestCompany(c, deps, parsed['company'])
    if (!company.ok) return company.response

    // 交付键（四槽之第四槽）：header 或 body.dedupKey；同给须一致
    const headerDelivery = c.req.header(HOOK_DELIVERY_HEADER)
    const bodyDelivery = parsed['dedupKey']
    if (bodyDelivery !== undefined && !isNonEmptyString(bodyDelivery)) {
      return invalidRequest(c, 'dedupKey', 'body.dedupKey 须为非空字符串')
    }
    if (headerDelivery !== undefined && bodyDelivery !== undefined && headerDelivery !== bodyDelivery) {
      return invalidRequest(c, 'dedupKey', `${HOOK_DELIVERY_HEADER} 与 body.dedupKey 不一致`)
    }
    const deliveryKey = headerDelivery ?? bodyDelivery
    if (!isNonEmptyString(deliveryKey) || deliveryKey.length > MAX_TEXT_FIELD_LENGTH) {
      return invalidRequest(
        c,
        'dedupKey',
        `交付键必填（${HOOK_DELIVERY_HEADER} 头或 body.dedupKey；1..${String(MAX_TEXT_FIELD_LENGTH)} 字符）`,
      )
    }

    const payload = hookPayload(parsed)
    if (payload === undefined) return invalidRequest(c, 'body', 'body 须为 JSON 对象')

    // 外部来源默认未映射：显式声明主体＋identity_mapping 依据（不留空）
    const commissioner =
      parsed['commissioner'] === undefined
        ? {
            mapped: false as const,
            externalPrincipal: `hook:${sourceName}`,
            identityMappingBasis: 'hook-source-registry',
          }
        : parseCommissioner(parsed['commissioner'])
    if (commissioner === undefined) {
      return invalidRequest(c, 'commissioner', 'commissioner 须为 mapped:true+caller 或 mapped:false+依据')
    }
    const dispatcherAnchor =
      parsed['dispatcherAnchor'] === undefined
        ? parseDispatcherAnchor(undefined)
        : parseDispatcherAnchor(parsed['dispatcherAnchor'])
    if (dispatcherAnchor === undefined) {
      return invalidRequest(c, 'dispatcherAnchor', 'dispatcherAnchor 形状非法')
    }

    const correlation = optionalString(c, parsed, 'correlation')
    if (!correlation.ok) return correlation.response

    const submittedBy = parseCaller({
      callerId: `hook:${sourceName}`,
      kind: 'program',
      programRef: 'PORT-GATE',
    })
    if (submittedBy === undefined) throw new Error('api/hooks: 内部调用者形状非法')

    const intentKey: IntentKey = {
      company: company.company,
      source: sourceName,
      requestKind: HOOK_REQUEST_KIND,
      key: deliveryKey,
    }
    const intent: ExternalIntent = {
      ...intentKey,
      toolScope: 'intake_comment',
      auth: {
        tier: 'signed',
        hmacRef: `hook:${sourceName}`,
        timestamp: verified.timestamp,
        nonce: verified.nonce,
      },
      commissioner,
      dispatcherAnchor,
      submittedBy,
      body: payload,
      payloadDigest: payloadDigest({
        requestKind: HOOK_REQUEST_KIND,
        source: sourceName,
        body: payload,
        ...(correlation.value !== undefined ? { correlation: correlation.value } : {}),
      }),
      receivedAt: nowIso(deps),
      ...(correlation.value !== undefined ? { correlation: correlation.value } : {}),
    }
    const ctx: CallContext = {
      company: company.company,
      caller: submittedBy,
      authority: [],
      signature: {
        actorKind: 'system',
        actorRef: 'api:hooks',
        onBehalfOf: commissionerOnBehalfOf(commissioner),
      },
    }

    const result = deps.gate.receiveIntent(intent, ctx)
    if (result.kind === 'err') return portFailureResponse(c, result.error, 'intent-rejected')
    deps.log(`[api] hook intent enqueued：source=${sourceName} key=${deliveryKey} intentRef=${result.value.intentRef}`)
    return respondIntentReceipt(c, result.value)
  })

  return app
}

