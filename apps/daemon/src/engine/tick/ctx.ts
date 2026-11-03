/**
 * engine/tick/ctx.ts —— 拍作用域（TickCtx）与相位出参类型
 *
 * 20-§十五「按域拆件、零行为变更」：原 tick() 单个巨型函数体按相位拆成
 * collect → state-diff → dispatch/harvest/merge/recycle → account，相位之间只经这里声明的
 * **显式出参**传值（不再靠同一函数体的词法作用域）。拍作用域可变面（事件流/决策/动作结果/
 * 错误/机器动作计数）收在 TickCtx：各相位通过 ctx 写，语义与拆前 `let mutations` 同源。
 */
import type { EventRecord, IssueRecord, TicketId } from '@studio-next/contract'
import type { Action } from '@studio-next/core'
import type { AutoAssignCarry } from '../assign/auto-assign.ts'
import type { CostCloseTickReport } from '../cost-close/close.ts'
import type { DirectiveVerb } from '../directive/index.ts'
import type { DirectiveLayerResult } from '../directive/index.ts'
import type { HrSyncTickReport } from '../hrsync/hrsync.ts'
import type { ResumeDispatchPlan } from '../intents/relay-resume.ts'
import type { MirrorGcTickReport } from '../mirror-gc/step.ts'
import type { PricingStaleTickReport } from '../pricing/pricing.ts'
import type { EventIndex } from '../sentinel/events-index.ts'
import type { TickActionResult, TickDecisionEntry, TickPhaseHarvest, TickReport } from '../tick-report/types.ts'
import type { WorkPhaseHost, WorkRecycleHost } from '../work/transition.ts'

/** daemon_kv 键：活动游标 / 拍序（store v4 正式面——迁移与语义见 migrations v4 头注） */
export const CURSOR_KEY = 'activity.cursor'
export const TICK_SEQ_KEY = 'tick.seq'

/** 拍作用域可变面（拆前 tick() 内 let/const 声明；各相位写入同一份） */
export interface TickCtx {
  seq: number
  startedAt: number
  tickEvents: EventRecord[]
  decisions: TickDecisionEntry[]
  decidedActions: Action[]
  actionResults: TickActionResult[]
  errors: string[]
  /** 本拍机器动作计数（零动作拍落 HEARTBEAT——拆前 `let mutations`） */
  mutations: number
}

/** 相位 1 出参（报告 collect 面 + 后续相位依赖） */
export interface CollectOutcome {
  cursorBefore: string | null
  cursor: string | null
  cursorLoop: boolean
  pages: number
  activityCount: number
  affected: TicketId[]
  issues: IssueRecord[]
  issueById: Map<TicketId, IssueRecord>
  mirrorGc: MirrorGcTickReport | undefined
  index: EventIndex
  unknownStateAlarmed: number
  foreignKnown: number
  statusSetDrift: number
  declaredStatusMissing: number
  platformStatusExtra: number
  directiveReport: DirectiveLayerResult['report']
  directiveVerbNow: ReadonlyMap<TicketId, DirectiveVerb>
}

/** 派发队列条目（决策位→执行位同源携带：intentKey/resumePlan/autoAssign） */
export interface DispatchQueueEntry {
  action: Extract<Action, { type: 'dispatch' }>
  intentKey: string
  resumePlan?: ResumeDispatchPlan
  autoAssign?: AutoAssignCarry
}

/** 相位 2 出参（各相位动作队列 + 迁移宿主 + 报告面） */
export interface StateDiffOutcome {
  candidates: number
  reopened: number
  rescanned: number
  judgeTick: TickReport['phases']['stateDiff']['judge']
  dispatchQ: DispatchQueueEntry[]
  approvalQ: Array<Extract<Action, { type: 'submit_approval' }>>
  collectQ: Array<Extract<Action, { type: 'collect' }>>
  mergeQ: Array<Extract<Action, { type: 'merge' }>>
  recycleQ: Array<Extract<Action, { type: 'recycle' }>>
  stallQ: Array<Extract<Action, { type: 'stall_alarm' }>>
  dispatchPersons: Map<TicketId, string>
  /** 置顶单集（相位 2 解出——相位 7 队列投影同源） */
  pinnedSet: ReadonlySet<TicketId>
  workPhaseHost: WorkPhaseHost
  workRecycleHost: WorkRecycleHost
}

/** 相位 3-6 出参（报告面） */
export interface RunOutcome {
  approvals: number
  dispatched: number
  drainSkipped: number
  budget: { budgetReserved: number; budgetRefused: number }
  harvest: TickPhaseHarvest
  merged: number
  mergeWaiting: TicketId[]
  recycled: number
  gate: 'open' | 'draining'
}

/** 相位 7 出参（报告面） */
export interface AccountOutcome {
  heartbeat: boolean
  hrSync: HrSyncTickReport | undefined
  pricingStale: PricingStaleTickReport | undefined
  costClose: CostCloseTickReport
  scheduleToStart: { count: number; avgMs: number; maxMs: number }
  todoQueueRows: number
  queuePersons: number
}
