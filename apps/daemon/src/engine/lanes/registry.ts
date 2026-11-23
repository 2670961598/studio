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
 *
 * LOCAL-329 泳道容量域（docs/quality/lane-capacity.md §1-§3；2026-11-24 事故 #488 落单）：
 *   - 每泳道＝租约集 `Map<ticket, lease>`（多槽）；容量＝`laneCapacity[lane]`（未配置=1）；
 *   - **容量 1＝单持有者旧语义逐字节不变**（既有测试/契约/golden 零改动——§2 等价证明）；
 *   - 容量>1：活跃（未过期）租约数 < 容量才可再占道（decide laneFree 同口径，超额＝
 *     HOLD_LANE_BUSY）；`acquire` 满员**拒收**（返回 `LANE_FULL`=-1，不静默逐出活租约——
 *     fail-closed；引擎链路 decide 先闸，满员面只防直连误用）；过期租约不占容量（acquire
 *     占道即清）；同单重 acquire＝原位刷新、保 epoch（不占新槽、不 bump——execute 二次
 *     acquire 与 state-diff 首占同一 epoch）；
 *   - epoch 栅栏改**逐租约**：acquire 返回值唯一标识本租约——与他单共存时 bump 计数
 *     （新 epoch > 一切已发 epoch ⇒ 同泳道在册租约 epoch 两两不同）；release/stop/renew
 *     按 ticket+epoch 精确到单租约；`isCurrent` ＝「在册租约中存在同 epoch」（容量 1 下
 *     在册租约 epoch 恒＝计数，与旧「epoch===计数」等价）。
 *   - `state()` 兼容面：holder/expiresAt＝最早占道者（容量 1＝旧快照原样，过期死租约也
 *     可见）；新增 `holders`（占道序全量快照）与 `capacity`。
 */
import type { TicketId } from '@studio-next/contract'

/** 泳道租约 */
export interface LaneLease {
  holder: TicketId
  expiresAt: number
  /** acquire 时的 epoch（完成面须原样带回，旧 epoch 拒收；多槽下＝本租约唯一标识） */
  epoch: number
}

/** 在册租约快照（LOCAL-329 多槽观测面；序＝占道序） */
export interface LaneHolderSnapshot {
  ticket: TicketId
  expiresAt: number
  epoch: number
}

/** 泳道观测快照（无主=holder:null；epoch=当前计数——即使无主也可见） */
export interface LaneState {
  lane: string
  holder: string | null
  expiresAt?: number
  epoch: number
  /** 在册租约全量快照（LOCAL-329；容量 1 下恒 0/1 条——旧观测面零变化） */
  holders: LaneHolderSnapshot[]
  /** 泳道容量（LOCAL-329；未配置=1） */
  capacity: number
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

/** 泳道容量上限（LOCAL-329：单泳道同拍多写冲突面随槽数放大，1..8 封顶） */
export const LANE_CAPACITY_MAX = 8

/** `acquire` 满员拒收返回值（epoch ≥0 为合法租约；-1＝未占道） */
export const LANE_FULL = -1

/**
 * daemon.yaml `laneCapacity` 解析即验（LOCAL-329；serve/config 唯一入口）：
 * JSON 对象 `{lane: 槽位}`；泳道名非空字符串、槽位 1..LANE_CAPACITY_MAX 整数；坏值抛
 * `daemon.yaml：laneCapacity …`（CONFIG_INVALID 启动拒，与 tierExecutors 同款 fail-closed）。
 * 空串/`{}`＝空表（全部泳道容量 1）。
 */
export function parseLaneCapacity(raw: string): Record<string, number> {
  const text = raw.trim()
  if (text === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new Error(
      `daemon.yaml：laneCapacity 须为 JSON 对象（如 '{"core":4,"qa":2}'；解析失败：${err instanceof Error ? err.message : String(err)}）`,
    )
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`daemon.yaml：laneCapacity 须为 JSON 对象（实得 ${text}）`)
  }
  const out: Record<string, number> = {}
  for (const [lane, slots] of Object.entries(parsed)) {
    if (lane.trim() === '') {
      throw new Error('daemon.yaml：laneCapacity 泳道名不得为空字符串')
    }
    if (typeof slots !== 'number' || !Number.isInteger(slots) || slots < 1 || slots > LANE_CAPACITY_MAX) {
      throw new Error(`daemon.yaml：laneCapacity[${lane}] 须为 1..${LANE_CAPACITY_MAX} 的整数（实得 ${String(slots)}）`)
    }
    out[lane] = slots
  }
  return out
}

/** 泳道租约簿（TTL 随构造定——EngineConfig.laneTtlMs 注入；容量表＝EngineConfig.laneCapacity） */
export interface LaneRegistry {
  state(lane: string): LaneState
  /**
   * 占道；返回本租约 epoch（完成面携带）。同单重占＝原位刷新保 epoch；他单共存＝bump
   * 取新 epoch；泳道满员（他单活跃数 ≥ 容量且本单无租约）＝拒收返回 `LANE_FULL`（-1）。
   */
  acquire(lane: string, ticket: TicketId, at: number): number
  /** 当前 epoch（无主也返回计数） */
  epochOf(lane: string): number
  /** 是否仍是当前 epoch（在册租约中存在同 epoch；stale=拒收） */
  isCurrent(lane: string, epoch: number): boolean
  /**
   * 续租（studio-dev-812 后续单：lane 每拍续命，治 90s TTL 抢道→stale 重派）：
   * 仅当**本单租约**存在、且（epoch 缺省或===该租约 epoch）时把该租约 expiresAt
   * 推到 at+laneTtlMs 并返回 true；否则 false。**不 bump epoch**、不删租约、不改
   * state/isCurrent/release/stop 语义；只续本租约，不触及同泳道他单租约。
   */
  renew(lane: string, ticket: TicketId, at: number, epoch?: number): boolean
  /** 释放（epoch 在场则栅栏校验；缺省=兼容旧 holder 校验） */
  release(lane: string, ticket: TicketId, epoch?: number): LeaseReleaseResult
  /** stop 闩（幂等；与 release 同栅栏语义） */
  stop(lane: string, ticket: TicketId, epoch?: number): LeaseReleaseResult
}

/** 容量解析（配置面已解析即验；此处兜底 fail-closed 到 1——非法值只可能来自直连误用） */
function capacityOf(laneCapacity: Readonly<Record<string, number>> | undefined, lane: string): number {
  const slots = laneCapacity?.[lane]
  return typeof slots === 'number' && Number.isInteger(slots) && slots >= 1 && slots <= LANE_CAPACITY_MAX ? slots : 1
}

export function createLaneRegistry(
  laneTtlMs: number,
  store?: EpochStore,
  laneCapacity?: Readonly<Record<string, number>>,
): LaneRegistry {
  // 每泳道租约集（LOCAL-329；容量 1 下恒 ≤1 条——与旧单槽 Map 等价）
  const lanes = new Map<string, Map<TicketId, LaneLease>>()
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
    const set = lanes.get(lane)
    const mine = set?.get(ticket)
    // 本单无在册租约：泳道空=已 stop/释放 → 幂等（重复 stop 不报 stale、不二次递增）
    if (mine === undefined && (set === undefined || set.size === 0)) {
      return { ok: false, reason: 'idempotent', epoch: epoch ?? -1, currentEpoch: current }
    }
    // epoch 栅栏逐租约（LOCAL-329）：本单租约在场=比对该租约 epoch；不在场而他单在册=
    // 比对当前计数（旧 epoch 拒收——容量 1 下与旧实现逐分支等价，见 docs §2）
    const fence = mine !== undefined ? mine.epoch : current
    if (epoch !== undefined && epoch !== fence) {
      return { ok: false, reason: 'stale-epoch', epoch, currentEpoch: current }
    }
    // 本单无租约而他单持有：非本单之道，不可误放 → 幂等零行为
    if (mine === undefined) {
      return { ok: false, reason: 'idempotent', epoch: epoch ?? -1, currentEpoch: current }
    }
    set?.delete(ticket)
    if (set !== undefined && set.size === 0) lanes.delete(lane)
    const next = bump(lane)
    return { ok: true, reason: 'released', epoch: epoch ?? mine.epoch, currentEpoch: next }
  }
  return {
    state(lane: string): LaneState {
      const set = lanes.get(lane)
      const epoch = load(lane)
      const holders: LaneHolderSnapshot[] = set === undefined ? [] : [...set.values()].map((l) => ({ ticket: l.holder, expiresAt: l.expiresAt, epoch: l.epoch }))
      const capacity = capacityOf(laneCapacity, lane)
      const first = holders[0]
      if (first === undefined) return { lane, holder: null, epoch, holders, capacity }
      return { lane, holder: first.ticket, expiresAt: first.expiresAt, epoch, holders, capacity }
    },
    acquire(lane: string, ticket: TicketId, at: number): number {
      let set = lanes.get(lane)
      if (set === undefined) {
        set = new Map()
        lanes.set(lane, set)
      }
      // 过期死主不占容量：占道即清他单过期租约（本单租约原位刷新，保 epoch）
      for (const [holder, lease] of set) {
        if (holder !== ticket && lease.expiresAt <= at) set.delete(holder)
      }
      const own = set.get(ticket)
      // 满员拒收（本单无租约且在册他单数 ≥ 容量）：不逐出活租约、不改状态
      if (own === undefined && set.size >= capacityOf(laneCapacity, lane)) return LANE_FULL
      // 新租约：与他单共存＝bump 取唯一 epoch；空道＝沿用当前计数（容量 1＝旧语义）
      const epoch = own !== undefined ? own.epoch : set.size > 0 ? bump(lane) : load(lane)
      set.set(ticket, { holder: ticket, expiresAt: at + laneTtlMs, epoch })
      return epoch
    },
    epochOf: (lane) => load(lane),
    isCurrent: (lane, epoch) => {
      for (const lease of lanes.get(lane)?.values() ?? []) {
        if (lease.epoch === epoch) return true
      }
      return false
    },
    renew(lane: string, ticket: TicketId, at: number, epoch?: number): boolean {
      const lease = lanes.get(lane)?.get(ticket)
      if (lease === undefined) return false
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
