/**
 * 制作人-岗位持久对话 · DM 解析与源分流测试（studio-dev-646 Phase 1）
 *
 * 覆盖（docs/21-§七.3/§七.5）：DM 白名单房内制作人消息产会话意图（payload.conversation）、
 * 非制作人/非白名单/非文本不产、DM 房内 @ 不产 mention 双派单、非 DM 房 @唤醒行为零变。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InvokeIntent } from '@studio-next/contract'
import { createMentionSource } from '../../src/adapter.ts'
import { MatrixClient, type FetchInit, type FetchLike, type FetchResponse } from '../../src/client.ts'
import { parseDmMessage } from '../../src/conversation.ts'

class FakeFetch {
  readonly calls: { url: string; init: FetchInit }[] = []
  private readonly queue: (FetchResponse | Error)[] = []

  enqueueJson(status: number, body: unknown): void {
    this.queue.push({ ok: status < 400, status, json: async () => body })
  }

  readonly fetchLike: FetchLike = (url, init) => {
    this.calls.push({ url, init })
    const next = this.queue.shift()
    if (next === undefined) return Promise.reject(new Error(`fake fetch: 队列空，未预造 ${init.method ?? 'GET'} ${url}`))
    if (next instanceof Error) return Promise.reject(next)
    return Promise.resolve(next)
  }
}

function makeClient(ff: FakeFetch): MatrixClient {
  return new MatrixClient({ baseUrl: 'http://127.0.0.1:8008/', fetch: ff.fetchLike, accessToken: 'tok' })
}

function syncBody(nextBatch: string, join?: Record<string, { timeline?: { events?: unknown[] } }>): unknown {
  return join === undefined ? { next_batch: nextBatch } : { next_batch: nextBatch, rooms: { join } }
}

function message(overrides: Record<string, unknown>): unknown {
  return {
    type: 'm.room.message',
    event_id: '$e1',
    sender: '@producer:localhost',
    content: { msgtype: 'm.text', body: '你好' },
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('parseDmMessage（纯解析）', () => {
  const cfg = { company: 'acme' as const, producerUserId: '@producer:localhost', rooms: ['!dm:localhost'] }

  it('制作人 + 白名单 DM 房 + m.text → 一条会话意图（target 留空、dedupKey=eventId）', () => {
    const intent = parseDmMessage(
      { eventId: '$m1', roomId: '!dm:localhost', sender: '@producer:localhost', msgtype: 'm.text', body: '在吗' },
      cfg,
    )
    expect(intent?.kind).toBe('mention')
    expect(intent?.source).toBe('matrix')
    expect(intent?.dedupKey).toBe('$m1')
    expect(intent?.payload).toMatchObject({
      target: '',
      mention: 'DM',
      text: '在吗',
      eventId: '$m1',
      sender: '@producer:localhost',
      room: '!dm:localhost',
      conversation: { v: 1 },
    })
  })

  it('非制作人/非白名单房/非 m.text/空正文 → 不产意图（fail-closed）', () => {
    const base = { eventId: '$m1', roomId: '!dm:localhost', sender: '@producer:localhost', msgtype: 'm.text', body: 'x' }
    expect(parseDmMessage({ ...base, sender: '@other:localhost' }, cfg)).toBeUndefined()
    expect(parseDmMessage({ ...base, roomId: '!hall:localhost' }, cfg)).toBeUndefined()
    expect(parseDmMessage({ ...base, msgtype: 'm.notice' }, cfg)).toBeUndefined()
    expect(parseDmMessage({ ...base, body: '   ' }, cfg)).toBeUndefined()
    expect(parseDmMessage(base, { company: cfg.company, producerUserId: cfg.producerUserId })).toBeUndefined()
  })
})

describe('createMentionSource · DM 与会话互斥', () => {
  it('DM 房制作人消息产会话意图（含 @ 词元也不产 mention）；非 DM 房 @ 仍走唤醒', async () => {
    vi.useFakeTimers()
    const ff = new FakeFetch()
    const source = createMentionSource({
      client: makeClient(ff),
      company: 'acme',
      selfUserId: '@bot:localhost',
      dmRooms: ['!dm:localhost'],
      producerUserId: '@producer:localhost',
      pollIntervalMs: 100,
    })
    const got: InvokeIntent[] = []
    ff.enqueueJson(200, syncBody('t1')) // 基线
    ff.enqueueJson(
      200,
      syncBody('t2', {
        '!dm:localhost': {
          timeline: {
            events: [
              message({ event_id: '$dm1', content: { msgtype: 'm.text', body: '@AGENT-3 帮我看下' } }),
              message({ event_id: '$dm2', sender: '@someone:localhost', content: { msgtype: 'm.text', body: '插话' } }),
              message({ event_id: '$dm3', sender: '@bot:localhost', content: { msgtype: 'm.text', body: 'bot 自己' } }),
            ],
          },
        },
        '!hall:localhost': {
          timeline: {
            events: [message({ event_id: '$h1', content: { msgtype: 'm.text', body: '@AGENT-3 频道里唤醒' } })],
          },
        },
      }),
    )
    source.start((intent) => got.push(intent))
    await vi.advanceTimersByTimeAsync(0)
    expect(got).toEqual([])
    await vi.advanceTimersByTimeAsync(100)

    expect(got).toHaveLength(2)
    const dm = got.find((i) => i.dedupKey === '$dm1')
    expect(dm?.payload).toMatchObject({ room: '!dm:localhost', conversation: { v: 1 }, target: '' })
    expect(dm?.payload).not.toMatchObject({ target: 'AGENT-3' })
    const mention = got.find((i) => i.dedupKey === '$h1')
    expect(mention?.payload).toMatchObject({ target: 'AGENT-3', mention: '@AGENT-3' })
    expect(got.some((i) => i.dedupKey === '$dm2' || i.dedupKey === '$dm3')).toBe(false)
    source.stop()
  })

  it('dmRooms 给但 producer 缺省 → DM 房不产意图（fail-closed；频道 @ 不受影响）', async () => {
    vi.useFakeTimers()
    const ff = new FakeFetch()
    const source = createMentionSource({
      client: makeClient(ff),
      company: 'acme',
      selfUserId: '@bot:localhost',
      dmRooms: ['!dm:localhost'],
      pollIntervalMs: 100,
    })
    const got: InvokeIntent[] = []
    ff.enqueueJson(200, syncBody('t1'))
    ff.enqueueJson(200, syncBody('t2', { '!dm:localhost': { timeline: { events: [message({ event_id: '$dm1' })] } } }))
    source.start((intent) => got.push(intent))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(100)
    expect(got).toEqual([])
    source.stop()
  })
})
