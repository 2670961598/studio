/**
 * C-mini 测试：SQLite 持久化最小刀（Phase1 模块 C / P1-2 前半）。
 * 依据：docs/sentinel-logs/Phase1实现拆解-2026-11-17.md 模块 C（最小 rooms/messages/read；重启状态）。
 * 覆盖：schema 版本/幂等 init/降级拒绝、0600、append-only 触发器、写路径+hydrate 恢复（read 覆盖语义）、
 *       删行空洞后的水合（seq 计数器=已分配最大值，非 count——P1 wakeSeq 水合回退撞 UNIQUE 修复）、
 *       模式选择（WORKBENCH_CHATD_DB / --memory / 缺省内存）、子进程 SIGTERM 重启恢复、
 *       双连接并发顺序 + kill -9 崩溃恢复。
 * 运行：node --experimental-strip-types --test apps/workbench-chatd/test/store.nt.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ChatdStoreError, SCHEMA_VERSION, SqliteChatStore } from '../src/store/sqlite.ts'
import { createInitialState, type MockMessage, type MockRoom, type MockWake } from '../src/store/types.ts'
import { ChatdConfigError, loadConfig } from '../src/config.ts'
import { dispatch, type WakeDispatchOpts } from '../src/server.ts'
import { startChatd, type ChatdHandle } from './support/proc.ts'
import { connectNdjson, type RawClient, type WbFrame } from './support/ndjson.ts'

/** dispatch 租约参数（store 级直驱用；TTL 语义本身由 wake-hardening.nt.ts 覆盖）。 */
const OPTS: WakeDispatchOpts = { leaseTtlMs: 30_000 }

/**
 * 运维视角直写「删行空洞」库（P1 事故形状）：wakes 剩 wake-1/3/7（2/4/5/6 已清理）、
 * messages seq 1/5（2/3/4 缺号）、rooms 剩 room-1/4（2/3 已删）——count 口径水合会全面回退。
 */
function seedHoledStore(dbPath: string): void {
  const bootstrap = new SqliteChatStore(dbPath) // 幂等 init：只建 schema（v2），不写业务行
  bootstrap.close()
  const raw = new DatabaseSync(dbPath)
  raw.exec(`
    INSERT INTO rooms (room_id, kind, name, member_ids) VALUES
      ('room-1', 'group', 'g1', '["pm","dev"]'),
      ('room-4', 'group', 'g4', '["pm"]');
    INSERT INTO messages (message_id, seq, room_id, room_seq, sender_id, body, mentions, created_at) VALUES
      ('msg-1', 1, 'room-1', 1, 'pm', 'm1', '[]', 1700000000001),
      ('msg-5', 5, 'room-1', 2, 'pm', 'm5', '[]', 1700000000005);
    INSERT INTO wakes (wake_id, actor_id, room_id, source_seq, cause, status, claimed_by, claimed_until, created_at, acked_at) VALUES
      ('wake-1', 'dev', 'room-1', 1, 'mention', 'acked', NULL, NULL, 1700000000001, 1700000000002),
      ('wake-3', 'dev', 'room-1', 2, 'mention', 'acked', NULL, NULL, 1700000000005, 1700000000006),
      ('wake-7', 'dev', 'room-1', 2, 'mention', 'pending', NULL, NULL, 1700000000005, NULL);
  `)
  raw.close()
}

function tmpDbPath(prefix: string): { readonly dir: string; readonly dbPath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), `workbench-chatd-store-${prefix}-`))
  return { dir, dbPath: path.join(dir, 'chat.db') }
}

async function withClient<T>(h: ChatdHandle, run: (c: RawClient) => Promise<T>): Promise<T> {
  await h.waitReady()
  const c = await connectNdjson(h.socketPath)
  try {
    return await run(c)
  } finally {
    c.close()
  }
}

async function expectOk<T>(frame: WbFrame): Promise<T> {
  assert.equal(frame.ok, true, `期望 ok 响应：${JSON.stringify(frame)}`)
  return (frame as { ok: true; result: T }).result
}

// ─── store 单测：schema / init 幂等 / 0600 / append-only ──────────────────────

test('store 单测：schema 版本表 + init 幂等（重复打开不重放迁移）+ 文件 0600', () => {
  const { dir, dbPath } = tmpDbPath('schema')
  try {
    const store = new SqliteChatStore(dbPath)
    assert.equal(store.schemaVersion(), SCHEMA_VERSION)
    assert.equal(statSync(dbPath).mode & 0o777, 0o600, '数据库文件权限应为 0600')
    store.close()

    // 幂等 init：同库二次打开无错、版本不变、schema 对象不重复
    const reopened = new SqliteChatStore(dbPath)
    assert.equal(reopened.schemaVersion(), SCHEMA_VERSION, '重复 init 后版本仍为当前值')
    reopened.close()

    const raw = new DatabaseSync(dbPath)
    const count = (name: string): number => (raw.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name = ?").get(name) as { c: number }).c
    assert.equal(count('rooms'), 1)
    assert.equal(count('messages'), 1)
    assert.equal(count('wakes'), 1)
    assert.equal(count('read_cursors'), 1)
    assert.equal(count('idempotency'), 1)
    assert.equal(count('messages_append_only_no_update'), 1, 'append-only 触发器不因重复 init 翻倍')
    assert.equal(count('messages_append_only_no_delete'), 1)
    raw.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('store 单测：messages append-only——UPDATE/DELETE 被 schema 触发器 ABORT（机制保证）', () => {
  const { dir, dbPath } = tmpDbPath('append-only')
  try {
    const store = new SqliteChatStore(dbPath)
    const room: MockRoom = { roomId: 'room-1', kind: 'group', name: 'g', memberIds: ['pm', 'dev'], headRoomSeq: 1 }
    const message: MockMessage = { messageId: 'msg-1', seq: 1, roomSeq: 1, roomId: 'room-1', senderId: 'pm', body: 'm1', mentions: [], createdAt: 1_700_000_000_000 }
    store.insertRoom(room)
    store.appendMessage(message, [])
    store.close()

    const raw = new DatabaseSync(dbPath)
    assert.throws(() => { raw.prepare('UPDATE messages SET body = ? WHERE message_id = ?').run('hacked', 'msg-1') }, /append-only/)
    assert.throws(() => { raw.prepare('DELETE FROM messages WHERE message_id = ?').run('msg-1') }, /append-only/)
    const kept = raw.prepare('SELECT body FROM messages WHERE message_id = ?').get('msg-1') as { body: string }
    assert.equal(kept.body, 'm1', '原行不受触发器 ABORT 影响')
    raw.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('store 单测：写路径落库 + 重开 hydrate 恢复（含 read 覆盖写、wake 状态、幂等记录、seq 计数器）', () => {
  const { dir, dbPath } = tmpDbPath('hydrate')
  try {
    const store = new SqliteChatStore(dbPath)
    const room: MockRoom = { roomId: 'room-1', kind: 'group', name: 'g', memberIds: ['pm', 'dev'], headRoomSeq: 2 }
    store.insertRoom(room)
    const m1: MockMessage = { messageId: 'msg-1', seq: 1, roomSeq: 1, roomId: 'room-1', senderId: 'pm', body: 'm1', mentions: [], createdAt: 1_700_000_000_001 }
    const m2: MockMessage = { messageId: 'msg-2', seq: 2, roomSeq: 2, roomId: 'room-1', senderId: 'pm', body: '@dev m2', mentions: ['dev'], createdAt: 1_700_000_000_002 }
    const wake: MockWake = { wakeId: 'wake-1', actorId: 'dev', roomId: 'room-1', sourceSeq: 2, cause: 'mention', status: 'pending', claimedBy: null, claimedUntil: null, createdAt: 1_700_000_000_002, ackedAt: null }
    store.appendMessage(m1, [])
    store.appendMessage(m2, [wake])
    store.setRead('dev', 'room-1', 1)
    store.setRead('dev', 'room-1', 3) // 覆盖写（upsert 同键）
    store.setRead('pm', 'room-1', 2)
    const claimed: MockWake = { ...wake, status: 'claimed', claimedBy: 'dev', claimedUntil: 1_700_000_030_000 }
    store.updateWake(claimed)
    store.recordIdempotency('send:pm|room-1|k1', { seq: 2, roomSeq: 2, messageId: 'msg-2', replayed: false })
    store.close()

    // 「重启」：新 store 实例 hydrate 全新状态
    const reopened = new SqliteChatStore(dbPath)
    const state = createInitialState()
    reopened.hydrate(state)
    reopened.close()

    assert.deepEqual([...state.rooms.keys()], ['room-1'])
    assert.deepEqual(state.rooms.get('room-1'), room)
    assert.deepEqual(state.messages, [m1, m2], 'messages 按 seq 恢复且不更新不删除')
    assert.deepEqual(state.wakes, [claimed], 'wake 状态（claim 覆盖写）随重启恢复')
    assert.equal(state.reads.get('dev|room-1'), 3, 'read 游标为最后一次覆盖值')
    assert.equal(state.reads.get('pm|room-1'), 2)
    assert.deepEqual(state.idempotency.get('send:pm|room-1|k1'), { seq: 2, roomSeq: 2, messageId: 'msg-2', replayed: false }, '幂等记录随重启恢复')
    assert.equal(state.roomSeq, 1, 'roomSeq 计数器恢复')
    assert.equal(state.msgSeq, 2, 'msgSeq 计数器恢复（续增无空洞）')
    assert.equal(state.wakeSeq, 1, 'wakeSeq 计数器恢复')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('store 单测：删行空洞后的水合——seq 计数器取已分配最大值而非 count（wake-1/3/7→wakeSeq=7；seq 1/5→msgSeq=5；room-1/4→roomSeq=4），新分配不撞 UNIQUE', () => {
  const { dir, dbPath } = tmpDbPath('holes')
  try {
    seedHoledStore(dbPath)

    // 「重启」水合：count 口径会回退（wakes 3 条→wake-4 复用已删号、rooms 2 条→room-3 复用已删号）
    const reopened = new SqliteChatStore(dbPath)
    const state = createInitialState()
    try {
      reopened.hydrate(state)
      assert.equal(state.wakeSeq, 7, 'wakeSeq=wake-N 数值后缀 max（count=3 会回退生成 wake-4）')
      assert.equal(state.msgSeq, 5, 'msgSeq=MAX(seq)（seq 1/5 有空洞也不回退）')
      assert.equal(state.roomSeq, 4, 'roomSeq=room-N 数值后缀 max（count=2 会回退生成 room-3）')
      assert.equal(state.rooms.get('room-1')?.headRoomSeq, 2, 'headRoomSeq=每房 MAX(room_seq) 投影')

      // 新分配接 max 续增不撞库内残余 id（P1 事故：修复前新 wake-4 撞 UNIQUE → messages.send 500）
      const sent = dispatch(state, reopened, 'messages.send', { roomId: 'room-1', senderId: 'pm', body: '@dev m6', mentions: ['dev'] }, OPTS) as { seq: number; roomSeq: number }
      assert.equal(sent.seq, 6, '新消息 seq=MAX(seq)+1=6')
      assert.equal(sent.roomSeq, 3, '新消息 roomSeq=head+1=3')
      assert.equal(state.wakes[state.wakes.length - 1]?.wakeId, 'wake-8', '新 wake=max 后缀 7+1=wake-8（非 count 口径的 wake-4）')
      const room = dispatch(state, reopened, 'rooms.create', { kind: 'group', name: 'g5', memberIds: ['pm'] }, OPTS) as { roomId: string }
      assert.equal(room.roomId, 'room-5', '新房间=max 后缀 4+1=room-5')
    } finally {
      reopened.close()
    }

    // 再重启：新写入已落库且计数器继续按 max 续增（wake-8 / msg seq 6 / room-5 均在库）
    const third = new SqliteChatStore(dbPath)
    const state2 = createInitialState()
    try {
      third.hydrate(state2)
      assert.deepEqual(state2.wakes.map((w) => w.wakeId), ['wake-1', 'wake-3', 'wake-7', 'wake-8'], '新增 wake-8 已持久化')
      assert.equal(state2.wakeSeq, 8)
      assert.equal(state2.msgSeq, 6)
      assert.equal(state2.roomSeq, 5)
    } finally {
      third.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('store 单测：库 schema 版本高于程序 → 拒绝降级启动', () => {
  const { dir, dbPath } = tmpDbPath('downgrade')
  try {
    const store = new SqliteChatStore(dbPath)
    store.close()
    const raw = new DatabaseSync(dbPath)
    raw.prepare("INSERT INTO chatd_meta (key, value) VALUES ('schema_version', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(String(SCHEMA_VERSION + 98))
    raw.close()
    assert.throws(() => { new SqliteChatStore(dbPath) }, (err: unknown) => {
      assert.ok(err instanceof ChatdStoreError)
      assert.match(err.message, /拒绝降级启动/)
      return true
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ─── config 单测：模式选择 ────────────────────────────────────────────────────

test('config 单测：缺省 memory；WORKBENCH_CHATD_DB 绝对路径→sqlite；相对路径拒启；--memory 强制优先', () => {
  const argv = ['/node', '/main.ts']
  const base = { WORKBENCH_CHATD_ALLOW_NO_AUTH: '1' } as Record<string, string>

  const memory = loadConfig(base, argv)
  assert.equal(memory.storeMode, 'memory')
  assert.equal(memory.dbPath, undefined, '缺省不落库（P1-1b 内存 mock 向后兼容）')

  const sqlite = loadConfig({ ...base, WORKBENCH_CHATD_DB: '/tmp/x/chat.db' }, argv)
  assert.equal(sqlite.storeMode, 'sqlite')
  assert.equal(sqlite.dbPath, '/tmp/x/chat.db')

  assert.throws(() => { loadConfig({ ...base, WORKBENCH_CHATD_DB: 'relative/chat.db' }, argv) }, (err: unknown) => {
    assert.ok(err instanceof ChatdConfigError)
    assert.match(err.message, /WORKBENCH_CHATD_DB/)
    return true
  })

  const forced = loadConfig({ ...base, WORKBENCH_CHATD_DB: '/tmp/x/chat.db' }, ['/node', '/main.ts', '--memory'])
  assert.equal(forced.storeMode, 'memory', '--memory 显式强制内存（优先于 env）')
  assert.equal(forced.dbPath, undefined)
})

// ─── e2e（子进程 + 真 socket）：重启恢复 / 并发顺序 / --memory ────────────────

test('e2e：SQLite 模式——send/read/ack 落库，SIGTERM 重启后 rooms/messages/read/inbox/幂等全恢复', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'workbench-chatd-e2e-restart-'))
  const dbPath = path.join(dir, 'chat.db')
  const socketPath = path.join(dir, 'chat.sock')
  const env = { WORKBENCH_CHATD_DB: dbPath }
  let sentMessageId = ''
  try {
    const first = await startChatd({ env, dir, socketPath })
    try {
      await withClient(first, async (c) => {
        const health = await expectOk<{ server: string }>(await c.call('health'))
        assert.match(health.server, /\+sqlite$/, 'health server 应带 +sqlite 模式标记')
        const room = await expectOk<{ roomId: string }>(await c.call('rooms.create', { kind: 'group', name: 'g', memberIds: ['pm', 'dev'] }))
        await c.call('messages.send', { roomId: room.roomId, senderId: 'pm', body: 'm1' })
        const sent = await expectOk<{ messageId: string; seq: number }>(
          await c.call('messages.send', { roomId: room.roomId, senderId: 'pm', body: '@dev m2', mentions: ['dev'], idempotencyKey: 'send-2' }),
        )
        await c.call('messages.send', { roomId: room.roomId, senderId: 'pm', body: 'm3' })
        const read = await expectOk<{ lastReadRoomSeq: number; unread: number }>(
          await c.call('read', { roomId: room.roomId, actorId: 'dev', upToRoomSeq: 2, idempotencyKey: 'read-1' }),
        )
        assert.equal(read.lastReadRoomSeq, 2)
        const inbox = await expectOk<{ pendingWakeIds: string[]; unread: number }>(await c.call('inbox', { actorId: 'dev' }))
        const wakeId = inbox.pendingWakeIds[0]
        assert.ok(wakeId !== undefined)
        await c.call('wakes.claim', { actorId: 'dev', wakeIds: [wakeId], idempotencyKey: 'claim-1' })
        await c.call('wakes.ack', { actorId: 'dev', wakeIds: [wakeId], idempotencyKey: 'ack-1' })
        assert.equal(statSync(dbPath).mode & 0o777, 0o600, '数据库文件权限 0600')
        sentMessageId = sent.messageId
      })
      first.sigterm()
      const exit = await first.waitExit()
      assert.equal(exit.code, 0, 'SIGTERM 优雅退出（含 store.close）')

      // 同 DB 重启：状态全恢复
      const second = await startChatd({ env, dir, socketPath })
      try {
        await withClient(second, async (c) => {
          const health = await expectOk<{ server: string }>(await c.call('health'))
          assert.match(health.server, /\+sqlite$/)
          const rooms = await expectOk<{ roomId: string; name: string; memberIds: string[] }[]>(await c.call('rooms.list'))
          assert.equal(rooms.length, 1)
          assert.equal(rooms[0]?.name, 'g')
          assert.deepEqual(rooms[0]?.memberIds, ['pm', 'dev'])

          const page = await expectOk<{ items: { seq: number; roomSeq: number; body: string }[] }>(
            await c.call('messages.list', { roomId: rooms[0]?.roomId ?? '', actorId: 'dev', limit: 50 }),
          )
          assert.deepEqual(page.items.map((m) => m.body), ['m1', '@dev m2', 'm3'], 'messages 重启恢复且顺序不变')
          assert.deepEqual(page.items.map((m) => m.roomSeq), [1, 2, 3])

          const reread = await expectOk<{ lastReadRoomSeq: number; unread: number }>(
            await c.call('read', { roomId: rooms[0]?.roomId ?? '', actorId: 'dev', upToRoomSeq: 1 }),
          )
          assert.equal(reread.lastReadRoomSeq, 2, 'read 游标恢复且单调不回退（覆盖语义一致）')
          assert.equal(reread.unread, 1)

          const inboxAfter = await expectOk<{ pendingWakeIds: string[]; unread: number; mentions: number }>(await c.call('inbox', { actorId: 'dev' }))
          assert.deepEqual(inboxAfter.pendingWakeIds, [], 'ack 状态随重启恢复（wake 不再 pending）')
          assert.equal(inboxAfter.unread, 1)

          const replay = await expectOk<{ replayed: boolean; messageId: string }>(
            await c.call('messages.send', { roomId: rooms[0]?.roomId ?? '', senderId: 'pm', body: '@dev m2', mentions: ['dev'], idempotencyKey: 'send-2' }),
          )
          assert.equal(replay.replayed, true, '幂等记录随重启恢复：同键 replay')
          assert.equal(replay.messageId, sentMessageId)
          const afterReplay = await expectOk<{ items: object[] }>(await c.call('messages.list', { roomId: rooms[0]?.roomId ?? '', actorId: 'dev', limit: 50 }))
          assert.equal(afterReplay.items.length, 3, 'replay 不新增消息')

          const next = await expectOk<{ seq: number; roomSeq: number }>(
            await c.call('messages.send', { roomId: rooms[0]?.roomId ?? '', senderId: 'pm', body: 'm4' }),
          )
          assert.equal(next.seq, 4, 'seq 计数器恢复后续增')
          assert.equal(next.roomSeq, 4)
        })
      } finally {
        await second.cleanup()
      }
    } finally {
      await first.cleanup()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('e2e：并发与顺序——双连接并行 16 发送 seq 稠密唯一；kill -9 后同 DB 恢复不丢', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'workbench-chatd-e2e-concurrent-'))
  const dbPath = path.join(dir, 'chat.db')
  const socketPath = path.join(dir, 'chat.sock')
  const env = { WORKBENCH_CHATD_DB: dbPath }
  try {
    const first = await startChatd({ env, dir, socketPath })
    try {
      await withClient(first, async (c) => {
        const room = await expectOk<{ roomId: string }>(await c.call('rooms.create', { kind: 'group', name: 'g', memberIds: ['a', 'b'] }))
        const roomId = room.roomId
        c.close()
        const c1 = await connectNdjson(socketPath)
        const c2 = await connectNdjson(socketPath)
        try {
          const sends = await Promise.all([
            ...Array.from({ length: 8 }, (_, i) => c1.call('messages.send', { roomId, senderId: 'a', body: `c1-${String(i)}` })),
            ...Array.from({ length: 8 }, (_, i) => c2.call('messages.send', { roomId, senderId: 'b', body: `c2-${String(i)}` })),
          ])
          assert.equal(sends.filter((f) => f.ok).length, 16, '并发发送全部成功')
          const page = await expectOk<{ items: { seq: number; roomSeq: number; body: string }[]; hasMore: boolean }>(
            await c1.call('messages.list', { roomId, actorId: 'a', limit: 200 }),
          )
          assert.equal(page.items.length, 16)
          assert.equal(page.hasMore, false)
          assert.deepEqual(page.items.map((m) => m.seq), Array.from({ length: 16 }, (_, i) => i + 1), '全局 seq 稠密唯一（1..16）')
          assert.deepEqual(page.items.map((m) => m.roomSeq), Array.from({ length: 16 }, (_, i) => i + 1), '房间内 roomSeq 稠密唯一')
          assert.equal(new Set(page.items.map((m) => m.body)).size, 16)
        } finally {
          c1.close()
          c2.close()
        }
      })
      first.kill9() // 崩溃路径：无优雅 store.close，靠 SQLite 原子提交
      const crashed = await first.waitExit()
      assert.equal(crashed.signal, 'SIGKILL')

      const second = await startChatd({ env, dir, socketPath })
      try {
        await withClient(second, async (c) => {
          const rooms = await expectOk<{ roomId: string }[]>(await c.call('rooms.list'))
          const page = await expectOk<{ items: { seq: number }[] }>(
            await c.call('messages.list', { roomId: rooms[0]?.roomId ?? '', actorId: 'a', limit: 200 }),
          )
          assert.equal(page.items.length, 16, 'kill -9 后 16 条全恢复（无丢失）')
          const next = await expectOk<{ seq: number }>(await c.call('messages.send', { roomId: rooms[0]?.roomId ?? '', senderId: 'b', body: 'after-crash' }))
          assert.equal(next.seq, 17, '崩溃恢复后计数器续增')
        })
      } finally {
        await second.cleanup()
      }
    } finally {
      await first.cleanup()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('e2e：--memory 强制内存模式——env 配了 DB 也不落库，重启即空（向后兼容）', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'workbench-chatd-e2e-memory-'))
  const dbPath = path.join(dir, 'chat.db')
  const socketPath = path.join(dir, 'chat.sock')
  const env = { WORKBENCH_CHATD_DB: dbPath }
  try {
    const first = await startChatd({ env, dir, socketPath, args: ['--memory'] })
    try {
      await withClient(first, async (c) => {
        const health = await expectOk<{ server: string }>(await c.call('health'))
        assert.match(health.server, /\+mock$/, '--memory 下仍为 mock 模式')
        const room = await expectOk<{ roomId: string }>(await c.call('rooms.create', { kind: 'group', name: 'g', memberIds: ['pm', 'dev'] }))
        await c.call('messages.send', { roomId: room.roomId, senderId: 'pm', body: 'm1' })
      })
      first.sigterm()
      const exit = await first.waitExit()
      assert.equal(exit.code, 0)
      assert.equal(existsSync(dbPath), false, '--memory 强制内存：DB 文件根本不创建')

      const second = await startChatd({ env, dir, socketPath, args: ['--memory'] })
      try {
        await withClient(second, async (c) => {
          const rooms = await expectOk<{ roomId: string }[]>(await c.call('rooms.list'))
          assert.deepEqual(rooms, [], '内存模式重启即空（P1-1b 原语义）')
        })
      } finally {
        await second.cleanup()
      }
    } finally {
      await first.cleanup()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('e2e：删行空洞库重启（P1 事故复现）——wakes 清理后剩 wake-1/3/7 + messages seq 1/5，mention 发送不 500，新 wake=wake-8、新消息 seq=6', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'workbench-chatd-e2e-holes-'))
  const dbPath = path.join(dir, 'chat.db')
  const socketPath = path.join(dir, 'chat.sock')
  const env = { WORKBENCH_CHATD_DB: dbPath }
  try {
    seedHoledStore(dbPath)

    const h = await startChatd({ env, dir, socketPath })
    try {
      await withClient(h, async (c) => {
        // 修复前：wakeSeq 水合为 count(3) → 新建 wake-4 撞库内 UNIQUE 约束 → messages.send 500（WB_INTERNAL）
        const sent = await expectOk<{ seq: number; roomSeq: number; messageId: string }>(
          await c.call('messages.send', { roomId: 'room-1', senderId: 'pm', body: '@dev m6', mentions: ['dev'] }),
        )
        assert.equal(sent.seq, 6, '新消息 seq=MAX(seq)+1=6')
        assert.equal(sent.roomSeq, 3, '新消息 roomSeq=head+1=3')

        const inbox = await expectOk<{ pendingWakeIds: string[] }>(await c.call('inbox', { actorId: 'dev' }))
        assert.deepEqual(inbox.pendingWakeIds, ['wake-7', 'wake-8'], '新 wake=wake-8（max 后缀续增）；残留 pending wake-7 照常可见')

        await c.call('wakes.claim', { actorId: 'dev', wakeIds: ['wake-8'] })
        await c.call('wakes.ack', { actorId: 'dev', wakeIds: ['wake-8'] })

        const room = await expectOk<{ roomId: string }>(await c.call('rooms.create', { kind: 'group', name: 'g5', memberIds: ['pm'] }))
        assert.equal(room.roomId, 'room-5', '新房间=max 后缀 4+1=room-5（count 口径会回退 room-3）')
      })
    } finally {
      await h.cleanup()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
