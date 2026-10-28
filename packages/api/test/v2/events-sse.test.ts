/**
 * packages/api/test/v2/events-sse.test.ts —— API-14 SSE（去重＋断线续传＋禁空流）
 *
 * 覆盖：
 *   ① 未装配事件源＝501 带原因（不是 200 空流）；
 *   ② 事件流：text/event-stream＋event id；重复 id 同页去重；
 *   ③ Last-Event-ID 头/?lastEventId= 传给事件源续传；
 *   ④ 跨请求 event id 去重（进程内缓存）；无新事件下发 ready 事件（非空流）；
 *   ⑤ 事件源抛错/形状坏＝500（读不出来不伪装空流）；越公司 403。
 */
import { describe, expect, it } from 'vitest'
import type { ApiEventFeed, ApiEventFeedPage } from '../../src/index.ts'
import { jsonBody, makeApp } from './fakes.ts'

function feedOf(items: ApiEventFeedPage['items'], onRead?: (after: string | undefined) => void): ApiEventFeed {
  return {
    read: (after) => {
      onRead?.(after)
      return { items }
    },
  }
}

function eventOf(id: string, event = 'intent.queued', data = '{"intentRef":"intent-1"}'): {
  id: string
  event: string
  data: string
} {
  return { id, event, data }
}

describe('API-14 SSE 装配与续传', () => {
  it('未装配＝501 带原因（json，非空流）', async () => {
    const res = await makeApp().request('/v1/events')
    expect(res.status).toBe(501)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = await jsonBody(res)
    expect((body['error'] as Record<string, unknown>)['subcause']).toBe('sse-not-wired')
    expect(String(body['reason'])).toContain('空流')
  })

  it('事件流：text/event-stream＋id/event/data；同页重复 id 只发一次', async () => {
    const app = makeApp({ events: feedOf([eventOf('e-1'), eventOf('e-2'), eventOf('e-1')]) })
    const res = await app.request('/v1/events')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await res.text()
    expect(text).toContain('id: e-1')
    expect(text).toContain('id: e-2')
    expect(text).toContain('event: intent.queued')
    expect(text).toContain('data: {"intentRef":"intent-1"}')
    expect(text.match(/id: e-1/g)).toHaveLength(1)
    expect(text.match(/id: e-2/g)).toHaveLength(1)
    expect(text).toContain('retry: 3000')
    expect(text.trim().length).toBeGreaterThan(0)
  })

  it('Last-Event-ID 头优先于 ?lastEventId=，原样传给事件源', async () => {
    const seen: Array<string | undefined> = []
    const app = makeApp({ events: feedOf([eventOf('e-3')], (after) => seen.push(after)) })
    await (await app.request('/v1/events?lastEventId=from-query', { headers: { 'last-event-id': 'from-header' } })).text()
    await (await app.request('/v1/events?lastEventId=from-query')).text()
    expect(seen).toEqual(['from-header', 'from-query'])
  })

  it('无新事件＝ready 事件（不返回空流）', async () => {
    const app = makeApp({ events: feedOf([]) })
    const res = await app.request('/v1/events')
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('event: ready')
    expect(text).toContain('"backlog":0')
    expect(text.trim().length).toBeGreaterThan(0)
  })

  it('跨请求 event id 去重：已发过的事件不再下发（ready 顶替）', async () => {
    const app = makeApp({ events: feedOf([eventOf('e-1')]) })
    const first = await (await app.request('/v1/events')).text()
    expect(first).toContain('id: e-1')
    const second = await (await app.request('/v1/events')).text()
    expect(second).not.toContain('id: e-1')
    expect(second).toContain('event: ready')
  })

  it('Last-Event-ID 超长＝422', async () => {
    const app = makeApp({ events: feedOf([]) })
    const res = await app.request('/v1/events', { headers: { 'last-event-id': 'x'.repeat(201) } })
    expect(res.status).toBe(422)
  })

  it('跨公司读＝403（读上下文公司维前置）', async () => {
    let called = false
    const app = makeApp({
      events: {
        read: () => {
          called = true
          return { items: [] }
        },
      },
    })
    const res = await app.request('/v1/events?company=other')
    expect(res.status).toBe(403)
    expect(called).toBe(false)
  })

  it('事件源抛错/形状坏＝500（读不出来不伪装空流）', async () => {
    const throwing = makeApp({
      events: {
        read: () => {
          throw new Error('事件源不可用（测试）')
        },
      },
    })
    expect((await throwing.request('/v1/events')).status).toBe(500)

    const malformed = makeApp({
      events: { read: () => ({ items: 'nope' } as unknown as ApiEventFeedPage) },
    })
    expect((await malformed.request('/v1/events')).status).toBe(500)
  })
})
