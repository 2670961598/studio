import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ACTION_GRANTS, STATE_CATALOG, TRANSITION_RULES } from '../src/catalog.ts'
import {
  driveTo,
  expectIssuesError,
  makeFixture,
  newTicket,
  readyTicket,
  recordPassingGate,
  refresh,
  transition,
} from './helpers.ts'
import type { PlatformFixture } from './helpers.ts'
import type { Ticket } from '../src/types.ts'

/* ------------------------------------------------------------------ */
/* L2 golden: frozen state catalog and matrices                        */
/* ------------------------------------------------------------------ */

test('golden T-G-01: state catalog has exactly the eight frozen rows', () => {
  assert.deepEqual(
    STATE_CATALOG.map(state => [
      state.code,
      state.name,
      state.displayOrder,
      state.terminal,
      state.ready,
    ]),
    [
      [1, 'NEW', 10, false, false],
      [2, 'TODO', 20, false, true],
      [3, 'IN_PROGRESS', 30, false, false],
      [4, 'TESTING', 40, false, false],
      [5, 'TEST_IN_PROGRESS', 50, false, false],
      [6, 'DONE', 60, true, false],
      [7, 'BLOCKED', 70, false, false],
      [8, 'CANCELLED', 80, true, false],
    ],
  )
})

test('golden T-G-01: transition matrix equals the frozen spec rows', () => {
  const expanded: Array<[string, number, number | 'resume', string, string]> = []
  for (const rule of TRANSITION_RULES) {
    for (const from of rule.from) expanded.push([rule.id, from, rule.to, rule.role, rule.relation])
  }
  const expected: Array<[string, number, number | 'resume', string, string]> = [
    ['T1', 1, 2, 'PLANNER', 'planner'],
    ['T12', 1, 7, 'PLANNER', 'planner'],
    ['T14', 2, 1, 'PLANNER', 'planner'],
    ['T2', 2, 3, 'DEVELOPER', 'assignee'],
    ['T12', 2, 7, 'PLANNER', 'planner'],
    ['T3', 3, 4, 'DEVELOPER', 'assignee'],
    ['T4', 3, 7, 'DEVELOPER', 'assignee'],
    ['T12', 3, 7, 'PLANNER', 'planner'],
    ['T6', 4, 5, 'TESTER', 'reviewer'],
    ['T9', 4, 7, 'TESTER', 'reviewer'],
    ['T12', 4, 7, 'PLANNER', 'planner'],
    ['T8', 5, 3, 'TESTER', 'reviewer'],
    ['T7', 5, 6, 'TESTER', 'reviewer'],
    ['T10', 5, 7, 'TESTER', 'reviewer'],
    ['T12', 5, 7, 'PLANNER', 'planner'],
    ['T5', 7, 3, 'DEVELOPER', 'assignee'],
    ['T11', 7, 4, 'TESTER', 'reviewer'],
    ['T11', 7, 5, 'TESTER', 'reviewer'],
    ['T13', 7, 'resume', 'PLANNER', 'planner'],
  ]
  const sortKey = (row: Array<[string, number, number | 'resume', string, string]>[number]): string =>
    `${row[1]}:${String(row[2])}:${row[0]}`
  expanded.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
  expected.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
  assert.deepEqual(expanded, expected)
  assert.equal(new Set(TRANSITION_RULES.map(rule => rule.id)).size, 14, 'T1..T14 all present')
})

test('golden T-G-01: action grants equal the frozen role table', () => {
  assert.deepEqual(
    ACTION_GRANTS.map(grant => [grant.action, grant.roles, grant.humanOnly]),
    [
      ['read', 'any-member', false],
      ['create', ['PLANNER', 'DEVELOPER', 'TESTER'], false],
      ['update', ['PLANNER', 'DEVELOPER', 'TESTER'], false],
      ['delete', ['PLANNER'], false],
      ['transition', ['PLANNER', 'DEVELOPER', 'TESTER'], false],
      ['comment', 'any-member', false],
      ['assign', ['PLANNER'], false],
      ['reassign', ['PLANNER'], false],
      ['reparent', ['PLANNER'], false],
      ['governance', ['PLANNER'], true],
      ['close', ['PLANNER'], false],
      ['reopen', ['PLANNER'], false],
      ['policy:write', ['PLANNER'], true],
    ],
  )
})

/* ------------------------------------------------------------------ */
/* L3 golden through the public service                               */
/* ------------------------------------------------------------------ */

interface MatrixCase {
  id: string
  ruleId: string
  from: number
  target: number
  actorRole: 'PLANNER' | 'DEVELOPER' | 'TESTER'
  reason: boolean
  wrongActor: 'planner' | 'developer' | 'reviewer'
  prepare: (fixture: PlatformFixture) => Promise<Ticket>
}

const state1 = (fixture: PlatformFixture): Promise<Ticket> => newTicket(fixture)
const state2 = (fixture: PlatformFixture): Promise<Ticket> => readyTicket(fixture)
const state3 = async (fixture: PlatformFixture): Promise<Ticket> =>
  driveTo(fixture, await state2(fixture), 3)
const state4 = async (fixture: PlatformFixture): Promise<Ticket> =>
  driveTo(fixture, await state2(fixture), 4)
const state5 = async (fixture: PlatformFixture): Promise<Ticket> =>
  driveTo(fixture, await state2(fixture), 5)
const blocked = (resume: 3 | 4 | 5) => async (fixture: PlatformFixture): Promise<Ticket> => {
  const base = await state2(fixture)
  const inProgress = await driveTo(fixture, base, 3)
  if (resume === 4) {
    const testing = await driveTo(fixture, inProgress, 4)
    return (await transition(fixture, testing.id, fixture.ids.reviewer, 7, testing.revision, 'hold')).ticket
  }
  if (resume === 5) {
    const verifying = await driveTo(fixture, inProgress, 5)
    return (await transition(fixture, verifying.id, fixture.ids.reviewer, 7, verifying.revision, 'hold')).ticket
  }
  return (await transition(fixture, inProgress.id, fixture.ids.planner, 7, inProgress.revision, 'hold')).ticket
}

function matrixCases(): MatrixCase[] {
  const cases: MatrixCase[] = [
    { id: 'T1', ruleId: 'T1', from: 1, target: 2, actorRole: 'PLANNER', reason: false, wrongActor: 'developer', prepare: async f => {
      const ticket = await newTicket(f)
      return f.service.assign(f.ids.planner, {
        projectId: f.projectId,
        ticketId: ticket.id,
        assigneeId: f.ids.developer,
        reviewerId: f.ids.reviewer,
        expectedRevision: ticket.revision,
        idempotencyKey: f.key.next(),
      })
    } },
    { id: 'T2', ruleId: 'T2', from: 2, target: 3, actorRole: 'DEVELOPER', reason: false, wrongActor: 'planner', prepare: state2 },
    { id: 'T3', ruleId: 'T3', from: 3, target: 4, actorRole: 'DEVELOPER', reason: false, wrongActor: 'planner', prepare: state3 },
    { id: 'T4', ruleId: 'T4', from: 3, target: 7, actorRole: 'DEVELOPER', reason: true, wrongActor: 'reviewer', prepare: state3 },
    { id: 'T5', ruleId: 'T5', from: 7, target: 3, actorRole: 'DEVELOPER', reason: false, wrongActor: 'reviewer', prepare: blocked(3) },
    { id: 'T6', ruleId: 'T6', from: 4, target: 5, actorRole: 'TESTER', reason: false, wrongActor: 'developer', prepare: state4 },
    { id: 'T7', ruleId: 'T7', from: 5, target: 6, actorRole: 'TESTER', reason: false, wrongActor: 'developer', prepare: state5 },
    { id: 'T8', ruleId: 'T8', from: 5, target: 3, actorRole: 'TESTER', reason: true, wrongActor: 'developer', prepare: state5 },
    { id: 'T9', ruleId: 'T9', from: 4, target: 7, actorRole: 'TESTER', reason: true, wrongActor: 'developer', prepare: state4 },
    { id: 'T10', ruleId: 'T10', from: 5, target: 7, actorRole: 'TESTER', reason: true, wrongActor: 'developer', prepare: state5 },
    { id: 'T11a', ruleId: 'T11', from: 7, target: 4, actorRole: 'TESTER', reason: false, wrongActor: 'developer', prepare: blocked(4) },
    { id: 'T11b', ruleId: 'T11', from: 7, target: 5, actorRole: 'TESTER', reason: false, wrongActor: 'developer', prepare: blocked(5) },
    { id: 'T12a', ruleId: 'T12', from: 1, target: 7, actorRole: 'PLANNER', reason: true, wrongActor: 'developer', prepare: state1 },
    { id: 'T12b', ruleId: 'T12', from: 2, target: 7, actorRole: 'PLANNER', reason: true, wrongActor: 'developer', prepare: state2 },
    { id: 'T12c', ruleId: 'T12', from: 3, target: 7, actorRole: 'PLANNER', reason: true, wrongActor: 'reviewer', prepare: state3 },
    { id: 'T12d', ruleId: 'T12', from: 4, target: 7, actorRole: 'PLANNER', reason: true, wrongActor: 'developer', prepare: state4 },
    { id: 'T12e', ruleId: 'T12', from: 5, target: 7, actorRole: 'PLANNER', reason: true, wrongActor: 'developer', prepare: state5 },
    { id: 'T13', ruleId: 'T13', from: 7, target: 3, actorRole: 'PLANNER', reason: false, wrongActor: 'reviewer', prepare: blocked(3) },
    { id: 'T14', ruleId: 'T14', from: 2, target: 1, actorRole: 'PLANNER', reason: true, wrongActor: 'developer', prepare: state2 },
  ]
  return cases
}

function actorFor(fixture: PlatformFixture, role: 'PLANNER' | 'DEVELOPER' | 'TESTER'): string {
  if (role === 'PLANNER') return fixture.ids.planner
  if (role === 'DEVELOPER') return fixture.ids.developer
  return fixture.ids.reviewer
}

function wrongActorFor(fixture: PlatformFixture, role: 'planner' | 'developer' | 'reviewer'): string {
  if (role === 'planner') return fixture.ids.planner
  if (role === 'developer') return fixture.ids.developer
  return fixture.ids.reviewer
}

test('golden: every allowed matrix row succeeds and writes the expected event', async () => {
  const fixture = await makeFixture()
  try {
    for (const matrixCase of matrixCases()) {
      const ticket = await matrixCase.prepare(fixture)
      assert.equal(ticket.stateCode, matrixCase.from, `${matrixCase.id}: prepared state`)
      if (matrixCase.ruleId === 'T7') await recordPassingGate(fixture, ticket)
      const result = await transition(
        fixture,
        ticket.id,
        actorFor(fixture, matrixCase.actorRole),
        matrixCase.target,
        ticket.revision,
        matrixCase.reason ? 'golden reason' : undefined,
      )
      assert.equal(result.ruleId, matrixCase.ruleId, `${matrixCase.id}: rule id`)
      assert.equal(result.ticket.stateCode, matrixCase.target, matrixCase.id)
      assert.equal(result.event.fromStateCode, matrixCase.from, matrixCase.id)
      assert.equal(result.event.toStateCode, matrixCase.target, matrixCase.id)
      assert.equal(result.event.revisionBefore, ticket.revision, matrixCase.id)
      assert.equal(result.event.revisionAfter, ticket.revision + 1, matrixCase.id)
      assert.equal(result.ticket.revision, ticket.revision + 1, matrixCase.id)
    }
  } finally {
    fixture.cleanup()
  }
})

test('golden: every wrong-role matrix case is denied with PRINCIPAL_NOT_ALLOWED', async () => {
  const fixture = await makeFixture()
  try {
    for (const matrixCase of matrixCases()) {
      const ticket = await matrixCase.prepare(fixture)
      if (matrixCase.ruleId === 'T7') await recordPassingGate(fixture, ticket)
      const before = await refresh(fixture, ticket.id)
      const eventsBefore = await fixture.service.listEvents(fixture.ids.pm, {
        projectId: fixture.projectId,
        ticketId: ticket.id,
        limit: 500,
      })
      await expectIssuesError(
        transition(
          fixture,
          ticket.id,
          wrongActorFor(fixture, matrixCase.wrongActor),
          matrixCase.target,
          ticket.revision,
          'deny reason',
        ),
        'PRINCIPAL_NOT_ALLOWED',
      )
      const after = await refresh(fixture, ticket.id)
      assert.equal(after.revision, before.revision, `${matrixCase.id}: no revision bump`)
      assert.equal(after.stateCode, before.stateCode, `${matrixCase.id}: no state change`)
      const eventsAfter = await fixture.service.listEvents(fixture.ids.pm, {
        projectId: fixture.projectId,
        ticketId: ticket.id,
        limit: 500,
      })
      assert.equal(eventsAfter.items.length, eventsBefore.items.length, `${matrixCase.id}: no event`)
    }
  } finally {
    fixture.cleanup()
  }
})

test('matrix miss, precondition failures and missing reasons fail closed', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await readyTicket(fixture)
    await expectIssuesError(
      transition(fixture, ticket.id, fixture.ids.developer, 4, ticket.revision),
      'TRANSITION_NOT_ALLOWED',
    )
    const fresh = await newTicket(fixture)
    await expectIssuesError(
      transition(fixture, fresh.id, fixture.ids.planner, 2, fresh.revision),
      'PRECONDITION_FAILED',
    )
    const current = await refresh(fixture, ticket.id)
    await expectIssuesError(
      transition(fixture, current.id, fixture.ids.planner, 7, current.revision),
      'REASON_REQUIRED',
    )
    const blockedTicket = (await transition(fixture, current.id, fixture.ids.planner, 7, current.revision, 'hold')).ticket
    await expectIssuesError(
      transition(fixture, blockedTicket.id, fixture.ids.planner, 3, blockedTicket.revision),
      'PRINCIPAL_NOT_ALLOWED',
    )
    const testing = await driveTo(fixture, await readyTicket(fixture), 4)
    await expectIssuesError(
      transition(fixture, testing.id, fixture.ids.reviewer, 7, testing.revision),
      'REASON_REQUIRED',
    )
  } finally {
    fixture.cleanup()
  }
})

test('non-member reads/writes are PROJECT_FORBIDDEN and never leak tickets', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await newTicket(fixture)
    await expectIssuesError(
      fixture.service.getTicket(fixture.ids.outsider, {
        projectId: fixture.projectId,
        idOrKey: ticket.id,
      }),
      'PROJECT_FORBIDDEN',
    )
    await expectIssuesError(
      fixture.service.createTicket(fixture.ids.outsider, {
        projectId: fixture.projectId,
        title: 'nope',
        idempotencyKey: fixture.key.next(),
      }),
      'PROJECT_FORBIDDEN',
    )
    await expectIssuesError(
      fixture.service.listTickets(fixture.ids.outsider, { projectId: fixture.projectId }),
      'PROJECT_FORBIDDEN',
    )
    await expectIssuesError(
      fixture.service.getProject(fixture.ids.outsider, fixture.projectId),
      'PROJECT_FORBIDDEN',
    )
  } finally {
    fixture.cleanup()
  }
})
