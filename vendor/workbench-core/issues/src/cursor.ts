import { IssuesError } from './errors.ts'
import type { JsonObject } from './types.ts'
import {
  base64UrlDecode,
  base64UrlEncode,
  canonicalJson,
  constantTimeEqualHex,
  hmacSha256Hex,
  randomCursorKey,
} from './util.ts'

/**
 * Opaque, versioned, binding-checked cursor (Part 2d §7.7.5 / C4-L3a).
 *
 * Public pagination accepts exactly `cursor` + `limit`; the internal `seq`
 * (or ticket-list tuple) is an encoding detail that never crosses the boundary.
 * The token is HMAC-signed and bound to the stream, project, ticket and query
 * shape, so tamper / cross-project / cross-ticket / cross-query reuse and
 * version mismatch are all `VALIDATION_FAILED` (422), never a 500.
 */

export type CursorStream = 'tickets' | 'comments' | 'ticket-events' | 'project-events'

const CURSOR_VERSION = 1
const TOKEN_PREFIX = `ic${CURSOR_VERSION}`

export interface CursorBinding {
  stream: CursorStream
  projectId: string
  ticketId?: string
  queryHash?: string
}

export type CursorPosition =
  | { kind: 'seq'; seq: number }
  | { kind: 'ticket-list'; updatedAt: number; id: string }

interface CursorPayload {
  v: number
  s: CursorStream
  p: string
  t: string | null
  q: string | null
  x: JsonObject
}

export class CursorCodec {
  private readonly key: Uint8Array

  constructor(key?: string | Uint8Array) {
    this.key = normalizeKey(key)
  }

  encode(binding: CursorBinding, position: CursorPosition): string {
    const payload: CursorPayload = {
      v: CURSOR_VERSION,
      s: binding.stream,
      p: binding.projectId,
      t: binding.ticketId ?? null,
      q: binding.queryHash ?? null,
      x: positionToJson(position),
    }
    const body = base64UrlEncode(canonicalJson(payload))
    const signature = hmacSha256Hex(this.key, `${TOKEN_PREFIX}.${body}`)
    return `${TOKEN_PREFIX}.${body}.${signature}`
  }

  decode(token: string, binding: CursorBinding): CursorPosition {
    const parts = token.split('.')
    if (parts.length !== 3) throw invalidCursor('malformed token')
    const [prefix, body, signature] = parts as [string, string, string]
    if (prefix !== TOKEN_PREFIX) throw invalidCursor('unsupported cursor version')
    const expected = hmacSha256Hex(this.key, `${TOKEN_PREFIX}.${body}`)
    if (!constantTimeEqualHex(signature, expected)) throw invalidCursor('cursor signature mismatch')

    let payload: CursorPayload
    try {
      payload = JSON.parse(base64UrlDecode(body)) as CursorPayload
    } catch {
      throw invalidCursor('cursor payload is not decodable JSON')
    }
    if (payload === null || typeof payload !== 'object' || payload.v !== CURSOR_VERSION) {
      throw invalidCursor('cursor payload version mismatch')
    }
    if (
      payload.s !== binding.stream ||
      payload.p !== binding.projectId ||
      payload.t !== (binding.ticketId ?? null) ||
      payload.q !== (binding.queryHash ?? null)
    ) {
      throw invalidCursor('cursor binding mismatch')
    }
    return positionFromJson(payload.x)
  }

  /** Hash a ticket-list filter shape into the cursor binding. */
  static queryHash(filters: Record<string, unknown>): string {
    return hmacSha256Hex(new TextEncoder().encode('query'), canonicalJson(filters))
  }
}

function normalizeKey(key?: string | Uint8Array): Uint8Array {
  if (key === undefined) return randomCursorKey()
  if (typeof key === 'string') {
    if (key.length === 0) throw new IssuesError('VALIDATION_FAILED', 'cursorKey must not be empty')
    return new TextEncoder().encode(key)
  }
  if (key.length === 0) throw new IssuesError('VALIDATION_FAILED', 'cursorKey must not be empty')
  return key
}

function positionToJson(position: CursorPosition): JsonObject {
  if (position.kind === 'seq') {
    return { kind: 'seq', seq: position.seq }
  }
  return { kind: 'ticket-list', updatedAt: position.updatedAt, id: position.id }
}

function positionFromJson(value: unknown): CursorPosition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidCursor('cursor position is not an object')
  }
  const record = value as Record<string, unknown>
  if (record['kind'] === 'seq') {
    const seq = record['seq']
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
      throw invalidCursor('cursor seq is invalid')
    }
    return { kind: 'seq', seq }
  }
  if (record['kind'] === 'ticket-list') {
    const updatedAt = record['updatedAt']
    const id = record['id']
    if (typeof updatedAt !== 'number' || !Number.isInteger(updatedAt)) {
      throw invalidCursor('cursor ticket position is invalid')
    }
    if (typeof id !== 'string' || id.length === 0) {
      throw invalidCursor('cursor ticket id is invalid')
    }
    return { kind: 'ticket-list', updatedAt, id }
  }
  throw invalidCursor('cursor position kind is unknown')
}

function invalidCursor(reason: string): IssuesError {
  return new IssuesError('VALIDATION_FAILED', `invalid cursor: ${reason}`, {
    code: 'INVALID_CURSOR',
    reason,
  })
}
