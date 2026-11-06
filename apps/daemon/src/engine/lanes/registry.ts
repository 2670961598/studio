/**
 * lanes —— 泳道租约簿（进程内 v0 + epoch 栅栏；studio-dev-809 前沿对比 skein epoch fence）
 *
 * 语义冻结（原 engine.ts 同款逐行搬迁）：holder=单号；TTL 到期视同无主
 * （decide laneFree 同语义）。三面：state（观测快照）/acquire（派发占道）/
 * release（收割/失败释放——holder 校验防误放他单道）。
 *
 * studio-dev-809（P1）：租约加**单调 epoch**（每次成功 release/stop 递增，持久化经注入
 * `EpochStore` 落 daemon_kv；进程重启可恢复）。收割/合并/stop 等完成面携带 acquire 时
 * 取得的 epoch；`release(lane,ticket,epoch)`/`stop(...)` 对**旧 epoch 拒收**（stale-epoch，
 * 不写台账/不释放依赖/不推进状态），调用方据此落审计事件。`stop` 幂等：重复 stop 同
 * lane/ticket 只第一次生效并递增 epoch，后续返回 idempotent（不二次递增）。
 * 兼容面：不传 epoch 的旧调用保持 holder 校验旧语义（后续刀收口）。
 */
import type { TicketId } from '@studio-next/contract'

/** 泳道租约 */
export interface LaneLease {
  holder: TicketId
  expiresAt: number
  /** acquire 时的 epoch（完成面须原样带回，旧 epoch 拒收） */
  epoch: number
}

/** 泳道观测快照（无主=holder:null；epoch=当前计数——即使无主也可见） */
export interface LaneState {
  lane: string
  holder: string | null
  expiresAt?: number
  epoch: number
}

/** epoch 持久化端口（缺省=纯内存；daemon 注入 ledger kv） */
export interface EpochStore {
  read(key: string): number | undefined
  write(key: string, epoch: number): void
}

/** 释放/停止结果（stale=旧 epoch 拒收；idempotent=重复 stop/无主幂等） */
export type LeaseReleaseReason = 'released' | 'idempotent' | 'stale-epoch'
export interface LeaseReleaseResult {
  ok: boolean
  reason: LeaseReleaseReason
  /** 调用方携带的 epoch（未携带=-1） */
  epoch: number
  /** 操作后 registry 当前 epoch */
  currentEpoch: number
}

/** 泳道租约簿（TTL 随构造定——EngineConfig.laneTtlMs 注入） */
export interface LaneRegistry {
  state(lane: string): LaneState
  /** 占道；返回本租约 epoch（完成面携带） */
  acquire(lane: string, ticket: TicketId, at: number): number
  /** 当前 epoch（无主也返回计数） */
  epochOf(lane: string): number
  /** 是否仍是当前 epoch（完成面前置校验；stale=拒收） */
  isCurrent(lane: string, epoch: number): boolean
  /**
   * 续租（studio-dev-812 后续单：lane 每拍续命，治 90s TTL 抢道→stale 重派）：
   * 仅当租约存在、holder===ticket、且（epoch 缺省或===当前 lease.epoch）时把 expiresAt
   * 推到 at+laneTtlMs 并返回 true；否则 false。**不 bump epoch**、不删租约、不改
   * state/isCurrent/release/stop 语义。
   */
  renew(lane: string, ticket: TicketId, at: number, epoch?: number): boolean
  /** 释放（epoch 在场则栅栏校验；缺省=兼容旧 holder 校验） */
  release(lane: string, ticket: TicketId, epoch?: number): LeaseReleaseResult
  /** stop 闩（幂等；与 release 同栅栏语义） */
  stop(lane: string, ticket: TicketId, epoch?: number): LeaseReleaseResult
}

export function createLaneRegistry(laneTtlMs: number, store?: EpochStore): LaneRegistry {
  const lanes = new Map<string, LaneLease>()
  const epochs = new Map<string, number>()
  const load = (lane: string): number => {
    const cached = epochs.get(lane)
    if (cached !== undefined) return cached
    const persisted = store?.read(`lane:${lane}`)
    const value = persisted !== undefined && Number.isSafeInteger(persisted) && persisted >= 0 ? persisted : 0
    epochs.set(lane, value)
    return value
  }
  const bump = (lane: string): number => {
    const next = load(lane) + 1
    epochs.set(lane, next)
    store?.write(`lane:${lane}`, next)
    return next
  }
  const releaseInternal = (lane: string, ticket: TicketId, epoch: number | undefined): LeaseReleaseResult => {
    const current = load(lane)
    const lease = lanes.get(lane)
    // 无租约=已 stop/释放 → 幂等（重复 stop 不报 stale、不二次递增）
    if (lease === undefined) {
      return { ok: false, reason: 'idempotent', epoch: epoch ?? -1, currentEpoch: current }
    }
    // 有租约但 epoch 不符=迟到完成/乱序释放 → stale 拒收（先于 holder 判定）
    if (epoch !== undefined && epoch !== current) {
      return { ok: false, reason: 'stale-epoch', epoch, currentEpoch: current }
    }
    if (lease.holder !== ticket) {
      return { ok: false, reason: 'idempotent', epoch: epoch ?? -1, currentEpoch: current }
    }
    lanes.delete(lane)
    const next = bump(lane)
    return { ok: true, reason: 'released', epoch: epoch ?? lease.epoch, currentEpoch: next }
  }
  return {
    state(lane: string): LaneState {
      const lease = lanes.get(lane)
      const epoch = load(lane)
      if (lease === undefined) return { lane, holder: null, epoch }
      return { lane, holder: lease.holder, expiresAt: lease.expiresAt, epoch }
    },
    acquire(lane: string, ticket: TicketId, at: number): number {
      const epoch = load(lane)
      lanes.set(lane, { holder: ticket, expiresAt: at + laneTtlMs, epoch })
      return epoch
    },
    epochOf: (lane) => load(lane),
    isCurrent: (lane, epoch) => epoch === load(lane),
    renew(lane: string, ticket: TicketId, at: number, epoch?: number): boolean {
      const lease = lanes.get(lane)
      if (lease === undefined || lease.holder !== ticket) return false
      if (epoch !== undefined && epoch !== lease.epoch) return false
      lease.expiresAt = at + laneTtlMs
      return true
    },
    release: (lane, ticket, epoch) => releaseInternal(lane, ticket, epoch),
    stop: (lane, ticket, epoch) => releaseInternal(lane, ticket, epoch),
  }
}

/**
 * 每拍续租宿主（studio-dev-812 后续单）：结构探测——engine runtime 的 inflight/lanes 满足此形。
 * 只处理带 lane 的在途 entry（lane 恒有；laneEpoch 可选——缺 epoch 时按 holder 续）。
 */
export interface LaneRenewHost {
  readonly inflight: ReadonlyMap<TicketId, { readonly ticket: TicketId; readonly lane: string; readonly laneEpoch?: number }>
  readonly lanes: LaneRegistry
}

/**
 * 每拍续租：遍历在途 entry，按 ticket/lane/laneEpoch 调 lanes.renew；幂等、失败静默。
 * 返回实际续租条数（观测/测试用；不落台账）。必须在 state-diff 决策前执行（相位 1 头/
 * tick 入口），否则 TTL 到期瞬间 decide 会先看到无主而抢道。
 */
export function renewLaneLeases(host: LaneRenewHost, at: number): number {
  let renewed = 0
  for (const entry of host.inflight.values()) {
    if (host.lanes.renew(entry.lane, entry.ticket, at, entry.laneEpoch)) renewed += 1
  }
  return renewed
}
