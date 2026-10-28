/**
 * packages/api/test/v2/hooks.test.ts —— API-15 入站签名（HMAC＋时间戳＋nonce＋重放窗＋上限）
 *
 * 覆盖：
 *   ① 未装配＝501 带原因；未知 source＝404；载荷超限＝413；
 *   ② 合法签名 202（signed 署名/外部主体显式/四槽 source=hook source）；
 *   ③ 坏签名/过期时间戳/未来时间戳/缺头/坏格式＝401/422；重放 nonce＝401；
 *   ④ 同键同内容=200、异内容=409；缺交付键＝422；
 *   ⑤ 签名通过后的载荷仍走触发面同一条只落单链（不派工）。
 */
import { describe, expect, it } from 'vitest'
import type { ExternalIntent } from '@studio-next/contract'
import { err } from './fakes.ts'
import { COMPANY, NOW_MS, hookHeaders, jsonBody, makeApp, makeGate } from './fakes.ts'

const SECRET = 'hook-secret-fixture'
const HOOKS = [{ source: 'github', signingSecret: SECRET }] as const

function rawBodyOf(dedupKey: string, payload: Record<string, unknown> = { action: 'opened' }): string {
  return JSON.stringify({ dedupKey, body: payload })
}

function hit(
  app: ReturnType<typeof makeApp>,
  raw: string,
  nonce: string,
  timestamp: number = NOW_MS,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    app.request('/v1/hooks/github', {
      method: 'POST',
      headers: { ...hookHeaders(SECRET, raw, nonce, timestamp), ...extraHeaders },
      body: raw,
    }),
  )
}

function errorOf(body: Record<string, unknown>): Record<string, unknown> {
  return body['error'] as Record<string, unknown>
}

describe('API-15 hooks：装配与来源面', () => {
  it('未装配 hooks＝501 带原因（不空收 200）', async () => {
    const res = await makeApp().request('/v1/hooks/github', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: rawBodyOf('d-1'),
    })
    expect(res.status).toBe(501)
    const body = await jsonBody(res)
    expect(String(body['reason'])).toContain('hooks')
  })

  it('未知 source＝404（签名校验前的存在性闸）', async () => {
    const res = await makeApp({ hooks: HOOKS }).request('/v1/hooks/gitlab', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: rawBodyOf('d-1'),
    })
    expect(res.status).toBe(404)
    const body = await jsonBody(res)
    expect(errorOf(body)['subcause']).toBe('unknown-hook-source')
  })
})

describe('API-15 hooks：签名与重放', () => {
  it('合法签名＝202；signed 署名＋外部主体显式＋只落单', async () => {
    const fake = makeGate()
    const app = makeApp({ gate: fake.gate, hooks: HOOKS })
    const raw = rawBodyOf('delivery-1', { action: 'opened', issue: 7 })
    const res = await hit(app, raw, 'nonce-1')
    expect(res.status).toBe(202)

    const body = await jsonBody(res)
    expect(body['enqueued']).toBe(true)
    const receipt = body['receipt'] as Record<string, unknown>
    expect(receipt['outcome']).toBe('queued')
    expect(receipt['acceptedAt']).toBeUndefined()

    expect(fake.intents).toHaveLength(1)
    const intent = fake.intents[0] as ExternalIntent
    expect(intent.company).toEqual(COMPANY)
    expect(intent.source).toBe('github')
    expect(intent.requestKind).toBe('hook')
    expect(intent.key).toBe('delivery-1')
    expect(intent.toolScope).toBe('intake_comment')
    expect(intent.auth).toEqual({
      tier: 'signed',
      hmacRef: 'hook:github',
      timestamp: String(NOW_MS),
      nonce: 'nonce-1',
    })
    expect(intent.commissioner).toEqual({
      mapped: false,
      externalPrincipal: 'hook:github',
      identityMappingBasis: 'hook-source-registry',
    })
    expect(intent.submittedBy).toEqual({ callerId: 'hook:github', kind: 'program', programRef: 'PORT-GATE' })
    expect(fake.contexts[0]?.signature).toEqual({
      actorKind: 'system',
      actorRef: 'api:hooks',
      onBehalfOf: 'external:hook:github',
    })
    expect(intent.body).toEqual({ action: 'opened', issue: 7 })
  })

  it('坏签名＝401；缺头＝401；坏时间戳格式＝422', async () => {
    const app = makeApp({ hooks: HOOKS })
    const raw = rawBodyOf('delivery-bad')
    const headers = hookHeaders(SECRET, raw, 'nonce-bad')
    const broken = await app.request('/v1/hooks/github', {
      method: 'POST',
      headers: { ...headers, 'x-sn-signature': 'deadbeef' },
      body: raw,
    })
    expect(broken.status).toBe(401)
    expect(errorOf(await jsonBody(broken))['subcause']).toBe('hook-signature-mismatch')

    const missing = await app.request('/v1/hooks/github', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw,
    })
    expect(missing.status).toBe(401)
    expect(errorOf(await jsonBody(missing))['subcause']).toBe('hook-timestamp-missing')

    const malformed = await app.request('/v1/hooks/github', {
      method: 'POST',
      headers: { ...headers, 'x-sn-timestamp': 'not-a-number' },
      body: raw,
    })
    expect(malformed.status).toBe(422)
    expect(errorOf(await jsonBody(malformed))['subcause']).toBe('hook-timestamp-invalid')
  })

  it('时间戳出窗（过期/未来）＝401（签名有效也拒绝）', async () => {
    const app = makeApp({ hooks: HOOKS })
    const raw = rawBodyOf('delivery-window')
    const stale = await hit(app, raw, 'nonce-stale', NOW_MS - 10 * 60_000)
    expect(stale.status).toBe(401)
    expect(errorOf(await jsonBody(stale))['subcause']).toBe('hook-timestamp-out-of-window')

    const future = await hit(app, raw, 'nonce-future', NOW_MS + 10 * 60_000)
    expect(future.status).toBe(401)
    expect(errorOf(await jsonBody(future))['subcause']).toBe('hook-timestamp-out-of-window')
  })

  it('nonce 重放＝401（同 nonce 同窗口第二次拒绝）', async () => {
    const app = makeApp({ hooks: HOOKS })
    const raw = rawBodyOf('delivery-replay')
    expect((await hit(app, raw, 'nonce-replay')).status).toBe(202)
    const replay = await hit(app, raw, 'nonce-replay')
    expect(replay.status).toBe(401)
    expect(errorOf(await jsonBody(replay))['subcause']).toBe('hook-nonce-replayed')
  })

  it('载荷超限＝413（先限长后验签）', async () => {
    const app = makeApp({ hooks: HOOKS })
    const huge = JSON.stringify({ dedupKey: 'd-huge', body: { text: 'x'.repeat(100_001) } })
    const res = await app.request('/v1/hooks/github', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: huge,
    })
    expect(res.status).toBe(413)
  })
})

describe('API-15 hooks：交付键/幂等/载荷', () => {
  it('缺交付键＝422；header 交付键可用；与 body 冲突＝422', async () => {
    const app = makeApp({ hooks: HOOKS })
    const noKey = await hit(app, JSON.stringify({ body: { action: 'x' } }), 'nonce-nokey')
    expect(noKey.status).toBe(422)
    expect((await jsonBody(noKey))['fieldPath']).toBe('dedupKey')

    const headerKey = await hit(app, JSON.stringify({ body: { action: 'x' } }), 'nonce-header', NOW_MS, {
      'x-sn-delivery': 'delivery-header',
    })
    expect(headerKey.status).toBe(202)

    const conflict = await hit(app, rawBodyOf('delivery-body'), 'nonce-conflict', NOW_MS, {
      'x-sn-delivery': 'delivery-header',
    })
    expect(conflict.status).toBe(422)
  })

  it('签名通过但载荷不是 JSON/不是对象＝422', async () => {
    const app = makeApp({ hooks: HOOKS })
    const notJson = await hit(app, '{bad', 'nonce-json')
    expect(notJson.status).toBe(422)

    const arrayPayload = await hit(app, '[]', 'nonce-array')
    expect(arrayPayload.status).toBe(422)
  })

  it('同交付键同内容＝200 deduped；同键异内容＝409', async () => {
    const fake = makeGate()
    const app = makeApp({ gate: fake.gate, hooks: HOOKS })
    const raw = rawBodyOf('delivery-dup', { action: 'opened' })
    expect((await hit(app, raw, 'nonce-dup-1')).status).toBe(202)
    expect((await hit(app, raw, 'nonce-dup-2')).status).toBe(200)
    const conflict = await hit(app, rawBodyOf('delivery-dup', { action: 'closed' }), 'nonce-dup-3')
    expect(conflict.status).toBe(409)
    expect(errorOf(await jsonBody(conflict))['subcause']).toBe('rejected_idempotency')
  })

  it('来源显式 commissioner 可映射（signed 来源可信）；默认不映射不留空', async () => {
    const fake = makeGate()
    const app = makeApp({ gate: fake.gate, hooks: HOOKS })
    const raw = JSON.stringify({
      dedupKey: 'delivery-mapped',
      commissioner: { mapped: true, caller: { callerId: 'partner-9', kind: 'program' } },
      body: { action: 'x' },
    })
    const res = await hit(app, raw, 'nonce-mapped')
    expect(res.status).toBe(202)
    expect(fake.intents[0]?.commissioner).toEqual({
      mapped: true,
      caller: { callerId: 'partner-9', kind: 'program' },
    })
    expect(fake.contexts[0]?.signature.onBehalfOf).toBe('partner-9')
  })

  it('PORT-GATE 拒绝按失败类映射（unavailable→503）', async () => {
    const fake = makeGate({ receiveIntent: () => err('unavailable', 'intent-queue-down') })
    const app = makeApp({ gate: fake.gate, hooks: HOOKS })
    const res = await hit(app, rawBodyOf('delivery-fail'), 'nonce-fail')
    expect(res.status).toBe(503)
    expect(errorOf(await jsonBody(res))['subcause']).toBe('intent-queue-down')
  })
})
