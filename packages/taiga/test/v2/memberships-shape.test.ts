/**
 * 775/C1 —— Taiga membership 真机 serializer 漂移容忍
 *
 * 事故背景（2026-11-05 verifier C1）：真机 `GET /memberships?project=` 响应**无 username 字段**
 * （`user` 为 int id、`role_slug` 缺省），旧 `parseMembership` 用 reqString 严格校验 →
 * `[hr-sync] 响应形状漂移（membership）：username 应为 string` 整批 ESCALATE，REL-1 未入 Taiga。
 *
 * 本用例钉死新口径：id 仍 fail-closed；username/role 走「显式→嵌套→反查」；
 * 未知行标 usernameKnown=false 不整批拒；判重面跳过未知行。
 */
import { describe, expect, it } from 'vitest'
import { buildContext } from '../../src/platform.ts'
import { TaigaPlatformError } from '../../src/transport/errors.ts'
import type { FetchLike } from '../../src/transport/http.ts'
import { findMembershipByUsername, listMemberships } from '../../src/memberships.ts'

interface RouteHandler {
  (url: URL, init: RequestInit | undefined, calls: string[]): unknown
}

/** 路由式 fake fetch（与既有 test/memberships.test.ts 同款） */
function fakeFetch(routes: Record<string, RouteHandler>): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = []
  const fetchLike: FetchLike = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input)
    for (const [prefix, handler] of Object.entries(routes)) {
      if (url.pathname === prefix || url.pathname.startsWith(prefix)) {
        calls.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`)
        return new Response(JSON.stringify(handler(url, init, calls)), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'x-pagination-count': '0' },
        })
      }
    }
    return new Response(JSON.stringify({ _error_message: `no route ${url.pathname}` }), { status: 404 })
  }
  return { fetch: fetchLike, calls }
}

function ctxOf(fetchLike: FetchLike) {
  return buildContext({ baseUrl: 'http://taiga.test', project: 'proj', auth: { type: 'token', token: 'tok' }, fetch: fetchLike })
}

/** 真机 shape（2026-11-05 实测）：无 username；user=int；role=int；仅有 role_name */
const REAL_SERIALIZER_MEMBERSHIPS = [
  { id: 5, user: 5, project: 7, role: 17, role_name: 'Product Owner', is_admin: true, is_user_active: true, full_name: 'admin', email: 'admin@studio-next.local', user_email: 'admin@studio-next.local' },
  { id: 6, user: 7, project: 7, role: 3, role_name: 'Member', is_admin: false, is_user_active: true, full_name: '示例工程师' },
  { id: 7, user: null, project: 7, role: 3, role_name: 'Member', invitation_extra_text: null, is_user_active: false },
]

function realRoutes(users: unknown[] = [{ id: 5, username: 'admin' }, { id: 7, username: 'AGENT-1' }]) {
  return {
    '/api/v1/projects/by_slug': () => ({ id: 7, slug: 'proj', members: [] }),
    '/api/v1/roles': () => [
      { id: 3, name: 'Member', slug: 'member' },
      { id: 17, name: 'Product Owner', slug: 'product-owner' },
    ],
    '/api/v1/memberships': () => REAL_SERIALIZER_MEMBERSHIPS,
    '/api/v1/users': () => users,
  }
}

describe('775/C1 membership 形状漂移容忍（真机 serializer）', () => {
  it('无 username 字段不再整批抛错：user int → /users 反查补齐；role int → slug 反查', async () => {
    const { fetch, calls } = fakeFetch(realRoutes())
    const memberships = await listMemberships(ctxOf(fetch))
    expect(memberships).toHaveLength(3)
    // user int 反查
    expect(memberships[0]?.username).toBe('admin')
    expect(memberships[0]?.usernameKnown).toBe(true)
    expect(memberships[1]?.username).toBe('AGENT-1')
    // role id → slug（真机 role_slug 缺省）
    expect(memberships[0]?.roleSlug).toBe('product-owner')
    expect(memberships[1]?.roleSlug).toBe('member')
    expect(memberships[0]?.roleSlug).not.toBe('')
    // /users 只请求一次（尽力补齐，不逐行 N+1）
    expect(calls.filter((c) => c.startsWith('GET /api/v1/users')).length).toBe(1)
  })

  it('invite 态（user=null）不再抛「username 应为 string」：usernameKnown=false，判重面跳过', async () => {
    const { fetch } = fakeFetch(realRoutes())
    const ctx = ctxOf(fetch)
    const memberships = await listMemberships(ctx)
    const invite = memberships.find((m) => m.id === 7)
    expect(invite?.usernameKnown).toBe(false)
    expect(invite?.username).toBe('')
    // 判重：未知行不得被空串匹配
    expect(await findMembershipByUsername(ctx, '')).toBeUndefined()
    // 已激活行可正常判重
    expect((await findMembershipByUsername(ctx, 'AGENT-1'))?.id).toBe(6)
  })

  it('旧 serializer（username 顶层字符串/role_slug 在）仍兼容（向后兼容）', async () => {
    const { fetch } = fakeFetch({
      '/api/v1/projects/by_slug': () => ({ id: 7, slug: 'proj', members: [] }),
      '/api/v1/roles': () => [{ id: 3, name: 'Member', slug: 'member' }],
      '/api/v1/memberships': () => [
        { id: 11, username: 'li', role_name: 'Member', role_slug: 'member', is_active: true },
      ],
    })
    const memberships = await listMemberships(ctxOf(fetch))
    expect(memberships[0]).toMatchObject({ id: 11, username: 'li', usernameKnown: true, roleSlug: 'member' })
  })

  it('id 仍 fail-closed（真形状破坏=明确分类，不静默）', async () => {
    const { fetch } = fakeFetch({
      '/api/v1/projects/by_slug': () => ({ id: 7, slug: 'proj', members: [] }),
      '/api/v1/memberships': () => [{ user: 5, role: 3 }], // 缺 id
    })
    await expect(listMemberships(ctxOf(fetch))).rejects.toBeInstanceOf(TaigaPlatformError)
    await expect(listMemberships(ctxOf(fetch))).rejects.toThrow(/id/)
  })

  it('/users 反查失败不拖死成员面（尽力而为，未知行保留 usernameKnown=false）', async () => {
    const { fetch } = fakeFetch({
      '/api/v1/projects/by_slug': () => ({ id: 7, slug: 'proj', members: [] }),
      '/api/v1/roles': () => [{ id: 3, name: 'Member', slug: 'member' }],
      '/api/v1/memberships': () => [{ id: 5, user: 5, role: 3, role_name: 'Member' }],
      // 不注册 /api/v1/users → 404 → 尽力而为 catch
    })
    const memberships = await listMemberships(ctxOf(fetch))
    expect(memberships[0]?.usernameKnown).toBe(false)
    expect(memberships[0]?.roleSlug).toBe('member')
  })
})
