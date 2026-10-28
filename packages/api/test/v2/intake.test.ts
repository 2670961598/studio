/**
 * packages/api/test/v2/intake.test.ts —— 触发族 API-10..13（只落单不派工）
 *
 * 覆盖：
 *   ① 四条路由 202＝已入队≠已受理（回执 outcome 只有 queued；无 acceptedAt/intakeVerdict）；
 *   ② 意图四槽（公司×来源×种类×去重键）与 commissioner/dispatcherAnchor 公共槽；
 *   ③ 幂等：同键同内容=200＋deduped；同键异内容=409；异种类=不同槽；
 *   ④ 认证：缺凭据 401、吊销 403、root 凭据 403、partner/signed 两档可入；
 *   ⑤ 公司维：query/body 同规则、错绑 403、两者冲突 422；
 *   ⑥ 校验/上限：缺 dedupKey/commissioner/body、未知槽、413、坏 JSON＝4xx；
 *   ⑦ PORT-GATE 失败类→HTTP 映射；写面唯一动作＝receiveIntent。
 */
import { describe, expect, it } from 'vitest'
import type { ExternalIntent } from '@studio-next/contract'
import { COMPANY, err, intakeBody, jsonBody, makeApp, makeGate, postJson } from './fakes.ts'

const TRIGGERS = [
  { path: '/v1/requests', kind: 'request' },
  { path: '/v1/explore', kind: 'explore' },
  { path: '/v1/tasks', kind: 'task' },
  { path: '/v1/intel', kind: 'intel' },
] as const

function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return jsonBody(res)
}

function errorOf(body: Record<string, unknown>): Record<string, unknown> {
  return body['error'] as Record<string, unknown>
}

describe('API-10..13 触发面：只产意图（202=入队≠受理）', () => {
  for (const trigger of TRIGGERS) {
    it(`${trigger.path}：202＋queued 回执；四槽/署名/锚/只落单`, async () => {
      const fake = makeGate()
      const app = makeApp({ gate: fake.gate })
      const res = await postJson(app, trigger.path, intakeBody({ dedupKey: `idem-${trigger.kind}` }))
      expect(res.status).toBe(202)

      const body = await bodyOf(res)
      expect(body['ok']).toBe(true)
      expect(body['enqueued']).toBe(true)
      expect(body['deduped']).toBe(false)
      expect(String(body['note'])).toContain('202=已入队≠已受理')
      const receipt = body['receipt'] as Record<string, unknown>
      expect(receipt['outcome']).toBe('queued')
      expect(receipt['acceptedAt']).toBeUndefined()
      expect(receipt['intakeVerdict']).toBeUndefined()
      expect(receipt['identity']).toEqual({
        company: { companyId: COMPANY.companyId, slug: COMPANY.slug },
        source: 'http',
        requestKind: trigger.kind,
        key: `idem-${trigger.kind}`,
      })

      // 唯一写动作＝PORT-GATE.receiveIntent
      expect(fake.intents).toHaveLength(1)
      const intent = fake.intents[0] as ExternalIntent
      expect(intent.company).toEqual(COMPANY)
      expect(intent.source).toBe('http')
      expect(intent.requestKind).toBe(trigger.kind)
      expect(intent.key).toBe(`idem-${trigger.kind}`)
      expect(intent.toolScope).toBe('intake_comment')
      expect(intent.commissioner).toEqual({
        mapped: true,
        caller: { callerId: 'partner-1', kind: 'program', programRef: 'PARTNER' },
      })
      expect(intent.dispatcherAnchor).toEqual({ defaulted: true, resolvedBy: 'intake_governance_position' })
      expect(intent.payloadDigest.startsWith('sha256:')).toBe(true)
      expect(intent.receivedAt).toBe('2026-10-28T00:00:00.000Z')

      // 署名三值：system 代写必带 onBehalfOf（可还原委托主体）；权源主张不是 token
      expect(fake.contexts).toHaveLength(1)
      expect(fake.contexts[0]?.signature).toEqual({
        actorKind: 'system',
        actorRef: 'api:intake',
        onBehalfOf: 'partner-1',
      })
      expect(fake.contexts[0]?.authority).toEqual([])
      expect(fake.contexts[0]?.company).toEqual(COMPANY)

      // 响应面没有任何派工字段
      expect(body['worker']).toBeUndefined()
      expect(body['issue']).toBeUndefined()
      expect(body['launch']).toBeUndefined()
    })
  }

  it('同键同内容＝200＋deduped（不产生第二次副作用）；同键异内容＝409', async () => {
    const fake = makeGate()
    const app = makeApp({ gate: fake.gate })
    const first = await postJson(app, '/v1/requests', intakeBody({ dedupKey: 'idem-dup' }))
    expect(first.status).toBe(202)
    const firstReceipt = (await bodyOf(first))['receipt'] as Record<string, unknown>

    const second = await postJson(app, '/v1/requests', intakeBody({ dedupKey: 'idem-dup' }))
    expect(second.status).toBe(200)
    const secondBody = await bodyOf(second)
    expect(secondBody['deduped']).toBe(true)
    expect((secondBody['receipt'] as Record<string, unknown>)['intentRef']).toBe(firstReceipt['intentRef'])

    const conflict = await postJson(app, '/v1/requests', intakeBody({ dedupKey: 'idem-dup', body: { title: '不同内容' } }))
    expect(conflict.status).toBe(409)
    expect(errorOf(await bodyOf(conflict))['subcause']).toBe('rejected_idempotency')
    expect(fake.intents).toHaveLength(3)
  })

  it('同键异种类＝不同四槽（种类是键的一部分，不互相顶掉）', async () => {
    const fake = makeGate()
    const app = makeApp({ gate: fake.gate })
    expect((await postJson(app, '/v1/requests', intakeBody({ dedupKey: 'same' }))).status).toBe(202)
    expect((await postJson(app, '/v1/tasks', intakeBody({ dedupKey: 'same' }))).status).toBe(202)
    expect(fake.intents.map((intent) => intent.requestKind)).toEqual(['request', 'task'])
  })
})

describe('触发面认证与公司维', () => {
  it('缺凭据 401；吊销 403；root 凭据 403（root 不入接口面）', async () => {
    const fake = makeGate()
    const app = makeApp({ gate: fake.gate })
    const missing = await postJson(app, '/v1/requests', intakeBody(), {})
    expect(missing.status).toBe(401)
    expect(errorOf(await bodyOf(missing))['subcause']).toBe('credential-missing')

    const revoked = await postJson(app, '/v1/requests', intakeBody(), { 'x-sn-credential': 'forbidden' })
    expect(revoked.status).toBe(403)
    expect(errorOf(await bodyOf(revoked))['subcause']).toBe('credential-revoked')

    const root = await postJson(app, '/v1/requests', intakeBody(), { 'x-sn-credential': 'root:key' })
    expect(root.status).toBe(403)
    expect(errorOf(await bodyOf(root))['subcause']).toBe('root-credential-forbidden')
    expect(fake.intents).toHaveLength(0)
  })

  it('signed 档可入；IntentAuth 原样交给 PORT-GATE', async () => {
    const fake = makeGate()
    const app = makeApp({ gate: fake.gate })
    const res = await postJson(app, '/v1/requests', intakeBody(), { 'x-sn-credential': 'signed:ok' })
    expect(res.status).toBe(202)
    expect(fake.intents[0]?.auth).toEqual({
      tier: 'signed',
      hmacRef: 'hmac:partner-2',
      timestamp: '1',
      nonce: 'n-1',
    })
  })

  it('?company= 错绑 403；body.company 错绑 403；query/body 同给须同时同维', async () => {
    const app = makeApp()
    const queryWrong = await postJson(app, '/v1/requests?company=other', intakeBody())
    expect(queryWrong.status).toBe(403)
    expect(errorOf(await bodyOf(queryWrong))['subcause']).toBe('company-scope-mismatch')

    const bodyWrong = await postJson(app, '/v1/requests', intakeBody({ company: 'other' }))
    expect(bodyWrong.status).toBe(403)

    const conflict = await postJson(app, '/v1/requests?company=demo', intakeBody({ company: 'other' }))
    expect(conflict.status).toBe(403)
    expect(errorOf(await bodyOf(conflict))['subcause']).toBe('company-scope-mismatch')

    const same = await postJson(app, '/v1/requests?company=demo', intakeBody({ company: COMPANY.companyId }))
    expect(same.status).toBe(202)

    const nonString = await postJson(app, '/v1/requests', intakeBody({ company: 42 }))
    expect(nonString.status).toBe(422)
  })
})

describe('触发面请求校验', () => {
  it('缺/空 dedupKey＝422；Idempotency-Key 头可替代；与 body 冲突＝422', async () => {
    const app = makeApp()
    const missing = await postJson(app, '/v1/requests', intakeBody({ dedupKey: undefined }))
    expect(missing.status).toBe(422)
    expect((await bodyOf(missing))['fieldPath']).toBe('dedupKey')

    const viaHeader = await postJson(app, '/v1/requests', intakeBody({ dedupKey: undefined }), {
      'x-sn-credential': 'partner:ok',
      'idempotency-key': 'idem-header',
    })
    expect(viaHeader.status).toBe(202)

    const conflict = await postJson(app, '/v1/requests', intakeBody({ dedupKey: 'a' }), {
      'x-sn-credential': 'partner:ok',
      'idempotency-key': 'b',
    })
    expect(conflict.status).toBe(422)
  })

  it('缺 commissioner/body、requestKind 错位、未知槽＝422', async () => {
    const app = makeApp()
    const noCommissioner = await postJson(app, '/v1/requests', intakeBody({ commissioner: undefined }))
    expect(noCommissioner.status).toBe(422)
    expect((await bodyOf(noCommissioner))['fieldPath']).toBe('commissioner')

    const badCommissioner = await postJson(
      app,
      '/v1/requests',
      intakeBody({ commissioner: { mapped: false, externalPrincipal: 'acme' } }),
    )
    expect(badCommissioner.status).toBe(422)

    const noBody = await postJson(app, '/v1/requests', intakeBody({ body: undefined }))
    expect(noBody.status).toBe(422)
    expect((await bodyOf(noBody))['fieldPath']).toBe('body')

    const arrayBody = await postJson(app, '/v1/requests', intakeBody({ body: [] }))
    expect(arrayBody.status).toBe(422)

    const wrongKind = await postJson(app, '/v1/requests', intakeBody({ requestKind: 'task' }))
    expect(wrongKind.status).toBe(422)
    expect((await bodyOf(wrongKind))['fieldPath']).toBe('requestKind')

    const unknownField = await postJson(app, '/v1/requests', intakeBody({ priority: 'P0' }))
    expect(unknownField.status).toBe(422)
    expect((await bodyOf(unknownField))['fieldPath']).toBe('priority')
  })

  it('未映射委托主体（显式 externalPrincipal＋identity_mapping 依据）可入；回执带 external ref', async () => {
    const fake = makeGate()
    const app = makeApp({ gate: fake.gate })
    const res = await postJson(
      app,
      '/v1/requests',
      intakeBody({
        commissioner: { mapped: false, externalPrincipal: 'acme-corp', identityMappingBasis: 'contract-2026-10' },
      }),
    )
    expect(res.status).toBe(202)
    expect(fake.intents[0]?.commissioner).toEqual({
      mapped: false,
      externalPrincipal: 'acme-corp',
      identityMappingBasis: 'contract-2026-10',
    })
    expect(fake.contexts[0]?.signature).toEqual({
      actorKind: 'system',
      actorRef: 'api:intake',
      onBehalfOf: 'external:acme-corp',
    })
    const receipt = (await bodyOf(res))['receipt'] as Record<string, unknown>
    expect(receipt['commissionerRef']).toBe('external:acme-corp')
  })

  it('显式 dispatcherAnchor 透传；correlation 透传并进摘要输入', async () => {
    const fake = makeGate()
    const app = makeApp({ gate: fake.gate })
    const res = await postJson(
      app,
      '/v1/requests',
      intakeBody({
        dispatcherAnchor: { anchor: { callerId: 'pm-1', kind: 'position', positionRef: 'pos:pm' } },
        correlation: 'corr-1',
      }),
    )
    expect(res.status).toBe(202)
    expect(fake.intents[0]?.dispatcherAnchor).toEqual({
      anchor: { callerId: 'pm-1', kind: 'position', positionRef: 'pos:pm' },
    })
    expect(fake.intents[0]?.correlation).toBe('corr-1')
    const receipt = (await bodyOf(res))['receipt'] as Record<string, unknown>
    expect(receipt['anchorRef']).toBe('pm-1')
  })

  it('坏 JSON＝422；超长载荷＝413', async () => {
    const app = makeApp()
    const badJson = await app.request('/v1/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sn-credential': 'partner:ok' },
      body: '{bad',
    })
    expect(badJson.status).toBe(422)

    const huge = await postJson(app, '/v1/requests', intakeBody({ body: { text: 'x'.repeat(100_001) } }))
    expect(huge.status).toBe(413)
    const body = await bodyOf(huge)
    expect(JSON.stringify(body)).toContain('payload-too-large')
  })
})

describe('PORT-GATE 失败类映射（Err 只表确定未产生外部效果）', () => {
  const cases = [
    { category: 'unavailable', status: 503 },
    { category: 'unsupported', status: 501 },
    { category: 'rejected_precondition', status: 422 },
    { category: 'rejected_forbidden', status: 403 },
    { category: 'rejected_state', status: 409 },
    { category: 'timeout', status: 503 },
  ] as const
  for (const testCase of cases) {
    it(`${testCase.category}→${String(testCase.status)}`, async () => {
      const fake = makeGate({
        receiveIntent: () => err(testCase.category, `subcause-${testCase.category}`),
      })
      const res = await postJson(makeApp({ gate: fake.gate }), '/v1/requests', intakeBody())
      expect(res.status).toBe(testCase.status)
      const body = await bodyOf(res)
      const error = errorOf(body)
      expect(error['failure']).toBe('intent-rejected')
      expect(error['category']).toBe(testCase.category)
      expect(error['subcause']).toBe(`subcause-${testCase.category}`)
    })
  }
})
