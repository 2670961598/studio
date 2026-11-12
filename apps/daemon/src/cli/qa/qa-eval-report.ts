/**
 * qa-eval-report —— #811 阶段2 golden 评测纯面（当前统计类型/漂移计算/JSON+MD 渲染）
 *
 * 从 qa-eval.ts 拆出（尺寸阈 docs/20-§十五.3；行为零变更）：零 IO、纯函数可测；
 * 只读数据读取/命令/落盘在 qa-eval.ts。observe-only：drift 只作观测结论，不做门禁。
 */
import type { QaGoldenFile, QaGoldenStats, QaGoldenTicket, QaTierName } from './qa-golden.ts'
import { failureReasonOf } from '../qa-report-stats.ts'

/** 报表 schema 版本（JSON 首键；阶段2） */
export const QA_EVAL_SCHEMA = 'qa-eval/v1'

/** 评测命令参数视图形（避免 qa-eval↔report 循环依赖；结构同 QaEvalArgs 子集） */
export interface QaEvalArgsView {
  readonly date: string
  readonly company: string
  readonly top: number
}

function dayWindow(date: string): { since: number; until: number } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return { since: new Date(y, m - 1, d, 0, 0, 0, 0).valueOf(), until: new Date(y, m - 1, d + 1, 0, 0, 0, 0).valueOf() }
}

export interface QaEvalCurrentStats extends QaGoldenStats {
  readonly closedTickets: number
  readonly alarmSrcCounts: Readonly<Record<string, number>>
}

function outcomeOf(gateFails: number, qaBacks: number, stalls: number, durationMs: number | null): QaGoldenTicket['outcome'] {
  if (stalls > 0) return 'stall'
  if (qaBacks > 0) return 'qa-back'
  if (durationMs !== null && durationMs >= 30 * 60 * 1000) return 'long'
  if (gateFails > 0) return 'retry'
  return 'clean'
}

function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : Math.round(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2)
}
function p90Of(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)] as number
}

/** 从一组 ticket 生命周期事件计算评测口径统计 */
export function statsOfLifecycles(lifecycles: ReadonlyArray<{ issue: string; events: ReadonlyArray<{ ts: number; event: string; note: string | null }> }>, tierOf: (model: string) => QaTierName | null, work: ReadonlyArray<{ issue: string; model: string | null }>): QaEvalCurrentStats {
  const reasonCounts = new Map<string, number>()
  const outcomeCounts: Record<QaGoldenTicket['outcome'], number> = { clean: 0, retry: 0, 'qa-back': 0, long: 0, stall: 0 }
  const modelCounts = new Map<string, number>()
  const tierCounts: Record<QaTierName, number> = { high: 0, mid: 0, low: 0 }
  const durations: number[] = []
  let clean = 0
  let closed = 0
  for (const life of lifecycles) {
    const sorted = [...life.events].sort((a, b) => a.ts - b.ts)
    let gatePass = 0
    let gateFail = 0
    let qaBack = 0
    let stalls = 0
    let firstDispatch: number | undefined
    let closeTs: number | undefined
    for (const e of sorted) {
      if (e.event === 'DISPATCH') firstDispatch = firstDispatch === undefined ? e.ts : Math.min(firstDispatch, e.ts)
      if (e.event === 'GATE_PASS') gatePass += 1
      if (e.event === 'GATE_FAIL') {
        gateFail += 1
        const reason = failureReasonOf(e.note)
        reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1)
      }
      if (e.event === 'QA_BACK') qaBack += 1
      if (e.event === 'STALL') stalls += 1
      if (e.event === 'CLOSE') closeTs = closeTs === undefined ? e.ts : Math.max(closeTs, e.ts)
    }
    if (closeTs === undefined || gatePass === 0) continue
    closed += 1
    if (gateFail === 0) clean += 1
    const duration = firstDispatch === undefined ? null : Math.max(0, closeTs - firstDispatch)
    if (duration !== null) durations.push(duration)
    outcomeCounts[outcomeOf(gateFail, qaBack, stalls, duration)] += 1
  }
  const modelsByIssue = new Map<string, string[]>()
  for (const w of work) {
    if (w.model === null) continue
    modelsByIssue.set(w.issue, [...(modelsByIssue.get(w.issue) ?? []), w.model])
  }
  for (const life of lifecycles) {
    for (const model of modelsByIssue.get(life.issue) ?? []) {
      modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1)
      const tier = tierOf(model)
      if (tier !== null) tierCounts[tier] += 1
    }
  }
  return {
    onePassRate: closed > 0 ? clean / closed : null,
    failReasonCounts: Object.fromEntries([...reasonCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    duration: { medianMs: medianOf(durations), p90Ms: p90Of(durations) },
    modelCounts: Object.fromEntries([...modelCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    tierCounts,
    outcomeCounts,
    alarmSrcCounts: {},
    closedTickets: closed,
  }
}

/** 归一分布 + Jensen-Shannon 散度（base 2；空分布=0） */
export function jsDivergence(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  const norm = (m: Readonly<Record<string, number>>): Map<string, number> => {
    const total = [...keys].reduce((sum, k) => sum + (m[k] ?? 0), 0)
    return new Map([...keys].map((k) => [k, total > 0 ? (m[k] ?? 0) / total : 0]))
  }
  const pa = norm(a)
  const pb = norm(b)
  let jsd = 0
  for (const k of keys) {
    const x = pa.get(k) ?? 0
    const y = pb.get(k) ?? 0
    const m = (x + y) / 2
    const kl = (p: number, q: number): number => (p === 0 || q === 0 ? 0 : p * Math.log2(p / q))
    jsd += (kl(x, m) + kl(y, m)) / 2
  }
  return Number(jsd.toFixed(6))
}

function pctDelta(current: number | null, baseline: number | null): number | null {
  if (current === null || baseline === null || baseline === 0) return null
  return Number((((current - baseline) / baseline) * 100).toFixed(2))
}
function ppDelta(current: number, baseline: number): number {
  return Number(((current - baseline) * 100).toFixed(2))
}
function shareOf(counts: Readonly<Record<string, number>>, key: string): number {
  const total = Object.values(counts).reduce((s, n) => s + n, 0)
  return total > 0 ? (counts[key] ?? 0) / total : 0
}

export interface QaEvalReport {
  readonly schema: string
  readonly reportDate: string
  readonly company: string
  readonly window: { readonly since: number; readonly until: number }
  readonly observeOnly: true
  readonly baseline: {
    /** baseline 来源：golden=QA-1 人工审后 golden；qa-report=--baseline 载入的阶段1报表 */
    readonly source: 'golden' | 'qa-report'
    readonly goldenVersion: string
    readonly sha256: string
    /** qa-report baseline 的报表日（golden baseline 省略） */
    readonly reportDate?: string
    readonly generatedAt: string
    readonly builtUntil: string
    readonly sampleCount: number
    readonly cohorts: readonly { readonly key: string; readonly count: number }[]
  }
  readonly current: Omit<QaEvalCurrentStats, 'alarmSrcCounts'> & {
    readonly checkedEvents: number
    readonly alarmSrcCounts: readonly { readonly src: string; readonly count: number }[]
  }
  readonly drift: {
    readonly onePassRate: { readonly baseline: number | null; readonly current: number | null; readonly deltaPp: number | null }
    readonly failReasons: { readonly jsd: number; readonly top: ReadonlyArray<{ readonly reason: string; readonly baseline: number; readonly current: number; readonly deltaPp: number }> }
    readonly duration: { readonly medianDeltaPct: number | null; readonly p90DeltaPct: number | null }
    readonly tierShare: Readonly<Record<QaTierName, { readonly baseline: number; readonly current: number; readonly deltaPp: number }>>
    readonly outcomes: Readonly<Record<string, { readonly baseline: number; readonly current: number; readonly deltaPp: number }>>
  }
  readonly coverage: { readonly goldenTickets: number; readonly matchedInWindow: number; readonly missing: readonly string[] }
  readonly tickets: ReadonlyArray<{ readonly ticket: string; readonly expected: string; readonly actual: string; readonly status: 'match' | 'drift' | 'not-in-window' }>
  readonly verdict: 'observe-only'
}

export function buildEvalReport(input: {
  readonly args: QaEvalArgsView
  readonly golden: { golden: QaGoldenFile; sha256: string }
  readonly current: QaEvalCurrentStats
  readonly checkedEvents: number
  readonly alarmSrcCounts: ReadonlyArray<{ src: string; count: number }>
  readonly windowIssues: ReadonlySet<string>
  readonly ticketActual: ReadonlyMap<string, string>
  /** --baseline qa-report.json：drift 用其窗口指标替代 golden 基线（golden 仍供 coverage/逐单） */
  readonly baselineOverride?: { readonly stats: QaGoldenStats; readonly reportDate: string; readonly sha256: string } | undefined
}): QaEvalReport {
  const { golden } = input.golden
  const base = input.baselineOverride?.stats ?? golden.stats
  const current = input.current
  const currentReasons = current.failReasonCounts
  const top = [...new Set([...Object.keys(base.failReasonCounts), ...Object.keys(currentReasons)])]
    .map((reason) => {
      const b = shareOf(base.failReasonCounts, reason) * 100
      const c = shareOf(currentReasons, reason) * 100
      return { reason, baseline: Number(b.toFixed(2)), current: Number(c.toFixed(2)), deltaPp: Number((c - b).toFixed(2)) }
    })
    .sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp) || a.reason.localeCompare(b.reason))
    .slice(0, input.args.top)
  const tierShare = {} as Record<QaTierName, { baseline: number; current: number; deltaPp: number }>
  for (const tier of ['high', 'mid', 'low'] as const) {
    const b = shareOf(base.tierCounts, tier)
    const c = shareOf(current.tierCounts, tier)
    tierShare[tier] = { baseline: Number((b * 100).toFixed(2)), current: Number((c * 100).toFixed(2)), deltaPp: ppDelta(c, b) }
  }
  const outcomes: Record<string, { baseline: number; current: number; deltaPp: number }> = {}
  for (const key of ['clean', 'retry', 'qa-back', 'long', 'stall'] as const) {
    const b = shareOf(base.outcomeCounts, key)
    const c = shareOf(current.outcomeCounts, key)
    outcomes[key] = { baseline: Number((b * 100).toFixed(2)), current: Number((c * 100).toFixed(2)), deltaPp: ppDelta(c, b) }
  }
  const matched = golden.tickets.filter((t) => input.windowIssues.has(t.ticket))
  const missing = golden.tickets.filter((t) => !input.windowIssues.has(t.ticket)).map((t) => t.ticket)
  const tickets = golden.tickets.map((t) => {
    const actual = input.ticketActual.get(t.ticket)
    if (actual === undefined) return { ticket: t.ticket, expected: t.outcome, actual: 'not-in-window', status: 'not-in-window' as const }
    return { ticket: t.ticket, expected: t.outcome, actual, status: actual === t.outcome ? ('match' as const) : ('drift' as const) }
  })
  return {
    schema: QA_EVAL_SCHEMA,
    reportDate: input.args.date,
    company: input.args.company,
    window: dayWindow(input.args.date),
    observeOnly: true,
    baseline: {
      source: input.baselineOverride === undefined ? 'golden' : 'qa-report',
      goldenVersion: golden.version,
      sha256: input.baselineOverride?.sha256 ?? input.golden.sha256,
      generatedAt: golden.generatedAt,
      builtUntil: input.baselineOverride?.reportDate ?? golden.selection.builtUntil,
      sampleCount: golden.tickets.length,
      cohorts: golden.cohorts,
      ...(input.baselineOverride !== undefined ? { reportDate: input.baselineOverride.reportDate } : {}),
    },
    current: { ...current, checkedEvents: input.checkedEvents, alarmSrcCounts: input.alarmSrcCounts },
    drift: {
      onePassRate: {
        baseline: base.onePassRate,
        current: current.onePassRate,
        deltaPp: base.onePassRate === null || current.onePassRate === null ? null : ppDelta(current.onePassRate, base.onePassRate),
      },
      failReasons: { jsd: jsDivergence(base.failReasonCounts, currentReasons), top },
      duration: {
        medianDeltaPct: pctDelta(current.duration.medianMs, base.duration.medianMs),
        p90DeltaPct: pctDelta(current.duration.p90Ms, base.duration.p90Ms),
      },
      tierShare,
      outcomes,
    },
    coverage: { goldenTickets: golden.tickets.length, matchedInWindow: matched.length, missing: missing.slice(0, 20) },
    tickets,
    verdict: 'observe-only',
  }
}

export function renderEvalJson(report: QaEvalReport): string {
  return `${JSON.stringify(report, null, 2)}
`
}
export function renderEvalMarkdown(report: QaEvalReport): string {
  const d = report.drift
  const lines: string[] = [
    `# QA golden 评测 · ${report.reportDate} · ${report.company}`,
    '',
    `> **结论先行（observe-only，不阻断）**：baseline=${report.baseline.source === 'qa-report' ? `qa-report@${report.baseline.reportDate ?? '-'}` : report.baseline.goldenVersion}（截至 ${report.baseline.builtUntil}，样本 ${String(report.baseline.sampleCount)}）；` +
      `coverage=${String(report.coverage.matchedInWindow)}/${String(report.coverage.goldenTickets)}；` +
      `onePass≈${d.onePassRate.current === null ? '-' : `${(d.onePassRate.current * 100).toFixed(1)}%`}（baseline ${d.onePassRate.baseline === null ? '-' : `${(d.onePassRate.baseline * 100).toFixed(1)}%`}，Δ${d.onePassRate.deltaPp === null ? '-' : `${d.onePassRate.deltaPp.toFixed(1)}pp`}）；` +
      `fail JSD=${String(d.failReasons.jsd)}；median Δ${d.duration.medianDeltaPct === null ? '-' : `${String(d.duration.medianDeltaPct)}%`}。`,
    '',
    '## 初报（当日窗口）',
    '',
    `closedTickets=${String(report.current.closedTickets)} checkedEvents=${String(report.current.checkedEvents)}；` +
      `onePassRate=${report.current.onePassRate === null ? '-' : `${(report.current.onePassRate * 100).toFixed(1)}%`}；` +
      `medianMs=${report.current.duration.medianMs ?? '-'} p90Ms=${report.current.duration.p90Ms ?? '-'}`,
    '',
    '## 漂移（baseline 日/样本见上；只观测）',
    '',
    '| 指标 | baseline | current | Δ |',
    '| --- | ---: | ---: | ---: |',
    `| onePassRate | ${report.baseline.goldenVersion} | ${report.current.onePassRate === null ? '-' : (report.current.onePassRate * 100).toFixed(2) + '%'} | ${d.onePassRate.deltaPp === null ? '-' : d.onePassRate.deltaPp + 'pp'} |`,
    `| fail reasons JSD | - | - | ${String(d.failReasons.jsd)} |`,
    `| duration median | - | - | ${d.duration.medianDeltaPct === null ? '-' : d.duration.medianDeltaPct + '%'} |`,
    `| duration p90 | - | - | ${d.duration.p90DeltaPct === null ? '-' : d.duration.p90DeltaPct + '%'} |`,
    ...(['high', 'mid', 'low'] as const).map((t) => `| tier ${t} share | ${String(d.tierShare[t].baseline)}% | ${String(d.tierShare[t].current)}% | ${String(d.tierShare[t].deltaPp)}pp |`),
    '',
    '失败原因 top 漂移：',
    ...(d.failReasons.top.length > 0 ? d.failReasons.top.map((r) => `- ${r.reason}: ${String(r.baseline)}% → ${String(r.current)}%（Δ${String(r.deltaPp)}pp）`) : ['- （无失败原因）']),
    '',
    '## 逐 golden 单 expected vs actual（窗口内可见者）',
    '',
    ...(report.tickets.some((t) => t.status !== 'not-in-window')
      ? report.tickets.filter((t) => t.status !== 'not-in-window').map((t) => `- ${t.ticket}: expected=${t.expected} actual=${t.actual} → ${t.status}`)
      : ['- 本窗口无 golden 单可见（coverage 0；observe-only 不判回归）']),
    '',
    `coverage=${String(report.coverage.matchedInWindow)}/${String(report.coverage.goldenTickets)}；missing（前 20）=${report.coverage.missing.join(',') || '-'}`,
    '',
    `> 口径/版本/人工审流程：docs/quality/golden.md；阶段1 指标：docs/quality/README.md；台账事实源：docs/17-§3。`,
    '',
  ]
  return lines.join('\n')
}

