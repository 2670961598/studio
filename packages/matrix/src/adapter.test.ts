/**
 * adapter + client 集成测：注入 fake fetch 回放预造 JSON，绝不真实联网
 *
 * 覆盖：login→sync(空)→sync(带唤醒消息)→恰一条意图；发送路径请求体形状；
 * 自发消息过滤；房间白名单；指数退避（翻倍/上限/复位）；stop() 干净停轮询。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMatrixNotifier, createMentionSource } from './adapter.ts'
import { MatrixClient, type FetchInit, type FetchLike, type FetchResponse } from './client.ts'
import type { InvokeIntent } from '@studio-next/contract'

/** 手写 stub：预造响应队列 + 请求录像（node:test 风格，零测试库依赖） */
class FakeFetch {
  readonly calls: { url: string; init: FetchInit }[] = []
  private readonly queue: (FetchResponse | Error)[] = []

  enqueueJson(status: number, body: unknown): void {
    this.queue.push({ ok: status < 400, status, json: async () => body })
  }

  enqueueError(): void {
    this.queue.push(new Error('fake fetch: 网络故障'))
  }

  readonly fetchLike: FetchLike = (url, init) => {
    this.calls.push({ url, init })
    const next = this.queue.shift()
    if (next === undefined) return Promise.reject(new Error(`fake fetch: 队列空，未预造 ${init.method ?? 'GET'} ${url}`))
    if (next instanceof Error) return Promise.reject(next)
    return Promise.resolve(next)
  }
}

function makeClient(ff: FakeFetch, accessToken?: string): MatrixClient {
  return new MatrixClient({
    baseUrl: 'http://127.0.0.1:8008/',
    fetch: ff.fetchLike,
    ...(accessToken !== undefined ? { accessToken } : {}),
  })
}

function syncBody(nextBatch: string, join?: Record<string, { timeline?: { events?: unknown[] } }>): unknown {
  return join === undefined ? { next_batch: nextBatch } : { next_batch: nextBatch, rooms: { join } }
}

const WAKE_EVENT = {
  type: 'm.room.message',
  event_id: '$m1',
  sender: '@producer:localhost',
  origin_server_ts: 1_790_000_000_000,
  content: { msgtype: 'm.text', body: '@AGENT-3 看下 STUDIO-100' },
}

afterEach(() => {
  vi.useRealTimers()
})

describe('client + notifier · 发送路径请求形状', () => {
  it('login 请求体：m.login.password + identifier；登录后带 Bearer', async () => {
    const ff = new FakeFetch()
    const client = makeClient(ff, 'tok-1')
    ff.enqueueJson(200, { user_id: '@bot:localhost', access_token: 'tok-1', device_id: 'DEV' })
    const login = await client.login('@bot:localhost', 'pw')
    expect(login).toEqual({ userId: '@bot:localhost', accessToken: 'tok-1', deviceId: 'DEV' })
    expect(client.userId).toBe('@bot:localhost')

    const call = ff.calls[0]
    if (call === undefined) throw new Error('login 未发请求')
    expect(call.init.method).toBe('POST')
    expect(call.url).toBe('http://127.0.0.1:8008/_matrix/client/v3/login')
    expect(JSON.parse(call.init.body ?? '{}')).toEqual({
      type: 'm.login.password',
      identifier: { type: 'm.user.user', user: '@bot:localhost' },
      password: 'pw',
    })

    ff.enqueueJson(200, { event_id: '$e1' })
    const notifier = createMatrixNotifier(client)
    await notifier.send('!hall:localhost', {
      kind: 'alert',
      title: '预算超限',
      body: 'WORKER-3 已用 $12.50',
      links: [{ label: '单据', url: 'https://yt.local/issue/STUDIO-100' }],
    })
    const send = ff.calls[1]
    if (send === undefined) throw new Error('sendMessage 未发请求')
    expect(send.init.method).toBe('PUT')
    expect(send.url).toContain(
      `/_matrix/client/v3/rooms/${encodeURIComponent('!hall:localhost')}/send/m.room.message/`,
    )
    expect(send.init.headers?.['Authorization']).toBe('Bearer tok-1')
    expect(send.init.headers?.['Content-Type']).toBe('application/json')
    expect(JSON.parse(send.init.body ?? '{}')).toEqual({
      msgtype: 'm.text',
      body: [
        '[alert] **预算超限**',
        'WORKER-3 已用 $12.50',
        '- [单据](https://yt.local/issue/STUDIO-100)',
      ].join('\n'),
    })
  })

  it('非 2xx 抛带状态的 Error（不抛裸字符串）；未登录调用受保护端点直接报错', async () => {
    const ff = new FakeFetch()
    const client = makeClient(ff, 'bad-token')
    ff.enqueueJson(403, { errcode: 'M_FORBIDDEN', error: 'bad token' })
    await expect(client.sync()).rejects.toThrow(/403.*M_FORBIDDEN/)
    const fresh = makeClient(new FakeFetch())
    await expect(fresh.sync()).rejects.toThrow('未登录')
  })
})

describe('mention source · 轮询唤起', () => {
  it('login→sync(空)→sync(带唤醒消息)：恰一条 mention 意图；sync 请求带 since 与鉴权', async () => {
    vi.useFakeTimers()
    const ff = new FakeFetch()
    const client = makeClient(ff)
    ff.enqueueJson(200, { user_id: '@bot:localhost', access_token: 'tok-1' })
    await client.login('@bot:localhost', 'pw')

    const source = createMentionSource({
      client,
      company: 'acme',
      selfUserId: '@bot:localhost',
      roles: { 宰相: 'PRIME-0' },
      pollIntervalMs: 100,
    })
    const got: InvokeIntent[] = []
    ff.enqueueJson(200, syncBody('t1')) // 首拉：空，建基线
    ff.enqueueJson(200, syncBody('t2', {
      '!dept:localhost': { timeline: { events: [WAKE_EVENT] } },
    }))
    source.start((intent) => got.push(intent))

    await vi.advanceTimersByTimeAsync(0) // 首拉完成（基线）
    expect(got).toEqual([])
    await vi.advanceTimersByTimeAsync(100) // 第二拉：唤醒消息
    expect(got).toHaveLength(1)
    const intent = got[0]
    if (intent === undefined) throw new Error('unreachable')
    expect(intent.kind).toBe('mention')
    expect(intent.company).toBe('acme')
    expect(intent.source).toBe('matrix')
    expect(intent.payload).toMatchObject({
      target: 'AGENT-3',
      mention: '@AGENT-3',
      room: '!dept:localhost',
      channel: '!dept:localhost',
      sender: '@producer:localhost',
      text: '@AGENT-3 看下 STUDIO-100',
    })

    // 第二拉请求形状：GET /sync?timeout=0&since=t1 + Bearer
    const secondSync = ff.calls[2]
    if (secondSync === undefined) throw new Error('第二拉未发出')
    expect(secondSync.init.method).toBe('GET')
    expect(secondSync.url).toContain('/_matrix/client/v3/sync?')
    expect(secondSync.url).toContain('timeout=0')
    expect(secondSync.url).toContain('since=t1')
    expect(secondSync.init.headers?.Authorization).toBe('Bearer tok-1')

    source.stop()
  })

  it('历史消息不唤起：首拉里已有唤醒消息也不 emit（防重放）', async () => {
    vi.useFakeTimers()
    const ff = new FakeFetch()
    const client = makeClient(ff, 'tok-1')
    ff.enqueueJson(200, syncBody('t1', { '!dept:localhost': { timeline: { events: [WAKE_EVENT] } } }))
    ff.enqueueJson(200, syncBody('t2'))
    const source = createMentionSource({ client, company: 'acme', selfUserId: '@bot:localhost', pollIntervalMs: 50 })
    const got: InvokeIntent[] = []
    source.start((intent) => got.push(intent))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(50)
    expect(got).toEqual([])
    source.stop()
  })

  it('自发消息不唤起（防回声）；房间白名单外不唤起', async () => {
    vi.useFakeTimers()
    const ff = new FakeFetch()
    const client = makeClient(ff, 'tok-1')
    const source = createMentionSource({
      client,
      company: 'acme',
      selfUserId: '@bot:localhost',
      rooms: ['!dept:localhost'],
      pollIntervalMs: 50,
    })
    const got: InvokeIntent[] = []
    ff.enqueueJson(200, syncBody('t1'))
    ff.enqueueJson(200, syncBody('t2', {
      '!dept:localhost': {
        timeline: {
          events: [
            { ...WAKE_EVENT, event_id: '$self', sender: '@bot:localhost' }, // 自发 → 忽略
          ],
        },
      },
      '!other:localhost': {
        timeline: { events: [{ ...WAKE_EVENT, event_id: '$other-room' }] }, // 白名单外 → 忽略
      },
    }))
    source.start((intent) => got.push(intent))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(50)
    expect(got).toEqual([])
    source.stop()
  })

  it('stop() 干净终止：定时器链不再发请求（无孤儿、无迟到 emit）', async () => {
    vi.useFakeTimers()
    const ff = new FakeFetch()
    const client = makeClient(ff, 'tok-1')
    const source = createMentionSource({ client, company: 'acme', selfUserId: '@bot:localhost', pollIntervalMs: 20 })
    ff.enqueueJson(200, syncBody('t1'))
    ff.enqueueJson(200, syncBody('t2'))
    source.start(() => {})
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(20)
    expect(ff.calls).toHaveLength(2)
    source.stop()
    await vi.advanceTimersByTimeAsync(10_000) // 队列已空：若仍轮询会触发 fake fetch 拒绝
    expect(ff.calls).toHaveLength(2)
    // stop 后重新 start：以既有基线续跑
    ff.enqueueJson(200, syncBody('t3', { '!d:localhost': { timeline: { events: [WAKE_EVENT] } } }))
    const got: InvokeIntent[] = []
    source.start((intent) => got.push(intent))
    await vi.advanceTimersByTimeAsync(20)
    expect(got).toHaveLength(1)
    source.stop()
  })

  it('指数退避：出错翻倍、封顶 maxBackoffMs、成功复位', async () => {
    vi.useFakeTimers()
    const ff = new FakeFetch()
    const client = makeClient(ff, 'tok-1')
    const source = createMentionSource({
      client,
      company: 'acme',
      selfUserId: '@bot:localhost',
      pollIntervalMs: 100,
      maxBackoffMs: 400,
    })
    ff.enqueueError() // t0：首拉失败 → 间隔翻倍 200
    ff.enqueueError() // t200：再失败 → 间隔 400（封顶）
    ff.enqueueJson(200, syncBody('t1')) // t600（=t200+400）：成功 → 复位 100
    ff.enqueueJson(200, syncBody('t2')) // t700：按基础间隔继续
    source.start(() => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(ff.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(100) // t100：退避中（200 未到）
    expect(ff.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(100) // t200：第二次失败
    expect(ff.calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(100) // t300：退避中（间隔封顶 400，t600 前不再发）
    expect(ff.calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(200) // t500：仍退避中
    expect(ff.calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(100) // t600：成功，复位 100
    expect(ff.calls).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(100) // t700：复位后按 100ms 节奏
    expect(ff.calls).toHaveLength(4)
    source.stop()
  })

  it('sync 响应缺 next_batch 视为失败并走退避（不崩不静默）', async () => {
    vi.useFakeTimers()
    const ff = new FakeFetch()
    const client = makeClient(ff, 'tok-1')
    const source = createMentionSource({ client, company: 'acme', selfUserId: '@bot:localhost', pollIntervalMs: 50 })
    ff.enqueueJson(200, { rooms: {} }) // 畸形：无 next_batch
    ff.enqueueJson(200, syncBody('t1'))
    source.start(() => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(ff.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(100) // 退避 50→100 后重试成功
    expect(ff.calls).toHaveLength(2)
    source.stop()
  })
})
