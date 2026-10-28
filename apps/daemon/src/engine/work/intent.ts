/**
 * work/intent —— 工作意图受理编排（PORT-WORK「意图→候选」的 daemon 侧编排腿）
 *
 * 规格依据（实现单引用——AGENTS §五.1）：
 *   - docs/plan/05 IMPL-06-02（engine 拆分·工作与判定域；领土 `engine/work/`）；
 *     docs/v2/16 §三 daemon 行（DISP-02：engine.ts 按域拆、基线只降）；
 *   - docs/v2/14 §1.4（PORT-WORK：意图信封与受理；工作域端口面）；
 *   - docs/v2/11 §5.1 REC-WORK-01/02（意图信封→受理结论：入口只产生意图不产生承诺）；
 *   - docs/v2/07 §三（EXEC- 总规则：执行体/宿主事件**不是**工作状态迁移的生产者；
 *     事件流只是收割输入——「有评论/有活动」不得冒充决定）；
 *   - 既有实现锚（语义逐字保持，20-§十五「先拆再增」）：docs/22-§三.2 意图幂等、
 *     DEV-42②（复活一等语义＝closed 单平台态离开终态→RESUME 事件释放闭集，
 *     「有评论」不复活——负断言钉死）、DEV-42①（镜像对账重决策 rescan 补位）。
 *
 * 分工（本件只做**编排**，零判定复制）：
 *   - 「意图→候选」的 kind 分发表与物化在 `intents/drain.ts`（105-刀A A-2 起）；
 *     本件只接 drain 推入的候选，补齐活动驱动候选与镜像 rescan 候选；
 *   - 平台态/流锚点判定在 core（`resolveTicketFlow`/`flowAnchors`/decide 状态机）；
 *     本件只按锚点比较「是否离开终态」这一事实（不判定迁移合法性）；
 *   - RESUME 事件落账、闭集重算、镜像 upsert 全经注入闭包回写——本件零引擎内部状态。
 *
 * 纪律：候选数组以入参给出并**就地补齐**（与 drain 推入同一数组——同拍候选唯一面，
 * 129-E 上移后的既有口径）；返回只读视图不复制数组；不读时钟（时点经 `seq`/锚点传入）。
 */
import type { IssueRecord, InvokeIntent, TicketId } from '@studio-next/contract'
import { flowAnchors, type StateFlow } from '@studio-next/core'

/** 一张单在决策候选中携带的意图（引擎内部 kind='ticket'——活动/镜像/意图三源同形） */
export interface WorkIntentCandidate {
  readonly ticket: TicketId
  readonly intent: InvokeIntent
}

// ————————————————————————— 复活放行（closed 单的显式恢复决定） —————————————————————————

/**
 * 复活受理依赖（engine tick 作用域注入——本件不持镜像/事件索引）。
 * emit 由调用方绑定到 `makeEvent('RESUME', …)` 并计入 mutations（有账面动作的拍不落心跳）。
 */
export interface RevivalDeps {
  /** 事件索引派生的 CLOSE 闭集（可重放；本件只增删一份拍内副本） */
  readonly closed: ReadonlySet<TicketId>
  /** 平台镜像取（拍首 issues.list 全量对账产物） */
  readonly issueOf: (ticket: TicketId) => IssueRecord | undefined
  /** 流解析（T:<type> 优先→L<level> 回退——core 同函数，本件不另解析） */
  readonly flowOf: (issue: { type?: string; level?: number }) => StateFlow | undefined
  /** 该单已在册的誓号（RESUME 事件 attempt 列——既有口径 attemptOf） */
  readonly attemptOf: (ticket: TicketId) => number
  readonly emit: (issue: IssueRecord, attempt: number, note: string) => void
}

/** 复活受理结果（closed=拍内放行后的闭集；revived=本拍落 RESUME 的单） */
export interface RevivalAcceptance {
  readonly closed: Set<TicketId>
  readonly reopened: number
  readonly revived: readonly TicketId[]
}

/**
 * 复活放行（DEV-42② 语义逐字保持）：
 *   - 判定＝closed 单的平台态**离开其流终态**（交付锚点），不是「有评论」——仅评论
 *     不动终态不复活（负断言钉死；事件流不得冒充恢复决定，v2/07 §三）；
 *   - 等级未登记流者终态锚点不可知→不复活（诚实边界，plan 登记）；
 *   - 平台已不可见（删除面归平台侧）→无从判定，跳过；
 *   - 放行即落 RESUME（17-§3 冻结词表内的复活锚点；REOPEN 不在词表，加名走
 *     SCHEMA_EVOLVE 批示流）并释放闭集——下一拍 indexEvents 派生即出闭集（事件流序
 *     last-write-wins，可重放）；本拍以局部闭集即时放行进决策。
 */
export function acceptRevivals(deps: RevivalDeps): RevivalAcceptance {
  const closed = new Set<TicketId>(deps.closed)
  const revived: TicketId[] = []
  for (const ticket of [...closed].sort()) {
    const issue = deps.issueOf(ticket)
    if (issue === undefined) continue // 平台已不可见（删除面归平台侧）——无从判定复活
    const flow = deps.flowOf(issue)
    if (flow === undefined) continue // 等级未登记流：终态锚点不可知，不复活
    const delivered = flowAnchors(flow).delivered
    if (issue.state === delivered) continue // 仍在终态=未复活（仅评论不触发）
    deps.emit(
      issue,
      deps.attemptOf(ticket),
      `复活：closed 单离开终态 ${delivered} → ${issue.state}（平台侧复活；closed-set 释放，重进决策）`,
    )
    closed.delete(ticket)
    revived.push(ticket)
  }
  return { closed, reopened: revived.length, revived }
}

// ————————————————————————— 候选补齐（活动驱动＋镜像 rescan） —————————————————————————

/** 候选补齐依赖（拍内快照面；一切外部副作用在调用方） */
export interface WorkIntakeDeps {
  /** 本拍意图消费段（drain）已推入的候选——**就地补齐**，不复制数组 */
  readonly candidates: WorkIntentCandidate[]
  /** 相位 1 活动流命中的单（本拍活动增量，未排序） */
  readonly affected: readonly TicketId[]
  /** 平台全量镜像（issues.list，拍首对账产物） */
  readonly issues: readonly IssueRecord[]
  /** 复活放行后的闭集（已 CLOSE 单不进决策） */
  readonly closed: ReadonlySet<TicketId>
  readonly company: string
  /** 活动候选的意图源名（EngineConfig.intentSource——DISPATCH 归因面） */
  readonly intentSource: string
  readonly seq: number
  /** 镜像对账重决策节流闸（0/缺省=关；129/DEV-42① 口径） */
  readonly mirrorRescanEveryTicks?: number
}

/** 候选补齐结果（candidateSeen=本拍候选去重集；rescanned=rescan 补位数） */
export interface WorkIntakeResult {
  readonly candidateSeen: ReadonlySet<TicketId>
  readonly rescanned: number
}

/**
 * 候选补齐（129-E 上移后的顺序逐字保持）：
 *   ① 活动驱动候选：本拍 activity 增量命中的单（意图源=config.intentSource，priority=1）；
 *   ② 镜像 rescan（DEV-42①）：每 N 拍把非闭环 mirror 单补进候选——被三闸顺延且活动已被
 *      游标消费的单不再有活动驱动面，靠此兜底重决策（节流闸防 noop 决策日志面无界放大）；
 *      意图源='mirror'（与活动源区分，救回派发的 DISPATCH note/决策条目可观测归因）。
 * 顺序不变量：relay/resume 推回的是**既有单**，恰可与本拍活动集相交——双候选=双 dispatch
 * 状态腐坏；候选去重集初始化于 drain 之后（活动候选只补位不覆盖意图面候选，intentKey
 * 归因更精确）；rescan 复用同一去重集。
 */
export function collectWorkIntents(deps: WorkIntakeDeps): WorkIntakeResult {
  const candidateSeen = new Set<TicketId>(deps.candidates.map((c) => c.ticket))

  for (const ticket of [...deps.affected].sort()) {
    if (deps.closed.has(ticket)) continue // 已 CLOSE 单不再进决策（复活经 RESUME 释放）
    if (candidateSeen.has(ticket)) continue // 本拍已是候选（意图消费段推入）——不重复
    deps.candidates.push({
      ticket,
      intent: {
        kind: 'ticket',
        company: deps.company,
        ticket,
        source: deps.intentSource,
        priority: 1,
      },
    })
    candidateSeen.add(ticket)
  }

  let rescanned = 0
  const rescanEvery = deps.mirrorRescanEveryTicks ?? 0
  if (rescanEvery > 0 && deps.seq % rescanEvery === 0) {
    for (const issue of [...deps.issues].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      if (deps.closed.has(issue.id) || candidateSeen.has(issue.id)) continue
      deps.candidates.push({
        ticket: issue.id,
        intent: { kind: 'ticket', company: deps.company, ticket: issue.id, source: 'mirror', priority: 0 },
      })
      candidateSeen.add(issue.id)
      rescanned += 1
    }
  }

  return { candidateSeen, rescanned }
}
