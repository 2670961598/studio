# @studio-next/issues

Standalone first slice of the StudioNext **issue platform** (plan v0.8, cycle-4
limited closure). It is a pure TypeScript package: no external runtime
dependencies, no DSH/daemon imports, no network, no HTTP layer. Storage is
`node:sqlite` (or an in-memory adapter with the same contract); runtime is Node's
native type stripping (`node --experimental-strip-types`).

The package is deliberately **separate from `packages/collab`** (chat): two
databases, two migrations, no shared tables.

## Commands

```sh
# full suite (node:test, native TS execution)
node --experimental-strip-types --test test/*.test.ts

# type gate (any TypeScript >= 5.9; the repo compiler also works)
tsc --noEmit -p tsconfig.json
```

Both are green in this slice: **80 tests passing**, typecheck `exit 0`.
The stress test is configurable (see "Tests"):

```sh
ISSUES_STRESS_TICKETS=10000 ISSUES_STRESS_COMMENTS=100000 \
ISSUES_STRESS_TRANSITIONS=6 ISSUES_STRESS_BUDGET_MS=180000 \
node --experimental-strip-types --test test/stress.test.ts
```

## Quick start

```ts
import { createSqliteIssues } from '@studio-next/issues'

const { service, daemon, close } = createSqliteIssues('./issues.db', {
  evidenceRoot: './evidence',          // evidence URIs are confined here
  cursorKey: process.env.ISSUES_CURSOR_KEY, // stable opaque-cursor HMAC key
})

const admin = await service.createPrincipal({ kind: 'human', displayName: 'PM' })
const dev = await service.createPrincipal({ kind: 'agent', displayName: 'Dev' })
const reviewer = await service.createPrincipal({ kind: 'agent', displayName: 'QA' })

const project = await service.createProject(admin.id, { keyPrefix: 'LOCAL', name: 'Local' })
// A human makes the first (bootstrap) grant; later grants need a PLANNER member.
await service.grantMembership(admin.id, {
  projectId: project.id, principalId: dev.id, roles: ['DEVELOPER'],
  reason: 'onboarding', idempotencyKey: 'grant-1',
})

const ticket = await service.createTicket(admin.id, {
  projectId: project.id, title: 'Ship the first slice', idempotencyKey: 'create-1',
})
const assigned = await service.assign(admin.id, {
  projectId: project.id, ticketId: ticket.id, assigneeId: dev.id,
  reviewerId: reviewer.id, expectedRevision: ticket.revision, idempotencyKey: 'assign-1',
})
await service.transition(admin.id, {
  projectId: project.id, ticketId: ticket.id, targetStateCode: 2,
  expectedRevision: assigned.revision, idempotencyKey: 't1-1',
})

// The harvest verdict is written only through the daemon port (never the
// public service): the executor cannot self-report DONE.
await daemon.recordGateEvidence({
  projectId: project.id, ticketId: ticket.id, gateExit: 0,
  requirements: { completed: true, output: true, report: true },
  coveredEvidenceIds: [], uri: 'gate/run-1.json',
})
```

Every write carries `expectedRevision` where it mutates a ticket, and an
`idempotencyKey`; the replay scope is `(principal, command, key)`.

## Layers (plan Part 2d §7.7.1)

```
Public API      src/index.ts, src/types.ts: DTOs, opaque cursors, stable errors
Domain          src/service*.ts, src/core.ts, src/catalog.ts: matrix, invariants, events
Storage port    src/store.ts (internal, never re-exported): TicketStore / TicketTx
Adapters        src/memory-store.ts, src/sqlite-store.ts, src/sqlite-schema.ts
```

Public DTOs/errors never name SQLite, SQL, tables or a driver; `/healthz`-style
engine diagnostics are out of scope for the in-process slice. The storage port
is not exported from the package entry point.

## Domain rules in this slice

- **State catalog 1..8** (`NEW, TODO, IN_PROGRESS, TESTING, TEST_IN_PROGRESS,
  DONE, BLOCKED, CANCELLED`) as a frozen domain table; tickets store
  `state_code` only.
- **Frozen transition matrix T1–T14** (14 ids / 19 expanded edges; T11 and T12
  have multiple edges) plus the two declared reopen edges **T15/T16** through
  the separate `reopen` command. Golden tests compare the whole matrix.
- **Action-level permissions** (`read/create/update/delete/transition/comment/
  assign/reassign/reparent/governance/close/reopen/policy:write`) with the
  frozen grant table; relation hard rules: reviewer ≠ assignee, reviewer holds
  `TESTER`, reviewer/assignee frozen from `TESTING` (only `reassign` may change
  them non-terminally and it invalidates evidence), PLANNER-only reparent.
- **`requires_human`** is written only by the human `governance` command; P0/P1
  are forced to `1` by storage CHECK; flagged tickets require a human actor for
  `T7`, `close` and `reopen`.
- **CAS revision** on every ticket mutation; `STALE_REVISION` carries current
  revision/state/allowed transitions. **Idempotency** via a command log with
  request hash (different hash → `IDEMPOTENCY_CONFLICT`; keys never shared
  across principals).
- **Parent model**: `tickets.parent_id` only — same project, parent exists, no
  self-parent, no cycle, depth ≤ 3 **including the moved subtree height**
  (C4-L1 re-hang case), PLANNER-only `reparent` with reason + CAS +
  `ticket.reparented`; state never changes; a post-harvest reparent supersedes a
  written verdict (`GATE_EPOCH_STALE`).
- **Flat comments**: one table, immutable `reply_to_comment_id` (same ticket
  only), append-only, no revision bump, allowed in terminal states, opaque
  cursor ordering by internal `seq`.
- **Evidence + gate**: evidence is a root-relative file reference whose
  `sha256` is computed by the platform and re-checked at `T7`; `gate` evidence
  and `gate_runs` verdicts are written only through the daemon port in one
  transaction; `T7` requires a passing verdict at the ticket's **current**
  revision (gate epoch), above the attempt lower bound, covering exactly the
  current attempt's non-gate evidence, with its own bound gate trace.
- **Append-only events** with `type/actor/kind/revision_before/revision_after/
  payload`, per-chain `prevHash`/`entryHash` (GENESIS start, canonical JSON
  payload hash), and a minimal outbox row written in the same transaction.
- **Opaque cursors** (versioned, HMAC-signed, bound to stream/project/ticket/
  query shape): tamper, rebind, cross-project/query reuse and version mismatch
  are `VALIDATION_FAILED`; the position inside the token (e.g. the internal
  comment-ordering `seq`) is an encoding detail, never exposed as a request
  parameter or a comment DTO field. The event envelope's public `seq` field is
  a deliberate exception and is not a cursor.
- **Batch API**: `getTickets(ids ≤ 500)`, `getComments(ids ≤ 500)` with
  chunked `IN` reads (no N+1), and `batchAddComments` / `batchTransitionTickets`
  (≤ 100 items) with per-item auth/CAS/idempotency, `BatchResult.items[]`
  envelope, independent by default, `atomic: true` restricted to one ticket.
- **Domain rejection before I/O**: oversized batches/limits are rejected before
  any write; batch items never widen a grant.

## Tests

| File | Covers |
|---|---|
| `test/state-matrix.test.ts` | T-G-01 golden catalog/matrix/grants; every allowed matrix row; wrong-role denials; matrix misses; project isolation |
| `test/ticket-flow.test.ts` | create/validation/P0 gating; assign/T1; reviewer rules; T3 evidence policy; reviewer freeze; reassign/evidence invalidation; governance; flagged T7/close; close; archive; update matrix + frozen body; WIP limits |
| `test/cas-idempotency.test.ts` | CAS details; idempotency replay/conflict/scope; concurrent exactly-one-winner; reopen-vs-archive race; event hash chain |
| `test/parent.test.ts` | create-with-parent depth; five reparent checks; C4-L1 re-hang; post-harvest verdict staleness; children/descendants; T-P-17 depth property |
| `test/comments.test.ts` | append-only flat comments, reply pointers, validation, terminal comments, seq cursor pagination |
| `test/reopen.test.ts` | T15/T16, terminal facts, no-op/undeclared targets, grant + self-reopen + human rules, new-attempt evidence/verdict freshness |
| `test/evidence-gate.test.ts` | daemon-only verdict, forged gate evidence rejection, coverage equality, non-passing verdict, sha swap, URI containment (absolute/`..`/scheme/dir/symlink), gate epoch + attempt freshness, project-scoped read |
| `test/batch.test.ts` | batch read order/missing/no-N+1/bounds; independent + atomic batch writes; replay after partial failure; no privilege elevation |
| `test/store-contract.test.ts` | one suite against memory **and** SQLite: CAS, rollback, chunking, event chain, ordering, command log, append-only surface |
| `test/persistence.test.ts` | close/reopen durability; append-only DB triggers; forged gate evidence trigger; `SCHEMA_TOO_NEW`; internal strict-pin behavior; public factory is engine-option-free; total error mapping |
| `test/cursor-validation.test.ts` | cursor tamper/version/binding/cross-query/cross-ticket; identity spoofing; validation; policy; grants; T-SEC-30 public-surface + README-contract scan (no engine options, journal or version-pin tokens) |
| `test/stress.test.ts` | configurable N tickets/comments/transitions + pagination + batch + concurrency, default 400/800/6 finishing in ~1.2 s |

## Implemented vs deferred (honest slice boundary)

**Implemented** (tested): the public command/read API above; memory + SQLite
adapters and the shared contract suite; state/transition/permission matrices;
CAS + idempotency; parent_id model incl. re-hang; flat comments; evidence/gate
core with daemon-only verdicts; append-only events + hash chain + minimal
outbox; opaque cursors; batch reads/writes; persistence and DB-level integrity
(CHECKs/triggers); configurable stress.

**Deferred** (not claimed): HTTP/SSE transport and host session-token binding
(the in-process port is the identity boundary; wire-shaped identity strings are
rejected); ticket links (`blocks`/`relates`, so the "no open blocks edge" T1/T2
precondition is trivially satisfied); outbox relay/dead-letter/consumer lag;
`auditReplay`/projection replay; `exportProject`; ready-queue scoring
(`listReady`); SLA/automation/budget/breaker policy and `policy_json` extras
beyond WIP/evidence/reopenPrincipals; `artifact://` evidence; on-disk
backups, lock file, checkpoint policy, migration steps beyond the single v1
step, crash/fault injection (L6), perf percentile harness (L8); batch
`createTickets`/`assignTickets`; comment editing/deletion (impossible by
design); approval engine/quorum (never in scope).

## Deviations from the v0.8 docs (recorded, not silent)

1. **`state_catalog` is not a persisted table.** Part 2d §7.7.1 rule 7 makes
   states/transitions a domain enum and the catalog only an integrity check;
   the adapter stores `state_code` integers with 1..8 CHECKs, and the frozen
   catalog is exported as `STATE_CATALOG`.
2. **`events.occurred_at` column added.** The Part 2a DDL has only
   `created_at`, while the §8.1 envelope carries `occurredAt`; both adapters
   persist the envelope field.
3. **`events.actor_kind` accepts `daemon`.** §8.1 restricts the envelope to
   human/agent, but gate verdicts are daemon-authored and must be audited; the
   extension is explicit in the CHECK.
4. **Membership is one role-row table** (`(project, principal, role,
   added_by, added_at)`) rather than a header + role table; one row per role is
   preserved and `added_by <> principal_id` is enforced.
5. **`recordGateEvidence` is not on the public `TicketService`.** The factory
   returns `{ service, daemon }`; the daemon port is the only writer of
   `gate_runs` / `gate` evidence, which makes "the executor cannot self-report"
   structural rather than a runtime check.
6. **Atomic batch failure envelope.** `atomic: true` failures return a
   `BatchResult` where the failing item carries its code and siblings carry
   `VALIDATION_FAILED` with `{atomicAborted, failedIndex}`; nothing is written.
7. **Storage-engine version pin.** v0.8 requires the patched storage-engine
   release; the recorded host runtime is below it. The pin is evaluated **inside
   the adapter** (`evaluateSqliteVersion()`), and the **public factory exposes no
   engine-specific option** — `IssuesOptions` only contains engine-neutral
   fields, so no caller has to know the storage engine. The default keeps this
   slice runnable on the recorded host; adapter-level tests can request the
   fail-closed strict-pin policy through internal store options. This is a
   **known gap**, not a claim that the upstream race fix is present.
8. **No migration history table / backups / lock file.** One additive
   schema-version migration (version 1); forward-only and `SCHEMA_TOO_NEW`
   fail-closed are implemented.
9. **Memory adapter transactions roll back via a structured snapshot.** It is
   the contract-test fake, not a production store; the stress test runs SQLite.
10. **Reviewer-freeze (`REVIEWER_FROZEN`) is defense-in-depth.** Public paths
    re-anchor the reviewer through `reassign` + a fresh `T3`, so the baseline
    comparison is tested against the T3 event payload rather than a forged
    state; `assign` after `TESTING` is rejected as `REVIEWER_FROZEN`.
11. **Line-count discipline.** Several files exceed the plan's 600-line split
    guidance (`src/sqlite-store.ts` is the largest). The main-repo boundary
    guard does not run on this standalone package; a real split is deferred and
    listed here rather than hidden.

## Notes

- Evidence `sha256` is computed from the file at submit and re-read at `T7`;
  there is no open-handle snapshot, so the TOCTOU window is narrowed but not
  eliminated (documented residual risk, not a claimed fix).
- `Idempotency-Key` retention (30 days) is not scheduled; keys live with the
  command log.
- Canonical JSON is a documented JCS/RFC 8785 subset (lexicographic keys, no
  whitespace); event `entry_hash = sha256(canonicalEnvelope + "|" + prevHash)`.
