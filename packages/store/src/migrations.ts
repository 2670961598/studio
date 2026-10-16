/**
 * migrations —— 薄 migration runner（schema_version 表 + 手写顺序 SQL）
 *
 * 选型依据：docs/16-§二（node:sqlite + migration）、docs/17-§3（schema_version 表：
 * version / applied_at / sha8 三列）。drizzle 探测结论见 driver.ts 头注——稳定线无
 * node:sqlite 驱动，故 migration 走「schema_version 表 + 手写顺序 SQL」薄法（任务预案允许）。
 *
 * 语义（幂等三保证）：
 *   1. 逐版本顺序应用：MIGRATIONS 按 version 升序排列，migrate() 只补未应用的版本；
 *   2. 每版本一个事务：该版本全部 SQL 同生共死（半途失败整体回滚，不留半截 schema）；
 *   3. sha8 防漂移：应用时记 sha256(SQL) 前 8 hex；重开库时已记录版本 sha8 与内置脚本
 *      不一致 → CONFIG_INVALID（schema_version 是内置脚本的投影，漂移即篡改/降级混用）。
 */
import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { configInvalid } from '@studio-next/contract'

/** 一条迁移：version 单调 +1 起；name 仅为人读；sql 为该版本的完整顺序 SQL */
export interface Migration {
  version: number
  name: string
  sql: string
}

/**
 * v1：v0.2 首刀三表（docs/16-§四 v0.2 / 17-§3 数据模型）
 *
 *   - events：逐列对齐 contract EventRecordSchema 字段名（id/ts/company/issue/event/actor/
 *     attempt/level/dept/correlation_id/causation_id/tokens/cost_usd/duration_ms/size/
 *     payload_hash/note）；tokens 存四桶 JSON 文本（F2-04 冻结列名，写入前经契约校验，
 *     appendEvent 内做 canonical 序列化——固定桶序，JSONL 派生可哈希比对，F2-11）。
 *   - work_records / sessions：按 17-§3 行条目落列。拟稿待批（docs 未细化处）：
 *     「工号」列名 person_id；「started/ended」列名 started_at/ended_at（epoch ms，
 *     ended 可空=在途）；cost 列名 cost_usd（对齐 events）；tokens 形状取 kernel.TokenCounts
 *     （收割归一化口径，与 events 四桶不同源）。
 *   - 索引（任务口径）：events(company, ts)、events(issue)、work_records(issue)。
 *   - 17-§3 其余十表（people/personnel_events/departments/ticket_mirror/ledgers/
 *     candidates/budgets/reports/probes_runs）不落本刀，进 index.ts TODO。
 */
const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'v0.2 首刀三表：events / work_records / sessions',
    sql: [
      'CREATE TABLE events (',
      '  id TEXT PRIMARY KEY,',
      '  ts INTEGER NOT NULL,',
      '  company TEXT NOT NULL,',
      '  issue TEXT NOT NULL,',
      '  event TEXT NOT NULL,',
      '  actor TEXT NOT NULL,',
      '  attempt INTEGER NOT NULL,',
      '  level INTEGER NOT NULL,',
      '  dept TEXT NOT NULL,',
      '  correlation_id TEXT,',
      '  causation_id TEXT,',
      '  tokens TEXT NOT NULL,',
      '  cost_usd REAL,',
      '  duration_ms INTEGER,',
      '  size INTEGER,',
      '  payload_hash TEXT,',
      '  note TEXT',
      ');',
      'CREATE INDEX idx_events_company_ts ON events (company, ts);',
      'CREATE INDEX idx_events_issue ON events (issue);',
      '',
      'CREATE TABLE work_records (',
      '  id TEXT PRIMARY KEY,',
      '  issue TEXT NOT NULL,',
      '  person_id TEXT NOT NULL,',
      '  instance_id TEXT,',
      '  executor TEXT NOT NULL,',
      '  session_id TEXT,',
      '  lane TEXT,',
      '  branch TEXT,',
      '  started_at INTEGER NOT NULL,',
      '  ended_at INTEGER,',
      '  cost_usd REAL,',
      '  tokens TEXT,',
      '  attempt INTEGER NOT NULL,',
      '  status TEXT NOT NULL,',
      '  report_ref TEXT,',
      '  summary_ref TEXT',
      ');',
      'CREATE INDEX idx_work_records_issue ON work_records (issue);',
      '',
      'CREATE TABLE sessions (',
      '  session_id TEXT PRIMARY KEY,',
      '  issue TEXT NOT NULL,',
      '  person_id TEXT NOT NULL,',
      '  archive_path TEXT,',
      '  started_at INTEGER NOT NULL,',
      '  ended_at INTEGER,',
      '  turns INTEGER',
      ');',
      '',
    ].join('\n'),
  },
  {
    version: 2,
    name: 'v0.2 第二刀五表：people / personnel_events / departments / ticket_mirror / budgets',
    sql: [
      // people：公司目录镜像（权威源=公司目录，17-§3）。people/<工号>.md front-matter 的索引化：
      //   role=岗位；skills / side_effects 存 JSON 字符串数组文本；capability_tier=能力档 0-3
      //   （V4-V7-§4.2/§14，值域拟稿见 records.ts）；executor_pref=executor 偏好（缺省继承框架默认）；
      //   status=active|paused|retired（模板口径，v0 不锁枚举）。
      //   注：17-§3/任务口径均未给 people 立 company 列——工号全局唯一是前提（疑点已上报 index.ts TODO）。
      'CREATE TABLE people (',
      '  person_id TEXT PRIMARY KEY,',
      '  name TEXT NOT NULL,',
      '  login TEXT NOT NULL,',
      '  level INTEGER NOT NULL,',
      '  dept TEXT NOT NULL,',
      '  role TEXT,',
      '  skills TEXT,',
      '  side_effects TEXT,',
      '  capability_tier INTEGER,',
      '  executor_pref TEXT,',
      '  status TEXT',
      ');',
      '',
      // personnel_events：本库 append-only（17-§3「权威源」列）。type=入/调/升/降/停/复/退（值域
      //   v0 不锁，contract 冻结时收口）；prev/next=前值/新值（标量文本，复合变动拆条——拟稿）；
      //   ticket/approver NOT NULL——F2-06「必挂单」、C1-06「无单号拒绝」的机制化落点（列级约束兜底）。
      //   append-only 用 BEFORE UPDATE/DELETE 触发器机制保证（AGENTS.md 纪律 4「机制保证，不是自律」）：
      //   行级触发器拦 UPDATE/DELETE（含未来新写面与手工 sqlite3 误改）；DROP TABLE 不受行级触发器
      //   拦截——删库重建本身是合法演习路径（F2-12），无需拦。v1 events 表无触发器（sha8 已锁，
      //   只增不改），差异记录在 index.ts TODO。
      'CREATE TABLE personnel_events (',
      '  id TEXT PRIMARY KEY,',
      '  ts INTEGER NOT NULL,',
      '  person_id TEXT NOT NULL,',
      '  type TEXT NOT NULL,',
      '  prev TEXT,',
      '  next TEXT,',
      '  ticket TEXT NOT NULL,',
      '  approver TEXT NOT NULL',
      ');',
      "CREATE TRIGGER trg_personnel_events_no_update BEFORE UPDATE ON personnel_events BEGIN",
      "  SELECT RAISE(ABORT, 'personnel_events 为 append-only（17-§3）：UPDATE 被拒');",
      'END;',
      "CREATE TRIGGER trg_personnel_events_no_delete BEFORE DELETE ON personnel_events BEGIN",
      "  SELECT RAISE(ABORT, 'personnel_events 为 append-only（17-§3）：DELETE 被拒');",
      'END;',
      '',
      // departments：公司目录镜像（权威源=公司目录，17-§3）。functions/lanes 存 JSON 字符串数组文本
      //   （NOT NULL：可存空数组 []，不可缺）；parent_path=上级部门 path（根节点为 NULL）。
      //   注：DeptNode.name/level/relations 未列于 17-§3 列集，镜像不承载（疑点已上报 index.ts TODO）。
      'CREATE TABLE departments (',
      '  path TEXT PRIMARY KEY,',
      '  company TEXT NOT NULL,',
      '  leader TEXT NOT NULL,',
      '  functions TEXT NOT NULL,',
      '  lanes TEXT NOT NULL,',
      '  parent_path TEXT',
      ');',
      '',
      // ticket_mirror：YouTrack 镜像（权威源=YouTrack，17-§3）。parent=父单号（可空=无父单）；
      //   lane=泳道（可空=未定泳道）。镜像允许覆盖写（upsert），非 append-only。
      'CREATE TABLE ticket_mirror (',
      '  issue TEXT PRIMARY KEY,',
      '  company TEXT NOT NULL,',
      '  created INTEGER NOT NULL,',
      '  updated INTEGER NOT NULL,',
      '  state TEXT NOT NULL,',
      '  type TEXT NOT NULL,',
      '  dept TEXT NOT NULL,',
      '  level INTEGER NOT NULL,',
      '  dispatcher TEXT NOT NULL,',
      '  parent TEXT,',
      '  lane TEXT',
      ');',
      '',
      // budgets：本库权威（17-§3）。scope_kind=issue|person|company（scope_id 对应单号/工号/公司 slug）；
      //   kind=reserve|settle|refusal（F1-09 预算三节点：预留→结算→拒绝）；estimated/actual 可空
      //   （refusal 常只有 estimated，settle 前无 actual）。
      'CREATE TABLE budgets (',
      '  id TEXT PRIMARY KEY,',
      '  scope_kind TEXT NOT NULL,',
      '  scope_id TEXT NOT NULL,',
      '  kind TEXT NOT NULL,',
      '  estimated_usd REAL,',
      '  actual_usd REAL,',
      '  ts INTEGER NOT NULL',
      ');',
      'CREATE INDEX idx_budgets_scope ON budgets (scope_kind, scope_id);',
      '',
    ].join('\n'),
  },
]

/** 内置迁移的最高版本（0 = 无迁移可用，仅占位防呆） */
export const LATEST_VERSION: number = MIGRATIONS.length > 0 ? MIGRATIONS[MIGRATIONS.length - 1]!.version : 0

/** sha8：迁移 SQL 的 sha256 前 8 个 hex 字符（17-§3 schema_version.sha8 口径） */
function sha8(sql: string): string {
  return createHash('sha256').update(sql).digest('hex').slice(0, 8)
}

/**
 * 迁移应用：幂等（已应用版本跳过），逐版本单事务，sha8 漂移即 CONFIG_INVALID。
 * options.upTo：只应用到该版本为止（**测试构造历史版本库用**——升级路径演习的前提；
 * 生产调用不传）。越界（<1 或 >LATEST_VERSION）即 CONFIG_INVALID。
 */
export function migrate(db: DatabaseSync, options?: { upTo?: number }): number {
  const upTo = options?.upTo
  if (upTo !== undefined && (upTo < 1 || upTo > LATEST_VERSION)) {
    configInvalid('store/migration:bad-up-to', `upTo=${String(upTo)} 越界（1..${LATEST_VERSION}）`)
  }
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, sha8 TEXT NOT NULL)',
  )
  const applied = new Map<number, string>()
  for (const row of db.prepare('SELECT version, sha8 FROM schema_version').all() as Array<{ version: unknown; sha8: unknown }>) {
    applied.set(Number(row.version), String(row.sha8))
  }
  for (const m of MIGRATIONS) {
    if (upTo !== undefined && m.version > upTo) break
    const recorded = applied.get(m.version)
    if (recorded === undefined) {
      db.exec('BEGIN')
      try {
        db.exec(m.sql)
        db.prepare('INSERT INTO schema_version (version, applied_at, sha8) VALUES (?, ?, ?)').run(
          m.version,
          Date.now(),
          sha8(m.sql),
        )
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    } else if (recorded !== sha8(m.sql)) {
      // 防漂移：库内记录与内置脚本同版本不同内容（篡改 / 新旧代码混用）
      configInvalid(
        'store/migration:sha8-mismatch',
        `schema_version 记录的 v${m.version} sha8=${recorded} 与内置脚本 sha8=${sha8(m.sql)} 不一致`,
      )
    }
  }
  return currentVersion(db)
}

/** 当前已应用版本（0 = 尚无任何迁移记录） */
export function currentVersion(db: DatabaseSync): number {
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: unknown } | undefined
  if (row === undefined || row.v === null || row.v === undefined) return 0
  return Number(row.v)
}
