/**
 * hr-face 单测（DEV-48，docs/52-§7.1-§7.4 / docs/21A-§2.3）：shared-secret 注册字节口径
 * （mac=HMAC-SHA1(secret, nonce\0user\0pass\0notadmin) hexlower——fake fetch 内独立复算对拍）/
 * ensure-shape 幂等收敛（M_USER_IN_USE≈已建号 / M_FORBIDDEN≈已在房 / power 同值不写）/
 * kick 路径。零真实网络（注入 fetch 回放；Synapse 未部署——§13 风险5，协议形状按本测钉死）。
 */
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { MatrixClient } from './client.ts'
import { createMatrixHrFace, matrixLevelFor } from './hr-face.ts'

type Call = { method: string; path: string; body?: Record<string, unknown> | undefined }
type FakeFetch = (url: string, init?: RequestInit) => Promise<Response>

/**
 * 路由式回放 fetch：routes[method path] → 响应（Error 实例=按 M_USER_IN_USE/M_FORBIDDEN 回放
 * 非 2xx）；未匹配 404。记录全部调用供断言（POST register 的 mac 在断言处独立复算对拍——
 * 不经被测代码）。
 */
function makeFetch(routes: Record<string, unknown>, log: Call[] = []): { fetch: FakeFetch } {
  const fake: FakeFetch = async (url, init) => {
    const u = new URL(url)
    // 客户端对 path 段做 URL 编码（@→%40、#→%23）——路由键按解码形匹配
    const key = `${init?.method ?? 'GET'} ${decodeURIComponent(u.pathname)}`
    log.push({ method: init?.method ?? 'GET', path: decodeURIComponent(u.pathname), body: init?.body !== undefined ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined })
    const hit = routes[key]
    if (hit instanceof Error) {
      const inUse = hit.message.includes('IN_USE')
      return new Response(JSON.stringify({ errcode: inUse ? 'M_USER_IN_USE' : 'M_FORBIDDEN', error: hit.message }), { status: inUse ? 400 : 403 })
    }
    if (hit === undefined) return new Response(JSON.stringify({ errcode: 'M_UNRECOGNIZED', error: `no route ${key}` }), { status: 404 })
    return new Response(JSON.stringify(hit), { status: 200 })
  }
  return { fetch: fake }
}

/** 登录态走真 login 路由（userId 推导需要 bot 登录态——hr-face 头注装配前提） */
function clientOf(fetchLike: FakeFetch): MatrixClient {
  return new MatrixClient({ baseUrl: 'http://mx.test', fetch: fetchLike })
}

async function loggedInFace(routes: Record<string, unknown>, log: Call[] = []) {
  const { fetch } = makeFetch({
    'POST /_matrix/client/v3/login': { user_id: '@gateway:mx.test', access_token: 'bot-tok' },
    ...routes,
  }, log)
  const client = clientOf(fetch)
  await client.login('@gateway:mx.test', 'bot-pw')
  return { face: createMatrixHrFace({ client, sharedSecret: SECRET }), log }
}

const SECRET = 'unit-shared-secret-0001'

describe('registerWithSharedSecret（21A-§2.3 字节口径）', () => {
  it('GET nonce → POST mac 独立复算对拍（hexlower；notadmin 段）', async () => {
    const log: Call[] = []
    const nonce = 'nonce-abc-123'
    const { fetch } = makeFetch({
      'GET /_synapse/admin/v1/register': { nonce },
      'POST /_synapse/admin/v1/register': { user_id: '@xin:mx.test', access_token: 'at-1' },
    }, log)
    const c = clientOf(fetch)
    const r = await c.registerWithSharedSecret({ username: 'xin', password: 'pw-123456', sharedSecret: SECRET })
    expect(r).toEqual({ userId: '@xin:mx.test', accessToken: 'at-1' })
    const post = log.find((x) => x.method === 'POST' && x.path.endsWith('/register'))
    expect(post?.body?.nonce).toBe(nonce)
    // 独立复算（不经被测代码）：官方字节口径 nonce\0username\0password\0notadmin
    const want = createHmac('sha1', SECRET).update(`${nonce}\0xin\0pw-123456\0notadmin`).digest('hex')
    expect(post?.body?.mac).toBe(want)
  })
})

describe('ensureAccount（§7.1 + §7.4 冲突≈已建号）', () => {
  it('新号：注册成功 + displayname 设置；created=true', async () => {
    const { face, log } = await loggedInFace({
      'GET /_synapse/admin/v1/register': { nonce: 'n1' },
      'POST /_synapse/admin/v1/register': { user_id: '@xin:mx.test', access_token: 'at-2' },
      'PUT /_matrix/client/v3/profile/@xin:mx.test/displayname': {},
    })
    const r = await face.ensureAccount({ username: 'xin', displayName: '新同学', password: 'pw' })
    expect(r).toEqual({ userId: '@xin:mx.test', created: true })
    expect(log.some((c) => c.path.includes('/displayname'))).toBe(true)
  })

  it('已存在（M_USER_IN_USE）：收敛不抛 + 补设 displayname；created=false', async () => {
    const { face } = await loggedInFace({
      'GET /_synapse/admin/v1/register': { nonce: 'n2' },
      'POST /_synapse/admin/v1/register': new Error('User ID already taken'),
      'PUT /_matrix/client/v3/profile/@xin:mx.test/displayname': {},
    })
    const r = await face.ensureAccount({ username: 'xin', displayName: '新同学', password: 'pw' })
    expect(r.created).toBe(false)
    expect(r.userId).toBe('@xin:mx.test') // server 后缀从 bot userId 截取推导
  })

  it('非冲突错误如实上抛（不吞——EXTERNAL_REJECT 归 daemon 断路）', async () => {
    const { face } = await loggedInFace({}) // register 路由缺失 → 404 M_UNRECOGNIZED
    await expect(face.ensureAccount({ username: 'x', displayName: 'x', password: 'p' })).rejects.toThrow()
  })
})

describe('ensureMembership / ensurePowerLevel（§7.2 + §7.4 幂等）', () => {
  const ROOM = '!r1:mx.test'
  function roomRoutes(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      'GET /_matrix/client/v3/directory/room/#co:mx.test': { room_id: ROOM },
      'POST /_matrix/client/v3/rooms/!r1:mx.test/invite': {},
      'GET /_matrix/client/v3/rooms/!r1:mx.test/state/m.room.power_levels': { users: {} },
      'PUT /_matrix/client/v3/rooms/!r1:mx.test/state/m.room.power_levels': {},
      ...over,
    }
  }

  it('别名解析 → invite → power_level 写（成员档 0）', async () => {
    const { face, log } = await loggedInFace(roomRoutes())
    await face.ensureMembership({ userId: '@xin:mx.test', roomAlias: '#co:mx.test' })
    expect(log.some((c) => c.path.endsWith('/invite'))).toBe(true)
    expect(log.some((c) => c.path.includes('power_levels') && c.method === 'PUT')).toBe(true)
  })

  it('invite M_FORBIDDEN≈已在房：吞掉继续收敛 power_level', async () => {
    const { face, log } = await loggedInFace(roomRoutes({ 'POST /_matrix/client/v3/rooms/!r1:mx.test/invite': new Error('M_FORBIDDEN already in room') }))
    await face.ensureMembership({ userId: '@xin:mx.test', roomAlias: '#co:mx.test' })
    expect(log.some((c) => c.path.includes('power_levels') && c.method === 'PUT')).toBe(true)
  })

  it('power_level 同值不写（幂等收敛——省一次 state 写）；异值写', async () => {
    const { face, log } = await loggedInFace(roomRoutes({
      'GET /_matrix/client/v3/rooms/!r1:mx.test/state/m.room.power_levels': { users: { '@xin:mx.test': -1 } },
    }))
    await face.ensurePowerLevel({ userId: '@xin:mx.test', roomAlias: '#co:mx.test', level: -1 })
    expect(log.some((c) => c.path.includes('power_levels') && c.method === 'PUT')).toBe(false)
    await face.ensurePowerLevel({ userId: '@xin:mx.test', roomAlias: '#co:mx.test', level: 0 })
    expect(log.some((c) => c.path.includes('power_levels') && c.method === 'PUT')).toBe(true)
  })

  it('kickFromRoom 走 kick 端点（退场可复邀）', async () => {
    const { face, log } = await loggedInFace({ ...roomRoutes(), 'POST /_matrix/client/v3/rooms/!r1:mx.test/kick': {} })
    await face.kickFromRoom({ userId: '@xin:mx.test', roomAlias: '#co:mx.test', reason: 'hr 退场' })
    const kick = log.find((c) => c.path.endsWith('/kick'))
    expect(kick?.body?.reason).toBe('hr 退场')
    expect(kick?.body?.user_id).toBe('@xin:mx.test')
  })
})

describe('matrixLevelFor（§7.2 表注——daemon 映射表同源）', () => {
  it('paused→muted(-1)；active→member(0)；档位可注入', () => {
    expect(matrixLevelFor('paused')).toBe(-1)
    expect(matrixLevelFor('active')).toBe(0)
    expect(matrixLevelFor('paused', 50, -5)).toBe(-5)
    expect(matrixLevelFor('active', 50)).toBe(50)
  })
})
