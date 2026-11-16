/**
 * Stable, closed error codes for the issues platform.
 *
 * Codes are the public contract (Part 2a §7.4 + Part 2c §7.6.3 + Part 2d §7.7.7).
 * Implementations must never surface SQLite/driver strings: adapters map them to
 * `STORAGE_UNAVAILABLE` with a correlation id, and trigger rejections surface the
 * domain code the trigger enforces.
 */
export type IssuesErrorCode =
  | 'TICKET_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'STALE_REVISION'
  | 'TRANSITION_NOT_ALLOWED'
  | 'NOOP_TRANSITION'
  | 'TARGET_NOT_REOPENABLE'
  | 'SELF_REOPEN_FORBIDDEN'
  | 'PRINCIPAL_NOT_ALLOWED'
  | 'PROJECT_FORBIDDEN'
  | 'PRINCIPAL_MISMATCH'
  | 'REVIEWER_NOT_INDEPENDENT'
  | 'REVIEWER_NOT_QUALIFIED'
  | 'REVIEWER_UNASSIGNED'
  | 'REVIEWER_FROZEN'
  | 'HUMAN_ONLY_FIELD'
  | 'PRIORITY_REQUIRES_HUMAN'
  | 'HUMAN_APPROVAL_REQUIRED'
  | 'EVIDENCE_REQUIRED'
  | 'GATE_NOT_PASSED'
  | 'EVIDENCE_PATH_INVALID'
  | 'EVIDENCE_NOT_BOUND'
  | 'EVIDENCE_INVALIDATED'
  | 'GATE_RECORD_MISSING'
  | 'GATE_EPOCH_STALE'
  | 'STALE_POLICY_GENERATION'
  | 'POLICY_VALUE_OUT_OF_RANGE'
  | 'STORAGE_UNAVAILABLE'
  | 'VALIDATION_FAILED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'WIP_LIMIT'
  | 'BLOCKED_BY_DEPENDENCY'
  | 'COMMENT_REQUIRED'
  | 'REASON_REQUIRED'
  | 'ASSIGN_NOT_REASSIGN'
  | 'PARENT_NOT_FOUND'
  | 'PARENT_NOT_SAME_PROJECT'
  | 'PARENT_SELF_FORBIDDEN'
  | 'PARENT_CYCLE'
  | 'PARENT_DEPTH_EXCEEDED'
  | 'REPLY_TARGET_INVALID'
  | 'PRECONDITION_FAILED'
  | 'SCHEMA_TOO_NEW'

/** HTTP-equivalent status for every public code (Part 2a §7.4). */
const STATUS: Readonly<Record<IssuesErrorCode, number>> = {
  TICKET_NOT_FOUND: 404,
  PROJECT_NOT_FOUND: 404,
  STALE_REVISION: 409,
  TRANSITION_NOT_ALLOWED: 409,
  NOOP_TRANSITION: 409,
  TARGET_NOT_REOPENABLE: 422,
  SELF_REOPEN_FORBIDDEN: 403,
  PRINCIPAL_NOT_ALLOWED: 403,
  PROJECT_FORBIDDEN: 403,
  PRINCIPAL_MISMATCH: 403,
  REVIEWER_NOT_INDEPENDENT: 403,
  REVIEWER_NOT_QUALIFIED: 403,
  REVIEWER_UNASSIGNED: 409,
  REVIEWER_FROZEN: 409,
  HUMAN_ONLY_FIELD: 403,
  PRIORITY_REQUIRES_HUMAN: 422,
  HUMAN_APPROVAL_REQUIRED: 403,
  EVIDENCE_REQUIRED: 422,
  GATE_NOT_PASSED: 422,
  EVIDENCE_PATH_INVALID: 422,
  EVIDENCE_NOT_BOUND: 422,
  EVIDENCE_INVALIDATED: 409,
  GATE_RECORD_MISSING: 422,
  GATE_EPOCH_STALE: 409,
  STALE_POLICY_GENERATION: 409,
  POLICY_VALUE_OUT_OF_RANGE: 422,
  STORAGE_UNAVAILABLE: 503,
  VALIDATION_FAILED: 422,
  IDEMPOTENCY_CONFLICT: 409,
  WIP_LIMIT: 429,
  BLOCKED_BY_DEPENDENCY: 409,
  COMMENT_REQUIRED: 422,
  REASON_REQUIRED: 422,
  ASSIGN_NOT_REASSIGN: 409,
  PARENT_NOT_FOUND: 404,
  PARENT_NOT_SAME_PROJECT: 422,
  PARENT_SELF_FORBIDDEN: 422,
  PARENT_CYCLE: 422,
  PARENT_DEPTH_EXCEEDED: 422,
  REPLY_TARGET_INVALID: 422,
  PRECONDITION_FAILED: 422,
  SCHEMA_TOO_NEW: 503,
}

const RETRYABLE: Readonly<Partial<Record<IssuesErrorCode, boolean>>> = {
  STORAGE_UNAVAILABLE: true,
}

/** Stable issues-platform error. Callers route on `code`, never on `message`. */
export class IssuesError extends Error {
  readonly code: IssuesErrorCode
  readonly httpStatus: number
  readonly retryable: boolean
  readonly details: Readonly<Record<string, unknown>> | undefined

  constructor(
    code: IssuesErrorCode,
    message?: string,
    details?: Record<string, unknown>,
  ) {
    super(message ?? defaultMessage(code))
    this.name = 'IssuesError'
    this.code = code
    this.httpStatus = STATUS[code]
    this.retryable = RETRYABLE[code] ?? false
    this.details = details
  }
}

/** True when `value` is one of the frozen public error codes. */
export function isIssuesErrorCode(value: unknown): value is IssuesErrorCode {
  return typeof value === 'string' && value in STATUS
}

/** Type guard used by adapters and tests. */
export function isIssuesError(value: unknown): value is IssuesError {
  return value instanceof IssuesError
}

function defaultMessage(code: IssuesErrorCode): string {
  return code
    .toLowerCase()
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
