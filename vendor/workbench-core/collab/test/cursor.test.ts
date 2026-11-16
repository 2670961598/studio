import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import {
  DEFAULT_CURSOR_SECRET,
  decodeMessagesCursor,
  encodeMessagesCursor,
} from '../src/cursor.ts'
import { expectCode } from './helpers.ts'

function craft(secret: string, payload: unknown): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signature = createHmac('sha256', secret).update(encoded, 'utf8').digest('base64url')
  return `${encoded}.${signature}`
}

const binding = { roomId: 'room-1', actorId: 'alice' }

test('[cursor] opaque cursor round-trips the internal position', () => {
  const token = encodeMessagesCursor(DEFAULT_CURSOR_SECRET, binding, 42)
  assert.equal(typeof token, 'string')
  assert.equal(token.includes('42'), false, 'position is not a plain public value')
  assert.equal(decodeMessagesCursor(DEFAULT_CURSOR_SECRET, token, binding), 42)
})

test('[cursor] token rejects tampering and a different signing key', async () => {
  const token = encodeMessagesCursor(DEFAULT_CURSOR_SECRET, binding, 1)
  await expectCode(() => Promise.resolve(decodeMessagesCursor(DEFAULT_CURSOR_SECRET, `${token}x`, binding)), 'VALIDATION_FAILED')
  await expectCode(
    () => Promise.resolve(decodeMessagesCursor('another-secret', token, binding)),
    'VALIDATION_FAILED',
  )
})

test('[cursor] token is binding-checked against room and principal', async () => {
  const token = encodeMessagesCursor(DEFAULT_CURSOR_SECRET, binding, 3)
  await expectCode(
    () => Promise.resolve(decodeMessagesCursor(DEFAULT_CURSOR_SECRET, token, { roomId: 'room-2', actorId: 'alice' })),
    'VALIDATION_FAILED',
  )
  await expectCode(
    () => Promise.resolve(decodeMessagesCursor(DEFAULT_CURSOR_SECRET, token, { roomId: 'room-1', actorId: 'bob' })),
    'VALIDATION_FAILED',
  )
})

test('[cursor] validly signed tokens with a foreign version/stream are rejected', async () => {
  const base = { v: 1, s: 'messages', r: 'room-1', a: 'alice', p: 5 }
  await expectCode(
    () => Promise.resolve(decodeMessagesCursor(DEFAULT_CURSOR_SECRET, craft(DEFAULT_CURSOR_SECRET, { ...base, v: 2 }), binding)),
    'VALIDATION_FAILED',
  )
  await expectCode(
    () =>
      Promise.resolve(
        decodeMessagesCursor(DEFAULT_CURSOR_SECRET, craft(DEFAULT_CURSOR_SECRET, { ...base, s: 'events' }), binding),
      ),
    'VALIDATION_FAILED',
  )
  await expectCode(
    () =>
      Promise.resolve(
        decodeMessagesCursor(DEFAULT_CURSOR_SECRET, craft(DEFAULT_CURSOR_SECRET, { ...base, p: -1 }), binding),
      ),
    'VALIDATION_FAILED',
  )
  await expectCode(
    () =>
      Promise.resolve(
        decodeMessagesCursor(DEFAULT_CURSOR_SECRET, craft(DEFAULT_CURSOR_SECRET, { ...base, p: 1.5 }), binding),
      ),
    'VALIDATION_FAILED',
  )
  await expectCode(
    () =>
      Promise.resolve(
        decodeMessagesCursor(DEFAULT_CURSOR_SECRET, craft(DEFAULT_CURSOR_SECRET, { ...base, p: '5' }), binding),
      ),
    'VALIDATION_FAILED',
  )
  await expectCode(
    () =>
      Promise.resolve(
        decodeMessagesCursor(
          DEFAULT_CURSOR_SECRET,
          craft(DEFAULT_CURSOR_SECRET, { v: 1, s: 'messages', r: 'room-1', a: 'alice' }),
          binding,
        ),
      ),
    'VALIDATION_FAILED',
  )
})

test('[cursor] malformed tokens are rejected as VALIDATION_FAILED, never crash', async () => {
  for (const token of ['', '.', 'abc', 'a.b', 'a.b.c', 'x'.repeat(5000)]) {
    await expectCode(() => Promise.resolve(decodeMessagesCursor(DEFAULT_CURSOR_SECRET, token, binding)), 'VALIDATION_FAILED')
  }
})
