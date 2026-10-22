/**
 * freshness —— 定时岗新鲜度窗哨兵源（127-A R2，studio-dev-127 §4.3 批示④全批；
 * docs/35-§3 计时器族第三源——与 sla-timer 同族：tick 驱动、零内存态、事件派生幂等）
 *
 * 语义口径（本文件冻结，测试逐条钉死）：
 *   - **判据**：`now > next_run_at + grace + dstAdj`（调度表既有字段——红队 R2-2 采纳）。
 *     `dstAdj=|tzOffset(slot)−tzOffset(now)|×60s`：cron 按本机时区解析，DST 切换日
 *     offset 差即豁免量（条款②机械落法——切换窗口既不误报红也不静默，如实扩窗）。
 *   - **grace 解析序**：payload.grace_ms（org-config jobs[].grace 逐岗声明）> cadence
 *     档缺省（hourly 10min / daily 2h / weekly 12h——批示④；monthly/quarterly 就近
 *     粗档 12h【拟稿：稀疏岗宽窗从宽】）> cron 周期桶（≤90min→10min、≤36h→2h、
 *     else→12h；croner 双跑点差推算，解析失败从宽 12h）。
 *   - **分诊**：从未跑过（last_run_at 空）单列 LATE_FIRST_RUN——配置坏≠跑了没产出
 *     （红队 R2-3：JOB_STALE note 四元组分诊停机/移除/物化失败/真停跑）。
 *   - **四元组**（JOB_STALE/LATE_FIRST_RUN note 携带，B 面板消费面）：hb_age（末
 *     HEARTBEAT 龄；无心跳如实 '-'）/ job_status / patrol_age（该岗末次 PATROL 龄；
 *     从未物化 '-'）/ last_success_age（该岗单据末次 GATE_PASS 龄；never 如实）。
 *   - **幂等**：同岗同槽只告一次（dedup 键=job@<next_run_at>，从本源事件 note 派生——
 *     重启天然恢复）；新槽位新记账（补跑/到点推进 next_run_at 即换键）；同槽重试不绕
 *     引擎意图幂等（PATROL 键 append-only，条款①）。
 *   - **退出管辖**：job 行不在（热更移除）即出扫描集；status∈逃逸档白名单
 *     {paused,manual,offline,下线} 跳过（C1 manual 旗——JobRecord.status 值域 v0 未锁，
 *     白名单冻结于本文件，值域收口归 core 调度域后续单）。
 *   - **处置**：只落事件+处置动作词（note 处置=手动补跑），不产意图不自动补跑——
 *     补跑预算放大由制作人裁量（红队漏项 4）；手动入口=CLI `jobs catchup`
 *     （新槽位语义，同槽重试幂等不冲突）。
 *   - **事件锚**：心跳哨兵单（heartbeatIssue，DEV-49 同法——平台级告警无业务单可挂；
 *     events.issue NOT NULL 的诚实占位）。
 */
import type { EventRecord, InvokeIntent, InvokeSource, SourceManifest } from '@studio-next/contract'
import { parseJobOps } from '@studio-next/company'
import type { JobRecord, Ledger } from '@studio-next/store'
import { makeUlid } from '../tools/id.ts'
import { nextRunAt } from '../scheduler.ts'

/** 新鲜度源名 */
export const FRESHNESS_SOURCE_NAME = 'freshness-timer'

export const FRESHNESS_SOURCE_MANIFEST: SourceManifest = {
  name: FRESHNESS_SOURCE_NAME,
  kind: 'escalate',
  configSchema: 'daemon.yaml freshness（新鲜度窗哨兵——扫描轮询复用 jobPollMs）',
}

/** grace 分档缺省（批示④冻结：hourly 10min/daily 2h/weekly 12h；稀疏档就近从宽） */
export const GRACE_TIER_DEFAULTS_MS: Readonly<Record<string, number>> = Object.freeze({
  hourly: 10 * 60_000,
  daily: 2 * 3_600_000,
  weekly: 12 * 3_600_000,
  monthly: 12 * 3_600_000,
  quarterly: 12 * 3_600_000,
})

/** cron 周期桶缺省（无档位无逐岗声明的兜底面；解析失败从宽 12h） */
const GRACE_CRON_BUCKETS: ReadonlyArray<{ maxIntervalMs: number; graceMs: number }> = Object.freeze([
  { maxIntervalMs: 90 * 60_000, graceMs: 10 * 60_000 },
  { maxIntervalMs: 36 * 3_600_000, graceMs: 2 * 3_600_000 },
])

/** 逃逸档白名单（manual 旗/暂停/下线——热更移除的显式语义面） */
const FRESHNESS_SKIP_STATUS: ReadonlySet<string> = new Set(['paused', 'manual', 'offline', '下线'])

/** 岗的 grace 解析（序：逐岗声明 > 档缺省 > cron 桶；永不 undefined——兜底 12h） */
export function graceMsFor(job: JobRecord, now: number): number {
  const ops = parseJobOps(job.payload)
  if (ops.grace_ms !== undefined && ops.grace_ms > 0) return ops.grace_ms
  const tier = ops.cadence?.tier
  if (tier !== undefined) {
    const byTier = GRACE_TIER_DEFAULTS_MS[tier]
    if (byTier !== undefined) return byTier
  }
  // cron 周期桶：双跑点差推算 interval（nextRunAt 复用调度器解析面——零新轮子；
  // croner 对坏表达式是抛不是返 null——装载闸外直写面兜住，从宽 12h 不炸源轮询）
  let a: number | null
  let b: number | null
  try {
    a = nextRunAt(job.cron, now)
    b = a !== null ? nextRunAt(job.cron, a) : null
  } catch {
    return 12 * 3_600_000
  }
  if (a === null || b === null || b <= a) return 12 * 3_600_000
  const interval = b - a
  for (const bucket of GRACE_CRON_BUCKETS) {
    if (interval <= bucket.maxIntervalMs) return bucket.graceMs
  }
  return 12 * 3_600_000
}

/** DST 豁免量：slot 与 now 的时区 offset 差（分钟→ms；同 offset=0 零影响） */
export function dstAdjustMs(slotTs: number, nowTs: number): number {
  return Math.abs(new Date(slotTs).getTimezoneOffset() - new Date(nowTs).getTimezoneOffset()) * 60_000
}

/** 新鲜度源单次扫描报告（观测/测试断言） */
export interface FreshnessReport {
  ts: number
  /** 扫描岗数（本司在册、非逃逸档） */
  jobs: number
  /** 本拍落账 JOB_STALE 数 */
  stale: number
  /** 本拍落账 LATE_FIRST_RUN 数 */
  lateFirstRun: number
}

/** 新鲜度源运行面计数 */
export interface FreshnessSourceStats {
  polls: number
  stale: number
  lateFirstRun: number
  /** 轮询体异常（吞掉不炸——源侧契约 25-§3.4.5） */
  errors: number
}

/** 新鲜度源依赖 */
export interface FreshnessSourceDeps {
  ledger: Ledger
  clock: () => number
  /** 公司 slug（jobs/events 过滤——一源一公司） */
  company: string
  /** 扫描轮询间隔 ms */
  intervalMs: number
  /** 心跳哨兵单号（事件锚——DEV-49 同法，engine config.heartbeatIssue 同源 '-'） */
  heartbeatIssue: string
  /** 事件 id 生成器（缺省 makeUlid——测试可注入确定性 id） */
  makeId?: (ts: number) => string
  /** 事件 actor（缺省 'daemon'） */
  actor?: string
  log?: (line: string) => void
}

/** 新鲜度源句柄：InvokeSource 端口 + 手动泵 + 计数 */
export interface FreshnessSource extends InvokeSource {
  poll(): FreshnessReport
  readonly stats: FreshnessSourceStats
}

/**
 * createFreshnessSource —— tick 驱动的新鲜度窗哨兵。
 * 零内存态：每拍全量重读 jobs 表+events 派生（在管集/已告集）——重启天然幂等。
 * 只落事件（JOB_STALE/LATE_FIRST_RUN）；无意图面（处置=手动 CLI 补跑，不自动重派）。
 */
export function createFreshnessSource(deps: FreshnessSourceDeps): FreshnessSource {
  const log = deps.log ?? ((): void => undefined)
  const makeId = deps.makeId ?? makeUlid
  const stats: FreshnessSourceStats = { polls: 0, stale: 0, lateFirstRun: 0, errors: 0 }
  let timer: ReturnType<typeof setInterval> | undefined
  let running = false

  /** 本源已告集：JOB_STALE/LATE_FIRST_RUN note 携 src=freshness → `job@slot` 键集 */
  function firedSlots(events: readonly EventRecord[]): Set<string> {
    const keys = new Set<string>()
    for (const e of events) {
      if (e.event !== 'JOB_STALE' && e.event !== 'LATE_FIRST_RUN') continue
      if (!(e.note ?? '').includes(`src=${FRESHNESS_SOURCE_NAME}`)) continue
      const job = /(?:^|;)job=([^;]+)/.exec(e.note ?? '')
      const slot = /(?:^|;)slot=([^;]+)/.exec(e.note ?? '')
      if (job !== null && slot !== null) keys.add(`${job[1]}@${slot[1]}`)
    }
    return keys
  }

  /** 四元组数据面（单次扫描派生）：job→末次 PATROL/GATE_PASS；公司级末次 HEARTBEAT */
  interface JobAges {
    lastPatrolTs: number | undefined
    lastSuccessTs: number | undefined
  }
  function jobAges(events: readonly EventRecord[]): Map<string, JobAges> {
    const ticketsOfJob = new Map<string, Set<string>>() // PATROL job= 锚 → 岗单集
    const ages = new Map<string, JobAges>()
    for (const e of events) {
      if (e.event !== 'PATROL') continue
      const m = /(?:^|;)job=([^;]+)/.exec(e.note ?? '')
      if (m === null) continue
      const jobId = m[1] as string
      if (!ticketsOfJob.has(jobId)) ticketsOfJob.set(jobId, new Set())
      ;(ticketsOfJob.get(jobId) as Set<string>).add(e.issue)
      const cur = ages.get(jobId)
      if (cur === undefined || cur.lastPatrolTs === undefined || e.ts > cur.lastPatrolTs) {
        ages.set(jobId, { ...cur, lastPatrolTs: e.ts } as JobAges)
      }
    }
    for (const e of events) {
      if (e.event !== 'GATE_PASS') continue
      for (const [jobId, tickets] of ticketsOfJob) {
        if (!tickets.has(e.issue)) continue
        const cur = ages.get(jobId)
        if (cur === undefined || cur.lastSuccessTs === undefined || e.ts > cur.lastSuccessTs) {
          ages.set(jobId, { lastPatrolTs: cur?.lastPatrolTs, lastSuccessTs: e.ts })
        }
      }
    }
    return ages
  }

  function poll(): FreshnessReport {
    const now = deps.clock()
    stats.polls += 1
    const events = deps.ledger.queryEvents({ company: deps.company })
    const fired = firedSlots(events)
    const ages = jobAges(events)
    const lastHeartbeat = [...events].reverse().find((e) => e.event === 'HEARTBEAT')
    let scanned = 0
    let staleNow = 0
    let lateNow = 0
    for (const job of deps.ledger.listJobs()) {
      if (job.company !== deps.company) continue
      if (job.status !== undefined && FRESHNESS_SKIP_STATUS.has(job.status)) continue // 逃逸档
      scanned += 1
      const slotKey = `${job.job_id}@${job.next_run_at}`
      const grace = graceMsFor(job, now)
      const adj = dstAdjustMs(job.next_run_at, now)
      if (now <= job.next_run_at + grace + adj) continue // 窗内
      if (fired.has(slotKey)) continue // 同岗同槽已告（幂等）
      const age = ages.get(job.job_id)
      const firstRun = job.last_run_at === undefined
      const note =
        `${firstRun ? '从未跑过（配置坏≠跑了没产出）' : '停跑（now>next_run_at+grace）'}` +
        `；src=${FRESHNESS_SOURCE_NAME};job=${job.job_id};slot=${job.next_run_at}` +
        `;grace=${grace};adj=${adj}` +
        `;hb_age=${lastHeartbeat === undefined ? '-' : `${now - lastHeartbeat.ts}`}` +
        `;job_status=${job.status ?? 'active'}` +
        `;patrol_age=${age?.lastPatrolTs === undefined ? '-' : `${now - age.lastPatrolTs}`}` +
        `;last_success_age=${age?.lastSuccessTs === undefined ? 'never' : `${now - age.lastSuccessTs}`}` +
        `;last_run_at=${job.last_run_at ?? '-'}` +
        `;处置=手动补跑（studio-next jobs catchup <db> ${job.job_id}——新槽位语义；预算放大由制作人裁量）`
      deps.ledger.appendEvent({
        id: makeId(now),
        ts: now,
        company: deps.company,
        issue: deps.heartbeatIssue,
        event: firstRun ? 'LATE_FIRST_RUN' : 'JOB_STALE',
        actor: deps.actor ?? 'daemon',
        attempt: 1,
        level: Math.max(1, Math.min(9, job.level)),
        dept: job.dept,
        tokens: { input: 0 },
        note,
      })
      fired.add(slotKey) // 本拍内同键不重发
      if (firstRun) {
        lateNow += 1
        stats.lateFirstRun += 1
      } else {
        staleNow += 1
        stats.stale += 1
      }
      log(`[freshness] 岗 ${job.job_id} 越窗（slot=${job.next_run_at}，grace=${grace}ms）→ ${firstRun ? 'LATE_FIRST_RUN' : 'JOB_STALE'} 落账`)
    }
    return { ts: now, jobs: scanned, stale: staleNow, lateFirstRun: lateNow }
  }

  return {
    name: FRESHNESS_SOURCE_NAME,
    start(_emit: (intent: InvokeIntent) => void): void {
      if (running) return
      running = true
      timer = setInterval(() => {
        try {
          poll()
        } catch (err) {
          stats.errors += 1
          log(`[freshness] 轮询异常（已吞不炸循环）：${err instanceof Error ? err.message : String(err)}`)
        }
      }, deps.intervalMs)
      timer.unref()
    },
    stop(): void {
      running = false
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
    },
    poll,
    get stats(): FreshnessSourceStats {
      return { ...stats }
    },
  }
}

/**
 * FlowTable `T:<type>` 键 → 类型 id 集（装载警告判定面；表 undefined=空集——
 * 形状面小工具，不 import FlowTable 实型（保持 jobs 域对 typeflows 的零依赖））。
 */
export function declaredTypeIdsOf(flows: Readonly<Record<string, unknown>> | undefined): ReadonlySet<string> {
  const out = new Set<string>()
  if (flows === undefined) return out
  for (const key of Object.keys(flows)) {
    if (key.startsWith('T:')) out.add(key.slice(2))
  }
  return out
}

/**
 * 岗契约装载警告（127-A §4.1/§4.4 丁案配套——serve 启动与热重载 apply 双面调用）：
 *   ① patrol 岗无 T:patrol 类型流——物化回退 L0 终态（语义退化：镜像仍计「已交付」）；
 *   ② patrol 岗声明 output——结构性零产出组合（无 worker 无产物，落点永空——诚实化修法
 *      =org-config 摘 output 或改型 report）。
 * 警告不阻断（既有配置不炸——错误级收口归配置面批示）；T:patrol 只经 org-config
 * workflows 声明（DEV-43），故判定面=快照 workflows 而非引擎流表。
 */
export function jobContractLoadWarnings(
  jobs: readonly { job_id: string; payload?: unknown }[],
  declaredTypeIds: ReadonlySet<string>,
): string[] {
  const out: string[] = []
  for (const job of jobs) {
    const payload = job.payload
    const type =
      typeof payload === 'object' && payload !== null && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).type
        : undefined
    if (type !== 'patrol') continue
    if (!declaredTypeIds.has('patrol')) {
      out.push(`岗 ${job.job_id}：type=patrol 但 workflows 未声明 patrol 类型流——物化回退 L0 终态「已交付」（127-A 丁案语义退化；修法=org-config workflows.types 增 patrol 流）`)
    }
    const output =
      typeof payload === 'object' && payload !== null && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).output
        : undefined
    if (typeof output === 'string' && output !== '') {
      out.push(`岗 ${job.job_id}：type=patrol 与 output 并存——巡查工件结构性零产出，落点 ${output} 永空（127-A §4.1 诚实化：摘 output 或改型 report）`)
    }
  }
  return out
}

/** serve 装配薄壳（127-A）：装载警告落 log——启动与热重载 apply 双面同调用（tag 区分） */
export function logJobContractWarnings(
  jobs: readonly { job_id: string; payload?: unknown }[],
  flows: Readonly<Record<string, unknown>> | undefined,
  log: (line: string) => void,
  tag = '',
): void {
  for (const w of jobContractLoadWarnings(jobs, declaredTypeIdsOf(flows))) log(`[serve] 岗契约警告${tag}：${w}`)
}
