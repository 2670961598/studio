/**
 * chat/server —— 面板自研聊天室 Hono 路由层（M4-3 最小刀）
 *
 * 端面（任务单 M4-3）：
 *   GET  /chat                     聊天室页（房间列表＋消息流＋输入框＋未读数；原生 JS 轮询）；
 *                                 未启用=降级「未启用」说明页（200，不报错）
 *   GET  /api/chat/rooms[?actor=]  房间列表（rooms.list；带 actor 时并入 inbox 未读数）
 *   GET  /api/chat/messages?roomId=&actor=&limit=   消息窗（messages.list，limit 缺省 50 夹 200）
 *   POST /api/chat/send            发送（messages.send；幂等键可选透传）
 *   POST /api/chat/read            标记已读（read，upToRoomSeq 单调）
 *
 * 错误体唯一形状 { ok:false, error:{ code, message, retryable? } }：WB_* 稳定码原样透传
 * （HTTP 映射见 types.ts WB_HTTP_STATUS）；面板本地码 CHAT_PANEL_DISABLED(503)/
 * CHAT_INVALID_ARGUMENT(400)/CHAT_PANEL_INTERNAL(500)（不自造 WB 码）。
 *
 * 鉴权面：无（panel 缺省只绑环回——server.ts listenHono 判例；token 是 chatd 侧凭据，
 * 经 env 注入 params 上帧，不经 URL/页面）。写面 POST 不加面板令牌：本刀口径=内部环回面
 * （同 /api/chat 读面），生产接线批示时再议。
 */
import { Hono, type Context } from 'hono'
import { WB_ERROR_CODES } from '@studio-next/workbench-transport'
import type { WbErrorCode } from '@studio-next/workbench-transport'
import { renderChatPage, type ChatPageOptions } from './page.ts'
import {
  DEFAULT_CHAT_ACTOR_ID,
  DEFAULT_CHAT_LIMIT,
  DEFAULT_CHAT_POLL_MS,
  MAX_CHAT_BODY_CHARS,
  MAX_CHAT_LIMIT,
  WB_HTTP_STATUS,
  type ChatPanelErrorBody,
  type ChatPanelTransport,
} from './types.ts'

/** createChatApp 选项 */
export interface ChatAppOptions {
  /** transport 注入（null=未启用：页面降级、API 一律 503 CHAT_PANEL_DISABLED） */
  readonly transport: ChatPanelTransport | null
  /** chatd 鉴权 token（可选；注入每个调用的 params 上帧，永不入页面/日志/错误体） */
  readonly token?: string
  /** 缺省操作者工号（缺省 'panel'；chatd 按房间成员校验） */
  readonly defaultActorId?: string
  /** 页面轮询间隔 ms（缺省 2000；非正数落回缺省） */
  readonly pollIntervalMs?: number
  /**
   * @补全人员源（§十.3，可选：门户传 '/api/org'——页内输入 @ 弹在册工号列表；
   * 缺省不传=补全关闭，监控面行为零变化。值须以 / 开头，否则注入时丢弃。）
   */
  readonly peopleUrl?: string
  /**
   * 页面渲染器（可选，加法式注入位——docs/plan/11-公司门户-2026-11-23.md §1.2）：
   * 缺省=renderChatPage 独立整页（现行为零变化）；门户装配方传入「门户壳包 renderChatBody」
   * 的渲染器以统一导航与主题——业务脚本/类名/路由仍单源在本包，不改聊天业务逻辑。
   */
  readonly pageRenderer?: (opts: ChatPageOptions) => string
}

const WB_CODES = new Set<string>(WB_ERROR_CODES)

type ChatFail = { readonly status: number; readonly body: ChatPanelErrorBody }

function fail(status: number, code: ChatPanelErrorBody['error']['code'], message: string, retryable?: boolean): ChatFail {
  return {
    status,
    body: { ok: false, error: retryable === undefined ? { code, message } : { code, message, retryable } },
  }
}

/** 传输/未知错误 → 稳定错误面：WB 冻结码原样透传（HTTP 映射）；其余 500 本地码不伪装 */
export function classifyChatFailure(err: unknown): ChatFail {
  const code = (err as { code?: unknown } | null | undefined)?.code
  const message = err instanceof Error ? err.message : String(err)
  if (typeof code === 'string' && WB_CODES.has(code)) {
    const retryable = (err as { retryable?: unknown }).retryable
    return fail(WB_HTTP_STATUS[code as WbErrorCode], code as WbErrorCode, message, retryable === true ? true : undefined)
  }
  return fail(500, 'CHAT_PANEL_INTERNAL', `面板聊天室内部错误：${message}`)
}

function failResponse(c: Context, f: ChatFail): Response {
  return c.json(f.body, f.status as 400 | 401 | 403 | 404 | 409 | 500 | 502 | 503)
}

const DISABLED = (): ChatFail =>
  fail(503, 'CHAT_PANEL_DISABLED', 'chatd 未配置：WORKBENCH_CHATD_SOCKET 未设置（面板聊天室默认关闭）')

const invalid = (message: string): ChatFail => fail(400, 'CHAT_INVALID_ARGUMENT', message)

// —— 参数校验（面板侧前置；过闸后才触达 transport） ——

const strField = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

export interface ParsedSendBody {
  readonly roomId: string
  readonly senderId: string
  readonly body: string
  readonly mentions: readonly string[]
  readonly idempotencyKey: string | undefined
}

/** POST /api/chat/send 请求体校验（roomId/ senderId 默认缺省工号；body 非空 ≤4000；mentions 字串数组） */
export function parseSendBody(value: unknown, defaultActorId: string): { ok: true; value: ParsedSendBody } | { ok: false; fail: ChatFail } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, fail: invalid('请求体须为 JSON 对象') }
  const raw = value as Record<string, unknown>
  const roomId = strField(raw['roomId'])
  if (roomId === undefined || roomId.trim() === '') return { ok: false, fail: invalid('roomId 必填（非空字符串）') }
  const body = strField(raw['body'])
  if (body === undefined || body.trim() === '') return { ok: false, fail: invalid('body 必填（非空字符串）') }
  if (body.length > MAX_CHAT_BODY_CHARS) return { ok: false, fail: invalid(`body 超长（>${String(MAX_CHAT_BODY_CHARS)} 字符）`) }
  const senderRaw = strField(raw['senderId'])
  const senderId = senderRaw !== undefined && senderRaw.trim() !== '' ? senderRaw : defaultActorId
  const mentionsRaw = raw['mentions']
  const mentions =
    mentionsRaw === undefined
      ? []
      : Array.isArray(mentionsRaw) && mentionsRaw.every((m) => typeof m === 'string' && m.trim() !== '')
        ? (mentionsRaw as string[])
        : undefined
  if (mentions === undefined) return { ok: false, fail: invalid('mentions 须为字符串数组（可省略）') }
  const keyRaw = strField(raw['idempotencyKey'])
  const idempotencyKey = keyRaw !== undefined && keyRaw.trim() !== '' ? keyRaw : undefined
  return { ok: true, value: { roomId, senderId, body, mentions, idempotencyKey } }
}

export interface ParsedReadBody {
  readonly roomId: string
  readonly actorId: string
  readonly upToRoomSeq: number
}

/** POST /api/chat/read 请求体校验（roomId 必填；actorId 默认缺省工号；upToRoomSeq 正整数） */
export function parseReadBody(value: unknown, defaultActorId: string): { ok: true; value: ParsedReadBody } | { ok: false; fail: ChatFail } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, fail: invalid('请求体须为 JSON 对象') }
  const raw = value as Record<string, unknown>
  const roomId = strField(raw['roomId'])
  if (roomId === undefined || roomId.trim() === '') return { ok: false, fail: invalid('roomId 必填（非空字符串）') }
  const actorRaw = strField(raw['actorId'])
  const actorId = actorRaw !== undefined && actorRaw.trim() !== '' ? actorRaw : defaultActorId
  const upTo = raw['upToRoomSeq']
  if (typeof upTo !== 'number' || !Number.isInteger(upTo) || upTo <= 0) {
    return { ok: false, fail: invalid('upToRoomSeq 必填（正整数）') }
  }
  return { ok: true, value: { roomId, actorId, upToRoomSeq: upTo } }
}

/** limit 查询参夹取（chatd 同口径：非正整数/非数落缺省 50；超上限夹 200） */
export function clampChatLimit(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_CHAT_LIMIT
  return Math.min(parsed, MAX_CHAT_LIMIT)
}

async function readJsonBody(c: Context): Promise<{ ok: true; value: unknown } | { ok: false; fail: ChatFail }> {
  const contentType = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  if (contentType !== 'application/json') return { ok: false, fail: invalid('content-type 须为 application/json') }
  const raw = await c.req.text()
  if (Buffer.byteLength(raw, 'utf8') > 32_768) return { ok: false, fail: invalid('请求体超长（>32KiB）') }
  try {
    return { ok: true, value: JSON.parse(raw) as unknown }
  } catch {
    return { ok: false, fail: invalid('请求体不是合法 JSON') }
  }
}

/**
 * 聊天室子应用（满路径挂载：`app.route('/', createChatApp(…))`——conversation 判例）。
 * transport=null 时页面降级「未启用」，API 一律 503（不返回空列表冒充无房间）。
 */
export function createChatApp(opts: ChatAppOptions): Hono {
  const defaultActorId = opts.defaultActorId ?? DEFAULT_CHAT_ACTOR_ID
  const pollMs =
    opts.pollIntervalMs !== undefined && Number.isInteger(opts.pollIntervalMs) && opts.pollIntervalMs > 0
      ? opts.pollIntervalMs
      : DEFAULT_CHAT_POLL_MS
  const auth = opts.token !== undefined ? { token: opts.token } : {}
  const enabled = opts.transport !== null

  const app = new Hono()
  const renderPage = opts.pageRenderer ?? renderChatPage

  /** 查询参净化（§十.3 预填/预选）：控制字符剥离＋长度钳位；空/全空白=未提供。
   *  宽松过界（不 400）——预填失败无副作用，坏参=回落缺省行为。 */
  const cleanPageParam = (raw: string | undefined, max: number): string | undefined => {
    if (raw === undefined) return undefined
    const cleaned = raw.replaceAll(/[\u0000-\u001f\u007f]/g, '').trim()
    if (cleaned === '') return undefined
    return cleaned.slice(0, max)
  }
  /** @补全人员源安全面：仅接受站内相对路径（/ 开头），其余丢弃（不外跳） */
  const peopleUrl = opts.peopleUrl !== undefined && opts.peopleUrl.startsWith('/') ? opts.peopleUrl : undefined

  app.get('/chat', (c) => {
    const draft = cleanPageParam(c.req.query('draft'), 400)
    const room = cleanPageParam(c.req.query('room'), 96)
    return c.html(
      renderPage({
        enabled,
        defaultActorId,
        pollIntervalMs: pollMs,
        ...(draft !== undefined ? { draft } : {}),
        ...(room !== undefined ? { room } : {}),
        ...(peopleUrl !== undefined ? { peopleUrl } : {}),
      }),
    )
  })

  app.get('/api/chat/rooms', async (c) => {
    const transport = opts.transport
    if (transport === null) return failResponse(c, DISABLED())
    const actorRaw = c.req.query('actor')
    const actor = actorRaw !== undefined && actorRaw.trim() !== '' ? actorRaw : null
    try {
      const rooms = [...(await transport.listRooms({ ...auth }))]
      if (actor === null) {
        return c.json({ ok: true, actor: null, totalUnread: null, rooms: rooms.map((room) => ({ ...room, unread: null })) })
      }
      const inbox = await transport.inbox({ actorId: actor, ...auth })
      const unreadByRoom = new Map(inbox.rooms.map((r) => [r.roomId, r.unread]))
      const joined = rooms.map((room) => ({ ...room, unread: unreadByRoom.get(room.roomId) ?? 0 }))
      return c.json({ ok: true, actor, totalUnread: joined.reduce((sum, room) => sum + (room.unread ?? 0), 0), rooms: joined })
    } catch (err) {
      return failResponse(c, classifyChatFailure(err))
    }
  })

  app.get('/api/chat/messages', async (c) => {
    const transport = opts.transport
    if (transport === null) return failResponse(c, DISABLED())
    const roomId = c.req.query('roomId')
    if (roomId === undefined || roomId.trim() === '') return failResponse(c, invalid('roomId 必填（非空字符串）'))
    const actorRaw = c.req.query('actor')
    const actorId = actorRaw !== undefined && actorRaw.trim() !== '' ? actorRaw : defaultActorId
    const limit = clampChatLimit(c.req.query('limit'))
    try {
      const page = await transport.listMessages({ roomId, actorId, limit, ...auth })
      return c.json({ ok: true, roomId, actorId, limit, page })
    } catch (err) {
      return failResponse(c, classifyChatFailure(err))
    }
  })

  app.post('/api/chat/send', async (c) => {
    const transport = opts.transport
    if (transport === null) return failResponse(c, DISABLED())
    const body = await readJsonBody(c)
    if (!body.ok) return failResponse(c, body.fail)
    const parsed = parseSendBody(body.value, defaultActorId)
    if (!parsed.ok) return failResponse(c, parsed.fail)
    try {
      const result = await transport.sendMessage({
        roomId: parsed.value.roomId,
        senderId: parsed.value.senderId,
        body: parsed.value.body,
        ...(parsed.value.mentions.length > 0 ? { mentions: parsed.value.mentions } : {}),
        ...(parsed.value.idempotencyKey !== undefined ? { idempotencyKey: parsed.value.idempotencyKey } : {}),
        ...auth,
      })
      return c.json({ ok: true, result })
    } catch (err) {
      return failResponse(c, classifyChatFailure(err))
    }
  })

  app.post('/api/chat/read', async (c) => {
    const transport = opts.transport
    if (transport === null) return failResponse(c, DISABLED())
    const body = await readJsonBody(c)
    if (!body.ok) return failResponse(c, body.fail)
    const parsed = parseReadBody(body.value, defaultActorId)
    if (!parsed.ok) return failResponse(c, parsed.fail)
    try {
      const result = await transport.read({ roomId: parsed.value.roomId, actorId: parsed.value.actorId, upToRoomSeq: parsed.value.upToRoomSeq, ...auth })
      return c.json({ ok: true, result })
    } catch (err) {
      return failResponse(c, classifyChatFailure(err))
    }
  })

  return app
}
