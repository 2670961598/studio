import { test } from 'node:test'
import assert from 'node:assert/strict'
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
import { IssuesError } from '../src/errors.ts'

function record(promise: Promise<unknown>): Promise<{ ok: true; value: unknown } | { ok: false; error: unknown }> {
  return promise.then(
    value => ({ ok: true as const, value }),
    error => ({ ok: false as const, error }),
  )
}

/* ------------------------------------------------------------------ */
/* CAS                                                                 */
/* ------------------------------------------------------------------ */

test('CAS: stale/missing expectedRevision is STALE_REVISION with current state/allowed', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await readyTicket(fixture)
    const error = await expectIssuesError(
      transition(fixture, ticket.id, fixture.ids.developer, 3, ticket.revision - 1),
      'STALE_REVISION',
    )
    assert.equal(error.details?.['currentRevision'], ticket.revision)
    assert.equal(error.details?.['currentStateCode'], 2)
    assert.ok(Array.isArray(error.details?.['allowedTransitions']))
    await expectSyncValidation(fixture, ticket.revision)
    const current = await refresh(fixture, ticket.id)
    assert.equal(current.revision, ticket.revision, 'no write on CAS lose')
    const first = await transition(fixture, ticket.id, fixture.ids.developer, 3, ticket.revision)
    const stale = await expectIssuesError(
      transition(fixture, ticket.id, fixture.ids.developer, 4, ticket.revision),
      'STALE_REVISION',
    )
    assert.equal(stale.details?.['currentRevision'], first.ticket.revision)
  } finally {
    fixture.cleanup()
  }
})

async function expectSyncValidation(fixture: PlatformFixture, revision: number): Promise<void> {
  const ticket = await newTicket(fixture)
  await assert.rejects(
    fixture.service.transition(fixture.ids.developer, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      targetStateCode: 3,
      expectedRevision: revision,
      idempotencyKey: fixture.key.next(),
    }),
    (error: unknown) => error instanceof IssuesError && error.code === 'STALE_REVISION',
  )
}

/* ------------------------------------------------------------------ */
/* Idempotency                                                         */
/* ------------------------------------------------------------------ */

test('idempotency: same key + same request replays the stored response and writes once', async () => {
  const fixture = await makeFixture()
  try {
    const key = fixture.key.next()
    const input = {
      projectId: fixture.projectId,
      title: 'idempotent create',
      idempotencyKey: key,
    } as const
    const first = await fixture.service.createTicket(fixture.ids.planner, input)
    const second = await fixture.service.createTicket(fixture.ids.planner, input)
    assert.equal(second.id, first.id)
    assert.deepEqual(second, first)
    const page = await fixture.service.listTickets(fixture.ids.pm, {
      projectId: fixture.projectId,
    })
    assert.equal(page.items.filter(item => item.title === 'idempotent create').length, 1)
    const events = await fixture.service.listEvents(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: first.id,
    })
    assert.equal(events.items.filter(event => event.type === 'ticket.created').length, 1)
    await expectIssuesError(
      fixture.service.createTicket(fixture.ids.planner, { ...input, title: 'different body' }),
      'IDEMPOTENCY_CONFLICT',
    )
  } finally {
    fixture.cleanup()
  }
})

test('idempotency: scope is (principal, command, key); another principal never replays', async () => {
  const fixture = await makeFixture()
  try {
    const key = fixture.key.next()
    const byPlanner = await fixture.service.createTicket(fixture.ids.planner, {
      projectId: fixture.projectId,
      title: 'planner ticket',
      idempotencyKey: key,
    })
    const byPm = await fixture.service.createTicket(fixture.ids.pm, {
      projectId: fixture.projectId,
      title: 'pm ticket',
      idempotencyKey: key,
    })
    assert.notEqual(byPm.id, byPlanner.id)
    assert.equal(byPm.title, 'pm ticket')
  } finally {
    fixture.cleanup()
  }
})

test('idempotency: transition replay is byte-identical and writes exactly one event', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await readyTicket(fixture)
    const key = fixture.key.next()
    const input = {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      targetStateCode: 3,
      expectedRevision: ticket.revision,
      idempotencyKey: key,
    } as const
    const first = await fixture.service.transition(fixture.ids.developer, input)
    const replay = await fixture.service.transition(fixture.ids.developer, input)
    assert.deepEqual(replay, first)
    const events = await fixture.service.listEvents(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      limit: 500,
    })
    assert.equal(
      events.items.filter(
        event => event.type === 'ticket.transitioned' && event.payload['ruleId'] === 'T2',
      ).length,
      1,
    )
  } finally {
    fixture.cleanup()
  }
})

/* ------------------------------------------------------------------ */
/* Concurrency: exactly-one-winner                                     */
/* ------------------------------------------------------------------ */

test('concurrency: 10 concurrent T6 on one revision → exactly one winner', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await driveTo(fixture, await readyTicket(fixture), 4)
    const attempts = await Promise.all(
      Array.from({ length: 10 }, () =>
        record(
          transition(fixture, ticket.id, fixture.ids.reviewer, 5, ticket.revision),
        ),
      ),
    )
    const winners = attempts.filter(item => item.ok)
    assert.equal(winners.length, 1)
    for (const loser of attempts.filter(item => !item.ok)) {
      assert.ok(loser.ok === false && loser.error instanceof IssuesError)
      assert.equal((loser.error as IssuesError).code, 'STALE_REVISION')
    }
    const current = await refresh(fixture, ticket.id)
    assert.equal(current.stateCode, 5)
    const events = await fixture.service.listEvents(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      limit: 500,
    })
    assert.equal(events.items.filter(event => event.type === 'ticket.transitioned').length, 4)
  } finally {
    fixture.cleanup()
  }
})

test('concurrency: 20 identical idempotency keys → one event and identical responses', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await readyTicket(fixture)
    const key = fixture.key.next()
    const input = {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      targetStateCode: 3,
      expectedRevision: ticket.revision,
      idempotencyKey: key,
    } as const
    const results = await Promise.all(
      Array.from({ length: 20 }, () => fixture.service.transition(fixture.ids.developer, input)),
    )
    const eventIds = new Set(results.map(result => result.event.id))
    assert.equal(eventIds.size, 1)
    for (const result of results.slice(1)) assert.deepEqual(result, results[0])
    const current = await refresh(fixture, ticket.id)
    assert.equal(current.stateCode, 3)
  } finally {
    fixture.cleanup()
  }
})

test('concurrency: concurrent reopen and archive on the same revision admit one winner', async () => {
  const fixture = await makeFixture()
  try {
    const done = await driveTo(fixture, await readyTicket(fixture), 6)
    const reopenAttempt = record(
      fixture.service.reopen(fixture.ids.planner, {
        projectId: fixture.projectId,
        ticketId: done.id,
        reason: 'reopen race',
        expectedRevision: done.revision,
        idempotencyKey: fixture.key.next(),
      }),
    )
    const archiveAttempt = record(
      fixture.service.archive(fixture.ids.planner, {
        projectId: fixture.projectId,
        ticketId: done.id,
        expectedRevision: done.revision,
        idempotencyKey: fixture.key.next(),
      }),
    )
    const [reopenResult, archiveResult] = await Promise.all([reopenAttempt, archiveAttempt])
    assert.equal([reopenResult, archiveResult].filter(item => item.ok).length, 1)
    const loser = [reopenResult, archiveResult].find(item => !item.ok)
    assert.ok(loser && loser.ok === false && loser.error instanceof IssuesError)
    assert.equal((loser.error as IssuesError).code, 'STALE_REVISION')
    const current = await refresh(fixture, done.id)
    if (reopenResult.ok) {
      assert.equal(current.stateCode, 2)
      assert.equal(current.reopenCount, 1)
    } else {
      assert.ok(current.archivedAt !== null)
    }
  } finally {
    fixture.cleanup()
  }
})

test('concurrency: two updates with the same expectedRevision → one winner', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await readyTicket(fixture)
    const results = await Promise.all([
      record(
        fixture.service.updateTicket(fixture.ids.planner, {
          projectId: fixture.projectId,
          ticketId: ticket.id,
          title: 'first title',
          expectedRevision: ticket.revision,
          idempotencyKey: fixture.key.next(),
        }),
      ),
      record(
        fixture.service.updateTicket(fixture.ids.planner, {
          projectId: fixture.projectId,
          ticketId: ticket.id,
          title: 'second title',
          expectedRevision: ticket.revision,
          idempotencyKey: fixture.key.next(),
        }),
      ),
    ])
    assert.equal(results.filter(item => item.ok).length, 1)
    const current = await refresh(fixture, ticket.id)
    const winner = results.find(item => item.ok)
    assert.ok(winner && winner.ok)
    assert.equal(current.title, (winner.value as { title: string }).title)
  } finally {
    fixture.cleanup()
  }
})

test('event hash chain: per-ticket chain starts at GENESIS and links prev→entry', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await driveTo(fixture, await readyTicket(fixture), 5)
    await recordPassingGate(fixture, ticket)
    const events = await fixture.service.listEvents(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      limit: 500,
    })
    assert.ok(events.items.length >= 5)
    assert.equal(events.items[0]?.prevHash, 'GENESIS')
    for (let index = 1; index < events.items.length; index += 1) {
      assert.equal(
        events.items[index]?.prevHash,
        events.items[index - 1]?.entryHash,
        'hash chain link',
      )
    }
    const projectEvents = await fixture.service.listProjectEvents(fixture.ids.pm, {
      projectId: fixture.projectId,
      limit: 500,
    })
    assert.ok(projectEvents.items.length >= events.items.length)
    const seqs = projectEvents.items.map(event => event.seq)
    assert.deepEqual([...seqs].sort((a, b) => a - b), seqs, 'project stream ordered by seq')
  } finally {
    fixture.cleanup()
  }
})
