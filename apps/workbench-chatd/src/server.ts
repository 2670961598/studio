/**
 * workbench-chatd 服务端（Phase1 模块 A / P1-1b）：Unix socket + NDJSON 帧 + token 鉴权 + 内存 mock 端点。
 * 依据：docs/sentinel-logs/Phase1实现拆解-2026-11-17.md 模块 A/§五（mock 端点：health/rooms/messages/read/inbox）；
 *       docs/quality/workbench-transport-v1.md（P1-1b 对接点：按 transport types 实现服务端）。
 * 协议：workbench-transport/v1（冻结于 packages/workbench-transport/src/types.ts）。本包不 import 该包
 *       （分层宪法 20-§十五：新包间边=提案流），wire DTO/错误码以镜像对齐，由契约测试（真客户端）背书。
 * 鉴权：token 经 env WORKBENCH_CHATD_TOKEN；请求 params.token 比对。v1 冻结错误码表无 UNAUTHENTICATED，
 *       无/错 token 以 WB_INVALID_ARGUMENT（retryable:false，message 前缀 unauthenticated:）承载——
 *       若后续协议版本引入专用鉴权码，须走 version 升级，不得静默改码。
 * 边界：内存 mock、不建 chat.db、不写公司目录；P1-2（模块 C）以 vendor collab + SQLite 替换本存储。
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import type { Server, Socket } from 'node:net'
import { removeSocketFile, bindUnixSocket } from './socket.ts'
import { buildHealth } from './health.ts'
import type { ChatdConfig } from './config.ts'
import type { Logger } from './log.ts'

// ─── wire 镜像（workbench-transport/v1 冻结面；只读对齐，不扩不改） ─────────────
type WbErrorCode =
  | 'WB_UNAVAILABLE'
  | 'WB_TIMEOUT'
  | 'WB_NOT_CONNECTED'
  | 'WB_PROTOCOL'
  | 'WB_INVALID_ARGUMENT'
  | 'WB_ROOM_NOT_FOUND'
  | 'WB_MESSAGE_NOT_FOUND'
  | 'WB_WAKE_NOT_FOUND'
  | 'WB_WAKE_NOT_CLAIMABLE'
  | 'WB_IDEMPOTENCY_CONFLICT'
  | 'WB_INTERNAL'

interface WbErrorBody {
  readonly code: WbErrorCode
  readonly message: string
  readonly retryable?: boolean
}
type WbFrame = { readonly id: string; readonly ok: true; readonly result: unknown } | { readonly id: string; readonly ok: false; readonly error: WbErrorBody }

/** 端点内业务失败 → 稳定错误码（dispatch 内 throw，帧层统一转 error 帧）。 */
class WbFailure extends Error {
  readonly code: WbErrorCode
  constructor(code: WbErrorCode, message: string) {
    super(message)
    this.name = 'WbFailure'
    this.code = code
  }
}

// ─── 内存 mock 状态（P1-2 换 SQLite；进程内生命周期，重启即空——骨架预期） ──────
interface MockRoom {
  roomId: string
  kind: 'broadcast' | 'group' | 'dm'
  name: string
  memberIds: string[]
  headRoomSeq: number
}
/** 冻结 Message 镜像（seq/roomSeq/roomId/senderId/body/mentions/createdAt）；messageId 仅内部幂等用。 */
interface MockMessage {
  messageId: string
  seq: number
  roomSeq: number
  roomId: string
  senderId: string
  body: string
  mentions: string[]
  createdAt: number
}
interface MockWake {
  wakeId: string
  actorId: string
  roomId: string
  sourceSeq: number
  cause: 'mention' | 'mention_all' | 'dm' | 'room'
  status: 'pending' | 'claimed' | 'acked'
  claimedBy: string | null
  claimedUntil: number | null
  createdAt: number
  ackedAt: number | null
}
interface MockState {
  readonly rooms: Map<string, MockRoom>
  readonly messages: MockMessage[]
  readonly wakes: MockWake[]
  readonly reads: Map<string, number> // `${actorId}|${roomId}` -> lastReadRoomSeq
  readonly idempotency: Map<string, unknown> // scope|key -> 首次结果（replay 用）
  readonly startedAt: number
  roomSeq: number
  msgSeq: number
  wakeSeq: number
}

const failFrame = (id: string, code: WbErrorCode, message: string, retryable?: boolean): WbFrame => ({
  id,
  ok: false,
  error: retryable === undefined ? { code, message } : { code, message, retryable },
})

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

/** 参数取值助手：只收 string。 */
const str = (p: Record<string, unknown>, key: string): string | undefined => {
  const v = p[key]
  return typeof v === 'string' ? v : undefined
}
/** 参数取值助手：只收 string[]。 */
const strArray = (p: Record<string, unknown>, key: string): string[] | undefined => {
  const v = p[key]
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined
}

const actorOf = (p: Record<string, unknown>): string => str(p, 'actorId') ?? str(p, 'senderId') ?? ''

// ─── 端点实现（语义与 P1-1a 已验收的 mock-sidecar 一致；由契约测试背书） ────────
function dispatch(state: MockState, method: string, p: Record<string, unknown>): unknown {
  switch (method) {
    case 'health':
      return buildHealth(state.startedAt)
    case 'rooms.list':
      return [...state.rooms.values()]
    case 'rooms.create': {
      const kind = p['kind']
      const name = str(p, 'name')
      const memberIds = strArray(p, 'memberIds')
      if ((kind !== 'broadcast' && kind !== 'group' && kind !== 'dm') || name === undefined || name === '' || memberIds === undefined) {
        throw new WbFailure('WB_INVALID_ARGUMENT', 'kind/name/memberIds invalid')
      }
      state.roomSeq += 1
      const room: MockRoom = { roomId: `room-${String(state.roomSeq)}`, kind, name, memberIds: [...new Set(memberIds)], headRoomSeq: 0 }
      state.rooms.set(room.roomId, room)
      return room
    }
    case 'messages.send': {
      const room = state.rooms.get(str(p, 'roomId') ?? '')
      const sender = actorOf(p)
      if (room === undefined) throw new WbFailure('WB_ROOM_NOT_FOUND', 'room not found')
      if (!room.memberIds.includes(sender)) throw new WbFailure('WB_INVALID_ARGUMENT', 'sender is not a room member')
      const body = str(p, 'body')
      if (body === undefined || body.trim() === '') throw new WbFailure('WB_INVALID_ARGUMENT', 'body empty')
      const mentions = strArray(p, 'mentions') ?? []
      if (!mentions.every((m) => room.memberIds.includes(m))) throw new WbFailure('WB_INVALID_ARGUMENT', 'mention not a room member')
      const scope = `send:${sender}|${room.roomId}`
      const { value, replayed } = idempotent(state, scope, str(p, 'idempotencyKey'), () => {
        state.msgSeq += 1
        room.headRoomSeq += 1
        const message: MockMessage = {
          messageId: `msg-${String(state.msgSeq)}`,
          seq: state.msgSeq,
          roomSeq: room.headRoomSeq,
          roomId: room.roomId,
          senderId: sender,
          body,
          mentions,
          createdAt: Date.now(),
        }
        state.messages.push(message)
        for (const m of new Set(mentions)) {
          state.wakeSeq += 1
          const wake: MockWake = {
            wakeId: `wake-${String(state.wakeSeq)}`,
            actorId: m,
            roomId: room.roomId,
            sourceSeq: message.seq,
            cause: mentions.length > 1 ? 'room' : 'mention',
            status: 'pending',
            claimedBy: null,
            claimedUntil: null,
            createdAt: Date.now(),
            ackedAt: null,
          }
          state.wakes.push(wake)
        }
        return { seq: message.seq, roomSeq: message.roomSeq, messageId: message.messageId, replayed: false }
      })
      return { ...(value as { seq: number; roomSeq: number; messageId: string; replayed: boolean }), replayed }
    }
    case 'messages.list': {
      const room = state.rooms.get(str(p, 'roomId') ?? '')
      const actor = actorOf(p)
      if (room === undefined) throw new WbFailure('WB_ROOM_NOT_FOUND', 'room not found')
      if (!room.memberIds.includes(actor)) throw new WbFailure('WB_INVALID_ARGUMENT', 'actor is not a room member')
      const limitRaw = p['limit']
      const limit = typeof limitRaw === 'number' ? Math.min(200, Math.max(1, Math.trunc(limitRaw))) : 50
      const all = state.messages.filter((m) => m.roomId === room.roomId)
      const items = all.slice(0, limit).map((m) => ({ seq: m.seq, roomSeq: m.roomSeq, roomId: m.roomId, senderId: m.senderId, body: m.body, mentions: m.mentions, createdAt: m.createdAt }))
      return { items, nextCursor: null, hasMore: all.length > items.length }
    }
    case 'read': {
      const room = state.rooms.get(str(p, 'roomId') ?? '')
      const actor = str(p, 'actorId')
      if (room === undefined) throw new WbFailure('WB_ROOM_NOT_FOUND', 'room not found')
      if (actor === undefined || actor === '') throw new WbFailure('WB_INVALID_ARGUMENT', 'actorId required')
      const upTo = p['upToRoomSeq']
      if (typeof upTo !== 'number' || !Number.isInteger(upTo) || upTo <= 0) throw new WbFailure('WB_INVALID_ARGUMENT', 'upToRoomSeq invalid')
      const { value, replayed } = idempotent(state, `read:${actor}|${room.roomId}`, str(p, 'idempotencyKey'), () => {
        const key = `${actor}|${room.roomId}`
        const prev = state.reads.get(key) ?? 0
        const next = Math.min(room.headRoomSeq, Math.max(prev, upTo))
        state.reads.set(key, next)
        return { roomId: room.roomId, actorId: actor, lastReadRoomSeq: next, unread: Math.max(0, room.headRoomSeq - next), replayed: false }
      })
      return { ...(value as { roomId: string; actorId: string; lastReadRoomSeq: number; unread: number; replayed: boolean }), replayed }
    }
    case 'inbox': {
      const actor = str(p, 'actorId')
      if (actor === undefined || actor === '') throw new WbFailure('WB_INVALID_ARGUMENT', 'actorId required')
      const pending = state.wakes.filter((w) => w.actorId === actor && w.status !== 'acked')
      const roomIds = strArray(p, 'roomIds') ?? [...state.rooms.keys()]
      const rooms = roomIds.map((id) => {
        const r = state.rooms.get(id)
        const unread = r === undefined ? 0 : Math.max(0, r.headRoomSeq - (state.reads.get(`${actor}|${id}`) ?? 0))
        return { roomId: id, unread, pendingWakes: pending.filter((w) => w.roomId === id).length }
      })
      return {
        actorId: actor,
        unread: rooms.reduce((s, r) => s + r.unread, 0),
        mentions: pending.filter((w) => w.cause === 'mention' || w.cause === 'mention_all').length,
        pendingWakeIds: pending.map((w) => w.wakeId),
        rooms,
      }
    }
    case 'wakes.claim': {
      const actor = str(p, 'actorId')
      if (actor === undefined || actor === '') throw new WbFailure('WB_INVALID_ARGUMENT', 'actorId required')
      const ids = strArray(p, 'wakeIds')
      if (ids === undefined) throw new WbFailure('WB_INVALID_ARGUMENT', 'wakeIds required')
      const { value, replayed } = idempotent(state, `claim:${actor}`, str(p, 'idempotencyKey'), () => {
        const claimed: string[] = []
        const alreadyClaimed: string[] = []
        const wakes: unknown[] = []
        for (const id of ids) {
          const w = state.wakes.find((x) => x.wakeId === id)
          if (w === undefined) throw new WbFailure('WB_WAKE_NOT_FOUND', 'wake not found')
          if (w.actorId !== actor) throw new WbFailure('WB_WAKE_NOT_FOUND', 'wake not owned by actor')
          if (w.status === 'acked') throw new WbFailure('WB_WAKE_NOT_CLAIMABLE', 'wake already acked')
          if (w.status === 'claimed' && w.claimedBy === actor) alreadyClaimed.push(id)
          else if (w.status === 'claimed') throw new WbFailure('WB_WAKE_NOT_CLAIMABLE', 'wake claimed by other')
          else {
            w.status = 'claimed'
            w.claimedBy = actor
            w.claimedUntil = Date.now() + 30_000
            claimed.push(id)
          }
          wakes.push({ ...w })
        }
        return { claimed, alreadyClaimed, wakes, replayed: false }
      })
      return { ...(value as { claimed: string[]; alreadyClaimed: string[]; wakes: unknown[]; replayed: boolean }), replayed }
    }
    case 'wakes.ack': {
      const actor = str(p, 'actorId')
      if (actor === undefined || actor === '') throw new WbFailure('WB_INVALID_ARGUMENT', 'actorId required')
      const ids = strArray(p, 'wakeIds')
      if (ids === undefined) throw new WbFailure('WB_INVALID_ARGUMENT', 'wakeIds required')
      const { value, replayed } = idempotent(state, `ack:${actor}`, str(p, 'idempotencyKey'), () => {
        const acked: string[] = []
        const alreadyAcked: string[] = []
        for (const id of ids) {
          const w = state.wakes.find((x) => x.wakeId === id)
          if (w === undefined || w.actorId !== actor) throw new WbFailure('WB_WAKE_NOT_FOUND', 'wake not found')
          if (w.status === 'acked') {
            alreadyAcked.push(id)
            continue
          }
          if (w.status === 'claimed' && w.claimedBy !== actor) throw new WbFailure('WB_WAKE_NOT_CLAIMABLE', 'wake not claimed by actor')
          w.status = 'acked'
          w.ackedAt = Date.now()
          w.claimedBy = null
          w.claimedUntil = null
          acked.push(id)
        }
        return { acked, alreadyAcked, replayed: false }
      })
      return { ...(value as { acked: string[]; alreadyAcked: string[]; replayed: boolean }), replayed }
    }
    default:
      throw new WbFailure('WB_PROTOCOL', `unknown method ${method}`)
  }
}

/** 幂等助手：key 存在则回放首次结果（replayed=true），否则执行 run 并记录。 */
function idempotent(state: MockState, scope: string, key: string | undefined, run: () => unknown): { value: unknown; replayed: boolean } {
  if (key === undefined) return { value: run(), replayed: false }
  const k = `${scope}|${key}`
  if (state.idempotency.has(k)) return { value: state.idempotency.get(k), replayed: true }
  const value = run()
  state.idempotency.set(k, value)
  return { value, replayed: false }
}

/** token 常时比较（sha256 摘要后 timingSafeEqual，避免长度泄露/时序侧信道）。 */
function tokenMatches(presented: string, expected: string): boolean {
  const h1 = createHash('sha256').update(presented, 'utf8').digest()
  const h2 = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(h1, h2)
}

export interface ChatdServer {
  readonly socketPath: string
  start(): Promise<void>
  /** 优雅停机：停听 → 拒新帧（WB_UNAVAILABLE draining）→ drain 在途（≤drainTimeoutMs）→ 拆连接 → 清 socket 文件。 */
  stop(): Promise<void>
  inFlight(): number
  isStarted(): boolean
}

export function createChatdServer(config: ChatdConfig, log: Logger): ChatdServer {
  const state: MockState = {
    rooms: new Map(),
    messages: [],
    wakes: [],
    reads: new Map(),
    idempotency: new Map(),
    startedAt: Date.now(),
    roomSeq: 0,
    msgSeq: 0,
    wakeSeq: 0,
  }
  const sockets = new Set<Socket>()
  let server: Server | undefined
  let draining = false
  let inFlight = 0
  let started = false

  const writeFrame = (socket: Socket, frame: WbFrame): void => {
    try {
      socket.write(`${JSON.stringify(frame)}\n`)
    } catch {
      socket.destroy()
    }
  }

  /** 单帧处理：解析 → 鉴权 → dispatch → 响应。所有失败都落稳定错误码，不裸抛。 */
  const processLine = (line: string): WbFrame => {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return failFrame('unknown', 'WB_PROTOCOL', 'invalid JSON frame')
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return failFrame('unknown', 'WB_PROTOCOL', 'frame must be a JSON object')
    const { id, method, params } = parsed as { id?: unknown; method?: unknown; params?: unknown }
    const rid = typeof id === 'string' ? id : 'unknown'
    if (typeof id !== 'string') return failFrame(rid, 'WB_PROTOCOL', 'request id must be a string')
    if (typeof method !== 'string') return failFrame(rid, 'WB_PROTOCOL', 'request method must be a string')
    if (params !== undefined && (typeof params !== 'object' || params === null || Array.isArray(params))) return failFrame(rid, 'WB_PROTOCOL', 'request params must be an object')
    const p = (params ?? {}) as Record<string, unknown>

    if (config.token !== undefined) {
      const presented = str(p, 'token')
      if (presented === undefined) return failFrame(rid, 'WB_INVALID_ARGUMENT', 'unauthenticated: token missing', false)
      if (!tokenMatches(presented, config.token)) return failFrame(rid, 'WB_INVALID_ARGUMENT', 'unauthenticated: token invalid', false)
    }

    try {
      return { id: rid, ok: true, result: dispatch(state, method, p) }
    } catch (err) {
      if (err instanceof WbFailure) {
        log.warn('request_rejected', { method, code: err.code, message: err.message })
        return failFrame(rid, err.code, err.message)
      }
      log.error('request_internal', { method, message: err instanceof Error ? err.message : String(err) })
      return failFrame(rid, 'WB_INTERNAL', 'internal error')
    }
  }

  /** 轻量取帧 id（drain 拒绝帧回显用；解析失败回落 unknown）。 */
  const frameIdOf = (line: string): string => {
    try {
      const parsed = JSON.parse(line) as { id?: unknown }
      return typeof parsed.id === 'string' ? parsed.id : 'unknown'
    } catch {
      return 'unknown'
    }
  }

  const handleLine = (socket: Socket, line: string): void => {
    inFlight += 1
    const finish = (): void => {
      inFlight -= 1
    }
    // 停机判定在「帧到达」时刻做：已收帧（含 delay 中在途）照常完成，之后新到帧立即拒绝。
    if (draining) {
      try {
        writeFrame(socket, failFrame(frameIdOf(line), 'WB_UNAVAILABLE', 'draining', true))
      } finally {
        finish()
      }
      return
    }
    const run = (): void => {
      try {
        writeFrame(socket, processLine(line))
      } finally {
        finish()
      }
    }
    if (config.delayMs > 0) setTimeout(run, config.delayMs)
    else run()
  }

  const onConnection = (socket: Socket): void => {
    sockets.add(socket)
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', (chunk: string) => {
      buffer += chunk
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf('\n')
        if (line.trim() !== '') handleLine(socket, line)
      }
    })
    socket.on('close', () => { sockets.delete(socket) })
    socket.on('error', () => { sockets.delete(socket); socket.destroy() })
    log.debug('connection_open', { active: sockets.size })
  }

  return {
    socketPath: config.socketPath,
    async start(): Promise<void> {
      if (started) throw new Error('chatd already started')
      server = await bindUnixSocket(config.socketPath, onConnection)
      server.on('error', (err: Error) => { log.error('server_error', { message: err.message }) })
      started = true
      log.info('listening', { socketPath: config.socketPath, auth: config.token !== undefined, delayMs: config.delayMs, mode: 'mock' })
    },
    async stop(): Promise<void> {
      if (!started) return
      started = false
      draining = true
      const active = server as Server
      const closed = new Promise<void>((resolve) => { active.close(() => resolve()) }) // 停止接受新连接；cb 等全部连接结束
      const deadline = Date.now() + config.drainTimeoutMs
      while (inFlight > 0 && Date.now() < deadline) await sleep(25)
      if (inFlight > 0) log.warn('drain_deadline', { inFlight, drainTimeoutMs: config.drainTimeoutMs })
      for (const s of sockets) s.destroy()
      sockets.clear()
      await closed
      removeSocketFile(config.socketPath)
      log.info('stopped', { socketPath: config.socketPath, drained: inFlight === 0 })
    },
    inFlight: () => inFlight,
    isStarted: () => started,
  }
}
