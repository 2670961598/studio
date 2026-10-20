/**
 * scheduler —— 定时岗调度器：croner 驱动 + 错过补跑 + 定时岗意图源（v0.4，16-§四）
 *
 * 规格依据（实现单引用）：
 *   - docs/16-§四 v0.4「首个定时岗（健康巡检）：daemon 跑起一个 cron 岗，结果落台账」；
 *     16-§二 选型表：自建 SQLite 调度表（next_run_at/last_run_at，启动补跑 due 槽）+
 *     croner 解析表达式（APScheduler 补跑语义无现成库——补的是所有库都缺的持久化壳）。
 *   - docs/18-§三 调度设计：jobs 表 {job_id, cron, next_run_at, last_run_at…}；
 *     错过补跑=启动/每拍扫 next_run_at<=now，多槽合并跑一次（coalesce）；
 *     同岗同刻只允许一个实例（不重叠）；croner 只当表达式解析+触发引擎。
 *   - docs/22-§一/§二 唤起源：**源只产意图，绝不直接驱动 worker**——本调度器是
 *     schedule 源的引擎侧落点（onDue 回调产 InvokeIntent kind='schedule'，决策归主循环）。
 *   - docs/17-§2 调度表：「定时岗全部来自公司目录配置（D9）；启动时扫 due 槽补跑
 *     coalesce 成一次」；调度器不是控制面——唤起后一切走主循环状态机（18-§三 状态归位）。
 *
 * 语义说明（本文件口径，测试逐条钉死）：
 *   - **补跑 coalesce 天然内含**：dueJobs(now) 把 next_run_at<=now 的都算 due——无论错过
 *     几个槽，行里只有一个过期的 next_run_at，触发一次后 next_run_at 直接从「现在」重算
 *     （croner.nextRun(now)），多槽错过合并为一次触发（APScheduler coalescing 语义）。
 *   - **同岗不重叠（双触发面）**：先 markRan 再 onDue。markRan 是单条 UPDATE（两列同语句
 *     移动，无中间态可观测——store/ledger.ts 头注），触发瞬间 next_run_at 已越过 now，
 *     并发/重入再查 due 不见它。**job 运行期的 overrun 保护不在本层**：每次触发产独立
 *     意图进主循环，上一轮还在途时由引擎侧泳道/在途闸排队（调度器不是控制面）。
 *   - **坏 cron 隔离**：croner 构造/求值抛错或 nextRun=null（无未来槽）→ 该 job 计数+日志
 *     不炸调度器；next_run_at 推后一个隔离窗（quarantineMs）再试——**last_run_at 不动**
 *     （upsert 的 ON CONFLICT 不含该列，不伪造跑史）。隔离窗到期重新可见，配置修复即自愈。
 *   - **热更**：调度器无状态轮询（每拍重查 dueJobs），任何 upsertJob 覆盖（公司目录改动/
 *     API/测试）下一拍天然生效——单岗热更他岗不动 = 各行独立 UPDATE 的自然推论。
 *   - **前向不变式**：markRan 写入的 next_run_at 恒 > now（croner 求值后夹 max(next, now+1)），
 *     保证触发后行不再 due——不夹会在「表达式解析出 <= now 的槽」时同岗原地自旋。
 *   - 时区：croner 默认按系统本地时区解析（模板 org-config 注释「cron 一律按制作人机器
 *     本地时区解析」一致）。
 *
 * 诚实边界（本刀不做，头注列明）：
 *   - 48h 连续无故障运行证据（16-§四 v0.4 验收）归后续运维演习单——本刀做机制；
 *   - 真实系统岗（报表/审查/巡逻的实职任务书）不属本刀——demo 样例岗只验全链；
 *   - markRan 已提交而进程崩溃于 onDue 前：该次触发丢失（at-most-once）——意图落台账前
 *     无持久化队列；已物化的岗单据经活动流重启后仍可被主循环接管（engine.ts 头注）；
 *   - croner 的 interval/protect/maxRuns 等运行时选项不使用（触发节奏全由 next_run_at 投影
 *     决定，croner 只做表达式求值——18-§三「croner 当引擎」的持久化壳落法）。
 */
import { Cron } from 'croner'
import type { JobRecord, Ledger } from '@studio-next/store'

/** 调度器依赖（全注入：台账面 + 时钟 + 回调 + 轮询间隔） */
export interface SchedulerDeps {
  ledger: Ledger
  /** 时钟注入（一切时刻经此——core 纪律在 daemon 侧同形落点） */
  clock: () => number
  /** due 触发回调：先 markRan 后回调；只产意图不直接干活（22-§一 源纪律） */
  onDue: (job: JobRecord, firedAt: number) => void
  /** 轮询间隔 ms（serve 侧可配 jobPollMs） */
  intervalMs: number
  /** 坏 cron 隔离窗 ms（缺省 60 分钟：错误可见但不刷屏；last_run_at 不动） */
  quarantineMs?: number
  /** 日志面（缺省静默；serve 接 console.log） */
  log?: (line: string) => void
}

/** 调度器运行面计数（观测/测试断言） */
export interface SchedulerStats {
  polls: number
  fired: number
  cronErrors: number
  lastCronError?: { job_id: string; message: string; at: number }
}

/** 单次轮询报告 */
export interface SchedulerReport {
  ts: number
  /** 本拍 due 行数（触发前快照） */
  due: number
  fired: number
  cronErrors: number
}

/** 调度器句柄：poll 手动泵（测试/显式驱动）；start/stop 常驻轮询 */
export interface Scheduler {
  poll(): SchedulerReport
  start(): void
  stop(): void
  readonly running: boolean
  readonly stats: SchedulerStats
}

/**
 * cron 表达式 → 下一次应跑时刻（epoch ms）。
 * 只求值不排程：paused 实例不挂定时器（croner 的运行时触发面不用）。
 * 坏表达式=构造即抛（调用方负责隔离）；无未来槽=返回 null。
 */
export function nextRunAt(cron: string, after: number): number | null {
  const c = new Cron(cron, { paused: true })
  const next = c.nextRun(new Date(after))
  return next === null ? null : next.getTime()
}

/**
 * createScheduler —— 薄轮询壳：每拍 dueJobs → 逐行 {markRan 先行 → onDue}。
 * 单线程同步泵（ledger 是同步面）：intervalMs 定时器只做「什么时候再问」，
 * 状态全在 jobs 表——stop/start/重启零恢复逻辑（可重建投影的调度面推论）。
 */
export function createScheduler(deps: SchedulerDeps): Scheduler {
  const { ledger, clock, onDue, intervalMs } = deps
  const quarantineMs = deps.quarantineMs ?? 60 * 60_000
  const log = deps.log ?? ((): void => undefined)
  const stats: SchedulerStats = { polls: 0, fired: 0, cronErrors: 0 }
  let timer: ReturnType<typeof setInterval> | undefined
  let running = false

  function poll(): SchedulerReport {
    const at = clock()
    const due = ledger.dueJobs(at)
    stats.polls += 1
    let fired = 0
    let cronErrors = 0
    for (const job of due) {
      let next: number
      try {
        const n = nextRunAt(job.cron, at)
        if (n === null) {
          throw new Error(`表达式无未来槽（nextRun=null）：${job.cron}`)
        }
        // 前向不变式：触发后 next_run_at 必越过 now（防同岗原地自旋）
        next = Math.max(n, at + 1)
      } catch (err) {
        // 坏 cron 隔离：计数+日志+隔离窗推后；last_run_at 不动（不伪造跑史）
        const message = err instanceof Error ? err.message : String(err)
        cronErrors += 1
        stats.cronErrors += 1
        stats.lastCronError = { job_id: job.job_id, message, at }
        ledger.upsertJob({ ...job, next_run_at: at + quarantineMs })
        log(`[scheduler] job ${job.job_id} cron 不合法（${message}）——隔离 ${Math.round(quarantineMs / 60_000)} 分钟后再试，last_run_at 不动`)
        continue
      }
      // 同岗不重叠：先标记（单语句原子），标记已成败再回调——onDue 内外再查 due 不见它
      const moved = ledger.markRan(job.job_id, at, next)
      if (!moved) {
        log(`[scheduler] job ${job.job_id} markRan 时行已消失（热更移除）——本次不触发`)
        continue
      }
      fired += 1
      stats.fired += 1
      onDue(job, at)
    }
    return { ts: at, due: due.length, fired, cronErrors }
  }

  function start(): void {
    if (running) throw new Error('scheduler 已在运行（start 不可重入）')
    running = true
    timer = setInterval(() => {
      try {
        poll()
      } catch (err) {
        // 轮询体异常（如台账 IO）不炸定时器：如实计数留日志，下一拍再问
        log(`[scheduler] 轮询异常（已吞不炸循环）：${err instanceof Error ? err.message : String(err)}`)
      }
    }, intervalMs)
    timer.unref()
  }

  function stop(): void {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
    running = false
  }

  return {
    poll,
    start,
    stop,
    get running(): boolean {
      return running
    },
    get stats(): SchedulerStats {
      return { ...stats }
    },
  }
}

/**
 * schedule 意图构造（22-§二 表「定时查单」源的意图形态）：
 * kind='schedule'，payload 携 job_id，dedupKey=job_id+触发时刻（无 ticket 意图必填，
 * 主循环按 (source, kind, company, dedupKey) 幂等——invoke.ts v1.3）。
 * **只产意图不直接干活**：意图进引擎 ingest，由 decide 决定唤起与否。
 */
export function scheduleIntent(job: JobRecord, firedAt: number): {
  kind: 'schedule'
  company: string
  payload: { job_id: string }
  source: string
  dedupKey: string
  priority: number
} {
  return {
    kind: 'schedule',
    company: job.company,
    payload: { job_id: job.job_id },
    source: 'scheduler',
    dedupKey: `${job.job_id}@${firedAt}`,
    priority: 2,
  }
}
