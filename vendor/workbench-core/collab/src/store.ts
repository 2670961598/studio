/**
 * Storage port of the chat kernel (internal; never re-exported from the package
 * entry point, never a public type).
 *
 * Boundary contract (docs/plan/issues-platform-api-boundary.md §7.7.6):
 * - The port speaks rows and opaque positions, never SQL, never `node:sqlite`.
 * - `transaction` owns the transaction boundary; the `ChatTx` capability is
 *   handed to the closure only and cannot be constructed by a caller.
 * - `tx.savepoint(...)` isolates one item of a batch inside the transaction
 *   (per-item independence without a commit per item).
 * - Both adapters (memory, SQLite) pass the same contract suite.
 */
import type {
  ActorKind,
  ActorStatus,
  MemberRole,
  MessageKind,
  RoomKind,
  WakeCause,
  WakeChannel,
  WakePriority,
  WakeStatus,
} from './types.ts'

export interface ActorRow {
  id: string
  kind: ActorKind
  name: string
  status: ActorStatus
  createdAt: number
}

export interface RoomRow {
  id: string
  kind: RoomKind
  name: string
  createdBy: string
  dmKey: string | null
  dmLow: string | null
  dmHigh: string | null
  createdAt: number
  archivedAt: number | null
}

export interface RoomMemberRow {
  roomId: string
  actorId: string
  role: MemberRole
  canBroadcast: boolean
  joinedAt: number
}

export interface RoomStatsRow {
  roomId: string
  headSeq: number
  headRoomSeq: number
  lastActivityAt: number
  updatedAt: number
}

export interface ReadStateRow {
  roomId: string
  actorId: string
  lastReadSeq: number
  lastReadRoomSeq: number
  updatedAt: number
}

export interface MessageRow {
  seq: number
  id: string
  roomId: string
  roomSeq: number
  senderId: string
  body: string
  kind: MessageKind
  ticketKey: string | null
  mentionAll: boolean
  mentions: string[]
  replyToSeq: number | null
  createdAt: number
}

export interface AppendMessageInput {
  id: string
  roomId: string
  senderId: string
  body: string
  kind: MessageKind
  ticketKey: string | null
  mentionAll: boolean
  mentions: string[]
  replyToSeq: number | null
  createdAt: number
}

/** Metadata-only recent-message row used by the digest (no body). */
export interface LastMessageRow {
  seq: number
  roomId: string
  roomSeq: number
  senderId: string
  kind: MessageKind
  createdAt: number
}

export interface WakeItemRow {
  id: string
  actorId: string
  cause: WakeCause
  roomId: string
  sourceSeq: number
  sourceRoomSeq: number | null
  channel: WakeChannel
  priority: WakePriority
  status: WakeStatus
  dedupeKey: string
  attempts: number
  nextAttemptAt: number
  leaseUntil: number | null
  lastError: string | null
  createdAt: number
  ackedAt: number | null
}

export type CommandName = 'send' | 'mark_read' | 'ack'

export interface CommandRow {
  actorId: string
  command: CommandName
  idempotencyKey: string
  requestHash: string
  responseJson: string
  createdAt: number
}

export interface InboxTotalsRow {
  rooms: number
  unread: number
  mentions: number
}

/** Joined actor/room/membership row: one query answers all three access questions. */
export interface RoomAccessRow {
  actor: ActorRow
  room: RoomRow
  member: RoomMemberRow
}

export interface RoomDigestRow {
  roomId: string
  kind: RoomKind
  name: string
  headSeq: number
  headRoomSeq: number
  lastReadSeq: number
  lastReadRoomSeq: number
  unread: number
  mentionCount: number
  lastActivityAt: number
}

export interface MentionDigestRow {
  seq: number
  roomId: string
  senderId: string
  mentionAll: boolean
}

/**
 * Opaque transaction capability. Constructed only by a store adapter; the service
 * passes it back into port calls and never stores/inspects it.
 */
export interface ChatTx {
  readonly kind: 'chat-tx'
  /** Run `fn` in a nested savepoint: on throw, only its writes are undone. */
  savepoint<T>(fn: () => T | Promise<T>): Promise<T>
}

export interface ChatStore {
  /** Open a transaction (serialized writer). Reentrant within one task. */
  transaction<T>(fn: (tx: ChatTx) => T | Promise<T>): Promise<T>
  close(): Promise<void>

  // --- actors ---------------------------------------------------------------
  insertActor(tx: ChatTx | null, row: ActorRow): Promise<void>
  getActor(tx: ChatTx | null, id: string): Promise<ActorRow | undefined>
  /** Batch fetch by id: one call, no N+1. Row order is unspecified. */
  getActors(tx: ChatTx | null, ids: readonly string[]): Promise<ActorRow[]>
  listActors(tx: ChatTx | null): Promise<ActorRow[]>
  updateActorStatus(tx: ChatTx | null, id: string, status: ActorStatus): Promise<void>

  // --- rooms ----------------------------------------------------------------
  /**
   * Membership-scoped access lookup in one call: actor + room + membership row,
   * or `undefined` when the actor or the room/membership is absent (the service
   * splits the two for the public error code; absent is never a data leak).
   */
  getRoomAccess(tx: ChatTx | null, roomId: string, actorId: string): Promise<RoomAccessRow | undefined>
  insertRoom(tx: ChatTx | null, row: RoomRow): Promise<void>
  getRoom(tx: ChatTx | null, id: string): Promise<RoomRow | undefined>
  findDmRoom(tx: ChatTx | null, dmLow: string, dmHigh: string): Promise<RoomRow | undefined>
  findBroadcastRoom(tx: ChatTx | null): Promise<RoomRow | undefined>
  listRoomsForActor(tx: ChatTx | null, actorId: string): Promise<RoomRow[]>
  /** Idempotent broadcast-room creation guard (partial unique index in SQLite). */
  hasAnyBroadcastRoom(tx: ChatTx | null): Promise<boolean>

  // --- members --------------------------------------------------------------
  insertMembers(tx: ChatTx | null, rows: readonly RoomMemberRow[]): Promise<void>
  getMember(tx: ChatTx | null, roomId: string, actorId: string): Promise<RoomMemberRow | undefined>
  listMembers(tx: ChatTx | null, roomId: string): Promise<RoomMemberRow[]>
  updateCanBroadcast(tx: ChatTx | null, roomId: string, actorId: string, canBroadcast: boolean): Promise<void>
  removeMember(tx: ChatTx | null, roomId: string, actorId: string): Promise<void>

  // --- room stats -----------------------------------------------------------
  insertRoomStats(tx: ChatTx | null, row: RoomStatsRow): Promise<void>
  getRoomStats(tx: ChatTx | null, roomId: string): Promise<RoomStatsRow | undefined>

  // --- messages -------------------------------------------------------------
  /**
   * Allocate `seq`/`roomSeq` from `room_stats`, append the message, write the
   * mention rows, and bump both heads in one port call (one transaction).
   */
  appendMessage(tx: ChatTx | null, input: AppendMessageInput): Promise<MessageRow>
  /** Fetch by global seq inside one room (reply-target validation; cross-room is absent). */
  getMessageBySeqInRoom(tx: ChatTx | null, roomId: string, seq: number): Promise<MessageRow | undefined>
  /** Largest global `seq` whose room cursor is `<= roomSeq` (0 when none). */
  getMessageSeqInRoomAtOrBelow(tx: ChatTx | null, roomId: string, roomSeq: number): Promise<number>
  /** Batch read by global seq inside one room: single IN query, mentions included. */
  getMessagesBySeqs(tx: ChatTx | null, roomId: string, seqs: readonly number[]): Promise<MessageRow[]>
  /** Room page ordered by `room_seq` ascending, mentions included. */
  listMessages(tx: ChatTx | null, roomId: string, afterRoomSeq: number, limit: number): Promise<MessageRow[]>
  /** Last `perRoom` metadata rows per room (one call for many rooms). */
  listLastMessagesByRooms(tx: ChatTx | null, roomIds: readonly string[], perRoom: number): Promise<LastMessageRow[]>
  /** Total message rows (pressure/ops evidence; adapter test surface). */
  countMessages(tx: ChatTx | null): Promise<number>

  // --- read state -----------------------------------------------------------
  upsertReadState(tx: ChatTx | null, row: ReadStateRow): Promise<void>
  getReadState(tx: ChatTx | null, roomId: string, actorId: string): Promise<ReadStateRow | undefined>
  removeReadState(tx: ChatTx | null, roomId: string, actorId: string): Promise<void>
  /** Batch insert of join-baseline read rows. */
  insertReadStates(tx: ChatTx | null, rows: readonly ReadStateRow[]): Promise<void>
  /** Read-state rows for one room (bounded read-model evidence). */
  countReadStatesForRoom(tx: ChatTx | null, roomId: string): Promise<number>

  // --- wake queue -----------------------------------------------------------
  /** Insert wake rows; a duplicate `dedupeKey` is rejected. */
  insertWakeItems(tx: ChatTx | null, rows: readonly WakeItemRow[]): Promise<void>
  getWakeItemsByIds(tx: ChatTx | null, ids: readonly string[]): Promise<WakeItemRow[]>
  /** CAS `pending|claimed|delivered -> acked`; true when this call won. */
  markWakeAcked(tx: ChatTx | null, id: string, ackedAt: number): Promise<boolean>
  /** Count wakes that still need attention (`pending|claimed|delivered`). */
  countPendingWakes(tx: ChatTx | null, actorId: string): Promise<number>
  listPendingWakeIds(tx: ChatTx | null, actorId: string, limit: number): Promise<string[]>
  /** Terminal transition for a retired/paused actor's outstanding wakes. */
  terminatePendingWakes(
    tx: ChatTx | null,
    actorId: string,
    status: 'failed' | 'suppressed',
    lastError: string,
    at: number,
  ): Promise<number>
  /** Total wake rows for an actor (test/ops evidence; includes terminal states). */
  countWakeItemsForActor(tx: ChatTx | null, actorId: string): Promise<number>
  /** Total wake rows in the database (pressure-test evidence: broadcast adds 0). */
  countAllWakeItems(tx: ChatTx | null): Promise<number>

  // --- digest read models ---------------------------------------------------
  inboxTotals(tx: ChatTx | null, actorId: string, roomIds: readonly string[] | null): Promise<InboxTotalsRow>
  listRoomDigest(
    tx: ChatTx | null,
    actorId: string,
    roomIds: readonly string[] | null,
    limit: number,
  ): Promise<RoomDigestRow[]>
  countRoomsForActor(tx: ChatTx | null, actorId: string, roomIds: readonly string[] | null): Promise<number>
  listUnreadMentions(
    tx: ChatTx | null,
    actorId: string,
    roomIds: readonly string[] | null,
    limit: number,
  ): Promise<MentionDigestRow[]>
  countUnreadMentionAll(tx: ChatTx | null, actorId: string, roomIds: readonly string[] | null): Promise<number>

  // --- command log (idempotency) -------------------------------------------
  getCommand(tx: ChatTx | null, actorId: string, command: CommandName, key: string): Promise<CommandRow | undefined>
  insertCommand(tx: ChatTx | null, row: CommandRow): Promise<void>
}
