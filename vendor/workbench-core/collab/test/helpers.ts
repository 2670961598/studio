import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ChatService,
  CollabError,
  type Actor,
  type ActorKind,
  type CollabErrorCode,
  type CollabOptions,
  type Room,
} from '../src/index.ts'
import { MemoryChatStore } from '../src/memory-store.ts'
import { SqliteChatStore } from '../src/sqlite-store.ts'
import type { ChatStore } from '../src/store.ts'

/** Deterministic injected clock. */
export interface Clock {
  now: () => number
  advance: (milliseconds: number) => void
}

export function makeClock(start = 1_700_000_000_000): Clock {
  let current = start
  return {
    now: () => current,
    advance(milliseconds: number) {
      current += milliseconds
    },
  }
}

export interface Harness {
  name: string
  collab: ChatService
  store: ChatStore
  clock: Clock
  cleanup: () => Promise<void>
}

export interface Backend {
  name: string
  create: (options?: CollabOptions & { clock?: Clock }) => Promise<Harness>
}

function assemble(
  name: string,
  store: ChatStore,
  options: (CollabOptions & { clock?: Clock }) | undefined,
  cleanup: () => Promise<void>,
): Harness {
  const clock = options?.clock ?? makeClock()
  const { clock: _ignored, ...rest } = options ?? {}
  void _ignored
  const collab = new ChatService(store, { now: clock.now, ...rest })
  return { name, collab, store, clock, cleanup }
}

export const backends: Backend[] = [
  {
    name: 'memory',
    async create(options) {
      const store = new MemoryChatStore()
      return assemble('memory', store, options, async () => {
        await store.close()
      })
    },
  },
  {
    name: 'sqlite',
    async create(options) {
      const dir = mkdtempSync(join(tmpdir(), 'collab-test-'))
      const store = new SqliteChatStore(join(dir, 'chat.sqlite'))
      return assemble('sqlite', store, options, async () => {
        await store.close()
        rmSync(dir, { recursive: true, force: true })
      })
    },
  },
]

export async function expectCode(
  operation: () => Promise<unknown>,
  code: CollabErrorCode,
): Promise<CollabError> {
  try {
    await operation()
  } catch (error) {
    assert.ok(error instanceof CollabError, `expected CollabError, got ${String(error)}`)
    assert.equal(error.code, code)
    return error
  }
  assert.fail(`expected CollabError ${code}, but call succeeded`)
}

export async function createActor(
  collab: ChatService,
  id: string,
  kind: ActorKind = 'agent',
  name = id,
): Promise<Actor> {
  return collab.createActor({ id, kind, name })
}

export interface Fixture {
  harness: Harness
  boss: Actor
  alice: Actor
  bob: Actor
  carol: Actor
  lobby: Room
  room: Room
  dm: Room
}

/**
 * Standard fixture: `boss` human owner of the broadcast lobby and the group room
 * "dev"; `alice`/`bob` are group members; `carol` is an outsider (broadcast member
 * only). `dm` is the alice/bob DM room.
 */
export async function setupFixture(
  backend: Backend,
  options?: CollabOptions & { clock?: Clock },
): Promise<Fixture> {
  const harness = await backend.create(options)
  const { collab } = harness
  const boss = await createActor(collab, 'boss', 'human', 'Boss')
  const alice = await createActor(collab, 'alice', 'agent', 'Alice')
  const bob = await createActor(collab, 'bob', 'agent', 'Bob')
  const carol = await createActor(collab, 'carol', 'agent', 'Carol')
  const lobby = await collab.createBroadcastRoom(boss.id, { name: 'lobby' })
  const room = await collab.createGroupRoom(boss.id, { name: 'dev', memberIds: [alice.id, bob.id] })
  const dm = await collab.createDm(alice.id, bob.id)
  return { harness, boss, alice, bob, carol, lobby, room, dm }
}
