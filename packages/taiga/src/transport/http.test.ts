/**
 * HTTP 薄客户端测试：错误映射表（4xx/5xx/网络/坏 JSON）、URL 构造、JWT 登录/
 * 401 刷新重试通路、分页迭代（x-pagination-count 头 + 头缺失短页收敛）、
 * 构造期校验、一请求=一 fetch（401 刷新是唯一例外，auth 语义）。
 * 映射表定稿见 src/errors.ts 头注；分页头名真机实测见 docs/32 补核。
 */
import { describe, expect, it } from 'vitest'
import { TaigaClient, type FetchLike } from './http.ts'
import { createTaigaPlatform } from '../platform.ts'
import { TaigaPlatformError } from './errors.ts'
import { expectTaigaReject } from '../testutil.ts'

interface Scripted {
  status?: number
  json?: unknown
  raw?: string
  headers?: Record<string, string>
  throwErr?: boolean
}

/** 脚本化 fetch：按序吐真 Response（带 headers，供分页读数）并记录全部调用 */
function scriptedFetch(script: Scripted[]): {
  fetch: FetchLike
  calls: Array<{ url: string; init?: RequestInit }>
} {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  let i = 0
  const fetch: FetchLike = (url, init) => {
    if (init === undefined) calls.push({ url })
    else calls.push({ url, init })
    const step = script[Math.min(i++, script.length - 1)]
    if (step === undefined) throw new Error('脚本耗尽')
    if (step.throwErr === true) return Promise.reject(new TypeError('fetch failed'))
    const status = step.status ?? 200
    const body = step.raw ?? JSON.stringify(step.json ?? {})
    return Promise.resolve(new Response(body, { status, headers: step.headers ?? { 'Content-Type': 'application/json' } }))
  }
  return { fetch, calls }
}

const TOKEN_AUTH = { type: 'token' as const, token: 'tok-1' }

const parseArr = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [])

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
    it(`${String(c.status)} → ${c.category}/${c.subcause}（错误体说明进详情，不重试）`, async () => {
      // 401 会触发刷新重试：token 态无 refresh → 直接报错，仍是 1 次业务请求 + 0 次刷新
      const { fetch, calls } = scriptedFetch([{ status: c.status, json: { _error_message: '平台拒绝说明', _error_type: 'x' } }])
      const http = new TaigaClient('http://t.example', TOKEN_AUTH, fetch)
      let caught: unknown = null
      try {
        await http.request({ method: 'GET', path: '/projects/by_slug' })
      } catch (err) {
        caught = err
      }
      expect(caught).toBeInstanceOf(TaigaPlatformError)
      const err = caught as TaigaPlatformError
      expect(err.category).toBe(c.category)
      expect(err.subcause).toBe(c.subcause)
      // 401 在 token 态无 refresh 时由适配器自己的收口消息解释（不透传平台体）——其余行透传
      if (c.status !== 401) expect(err.message).toContain('平台拒绝说明')
      expect(calls.length).toBe(1) // 一请求=一 fetch（401 无 refresh 可用时不重试）
    })
  }

  it('fetch 抛错（连不上）→ EXTERNAL_REJECT/network-error', async () => {
    const { fetch } = scriptedFetch([{ throwErr: true }])
    const http = new TaigaClient('http://t.example', TOKEN_AUTH, fetch)
    await expectTaigaReject(() => http.request({ method: 'GET', path: '/roles' }), 'EXTERNAL_REJECT', 'network-error')
  })

  it('2xx 但非 JSON → CONFIG_INVALID/unexpected-response', async () => {
    const { fetch } = scriptedFetch([{ status: 200, raw: '<html>网关劫持</html>' }])
    const http = new TaigaClient('http://t.example', TOKEN_AUTH, fetch)
    await expectTaigaReject(() => http.request({ method: 'GET', path: '/roles' }), 'CONFIG_INVALID', 'unexpected-response')
  })
})

describe('JWT 认证通路（docs/32 §二①）', () => {
  it('密码态：首请求自动登录（POST /auth type:normal），Bearer 换 token 上路', async () => {
    const { fetch, calls } = scriptedFetch([
      { status: 200, json: { auth_token: 'jwt-a', refresh: 'rf-a', id: 5, username: 'svc' } }, // 登录
      { status: 200, json: [] }, // 业务
    ])
    const http = new TaigaClient('http://t.example', { type: 'password', username: 'svc', password: 'p' }, fetch)
    await http.request({ method: 'GET', path: '/roles' })
    expect(calls[0]?.url).toContain('/api/v1/auth')
    expect(String(calls[0]?.init?.body)).toContain('"type":"normal"')
    const auth = (calls[1]?.init?.headers as Record<string, string>)['Authorization']
    expect(auth).toBe('Bearer jwt-a')
  })

  it('401 → refresh 一次 → 重试成功（业务请求只发两次，token 换新）', async () => {
    const { fetch, calls } = scriptedFetch([
      { status: 200, json: { auth_token: 'jwt-a', refresh: 'rf-a' } }, // 登录
      { status: 401, json: { _error_message: 'Invalid token' } }, // 业务 401（过期）
      { status: 200, json: { auth_token: 'jwt-b', refresh: 'rf-b' } }, // 刷新
      { status: 200, json: [{ id: 1 }] }, // 重试成功
    ])
    const http = new TaigaClient('http://t.example', { type: 'password', username: 'svc', password: 'p' }, fetch)
    const res = await http.request({ method: 'GET', path: '/roles' })
    expect(Array.isArray(res.json)).toBe(true)
    expect(calls.length).toBe(4)
    expect(calls[2]?.url).toContain('/api/v1/auth/refresh')
    expect((calls[3]?.init?.headers as Record<string, string>)['Authorization']).toBe('Bearer jwt-b')
  })

  it('刷新后仍 401 → auth-rejected 明报（不无限重试）', async () => {
    const { fetch, calls } = scriptedFetch([
      { status: 200, json: { auth_token: 'jwt-a', refresh: 'rf-a' } },
      { status: 401, json: {} },
      { status: 200, json: { auth_token: 'jwt-b', refresh: 'rf-b' } },
      { status: 401, json: { _error_message: '还是不行' } },
    ])
    const http = new TaigaClient('http://t.example', { type: 'password', username: 'svc', password: 'p' }, fetch)
    await expectTaigaReject(() => http.request({ method: 'GET', path: '/roles' }), 'CONFIG_INVALID', 'auth-rejected')
    expect(calls.length).toBe(4) // 登录+401+刷新+重试，到此为止
  })

  it('token 态无 refresh：401 直接报错（无密码可兜底重登）', async () => {
    const { fetch } = scriptedFetch([{ status: 401, json: {} }])
    const http = new TaigaClient('http://t.example', { type: 'token', token: 'stale' }, fetch)
    await expectTaigaReject(() => http.request({ method: 'GET', path: '/roles' }), 'CONFIG_INVALID', 'auth-rejected')
  })

  it('密码错 → 登录收口 auth-rejected', async () => {
    const { fetch } = scriptedFetch([{ status: 401, json: { _error_message: 'Invalid credentials' } }])
    const http = new TaigaClient('http://t.example', { type: 'password', username: 'svc', password: 'wrong' }, fetch)
    await expectTaigaReject(() => http.request({ method: 'GET', path: '/roles' }), 'CONFIG_INVALID', 'auth-rejected')
  })
})

describe('请求构造', () => {
  it('URL：/api/v1 前缀拼接；尾斜杠剥除；查询值编码（中文/slug 斜杠）', async () => {
    const { fetch, calls } = scriptedFetch([{ status: 200, json: {} }])
    const http = new TaigaClient('http://t.example/', TOKEN_AUTH, fetch)
    await http.request({ method: 'GET', path: '/wiki/by_slug', query: { slug: 'guide/deploy 页' } })
    expect(calls[0]?.url).toBe('http://t.example/api/v1/wiki/by_slug?slug=guide%2Fdeploy%20%E9%A1%B5')
  })

  it('带体请求加 Content-Type: application/json，体为 JSON 串', async () => {
    const { fetch, calls } = scriptedFetch([{ status: 200, json: {} }])
    const http = new TaigaClient('http://t.example', TOKEN_AUTH, fetch)
    await http.request({ method: 'POST', path: '/userstories', body: { subject: '甲' } })
    expect((calls[0]?.init?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(calls[0]?.init?.body).toBe('{"subject":"甲"}')
  })
})

describe('分页迭代（x-pagination-count 头为准，短页兜底）', () => {
  it('跨页拼全量：count 头驱动翻到取尽', async () => {
    const pages: Scripted[] = [
      { status: 200, json: [{ id: 1 }, { id: 2 }], headers: { 'x-pagination-count': '5' } },
      { status: 200, json: [{ id: 3 }, { id: 4 }], headers: { 'x-pagination-count': '5' } },
      { status: 200, json: [{ id: 5 }], headers: { 'x-pagination-count': '5' } },
    ]
    const { fetch, calls } = scriptedFetch(pages)
    const http = new TaigaClient('http://t.example', TOKEN_AUTH, fetch)
    const out = await http.paginate({ method: 'GET', path: '/userstories' }, parseArr, 2)
    expect(out.map((x) => x['id'])).toEqual([1, 2, 3, 4, 5])
    expect(calls.length).toBe(3)
    expect(calls[1]?.url).toContain('page=2&page_size=2')
  })

  it('头被剥（代理环境）：短页即止，不死翻', async () => {
    const { fetch, calls } = scriptedFetch([
      { status: 200, json: [{ id: 1 }, { id: 2 }] }, // 满页无头 → 继续
      { status: 200, json: [{ id: 3 }] }, // 短页 → 止
    ])
    const http = new TaigaClient('http://t.example', TOKEN_AUTH, fetch)
    const out = await http.paginate({ method: 'GET', path: '/userstories' }, parseArr, 2)
    expect(out.length).toBe(3)
    expect(calls.length).toBe(2)
  })

  it('count=0：首页即止', async () => {
    const { fetch, calls } = scriptedFetch([{ status: 200, json: [], headers: { 'x-pagination-count': '0' } }])
    const http = new TaigaClient('http://t.example', TOKEN_AUTH, fetch)
    const out = await http.paginate({ method: 'GET', path: '/userstories' }, parseArr, 2)
    expect(out).toEqual([])
    expect(calls.length).toBe(1)
  })
})

describe('构造期校验', () => {
  it('baseUrl 非 http(s) → 组装层显式报错（TaigaClient 本层不校验，校验归 createTaigaPlatform）', () => {
    expect(() =>
      createTaigaPlatform({ baseUrl: 'ftp://x', project: 'p', auth: TOKEN_AUTH, fetch: scriptedFetch([]).fetch }),
    ).toThrow(TaigaPlatformError)
  })
})
