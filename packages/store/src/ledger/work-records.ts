/**
 * work-records —— work_records / sessions 读写面 + work_records 收口面（自 ledger.ts
 * 原样拆出，零行为变更；BC-S2 先拆再增同纪律）
 *
 * 表 DDL 归 migrations v1（work_records / sessions）；endWorkRecord 是 v4 吸收面（daemon
 * 合龙件三债）的一次性收口写口（COALESCE 语义，只允许收口一次）。行 ↔ 记录映射
 * （rowToWorkRecord / rowToSession）导出供 personnelTimeline 归并复用——单一口径源，
 * 不复制映射。db 由 openLedger 唯一持有并注入，本模块不建连接、不留状态。
 */
import type { DatabaseSync } from 'node:sqlite'
import { configInvalid } from '@studio-next/contract'
import {
  EndWorkRecordSchema,
  SessionRecordSchema,
  WorkRecordSchema,
  type EndWorkRecord,
  type SessionRecord,
  type WorkRecord,
} from '../records.ts'
import { assertRecord, optNum, optStr, str, type SqlRow } from '../row-helpers.ts'
import { endSessionRecord, type EndSessionInput } from '../sessions/archive.ts'

/** work_records / sessions 读写面 + 收口面（Ledger extends 本面——方法名恒平，ledger.ts 摊入） */
export interface WorkRecordsFace {
  insertWorkRecord(record: unknown): string
  getWorkRecord(id: string): WorkRecord | undefined
  listWorkRecords(query?: { issue?: string }): WorkRecord[]
  insertSession(record: unknown): string
  /** 会话收口面（studio-dev-551）：false=行缺失（明报不补插）；已收口再收=CONFIG_INVALID */
  endSession(sessionId: string, end: EndSessionInput): boolean
  getSession(sessionId: string): SessionRecord | undefined
  listSessions(query?: { issue?: string }): SessionRecord[]
  /** work_records 收口面（在途→终态，一次性）：已 ended 再收=CONFIG_INVALID；cost_usd/tokens/
   *  report_ref/summary_ref/model/executor_session_id 未给值的列不动（COALESCE 语义）；无此行=false。 */
  endWorkRecord(id: string, end: EndWorkRecord): boolean
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
  const execSid = optStr(row, 'executor_session_id')
  if (execSid !== undefined) rec.executor_session_id = execSid
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
  // model（132-§6.1 单A·v8 尾列）：NULL=无从可知（旧执行）；tokens 旧形 `cached` 键原样往返——读侧兼容归消费方，本层不改写键
  const model = optStr(row, 'model')
  if (model !== undefined) rec.model = model
  return rec
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

export { rowToSession, rowToWorkRecord }

/** work_records / sessions 面工厂（openLedger 唯一组装点摊入；db=同一句柄，不复制连接/状态） */
export function createWorkRecordsFace(db: DatabaseSync): WorkRecordsFace {
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
        started_at, ended_at, cost_usd, tokens, attempt, status, report_ref, summary_ref, model
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      r.model ?? null,
    )
    return r.id
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

  const listSessions = (query: { issue?: string } = {}): SessionRecord[] => {
    const rows =
      query.issue === undefined
        ? (db.prepare('SELECT * FROM sessions ORDER BY started_at ASC, session_id ASC').all() as SqlRow[])
        : (db
            .prepare('SELECT * FROM sessions WHERE issue = ? ORDER BY started_at ASC, session_id ASC')
            .all(query.issue) as SqlRow[])
    return rows.map(rowToSession)
  }

  /**
   * work_records 收口面（一次性）：先读后写防重——已 ended（ended_at 非空）再收=CONFIG_INVALID
   * （收口=终态迁移，重复收口意味着调用方状态机错乱，如实拒）；可选列未给值走 COALESCE 不动
   * 既有值（对齐 daemon 切换前 closeWorkRecord 语句）。tokens 序列化=JSON.stringify 原序（与
   * insertWorkRecord 同口径，F2-04 只冻结 events 侧）。model（132-§6.1 单A）与
   * executor_session_id（202-P2 v13，Handle.executorSessionId）同 COALESCE 口径直落。
   * 单条 UPDATE 即单事务，无中间态可观测。无此行=false（markRan 同风格）。
   */
  const endWorkRecord = (id: string, end: EndWorkRecord): boolean => {
    const r = assertRecord(EndWorkRecordSchema, end, 'store/work-record:end-invalid')
    const existing = db.prepare('SELECT ended_at FROM work_records WHERE id = ?').get(id) as { ended_at: unknown } | undefined
    if (existing === undefined) return false
    if (existing.ended_at !== null && existing.ended_at !== undefined) {
      configInvalid('store/work-record:already-ended', `工时单 ${id} 已收口（ended_at=${String(existing.ended_at)}）——收口只允许一次`)
    }
    db.prepare(
      `UPDATE work_records SET ended_at = ?, status = ?,
         cost_usd = COALESCE(?, cost_usd), tokens = COALESCE(?, tokens), report_ref = COALESCE(?, report_ref), summary_ref = COALESCE(?, summary_ref),
         model = COALESCE(?, model), executor_session_id = COALESCE(?, executor_session_id)
       WHERE id = ?`,
    ).run(
      r.ended_at,
      r.status,
      r.cost_usd ?? null,
      r.tokens === undefined ? null : JSON.stringify(r.tokens),
      r.report_ref ?? null,
      r.summary_ref ?? null,
      r.model ?? null,
      r.executor_session_id ?? null,
      id,
    )
    return true
  }
  return {
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
    endSession: (sessionId, end) => endSessionRecord(db, sessionId, end),
    endWorkRecord,
  }
}
