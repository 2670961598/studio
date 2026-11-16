import type {
  ActionName,
  BatchItemError,
  Comment,
  EventEnvelope,
  Evidence,
  GateRun,
  JsonObject,
  JsonValue,
  Page,
  Project,
  ProjectPolicy,
  Role,
  Ticket,
  TicketSummary,
  TicketView,
} from './types.ts'
import type {
  CommentRow,
  EventRow,
  EvidenceRow,
  GateRunRow,
  NewEvent,
  PrincipalRow,
  ProjectRow,
  TicketRow,
  TicketStore,
  TicketTx,
} from './store.ts'
import { IssuesError } from './errors.ts'
import {
  DAEMON_PRINCIPAL_ID,
  DEFAULT_READ_LIMIT,
  MAX_READ_LIMIT,
  TEST_IN_PROGRESS,
  TESTING,
  allowedTransitionTargets,
  grantedByRole,
  isTerminalState,
  stateInfo,
} from './catalog.ts'
import type { ActorRelation } from './catalog.ts'
import { CursorCodec } from './cursor.ts'
import {
  assertActorHandle,
  assertNonEmptyString,
  canonicalJson,
  defaultNewId,
  hashJson,
  policyHashOf,
} from './util.ts'

const DEFAULT_POLICY: ProjectPolicy = {
  wipLimitPerWorker: 8,
  wipLimitPerProject: 200,
  evidenceRequired: 'summary',
  reopenPrincipals: [],
}

export interface ServiceCoreOptions {
  now?: () => number
  newId?: (prefix: string) => string
  cursorKey?: string | Uint8Array
  evidenceRoot?: string
  defaultPolicy?: Partial<ProjectPolicy>
}

/** Shared service context: store, clock, ids, authz, DTO mapping, event append. */
export class ServiceCore {
  readonly store: TicketStore
  readonly now: () => number
  readonly newIdFor: (prefix: string) => string
  readonly cursor: CursorCodec
  readonly evidenceRoot: string | null
  readonly defaultPolicy: ProjectPolicy
  readonly daemonPrincipalId: string

  constructor(store: TicketStore, options: ServiceCoreOptions = {}) {
    this.store = store
    this.now = options.now ?? Date.now
    this.newIdFor = options.newId ?? defaultNewId
    this.cursor = new CursorCodec(options.cursorKey)
    this.evidenceRoot = options.evidenceRoot ?? null
    this.defaultPolicy = { ...DEFAULT_POLICY, ...options.defaultPolicy }
    this.daemonPrincipalId = DAEMON_PRINCIPAL_ID
    this.store.bootstrap(this.now())
  }

  /* ---------------------------------------------------------------- */
  /* Actor / project / membership                                      */
  /* ---------------------------------------------------------------- */

  resolveActor(actorId: unknown): PrincipalRow {
    const id = assertActorHandle(actorId)
    const principal = this.store.transaction(tx => this.store.getPrincipal(tx, id))
    if (principal === undefined) {
      throw new IssuesError('PRINCIPAL_NOT_ALLOWED', 'unknown principal handle', { actorId: id })
    }
    if (principal.status !== 'active') {
      throw new IssuesError('PRINCIPAL_NOT_ALLOWED', 'principal is not active', {
        actorId: id,
        status: principal.status,
      })
    }
    return principal
  }

  requireProject(tx: TicketTx, projectId: string): ProjectRow {
    const project = this.store.getProject(tx, projectId)
    if (project === undefined || project.archivedAt !== null) {
      throw new IssuesError('PROJECT_NOT_FOUND', 'project not found')
    }
    return project
  }

  requireMembership(
    tx: TicketTx,
    projectId: string,
    principalId: string,
  ): { project: ProjectRow; roles: Role[] } {
    const project = this.requireProject(tx, projectId)
    const roles = this.store.getMembershipRoles(tx, projectId, principalId)
    if (roles.length === 0) {
      throw new IssuesError('PROJECT_FORBIDDEN', 'principal is not a project member', {
        projectId,
      })
    }
    return { project, roles }
  }

  requireRole(roles: readonly Role[], role: Role, action: string): void {
    if (!roles.includes(role)) {
      throw new IssuesError('PRINCIPAL_NOT_ALLOWED', `action requires ${role}`, {
        action,
        requiredRole: role,
      })
    }
  }

  /* ---------------------------------------------------------------- */
  /* Policy                                                            */
  /* ---------------------------------------------------------------- */

  projectPolicy(project: ProjectRow): ProjectPolicy {
    return decodePolicy(project.policyJson, this.defaultPolicy)
  }

  resolvePolicy(partial: Partial<ProjectPolicy> | undefined, base?: ProjectPolicy): ProjectPolicy {
    const merged: ProjectPolicy = {
      wipLimitPerWorker: partial?.wipLimitPerWorker ?? base?.wipLimitPerWorker ?? this.defaultPolicy.wipLimitPerWorker,
      wipLimitPerProject: partial?.wipLimitPerProject ?? base?.wipLimitPerProject ?? this.defaultPolicy.wipLimitPerProject,
      evidenceRequired: partial?.evidenceRequired ?? base?.evidenceRequired ?? this.defaultPolicy.evidenceRequired,
      reopenPrincipals: [...(partial?.reopenPrincipals ?? base?.reopenPrincipals ?? this.defaultPolicy.reopenPrincipals)],
    }
    validatePolicy(merged)
    return merged
  }

  policyHash(policy: ProjectPolicy): string {
    return policyHashOf(policy)
  }

  /* ---------------------------------------------------------------- */
  /* Tickets and DTO mapping                                           */
  /* ---------------------------------------------------------------- */

  loadTicket(tx: TicketTx, projectId: string, idOrKey: string): TicketRow {
    assertNonEmptyString(idOrKey, 'ticketId')
    const ticket = this.store.getTicketByIdOrKey(tx, projectId, idOrKey)
    if (ticket === undefined) {
      throw new IssuesError('TICKET_NOT_FOUND', 'ticket not found')
    }
    return ticket
  }

  loadTicketById(tx: TicketTx, projectId: string, ticketId: string): TicketRow {
    assertNonEmptyString(ticketId, 'ticketId')
    const ticket = this.store.getTicket(tx, projectId, ticketId)
    if (ticket === undefined) throw new IssuesError('TICKET_NOT_FOUND', 'ticket not found')
    return ticket
  }

  labelsMap(tx: TicketTx, rows: readonly TicketRow[]): Map<string, string[]> {
    return this.store.getLabelsForTickets(
      tx,
      rows.map(row => row.id),
    )
  }

  ticketDto(row: TicketRow, labels: readonly string[]): Ticket {
    return {
      id: row.id,
      projectId: row.projectId,
      key: row.key,
      title: row.title,
      body: row.body,
      kind: row.kind,
      priority: row.priority,
      stateCode: row.stateCode,
      state: stateInfo(row.stateCode),
      assigneeId: row.assigneeId,
      reviewerId: row.reviewerId,
      requiresHuman: row.requiresHuman === 1,
      parentId: row.parentId,
      createdBy: row.createdBy,
      revision: row.revision,
      labels: [...labels],
      blockReason: row.blockReason,
      resumeStateCode: row.resumeStateCode,
      policyGeneration: row.policyGeneration,
      reworkCount: row.reworkCount,
      reopenCount: row.reopenCount,
      lastReopenedAt: row.lastReopenedAt,
      lastReopenReason: row.lastReopenReason,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastActivityAt: row.lastActivityAt,
      doneAt: row.doneAt,
      archivedAt: row.archivedAt,
    }
  }

  ticketWithLabels(tx: TicketTx, row: TicketRow): Ticket {
    return this.ticketDto(row, this.store.getLabels(tx, row.id))
  }

  summaryDto(row: TicketRow, labels: readonly string[]): TicketSummary {
    return {
      id: row.id,
      projectId: row.projectId,
      key: row.key,
      title: row.title,
      kind: row.kind,
      priority: row.priority,
      stateCode: row.stateCode,
      state: stateInfo(row.stateCode),
      assigneeId: row.assigneeId,
      reviewerId: row.reviewerId,
      requiresHuman: row.requiresHuman === 1,
      parentId: row.parentId,
      revision: row.revision,
      labels: [...labels],
      lastActivityAt: row.lastActivityAt,
      updatedAt: row.updatedAt,
      doneAt: row.doneAt,
      archivedAt: row.archivedAt,
    }
  }

  relationOf(row: TicketRow, actorId: string): ActorRelation {
    return {
      isAssignee: row.assigneeId !== null && row.assigneeId === actorId,
      isReviewer: row.reviewerId !== null && row.reviewerId === actorId,
    }
  }

  viewFor(
    _tx: TicketTx,
    row: TicketRow,
    labels: readonly string[],
    actor: PrincipalRow,
    roles: readonly Role[],
    policy: ProjectPolicy,
  ): TicketView {
    return {
      ...this.ticketDto(row, labels),
      allowedActions: this.allowedActions(row, actor, roles, policy),
      allowedTransitions: this.allowedTransitionsFor(row, actor, roles),
    }
  }

  allowedActions(
    row: TicketRow,
    actor: PrincipalRow,
    roles: readonly Role[],
    policy: ProjectPolicy,
  ): ActionName[] {
    const relation = this.relationOf(row, actor.id)
    const terminal = isTerminalState(row.stateCode)
    const archived = row.archivedAt !== null
    const actions: ActionName[] = ['read', 'comment', 'create']
    if (archived) return actions

    const transitions = this.allowedTransitionsFor(row, actor, roles)
    if (transitions.length > 0) actions.push('transition')

    const preTesting = row.stateCode !== TESTING && row.stateCode !== TEST_IN_PROGRESS
    const canUpdate =
      (!terminal && roles.includes('PLANNER')) ||
      (relation.isAssignee && roles.includes('DEVELOPER') && row.stateCode < TESTING) ||
      (relation.isReviewer && roles.includes('TESTER') && row.stateCode < TEST_IN_PROGRESS)
    if (canUpdate) actions.push('update')

    if (roles.includes('PLANNER') && preTesting) actions.push('assign')
    if (roles.includes('PLANNER') && this.canReassignState(row)) actions.push('reassign')
    if (roles.includes('PLANNER')) actions.push('reparent')
    if (roles.includes('PLANNER') && actor.kind === 'human') actions.push('governance', 'policy:write')
    if (!terminal && (roles.includes('PLANNER') || actor.kind === 'human')) actions.push('close')
    if (roles.includes('PLANNER') && terminal) actions.push('delete')
    if (this.canReopen(row, actor, roles, policy) && !relation.isAssignee && !relation.isReviewer) {
      actions.push('reopen')
    }
    return actions.filter(action => grantedByRole(action, roles))
  }

  allowedTransitionsFor(
    row: TicketRow,
    actor: PrincipalRow,
    roles: readonly Role[],
  ): number[] {
    if (isTerminalState(row.stateCode) || row.archivedAt !== null) return []
    return allowedTransitionTargets(
      row.stateCode,
      row.resumeStateCode,
      roles,
      this.relationOf(row, actor.id),
    )
  }

  canReassignState(row: TicketRow): boolean {
    if (row.stateCode === TESTING || row.stateCode === TEST_IN_PROGRESS) return true
    return (
      row.stateCode === 7 &&
      (row.resumeStateCode === TESTING || row.resumeStateCode === TEST_IN_PROGRESS)
    )
  }

  canReopen(
    row: TicketRow,
    actor: PrincipalRow,
    roles: readonly Role[],
    policy: ProjectPolicy,
  ): boolean {
    if (!isTerminalState(row.stateCode)) return false
    const hasGrant =
      roles.includes('PLANNER') ||
      (actor.kind === 'human' && policy.reopenPrincipals.includes(actor.id))
    return hasGrant
  }

  /* ---------------------------------------------------------------- */
  /* Comments / events / evidence DTOs                                 */
  /* ---------------------------------------------------------------- */

  commentDto(row: CommentRow): Comment {
    return {
      id: row.id,
      ticketId: row.ticketId,
      authorId: row.authorId,
      body: row.body,
      replyToCommentId: row.replyToCommentId,
      createdAt: row.createdAt,
    }
  }

  eventDto(row: EventRow): EventEnvelope {
    return {
      seq: row.seq,
      id: row.id,
      projectId: row.projectId,
      ticketId: row.ticketId,
      chainKey: row.chainKey,
      type: row.type,
      actor: { id: row.actorId, kind: row.actorKind },
      occurredAt: row.occurredAt,
      revisionBefore: row.revisionBefore,
      revisionAfter: row.revisionAfter,
      fromStateCode: row.fromStateCode,
      toStateCode: row.toStateCode,
      payload: row.payload,
      prevHash: row.prevHash,
      entryHash: row.entryHash,
      idempotencyKey: row.idempotencyKey,
    }
  }

  evidenceDto(row: EvidenceRow): Evidence {
    return {
      id: row.id,
      ticketId: row.ticketId,
      ticketRevision: row.ticketRevision,
      kind: row.kind,
      uri: row.uri,
      sha256: row.sha256,
      bytes: row.bytes,
      producer: row.producer,
      gateRunId: row.gateRunId,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    }
  }

  gateRunDto(row: GateRunRow): GateRun {
    return {
      id: row.id,
      ticketId: row.ticketId,
      ticketRevision: row.ticketRevision,
      producedAt: row.producedAt,
      gateExit: row.gateExit === 1 ? 1 : 0,
      requirements: {
        completed: row.reqCompleted === 1,
        output: row.reqOutput === 1,
        report: row.reqReport === 1,
      },
      coveredEvidenceIds: [...row.coveredEvidenceIds],
      recordSha256: row.recordSha256,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    }
  }

  projectDto(project: ProjectRow): Project {
    return {
      id: project.id,
      keyPrefix: project.keyPrefix,
      name: project.name,
      policy: this.projectPolicy(project),
      policyGeneration: project.policyGeneration,
      createdAt: project.createdAt,
    }
  }

  /* ---------------------------------------------------------------- */
  /* Transactions, idempotency, events                                 */
  /* ---------------------------------------------------------------- */

  read<T>(fn: (tx: TicketTx) => T): T {
    return this.store.transaction(fn)
  }

  runCommand<T>(
    actor: PrincipalRow,
    command: string,
    idempotencyKey: string,
    requestBody: unknown,
    fn: (tx: TicketTx) => T,
  ): T {
    validateIdempotencyKey(idempotencyKey)
    const requestHash = hashJson({ actorId: actor.id, command, body: requestBody })
    return this.store.transaction(tx => {
      const existing = this.store.getCommandLog(tx, actor.id, command, idempotencyKey)
      if (existing !== undefined) {
        if (existing.requestHash !== requestHash) {
          throw new IssuesError('IDEMPOTENCY_CONFLICT', 'idempotency key reused with a different request', {
            command,
          })
        }
        return JSON.parse(existing.responseJson) as T
      }
      const result = fn(tx)
      this.store.insertCommandLog(tx, {
        principalId: actor.id,
        command,
        idempotencyKey,
        requestHash,
        responseJson: canonicalJson(result),
        createdAt: this.now(),
      })
      return result
    })
  }

  appendEvent(
    tx: TicketTx,
    params: {
      projectId: string
      ticketId: string | null
      type: string
      actor: PrincipalRow
      revisionBefore: number
      revisionAfter: number
      fromStateCode?: number | null
      toStateCode?: number | null
      payload: JsonObject
      idempotencyKey?: string | null
      outboxTopic: string
    },
  ): EventRow {
    const event: NewEvent = {
      id: this.newIdFor('evt'),
      projectId: params.projectId,
      ticketId: params.ticketId,
      chainKey:
        params.ticketId === null ? `project:${params.projectId}` : `ticket:${params.ticketId}`,
      type: params.type,
      actorId: params.actor.id,
      actorKind: params.actor.kind,
      occurredAt: this.now(),
      revisionBefore: params.revisionBefore,
      revisionAfter: params.revisionAfter,
      fromStateCode: params.fromStateCode ?? null,
      toStateCode: params.toStateCode ?? null,
      payload: params.payload,
      idempotencyKey: params.idempotencyKey ?? null,
      outboxTopic: params.outboxTopic,
    }
    const [eventRow] = this.store.appendEvents(tx, [event], this.now())
    if (eventRow === undefined) {
      throw new IssuesError('STORAGE_UNAVAILABLE', 'event append returned no row')
    }
    return eventRow
  }

  /* ---------------------------------------------------------------- */
  /* Conflicts, freeze anchor, attempt scope                           */
  /* ---------------------------------------------------------------- */

  staleRevision(
    _tx: TicketTx,
    row: TicketRow,
    actor: PrincipalRow,
    roles: readonly Role[],
    policy: ProjectPolicy,
  ): never {
    throw new IssuesError('STALE_REVISION', 'expectedRevision is stale', {
      currentRevision: row.revision,
      currentStateCode: row.stateCode,
      allowedTransitions: this.allowedTransitionsFor(row, actor, roles),
      allowedActions: this.allowedActions(row, actor, roles, policy),
    })
  }

  /** Latest `T3` event payload = reviewer freeze baseline (Part 1 §3.3, C4-F1). */
  freezeAnchor(
    tx: TicketTx,
    ticketId: string,
  ): { reviewerId: string | null; freezeRevision: number; occurredAt: number } | null {
    const event = this.store.getLastTicketEvent(tx, ticketId, 'ticket.transitioned', {
      key: 'ruleId',
      value: 'T3',
    })
    if (event === undefined) return null
    const reviewerId = payloadString(event.payload, 'reviewerId')
    const freezeRevision = payloadNumber(event.payload, 'freezeRevision')
    if (reviewerId === undefined || freezeRevision === undefined) return null
    return { reviewerId, freezeRevision, occurredAt: event.occurredAt }
  }

  /**
   * Current attempt lower bound (C3-F3): max(last_reopened_at, latest
   * evidence_invalidated.invalidatedAt) plus the ids that invalidation named.
   */
  attemptScope(
    tx: TicketTx,
    row: TicketRow,
  ): { lowerBound: number; invalidatedIds: Set<string> } {
    let lowerBound = row.lastReopenedAt ?? 0
    let invalidatedIds = new Set<string>()
    const invalidation = this.store.getLastTicketEvent(tx, row.id, 'ticket.evidence_invalidated')
    if (invalidation !== undefined) {
      const invalidatedAt = payloadNumber(invalidation.payload, 'invalidatedAt') ?? 0
      if (invalidatedAt > lowerBound) lowerBound = invalidatedAt
      const ids = invalidation.payload['evidenceIds']
      if (Array.isArray(ids)) {
        invalidatedIds = new Set(ids.filter((id): id is string => typeof id === 'string'))
      }
    }
    return { lowerBound, invalidatedIds }
  }

  /** Non-gate evidence rows inside the current attempt, oldest first. */
  currentAttemptEvidence(tx: TicketTx, row: TicketRow): EvidenceRow[] {
    const { lowerBound, invalidatedIds } = this.attemptScope(tx, row)
    return this.store
      .listEvidence(tx, row.id)
      .filter(evidence => evidence.kind !== 'gate')
      .filter(evidence => evidence.createdAt > lowerBound && !invalidatedIds.has(evidence.id))
  }

  pageNextSeq<T>(
    items: readonly T[],
    limit: number,
    seqOf: (item: T) => number,
    binding: Parameters<CursorCodec['encode']>[0],
  ): string | null {
    if (items.length < limit) return null
    const last = items[items.length - 1]
    if (last === undefined) return null
    return this.cursor.encode(binding, { kind: 'seq', seq: seqOf(last) })
  }

  page<T>(items: T[], nextCursor: string | null): Page<T> {
    return { items, nextCursor }
  }

  limitOf(value: number | undefined, max: number = MAX_READ_LIMIT): number {
    const limit = value ?? DEFAULT_READ_LIMIT
    if (!Number.isInteger(limit) || limit < 1 || limit > max) {
      throw new IssuesError('VALIDATION_FAILED', `limit must be 1..${max}`, { limit, max })
    }
    return limit
  }

  batchItemError(error: unknown): BatchItemError {
    if (error instanceof IssuesError) {
      return {
        code: error.code,
        message: error.message,
        details: toJsonObject(error.details),
        httpStatus: error.httpStatus,
        retryable: error.retryable,
      }
    }
    return {
      code: 'STORAGE_UNAVAILABLE',
      message: 'storage unavailable',
      details: null,
      httpStatus: 503,
      retryable: true,
    }
  }
}

function validateIdempotencyKey(key: string): void {
  assertNonEmptyString(key, 'idempotencyKey', 200)
  if (key.length < 4) {
    throw new IssuesError('VALIDATION_FAILED', 'idempotencyKey is too short', {
      field: 'idempotencyKey',
      minLength: 4,
    })
  }
}

function decodePolicy(json: string, fallback: ProjectPolicy): ProjectPolicy {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new IssuesError('STORAGE_UNAVAILABLE', 'project policy is not decodable')
  }
  const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  const policy: ProjectPolicy = {
    wipLimitPerWorker:
      typeof record['wipLimitPerWorker'] === 'number'
        ? record['wipLimitPerWorker']
        : fallback.wipLimitPerWorker,
    wipLimitPerProject:
      typeof record['wipLimitPerProject'] === 'number'
        ? record['wipLimitPerProject']
        : fallback.wipLimitPerProject,
    evidenceRequired:
      record['evidenceRequired'] === 'none' || record['evidenceRequired'] === 'summary'
        ? record['evidenceRequired']
        : fallback.evidenceRequired,
    reopenPrincipals: Array.isArray(record['reopenPrincipals'])
      ? record['reopenPrincipals'].filter((id): id is string => typeof id === 'string')
      : [...fallback.reopenPrincipals],
  }
  return policy
}

/** Validate and range-check a fully-resolved project policy (Part 1 §4.2). */
export function validatePolicy(policy: ProjectPolicy): void {
  if (!Number.isInteger(policy.wipLimitPerWorker) || policy.wipLimitPerWorker < 1 || policy.wipLimitPerWorker > 8) {
    throw new IssuesError('POLICY_VALUE_OUT_OF_RANGE', 'wipLimitPerWorker must be 1..8', {
      field: 'wipLimitPerWorker',
    })
  }
  if (
    !Number.isInteger(policy.wipLimitPerProject) ||
    policy.wipLimitPerProject < 1 ||
    policy.wipLimitPerProject > 200
  ) {
    throw new IssuesError('POLICY_VALUE_OUT_OF_RANGE', 'wipLimitPerProject must be 1..200', {
      field: 'wipLimitPerProject',
    })
  }
  if (policy.evidenceRequired !== 'none' && policy.evidenceRequired !== 'summary') {
    throw new IssuesError('POLICY_VALUE_OUT_OF_RANGE', 'evidenceRequired must be none|summary', {
      field: 'evidenceRequired',
    })
  }
  if (!Array.isArray(policy.reopenPrincipals)) {
    throw new IssuesError('POLICY_VALUE_OUT_OF_RANGE', 'reopenPrincipals must be an array', {
      field: 'reopenPrincipals',
    })
  }
}

function payloadString(payload: JsonObject, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

function payloadNumber(payload: JsonObject, key: string): number | undefined {
  const value = payload[key]
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

function toJsonObject(details: Readonly<Record<string, unknown>> | undefined): JsonObject | null {
  if (details === undefined) return null
  const result: JsonObject = {}
  for (const [key, value] of Object.entries(details)) {
    if (isJsonValue(value)) result[key] = value
  }
  return result
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true
    case 'number':
      return Number.isFinite(value)
    case 'object':
      if (Array.isArray(value)) return value.every(isJsonValue)
      return Object.values(value as Record<string, unknown>).every(isJsonValue)
    default:
      return false
  }
}
