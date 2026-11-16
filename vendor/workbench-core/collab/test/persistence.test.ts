import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { createSqliteCollab } from '../src/index.ts'
import { expectCode } from './helpers.ts'

function tempDb(): { dir: string; path: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'collab-persist-'))
  return {
    dir,
    path: join(dir, 'chat.sqlite'),
    done: () => rmSync(dir, { recursive: true, force: true }),
  }
}

test('[persistence] messages, read cursor, wakes and command log survive a reopen', async () => {
  const db = tempDb()
  try {
    const first = createSqliteCollab(db.path, { now: () => 1_000 })
    const a = await first.createActor({ id: 'a', kind: 'human', name: 'a' })
    const b = await first.createActor({ id: 'b', kind: 'agent', name: 'b' })
    const room = await first.createGroupRoom(a.id, { name: 'room', memberIds: [b.id] })
    const mention = await first.sendMessage(a.id, {
      roomId: room.id,
      body: 'persisted mention',
      mentions: [b.id],
      idempotencyKey: 'persist-key',
    })
    await first.sendMessage(a.id, { roomId: room.id, body: 'ambient' })
    await first.markRead(b.id, { roomId: room.id, upToRoomSeq: 1 })
    await first.close()

    const second = createSqliteCollab(db.path, { now: () => 2_000 })
    const digest = await second.checkInbox(b.id)
    assert.equal(digest.pendingWakeIds.length, 1)
    assert.equal(digest.mentions.length, 0, 'read cursor advanced before the reopen')
    assert.equal(digest.totals.unread, 1)
    const [wake] = await second.getWakeState(b.id, { wakeIds: digest.pendingWakeIds })
    assert.equal(wake?.cause, 'mention')
    assert.equal(wake?.sourceSeq, mention.seq)

    const readState = await second.getReadState(b.id, room.id)
    assert.equal(readState.lastReadRoomSeq, 1)

    const replay = await second.sendMessage(a.id, {
      roomId: room.id,
      body: 'persisted mention',
      mentions: [b.id],
      idempotencyKey: 'persist-key',
    })
    assert.equal(replay.replayed, true)
    assert.equal(replay.seq, mention.seq)
    assert.deepEqual((await second.listMessages(b.id, { roomId: room.id })).items.length, 2)

    const ack = await second.ackDelivery(b.id, { wakeIds: digest.pendingWakeIds })
    assert.deepEqual(ack.acked, digest.pendingWakeIds)
    await second.close()
  } finally {
    db.done()
  }
})

test('[persistence] global seq and per-room room_seq continue after reopen', async () => {
  const db = tempDb()
  try {
    const first = createSqliteCollab(db.path)
    const a = await first.createActor({ id: 'a', kind: 'agent', name: 'a' })
    const b = await first.createActor({ id: 'b', kind: 'agent', name: 'b' })
    const room = await first.createGroupRoom(a.id, { name: 'room', memberIds: [b.id] })
    const m1 = await first.sendMessage(a.id, { roomId: room.id, body: '1' })
    const m2 = await first.sendMessage(a.id, { roomId: room.id, body: '2' })
    await first.close()

    const second = createSqliteCollab(db.path)
    const m3 = await second.sendMessage(a.id, { roomId: room.id, body: '3' })
    const m4 = await second.sendMessage(a.id, { roomId: room.id, body: '4' })
    assert.deepEqual([m1.roomSeq, m2.roomSeq, m3.roomSeq, m4.roomSeq], [1, 2, 3, 4])
    assert.deepEqual([m1.seq, m2.seq, m3.seq, m4.seq], [
      m1.seq,
      m2.seq,
      m2.seq + 1,
      m2.seq + 2,
    ])
    const stats = await second.getRoomStats(a.id, room.id)
    assert.equal(stats.headRoomSeq, 4)
    await second.close()
  } finally {
    db.done()
  }
})

test('[persistence] opaque pagination cursor remains valid across a reopen', async () => {
  const db = tempDb()
  try {
    const first = createSqliteCollab(db.path)
    const a = await first.createActor({ id: 'a', kind: 'agent', name: 'a' })
    const b = await first.createActor({ id: 'b', kind: 'agent', name: 'b' })
    const room = await first.createGroupRoom(a.id, { name: 'room', memberIds: [b.id] })
    for (let index = 0; index < 5; index += 1) {
      await first.sendMessage(a.id, { roomId: room.id, body: `m${index}` })
    }
    const page1 = await first.listMessages(b.id, { roomId: room.id, limit: 2 })
    assert.equal(page1.items.length, 2)
    await first.close()

    const second = createSqliteCollab(db.path)
    const page2 = await second.listMessages(b.id, {
      roomId: room.id,
      limit: 2,
      cursor: page1.nextCursor ?? '',
    })
    assert.deepEqual(page2.items.map(message => message.roomSeq), [3, 4])
    await second.close()
  } finally {
    db.done()
  }
})

test('[persistence] adapter refuses a schema from the future or an unsupported past', async () => {
  for (const version of [999, 1]) {
    const db = tempDb()
    try {
      const raw = new DatabaseSync(db.path)
      raw.exec(`PRAGMA user_version = ${version}`)
      raw.close()
      await expectCode(
        () => Promise.resolve().then(() => createSqliteCollab(db.path)),
        'SCHEMA_TOO_NEW',
      )
    } finally {
      db.done()
    }
  }
})

test('[persistence] adapter-local: WAL mode, one migration row, idempotent re-open', async () => {
  const db = tempDb()
  try {
    const first = createSqliteCollab(db.path)
    await first.createActor({ id: 'a', kind: 'agent', name: 'a' })
    await first.close()

    const raw = new DatabaseSync(db.path)
    const journal = raw.prepare('PRAGMA journal_mode').get() as { journal_mode?: string } | undefined
    assert.equal(journal?.journal_mode, 'wal')
    const version = raw.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
    assert.equal(Number(version?.user_version), 2)
    const migrations = raw
      .prepare('SELECT version FROM schema_migrations ORDER BY version ASC')
      .all() as unknown as Array<{ version: number }>
    assert.deepEqual(migrations.map(row => Number(row.version)), [2])
    raw.close()

    const second = createSqliteCollab(db.path)
    const actor = await second.getActor('a')
    assert.equal(actor?.id, 'a')
    await second.close()
  } finally {
    db.done()
  }
})
