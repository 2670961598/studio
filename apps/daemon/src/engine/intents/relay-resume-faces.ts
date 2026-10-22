/**
 * relay-resume-faces —— engine 装配缝的 relay/resume 接线件（129-E 单E，studio-dev-184）
 *
 * 自 engine.ts 抽件面（20-§十五「先拆再增」）：本文件只装两件引擎缝——
 *   1. resumeDispatchFace：executeDispatch 的续跑派发面（适配器选择+观测锚+装配入参），
 *      全部派生自 relay-resume.ts 的 pickResumeAdapter——语义唯一源不双写；
 *   2. wireRelayResumeFaces：drain 段消费件装配（resumePlans 拍作用域登记面+两 handler）。
 *
 * 观测锚两形（F1-15「续跑不静默」）：
 *   - 续跑形 note=`resume=<session>@<executor>（续自第 N 誓）`；detail 同形+因果实锚
 *   - 降级形 note=`resume=降级新派（<因>——F1-15）`；causation_id 两形都带（因果链不因降级断）
 */
import type { ExecutorAdapter, InvokeIntent, SummarySidecar, TicketId } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'
import { createRelayConsumer, createResumeConsumer, pickResumeAdapter, type ResumeDispatchPlan } from './relay-resume.ts'

/** 续跑派发面（executeDispatch 一次取齐；resumePlan 缺省=undefined 整面缺席） */
export interface ResumeDispatchFace {
  /** 真续跑形（指名命中且 session_resume=true——attempt 计数续用+前情注入+续跑版任务书） */
  active: boolean
  /** 适配器选择：active=指名同家；降级=fallback（engine 传 registry.pick()） */
  adapter: ExecutorAdapter | undefined
  /** 装配入参 resume 三元组（仅 active 在场——createDefaultAssembler 据此切续跑版，17-§5） */
  assembleCtx?: { sessionId: string; summaryPath: string; summary: SummarySidecar }
  /** DISPATCH note 尾锚（active/降级两形恒非空——续跑派发不静默） */
  noteAnchor: string
  /** actionResults detail 尾段（两形恒非空） */
  detailSegment: string
  /** 因果锚=上次工时单 id（F1-15 因果链——makeEvent causation_id 既有列，降级形也带） */
  causationId: string
}

/**
 * 续跑派发面一次算齐：registry.resolve 指名解析（落空 catch 成降级因——降级是业务结果
 * 不外抛炸派发）→ session_resume 能力判别 → note/detail 观测锚 + 装配入参 + causation。
 * registry 形参=结构面 `{ resolve() }`（ExecutorRegistry 结构满足；本文件不 import 适配器包，
 * 25-§一.2 依赖方向纪律——taxonomy.ts 头注判负线⑦）。
 */
export function resumeDispatchFace(
  registry: { resolve(name: string): ExecutorAdapter },
  plan: ResumeDispatchPlan,
  fallback: ExecutorAdapter | undefined,
): ResumeDispatchFace {
  const selection = pickResumeAdapter(registry, plan, fallback)
  if (selection.degradedReason === undefined && selection.adapter !== undefined) {
    return {
      active: true,
      adapter: selection.adapter,
      assembleCtx: { sessionId: plan.sessionId, summaryPath: plan.summaryPath, summary: plan.summary },
      noteAnchor: `;resume=${plan.sessionId}@${plan.executor}（续自第 ${plan.lastAttempt} 誓）`,
      detailSegment: `;resume=${plan.sessionId}@${plan.executor}（续自第 ${plan.lastAttempt} 誓，F1-15）`,
      causationId: plan.causationId,
    }
  }
  const reason = selection.degradedReason ?? '未知'
  return {
    active: false,
    adapter: selection.adapter ?? fallback,
    noteAnchor: `;resume=降级新派（${reason}——F1-15）`,
    detailSegment: `;resume=降级新派（${reason}——F1-15）`,
    causationId: plan.causationId,
  }
}

/** drain 段消费件装配产物（两 handler + 拍作用域计划登记面的读口） */
export interface RelayResumeFaces {
  /** relay 消费件（intentHandlers relay 行——零物化重估，F1-11） */
  consumeRelay: (intent: InvokeIntent, intentKey: string) => Promise<void>
  /** resume 消费件（intentHandlers resume 行——断点续跑计划，F1-15） */
  consumeResume: (intent: InvokeIntent, intentKey: string) => Promise<void>
  /** 本拍已登记续跑计划（dispatch 段携带面——decide 未出 dispatch 即失效，重发意图即重试） */
  planOf: (ticket: TicketId) => ResumeDispatchPlan | undefined
}

/**
 * drain 段消费件装配（engine 拍作用域依赖→两 handler+计划登记面）：resumePlans Map
 * 封装在内（拍作用域边界——每拍新建，不跨拍持久；relay-resume.ts 头注同口径）。
 * 计划登记独立于候选推入：单已是候选（他意图推入）仍登记——影响**怎么派**不影响**派不派**。
 */
export function wireRelayResumeFaces(deps: {
  ledger: Ledger
  errors: string[]
  drainSeen: Set<string>
  candidates: Array<{ ticket: TicketId; intent: InvokeIntent }>
}): RelayResumeFaces {
  const resumePlans = new Map<TicketId, ResumeDispatchPlan>()
  const shared = {
    ledger: deps.ledger,
    errors: deps.errors,
    drainSeen: deps.drainSeen,
    candidates: deps.candidates,
    planResume: (ticket: TicketId, plan: ResumeDispatchPlan): void => {
      resumePlans.set(ticket, plan)
    },
  }
  return {
    consumeRelay: createRelayConsumer(shared),
    consumeResume: createResumeConsumer(shared),
    planOf: (ticket: TicketId): ResumeDispatchPlan | undefined => resumePlans.get(ticket),
  }
}
