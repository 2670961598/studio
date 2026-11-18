/**
 * SQLite 持久化存储（Phase1 模块 C 最小刀 / P1-2 前半 + wake lease 最小刀 / P1-2 后半）：
 * node:sqlite（Node 内置，零第三方依赖）。
 * 范围：rooms/messages/wakes/read_cursors/idempotency 最小集 + wake_leases（租约投影）/
 *       wake_events（投递审计，append-only）；inbox 由 wakes+reads 派生，不单独建表。
 *       不接 vendor collab、不写公司目录、不迁 Matrix 数据。
 * 依据：docs/sentinel-logs/Phase1实现拆解-2026-11-17.md 模块 C（wake_lease/wake_delivery
 *       TTL/重试/dead-letter；append-only 审计——此处以 wake_leases+wake_events 等价承载）。
 * 纪律：
 *  - 数据库文件权限 0600（每次打开都 chmod 复核，可治愈漂移）；父目录按需创建 0700（与 socket 同纪律）。
 *  - messages/wake_events append-only：schema 触发器直接 ABORT 任何 UPDATE/DELETE（机制保证，非自律）；
 *    wake 状态变更只追加审计（wakes 行是可覆盖投影，历史只增不改的真相在 wake_events）。
 *  - schema 版本表 chatd_meta + 顺序迁移列表：init 幂等（已应用的迁移跳过）；高版本库拒绝降级启动；
 *    v2 迁移对 v1 存量 wakes 回填 wake_leases 投影（pending→attempt 0；claimed→leased/attempt 1；
 *    acked→acked/attempt 1），旧 wake_events 无历史可造（不伪造审计）。
 *  - 写路径 DB 先行（失败抛错 → 上层归一 WB_INTERNAL，内存不落地）；appendMessage 与
 *    recordWakeTransition 均单事务保证原子可见。
 */
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type { ChatStore, MockMessage, MockRoom, MockState, MockWake, RoomKind, WakeCause, WakeEvent, WakeLease, WakeLeaseState, WakeStatus } from './types.ts'

/** 当前程序 schema 版本（= 已应用迁移的最大版本）。 */
export const SCHEMA_VERSION = 2

export class ChatdStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChatdStoreError'
  }
}

interface Migration {
  readonly version: number
  readonly name: string
  readonly sql: string
}

/** 顺序迁移列表：只追加不修改（旧迁移一经发布即冻结）。 */
const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'C-mini 最小集：rooms/messages/wakes/read_cursors/idempotency + append-only 触发器',
    sql: `
      CREATE TABLE rooms (
        room_id    TEXT PRIMARY KEY,
        kind       TEXT NOT NULL,
        name       TEXT NOT NULL,
        member_ids TEXT NOT NULL
      );

      CREATE TABLE messages (
        message_id TEXT PRIMARY KEY,
        seq        INTEGER NOT NULL UNIQUE,
        room_id    TEXT NOT NULL REFERENCES rooms(room_id),
        room_seq   INTEGER NOT NULL,
        sender_id  TEXT NOT NULL,
        body       TEXT NOT NULL,
        mentions   TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      -- append-only 宪法：messages 只许插入，UPDATE/DELETE 一律 ABORT（机制保证）。
      CREATE TRIGGER messages_append_only_no_update
        BEFORE UPDATE ON messages
        BEGIN SELECT RAISE(ABORT, 'messages is append-only (no UPDATE)'); END;
      CREATE TRIGGER messages_append_only_no_delete
        BEFORE DELETE ON messages
        BEGIN SELECT RAISE(ABORT, 'messages is append-only (no DELETE)'); END;

      CREATE TABLE wakes (
        wake_id       TEXT PRIMARY KEY,
        actor_id      TEXT NOT NULL,
        room_id       TEXT NOT NULL REFERENCES rooms(room_id),
        source_seq    INTEGER NOT NULL,
        cause         TEXT NOT NULL,
        status        TEXT NOT NULL,
        claimed_by    TEXT,
        claimed_until INTEGER,
        created_at    INTEGER NOT NULL,
        acked_at      INTEGER
      );

      CREATE TABLE read_cursors (
        actor_id           TEXT NOT NULL,
        room_id            TEXT NOT NULL,
        last_read_room_seq INTEGER NOT NULL,
        PRIMARY KEY (actor_id, room_id)
      );

      CREATE TABLE idempotency (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: 'P1-2 wake lease：wake_leases（租约投影）+ wake_events（append-only 审计）+ v1 存量回填',
    sql: `
      CREATE TABLE wake_leases (
        wake_id          TEXT PRIMARY KEY REFERENCES wakes(wake_id),
        attempt          INTEGER NOT NULL,
        state            TEXT NOT NULL,
        claimed_by       TEXT,
        lease_expires_at INTEGER,
        updated_at       INTEGER NOT NULL
      );

      CREATE TABLE wake_events (
        event_id         INTEGER PRIMARY KEY,
        wake_id          TEXT NOT NULL REFERENCES wakes(wake_id),
        type             TEXT NOT NULL,
        attempt          INTEGER NOT NULL,
        actor_id         TEXT NOT NULL,
        claimed_by       TEXT,
        lease_expires_at INTEGER,
        at               INTEGER NOT NULL
      );
      -- 审计宪法：wake 状态变更只追加，UPDATE/DELETE 一律 ABORT（机制保证，非自律）。
      CREATE TRIGGER wake_events_append_only_no_update
        BEFORE UPDATE ON wake_events
        BEGIN SELECT RAISE(ABORT, 'wake_events is append-only (no UPDATE)'); END;
      CREATE TRIGGER wake_events_append_only_no_delete
        BEFORE DELETE ON wake_events
        BEGIN SELECT RAISE(ABORT, 'wake_events is append-only (no DELETE)'); END;

      -- v1 存量 wakes 回填租约投影（不伪造审计：wake_events 从 v2 起记）。
      INSERT INTO wake_leases (wake_id, attempt, state, claimed_by, lease_expires_at, updated_at)
      SELECT wake_id,
             CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
             CASE WHEN status = 'acked' THEN 'acked' WHEN status = 'claimed' THEN 'leased' ELSE 'pending' END,
             CASE WHEN status = 'claimed' THEN claimed_by ELSE NULL END,
             CASE WHEN status = 'claimed' THEN claimed_until ELSE NULL END,
             created_at
      FROM wakes;
    `,
  },
]

// ─── 行形状（node:sqlite 返回列名键；null 原型对象按 as 断言收窄） ──────────────
interface RoomRow {
  readonly room_id: string
  readonly kind: string
  readonly name: string
  readonly member_ids: string
}
interface MessageRow {
  readonly message_id: string
  readonly seq: number
  readonly room_id: string
  readonly room_seq: number
  readonly sender_id: string
  readonly body: string
  readonly mentions: string
  readonly created_at: number
}
interface WakeRow {
  readonly wake_id: string
  readonly actor_id: string
  readonly room_id: string
  readonly source_seq: number
  readonly cause: string
  readonly status: string
  readonly claimed_by: string | null
  readonly claimed_until: number | null
  readonly created_at: number
  readonly acked_at: number | null
}
interface ReadRow {
  readonly actor_id: string
  readonly room_id: string
  readonly last_read_room_seq: number
}
interface WakeLeaseRow {
  readonly wake_id: string
  readonly attempt: number
  readonly state: string
  readonly claimed_by: string | null
  readonly lease_expires_at: number | null
  readonly updated_at: number
}
interface WakeEventRow {
  readonly event_id: number
  readonly wake_id: string
  readonly type: string
  readonly attempt: number
  readonly actor_id: string
  readonly claimed_by: string | null
  readonly lease_expires_at: number | null
  readonly at: number
}
interface WakeEventSeqRow {
  readonly max_id: number | null
}
interface HeadRow {
  readonly room_id: string
  readonly head: number
}
interface IdempotencyRow {
  readonly key: string
  readonly value: string
}
interface VersionRow {
  readonly value: string
}

const parseJsonArray = (raw: string, column: string): string[] => {
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === 'string')) {
    throw new ChatdStoreError(`持久化数据损坏（${column} 应为 string[] JSON）：${raw.slice(0, 64)}`)
  }
  return parsed as string[]
}

export class SqliteChatStore implements ChatStore {
  readonly mode = 'sqlite' as const
  /** 可注入时钟（TTL/时间戳唯一源；缺省 Date.now，生产行为不变；测试手动推进/跳变用）。 */
  readonly now: () => number
  private readonly db: DatabaseSync
  private readonly insertRoomStmt: StatementSync
  private readonly insertMessageStmt: StatementSync
  private readonly insertWakeStmt: StatementSync
  private readonly updateWakeStmt: StatementSync
  private readonly upsertWakeLeaseStmt: StatementSync
  private readonly insertWakeEventStmt: StatementSync
  private readonly upsertReadStmt: StatementSync
  private readonly insertIdempotencyStmt: StatementSync

  constructor(dbPath: string, now: () => number = Date.now) {
    this.now = now
    mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(dbPath)
    chmodSync(dbPath, 0o600) // SQLite 默认 0644&umask；每次打开收紧到 0600（治愈漂移）
    this.db.exec('PRAGMA foreign_keys = ON')
    this.migrate()
    this.insertRoomStmt = this.db.prepare('INSERT INTO rooms (room_id, kind, name, member_ids) VALUES (?, ?, ?, ?)')
    this.insertMessageStmt = this.db.prepare('INSERT INTO messages (message_id, seq, room_id, room_seq, sender_id, body, mentions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    this.insertWakeStmt = this.db.prepare('INSERT INTO wakes (wake_id, actor_id, room_id, source_seq, cause, status, claimed_by, claimed_until, created_at, acked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    this.updateWakeStmt = this.db.prepare('UPDATE wakes SET status = ?, claimed_by = ?, claimed_until = ?, acked_at = ? WHERE wake_id = ?')
    this.upsertWakeLeaseStmt = this.db.prepare('INSERT INTO wake_leases (wake_id, attempt, state, claimed_by, lease_expires_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (wake_id) DO UPDATE SET attempt = excluded.attempt, state = excluded.state, claimed_by = excluded.claimed_by, lease_expires_at = excluded.lease_expires_at, updated_at = excluded.updated_at')
    this.insertWakeEventStmt = this.db.prepare('INSERT INTO wake_events (event_id, wake_id, type, attempt, actor_id, claimed_by, lease_expires_at, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    this.upsertReadStmt = this.db.prepare('INSERT INTO read_cursors (actor_id, room_id, last_read_room_seq) VALUES (?, ?, ?) ON CONFLICT (actor_id, room_id) DO UPDATE SET last_read_room_seq = excluded.last_read_room_seq')
    this.insertIdempotencyStmt = this.db.prepare('INSERT INTO idempotency (key, value) VALUES (?, ?)')
  }

  /** 版本表 + 顺序应用未跑过的迁移；同一库重复 init 幂等（无待应用迁移即零写入）。 */
  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS chatd_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const row = this.db.prepare('SELECT value FROM chatd_meta WHERE key = ?').get('schema_version') as VersionRow | undefined
    const current = row === undefined ? 0 : Number(row.value)
    if (!Number.isInteger(current) || current < 0) throw new ChatdStoreError(`chatd_meta.schema_version 损坏：${row?.value ?? '(空)'}`)
    if (current > SCHEMA_VERSION) {
      throw new ChatdStoreError(`数据库 schema 版本 ${String(current)} 高于本程序支持的 ${String(SCHEMA_VERSION)}：拒绝降级启动（换新版本程序或回滚库）`)
    }
    for (const migration of MIGRATIONS) {
      if (migration.version <= current) continue
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.db.exec(migration.sql)
        this.upsertMetaRaw('schema_version', String(migration.version))
        this.db.exec('COMMIT')
      } catch (err) {
        this.db.exec('ROLLBACK')
        throw new ChatdStoreError(`迁移 v${String(migration.version)}（${migration.name}）失败：${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  /** migrate 阶段的 meta 写（此时常规语句尚未 prepare，用完即弃，避免构造顺序耦合）。 */
  private upsertMetaRaw(key: string, value: string): void {
    this.db.prepare('INSERT INTO chatd_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  hydrate(target: MockState): void {
    const rooms = this.db.prepare('SELECT room_id, kind, name, member_ids FROM rooms ORDER BY rowid').all() as unknown as RoomRow[]
    for (const r of rooms) {
      target.rooms.set(r.room_id, {
        roomId: r.room_id,
        kind: r.kind as RoomKind,
        name: r.name,
        memberIds: parseJsonArray(r.member_ids, 'rooms.member_ids'),
        headRoomSeq: 0, // 先占位，messages 加载后按投影回填
      })
    }
    const messages = this.db.prepare('SELECT message_id, seq, room_id, room_seq, sender_id, body, mentions, created_at FROM messages ORDER BY seq').all() as unknown as MessageRow[]
    for (const m of messages) {
      target.messages.push({
        messageId: m.message_id,
        seq: m.seq,
        roomSeq: m.room_seq,
        roomId: m.room_id,
        senderId: m.sender_id,
        body: m.body,
        mentions: parseJsonArray(m.mentions, 'messages.mentions'),
        createdAt: m.created_at,
      })
    }
    const wakes = this.db.prepare('SELECT wake_id, actor_id, room_id, source_seq, cause, status, claimed_by, claimed_until, created_at, acked_at FROM wakes ORDER BY rowid').all() as unknown as WakeRow[]
    for (const w of wakes) {
      target.wakes.push({
        wakeId: w.wake_id,
        actorId: w.actor_id,
        roomId: w.room_id,
        sourceSeq: w.source_seq,
        cause: w.cause as WakeCause,
        status: w.status as WakeStatus,
        claimedBy: w.claimed_by,
        claimedUntil: w.claimed_until,
        createdAt: w.created_at,
        ackedAt: w.acked_at,
      })
    }
    const reads = this.db.prepare('SELECT actor_id, room_id, last_read_room_seq FROM read_cursors').all() as unknown as ReadRow[]
    for (const r of reads) target.reads.set(`${r.actor_id}|${r.room_id}`, r.last_read_room_seq)
    const idems = this.db.prepare('SELECT key, value FROM idempotency').all() as unknown as IdempotencyRow[]
    for (const i of idems) target.idempotency.set(i.key, JSON.parse(i.value) as unknown)

    // wake 租约投影恢复（P1-2）：claim/ack/dead 状态跨重启续存。
    const leases = this.db.prepare('SELECT wake_id, attempt, state, claimed_by, lease_expires_at, updated_at FROM wake_leases ORDER BY rowid').all() as unknown as WakeLeaseRow[]
    for (const l of leases) {
      target.wakeLeases.set(l.wake_id, {
        wakeId: l.wake_id,
        attempt: l.attempt,
        state: l.state as WakeLeaseState,
        claimedBy: l.claimed_by,
        leaseExpiresAt: l.lease_expires_at,
        updatedAt: l.updated_at,
      })
    }
    // 审计事件恢复（append-only 历史，按 event_id 序）；计数器续到库内最大值（无空洞）。
    const events = this.db.prepare('SELECT event_id, wake_id, type, attempt, actor_id, claimed_by, lease_expires_at, at FROM wake_events ORDER BY event_id').all() as unknown as WakeEventRow[]
    for (const e of events) {
      target.wakeEvents.push({
        eventId: e.event_id,
        wakeId: e.wake_id,
        type: e.type as WakeEvent['type'],
        attempt: e.attempt,
        actorId: e.actor_id,
        claimedBy: e.claimed_by,
        leaseExpiresAt: e.lease_expires_at,
        at: e.at,
      })
    }
    const seqRow = this.db.prepare('SELECT MAX(event_id) AS max_id FROM wake_events').get() as unknown as WakeEventSeqRow
    target.wakeEventSeq = seqRow.max_id ?? 0

    // headRoomSeq 为可重建投影（台账哲学）：每房 head = MAX(room_seq)，不落 rooms 表（send 零额外写）。
    const heads = this.db.prepare('SELECT room_id, MAX(room_seq) AS head FROM messages GROUP BY room_id').all() as unknown as HeadRow[]
    for (const h of heads) {
      const room = target.rooms.get(h.room_id)
      if (room !== undefined) room.headRoomSeq = h.head
    }

    // seq 计数器恢复：三表均只增不删，count/max 即历史分配数（无空洞）。
    target.roomSeq = target.rooms.size
    target.msgSeq = messages.length === 0 ? 0 : messages[messages.length - 1]?.seq ?? 0
    target.wakeSeq = target.wakes.length
  }

  insertRoom(room: MockRoom): void {
    this.insertRoomStmt.run(room.roomId, room.kind, room.name, JSON.stringify(room.memberIds))
  }

  appendMessage(message: MockMessage, wakes: readonly MockWake[], leases: readonly WakeLease[] = [], events: readonly WakeEvent[] = []): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.insertMessageStmt.run(
        message.messageId,
        message.seq,
        message.roomId,
        message.roomSeq,
        message.senderId,
        message.body,
        JSON.stringify(message.mentions),
        message.createdAt,
      )
      for (const w of wakes) this.insertWakeStmt.run(w.wakeId, w.actorId, w.roomId, w.sourceSeq, w.cause, w.status, w.claimedBy, w.claimedUntil, w.createdAt, w.ackedAt)
      for (const l of leases) this.upsertWakeLeaseStmt.run(l.wakeId, l.attempt, l.state, l.claimedBy, l.leaseExpiresAt, l.updatedAt)
      for (const e of events) this.insertWakeEventStmt.run(e.eventId, e.wakeId, e.type, e.attempt, e.actorId, e.claimedBy, e.leaseExpiresAt, e.at)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  setRead(actorId: string, roomId: string, lastReadRoomSeq: number): void {
    this.upsertReadStmt.run(actorId, roomId, lastReadRoomSeq)
  }

  updateWake(wake: MockWake): void {
    this.updateWakeStmt.run(wake.status, wake.claimedBy, wake.claimedUntil, wake.ackedAt, wake.wakeId)
  }

  /** 租约迁移三写一事务：wakes 投影行 + wake_leases 覆盖 + wake_events 审计追加（P1-2 wake lease）。 */
  recordWakeTransition(wake: MockWake, lease: WakeLease, event: WakeEvent): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.updateWakeStmt.run(wake.status, wake.claimedBy, wake.claimedUntil, wake.ackedAt, wake.wakeId)
      this.upsertWakeLeaseStmt.run(lease.wakeId, lease.attempt, lease.state, lease.claimedBy, lease.leaseExpiresAt, lease.updatedAt)
      this.insertWakeEventStmt.run(event.eventId, event.wakeId, event.type, event.attempt, event.actorId, event.claimedBy, event.leaseExpiresAt, event.at)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  recordIdempotency(key: string, value: unknown): void {
    this.insertIdempotencyStmt.run(key, JSON.stringify(value))
  }

  /** 仅供诊断/测试：当前库 schema 版本。 */
  schemaVersion(): number {
    const row = this.db.prepare('SELECT value FROM chatd_meta WHERE key = ?').get('schema_version') as VersionRow | undefined
    return row === undefined ? 0 : Number(row.value)
  }

  close(): void {
    if (this.db.isOpen) this.db.close()
  }
}
