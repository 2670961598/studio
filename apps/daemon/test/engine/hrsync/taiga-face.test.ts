/**
 * taiga-face 测试（DEV-48，docs/52-§6.1/§6.2/§6.4）：ensure-shape 全收敛面——
 * 在位激活=created false 不重邀不在位=邀请→轮询令牌→注册闭环（口令派生自一次性
 * 令牌=确定性）；注册冲突≈已建号收敛；令牌窗口外=如实失败（任务回队，§9.2）；
 * ensureRole 同角色不 PATCH/不在位如实抛；removeMember 已移除=no-op。
 * 网络=注入 fake fetch（buildContext 走真 client）；日志=fake InviteLogSource；
 * sleep 注入免真等待。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { buildContext } from '@studio-next/taiga'
import { createTaigaHrFace, type InviteLogSource, type TaigaHrFaceOptions } from '../../../src/engine/hrsync/taiga-face.ts'
import type { TaigaHrFace } from '../../../src/engine/hrsync/hrsync.ts'

/** 路由式 fake fetch（ memberships 族 + auth/register；calls 记录断言材料） */
const calls: { method: string; path: string; body?: Record<string, unknown> } = []

beforeEach(() => {
  calls.length = 0
})

interface TaigaStub {
  memberships: Array<{ id: number; username: string; role_slug: string; is_active: boolean }>
  registerStatus?: number // 缺省 201
}

function stubCtx(stub: TaigaStub): { context: TaigaHrFaceOptions['context']; fetch: TaigaHrFaceOptions['fetch'] } {
  const fetchLike: NonNullable<TaigaHrFaceOptions['fetch']> = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input)
    const method = init?.method ?? 'GET'
    calls.push({ method, path: url.pathname, body: init?.body !== undefined ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined })
    if (url.pathname.endsWith('/projects/by_slug')) return json({ id: 7, slug: 'proj', members: [] })
    if (url.pathname.endsWith('/roles')) return json([{ id: 3, name: 'Member', slug: 'member' }, { id: 4, name: '核心成员', slug: 'core' }])
    if (url.pathname.endsWith('/auth/register')) return json({ username: 'xin', id: 99 }, stub.registerStatus ?? 201)
    if (url.pathname.endsWith('/memberships')) {
      if (method === 'POST') {
        const body = init?.body !== undefined ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
        const id = 100 + stub.memberships.length
        stub.memberships.push({ id, username: String(body.username ?? ''), role_slug: 'member', is_active: false })
        return json({ id, username: body.username, role_name: 'Member', role_slug: 'member', is_active: false }, 201)
      }
      return json(stub.memberships)
    }
    const patch = /^\/api\/v1\/memberships\/(\d+)$/.exec(url.pathname)
    if (patch !== null && method === 'PATCH') return json({ id: Number(patch[1]), username: 'x', role_name: 'Member', role_slug: 'member', is_active: true })
    const del = /^\/api\/v1\/memberships\/(\d+)$/.exec(url.pathname)
    if (del !== null && method === 'DELETE') {
      stub.memberships = stub.memberships.filter((m) => m.id !== Number(del[1]))
      return new Response(null, { status: 204 })
    }
    return json({ _error_message: `no route ${url.pathname}` }, 404)
  }
  return { context: buildContext({ baseUrl: 'http://taiga.test', project: 'proj', auth: { type: 'token', token: 'tok' }, fetch: fetchLike }), fetch: fetchLike }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', 'x-pagination-count': '0' } })
}

function faceOf(stub: TaigaStub, logText: string | null): { face: TaigaHrFace; reads: number } {
  let reads = 0
  const inviteLog: InviteLogSource = {
    read: async () => {
      reads += 1
      return logText ?? ''
    },
    polls: 3,
    intervalMs: 50,
  }
  const { context, fetch } = stubCtx(stub)
  const face = createTaigaHrFace({ context, baseUrl: 'http://taiga.test', inviteLog, fetch, sleep: async () => {} })
  return { face, reads }
}

const LOG_WITH_TOKEN = 'invite sent: http://taiga.test/register/AbCdEfGh12345678901234 请查收'

describe('ensureMember（§6.1 入场链 + §6.4 幂等）', () => {
  it('不在位：邀请→轮询令牌→注册（口令派生自令牌=确定性）→created=true', async () => {
    const stub: TaigaStub = { memberships: [] }
    const { face } = faceOf(stub, LOG_WITH_TOKEN)
    const r = await face.ensureMember({ username: 'xin', roleSlug: 'member', displayName: '新同学' })
    expect(r.created).toBe(true)
    const invite = calls.find((c) => c.method === 'POST' && c.path.endsWith('/memberships'))
    expect(invite?.body).toEqual({ project: 7, username: 'xin', role: 3 })
    const reg = calls.find((c) => c.path.endsWith('/auth/register'))
    expect(reg?.body?.token).toBe('AbCdEfGh12345678901234')
    expect(reg?.body?.full_name).toBe('新同学')
    expect(reg?.body?.password).toBe('sn-AbCdEfGh1234') // 令牌前 12 位——重试同口令
  })

  it('在位且激活：不重邀不注册（created=false）', async () => {
    const stub: TaigaStub = { memberships: [{ id: 11, username: 'xin', role_slug: 'member', is_active: true }] }
    const { face, reads } = faceOf(stub, null)
    const r = await face.ensureMember({ username: 'xin', roleSlug: 'member' })
    expect(r).toEqual({ membershipId: 11, created: false })
    expect(reads).toBe(0) // 不进令牌轮询
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('注册冲突（400/register-rejected）≈已建号：回查 membership 收敛 created=false', async () => {
    const stub: TaigaStub = { memberships: [], registerStatus: 400 }
    const { face } = faceOf(stub, LOG_WITH_TOKEN)
    const r = await face.ensureMember({ username: 'xin', roleSlug: 'member' })
    expect(r.created).toBe(false)
  })

  it('令牌窗口外未见日志：如实抛（任务回队重试——§9.2，不猜不吞）', async () => {
    const stub: TaigaStub = { memberships: [] }
    const { face } = faceOf(stub, null)
    await expect(face.ensureMember({ username: 'xin', roleSlug: 'member' })).rejects.toThrow('邀请令牌')
  })
})

describe('ensureRole / removeMember（§6.2 + §6.4）', () => {
  it('同角色=目标态不 PATCH；异角色 PATCH', async () => {
    const stub: TaigaStub = { memberships: [{ id: 11, username: 'xin', role_slug: 'core', is_active: true }] }
    const { face } = faceOf(stub, null)
    await face.ensureRole({ username: 'xin', roleSlug: 'core' })
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false)
    await face.ensureRole({ username: 'xin', roleSlug: 'member' })
    const patch = calls.find((c) => c.method === 'PATCH' && c.path.endsWith('/memberships/11'))
    expect(patch?.body).toEqual({ role: 3 })
  })

  it('不在位升/降：如实抛（时序漂移不静默）', async () => {
    const stub: TaigaStub = { memberships: [] }
    const { face } = faceOf(stub, null)
    await expect(face.ensureRole({ username: 'ghost', roleSlug: 'member' })).rejects.toThrow('不在位')
  })

  it('removeMember：在位 DELETE；已移除=no-op', async () => {
    const stub: TaigaStub = { memberships: [{ id: 12, username: 'li', role_slug: 'member', is_active: true }] }
    const { face } = faceOf(stub, null)
    await face.removeMember({ username: 'li' })
    expect(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/memberships/12'))).toBe(true)
    expect(stub.memberships).toHaveLength(0)
    await face.removeMember({ username: 'li' }) // 已移除=目标态
  })
})
