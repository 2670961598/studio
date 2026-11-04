/**
 * 793：hr-sync Taiga 账号面（A 邮箱邀请自动建号 / B 预建池 / 幂等/诊断）
 * 用 fake context（taiga 包端点面）+ fake auth/register fetch；钉死 793 探针确认的语义：
 *   - 未知用户邀请必须用**合法邮箱形** username（否则 Taiga 400 valid contact）；
 *   - 邀请 token 在 console 日志的 /invitation/<token>；
 *   - register 必填 email；
 *   - 池命中=只绑不建号；失败保留邀请并带 id/email/日志源诊断。
 */
import { describe, expect, it } from 'vitest'
import { createTaigaHrFace, type InviteLogSource } from '../../../src/engine/hrsync/taiga-face.ts'

const ROLES = [
  { id: 18, name: 'Stakeholder', slug: 'stakeholder' },
  { id: 16, name: 'Back', slug: 'back' },
]
const TOKEN = 'AbCdEfGh1234567890123456789012345678' // 36 位 UUID 形（793 真机实测）

interface Stub {
  memberships: Array<Record<string, unknown>>
  users?: Array<{ id: number; username: string }>
  registerStatus?: number
}

function stubCtx(stub: Stub) {
  const calls: Array<{ method: string; path: string; body?: Record<string, unknown> }> = []
  let nextId = 100
  const context = {
    projectSlug: 'studio-dev',
    project: async () => 3,
    invalidateMembers: () => {},
    client: {
      request: async (req: { method: string; path: string; body?: Record<string, unknown>; query?: Record<string, string> }) => {
        calls.push({ method: req.method, path: req.path, ...(req.body !== undefined ? { body: req.body } : {}) })
        if (req.method === 'GET' && req.path === '/roles') return { json: ROLES }
        if (req.method === 'POST' && req.path === '/memberships') {
          const body = req.body ?? {}
          const row = { id: ++nextId, email: body['username'], user: null, role: body['role'], role_name: 'Stakeholder', is_active: true }
          stub.memberships.push(row)
          return { json: row }
        }
        throw new Error(`unexpected request ${req.method} ${req.path}`)
      },
      paginate: async () => stub.memberships,
    },
  }
  return { context: context as never, calls }
}

function faceOf(stub: Stub, logText: string) {
  const { context, calls } = stubCtx(stub)
  const registerCalls: Array<Record<string, unknown>> = []
  const fetchLike = async (_url: string, init?: { body?: string }) => {
    const body = init?.body !== undefined ? (JSON.parse(init.body) as Record<string, unknown>) : {}
    registerCalls.push(body)
    if (stub.registerStatus !== undefined && stub.registerStatus >= 400) {
      // 冲突≈账号已建：模拟 Taiga 已有该 user 的成员行，供回查收敛
      for (const m of stub.memberships) if (m['user'] === null) m['user'] = 999
      return new Response(JSON.stringify({ _error_message: 'mock' }), { status: stub.registerStatus })
    }
    // 注册成功：模拟 Taiga 把邀请行 user 绑定到新 user
    for (const m of stub.memberships) if (m['user'] === null) m['user'] = 999
    return new Response(JSON.stringify({ username: body['username'], id: 999 }), { status: 201 })
  }
  const inviteLog: InviteLogSource = { read: async () => logText, polls: 2, intervalMs: 1 }
  const face = createTaigaHrFace({
    context,
    baseUrl: 'http://taiga.test',
    inviteLog,
    emailDomain: 'studio.local',
    inviteLogLabel: 'docker:taiga-docker-taiga-back-1',
    fetch: fetchLike as never,
    sleep: async () => {},
  })
  return { face, calls, registerCalls }
}

describe('793 A：未知用户邮箱邀请 → token → register 建号（邮箱形 username）', () => {
  it('邀请 body 用 <login>@<domain>；register 带 email/accepted_terms；created=true', async () => {
    const stub: Stub = { memberships: [] }
    const { face, calls, registerCalls } = faceOf(stub, `http://localhost:9000/invitation/${TOKEN}`)
    const r = await face.ensureMember({ username: 'REL-1', roleSlug: 'stakeholder', displayName: '发布' })
    expect(r.created).toBe(true)
    expect(calls.find((c) => c.method === 'POST' && c.path === '/memberships')?.body).toMatchObject({ project: 3, username: 'REL-1@studio.local', role: 18 })
    expect(registerCalls).toHaveLength(1)
    expect(registerCalls[0]).toMatchObject({ type: 'private', token: TOKEN, accepted_terms: true, username: 'REL-1', email: 'REL-1@studio.local', full_name: '发布' })
  })

  it('重试复用既有邀请行（user=null），不重复 POST memberships；注册成功 created=true', async () => {
    const stub: Stub = { memberships: [{ id: 44, email: 'REL-1@studio.local', user: null, role: 18, role_name: 'Stakeholder', is_active: true }] }
    const { face, calls } = faceOf(stub, `http://localhost:9000/invitation/${TOKEN}`)
    const r = await face.ensureMember({ username: 'REL-1', roleSlug: 'stakeholder' })
    expect(r).toEqual({ membershipId: 44, created: true })
    expect(calls.filter((c) => c.path === '/memberships')).toHaveLength(0)
  })

  it('注册冲突（已有账号）→ 回查 memberships 收敛 created=false', async () => {
    const stub: Stub = { memberships: [], registerStatus: 400 }
    const { face } = faceOf(stub, `http://localhost:9000/invitation/${TOKEN}`)
    const r = await face.ensureMember({ username: 'REL-1', roleSlug: 'stakeholder' })
    expect(r.created).toBe(false)
  })

  it('token 窗口内缺失 → 如实抛，错误含邀请 id/email/日志容器（邀请保留不自动删）', async () => {
    const stub: Stub = { memberships: [] }
    const { face } = faceOf(stub, 'no invitation here')
    await expect(face.ensureMember({ username: 'REL-1', roleSlug: 'stakeholder' })).rejects.toThrow(
      /邀请令牌.*邀请行 id=.*REL-1@studio\.local.*docker:taiga-docker-taiga-back-1/,
    )
  })
})

describe('793 B：预建池命中=只绑不建号', () => {
  it('池值 email → POST memberships 用池 email；user 已存在→created=false，不调 register', async () => {
    const stub: Stub = { memberships: [] }
    const { context } = stubCtx(stub)
    const registerCalls: unknown[] = []
    const inviteLog: InviteLogSource = { read: async () => '', polls: 1, intervalMs: 1 }
    const face = createTaigaHrFace({
      context,
      baseUrl: 'http://taiga.test',
      inviteLog,
      emailDomain: 'studio.local',
      accountPool: { 'REL-1': 'rel-1@studio.local' },
      fetch: (async (...args: unknown[]) => { registerCalls.push(args); return new Response('{}', { status: 500 }) }) as never,
      sleep: async () => {},
    })
    // 池 email 命中既有 user：模拟 Taiga 直接绑定 user（不是 invitation）
    ;(stub.memberships as Array<Record<string, unknown>>).push({ id: 55, email: 'rel-1@studio.local', user: 77, role: 18, role_name: 'Stakeholder', is_active: true })
    const r = await face.ensureMember({ username: 'REL-1', roleSlug: 'stakeholder' })
    expect(r).toEqual({ membershipId: 55, created: false })
    expect(registerCalls).toHaveLength(0)
  })
})
