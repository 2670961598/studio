/**
 * qa-eval —— #811 阶段2：golden 集评测（observe-only；2026-11-13 制作人批口径）
 *
 * 边界（与阶段1同纪律；P0 教训台账 §八十六）：
 *   - 只读：node:sqlite `DatabaseSync({readOnly:true})` 仅 SELECT；不写台账/单据/事件/事件词/schema；
 *     不接主循环、不做门禁；**drift 红不得 exit≠0**（仅参数/数据/IO 错 exit≠0）。
 *   - golden 数据=`<companyDir>/var/qa/golden/golden-v<n>.json`+manifest（sha256/版本/选取规则；
 *     只读、不入仓）；实现**不自动生成/覆盖**——构建只能经显式 `--build-golden <dir>`（QA-1 人工审后）。
 *   - 输出 `qa-eval/v1` JSON+Markdown 同 basename、原子写、幂等同字节；MD 结论先行；
 *     drift 段标 baseline 日期/样本量/coverage；无 golden/坏 golden/坏日期 → exit≠0 零输出。
 *
 * 指标（窗口=本地自然日，复用 qa-report 口径）：
 *   onePassRate（CLOSE 单中 GATE_FAIL=0 占比）、失败原因分布 JSD+top 漂移、耗时 median/p90 漂移、
 *   model/tier 分布 pp、DAILY_ALARM by src；golden 逐单 expected vs actual（仅窗口可见单）+ coverage。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parseModelsYaml } from '@studio-next/core'
import { CONCISE, SECTION } from '../usage.ts'
import { errText } from '../argv.ts'
import { helpOk, usageFail, wantsHelp } from '../help.ts'
import { readQaData } from '../qa-report.ts'
import { computeQaMetrics } from '../qa-report-stats.ts'
import {
  QA_GOLDEN_DEFAULT_COUNT,
  goldenFileText,
  loadGolden,
  manifestOf,
  selectGoldenTickets,
  sha256Hex,
  writeGoldenFiles,
  type QaGoldenFile,
  type QaGoldenStats,
  type QaTierName,
} from './qa-golden.ts'
import { buildEvalReport, renderEvalJson, renderEvalMarkdown, statsOfLifecycles } from './qa-eval-report.ts'

export interface QaEvalArgs {
  readonly db: string
  readonly company: string
  readonly date: string
  readonly buildGolden: string | undefined
  readonly goldenDir: string
  readonly outDir: string
  readonly goldenVersion: string | undefined
  readonly models: string | undefined
  readonly top: number
  readonly count: number
  readonly until: string
  readonly baseline: string | undefined
}

export type QaEvalArgsResult = { readonly ok: true; readonly args: QaEvalArgs } | { readonly ok: false; readonly message: string }

function isRealDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const back = new Date(y, m - 1, d)
  return back.getFullYear() === y && back.getMonth() === m - 1 && back.getDate() === d
}
function localDateString(ms: number): string {
  const d = new Date(ms)
  const pad = (v: number): string => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function dayWindow(date: string): { since: number; until: number } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return { since: new Date(y, m - 1, d, 0, 0, 0, 0).valueOf(), until: new Date(y, m - 1, d + 1, 0, 0, 0, 0).valueOf() }
}
function yesterday(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return localDateString(d.valueOf())
}

function nextValue(argv: readonly string[], i: number, token: string): { value: string; next: number } | { message: string } {
  const eq = token.indexOf('=')
  if (eq >= 0) return { value: token.slice(eq + 1), next: i }
  const value = argv[i + 1]
  if (value === undefined || value.startsWith('--')) return { message: `参数缺值：${token}` }
  return { value, next: i + 1 }
}

/** argv → QaEvalArgs（eval / --build-golden 两模式共用参数面） */
export function parseQaEvalArgs(argv: readonly string[]): QaEvalArgsResult {
  const values: Record<string, string> = {}
  const flags = new Set(['db', 'company', 'date', 'build-golden', 'golden-dir', 'out-dir', 'golden-version', 'version', 'models', 'top', 'count', 'until', 'baseline'])
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? ''
    const eq = token.indexOf('=')
    const key = token.startsWith('--') ? (eq >= 0 ? token.slice(2, eq) : token.slice(2)) : ''
    if (!flags.has(key)) return { ok: false, message: `未知参数：${token}（qa-eval 只接受 --db/--company/--date/--build-golden/--golden-dir/--out-dir/--golden-version/--models/--top/--count/--until/--baseline）` }
    const got = nextValue(argv, i, token)
    if ('message' in got) return { ok: false, message: got.message }
    values[key] = got.value
    i = got.next
  }
  if (values['db'] === undefined) return { ok: false, message: '缺少 --db <ledger.sqlite>（只读开库，不代建）' }
  if (values['company'] === undefined || values['company'] === '') return { ok: false, message: '缺少 --company <slug>' }
  const buildGolden = values['build-golden'] !== undefined ? path.resolve(values['build-golden']) : undefined
  const date = values['date'] ?? yesterday()
  if (!isRealDate(date)) return { ok: false, message: `坏日期：${date}（须 YYYY-MM-DD 真日历日）` }
  const until = values['until'] ?? date
  if (!isRealDate(until)) return { ok: false, message: `坏 --until：${until}` }
  let top = 10
  if (values['top'] !== undefined) {
    const n = Number(values['top'])
    if (!Number.isSafeInteger(n) || n <= 0) return { ok: false, message: `坏 --top：${values['top']}` }
    top = n
  }
  let count = QA_GOLDEN_DEFAULT_COUNT
  if (values['count'] !== undefined) {
    const n = Number(values['count'])
    if (!Number.isSafeInteger(n) || n <= 0) return { ok: false, message: `坏 --count：${values['count']}` }
    count = n
  }
  const db = path.resolve(values['db'])
  const goldenDir = values['golden-dir'] !== undefined ? path.resolve(values['golden-dir']) : path.join(path.dirname(db), 'var', 'qa', 'golden')
  const outDir = values['out-dir'] !== undefined ? path.resolve(values['out-dir']) : path.join(path.dirname(db), 'var', 'reports', 'qa')
  return {
    ok: true,
    args: {
      db,
      company: values['company'],
      date,
      buildGolden,
      goldenDir,
      outDir,
      goldenVersion: values['golden-version'] ?? values['version'],
      models: values['models'] !== undefined ? path.resolve(values['models']) : undefined,
      top,
      count,
      until,
      baseline: values['baseline'] !== undefined ? path.resolve(values['baseline']) : undefined,
    },
  }
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0)
}
function str(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

// ————————————————————————— 只读数（构建/评测共用） —————————————————————————

interface QaEvalEventRow {
  readonly ts: number
  readonly issue: string
  readonly event: string
  readonly note: string | null
}

function readOnlyDb<T>(dbPath: string, fn: (db: DatabaseSync) => T): T {
  if (!existsSync(dbPath)) throw new Error(`台账不存在：${dbPath}（只读面不代建库）`)
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

function readMirror(db: DatabaseSync, company: string): Array<{ issue: string; dept: string; level: number; type: string; lane: string | null }> {
  const rows = db.prepare('SELECT issue, dept, level, type, lane FROM ticket_mirror WHERE company = ? ORDER BY issue').all(company) as Array<Record<string, unknown>>
  return rows.map((r) => ({ issue: str(r['issue']), dept: str(r['dept']), level: num(r['level']), type: str(r['type']), lane: r['lane'] === null || r['lane'] === undefined ? null : str(r['lane']) }))
}
function readWork(db: DatabaseSync, issues: readonly string[]): Array<{ issue: string; model: string | null }> {
  if (issues.length === 0) return []
  const placeholders = issues.map(() => '?').join(',')
  const rows = db.prepare(`SELECT issue, model FROM work_records WHERE issue IN (${placeholders})`).all(...issues) as Array<Record<string, unknown>>
  return rows.map((r) => ({ issue: str(r['issue']), model: r['model'] === null || r['model'] === undefined ? null : str(r['model']) }))
}
function readEvents(db: DatabaseSync, company: string, since: number, until: number): QaEvalEventRow[] {
  const rows = db.prepare('SELECT ts, issue, event, note FROM events WHERE company = ? AND ts >= ? AND ts < ? ORDER BY issue, ts, id').all(company, since, until) as Array<Record<string, unknown>>
  return rows.map((r) => ({ ts: num(r['ts']), issue: str(r['issue']), event: str(r['event']), note: r['note'] === null || r['note'] === undefined ? null : str(r['note']) }))
}
function readEventsForIssues(db: DatabaseSync, company: string, issues: readonly string[]): QaEvalEventRow[] {
  if (issues.length === 0) return []
  const placeholders = issues.map(() => '?').join(',')
  const rows = db.prepare(`SELECT ts, issue, event, note FROM events WHERE company = ? AND issue IN (${placeholders}) ORDER BY issue, ts, id`).all(company, ...issues) as Array<Record<string, unknown>>
  return rows.map((r) => ({ ts: num(r['ts']), issue: str(r['issue']), event: str(r['event']), note: r['note'] === null || r['note'] === undefined ? null : str(r['note']) }))
}

function tierMapOf(modelsFile: string | undefined): Map<string, QaTierName> {
  const map = new Map<string, QaTierName>()
  if (modelsFile === undefined) return map
  const parsed = parseModelsYaml(readFileSync(modelsFile, 'utf8'))
  for (const tier of ['high', 'mid', 'low'] as const) {
    const spec = parsed.tiers[tier]
    map.set(`${spec.provider}/${spec.model}`, tier)
  }
  return map
}

/**
 * 载入 `--baseline <qa-report JSON>`（阶段1报表；P3）：drift 用其窗口指标对比当前窗口，
 * golden 仍供 coverage/逐单 expected-actual。坏文件/schema 不符 → 明确报错（不静默忽略）。
 * 只读取文件；不写台账。
 */
export function loadBaselineReport(file: string): { stats: QaGoldenStats; reportDate: string; sha256: string } {
  if (!existsSync(file)) throw new Error(`baseline 不存在：${file}`)
  const text = readFileSync(file, 'utf8')
  const sha256 = sha256Hex(text)
  const raw = JSON.parse(text) as {
    schema?: unknown
    reportDate?: unknown
    metrics?: {
      failures?: { top?: Array<{ reason?: unknown; count?: unknown }> }
      models?: { rows?: Array<{ model?: unknown; workRecords?: unknown }>; tierCounts?: Record<string, unknown> }
      durations?: { medianMs?: unknown; p90Ms?: unknown }
      dailyAlarmsBySrc?: Array<{ src?: unknown; count?: unknown }>
    }
  }
  if (raw.schema !== 'qa-report/v1') throw new Error(`baseline schema 不符（须 qa-report/v1）：${String(raw.schema)}`)
  if (typeof raw.reportDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.reportDate)) throw new Error(`baseline reportDate 缺失/非法：${String(raw.reportDate)}`)
  const metrics = raw.metrics
  if (typeof metrics !== 'object' || metrics === null) throw new Error('baseline metrics 缺失')
  // fail reasons：qa-report 只存 top-N（非全量）→ 作为可比的 top 基线（文案/字段如实来源）
  const failReasonCounts: Record<string, number> = {}
  for (const row of metrics.failures?.top ?? []) {
    if (typeof row.reason !== 'string' || typeof row.count !== 'number') continue
    failReasonCounts[row.reason] = (failReasonCounts[row.reason] ?? 0) + row.count
  }
  const modelCounts: Record<string, number> = {}
  for (const row of metrics.models?.rows ?? []) {
    if (typeof row.model !== 'string' || typeof row.workRecords !== 'number') continue
    if (row.workRecords > 0) modelCounts[row.model] = row.workRecords
  }
  const tiers = metrics.models?.tierCounts ?? {}
  const tierCounts: Record<QaTierName, number> = {
    high: typeof tiers['high'] === 'number' ? tiers['high'] : 0,
    mid: typeof tiers['mid'] === 'number' ? tiers['mid'] : 0,
    low: typeof tiers['low'] === 'number' ? tiers['low'] : 0,
  }
  const alarmSrcCounts: Record<string, number> = {}
  for (const row of metrics.dailyAlarmsBySrc ?? []) {
    if (typeof row.src === 'string' && typeof row.count === 'number') alarmSrcCounts[row.src] = row.count
  }
  const medianMs = typeof metrics.durations?.medianMs === 'number' ? metrics.durations.medianMs : null
  const p90Ms = typeof metrics.durations?.p90Ms === 'number' ? metrics.durations.p90Ms : null
  return {
    sha256,
    reportDate: raw.reportDate,
    stats: {
      onePassRate: null, // qa-report 无一次通过率（golden 专有）；drift 中该指标 baseline=null 如实呈现
      failReasonCounts,
      duration: { medianMs, p90Ms },
      modelCounts,
      tierCounts,
      outcomeCounts: { clean: 0, retry: 0, 'qa-back': 0, long: 0, stall: 0 },
      alarmSrcCounts,
    },
  }
}

// ————————————————————————— golden 构建（显式入口；人工审后运行） —————————————————————————

export function buildGolden(args: QaEvalArgs, now = Date.now()): { golden: QaGoldenFile; manifest: ReturnType<typeof manifestOf> } {
  const end = dayWindow(args.until).until
  return readOnlyDb(args.db, (db) => {
    const events = readEvents(db, args.company, 0, end)
    const mirror = readMirror(db, args.company)
    const work = readWork(db, mirror.map((m) => m.issue))
    const tiers = tierMapOf(args.models)
    const { tickets, stats, cohorts } = selectGoldenTickets(
      { events, mirror, work },
      { targetCount: args.count, builtUntil: args.until, sourceCompany: args.company, generatedAt: new Date(now).toISOString(), tierOf: (m) => tiers.get(m) ?? null },
    )
    const version = args.goldenVersion ?? 'v1'
    const golden: QaGoldenFile = {
      schema: 'qa-golden/v1',
      version,
      generatedAt: new Date(now).toISOString(),
      selection: { rule: 'hash-strata/v1', targetCount: args.count, builtUntil: args.until, sourceCompany: args.company },
      tickets,
      stats,
      cohorts,
    }
    const manifest = manifestOf(goldenFileText(golden), version, tickets.length, golden.generatedAt)
    return { golden, manifest }
  })
}

// ————————————————————————— 评测纯面 —————————————————————————

// ————————————————————————— 渲染/落盘（同阶段1：原子、失败零输出、旧报告不破坏） —————————————————————————

function safeUnlink(file: string): void {
  try {
    unlinkSync(file)
  } catch {
    /* 不存在=已清理 */
  }
}
function writePairAtomic(jsonPath: string, mdPath: string, jsonText: string, mdText: string): void {
  const tmpJson = `${jsonPath}.tmp-${String(process.pid)}`
  const tmpMd = `${mdPath}.tmp-${String(process.pid)}`
  const backups = new Map<string, string>()
  const renamed: string[] = []
  try {
    writeFileSync(tmpJson, jsonText, 'utf8')
    writeFileSync(tmpMd, mdText, 'utf8')
    for (const file of [jsonPath, mdPath]) {
      if (existsSync(file) && !statSync(file).isFile()) throw new Error(`输出目标非普通文件：${file}（拒绝覆盖）`)
    }
    for (const file of [jsonPath, mdPath]) {
      if (!existsSync(file)) continue
      const backup = `${file}.bak-${String(process.pid)}`
      renameSync(file, backup)
      backups.set(file, backup)
    }
    try {
      renameSync(tmpJson, jsonPath)
      renamed.push(jsonPath)
      renameSync(tmpMd, mdPath)
      renamed.push(mdPath)
    } catch (err) {
      for (const file of renamed) safeUnlink(file)
      for (const [file, backup] of backups) if (existsSync(backup) && !existsSync(file)) renameSync(backup, file)
      throw err
    }
    for (const backup of backups.values()) safeUnlink(backup)
  } catch (err) {
    safeUnlink(tmpJson)
    safeUnlink(tmpMd)
    for (const [file, backup] of backups) {
      try {
        if (existsSync(backup) && !existsSync(file)) renameSync(backup, file)
      } catch {
        /* 还原失败不掩盖原错误 */
      }
    }
    throw err
  }
}

// ————————————————————————— 命令面 —————————————————————————

export async function cmdQaEval(argv: string[]): Promise<number> {
  if (wantsHelp(argv)) return helpOk(SECTION['qa-eval'])
  const parsed = parseQaEvalArgs(argv)
  if (!parsed.ok) return usageFail('qa-eval', parsed.message, CONCISE['qa-eval'])
  const args = parsed.args
  try {
    if (args.buildGolden !== undefined) {
      // 显式构建（QA-1 人工审后）；已存在即拒（不自动生成/覆盖）
      const built = buildGolden(args)
      const { goldenPath, manifestPath } = writeGoldenFiles(args.buildGolden, built.golden, built.manifest)
      console.log(`qa-golden 已生成（人工审后使用）：${goldenPath} / ${manifestPath}（version=${built.golden.version} count=${String(built.golden.tickets.length)} builtUntil=${built.golden.selection.builtUntil}）`)
      return 0
    }
    const loaded = loadGolden(args.goldenDir, args.goldenVersion)
    const tiers = tierMapOf(args.models)
    const { since, until } = dayWindow(args.date)
    const data = readQaData(args.db, args.company, args.date, since, until)
    const metrics = computeQaMetrics({ ...data, tierOf: (m) => tiers.get(m) ?? null, top: args.top })
    const closedIssues = [...new Set(data.events.filter((e) => e.event === 'CLOSE').map((e) => e.issue))].sort()
    const windowIssues = new Set<string>([...data.events.map((e) => e.issue), ...data.work.map((w) => w.issue)])
    const windowIssueList = [...windowIssues].sort()
    const lifecycleEvents = readOnlyDb(args.db, (db) => readEventsForIssues(db, args.company, windowIssueList))
    const work = readOnlyDb(args.db, (db) => readWork(db, windowIssueList))
    const allLifecycles = windowIssueList.map((issue) => ({ issue, events: lifecycleEvents.filter((e) => e.issue === issue) }))
    const closedSet = new Set(closedIssues)
    const current = statsOfLifecycles(allLifecycles.filter((l) => closedSet.has(l.issue)), (m) => tiers.get(m) ?? null, work)
    const currentWithAlarms = { ...current, alarmSrcCounts: Object.fromEntries(metrics.dailyAlarmsBySrc.map((a) => [a.src, a.count])) }
    // 窗口内可见单的实际 outcome（供逐单 expected/actual；含未 CLOSE 的 golden 单）
    const actualMap = new Map<string, string>()
    for (const life of allLifecycles) {
      const st = statsOfLifecycles([life], (m) => tiers.get(m) ?? null, work.filter((w) => w.issue === life.issue))
      actualMap.set(life.issue, Object.entries(st.outcomeCounts).find(([, n]) => n > 0)?.[0] ?? 'clean')
    }
    const baselineOverride = args.baseline === undefined ? undefined : loadBaselineReport(args.baseline)
    const report = buildEvalReport({
      args,
      golden: { golden: loaded.golden, sha256: loaded.sha256 },
      current: currentWithAlarms,
      checkedEvents: metrics.checkedEvents,
      alarmSrcCounts: metrics.dailyAlarmsBySrc,
      windowIssues,
      ticketActual: actualMap,
      ...(baselineOverride !== undefined ? { baselineOverride } : {}),
    })
    const jsonPath = path.join(args.outDir, `qa-eval-${args.date}.json`)
    const mdPath = path.join(args.outDir, `qa-eval-${args.date}.md`)
    mkdirSync(args.outDir, { recursive: true })
    writePairAtomic(jsonPath, mdPath, renderEvalJson(report), renderEvalMarkdown(report))
    console.log(
      `qa-eval 已生成：${jsonPath} / ${mdPath}（date=${args.date} golden=${report.baseline.goldenVersion} coverage=${String(report.coverage.matchedInWindow)}/${String(report.coverage.goldenTickets)} observe-only，drift 不阻断）`,
    )
    return 0
  } catch (err) {
    console.error(`qa-eval 失败：${errText(err)}`)
    return 2
  }
}
