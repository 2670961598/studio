/**
 * engine/records/state-map —— 平台流状态 ↔ 工作十态（ENU-03）映射与迁移边解析
 *
 * 依据（实现单必须引文档章节号）：
 *   - docs/v2/11 §5.2 / §14.1（工作十态 M-01..M-28 边集与「前置记录」列——边集唯一源
 *     契约包 records 入口的 `WORK_TRANSITIONS`（work-state），本件不重述边）；
 *   - docs/18-§2.1（v0.5 平台流状态模板：新单/待批/已派发/证据就绪/复验通过/已交付）；
 *   - docs/17-§2（相位×记录类型映射表）。
 *
 * 登记缺口（不臆造，如实标出）：
 *   1. 平台流状态**不是**工作十态：两套状态机语义不同（平台流=呈现/流转锚，工作十态=工作
 *      生命周期）。本映射是「生产写面接线」的桥接表，逐条可复核；L2 流「待批」出现两次
 *      （派发前/交付前），后一处不能反推 `pending_start`（反推歧义）——故 reverse 映射取
 *      首现位置，歧义状态不由 reverse 表驱动决策，只作用于迁移记录草案。
 *   2. 平台回退边（已交付→已派发 等）在 M-01..M-28 边集内**无对应边**（那属重开/返工语义，
 *      REC-WORK-11/10 承载）——本件对回退边一律返回 undefined＝拒绝臆造 REC-WORK-06。
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

/** 平台状态 → 工作十态；未登记状态＝undefined（不猜——由调用方拒写并明报） */
export function workStateOf(platformState: string): WorkState | undefined {
  return PLATFORM_TO_WORK_STATE[platformState]
}

/** 解析一条平台迁移对应的 §14.1 边（表外/回退边＝undefined：REC-WORK-06 不可写） */
export function workEdgeOf(fromPlatform: string, toPlatform: string): WorkTransitionEdge | undefined {
  const from = workStateOf(fromPlatform)
  const to = workStateOf(toPlatform)
  if (from === undefined || to === undefined) return undefined
  return WORK_TRANSITIONS.find((edge) => edge.from === from && edge.to === to)
}

/** 迁移所需前置记录类型（§14.1「前置记录」列）；表外边＝空数组（拒写由 workEdgeOf 判） */
export function requiredEvidenceOf(edge: WorkTransitionEdge): readonly string[] {
  return edge.evidence
}

/** 桥接表覆盖自检：每个契约工作态都在 reverse 表内（漂移即启动期硬错——不静默） */
export function assertStateMapComplete(): void {
  const missing = [...WORK_STATE_SET].filter((state) => WORK_STATE_TO_PLATFORM[state as WorkState] === undefined)
  if (missing.length > 0) {
    throw new Error(`engine/records/state-map：工作十态未覆盖桥接表：${missing.join(',')}（v2/11 §14.1 漂移）`)
  }
}
