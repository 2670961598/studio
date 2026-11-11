/**
 * qa-report —— #811 阶段 1：QA 只读指标报表（observe-only；2026-11-11 制作人令）
 *
 * 边界（P0 教训台账 §八十六：评测/门禁类须 observe-only/可回滚/不阻断既有流程）：
 *   - 只读：`node:sqlite` `DatabaseSync({readOnly:true})` 只 SELECT（**不走 openLedger**——
 *     migrate/链锚定会写库）；不写台账/不改单据/不落事件/不加事件词/不改 schema；
 *   - 不接主循环（不在七相位内）、不做门禁判定/阻断；
 *   - 输出外部报表（默认 `<companyDir>/var/reports/qa/qa-report-<date>.json|.md`；不写公司 git
 *     树——同时尊重「daemon 唯一写入者」）；原子写 tmp→rename；重跑同字节；
 *   - 失败 exit≠0 且零输出（tmp 清理）/原因上 stderr。
 *
 * 数据源（本仓只读）：events / work_records / usage_daily / ticket_mirror；
 * noop/loop-lag 不在台账→仅 `--log` 给出时 tail 摘要（JSON 标 asOf/window:'tail'，不参与日期对比）。
 * 指标定义/口径：docs/quality/README.md；台账事实源：docs/17-§3。
 *
 * 退出码：0=成功；1=用法错（缺参/坏日期/未知旗标）；2=读库/日志/输出自身错误。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parseModelsYaml } from '@studio-next/core'
import { CONCISE, SECTION } from './usage.ts'
import { errText } from './argv.ts'
import { helpOk, usageFail, wantsHelp } from './help.ts'
import {
  QA_REPORT_SCHEMA,
  computeQaMetrics,
  renderQaJson,
  renderQaMarkdown,
  summarizeLog,
  type QaEventRow,
  type QaReport,
  type QaTier,
  type QaUsageRow,
  type QaWorkRow,
} from './qa-report-stats.ts'

/** 默认 top-N（失败原因） */
export const QA_DEFAULT_TOP = 10

export interface QaArgs {
  readonly db: string
  readonly company: string
  readonly date: string
  readonly outDir: string
  readonly log: string | undefined
  readonly models: string | undefined
  readonly top: number
}

export type QaArgsResult = { readonly ok: true; readonly args: QaArgs } | { readonly ok: false; readonly message: string }

/** YYYY-MM-DD 真日历日（本地口径，与 usage_date/daemon 日锚一致） */
export function isRealDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const back = new Date(y, m - 1, d)
  return back.getFullYear() === y && back.getMonth() === m - 1 && back.getDate() === d
}

/** 本地日串 */
export function localDateString(ms: number): string {
  const d = new Date(ms)
  const pad = (v: number): string => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** date 的本地自然日窗口 [since, until)（epoch ms） */
export function localDayWindow(date: string): { since: number; until: number } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return { since: new Date(y, m - 1, d, 0, 0, 0, 0).valueOf(), until: new Date(y, m - 1, d + 1, 0, 0, 0, 0).valueOf() }
}

/** 缺省日期=昨天（本地） */
export function defaultReportDate(now = Date.now()): string {
  const d = new Date(now)
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

/** argv → QaArgs（零依赖手写；--flag=value ≡ --flag value） */
export function parseQaArgs(argv: readonly string[]): QaArgsResult {
  const values: Record<string, string> = {}
  let top = QA_DEFAULT_TOP
  const flags = new Set(['db', 'company', 'date', 'out-dir', 'log', 'models', 'top'])
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? ''
    const eq = token.indexOf('=')
    const key = token.startsWith('--') ? (eq >= 0 ? token.slice(2, eq) : token.slice(2)) : ''
    if (!flags.has(key)) return { ok: false, message: `未知参数：${token}（只接受 --db/--company/--date/--out-dir/--log/--models/--top）` }
    const got = nextValue(argv, i, token)
    if ('message' in got) return { ok: false, message: got.message }
    values[key] = got.value
    i = got.next
  }
  if (values['db'] === undefined) return { ok: false, message: '缺少 --db <ledger.sqlite>（只读开库，不代建）' }
  if (values['company'] === undefined || values['company'] === '') return { ok: false, message: '缺少 --company <slug>' }
  const date = values['date'] ?? defaultReportDate()
  if (!isRealDate(date)) return { ok: false, message: `坏日期：${date}（须 YYYY-MM-DD 真日历日）` }
  if (values['top'] !== undefined) {
    const n = Number(values['top'])
    if (!Number.isSafeInteger(n) || n <= 0) return { ok: false, message: `坏 --top：${values['top']}（须正整数）` }
    top = n
  }
  const db = path.resolve(values['db'])
  const outDir = values['out-dir'] !== undefined ? path.resolve(values['out-dir']) : path.join(path.dirname(db), 'var', 'reports', 'qa')
  return {
    ok: true,
    args: {
      db,
      company: values['company'],
      date,
      outDir,
      log: values['log'] !== undefined ? path.resolve(values['log']) : undefined,
      models: values['models'] !== undefined ? path.resolve(values['models']) : undefined,
      top,
    },
  }
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0)
}
function str(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

/** 只读取数（readOnly:true；任何写尝试由 SQLite 拒绝；工作记录按公司单集过滤） */
export function readQaData(dbPath: string, company: string, date: string, since: number, until: number): {
  readonly events: QaEventRow[]
  readonly work: QaWorkRow[]
  readonly usage: QaUsageRow[]
  readonly ticketCount: number
} {
  if (!existsSync(dbPath)) throw new Error(`台账不存在：${dbPath}（只读面不代建库）`)
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const eventRows = db
      .prepare('SELECT ts, issue, event, note FROM events WHERE company = ? AND ts >= ? AND ts < ? ORDER BY ts, id')
      .all(company, since, until) as Array<Record<string, unknown>>
    const events: QaEventRow[] = eventRows.map((r) => ({
      ts: num(r['ts']),
      issue: str(r['issue']),
      event: str(r['event']),
      note: r['note'] === null || r['note'] === undefined ? null : str(r['note']),
    }))
    const mirror = db.prepare('SELECT issue FROM ticket_mirror WHERE company = ?').all(company) as Array<Record<string, unknown>>
    const issues = new Set<string>(mirror.map((r) => str(r['issue'])))
    for (const e of events) issues.add(e.issue)
    const issueList = [...issues].sort()
    let work: QaWorkRow[] = []
    if (issueList.length > 0) {
      const placeholders = issueList.map(() => '?').join(',')
      const rows = db
        .prepare(
          `SELECT issue, started_at, ended_at, attempt, status, model FROM work_records WHERE started_at >= ? AND started_at < ? AND issue IN (${placeholders}) ORDER BY started_at, issue, attempt`,
        )
        .all(since, until, ...issueList) as Array<Record<string, unknown>>
      work = rows.map((r) => ({
        issue: str(r['issue']),
        started_at: num(r['started_at']),
        ended_at: r['ended_at'] === null || r['ended_at'] === undefined ? null : num(r['ended_at']),
        attempt: num(r['attempt']),
        status: str(r['status']),
        model: r['model'] === null || r['model'] === undefined ? null : str(r['model']),
      }))
    }
    const usageRows = db
      .prepare(
        'SELECT model, SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out, SUM(cache_read) AS cache_read, SUM(cache_creation) AS cache_creation FROM usage_daily WHERE company = ? AND usage_date = ? GROUP BY model ORDER BY model',
      )
      .all(company, date) as Array<Record<string, unknown>>
    const usage: QaUsageRow[] = usageRows.map((r) => ({
      model: str(r['model']),
      tokens_in: num(r['tokens_in']),
      tokens_out: num(r['tokens_out']),
      cache_read: num(r['cache_read']),
      cache_creation: num(r['cache_creation']),
    }))
    return { events, work, usage, ticketCount: issueList.length }
  } finally {
    db.close()
  }
}

/** models.yaml tiers → provider/model→tier 映射（显式 --models 才构建；一次读取） */
function tierMapOf(modelsFile: string | undefined): Map<string, QaTier> {
  const map = new Map<string, QaTier>()
  if (modelsFile === undefined) return map
  const parsed = parseModelsYaml(readFileSync(modelsFile, 'utf8'))
  for (const tier of ['high', 'mid', 'low'] as const) {
    const spec = parsed.tiers[tier]
    map.set(`${spec.provider}/${spec.model}`, tier)
  }
  return map
}

export function buildQaReport(args: QaArgs, data: { events: readonly QaEventRow[]; work: readonly QaWorkRow[]; usage: readonly QaUsageRow[]; ticketCount: number }): QaReport {
  const tiers = tierMapOf(args.models)
  const tierOf = (model: string): QaTier | null => tiers.get(model) ?? null
  return {
    schema: QA_REPORT_SCHEMA,
    reportDate: args.date,
    company: args.company,
    window: localDayWindow(args.date),
    metrics: computeQaMetrics({ ...data, tierOf, top: args.top }),
    log: args.log === undefined ? null : summarizeLog(args.log),
    observeOnly: true,
  }
}

/** 删除文件/临时件（不存在/已是目录=忽略；不掩盖原错误） */
function safeUnlink(file: string): void {
  try {
    unlinkSync(file)
  } catch {
    /* 不存在或非普通文件：清理面忽略 */
  }
}

/**
 * 生成并落盘 JSON+MD（观测产物原子面；失败=零输出且不破坏旧报告）：
 *   ① 先渲染两文本（渲染失败=零输出）；
 *   ② 写两个 tmp（任一失败→清全部 tmp，零输出）；
 *   ③ 预检 final 路径：已存在但非普通文件（如目录）→ 在动 final 前抛错（旧报告零触碰）；
 *   ④ 旧 final 先 rename 到 .bak-<pid>（保留现场）→ 依次 rename tmp→final；
 *   ⑤ rename 失败→删除本次新 final/还原 .bak/清 tmp；成功→删 .bak。
 * 覆盖写入旧报告时先备份再原子替换；失败必还原旧报告（F1 返工 2026-11-11）。
 */
export function writeQaReportFiles(args: QaArgs, report: QaReport): { jsonPath: string; mdPath: string } {
  const jsonPath = path.join(args.outDir, `qa-report-${args.date}.json`)
  const mdPath = path.join(args.outDir, `qa-report-${args.date}.md`)
  const tmpJson = `${jsonPath}.tmp-${String(process.pid)}`
  const tmpMd = `${mdPath}.tmp-${String(process.pid)}`
  const backups = new Map<string, string>()
  const renamed: string[] = []
  try {
    // ① 渲染阶段失败=零输出
    const jsonText = renderQaJson(report)
    const mdText = renderQaMarkdown(report)
    mkdirSync(args.outDir, { recursive: true })
    // ② 两个 tmp 都写好后才动 final
    writeFileSync(tmpJson, jsonText, 'utf8')
    writeFileSync(tmpMd, mdText, 'utf8')
    // ③ final 预检：已存在但非普通文件（目录等）→ 先抛错，旧报告/用户目录零触碰
    for (const file of [jsonPath, mdPath]) {
      if (existsSync(file) && !statSync(file).isFile()) throw new Error(`输出目标非普通文件：${file}（拒绝覆盖）`)
    }
    // ④ 旧 final 备份（如有）→ rename 新文件
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
      // ⑤ 回滚本次已落 final；旧报告从 .bak 还原
      for (const file of renamed) safeUnlink(file)
      for (const [file, backup] of backups) {
        if (existsSync(backup) && !existsSync(file)) renameSync(backup, file)
      }
      throw err
    }
    for (const backup of backups.values()) safeUnlink(backup)
    return { jsonPath, mdPath }
  } catch (err) {
    // 未完成事务：清 tmp；若备份已移走而 final 未还原，则还原（幂等）
    safeUnlink(tmpJson)
    safeUnlink(tmpMd)
    for (const [file, backup] of backups) {
      try {
        if (existsSync(backup) && !existsSync(file)) renameSync(backup, file)
      } catch {
        /* 还原失败不掩盖原错误（备份文件仍在，可人工恢复） */
      }
    }
    throw err
  }
}

/** `studio-next qa-report` 命令实现（错误=stderr+exit≠0；成功=stdout 摘要） */
export async function cmdQaReport(argv: string[]): Promise<number> {
  if (wantsHelp(argv)) return helpOk(SECTION['qa-report'])
  const parsed = parseQaArgs(argv)
  if (!parsed.ok) return usageFail('qa-report', parsed.message, CONCISE['qa-report'])
  const args = parsed.args
  try {
    const { since, until } = localDayWindow(args.date)
    const data = readQaData(args.db, args.company, args.date, since, until)
    const report = buildQaReport(args, data)
    const { jsonPath, mdPath } = writeQaReportFiles(args, report)
    console.log(
      `qa-report 已生成：${jsonPath} / ${mdPath}（date=${args.date} tickets=${String(report.metrics.ticketCount)} ` +
        `events=${String(report.metrics.checkedEvents)} gatePass=${String(report.metrics.counts.gatePass)} gateFail=${String(report.metrics.counts.gateFail)}）`,
    )
    return 0
  } catch (err) {
    console.error(`qa-report 失败：${errText(err)}`)
    return 2
  }
}
