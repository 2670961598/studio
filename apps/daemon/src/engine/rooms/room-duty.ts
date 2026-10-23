/**
 * 单据房间义务面（130-P3 频道供给扩展，130 提案 §6.7.1 需求行/§6.7.3-④；DEV-20 P9/P10）——
 * daemon 侧结构同形接口（hr-face.ts 的 MatrixHrTarget 同款纪律）：engine 只认本接口，
 * 具体装配（@studio-next/matrix provision）在 apps/boot 组合根——daemon 本体零 matrix
 * import（docs/20-§十五 依赖方向冻结；25-§一.2 唯一受准例外=boot）。
 *
 * 生命周期挂钩（主循环七相位冻结面，docs/17-§2）：
 *   - onDispatched：派发相位成功派发后（DISPATCH 落账点后）→ ensureTicketRoom（幂等）
 *   - onClosed：回收相位 CLOSE 后 → archiveTicketRoom（events_default→50 + 名称前缀，幂等）
 *
 * 失败面契约（DEV-20 P9/P10 冻结）：供给失败**不阻断**派工/回收主路径——房间是沟通面
 * 不是执行前置；engine 捕获异常落 ESCALATE 事件明报（幂等重跑收敛，S8 判负线=重跑漂移）。
 * 未注入（matrixChannels 关）=零行为变更。
 */
import type { PersonId, TicketId } from '@studio-next/contract'

/** onDispatched 入参：单据房间规划所需的最小事实（title 进房间显示名；dept 缺省回落派工对象部门） */
export interface RoomDutyDispatchArgs {
  ticket: TicketId
  title: string
  dept?: string
  assignee: PersonId
}

export interface RoomDuty {
  /** 派发成功 → 开/修补单据房间 `#<slug>-<单号小写>`（成员按 D7 规则解析——装配侧持快照）。
   * slug 恰一次语义（studio-dev-218）：单号已携 slug 前缀（Taiga ref 形 studio-dev-212）
   * 不再叠前缀——别名公式见 packages/matrix ticketAliasLocalpart。 */
  onDispatched(args: RoomDutyDispatchArgs): Promise<void>
  /** 关单 → 房间只读归档（幂等：重复 PUT 同值收敛；骑缝单先探 canonical 再探旧双 slug 形） */
  onClosed(args: { ticket: TicketId }): Promise<void>
}

// ————————————————————————— serve 装配面（130-P3 ③工序：公司频道地图 ensure） —————————————————————————

/**
 * 供给面快照视图（CompanySnapshot 的结构子集——structural typing 直传，零拷贝零 import 面）：
 * departments/people/groups 的供给消费字段（130 §6.7.1 成员列推导输入）。
 */
export interface RoomFaceSnapshotInput {
  slug: string
  name: string
  departments: ReadonlyArray<{ path: string; name: string; leader: string }>
  people: ReadonlyArray<{ id: string; login: string; dept: string; role?: string; status?: string }>
  groups?: ReadonlyArray<{ id: string; dept: string; name: string; leader?: string; members: readonly string[] }>
}

/** 公司频道供给报告（观测面：启动期/热重载日志锚；failures/problems=软失败不炸供给） */
export interface CompanyChannelsSupplyReport {
  ensured: number
  created: number
  problems: readonly string[]
  failures: readonly string[]
}

/** serve 级房间面（RoomDuty 生命周期两钩 + 启动期/热重载公司地图 ensure）——boot 结构实现 */
export interface MatrixRoomFace extends RoomDuty {
  ensureCompanyChannels(): Promise<CompanyChannelsSupplyReport>
}

/** 工厂注入上下文：snapshot 活取（L1 热重载整组换后下拍供给即新鲜面——docs/38-§2） */
export interface MatrixRoomFaceContext {
  snapshot: () => RoomFaceSnapshotInput
}

// ————————————————————————— 相位缝执行体（engine.ts 调用——失败语义在此收口） —————————————————————————

/**
 * 派发相位钩执行体：onDispatched 失败 → 回调落 ESCALATE（note 文案在此单源）。
 * 沟通面不阻派发：异常吞进回调不上抛（幂等重跑收敛，S8 判负线=重跑漂移）。
 */
export async function dispatchRoomDuty(rooms: RoomDuty, args: RoomDutyDispatchArgs, escalate: (note: string) => void): Promise<void> {
  try {
    await rooms.onDispatched(args)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    escalate(`单据房间供给失败：${msg}（沟通面不阻派发；ensure 幂等，重启/下拍重跑收敛——130-P3/DEV-20 P9）`)
  }
}

/** 回收相位钩执行体：onClosed 失败 → 回调落 ESCALATE 不阻回收（归档幂等重跑收敛） */
export async function closeRoomDuty(rooms: RoomDuty, ticket: TicketId, escalate: (note: string) => void): Promise<void> {
  try {
    await rooms.onClosed({ ticket })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    escalate(`单据房间归档失败：${msg}（归档幂等，重跑收敛——130-P3/DEV-20 P10）`)
  }
}
