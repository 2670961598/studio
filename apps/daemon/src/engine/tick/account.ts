/**
 * engine/tick/account.ts —— 相位 7 落账/心跳（心跳事件／人事同步消化／todo_queue 投影重投／
 * 派发等待观测／定价 stale 检查／日终收口）
 *
 * 20-§十五「按域拆件、零行为变更」：相位体逐字迁出（宿主名对 rt 字段取别名 → 语句零改写），
 * 相位序不变（docs/17-§2 相位 7）：零机器动作拍落 HEARTBEAT（游标/拍序已持久化）→ hrSync
 * drain（注入才有）→ todo_queue 投影重投（diff 才写，携带 GC 在纯函数内）→ 派发等待观测
 *（近 50 次 SQL 读回）→ 定价 stale（一日一跑）→ 日终收口。变体计数经 ctx.mutations 写回。
 */
import type { TicketId } from '@studio-next/contract'
import { costCloseDeps, runCostCloseTick } from '../cost-close/close.ts'
import type { HrSyncTickReport } from '../hrsync/hrsync.ts'
import { runPricingStaleCheck, type PricingStaleTickReport } from '../pricing/pricing.ts'
import { recordReconcileTick } from '../records/hooks.ts'
import { heartbeatSentinelRecord } from '../sentinel/sentinels.ts'
import {
  projectTodoQueue,
  settlePendingQueuePriority,
  todoQueueDiffers,
  type QueueMemberSource,
} from '../todoqueue/queue.ts'
import type { EngineRuntime } from '../runtime/types.ts'
import type { AccountOutcome, CollectOutcome, StateDiffOutcome, TickCtx } from './ctx.ts'

export async function accountPhase(
  rt: EngineRuntime,
  ctx: TickCtx,
  collected: CollectOutcome,
  sd: StateDiffOutcome,
): Promise<AccountOutcome> {
  // 逐字迁移的宿主别名（闭包名不变，语义=同一实例/同一绑定）
  const { ledger, config, now, makeId, makeEvent, flowOf, resolvePerson } = rt
  const errors = ctx.errors
  const tickEvents = ctx.tickEvents
  const seq = ctx.seq
  const startedAt = ctx.startedAt
  const activityCount = collected.activityCount
  const issues = collected.issues
  const pinnedSet = sd.pinnedSet
    // —— 相位 7 落账/心跳：零动作拍落 HEARTBEAT（游标/拍序已持久化） ——
    let heartbeat = false
    if (ctx.mutations === 0) {
      rt.crash.heartbeatWrite() // 崩溃注入④（F3-11）：零动作拍心跳事件写入前（落账/心跳相位缝）——受控测试缝，默认零行为
      makeEvent(
        'HEARTBEAT',
        heartbeatSentinelRecord(config.heartbeatIssue, config.deptFallback, startedAt),
        1,
        tickEvents,
        { note: `tick#${seq} 无机器动作（activities=${activityCount}）` },
      )
      heartbeat = true
    }

    // —— 相位 7 尾·人事同步队列消化（DEV-48，docs/52-§9.2）：每拍消化 maxHrSyncPerTick 条 ——
    // 未注入（hrSync 配置关）=恒缺省不进报告；补单/挂账/三面执行/重试记账全在消化器内
    // （src/engine/hrsync/hrsync.ts——engine 只留相位缝，关注点分离）。
    let hrSync: HrSyncTickReport | undefined
    if (rt.deps.hrSync !== undefined) {
      try {
        hrSync = await rt.deps.hrSync.drain()
        ctx.mutations += hrSync.done + hrSync.failed
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`hr-sync drain 失败：${msg}`)
      }
    }

    // —— 相位 7 尾·todo_queue 投影重投（129-§6.2-R2，studio-dev-167 单B）——
    // 成员源=镜像表∩本拍平台活集（拍内迁态后 syncMirror 已落=投影看到拍末真态；
    // 平台消失单的镜像残行不产幽灵队行）。投影纯函数与判负线⑦读回核对同源（域件
    // projectTodoQueue）；diff 才写（canonical JSON——updated_at 同拍恒等，跨拍仅
    // 成员/键变才落 replaceTodoQueue 整批换）。携带 GC 也在纯函数内（离队删条）。
    const liveTickets = new Set<TicketId>(issues.map((i) => i.id))
    const mirrorRows = ledger.listTicketMirrors()
    const mirrorMemberOf = (ticket: TicketId): QueueMemberSource | undefined => {
      const row = mirrorRows.find((r) => r.issue === ticket)
      if (row === undefined) return undefined
      return { id: row.issue, state: row.state, type: row.type, level: row.level, ...(row.assignee !== undefined ? { assignee: row.assignee } : {}) }
    }
    const todoQueueMembers = mirrorRows
      .filter((r) => r.company === config.company && liveTickets.has(r.issue))
      .map((r): QueueMemberSource => ({
        id: r.issue,
        state: r.state,
        type: r.type,
        level: r.level,
        ...(r.assignee !== undefined ? { assignee: r.assignee } : {}),
      }))
    // 峰值优先级延拍落地（129-D）：物化拍记 pending，成员资格落地拍并入携带峰（queue.ts 纯函数）
    settlePendingQueuePriority({
      carry: rt.queueCarry, pending: rt.pendingQueuePriority, members: todoQueueMembers, mirrorMemberOf,
      flowResolve: flowOf, now: now(), staleAfterMs: 15 * 60_000,
    })
    const todoQueueRows = projectTodoQueue({
      members: todoQueueMembers,
      flowResolve: flowOf,
      personOf: (m) => resolvePerson(m)?.id,
      carry: rt.queueCarry,
      pinnedTickets: pinnedSet,
      ageStepMs: rt.queueAgeStepMs,
      now: now(),
      company: config.company,
    })
    if (todoQueueDiffers(rt.lastProjectedTodoQueue, todoQueueRows)) {
      ledger.replaceTodoQueue(config.company, todoQueueRows)
      rt.lastProjectedTodoQueue = JSON.stringify(todoQueueRows)
    }
    // 派发等待观测（129-§6.2-R5）：DISPATCH note wait 锚 SQL 读回（近 50 次）——
    // scheduleToStart 进 tick 报告（面板 inbox 挂钟观测面）。
    const scheduleWaits = ledger.recentDispatchWaitsMs(config.company, 50)
    const scheduleToStart = {
      count: scheduleWaits.length,
      avgMs: scheduleWaits.length > 0 ? Math.round(scheduleWaits.reduce((a, b) => a + b, 0) / scheduleWaits.length) : 0,
      maxMs: scheduleWaits.length > 0 ? Math.max(...scheduleWaits) : 0,
    }
    const queuePersons = new Set(todoQueueRows.map((r) => r.person)).size
    // —— 相位 7 尾·定价 stale 检查（132-§6.2 单B·studio-dev-169，P5 每晨必更守夜）：
    // 本地日 10:00 后首拍一日一跑（kv 日锚+事件 note 派生双层幂等）；stale≥2 或从未
    // 定价 → DAILY_ALARM 挂心跳哨兵单。体在 engine/pricing/pricing.ts——engine 只留缝。
    let pricingStale: PricingStaleTickReport | undefined
    try {
      pricingStale = runPricingStaleCheck({
        ledger,
        company: config.company,
        declared: rt.deps.catalog !== undefined ? rt.deps.catalog.tiers() : undefined,
        now,
        emitAlarm: (note) => {
          makeEvent(
            'DAILY_ALARM',
            heartbeatSentinelRecord(config.heartbeatIssue, config.deptFallback, now()),
            1,
            tickEvents,
            { note },
          )
        },
        onError: (message) => errors.push(message),
      })
      ctx.mutations += pricingStale.alarmed
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`定价 stale 检查失败：${msg}`)
    }
    const costClose = runCostCloseTick(costCloseDeps({ ledger, config, tiers: rt.deps.catalog !== undefined ? rt.deps.catalog.tiers() : undefined, now, makeId, makeEvent, tickEvents, errors, heartbeatSentinelRecord, bumpMutations: (n) => { ctx.mutations += n } })) // 相位7尾·日终收口 132-§6.3 单D
    // —— 相位 7 尾·records↔events 对账读者（studio-dev-605 刀B；#559 验收项「对账读者接入生产对账循环」）：
    //    每 N 拍一跑、增量窗口（上次对账时刻回退 1h），结论落 daemon_kv＋日志；只留痕，
    //    不写事件、不改决策、差异不吞（fail-safe：异常只进 errors，不打断拍）。
    if (rt.records !== undefined) {
      try {
        recordReconcileTick({
          records: rt.records,
          kv: { kvGet: (key) => ledger.kvGet(key), kvSet: (key, value) => ledger.kvSet(key, value) },
          seq,
          at: now(),
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`记录面对账读者失败：${msg}`)
      }
    }
  return {
    heartbeat,
    hrSync,
    pricingStale,
    costClose,
    scheduleToStart,
    todoQueueRows: todoQueueRows.length,
    queuePersons,
  }
}
