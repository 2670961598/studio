/**
 * packages/api/test/v2/request-status.test.ts —— API-08 回执查询（快照未命中=503 非 404）
 *
 * 覆盖：四槽键（公司×来源×种类×去重键）查询；命中 200 白名单回执；快照未命中 503
 * receipt-not-in-snapshot（不是 404、不是空对象）；Err 按失败类映射；越公司 403；
 * 回执 outcome 非 queued＝503（入口回执不承载受理结论）。
 */
import { describe, expect, it } from 'vitest'
import type { IntentKey, IntentReceipt } from '@studio-next/contract'
import { COMPANY, NOW, err, jsonBody, makeApp, makeGate, ok } from './fakes.ts'

function receiptFor(key: IntentKey, overrides: Partial<IntentReceipt> = {}): IntentReceipt {
  return {
    intentRef: 'intent-1',
    identity: key,
    outcome: 'queued',
    commissionerRef: 'partner-1',
    anchorRef: 'intake:governance-position',
    queuedAt: NOW,
    deduped: false,
    ...overrides,
  }
}

describe('API-08 回执查询', () => {
  it('命中：200＋白名单回执（无 acceptedAt/intakeVerdict）；四槽键原样传给 PORT-GATE', async () => {
    const fake = makeGate({ receipt: (key) => ok(receiptFor(key)) })
    const res = await makeApp({ gate: fake.gate }).request(
      '/v1/requests/status?dedupKey=idem-1&source=http&requestKind=request',
    )
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    expect(body['snapshot']).toBe('hit')
    const receipt = body['receipt'] as Record<string, unknown>
    expect(receipt['intentRef']).toBe('intent-1')
    expect(receipt['outcome']).toBe('queued')
    expect(receipt['acceptedAt']).toBeUndefined()
    expect(receipt['intakeVerdict']).toBeUndefined()
    expect(receipt['identity']).toEqual({
      company: { companyId: COMPANY.companyId, slug: COMPANY.slug },
      source: 'http',
      requestKind: 'request',
      key: 'idem-1',
    })

    expect(fake.receiptCalls).toHaveLength(1)
    expect(fake.receiptCalls[0]?.key).toEqual({
      company: COMPANY,
      source: 'http',
      requestKind: 'request',
      key: 'idem-1',
    })
    const rc = fake.receiptCalls[0]?.rc
    expect(rc?.readScope.company).toEqual(COMPANY)
    expect(rc?.readScope.fields).toContain('intent.receipt')
    expect(rc?.caller.callerId).toBe('api:public-read')
  })

  it('?key= 是 dedupKey 的别名；source/requestKind 有缺省', async () => {
    const fake = makeGate({ receipt: (key) => ok(receiptFor(key)) })
    const res = await makeApp({ gate: fake.gate }).request('/v1/requests/status?key=idem-2')
    expect(res.status).toBe(200)
    expect(fake.receiptCalls[0]?.key).toEqual({
      company: COMPANY,
      source: 'http',
      requestKind: 'request',
      key: 'idem-2',
    })
  })

  it('快照未命中＝503 receipt-not-in-snapshot（不是 404，也不是 200 空对象）', async () => {
    const res = await makeApp().request('/v1/requests/status?dedupKey=idem-unknown')
    expect(res.status).not.toBe(404)
    expect(res.status).toBe(503)
    const body = await jsonBody(res)
    const error = body['error'] as Record<string, unknown>
    expect(error['failure']).toBe('receipt-not-in-snapshot')
    expect(error['subcause']).toBe('receipt-not-in-snapshot')
    expect(error['category']).toBe('unavailable')
    expect(String(body['reason'])).toContain('查不到')
  })

  it('PORT-GATE Err：rejected_forbidden→403；rejected_idempotency→409', async () => {
    const forbidden = makeGate({ receipt: () => err('rejected_forbidden', 'read-scope-denied') })
    const denied = await makeApp({ gate: forbidden.gate }).request('/v1/requests/status?dedupKey=k')
    expect(denied.status).toBe(403)
    const deniedBody = await jsonBody(denied)
    expect((deniedBody['error'] as Record<string, unknown>)['subcause']).toBe('read-scope-denied')

    const idem = makeGate({ receipt: () => err('rejected_idempotency', 'rejected_idempotency') })
    const conflicted = await makeApp({ gate: idem.gate }).request('/v1/requests/status?dedupKey=k')
    expect(conflicted.status).toBe(409)
  })

  it('缺 dedupKey/空 dedupKey＝422 fieldPath', async () => {
    for (const path of ['/v1/requests/status', '/v1/requests/status?dedupKey=']) {
      const res = await makeApp().request(path)
      expect(res.status).toBe(422)
      const body = await jsonBody(res)
      expect(body['fieldPath']).toBe('dedupKey')
    }
  })

  it('跨公司查询＝403（NEG-SEC-02 读腿）', async () => {
    const res = await makeApp().request('/v1/requests/status?dedupKey=k&company=other')
    expect(res.status).toBe(403)
  })

  it('回执 outcome 不是 queued＝503（不把受理结论塞进入口回执）', async () => {
    const fake = makeGate({
      receipt: (key) => ok(receiptFor(key, { outcome: 'accepted' } as unknown as Partial<IntentReceipt>)),
    })
    const res = await makeApp({ gate: fake.gate }).request('/v1/requests/status?dedupKey=k')
    expect(res.status).toBe(503)
    const body = await jsonBody(res)
    expect((body['error'] as Record<string, unknown>)['subcause']).toBe('receipt-outcome-invalid')
  })
})
