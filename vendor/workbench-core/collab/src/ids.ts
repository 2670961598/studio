import { randomUUID } from 'node:crypto'

/** Default id generator; UUIDs are lowercase hex + dashes, i.e. actor-id safe. */
export function defaultNewId(): string {
  return randomUUID()
}

/** Default clock; injectable for deterministic tests/replay. */
export function defaultNow(): number {
  return Date.now()
}
