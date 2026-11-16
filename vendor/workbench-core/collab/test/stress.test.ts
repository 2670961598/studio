import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ChatService } from '../src/service.ts'
import { MemoryChatStore } from '../src/memory-store.ts'
import { SqliteChatStore } from '../src/sqlite-store.ts'
import type { Actor, Room } from '../src/index.ts'
import type { ChatStore } from '../src/store.ts'

// ---------------------------------------------------------------------------
// Pressure case (docs/plan/chat-room-performance.md §9.5 / T-PERF-10 analog):
// 1k actors, 1k rooms, 100k messages, plain broadcasts only.
// The load-bearing assertion: plain broadcast/room messages create ZERO per-actor
// delivery rows (no wake rows, read rows bounded by actor count, not messages).
// Override with COLLAB_STRESS_SCALE=small for a bounded smoke run.
// ---------------------------------------------------------------------------

const small = process.env['COLLAB_STRESS_SCALE'] === 'small'
const ACTOR_COUNT = small ? 100 : 1_000
const ROOM_COUNT = small ? 100 : 1_000
const MESSAGES_PER_ROOM = 100
const MESSAGE_TOTAL = ROOM_COUNT * MESSAGES_PER_ROOM
const BROADCAST_TOTAL = small ? 100 : 1_000

interface StressHarness {
  collab: ChatService
  store: ChatStore
  cleanup: () => Promise<void>
}

async function makeStressHarness(backendName: string): Promise<StressHarness> {
  let clock = 1_700_000_000_000
  const now = (): number => {
    clock += 1
    return clock
  }
  if (backendName === 'memory') {
    const store = new MemoryChatStore()
    return {
      collab: new ChatService(store, { now }),
      store,
      cleanup: async () => {
        await store.close()
      },
    }
  }
  const dir = mkdtempSync(join(tmpdir(), 'collab-stress-'))
  const store = new SqliteChatStore(join(dir, 'chat.sqlite'))
  return {
    collab: new ChatService(store, { now }),
    store,
    cleanup: async () => {
      await store.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

function actorId(index: number): string {
  return `actor-${String(index).padStart(4, '0')}`
}

for (const backendName of ['memory', 'sqlite']) {
  test(`[stress:${backendName}] ${ACTOR_COUNT} actors / ${ROOM_COUNT} rooms / ${MESSAGE_TOTAL} messages + ${BROADCAST_TOTAL} broadcasts`, async t => {
    const harness = await makeStressHarness(backendName)
    const events: string[] = []
    const start = performance.now()
    try {
      const { collab, store } = harness
      const boss = await collab.createActor({ id: 'human-boss', kind: 'human', name: 'human boss' })
      const actors: Actor[] = []
      for (let index = 0; index < ACTOR_COUNT - 1; index += 1) {
        actors.push(await collab.createActor({ id: actorId(index), kind: 'agent', name: `agent ${index}` }))
      }
      events.push(`actors:${Math.round(performance.now() - start)}ms`)

      // The single broadcast room is materialized for every current actor.
      const lobby = await collab.createBroadcastRoom(boss.id, { name: 'company' })
      assert.equal((await collab.listMembers(boss.id, lobby.id)).length, ACTOR_COUNT)
      events.push(`broadcast:${Math.round(performance.now() - start)}ms`)

      // 1k group rooms, each owned by actor[i] with actor[i+1] as second member.
      const rooms: Room[] = []
      const roomOwnerIds: string[] = []
      for (let index = 0; index < ROOM_COUNT; index += 1) {
        const owner = actors[index % actors.length]
        const peer = actors[(index + 1) % actors.length]
        assert.ok(owner !== undefined && peer !== undefined)
        rooms.push(
          await collab.createGroupRoom(owner.id, { name: `room-${index}`, memberIds: [peer.id] }),
        )
        roomOwnerIds.push(owner.id)
      }
      events.push(`rooms:${Math.round(performance.now() - start)}ms`)

      // 100k messages: room i receives 100 messages from its owner (100 per batch of
      // batchSend, one transaction per batch, savepoint per item).
      let previousSeq = 0
      let previousRoomSeq = new Map<string, number>()
      for (let roomIndex = 0; roomIndex < ROOM_COUNT; roomIndex += 1) {
        const room = rooms[roomIndex]
        const senderId = roomOwnerIds[roomIndex]
        assert.ok(room !== undefined && senderId !== undefined)
        const sender = { id: senderId }
        const result = await collab.batchSend(
          sender.id,
          Array.from({ length: MESSAGES_PER_ROOM }, (_unused, messageIndex) => ({
            roomId: room.id,
            body: `message ${roomIndex}-${messageIndex}`,
          })),
        )
        for (const item of result.items) {
          assert.equal(item.status, 'ok')
          if (item.status !== 'ok') continue
          assert.ok(item.result.seq > previousSeq, 'global seq must be strictly increasing')
          previousSeq = item.result.seq
          const seen: number = previousRoomSeq.get(room.id) ?? 0
          assert.equal(item.result.roomSeq, seen + 1, 'room_seq must be contiguous')
          previousRoomSeq.set(room.id, item.result.roomSeq)
        }
      }
      events.push(`messages:${Math.round(performance.now() - start)}ms`)

      // Broadcast flood: 1k plain messages, no mentions, no replies.
      for (let offset = 0; offset < BROADCAST_TOTAL; offset += 100) {
        const count = Math.min(100, BROADCAST_TOTAL - offset)
        const result = await collab.batchSend(
          boss.id,
          Array.from({ length: count }, (_unused, index) => ({
            roomId: lobby.id,
            body: `broadcast ${offset + index}`,
          })),
        )
        assert.equal(result.items.every(item => item.status === 'ok'), true)
      }
      events.push(`broadcast-flood:${Math.round(performance.now() - start)}ms`)

      // --- the load-bearing fan-out assertions ------------------------------
      assert.equal(await store.countMessages(null), MESSAGE_TOTAL + BROADCAST_TOTAL)
      assert.equal(await store.countAllWakeItems(null), 0, 'broadcast/room messages must create zero wake rows')
      assert.equal(
        await store.countReadStatesForRoom(null, lobby.id),
        ACTOR_COUNT,
        'read_state rows are per actor, never per message',
      )
      const lobbyStats = await collab.getRoomStats(boss.id, lobby.id)
      assert.equal(lobbyStats.headRoomSeq, BROADCAST_TOTAL)
      assert.equal(lobbyStats.headSeq, MESSAGE_TOTAL + BROADCAST_TOTAL)

      // Sample rooms: stats heads and page contiguity.
      for (const roomIndex of [0, 1, Math.floor(ROOM_COUNT / 2), ROOM_COUNT - 1]) {
        const room = rooms[roomIndex]
        assert.ok(room !== undefined)
        const ownerId = roomOwnerIds[roomIndex] ?? boss.id
        const stats = await collab.getRoomStats(ownerId, room.id)
        assert.equal(stats.headRoomSeq, MESSAGES_PER_ROOM)
        const page = await collab.listMessages(ownerId, { roomId: room.id, limit: 200 })
        if (roomIndex === 0) {
          assert.equal(page.items.length, MESSAGES_PER_ROOM)
          assert.deepEqual(page.items.map(message => message.roomSeq), Array.from({ length: MESSAGES_PER_ROOM }, (_unused, index) => index + 1))
        }
      }

      // A sampled actor reads exactly the arithmetic, and has no wake items.
      const sample = actors[42]
      assert.ok(sample !== undefined)
      const digest = await collab.checkInbox(sample.id)
      assert.equal(digest.totals.rooms, 3) // lobby + own room + peer's room
      assert.equal(digest.totals.unread, BROADCAST_TOTAL + 2 * MESSAGES_PER_ROOM) // broadcast + two rooms
      assert.equal(digest.totals.pendingWakes, 0)
      assert.deepEqual(digest.pendingWakeIds, [])
      assert.equal(await store.countWakeItemsForActor(null, sample.id), 0)
      events.push(`assertions:${Math.round(performance.now() - start)}ms`)

      const elapsed = Math.round(performance.now() - start)
      t.diagnostic(`${backendName} stress elapsed: ${elapsed}ms; ${events.join(', ')}`)
      // Loose guard against accidental quadratic behaviour (not a perf benchmark).
      assert.ok(elapsed < 120_000, `stress run took ${elapsed}ms`)
    } finally {
      await harness.cleanup()
    }
  })
}
