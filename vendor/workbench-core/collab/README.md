# @studio-next/collab — v0.8 chat slice

Standalone TypeScript chat kernel for human and agent principals: **actors, rooms
(broadcast/group/DM), plain-text messages, directed-signal wake queue, read cursor,
digest inbox, idempotent commands, batch send/get/ack**.

This package is independent: no DSH/StudioNext imports, no external runtime
dependencies. Storage is pluggable; the default production adapter is SQLite via
`node:sqlite`, and the in-memory adapter is the reference for tests.

Implements the accepted chat design from `docs/plan/chat-room-plan.md` (v0.6) and
`docs/plan/chat-room-storage.md` (v0.6), under the v0.8 public-boundary rules
(`docs/plan/issues-platform-api-boundary.md` §7.7: storage port, batch API, opaque
cursors, stable error codes, fake/SQLite contract parity).

```
node --experimental-strip-types --test test/*.test.ts
<workspaceRoot>/node_modules/.bin/tsc --noEmit \
  --typeRoots <workspaceRoot>/node_modules/@types -p tsconfig.json
```

## What changed from the v1 kernel

| Topic | v1 kernel | v0.8 slice |
|---|---|---|
| API style | sync; `senderId` inside the input | async; principal is a host-bound method argument, body-supplied identity is `PRINCIPAL_MISMATCH` |
| Actor ids | free text | `^[a-z0-9_-]{1,64}$` (no `:`) |
| Actor status | absent | `active / paused / retired`; retired cannot send/be mentioned/DM |
| Broadcast | implicit membership; every actor may post | one room per DB (partial unique index), materialized members, `can_broadcast` grant, agent content kind gate |
| DM key | `low:high` string | `sha256(dm_low ‖ NUL ‖ dm_high)` + `UNIQUE(dm_low, dm_high)`; exactly two members |
| Messages | global `seq` only | global `seq` + contiguous `room_seq`, `kind`, `ticket_key`, `mention_all`, explicit `mentions`, `reply_to_seq` |
| Read model | `room_members.last_read_seq` | separate `read_state` (actor/room, monotonic, clamped) + `room_stats` heads |
| Notifications | `listUnread` returned bodies | directed `wake_item` queue; ambient messages only move the read cursor/digest; `checkInbox` is metadata-only |
| Read vs ack | one `markRead` | `markRead` (cursor) and `ackDelivery` (wake) are separate |
| Idempotency | optional client message `id` | `chat_command_log` PK `(actor, command, key)`, same transaction as the effect, request-hash conflict detection |
| Pagination | `afterSeq: number` | opaque, versioned, HMAC-bound `cursor` (room + principal binding) |
| Batch | none | `batchSend` (≤100), `getMessages` (≤500 by seq), `ackDelivery` (≤100 wake ids), per-item results |
| Storage | service talks to SQLite | storage port (`ChatStore`) with memory + SQLite adapters on the same contract suite |
| Schema | `user_version=1` | `user_version=2`, `schema_migrations`, STRICT tables, stats/append-only triggers |

## Model

```
Actor(id, kind=human|agent, status=active|paused|retired)
Room(kind=broadcast|group|dm)
  - broadcast: exactly one per DB; members materialized on room/actor creation
  - group: explicit members, at least one owner
  - dm: exactly two members; keyed by sha256(dm_low NUL dm_high)
Message(global seq, roomSeq contiguous per room, sender, body, kind, ticketKey, mentionAll,
        mentions[], replyToSeq)
ReadState(room, actor) — monotonic cursor, clamped to room_stats.head_room_seq
WakeItem(cause=mention|dm|reply|mention_all|on_call|system) — the only wake queue
```

**Three planes; no inbox table and no delivery fan-out.** `messages` are facts;
`read_state`+`room_stats` give exact unread arithmetic; `wake_item` is the actionable
queue. A plain room or broadcast message creates **zero** per-actor rows. Only
directed signals create wakes, one row per `(source message, target)` with the
strongest cause (`mention_all > mention > dm > reply > on_call > system`).

## Public API (exports of `src/index.ts`)

Factories: `createMemoryCollab(options?)`, `createSqliteCollab(path, options?)`.
Types and stable errors: `CollabError`/`CollabErrorCode`, DTOs, `dmKey`, `dmPair`,
`ACTOR_ID_PATTERN`.

```ts
class ChatService {
  // actors (admin/host surface: the host is responsible for who may onboard)
  createActor(input): Promise<Actor>
  getActor / listActors / setActorStatus(actorId, status)

  // rooms and membership (principal-first, membership checked, no existence leak)
  createBroadcastRoom(createdBy, {name})   // bootstrap, idempotent: one per DB
  createGroupRoom(createdBy, {name, memberIds})
  createDm(actorA, actorB)                 // duplicate pair -> same room
  getRoom / listRooms / listMembers
  addMember / removeMember                 // group only (owners; self-leave)
  setCanBroadcast(principal, roomId, actorId, boolean)  // human/owner grant only
  getRoomStats(principal, roomId) / getReadState(principal, roomId)

  // messages
  sendMessage(principal, input): Promise<SendResult>       // {seq, roomSeq, messageId, replayed}
  batchSend(principal, inputs[]): Promise<BatchResult<SendResult>>   // <=100 items
  listMessages(principal, {roomId, cursor?, limit?}): Promise<MessagePage>
  getMessages(principal, {roomId, seqs[]}): Promise<{items, missing}> // <=500 ids, one IN query

  // read state and inbox
  checkInbox(principal, {roomIds?, lastN?, includeMentions?}): Promise<InboxDigest>
  markRead(principal, {roomId, upToRoomSeq, idempotencyKey?}): Promise<MarkReadResult>

  // wake delivery
  ackDelivery(principal, {wakeIds[], idempotencyKey?}): Promise<AckResult>   // <=100 ids
  getWakeState(principal, {wakeIds[]}): Promise<WakeState[]>                 // metadata only

  close(): Promise<void>
}
```

Semantics worth knowing:

- **`checkInbox` never returns bodies.** Counts (`rooms/unread/mentions/pendingWakes`),
  per-room metadata (`headSeq/headRoomSeq/unread/mentionCount/lastActivityAt`, last 3
  `{seq, senderId, kind, createdAt}`), unread mention metadata, and pending wake ids.
  Capped at 50 rooms, `lastN` 1..20 (default 10), `roomIds` ≤ 50.
- **`markRead` is monotonic and clamped** to `room_stats.head_room_seq`; a target past
  the head clamps (it never marks future messages read) and a target behind the
  current cursor is a no-op. It never acks a wake.
- **`ackDelivery`** transitions `pending|claimed|delivered → acked`; duplicate acks are
  idempotent (`alreadyAcked`), unknown or other-actor ids are per-item
  `WAKE_NOT_FOUND`, and it never advances `read_state`.
- **Idempotency**: `sendMessage`/`markRead`/`ackDelivery` accept `idempotencyKey`,
  scoped `(principal, command, key)`, written in the same transaction as the effect.
  Replay returns the first stored response; a different request hash is
  `IDEMPOTENCY_CONFLICT`.
- **Batch writes** are bounded, per-item (`{index, status, result?|error?}`), run in
  one transaction with a savepoint per item: a failed item rolls back only itself.
  Over-limit is `VALIDATION_FAILED` before any I/O.
- **Cursor**: `listMessages` returns `nextCursor`; the token is opaque, versioned and
  HMAC-bound to `(room, principal)` — tamper, cross-room, cross-principal, malformed
  and version-mismatch are `VALIDATION_FAILED`.
- **Wake targets**: mention → mentioned members; DM → peer; reply → replied-to sender;
  `mention_all` → at most `wakeMaxTargets` (50) active members (human or room owner
  only, never in DM; the rest stay digest-only). A DM that also mentions the peer, and
  a reply that also mentions, produce one row with the stronger cause. Self-wakes and
  ambient messages produce none. Paused targets get no wake row (their digest still
  counts the unread message); retire/pause terminates outstanding wakes.
- **Paused vs retired**: `paused` is a reversible mute — a paused actor can be
  invited and may create rooms, but cannot send. `retired` is terminal — it cannot
  send, be mentioned, join/be a DM peer, or create any room kind.
- **Broadcast**: one per DB, materialized membership including future actors, send
  requires `can_broadcast`; grantor must be human or room owner and an agent can never
  grant itself. Agent broadcast content must be `kind=status|handoff`.

## Errors

`CollabError.code` is a closed union. Canonical v0.6 chat-plan/wake-model codes are
used where they exist; v0.8 boundary codes are added for storage/cursor/validation.
The following names are **additions** required by implemented behaviour but not listed
verbatim in the chat-plan closed table: `VALIDATION_FAILED` (boundary), `ACTOR_NOT_FOUND`,
`ACTOR_ALREADY_EXISTS`, `ACTOR_PAUSED`, `NOT_ROOM_OWNER`, `LAST_OWNER_FORBIDDEN`,
`BROADCAST_ALREADY_EXISTS`, `BROADCAST_FORBIDDEN`, `BROADCAST_KIND_REQUIRED`,
`MENTION_NOT_MEMBER`, `SELF_MENTION_FORBIDDEN`, `MENTION_ALL_FORBIDDEN`,
`MENTION_ALL_IN_DM`, `UNKNOWN_REPLY`, `BODY_EMPTY`, `BODY_TOO_LARGE`,
`PAGE_SIZE_INVALID`, `DUPLICATE_MESSAGE`, `DM_REQUIRES_TWO_DISTINCT_ACTORS`,
`WAKE_NOT_ACKABLE`, `STORE_CLOSED`, `STORAGE_UNAVAILABLE`, `SCHEMA_TOO_NEW`.
`RATE_LIMITED`/`*_BUDGET_EXCEEDED`/`*_QUOTA_EXCEEDED`/`BRIDGE_DUPLICATE` are reserved
for the deferred anti-spam/bridge slices and are not produced today.

## Storage port and boundary

```
public entry (index.ts) → ChatService (domain) → ChatStore port (src/store.ts) → memory / SQLite adapters
```

- The port is internal: it is not exported from the package entry and never appears
  in a public type. `ChatTx`/`ChatStore` are test-visible only through source imports.
- No SQL, table name, PRAGMA or `node:sqlite` symbol appears in `src/service.ts`,
  `src/types.ts`, `src/errors.ts`, `src/keys.ts`, `src/cursor.ts`; a test scans those
  files for engine leakage.
- `transaction(fn)` owns the boundary; `tx.savepoint(fn)` isolates one batch item.
- Both adapters pass the same contract suite (`test/storage-contract.test.ts`):
  ordering, global/room sequences, membership/broadcast/DM constraints, monotonic read
  state, wake dedupe/CAS/terminal states, command-log replay/conflict, transaction and
  savepoint rollback, digest read models, closed-store behaviour.
- SQLite is an adapter, not the contract: the public read model is JSON-shaped DTOs;
  pagination is an opaque cursor; `/healthz`-style engine diagnostics are not part of
  this package.

## SQLite schema (v0.8, adapter-internal)

Tables: `schema_migrations`, `actors` (status), `rooms` (`dm_key`/`dm_low`/`dm_high`,
`archived_at`, partial unique broadcast), `room_members` (`role`, `can_broadcast`,
PK room+actor), `messages` (global `seq`, `room_seq`, `kind`, `ticket_key`,
`mention_all`, `reply_to_seq`, `UNIQUE(room_id, room_seq)`), `message_mentions`,
`room_stats`, `read_state`, `wake_item`, `chat_command_log`.
Triggers: `tr_message_bump_stats` (heads maintained by SQL on append),
`tr_read_state_monotonic` (defence in depth; the service clamps before writing),
`tr_message_append_only` / `tr_message_no_delete`.
PRAGMAs: `journal_mode=WAL`, `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout=5000`.

Append-path note: the plan lists extra `messages(room_id, seq DESC)` / `sender_id`
indexes; they serve no current query and cost ~4x append throughput on this SQLite
build (measured), so only the indexes with a query are created. The unique
`(room_id, room_seq)` index covers room pages; the `seq` primary key covers batch reads.

## Deferred / known gaps (honest scope of this slice)

1. **Relay** (`relayTick`, claim/lease/delivery/retry/dead-letter, `wake_batch`) is not
   implemented. Wake rows stay `pending` until `ackDelivery`; pause/retire terminate
   them. `channel` is derived (`human_panel` for humans, `dsh_followup` otherwise) and
   `dsh_session_resume` is not selected dynamically.
2. **`wake_scope`** table/materialization is not implemented; `mention_all` directly
   materializes at most 50 wake rows and leaves the rest digest-only. `on_call` and
   `system` causes are accepted by the schema/type but not produced.
3. **Anti-spam** deferred: send/room/mention/broadcast quotas, `@all` time budgets,
   duplicate-body window, loop breaker, token buckets, urgency (`AGENT_URGENT_FORBIDDEN`
   / priority input). The only structural limits are body ≤16 KiB, ≤32 explicit
   mentions per message, ≤50 materialized `@all` wakes, and batch bounds.
4. **`chat_events`/`chat_outbox`** are not written: this slice has no chat-local audit
   stream; wake state is observable via `checkInbox`/`getWakeState` only.
5. **Bridge** (`chat_inbound_cursor/events`, issues→chat) and `ticket_key` relay are out
   of scope; `ticket_key` is stored as plain text.
6. **Archive** has a schema column but no API; archived rooms would be read-only and
   wake-free.
7. **SQLite version preflight** (plan pin ≥3.51.3) is not enforced in this workbench
   package; the host here runs SQLite 3.51.2. Production must add the fail-closed check.
8. **No legacy migration**: a v1 (`user_version=1`) or future schema is refused as
   `SCHEMA_TOO_NEW`. Fresh v0.8 databases only.
9. **Read-state error codes**: the wake-model doc says a read past the head is
   `READ_STATE_AHEAD`; this slice clamps instead (the chat-room-plan invariant is
   "never ahead of room_stats", and the legacy kernel clamped). `READ_STATE_BACKWARDS`
   exists on the storage trigger and is surfaced if an adapter is misused directly, but
   the service never produces it (monotonic no-op).
10. **Cursor secret** defaults to a stable package key so cursors survive a restart;
    pass `cursorSecret` in production when binding cursors to a host secret is desired.
11. `createActor`, `createBroadcastRoom`, `createDm`, `setActorStatus` are host/admin
    surfaces (they take ids, not host sessions); principal binding is the host's job.

## Tests

`node --experimental-strip-types --test test/*.test.ts` — 133 tests, all green:

- `collab.test.ts` — the 15 v1 tests, adapted to the v0.8 API (both adapters + persistence).
- `storage-contract.test.ts` — one port contract suite run against memory and SQLite (30).
- `wake.test.ts` — directed wakes, dedupe/strongest cause, @all bounds, paused/retired,
  ack/read separation, metadata-only digest, unread/join baseline, broadcast flood (30).
- `security.test.ts` — actor-id gate, DM identity/privacy, principal mismatch,
  broadcast governance, mention rules, body/kind/ticket/reply validation, cursor
  tamper/rebind, domain-layer boundary scan (20).
- `idempotency.test.ts` — replay/conflict, per-principal scope, markRead/ack replay,
  command-log rollback on mid-transaction failure, batch replay (12).
- `batch.test.ts` — per-item results, over-limit before I/O, savepoint isolation,
  no-N+1 port-call counts, bounded batch get/ack (14).
- `persistence.test.ts` — reopen recovery, sequence continuity, cursor across restart,
  schema refusal, WAL/migration/adapter checks (5).
- `cursor.test.ts` — opaque token binding/version/tamper unit tests (5).
- `stress.test.ts` — 1k actors / 1k rooms / 100k messages / 1k plain broadcasts per
  adapter; asserts zero wake rows, read rows bounded by actor count, contiguous
  `room_seq`, exact unread arithmetic. Set `COLLAB_STRESS_SCALE=small` for a quick run.
