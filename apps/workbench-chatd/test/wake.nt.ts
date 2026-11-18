/**
 * P1-2 wake lease 最小刀测试（Phase1 模块 C 后半）。
 * 依据：docs/sentinel-logs/Phase1实现拆解-2026-11-17.md 模块 C（wake_lease/wake_delivery
 *       TTL/重试≤3/dead-letter；append-only 审计）＋ §三验收点（lease 过期/重试/dead-letter/
 *       ack 幂等/审计追加/重启状态/并发唯一）；docs/sentinel-logs/提案-Phase1聊天服务-2026-11-17.md。
 * 覆盖：v1→v2 迁移回填、审计 append-only 触发器、claim 幂等（同 lease）、TTL 过期重投、
 *       重试上限→dead-letter（稳定错误+审计封口；C2.1 加固：dead 后 ack 拒绝、审计零新增）、
 *       ack 幂等、审计只追加、重启租约恢复（含 dead 跨重启）、
 *       并发 claim 唯一、内存模式租约语义（向后兼容）、真客户端（WorkbenchTransport）wake 契约。
 *       （时钟注入/手动推进的零 sleep 覆盖见 test/wake-hardening.nt.ts。）
 * 边界：无网络/无密钥/无 host；不接生产、不写公司目录、不迁数据。
 * 运行：node --experimental-strip-types --test apps/workbench-chatd/test/wake.nt.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SCHEMA_VERSION, SqliteChatStore } from '../src/store/sqlite.ts'
import { createInitialState, WAKE_MAX_DELIVERY_ATTEMPTS, type MockMessage, type MockRoom, type MockWake } from '../src/store/types.ts'
import { ChatdConfigError, loadConfig } from '../src/config.ts'
import { startChatd, sleep, type ChatdHandle } from './support/proc.ts'
import { connectNdjson, type RawClient, type WbFrame } from './support/ndjson.ts'
import { DriverSession } from './support/driver.ts'

function tmpDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), `workbench-chatd-wake-${prefix}-`))
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

async function expectErr(frame: WbFrame): Promise<{ code: string; message: string }> {
  assert.equal(frame.ok, false, `期望失败响应：${JSON.stringify(frame)}`)
  return (frame as { ok: false; error: { code: string; message: string } }).error
}

interface WakeSnapshot {
  readonly wakeId: string
  readonly status: string
  readonly claimedBy: string | null
  readonly claimedUntil: number | null
}

/** 造一个 mention wake：返回 wakeId。 */
async function seedWake(c: RawClient): Promise<string> {
  const room = await expectOk<{ roomId: string }>(await c.call('rooms.create', { kind: 'group', name: 'g', memberIds: ['pm', 'dev'] }))
  await c.call('messages.send', { roomId: room.roomId, senderId: 'pm', body: '@dev please look', mentions: ['dev'] })
  const inbox = await expectOk<{ pendingWakeIds: string[] }>(await c.call('inbox', { actorId: 'dev' }))
  const wakeId = inbox.pendingWakeIds[0]
  assert.ok(wakeId !== undefined, 'mention 后应有 pending wake')
  return wakeId
}

interface EventRow { readonly event_id: number; readonly type: string; readonly attempt: number }
interface LeaseRow { readonly attempt: number; readonly state: string }

/** 进程退出后直读库（审计/租约断言用；node:sqlite 返回 null 原型行，取标量比较）。 */
function readDb(dbPath: string, run: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(dbPath)
  try {
    run(db)
  } finally {
    db.close()
  }
}

const eventsOf = (db: DatabaseSync): string[] =>
  (db.prepare('SELECT event_id, type, attempt FROM wake_events ORDER BY event_id').all() as unknown as EventRow[])
    .map((e) => `${String(e.event_id)}:${e.type}:${String(e.attempt)}`)

const leaseOf = (db: DatabaseSync): { attempt: number; state: string } => {
  const row = db.prepare('SELECT attempt, state FROM wake_leases').get() as unknown as LeaseRow
  return { attempt: row.attempt, state: row.state }
}

// ─── store 单测：迁移 / append-only / 事务钩子 / hydrate ─────────────────────

/** v1 库 fixture：完整复刻迁移 v1 的 DDL（chatd_meta 版本=1）+ 三种状态的存量 wakes。 */
function buildV1Db(dbPath: string): void {
  const raw = new DatabaseSync(dbPath)
  raw.exec(`
    CREATE TABLE chatd_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO chatd_meta (key, value) VALUES ('schema_version', '1');
    CREATE TABLE rooms (
      room_id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, member_ids TEXT NOT NULL
    );
    CREATE TABLE messages (
      message_id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE,
      room_id TEXT NOT NULL REFERENCES rooms(room_id), room_seq INTEGER NOT NULL,
      sender_id TEXT NOT NULL, body TEXT NOT NULL, mentions TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE wakes (
      wake_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, room_id TEXT NOT NULL REFERENCES rooms(room_id),
      source_seq INTEGER NOT NULL, cause TEXT NOT NULL, status TEXT NOT NULL,
      claimed_by TEXT, claimed_until INTEGER, created_at INTEGER NOT NULL, acked_at INTEGER
    );
    CREATE TABLE read_cursors (
      actor_id TEXT NOT NULL, room_id TEXT NOT NULL, last_read_room_seq INTEGER NOT NULL,
      PRIMARY KEY (actor_id, room_id)
    );
    CREATE TABLE idempotency (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO rooms VALUES ('room-1', 'group', 'g', '["pm","dev"]');
    INSERT INTO wakes VALUES ('wake-1', 'dev', 'room-1', 1, 'mention', 'pending',  NULL,     NULL,  1000, NULL);
    INSERT INTO wakes VALUES ('wake-2', 'dev', 'room-1', 2, 'mention', 'claimed',  'dev',    2000,  1100, NULL);
    INSERT INTO wakes VALUES ('wake-3', 'dev', 'room-1', 3, 'mention', 'acked',    NULL,     NULL,  1200, 1300);
  `)
  raw.close()
}

test('store 单测：v1 库迁移 v2——wake_leases/wake_events 建表 + 存量 wakes 回填租约投影 + 审计触发器', () => {
  const dir = tmpDir('migrate')
  const dbPath = path.join(dir, 'chat.db')
  try {
    buildV1Db(dbPath)

    const store = new SqliteChatStore(dbPath)
    assert.equal(store.schemaVersion(), SCHEMA_VERSION, '迁移后版本=当前程序版本（v2）')
    store.close()

    readDb(dbPath, (db) => {
      const leases = db.prepare('SELECT wake_id, attempt, state, claimed_by, lease_expires_at FROM wake_leases ORDER BY wake_id').all() as unknown as {
        wake_id: string; attempt: number; state: string; claimed_by: string | null; lease_expires_at: number | null
      }[]
      assert.deepEqual(
        leases.map((l) => ({ wake_id: l.wake_id, attempt: l.attempt, state: l.state, claimed_by: l.claimed_by, lease_expires_at: l.lease_expires_at })),
        [
          { wake_id: 'wake-1', attempt: 0, state: 'pending', claimed_by: null, lease_expires_at: null },
          { wake_id: 'wake-2', attempt: 1, state: 'leased', claimed_by: 'dev', lease_expires_at: 2000 },
          { wake_id: 'wake-3', attempt: 1, state: 'acked', claimed_by: null, lease_expires_at: null },
        ],
        '存量回填：pending→attempt0；claimed→leased/attempt1（带原租约）；acked→acked/attempt1',
      )
      const events = db.prepare('SELECT COUNT(*) AS c FROM wake_events').get() as unknown as { c: number }
      assert.equal(events.c, 0, 'v1 历史不伪造审计（wake_events 从 v2 起记）')
      // 审计 append-only 触发器（机制保证）
      db.prepare("INSERT INTO wake_events (event_id, wake_id, type, attempt, actor_id, claimed_by, lease_expires_at, at) VALUES (1, 'wake-1', 'created', 0, 'dev', NULL, NULL, 1)").run()
      assert.throws(() => { db.prepare('UPDATE wake_events SET type = ? WHERE event_id = ?').run('hacked', '1') }, /append-only/)
      assert.throws(() => { db.prepare('DELETE FROM wake_events WHERE event_id = ?').run('1') }, /append-only/)
      const kept = db.prepare('SELECT type FROM wake_events WHERE event_id = 1').get() as unknown as { type: string }
      assert.equal(kept.type, 'created', '原审计行不受触发器 ABORT 影响')
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('store 单测：appendMessage 连租约/审计原子落库 + recordWakeTransition 三写一事务 + 重开 hydrate 恢复（事件序续增）', () => {
  const dir = tmpDir('transition')
  const dbPath = path.join(dir, 'chat.db')
  try {
    const store = new SqliteChatStore(dbPath)
    const room: MockRoom = { roomId: 'room-1', kind: 'group', name: 'g', memberIds: ['pm', 'dev'], headRoomSeq: 1 }
    const message: MockMessage = { messageId: 'msg-1', seq: 1, roomSeq: 1, roomId: 'room-1', senderId: 'pm', body: '@dev m1', mentions: ['dev'], createdAt: 1_700_000_000_000 }
    const wake: MockWake = { wakeId: 'wake-1', actorId: 'dev', roomId: 'room-1', sourceSeq: 1, cause: 'mention', status: 'pending', claimedBy: null, claimedUntil: null, createdAt: 1_700_000_000_000, ackedAt: null }
    store.insertRoom(room)
    store.appendMessage(
      message,
      [wake],
      [{ wakeId: 'wake-1', attempt: 0, state: 'pending', claimedBy: null, leaseExpiresAt: null, updatedAt: 1_700_000_000_000 }],
      [{ eventId: 1, wakeId: 'wake-1', type: 'created', attempt: 0, actorId: 'dev', claimedBy: null, leaseExpiresAt: null, at: 1_700_000_000_000 }],
    )
    // 首投租约（三写一事务：wakes 投影 + wake_leases 覆盖 + wake_events 审计）
    store.recordWakeTransition(
      { ...wake, status: 'claimed', claimedBy: 'dev', claimedUntil: 1_700_000_030_000 },
      { wakeId: 'wake-1', attempt: 1, state: 'leased', claimedBy: 'dev', leaseExpiresAt: 1_700_000_030_000, updatedAt: 1_700_000_000_001 },
      { eventId: 2, wakeId: 'wake-1', type: 'claimed', attempt: 1, actorId: 'dev', claimedBy: 'dev', leaseExpiresAt: 1_700_000_030_000, at: 1_700_000_000_001 },
    )
    store.close()

    // 「重启」：hydrate 恢复租约投影 + 审计历史 + 事件序计数器
    const reopened = new SqliteChatStore(dbPath)
    const state = createInitialState()
    reopened.hydrate(state)
    assert.deepEqual(state.wakeLeases.get('wake-1'), { wakeId: 'wake-1', attempt: 1, state: 'leased', claimedBy: 'dev', leaseExpiresAt: 1_700_000_030_000, updatedAt: 1_700_000_000_001 })
    assert.deepEqual(
      state.wakeEvents.map((e) => ({ eventId: e.eventId, type: e.type, attempt: e.attempt })),
      [{ eventId: 1, type: 'created', attempt: 0 }, { eventId: 2, type: 'claimed', attempt: 1 }],
      '审计历史按 event_id 序恢复',
    )
    assert.equal(state.wakeEventSeq, 2, '事件序计数器恢复为库内最大 event_id')

    // 重启后续写：事件序续增（无 PK 冲突），仍一事务
    reopened.recordWakeTransition(
      { ...wake, status: 'acked', ackedAt: 1_700_000_000_003 },
      { wakeId: 'wake-1', attempt: 1, state: 'acked', claimedBy: null, leaseExpiresAt: null, updatedAt: 1_700_000_000_003 },
      { eventId: state.wakeEventSeq + 1, wakeId: 'wake-1', type: 'acked', attempt: 1, actorId: 'dev', claimedBy: null, leaseExpiresAt: null, at: 1_700_000_000_003 },
    )
    reopened.close()

    readDb(dbPath, (db) => {
      assert.deepEqual(eventsOf(db), ['1:created:0', '2:claimed:1', '3:acked:1'], '重启前后审计连续追加')
      assert.deepEqual(leaseOf(db), { attempt: 1, state: 'acked' })
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('config 单测：WORKBENCH_CHATD_WAKE_LEASE_MS 缺省 30000；合法解析；非法拒启', () => {
  const argv = ['/node', '/main.ts']
  const base = { WORKBENCH_CHATD_ALLOW_NO_AUTH: '1' } as Record<string, string>
  assert.equal(loadConfig(base, argv).wakeLeaseMs, 30_000, '缺省与 P1-1b 硬编码口径一致')
  assert.equal(loadConfig({ ...base, WORKBENCH_CHATD_WAKE_LEASE_MS: '80' }, argv).wakeLeaseMs, 80)
  assert.throws(() => { loadConfig({ ...base, WORKBENCH_CHATD_WAKE_LEASE_MS: '-1' }, argv) }, (err: unknown) => {
    assert.ok(err instanceof ChatdConfigError)
    assert.match(err.message, /WORKBENCH_CHATD_WAKE_LEASE_MS/)
    return true
  })
})

// ─── e2e（子进程 + 真 socket）：租约语义 ─────────────────────────────────────
// 结构纪律：readDb/重启必须发生在 h.cleanup() 之前（cleanup 会删整个临时目录含 chat.db）。

test('e2e：claim 幂等——租约有效期内重复 claim 回同 lease（alreadyClaimed、claimedUntil 不变）；同幂等键 replay', async () => {
  const dir = tmpDir('idem')
  const dbPath = path.join(dir, 'chat.db')
  const socketPath = path.join(dir, 'chat.sock')
  try {
    const h = await startChatd({ env: { WORKBENCH_CHATD_DB: dbPath }, dir, socketPath })
    try {
      await withClient(h, async (c) => {
        const wakeId = await seedWake(c)
        const first = await expectOk<{ claimed: string[]; alreadyClaimed: string[]; wakes: WakeSnapshot[]; replayed: boolean }>(
          await c.call('wakes.claim', { actorId: 'dev', wakeIds: [wakeId], idempotencyKey: 'claim-a' }),
        )
        assert.deepEqual(first.claimed, [wakeId])
        assert.deepEqual(first.alreadyClaimed, [])
        assert.equal(first.wakes[0]?.status, 'claimed')
        const leaseUntil = first.wakes[0]?.claimedUntil
        assert.ok(typeof leaseUntil === 'number' && leaseUntil > Date.now(), '租约截止在未来')

        // 不同幂等键重复 claim：幂等回同 lease（不延期、不重投、不计数）
        const second = await expectOk<{ claimed: string[]; alreadyClaimed: string[]; wakes: WakeSnapshot[] }>(
          await c.call('wakes.claim', { actorId: 'dev', wakeIds: [wakeId], idempotencyKey: 'claim-b' }),
        )
        assert.deepEqual(second.claimed, [], '有效租约内不重投')
        assert.deepEqual(second.alreadyClaimed, [wakeId])
        assert.equal(second.wakes[0]?.claimedUntil, leaseUntil, '同 lease：claimedUntil 原值返回（不延期）')

        // 同幂等键：回放首次结果（Transport v1 replay 语义）
        const replay = await expectOk<{ claimed: string[]; replayed: boolean }>(
          await c.call('wakes.claim', { actorId: 'dev', wakeIds: [wakeId], idempotencyKey: 'claim-a' }),
        )
        assert.equal(replay.replayed, true)
        assert.deepEqual(replay.claimed, [wakeId])
      })
    } finally {
      await h.cleanup()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('e2e：TTL 过期后重投——再 claim 回包 claimed（非 alreadyClaimed）+ 新租约；DB attempt 递增 + 审计追加 redelivered', async () => {
  const dir = tmpDir('ttl')
  const dbPath = path.join(dir, 'chat.db')
  const socketPath = path.join(dir, 'chat.sock')
  const leaseMs = 80
  try {
    const h = await startChatd({ env: { WORKBENCH_CHATD_DB: dbPath, WORKBENCH_CHATD_WAKE_LEASE_MS: String(leaseMs) }, dir, socketPath })
    try {
      await withClient(h, async (c) => {
        const wakeId = await seedWake(c)
        const first = await expectOk<{ claimed: string[]; wakes: WakeSnapshot[] }>(await c.call('wakes.claim', { actorId: 'dev', wakeIds: [wakeId] }))
        const until1 = first.wakes[0]?.claimedUntil
        assert.deepEqual(first.claimed, [wakeId])

        await sleep(leaseMs * 3) // 租约过期

        const second = await expectOk<{ claimed: string[]; alreadyClaimed: string[]; wakes: WakeSnapshot[] }>(await c.call('wakes.claim', { actorId: 'dev', wakeIds: [wakeId] }))
        assert.deepEqual(second.claimed, [wakeId], '过期后 claim = 重投（claimed 回包）')
        assert.deepEqual(second.alreadyClaimed, [])
        const until2 = second.wakes[0]?.claimedUntil
        assert.ok(typeof until1 === 'number' && typeof until2 === 'number' && until2 > until1, '重投授予新租约（claimedUntil 重算后移）')
      })
      h.sigterm()
      assert.equal((await h.waitExit()).code, 0)
      readDb(dbPath, (db) => {
        assert.deepEqual(leaseOf(db), { attempt: 2, state: 'leased' }, '重投后 attempt=2（首投+1 重投）')
        assert.deepEqual(eventsOf(db), ['1:created:0', '2:claimed:1', '3:redelivered:2'], '审计按序追加')
      })
    } finally {
      await h.cleanup()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('e2e：重试上限→dead-letter——第 3 次租约过期后 claim 回稳定 WB_WAKE_NOT_CLAIMABLE；inbox 不再 pending；审计封口（只追加不重写）', async () => {
  const dir = tmpDir('dead')
  const dbPath = path.join(dir, 'chat.db')
  const socketPath = path.join(dir, 'chat.sock')
  const leaseMs = 60
  try {
    const h = await startChatd({ env: { WORKBENCH_CHATD_DB: dbPath, WORKBENCH_CHATD_WAKE_LEASE_MS: String(leaseMs) }, dir, socketPath })
    try {
      await withClient(h, async (c) => {
        const wakeId = await seedWake(c)
        for (let i = 1; i <= WAKE_MAX_DELIVERY_ATTEMPTS; i += 1) {
          const r = await expectOk<{ claimed: string[] }>(await c.call('wakes.claim', { actorId: 'dev', wakeIds: [wakeId] }))
          assert.deepEqual(r.claimed, [wakeId], `第 ${String(i)} 次投递应成功`)
          await sleep(leaseMs * 3)
        }
        // 次数耗尽：dead-letter 稳定错误
        for (let i = 0; i < 2; i += 1) {
          const err = await expectErr(await c.call('wakes.claim', { actorId: 'dev', wakeIds: [wakeId] }))
          assert.equal(err.code, 'WB_WAKE_NOT_CLAIMABLE', 'dead-letter 后 claim 回冻结错误码')
          assert.match(err.message, /dead-lettered/, '稳定错误信息（dead-letter）')
        }
        // C2.1 加固：dead 终态不可再 ack（同 actor=最后持租人也拒；复用 WB_WAKE_NOT_CLAIMABLE，message 注明 dead）
        for (let i = 0; i < 2; i += 1) {
          const ackErr = await expectErr(await c.call('wakes.ack', { actorId: 'dev', wakeIds: [wakeId] }))
          assert.equal(ackErr.code, 'WB_WAKE_NOT_CLAIMABLE', 'dead-letter 后 ack 回冻结错误码')
          assert.match(ackErr.message, /dead-lettered/, 'ack 拒绝信息同样注明 dead（终态不可翻案）')
        }
        const inbox = await expectOk<{ pendingWakeIds: string[]; mentions: number }>(await c.call('inbox', { actorId: 'dev' }))
        assert.deepEqual(inbox.pendingWakeIds, [], 'dead-letter 是投递终态：inbox 不再 pending')
        assert.equal(inbox.mentions, 0)
      })
      h.sigterm()
      assert.equal((await h.waitExit()).code, 0)
      readDb(dbPath, (db) => {
        assert.deepEqual(leaseOf(db), { attempt: WAKE_MAX_DELIVERY_ATTEMPTS, state: 'dead' }, '租约终态 dead，attempt=上限')
        assert.deepEqual(
          eventsOf(db),
          ['1:created:0', '2:claimed:1', '3:redelivered:2', '4:redelivered:3', '5:dead_lettered:3'],
          '全生命周期审计恰好 5 条；重复 dead claim 不再追加（追加后封口，无重写）',
        )
      })
    } finally {
      await h.cleanup()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('e2e：ack 幂等——ack 后 alreadyAcked；claim 回稳定 already acked；审计 [created,claimed,acked]', async () => {
  const dir = tmpDir('ack')
  const dbPath = path.join(dir, 'chat.db')
  const socketPath = path.join(dir, 'chat.sock')
  try {
    const h = await startChatd({ env: { WORKBENCH_CHATD_DB: dbPath }, dir, socketPath })
    try {
      await withClient(h, async (c) => {
        const wakeId = await seedWake(c)
        await c.call('wakes.claim', { actorId: 'dev', wakeIds: [wakeId] })
        const first = await expectOk<{ acked: string[]; alreadyAcked: string[] }>(await c.call('wakes.ack', { actorId: 'dev', wakeIds: [wakeId], idempotencyKey: 'ack-a' }))
        assert.deepEqual(first.acked, [wakeId])
        const second = await expectOk<{ acked: string[]; alreadyAcked: string[]; replayed: boolean }>(await c.call('wakes.ack', { actorId: 'dev', wakeIds: [wakeId], idempotencyKey: 'ack-b' }))
        assert.deepEqual(second.acked, [], 'ack 幂等：不重复确认')
        assert.deepEqual(second.alreadyAcked, [wakeId])
        const replay = await expectOk<{ acked: string[]; replayed: boolean }>(await c.call('wakes.ack', { actorId: 'dev', wakeIds: [wakeId], idempotencyKey: 'ack-a' }))
        assert.equal(replay.replayed, true, '同幂等键回放首次结果')
        const err = await expectErr(await c.call('wakes.claim', { actorId: 'dev', wakeIds: [wakeId] }))
        assert.equal(err.code, 'WB_WAKE_NOT_CLAIMABLE')
        assert.match(err.message, /already acked/)
        const inbox = await expectOk<{ pendingWakeIds: string[] }>(await c.call('inbox', { actorId: 'dev' }))
        assert.deepEqual(inbox.pendingWakeIds, [])
      })
      h.sigterm()
      assert.equal((await h.waitExit()).code, 0)
      readDb(dbPath, (db) => {
        assert.deepEqual(eventsOf(db), ['1:created:0', '2:claimed:1', '3:acked:1'], '重复 ack 不追加审计')
      })
    } finally {
      await h.cleanup()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('e2e：重启后 lease 状态恢复——有效租约跨重启 claim 回同 lease（alreadyClaimed、claimedUntil 不变）', async () => {
  const dir = tmpDir('restart')
  const dbPath = path.join(dir, 'chat.db')
  const socketPath = path.join(dir, 'chat.sock')
  const env = { WORKBENCH_CHATD_DB: dbPath } // 缺省 TTL 30s：重启窗口内租约仍有效
  let wakeId = ''
  let leaseUntil = 0
  try {
    const first = await startChatd({ env, dir, socketPath })
    try {
      await withClient(first, async (c) => {
        wakeId = await seedWake(c)
        const r = await expectOk<{ wakes: WakeSnapshot[] }>(await c.call('wakes.claim', { actorId: 'dev', wakeIds: [wakeId] }))
        leaseUntil = r.wakes[0]?.claimedUntil ?? 0
        assert.ok(leaseUntil > Date.now())
      })
      first.sigterm()
      assert.equal((await first.waitExit()).code, 0)

      const second = await startChatd({ env, dir, socketPath })
      try {
        await withClient(second, async (c) => {
          const r = await expectOk<{ claimed: string[]; alreadyClaimed: string[]; wakes: WakeSnapshot[] }>(
            await c.call('wakes.claim', { actorId: 'dev', wakeIds: [wakeId] }),
          )
          assert.deepEqual(r.claimed, [], '租约随重启恢复：不重投')
          assert.deepEqual(r.alreadyClaimed, [wakeId])
          assert.equal(r.wakes[0]?.claimedUntil, leaseUntil, '同 lease（claimedUntil 为重启前的原值）')
          assert.equal(r.wakes[0]?.claimedBy, 'dev')
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

test('e2e：dead-letter 跨重启稳定——重启后 claim 仍回同一稳定错误，审计不新增', async () => {
  const dir = tmpDir('dead-restart')
  const dbPath = path.join(dir, 'chat.db')
  const socketPath = path.join(dir, 'chat.sock')
  const leaseMs = 60
  const env = { WORKBENCH_CHATD_DB: dbPath, WORKBENCH_CHATD_WAKE_LEASE_MS: String(leaseMs) }
  let wakeId = ''
  try {
    const first = await startChatd({ env, dir, socketPath })
    try {
      await withClient(first, async (c) => {
        wakeId = await seedWake(c)
        for (let i = 0; i < WAKE_MAX_DELIVERY_ATTEMPTS; i += 1) {
          await c.call('wakes.claim', { actorId: 'dev', wakeIds: [wakeId] })
          await sleep(leaseMs * 3)
        }
        const err = await expectErr(await c.call('wakes.claim', { actorId: 'dev', wakeIds: [wakeId] }))
        assert.match(err.message, /dead-lettered/)
      })
      first.sigterm()
      assert.equal((await first.waitExit()).code, 0)

      const second = await startChatd({ env, dir, socketPath })
      try {
        await withClient(second, async (c) => {
          const err = await expectErr(await c.call('wakes.claim', { actorId: 'dev', wakeIds: [wakeId] }))
          assert.equal(err.code, 'WB_WAKE_NOT_CLAIMABLE')
          assert.match(err.message, /dead-lettered/, 'dead 终态随重启恢复：仍回同一稳定错误')
          const inbox = await expectOk<{ pendingWakeIds: string[] }>(await c.call('inbox', { actorId: 'dev' }))
          assert.deepEqual(inbox.pendingWakeIds, [])
        })
        second.sigterm()
        assert.equal((await second.waitExit()).code, 0)
        readDb(dbPath, (db) => {
          assert.equal(eventsOf(db).length, 1 + WAKE_MAX_DELIVERY_ATTEMPTS + 1, 'created + 3 投递 + dead_lettered，重启后未新增')
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

test('e2e：并发 claim 唯一——双连接同时 claim 同一 wake，恰一方 claimed、另一方 alreadyClaimed；审计仅一条 claimed', async () => {
  const dir = tmpDir('concurrent')
  const dbPath = path.join(dir, 'chat.db')
  const socketPath = path.join(dir, 'chat.sock')
  try {
    const h = await startChatd({ env: { WORKBENCH_CHATD_DB: dbPath }, dir, socketPath })
    try {
      await withClient(h, async (c) => {
        const wakeId = await seedWake(c)
        c.close()
        const c1 = await connectNdjson(socketPath)
        const c2 = await connectNdjson(socketPath)
        try {
          const [r1, r2] = await Promise.all([
            c1.call('wakes.claim', { actorId: 'dev', wakeIds: [wakeId] }),
            c2.call('wakes.claim', { actorId: 'dev', wakeIds: [wakeId] }),
          ])
          assert.equal(r1.ok, true, `并发 claim 应成功返回：${JSON.stringify(r1)}`)
          assert.equal(r2.ok, true, `并发 claim 应成功返回：${JSON.stringify(r2)}`)
          const a = (r1 as { ok: true; result: { claimed: string[]; alreadyClaimed: string[] } }).result
          const b = (r2 as { ok: true; result: { claimed: string[]; alreadyClaimed: string[] } }).result
          assert.equal([...a.claimed, ...b.claimed].length, 1, '同一 wake 的租约授予恰一次（并发唯一）')
          assert.equal([...a.alreadyClaimed, ...b.alreadyClaimed].length, 1, '另一方幂等见 alreadyClaimed')
        } finally {
          c1.close()
          c2.close()
        }
      })
      h.sigterm()
      assert.equal((await h.waitExit()).code, 0)
      readDb(dbPath, (db) => {
        assert.deepEqual(leaseOf(db), { attempt: 1, state: 'leased' }, '并发下租约只授一次（attempt=1）')
        assert.deepEqual(eventsOf(db), ['1:created:0', '2:claimed:1'], '审计仅一条 claimed（无重复授予）')
      })
    } finally {
      await h.cleanup()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('e2e：内存模式（mock 向后兼容）——TTL 过期重投与 dead-letter 在内存态照常生效', async () => {
  const dir = tmpDir('memory')
  const socketPath = path.join(dir, 'chat.sock')
  const leaseMs = 50
  try {
    const h = await startChatd({ env: { WORKBENCH_CHATD_WAKE_LEASE_MS: String(leaseMs) }, dir, socketPath })
    try {
      await withClient(h, async (c) => {
        const wakeId = await seedWake(c)
        const first = await expectOk<{ claimed: string[] }>(await c.call('wakes.claim', { actorId: 'dev', wakeIds: [wakeId] }))
        assert.deepEqual(first.claimed, [wakeId])
        await sleep(leaseMs * 3)
        const second = await expectOk<{ claimed: string[]; alreadyClaimed: string[] }>(await c.call('wakes.claim', { actorId: 'dev', wakeIds: [wakeId] }))
        assert.deepEqual(second.claimed, [wakeId], '内存模式租约过期同样重投')
        await sleep(leaseMs * 3)
        const third = await expectOk<{ claimed: string[] }>(await c.call('wakes.claim', { actorId: 'dev', wakeIds: [wakeId] }))
        assert.deepEqual(third.claimed, [wakeId])
        await sleep(leaseMs * 3)
        const err = await expectErr(await c.call('wakes.claim', { actorId: 'dev', wakeIds: [wakeId] }))
        assert.equal(err.code, 'WB_WAKE_NOT_CLAIMABLE')
        assert.match(err.message, /dead-lettered/, '内存模式同样触达重试上限 → dead-letter')
        const inbox = await expectOk<{ pendingWakeIds: string[] }>(await c.call('inbox', { actorId: 'dev' }))
        assert.deepEqual(inbox.pendingWakeIds, [])
      })
    } finally {
      await h.cleanup()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ─── 契约（真客户端）：WorkbenchTransport v1 claim/ack 幂等镜像 ───────────────

test('契约：真客户端 wake 场景——claim 同 lease 幂等 + ack 幂等 + ack 后 claim 稳定错误（memory 模式）', async () => {
  const h = await startChatd()
  try {
    await h.waitReady()
    const driver = new DriverSession(['--socket', h.socketPath, '--scenario', 'wake'])
    const code = await driver.done()
    const fatal = driver.collected().find((e) => e.stage === 'fatal')
    assert.equal(fatal, undefined, `驱动器不应 fatal：${JSON.stringify(fatal)}`)
    assert.equal(code, 0, `驱动器应 exit 0（实际 ${String(code)}）`)

    const inbox = driver.collected().find((e) => e.stage === 'inbox')
    const pending = inbox?.['pendingWakeIds'] as string[]
    const claim = driver.collected().find((e) => e.stage === 'claim')
    assert.deepEqual(claim?.['claimed'] as string[], pending)
    assert.equal(claim?.['status'], 'claimed')
    assert.equal(claim?.['claimedBy'], 'dev')
    assert.equal(typeof claim?.['claimedUntil'], 'number')

    const claimAgain = driver.collected().find((e) => e.stage === 'claim-again')
    assert.deepEqual(claimAgain?.['alreadyClaimed'] as string[], pending)
    assert.deepEqual(claimAgain?.['claimed'], [])
    assert.equal(claimAgain?.['sameLease'], true, '真客户端见同 lease（claimedUntil 不变）')

    const ack = driver.collected().find((e) => e.stage === 'ack')
    assert.deepEqual(ack?.['acked'] as string[], pending)
    const ackAgain = driver.collected().find((e) => e.stage === 'ack-again')
    assert.deepEqual(ackAgain?.['alreadyAcked'] as string[], pending)
    assert.deepEqual(ackAgain?.['acked'], [])

    const claimAfterAck = driver.collected().find((e) => e.stage === 'claim-after-ack')
    assert.equal(claimAfterAck?.['code'], 'WB_WAKE_NOT_CLAIMABLE')
    const inboxAfter = driver.collected().find((e) => e.stage === 'inbox-after')
    assert.deepEqual(inboxAfter?.['pendingWakeIds'], [])
  } finally {
    await h.cleanup()
  }
})
