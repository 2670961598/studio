import type { IssuesErrorCode } from './errors.ts'

/**
 * Public DTOs and command inputs. Nothing in this module names a storage engine,
 * SQL, table names or a driver: the boundary is engine-neutral (Part 2d §7.7.1/§7.7.2).
 */

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export type PrincipalKind = 'human' | 'agent'
export type ActorKind = PrincipalKind | 'daemon'
export type PrincipalStatus = 'active' | 'paused' | 'retired'
export type Role = 'PLANNER' | 'DEVELOPER' | 'TESTER'
export type TicketKind = 'task' | 'bug' | 'chore'
export type EvidenceKind = 'summary' | 'report' | 'patch' | 'trace'
export type EvidenceProducer = 'daemon' | 'human' | 'agent'
export type TransitionRuleId =
  | 'T1'
  | 'T2'
  | 'T3'
  | 'T4'
  | 'T5'
  | 'T6'
  | 'T7'
  | 'T8'
  | 'T9'
  | 'T10'
  | 'T11'
  | 'T12'
  | 'T13'
  | 'T14'

export type ActionName =
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  | 'transition'
  | 'comment'
  | 'assign'
  | 'reassign'
  | 'reparent'
  | 'governance'
  | 'close'
  | 'reopen'
  | 'policy:write'

/** Seeded state catalog entry (codes are stable; never renumber). */
export interface StateInfo {
  code: number
  name: string
  displayOrder: number
  terminal: boolean
  ready: boolean
}

export interface ProjectPolicy {
  wipLimitPerWorker: number
  wipLimitPerProject: number
  evidenceRequired: 'none' | 'summary'
  reopenPrincipals: readonly string[]
}

export interface Principal {
  id: string
  kind: PrincipalKind
  displayName: string
  status: PrincipalStatus
  createdAt: number
}

export interface Project {
  id: string
  keyPrefix: string
  name: string
  policy: ProjectPolicy
  policyGeneration: number
  createdAt: number
}

export interface Ticket {
  id: string
  projectId: string
  key: string
  title: string
  body: string
  kind: TicketKind
  priority: number
  stateCode: number
  state: StateInfo
  assigneeId: string | null
  reviewerId: string | null
  requiresHuman: boolean
  parentId: string | null
  createdBy: string
  revision: number
  labels: readonly string[]
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

/** Detail view: the projection plus the caller's allowed actions/transition targets. */
export interface TicketView extends Ticket {
  allowedActions: readonly ActionName[]
  allowedTransitions: readonly number[]
}

export interface TicketSummary {
  id: string
  projectId: string
  key: string
  title: string
  kind: TicketKind
  priority: number
  stateCode: number
  state: StateInfo
  assigneeId: string | null
  reviewerId: string | null
  requiresHuman: boolean
  parentId: string | null
  revision: number
  labels: readonly string[]
  lastActivityAt: number
  updatedAt: number
  doneAt: number | null
  archivedAt: number | null
}

export interface Comment {
  id: string
  ticketId: string
  authorId: string
  body: string
  replyToCommentId: string | null
  createdAt: number
}

export interface EventActor {
  id: string
  kind: ActorKind
}

export interface EventEnvelope {
  seq: number
  id: string
  projectId: string
  ticketId: string | null
  chainKey: string
  type: string
  actor: EventActor
  occurredAt: number
  revisionBefore: number
  revisionAfter: number
  fromStateCode: number | null
  toStateCode: number | null
  payload: JsonObject
  prevHash: string
  entryHash: string
  idempotencyKey: string | null
}

export interface Page<T> {
  items: T[]
  /** Opaque, versioned, binding-checked token; `null` when the stream is exhausted. */
  nextCursor: string | null
}

export interface TransitionResult {
  ticket: Ticket
  event: EventEnvelope
  ruleId: TransitionRuleId
}

export interface ReopenResult {
  ticket: Ticket
  event: EventEnvelope
  ruleId: 'T15' | 'T16'
}

export interface CloseResult {
  ticket: Ticket
  event: EventEnvelope
}

export interface ArchiveResult {
  ticket: Ticket
  event: EventEnvelope | null
}

export interface Evidence {
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

export interface GateRequirements {
  completed: boolean
  output: boolean
  report: boolean
}

export interface GateRun {
  id: string
  ticketId: string
  /** Gate epoch: the revision the ticket held when the verdict was harvested. */
  ticketRevision: number
  producedAt: number
  gateExit: 0 | 1
  requirements: GateRequirements
  coveredEvidenceIds: readonly string[]
  recordSha256: string
  createdBy: string
  createdAt: number
}

export interface DescendantNode {
  ticket: TicketSummary
  depth: number
}

export interface BatchItemError {
  code: IssuesErrorCode
  message: string
  details: JsonObject | null
  httpStatus: number
  retryable: boolean
}

export interface BatchItemResult<T> {
  index: number
  status: number
  result: T | null
  error: BatchItemError | null
}

/** Batch envelope; the HTTP mirror answers with 200 for independent batches. */
export interface BatchResult<T> {
  items: BatchItemResult<T>[]
}

export interface GetTicketsResult {
  items: Ticket[]
  /** Ids absent from the result for any reason; advisory, authorized callers only. */
  missing: string[]
}

export interface GetCommentsResult {
  items: Comment[]
  missing: string[]
}

export interface AddCommentResult {
  comment: Comment
  event: EventEnvelope
}

/* ------------------------------------------------------------------ */
/* Host bootstrap inputs (not client commands; no idempotency key)     */
/* ------------------------------------------------------------------ */

export interface CreatePrincipalInput {
  kind: PrincipalKind
  displayName: string
}

export interface CreateProjectInput {
  keyPrefix: string
  name: string
  policy?: Partial<ProjectPolicy>
}

/* ------------------------------------------------------------------ */
/* Command inputs                                                      */
/* ------------------------------------------------------------------ */

export interface GrantMembershipInput {
  projectId: string
  principalId: string
  roles: readonly Role[]
  reason: string
  idempotencyKey: string
}

export interface MembershipView {
  projectId: string
  principalId: string
  roles: readonly Role[]
}

export interface CreateTicketInput {
  projectId: string
  title: string
  body?: string
  kind?: TicketKind
  priority?: number
  labels?: readonly string[]
  parentId?: string | null
  requiresHuman?: boolean
  expectedPolicyGeneration?: number
  idempotencyKey: string
}

export interface GetTicketInput {
  projectId: string
  idOrKey: string
}

export interface ListTicketsInput {
  projectId: string
  stateCodes?: readonly number[]
  assigneeId?: string
  reviewerId?: string
  kind?: TicketKind
  priority?: number
  label?: string
  includeArchived?: boolean
  cursor?: string
  limit?: number
}

export interface AssignInput {
  projectId: string
  ticketId: string
  assigneeId?: string | null
  reviewerId?: string | null
  expectedRevision: number
  idempotencyKey: string
}

export interface ReassignInput {
  projectId: string
  ticketId: string
  assigneeId?: string | null
  reviewerId?: string | null
  reason: string
  expectedRevision: number
  idempotencyKey: string
}

export interface GovernanceInput {
  projectId: string
  ticketId: string
  newValue: 0 | 1
  reason: string
  expectedRevision: number
  idempotencyKey: string
}

export interface UpdateTicketInput {
  projectId: string
  ticketId: string
  title?: string
  body?: string
  kind?: TicketKind
  priority?: number
  labels?: readonly string[]
  expectedRevision: number
  idempotencyKey: string
}

export interface TransitionInput {
  projectId: string
  ticketId: string
  targetStateCode: number
  expectedRevision: number
  reason?: string
  idempotencyKey: string
}

export interface ReopenInput {
  projectId: string
  ticketId: string
  targetStateCode?: number
  assigneeId?: string | null
  reviewerId?: string | null
  reason: string
  expectedRevision: number
  idempotencyKey: string
}

export interface CloseInput {
  projectId: string
  ticketId: string
  reason: string
  expectedRevision: number
  idempotencyKey: string
}

export interface ArchiveInput {
  projectId: string
  ticketId: string
  reason?: string
  expectedRevision: number
  idempotencyKey: string
}

export interface AddCommentInput {
  projectId: string
  ticketId: string
  body: string
  replyToCommentId?: string
  idempotencyKey: string
}

export interface ReparentInput {
  projectId: string
  ticketId: string
  newParentId: string | null
  reason: string
  expectedRevision: number
  idempotencyKey: string
}

export interface AddEvidenceInput {
  projectId: string
  ticketId: string
  kind: EvidenceKind
  uri: string
  expectedRevision?: number
  idempotencyKey: string
}

export interface RecordGateEvidenceInput {
  projectId: string
  ticketId: string
  /** Harvest revision (gate epoch); defaults to the ticket's current revision. */
  ticketRevision?: number
  producedAt?: number
  gateExit: 0 | 1
  requirements: GateRequirements
  coveredEvidenceIds: readonly string[]
  uri: string
  recordSha256?: string
  idempotencyKey?: string
}

export interface RecordGateEvidenceResult {
  gateRun: GateRun
  evidence: Evidence
  event: EventEnvelope
}

export interface ListCommentsInput {
  projectId: string
  ticketId: string
  cursor?: string
  limit?: number
}

export interface ListEventsInput {
  projectId: string
  ticketId: string
  cursor?: string
  limit?: number
}

export interface ListProjectEventsInput {
  projectId: string
  cursor?: string
  limit?: number
}

export interface ListChildrenInput {
  projectId: string
  ticketId: string
}

export interface ListDescendantsInput {
  projectId: string
  ticketId: string
}

export interface GetGateRunInput {
  projectId: string
  gateRunId: string
}

export interface ListEvidenceInput {
  projectId: string
  ticketId: string
}

export interface UpdatePolicyInput {
  projectId: string
  expectedGeneration: number
  policy: Partial<ProjectPolicy>
  reason: string
  idempotencyKey: string
}

export interface GetTicketsInput {
  projectId: string
  ids: readonly string[]
}

export interface GetCommentsInput {
  projectId: string
  ids: readonly string[]
}

export interface BatchAddCommentsInput {
  projectId: string
  items: readonly BatchAddCommentItem[]
  /** All-or-nothing; only legal when every item targets one ticket (one aggregate). */
  atomic?: boolean
}

export interface BatchAddCommentItem {
  ticketId: string
  body: string
  replyToCommentId?: string
  idempotencyKey: string
}

export interface BatchTransitionTicketsInput {
  projectId: string
  items: readonly BatchTransitionItem[]
  atomic?: boolean
}

export interface BatchTransitionItem {
  ticketId: string
  targetStateCode: number
  expectedRevision: number
  reason?: string
  idempotencyKey: string
}

/* ------------------------------------------------------------------ */
/* Service construction                                                */
/* ------------------------------------------------------------------ */

export interface IssuesOptions {
  /** Injected clock (epoch ms); deterministic tests pin it. */
  now?: () => number
  /** Id factory; `prefix` is a short domain tag such as `tkt`/`evt`. */
  newId?: (prefix: string) => string
  /** HMAC key for opaque cursors; a random per-instance key is the default. */
  cursorKey?: string | Uint8Array
  /** Filesystem root that evidence URIs are confined to. Evidence APIs fail closed without it. */
  evidenceRoot?: string
  /** Base project policy; per-project values are merged on top. */
  defaultPolicy?: Partial<ProjectPolicy>
}

export interface IssuesPlatform {
  service: TicketServiceApi
  daemon: DaemonPort
  close(): void
}

/** The public service surface; implemented by the TicketService class. */
export interface TicketServiceApi {
  createPrincipal(input: CreatePrincipalInput): Promise<Principal>
  createProject(actorId: string, input: CreateProjectInput): Promise<Project>
  grantMembership(actorId: string, input: GrantMembershipInput): Promise<MembershipView>
  getProject(actorId: string, projectId: string): Promise<Project>
  updatePolicy(actorId: string, input: UpdatePolicyInput): Promise<Project>

  createTicket(actorId: string, input: CreateTicketInput): Promise<Ticket>
  getTicket(actorId: string, input: GetTicketInput): Promise<TicketView>
  listTickets(actorId: string, input: ListTicketsInput): Promise<Page<TicketSummary>>
  updateTicket(actorId: string, input: UpdateTicketInput): Promise<Ticket>
  assign(actorId: string, input: AssignInput): Promise<Ticket>
  reassign(actorId: string, input: ReassignInput): Promise<Ticket>
  governance(actorId: string, input: GovernanceInput): Promise<Ticket>
  transition(actorId: string, input: TransitionInput): Promise<TransitionResult>
  reopen(actorId: string, input: ReopenInput): Promise<ReopenResult>
  close(actorId: string, input: CloseInput): Promise<CloseResult>
  archive(actorId: string, input: ArchiveInput): Promise<ArchiveResult>

  addComment(actorId: string, input: AddCommentInput): Promise<AddCommentResult>
  listComments(actorId: string, input: ListCommentsInput): Promise<Page<Comment>>
  reparent(actorId: string, input: ReparentInput): Promise<Ticket>
  listChildren(actorId: string, input: ListChildrenInput): Promise<TicketSummary[]>
  listDescendants(actorId: string, input: ListDescendantsInput): Promise<DescendantNode[]>

  addEvidence(actorId: string, input: AddEvidenceInput): Promise<Evidence>
  listEvidence(actorId: string, input: ListEvidenceInput): Promise<Evidence[]>
  getGateRun(actorId: string, input: GetGateRunInput): Promise<GateRun | null>

  listEvents(actorId: string, input: ListEventsInput): Promise<Page<EventEnvelope>>
  listProjectEvents(actorId: string, input: ListProjectEventsInput): Promise<Page<EventEnvelope>>

  getTickets(actorId: string, input: GetTicketsInput): Promise<GetTicketsResult>
  getComments(actorId: string, input: GetCommentsInput): Promise<GetCommentsResult>
  batchAddComments(actorId: string, input: BatchAddCommentsInput): Promise<BatchResult<Comment>>
  batchTransitionTickets(
    actorId: string,
    input: BatchTransitionTicketsInput,
  ): Promise<BatchResult<TransitionResult>>
}

/**
 * Daemon-only port for harvest verdicts. It is returned separately from the
 * host factory and is deliberately absent from `TicketServiceApi`: an executor
 * cannot self-report a verdict through the public service surface.
 */
export interface DaemonPort {
  recordGateEvidence(input: RecordGateEvidenceInput): Promise<RecordGateEvidenceResult>
}
