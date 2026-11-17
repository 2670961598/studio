/** WorkbenchTransport v1 契约测试（P1-1a）：socket/重连/claim-ack/幂等/错误码/超时。 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkbenchTransport, WorkbenchTransportError } from '../../src/index.ts'
import { startMockSidecar, type MockSidecar } from '../support/mock-sidecar.ts'

const dirs: string[] = []
const sidecars: MockSidecar[] = []
const clients: WorkbenchTransport[] = []

function setup(opts: { requestTimeoutMs?: number } = {}): { sidecar: MockSidecar; client: WorkbenchTransport; socketPath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'wb-transport-')); dirs.push(dir)
  const socketPath = path.join(dir, 'wb.sock')
  const sidecar = { socketPath } as MockSidecar
  sidecars.push(sidecar)
  const client = new WorkbenchTransport({ socketPath, requestTimeoutMs: opts.requestTimeoutMs ?? 500, connectTimeoutMs: 500 })
  clients.push(client)
  return { sidecar, client, socketPath }
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.close()
  for (const s of sidecars.splice(0)) { try { await s.close() } catch { /* ignore */ } }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function started(opts: { requestTimeoutMs?: number } = {}): Promise<{ sidecar: MockSidecar; client: WorkbenchTransport; socketPath: string }> {
  const ctx = setup(opts)
  const sidecar = await startMockSidecar({ socketPath: ctx.socketPath })
  sidecars[sidecars.length - 1] = sidecar
  return { ...ctx, sidecar }
}

describe('WorkbenchTransport v1', () => {
  it('health/rooms/messages/read/inbox 正常 + DTO 字段', async () => {
    const { sidecar, client } = await started()
    const h = await client.health()
    expect(h).toMatchObject({ ok: true, protocol: 'workbench-transport/v1' })
    const room = await client.createRoom({ kind: 'group', name: 'phase1', memberIds: ['pm', 'dev'] })
    expect(room).toMatchObject({ kind: 'group', name: 'phase1', memberIds: ['pm', 'dev'] })
    const sent = await client.sendMessage({ roomId: room.roomId, senderId: 'pm', body: 'hello', mentions: ['dev'], idempotencyKey: 'send-1' })
    expect(sent.roomSeq).toBe(1); expect(sent.replayed).toBe(false)
    const replay = await client.sendMessage({ roomId: room.roomId, senderId: 'pm', body: 'hello', mentions: ['dev'], idempotencyKey: 'send-1' })
    expect(replay.replayed).toBe(true); expect(replay.messageId).toBe(sent.messageId)
    const page = await client.listMessages({ roomId: room.roomId, actorId: 'dev' })
    expect(page.items).toHaveLength(1); expect(page.items[0]?.mentions).toEqual(['dev'])
    const read = await client.read({ roomId: room.roomId, actorId: 'dev', upToRoomSeq: 1, idempotencyKey: 'read-1' })
    expect(read).toMatchObject({ roomId: room.roomId, actorId: 'dev', lastReadRoomSeq: 1, unread: 0 })
    const inbox = await client.inbox({ actorId: 'dev' })
    expect(inbox.pendingWakeIds.length).toBe(1)
    expect(sidecar.state()).toEqual({ rooms: 1, messages: 1, wakes: 1 })
  })

  it('claim→ack、重复 claim/ack 幂等（alreadyClaimed/alreadyAcked）', async () => {
    const { client } = await started()
    const room = await client.createRoom({ kind: 'group', name: 'g', memberIds: ['pm', 'dev'] })
    await client.sendMessage({ roomId: room.roomId, senderId: 'pm', body: '@dev ping', mentions: ['dev'] })
    const inbox = await client.inbox({ actorId: 'dev' })
    const wakeId = inbox.pendingWakeIds[0]!
    const c1 = await client.claimWakes({ actorId: 'dev', wakeIds: [wakeId], idempotencyKey: 'claim-1' })
    expect(c1.claimed).toEqual([wakeId]); expect(c1.alreadyClaimed).toEqual([])
    const c2 = await client.claimWakes({ actorId: 'dev', wakeIds: [wakeId], idempotencyKey: 'claim-2' })
    expect(c2.claimed).toEqual([]); expect(c2.alreadyClaimed).toEqual([wakeId])
    const a1 = await client.ackWakes({ actorId: 'dev', wakeIds: [wakeId], idempotencyKey: 'ack-1' })
    expect(a1.acked).toEqual([wakeId]); expect(a1.alreadyAcked).toEqual([])
    const a2 = await client.ackWakes({ actorId: 'dev', wakeIds: [wakeId], idempotencyKey: 'ack-2' })
    expect(a2.acked).toEqual([]); expect(a2.alreadyAcked).toEqual([wakeId])
    const inboxAfter = await client.inbox({ actorId: 'dev' })
    expect(inboxAfter.pendingWakeIds).toEqual([])
  })

  it('socket 断开→在途稳定错误、下一次请求自动重连', async () => {
    const { sidecar, client } = await started()
    await client.health()
    sidecar.dropConnections()
    await new Promise((r) => setTimeout(r, 20))
    const h2 = await client.health()
    expect(h2.ok).toBe(true) // ensure connected 重连成功
  })

  it('在途请求遇 socket 断开→WB_UNAVAILABLE（稳定错误），随后可重连', async () => {
    const { sidecar, client } = await started({ requestTimeoutMs: 500 })
    sidecar.setDelay('health', 200)
    const pending = client.health()
    await new Promise((r) => setTimeout(r, 20))
    sidecar.dropConnections()
    await expect(pending).rejects.toMatchObject({ code: 'WB_UNAVAILABLE', retryable: true })
    await expect(client.health()).resolves.toMatchObject({ ok: true })
  })

  it('请求超时→WB_TIMEOUT；延迟解除后同一 socket 可继续', async () => {
    const { sidecar, client } = await started({ requestTimeoutMs: 50 })
    sidecar.setDelay('health', 150)
    await expect(client.health()).rejects.toMatchObject({ code: 'WB_TIMEOUT' })
    sidecar.setDelay('health', 0)
    await expect(client.health()).resolves.toMatchObject({ ok: true })
  })

  it('稳定错误码：room 不存在/wake 不存在/非法参数', async () => {
    const { client } = await started()
    await expect(client.listMessages({ roomId: 'nope', actorId: 'dev' })).rejects.toBeInstanceOf(WorkbenchTransportError)
    await expect(client.listMessages({ roomId: 'nope', actorId: 'dev' })).rejects.toMatchObject({ code: 'WB_ROOM_NOT_FOUND' })
    await expect(client.claimWakes({ actorId: 'dev', wakeIds: ['wake-nope'] })).rejects.toMatchObject({ code: 'WB_WAKE_NOT_FOUND' })
    const room = await client.createRoom({ kind: 'group', name: 'g', memberIds: ['pm'] })
    await expect(client.sendMessage({ roomId: room.roomId, senderId: 'pm', body: '   ' })).rejects.toMatchObject({ code: 'WB_INVALID_ARGUMENT' })
  })

  it('连接失败→WB_UNAVAILABLE（稳定传输码，不抛裸 Error）', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wb-transport-dead-')); dirs.push(dir)
    const client = new WorkbenchTransport({ socketPath: path.join(dir, 'missing.sock'), requestTimeoutMs: 100, connectTimeoutMs: 100 })
    clients.push(client)
    await expect(client.health()).rejects.toMatchObject({ code: 'WB_UNAVAILABLE' })
  })
})
