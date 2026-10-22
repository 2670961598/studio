/**
 * cost-close —— 定型面日终收口工序（132-§6.3 单D·studio-dev-179；体分离自 engine.ts，
 * pricing/hrsync 同款关注点分离——引擎只留相位 7 尾缝）
 *
 * 工序语义（132-§6.0 时间线：19:55 本地收 D-1；20:00 hf-finance-daily 读 cost_daily+
 * 对账段产财务日报——本工序是其上游锚）：
 *   - 时刻闸：本地 ≥19:55 首拍进工序（COST_CLOSE_HOUR/MINUTE，core 常量）；
 *   - kv 幂等锚（R3 冻结键 'cost_close_last_date'）：无锚=冷启动只收 D-1（有界——
 *     历史回填是显式重建工序，不属本工序）；有锚=按日顺延收 kv+1..D-1（崩溃追平，
 *     每收完一日 kv 前进一日——半途崩下一拍续收，不重不漏）；
 *   - 零用量日照收（rows=0 事件+kv 前进）——给 20:00 岗一个诚实的每日锚；
 *   - 每格首冻：planCostCells（快照 exact/carry→models.yaml 桥→unpriced 三路）→
 *     appendCostDaily final；重入收敛（崩溃重放：已有 final 的格跳过——usage 未变=
 *     同参无行；usage 变了=巡检补账面接住，不楔死追平循环）；
 *   - 巡检（收口拍尾，对全部已收口日期 ≤D-1）：sweepClosedDate 比对已冻 Σ vs 现在
 *     应有真值 → Δ≠0 补 signed adjustment（S3 迟到事实/数据修复）；迟到新格（收口时
 *     无用量、重建后补出）补 final 行——每行首冻语义的自然延伸，partial UNIQUE 仍
 *     拒同格第二 final（申报：plan.md §语义申报）；
 *   - 降级不静默：bridge（models-yaml 收口）/unpriced（usd=0 下界收口）/stale 沿用
 *     任一非零 → DAILY_ALARM（挂心跳哨兵单）+事件 note 计数（DEV-19：不静默不编造）；
 *   - 对账段：Σcost_daily(X) vs ΣGATE_PASS(X)（本地日界，note 解析模型分拆；|Δ|>
 *     RECON_EPS_USD 注因——两账异源：收口时刻 vs 收割时刻的快照版本/沿用天窗）；
 *   - 报告落盘：<companyDir>/reports/综合部/cost-close/cost-close-<X>.json
 *     （caliber 'cost-close/v1'）+ insertReport 快照行（node=company 公司级日报面）。
 *     companyDir 未注入=面未开（零文件行为，事件仍落——账与事件是权威源）。
 *
 * 事件词表（EVENT_NAME_PREFIX_PATTERN 合规）：REPORT_COST_CLOSE（REPORT_ 族新增
 * 生产者，零契约变更）+ DAILY_ALARM（既有名）。
 *
 * 顺序与崩溃窗（申报）：行 → kv → 事件 → 报告文件。kv 前进后崩=该日文件缺席
 * （cost_daily 行与事件是权威账；文件=派生视图，可由重建工序重生成）——不倒序
 * （先文件后 kv=半途崩产生「有文件无账」的伪影，比「有账无文件」危害大）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { EventRecord, IssueRecord, ModelTier } from '@studio-next/contract'
import {
  ADJUSTMENT_MERGE_USD,
  COST_CLOSE_HOUR,
  COST_CLOSE_KV_KEY,
  COST_CLOSE_MINUTE,
  buildCostCloseReport,
  costInsights,
  planCostCells,
  reconcileDate,
  sweepClosedDate,
  type CostCellPlan,
  type CostInsight,
  type ReconSegment,
} from '@studio-next/core'
import type { Ledger, PriceSnapshotRecord } from '@studio-next/store'

/** 常量再出口（消费面/测试就近引用——定义冻结在 core costclose.ts） */
export { COST_CLOSE_KV_KEY, COST_CLOSE_HOUR, COST_CLOSE_MINUTE } from '@studio-next/core'

/** 事件 note 溯源前缀（幂等键语源；docs/22-§三.2 sla-timer 同型） */
const CLOSE_NOTE_PREFIX = 'src=cost-close;'
const ADJUST_NOTE_PREFIX = 'src=cost-adjust;'

/** 本地日串 'YYYY-MM-DD'（本地字段直取——pricing.ts 同口径） */
function localDateString(ms: number): string {
  const d = new Date(ms)
  const pad = (v: number): string => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 日串 +n 日（纯日历算术：UTC 锚加减，跨 DST 无漂移——串面无时区） */
function dateAddDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const ms = Date.UTC(y, m - 1, d) + n * 86_400_000
  const nd = new Date(ms)
  const pad = (v: number): string => String(v).padStart(2, '0')
  return `${nd.getUTCFullYear()}-${pad(nd.getUTCMonth() + 1)}-${pad(nd.getUTCDate())}`
}

/** 串比日（字典序即日历序——'YYYY-MM-DD' 定长） */
function dateLt(a: string, b: string): boolean {
  return a < b
}

/** 本地日起点 ms（对账段日界：GATE_PASS ts 落本地日 X 的窗） */
function localDayStart(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
}

/** note 截断（events.note 面板可读性） */
function brief(text: string, max = 200): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max)}…` : one
}

function errBrief(err: unknown): string {
  if (err instanceof Error) {
    const sub = (err as { subcause?: string }).subcause
    return sub !== undefined ? `${sub}：${brief(err.message)}` : brief(err.message)
  }
  return brief(String(err))
}

/** 收口工序步依赖（engine 相位 7 尾缝全量） */
export interface CostCloseDeps {
  ledger: Ledger
  company: string
  /** 公司目录未注入=报告面未开（零文件行为；账与事件照落） */
  companyDir?: string | undefined
  /** models.yaml 三档（catalog 注入时）——桥/声明面缺格判定 */
  tiers?: readonly ModelTier[] | undefined
  now(): number
  makeId(ts: number): string
  /** REPORT_COST_CLOSE 事件（挂心跳哨兵单——engine 闭包） */
  emitReport(note: string): void
  /** DAILY_ALARM（挂心跳哨兵单） */
  emitAlarm(note: string): void
  onError(message: string): void
  /** 变更台账回调（行+告警+事件合计——engine 本拍 mutations 台账；缺省=不回调） */
  bumpMutations?: (count: number) => void
}

export interface CostCloseTickReport {
  /** 工序归属本地日（未到 19:55=ran:false 同日返回） */
  date: string
  /** 本拍是否进工序（时刻闸过+kv 待收非空） */
  ran: boolean
  /** 本次收口的日期（追平可多日，旧→新） */
  closedDates: readonly string[]
  /** 本次首冻 final 行数（含迟到新格） */
  finalRows: number
  /** 本次补账 adjustment 行数（S3） */
  adjustmentRows: number
  /** 降级告警数（bridge/unpriced/stale——不静默） */
  alarms: number
  /** 收口事件数（REPORT_COST_CLOSE） */
  reportEvents: number
  /** 变更合计（行+告警+事件——engine mutations 口径） */
  mutations: number
}

/** 引擎缝依赖注入（engine.ts 一行缝——闭包在此组装，pricing seam 同法） */
export interface CostCloseEngineSeam {
  ledger: Ledger
  config: { company: string; companyDir?: string | undefined; heartbeatIssue: string; deptFallback: string }
  tiers?: readonly ModelTier[] | undefined
  now(): number
  makeId(ts: number): string
  makeEvent(
    name: EventRecord['event'],
    issue: IssueRecord,
    attempt: number,
    sink: EventRecord[],
    extra?: { note?: string },
  ): EventRecord
  heartbeatSentinelRecord(heartbeatIssue: string, deptFallback: string, at: number): IssueRecord
  tickEvents: EventRecord[]
  errors: string[]
  bumpMutations?: (count: number) => void
}

export function costCloseDeps(seam: CostCloseEngineSeam): CostCloseDeps {
  return {
    ledger: seam.ledger,
    company: seam.config.company,
    companyDir: seam.config.companyDir,
    tiers: seam.tiers,
    now: seam.now,
    makeId: seam.makeId,
    emitReport: (note) => {
      seam.makeEvent('REPORT_COST_CLOSE', seam.heartbeatSentinelRecord(seam.config.heartbeatIssue, seam.config.deptFallback, seam.now()), 1, seam.tickEvents, { note })
    },
    emitAlarm: (note) => {
      seam.makeEvent('DAILY_ALARM', seam.heartbeatSentinelRecord(seam.config.heartbeatIssue, seam.config.deptFallback, seam.now()), 1, seam.tickEvents, { note })
    },
    onError: (message) => seam.errors.push(message),
    ...(seam.bumpMutations !== undefined ? { bumpMutations: seam.bumpMutations } : {}),
  }
}

/** 单格计划 → store final 行（closed_by=工序锚串；basis 恒 shadow 三路皆折算） */
function appendFinal(deps: CostCloseDeps, plan: CostCellPlan, date: string, at: number, kind: 'final' | 'new-final', note?: string): void {
  deps.ledger.appendCostDaily({
    id: deps.makeId(at),
    company: deps.company,
    person_id: plan.person_id,
    model: plan.model,
    cost_date: date,
    tokens: plan.tokens,
    price_snapshot_id: plan.priceSnapshotId,
    cost_usd: plan.usd,
    kind: 'final',
    closed_at: at,
    closed_by: kind === 'final' ? `cost-close:${date}` : `cost-adjust:${date}`,
    ...(note !== undefined ? { note } : {}),
  })
}

/**
 * 日终收口工序（相位 7 尾；一天至多一收拍——kv 前进即本日收讫）。
 * 失败语义：收口日 X 半途异常 → 告警+onError+当拍止（kv 不前进——下一拍重入收敛：
 * 已冻格跳过，缺口补齐；巡检接住 usage 漂移）。
 */
export function runCostCloseTick(deps: CostCloseDeps): CostCloseTickReport {
  const at = deps.now()
  const today = localDateString(at)
  const report: CostCloseTickReport = { date: today, ran: false, closedDates: [], finalRows: 0, adjustmentRows: 0, alarms: 0, reportEvents: 0, mutations: 0 }
  const d = new Date(at)
  if (d.getHours() < COST_CLOSE_HOUR || (d.getHours() === COST_CLOSE_HOUR && d.getMinutes() < COST_CLOSE_MINUTE)) return report
  const yesterday = dateAddDays(today, -1)
  const kv = deps.ledger.kvGet(COST_CLOSE_KV_KEY)
  let datesToClose: string[]
  if (kv === null) {
    datesToClose = [yesterday] // 冷启动有界：只收 D-1（回填=显式重建工序）
  } else if (!dateLt(kv, yesterday)) {
    return report // 已收讫（kv ≥ D-1）——巡检随收口拍走，本拍无事
  } else {
    datesToClose = []
    for (let cur = dateAddDays(kv, 1); dateLt(cur, yesterday) || cur === yesterday; cur = dateAddDays(cur, 1)) datesToClose.push(cur)
  }
  report.ran = true
  const snapshots: PriceSnapshotRecord[] = deps.ledger.listPriceSnapshots({ company: deps.company })
  const closed: string[] = []
  for (const x of datesToClose) {
    try {
      const closedInfo = closeDate(deps, x, at, snapshots)
      closed.push(x)
      report.finalRows += closedInfo.finalRows
      report.alarms += closedInfo.alarms
      report.reportEvents += 1
    } catch (err) {
      const msg = errBrief(err)
      deps.onError(`日终收口失败 ${x}：${msg}`)
      deps.emitAlarm(`${CLOSE_NOTE_PREFIX}date=${x};error=${brief(msg, 120)}`)
      report.alarms += 1
      break // kv 未前进——下一拍重入收敛
    }
  }
  report.closedDates = closed
  if (closed.length > 0) {
    try {
      report.adjustmentRows += patrolClosedDates(deps, at, yesterday, snapshots)
    } catch (err) {
      const msg = errBrief(err)
      deps.onError(`收口巡检失败：${msg}`)
      deps.emitAlarm(`${ADJUST_NOTE_PREFIX}date=${today};error=${brief(msg, 120)}`)
      report.alarms += 1
    }
  }
  report.mutations = report.finalRows + report.adjustmentRows + report.alarms + report.reportEvents
  if (report.ran) deps.bumpMutations?.(report.mutations)
  return report
}

/** 单日收口：折算→首冻（重入跳过已冻格）→kv 前进→降级告警→事件→报告文件 */
function closeDate(deps: CostCloseDeps, x: string, at: number, snapshots: readonly PriceSnapshotRecord[]): { finalRows: number; alarms: number } {
  const usage = deps.ledger.listUsageDaily({ company: deps.company, usage_date: x })
  const plans = planCostCells(usage, snapshots, deps.tiers ?? [], x)
  // 重入收敛：崩溃重放时已冻格跳过（同参无行；usage 漂移由巡检补账面接住）
  const frozenKeys = new Set(
    deps.ledger.listCostDaily({ company: deps.company, cost_date: x, kind: 'final' }).map((r) => `${r.person_id}\u0000${r.model}`),
  )
  let finalRows = 0
  for (const plan of plans) {
    if (frozenKeys.has(`${plan.person_id}\u0000${plan.model}`)) continue
    appendFinal(deps, plan, x, at, 'final')
    finalRows += 1
  }
  deps.ledger.kvSet(COST_CLOSE_KV_KEY, x) // 每收完一日 kv 前进一日（崩溃追平锚）
  // 降级不静默：stale 沿用 / models-yaml 桥 / 无价（DEV-19）
  const staleCount = plans.filter((p) => p.priceBasis === 'snapshot' && !p.exact && p.staleDays > 0).length
  const bridgeCount = plans.filter((p) => p.priceBasis === 'models-yaml').length
  const unpricedCount = plans.filter((p) => p.priceBasis === 'unpriced').length
  let alarms = 0
  if (staleCount + bridgeCount + unpricedCount > 0) {
    deps.emitAlarm(`${CLOSE_NOTE_PREFIX}date=${x};degraded=stale:${String(staleCount)},bridge:${String(bridgeCount)},unpriced:${String(unpricedCount)}（不静默：沿用/桥/无价收口，详见报告注因段）`)
    alarms += 1
  }
  const usd = plans.reduce((s, p) => s + p.usd, 0)
  deps.emitReport(`${CLOSE_NOTE_PREFIX}date=${x};rows=${String(finalRows)};usd=${usd.toFixed(4)};stale:${String(staleCount)},bridge:${String(bridgeCount)},unpriced:${String(unpricedCount)}`)
  // 报告装配（对账段+巡检面+分析面）——文件与 insertReport（companyDir 未开=跳过）
  if (deps.companyDir !== undefined) {
    writeCloseReport(deps, x, at, plans, snapshots)
  }
  return { finalRows, alarms }
}

/** 巡检：全部已收口日期（≤D-1）比对已冻 Σ vs 应有真值 → 补账/迟到新格 */
function patrolClosedDates(deps: CostCloseDeps, at: number, yesterday: string, snapshots: readonly PriceSnapshotRecord[]): number {
  let appended = 0
  for (const x of deps.ledger.listClosedCostDates(deps.company)) {
    if (dateLt(yesterday, x)) continue // 防御：未来日不巡
    const usage = deps.ledger.listUsageDaily({ company: deps.company, usage_date: x })
    const desired = planCostCells(usage, snapshots, deps.tiers ?? [], x)
    const frozen = deps.ledger.listCostDaily({ company: deps.company, cost_date: x })
    const sweep = sweepClosedDate(frozen, desired)
    for (const adj of sweep.adjustments) {
      deps.ledger.appendCostDaily({
        id: deps.makeId(at),
        company: deps.company,
        person_id: adj.person_id,
        model: adj.model,
        cost_date: x,
        tokens: adj.tokensDelta,
        price_snapshot_id: 'derived',
        cost_usd: adj.usdDelta,
        kind: 'adjustment',
        adjusts_id: adj.adjustsId,
        closed_at: at,
        closed_by: `cost-adjust:${x}`,
        note: adj.reason === 'late-facts' ? '迟到事实补账（重建回填）' : '数据修复补账（重建改判）',
      })
      appended += 1
    }
    for (const cell of sweep.newCells) {
      appendFinal(deps, cell, x, at, 'new-final', '迟到新格首冻（收口后重建补出）')
      appended += 1
    }
    if (sweep.adjustments.length + sweep.newCells.length > 0) {
      deps.emitReport(
        `${ADJUST_NOTE_PREFIX}date=${x};adjustments=${String(sweep.adjustments.length)};new-cells=${String(sweep.newCells.length)}（P7 展示阈 ${String(ADJUSTMENT_MERGE_USD)}，报告文件含合并展示段）`,
      )
    }
  }
  return appended
}

/** 报告文件+快照行（cost-close/<X>.json；caliber cost-close/v1；对账+巡检+分析面） */
function writeCloseReport(
  deps: CostCloseDeps,
  x: string,
  at: number,
  plans: readonly CostCellPlan[],
  snapshots: readonly PriceSnapshotRecord[],
): void {
  const companyDir = deps.companyDir
  if (companyDir === undefined) return
  // 对账段：Σcost_daily(X) vs ΣGATE_PASS(X)（本地日界）
  const costRows = deps.ledger.listCostDaily({ company: deps.company, cost_date: x })
  const gatePass = deps.ledger
    .queryEvents({ company: deps.company, since: localDayStart(x), until: localDayStart(dateAddDays(x, 1)) - 1 })
    .filter((ev) => ev.event === 'GATE_PASS')
    .map((ev) => ({ usd: ev.cost_usd, note: ev.note }))
  const recon: ReconSegment = reconcileDate(x, costRows, gatePass)
  // 巡检面（本日收口后常态=空；崩溃重放/迟到=非空）
  const frozen = deps.ledger.listCostDaily({ company: deps.company, cost_date: x })
  const sweep = sweepClosedDate(frozen, plans)
  // 分析面：回看窗=已收口行 [X-7, X-1]
  const history: Array<{ cost_date: string; model: string; usd: number }> = []
  for (let i = 7; i >= 1; i -= 1) {
    const hd = dateAddDays(x, -i)
    for (const r of deps.ledger.listCostDaily({ company: deps.company, cost_date: hd })) history.push({ cost_date: hd, model: r.model, usd: r.cost_usd })
  }
  const insights: CostInsight[] = costInsights({
    date: x,
    cells: plans,
    history,
    ...(deps.tiers !== undefined ? { declared: deps.tiers.map((t) => ({ provider: t.provider, model: t.model, tier: t.tier })) } : {}),
    planTrack: snapshots
      .filter((s) => s.billing_track === 'coding_plan' && s.plan_monthly_usd !== undefined)
      .map((s) => ({ provider: s.provider, model: s.model, planMonthlyUsd: s.plan_monthly_usd as number })),
  })
  // 注因段（机械解释非猜测：对账差成因/定价降级）
  const notes: string[] = []
  if (recon.diverged) notes.push(`对账差 $${recon.deltaUsd.toFixed(4)}（异源口径：收口时刻 vs 收割时刻的快照版本/沿用天窗；分模型段见 perModel）`)
  if (plans.some((p) => p.priceBasis !== 'snapshot' || !p.exact)) notes.push('定价降级收口（stale 沿用/桥/无价）——DAILY_ALARM 已同步')
  const body = buildCostCloseReport({
    company: deps.company,
    date: x,
    generatedAt: at,
    finals: plans,
    adjustments: sweep.adjustments,
    newCells: sweep.newCells,
    recon,
    insights,
    ...(notes.length > 0 ? { notes } : {}),
    closedBy: `cost-close:${x}`,
  })
  const dir = path.join(companyDir, 'reports', '综合部', 'cost-close')
  const resolvedDir = path.resolve(dir)
  const rootResolved = path.resolve(companyDir)
  if (!resolvedDir.startsWith(rootResolved + path.sep) && resolvedDir !== rootResolved) {
    throw new Error(`报告目录越界：${resolvedDir}（公司目录 ${rootResolved} 外）`)
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, `cost-close-${x}.json`), `${JSON.stringify(body, null, 2)}\n`, 'utf8')
  // 快照行（新 id 同自然键=覆盖换代；崩溃重放双写收敛为最新胜）
  deps.ledger.insertReport({
    id: `r-cc-${deps.makeId(at)}`,
    company: deps.company,
    node: deps.company,
    type: 'daily',
    date: x,
    caliber: 'cost-close/v1',
    json_ref: `reports/综合部/cost-close/cost-close-${x}.json`,
  })
}
