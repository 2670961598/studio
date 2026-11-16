/**
 * Public DTOs of the v0.8 chat slice.
 *
 * Boundary rule (docs/plan/issues-platform-api-boundary.md §7.7.1/§7.7.2):
 * nothing in this file knows the storage engine. No SQL, no table names, no
 * database-driver types, no row ids. Pagination is an opaque cursor string.
 */

/** Human or agent principal kind. */
export type ActorKind = 'human' | 'agent'

/** `retired` is terminal; `paused` is a reversible mute. */
export type ActorStatus = 'active' | 'paused' | 'retired'

export interface Actor {
  id: string
  kind: ActorKind
  name: string
  status: ActorStatus
  createdAt: number
}

/** Broadcast / group / direct message. There is no private channel outside a room. */
export type RoomKind = 'broadcast' | 'group' | 'dm'

export interface Room {
  id: string
  kind: RoomKind
  name: string
  createdBy: string
  /**
   * DM identity key: `sha256(dmLow ‖ NUL ‖ dmHigh)`; `null` for non-DM rooms.
   * Together with `dmLow`/`dmHigh` it makes a duplicate pair return the same room
   * and makes a collision across pairs impossible.
   */
  dmKey: string | null
  dmLow: string | null
  dmHigh: string | null
  createdAt: number
  archivedAt: number | null
}

export type MemberRole = 'owner' | 'member'

/** Materialized membership row, including the broadcast room. */
export interface RoomMember {
  roomId: string
  actorId: string
  role: MemberRole
  canBroadcast: boolean
  joinedAt: number
}

/** Closed message kind enum. Not a JSON envelope inside `body`. */
export type MessageKind = 'chat' | 'request' | 'result' | 'handoff' | 'status'

export interface Message {
  /** Global monotonic sequence; a single cursor can order all rooms. */
  seq: number
  id: string
  roomId: string
  /** Contiguous 1..N sequence inside the room (`room_stats.head_room_seq`). */
  roomSeq: number
  senderId: string
  /** Plain text; no rich text, no links preview. */
  body: string
  kind: MessageKind
  /** Plain reference into `issues.db`; text only, never a foreign key. */
  ticketKey: string | null
  /** `@all` is a distinct capability/flag, not a mention entry. */
  mentionAll: boolean
  /** Explicit actor ids; never parsed out of `body`. */
  mentions: string[]
  replyToSeq: number | null
  createdAt: number
}

export type WakeCause = 'mention' | 'dm' | 'reply' | 'mention_all' | 'on_call' | 'system'

export type WakeChannel = 'dsh_followup' | 'dsh_session_resume' | 'human_panel'

export type WakePriority = 'low' | 'normal' | 'high' | 'urgent'

export type WakeStatus = 'pending' | 'claimed' | 'delivered' | 'acked' | 'failed' | 'suppressed'

/** Read-only wake metadata; never a message body. */
export interface WakeState {
  wakeId: string
  actorId: string
  cause: WakeCause
  roomId: string
  sourceSeq: number
  sourceRoomSeq: number | null
  channel: WakeChannel
  priority: WakePriority
  status: WakeStatus
  createdAt: number
  ackedAt: number | null
}

export interface ReadState {
  roomId: string
  actorId: string
  lastReadSeq: number
  lastReadRoomSeq: number
  updatedAt: number
}

export interface RoomStats {
  roomId: string
  headSeq: number
  headRoomSeq: number
  lastActivityAt: number
  updatedAt: number
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CreateActorInput {
  kind: ActorKind
  name: string
  /**
   * Actor ids are host-issued and immutable. When omitted a UUID is generated.
   * Must match `^[a-z0-9_-]{1,64}$` (no colon).
   */
  id?: string
}

export interface RoomNameInput {
  name: string
}

export interface CreateGroupRoomInput extends RoomNameInput {
  /** Additional members besides the creator; the creator becomes owner. */
  memberIds: string[]
}

/**
 * Message write input. The sender principal is a host-bound argument of the
 * service method, never a field here: supplying `senderId`/`actorId` in the body
 * is `PRINCIPAL_MISMATCH`.
 */
export interface SendMessageInput {
  roomId: string
  body: string
  kind?: MessageKind
  /** Plain text reference into the issues database (optional). */
  ticketKey?: string
  /** Explicit mentions; a mention must be a current, active room member. */
  mentions?: string[]
  /** Privileged `@all` signal (human or room owner only); bounded wake fan-out. */
  mentionAll?: boolean
  /** Reply target: a `seq` of a message in the same room. */
  replyToSeq?: number
  /** Command-log idempotency key scoped to `(principal, 'send', key)`. */
  idempotencyKey?: string
}

export interface SendResult {
  seq: number
  roomSeq: number
  messageId: string
  /** True when an idempotent replay returned the original response. */
  replayed: boolean
}

export interface ListMessagesInput {
  roomId: string
  /** Opaque, versioned, binding-checked cursor from a previous page. */
  cursor?: string
  /** Page size; clamped to `maxPageSize` (200). */
  limit?: number
}

export interface MessagePage {
  items: Message[]
  nextCursor: string | null
  hasMore: boolean
}

export interface GetMessagesInput {
  roomId: string
  /** Message global seqs to fetch in one batch; at most `maxBatchReads` (500). */
  seqs: number[]
}

export interface BatchGetResult {
  /** Found messages, ordered by ascending `seq`. */
  items: Message[]
  /** Requested seqs that do not belong to the room; advisory, never an oracle. */
  missing: number[]
}

export interface CheckInboxInput {
  /** Restrict the digest to these rooms (at most 50); non-member rooms are `ROOM_NOT_FOUND`. */
  roomIds?: string[]
  /** Recent-message metadata per room (1..20, default 10; per-room cap 3). */
  lastN?: number
  /** Include the unread-mention metadata array (default true). */
  includeMentions?: boolean
}

/** Metadata-only recent-message entry in the digest: never a body. */
export interface LastMessageMeta {
  seq: number
  senderId: string
  kind: MessageKind
  createdAt: number
}

export interface InboxRoomDigest {
  roomId: string
  kind: RoomKind
  name: string
  unread: number
  headSeq: number
  headRoomSeq: number
  mentionCount: number
  lastActivityAt: number
  last: LastMessageMeta[]
}

export interface MentionDigest {
  seq: number
  roomId: string
  senderId: string
  cause: 'mention' | 'mention_all'
}

/**
 * Computed digest. Counts + metadata + wake ids only; there is no inbox table and
 * no message body anywhere in this shape.
 */
export interface InboxDigest {
  actorId: string
  generatedAt: number
  totals: {
    rooms: number
    unread: number
    mentions: number
    pendingWakes: number
  }
  rooms: InboxRoomDigest[]
  mentions: MentionDigest[]
  pendingWakeIds: string[]
  scope: {
    mentionAll: number
    onCall: number
  }
}

export interface MarkReadInput {
  roomId: string
  /** Target room cursor; clamped to `room_stats.head_room_seq`, never decreases. */
  upToRoomSeq: number
  /** Command-log idempotency key scoped to `(principal, 'mark_read', key)`. */
  idempotencyKey?: string
}

export interface MarkReadResult extends ReadState {
  /** `head_room_seq - last_read_room_seq` after the update. */
  unread: number
}

export interface AckDeliveryInput {
  /** Wake ids, at most `maxBatchWrites` (100). Tokens for other actors are not found. */
  wakeIds: string[]
  /** Command-log idempotency key scoped to `(principal, 'ack', key)`. */
  idempotencyKey?: string
}

export interface AckFailure {
  wakeId: string
  code: 'WAKE_NOT_FOUND' | 'WAKE_NOT_ACKABLE'
}

/** Per-item ack results; duplicate acks are idempotent. Never advances read_state. */
export interface AckResult {
  acked: string[]
  alreadyAcked: string[]
  failed: AckFailure[]
}

export interface GetWakeStateInput {
  wakeIds: string[]
}

// ---------------------------------------------------------------------------
// Batch envelope
// ---------------------------------------------------------------------------

export interface BatchItemError {
  code: string
  message: string
}

export type BatchItemResult<T> =
  | { index: number; status: 'ok'; result: T }
  | { index: number; status: 'error'; error: BatchItemError }

/** Per-item batch envelope. Independent items: one failure never rolls back siblings. */
export interface BatchResult<T> {
  items: BatchItemResult<T>[]
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CollabOptions {
  /** Clock injection (tests/replay); defaults to `Date.now`. */
  now?: () => number
  /** Id generator injection; defaults to `crypto.randomUUID`. */
  newId?: () => string
  /** Max body size in UTF-8 bytes; default 16 KiB. */
  maxBodyBytes?: number
  /** Max `listMessages` page size; default 200. */
  maxPageSize?: number
  /** Max items in one batch write (`batchSend`, `ackDelivery`); default 100. */
  maxBatchWrites?: number
  /** Max ids in one batch read (`getMessages`); default 500. */
  maxBatchReads?: number
  /** Max materialized `mention_all` wakes per message; default 50. */
  wakeMaxTargets?: number
  /** Max explicit mentions per message (structural bound); default 32. */
  maxMentionsPerMessage?: number
  /**
   * Key for the opaque pagination cursor. Cursors are signed with this key so
   * tampering and cross-room/cross-principal rebinding are rejected. Defaults to
   * a stable package key; a host should pass its own secret.
   */
  cursorSecret?: string
}
