/**
 * HTTP 薄客户端测试：错误映射表（4xx/5xx/网络/坏 JSON/形状漂移）、认证头、
 * URL 构造（键原样 $top/$skip、值编码）、无重试（一请求=一 fetch）、构造期校验。
 * 映射表定稿见 src/errors.ts 头注。
 */
import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import type { FlowPlatform } from '@studio-next/contract'
import { YouTrackPlatformError } from './errors.ts'
import { YtHttpClient, type FetchLike } from './http.ts'
import { createYouTrackPlatform } from './platform.ts'
import { TEST_PROVISION, expectYtReject } from './testutil.ts'

interface Scripted {
  status?: number
  json?: unknown
  raw?: string
  throwErr?: boolean
}

/** 脚本化 fetch：按序吐响应并记录全部调用 */
function scriptedFetch(
  script: Scripted[],
): {
  fetch: FetchLike
  calls: Array<{ url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } | undefined }>
} {
  const calls: Array<{ url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } | undefined }> = []
  let i = 0
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init })
    const step = script[Math.min(i++, script.length - 1)]
    if (step === undefined) throw new Error('脚本耗尽')
    if (step.throwErr === true) return Promise.reject(new TypeError('fetch failed'))
    const status = step.status ?? 200
    const body = step.raw ?? JSON.stringify(step.json ?? {})
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: async () => JSON.parse(body),
    } as unknown as Response)
  }
  return { fetch, calls }
}

const okSchema = z.array(z.looseObject({ id: z.string() }))

describe('HTTP 错误映射表（errors.ts 头注定稿）', () => {
  const cases: ReadonlyArray<{ status: number; category: string; subcause: string }> = [
    { status: 400, category: 'CONFIG_INVALID', subcause: 'bad-request' },
    { status: 401, category: 'CONFIG_INVALID', subcause: 'auth-rejected' },
    { status: 403, category: 'CONFIG_INVALID', subcause: 'auth-rejected' },
    { status: 404, category: 'EXTERNAL_REJECT', subcause: 'not-found' },
    { status: 409, category: 'EXTERNAL_REJECT', subcause: 'conflict' },
    { status: 429, category: 'EXTERNAL_REJECT', subcause: 'rate-limited' },
    { status: 500, category: 'EXTERNAL_REJECT', subcause: 'server-error' },
    { status: 503, category: 'EXTERNAL_REJECT', subcause: 'server-error' },
    { status: 418, category: 'CONFIG_INVALID', subcause: 'client-error' },
  ]
  for (const c of cases) {
    it(`${String(c.status)} → ${c.category}/${c.subcause}，错误体说明进详情，且不重试`, async () => {
      const { fetch, calls } = scriptedFetch([{ status: c.status, json: { error: 'bad', error_description: '平台拒绝说明' } }])
      const http = new YtHttpClient('https://yt.example', 'tok', fetch)
      let caught: unknown = null
      try {
        await http.request(okSchema, { method: 'GET', path: '/api/issues' })
      } catch (err) {
        caught = err
      }
      expect(caught).toBeInstanceOf(YouTrackPlatformError)
      const err = caught as YouTrackPlatformError
      expect(err.category).toBe(c.category)
      expect(err.subcause).toBe(c.subcause)
      expect(err.message).toContain('平台拒绝说明')
      expect(calls.length).toBe(1) // v0 无重试：一请求=一 fetch
    })
  }

  it('fetch 抛错（连不上）→ EXTERNAL_REJECT/network-error', async () => {
    const { fetch } = scriptedFetch([{ throwErr: true }])
    const http = new YtHttpClient('https://yt.example', 'tok', fetch)
    await expectYtReject(() => http.request(okSchema, { method: 'GET', path: '/api/issues' }), 'EXTERNAL_REJECT', 'network-error')
  })

  it('2xx 但非 JSON → CONFIG_INVALID/unexpected-response', async () => {
    const { fetch } = scriptedFetch([{ status: 200, raw: '<html>网关劫持</html>' }])
    const http = new YtHttpClient('https://yt.example', 'tok', fetch)
    await expectYtReject(
      () => http.request(okSchema, { method: 'GET', path: '/api/issues' }),
      'CONFIG_INVALID',
      'unexpected-response',
    )
  })

  it('2xx JSON 形状不符 zod 模型 → CONFIG_INVALID/unexpected-response-shape（版本漂移）', async () => {
    const { fetch } = scriptedFetch([{ status: 200, json: [{ id: 42 }] }]) // id 应为 string
    const http = new YtHttpClient('https://yt.example', 'tok', fetch)
    await expectYtReject(
      () => http.request(okSchema, { method: 'GET', path: '/api/issues' }),
      'CONFIG_INVALID',
      'unexpected-response-shape',
    )
  })
})

describe('请求构造', () => {
  it('认证头：Authorization Bearer + Accept；带体加 Content-Type', async () => {
    const { fetch, calls } = scriptedFetch([{ status: 200, json: [] }, { status: 200, json: [] }])
    const http = new YtHttpClient('https://yt.example/', 'tok-123', fetch)
    await http.request(okSchema, { method: 'GET', path: '/api/issues' })
    await http.request(okSchema, { method: 'POST', path: '/api/issues', body: { summary: 'x' } })
    expect(calls[0]?.init?.headers).toEqual({ Authorization: 'Bearer tok-123', Accept: 'application/json' })
    expect(calls[1]?.init?.headers).toEqual({
      Authorization: 'Bearer tok-123',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    })
    expect(calls[1]?.init?.body).toBe('{"summary":"x"}')
  })

  it('URL：尾斜杠剥除；查询键原样（$top/$skip）、值编码（空格/中文/逗号）', async () => {
    const { fetch, calls } = scriptedFetch([{ status: 200, json: [] }])
    const http = new YtHttpClient('https://yt.example/', 'tok', fetch)
    await http.request(okSchema, {
      method: 'GET',
      path: '/api/issues',
      query: {
        query: 'State: 待批,已派发 updated: 2026-01-01T00:00:02.000Z .. *',
        fields: 'id,idReadable',
        $top: '100',
        $skip: '0',
      },
    })
    expect(calls[0]?.url).toBe(
      'https://yt.example/api/issues?query=State%3A%20%E5%BE%85%E6%89%B9%2C%E5%B7%B2%E6%B4%BE%E5%8F%91%20updated%3A%202026-01-01T00%3A00%3A02.000Z%20..%20*&fields=id%2CidReadable&$top=100&$skip=0',
    )
  })
})

describe('构造期校验（公司作用域绑定，docs/25-§3.2）', () => {
  const make = (): FlowPlatform =>
    createYouTrackPlatform({
      baseUrl: 'https://yt.example',
      token: 't',
      fields: TEST_PROVISION,
      fetch: scriptedFetch([]).fetch,
    })

  it('baseUrl 非 http(s) → CONFIG_INVALID/bad-base-url', () => {
    let caught: unknown = null
    try {
      createYouTrackPlatform({ baseUrl: 'ftp://x', token: 't', fields: TEST_PROVISION, fetch: scriptedFetch([]).fetch })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(YouTrackPlatformError)
    expect((caught as YouTrackPlatformError).subcause).toBe('bad-base-url')
  })

  it('token 空 → CONFIG_INVALID/bad-token', () => {
    let caught: unknown = null
    try {
      createYouTrackPlatform({ baseUrl: 'https://x', token: '  ', fields: TEST_PROVISION, fetch: scriptedFetch([]).fetch })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(YouTrackPlatformError)
    expect((caught as YouTrackPlatformError).subcause).toBe('bad-token')
  })

  it('fields 缺 state 映射 → CONFIG_INVALID/missing-state-mapping', () => {
    let caught: unknown = null
    try {
      createYouTrackPlatform({
        baseUrl: 'https://x',
        token: 't',
        fields: { fields: { dept: '部门' }, states: [], stateFlow: {} },
        fetch: scriptedFetch([]).fetch,
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(YouTrackPlatformError)
    expect((caught as YouTrackPlatformError).subcause).toBe('missing-state-mapping')
  })

  it('合法构造：可用实例（不触发网络）', () => {
    expect(make().issues).toBeDefined()
  })
})
