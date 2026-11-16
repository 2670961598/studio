import assert from 'node:assert/strict'
import test from 'node:test'
import { backends, createActor, expectCode, setupFixture } from './helpers.ts'

for (const backend of backends) {
  test(`[${backend.name}] send replay writes nothing; a different request conflicts`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab, store } = fixture.harness
      const request = {
        roomId: fixture.room.id,
        body: 'idempotent payload',
        mentions: [fixture.bob.id],
        idempotencyKey: 'send-key-1',
      }
      const first = await collab.sendMessage(fixture.alice.id, request)
      const messagesAfterFirst = await store.countMessages(null)
      const wakesAfterFirst = await store.countAllWakeItems(null)
      const statsAfterFirst = await collab.getRoomStats(fixture.alice.id, fixture.room.id)

      const replay = await collab.sendMessage(fixture.alice.id, request)
      assert.equal(replay.replayed, true)
      assert.equal(replay.seq, first.seq)
      assert.equal(replay.roomSeq, first.roomSeq)
      assert.equal(replay.messageId, first.messageId)
      assert.equal(await store.countMessages(null), messagesAfterFirst)
      assert.equal(await store.countAllWakeItems(null), wakesAfterFirst)
      const statsAfterReplay = await collab.getRoomStats(fixture.alice.id, fixture.room.id)
      assert.deepEqual(statsAfterReplay, statsAfterFirst)

      await expectCode(
        () => collab.sendMessage(fixture.alice.id, { ...request, body: 'changed payload' }),
        'IDEMPOTENCY_CONFLICT',
      )
      await expectCode(
        () => collab.sendMessage(fixture.alice.id, { ...request, roomId: fixture.dm.id }),
        'IDEMPOTENCY_CONFLICT',
      )
      assert.equal(await store.countMessages(null), messagesAfterFirst)
    } finally {
      await fixture.harness.cleanup()
    }
  })

  test(`[${backend.name}] idempotency request hash normalizes mention order`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab } = fixture.harness
      const first = await collab.sendMessage(fixture.alice.id, {
        roomId: fixture.room.id,
        body: 'ordered mentions',
        mentions: [fixture.bob.id, fixture.boss.id],
        idempotencyKey: 'mention-order',
      })
      const replay = await collab.sendMessage(fixture.alice.id, {
        roomId: fixture.room.id,
        body: 'ordered mentions',
        mentions: [fixture.boss.id, fixture.bob.id],
        idempotencyKey: 'mention-order',
      })
      assert.equal(replay.replayed, true)
      assert.equal(replay.seq, first.seq)
    } finally {
      await fixture.harness.cleanup()
    }
  })

  test(`[${backend.name}] idempotency keys are scoped per principal`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab } = fixture.harness
      const aliceSend = await collab.sendMessage(fixture.alice.id, {
        roomId: fixture.room.id,
        body: 'from alice',
        idempotencyKey: 'shared-key',
      })
      const bobSend = await collab.sendMessage(fixture.bob.id, {
        roomId: fixture.room.id,
        body: 'from bob',
        idempotencyKey: 'shared-key',
      })
      assert.notEqual(bobSend.seq, aliceSend.seq)
      assert.equal(bobSend.replayed, false)
      assert.equal((await collab.listMessages(fixture.bob.id, { roomId: fixture.room.id })).items.length, 2)
    } finally {
      await fixture.harness.cleanup()
    }
  })

  test(`[${backend.name}] markRead idempotency and ack idempotency replay stored responses`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab } = fixture.harness
      const message = await collab.sendMessage(fixture.alice.id, {
        roomId: fixture.room.id,
        body: 'handle',
        mentions: [fixture.bob.id],
      })
      const readRequest = { roomId: fixture.room.id, upToRoomSeq: message.roomSeq, idempotencyKey: 'read-key' }
      const first = await collab.markRead(fixture.bob.id, readRequest)
      const replay = await collab.markRead(fixture.bob.id, readRequest)
      assert.deepEqual(replay, first)
      await expectCode(
        () => collab.markRead(fixture.bob.id, { ...readRequest, upToRoomSeq: 0 }),
        'IDEMPOTENCY_CONFLICT',
      )

      const wakeId = (await collab.checkInbox(fixture.bob.id)).pendingWakeIds[0]
      assert.ok(wakeId !== undefined)
      const ackRequest = { wakeIds: [wakeId], idempotencyKey: 'ack-key' }
      const ackFirst = await collab.ackDelivery(fixture.bob.id, ackRequest)
      assert.deepEqual(ackFirst.acked, [wakeId])
      const ackReplay = await collab.ackDelivery(fixture.bob.id, ackRequest)
      assert.deepEqual(ackReplay, ackFirst)
      await expectCode(
        () => collab.ackDelivery(fixture.bob.id, { wakeIds: [], idempotencyKey: 'ack-key' }),
        'IDEMPOTENCY_CONFLICT',
      )
    } finally {
      await fixture.harness.cleanup()
    }
  })

  test(`[${backend.name}] command log is written in the send transaction (failure rolls it back)`, async () => {
    // Force a failure AFTER the message row is written: two directed targets with a
    // duplicated generated wake id. The whole send transaction (message, mentions,
    // room_stats bump, wake rows, command-log row) must roll back atomically.
    const ids = ['room-1', 'msg-1', 'wake-dupe', 'wake-dupe']
    let index = 0
    const harness = await backend.create({
      newId: () => {
        const next = ids[index]
        index += 1
        return next ?? `extra-${index}`
      },
    })
    try {
      const { collab, store } = harness
      const a = await createActor(collab, 'a')
      const b = await createActor(collab, 'b')
      const c = await createActor(collab, 'c')
      const room = await collab.createGroupRoom(a.id, { name: 'room', memberIds: [b.id, c.id] })
      const request = {
        roomId: room.id,
        body: 'will fail',
        mentions: [b.id, c.id],
        idempotencyKey: 'rollback-key',
      }
      await expectCode(() => collab.sendMessage(a.id, request), 'VALIDATION_FAILED')
      assert.equal(await store.countMessages(null), 0)
      assert.equal(await store.countAllWakeItems(null), 0)
      const stats = await collab.getRoomStats(a.id, room.id)
      assert.equal(stats.headRoomSeq, 0)
      assert.equal(stats.headSeq, 0)

      // No half-committed command-log row: the same key is NOT replayed, it executes.
      const retry = await collab.sendMessage(a.id, request)
      assert.equal(retry.replayed, false)
      assert.equal(retry.roomSeq, 1)
      assert.equal(await store.countMessages(null), 1)
      assert.equal(await store.countAllWakeItems(null), 2)
    } finally {
      await harness.cleanup()
    }
  })

  test(`[${backend.name}] batchSend replays per-item keys without duplicate writes`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab, store } = fixture.harness
      const items = [
        { roomId: fixture.room.id, body: 'batch a', idempotencyKey: 'batch-a' },
        { roomId: fixture.room.id, body: 'batch b', idempotencyKey: 'batch-b' },
      ]
      const first = await collab.batchSend(fixture.bob.id, items)
      assert.equal(first.items.every(item => item.status === 'ok'), true)
      const seqs = first.items.map(item => (item.status === 'ok' ? item.result.seq : -1))
      const replay = await collab.batchSend(fixture.bob.id, items)
      assert.equal(replay.items.every(item => item.status === 'ok'), true)
      assert.deepEqual(
        replay.items.map(item => (item.status === 'ok' ? item.result.seq : -1)),
        seqs,
      )
      assert.equal(await store.countMessages(null), 2)
    } finally {
      await fixture.harness.cleanup()
    }
  })
}
