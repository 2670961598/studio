/**
 * qa-report-stats —— #811 阶段 1 QA 报表纯统计/渲染面（observe-only）
 *
 * 从 qa-report.ts 拆出（尺寸阈 docs/20-§十五.3；行为零变更）：指标类型/纯统计/日志 tail 摘要/
 * JSON+Markdown 渲染。数据读取在 qa-report.ts（node:sqlite readOnly），本件零台账 IO。
 * 指标定义/口径：docs/quality/README.md；台账事实源：docs/17-§3。
 */
import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs'

/** 报表 schema 版本（JSON 首键；后续阶段可 bump） */
export const QA_REPORT_SCHEMA = 'qa-report/v1'
/** 日志 tail 读取上限（字节；daemon.log 可能很大，只读尾部） */
export const QA_LOG_TAIL_BYTES = 4 * 1024 * 1024

export interface QaEventRow {
  readonly ts: number
  readonly issue: string
  readonly event: string
  readonly note: string | null
}
export interface QaWorkRow {
  readonly issue: string
  readonly started_at: number
  readonly ended_at: number | null
  readonly attempt: number
  readonly status: string
  readonly model: string | null
}
export interface QaUsageRow {
  readonly model: string
  readonly tokens_in: number
  readonly tokens_out: number
  readonly cache_read: number
  readonly cache_creation: number
}


// ————————————————————————— 纯统计面 —————————————————————————

export type QaTier = 'high' | 'mid' | 'low'

export interface QaEventCounts {
  readonly gatePass: number
  readonly gateFail: number
  readonly stall: number
  readonly jobStale: number
  readonly escalate: number
  readonly close: number
  readonly qaPass: number
  readonly qaBack: number
  readonly dispatch: number
  readonly merge: number
  readonly dailyAlarm: number
}
export interface QaFailureRow {
  readonly reason: string
  readonly count: number
}
export interface QaModelRow {
  readonly model: string
  readonly tier: QaTier | null
  readonly workRecords: number
  readonly tokens: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheCreation: number }
}
export interface QaDurationStats {
  readonly tickets: number
  readonly attempts: number
  readonly inFlight: number
  readonly medianMs: number | null
  readonly p90Ms: number | null
}
export interface QaLogSummary {
  readonly asOf: string
  readonly window: 'tail'
  readonly linesScanned: number
  readonly loopLag: { readonly count: number; readonly maxMs: number; readonly medianMs: number; readonly maxSeq: number }
  readonly noop: { readonly aggregateLines: number; readonly decisionLines: number; readonly decisions: number }
}
export interface QaMetrics {
  readonly checkedEvents: number
  readonly ticketCount: number
  readonly counts: QaEventCounts
  readonly dailyAlarmsBySrc: ReadonlyArray<{ readonly src: string; readonly count: number }>
  readonly failures: { readonly total: number; readonly top: readonly QaFailureRow[] }
  readonly models: { readonly rows: readonly QaModelRow[]; readonly tierCounts: Readonly<Record<QaTier, number>> }
  readonly durations: QaDurationStats
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : Math.round(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2)
}

function p90(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)] as number
}

/** 失败原因归一：priority `category=…`，否则取 note 首段（去 src/分号） */
export function failureReasonOf(note: string | null): string {
  if (note === null || note.trim() === '') return 'no-note'
  const category = /\bcategory=([^;\s]+)/.exec(note)?.[1]
  if (category !== undefined) return category
  const first = note.split(/[;；]/)[0]?.trim() ?? ''
  const src = /src=([^;\s]+)/.exec(first)?.[1]
  return (src ?? first).slice(0, 80) || 'no-note'
}

export function computeQaMetrics(input: {
  readonly events: readonly QaEventRow[]
  readonly work: readonly QaWorkRow[]
  readonly usage: readonly QaUsageRow[]
  readonly ticketCount: number
  readonly tierOf: (model: string) => QaTier | null
  readonly top: number
}): QaMetrics {
  const countOf = (name: string): number => input.events.filter((e) => e.event === name).length
  const counts: QaEventCounts = {
    gatePass: countOf('GATE_PASS'),
    gateFail: countOf('GATE_FAIL'),
    stall: countOf('STALL'),
    jobStale: countOf('JOB_STALE'),
    escalate: countOf('ESCALATE'),
    close: countOf('CLOSE'),
    qaPass: countOf('QA_PASS'),
    qaBack: countOf('QA_BACK'),
    dispatch: countOf('DISPATCH'),
    merge: countOf('MERGE'),
    dailyAlarm: countOf('DAILY_ALARM'),
  }
  const alarmSrc = new Map<string, number>()
  for (const e of input.events) {
    if (e.event !== 'DAILY_ALARM') continue
    const src = /(?:^|;)src=([^;\s]+)/.exec(e.note ?? '')?.[1] ?? 'unknown'
    alarmSrc.set(src, (alarmSrc.get(src) ?? 0) + 1)
  }
  const dailyAlarmsBySrc = [...alarmSrc.entries()].map(([src, count]) => ({ src, count })).sort((a, b) => b.count - a.count || a.src.localeCompare(b.src))

  const failure = new Map<string, number>()
  for (const e of input.events) {
    if (e.event !== 'GATE_FAIL') continue
    const reason = failureReasonOf(e.note)
    failure.set(reason, (failure.get(reason) ?? 0) + 1)
  }
  const topFailures = [...failure.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, input.top)

  const workByModel = new Map<string, number>()
  for (const w of input.work) {
    const model = w.model ?? 'unknown'
    workByModel.set(model, (workByModel.get(model) ?? 0) + 1)
  }
  const usageByModel = new Map<string, { input: number; output: number; cacheRead: number; cacheCreation: number }>()
  for (const u of input.usage) {
    const cur = usageByModel.get(u.model) ?? { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
    cur.input += u.tokens_in
    cur.output += u.tokens_out
    cur.cacheRead += u.cache_read
    cur.cacheCreation += u.cache_creation
    usageByModel.set(u.model, cur)
  }
  const allModels = new Set<string>([...workByModel.keys(), ...usageByModel.keys()])
  const rows: QaModelRow[] = [...allModels].sort().map((model) => {
    const tokens = usageByModel.get(model) ?? { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
    return { model, tier: model === 'unknown' ? null : input.tierOf(model), workRecords: workByModel.get(model) ?? 0, tokens }
  })
  const tierCounts: Record<QaTier, number> = { high: 0, mid: 0, low: 0 }
  for (const row of rows) {
    if (row.tier !== null && row.workRecords > 0) tierCounts[row.tier] += row.workRecords
  }

  const byIssue = new Map<string, { starts: number[]; ends: number[]; attempts: number; inFlight: boolean }>()
  for (const w of input.work) {
    const cur = byIssue.get(w.issue) ?? { starts: [], ends: [], attempts: 0, inFlight: false }
    cur.starts.push(w.started_at)
    cur.attempts += 1
    if (w.ended_at === null) cur.inFlight = true
    else cur.ends.push(w.ended_at)
    byIssue.set(w.issue, cur)
  }
  const durations: number[] = []
  for (const cur of byIssue.values()) {
    if (cur.ends.length === 0) continue
    const start = Math.min(...cur.starts)
    const end = Math.max(...cur.ends)
    if (end >= start) durations.push(end - start)
  }
  const attempts = input.work.length
  const inFlight = [...byIssue.values()].filter((v) => v.inFlight).length
  return {
    checkedEvents: input.events.length,
    ticketCount: input.ticketCount,
    counts,
    dailyAlarmsBySrc,
    failures: { total: input.events.filter((e) => e.event === 'GATE_FAIL').length, top: topFailures },
    models: { rows, tierCounts },
    durations: { tickets: byIssue.size, attempts, inFlight, medianMs: median(durations), p90Ms: p90(durations) },
  }
}

/** 报表体（JSON schema 形状；observeOnly 恒 true 表明非门禁产物） */
export interface QaReport {
  readonly schema: string
  readonly reportDate: string
  readonly company: string
  readonly window: { readonly since: number; readonly until: number }
  readonly metrics: QaMetrics
  readonly log: QaLogSummary | null
  readonly observeOnly: true
}

// ————————————————————————— 日志 tail 摘要（可选，不参与日期对比） —————————————————————————

/** 读日志尾部 N 字节；从首个换行后切齐（避免半行） */
function readTail(file: string): { text: string; asOf: string } {
  if (!existsSync(file)) throw new Error(`日志不存在：${file}`)
  const stat = statSync(file)
  const size = stat.size
  const start = Math.max(0, size - QA_LOG_TAIL_BYTES)
  const fd = openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(size - start)
    readSync(fd, buffer, 0, buffer.length, start)
    let text = buffer.toString('utf8')
    if (start > 0) {
      const nl = text.indexOf('\n')
      text = nl >= 0 ? text.slice(nl + 1) : ''
    }
    return { text, asOf: new Date(stat.mtimeMs).toISOString() }
  } finally {
    closeSync(fd)
  }
}

/** tail 日志摘要：loop-lag 行 + noop 行（asOf/window 明确，不参与日期对比） */
export function summarizeLog(file: string): QaLogSummary {
  const { text, asOf } = readTail(file)
  const lines = text.split('\n').filter((line) => line !== '')
  const lags: number[] = []
  let maxSeq = 0
  let aggregateLines = 0
  let decisionLines = 0
  let decisions = 0
  for (const line of lines) {
    const lag = /\[loop-lag\] lagMs=(\d+) seq=(\d+)/.exec(line)
    if (lag !== null) {
      lags.push(Number(lag[1]))
      maxSeq = Math.max(maxSeq, Number(lag[2]))
    }
    if (/\[serve\] tick#\d+ noop聚合：/.test(line)) {
      aggregateLines += 1
      decisions += Number(/count=(\d+)/.exec(line)?.[1] ?? 0)
    } else if (/\[serve\] tick#\d+ noop：/.test(line)) {
      decisionLines += 1
      decisions += 1
    }
  }
  return {
    asOf,
    window: 'tail',
    linesScanned: lines.length,
    loopLag: { count: lags.length, maxMs: lags.length > 0 ? Math.max(...lags) : 0, medianMs: median(lags) ?? 0, maxSeq },
    noop: { aggregateLines, decisionLines, decisions },
  }
}

export function renderQaJson(report: QaReport): string {
  return `${JSON.stringify(report, null, 2)}\n`
}

export function renderQaMarkdown(report: QaReport): string {
  const m = report.metrics
  const lines: string[] = [
    `# QA 指标报表 · ${report.reportDate} · ${report.company}`,
    '',
    `> observe-only（不写台账/不改单据/不做门禁；数据源=本仓只读台账；schema=${report.schema}）`,
    '',
    '## 事件计数',
    '',
    '| 指标 | 值 |',
    '| --- | ---: |',
    `| GATE_PASS | ${String(m.counts.gatePass)} |`,
    `| GATE_FAIL | ${String(m.counts.gateFail)} |`,
    `| STALL | ${String(m.counts.stall)} |`,
    `| JOB_STALE | ${String(m.counts.jobStale)} |`,
    `| ESCALATE | ${String(m.counts.escalate)} |`,
    `| CLOSE | ${String(m.counts.close)} |`,
    `| QA_PASS / QA_BACK | ${String(m.counts.qaPass)} / ${String(m.counts.qaBack)} |`,
    `| DISPATCH / MERGE | ${String(m.counts.dispatch)} / ${String(m.counts.merge)} |`,
    `| DAILY_ALARM | ${String(m.counts.dailyAlarm)} |`,
    '',
    '## 失败原因 top-' + String(m.failures.top.length),
    '',
    '| 原因 | 次数 |',
    '| --- | ---: |',
    ...(m.failures.top.length > 0 ? m.failures.top.map((f) => `| ${f.reason} | ${String(f.count)} |`) : ['| （无 GATE_FAIL） | 0 |']),
    '',
    '## 模型分布（work_records 窗口 / usage_daily 当日）',
    '',
    '| model | tier | work_records | input | output | cache_read | cache_creation |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...(m.models.rows.length > 0
      ? m.models.rows.map((r) => `| ${r.model} | ${r.tier ?? '-'} | ${String(r.workRecords)} | ${String(r.tokens.input)} | ${String(r.tokens.output)} | ${String(r.tokens.cacheRead)} | ${String(r.tokens.cacheCreation)} |`)
      : ['| （无数据） | - | 0 | 0 | 0 | 0 | 0 |']),
    '',
    `tier work_records：high=${String(m.models.tierCounts.high)} / mid=${String(m.models.tierCounts.mid)} / low=${String(m.models.tierCounts.low)}（未给 --models 时 tier=-）`,
    '',
    '## 单耗时',
    '',
    `tickets=${String(m.durations.tickets)} attempts=${String(m.durations.attempts)} inFlight=${String(m.durations.inFlight)} ` +
      `medianMs=${m.durations.medianMs === null ? '-' : String(m.durations.medianMs)} p90Ms=${m.durations.p90Ms === null ? '-' : String(m.durations.p90Ms)}`,
    '',
    '## 日志 tail 摘要（noop/loop-lag，不参与日期对比）',
    '',
    ...(report.log === null
      ? ['未提供 --log：null']
      : [
          `asOf=${report.log.asOf} window=${report.log.window} lines=${String(report.log.linesScanned)}`,
          `loop-lag：count=${String(report.log.loopLag.count)} maxMs=${String(report.log.loopLag.maxMs)} medianMs=${String(report.log.loopLag.medianMs)} maxSeq=${String(report.log.loopLag.maxSeq)}`,
          `noop：aggregateLines=${String(report.log.noop.aggregateLines)} decisionLines=${String(report.log.noop.decisionLines)} decisions=${String(report.log.noop.decisions)}`,
        ]),
    '',
    `窗口：since=${String(report.window.since)} until=${String(report.window.until)}（本地自然日）；ticketCount=${String(m.ticketCount)} checkedEvents=${String(m.checkedEvents)}`,
    '',
    '> 指标定义/口径：docs/quality/README.md；台账事实源：docs/17-§3。',
    '',
  ]
  return lines.join('\n')
}

