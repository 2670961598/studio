import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ChatService } from '../src/service.ts'
import { MemoryChatStore } from '../src/memory-store.ts'
import { SqliteChatStore } from '../src/sqlite-store.ts'
import type { ChatStore } from '../src/store.ts'
import { backends, createActor, expectCode, makeClock, setupFixture } from './helpers.ts'

/** Port-call counting proxy: proves "one IN query, not N+1" at the service boundary. */
function countingStore(inner: ChatStore): { store: ChatStore; count: (method: string) => number } {
  const counts = new Map<string, number>()
  const proxy = new Proxy(inner, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown
      if (typeof property === 'string' && typeof value === 'function') {
        return (...args: unknown[]) => {
          counts.set(property, (counts.get(property) ?? 0) + 1)
          return (value as (...innerArgs: unknown[]) => unknown).apply(target, args)
        }
      }
      return value
    },
  }) as ChatStore
  return { store: proxy, count: method => counts.get(method) ?? 0 }
}

interface Instrumented {
  collab: ChatService
  store: ChatStore
  count: (method: string) => number
  cleanup: () => Promise<void>
}

async function instrumented(backendName: string): Promise<Instrumented> {
  if (backendName === 'memory') {
    const inner = new MemoryChatStore()
    const counted = countingStore(inner)
    const clock = makeClock()
    return {
      collab: new ChatService(counted.store, { now: clock.now }),
      store: inner,
      count: counted.count,
      cleanup: async () => {
        await inner.close()
      },
    }
  }
  const dir = mkdtempSync(join(tmpdir(), 'collab-batch-'))
  const inner = new SqliteChatStore(join(dir, 'chat.sqlite'))
  const counted = countingStore(inner)
  const clock = makeClock()
  return {
    collab: new ChatService(counted.store, { now: clock.now }),
    store: inner,
    count: counted.count,
    cleanup: async () => {
      await inner.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

for (const backend of backends) {
  test(`[${backend.name}] batchSend rejects over-limit batches before any I/O`, async () => {
    const harness = await instrumented(backend.name)
    try {
      const a = await createActor(harness.collab, 'a')
      const b = await createActor(harness.collab, 'b')
      const room = await harness.collab.createGroupRoom(a.id, { name: 'room', memberIds: [b.id] })
      const transactionsBefore = harness.count('transaction')
      const items = Array.from({ length: 101 }, (_unused, index) => ({ roomId: room.id, body: `m-${index}` }))
      await expectCode(() => harness.collab.batchSend(a.id, items), 'VALIDATION_FAILED')
      assert.equal(harness.count('transaction'), transactionsBefore)
      assert.equal(await harness.store.countMessages(null), 0)
      const empty = await harness.collab.batchSend(a.id, [])
      assert.deepEqual(empty, { items: [] })
    } finally {
      await harness.cleanup()
    }
  })

  test(`[${backend.name}] batchSend returns per-item results and isolates failures`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab, store } = fixture.harness
      const result = await collab.batchSend(fixture.alice.id, [
        { roomId: fixture.room.id, body: 'ok one' },
        { roomId: 'missing-room', body: 'bad room' },
        { roomId: fixture.room.id, body: 'bad mention', mentions: [fixture.carol.id] },
        { roomId: fixture.room.id, body: 'ok two' },
      ])
      assert.deepEqual(
        result.items.map(item => [item.index, item.status]),
        [
          [0, 'ok'],
          [1, 'error'],
          [2, 'error'],
          [3, 'ok'],
        ],
      )
      const failures = result.items.filter(item => item.status === 'error')
      assert.deepEqual(
        failures.map(item => (item.status === 'error' ? item.error.code : '')),
        ['ROOM_NOT_FOUND', 'MENTION_NOT_MEMBER'],
      )
      assert.equal(await store.countMessages(null), 2)
      assert.equal((await collab.listMessages(fixture.bob.id, { roomId: fixture.room.id })).items.length, 2)
    } finally {
      await fixture.harness.cleanup()
    }
  })

  test(`[${backend.name}] batchSend is one transaction with a savepoint per item`, async () => {
    const harness = await instrumented(backend.name)
    try {
      const a = await createActor(harness.collab, 'a')
      const b = await createActor(harness.collab, 'b')
      const room = await harness.collab.createGroupRoom(a.id, { name: 'room', memberIds: [b.id] })
      const transactionsBefore = harness.count('transaction')
      const appendBefore = harness.count('appendMessage')
      const result = await harness.collab.batchSend(
        a.id,
        Array.from({ length: 20 }, (_unused, index) => ({ roomId: room.id, body: `item ${index}` })),
      )
      assert.equal(result.items.length, 20)
      assert.equal(result.items.every(item => item.status === 'ok'), true)
      assert.equal(harness.count('transaction') - transactionsBefore, 1)
      assert.equal(harness.count('appendMessage') - appendBefore, 20)
      // No per-item batch read/command lookups.
      assert.equal(harness.count('getCommand'), 0)
    } finally {
      await harness.cleanup()
    }
  })

  test(`[${backend.name}] batchSend item with body-supplied principal fails alone`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab, store } = fixture.harness
      const spoofed = {
        roomId: fixture.room.id,
        body: 'spoof',
        senderId: fixture.bob.id,
      } as never
      const result = await collab.batchSend(fixture.alice.id, [
        { roomId: fixture.room.id, body: 'legit' },
        spoofed,
      ])
      assert.equal(result.items[0]?.status, 'ok')
      assert.equal(result.items[1]?.status, 'error')
      assert.equal(
        result.items[1]?.status === 'error' ? result.items[1].error.code : '',
        'PRINCIPAL_MISMATCH',
      )
      assert.equal(await store.countMessages(null), 1)
    } finally {
      await fixture.harness.cleanup()
    }
  })

  test(`[${backend.name}] getMessages is bounded, ordered and reports missing ids`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab } = fixture.harness
      const messages = []
      for (let index = 0; index < 10; index += 1) {
        messages.push(await collab.sendMessage(fixture.alice.id, { roomId: fixture.room.id, body: `m${index}` }))
      }
      const target = messages[2]
      assert.ok(target !== undefined)
      const first = messages[0]
      assert.ok(first !== undefined)
      const result = await collab.getMessages(fixture.bob.id, {
        roomId: fixture.room.id,
        seqs: [target.seq, first.seq, first.seq, 999_999],
      })
      assert.deepEqual(result.items.map(message => message.seq), [first.seq, target.seq])
      assert.deepEqual(result.missing, [999_999])
      assert.equal(result.items[0]?.body, 'm0')

      await expectCode(
        () => collab.getMessages(fixture.bob.id, { roomId: fixture.room.id, seqs: [0] }),
        'VALIDATION_FAILED',
      )
      await expectCode(
        () =>
          collab.getMessages(fixture.bob.id, {
            roomId: fixture.room.id,
            seqs: Array.from({ length: 501 }, (_unused, index) => index + 1),
          }),
        'VALIDATION_FAILED',
      )
      await expectCode(
        () => collab.getMessages(fixture.carol.id, { roomId: fixture.room.id, seqs: [first.seq] }),
        'ROOM_NOT_FOUND',
      )
    } finally {
      await fixture.harness.cleanup()
    }
  })

  test(`[${backend.name}] getMessages: one port call for the whole id set (no N+1)`, async () => {
    const harness = await instrumented(backend.name)
    try {
      const a = await createActor(harness.collab, 'a')
      const b = await createActor(harness.collab, 'b')
      const room = await harness.collab.createGroupRoom(a.id, { name: 'room', memberIds: [b.id] })
      const sends = []
      for (let round = 0; round < 2; round += 1) {
        sends.push(
          await harness.collab.batchSend(
            a.id,
            Array.from({ length: 100 }, (_unused, index) => ({ roomId: room.id, body: `m-${round}-${index}` })),
          ),
        )
      }
      const seqs = sends
        .flatMap(batch => batch.items)
        .map(item => (item.status === 'ok' ? item.result.seq : 0))
        .filter(seq => seq > 0)
      assert.equal(seqs.length, 200)
      const callsBefore = harness.count('getMessagesBySeqs')
      const result = await harness.collab.getMessages(a.id, { roomId: room.id, seqs })
      assert.equal(result.items.length, 200)
      assert.equal(harness.count('getMessagesBySeqs') - callsBefore, 1)
      assert.equal(harness.count('getMessageBySeqInRoom'), 0)
    } finally {
      await harness.cleanup()
    }
  })

  test(`[${backend.name}] ackDelivery is a bounded batch with per-item results`, async () => {
    const fixture = await setupFixture(backend)
    try {
      const { collab, store } = fixture.harness
      const wakeIds = []
      for (let index = 0; index < 3; index += 1) {
        await collab.sendMessage(fixture.alice.id, {
          roomId: fixture.room.id,
          body: `ping ${index}`,
          mentions: [fixture.bob.id],
        })
      }
      const digest = await collab.checkInbox(fixture.bob.id)
      assert.equal(digest.pendingWakeIds.length, 3)
      wakeIds.push(...digest.pendingWakeIds)
      const firstWake = wakeIds[0]
      const secondWake = wakeIds[1]
      assert.ok(firstWake !== undefined)
      assert.ok(secondWake !== undefined)
      await collab.ackDelivery(fixture.bob.id, { wakeIds: [firstWake] })
      const result = await collab.ackDelivery(fixture.bob.id, {
        wakeIds: [firstWake, secondWake, 'never-existed'],
      })
      assert.deepEqual(result.acked, [secondWake])
      assert.deepEqual(result.alreadyAcked, [firstWake])
      assert.deepEqual(result.failed, [{ wakeId: 'never-existed', code: 'WAKE_NOT_FOUND' }])
      assert.equal((await collab.checkInbox(fixture.bob.id)).totals.pendingWakes, 1)
      assert.equal(await store.countAllWakeItems(null), 3)

      await expectCode(
        () =>
          collab.ackDelivery(fixture.bob.id, {
            wakeIds: Array.from({ length: 101 }, (_unused, index) => `w-${index}`),
          }),
        'VALIDATION_FAILED',
      )
    } finally {
      await fixture.harness.cleanup()
    }
  })
}
