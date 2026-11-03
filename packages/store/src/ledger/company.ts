/**
 * company —— 公司目录镜像同步面（people / departments / ticket_mirror / todo_queue）+
 * 人事变动事件与生命周期时间线（自 ledger.ts 原样拆出，零行为变更）
 *
 * 表 DDL 归 migrations v1/v2/v8；镜像=可重建投影（syncCompany 只覆盖快照所载字段，
 * upsertTicketMirror last-write-wins）；personnel_events append-only 由 v2 迁移触发器兜底。
 * 行 ↔ 记录映射在本模块单一口径源；personnelTimeline 的三源归并复用 work-records.ts
 * 导出的 rowToWorkRecord / rowToSession（不复制映射）。db 由 openLedger 唯一持有并注入。
 */
import type { DatabaseSync } from 'node:sqlite'
import { configInvalid, type CompanySnapshot } from '@studio-next/contract'
import {
  DepartmentRecordSchema,
  PersonRecordSchema,
  PersonnelEventRecordSchema,
  TicketMirrorRecordSchema,
  TodoQueueRecordSchema,
  type DepartmentRecord,
  type PersonRecord,
  type PersonnelEventRecord,
  type SessionRecord,
  type TicketMirrorRecord,
  type TodoQueueRecord,
  type WorkRecord,
} from '../records.ts'
import { assertRecord, optNum, optStr, str, type SqlRow } from '../row-helpers.ts'
import { canonicalJson, parseJsonArray, type AppendResult } from './shared.ts'
import { rowToSession, rowToWorkRecord } from './work-records.ts'

/** syncCompany 结果：本次镜像落库的 people / departments 行数（入参快照的行数，非库内总行数） */
export interface CompanySyncResult {
  people: number
  departments: number
}

/**
 * 生命周期时间线条目（C1-04 最小面）：personnel_events 变动 × work_records 工时 × sessions
 * 会话三源按 ts 归并；ts 取各自的自然时间（personnel_events.ts / started_at）。
 */
export type PersonnelTimelineEntry =
  | { source: 'personnel_event'; ts: number; record: PersonnelEventRecord }
  | { source: 'work_record'; ts: number; record: WorkRecord }
  | { source: 'session'; ts: number; record: SessionRecord }

/** 公司镜像 / 单据镜像 / todo_queue / 人事变动面（Ledger extends 本面——方法名恒平，ledger.ts 摊入） */
export interface CompanyFace {
  /** 公司目录快照 → people / departments 镜像 upsert（单事务原子；只覆盖快照所载字段） */
  syncCompany(snapshot: CompanySnapshot): CompanySyncResult
  listPeople(): PersonRecord[]
  getPerson(personId: string): PersonRecord | undefined
  listDepartments(): DepartmentRecord[]
  /** YouTrack 单据镜像 upsert（last-write-wins，权威源在 YouTrack） */
  upsertTicketMirror(record: unknown): string
  getTicketMirror(issue: string): TicketMirrorRecord | undefined
  listTicketMirrors(): TicketMirrorRecord[]
  /**
   * todo_queue 投影全量重投（129-§6.2-R2，v8）：单事务 DELETE+INSERT 整公司换——
   * 可重建投影非事实源（单写者=daemon 每拍末调，diff 判定归引擎侧）；决策永不读表。
   */
  replaceTodoQueue(company: string, rows: readonly unknown[]): number
  /** todo_queue 读面（company 维；行序 person→first_seen_at→ticket——面板/测试用） */
  listTodoQueue(company?: string): TodoQueueRecord[]
  /**
   * 最近派发等待序列（schedule-to-start 观测面，129-B）：近 N 条 DISPATCH 事件 note
   * `wait=<ms>` 解析（17-§3 note 结构化先例：fp=/budget= 同款）；无 wait 锚的旧事件跳过。
   */
  recentDispatchWaitsMs(company: string, limit: number): number[]
  /** 人事变动事件写口（append-only：触发器机制兜底 + 同 id 幂等规则；必挂单） */
  appendPersonnelEvent(record: unknown): AppendResult
  /** 生命周期时间线：personnel_events × work_records × sessions 三表按 person_id 归并（ts 升序） */
  personnelTimeline(personId: string): PersonnelTimelineEntry[]
}

// —— v2 五表读写面（17-§3） ——

const rowToPerson = (row: SqlRow): PersonRecord => {
  const rec: PersonRecord = {
    person_id: str(row, 'person_id'),
    name: str(row, 'name'),
    login: str(row, 'login'),
    level: Number(row['level']),
    dept: str(row, 'dept'),
  }
  const role = optStr(row, 'role')
  if (role !== undefined) rec.role = role
  const skills = optStr(row, 'skills')
  if (skills !== undefined) rec.skills = parseJsonArray(skills, 'store/people:skills-corrupt')
  const sideEffects = optStr(row, 'side_effects')
  if (sideEffects !== undefined) rec.side_effects = parseJsonArray(sideEffects, 'store/people:side-effects-corrupt')
  const tier = optNum(row, 'capability_tier')
  if (tier !== undefined) rec.capability_tier = tier
  const executorPref = optStr(row, 'executor_pref')
  if (executorPref !== undefined) rec.executor_pref = executorPref
  const status = optStr(row, 'status')
  if (status !== undefined) rec.status = status
  return rec
}

const rowToPersonnelEvent = (row: SqlRow): PersonnelEventRecord => {
  const rec: PersonnelEventRecord = {
    id: str(row, 'id'),
    ts: Number(row['ts']),
    person_id: str(row, 'person_id'),
    type: str(row, 'type'),
    ticket: str(row, 'ticket'),
    approver: str(row, 'approver'),
  }
  const prev = optStr(row, 'prev')
  if (prev !== undefined) rec.prev = prev
  const next = optStr(row, 'next')
  if (next !== undefined) rec.next = next
  return rec
}

const rowToDepartment = (row: SqlRow): DepartmentRecord => {
  const rec: DepartmentRecord = {
    path: str(row, 'path'),
    company: str(row, 'company'),
    leader: str(row, 'leader'),
    functions: parseJsonArray(str(row, 'functions'), 'store/departments:functions-corrupt'),
    lanes: parseJsonArray(str(row, 'lanes'), 'store/departments:lanes-corrupt'),
  }
  const parentPath = optStr(row, 'parent_path')
  if (parentPath !== undefined) rec.parent_path = parentPath
  return rec
}

const rowToTicketMirror = (row: SqlRow): TicketMirrorRecord => {
  const rec: TicketMirrorRecord = {
    issue: str(row, 'issue'),
    company: str(row, 'company'),
    created: Number(row['created']),
    updated: Number(row['updated']),
    state: str(row, 'state'),
    type: str(row, 'type'),
    dept: str(row, 'dept'),
    level: Number(row['level']),
    dispatcher: str(row, 'dispatcher'),
  }
  const parent = optStr(row, 'parent')
  if (parent !== undefined) rec.parent = parent
  const lane = optStr(row, 'lane')
  if (lane !== undefined) rec.lane = lane
  const assignee = optStr(row, 'assignee')
  if (assignee !== undefined) rec.assignee = assignee
  return rec
}

const rowToTodoQueue = (row: SqlRow): TodoQueueRecord => {
  const rec: TodoQueueRecord = {
    company: str(row, 'company'),
    ticket: str(row, 'ticket'),
    person: str(row, 'person'),
    priority: Number(row['priority']),
    pinned: Number(row['pinned']),
    boost_tier: Number(row['boost_tier']),
    first_seen_at: Number(row['first_seen_at']),
    ready_state: str(row, 'ready_state') === 'awaiting_approval' ? 'awaiting_approval' : 'ready',
    updated_at: Number(row['updated_at']),
  }
  const lastBoost = optNum(row, 'last_boost_at')
  if (lastBoost !== undefined) rec.last_boost_at = lastBoost
  const why = optStr(row, 'why')
  if (why !== undefined) rec.why = why
  return rec
}

/** 公司面工厂（openLedger 唯一组装点摊入；db=同一句柄，不复制连接/状态） */
export function createCompanyFace(db: DatabaseSync): CompanyFace {
  /**
   * 公司目录快照 → people / departments 镜像 upsert（单事务原子）。
   * 只覆盖快照所载字段（PersonRef 五字段 / DeptNode 全列）；people 扩展列（role/skills/
   * side_effects/capability_tier/executor_pref/status）归人事流与后续写面，此处不清空不覆盖。
   * 镜像收敛（目录已删的人/部门是否剔除）v0 不做——退/停走 personnel_events 流程，直接删行
   * 丢状态语义（拟稿待批，见 index.ts TODO）。
   */
  const syncCompany = (snapshot: CompanySnapshot): CompanySyncResult => {
    // 预校验 + 快照内查重（任一行非法/重复 → 整批拒，不开写事务）
    const peopleRows: PersonRecord[] = []
    const seenPeople = new Set<string>()
    for (const p of snapshot.people) {
      const row: PersonRecord = { person_id: p.id, name: p.name, login: p.login, level: p.level, dept: p.dept }
      assertRecord(PersonRecordSchema, row, 'store/people:invalid')
      if (seenPeople.has(row.person_id)) {
        configInvalid('store/people:duplicate', `快照内 person_id 重复：${row.person_id}`)
      }
      seenPeople.add(row.person_id)
      peopleRows.push(row)
    }
    const deptRows: DepartmentRecord[] = []
    const seenDepts = new Set<string>()
    for (const d of snapshot.departments) {
      const row: DepartmentRecord = {
        path: d.path,
        company: snapshot.slug,
        leader: d.leader,
        functions: [...d.functions],
        lanes: [...d.lanes],
      }
      if (d.parent !== null) row.parent_path = d.parent
      assertRecord(DepartmentRecordSchema, row, 'store/departments:invalid')
      if (seenDepts.has(row.path)) {
        configInvalid('store/departments:duplicate', `快照内部门 path 重复：${row.path}`)
      }
      seenDepts.add(row.path)
      deptRows.push(row)
    }
    db.exec('BEGIN')
    try {
      const upsertPerson = db.prepare(
        `INSERT INTO people (person_id, name, login, level, dept) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(person_id) DO UPDATE SET
           name = excluded.name, login = excluded.login, level = excluded.level, dept = excluded.dept`,
      )
      for (const r of peopleRows) upsertPerson.run(r.person_id, r.name, r.login, r.level, r.dept)
      const upsertDept = db.prepare(
        `INSERT INTO departments (path, company, leader, functions, lanes, parent_path) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           company = excluded.company, leader = excluded.leader,
           functions = excluded.functions, lanes = excluded.lanes, parent_path = excluded.parent_path`,
      )
      for (const r of deptRows) {
        upsertDept.run(r.path, r.company, r.leader, JSON.stringify(r.functions), JSON.stringify(r.lanes), r.parent_path ?? null)
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    return { people: peopleRows.length, departments: deptRows.length }
  }

  const listPeople = (): PersonRecord[] =>
    (db.prepare('SELECT * FROM people ORDER BY person_id ASC').all() as SqlRow[]).map(rowToPerson)

  const listDepartments = (): DepartmentRecord[] =>
    (db.prepare('SELECT * FROM departments ORDER BY path ASC').all() as SqlRow[]).map(rowToDepartment)

  const upsertTicketMirror = (record: unknown): string => {
    const r = assertRecord(TicketMirrorRecordSchema, record, 'store/ticket-mirror:invalid')
    db.prepare(
      `INSERT INTO ticket_mirror (
         issue, company, created, updated, state, type, dept, level, dispatcher, parent, lane, assignee
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(issue) DO UPDATE SET
         company = excluded.company, created = excluded.created, updated = excluded.updated,
         state = excluded.state, type = excluded.type, dept = excluded.dept, level = excluded.level,
         dispatcher = excluded.dispatcher, parent = excluded.parent, lane = excluded.lane,
         assignee = excluded.assignee`,
    ).run(
      r.issue,
      r.company,
      r.created,
      r.updated,
      r.state,
      r.type,
      r.dept,
      r.level,
      r.dispatcher,
      r.parent ?? null,
      r.lane ?? null,
      r.assignee ?? null,
    )
    return r.issue
  }

  const getTicketMirror = (issue: string): TicketMirrorRecord | undefined => {
    const row = db.prepare('SELECT * FROM ticket_mirror WHERE issue = ?').get(issue) as SqlRow | undefined
    return row === undefined ? undefined : rowToTicketMirror(row)
  }

  const listTicketMirrors = (): TicketMirrorRecord[] =>
    (db.prepare('SELECT * FROM ticket_mirror ORDER BY updated ASC, issue ASC').all() as SqlRow[]).map(rowToTicketMirror)

  // —— v8 todo_queue 投影读写面（129-§6.2-R2，studio-dev-167 单B） ——

  const insertTodoQueue = db.prepare(
    `INSERT INTO todo_queue (
       company, ticket, person, priority, pinned, boost_tier, first_seen_at, last_boost_at, ready_state, why, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  const replaceTodoQueue = (company: string, rows: readonly unknown[]): number => {
    const parsed = rows.map((row) => {
      const r = assertRecord(TodoQueueRecordSchema, row, 'store/todo-queue:invalid')
      if (r.company !== company) {
        configInvalid('store/todo-queue:company-mismatch', `行 company=${r.company} 与重投目标 company=${company} 不一致（整换按公司维，拒跨维写入）`)
      }
      return r
    })
    db.exec('BEGIN')
    try {
      db.prepare('DELETE FROM todo_queue WHERE company = ?').run(company)
      for (const r of parsed) {
        insertTodoQueue.run(
          r.company,
          r.ticket,
          r.person,
          r.priority,
          r.pinned,
          r.boost_tier,
          r.first_seen_at,
          r.last_boost_at ?? null,
          r.ready_state,
          r.why ?? null,
          r.updated_at,
        )
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    return parsed.length
  }

  const listTodoQueue = (company?: string): TodoQueueRecord[] => {
    const rows =
      company === undefined
        ? (db.prepare('SELECT * FROM todo_queue ORDER BY company ASC, person ASC, first_seen_at ASC, ticket ASC').all() as SqlRow[])
        : (db
            .prepare('SELECT * FROM todo_queue WHERE company = ? ORDER BY person ASC, first_seen_at ASC, ticket ASC')
            .all(company) as SqlRow[])
    return rows.map(rowToTodoQueue)
  }

  /** DISPATCH note wait 锚解析（`;wait=123` 尾缀段——17-§3 note 结构化先例；无锚跳过） */
  const dispatchWaitOfNote = (note: string | undefined): number | undefined => {
    if (note === undefined) return undefined
    const m = /(?:^|[; ])wait=(\d+)/.exec(note)
    return m === null ? undefined : Number(m[1])
  }

  const recentDispatchWaitsMs = (company: string, limit: number): number[] => {
    const rows = db
      .prepare('SELECT note FROM events WHERE company = ? AND event = ? ORDER BY ts DESC, id DESC LIMIT ?')
      .all(company, 'DISPATCH', limit) as Array<{ note: unknown }>
    const waits: number[] = []
    for (const row of rows) {
      const note = typeof row['note'] === 'string' ? row['note'] : undefined
      const wait = dispatchWaitOfNote(note)
      if (wait !== undefined) waits.push(wait)
    }
    return waits
  }

  const appendPersonnelEvent = (record: unknown): AppendResult => {
    const r = assertRecord(PersonnelEventRecordSchema, record, 'store/personnel-event:invalid')
    // 幂等规则对齐 appendEvent：同 id 全列一致跳过，不一致抛错（append-only + F2-13 回填幂等；
    // UPDATE/DELETE 另有 v2 迁移触发器机制兜底）
    const existing = db.prepare('SELECT * FROM personnel_events WHERE id = ?').get(r.id) as SqlRow | undefined
    if (existing !== undefined) {
      if (canonicalJson(rowToPersonnelEvent(existing)) === canonicalJson(r)) return { id: r.id, appended: false }
      configInvalid(
        'store/personnel-event:duplicate-id',
        `人事事件 id=${r.id} 已存在且内容不一致（append-only，拒绝覆盖语义的重复入账）`,
      )
    }
    db.prepare(
      'INSERT INTO personnel_events (id, ts, person_id, type, prev, next, ticket, approver) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(r.id, r.ts, r.person_id, r.type, r.prev ?? null, r.next ?? null, r.ticket, r.approver)
    return { id: r.id, appended: true }
  }

  /** 同 ts 稳定序：personnel_event → work_record → session，再按各自 id */
  const TIMELINE_SOURCE_RANK = { personnel_event: 0, work_record: 1, session: 2 } as const

  function timelineTieId(entry: PersonnelTimelineEntry): string {
    if (entry.source === 'session') return entry.record.session_id
    return entry.record.id
  }

  const personnelTimeline = (personId: string): PersonnelTimelineEntry[] => {
    const entries: PersonnelTimelineEntry[] = []
    for (const r of (db.prepare('SELECT * FROM personnel_events WHERE person_id = ?').all(personId) as SqlRow[]).map(rowToPersonnelEvent)) {
      entries.push({ source: 'personnel_event', ts: r.ts, record: r })
    }
    for (const r of (db.prepare('SELECT * FROM work_records WHERE person_id = ?').all(personId) as SqlRow[]).map(rowToWorkRecord)) {
      entries.push({ source: 'work_record', ts: r.started_at, record: r })
    }
    for (const r of (db.prepare('SELECT * FROM sessions WHERE person_id = ?').all(personId) as SqlRow[]).map(rowToSession)) {
      entries.push({ source: 'session', ts: r.started_at, record: r })
    }
    entries.sort(
      (a, b) => a.ts - b.ts || TIMELINE_SOURCE_RANK[a.source] - TIMELINE_SOURCE_RANK[b.source] || timelineTieId(a).localeCompare(timelineTieId(b)),
    )
    return entries
  }
  return {
    syncCompany,
    listPeople,
    getPerson: (personId: string) => {
      const row = db.prepare('SELECT * FROM people WHERE person_id = ?').get(personId) as SqlRow | undefined
      return row === undefined ? undefined : rowToPerson(row)
    },
    listDepartments,
    upsertTicketMirror,
    getTicketMirror,
    listTicketMirrors,
    replaceTodoQueue,
    listTodoQueue,
    recentDispatchWaitsMs,
    appendPersonnelEvent,
    personnelTimeline,
  }
}
