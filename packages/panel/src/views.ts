/**
 * views —— :8787 监控面的纯函数层（v0.3 首刀 + 全量口径补齐）
 *
 * 依据：docs/16-§四 v0.3（验收口径「信息覆盖：jobs/runs/workers/事件流齐备」）、
 * docs/17-§8 :8787 端面定义（jobs/runs/workers 实时流 SSE / 事件流——全部读 SQLite；
 * 全量口径补齐：断路器告警 + 成本趋势——v0.3 首刀时数据源未备，现已备：store
 * queryEvents order:'desc' 读面 + budgets 表落量）。断路语义对齐 core/breaker.ts
 * （同(单号,错误签名)连击→熔断，17-§6）；成本口径对齐 docs/26 C1（LLM 岛成本与
 * 收割成本双口径分列、禁止相加当总额——本卡是其展示面）。
 *
 * 分层纪律：本文件零 IO、零 Hono 依赖——只吃 Ledger 读面（queryEvents/listJobs/
 * listWorkRecords/listSessions/listBudgets，见 packages/store/src/ledger.ts）
 * 吐纯数据快照与 HTML；
 * server.ts 只做路由与传输。数据源全部为 store 读面，不直接碰 SQL。
 *
 * 只读纪律：panel 对 SQLite 零写。WAL 模式下单写多读天然并发安全（store/driver.ts
 * journal_mode=WAL），panel 与 daemon 写进程可同库并存。
 *
 * **workers v0 口径（头注声明，docs/17-§8「workers 实时流」的 v0.3 替身）**：
 *   真 workers = daemon 内存态（在跑 executor 进程表，17-§2），v0.3 daemon 尚无主循环，
 *   故以台账投影近似：「work_records 中 ended_at 为空」∪「sessions 中 ended_at 为空」
 *   按 person_id 聚合。误差已知：异常死亡未收割的在途单会永远留在聚合里（无 ended_at 落账）。
 *   v0.4+ daemon 接管 workers 真源后本口径整体替换（响应体带 basis 字段机器可辨）。
 *
 * **漂移告警缺口（17-§8 全量口径的另半张，头注声明不隐瞒）**：本刀落「断路器告警 +
 * 成本趋势」两卡；「漂移告警」（模型行为/成本漂移检测）待 daemon 侧机制与数据判据
 * 落地后接入——判据未冻结，本文件不臆造。
 */
import type { EventRecord } from '@studio-next/contract'
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

/** workers v0 聚合行（口径见文件头注） */
export interface ActiveWorker {
  person_id: string
  /** 在途 work_records 数 */
  activeRuns: number
  /** 在途 sessions 数 */
  activeSessions: number
  executors: string[]
  issues: string[]
  /** 最早一处活动的 started_at（epoch ms） */
  sinceMs: number
}

export interface SnapshotWorkers {
  /** 口径标记：'ledger-v0' = 台账近似聚合；daemon 内存态接管后换值（v0.4+） */
  basis: 'ledger-v0'
  note: string
  active: ActiveWorker[]
}

export interface SnapshotEvents {
  total: number
  /** 事件计数按类分布（count 降序，同数按事件名稳定序） */
  byEvent: Array<{ event: string; count: number }>
}

export interface DashboardSnapshot {
  /** 快照生成时刻（epoch ms） */
  generatedAt: number
  schemaVersion: number
  jobs: SnapshotJobs
  runs: SnapshotRuns
  workers: SnapshotWorkers
  events: SnapshotEvents
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

/**
 * 一次收集仪表盘快照：jobs 总数/due 数、runs 近 N 条+在途数、workers v0 聚合、
 * 事件计数按类分布。全部走 Ledger 读面；events 全量扫描计数（v0 量级小，量级证后优化）。
 */
export function buildDashboardSnapshot(ledger: Ledger, options?: SnapshotOptions): DashboardSnapshot {
  const now = options?.now ?? Date.now()
  const recentRuns = options?.recentRuns ?? DEFAULT_PAGE_SIZE

  const jobs = ledger.listJobs()
  const runs = ledger.listWorkRecords()
  const sessions = ledger.listSessions()
  const events = ledger.queryEvents()

  return {
    generatedAt: now,
    schemaVersion: ledger.version(),
    jobs: {
      total: jobs.length,
      due: jobs.filter((j) => j.next_run_at <= now).length,
    },
    runs: {
      total: runs.length,
      inFlight: runs.filter((r) => r.ended_at === undefined).length,
      recent: recentRunSlice(runs, recentRuns),
    },
    workers: aggregateActiveWorkers(runs, sessions),
    events: {
      total: events.length,
      byEvent: eventDistribution(events),
    },
  }
}

/**
 * runs 近况切片：在途（ended_at 为空）优先，组内按 started_at 降序；
 * 「在途优先」= 监控第一问是「现在谁在跑」，其次是最近完单。
 */
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
      person_id: personId,
      activeRuns: 0,
      activeSessions: 0,
      executors: [],
      issues: [],
      sinceMs: Number.MAX_SAFE_INTEGER,
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

/**
 * 断路事件的台账匹配口径（**双通道**，拟稿待批点）：
 *   1) event = 'CIRCUIT_BREAK'（17-§3 冻结枚举名——回填/演练语料与后续发单形态）；
 *   2) event = 'ESCALATE' 且 note 以 'CIRCUIT_BREAK：' 起头（daemon 现行唯一发单形态：
 *      apps/daemon/src/engine.ts makeEvent('ESCALATE', …, note='CIRCUIT_BREAK：<单号> 连击 N
 *      达阈值 T（签名 S）→ 自动开 bug 单 B')——熔断作为升级事件落账，note 承载结构化信息）。
 * 只按 1) 匹配会漏 daemon 真数据（面板空卡），只按 2) 匹配会漏冻结枚举名——故双通道并集。
 */
export function isBreakerEvent(ev: EventRecord): boolean {
  if (ev.event === 'CIRCUIT_BREAK') return true
  return ev.event === 'ESCALATE' && (ev.note ?? '').startsWith('CIRCUIT_BREAK：')
}

/** daemon 现行断路 note 的结构化形态（engine.ts emit 语句逐字对应；不匹配 → null） */
const BREAKER_NOTE_PATTERN = /^CIRCUIT_BREAK：(\S+) 连击 (\d+) 达阈值 (\d+)（签名 (.+?)）→ 自动开 bug 单 (\S+)$/

/** note 可解析出的断路四要素（streak/threshold/signature/bug 单号） */
export interface BreakerNoteFields {
  streak: number
  threshold: number
  signature: string
  bug: string
}

/** 解析断路 note；不可解析（含裸 CIRCUIT_BREAK 事件无 note）→ null——调用方如实置 null 不臆造 */
export function parseBreakerNote(note: string | undefined): BreakerNoteFields | null {
  if (note === undefined) return null
  const m = BREAKER_NOTE_PATTERN.exec(note)
  if (m === null) return null
  return { streak: Number(m[2]), threshold: Number(m[3]), signature: m[4] as string, bug: m[5] as string }
}

/** 疑似熔断单清单行：(issue, 错误签名) 二元组聚合（17-§6 断路键口径） */
export interface BreakerStatus {
  issue: string
  company: string
  /** 错误签名（note 可解析时；null=事件未携带可解析签名——裸 CIRCUIT_BREAK 无 note） */
  signature: string | null
  /** 窗口内触发次数（同 (issue,签名) 重复熔断计数） */
  trips: number
  /** 最近触发时刻（epoch ms） */
  lastTs: number
  /** 连击数（取最近一条 note；不可解析=null） */
  streak: number | null
  /** 熔断阈值（同上） */
  threshold: number | null
  /** 自动开的 bug 单号（同上） */
  bug: string | null
}

/**
 * 断路聚合：CIRCUIT_BREAK 族事件按 (issue, signature|'') 聚合——最近触发时刻 / 触发次数 /
 * note 可解析要素。输出按 lastTs 降序、同刻按 issue 稳定序（告警最急的排最前）。
 * 「疑似」口径：纯台账投影（与 workers v0 同精神）——daemon 是否仍处熔断是内存态，
 * 台账只见触发史，复位事件（RESUME）daemon 尚未落账，故不做「复位消红」推断。
 */
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

/** 断路器卡响应（/api/breakers） */
export interface BreakerSnapshot {
  /** 口径标记：'events-v0' = 台账触发史投影（「当前是否仍熔断」属 daemon 内存态，v0 不可见） */
  basis: 'events-v0'
  note: string
  days: number
  /** 窗口下界（epoch ms，含） */
  since: number
  count: number
  breakers: BreakerStatus[]
}

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

/**
 * 断路器卡一次收集：近 days 天窗口（since = now - days*86400000，滚动窗含端）内
 * 的断路事件 → aggregateBreakers。事件过滤（event 名/note 前缀）在 panel 侧做——
 * store queryEvents 无事件名维（读面已备部分，见 server.ts /api/events 注）。
 */
export function buildBreakerSnapshot(ledger: Ledger, options?: { now?: number; days?: number }): BreakerSnapshot {
  const now = options?.now ?? Date.now()
  const days = options?.days ?? DEFAULT_BREAKER_DAYS
  const since = now - days * DAY_MS
  const breakers = aggregateBreakers(ledger.queryEvents({ since }))
  return { basis: 'events-v0', note: BREAKERS_V0_NOTE, days, since, count: breakers.length, breakers }
}

// —— 成本卡（17-§8 成本趋势；docs/26 C1 冻结口径的展示面） ——

/** 单日成本点：LLM 岛 / 收割 / 预算三类三口径分列，**不相加**（docs/26 C1） */
export interface DailyCostPoint {
  /** UTC 日（YYYY-MM-DD） */
  date: string
  /** LLM 岛成本：event='LLM' 的 cost_usd 求和（原始 double——models.ts 冻结：台账存原值，显示层自取整） */
  llm_cost_usd: number
  /** LLM 事件条数（零成本调用也计——「有 usage 零成本」口径） */
  llm_events: number
  /** 收割成本：work_records.cost_usd 求和（按 ended_at 日归桶；在途未计——成本未定） */
  harvest_cost_usd: number
  /** 已收口 run 条数（仅 ended 者计数） */
  harvest_runs: number
  /** 预算预留：kind=reserve 的 estimated_usd 求和（按 ts 日归桶） */
  reserve_usd: number
  /** 预算结算：kind=settle 的 actual_usd 求和（未记 actual 的结算行计 0，如实不折算） */
  settle_usd: number
  /** 预算拒绝：kind=refusal 的 estimated_usd 求和（被拒不产生实际成本，不入净额） */
  refusal_usd: number
  /** 预算净额 = reserve_usd − settle_usd（未释放的预留占用；可为负） */
  net_usd: number
}

/** 成本卡响应（/api/costs） */
export interface CostsSnapshot {
  days: number
  /** 口径说明（含分列不相加声明——docs/26 C1 展示面） */
  note: string
  /** 首桶 UTC 日起点（epoch ms） */
  since: number
  /** 恰 days 个桶（升序；空日零填充——趋势图不断轴） */
  series: DailyCostPoint[]
  /** 窗口合计（三口径仍分列） */
  totals: Omit<DailyCostPoint, 'date'>
}

/** 成本卡口径说明（响应体 note 原文——docs/26 C1 冻结口径的展示面声明） */
export const COSTS_NOTE =
  '口径（docs/26 C1 冻结）：LLM 岛成本与收割成本分列不相加（LLM 岛=LLM 事件 cost_usd，' +
  '收割=work_records.cost_usd，双口径并存禁止相加当总额）；预算净额 = reserve − settle' +
  '（refusal 被拒不产生实际成本，不计净额）；UTC 日切。'

/** 成本卡窗口参数缺省与上限（?days=） */
export const DEFAULT_COSTS_DAYS = 7
export const MAX_COSTS_DAYS = 90

/**
 * budgets 读面口径（store listBudgets 全量读面已落位，本卡为其消费接线）：本聚合直连
 * ledger.listBudgets({since})——无 scope 维、不依赖镜像枚举；无镜像行的 scope
 * （如手插预算未镜像对应单据）同样可见（旧「镜像枚举近似」时代的无镜像不可见缺口已消）。
 */
export const COSTS_BUDGETS_BASIS_NOTE =
  'budgets 走 store listBudgets 全量读面（since 起 ts 闭区间，与日桶窗口同界）；' +
  '无镜像行的 scope 预算同样可见'

/**
 * 成本卡一次收集（双序列 + 收割分列列）：
 *   ① events：queryEvents({since: 首桶}) 拉回后滤 event='LLM'（事件名维 panel 侧滤）；
 *   ② work_records：listWorkRecords 全量，ended_at 落窗者按 ended 日归桶（在途不计）；
 *   ③ budgets：listBudgets({since}) 全量读面（见 COSTS_BUDGETS_BASIS_NOTE）按 ts 日归桶。
 * 桶集恰 days 个（now 所在 UTC 日收尾），空日零填充。
 */
export function buildCostsSnapshot(ledger: Ledger, options?: { now?: number; days?: number }): CostsSnapshot {
  const now = options?.now ?? Date.now()
  const days = options?.days ?? DEFAULT_COSTS_DAYS
  const since = dayStartOf(now) - (days - 1) * DAY_MS

  const points: DailyCostPoint[] = []
  for (let i = 0; i < days; i += 1) {
    points.push({
      date: dayKeyOf(since + i * DAY_MS),
      llm_cost_usd: 0,
      llm_events: 0,
      harvest_cost_usd: 0,
      harvest_runs: 0,
      reserve_usd: 0,
      settle_usd: 0,
      refusal_usd: 0,
      net_usd: 0,
    })
  }
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

  // ③ budgets 全量读面：since 下界由读面闭区间保证（ts >= since，与旧 scope 枚举的
  // b.ts < since 滤除同界——首桶 UTC 日界起点，ts 毫秒直用）；上界不传 until，对齐
  // ① events 口径（窗口外上界走 bucketIndex → undefined 防御性跳过，如时钟回拨语料）
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
    llm_cost_usd: 0,
    llm_events: 0,
    harvest_cost_usd: 0,
    harvest_runs: 0,
    reserve_usd: 0,
    settle_usd: 0,
    refusal_usd: 0,
    net_usd: 0,
  }
  for (const point of points) {
    totals.llm_cost_usd += point.llm_cost_usd
    totals.llm_events += point.llm_events
    totals.harvest_cost_usd += point.harvest_cost_usd
    totals.harvest_runs += point.harvest_runs
    totals.reserve_usd += point.reserve_usd
    totals.settle_usd += point.settle_usd
    totals.refusal_usd += point.refusal_usd
    totals.net_usd += point.net_usd
  }

  return { days, note: COSTS_NOTE, since, series: points, totals }
}

// —— 监控单页（零前端依赖、内联 CSS；丑没关系，信息覆盖是验收口径） ——

/** 极简 HTML 单页：六区块卡片（jobs/runs/workers/断路器/成本/事件流）+ fetch 轮询 + SSE 接事件流 */
export function renderDashboardPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Studio Next 监控 :8787</title>
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
<h1>Studio Next 监控（:8787 只读面）</h1>
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
