/**
 * workbench-chatd 存储域类型（Phase1 模块 C 最小刀 / P1-2 前半 + wake lease 最小刀 / P1-2 后半）。
 * 运行时状态形状（原 server.ts 内存 mock 结构）抽为共享类型：dispatch 语义与端点响应形状
 * （Transport v1 冻结面）不因存储模式（memory/sqlite）而变——SQLite 是同一状态的同构持久层。
 * 依据：docs/sentinel-logs/Phase1实现拆解-2026-11-17.md 模块 C（wake_lease/wake_delivery
 * TTL/重试/dead-letter；append-only 审计）＋ docs/sentinel-logs/提案-Phase1聊天服务-2026-11-17.md。
 */

/** 房间类型（Transport v1 冻结枚举）。 */
export type RoomKind = 'broadcast' | 'group' | 'dm'
/** wake 成因（Transport v1 冻结枚举）。 */
export type WakeCause = 'mention' | 'mention_all' | 'dm' | 'room'
/**
 * wake 状态机（DTO 投影，Transport v1 冻结枚举）：pending → claimed → acked。
 * 租约过期重投不回写 status（claimed + 过期 claimedUntil 即「待重投」）；dead-letter 是
 * 投递层终态（见 WakeLease.state），DTO 状态枚举不扩——claim 对 dead wake 回稳定错误。
 */
export type WakeStatus = 'pending' | 'claimed' | 'acked'

// ─── wake 租约/投递域（Phase1 模块 C 后半 / P1-2 wake lease 最小刀） ──────────
// 依据：docs/sentinel-logs/Phase1实现拆解-2026-11-17.md 模块 C（wake_lease/wake_delivery
// TTL/重试/dead-letter；append-only 审计）。wake_leases（当前租约投影，可覆盖写）+
// wake_events（投递审计，只追加不物理删）= 任务书 wake_leases/wake_deliveries 的等价两表。

/** 投递次数上限（首投计 1；超限 → dead-letter，不再重投）。文档口径「重试≤3」。 */
export const WAKE_MAX_DELIVERY_ATTEMPTS = 3

/** 租约/投递状态：pending 未投；leased 租约持有中；acked 已确认；dead 已 dead-letter。 */
export type WakeLeaseState = 'pending' | 'leased' | 'acked' | 'dead'

/** wake 当前租约（可变投影；SQLite 模式落 wake_leases 表，键=wake_id）。 */
export interface WakeLease {
  readonly wakeId: string
  /** 已开始的投递次数（leased 时为当前第几次投递）。 */
  readonly attempt: number
  readonly state: WakeLeaseState
  readonly claimedBy: string | null
  readonly leaseExpiresAt: number | null
  readonly updatedAt: number
}

/** 审计事件类型：created（建 wake）→ claimed（首投）/redelivered（过期重投）→ acked；dead_lettered=重试上限终态。 */
export type WakeEventType = 'created' | 'claimed' | 'redelivered' | 'acked' | 'dead_lettered'

/** wake 投递审计事件（append-only；SQLite 模式落 wake_events 表，只插入不 UPDATE/DELETE）。 */
export interface WakeEvent {
  /** 单调序（内存=计数器分配；SQLite=INTEGER PRIMARY KEY 显式同值写入，两模式一致）。 */
  readonly eventId: number
  readonly wakeId: string
  readonly type: WakeEventType
  /** 本事件所属投递次（created=0；dead_lettered=已耗尽的次数）。 */
  readonly attempt: number
  readonly actorId: string
  readonly claimedBy: string | null
  readonly leaseExpiresAt: number | null
  readonly at: number
}

export interface MockRoom {
  roomId: string
  kind: RoomKind
  name: string
  memberIds: string[]
  headRoomSeq: number
}

/** 冻结 Message 镜像（seq/roomSeq/roomId/senderId/body/mentions/createdAt）；messageId 仅内部幂等用。 */
export interface MockMessage {
  messageId: string
  seq: number
  roomSeq: number
  roomId: string
  senderId: string
  body: string
  mentions: string[]
  createdAt: number
}

export interface MockWake {
  wakeId: string
  actorId: string
  roomId: string
  /** 源消息定位序=目标消息在同房间内的 roomSeq（与 Transport v1 Message.roomSeq 对齐；非全局 seq）。 */
  sourceSeq: number
  cause: WakeCause
  status: WakeStatus
  claimedBy: string | null
  claimedUntil: number | null
  createdAt: number
  ackedAt: number | null
}

export interface MockState {
  readonly rooms: Map<string, MockRoom>
  readonly messages: MockMessage[]
  readonly wakes: MockWake[]
  /** wake 当前租约投影（P1-2 wake lease）：wakeId -> 租约态。 */
  readonly wakeLeases: Map<string, WakeLease>
  /** wake 投递审计（append-only，只 push 不改不删）。 */
  readonly wakeEvents: WakeEvent[]
  readonly reads: Map<string, number> // `${actorId}|${roomId}` -> lastReadRoomSeq
  readonly idempotency: Map<string, unknown> // scope|key -> 首次结果（replay 用）
  readonly startedAt: number
  roomSeq: number
  msgSeq: number
  wakeSeq: number
  /** 审计事件序（单调；SQLite 模式 hydrate 恢复为库内 MAX(event_id)）。 */
  wakeEventSeq: number
}

/** 全新空状态（内存 mock 与 SQLite hydrate 共用起点）。 */
export function createInitialState(): MockState {
  return {
    rooms: new Map(),
    messages: [],
    wakes: [],
    wakeLeases: new Map(),
    wakeEvents: [],
    reads: new Map(),
    idempotency: new Map(),
    startedAt: Date.now(),
    roomSeq: 0,
    msgSeq: 0,
    wakeSeq: 0,
    wakeEventSeq: 0,
  }
}

/** 存储模式：memory=内存 mock（缺省，向后兼容）；sqlite=node:sqlite 持久化（WORKBENCH_CHATD_DB）。 */
export type StoreMode = 'memory' | 'sqlite'

/**
 * 存储后端接口（write-through 钩子集）：dispatch 语义全部留在 server.ts，后端只负责
 * 「落库（DB 先行，失败抛错 → WB_INTERNAL）」与「启动 hydrate（重启恢复）」。
 * 内存模式实现为全 no-op，即 P1-1b 原行为。
 */
export interface ChatStore {
  readonly mode: StoreMode
  /**
   * 可注入时钟（C2.1 wake lease 加固）：wake 租约 TTL 判定与 send/claim/ack 时间戳的唯一时间源
   * （dispatch 不再直呼 Date.now）。构造参数注入，缺省 Date.now——生产行为不变；
   * 测试注入手动推进/跳变钟后，TTL 过期/重投/dead-letter 语义可零真实 sleep 覆盖。
   */
  readonly now: () => number
  /** 启动时从持久层回填状态与 seq 计数器（memory 模式 no-op）。 */
  hydrate(target: MockState): void
  insertRoom(room: MockRoom): void
  /** messages + 关联 wakes/租约/审计事件同事务追加（append-only）。 */
  appendMessage(message: MockMessage, wakes: readonly MockWake[], leases?: readonly WakeLease[], events?: readonly WakeEvent[]): void
  /** read 游标覆盖写（同键 upsert；值语义由 dispatch 保证单调不回退）。 */
  setRead(actorId: string, roomId: string, lastReadRoomSeq: number): void
  /** wake 状态覆盖写（claim/ack 后整行更新）。 */
  updateWake(wake: MockWake): void
  /**
   * wake 租约迁移原子落库（P1-2 wake lease）：wakes 投影行 + wake_leases 覆盖写 +
   * wake_events 审计追加，三写一事务（失败整体回滚 → 上层 WB_INTERNAL，内存不落地）。
   */
  recordWakeTransition(wake: MockWake, lease: WakeLease, event: WakeEvent): void
  /** 幂等键首次结果记录（JSON 序列化）。 */
  recordIdempotency(key: string, value: unknown): void
  close(): void
}
