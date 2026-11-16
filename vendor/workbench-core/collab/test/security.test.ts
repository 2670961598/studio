import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { dmKey } from '../src/index.ts'
import { backends, createActor, expectCode, setupFixture } from './helpers.ts'

for (const backend of backends) {
  test(`[${backend.name}] paused actors may create rooms; retired actors may not`, async () => {
    const harness = await backend.create()
    try {
      const { collab } = harness
      const a = await createActor(collab, 'a')
      const b = await createActor(collab, 'b')
      await collab.setActorStatus(a.id, 'paused')

      // paused is a mute, not a terminal status: room creation stays allowed.
      const group = await collab.createGroupRoom(a.id, { name: 'paused-owned', memberIds: [b.id] })
      assert.equal(group.kind, 'group')
      const dm = await collab.createDm(a.id, b.id)
      assert.equal(dm.kind, 'dm')
      const lobby = await collab.createBroadcastRoom(a.id, { name: 'lobby' })
      assert.equal(lobby.kind, 'broadcast')
      // ...but sending is still blocked while paused.
      await expectCode(() => collab.sendMessage(a.id, { roomId: group.id, body: 'nope' }), 'ACTOR_PAUSED')

      // retired is terminal: all three creation paths refuse it.
      const c = await createActor(collab, 'c')
      const d = await createActor(collab, 'd')
      await collab.setActorStatus(c.id, 'retired')
      await expectCode(
        () => collab.createGroupRoom(c.id, { name: 'retired-owned', memberIds: [d.id] }),
        'ACTOR_RETIRED',
      )
      await expectCode(() => collab.createDm(c.id, d.id), 'ACTOR_RETIRED')
      await expectCode(() => collab.createBroadcastRoom(c.id, { name: 'lobby-2' }), 'ACTOR_RETIRED')
    } finally {
      await harness.cleanup()
    }
  })

  test(`[${backend.name}] actor ids are lowercase, colon-free and length bounded`, async () => {
    const harness = await backend.create()
    try {
      const { collab } = harness
      for (const invalid of ['Agent:1', 'UPPER', 'has space', 'a:b', '', 'x'.repeat(65)]) {
        await expectCode(() => collab.createActor({ id: invalid, kind: 'agent', name: invalid }), 'VALIDATION_FAILED')
      }
      const generated = await collab.createActor({ kind: 'agent', name: 'generated' })
      assert.match(generated.id, /^[a-z0-9_-]{1,64}$/)
      const valid = await collab.createActor({ id: 'a-b_c9', kind: 'human', name: 'valid' })
      assert.equal(valid.id, 'a-b_c9')
    } finally {
      await harness.cleanup()
    }
  })

  test(`[${backend.name}] DM identity is sha256(low NUL high) and collision attempts are impossible`, async () => {
    const harness = await backend.create()
    try {
      const { collab } = harness
      for (const id of ['a-b', 'c', 'a', 'b-c']) {
        await createActor(collab, id)
      }
      const dm = await collab.createDm('a-b', 'c')
      const expected = createHash('sha256').update('a-b\u0000c').digest('hex')
      assert.equal(dm.dmKey, expected)
      assert.equal(dm.dmKey, dmKey('a-b', 'c'))
      assert.deepEqual([dm.dmLow, dm.dmHigh], ['a-b', 'c'])

      // The pre-v0.4 ':' ambiguity (`a`+`b:c` vs `a:b`+`c`) cannot exist: ':' is
      // rejected at the actor-id gate, and distinct pairs get distinct keys.
      await expectCode(() => collab.createActor({ id: 'a:b', kind: 'agent', name: 'colon' }), 'VALIDATION_FAILED')
      const other = await collab.createDm('a', 'b-c')
      assert.notEqual(other.id, dm.id)
      assert.notEqual(other.dmKey, dm.dmKey)
      assert.equal(dmKey('a', 'b-c'), createHash('sha256').update('a\u0000b-c').digest('hex'))
      assert.equal((await collab.createDm('c', 'a-b')).id, dm.id)
    } finally {
      await harness.cleanup()
    }
  })

  test(`[${backend.name}] DM privacy: non-members cannot see or reach the room`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab } = fixture.harness
      const outsider = fixture.carol
      const dmId = fixture.dm.id
      await expectCode(() => collab.getRoom(outsider.id, dmId), 'ROOM_NOT_FOUND')
      await expectCode(() => collab.listMessages(outsider.id, { roomId: dmId }), 'ROOM_NOT_FOUND')
      await expectCode(() => collab.listMembers(outsider.id, dmId), 'ROOM_NOT_FOUND')
      await expectCode(() => collab.getRoomStats(outsider.id, dmId), 'ROOM_NOT_FOUND')
      await expectCode(() => collab.getReadState(outsider.id, dmId), 'ROOM_NOT_FOUND')
      await expectCode(() => collab.sendMessage(outsider.id, { roomId: dmId, body: 'intrude' }), 'ROOM_NOT_FOUND')
      await expectCode(() => collab.markRead(outsider.id, { roomId: dmId, upToRoomSeq: 0 }), 'ROOM_NOT_FOUND')
      await expectCode(() => collab.checkInbox(outsider.id, { roomIds: [dmId] }), 'ROOM_NOT_FOUND')
      assert.deepEqual((await collab.listRooms(outsider.id)).map(room => room.id), [fixture.lobby.id])
      assert.equal(
        (await collab.checkInbox(outsider.id)).rooms.some(room => room.roomId === dmId),
        false,
      )
      // Same no-existence-leak rule for a group room.
      await expectCode(() => collab.listMessages(outsider.id, { roomId: fixture.room.id }), 'ROOM_NOT_FOUND')
    } finally {
      await fixture.harness.cleanup()
    }
  })

  test(`[${backend.name}] principal must be host-bound, never a request-body field`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab } = fixture.harness
      const spoofed = { roomId: fixture.room.id, body: 'spoof', senderId: fixture.alice.id } as never
      await expectCode(() => collab.sendMessage(fixture.bob.id, spoofed), 'PRINCIPAL_MISMATCH')
      const spoofedActor = { roomId: fixture.room.id, body: 'spoof', actorId: fixture.bob.id } as never
      await expectCode(() => collab.sendMessage(fixture.alice.id, spoofedActor), 'PRINCIPAL_MISMATCH')
    } finally {
      await fixture.harness.cleanup()
    }
  })

  test(`[${backend.name}] broadcast governance: can_broadcast, grant rules, kind restriction`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab } = fixture.harness
      const lobby = fixture.lobby.id
      // Members without the grant cannot broadcast.
      await expectCode(
        () => collab.sendMessage(fixture.alice.id, { roomId: lobby, body: 'nope' }),
        'BROADCAST_FORBIDDEN',
      )
      // The human owner can.
      await collab.sendMessage(fixture.boss.id, { roomId: lobby, body: 'owner broadcast' })

      // Only a human or the room owner may grant.
      await expectCode(
        () => collab.setCanBroadcast(fixture.alice.id, lobby, fixture.bob.id, true),
        'BROADCAST_GRANT_FORBIDDEN',
      )
      // An agent can never grant itself.
      await expectCode(
        () => collab.setCanBroadcast(fixture.alice.id, lobby, fixture.alice.id, true),
        'BROADCAST_GRANT_FORBIDDEN',
      )
      const granted = await collab.setCanBroadcast(fixture.boss.id, lobby, fixture.alice.id, true)
      assert.equal(granted.canBroadcast, true)
      // Agent broadcast content must be status/handoff.
      await expectCode(
        () => collab.sendMessage(fixture.alice.id, { roomId: lobby, body: 'chat', kind: 'chat' }),
        'BROADCAST_KIND_REQUIRED',
      )
      await collab.sendMessage(fixture.alice.id, { roomId: lobby, body: 'status', kind: 'status' })
      // Revoke.
      await collab.setCanBroadcast(fixture.boss.id, lobby, fixture.alice.id, false)
      await expectCode(
        () => collab.sendMessage(fixture.alice.id, { roomId: lobby, body: 'again' }),
        'BROADCAST_FORBIDDEN',
      )
      // can_broadcast only exists in the broadcast room; target must be a member.
      await expectCode(
        () => collab.setCanBroadcast(fixture.boss.id, fixture.room.id, fixture.alice.id, true),
        'VALIDATION_FAILED',
      )
      await expectCode(
        () => collab.setCanBroadcast(fixture.boss.id, lobby, 'ghost', true),
        'NOT_MEMBER',
      )
    } finally {
      await fixture.harness.cleanup()
    }
  })

  test(`[${backend.name}] mention rules: self, non-member, retired, mention_all capabilities`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab } = fixture.harness
      await expectCode(
        () => collab.sendMessage(fixture.alice.id, {
          roomId: fixture.room.id,
          body: 'self',
          mentions: [fixture.alice.id],
        }),
        'SELF_MENTION_FORBIDDEN',
      )
      await expectCode(
        () => collab.sendMessage(fixture.alice.id, {
          roomId: fixture.room.id,
          body: 'outsider',
          mentions: [fixture.carol.id],
        }),
        'MENTION_NOT_MEMBER',
      )
      await expectCode(
        () => collab.sendMessage(fixture.alice.id, {
          roomId: fixture.room.id,
          body: 'ghost',
          mentions: ['ghost'],
        }),
        'ACTOR_NOT_FOUND',
      )
      // Mention text is never parsed from the body: '@bob' creates no mention/wake.
      await collab.sendMessage(fixture.alice.id, {
        roomId: fixture.room.id,
        body: '@bob this is plain text, not a mention',
      })
      assert.equal((await collab.checkInbox(fixture.bob.id)).totals.pendingWakes, 0)
      assert.equal((await collab.checkInbox(fixture.bob.id)).totals.mentions, 0)
      // The member agent without the owner role cannot use @all; the human can.
      await expectCode(
        () => collab.sendMessage(fixture.alice.id, { roomId: fixture.room.id, body: '@all', mentionAll: true }),
        'MENTION_ALL_FORBIDDEN',
      )
      await collab.sendMessage(fixture.boss.id, { roomId: fixture.room.id, body: '@all', mentionAll: true })
    } finally {
      await fixture.harness.cleanup()
    }
  })

  test(`[${backend.name}] message shape validation: plain text size, kind enum, ticket key, cross-room reply`, async () => {
    const harness = await backend.create()
    try {
      const { collab } = harness
      const a = await createActor(collab, 'a')
      const b = await createActor(collab, 'b')
      const roomA = await collab.createGroupRoom(a.id, { name: 'a', memberIds: [b.id] })
      const roomB = await collab.createGroupRoom(a.id, { name: 'b', memberIds: [b.id] })
      const first = await collab.sendMessage(a.id, { roomId: roomA.id, body: 'in A' })
      const second = await collab.sendMessage(a.id, { roomId: roomB.id, body: 'in B', kind: 'result' })
      assert.equal(second.seq, first.seq + 1)

      await expectCode(
        () => collab.sendMessage(a.id, { roomId: roomA.id, body: 'nul\u0000byte' }),
        'VALIDATION_FAILED',
      )
      await expectCode(
        () => collab.sendMessage(a.id, { roomId: roomA.id, body: 'bell\u0007char' }),
        'VALIDATION_FAILED',
      )
      await expectCode(
        () => collab.sendMessage(a.id, { roomId: roomA.id, body: 'x'.repeat(16 * 1024 + 1) }),
        'BODY_TOO_LARGE',
      )
      // Byte-exact boundary: 16 KiB of UTF-8 is the maximum, multibyte included.
      const boundary = await collab.sendMessage(a.id, { roomId: roomA.id, body: 'a'.repeat(16 * 1024) })
      assert.ok(boundary.seq > second.seq)
      await expectCode(
        () => collab.sendMessage(a.id, { roomId: roomA.id, body: '你'.repeat(5462) }),
        'BODY_TOO_LARGE',
      )
      await collab.sendMessage(a.id, { roomId: roomA.id, body: '你'.repeat(5461) })
      await expectCode(
        () => collab.sendMessage(a.id, { roomId: roomA.id, body: 'kind', kind: 'announcement' as never }),
        'VALIDATION_FAILED',
      )
      await expectCode(
        () => collab.sendMessage(a.id, { roomId: roomA.id, body: 'ticket', ticketKey: '' }),
        'VALIDATION_FAILED',
      )
      const ticketed = await collab.sendMessage(a.id, {
        roomId: roomA.id,
        body: 'ticket ref',
        ticketKey: 'LOCAL-42',
      })
      assert.equal(ticketed.replayed, false)
      const [stored] = (await collab.listMessages(a.id, { roomId: roomA.id })).items.filter(
        message => message.seq === ticketed.seq,
      )
      assert.equal(stored?.ticketKey, 'LOCAL-42')

      // replyToSeq is a GLOBAL seq: a room-A message cannot be the reply target in room B.
      await expectCode(
        () => collab.sendMessage(a.id, { roomId: roomB.id, body: 'cross reply', replyToSeq: first.seq }),
        'UNKNOWN_REPLY',
      )
      const sameRoomReply = await collab.sendMessage(b.id, {
        roomId: roomB.id,
        body: 'same room reply',
        replyToSeq: second.seq,
      })
      assert.equal(sameRoomReply.replayed, false)
      const replies = (await collab.listMessages(a.id, { roomId: roomB.id })).items
      assert.equal(replies.find(message => message.seq === sameRoomReply.seq)?.replyToSeq, second.seq)
    } finally {
      await harness.cleanup()
    }
  })

  test(`[${backend.name}] opaque cursor rejects tamper, rebind and malformed tokens`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab } = fixture.harness
      const first = await collab.sendMessage(fixture.alice.id, { roomId: fixture.room.id, body: '1' })
      await collab.sendMessage(fixture.alice.id, { roomId: fixture.room.id, body: '2' })
      const page = await collab.listMessages(fixture.bob.id, { roomId: fixture.room.id, limit: 1 })
      const cursor = page.nextCursor
      assert.ok(cursor !== null)
      // Happy path: same principal, same room.
      const page2 = await collab.listMessages(fixture.bob.id, { roomId: fixture.room.id, cursor: cursor ?? '' })
      assert.equal(page2.items.length, 1)
      // Cross-principal rebind.
      await expectCode(
        () => collab.listMessages(fixture.alice.id, { roomId: fixture.room.id, cursor: cursor ?? '' }),
        'VALIDATION_FAILED',
      )
      // Cross-room rebind.
      await expectCode(
        () => collab.listMessages(fixture.bob.id, { roomId: fixture.lobby.id, cursor: cursor ?? '' }),
        'VALIDATION_FAILED',
      )
      // Tamper.
      await expectCode(
        () => collab.listMessages(fixture.bob.id, { roomId: fixture.room.id, cursor: `${cursor}x` }),
        'VALIDATION_FAILED',
      )
      await expectCode(
        () => collab.listMessages(fixture.bob.id, { roomId: fixture.room.id, cursor: 'not-a-cursor' }),
        'VALIDATION_FAILED',
      )
      void first
    } finally {
      await fixture.harness.cleanup()
    }
  })
}

// ---------------------------------------------------------------------------
// Boundary leakage negatives (T-SEC-30 analog, adapter-independent)
// ---------------------------------------------------------------------------

test('[boundary] domain layer contains no SQL, table names or node:sqlite symbols', () => {
  const files = ['src/service.ts', 'src/types.ts', 'src/errors.ts', 'src/keys.ts', 'src/cursor.ts']
  const forbidden: Array<[string, RegExp]> = [
    ['engine import', /node:sqlite/],
    ['driver type', /DatabaseSync|StatementSync/],
    ['pragma', /PRAGMA/i],
    ['ddl', /CREATE TABLE|ALTER TABLE|DROP TABLE/i],
    ['sql', /\bSELECT\b|\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b/i],
    ['schema table', /schema_migrations|sqlite_master/i],
  ]
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    for (const [label, pattern] of forbidden) {
      assert.equal(pattern.test(source), false, `${file} leaks ${label}: ${String(pattern)}`)
    }
  }
})

test('[boundary] public entry exports no storage-port or adapter types', () => {
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.equal(/export\s+(type\s+)?\{[^}]*\b(ChatStore|ChatTx|SqliteChatStore|MemoryChatStore|ActorRow|MessageRow)\b/s.test(source), false)
  assert.equal(/export\s+(type\s+)?\{[^}]*from '\.\/store\.ts'/s.test(source), false)
})
