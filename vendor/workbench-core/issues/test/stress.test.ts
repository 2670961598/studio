import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeFixture, newTicket, refresh, transition } from './helpers.ts'

/**
 * Configurable stress/soak smoke. Default is bounded so CI stays fast; a full
 * run can be requested with env vars, e.g.
 *   ISSUES_STRESS_TICKETS=10000 ISSUES_STRESS_COMMENTS=100000 \
 *   ISSUES_STRESS_BUDGET_MS=120000 node --experimental-strip-types --test test/stress.test.ts
 */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const TICKETS = envInt('ISSUES_STRESS_TICKETS', 400)
const COMMENTS = envInt('ISSUES_STRESS_COMMENTS', 800)
const TRANSITIONS = envInt('ISSUES_STRESS_TRANSITIONS', 6)
const BUDGET_MS = envInt('ISSUES_STRESS_BUDGET_MS', 60_000)

test(`stress: ${TICKETS} tickets / ${COMMENTS} comments / ${TRANSITIONS} transitions on sqlite`, async t => {
  const fixture = await makeFixture({ store: 'sqlite' })
  try {
    const startedAt = Date.now()
    const ticketIds: string[] = []
    for (let index = 0; index < TICKETS; index += 1) {
      ticketIds.push((await newTicket(fixture, { title: `stress-${index}` })).id)
    }
    const createdTicketsAt = Date.now()
    for (let index = 0; index < COMMENTS; index += 1) {
      await fixture.service.addComment(fixture.ids.developer, {
        projectId: fixture.projectId,
        ticketId: ticketIds[index % ticketIds.length] as string,
        body: `stress comment ${index}`,
        idempotencyKey: fixture.key.next(),
      })
    }
    const commentedAt = Date.now()

    // Batch read over the first 500 tickets is a single chunked path.
    const batch = await fixture.service.getTickets(fixture.ids.pm, {
      projectId: fixture.projectId,
      ids: ticketIds.slice(0, 500),
    })
    assert.equal(batch.items.length, Math.min(TICKETS, 500))
    assert.equal(batch.missing.length, 0)

    // Cursor pagination sees every ticket exactly once.
    const seen = new Set<string>()
    let cursor: string | null = null
    let pages = 0
    do {
      pages += 1
      const page = await fixture.service.listTickets(fixture.ids.pm, {
        projectId: fixture.projectId,
        limit: 100,
        ...(cursor === null ? {} : { cursor }),
      })
      for (const ticket of page.items) {
        assert.ok(!seen.has(ticket.id), 'no duplicate ticket across pages')
        seen.add(ticket.id)
      }
      cursor = page.nextCursor
      assert.ok(pages <= TICKETS + 1)
    } while (cursor !== null)
    assert.equal(seen.size, TICKETS)
    // A full page returns a non-null cursor, so one extra empty page is legal.
    assert.ok(
      pages === Math.ceil(TICKETS / 100) || pages === Math.ceil(TICKETS / 100) + 1,
      `pages=${pages}`,
    )

    // Project event stream cursor pages over every event without gaps.
    let eventCount = 0
    let eventCursor: string | null = null
    let eventPages = 0
    do {
      eventPages += 1
      const page = await fixture.service.listProjectEvents(fixture.ids.pm, {
        projectId: fixture.projectId,
        limit: 500,
        ...(eventCursor === null ? {} : { cursor: eventCursor }),
      })
      eventCount += page.items.length
      eventCursor = page.nextCursor
      assert.ok(eventPages <= TICKETS + 10)
    } while (eventCursor !== null)
    assert.ok(eventCount >= TICKETS + COMMENTS, `events ${eventCount} < tickets+comments`)

    // A bounded set of real workflow transitions through the matrix.
    for (let index = 0; index < TRANSITIONS; index += 1) {
      const ticketId = ticketIds[index] as string
      let current = await refresh(fixture, ticketId)
      current = await fixture.service.assign(fixture.ids.planner, {
        projectId: fixture.projectId,
        ticketId: current.id,
        assigneeId: fixture.ids.developer,
        reviewerId: fixture.ids.reviewer,
        expectedRevision: current.revision,
        idempotencyKey: fixture.key.next(),
      })
      current = (await transition(fixture, current.id, fixture.ids.planner, 2, current.revision)).ticket
      current = (await transition(fixture, current.id, fixture.ids.developer, 3, current.revision)).ticket
      assert.equal(current.stateCode, 3)
    }

    // Concurrent CAS on one revision still admits exactly one winner at volume.
    const racing = ticketIds[TRANSITIONS + 1] as string
    const racingTicket = await refresh(fixture, racing)
    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, async () => {
        const current = await refresh(fixture, racingTicket.id)
        return fixture.service.assign(fixture.ids.planner, {
          projectId: fixture.projectId,
          ticketId: current.id,
          assigneeId: fixture.ids.developer,
          reviewerId: fixture.ids.reviewer,
          expectedRevision: current.revision,
          idempotencyKey: fixture.key.next(),
        })
      }),
    )
    assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1)

    const elapsed = Date.now() - startedAt
    t.diagnostic(
      `stress: tickets=${TICKETS} comments=${COMMENTS} events=${eventCount} ` +
        `create=${createdTicketsAt - startedAt}ms comments=${commentedAt - createdTicketsAt}ms total=${elapsed}ms`,
    )
    assert.ok(elapsed < BUDGET_MS, `stress run took ${elapsed}ms (budget ${BUDGET_MS}ms)`)
  } finally {
    fixture.cleanup()
  }
})
