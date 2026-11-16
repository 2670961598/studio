import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createSqliteCollab } from '../src/index.ts'
import { backends, createActor, expectCode } from './helpers.ts'

// ---------------------------------------------------------------------------
// Adapted from the v1 kernel's 15 tests: same behaviours, v0.8 API (host-bound
// principal, materialized membership, read digest, command-log idempotency,
// opaque cursors). Each scenario still runs against both adapters.
// ---------------------------------------------------------------------------

for (const backend of backends) {
  test(`[${backend.name}] broadcast room includes all current and future actors`, async () => {
    const harness = await backend.create()
    try {
      const { collab } = harness
      const boss = await createActor(collab, 'boss', 'human')
      const lobby = await collab.createBroadcastRoom(boss.id, { name: 'lobby' })
      const later = await createActor(collab, 'later')

      const members = await collab.listMembers(boss.id, lobby.id)
      assert.deepEqual(members.map(member => member.actorId).sort(), [boss.id, later.id].sort())
      assert.deepEqual((await collab.listRooms(later.id)).map(room => room.id), [lobby.id])
      assert.equal(members.find(member => member.actorId === boss.id)?.role, 'owner')
      assert.equal(members.find(member => member.actorId === boss.id)?.canBroadcast, true)
      assert.equal(members.find(member => member.actorId === later.id)?.canBroadcast, false)
    } finally {
      await harness.cleanup()
    }
  })

  test(`[${backend.name}] group rooms enforce membership`, async () => {
    const harness = await backend.create()
    try {
      const { collab } = harness
      const a = await createActor(collab, 'a')
      const b = await createActor(collab, 'b')
      const c = await createActor(collab, 'c')
      const room = await collab.createGroupRoom(a.id, { name: 'dev', memberIds: [b.id] })
      const message = await collab.sendMessage(a.id, { roomId: room.id, body: 'hello' })

      assert.deepEqual((await collab.listMessages(b.id, { roomId: room.id })).items.map(item => item.id), [
        message.messageId,
      ])
      await expectCode(() => collab.listMessages(c.id, { roomId: room.id }), 'ROOM_NOT_FOUND')
      await expectCode(() => collab.sendMessage(c.id, { roomId: room.id, body: 'nope' }), 'ROOM_NOT_FOUND')
      await expectCode(
        () => collab.createGroupRoom(a.id, { name: 'solo', memberIds: [] }),
        'VALIDATION_FAILED',
      )
    } finally {
      await harness.cleanup()
    }
  })

  test(`[${backend.name}] DM is a two-person room, idempotent and immutable`, async () => {
    const harness = await backend.create()
    try {
      const { collab } = harness
      const a = await createActor(collab, 'a')
      const b = await createActor(collab, 'b')
      const c = await createActor(collab, 'c')
      const dm = await collab.createDm(a.id, b.id)
      const again = await collab.createDm(b.id, a.id)

      assert.equal(dm.id, again.id)
      assert.equal(dm.kind, 'dm')
      assert.equal(dm.dmLow, 'a')
      assert.equal(dm.dmHigh, 'b')
      assert.deepEqual((await collab.listMembers(a.id, dm.id)).map(member => member.actorId).sort(), [a.id, b.id].sort())
      await expectCode(() => collab.addMember(a.id, dm.id, c.id), 'DM_FIXED_PAIR')
      await expectCode(() => collab.removeMember(a.id, dm.id, b.id), 'DM_FIXED_PAIR')
      await expectCode(() => collab.sendMessage(c.id, { roomId: dm.id, body: 'nope' }), 'ROOM_NOT_FOUND')
      await expectCode(() => collab.createDm(a.id, a.id), 'DM_REQUIRES_TWO_DISTINCT_ACTORS')
    } finally {
      await harness.cleanup()
    }
  })

  test(`[${backend.name}] messages are ordered, mentionable, and unread-aware`, async () => {
    const harness = await backend.create()
    try {
      const { collab } = harness
      const a = await createActor(collab, 'a')
      const b = await createActor(collab, 'b')
      const room = await collab.createGroupRoom(a.id, { name: 'room', memberIds: [b.id] })

      const first = await collab.sendMessage(a.id, { roomId: room.id, body: 'one', mentions: [b.id] })
      const second = await collab.sendMessage(b.id, { roomId: room.id, body: 'two' })

      assert.ok(second.seq > first.seq)
      assert.equal(second.roomSeq, first.roomSeq + 1)
      const listed = await collab.listMessages(b.id, { roomId: room.id })
      assert.deepEqual(listed.items.map(message => message.seq), [first.seq, second.seq])

      let digest = await collab.checkInbox(b.id)
      assert.deepEqual(digest.mentions.map(mention => mention.seq), [first.seq])
      assert.equal(digest.rooms[0]?.unread, 2)

      const read = await collab.markRead(b.id, { roomId: room.id, upToRoomSeq: first.roomSeq })
      assert.equal(read.unread, 1)
      digest = await collab.checkInbox(b.id)
      assert.deepEqual(digest.mentions, [])
      assert.equal(digest.totals.unread, 1)

      // Clamped, not "future-marked-read": a target past the head clamps to the head.
      const clamped = await collab.markRead(b.id, { roomId: room.id, upToRoomSeq: 999_999 })
      assert.equal(clamped.unread, 0)
      const stats = await collab.getRoomStats(b.id, room.id)
      const state = await collab.getReadState(b.id, room.id)
      assert.equal(state.lastReadRoomSeq, stats.headRoomSeq)
      assert.deepEqual((await collab.checkInbox(b.id)).rooms[0]?.unread, 0)
    } finally {
      await harness.cleanup()
    }
  })

  test(`[${backend.name}] validation: empty/oversized body, unknown reply, non-member mention`, async () => {
    const harness = await backend.create()
    try {
      const { collab } = harness
      const a = await createActor(collab, 'a')
      const b = await createActor(collab, 'b')
      const c = await createActor(collab, 'c')
      const room = await collab.createGroupRoom(a.id, { name: 'room', memberIds: [b.id] })
      await collab.sendMessage(a.id, { roomId: room.id, body: 'root' })

      await expectCode(() => collab.sendMessage(a.id, { roomId: room.id, body: '   ' }), 'BODY_EMPTY')
      await expectCode(
        () => collab.sendMessage(a.id, { roomId: room.id, body: 'x'.repeat(20_000) }),
        'BODY_TOO_LARGE',
      )
      await expectCode(
        () => collab.sendMessage(a.id, { roomId: room.id, body: 'x', mentions: [c.id] }),
        'MENTION_NOT_MEMBER',
      )
      await expectCode(
        () => collab.sendMessage(a.id, { roomId: room.id, body: 'x', replyToSeq: 999_999 }),
        'UNKNOWN_REPLY',
      )
      await expectCode(() => collab.markRead(c.id, { roomId: room.id, upToRoomSeq: 1 }), 'ROOM_NOT_FOUND')

      await collab.addMember(a.id, room.id, c.id)
      assert.ok((await collab.listMembers(a.id, room.id)).some(member => member.actorId === c.id))
      const broadcast = await collab.createBroadcastRoom(a.id, { name: 'broadcast' })
      await expectCode(() => collab.addMember(a.id, broadcast.id, c.id), 'VALIDATION_FAILED')
    } finally {
      await harness.cleanup()
    }
  })

  test(`[${backend.name}] command-log idempotency returns the original sequence`, async () => {
    const harness = await backend.create()
    try {
      const { collab } = harness
      const a = await createActor(collab, 'a')
      const b = await createActor(collab, 'b')
      const room = await collab.createGroupRoom(a.id, { name: 'room', memberIds: [b.id] })

      const first = await collab.sendMessage(a.id, { roomId: room.id, body: 'same', idempotencyKey: 'key-1' })
      const again = await collab.sendMessage(a.id, { roomId: room.id, body: 'same', idempotencyKey: 'key-1' })
      assert.equal(first.seq, again.seq)
      assert.equal(first.roomSeq, again.roomSeq)
      assert.equal(again.replayed, true)
      assert.equal((await collab.listMessages(b.id, { roomId: room.id })).items.length, 1)

      await expectCode(
        () => collab.sendMessage(a.id, { roomId: room.id, body: 'different', idempotencyKey: 'key-1' }),
        'IDEMPOTENCY_CONFLICT',
      )
    } finally {
      await harness.cleanup()
    }
  })

  test(`[${backend.name}] pagination with opaque cursor and reply threading`, async () => {
    const harness = await backend.create()
    try {
      const { collab } = harness
      const a = await createActor(collab, 'a')
      const b = await createActor(collab, 'b')
      const room = await collab.createGroupRoom(a.id, { name: 'room', memberIds: [b.id] })

      const m1 = await collab.sendMessage(a.id, { roomId: room.id, body: '1' })
      const m2 = await collab.sendMessage(a.id, { roomId: room.id, body: '2', replyToSeq: m1.seq })
      const m3 = await collab.sendMessage(a.id, { roomId: room.id, body: '3' })

      const page1 = await collab.listMessages(b.id, { roomId: room.id, limit: 1 })
      assert.deepEqual(page1.items.map(message => message.seq), [m1.seq])
      assert.equal(page1.hasMore, true)
      assert.notEqual(page1.nextCursor, null)
      const page2 = await collab.listMessages(b.id, { roomId: room.id, limit: 1, cursor: page1.nextCursor ?? '' })
      assert.deepEqual(page2.items.map(message => message.seq), [m2.seq])
      assert.equal(page2.items[0]?.replyToSeq, m1.seq)
      const page3 = await collab.listMessages(b.id, { roomId: room.id, cursor: page2.nextCursor ?? '' })
      assert.deepEqual(page3.items.map(message => message.seq), [m3.seq])
      assert.equal(page3.hasMore, false)
      assert.equal(page3.nextCursor, null)
    } finally {
      await harness.cleanup()
    }
  })
}

test('[sqlite] persists across reopen and migration is idempotent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'collab-persist-'))
  const path = join(dir, 'collab.sqlite')
  try {
    const first = createSqliteCollab(path)
    const a = await first.createActor({ kind: 'agent', name: 'a', id: 'a' })
    const b = await first.createActor({ kind: 'agent', name: 'b', id: 'b' })
    const room = await first.createGroupRoom(a.id, { name: 'room', memberIds: [b.id] })
    const message = await first.sendMessage(a.id, { roomId: room.id, body: 'persist me' })
    await first.close()

    const second = createSqliteCollab(path)
    const listed = await second.listMessages(b.id, { roomId: room.id })
    assert.deepEqual(listed.items.map(item => item.id), [message.messageId])
    assert.equal((await second.checkInbox(b.id)).totals.unread, 1)
    await second.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
