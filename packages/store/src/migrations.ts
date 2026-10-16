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
]

/** 内置迁移的最高版本（0 = 无迁移可用，仅占位防呆） */
export const LATEST_VERSION: number = MIGRATIONS.length > 0 ? MIGRATIONS[MIGRATIONS.length - 1]!.version : 0

/** sha8：迁移 SQL 的 sha256 前 8 个 hex 字符（17-§3 schema_version.sha8 口径） */
function sha8(sql: string): string {
  return createHash('sha256').update(sql).digest('hex').slice(0, 8)
}

/** 迁移应用：幂等（已应用版本跳过），逐版本单事务，sha8 漂移即 CONFIG_INVALID */
export function migrate(db: DatabaseSync): number {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, sha8 TEXT NOT NULL)',
  )
  const applied = new Map<number, string>()
  for (const row of db.prepare('SELECT version, sha8 FROM schema_version').all() as Array<{ version: unknown; sha8: unknown }>) {
    applied.set(Number(row.version), String(row.sha8))
  }
  for (const m of MIGRATIONS) {
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
