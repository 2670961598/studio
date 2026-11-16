import assert from 'node:assert/strict'
import test from 'node:test'
import type { InboxDigest } from '../src/index.ts'
import { backends, createActor, expectCode, makeClock, setupFixture, type Fixture, type Harness } from './helpers.ts'

function roomDigest(digest: InboxDigest, roomId: string) {
  const room = digest.rooms.find(entry => entry.roomId === roomId)
  assert.ok(room !== undefined, `room ${roomId} missing from digest`)
  return room
}

async function wakeCountFor(harness: Harness, actorId: string): Promise<number> {
  return harness.store.countWakeItemsForActor(null, actorId)
}

async function onePendingWake(fixture: Fixture, actorId: string): Promise<string> {
  const digest = await fixture.harness.collab.checkInbox(actorId)
  assert.equal(digest.pendingWakeIds.length, 1, 'expected exactly one pending wake')
  const wakeId = digest.pendingWakeIds[0]
  assert.ok(wakeId !== undefined)
  return wakeId
}

for (const backend of backends) {
  test(`[${backend.name}] plain group messages create zero wakes and feed the read cursor`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab } = fixture.harness
      await collab.sendMessage(fixture.boss.id, { roomId: fixture.room.id, body: 'ambient one' })
      await collab.sendMessage(fixture.alice.id, { roomId: fixture.room.id, body: 'ambient two' })

      for (const actor of [fixture.boss, fixture.alice, fixture.bob]) {
        const digest = await collab.checkInbox(actor.id)
        assert.equal(digest.totals.pendingWakes, 0)
        assert.deepEqual(digest.pendingWakeIds, [])
        assert.equal(roomDigest(digest, fixture.room.id).unread, 2)
        assert.equal(await wakeCountFor(fixture.harness, actor.id), 0)
      }
    } finally {
      await fixture.harness.cleanup()
    }
  })

  test(`[${backend.name}] plain broadcast messages create zero per-actor rows`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab, store } = fixture.harness
      for (let index = 0; index < 10; index += 1) {
        await collab.sendMessage(fixture.boss.id, { roomId: fixture.lobby.id, body: `broadcast ${index}` })
      }
      assert.equal(await store.countAllWakeItems(null), 0)
      const stats = await collab.getRoomStats(fixture.bob.id, fixture.lobby.id)
      assert.equal(stats.headRoomSeq, 10)
      assert.equal(await store.countReadStatesForRoom(null, fixture.lobby.id), 4)
      for (const actor of [fixture.boss, fixture.alice, fixture.bob, fixture.carol]) {
        const digest = await collab.checkInbox(actor.id, { roomIds: [fixture.lobby.id] })
        assert.equal(digest.totals.pendingWakes, 0)
        assert.equal(roomDigest(digest, fixture.lobby.id).unread, 10)
      }
    } finally {
      await fixture.harness.cleanup()
    }
  })

  test(`[${backend.name}] mention creates exactly one directed wake with metadata only`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab, store } = fixture.harness
      const message = await collab.sendMessage(fixture.alice.id, {
        roomId: fixture.room.id,
        body: 'ping bob',
        mentions: [fixture.bob.id],
      })
      assert.equal(await store.countAllWakeItems(null), 1)
      const wakeId = await onePendingWake(fixture, fixture.bob.id)
      const [state] = await collab.getWakeState(fixture.bob.id, { wakeIds: [wakeId] })
      assert.equal(state?.cause, 'mention')
      assert.equal(state?.actorId, fixture.bob.id)
      assert.equal(state?.roomId, fixture.room.id)
      assert.equal(state?.sourceSeq, message.seq)
      assert.equal(state?.channel, 'dsh_followup')
      assert.equal(state?.priority, 'normal')
      assert.equal(state?.status, 'pending')
      assert.equal((await collab.checkInbox(fixture.alice.id)).totals.pendingWakes, 0)

      // A human target uses the human panel channel.
      await collab.sendMessage(fixture.alice.id, {
        roomId: fixture.room.id,
        body: 'ping boss',
        mentions: [fixture.boss.id],
      })
      const bossWakeId = await onePendingWake(fixture, fixture.boss.id)
      const [bossWake] = await collab.getWakeState(fixture.boss.id, { wakeIds: [bossWakeId] })
      assert.equal(bossWake?.channel, 'human_panel')
      assert.equal(bossWake?.cause, 'mention')
    } finally {
      await fixture.harness.cleanup()
    }
  })

  test(`[${backend.name}] DM messages wake the peer; mention collapses to the strongest cause`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab, store } = fixture.harness
      const dmMessage = await collab.sendMessage(fixture.alice.id, { roomId: fixture.dm.id, body: 'dm one' })
      const dmWakeId = await onePendingWake(fixture, fixture.bob.id)
      const [dmWake] = await collab.getWakeState(fixture.bob.id, { wakeIds: [dmWakeId] })
      assert.equal(dmWake?.cause, 'dm')
      assert.equal(dmWake?.sourceSeq, dmMessage.seq)
      assert.equal((await collab.checkInbox(fixture.alice.id)).totals.pendingWakes, 0)

      // Same source: mention is stronger than dm; still exactly one row for the message.
      await collab.sendMessage(fixture.alice.id, {
        roomId: fixture.dm.id,
        body: 'dm with mention',
        mentions: [fixture.bob.id],
      })
      assert.equal(await wakeCountFor(fixture.harness, fixture.bob.id), 2)
      const digest = await collab.checkInbox(fixture.bob.id)
      const states = await collab.getWakeState(fixture.bob.id, { wakeIds: digest.pendingWakeIds })
      const causes = states.map(state => state.cause).sort()
      assert.deepEqual(causes, ['dm', 'mention'])
      assert.equal(await store.countAllWakeItems(null), 2)
    } finally {
      await fixture.harness.cleanup()
    }
  })

  test(`[${backend.name}] reply wakes the replied-to sender; reply+mention is one row`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab } = fixture.harness
      const root = await collab.sendMessage(fixture.alice.id, { roomId: fixture.room.id, body: 'root' })
      await collab.sendMessage(fixture.bob.id, {
        roomId: fixture.room.id,
        body: 'reply',
        replyToSeq: root.seq,
      })
      const wakeId = await onePendingWake(fixture, fixture.alice.id)
      assert.equal((await collab.getWakeState(fixture.alice.id, { wakeIds: [wakeId] }))[0]?.cause, 'reply')

      // Reply + explicit mention of the same target -> one wake with cause mention.
      const rootTwo = await collab.sendMessage(fixture.bob.id, { roomId: fixture.room.id, body: 'root two' })
      await collab.sendMessage(fixture.alice.id, {
        roomId: fixture.room.id,
        body: 'reply with mention',
        replyToSeq: rootTwo.seq,
        mentions: [fixture.bob.id],
      })
      const bobDigest = await collab.checkInbox(fixture.bob.id)
      assert.equal(bobDigest.totals.pendingWakes, 1)
      const bobStates = await collab.getWakeState(fixture.bob.id, { wakeIds: bobDigest.pendingWakeIds })
      assert.equal(bobStates[0]?.cause, 'mention')

      // Self-reply never wakes the sender.
      const ownRoot = await collab.sendMessage(fixture.bob.id, { roomId: fixture.room.id, body: 'own root' })
      await collab.sendMessage(fixture.bob.id, {
        roomId: fixture.room.id,
        body: 'self reply',
        replyToSeq: ownRoot.seq,
      })
      assert.equal(await wakeCountFor(fixture.harness, fixture.bob.id), 1)
    } finally {
      await fixture.harness.cleanup()
    }
  })

  test(`[${backend.name}] mention_all: privileged, separate, bounded wake fan-out`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab, store } = fixture.harness
      const message = await collab.sendMessage(fixture.boss.id, {
        roomId: fixture.room.id,
        body: 'all hands',
        mentionAll: true,
      })
      assert.equal(message.replayed, false)
      for (const actor of [fixture.alice, fixture.bob]) {
        const digest = await collab.checkInbox(actor.id)
        assert.equal(digest.totals.pendingWakes, 1)
        const [state] = await collab.getWakeState(actor.id, { wakeIds: digest.pendingWakeIds })
        assert.equal(state?.cause, 'mention_all')
        assert.equal(state?.priority, 'high')
      }
      assert.equal((await collab.checkInbox(fixture.boss.id)).totals.pendingWakes, 0)

      // Agent member without owner role: forbidden.
      await expectCode(
        () => collab.sendMessage(fixture.alice.id, { roomId: fixture.room.id, body: 'all', mentionAll: true }),
        'MENTION_ALL_FORBIDDEN',
      )
      // Not allowed in a DM.
      await expectCode(
        () => collab.sendMessage(fixture.alice.id, { roomId: fixture.dm.id, body: 'all', mentionAll: true }),
        'MENTION_ALL_IN_DM',
      )
      // An agent room owner may hold the capability (human/owner rule).
      const ownerRoom = await collab.createGroupRoom(fixture.alice.id, {
        name: 'agent-owned',
        memberIds: [fixture.bob.id],
      })
      await collab.sendMessage(fixture.alice.id, { roomId: ownerRoom.id, body: 'owner all', mentionAll: true })
      assert.equal((await collab.checkInbox(fixture.bob.id)).totals.pendingWakes, 2)

      // Bounded fan-out: at most wakeMaxTargets (=50) materialized wakes per @all.
      const bulkActors = []
      for (let index = 0; index < 60; index += 1) {
        bulkActors.push(await createActor(collab, `bulk-${String(index).padStart(2, '0')}`))
      }
      const bulkRoom = await collab.createGroupRoom(fixture.boss.id, {
        name: 'bulk',
        memberIds: bulkActors.map(actor => actor.id),
      })
      await collab.sendMessage(fixture.boss.id, { roomId: bulkRoom.id, body: '@all', mentionAll: true })
      let bulkWakes = 0
      for (const actor of bulkActors) bulkWakes += await wakeCountFor(fixture.harness, actor.id)
      assert.equal(bulkWakes, 50)
      assert.equal(await store.countAllWakeItems(null), 2 + 1 + 50)
    } finally {
      await fixture.harness.cleanup()
    }
  })

  test(`[${backend.name}] paused target: mention stores, no wake, digest remains; paused cannot send`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab, store } = fixture.harness
      await collab.setActorStatus(fixture.bob.id, 'paused')
      const message = await collab.sendMessage(fixture.alice.id, {
        roomId: fixture.room.id,
        body: 'paused ping',
        mentions: [fixture.bob.id],
      })
      assert.equal(await wakeCountFor(fixture.harness, fixture.bob.id), 0)
      const digest = await collab.checkInbox(fixture.bob.id)
      assert.equal(digest.totals.unread, 1)
      assert.equal(digest.totals.pendingWakes, 0)
      assert.deepEqual(digest.mentions.map(mention => mention.seq), [message.seq])
      assert.equal(await store.countAllWakeItems(null), 0)
      await expectCode(
        () => collab.sendMessage(fixture.bob.id, { roomId: fixture.room.id, body: 'nope' }),
        'ACTOR_PAUSED',
      )
      await collab.setActorStatus(fixture.bob.id, 'active')
      await collab.sendMessage(fixture.alice.id, {
        roomId: fixture.room.id,
        body: 'active ping',
        mentions: [fixture.bob.id],
      })
      assert.equal((await collab.checkInbox(fixture.bob.id)).totals.pendingWakes, 1)
    } finally {
      await fixture.harness.cleanup()
    }
  })

  test(`[${backend.name}] retired actors cannot send or be mentioned; pending wakes terminate`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab } = fixture.harness
      await collab.sendMessage(fixture.alice.id, {
        roomId: fixture.room.id,
        body: 'before retirement',
        mentions: [fixture.bob.id],
      })
      const wakeId = await onePendingWake(fixture, fixture.bob.id)
      await collab.setActorStatus(fixture.bob.id, 'retired')

      assert.equal((await collab.checkInbox(fixture.bob.id)).totals.pendingWakes, 0)
      const [state] = await collab.getWakeState(fixture.bob.id, { wakeIds: [wakeId] })
      assert.equal(state?.status, 'failed')
      await expectCode(
        () => collab.sendMessage(fixture.bob.id, { roomId: fixture.room.id, body: 'nope' }),
        'ACTOR_RETIRED',
      )
      await expectCode(
        () =>
          collab.sendMessage(fixture.alice.id, {
            roomId: fixture.room.id,
            body: 'mention retired',
            mentions: [fixture.bob.id],
          }),
        'ACTOR_RETIRED',
      )
      await expectCode(() => collab.createDm(fixture.alice.id, fixture.bob.id), 'ACTOR_RETIRED')
      await expectCode(() => collab.setActorStatus(fixture.bob.id, 'active'), 'VALIDATION_FAILED')
    } finally {
      await fixture.harness.cleanup()
    }
  })

  test(`[${backend.name}] ack and read are separate; ack is per-id and idempotent`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab, store } = fixture.harness
      const message = await collab.sendMessage(fixture.alice.id, {
        roomId: fixture.room.id,
        body: 'handle me',
        mentions: [fixture.bob.id],
      })
      const wakeId = await onePendingWake(fixture, fixture.bob.id)

      // Ack alone: pendingWakes drops, unread does not.
      const ack = await collab.ackDelivery(fixture.bob.id, { wakeIds: [wakeId] })
      assert.deepEqual(ack, { acked: [wakeId], alreadyAcked: [], failed: [] })
      let digest = await collab.checkInbox(fixture.bob.id)
      assert.equal(digest.totals.pendingWakes, 0)
      assert.equal(digest.totals.unread, 1)
      assert.deepEqual(digest.mentions.map(mention => mention.seq), [message.seq])
      const duplicate = await collab.ackDelivery(fixture.bob.id, { wakeIds: [wakeId] })
      assert.deepEqual(duplicate, { acked: [], alreadyAcked: [wakeId], failed: [] })
      assert.equal(await store.countAllWakeItems(null), 1)

      // Read alone does not ack.
      const second = await collab.sendMessage(fixture.alice.id, {
        roomId: fixture.room.id,
        body: 'second',
        mentions: [fixture.bob.id],
      })
      await collab.markRead(fixture.bob.id, { roomId: fixture.room.id, upToRoomSeq: second.roomSeq })
      digest = await collab.checkInbox(fixture.bob.id)
      assert.equal(digest.totals.unread, 0)
      assert.equal(digest.totals.pendingWakes, 1)
      const readState = await collab.getReadState(fixture.bob.id, fixture.room.id)
      assert.equal(readState.lastReadRoomSeq, second.roomSeq)

      // Unknown ids and other actors' ids are WAKE_NOT_FOUND per id.
      const third = await collab.sendMessage(fixture.alice.id, {
        roomId: fixture.room.id,
        body: 'third',
        mentions: [fixture.bob.id],
      })
      void third
      const [bobPending] = (await collab.checkInbox(fixture.bob.id)).pendingWakeIds
      assert.ok(bobPending !== undefined)
      const foreign = await collab.ackDelivery(fixture.carol.id, { wakeIds: [bobPending, 'does-not-exist'] })
      assert.deepEqual(foreign.acked, [])
      assert.deepEqual(
        foreign.failed.map(item => [item.wakeId, item.code]),
        [
          [bobPending, 'WAKE_NOT_FOUND'],
          ['does-not-exist', 'WAKE_NOT_FOUND'],
        ],
      )
      assert.equal((await collab.checkInbox(fixture.bob.id)).totals.pendingWakes, 2)
    } finally {
      await fixture.harness.cleanup()
    }
  })

  test(`[${backend.name}] digest is metadata-only and bounded`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab } = fixture.harness
      const secret = 'SECRET_BODY_MARKER_7f3a'
      const first = await collab.sendMessage(fixture.alice.id, {
        roomId: fixture.room.id,
        body: secret,
        mentions: [fixture.bob.id],
      })
      for (let index = 0; index < 5; index += 1) {
        await collab.sendMessage(fixture.alice.id, { roomId: fixture.room.id, body: `extra ${index}` })
      }
      const digest = await collab.checkInbox(fixture.bob.id)
      const serialized = JSON.stringify(digest)
      assert.equal(serialized.includes(secret), false, 'digest must not contain a message body')
      assert.equal(/"body"/.test(serialized), false, 'digest must not have a body field')
      const room = roomDigest(digest, fixture.room.id)
      assert.equal(room.last.length, 3)
      for (const entry of room.last) {
        assert.deepEqual(Object.keys(entry).sort(), ['createdAt', 'kind', 'senderId', 'seq'])
      }
      assert.deepEqual(digest.mentions.map(mention => [mention.seq, mention.cause]), [[first.seq, 'mention']])
      assert.deepEqual(Object.keys(digest.mentions[0] ?? {}).sort(), ['cause', 'roomId', 'senderId', 'seq'])
      assert.equal(room.mentionCount, 1)

      const headOnly = await collab.checkInbox(fixture.bob.id, { includeMentions: false })
      assert.deepEqual(headOnly.mentions, [])
      assert.equal(headOnly.totals.mentions, 1)

      await expectCode(() => collab.checkInbox(fixture.bob.id, { lastN: 0 }), 'VALIDATION_FAILED')
      await expectCode(() => collab.checkInbox(fixture.bob.id, { lastN: 21 }), 'VALIDATION_FAILED')

      // Room filter: only member rooms, and non-member DM is invisible.
      const filtered = await collab.checkInbox(fixture.bob.id, { roomIds: [fixture.room.id] })
      assert.deepEqual(filtered.rooms.map(entry => entry.roomId), [fixture.room.id])
      assert.equal(filtered.totals.unread, 6)
      await expectCode(
        () => collab.checkInbox(fixture.carol.id, { roomIds: [fixture.dm.id] }),
        'ROOM_NOT_FOUND',
      )
    } finally {
      await fixture.harness.cleanup()
    }
  })

  test(`[${backend.name}] unread arithmetic is exact and join baseline is zero`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab } = fixture.harness
      for (let index = 0; index < 100; index += 1) {
        await collab.sendMessage(index % 2 === 0 ? fixture.alice.id : fixture.bob.id, {
          roomId: fixture.room.id,
          body: `message ${index}`,
        })
      }
      let digest = await collab.checkInbox(fixture.bob.id, { roomIds: [fixture.room.id] })
      assert.equal(roomDigest(digest, fixture.room.id).headRoomSeq, 100)
      assert.equal(digest.totals.unread, 100)
      const stats = await collab.getRoomStats(fixture.bob.id, fixture.room.id)
      assert.equal(stats.headRoomSeq, 100)
      await collab.markRead(fixture.bob.id, { roomId: fixture.room.id, upToRoomSeq: 60 })
      digest = await collab.checkInbox(fixture.bob.id, { roomIds: [fixture.room.id] })
      assert.equal(digest.totals.unread, 40)

      // A later actor auto-joins the broadcast room at the current head (0 unread).
      await collab.sendMessage(fixture.boss.id, { roomId: fixture.lobby.id, body: 'before dave joined' })
      const dave = await createActor(collab, 'dave')
      const daveDigest = await collab.checkInbox(dave.id)
      assert.equal(roomDigest(daveDigest, fixture.lobby.id).unread, 0)
      assert.equal(daveDigest.totals.unread, 0)

      // A member added to a busy group room also joins at the head.
      await collab.addMember(fixture.boss.id, fixture.room.id, dave.id)
      const joined = await collab.checkInbox(dave.id, { roomIds: [fixture.room.id] })
      assert.equal(roomDigest(joined, fixture.room.id).unread, 0)
      await collab.sendMessage(fixture.alice.id, { roomId: fixture.room.id, body: 'welcome dave' })
      assert.equal(
        roomDigest(await collab.checkInbox(dave.id, { roomIds: [fixture.room.id] }), fixture.room.id).unread,
        1,
      )
    } finally {
      await fixture.harness.cleanup()
    }
  })

  test(`[${backend.name}] wake ids are priority ordered and dedupe key is unique`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab, store } = fixture.harness
      const mention = await collab.sendMessage(fixture.alice.id, {
        roomId: fixture.room.id,
        body: 'normal mention',
        mentions: [fixture.bob.id],
      })
      const all = await collab.sendMessage(fixture.boss.id, {
        roomId: fixture.room.id,
        body: 'high all',
        mentionAll: true,
      })
      const digest = await collab.checkInbox(fixture.bob.id)
      assert.equal(digest.pendingWakeIds.length, 2)
      const states = await collab.getWakeState(fixture.bob.id, { wakeIds: digest.pendingWakeIds })
      assert.deepEqual(states.map(state => state.cause), ['mention_all', 'mention'])
      assert.deepEqual(states.map(state => state.sourceSeq), [all.seq, mention.seq])
      assert.equal(await store.countWakeItemsForActor(null, fixture.bob.id), 2)

      // DM + mention on one message: one dedupe row.
      await collab.sendMessage(fixture.alice.id, {
        roomId: fixture.dm.id,
        body: 'dm mention',
        mentions: [fixture.bob.id],
      })
      assert.equal(await store.countWakeItemsForActor(null, fixture.bob.id), 3)
    } finally {
      await fixture.harness.cleanup()
    }
  })

  test(`[${backend.name}] broadcast flood: 200 messages, zero wake rows, bounded read rows`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab, store } = fixture.harness
      for (let round = 0; round < 2; round += 1) {
        const items = Array.from({ length: 100 }, (_unused, index) => ({
          roomId: fixture.lobby.id,
          body: `flood ${round}-${index}`,
        }))
        const result = await collab.batchSend(fixture.boss.id, items)
        assert.equal(result.items.every(item => item.status === 'ok'), true)
      }
      assert.equal(await store.countAllWakeItems(null), 0)
      assert.equal(await store.countMessages(null), 200)
      assert.equal(await store.countReadStatesForRoom(null, fixture.lobby.id), 4)
      const stats = await collab.getRoomStats(fixture.alice.id, fixture.lobby.id)
      assert.equal(stats.headRoomSeq, 200)
      for (const actor of [fixture.alice, fixture.bob, fixture.carol]) {
        const digest = await collab.checkInbox(actor.id, { roomIds: [fixture.lobby.id] })
        assert.equal(digest.totals.pendingWakes, 0)
        assert.equal(roomDigest(digest, fixture.lobby.id).unread, 200)
      }
    } finally {
      await fixture.harness.cleanup()
    }
  })

  test(`[${backend.name}] getWakeState refuses foreign or unknown ids`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab } = fixture.harness
      await collab.sendMessage(fixture.alice.id, {
        roomId: fixture.room.id,
        body: 'ping',
        mentions: [fixture.bob.id],
      })
      const wakeId = await onePendingWake(fixture, fixture.bob.id)
      await expectCode(() => collab.getWakeState(fixture.carol.id, { wakeIds: [wakeId] }), 'WAKE_NOT_FOUND')
      await expectCode(() => collab.getWakeState(fixture.bob.id, { wakeIds: ['nope'] }), 'WAKE_NOT_FOUND')
    } finally {
      await fixture.harness.cleanup()
    }
  })

  // Clock injection sanity: two services with the same clock produce stable digests.
  test(`[${backend.name}] digest generatedAt follows the injected clock`, async () => {
    const clock = makeClock(42_000)
    const fixture = await setupFixture(backend, { clock })
    try {
      const { collab } = fixture.harness
      clock.advance(5)
      const digest = await collab.checkInbox(fixture.bob.id)
      assert.equal(digest.generatedAt, 42_005)
    } finally {
      await fixture.harness.cleanup()
    }
  })
}
