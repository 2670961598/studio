import { createHash } from 'node:crypto'

/**
 * Actor id gate (F11): lowercase charset without `:`, so a DM key can never fold
 * two different pairs together (`a` + `b:c` is impossible).
 */
export const ACTOR_ID_PATTERN = /^[a-z0-9_-]{1,64}$/

export const ACTOR_ID_HINT = 'actor id must match ^[a-z0-9_-]{1,64}$'

/** Normalize the two DM participants lexicographically (`dm_low` < `dm_high`). */
export function dmPair(actorA: string, actorB: string): { low: string; high: string } {
  return actorA < actorB ? { low: actorA, high: actorB } : { low: actorB, high: actorA }
}

/**
 * DM identity key: `sha256(dm_low ‖ 0x00 ‖ dm_high)` as lowercase hex.
 * The NUL separator is outside the actor-id charset, so the encoding is injective.
 * The database additionally holds `UNIQUE(dm_low, dm_high)` as the guard of record.
 */
export function dmKey(actorA: string, actorB: string): string {
  const { low, high } = dmPair(actorA, actorB)
  return sha256Hex(`${low}\u0000${high}`)
}

/** Wake dedupe key: one wake_item per `(source message, directed target)`. */
export function wakeDedupeKey(sourceSeq: number, actorId: string): string {
  return sha256Hex(`${sourceSeq}\u0000${actorId}`)
}

/** Canonical request hash for the command-log idempotency store. */
export function requestHash(parts: readonly unknown[]): string {
  return sha256Hex(JSON.stringify(parts))
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
