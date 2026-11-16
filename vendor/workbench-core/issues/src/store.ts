import type {
  ActorKind,
  EvidenceKind,
  EvidenceProducer,
  JsonObject,
  PrincipalStatus,
  Role,
  TicketKind,
} from './types.ts'

/**
 * Internal storage port (Part 2d §7.7.6). This module is never re-exported from
 * the package entry point: the public boundary sees DTOs only. The memory and
 * SQLite adapters implement this interface identically and pass the same
 * contract suite; no SQL or driver type appears here.
 */

declare const ticketTxBrand: unique symbol

/** Opaque transaction capability handed to a closure only. */
export interface TicketTx {
  readonly [ticketTxBrand]: true
}

export interface PrincipalRow {
  id: string
  kind: ActorKind
  displayName: string
  status: PrincipalStatus
  createdAt: number
}

export interface ProjectRow {
  id: string
  keyPrefix: string
  name: string
  nextTicketSeq: number
  policyJson: string
  policyGeneration: number
  createdAt: number
  archivedAt: number | null
}

export interface MembershipRow {
  projectId: string
  principalId: string
  role: Role
  addedBy: string
  addedAt: number
}

export interface TicketRow {
  id: string
  projectId: string
  key: string
  title: string
  body: string
  kind: TicketKind
  priority: number
  stateCode: number
  assigneeId: string | null
  reviewerId: string | null
  requiresHuman: number
  parentId: string | null
  createdBy: string
  revision: number
  blockReason: string | null
  resumeStateCode: number | null
  policyGeneration: number
  reworkCount: number
  reopenCount: number
  lastReopenedAt: number | null
  lastReopenReason: string | null
  createdAt: number
  updatedAt: number
  lastActivityAt: number
  doneAt: number | null
  archivedAt: number | null
}

/** CAS patch: optional projection fields plus the mandatory audit timestamps. */
export interface TicketPatch {
  title?: string
  body?: string
  kind?: TicketKind
  priority?: number
  stateCode?: number
  assigneeId?: string | null
  reviewerId?: string | null
  requiresHuman?: number
  parentId?: string | null
  blockReason?: string | null
  resumeStateCode?: number | null
  reworkCount?: number
  reopenCount?: number
  lastReopenedAt?: number | null
  lastReopenReason?: string | null
  doneAt?: number | null
  archivedAt?: number | null
  policyGeneration?: number
  updatedAt: number
  lastActivityAt: number
}

export interface CommentRow {
  seq: number
  id: string
  ticketId: string
  authorId: string
  body: string
  replyToCommentId: string | null
  createdAt: number
}

export interface NewCommentRow {
  id: string
  ticketId: string
  authorId: string
  body: string
  replyToCommentId: string | null
  createdAt: number
}

export interface EvidenceRow {
  id: string
  ticketId: string
  ticketRevision: number
  kind: EvidenceKind | 'gate'
  uri: string
  sha256: string
  bytes: number | null
  producer: EvidenceProducer
  gateRunId: string | null
  createdBy: string
  createdAt: number
}

export interface GateRunRow {
  id: string
  ticketId: string
  ticketRevision: number
  producedAt: number
  gateExit: number
  reqCompleted: number
  reqOutput: number
  reqReport: number
  coveredEvidenceIds: string[]
  recordSha256: string
  createdBy: string
  createdAt: number
}

export interface EventRow {
  seq: number
  id: string
  projectId: string
  ticketId: string | null
  chainKey: string
  type: string
  actorId: string
  actorKind: ActorKind
  occurredAt: number
  revisionBefore: number
  revisionAfter: number
  fromStateCode: number | null
  toStateCode: number | null
  payload: JsonObject
  prevHash: string
  entryHash: string
  idempotencyKey: string | null
  createdAt: number
}

/** An event to append; the adapter assigns seq / prevHash / entryHash / id. */
export interface NewEvent {
  id: string
  projectId: string
  ticketId: string | null
  chainKey: string
  type: string
  actorId: string
  actorKind: ActorKind
  occurredAt: number
  revisionBefore: number
  revisionAfter: number
  fromStateCode: number | null
  toStateCode: number | null
  payload: JsonObject
  idempotencyKey: string | null
  /** Outbox topic written in the same transaction (one row per event). */
  outboxTopic: string
}

export interface OutboxRow {
  seq: number
  eventId: string
  topic: string
  payloadJson: string
  status: 'pending' | 'delivered' | 'failed'
  attempts: number
  nextAttemptAt: number
  createdAt: number
  deliveredAt: number | null
}

export interface CommandLogRow {
  principalId: string
  command: string
  idempotencyKey: string
  requestHash: string
  responseJson: string
  createdAt: number
}

export interface TicketFilterRow {
  stateCodes?: readonly number[]
  assigneeId?: string
  reviewerId?: string
  kind?: TicketKind
  priority?: number
  label?: string
  includeArchived?: boolean
}

export interface TicketListPos {
  updatedAt: number
  id: string
}

export interface CountTicketsFilterRow {
  stateCodes?: readonly number[]
  assigneeId?: string
}

export interface AllocatedKey {
  seq: number
  key: string
}

export interface DescendantRow {
  id: string
  depth: number
}

/** The only persistence contract the domain sees. */
export interface TicketStore {
  /** One-time host bootstrap: ensure the internal daemon principal exists. */
  bootstrap(now: number): void
  close(): void
  transaction<T>(fn: (tx: TicketTx) => T): T

  insertPrincipal(tx: TicketTx, row: PrincipalRow): void
  getPrincipal(tx: TicketTx, id: string): PrincipalRow | undefined
  listPrincipals(tx: TicketTx): PrincipalRow[]

  insertProject(tx: TicketTx, row: ProjectRow): void
  getProject(tx: TicketTx, id: string): ProjectRow | undefined
  /** CAS on policy generation; returns false on a stale generation. */
  updateProjectPolicy(
    tx: TicketTx,
    projectId: string,
    expectedGeneration: number,
    policyJson: string,
    now: number,
  ): boolean
  allocateTicketKey(tx: TicketTx, projectId: string, now: number): AllocatedKey

  insertMembership(tx: TicketTx, row: MembershipRow): void
  getMembershipRoles(tx: TicketTx, projectId: string, principalId: string): Role[]
  listMemberships(tx: TicketTx, projectId: string): MembershipRow[]

  insertTicket(tx: TicketTx, row: TicketRow): void
  getTicket(tx: TicketTx, projectId: string, id: string): TicketRow | undefined
  getTicketByIdOrKey(tx: TicketTx, projectId: string, idOrKey: string): TicketRow | undefined
  /** Project id of a ticket regardless of caller scope (cross-project parent check). */
  getTicketProject(tx: TicketTx, ticketId: string): string | undefined
  /** Batch read; adapters use chunked `IN` queries internally, never N+1. */
  getTicketsByIds(tx: TicketTx, projectId: string, ids: readonly string[]): TicketRow[]
  /** CAS update; returns undefined when the expected revision does not match. */
  updateTicketCas(
    tx: TicketTx,
    id: string,
    expectedRevision: number,
    patch: TicketPatch,
  ): TicketRow | undefined
  queryTickets(
    tx: TicketTx,
    projectId: string,
    filter: TicketFilterRow,
    pos: TicketListPos | null,
    limit: number,
  ): TicketRow[]
  countTickets(tx: TicketTx, projectId: string, filter: CountTicketsFilterRow): number
  listChildren(tx: TicketTx, projectId: string, parentId: string): TicketRow[]
  /** Ancestor ids nearest-first; bounded by the depth invariant. */
  listAncestorIds(tx: TicketTx, ticketId: string): string[]
  /** Height of the subtree rooted at `ticketId` (0 when it has no children). */
  maxSubtreeDepth(tx: TicketTx, ticketId: string): number
  listDescendants(tx: TicketTx, ticketId: string): DescendantRow[]

  setLabels(tx: TicketTx, ticketId: string, labels: readonly string[]): void
  getLabels(tx: TicketTx, ticketId: string): string[]
  getLabelsForTickets(tx: TicketTx, ticketIds: readonly string[]): Map<string, string[]>

  insertComment(tx: TicketTx, row: NewCommentRow): CommentRow
  getComment(tx: TicketTx, commentId: string): CommentRow | undefined
  /** Batch read scoped to one project (comments join tickets); no N+1. */
  getCommentsByIds(
    tx: TicketTx,
    projectId: string,
    ids: readonly string[],
  ): CommentRow[]
  listComments(tx: TicketTx, ticketId: string, afterSeq: number, limit: number): CommentRow[]

  insertEvidence(tx: TicketTx, row: EvidenceRow): void
  getEvidence(tx: TicketTx, evidenceId: string): EvidenceRow | undefined
  getEvidenceByIds(tx: TicketTx, ids: readonly string[]): EvidenceRow[]
  listEvidence(tx: TicketTx, ticketId: string): EvidenceRow[]

  insertGateRun(tx: TicketTx, row: GateRunRow): void
  getGateRun(tx: TicketTx, gateRunId: string): GateRunRow | undefined
  listGateRuns(tx: TicketTx, ticketId: string): GateRunRow[]

  appendEvents(tx: TicketTx, events: readonly NewEvent[], now: number): EventRow[]
  getLastTicketEvent(
    tx: TicketTx,
    ticketId: string,
    type: string,
    payloadMatch?: { key: string; value: string | number },
  ): EventRow | undefined
  listTicketEvents(tx: TicketTx, ticketId: string, afterSeq: number, limit: number): EventRow[]
  listProjectEvents(tx: TicketTx, projectId: string, afterSeq: number, limit: number): EventRow[]
  listOutbox(tx: TicketTx, limit: number): OutboxRow[]

  getCommandLog(
    tx: TicketTx,
    principalId: string,
    command: string,
    idempotencyKey: string,
  ): CommandLogRow | undefined
  insertCommandLog(tx: TicketTx, row: CommandLogRow): void
}
