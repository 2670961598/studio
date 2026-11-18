/**
 * workbench-chatd 存储域类型（Phase1 模块 C 最小刀 / P1-2 前半）。
 * 运行时状态形状（原 server.ts 内存 mock 结构）抽为共享类型：dispatch 语义与端点响应形状
 * （Transport v1 冻结面）不因存储模式（memory/sqlite）而变——SQLite 是同一状态的同构持久层。
 * 依据：docs/sentinel-logs/Phase1实现拆解-2026-11-17.md 模块 C（最小 rooms/messages/read；C-mini 只做持久化，不接 vendor collab）。
 */

/** 房间类型（Transport v1 冻结枚举）。 */
export type RoomKind = 'broadcast' | 'group' | 'dm'
/** wake 成因（Transport v1 冻结枚举）。 */
export type WakeCause = 'mention' | 'mention_all' | 'dm' | 'room'
/** wake 状态机：pending → claimed → acked（claimed 可回 pending 语义不在 C-mini 范围）。 */
export type WakeStatus = 'pending' | 'claimed' | 'acked'

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
  readonly reads: Map<string, number> // `${actorId}|${roomId}` -> lastReadRoomSeq
  readonly idempotency: Map<string, unknown> // scope|key -> 首次结果（replay 用）
  readonly startedAt: number
  roomSeq: number
  msgSeq: number
  wakeSeq: number
}

/** 全新空状态（内存 mock 与 SQLite hydrate 共用起点）。 */
export function createInitialState(): MockState {
  return {
    rooms: new Map(),
    messages: [],
    wakes: [],
    reads: new Map(),
    idempotency: new Map(),
    startedAt: Date.now(),
    roomSeq: 0,
    msgSeq: 0,
    wakeSeq: 0,
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
  /** 启动时从持久层回填状态与 seq 计数器（memory 模式 no-op）。 */
  hydrate(target: MockState): void
  insertRoom(room: MockRoom): void
  /** messages + 关联 wakes 同事务追加（append-only）。 */
  appendMessage(message: MockMessage, wakes: readonly MockWake[]): void
  /** read 游标覆盖写（同键 upsert；值语义由 dispatch 保证单调不回退）。 */
  setRead(actorId: string, roomId: string, lastReadRoomSeq: number): void
  /** wake 状态覆盖写（claim/ack 后整行更新）。 */
  updateWake(wake: MockWake): void
  /** 幂等键首次结果记录（JSON 序列化）。 */
  recordIdempotency(key: string, value: unknown): void
  close(): void
}
