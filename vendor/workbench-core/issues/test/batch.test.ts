import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  makeFixture,
  newTicket,
  readyTicket,
  refresh,
} from './helpers.ts'
import type { PlatformFixture } from './helpers.ts'
import { expectIssuesError } from './helpers.ts'

async function ticketIds(fixture: PlatformFixture, count: number): Promise<string[]> {
  const ids: string[] = []
  for (let index = 0; index < count; index += 1) {
    ids.push((await newTicket(fixture, { title: `batch-${index}` })).id)
  }
  return ids
}

/* ------------------------------------------------------------------ */
/* Batch reads                                                         */
/* ------------------------------------------------------------------ */

test('batch read getTickets: order, missing[] omission, bounded size, no N+1', async () => {
  const fixture = await makeFixture()
  try {
    const ids = await ticketIds(fixture, 3)
    const result = await fixture.service.getTickets(fixture.ids.pm, {
      projectId: fixture.projectId,
      ids: [ids[2] as string, 'tkt_missing', ids[0] as string],
    })
    assert.deepEqual(result.items.map(ticket => ticket.id), [ids[2], ids[0]])
    assert.deepEqual(result.missing, ['tkt_missing'])
    await expectIssuesError(
      fixture.service.getTickets(fixture.ids.pm, {
        projectId: fixture.projectId,
        ids: new Array(501).fill('tkt_x'),
      }),
      'VALIDATION_FAILED',
    )
    // One chunked adapter call for a 500-id read (no N+1).
    const before = fixture.store.queryCount
    const big = Array.from({ length: 500 }, (_, index) => `tkt_nope_${index}`)
    const missing = await fixture.service.getTickets(fixture.ids.pm, {
      projectId: fixture.projectId,
      ids: big,
    })
    assert.equal(missing.items.length, 0)
    assert.equal(missing.missing.length, 500)
    const delta = fixture.store.queryCount - before
    assert.ok(delta <= 3, `adapter used ${delta} queries for 500 ids (chunked, no N+1)`)
    await expectIssuesError(
      fixture.service.getTickets(fixture.ids.outsider, {
        projectId: fixture.projectId,
        ids,
      }),
      'PROJECT_FORBIDDEN',
    )
  } finally {
    fixture.cleanup()
  }
})

test('batch read getComments: project scoping and missing[]', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await newTicket(fixture)
    const first = await fixture.service.addComment(fixture.ids.developer, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      body: 'one',
      idempotencyKey: fixture.key.next(),
    })
    const result = await fixture.service.getComments(fixture.ids.pm, {
      projectId: fixture.projectId,
      ids: [first.comment.id, 'cmt_missing'],
    })
    assert.deepEqual(result.items.map(comment => comment.id), [first.comment.id])
    assert.deepEqual(result.missing, ['cmt_missing'])
    await expectIssuesError(
      fixture.service.getComments(fixture.ids.pm, {
        projectId: fixture.projectId,
        ids: new Array(501).fill('cmt_x'),
      }),
      'VALIDATION_FAILED',
    )
  } finally {
    fixture.cleanup()
  }
})

/* ------------------------------------------------------------------ */
/* Batch writes: comments                                              */
/* ------------------------------------------------------------------ */

test('batch addComments: per-item results, independent default, idempotent replay', async () => {
  const fixture = await makeFixture()
  try {
    const ticketA = (await newTicket(fixture, { title: 'A' })).id
    const ticketB = (await newTicket(fixture, { title: 'B' })).id
    const keys = [fixture.key.next(), fixture.key.next(), fixture.key.next()]
    const input = {
      projectId: fixture.projectId,
      items: [
        { ticketId: ticketA, body: 'valid A', idempotencyKey: keys[0] as string },
        { ticketId: ticketB, body: '', idempotencyKey: keys[1] as string },
        { ticketId: ticketA, body: 'valid A2', idempotencyKey: keys[2] as string },
      ],
    } as const
    const result = await fixture.service.batchAddComments(fixture.ids.developer, input)
    assert.equal(result.items.length, 3)
    assert.equal(result.items[0]?.status, 201)
    assert.ok(result.items[0]?.result !== null)
    assert.equal(result.items[1]?.status, 422)
    assert.equal(result.items[1]?.error?.code, 'COMMENT_REQUIRED')
    assert.equal(result.items[2]?.status, 201)
    const comments = await fixture.service.listComments(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: ticketA,
    })
    assert.equal(comments.items.length, 2, 'invalid sibling did not roll back valid items')
    // Replay returns first stored responses and never appends a second comment.
    const replay = await fixture.service.batchAddComments(fixture.ids.developer, input)
    assert.equal(replay.items[0]?.result?.id, result.items[0]?.result?.id)
    assert.equal(replay.items[2]?.result?.id, result.items[2]?.result?.id)
    const afterReplay = await fixture.service.listComments(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: ticketA,
    })
    assert.equal(afterReplay.items.length, 2)
  } finally {
    fixture.cleanup()
  }
})

test('batch addComments atomic: same-aggregate all-or-nothing, cross-aggregate rejected', async () => {
  const fixture = await makeFixture()
  try {
    const ticketA = (await newTicket(fixture)).id
    const ticketB = (await newTicket(fixture)).id
    await expectIssuesError(
      fixture.service.batchAddComments(fixture.ids.developer, {
        projectId: fixture.projectId,
        atomic: true,
        items: [
          { ticketId: ticketA, body: 'one', idempotencyKey: fixture.key.next() },
          { ticketId: ticketB, body: 'two', idempotencyKey: fixture.key.next() },
        ],
      }),
      'VALIDATION_FAILED',
    )
    const atomic = await fixture.service.batchAddComments(fixture.ids.developer, {
      projectId: fixture.projectId,
      atomic: true,
      items: [
        { ticketId: ticketA, body: 'atomic ok', idempotencyKey: fixture.key.next() },
        { ticketId: ticketA, body: '', idempotencyKey: fixture.key.next() },
        { ticketId: ticketA, body: 'never written', idempotencyKey: fixture.key.next() },
      ],
    })
    assert.equal(atomic.items.filter(item => item.error !== null).length, 3)
    assert.equal(atomic.items[1]?.error?.code, 'COMMENT_REQUIRED')
    const comments = await fixture.service.listComments(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: ticketA,
    })
    assert.equal(comments.items.length, 0, 'atomic failure rolled everything back')
    await expectIssuesError(
      fixture.service.batchAddComments(fixture.ids.developer, {
        projectId: fixture.projectId,
        items: new Array(101).fill({
          ticketId: ticketA,
          body: 'too many',
          idempotencyKey: 'idem-too-many',
        }),
      }),
      'VALIDATION_FAILED',
    )
  } finally {
    fixture.cleanup()
  }
})

test('batch addComments: no privilege elevation per item', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = (await newTicket(fixture)).id
    await expectIssuesError(
      fixture.service.batchAddComments(fixture.ids.outsider, {
        projectId: fixture.projectId,
        items: [{ ticketId: ticket, body: 'nope', idempotencyKey: fixture.key.next() }],
      }),
      'PROJECT_FORBIDDEN',
    )
    const result = await fixture.service.batchAddComments(fixture.ids.developer, {
      projectId: fixture.projectId,
      items: [{ ticketId: 'tkt_missing', body: 'ghost', idempotencyKey: fixture.key.next() }],
    })
    assert.equal(result.items[0]?.error?.code, 'TICKET_NOT_FOUND')
    assert.equal(result.items[0]?.status, 404)
  } finally {
    fixture.cleanup()
  }
})

/* ------------------------------------------------------------------ */
/* Batch writes: transitions                                           */
/* ------------------------------------------------------------------ */

test('batch transitions: per-item CAS/authz results, independent default', async () => {
  const fixture = await makeFixture()
  try {
    const first = await readyTicket(fixture)
    const second = await readyTicket(fixture)
    const result = await fixture.service.batchTransitionTickets(fixture.ids.developer, {
      projectId: fixture.projectId,
      items: [
        {
          ticketId: first.id,
          targetStateCode: 3,
          expectedRevision: first.revision,
          idempotencyKey: fixture.key.next(),
        },
        {
          ticketId: first.id,
          targetStateCode: 3,
          expectedRevision: first.revision,
          idempotencyKey: fixture.key.next(),
        },
        {
          ticketId: second.id,
          targetStateCode: 3,
          expectedRevision: second.revision - 1,
          idempotencyKey: fixture.key.next(),
        },
      ],
    })
    assert.equal(result.items[0]?.status, 200)
    assert.equal(result.items[0]?.result?.ticket.stateCode, 3)
    assert.equal(result.items[1]?.error?.code, 'STALE_REVISION')
    assert.equal(result.items[2]?.error?.code, 'STALE_REVISION')
    const current = await refresh(fixture, first.id)
    assert.equal(current.stateCode, 3)
  } finally {
    fixture.cleanup()
  }
})

test('batch transitions atomic: same ticket succeeds, cross-ticket atomic rejected', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await readyTicket(fixture)
    const atomic = await fixture.service.batchTransitionTickets(fixture.ids.developer, {
      projectId: fixture.projectId,
      atomic: true,
      items: [
        {
          ticketId: ticket.id,
          targetStateCode: 3,
          expectedRevision: ticket.revision,
          idempotencyKey: fixture.key.next(),
        },
        {
          ticketId: ticket.id,
          targetStateCode: 4,
          expectedRevision: ticket.revision + 1,
          idempotencyKey: fixture.key.next(),
        },
      ],
    })
    assert.deepEqual(
      atomic.items.map(item => item.status),
      [200, 200],
    )
    const current = await refresh(fixture, ticket.id)
    assert.equal(current.stateCode, 4)

    const other = await readyTicket(fixture)
    await expectIssuesError(
      fixture.service.batchTransitionTickets(fixture.ids.developer, {
        projectId: fixture.projectId,
        atomic: true,
        items: [
          {
            ticketId: ticket.id,
            targetStateCode: 5,
            expectedRevision: current.revision,
            idempotencyKey: fixture.key.next(),
          },
          {
            ticketId: other.id,
            targetStateCode: 3,
            expectedRevision: other.revision,
            idempotencyKey: fixture.key.next(),
          },
        ],
      }),
      'VALIDATION_FAILED',
    )
  } finally {
    fixture.cleanup()
  }
})

test('batch transitions atomic rollback leaves no event/revision behind', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await readyTicket(fixture)
    const eventsBefore = await fixture.service.listEvents(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      limit: 500,
    })
    const result = await fixture.service.batchTransitionTickets(fixture.ids.developer, {
      projectId: fixture.projectId,
      atomic: true,
      items: [
        {
          ticketId: ticket.id,
          targetStateCode: 3,
          expectedRevision: ticket.revision,
          idempotencyKey: fixture.key.next(),
        },
        {
          ticketId: ticket.id,
          targetStateCode: 4,
          expectedRevision: ticket.revision + 5,
          idempotencyKey: fixture.key.next(),
        },
      ],
    })
    assert.equal(result.items.filter(item => item.error !== null).length, 2)
    const current = await refresh(fixture, ticket.id)
    assert.equal(current.stateCode, 2)
    assert.equal(current.revision, ticket.revision)
    const events = await fixture.service.listEvents(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      limit: 500,
    })
    assert.equal(events.items.length, eventsBefore.items.length, 'atomic rollback wrote no event')
    const outcomes = result.items.map(item => item.error?.code)
    assert.ok(outcomes.includes('STALE_REVISION'))
    assert.ok(outcomes.includes('VALIDATION_FAILED'))
  } finally {
    fixture.cleanup()
  }
})
