import { IssuesError } from './errors.ts'

/**
 * SQLite adapter schema (internal; never re-exported from the public entry).
 *
 * Simplifications versus the full v0.8 DDL, recorded in README "implemented vs
 * deferred": one `memberships` table carries the (project, principal, role) row
 * with `added_by`/`added_at` (no separate grant header table), the `state_catalog`
 * table is not persisted because v0.8 Part 2d rule 7 makes transitions/states a
 * domain enum with the catalog as an integrity check only, and the append-only /
 * gate-binding triggers are kept.
 */

export const SCHEMA_VERSION = 1

/** v0.8 pins SQLite >= 3.51.3 (WAL-reset race fix). */
export const REQUIRED_SQLITE_VERSION = '3.51.3'

export interface SqliteVersionAssessment {
  observed: string
  required: string
  supported: boolean
}

/** Pure version gate; the factory decides whether to fail closed (see README). */
export function evaluateSqliteVersion(observed: string): SqliteVersionAssessment {
  return {
    observed,
    required: REQUIRED_SQLITE_VERSION,
    supported: compareVersions(observed, REQUIRED_SQLITE_VERSION) >= 0,
  }
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(part => Number.parseInt(part, 10))
  const b = right.split('.').map(part => Number.parseInt(part, 10))
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const av = Number.isFinite(a[index]) ? (a[index] as number) : 0
    const bv = Number.isFinite(b[index]) ? (b[index] as number) : 0
    if (av !== bv) return av < bv ? -1 : 1
  }
  return 0
}

/** Additive forward-only schema; applied once when `PRAGMA user_version = 0`. */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS principals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('human','agent','daemon')),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','retired')),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  key_prefix TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  next_ticket_seq INTEGER NOT NULL DEFAULT 1,
  policy_json TEXT NOT NULL,
  policy_generation INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  archived_at INTEGER
) STRICT;

CREATE TABLE IF NOT EXISTS memberships (
  project_id TEXT NOT NULL REFERENCES projects(id),
  principal_id TEXT NOT NULL REFERENCES principals(id),
  role TEXT NOT NULL CHECK (role IN ('PLANNER','DEVELOPER','TESTER')),
  added_by TEXT NOT NULL REFERENCES principals(id),
  added_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, principal_id, role),
  CHECK (added_by <> principal_id)
) STRICT;

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  key TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 512),
  body TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'task' CHECK (kind IN ('task','bug','chore')),
  priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 0 AND 3),
  state_code INTEGER NOT NULL DEFAULT 1 CHECK (state_code BETWEEN 1 AND 8),
  assignee_id TEXT REFERENCES principals(id),
  reviewer_id TEXT REFERENCES principals(id),
  requires_human INTEGER NOT NULL DEFAULT 0 CHECK (requires_human IN (0,1)),
  parent_id TEXT REFERENCES tickets(id),
  created_by TEXT NOT NULL REFERENCES principals(id),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  block_reason TEXT,
  resume_state_code INTEGER CHECK (resume_state_code IS NULL OR resume_state_code BETWEEN 1 AND 8),
  policy_generation INTEGER NOT NULL,
  rework_count INTEGER NOT NULL DEFAULT 0 CHECK (rework_count >= 0),
  reopen_count INTEGER NOT NULL DEFAULT 0 CHECK (reopen_count >= 0),
  last_reopened_at INTEGER,
  last_reopen_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  done_at INTEGER,
  archived_at INTEGER,
  UNIQUE (project_id, key),
  CHECK (state_code <> 7 OR (block_reason IS NOT NULL AND resume_state_code IS NOT NULL)),
  CHECK (reviewer_id IS NULL OR reviewer_id <> assignee_id),
  CHECK ((reopen_count = 0) = (last_reopened_at IS NULL)),
  CHECK (priority > 1 OR requires_human = 1)
) STRICT;

CREATE TABLE IF NOT EXISTS ticket_labels (
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  label TEXT NOT NULL,
  PRIMARY KEY (ticket_id, label)
) STRICT;

CREATE TABLE IF NOT EXISTS gate_runs (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  ticket_revision INTEGER NOT NULL CHECK (ticket_revision >= 1),
  produced_at INTEGER NOT NULL,
  gate_exit INTEGER NOT NULL CHECK (gate_exit IN (0,1)),
  req_completed INTEGER NOT NULL CHECK (req_completed IN (0,1)),
  req_output INTEGER NOT NULL CHECK (req_output IN (0,1)),
  req_report INTEGER NOT NULL CHECK (req_report IN (0,1)),
  covered_evidence_ids TEXT NOT NULL CHECK (json_valid(covered_evidence_ids)),
  record_sha256 TEXT NOT NULL CHECK (length(record_sha256) = 64),
  created_by TEXT NOT NULL REFERENCES principals(id),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  ticket_revision INTEGER NOT NULL CHECK (ticket_revision >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('summary','report','gate','patch','trace')),
  uri TEXT NOT NULL CHECK (uri NOT LIKE '/%' AND uri NOT LIKE 'file:%' AND instr(uri, '..') = 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  bytes INTEGER CHECK (bytes IS NULL OR (bytes >= 0 AND bytes <= 67108864)),
  producer TEXT NOT NULL CHECK (producer IN ('daemon','human','agent')),
  gate_run_id TEXT REFERENCES gate_runs(id),
  created_by TEXT NOT NULL REFERENCES principals(id),
  created_at INTEGER NOT NULL,
  CHECK (kind <> 'gate' OR (producer = 'daemon' AND gate_run_id IS NOT NULL))
) STRICT;

CREATE TABLE IF NOT EXISTS comments (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  author_id TEXT NOT NULL REFERENCES principals(id),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 16384 AND instr(body, char(0)) = 0),
  reply_to_comment_id TEXT REFERENCES comments(id),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects(id),
  ticket_id TEXT REFERENCES tickets(id),
  chain_key TEXT NOT NULL,
  type TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES principals(id),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('human','agent','daemon')),
  occurred_at INTEGER NOT NULL,
  revision_before INTEGER NOT NULL,
  revision_after INTEGER NOT NULL,
  from_state_code INTEGER CHECK (from_state_code IS NULL OR from_state_code BETWEEN 1 AND 8),
  to_state_code INTEGER CHECK (to_state_code IS NULL OR to_state_code BETWEEN 1 AND 8),
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  prev_hash TEXT NOT NULL,
  entry_hash TEXT NOT NULL,
  idempotency_key TEXT,
  created_at INTEGER NOT NULL,
  CHECK (ticket_id IS NOT NULL OR type IN ('membership.granted','membership.revoked','project.policy_updated')),
  CHECK (chain_key = 'ticket:' || ticket_id OR chain_key = 'project:' || project_id)
) STRICT;

CREATE TABLE IF NOT EXISTS outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(id),
  topic TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER
) STRICT;

CREATE TABLE IF NOT EXISTS command_log (
  principal_id TEXT NOT NULL REFERENCES principals(id),
  command TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (principal_id, command, idempotency_key)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_events_idem ON events(actor_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_events_chain ON events(chain_key, seq);
CREATE INDEX IF NOT EXISTS ix_events_project ON events(project_id, seq);
CREATE INDEX IF NOT EXISTS ix_events_ticket ON events(ticket_id, seq);
CREATE INDEX IF NOT EXISTS ix_tickets_state ON tickets(project_id, state_code, priority, last_activity_at);
CREATE INDEX IF NOT EXISTS ix_tickets_assignee ON tickets(assignee_id, state_code);
CREATE INDEX IF NOT EXISTS ix_tickets_reviewer ON tickets(reviewer_id, state_code);
CREATE INDEX IF NOT EXISTS ix_tickets_updated ON tickets(project_id, updated_at, id);
CREATE INDEX IF NOT EXISTS ix_tickets_parent ON tickets(parent_id);
CREATE INDEX IF NOT EXISTS ix_labels_label ON ticket_labels(label, ticket_id);
CREATE INDEX IF NOT EXISTS ix_evidence_ticket ON evidence(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS ix_gate_runs_ticket ON gate_runs(ticket_id, produced_at);
CREATE INDEX IF NOT EXISTS ix_comments_ticket ON comments(ticket_id, seq);
CREATE INDEX IF NOT EXISTS ix_comments_reply ON comments(reply_to_comment_id) WHERE reply_to_comment_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS tr_events_append_only
BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER IF NOT EXISTS tr_events_append_only_delete
BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER IF NOT EXISTS tr_comments_append_only
BEFORE UPDATE ON comments BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER IF NOT EXISTS tr_comments_append_only_delete
BEFORE DELETE ON comments BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER IF NOT EXISTS tr_evidence_append_only
BEFORE UPDATE ON evidence BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER IF NOT EXISTS tr_evidence_append_only_delete
BEFORE DELETE ON evidence BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER IF NOT EXISTS tr_gate_runs_append_only
BEFORE UPDATE ON gate_runs BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER IF NOT EXISTS tr_gate_runs_append_only_delete
BEFORE DELETE ON gate_runs BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER IF NOT EXISTS tr_gate_evidence_binding
BEFORE INSERT ON evidence
WHEN NEW.kind = 'gate'
BEGIN
  SELECT RAISE(ABORT, 'GATE_RECORD_MISSING') WHERE NOT EXISTS (
    SELECT 1 FROM gate_runs g
    JOIN principals p ON p.id = g.created_by
    WHERE g.id = NEW.gate_run_id
      AND g.ticket_id = NEW.ticket_id
      AND g.ticket_revision = NEW.ticket_revision
      AND p.kind = 'daemon'
  );
END;
`

export function schemaVersionError(version: number): IssuesError {
  return new IssuesError('SCHEMA_TOO_NEW', `database schema ${version} is newer than code`, {
    observedVersion: version,
    codeVersion: SCHEMA_VERSION,
  })
}
