import type {
  AllocatedKey,
  CommandLogRow,
  CommentRow,
  CountTicketsFilterRow,
  DescendantRow,
  EventRow,
  EvidenceRow,
  GateRunRow,
  MembershipRow,
  NewCommentRow,
  NewEvent,
  OutboxRow,
  PrincipalRow,
  ProjectRow,
  TicketFilterRow,
  TicketListPos,
  TicketPatch,
  TicketRow,
  TicketStore,
  TicketTx,
} from './store.ts'
import { IssuesError } from './errors.ts'
import type { Role } from './types.ts'
import { canonicalJson, sha256Hex } from './util.ts'

interface MemoryState {
  principals: Map<string, PrincipalRow>
  projects: Map<string, ProjectRow>
  memberships: MembershipRow[]
  tickets: Map<string, TicketRow>
  labels: Map<string, string[]>
  comments: Map<string, CommentRow>
  evidence: Map<string, EvidenceRow>
  gateRuns: Map<string, GateRunRow>
  events: EventRow[]
  outbox: OutboxRow[]
  commandLogs: Map<string, CommandLogRow>
  eventIdemKeys: Set<string>
  chainLastHash: Map<string, string>
  nextCommentSeq: number
  nextEventSeq: number
  nextOutboxSeq: number
}

function emptyState(): MemoryState {
  return {
    principals: new Map(),
    projects: new Map(),
    memberships: [],
    tickets: new Map(),
    labels: new Map(),
    comments: new Map(),
    evidence: new Map(),
    gateRuns: new Map(),
    events: [],
    outbox: [],
    commandLogs: new Map(),
    eventIdemKeys: new Set(),
    chainLastHash: new Map(),
    nextCommentSeq: 1,
    nextEventSeq: 1,
    nextOutboxSeq: 1,
  }
}

function makeTx(): TicketTx {
  return {} as unknown as TicketTx
}

function cloneRow<T>(row: T): T {
  return structuredClone(row)
}

/**
 * In-memory TicketStore. Runs the same contract suite as the SQLite adapter;
 * transactions roll back by restoring a structured snapshot of the state.
 */
export class MemoryIssuesStore implements TicketStore {
  private state: MemoryState
  private inTransaction = false
  private batchQueries = 0
  private closed = false

  constructor() {
    this.state = emptyState()
  }

  get queryCount(): number {
    return this.batchQueries
  }

  bootstrap(now: number): void {
    this.transaction(tx => {
      const existing = this.getPrincipal(tx, 'daemon:local')
      if (existing !== undefined) return
      this.insertPrincipal(tx, {
        id: 'daemon:local',
        kind: 'daemon',
        displayName: 'daemon:local',
        status: 'active',
        createdAt: now,
      })
    })
  }

  transaction<T>(fn: (tx: TicketTx) => T): T {
    this.assertOpen()
    if (this.inTransaction) return fn(makeTx())
    const snapshot = structuredClone(this.state)
    this.inTransaction = true
    try {
      return fn(makeTx())
    } catch (error) {
      this.state = snapshot
      throw error
    } finally {
      this.inTransaction = false
    }
  }

  close(): void {
    this.closed = true
  }

  insertPrincipal(_tx: TicketTx, row: PrincipalRow): void {
    if (this.state.principals.has(row.id)) {
      throw new IssuesError('VALIDATION_FAILED', `principal already exists: ${row.id}`)
    }
    this.state.principals.set(row.id, cloneRow(row))
  }

  getPrincipal(_tx: TicketTx, id: string): PrincipalRow | undefined {
    const row = this.state.principals.get(id)
    return row === undefined ? undefined : cloneRow(row)
  }

  listPrincipals(_tx: TicketTx): PrincipalRow[] {
    return [...this.state.principals.values()]
      .map(cloneRow)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  }

  insertProject(_tx: TicketTx, row: ProjectRow): void {
    if (this.state.projects.has(row.id)) {
      throw new IssuesError('VALIDATION_FAILED', `project already exists: ${row.id}`)
    }
    for (const existing of this.state.projects.values()) {
      if (existing.keyPrefix === row.keyPrefix) {
        throw new IssuesError('VALIDATION_FAILED', `project key prefix already exists: ${row.keyPrefix}`)
      }
    }
    this.state.projects.set(row.id, cloneRow(row))
  }

  getProject(_tx: TicketTx, id: string): ProjectRow | undefined {
    const row = this.state.projects.get(id)
    return row === undefined ? undefined : cloneRow(row)
  }

  updateProjectPolicy(
    _tx: TicketTx,
    projectId: string,
    expectedGeneration: number,
    policyJson: string,
    _now: number,
  ): boolean {
    const row = this.state.projects.get(projectId)
    if (row === undefined) return false
    if (row.policyGeneration !== expectedGeneration) return false
    this.state.projects.set(projectId, {
      ...row,
      policyJson,
      policyGeneration: row.policyGeneration + 1,
    })
    return true
  }

  allocateTicketKey(_tx: TicketTx, projectId: string, _now: number): AllocatedKey {
    const row = this.state.projects.get(projectId)
    if (row === undefined) {
      throw new IssuesError('PROJECT_NOT_FOUND', 'project not found')
    }
    const seq = row.nextTicketSeq
    this.state.projects.set(projectId, { ...row, nextTicketSeq: seq + 1 })
    return { seq, key: `${row.keyPrefix}-${seq}` }
  }

  insertMembership(_tx: TicketTx, row: MembershipRow): void {
    const exists = this.state.memberships.some(
      item =>
        item.projectId === row.projectId &&
        item.principalId === row.principalId &&
        item.role === row.role,
    )
    if (!exists) this.state.memberships.push(cloneRow(row))
  }

  getMembershipRoles(_tx: TicketTx, projectId: string, principalId: string): Role[] {
    return this.state.memberships
      .filter(item => item.projectId === projectId && item.principalId === principalId)
      .map(item => item.role)
      .sort()
  }

  listMemberships(_tx: TicketTx, projectId: string): MembershipRow[] {
    return this.state.memberships
      .filter(item => item.projectId === projectId)
      .map(cloneRow)
      .sort(
        (a, b) =>
          a.principalId.localeCompare(b.principalId) || a.role.localeCompare(b.role),
      )
  }

  insertTicket(_tx: TicketTx, row: TicketRow): void {
    if (this.state.tickets.has(row.id)) {
      throw new IssuesError('VALIDATION_FAILED', `ticket already exists: ${row.id}`)
    }
    this.state.tickets.set(row.id, cloneRow(row))
  }

  getTicket(_tx: TicketTx, projectId: string, id: string): TicketRow | undefined {
    const row = this.state.tickets.get(id)
    if (row === undefined || row.projectId !== projectId) return undefined
    return cloneRow(row)
  }

  getTicketByIdOrKey(_tx: TicketTx, projectId: string, idOrKey: string): TicketRow | undefined {
    const direct = this.state.tickets.get(idOrKey)
    if (direct !== undefined && direct.projectId === projectId) return cloneRow(direct)
    for (const row of this.state.tickets.values()) {
      if (row.projectId === projectId && row.key === idOrKey) return cloneRow(row)
    }
    return undefined
  }

  getTicketProject(_tx: TicketTx, ticketId: string): string | undefined {
    const row = this.state.tickets.get(ticketId)
    return row === undefined ? undefined : row.projectId
  }

  getTicketsByIds(_tx: TicketTx, projectId: string, ids: readonly string[]): TicketRow[] {
    this.batchQueries += 1
    const rows: TicketRow[] = []
    for (const id of ids) {
      const row = this.state.tickets.get(id)
      if (row !== undefined && row.projectId === projectId) rows.push(cloneRow(row))
    }
    return rows
  }

  updateTicketCas(
    _tx: TicketTx,
    id: string,
    expectedRevision: number,
    patch: TicketPatch,
  ): TicketRow | undefined {
    const row = this.state.tickets.get(id)
    if (row === undefined || row.revision !== expectedRevision) return undefined
    const updated: TicketRow = { ...row, ...cloneRow(patch), revision: row.revision + 1 }
    this.state.tickets.set(id, cloneRow(updated))
    return cloneRow(updated)
  }

  queryTickets(
    _tx: TicketTx,
    projectId: string,
    filter: TicketFilterRow,
    pos: TicketListPos | null,
    limit: number,
  ): TicketRow[] {
    const labels = this.state.labels
    const rows = [...this.state.tickets.values()]
      .filter(row => row.projectId === projectId)
      .filter(row => filter.includeArchived === true || row.archivedAt === null)
      .filter(row =>
        filter.stateCodes === undefined || filter.stateCodes.includes(row.stateCode),
      )
      .filter(row => filter.assigneeId === undefined || row.assigneeId === filter.assigneeId)
      .filter(row => filter.reviewerId === undefined || row.reviewerId === filter.reviewerId)
      .filter(row => filter.kind === undefined || row.kind === filter.kind)
      .filter(row => filter.priority === undefined || row.priority === filter.priority)
      .filter(row => {
        if (filter.label === undefined) return true
        return (labels.get(row.id) ?? []).includes(filter.label)
      })
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
      .filter(row => {
        if (pos === null) return true
        if (row.updatedAt < pos.updatedAt) return true
        if (row.updatedAt > pos.updatedAt) return false
        return row.id > pos.id
      })
      .slice(0, limit)
    return rows.map(cloneRow)
  }

  countTickets(_tx: TicketTx, projectId: string, filter: CountTicketsFilterRow): number {
    let count = 0
    for (const row of this.state.tickets.values()) {
      if (row.projectId !== projectId) continue
      if (filter.stateCodes !== undefined && !filter.stateCodes.includes(row.stateCode)) continue
      if (filter.assigneeId !== undefined && row.assigneeId !== filter.assigneeId) continue
      count += 1
    }
    return count
  }

  listChildren(_tx: TicketTx, projectId: string, parentId: string): TicketRow[] {
    return [...this.state.tickets.values()]
      .filter(row => row.projectId === projectId && row.parentId === parentId)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map(cloneRow)
  }

  listAncestorIds(_tx: TicketTx, ticketId: string): string[] {
    const result: string[] = []
    const seen = new Set<string>([ticketId])
    let current = this.state.tickets.get(ticketId)
    while (current !== undefined && current.parentId !== null) {
      if (seen.has(current.parentId)) break
      seen.add(current.parentId)
      result.push(current.parentId)
      current = this.state.tickets.get(current.parentId)
    }
    return result
  }

  maxSubtreeDepth(_tx: TicketTx, ticketId: string): number {
    let maxDepth = 0
    const queue: Array<{ id: string; depth: number }> = [{ id: ticketId, depth: 0 }]
    const seen = new Set<string>([ticketId])
    while (queue.length > 0) {
      const item = queue.pop()
      if (item === undefined) break
      if (item.depth > maxDepth) maxDepth = item.depth
      for (const row of this.state.tickets.values()) {
        if (row.parentId === item.id && !seen.has(row.id)) {
          seen.add(row.id)
          queue.push({ id: row.id, depth: item.depth + 1 })
        }
      }
    }
    return maxDepth
  }

  listDescendants(_tx: TicketTx, ticketId: string): DescendantRow[] {
    const result: DescendantRow[] = []
    const seen = new Set<string>([ticketId])
    const queue: Array<{ id: string; depth: number }> = [{ id: ticketId, depth: 0 }]
    while (queue.length > 0) {
      const item = queue.shift()
      if (item === undefined) break
      for (const row of this.state.tickets.values()) {
        if (row.parentId !== item.id || seen.has(row.id)) continue
        seen.add(row.id)
        result.push({ id: row.id, depth: item.depth + 1 })
        queue.push({ id: row.id, depth: item.depth + 1 })
      }
    }
    return result.sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id))
  }

  setLabels(_tx: TicketTx, ticketId: string, labels: readonly string[]): void {
    this.state.labels.set(ticketId, [...labels])
  }

  getLabels(_tx: TicketTx, ticketId: string): string[] {
    return [...(this.state.labels.get(ticketId) ?? [])]
  }

  getLabelsForTickets(_tx: TicketTx, ticketIds: readonly string[]): Map<string, string[]> {
    this.batchQueries += 1
    const result = new Map<string, string[]>()
    for (const id of ticketIds) {
      const labels = this.state.labels.get(id)
      if (labels !== undefined) result.set(id, [...labels])
    }
    return result
  }

  insertComment(_tx: TicketTx, row: NewCommentRow): CommentRow {
    const seq = this.state.nextCommentSeq
    this.state.nextCommentSeq += 1
    const stored: CommentRow = { ...cloneRow(row), seq }
    this.state.comments.set(stored.id, stored)
    return cloneRow(stored)
  }

  getComment(_tx: TicketTx, commentId: string): CommentRow | undefined {
    const row = this.state.comments.get(commentId)
    return row === undefined ? undefined : cloneRow(row)
  }

  getCommentsByIds(_tx: TicketTx, projectId: string, ids: readonly string[]): CommentRow[] {
    this.batchQueries += 1
    const result: CommentRow[] = []
    for (const id of ids) {
      const comment = this.state.comments.get(id)
      if (comment === undefined) continue
      const ticket = this.state.tickets.get(comment.ticketId)
      if (ticket === undefined || ticket.projectId !== projectId) continue
      result.push(cloneRow(comment))
    }
    return result
  }

  listComments(_tx: TicketTx, ticketId: string, afterSeq: number, limit: number): CommentRow[] {
    return [...this.state.comments.values()]
      .filter(row => row.ticketId === ticketId && row.seq > afterSeq)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit)
      .map(cloneRow)
  }

  insertEvidence(_tx: TicketTx, row: EvidenceRow): void {
    if (this.state.evidence.has(row.id)) {
      throw new IssuesError('VALIDATION_FAILED', `evidence already exists: ${row.id}`)
    }
    this.state.evidence.set(row.id, cloneRow(row))
  }

  getEvidence(_tx: TicketTx, evidenceId: string): EvidenceRow | undefined {
    const row = this.state.evidence.get(evidenceId)
    return row === undefined ? undefined : cloneRow(row)
  }

  getEvidenceByIds(_tx: TicketTx, ids: readonly string[]): EvidenceRow[] {
    const result: EvidenceRow[] = []
    for (const id of ids) {
      const row = this.state.evidence.get(id)
      if (row !== undefined) result.push(cloneRow(row))
    }
    return result
  }

  listEvidence(_tx: TicketTx, ticketId: string): EvidenceRow[] {
    return [...this.state.evidence.values()]
      .filter(row => row.ticketId === ticketId)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map(cloneRow)
  }

  insertGateRun(_tx: TicketTx, row: GateRunRow): void {
    if (this.state.gateRuns.has(row.id)) {
      throw new IssuesError('VALIDATION_FAILED', `gate run already exists: ${row.id}`)
    }
    this.state.gateRuns.set(row.id, cloneRow(row))
  }

  getGateRun(_tx: TicketTx, gateRunId: string): GateRunRow | undefined {
    const row = this.state.gateRuns.get(gateRunId)
    return row === undefined ? undefined : cloneRow(row)
  }

  listGateRuns(_tx: TicketTx, ticketId: string): GateRunRow[] {
    return [...this.state.gateRuns.values()]
      .filter(row => row.ticketId === ticketId)
      .sort((a, b) => a.producedAt - b.producedAt || a.id.localeCompare(b.id))
      .map(cloneRow)
  }

  appendEvents(_tx: TicketTx, events: readonly NewEvent[], now: number): EventRow[] {
    const appended: EventRow[] = []
    for (const event of events) {
      if (event.idempotencyKey !== null) {
        const idemKey = `${event.actorId}\u0000${event.idempotencyKey}`
        if (this.state.eventIdemKeys.has(idemKey)) {
          throw new IssuesError('IDEMPOTENCY_CONFLICT', 'event idempotency key is already used', {
            actorId: event.actorId,
          })
        }
        this.state.eventIdemKeys.add(idemKey)
      }
      const prevHash = this.state.chainLastHash.get(event.chainKey) ?? 'GENESIS'
      const seq = this.state.nextEventSeq
      this.state.nextEventSeq += 1
      const entryHash = hashEvent(event, prevHash)
      const stored: EventRow = {
        seq,
        id: event.id,
        projectId: event.projectId,
        ticketId: event.ticketId,
        chainKey: event.chainKey,
        type: event.type,
        actorId: event.actorId,
        actorKind: event.actorKind,
        occurredAt: event.occurredAt,
        revisionBefore: event.revisionBefore,
        revisionAfter: event.revisionAfter,
        fromStateCode: event.fromStateCode,
        toStateCode: event.toStateCode,
        payload: cloneRow(event.payload),
        prevHash,
        entryHash,
        idempotencyKey: event.idempotencyKey,
        createdAt: now,
      }
      this.state.events.push(stored)
      this.state.chainLastHash.set(event.chainKey, entryHash)
      const outboxSeq = this.state.nextOutboxSeq
      this.state.nextOutboxSeq += 1
      this.state.outbox.push({
        seq: outboxSeq,
        eventId: stored.id,
        topic: event.outboxTopic,
        payloadJson: canonicalJson(event.payload),
        status: 'pending',
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
        deliveredAt: null,
      })
      appended.push(cloneRow(stored))
    }
    return appended
  }

  getLastTicketEvent(
    _tx: TicketTx,
    ticketId: string,
    type: string,
    payloadMatch?: { key: string; value: string | number },
  ): EventRow | undefined {
    for (let index = this.state.events.length - 1; index >= 0; index -= 1) {
      const row = this.state.events[index]
      if (row === undefined || row.ticketId !== ticketId || row.type !== type) continue
      if (payloadMatch !== undefined && row.payload[payloadMatch.key] !== payloadMatch.value) continue
      return cloneRow(row)
    }
    return undefined
  }

  listTicketEvents(_tx: TicketTx, ticketId: string, afterSeq: number, limit: number): EventRow[] {
    return this.state.events
      .filter(row => row.ticketId === ticketId && row.seq > afterSeq)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit)
      .map(cloneRow)
  }

  listProjectEvents(_tx: TicketTx, projectId: string, afterSeq: number, limit: number): EventRow[] {
    return this.state.events
      .filter(row => row.projectId === projectId && row.seq > afterSeq)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit)
      .map(cloneRow)
  }

  listOutbox(_tx: TicketTx, limit: number): OutboxRow[] {
    return this.state.outbox
      .slice()
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit)
      .map(cloneRow)
  }

  getCommandLog(
    _tx: TicketTx,
    principalId: string,
    command: string,
    idempotencyKey: string,
  ): CommandLogRow | undefined {
    const row = this.state.commandLogs.get(logKey(principalId, command, idempotencyKey))
    return row === undefined ? undefined : cloneRow(row)
  }

  insertCommandLog(_tx: TicketTx, row: CommandLogRow): void {
    const key = logKey(row.principalId, row.command, row.idempotencyKey)
    if (this.state.commandLogs.has(key)) {
      throw new IssuesError('VALIDATION_FAILED', 'duplicate command log entry')
    }
    this.state.commandLogs.set(key, cloneRow(row))
  }

  private assertOpen(): void {
    if (this.closed) throw new IssuesError('STORAGE_UNAVAILABLE', 'storage is closed')
  }
}

function logKey(principalId: string, command: string, idempotencyKey: string): string {
  return `${principalId}\u0000${command}\u0000${idempotencyKey}`
}

/** Shared event hash formula used by both adapters (Part 2b §8.3). */
export function hashEvent(event: NewEvent, prevHash: string): string {
  const envelope = {
    id: event.id,
    projectId: event.projectId,
    ticketId: event.ticketId,
    chainKey: event.chainKey,
    type: event.type,
    actorId: event.actorId,
    actorKind: event.actorKind,
    occurredAt: event.occurredAt,
    revisionBefore: event.revisionBefore,
    revisionAfter: event.revisionAfter,
    fromStateCode: event.fromStateCode,
    toStateCode: event.toStateCode,
    payload: event.payload,
  }
  return sha256Hex(`${canonicalJson(envelope)}|${prevHash}`)
}

export function createMemoryStore(): MemoryIssuesStore {
  return new MemoryIssuesStore()
}
