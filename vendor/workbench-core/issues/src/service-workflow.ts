import type {
  CloseInput,
  CloseResult,
  JsonObject,
  ReopenInput,
  ReopenResult,
  TransitionInput,
  TransitionResult,
} from './types.ts'
import type { TicketPatch, TicketRow, TicketTx } from './store.ts'
import type { PrincipalRow } from './store.ts'
import type { Role } from './types.ts'
import { IssuesError } from './errors.ts'
import type { ServiceCore } from './core.ts'
import {
  BLOCKED,
  CANCELLED,
  DONE,
  IN_PROGRESS,
  TESTING,
  TEST_IN_PROGRESS,
  TODO,
  candidateRules,
  isTerminalState,
  ruleMatchesActor,
} from './catalog.ts'
import type { TransitionRuleDef } from './catalog.ts'
import {
  assertAssignableAssignee,
  assertQualifiedReviewer,
  assertReviewerIndependent,
  requireHumanApproval,
  validateOptionalReason,
  validateReason,
  validateStateCode,
} from './validation.ts'
import { validateGateForDone } from './service-evidence.ts'

export async function transition(
  core: ServiceCore,
  actorId: string,
  input: TransitionInput,
): Promise<TransitionResult> {
  const actor = core.resolveActor(actorId)
  const targetStateCode = validateStateCode(input.targetStateCode)
  return transitionCommand(core, actor, input, targetStateCode)
}

/** Sync command shared by the single-item path and the batch wrapper. */
export function transitionCommand(
  core: ServiceCore,
  actor: PrincipalRow,
  input: TransitionInput,
  targetStateCode: number,
): TransitionResult {
  return core.runCommand(actor, 'transition', input.idempotencyKey, input, tx => {
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
    const policy = core.projectPolicy(project)
    const rule = resolveRule(core, row, actor, roles, targetStateCode)
    const reason = validateOptionalReason(input.reason)
    const now = core.now()
    const patch: TicketPatch = {
      stateCode: targetStateCode,
      updatedAt: now,
      lastActivityAt: now,
    }
    const payload: JsonObject = {
      action: 'transition',
      ruleId: rule.id,
      policyGeneration: project.policyGeneration,
      policyHash: core.policyHash(policy),
      ...(reason === undefined ? {} : { reason }),
    }

    switch (rule.id) {
      case 'T1': {
        if (row.assigneeId === null) {
          throw new IssuesError('PRECONDITION_FAILED', 'T1 requires an assignee', {
            code: 'ASSIGNEE_UNASSIGNED',
          })
        }
        assertAssignableAssignee(core, tx, project.id, row.assigneeId)
        break
      }
      case 'T2': {
        enforceWip(core, tx, row, policy)
        break
      }
      case 'T3': {
        if (row.reviewerId === null) {
          throw new IssuesError('REVIEWER_UNASSIGNED', 'T3 requires a resolved reviewer')
        }
        assertReviewerIndependent(row.assigneeId, row.reviewerId)
        assertQualifiedReviewer(core, tx, project.id, row.reviewerId)
        const evidence = core.currentAttemptEvidence(tx, row)
        if (policy.evidenceRequired === 'summary' && !evidence.some(item => item.kind === 'summary')) {
          throw new IssuesError('EVIDENCE_REQUIRED', 'a summary evidence row is required', {
            evidenceRequired: policy.evidenceRequired,
          })
        }
        const freezeRevision = row.revision + 1
        payload['reviewerId'] = row.reviewerId
        payload['freezeRevision'] = freezeRevision
        payload['evidenceIds'] = evidence.map(item => item.id)
        break
      }
      case 'T4': {
        const blockReason = requireReasonForRule(reason, 'T4')
        patch.blockReason = blockReason
        patch.resumeStateCode = IN_PROGRESS
        payload['reason'] = blockReason
        break
      }
      case 'T5': {
        assertResumeState(row, IN_PROGRESS)
        patch.blockReason = null
        patch.resumeStateCode = null
        break
      }
      case 'T6': {
        assertFreezeAnchor(core, tx, row)
        assertQualifiedReviewer(core, tx, project.id, row.reviewerId)
        break
      }
      case 'T7': {
        assertFreezeAnchor(core, tx, row)
        if (row.requiresHuman === 1) requireHumanApproval(actor, 'T7')
        const gate = validateGateForDone(core, tx, row)
        patch.doneAt = now
        payload['reviewerId'] = row.reviewerId
        payload['gateRunId'] = gate.verdict.id
        payload['evidenceIds'] = gate.evidenceIds
        break
      }
      case 'T8': {
        const reworkReason = requireReasonForRule(reason, 'T8')
        patch.reworkCount = row.reworkCount + 1
        payload['reason'] = reworkReason
        payload['reworkCount'] = row.reworkCount + 1
        break
      }
      case 'T9': {
        const blockReason = requireReasonForRule(reason, 'T9')
        patch.blockReason = blockReason
        patch.resumeStateCode = TESTING
        payload['reason'] = blockReason
        break
      }
      case 'T10': {
        const blockReason = requireReasonForRule(reason, 'T10')
        patch.blockReason = blockReason
        patch.resumeStateCode = TEST_IN_PROGRESS
        payload['reason'] = blockReason
        break
      }
      case 'T11': {
        assertResumeState(row, targetStateCode)
        patch.blockReason = null
        patch.resumeStateCode = null
        break
      }
      case 'T12': {
        const blockReason = requireReasonForRule(reason, 'T12')
        patch.blockReason = blockReason
        patch.resumeStateCode = row.stateCode
        payload['reason'] = blockReason
        break
      }
      case 'T13': {
        assertResumeState(row, targetStateCode)
        patch.blockReason = null
        patch.resumeStateCode = null
        break
      }
      case 'T14': {
        const clearReason = requireReasonForRule(reason, 'T14')
        patch.assigneeId = null
        payload['reason'] = clearReason
        break
      }
    }

    const updated = core.store.updateTicketCas(tx, row.id, row.revision, patch)
    if (updated === undefined) {
      core.staleRevision(tx, row, actor, roles, policy)
    }
    const updatedRow = updated as TicketRow
    const event = core.appendEvent(tx, {
      projectId: project.id,
      ticketId: row.id,
      type: 'ticket.transitioned',
      actor,
      revisionBefore: row.revision,
      revisionAfter: row.revision + 1,
      fromStateCode: row.stateCode,
      toStateCode: targetStateCode,
      payload,
      idempotencyKey: input.idempotencyKey,
      outboxTopic: outboxTopicForTransition(targetStateCode),
    })
    return {
      ticket: core.ticketWithLabels(tx, updatedRow),
      event: core.eventDto(event),
      ruleId: rule.id,
    }
  })
}

export async function close(
  core: ServiceCore,
  actorId: string,
  input: CloseInput,
): Promise<CloseResult> {
  const actor = core.resolveActor(actorId)
  return core.runCommand(actor, 'close', input.idempotencyKey, input, tx => {
    const { project, roles } = core.requireMembership(tx, input.projectId, actor.id)
    const row = core.loadTicket(tx, project.id, input.ticketId)
    if (row.revision !== input.expectedRevision) {
      core.staleRevision(tx, row, actor, roles, core.projectPolicy(project))
    }
    if (isTerminalState(row.stateCode)) {
      throw new IssuesError('TRANSITION_NOT_ALLOWED', 'close is non-terminal only', {
        stateCode: row.stateCode,
      })
    }
    const reason = validateReason(input.reason)
    if (row.requiresHuman === 1) requireHumanApproval(actor, 'close')
    const isPlanner = roles.includes('PLANNER')
    const humanOverride = !isPlanner && actor.kind === 'human'
    if (!isPlanner && !humanOverride) {
      throw new IssuesError('PRINCIPAL_NOT_ALLOWED', 'close requires PLANNER or human override', {
        roles,
      })
    }
    const now = core.now()
    const updated = core.store.updateTicketCas(tx, row.id, row.revision, {
      stateCode: CANCELLED,
      doneAt: now,
      blockReason: null,
      resumeStateCode: null,
      updatedAt: now,
      lastActivityAt: now,
    })
    if (updated === undefined) {
      core.staleRevision(tx, row, actor, roles, core.projectPolicy(project))
    }
    const updatedRow = updated as TicketRow
    const event = core.appendEvent(tx, {
      projectId: project.id,
      ticketId: row.id,
      type: 'ticket.closed',
      actor,
      revisionBefore: row.revision,
      revisionAfter: row.revision + 1,
      fromStateCode: row.stateCode,
      toStateCode: CANCELLED,
      payload: {
        reason,
        previousStateCode: row.stateCode,
        override: humanOverride,
      },
      idempotencyKey: input.idempotencyKey,
      outboxTopic: 'ticket.activity',
    })
    return { ticket: core.ticketWithLabels(tx, updatedRow), event: core.eventDto(event) }
  })
}

export async function reopen(
  core: ServiceCore,
  actorId: string,
  input: ReopenInput,
): Promise<ReopenResult> {
  const actor = core.resolveActor(actorId)
  const requestedTarget =
    input.targetStateCode === undefined ? undefined : validateStateCode(input.targetStateCode)
  return core.runCommand(actor, 'reopen', input.idempotencyKey, input, tx => {
    const { project, roles } = core.requireMembership(tx, input.projectId, actor.id)
    const row = core.loadTicket(tx, project.id, input.ticketId)
    if (row.revision !== input.expectedRevision) {
      core.staleRevision(tx, row, actor, roles, core.projectPolicy(project))
    }
    if (!isTerminalState(row.stateCode)) {
      throw new IssuesError('TRANSITION_NOT_ALLOWED', 'only terminal tickets can be reopened', {
        stateCode: row.stateCode,
      })
    }
    const policy = core.projectPolicy(project)
    const hasGrant =
      roles.includes('PLANNER') ||
      (actor.kind === 'human' && policy.reopenPrincipals.includes(actor.id))
    if (!hasGrant) {
      throw new IssuesError('PRINCIPAL_NOT_ALLOWED', 'reopen requires ticket:reopen', {
        requiredGrant: 'ticket:reopen',
      })
    }
    if (row.assigneeId === actor.id || row.reviewerId === actor.id) {
      throw new IssuesError('SELF_REOPEN_FORBIDDEN', 'assignee/reviewer cannot reopen their ticket')
    }
    const reason = validateReason(input.reason)
    const target = requestedTarget ?? TODO
    let ruleId: 'T15' | 'T16'
    if (target === row.stateCode) {
      throw new IssuesError('NOOP_TRANSITION', 'reopen target equals the current terminal state', {
        stateCode: row.stateCode,
      })
    }
    if (target === TODO && (row.stateCode === DONE || row.stateCode === CANCELLED)) {
      ruleId = 'T15'
    } else if (target === IN_PROGRESS && row.stateCode === DONE) {
      ruleId = 'T16'
    } else {
      throw new IssuesError('TARGET_NOT_REOPENABLE', 'reopen target is not a declared edge', {
        targetStateCode: target,
        fromStateCode: row.stateCode,
      })
    }
    if (row.requiresHuman === 1) requireHumanApproval(actor, 'reopen')

    const nextAssigneeId = input.assigneeId === undefined ? row.assigneeId : input.assigneeId
    const nextReviewerId = input.reviewerId === undefined ? row.reviewerId : input.reviewerId
    if (input.assigneeId !== undefined) assertAssignableAssignee(core, tx, project.id, nextAssigneeId)
    if (input.reviewerId !== undefined) assertQualifiedReviewer(core, tx, project.id, nextReviewerId)
    assertReviewerIndependent(nextAssigneeId, nextReviewerId)

    const now = core.now()
    const patch: TicketPatch = {
      stateCode: target,
      doneAt: null,
      reopenCount: row.reopenCount + 1,
      lastReopenedAt: now,
      lastReopenReason: reason,
      blockReason: null,
      resumeStateCode: null,
      updatedAt: now,
      lastActivityAt: now,
    }
    if (input.assigneeId !== undefined) patch.assigneeId = nextAssigneeId
    if (input.reviewerId !== undefined) patch.reviewerId = nextReviewerId
    const updated = core.store.updateTicketCas(tx, row.id, row.revision, patch)
    if (updated === undefined) {
      core.staleRevision(tx, row, actor, roles, policy)
    }
    const updatedRow = updated as TicketRow
    const event = core.appendEvent(tx, {
      projectId: project.id,
      ticketId: row.id,
      type: 'ticket.reopened',
      actor,
      revisionBefore: row.revision,
      revisionAfter: row.revision + 1,
      fromStateCode: row.stateCode,
      toStateCode: target,
      payload: {
        ruleId,
        fromStateCode: row.stateCode,
        toStateCode: target,
        reason,
        reopenCount: row.reopenCount + 1,
        previousDoneAt: row.doneAt,
        assigneeId: updatedRow.assigneeId,
        reviewerId: updatedRow.reviewerId,
      },
      idempotencyKey: input.idempotencyKey,
      outboxTopic: 'ticket.reopened',
    })
    return {
      ticket: core.ticketWithLabels(tx, updatedRow),
      event: core.eventDto(event),
      ruleId,
    }
  })
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function resolveRule(
  core: ServiceCore,
  row: TicketRow,
  actor: PrincipalRow,
  roles: readonly Role[],
  target: number,
): TransitionRuleDef {
  const candidates = candidateRules(row.stateCode, target, row.resumeStateCode)
  const allowedTransitions = core.allowedTransitionsFor(row, actor, roles)
  if (candidates.length === 0) {
    throw new IssuesError('TRANSITION_NOT_ALLOWED', 'no matrix row for this transition', {
      fromStateCode: row.stateCode,
      targetStateCode: target,
      allowedTransitions,
    })
  }
  const relation = core.relationOf(row, actor.id)
  const rule = candidates.find(item => ruleMatchesActor(item, roles, relation))
  if (rule === undefined) {
    throw new IssuesError('PRINCIPAL_NOT_ALLOWED', 'actor may not execute this transition', {
      fromStateCode: row.stateCode,
      targetStateCode: target,
      roles,
      allowedTransitions,
    })
  }
  return rule
}

function enforceWip(
  core: ServiceCore,
  tx: TicketTx,
  row: TicketRow,
  policy: { wipLimitPerWorker: number; wipLimitPerProject: number },
): void {
  if (row.assigneeId === null) {
    throw new IssuesError('PRECONDITION_FAILED', 'T2 requires an assignee', {
      code: 'ASSIGNEE_UNASSIGNED',
    })
  }
  const worker = core.store.countTickets(tx, row.projectId, {
    stateCodes: [IN_PROGRESS],
    assigneeId: row.assigneeId,
  })
  if (worker >= policy.wipLimitPerWorker) {
    throw new IssuesError('WIP_LIMIT', 'worker WIP limit exceeded', {
      scope: 'worker',
      current: worker,
      limit: policy.wipLimitPerWorker,
    })
  }
  const project = core.store.countTickets(tx, row.projectId, {
    stateCodes: [IN_PROGRESS, TEST_IN_PROGRESS],
  })
  if (project >= policy.wipLimitPerProject) {
    throw new IssuesError('WIP_LIMIT', 'project WIP limit exceeded', {
      scope: 'project',
      current: project,
      limit: policy.wipLimitPerProject,
    })
  }
}

function requireReasonForRule(reason: string | undefined, ruleId: string): string {
  if (reason === undefined) {
    throw new IssuesError('REASON_REQUIRED', `${ruleId} requires a reason`, { ruleId })
  }
  return reason
}

function assertResumeState(row: TicketRow, expected: number): void {
  if (row.resumeStateCode !== expected) {
    throw new IssuesError('PRECONDITION_FAILED', 'resume_state_code does not match target', {
      code: 'RESUME_STATE_MISMATCH',
      expected,
      actual: row.resumeStateCode,
    })
  }
}

function assertFreezeAnchor(core: ServiceCore, tx: TicketTx, row: TicketRow): void {
  const anchor = core.freezeAnchor(tx, row.id)
  if (anchor === null || anchor.reviewerId === null || anchor.reviewerId !== row.reviewerId) {
    throw new IssuesError('REVIEWER_FROZEN', 'reviewer no longer matches the T3 freeze baseline', {
      reviewerId: row.reviewerId,
      baselineReviewerId: anchor?.reviewerId ?? null,
    })
  }
}

function outboxTopicForTransition(targetStateCode: number): string {
  switch (targetStateCode) {
    case TESTING:
      return 'ticket.test_requested'
    case DONE:
      return 'ticket.completed'
    case BLOCKED:
      return 'ticket.blocked'
    case TODO:
      return 'ticket.ready'
    default:
      return 'ticket.activity'
  }
}
