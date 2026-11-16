import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  driveTo,
  expectIssuesError,
  makeFixture,
  newTicket,
  readyTicket,
  recordPassingGate,
} from './helpers.ts'

/* ------------------------------------------------------------------ */
/* Opaque cursor contract                                              */
/* ------------------------------------------------------------------ */

test('cursor: happy path pagination returns every row once and ends with null', async () => {
  const fixture = await makeFixture()
  try {
    const created: string[] = []
    for (let index = 0; index < 7; index += 1) {
      created.push((await newTicket(fixture, { title: `page-${index}` })).id)
    }
    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      pages += 1
      const page = await fixture.service.listTickets(fixture.ids.pm, {
        projectId: fixture.projectId,
        limit: 3,
        ...(cursor === null ? {} : { cursor }),
      })
      seen.push(...page.items.map(ticket => ticket.id))
      cursor = page.nextCursor
      assert.ok(pages <= 10, 'bounded pages')
    } while (cursor !== null)
    assert.equal(pages, 3)
    assert.equal(seen.length, 7)
    assert.equal(new Set(seen).size, 7, 'no duplicates across pages')
    assert.deepEqual([...seen].sort(), [...created].sort(), 'no gaps')
  } finally {
    fixture.cleanup()
  }
})

test('cursor: tamper, version, binding and cross-query reuse are VALIDATION_FAILED', async () => {
  const fixture = await makeFixture()
  try {
    for (let index = 0; index < 4; index += 1) await newTicket(fixture)
    const page1 = await fixture.service.listTickets(fixture.ids.pm, {
      projectId: fixture.projectId,
      limit: 2,
    })
    const cursor = page1.nextCursor
    assert.ok(cursor !== null)
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith('a') ? 'b' : 'a'}`
    await expectIssuesError(
      fixture.service.listTickets(fixture.ids.pm, {
        projectId: fixture.projectId,
        limit: 2,
        cursor: tampered,
      }),
      'VALIDATION_FAILED',
    )
    const versionMismatch = cursor.replace(/^ic\d\./, 'ic2.')
    await expectIssuesError(
      fixture.service.listTickets(fixture.ids.pm, {
        projectId: fixture.projectId,
        limit: 2,
        cursor: versionMismatch,
      }),
      'VALIDATION_FAILED',
    )
    // Cross-query reuse: different filter shape invalidates the binding.
    await expectIssuesError(
      fixture.service.listTickets(fixture.ids.pm, {
        projectId: fixture.projectId,
        limit: 2,
        stateCodes: [1],
        cursor,
      }),
      'VALIDATION_FAILED',
    )
    // Cross-project reuse.
    const project2 = await fixture.service.createProject(fixture.ids.admin, {
      keyPrefix: 'CRS',
      name: 'Cursor project',
    })
    await fixture.service.grantMembership(fixture.ids.admin, {
      projectId: project2.id,
      principalId: fixture.ids.pm,
      roles: ['PLANNER'],
      reason: 'cursor test',
      idempotencyKey: fixture.key.next(),
    })
    await expectIssuesError(
      fixture.service.listTickets(fixture.ids.pm, {
        projectId: project2.id,
        limit: 2,
        cursor,
      }),
      'VALIDATION_FAILED',
    )
    // Cross-ticket reuse for comment cursors.
    const ticketA = await newTicket(fixture)
    const ticketB = await newTicket(fixture)
    for (let index = 0; index < 3; index += 1) {
      await fixture.service.addComment(fixture.ids.developer, {
        projectId: fixture.projectId,
        ticketId: ticketA.id,
        body: `a${index}`,
        idempotencyKey: fixture.key.next(),
      })
    }
    const commentsPage = await fixture.service.listComments(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: ticketA.id,
      limit: 2,
    })
    assert.ok(commentsPage.nextCursor !== null)
    await expectIssuesError(
      fixture.service.listComments(fixture.ids.pm, {
        projectId: fixture.projectId,
        ticketId: ticketB.id,
        cursor: commentsPage.nextCursor,
      }),
      'VALIDATION_FAILED',
    )
  } finally {
    fixture.cleanup()
  }
})

test('cursor: event streams page by internal seq; limits are bounded', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await driveTo(fixture, await readyTicket(fixture), 5)
    await recordPassingGate(fixture, ticket)
    const page1 = await fixture.service.listEvents(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      limit: 3,
    })
    assert.equal(page1.items.length, 3)
    assert.ok(page1.nextCursor !== null)
    const page2 = await fixture.service.listEvents(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      limit: 3,
      cursor: page1.nextCursor,
    })
    assert.ok(page2.items.length > 0)
    assert.ok((page2.items[0]?.seq ?? 0) > (page1.items[2]?.seq ?? 0), 'exclusive seq cursor')
    const projectPage = await fixture.service.listProjectEvents(fixture.ids.pm, {
      projectId: fixture.projectId,
      limit: 5,
    })
    assert.equal(projectPage.items.length, 5)
    assert.ok(projectPage.nextCursor !== null)
    for (const limit of [0, 501, -1, 1.5]) {
      await expectIssuesError(
        fixture.service.listTickets(fixture.ids.pm, {
          projectId: fixture.projectId,
          limit,
        }),
        'VALIDATION_FAILED',
      )
      await expectIssuesError(
        fixture.service.listEvents(fixture.ids.pm, {
          projectId: fixture.projectId,
          ticketId: ticket.id,
          limit,
        }),
        'VALIDATION_FAILED',
      )
    }
  } finally {
    fixture.cleanup()
  }
})

/* ------------------------------------------------------------------ */
/* Identity, validation, policy, grants                                */
/* ------------------------------------------------------------------ */

test('identity: wire-supplied handles are rejected with PRINCIPAL_MISMATCH', async () => {
  const fixture = await makeFixture()
  try {
    await expectIssuesError(
      fixture.service.listTickets('human:boss', { projectId: fixture.projectId }),
      'PRINCIPAL_MISMATCH',
    )
    await expectIssuesError(
      fixture.service.listTickets('agent:forged', { projectId: fixture.projectId }),
      'PRINCIPAL_MISMATCH',
    )
    await expectIssuesError(
      fixture.service.listTickets('prn_unknown', { projectId: fixture.projectId }),
      'PRINCIPAL_NOT_ALLOWED',
    )
  } finally {
    fixture.cleanup()
  }
})

test('validation: state codes, project prefixes, idempotency keys fail closed', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await readyTicket(fixture)
    await expectIssuesError(
      fixture.service.transition(fixture.ids.developer, {
        projectId: fixture.projectId,
        ticketId: ticket.id,
        targetStateCode: 99,
        expectedRevision: ticket.revision,
        idempotencyKey: fixture.key.next(),
      }),
      'VALIDATION_FAILED',
    )
    await expectIssuesError(
      fixture.service.transition(fixture.ids.developer, {
        projectId: fixture.projectId,
        ticketId: ticket.id,
        targetStateCode: 3,
        expectedRevision: ticket.revision,
        idempotencyKey: 'x',
      }),
      'VALIDATION_FAILED',
    )
    await expectIssuesError(
      fixture.service.createProject(fixture.ids.admin, { keyPrefix: 'lower', name: 'bad' }),
      'VALIDATION_FAILED',
    )
    await expectIssuesError(
      fixture.service.createProject(fixture.ids.admin, { keyPrefix: 'TST', name: 'duplicate' }),
      'VALIDATION_FAILED',
    )
  } finally {
    fixture.cleanup()
  }
})

test('policy: human-only, generation CAS and range validation', async () => {
  const fixture = await makeFixture()
  try {
    await expectIssuesError(
      fixture.service.updatePolicy(fixture.ids.planner, {
        projectId: fixture.projectId,
        expectedGeneration: 1,
        policy: { wipLimitPerWorker: 2 },
        reason: 'agent write',
        idempotencyKey: fixture.key.next(),
      }),
      'HUMAN_ONLY_FIELD',
    )
    await expectIssuesError(
      fixture.service.updatePolicy(fixture.ids.pm, {
        projectId: fixture.projectId,
        expectedGeneration: 1,
        policy: { wipLimitPerWorker: 99 },
        reason: 'out of range',
        idempotencyKey: fixture.key.next(),
      }),
      'POLICY_VALUE_OUT_OF_RANGE',
    )
    const updated = await fixture.service.updatePolicy(fixture.ids.pm, {
      projectId: fixture.projectId,
      expectedGeneration: 1,
      policy: { wipLimitPerWorker: 2 },
      reason: 'tighten',
      idempotencyKey: fixture.key.next(),
    })
    assert.equal(updated.policyGeneration, 2)
    await expectIssuesError(
      fixture.service.updatePolicy(fixture.ids.pm, {
        projectId: fixture.projectId,
        expectedGeneration: 1,
        policy: { wipLimitPerWorker: 3 },
        reason: 'stale generation',
        idempotencyKey: fixture.key.next(),
      }),
      'STALE_POLICY_GENERATION',
    )
    const events = await fixture.service.listProjectEvents(fixture.ids.pm, {
      projectId: fixture.projectId,
      limit: 500,
    })
    assert.ok(events.items.some(event => event.type === 'project.policy_updated'))
  } finally {
    fixture.cleanup()
  }
})

test('grants: human-only, no self-grant, invalid roles rejected', async () => {
  const fixture = await makeFixture()
  try {
    await expectIssuesError(
      fixture.service.grantMembership(fixture.ids.planner, {
        projectId: fixture.projectId,
        principalId: fixture.ids.outsider,
        roles: ['PLANNER'],
        reason: 'agent grant',
        idempotencyKey: fixture.key.next(),
      }),
      'HUMAN_ONLY_FIELD',
    )
    await expectIssuesError(
      fixture.service.grantMembership(fixture.ids.pm, {
        projectId: fixture.projectId,
        principalId: fixture.ids.pm,
        roles: ['PLANNER'],
        reason: 'self grant',
        idempotencyKey: fixture.key.next(),
      }),
      'PRINCIPAL_NOT_ALLOWED',
    )
    await expectIssuesError(
      fixture.service.grantMembership(fixture.ids.pm, {
        projectId: fixture.projectId,
        principalId: fixture.ids.outsider,
        roles: ['ADMIN'],
        reason: 'invalid role',
        idempotencyKey: fixture.key.next(),
      } as never),
      'VALIDATION_FAILED',
    )
  } finally {
    fixture.cleanup()
  }
})

/* ------------------------------------------------------------------ */
/* Public boundary hygiene                                             */
/* ------------------------------------------------------------------ */

test('T-SEC-30: public DTO/error/domain surface has no engine or SQL detail', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const publicFiles = ['types.ts', 'errors.ts', 'catalog.ts', 'service.ts', 'core.ts', 'index.ts']
  const forbidden = [
    /node:sqlite/,
    /DatabaseSync/,
    /better-sqlite3/,
    /SELECT\s/i,
    /INSERT\s+INTO/i,
    /CREATE\s+TABLE/i,
    /PRAGMA/,
    /sqlite_master/,
    /sqliteVersionPolicy/,
    /versionPolicy/,
    /sqlite_version/,
    /\bWAL\b/,
  ]
  for (const file of publicFiles) {
    const contents = readFileSync(join(here, '..', 'src', file), 'utf8')
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(contents), `${file} leaks ${String(pattern)}`)
    }
  }
  // The public options type is engine-neutral: no storage-engine knob at all.
  const publicTypes = readFileSync(join(here, '..', 'src', 'types.ts'), 'utf8')
  assert.ok(!/sqlite/i.test(publicTypes), 'public types.ts mentions a storage engine')
  // Storage port/adapters and engine options are not re-exported from the entry.
  const entry = readFileSync(join(here, '..', 'src', 'index.ts'), 'utf8')
  assert.ok(!/export .*TicketStore/.test(entry))
  assert.ok(!/export .*IssuesStore/.test(entry))
  assert.ok(!/export .*MemoryIssuesStore/.test(entry))
  assert.ok(!/export .*SqliteIssuesStore/.test(entry))
  assert.ok(!/versionPolicy/.test(entry))
  assert.ok(!/SqliteStoreOptions/.test(entry))
})

test('T-SEC-30: README public contract does not expose engine internals', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const readme = readFileSync(join(here, '..', 'README.md'), 'utf8')
  const forbiddenInPublicContract = [
    /sqliteVersionPolicy/,
    /\bPRAGMA\b/,
    /\bWAL\b/,
    /sqlite_version/,
    /versionPolicy/,
  ]
  for (const pattern of forbiddenInPublicContract) {
    assert.ok(!pattern.test(readme), `README leaks ${String(pattern)}`)
  }
  // The documented public construction options are engine-neutral.
  const documentedOptions = readme.slice(readme.indexOf('createSqliteIssues'))
  assert.ok(!/versionPolicy/.test(documentedOptions))
})

test('boundary: batch reads never widen a grant or leak foreign ids', async () => {
  const fixture = await makeFixture()
  try {
    const mine = await newTicket(fixture)
    const project2 = await fixture.service.createProject(fixture.ids.admin, {
      keyPrefix: 'BND',
      name: 'Boundary project',
    })
    await fixture.service.grantMembership(fixture.ids.admin, {
      projectId: project2.id,
      principalId: fixture.ids.pm,
      roles: ['PLANNER'],
      reason: 'boundary test',
      idempotencyKey: fixture.key.next(),
    })
    const foreign = await fixture.service.createTicket(fixture.ids.pm, {
      projectId: project2.id,
      title: 'foreign ticket',
      idempotencyKey: fixture.key.next(),
    })
    const scoped = await fixture.service.getTickets(fixture.ids.pm, {
      projectId: fixture.projectId,
      ids: [mine.id, foreign.id],
    })
    assert.deepEqual(scoped.items.map(ticket => ticket.id), [mine.id])
    assert.deepEqual(scoped.missing, [foreign.id], 'foreign id is omitted as missing')
    await expectIssuesError(
      fixture.service.getTickets(fixture.ids.outsider, {
        projectId: fixture.projectId,
        ids: [mine.id, foreign.id],
      }),
      'PROJECT_FORBIDDEN',
    )
  } finally {
    fixture.cleanup()
  }
})
