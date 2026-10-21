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
  /** by_slug 内嵌成员真源（T5 写通断言材料：注册/移除后由路由面变更） */
  membersList?: Array<{ id: number; username: string; full_name_display: string }>
}

function stubCtx(stub: TaigaStub): { context: TaigaHrFaceOptions['context']; fetch: TaigaHrFaceOptions['fetch'] } {
  const fetchLike: NonNullable<TaigaHrFaceOptions['fetch']> = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input)
    const method = init?.method ?? 'GET'
    calls.push({ method, path: url.pathname, body: init?.body !== undefined ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined })
    if (url.pathname.endsWith('/projects/by_slug')) return json({ id: 7, slug: 'proj', members: stub.membersList ?? [] })
    if (url.pathname.endsWith('/roles')) return json([{ id: 3, name: 'Member', slug: 'member' }, { id: 4, name: '核心成员', slug: 'core' }])
    if (url.pathname.endsWith('/auth/register')) {
      if ((stub.registerStatus ?? 201) < 300) {
        ;(stub.membersList ??= []).push({ id: 99, username: 'xin', full_name_display: '新同学' }) // 注册=成员位激活（T5 断言材料）
      }
      return json({ username: 'xin', id: 99 }, stub.registerStatus ?? 201)
    }
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
      const gone = stub.memberships.find((m) => m.id === Number(del[1]))
      stub.memberships = stub.memberships.filter((m) => m.id !== Number(del[1]))
      if (gone !== undefined) stub.membersList = (stub.membersList ?? []).filter((m) => m.username !== gone.username)
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

// ————————————————— T5 写通（studio-dev-126）：成员集变更即作废同实例缓存 —————————————————

describe('T5 写通：hr 面成员集变更后 invalidateMembers()（写通作废，缓存不过夜）', () => {
  /** T5 用装配：同 context 出 face+直读口（写通断言须打在同一实例上） */
  function faceWithCtx(stub: TaigaStub, logText: string | null): { face: TaigaHrFace; context: TaigaHrFaceOptions['context'] } {
    const { context, fetch } = stubCtx(stub)
    const face = createTaigaHrFace({ context, baseUrl: 'http://taiga.test', inviteLog: { read: async () => logText ?? '', polls: 3, intervalMs: 50 }, fetch, sleep: async () => {} })
    return { face, context }
  }

  it('ensureMember 注册成功 → 同实例 usernameById 即刻见新成员（不靠下次拍自愈）', async () => {
    const stub: TaigaStub = { memberships: [], membersList: [{ id: 1, username: 'admin', full_name_display: '管' }] }
    const { face, context } = faceWithCtx(stub, LOG_WITH_TOKEN)
    await expect(context.usernameById(99)).resolves.toBeUndefined() // 注册前：不在成员集
    const r = await face.ensureMember({ username: 'xin', roleSlug: 'member' })
    expect(r.created).toBe(true)
    // 写通断言：非自愈型读面（usernameById undefined 返回型，T1 明确不自愈）立即见真——
    // 若 hr 面不写通作废，此处返回 undefined（长驻 daemon 旧视图=派单 unknown-user 假红源）
    await expect(context.usernameById(99)).resolves.toBe('xin')
  })

  it('removeMember 移除成功 → 同实例 usernameById 即刻不见（停位不占席）', async () => {
    const stub: TaigaStub = {
      memberships: [{ id: 12, username: 'li', role_slug: 'member', is_active: true }],
      membersList: [{ id: 1, username: 'admin', full_name_display: '管' }, { id: 12, username: 'li', full_name_display: '李' }],
    }
    const { face, context } = faceWithCtx(stub, null)
    await expect(context.usernameById(12)).resolves.toBe('li') // 移除前在位
    await face.removeMember({ username: 'li' })
    await expect(context.usernameById(12)).resolves.toBeUndefined() // 写通：即刻出席
  })
})
