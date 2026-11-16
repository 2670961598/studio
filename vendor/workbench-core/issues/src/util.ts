import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { IssuesError } from './errors.ts'
import type { JsonObject, JsonValue } from './types.ts'

/**
 * Canonical JSON (JCS/RFC 8785 subset): UTF-8, lexicographic key order, no
 * insignificant whitespace, numbers as JSON numbers. The same bytes feed the
 * event hash chain for both adapters (Part 2b §8.3).
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value)
    case 'number':
      if (!Number.isFinite(value)) {
        throw new IssuesError('VALIDATION_FAILED', 'canonical JSON rejects non-finite numbers')
      }
      return JSON.stringify(value)
    case 'boolean':
      return value ? 'true' : 'false'
    case 'object':
      return canonicalObject(value)
    default:
      throw new IssuesError('VALIDATION_FAILED', 'canonical JSON rejects unsupported value type')
  }
}

function canonicalObject(value: object): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalJson(item)).join(',')}]`
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const parts: string[] = []
  for (const key of keys) {
    const item = record[key]
    if (item === undefined) continue
    parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`)
  }
  return `{${parts.join(',')}}`
}

/** SHA-256 hex over UTF-8 text. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** SHA-256 hex over raw bytes (evidence files). */
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function hashJson(value: unknown): string {
  return sha256Hex(canonicalJson(value))
}

/** Hex hash plus a short canonical form used for policy hashes and payloads. */
export function policyHashOf(policy: unknown): string {
  return hashJson(policy)
}

export function base64UrlEncode(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url')
}

export function base64UrlDecode(token: string): string {
  return Buffer.from(token, 'base64url').toString('utf8')
}

export function hmacSha256Hex(key: Uint8Array, text: string): string {
  return createHmac('sha256', key).update(text, 'utf8').digest('hex')
}

/** Length-independent constant-time comparison for hex strings. */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
  } catch {
    return false
  }
}

/** Default id factory: opaque prefixed ids. */
export function defaultNewId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`
}

/** Random per-instance cursor key (32 bytes). */
export function randomCursorKey(): Buffer {
  return Buffer.from(randomUUID().replaceAll('-', ''), 'hex')
}

/* ------------------------------------------------------------------ */
/* Validation helpers                                                  */
/* ------------------------------------------------------------------ */

export function assertNonEmptyString(value: unknown, field: string, maxLength?: number): string {
  if (typeof value !== 'string') {
    throw new IssuesError('VALIDATION_FAILED', `${field} must be a string`, { field })
  }
  if (value.length === 0) {
    throw new IssuesError('VALIDATION_FAILED', `${field} must not be empty`, { field })
  }
  if (value.includes('\u0000')) {
    throw new IssuesError('VALIDATION_FAILED', `${field} must not contain NUL`, { field })
  }
  if (maxLength !== undefined && value.length > maxLength) {
    throw new IssuesError('VALIDATION_FAILED', `${field} exceeds ${maxLength} characters`, {
      field,
      maxLength,
    })
  }
  return value
}

export function assertOptionalString(value: unknown, field: string, maxLength?: number): string | undefined {
  if (value === undefined) return undefined
  return assertNonEmptyString(value, field, maxLength)
}

export function assertIntegerInRange(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new IssuesError('VALIDATION_FAILED', `${field} must be an integer`, { field })
  }
  if (value < min || value > max) {
    throw new IssuesError('VALIDATION_FAILED', `${field} must be between ${min} and ${max}`, {
      field,
      min,
      max,
    })
  }
  return value
}

export function assertBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new IssuesError('VALIDATION_FAILED', `${field} must be a boolean`, { field })
  }
  return value
}

export function assertArray(value: unknown, field: string, maxLength: number): unknown[] {
  if (!Array.isArray(value)) {
    throw new IssuesError('VALIDATION_FAILED', `${field} must be an array`, { field })
  }
  if (value.length > maxLength) {
    throw new IssuesError('VALIDATION_FAILED', `${field} exceeds ${maxLength} items`, {
      field,
      maxLength,
    })
  }
  return value
}

/** Validate a host-bound principal handle; wire identity strings are rejected. */
export function assertActorHandle(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new IssuesError('PRINCIPAL_MISMATCH', 'a host-bound principal handle is required')
  }
  if (/^(?:human|agent|daemon):/.test(value)) {
    throw new IssuesError(
      'PRINCIPAL_MISMATCH',
      'wire-supplied identity is rejected; the host must pass an opaque principal handle',
      { wireIdentity: true },
    )
  }
  return value
}

export function asJsonObject(value: unknown): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IssuesError('VALIDATION_FAILED', 'expected a JSON object')
  }
  return value as JsonObject
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return typeof value !== 'number' || Number.isFinite(value)
    case 'object':
      if (Array.isArray(value)) return value.every(isJsonValue)
      return Object.values(value as Record<string, unknown>).every(isJsonValue)
    default:
      return false
  }
}
