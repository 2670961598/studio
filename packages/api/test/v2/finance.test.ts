/**
 * packages/api/test/v2/finance.test.ts —— API-06 财务三源（缺源=unknown 不补 0）
 *
 * 覆盖：三源恒列示；缺源段 unknown 且无 value；observed/derived 才允许数值（0 合法）；
 * unknown 携 value/observed 无值/重复源/未知源/坏 currency/window＝503（形状错不服务）。
 */
import { describe, expect, it } from 'vitest'
import { COMPANY, jsonBody, makeApp, makeReaders } from './fakes.ts'

function financeWith(segments: unknown, extra: Record<string, unknown> = {}): ReturnType<typeof makeApp> {
  return makeApp({
    readers: makeReaders({
      finance: () => ({
        company: COMPANY.slug,
        currency: 'CNY',
        window: { from: '2026-10-01', to: '2026-10-31' },
        segments: segments as never,
        ...extra,
      }),
    }),
  })
}

describe('API-06 finance：三源逐段、未知不补 0', () => {
  it('缺 monthly 源＝unknown 段且无 value 槽；其余两源数值如实', async () => {
    const res = await makeApp().request('/v1/finance')
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    const finance = body['finance'] as Record<string, unknown>
    expect(finance['company']).toBe('demo')
    expect(finance['currency']).toBe('CNY')
    const segments = finance['segments'] as Array<Record<string, unknown>>
    expect(segments.map((segment) => segment['source'])).toEqual(['budget', 'events', 'monthly'])

    const budget = segments[0]
    const events = segments[1]
    const monthly = segments[2]
    expect(budget?.['state']).toBe('observed')
    expect(budget?.['value']).toBe(1000)
    expect(events?.['value']).toBe(200)
    expect(monthly?.['state']).toBe('unknown')
    expect(monthly?.['value']).toBeUndefined()
    expect(monthly?.['stateNote']).toContain('不补 0')
    // 整个响应里不得为缺源补 0
    expect(JSON.stringify(finance)).not.toContain('"value":0')
  })

  it('三源齐全：observed 的 0 合法（0 是数值不是「未知」）', async () => {
    const res = await financeWith([
      { source: 'budget', state: 'observed', value: 0, unit: 'CNY' },
      { source: 'events', state: 'derived', value: 42, unit: 'CNY' },
      { source: 'monthly', state: 'observed', value: 100, unit: 'CNY' },
    ]).request('/v1/finance')
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    const segments = (body['finance'] as Record<string, unknown>)['segments'] as Array<Record<string, unknown>>
    expect(segments[0]?.['value']).toBe(0)
    expect(segments[1]?.['state']).toBe('derived')
    expect(segments[2]?.['value']).toBe(100)
  })

  it('segments 空数组：三源全 unknown（无 value）', async () => {
    const res = await financeWith([]).request('/v1/finance')
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    const segments = (body['finance'] as Record<string, unknown>)['segments'] as Array<Record<string, unknown>>
    expect(segments).toHaveLength(3)
    for (const segment of segments) {
      expect(segment['state']).toBe('unknown')
      expect(segment['value']).toBeUndefined()
    }
  })

  it('unknown 段携 value＝503（未知不显示为零/数）', async () => {
    const res = await financeWith([{ source: 'budget', state: 'unknown', value: 0, stateNote: 'x' }]).request(
      '/v1/finance',
    )
    expect(res.status).toBe(503)
    const body = await jsonBody(res)
    const error = body['error'] as Record<string, unknown>
    expect(error['subcause']).toBe('view-shape-invalid')
    expect(String(body['reason'])).toContain('不得携 value')
  })

  it('observed 段无 values＝503（有状态无数值＝形状错）', async () => {
    const res = await financeWith([{ source: 'budget', state: 'observed' }]).request('/v1/finance')
    expect(res.status).toBe(503)
  })

  it('重复源/未知源/坏 currency/坏 window＝503', async () => {
    const duplicated = await financeWith([
      { source: 'budget', state: 'observed', value: 1 },
      { source: 'budget', state: 'observed', value: 2 },
    ]).request('/v1/finance')
    expect(duplicated.status).toBe(503)

    const unknownSource = await financeWith([{ source: 'taiga', state: 'observed', value: 1 }]).request('/v1/finance')
    expect(unknownSource.status).toBe(503)

    const badCurrency = await financeWith([], { currency: '' }).request('/v1/finance')
    expect(badCurrency.status).toBe(503)

    const badWindow = await financeWith([], { window: { from: '', to: '2026-10-31' } }).request('/v1/finance')
    expect(badWindow.status).toBe(503)
  })

  it('账段多余字段被白名单挡掉', async () => {
    const res = await financeWith([
      { source: 'budget', state: 'observed', value: 5, unit: 'CNY', secretAccount: '不得外露' },
    ]).request('/v1/finance')
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    expect(JSON.stringify(body)).not.toContain('secretAccount')
    expect(JSON.stringify(body)).not.toContain('不得外露')
    const window = (body['finance'] as Record<string, unknown>)['window'] as Record<string, unknown>
    expect(window['from']).toBe('2026-10-01')
  })
})
