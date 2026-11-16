import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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
import { IssuesError } from '../src/errors.ts'

test('T7: no daemon verdict means GATE_RECORD_MISSING; the executor cannot self-report', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await driveTo(fixture, await readyTicket(fixture), 5)
    assert.equal('recordGateEvidence' in fixture.service, false, 'service has no daemon method')
    await expectIssuesError(
      transition(fixture, ticket.id, fixture.ids.reviewer, 6, ticket.revision),
      'GATE_RECORD_MISSING',
    )
    await expectIssuesError(
      fixture.service.addEvidence(fixture.ids.developer, {
        projectId: fixture.projectId,
        ticketId: ticket.id,
        kind: 'gate',
        uri: 'gate.json',
        idempotencyKey: fixture.key.next(),
      } as never),
      'PRINCIPAL_NOT_ALLOWED',
    )
    await expectIssuesError(
      fixture.service.addEvidence(fixture.ids.developer, {
        projectId: fixture.projectId,
        ticketId: ticket.id,
        kind: 'summary',
        uri: 'missing-file.txt',
        idempotencyKey: fixture.key.next(),
      }),
      'EVIDENCE_PATH_INVALID',
    )
  } finally {
    fixture.cleanup()
  }
})

test('T7 positive control: passing verdict + its own gate trace reach DONE', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await driveTo(fixture, await readyTicket(fixture), 5)
    const evidence = await addEvidenceFile(fixture, fixture.ids.developer, ticket.id, 'report', 'report.txt', 'report bytes')
    const gate = await recordPassingGate(fixture, ticket)
    assert.deepEqual(gate.coveredEvidenceIds, [evidence.id])
    const stored = await fixture.service.listEvidence(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
    })
    const gateTrace = stored.find(item => item.kind === 'gate')
    assert.ok(gateTrace)
    assert.equal(gateTrace.gateRunId, gate.gateRunId)
    assert.equal(gateTrace.producer, 'daemon')
    assert.equal(gateTrace.ticketRevision, ticket.revision)
    const done = await transition(fixture, ticket.id, fixture.ids.reviewer, 6, ticket.revision)
    assert.equal(done.ticket.stateCode, 6)
    assert.equal(done.event.payload['gateRunId'], gate.gateRunId)
    assert.deepEqual(done.event.payload['evidenceIds'], [evidence.id])
    const run = await fixture.service.getGateRun(fixture.ids.reviewer, {
      projectId: fixture.projectId,
      gateRunId: gate.gateRunId,
    })
    assert.ok(run !== null)
    assert.equal(run.gateExit, 0)
    assert.deepEqual(run.requirements, { completed: true, output: true, report: true })
    assert.deepEqual(run.coveredEvidenceIds, [evidence.id])
  } finally {
    fixture.cleanup()
  }
})

test('T7: verdict coverage must equal the current attempt evidence set exactly', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await driveTo(fixture, await readyTicket(fixture), 5)
    const evidence = await addEvidenceFile(fixture, fixture.ids.developer, ticket.id, 'report', 'r1.txt')
    await expectIssuesError(
      fixture.daemon.recordGateEvidence({
        projectId: fixture.projectId,
        ticketId: ticket.id,
        gateExit: 0,
        requirements: { completed: true, output: true, report: true },
        coveredEvidenceIds: [],
        ...writeFileFor(fixture, 'gate-wrong-coverage.txt'),
      }),
      'GATE_EPOCH_STALE',
    )
    const gate = await recordPassingGate(fixture, ticket)
    assert.deepEqual(gate.coveredEvidenceIds, [evidence.id])
    // Evidence added after the verdict starts a new gate epoch.
    await addEvidenceFile(fixture, fixture.ids.developer, ticket.id, 'trace', 'late-trace.txt')
    await expectIssuesError(
      transition(fixture, ticket.id, fixture.ids.reviewer, 6, ticket.revision),
      'GATE_EPOCH_STALE',
    )
  } finally {
    fixture.cleanup()
  }
})

function writeFileFor(fixture: Awaited<ReturnType<typeof makeFixture>>, name: string): { uri: string } {
  writeFileSync(join(fixture.evidenceRoot, name), 'gate output', 'utf8')
  return { uri: name }
}

test('T7: a non-passing verdict never counts as a pass', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await driveTo(fixture, await readyTicket(fixture), 5)
    await recordPassingGate(fixture, ticket, { gateExit: 1 })
    await expectIssuesError(
      transition(fixture, ticket.id, fixture.ids.reviewer, 6, ticket.revision),
      'GATE_RECORD_MISSING',
    )
    const refreshed = await refresh(fixture, ticket.id)
    await recordPassingGate(fixture, refreshed, {
      requirements: { completed: true, output: false, report: true },
    })
    await expectIssuesError(
      transition(fixture, refreshed.id, fixture.ids.reviewer, 6, refreshed.revision),
      'GATE_RECORD_MISSING',
    )
  } finally {
    fixture.cleanup()
  }
})

test('T7: evidence swapped on disk after submit is EVIDENCE_INVALIDATED', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await driveTo(fixture, await readyTicket(fixture), 5)
    await addEvidenceFile(fixture, fixture.ids.developer, ticket.id, 'report', 'mutable.txt', 'original')
    await recordPassingGate(fixture, ticket)
    writeFileSync(join(fixture.evidenceRoot, 'mutable.txt'), 'tampered!', 'utf8')
    await expectIssuesError(
      transition(fixture, ticket.id, fixture.ids.reviewer, 6, ticket.revision),
      'EVIDENCE_INVALIDATED',
    )
  } finally {
    fixture.cleanup()
  }
})

test('evidence URI containment: absolute, traversal, scheme, missing, dir and symlink rejected', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await newTicket(fixture)
    mkdirSync(join(fixture.evidenceRoot, 'a-directory'))
    writeFileSync(join(fixture.evidenceRoot, 'inside.txt'), 'inside', 'utf8')
    symlinkSync(join(fixture.evidenceRoot, 'inside.txt'), join(fixture.evidenceRoot, 'link.txt'))
    const badUris = [
      '/etc/passwd',
      '../escape.txt',
      'nested/../../escape.txt',
      'file:///etc/passwd',
      'artifact://elsewhere',
      'does-not-exist.txt',
      'a-directory',
      'link.txt',
    ]
    for (const uri of badUris) {
      await expectIssuesError(
        fixture.service.addEvidence(fixture.ids.developer, {
          projectId: fixture.projectId,
          ticketId: ticket.id,
          kind: 'report',
          uri,
          idempotencyKey: fixture.key.next(),
        }),
        'EVIDENCE_PATH_INVALID',
      )
    }
    const ok = await fixture.service.addEvidence(fixture.ids.developer, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      kind: 'report',
      uri: 'inside.txt',
      idempotencyKey: fixture.key.next(),
    })
    assert.equal(ok.uri, 'inside.txt')
    assert.match(ok.sha256, /^[0-9a-f]{64}$/)
    assert.equal(ok.producer, 'agent')
  } finally {
    fixture.cleanup()
  }
})

test('gate freshness: stale harvest revision and pre-boundary producedAt are GATE_EPOCH_STALE', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await driveTo(fixture, await readyTicket(fixture), 5)
    await expectIssuesError(
      fixture.daemon.recordGateEvidence({
        projectId: fixture.projectId,
        ticketId: ticket.id,
        ticketRevision: ticket.revision - 1,
        gateExit: 0,
        requirements: { completed: true, output: true, report: true },
        coveredEvidenceIds: [],
        ...writeFileFor(fixture, 'stale-gate.txt'),
      }),
      'GATE_EPOCH_STALE',
    )
    // Reopen makes the old attempt boundary the freshness floor.
    const done = await driveTo(fixture, ticket, 6)
    const reopened = await fixture.service.reopen(fixture.ids.planner, {
      projectId: fixture.projectId,
      ticketId: done.id,
      targetStateCode: 3,
      reason: 'fresh attempt',
      expectedRevision: done.revision,
      idempotencyKey: fixture.key.next(),
    })
    let second = await transition(fixture, reopened.ticket.id, fixture.ids.developer, 4, reopened.ticket.revision)
    second = await transition(fixture, second.ticket.id, fixture.ids.reviewer, 5, second.ticket.revision)
    const boundary = (await refresh(fixture, second.ticket.id)).lastReopenedAt
    assert.ok(boundary !== null)
    await expectIssuesError(
      fixture.daemon.recordGateEvidence({
        projectId: fixture.projectId,
        ticketId: second.ticket.id,
        producedAt: boundary,
        gateExit: 0,
        requirements: { completed: true, output: true, report: true },
        coveredEvidenceIds: [],
        ...writeFileFor(fixture, 'old-attempt-gate.txt'),
      }),
      'GATE_EPOCH_STALE',
    )
  } finally {
    fixture.cleanup()
  }
})

test('getGateRun is project-scoped and never leaks existence', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await driveTo(fixture, await readyTicket(fixture), 5)
    const gate = await recordPassingGate(fixture, ticket)
    const missing = await fixture.service.getGateRun(fixture.ids.pm, {
      projectId: fixture.projectId,
      gateRunId: 'gate_missing',
    })
    assert.equal(missing, null)
    await expectIssuesError(
      fixture.service.getGateRun(fixture.ids.outsider, {
        projectId: fixture.projectId,
        gateRunId: gate.gateRunId,
      }),
      'PROJECT_FORBIDDEN',
    )
    assert.ok(IssuesError)
  } finally {
    fixture.cleanup()
  }
})
