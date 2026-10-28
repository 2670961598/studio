/**
 * packages/api/test/v2/agent-card.test.ts —— API-09 Agent Card（版本＋有效期＋端点表）
 *
 * 覆盖：名片带 version 与 validFrom/validUntil；validity 三态（pending/active/expired）
 * 按注入时钟如实计算；缺版本/坏有效期/公司维不符＝503（不伪造新鲜日期）；端点表与
 * API_ENDPOINTS 同源（16 条）；读源多余字段不外露。
 */
import { describe, expect, it } from 'vitest'
import type { ApiAgentCardView } from '../../src/index.ts'
import { API_ENDPOINTS } from '../../src/index.ts'
import { COMPANY, jsonBody, makeApp, makeReaders } from './fakes.ts'

const BASE_CARD: ApiAgentCardView = {
  company: COMPANY.slug,
  name: 'Demo 公司',
  slug: COMPANY.slug,
  version: '1.0.0',
  validFrom: '2026-01-01T00:00:00.000Z',
  validUntil: '2027-01-01T00:00:00.000Z',
  capabilities: ['intake', 'read'],
}

function appWith(card: unknown): ReturnType<typeof makeApp> {
  return makeApp({ readers: makeReaders({ agentCard: () => card as never }) })
}

describe('API-09 Agent Card', () => {
  it('正例：版本＋有效期＋端点表（与路由目录同源）＋active 三态', async () => {
    const res = await appWith({ ...BASE_CARD, extraSecret: '不得外露' }).request('/v1/agent-card')
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    const card = body['card'] as Record<string, unknown>
    expect(card['company']).toBe('demo')
    expect(card['version']).toBe('1.0.0')
    expect(card['validFrom']).toBe('2026-01-01T00:00:00.000Z')
    expect(card['validUntil']).toBe('2027-01-01T00:00:00.000Z')
    expect(card['extraSecret']).toBeUndefined()
    expect(card['capabilities']).toEqual(['intake', 'read'])

    const validity = body['validity'] as Record<string, unknown>
    expect(validity['state']).toBe('active')
    expect(validity['checkedAt']).toBe('2026-10-28T00:00:00.000Z')

    const endpoints = body['endpoints'] as Array<Record<string, unknown>>
    expect(endpoints).toHaveLength(16)
    expect(endpoints).toEqual(API_ENDPOINTS)
    expect(body['readOnly']).toBe(true)
  })

  it('未生效＝pending（到点未生效≠已生效）', async () => {
    const res = await appWith({ ...BASE_CARD, validFrom: '2027-06-01T00:00:00.000Z', validUntil: '2027-12-01T00:00:00.000Z' }).request(
      '/v1/agent-card',
    )
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    expect((body['validity'] as Record<string, unknown>)['state']).toBe('pending')
  })

  it('过期＝expired（如实标注；不重发新鲜日期）', async () => {
    const res = await appWith({ ...BASE_CARD, validFrom: '2025-01-01T00:00:00.000Z', validUntil: '2025-12-31T00:00:00.000Z' }).request(
      '/v1/agent-card',
    )
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    expect((body['validity'] as Record<string, unknown>)['state']).toBe('expired')
    expect((body['card'] as Record<string, unknown>)['validUntil']).toBe('2025-12-31T00:00:00.000Z')
  })

  it('缺 version/name、坏日期、until<=from＝503', async () => {
    const cases: unknown[] = [
      { ...BASE_CARD, version: '' },
      { ...BASE_CARD, name: '' },
      { ...BASE_CARD, validFrom: 'not-a-date' },
      { ...BASE_CARD, validUntil: '2026-01-01T00:00:00.000Z' },
    ]
    for (const card of cases) {
      const res = await appWith(card).request('/v1/agent-card')
      expect(res.status).toBe(503)
      const body = await jsonBody(res)
      const error = body['error'] as Record<string, unknown>
      expect(error['subcause']).toBe('view-shape-invalid')
    }
  })

  it('slug 与挂载公司不符＝503（跨公司读隔离）', async () => {
    const res = await appWith({ ...BASE_CARD, company: 'other', slug: 'other' }).request('/v1/agent-card')
    expect(res.status).toBe(503)
  })

  it('读源未提供名片＝503（不伪造一张）', async () => {
    const res = await makeApp({ readers: makeReaders({ agentCard: () => undefined }) }).request('/v1/agent-card')
    expect(res.status).toBe(503)
  })
})
