import { createHmac, timingSafeEqual } from 'node:crypto'
import { CollabError } from './errors.ts'

/**
 * Opaque, versioned, binding-checked pagination cursor
 * (docs/plan/issues-platform-api-boundary.md §7.7.5, applied symmetrically to chat).
 *
 * The token is `base64url(payload).base64url(hmac-sha256(payload))`. The internal
 * encoding is `room_seq`; that is adapter/service detail and may change. The public
 * contract is only "give it back, get the next page, same order".
 *
 * Binding fields: format version + stream type + room id + actor id. Tampering,
 * cross-room reuse, cross-principal reuse and future/foreign versions are rejected
 * as `VALIDATION_FAILED` (422 class), never a 500 and never silently accepted.
 */
const CURSOR_VERSION = 1
const MESSAGES_STREAM = 'messages'
const MAX_TOKEN_LENGTH = 4096

export const DEFAULT_CURSOR_SECRET = 'studio-next-collab-cursor-v1'

interface MessagesCursorPayload {
  v: number
  s: string
  r: string
  a: string
  p: number
}

export interface MessagesCursorBinding {
  roomId: string
  actorId: string
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('base64url')
}

function signaturesMatch(expected: string, actual: string): boolean {
  const left = Buffer.from(expected, 'utf8')
  const right = Buffer.from(actual, 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

function invalid(reason: string): CollabError {
  return new CollabError('VALIDATION_FAILED', `invalid cursor: ${reason}`)
}

/** Encode the position of the last item of a page into an opaque cursor. */
export function encodeMessagesCursor(secret: string, binding: MessagesCursorBinding, roomSeq: number): string {
  const payload: MessagesCursorPayload = {
    v: CURSOR_VERSION,
    s: MESSAGES_STREAM,
    r: binding.roomId,
    a: binding.actorId,
    p: roomSeq,
  }
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${encoded}.${sign(secret, encoded)}`
}

/**
 * Validate an opaque cursor against its expected binding and return the decoded
 * internal position (`room_seq`, exclusive).
 */
export function decodeMessagesCursor(secret: string, token: string, binding: MessagesCursorBinding): number {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    throw invalid('malformed token')
  }
  const dot = token.lastIndexOf('.')
  if (dot <= 0 || dot === token.length - 1) throw invalid('malformed token')
  const encoded = token.slice(0, dot)
  const signature = token.slice(dot + 1)
  if (!signaturesMatch(sign(secret, encoded), signature)) throw invalid('signature mismatch')
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    throw invalid('malformed payload')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalid('malformed payload')
  const payload = parsed as Record<string, unknown>
  if (payload['v'] !== CURSOR_VERSION) throw invalid('unsupported version')
  if (payload['s'] !== MESSAGES_STREAM) throw invalid('wrong stream')
  if (payload['r'] !== binding.roomId) throw invalid('wrong room')
  if (payload['a'] !== binding.actorId) throw invalid('wrong principal')
  const position = payload['p']
  if (typeof position !== 'number' || !Number.isSafeInteger(position) || position < 0) {
    throw invalid('malformed position')
  }
  return position
}
