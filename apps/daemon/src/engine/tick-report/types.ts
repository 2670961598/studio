/**
 * tick-report —— 一拍全量汇报的类型面（BC-S2 先拆再增：自 engine.ts 拆出）
 *
 * 规格依据：docs/17-§2「tick 返回结构化 actions」——engine.ts 仍是唯一实现体与本
 * 类型的再出口（消费面 import 路径不变）；本文件只承载类型（零运行时）。
 * 人事同步面（hrSync 段，DEV-48 docs/52-§9.2）在 account 相位尾。
 */

import type { EventRecord, TicketId } from '@studio-next/contract'
import type { Action, DecisionCode } from '@studio-next/core'
import type { HrSyncTickReport } from '../hrsync/hrsync.ts'
import type { HarvestReconResult } from '../jobs/harvest-recon.ts'

/** 采集相位汇报 */
export interface TickPhaseCollect {
  activities: number
  pages: number
  affectedTickets: number
  /** DEV-49 A4 未知态哨：本拍进入哨键的单数（docs/52-§十） */
  unknownStateAlarmed: number
  /** 州表卫生白名单态本拍新观察数（127-C FOREIGN_KNOWN 事件；无白名单恒 0） */
  foreignKnown: number
  /** DEV-49 A4 状态集巡逻核漂移态名数 */
  statusSetDrift: number
  /** studio-dev-126 C2 声明态漂移：provision 声明在档而平台已无的态名数（节流拍才有） */
  declaredStatusMissing: number
  /** studio-dev-126 C2 声明态漂移：平台在位而声明未收的态名数（节流拍才有） */
  platformStatusExtra: number
  mirrorSynced: number
  cursorBefore: string | null
  cursorAfter: string | null
}

/** state-diff 相位：每候选一决（含 hold/noop——落账口径全量留痕） */
export interface TickDecisionEntry {
  ticket: TicketId
  intentKey: string
  code: DecisionCode
  actionType: Action['type']
  /** 决策时单据平台态（noop 观测面载荷：NOOP_UNKNOWN_STATE 等原因码须配单号+态可见） */
  state: string
}

/** 动作执行结果（派发/呈批/collect/merge/recycle/stall 面） */
export interface TickActionResult {
  ticket: TicketId
  actionType: Action['type']
  ok: boolean
  detail?: string
}

/** 收割相位汇报 */
export interface TickPhaseHarvest {
  checked: number
  completed: number
  failed: number
  pending: number
  /** 相位 4 尾对账步（P3，studio-dev-100 提案 §4.3-1；节流拍才有——缺省每 30 拍） */
  recon?: HarvestReconResult
}

/** 派发相位预算闸汇报（docs/16-§三 reserve→refusal；20-§六.8） */
export interface TickPhaseDispatchBudget {
  /** 新落预留次数（双行落账成功的派发；adopt 沿用不计数） */
  budgetReserved: number
  /** 超帽拒派次数（refusal 行已落账；含票级+岗级） */
  budgetRefused: number
}

/**
 * 派发等待观测（129-§6.2-R5，studio-dev-167 单B）：DISPATCH note wait 锚派生
 * （ledger.recentDispatchWaitsMs 近 50 次）——调度→开工挂钟，面板 inbox 同源可见。
 */
export interface TickDispatchScheduleToStart {
  count: number
  avgMs: number
  maxMs: number
}

/**
 * todo_queue 投影汇报（129-§6.2-R2）：rows=本拍投影行数（diff 才写表，行数恒全量）、
 * persons=去重人数（面板 inbox 分组数）。
 */
export interface TickQueueProjection {
  rows: number
  persons: number
}

/** 一拍全量汇报（JSON 可序列化；actions=结构化动作原体，actionResults=执行面，events=本拍新账） */
export interface TickReport {
  seq: number
  ts: { start: number; end: number }
  phases: {
    collect: TickPhaseCollect
    stateDiff: {
      candidates: number
      decisions: readonly TickDecisionEntry[]
      /** 本拍复活对账释放的 closed 单数（DEV-42②：RESUME 落账数） */
      reopened: number
      /** 本拍镜像对账扫描补进候选的单数（DEV-42①：非节流拍恒 0） */
      rescanned: number
      /** todo_queue 投影快照（129-§6.2-R2：行数/人数——面板 inbox 观测面） */
      queue: TickQueueProjection
    }
    dispatch: { dispatched: number; approvals: number; results: readonly TickActionResult[] } & TickPhaseDispatchBudget & { scheduleToStart: TickDispatchScheduleToStart }
    harvest: TickPhaseHarvest
    merge: { merged: number }
    recycle: { recycled: number }
    account: { eventsAppended: number; heartbeat: boolean; hrSync?: HrSyncTickReport }
  }
  actions: readonly Action[]
  actionResults: readonly TickActionResult[]
  events: readonly EventRecord[]
  inflightAfter: number
  errors: readonly string[]
}
