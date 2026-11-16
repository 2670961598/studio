import { DatabaseSync } from 'node:sqlite'
import { IssuesError } from './errors.ts'
import { canonicalJson, sha256Hex } from './util.ts'
import { hashEvent } from './memory-store.ts'
import type {
  AllocatedKey,
  CommandLogRow,
  CommentRow,
  CountTicketsFilterRow,
  DescendantRow,
  EventRow,
  EvidenceRow,
  GateRunRow,
  MembershipRow,
  NewCommentRow,
  NewEvent,
  OutboxRow,
  PrincipalRow,
  ProjectRow,
  TicketFilterRow,
  TicketListPos,
  TicketPatch,
  TicketRow,
  TicketStore,
  TicketTx,
} from './store.ts'
import type {
  EvidenceKind,
  EvidenceProducer,
  JsonObject,
  Role,
  TicketKind,
} from './types.ts'
import {
  SCHEMA_SQL,
  SCHEMA_VERSION,
  evaluateSqliteVersion,
  schemaVersionError,
} from './sqlite-schema.ts'

type SqlParam = string | number | bigint | null

export interface SqliteStoreOptions {
  /** v0.8 pin: 'require-pin' fails closed below SQLite 3.51.3. */
  versionPolicy?: 'allow-below-pin' | 'require-pin'
}

const TICKET_COLUMNS = `id, project_id, key, title, body, kind, priority, state_code,
  assignee_id, reviewer_id, requires_human, parent_id, created_by, revision,
  block_reason, resume_state_code, policy_generation, rework_count, reopen_count,
  last_reopened_at, last_reopen_reason, created_at, updated_at, last_activity_at,
  done_at, archived_at`

const TICKET_LIST_COLUMNS = [
  'tickets.id',
  'tickets.project_id',
  'tickets.key',
  'tickets.title',
  'tickets.body',
  'tickets.kind',
  'tickets.priority',
  'tickets.state_code',
  'tickets.assignee_id',
  'tickets.reviewer_id',
  'tickets.requires_human',
  'tickets.parent_id',
  'tickets.created_by',
  'tickets.revision',
  'tickets.block_reason',
  'tickets.resume_state_code',
  'tickets.policy_generation',
  'tickets.rework_count',
  'tickets.reopen_count',
  'tickets.last_reopened_at',
  'tickets.last_reopen_reason',
  'tickets.created_at',
  'tickets.updated_at',
  'tickets.last_activity_at',
  'tickets.done_at',
  'tickets.archived_at',
].join(', ')

const CHUNK_SIZE = 200

interface TicketSqlRow {
  id: string
  project_id: string
  key: string
  title: string
  body: string
  kind: string
  priority: number
  state_code: number
  assignee_id: string | null
  reviewer_id: string | null
  requires_human: number
  parent_id: string | null
  created_by: string
  revision: number
  block_reason: string | null
  resume_state_code: number | null
  policy_generation: number
  rework_count: number
  reopen_count: number
  last_reopened_at: number | null
  last_reopen_reason: string | null
  created_at: number
  updated_at: number
  last_activity_at: number
  done_at: number | null
  archived_at: number | null
}

interface PrincipalSqlRow {
  id: string
  kind: string
  display_name: string
  status: string
  created_at: number
}

interface ProjectSqlRow {
  id: string
  key_prefix: string
  name: string
  next_ticket_seq: number
  policy_json: string
  policy_generation: number
  created_at: number
  archived_at: number | null
}

interface MembershipSqlRow {
  project_id: string
  principal_id: string
  role: string
  added_by: string
  added_at: number
}

interface CommentSqlRow {
  seq: number
  id: string
  ticket_id: string
  author_id: string
  body: string
  reply_to_comment_id: string | null
  created_at: number
}

interface EvidenceSqlRow {
  id: string
  ticket_id: string
  ticket_revision: number
  kind: string
  uri: string
  sha256: string
  bytes: number | null
  producer: string
  gate_run_id: string | null
  created_by: string
  created_at: number
}

interface GateRunSqlRow {
  id: string
  ticket_id: string
  ticket_revision: number
  produced_at: number
  gate_exit: number
  req_completed: number
  req_output: number
  req_report: number
  covered_evidence_ids: string
  record_sha256: string
  created_by: string
  created_at: number
}

interface EventSqlRow {
  seq: number
  id: string
  project_id: string
  ticket_id: string | null
  chain_key: string
  type: string
  actor_id: string
  actor_kind: string
  occurred_at: number
  revision_before: number
  revision_after: number
  from_state_code: number | null
  to_state_code: number | null
  payload_json: string
  prev_hash: string
  entry_hash: string
  idempotency_key: string | null
  created_at: number
}

interface OutboxSqlRow {
  seq: number
  event_id: string
  topic: string
  payload_json: string
  status: string
  attempts: number
  next_attempt_at: number
  created_at: number
  delivered_at: number | null
}

interface CommandLogSqlRow {
  principal_id: string
  command: string
  idempotency_key: string
  request_hash: string
  response_json: string
  created_at: number
}

function asNumber(value: unknown): number {
  return typeof value === 'bigint' ? Number(value) : Number(value)
}

function ticketFromRow(row: TicketSqlRow): TicketRow {
  return {
    id: row.id,
    projectId: row.project_id,
    key: row.key,
    title: row.title,
    body: row.body,
    kind: row.kind as TicketKind,
    priority: asNumber(row.priority),
    stateCode: asNumber(row.state_code),
    assigneeId: row.assignee_id,
    reviewerId: row.reviewer_id,
    requiresHuman: asNumber(row.requires_human),
    parentId: row.parent_id,
    createdBy: row.created_by,
    revision: asNumber(row.revision),
    blockReason: row.block_reason,
    resumeStateCode: row.resume_state_code === null ? null : asNumber(row.resume_state_code),
    policyGeneration: asNumber(row.policy_generation),
    reworkCount: asNumber(row.rework_count),
    reopenCount: asNumber(row.reopen_count),
    lastReopenedAt: row.last_reopened_at === null ? null : asNumber(row.last_reopened_at),
    lastReopenReason: row.last_reopen_reason,
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
    lastActivityAt: asNumber(row.last_activity_at),
    doneAt: row.done_at === null ? null : asNumber(row.done_at),
    archivedAt: row.archived_at === null ? null : asNumber(row.archived_at),
  }
}

function principalFromRow(row: PrincipalSqlRow): PrincipalRow {
  return {
    id: row.id,
    kind: row.kind as PrincipalRow['kind'],
    displayName: row.display_name,
    status: row.status as PrincipalRow['status'],
    createdAt: asNumber(row.created_at),
  }
}

function projectFromRow(row: ProjectSqlRow): ProjectRow {
  return {
    id: row.id,
    keyPrefix: row.key_prefix,
    name: row.name,
    nextTicketSeq: asNumber(row.next_ticket_seq),
    policyJson: row.policy_json,
    policyGeneration: asNumber(row.policy_generation),
    createdAt: asNumber(row.created_at),
    archivedAt: row.archived_at === null ? null : asNumber(row.archived_at),
  }
}

function membershipFromRow(row: MembershipSqlRow): MembershipRow {
  return {
    projectId: row.project_id,
    principalId: row.principal_id,
    role: row.role as Role,
    addedBy: row.added_by,
    addedAt: asNumber(row.added_at),
  }
}

function commentFromRow(row: CommentSqlRow): CommentRow {
  return {
    seq: asNumber(row.seq),
    id: row.id,
    ticketId: row.ticket_id,
    authorId: row.author_id,
    body: row.body,
    replyToCommentId: row.reply_to_comment_id,
    createdAt: asNumber(row.created_at),
  }
}

function evidenceFromRow(row: EvidenceSqlRow): EvidenceRow {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    ticketRevision: asNumber(row.ticket_revision),
    kind: row.kind as EvidenceKind | 'gate',
    uri: row.uri,
    sha256: row.sha256,
    bytes: row.bytes === null ? null : asNumber(row.bytes),
    producer: row.producer as EvidenceProducer,
    gateRunId: row.gate_run_id,
    createdBy: row.created_by,
    createdAt: asNumber(row.created_at),
  }
}

function gateRunFromRow(row: GateRunSqlRow): GateRunRow {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    ticketRevision: asNumber(row.ticket_revision),
    producedAt: asNumber(row.produced_at),
    gateExit: asNumber(row.gate_exit),
    reqCompleted: asNumber(row.req_completed),
    reqOutput: asNumber(row.req_output),
    reqReport: asNumber(row.req_report),
    coveredEvidenceIds: JSON.parse(row.covered_evidence_ids) as string[],
    recordSha256: row.record_sha256,
    createdBy: row.created_by,
    createdAt: asNumber(row.created_at),
  }
}

function eventFromRow(row: EventSqlRow): EventRow {
  return {
    seq: asNumber(row.seq),
    id: row.id,
    projectId: row.project_id,
    ticketId: row.ticket_id,
    chainKey: row.chain_key,
    type: row.type,
    actorId: row.actor_id,
    actorKind: row.actor_kind as EventRow['actorKind'],
    occurredAt: asNumber(row.occurred_at),
    revisionBefore: asNumber(row.revision_before),
    revisionAfter: asNumber(row.revision_after),
    fromStateCode: row.from_state_code === null ? null : asNumber(row.from_state_code),
    toStateCode: row.to_state_code === null ? null : asNumber(row.to_state_code),
    payload: JSON.parse(row.payload_json) as JsonObject,
    prevHash: row.prev_hash,
    entryHash: row.entry_hash,
    idempotencyKey: row.idempotency_key,
    createdAt: asNumber(row.created_at),
  }
}

function outboxFromRow(row: OutboxSqlRow): OutboxRow {
  return {
    seq: asNumber(row.seq),
    eventId: row.event_id,
    topic: row.topic,
    payloadJson: row.payload_json,
    status: row.status as OutboxRow['status'],
    attempts: asNumber(row.attempts),
    nextAttemptAt: asNumber(row.next_attempt_at),
    createdAt: asNumber(row.created_at),
    deliveredAt: row.delivered_at === null ? null : asNumber(row.delivered_at),
  }
}

function commandLogFromRow(row: CommandLogSqlRow): CommandLogRow {
  return {
    principalId: row.principal_id,
    command: row.command,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    responseJson: row.response_json,
    createdAt: asNumber(row.created_at),
  }
}

function makeTx(): TicketTx {
  return {} as unknown as TicketTx
}

function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ')
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

/**
 * SQLite TicketStore adapter. Owns DDL/migrations/WAL/PRAGMAs and every SQL
 * string; the domain never sees them. Single process, single writer.
 */
export class SqliteIssuesStore implements TicketStore {
  readonly db: DatabaseSync
  private closed = false
  private inTransaction = false
  private batchQueries = 0
  readonly sqliteVersion: string

  constructor(path: string, options: SqliteStoreOptions = {}) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.db.exec('PRAGMA synchronous = FULL')
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL')

    const versionRow = this.db.prepare('SELECT sqlite_version() AS v').get() as
      | { v: string }
      | undefined
    this.sqliteVersion = versionRow?.v ?? 'unknown'
    const assessment = evaluateSqliteVersion(this.sqliteVersion)
    if (options.versionPolicy === 'require-pin' && !assessment.supported) {
      this.db.close()
      throw new IssuesError('STORAGE_UNAVAILABLE', 'sqlite runtime is below the v0.8 pin', {
        internalCode: 'SQLITE_TOO_OLD',
        observed: assessment.observed,
        required: assessment.required,
      })
    }
    this.migrate()
  }

  get queryCount(): number {
    return this.batchQueries
  }

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as
      | { user_version: number }
      | undefined
    const version = row === undefined ? 0 : asNumber(row.user_version)
    if (version > SCHEMA_VERSION) throw schemaVersionError(version)
    if (version < SCHEMA_VERSION) {
      this.transaction(_tx => {
        this.db.exec(SCHEMA_SQL)
        this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
      })
    }
  }

  bootstrap(now: number): void {
    this.transaction(tx => {
      const existing = this.getPrincipal(tx, 'daemon:local')
      if (existing !== undefined) return
      this.insertPrincipal(tx, {
        id: 'daemon:local',
        kind: 'daemon',
        displayName: 'daemon:local',
        status: 'active',
        createdAt: now,
      })
    })
  }

  transaction<T>(fn: (tx: TicketTx) => T): T {
    this.assertOpen()
    if (this.inTransaction) return fn(makeTx())
    try {
      this.db.exec('BEGIN IMMEDIATE')
    } catch (error) {
      throw error instanceof IssuesError ? error : mapSqliteError(error)
    }
    this.inTransaction = true
    try {
      const result = fn(makeTx())
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        /* transaction already rolled back */
      }
      throw error instanceof IssuesError ? error : mapSqliteError(error)
    } finally {
      this.inTransaction = false
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  insertPrincipal(_tx: TicketTx, row: PrincipalRow): void {
    this.db
      .prepare('INSERT INTO principals (id, kind, display_name, status, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, row.kind, row.displayName, row.status, row.createdAt)
  }

  getPrincipal(_tx: TicketTx, id: string): PrincipalRow | undefined {
    const row = this.db
      .prepare('SELECT id, kind, display_name, status, created_at FROM principals WHERE id = ?')
      .get(id) as PrincipalSqlRow | undefined
    return row === undefined ? undefined : principalFromRow(row)
  }

  listPrincipals(_tx: TicketTx): PrincipalRow[] {
    const rows = this.db
      .prepare('SELECT id, kind, display_name, status, created_at FROM principals ORDER BY created_at ASC, id ASC')
      .all() as unknown as PrincipalSqlRow[]
    return rows.map(principalFromRow)
  }

  insertProject(_tx: TicketTx, row: ProjectRow): void {
    this.db
      .prepare(`INSERT INTO projects (id, key_prefix, name, next_ticket_seq, policy_json,
        policy_generation, created_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        row.id,
        row.keyPrefix,
        row.name,
        row.nextTicketSeq,
        row.policyJson,
        row.policyGeneration,
        row.createdAt,
        row.archivedAt,
      )
  }

  getProject(_tx: TicketTx, id: string): ProjectRow | undefined {
    const row = this.db
      .prepare(`SELECT id, key_prefix, name, next_ticket_seq, policy_json, policy_generation,
        created_at, archived_at FROM projects WHERE id = ?`)
      .get(id) as ProjectSqlRow | undefined
    return row === undefined ? undefined : projectFromRow(row)
  }

  updateProjectPolicy(
    _tx: TicketTx,
    projectId: string,
    expectedGeneration: number,
    policyJson: string,
    _now: number,
  ): boolean {
    const result = this.db
      .prepare(`UPDATE projects SET policy_json = ?, policy_generation = policy_generation + 1
        WHERE id = ? AND policy_generation = ?`)
      .run(policyJson, projectId, expectedGeneration)
    return asNumber(result.changes) > 0
  }

  allocateTicketKey(_tx: TicketTx, projectId: string, _now: number): AllocatedKey {
    const row = this.db
      .prepare('SELECT key_prefix, next_ticket_seq FROM projects WHERE id = ?')
      .get(projectId) as { key_prefix: string; next_ticket_seq: number } | undefined
    if (row === undefined) throw new IssuesError('PROJECT_NOT_FOUND', 'project not found')
    const seq = asNumber(row.next_ticket_seq)
    this.db
      .prepare('UPDATE projects SET next_ticket_seq = next_ticket_seq + 1 WHERE id = ?')
      .run(projectId)
    return { seq, key: `${row.key_prefix}-${seq}` }
  }

  insertMembership(_tx: TicketTx, row: MembershipRow): void {
    this.db
      .prepare(`INSERT INTO memberships (project_id, principal_id, role, added_by, added_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`)
      .run(row.projectId, row.principalId, row.role, row.addedBy, row.addedAt)
  }

  getMembershipRoles(_tx: TicketTx, projectId: string, principalId: string): Role[] {
    const rows = this.db
      .prepare(`SELECT role FROM memberships WHERE project_id = ? AND principal_id = ? ORDER BY role`)
      .all(projectId, principalId) as unknown as Array<{ role: string }>
    return rows.map(row => row.role as Role)
  }

  listMemberships(_tx: TicketTx, projectId: string): MembershipRow[] {
    const rows = this.db
      .prepare(`SELECT project_id, principal_id, role, added_by, added_at FROM memberships
        WHERE project_id = ? ORDER BY principal_id ASC, role ASC`)
      .all(projectId) as unknown as MembershipSqlRow[]
    return rows.map(membershipFromRow)
  }

  insertTicket(_tx: TicketTx, row: TicketRow): void {
    this.db
      .prepare(`INSERT INTO tickets (${TICKET_COLUMNS})
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        row.id,
        row.projectId,
        row.key,
        row.title,
        row.body,
        row.kind,
        row.priority,
        row.stateCode,
        row.assigneeId,
        row.reviewerId,
        row.requiresHuman,
        row.parentId,
        row.createdBy,
        row.revision,
        row.blockReason,
        row.resumeStateCode,
        row.policyGeneration,
        row.reworkCount,
        row.reopenCount,
        row.lastReopenedAt,
        row.lastReopenReason,
        row.createdAt,
        row.updatedAt,
        row.lastActivityAt,
        row.doneAt,
        row.archivedAt,
      )
  }

  getTicket(_tx: TicketTx, projectId: string, id: string): TicketRow | undefined {
    const row = this.db
      .prepare(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = ? AND project_id = ?`)
      .get(id, projectId) as TicketSqlRow | undefined
    return row === undefined ? undefined : ticketFromRow(row)
  }

  getTicketByIdOrKey(_tx: TicketTx, projectId: string, idOrKey: string): TicketRow | undefined {
    const row = this.db
      .prepare(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE project_id = ? AND (id = ? OR key = ?) LIMIT 1`)
      .get(projectId, idOrKey, idOrKey) as TicketSqlRow | undefined
    return row === undefined ? undefined : ticketFromRow(row)
  }

  getTicketProject(_tx: TicketTx, ticketId: string): string | undefined {
    const row = this.db
      .prepare('SELECT project_id FROM tickets WHERE id = ?')
      .get(ticketId) as { project_id: string } | undefined
    return row === undefined ? undefined : row.project_id
  }

  getTicketsByIds(_tx: TicketTx, projectId: string, ids: readonly string[]): TicketRow[] {
    const rows: TicketRow[] = []
    for (const idsChunk of chunk(ids, CHUNK_SIZE)) {
      if (idsChunk.length === 0) continue
      this.batchQueries += 1
      const found = this.db
        .prepare(`SELECT ${TICKET_COLUMNS} FROM tickets
          WHERE project_id = ? AND id IN (${placeholders(idsChunk.length)})`)
        .all(projectId, ...idsChunk) as unknown as TicketSqlRow[]
      for (const row of found) rows.push(ticketFromRow(row))
    }
    return rows
  }

  updateTicketCas(
    _tx: TicketTx,
    id: string,
    expectedRevision: number,
    patch: TicketPatch,
  ): TicketRow | undefined {
    const sets: string[] = []
    const values: SqlParam[] = []
    const add = (column: string, value: SqlParam): void => {
      sets.push(`${column} = ?`)
      values.push(value)
    }
    if (patch.title !== undefined) add('title', patch.title)
    if (patch.body !== undefined) add('body', patch.body)
    if (patch.kind !== undefined) add('kind', patch.kind)
    if (patch.priority !== undefined) add('priority', patch.priority)
    if (patch.stateCode !== undefined) add('state_code', patch.stateCode)
    if (patch.assigneeId !== undefined) add('assignee_id', patch.assigneeId)
    if (patch.reviewerId !== undefined) add('reviewer_id', patch.reviewerId)
    if (patch.requiresHuman !== undefined) add('requires_human', patch.requiresHuman)
    if (patch.parentId !== undefined) add('parent_id', patch.parentId)
    if (patch.blockReason !== undefined) add('block_reason', patch.blockReason)
    if (patch.resumeStateCode !== undefined) add('resume_state_code', patch.resumeStateCode)
    if (patch.reworkCount !== undefined) add('rework_count', patch.reworkCount)
    if (patch.reopenCount !== undefined) add('reopen_count', patch.reopenCount)
    if (patch.lastReopenedAt !== undefined) add('last_reopened_at', patch.lastReopenedAt)
    if (patch.lastReopenReason !== undefined) add('last_reopen_reason', patch.lastReopenReason)
    if (patch.doneAt !== undefined) add('done_at', patch.doneAt)
    if (patch.archivedAt !== undefined) add('archived_at', patch.archivedAt)
    if (patch.policyGeneration !== undefined) add('policy_generation', patch.policyGeneration)
    add('updated_at', patch.updatedAt)
    add('last_activity_at', patch.lastActivityAt)
    values.push(id, expectedRevision)
    const result = this.db
      .prepare(`UPDATE tickets SET ${sets.join(', ')}, revision = revision + 1
        WHERE id = ? AND revision = ?`)
      .run(...values)
    if (asNumber(result.changes) === 0) return undefined
    return this.getTicketAnyProject(id)
  }

  private getTicketAnyProject(id: string): TicketRow | undefined {
    const row = this.db
      .prepare(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = ?`)
      .get(id) as TicketSqlRow | undefined
    return row === undefined ? undefined : ticketFromRow(row)
  }

  queryTickets(
    _tx: TicketTx,
    projectId: string,
    filter: TicketFilterRow,
    pos: TicketListPos | null,
    limit: number,
  ): TicketRow[] {
    const where: string[] = ['tickets.project_id = ?']
    const params: SqlParam[] = [projectId]
    if (filter.includeArchived !== true) where.push('tickets.archived_at IS NULL')
    if (filter.stateCodes !== undefined && filter.stateCodes.length > 0) {
      where.push(`tickets.state_code IN (${placeholders(filter.stateCodes.length)})`)
      params.push(...filter.stateCodes)
    }
    if (filter.assigneeId !== undefined) {
      where.push('tickets.assignee_id = ?')
      params.push(filter.assigneeId)
    }
    if (filter.reviewerId !== undefined) {
      where.push('tickets.reviewer_id = ?')
      params.push(filter.reviewerId)
    }
    if (filter.kind !== undefined) {
      where.push('tickets.kind = ?')
      params.push(filter.kind)
    }
    if (filter.priority !== undefined) {
      where.push('tickets.priority = ?')
      params.push(filter.priority)
    }
    if (filter.label !== undefined) {
      where.push('EXISTS (SELECT 1 FROM ticket_labels l WHERE l.ticket_id = tickets.id AND l.label = ?)')
      params.push(filter.label)
    }
    if (pos !== null) {
      where.push('(tickets.updated_at < ? OR (tickets.updated_at = ? AND tickets.id > ?))')
      params.push(pos.updatedAt, pos.updatedAt, pos.id)
    }
    params.push(limit)
    const rows = this.db
      .prepare(`SELECT ${TICKET_LIST_COLUMNS} FROM tickets WHERE ${where.join(' AND ')}
        ORDER BY tickets.updated_at DESC, tickets.id ASC LIMIT ?`)
      .all(...params) as unknown as TicketSqlRow[]
    return rows.map(ticketFromRow)
  }

  countTickets(_tx: TicketTx, projectId: string, filter: CountTicketsFilterRow): number {
    const where: string[] = ['project_id = ?']
    const params: SqlParam[] = [projectId]
    if (filter.stateCodes !== undefined && filter.stateCodes.length > 0) {
      where.push(`state_code IN (${placeholders(filter.stateCodes.length)})`)
      params.push(...filter.stateCodes)
    }
    if (filter.assigneeId !== undefined) {
      where.push('assignee_id = ?')
      params.push(filter.assigneeId)
    }
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM tickets WHERE ${where.join(' AND ')}`)
      .get(...params) as { count: number } | undefined
    return row === undefined ? 0 : asNumber(row.count)
  }

  listChildren(_tx: TicketTx, projectId: string, parentId: string): TicketRow[] {
    const rows = this.db
      .prepare(`SELECT ${TICKET_COLUMNS} FROM tickets
        WHERE project_id = ? AND parent_id = ? ORDER BY created_at ASC, id ASC`)
      .all(projectId, parentId) as unknown as TicketSqlRow[]
    return rows.map(ticketFromRow)
  }

  listAncestorIds(_tx: TicketTx, ticketId: string): string[] {
    const rows = this.db
      .prepare(`WITH RECURSIVE anc(id, depth) AS (
          SELECT parent_id, 1 FROM tickets WHERE id = ? AND parent_id IS NOT NULL
          UNION ALL
          SELECT t.parent_id, a.depth + 1 FROM tickets t JOIN anc a ON t.id = a.id
          WHERE t.parent_id IS NOT NULL AND a.depth < 16
        ) SELECT id FROM anc ORDER BY depth ASC`)
      .all(ticketId) as unknown as Array<{ id: string }>
    return rows.map(row => row.id)
  }

  maxSubtreeDepth(_tx: TicketTx, ticketId: string): number {
    const row = this.db
      .prepare(`WITH RECURSIVE desc(id, depth) AS (
          SELECT id, 1 FROM tickets WHERE parent_id = ?
          UNION ALL
          SELECT t.id, d.depth + 1 FROM tickets t JOIN desc d ON t.parent_id = d.id
          WHERE d.depth < 16
        ) SELECT COALESCE(MAX(depth), 0) AS max_depth FROM desc`)
      .get(ticketId) as { max_depth: number } | undefined
    return row === undefined ? 0 : asNumber(row.max_depth)
  }

  listDescendants(_tx: TicketTx, ticketId: string): DescendantRow[] {
    const rows = this.db
      .prepare(`WITH RECURSIVE desc(id, depth) AS (
          SELECT id, 1 FROM tickets WHERE parent_id = ?
          UNION ALL
          SELECT t.id, d.depth + 1 FROM tickets t JOIN desc d ON t.parent_id = d.id
          WHERE d.depth < 16
        ) SELECT id, depth FROM desc ORDER BY depth ASC, id ASC`)
      .all(ticketId) as unknown as Array<{ id: string; depth: number }>
    return rows.map(row => ({ id: row.id, depth: asNumber(row.depth) }))
  }

  setLabels(_tx: TicketTx, ticketId: string, labels: readonly string[]): void {
    this.db.prepare('DELETE FROM ticket_labels WHERE ticket_id = ?').run(ticketId)
    const insert = this.db.prepare('INSERT OR IGNORE INTO ticket_labels (ticket_id, label) VALUES (?, ?)')
    for (const label of labels) insert.run(ticketId, label)
  }

  getLabels(_tx: TicketTx, ticketId: string): string[] {
    const rows = this.db
      .prepare('SELECT label FROM ticket_labels WHERE ticket_id = ? ORDER BY label ASC')
      .all(ticketId) as unknown as Array<{ label: string }>
    return rows.map(row => row.label)
  }

  getLabelsForTickets(_tx: TicketTx, ticketIds: readonly string[]): Map<string, string[]> {
    const result = new Map<string, string[]>()
    for (const idsChunk of chunk(ticketIds, CHUNK_SIZE)) {
      if (idsChunk.length === 0) continue
      this.batchQueries += 1
      const rows = this.db
        .prepare(`SELECT ticket_id, label FROM ticket_labels
          WHERE ticket_id IN (${placeholders(idsChunk.length)}) ORDER BY label ASC`)
        .all(...idsChunk) as unknown as Array<{ ticket_id: string; label: string }>
      for (const row of rows) {
        const labels = result.get(row.ticket_id) ?? []
        labels.push(row.label)
        result.set(row.ticket_id, labels)
      }
    }
    return result
  }

  insertComment(_tx: TicketTx, row: NewCommentRow): CommentRow {
    const result = this.db
      .prepare(`INSERT INTO comments (id, ticket_id, author_id, body, reply_to_comment_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
      .run(row.id, row.ticketId, row.authorId, row.body, row.replyToCommentId, row.createdAt)
    const seq = asNumber(result.lastInsertRowid)
    return { ...row, seq }
  }

  getComment(_tx: TicketTx, commentId: string): CommentRow | undefined {
    const row = this.db
      .prepare(`SELECT seq, id, ticket_id, author_id, body, reply_to_comment_id, created_at
        FROM comments WHERE id = ?`)
      .get(commentId) as CommentSqlRow | undefined
    return row === undefined ? undefined : commentFromRow(row)
  }

  getCommentsByIds(_tx: TicketTx, projectId: string, ids: readonly string[]): CommentRow[] {
    const rows: CommentRow[] = []
    for (const idsChunk of chunk(ids, CHUNK_SIZE)) {
      if (idsChunk.length === 0) continue
      this.batchQueries += 1
      const found = this.db
        .prepare(`SELECT c.seq, c.id, c.ticket_id, c.author_id, c.body, c.reply_to_comment_id, c.created_at
          FROM comments c JOIN tickets t ON t.id = c.ticket_id
          WHERE t.project_id = ? AND c.id IN (${placeholders(idsChunk.length)})`)
        .all(projectId, ...idsChunk) as unknown as CommentSqlRow[]
      for (const row of found) rows.push(commentFromRow(row))
    }
    return rows
  }

  listComments(_tx: TicketTx, ticketId: string, afterSeq: number, limit: number): CommentRow[] {
    const rows = this.db
      .prepare(`SELECT seq, id, ticket_id, author_id, body, reply_to_comment_id, created_at
        FROM comments WHERE ticket_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`)
      .all(ticketId, afterSeq, limit) as unknown as CommentSqlRow[]
    return rows.map(commentFromRow)
  }

  insertEvidence(_tx: TicketTx, row: EvidenceRow): void {
    this.db
      .prepare(`INSERT INTO evidence (id, ticket_id, ticket_revision, kind, uri, sha256, bytes,
        producer, gate_run_id, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        row.id,
        row.ticketId,
        row.ticketRevision,
        row.kind,
        row.uri,
        row.sha256,
        row.bytes,
        row.producer,
        row.gateRunId,
        row.createdBy,
        row.createdAt,
      )
  }

  getEvidence(_tx: TicketTx, evidenceId: string): EvidenceRow | undefined {
    const row = this.db
      .prepare(`SELECT id, ticket_id, ticket_revision, kind, uri, sha256, bytes, producer,
        gate_run_id, created_by, created_at FROM evidence WHERE id = ?`)
      .get(evidenceId) as EvidenceSqlRow | undefined
    return row === undefined ? undefined : evidenceFromRow(row)
  }

  getEvidenceByIds(_tx: TicketTx, ids: readonly string[]): EvidenceRow[] {
    const rows: EvidenceRow[] = []
    for (const idsChunk of chunk(ids, CHUNK_SIZE)) {
      if (idsChunk.length === 0) continue
      const found = this.db
        .prepare(`SELECT id, ticket_id, ticket_revision, kind, uri, sha256, bytes, producer,
          gate_run_id, created_by, created_at FROM evidence
          WHERE id IN (${placeholders(idsChunk.length)})`)
        .all(...idsChunk) as unknown as EvidenceSqlRow[]
      for (const row of found) rows.push(evidenceFromRow(row))
    }
    return rows
  }

  listEvidence(_tx: TicketTx, ticketId: string): EvidenceRow[] {
    const rows = this.db
      .prepare(`SELECT id, ticket_id, ticket_revision, kind, uri, sha256, bytes, producer,
        gate_run_id, created_by, created_at FROM evidence
        WHERE ticket_id = ? ORDER BY created_at ASC, id ASC`)
      .all(ticketId) as unknown as EvidenceSqlRow[]
    return rows.map(evidenceFromRow)
  }

  insertGateRun(_tx: TicketTx, row: GateRunRow): void {
    this.db
      .prepare(`INSERT INTO gate_runs (id, ticket_id, ticket_revision, produced_at, gate_exit,
        req_completed, req_output, req_report, covered_evidence_ids, record_sha256, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        row.id,
        row.ticketId,
        row.ticketRevision,
        row.producedAt,
        row.gateExit,
        row.reqCompleted,
        row.reqOutput,
        row.reqReport,
        canonicalJson(row.coveredEvidenceIds),
        row.recordSha256,
        row.createdBy,
        row.createdAt,
      )
  }

  getGateRun(_tx: TicketTx, gateRunId: string): GateRunRow | undefined {
    const row = this.db
      .prepare(`SELECT id, ticket_id, ticket_revision, produced_at, gate_exit, req_completed,
        req_output, req_report, covered_evidence_ids, record_sha256, created_by, created_at
        FROM gate_runs WHERE id = ?`)
      .get(gateRunId) as GateRunSqlRow | undefined
    return row === undefined ? undefined : gateRunFromRow(row)
  }

  listGateRuns(_tx: TicketTx, ticketId: string): GateRunRow[] {
    const rows = this.db
      .prepare(`SELECT id, ticket_id, ticket_revision, produced_at, gate_exit, req_completed,
        req_output, req_report, covered_evidence_ids, record_sha256, created_by, created_at
        FROM gate_runs WHERE ticket_id = ? ORDER BY produced_at ASC, id ASC`)
      .all(ticketId) as unknown as GateRunSqlRow[]
    return rows.map(gateRunFromRow)
  }

  appendEvents(_tx: TicketTx, events: readonly NewEvent[], now: number): EventRow[] {
    const appended: EventRow[] = []
    const insertEvent = this.db.prepare(`INSERT INTO events (id, project_id, ticket_id, chain_key,
      type, actor_id, actor_kind, occurred_at, revision_before, revision_after, from_state_code,
      to_state_code, payload_json, prev_hash, entry_hash, idempotency_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const insertOutbox = this.db.prepare(`INSERT INTO outbox (event_id, topic, payload_json,
      status, attempts, next_attempt_at, created_at, delivered_at) VALUES (?, ?, ?, 'pending', 0, ?, ?, NULL)`)
    const lastHash = this.db.prepare(
      'SELECT entry_hash FROM events WHERE chain_key = ? ORDER BY seq DESC LIMIT 1',
    )
    for (const event of events) {
      const prevRow = lastHash.get(event.chainKey) as { entry_hash: string } | undefined
      const prevHash = prevRow === undefined ? 'GENESIS' : prevRow.entry_hash
      const entryHash = hashEvent(event, prevHash)
      insertEvent.run(
        event.id,
        event.projectId,
        event.ticketId,
        event.chainKey,
        event.type,
        event.actorId,
        event.actorKind,
        event.occurredAt,
        event.revisionBefore,
        event.revisionAfter,
        event.fromStateCode,
        event.toStateCode,
        canonicalJson(event.payload),
        prevHash,
        entryHash,
        event.idempotencyKey,
        now,
      )
      insertOutbox.run(event.id, event.outboxTopic, canonicalJson(event.payload), now, now)
      const row = this.db
        .prepare(`SELECT seq, id, project_id, ticket_id, chain_key, type, actor_id, actor_kind, occurred_at,
          revision_before, revision_after, from_state_code, to_state_code, payload_json,
          prev_hash, entry_hash, idempotency_key, created_at FROM events WHERE id = ?`)
        .get(event.id) as EventSqlRow | undefined
      if (row === undefined) throw new IssuesError('STORAGE_UNAVAILABLE', 'storage write failed')
      appended.push(eventFromRow(row))
    }
    return appended
  }

  getLastTicketEvent(
    _tx: TicketTx,
    ticketId: string,
    type: string,
    payloadMatch?: { key: string; value: string | number },
  ): EventRow | undefined {
    const select = `SELECT seq, id, project_id, ticket_id, chain_key, type, actor_id, actor_kind, occurred_at,
      revision_before, revision_after, from_state_code, to_state_code, payload_json,
      prev_hash, entry_hash, idempotency_key, created_at FROM events`
    let row: EventSqlRow | undefined
    if (payloadMatch === undefined) {
      row = this.db
        .prepare(`${select} WHERE ticket_id = ? AND type = ? ORDER BY seq DESC LIMIT 1`)
        .get(ticketId, type) as EventSqlRow | undefined
    } else {
      row = this.db
        .prepare(`${select} WHERE ticket_id = ? AND type = ?
          AND json_extract(payload_json, ?) = ? ORDER BY seq DESC LIMIT 1`)
        .get(ticketId, type, `$.${payloadMatch.key}`, payloadMatch.value) as EventSqlRow | undefined
    }
    return row === undefined ? undefined : eventFromRow(row)
  }

  listTicketEvents(_tx: TicketTx, ticketId: string, afterSeq: number, limit: number): EventRow[] {
    const rows = this.db
      .prepare(`SELECT seq, id, project_id, ticket_id, chain_key, type, actor_id, actor_kind, occurred_at,
        revision_before, revision_after, from_state_code, to_state_code, payload_json,
        prev_hash, entry_hash, idempotency_key, created_at FROM events
        WHERE ticket_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`)
      .all(ticketId, afterSeq, limit) as unknown as EventSqlRow[]
    return rows.map(eventFromRow)
  }

  listProjectEvents(_tx: TicketTx, projectId: string, afterSeq: number, limit: number): EventRow[] {
    const rows = this.db
      .prepare(`SELECT seq, id, project_id, ticket_id, chain_key, type, actor_id, actor_kind, occurred_at,
        revision_before, revision_after, from_state_code, to_state_code, payload_json,
        prev_hash, entry_hash, idempotency_key, created_at FROM events
        WHERE project_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`)
      .all(projectId, afterSeq, limit) as unknown as EventSqlRow[]
    return rows.map(eventFromRow)
  }

  listOutbox(_tx: TicketTx, limit: number): OutboxRow[] {
    const rows = this.db
      .prepare(`SELECT seq, event_id, topic, payload_json, status, attempts, next_attempt_at,
        created_at, delivered_at FROM outbox ORDER BY seq ASC LIMIT ?`)
      .all(limit) as unknown as OutboxSqlRow[]
    return rows.map(outboxFromRow)
  }

  getCommandLog(
    _tx: TicketTx,
    principalId: string,
    command: string,
    idempotencyKey: string,
  ): CommandLogRow | undefined {
    const row = this.db
      .prepare(`SELECT principal_id, command, idempotency_key, request_hash, response_json, created_at
        FROM command_log WHERE principal_id = ? AND command = ? AND idempotency_key = ?`)
      .get(principalId, command, idempotencyKey) as CommandLogSqlRow | undefined
    return row === undefined ? undefined : commandLogFromRow(row)
  }

  insertCommandLog(_tx: TicketTx, row: CommandLogRow): void {
    this.db
      .prepare(`INSERT INTO command_log (principal_id, command, idempotency_key, request_hash,
        response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        row.principalId,
        row.command,
        row.idempotencyKey,
        row.requestHash,
        row.responseJson,
        row.createdAt,
      )
  }

  private assertOpen(): void {
    if (this.closed) throw new IssuesError('STORAGE_UNAVAILABLE', 'storage is closed')
  }
}

/** Map an adapter failure to a stable public code; never leak SQL text or paths. */
function mapSqliteError(error: unknown): IssuesError {
  const message = error instanceof Error ? error.message : String(error)
  if (/append-only/i.test(message)) {
    return new IssuesError('VALIDATION_FAILED', 'append-only table rejects mutation', {
      code: 'APPEND_ONLY',
    })
  }
  if (/GATE_RECORD_MISSING/.test(message)) {
    return new IssuesError('GATE_RECORD_MISSING', 'gate evidence must trace a daemon verdict')
  }
  if (/UNIQUE constraint failed/i.test(message)) {
    return new IssuesError('VALIDATION_FAILED', 'unique constraint', { code: 'UNIQUE_CONSTRAINT' })
  }
  if (/FOREIGN KEY constraint failed/i.test(message)) {
    return new IssuesError('VALIDATION_FAILED', 'foreign key constraint', {
      code: 'FOREIGN_KEY_CONSTRAINT',
    })
  }
  return new IssuesError('STORAGE_UNAVAILABLE', 'storage unavailable', {
    correlationId: sha256Hex(`${Date.now()}:${message}`).slice(0, 16),
  })
}

export function createSqliteStore(path: string, options: SqliteStoreOptions = {}): SqliteIssuesStore {
  return new SqliteIssuesStore(path, options)
}
