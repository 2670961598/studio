/**
 * engine/tick/phases.ts —— 相位 3-6（派发／收割＋STALL 响置＋落位对账／合并／回收）
 *
 * 20-§十五「按域拆件、零行为变更」：四相位体逐字迁出（宿主名对 rt 字段取别名 → 语句零改写），
 * 相位序与闸门零漂移（docs/17-§2）：
 *   ③ 派发：draining 闸只关本相位（审批不新起、派发不执行；其余相位照跑）→ 呈批 → dispatchQ
 *   ④ 收割：在途 handle 检查（本拍派发的下一拍才收）→ runHarvestAttempt → 完成钩 → 复验
 *      通过面 → STALL 响置（DEV-44 咬合）→ 落位对账步（P3 节流）
 *   ⑤ 合并：租约续命 → runMergeAction（真单刀/顺延；队列栏收集）
 *   ⑥ 回收：runRecycleTransitions（关单即吊销 wkey；房间归档失败不阻回收）
 * 变体计数经 ctx.mutations 写回拍作用域。
 */
import type { TicketId } from '@studio-next/contract'
import type { TickActionResult, TickPhaseDispatchBudget, TickPhaseHarvest } from '../tick-report/types.ts'
import { executeDispatch } from '../dispatch/execute.ts'
import { runHarvestAttempt } from '../harvest/batch.ts'
import { runHarvestReconStep } from '../jobs/harvest-archive-wire.ts'
import type { HarvestReconResult } from '../jobs/harvest-recon.ts'
import { renewMergeLeases } from '../merge/merge-lease.ts'
import { runMergeAction } from '../merge/merge-run.ts'
import { executeStallResponse as runStallResponse } from '../watchdog/stall-response.ts'
import {
  runApprovalTransitions,
  runCollectTransitions,
  runRecycleTransitions,
} from '../work/transition.ts'
import type { EngineRuntime } from '../runtime/types.ts'
import type { CollectOutcome, RunOutcome, StateDiffOutcome, TickCtx } from './ctx.ts'

export async function runPhases(
  rt: EngineRuntime,
  ctx: TickCtx,
  collected: CollectOutcome,
  sd: StateDiffOutcome,
): Promise<RunOutcome> {
  // 逐字迁移的宿主别名（闭包名不变，语义=同一实例/同一绑定）
  const { ledger, config, inflight, now, makeEvent, onWorkComplete } = rt
  const drainCtl = rt.drainCtl
  const harvestHostOf = rt.harvestHostOf
  const stallHostOf = rt.stallHostOf
  const mergeHost = rt.mergeHost
  const seq = ctx.seq
  const errors = ctx.errors
  const actionResults = ctx.actionResults
  const tickEvents = ctx.tickEvents
  const index = collected.index
  const directiveVerbNow = collected.directiveVerbNow
  const { dispatchQ, approvalQ, collectQ, mergeQ, recycleQ, stallQ, dispatchPersons, workPhaseHost, workRecycleHost } = sd
    // —— 相位 3 派发：submit_approval（派发前置呈批）→ dispatch ——
    // draining 闸（studio-dev-504 S2；docs/17-§2）：只关本相位——审批不新起、派发不执行，
    // 相位 1/2/4/5/6/7 照跑（自然收割/合并/回收/落账不被停机打断）。
    const dispatchGate: 'open' | 'draining' = drainCtl.active ? 'draining' : 'open'
    const approvals = dispatchGate === 'draining' ? 0 : await runApprovalTransitions(workPhaseHost, approvalQ)
    let dispatched = 0
    let drainSkipped = 0
    const budget: TickPhaseDispatchBudget = { budgetReserved: 0, budgetRefused: 0 }
    for (const { action, intentKey, resumePlan, autoAssign, laneEpoch } of dispatchQ) {
      if (dispatchGate === 'draining') {
        drainSkipped += 1
        continue
      }
      const result = await executeDispatch(rt, action, intentKey, index, tickEvents, budget, resumePlan, autoAssign, dispatchPersons, laneEpoch)
      actionResults.push(result)
      if (result.ok) {
        dispatched += 1
        ctx.mutations += 1
      } else {
        errors.push(`派发失败 ${action.ticket}：${result.detail ?? ''}`)
      }
    }

    // —— 相位 4 收割：在途 handle 检查（本拍派发的下一拍才收）→ collect 动作 → STALL 响置（DEV-44） ——
    const harvest: TickPhaseHarvest = { checked: 0, completed: 0, failed: 0, pending: 0 }
    const harvestHost = harvestHostOf(tickEvents, errors) // 收割域宿主（IMPL-06-03：编排体在 harvest/batch.ts）
    for (const entry of [...inflight.values()]) {
      if (entry.dispatchedAtSeq === seq) {
        harvest.pending += 1
        continue
      }
      harvest.checked += 1
      try {
        const outcome = await runHarvestAttempt(harvestHost, entry)
        if (outcome === 'streaming') {
          // 流驻留（增量泵收，DEV-9 修复）：本拍未收口——计 pending，下一拍续收
          harvest.pending += 1
          continue
        }
        if (outcome === 'completed') harvest.completed += 1
        else harvest.failed += 1
        ctx.mutations += 1
        // 收割完成钩（129-E，F1-11 接力产面）：completed/failed 两面都报（worker 完成含失败
        // 完成）；serve 闭包转发 relay 源；防御吞错——钩面异常不炸收割拍（errors 明报）
        if (onWorkComplete !== undefined) {
          try {
            onWorkComplete({ ticket: entry.ticket, attempt: entry.attempt, outcome, personId: entry.personId })
          } catch (err) {
            errors.push(`收割完成钩异常 ${entry.ticket}：${err instanceof Error ? err.message : String(err)}（钩面不阻断收割）`)
          }
        }
      } catch (err) {
        errors.push(`收割异常 ${entry.ticket}：${err instanceof Error ? err.message : String(err)}`)
      }
    }
    // 复验通过面（collect 动作；体=work/transition.ts runCollectTransitions——取拍末真态定流）
    await runCollectTransitions(workPhaseHost, collectQ)
    // —— 相位 4 收割末段：STALL 响置（DEV-44——告警达阈咬合：kill 面/消亡面，executeStallResponse） ——
    const stallHost = stallHostOf(errors)
    for (const action of stallQ) {
      const result = await runStallResponse(stallHost, action, index, tickEvents).catch(
        (err): TickActionResult => ({
          ticket: action.ticket,
          actionType: action.type,
          ok: false,
          detail: `响置异常：${err instanceof Error ? err.message : String(err)}`,
        }),
      )
      actionResults.push(result)
      if (result.ok) {
        ctx.mutations += 1
      } else {
        errors.push(`STALL 响置失败 ${action.ticket}：${result.detail ?? ''}`)
      }
    }
    // —— 相位 4 收割尾·落位对账步（P3，studio-dev-100 提案 §4.3-1；docs/17-§2 相位内
    //    步骤——不增删相位）：PATROL job= 锚的收割成功单 × jobs[].output 声明落点 ×
    //    公司目录实际文件——缺归档=REPORT_MISSING 事件+内容哈希幂等补收（先事件后搬运；
    //    异哈希转人工绝不覆盖）。节流 N 拍一扫（全量事件扫描，量级口径同 mirrorRescan）；
    //    companyDir 未注入=面未开零行为；对账只补漏不改判（四要件/GATE 语义冻结）——
    let recon: HarvestReconResult | undefined
    const reconEvery = config.harvestReconEveryTicks ?? 30
    if (config.companyDir !== undefined && reconEvery > 0 && seq % reconEvery === 0) {
      const at = now()
      recon = runHarvestReconStep({ ledger, companyDir: config.companyDir, at, config, tickEvents, errors, makeEvent })
      if (recon !== undefined) harvest.recon = recon
    }

    // —— 相位 5 合并（202-P2 双轨）：post-verified 验收位=真单刀（merge-run.ts：resume 唤起
    //    原会话自合并＋先门禁后 MERGE；触发不齐=降级宰相手工链/lease 顺延）；其余位=v0 模拟 ——
    let merged = 0
    renewMergeLeases(mergeHost, now()) // 202-P4 在途合并跑租约续命（每拍——长跑不被 TTL 误夺；死主=到期让道）
    const mergeWaiting: TicketId[] = [] // 合并队列栏：本拍 merge-lease-busy 顺延单（下拍重试）
    for (const action of mergeQ) {
      const r = await runMergeAction(mergeHost, action, index, tickEvents, budget, directiveVerbNow)
      actionResults.push(r.result)
      if (r.leaseBusy === true) mergeWaiting.push(action.ticket)
      if (r.deferred) continue // 占位性顺延（lease 忙/批示不在场）：不计数不上报，下一拍重进
      if (r.counted) { merged += 1; ctx.mutations += 1 } else if (r.mutated) ctx.mutations += 1
      if (!r.result.ok) errors.push(`merge 失败 ${action.ticket}：${r.result.detail ?? ''}`)
    }

    // —— 相位 6 回收：已交付 → 关单落账 + 泳道释放 + wkey 吊销（已交付为终态，无平台迁移） ——
    // 体=work/transition.ts runRecycleTransitions（17-§7 关单即吊销；DEV-28 工位原位归档；
    // 房间归档失败 ESCALATE 不阻回收——幂等重跑收敛）
    const recycled = await runRecycleTransitions(workRecycleHost, recycleQ)
  return {
    approvals,
    dispatched,
    drainSkipped,
    budget,
    harvest,
    merged,
    mergeWaiting,
    recycled,
    gate: dispatchGate,
  }
}
