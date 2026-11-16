import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryIssuesStore } from '../src/memory-store.ts'
import { SqliteIssuesStore } from '../src/sqlite-store.ts'
import { IssuesError } from '../src/errors.ts'
import type {
  EventRow,
  NewEvent,
  PrincipalRow,
  ProjectRow,
  TicketRow,
  TicketStore,
} from '../src/store.ts'

type StoreFactory = () => { store: TicketStore; cleanup: () => void; kind: 'memory' | 'sqlite' }

const factories: StoreFactory[] = [
  () => {
    const store = new MemoryIssuesStore()
    return { store, cleanup: () => store.close(), kind: 'memory' }
  },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-issues-store-'))
    const store = new SqliteIssuesStore(join(dir, 'issues.db'))
    return {
      store,
      cleanup: () => {
        store.close()
        rmSync(dir, { recursive: true, force: true })
      },
      kind: 'sqlite',
    }
  },
]

function principal(id: string, kind: PrincipalRow['kind'] = 'agent'): PrincipalRow {
  return { id, kind, displayName: id, status: 'active', createdAt: 100 }
}

function project(id: string, prefix: string): ProjectRow {
  return {
    id,
    keyPrefix: prefix,
    name: `project ${id}`,
    nextTicketSeq: 1,
    policyJson: '{"wipLimitPerWorker":8,"wipLimitPerProject":200,"evidenceRequired":"none","reopenPrincipals":[]}',
    policyGeneration: 1,
    createdAt: 100,
    archivedAt: null,
  }
}

function ticket(id: string, projectId: string, overrides: Partial<TicketRow> = {}): TicketRow {
  return {
    id,
    projectId,
    key: `KEY-${id}`,
    title: `ticket ${id}`,
    body: '',
    kind: 'task',
    priority: 2,
    stateCode: 1,
    assigneeId: null,
    reviewerId: null,
    requiresHuman: 0,
    parentId: null,
    createdBy: 'p1',
    revision: 1,
    blockReason: null,
    resumeStateCode: null,
    policyGeneration: 1,
    reworkCount: 0,
    reopenCount: 0,
    lastReopenedAt: null,
    lastReopenReason: null,
    createdAt: 100,
    updatedAt: 100,
    lastActivityAt: 100,
    doneAt: null,
    archivedAt: null,
    ...overrides,
  }
}

function event(overrides: Partial<NewEvent> = {}): NewEvent {
  return {
    id: overrides.id ?? 'evt_1',
    projectId: 'prj_1',
    ticketId: 'tkt_1',
    chainKey: 'ticket:tkt_1',
    type: 'ticket.created',
    actorId: 'p1',
    actorKind: 'agent',
    occurredAt: 100,
    revisionBefore: 0,
    revisionAfter: 1,
    fromStateCode: null,
    toStateCode: 1,
    payload: { key: 'KEY-1' },
    idempotencyKey: overrides.idempotencyKey ?? null,
    outboxTopic: 'ticket.created',
    ...overrides,
  }
}

test('store contract: both adapters satisfy the same persistence contract', async () => {
  for (const factory of factories) {
    const { store, cleanup, kind } = factory()
    try {
      store.bootstrap(100)
      store.transaction(tx => {
        store.insertPrincipal(tx, principal('p1'))
        store.insertPrincipal(tx, principal('p2'))
        store.insertPrincipal(tx, principal('h1', 'human'))
        store.insertProject(tx, project('prj_1', 'KEY'))
        store.insertMembership(tx, {
          projectId: 'prj_1',
          principalId: 'p1',
          role: 'PLANNER',
          addedBy: 'h1',
          addedAt: 100,
        })
        store.insertMembership(tx, {
          projectId: 'prj_1',
          principalId: 'p1',
          role: 'DEVELOPER',
          addedBy: 'h1',
          addedAt: 100,
        })
        store.insertMembership(tx, {
          projectId: 'prj_1',
          principalId: 'p2',
          role: 'TESTER',
          addedBy: 'h1',
          addedAt: 100,
        })
        store.insertTicket(tx, ticket('tkt_1', 'prj_1'))
        store.insertTicket(tx, ticket('tkt_2', 'prj_1', { stateCode: 2, priority: 1, requiresHuman: 1 }))
        store.insertTicket(tx, ticket('tkt_3', 'prj_1', { archivedAt: 500, stateCode: 6, doneAt: 400 }))
        store.setLabels(tx, 'tkt_1', ['bug', 'p1'])
      })

      store.transaction(tx => {
        // principals / project / membership
        assert.equal(store.getPrincipal(tx, 'p1')?.id, 'p1', kind)
        assert.equal(store.getPrincipal(tx, 'missing'), undefined)
        assert.deepEqual(store.getMembershipRoles(tx, 'prj_1', 'p1'), ['DEVELOPER', 'PLANNER'])
        assert.equal(store.listMemberships(tx, 'prj_1').length, 3)
        assert.equal(store.getProject(tx, 'prj_1')?.keyPrefix, 'KEY')
        assert.equal(
          store.updateProjectPolicy(tx, 'prj_1', 1, '{"x":1}', 200),
          true,
          'policy CAS succeeds',
        )
        assert.equal(
          store.updateProjectPolicy(tx, 'prj_1', 1, '{"x":2}', 200),
          false,
          'stale policy CAS loses',
        )
        assert.equal(store.getProject(tx, 'prj_1')?.policyGeneration, 2)

        // key allocation is monotonic inside the transaction
        assert.deepEqual(store.allocateTicketKey(tx, 'prj_1', 200), { seq: 1, key: 'KEY-1' })
        assert.deepEqual(store.allocateTicketKey(tx, 'prj_1', 200), { seq: 2, key: 'KEY-2' })

        // tickets and batches
        assert.equal(store.getTicket(tx, 'prj_1', 'tkt_1')?.id, 'tkt_1')
        assert.equal(store.getTicket(tx, 'prj_1', 'tkt_2')?.id, 'tkt_2')
        assert.equal(store.getTicketByIdOrKey(tx, 'prj_1', 'KEY-tkt_2')?.id, 'tkt_2')
        const batch = store.getTicketsByIds(tx, 'prj_1', ['tkt_2', 'nope', 'tkt_1'])
        assert.deepEqual(batch.map(row => row.id).sort(), ['tkt_1', 'tkt_2'])
        assert.deepEqual(store.getLabels(tx, 'tkt_1'), ['bug', 'p1'])
        const labelMap = store.getLabelsForTickets(tx, ['tkt_1', 'tkt_2'])
        assert.deepEqual(labelMap.get('tkt_1'), ['bug', 'p1'])
        assert.equal(labelMap.get('tkt_2'), undefined)
        assert.equal(store.getTicketProject(tx, 'tkt_2'), 'prj_1')
        assert.equal(store.getTicketProject(tx, 'missing'), undefined)

        // CAS
        const updated = store.updateTicketCas(tx, 'tkt_1', 1, {
          stateCode: 2,
          updatedAt: 150,
          lastActivityAt: 150,
        })
        assert.equal(updated?.revision, 2, kind)
        assert.equal(updated?.stateCode, 2)
        assert.equal(
          store.updateTicketCas(tx, 'tkt_1', 1, { stateCode: 3, updatedAt: 160, lastActivityAt: 160 }),
          undefined,
          'CAS lose returns undefined',
        )
        assert.equal(store.getTicket(tx, 'prj_1', 'tkt_1')?.stateCode, 2)

        // queries, ordering, cursor position, archive filter
        const all = store.queryTickets(tx, 'prj_1', {}, null, 50)
        assert.deepEqual(all.map(row => row.id), ['tkt_1', 'tkt_2'], 'archived excluded and ordered')
        const page1 = store.queryTickets(tx, 'prj_1', {}, null, 1)
        assert.equal(page1.length, 1)
        const first = page1[0] as TicketRow
        const page2 = store.queryTickets(
          tx,
          'prj_1',
          {},
          { updatedAt: first.updatedAt, id: first.id },
          50,
        )
        assert.equal(page2.length, 1)
        assert.notEqual(page2[0]?.id, first.id, 'exclusive position')
        assert.equal(store.queryTickets(tx, 'prj_1', { stateCodes: [2] }, null, 50).length, 2)
        assert.equal(store.queryTickets(tx, 'prj_1', { label: 'bug' }, null, 50).length, 1, 'label filter')
        assert.equal(store.queryTickets(tx, 'prj_1', { includeArchived: true }, null, 50).length, 3)
        assert.equal(store.countTickets(tx, 'prj_1', { stateCodes: [2] }), 2)

        // parent derivation (insert depth chain)
        store.insertTicket(tx, ticket('tkt_4', 'prj_1', { parentId: 'tkt_1' }))
        store.insertTicket(tx, ticket('tkt_5', 'prj_1', { parentId: 'tkt_4' }))
        assert.deepEqual(store.listChildren(tx, 'prj_1', 'tkt_1').map(row => row.id), ['tkt_4'])
        assert.deepEqual(store.listAncestorIds(tx, 'tkt_5'), ['tkt_4', 'tkt_1'])
        assert.equal(store.maxSubtreeDepth(tx, 'tkt_1'), 2)
        assert.deepEqual(
          store.listDescendants(tx, 'tkt_1').map(row => [row.id, row.depth]),
          [
            ['tkt_4', 1],
            ['tkt_5', 2],
          ],
        )

        // comments: append-only ordering
        const c1 = store.insertComment(tx, {
          id: 'cmt_1',
          ticketId: 'tkt_1',
          authorId: 'p1',
          body: 'one',
          replyToCommentId: null,
          createdAt: 100,
        })
        const c2 = store.insertComment(tx, {
          id: 'cmt_2',
          ticketId: 'tkt_1',
          authorId: 'p2',
          body: 'two',
          replyToCommentId: 'cmt_1',
          createdAt: 100,
        })
        assert.ok(c1.seq < c2.seq)
        assert.deepEqual(store.listComments(tx, 'tkt_1', 0, 50).map(row => row.id), ['cmt_1', 'cmt_2'])
        assert.deepEqual(store.listComments(tx, 'tkt_1', c1.seq, 50).map(row => row.id), ['cmt_2'])
        assert.deepEqual(store.getCommentsByIds(tx, 'prj_1', ['cmt_2', 'cmt_missing']).map(row => row.id), ['cmt_2'])
        assert.deepEqual(store.getCommentsByIds(tx, 'other_project', ['cmt_2']), [])

        // evidence / gate run
        store.insertGateRun(tx, {
          id: 'gate_1',
          ticketId: 'tkt_1',
          ticketRevision: 2,
          producedAt: 300,
          gateExit: 0,
          reqCompleted: 1,
          reqOutput: 1,
          reqReport: 1,
          coveredEvidenceIds: [],
          recordSha256: 'a'.repeat(64),
          createdBy: 'daemon:local',
          createdAt: 300,
        })
        store.insertEvidence(tx, {
          id: 'evd_1',
          ticketId: 'tkt_1',
          ticketRevision: 1,
          kind: 'report',
          uri: 'report.txt',
          sha256: 'b'.repeat(64),
          bytes: 10,
          producer: 'agent',
          gateRunId: null,
          createdBy: 'p1',
          createdAt: 120,
        })
        assert.equal(store.getEvidence(tx, 'evd_1')?.uri, 'report.txt')
        assert.deepEqual(store.getEvidenceByIds(tx, ['evd_1']).map(row => row.id), ['evd_1'])
        assert.equal(store.listEvidence(tx, 'tkt_1').length, 1)
        assert.equal(store.getGateRun(tx, 'gate_1')?.gateExit, 0)
        assert.equal(store.listGateRuns(tx, 'tkt_1').length, 1)

        // events: hash chain, payload match, streams, outbox, idempotency
        const appended = store.appendEvents(tx, [event()], 130)
        assert.equal(appended.length, 1)
        const firstEvent = appended[0] as EventRow
        assert.equal(firstEvent.prevHash, 'GENESIS')
        assert.equal(firstEvent.entryHash.length, 64)
        const secondEvent = store.appendEvents(
          tx,
          [event({ id: 'evt_2', type: 'ticket.transitioned', revisionBefore: 1, revisionAfter: 2 })],
          131,
        )[0] as EventRow
        assert.equal(secondEvent.prevHash, firstEvent.entryHash, 'chain link')
        assert.ok(secondEvent.seq > firstEvent.seq, 'global seq monotonic')
        const match = store.getLastTicketEvent(tx, 'tkt_1', 'ticket.transitioned', {
          key: 'ruleId',
          value: 'T3',
        })
        assert.equal(match, undefined)
        const trans = store.appendEvents(
          tx,
          [
            event({
              id: 'evt_3',
              type: 'ticket.transitioned',
              payload: { ruleId: 'T3' },
              revisionBefore: 2,
              revisionAfter: 3,
            }),
          ],
          132,
        )[0] as EventRow
        assert.equal(store.getLastTicketEvent(tx, 'tkt_1', 'ticket.transitioned')?.id, 'evt_3')
        assert.equal(
          store.getLastTicketEvent(tx, 'tkt_1', 'ticket.transitioned', { key: 'ruleId', value: 'T3' })?.id,
          trans.id,
        )
        assert.deepEqual(store.listTicketEvents(tx, 'tkt_1', firstEvent.seq, 50).map(row => row.id), [
          'evt_2',
          'evt_3',
        ])
        assert.equal(store.listProjectEvents(tx, 'prj_1', 0, 50).length, 3)
        assert.equal(store.listProjectEvents(tx, 'other', 0, 50).length, 0)
        const outbox = store.listOutbox(tx, 50)
        assert.equal(outbox.length, 3)
        assert.equal(outbox[0]?.topic, 'ticket.created')
        assert.equal(outbox[2]?.status, 'pending')

        // command log
        store.insertCommandLog(tx, {
          principalId: 'p1',
          command: 'createTicket',
          idempotencyKey: 'idem-1',
          requestHash: 'hash',
          responseJson: '{"ok":true}',
          createdAt: 150,
        })
        assert.equal(store.getCommandLog(tx, 'p1', 'createTicket', 'idem-1')?.responseJson, '{"ok":true}')
        assert.equal(store.getCommandLog(tx, 'p2', 'createTicket', 'idem-1'), undefined)
      })

      // per-actor idempotency key is unique across events
      store.transaction(tx => {
        store.appendEvents(tx, [event({ id: 'evt_4', idempotencyKey: 'idem-dup' })], 140)
      })
      assert.throws(
        () =>
          store.transaction(tx => {
            store.appendEvents(tx, [event({ id: 'evt_5', idempotencyKey: 'idem-dup' })], 141)
          }),
        (error: unknown) => error instanceof IssuesError,
      )

      // transaction rollback: no partial projection
      assert.throws(() =>
        store.transaction(tx => {
          store.insertPrincipal(tx, principal('rollback'))
          throw new Error('boom')
        }),
      )
      store.transaction(tx => {
        assert.equal(store.getPrincipal(tx, 'rollback'), undefined, `${kind}: rollback`)
      })

      // batch reads are chunked internally, never N+1
      const before = (store as { queryCount?: number }).queryCount ?? 0
      store.transaction(tx => {
        const ids = Array.from({ length: 500 }, (_, index) => `tkt_none_${index}`)
        assert.equal(store.getTicketsByIds(tx, 'prj_1', ids).length, 0)
      })
      const after = (store as { queryCount?: number }).queryCount ?? 0
      if (kind === 'memory') assert.equal(after - before, 1)
      else assert.ok(after - before <= 3, 'sqlite chunks 500 ids into <=3 queries')

      // append-only by construction: the port exposes no mutation method
      for (const forbidden of ['updateEvent', 'deleteEvent', 'updateComment', 'deleteComment']) {
        assert.equal(typeof (store as unknown as Record<string, unknown>)[forbidden], 'undefined')
      }

      // bootstrap ensures the internal daemon principal
      store.bootstrap(200)
      store.bootstrap(200)
      store.transaction(tx => {
        assert.equal(store.getPrincipal(tx, 'daemon:local')?.kind, 'daemon')
      })
    } finally {
      cleanup()
    }
  }
})

test('store contract: closed stores fail closed with STORAGE_UNAVAILABLE', () => {
  const store = new MemoryIssuesStore()
  store.close()
  assert.throws(
    () => store.transaction(tx => tx),
    (error: unknown) => error instanceof IssuesError && error.code === 'STORAGE_UNAVAILABLE',
  )
})
