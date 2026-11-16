import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addEvidenceFile,
  assignPrincipals,
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

async function ticketInState(
  fixture: PlatformFixture,
  target: number,
  seed: Parameters<typeof newTicket>[1] = {},
  actors?: { assignee?: string; reviewer?: string },
): Promise<Ticket> {
  const ticket = await newTicket(fixture, seed)
  return driveTo(fixture, ticket, target, actors)
}

/* ------------------------------------------------------------------ */
/* create + validation                                                 */
/* ------------------------------------------------------------------ */

test('create: validation, P0 gating, agent cannot set requires_human', async () => {
  const fixture = await makeFixture()
  try {
    await expectIssuesError(
      fixture.service.createTicket(fixture.ids.planner, {
        projectId: fixture.projectId,
        title: '',
        idempotencyKey: fixture.key.next(),
      }),
      'VALIDATION_FAILED',
    )
    await expectIssuesError(
      fixture.service.createTicket(fixture.ids.planner, {
        projectId: fixture.projectId,
        title: 'nul\u0000title',
        idempotencyKey: fixture.key.next(),
      }),
      'VALIDATION_FAILED',
    )
    await expectIssuesError(
      fixture.service.createTicket(fixture.ids.planner, {
        projectId: fixture.projectId,
        title: 'bad label',
        labels: ['Not Kebab'],
        idempotencyKey: fixture.key.next(),
      }),
      'VALIDATION_FAILED',
    )
    await expectIssuesError(
      fixture.service.createTicket(fixture.ids.planner, {
        projectId: fixture.projectId,
        title: 'p0 without label',
        priority: 0,
        idempotencyKey: fixture.key.next(),
      }),
      'VALIDATION_FAILED',
    )
    const p0 = await newTicket(fixture, { priority: 0, labels: ['bug'] })
    assert.equal(p0.priority, 0)
    assert.equal(p0.requiresHuman, true, 'P0 is coerced to requires_human=1')
    assert.equal(p0.stateCode, 1)

    await expectIssuesError(
      fixture.service.createTicket(fixture.ids.planner, {
        projectId: fixture.projectId,
        title: 'agent flag',
        requiresHuman: true,
        idempotencyKey: fixture.key.next(),
      }),
      'HUMAN_ONLY_FIELD',
    )
    const humanFlagged = await fixture.service.createTicket(fixture.ids.pm, {
      projectId: fixture.projectId,
      title: 'human flag',
      requiresHuman: true,
      idempotencyKey: fixture.key.next(),
    })
    assert.equal(humanFlagged.requiresHuman, true)
  } finally {
    fixture.cleanup()
  }
})

test('assign/T1: reviewer independence, qualification and assignee checks', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await newTicket(fixture)
    assert.equal(ticket.stateCode, 1)
    await expectIssuesError(
      transition(fixture, ticket.id, fixture.ids.planner, 2, ticket.revision),
      'PRECONDITION_FAILED',
    )
    const assigned = await assignPrincipals(fixture, ticket, fixture.ids.developer, fixture.ids.reviewer)
    assert.equal(assigned.assigneeId, fixture.ids.developer)
    await expectIssuesError(
      fixture.service.assign(fixture.ids.planner, {
        projectId: fixture.projectId,
        ticketId: ticket.id,
        assigneeId: fixture.ids.outsider,
        expectedRevision: assigned.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'PRINCIPAL_NOT_ALLOWED',
    )
    await expectIssuesError(
      fixture.service.assign(fixture.ids.planner, {
        projectId: fixture.projectId,
        ticketId: ticket.id,
        assigneeId: fixture.ids.reviewer,
        reviewerId: fixture.ids.reviewer,
        expectedRevision: assigned.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'REVIEWER_NOT_INDEPENDENT',
    )
    await expectIssuesError(
      fixture.service.assign(fixture.ids.planner, {
        projectId: fixture.projectId,
        ticketId: ticket.id,
        reviewerId: fixture.ids.developer2,
        expectedRevision: assigned.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'REVIEWER_NOT_QUALIFIED',
    )
    await expectIssuesError(
      fixture.service.assign(fixture.ids.developer, {
        projectId: fixture.projectId,
        ticketId: ticket.id,
        reviewerId: fixture.ids.reviewer2,
        expectedRevision: assigned.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'PRINCIPAL_NOT_ALLOWED',
    )
    const todo = await transition(fixture, assigned.id, fixture.ids.planner, 2, assigned.revision)
    assert.equal(todo.ruleId, 'T1')
  } finally {
    fixture.cleanup()
  }
})

test('T3 requires a resolved reviewer and a summary evidence row when policy says summary', async () => {
  const fixture = await makeFixture({ evidenceRequired: 'summary' })
  try {
    const ticket = await newTicket(fixture)
    const assigned = await fixture.service.assign(fixture.ids.planner, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      assigneeId: fixture.ids.developer,
      expectedRevision: ticket.revision,
      idempotencyKey: fixture.key.next(),
    })
    const todo = (await transition(fixture, assigned.id, fixture.ids.planner, 2, assigned.revision)).ticket
    const inProgress = (await transition(fixture, todo.id, fixture.ids.developer, 3, todo.revision)).ticket
    await expectIssuesError(
      transition(fixture, inProgress.id, fixture.ids.developer, 4, inProgress.revision),
      'REVIEWER_UNASSIGNED',
    )
    const withReviewer = await fixture.service.assign(fixture.ids.planner, {
      projectId: fixture.projectId,
      ticketId: inProgress.id,
      reviewerId: fixture.ids.reviewer,
      expectedRevision: inProgress.revision,
      idempotencyKey: fixture.key.next(),
    })
    await expectIssuesError(
      transition(fixture, withReviewer.id, fixture.ids.developer, 4, withReviewer.revision),
      'EVIDENCE_REQUIRED',
    )
    await addEvidenceFile(fixture, fixture.ids.developer, withReviewer.id, 'report', 'build-report.txt')
    await expectIssuesError(
      transition(fixture, withReviewer.id, fixture.ids.developer, 4, withReviewer.revision),
      'EVIDENCE_REQUIRED',
    )
    await addEvidenceFile(fixture, fixture.ids.developer, withReviewer.id, 'summary', 'summary.txt')
    const testing = await transition(fixture, withReviewer.id, fixture.ids.developer, 4, withReviewer.revision)
    assert.equal(testing.ruleId, 'T3')
    assert.equal(testing.event.payload['reviewerId'], fixture.ids.reviewer)
    assert.equal(testing.event.payload['freezeRevision'], withReviewer.revision + 1)
  } finally {
    fixture.cleanup()
  }
})

/* ------------------------------------------------------------------ */
/* assign / reassign / freeze                                          */
/* ------------------------------------------------------------------ */

test('reviewer/assignee freeze: assign after TESTING is REVIEWER_FROZEN, reassign invalidates evidence', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await ticketInState(fixture, 5)
    assert.equal(ticket.stateCode, 5)
    await expectIssuesError(
      fixture.service.assign(fixture.ids.planner, {
        projectId: fixture.projectId,
        ticketId: ticket.id,
        assigneeId: fixture.ids.developer2,
        expectedRevision: ticket.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'REVIEWER_FROZEN',
    )
    await addEvidenceFile(fixture, fixture.ids.developer, ticket.id, 'report', 'report-after-testing.txt')
    const before = await refresh(fixture, ticket.id)
    const reassigned = await fixture.service.reassign(fixture.ids.planner, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      assigneeId: fixture.ids.developer2,
      reviewerId: fixture.ids.reviewer2,
      reason: 'reviewer independence reset',
      expectedRevision: before.revision,
      idempotencyKey: fixture.key.next(),
    })
    assert.equal(reassigned.stateCode, 3)
    assert.equal(reassigned.assigneeId, fixture.ids.developer2)
    assert.equal(reassigned.reviewerId, fixture.ids.reviewer2)
    const events = await fixture.service.listEvents(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      limit: 500,
    })
    const types = events.items.map(event => event.type)
    assert.ok(types.includes('ticket.reassigned'))
    assert.ok(types.includes('ticket.evidence_invalidated'))
    const invalidated = events.items.find(event => event.type === 'ticket.evidence_invalidated')
    assert.ok(invalidated)
    assert.ok(Array.isArray(invalidated.payload['evidenceIds']))
    assert.ok((invalidated.payload['evidenceIds'] as string[]).length >= 1)
    assert.ok(typeof invalidated.payload['invalidatedAt'] === 'number')

    const done = await driveTo(fixture, reassigned, 6, { developer: fixture.ids.developer2, reviewer: fixture.ids.reviewer2 })
    assert.equal(done.stateCode, 6)
    await expectIssuesError(
      fixture.service.reassign(fixture.ids.planner, {
        projectId: fixture.projectId,
        ticketId: done.id,
        assigneeId: fixture.ids.developer,
        reason: 'not allowed terminal',
        expectedRevision: done.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'TRANSITION_NOT_ALLOWED',
    )
  } finally {
    fixture.cleanup()
  }
})

test('reassign before TESTING is ASSIGN_NOT_REASSIGN; reason is required', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await readyTicket(fixture)
    await expectIssuesError(
      fixture.service.reassign(fixture.ids.planner, {
        projectId: fixture.projectId,
        ticketId: ticket.id,
        assigneeId: fixture.ids.developer2,
        reason: 'too early',
        expectedRevision: ticket.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'ASSIGN_NOT_REASSIGN',
    )
    const inTesting = await ticketInState(fixture, 4)
    await expectIssuesError(
      fixture.service.reassign(fixture.ids.planner, {
        projectId: fixture.projectId,
        ticketId: inTesting.id,
        reviewerId: fixture.ids.reviewer2,
        reason: '',
        expectedRevision: inTesting.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'VALIDATION_FAILED',
    )
  } finally {
    fixture.cleanup()
  }
})

/* ------------------------------------------------------------------ */
/* requires_human governance and terminal actions                      */
/* ------------------------------------------------------------------ */

test('governance is human-only and P0/P1 cannot be cleared', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await newTicket(fixture, { priority: 0, labels: ['bug'] })
    await expectIssuesError(
      fixture.service.governance(fixture.ids.planner, {
        projectId: fixture.projectId,
        ticketId: ticket.id,
        newValue: 0,
        reason: 'agent tries',
        expectedRevision: ticket.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'HUMAN_ONLY_FIELD',
    )
    await expectIssuesError(
      fixture.service.governance(fixture.ids.pm, {
        projectId: fixture.projectId,
        ticketId: ticket.id,
        newValue: 0,
        reason: 'human tries',
        expectedRevision: ticket.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'PRIORITY_REQUIRES_HUMAN',
    )
    const normal = await newTicket(fixture)
    const flagged = await fixture.service.governance(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: normal.id,
      newValue: 1,
      reason: 'needs review',
      expectedRevision: normal.revision,
      idempotencyKey: fixture.key.next(),
    })
    assert.equal(flagged.requiresHuman, true)
    const cleared = await fixture.service.governance(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: flagged.id,
      newValue: 0,
      reason: 'review done',
      expectedRevision: flagged.revision,
      idempotencyKey: fixture.key.next(),
    })
    assert.equal(cleared.requiresHuman, false)
    const events = await fixture.service.listEvents(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: normal.id,
      limit: 500,
    })
    assert.equal(
      events.items.filter(event => event.type === 'ticket.requires_human_changed').length,
      2,
    )
    // No update path may flip the flag.
    const sneaky = await fixture.service.updateTicket(fixture.ids.planner, {
      projectId: fixture.projectId,
      ticketId: cleared.id,
      title: 'renamed',
      requiresHuman: true,
      expectedRevision: cleared.revision,
      idempotencyKey: fixture.key.next(),
    } as never)
    assert.equal(sneaky.requiresHuman, false)
  } finally {
    fixture.cleanup()
  }
})

test('flagged tickets require a human actor for T7 and close', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await ticketInState(fixture, 5, { priority: 0, labels: ['bug'] })
    assert.equal(ticket.requiresHuman, true)
    await recordPassingGate(fixture, ticket)
    await expectIssuesError(
      transition(fixture, ticket.id, fixture.ids.reviewer, 6, ticket.revision),
      'HUMAN_APPROVAL_REQUIRED',
    )
    // Reassign reviewer to the human tester so the human can verify.
    const current = await refresh(fixture, ticket.id)
    await fixture.service.reassign(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: current.id,
      reviewerId: fixture.ids.humanTester,
      reason: 'human verification required',
      expectedRevision: current.revision,
      idempotencyKey: fixture.key.next(),
    })
    const humanTicket = await driveTo(fixture, await refresh(fixture, ticket.id), 5, {
      reviewer: fixture.ids.humanTester,
    })
    await recordPassingGate(fixture, humanTicket)
    const done = await transition(fixture, humanTicket.id, fixture.ids.humanTester, 6, humanTicket.revision)
    assert.equal(done.ticket.stateCode, 6)

    const flagged = await newTicket(fixture, { priority: 1, labels: ['bug'] })
    await expectIssuesError(
      fixture.service.close(fixture.ids.planner, {
        projectId: fixture.projectId,
        ticketId: flagged.id,
        reason: 'agent cannot close a flagged ticket',
        expectedRevision: flagged.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'HUMAN_APPROVAL_REQUIRED',
    )
    const plain = await newTicket(fixture)
    await expectIssuesError(
      fixture.service.close(fixture.ids.developer, {
        projectId: fixture.projectId,
        ticketId: plain.id,
        reason: 'developer cannot close',
        expectedRevision: plain.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'PRINCIPAL_NOT_ALLOWED',
    )
  } finally {
    fixture.cleanup()
  }
})

test('close: reason required, only CANCELLED, human override allowed, DONE is never writable', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await ticketInState(fixture, 4)
    await expectIssuesError(
      fixture.service.close(fixture.ids.pm, {
        projectId: fixture.projectId,
        ticketId: ticket.id,
        reason: '',
        expectedRevision: ticket.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'VALIDATION_FAILED',
    )
    const closed = await fixture.service.close(fixture.ids.humanTester, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      reason: 'human override close',
      expectedRevision: ticket.revision,
      idempotencyKey: fixture.key.next(),
    })
    assert.equal(closed.ticket.stateCode, 8)
    assert.equal(closed.event.type, 'ticket.closed')
    assert.equal(closed.event.toStateCode, 8)
    await expectIssuesError(
      fixture.service.close(fixture.ids.pm, {
        projectId: fixture.projectId,
        ticketId: closed.ticket.id,
        reason: 'again',
        expectedRevision: closed.ticket.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'TRANSITION_NOT_ALLOWED',
    )
    const done = await ticketInState(fixture, 6)
    await expectIssuesError(
      fixture.service.close(fixture.ids.pm, {
        projectId: fixture.projectId,
        ticketId: done.id,
        reason: 'close done?',
        expectedRevision: done.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'TRANSITION_NOT_ALLOWED',
    )
  } finally {
    fixture.cleanup()
  }
})

test('archive: terminal-only, PLANNER-only, idempotent, archived tickets are read-only', async () => {
  const fixture = await makeFixture()
  try {
    const open = await readyTicket(fixture)
    await expectIssuesError(
      fixture.service.archive(fixture.ids.planner, {
        projectId: fixture.projectId,
        ticketId: open.id,
        expectedRevision: open.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'TRANSITION_NOT_ALLOWED',
    )
    const done = await ticketInState(fixture, 6)
    await expectIssuesError(
      fixture.service.archive(fixture.ids.developer, {
        projectId: fixture.projectId,
        ticketId: done.id,
        expectedRevision: done.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'PRINCIPAL_NOT_ALLOWED',
    )
    const archived = await fixture.service.archive(fixture.ids.planner, {
      projectId: fixture.projectId,
      ticketId: done.id,
      reason: 'kept for history',
      expectedRevision: done.revision,
      idempotencyKey: fixture.key.next(),
    })
    assert.ok(archived.ticket.archivedAt !== null)
    assert.equal(archived.event?.type, 'ticket.archived')
    const again = await fixture.service.archive(fixture.ids.planner, {
      projectId: fixture.projectId,
      ticketId: done.id,
      expectedRevision: archived.ticket.revision,
      idempotencyKey: fixture.key.next(),
    })
    assert.equal(again.event, null, 'second archive is a no-op')
    await expectIssuesError(
      transition(fixture, done.id, fixture.ids.planner, 2, archived.ticket.revision),
      'TRANSITION_NOT_ALLOWED',
    )
    await expectIssuesError(
      fixture.service.updateTicket(fixture.ids.planner, {
        projectId: fixture.projectId,
        ticketId: done.id,
        title: 'edit archived',
        expectedRevision: archived.ticket.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'TRANSITION_NOT_ALLOWED',
    )
    const listed = await fixture.service.listTickets(fixture.ids.pm, {
      projectId: fixture.projectId,
    })
    assert.ok(listed.items.every(item => item.id !== done.id), 'archived hidden from default list')
    const withArchived = await fixture.service.listTickets(fixture.ids.pm, {
      projectId: fixture.projectId,
      includeArchived: true,
    })
    assert.ok(withArchived.items.some(item => item.id === done.id))
  } finally {
    fixture.cleanup()
  }
})

/* ------------------------------------------------------------------ */
/* update permissions and frozen body                                  */
/* ------------------------------------------------------------------ */

test('update: permission matrix, changed[] event, body frozen after TESTING', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await readyTicket(fixture)
    const updated = await fixture.service.updateTicket(fixture.ids.developer, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      title: 'dev edited title',
      priority: 1,
      expectedRevision: ticket.revision,
      idempotencyKey: fixture.key.next(),
    })
    assert.equal(updated.title, 'dev edited title')
    assert.equal(updated.requiresHuman, true, 'P1 forces requires_human')
    const events = await fixture.service.listEvents(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      limit: 500,
    })
    const updateEvent = events.items.find(event => event.type === 'ticket.updated')
    assert.ok(updateEvent)
    const changed = updateEvent.payload['changed'] as Array<{ field: string }>
    assert.ok(changed.some(item => item.field === 'title'))
    assert.ok(changed.some(item => item.field === 'priority'))
    assert.ok(changed.some(item => item.field === 'requiresHuman'))

    await expectIssuesError(
      fixture.service.updateTicket(fixture.ids.developer2, {
        projectId: fixture.projectId,
        ticketId: ticket.id,
        title: 'not my ticket',
        expectedRevision: updated.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'PRINCIPAL_NOT_ALLOWED',
    )
    const testing = await ticketInState(fixture, 4)
    await expectIssuesError(
      fixture.service.updateTicket(fixture.ids.planner, {
        projectId: fixture.projectId,
        ticketId: testing.id,
        body: 'rewrite body mid-verification',
        expectedRevision: testing.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'EVIDENCE_INVALIDATED',
    )
    const renamed = await fixture.service.updateTicket(fixture.ids.planner, {
      projectId: fixture.projectId,
      ticketId: testing.id,
      title: 'planner may rename',
      expectedRevision: testing.revision,
      idempotencyKey: fixture.key.next(),
    })
    assert.equal(renamed.title, 'planner may rename')
    await expectIssuesError(
      fixture.service.updateTicket(fixture.ids.planner, {
        projectId: fixture.projectId,
        ticketId: testing.id,
        title: renamed.title,
        expectedRevision: renamed.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'VALIDATION_FAILED',
    )
  } finally {
    fixture.cleanup()
  }
})

/* ------------------------------------------------------------------ */
/* WIP limits                                                          */
/* ------------------------------------------------------------------ */

test('WIP: worker limit is enforced inside the transition transaction', async () => {
  const fixture = await makeFixture()
  try {
    const policy = await fixture.service.updatePolicy(fixture.ids.pm, {
      projectId: fixture.projectId,
      expectedGeneration: 1,
      policy: { wipLimitPerWorker: 1 },
      reason: 'tight WIP',
      idempotencyKey: fixture.key.next(),
    })
    assert.equal(policy.policyGeneration, 2)
    assert.equal(policy.policy.wipLimitPerWorker, 1)
    const first = await readyTicket(fixture)
    const second = await readyTicket(fixture)
    await transition(fixture, first.id, fixture.ids.developer, 3, first.revision)
    await expectIssuesError(
      transition(fixture, second.id, fixture.ids.developer, 3, second.revision),
      'WIP_LIMIT',
    )
    const current = await refresh(fixture, second.id)
    assert.equal(current.stateCode, 2)
    // Project-wide limit also gates state 3/5.
    await fixture.service.updatePolicy(fixture.ids.pm, {
      projectId: fixture.projectId,
      expectedGeneration: 2,
      policy: { wipLimitPerWorker: 8, wipLimitPerProject: 1 },
      reason: 'project cap',
      idempotencyKey: fixture.key.next(),
    })
    await expectIssuesError(
      transition(fixture, second.id, fixture.ids.developer, 3, current.revision),
      'WIP_LIMIT',
    )
  } finally {
    fixture.cleanup()
  }
})
