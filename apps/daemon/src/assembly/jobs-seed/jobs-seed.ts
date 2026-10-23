/**
 * 定时岗播种/移除（docs/18-§三 daemon 侧落点；docs/38-§2 L1 热重载移除对偶）
 *
 * 自 assembly/serve.ts 拆出（studio-dev-219，BC-S2 先拆再增纪律 §十五.三.3）：
 * serve.ts 行数基线只减不增——定时岗播种族与 serve 装配无耦合（纯台账面），
 * 整族平移零行为变；serve.ts 保留 re-export 面（既有 import 路径不破）。
 */
import type { CompanySnapshot, ScheduledJob } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'
import { nextRunAt } from '../../engine/scheduler.ts'

/** 播种缺省隔离窗（与 scheduler 缺省一致；坏 cron 走统一隔离路径——scheduler 会再计数+推后） */
const SEED_QUARANTINE_MS = 60 * 60_000

/** 播种结果（serve 启动面观测） */
export interface SeedJobsResult {
  seeded: number
  /** 既有行保序数（next_run_at 原样保留——欠账不清，首拍补跑） */
  kept: number
}

/**
 * 快照 jobs → 台账 jobs 表播种（jobs: true 时启动调用；18-§三 daemon 侧落点——现行
 * 入口=快照 jobs，公司目录 jobs 段装载归 packages/company 后续单）。新岗 next_run_at=
 * cron 下一槽不抢跑；**既有行原样保留**——重启不清欠账，错过槽位首拍补跑一次
 * （coalesce）；last_run_at 不在 upsert 列（store 契约）跑史恒真；坏 cron=now+隔离窗。
 */
export function seedJobs(
  ledger: Ledger,
  jobs: readonly ScheduledJob[],
  now: number,
): SeedJobsResult {
  let seeded = 0
  let kept = 0
  for (const job of jobs) {
    const existing = ledger.getJob(job.job_id)
    let next: number
    if (existing !== undefined) {
      next = existing.next_run_at
      kept += 1
    } else {
      try {
        const computed = nextRunAt(job.cron, now)
        next = computed === null ? now + SEED_QUARANTINE_MS : computed
      } catch {
        next = now + SEED_QUARANTINE_MS
      }
    }
    ledger.upsertJob({
      job_id: job.job_id,
      company: job.company,
      dept: job.dept,
      cron: job.cron,
      role: job.role,
      level: job.level,
      model_tier: job.model_tier,
      ...(job.budget_cap !== undefined ? { budget_cap: job.budget_cap.usd } : {}),
      ...(job.payload !== undefined ? { payload: job.payload } : {}),
      next_run_at: next,
    })
    if (existing === undefined) seeded += 1
  }
  return { seeded, kept }
}

/**
 * L1 热重载·调度岗移除（docs/38-§2 L1；18-§三「重注册对应岗、不动其他岗」的移除对偶）：
 * jobs 表中 company=本司、已不在新快照的岗 → removeJob（他司岗与其他来源岗不动）。
 * 在途岗单据照常走收割链（调度器只管「不再触发」）；意图消费面对消失岗已有明报丢弃面
 * （engine.ts「job 不在台账（热更移除？）——丢弃」）。
 */
export function removeMissingJobs(ledger: Ledger, snapshot: CompanySnapshot): number {
  const keep = new Set(snapshot.jobs.map((j) => j.job_id))
  let removed = 0
  for (const job of ledger.listJobs()) {
    if (job.company === snapshot.slug && !keep.has(job.job_id)) {
      ledger.removeJob(job.job_id)
      removed += 1
    }
  }
  return removed
}
