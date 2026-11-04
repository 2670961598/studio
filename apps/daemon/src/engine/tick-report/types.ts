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
import type { CompanyWriteTickReport } from '../company-write/runtime.ts'
import type { HrGateTickReport } from '../hr-gate/employment-gate.ts'
import type { HarvestReconResult } from '../jobs/harvest-recon.ts'
import type { PricingStaleTickReport } from '../pricing/pricing.ts'
import type { CostCloseTickReport } from '../cost-close/close.ts'
import type { QueueSiteJudgeReport } from '../judge/sites129.ts'
import type { MergeQueueFace } from '../merge/merge-lease.ts'
import type { MirrorGcTickReport } from '../mirror-gc/step.ts'
import type { ObsTickReport } from '../observe/types.ts'

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
  /**
   * 批示归一层汇报（studio-dev-171，docs/18-§2.5；面关时全零）：tickets=本拍拉过
   * 评论的受影响单数、consumed=消费批示/畸形数（恰一次——append-only 键）、
   * rejected=畸形+资格拒+边未声明数（忽略+ESCALATE 面）。
   */
  directives: { tickets: number; consumed: number; rejected: number }
  mirrorSynced: number
  /**
   * 镜像 GC 维护步（studio-dev-511）：仅在检查拍/首拍出现；含跳过原因（平台不可用/空活动集）、
   * 删除数、样本单号与备份路径。不新增事件名（事件枚举冻结 17-§3）。
   */
  mirrorGc?: MirrorGcTickReport
  /**
   * 观察面 OBS 本拍报告（studio-dev-539／重出 studio-dev-617；docs/17-§2 相位 1 尾步骤）：
   * 故障/观察开启与结束计数＋只读投影六态摘要（`snapshotFound=false`＝材料不足，不补零/
   * 不补绿——NEG-MON-01）。面未装配（无观察位置）＝本段缺席，零行为。
   */
  obs?: ObsTickReport
  cursorBefore: string | null
  cursorAfter: string | null
  /** studio-dev-409：本拍 activity 翻页出现 nextCursor 同值再现（游标回退环）——
   * 已停翻防打转，cursor 停在最后未重复值 */
  cursorLoop: boolean
}

/** state-diff 相位：每候选一决（含 hold/noop——落账口径全量留痕） */
export interface TickDecisionEntry {
  ticket: TicketId
  intentKey: string
  code: DecisionCode
  actionType: Action['type']
  /** 决策时单据平台态（noop 观测面载荷：NOOP_UNKNOWN_STATE 等原因码须配单号+态可见） */
  state: string
  /**
   * 泳道 hold 观测载荷（studio-dev-713，仅 HOLD_LANE_BUSY 决策携带）：
   * 决策时该单泳道的租约快照——holder/expiresAt 让「派而不发」现场可见（hold 无台账事件，
   * 渲染行为唯一观测面；services 侧按签名去重防刷屏）。
   */
  lane?: string
  /** 泳道当前持有人；null=无主（理论不出现于 HOLD_LANE_BUSY） */
  laneHolder?: string | null
  /** 租约到期 epoch-ms（与 laneHolder 同源快照） */
  laneExpiresAt?: number
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

/**
 * 队列小模型精序汇报（160-B·studio-dev-182）：pick/interrupt 两址本拍观测摘要
 * （fired/degraded/reason/chosen——JUDGE_* 事件的对账面；两址都未产段=undefined）。
 */
export interface TickQueueJudgeReport {
  pick?: QueueSiteJudgeReport
  interrupt?: QueueSiteJudgeReport
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
      /** 队列小模型精序（160-B·studio-dev-182：pick/interrupt 观测摘要；未注入=缺席） */
      judge?: TickQueueJudgeReport
      /** 任职闸门（studio-dev-550；v2/02 §3.4）：闸门恒在——refused=0 表示本拍零拒 */
      hrGate: HrGateTickReport
    }
    dispatch: { dispatched: number; approvals: number; results: readonly TickActionResult[] } &
      TickPhaseDispatchBudget & {
        scheduleToStart: TickDispatchScheduleToStart
        /** 相位 3 闸位（studio-dev-504 S2）：draining=受权重启只停派发，其余相位照跑 */
        gate?: 'open' | 'draining'
        /** draining 期间被闸掉的派发/呈批数（只读观测；不含自然收割） */
        drainSkipped?: number
      }
    harvest: TickPhaseHarvest
    /** 合并队列栏（202-P4，studio-dev-234）：只读投影——等待单（merge-lease-busy 顺延）/在跑单/租约态 */
    merge: { merged: number; queue: MergeQueueFace }
    recycle: { recycled: number }
    account: {
      eventsAppended: number
      heartbeat: boolean
      hrSync?: HrSyncTickReport
      /** 公司目录挂单队列消化（studio-dev-541；docs/17-§2 相位 7 尾）：面关＝缺省不出现 */
      companyWrite?: CompanyWriteTickReport
      /** 定价 stale 检查（132-§6.2 单B：相位 7 尾日锚步——一日一跑，checked=0 未到窗/已跑） */
      pricingStale?: PricingStaleTickReport
      /** 日终收口工序（132-§6.3 单D·studio-dev-179：19:55 后收 D-1——ran=false 未到窗/已收讫） */
      costClose?: CostCloseTickReport
    }
  }
  actions: readonly Action[]
  actionResults: readonly TickActionResult[]
  events: readonly EventRecord[]
  inflightAfter: number
  errors: readonly string[]
}
