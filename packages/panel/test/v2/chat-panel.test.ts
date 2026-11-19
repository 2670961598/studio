/**
 * chat 面板端测试（M4-3 最小刀：自研聊天室视图——默认关闭、无生产接线）
 *
 * 覆盖：env 开关解析（缺省关闭/显式启用/token/缺省工号）、未启用降级页与 API 503、
 * 启用页渲染（UI 锚点＋内联脚本语法门）、rooms/messages/send/read API 形状与参数校验、
 * WB_* 稳定码透传（HTTP 映射）、token 随 params 上帧、createPanelApp 装配缺省路径
 * （env 未配=不拒启、env 配了=真 WorkbenchTransport 透传 WB_UNAVAILABLE）。
 * 依据：docs/plan/06-…-2026-11-19.md §四.1/§M3；Transport v1 冻结面
 * packages/workbench-transport/src/types.ts；任务单 M4-3。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WorkbenchTransportError } from '@studio-next/workbench-transport'
import type { InboxResult, MessagePage, ReadResult, Room, SendResult } from '@studio-next/workbench-transport'
import { openLedger, type Ledger } from '@studio-next/store'
import {
  clampChatLimit,
  createChatApp,
  createChatPanelOptions,
  loadChatPanelEnv,
  parseReadBody,
  parseSendBody,
  renderChatPage,
  type ChatPanelTransport,
} from '../../src/chat/index.ts'
import { createPanelApp } from '../../src/index.ts'

const TOKEN = 'chatd-test-token'

// ─── 内存 mock transport（只记录与回放，不冒充真 socket） ───────────────────────

const ROOMS: readonly Room[] = [
  { roomId: 'room-1', kind: 'broadcast', name: '全员大厅', memberIds: ['panel', 'PRIME-0'], headRoomSeq: 2 },
  { roomId: 'room-2', kind: 'group', name: '项目组', memberIds: ['PRIME-0', 'ENG-1'], headRoomSeq: 1 },
]

const PAGE: MessagePage = {
  items: [
    { seq: 1, roomSeq: 1, roomId: 'room-1', senderId: 'PRIME-0', body: '早', mentions: [], createdAt: 1_000 },
    { seq: 2, roomSeq: 2, roomId: 'room-1', senderId: 'panel', body: '收到 @PRIME-0', mentions: ['PRIME-0'], createdAt: 2_000 },
  ],
  nextCursor: null,
  hasMore: false,
}

const INBOX: InboxResult = {
  actorId: 'panel',
  unread: 2,
  mentions: 1,
  pendingWakeIds: [],
  rooms: [
    { roomId: 'room-1', unread: 2, pendingWakes: 0 },
    { roomId: 'room-2', unread: 0, pendingWakes: 0 },
  ],
}

const SEND: SendResult = { seq: 3, roomSeq: 3, messageId: 'msg-3', replayed: false }
const READ: ReadResult = { roomId: 'room-1', actorId: 'panel', lastReadRoomSeq: 2, unread: 0, replayed: false }

interface MockCalls {
  listRooms: Array<{ token?: string }>
  listMessages: Array<{ roomId: string; actorId: string; limit?: number; token?: string }>
  sendMessage: Array<{ roomId: string; senderId: string; body: string; mentions?: readonly string[]; idempotencyKey?: string; token?: string }>
  read: Array<{ roomId: string; actorId: string; upToRoomSeq: number; token?: string }>
  inbox: Array<{ actorId: string; roomIds?: readonly string[]; token?: string }>
}

function makeMock(): { calls: MockCalls; mock: ChatPanelTransport } {
  const calls: MockCalls = { listRooms: [], listMessages: [], sendMessage: [], read: [], inbox: [] }
  const mock: ChatPanelTransport = {
    async listRooms(input) {
      calls.listRooms.push(input)
      return ROOMS
    },
    async listMessages(input) {
      calls.listMessages.push(input)
      return PAGE
    },
    async sendMessage(input) {
      calls.sendMessage.push(input)
      return SEND
    },
    async read(input) {
      calls.read.push(input)
      return READ
    },
    async inbox(input) {
      calls.inbox.push(input)
      return INBOX
    },
  }
  return { calls, mock }
}

const JSON_HEADERS = { 'content-type': 'application/json' }

async function post(app: ReturnType<typeof createChatApp>, path: string, body: unknown): Promise<Response> {
  return await app.request(path, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) })
}

// ─── env 开关解析 ─────────────────────────────────────────────────────────────

describe('env 开关（缺省 off；显式启用=socket 非空）', () => {
  it('未配/空白 socket=关闭（不抛错——不因未配 chatd 拒启）', () => {
    for (const env of [{}, { WORKBENCH_CHATD_SOCKET: '' }, { WORKBENCH_CHATD_SOCKET: '   ' }]) {
      const parsed = loadChatPanelEnv(env)
      expect(parsed.enabled).toBe(false)
      expect(parsed.socketPath).toBeNull()
    }
  })

  it('socket 非空=启用；token/缺省工号规整（空白 token=未配；工号缺省 panel）', () => {
    const parsed = loadChatPanelEnv({ WORKBENCH_CHATD_SOCKET: ' /tmp/chat.sock ', WORKBENCH_CHATD_TOKEN: '  ', PANEL_CHAT_ACTOR: ' ' })
    expect(parsed).toEqual({ enabled: true, socketPath: '/tmp/chat.sock', token: undefined, defaultActorId: 'panel' })
    expect(loadChatPanelEnv({ WORKBENCH_CHATD_SOCKET: '/tmp/chat.sock', WORKBENCH_CHATD_TOKEN: ' t ' }).token).toBe('t')
    expect(loadChatPanelEnv({ WORKBENCH_CHATD_SOCKET: '/tmp/chat.sock', PANEL_CHAT_ACTOR: 'PRIME-0' }).defaultActorId).toBe('PRIME-0')
  })

  it('createChatPanelOptions：未配=transport:null；配了=transport 装配+token+缺省工号', () => {
    expect(createChatPanelOptions({})).toEqual({ transport: null })
    const opts = createChatPanelOptions({ WORKBENCH_CHATD_SOCKET: '/tmp/chat.sock', WORKBENCH_CHATD_TOKEN: TOKEN, PANEL_CHAT_ACTOR: 'PRIME-0' })
    expect(opts.transport).not.toBeNull()
    expect(opts.token).toBe(TOKEN)
    expect(opts.defaultActorId).toBe('PRIME-0')
  })
})

// ─── 未启用：页面降级 + API 503 ────────────────────────────────────────────────

describe('缺省关闭（transport:null）', () => {
  const app = createChatApp({ transport: null })

  it('页面 200 显示「未启用」（不报错不白屏；无启用态 UI）', async () => {
    const res = await app.request('/chat')
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('聊天室未启用')
    expect(html).toContain('WORKBENCH_CHATD_SOCKET')
    expect(html).not.toContain('id="rooms"')
    expect(html).not.toContain('id="sendForm"')
  })

  it('四个 API 一律 503 CHAT_PANEL_DISABLED（不回空列表冒充无房间）', async () => {
    for (const res of [
      await app.request('/api/chat/rooms'),
      await app.request('/api/chat/messages?roomId=room-1'),
      await post(app, '/api/chat/send', { roomId: 'room-1', body: 'x' }),
      await post(app, '/api/chat/read', { roomId: 'room-1', upToRoomSeq: 1 }),
    ]) {
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({
        ok: false,
        error: { code: 'CHAT_PANEL_DISABLED', message: expect.stringContaining('WORKBENCH_CHATD_SOCKET') },
      })
    }
  })
})

// ─── 启用：页面渲染 + 内联脚本语法门 ──────────────────────────────────────────

describe('启用页渲染（mock transport）', () => {
  const { mock } = makeMock()
  const app = createChatApp({ transport: mock, token: TOKEN })

  it('页面含房间列表/消息流/输入框/操作者（未读数由 JS 轮询 API 呈现）；token 不进页面', async () => {
    const res = await app.request('/chat')
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('房间（未读）')
    expect(html).toContain('id="rooms"')
    expect(html).toContain('id="messages"')
    expect(html).toContain('id="sendForm"')
    expect(html).toContain('id="actor"')
    expect(html).toContain('"enabled":true')
    expect(html).toContain('"actor":"panel"')
    expect(html).not.toContain('聊天室未启用')
    expect(html).not.toContain(TOKEN)
  })

  it('内联脚本语法可解析（node --check——ui/ 语法门同款，防上游浏览器炸）', () => {
    const html = renderChatPage({ enabled: true, defaultActorId: 'panel' })
    const match = /<script>([\s\S]*?)<\/script>/.exec(html)
    expect(match).not.toBeNull()
    const root = mkdtempSync(path.join(tmpdir(), 'chat-page-syntax-'))
    try {
      const probe = path.join(root, 'page.mjs')
      writeFileSync(probe, match?.[1] ?? '')
      expect(() => execFileSync(process.execPath, ['--check', probe], { stdio: 'pipe' })).not.toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// ─── API 形状（mock transport） ───────────────────────────────────────────────

describe('GET /api/chat/rooms', () => {
  it('无 actor：房间原样（unread=null，不冒充 0）；token 随 listRooms 上帧', async () => {
    const { calls, mock } = makeMock()
    const app = createChatApp({ transport: mock, token: TOKEN })
    const res = await app.request('/api/chat/rooms')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      actor: null,
      totalUnread: null,
      rooms: [
        { roomId: 'room-1', kind: 'broadcast', name: '全员大厅', memberIds: ['panel', 'PRIME-0'], headRoomSeq: 2, unread: null },
        { roomId: 'room-2', kind: 'group', name: '项目组', memberIds: ['PRIME-0', 'ENG-1'], headRoomSeq: 1, unread: null },
      ],
    })
    expect(calls.listRooms).toEqual([{ token: TOKEN }])
    expect(calls.inbox).toEqual([])
  })

  it('带 actor：并入 inbox 未读（inbox 缺房间=0）；totalUnread=求和；token 随 inbox 上帧', async () => {
    const { calls, mock } = makeMock()
    const app = createChatApp({ transport: mock, token: TOKEN })
    const res = await app.request('/api/chat/rooms?actor=panel')
    expect(res.status).toBe(200)
    const data = (await res.json()) as { rooms: { roomId: string; unread: number | null }[]; totalUnread: number }
    expect(data.rooms.map((r) => [r.roomId, r.unread])).toEqual([['room-1', 2], ['room-2', 0]])
    expect(data.totalUnread).toBe(2)
    expect(calls.inbox).toEqual([{ actorId: 'panel', token: TOKEN }])
  })
})

describe('GET /api/chat/messages', () => {
  const cases: Array<[string, number, string]> = [
    ['?roomId=room-1', 50, 'panel'], // 缺省 limit/缺省工号
    ['?roomId=room-1&limit=999', 200, 'panel'], // 超上限夹 200（chatd 同口径）
    ['?roomId=room-1&limit=abc', 50, 'panel'], // 非法落缺省
    ['?roomId=room-1&actor=PRIME-0&limit=3', 3, 'PRIME-0'], // 显式 actor
  ]
  for (const [query, limit, actor] of cases) {
    it(`${query} → limit=${String(limit)} actor=${actor}`, async () => {
      const { calls, mock } = makeMock()
      const app = createChatApp({ transport: mock, token: TOKEN })
      const res = await app.request(`/api/chat/messages${query}`)
      expect(res.status).toBe(200)
      const data = (await res.json()) as { ok: boolean; roomId: string; actorId: string; limit: number; page: MessagePage }
      expect(data).toMatchObject({ ok: true, roomId: 'room-1', actorId: actor, limit })
      expect(data.page).toEqual(PAGE)
      expect(calls.listMessages).toEqual([{ roomId: 'room-1', actorId: actor, limit, token: TOKEN }])
    })
  }

  it('roomId 缺失/空白 → 400 CHAT_INVALID_ARGUMENT（不触达 transport）', async () => {
    const { calls, mock } = makeMock()
    const app = createChatApp({ transport: mock })
    for (const query of ['', '?roomId=', '?roomId=%20']) {
      const res = await app.request(`/api/chat/messages${query}`)
      expect(res.status).toBe(400)
      const data = (await res.json()) as { error: { code: string } }
      expect(data.error.code).toBe('CHAT_INVALID_ARGUMENT')
    }
    expect(calls.listMessages).toEqual([])
  })
})

describe('POST /api/chat/send', () => {
  it('合法体：senderId 缺省/mentions 空=省略/幂等键透传；回 SendResult 原样', async () => {
    const { calls, mock } = makeMock()
    const app = createChatApp({ transport: mock, token: TOKEN })
    const res = await post(app, '/api/chat/send', { roomId: 'room-1', body: 'hi', idempotencyKey: 'panel-k1' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, result: SEND })
    expect(calls.sendMessage).toEqual([{ roomId: 'room-1', senderId: 'panel', body: 'hi', idempotencyKey: 'panel-k1', token: TOKEN }])
  })

  it('显式 senderId 与 mentions 透传', async () => {
    const { calls, mock } = makeMock()
    const app = createChatApp({ transport: mock })
    await post(app, '/api/chat/send', { roomId: 'room-1', senderId: 'PRIME-0', body: '@ENG-1 看', mentions: ['ENG-1'] })
    expect(calls.sendMessage).toEqual([{ roomId: 'room-1', senderId: 'PRIME-0', body: '@ENG-1 看', mentions: ['ENG-1'] }])
  })

  it('参数校验（不触达 transport）：非 JSON 对象/缺 roomId/空 body/超长/坏 mentions', async () => {
    const { calls, mock } = makeMock()
    const app = createChatApp({ transport: mock })
    const bad: unknown[] = [
      'not-object',
      { body: 'x' },
      { roomId: '  ', body: 'x' },
      { roomId: 'room-1', body: '' },
      { roomId: 'room-1', body: 'x'.repeat(4001) },
      { roomId: 'room-1', body: 'x', mentions: ['ENG-1', 7] },
    ]
    for (const body of bad) {
      const res = await post(app, '/api/chat/send', body)
      expect(res.status).toBe(400)
      const data = (await res.json()) as { error: { code: string } }
      expect(data.error.code).toBe('CHAT_INVALID_ARGUMENT')
    }
    // content-type 非 JSON 同 400
    const raw = await app.request('/api/chat/send', { method: 'POST', body: '{}' })
    expect(raw.status).toBe(400)
    expect(calls.sendMessage).toEqual([])
  })

  it('纯函数面：parseSendBody 边界（对象形状/键型）', () => {
    expect(parseSendBody(null, 'panel').ok).toBe(false)
    expect(parseSendBody([], 'panel').ok).toBe(false)
    expect(parseSendBody({ roomId: 'r', body: 'x' }, 'panel')).toEqual({
      ok: true,
      value: { roomId: 'r', senderId: 'panel', body: 'x', mentions: [], idempotencyKey: undefined },
    })
    expect(parseSendBody({ roomId: 'r', body: 'x', senderId: '  ' }, 'panel')).toEqual({
      ok: true,
      value: { roomId: 'r', senderId: 'panel', body: 'x', mentions: [], idempotencyKey: undefined },
    })
  })
})

describe('POST /api/chat/read', () => {
  it('合法体：actorId 缺省+token 上帧；回 ReadResult 原样', async () => {
    const { calls, mock } = makeMock()
    const app = createChatApp({ transport: mock, token: TOKEN })
    const res = await post(app, '/api/chat/read', { roomId: 'room-1', upToRoomSeq: 2 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, result: READ })
    expect(calls.read).toEqual([{ roomId: 'room-1', actorId: 'panel', upToRoomSeq: 2, token: TOKEN }])
  })

  it('参数校验（不触达 transport）：缺 roomId/upToRoomSeq 非正整数/非对象', async () => {
    const { calls, mock } = makeMock()
    const app = createChatApp({ transport: mock })
    for (const body of [{ upToRoomSeq: 1 }, { roomId: 'r', upToRoomSeq: 0 }, { roomId: 'r', upToRoomSeq: 1.5 }, { roomId: 'r', upToRoomSeq: '2' }, 'x']) {
      const res = await post(app, '/api/chat/read', body)
      expect(res.status).toBe(400)
      const data = (await res.json()) as { error: { code: string } }
      expect(data.error.code).toBe('CHAT_INVALID_ARGUMENT')
    }
    expect(calls.read).toEqual([])
  })

  it('纯函数面：parseReadBody actorId 显式值保留', () => {
    expect(parseReadBody({ roomId: 'r', actorId: 'ENG-1', upToRoomSeq: 3 }, 'panel')).toEqual({
      ok: true,
      value: { roomId: 'r', actorId: 'ENG-1', upToRoomSeq: 3 },
    })
  })
})

it('clampChatLimit：非正整数/非数落 50；超 200 夹 200', () => {
  expect(clampChatLimit(undefined)).toBe(50)
  expect(clampChatLimit('0')).toBe(50)
  expect(clampChatLimit('-3')).toBe(50)
  expect(clampChatLimit('x')).toBe(50)
  expect(clampChatLimit('1')).toBe(1)
  expect(clampChatLimit('200')).toBe(200)
  expect(clampChatLimit('5000')).toBe(200)
})

// ─── WB_* 稳定码透传（真 WorkbenchTransportError 形状） ────────────────────────

describe('错误码透传（WB_* → HTTP 映射；message/retryable 原样）', () => {
  const wb = (code: ConstructorParameters<typeof WorkbenchTransportError>[0]): WorkbenchTransportError => new WorkbenchTransportError(code)

  it('rooms：WB_UNAVAILABLE(retryable) → 503 + retryable:true', async () => {
    const { mock } = makeMock()
    mock.listRooms = async () => {
      throw wb({ code: 'WB_UNAVAILABLE', message: 'socket closed', retryable: true })
    }
    const app = createChatApp({ transport: mock })
    const res = await app.request('/api/chat/rooms')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false, error: { code: 'WB_UNAVAILABLE', message: 'WB_UNAVAILABLE: socket closed', retryable: true } })
  })

  it('messages：WB_ROOM_NOT_FOUND → 404', async () => {
    const { mock } = makeMock()
    mock.listMessages = async () => {
      throw wb({ code: 'WB_ROOM_NOT_FOUND', message: 'room not found' })
    }
    const res = await createChatApp({ transport: mock }).request('/api/chat/messages?roomId=nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ ok: false, error: { code: 'WB_ROOM_NOT_FOUND', message: 'WB_ROOM_NOT_FOUND: room not found' } })
  })

  it('send：WB_INVALID_ARGUMENT（chatd 端校验，如非成员）→ 400', async () => {
    const { mock } = makeMock()
    mock.sendMessage = async () => {
      throw wb({ code: 'WB_INVALID_ARGUMENT', message: 'sender is not a room member' })
    }
    const res = await post(createChatApp({ transport: mock }), '/api/chat/send', { roomId: 'room-2', body: 'x' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false, error: { code: 'WB_INVALID_ARGUMENT', message: 'WB_INVALID_ARGUMENT: sender is not a room member' } })
  })

  it('read：WB_INTERNAL → 502；WB_IDEMPOTENCY_CONFLICT → 409', async () => {
    const { mock } = makeMock()
    mock.read = async () => {
      throw wb({ code: 'WB_INTERNAL', message: 'internal error' })
    }
    const res = await post(createChatApp({ transport: mock }), '/api/chat/read', { roomId: 'r', upToRoomSeq: 1 })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ ok: false, error: { code: 'WB_INTERNAL', message: 'WB_INTERNAL: internal error' } })
    const { mock: mock2 } = makeMock()
    mock2.read = async () => {
      throw wb({ code: 'WB_IDEMPOTENCY_CONFLICT', message: 'conflict' })
    }
    const res2 = await post(createChatApp({ transport: mock2 }), '/api/chat/read', { roomId: 'r', upToRoomSeq: 1 })
    expect(res2.status).toBe(409)
  })

  it('非 WB 错误（裸 Error）→ 500 CHAT_PANEL_INTERNAL（不伪装 WB 码）', async () => {
    const { mock } = makeMock()
    mock.listRooms = async () => {
      throw new Error('boom')
    }
    const res = await createChatApp({ transport: mock }).request('/api/chat/rooms')
    expect(res.status).toBe(500)
    const data = (await res.json()) as { error: { code: string } }
    expect(data.error.code).toBe('CHAT_PANEL_INTERNAL')
  })
})

// ─── createPanelApp 装配（env 缺省路径；不因 chatd 未配拒启） ──────────────────

describe('createPanelApp 集成', () => {
  let root = ''
  let ledger: Ledger

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'studio-next-chat-panel-'))
    ledger = openLedger(path.join(root, 'panel.db'))
  })
  afterAll(() => {
    ledger.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('env 未配（缺省）：panel 照常创建，/chat 降级、/api/chat/rooms 503', async () => {
    const saved = process.env.WORKBENCH_CHATD_SOCKET
    delete process.env.WORKBENCH_CHATD_SOCKET
    try {
      const app = createPanelApp({ openLedger: () => ledger })
      expect((await app.request('/chat')).status).toBe(200)
      const res = await app.request('/api/chat/rooms')
      expect(res.status).toBe(503)
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CHAT_PANEL_DISABLED')
    } finally {
      if (saved !== undefined) process.env.WORKBENCH_CHATD_SOCKET = saved
    }
  })

  it('注入 chat opts：/api/chat 面开（覆盖 env 缺省）', async () => {
    const { mock } = makeMock()
    const app = createPanelApp({ openLedger: () => ledger, chat: { transport: mock } })
    const res = await app.request('/api/chat/rooms')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true)
  })

  it('env 配 socket（无真 chatd）：真 WorkbenchTransport → WB_NOT_CONNECTED/WB_UNAVAILABLE 透传 503', async () => {
    const saved = process.env.WORKBENCH_CHATD_SOCKET
    process.env.WORKBENCH_CHATD_SOCKET = path.join(root, 'no-such-chat.sock')
    try {
      const app = createPanelApp({ openLedger: () => ledger })
      const res = await app.request('/api/chat/rooms')
      expect(res.status).toBe(503)
      const data = (await res.json()) as { error: { code: string } }
      expect(['WB_NOT_CONNECTED', 'WB_UNAVAILABLE']).toContain(data.error.code)
    } finally {
      if (saved === undefined) delete process.env.WORKBENCH_CHATD_SOCKET
      else process.env.WORKBENCH_CHATD_SOCKET = saved
    }
  })
})
