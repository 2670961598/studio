import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPlatform } from '../src/service.ts'
import { createSqliteIssues } from '../src/index.ts'
import { SqliteIssuesStore } from '../src/sqlite-store.ts'
import { evaluateSqliteVersion, REQUIRED_SQLITE_VERSION } from '../src/sqlite-schema.ts'
import { IssuesError } from '../src/errors.ts'
import {
  addEvidenceFile,
  driveTo,
  makeFixture,
  readyTicket,
  recordPassingGate,
} from './helpers.ts'
import { expectIssuesError } from './helpers.ts'

test('persistence: committed projection/events/comments survive close and reopen', async () => {
  const fixture = await makeFixture({ store: 'sqlite' })
  try {
    const ticket = await readyTicket(fixture)
    const comment = await fixture.service.addComment(fixture.ids.developer, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      body: 'persisted comment',
      idempotencyKey: fixture.key.next(),
    })
    const dbPath = fixture.dbPath as string
    fixture.close()
    const reopenedStore = new SqliteIssuesStore(dbPath)
    const reopened = createPlatform(reopenedStore, {
      evidenceRoot: fixture.evidenceRoot,
      cursorKey: 'test-cursor-key-0123456789',
    })
    try {
      const view = await reopened.service.getTicket(fixture.ids.pm, {
        projectId: fixture.projectId,
        idOrKey: ticket.key,
      })
      assert.equal(view.id, ticket.id)
      assert.equal(view.stateCode, ticket.stateCode)
      const comments = await reopened.service.listComments(fixture.ids.pm, {
        projectId: fixture.projectId,
        ticketId: ticket.id,
      })
      assert.deepEqual(comments.items.map(item => item.id), [comment.comment.id])
      const events = await reopened.service.listEvents(fixture.ids.pm, {
        projectId: fixture.projectId,
        ticketId: ticket.id,
        limit: 500,
      })
      assert.ok(events.items.length >= 3)
      const raw = new DatabaseSync(dbPath)
      const version = raw.prepare('PRAGMA user_version').get() as { user_version: number }
      assert.equal(Number(version.user_version), 1)
      raw.close()
    } finally {
      reopened.close()
    }
  } finally {
    fixture.cleanup()
  }
})

test('persistence: append-only triggers reject UPDATE/DELETE on events, comments, evidence, gate_runs', async () => {
  const fixture = await makeFixture({ store: 'sqlite' })
  const dbPath = fixture.dbPath as string
  try {
    const ticket = await driveTo(fixture, await readyTicket(fixture), 5)
    await addEvidenceFile(fixture, fixture.ids.developer, ticket.id, 'report', 'persist-report.txt')
    await recordPassingGate(fixture, ticket)
    await fixture.service.addComment(fixture.ids.reviewer, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      body: 'immutable',
      idempotencyKey: fixture.key.next(),
    })
    fixture.close()
    const raw = new DatabaseSync(dbPath)
    try {
      raw.exec('PRAGMA foreign_keys = ON')
      const attempts = [
        "UPDATE events SET type = 'tampered'",
        'DELETE FROM events',
        "UPDATE comments SET body = 'tampered'",
        'DELETE FROM comments',
        "UPDATE evidence SET uri = 'tampered'",
        'DELETE FROM evidence',
        'UPDATE gate_runs SET gate_exit = 1',
        'DELETE FROM gate_runs',
      ]
      for (const statement of attempts) {
        assert.throws(
          () => raw.exec(statement),
          /append-only/,
          `append-only trigger for: ${statement}`,
        )
      }
      // A gate evidence row cannot be forged without a bound daemon verdict.
      assert.throws(
        () =>
          raw
            .prepare(`INSERT INTO evidence (id, ticket_id, ticket_revision, kind, uri, sha256,
              bytes, producer, gate_run_id, created_by, created_at)
              VALUES ('evd_forged', ?, 1, 'gate', 'x.txt', ?, 1, 'daemon', 'gate_missing', 'daemon:local', 1)`)
            .run(ticket.id, 'a'.repeat(64)),
        /GATE_RECORD_MISSING/,
      )
    } finally {
      raw.close()
    }
  } finally {
    fixture.cleanup()
  }
})

test('public factory: engine-neutral options only; default storage policy needs no caller knowledge', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-issues-public-'))
  try {
    const platform = createSqliteIssues(join(dir, 'issues.db'), {
      cursorKey: 'public-factory-cursor-key-0123',
      evidenceRoot: dir,
    })
    try {
      const human = await platform.service.createPrincipal({
        kind: 'human',
        displayName: 'Public caller',
      })
      const project = await platform.service.createProject(human.id, {
        keyPrefix: 'PUB',
        name: 'Public factory project',
      })
      assert.equal(project.keyPrefix, 'PUB')
    } finally {
      platform.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('schema: a newer database refuses to start (SCHEMA_TOO_NEW)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-issues-schema-'))
  try {
    const path = join(dir, 'issues.db')
    const raw = new DatabaseSync(path)
    raw.exec('PRAGMA user_version = 99')
    raw.close()
    assert.throws(
      () => new SqliteIssuesStore(path),
      (error: unknown) => error instanceof IssuesError && error.code === 'SCHEMA_TOO_NEW',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('sqlite version pin is evaluated honestly (v0.8 pin = 3.51.3; host is 3.51.2)', () => {
  assert.equal(evaluateSqliteVersion('3.51.2').supported, false)
  assert.equal(evaluateSqliteVersion('3.51.3').supported, true)
  assert.equal(evaluateSqliteVersion('3.52.0').supported, true)
  assert.equal(evaluateSqliteVersion('3.9.0').supported, false)
  const dir = mkdtempSync(join(tmpdir(), 'wb-issues-pin-'))
  try {
    const path = join(dir, 'issues.db')
    const probe = new DatabaseSync(':memory:')
    const row = probe.prepare('SELECT sqlite_version() AS v').get() as { v: string }
    probe.close()
    const assessment = evaluateSqliteVersion(row.v)
    if (assessment.supported) {
      const store = new SqliteIssuesStore(path, { versionPolicy: 'require-pin' })
      store.close()
    } else {
      // Documented known gap: the host runtime is below the v0.8 pin, so the
      // default policy allows it; 'require-pin' still fails closed.
      assert.equal(assessment.required, REQUIRED_SQLITE_VERSION)
      assert.throws(
        () => new SqliteIssuesStore(path, { versionPolicy: 'require-pin' }),
        (error: unknown) => error instanceof IssuesError && error.code === 'STORAGE_UNAVAILABLE',
      )
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('total error mapping: a dead adapter surfaces STORAGE_UNAVAILABLE without engine detail', async () => {
  const fixture = await makeFixture({ store: 'sqlite' })
  try {
    const store = fixture.store as SqliteIssuesStore
    store.db.close()
    const error = await expectIssuesError(
      fixture.service.getProject(fixture.ids.pm, fixture.projectId),
      'STORAGE_UNAVAILABLE',
    )
    assert.ok(!/sqlite|DatabaseSync|SELECT|sqlite_master/i.test(error.message), 'no engine detail')
    assert.equal(error.httpStatus, 503)
    assert.equal(error.retryable, true)
  } finally {
    fixture.cleanup()
  }
})
