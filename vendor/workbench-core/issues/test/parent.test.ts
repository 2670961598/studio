import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertDepthInvariant,
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

async function childOf(fixture: PlatformFixture, parent: Ticket, title = 'child'): Promise<Ticket> {
  return newTicket(fixture, { parentId: parent.id, title })
}

async function reparent(
  fixture: PlatformFixture,
  ticket: Ticket,
  newParentId: string | null,
  expectedRevision = ticket.revision,
): Promise<Ticket> {
  return fixture.service.reparent(fixture.ids.planner, {
    projectId: fixture.projectId,
    ticketId: ticket.id,
    newParentId,
    reason: 'reparent for test',
    ...(newParentId === ticket.id ? {} : {}),
    expectedRevision,
    idempotencyKey: fixture.key.next(),
  })
}

test('create with parentId: same project, depth <= 3', async () => {
  const fixture = await makeFixture()
  try {
    const a = await newTicket(fixture, { title: 'A' })
    const b = await childOf(fixture, a, 'B')
    const c = await childOf(fixture, b, 'C')
    const d = await childOf(fixture, c, 'D')
    assert.equal(d.parentId, c.id)
    await expectIssuesError(
      fixture.service.createTicket(fixture.ids.planner, {
        projectId: fixture.projectId,
        title: 'E too deep',
        parentId: d.id,
        idempotencyKey: fixture.key.next(),
      }),
      'PARENT_DEPTH_EXCEEDED',
    )
    await expectIssuesError(
      fixture.service.createTicket(fixture.ids.planner, {
        projectId: fixture.projectId,
        title: 'missing parent',
        parentId: 'tkt_missing',
        idempotencyKey: fixture.key.next(),
      }),
      'PARENT_NOT_FOUND',
    )
    const project2 = await fixture.service.createProject(fixture.ids.admin, {
      keyPrefix: 'OTH',
      name: 'Other project',
    })
    await fixture.service.grantMembership(fixture.ids.admin, {
      projectId: project2.id,
      principalId: fixture.ids.pm,
      roles: ['PLANNER'],
      reason: 'test grant',
      idempotencyKey: fixture.key.next(),
    })
    const foreign = await fixture.service.createTicket(fixture.ids.pm, {
      projectId: project2.id,
      title: 'foreign parent',
      idempotencyKey: fixture.key.next(),
    })
    await expectIssuesError(
      fixture.service.createTicket(fixture.ids.planner, {
        projectId: fixture.projectId,
        title: 'cross-project parent',
        parentId: foreign.id,
        idempotencyKey: fixture.key.next(),
      }),
      'PARENT_NOT_SAME_PROJECT',
    )
  } finally {
    fixture.cleanup()
  }
})

test('reparent: PLANNER-only, reason, all five checks, event and revision bump', async () => {
  const fixture = await makeFixture()
  try {
    const a = await newTicket(fixture, { title: 'A' })
    const b = await childOf(fixture, a, 'B')
    const c = await childOf(fixture, b, 'C')
    const d = await childOf(fixture, c, 'D')

    await expectIssuesError(
      fixture.service.reparent(fixture.ids.developer, {
        projectId: fixture.projectId,
        ticketId: c.id,
        newParentId: null,
        reason: 'not planner',
        expectedRevision: c.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'PRINCIPAL_NOT_ALLOWED',
    )
    await expectIssuesError(reparent(fixture, c, c.id), 'PARENT_SELF_FORBIDDEN')
    await expectIssuesError(reparent(fixture, c, 'tkt_missing'), 'PARENT_NOT_FOUND')
    await expectIssuesError(reparent(fixture, a, c.id), 'PARENT_CYCLE')
    const root = await newTicket(fixture, { title: 'root' })
    await expectIssuesError(reparent(fixture, root, d.id), 'PARENT_DEPTH_EXCEEDED')
    await expectIssuesError(
      fixture.service.reparent(fixture.ids.planner, {
        projectId: fixture.projectId,
        ticketId: d.id,
        newParentId: a.id,
        reason: '',
        expectedRevision: d.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'VALIDATION_FAILED',
    )
    await expectIssuesError(reparent(fixture, d, a.id, d.revision - 1), 'STALE_REVISION')

    const moved = await reparent(fixture, d, c.id)
    assert.equal(moved.parentId, c.id)
    assert.equal(moved.stateCode, d.stateCode, 'state unchanged')
    assert.equal(moved.revision, d.revision + 1)
    const events = await fixture.service.listEvents(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: d.id,
      limit: 500,
    })
    const reparented = events.items.find(event => event.type === 'ticket.reparented')
    assert.ok(reparented)
    assert.equal(reparented.payload['previousParentId'], c.id)
    assert.equal(reparented.payload['newParentId'], c.id)
    assert.equal(reparented.payload['reason'], 'reparent for test')
    const cleared = await reparent(fixture, moved, null)
    assert.equal(cleared.parentId, null)
  } finally {
    fixture.cleanup()
  }
})

test('C4-L1 re-hang: a populated subtree may not be re-hung under a full-depth chain', async () => {
  const fixture = await makeFixture()
  try {
    // Chain A -> B -> C (C has 2 ancestors).
    const a = await newTicket(fixture, { title: 'A' })
    const b = await childOf(fixture, a, 'B')
    const c = await childOf(fixture, b, 'C')
    // Root D populated with child E (D height 1).
    const d = await newTicket(fixture, { title: 'D' })
    const e = await childOf(fixture, d, 'E')
    // Up-walk alone would accept D under C (depth 3), but E would land at 4.
    await expectIssuesError(reparent(fixture, d, c.id), 'PARENT_DEPTH_EXCEEDED')
    const unchanged = await refresh(fixture, d.id)
    assert.equal(unchanged.parentId, null)
    // Re-hanging the leaf C under D is legal (depth 1, no subtree).
    const moved = await reparent(fixture, c, d.id)
    assert.equal(moved.parentId, d.id)
    const nowDeep = await refresh(fixture, b.id)
    // B still has C as child, so no re-hang touched B.
    assert.equal(nowDeep.parentId, a.id)
    // D now has height 2 (C -> ?): C has no children, so D height 1.
    assert.equal(e.parentId, d.id)
    await assertDepthInvariant(fixture)
  } finally {
    fixture.cleanup()
  }
})

test('post-harvest reparent supersedes the verdict (GATE_EPOCH_STALE), then a new gate works', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await driveTo(fixture, await readyTicket(fixture), 5)
    await recordPassingGate(fixture, ticket)
    const parent = await newTicket(fixture)
    const reparented = await reparent(fixture, ticket, parent.id)
    assert.equal(reparented.revision, ticket.revision + 1)
    await expectIssuesError(
      transition(fixture, reparented.id, fixture.ids.reviewer, 6, reparented.revision),
      'GATE_EPOCH_STALE',
    )
    await recordPassingGate(fixture, reparented)
    const done = await transition(fixture, reparented.id, fixture.ids.reviewer, 6, reparented.revision)
    assert.equal(done.ticket.stateCode, 6)
  } finally {
    fixture.cleanup()
  }
})

test('children/descendants are derived views and parent_id is not PATCHable', async () => {
  const fixture = await makeFixture()
  try {
    const a = await newTicket(fixture, { title: 'A' })
    const b = await childOf(fixture, a, 'B')
    const c = await childOf(fixture, b, 'C')
    const children = await fixture.service.listChildren(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: a.id,
    })
    assert.deepEqual(children.map(child => child.id), [b.id])
    const descendants = await fixture.service.listDescendants(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: a.id,
    })
    assert.deepEqual(
      descendants.map(node => [node.ticket.id, node.depth]),
      [
        [b.id, 1],
        [c.id, 2],
      ],
    )
    const renamed = await fixture.service.updateTicket(fixture.ids.planner, {
      projectId: fixture.projectId,
      ticketId: c.id,
      title: 'renamed child',
      parentId: a.id,
      expectedRevision: c.revision,
      idempotencyKey: fixture.key.next(),
    } as never)
    assert.equal(renamed.parentId, b.id, 'parent_id only changes via reparent')
  } finally {
    fixture.cleanup()
  }
})

test('T-P-17 property: random reparent sequences never produce depth > 3', async () => {
  const fixture = await makeFixture()
  try {
    const tickets: Ticket[] = []
    for (let index = 0; index < 12; index += 1) {
      tickets.push(await newTicket(fixture, { title: `prop-${index}` }))
    }
    // Seeded xorshift128+ so the property test is hermetic.
    let state = 0x1234_5678_9abc_def0n
    const next = (): bigint => {
      state ^= state << 13n
      state ^= state >> 7n
      state ^= state << 17n
      return state < 0n ? -state : state
    }
    for (let step = 0; step < 60; step += 1) {
      const child = tickets[Number(next() % 12n)] as Ticket
      const parent = tickets[Number(next() % 12n)] as Ticket
      try {
        await reparent(fixture, await refresh(fixture, child.id), parent.id)
      } catch {
        // Invariant failures are fine; depth must never be violated silently.
      }
      await assertDepthInvariant(fixture)
    }
  } finally {
    fixture.cleanup()
  }
})
