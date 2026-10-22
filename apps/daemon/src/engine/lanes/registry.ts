/**
 * lanes —— 泳道租约簿（进程内 v0；自 engine.ts 拆出——20-§十五.三 先拆再增，
 * studio-dev-177 单C 让位 cost-guard 缝）。
 *
 * 语义冻结（原 engine.ts 同款逐行搬迁）：holder=单号；TTL 到期视同无主
 * （decide laneFree 同语义）。三面：state（观测快照）/acquire（派发占道）/
 * release（收割/失败释放——holder 校验防误放他单道）。
 */
import type { TicketId } from '@studio-next/contract'

/** 泳道租约 */
export interface LaneLease {
  holder: TicketId
  expiresAt: number
}

/** 泳道观测快照（无主=holder:null） */
export interface LaneState {
  lane: string
  holder: string | null
  expiresAt?: number
}

/** 泳道租约簿（TTL 随构造定——EngineConfig.laneTtlMs 注入） */
export interface LaneRegistry {
  state(lane: string): LaneState
  acquire(lane: string, ticket: TicketId, at: number): void
  release(lane: string, ticket: TicketId): void
}

export function createLaneRegistry(laneTtlMs: number): LaneRegistry {
  const lanes = new Map<string, LaneLease>()
  return {
    state(lane: string): LaneState {
      const lease = lanes.get(lane)
      if (lease === undefined) return { lane, holder: null }
      return { lane, holder: lease.holder, expiresAt: lease.expiresAt }
    },
    acquire(lane: string, ticket: TicketId, at: number): void {
      lanes.set(lane, { holder: ticket, expiresAt: at + laneTtlMs })
    },
    release(lane: string, ticket: TicketId): void {
      const lease = lanes.get(lane)
      if (lease !== undefined && lease.holder === ticket) lanes.delete(lane)
    },
  }
}
