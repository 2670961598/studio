/**
 * views —— :8787 监控面的纯函数层（v0.3 首刀 + 17-§8 全量口径 + MIG-08 六态对账）
 *
 * 依据：docs/16-§四 v0.3（jobs/runs/workers/事件流覆盖）、docs/17-§8 :8787 端面（全部读
 * SQLite；断路器对齐 core/breaker.ts、成本对齐 docs/26 C1 分列不相加）；
 * 六态/stale 出口：v2/08 §4.1/§4.4、v2/17 NEG-MON-01/02/03、L3P-01。
 *
 * 分层／只读纪律：零 IO、零 Hono——只吃 Ledger 读面（queryEvents/listJobs/listWorkRecords/
 * listSessions/listBudgets，见 store/src/ledger.ts）吐纯数据与 HTML；panel 对 SQLite 零写
 * （WAL 单写多读；server.ts 只做路由与传输）。
 *
 * workers v0 口径：真源是 daemon 内存态（17-§2），v0 以「work_records/sessions 的 ended_at
 * 为空」按 person_id 聚合近似（异常死亡未收割者会滞留，响应带 basis=ledger-v0 可辨）；
 * 漂移告警判据未冻结，本文件不臆造。
 */
import { PROJECTION_STATES } from '@studio-next/contract'
import type { EventRecord, ProjectionFaultKind, ProjectionState } from '@studio-next/contract'
import type { JobRecord, Ledger, SessionRecord, WorkRecord } from '@studio-next/store'

// —— 快照形状（/api/snapshot 的响应体；页面一次拉全） ——

export interface SnapshotJobs {
  total: number
  /** next_run_at <= now 的槽位数（与 store.dueJobs 同判据） */
  due: number
}
export interface SnapshotRuns {
  total: number
  /** ended_at 为空的在途 run 数 */
  inFlight: number
  /** 近况（在途优先，各自 started_at 降序） */
  recent: WorkRecord[]
}
/** workers v0 聚合行（口径见文件头注；sinceMs=最早一处活动的 started_at） */
export interface ActiveWorker { person_id: string; activeRuns: number; activeSessions: number; executors: string[]; issues: string[]; sinceMs: number }
/** basis='ledger-v0' = 台账近似聚合；daemon 内存态接管后换值（v0.4+） */
export interface SnapshotWorkers { basis: 'ledger-v0'; note: string; active: ActiveWorker[] }
/** 事件计数按类分布（count 降序，同数按事件名稳定序） */
export interface SnapshotEvents { total: number; byEvent: Array<{ event: string; count: number }> }
export interface DashboardSnapshot {
  /** 快照生成时刻（epoch ms） */
  generatedAt: number
  schemaVersion: number
  jobs: SnapshotJobs
  runs: SnapshotRuns
  workers: SnapshotWorkers
  events: SnapshotEvents
  /** 六态出口对账（MIG-08）：本快照自述 derived＋新鲜度未判定，不得读成「全绿健康」 */
  observation: ReturnType<typeof buildObservationExit>
}
/** 快照可调参数：测试注时间用 now，页面卡片密度用 recentRuns */
export interface SnapshotOptions {
  now?: number
  recentRuns?: number
}
/** 默认近况条数（server 的 pageSize 缺省同此） */
export const DEFAULT_PAGE_SIZE = 20
/** workers v0 口径说明（响应体 note 字段原文，机器可读处也留人话） */
export const WORKERS_V0_NOTE =
  'v0 口径：未 ended 的 work_records/sessions 按 person_id 聚合（台账近似）；' +
  '真 workers 是 daemon 内存态，v0.4 daemon 接管后替换（docs/17-§8）'

// 一次收集仪表盘快照（全走 Ledger 读面；events 全量计数，v0 量级小、量级证后优化），并附六态自述。
export function buildDashboardSnapshot(ledger: Ledger, options?: SnapshotOptions): DashboardSnapshot {
  const now = options?.now ?? Date.now()
  const recentRuns = options?.recentRuns ?? DEFAULT_PAGE_SIZE

  const jobs = ledger.listJobs()
  const runs = ledger.listWorkRecords()
  const sessions = ledger.listSessions()
  const events = ledger.queryEvents()

  const schemaVersion = ledger.version()
  return {
    generatedAt: now,
    schemaVersion,
    jobs: { total: jobs.length, due: jobs.filter((j) => j.next_run_at <= now).length },
    runs: { total: runs.length, inFlight: runs.filter((r) => r.ended_at === undefined).length, recent: recentRunSlice(runs, recentRuns) },
    workers: aggregateActiveWorkers(runs, sessions),
    events: { total: events.length, byEvent: eventDistribution(events) },
    // 六态自述：panel 是投影的投影（最高态 derived）；无 freshness 策略来源＝新鲜度未判定，
    // dataValidWindow 显式 null（不伪造窗长——L3P-01），故不产 stale 出口、也不得显示为绿。
    observation: buildObservationExit({
      view: { viewName: 'panel-dashboard', company: '*' }, projectionRuleVersion: `panel/views@${String(schemaVersion)}`,
      authoritativeSource: null, sourceCursor: null, generatedAt: new Date(now).toISOString(), dataValidWindow: null,
      viewCompleteness: 'unknown',
      stateAssignments: [
        { face: 'jobs', state: 'derived', basis: '台账 jobs 表一次读取聚合（due=next_run_at<=now）', lastTrustedCursor: null },
        { face: 'runs', state: 'derived', basis: '台账 work_records 一次读取切片（在途优先）', lastTrustedCursor: null },
        { face: 'workers', state: 'derived', basis: '台账 work_records/sessions 未 ended 按 person 聚合（v0 近似）', lastTrustedCursor: null },
        { face: 'events', state: 'derived', basis: '台账 events 一次读取计数（事件名分布）', lastTrustedCursor: null },
      ],
      staleExits: [], fault: null,
    }),
  }
}

export function recentRunSlice(records: WorkRecord[], limit: number): WorkRecord[] {
  const sorted = [...records].sort((a, b) => {
    const aInFlight = a.ended_at === undefined ? 0 : 1
    const bInFlight = b.ended_at === undefined ? 0 : 1
    if (aInFlight !== bInFlight) return aInFlight - bInFlight
    return b.started_at - a.started_at
  })
  return sorted.slice(0, limit)
}
/** workers v0 聚合（口径见文件头注）：在途 runs × 在途 sessions 按 person_id 归并 */
export function aggregateActiveWorkers(runs: WorkRecord[], sessions: SessionRecord[]): SnapshotWorkers {
  const byPerson = new Map<string, ActiveWorker>()
  const slot = (personId: string): ActiveWorker => {
    const existing = byPerson.get(personId)
    if (existing !== undefined) return existing
    const fresh: ActiveWorker = {
      person_id: personId, activeRuns: 0, activeSessions: 0, executors: [], issues: [], sinceMs: Number.MAX_SAFE_INTEGER,
    }
    byPerson.set(personId, fresh)
    return fresh
  }
  for (const run of runs) {
    if (run.ended_at !== undefined) continue
    const w = slot(run.person_id)
    w.activeRuns += 1
    w.sinceMs = Math.min(w.sinceMs, run.started_at)
    if (!w.executors.includes(run.executor)) w.executors.push(run.executor)
    if (!w.issues.includes(run.issue)) w.issues.push(run.issue)
  }
  for (const session of sessions) {
    if (session.ended_at !== undefined) continue
    const w = slot(session.person_id)
    w.activeSessions += 1
    w.sinceMs = Math.min(w.sinceMs, session.started_at)
    if (!w.issues.includes(session.issue)) w.issues.push(session.issue)
  }
  const active = [...byPerson.values()].sort((a, b) => b.sinceMs - a.sinceMs || a.person_id.localeCompare(b.person_id))
  return { basis: 'ledger-v0', note: WORKERS_V0_NOTE, active }
}
/** 事件计数按类分布：count 降序、同数按事件名升序（输出稳定，UI 与测试都好断言） */
export function eventDistribution(events: EventRecord[]): Array<{ event: string; count: number }> {
  const counts = new Map<string, number>()
  for (const ev of events) counts.set(ev.event, (counts.get(ev.event) ?? 0) + 1)
  return [...counts.entries()]
    .map(([event, count]) => ({ event, count }))
    .sort((a, b) => b.count - a.count || a.event.localeCompare(b.event))
}
/** jobs 投影：JobRecord + due 标记（与 store.dueJobs 同判据：next_run_at <= now） */
export interface JobView extends JobRecord {
  due: boolean
}
export function jobViews(jobs: JobRecord[], now: number): JobView[] {
  return jobs.map((j) => ({ ...j, due: j.next_run_at <= now }))
}

// —— 断路器卡（17-§8「断路器与漂移告警」的断路半张；漂移告警待 daemon 机制落地） ——

// 断路事件双通道匹配：①冻结枚举 CIRCUIT_BREAK；②daemon 现行发单形态（ESCALATE + note 前缀
// 'CIRCUIT_BREAK：<单号> 连击 N 达阈值 T（签名 S）→ 自动开 bug 单 B'）。单通道会漏真数据/漏枚举名。
export function isBreakerEvent(ev: EventRecord): boolean {
  if (ev.event === 'CIRCUIT_BREAK') return true
  return ev.event === 'ESCALATE' && (ev.note ?? '').startsWith('CIRCUIT_BREAK：')
}
/** daemon 现行断路 note 的结构化形态（engine.ts emit 语句逐字对应；不匹配 → null） */
const BREAKER_NOTE_PATTERN = /^CIRCUIT_BREAK：(\S+) 连击 (\d+) 达阈值 (\d+)（签名 (.+?)）→ 自动开 bug 单 (\S+)$/

/** note 可解析出的断路四要素（streak/threshold/signature/bug 单号） */
export interface BreakerNoteFields { streak: number; threshold: number; signature: string; bug: string }
/** 解析断路 note；不可解析（含裸 CIRCUIT_BREAK 事件无 note）→ null——调用方如实置 null 不臆造 */
export function parseBreakerNote(note: string | undefined): BreakerNoteFields | null {
  if (note === undefined) return null
  const m = BREAKER_NOTE_PATTERN.exec(note)
  if (m === null) return null
  return { streak: Number(m[2]), threshold: Number(m[3]), signature: m[4] as string, bug: m[5] as string }
}

/** 疑似熔断单清单行（17-§6 断路键口径；signature/streak/threshold/bug 不可解析=null 不臆造） */
export interface BreakerStatus {
  issue: string; company: string; signature: string | null; trips: number; lastTs: number
  streak: number | null; threshold: number | null; bug: string | null
}
// 断路聚合按 (issue,签名) 聚合触发史；是否仍熔断属 daemon 内存态、RESUME 未落账，故不做「复位消红」。
export function aggregateBreakers(events: EventRecord[]): BreakerStatus[] {
  const groups = new Map<string, BreakerStatus>()
  for (const ev of events) {
    if (!isBreakerEvent(ev)) continue
    const fields = parseBreakerNote(ev.note)
    const signature = fields?.signature ?? null
    const key = JSON.stringify([ev.issue, signature])
    const existing = groups.get(key)
    if (existing === undefined) {
      groups.set(key, {
        issue: ev.issue,
        company: ev.company,
        signature,
        trips: 1,
        lastTs: ev.ts,
        streak: fields?.streak ?? null,
        threshold: fields?.threshold ?? null,
        bug: fields?.bug ?? null,
      })
    } else {
      existing.trips += 1
      if (ev.ts >= existing.lastTs) {
        // 同刻重复触发按入账序取后写者（queryEvents (ts,id) 稳定序保证此处「后写」可判）
        existing.lastTs = ev.ts
        existing.streak = fields?.streak ?? null
        existing.threshold = fields?.threshold ?? null
        existing.bug = fields?.bug ?? null
        existing.signature = signature
      }
    }
  }
  return [...groups.values()].sort((a, b) => b.lastTs - a.lastTs || a.issue.localeCompare(b.issue))
}

/** 断路器卡响应（/api/breakers）；basis=events-v0＝触发史投影（当前是否仍熔断 v0 不可见） */
export interface BreakerSnapshot { basis: 'events-v0'; note: string; days: number; since: number; count: number; breakers: BreakerStatus[] }
/** 断路口径说明（响应体 note 原文） */
export const BREAKERS_V0_NOTE =
  'v0 口径：CIRCUIT_BREAK 事件 ∪ note 前缀 CIRCUIT_BREAK： 的 ESCALATE 事件（daemon 现行发单形态），' +
  '按 (单号, 错误签名) 聚合的触发史投影；复位（RESUME）未落账前不做消红推断（docs/17-§6/§8）'

/** 断路器窗口参数缺省与上限（?days=） */
export const DEFAULT_BREAKER_DAYS = 7
export const MAX_BREAKER_DAYS = 90
/** 一天的毫秒数（UTC 日切口径，纯算术无时区依赖） */
export const DAY_MS = 86_400_000
/** ts 所在 UTC 日的起点（epoch ms） */
export function dayStartOf(ts: number): number {
  return Math.floor(ts / DAY_MS) * DAY_MS
}
/** ts → UTC 日键（YYYY-MM-DD；toISOString 前 10 位，与 dayStartOf 同口径） */
export function dayKeyOf(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}
/** 断路器卡一次收集：近 days 天滚动窗（since=now-days*86400000，含端）→ aggregateBreakers。 */
export function buildBreakerSnapshot(ledger: Ledger, options?: { now?: number; days?: number }): BreakerSnapshot {
  const now = options?.now ?? Date.now()
  const days = options?.days ?? DEFAULT_BREAKER_DAYS
  const since = now - days * DAY_MS
  const breakers = aggregateBreakers(ledger.queryEvents({ since }))
  return { basis: 'events-v0', note: BREAKERS_V0_NOTE, days, since, count: breakers.length, breakers }
}

// —— 成本卡（17-§8 成本趋势；docs/26 C1 冻结口径的展示面） ——

/**
 * 单日成本点：三类三口径分列、**不相加**（docs/26 C1）。金额存原始 double（显示层自取整）；
 * LLM=event='LLM' 的 cost_usd；收割=work_records.cost_usd（按 ended 日归桶，在途不计）；
 * 预算 reserve/settle/refusal 按 ts 日归桶（settle 未记 actual 计 0 不折算；refusal 不入净额）；
 * net = reserve − settle（可为负）。
 */
export interface DailyCostPoint {
  /** UTC 日（YYYY-MM-DD） */
  date: string
  llm_cost_usd: number
  llm_events: number
  harvest_cost_usd: number
  harvest_runs: number
  reserve_usd: number
  settle_usd: number
  refusal_usd: number
  net_usd: number
}

/** 成本卡响应（/api/costs）：恰 days 个桶升序、空日零填充（不断轴），totals 三口径仍分列 */
export interface CostsSnapshot { days: number; note: string; since: number; series: DailyCostPoint[]; totals: Omit<DailyCostPoint, 'date'> }
/** 成本卡口径说明（响应体 note 原文——docs/26 C1 冻结口径的展示面声明） */
export const COSTS_NOTE =
  '口径（docs/26 C1 冻结）：LLM 岛成本与收割成本分列不相加（LLM 岛=LLM 事件 cost_usd，' +
  '收割=work_records.cost_usd，双口径并存禁止相加当总额）；预算净额 = reserve − settle' +
  '（refusal 被拒不产生实际成本，不计净额）；UTC 日切。'

/** 成本卡窗口参数缺省与上限（?days=） */
export const DEFAULT_COSTS_DAYS = 7
export const MAX_COSTS_DAYS = 90
// budgets 口径：直连 ledger.listBudgets({since}) 全量读面——无 scope 维/不依赖镜像枚举，
// 无镜像行的 scope 预算同样可见（旧「镜像枚举近似」缺口已消）。
export const COSTS_BUDGETS_BASIS_NOTE =
  'budgets 走 store listBudgets 全量读面（since 起 ts 闭区间，与日桶窗口同界）；' +
  '无镜像行的 scope 预算同样可见'

export function buildCostsSnapshot(ledger: Ledger, options?: { now?: number; days?: number }): CostsSnapshot {
  const now = options?.now ?? Date.now()
  const days = options?.days ?? DEFAULT_COSTS_DAYS
  const since = dayStartOf(now) - (days - 1) * DAY_MS

  const emptyPoint = (date: string): DailyCostPoint => ({
    date, llm_cost_usd: 0, llm_events: 0, harvest_cost_usd: 0, harvest_runs: 0,
    reserve_usd: 0, settle_usd: 0, refusal_usd: 0, net_usd: 0,
  })
  const points: DailyCostPoint[] = []
  for (let i = 0; i < days; i += 1) points.push(emptyPoint(dayKeyOf(since + i * DAY_MS)))
  const bucketIndex = (ts: number): number => Math.round((dayStartOf(ts) - since) / DAY_MS)

  for (const ev of ledger.queryEvents({ since })) {
    if (ev.event !== 'LLM') continue
    const idx = bucketIndex(ev.ts)
    const point = points[idx]
    if (point === undefined) continue // 窗口外（ts>now 不可能；防御性，如时钟回拨语料）
    point.llm_cost_usd += ev.cost_usd ?? 0
    point.llm_events += 1
  }

  for (const run of ledger.listWorkRecords()) {
    if (run.ended_at === undefined || run.ended_at < since) continue
    const idx = bucketIndex(run.ended_at)
    const point = points[idx]
    if (point === undefined) continue
    point.harvest_cost_usd += run.cost_usd ?? 0
    point.harvest_runs += 1
  }

  // ③ budgets 全量读面：since 下界由读面闭区间保证（与 events 同界）；上界不传 until，
  // 窗口外上界走 bucketIndex→undefined 防御性跳过（如时钟回拨语料）
  for (const b of ledger.listBudgets({ since })) {
    const idx = bucketIndex(b.ts)
    const point = points[idx]
    if (point === undefined) continue
    if (b.kind === 'reserve') point.reserve_usd += b.estimated_usd ?? 0
    else if (b.kind === 'settle') point.settle_usd += b.actual_usd ?? 0
    else point.refusal_usd += b.estimated_usd ?? 0
  }
  for (const point of points) point.net_usd = point.reserve_usd - point.settle_usd

  const totals: Omit<DailyCostPoint, 'date'> = {
    llm_cost_usd: 0, llm_events: 0, harvest_cost_usd: 0, harvest_runs: 0,
    reserve_usd: 0, settle_usd: 0, refusal_usd: 0, net_usd: 0,
  }
  for (const point of points) {
    totals.llm_cost_usd += point.llm_cost_usd; totals.llm_events += point.llm_events
    totals.harvest_cost_usd += point.harvest_cost_usd; totals.harvest_runs += point.harvest_runs
    totals.reserve_usd += point.reserve_usd; totals.settle_usd += point.settle_usd
    totals.refusal_usd += point.refusal_usd; totals.net_usd += point.net_usd
  }

  return { days, note: COSTS_NOTE, since, series: points, totals }
}

// —— 六态投影与 stale 出口对账（MIG-08；v2/08 §4.1/§4.4；v2/17 NEG-MON-01/02/03） ——

/** 六态中文标签（ENU-52 唯一值集；运行时判定一律 import contract 根出口，本文件零新增值集） */
export const PROJECTION_STATE_LABELS = {
  observed: '已观察', derived: '已推导', unknown: '未知',
  stale: '陈旧', conflicted: '冲突/受损', gapped: '缺口/中断',
} as const satisfies Record<ProjectionState, string>

/** 六态口径声明：已观察≠内容为真，无告警≠健康（未知/陈旧/冲突/缺口不得补 0/空/绿） */
export const PROJECTION_STATE_NOTE =
  '六态不是健康度评分：已观察≠内容为真、已推导≠已核实；未知/陈旧/冲突/缺口须原样显示，' +
  '不得补 0/空串/绿色，不得沿用最后一张健康快照（v2/08 §4.1/§4.4）'

/** REC-OBS-01 投影的 panel 窄消费面（结构类型：store/obs.ts 投影可直接传入；不复制记录 schema） */
export interface ObservationInput {
  readonly view: { readonly viewName: string; readonly company: string }
  readonly projectionRuleVersion: string | null
  readonly authoritativeSource: { readonly endpoint: { readonly refId: string; readonly refVersion: string }; readonly generation: number } | null
  readonly sourceCursor: string | null
  readonly generatedAt: string | null
  readonly dataValidWindow: { readonly from: string; readonly to: string } | null
  readonly viewCompleteness: 'complete' | 'incomplete' | 'unknown' | null
  readonly stateAssignments: readonly { readonly face: string; readonly state: ProjectionState; readonly basis: string; readonly lastTrustedCursor: string | null }[]
  readonly staleExits: readonly { readonly face: string; readonly requiresNewerSnapshot: true; readonly lastTrustedCursor: string | null }[]
  readonly fault: { readonly kind: ProjectionFaultKind; readonly detail: string } | null
}

/** 陈旧可行动出口：必携 dataValidWindow＋来源＋游标＋规则版本（L3P-01） */
export interface ObservationStaleExit {
  readonly face: string
  readonly requiresNewerSnapshot: true
  readonly lastTrustedCursor: string | null
  readonly generatedAt: string
  readonly dataValidWindow: { readonly from: string; readonly to: string }
  readonly source: { readonly endpoint: { readonly refId: string; readonly refVersion: string }; readonly generation: number }
  readonly sourceCursor: string
  readonly projectionRuleVersion: string
}

/** MON-12 低档结论事后审计行（REC-EVD-05 窄消费面；记录形状归 contract records/evd.ts） */
export interface LowTierAuditRow {
  readonly conclusionRef: string
  readonly deadline: string
  readonly auditRef: string | null
  readonly auditClass: string | null
  readonly overdueDisposition: string | null
}

/** ENU-135 身份标注（external 为唯一可称「独立」取值——目标未证；未知值原样透出） */
const AUDIT_CLASS_LABELS: Readonly<Record<string, string>> = {
  internal_boss_self_audit: '内部老板自审（不得自称独立）', superior_audit: '逐级上级审计',
  cross_unit: '跨单元互审', external: '外部独立审计（外部锚）',
}

/** MON-12 逾期视图：逾期未审计恒标「未经事后审计」并落 MON-12 异常；升级去向只取记录原文（未写=null，不臆造） */
export function buildAuditOverdueView(rows: readonly LowTierAuditRow[], now?: string) {
  const nowMs = now === undefined ? Number.NaN : Date.parse(now)
  const views = rows.map((row) => {
    const deadlineMs = Date.parse(row.deadline)
    const overdue = row.auditRef === null && Number.isFinite(nowMs) && Number.isFinite(deadlineMs) && deadlineMs < nowMs
    return {
      conclusionRef: row.conclusionRef, overdue, escalation: overdue ? row.overdueDisposition : null,
      publicLabel: overdue ? ('未经事后审计' as const) : null,
      auditClassLabel: row.auditRef === null || row.auditClass === null ? null : (AUDIT_CLASS_LABELS[row.auditClass] ?? row.auditClass),
    }
  })
  const overdueCount = views.filter((row) => row.overdue).length
  return Object.freeze({
    rows: Object.freeze(views),
    anomaly: overdueCount === 0 ? null : Object.freeze({ face: 'MON-12' as const, count: overdueCount, label: '未经事后审计' as const }),
  })
}

/**
 * 六态 stale 出口对账（纯函数只读）：六态原样呈现＋逐面 tone（无绿）；未知补原因不补 0；空槽集显式
 * 降整视图未知；非 complete 却全槽 observed 降 conflicted（全绿不冒充健康）；陈旧面按投影元数据重算
 * 可行动出口，元数据不全/状态不一致→unreconciled（不静默选边）。
 */
export function buildObservationExit(projection: ObservationInput, options: { readonly freshnessJudged?: boolean; readonly audits?: readonly LowTierAuditRow[]; readonly now?: string } = {}) {
  const freshness = options.freshnessJudged === true ? ('judged' as const) : ('unjudged' as const)
  const { generatedAt, dataValidWindow, sourceCursor, projectionRuleVersion } = projection
  const source = projection.authoritativeSource === null ? null : Object.freeze({
    endpoint: Object.freeze({ ...projection.authoritativeSource.endpoint }),
    generation: projection.authoritativeSource.generation,
  })
  const rawFaces = projection.stateAssignments.length > 0 ? projection.stateAssignments : [{
    face: projection.view.viewName, state: 'unknown' as ProjectionState,
    basis: '投影未给逐面状态槽（材料不足——不得读成「无异常」）', lastTrustedCursor: null,
  }]
  // 运行期重校 ENU-52（坏源值按缺口降级，不得被摆成已观察/绿）
  const known = (face: { state: ProjectionState }): boolean => (PROJECTION_STATES as readonly string[]).includes(face.state)
  const overGreen = projection.viewCompleteness !== 'complete' && rawFaces.every((face) => face.state === 'observed')
  const toneOf = (state: ProjectionState): 'neutral' | 'unknown' | 'impaired' =>
    state === 'observed' || state === 'derived' ? (freshness === 'judged' ? 'neutral' : 'unknown') : state === 'unknown' ? 'unknown' : 'impaired'
  const faces = rawFaces.map((assignment) => {
    let state: ProjectionState = known(assignment) ? assignment.state : 'gapped'
    let basis = !known(assignment)
      ? `投影状态值非法（${String(assignment.state)}）——按缺口处理（不得冒充已观察）`
      : assignment.basis.trim() === '' ? `${PROJECTION_STATE_LABELS[assignment.state]}：依据缺失（空依据不得自称已观察）` : assignment.basis
    if (overGreen && state === 'observed') {
      state = 'conflicted'
      basis = `${basis}；完整性=${projection.viewCompleteness ?? '未声明'} 却全槽 observed（全绿不得冒充健康）`
    }
    return Object.freeze({ face: assignment.face, state, label: PROJECTION_STATE_LABELS[state], basis, lastTrustedCursor: assignment.lastTrustedCursor, tone: toneOf(state) })
  })
  const staleExits: ObservationStaleExit[] = []
  const staleUnreconciled: Array<{ face: string; reason: string }> = []
  const declaredStale = new Set(projection.staleExits.map((exit) => exit.face))
  for (const face of faces) {
    if (face.state !== 'stale') {
      if (declaredStale.has(face.face)) staleUnreconciled.push({ face: face.face, reason: '来源声明陈旧出口但逐面状态非 stale（对账不一致——不得静默选边）' })
      continue
    }
    if (generatedAt === null || dataValidWindow === null || source === null || sourceCursor === null || projectionRuleVersion === null) {
      staleUnreconciled.push({ face: face.face, reason: '投影元数据不全（dataValidWindow/来源/游标/规则版本缺项）——不得冒充可行动出口，仍须取更新快照' })
      continue
    }
    staleExits.push(Object.freeze({
      face: face.face, requiresNewerSnapshot: true as const, lastTrustedCursor: face.lastTrustedCursor, generatedAt,
      dataValidWindow: Object.freeze({ ...dataValidWindow }), source, sourceCursor, projectionRuleVersion,
    }))
  }
  return Object.freeze({
    view: Object.freeze({ ...projection.view }), projectionRuleVersion, source, sourceCursor, generatedAt,
    dataValidWindow: dataValidWindow === null ? null : Object.freeze({ ...dataValidWindow }),
    completeness: projection.viewCompleteness, freshness, faces: Object.freeze(faces),
    staleExits: Object.freeze(staleExits), staleUnreconciled: Object.freeze(staleUnreconciled), fault: projection.fault,
    note: PROJECTION_STATE_NOTE, audit: options.audits === undefined ? null : buildAuditOverdueView(options.audits, options.now),
    readOnly: true as const, mutatesFacts: false as const,
  })
}

/** 六态对账报告（buildObservationExit 的只读回包；供读面/测试类型消费） */
export type ObservationExitReport = ReturnType<typeof buildObservationExit>

// —— 监控单页（零前端依赖、内联 CSS；丑没关系，信息覆盖是验收口径） ——

/** 极简 HTML 单页：六区块卡片（jobs/runs/workers/断路器/成本/事件流）+ fetch 轮询 + SSE 接事件流 */
export function renderDashboardPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Studio Next 监控 :8791</title>
<style>
  :root { color-scheme: dark; }
  body { font: 13px/1.5 ui-monospace, Menlo, Consolas, monospace; background: #101418; color: #cfd8dc; margin: 0; padding: 16px; }
  h1 { font-size: 16px; margin: 0 0 4px; color: #80cbc4; }
  #meta { color: #78909c; margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 16px; }
  section { background: #161c22; border: 1px solid #263238; border-radius: 6px; padding: 12px; min-width: 0; }
  h2 { font-size: 13px; margin: 0 0 8px; color: #eeff41; font-weight: 600; }
  h2 .cnt { color: #78909c; font-weight: 400; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { text-align: left; padding: 3px 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  th { color: #90a4ae; border-bottom: 1px solid #263238; }
  tr:nth-child(even) td { background: #1b232b; }
  .due { color: #ff8a65; }
  .ok { color: #a5d6a7; }
  .fail { color: #ef9a9a; }
  .run { color: #fff59d; }
  #events-feed div { padding: 2px 0; border-bottom: 1px dotted #263238; }
  #events-feed .t { color: #78909c; }
  .empty { color: #546e7a; padding: 8px 0; }
  .caliber { color: #78909c; margin: 4px 0 8px; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #ef5350; margin-right: 6px; vertical-align: middle; }
  #breakers-list div { padding: 3px 0; border-bottom: 1px dotted #263238; }
  #breakers-list .sig { color: #ef9a9a; }
  .bar { color: #80cbc4; letter-spacing: -1px; }
  .bar.net { color: #fff59d; }
  footer { color: #546e7a; margin-top: 16px; }
</style>
</head>
<body>
<h1>Studio Next 监控（:8791 只读面）</h1>
<div id="meta">schema v<span id="schema">-</span> · 快照 <span id="stamp">-</span> · 每 3s 轮询 + SSE 实时事件</div>
<div class="grid">
  <section>
    <h2>定时岗 jobs <span class="cnt" id="jobs-cnt"></span></h2>
    <table><thead><tr><th>job</th><th>company</th><th>cron</th><th>next_run_at</th><th>状态</th></tr></thead>
    <tbody id="jobs-body"><tr><td colspan="5" class="empty">加载中…</td></tr></tbody></table>
  </section>
  <section>
    <h2>执行 runs <span class="cnt" id="runs-cnt"></span></h2>
    <table><thead><tr><th>issue</th><th>工号</th><th>executor</th><th>started</th><th>ended</th><th>status</th></tr></thead>
    <tbody id="runs-body"><tr><td colspan="6" class="empty">加载中…</td></tr></tbody></table>
  </section>
  <section>
    <h2>workers <span class="cnt" id="workers-cnt"></span></h2>
    <div class="empty" id="workers-note"></div>
    <table><thead><tr><th>工号</th><th>在途runs</th><th>在途sessions</th><th>executors</th><th>issues</th></tr></thead>
    <tbody id="workers-body"><tr><td colspan="5" class="empty">加载中…</td></tr></tbody></table>
  </section>
  <section>
    <h2>断路器告警 <span class="cnt" id="breakers-cnt"></span></h2>
    <div class="caliber" id="breakers-note"></div>
    <div id="breakers-list"><div class="empty">加载中…</div></div>
  </section>
  <section>
    <h2>成本趋势 <span class="cnt" id="costs-cnt"></span></h2>
    <div class="caliber" id="costs-note"></div>
    <table><thead><tr><th>日(UTC)</th><th>LLM岛$</th><th>收割$</th><th>reserve</th><th>settle</th><th>refusal</th><th>净额$</th></tr></thead>
    <tbody id="costs-body"><tr><td colspan="7" class="empty">加载中…</td></tr></tbody></table>
  </section>
  <section>
    <h2>事件流 <span class="cnt" id="events-cnt"></span></h2>
    <div id="events-feed"><div class="empty">等待 SSE 事件…</div></div>
  </section>
</div>
<footer>只读监控面（17-§8 口径）：数据全部来自 SQLite 台账；workers 为 v0 台账近似口径（真源=daemon 内存态）；
断路器=触发史投影（复位未落账不消红）；成本 LLM 岛/收割分列不相加（docs/26 C1）；漂移告警待判据冻结。</footer>
<script>
'use strict';
var esc = function (s) {
  return String(s).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
};
var fmtTime = function (ms) { return ms ? new Date(ms).toLocaleTimeString('zh-CN', { hour12: false }) : '-'; };
var setCnt = function (id, text) { document.getElementById(id).textContent = text; };
var setBody = function (id, rowsHtml, cols) {
  document.getElementById(id).innerHTML = rowsHtml || ('<tr><td colspan="' + cols + '" class="empty">（空）</td></tr>');
};
var statusClass = function (s) { return s === 'done' ? 'ok' : s === 'failed' ? 'fail' : 'run'; };

function renderJobs(j) {
  setCnt('jobs-cnt', '共 ' + j.total + ' · due ' + j.due);
  setBody('jobs-body', j.jobs.map(function (job) {
    return '<tr' + (job.due ? ' class="due"' : '') + '><td title="' + esc(job.job_id) + '">' + esc(job.job_id) +
      '</td><td>' + esc(job.company) + '</td><td>' + esc(job.cron) + '</td><td>' + fmtTime(job.next_run_at) +
      '</td><td>' + esc(job.status || '-') + (job.due ? ' · DUE' : '') + '</td></tr>';
  }).join(''), 5);
}

function renderSnapshot(s) {
  setCnt('schema', s.schemaVersion);
  setCnt('stamp', fmtTime(s.generatedAt));
  setCnt('runs-cnt', '共 ' + s.runs.total + ' · 在途 ' + s.runs.inFlight + ' · 近 ' + s.runs.recent.length + ' 条');
  setBody('runs-body', s.runs.recent.map(function (r) {
    var ended = r.ended_at === undefined ? '在途' : fmtTime(r.ended_at);
    return '<tr><td title="' + esc(r.id) + '">' + esc(r.issue) + '</td><td>' + esc(r.person_id) +
      '</td><td>' + esc(r.executor) + '</td><td>' + fmtTime(r.started_at) + '</td><td>' + ended +
      '</td><td class="' + statusClass(r.status) + '">' + esc(r.status) + '#' + r.attempt + '</td></tr>';
  }).join(''), 6);
  setCnt('workers-cnt', '在册 ' + s.workers.active.length);
  setCnt('workers-note', s.workers.note);
  setBody('workers-body', s.workers.active.map(function (w) {
    return '<tr><td>' + esc(w.person_id) + '</td><td>' + w.activeRuns + '</td><td>' + w.activeSessions +
      '</td><td>' + esc(w.executors.join(',')) + '</td><td>' + esc(w.issues.join(',')) + '</td></tr>';
  }).join(''), 5);
  setCnt('events-cnt', '累计 ' + s.events.total);
}

// 断路器卡：红点=触发（触发史投影口径——复位未落账不消红，见 note）
function renderBreakers(b) {
  setCnt('breakers-cnt', '近 ' + b.days + ' 天 ' + b.count + ' 单');
  setCnt('breakers-note', b.note);
  var list = document.getElementById('breakers-list');
  if (!b.breakers.length) { list.innerHTML = '<div class="empty">（无熔断触发）</div>'; return; }
  list.innerHTML = b.breakers.map(function (brk) {
    var sig = brk.signature === null ? '签名未携带' : brk.signature;
    var strikes = brk.streak === null ? '' : ' · 连击 ' + brk.streak + '/' + (brk.threshold === null ? '?' : brk.threshold);
    var bug = brk.bug === null ? '' : ' · bug ' + brk.bug;
    return '<div><span class="dot"></span>' + esc(brk.issue) + ' <span class="sig">' + esc(sig) +
      '</span> · x' + brk.trips + strikes + bug + ' · ' + fmtTime(brk.lastTs) + '</div>';
  }).join('');
}

// 成本卡：纯文本条形简图（零前端依赖；金额显示层取整——台账存原始 double）
var fmtUsd = function (v) { return (Math.round(v * 10000) / 10000).toString(); };
var bar = function (v, max, cls) {
  var width = max > 0 ? Math.max(1, Math.round((v / max) * 16)) : 0;
  return '<span class="bar' + (cls ? ' ' + cls : '') + '">' + String.fromCharCode(9608).repeat(width) + '</span> ' + fmtUsd(v);
};
function renderCosts(c) {
  setCnt('costs-cnt', '近 ' + c.days + ' 天（UTC）');
  setCnt('costs-note', c.note);
  var maxLlm = 0, maxNet = 0;
  c.series.forEach(function (p) {
    if (p.llm_cost_usd > maxLlm) maxLlm = p.llm_cost_usd;
    if (Math.abs(p.net_usd) > maxNet) maxNet = Math.abs(p.net_usd);
  });
  setBody('costs-body', c.series.slice().reverse().map(function (p) {
    return '<tr><td>' + esc(p.date) + '</td><td>' + bar(p.llm_cost_usd, maxLlm) + ' <span class="cnt">(' + p.llm_events + '条)</span>' +
      '</td><td>' + fmtUsd(p.harvest_cost_usd) + ' <span class="cnt">(' + p.harvest_runs + '单)</span>' +
      '</td><td>' + fmtUsd(p.reserve_usd) + '</td><td>' + fmtUsd(p.settle_usd) + '</td><td>' + fmtUsd(p.refusal_usd) +
      '</td><td>' + bar(p.net_usd, maxNet, 'net') + '</td></tr>';
  }).join(''), 7);
}

function refresh() {
  fetch('/api/jobs').then(function (r) { return r.json(); }).then(renderJobs).catch(function () {});
  fetch('/api/snapshot').then(function (r) { return r.json(); }).then(renderSnapshot).catch(function () {});
  fetch('/api/breakers?days=7').then(function (r) { return r.json(); }).then(renderBreakers).catch(function () {});
  fetch('/api/costs?days=7').then(function (r) { return r.json(); }).then(renderCosts).catch(function () {});
}
refresh();
setInterval(refresh, 3000);

var feed = document.getElementById('events-feed');
feed.textContent = '';
function prependEvent(ev, ts) {
  var line = document.createElement('div');
  line.innerHTML = '<span class="t">' + fmtTime(ts) + '</span> ' + esc(ev.event) + ' · ' + esc(ev.company) + ' · ' + esc(ev.issue) + ' · ' + esc(ev.actor);
  feed.insertBefore(line, feed.firstChild);
  while (feed.childElementCount > 50) feed.removeChild(feed.lastChild);
}
// 事件流底账：载入即拉最近 50 条（倒序——最新在前），SSE 只负责之后的新事件
fetch('/api/events?order=desc&limit=50').then(function (r) { return r.json(); }).then(function (body) {
  body.events.slice().reverse().forEach(function (ev) { prependEvent(ev, ev.ts); });
}).catch(function () {});
var source = new EventSource('/api/events/stream');
source.addEventListener('ledger', function (e) {
  try { var ev = JSON.parse(e.data); prependEvent(ev, ev.ts); } catch (err) {}
});
</script>
</body>
</html>
`;
}