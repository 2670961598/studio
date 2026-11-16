import type { Role, TicketKind } from './types.ts'
import type { PrincipalRow, TicketTx } from './store.ts'
import { IssuesError } from './errors.ts'
import {
  MAX_BODY_LENGTH,
  MAX_COMMENT_BYTES,
  MAX_LABELS,
  MAX_PRIORITY,
  MAX_TITLE_LENGTH,
  TICKET_KINDS,
  stateInfo,
} from './catalog.ts'
import type { ServiceCore } from './core.ts'
import { assertNonEmptyString, assertOptionalString } from './util.ts'

export function validateTitle(value: unknown): string {
  return assertNonEmptyString(value, 'title', MAX_TITLE_LENGTH)
}

export function validateTicketBody(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value !== 'string') {
    throw new IssuesError('VALIDATION_FAILED', 'body must be a string', { field: 'body' })
  }
  if (value.includes('\u0000')) {
    throw new IssuesError('VALIDATION_FAILED', 'body must not contain NUL', { field: 'body' })
  }
  if (value.length > MAX_BODY_LENGTH) {
    throw new IssuesError('VALIDATION_FAILED', `body exceeds ${MAX_BODY_LENGTH} characters`, {
      field: 'body',
      maxLength: MAX_BODY_LENGTH,
    })
  }
  return value
}

export function validateCommentBody(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new IssuesError('COMMENT_REQUIRED', 'comment body must not be empty', {
      field: 'body',
    })
  }
  if (value.includes('\u0000')) {
    throw new IssuesError('VALIDATION_FAILED', 'comment body must not contain NUL', {
      field: 'body',
    })
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_COMMENT_BYTES) {
    throw new IssuesError('VALIDATION_FAILED', `comment body exceeds ${MAX_COMMENT_BYTES} bytes`, {
      field: 'body',
      maxBytes: MAX_COMMENT_BYTES,
    })
  }
  return value
}

export function validateReason(value: unknown, field = 'reason'): string {
  return assertNonEmptyString(value, field, 4096)
}

export function validateOptionalReason(value: unknown): string | undefined {
  return assertOptionalString(value, 'reason', 4096)
}

export function validateKind(value: unknown, fallback: TicketKind = 'task'): TicketKind {
  if (value === undefined) return fallback
  if (typeof value === 'string' && (TICKET_KINDS as readonly string[]).includes(value)) {
    return value as TicketKind
  }
  throw new IssuesError('VALIDATION_FAILED', `kind must be one of ${TICKET_KINDS.join(', ')}`, {
    field: 'kind',
  })
}

export function validatePriority(value: unknown, fallback = 2): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_PRIORITY) {
    throw new IssuesError('VALIDATION_FAILED', `priority must be 0..${MAX_PRIORITY}`, {
      field: 'priority',
    })
  }
  return value
}

const LABEL_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function validateLabels(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new IssuesError('VALIDATION_FAILED', 'labels must be an array', { field: 'labels' })
  }
  if (value.length > MAX_LABELS) {
    throw new IssuesError('VALIDATION_FAILED', `at most ${MAX_LABELS} labels are allowed`, {
      field: 'labels',
      max: MAX_LABELS,
    })
  }
  const labels: string[] = []
  for (const label of value) {
    if (typeof label !== 'string' || label.length > 32 || !LABEL_PATTERN.test(label)) {
      throw new IssuesError('VALIDATION_FAILED', 'labels must be lowercase kebab-case', {
        field: 'labels',
        label: String(label),
      })
    }
    labels.push(label)
  }
  return [...new Set(labels)].sort()
}

export function validateStateCode(value: unknown, field = 'targetStateCode'): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new IssuesError('VALIDATION_FAILED', `${field} must be an integer state code`, { field })
  }
  return stateInfo(value).code
}

/** P0 must carry the `bug` or `incident` label (Part 1 §3.2). */
export function assertP0Label(priority: number, labels: readonly string[]): void {
  if (priority === 0 && !labels.includes('bug') && !labels.includes('incident')) {
    throw new IssuesError('VALIDATION_FAILED', 'P0 tickets must carry a bug or incident label', {
      field: 'priority',
      labels,
    })
  }
}

export function requireHuman(actor: PrincipalRow, field: string): void {
  if (actor.kind !== 'human') {
    throw new IssuesError('HUMAN_ONLY_FIELD', `${field} is human-only`, {
      field,
      actorKind: actor.kind,
    })
  }
}

export function requireHumanApproval(actor: PrincipalRow, action: string): void {
  if (actor.kind !== 'human') {
    throw new IssuesError('HUMAN_APPROVAL_REQUIRED', `${action} requires a human actor`, {
      action,
      actorKind: actor.kind,
    })
  }
}

/** The assignee must be an active member holding DEVELOPER or TESTER (T1). */
export function assertAssignableAssignee(
  core: ServiceCore,
  tx: TicketTx,
  projectId: string,
  principalId: string | null,
): void {
  if (principalId === null) return
  const principal = core.store.getPrincipal(tx, principalId)
  if (principal === undefined || principal.status !== 'active' || principal.kind === 'daemon') {
    throw new IssuesError('PRINCIPAL_NOT_ALLOWED', 'assignee must be an active principal', {
      field: 'assigneeId',
    })
  }
  const roles = core.store.getMembershipRoles(tx, projectId, principalId)
  const qualified = roles.includes('DEVELOPER') || roles.includes('TESTER')
  if (!qualified) {
    throw new IssuesError('PRINCIPAL_NOT_ALLOWED', 'assignee must hold DEVELOPER or TESTER', {
      field: 'assigneeId',
      roles,
    })
  }
}

/** R2/R3: reviewer is an active member holding TESTER. */
export function assertQualifiedReviewer(
  core: ServiceCore,
  tx: TicketTx,
  projectId: string,
  reviewerId: string | null,
): void {
  if (reviewerId === null) return
  const principal = core.store.getPrincipal(tx, reviewerId)
  if (principal === undefined || principal.status !== 'active' || principal.kind === 'daemon') {
    throw new IssuesError('PROJECT_FORBIDDEN', 'reviewer must be an active principal', {
      field: 'reviewerId',
    })
  }
  const roles = core.store.getMembershipRoles(tx, projectId, reviewerId)
  if (roles.length === 0) {
    throw new IssuesError('PROJECT_FORBIDDEN', 'reviewer is not a project member', {
      field: 'reviewerId',
    })
  }
  if (!roles.includes('TESTER')) {
    throw new IssuesError('REVIEWER_NOT_QUALIFIED', 'reviewer must hold TESTER', {
      field: 'reviewerId',
      roles,
    })
  }
}

/** R1: reviewer must not equal the assignee. */
export function assertReviewerIndependent(
  assigneeId: string | null,
  reviewerId: string | null,
): void {
  if (assigneeId !== null && reviewerId !== null && assigneeId === reviewerId) {
    throw new IssuesError('REVIEWER_NOT_INDEPENDENT', 'reviewer must differ from assignee', {
      assigneeId,
      reviewerId,
    })
  }
}

export function validateRoles(value: unknown): Role[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new IssuesError('VALIDATION_FAILED', 'roles must be a non-empty array', {
      field: 'roles',
    })
  }
  const allowed: readonly Role[] = ['PLANNER', 'DEVELOPER', 'TESTER']
  const roles: Role[] = []
  for (const role of value) {
    if (typeof role !== 'string' || !(allowed as readonly string[]).includes(role)) {
      throw new IssuesError('VALIDATION_FAILED', 'role must be PLANNER|DEVELOPER|TESTER', {
        field: 'roles',
        role: String(role),
      })
    }
    roles.push(role as Role)
  }
  return [...new Set(roles)].sort()
}
