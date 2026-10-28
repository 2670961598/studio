/**
 * snapshot-drill —— MIG-04 / IMPL-04-05：快照/回滚演练＋环境记录
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - plan/05 IMPL-04-05（演练：快照→恢复→删库重建；验收：`test:v2 -- packages/store` 绿、
 *     演练可重跑且报告落盘、`node:sqlite` 版本与 `user_version` 记录在案）
 *   - docs/v2/16 §五 MIG-04 行（入口条件②「DB 快照/回滚演练完成」、③「`node:sqlite` 版本与
 *     `user_version` 记录（B9 起点 13）」；回滚列「快照＋不可逆迁移显式声明，**不承诺自动回滚**」）
 *   - docs/v2/16 §四（DOM-04 `cost_daily` 限域：只备份不重放；备份=**恢复**语义非重建语义；
 *     演练报告不得声称钱账已重建）、docs/v2/05 §三 DOM-04
 *   - plan/03 §五（MIG-04 入口条件 ②③）、plan/04 §二 MIG-04 门（①`test:v2 -- packages/store`）
 *   - docs/baselines/mig-04-drill.md（本文件的演练报告与证据落盘件）
 *
 * 演练链路（本文件即演练脚本；报告渲染见 renderDrillReport）：
 *   ① 临时库 `openLedger`（migrate → v15）→ 写 events 语料 + `cost_daily` 冻结样本；
 *   ② `backupCostDaily` → JSONL 快照件 + `<out>.sha256` 侧车（独立复算摘要）；
 *   ③ **人工显式恢复**：新库 migrate → 只把备份里的 `cost_daily` 行插回去（events 不随备份恢复）；
 *   ④ 删库三件套 + `rebuild`（重放范围只有 events）→ 重建库 `cost_daily` 恒 0 行（排除域不重放）；
 *   ⑤ 环境记录：`process.versions.node`／`process.versions.sqlite`、`SELECT sqlite_version()`、
 *      `PRAGMA user_version`、`schema_version` 全列（1..LATEST_VERSION）；
 *   ⑥ 可重跑：同输入第二次演练 → 快照件字节/摘要/恢复行集/报告行逐字节一致。
 *
 * 纪律：
 *   - **不新增生产 API**：恢复动作在本文件内以显式 SQL 完成——生产侧只有备份/读回/校验三面
 *     （`backup.ts`），恢复是人工显式动作，**不是**自动回滚路径（下游若加自动恢复口＝提案流）。
 *   - **两账不判等**：备份恢复值（`cost_daily`）与事件账投影值分列（GAP-V2-01 对账规则未决，
 *     本演练不作一致性结论，也不合并为单一总额——v2/16 §四）。
 *   - 临时目录真文件，**不碰真实台账库**、不读环境变量；id 确定性合成（fixtures）——同输入
 *     恒同字节，演练可重现。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { EventRecord } from '@studio-next/contract'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LATEST_VERSION, openLedger } from '../../src/index.ts'
import {
  COST_DAILY_BACKUP_COLUMNS,
  backupCostDaily,
  readCostDailyBackup,
  sha256Hex,
  verifyBackup,
  type CostDailyBackupResult,
  type CostDailyBackupRow,
} from '../../src/backup.ts'
import { rebuild } from '../../src/rebuild.ts'
import type { SqlRow } from '../../src/row-helpers.ts'
import * as backupFace from '../../src/backup.ts'
import { costRow, eventRecord, roundUsd, T0, ulid } from './fixtures.ts'

/** 演练语料冻结规模（断言锚点；改即演练版本换代，报告须同步） */
const DRILL_EVENTS = 4
const SEALED_ROWS = 3
const SEALED_USD = 0.7

// ---------------------------------------------------------------------------
// 演练语料（确定性合成：同参数恒同 ULID；金额/差值口径见 fixtures）
// ---------------------------------------------------------------------------

/** events 语料：覆盖普通事件、带相关 id、带 note、带 duration 四形（全列随 rebuild 往返） */
function drillEvents(): EventRecord[] {
  return [
    eventRecord({ id: ulid(T0, 1000), ts: T0, event: 'LLM', cost_usd: 0.01 }),
    eventRecord({ id: ulid(T0, 1001), ts: T0 + 1, event: 'GATE_PASS', cost_usd: 0.02, correlation_id: 'corr-drill' }),
    eventRecord({ id: ulid(T0, 1002), ts: T0 + 2, event: 'REPORT_DAILY', cost_usd: 0.03, note: '日报' }),
    eventRecord({ id: ulid(T0, 1003), ts: T0 + 3, event: 'CLOSE', duration_ms: 1234 }),
  ]
}

/**
 * `cost_daily` 冻结样本：两条 final（0.25＋0.5）＋一条 adjustment（signed delta −0.05，挂 ENG-1
 * 的 final 行）——合计 **0.7 USD**。调整行是负值原值保留的关键样本（备份/恢复不得取绝对值）。
 */
function drillCostRows(): Record<string, unknown>[] {
  const finalId = ulid(T0, 900)
  return [
    costRow({ id: finalId, note: '日终首冻' }),
    costRow({ id: ulid(T0, 901), person_id: 'ENG-2', cost_usd: 0.5 }),
    costRow({
      id: ulid(T0, 902),
      cost_usd: -0.05,
      kind: 'adjustment',
      adjusts_id: finalId,
      closed_by: 'cost-adjust:2026-10-23',
      note: '迟到事实',
    }),
  ]
}

// ---------------------------------------------------------------------------
// 环境记录（MIG-04 入口条件③）
// ---------------------------------------------------------------------------

interface DrillEnvironment {
  /** `process.versions.node`（运行时 Node 版本） */
  readonly node: string
  /** `process.versions.sqlite`（node:sqlite 内置 SQLite 版本；旧版 Node 无此键则空串） */
  readonly sqliteModule: string
  /** `SELECT sqlite_version()`（库连接实测版本——与 module 侧对照） */
  readonly sqliteQuery: string
  /** `PRAGMA user_version`（本仓恒 0：版本唯一源＝schema_version 表，事实登记见 v14-records.test.ts） */
  readonly userVersion: number
  /** `schema_version` MAX(version)＝迁移到位的库内版本 */
  readonly schemaVersion: number
  /** `schema_version` 全列版本号（升序；MIG-04 应 1..15 无缺号） */
  readonly schemaVersions: readonly number[]
  /** `PRAGMA journal_mode`（driver.ts 对齐 WAL——演练库环境的旁证） */
  readonly journalMode: string
}

function readEnvironment(db: DatabaseSync): DrillEnvironment {
  const sqliteRow = db.prepare('SELECT sqlite_version() AS v').get() as { v: unknown }
  const userRow = db.prepare('PRAGMA user_version').get() as { user_version: unknown }
  const journalRow = db.prepare('PRAGMA journal_mode').get() as { journal_mode: unknown }
  const versionRows = db.prepare('SELECT version FROM schema_version ORDER BY version ASC').all() as Array<{ version: unknown }>
  const schemaVersions = versionRows.map((row) => Number(row.version))
  const top = schemaVersions.at(-1)
  return {
    node: process.versions.node,
    sqliteModule: process.versions['sqlite'] ?? '',
    sqliteQuery: String(sqliteRow.v),
    userVersion: Number(userRow.user_version),
    schemaVersion: top === undefined ? 0 : top,
    schemaVersions,
    journalMode: String(journalRow.journal_mode),
  }
}

// ---------------------------------------------------------------------------
// 恢复面（人工显式；测试内 SQL——生产侧无恢复 API）
// ---------------------------------------------------------------------------

/** 恢复插入语句：列集/列序＝备份冻结列序（COST_DAILY_BACKUP_COLUMNS）逐列还原，缺值列写 null */
const COST_DAILY_RESTORE_SQL = [
  `INSERT INTO cost_daily (${COST_DAILY_BACKUP_COLUMNS.join(', ')})`,
  `VALUES (${COST_DAILY_BACKUP_COLUMNS.map(() => '?').join(', ')})`,
].join(' ')

/**
 * **人工显式恢复**：把备份行逐行插回目标库（单事务原子——半截恢复整体回滚，不留半库）。
 * 非自动回滚路径：调用方须显式给出备份件与目标库；重复恢复由库侧约束拒（见下 second 调用）。
 */
function restoreCostDailyExplicit(db: DatabaseSync, rows: readonly CostDailyBackupRow[]): void {
  const statement = db.prepare(COST_DAILY_RESTORE_SQL)
  db.exec('BEGIN')
  try {
    for (const row of rows) {
      statement.run(
        row.id,
        row.company,
        row.person_id,
        row.model,
        row.cost_date,
        row.tokens_in,
        row.tokens_out,
        row.cache_read,
        row.cache_creation,
        row.price_snapshot_id,
        row.cost_usd,
        row.basis,
        row.kind,
        row.adjusts_id,
        row.closed_at,
        row.closed_by,
        row.note,
      )
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

/** 从库内按备份列序/行序重导 JSONL（与 backupCostDaily 同形——恢复无损的字节级判据） */
function costDailyJsonlFromDb(db: DatabaseSync): string {
  const sql = `SELECT ${COST_DAILY_BACKUP_COLUMNS.join(', ')} FROM cost_daily ORDER BY cost_date ASC, person_id ASC, model ASC, id ASC`
  const rows = db.prepare(sql).all() as SqlRow[]
  const lines = rows.map((row) => {
    const plain: Record<string, unknown> = {}
    for (const column of COST_DAILY_BACKUP_COLUMNS) plain[column] = row[column] ?? null
    return JSON.stringify(plain)
  })
  return lines.join('\n') + (lines.length > 0 ? '\n' : '')
}

/** 删库三件套（db / -wal / -shm）；返回三件是否确已删除（删库到位判据） */
function dropDatabase(dbPath: string): boolean {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true })
  return !existsSync(dbPath) && !existsSync(`${dbPath}-wal`) && !existsSync(`${dbPath}-shm`)
}

function sumUsd(rows: readonly { cost_usd: number }[]): number {
  return rows.reduce((sum, row) => sum + row.cost_usd, 0)
}

// ---------------------------------------------------------------------------
// 演练步骤（四段小函数；每段自管句柄生命周期——异常路径也不漏 close）
// ---------------------------------------------------------------------------

interface SealedSource {
  readonly events: EventRecord[]
  readonly versionBefore: number
  readonly env: DrillEnvironment
  readonly backup: CostDailyBackupResult
  readonly dumpedLines: number
  readonly costRows: number
  readonly costUsd: number
}

/** ①＋②：临时库 migrate 到 v15 → 写语料 → 环境记录 → 备份快照 → dump events */
function sealSource(sourceDb: string, backupPath: string, eventsJsonl: string): SealedSource {
  const ledger = openLedger(sourceDb)
  try {
    for (const event of drillEvents()) ledger.appendEvent(event)
    for (const row of drillCostRows()) ledger.appendCostDaily(row)
    const events = ledger.queryEvents()
    const costRows = ledger.listCostDaily()
    const env = readEnvironment(ledger.db)
    const versionBefore = ledger.version()
    const backup = backupCostDaily(ledger.db, backupPath)
    const dumpedLines = ledger.dumpEvents(eventsJsonl).lines
    return { events, versionBefore, env, backup, dumpedLines, costRows: costRows.length, costUsd: roundUsd(sumUsd(costRows)) }
  } finally {
    ledger.close()
  }
}

interface RestoreOutcome {
  readonly rows: number
  readonly rowsAfterSecondRestore: number
  readonly usd: number
  readonly jsonl: string
  readonly events: number
  readonly doubleRestoreRejected: boolean
  /** 第二次恢复被拒的原始错误消息（钉住「库侧约束拒」而非任意错误——不静默吞错因） */
  readonly doubleRestoreError: string
}

/** ③：新库 migrate（v15）→ 只恢复 cost_daily（人工显式）→ 逐行/金额/events 缺席核对 */
function restoreIntoNewDb(restoredDb: string, backupPath: string): RestoreOutcome {
  const rows = readCostDailyBackup(backupPath)
  const ledger = openLedger(restoredDb)
  try {
    restoreCostDailyExplicit(ledger.db, rows)
    const restored = ledger.listCostDaily()
    const jsonl = costDailyJsonlFromDb(ledger.db)
    const events = ledger.queryEvents().length
    // 第二次恢复：final 行命中 partial UNIQUE idx_cost_daily_final → 事务回滚、行数不变。
    // 即「恢复」不是幂等自动动作——重复执行必须显式处置，不得静默双写。
    let doubleRestoreRejected = false
    let doubleRestoreError = ''
    try {
      restoreCostDailyExplicit(ledger.db, rows)
    } catch (err) {
      doubleRestoreRejected = true
      doubleRestoreError = err instanceof Error ? err.message : String(err)
    }
    return {
      rows: restored.length,
      rowsAfterSecondRestore: ledger.listCostDaily().length,
      usd: roundUsd(sumUsd(restored)),
      jsonl,
      events,
      doubleRestoreRejected,
      doubleRestoreError,
    }
  } finally {
    ledger.close()
  }
}

interface RebuildOutcome {
  readonly events: number
  readonly after: EventRecord[]
  readonly version: number
  readonly excluded: readonly string[]
  readonly costRows: number
}

/** ④：删库后 rebuild（只重放 events）→ 重建库逐条 events 与 cost_daily 零行核对 */
function rebuildAfterDrop(eventsJsonl: string, rebuiltDb: string): RebuildOutcome {
  const result = rebuild(eventsJsonl, rebuiltDb)
  const ledger = openLedger(rebuiltDb)
  try {
    const after = ledger.queryEvents()
    return {
      events: after.length,
      after,
      version: ledger.version(),
      excluded: result.excludedDomains,
      costRows: ledger.listCostDaily().length,
    }
  } finally {
    ledger.close()
  }
}

// ---------------------------------------------------------------------------
// 演练报告（人读；行内容确定性——可重跑判据之一，路径只出 basename）
// ---------------------------------------------------------------------------

interface DrillFacts {
  readonly dir: string
  readonly sourceDb: string
  readonly backupPath: string
  readonly digestPath: string
  readonly eventsJsonl: string
  readonly restoredDb: string
  readonly rebuiltDb: string
  readonly backupBytes: string
  readonly digestText: string
  readonly backupSha256: string
  readonly backupLines: number
  readonly sealedRows: number
  readonly sealedUsd: number
  /** 备份件行自身的金额合计（恢复值的对照面：源库值 / 备份值 / 恢复库值三侧同数） */
  readonly backupUsd: number
  readonly eventsWritten: number
  readonly versionBefore: number
  readonly env: DrillEnvironment
  readonly restoredRows: number
  readonly restoredRowsAfterSecond: number
  readonly restoredUsd: number
  readonly restoredJsonl: string
  readonly restoredEvents: number
  readonly restoredLossless: boolean
  readonly doubleRestoreRejected: boolean
  readonly doubleRestoreError: string
  readonly dropped: boolean
  readonly rebuiltEvents: number
  readonly rebuiltVersion: number
  readonly rebuiltExcluded: readonly string[]
  readonly replayedCostRows: number
  readonly eventsRoundTrip: boolean
  readonly backupVerified: boolean
  readonly pass: boolean
}

interface DrillEvidence extends DrillFacts {
  readonly report: readonly string[]
}

function renderDrillReport(facts: DrillFacts): string[] {
  return [
    '快照/回滚演练（DOM-04 限域：只备份不重放；备份＝恢复语义，非重建语义）',
    `环境：node=${facts.env.node}；node:sqlite=${facts.env.sqliteModule}（process.versions.sqlite）；sqlite_version()=${facts.env.sqliteQuery}；user_version=${facts.env.userVersion}；schema_version=v${facts.env.schemaVersion}（${facts.env.schemaVersions.join(',')}）；journal_mode=${facts.env.journalMode}`,
    `快照：cost_daily → ${path.basename(facts.backupPath)}（${facts.backupLines} 行；sha256=${facts.backupSha256}；侧车 ${path.basename(facts.digestPath)}）`,
    `恢复（人工显式）：${path.basename(facts.restoredDb)} ← ${path.basename(facts.backupPath)}（${facts.restoredRows} 行；合计 ${facts.restoredUsd} USD；events ${facts.restoredEvents} 条——备份不含 events，不随恢复）`,
    `重建：删库三件套 → rebuild 重放 events ${facts.rebuiltEvents} 条（schema v${facts.rebuiltVersion}）；cost_daily ${facts.replayedCostRows} 行（排除域不重放）`,
    '排除域：cost_daily（DOM-04 只备份不重放，遗留不可重建；备份=恢复语义，非重建语义——钱账未重建）',
    '回滚边界：快照恢复=人工显式执行（本演练在生产侧无恢复/回滚 API）；不可逆迁移显式声明，不承诺自动回滚（v2/16 §五）',
    facts.pass ? '演练 PASS' : '演练 FAIL',
  ]
}

// ---------------------------------------------------------------------------
// 一次完整演练（同输入 → 同字节；两次调用即「可重跑」证据）
// ---------------------------------------------------------------------------

function runDrill(dir: string): DrillEvidence {
  mkdirSync(dir, { recursive: true })
  const sourceDb = path.join(dir, 'source.db')
  const backupPath = path.join(dir, 'cost_daily.jsonl')
  const eventsJsonl = path.join(dir, 'events.jsonl')
  const restoredDb = path.join(dir, 'restored.db')
  const rebuiltDb = path.join(dir, 'rebuilt.db')

  const sealed = sealSource(sourceDb, backupPath, eventsJsonl)
  const backupBytes = readFileSync(sealed.backup.path, 'utf8')
  const digestText = readFileSync(sealed.backup.digestPath, 'utf8')
  const verified = verifyBackup(sealed.backup.path, sealed.backup.sha256)
  const restored = restoreIntoNewDb(restoredDb, sealed.backup.path)
  // 三侧同数：源库 listCostDaily 合计、备份件行合计、恢复库 listCostDaily 合计（备份值＝恢复值判据）
  const backupUsd = roundUsd(sumUsd(readCostDailyBackup(sealed.backup.path)))
  const dropped = dropDatabase(sourceDb)
  const rebuilt = rebuildAfterDrop(eventsJsonl, rebuiltDb)

  const backupVerified = verified.ok && verified.lines === sealed.backup.lines && sealed.backup.lines === sealed.costRows
  const restoredLossless = restored.jsonl === backupBytes
  const eventsRoundTrip = JSON.stringify(sealed.events) === JSON.stringify(rebuilt.after)
  const facts: DrillFacts = {
    dir,
    sourceDb,
    backupPath,
    digestPath: sealed.backup.digestPath,
    eventsJsonl,
    restoredDb,
    rebuiltDb,
    backupBytes,
    digestText,
    backupSha256: sealed.backup.sha256,
    backupLines: sealed.backup.lines,
    sealedRows: sealed.costRows,
    sealedUsd: sealed.costUsd,
    backupUsd,
    eventsWritten: sealed.events.length,
    versionBefore: sealed.versionBefore,
    env: sealed.env,
    restoredRows: restored.rows,
    restoredRowsAfterSecond: restored.rowsAfterSecondRestore,
    restoredUsd: restored.usd,
    restoredJsonl: restored.jsonl,
    restoredEvents: restored.events,
    restoredLossless,
    doubleRestoreRejected: restored.doubleRestoreRejected,
    doubleRestoreError: restored.doubleRestoreError,
    dropped,
    rebuiltEvents: rebuilt.events,
    rebuiltVersion: rebuilt.version,
    rebuiltExcluded: rebuilt.excluded,
    replayedCostRows: rebuilt.costRows,
    eventsRoundTrip,
    backupVerified,
    pass:
      backupVerified &&
      restored.rows === sealed.costRows &&
      restored.rowsAfterSecondRestore === sealed.costRows &&
      backupUsd === sealed.costUsd &&
      restored.usd === sealed.costUsd &&
      restored.usd === backupUsd &&
      restoredLossless &&
      restored.events === 0 &&
      restored.doubleRestoreRejected &&
      dropped &&
      rebuilt.excluded.includes('cost_daily') &&
      rebuilt.costRows === 0 &&
      rebuilt.events === sealed.events.length &&
      eventsRoundTrip,
  }
  return { ...facts, report: renderDrillReport(facts) }
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

let root = ''
let drill: DrillEvidence

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-v2-snapshot-drill-'))
  drill = runDrill(path.join(root, 'run-a'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('环境记录（MIG-04 入口条件③：node:sqlite 版本与 user_version）', () => {
  it('记录 node:sqlite 版本（process.versions／sqlite_version()）、user_version、schema_version 全列', () => {
    // Node 24 LTS 口径（docs/16-§二；.mise.toml 钉版 24.21.0）——演练环境可判
    const [major] = drill.env.node.split('.')
    expect(Number(major)).toBeGreaterThanOrEqual(24)
    expect(drill.env.sqliteModule).toMatch(/^\d+\.\d+\.\d+$/)
    expect(drill.env.sqliteQuery).toMatch(/^\d+\.\d+\.\d+$/)
    // 同一进程内：module 侧与 SQL 查询侧应一致（不一致即环境漂移，如实红）
    expect(drill.env.sqliteQuery).toBe(drill.env.sqliteModule)
    // user_version 恒 0 是**事实登记**（版本唯一源＝schema_version 表，见 v14-records.test.ts 口径）
    expect(drill.env.userVersion).toBe(0)
    expect(drill.env.schemaVersion).toBe(LATEST_VERSION)
    expect(LATEST_VERSION).toBe(15) // MIG-04 封顶：v14 records 表族 + v15 events 触发器
    expect(drill.env.schemaVersions).toEqual(Array.from({ length: LATEST_VERSION }, (_, i) => i + 1))
    expect(drill.versionBefore).toBe(15)
    expect(drill.env.journalMode).toBe('wal')
    // 报告头两行即环境记录落盘形（docs/baselines/mig-04-drill.md 抄录同一形状）
    expect(drill.report[1]).toContain(`node:sqlite=${drill.env.sqliteModule}`)
    expect(drill.report[1]).toContain(`user_version=${drill.env.userVersion}`)
    expect(drill.report[1]).toContain(`schema_version=v${drill.env.schemaVersion}`)
  })
})

describe('快照：备份件（JSONL）与 sha256 侧车（只备份 cost_daily）', () => {
  it('备份件与侧车存在、独立复算 sha256 一致、行数=冻结行数', () => {
    expect(existsSync(drill.backupPath)).toBe(true)
    expect(existsSync(drill.digestPath)).toBe(true)
    expect(statSync(drill.backupPath).size).toBeGreaterThan(0)
    // 独立复算（测试侧 node:crypto，不信任生产实现自报）
    const independent = createHash('sha256').update(drill.backupBytes, 'utf8').digest('hex')
    expect(independent).toBe(drill.backupSha256)
    expect(sha256Hex(drill.backupBytes)).toBe(drill.backupSha256)
    // 侧车形：`<hex>  <basename>\n`（sha256sum 可读形）
    expect(drill.digestText).toBe(`${drill.backupSha256}  ${path.basename(drill.backupPath)}\n`)
    expect(verifyBackup(drill.backupPath, drill.backupSha256)).toMatchObject({ ok: true, lines: drill.backupLines })
    expect(verifyBackup(drill.backupPath, `sha256:${drill.backupSha256}`).ok).toBe(true)
    expect(drill.backupBytes.endsWith('\n')).toBe(true) // JSONL 稳定形：有行即尾换行
    expect(drill.backupLines).toBe(SEALED_ROWS)
    expect(drill.backupVerified).toBe(true)
  })

  it('备份只含 cost_daily：events 不在备份内（事件列/事件 id 双双缺席）', () => {
    const rows = drill.backupBytes
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(rows).toHaveLength(SEALED_ROWS)
    for (const row of rows) expect(Object.keys(row)).toEqual([...COST_DAILY_BACKUP_COLUMNS])
    expect(rows.some((row) => 'event' in row || 'issue' in row || 'actor' in row || 'ts' in row)).toBe(false)
    // 事件 id 一律不出现在备份件里（备份范围＝cost_daily，events 只走 dumpEvents 通道）
    for (const event of drillEvents()) expect(drill.backupBytes).not.toContain(event.id)
    expect(drill.eventsWritten).toBe(DRILL_EVENTS)
    expect(drill.backupLines).not.toBe(drill.eventsWritten)
  })
})

describe('恢复：备份→新库（只恢复 cost_daily，人工显式）', () => {
  it('恢复后 cost_daily 行数/金额与备份一致，且逐行与备份件字节同形（无损）', () => {
    expect(drill.restoredRows).toBe(drill.backupLines)
    expect(drill.restoredRows).toBe(SEALED_ROWS)
    expect(drill.restoredUsd).toBe(drill.sealedUsd)
    // 三侧同数：源库合计＝备份件合计＝恢复库合计
    expect(drill.backupUsd).toBe(drill.sealedUsd)
    expect(drill.restoredUsd).toBe(drill.backupUsd)
    expect(drill.sealedUsd).toBe(SEALED_USD) // 0.25 + 0.5 − 0.05（负 delta 原值保留）
    // sha256 钉在恢复侧：恢复库重导 JSONL 的摘要＝备份件摘要（可复算）
    expect(sha256Hex(drill.restoredJsonl)).toBe(drill.backupSha256)
    // 最强判据：恢复库按备份列序/行序重导的 JSONL 与备份件逐字节相同
    expect(drill.restoredLossless).toBe(true)
    expect(drill.restoredJsonl).toBe(drill.backupBytes)
    // 只恢复 cost_daily：events 不随备份恢复（备份件本就不含 events）
    expect(drill.restoredEvents).toBe(0)
    expect(drill.report.join('\n')).toContain('人工显式')
    expect(drill.report.join('\n')).toContain('不承诺自动回滚')
  })

  it('人工显式恢复非幂等：重复恢复被库侧 partial UNIQUE 拒、行数不变（不静默双写）', () => {
    expect(drill.doubleRestoreRejected).toBe(true)
    // 拒因须是库侧唯一索引（idx_cost_daily_final）而非任意错误——错误消息如实钉住
    expect(drill.doubleRestoreError).toMatch(/UNIQUE/i)
    expect(drill.restoredRowsAfterSecond).toBe(drill.restoredRows)
    // 恢复边界：生产侧没有恢复/回滚 API（备份/读回/校验三面之外无第四面；自动回滚＝提案流）
    expect(Object.keys(backupFace).filter((name) => /restore|rollback/i.test(name))).toEqual([])
  })
})

describe('删库重建：events 重放成功、cost_daily 零重放', () => {
  it('删库三件套到位 → rebuild 重放 events（全列一致），重建库 cost_daily 为空', () => {
    expect(drill.dropped).toBe(true)
    expect(drill.rebuiltEvents).toBe(drill.eventsWritten)
    expect(drill.rebuiltEvents).toBe(DRILL_EVENTS)
    expect(drill.eventsRoundTrip).toBe(true) // 全列 deep-equal（含 ULID 序/四桶 canonical 序）
    expect(drill.rebuiltVersion).toBe(15)
    expect([...drill.rebuiltExcluded]).toEqual(['cost_daily'])
    expect(drill.replayedCostRows).toBe(0) // 排除域不重放：备份≠重建
    const report = drill.report.join('\n')
    expect(report).toContain('排除域')
    expect(report).toContain('cost_daily')
    expect(report).toContain('钱账未重建')
    expect(report).toContain('只备份不重放')
    expect(report).not.toContain('钱账已重建')
    expect(drill.pass).toBe(true)
    expect(drill.report.at(-1)).toBe('演练 PASS')
  })
})

describe('演练可重跑（同一输入两次字节一致）', () => {
  it('第二次演练：备份件字节/摘要/侧车/恢复行集/报告行全部与首次一致', () => {
    const rerun = runDrill(path.join(root, 'run-b'))
    expect(rerun.backupBytes).toBe(drill.backupBytes)
    expect(rerun.backupSha256).toBe(drill.backupSha256)
    expect(rerun.digestText).toBe(drill.digestText)
    expect(rerun.restoredJsonl).toBe(drill.restoredJsonl)
    expect(rerun.report).toEqual(drill.report)
    expect(rerun.restoredRows).toBe(drill.restoredRows)
    expect(rerun.restoredUsd).toBe(drill.restoredUsd)
    expect(rerun.replayedCostRows).toBe(0)
    expect(rerun.pass).toBe(true)
  })
})
