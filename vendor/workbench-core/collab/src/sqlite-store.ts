import { randomUUID } from 'node:crypto'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { CollabError } from './errors.ts'
import { sha256Hex } from './keys.ts'
import type {
  ActorRow,
  AppendMessageInput,
  ChatStore,
  ChatTx,
  CommandName,
  CommandRow,
  InboxTotalsRow,
  LastMessageRow,
  MentionDigestRow,
  MessageRow,
  ReadStateRow,
  RoomAccessRow,
  RoomDigestRow,
  RoomMemberRow,
  RoomRow,
  RoomStatsRow,
  WakeItemRow,
} from './store.ts'
import type { ActorStatus, MemberRole, MessageKind, RoomKind, WakeCause, WakeChannel, WakePriority, WakeStatus } from './types.ts'

/** Adapter-internal schema version (fresh v0.8 slice; no legacy migration is attempted). */
const SCHEMA_VERSION = 2

/**
 * DDL of the v0.8 chat slice (`docs/plan/chat-room-storage.md` §5.2, implemented
 * subset). Deferred tables (wake_batch/wake_scope/actor_wake_state/room_loop_state/
 * chat_events/chat_outbox/chat_inbound_*) are documented as gaps in the README, not
 * created empty here.
 */
const DDL = `
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  checksum TEXT NOT NULL
) STRICT;

CREATE TABLE actors (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 64 AND id NOT GLOB '*[^a-z0-9_-]*'),
  kind TEXT NOT NULL CHECK (kind IN ('human','agent')),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','retired')),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('broadcast','group','dm')),
  name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES actors(id),
  dm_key TEXT UNIQUE,
  dm_low TEXT,
  dm_high TEXT,
  created_at INTEGER NOT NULL,
  archived_at INTEGER,
  UNIQUE (dm_low, dm_high),
  CHECK (kind <> 'dm' OR (dm_key IS NOT NULL AND dm_low IS NOT NULL AND dm_high IS NOT NULL)),
  CHECK (dm_key IS NULL OR length(dm_key) = 64),
  CHECK (dm_low IS NULL OR dm_low < dm_high)
) STRICT;

CREATE UNIQUE INDEX ux_rooms_one_broadcast ON rooms(kind) WHERE kind = 'broadcast';

CREATE TABLE room_members (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  actor_id TEXT NOT NULL REFERENCES actors(id),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  can_broadcast INTEGER NOT NULL DEFAULT 0 CHECK (can_broadcast IN (0,1)),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, actor_id)
) STRICT;

CREATE TABLE messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  room_seq INTEGER NOT NULL,
  sender_id TEXT NOT NULL REFERENCES actors(id),
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'chat'
    CHECK (kind IN ('chat','request','result','handoff','status')),
  ticket_key TEXT,
  mention_all INTEGER NOT NULL DEFAULT 0 CHECK (mention_all IN (0,1)),
  reply_to_seq INTEGER REFERENCES messages(seq),
  created_at INTEGER NOT NULL,
  UNIQUE (room_id, room_seq)
) STRICT;

CREATE TABLE message_mentions (
  message_seq INTEGER NOT NULL REFERENCES messages(seq),
  actor_id TEXT NOT NULL REFERENCES actors(id),
  PRIMARY KEY (message_seq, actor_id)
) STRICT;

CREATE TABLE room_stats (
  room_id TEXT PRIMARY KEY REFERENCES rooms(id),
  head_seq INTEGER NOT NULL DEFAULT 0 CHECK (head_seq >= 0),
  head_room_seq INTEGER NOT NULL DEFAULT 0 CHECK (head_room_seq >= 0),
  last_activity_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE read_state (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  actor_id TEXT NOT NULL REFERENCES actors(id),
  last_read_seq INTEGER NOT NULL DEFAULT 0 CHECK (last_read_seq >= 0),
  last_read_room_seq INTEGER NOT NULL DEFAULT 0 CHECK (last_read_room_seq >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, actor_id)
) STRICT;

CREATE TABLE wake_item (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES actors(id),
  cause TEXT NOT NULL
    CHECK (cause IN ('mention','dm','reply','mention_all','on_call','system')),
  room_id TEXT NOT NULL REFERENCES rooms(id),
  source_seq INTEGER NOT NULL REFERENCES messages(seq),
  source_room_seq INTEGER,
  channel TEXT NOT NULL DEFAULT 'dsh_followup'
    CHECK (channel IN ('dsh_followup','dsh_session_resume','human_panel')),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','claimed','delivered','acked','failed','suppressed')),
  dedupe_key TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  lease_until INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  acked_at INTEGER
) STRICT;

CREATE TABLE chat_command_log (
  actor_id TEXT NOT NULL REFERENCES actors(id),
  command TEXT NOT NULL CHECK (command IN ('send','mark_read','ack')),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (actor_id, command, idempotency_key)
) STRICT;

-- Append path index budget: the UNIQUE(room_id, room_seq) index serves room pages
-- and reply lookups; the global seq primary key serves batch-by-seq reads. Adding
-- the plan's extra (room_id, seq DESC) / sender_id indexes cost ~4x append throughput
-- (measured) and serves no current query, so they are left out.
CREATE INDEX idx_room_members_actor ON room_members(actor_id);
CREATE INDEX idx_mentions_actor ON message_mentions(actor_id, message_seq);
CREATE INDEX idx_read_state_actor ON read_state(actor_id, room_id);
CREATE INDEX idx_room_stats_activity ON room_stats(last_activity_at DESC);
CREATE INDEX idx_wake_pending ON wake_item(actor_id, status, next_attempt_at)
  WHERE status IN ('pending','claimed');
CREATE INDEX idx_wake_room_source ON wake_item(room_id, source_seq);

CREATE TRIGGER tr_message_bump_stats
AFTER INSERT ON messages
BEGIN
  UPDATE room_stats
  SET head_seq = NEW.seq,
      head_room_seq = NEW.room_seq,
      last_activity_at = NEW.created_at,
      updated_at = NEW.created_at
  WHERE room_id = NEW.room_id;
END;

CREATE TRIGGER tr_read_state_monotonic
BEFORE UPDATE ON read_state
WHEN NEW.last_read_seq < OLD.last_read_seq
  OR NEW.last_read_room_seq < OLD.last_read_room_seq
BEGIN
  SELECT RAISE(ABORT, 'READ_STATE_BACKWARDS');
END;

CREATE TRIGGER tr_message_append_only
BEFORE UPDATE ON messages
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER tr_message_no_delete
BEFORE DELETE ON messages
BEGIN SELECT RAISE(ABORT, 'append-only'); END;
`

interface ActorDbRow {
  id: string
  kind: string
  name: string
  status: string
  created_at: unknown
}
interface RoomDbRow {
  id: string
  kind: string
  name: string
  created_by: string
  dm_key: string | null
  dm_low: string | null
  dm_high: string | null
  created_at: unknown
  archived_at: unknown
}
interface MemberDbRow {
  room_id: string
  actor_id: string
  role: string
  can_broadcast: unknown
  joined_at: unknown
}
interface StatsDbRow {
  room_id: string
  head_seq: unknown
  head_room_seq: unknown
  last_activity_at: unknown
  updated_at: unknown
}
interface ReadStateDbRow {
  room_id: string
  actor_id: string
  last_read_seq: unknown
  last_read_room_seq: unknown
  updated_at: unknown
}
interface MessageDbRow {
  seq: unknown
  id: string
  room_id: string
  room_seq: unknown
  sender_id: string
  body: string
  kind: string
  ticket_key: string | null
  mention_all: unknown
  reply_to_seq: unknown
  created_at: unknown
}
interface LastMessageDbRow {
  seq: unknown
  room_id: string
  room_seq: unknown
  sender_id: string
  kind: string
  created_at: unknown
}
interface WakeDbRow {
  id: string
  actor_id: string
  cause: string
  room_id: string
  source_seq: unknown
  source_room_seq: unknown
  channel: string
  priority: string
  status: string
  dedupe_key: string
  attempts: unknown
  next_attempt_at: unknown
  lease_until: unknown
  last_error: string | null
  created_at: unknown
  acked_at: unknown
}
interface CommandDbRow {
  actor_id: string
  command: string
  idempotency_key: string
  request_hash: string
  response_json: string
  created_at: unknown
}
interface AccessDbRow {
  actor_id: string
  actor_kind: string
  actor_name: string
  actor_status: string
  actor_created_at: unknown
  room_id: string
  room_kind: string
  room_name: string
  room_created_by: string
  room_dm_key: string | null
  room_dm_low: string | null
  room_dm_high: string | null
  room_created_at: unknown
  room_archived_at: unknown
  member_role: string
  member_can_broadcast: unknown
  member_joined_at: unknown
}

interface DigestDbRow {
  room_id: string
  kind: string
  name: string
  head_seq: unknown
  head_room_seq: unknown
  last_read_seq: unknown
  last_read_room_seq: unknown
  unread: unknown
  last_activity_at: unknown
}
interface MentionCountDbRow {
  room_id: string
  mention_count: unknown
}
interface MentionDigestDbRow {
  seq: unknown
  room_id: string
  sender_id: string
  mention_all: unknown
}
interface CountDbRow {
  count: unknown
}

const ACTIVE_WAKE_SQL = "('pending','claimed','delivered')"
const WAKE_PRIORITY_ORDER =
  "CASE priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END DESC"

function asNumber(value: unknown): number {
  return typeof value === 'bigint' ? Number(value) : Number(value)
}

function asBooleanInt(value: boolean): number {
  return value ? 1 : 0
}

function asString(value: unknown): string {
  return String(value)
}

function actorRow(row: ActorDbRow): ActorRow {
  return {
    id: row.id,
    kind: row.kind === 'human' ? 'human' : 'agent',
    name: row.name,
    status: row.status === 'paused' ? 'paused' : row.status === 'retired' ? 'retired' : 'active',
    createdAt: asNumber(row.created_at),
  }
}

function roomRow(row: RoomDbRow): RoomRow {
  const kind: RoomKind = row.kind === 'broadcast' ? 'broadcast' : row.kind === 'dm' ? 'dm' : 'group'
  return {
    id: row.id,
    kind,
    name: row.name,
    createdBy: row.created_by,
    dmKey: row.dm_key,
    dmLow: row.dm_low,
    dmHigh: row.dm_high,
    createdAt: asNumber(row.created_at),
    archivedAt: row.archived_at === null ? null : asNumber(row.archived_at),
  }
}

function memberRow(row: MemberDbRow): RoomMemberRow {
  const role: MemberRole = row.role === 'owner' ? 'owner' : 'member'
  return {
    roomId: row.room_id,
    actorId: row.actor_id,
    role,
    canBroadcast: asNumber(row.can_broadcast) === 1,
    joinedAt: asNumber(row.joined_at),
  }
}

function statsRow(row: StatsDbRow): RoomStatsRow {
  return {
    roomId: row.room_id,
    headSeq: asNumber(row.head_seq),
    headRoomSeq: asNumber(row.head_room_seq),
    lastActivityAt: asNumber(row.last_activity_at),
    updatedAt: asNumber(row.updated_at),
  }
}

function readStateRow(row: ReadStateDbRow): ReadStateRow {
  return {
    roomId: row.room_id,
    actorId: row.actor_id,
    lastReadSeq: asNumber(row.last_read_seq),
    lastReadRoomSeq: asNumber(row.last_read_room_seq),
    updatedAt: asNumber(row.updated_at),
  }
}

function messageRow(row: MessageDbRow, mentions: string[]): MessageRow {
  const kind: MessageKind =
    row.kind === 'request' || row.kind === 'result' || row.kind === 'handoff' || row.kind === 'status'
      ? row.kind
      : 'chat'
  return {
    seq: asNumber(row.seq),
    id: row.id,
    roomId: row.room_id,
    roomSeq: asNumber(row.room_seq),
    senderId: row.sender_id,
    body: row.body,
    kind,
    ticketKey: row.ticket_key,
    mentionAll: asNumber(row.mention_all) === 1,
    mentions,
    replyToSeq: row.reply_to_seq === null ? null : asNumber(row.reply_to_seq),
    createdAt: asNumber(row.created_at),
  }
}

function lastMessageRow(row: LastMessageDbRow): LastMessageRow {
  const kind: MessageKind =
    row.kind === 'request' || row.kind === 'result' || row.kind === 'handoff' || row.kind === 'status'
      ? row.kind
      : 'chat'
  return {
    seq: asNumber(row.seq),
    roomId: row.room_id,
    roomSeq: asNumber(row.room_seq),
    senderId: row.sender_id,
    kind,
    createdAt: asNumber(row.created_at),
  }
}

function wakeRow(row: WakeDbRow): WakeItemRow {
  const cause: WakeCause =
    row.cause === 'dm' || row.cause === 'reply' || row.cause === 'mention_all' || row.cause === 'on_call' || row.cause === 'system'
      ? row.cause
      : 'mention'
  const channel: WakeChannel =
    row.channel === 'dsh_session_resume' || row.channel === 'human_panel' ? row.channel : 'dsh_followup'
  const priority: WakePriority =
    row.priority === 'low' || row.priority === 'high' || row.priority === 'urgent' ? row.priority : 'normal'
  const status: WakeStatus =
    row.status === 'claimed' ||
    row.status === 'delivered' ||
    row.status === 'acked' ||
    row.status === 'failed' ||
    row.status === 'suppressed'
      ? row.status
      : 'pending'
  return {
    id: row.id,
    actorId: row.actor_id,
    cause,
    roomId: row.room_id,
    sourceSeq: asNumber(row.source_seq),
    sourceRoomSeq: row.source_room_seq === null ? null : asNumber(row.source_room_seq),
    channel,
    priority,
    status,
    dedupeKey: row.dedupe_key,
    attempts: asNumber(row.attempts),
    nextAttemptAt: asNumber(row.next_attempt_at),
    leaseUntil: row.lease_until === null ? null : asNumber(row.lease_until),
    lastError: row.last_error,
    createdAt: asNumber(row.created_at),
    ackedAt: row.acked_at === null ? null : asNumber(row.acked_at),
  }
}

function commandRow(row: CommandDbRow): CommandRow {
  const command: CommandName = row.command === 'mark_read' ? 'mark_read' : row.command === 'ack' ? 'ack' : 'send'
  return {
    actorId: row.actor_id,
    command,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    responseJson: row.response_json,
    createdAt: asNumber(row.created_at),
  }
}

function digestRow(row: DigestDbRow, mentionCount: number): RoomDigestRow {
  const kind: RoomKind = row.kind === 'broadcast' ? 'broadcast' : row.kind === 'dm' ? 'dm' : 'group'
  return {
    roomId: row.room_id,
    kind,
    name: row.name,
    headSeq: asNumber(row.head_seq),
    headRoomSeq: asNumber(row.head_room_seq),
    lastReadSeq: asNumber(row.last_read_seq),
    lastReadRoomSeq: asNumber(row.last_read_room_seq),
    unread: asNumber(row.unread),
    mentionCount,
    lastActivityAt: asNumber(row.last_activity_at),
  }
}

function chunked<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ')
}

class SqliteTx implements ChatTx {
  readonly kind = 'chat-tx' as const
  private readonly db: DatabaseSync
  private savepoints = 0
  /** Per-transaction read cache: one SELECT answers actor+room+membership per item. */
  readonly accessCache = new Map<string, RoomAccessRow | null>()
  /** Per-transaction authority for `room_stats` heads (the writer is serialized). */
  readonly roomHeads = new Map<string, RoomStatsRow>()

  constructor(db: DatabaseSync) {
    this.db = db
  }

  invalidateAccess(): void {
    this.accessCache.clear()
  }

  invalidateHeads(): void {
    this.roomHeads.clear()
  }

  invalidateAll(): void {
    this.accessCache.clear()
    this.roomHeads.clear()
  }

  async savepoint<T>(fn: () => T | Promise<T>): Promise<T> {
    const name = `sp_${this.savepoints}`
    this.savepoints += 1
    this.db.exec(`SAVEPOINT ${name}`)
    try {
      const result = await fn()
      this.db.exec(`RELEASE ${name}`)
      return result
    } catch (error) {
      try {
        this.db.exec(`ROLLBACK TO ${name}`)
        this.db.exec(`RELEASE ${name}`)
      } catch {
        // The outer transaction will be rolled back; keep the original error.
      }
      // Values cached before the savepoint are still valid, but entries written
      // inside the rolled-back region are not: drop the caches and re-read.
      this.invalidateAll()
      throw error
    }
  }
}

/** SQLite adapter (single writer, WAL). An implementation detail, never a public type. */
export class SqliteChatStore implements ChatStore {
  private readonly db: DatabaseSync
  private readonly statements = new Map<string, StatementSync>()
  private activeTx: SqliteTx | null = null
  private closed = false

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    try {
      this.db.exec('PRAGMA journal_mode = WAL')
      this.db.exec('PRAGMA synchronous = FULL')
      this.db.exec('PRAGMA foreign_keys = ON')
      this.db.exec('PRAGMA busy_timeout = 5000')
      this.migrate()
    } catch (error) {
      try {
        this.db.close()
      } catch {
        // ignore
      }
      throw this.wrap(error)
    }
  }

  // --- transaction ----------------------------------------------------------

  async transaction<T>(fn: (tx: ChatTx) => T | Promise<T>): Promise<T> {
    this.assertOpen()
    if (this.activeTx !== null) return fn(this.activeTx)
    try {
      this.db.exec('BEGIN IMMEDIATE')
    } catch (error) {
      throw this.wrap(error)
    }
    const tx = new SqliteTx(this.db)
    this.activeTx = tx
    try {
      const result = await fn(tx)
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // keep the original error
      }
      throw this.wrap(error)
    } finally {
      this.activeTx = null
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.statements.clear()
    this.db.close()
  }

  // --- actors ---------------------------------------------------------------

  async insertActor(tx: ChatTx | null, row: ActorRow): Promise<void> {
    this.requireTx(tx)
    try {
      this.stmt('INSERT INTO actors (id, kind, name, status, created_at) VALUES (?, ?, ?, ?, ?)').run(
        row.id,
        row.kind,
        row.name,
        row.status,
        row.createdAt,
      )
    } catch (error) {
      if (isUniqueViolation(error)) throw new CollabError('ACTOR_ALREADY_EXISTS', `actor already exists: ${row.id}`)
      throw this.wrap(error)
    }
  }

  async getActor(tx: ChatTx | null, id: string): Promise<ActorRow | undefined> {
    this.assertOpen()
    this.checkReadTx(tx)
    const row = this.stmt('SELECT id, kind, name, status, created_at FROM actors WHERE id = ?').get(id) as
      | ActorDbRow
      | undefined
    return row === undefined ? undefined : actorRow(row)
  }

  async getActors(tx: ChatTx | null, ids: readonly string[]): Promise<ActorRow[]> {
    this.assertOpen()
    this.checkReadTx(tx)
    if (ids.length === 0) return []
    const rows: ActorRow[] = []
    for (const chunk of chunked(ids, 400)) {
      const result = this.stmt(
        `SELECT id, kind, name, status, created_at FROM actors WHERE id IN (${placeholders(chunk.length)})`,
      ).all(...chunk) as unknown as ActorDbRow[]
      for (const row of result) rows.push(actorRow(row))
    }
    return rows
  }

  async listActors(tx: ChatTx | null): Promise<ActorRow[]> {
    this.assertOpen()
    this.checkReadTx(tx)
    const rows = this.stmt('SELECT id, kind, name, status, created_at FROM actors ORDER BY id ASC').all() as unknown as ActorDbRow[]
    return rows.map(actorRow)
  }

  async updateActorStatus(tx: ChatTx | null, id: string, status: ActorStatus): Promise<void> {
    const active = this.requireTxObject(tx)
    const result = this.stmt('UPDATE actors SET status = ? WHERE id = ?').run(status, id)
    active.invalidateAccess()
    if (asNumber(result.changes) === 0) throw new CollabError('ACTOR_NOT_FOUND', `actor not found: ${id}`)
  }

  // --- rooms ----------------------------------------------------------------

  async getRoomAccess(tx: ChatTx | null, roomId: string, actorId: string): Promise<RoomAccessRow | undefined> {
    this.assertOpen()
    this.checkReadTx(tx)
    const cache = tx instanceof SqliteTx ? tx : null
    const key = `${roomId}\u0000${actorId}`
    if (cache !== null) {
      const cached = cache.accessCache.get(key)
      if (cached !== undefined) return cached === null ? undefined : cached
    }
    const row = this.stmt(
      `SELECT a.id AS actor_id, a.kind AS actor_kind, a.name AS actor_name, a.status AS actor_status,
              a.created_at AS actor_created_at,
              r.id AS room_id, r.kind AS room_kind, r.name AS room_name, r.created_by AS room_created_by,
              r.dm_key AS room_dm_key, r.dm_low AS room_dm_low, r.dm_high AS room_dm_high,
              r.created_at AS room_created_at, r.archived_at AS room_archived_at,
              m.role AS member_role, m.can_broadcast AS member_can_broadcast, m.joined_at AS member_joined_at
       FROM room_members m
       JOIN actors a ON a.id = m.actor_id
       JOIN rooms r ON r.id = m.room_id
       WHERE m.room_id = ? AND m.actor_id = ?`,
    ).get(roomId, actorId) as AccessDbRow | undefined
    const result: RoomAccessRow | undefined =
      row === undefined
        ? undefined
        : {
            actor: actorRow({
              id: row.actor_id,
              kind: row.actor_kind,
              name: row.actor_name,
              status: row.actor_status,
              created_at: row.actor_created_at,
            }),
            room: roomRow({
              id: row.room_id,
              kind: row.room_kind,
              name: row.room_name,
              created_by: row.room_created_by,
              dm_key: row.room_dm_key,
              dm_low: row.room_dm_low,
              dm_high: row.room_dm_high,
              created_at: row.room_created_at,
              archived_at: row.room_archived_at,
            }),
            member: memberRow({
              room_id: row.room_id,
              actor_id: row.actor_id,
              role: row.member_role,
              can_broadcast: row.member_can_broadcast,
              joined_at: row.member_joined_at,
            }),
          }
    if (cache !== null) cache.accessCache.set(key, result ?? null)
    return result
  }

  async insertRoom(tx: ChatTx | null, row: RoomRow): Promise<void> {
    const active = this.requireTxObject(tx)
    const existing = this.stmt('SELECT id FROM rooms WHERE id = ?').get(row.id)
    if (existing !== undefined) throw new CollabError('INVALID_INPUT', `room already exists: ${row.id}`)
    if (row.kind === 'broadcast') {
      const broadcast = this.stmt("SELECT id FROM rooms WHERE kind = 'broadcast' LIMIT 1").get()
      if (broadcast !== undefined) throw new CollabError('BROADCAST_ALREADY_EXISTS', 'one broadcast room per database')
    }
    if (row.dmKey !== null) {
      const duplicate = this.stmt('SELECT id FROM rooms WHERE dm_key = ? OR (dm_low = ? AND dm_high = ?)').get(
        row.dmKey,
        row.dmLow,
        row.dmHigh,
      )
      if (duplicate !== undefined) throw new CollabError('INVALID_INPUT', 'duplicate DM pair')
    }
    try {
      this.stmt(
        `INSERT INTO rooms (id, kind, name, created_by, dm_key, dm_low, dm_high, created_at, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(row.id, row.kind, row.name, row.createdBy, row.dmKey, row.dmLow, row.dmHigh, row.createdAt, row.archivedAt)
    } catch (error) {
      if (isUniqueViolation(error)) throw new CollabError('INVALID_INPUT', `room already exists: ${row.id}`)
      throw this.wrap(error)
    } finally {
      active.invalidateAccess()
    }
  }

  async getRoom(tx: ChatTx | null, id: string): Promise<RoomRow | undefined> {
    this.assertOpen()
    this.checkReadTx(tx)
    const row = this.selectRoom('WHERE id = ?', id)
    return row
  }

  async findDmRoom(tx: ChatTx | null, dmLow: string, dmHigh: string): Promise<RoomRow | undefined> {
    this.assertOpen()
    this.checkReadTx(tx)
    return this.selectRoom('WHERE dm_low = ? AND dm_high = ?', dmLow, dmHigh)
  }

  async findBroadcastRoom(tx: ChatTx | null): Promise<RoomRow | undefined> {
    this.assertOpen()
    this.checkReadTx(tx)
    return this.selectRoom("WHERE kind = 'broadcast' LIMIT 1")
  }

  async hasAnyBroadcastRoom(tx: ChatTx | null): Promise<boolean> {
    this.assertOpen()
    this.checkReadTx(tx)
    const row = this.stmt("SELECT id FROM rooms WHERE kind = 'broadcast' LIMIT 1").get()
    return row !== undefined
  }

  async listRoomsForActor(tx: ChatTx | null, actorId: string): Promise<RoomRow[]> {
    this.assertOpen()
    this.checkReadTx(tx)
    const rows = this.stmt(
      `SELECT r.id, r.kind, r.name, r.created_by, r.dm_key, r.dm_low, r.dm_high, r.created_at, r.archived_at
       FROM rooms r JOIN room_members rm ON rm.room_id = r.id
       WHERE rm.actor_id = ? ORDER BY r.created_at ASC, r.id ASC`,
    ).all(actorId) as unknown as RoomDbRow[]
    return rows.map(roomRow)
  }

  // --- members --------------------------------------------------------------

  async insertMembers(tx: ChatTx | null, rows: readonly RoomMemberRow[]): Promise<void> {
    const active = this.requireTxObject(tx)
    const insert = this.stmt(
      `INSERT INTO room_members (room_id, actor_id, role, can_broadcast, joined_at) VALUES (?, ?, ?, ?, ?)`,
    )
    try {
      for (const row of rows) {
        insert.run(row.roomId, row.actorId, row.role, asBooleanInt(row.canBroadcast), row.joinedAt)
      }
    } catch (error) {
      if (isUniqueViolation(error)) throw new CollabError('INVALID_INPUT', 'duplicate room member')
      throw this.wrap(error)
    } finally {
      active.invalidateAccess()
    }
  }

  async getMember(tx: ChatTx | null, roomId: string, actorId: string): Promise<RoomMemberRow | undefined> {
    this.assertOpen()
    this.checkReadTx(tx)
    const row = this.stmt(
      'SELECT room_id, actor_id, role, can_broadcast, joined_at FROM room_members WHERE room_id = ? AND actor_id = ?',
    ).get(roomId, actorId) as MemberDbRow | undefined
    return row === undefined ? undefined : memberRow(row)
  }

  async listMembers(tx: ChatTx | null, roomId: string): Promise<RoomMemberRow[]> {
    this.assertOpen()
    this.checkReadTx(tx)
    const rows = this.stmt(
      `SELECT room_id, actor_id, role, can_broadcast, joined_at FROM room_members
       WHERE room_id = ? ORDER BY joined_at ASC, actor_id ASC`,
    ).all(roomId) as unknown as MemberDbRow[]
    return rows.map(memberRow)
  }

  async updateCanBroadcast(tx: ChatTx | null, roomId: string, actorId: string, canBroadcast: boolean): Promise<void> {
    const active = this.requireTxObject(tx)
    const result = this.stmt('UPDATE room_members SET can_broadcast = ? WHERE room_id = ? AND actor_id = ?').run(
      asBooleanInt(canBroadcast),
      roomId,
      actorId,
    )
    active.invalidateAccess()
    if (asNumber(result.changes) === 0) throw new CollabError('NOT_MEMBER', `member not found: ${roomId}/${actorId}`)
  }

  async removeMember(tx: ChatTx | null, roomId: string, actorId: string): Promise<void> {
    const active = this.requireTxObject(tx)
    this.stmt('DELETE FROM room_members WHERE room_id = ? AND actor_id = ?').run(roomId, actorId)
    active.invalidateAccess()
  }

  // --- room stats -----------------------------------------------------------

  async insertRoomStats(tx: ChatTx | null, row: RoomStatsRow): Promise<void> {
    const active = this.requireTxObject(tx)
    try {
      this.stmt(
        'INSERT INTO room_stats (room_id, head_seq, head_room_seq, last_activity_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run(row.roomId, row.headSeq, row.headRoomSeq, row.lastActivityAt, row.updatedAt)
    } catch (error) {
      if (isUniqueViolation(error)) throw new CollabError('INVALID_INPUT', `room stats already exist: ${row.roomId}`)
      throw this.wrap(error)
    }
    active.roomHeads.set(row.roomId, row)
  }

  async getRoomStats(tx: ChatTx | null, roomId: string): Promise<RoomStatsRow | undefined> {
    this.assertOpen()
    this.checkReadTx(tx)
    if (tx instanceof SqliteTx) {
      const cached = tx.roomHeads.get(roomId)
      if (cached !== undefined) return cached
    }
    const row = this.stmt(
      'SELECT room_id, head_seq, head_room_seq, last_activity_at, updated_at FROM room_stats WHERE room_id = ?',
    ).get(roomId) as StatsDbRow | undefined
    const result = row === undefined ? undefined : statsRow(row)
    if (result !== undefined && tx instanceof SqliteTx) tx.roomHeads.set(roomId, result)
    return result
  }

  // --- messages -------------------------------------------------------------

  async appendMessage(tx: ChatTx | null, input: AppendMessageInput): Promise<MessageRow> {
    // The writer is serialized, so within one transaction the cached heads are the
    // authority; the `tr_message_bump_stats` trigger maintains `room_stats` in SQL.
    const active = this.requireTxObject(tx)
    let stats = active.roomHeads.get(input.roomId)
    if (stats === undefined) {
      const statsRowDb = this.stmt(
        'SELECT room_id, head_seq, head_room_seq, last_activity_at, updated_at FROM room_stats WHERE room_id = ?',
      ).get(input.roomId) as StatsDbRow | undefined
      if (statsRowDb === undefined) throw new CollabError('ROOM_NOT_FOUND', `room not found: ${input.roomId}`)
      stats = statsRow(statsRowDb)
      active.roomHeads.set(input.roomId, stats)
    }
    const roomSeq = stats.headRoomSeq + 1
    const mentions = [...new Set(input.mentions)].sort()
    let seq: number
    try {
      const result = this.stmt(
        `INSERT INTO messages (id, room_id, room_seq, sender_id, body, kind, ticket_key, mention_all, reply_to_seq, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.id,
        input.roomId,
        roomSeq,
        input.senderId,
        input.body,
        input.kind,
        input.ticketKey,
        asBooleanInt(input.mentionAll),
        input.replyToSeq,
        input.createdAt,
      )
      seq = asNumber(result.lastInsertRowid)
    } catch (error) {
      if (isUniqueViolation(error)) throw new CollabError('INVALID_INPUT', `duplicate message id: ${input.id}`)
      throw this.wrap(error)
    }
    if (mentions.length > 0) {
      const insertMention = this.stmt('INSERT INTO message_mentions (message_seq, actor_id) VALUES (?, ?)')
      for (const actorId of mentions) insertMention.run(seq, actorId)
    }
    active.roomHeads.set(input.roomId, {
      roomId: input.roomId,
      headSeq: seq,
      headRoomSeq: roomSeq,
      lastActivityAt: input.createdAt,
      updatedAt: input.createdAt,
    })
    return {
      seq,
      id: input.id,
      roomId: input.roomId,
      roomSeq,
      senderId: input.senderId,
      body: input.body,
      kind: input.kind,
      ticketKey: input.ticketKey,
      mentionAll: input.mentionAll,
      mentions,
      replyToSeq: input.replyToSeq,
      createdAt: input.createdAt,
    }
  }

  async getMessageBySeqInRoom(tx: ChatTx | null, roomId: string, seq: number): Promise<MessageRow | undefined> {
    this.assertOpen()
    this.checkReadTx(tx)
    const row = this.stmt(
      `SELECT seq, id, room_id, room_seq, sender_id, body, kind, ticket_key, mention_all, reply_to_seq, created_at
       FROM messages WHERE room_id = ? AND seq = ?`,
    ).get(roomId, seq) as MessageDbRow | undefined
    if (row === undefined) return undefined
    return messageRow(row, this.mentionsOf([asNumber(row.seq)]).get(asNumber(row.seq)) ?? [])
  }

  async getMessageSeqInRoomAtOrBelow(tx: ChatTx | null, roomId: string, roomSeq: number): Promise<number> {
    this.assertOpen()
    this.checkReadTx(tx)
    const row = this.stmt(
      'SELECT COALESCE(MAX(seq), 0) AS s FROM messages WHERE room_id = ? AND room_seq <= ?',
    ).get(roomId, roomSeq) as { s: unknown } | undefined
    return row === undefined ? 0 : asNumber(row.s)
  }

  async getMessagesBySeqs(tx: ChatTx | null, roomId: string, seqs: readonly number[]): Promise<MessageRow[]> {
    this.assertOpen()
    this.checkReadTx(tx)
    if (seqs.length === 0) return []
    const rows: MessageDbRow[] = []
    for (const chunk of chunked(seqs, 400)) {
      const result = this.stmt(
        `SELECT seq, id, room_id, room_seq, sender_id, body, kind, ticket_key, mention_all, reply_to_seq, created_at
         FROM messages WHERE room_id = ? AND seq IN (${placeholders(chunk.length)})`,
      ).all(roomId, ...chunk) as unknown as MessageDbRow[]
      for (const row of result) rows.push(row)
    }
    const mentionMap = this.mentionsOf(rows.map(row => asNumber(row.seq)))
    const result = rows.map(row => messageRow(row, mentionMap.get(asNumber(row.seq)) ?? []))
    result.sort((a, b) => a.seq - b.seq)
    return result
  }

  async listMessages(tx: ChatTx | null, roomId: string, afterRoomSeq: number, limit: number): Promise<MessageRow[]> {
    this.assertOpen()
    this.checkReadTx(tx)
    const rows = this.stmt(
      `SELECT seq, id, room_id, room_seq, sender_id, body, kind, ticket_key, mention_all, reply_to_seq, created_at
       FROM messages WHERE room_id = ? AND room_seq > ? ORDER BY room_seq ASC LIMIT ?`,
    ).all(roomId, afterRoomSeq, limit) as unknown as MessageDbRow[]
    const mentionMap = this.mentionsOf(rows.map(row => asNumber(row.seq)))
    return rows.map(row => messageRow(row, mentionMap.get(asNumber(row.seq)) ?? []))
  }

  async listLastMessagesByRooms(
    tx: ChatTx | null,
    roomIds: readonly string[],
    perRoom: number,
  ): Promise<LastMessageRow[]> {
    this.assertOpen()
    this.checkReadTx(tx)
    if (roomIds.length === 0) return []
    const rows: LastMessageDbRow[] = []
    for (const chunk of chunked(roomIds, 400)) {
      const result = this.stmt(
        `SELECT seq, room_id, room_seq, sender_id, kind, created_at FROM (
           SELECT seq, room_id, room_seq, sender_id, kind, created_at,
                  ROW_NUMBER() OVER (PARTITION BY room_id ORDER BY room_seq DESC) AS rn
           FROM messages WHERE room_id IN (${placeholders(chunk.length)})
         ) WHERE rn <= ? ORDER BY room_id ASC, room_seq ASC`,
      ).all(...chunk, perRoom) as unknown as LastMessageDbRow[]
      for (const row of result) rows.push(row)
    }
    return rows.map(lastMessageRow)
  }

  async countMessages(tx: ChatTx | null): Promise<number> {
    this.assertOpen()
    this.checkReadTx(tx)
    return this.countQuery('SELECT COUNT(*) AS count FROM messages')
  }

  // --- read state -----------------------------------------------------------

  async upsertReadState(tx: ChatTx | null, row: ReadStateRow): Promise<void> {
    this.requireTx(tx)
    try {
      this.stmt(
        `INSERT INTO read_state (room_id, actor_id, last_read_seq, last_read_room_seq, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(room_id, actor_id) DO UPDATE SET
           last_read_seq = excluded.last_read_seq,
           last_read_room_seq = excluded.last_read_room_seq,
           updated_at = excluded.updated_at`,
      ).run(row.roomId, row.actorId, row.lastReadSeq, row.lastReadRoomSeq, row.updatedAt)
    } catch (error) {
      if (error instanceof Error && error.message.includes('READ_STATE_BACKWARDS')) {
        throw new CollabError('READ_STATE_BACKWARDS', 'read state never decreases')
      }
      throw this.wrap(error)
    }
  }

  async countReadStatesForRoom(tx: ChatTx | null, roomId: string): Promise<number> {
    this.assertOpen()
    this.checkReadTx(tx)
    return this.countQuery('SELECT COUNT(*) AS count FROM read_state WHERE room_id = ?', roomId)
  }

  async getReadState(tx: ChatTx | null, roomId: string, actorId: string): Promise<ReadStateRow | undefined> {
    this.assertOpen()
    this.checkReadTx(tx)
    const row = this.stmt(
      `SELECT room_id, actor_id, last_read_seq, last_read_room_seq, updated_at
       FROM read_state WHERE room_id = ? AND actor_id = ?`,
    ).get(roomId, actorId) as ReadStateDbRow | undefined
    return row === undefined ? undefined : readStateRow(row)
  }

  async removeReadState(tx: ChatTx | null, roomId: string, actorId: string): Promise<void> {
    this.requireTx(tx)
    this.stmt('DELETE FROM read_state WHERE room_id = ? AND actor_id = ?').run(roomId, actorId)
  }

  async insertReadStates(tx: ChatTx | null, rows: readonly ReadStateRow[]): Promise<void> {
    this.requireTx(tx)
    const insert = this.stmt(
      'INSERT INTO read_state (room_id, actor_id, last_read_seq, last_read_room_seq, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    try {
      for (const row of rows) insert.run(row.roomId, row.actorId, row.lastReadSeq, row.lastReadRoomSeq, row.updatedAt)
    } catch (error) {
      if (isUniqueViolation(error)) throw new CollabError('INVALID_INPUT', 'duplicate read state')
      throw this.wrap(error)
    }
  }

  // --- wake queue -----------------------------------------------------------

  async insertWakeItems(tx: ChatTx | null, rows: readonly WakeItemRow[]): Promise<void> {
    this.requireTx(tx)
    const insert = this.stmt(
      `INSERT INTO wake_item (id, actor_id, cause, room_id, source_seq, source_room_seq, channel, priority, status,
         dedupe_key, attempts, next_attempt_at, lease_until, last_error, created_at, acked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const row of rows) {
      try {
        insert.run(
          row.id,
          row.actorId,
          row.cause,
          row.roomId,
          row.sourceSeq,
          row.sourceRoomSeq,
          row.channel,
          row.priority,
          row.status,
          row.dedupeKey,
          row.attempts,
          row.nextAttemptAt,
          row.leaseUntil,
          row.lastError,
          row.createdAt,
          row.ackedAt,
        )
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new CollabError('VALIDATION_FAILED', 'duplicate wake row (dedupe key or id)')
        }
        throw this.wrap(error)
      }
    }
  }

  async getWakeItemsByIds(tx: ChatTx | null, ids: readonly string[]): Promise<WakeItemRow[]> {
    this.assertOpen()
    this.checkReadTx(tx)
    if (ids.length === 0) return []
    const rows: WakeDbRow[] = []
    for (const chunk of chunked(ids, 400)) {
      const result = this.stmt(
        `SELECT id, actor_id, cause, room_id, source_seq, source_room_seq, channel, priority, status, dedupe_key,
                attempts, next_attempt_at, lease_until, last_error, created_at, acked_at
         FROM wake_item WHERE id IN (${placeholders(chunk.length)})`,
      ).all(...chunk) as unknown as WakeDbRow[]
      for (const row of result) rows.push(row)
    }
    return rows.map(wakeRow)
  }

  async markWakeAcked(tx: ChatTx | null, id: string, ackedAt: number): Promise<boolean> {
    this.requireTx(tx)
    const result = this.stmt(
      `UPDATE wake_item SET status = 'acked', acked_at = ?
       WHERE id = ? AND status IN ${ACTIVE_WAKE_SQL}`,
    ).run(ackedAt, id)
    return asNumber(result.changes) > 0
  }

  async countPendingWakes(tx: ChatTx | null, actorId: string): Promise<number> {
    this.assertOpen()
    this.checkReadTx(tx)
    return this.countQuery(
      `SELECT COUNT(*) AS count FROM wake_item WHERE actor_id = ? AND status IN ${ACTIVE_WAKE_SQL}`,
      actorId,
    )
  }

  async listPendingWakeIds(tx: ChatTx | null, actorId: string, limit: number): Promise<string[]> {
    this.assertOpen()
    this.checkReadTx(tx)
    const rows = this.stmt(
      `SELECT id FROM wake_item WHERE actor_id = ? AND status IN ${ACTIVE_WAKE_SQL}
       ORDER BY ${WAKE_PRIORITY_ORDER}, created_at ASC, id ASC LIMIT ?`,
    ).all(actorId, limit) as unknown as Array<{ id: string }>
    return rows.map(row => row.id)
  }

  async terminatePendingWakes(
    tx: ChatTx | null,
    actorId: string,
    status: 'failed' | 'suppressed',
    lastError: string,
    at: number,
  ): Promise<number> {
    this.requireTx(tx)
    const result = this.stmt(
      `UPDATE wake_item SET status = ?, last_error = ?, next_attempt_at = ?
       WHERE actor_id = ? AND status IN ${ACTIVE_WAKE_SQL}`,
    ).run(status, lastError, at, actorId)
    return asNumber(result.changes)
  }

  async countWakeItemsForActor(tx: ChatTx | null, actorId: string): Promise<number> {
    this.assertOpen()
    this.checkReadTx(tx)
    return this.countQuery('SELECT COUNT(*) AS count FROM wake_item WHERE actor_id = ?', actorId)
  }

  async countAllWakeItems(tx: ChatTx | null): Promise<number> {
    this.assertOpen()
    this.checkReadTx(tx)
    return this.countQuery('SELECT COUNT(*) AS count FROM wake_item')
  }

  // --- digest read models ---------------------------------------------------

  async inboxTotals(
    tx: ChatTx | null,
    actorId: string,
    roomIds: readonly string[] | null,
  ): Promise<InboxTotalsRow> {
    this.assertOpen()
    this.checkReadTx(tx)
    const filter = roomIds === null ? '' : ` AND rm.room_id IN (${placeholders(roomIds.length)})`
    const filterArgs = roomIds === null ? [] : [...roomIds]
    const totals = this.stmt(
      `SELECT COUNT(*) AS rooms,
              COALESCE(SUM(CASE WHEN rs.head_room_seq > read.last_read_room_seq
                                THEN rs.head_room_seq - read.last_read_room_seq ELSE 0 END), 0) AS unread
       FROM room_members rm
       JOIN room_stats rs ON rs.room_id = rm.room_id
       JOIN read_state read ON read.room_id = rm.room_id AND read.actor_id = rm.actor_id
       WHERE rm.actor_id = ?${filter}`,
    ).get(actorId, ...filterArgs) as { rooms: unknown; unread: unknown }
    const mentionFilter = roomIds === null ? '' : ` AND m.room_id IN (${placeholders(roomIds.length)})`
    const mentions = this.countQuery(
      `SELECT COUNT(*) AS count FROM message_mentions mm
       JOIN messages m ON m.seq = mm.message_seq
       JOIN read_state read ON read.room_id = m.room_id AND read.actor_id = mm.actor_id
       WHERE mm.actor_id = ? AND m.room_seq > read.last_read_room_seq${mentionFilter}`,
      actorId,
      ...filterArgs,
    )
    return { rooms: asNumber(totals.rooms), unread: asNumber(totals.unread), mentions }
  }

  async listRoomDigest(
    tx: ChatTx | null,
    actorId: string,
    roomIds: readonly string[] | null,
    limit: number,
  ): Promise<RoomDigestRow[]> {
    this.assertOpen()
    this.checkReadTx(tx)
    const filter = roomIds === null ? '' : ` AND rm.room_id IN (${placeholders(roomIds.length)})`
    const filterArgs = roomIds === null ? [] : [...roomIds]
    const rows = this.stmt(
      `SELECT r.id AS room_id, r.kind, r.name, rs.head_seq, rs.head_room_seq,
              read.last_read_seq, read.last_read_room_seq,
              CASE WHEN rs.head_room_seq > read.last_read_room_seq
                   THEN rs.head_room_seq - read.last_read_room_seq ELSE 0 END AS unread,
              rs.last_activity_at
       FROM room_members rm
       JOIN rooms r ON r.id = rm.room_id
       JOIN room_stats rs ON rs.room_id = rm.room_id
       JOIN read_state read ON read.room_id = rm.room_id AND read.actor_id = rm.actor_id
       WHERE rm.actor_id = ?${filter}
       ORDER BY rs.last_activity_at DESC, r.id ASC
       LIMIT ?`,
    ).all(actorId, ...filterArgs, limit) as unknown as DigestDbRow[]
    if (rows.length === 0) return []
    const roomIdList = rows.map(row => row.room_id)
    const mentionFilter = ` AND m.room_id IN (${placeholders(roomIdList.length)})`
    const mentionRows = this.stmt(
      `SELECT m.room_id AS room_id, COUNT(*) AS mention_count
       FROM message_mentions mm
       JOIN messages m ON m.seq = mm.message_seq
       JOIN read_state read ON read.room_id = m.room_id AND read.actor_id = mm.actor_id
       WHERE mm.actor_id = ? AND m.room_seq > read.last_read_room_seq${mentionFilter}
       GROUP BY m.room_id`,
    ).all(actorId, ...roomIdList) as unknown as MentionCountDbRow[]
    const mentions = new Map<string, number>()
    for (const row of mentionRows) mentions.set(row.room_id, asNumber(row.mention_count))
    return rows.map(row => digestRow(row, mentions.get(row.room_id) ?? 0))
  }

  async countRoomsForActor(
    tx: ChatTx | null,
    actorId: string,
    roomIds: readonly string[] | null,
  ): Promise<number> {
    this.assertOpen()
    this.checkReadTx(tx)
    const filter = roomIds === null ? '' : ` AND room_id IN (${placeholders(roomIds.length)})`
    const filterArgs = roomIds === null ? [] : [...roomIds]
    return this.countQuery(`SELECT COUNT(*) AS count FROM room_members WHERE actor_id = ?${filter}`, actorId, ...filterArgs)
  }

  async listUnreadMentions(
    tx: ChatTx | null,
    actorId: string,
    roomIds: readonly string[] | null,
    limit: number,
  ): Promise<MentionDigestRow[]> {
    this.assertOpen()
    this.checkReadTx(tx)
    const filter = roomIds === null ? '' : ` AND m.room_id IN (${placeholders(roomIds.length)})`
    const filterArgs = roomIds === null ? [] : [...roomIds]
    const rows = this.stmt(
      `SELECT m.seq, m.room_id, m.sender_id, m.mention_all
       FROM message_mentions mm
       JOIN messages m ON m.seq = mm.message_seq
       JOIN read_state read ON read.room_id = m.room_id AND read.actor_id = mm.actor_id
       WHERE mm.actor_id = ? AND m.room_seq > read.last_read_room_seq${filter}
       ORDER BY m.seq ASC LIMIT ?`,
    ).all(actorId, ...filterArgs, limit) as unknown as MentionDigestDbRow[]
    return rows.map(row => ({
      seq: asNumber(row.seq),
      roomId: row.room_id,
      senderId: row.sender_id,
      mentionAll: asNumber(row.mention_all) === 1,
    }))
  }

  async countUnreadMentionAll(
    tx: ChatTx | null,
    actorId: string,
    roomIds: readonly string[] | null,
  ): Promise<number> {
    this.assertOpen()
    this.checkReadTx(tx)
    const filter = roomIds === null ? '' : ` AND m.room_id IN (${placeholders(roomIds.length)})`
    const filterArgs = roomIds === null ? [] : [...roomIds]
    return this.countQuery(
      `SELECT COUNT(*) AS count FROM messages m
       JOIN read_state read ON read.room_id = m.room_id AND read.actor_id = ?
       WHERE m.mention_all = 1 AND m.room_seq > read.last_read_room_seq${filter}`,
      actorId,
      ...filterArgs,
    )
  }

  // --- command log ----------------------------------------------------------

  async getCommand(
    tx: ChatTx | null,
    actorId: string,
    command: CommandName,
    key: string,
  ): Promise<CommandRow | undefined> {
    this.assertOpen()
    this.checkReadTx(tx)
    const row = this.stmt(
      `SELECT actor_id, command, idempotency_key, request_hash, response_json, created_at
       FROM chat_command_log WHERE actor_id = ? AND command = ? AND idempotency_key = ?`,
    ).get(actorId, command, key) as CommandDbRow | undefined
    return row === undefined ? undefined : commandRow(row)
  }

  async insertCommand(tx: ChatTx | null, row: CommandRow): Promise<void> {
    this.requireTx(tx)
    try {
      this.stmt(
        `INSERT INTO chat_command_log (actor_id, command, idempotency_key, request_hash, response_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(row.actorId, row.command, row.idempotencyKey, row.requestHash, row.responseJson, row.createdAt)
    } catch (error) {
      if (isUniqueViolation(error)) throw new CollabError('IDEMPOTENCY_CONFLICT', 'idempotency key already used')
      throw this.wrap(error)
    }
  }

  // --- private helpers ------------------------------------------------------

  private selectRoom(where: string, ...params: Array<string | number | null>): RoomRow | undefined {
    const row = this.stmt(
      `SELECT id, kind, name, created_by, dm_key, dm_low, dm_high, created_at, archived_at FROM rooms ${where}`,
    ).get(...params) as RoomDbRow | undefined
    return row === undefined ? undefined : roomRow(row)
  }

  private mentionsOf(seqs: readonly number[]): Map<number, string[]> {
    const result = new Map<number, string[]>()
    if (seqs.length === 0) return result
    for (const chunk of chunked(seqs, 400)) {
      const rows = this.stmt(
        `SELECT message_seq, actor_id FROM message_mentions
         WHERE message_seq IN (${placeholders(chunk.length)}) ORDER BY actor_id ASC`,
      ).all(...chunk) as unknown as Array<{ message_seq: unknown; actor_id: string }>
      for (const row of rows) {
        const seq = asNumber(row.message_seq)
        const list = result.get(seq) ?? []
        list.push(row.actor_id)
        result.set(seq, list)
      }
    }
    return result
  }

  private countQuery(sql: string, ...params: Array<string | number | null>): number {
    const row = this.stmt(sql).get(...params) as CountDbRow | undefined
    return row === undefined ? 0 : asNumber(row.count)
  }

  private stmt(sql: string): StatementSync {
    const cached = this.statements.get(sql)
    if (cached !== undefined) return cached
    const prepared = this.db.prepare(sql)
    this.statements.set(sql, prepared)
    return prepared
  }

  private requireTx(tx: ChatTx | null): void {
    this.requireTxObject(tx)
  }

  private requireTxObject(tx: ChatTx | null): SqliteTx {
    this.assertOpen()
    if (!(tx instanceof SqliteTx)) throw new CollabError('INVALID_INPUT', 'write requires an open transaction')
    return tx
  }

  private checkReadTx(tx: ChatTx | null): void {
    if (tx !== null && !(tx instanceof SqliteTx)) throw new CollabError('INVALID_INPUT', 'unknown transaction handle')
  }

  private assertOpen(): void {
    if (this.closed) throw new CollabError('STORE_CLOSED', 'collab store is closed')
  }

  private wrap(error: unknown): CollabError {
    if (error instanceof CollabError) return error
    const message = error instanceof Error ? error.message : String(error)
    if (/READ_STATE_BACKWARDS/.test(message)) return new CollabError('READ_STATE_BACKWARDS', 'read state never decreases')
    if (/append-only/.test(message)) return new CollabError('VALIDATION_FAILED', 'messages are append-only')
    if (/CHECK constraint failed/.test(message)) return new CollabError('VALIDATION_FAILED', 'domain constraint violated')
    if (/UNIQUE constraint failed/i.test(message)) return new CollabError('VALIDATION_FAILED', 'unique constraint violated')
    if (/FOREIGN KEY constraint failed/i.test(message)) return new CollabError('VALIDATION_FAILED', 'foreign key violation')
    if (/no such table|schema/i.test(message)) return new CollabError('SCHEMA_TOO_NEW', 'storage schema mismatch')
    if (/SQLITE_BUSY|database is locked/i.test(message)) return new CollabError('STORAGE_UNAVAILABLE', 'storage unavailable')
    return new CollabError('STORAGE_UNAVAILABLE', 'storage operation failed', { correlationId: randomUUID() })
  }

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version?: unknown } | undefined
    const version = row === undefined || row.user_version === undefined ? 0 : asNumber(row.user_version)
    if (version === 0) {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.db.exec(DDL)
        this.db
          .prepare('INSERT INTO schema_migrations (version, applied_at, checksum) VALUES (?, ?, ?)')
          .run(SCHEMA_VERSION, Date.now(), sha256Hex(DDL))
        this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
        this.db.exec('COMMIT')
      } catch (error) {
        try {
          this.db.exec('ROLLBACK')
        } catch {
          // ignore
        }
        throw error
      }
      return
    }
    if (version > SCHEMA_VERSION) {
      throw new CollabError('SCHEMA_TOO_NEW', `database schema version ${version} is newer than ${SCHEMA_VERSION}`)
    }
    if (version !== SCHEMA_VERSION) {
      throw new CollabError('SCHEMA_TOO_NEW', `unsupported collab schema version: ${version}`)
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
}

/** Factory kept internal to the adapter module; the package entry point exposes `createSqliteCollab`. */
export function createSqliteStore(path: string): SqliteChatStore {
  return new SqliteChatStore(path)
}
