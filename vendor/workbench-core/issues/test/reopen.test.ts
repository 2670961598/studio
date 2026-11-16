import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addEvidenceFile,
  driveTo,
  expectIssuesError,
  makeFixture,
  newTicket,
  readyTicket,
  recordPassingGate,
  refresh,
  transition,
} from './helpers.ts'

test('reopen T15: DONE→TODO resets attempt facts and appends ticket.reopened', async () => {
  const fixture = await makeFixture()
  try {
    const done = await driveTo(fixture, await readyTicket(fixture), 6)
    assert.equal(done.stateCode, 6)
    const reopened = await fixture.service.reopen(fixture.ids.planner, {
      projectId: fixture.projectId,
      ticketId: done.id,
      reason: 'customer found a regression',
      expectedRevision: done.revision,
      idempotencyKey: fixture.key.next(),
    })
    assert.equal(reopened.ruleId, 'T15')
    assert.equal(reopened.ticket.stateCode, 2)
    assert.equal(reopened.ticket.doneAt, null)
    assert.equal(reopened.ticket.reopenCount, 1)
    assert.ok(reopened.ticket.lastReopenedAt !== null)
    assert.equal(reopened.ticket.lastReopenReason, 'customer found a regression')
    assert.equal(reopened.ticket.revision, done.revision + 1)
    assert.equal(reopened.event.type, 'ticket.reopened')
    assert.equal(reopened.event.payload['fromStateCode'], 6)
    assert.equal(reopened.event.payload['toStateCode'], 2)
    assert.equal(reopened.event.payload['reopenCount'], 1)
    assert.equal(reopened.event.payload['previousDoneAt'], done.doneAt)
    const events = await fixture.service.listEvents(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: done.id,
      limit: 500,
    })
    assert.equal(events.items.filter(event => event.type === 'ticket.reopened').length, 1)
    // Append-only: prior events and comments are never rewritten.
    assert.equal(events.items[0]?.type, 'ticket.created')
  } finally {
    fixture.cleanup()
  }
})

test('reopen T15 from CANCELLED and T16 DONE→IN_PROGRESS', async () => {
  const fixture = await makeFixture()
  try {
    const testing = await driveTo(fixture, await readyTicket(fixture), 4)
    const cancelled = await fixture.service.close(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: testing.id,
      reason: 'no longer needed',
      expectedRevision: testing.revision,
      idempotencyKey: fixture.key.next(),
    })
    const reopened = await fixture.service.reopen(fixture.ids.planner, {
      projectId: fixture.projectId,
      ticketId: cancelled.ticket.id,
      reason: 'actually needed',
      expectedRevision: cancelled.ticket.revision,
      idempotencyKey: fixture.key.next(),
    })
    assert.equal(reopened.ruleId, 'T15')
    assert.equal(reopened.ticket.stateCode, 2)
    assert.equal(reopened.ticket.reopenCount, 1)

    const done = await driveTo(fixture, await readyTicket(fixture), 6)
    const backToWork = await fixture.service.reopen(fixture.ids.planner, {
      projectId: fixture.projectId,
      ticketId: done.id,
      targetStateCode: 3,
      reason: 'continue the fix',
      expectedRevision: done.revision,
      idempotencyKey: fixture.key.next(),
    })
    assert.equal(backToWork.ruleId, 'T16')
    assert.equal(backToWork.ticket.stateCode, 3)
    // A reopened ticket re-runs T3 (new freeze anchor) and the gate; TESTING is not a target.
    const fresh = await transition(
      fixture,
      backToWork.ticket.id,
      fixture.ids.developer,
      4,
      backToWork.ticket.revision,
    )
    assert.equal(fresh.ruleId, 'T3')
    const anchor = fresh.event.payload['freezeRevision']
    assert.equal(anchor, backToWork.ticket.revision + 1)
  } finally {
    fixture.cleanup()
  }
})

test('reopen: non-terminal, no-op, undeclared targets and missing reason fail closed', async () => {
  const fixture = await makeFixture()
  try {
    const open = await readyTicket(fixture)
    await expectIssuesError(
      fixture.service.reopen(fixture.ids.planner, {
        projectId: fixture.projectId,
        ticketId: open.id,
        reason: 'not terminal',
        expectedRevision: open.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'TRANSITION_NOT_ALLOWED',
    )
    const done = await driveTo(fixture, await readyTicket(fixture), 6)
    await expectIssuesError(
      fixture.service.reopen(fixture.ids.planner, {
        projectId: fixture.projectId,
        ticketId: done.id,
        targetStateCode: 6,
        reason: 'done to done',
        expectedRevision: done.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'NOOP_TRANSITION',
    )
    for (const badTarget of [4, 5, 1, 7]) {
      await expectIssuesError(
        fixture.service.reopen(fixture.ids.planner, {
          projectId: fixture.projectId,
          ticketId: done.id,
          targetStateCode: badTarget,
          reason: 'bad target',
          expectedRevision: done.revision,
          idempotencyKey: fixture.key.next(),
        }),
        'TARGET_NOT_REOPENABLE',
      )
    }
    await expectIssuesError(
      fixture.service.reopen(fixture.ids.planner, {
        projectId: fixture.projectId,
        ticketId: done.id,
        reason: '',
        expectedRevision: done.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'VALIDATION_FAILED',
    )
    const cancelled = await fixture.service.close(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: (await newTicket(fixture)).id,
      reason: 'cancel',
      expectedRevision: 1,
      idempotencyKey: fixture.key.next(),
    })
    await expectIssuesError(
      fixture.service.reopen(fixture.ids.planner, {
        projectId: fixture.projectId,
        ticketId: cancelled.ticket.id,
        targetStateCode: 3,
        reason: 'cancelled cannot go to in-progress',
        expectedRevision: cancelled.ticket.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'TARGET_NOT_REOPENABLE',
    )
  } finally {
    fixture.cleanup()
  }
})

test('reopen grant, self-reopen guard and requires_human human rule', async () => {
  const fixture = await makeFixture()
  try {
    const done = await driveTo(fixture, await readyTicket(fixture), 6)
    await expectIssuesError(
      fixture.service.reopen(fixture.ids.developer, {
        projectId: fixture.projectId,
        ticketId: done.id,
        reason: 'developer has no reopen grant',
        expectedRevision: done.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'PRINCIPAL_NOT_ALLOWED',
    )
    // Grant PLANNER to the ticket's assignee: the self-reopen guard still denies.
    await fixture.service.grantMembership(fixture.ids.pm, {
      projectId: fixture.projectId,
      principalId: fixture.ids.developer,
      roles: ['PLANNER'],
      reason: 'promote developer',
      idempotencyKey: fixture.key.next(),
    })
    await expectIssuesError(
      fixture.service.reopen(fixture.ids.developer, {
        projectId: fixture.projectId,
        ticketId: done.id,
        reason: 'self unblock attempt',
        expectedRevision: done.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'SELF_REOPEN_FORBIDDEN',
    )
    // Flagg a ticket (P1) and complete it through the human tester.
    const flagged = await driveTo(
      fixture,
      await newTicket(fixture, { priority: 1, labels: ['bug'] }),
      6,
      { reviewer: fixture.ids.humanTester },
    )
    await expectIssuesError(
      fixture.service.reopen(fixture.ids.planner, {
        projectId: fixture.projectId,
        ticketId: flagged.id,
        reason: 'agent reopen flagged',
        expectedRevision: flagged.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'HUMAN_APPROVAL_REQUIRED',
    )
    const humanReopen = await fixture.service.reopen(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: flagged.id,
      reason: 'human reopen',
      expectedRevision: flagged.revision,
      idempotencyKey: fixture.key.next(),
    })
    assert.equal(humanReopen.ticket.stateCode, 2)
  } finally {
    fixture.cleanup()
  }
})

test('reopen starts a new attempt: prior evidence and verdict can never satisfy the new gate', async () => {
  const fixture = await makeFixture({ evidenceRequired: 'summary' })
  try {
    const ticket = await readyTicket(fixture)
    let current = await driveTo(fixture, ticket, 3)
    current = await driveTo(fixture, current, 4)
    current = await driveTo(fixture, current, 5)
    const firstGate = await recordPassingGate(fixture, current)
    assert.equal(firstGate.coveredEvidenceIds.length, 1)
    const done = await driveTo(fixture, current, 6)
    const reopened = await fixture.service.reopen(fixture.ids.planner, {
      projectId: fixture.projectId,
      ticketId: done.id,
      reason: 'rework required',
      expectedRevision: done.revision,
      idempotencyKey: fixture.key.next(),
    })
    let secondAttempt = reopened.ticket
    secondAttempt = (await transition(fixture, secondAttempt.id, fixture.ids.developer, 3, secondAttempt.revision)).ticket
    await addEvidenceFile(fixture, fixture.ids.developer, secondAttempt.id, 'summary', 'attempt2-summary.txt')
    secondAttempt = (await transition(fixture, secondAttempt.id, fixture.ids.developer, 4, secondAttempt.revision)).ticket
    secondAttempt = (await transition(fixture, secondAttempt.id, fixture.ids.reviewer, 5, secondAttempt.revision)).ticket
    // The old verdict is at an older revision/reopen boundary → stale, never reusable.
    await expectIssuesError(
      transition(fixture, secondAttempt.id, fixture.ids.reviewer, 6, secondAttempt.revision),
      'GATE_EPOCH_STALE',
    )
    const secondGate = await recordPassingGate(fixture, secondAttempt)
    assert.equal(secondGate.coveredEvidenceIds.length, 1)
    assert.notEqual(secondGate.coveredEvidenceIds[0], firstGate.coveredEvidenceIds[0])
    const doneAgain = await transition(fixture, secondAttempt.id, fixture.ids.reviewer, 6, secondAttempt.revision)
    assert.equal(doneAgain.ticket.stateCode, 6)
    const refreshed = await refresh(fixture, secondAttempt.id)
    assert.equal(refreshed.reopenCount, 1)
  } finally {
    fixture.cleanup()
  }
})

test('reopen concurrent with a transition still has exactly one winner (CAS)', async () => {
  const fixture = await makeFixture()
  try {
    const done = await driveTo(fixture, await readyTicket(fixture), 6)
    const outcomes = await Promise.allSettled([
      fixture.service.reopen(fixture.ids.planner, {
        projectId: fixture.projectId,
        ticketId: done.id,
        reason: 'race',
        expectedRevision: done.revision,
        idempotencyKey: fixture.key.next(),
      }),
      fixture.service.archive(fixture.ids.planner, {
        projectId: fixture.projectId,
        ticketId: done.id,
        expectedRevision: done.revision,
        idempotencyKey: fixture.key.next(),
      }),
    ])
    assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1)
  } finally {
    fixture.cleanup()
  }
})
