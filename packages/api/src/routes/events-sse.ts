/**
 * API-14 GET /v1/events —— SSE 订阅（event id 去重＋Last-Event-ID 断线续传）
 *
 * 依据：docs/v2/14 §四（API-14：at-least-once＋event id 去重＋断线续传；**未实装=501
 * 带原因，禁空流**）；docs/v2/15 §五 SEC-RD-01（readScope/caller 随读必带）。
 *
 * 行为：
 *   - 未装配事件源＝501 带原因（不返回 200 空流）；
 *   - 已装配：`Last-Event-ID` 头（或 ?lastEventId=）传给事件源续传；本进程按 event id
 *     去重（跨请求的进程内缓存；缓存有界）；重复事件不再下发；
 *   - 无新事件时下发一条 `ready` 事件（不是空流）；事件流在本次读源页写完后关闭——
 *     长连接常驻投递/心跳归 daemon 侧（目标未证，如实记录）。
 */
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { ApiEnv, ApiRouteDeps } from '../types.ts'
import {
  MAX_TEXT_FIELD_LENGTH,
  apiError,
  invalidRequest,
  isNonEmptyString,
  isRecord,
  readContextFor,
  resolveCompanyDimension,
} from '../http.ts'

/** 进程内已下发 event id 上限（有界；超出按插入序淘汰） */
const SEEN_EVENT_LIMIT = 4096

/** SSE 事件项校验（坏形状＝500 读不出来，不静默丢） */
function pickEvent(value: unknown): { readonly id: string; readonly event: string; readonly data: string } | undefined {
  if (!isRecord(value)) return undefined
  const id = value['id']
  const event = value['event']
  const data = value['data']
  if (!isNonEmptyString(id) || !isNonEmptyString(event) || typeof data !== 'string') return undefined
  return { id, event, data }
}

export function createEventsRoute(deps: ApiRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>()
  const seen = new Set<string>()

  app.get('/v1/events', async (c) => {
    if (deps.events === undefined) {
      return apiError(c, 501, 'sse-not-wired', 'unsupported', 'sse-not-wired', {
        reason: 'SSE 事件源未装配——不返回 200 空流；装配事件源后生效（at-least-once 投递归 daemon 侧）',
      })
    }
    const resolved = resolveCompanyDimension(c, deps)
    if (!resolved.ok) return resolved.response

    const headerAfter = c.req.header('last-event-id')
    const queryAfter = c.req.query('lastEventId')
    if (headerAfter !== undefined && headerAfter.length > MAX_TEXT_FIELD_LENGTH) {
      return invalidRequest(c, 'last-event-id', 'Last-Event-ID 长度超限')
    }
    if (queryAfter !== undefined && queryAfter.length > MAX_TEXT_FIELD_LENGTH) {
      return invalidRequest(c, 'lastEventId', 'lastEventId 长度超限')
    }
    const after = isNonEmptyString(headerAfter) ? headerAfter : isNonEmptyString(queryAfter) ? queryAfter : undefined

    const page = await deps.events.read(after, readContextFor(deps, ['events.stream'], 'external-api-events'))
    if (!isRecord(page) || !Array.isArray(page.items)) {
      throw new Error('api/events: 事件源返回形状非法（须为 {items[]}）——装配错误')
    }

    const fresh: Array<{ id: string; event: string; data: string }> = []
    for (const raw of page.items) {
      const item = pickEvent(raw)
      if (item === undefined) throw new Error('api/events: 事件项缺 id/event/data——装配错误')
      if (seen.has(item.id)) continue
      seen.add(item.id)
      fresh.push(item)
      if (seen.size > SEEN_EVENT_LIMIT) {
        const oldest = seen.values().next()
        if (oldest.done !== true) seen.delete(oldest.value)
      }
    }

    return streamSSE(c, async (stream) => {
      if (fresh.length === 0) {
        await stream.writeSSE({
          event: 'ready',
          data: JSON.stringify({ status: 'connected', backlog: 0, ...(after !== undefined ? { after } : {}) }),
          retry: 3000,
        })
        return
      }
      for (let index = 0; index < fresh.length; index += 1) {
        const item = fresh[index]
        if (item === undefined) continue
        await stream.writeSSE({
          id: item.id,
          event: item.event,
          data: item.data,
          ...(index === 0 ? { retry: 3000 } : {}),
        })
      }
    })
  })

  return app
}
