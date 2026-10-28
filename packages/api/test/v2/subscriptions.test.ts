/**
 * packages/api/test/v2/subscriptions.test.ts —— API-16 出站订阅（allowlist＋SSRF 拒＋幂等）
 *
 * 覆盖：
 *   ① 未装配＝501 带原因；GET/POST 都需认证（回调 URL 是敏感面）；
 *   ② 合法回调 202（requestKind=subscription；退避/死信策略随意图交给下游）；
 *   ③ SSRF/allowlist 硬拒：回环/私网/IP 字面量/本地名/非 allowlist/带凭据/非标端口/
 *      http（缺省 https-only）＝403；坏 URL＝422；显式 allowInsecureHttp 才放 http；
 *   ④ 四槽幂等：同键同内容=200 且登记不重复；异内容=409；
 *   ⑤ GET 返回本进程投影（明确非权威）＋白名单字段。
 */
import { describe, expect, it } from 'vitest'
import { COMPANY, SUBSCRIPTION_POLICY, err, jsonBody, makeApp, makeGate, postJson } from './fakes.ts'

const POST_HEADERS = { 'x-sn-credential': 'partner:ok' }
const ALLOWED_URL = 'https://hooks.partner.example/events'

function subBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { dedupKey: 'sub-1', callbackUrl: ALLOWED_URL, events: ['intent.queued'], ...overrides }
}

function wiredApp(gate = makeGate()): ReturnType<typeof makeApp> {
  return makeApp({ gate: gate.gate, subscriptions: SUBSCRIPTION_POLICY })
}

function errorOf(body: Record<string, unknown>): Record<string, unknown> {
  return body['error'] as Record<string, unknown>
}

describe('API-16 装配与认证', () => {
  it('未装配＝501 带原因（POST/GET 都不空收）', async () => {
    const app = makeApp()
    const post = await postJson(app, '/v1/subscriptions', subBody(), POST_HEADERS)
    expect(post.status).toBe(501)
    expect(String((await jsonBody(post))['reason'])).toContain('订阅')
    const get = await app.request('/v1/subscriptions')
    expect(get.status).toBe(501)
  })

  it('POST/GET 都需触发面认证（缺凭据 401；root 403）', async () => {
    const app = wiredApp()
    const noAuth = await postJson(app, '/v1/subscriptions', subBody(), {})
    expect(noAuth.status).toBe(401)
    const root = await postJson(app, '/v1/subscriptions', subBody(), { 'x-sn-credential': 'root:key' })
    expect(root.status).toBe(403)
    const getNoAuth = await app.request('/v1/subscriptions')
    expect(getNoAuth.status).toBe(401)
  })
})

describe('API-16 SSRF/allowlist 硬拒', () => {
  const rejected: Array<{ url: string; subcause: string }> = [
    { url: 'https://127.0.0.1/hook', subcause: 'subscription-ssrf-rejected' },
    { url: 'https://10.0.0.8/hook', subcause: 'subscription-ssrf-rejected' },
    { url: 'https://192.168.1.2/hook', subcause: 'subscription-ssrf-rejected' },
    { url: 'https://localhost/hook', subcause: 'subscription-ssrf-rejected' },
    { url: 'https://evil.example/hook', subcause: 'subscription-host-not-allowed' },
    { url: 'http://hooks.partner.example/hook', subcause: 'subscription-scheme-not-allowed' },
    { url: 'https://user:pass@hooks.partner.example/hook', subcause: 'subscription-url-credentials' },
    { url: 'https://hooks.partner.example:8443/hook', subcause: 'subscription-port-not-allowed' },
    { url: 'ftp://hooks.partner.example/hook', subcause: 'subscription-scheme-not-allowed' },
  ]
  for (const testCase of rejected) {
    it(`${testCase.url}→403 ${testCase.subcause}`, async () => {
      const fake = makeGate()
      const res = await postJson(wiredApp(fake), '/v1/subscriptions', subBody({ callbackUrl: testCase.url }), POST_HEADERS)
      expect(res.status).toBe(403)
      const body = await jsonBody(res)
      expect(errorOf(body)['subcause']).toBe(testCase.subcause)
      expect(fake.intents).toHaveLength(0)
    })
  }

  it('坏 URL＝422；缺 callbackUrl/dedupKey＝422', async () => {
    const app = wiredApp()
    const badUrl = await postJson(app, '/v1/subscriptions', subBody({ callbackUrl: 'not a url' }), POST_HEADERS)
    expect(badUrl.status).toBe(422)
    expect((await jsonBody(badUrl))['fieldPath']).toBe('callbackUrl')

    const noUrl = await postJson(app, '/v1/subscriptions', subBody({ callbackUrl: undefined }), POST_HEADERS)
    expect(noUrl.status).toBe(422)

    const noKey = await postJson(app, '/v1/subscriptions', subBody({ dedupKey: undefined }), POST_HEADERS)
    expect(noKey.status).toBe(422)
    expect((await jsonBody(noKey))['fieldPath']).toBe('dedupKey')
  })

  it('allowInsecureHttp 显式开启才放 allowlist 内 http；子域命中 allowlist', async () => {
    const insecure = makeApp({
      subscriptions: { allowlist: ['hooks.partner.example'], allowInsecureHttp: true },
    })
    const httpOk = await postJson(
      insecure,
      '/v1/subscriptions',
      subBody({ callbackUrl: 'http://hooks.partner.example/events', dedupKey: 'sub-http' }),
      POST_HEADERS,
    )
    expect(httpOk.status).toBe(202)

    const subdomain = await postJson(
      wiredApp(),
      '/v1/subscriptions',
      subBody({ callbackUrl: 'https://a.hooks.partner.example/events', dedupKey: 'sub-domain' }),
      POST_HEADERS,
    )
    expect(subdomain.status).toBe(202)
  })
})

describe('API-16 登记与幂等', () => {
  it('合法登记＝202：requestKind=subscription；GET 出本进程投影（非权威标注）', async () => {
    const fake = makeGate()
    const app = wiredApp(fake)
    const res = await postJson(app, '/v1/subscriptions', subBody(), POST_HEADERS)
    expect(res.status).toBe(202)
    expect(fake.intents).toHaveLength(1)
    const intent = fake.intents[0]
    expect(intent?.company).toEqual(COMPANY)
    expect(intent?.requestKind).toBe('subscription')
    expect(intent?.source).toBe('http')
    expect(intent?.key).toBe('sub-1')
    expect(intent?.body).toEqual({
      callbackUrl: ALLOWED_URL,
      events: ['intent.queued'],
      delivery: { mode: 'at-least-once', deadLetter: 'REC-EVT-03' },
    })
    expect(intent?.auth).toEqual({ tier: 'partner', credentialRef: 'credential:partner-1' })

    const list = await app.request('/v1/subscriptions', { headers: POST_HEADERS })
    expect(list.status).toBe(200)
    const body = await jsonBody(list)
    expect(body['total']).toBe(1)
    expect(String(body['note'])).toContain('非权威')
    const items = body['items'] as Array<Record<string, unknown>>
    expect(items[0]?.['callbackUrl']).toBe(ALLOWED_URL)
    expect(items[0]?.['events']).toEqual(['intent.queued'])
    expect(items[0]?.['dedupKey']).toBe('sub-1')
    expect(items[0]?.['intentRef']).toBe('intent-1')
  })

  it('同键同内容＝200 且登记不重复；同键异内容＝409', async () => {
    const app = wiredApp()
    expect((await postJson(app, '/v1/subscriptions', subBody(), POST_HEADERS)).status).toBe(202)
    const duplicate = await postJson(app, '/v1/subscriptions', subBody(), POST_HEADERS)
    expect(duplicate.status).toBe(200)
    expect((await jsonBody(duplicate))['deduped']).toBe(true)

    const list = await app.request('/v1/subscriptions', { headers: POST_HEADERS })
    expect((await jsonBody(list))['total']).toBe(1)

    const conflict = await postJson(
      app,
      '/v1/subscriptions',
      subBody({ events: ['intent.queued', 'intent.accepted'] }),
      POST_HEADERS,
    )
    expect(conflict.status).toBe(409)
    expect(errorOf(await jsonBody(conflict))['subcause']).toBe('rejected_idempotency')
  })

  it('events 坏形状＝422；未知槽＝422', async () => {
    const app = wiredApp()
    const badEvents = await postJson(app, '/v1/subscriptions', subBody({ events: [1] }), POST_HEADERS)
    expect(badEvents.status).toBe(422)
    const tooMany = await postJson(
      app,
      '/v1/subscriptions',
      subBody({ events: Array.from({ length: 33 }, (_, index) => `e-${String(index)}` ) }),
      POST_HEADERS,
    )
    expect(tooMany.status).toBe(422)
    const unknown = await postJson(app, '/v1/subscriptions', subBody({ deliver: true }), POST_HEADERS)
    expect(unknown.status).toBe(422)
    expect((await jsonBody(unknown))['fieldPath']).toBe('deliver')
  })

  it('PORT-GATE 拒绝→503（订阅登记不落成）', async () => {
    const fake = makeGate({ receiveIntent: () => err('unavailable', 'subscription-queue-down') })
    const app = wiredApp(fake)
    const res = await postJson(app, '/v1/subscriptions', subBody(), POST_HEADERS)
    expect(res.status).toBe(503)
    expect(errorOf(await jsonBody(res))['subcause']).toBe('subscription-queue-down')
    const list = await app.request('/v1/subscriptions', { headers: POST_HEADERS })
    expect((await jsonBody(list))['total']).toBe(0)
  })
})
