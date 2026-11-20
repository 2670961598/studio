/**
 * WorkbenchTransport v1 mock sidecar（仅测试用；P1-1a）。
 * 按 types.ts 冻结协议回放 health/rooms/messages/read/inbox/wakes claim+ack；
 * 不连生产/不持久化；支持断线模拟（dropConnections）与方法延迟（超时测试）。
 */
import { createServer, type Server, type Socket } from 'node:net'
import type { AckResult, ClaimResult, HealthResult, InboxResult, Message, MessagePage, ReadResult, Room, SendResult, Wake } from '../../src/types.ts'

interface MockMessage extends Message { readonly messageId: string }
type MockWake = {
  wakeId: string; actorId: string; roomId: string; sourceSeq: number; cause: Wake['cause']; status: 'pending' | 'claimed' | 'acked'; claimedBy: string | null; claimedUntil: number | null; createdAt: number; ackedAt: number | null; seq: number
}
export interface MockSidecarOptions { readonly socketPath: string; readonly serverName?: string }
export interface MockSidecar {
  readonly socketPath: string
  close(): Promise<void>
  dropConnections(): void
  setDelay(method: string, ms: number): void
  state(): { rooms: number; messages: number; wakes: number }
}

export async function startMockSidecar(options: MockSidecarOptions): Promise<MockSidecar> {
  const roomStore = new Map<string, Room & { memberIds: string[]; headRoomSeq: number }>()
  const messages: MockMessage[] = []
  const wakes: MockWake[] = []
  const reads = new Map<string, number>() // `${actorId}|${roomId}` -> lastRead
  const idempotency = new Map<string, unknown>()
  const delays = new Map<string, number>()
  const sockets = new Set<Socket>()
  let roomSeq = 0; let msgSeq = 0; let wakeSeq = 0; let startedAt = Date.now()
  const send = (socket: Socket, response: unknown): void => { socket.write(`${JSON.stringify(response)}\n`) }
  const error = (socket: Socket, id: string, code: string, message: string): void => { send(socket, { id, ok: false, error: { code, message } }) }
  const roomOf = (id: string): (Room & { memberIds: string[]; headRoomSeq: number }) | undefined => roomStore.get(id)
  const member = (r: Room & { memberIds: string[] }, actor: string): boolean => r.memberIds.includes(actor)
  const idem = (scope: string, key: string | undefined, run: () => unknown): { value: unknown; replayed: boolean } => {
    if (key === undefined) return { value: run(), replayed: false }
    const k = `${scope}|${key}`
    if (idempotency.has(k)) return { value: idempotency.get(k), replayed: true }
    const value = run(); idempotency.set(k, value); return { value, replayed: false }
  }
  const handle = (socket: Socket, req: { id: string; method: string; params?: Record<string, unknown> }): void => {
    const p = req.params ?? {}
    const actor = typeof p['actorId'] === 'string' ? p['actorId'] : typeof p['senderId'] === 'string' ? p['senderId'] : ''
    switch (req.method) {
      case 'health': {
        const result: HealthResult = { ok: true, protocol: 'workbench-transport/v1', server: options.serverName ?? 'mock', startedAt }
        send(socket, { id: req.id, ok: true, result }); return
      }
      case 'rooms.list': {
        send(socket, { id: req.id, ok: true, result: [...roomStore.values()] }); return
      }
      case 'rooms.create': {
        const kind = p['kind']; const name = p['name']; const memberIds = Array.isArray(p['memberIds']) ? p['memberIds'] as string[] : []
        if ((kind !== 'broadcast' && kind !== 'group' && kind !== 'dm') || typeof name !== 'string' || name === '' || !memberIds.every((m) => typeof m === 'string')) { error(socket, req.id, 'WB_INVALID_ARGUMENT', 'kind/name/memberIds invalid'); return }
        roomSeq += 1
        const room = { roomId: `room-${String(roomSeq)}`, kind: kind as Room['kind'], name, memberIds: [...new Set(memberIds)], headRoomSeq: 0 }
        roomStore.set(room.roomId, room); send(socket, { id: req.id, ok: true, result: room }); return
      }
      case 'messages.send': {
        const room = roomOf(String(p['roomId'] ?? ''))
        if (room === undefined) { error(socket, req.id, 'WB_ROOM_NOT_FOUND', 'room not found'); return }
        if (!member(room, actor)) { error(socket, req.id, 'WB_INVALID_ARGUMENT', 'sender is not a room member'); return }
        const body = p['body']; if (typeof body !== 'string' || body.trim() === '') { error(socket, req.id, 'WB_INVALID_ARGUMENT', 'body empty'); return }
        const mentions = Array.isArray(p['mentions']) ? (p['mentions'] as string[]) : []
        if (!mentions.every((m) => member(room, m))) { error(socket, req.id, 'WB_INVALID_ARGUMENT', 'mention not a room member'); return }
        const idempotencyKey = typeof p['idempotencyKey'] === 'string' ? p['idempotencyKey'] : undefined
        const { value, replayed } = idem(`send:${actor}`, idempotencyKey, () => {
          msgSeq += 1; room.headRoomSeq += 1
          const message: MockMessage = { seq: msgSeq, roomSeq: room.headRoomSeq, roomId: room.roomId, senderId: actor, body, mentions, createdAt: Date.now(), messageId: `msg-${String(msgSeq)}` }
          messages.push(message)
          for (const m of new Set(mentions)) {
            // sourceSeq=源消息 roomSeq（与真实 chatd server 语义对齐；消费侧按 Message.roomSeq 匹配）
            wakeSeq += 1; wakes.push({ wakeId: `wake-${String(wakeSeq)}`, actorId: m, roomId: room.roomId, sourceSeq: room.headRoomSeq, cause: mentions.length > 1 ? 'room' : 'mention', status: 'pending', claimedBy: null, claimedUntil: null, createdAt: Date.now(), ackedAt: null, seq: msgSeq })
          }
          const result: SendResult = { seq: message.seq, roomSeq: message.roomSeq, messageId: message.messageId, replayed: false }
          return result
        })
        const typed = value as SendResult
        send(socket, { id: req.id, ok: true, result: { ...typed, replayed } }); return
      }
      case 'messages.list': {
        const room = roomOf(String(p['roomId'] ?? ''))
        if (room === undefined) { error(socket, req.id, 'WB_ROOM_NOT_FOUND', 'room not found'); return }
        if (!member(room, actor)) { error(socket, req.id, 'WB_INVALID_ARGUMENT', 'actor is not a room member'); return }
        const limit = typeof p['limit'] === 'number' ? Math.min(200, Math.max(1, p['limit'])) : 50
        const items = messages.filter((m) => m.roomId === room.roomId).slice(0, limit)
        const page: MessagePage = { items, nextCursor: null, hasMore: messages.filter((m) => m.roomId === room.roomId).length > items.length }
        send(socket, { id: req.id, ok: true, result: page }); return
      }
      case 'read': {
        const room = roomOf(String(p['roomId'] ?? ''))
        if (room === undefined) { error(socket, req.id, 'WB_ROOM_NOT_FOUND', 'room not found'); return }
        const upTo = p['upToRoomSeq']; if (typeof upTo !== 'number' || !Number.isInteger(upTo) || upTo <= 0) { error(socket, req.id, 'WB_INVALID_ARGUMENT', 'upToRoomSeq invalid'); return }
        const idempotencyKey = typeof p['idempotencyKey'] === 'string' ? p['idempotencyKey'] : undefined
        const { value, replayed } = idem(`read:${actor}:${room.roomId}`, idempotencyKey, () => {
          const key = `${actor}|${room.roomId}`; const prev = reads.get(key) ?? 0; const next = Math.min(room.headRoomSeq, Math.max(prev, upTo)); reads.set(key, next)
          const result: ReadResult = { roomId: room.roomId, actorId: actor, lastReadRoomSeq: next, unread: room.headRoomSeq - next, replayed: false }
          return result
        })
        send(socket, { id: req.id, ok: true, result: { ...(value as ReadResult), replayed } }); return
      }
      case 'inbox': {
        const pending = wakes.filter((w) => w.actorId === actor && w.status !== 'acked')
        const roomIds: string[] = Array.isArray(p['roomIds']) ? (p['roomIds'] as string[]) : [...roomStore.keys()]
        const rooms = (roomIds as string[]).map((id: string) => { const r = roomOf(id); const unread = r === undefined ? 0 : Math.max(0, r.headRoomSeq - (reads.get(`${actor}|${id}`) ?? 0)); return { roomId: id, unread, pendingWakes: pending.filter((w) => w.roomId === id).length } })
        const result: InboxResult = { actorId: actor, unread: rooms.reduce((s: number, r: { unread: number }) => s + r.unread, 0), mentions: pending.filter((w) => w.cause === 'mention' || w.cause === 'mention_all').length, pendingWakeIds: pending.map((w) => w.wakeId), rooms }
        send(socket, { id: req.id, ok: true, result }); return
      }
      case 'wakes.claim': {
        const ids = Array.isArray(p['wakeIds']) ? (p['wakeIds'] as string[]) : []
        const idempotencyKey = typeof p['idempotencyKey'] === 'string' ? p['idempotencyKey'] : undefined
        const run = (): ClaimResult => {
          const claimed: string[] = []; const alreadyClaimed: string[] = []; const out: Wake[] = []
          for (const id of ids) {
            const w = wakes.find((x) => x.wakeId === id)
            if (w === undefined) throw Object.assign(new Error('wake not found'), { wbCode: 'WB_WAKE_NOT_FOUND' })
            if (w.actorId !== actor) throw Object.assign(new Error('wake not owned by actor'), { wbCode: 'WB_WAKE_NOT_FOUND' })
            if (w.status === 'acked') throw Object.assign(new Error('wake already acked'), { wbCode: 'WB_WAKE_NOT_CLAIMABLE' })
            if (w.status === 'claimed' && w.claimedBy === actor) alreadyClaimed.push(id)
            else if (w.status === 'claimed') throw Object.assign(new Error('wake claimed by other'), { wbCode: 'WB_WAKE_NOT_CLAIMABLE' })
            else { w.status = 'claimed'; w.claimedBy = actor; w.claimedUntil = Date.now() + 30_000; claimed.push(id) }
            out.push(w)
          }
          return { claimed, alreadyClaimed, wakes: out, replayed: false }
        }
        try {
          const { value, replayed } = idem(`claim:${actor}`, idempotencyKey, run)
          send(socket, { id: req.id, ok: true, result: { ...(value as ClaimResult), replayed } })
        } catch (e) { error(socket, req.id, (e as { wbCode?: string }).wbCode ?? 'WB_INTERNAL', (e as Error).message) }
        return
      }
      case 'wakes.ack': {
        const ids = Array.isArray(p['wakeIds']) ? (p['wakeIds'] as string[]) : []
        const idempotencyKey = typeof p['idempotencyKey'] === 'string' ? p['idempotencyKey'] : undefined
        const run = (): AckResult => {
          const acked: string[] = []; const alreadyAcked: string[] = []
          for (const id of ids) {
            const w = wakes.find((x) => x.wakeId === id)
            if (w === undefined || w.actorId !== actor) throw Object.assign(new Error('wake not found'), { wbCode: 'WB_WAKE_NOT_FOUND' })
            if (w.status === 'acked') { alreadyAcked.push(id); continue }
            if (w.status === 'claimed' && w.claimedBy !== actor) throw Object.assign(new Error('wake not claimed by actor'), { wbCode: 'WB_WAKE_NOT_CLAIMABLE' })
            w.status = 'acked'; w.ackedAt = Date.now(); w.claimedBy = null; w.claimedUntil = null; acked.push(id)
          }
          return { acked, alreadyAcked, replayed: false }
        }
        try {
          const { value, replayed } = idem(`ack:${actor}`, idempotencyKey, run)
          send(socket, { id: req.id, ok: true, result: { ...(value as AckResult), replayed } })
        } catch (e) { error(socket, req.id, (e as { wbCode?: string }).wbCode ?? 'WB_INTERNAL', (e as Error).message) }
        return
      }
      default:
        error(socket, req.id, 'WB_PROTOCOL', `unknown method ${req.method}`)
    }
  }
  const server: Server = createServer((socket) => {
    sockets.add(socket)
    socket.setEncoding('utf8'); let buffer = ''
    socket.on('data', (chunk: string) => {
      buffer += chunk; let idx = buffer.indexOf('\n')
      while (idx >= 0) {
        const line = buffer.slice(0, idx); buffer = buffer.slice(idx + 1); idx = buffer.indexOf('\n')
        if (line.trim() === '') continue
        let req: { id: string; method: string; params?: Record<string, unknown> }
        try { req = JSON.parse(line) as typeof req } catch { send(socket, { id: 'unknown', ok: false, error: { code: 'WB_PROTOCOL', message: 'invalid JSON' } }); continue }
        const delay = delays.get(req.method) ?? 0
        if (delay > 0) setTimeout(() => handle(socket, req), delay); else handle(socket, req)
      }
    })
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.socketPath, () => resolve()) })
  return {
    socketPath: options.socketPath,
    async close(): Promise<void> {
      for (const s of sockets) s.destroy(); sockets.clear()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
    dropConnections(): void { for (const s of sockets) s.destroy(); sockets.clear() },
    setDelay(method: string, ms: number): void { delays.set(method, ms) },
    state: () => ({ rooms: roomStore.size, messages: messages.length, wakes: wakes.length }),
  }
}
