/**
 * SQLite 持久化存储（Phase1 模块 C 最小刀 / P1-2 前半）：node:sqlite（Node 内置，零第三方依赖）。
 * 范围：rooms/messages/wakes/read_cursors/idempotency 最小集——send/read/ack 落库，重启 hydrate 恢复；
 *       inbox 由 wakes+reads 派生，不单独建表。不接 vendor collab、不写公司目录、不迁 Matrix 数据。
 * 依据：docs/sentinel-logs/Phase1实现拆解-2026-11-17.md 模块 C（C 先做内存/mock → 内存→SQLite）。
 * 纪律：
 *  - 数据库文件权限 0600（每次打开都 chmod 复核，可治愈漂移）；父目录按需创建 0700（与 socket 同纪律）。
 *  - messages append-only：schema 触发器直接 ABORT 任何 UPDATE/DELETE（机制保证，非自律）。
 *  - schema 版本表 chatd_meta + 顺序迁移列表：init 幂等（已应用的迁移跳过）；高版本库拒绝降级启动。
 *  - 写路径 DB 先行（失败抛错 → 上层归一 WB_INTERNAL，内存不落地）；appendMessage 单事务保证
 *    message 与关联 wakes 原子可见。
 */
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type { ChatStore, MockMessage, MockRoom, MockState, MockWake, RoomKind, WakeCause, WakeStatus } from './types.ts'

/** 当前程序 schema 版本（= 已应用迁移的最大版本）。 */
export const SCHEMA_VERSION = 1

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
  private readonly db: DatabaseSync
  private readonly insertRoomStmt: StatementSync
  private readonly insertMessageStmt: StatementSync
  private readonly insertWakeStmt: StatementSync
  private readonly updateWakeStmt: StatementSync
  private readonly upsertReadStmt: StatementSync
  private readonly insertIdempotencyStmt: StatementSync

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(dbPath)
    chmodSync(dbPath, 0o600) // SQLite 默认 0644&umask；每次打开收紧到 0600（治愈漂移）
    this.db.exec('PRAGMA foreign_keys = ON')
    this.migrate()
    this.insertRoomStmt = this.db.prepare('INSERT INTO rooms (room_id, kind, name, member_ids) VALUES (?, ?, ?, ?)')
    this.insertMessageStmt = this.db.prepare('INSERT INTO messages (message_id, seq, room_id, room_seq, sender_id, body, mentions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    this.insertWakeStmt = this.db.prepare('INSERT INTO wakes (wake_id, actor_id, room_id, source_seq, cause, status, claimed_by, claimed_until, created_at, acked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    this.updateWakeStmt = this.db.prepare('UPDATE wakes SET status = ?, claimed_by = ?, claimed_until = ?, acked_at = ? WHERE wake_id = ?')
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

  appendMessage(message: MockMessage, wakes: readonly MockWake[]): void {
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

  recordIdempotency(key: string, value: unknown): void {
    this.insertIdempotencyStmt.run(key, JSON.stringify(value))
  }

  /** 仅供诊断/测试：当前库 schema 版本。 */
  schemaVersion(): number {
    const row = this.db.prepare('SELECT value FROM chatd_meta WHERE key = ?').get('schema_version') as VersionRow | undefined
    return row === undefined ? 0 : Number(row.value)
  }

  close(): void {
    if (this.db.open) this.db.close()
  }
}
