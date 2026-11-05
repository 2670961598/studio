/**
 * lanes/release —— 泳道释放 epoch 守卫（studio-dev-812；809 围栏残余面收口）
 *
 * 809 已给 registry 加 epoch 栅栏；但四处 legacy 调用点仍无 epoch 释放（dispatch 失败/
 * 批示打回/回收/消亡面），且 stall-response A 面 kill 前未消费 stale。本件提供统一守卫：
 *   - `epochOfInflight`：inflight 在途 epoch 优先（同一 attempt 的租约）；
 *   - `releaseWithEpoch`：**禁止无 epoch 释放**——epoch 缺失=skipped+errors 审计（不猜）；
 *     返回既有 LeaseReleaseResult（released/stale-epoch/idempotent），不抛错、不新增事件词；
 *   - `releaseTicketLane`：inflight epoch 优先；无 inflight 时仅当 holder===ticket 用
 *     state.epoch；否则跳过（他单持有/无租约=幂等零行为）。`skipIfInflight=true` 时
 *     inflight 在场即跳过+errors 审计（防批示打回/回收误放新 attempt 的租约）。
 */
import type { TicketId } from '@studio-next/contract'
import type { Inflight } from '../tick/types.ts'
import type { LaneRegistry, LeaseReleaseResult } from './registry.ts'

/** inflight 的泳道 epoch（无 inflight/无 epoch=undefined） */
export function epochOfInflight(
  inflight: ReadonlyMap<TicketId, Pick<Inflight, 'laneEpoch'>>,
  ticket: TicketId,
): number | undefined {
  return inflight.get(ticket)?.laneEpoch
}

/** 带 epoch 释放；epoch 缺失=skipped（禁止无 epoch 释放），审计进 errors（不抛） */
export function releaseWithEpoch(
  lanes: LaneRegistry,
  input: { lane: string; ticket: TicketId; epoch: number | undefined },
  errors?: string[],
): LeaseReleaseResult {
  if (input.epoch === undefined) {
    errors?.push(`泳道释放跳过：${input.ticket}@${input.lane} 无 epoch 来源——禁止无 epoch 释放（812 fail-closed）`)
    return { ok: false, reason: 'idempotent', epoch: -1, currentEpoch: lanes.epochOf(input.lane) }
  }
  return lanes.release(input.lane, input.ticket, input.epoch)
}

/**
 * 统一释放规则（4 处 legacy 面）：
 *   ① inflight 在场且 skipIfInflight=true → 跳过+errors（新 attempt 在途，防误放新 lease）；
 *   ② inflight.laneEpoch 优先；
 *   ③ 无 inflight → 仅 holder===ticket 用 state.epoch（显式携带，仍非无 epoch 调用）；
 *   ④ 他单持有/无租约 → 零行为跳过。
 * 返回 undefined=跳过；返回结果供调用方审计 stale（不抛）。
 */
export function releaseTicketLane(
  lanes: LaneRegistry,
  inflight: ReadonlyMap<TicketId, Pick<Inflight, 'laneEpoch'>>,
  ticket: TicketId,
  lane: string,
  errors?: string[],
  opts?: { skipIfInflight?: boolean },
): LeaseReleaseResult | undefined {
  const entry = inflight.get(ticket)
  if (entry !== undefined) {
    if (opts?.skipIfInflight === true) {
      errors?.push(
        `泳道释放跳过：${ticket} 新 attempt inflight 在场（laneEpoch=${String(entry.laneEpoch)}）——不释放新租约（812）`,
      )
      return undefined
    }
    return releaseWithEpoch(lanes, { lane, ticket, epoch: entry.laneEpoch }, errors)
  }
  const state = lanes.state(lane)
  if (state.holder !== ticket) return undefined
  return releaseWithEpoch(lanes, { lane, ticket, epoch: state.epoch }, errors)
}
