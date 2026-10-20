/**
 * memberships 测试（DEV-48，docs/52-§6.1/§6.2/§6.3）：角色解析（裸数组/缓存/未知角色
 * fail-closed）/ 成员判重读面（分页拉全）/ 邀请 POST 体（role=id 解析）/ 角色调整 PATCH /
 * 移除 DELETE / 邀请令牌注册（公开端点直连——201 建号、非 2xx EXTERNAL_REJECT）/ 日志
 * 令牌抓取（链接尾段、键值两形、取最后命中）。
 * 网络：注入 fetch 全 fake 回放（零真实网络；真机面归 test/smoke 套外脚本）。
 */
import { describe, expect, it } from 'vitest'
import { buildContext } from '../src/platform.ts'
import { TaigaPlatformError } from '../src/transport/errors.ts'
import type { FetchLike } from '../src/transport/http.ts'
import {
  findInviteToken,
  findMembershipByUsername,
  inviteMember,
  listMemberships,
  patchMembershipRole,
  registerWithInviteToken,
  removeMembership,
} from '../src/memberships.ts'

/** 路由式 fake fetch：path 前缀匹配 → handler（method+query 断言材料=calls 记录） */
type Handler = (url: URL, init: RequestInit | undefined) => unknown
const calls: { method: string; path: string; query: string; body?: unknown } = []
function fakeFetch(routes: [string, Handler][]): FetchLike {
  return async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input)
    for (const [prefix, handler] of routes) {
      if (url.pathname.startsWith(prefix)) {
        calls.push({
          method: init?.method ?? 'GET',
          path: url.pathname,
          query: url.search,
          body: init?.body !== undefined ? (JSON.parse(String(init.body)) as unknown) : undefined,
        })
        const json = handler(url, init)
        return new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json', 'x-pagination-count': '0' } })
      }
    }
    return new Response(JSON.stringify({ _error_message: `no route ${url.pathname}` }), { status: 404 })
  }
}

const ROLES = [
  { id: 3, name: 'Member', slug: 'member' },
  { id: 4, name: '核心成员', slug: 'core' },
]
const MEMBERSHIPS = [
  { id: 11, username: 'li', role_name: 'Member', role_slug: 'member', is_active: true },
  { id: 12, username: 'wang', role_name: '核心成员', role_slug: 'core', is_active: false },
]

function memberCtx(fetchLike: FetchLike) {
  return buildContext({ baseUrl: 'http://taiga.test', project: 'proj', auth: { type: 'token', token: 'tok' }, fetch: fetchLike })
}

/** 项目解析（/projects/by_slug?slug=）+ roles + memberships 三路由常备 */
function stdRoutes(membershipsPost?: Handler): [string, Handler][] {
  return [
    ['/api/v1/projects/by_slug', () => ({ id: 7, slug: 'proj', members: [] })],
    ['/api/v1/roles', () => ROLES],
    [
      '/api/v1/memberships',
      (url, init) => {
        if (init?.method === 'POST' && membershipsPost !== undefined) return membershipsPost(url, init)
        return MEMBERSHIPS
      },
    ],
  ]
}

describe('rolesOf/roleIdOf（§6.2 角色 id 解析）', () => {
  it('GET /roles?project= 裸数组解析；slug 与显示名双键；实例缓存（第二次零请求）', async () => {
    let roleCalls = 0
    const ctx = memberCtx(fakeFetch(stdRoutes({ '/api/v1/roles': () => { roleCalls += 1; return ROLES } })))
    const m = await findMembershipByUsername(ctx, 'li')
    expect(m?.id).toBe(11)
    expect(roleCalls).toBe(0) // findMembership 不解析角色——roles 未消费
    const again = await findMembershipByUsername(ctx, 'wang')
    expect(again?.roleSlug).toBe('core')
    expect(roleCalls).toBe(0)
  })

  it('未知角色 fail-closed（CONFIG_INVALID——不猜不建）', async () => {
    const ctx = memberCtx(fakeFetch(stdRoutes()))
    await expect(inviteMember(ctx, { username: 'xin', roleSlug: 'owner' })).rejects.toMatchObject({ category: 'CONFIG_INVALID', subcause: 'unknown-role' })
  })
})

describe('成员读面（§6.3 GET-first 判重）', () => {
  it('listMemberships 分页拉全+解析（role_slug/full_name 投影）；按名查找命中/未命中', async () => {
    const ctx = memberCtx(fakeFetch(stdRoutes()))
    const all = await listMemberships(ctx)
    expect(all.map((m) => [m.id, m.username, m.roleSlug, m.isActive])).toEqual([[11, 'li', 'member', true], [12, 'wang', 'core', false]])
    expect((await findMembershipByUsername(ctx, 'li'))?.id).toBe(11)
    expect(await findMembershipByUsername(ctx, 'ghost')).toBeUndefined()
  })
})

describe('写面（§6.1 邀请 / §6.2 角色调整与移除）', () => {
  it('inviteMember POST {project, username, role:roleId}（slug→id 解析进体）', async () => {
    const ctx = memberCtx(fakeFetch(stdRoutes(() => ({ id: 13, username: 'xin', role_name: 'Member', role_slug: 'member', is_active: true }))))
    const m = await inviteMember(ctx, { username: 'xin', roleSlug: 'member' })
    expect(m.id).toBe(13)
    const call = calls.find((c) => c.method === 'POST' && c.path.endsWith('/memberships'))
    expect(call?.body).toEqual({ project: 7, username: 'xin', role: 3 })
  })

  it('patchMembershipRole PATCH /memberships/{id} {role:roleId}', async () => {
    const ctx = memberCtx(fakeFetch(stdRoutes()))
    await patchMembershipRole(ctx, 12, 'member')
    const call = calls.find((c) => c.method === 'PATCH' && c.path.endsWith('/memberships/12'))
    expect(call?.body).toEqual({ role: 3 })
  })

  it('removeMembership DELETE /memberships/{id}（退场——账号保留席位释放）', async () => {
    const ctx = memberCtx(fakeFetch(stdRoutes()))
    await removeMembership(ctx, 11)
    expect(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/memberships/11'))).toBe(true)
  })
})

describe('registerWithInviteToken（§6.1 步④公开端点直连）', () => {
  it('POST /api/v1/auth/register {type:private, token, accepted_terms, username, password, full_name?} → 201 解析', async () => {
    let seen: { url: string; body: Record<string, unknown> } | undefined
    const fetchLike: FetchLike = async (input, init) => {
      seen = { url: input, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> }
      return new Response(JSON.stringify({ username: 'xin', id: 42 }), { status: 201 })
    }
    const r = await registerWithInviteToken({ baseUrl: 'http://taiga.test/', token: 'tok-tok-tok-tok-tok-tok', username: 'xin', password: 'pw', fullName: '新同学', fetch: fetchLike })
    expect(r).toEqual({ username: 'xin', userId: 42 })
    expect(seen?.url).toBe('http://taiga.test/api/v1/auth/register')
    expect(seen?.body).toEqual({ type: 'private', token: 'tok-tok-tok-tok-tok-tok', accepted_terms: true, username: 'xin', password: 'pw', full_name: '新同学' })
  })

  it('非 2xx → EXTERNAL_REJECT/register-rejected（token 一次性——冲突≈已建号由调用方收敛）', async () => {
    const fetchLike: FetchLike = async () => new Response(JSON.stringify({ _error_message: 'invalid token' }), { status: 400 })
    await expect(registerWithInviteToken({ baseUrl: 'http://t', token: 'x'.repeat(24), username: 'u', password: 'p', fetch: fetchLike })).rejects.toBeInstanceOf(TaigaPlatformError)
  })
})

describe('findInviteToken（§6.1 步③日志文本面——纯函数）', () => {
  it('注册链接尾段形', () => {
    expect(findInviteToken('欢迎入职：http://taiga.test/register/AbCdEf123456789012345678 点击')).toBe('AbCdEf123456789012345678')
  })

  it('键值形（token= / "token":）；多命中取最后（窗口内最新=目标）', () => {
    expect(findInviteToken('token=Zm9vYmFyMTIzNDU2Nzg5MGFi')).toBe('Zm9vYmFyMTIzNDU2Nzg5MGFi')
    expect(findInviteToken('{"token": "aaaabbbbccccddddeeee"}')).toBe('aaaabbbbccccddddeeee')
    expect(findInviteToken('/register/11112222333344445555 token=99998888777766665555')).toBe('99998888777766665555')
  })

  it('无命中/过短串=null（≥20 位 URL-safe）', () => {
    expect(findInviteToken('普通日志行')).toBeNull()
    expect(findInviteToken('/register/short123')).toBeNull()
  })
})
