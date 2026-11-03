/**
 * engine/tick/run.ts —— 拍入口与报告装配（原 tick() 主体拆为四相位调用）
 *
 * 20-§十五「按域拆件、零行为变更」：拍序递增与持久化、deps.judge 判断拍闸清零、拍作用域
 * 建立、四相位按序调用（collect → state-diff → dispatch/harvest/merge/recycle → account）、
 * TickReport 结构化装配——序与字段逐字保持（docs/17-§2「tick 返回结构化 actions 落账」）。
 *
 * 相位实现分驻：collect.ts／state-diff.ts／phases.ts／account.ts；相位间只经 ctx.ts 的
 * 显式出参传值（无隐式共享可变面——唯一共享是拍作用域 TickCtx）。
 */
import type { TickReport } from '../tick-report/types.ts'
import { mergeQueueFace } from '../merge/merge-lease.ts'
import type { EngineRuntime } from '../runtime/types.ts'
import { accountPhase } from './account.ts'
import { collectPhase } from './collect.ts'
import { TICK_SEQ_KEY, type TickCtx } from './ctx.ts'
import { runPhases } from './phases.ts'
import { stateDiffPhase } from './state-diff.ts'

/** 引擎一拍的七相位主循环（docs/17-§2；相位实现见同目录各件） */
export async function runTick(rt: EngineRuntime): Promise<TickReport> {
  rt.seq += 1
  rt.ledger.kvSet(TICK_SEQ_KEY, String(rt.seq))
  const startedAt = rt.now()
  rt.deps.judge?.beginTick(`tick-${rt.seq}`) // 160-B：判断拍闸计数随拍清零（invoke.ts 单B 挂主循环拍）
  rt.hrGate.beginTick() // 任职闸门观测累加器随拍清零（v2/02 §3.4：refused/samples=本拍口径）
  const ctx: TickCtx = {
    seq: rt.seq,
    startedAt,
    tickEvents: [],
    decisions: [],
    decidedActions: [],
    actionResults: [],
    errors: [],
    mutations: 0,
  }

  const collected = await collectPhase(rt, ctx)
  const sd = await stateDiffPhase(rt, ctx, collected)
  const run = await runPhases(rt, ctx, collected, sd)
  const account = await accountPhase(rt, ctx, collected, sd)

  return {
    seq: ctx.seq,
    ts: { start: ctx.startedAt, end: rt.now() },
    phases: {
      collect: {
        activities: collected.activityCount,
        pages: collected.pages,
        affectedTickets: collected.affected.length,
        mirrorSynced: collected.issues.length,
        ...(collected.mirrorGc !== undefined ? { mirrorGc: collected.mirrorGc } : {}),
        cursorBefore: collected.cursorBefore,
        cursorAfter: collected.cursor,
        cursorLoop: collected.cursorLoop,
        unknownStateAlarmed: collected.unknownStateAlarmed,
        foreignKnown: collected.foreignKnown,
        statusSetDrift: collected.statusSetDrift,
        declaredStatusMissing: collected.declaredStatusMissing,
        platformStatusExtra: collected.platformStatusExtra,
        directives: collected.directiveReport,
      },
      stateDiff: {
        candidates: sd.candidates,
        decisions: ctx.decisions,
        reopened: sd.reopened,
        rescanned: sd.rescanned,
        queue: { rows: account.todoQueueRows, persons: account.queuePersons },
        ...(sd.judgeTick !== undefined ? { judge: sd.judgeTick } : {}),
        // hrGate=任职闸门观测面（v2/02 §3.4；逐条 ESCALATE 锚见台账）
        hrGate: rt.hrGate.report(),
      },
      dispatch: {
        dispatched: run.dispatched,
        approvals: run.approvals,
        results: ctx.actionResults.filter((r) => r.actionType === 'dispatch' || r.actionType === 'submit_approval'),
        budgetReserved: run.budget.budgetReserved,
        budgetRefused: run.budget.budgetRefused,
        scheduleToStart: account.scheduleToStart,
        gate: run.gate,
        ...(run.drainSkipped > 0 ? { drainSkipped: run.drainSkipped } : {}),
      },
      harvest: run.harvest,
      merge: { merged: run.merged, queue: mergeQueueFace(rt.mergeHost, run.mergeWaiting, rt.now()) }, // 202-P4 合并队列栏（只读投影）
      recycle: { recycled: run.recycled },
      account: {
        eventsAppended: ctx.tickEvents.length + (account.hrSync?.eventsAppended ?? 0),
        heartbeat: account.heartbeat,
        ...(account.hrSync !== undefined ? { hrSync: account.hrSync } : {}),
        ...(account.pricingStale !== undefined ? { pricingStale: account.pricingStale } : {}),
        ...(account.costClose.ran ? { costClose: account.costClose } : {}),
      },
    },
    actions: ctx.decidedActions,
    actionResults: ctx.actionResults,
    events: ctx.tickEvents,
    inflightAfter: rt.inflight.size,
    errors: ctx.errors,
  }
}
