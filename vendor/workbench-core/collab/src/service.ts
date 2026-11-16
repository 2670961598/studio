import { decodeMessagesCursor, encodeMessagesCursor } from './cursor.ts'
import { CollabError } from './errors.ts'
import { defaultNewId, defaultNow } from './ids.ts'
import { ACTOR_ID_HINT, ACTOR_ID_PATTERN, dmKey, dmPair, requestHash, wakeDedupeKey } from './keys.ts'
import type { ChatStore, ChatTx, CommandName, MessageRow, RoomMemberRow, RoomRow, WakeItemRow } from './store.ts'
import type {
  AckDeliveryInput,
  AckResult,
  Actor,
  ActorKind,
  ActorStatus,
  BatchGetResult,
  BatchItemResult,
  BatchResult,
  CheckInboxInput,
  CollabOptions,
  CreateActorInput,
  CreateGroupRoomInput,
  GetMessagesInput,
  GetWakeStateInput,
  InboxDigest,
  InboxRoomDigest,
  LastMessageMeta,
  ListMessagesInput,
  MarkReadInput,
  MarkReadResult,
  MentionDigest,
  Message,
  MessageKind,
  MessagePage,
  ReadState,
  Room,
  RoomKind,
  RoomMember,
  RoomNameInput,
  RoomStats,
  SendMessageInput,
  SendResult,
  WakeCause,
  WakeChannel,
  WakePriority,
  WakeState,
} from './types.ts'

const DEFAULT_MAX_BODY_BYTES = 16 * 1024
const DEFAULT_MAX_PAGE_SIZE = 200
const DEFAULT_MAX_BATCH_WRITES = 100
const DEFAULT_MAX_BATCH_READS = 500
const DEFAULT_WAKE_MAX_TARGETS = 50
const DEFAULT_MAX_MENTIONS = 32
const DEFAULT_CURSOR_SECRET = 'studio-next-collab-cursor-v1'
const MAX_NAME_CHARS = 100
const MAX_TICKET_KEY_CHARS = 200
const MAX_IDEMPOTENCY_KEY_CHARS = 200
const MAX_DIGEST_ROOMS = 50
const LAST_PER_ROOM = 3
const MAX_DIGEST_MENTIONS = 20
const MAX_DIGEST_WAKE_IDS = 20
const MAX_FILTER_ROOMS = 50
const MAX_ID_CHARS = 200
const DEFAULT_LAST_N = 10

const MESSAGE_KINDS: ReadonlySet<string> = new Set(['chat', 'request', 'result', 'handoff', 'status'])
const ACTOR_KINDS: ReadonlySet<string> = new Set(['human', 'agent'])
const ACTOR_STATUSES: ReadonlySet<string> = new Set(['active', 'paused', 'retired'])
const ACTIVE_WAKE_STATUSES: ReadonlySet<string> = new Set(['pending', 'claimed', 'delivered'])
const FATAL_BATCH_ERROR_CODES: ReadonlySet<string> = new Set([
  'STORAGE_UNAVAILABLE',
  'STORE_CLOSED',
  'SCHEMA_TOO_NEW',
  'INVALID_INPUT',
])

/** Cause strength order from docs/plan/chat-room-storage.md §6: strongest wins. */
const CAUSE_RANK: Record<WakeCause, number> = {
  mention_all: 6,
  mention: 5,
  dm: 4,
  reply: 3,
  on_call: 2,
  system: 1,
}

function invalid(message: string): CollabError {
  return new CollabError('VALIDATION_FAILED', message)
}

function validateName(value: unknown, label: string): string {
  if (typeof value !== 'string') throw invalid(`${label} must be a string`)
  const trimmed = value.trim()
  if (trimmed.length === 0) throw invalid(`${label} must not be empty`)
  if (trimmed.length > MAX_NAME_CHARS) throw invalid(`${label} must be at most ${MAX_NAME_CHARS} characters`)
  if (trimmed.includes('\u0000')) throw invalid(`${label} must not contain NUL`)
  return trimmed
}

function validateActorId(value: unknown, label: string): string {
  if (typeof value !== 'string') throw invalid(`${label} must be a string`)
  if (!ACTOR_ID_PATTERN.test(value)) throw invalid(`${label} is invalid; ${ACTOR_ID_HINT}`)
  return value
}

function validateGeneratedId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_CHARS || value.includes('\u0000')) {
    throw invalid(`${label} generator returned an invalid id`)
  }
  return value
}

function validateRoomId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_CHARS || value.includes('\u0000')) {
    throw invalid('room id is invalid')
  }
  return value
}

function validateBody(value: unknown, maxBytes: number): string {
  if (typeof value !== 'string') throw invalid('body must be a string')
  if (value.trim().length === 0) throw new CollabError('BODY_EMPTY', 'body must not be empty')
  if (value.includes('\u0000')) throw invalid('body must not contain NUL')
  // Plain text only: control characters other than newline/tab/carriage-return are rejected.
  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index)
    if (charCode < 0x20 && charCode !== 0x09 && charCode !== 0x0a && charCode !== 0x0d) {
      throw invalid('body must be plain text without control characters')
    }
  }
  const bytes = Buffer.byteLength(value, 'utf8')
  if (bytes > maxBytes) throw new CollabError('BODY_TOO_LARGE', `body exceeds ${maxBytes} bytes`, { bytes, maxBytes })
  return value
}

function validateKind(value: unknown): MessageKind {
  if (value === undefined) return 'chat'
  if (typeof value !== 'string' || !MESSAGE_KINDS.has(value)) {
    throw invalid('kind must be one of chat/request/result/handoff/status')
  }
  return value as MessageKind
}

function validateTicketKey(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw invalid('ticketKey must be a string')
  const trimmed = value.trim()
  if (trimmed.length === 0) throw invalid('ticketKey must not be empty when provided')
  if (trimmed.length > MAX_TICKET_KEY_CHARS) throw invalid(`ticketKey must be at most ${MAX_TICKET_KEY_CHARS} characters`)
  if (trimmed.includes('\u0000')) throw invalid('ticketKey must not contain NUL')
  return trimmed
}

function validateReplyToSeq(value: unknown): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw invalid('replyToSeq must be a positive integer')
  }
  return value
}

function validateIdempotencyKey(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw invalid('idempotencyKey must be a string')
  if (value.length === 0 || value.length > MAX_IDEMPOTENCY_KEY_CHARS || value.includes('\u0000')) {
    throw invalid('idempotencyKey is invalid')
  }
  return value
}

function normalizeMentions(value: unknown, maxMentions: number): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw invalid('mentions must be an array of actor ids')
  const result: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const id = validateActorId(item, 'mention actor id')
    if (seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  if (result.length > maxMentions) {
    throw new CollabError('MENTION_BUDGET_EXCEEDED', `at most ${maxMentions} mentions per message`)
  }
  return result
}

function normalizeActorIdList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw invalid(`${label} must be an array of actor ids`)
  const result: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const id = validateActorId(item, `${label} entry`)
    if (seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

function normalizeSeqs(value: unknown, max: number): number[] {
  if (!Array.isArray(value)) throw invalid('seqs must be an array of positive integers')
  const unique = new Set<number>()
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isSafeInteger(item) || item <= 0) {
      throw invalid('seqs must contain positive safe integers')
    }
    unique.add(item)
  }
  if (unique.size > max) throw invalid(`at most ${max} ids per batch read`)
  return [...unique].sort((a, b) => a - b)
}

function normalizeWakeIds(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) throw invalid('wakeIds must be an array of wake ids')
  const result: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || item.length > MAX_ID_CHARS || item.includes('\u0000')) {
      throw invalid('wakeIds must be non-empty strings')
    }
    if (seen.has(item)) continue
    seen.add(item)
    result.push(item)
  }
  if (result.length > max) throw invalid(`at most ${max} wake ids per call`)
  return result
}

function normalizeLimit(value: unknown, maxPageSize: number): number {
  if (value === undefined) return Math.min(50, maxPageSize)
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new CollabError('PAGE_SIZE_INVALID', 'limit must be a positive integer')
  }
  return Math.min(value, maxPageSize)
}

function normalizeLastN(value: unknown): number {
  if (value === undefined) return DEFAULT_LAST_N
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAX_DIGEST_MENTIONS) {
    throw invalid(`lastN must be an integer between 1 and ${MAX_DIGEST_MENTIONS}`)
  }
  return value
}

function normalizeRoomFilter(value: unknown): string[] | null {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) throw invalid('roomIds must be an array')
  const ids = new Set<string>()
  for (const item of value) ids.add(validateRoomId(item))
  if (ids.size > MAX_FILTER_ROOMS) throw invalid(`at most ${MAX_FILTER_ROOMS} room ids per digest`)
  return [...ids]
}

function validateActorStatus(value: unknown): ActorStatus {
  if (typeof value !== 'string' || !ACTOR_STATUSES.has(value)) {
    throw invalid('actor status must be active, paused or retired')
  }
  return value as ActorStatus
}

function validateActorKind(value: unknown): ActorKind {
  if (typeof value !== 'string' || !ACTOR_KINDS.has(value)) throw invalid('actor kind must be human or agent')
  return value as ActorKind
}

/** Reject a body-supplied principal: identity is a host-bound argument, never input. */
function assertNoPrincipalInBody(input: unknown): void {
  if (input === null || typeof input !== 'object') return
  const record = input as Record<string, unknown>
  if ('senderId' in record || 'actorId' in record || 'principal' in record) {
    throw new CollabError('PRINCIPAL_MISMATCH', 'principal must not be supplied in the request body')
  }
}

function hashSendRequest(input: SendMessageInput): string {
  const raw = input as unknown as Record<string, unknown>
  const mentionsValue = raw['mentions']
  const mentions =
    mentionsValue === undefined || mentionsValue === null
      ? []
      : Array.isArray(mentionsValue)
        ? mentionsValue.map(item => (typeof item === 'string' ? item : String(item))).slice().sort()
        : [String(mentionsValue)]
  return requestHash([
    'send',
    raw['roomId'] ?? null,
    raw['body'] ?? null,
    raw['kind'] ?? 'chat',
    raw['ticketKey'] ?? null,
    raw['mentionAll'] === true,
    mentions,
    raw['replyToSeq'] ?? null,
  ])
}

function toActor(row: { id: string; kind: ActorKind; name: string; status: ActorStatus; createdAt: number }): Actor {
  return { id: row.id, kind: row.kind, name: row.name, status: row.status, createdAt: row.createdAt }
}

function toRoom(row: {
  id: string
  kind: RoomKind
  name: string
  createdBy: string
  dmKey: string | null
  dmLow: string | null
  dmHigh: string | null
  createdAt: number
  archivedAt: number | null
}): Room {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    createdBy: row.createdBy,
    dmKey: row.dmKey,
    dmLow: row.dmLow,
    dmHigh: row.dmHigh,
    createdAt: row.createdAt,
    archivedAt: row.archivedAt,
  }
}

function toRoomMember(row: RoomMemberRow): RoomMember {
  return {
    roomId: row.roomId,
    actorId: row.actorId,
    role: row.role,
    canBroadcast: row.canBroadcast,
    joinedAt: row.joinedAt,
  }
}

function toMessage(row: MessageRow): Message {
  return {
    seq: row.seq,
    id: row.id,
    roomId: row.roomId,
    roomSeq: row.roomSeq,
    senderId: row.senderId,
    body: row.body,
    kind: row.kind,
    ticketKey: row.ticketKey,
    mentionAll: row.mentionAll,
    mentions: [...row.mentions],
    replyToSeq: row.replyToSeq,
    createdAt: row.createdAt,
  }
}

function toWakeState(row: WakeItemRow): WakeState {
  return {
    wakeId: row.id,
    actorId: row.actorId,
    cause: row.cause,
    roomId: row.roomId,
    sourceSeq: row.sourceSeq,
    sourceRoomSeq: row.sourceRoomSeq,
    channel: row.channel,
    priority: row.priority,
    status: row.status,
    createdAt: row.createdAt,
    ackedAt: row.ackedAt,
  }
}

interface RoomAccess {
  actor: { id: string; kind: ActorKind; name: string; status: ActorStatus; createdAt: number }
  room: RoomRow
  member: RoomMemberRow
}

/**
 * v0.8 chat service: actors, rooms, broadcast/group/DM membership, messages with
 * global `seq` + contiguous `room_seq`, directed-signal wake planning, read cursor
 * and digest, idempotent commands, batch send/get/ack.
 *
 * The sender/reader principal is a host-bound argument of each method, never a body
 * field. All storage goes through the internal `ChatStore` port: this file contains
 * no SQL, no table names and no database-driver import.
 */
export class ChatService {
  private readonly store: ChatStore
  private readonly now: () => number
  private readonly newId: () => string
  private readonly maxBodyBytes: number
  private readonly maxPageSize: number
  private readonly maxBatchWrites: number
  private readonly maxBatchReads: number
  private readonly wakeMaxTargets: number
  private readonly maxMentionsPerMessage: number
  private readonly cursorSecret: string
  private closed = false

  constructor(store: ChatStore, options: CollabOptions = {}) {
    this.store = store
    this.now = options.now ?? defaultNow
    this.newId = options.newId ?? defaultNewId
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
    this.maxPageSize = options.maxPageSize ?? DEFAULT_MAX_PAGE_SIZE
    this.maxBatchWrites = options.maxBatchWrites ?? DEFAULT_MAX_BATCH_WRITES
    this.maxBatchReads = options.maxBatchReads ?? DEFAULT_MAX_BATCH_READS
    this.wakeMaxTargets = options.wakeMaxTargets ?? DEFAULT_WAKE_MAX_TARGETS
    this.maxMentionsPerMessage = options.maxMentionsPerMessage ?? DEFAULT_MAX_MENTIONS
    this.cursorSecret = options.cursorSecret ?? DEFAULT_CURSOR_SECRET
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.store.close()
  }

  // --- actors ---------------------------------------------------------------

  async createActor(input: CreateActorInput): Promise<Actor> {
    this.assertOpen()
    const kind = validateActorKind(input.kind)
    const name = validateName(input.name, 'actor name')
    const id = input.id === undefined ? validateActorId(this.newId(), 'generated actor id') : validateActorId(input.id, 'actor id')
    const createdAt = this.now()
    const actor = { id, kind, name, status: 'active' as ActorStatus, createdAt }
    return this.store.transaction(async tx => {
      await this.store.insertActor(tx, actor)
      const broadcast = await this.store.findBroadcastRoom(tx)
      if (broadcast !== undefined) {
        const stats = await this.store.getRoomStats(tx, broadcast.id)
        await this.store.insertMembers(tx, [
          { roomId: broadcast.id, actorId: id, role: 'member', canBroadcast: false, joinedAt: createdAt },
        ])
        await this.store.insertReadStates(tx, [
          {
            roomId: broadcast.id,
            actorId: id,
            lastReadSeq: stats?.headSeq ?? 0,
            lastReadRoomSeq: stats?.headRoomSeq ?? 0,
            updatedAt: createdAt,
          },
        ])
      }
      return toActor(actor)
    })
  }

  async getActor(id: string): Promise<Actor | undefined> {
    this.assertOpen()
    const row = await this.store.getActor(null, id)
    return row === undefined ? undefined : toActor(row)
  }

  async listActors(): Promise<Actor[]> {
    this.assertOpen()
    const rows = await this.store.listActors(null)
    return rows.map(toActor)
  }

  /** Admin/host transition: `retired` is terminal; retiring/ pausing terminates open wakes. */
  async setActorStatus(actorId: string, status: ActorStatus): Promise<Actor> {
    this.assertOpen()
    const id = validateActorId(actorId, 'actor id')
    const next = validateActorStatus(status)
    return this.store.transaction(async tx => {
      const row = await this.store.getActor(tx, id)
      if (row === undefined) throw new CollabError('ACTOR_NOT_FOUND', `actor not found: ${id}`)
      if (row.status === next) return toActor(row)
      if (row.status === 'retired') throw invalid('a retired actor cannot change status')
      await this.store.updateActorStatus(tx, id, next)
      const at = this.now()
      if (next === 'retired') await this.store.terminatePendingWakes(tx, id, 'failed', 'ACTOR_RETIRED', at)
      if (next === 'paused') await this.store.terminatePendingWakes(tx, id, 'suppressed', 'ACTOR_PAUSED', at)
      return toActor({ ...row, status: next })
    })
  }

  // --- rooms ----------------------------------------------------------------

  /**
   * Bootstrap the single company broadcast room (host/admin surface). Idempotent:
   * a second call returns the existing room. Membership is materialized for every
   * current actor (creator = owner with `can_broadcast=1`), and future actors join
   * on creation.
   */
  async createBroadcastRoom(createdBy: string, input: RoomNameInput): Promise<Room> {
    this.assertOpen()
    const creatorId = validateActorId(createdBy, 'creator id')
    const name = validateName(input.name, 'room name')
    try {
      return await this.store.transaction(async tx => {
        const creator = await this.store.getActor(tx, creatorId)
        if (creator === undefined) throw new CollabError('ACTOR_NOT_FOUND', `creator not found: ${creatorId}`)
        if (creator.status === 'retired') throw new CollabError('ACTOR_RETIRED', 'a retired actor cannot create a room')
        const existing = await this.store.findBroadcastRoom(tx)
        if (existing !== undefined) return toRoom(existing)
        const createdAt = this.now()
        const room: RoomRow = {
          id: this.newRoomId(),
          kind: 'broadcast',
          name,
          createdBy: creatorId,
          dmKey: null,
          dmLow: null,
          dmHigh: null,
          createdAt,
          archivedAt: null,
        }
        await this.store.insertRoom(tx, room)
        await this.store.insertRoomStats(tx, {
          roomId: room.id,
          headSeq: 0,
          headRoomSeq: 0,
          lastActivityAt: createdAt,
          updatedAt: createdAt,
        })
        const actors = await this.store.listActors(tx)
        await this.store.insertMembers(
          tx,
          actors.map(actor => ({
            roomId: room.id,
            actorId: actor.id,
            role: actor.id === creatorId ? ('owner' as const) : ('member' as const),
            canBroadcast: actor.id === creatorId,
            joinedAt: createdAt,
          })),
        )
        await this.store.insertReadStates(
          tx,
          actors.map(actor => ({
            roomId: room.id,
            actorId: actor.id,
            lastReadSeq: 0,
            lastReadRoomSeq: 0,
            updatedAt: createdAt,
          })),
        )
        return toRoom(room)
      })
    } catch (error) {
      if (error instanceof CollabError && error.code === 'BROADCAST_ALREADY_EXISTS') {
        const existing = await this.store.findBroadcastRoom(null)
        if (existing !== undefined) return toRoom(existing)
      }
      throw error
    }
  }

  async createGroupRoom(createdBy: string, input: CreateGroupRoomInput): Promise<Room> {
    this.assertOpen()
    const creatorId = validateActorId(createdBy, 'creator id')
    const name = validateName(input.name, 'room name')
    const requested = normalizeActorIdList(input.memberIds, 'memberIds')
    if (!requested.includes(creatorId)) requested.unshift(creatorId)
    if (requested.length < 2) throw invalid('a group room needs at least two members')
    return this.store.transaction(async tx => {
      const creator = await this.store.getActor(tx, creatorId)
      if (creator === undefined) throw new CollabError('ACTOR_NOT_FOUND', `creator not found: ${creatorId}`)
      // `paused` is a reversible mute, `retired` is terminal: only retired room
      // creation is blocked (same rule as createBroadcastRoom/createDm).
      if (creator.status === 'retired') throw new CollabError('ACTOR_RETIRED', 'a retired actor cannot create a room')
      const actors = await this.store.getActors(tx, requested)
      const byId = new Map(actors.map(actor => [actor.id, actor]))
      for (const id of requested) {
        const member = byId.get(id)
        if (member === undefined) throw new CollabError('ACTOR_NOT_FOUND', `member not found: ${id}`)
        if (member.status === 'retired') throw new CollabError('ACTOR_RETIRED', 'a retired actor cannot join a room')
      }
      const createdAt = this.now()
      const room: RoomRow = {
        id: this.newRoomId(),
        kind: 'group',
        name,
        createdBy: creatorId,
        dmKey: null,
        dmLow: null,
        dmHigh: null,
        createdAt,
        archivedAt: null,
      }
      await this.store.insertRoom(tx, room)
      await this.store.insertRoomStats(tx, {
        roomId: room.id,
        headSeq: 0,
        headRoomSeq: 0,
        lastActivityAt: createdAt,
        updatedAt: createdAt,
      })
      await this.store.insertMembers(
        tx,
        requested.map(actorId => ({
          roomId: room.id,
          actorId,
          role: actorId === creatorId ? ('owner' as const) : ('member' as const),
          canBroadcast: actorId === creatorId,
          joinedAt: createdAt,
        })),
      )
      await this.store.insertReadStates(
        tx,
        requested.map(actorId => ({
          roomId: room.id,
          actorId,
          lastReadSeq: 0,
          lastReadRoomSeq: 0,
          updatedAt: createdAt,
        })),
      )
      return toRoom(room)
    })
  }

  /**
   * Create (or return) the single DM room for a pair. `dm_key = sha256(low‖NUL‖high)`
   * plus `UNIQUE(dm_low, dm_high)` guarantees no collision can return another pair's
   * room. Exactly two members; no invite/remove.
   */
  async createDm(actorA: string, actorB: string): Promise<Room> {
    this.assertOpen()
    const a = validateActorId(actorA, 'actor A')
    const b = validateActorId(actorB, 'actor B')
    if (a === b) throw new CollabError('DM_REQUIRES_TWO_DISTINCT_ACTORS', 'a DM needs two distinct actors')
    const { low, high } = dmPair(a, b)
    return this.store.transaction(async tx => {
      const actors = await this.store.getActors(tx, [low, high])
      const byId = new Map(actors.map(actor => [actor.id, actor]))
      const lowActor = byId.get(low)
      const highActor = byId.get(high)
      if (lowActor === undefined) throw new CollabError('ACTOR_NOT_FOUND', `actor not found: ${low}`)
      if (highActor === undefined) throw new CollabError('ACTOR_NOT_FOUND', `actor not found: ${high}`)
      if (lowActor.status === 'retired' || highActor.status === 'retired') {
        throw new CollabError('ACTOR_RETIRED', 'a retired actor cannot take part in a DM')
      }
      const existing = await this.store.findDmRoom(tx, low, high)
      if (existing !== undefined) return toRoom(existing)
      const createdAt = this.now()
      const room: RoomRow = {
        id: this.newRoomId(),
        kind: 'dm',
        name: `${lowActor.name} / ${highActor.name}`,
        createdBy: a,
        dmKey: dmKey(low, high),
        dmLow: low,
        dmHigh: high,
        createdAt,
        archivedAt: null,
      }
      await this.store.insertRoom(tx, room)
      await this.store.insertRoomStats(tx, {
        roomId: room.id,
        headSeq: 0,
        headRoomSeq: 0,
        lastActivityAt: createdAt,
        updatedAt: createdAt,
      })
      await this.store.insertMembers(tx, [
        { roomId: room.id, actorId: low, role: 'member', canBroadcast: false, joinedAt: createdAt },
        { roomId: room.id, actorId: high, role: 'member', canBroadcast: false, joinedAt: createdAt },
      ])
      await this.store.insertReadStates(tx, [
        { roomId: room.id, actorId: low, lastReadSeq: 0, lastReadRoomSeq: 0, updatedAt: createdAt },
        { roomId: room.id, actorId: high, lastReadSeq: 0, lastReadRoomSeq: 0, updatedAt: createdAt },
      ])
      return toRoom(room)
    })
  }

  async getRoom(principal: string, roomId: string): Promise<Room> {
    this.assertOpen()
    const roomIdValue = validateRoomId(roomId)
    return this.store.transaction(async tx => {
      const access = await this.requireRoomAccess(tx, principal, roomIdValue)
      return toRoom(access.room)
    })
  }

  async listRooms(principal: string): Promise<Room[]> {
    this.assertOpen()
    return this.store.transaction(async tx => {
      await this.requireActorRow(tx, principal)
      const rows = await this.store.listRoomsForActor(tx, principal)
      return rows.map(toRoom)
    })
  }

  async listMembers(principal: string, roomId: string): Promise<RoomMember[]> {
    this.assertOpen()
    const roomIdValue = validateRoomId(roomId)
    return this.store.transaction(async tx => {
      await this.requireRoomAccess(tx, principal, roomIdValue)
      const rows = await this.store.listMembers(tx, roomIdValue)
      return rows.map(toRoomMember)
    })
  }

  async addMember(principal: string, roomId: string, actorId: string): Promise<RoomMember> {
    this.assertOpen()
    const roomIdValue = validateRoomId(roomId)
    const targetId = validateActorId(actorId, 'member actor id')
    return this.store.transaction(async tx => {
      const access = await this.requireRoomAccess(tx, principal, roomIdValue)
      if (access.room.kind === 'dm') throw new CollabError('DM_FIXED_PAIR', 'a DM room always has exactly two members')
      if (access.room.kind === 'broadcast') throw invalid('broadcast membership is automatic')
      if (access.member.role !== 'owner') throw new CollabError('NOT_ROOM_OWNER', 'only a room owner can invite')
      const target = await this.store.getActor(tx, targetId)
      if (target === undefined) throw new CollabError('ACTOR_NOT_FOUND', `actor not found: ${targetId}`)
      if (target.status === 'retired') throw new CollabError('ACTOR_RETIRED', 'a retired actor cannot be added to a room')
      const existing = await this.store.getMember(tx, roomIdValue, targetId)
      if (existing !== undefined) return toRoomMember(existing)
      const joinedAt = this.now()
      const stats = await this.store.getRoomStats(tx, roomIdValue)
      const member: RoomMemberRow = {
        roomId: roomIdValue,
        actorId: targetId,
        role: 'member',
        canBroadcast: false,
        joinedAt,
      }
      await this.store.insertMembers(tx, [member])
      await this.store.insertReadStates(tx, [
        {
          roomId: roomIdValue,
          actorId: targetId,
          lastReadSeq: stats?.headSeq ?? 0,
          lastReadRoomSeq: stats?.headRoomSeq ?? 0,
          updatedAt: joinedAt,
        },
      ])
      return toRoomMember(member)
    })
  }

  async removeMember(principal: string, roomId: string, actorId: string): Promise<void> {
    this.assertOpen()
    const roomIdValue = validateRoomId(roomId)
    const targetId = validateActorId(actorId, 'member actor id')
    await this.store.transaction(async tx => {
      const access = await this.requireRoomAccess(tx, principal, roomIdValue)
      if (access.room.kind === 'dm') throw new CollabError('DM_FIXED_PAIR', 'a DM room always has exactly two members')
      if (access.room.kind === 'broadcast') throw invalid('broadcast membership cannot be left')
      const isSelf = principal === targetId
      if (!isSelf && access.member.role !== 'owner') throw new CollabError('NOT_ROOM_OWNER', 'only a room owner can remove members')
      const target = await this.store.getMember(tx, roomIdValue, targetId)
      if (target === undefined) throw new CollabError('NOT_MEMBER', 'actor is not a room member')
      if (target.role === 'owner') {
        const members = await this.store.listMembers(tx, roomIdValue)
        const ownerCount = members.filter(row => row.role === 'owner').length
        if (ownerCount <= 1) throw new CollabError('LAST_OWNER_FORBIDDEN', 'a group must keep at least one owner')
      }
      await this.store.removeMember(tx, roomIdValue, targetId)
      await this.store.removeReadState(tx, roomIdValue, targetId)
    })
  }

  /**
   * Grant/revoke `can_broadcast` in the broadcast room. Grantor must be human or the
   * room owner; an agent can never grant itself (or anyone else) — F13.
   */
  async setCanBroadcast(principal: string, roomId: string, actorId: string, canBroadcast: boolean): Promise<RoomMember> {
    this.assertOpen()
    const roomIdValue = validateRoomId(roomId)
    const targetId = validateActorId(actorId, 'member actor id')
    if (typeof canBroadcast !== 'boolean') throw invalid('canBroadcast must be a boolean')
    return this.store.transaction(async tx => {
      const access = await this.requireRoomAccess(tx, principal, roomIdValue)
      if (access.room.kind !== 'broadcast') throw invalid('can_broadcast is only meaningful in the broadcast room')
      const target = await this.store.getMember(tx, roomIdValue, targetId)
      if (target === undefined) throw new CollabError('NOT_MEMBER', 'actor is not a broadcast member')
      const human = access.actor.kind === 'human'
      const owner = access.member.role === 'owner'
      if (!human && !owner) throw new CollabError('BROADCAST_GRANT_FORBIDDEN', 'only a human or room owner can grant broadcast')
      if (!human && principal === targetId) throw new CollabError('BROADCAST_GRANT_FORBIDDEN', 'an agent cannot grant itself broadcast')
      await this.store.updateCanBroadcast(tx, roomIdValue, targetId, canBroadcast)
      return toRoomMember({ ...target, canBroadcast })
    })
  }

  async getRoomStats(principal: string, roomId: string): Promise<RoomStats> {
    this.assertOpen()
    const roomIdValue = validateRoomId(roomId)
    return this.store.transaction(async tx => {
      await this.requireRoomAccess(tx, principal, roomIdValue)
      const stats = await this.store.getRoomStats(tx, roomIdValue)
      if (stats === undefined) throw new CollabError('ROOM_NOT_FOUND', `room not found: ${roomIdValue}`)
      return {
        roomId: stats.roomId,
        headSeq: stats.headSeq,
        headRoomSeq: stats.headRoomSeq,
        lastActivityAt: stats.lastActivityAt,
        updatedAt: stats.updatedAt,
      }
    })
  }

  async getReadState(principal: string, roomId: string): Promise<ReadState> {
    this.assertOpen()
    const roomIdValue = validateRoomId(roomId)
    return this.store.transaction(async tx => {
      await this.requireRoomAccess(tx, principal, roomIdValue)
      const row = await this.store.getReadState(tx, roomIdValue, principal)
      if (row !== undefined) {
        return {
          roomId: row.roomId,
          actorId: row.actorId,
          lastReadSeq: row.lastReadSeq,
          lastReadRoomSeq: row.lastReadRoomSeq,
          updatedAt: row.updatedAt,
        }
      }
      return {
        roomId: roomIdValue,
        actorId: principal,
        lastReadSeq: 0,
        lastReadRoomSeq: 0,
        updatedAt: 0,
      }
    })
  }

  // --- messages -------------------------------------------------------------

  async sendMessage(principal: string, input: SendMessageInput): Promise<SendResult> {
    this.assertOpen()
    assertNoPrincipalInBody(input)
    return this.store.transaction(tx => this.sendOne(tx, principal, input))
  }

  /** Bounded batch write: independent items, per-item envelope, one transaction, savepoint per item. */
  async batchSend(principal: string, items: SendMessageInput[]): Promise<BatchResult<SendResult>> {
    this.assertOpen()
    if (!Array.isArray(items)) throw invalid('items must be an array')
    if (items.length > this.maxBatchWrites) throw invalid(`at most ${this.maxBatchWrites} items per batch`)
    const results: BatchItemResult<SendResult>[] = []
    if (items.length === 0) return { items: results }
    await this.store.transaction(async tx => {
      for (const [index, item] of items.entries()) {
        try {
          assertNoPrincipalInBody(item)
          const result = await tx.savepoint(() => this.sendOne(tx, principal, item))
          results.push({ index, status: 'ok', result })
        } catch (error) {
          if (error instanceof CollabError && !FATAL_BATCH_ERROR_CODES.has(error.code)) {
            results.push({ index, status: 'error', error: { code: error.code, message: error.message } })
            continue
          }
          throw error
        }
      }
    })
    return { items: results }
  }

  async listMessages(principal: string, input: ListMessagesInput): Promise<MessagePage> {
    this.assertOpen()
    const roomId = validateRoomId(input.roomId)
    const limit = normalizeLimit(input.limit, this.maxPageSize)
    const afterRoomSeq =
      input.cursor === undefined
        ? 0
        : decodeMessagesCursor(this.cursorSecret, input.cursor, { roomId, actorId: principal })
    return this.store.transaction(async tx => {
      await this.requireRoomAccess(tx, principal, roomId)
      const rows = await this.store.listMessages(tx, roomId, afterRoomSeq, limit + 1)
      const hasMore = rows.length > limit
      const page = hasMore ? rows.slice(0, limit) : rows
      const last = page[page.length - 1]
      const nextCursor =
        hasMore && last !== undefined
          ? encodeMessagesCursor(this.cursorSecret, { roomId, actorId: principal }, last.roomSeq)
          : null
      return { items: page.map(toMessage), nextCursor, hasMore }
    })
  }

  /** Batch read by global seq inside one room: one port call (IN query), no N+1. */
  async getMessages(principal: string, input: GetMessagesInput): Promise<BatchGetResult> {
    this.assertOpen()
    const roomId = validateRoomId(input.roomId)
    const seqs = normalizeSeqs(input.seqs, this.maxBatchReads)
    return this.store.transaction(async tx => {
      await this.requireRoomAccess(tx, principal, roomId)
      if (seqs.length === 0) return { items: [], missing: [] }
      const rows = await this.store.getMessagesBySeqs(tx, roomId, seqs)
      const found = new Set(rows.map(row => row.seq))
      return { items: rows.map(toMessage), missing: seqs.filter(seq => !found.has(seq)) }
    })
  }

  // --- read cursor and digest ----------------------------------------------

  /**
   * Computed digest: triple counters + metadata + wake ids. It never returns a
   * message body and never marks anything read.
   */
  async checkInbox(principal: string, input: CheckInboxInput = {}): Promise<InboxDigest> {
    this.assertOpen()
    const lastN = normalizeLastN(input.lastN)
    const includeMentions = input.includeMentions !== false
    const filter = normalizeRoomFilter(input.roomIds)
    return this.store.transaction(async tx => {
      await this.requireActorRow(tx, principal)
      if (filter !== null) {
        for (const roomId of filter) await this.requireRoomAccess(tx, principal, roomId)
      }
      const totals = await this.store.inboxTotals(tx, principal, filter)
      const roomRows = await this.store.listRoomDigest(tx, principal, filter, MAX_DIGEST_ROOMS)
      const lastRows = await this.store.listLastMessagesByRooms(
        tx,
        roomRows.map(row => row.roomId),
        LAST_PER_ROOM,
      )
      const lastByRoom = new Map<string, LastMessageMeta[]>()
      for (const row of lastRows) {
        const list = lastByRoom.get(row.roomId) ?? []
        if (list.length < LAST_PER_ROOM) {
          list.push({ seq: row.seq, senderId: row.senderId, kind: row.kind, createdAt: row.createdAt })
          lastByRoom.set(row.roomId, list)
        }
      }
      const rooms: InboxRoomDigest[] = roomRows.map(row => ({
        roomId: row.roomId,
        kind: row.kind,
        name: row.name,
        unread: row.unread,
        headSeq: row.headSeq,
        headRoomSeq: row.headRoomSeq,
        mentionCount: row.mentionCount,
        lastActivityAt: row.lastActivityAt,
        last: lastByRoom.get(row.roomId) ?? [],
      }))
      const mentionRows = includeMentions
        ? await this.store.listUnreadMentions(tx, principal, filter, lastN)
        : []
      const mentions: MentionDigest[] = mentionRows.map(row => ({
        seq: row.seq,
        roomId: row.roomId,
        senderId: row.senderId,
        cause: row.mentionAll ? 'mention_all' : 'mention',
      }))
      const pendingWakes = await this.store.countPendingWakes(tx, principal)
      const pendingWakeIds = await this.store.listPendingWakeIds(tx, principal, MAX_DIGEST_WAKE_IDS)
      const mentionAll = await this.store.countUnreadMentionAll(tx, principal, filter)
      return {
        actorId: principal,
        generatedAt: this.now(),
        totals: {
          rooms: totals.rooms,
          unread: totals.unread,
          mentions: totals.mentions,
          pendingWakes,
        },
        rooms,
        mentions,
        pendingWakeIds,
        scope: { mentionAll, onCall: 0 },
      }
    })
  }

  /**
   * Advance the read cursor. Monotonic and clamped to `room_stats.head_room_seq`:
   * a target beyond the head is clamped (never marks future messages read) and a
   * target behind the cursor is a no-op (`READ_STATE_BACKWARDS` never occurs).
   * Does not ack any wake.
   */
  async markRead(principal: string, input: MarkReadInput): Promise<MarkReadResult> {
    this.assertOpen()
    const roomId = validateRoomId(input.roomId)
    const upToRoomSeq = input.upToRoomSeq
    if (typeof upToRoomSeq !== 'number' || !Number.isSafeInteger(upToRoomSeq) || upToRoomSeq < 0) {
      throw invalid('upToRoomSeq must be a non-negative integer')
    }
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey)
    const requestHashValue = requestHash(['mark_read', roomId, upToRoomSeq])
    return this.store.transaction(async tx => {
      if (idempotencyKey !== null) {
        const replay = await this.replayCommand(tx, principal, 'mark_read', idempotencyKey, requestHashValue)
        if (replay !== null) return replay as MarkReadResult
      }
      await this.requireRoomAccess(tx, principal, roomId)
      const stats = await this.store.getRoomStats(tx, roomId)
      if (stats === undefined) throw new CollabError('ROOM_NOT_FOUND', `room not found: ${roomId}`)
      const current = await this.store.getReadState(tx, roomId, principal)
      const target = Math.min(upToRoomSeq, stats.headRoomSeq)
      if (current !== undefined && target <= current.lastReadRoomSeq) {
        return {
          roomId,
          actorId: principal,
          lastReadSeq: current.lastReadSeq,
          lastReadRoomSeq: current.lastReadRoomSeq,
          updatedAt: current.updatedAt,
          unread: Math.max(0, stats.headRoomSeq - current.lastReadRoomSeq),
        }
      }
      const lastReadSeq = await this.store.getMessageSeqInRoomAtOrBelow(tx, roomId, target)
      const row = {
        roomId,
        actorId: principal,
        lastReadSeq: Math.max(current?.lastReadSeq ?? 0, lastReadSeq),
        lastReadRoomSeq: target,
        updatedAt: this.now(),
      }
      await this.store.upsertReadState(tx, row)
      const result: MarkReadResult = { ...row, unread: Math.max(0, stats.headRoomSeq - target) }
      if (idempotencyKey !== null) {
        await this.store.insertCommand(tx, {
          actorId: principal,
          command: 'mark_read',
          idempotencyKey,
          requestHash: requestHashValue,
          responseJson: JSON.stringify(result),
          createdAt: result.updatedAt,
        })
      }
      return result
    })
  }

  /**
   * Ack directed wakes. Per-id results, idempotent duplicates, unknown or
   * foreign-actor ids are `WAKE_NOT_FOUND`. It never advances `read_state`.
   */
  async ackDelivery(principal: string, input: AckDeliveryInput): Promise<AckResult> {
    this.assertOpen()
    const wakeIds = normalizeWakeIds(input.wakeIds, this.maxBatchWrites)
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey)
    const requestHashValue = requestHash(['ack', [...wakeIds].sort()])
    return this.store.transaction(async tx => {
      if (idempotencyKey !== null) {
        const replay = await this.replayCommand(tx, principal, 'ack', idempotencyKey, requestHashValue)
        if (replay !== null) return replay as AckResult
      }
      await this.requireActorRow(tx, principal)
      const rows = await this.store.getWakeItemsByIds(tx, wakeIds)
      const byId = new Map(rows.map(row => [row.id, row]))
      const acked: string[] = []
      const alreadyAcked: string[] = []
      const failed: Array<{ wakeId: string; code: 'WAKE_NOT_FOUND' | 'WAKE_NOT_ACKABLE' }> = []
      for (const wakeId of wakeIds) {
        const row = byId.get(wakeId)
        if (row === undefined || row.actorId !== principal) {
          failed.push({ wakeId, code: 'WAKE_NOT_FOUND' })
          continue
        }
        if (row.status === 'acked') {
          alreadyAcked.push(wakeId)
          continue
        }
        if (!ACTIVE_WAKE_STATUSES.has(row.status)) {
          failed.push({ wakeId, code: 'WAKE_NOT_ACKABLE' })
          continue
        }
        const won = await this.store.markWakeAcked(tx, wakeId, this.now())
        if (won) acked.push(wakeId)
        else alreadyAcked.push(wakeId)
      }
      const result: AckResult = { acked, alreadyAcked, failed }
      if (idempotencyKey !== null) {
        await this.store.insertCommand(tx, {
          actorId: principal,
          command: 'ack',
          idempotencyKey,
          requestHash: requestHashValue,
          responseJson: JSON.stringify(result),
          createdAt: this.now(),
        })
      }
      return result
    })
  }

  async getWakeState(principal: string, input: GetWakeStateInput): Promise<WakeState[]> {
    this.assertOpen()
    const wakeIds = normalizeWakeIds(input.wakeIds, this.maxBatchWrites)
    return this.store.transaction(async tx => {
      await this.requireActorRow(tx, principal)
      const rows = await this.store.getWakeItemsByIds(tx, wakeIds)
      const byId = new Map(rows.map(row => [row.id, row]))
      const result: WakeState[] = []
      for (const wakeId of wakeIds) {
        const row = byId.get(wakeId)
        if (row === undefined || row.actorId !== principal) {
          throw new CollabError('WAKE_NOT_FOUND', `wake not found: ${wakeId}`)
        }
        result.push(toWakeState(row))
      }
      return result
    })
  }

  // --- internal -------------------------------------------------------------

  private async sendOne(tx: ChatTx, principal: string, input: SendMessageInput): Promise<SendResult> {
    if (input === null || typeof input !== 'object') throw invalid('message input must be an object')
    const requestHashValue = hashSendRequest(input)
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey)
    if (idempotencyKey !== null) {
      const replay = await this.replayCommand(tx, principal, 'send', idempotencyKey, requestHashValue)
      if (replay !== null) return { ...(replay as SendResult), replayed: true }
    }
    const roomId = validateRoomId(input.roomId)
    const body = validateBody(input.body, this.maxBodyBytes)
    const kind = validateKind(input.kind)
    const ticketKey = validateTicketKey(input.ticketKey)
    const replyToSeq = validateReplyToSeq(input.replyToSeq)
    const mentionAll = input.mentionAll === true
    const mentionIds = normalizeMentions(input.mentions, this.maxMentionsPerMessage)
    const access = await this.requireRoomAccess(tx, principal, roomId)
    const actor = access.actor
    if (actor.status === 'retired') throw new CollabError('ACTOR_RETIRED', 'a retired actor cannot send messages')
    if (actor.status === 'paused') throw new CollabError('ACTOR_PAUSED', 'a paused actor cannot send messages')
    if (access.room.archivedAt !== null) throw invalid('room is archived and read-only')
    if (access.room.kind === 'broadcast') {
      if (!access.member.canBroadcast) {
        throw new CollabError('BROADCAST_FORBIDDEN', 'broadcast send requires can_broadcast')
      }
      if (actor.kind === 'agent' && kind !== 'status' && kind !== 'handoff') {
        throw new CollabError('BROADCAST_KIND_REQUIRED', 'agent broadcast content must be kind=status or handoff')
      }
    }
    if (mentionAll) {
      if (access.room.kind === 'dm') throw new CollabError('MENTION_ALL_IN_DM', 'mention_all is not allowed in a DM')
      if (actor.kind !== 'human' && access.member.role !== 'owner') {
        throw new CollabError('MENTION_ALL_FORBIDDEN', 'mention_all requires a human or room owner')
      }
    }
    // Membership rows are only needed for mention validation and for wake planning
    // of DM / @all messages. Plain room and broadcast messages never fan out.
    const needsMembers = mentionIds.length > 0 || mentionAll || access.room.kind === 'dm'
    const members = needsMembers ? await this.store.listMembers(tx, roomId) : []
    if (mentionIds.length > 0) {
      const memberById = new Map(members.map(row => [row.actorId, row]))
      const mentionActors = await this.store.getActors(tx, mentionIds)
      const mentionActorById = new Map(mentionActors.map(row => [row.id, row]))
      for (const mentionId of mentionIds) {
        if (mentionId === principal) throw new CollabError('SELF_MENTION_FORBIDDEN', 'an actor cannot mention itself')
        const target = mentionActorById.get(mentionId)
        if (target === undefined) throw new CollabError('ACTOR_NOT_FOUND', `mentioned actor not found: ${mentionId}`)
        if (target.status === 'retired') throw new CollabError('ACTOR_RETIRED', 'a retired actor cannot be mentioned')
        if (!memberById.has(mentionId)) {
          throw new CollabError('MENTION_NOT_MEMBER', `mentioned actor is not a room member: ${mentionId}`)
        }
      }
    }
    let replySenderId: string | null = null
    if (replyToSeq !== null) {
      const target = await this.store.getMessageBySeqInRoom(tx, roomId, replyToSeq)
      if (target === undefined) throw new CollabError('UNKNOWN_REPLY', `reply target is not in room ${roomId}: ${replyToSeq}`)
      replySenderId = target.senderId
    }
    const message = await this.store.appendMessage(tx, {
      id: validateGeneratedId(this.newId(), 'message id'),
      roomId,
      senderId: principal,
      body,
      kind,
      ticketKey,
      mentionAll,
      mentions: mentionIds,
      replyToSeq,
      createdAt: this.now(),
    })
    const targets = this.planDirectedTargets({
      room: access.room,
      senderId: principal,
      members,
      mentionIds,
      mentionAll,
      replySenderId,
    })
    if (targets.size > 0) {
      const targetActors = await this.store.getActors(tx, [...targets.keys()])
      const targetById = new Map(targetActors.map(row => [row.id, row]))
      const createdAt = this.now()
      const wakeRows: WakeItemRow[] = []
      for (const [actorId, cause] of targets) {
        const target = targetById.get(actorId)
        // Paused targets are suppressed (digest only; the suppression row itself is a
        // later slice), retired targets were already rejected during validation.
        if (target === undefined || target.status !== 'active') continue
        const channel: WakeChannel = target.kind === 'human' ? 'human_panel' : 'dsh_followup'
        const priority: WakePriority = cause === 'mention_all' ? 'high' : 'normal'
        wakeRows.push({
          id: validateGeneratedId(this.newId(), 'wake id'),
          actorId,
          cause,
          roomId,
          sourceSeq: message.seq,
          sourceRoomSeq: message.roomSeq,
          channel,
          priority,
          status: 'pending',
          dedupeKey: wakeDedupeKey(message.seq, actorId),
          attempts: 0,
          nextAttemptAt: createdAt,
          leaseUntil: null,
          lastError: null,
          createdAt,
          ackedAt: null,
        })
      }
      if (wakeRows.length > 0) await this.store.insertWakeItems(tx, wakeRows)
    }
    const response: SendResult = {
      seq: message.seq,
      roomSeq: message.roomSeq,
      messageId: message.id,
      replayed: false,
    }
    if (idempotencyKey !== null) {
      await this.store.insertCommand(tx, {
        actorId: principal,
        command: 'send',
        idempotencyKey,
        requestHash: requestHashValue,
        responseJson: JSON.stringify(response),
        createdAt: this.now(),
      })
    }
    return response
  }

  /**
   * Directed-signal wake plan (F12). Ambient room/broadcast messages produce **no**
   * rows. One row per `(source message, target)` with the strongest cause:
   * mention_all > mention > dm > reply > on_call > system.
   */
  private planDirectedTargets(input: {
    room: RoomRow
    senderId: string
    members: RoomMemberRow[]
    mentionIds: string[]
    mentionAll: boolean
    replySenderId: string | null
  }): Map<string, WakeCause> {
    const targets = new Map<string, WakeCause>()
    const apply = (actorId: string, cause: WakeCause): void => {
      if (actorId === input.senderId) return
      const existing = targets.get(actorId)
      if (existing === undefined || CAUSE_RANK[cause] > CAUSE_RANK[existing]) targets.set(actorId, cause)
    }
    if (input.room.kind === 'dm') {
      for (const member of input.members) apply(member.actorId, 'dm')
    }
    if (input.replySenderId !== null) apply(input.replySenderId, 'reply')
    for (const mentionId of input.mentionIds) apply(mentionId, 'mention')
    if (input.mentionAll) {
      const eligible = input.members
        .filter(member => member.actorId !== input.senderId)
        .slice()
        .sort((a, b) => a.joinedAt - b.joinedAt || (a.actorId < b.actorId ? -1 : a.actorId > b.actorId ? 1 : 0))
        .slice(0, this.wakeMaxTargets)
      for (const member of eligible) apply(member.actorId, 'mention_all')
    }
    return targets
  }

  private async replayCommand(
    tx: ChatTx,
    principal: string,
    command: CommandName,
    idempotencyKey: string,
    requestHashValue: string,
  ): Promise<unknown | null> {
    const existing = await this.store.getCommand(tx, principal, command, idempotencyKey)
    if (existing === undefined) return null
    if (existing.requestHash !== requestHashValue) {
      throw new CollabError('IDEMPOTENCY_CONFLICT', 'idempotency key was used with a different request')
    }
    return JSON.parse(existing.responseJson) as unknown
  }

  private async requireActorRow(
    tx: ChatTx,
    actorId: string,
  ): Promise<{ id: string; kind: ActorKind; name: string; status: ActorStatus; createdAt: number }> {
    if (typeof actorId !== 'string' || !ACTOR_ID_PATTERN.test(actorId)) {
      throw new CollabError('ACTOR_NOT_FOUND', 'actor not found')
    }
    const row = await this.store.getActor(tx, actorId)
    if (row === undefined) throw new CollabError('ACTOR_NOT_FOUND', `actor not found: ${actorId}`)
    return row
  }

  private async requireRoomAccess(tx: ChatTx, principal: string, roomId: string): Promise<RoomAccess> {
    if (typeof principal === 'string' && ACTOR_ID_PATTERN.test(principal)) {
      const access = await this.store.getRoomAccess(tx, roomId, principal)
      if (access !== undefined) return access
    }
    // Only the failure path pays for the actor/room split.
    await this.requireActorRow(tx, principal)
    // No existence leak: non-members and unknown rooms are indistinguishable.
    throw new CollabError('ROOM_NOT_FOUND', `room not found: ${roomId}`)
  }

  private newRoomId(): string {
    return validateGeneratedId(this.newId(), 'room id')
  }

  private assertOpen(): void {
    if (this.closed) throw new CollabError('STORE_CLOSED', 'collab service is closed')
  }
}
