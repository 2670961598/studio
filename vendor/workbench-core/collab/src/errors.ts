/**
 * Stable, closed error codes for the collaboration kernel.
 *
 * Callers route on `code` and never parse `message`. The set is the union of
 * `docs/plan/chat-room-plan.md` §4.2 (closed table) and
 * `docs/plan/chat-wake-model.md` §7.4, plus the storage-boundary codes required by
 * v0.8 (`issues-platform-api-boundary.md` §7.7.7: `STORAGE_UNAVAILABLE`,
 * `SCHEMA_TOO_NEW`, `VALIDATION_FAILED`). Every extension is documented in the
 * package README under "Error codes".
 */
export type CollabErrorCode =
  // actors
  | 'ACTOR_NOT_FOUND'
  | 'ACTOR_ALREADY_EXISTS'
  | 'ACTOR_RETIRED'
  | 'ACTOR_PAUSED'
  // rooms and membership
  | 'ROOM_NOT_FOUND'
  | 'NOT_MEMBER'
  | 'NOT_ROOM_OWNER'
  | 'LAST_OWNER_FORBIDDEN'
  | 'DM_REQUIRES_TWO_DISTINCT_ACTORS'
  | 'DM_FIXED_PAIR'
  | 'DM_IMMUTABLE'
  | 'BROADCAST_ALREADY_EXISTS'
  | 'BROADCAST_FORBIDDEN'
  | 'BROADCAST_GRANT_FORBIDDEN'
  | 'BROADCAST_KIND_REQUIRED'
  // messages and mentions
  | 'MENTION_NOT_MEMBER'
  | 'SELF_MENTION_FORBIDDEN'
  | 'UNKNOWN_REPLY'
  | 'BODY_EMPTY'
  | 'BODY_TOO_LARGE'
  | 'DUPLICATE_MESSAGE'
  | 'MENTION_BUDGET_EXCEEDED'
  | 'MENTION_ALL_BUDGET_EXCEEDED'
  | 'MENTION_ALL_FORBIDDEN'
  | 'MENTION_ALL_IN_DM'
  | 'BROADCAST_QUOTA_EXCEEDED'
  // read state
  | 'READ_STATE_AHEAD'
  | 'READ_STATE_BACKWARDS'
  // wake delivery
  | 'WAKE_NOT_FOUND'
  | 'WAKE_ALREADY_ACKED'
  | 'WAKE_NOT_ACKABLE'
  // identity, idempotency, bridge
  | 'PRINCIPAL_MISMATCH'
  | 'IDEMPOTENCY_CONFLICT'
  | 'BRIDGE_DUPLICATE'
  // generic / boundary
  | 'VALIDATION_FAILED'
  | 'INVALID_INPUT'
  | 'PAGE_SIZE_INVALID'
  | 'RATE_LIMITED'
  | 'STORE_CLOSED'
  | 'STORAGE_UNAVAILABLE'
  | 'SCHEMA_TOO_NEW'

export type CollabErrorDetails = Record<string, unknown>

/** Stable-error carrier: `code` is contract, `message` is diagnostic prose. */
export class CollabError extends Error {
  readonly code: CollabErrorCode
  readonly details: CollabErrorDetails | undefined

  constructor(code: CollabErrorCode, message: string, details?: CollabErrorDetails) {
    super(message)
    this.name = 'CollabError'
    this.code = code
    this.details = details
  }
}

export function isCollabError(error: unknown): error is CollabError {
  return error instanceof CollabError
}
