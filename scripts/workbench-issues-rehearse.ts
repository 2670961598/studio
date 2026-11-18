/**
 * workbench-issues-rehearse —— 单子切换准备·真实 Phase0 10 单导入演练（task-127-B）
 *
 * 依据：docs/sentinel-logs/单子切换-runbook-2026-11-18.md（§四 回滚／§五 验收证据口径／§七 工具用法）、
 *       docs/quality/phase0/ticket-export.json（task-64 Phase0 切片2 真实 10 单只读导出）、
 *       docs/quality/phase0/ticket-diff.json（Phase0 预期映射/状态——本演练的独立期望表）。
 *
 * 链路：真实导出 → 适配为 127-A fixture 形态 → buildPlan（127-A 迁移计划）→ 导入临时 SQLite
 *   （node:sqlite + vendor/workbench-core/issues/src/sqlite-schema.ts 的 DDL/CHECK/STRICT 原样建表）
 *   → 重新读取目标库构造「观测计划」→ workbench-issues-diff 对账（计数/状态/层级/comments/关键字段）
 *   → 0 gap exit 0；显式 gap exit 1。
 *
 * 独立期望表（127-B P2 修复 #2）：ticket-diff.json 的 mapping[].desiredStateCode 是 Phase0 落库真值，
 *   本工具与测试都用它独立断言（不只用 migrate.ts 的共享推导件）：快照行 STATE_MAP 重现 + 活行对账 +
 *   漂移行（导出状态晚于 Phase0 快照）显式列出待豁免，不静默。
 *
 * 边界（铁律）：不写生产、不网络、不引第三方依赖；临时库放 os.tmpdir() 跑完即清（--keep-db/--db 除外）；
 *   时间戳全部取自源数据，全程不取系统时钟（幂等前提）。
 *
 * 用法：node scripts/workbench-issues-rehearse.ts [--export <ticket-export.json>] [--expectations <ticket-diff.json>]
 *        [--skip-expectations] [--dry-run] [--db <path>] [--keep-db] [--out <report.json>]
 *   --dry-run  只打印计划/目标行计数（tickets/labels/comments 行数），不建任何数据库
 *   --db       显式库文件路径（不自动清理，由调用方管理）；缺省 mkdtemp 临时库，跑完清理
 * 退出码：0=0 gap 且期望表重现；1=显式 gap/期望失败；2=用法/文件结构错误。
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { SCHEMA_SQL, SCHEMA_VERSION } from '../vendor/workbench-core/issues/src/sqlite-schema.ts'
import { MAX_PARENT_DEPTH, STATE_CATALOG } from '../vendor/workbench-core/issues/src/catalog.ts'
import {
  PLAN_SCHEMA,
  STATE_MAP,
  UsageError,
  buildPlan,
  canonicalJson,
  planHashOf,
  sha256Hex,
  sha256Of,
  slugOf,
  type FixtureIssue,
  type ImportPlan,
  type PlannedIssue,
  type TaigaExportFixture,
} from './workbench-issues-migrate.ts'
import { diffPlanAgainstSource, type DiffReport } from './workbench-issues-diff.ts'

export const REHEARSE_SCHEMA = 'issues-migrate-rehearse/v1'
export const PHASE0_EXPORT_SCHEMA = 'phase0-ticket-export/v1'
export const PHASE0_DIFF_SCHEMA = 'phase0-ticket-diff/v1'
export const DEFAULT_EXPORT = path.resolve(import.meta.dirname, '../docs/quality/phase0/ticket-export.json')
export const DEFAULT_EXPECTATIONS = path.resolve(import.meta.dirname, '../docs/quality/phase0/ticket-diff.json')
export const VENDOR_SNAPSHOT = 'workbench-issues sqlite-schema v1（vendor/workbench-core/issues/src/sqlite-schema.ts SCHEMA_SQL 原样）'

/** 这些 gap 会让 vendor DDL CHECK 直接拒行——先不建库、显式 exit 1（fail-closed，不降级硬塞） */
export const VENDOR_BLOCKING_GAP_KINDS: readonly string[] = ['comment-body-empty', 'comment-body-too-long', 'parent-depth-exceeded']

/* ------------------------------------------------------------------ */
/* Phase0 真实导出解析（docs/quality/phase0/ticket-export.json）         */
/* ------------------------------------------------------------------ */

export interface Phase0Comment {
  readonly id: string
  readonly author: string
  readonly body: string
  readonly replyTo: string | null
  readonly createdAt: number
}

export interface Phase0Row {
  readonly issue: string
  readonly state: string
  readonly type: string
  readonly dept: string
  readonly level: number
  readonly dispatcher: string | null
  readonly parent: string | null
  readonly lane: string | null
  readonly assignee: string | null
  readonly created: number
  readonly updated: number
  /** 台账镜像无 comments 表（ticket-diff.json commentsGap）——真实导出不带；字段留作后续导出升级直通 */
  readonly comments: readonly Phase0Comment[]
}

export interface Phase0Export {
  readonly schema: string
  readonly rows: readonly Phase0Row[]
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new UsageError(`${where}：应为对象`)
  return value as Record<string, unknown>
}
function asString(value: unknown, where: string): string {
  if (typeof value !== 'string') throw new UsageError(`${where}：应为字符串`)
  return value
}
function asNumber(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new UsageError(`${where}：应为有限数字`)
  return value
}
function asArray(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) throw new UsageError(`${where}：应为数组`)
  return value
}
function optString(value: unknown, where: string): string | null {
  return value === undefined || value === null ? null : asString(value, where)
}

function parseComment(value: unknown, where: string): Phase0Comment {
  const rec = asRecord(value, where)
  return {
    id: asString(rec['id'], `${where}.id`),
    author: asString(rec['author'], `${where}.author`),
    body: asString(rec['body'], `${where}.body`),
    replyTo: optString(rec['replyTo'], `${where}.replyTo`),
    createdAt: asNumber(rec['createdAt'], `${where}.createdAt`),
  }
}

export function parsePhase0Export(raw: unknown): Phase0Export {
  const r = asRecord(raw, 'export')
  const schema = asString(r['schema'] ?? PHASE0_EXPORT_SCHEMA, 'export.schema')
  const rows = asArray(r['rows'], 'export.rows').map((row, i): Phase0Row => {
    const rec = asRecord(row, `export.rows[${String(i)}]`)
    return {
      issue: asString(rec['issue'], `export.rows[${String(i)}].issue`),
      state: asString(rec['state'], `export.rows[${String(i)}].state`),
      type: asString(rec['type'], `export.rows[${String(i)}].type`),
      dept: asString(rec['dept'], `export.rows[${String(i)}].dept`),
      level: asNumber(rec['level'], `export.rows[${String(i)}].level`),
      dispatcher: optString(rec['dispatcher'], `export.rows[${String(i)}].dispatcher`),
      parent: optString(rec['parent'], `export.rows[${String(i)}].parent`),
      lane: optString(rec['lane'], `export.rows[${String(i)}].lane`),
      assignee: optString(rec['assignee'], `export.rows[${String(i)}].assignee`),
      created: asNumber(rec['created'], `export.rows[${String(i)}].created`),
      updated: asNumber(rec['updated'], `export.rows[${String(i)}].updated`),
      comments: asArray(rec['comments'] ?? [], `export.rows[${String(i)}].comments`).map((c, j) => parseComment(c, `export.rows[${String(i)}].comments[${String(j)}]`)),
    }
  })
  if (rows.length === 0) throw new UsageError('export.rows：不能为空')
  return { schema, rows }
}

export function loadPhase0Export(exportPath: string): Phase0Export {
  let text: string
  try {
    text = readFileSync(exportPath, 'utf8')
  } catch (cause) {
    throw new UsageError(`export 不可读：${exportPath}（${String(cause)}）`)
  }
  try {
    return parsePhase0Export(JSON.parse(text))
  } catch (cause) {
    if (cause instanceof UsageError) throw new UsageError(`${exportPath}: ${cause.message}`)
    throw new UsageError(`${exportPath}: JSON 解析失败（${String(cause)}）`)
  }
}

/** 单 ref（如 studio-dev-1495）→ [project slug, 数字 ref]；解析失败=结构错误 */
export function splitIssueRef(ref: string): { project: string; id: number } {
  const m = /^(.+)-(\d+)$/.exec(ref)
  if (m === null) throw new UsageError(`issue ref 无法解析为 <project>-<数字>：${ref}`)
  return { project: m[1] as string, id: Number(m[2]) }
}

/* ------------------------------------------------------------------ */
/* 适配：Phase0 真实导出 → 127-A fixture 形态（buildPlan 的输入）        */
/* ------------------------------------------------------------------ */

export interface RehearsalSource {
  readonly fixture: TaigaExportFixture
  readonly rowsKept: readonly Phase0Row[]
  readonly rowsDropped: number
  readonly notes: readonly string[]
}

/**
 * 适配规则（每条都显式记录，不静默压缩）：
 * - keyPrefix=项目 slug → 计划 key = 源 ref 原样（评估 §二.1「公开 ID 保留为 key」，ID roundtrip 口径）
 * - 台账镜像无 title → 标题按 Phase0 口径合成 `[<ref>] <type> · <state>`（ticket-diff.json titleGap）
 * - 台账镜像无 description → body 装源行 JSON（含 note），目标库自证来源
 * - 台账镜像无 comments 表 → comments=[]（显式 gap 记录，不伪造）
 * - 台账镜像无 closedAt → done_at=null（不伪造）；assignee/dispatcher 句柄合成 principals（kind=agent）
 */
export function adaptPhase0Export(exported: Phase0Export): RehearsalSource {
  const notes: string[] = []
  // 自然键去重：与 127-A 同语义 last-write-wins（updated 大者胜，平局取靠后者）
  const kept = new Map<string, { row: Phase0Row; index: number }>()
  let dropped = 0
  exported.rows.forEach((row, index) => {
    const current = kept.get(row.issue)
    if (current === undefined) {
      kept.set(row.issue, { row, index })
      return
    }
    if (row.updated > current.row.updated || (row.updated === current.row.updated && index > current.index)) {
      kept.set(row.issue, { row, index })
    }
    dropped += 1
  })
  const rows = [...kept.values()].map((k) => k.row)
  if (dropped > 0) notes.push(`重复 ref 记录 ${String(dropped)} 条按 last-write-wins 丢弃（与 127-A dedup 同语义）`)

  const projects = new Map<string, { name: string; ids: Set<number> }>()
  for (const row of rows) {
    const { project, id } = splitIssueRef(row.issue)
    const entry = projects.get(project) ?? { name: `${project}（phase0 ticket_mirror 投影）`, ids: new Set<number>() }
    entry.ids.add(id)
    projects.set(project, entry)
  }

  // principals：从 assignee/dispatcher/评论作者句柄合成（kind=agent；display=句柄）——显式来源，不编造身份
  const handles = new Set<string>()
  for (const row of rows) {
    if (row.assignee !== null) handles.add(row.assignee)
    if (row.dispatcher !== null) handles.add(row.dispatcher)
    for (const c of row.comments) handles.add(c.author)
  }
  const usernames = [...handles].sort()
  notes.push(`principals 由 assignee/dispatcher/评论作者句柄合成 ${String(usernames.length)} 个（kind=agent, display=句柄；台账镜像无用户表）`)
  notes.push('台账镜像无 title/description：标题按 Phase0 口径合成 `[<ref>] <type> · <state>`，body 装源行 JSON')
  const commentTotal = rows.reduce((sum, row) => sum + row.comments.length, 0)
  notes.push(commentTotal === 0
    ? '台账镜像无 comments 表：本导出 rows[].comments 缺席 → 0 条（显式 gap，不伪造）——见 ticket-diff.json commentsGap'
    : `rows[].comments 携带 ${String(commentTotal)} 条评论随迁`)
  notes.push('台账镜像无 closedAt 列：done_at 全 null（不伪造收口时间）')

  // dept slug 碰撞检测（127-A slugOf 口径：非 ASCII 折叠可能并值）——显式记录，真迁前需处理
  const deptSlug = new Map<string, string>()
  for (const row of rows) {
    const slug = `ext-dept-${slugOf(row.dept)}`
    const prev = deptSlug.get(slug)
    if (prev !== undefined && prev !== row.dept) notes.push(`ext-dept 标签 slug 碰撞：${prev} 与 ${row.dept} → ${slug}（127-A slugOf 口径；真迁前需扩 vendor 字段或改标签编码）`)
    else deptSlug.set(slug, row.dept)
  }

  const users = usernames.map((username, i) => ({ id: i + 1, username, fullName: username, kind: 'agent' as const }))
  const issues: FixtureIssue[] = rows.map((row) => {
    const { project, id } = splitIssueRef(row.issue)
    let parent: number | null = null
    if (row.parent !== null) {
      const parsed = splitIssueRef(row.parent)
      if (parsed.project !== project) notes.push(`${row.issue} 的 parent ${row.parent} 跨项目：置空导入（127-A 计划按同项目父链解析）`)
      else parent = parsed.id
    }
    return {
      id,
      project,
      subject: `[${row.issue}] ${row.type} · ${row.state}`,
      description: JSON.stringify({
        externalRef: row.issue, state: row.state, type: row.type, dept: row.dept, level: row.level,
        dispatcher: row.dispatcher, lane: row.lane, assignee: row.assignee, parent: row.parent,
        created: row.created, updated: row.updated,
        note: 'phase0 rehearsal: ledger mirror has no title/description/comments; title synthesized; attachments not migrated',
      }),
      status: row.state,
      type: row.type,
      dept: row.dept,
      level: row.level,
      lane: row.lane,
      assignee: row.assignee,
      dispatcher: row.dispatcher,
      parent,
      comments: row.comments.map((c) => ({ id: c.id, author: c.author, body: c.body, replyTo: c.replyTo, createdAt: c.createdAt })),
      createdAt: row.created,
      updatedAt: row.updated,
      closedAt: null,
    }
  })

  const slugs = [...projects.keys()].sort()
  const fixture: TaigaExportFixture = {
    schema: 'taiga-export-fixture/v1',
    exportedAt: rows.reduce((max, row) => Math.max(max, row.updated), 0),
    source: `docs/quality/phase0/ticket-export.json（${exported.schema}，task-64 Phase0 切片2 只读导出）`,
    projects: slugs.map((slug, i) => ({ id: i + 1, slug, name: projects.get(slug)?.name ?? slug, keyPrefix: slug })),
    users,
    issues,
  }
  return { fixture, rowsKept: rows, rowsDropped: dropped, notes: [...new Set(notes)] }
}

/* ------------------------------------------------------------------ */
/* 独立期望表（ticket-diff.json：Phase0 落库真值，非本工具链推导）        */
/* ------------------------------------------------------------------ */

export interface ExpectationRow {
  readonly externalRef: string
  readonly originalState: string
  readonly desiredStateCode: number
  readonly importedStateCode: number
  readonly stateMatched: boolean
}

export interface Expectations {
  readonly schema: string
  readonly selected: number
  readonly stateMatched: number
  readonly stateExemptions: number
  readonly idRoundtrip: boolean
  readonly mapping: readonly ExpectationRow[]
}

export interface ExpectationDrift {
  readonly issue: string
  readonly snapshotState: string
  readonly currentState: string
  readonly snapshotDesiredCode: number
  readonly plannedCode: number
  readonly plannedName: string
  readonly note: string
}

export interface ExpectationCheck {
  readonly path: string
  readonly snapshotRows: number
  /** 快照行独立重现：STATE_MAP[originalState] === desiredStateCode（验证冻结映射表，不经共享推导链） */
  readonly snapshotReproduced: number
  readonly liveRows: number
  /** 活行（导出状态==快照状态）planned stateCode === desiredStateCode */
  readonly liveMatched: number
  readonly drifted: readonly ExpectationDrift[]
  readonly failures: readonly { readonly kind: string; readonly issue: string | null; readonly detail: string }[]
}

export function loadExpectations(expectationsPath: string): Expectations {
  let text: string
  try {
    text = readFileSync(expectationsPath, 'utf8')
  } catch (cause) {
    throw new UsageError(`expectations 不可读：${expectationsPath}（${String(cause)}）`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new UsageError(`${expectationsPath}: JSON 解析失败（${String(cause)}）`)
  }
  const r = asRecord(parsed, 'expectations')
  const schema = asString(r['schema'], 'expectations.schema')
  if (schema !== PHASE0_DIFF_SCHEMA) throw new UsageError(`expectations.schema：期望 ${PHASE0_DIFF_SCHEMA}，实为 ${schema}`)
  const mapping = asArray(r['mapping'], 'expectations.mapping').map((row, i): ExpectationRow => {
    const rec = asRecord(row, `expectations.mapping[${String(i)}]`)
    return {
      externalRef: asString(rec['externalRef'], `expectations.mapping[${String(i)}].externalRef`),
      originalState: asString(rec['originalState'], `expectations.mapping[${String(i)}].originalState`),
      desiredStateCode: asNumber(rec['desiredStateCode'], `expectations.mapping[${String(i)}].desiredStateCode`),
      importedStateCode: asNumber(rec['importedStateCode'], `expectations.mapping[${String(i)}].importedStateCode`),
      stateMatched: rec['stateMatched'] === true,
    }
  })
  if (mapping.length === 0) throw new UsageError('expectations.mapping：不能为空')
  return {
    schema,
    selected: asNumber(r['selected'], 'expectations.selected'),
    stateMatched: asNumber(r['stateMatched'], 'expectations.stateMatched'),
    stateExemptions: asNumber(r['stateExemptions'], 'expectations.stateExemptions'),
    idRoundtrip: r['idRoundtrip'] === true,
    mapping,
  }
}

export function checkExpectations(plan: ImportPlan, exp: Expectations, rows: readonly Phase0Row[], expectationsPath: string): ExpectationCheck {
  const failures: ExpectationCheck['failures'] = []
  const drifted: ExpectationDrift[] = []
  const byKey = new Map(plan.issues.map((entry) => [entry.target.ticket.key, entry]))
  const byRef = new Map(rows.map((row) => [row.issue, row]))
  let snapshotReproduced = 0
  let liveRows = 0
  let liveMatched = 0

  for (const m of exp.mapping) {
    const entry = byKey.get(m.externalRef)
    if (entry === undefined) {
      failures.push({ kind: 'expectation:missing-plan-row', issue: m.externalRef, detail: `期望表行 ${m.externalRef} 在计划中无对应条目（key 应=externalRef）` })
      continue
    }
    // 1) 快照独立重现：冻结 STATE_MAP 对 Phase0 记录的 originalState 必须给出与 desiredStateCode 相同的码
    const snapshotRow = STATE_MAP.find((row) => row.from === m.originalState)
    if (snapshotRow === undefined) failures.push({ kind: 'expectation:snapshot-unmapped', issue: m.externalRef, detail: `originalState "${m.originalState}" 不在 STATE_MAP（Phase0 快照态必须可映射）` })
    else if (snapshotRow.to !== m.desiredStateCode) failures.push({ kind: 'expectation:state-map-drift', issue: m.externalRef, detail: `STATE_MAP["${m.originalState}"]=${String(snapshotRow.to)} ≠ Phase0 desiredStateCode=${String(m.desiredStateCode)}（冻结映射表与 Phase0 真值漂移，停手改表走提案流）` })
    else snapshotReproduced += 1
    if (!m.stateMatched || m.importedStateCode !== m.desiredStateCode) {
      failures.push({ kind: 'expectation:phase0-not-matched', issue: m.externalRef, detail: `Phase0 自身记录未对齐（stateMatched=${String(m.stateMatched)} imported=${String(m.importedStateCode)} desired=${String(m.desiredStateCode)}）` })
    }

    // 2) 活行对账：导出当前状态 vs Phase0 快照
    const row = byRef.get(m.externalRef)
    if (row === undefined) {
      failures.push({ kind: 'expectation:missing-export-row', issue: m.externalRef, detail: `期望表行 ${m.externalRef} 在当前导出中无对应记录（导出集变化，需重选样本）` })
      continue
    }
    if (row.state === m.originalState) {
      liveRows += 1
      if (entry.target.ticket.stateCode !== m.desiredStateCode) {
        failures.push({ kind: 'expectation:live-state-mismatch', issue: m.externalRef, detail: `计划 stateCode=${String(entry.target.ticket.stateCode)} ≠ 期望 desiredStateCode=${String(m.desiredStateCode)}（源态="${row.state}"）` })
      } else liveMatched += 1
    } else {
      // 3) 漂移：导出晚于 Phase0 快照（单子在台账继续流转）——显式列出待制作人豁免，不算对账失败也不静默
      drifted.push({
        issue: m.externalRef,
        snapshotState: m.originalState,
        currentState: row.state,
        snapshotDesiredCode: m.desiredStateCode,
        plannedCode: entry.target.ticket.stateCode,
        plannedName: entry.target.ticket.stateName,
        note: `导出状态 "${row.state}" 晚于 Phase0 快照 "${m.originalState}"（单据已继续流转）；按当前导出映射=${String(entry.target.ticket.stateCode)}，快照期望=${String(m.desiredStateCode)}；真迁前逐项豁免签认`,
      })
    }
  }
  return { path: expectationsPath, snapshotRows: exp.mapping.length, snapshotReproduced, liveRows, liveMatched, drifted, failures }
}

/* ------------------------------------------------------------------ */
/* 临时 SQLite 导入（vendor DDL 原样建表，CHECK/STRICT 全量生效）        */
/* ------------------------------------------------------------------ */

export interface TableCounts {
  readonly principals: number
  readonly projects: number
  readonly memberships: number
  readonly tickets: number
  readonly ticketLabels: number
  readonly comments: number
  readonly events: number
}

export interface VendorChecks {
  readonly titleLength: { readonly min: number; readonly max: number; readonly pass: boolean }
  readonly priorityRequiresHuman: { readonly violating: number; readonly pass: boolean }
  readonly parentDepth: { readonly max: number; readonly limit: number; readonly pass: boolean }
  readonly commentBodyBytes: { readonly min: number; readonly max: number; readonly pass: boolean }
}

export interface ImportOutcome {
  readonly dbPath: string
  readonly dbHash: string
  readonly tableCounts: TableCounts
  readonly vendorChecks: VendorChecks
  /** 目标库回读构造的「观测计划」——交给 workbench-issues-diff 对账 */
  readonly projection: ImportPlan
}

export const IMPORTER_PRINCIPAL_ID = 'prin:migrate-importer'
const principalIdOf = (username: string): string => `prin:${username}`
const usernameOfPrincipalId = (id: string): string => (id.startsWith('prin:') ? id.slice('prin:'.length) : id)
const ticketIdOf = (nk: string): string => `tkt_${sha256Hex(nk).slice(0, 32)}`
const commentIdOf = (nk: string, commentId: string): string => `cmt:${nk}:${commentId}`

const HASH_TABLES: readonly { readonly table: string; readonly order: string }[] = [
  { table: 'principals', order: 'id' },
  { table: 'projects', order: 'id' },
  { table: 'memberships', order: 'project_id, principal_id, role' },
  { table: 'tickets', order: 'id' },
  { table: 'ticket_labels', order: 'ticket_id, label' },
  { table: 'gate_runs', order: 'id' },
  { table: 'evidence', order: 'id' },
  { table: 'comments', order: 'seq' },
  { table: 'events', order: 'seq' },
  { table: 'outbox', order: 'seq' },
  { table: 'command_log', order: 'principal_id, command, idempotency_key' },
]

/** 内容 hash：逻辑行集（排序后 canonical JSON）的 sha256——不看 SQLite 文件字节，两次全新建库可比 */
export function contentHashOfDb(db: DatabaseSync): string {
  const tables: Record<string, unknown[]> = {}
  for (const { table, order } of HASH_TABLES) {
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all() as unknown[]
    tables[table] = [...rows].sort((a, b) => (canonicalJson(a) < canonicalJson(b) ? -1 : 1))
  }
  return sha256Of({ schemaVersion: SCHEMA_VERSION, tables })
}

/** 建库（vendor SCHEMA_SQL 原样 + PRAGMA 同 vendor sqlite-store 口径）并做空库守卫（防重复导入） */
export function createRehearsalDb(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec(SCHEMA_SQL)
  db.exec(`PRAGMA user_version = ${String(SCHEMA_VERSION)}`)
  const existing = db.prepare('SELECT COUNT(*) AS n FROM tickets').get() as { n: number }
  if (existing.n > 0) {
    db.close()
    throw new UsageError(`目标库已有 ${String(existing.n)} 行 tickets：演练库必须全新（幂等=同输入两次全新库产物 hash 一致，而非重复塞入）`)
  }
  return db
}

/** 计划 → 目标库行（deterministic id：tkt_/cmt:/prin: 派生自自然键与源评论 id；时间戳全取自源） */
export function importPlanToDb(db: DatabaseSync, plan: ImportPlan, fixture: TaigaExportFixture): void {
  const anchor = fixture.issues.reduce((min, issue) => Math.min(min, issue.createdAt), Number.MAX_SAFE_INTEGER)
  const insertPrincipal = db.prepare('INSERT INTO principals (id, kind, display_name, status, created_at) VALUES (?, ?, ?, ?, ?)')
  insertPrincipal.run(IMPORTER_PRINCIPAL_ID, 'daemon', 'issues-migrate importer（127-B 演练）', 'active', anchor)
  for (const p of plan.principals) insertPrincipal.run(principalIdOf(p.username), p.kind, p.displayName, 'active', anchor)

  const insertProject = db.prepare('INSERT INTO projects (id, key_prefix, name, next_ticket_seq, policy_json, policy_generation, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
  const maxSeq = new Map<string, number>()
  for (const issue of fixture.issues) maxSeq.set(issue.project, Math.max(maxSeq.get(issue.project) ?? 0, issue.id))
  for (const project of fixture.projects) {
    insertProject.run(`proj:${project.slug}`, project.keyPrefix, project.name, (maxSeq.get(project.slug) ?? 0) + 1, '{}', 1, anchor)
  }

  // plan.issues 已拓扑序（父先于子，127-A 保证）——parent_id 边插边解析
  const idByKey = new Map<string, string>()
  const insertTicket = db.prepare(`INSERT INTO tickets (
    id, project_id, key, title, body, kind, priority, state_code, assignee_id, requires_human, parent_id,
    created_by, revision, block_reason, resume_state_code, policy_generation, created_at, updated_at, last_activity_at, done_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const insertLabel = db.prepare('INSERT INTO ticket_labels (ticket_id, label) VALUES (?, ?)')
  for (const entry of plan.issues) {
    const t = entry.target.ticket
    const id = ticketIdOf(entry.naturalKey)
    // vendor CHECK(state_code<>7 OR (block_reason AND resume_state_code))：legacy 打回态补确定性占位（真数据无此态）
    const blocked = t.stateCode === 7
    insertTicket.run(
      id, `proj:${t.key.slice(0, t.key.lastIndexOf('-'))}`, t.key, t.title, t.body, t.kind, t.priority, t.stateCode,
      t.assignee !== null ? principalIdOf(t.assignee) : null,
      t.requiresHuman ? 1 : 0,
      t.parentKey !== null ? (idByKey.get(t.parentKey) ?? null) : null,
      IMPORTER_PRINCIPAL_ID, 1,
      blocked ? '(migrated) legacy 打回（源无 reason/resume，占位保约束）' : null,
      blocked ? 3 : null,
      1, t.createdAt, t.updatedAt, t.updatedAt, t.doneAt,
    )
    idByKey.set(t.key, id)
    for (const label of t.labels) insertLabel.run(id, label)
  }

  // 评论两遍插入：先锚点后回复（reply_to_comment_id 解析）；序=计划规范序（createdAt,id）
  const insertComment = db.prepare('INSERT INTO comments (id, ticket_id, author_id, body, reply_to_comment_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
  const passes = [false, true]
  for (const wantReply of passes) {
    for (const entry of plan.issues) {
      for (const c of entry.target.comments) {
        if ((c.replyToCommentId !== null) !== wantReply) continue
        const replyId = c.replyToCommentId !== null ? commentIdOf(entry.naturalKey, c.replyToCommentId) : null
        insertComment.run(commentIdOf(entry.naturalKey, c.id), ticketIdOf(entry.naturalKey), principalIdOf(c.author), c.body, replyId, c.createdAt)
      }
    }
  }
}

/** 目标库回读 → 「观测计划」（ImportPlan 形态；可回放字段全部取自库，无法回放的元数据显式从计划拷贝并注明） */
export function readBackProjection(db: DatabaseSync, plan: ImportPlan): { projection: ImportPlan; tableCounts: TableCounts; vendorChecks: VendorChecks } {
  const countOf = (table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
  const stateNameOf = (code: number): string => STATE_CATALOG.find((s) => s.code === code)?.name ?? `UNKNOWN(${String(code)})`
  const usernameOf = (principalId: string | null): string | null => (principalId === null ? null : usernameOfPrincipalId(principalId))

  const tickets = db.prepare('SELECT id, project_id, key, title, body, kind, priority, state_code, assignee_id, requires_human, parent_id, created_at, updated_at, done_at FROM tickets').all() as Record<string, unknown>[]
  const keyOfId = new Map(tickets.map((t) => [String(t['id']), String(t['key'])]))
  const labelsOf = new Map<string, string[]>()
  for (const row of db.prepare('SELECT ticket_id, label FROM ticket_labels').all() as Record<string, unknown>[]) {
    const ticketId = String(row['ticket_id'])
    labelsOf.set(ticketId, [...(labelsOf.get(ticketId) ?? []), String(row['label'])])
  }
  const commentRows = db.prepare('SELECT id, ticket_id, author_id, body, reply_to_comment_id, created_at FROM comments ORDER BY seq').all() as Record<string, unknown>[]
  const nkOfCommentId = new Map(commentRows.map((c) => [String(c['id']), String(keyOfId.get(String(c['ticket_id'])))]))
  const sourceHashByNk = new Map(plan.issues.map((entry) => [entry.naturalKey, entry.sourceHash]))

  const issues: PlannedIssue[] = tickets.map((t) => {
    const ticketId = String(t['id'])
    const key = String(t['key'])
    // ID roundtrip 反解：key=<keyPrefix>-<ref>，keyPrefix=项目 slug（runbook §五.2）
    const dash = key.lastIndexOf('-')
    const project = dash > 0 ? key.slice(0, dash) : ''
    const ref = dash > 0 ? Number(key.slice(dash + 1)) : Number.NaN
    const nk = `${project}#${String(ref)}`
    const labels = (labelsOf.get(ticketId) ?? []).sort()
    const legacy = labels.find((l) => l.startsWith('legacy-state-'))?.slice('legacy-state-'.length) ?? ''
    const comments = commentRows
      .filter((c) => String(c['ticket_id']) === ticketId)
      .map((c) => {
        const cid = String(c['id'])
        const cnk = nkOfCommentId.get(cid) ?? ''
        const replyFull = c['reply_to_comment_id'] === null ? null : String(c['reply_to_comment_id'])
        const replyNk = replyFull !== null ? (nkOfCommentId.get(replyFull) ?? '') : ''
        return {
          id: cnk !== '' && cid.startsWith(`cmt:${cnk}:`) ? cid.slice(`cmt:${cnk}:`.length) : cid,
          author: usernameOf(c['author_id'] === null ? null : String(c['author_id'])) ?? '',
          body: String(c['body']),
          replyToCommentId: replyFull !== null && replyNk !== '' && replyFull.startsWith(`cmt:${replyNk}:`) ? replyFull.slice(`cmt:${replyNk}:`.length) : replyFull,
          createdAt: Number(c['created_at']),
        }
      })
    return {
      naturalKey: nk,
      sourceRef: { project, id: ref, status: legacy },
      idempotencyKey: `issue-migrate:${nk}`,
      sourceHash: sourceHashByNk.get(nk) ?? '',
      statusMapped: true,
      target: {
        ticket: {
          key,
          title: String(t['title']),
          body: String(t['body']),
          kind: String(t['kind']) as 'task' | 'bug' | 'chore',
          priority: Number(t['priority']),
          stateCode: Number(t['state_code']),
          stateName: stateNameOf(Number(t['state_code'])),
          requiresHuman: Number(t['requires_human']) === 1,
          assignee: usernameOf(t['assignee_id'] === null ? null : String(t['assignee_id'])),
          parentKey: t['parent_id'] === null ? null : (keyOfId.get(String(t['parent_id'])) ?? null),
          labels,
          createdAt: Number(t['created_at']),
          updatedAt: Number(t['updated_at']),
          doneAt: t['done_at'] === null ? null : Number(t['done_at']),
        },
        comments,
      },
    }
  }).sort((a, b) => (a.naturalKey < b.naturalKey ? -1 : 1))

  const principals = (db.prepare('SELECT id, kind, display_name FROM principals WHERE id <> ? ORDER BY id').all(IMPORTER_PRINCIPAL_ID) as Record<string, unknown>[])
    .map((p) => ({ username: usernameOfPrincipalId(String(p['id'])), kind: String(p['kind']) as 'human' | 'agent', displayName: String(p['display_name']) }))

  const parentsLinked = issues.filter((entry) => entry.target.ticket.parentKey !== null).length
  const plannedComments = issues.reduce((sum, entry) => sum + entry.target.comments.length, 0)
  // 元数据拷贝（非库可观测）：mapping=冻结表；statusMapped/Unmapped 计数；dedup 审计——diff 不以它们断言，仅入自 hash 载荷
  const base: ImportPlan = {
    schema: PLAN_SCHEMA,
    meta: { ...plan.meta, planHash: '' },
    mapping: plan.mapping,
    principals,
    counts: {
      plannedIssues: issues.length,
      plannedComments,
      parentsLinked,
      statusMapped: plan.counts.statusMapped,
      statusUnmapped: plan.counts.statusUnmapped,
    },
    gaps: [],
    issues,
    dedup: plan.dedup,
  }
  const projection: ImportPlan = { ...base, meta: { ...base.meta, planHash: planHashOf(base) } }

  // vendor 约束复核（读库断言，非计划侧自证）
  const titleLengths = issues.map((entry) => entry.target.ticket.title.length)
  const violating = issues.filter((entry) => entry.target.ticket.priority <= 1 && !entry.target.ticket.requiresHuman).length
  const parentOfId = new Map(tickets.map((t) => [String(t['id']), t['parent_id'] === null ? null : String(t['parent_id'])]))
  let maxDepth = 0
  for (const id of parentOfId.keys()) {
    let depth = 0
    let cursor: string | null = id
    const seen = new Set<string>()
    while (cursor !== null && parentOfId.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor)
      depth += 1
      cursor = parentOfId.get(cursor) ?? null
    }
    maxDepth = Math.max(maxDepth, depth)
  }
  const bodyLengths = commentRows.map((c) => String(c['body']).length)
  const tableCounts: TableCounts = {
    principals: countOf('principals'),
    projects: countOf('projects'),
    memberships: countOf('memberships'),
    tickets: countOf('tickets'),
    ticketLabels: countOf('ticket_labels'),
    comments: countOf('comments'),
    events: countOf('events'),
  }
  const vendorChecks: VendorChecks = {
    titleLength: { min: Math.min(...titleLengths), max: Math.max(...titleLengths), pass: titleLengths.every((n) => n >= 1 && n <= 512) },
    priorityRequiresHuman: { violating, pass: violating === 0 },
    parentDepth: { max: maxDepth, limit: MAX_PARENT_DEPTH, pass: maxDepth <= MAX_PARENT_DEPTH },
    commentBodyBytes: {
      min: bodyLengths.length === 0 ? 0 : Math.min(...bodyLengths),
      max: bodyLengths.length === 0 ? 0 : Math.max(...bodyLengths),
      pass: bodyLengths.every((n) => n >= 1 && n <= 16384),
    },
  }
  return { projection, tableCounts, vendorChecks }
}

/** 一步到位：建库→导入→回读→hash（调用方负责删库；dbPath 由调用方给定保证确定性） */
export function rehearseImport(plan: ImportPlan, fixture: TaigaExportFixture, dbPath: string): ImportOutcome {
  const db = createRehearsalDb(dbPath)
  try {
    importPlanToDb(db, plan, fixture)
    const { projection, tableCounts, vendorChecks } = readBackProjection(db, plan)
    const dbHash = contentHashOfDb(db)
    return { dbPath, dbHash, tableCounts, vendorChecks, projection }
  } finally {
    db.close()
  }
}

/* ------------------------------------------------------------------ */
/* 演练编排                                                             */
/* ------------------------------------------------------------------ */

export interface RehearseOptions {
  readonly exportPath?: string
  readonly expectationsPath?: string | null
  readonly dryRun?: boolean
  readonly keepDb?: boolean
  readonly dbPath?: string
  readonly outPath?: string
}

export interface RehearseReport {
  readonly schema: string
  readonly ok: boolean
  readonly dryRun: boolean
  readonly export: { readonly path: string; readonly schema: string; readonly rows: number; readonly rowsDropped: number }
  readonly plan: {
    readonly planHash: string
    readonly counts: ImportPlan['counts']
    readonly gapCount: number
    readonly gaps: ImportPlan['gaps']
    readonly blockingGaps: ImportPlan['gaps']
    readonly targetRowCounts: { readonly tickets: number; readonly labels: number; readonly comments: number }
  }
  readonly import:
    | { readonly skipped: string }
    | { readonly dbPath: string; readonly dbHash: string; readonly tableCounts: TableCounts; readonly vendorChecks: VendorChecks; readonly vendorSnapshot: string; readonly cleaned: boolean }
  readonly diff: DiffReport | null
  readonly expectations: (ExpectationCheck & { readonly selected?: number; readonly phase0StateMatched?: number; readonly idRoundtrip?: boolean }) | null
  readonly notes: readonly string[]
}

function targetRowCountsOf(plan: ImportPlan): { tickets: number; labels: number; comments: number } {
  return {
    tickets: plan.issues.length,
    labels: plan.issues.reduce((sum, entry) => sum + entry.target.ticket.labels.length, 0),
    comments: plan.issues.reduce((sum, entry) => sum + entry.target.comments.length, 0),
  }
}

export function runRehearsal(options: RehearseOptions = {}): { code: number; report: RehearseReport; stdout: string } {
  const exportPath = options.exportPath ?? DEFAULT_EXPORT
  const expectationsPath = options.expectationsPath === undefined ? DEFAULT_EXPECTATIONS : options.expectationsPath

  const phase0 = loadPhase0Export(exportPath)
  const source = adaptPhase0Export(phase0)
  const plan = buildPlan(source.fixture)
  const blockingGaps = plan.gaps.filter((gap) => VENDOR_BLOCKING_GAP_KINDS.includes(gap.kind))
  const notes = [...source.notes]

  const dryRun = options.dryRun === true
  let importSection: RehearseReport['import']
  let diff: DiffReport | null = null
  let tempDir: string | null = null
  let dbPath = options.dbPath ?? null

  if (dryRun) {
    importSection = { skipped: 'dry-run：不建库（只打印计划/目标行计数）' }
  } else if (blockingGaps.length > 0) {
    // fail-closed：vendor CHECK 会拒行的 gap（空/超长评论 body、超深父链）不建库，直接显式失败
    importSection = { skipped: `vendor-blocking gaps ${blockingGaps.map((g) => g.kind).join(',')}：不建库（显式失败，不降级硬塞）` }
    diff = diffPlanAgainstSource(source.fixture, plan)
  } else {
    // 临时库只在真正导入时才创建（dry-run/失败路径连临时目录都不产生）
    if (dbPath === null) {
      tempDir = mkdtempSync(path.join(tmpdir(), 'sn-issues-rehearse-'))
      dbPath = path.join(tempDir, 'issues-rehearse.db')
    }
    const cleaned = tempDir !== null && options.keepDb !== true
    try {
      const outcome = rehearseImport(plan, source.fixture, dbPath)
      diff = diffPlanAgainstSource(source.fixture, outcome.projection)
      importSection = {
        // 清理后的临时库路径含随机 mkdtemp 名且已删除——记稳定标记，保证同输入两次 --out 字节一致（幂等证据）
        dbPath: cleaned ? '(os.tmpdir 自动临时库，跑完已清理)' : outcome.dbPath,
        dbHash: outcome.dbHash,
        tableCounts: outcome.tableCounts,
        vendorChecks: outcome.vendorChecks,
        vendorSnapshot: VENDOR_SNAPSHOT,
        cleaned,
      }
      if (!outcome.vendorChecks.titleLength.pass || !outcome.vendorChecks.priorityRequiresHuman.pass || !outcome.vendorChecks.parentDepth.pass || !outcome.vendorChecks.commentBodyBytes.pass) {
        notes.push('vendor 约束复核未全过（见 import.vendorChecks）')
      }
    } finally {
      if (cleaned) rmSync(tempDir as string, { recursive: true, force: true })
    }
  }

  let expectations: RehearseReport['expectations'] = null
  if (expectationsPath !== null && !dryRun) {
    const exp = loadExpectations(expectationsPath)
    const check = checkExpectations(plan, exp, source.rowsKept, expectationsPath)
    expectations = { ...check, selected: exp.selected, phase0StateMatched: exp.stateMatched, idRoundtrip: exp.idRoundtrip }
  }

  const ok = dryRun
    ? true // dry-run 本身成功即 ok（信息面：计划/目标行计数已打印，未建库）
    : diff !== null && diff.ok
      && !('skipped' in importSection)
      && (expectations === null || (expectations.failures.length === 0 && expectations.snapshotReproduced === expectations.snapshotRows))

  const report: RehearseReport = {
    schema: REHEARSE_SCHEMA,
    ok,
    dryRun,
    export: { path: exportPath, schema: phase0.schema, rows: source.rowsKept.length, rowsDropped: source.rowsDropped },
    plan: {
      planHash: plan.meta.planHash,
      counts: plan.counts,
      gapCount: plan.gaps.length,
      gaps: plan.gaps,
      blockingGaps,
      targetRowCounts: targetRowCountsOf(plan),
    },
    import: importSection,
    diff,
    expectations,
    notes,
  }

  const summary = {
    ok: report.ok,
    dryRun,
    export: report.export.path,
    rows: report.export.rows,
    planHash: report.plan.planHash,
    counts: report.plan.counts,
    targetRowCounts: report.plan.targetRowCounts,
    gapCount: report.plan.gapCount,
    blockingGapCount: blockingGaps.length,
    diffOk: diff?.ok ?? null,
    expectations: expectations === null ? null : {
      snapshotReproduced: `${String(expectations.snapshotReproduced)}/${String(expectations.snapshotRows)}`,
      liveMatched: `${String(expectations.liveMatched)}/${String(expectations.liveRows)}`,
      drifted: expectations.drifted.length,
      failures: expectations.failures.length,
    },
    dbHash: 'dbHash' in importSection ? importSection.dbHash : null,
    dbCleaned: 'cleaned' in importSection ? importSection.cleaned : null,
  }
  // dry-run 与 127-A 同语义：只打印单行摘要（计划/目标行计数），不写任何文件（--out 被忽略）
  if (dryRun) return { code: 0, report, stdout: `${JSON.stringify(summary)}\n` }
  if (options.outPath !== undefined) {
    mkdirSync(path.dirname(options.outPath), { recursive: true })
    writeFileSync(options.outPath, `${JSON.stringify(report, null, 2)}\n`)
    return { code: ok ? 0 : 1, report, stdout: `${JSON.stringify({ ...summary, out: options.outPath })}\n` }
  }
  return { code: ok ? 0 : 1, report, stdout: `${JSON.stringify(report, null, 2)}\n` }
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

const USAGE = '用法：node scripts/workbench-issues-rehearse.ts [--export <ticket-export.json>] [--expectations <ticket-diff.json>] [--skip-expectations] [--dry-run] [--db <path>] [--keep-db] [--out <report.json>]'

function isDirectRun(): boolean {
  const argv1 = process.argv[1]
  if (argv1 === undefined) return false
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

export function rehearseCli(argv: readonly string[]): { code: number; stdout: string } {
  const args = [...argv]
  const valueOf = (name: string): string | undefined => {
    const i = args.indexOf(name)
    if (i < 0) return undefined
    const value = args[i + 1]
    if (value === undefined) throw new UsageError(`${name} 缺参数；${USAGE}`)
    args.splice(i, 2)
    return value
  }
  const exportPath = valueOf('--export')
  const expectationsPath = valueOf('--expectations')
  const dbPath = valueOf('--db')
  const outPath = valueOf('--out')
  const skipIndex = args.indexOf('--skip-expectations')
  const skip = skipIndex >= 0
  if (skip) args.splice(skipIndex, 1)
  const dryIndex = args.indexOf('--dry-run')
  const dryRun = dryIndex >= 0
  if (dryRun) args.splice(dryIndex, 1)
  const keepIndex = args.indexOf('--keep-db')
  const keepDb = keepIndex >= 0
  if (keepDb) args.splice(keepIndex, 1)
  if (args.some((a) => a === '--help' || a === '-h')) return { code: 0, stdout: `${USAGE}\n` }
  if (args.length > 0) throw new UsageError(`未知参数：${args.join(' ')}；${USAGE}`)

  const { code, stdout } = runRehearsal({
    ...(exportPath !== undefined ? { exportPath } : {}),
    expectationsPath: skip ? null : expectationsPath,
    dryRun,
    keepDb,
    ...(dbPath !== undefined ? { dbPath } : {}),
    ...(outPath !== undefined ? { outPath } : {}),
  })
  return { code, stdout }
}

if (isDirectRun()) {
  try {
    const { code, stdout } = rehearseCli(process.argv.slice(2))
    process.stdout.write(stdout)
    process.exit(code)
  } catch (cause) {
    if (cause instanceof UsageError) {
      console.error(`[workbench-issues-rehearse] ${cause.message}`)
      process.exit(2)
    }
    throw cause
  }
}
