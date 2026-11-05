/**
 * 804：Taiga 成员/用户全量分页（OPS-1 从成员表消失事故回归）
 * 真机语义：GET /memberships?project 与 GET /users 缺省 page_size=30；31+ 成员时第 2 页用户
 * 在未分页交集后消失 → idByUsername('OPS-1') unknown-user → 定时岗物化失败。
 * 本用例 fake server 强制每页 30/100（忽略 page_size=500），用 x-pagination-count 驱动翻页，
 * 钉死「两接口都全量→交集/反查含第 2 页用户」与上限保护。
 */
import { describe, expect, it } from 'vitest'
import { buildContext } from '../../src/platform.ts'
import { findMembershipByUsername, listMemberships } from '../../src/index.ts'
import { TaigaClient, MAX_PAGINATE_PAGES } from '../../src/transport/http.ts'

interface PageState { calls: string[] }

/** fake HTTP：memberships/users 分页；强制每页 cap（模拟 Taiga 缺省/page_size 上限），count 头给总数 */
function fakeFetch(cap: number, totals: { members: number; users: number }): { fetch: (url: string, init?: RequestInit) => Promise<Response>; state: PageState } {
  const state: PageState = { calls: [] }
  const fetch = async (url: string): Promise<Response> => {
    const u = new URL(url)
    state.calls.push(`${u.pathname}?${u.search}`)
    const page = Number(u.searchParams.get('page') ?? '1')
    const json = (() => {
      if (u.pathname.endsWith('/projects/by_slug')) return { id: 3, slug: 'demo' }
      if (u.pathname.endsWith('/memberships')) {
        const all = Array.from({ length: totals.members }, (_, i) => ({ id: 1000 + i, user: i === totals.members - 1 ? 27 : i + 1, role: 18, role_name: 'Stakeholder', is_active: true, email: `u${String(i + 1)}@x.local` }))
        return all.slice((page - 1) * cap, page * cap)
      }
      if (u.pathname.endsWith('/users')) {
        const all = Array.from({ length: totals.users }, (_, i) => ({ id: i === totals.users - 1 ? 27 : i + 1, username: i === totals.users - 1 ? 'OPS-1' : `U-${String(i + 1)}` }))
        return all.slice((page - 1) * cap, page * cap)
      }
      return []
    })()
    const headers = new Headers()
    headers.set('content-type', 'application/json')
    if (u.pathname.endsWith('/memberships')) headers.set('x-pagination-count', String(totals.members))
    if (u.pathname.endsWith('/users')) headers.set('x-pagination-count', String(totals.users))
    return new Response(JSON.stringify(json), { status: 200, headers })
  }
  return { fetch, state }
}

const auth = { type: 'token' as const, token: 'fixture-token' }

describe('804：idByUsername/members 全量分页（>30，第 2 页 OPS-1）', () => {
  it('memberships/users 都翻到第 2 页 → 31 成员含 OPS-1；idByUsername 命中', async () => {
    const { fetch, state } = fakeFetch(30, { members: 31, users: 31 })
    const ctx = buildContext({ baseUrl: 'http://taiga.test', project: 'demo', auth, fetch: fetch as never })
    const members = await ctx.members()
    expect(members).toHaveLength(31)
    expect(members.some((m) => m.username === 'OPS-1' && m.id === 27)).toBe(true)
    await expect(ctx.idByUsername('OPS-1')).resolves.toBe(27)
    // 两接口都请求了 page=2（全量），且 page_size=500
    const membershipCalls = state.calls.filter((c) => c.includes('/memberships'))
    const userCalls = state.calls.filter((c) => c.includes('/users'))
    expect(membershipCalls.some((c) => c.includes('page=2'))).toBe(true)
    expect(userCalls.some((c) => c.includes('page=2'))).toBe(true)
    expect(membershipCalls.every((c) => c.includes('page_size=500'))).toBe(true)
  })

  it('listMemberships 全量分页 + /users 反查第 2 页 → 130 条含 OPS-1（usernameKnown）', async () => {
    const { fetch } = fakeFetch(100, { members: 130, users: 130 })
    const ctx = buildContext({ baseUrl: 'http://taiga.test', project: 'demo', auth, fetch: fetch as never })
    const list = await listMemberships(ctx)
    expect(list).toHaveLength(130)
    const ops = await findMembershipByUsername(ctx, 'OPS-1')
    expect(ops?.id).toBeDefined()
    expect(ops?.usernameKnown).toBe(true)
  })
})

describe('804：分页停止条件/上限保护', () => {
  it('count 头驱动恰翻 2 页（不空翻第 3 页）', async () => {
    const { fetch, state } = fakeFetch(30, { members: 31, users: 31 })
    const ctx = buildContext({ baseUrl: 'http://taiga.test', project: 'demo', auth, fetch: fetch as never })
    await ctx.members()
    const page3 = state.calls.filter((c) => c.includes('page=3'))
    expect(page3).toHaveLength(0)
  })

  it(`超过 ${String(MAX_PAGINATE_PAGES)} 页仍取不尽 → 显式 pagination-overflow（不静默截断）`, async () => {
    const fetch = async (): Promise<Response> => {
      const headers = new Headers()
      headers.set('content-type', 'application/json')
      return new Response(JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ id: i }))), { status: 200, headers })
    }
    const client = new TaigaClient('http://taiga.test', auth, fetch as never)
    await expect(client.paginate({ method: 'GET', path: '/users' }, (v) => (Array.isArray(v) ? (v as unknown[]) : []), 500)).rejects.toThrow(/pagination-overflow|超过 50 页/)
  })

  it('count 头缺失：短页即止（既有收敛路径保持）', async () => {
    let calls = 0
    const fetch = async (): Promise<Response> => {
      calls += 1
      const json = calls === 1 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }]
      return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const client = new TaigaClient('http://taiga.test', auth, fetch as never)
    const out = await client.paginate({ method: 'GET', path: '/users' }, (v) => (Array.isArray(v) ? (v as unknown[]) : []), 2)
    expect((out as Array<{ id: unknown }>).map((x) => x.id)).toEqual([1, 2, 3])
    expect(calls).toBe(2)
  })

  it('804 v2：x-pagination-count 非法值 → 显式 pagination-count-invalid（abc/NaN/-1/空串/0）', async () => {
    for (const bad of ['abc', 'NaN', '-1', '', '0']) {
      const fetch = async (): Promise<Response> => {
        const headers = new Headers()
        headers.set('content-type', 'application/json')
        headers.set('x-pagination-count', bad)
        return new Response(JSON.stringify([{ id: 1 }, { id: 2 }]), { status: 200, headers })
      }
      const client = new TaigaClient('http://taiga.test', auth, fetch as never)
      await expect(
        client.paginate({ method: 'GET', path: '/memberships' }, (v) => (Array.isArray(v) ? (v as unknown[]) : []), 500),
      ).rejects.toThrow(/pagination-count-invalid|x-pagination-count 非法/)
    }
  })

  it('804 v2：合法 count 回归（31→2 页、含末页用户）；无头短页回归', async () => {
    const { fetch, state } = fakeFetch(30, { members: 31, users: 31 })
    const ctx = buildContext({ baseUrl: 'http://taiga.test', project: 'demo', auth, fetch: fetch as never })
    await expect(ctx.idByUsername('OPS-1')).resolves.toBe(27)
    expect(state.calls.some((c) => c.includes('page=2'))).toBe(true)
    // 无头短页：既有收敛路径不回归
    let calls = 0
    const noHeader = async (): Promise<Response> => {
      calls += 1
      const json = calls === 1 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }]
      return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const client = new TaigaClient('http://taiga.test', auth, noHeader as never)
    const out = await client.paginate({ method: 'GET', path: '/users' }, (v) => (Array.isArray(v) ? (v as unknown[]) : []), 2)
    expect((out as Array<{ id: unknown }>).map((x) => x.id)).toEqual([1, 2, 3])
  })
})
