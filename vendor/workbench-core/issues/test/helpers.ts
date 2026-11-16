import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPlatform } from '../src/service.ts'
import type { TicketService } from '../src/service.ts'
import { MemoryIssuesStore } from '../src/memory-store.ts'
import { SqliteIssuesStore } from '../src/sqlite-store.ts'
import { IssuesError } from '../src/errors.ts'
import type { IssuesErrorCode } from '../src/errors.ts'
import type {
  DaemonPort,
  EvidenceKind,
  IssuesOptions,
  Role,
  Ticket,
  TicketView,
  TransitionResult,
} from '../src/types.ts'

export type StoreKind = 'memory' | 'sqlite'

export interface TestClock {
  now(): number
  set(value: number): void
  tick(ms?: number): number
}

export function makeClock(start = Date.UTC(2026, 0, 1, 0, 0, 0)): TestClock {
  // Auto-advancing clock: every observation is 1 ms later, so "created after"
  // boundaries (attempt lower bounds, producedAt after T3) are deterministic.
  let time = start
  return {
    now: () => {
      time += 1
      return time
    },
    set: value => {
      time = value
    },
    tick: (ms = 1000) => {
      time += ms
      return time
    },
  }
}

export interface Idempotency {
  next(): string
}

export function makeIdempotency(): Idempotency {
  let counter = 0
  return {
    next: () => {
      counter += 1
      return `idem-${counter.toString(36)}-${'x'.repeat(6)}`
    },
  }
}

export interface FixtureIds {
  admin: string
  pm: string
  planner: string
  developer: string
  reviewer: string
  developer2: string
  reviewer2: string
  humanTester: string
  outsider: string
}

export interface PlatformFixture {
  server: ReturnType<typeof createPlatform>
  service: TicketService
  daemon: DaemonPort
  ids: FixtureIds
  projectId: string
  root: string
  evidenceRoot: string
  clock: TestClock
  key: Idempotency
  /** Path to the DB file when sqlite; null for memory. */
  dbPath: string | null
  evidenceRequired: 'none' | 'summary'
  store: MemoryIssuesStore | SqliteIssuesStore
  close(): void
  cleanup(): void
}

export interface FixtureOptions extends IssuesOptions {
  store?: StoreKind
  evidenceRequired?: 'none' | 'summary'
}

export async function makeFixture(options: FixtureOptions = {}): Promise<PlatformFixture> {
  const storeKind = options.store ?? 'memory'
  const clock = makeClock()
  const key = makeIdempotency()
  let root: string
  let dbPath: string | null = null
  let store: MemoryIssuesStore | SqliteIssuesStore
  if (storeKind === 'sqlite') {
    // A real file (never :memory:) so persistence/WAL behavior is exercised.
    root = mkdtempSync(join(tmpdir(), 'wb-issues-'))
    dbPath = join(root, 'issues.db')
    store = new SqliteIssuesStore(dbPath)
  } else {
    root = mkdtempSync(join(tmpdir(), 'wb-issues-'))
    store = new MemoryIssuesStore()
  }
  const evidenceRoot = join(root, 'evidence')
  mkdirSync(evidenceRoot, { recursive: true })
  const server = createPlatform(store, {
    now: clock.now,
    newId: defaultTestIds(),
    cursorKey: 'test-cursor-key-0123456789',
    evidenceRoot,
    ...(options.defaultPolicy === undefined ? {} : { defaultPolicy: options.defaultPolicy }),
  })
  const service = server.service
  const ids = await seed(server.service, clock, key, options.evidenceRequired ?? 'none')
  return {
    server,
    service,
    daemon: server.daemon,
    ids,
    projectId: ids.projectId ?? '',
    root,
    evidenceRoot,
    clock,
    key,
    dbPath,
    evidenceRequired: options.evidenceRequired ?? 'none',
    store,
    close: (): void => {
      server.close()
    },
    cleanup: (): void => {
      try {
        server.close()
      } catch {
        /* already closed */
      }
      rmSync(root, { recursive: true, force: true })
    },
  }
}

export function defaultTestIds(): (prefix: string) => string {
  let counter = 0
  return prefix => {
    counter += 1
    return `${prefix}_test_${counter.toString(36).padStart(6, '0')}`
  }
}

interface Seeded {
  admin: string
  pm: string
  planner: string
  developer: string
  reviewer: string
  developer2: string
  reviewer2: string
  humanTester: string
  outsider: string
}

async function seed(
  service: TicketService,
  clock: TestClock,
  key: Idempotency,
  evidenceRequired: 'none' | 'summary',
): Promise<Seeded & { projectId: string }> {
  const admin = await service.createPrincipal({ kind: 'human', displayName: 'Admin' })
  const pm = await service.createPrincipal({ kind: 'human', displayName: 'PM' })
  const planner = await service.createPrincipal({ kind: 'agent', displayName: 'Planner' })
  const developer = await service.createPrincipal({ kind: 'agent', displayName: 'Dev' })
  const reviewer = await service.createPrincipal({ kind: 'agent', displayName: 'Reviewer' })
  const developer2 = await service.createPrincipal({ kind: 'agent', displayName: 'Dev2' })
  const reviewer2 = await service.createPrincipal({ kind: 'agent', displayName: 'Reviewer2' })
  const humanTester = await service.createPrincipal({ kind: 'human', displayName: 'QA Human' })
  const outsider = await service.createPrincipal({ kind: 'agent', displayName: 'Outsider' })
  clock.tick()
  const project = await service.createProject(admin.id, {
    keyPrefix: 'TST',
    name: 'Test Project',
    policy: { evidenceRequired },
  })
  const grant = async (
    actor: string,
    principalId: string,
    roles: Role[],
  ): Promise<void> => {
    await service.grantMembership(actor, {
      projectId: project.id,
      principalId,
      roles,
      reason: 'seed',
      idempotencyKey: key.next(),
    })
  }
  await grant(admin.id, pm.id, ['PLANNER'])
  await grant(pm.id, planner.id, ['PLANNER'])
  await grant(pm.id, developer.id, ['DEVELOPER'])
  await grant(pm.id, reviewer.id, ['TESTER'])
  await grant(pm.id, developer2.id, ['DEVELOPER'])
  await grant(pm.id, reviewer2.id, ['TESTER'])
  await grant(pm.id, humanTester.id, ['TESTER'])
  return {
    admin: admin.id,
    pm: pm.id,
    planner: planner.id,
    developer: developer.id,
    reviewer: reviewer.id,
    developer2: developer2.id,
    reviewer2: reviewer2.id,
    humanTester: humanTester.id,
    outsider: outsider.id,
    projectId: project.id,
  }
}

/** Write an evidence file under the fixture's evidence root and return its uri. */
export function writeEvidence(
  fixture: Pick<PlatformFixture, 'evidenceRoot'>,
  name: string,
  content = 'evidence payload',
): string {
  const target = join(fixture.evidenceRoot, name)
  const dir = target.slice(0, target.lastIndexOf('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(target, content, 'utf8')
  return name
}

export async function addEvidenceFile(
  fixture: PlatformFixture,
  actorId: string,
  ticketId: string,
  kind: EvidenceKind,
  name: string,
  content?: string,
): Promise<{ id: string; sha256: string }> {
  const uri = writeEvidence(fixture, name, content)
  const evidence = await fixture.service.addEvidence(actorId, {
    projectId: fixture.projectId,
    ticketId,
    kind,
    uri,
    idempotencyKey: fixture.key.next(),
  })
  return { id: evidence.id, sha256: evidence.sha256 }
}

export interface TicketSeed {
  title?: string
  kind?: 'task' | 'bug' | 'chore'
  priority?: number
  labels?: string[]
  body?: string
  parentId?: string | null
  requiresHuman?: boolean
}

/** Create a fresh NEW ticket as the fixture's planner agent. */
export async function newTicket(
  fixture: PlatformFixture,
  seed: TicketSeed = {},
  actorId?: string,
): Promise<Ticket> {
  return fixture.service.createTicket(actorId ?? fixture.ids.planner, {
    projectId: fixture.projectId,
    title: seed.title ?? 'a ticket',
    ...(seed.body === undefined ? {} : { body: seed.body }),
    ...(seed.kind === undefined ? {} : { kind: seed.kind }),
    ...(seed.priority === undefined ? {} : { priority: seed.priority }),
    ...(seed.labels === undefined ? {} : { labels: seed.labels }),
    ...(seed.parentId === undefined ? {} : { parentId: seed.parentId }),
    ...(seed.requiresHuman === undefined ? {} : { requiresHuman: seed.requiresHuman }),
    idempotencyKey: fixture.key.next(),
  })
}

export async function assignPrincipals(
  fixture: PlatformFixture,
  ticket: Ticket,
  assigneeId: string,
  reviewerId: string,
): Promise<Ticket> {
  return fixture.service.assign(fixture.ids.planner, {
    projectId: fixture.projectId,
    ticketId: ticket.id,
    assigneeId,
    reviewerId,
    expectedRevision: ticket.revision,
    idempotencyKey: fixture.key.next(),
  })
}

export async function transition(
  fixture: PlatformFixture,
  ticketId: string,
  actorId: string,
  targetStateCode: number,
  expectedRevision: number,
  reason?: string,
): Promise<TransitionResult> {
  return fixture.service.transition(actorId, {
    projectId: fixture.projectId,
    ticketId,
    targetStateCode,
    expectedRevision,
    ...(reason === undefined ? {} : { reason }),
    idempotencyKey: fixture.key.next(),
  })
}

/** Create a TODO ticket with assignee + reviewer set (T1 applied). */
export async function readyTicket(
  fixture: PlatformFixture,
  seed: TicketSeed = {},
  actors?: { assignee?: string; reviewer?: string },
): Promise<Ticket> {
  const ticket = await newTicket(fixture, seed)
  const assigned = await assignPrincipals(
    fixture,
    ticket,
    actors?.assignee ?? fixture.ids.developer,
    actors?.reviewer ?? fixture.ids.reviewer,
  )
  const moved = await transition(fixture, assigned.id, fixture.ids.planner, 2, assigned.revision)
  return moved.ticket
}

/**
 * Drive a ticket to `targetStateCode` through declared edges. `DONE` records a
 * real daemon verdict over the current evidence set first (never self-reported).
 */
export async function driveTo(
  fixture: PlatformFixture,
  ticket: Ticket,
  targetStateCode: number,
  actors?: { developer?: string; reviewer?: string },
): Promise<Ticket> {
  const developer = actors?.developer ?? fixture.ids.developer
  const reviewer = actors?.reviewer ?? fixture.ids.reviewer
  let current = ticket
  if (current.stateCode === 1 && targetStateCode !== 1) {
    if (current.assigneeId === null || current.reviewerId === null) {
      current = await assignPrincipals(fixture, current, developer, reviewer)
    }
    current = (await transition(fixture, current.id, fixture.ids.planner, 2, current.revision)).ticket
  }
  if (current.stateCode === 2 && targetStateCode !== 2) {
    current = (await transition(fixture, current.id, developer, 3, current.revision)).ticket
  }
  if (current.stateCode === 3) {
    if (targetStateCode === 3) return current
    if (targetStateCode === 7) {
      return (await transition(fixture, current.id, fixture.ids.planner, 7, current.revision, 'hold')).ticket
    }
    if (targetStateCode === 4 || targetStateCode === 5 || targetStateCode === 6) {
      // T3 may need summary evidence under the summary policy.
      if (fixture.evidenceRequired === 'summary') {
        await addEvidenceFile(fixture, developer, current.id, 'summary', `summary-${current.id}.txt`)
        current = await refresh(fixture, current.id)
      }
      current = (await transition(fixture, current.id, developer, 4, current.revision)).ticket
    } else {
      throw new Error(`cannot drive IN_PROGRESS to ${targetStateCode}`)
    }
  }
  if (current.stateCode === 4) {
    if (targetStateCode === 4) return current
    if (targetStateCode === 7) {
      return (await transition(fixture, current.id, reviewer, 7, current.revision, 'hold')).ticket
    }
    if (targetStateCode === 5) {
      current = (await transition(fixture, current.id, reviewer, 5, current.revision)).ticket
    } else if (targetStateCode === 6) {
      current = (await transition(fixture, current.id, reviewer, 5, current.revision)).ticket
    } else {
      throw new Error(`cannot drive TESTING to ${targetStateCode}`)
    }
  }
  if (current.stateCode === 5) {
    if (targetStateCode === 5) return current
    if (targetStateCode === 6) {
      await recordPassingGate(fixture, current)
      return (await transition(fixture, current.id, reviewer, 6, current.revision)).ticket
    }
    if (targetStateCode === 3) {
      return (await transition(fixture, current.id, reviewer, 3, current.revision, 'rework')).ticket
    }
    if (targetStateCode === 7) {
      return (await transition(fixture, current.id, reviewer, 7, current.revision, 'hold')).ticket
    }
    throw new Error(`cannot drive TEST_IN_PROGRESS to ${targetStateCode}`)
  }
  if (current.stateCode === 7 && targetStateCode !== 7) {
    throw new Error('driveTo cannot resume BLOCKED automatically')
  }
  if (current.stateCode === targetStateCode) return current
  throw new Error(`cannot drive state ${current.stateCode} to ${targetStateCode}`)
}

/** Record a passing daemon verdict covering exactly the current evidence set. */
export async function recordPassingGate(
  fixture: PlatformFixture,
  ticket: Ticket,
  options: { producedAt?: number; gateExit?: 0 | 1; requirements?: { completed: boolean; output: boolean; report: boolean } } = {},
): Promise<{ gateRunId: string; evidenceId: string; coveredEvidenceIds: string[] }> {
  const evidence = await fixture.service.listEvidence(fixture.ids.planner, {
    projectId: fixture.projectId,
    ticketId: ticket.id,
  })
  // Current-attempt scope (C3-F3): max(last_reopened_at, latest invalidation).
  const current = await refresh(fixture, ticket.id)
  const events = await fixture.service.listEvents(fixture.ids.planner, {
    projectId: fixture.projectId,
    ticketId: ticket.id,
    limit: 500,
  })
  let lowerBound = current.lastReopenedAt ?? 0
  const invalidatedIds = new Set<string>()
  for (const event of events.items) {
    if (event.type !== 'ticket.evidence_invalidated') continue
    const invalidatedAt = event.payload['invalidatedAt']
    if (typeof invalidatedAt === 'number' && invalidatedAt > lowerBound) lowerBound = invalidatedAt
    const ids = event.payload['evidenceIds']
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') invalidatedIds.add(id)
  }
  const covered = evidence
    .filter(item => item.kind !== 'gate')
    .filter(item => item.createdAt > lowerBound && !invalidatedIds.has(item.id))
    .map(item => item.id)
    .sort()
  const uri = writeEvidence(fixture, `gate-${ticket.id}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`, 'gate output')
  const result = await fixture.daemon.recordGateEvidence({
    projectId: fixture.projectId,
    ticketId: ticket.id,
    ...(options.producedAt === undefined ? {} : { producedAt: options.producedAt }),
    gateExit: options.gateExit ?? 0,
    requirements: options.requirements ?? { completed: true, output: true, report: true },
    coveredEvidenceIds: covered,
    uri,
  })
  return {
    gateRunId: result.gateRun.id,
    evidenceId: result.evidence.id,
    coveredEvidenceIds: [...result.gateRun.coveredEvidenceIds],
  }
}

export async function refresh(fixture: PlatformFixture, ticketId: string): Promise<Ticket> {
  const view = await fixture.service.getTicket(fixture.ids.pm, {
    projectId: fixture.projectId,
    idOrKey: ticketId,
  })
  if (view === undefined) throw new Error('ticket not found')
  return stripView(view)
}

export function stripView(view: TicketView): Ticket {
  const { allowedActions: _allowedActions, allowedTransitions: _allowedTransitions, ...ticket } =
    view
  void _allowedActions
  void _allowedTransitions
  return ticket
}

export async function expectIssuesError(
  promise: Promise<unknown>,
  code: IssuesErrorCode,
): Promise<IssuesError> {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof IssuesError, `expected IssuesError ${code}, got ${String(error)}`)
    assert.equal(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`)
    return error
  }
  assert.fail(`expected IssuesError ${code}, but the call succeeded`)
}

export function expectSyncIssuesError(fn: () => unknown, code: IssuesErrorCode): IssuesError {
  try {
    fn()
  } catch (error) {
    assert.ok(error instanceof IssuesError)
    assert.equal(error.code, code)
    return error
  }
  assert.fail(`expected IssuesError ${code}`)
}

/** Assert the ancestor-count invariant (T-P-17) for every ticket in a fixture. */
export async function assertDepthInvariant(fixture: PlatformFixture): Promise<void> {
  const page = await fixture.service.listTickets(fixture.ids.pm, {
    projectId: fixture.projectId,
    limit: 500,
  })
  for (const summary of page.items) {
    let depth = 0
    let current = summary
    const seen = new Set<string>()
    while (current.parentId !== null) {
      if (seen.has(current.id)) throw new Error(`cycle detected at ${current.id}`)
      seen.add(current.id)
      depth += 1
      if (depth > 3) throw new Error(`ticket ${summary.id} exceeds depth 3`)
      const parent = page.items.find(item => item.id === current.parentId)
      if (parent === undefined) throw new Error('dangling parent')
      current = parent
    }
  }
}
