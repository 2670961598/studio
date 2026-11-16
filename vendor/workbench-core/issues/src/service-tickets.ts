import type {
  ArchiveInput,
  ArchiveResult,
  AssignInput,
  CreateTicketInput,
  GetTicketInput,
  GovernanceInput,
  ListTicketsInput,
  Page,
  ReassignInput,
  Ticket,
  TicketSummary,
  TicketView,
  UpdateTicketInput,
} from './types.ts'
import type { TicketPatch, TicketRow } from './store.ts'
import { IssuesError } from './errors.ts'
import type { ServiceCore } from './core.ts'
import { CursorCodec } from './cursor.ts'
import {
  BLOCKED,
  IN_PROGRESS,
  MAX_PARENT_DEPTH,
  TESTING,
  TEST_IN_PROGRESS,
  isTerminalState,
} from './catalog.ts'
import type { JsonValue } from './types.ts'
import { assertNonEmptyString, assertOptionalString } from './util.ts'
import {
  assertAssignableAssignee,
  assertP0Label,
  assertQualifiedReviewer,
  assertReviewerIndependent,
  requireHuman,
  validateKind,
  validateLabels,
  validatePriority,
  validateReason,
  validateTicketBody,
  validateTitle,
} from './validation.ts'

export async function createTicket(
  core: ServiceCore,
  actorId: string,
  input: CreateTicketInput,
): Promise<Ticket> {
  const actor = core.resolveActor(actorId)
  return core.runCommand(actor, 'createTicket', input.idempotencyKey, input, tx => {
    const { project } = core.requireMembership(tx, input.projectId, actor.id)
    if (
      input.expectedPolicyGeneration !== undefined &&
      input.expectedPolicyGeneration !== project.policyGeneration
    ) {
      throw new IssuesError('STALE_POLICY_GENERATION', 'expectedPolicyGeneration is stale', {
        currentGeneration: project.policyGeneration,
      })
    }
    const title = validateTitle(input.title)
    const body = validateTicketBody(input.body)
    const kind = validateKind(input.kind)
    const priority = validatePriority(input.priority)
    const labels = validateLabels(input.labels)
    assertP0Label(priority, labels)
    if (input.requiresHuman === true) requireHuman(actor, 'requiresHuman')
    const requiresHuman = priority <= 1 || input.requiresHuman === true ? 1 : 0

    let parentId: string | null = null
    if (input.parentId !== undefined && input.parentId !== null) {
      parentId = assertNonEmptyString(input.parentId, 'parentId')
      const parentProject = core.store.getTicketProject(tx, parentId)
      if (parentProject === undefined) {
        throw new IssuesError('PARENT_NOT_FOUND', 'parent ticket not found', { parentId })
      }
      if (parentProject !== project.id) {
        throw new IssuesError('PARENT_NOT_SAME_PROJECT', 'parent must be in the same project', {
          parentId,
        })
      }
      const ancestors = core.store.listAncestorIds(tx, parentId)
      if (ancestors.length + 1 > MAX_PARENT_DEPTH) {
        throw new IssuesError('PARENT_DEPTH_EXCEEDED', 'resulting depth exceeds 3', {
          parentId,
          depth: ancestors.length + 1,
          maxDepth: MAX_PARENT_DEPTH,
        })
      }
    }

    const now = core.now()
    const id = core.newIdFor('tkt')
    const { key } = core.store.allocateTicketKey(tx, project.id, now)
    const row: TicketRow = {
      id,
      projectId: project.id,
      key,
      title,
      body,
      kind,
      priority,
      stateCode: 1,
      assigneeId: null,
      reviewerId: null,
      requiresHuman,
      parentId,
      createdBy: actor.id,
      revision: 1,
      blockReason: null,
      resumeStateCode: null,
      policyGeneration: project.policyGeneration,
      reworkCount: 0,
      reopenCount: 0,
      lastReopenedAt: null,
      lastReopenReason: null,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      doneAt: null,
      archivedAt: null,
    }
    core.store.insertTicket(tx, row)
    if (labels.length > 0) core.store.setLabels(tx, id, labels)
    core.appendEvent(tx, {
      projectId: project.id,
      ticketId: id,
      type: 'ticket.created',
      actor,
      revisionBefore: 0,
      revisionAfter: 1,
      fromStateCode: null,
      toStateCode: 1,
      payload: {
        key,
        kind,
        priority,
        stateCode: 1,
        requiresHuman: requiresHuman === 1,
        policyGeneration: project.policyGeneration,
        parentId,
      },
      idempotencyKey: input.idempotencyKey,
      outboxTopic: 'ticket.created',
    })
    return core.ticketDto(row, labels)
  })
}

export async function getTicket(
  core: ServiceCore,
  actorId: string,
  input: GetTicketInput,
): Promise<TicketView> {
  const actor = core.resolveActor(actorId)
  return core.read(tx => {
    const { project, roles } = core.requireMembership(tx, input.projectId, actor.id)
    const row = core.loadTicket(tx, project.id, input.idOrKey)
    const labels = core.store.getLabels(tx, row.id)
    return core.viewFor(tx, row, labels, actor, roles, core.projectPolicy(project))
  })
}

export async function listTickets(
  core: ServiceCore,
  actorId: string,
  input: ListTicketsInput,
): Promise<Page<TicketSummary>> {
  const actor = core.resolveActor(actorId)
  const limit = core.limitOf(input.limit)
  const filter = {
    stateCodes: validateStateCodes(input.stateCodes),
    assigneeId: assertOptionalString(input.assigneeId, 'assigneeId'),
    reviewerId: assertOptionalString(input.reviewerId, 'reviewerId'),
    kind: input.kind === undefined ? undefined : validateKind(input.kind),
    priority: input.priority === undefined ? undefined : validatePriority(input.priority),
    label: assertOptionalString(input.label, 'label', 32),
    includeArchived: input.includeArchived === true,
  }
  const binding = {
    stream: 'tickets' as const,
    projectId: input.projectId,
    queryHash: CursorCodec.queryHash(filter),
  }
  return core.read(tx => {
    core.requireMembership(tx, input.projectId, actor.id)
    let pos = null
    if (input.cursor !== undefined) {
      const decoded = core.cursor.decode(input.cursor, binding)
      if (decoded.kind !== 'ticket-list') {
        throw new IssuesError('VALIDATION_FAILED', 'cursor does not encode a ticket position')
      }
      pos = { updatedAt: decoded.updatedAt, id: decoded.id }
    }
    const filterRow = {
      ...(filter.stateCodes === undefined ? {} : { stateCodes: filter.stateCodes }),
      ...(filter.assigneeId === undefined ? {} : { assigneeId: filter.assigneeId }),
      ...(filter.reviewerId === undefined ? {} : { reviewerId: filter.reviewerId }),
      ...(filter.kind === undefined ? {} : { kind: filter.kind }),
      ...(filter.priority === undefined ? {} : { priority: filter.priority }),
      ...(filter.label === undefined ? {} : { label: filter.label }),
      includeArchived: filter.includeArchived,
    }
    const rows = core.store.queryTickets(tx, input.projectId, filterRow, pos, limit)
    const labels = core.labelsMap(tx, rows)
    const last = rows[rows.length - 1]
    const nextCursor =
      rows.length < limit || last === undefined
        ? null
        : core.cursor.encode(binding, {
            kind: 'ticket-list',
            updatedAt: last.updatedAt,
            id: last.id,
          })
    return core.page(
      rows.map(row => core.summaryDto(row, labels.get(row.id) ?? [])),
      nextCursor,
    )
  })
}

export async function updateTicket(
  core: ServiceCore,
  actorId: string,
  input: UpdateTicketInput,
): Promise<Ticket> {
  const actor = core.resolveActor(actorId)
  return core.runCommand(actor, 'updateTicket', input.idempotencyKey, input, tx => {
    const { project, roles } = core.requireMembership(tx, input.projectId, actor.id)
    const row = core.loadTicket(tx, project.id, input.ticketId)
    if (row.revision !== input.expectedRevision) {
      core.staleRevision(tx, row, actor, roles, core.projectPolicy(project))
    }
    if (row.archivedAt !== null) {
      throw new IssuesError('TRANSITION_NOT_ALLOWED', 'archived tickets are read-only', {
        code: 'ARCHIVED_TICKET',
      })
    }
    if (isTerminalState(row.stateCode)) {
      throw new IssuesError('TRANSITION_NOT_ALLOWED', 'terminal tickets cannot be updated', {
        stateCode: row.stateCode,
      })
    }
    const relation = core.relationOf(row, actor.id)
    const byPlanner = roles.includes('PLANNER')
    const byDeveloper =
      relation.isAssignee && roles.includes('DEVELOPER') && row.stateCode < TESTING
    const byTester =
      relation.isReviewer &&
      roles.includes('TESTER') &&
      row.stateCode < TEST_IN_PROGRESS
    if (!byPlanner && !byDeveloper && !byTester) {
      throw new IssuesError('PRINCIPAL_NOT_ALLOWED', 'update is not allowed for this actor/state', {
        stateCode: row.stateCode,
      })
    }
    if (input.body !== undefined && row.stateCode >= TESTING) {
      throw new IssuesError('EVIDENCE_INVALIDATED', 'body is frozen from TESTING', {
        stateCode: row.stateCode,
      })
    }

    const changed: Array<{ field: string; old: unknown; new: unknown }> = []
    const now = core.now()
    const patch: TicketPatch = { updatedAt: now, lastActivityAt: now }

    let nextTitle = row.title
    let nextBody = row.body
    let nextKind = row.kind
    let nextPriority = row.priority
    let nextLabels: string[] | null = null

    if (input.title !== undefined) {
      nextTitle = validateTitle(input.title)
      if (nextTitle !== row.title) {
        changed.push({ field: 'title', old: row.title, new: nextTitle })
        patch.title = nextTitle
      }
    }
    if (input.body !== undefined) {
      nextBody = validateTicketBody(input.body)
      if (nextBody !== row.body) {
        changed.push({ field: 'body', old: row.body, new: nextBody })
        patch.body = nextBody
      }
    }
    if (input.kind !== undefined) {
      nextKind = validateKind(input.kind)
      if (nextKind !== row.kind) {
        changed.push({ field: 'kind', old: row.kind, new: nextKind })
        patch.kind = nextKind
      }
    }
    if (input.priority !== undefined) {
      nextPriority = validatePriority(input.priority)
      if (nextPriority !== row.priority) {
        changed.push({ field: 'priority', old: row.priority, new: nextPriority })
        patch.priority = nextPriority
      }
    }
    if (input.labels !== undefined) {
      nextLabels = validateLabels(input.labels)
      const oldLabels = core.store.getLabels(tx, row.id)
      if (JSON.stringify(oldLabels) !== JSON.stringify(nextLabels)) {
        changed.push({ field: 'labels', old: oldLabels, new: nextLabels })
      }
    }
    if (changed.length === 0) {
      throw new IssuesError('VALIDATION_FAILED', 'update changes no field', {
        code: 'NO_CHANGES',
      })
    }
    assertP0Label(nextPriority, nextLabels ?? core.store.getLabels(tx, row.id))
    const requiresHuman = nextPriority <= 1 ? 1 : row.requiresHuman
    if (requiresHuman !== row.requiresHuman) {
      patch.requiresHuman = requiresHuman
      changed.push({ field: 'requiresHuman', old: row.requiresHuman === 1, new: true })
    }

    const updated = core.store.updateTicketCas(tx, row.id, row.revision, patch)
    if (updated === undefined) core.staleRevision(tx, row, actor, roles, core.projectPolicy(project))
    const updatedRow = updated as TicketRow
    if (nextLabels !== null) core.store.setLabels(tx, row.id, nextLabels)
    core.appendEvent(tx, {
      projectId: project.id,
      ticketId: row.id,
      type: 'ticket.updated',
      actor,
      revisionBefore: row.revision,
      revisionAfter: row.revision + 1,
      fromStateCode: row.stateCode,
      toStateCode: row.stateCode,
      payload: {
        changed: changed.map(item => ({
          field: item.field,
          old: asJsonValue(item.old),
          new: asJsonValue(item.new),
        })),
        revision: row.revision + 1,
      },
      idempotencyKey: input.idempotencyKey,
      outboxTopic: 'ticket.activity',
    })
    return core.ticketWithLabels(tx, updatedRow)
  })
}

export async function assign(
  core: ServiceCore,
  actorId: string,
  input: AssignInput,
): Promise<Ticket> {
  const actor = core.resolveActor(actorId)
  return core.runCommand(actor, 'assign', input.idempotencyKey, input, tx => {
    const { project, roles } = core.requireMembership(tx, input.projectId, actor.id)
    core.requireRole(roles, 'PLANNER', 'assign')
    const row = core.loadTicket(tx, project.id, input.ticketId)
    if (row.revision !== input.expectedRevision) {
      core.staleRevision(tx, row, actor, roles, core.projectPolicy(project))
    }
    if (isTerminalState(row.stateCode)) {
      throw new IssuesError('TRANSITION_NOT_ALLOWED', 'terminal tickets cannot be assigned', {
        stateCode: row.stateCode,
      })
    }
    if (!canAssignState(row)) {
      throw new IssuesError('REVIEWER_FROZEN', 'assign is pre-TESTING only; use reassign', {
        stateCode: row.stateCode,
        resumeStateCode: row.resumeStateCode,
      })
    }
    if (input.assigneeId === undefined && input.reviewerId === undefined) {
      throw new IssuesError('VALIDATION_FAILED', 'assign requires assigneeId or reviewerId')
    }
    const nextAssigneeId =
      input.assigneeId === undefined ? row.assigneeId : input.assigneeId
    const nextReviewerId =
      input.reviewerId === undefined ? row.reviewerId : input.reviewerId
    assertAssignableAssignee(core, tx, project.id, nextAssigneeId)
    assertQualifiedReviewer(core, tx, project.id, nextReviewerId)
    assertReviewerIndependent(nextAssigneeId, nextReviewerId)
    const patch: TicketPatch = { updatedAt: core.now(), lastActivityAt: core.now() }
    if (input.assigneeId !== undefined) patch.assigneeId = nextAssigneeId
    if (input.reviewerId !== undefined) patch.reviewerId = nextReviewerId
    const updated = core.store.updateTicketCas(tx, row.id, row.revision, patch)
    if (updated === undefined) core.staleRevision(tx, row, actor, roles, core.projectPolicy(project))
    const updatedRow = updated as TicketRow
    core.appendEvent(tx, {
      projectId: project.id,
      ticketId: row.id,
      type: 'ticket.assigned',
      actor,
      revisionBefore: row.revision,
      revisionAfter: row.revision + 1,
      fromStateCode: row.stateCode,
      toStateCode: row.stateCode,
      payload: {
        assigneeId: updatedRow.assigneeId,
        reviewerId: updatedRow.reviewerId,
        previousAssigneeId: row.assigneeId,
        previousReviewerId: row.reviewerId,
      },
      idempotencyKey: input.idempotencyKey,
      outboxTopic: 'ticket.activity',
    })
    return core.ticketWithLabels(tx, updatedRow)
  })
}

export async function reassign(
  core: ServiceCore,
  actorId: string,
  input: ReassignInput,
): Promise<Ticket> {
  const actor = core.resolveActor(actorId)
  return core.runCommand(actor, 'reassign', input.idempotencyKey, input, tx => {
    const { project, roles } = core.requireMembership(tx, input.projectId, actor.id)
    core.requireRole(roles, 'PLANNER', 'reassign')
    const row = core.loadTicket(tx, project.id, input.ticketId)
    if (row.revision !== input.expectedRevision) {
      core.staleRevision(tx, row, actor, roles, core.projectPolicy(project))
    }
    const reason = validateReason(input.reason)
    if (isTerminalState(row.stateCode)) {
      throw new IssuesError('TRANSITION_NOT_ALLOWED', 'reassign is non-terminal; use reopen', {
        stateCode: row.stateCode,
      })
    }
    if (!core.canReassignState(row)) {
      throw new IssuesError('ASSIGN_NOT_REASSIGN', 'use assign before TESTING', {
        stateCode: row.stateCode,
      })
    }
    if (input.assigneeId === undefined && input.reviewerId === undefined) {
      throw new IssuesError('VALIDATION_FAILED', 'reassign requires assigneeId or reviewerId')
    }
    const nextAssigneeId = input.assigneeId === undefined ? row.assigneeId : input.assigneeId
    const nextReviewerId = input.reviewerId === undefined ? row.reviewerId : input.reviewerId
    assertAssignableAssignee(core, tx, project.id, nextAssigneeId)
    assertQualifiedReviewer(core, tx, project.id, nextReviewerId)
    assertReviewerIndependent(nextAssigneeId, nextReviewerId)
    const now = core.now()
    const evidenceIds = core.currentAttemptEvidence(tx, row).map(evidence => evidence.id)
    const patch: TicketPatch = {
      stateCode: IN_PROGRESS,
      assigneeId: nextAssigneeId,
      reviewerId: nextReviewerId,
      blockReason: null,
      resumeStateCode: null,
      updatedAt: now,
      lastActivityAt: now,
    }
    const updated = core.store.updateTicketCas(tx, row.id, row.revision, patch)
    if (updated === undefined) core.staleRevision(tx, row, actor, roles, core.projectPolicy(project))
    const updatedRow = updated as TicketRow
    core.appendEvent(tx, {
      projectId: project.id,
      ticketId: row.id,
      type: 'ticket.reassigned',
      actor,
      revisionBefore: row.revision,
      revisionAfter: row.revision + 1,
      fromStateCode: row.stateCode,
      toStateCode: IN_PROGRESS,
      payload: {
        assigneeId: nextAssigneeId,
        reviewerId: nextReviewerId,
        previousAssigneeId: row.assigneeId,
        previousReviewerId: row.reviewerId,
        reason,
      },
      idempotencyKey: input.idempotencyKey,
      outboxTopic: 'ticket.activity',
    })
    core.appendEvent(tx, {
      projectId: project.id,
      ticketId: row.id,
      type: 'ticket.evidence_invalidated',
      actor,
      revisionBefore: row.revision,
      revisionAfter: row.revision + 1,
      fromStateCode: row.stateCode,
      toStateCode: IN_PROGRESS,
      payload: { reason, evidenceIds, invalidatedAt: now },
      idempotencyKey: null,
      outboxTopic: 'ticket.activity',
    })
    return core.ticketWithLabels(tx, updatedRow)
  })
}

export async function governance(
  core: ServiceCore,
  actorId: string,
  input: GovernanceInput,
): Promise<Ticket> {
  const actor = core.resolveActor(actorId)
  return core.runCommand(actor, 'governance', input.idempotencyKey, input, tx => {
    const { project, roles } = core.requireMembership(tx, input.projectId, actor.id)
    core.requireRole(roles, 'PLANNER', 'governance')
    requireHuman(actor, 'governance')
    if (input.newValue !== 0 && input.newValue !== 1) {
      throw new IssuesError('VALIDATION_FAILED', 'newValue must be 0 or 1', {
        field: 'newValue',
      })
    }
    const row = core.loadTicket(tx, project.id, input.ticketId)
    if (row.revision !== input.expectedRevision) {
      core.staleRevision(tx, row, actor, roles, core.projectPolicy(project))
    }
    const reason = validateReason(input.reason)
    if (input.newValue === 0 && row.priority <= 1) {
      throw new IssuesError('PRIORITY_REQUIRES_HUMAN', 'P0/P1 tickets cannot be un-gated', {
        priority: row.priority,
      })
    }
    const patch: TicketPatch = {
      requiresHuman: input.newValue,
      updatedAt: core.now(),
      lastActivityAt: core.now(),
    }
    const updated = core.store.updateTicketCas(tx, row.id, row.revision, patch)
    if (updated === undefined) core.staleRevision(tx, row, actor, roles, core.projectPolicy(project))
    const updatedRow = updated as TicketRow
    core.appendEvent(tx, {
      projectId: project.id,
      ticketId: row.id,
      type: 'ticket.requires_human_changed',
      actor,
      revisionBefore: row.revision,
      revisionAfter: row.revision + 1,
      fromStateCode: row.stateCode,
      toStateCode: row.stateCode,
      payload: {
        oldValue: row.requiresHuman === 1,
        newValue: input.newValue === 1,
        reason,
        actorKind: actor.kind,
      },
      idempotencyKey: input.idempotencyKey,
      outboxTopic: 'ticket.activity',
    })
    return core.ticketWithLabels(tx, updatedRow)
  })
}

export async function archive(
  core: ServiceCore,
  actorId: string,
  input: ArchiveInput,
): Promise<ArchiveResult> {
  const actor = core.resolveActor(actorId)
  return core.runCommand(actor, 'archive', input.idempotencyKey, input, tx => {
    const { project, roles } = core.requireMembership(tx, input.projectId, actor.id)
    core.requireRole(roles, 'PLANNER', 'delete')
    const row = core.loadTicket(tx, project.id, input.ticketId)
    if (row.revision !== input.expectedRevision) {
      core.staleRevision(tx, row, actor, roles, core.projectPolicy(project))
    }
    if (row.archivedAt !== null) {
      const labels = core.store.getLabels(tx, row.id)
      return { ticket: core.ticketDto(row, labels), event: null }
    }
    if (!isTerminalState(row.stateCode)) {
      throw new IssuesError('TRANSITION_NOT_ALLOWED', 'only terminal tickets can be archived', {
        stateCode: row.stateCode,
      })
    }
    const now = core.now()
    const updated = core.store.updateTicketCas(tx, row.id, row.revision, {
      archivedAt: now,
      updatedAt: now,
      lastActivityAt: now,
    })
    if (updated === undefined) core.staleRevision(tx, row, actor, roles, core.projectPolicy(project))
    const updatedRow = updated as TicketRow
    const reason = assertOptionalString(input.reason, 'reason', 4096)
    const event = core.appendEvent(tx, {
      projectId: project.id,
      ticketId: row.id,
      type: 'ticket.archived',
      actor,
      revisionBefore: row.revision,
      revisionAfter: row.revision + 1,
      fromStateCode: row.stateCode,
      toStateCode: row.stateCode,
      payload: { reason: reason ?? null, archivedAt: now },
      idempotencyKey: input.idempotencyKey,
      outboxTopic: 'ticket.archived',
    })
    return {
      ticket: core.ticketWithLabels(tx, updatedRow),
      event: core.eventDto(event),
    }
  })
}

function canAssignState(row: TicketRow): boolean {
  if (row.stateCode < TESTING) return true
  if (row.stateCode === BLOCKED) {
    return (
      row.resumeStateCode !== null &&
      row.resumeStateCode < TESTING
    )
  }
  return false
}

function validateStateCodes(value: unknown): number[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 8) {
    throw new IssuesError('VALIDATION_FAILED', 'stateCodes must be an array of state codes', {
      field: 'stateCodes',
    })
  }
  const codes: number[] = []
  for (const code of value) {
    if (typeof code !== 'number' || !Number.isInteger(code)) {
      throw new IssuesError('VALIDATION_FAILED', 'stateCodes must be integers', {
        field: 'stateCodes',
      })
    }
    codes.push(code)
  }
  return codes
}

function asJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value as JsonValue
  }
  if (Array.isArray(value)) return value.filter(isScalarJson) as JsonValue[]
  return null
}

function isScalarJson(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
}
