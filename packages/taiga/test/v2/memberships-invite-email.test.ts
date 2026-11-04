/**
 * 793：Taiga 成员面邮箱邀请/邀请 token/注册字段（真机探针钉形状）
 */
import { describe, expect, it } from 'vitest'
import { findInviteToken, findMembershipByEmail, inviteMember, registerWithInviteToken } from '../../src/index.ts'

const TOKEN = 'AbCdEfGh1234567890123456789012345678'

function fakeCtx(memberships: unknown[] = []) {
  const calls: Array<{ method: string; path: string; body?: Record<string, unknown> }> = []
  const ctx = {
    projectSlug: 'demo',
    project: async () => 3,
    client: {
      request: async (req: { method: string; path: string; body?: Record<string, unknown> }) => {
        calls.push({ method: req.method, path: req.path, ...(req.body !== undefined ? { body: req.body } : {}) })
        if (req.method === 'GET' && req.path === '/roles') return { json: [{ id: 18, name: 'Stakeholder', slug: 'stakeholder' }] }
        if (req.method === 'POST' && req.path === '/memberships') return { json: { id: 44, email: (req.body ?? {})['username'], user: null, role: 18, role_name: 'Stakeholder', is_active: true } }
        throw new Error(`unexpected ${req.method} ${req.path}`)
      },
      paginate: async () => memberships,
    },
  }
  return { ctx: ctx as never, calls }
}

describe('793 邀请 token 形状', () => {
  it('邮件 URL /invitation/<token>（真机形态）与旧 /register/<token> 都识别，取最后一条', () => {
    expect(findInviteToken(`... http://localhost:9000/invitation/${TOKEN} ...`)).toBe(TOKEN)
    expect(findInviteToken(`legacy http://taiga.test/register/${TOKEN} ...`)).toBe(TOKEN)
    expect(findInviteToken(`a /invitation/${TOKEN}\nb /invitation/${TOKEN.replace('A', 'Z')}`)).toBe(TOKEN.replace('A', 'Z'))
    expect(findInviteToken('no token')).toBeNull()
  })
})

describe('793 inviteMember 邮箱形 username', () => {
  it('email 提供时 POST /memberships 的 username=email（绕过 contact 校验）；不提供时=纯 username', async () => {
    const { ctx, calls } = fakeCtx()
    await inviteMember(ctx, { username: 'REL-1', roleSlug: 'stakeholder', email: 'rel-1@studio.local' })
    expect(calls.find((c) => c.path === '/memberships')?.body).toMatchObject({ project: 3, username: 'rel-1@studio.local', role: 18 })
    const { ctx: ctx2, calls: calls2 } = fakeCtx()
    await inviteMember(ctx2, { username: 'REL-1', roleSlug: 'stakeholder' })
    expect(calls2.find((c) => c.path === '/memberships')?.body).toMatchObject({ username: 'REL-1' })
  })

  it('findMembershipByEmail 按 email 匹配（邀请行 user=null 也能查）', async () => {
    const { ctx } = fakeCtx([{ id: 44, username: '', email: 'rel-1@studio.local', user: null, role: 18, role_name: 'Stakeholder', is_active: true }])
    expect((await findMembershipByEmail(ctx, 'rel-1@studio.local'))?.id).toBe(44)
    expect(await findMembershipByEmail(ctx, 'other@studio.local')).toBeUndefined()
  })
})

describe('793 registerWithInviteToken：email 必填语义（探针）', () => {
  it('body 带 email/accepted_terms/full_name（full_name 缺省=username）', async () => {
    const calls: Array<Record<string, unknown>> = []
    const fetchLike = (async (_url: string, init?: { body?: string }) => {
      calls.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ username: 'rel-1', id: 9 }), { status: 201 })
    }) as never
    await registerWithInviteToken({ baseUrl: 'http://taiga.test', token: TOKEN, username: 'rel-1', email: 'rel-1@studio.local', password: 'pw123456', fetch: fetchLike })
    expect(calls[0]).toMatchObject({ type: 'private', token: TOKEN, accepted_terms: true, username: 'rel-1', email: 'rel-1@studio.local', full_name: 'rel-1' })
  })
})
