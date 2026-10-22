/**
 * judge/sites129 —— 129 两址接线体：队列选单/插队小模型档（studio-dev-160 §6.3 首批两行；
 * §6.7 单B·studio-dev-182，制作人 2026-10-22 全批）
 *
 * 语义（提案 §6.3 调用点登记表的两行落地面——登记三件套：词表指纹进 JUDGE_OK note
 * （单A 已落）+ daemon.yaml 开关（serve.ts judgeSites——本单）+ org-config 通用 sites[]
 * 注册表归后续注册表面单，见 182 plan §5 不做）：
 *   - mj-129-pick 队列选单：挂 129 队列候选触钟+定序后、派发决策前（相位边缘）。
 *       facts=岗位定位（受益岗=规则档队首的派工对象 people 摘要）+紧急度+规则档
 *       top-K 候选清单（K≤5，id+同构摘要**等长呈现**，按 ticket id 升序呈报——
 *       防位次锚定；不透出引擎总分——F3 去偏：候选等长/选择式不打分）。
 *       vocab=`pick{ticket}`（enum=非置顶 top-K 候选集）；fallback=引擎排序公式队首
 *       （129 冻结公式）——**判断只在 top-K 内重排，不越权**。
 *   - mj-129-interrupt 插队判断：挂意图消费点——本拍高优意图（priority≥2，schedule=2/
 *       escalate=3 既有口径之上）到达且队列非空时。facts=到达意图（kind/priority/
 *       source）+当前在工单摘要（**永不入候选集**——只作事实呈现）+队列头部 N 项。
 *       vocab=`front{ticket}`/`append{}`；fallback=129 机械排序键自然解（append 语义）
 *       ——在工单永不杀（129 R4 不抢占裁决不变）。
 *   - 不越权双轴（结构性保证非自律）：①置顶单（pinnedTickets，129 R4）不进两址
 *       候选集——producer 明令不是判断面，front/pick 重排只作用于非置顶区头部；
 *       ②重排=纯置换（不增不删），生命周期候选（orderCandidates 原序在前）不触。
 *   - 点火条件（成本纪律——三帽是帽不是许可）：pick=非置顶候选 ≥2 且本拍派发闸可能
 *       开门（maxActionsPerTick>0 且全局在途<maxInflight——无派发容量的拍队序无关
 *       要紧，不烧判断费）；interrupt=本拍高优到达且队列候选 ≥2（到达单独占队首时
 *       无需判断）。两址各 ≤1 次/拍=DEFAULT_JUDGE_TICK_LIMITS 拍总额 2 恰合
 *       （invokeJudge 拍闸收口，tick-clock 预检：首调用>2s 即第二址降级不唤起）。
 *   - 降级一律立即（R4）：一切失败回规则档原序——降级裁决（队首/append）=无操作。
 *
 * 引擎接线面（engine.ts 只留缝——20-§十五 先拆再增）：EngineDeps.judge 注入
 * QueueJudgeHook（beginTick 挂拍 + refine 精序）；缺省不注入=规则缺省档行为零变。
 * 判断结果进主循环状态组装=C7 口径（judge 结果以候选定序输入进 state-diff——
 * decide 纯函数签名不动，trace 面=TickReport.judge 段+JUDGE_* 事件 append-only 可回放）。
 *
 * 依据：docs/17-§2 主循环/micro-judge 行；docs/17-§6 micro-judge 段；129 plan §3
 * （冻结公式）+§6.2-R4（置顶/不抢占）；invoke.ts 调用库（单 164）；todoqueue/queue.ts
 * （成员资格排除在工单——结构性无抢占面）。
 */
import type { PersonRef, TicketId } from '@studio-next/contract'
import type { JudgeFallbackReason } from '@studio-next/core'
import { invokeJudge, type JudgeDeps, type JudgeRuntime, type JudgeSite } from './invoke.ts'

// ————————————————————————— 冻结常量（登记表口径；改值走批示） —————————————————————————

/** 选单址 id（§6.3 登记表行 1） */
export const MJ_129_PICK_SITE_ID = 'mj-129-pick'
/** 插队址 id（§6.3 登记表行 2） */
export const MJ_129_INTERRUPT_SITE_ID = 'mj-129-interrupt'
/** 选单 top-K 上限（§6.3：K≤5） */
export const PICK_TOP_K_MAX = 5
/** 插队判断的队列头部呈现项数（§6.3「队列头部 N 项」未冻值——取与 K 同界 5） */
export const INTERRUPT_HEAD_N = 5
/** 高优意图阈值（schedule=2/escalate=3 既有口径之上：priority≥2 即高优到达） */
export const INTERRUPT_PRIORITY_MIN = 2

// ————————————————————————— 输入/观测类型（engine 装配面） —————————————————————————

/** 队列候选快照（规则缺省档定序后；置顶单在场但恒被两址排除出候选集） */
export interface QueueJudgeCandidate {
  readonly ticket: TicketId
  /** 单据类型（镜像 type，缺省 'task'） */
  readonly type: string
  /** 单据平台态 */
  readonly state: string
  /** 单据等级 */
  readonly level: number
  /** 队列峰值优先级 0..3（touchQueueCarry 抬峰后） */
  readonly priority: number
  /** 制作人置顶（129 R4：恒首，不是判断面——只用于排除与落位，不进 facts） */
  readonly pinned: boolean
  /** 等待提档 0..2（ageBoostTier） */
  readonly boostTier: number
  /** 首见以来等待（毫秒） */
  readonly waitMs: number
}

/** 本拍高优到达（种钟首见本拍 + priority≥2 的意图；引擎侧过滤） */
export interface QueueJudgeArrival {
  readonly ticket: TicketId
  readonly kind: string
  readonly priority: number
  readonly source: string
}

/** 在工单摘要（interrupt facts 的「当前在工单」——只呈现，永不入候选集） */
export interface QueueJudgeInflightItem {
  readonly ticket: TicketId
  readonly person: string
  /** 派发以来拍数（dispatchedAtSeq 折算——在工时长的事实锚） */
  readonly dispatchedTicksAgo: number
}

/** 岗位定位（pick facts 的 people 档案摘要——受益岗=规则档队首的派工对象） */
export interface QueueJudgePersonView {
  readonly id: string
  readonly name: string
  readonly dept: string
  readonly level: number
  readonly role?: string
  readonly skills?: readonly string[]
}

/** 单址观测摘要（TickReport.judge 段——JUDGE_* 事件的对账面，不含候选清单本体） */
export interface QueueSiteJudgeReport {
  /** 是否真唤起（点火条件不满足=未唤起，skipped 给原因） */
  readonly fired: boolean
  readonly degraded?: boolean
  readonly reason?: JudgeFallbackReason
  /** 未唤起原因（site-off/solo-head/no-dispatch-capacity/…）——成本纪律的可观测面 */
  readonly skipped?: string
  /** 采纳的操作名（fired 且非降级） */
  readonly op?: string
  /** 采纳选择（pick/front 的 ticket；append=无） */
  readonly chosen?: TicketId
  readonly costUsd: number
  readonly durationMs: number
}

/** 精序结论：queueOrdered=纯置换后的队列候选（降级=原序）；pick/interrupt=观测摘要 */
export interface QueueJudgeReport {
  readonly queueOrdered: readonly QueueJudgeCandidate[]
  readonly pick?: QueueSiteJudgeReport
  readonly interrupt?: QueueSiteJudgeReport
}

/** 引擎输入（engine.ts 装配；零引擎内部态持有——结构化快照进，结构化结论出） */
export interface QueueJudgeInput {
  /** 规则缺省档定序后的队列候选（生命周期候选已由引擎拆出，不含在此） */
  readonly queueOrdered: readonly QueueJudgeCandidate[]
  /** 本拍高优到达（引擎侧已过滤：队列成员+非置顶+种钟首见本拍） */
  readonly arrivals: readonly QueueJudgeArrival[]
  /** 在工单摘要（interrupt facts） */
  readonly inflight: readonly QueueJudgeInflightItem[]
  /** 岗位定位（pick facts；解析不到派工对象=null） */
  readonly person: QueueJudgePersonView | null
  /** 本拍派发闸可能开门（maxActionsPerTick>0 且在途<maxInflight——pick 点火条件） */
  readonly dispatchWindowOpen: boolean
}

/** 引擎缝（EngineDeps.judge 注入位；缺省不注入=规则缺省档行为零变） */
export interface QueueJudgeHook {
  /** 新拍开始（rt.beginTick——拍内计数清零；serve 常驻 rt，engine 每拍调） */
  beginTick(tickId: string): void
  refine(input: QueueJudgeInput): Promise<QueueJudgeReport>
}

// ————————————————————————— facts 装配（纯函数；等长同构呈现） —————————————————————————

/** 候选同构摘要（F3 去偏：每候选恰同键集、无引擎总分、无位次标记） */
interface CandidateFact {
  readonly ticket: TicketId
  readonly type: string
  readonly state: string
  readonly level: number
  readonly priority: number
  readonly waitMinutes: number
  readonly boostTier: number
}

function candidateFact(c: QueueJudgeCandidate): CandidateFact {
  return {
    ticket: c.ticket,
    type: c.type,
    state: c.state,
    level: c.level,
    priority: c.priority,
    waitMinutes: Math.floor(c.waitMs / 60_000),
    boostTier: c.boostTier,
  }
}

/** id 升序呈报（防位次锚定：词表候选与 facts 清单同序——引擎排序不透出） */
function byTicketAsc(a: { ticket: TicketId }, b: { ticket: TicketId }): number {
  return a.ticket < b.ticket ? -1 : a.ticket > b.ticket ? 1 : 0
}

/** pick facts（岗位定位+紧急度+top-K 候选——同构等长、id 升序） */
export function assemblePickFacts(input: {
  person: QueueJudgePersonView | null
  candidates: readonly QueueJudgeCandidate[]
}): Record<string, unknown> {
  const sorted = [...input.candidates].sort(byTicketAsc)
  const waitMinutes = sorted.map((c) => Math.floor(c.waitMs / 60_000))
  return {
    decision: 'queue-pick：从候选清单中选下一张派发的单（pick.ticket）',
    person: input.person === null ? null : { ...viewPerson(input.person) },
    urgency: {
      maxPriority: sorted.reduce((m, c) => Math.max(m, c.priority), 0),
      oldestWaitMinutes: waitMinutes.reduce((m, w) => Math.max(m, w), 0),
      boostedCount: sorted.filter((c) => c.boostTier > 0).length,
    },
    candidates: sorted.map(candidateFact),
  }
}

function viewPerson(p: QueueJudgePersonView): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    dept: p.dept,
    level: p.level,
    ...(p.role !== undefined ? { role: p.role } : {}),
    ...(p.skills !== undefined ? { skills: [...p.skills] } : {}),
  }
}

/** interrupt facts（到达意图+在工摘要+队列头部 N——在工单只呈现永不入候选集） */
export function assembleInterruptFacts(input: {
  arriving: QueueJudgeArrival
  inflight: readonly QueueJudgeInflightItem[]
  queueHead: readonly QueueJudgeCandidate[]
}): Record<string, unknown> {
  return {
    decision: 'queue-interrupt：高优意图到达，判断其插到非置顶队列头部（front.ticket）或自然排队（append）',
    arriving: {
      ticket: input.arriving.ticket,
      kind: input.arriving.kind,
      priority: input.arriving.priority,
      source: input.arriving.source,
    },
    inflight: input.inflight.map((w) => ({
      ticket: w.ticket,
      person: w.person,
      dispatchedTicksAgo: w.dispatchedTicksAgo,
    })),
    queueHead: [...input.queueHead].sort(byTicketAsc).map(candidateFact),
  }
}

// ————————————————————————— 词表构建（冻结面；fallback=规则缺省档） —————————————————————————

/** pick 址：enum=非置顶 top-K 候选集（id 升序——与 facts 同序防锚定）；fallback=规则档队首 */
export function buildPickSite(candidates: readonly QueueJudgeCandidate[]): JudgeSite {
  const domain = [...candidates].sort(byTicketAsc).map((c) => c.ticket)
  const head = candidates[0]?.ticket as TicketId
  return {
    siteId: MJ_129_PICK_SITE_ID,
    vocab: { ops: [{ op: 'pick', params: { ticket: { kind: 'enum', values: domain } } }] },
    fallback: () => ({ op: 'pick', params: { ticket: head } }),
  }
}

/** interrupt 址：enum=头部 N ∪ 到达单；fallback=append（机械排序键自然解） */
export function buildInterruptSite(
  queueHead: readonly QueueJudgeCandidate[],
  arrivalTicket: TicketId,
): JudgeSite {
  const domain = [...new Set([...queueHead.map((c) => c.ticket), arrivalTicket])].sort()
  return {
    siteId: MJ_129_INTERRUPT_SITE_ID,
    vocab: {
      ops: [
        { op: 'front', params: { ticket: { kind: 'enum', values: domain } } },
        { op: 'append', params: {} },
      ],
    },
    fallback: () => ({ op: 'append', params: {} }),
  }
}

// ————————————————————————— 重排 apply（纯置换；置顶恒前） —————————————————————————

/**
 * 把选中项上移到**非置顶区头部**（置顶区之后）：纯置换——不增不删不改键；
 * 选中项=置顶单时无操作（置顶恒首已被规则档保证，防御性直返）。
 */
export function moveToFrontOfUnpinned(
  queue: readonly QueueJudgeCandidate[],
  ticket: TicketId,
): readonly QueueJudgeCandidate[] {
  const idx = queue.findIndex((c) => c.ticket === ticket)
  if (idx < 0 || queue[idx]?.pinned === true) return queue
  const item = queue[idx] as QueueJudgeCandidate
  // 落位=最后一个置顶项之后（置顶区可能不连续——防御性取末位置顶边界）
  let insertAt = 0
  for (let i = 0; i < queue.length; i += 1) {
    if (queue[i]?.pinned === true) insertAt = i + 1
  }
  if (insertAt > idx) insertAt = idx // 选中项已在置顶边界前（自身非置顶）——原位
  const next = queue.filter((c) => c.ticket !== ticket)
  next.splice(insertAt, 0, item)
  return next
}

// ————————————————————————— 编排器（两址各至多一次；降级=原序） —————————————————————————

/** 址开关集（daemon.yaml judgeSites 解析产物） */
export interface QueueJudgeSites {
  readonly pick: boolean
  readonly interrupt: boolean
}

/**
 * daemon.yaml judgeSites 解析（逗号清单，pinnedTickets 先例）：缺省/空串=两址全关
 * （规则缺省档零变）；未知址名明报拒启动（CONFIG_INVALID 语义）——已登记址名知识
 * 与本件同源（注册表扩址归 org-config 通用注册表面单，见 182 plan §5）。
 */
export function parseJudgeSites(raw: string): QueueJudgeSites {
  const known: readonly string[] = [MJ_129_PICK_SITE_ID, MJ_129_INTERRUPT_SITE_ID]
  const on = new Set<string>()
  for (const seg of raw.split(',').map((s) => s.trim()).filter((s) => s !== '')) {
    if (!known.includes(seg)) {
      throw new Error(`judgeSites 段「${seg}」不是已登记的小模型判断址（已登记：${known.join('、')}）——未知址名不静默忽略`)
    }
    on.add(seg)
  }
  return { pick: on.has(MJ_129_PICK_SITE_ID), interrupt: on.has(MJ_129_INTERRUPT_SITE_ID) }
}

function siteReport(res: {
  degraded: boolean
  reason?: JudgeFallbackReason
  op: string
  chosen?: TicketId
  costUsd: number
  durationMs: number
}): QueueSiteJudgeReport {
  return {
    fired: true,
    ...(res.degraded ? { degraded: true } : {}),
    ...(res.reason !== undefined ? { reason: res.reason } : {}),
    ...(res.degraded ? {} : { op: res.op }),
    ...(res.chosen !== undefined && !res.degraded ? { chosen: res.chosen } : {}),
    costUsd: res.costUsd,
    durationMs: res.durationMs,
  }
}

function skippedReport(skipped: string): QueueSiteJudgeReport {
  return { fired: false, skipped, costUsd: 0, durationMs: 0 }
}

/**
 * 两址编排器（serve 装配注入 engine）：interrupt 先（到达是本拍最新信号——pick 对
 * 插队后的队序做最终选单）；两址各至多 1 次真唤起，一切降级=规则档原序。
 */
export function createQueueJudge(dep: {
  rt: JudgeRuntime
  deps: JudgeDeps
  sites: QueueJudgeSites
}): QueueJudgeHook {
  const { rt, deps, sites } = dep
  return {
    beginTick: (tickId: string) => {
      rt.beginTick(tickId)
    },
    refine: async (input: QueueJudgeInput): Promise<QueueJudgeReport> => {
      let queue = [...input.queueOrdered]
      let interrupt: QueueSiteJudgeReport | undefined
      let pick: QueueSiteJudgeReport | undefined
      const unpinnedByOrder = (list: readonly QueueJudgeCandidate[]) => list.filter((c) => !c.pinned)

      // —— interrupt：本拍高优到达且非置顶队列候选 ≥2（到达单独占队首时无需判断） ——
      const arrivals = input.arrivals.filter((a) => unpinnedByOrder(queue).some((c) => c.ticket === a.ticket))
      if (!sites.interrupt) {
        if (arrivals.length > 0) interrupt = skippedReport('site-off')
      } else if (arrivals.length === 0) {
        // 无到达=址观测不产段（fired=false 不进报告——零噪音）
      } else if (unpinnedByOrder(queue).length < 2) {
        interrupt = skippedReport('solo-head')
      } else {
        // 到达取最高优（并列取 ticket 升序——确定性）；头部 N=非置顶区前 5 项
        const arrival = [...arrivals].sort((a, b) => (b.priority - a.priority) || (a.ticket < b.ticket ? -1 : 1))[0] as QueueJudgeArrival
        const headN = unpinnedByOrder(queue).slice(0, INTERRUPT_HEAD_N)
        const res = await invokeJudge(
          rt,
          deps,
          buildInterruptSite(headN, arrival.ticket),
          assembleInterruptFacts({ arriving: arrival, inflight: input.inflight, queueHead: headN }),
        )
        if (!res.degraded && res.verdict.op === 'front') {
          queue = [...moveToFrontOfUnpinned(queue, String(res.verdict.params.ticket))]
        }
        interrupt = siteReport({
          degraded: res.degraded,
          ...(res.reason !== undefined ? { reason: res.reason } : {}),
          op: res.verdict.op,
          ...(res.verdict.params.ticket !== undefined ? { chosen: String(res.verdict.params.ticket) } : {}),
          costUsd: res.costUsd,
          durationMs: res.durationMs,
        })
      }

      // —— pick：非置顶候选 ≥2 且派发闸可能开门（无容量的拍队序无关紧要——不烧判断费） ——
      const unpinnedNow = unpinnedByOrder(queue)
      if (!sites.pick) {
        // 址关=观测不产段
      } else if (unpinnedNow.length < 2) {
        pick = skippedReport('solo-head')
      } else if (!input.dispatchWindowOpen) {
        pick = skippedReport('no-dispatch-capacity')
      } else {
        const topK = unpinnedNow.slice(0, PICK_TOP_K_MAX)
        const res = await invokeJudge(rt, deps, buildPickSite(topK), assemblePickFacts({ person: input.person, candidates: topK }))
        if (!res.degraded && res.verdict.op === 'pick') {
          queue = [...moveToFrontOfUnpinned(queue, String(res.verdict.params.ticket))]
        }
        pick = siteReport({
          degraded: res.degraded,
          ...(res.reason !== undefined ? { reason: res.reason } : {}),
          op: res.verdict.op,
          ...(res.verdict.params.ticket !== undefined ? { chosen: String(res.verdict.params.ticket) } : {}),
          costUsd: res.costUsd,
          durationMs: res.durationMs,
        })
      }
      return { queueOrdered: queue, ...(pick !== undefined ? { pick } : {}), ...(interrupt !== undefined ? { interrupt } : {}) }
    },
  }
}

/** people 档案行 → pick facts 岗位摘要（缺省键不落显式 undefined——快照惯例） */
export function personViewOf(p: PersonRef | undefined): QueueJudgePersonView | null {
  if (p === undefined) return null
  return {
    id: p.id,
    name: p.name,
    dept: p.dept,
    level: p.level,
    ...(p.role !== undefined ? { role: p.role } : {}),
    ...(p.skills !== undefined ? { skills: [...p.skills] } : {}),
  }
}
