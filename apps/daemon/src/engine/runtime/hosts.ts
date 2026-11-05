/**
 * engine/runtime/hosts.ts —— 域宿主装配（收割尝试宿主／STALL 响置宿主）
 *
 * 20-§十五「按域拆件、零行为变更」：两宿主原为 createEngine 内闭包装配，逐字迁出——
 * 字段值同源（batches／sliceMs／now／registry 解析；platform／ledger／inflight／config／
 * lanes／flowOf／transitionHostOf／makeEvent／断路链／活性探测与分级阈值）。判定体仍归
 * 各自域件：收割=harvest/batch.ts＋harvest/finalize.ts，STALL=watchdog/stall-response.ts。
 */
import type { EventRecord, IssueRecord } from '@studio-next/contract'
import type { HarvestAttemptHost } from '../harvest/batch.ts'
import { effectiveStallAfterMs, probeInflightActivity } from '../watchdog/liveness.ts'
import type { StallResponseHost } from '../watchdog/stall-response.ts'
import { failHarvest, finalizeHarvest } from '../harvest/finalize.ts'
import { recoverStaleTicket } from '../recovery/orphan-recovery.ts'
import type { EngineRuntime } from './types.ts'

/** 租约 epoch 陈旧检测（studio-dev-809）：完成面携带 epoch ≠ registry 当前 epoch → 拒收 */
function staleLeaseOf(rt: EngineRuntime, entry: { ticket: string; lane: string; laneEpoch?: number; mergeRun?: { leaseKey: string; leaseEpoch?: number } }):
  | { kind: 'lane' | 'merge'; key: string; epoch: number; current: number }
  | undefined {
  if (entry.mergeRun?.leaseEpoch !== undefined) {
    const current = rt.mergeLeases.epochOf(entry.mergeRun.leaseKey)
    if (!rt.mergeLeases.isCurrent(entry.mergeRun.leaseKey, entry.mergeRun.leaseEpoch)) {
      return { kind: 'merge', key: entry.mergeRun.leaseKey, epoch: entry.mergeRun.leaseEpoch, current }
    }
  }
  if (entry.laneEpoch !== undefined) {
    const current = rt.lanes.epochOf(entry.lane)
    if (!rt.lanes.isCurrent(entry.lane, entry.laneEpoch)) {
      return { kind: 'lane', key: entry.lane, epoch: entry.laneEpoch, current }
    }
  }
  return undefined
}

/** 陈旧完成面拒收：审计 ESCALATE + 丢弃 inflight；不写台账/不释放依赖/不推进状态 */
/** 同一旧 entry 判别（studio-dev-838 F1）：workRecordId+attempt+epoch（lane/merge）同源=同单同 attempt 旧完成 */
function isSameInflightEntry(
  a: { ticket: string; attempt: number; workRecordId: string; laneEpoch?: number; mergeRun?: { leaseEpoch?: number } },
  b: { ticket: string; attempt: number; workRecordId: string; laneEpoch?: number; mergeRun?: { leaseEpoch?: number } },
): boolean {
  return (
    a.workRecordId === b.workRecordId &&
    a.attempt === b.attempt &&
    (a.laneEpoch ?? undefined) === (b.laneEpoch ?? undefined) &&
    (a.mergeRun?.leaseEpoch ?? undefined) === (b.mergeRun?.leaseEpoch ?? undefined)
  )
}

async function rejectStaleCompletion(
  rt: EngineRuntime,
  entry: { ticket: string; attempt: number; lane: string; workRecordId: string; laneEpoch?: number; mergeRun?: { leaseEpoch?: number } },
  stale: { kind: 'lane' | 'merge'; key: string; epoch: number; current: number },
  tickEvents: EventRecord[],
  errors: string[],
): Promise<'failed'> {
  errors.push(
    `租约 epoch 陈旧：${stale.kind}=${stale.key} ticket=${entry.ticket} epoch=${String(stale.epoch)} current=${String(stale.current)}——迟到完成拒收（不写台账/不释放依赖/不推进状态）`,
  )
  const carrier = { id: entry.ticket } as IssueRecord
  // studio-dev-838 F1：先判「新 epoch inflight 在场」再删——新 epoch 已接管时保留其在途、
  // 绝不因旧完成到达而删除新 inflight，也不回退平台状态（冲突面只审计）。
  const currentInflight = rt.inflight.get(entry.ticket)
  const sameEntry = currentInflight !== undefined && isSameInflightEntry(entry, currentInflight)
  const newEpochTakenOver = currentInflight !== undefined && !sameEntry
  rt.makeEvent('ESCALATE', carrier, entry.attempt, tickEvents, {
    note: newEpochTakenOver
      ? `lease-epoch-stale-ignored-new-epoch;${stale.kind}=${stale.key};epoch=${String(stale.epoch)};current=${String(stale.current)};ticket=${entry.ticket}——旧 epoch 迟到完成被拒；新 epoch inflight 在场（保留、不回退平台状态）`
      : `lease-epoch-stale;${stale.kind}=${stale.key};epoch=${String(stale.epoch)};current=${String(stale.current)};ticket=${entry.ticket}——迟到完成/写入/释放依赖一律拒收（studio-dev-809 epoch fence；无台账事实写入）`,
  })
  if (newEpochTakenOver) {
    errors.push(
      `租约 epoch 陈旧（新 epoch 已接管）：${entry.ticket} 旧完成被拒，保留新 inflight（workRecordId=${currentInflight.workRecordId} attempt=${String(currentInflight.attempt)}）——不回退平台状态`,
    )
    return 'failed'
  }
  rt.inflight.delete(entry.ticket)
  // studio-dev-838：孤票兜底——lane stale 且平台仍=已派发、无新 inflight/新 holder → 回退新单
  // （下一拍活动/镜像重决策自动重派；merge stale 不在此回退——合并失败面另有手工链语义）
  if (stale.kind === 'lane') {
    try {
      const recovered = await recoverStaleTicket(rt, entry.ticket, entry.attempt, entry.lane, tickEvents, errors)
      errors.push(
        recovered
          ? `孤票兜底：${entry.ticket} 已回退新单（lane=${entry.lane} epoch 陈旧）——下一拍自动重派`
          : `孤票兜底跳过：${entry.ticket}（新 epoch 已接管/状态已非已派发/lane 有新 holder——幂等不双写）`,
      )
    } catch (err) {
      errors.push(`孤票兜底异常 ${entry.ticket}：${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return 'failed'
}

/** 收割尝试宿主（IMPL-06-03 拆件接线）：编排体在 harvest/batch.ts，判定体在 harvest/finalize.ts */
export function harvestHostOf(rt: EngineRuntime, tickEvents: EventRecord[], errors: string[]): HarvestAttemptHost {
  return {
    batches: rt.harvestBatches,
    sliceMs: rt.config.harvestSliceMs,
    now: rt.now,
    resolveAdapter: (executor) => rt.registry.resolve(executor),
    finalize: (adapter, entry) => {
      const stale = staleLeaseOf(rt, entry)
      if (stale !== undefined) return rejectStaleCompletion(rt, entry, stale, tickEvents, errors)
      return finalizeHarvest(rt, adapter, entry, tickEvents, errors)
    },
    fault: (entry, detail, requirements) => {
      const stale = staleLeaseOf(rt, entry)
      if (stale !== undefined) return rejectStaleCompletion(rt, entry, stale, tickEvents, errors)
      return failHarvest(rt, entry, tickEvents, detail, requirements)
    },
  }
}

/**
 * STALL 响置宿主（studio-dev-505：响置体拆件 engine/watchdog/stall-response.ts；
 * 本处只装配引擎运行时——活性探测/分级阈值/断路/迁移/事件面同源，判定仍在 core decide）。
 */
export function stallHostOf(rt: EngineRuntime, errors: string[]): StallResponseHost {
  return {
    platform: rt.platform,
    ledger: rt.ledger,
    registry: rt.registry,
    inflight: rt.inflight,
    config: rt.config,
    lanes: rt.lanes,
    flowOf: rt.flowOf,
    transitionHostOf: rt.transitionHostOf,
    makeEvent: rt.makeEvent,
    strikeBreaker: rt.strikeBreaker,
    now: rt.now,
    currentSeq: () => rt.seq,
    workerKeysEnabled: rt.workerKeys !== undefined,
    probeActivity: (entry, at) => probeInflightActivity(entry, at),
    effectiveStallAfterMs: (executor) => effectiveStallAfterMs(rt.config.stallAfterMs, rt.config.stallAfterMsByExecutor, executor),
    // 会话归档收口问题进 tick errors（studio-dev-551：缺失/写失败明报，不静默）
    reportProblem: (message) => errors.push(message),
  }
}
