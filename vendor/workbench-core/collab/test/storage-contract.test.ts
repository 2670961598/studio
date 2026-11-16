import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { CollabError } from '../src/errors.ts'
import { dmKey } from '../src/keys.ts'
import { MemoryChatStore } from '../src/memory-store.ts'
import { SqliteChatStore } from '../src/sqlite-store.ts'
import type {
  ActorRow,
  AppendMessageInput,
  ChatStore,
  MessageRow,
  ReadStateRow,
  RoomMemberRow,
  RoomRow,
  WakeItemRow,
} from '../src/store.ts'
import { expectCode } from './helpers.ts'

// ---------------------------------------------------------------------------
// T-I-15 analog: the same storage-port contract suite runs unchanged against the
// in-memory fake store and the SQLite adapter. No SQL/table/PRAGMA assertions here;
// those live in adapter/persistence tests.
// ---------------------------------------------------------------------------

interface StoreHarness {
  store: ChatStore
  cleanup: () => Promise<void>
}

interface StoreAdapter {
  name: string
  create: () => Promise<StoreHarness>
}

const adapters: StoreAdapter[] = [
  {
    name: 'memory',
    async create() {
      const store = new MemoryChatStore()
      return {
        store,
        cleanup: async () => {
          await store.close()
        },
      }
    },
  },
  {
    name: 'sqlite',
    async create() {
      const dir = mkdtempSync(join(tmpdir(), 'collab-store-'))
      const store = new SqliteChatStore(join(dir, 'chat.sqlite'))
      return {
        store,
        cleanup: async () => {
          await store.close()
          rmSync(dir, { recursive: true, force: true })
        },
      }
    },
  },
]

function actorRow(id: string, kind: 'human' | 'agent' = 'agent', status: ActorRow['status'] = 'active'): ActorRow {
  return { id, kind, name: id, status, createdAt: 1_000 }
}

function groupRoom(id: string, createdBy = 'a'): RoomRow {
  return { id, kind: 'group', name: id, createdBy, dmKey: null, dmLow: null, dmHigh: null, createdAt: 1_000, archivedAt: null }
}

function memberRow(roomId: string, actorId: string, role: RoomMemberRow['role'] = 'member'): RoomMemberRow {
  return { roomId, actorId, role, canBroadcast: role === 'owner', joinedAt: 1_000 }
}

function appendInput(roomId: string, id: string, senderId = 'a', createdAt = 1_000): AppendMessageInput {
  return {
    id,
    roomId,
    senderId,
    body: `body-${id}`,
    kind: 'chat',
    ticketKey: null,
    mentionAll: false,
    mentions: [],
    replyToSeq: null,
    createdAt,
  }
}

async function seedRoom(store: ChatStore, options: { roomId: string; actors: string[] }): Promise<void> {
  await store.transaction(async tx => {
    for (const target of options.actors) {
      if ((await store.getActor(tx, target)) === undefined) await store.insertActor(tx, actorRow(target))
    }
    await store.insertRoom(tx, groupRoom(options.roomId))
    await store.insertRoomStats(tx, {
      roomId: options.roomId,
      headSeq: 0,
      headRoomSeq: 0,
      lastActivityAt: 1_000,
      updatedAt: 1_000,
    })
    await store.insertMembers(
      tx,
      options.actors.map((actorId, index) => {
        const member = memberRow(options.roomId, actorId, index === 0 ? 'owner' : 'member')
        if (actorId === 'a') return { ...member, canBroadcast: true }
        return member
      }),
    )
    await store.insertReadStates(
      tx,
      options.actors.map(actorId => ({
        roomId: options.roomId,
        actorId,
        lastReadSeq: 0,
        lastReadRoomSeq: 0,
        updatedAt: 1_000,
      })),
    )
  })
}

function readState(roomId: string, actorId: string, roomSeq: number, globalSeq = roomSeq): ReadStateRow {
  return { roomId, actorId, lastReadSeq: globalSeq, lastReadRoomSeq: roomSeq, updatedAt: 1_000 }
}

function wakeRow(id: string, dedupeKey: string, options: Partial<WakeItemRow> = {}): WakeItemRow {
  return {
    id,
    actorId: 'a',
    cause: 'mention',
    roomId: 'room-1',
    sourceSeq: 1,
    sourceRoomSeq: 1,
    channel: 'dsh_followup',
    priority: 'normal',
    status: 'pending',
    dedupeKey,
    attempts: 0,
    nextAttemptAt: 1_000,
    leaseUntil: null,
    lastError: null,
    createdAt: 1_000,
    ackedAt: null,
    ...options,
  }
}

/** Seed one message-bearing room plus a second room, returning appended rows. */
async function seedMessages(store: ChatStore): Promise<{
  first: MessageRow
  second: MessageRow
  other: MessageRow
}> {
  await store.transaction(async tx => {
    for (const id of ['a', 'b', 'c']) await store.insertActor(tx, actorRow(id))
    for (const roomId of ['room-1', 'room-2']) {
      await store.insertRoom(tx, groupRoom(roomId))
      await store.insertRoomStats(tx, {
        roomId,
        headSeq: 0,
        headRoomSeq: 0,
        lastActivityAt: 1_000,
        updatedAt: 1_000,
      })
      await store.insertReadStates(tx, [
        { roomId, actorId: 'a', lastReadSeq: 0, lastReadRoomSeq: 0, updatedAt: 1_000 },
      ])
    }
  })
  const first = await store.transaction(tx => store.appendMessage(tx, appendInput('room-1', 'm1', 'a', 1_000)))
  const second = await store.transaction(tx =>
    store.appendMessage(tx, { ...appendInput('room-1', 'm2', 'b', 1_001), mentions: ['a'] }),
  )
  const other = await store.transaction(tx => store.appendMessage(tx, appendInput('room-2', 'm3', 'c', 1_002)))
  return { first, second, other }
}

function registerContract(adapter: StoreAdapter): void {
  const name = adapter.name

  test(`[store:${name}] writes require a transaction; reads work without one`, async () => {
    const { store, cleanup } = await adapter.create()
    try {
      await expectCode(() => store.insertActor(null, actorRow('x')), 'INVALID_INPUT')
      assert.equal(await store.getActor(null, 'x'), undefined)
    } finally {
      await cleanup()
    }
  })

  test(`[store:${name}] actor CRUD, batch get and status update`, async () => {
    const { store, cleanup } = await adapter.create()
    try {
      await store.transaction(async tx => {
        await store.insertActor(tx, actorRow('a'))
        await store.insertActor(tx, actorRow('b', 'human'))
      })
      assert.equal((await store.getActor(null, 'a'))?.kind, 'agent')
      assert.deepEqual(
        (await store.getActors(null, ['a', 'b', 'missing'])).map(row => row.id).sort(),
        ['a', 'b'],
      )
      assert.equal((await store.listActors(null)).length, 2)
      await expectCode(
        () => store.transaction(async tx => store.insertActor(tx, actorRow('a'))),
        'ACTOR_ALREADY_EXISTS',
      )
      await store.transaction(async tx => store.updateActorStatus(tx, 'a', 'paused'))
      assert.equal((await store.getActor(null, 'a'))?.status, 'paused')
      await expectCode(
        () => store.transaction(async tx => store.updateActorStatus(tx, 'missing', 'retired')),
        'ACTOR_NOT_FOUND',
      )
    } finally {
      await cleanup()
    }
  })

  test(`[store:${name}] room, stats and member rows`, async () => {
    const { store, cleanup } = await adapter.create()
    try {
      await seedRoom(store, { roomId: 'room-1', actors: ['a', 'b'] })
      const room = await store.getRoom(null, 'room-1')
      assert.equal(room?.kind, 'group')
      const stats = await store.getRoomStats(null, 'room-1')
      assert.deepEqual([stats?.headSeq, stats?.headRoomSeq], [0, 0])
      const members = await store.listMembers(null, 'room-1')
      assert.deepEqual(members.map(member => member.actorId), ['a', 'b'])
      assert.equal(members[0]?.role, 'owner')
      assert.equal(members[0]?.canBroadcast, true)
      await store.transaction(async tx => store.updateCanBroadcast(tx, 'room-1', 'b', true))
      assert.equal((await store.getMember(null, 'room-1', 'b'))?.canBroadcast, true)
      await store.transaction(async tx => store.removeMember(tx, 'room-1', 'b'))
      assert.equal(await store.getMember(null, 'room-1', 'b'), undefined)
      await expectCode(
        () => store.transaction(async tx => store.insertRoom(tx, groupRoom('room-1'))),
        'INVALID_INPUT',
      )
      assert.deepEqual(
        (await store.listRoomsForActor(null, 'a')).map(row => row.id),
        ['room-1'],
      )
    } finally {
      await cleanup()
    }
  })

  test(`[store:${name}] one broadcast room per database`, async () => {
    const { store, cleanup } = await adapter.create()
    try {
      await store.transaction(async tx => {
        await store.insertActor(tx, actorRow('a'))
        await store.insertRoom(tx, { ...groupRoom('b1'), kind: 'broadcast' })
      })
      assert.equal(await store.hasAnyBroadcastRoom(null), true)
      assert.equal((await store.findBroadcastRoom(null))?.id, 'b1')
      await expectCode(
        () =>
          store.transaction(async tx => {
            await store.insertRoom(tx, { ...groupRoom('b2'), kind: 'broadcast' })
          }),
        'BROADCAST_ALREADY_EXISTS',
      )
      assert.equal((await store.findBroadcastRoom(null))?.id, 'b1')
    } finally {
      await cleanup()
    }
  })

  test(`[store:${name}] DM pair identity is unique and canonical`, async () => {
    const { store, cleanup } = await adapter.create()
    try {
      await store.transaction(async tx => {
        await store.insertActor(tx, actorRow('a'))
        await store.insertActor(tx, actorRow('b'))
        await store.insertActor(tx, actorRow('c'))
        await store.insertActor(tx, actorRow('d'))
        await store.insertRoom(tx, {
          ...groupRoom('dm-1'),
          kind: 'dm',
          dmKey: dmKey('a', 'b'),
          dmLow: 'a',
          dmHigh: 'b',
        })
      })
      assert.equal((await store.findDmRoom(null, 'a', 'b'))?.id, 'dm-1')
      await expectCode(
        () =>
          store.transaction(async tx => {
            await store.insertRoom(tx, {
              ...groupRoom('dm-2'),
              kind: 'dm',
              dmKey: dmKey('a', 'b'),
              dmLow: 'a',
              dmHigh: 'b',
            })
          }),
        'INVALID_INPUT',
      )
      await expectCode(
        () =>
          store.transaction(async tx => {
            await store.insertRoom(tx, {
              ...groupRoom('dm-3'),
              kind: 'dm',
              dmKey: dmKey('c', 'd'),
              dmLow: 'd',
              dmHigh: 'c',
            })
          }),
        'VALIDATION_FAILED',
      )
    } finally {
      await cleanup()
    }
  })

  test(`[store:${name}] appendMessage allocates global seq + contiguous room_seq and bumps heads`, async () => {
    const { store, cleanup } = await adapter.create()
    try {
      const { first, second, other } = await seedMessages(store)
      assert.ok(second.seq > first.seq)
      assert.ok(other.seq > second.seq)
      assert.deepEqual([first.roomSeq, second.roomSeq, other.roomSeq], [1, 2, 1])
      assert.deepEqual(second.mentions, ['a'])
      const statsOne = await store.getRoomStats(null, 'room-1')
      const statsTwo = await store.getRoomStats(null, 'room-2')
      assert.deepEqual([statsOne?.headSeq, statsOne?.headRoomSeq], [second.seq, 2])
      assert.deepEqual([statsTwo?.headSeq, statsTwo?.headRoomSeq], [other.seq, 1])
      assert.equal(await store.countMessages(null), 3)

      const byGlobalSeq = await store.getMessageBySeqInRoom(null, 'room-1', second.seq)
      assert.equal(byGlobalSeq?.id, 'm2')
      assert.equal(await store.getMessageBySeqInRoom(null, 'room-1', other.seq), undefined)
      assert.equal(await store.getMessageSeqInRoomAtOrBelow(null, 'room-1', 0), 0)
      assert.equal(await store.getMessageSeqInRoomAtOrBelow(null, 'room-1', 1), first.seq)
      assert.equal(await store.getMessageSeqInRoomAtOrBelow(null, 'room-1', 99), second.seq)
      const batch = await store.getMessagesBySeqs(null, 'room-1', [first.seq, other.seq, second.seq])
      assert.deepEqual(batch.map(row => row.id), ['m1', 'm2'])
      assert.deepEqual(batch[1]?.mentions, ['a'])
      assert.deepEqual((await store.listMessages(null, 'room-1', 0, 10)).map(row => row.id), ['m1', 'm2'])
      assert.deepEqual((await store.listMessages(null, 'room-1', first.roomSeq, 10)).map(row => row.id), ['m2'])
    } finally {
      await cleanup()
    }
  })

  test(`[store:${name}] last-message metadata is bounded per room`, async () => {
    const { store, cleanup } = await adapter.create()
    try {
      await seedMessages(store)
      await store.transaction(tx => store.appendMessage(tx, appendInput('room-2', 'm4', 'c', 1_003)))
      const rows = await store.listLastMessagesByRooms(null, ['room-1', 'room-2'], 1)
      const byRoom = new Map(rows.map(row => [row.roomId, row]))
      assert.equal(byRoom.size, 2)
      assert.deepEqual(
        rows.map(row => [row.roomId, row.roomSeq]),
        [
          ['room-1', 2],
          ['room-2', 2],
        ],
      )
    } finally {
      await cleanup()
    }
  })

  test(`[store:${name}] read state is monotonic and removable`, async () => {
    const { store, cleanup } = await adapter.create()
    try {
      await seedRoom(store, { roomId: 'room-1', actors: ['a', 'b'] })
      await store.transaction(async tx => store.upsertReadState(tx, readState('room-1', 'a', 3, 9)))
      assert.equal((await store.getReadState(null, 'room-1', 'a'))?.lastReadRoomSeq, 3)
      await store.transaction(async tx => store.upsertReadState(tx, readState('room-1', 'a', 5, 12)))
      assert.equal((await store.getReadState(null, 'room-1', 'a'))?.lastReadRoomSeq, 5)
      await expectCode(
        () => store.transaction(async tx => store.upsertReadState(tx, readState('room-1', 'a', 2, 9))),
        'READ_STATE_BACKWARDS',
      )
      assert.equal(await store.countReadStatesForRoom(null, 'room-1'), 2)
      await expectCode(
        () =>
          store.transaction(async tx =>
            store.insertReadStates(tx, [readState('room-1', 'a', 1, 1)]),
          ),
        'INVALID_INPUT',
      )
      await store.transaction(async tx => store.removeReadState(tx, 'room-1', 'b'))
      assert.equal(await store.countReadStatesForRoom(null, 'room-1'), 1)
    } finally {
      await cleanup()
    }
  })

  test(`[store:${name}] wake rows: dedupe, priority order, CAS ack, terminal states`, async () => {
    const { store, cleanup } = await adapter.create()
    try {
      await seedRoom(store, { roomId: 'room-1', actors: ['a', 'b'] })
      const messages = await store.transaction(async tx => {
        const first = await store.appendMessage(tx, appendInput('room-1', 'm1'))
        const second = await store.appendMessage(tx, appendInput('room-1', 'm2'))
        return { first, second }
      })
      await store.transaction(async tx => {
        await store.insertWakeItems(tx, [
          wakeRow('w1', 'd1', { sourceSeq: messages.first.seq }),
          wakeRow('w2', 'd2', { sourceSeq: messages.second.seq, cause: 'mention_all', priority: 'high' }),
        ])
      })
      assert.equal(await store.countPendingWakes(null, 'a'), 2)
      assert.deepEqual(await store.listPendingWakeIds(null, 'a', 10), ['w2', 'w1'])
      await expectCode(
        () => store.transaction(async tx => store.insertWakeItems(tx, [wakeRow('w3', 'd1')])),
        'VALIDATION_FAILED',
      )
      assert.equal((await store.getWakeItemsByIds(null, ['w1', 'w2'])).length, 2)
      assert.equal(await store.transaction(async tx => store.markWakeAcked(tx, 'w1', 2_000)), true)
      assert.equal(await store.transaction(async tx => store.markWakeAcked(tx, 'w1', 2_001)), false)
      assert.equal((await store.getWakeItemsByIds(null, ['w1']))[0]?.status, 'acked')
      assert.equal(await store.countPendingWakes(null, 'a'), 1)
      assert.equal(await store.countWakeItemsForActor(null, 'a'), 2)
      assert.equal(await store.countAllWakeItems(null), 2)
      assert.equal(
        await store.transaction(async tx => store.terminatePendingWakes(tx, 'a', 'failed', 'ACTOR_RETIRED', 3_000)),
        1,
      )
      assert.equal(await store.countPendingWakes(null, 'a'), 0)
    } finally {
      await cleanup()
    }
  })

  test(`[store:${name}] command log stores and rejects a duplicate key`, async () => {
    const { store, cleanup } = await adapter.create()
    try {
      await store.transaction(async tx => store.insertActor(tx, actorRow('a')))
      const command = {
        actorId: 'a',
        command: 'send' as const,
        idempotencyKey: 'k1',
        requestHash: 'hash-1',
        responseJson: '{"seq":1}',
        createdAt: 1_000,
      }
      await store.transaction(async tx => store.insertCommand(tx, command))
      assert.equal((await store.getCommand(null, 'a', 'send', 'k1'))?.responseJson, '{"seq":1}')
      assert.equal(await store.getCommand(null, 'a', 'send', 'k2'), undefined)
      await expectCode(
        () => store.transaction(async tx => store.insertCommand(tx, command)),
        'IDEMPOTENCY_CONFLICT',
      )
    } finally {
      await cleanup()
    }
  })

  test(`[store:${name}] transaction rollback leaves no partial rows`, async () => {
    const { store, cleanup } = await adapter.create()
    try {
      await expectCode(
        () =>
          store.transaction(async tx => {
            await store.insertActor(tx, actorRow('a'))
            await store.insertRoom(tx, groupRoom('room-1'))
            await store.insertRoomStats(tx, {
              roomId: 'room-1',
              headSeq: 0,
              headRoomSeq: 0,
              lastActivityAt: 1_000,
              updatedAt: 1_000,
            })
            throw new CollabError('VALIDATION_FAILED', 'boom')
          }),
        'VALIDATION_FAILED',
      )
      assert.equal(await store.getActor(null, 'a'), undefined)
      assert.equal(await store.getRoom(null, 'room-1'), undefined)
      assert.equal(await store.getRoomStats(null, 'room-1'), undefined)
      await expectCode(
        () =>
          store.transaction(async tx => {
            await store.insertActor(tx, actorRow('a'))
            await store.insertRoom(tx, groupRoom('room-1'))
            await store.insertRoomStats(tx, {
              roomId: 'room-1',
              headSeq: 0,
              headRoomSeq: 0,
              lastActivityAt: 1_000,
              updatedAt: 1_000,
            })
            await store.appendMessage(tx, appendInput('room-1', 'm1'))
            throw new CollabError('VALIDATION_FAILED', 'boom after append')
          }),
        'VALIDATION_FAILED',
      )
      assert.equal(await store.countMessages(null), 0)
      assert.equal(await store.getRoomStats(null, 'room-1'), undefined)
      // Rollback also restores the allocator: a later append is room_seq 1 again.
      const after = await store.transaction(async tx => {
        await store.insertActor(tx, actorRow('a'))
        await store.insertRoom(tx, groupRoom('room-1'))
        await store.insertRoomStats(tx, {
          roomId: 'room-1',
          headSeq: 0,
          headRoomSeq: 0,
          lastActivityAt: 1_000,
          updatedAt: 1_000,
        })
        return store.appendMessage(tx, appendInput('room-1', 'm1'))
      })
      assert.equal(after.roomSeq, 1)
    } finally {
      await cleanup()
    }
  })

  test(`[store:${name}] savepoint isolates one batch item and commits its siblings`, async () => {
    const { store, cleanup } = await adapter.create()
    try {
      await store.transaction(async tx => {
        await store.insertActor(tx, actorRow('a'))
        await expectCode(
          () =>
            tx.savepoint(async () => {
              await store.insertActor(tx, actorRow('b'))
              throw new CollabError('VALIDATION_FAILED', 'item failed')
            }),
          'VALIDATION_FAILED',
        )
        await store.insertActor(tx, actorRow('c'))
      })
      assert.notEqual(await store.getActor(null, 'a'), undefined)
      assert.equal(await store.getActor(null, 'b'), undefined)
      assert.notEqual(await store.getActor(null, 'c'), undefined)
    } finally {
      await cleanup()
    }
  })

  test(`[store:${name}] transaction is reentrant within one task`, async () => {
    const { store, cleanup } = await adapter.create()
    try {
      await store.transaction(async tx => {
        await store.transaction(async inner => {
          await store.insertActor(inner, actorRow('a'))
        })
        void tx
      })
      assert.notEqual(await store.getActor(null, 'a'), undefined)
    } finally {
      await cleanup()
    }
  })

  test(`[store:${name}] inbox read models: totals, room digest, unread mentions`, async () => {
    const { store, cleanup } = await adapter.create()
    try {
      await seedRoom(store, { roomId: 'room-1', actors: ['a', 'b'] })
      await seedRoom(store, { roomId: 'room-2', actors: ['a', 'c'] })
      const messages = await store.transaction(async tx => {
        const one = await store.appendMessage(tx, {
          ...appendInput('room-1', 'm1', 'b', 1_000),
          mentions: ['a'],
          mentionAll: true,
        })
        const two = await store.appendMessage(tx, appendInput('room-1', 'm2', 'b', 1_001))
        const three = await store.appendMessage(tx, {
          ...appendInput('room-2', 'm3', 'c', 1_002),
          mentions: ['a'],
        })
        return { one, two, three }
      })
      await store.transaction(async tx =>
        store.upsertReadState(tx, {
          roomId: 'room-2',
          actorId: 'a',
          lastReadSeq: messages.three.seq,
          lastReadRoomSeq: messages.three.roomSeq,
          updatedAt: 1_003,
        }),
      )
      const totals = await store.inboxTotals(null, 'a', null)
      assert.deepEqual(totals, { rooms: 2, unread: 2, mentions: 1 })
      const filteredTotals = await store.inboxTotals(null, 'a', ['room-1'])
      assert.deepEqual(filteredTotals, { rooms: 1, unread: 2, mentions: 1 })
      assert.equal(await store.countRoomsForActor(null, 'a', null), 2)
      assert.equal(await store.countRoomsForActor(null, 'a', ['room-2']), 1)
      const digest = await store.listRoomDigest(null, 'a', null, 50)
      assert.deepEqual(
        digest.map(row => [row.roomId, row.unread, row.mentionCount]),
        [
          ['room-2', 0, 0],
          ['room-1', 2, 1],
        ],
      )
      const mentions = await store.listUnreadMentions(null, 'a', null, 10)
      assert.deepEqual(mentions.map(row => [row.seq, row.mentionAll]), [[messages.one.seq, true]])
      assert.equal(await store.countUnreadMentionAll(null, 'a', null), 1)
      assert.equal(await store.countUnreadMentionAll(null, 'a', ['room-2']), 0)
    } finally {
      await cleanup()
    }
  })

  test(`[store:${name}] closed store refuses further work`, async () => {
    const { store, cleanup } = await adapter.create()
    await cleanup()
    await expectCode(() => store.getActor(null, 'a'), 'STORE_CLOSED')
  })
}

for (const adapter of adapters) registerContract(adapter)
