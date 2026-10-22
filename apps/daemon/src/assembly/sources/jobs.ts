/**
 * sources-jobs —— 岗位域唤起源注册群（serve.ts 拆出——20-§十五.三 先拆再增，
 * studio-dev-177 单C 让位 cost-threshold 源注册缝）。
 *
 * 四源（各自开关缺省关——不声明=零注册零行为）：
 *   - cadence 档位展开器（35-§3）：档位岗调度表生命周期；到点意图走既有
 *     scheduler→scheduleIntent 链（复用调度器 tick 零新轮子——jobs: true 才有 tick 面）；
 *   - sla-timer（35-§3）：tick 驱动扫在途岗单据——first-ack/升级链超时产 escalate
 *     意图 + ESCALATE 落账（只产意图+落账；notify 发送归 notify 端口后续刀）；
 *   - freshness（127-A R2）：越窗落 JOB_STALE/LATE_FIRST_RUN 事件；处置=CLI 手动补跑；
 *   - cost-threshold（132-§6.4 单C·studio-dev-177）：tick 驱动扫当日用量投影+在途
 *     预留——达档产 escalate 意图 + ESCALATE 落账（payload.class='cost-threshold'，
 *     129 消费面）。guard/people getter 闭包快照（热更经 applyCompanyUpdate 整组换
 *     ——摘段=undefined=面关零行为）；declared=models.yaml 三档（快照桥兜底）。
 */
import type { CostGuardConfig, ModelTier, PersonRef, ScheduledJob } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'
import { createCadenceSource, createSlaSource, CADENCE_SOURCE_MANIFEST, SLA_SOURCE_MANIFEST } from '../../engine/jobs-sources.ts'
import { COST_THRESHOLD_SOURCE_MANIFEST, createCostThresholdSource } from '../../engine/cost-guard/source.ts'
import { createFreshnessSource, FRESHNESS_SOURCE_MANIFEST } from '../../engine/jobs/freshness.ts'
import type { SourceRegistry } from '../../engine/sources.ts'

/** 注册群依赖（serve 侧闭包快照 getter——热更整组换后 getter 取新值） */
export interface JobSourceRegistration {
  sources: SourceRegistry
  /** 四源开关（ServeConfig 面：cadence/sla/freshness/costGuard）+ company/jobPollMs */
  flags: { cadence: boolean; sla: boolean; freshness: boolean; costGuard: boolean; company: string; jobPollMs: number }
  ledger: Ledger
  clock: () => number
  /** 心跳哨兵 issue（company 级 ESCALATE 挂账——EngineConfig.heartbeatIssue 同源） */
  heartbeatIssue: string
  /** company 级事件 dept 兜底 */
  deptFallback: string
  /** 快照 getter 群（热更面） */
  jobs: () => readonly ScheduledJob[]
  people: () => readonly PersonRef[]
  guard: () => CostGuardConfig | undefined
  /** models.yaml 三档声明面（快照桥兜底；态 B=undefined 只信快照） */
  declared?: readonly ModelTier[] | undefined
  log: (line: string) => void
}

export function registerJobSources(d: JobSourceRegistration): void {
  if (d.flags.cadence) {
    d.sources.register(
      createCadenceSource({
        ledger: d.ledger,
        clock: d.clock,
        intervalMs: d.flags.jobPollMs,
        jobs: d.jobs,
        log: d.log,
      }),
      CADENCE_SOURCE_MANIFEST,
    )
  }

  if (d.flags.sla) {
    d.sources.register(
      createSlaSource({ ledger: d.ledger, clock: d.clock, company: d.flags.company, intervalMs: d.flags.jobPollMs, log: d.log }),
      SLA_SOURCE_MANIFEST,
    )
  }

  if (d.flags.freshness) {
    d.sources.register(
      createFreshnessSource({
        ledger: d.ledger,
        clock: d.clock,
        company: d.flags.company,
        intervalMs: d.flags.jobPollMs,
        heartbeatIssue: d.heartbeatIssue,
        log: d.log,
      }),
      FRESHNESS_SOURCE_MANIFEST,
    )
  }

  if (d.flags.costGuard) {
    d.sources.register(
      createCostThresholdSource({
        ledger: d.ledger,
        clock: d.clock,
        company: d.flags.company,
        guard: d.guard,
        people: d.people,
        ...(d.declared !== undefined ? { declared: d.declared } : {}),
        deptFallback: d.deptFallback,
        heartbeatIssue: d.heartbeatIssue,
        intervalMs: d.flags.jobPollMs,
        log: d.log,
      }),
      COST_THRESHOLD_SOURCE_MANIFEST,
    )
  }
}
