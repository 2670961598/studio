import { CollabError } from './errors.ts'
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
import type { ActorStatus } from './types.ts'

const PAIR = '\u0000'
const ACTIVE_WAKE_STATUSES: ReadonlySet<string> = new Set(['pending', 'claimed', 'delivered'])
const PRIORITY_RANK: Record<string, number> = { urgent: 4, high: 3, normal: 2, low: 1 }

function rowKey(a: string, b: string): string {
  return `${a}${PAIR}${b}`
}

function pairKey(low: string, high: string): string {
  return `${low}${PAIR}${high}`
}

class MemoryTx implements ChatTx {
  readonly kind = 'chat-tx' as const
  private readonly undo: Array<() => void> = []

  push(fn: () => void): void {
    this.undo.push(fn)
  }

  async savepoint<T>(fn: () => T | Promise<T>): Promise<T> {
    const mark = this.undo.length
    try {
      return await fn()
    } catch (error) {
      while (this.undo.length > mark) {
        this.undo.pop()?.()
      }
      throw error
    }
  }

  rollbackAll(): void {
    while (this.undo.length > 0) {
      this.undo.pop()?.()
    }
  }
}

function cloneActor(row: ActorRow): ActorRow {
  return { ...row }
}

function cloneRoom(row: RoomRow): RoomRow {
  return { ...row }
}

function cloneMember(row: RoomMemberRow): RoomMemberRow {
  return { ...row }
}

function cloneStats(row: RoomStatsRow): RoomStatsRow {
  return { ...row }
}

function cloneReadState(row: ReadStateRow): ReadStateRow {
  return { ...row }
}

function cloneMessage(row: MessageRow): MessageRow {
  return { ...row, mentions: [...row.mentions] }
}

function cloneWake(row: WakeItemRow): WakeItemRow {
  return { ...row }
}

function cloneCommand(row: CommandRow): CommandRow {
  return { ...row }
}

/** In-memory adapter. The reference implementation of the storage port contract. */
export class MemoryChatStore implements ChatStore {
  private readonly actors = new Map<string, ActorRow>()
  private readonly rooms = new Map<string, RoomRow>()
  private readonly members = new Map<string, RoomMemberRow>()
  private readonly membersByActor = new Map<string, Set<string>>()
  private readonly membersByRoom = new Map<string, Set<string>>()
  private readonly roomStats = new Map<string, RoomStatsRow>()
  private readonly readStates = new Map<string, ReadStateRow>()
  private readonly messagesBySeq = new Map<number, MessageRow>()
  private readonly roomMessageSeqs = new Map<string, number[]>()
  private readonly mentionIndex = new Map<string, number[]>()
  private readonly mentionAllSeqs: number[] = []
  private readonly wakeItems = new Map<string, WakeItemRow>()
  private readonly wakeDedupe = new Map<string, string>()
  private readonly commands = new Map<string, CommandRow>()
  private readonly dmPairs = new Map<string, string>()
  private nextSeq = 1
  private activeTx: MemoryTx | null = null
  private closed = false

  // --- transaction ----------------------------------------------------------

  async transaction<T>(fn: (tx: ChatTx) => T | Promise<T>): Promise<T> {
    this.assertOpen()
    if (this.activeTx !== null) return fn(this.activeTx)
    const tx = new MemoryTx()
    this.activeTx = tx
    try {
      return await fn(tx)
    } catch (error) {
      tx.rollbackAll()
      throw error
    } finally {
      this.activeTx = null
    }
  }

  async close(): Promise<void> {
    this.closed = true
  }

  // --- actors ---------------------------------------------------------------

  async insertActor(tx: ChatTx | null, row: ActorRow): Promise<void> {
    const t = this.writeTx(tx)
    if (this.actors.has(row.id)) throw new CollabError('ACTOR_ALREADY_EXISTS', `actor already exists: ${row.id}`)
    this.actors.set(row.id, cloneActor(row))
    t.push(() => this.actors.delete(row.id))
  }

  async getActor(tx: ChatTx | null, id: string): Promise<ActorRow | undefined> {
    this.assertOpen()
    this.checkReadTx(tx)
    const row = this.actors.get(id)
    return row === undefined ? undefined : cloneActor(row)
  }

  async getActors(tx: ChatTx | null, ids: readonly string[]): Promise<ActorRow[]> {
    this.assertOpen()
    this.checkReadTx(tx)
    const rows: ActorRow[] = []
    for (const id of ids) {
      const row = this.actors.get(id)
      if (row !== undefined) rows.push(cloneActor(row))
    }
    return rows
  }

  async listActors(tx: ChatTx | null): Promise<ActorRow[]> {
    this.assertOpen()
    this.checkReadTx(tx)
    return [...this.actors.values()].map(cloneActor)
  }

  async updateActorStatus(tx: ChatTx | null, id: string, status: ActorStatus): Promise<void> {
    const t = this.writeTx(tx)
    const row = this.actors.get(id)
    if (row === undefined) throw new CollabError('ACTOR_NOT_FOUND', `actor not found: ${id}`)
    this.actors.set(id, { ...row, status })
    t.push(() => this.actors.set(id, row))
  }

  // --- rooms ----------------------------------------------------------------

  async getRoomAccess(tx: ChatTx | null, roomId: string, actorId: string): Promise<RoomAccessRow | undefined> {
    this.assertOpen()
    this.checkReadTx(tx)
    const actor = this.actors.get(actorId)
    const room = this.rooms.get(roomId)
    const member = this.members.get(rowKey(roomId, actorId))
    if (actor === undefined || room === undefined || member === undefined) return undefined
    return { actor: cloneActor(actor), room: cloneRoom(room), member: cloneMember(member) }
  }

  async insertRoom(tx: ChatTx | null, row: RoomRow): Promise<void> {
    const t = this.writeTx(tx)
    if (this.rooms.has(row.id)) throw new CollabError('INVALID_INPUT', `room already exists: ${row.id}`)
    if (row.kind === 'broadcast' && this.findBroadcastRoomSync() !== undefined) {
      throw new CollabError('BROADCAST_ALREADY_EXISTS', 'one broadcast room per database')
    }
    if (row.dmKey !== null) {
      if (row.dmLow === null || row.dmHigh === null) {
        throw new CollabError('VALIDATION_FAILED', 'DM room requires dm_low/dm_high')
      }
      if (!(row.dmLow < row.dmHigh)) throw new CollabError('VALIDATION_FAILED', 'dm_low must be < dm_high')
      if (row.dmKey.length !== 64) throw new CollabError('VALIDATION_FAILED', 'dm_key must be 64 hex chars')
    }
    if (row.kind === 'dm' && (row.dmKey === null || row.dmLow === null || row.dmHigh === null)) {
      throw new CollabError('VALIDATION_FAILED', 'DM room requires dm_key/dm_low/dm_high')
    }
    if (row.dmLow !== null && row.dmHigh !== null) {
      const dmPair = pairKey(row.dmLow, row.dmHigh)
      if (this.dmPairs.has(dmPair)) {
        throw new CollabError('INVALID_INPUT', 'duplicate DM pair')
      }
      this.dmPairs.set(dmPair, row.id)
      t.push(() => this.dmPairs.delete(dmPair))
    }
    this.rooms.set(row.id, cloneRoom(row))
    t.push(() => this.rooms.delete(row.id))
  }

  async getRoom(tx: ChatTx | null, id: string): Promise<RoomRow | undefined> {
    this.assertOpen()
    this.checkReadTx(tx)
    const row = this.rooms.get(id)
    return row === undefined ? undefined : cloneRoom(row)
  }

  async findDmRoom(tx: ChatTx | null, dmLow: string, dmHigh: string): Promise<RoomRow | undefined> {
    this.assertOpen()
    this.checkReadTx(tx)
    const id = this.dmPairs.get(pairKey(dmLow, dmHigh))
    if (id === undefined) return undefined
    const row = this.rooms.get(id)
    return row === undefined ? undefined : cloneRoom(row)
  }

  async findBroadcastRoom(tx: ChatTx | null): Promise<RoomRow | undefined> {
    this.assertOpen()
    this.checkReadTx(tx)
    const row = this.findBroadcastRoomSync()
    return row === undefined ? undefined : cloneRoom(row)
  }

  async hasAnyBroadcastRoom(tx: ChatTx | null): Promise<boolean> {
    this.assertOpen()
    this.checkReadTx(tx)
    return this.findBroadcastRoomSync() !== undefined
  }

  async listRoomsForActor(tx: ChatTx | null, actorId: string): Promise<RoomRow[]> {
    this.assertOpen()
    this.checkReadTx(tx)
    const roomIds = this.membersByActor.get(actorId)
    if (roomIds === undefined) return []
    const rows: RoomRow[] = []
    for (const roomId of roomIds) {
      const row = this.rooms.get(roomId)
      if (row !== undefined) rows.push(cloneRoom(row))
    }
    rows.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    return rows
  }

  // --- members --------------------------------------------------------------

  async insertMembers(tx: ChatTx | null, rows: readonly RoomMemberRow[]): Promise<void> {
    const t = this.writeTx(tx)
    for (const row of rows) {
      const key = rowKey(row.roomId, row.actorId)
      if (this.members.has(key)) throw new CollabError('INVALID_INPUT', `member already exists: ${row.roomId}/${row.actorId}`)
      const roomSetExisted = this.membersByRoom.has(row.roomId)
      const actorSetExisted = this.membersByActor.has(row.actorId)
      this.members.set(key, cloneMember(row))
      const roomMembers = this.membersByRoom.get(row.roomId) ?? new Set<string>()
      roomMembers.add(row.actorId)
      this.membersByRoom.set(row.roomId, roomMembers)
      const actorRooms = this.membersByActor.get(row.actorId) ?? new Set<string>()
      actorRooms.add(row.roomId)
      this.membersByActor.set(row.actorId, actorRooms)
      t.push(() => {
        this.members.delete(key)
        const currentRoomSet = this.membersByRoom.get(row.roomId)
        if (currentRoomSet !== undefined) {
          currentRoomSet.delete(row.actorId)
          if (!roomSetExisted && currentRoomSet.size === 0) this.membersByRoom.delete(row.roomId)
        }
        const currentActorSet = this.membersByActor.get(row.actorId)
        if (currentActorSet !== undefined) {
          currentActorSet.delete(row.roomId)
          if (!actorSetExisted && currentActorSet.size === 0) this.membersByActor.delete(row.actorId)
        }
      })
    }
  }

  async getMember(tx: ChatTx | null, roomId: string, actorId: string): Promise<RoomMemberRow | undefined> {
    this.assertOpen()
    this.checkReadTx(tx)
    const row = this.members.get(rowKey(roomId, actorId))
    return row === undefined ? undefined : cloneMember(row)
  }

  async listMembers(tx: ChatTx | null, roomId: string): Promise<RoomMemberRow[]> {
    this.assertOpen()
    this.checkReadTx(tx)
    const ids = this.membersByRoom.get(roomId)
    if (ids === undefined) return []
    const rows: RoomMemberRow[] = []
    for (const actorId of ids) {
      const row = this.members.get(rowKey(roomId, actorId))
      if (row !== undefined) rows.push(cloneMember(row))
    }
    rows.sort((a, b) => a.joinedAt - b.joinedAt || (a.actorId < b.actorId ? -1 : a.actorId > b.actorId ? 1 : 0))
    return rows
  }

  async updateCanBroadcast(tx: ChatTx | null, roomId: string, actorId: string, canBroadcast: boolean): Promise<void> {
    const t = this.writeTx(tx)
    const key = rowKey(roomId, actorId)
    const row = this.members.get(key)
    if (row === undefined) throw new CollabError('NOT_MEMBER', `member not found: ${roomId}/${actorId}`)
    this.members.set(key, { ...row, canBroadcast })
    t.push(() => this.members.set(key, row))
  }

  async removeMember(tx: ChatTx | null, roomId: string, actorId: string): Promise<void> {
    const t = this.writeTx(tx)
    const key = rowKey(roomId, actorId)
    const row = this.members.get(key)
    if (row === undefined) return
    this.members.delete(key)
    this.membersByRoom.get(roomId)?.delete(actorId)
    this.membersByActor.get(actorId)?.delete(roomId)
    t.push(() => {
      this.members.set(key, row)
      const roomMembers = this.membersByRoom.get(roomId) ?? new Set<string>()
      roomMembers.add(actorId)
      this.membersByRoom.set(roomId, roomMembers)
      const actorRooms = this.membersByActor.get(actorId) ?? new Set<string>()
      actorRooms.add(roomId)
      this.membersByActor.set(actorId, actorRooms)
    })
  }

  // --- room stats -----------------------------------------------------------

  async insertRoomStats(tx: ChatTx | null, row: RoomStatsRow): Promise<void> {
    const t = this.writeTx(tx)
    if (this.roomStats.has(row.roomId)) throw new CollabError('INVALID_INPUT', `room stats already exist: ${row.roomId}`)
    this.roomStats.set(row.roomId, cloneStats(row))
    t.push(() => this.roomStats.delete(row.roomId))
  }

  async getRoomStats(tx: ChatTx | null, roomId: string): Promise<RoomStatsRow | undefined> {
    this.assertOpen()
    this.checkReadTx(tx)
    const row = this.roomStats.get(roomId)
    return row === undefined ? undefined : cloneStats(row)
  }

  // --- messages -------------------------------------------------------------

  async appendMessage(tx: ChatTx | null, input: AppendMessageInput): Promise<MessageRow> {
    const t = this.writeTx(tx)
    const stats = this.roomStats.get(input.roomId)
    if (stats === undefined) throw new CollabError('ROOM_NOT_FOUND', `room not found: ${input.roomId}`)
    const roomSeq = stats.headRoomSeq + 1
    const seq = this.nextSeq
    const prevNextSeq = this.nextSeq
    const mentions = [...new Set(input.mentions)].sort()
    const row: MessageRow = {
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
    this.nextSeq = seq + 1
    this.messagesBySeq.set(seq, row)
    const roomSeqList = this.roomMessageSeqs.get(input.roomId) ?? []
    roomSeqList.push(seq)
    this.roomMessageSeqs.set(input.roomId, roomSeqList)
    this.roomStats.set(input.roomId, {
      ...stats,
      headSeq: seq,
      headRoomSeq: roomSeq,
      lastActivityAt: input.createdAt,
      updatedAt: input.createdAt,
    })
    for (const actorId of mentions) {
      const list = this.mentionIndex.get(actorId) ?? []
      list.push(seq)
      this.mentionIndex.set(actorId, list)
    }
    if (input.mentionAll) this.mentionAllSeqs.push(seq)
    t.push(() => {
      this.nextSeq = prevNextSeq
      this.messagesBySeq.delete(seq)
      const list = this.roomMessageSeqs.get(input.roomId)
      if (list !== undefined) {
        list.pop()
        if (list.length === 0) this.roomMessageSeqs.delete(input.roomId)
      }
      this.roomStats.set(input.roomId, stats)
      for (const actorId of mentions) {
        const index = this.mentionIndex.get(actorId)
        if (index !== undefined) {
          index.pop()
          if (index.length === 0) this.mentionIndex.delete(actorId)
        }
      }
      if (input.mentionAll) this.mentionAllSeqs.pop()
    })
    return cloneMessage(row)
  }

  async getMessageBySeqInRoom(tx: ChatTx | null, roomId: string, seq: number): Promise<MessageRow | undefined> {
    this.assertOpen()
    this.checkReadTx(tx)
    const row = this.messagesBySeq.get(seq)
    if (row === undefined || row.roomId !== roomId) return undefined
    return cloneMessage(row)
  }

  async getMessageSeqInRoomAtOrBelow(tx: ChatTx | null, roomId: string, roomSeq: number): Promise<number> {
    this.assertOpen()
    this.checkReadTx(tx)
    const seqs = this.roomMessageSeqs.get(roomId)
    if (seqs === undefined || seqs.length === 0 || roomSeq <= 0) return 0
    const index = Math.min(roomSeq, seqs.length) - 1
    const seq = seqs[index]
    return seq === undefined ? 0 : seq
  }

  async getMessagesBySeqs(tx: ChatTx | null, roomId: string, seqs: readonly number[]): Promise<MessageRow[]> {
    this.assertOpen()
    this.checkReadTx(tx)
    const rows: MessageRow[] = []
    for (const seq of seqs) {
      const row = this.messagesBySeq.get(seq)
      if (row !== undefined && row.roomId === roomId) rows.push(cloneMessage(row))
    }
    rows.sort((a, b) => a.seq - b.seq)
    return rows
  }

  async listMessages(tx: ChatTx | null, roomId: string, afterRoomSeq: number, limit: number): Promise<MessageRow[]> {
    this.assertOpen()
    this.checkReadTx(tx)
    const seqs = this.roomMessageSeqs.get(roomId)
    if (seqs === undefined) return []
    const start = Math.max(0, afterRoomSeq)
    const selected = seqs.slice(start, start + limit)
    const rows: MessageRow[] = []
    for (const seq of selected) {
      const row = this.messagesBySeq.get(seq)
      if (row !== undefined) rows.push(cloneMessage(row))
    }
    return rows
  }

  async listLastMessagesByRooms(
    tx: ChatTx | null,
    roomIds: readonly string[],
    perRoom: number,
  ): Promise<LastMessageRow[]> {
    this.assertOpen()
    this.checkReadTx(tx)
    const rows: LastMessageRow[] = []
    for (const roomId of roomIds) {
      const seqs = this.roomMessageSeqs.get(roomId)
      if (seqs === undefined) continue
      const start = Math.max(0, seqs.length - perRoom)
      for (let index = start; index < seqs.length; index += 1) {
        const seq = seqs[index]
        if (seq === undefined) continue
        const row = this.messagesBySeq.get(seq)
        if (row === undefined) continue
        rows.push({
          seq: row.seq,
          roomId: row.roomId,
          roomSeq: row.roomSeq,
          senderId: row.senderId,
          kind: row.kind,
          createdAt: row.createdAt,
        })
      }
    }
    return rows
  }

  async countMessages(tx: ChatTx | null): Promise<number> {
    this.assertOpen()
    this.checkReadTx(tx)
    return this.messagesBySeq.size
  }

  // --- read state -----------------------------------------------------------

  async upsertReadState(tx: ChatTx | null, row: ReadStateRow): Promise<void> {
    const t = this.writeTx(tx)
    const key = rowKey(row.roomId, row.actorId)
    const existing = this.readStates.get(key)
    if (existing !== undefined) {
      if (row.lastReadSeq < existing.lastReadSeq || row.lastReadRoomSeq < existing.lastReadRoomSeq) {
        throw new CollabError('READ_STATE_BACKWARDS', 'read state never decreases')
      }
    }
    this.readStates.set(key, cloneReadState(row))
    t.push(() => {
      if (existing === undefined) this.readStates.delete(key)
      else this.readStates.set(key, existing)
    })
  }

  async getReadState(tx: ChatTx | null, roomId: string, actorId: string): Promise<ReadStateRow | undefined> {
    this.assertOpen()
    this.checkReadTx(tx)
    const row = this.readStates.get(rowKey(roomId, actorId))
    return row === undefined ? undefined : cloneReadState(row)
  }

  async removeReadState(tx: ChatTx | null, roomId: string, actorId: string): Promise<void> {
    const t = this.writeTx(tx)
    const key = rowKey(roomId, actorId)
    const row = this.readStates.get(key)
    if (row === undefined) return
    this.readStates.delete(key)
    t.push(() => this.readStates.set(key, row))
  }

  async insertReadStates(tx: ChatTx | null, rows: readonly ReadStateRow[]): Promise<void> {
    const t = this.writeTx(tx)
    for (const row of rows) {
      const key = rowKey(row.roomId, row.actorId)
      if (this.readStates.has(key)) throw new CollabError('INVALID_INPUT', `read state already exists: ${key}`)
      this.readStates.set(key, cloneReadState(row))
      t.push(() => this.readStates.delete(key))
    }
  }

  async countReadStatesForRoom(tx: ChatTx | null, roomId: string): Promise<number> {
    this.assertOpen()
    this.checkReadTx(tx)
    let count = 0
    for (const row of this.readStates.values()) {
      if (row.roomId === roomId) count += 1
    }
    return count
  }

  // --- wake queue -----------------------------------------------------------

  async insertWakeItems(tx: ChatTx | null, rows: readonly WakeItemRow[]): Promise<void> {
    const t = this.writeTx(tx)
    for (const row of rows) {
      if (this.wakeItems.has(row.id)) throw new CollabError('VALIDATION_FAILED', `wake already exists: ${row.id}`)
      if (this.wakeDedupe.has(row.dedupeKey)) {
        throw new CollabError('VALIDATION_FAILED', `duplicate wake dedupe key: ${row.dedupeKey}`)
      }
      this.wakeItems.set(row.id, cloneWake(row))
      this.wakeDedupe.set(row.dedupeKey, row.id)
      t.push(() => {
        this.wakeItems.delete(row.id)
        this.wakeDedupe.delete(row.dedupeKey)
      })
    }
  }

  async getWakeItemsByIds(tx: ChatTx | null, ids: readonly string[]): Promise<WakeItemRow[]> {
    this.assertOpen()
    this.checkReadTx(tx)
    const rows: WakeItemRow[] = []
    for (const id of ids) {
      const row = this.wakeItems.get(id)
      if (row !== undefined) rows.push(cloneWake(row))
    }
    return rows
  }

  async markWakeAcked(tx: ChatTx | null, id: string, ackedAt: number): Promise<boolean> {
    const t = this.writeTx(tx)
    const row = this.wakeItems.get(id)
    if (row === undefined) return false
    if (!ACTIVE_WAKE_STATUSES.has(row.status)) return false
    this.wakeItems.set(id, { ...row, status: 'acked', ackedAt })
    t.push(() => this.wakeItems.set(id, row))
    return true
  }

  async countPendingWakes(tx: ChatTx | null, actorId: string): Promise<number> {
    this.assertOpen()
    this.checkReadTx(tx)
    let count = 0
    for (const row of this.wakeItems.values()) {
      if (row.actorId === actorId && ACTIVE_WAKE_STATUSES.has(row.status)) count += 1
    }
    return count
  }

  async listPendingWakeIds(tx: ChatTx | null, actorId: string, limit: number): Promise<string[]> {
    this.assertOpen()
    this.checkReadTx(tx)
    const rows = [...this.wakeItems.values()].filter(
      row => row.actorId === actorId && ACTIVE_WAKE_STATUSES.has(row.status),
    )
    rows.sort((a, b) => {
      const rank = (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0)
      if (rank !== 0) return rank
      return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    })
    return rows.slice(0, limit).map(row => row.id)
  }

  async terminatePendingWakes(
    tx: ChatTx | null,
    actorId: string,
    status: 'failed' | 'suppressed',
    lastError: string,
    at: number,
  ): Promise<number> {
    const t = this.writeTx(tx)
    let count = 0
    for (const [id, row] of this.wakeItems) {
      if (row.actorId !== actorId || !ACTIVE_WAKE_STATUSES.has(row.status)) continue
      this.wakeItems.set(id, { ...row, status, lastError, nextAttemptAt: at })
      t.push(() => this.wakeItems.set(id, row))
      count += 1
    }
    return count
  }

  async countWakeItemsForActor(tx: ChatTx | null, actorId: string): Promise<number> {
    this.assertOpen()
    this.checkReadTx(tx)
    let count = 0
    for (const row of this.wakeItems.values()) {
      if (row.actorId === actorId) count += 1
    }
    return count
  }

  async countAllWakeItems(tx: ChatTx | null): Promise<number> {
    this.assertOpen()
    this.checkReadTx(tx)
    return this.wakeItems.size
  }

  // --- digest read models ---------------------------------------------------

  async inboxTotals(
    tx: ChatTx | null,
    actorId: string,
    roomIds: readonly string[] | null,
  ): Promise<InboxTotalsRow> {
    this.assertOpen()
    this.checkReadTx(tx)
    const filter = roomIds === null ? null : new Set(roomIds)
    const rooms = this.memberRoomIds(actorId, filter)
    let unread = 0
    for (const roomId of rooms) {
      const stats = this.roomStats.get(roomId)
      const read = this.readStates.get(rowKey(roomId, actorId))
      if (stats === undefined || read === undefined) continue
      unread += Math.max(0, stats.headRoomSeq - read.lastReadRoomSeq)
    }
    const mentions = this.unreadMentionsFor(actorId, filter).length
    return { rooms: rooms.length, unread, mentions }
  }

  async listRoomDigest(
    tx: ChatTx | null,
    actorId: string,
    roomIds: readonly string[] | null,
    limit: number,
  ): Promise<RoomDigestRow[]> {
    this.assertOpen()
    this.checkReadTx(tx)
    const filter = roomIds === null ? null : new Set(roomIds)
    const mentionCounts = new Map<string, number>()
    for (const mention of this.unreadMentionsFor(actorId, filter)) {
      mentionCounts.set(mention.roomId, (mentionCounts.get(mention.roomId) ?? 0) + 1)
    }
    const rows: RoomDigestRow[] = []
    for (const roomId of this.memberRoomIds(actorId, filter)) {
      const room = this.rooms.get(roomId)
      const stats = this.roomStats.get(roomId)
      const read = this.readStates.get(rowKey(roomId, actorId))
      if (room === undefined || stats === undefined || read === undefined) continue
      rows.push({
        roomId,
        kind: room.kind,
        name: room.name,
        headSeq: stats.headSeq,
        headRoomSeq: stats.headRoomSeq,
        lastReadSeq: read.lastReadSeq,
        lastReadRoomSeq: read.lastReadRoomSeq,
        unread: Math.max(0, stats.headRoomSeq - read.lastReadRoomSeq),
        mentionCount: mentionCounts.get(roomId) ?? 0,
        lastActivityAt: stats.lastActivityAt,
      })
    }
    rows.sort((a, b) => b.lastActivityAt - a.lastActivityAt || (a.roomId < b.roomId ? -1 : a.roomId > b.roomId ? 1 : 0))
    return rows.slice(0, limit)
  }

  async countRoomsForActor(
    tx: ChatTx | null,
    actorId: string,
    roomIds: readonly string[] | null,
  ): Promise<number> {
    this.assertOpen()
    this.checkReadTx(tx)
    const filter = roomIds === null ? null : new Set(roomIds)
    return this.memberRoomIds(actorId, filter).length
  }

  async listUnreadMentions(
    tx: ChatTx | null,
    actorId: string,
    roomIds: readonly string[] | null,
    limit: number,
  ): Promise<MentionDigestRow[]> {
    this.assertOpen()
    this.checkReadTx(tx)
    const filter = roomIds === null ? null : new Set(roomIds)
    const rows: MentionDigestRow[] = this.unreadMentionsFor(actorId, filter).map(row => ({
      seq: row.seq,
      roomId: row.roomId,
      senderId: row.senderId,
      mentionAll: row.mentionAll,
    }))
    rows.sort((a, b) => a.seq - b.seq)
    return rows.slice(0, limit)
  }

  async countUnreadMentionAll(
    tx: ChatTx | null,
    actorId: string,
    roomIds: readonly string[] | null,
  ): Promise<number> {
    this.assertOpen()
    this.checkReadTx(tx)
    const filter = roomIds === null ? null : new Set(roomIds)
    let count = 0
    for (const seq of this.mentionAllSeqs) {
      const message = this.messagesBySeq.get(seq)
      if (message === undefined) continue
      if (filter !== null && !filter.has(message.roomId)) continue
      const read = this.readStates.get(rowKey(message.roomId, actorId))
      if (read !== undefined && message.roomSeq > read.lastReadRoomSeq) count += 1
    }
    return count
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
    const row = this.commands.get(rowKey(actorId, rowKey(command, key)))
    return row === undefined ? undefined : cloneCommand(row)
  }

  async insertCommand(tx: ChatTx | null, row: CommandRow): Promise<void> {
    const t = this.writeTx(tx)
    const key = rowKey(row.actorId, rowKey(row.command, row.idempotencyKey))
    if (this.commands.has(key)) throw new CollabError('IDEMPOTENCY_CONFLICT', 'idempotency key already used')
    this.commands.set(key, cloneCommand(row))
    t.push(() => this.commands.delete(key))
  }

  // --- private helpers ------------------------------------------------------

  private findBroadcastRoomSync(): RoomRow | undefined {
    for (const row of this.rooms.values()) {
      if (row.kind === 'broadcast') return row
    }
    return undefined
  }

  private memberRoomIds(actorId: string, filter: ReadonlySet<string> | null): string[] {
    const roomIds = this.membersByActor.get(actorId)
    if (roomIds === undefined) return []
    const result: string[] = []
    for (const roomId of roomIds) {
      if (filter !== null && !filter.has(roomId)) continue
      result.push(roomId)
    }
    return result
  }

  private unreadMentionsFor(
    actorId: string,
    filter: ReadonlySet<string> | null,
  ): Array<{ seq: number; roomId: string; senderId: string; mentionAll: boolean }> {
    const seqs = this.mentionIndex.get(actorId) ?? []
    const rows: Array<{ seq: number; roomId: string; senderId: string; mentionAll: boolean }> = []
    for (const seq of seqs) {
      const message = this.messagesBySeq.get(seq)
      if (message === undefined) continue
      if (filter !== null && !filter.has(message.roomId)) continue
      const read = this.readStates.get(rowKey(message.roomId, actorId))
      if (read === undefined || message.roomSeq <= read.lastReadRoomSeq) continue
      rows.push({
        seq: message.seq,
        roomId: message.roomId,
        senderId: message.senderId,
        mentionAll: message.mentionAll,
      })
    }
    return rows
  }

  private writeTx(tx: ChatTx | null): MemoryTx {
    this.assertOpen()
    if (!(tx instanceof MemoryTx)) {
      throw new CollabError('INVALID_INPUT', 'write requires an open transaction')
    }
    return tx
  }

  private checkReadTx(tx: ChatTx | null): void {
    if (tx !== null && !(tx instanceof MemoryTx)) {
      throw new CollabError('INVALID_INPUT', 'unknown transaction handle')
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new CollabError('STORE_CLOSED', 'collab store is closed')
  }
}
