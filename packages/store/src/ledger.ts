/**
 * ledger —— 台账句柄：打开/迁移/事件入账/查询面/公司镜像同步（v0.2 首刀 + 第二刀 + v3 jobs + v4 吸收）
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
 *
 * 第二刀扩面（v2 五表，17-§3）：
 *   - syncCompany：CompanySnapshot → people / departments 镜像 upsert。镜像=可重建投影，
 *     允许覆盖写——但**只覆盖快照所载字段**（PersonRef 仅 id/name/login/level/dept，
 *     DeptNode 全列所载）：people 的 role/skills/side_effects/capability_tier/executor_pref/
 *     status 归人事流与后续扩展写面，镜像同步不动它们（不清空、不覆盖）。单事务原子：
 *     预校验全部行后整体落库，任一行非法/重复整批拒。personnel_events 不在此写面
 *     （镜像同步≠人事变动：变动必挂单走 appendPersonnelEvent，F2-06）。
 *   - upsertTicketMirror：YouTrack 镜像，last-write-wins（权威源在 YouTrack，本表随时可重建）。
 *   - appendBudget / queryBudgets：预算三节点（reserve/settle/refusal）落账与 scope 查询。
 *   - appendPersonnelEvent：append-only 写口（v2 迁移挂 UPDATE/DELETE 触发器，机制兜底），
 *     同 id 幂等规则对齐 appendEvent（F2-13）。
 *   - personnelTimeline：personnel_events × work_records × sessions 三表按 person_id 归并的
 *     生命周期时间线最小面（C1-04：一页回放「何时入职/干过哪些单/哪次升迁」）。
 *
 * v3 扩面（jobs 调度表，17-§2 / 18-§三）：
 *   - upsertJob / getJob / listJobs / dueJobs / markRan / removeJob：定时岗持久化投影的读写面。
 *   - 热更语义：upsert 按 job_id 覆盖配置列（next_run_at/status 随入参），**不动其他岗、
 *     不清 last_run_at**（运行时状态归 markRan）；cron 只做形状闸，解析归 core 后续单。
 *   - dueJobs：next_run_at <= now 升序（补跑扫描）；markRan：last_run_at/next_run_at 单语句
 *     原子落库。
 *
 * v4 吸收面（daemon 合龙件三债，migrations v4 同批）：
 *   - kvGet / kvSet：daemon_kv 表正式读写面（活动流游标 / tick.seq 的家）。接管关系与切换
 *     路径见 migrations v4 头注——DDL 与读写语句均与 daemon 现行 engine.ts **字节级一致**
 *     （daemon 后续单删自建语句切本面，数据原地续用）；value 允空串（daemon「游标 null」的
 *     持久形态，回读方负责还原 null）。
 *   - endWorkRecord：work_records 收口面（daemon 现行直发 UPDATE 的正式化）——只允许一次
 *     （已 ended 再收=CONFIG_INVALID）；cost_usd/tokens/report_ref/summary_ref 未给值的列
 *     不动（COALESCE 语义，对齐 daemon 现行语句）。tokens 形状取 kernel.TokenCounts，
 *     序列化=JSON.stringify 原序（与 insertWorkRecord 同口径；work_records.tokens 非
 *     events 四桶 canonical 序——两列不同源，F2-04 只冻结 events 侧）。无此行=false
 *     （markRan 同风格，如实上报）。
 *   - queryEvents 增 order:'asc'|'desc'：desc+limit=「最近 N 条」（panel 倒序通道的库侧
 *     落点；panel 消费接线归后续单）。
 */
import { writeFileSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import {
  configInvalid,
  validateEventRecord,
  type ClassifiedError,
  type CompanySnapshot,
  type EventRecord,
  type ValidationIssue,
} from '@studio-next/contract'
import { openSqlite } from './driver.ts'
import { currentVersion, migrate } from './migrations.ts'
import {
  BudgetRecordSchema,
  DepartmentRecordSchema,
  EndWorkRecordSchema,
  JobRecordSchema,
  PersonRecordSchema,
  PersonnelEventRecordSchema,
  SessionRecordSchema,
  TicketMirrorRecordSchema,
  WorkRecordSchema,
  type BudgetRecord,
  type DepartmentRecord,
  type EndWorkRecord,
  type JobRecord,
  type PersonRecord,
  type PersonnelEventRecord,
  type SessionRecord,
  type TicketMirrorRecord,
  type WorkRecord,
} from './records.ts'

/**
 * events 查询面：全部条件可选，ts 双端闭区间。行序缺省升序（ts, id 稳定序）；
 * order='desc' 时倒序（ts, id 同刻稳定序的镜像反序），与 limit 组合=「最近 N 条」。
 */
export interface EventQuery {
  company?: string
  issue?: string
  /** ts >= since（闭端，epoch ms） */
  since?: number
  /** ts <= until（闭端，epoch ms） */
  until?: number
  limit?: number
  /**
   * 行序（缺省 'asc'）。索引兼容性：company 过滤 + desc 走 idx_events_company_ts
   * (company, ts) 反向扫描（SQLite B-tree 索引双向可走，无新索引需求）；issue 过滤走
   * idx_events_issue 定位后按 (ts,id) 排序；无过滤面全表排序（与 asc 同量级，量大后
   * 再评估独立 ts 索引——拟稿，见 index.ts 疑点清单）。
   */
  order?: 'asc' | 'desc'
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

/** syncCompany 结果：本次镜像落库的 people / departments 行数（入参快照的行数，非库内总行数） */
export interface CompanySyncResult {
  people: number
  departments: number
}

/** budgets 查询面：scope 二元组（scope_kind + scope_id 联合定位一个预算主体） */
export interface BudgetScope {
  scope_kind: BudgetRecord['scope_kind']
  scope_id: string
}

/**
 * 生命周期时间线条目（C1-04 最小面）：personnel_events 变动 × work_records 工时 × sessions
 * 会话三源按 ts 归并；ts 取各自的自然时间（personnel_events.ts / started_at）。
 */
export type PersonnelTimelineEntry =
  | { source: 'personnel_event'; ts: number; record: PersonnelEventRecord }
  | { source: 'work_record'; ts: number; record: WorkRecord }
  | { source: 'session'; ts: number; record: SessionRecord }

/** 台账句柄：daemon 持有；db 暴露 DatabaseSync 标准面（引擎切换只动 driver.ts） */
export interface Ledger {
  db: DatabaseSync
  close(): void
  /** 当前 schema 版本（schema_version 表 MAX(version)；0=无迁移记录） */
  version(): number
  /** events 唯一写口：先契约校验后插入（append-only） */
  appendEvent(record: unknown): AppendResult
  /** events 查询面（缺省升序；order='desc' 倒序——desc+limit=「最近 N 条」，见 EventQuery） */
  queryEvents(query?: EventQuery): EventRecord[]
  /** events 全量 → JSONL（逐行含 ULID；F2-11 库→JSONL 单向派生） */
  dumpEvents(path: string): DumpResult
  insertWorkRecord(record: unknown): string
  getWorkRecord(id: string): WorkRecord | undefined
  listWorkRecords(query?: { issue?: string }): WorkRecord[]
  insertSession(record: unknown): string
  getSession(sessionId: string): SessionRecord | undefined
  listSessions(query?: { issue?: string }): SessionRecord[]
  /** 公司目录快照 → people / departments 镜像 upsert（单事务原子；只覆盖快照所载字段） */
  syncCompany(snapshot: CompanySnapshot): CompanySyncResult
  listPeople(): PersonRecord[]
  getPerson(personId: string): PersonRecord | undefined
  listDepartments(): DepartmentRecord[]
  /** YouTrack 单据镜像 upsert（last-write-wins，权威源在 YouTrack） */
  upsertTicketMirror(record: unknown): string
  getTicketMirror(issue: string): TicketMirrorRecord | undefined
  listTicketMirrors(): TicketMirrorRecord[]
  /** 预算三节点落账（append-only，同 id 幂等规则对齐 appendEvent） */
  appendBudget(record: unknown): AppendResult
  queryBudgets(scope: BudgetScope): BudgetRecord[]
  /** 人事变动事件写口（append-only：触发器机制兜底 + 同 id 幂等规则；必挂单） */
  appendPersonnelEvent(record: unknown): AppendResult
  /** 生命周期时间线：personnel_events × work_records × sessions 三表按 person_id 归并（ts 升序） */
  personnelTimeline(personId: string): PersonnelTimelineEntry[]
  // —— v3 jobs 调度表（17-§2 / 18-§三） ——
  /** 定时岗 upsert（job_id 幂等覆盖配置列；热更单岗不动他岗、不清 last_run_at——见实现注） */
  upsertJob(record: unknown): string
  getJob(jobId: string): JobRecord | undefined
  /** 全部定时岗（next_run_at 升序，同刻按 job_id 稳定序） */
  listJobs(): JobRecord[]
  /** 补跑扫描：next_run_at <= now 的槽位升序（18-§三 启动扫 due 槽位） */
  dueJobs(now: number, limit?: number): JobRecord[]
  /** 记一次实跑：last_run_at/next_run_at 两列同语句原子落库（可观测无中间态） */
  markRan(jobId: string, now: number, nextRunAt: number): boolean
  /** 定时岗下线（公司目录删岗）；返回是否真删了行 */
  removeJob(jobId: string): boolean
  // —— v4 吸收面（daemon 合龙件三债；见文件头注 v4 段） ——
  /** daemon_kv 读：缺键=null；键闸=非空串（拟稿）。接管关系见 migrations v4 头注 */
  kvGet(key: string): string | null
  /** daemon_kv 写（upsert 语义；语句与 daemon 现行 kvSet 字节级一致；value 允空串） */
  kvSet(key: string, value: string): void
  /**
   * work_records 收口面（在途→终态，一次性）：已 ended 再收=CONFIG_INVALID；
   * cost_usd/tokens/report_ref/summary_ref 未给值的列不动（COALESCE 语义）；无此行=false。
   */
  endWorkRecord(id: string, end: EndWorkRecord): boolean
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

// —— v4 daemon_kv 读写语句（与 daemon 现行 engine.ts 的 kvGetStmt/kvSetStmt 逐字一致——字节级兼容；
//     DDL 见 migrations v4：接管期间 daemon 自建语句与本面共存，同表同语义） ——

const KV_GET_SQL = 'SELECT value FROM daemon_kv WHERE key = ?'
const KV_SET_SQL =
  'INSERT INTO daemon_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'

/** kv 键闸（拟稿）：非空字符串——空键=调用方 bug，拒收；value 不设闸（空串=daemon「游标 null」持久形态） */
function assertKvKey(key: string): void {
  if (typeof key !== 'string' || key === '') {
    configInvalid('store/kv:bad-key', 'kv 键须为非空字符串')
  }
}

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

/**
 * canonical JSON（递归按键排序，丢弃 undefined 值）：记录级内容比对用——键序无关，
 * 同内容恒同字节串。events 走 sameEvent 手工全列比对（v1 既有面），五张新表的
 * 同 id 幂等规则走本比对（canonicalJson(rowToX(existing)) === canonicalJson(parsed)）。
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>
    const parts: string[] = []
    for (const key of Object.keys(obj).sort()) {
      if (obj[key] === undefined) continue
      parts.push(`${JSON.stringify(key)}:${canonicalJson(obj[key])}`)
    }
    return `{${parts.join(',')}}`
  }
  return JSON.stringify(value)
}

/** JSON 字符串数组列（skills / functions / lanes）解析：坏列 → CONFIG_INVALID（库已坏，如实报） */
function parseJsonArray(raw: string, subcause: string): string[] {
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === 'string')) {
    configInvalid(subcause, `列不是 JSON 字符串数组：${raw}`)
  }
  return parsed as string[]
}

/** 任意 JSON 值列（jobs.payload）解析：坏列 → CONFIG_INVALID（库已坏，如实报） */
function parseJsonValue(raw: string, subcause: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch (err) {
    configInvalid(subcause, `payload 列不是合法 JSON：${raw}（${errorMessage(err)}）`)
  }
}

/** 错误消息文本化（内联用；与 rebuild.ts 同风格） */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** zod schema 的结构面（免 import zod 类型；safeParse 结果形状即可） */
interface RecordParser<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues: ReadonlyArray<{ path: ReadonlyArray<string | number | symbol>; message: string }> } }
}

/** v2 五表写口的临时闸：非法 → CONFIG_INVALID（subcause=<prefix>:<首个 issue 路径>；对齐 events 闸风格） */
function assertRecord<T>(schema: RecordParser<T>, input: unknown, prefix: string): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const path = first === undefined ? '(root)' : first.path.map(String).join('.') || '(root)'
    configInvalid(`${prefix}:${path}`, first === undefined ? undefined : `${path}: ${first.message}`)
  }
  return parsed.data
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
    // order 白名单闸：方向内插进 SQL（无法参数化绑定），非 'asc'|'desc' 即 CONFIG_INVALID——
    // TS 字面量类型挡编译期，运行期（JS 调用方/配置驱动）仍须如实拒
    if (query.order !== undefined && query.order !== 'asc' && query.order !== 'desc') {
      configInvalid('store/evt:bad-order', `order=${String(query.order)} 须为 'asc' | 'desc'`)
    }
    const dir = query.order === 'desc' ? 'DESC' : 'ASC'
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
    // desc 是 asc 的镜像反序（ts,id 双列同向取反）——同集两序互为 reverse，desc+limit=最近 N 条
    sql += ` ORDER BY ts ${dir}, id ${dir}`
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
    return rec
  }

  const rowToBudget = (row: SqlRow): BudgetRecord => {
    const rec: BudgetRecord = {
      id: str(row, 'id'),
      scope_kind: str(row, 'scope_kind') as BudgetRecord['scope_kind'],
      scope_id: str(row, 'scope_id'),
      kind: str(row, 'kind') as BudgetRecord['kind'],
      ts: Number(row['ts']),
    }
    const estimated = optNum(row, 'estimated_usd')
    if (estimated !== undefined) rec.estimated_usd = estimated
    const actual = optNum(row, 'actual_usd')
    if (actual !== undefined) rec.actual_usd = actual
    return rec
  }

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
         issue, company, created, updated, state, type, dept, level, dispatcher, parent, lane
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(issue) DO UPDATE SET
         company = excluded.company, created = excluded.created, updated = excluded.updated,
         state = excluded.state, type = excluded.type, dept = excluded.dept, level = excluded.level,
         dispatcher = excluded.dispatcher, parent = excluded.parent, lane = excluded.lane`,
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
    )
    return r.issue
  }

  const getTicketMirror = (issue: string): TicketMirrorRecord | undefined => {
    const row = db.prepare('SELECT * FROM ticket_mirror WHERE issue = ?').get(issue) as SqlRow | undefined
    return row === undefined ? undefined : rowToTicketMirror(row)
  }

  const listTicketMirrors = (): TicketMirrorRecord[] =>
    (db.prepare('SELECT * FROM ticket_mirror ORDER BY updated ASC, issue ASC').all() as SqlRow[]).map(rowToTicketMirror)

  const appendBudget = (record: unknown): AppendResult => {
    const r = assertRecord(BudgetRecordSchema, record, 'store/budget:invalid')
    // 幂等规则对齐 appendEvent：同 id 全列一致跳过，不一致抛错（F2-13 回填幂等）
    const existing = db.prepare('SELECT * FROM budgets WHERE id = ?').get(r.id) as SqlRow | undefined
    if (existing !== undefined) {
      if (canonicalJson(rowToBudget(existing)) === canonicalJson(r)) return { id: r.id, appended: false }
      configInvalid('store/budget:duplicate-id', `预算账 id=${r.id} 已存在且内容不一致（拒绝覆盖语义的重复入账）`)
    }
    db.prepare(
      'INSERT INTO budgets (id, scope_kind, scope_id, kind, estimated_usd, actual_usd, ts) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(r.id, r.scope_kind, r.scope_id, r.kind, r.estimated_usd ?? null, r.actual_usd ?? null, r.ts)
    return { id: r.id, appended: true }
  }

  const queryBudgets = (scope: BudgetScope): BudgetRecord[] =>
    (
      db
        .prepare('SELECT * FROM budgets WHERE scope_kind = ? AND scope_id = ? ORDER BY ts ASC, id ASC')
        .all(scope.scope_kind, scope.scope_id) as SqlRow[]
    ).map(rowToBudget)

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

  // —— v3 jobs 调度表读写面（17-§2 / 18-§三） ——

  const rowToJob = (row: SqlRow): JobRecord => {
    const rec: JobRecord = {
      job_id: str(row, 'job_id'),
      company: str(row, 'company'),
      dept: str(row, 'dept'),
      cron: str(row, 'cron'),
      role: str(row, 'role'),
      level: Number(row['level']),
      model_tier: str(row, 'model_tier') as JobRecord['model_tier'],
      next_run_at: Number(row['next_run_at']),
    }
    const budgetCap = optNum(row, 'budget_cap')
    if (budgetCap !== undefined) rec.budget_cap = budgetCap
    const payloadJson = optStr(row, 'payload')
    if (payloadJson !== undefined) rec.payload = parseJsonValue(payloadJson, 'store/jobs:payload-corrupt')
    const lastRunAt = optNum(row, 'last_run_at')
    if (lastRunAt !== undefined) rec.last_run_at = lastRunAt
    const status = optStr(row, 'status')
    if (status !== undefined) rec.status = status
    return rec
  }

  /**
   * 定时岗 upsert：job_id 幂等覆盖——同 job_id 重复 upsert 不报错不涨行，整行按本次所载覆盖。
   * 热更语义（18-§三「重注册对应 job，不动其他岗」）落点：
   *   - ON CONFLICT 更新列集 = 配置列 + next_run_at + status（公司目录所载与调度计算所得）；
   *   - **last_run_at 不在更新列**——它是调度器运行时状态（markRan 落账），公司目录重挂载/热更
   *     不应清零跑史（拟稿待批，见 index.ts 疑点清单）。
   */
  const upsertJob = (record: unknown): string => {
    const r = assertRecord(JobRecordSchema, record, 'store/jobs:invalid')
    let payloadJson: string | null = null
    if (r.payload !== undefined) {
      try {
        const serialized = JSON.stringify(r.payload)
        // undefined 返回值 = 函数/Symbol 等不可 JSON 化的值（stringify 不抛但静默丢）——拒收不静默
        if (serialized === undefined) {
          configInvalid('store/jobs:payload-unserializable', `job ${r.job_id} payload 含不可 JSON 序列化的值`)
        }
        payloadJson = serialized
      } catch (err) {
        configInvalid('store/jobs:payload-unserializable', `job ${r.job_id} payload 不是可序列化 JSON 值：${errorMessage(err)}`)
      }
    }
    db.prepare(
      `INSERT INTO jobs (
         job_id, company, dept, cron, role, level, model_tier, budget_cap, payload, next_run_at, last_run_at, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(job_id) DO UPDATE SET
         company = excluded.company, dept = excluded.dept, cron = excluded.cron, role = excluded.role,
         level = excluded.level, model_tier = excluded.model_tier, budget_cap = excluded.budget_cap,
         payload = excluded.payload, next_run_at = excluded.next_run_at, status = excluded.status`,
    ).run(
      r.job_id,
      r.company,
      r.dept,
      r.cron,
      r.role,
      r.level,
      r.model_tier,
      r.budget_cap ?? null,
      payloadJson,
      r.next_run_at,
      r.last_run_at ?? null,
      r.status ?? null,
    )
    return r.job_id
  }

  const getJob = (jobId: string): JobRecord | undefined => {
    const row = db.prepare('SELECT * FROM jobs WHERE job_id = ?').get(jobId) as SqlRow | undefined
    return row === undefined ? undefined : rowToJob(row)
  }

  const listJobs = (): JobRecord[] =>
    (db.prepare('SELECT * FROM jobs ORDER BY next_run_at ASC, job_id ASC').all() as SqlRow[]).map(rowToJob)

  const dueJobs = (now: number, limit?: number): JobRecord[] => {
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
      configInvalid('store/jobs:bad-limit', `limit=${String(limit)} 须为非负整数`)
    }
    const sql =
      'SELECT * FROM jobs WHERE next_run_at <= ? ORDER BY next_run_at ASC, job_id ASC' +
      (limit === undefined ? '' : ' LIMIT ?')
    const rows = limit === undefined
      ? (db.prepare(sql).all(now) as SqlRow[])
      : (db.prepare(sql).all(now, limit) as SqlRow[])
    return rows.map(rowToJob)
  }

  /** 单条 UPDATE 即单事务：两列同语句移动，无中间态可观测（18-§三 补跑记账的原子基础） */
  const markRan = (jobId: string, now: number, nextRunAt: number): boolean => {
    const result = db.prepare('UPDATE jobs SET last_run_at = ?, next_run_at = ? WHERE job_id = ?').run(now, nextRunAt, jobId)
    return Number(result.changes) > 0
  }

  const removeJob = (jobId: string): boolean => {
    const result = db.prepare('DELETE FROM jobs WHERE job_id = ?').run(jobId)
    return Number(result.changes) > 0
  }

  // —— v4 吸收面实现（daemon 合龙件三债；接口行注与文件头注 v4 段为语义依据） ——

  const kvGet = (key: string): string | null => {
    assertKvKey(key)
    const row = db.prepare(KV_GET_SQL).get(key) as { value: string } | undefined
    return row === undefined ? null : row.value
  }

  const kvSet = (key: string, value: string): void => {
    assertKvKey(key)
    db.prepare(KV_SET_SQL).run(key, value)
  }

  /**
   * work_records 收口面（一次性）：先读后写防重——已 ended（ended_at 非空）再收=CONFIG_INVALID
   * （收口=终态迁移，重复收口意味着调用方状态机错乱，如实拒）；可选列未给值走 COALESCE 不动
   * 既有值（对齐 daemon 切换前 closeWorkRecord 语句——tokens 列位亦同，居 cost_usd 与
   * report_ref 之间）。tokens 序列化=JSON.stringify 原序（与 insertWorkRecord 同口径——
   * work_records.tokens 非 events 四桶 canonical 序，两列不同源，F2-04 只冻结 events 侧）。
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
         cost_usd = COALESCE(?, cost_usd), tokens = COALESCE(?, tokens), report_ref = COALESCE(?, report_ref), summary_ref = COALESCE(?, summary_ref)
       WHERE id = ?`,
    ).run(
      r.ended_at,
      r.status,
      r.cost_usd ?? null,
      r.tokens === undefined ? null : JSON.stringify(r.tokens),
      r.report_ref ?? null,
      r.summary_ref ?? null,
      id,
    )
    return true
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
    appendBudget,
    queryBudgets,
    appendPersonnelEvent,
    personnelTimeline,
    upsertJob,
    getJob,
    listJobs,
    dueJobs,
    markRan,
    removeJob,
    kvGet,
    kvSet,
    endWorkRecord,
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
