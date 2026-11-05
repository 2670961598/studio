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
function rejectStaleCompletion(
  rt: EngineRuntime,
  entry: { ticket: string; attempt: number; lane: string; workRecordId: string },
  stale: { kind: 'lane' | 'merge'; key: string; epoch: number; current: number },
  tickEvents: EventRecord[],
  errors: string[],
): 'failed' {
  errors.push(
    `租约 epoch 陈旧：${stale.kind}=${stale.key} ticket=${entry.ticket} epoch=${String(stale.epoch)} current=${String(stale.current)}——迟到完成拒收（不写台账/不释放依赖/不推进状态）`,
  )
  const carrier = { id: entry.ticket } as IssueRecord
  rt.makeEvent('ESCALATE', carrier, entry.attempt, tickEvents, {
    note: `lease-epoch-stale;${stale.kind}=${stale.key};epoch=${String(stale.epoch)};current=${String(stale.current)};ticket=${entry.ticket}——迟到完成/写入/释放依赖一律拒收（studio-dev-809 epoch fence；无台账事实写入）`,
  })
  rt.inflight.delete(entry.ticket)
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
      if (stale !== undefined) return Promise.resolve(rejectStaleCompletion(rt, entry, stale, tickEvents, errors))
      return finalizeHarvest(rt, adapter, entry, tickEvents, errors)
    },
    fault: (entry, detail, requirements) => {
      const stale = staleLeaseOf(rt, entry)
      if (stale !== undefined) return Promise.resolve(rejectStaleCompletion(rt, entry, stale, tickEvents, errors))
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
