/**
 * P1-1b 模块 A 测试：mock 端点基本路径 + DTO 最少字段（按 transport v1 冻结 types）+ 稳定错误码。
 * 依据：docs/sentinel-logs/Phase1实现拆解-2026-11-17.md §五（health；rooms/messages/read 的内存/mock 端点）；
 *       packages/workbench-transport/src/types.ts（DTO/错误码唯一冻结源——本测试按其字段名断言）。
 * 运行：node --experimental-strip-types --test apps/workbench-chatd/test/endpoints.nt.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startChatd, type ChatdHandle } from './support/proc.ts'
import { connectNdjson, type RawClient, type WbFrame } from './support/ndjson.ts'

interface Ctx {
  readonly h: ChatdHandle
  readonly c: RawClient
}

async function withChatd(run: (ctx: Ctx) => Promise<void>): Promise<void> {
  const h = await startChatd()
  try {
    await h.waitReady()
    const c = await connectNdjson(h.socketPath)
    try {
      await run({ h, c })
    } finally {
      c.close()
    }
  } finally {
    await h.cleanup()
  }
}

async function expectOk<T>(frame: WbFrame): Promise<T> {
  assert.equal(frame.ok, true, `期望 ok 响应：${JSON.stringify(frame)}`)
  return (frame as { ok: true; result: T }).result
}

async function expectErr(frame: WbFrame): Promise<{ code: string; message: string; retryable?: boolean }> {
  assert.equal(frame.ok, false, `期望失败响应：${JSON.stringify(frame)}`)
  return (frame as { ok: false; error: { code: string; message: string; retryable?: boolean } }).error
}

const keysOf = (obj: object): readonly string[] => Object.keys(obj).sort()

test('health：DTO 字段冻结（ok/protocol/server/startedAt），server 反映 mock 模式', async () => {
  await withChatd(async ({ c }) => {
    const h = await expectOk<{ ok: boolean; protocol: string; server: string; startedAt: number }>(await c.call('health'))
    assert.deepEqual(keysOf(h), ['ok', 'protocol', 'server', 'startedAt'], '字段只许冻结四项')
    assert.equal(h.ok, true)
    assert.equal(h.protocol, 'workbench-transport/v1')
    assert.match(h.server, /^workbench-chatd\/0\.1\.0\+mock$/, 'server 应带 +mock 模式标记')
    assert.equal(typeof h.startedAt, 'number')
    assert.ok(h.startedAt > 0 && h.startedAt <= Date.now())
  })
})

test('rooms：create 校验 + DTO 字段；list 返回摘要', async () => {
  await withChatd(async ({ c }) => {
    const bad = await expectErr(await c.call('rooms.create', { kind: 'nope', name: 'x', memberIds: ['a'] }))
    assert.equal(bad.code, 'WB_INVALID_ARGUMENT')
    const room = await expectOk<{ roomId: string; kind: string; name: string; memberIds: string[]; headRoomSeq: number }>(
      await c.call('rooms.create', { kind: 'group', name: 'phase1', memberIds: ['pm', 'dev', 'dev'] }),
    )
    assert.deepEqual(keysOf(room), ['headRoomSeq', 'kind', 'memberIds', 'name', 'roomId'], 'Room 冻结字段')
    assert.equal(room.kind, 'group')
    assert.equal(room.name, 'phase1')
    assert.deepEqual(room.memberIds, ['pm', 'dev'], 'memberIds 去重')
    assert.equal(room.headRoomSeq, 0)
    const list = await expectOk<{ roomId: string }[]>(await c.call('rooms.list'))
    assert.equal(list.length, 1)
    assert.equal(list[0]?.roomId, room.roomId)
  })
})

test('messages.send：成员/正文/mention 校验 + SendResult 字段 + 幂等 replay', async () => {
  await withChatd(async ({ c }) => {
    const room = await expectOk<{ roomId: string }>(await c.call('rooms.create', { kind: 'group', name: 'g', memberIds: ['pm', 'dev'] }))
    const notFound = await expectErr(await c.call('messages.send', { roomId: 'nope', senderId: 'pm', body: 'hi' }))
    assert.equal(notFound.code, 'WB_ROOM_NOT_FOUND')
    const notMember = await expectErr(await c.call('messages.send', { roomId: room.roomId, senderId: 'ghost', body: 'hi' }))
    assert.equal(notMember.code, 'WB_INVALID_ARGUMENT')
    const blank = await expectErr(await c.call('messages.send', { roomId: room.roomId, senderId: 'pm', body: '   ' }))
    assert.equal(blank.code, 'WB_INVALID_ARGUMENT')
    const badMention = await expectErr(await c.call('messages.send', { roomId: room.roomId, senderId: 'pm', body: 'x', mentions: ['ghost'] }))
    assert.equal(badMention.code, 'WB_INVALID_ARGUMENT')

    const sent = await expectOk<{ seq: number; roomSeq: number; messageId: string; replayed: boolean }>(
      await c.call('messages.send', { roomId: room.roomId, senderId: 'pm', body: '@dev hello', mentions: ['dev'], idempotencyKey: 'send-1' }),
    )
    assert.deepEqual(keysOf(sent), ['messageId', 'replayed', 'roomSeq', 'seq'], 'SendResult 冻结字段')
    assert.equal(sent.roomSeq, 1)
    assert.equal(sent.replayed, false)
    const replay = await expectOk<{ messageId: string; replayed: boolean; roomSeq: number }>(
      await c.call('messages.send', { roomId: room.roomId, senderId: 'pm', body: '@dev hello', mentions: ['dev'], idempotencyKey: 'send-1' }),
    )
    assert.equal(replay.replayed, true, '同幂等键应 replay')
    assert.equal(replay.messageId, sent.messageId)
    assert.equal(replay.roomSeq, 1, 'replay 不新增消息')

    const page = await expectOk<{ items: object[]; nextCursor: string | null; hasMore: boolean }>(
      await c.call('messages.list', { roomId: room.roomId, actorId: 'dev' }),
    )
    assert.deepEqual(keysOf(page), ['hasMore', 'items', 'nextCursor'], 'MessagePage 冻结字段')
    assert.equal(page.items.length, 1)
    assert.equal(page.nextCursor, null)
    assert.equal(page.hasMore, false)
    const item = page.items[0] as unknown as Record<string, unknown>
    assert.deepEqual(keysOf(item), ['body', 'createdAt', 'mentions', 'roomId', 'roomSeq', 'senderId', 'seq'], 'Message 冻结字段（无 messageId 扩展）')
    assert.deepEqual(item['mentions'], ['dev'])
  })
})

test('read：upToRoomSeq 校验/clamp/单调 + 幂等 replay', async () => {
  await withChatd(async ({ c }) => {
    const room = await expectOk<{ roomId: string }>(await c.call('rooms.create', { kind: 'group', name: 'g', memberIds: ['pm', 'dev'] }))
    await c.call('messages.send', { roomId: room.roomId, senderId: 'pm', body: 'm1' })
    await c.call('messages.send', { roomId: room.roomId, senderId: 'pm', body: 'm2' })
    const notFound = await expectErr(await c.call('read', { roomId: 'nope', actorId: 'dev', upToRoomSeq: 1 }))
    assert.equal(notFound.code, 'WB_ROOM_NOT_FOUND')
    const badSeq = await expectErr(await c.call('read', { roomId: room.roomId, actorId: 'dev', upToRoomSeq: 0 }))
    assert.equal(badSeq.code, 'WB_INVALID_ARGUMENT')
    const noActor = await expectErr(await c.call('read', { roomId: room.roomId, upToRoomSeq: 1 }))
    assert.equal(noActor.code, 'WB_INVALID_ARGUMENT')

    const r1 = await expectOk<{ roomId: string; actorId: string; lastReadRoomSeq: number; unread: number; replayed: boolean }>(
      await c.call('read', { roomId: room.roomId, actorId: 'dev', upToRoomSeq: 1, idempotencyKey: 'read-1' }),
    )
    assert.deepEqual(keysOf(r1), ['actorId', 'lastReadRoomSeq', 'replayed', 'roomId', 'unread'], 'ReadResult 冻结字段')
    assert.equal(r1.lastReadRoomSeq, 1)
    assert.equal(r1.unread, 1)
    assert.equal(r1.replayed, false)
    const replay = await expectOk<{ lastReadRoomSeq: number; replayed: boolean }>(
      await c.call('read', { roomId: room.roomId, actorId: 'dev', upToRoomSeq: 1, idempotencyKey: 'read-1' }),
    )
    assert.equal(replay.replayed, true)
    const clamp = await expectOk<{ lastReadRoomSeq: number; unread: number }>(
      await c.call('read', { roomId: room.roomId, actorId: 'dev', upToRoomSeq: 99 }),
    )
    assert.equal(clamp.lastReadRoomSeq, 2, 'upToRoomSeq 超过 head 应 clamp')
    assert.equal(clamp.unread, 0)
    const monotonic = await expectOk<{ lastReadRoomSeq: number }>(
      await c.call('read', { roomId: room.roomId, actorId: 'dev', upToRoomSeq: 1 }),
    )
    assert.equal(monotonic.lastReadRoomSeq, 2, 'read 游标单调不回退')
  })
})

test('inbox：DTO 字段 + 未读/mention/pendingWake 语义', async () => {
  await withChatd(async ({ c }) => {
    const room = await expectOk<{ roomId: string }>(await c.call('rooms.create', { kind: 'group', name: 'g', memberIds: ['pm', 'dev'] }))
    await c.call('messages.send', { roomId: room.roomId, senderId: 'pm', body: '@dev hello', mentions: ['dev'] })
    const noActor = await expectErr(await c.call('inbox', {}))
    assert.equal(noActor.code, 'WB_INVALID_ARGUMENT')
    const inbox = await expectOk<{ actorId: string; unread: number; mentions: number; pendingWakeIds: string[]; rooms: { roomId: string; unread: number; pendingWakes: number }[] }>(
      await c.call('inbox', { actorId: 'dev' }),
    )
    assert.deepEqual(keysOf(inbox), ['actorId', 'mentions', 'pendingWakeIds', 'rooms', 'unread'], 'InboxResult 冻结字段')
    assert.equal(inbox.actorId, 'dev')
    assert.equal(inbox.unread, 1)
    assert.equal(inbox.mentions, 1)
    assert.equal(inbox.pendingWakeIds.length, 1, 'mention 产生 pending wake')
    const roomSummary = inbox.rooms[0] as unknown as Record<string, unknown>
    assert.deepEqual(Object.keys(roomSummary).sort(), ['pendingWakes', 'roomId', 'unread'], 'rooms[] 冻结字段')
    assert.equal(roomSummary['pendingWakes'], 1)
  })
})

test('wakes claim/ack：错误码 + claimed/alreadyClaimed/acked/alreadyAcked 幂等', async () => {
  await withChatd(async ({ c }) => {
    const room = await expectOk<{ roomId: string }>(await c.call('rooms.create', { kind: 'group', name: 'g', memberIds: ['pm', 'dev'] }))
    await c.call('messages.send', { roomId: room.roomId, senderId: 'pm', body: '@dev ping', mentions: ['dev'] })
    const inbox = await expectOk<{ pendingWakeIds: string[] }>(await c.call('inbox', { actorId: 'dev' }))
    const wakeId = inbox.pendingWakeIds[0]
    assert.ok(wakeId !== undefined, '应有一个 pending wake')

    const missing = await expectErr(await c.call('wakes.claim', { actorId: 'dev', wakeIds: ['wake-nope'] }))
    assert.equal(missing.code, 'WB_WAKE_NOT_FOUND')
    const notOwner = await expectErr(await c.call('wakes.claim', { actorId: 'pm', wakeIds: [wakeId] }))
    assert.equal(notOwner.code, 'WB_WAKE_NOT_FOUND', '非本人 wake 按不存在处理')

    const claim1 = await expectOk<{ claimed: string[]; alreadyClaimed: string[] }>(
      await c.call('wakes.claim', { actorId: 'dev', wakeIds: [wakeId], idempotencyKey: 'claim-1' }),
    )
    assert.deepEqual(claim1.claimed, [wakeId])
    assert.deepEqual(claim1.alreadyClaimed, [])
    const claim2 = await expectOk<{ claimed: string[]; alreadyClaimed: string[] }>(
      await c.call('wakes.claim', { actorId: 'dev', wakeIds: [wakeId], idempotencyKey: 'claim-2' }),
    )
    assert.deepEqual(claim2.claimed, [])
    assert.deepEqual(claim2.alreadyClaimed, [wakeId], '重复 claim → alreadyClaimed')

    const ack1 = await expectOk<{ acked: string[]; alreadyAcked: string[] }>(
      await c.call('wakes.ack', { actorId: 'dev', wakeIds: [wakeId], idempotencyKey: 'ack-1' }),
    )
    assert.deepEqual(ack1.acked, [wakeId])
    const ack2 = await expectOk<{ acked: string[]; alreadyAcked: string[] }>(
      await c.call('wakes.ack', { actorId: 'dev', wakeIds: [wakeId], idempotencyKey: 'ack-2' }),
    )
    assert.deepEqual(ack2.acked, [])
    assert.deepEqual(ack2.alreadyAcked, [wakeId], '重复 ack → alreadyAcked')
    const claimAcked = await expectErr(await c.call('wakes.claim', { actorId: 'dev', wakeIds: [wakeId] }))
    assert.equal(claimAcked.code, 'WB_WAKE_NOT_CLAIMABLE', '已 ack 的 wake 不可再 claim')
    const after = await expectOk<{ pendingWakeIds: string[] }>(await c.call('inbox', { actorId: 'dev' }))
    assert.deepEqual(after.pendingWakeIds, [], 'ack 后 inbox 清空 pending')
  })
})

test('协议错误：非法 JSON/非对象帧/缺 id/缺 method/params 非对象/未知方法 → WB_PROTOCOL', async () => {
  await withChatd(async ({ c }) => {
    const unknownMethod = await expectErr(await c.call('health.check', {}))
    assert.equal(unknownMethod.code, 'WB_PROTOCOL')

    c.sendLine('not-json{')
    const badJson = await c.next()
    assert.equal(badJson.ok, false)
    if (badJson.ok === false) {
      assert.equal(badJson.error.code, 'WB_PROTOCOL')
      assert.equal(badJson.id, 'unknown', '无法定位 id 时用 unknown')
    }

    c.sendLine(JSON.stringify(['array-frame']))
    const arrayFrame = await c.next()
    assert.equal(arrayFrame.ok, false)
    if (arrayFrame.ok === false) assert.equal(arrayFrame.error.code, 'WB_PROTOCOL')

    c.sendLine(JSON.stringify({ id: 'no-method' }))
    const noMethod = await c.next()
    assert.equal(noMethod.ok, false)
    if (noMethod.ok === false) {
      assert.equal(noMethod.error.code, 'WB_PROTOCOL')
      assert.equal(noMethod.id, 'no-method')
    }

    c.sendLine(JSON.stringify({ id: 'p-array', method: 'health', params: [1, 2] }))
    const badParams = await c.next()
    assert.equal(badParams.ok, false)
    if (badParams.ok === false) assert.equal(badParams.error.code, 'WB_PROTOCOL')
  })
})
