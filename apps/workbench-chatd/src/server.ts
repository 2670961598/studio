/**
 * workbench-chatd 服务端（Phase1 模块 A / P1-1b + 模块 C 最小刀 + P1-2 wake lease 最小刀）：
 * Unix socket + NDJSON 帧 + token 鉴权。
 * 依据：docs/sentinel-logs/Phase1实现拆解-2026-11-17.md 模块 A/§五（端点）＋ 模块 C（内存→SQLite；
 *       wake_lease/wake_delivery TTL/重试≤3/dead-letter；append-only 审计）；
 *       docs/sentinel-logs/提案-Phase1聊天服务-2026-11-17.md；docs/quality/workbench-transport-v1.md（DTO 冻结）。
 * 协议：workbench-transport/v1（冻结于 packages/workbench-transport/src/types.ts）。本包不 import 该包
 *       （分层宪法 20-§十五：新包间边=提案流），wire DTO/错误码以镜像对齐，由契约测试（真客户端）背书。
 * 存储：缺省内存 mock（P1-1b 原语义，重启即空；wake 租约语义在内存态照常生效）；WORKBENCH_CHATD_DB
 *       设置即 SQLite 持久化（send/read/ack/claim 落库、重启 hydrate 恢复；见 src/store/）。
 *       两种模式共用同一 dispatch，端点响应形状（Transport v1 冻结面）不因模式改变。
 * 鉴权：token 经 env WORKBENCH_CHATD_TOKEN；请求 params.token 比对。v1 冻结错误码表无 UNAUTHENTICATED，
 *       无/错 token 以 WB_INVALID_ARGUMENT（retryable:false，message 前缀 unauthenticated:）承载——
 *       若后续协议版本引入专用鉴权码，须走 version 升级，不得静默改码。
 * 边界：不接 vendor collab、不写公司目录、不迁 Matrix 数据、无网络。
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import type { Server, Socket } from 'node:net'
import { removeSocketFile, bindUnixSocket } from './socket.ts'
import { buildHealth } from './health.ts'
import type { ChatdConfig } from './config.ts'
import type { Logger } from './log.ts'
import { createChatStore } from './store/index.ts'
import { createInitialState, WAKE_MAX_DELIVERY_ATTEMPTS } from './store/types.ts'
import type { ChatStore, MockMessage, MockRoom, MockState, MockWake, WakeEvent, WakeLease } from './store/types.ts'

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

// ─── 运行时状态（内存 mock 即时态；SQLite 模式启动时 hydrate 回填、写路径 write-through 落库） ──
// 域类型唯一源在 src/store/types.ts（memory/sqlite 两后端与 dispatch 共用）。

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

// ─── wake 租约（P1-2 wake lease 最小刀）───────────────────────────────────────
// 语义（依据 模块 C：wake_lease/wake_delivery TTL/重试/dead-letter）：
//  - claim 授予租约（claimedUntil = now + wakeLeaseMs）；同 actor 在租约有效期内重复
//    claim 同一 wake = 幂等（alreadyClaimed，回同 lease，不延期不计数）。
//  - 租约过期后再 claim = 重投（attempt+1，claimed 数组回包），租约重授。
//  - 投递次数上限 WAKE_MAX_DELIVERY_ATTEMPTS（首投计 1）：超限 → dead-letter（租约终态），
//    此后 claim 回稳定错误 WB_WAKE_NOT_CLAIMABLE（不重投、审计不再追加），inbox 不再计 pending。
//  - ack 幂等（alreadyAcked）；ack 后租约终态 acked。
//  - 每次状态迁移 append 一条审计事件（内存 push / SQLite 落 wake_events，只追加不物理删）。

/** 取 wake 当前租约；无记录（含 v1 遗留/异常态）按「未投递」合成，安全回落首投语义。 */
const leaseOf = (state: MockState, wakeId: string): WakeLease =>
  state.wakeLeases.get(wakeId) ?? { wakeId, attempt: 0, state: 'pending', claimedBy: null, leaseExpiresAt: null, updatedAt: 0 }

/** dispatch 所需租约参数（config 装配传入）。 */
interface WakeDispatchOpts {
  readonly leaseTtlMs: number
}

/** 内存态迁移 + store 落库（DB 先行，失败抛错 → WB_INTERNAL、内存不落地）+ 审计追加。 */
function commitWakeTransition(state: MockState, store: ChatStore, wake: MockWake, lease: WakeLease, type: WakeEvent['type']): void {
  const event: WakeEvent = {
    eventId: state.wakeEventSeq + 1,
    wakeId: wake.wakeId,
    type,
    attempt: lease.attempt,
    actorId: wake.actorId,
    claimedBy: lease.claimedBy,
    leaseExpiresAt: lease.leaseExpiresAt,
    at: lease.updatedAt,
  }
  store.recordWakeTransition(wake, lease, event)
  state.wakeEventSeq += 1
  state.wakeLeases.set(wake.wakeId, lease)
  state.wakeEvents.push(event)
}

// ─── 端点实现（语义与 P1-1a 已验收的 mock-sidecar 一致；由契约测试背书） ────────
// 落库纪律：分配型写入（rooms/messages/wakes）DB 先行——失败抛错 → WB_INTERNAL、内存不落地，
// 保证 seq 计数器与库内 id 分配一致（无空洞）；覆盖型写入（read 游标/wake 状态）内存先行、DB 镜像。
function dispatch(state: MockState, store: ChatStore, method: string, p: Record<string, unknown>, wakeOpts: WakeDispatchOpts): unknown {
  switch (method) {
    case 'health':
      return buildHealth(state.startedAt, store.mode === 'sqlite' ? 'sqlite' : 'mock')
    case 'rooms.list':
      return [...state.rooms.values()]
    case 'rooms.create': {
      const kind = p['kind']
      const name = str(p, 'name')
      const memberIds = strArray(p, 'memberIds')
      if ((kind !== 'broadcast' && kind !== 'group' && kind !== 'dm') || name === undefined || name === '' || memberIds === undefined) {
        throw new WbFailure('WB_INVALID_ARGUMENT', 'kind/name/memberIds invalid')
      }
      const room: MockRoom = { roomId: `room-${String(state.roomSeq + 1)}`, kind, name, memberIds: [...new Set(memberIds)], headRoomSeq: 0 }
      store.insertRoom(room)
      state.roomSeq += 1
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
      const { value, replayed } = idempotent(state, store, scope, str(p, 'idempotencyKey'), () => {
        const seq = state.msgSeq + 1
        const roomSeq = room.headRoomSeq + 1
        const message: MockMessage = {
          messageId: `msg-${String(seq)}`,
          seq,
          roomSeq,
          roomId: room.roomId,
          senderId: sender,
          body,
          mentions,
          createdAt: Date.now(),
        }
        const wakes: MockWake[] = []
        const wakeLeases: WakeLease[] = []
        const wakeEvents: WakeEvent[] = []
        let wakeSeq = state.wakeSeq
        for (const m of new Set(mentions)) {
          wakeSeq += 1
          const now = Date.now()
          wakes.push({
            wakeId: `wake-${String(wakeSeq)}`,
            actorId: m,
            roomId: room.roomId,
            sourceSeq: seq,
            cause: mentions.length > 1 ? 'room' : 'mention',
            status: 'pending',
            claimedBy: null,
            claimedUntil: null,
            createdAt: now,
            ackedAt: null,
          })
          wakeLeases.push({ wakeId: `wake-${String(wakeSeq)}`, attempt: 0, state: 'pending', claimedBy: null, leaseExpiresAt: null, updatedAt: now })
          wakeEvents.push({ eventId: state.wakeEventSeq + wakeLeases.length, wakeId: `wake-${String(wakeSeq)}`, type: 'created', attempt: 0, actorId: m, claimedBy: null, leaseExpiresAt: null, at: now })
        }
        store.appendMessage(message, wakes, wakeLeases, wakeEvents) // DB 事务先行（message+wakes+租约+审计原子）；失败 → 内存不落地
        state.msgSeq = seq
        state.wakeSeq = wakeSeq
        room.headRoomSeq = roomSeq
        state.messages.push(message)
        for (const w of wakes) state.wakes.push(w)
        for (const l of wakeLeases) state.wakeLeases.set(l.wakeId, l)
        for (const e of wakeEvents) state.wakeEvents.push(e)
        state.wakeEventSeq += wakeEvents.length
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
      const { value, replayed } = idempotent(state, store, `read:${actor}|${room.roomId}`, str(p, 'idempotencyKey'), () => {
        const key = `${actor}|${room.roomId}`
        const prev = state.reads.get(key) ?? 0
        const next = Math.min(room.headRoomSeq, Math.max(prev, upTo))
        state.reads.set(key, next)
        store.setRead(actor, room.roomId, next) // 覆盖写（upsert 同键）；值语义与内存一致：单调不回退
        return { roomId: room.roomId, actorId: actor, lastReadRoomSeq: next, unread: Math.max(0, room.headRoomSeq - next), replayed: false }
      })
      return { ...(value as { roomId: string; actorId: string; lastReadRoomSeq: number; unread: number; replayed: boolean }), replayed }
    }
    case 'inbox': {
      const actor = str(p, 'actorId')
      if (actor === undefined || actor === '') throw new WbFailure('WB_INVALID_ARGUMENT', 'actorId required')
      // pending = 未 ack 且未 dead-letter（dead 是投递终态：不再重投、不再计入待处理）。
      const pending = state.wakes.filter((w) => w.actorId === actor && w.status !== 'acked' && leaseOf(state, w.wakeId).state !== 'dead')
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
      const { value, replayed } = idempotent(state, store, `claim:${actor}`, str(p, 'idempotencyKey'), () => {
        const claimed: string[] = []
        const alreadyClaimed: string[] = []
        const wakes: unknown[] = []
        for (const id of ids) {
          const w = state.wakes.find((x) => x.wakeId === id)
          if (w === undefined) throw new WbFailure('WB_WAKE_NOT_FOUND', 'wake not found')
          if (w.actorId !== actor) throw new WbFailure('WB_WAKE_NOT_FOUND', 'wake not owned by actor')
          if (w.status === 'acked') throw new WbFailure('WB_WAKE_NOT_CLAIMABLE', 'wake already acked')
          const now = Date.now()
          // 租约有效期内：同 actor 幂等（回同 lease，不延期不计数）；他人持有才拒。
          if (w.status === 'claimed' && w.claimedUntil !== null && w.claimedUntil > now) {
            if (w.claimedBy === actor) {
              alreadyClaimed.push(id)
              wakes.push({ ...w })
              continue
            }
            throw new WbFailure('WB_WAKE_NOT_CLAIMABLE', 'wake claimed by other')
          }
          const lease = leaseOf(state, id)
          // 重试上限 → dead-letter（终态；只落一次迁移，重复 claim 回同一稳定错误、审计不再追加）。
          if (lease.state === 'dead' || lease.attempt >= WAKE_MAX_DELIVERY_ATTEMPTS) {
            if (lease.state !== 'dead') {
              commitWakeTransition(state, store, w, { wakeId: id, attempt: lease.attempt, state: 'dead', claimedBy: null, leaseExpiresAt: null, updatedAt: now }, 'dead_lettered')
            }
            throw new WbFailure('WB_WAKE_NOT_CLAIMABLE', `wake dead-lettered after ${String(WAKE_MAX_DELIVERY_ATTEMPTS)} delivery attempts`)
          }
          // 首投或租约过期重投：attempt+1，租约重授（claimedUntil 重算）。
          const attempt = lease.attempt + 1
          const expiresAt = now + wakeOpts.leaseTtlMs
          const updated: MockWake = { ...w, status: 'claimed', claimedBy: actor, claimedUntil: expiresAt }
          commitWakeTransition(state, store, updated, { wakeId: id, attempt, state: 'leased', claimedBy: actor, leaseExpiresAt: expiresAt, updatedAt: now }, attempt === 1 ? 'claimed' : 'redelivered')
          Object.assign(w, updated)
          claimed.push(id)
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
      const { value, replayed } = idempotent(state, store, `ack:${actor}`, str(p, 'idempotencyKey'), () => {
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
          const now = Date.now()
          const lease = leaseOf(state, id)
          const updated: MockWake = { ...w, status: 'acked', ackedAt: now, claimedBy: null, claimedUntil: null }
          commitWakeTransition(state, store, updated, { wakeId: id, attempt: lease.attempt, state: 'acked', claimedBy: null, leaseExpiresAt: null, updatedAt: now }, 'acked')
          Object.assign(w, updated)
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

/** 幂等助手：key 存在则回放首次结果（replayed=true），否则执行 run 并记录（SQLite 模式随记落库，重启可 replay）。 */
function idempotent(state: MockState, store: ChatStore, scope: string, key: string | undefined, run: () => unknown): { value: unknown; replayed: boolean } {
  if (key === undefined) return { value: run(), replayed: false }
  const k = `${scope}|${key}`
  if (state.idempotency.has(k)) return { value: state.idempotency.get(k), replayed: true }
  const value = run()
  state.idempotency.set(k, value)
  store.recordIdempotency(k, value)
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
  const store = createChatStore(config, log)
  const state: MockState = createInitialState()
  store.hydrate(state) // SQLite 模式：重启恢复（rooms/messages/wakes/reads/idempotency + seq 计数器）
  if (store.mode === 'sqlite') log.info('store_hydrated', { rooms: state.rooms.size, messages: state.messages.length, wakes: state.wakes.length, reads: state.reads.size })
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
      return { id: rid, ok: true, result: dispatch(state, store, method, p, { leaseTtlMs: config.wakeLeaseMs }) }
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
      log.info('listening', {
        socketPath: config.socketPath,
        auth: config.token !== undefined,
        delayMs: config.delayMs,
        mode: store.mode === 'sqlite' ? 'sqlite' : 'mock',
        dbPath: config.dbPath ?? null,
        wakeLeaseMs: config.wakeLeaseMs,
      })
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
      store.close() // SQLite 模式：关库落定（内存模式 no-op）
      log.info('stopped', { socketPath: config.socketPath, drained: inFlight === 0, store: store.mode })
    },
    inFlight: () => inFlight,
    isStarted: () => started,
  }
}
