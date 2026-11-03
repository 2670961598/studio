/**
 * engine/records/state-map —— 平台流状态 ↔ 工作十态（ENU-03）映射与迁移边解析
 *
 * 依据（实现单必须引文档章节号）：
 *   - docs/v2/11 §5.2 / §14.1（工作十态 M-01..M-28 边集与「前置记录」列——边集唯一源
 *     契约包 records 入口的 `WORK_TRANSITIONS`（work-state），本件不重述边）；
 *   - docs/18-§2.1（v0.5 平台流状态模板：新单/待批/已派发/证据就绪/复验通过/已交付）；
 *   - docs/17-§2（相位×记录类型映射表；「状态桥接」段——2026-11-03 修订：跨态主干按
 *     **既有边的有序复合路径**逐边登记，不新增边、不合并状态）。
 *
 * 桥接口径（studio-dev-592 收口；不臆造）：
 *   1. 平台流状态**不是**工作十态：两套状态机语义不同（平台流=呈现/流转锚，工作十态=工作
 *      生命周期）。本映射是「生产写面接线」的桥接表，逐条可复核；L2 流「待批」出现两次
 *      （派发前/交付前），后一处不能反推 `pending_start`（反推歧义）——故 reverse 映射取
 *      首现位置，歧义状态不由 reverse 表驱动决策，只作用于迁移记录草案。
 *   2. 平台流一跳可能跨过工作十态中间态：L0 主干「新单→已派发」＝
 *      `intake→pending_start→in_progress`，对应 §14.1 **M-01→M-05 有序复合路径**（两条既有
 *      边、两条 REC-WORK-06）。复合路径是既有边的有序组合，**不新增边、不放宽为任意多跳**：
 *      只认 `PLATFORM_COMPOSITE_EDGES` 显式白名单；表外/回退/重开/返工一律返回 `[]`＝拒写
 *      （回退/返工语义归 REC-WORK-10/11）。
 *   3. 逐边前置记录（§14.1「前置记录」列）与决定面任一不齐＝**整条路径拒写**（不写半条）——
 *      判据在 `drafts.ts`，本件只解析边序列与生产者三分。
 */
import {
  WORK_STATES,
  WORK_TRANSITIONS,
  type WorkState,
  type WorkTransitionEdge,
} from '@studio-next/contract/records'

/** v0.5 平台流状态字面量（docs/18-§2.1 冻结模板；core DEFAULT_STATES 同值——本地不复述来源） */
export const PLATFORM_STATES = {
  fresh: '新单',
  approval: '待批',
  dispatched: '已派发',
  evidenceReady: '证据就绪',
  verified: '复验通过',
  delivered: '已交付',
} as const

/** 平台流状态 → 工作十态（ENU-03）：桥接表（首现位置；L2 第二处「待批」见头注缺口 1） */
export const PLATFORM_TO_WORK_STATE: Readonly<Record<string, WorkState>> = {
  [PLATFORM_STATES.fresh]: 'intake',
  [PLATFORM_STATES.approval]: 'pending_start',
  [PLATFORM_STATES.dispatched]: 'in_progress',
  [PLATFORM_STATES.evidenceReady]: 'awaiting_review',
  [PLATFORM_STATES.verified]: 'accepted',
  [PLATFORM_STATES.delivered]: 'settled',
}

/** 工作十态 → 平台流状态（反查；多义状态取首现，「待批」歧义见头注缺口 1） */
export const WORK_STATE_TO_PLATFORM: Readonly<Record<WorkState, string>> = {
  intake: PLATFORM_STATES.fresh,
  pending_start: PLATFORM_STATES.approval,
  in_progress: PLATFORM_STATES.dispatched,
  paused: PLATFORM_STATES.dispatched, // v0 无独立暂停态：暂停并入「已派发」（缺口登记于 plan）
  awaiting_review: PLATFORM_STATES.evidenceReady,
  rework: PLATFORM_STATES.dispatched, // 返工在平台侧回派发位（回退边，非主干）
  accepted: PLATFORM_STATES.verified,
  rejected: PLATFORM_STATES.delivered, // 拒绝终局在平台侧落已交付（回收相位收口）
  terminated: PLATFORM_STATES.delivered,
  settled: PLATFORM_STATES.delivered,
}

/** 工作十态全集（契约 ENU-03 投影；桥接表覆盖自检用） */
export const WORK_STATE_SET: ReadonlySet<string> = new Set(WORK_STATES)

/**
 * 平台主干「跨态复合路径」白名单（docs/17-§2「状态桥接」段 2026-11-03 修订）。
 * 键＝`<平台 from>→<平台 to>`；值＝§14.1 边号有序序列（必须首尾相接）。
 * 只登记**已发生且跨过中间态**的主干跳；不在此表且非单边的迁移＝表外（拒写）。
 */
export const PLATFORM_COMPOSITE_EDGES: Readonly<Record<string, readonly string[]>> = {
  [`${PLATFORM_STATES.fresh}→${PLATFORM_STATES.dispatched}`]: ['M-01', 'M-05'],
}

/**
 * 边 → 生产者三分（v2/11 §14.1「生产者」列；ENU-13 initiator/decisive/rule）。
 * 混合边（M-11/M-19/M-24 允许决定型或规则型）取决定型为缺省；M-07 为规则型，其
 * `rule_basis_ref` 由 drafts.ts 判（缺即拒）。本表是**使用**，不是边集重述。
 */
export const EDGE_PRODUCER_TYPE: Readonly<Record<string, 'initiator' | 'decisive' | 'rule'>> = {
  'M-01': 'decisive',
  'M-02': 'decisive',
  'M-03': 'decisive',
  'M-04': 'decisive',
  'M-05': 'initiator', // 承接者申报（发起型）
  'M-06': 'initiator',
  'M-07': 'rule', // 附条件到期自动暂停（守护计时者）
  'M-08': 'decisive',
  'M-09': 'decisive',
  'M-10': 'initiator', // 交付者提交（发起型）
  'M-11': 'decisive', // 表列「决定型或规则型」——缺省决定型
  'M-12': 'decisive',
  'M-13': 'decisive',
  'M-14': 'decisive',
  'M-15': 'decisive',
  'M-16': 'initiator',
  'M-17': 'decisive',
  'M-18': 'decisive',
  'M-19': 'decisive', // 表列「决定型或规则型」——缺省决定型
  'M-20': 'decisive',
  'M-21': 'decisive',
  'M-22': 'decisive',
  'M-23': 'initiator',
  'M-24': 'decisive', // 表列「决定型或规则型」——缺省决定型
  'M-25': 'decisive',
  'M-26': 'decisive',
  'M-27': 'decisive',
  'M-28': 'decisive',
}

const EDGE_BY_NUMBER: ReadonlyMap<string, WorkTransitionEdge> = new Map(WORK_TRANSITIONS.map((edge) => [edge.edge, edge]))

/** 平台状态 → 工作十态；未登记状态＝undefined（不猜——由调用方拒写并明报） */
export function workStateOf(platformState: string): WorkState | undefined {
  return PLATFORM_TO_WORK_STATE[platformState]
}

/** 解析一条平台迁移对应的 §14.1 边序列（单边=1 条；白名单复合=有序多条；表外/回退=[]） */
export function workEdgesOf(fromPlatform: string, toPlatform: string): readonly WorkTransitionEdge[] {
  const from = workStateOf(fromPlatform)
  const to = workStateOf(toPlatform)
  if (from === undefined || to === undefined) return []
  const direct = WORK_TRANSITIONS.find((edge) => edge.from === from && edge.to === to)
  if (direct !== undefined) return [direct]
  const pathIds = PLATFORM_COMPOSITE_EDGES[`${fromPlatform}→${toPlatform}`]
  if (pathIds === undefined) return []
  const path: WorkTransitionEdge[] = []
  for (const edgeId of pathIds) {
    const edge = EDGE_BY_NUMBER.get(edgeId)
    if (edge === undefined) return [] // 边号漂移＝宁可拒写，不猜
    path.push(edge)
  }
  // 复合路径必须首尾相接（防白名单笔误产出不成链的「迁移」）
  for (let i = 1; i < path.length; i += 1) {
    if (path[i - 1]?.to !== path[i]?.from) return []
  }
  if (path[0]?.from !== from || path[path.length - 1]?.to !== to) return []
  return path
}

/** 单边解析（兼容旧调用/测试；复合路径请用 `workEdgesOf`——单边语义不返回首条边） */
export function workEdgeOf(fromPlatform: string, toPlatform: string): WorkTransitionEdge | undefined {
  const edges = workEdgesOf(fromPlatform, toPlatform)
  return edges.length === 1 ? edges[0] : undefined
}

/** 迁移所需前置记录类型（§14.1「前置记录」列）；表外边＝空数组（拒写由 workEdgesOf 判） */
export function requiredEvidenceOf(edge: WorkTransitionEdge): readonly string[] {
  return edge.evidence
}

/** 桥接表覆盖自检：每个契约工作态都在 reverse 表内、每条复合路径边号可解析且首尾相接 */
export function assertStateMapComplete(): void {
  const missing = [...WORK_STATE_SET].filter((state) => WORK_STATE_TO_PLATFORM[state as WorkState] === undefined)
  if (missing.length > 0) {
    throw new Error(`engine/records/state-map：工作十态未覆盖桥接表：${missing.join(',')}（v2/11 §14.1 漂移）`)
  }
  for (const [key, pathIds] of Object.entries(PLATFORM_COMPOSITE_EDGES)) {
    const [fromPlatform, toPlatform] = key.split('→') as [string, string]
    const edges = workEdgesOf(fromPlatform, toPlatform)
    if (edges.length !== pathIds.length) {
      throw new Error(`engine/records/state-map：复合路径 ${key} 边号不可解析或不成链（v2/11 §14.1 漂移）`)
    }
  }
}
