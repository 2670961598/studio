/**
 * ledger —— 台账句柄：打开/迁移/事件入账/查询面（v0.2 首刀核心）
 *
 * 依据：docs/16-§四 v0.2（三表建库 + 快照/重建）、docs/17-§3（数据模型）、
 * docs/02 F2-01（可重建投影，daemon 唯一写入者）、F2-11（JSONL 单向派生）。
 *
 * 纪律落点：
 *   - appendEvent 是 events 的唯一写口：先过 contract validateEventRecord
 *     （台账纯净度第一道闸，非法即 CONFIG_INVALID，不入账）；合法插入，无 UPDATE/DELETE 路径。
 *   - 重复 ULID 的幂等规则（拟稿待批，服务 F2-13 回填幂等）：同 id 且全列一致 → 幂等跳过
 *     （appended:false）；同 id 内容不一致 → 抛错（拒绝静默覆盖语义的重复）。
 *   - tokens 存四桶 JSON 文本，写入前 canonical 序列化（固定桶序）——JSONL 派生逐行字节确定，
 *     支撑 F2-11「每日比对行数+哈希」。
 */
import { writeFileSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import {
  configInvalid,
  validateEventRecord,
  type ClassifiedError,
  type EventRecord,
  type ValidationIssue,
} from '@studio-next/contract'
import { openSqlite } from './driver.ts'
import { currentVersion, migrate } from './migrations.ts'
import { SessionRecordSchema, WorkRecordSchema, type SessionRecord, type WorkRecord } from './records.ts'

/** events 查询面：全部条件可选，ts 双端闭区间，返回恒升序（ts, id 稳定序） */
export interface EventQuery {
  company?: string
  issue?: string
  /** ts >= since（闭端，epoch ms） */
  since?: number
  /** ts <= until（闭端，epoch ms） */
  until?: number
  limit?: number
}

/** appendEvent 结果：appended=false 表示命中幂等规则（同 id 全列一致的重复入账被跳过） */
export interface AppendResult {
  id: string
  appended: boolean
}

/** dumpEvents 结果：写出行数（与库内 events 计数一致） */
export interface DumpResult {
  lines: number
}

/** 台账句柄：daemon 持有；db 暴露 DatabaseSync 标准面（引擎切换只动 driver.ts） */
export interface Ledger {
  db: DatabaseSync
  close(): void
  /** 当前 schema 版本（schema_version 表 MAX(version)；0=无迁移记录） */
  version(): number
  /** events 唯一写口：先契约校验后插入（append-only） */
  appendEvent(record: unknown): AppendResult
  /** events 查询面（恒升序） */
  queryEvents(query?: EventQuery): EventRecord[]
  /** events 全量 → JSONL（逐行含 ULID；F2-11 库→JSONL 单向派生） */
  dumpEvents(path: string): DumpResult
  insertWorkRecord(record: unknown): string
  getWorkRecord(id: string): WorkRecord | undefined
  listWorkRecords(query?: { issue?: string }): WorkRecord[]
  insertSession(record: unknown): string
  getSession(sessionId: string): SessionRecord | undefined
  listSessions(query?: { issue?: string }): SessionRecord[]
}

/** tokens 四桶 canonical 序（F2-04 列名序）：同内容恒同字节串 */
const TOKEN_BUCKET_ORDER = ['input', 'output', 'cache_read', 'cache_creation'] as const

function canonicalTokens(tokens: EventRecord['tokens']): string {
  const parts: string[] = []
  for (const key of TOKEN_BUCKET_ORDER) {
    const v = tokens[key]
    if (v !== undefined) parts.push(`"${key}":${v}`)
  }
  return `{${parts.join(',')}}`
}

function parseTokens(json: string): EventRecord['tokens'] {
  const parsed: unknown = JSON.parse(json)
  if (typeof parsed !== 'object' || parsed === null) {
    configInvalid('store/evt:tokens-corrupt', `tokens 列不是 JSON 对象：${json}`)
  }
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === 'number') out[k] = v
  }
  return out as EventRecord['tokens']
}

// —— 行 ↔ 记录映射（events；列集逐列对齐 contract EventRecordSchema 字段名） ——

type SqlRow = Record<string, unknown>

function str(row: SqlRow, key: string): string {
  return String(row[key])
}

function optStr(row: SqlRow, key: string): string | undefined {
  const v = row[key]
  return v === null || v === undefined ? undefined : String(v)
}

function optNum(row: SqlRow, key: string): number | undefined {
  const v = row[key]
  return v === null || v === undefined ? undefined : Number(v)
}

function rowToEvent(row: SqlRow): EventRecord {
  const rec: EventRecord = {
    id: str(row, 'id'),
    ts: Number(row['ts']),
    company: str(row, 'company'),
    issue: str(row, 'issue'),
    event: str(row, 'event'),
    actor: str(row, 'actor'),
    attempt: Number(row['attempt']),
    level: Number(row['level']),
    dept: str(row, 'dept'),
    tokens: parseTokens(str(row, 'tokens')),
  }
  const correlationId = optStr(row, 'correlation_id')
  if (correlationId !== undefined) rec.correlation_id = correlationId
  const causationId = optStr(row, 'causation_id')
  if (causationId !== undefined) rec.causation_id = causationId
  const costUsd = optNum(row, 'cost_usd')
  if (costUsd !== undefined) rec.cost_usd = costUsd
  const durationMs = optNum(row, 'duration_ms')
  if (durationMs !== undefined) rec.duration_ms = durationMs
  const size = optNum(row, 'size')
  if (size !== undefined) rec.size = size
  const payloadHash = optStr(row, 'payload_hash')
  if (payloadHash !== undefined) rec.payload_hash = payloadHash
  const note = optStr(row, 'note')
  if (note !== undefined) rec.note = note
  return rec
}

const INSERT_EVENT_SQL = `INSERT INTO events (
  id, ts, company, issue, event, actor, attempt, level, dept,
  correlation_id, causation_id, tokens, cost_usd, duration_ms, size, payload_hash, note
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

/** 入账前契约闸：非法 record → ClassifiedError(CONFIG_INVALID)（拒非法入账，第一道闸） */
function assertValidEvent(record: unknown): asserts record is EventRecord {
  const outcome = validateEventRecord(record)
  if (!outcome.ok) {
    const first = outcome.issues[0] as ValidationIssue | undefined
    const path = first === undefined ? '(root)' : first.path
    const brief = outcome.issues
      .slice(0, 3)
      .map((i) => `${i.path}: ${i.message}`)
      .join('；')
    configInvalid(`evt/invalid:${path}`, brief)
  }
}

/** 打开（或创建）台账库：建库 → PRAGMA 对齐 → migrate()（幂等）→ 返回句柄 */
export function openLedger(path: string): Ledger {
  const db = openSqlite(path)
  migrate(db)

  const appendEvent = (record: unknown): AppendResult => {
    assertValidEvent(record)
    // 幂等规则：同 id 已存在 → 全列一致跳过，不一致抛错（F2-13 回填幂等；拟稿待批）
    const existing = db
      .prepare('SELECT * FROM events WHERE id = ?')
      .get(record.id) as SqlRow | undefined
    if (existing !== undefined) {
      const same = rowToEvent(existing)
      if (sameEvent(same, record)) return { id: record.id, appended: false }
      configInvalid(
        'store/evt:duplicate-id',
        `事件 id=${record.id} 已存在且内容不一致（append-only，拒绝覆盖语义的重复入账）`,
      )
    }
    db.prepare(INSERT_EVENT_SQL).run(
      record.id,
      record.ts,
      record.company,
      record.issue,
      record.event,
      record.actor,
      record.attempt,
      record.level,
      record.dept,
      record.correlation_id ?? null,
      record.causation_id ?? null,
      canonicalTokens(record.tokens),
      record.cost_usd ?? null,
      record.duration_ms ?? null,
      record.size ?? null,
      record.payload_hash ?? null,
      record.note ?? null,
    )
    return { id: record.id, appended: true }
  }

  const queryEvents = (query: EventQuery = {}): EventRecord[] => {
    const where: string[] = []
    const params: Array<string | number> = []
    if (query.company !== undefined) {
      where.push('company = ?')
      params.push(query.company)
    }
    if (query.issue !== undefined) {
      where.push('issue = ?')
      params.push(query.issue)
    }
    if (query.since !== undefined) {
      where.push('ts >= ?')
      params.push(query.since)
    }
    if (query.until !== undefined) {
      where.push('ts <= ?')
      params.push(query.until)
    }
    let sql = 'SELECT * FROM events'
    if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`
    sql += ' ORDER BY ts ASC, id ASC'
    if (query.limit !== undefined) {
      sql += ' LIMIT ?'
      params.push(query.limit)
    }
    const rows = db.prepare(sql).all(...params) as SqlRow[]
    return rows.map(rowToEvent)
  }

  const dumpEvents = (path: string): DumpResult => {
    const rows = db.prepare('SELECT * FROM events ORDER BY ts ASC, id ASC').all() as SqlRow[]
    // 同步写（daemon 单写入者，无并发写面）；行序 = ts,id 升序，行字节由 canonical 序列化保证确定
    writeFileSync(path, rows.map((row) => JSON.stringify(rowToEvent(row))).join('\n') + (rows.length > 0 ? '\n' : ''), 'utf8')
    return { lines: rows.length }
  }

  const insertWorkRecord = (record: unknown): string => {
    const parsed = WorkRecordSchema.safeParse(record)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      const path = first === undefined ? '(root)' : first.path.map(String).join('.')
      configInvalid(`store/work-record:invalid:${path}`, first === undefined ? undefined : `${path}: ${first.message}`)
    }
    const r = parsed.data
    db.prepare(
      `INSERT INTO work_records (
        id, issue, person_id, instance_id, executor, session_id, lane, branch,
        started_at, ended_at, cost_usd, tokens, attempt, status, report_ref, summary_ref
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      r.id,
      r.issue,
      r.person_id,
      r.instance_id ?? null,
      r.executor,
      r.session_id ?? null,
      r.lane ?? null,
      r.branch ?? null,
      r.started_at,
      r.ended_at ?? null,
      r.cost_usd ?? null,
      r.tokens === undefined ? null : JSON.stringify(r.tokens),
      r.attempt,
      r.status,
      r.report_ref ?? null,
      r.summary_ref ?? null,
    )
    return r.id
  }

  const rowToWorkRecord = (row: SqlRow): WorkRecord => {
    const rec: WorkRecord = {
      id: str(row, 'id'),
      issue: str(row, 'issue'),
      person_id: str(row, 'person_id'),
      executor: str(row, 'executor'),
      started_at: Number(row['started_at']),
      attempt: Number(row['attempt']),
      status: str(row, 'status'),
    }
    const instanceId = optStr(row, 'instance_id')
    if (instanceId !== undefined) rec.instance_id = instanceId
    const sessionId = optStr(row, 'session_id')
    if (sessionId !== undefined) rec.session_id = sessionId
    const lane = optStr(row, 'lane')
    if (lane !== undefined) rec.lane = lane
    const branch = optStr(row, 'branch')
    if (branch !== undefined) rec.branch = branch
    const endedAt = optNum(row, 'ended_at')
    if (endedAt !== undefined) rec.ended_at = endedAt
    const costUsd = optNum(row, 'cost_usd')
    if (costUsd !== undefined) rec.cost_usd = costUsd
    const tokensJson = optStr(row, 'tokens')
    if (tokensJson !== undefined) rec.tokens = JSON.parse(tokensJson) as NonNullable<WorkRecord['tokens']>
    const reportRef = optStr(row, 'report_ref')
    if (reportRef !== undefined) rec.report_ref = reportRef
    const summaryRef = optStr(row, 'summary_ref')
    if (summaryRef !== undefined) rec.summary_ref = summaryRef
    return rec
  }

  const listWorkRecords = (query: { issue?: string } = {}): WorkRecord[] => {
    const rows =
      query.issue === undefined
        ? (db.prepare('SELECT * FROM work_records ORDER BY started_at ASC, id ASC').all() as SqlRow[])
        : (db
            .prepare('SELECT * FROM work_records WHERE issue = ? ORDER BY started_at ASC, id ASC')
            .all(query.issue) as SqlRow[])
    return rows.map(rowToWorkRecord)
  }

  const insertSession = (record: unknown): string => {
    const parsed = SessionRecordSchema.safeParse(record)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      const path = first === undefined ? '(root)' : first.path.map(String).join('.')
      configInvalid(`store/session:invalid:${path}`, first === undefined ? undefined : `${path}: ${first.message}`)
    }
    const r = parsed.data
    db.prepare(
      'INSERT INTO sessions (session_id, issue, person_id, archive_path, started_at, ended_at, turns) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(r.session_id, r.issue, r.person_id, r.archive_path ?? null, r.started_at, r.ended_at ?? null, r.turns ?? null)
    return r.session_id
  }

  const rowToSession = (row: SqlRow): SessionRecord => {
    const rec: SessionRecord = {
      session_id: str(row, 'session_id'),
      issue: str(row, 'issue'),
      person_id: str(row, 'person_id'),
      started_at: Number(row['started_at']),
    }
    const archivePath = optStr(row, 'archive_path')
    if (archivePath !== undefined) rec.archive_path = archivePath
    const endedAt = optNum(row, 'ended_at')
    if (endedAt !== undefined) rec.ended_at = endedAt
    const turns = optNum(row, 'turns')
    if (turns !== undefined) rec.turns = turns
    return rec
  }

  const listSessions = (query: { issue?: string } = {}): SessionRecord[] => {
    const rows =
      query.issue === undefined
        ? (db.prepare('SELECT * FROM sessions ORDER BY started_at ASC, session_id ASC').all() as SqlRow[])
        : (db
            .prepare('SELECT * FROM sessions WHERE issue = ? ORDER BY started_at ASC, session_id ASC')
            .all(query.issue) as SqlRow[])
    return rows.map(rowToSession)
  }

  return {
    db,
    close: () => db.close(),
    version: () => currentVersion(db),
    appendEvent,
    queryEvents,
    dumpEvents,
    insertWorkRecord,
    getWorkRecord: (id: string) => {
      const row = db.prepare('SELECT * FROM work_records WHERE id = ?').get(id) as SqlRow | undefined
      return row === undefined ? undefined : rowToWorkRecord(row)
    },
    listWorkRecords,
    insertSession,
    getSession: (sessionId: string) => {
      const row = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as SqlRow | undefined
      return row === undefined ? undefined : rowToSession(row)
    },
    listSessions,
  }
}

/** 记录级全列比对（tokens 经 canonical 序列化后比字节；支撑幂等规则判定） */
function sameEvent(a: EventRecord, b: EventRecord): boolean {
  return (
    a.id === b.id &&
    a.ts === b.ts &&
    a.company === b.company &&
    a.issue === b.issue &&
    a.event === b.event &&
    a.actor === b.actor &&
    a.attempt === b.attempt &&
    a.level === b.level &&
    a.dept === b.dept &&
    a.correlation_id === b.correlation_id &&
    a.causation_id === b.causation_id &&
    canonicalTokens(a.tokens) === canonicalTokens(b.tokens) &&
    a.cost_usd === b.cost_usd &&
    a.duration_ms === b.duration_ms &&
    a.size === b.size &&
    a.payload_hash === b.payload_hash &&
    a.note === b.note
  )
}

/** 类型通道：ClassifiedError 形状（kernel；供调用方 catch 判类） */
export type { ClassifiedError }
