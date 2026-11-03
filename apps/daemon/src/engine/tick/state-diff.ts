/**
 * engine/tick/state-diff.ts —— 相位 2 state-diff（意图消费 → 候选补齐 → 定序 → 精序 → 开工门决策）
 *
 * 20-§十五「按域拆件、零行为变更」：相位体逐字迁出（宿主名对 rt 字段取别名 → 语句零改写），
 * 相位内序不变（docs/17-§2 相位 2）：意图队列消费（drain）→ 拆单物化 → 复活对账 → 候选
 * 补齐（活动驱动＋镜像 rescan）→ 队列触钟定序 → 小模型精序（160-B 两址）→ 开工门快照宿主
 * → 逐候选 decide（每单至多一动作）→ 迁移编排宿主装配。决策码/闸序/事件序列零漂移。
 *
 * 出参即相位缝：动作队列（dispatch/approval/collect/merge/recycle/stall）、拍内人位占用、
 * 迁移宿主（供相位 3/4/6）与报告面；变体计数经 ctx.mutations 写回拍作用域。
 */
import type { IssueRecord, TicketId } from '@studio-next/contract'
import { breakerStrikes, breakerTrippedAt, type Action } from '@studio-next/core'
import type { CostGuardConfig } from '@studio-next/contract'
import { autoAssignPickOf, type AutoAssignCarry } from '../assign/auto-assign.ts'
import { drainIntents } from '../intents/drain.ts'
import { personViewOf, type QueueJudgeCandidate } from '../judge/sites129.ts'
import { closeRoomDuty } from '../rooms/room-duty.ts'
import { personGateSnapshot } from '../sentinel/shape.ts'
import { createSplitMaterializer } from '../split/materialize.ts'
import {
  acceptRevivals,
  collectWorkIntents,
  type WorkIntentCandidate,
} from '../work/intent.ts'
import { decideWorkCandidate, type WorkCandidateHost } from '../work/intake.ts'
import {
  orderCandidates,
  queueCandidateMeta,
  queueMembership,
  touchQueueCarry,
} from '../todoqueue/queue.ts'
import type {
  WorkPhaseHost,
  WorkRecycleHost,
  WorkTransitionHost,
} from '../work/transition.ts'
import { revokeWorkerKey } from '../worker-key.ts'
import type { ResumeDispatchPlan } from '../intents/relay-resume.ts'
import { effectiveStallAfterMs, livenessOfActivity, probeInflightActivity, recordLiveness } from '../watchdog/liveness.ts'
import type { TickReport } from '../tick-report/types.ts'
import type { EngineRuntime } from '../runtime/types.ts'
import type { CollectOutcome, StateDiffOutcome, TickCtx } from './ctx.ts'

export async function stateDiffPhase(
  rt: EngineRuntime,
  ctx: TickCtx,
  collected: CollectOutcome,
): Promise<StateDiffOutcome> {
  // 逐字迁移的宿主别名（闭包名不变，语义=同一实例/同一绑定）
  const { platform, ledger, config, lanes, inflight, now, makeEvent, syncMirror, flowOf, resolvePerson, latestRecordOf, costGuard } = rt
  const transitionHostOf = rt.transitionHostOf
  const errors = ctx.errors
  const decisions = ctx.decisions
  const decidedActions = ctx.decidedActions
  const startedAt = ctx.startedAt
  const seq = ctx.seq
  const index = collected.index
  const directiveVerbNow = collected.directiveVerbNow
  const actionResults = ctx.actionResults
  const rooms = rt.rooms
  const workerKeys = rt.workerKeys
  const issueById = collected.issueById
  const issues = collected.issues
  const affected = collected.affected
  const tickEvents = ctx.tickEvents
    // —— 相位 2 state-diff：受影响单逐个 decide（每单至多一动作；provisionalActions 供三闸） ——
    const dispatchQ: Array<{ action: Extract<Action, { type: 'dispatch' }>; intentKey: string; resumePlan?: ResumeDispatchPlan; autoAssign?: AutoAssignCarry }> = [] // resumePlan=129-E 续跑携带；autoAssign=轨2 R1① 选人携带（决策位→执行位同源）
    const approvalQ: Array<Extract<Action, { type: 'submit_approval' }>> = []
    const collectQ: Array<Extract<Action, { type: 'collect' }>> = []
    const mergeQ: Array<Extract<Action, { type: 'merge' }>> = []
    const recycleQ: Array<Extract<Action, { type: 'recycle' }>> = []
    const stallQ: Array<Extract<Action, { type: 'stall_alarm' }>> = []
    let provisionalActions = 0

    // —— 相位 2 前置：意图队列消费（源只产意图，22-§一）——kind→handler 普适分发表 ——
    // 消费门（105-刀A A-2）：前置共闸对全 kind 一致（公司匹配 → 分发表命中 → 无 ticket
    // 意图缺 dedupKey=HOLD_INTENT_MALFORMED 明报拒收，25-§3.4 v1.3），无 kind 特判
    // （判负线①）；分发表已开 schedule｜mention（escalate 槽位归刀B notify 端口接线单）。
    const candidates: WorkIntentCandidate[] = []
    const drained = rt.intentQueue.splice(0)
    const drainSeen = new Set<string>()

    // 意图消费段抽件 intents/drain.ts（20-§十五「先拆再增」——129-E studio-dev-184 拆出腾
    // 基线，语义逐字保持）：schedule 物化+五类消费件装配+分发表+共闸循环全在彼处；此处只
    // 注入拍作用域依赖（escalate 的 costGuard 活取热重载感知、touch 队列峰值登记同源迁入）。
    const relayResume = await drainIntents({
      drained,
      ledger,
      platform,
      syncMirror,
      makeEvent,
      tickEvents,
      config,
      people: rt.people,
      ...(rt.deps.departments !== undefined ? { departments: rt.deps.departments } : {}),
      costGuard: (): CostGuardConfig | undefined => costGuard,
      ...(rt.deps.notify !== undefined ? { notify: rt.deps.notify } : {}),
      touch: (ticket, intent): void => {
        const p = Math.max(0, Math.min(3, intent.priority ?? 0))
        if (p <= 0) return
        const prev = rt.pendingQueuePriority.get(ticket)
        rt.pendingQueuePriority.set(ticket, { priority: Math.max(prev?.priority ?? 0, p), since: prev?.since ?? now() })
      },
      onMutation: (): void => {
        ctx.mutations += 1
      },
      errors,
      drainSeen,
      candidates,
      patrolKeys: index.patrolKeys,
      startedAt: ctx.startedAt,
    })

    // —— 相位 2 前置①b：拆单指令消费（130-P2，studio-dev-173；提案 §6.2.2/§6.2.3-R2）——批示:拆单
    // ＋子单清单→物化子单（IssueCreate.parent）＋父单立案收口（leader 短持＋回执；状态零迁移走
    // 标准链）。幂等=父#序号 落 PATROL intent=split:（拍内 splitSeen＋跨拍 patrolKeys 双层）。
    const splitSeen = new Set<string>()
    const consumeSplit = createSplitMaterializer({ platform, ledger, syncMirror, makeEvent, tickEvents, config, people: rt.people, departments: rt.deps.departments, errors, patrolKeys: index.patrolKeys, splitSeen, onMutation: (): void => { ctx.mutations += 1 } })
    for (const directive of rt.splitQueue.splice(0)) await consumeSplit(directive)

    // —— 相位 2 前置②：复活对账（DEV-42②，体=work/intent.ts acceptRevivals）——
    // closed-set 是 CLOSE 事件派生的闭集；平台侧复活（态改回流程态+评论，docs/49 复活令
    // 口径「复活均评论即可」）若无引擎侧一等语义，单据被闭集永拦——改态+评论也不进决策。
    // 复活判定=closed 单的平台态离开其流终态（交付锚点）：评论不动终态不算复活（负断言
    // 钉死）；等级未登记流者终态锚点不可知，不复活（诚实边界）。落 RESUME 事件
    // （17-§3 冻结词表内的复活锚点；REOPEN 不在词表，加名走 SCHEMA_EVOLVE 批示流）
    // → 下一拍 indexEvents 派生即出闭集（事件流序 last-write-wins，可重放）；本拍以
    // 局部闭集即时放行进决策（RESUME 也计 mutations——有账面动作的拍不落心跳）。
    const revival = acceptRevivals({
      closed: index.closed,
      issueOf: (ticket) => issueById.get(ticket),
      flowOf,
      attemptOf: (ticket) => index.attemptOf(ticket),
      emit: (issue, attempt, note) => makeEvent('RESUME', issue, attempt, tickEvents, { note }),
    })
    const closedSet = revival.closed
    const reopened = revival.reopened
    ctx.mutations += reopened

    // —— 相位 2 前置②b/③：候选补齐（活动驱动＋镜像 rescan，DEV-42①；体=work/intent.ts）——
    // 候选去重集初始化于 drain 之后（同拍一单至多一动作；relay/resume 推回的既有单恰可与
    // 本拍活动集相交——双候选=双 dispatch 状态腐坏；活动候选只补位不覆盖意图面候选）；
    // rescan 每 N 拍把非闭环（未 CLOSE）mirror 单补进候选（issues.list 全量每拍已取——
    // 零额外平台 IO），复用同一去重集；节流闸防 noop 决策日志面无界放大。
    const intake = collectWorkIntents({
      candidates,
      affected,
      issues,
      closed: closedSet,
      company: config.company,
      intentSource: config.intentSource,
      seq: ctx.seq,
      ...(config.mirrorRescanEveryTicks !== undefined ? { mirrorRescanEveryTicks: config.mirrorRescanEveryTicks } : {}),
    })
    const rescanned = intake.rescanned
    // —— 队列候选触钟+定序（129-§6.2，studio-dev-167 单B）——
    // 触钟（touchQueueCarry）：队列成员候选首见种 FIFO 锚、重复意图只抬峰不重种；
    // 定序（orderCandidates）：生命周期候选（收割/合并/回收链）原序在前，队列候选
    // 全局排序在后（收割回收先于新派发；每拍上限约束下高分者先过闸——129 plan §3）。
    // 镜像集外的候选（平台取不到）不触钟——拍内快照面，下一拍活动/rescan 兜底再进。
    const pinnedSet = rt.pinnedTicketSet()
    for (const cand of candidates) {
      const issue = issueById.get(cand.ticket)
      if (issue === undefined) continue
      if (queueMembership(issue, flowOf(issue)) !== false) touchQueueCarry(rt.queueCarry, cand.ticket, cand.intent, startedAt)
    }
    const memberOf = (ticket: TicketId): boolean => {
      const issue = issueById.get(ticket)
      return issue !== undefined && queueMembership(issue, flowOf(issue)) !== false
    }
    const metaOf = (ticket: TicketId) => queueCandidateMeta(rt.queueCarry, ticket, pinnedSet.has(ticket), startedAt, rt.queueAgeStepMs)
    let orderedCandidates = orderCandidates(candidates, memberOf, metaOf, config.queueRanker)
    // —— 相位 2 前置④：队列小模型精序（160-B·studio-dev-182；体=judge/sites129.ts）——
    // pick/interrupt 两址挂触钟定序后、派发决策前的相位边缘（160 §6.3）：只在非置顶队列
    // 候选内纯置换（置顶恒首·生命周期段不触·在工单结构性无入面）；降级=规则档原序。
    // 判断结果=C7「state 装配输入」口径——decide 签名零改；投影表仍走冻结公式（可重建面）。
    let judgeTick: TickReport['phases']['stateDiff']['judge']
    if (rt.deps.judge !== undefined) {
      const queueItems = orderedCandidates.filter((c) => memberOf(c.ticket))
      const lifecycleItems = orderedCandidates.filter((c) => !memberOf(c.ticket))
      const queueViews: QueueJudgeCandidate[] = []
      for (const c of queueItems) {
        const issue = issueById.get(c.ticket)
        const meta = metaOf(c.ticket)
        if (issue === undefined) continue
        queueViews.push({
          ticket: c.ticket,
          type: issue.type ?? 'task',
          state: issue.state,
          level: issue.level ?? 0,
          priority: meta.priority,
          pinned: meta.pinned,
          boostTier: meta.boostTier,
          waitMs: startedAt - meta.firstSeenAt,
        })
      }
      // 本拍高优到达：priority≥2 的意图且种钟首见本拍（schedule=2/escalate=3 既有口径）
      const arrivals = candidates
        .filter((c) => (c.intent.priority ?? 0) >= 2 && !pinnedSet.has(c.ticket) && memberOf(c.ticket) && rt.queueCarry.get(c.ticket)?.firstSeenAt === startedAt)
        .map((c) => ({ ticket: c.ticket, kind: c.intent.kind, priority: c.intent.priority ?? 0, source: c.intent.source }))
      const inflightViews = [...inflight.values()].map((w) => ({ ticket: w.ticket, person: w.personId, dispatchedTicksAgo: seq - w.dispatchedAtSeq }))
      const headTicket = queueViews.find((v) => !v.pinned)?.ticket
      const headIssue = headTicket !== undefined ? issueById.get(headTicket) : undefined
      const refined = await rt.deps.judge.refine({
        queueOrdered: queueViews,
        arrivals,
        inflight: inflightViews,
        person: headIssue !== undefined ? personViewOf(resolvePerson(headIssue)) : null,
        dispatchWindowOpen: config.limits.maxActionsPerTick > 0 && inflight.size < config.limits.maxInflight,
      })
      const candByTicket = new Map(queueItems.map((c) => [c.ticket, c]))
      const permuted = refined.queueOrdered.map((v) => candByTicket.get(v.ticket))
      if (permuted.every((c) => c !== undefined)) orderedCandidates = [...lifecycleItems, ...permuted]
      else errors.push('judge 精序违背纯置换契约（候选集异动）——按规则档原序派发')
      if (refined.pick !== undefined || refined.interrupt !== undefined) judgeTick = { ...(refined.pick !== undefined ? { pick: refined.pick } : {}), ...(refined.interrupt !== undefined ? { interrupt: refined.interrupt } : {}) }
    }
    // 本拍已排队派发的人位占用（两段式先决后执——人闸快照折算面，dispatch 即记入）；
    // 必须声明在开工门宿主之前（宿主 personGateOf 闭包引用本表）
    const dispatchPersons = new Map<TicketId, string>()
    let lastAutoAssign: AutoAssignCarry | undefined // 轨2 R1① 决策携带（personIdOf 顺序单值覆写，dispatch 决策读取；决策循环顺序执行无并发面）
    // —— 开工门快照宿主（IMPL-06-02 抽件 work/intake.ts：入参装配在彼，判定仍在 core）——
    // 人闸快照（129-§6.2-R3 第四闸——decide passGates 序冻结：断路>泳道>人>每拍>在途）：
    // 在工计数=内存 Inflight+本拍已排队派发（两段式先决后执拍内即时生效）；人不可解析=
    // 不注 gate 闸面跳过——人员配置错不是停摆理由，派发面 resolvePerson 同源失败才拒派。
    // 批示站立（studio-dev-171）：本拍归一动词优先，否则事件索引派生；approved 入参=D4
    // 清偿点：autoApprove 恒批（demo 语义保持）∥批准站立=真实批示驱动。断路快照（DEV-46
    // 半开面）：trippedAt 在册=熔断中；冷却窗进快照（缺省回退 decide 侧 30min 拟稿）——
    // 无 trippedAt 的旧形快照 decide 按 fail-closed 恒 hold（golden 旧迹兼容）。
    const workCandidateHost: WorkCandidateHost = {
      issueOf: (ticket) => issueById.get(ticket),
      fetchIssue: (ticket) => platform.issues.get(ticket).catch(() => undefined),
      flowOf,
      laneLeaseOf: (lane) => lanes.state(lane),
      personIdOf: (issue) => {
        lastAutoAssign = autoAssignPickOf(rt.assignRuntime(), issue, dispatchPersons)
        return lastAutoAssign !== undefined ? lastAutoAssign.personId : resolvePerson(issue)?.id
      },
      personGateOf: (personId) => personGateSnapshot(personId, dispatchPersons, inflight, rt.personLimits),
      employmentOf: rt.hrGate.employmentOf, // 任职闸门事实（v2/02 §3.4）：与 decide 派发对象同源解析
      verbNowOf: (ticket) => directiveVerbNow.get(ticket) ?? index.directiveStandingOf(ticket),
      approvedNow: (verbNow) => config.autoApprove || verbNow === '批准',
      seenKeys: index.seenKeys,
      ownSeenKeyOf: (ticket, issue) => (flowOf(issue) === undefined ? null : index.seenKeyOf(ticket)),
      breakerOf: (ticket) => {
        const trippedAt = breakerTrippedAt(rt.breaker, ticket)
        return {
          strikes: breakerStrikes(rt.breaker, ticket),
          threshold: config.breakerThreshold,
          ...(trippedAt !== undefined ? { trippedAt } : {}),
          ...(config.breakerCooldownMs !== undefined ? { cooldownMs: config.breakerCooldownMs } : {}),
        }
      },
      onUnavailable: (ticket) => {
        errors.push(`state-diff：单 ${ticket} 平台取不到（跳过本拍）`)
      },
      defaultLane: config.defaultLane,
      limits: config.limits,
      ...(config.flows !== undefined ? { flows: config.flows } : {}),
      inflightCount: () => inflight.size + dispatchQ.length,
      tickActionCount: () => provisionalActions,
      now: () => startedAt,
      stallAfterMs: config.stallAfterMs,
      // 看门狗活性锚（studio-dev-505）：在途=worker 侧证据（流事件/会话 mtime）；无在途=
      // 台账工时行（interrupted 即确定性消亡，B 面即时收口）。无证据=undefined 回退
      // issue.updated（旧世界字节不变）。
      livenessOf: (ticket) => {
        const entry = inflight.get(ticket)
        if (entry !== undefined) return livenessOfActivity(probeInflightActivity(entry, startedAt))
        return recordLiveness(latestRecordOf(ticket))
      },
      stallAfterMsOf: (ticket) =>
        effectiveStallAfterMs(config.stallAfterMs, config.stallAfterMsByExecutor, inflight.get(ticket)?.executor ?? latestRecordOf(ticket)?.executor),
    }
    for (const cand of orderedCandidates) {
      const decision = await decideWorkCandidate(workCandidateHost, cand)
      if (decision === undefined) continue
      const { ticket, issue, intentKey, action, personId } = decision
      // 5a 回弹抑制（studio-dev-171，docs/18-§2.5；判定件=directive/wire.ts）：打回/
      // 拆单/搁置站立期不自动呈批，观测面落 WAIT_APPROVAL（决策码零增删）
      if (decision.reboundSuppressed) {
        decisions.push({ ticket, intentKey, code: 'WAIT_APPROVAL', actionType: 'noop', state: issue.state })
        continue
      }
      decisions.push({ ticket, intentKey, code: action.code, actionType: action.type, state: issue.state })
      decidedActions.push(action)
      // 拒出工≠资源顺延；台账落 ESCALATE 锚（v2/02 §3.4，每单每事实一次）
      if (action.type === 'hold' && action.code === 'HOLD_NOT_IN_SERVICE') ctx.mutations += rt.hrGate.noteRefusal(issue, ticket, index.attemptOf(ticket), tickEvents, decision.employment)
      switch (action.type) {
        case 'dispatch': {
          // resume 面（129-E）：本拍 resume 意图消费登记的续跑计划随派发携带（拍作用域
          //——decide 未出 dispatch 即失效，重发意图即重试）
          const resumePlan = relayResume.planOf(ticket)
          dispatchQ.push({ action, intentKey, ...(resumePlan !== undefined ? { resumePlan } : {}), ...(lastAutoAssign !== undefined ? { autoAssign: lastAutoAssign } : {}) })
          provisionalActions += 1
          // 人位占用记账（同拍后续候选的人闸快照须看到——泳道占用同款决策即生效；
          // 执行失败时 executeDispatch fail() 不清 dispatchPersons——dispatchQ 派发循环
          // 即结束、下拍重算，无泄漏面）
          if (personId !== undefined) dispatchPersons.set(ticket, personId)
          // 决策即占用泳道（两段式先决后执：后续候选的 decide 须看到本拍已派的占用；
          // 执行失败时 executeDispatch 的 catch 负责释放）
          lanes.acquire(action.lane, ticket, startedAt)
          break
        }
        case 'submit_approval':
          approvalQ.push(action)
          provisionalActions += 1
          break
        case 'collect':
          collectQ.push(action)
          provisionalActions += 1
          break
        case 'merge':
          mergeQ.push(action)
          provisionalActions += 1
          break
        case 'recycle':
          recycleQ.push(action)
          provisionalActions += 1
          break
        case 'stall_alarm':
          stallQ.push(action)
          provisionalActions += 1
          break
        case 'hold':
        case 'wait_evidence':
        case 'noop':
        case 'open_bug': // open_bug 只由断路器产生（收割面），decide 不出——防御性忽略
          break
      }
    }

    // —— 状态迁移编排宿主（IMPL-06-02 抽件 work/transition.ts：迁移→镜像→触发记录单一出口；
    //    相位执行体=呈批/复验/回收三面，错误码与事件序列逐字保持）——
    const workTransitionHost: WorkTransitionHost = transitionHostOf(tickEvents)
    const workPhaseHost: WorkPhaseHost = {
      ...workTransitionHost,
      attemptOf: (ticket) => index.attemptOf(ticket),
      flowOf,
      errors,
      actionResults,
      onMutation: () => {
        ctx.mutations += 1
      },
    }
    const roomClose =
      rooms === undefined
        ? undefined
        : async (ticket: TicketId, carrier: IssueRecord, attempt: number): Promise<void> => {
            await closeRoomDuty(rooms, ticket, (note) => {
              makeEvent('ESCALATE', carrier, attempt, tickEvents, { note })
            })
          }
    const workRecycleHost: WorkRecycleHost = {
      ...workPhaseHost,
      defaultLane: config.defaultLane,
      releaseLane: (ticket, lane) => {
        lanes.release(lane, ticket)
      },
      revokeCredential: (ticket) => revokeWorkerKey(workerKeys, ticket),
      ...(roomClose !== undefined ? { closeRoom: roomClose } : {}),
    }
  return {
    candidates: candidates.length,
    reopened,
    rescanned,
    judgeTick,
    dispatchQ,
    approvalQ,
    collectQ,
    mergeQ,
    recycleQ,
    stallQ,
    dispatchPersons,
    pinnedSet,
    workPhaseHost,
    workRecycleHost,
  }
}
