/**
 * broadcast.ts 单测（105-刀B-1/-2/-6，studio-dev-219）：
 * 角色→alias 命名 / alias 解析与缓存 / 部门映射缺失软失败 / 逐频道失败隔离 /
 * 发送失败后缓存失效重解析一次（频道重建自愈）/ from 署名透传（format 面）。
 * 假网：注入式 fetch 回放（零真实 IO，同 provision.test.ts 纪律）。
 */
import { describe, expect, it } from 'vitest'
import { createMatrixBroadcastFace, targetAlias } from './broadcast.ts'
import { MatrixClient, type FetchInit, type FetchLike, type FetchResponse } from './client.ts'
import type { Notification } from '@studio-next/contract'

/** 假 fetch：路由表 path 前缀 → 响应序列（send 的 txnId 段随机——前缀匹配；`__throw`=网络错） */
function fakeFetch(routes: Record<string, Array<unknown | { __throw: string }>>): FetchLike & { calls: Array<{ method: string; path: string; body?: unknown }> } {
  const calls: Array<{ method: string; path: string; body?: unknown }> = []
  const fn = async (url: string, init: FetchInit): Promise<FetchResponse> => {
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0] ?? ''
    calls.push({ method: init.method ?? 'GET', path, body: init.body !== undefined ? JSON.parse(init.body) : undefined })
    const key = Object.keys(routes)
      .filter((k) => path === k || path.startsWith(`${k}/`))
      .sort((a, b) => b.length - a.length)[0]
    const seq = (key !== undefined ? routes[key] : undefined) ?? []
    const next = seq.shift() ?? { errcode: 'M_UNRECOGNIZED', error: 'unplanned' }
    if (typeof next === 'object' && next !== null && '__throw' in (next as Record<string, unknown>)) {
      throw new Error(String((next as { __throw: string }).__throw))
    }
    return { ok: true, status: 200, json: async () => next }
  }
  fn.calls = calls
  return fn
}

/** 已登录假网套件（auth: true 面需 access_token——login 走假路由；返回 fetch 观测面+client） */
async function loggedInClient(routes: Record<string, Array<unknown | { __throw: string }>>): Promise<{ f: ReturnType<typeof fakeFetch>; client: MatrixClient }> {
  const f = fakeFetch({ '/_matrix/client/v3/login': [{ user_id: '@bot:localhost', access_token: 'tok', device_id: 'd' }], ...routes })
  const client = new MatrixClient({ baseUrl: 'http://hs', fetch: f })
  await client.login('@bot:localhost', 'pw')
  return { f, client }
}

const N: Notification = { kind: 'gate', title: '过闸', body: '四要件齐', from: 'daemon@test（bot 代发）' }
const OPTS = { slug: 'studio-dev', deptSlugs: { 'departments/研发部': 'rnd', 'departments/综合部': 'gen' } as Record<string, string>, serverName: 'localhost' }

describe('targetAlias（角色→alias 命名，130-P3 §6.7.1）', () => {
  it('alert/overview/部门 path → `#<slug>-<seg>:<server>` 全形', () => {
    expect(targetAlias('alert', OPTS)).toBe('#studio-dev-alert:localhost')
    expect(targetAlias('overview', OPTS)).toBe('#studio-dev-overview:localhost')
    expect(targetAlias('dept:departments/研发部', OPTS)).toBe('#studio-dev-rnd:localhost')
  })
  it('部门 path 无 deptSlugs 映射=undefined（软失败面）', () => {
    expect(targetAlias('dept:departments/未知部', OPTS)).toBeUndefined()
  })
})

describe('createMatrixBroadcastFace', () => {
  it('resolveAlias → sendMessage（消息体=格式化文本，含 from 署名尾行）', async () => {
    const { f, client } = await loggedInClient({
      '/_matrix/client/v3/directory/room/%23studio-dev-alert%3Alocalhost': [{ room_id: '!r1:localhost' }],
      '/_matrix/client/v3/rooms/!r1%3Alocalhost/send/m.room.message': [{ event_id: '$e1' }],
    })
    const face = createMatrixBroadcastFace({ client, ...OPTS, botMxid: '@bot:localhost' })
    const report = await face.send(N, { alert: true })
    expect(report).toEqual({ sent: ['alert'], failed: [] })
    const send = f.calls.find((c) => c.path.includes('/send/'))
    expect(send?.body).toEqual({ msgtype: 'm.text', body: '[gate] **过闸**\n四要件齐\n—— daemon@test（bot 代发）', 'm.mentions': {} })
  })

  it('alias 解析缓存：同 alias 两发只解析一次', async () => {
    const { f, client } = await loggedInClient({
      '/_matrix/client/v3/directory/room/%23studio-dev-overview%3Alocalhost': [{ room_id: '!r1:localhost' }],
      '/_matrix/client/v3/rooms/!r1%3Alocalhost/send/m.room.message': [{ event_id: '$e1' }, { event_id: '$e2' }],
    })
    const face = createMatrixBroadcastFace({ client, ...OPTS, botMxid: '@bot:localhost' })
    await face.send(N, { overview: true })
    await face.send(N, { overview: true })
    expect(f.calls.filter((c) => c.path.includes('/directory/room/')).length).toBe(1)
  })

  it('部门映射缺失=软失败条目，不阻其余频道（逐频道隔离，刀B-6）', async () => {
    const { client } = await loggedInClient({
      '/_matrix/client/v3/directory/room/%23studio-dev-alert%3Alocalhost': [{ room_id: '!r1:localhost' }],
      '/_matrix/client/v3/rooms/!r1%3Alocalhost/send/m.room.message': [{ event_id: '$e1' }],
    })
    const face = createMatrixBroadcastFace({ client, ...OPTS, botMxid: '@bot:localhost' })
    const report = await face.send(N, { alert: true, dept: 'departments/未知部' })
    expect(report.sent).toEqual(['alert'])
    expect(report.failed).toHaveLength(1)
    expect(report.failed[0]?.target).toBe('dept:departments/未知部')
    expect(report.failed[0]?.reason).toContain('deptSlugs')
  })

  it('单频道发送失败不抛出、不阻其余频道（软失败入报告）', async () => {
    const { client } = await loggedInClient({
      '/_matrix/client/v3/directory/room/%23studio-dev-alert%3Alocalhost': [{ room_id: '!r1:localhost' }],
      '/_matrix/client/v3/directory/room/%23studio-dev-rnd%3Alocalhost': [{ room_id: '!r2:localhost' }],
      '/_matrix/client/v3/rooms/!r1%3Alocalhost/send/m.room.message': [{ __throw: 'connection refused' }, { __throw: 'connection refused' }, { __throw: 'connection refused' }],
      '/_matrix/client/v3/rooms/!r2%3Alocalhost/send/m.room.message': [{ event_id: '$e2' }],
    })
    const face = createMatrixBroadcastFace({ client, ...OPTS, botMxid: '@bot:localhost' })
    const report = await face.send(N, { alert: true, dept: 'departments/研发部' })
    expect(report.sent).toEqual(['dept:departments/研发部'])
    expect(report.failed).toHaveLength(1)
    expect(report.failed[0]?.reason).toContain('发送失败')
  })

  it('发送失败→缓存失效→重解析一次成功（频道重建自愈面）', async () => {
    const { f, client } = await loggedInClient({
      '/_matrix/client/v3/directory/room/%23studio-dev-alert%3Alocalhost': [{ room_id: '!old:localhost' }, { room_id: '!new:localhost' }],
      '/_matrix/client/v3/rooms/!old%3Alocalhost/send/m.room.message': [{ __throw: 'room not found' }, { __throw: 'room not found' }],
      '/_matrix/client/v3/rooms/!new%3Alocalhost/send/m.room.message': [{ event_id: '$ok' }],
    })
    const face = createMatrixBroadcastFace({ client, ...OPTS, botMxid: '@bot:localhost' })
    const report = await face.send(N, { alert: true })
    expect(report).toEqual({ sent: ['alert'], failed: [] })
    expect(f.calls.some((c) => c.path.includes('!new%3Alocalhost'))).toBe(true)
  })

  it('全角色三频道各投各房；botMxid 推 alias 服务器段（serverNameOf 同源）', async () => {
    const { client } = await loggedInClient({
      '/_matrix/client/v3/directory/room/%23studio-dev-alert%3Alocalhost': [{ room_id: '!a:localhost' }],
      '/_matrix/client/v3/directory/room/%23studio-dev-overview%3Alocalhost': [{ room_id: '!o:localhost' }],
      '/_matrix/client/v3/directory/room/%23studio-dev-gen%3Alocalhost': [{ room_id: '!g:localhost' }],
      '/_matrix/client/v3/rooms/!a%3Alocalhost/send/m.room.message': [{ event_id: '$1' }],
      '/_matrix/client/v3/rooms/!o%3Alocalhost/send/m.room.message': [{ event_id: '$2' }],
      '/_matrix/client/v3/rooms/!g%3Alocalhost/send/m.room.message': [{ event_id: '$3' }],
    })
    const face = createMatrixBroadcastFace({ client, ...OPTS, botMxid: '@bot:localhost' })
    const report = await face.send(N, { alert: true, overview: true, dept: 'departments/综合部' })
    expect(report.sent).toEqual(['alert', 'overview', 'dept:departments/综合部'])
  })
})
