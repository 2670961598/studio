/**
 * engine/harvest/finalize.ts —— 收割判定体与失败面（原 engine.ts 内 finalizeHarvest／failHarvest）
 *
 * 20-§十五「按域拆件、零行为变更」：两函数体逐字迁出（宿主名对 rt 字段取别名 → 语句
 * 零改写），GATE_PASS|FAIL、迁移、预算、断路器语义与拆前逐字等价：
 *   - 判定体：折算态（要件 1/2）→ gateRunner（要件 3/4）→ 收口；四要件判定唯一实现仍在
 *     harvest/batch.ts（本件只消费）——合并跑位别分支（entry.mergeRun）先于标准收割。
 *   - 失败面：回滚首批位 + GATE_FAIL 落账 + work_records 收口 failed + 断路连击
 *    （熔断开 bug 单）；STALL 咬合共用同一断路链（harvest/breaker.ts）。
 *
 * docs/17-§6 末 收割成功契约四要件：终态事件 completed + 输出非空 + REPORT 落盘 + 闸门
 * exit=0——前两要件由引擎消费 adapter.stream() 判定，后两要件由可注入 gateRunner 执行。
 */
import type { EventRecord, ExecutorAdapter } from '@studio-next/contract'
import { flowAnchors, onSuccess } from '@studio-next/core'
import { settleDispatch } from '../budget-gate.ts'
import { foldHarvestCost, writeThroughHarvestUsage } from '../cost-guard/harvest.ts'
import { deliverablesOf, statHarvestDenial } from '../jobs/harvest-recon.ts'
import { accountOutputDeps } from '../jobs/harvest-archive-wire.ts'
import { accountJobOutput } from '../jobs/output-account.ts'
import { sentinelDutyForTicket, verifySidecarSentinelAtPath } from '../jobs/sentinel.ts'
import { closeOutMergeHarvest, failMergeHarvest } from '../merge/merge-run.ts'
import { consumePricingPublish } from '../pricing/pricing.ts'
import { recordHarvest, recordHarvestChain } from '../records/hooks.ts'
import {
  harvestFailureDetail,
  harvestFailureSignature,
  harvestRequirementsOf,
  type HarvestRequirements,
} from './batch.ts'
import { tokenBuckets } from '../sentinel/shape.ts'
import { removeInstructions } from '../instructions-store.ts'
import { closeSessionArchive } from '../sessions/archive.ts' // 会话归档接线（studio-dev-551）
import type { EngineRuntime } from '../runtime/types.ts'
import type { Inflight } from '../tick/types.ts'
import { applyWorkTransition } from '../work/transition.ts'

/** 判定体（原收割后半零改动迁移）：折算态（要件 1/2）→ gateRunner（要件 3/4）→ 收口 */
export async function finalizeHarvest(
  rt: EngineRuntime,
  adapter: ExecutorAdapter,
  entry: Inflight,
  tickEvents: EventRecord[],
  errors: string[],
): Promise<'completed' | 'failed'> {
  // 逐字迁移的宿主别名（闭包名不变，语义=同一实例/同一绑定）
  const { gateRunner, platform, ledger, config, records, harvestBatches, now, makeId, catalog, budgetDeps, inflight } = rt
  const mergeHost = rt.mergeHost
  const flowOf = rt.flowOf
  const makeEvent = rt.makeEvent
  const syncMirror = rt.syncMirror
  // 合并跑位别分支（202-P2）：mergeRun 在场=合并收口（先门禁后 MERGE；平台迁移/断路/回滚位别接线）
  if (entry.mergeRun !== undefined) return closeOutMergeHarvest(mergeHost, adapter, entry, tickEvents, errors)
  const ticket = entry.ticket
  const completed = entry.foldCompleted ?? false
  const nonEmptyOutput = entry.foldNonEmpty ?? false
  const terminalError = entry.foldTerminalError
  const gate = await gateRunner.run({
    ticket,
    attempt: entry.attempt,
    workspace: entry.workspace,
    briefPath: entry.briefPath,
  })
  const fresh = await platform.issues.get(ticket)
  const flow = flowOf(fresh)
  const stats = await adapter.resultStats(entry.handle)
  // 132-§6.4 单C R4 即时折算：native>0 直用；否则当日取价 provisional——三面共值（缝体=cost-guard/harvest.ts）
  const harvestCost = foldHarvestCost(ledger, config.company, stats, catalog !== undefined ? catalog.tiers() : undefined, now())
  // —— P3-② stat 兜底（studio-dev-100 §4.3-2，治 E12）：收账面可达性体检——REPORT/
  //    deliverables 不可读即 HARVEST_DENIED 事件不静默。四要件语义冻结不动（denied 不
  //    改判 GATE_PASS/FAIL，只补可见性）；umask 前移后此面应为零，非零即残险如实上账 ——
  const denied = statHarvestDenial(entry.workspace, gate.reportPath)
  if (denied !== undefined) {
    makeEvent('HARVEST_DENIED', fresh, entry.attempt, tickEvents, {
      note: `收账面不可读（stat 兜底）→人工处置；path=${denied.path};cause=${denied.reason}`,
    })
  }

  // 四要件判定（唯一实现在 harvest/batch.ts；本件只消费——GATE_PASS|FAIL 语义零漂移）
  const requirements = harvestRequirementsOf({
    completed,
    nonEmptyOutput,
    reportExists: gate.reportExists,
    exit0: gate.exitCode === 0,
    terminalObserved: entry.foldCompleted !== undefined,
    terminalError,
  })
  // 收割批次登记（IMPL-06-03 / REC-EVD-01 观察面）：区间幂等键/证据项草案/gaps/结构位——
  // 零事件零迁移零预算动作（判定与收口仍在下文与 failHarvest）
  harvestBatches.record({ ticket, attempt: entry.attempt, deliverer: entry.personId }, requirements, { reportPath: gate.reportPath })
  // 记录族生产写面·相位 4 收割尾（studio-dev-605 刀B）：出工段 LIFE-04 → 收割批次 EVD-01
  // （前件＝生效任命/计划锁/授权结果/资格；缺一即拒，不臆造段与批次——拒写只计数+日志，不打断拍）
  if (records !== undefined) {
    recordHarvest({
      records,
      ticket,
      attempt: entry.attempt,
      personId: entry.personId,
      at: now(),
      terminal: requirements.fourOk ? 'completed' : 'error',
      ...(entry.workspace !== undefined ? { workspace: entry.workspace } : {}),
      ...(entry.briefPath !== undefined ? { briefRef: entry.briefPath } : {}),
    })
  }
  rt.crash.harvestVerdict() // 崩溃注入③（F3-11）：收割四要件判定后、GATE_PASS 落账前——受控测试缝，默认零行为
  if (flow === undefined) {
    return failHarvest(rt, entry, tickEvents, 'CONFIG_INVALID：等级未登记状态流（收割去向不可定）', requirements)
  }
  if (requirements.fourOk) {
    const anchors = flowAnchors(flow)
    const transitioned = await platform.issues.transition(ticket, anchors.evidenceReady)
    // 记录族生产写面·相位 4 收割（docs/17-§2）：证据就绪迁移→REC-WORK-06（前置不齐即拒）
    if (records !== undefined) {
      const facts = rt.deps.recordPhaseFacts?.harvest({ ticket, attempt: entry.attempt, at: now(), actor: entry.personId, fromState: fresh.state, toState: anchors.evidenceReady })
      recordHarvestChain({
        records,
        ticket,
        attempt: entry.attempt,
        at: now(),
        actor: entry.personId,
        personId: entry.personId,
        fromState: fresh.state,
        toState: anchors.evidenceReady,
        terminal: 'completed',
        workspace: entry.workspace,
        briefRef: entry.briefPath,
        ...(facts !== undefined ? { facts } : {}),
      })
    }
    const endedAt = now()
    ledger.endWorkRecord(entry.workRecordId, {
      ended_at: endedAt,
      status: 'done',
      cost_usd: harvestCost.usd,
      tokens: stats.tokens,
      ...(stats.model !== undefined ? { model: stats.model } : {}),
      ...(gate.reportExists ? { report_ref: gate.reportPath } : {}),
      ...(gate.summaryPath !== undefined ? { summary_ref: gate.summaryPath } : {}),
      ...(entry.handle.executorSessionId !== undefined ? { executor_session_id: entry.handle.executorSessionId } : {}), // 202-P2：dsh 侧会话 id 收口（v13 列，resume 断点凭据）
    })
    // 相位 4 收割成功：会话归档收口（ended_at/turns/archive_path＋守护计时 note 锚；缺失明报不补插）
    const sessionClose = closeSessionArchive(ledger, { ticket, at: endedAt, sessionId: entry.handle.sessionId, entry, turns: stats.turns, onProblem: (message) => errors.push(message) })
    rt.breaker = onSuccess(rt.breaker, ticket).newState
    inflight.delete(ticket)
    syncMirror(transitioned)
    // 预算结算（收割成功路径）：settle(actual=stats.cost) 双行冲销在途预留——
    // 异常不破坏收割四要件结论（errors 如实上报；预留滞留→同票后续派发走 adopt 可见）
    let budgetNote = ''
    try {
      const settled = settleDispatch(budgetDeps, {
        ticket,
        personId: entry.personId,
        actual: { usd: harvestCost.usd }, // R4：结算实际=即时折算值（三面共值）
        now: now(),
      })
      budgetNote = `;budget=settle 冲销 $${settled.released.toFixed(4)} 实际 $${settled.actualUsd.toFixed(4)}`
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`预算结算异常 ${ticket}：${msg}`)
      budgetNote = `;budget=settle 失败（${msg}）`
    }
    // 岗产物落位收账（DEV-50，docs/04-§三）：GATE_PASS 后置步——jobs[].output 声明
    // 落点收账工位 REPORT（四要件冻结口径不动；收账失败不回滚收割，如实留痕上报）
    // ＋summary sidecar 同拷（127-A R1 批示③：哨兵随件归档——P3 对账步事实源）
    const account = accountJobOutput(accountOutputDeps({ ledger, ticket, reportPath: gate.reportPath, summaryPath: gate.summaryPath, companyDir: config.companyDir, now, errors, guard: config.evidenceExportGuard }))
    // 哨兵观测（127-A R1）：工位 sidecar 即时核验——不拦收割（P3 对账步才是权威事件
    // 面），note 尾缀留痕；非岗单/patrol 工件无义务不加缀
    const harvestSentinel = sentinelDutyForTicket(ledger, ticket)
    const sentinelNote =
      harvestSentinel === undefined
        ? ''
        : `;sentinel=${verifySidecarSentinelAtPath(gate.summaryPath, harvestSentinel)}`
    // 定价更新单据化消费（132-§6.2 单B·studio-dev-169）：GATE_PASS 后置步——type='pricing'
    // 单的 deliverables/pricing.yaml 附件→解析→覆盖校验→append price_snapshots（单据号
    // 锚）。非定价单零行为；消费失败不回滚收割（DAILY_ALARM 唤醒发布岗，不静默）
    const pricingNote = consumePricingPublish({
      ledger,
      ticket,
      issueType: transitioned.type,
      workspace: entry.workspace,
      company: config.company,
      personId: entry.personId,
      declared: catalog !== undefined ? catalog.tiers() : undefined,
      now,
      makeId,
      emitAlarm: (note) => {
        makeEvent('DAILY_ALARM', transitioned, entry.attempt, tickEvents, { note })
      },
      onError: (message) => errors.push(message),
    }).noteSuffix
    // 相位尾缝·usage_daily write-through（132-§6.4 单C R1）：done 一格增量投影；失败不回滚（缝体=cost-guard/harvest.ts）
    const usageNote = writeThroughHarvestUsage({
      ledger, company: config.company, personId: entry.personId, workRecordId: entry.workRecordId,
      model: stats.model, tokens: stats.tokens, endedAt, makeId, onError: (message) => errors.push(message),
    })
    makeEvent('GATE_PASS', transitioned, entry.attempt, tickEvents, {
      tokens: tokenBuckets(stats),
      cost_usd: harvestCost.usd,
      duration_ms: stats.duration,
      // model 留痕走 note 后缀（132-§6.1 单A：events 列集冻结不动——`model=…` 尾缀）
      note: `四要件齐（completed/非空/REPORT/exit0）；report=${gate.reportPath}${gate.summaryPath !== undefined ? `;summary=${gate.summaryPath}` : ''}${budgetNote}${harvestCost.noteSuffix}${usageNote}${account.noteSuffix}${pricingNote}${account.sidecarSuffix}${sentinelNote}${sessionClose.noteSegment}${stats.model !== undefined ? `;model=${stats.model}` : ''}`,
    })
    // bridge 通道指令临时文件：保留至收割完成→此刻删（v1.5#1 清理策略；内容指纹已在
    // DISPATCH note/payload_hash 落账——证据不依赖文件存活）
    if (entry.instructionsPath !== undefined) removeInstructions(entry.instructionsPath)
    return 'completed'
  }
  const detail = harvestFailureDetail(requirements, { terminalError, gateNote: gate.note })
  return failHarvest(rt, entry, tickEvents, detail, requirements)
}

/** 收割失败面：回滚首批位 + GATE_FAIL 落账 + work_records 收口 failed + 断路连击（熔断开 bug 单） */
export async function failHarvest(
  rt: EngineRuntime,
  entry: Inflight,
  tickEvents: EventRecord[],
  detail: string,
  requirements: HarvestRequirements,
): Promise<'completed' | 'failed'> {
  // 逐字迁移的宿主别名（闭包名不变，语义=同一实例/同一绑定）
  const { platform, ledger, workerKeys, inflight, lanes, now } = rt
  const mergeHost = rt.mergeHost
  const flowOf = rt.flowOf
  const makeEvent = rt.makeEvent
  const transitionHostOf = rt.transitionHostOf
  const strikeBreaker = rt.strikeBreaker
  if (entry.mergeRun !== undefined) return failMergeHarvest(mergeHost, entry, detail, tickEvents) // 202-P2 位别分支：无回滚无断路
  const ticket = entry.ticket
  const fresh = await platform.issues.get(ticket)
  const flow = flowOf(fresh)
  // worker wkey 撤离（17-§7）：GATE_FAIL 重派=凭据随子进程 env 离场（结构性撤离——
  // 进程终结即离场，无文件面）+重签（一 attempt 一 key，新 TaskBrief 新 credentials）
  // ——**不吊销 ticket**（ticket 级吊销是终局动作，会杀死重签的新 key；per-key 吊销
  // 拟稿待批，见 worker-key.ts 头注）；断路熔断（下方达阈值）DEV-46 起同样不吊销
  // （冷却后半开试探要重签新 key——终局吊销唯一收口=CLOSE）
  const wkeyDiscarded = workerKeys !== undefined
  // 断路签名：四要件失败形态（同形态连击才熔断——breaker streak 语义）
  const signature = harvestFailureSignature(requirements)
  ledger.endWorkRecord(entry.workRecordId, { status: 'failed', ended_at: now(), ...(entry.handle.executorSessionId !== undefined ? { executor_session_id: entry.handle.executorSessionId } : {}) })
  // 相位 4 收割失败：会话归档同体收口（失败面同样不留 ended_at=NULL；行缺失明报进 GATE_FAIL note）
  const sessionClose = closeSessionArchive(ledger, { ticket, at: now(), sessionId: entry.handle.sessionId, entry })
  inflight.delete(ticket)
  lanes.release(entry.lane, ticket)
  // 回首批位（DEFAULT_ROLLBACK_EDGES：已派发→新单；断路器停重派语义，breaker.ts 头注）——
  // 迁移与触发记录单一出口＝work/transition.ts（等级未登记流=无迁移面：只落 GATE_FAIL 留痕）
  const rollbackAnchor = flow !== undefined ? flowAnchors(flow).fresh : undefined
  const wkeyNote = wkeyDiscarded ? ';wkey=env-离场（凭据随子进程终结；重派重签新 credentials）' : ''
  const gateFailEvent = {
    name: 'GATE_FAIL' as const,
    extra: { note: `${detail};rollback=${rollbackAnchor ?? '跳过（等级未登记流）'}${wkeyNote}${sessionClose.noteSegment}` },
  }
  await (rollbackAnchor !== undefined
    ? applyWorkTransition(transitionHostOf(tickEvents), { ticket, attempt: entry.attempt, toState: rollbackAnchor, event: gateFailEvent })
    : applyWorkTransition(transitionHostOf(tickEvents), { ticket, attempt: entry.attempt, carrier: fresh, event: gateFailEvent }))
  // —— P3-③ 悬空面可见（studio-dev-100 §4.3-1，94 号工况/E10）：缺 REPORT 而工位已有
  //    交付物 → HARVEST_INCOMPLETE 事件——半成品证据（deliverables 清单）进重派/回收
  //    决策视野；**不自动补收、不代写 REPORT**（补收治「写错位」不治「没写」，病根归因
  //    留给事件流——红队 R7 修订面）。attempt 作用域：每次失败收割各落一条（与 GATE_FAIL
  //    同拍性），重派续跑（att2+ 复用半成品）时决策面可见前科 ——
  if (!requirements.reportExists) {
    const deliverables = deliverablesOf(entry.workspace)
    if (deliverables !== undefined) {
      makeEvent('HARVEST_INCOMPLETE', fresh, entry.attempt, tickEvents, {
        note:
          `有产物无REPORT（悬空面）；workspace=${entry.workspace}` +
          `;deliverables=${deliverables.length}件（${deliverables.slice(0, 5).join('、')}${deliverables.length > 5 ? '…' : ''}）` +
          `；处置=进重派/回收决策（不补收不代写）`,
      })
    }
  }
  // 断路器：worker 错误入账（同单同签名连击；达阈值熔断→open_bug）——共享件见
  // strikeBreakerAndMaybeTrip（DEV-44 起 STALL 响置体同链，防双源漂移）
  await strikeBreaker(ticket, fresh, entry.attempt, signature, detail, tickEvents)
  // bridge 通道指令临时文件：收割失败面同样「收割完成即删」（回首批位重派会重写）
  if (entry.instructionsPath !== undefined) removeInstructions(entry.instructionsPath)
  return 'failed'
}
