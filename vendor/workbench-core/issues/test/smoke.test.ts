import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  expectIssuesError,
  makeFixture,
  newTicket,
  readyTicket,
  recordPassingGate,
  refresh,
  transition,
  writeEvidence,
} from './helpers.ts'

test('smoke: memory happy path reaches DONE through a real daemon verdict', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await newTicket(fixture)
    assert.equal(ticket.stateCode, 1)
    const view = await fixture.service.getTicket(fixture.ids.planner, {
      projectId: fixture.projectId,
      idOrKey: ticket.key,
    })
    assert.equal(view.key, ticket.key)
    assert.ok(view.allowedActions.includes('create'))
    const todo = await readyTicket(fixture)
    assert.equal(todo.stateCode, 2)
    let current = await refresh(fixture, todo.id)
    current = (await transition(fixture, current.id, fixture.ids.developer, 3, current.revision)).ticket
    assert.equal(current.stateCode, 3)
    current = (await transition(fixture, current.id, fixture.ids.developer, 4, current.revision)).ticket
    assert.equal(current.stateCode, 4)
    current = (await transition(fixture, current.id, fixture.ids.reviewer, 5, current.revision)).ticket
    assert.equal(current.stateCode, 5)
    await expectIssuesError(
      fixture.service.transition(fixture.ids.reviewer, {
        projectId: fixture.projectId,
        ticketId: current.id,
        targetStateCode: 6,
        expectedRevision: current.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'GATE_RECORD_MISSING',
    )
    current = await refresh(fixture, current.id)
    await recordPassingGate(fixture, current)
    const done = await transition(fixture, current.id, fixture.ids.reviewer, 6, current.revision)
    assert.equal(done.ticket.stateCode, 6)
    assert.match(String(done.event.payload['gateRunId']), /^gate_/)
    const uri = writeEvidence(fixture, 'smoke-summary.txt', 'hello')
    assert.equal(uri, 'smoke-summary.txt')
  } finally {
    fixture.cleanup()
  }
})

test('smoke: sqlite happy path works', async () => {
  const fixture = await makeFixture({ store: 'sqlite' })
  try {
    const ticket = await newTicket(fixture)
    assert.match(ticket.key, /^TST-\d+$/)
    const events = await fixture.service.listEvents(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
    })
    assert.equal(events.items.length, 1)
    assert.equal(events.items[0]?.type, 'ticket.created')
  } finally {
    fixture.cleanup()
  }
})
