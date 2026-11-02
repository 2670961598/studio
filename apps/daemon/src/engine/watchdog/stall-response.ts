/**
 * watchdog/stall-response —— STALL 响置体（DEV-44 咬合 + studio-dev-505 三道修订）
 *
 * 自 engine.ts 抽出（20-§十五「先拆再增」；语义逐条保留，改动面见下）——抽出目的：
 * 本单要把 A 面 kill 前活性复核、B 面 work_record 即时收口接进来，engine.ts 行数基线
 * （boundary-rules lineBaseline=1998）只降不升，故按域拆件腾基线。
 *
 * 规格依据（实现单引用）：
 *   - docs/17-§2 相位 4 末段（STALL 响置）／相位 7（心跳）；
 *   - docs/02-F1-08 看门狗三道：wrap 墙钟 kill／daemon 侧兜底／心跳超时；kill 后等死再重派；
 *   - docs/v2/07-§三 EXEC-01（看护参数）／EXEC-03（常态更新不得杀活 worker；中断整树；
 *     被杀执行体无终态事件→结果「不明」，不得与自报失败同形）；
 *   - docs/17-§6 收割四要件（接管≠收割：杀/消亡面不落 GATE_FAIL 结算语义，B 面
 *     GATE_FAIL 只作「工人消亡」观测与回滚触发，不冒认收割结论）。
 *
 * 两面规格（DEV-44 原语义 + 本单修订）：
 *   A·kill 面（有句柄）——**先复核活性再杀**（studio-dev-505）：
 *     ① 复核通过（worker 侧活性锚距今 ≤ 生效阈值）→ 续租：落 STALL 事件（note 含
 *        `活性复核通过` 锚）不杀、不落 GATE_FAIL、不计连击，静默计数由 events-index 归零；
 *     ② 进程已退出（pid 探测）→ 免杀直收口（不冒认杀死）；
 *     ③ 复核不过 → `await adapter.kill` 整树杀（02-F1-08 kill 后等死）→ 工位收口
 *        interrupted（接管≠收割，四要件不可判：不落 GATE_FAIL、不结算）→ 回滚首批位
 *        ＋断路入账（stall:watchdog-kill）；
 *   B·消亡面（无句柄）——GATE_FAIL（WORKER_DEAD）收口 + running 收口 failed + 断路
 *     入账（stall:worker-dead）；**work_record=interrupted 面即时收口**（studio-dev-505）：
 *     工人已确定性消亡（台账终态、无在途句柄），不再等 60min 陈旧锚——阈值与告警计数
 *     不适用（nth 仅作留痕），收口语义仍守「接管≠收割」边界。
 * 未达阈/刀关/本拍刚派发=只叫（STALL 告警照落，零处置）。
 */
import type { EventRecord, IssueRecord, TicketId } from '@studio-next/contract'
import { flowAnchors, type Action, type StateFlow } from '@studio-next/core'
import type { ExecutorRegistry } from '@studio-next/adapters'
import type { Ledger } from '@studio-next/store'
import type { LaneRegistry } from '../lanes/registry.ts'
import type { EngineConfig, Inflight } from '../tick/types.ts'
import type { TickActionResult } from '../tick-report/types.ts'
import type { EventIndex } from '../sentinel/events-index.ts'
import { STALL_KILL_CLOSE_ANCHOR, STALL_RENEW_ANCHOR } from '../sentinel/events-index.ts'
import { applyWorkTransition, type WorkTransitionHost } from '../work/transition.ts'
import { removeInstructions } from '../instructions-store.ts'
import type { InflightActivity } from './liveness.ts'

/** 响置宿主（引擎闭包注入；本件不持有可变全局态） */
export interface StallResponseHost {
  readonly platform: Pick<import('@studio-next/contract').FlowPlatform, 'issues'>
  readonly ledger: Ledger
  readonly registry: ExecutorRegistry
  readonly inflight: Map<TicketId, Inflight>
  readonly config: EngineConfig
  readonly lanes: LaneRegistry
  readonly flowOf: (issue: { type?: string; level?: number }) => StateFlow | undefined
  readonly transitionHostOf: (tickEvents: EventRecord[]) => WorkTransitionHost
  readonly makeEvent: (
    name: EventRecord['event'],
    issue: IssueRecord,
    attempt: number,
    tickEvents: EventRecord[],
    extra?: { note?: string },
  ) => void
  readonly strikeBreaker: (ticket: TicketId, fresh: IssueRecord, attempt: number, signature: string, detail: string, tickEvents: EventRecord[]) => Promise<void>
  readonly now: () => number
  readonly currentSeq: () => number
  readonly workerKeysEnabled: boolean
  /** 活性探测（A 面 kill 前复核；与 decide 喂数同源） */
  readonly probeActivity: (entry: Inflight, at: number) => InflightActivity
  /** 按 executor 分级解析生效阈值 */
  readonly effectiveStallAfterMs: (executor: string | undefined) => number
}

/** 执行一条 stall_alarm 动作（咬合/只叫/续租三态） */
export async function executeStallResponse(
  host: StallResponseHost,
  action: Extract<Action, { type: 'stall_alarm' }>,
  index: EventIndex,
  tickEvents: EventRecord[],
): Promise<TickActionResult> {
  const { config, inflight } = host
  const ticket = action.ticket
  const fresh = await host.platform.issues.get(ticket).catch(() => undefined)
  if (fresh === undefined) {
    return { ticket, actionType: action.type, ok: false, detail: '平台取不到单据（告警无处落——下拍再看）' }
  }
  const threshold = config.stallKillAfterAlarms ?? 0
  // 在工 attempt 口径：告警/收口事件记「正在跑的这一誓」（与 GATE_PASS/GATE_FAIL 同族）；
  // attemptOf=DISPATCH 计数+1=下一誓，在工期减一（无 DISPATCH 的防御面=1）
  const workAttempt = Math.max(1, index.attemptOf(ticket) - 1)
  const nth = index.stallStrikesOf(ticket) + 1 // 索引建于拍首（不含本拍）——本拍告警是第 N 次
  const effective = action.stallThresholdMs ?? config.stallAfterMs
  const entry = inflight.get(ticket)
  const silent = `在工静默 ${action.silentMs}ms 超阈值 ${effective}ms`
  // 活性锚观测面（可审计；回退锚 issue.updated 也明写，不静默）
  const anchorFace =
    action.livenessSource !== undefined
      ? `；活性锚=${action.livenessSource}@${new Date(action.livenessAnchorAt ?? 0).toISOString()}`
      : ''
  // B 面即时收口：无在途句柄 + 台账终态 interrupted（工人确定性消亡）——不等阈值/告警计数。
  // 刀关（stallKillAfterAlarms=0）时仍尊重「全关」语义（只叫不处置）。
  const immediateGone = action.workerGone === true && entry === undefined && threshold > 0
  if (!immediateGone && (threshold <= 0 || nth < threshold || (entry !== undefined && entry.dispatchedAtSeq === host.currentSeq()))) {
    // 只叫：告警事件照落（观测面不变——decide 4 号判定的台账留痕）
    host.makeEvent('STALL', fresh, workAttempt, tickEvents, {
      note: `${silent}${anchorFace}（看门狗告警第 ${nth}${threshold > 0 ? `/${threshold}` : ''} 次；${
        threshold <= 0 ? '刀关 stallKillAfterAlarms=0' : nth < threshold ? '未达咬合阈' : '本拍刚派发让一拍'
      }——02-F1-08 daemon 侧兜底）`,
    })
    return { ticket, actionType: action.type, ok: true, detail: `silentMs=${action.silentMs};告警第${nth}次（只叫）` }
  }
  // —— 咬合（达阈 / B 面即时） ——
  const flow = host.flowOf(fresh)
  const freshAnchor = flow !== undefined ? flowAnchors(flow).fresh : undefined
  if (entry !== undefined) {
    const at = host.now()
    const executorThreshold = host.effectiveStallAfterMs(entry.executor)
    // ① A 面 kill 前活性复核（studio-dev-505）：worker 侧证据新鲜＝续租，不杀、不落 GATE_FAIL
    const recheck = host.probeActivity(entry, at)
    if (recheck.lastActivityAt !== undefined && at - recheck.lastActivityAt <= executorThreshold) {
      host.makeEvent('STALL', fresh, workAttempt, tickEvents, {
        note: `${silent}${anchorFace}（看门狗告警第 ${nth}/${threshold} 次；A 面 kill 前${STALL_RENEW_ANCHOR}——${recheck.detail}；距 now=${at - recheck.lastActivityAt}ms ≤ 生效阈值 ${executorThreshold}ms，续租不杀、静默计数归零——02-F1-08 常态更新不得杀活 worker）`,
      })
      return {
        ticket,
        actionType: action.type,
        ok: true,
        detail: `咬合前复核续租（${recheck.source ?? 'probe'}，距now=${at - recheck.lastActivityAt}ms）`,
      }
    }
    // ② 进程已退出＝无可杀（不冒认杀死）；③ 复核不过＝整树杀（await=等死——与 dispose()/stop 同链）
    let killNote: string
    if (recheck.pidAlive === false) {
      killNote = `worker 进程已退出（pid 探测：${recheck.detail}）——免杀直收口（不冒认杀死，02-F1-08）`
    } else {
      try {
        const adapter = host.registry.resolve(entry.executor)
        await adapter.kill(entry.handle, config.killGraceMs)
        killNote = `整树杀 worker=${entry.executor} session=${entry.handle.sessionId} pid=${entry.handle.pid}（SIGTERM→${config.killGraceMs}ms→SIGKILL，stop 通道同款 kill 链，02-F1-08 kill 后等死；kill 前复核不过：${recheck.detail}）`
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        killNote = `整树杀异常（executor=${entry.executor}：${msg}）——工位仍收口（句柄不可信即不可收割，如实留痕不冒认杀死）`
      }
    }
    host.ledger.endWorkRecord(entry.workRecordId, { status: 'interrupted', ended_at: host.now() })
    inflight.delete(ticket)
    host.lanes.release(entry.lane, ticket)
    // 回首批位（迁移与触发记录单一出口＝work/transition.ts）；等级未登记流=无迁移面
    const rollbackNote = freshAnchor ?? '跳过（等级未登记流）'
    const stallNote =
      `${silent}${anchorFace}（第 ${nth}/${threshold} 次达阈——咬合）：${killNote}；${STALL_KILL_CLOSE_ANCHOR}（R-B 在途语义：接管≠收割，四要件不可判）；` +
      `rollback=${rollbackNote}；重派=attempt+1 经 rescan 兜底（咬合收口即释放消费键——studio-dev-141 修订：原「activity 键未释放」口径致回退态单 rescan 兜底被 DEDUP_NOOP 压制 3.5h 实证；键释放≠收割结论，GATE_FAIL/预算面不动；预算沿用 adopt 不结算）` +
      `${host.workerKeysEnabled ? '；wkey=env-离场（凭据随被杀子进程终结；重派重签新 key——不吊销 ticket）' : ''}`
    await (freshAnchor !== undefined
      ? applyWorkTransition(host.transitionHostOf(tickEvents), { ticket, attempt: workAttempt, toState: freshAnchor, event: { name: 'STALL', extra: { note: stallNote } } })
      : applyWorkTransition(host.transitionHostOf(tickEvents), { ticket, attempt: workAttempt, carrier: fresh, event: { name: 'STALL', extra: { note: stallNote } } }))
    // 断路入账（dispositions：STALL countsTowardBreaker=true）
    await host.strikeBreaker(
      ticket,
      fresh,
      workAttempt,
      'stall:watchdog-kill',
      `STALL 咬合（kill 面）：${silent} 第 ${nth}/${threshold} 次（${killNote}）`,
      tickEvents,
    )
    // bridge 通道指令临时文件：响置收口即删（重派会重写同路径）
    if (entry.instructionsPath !== undefined) removeInstructions(entry.instructionsPath)
    return { ticket, actionType: action.type, ok: true, detail: `咬合（kill 面）第${nth}/${threshold}次：${killNote}` }
  }
  // B 面：消亡（无可杀）。immediateGone=work_record 终态即时收口面；否则=阈值达阈面。
  const reason = immediateGone
    ? 'work_record=interrupted 即时收口（工人确定性消亡，不等阈值/陈旧锚——studio-dev-505）'
    : `第 ${nth}/${threshold} 次达阈——咬合`
  const detail = `WORKER_DEAD：${silent}${anchorFace}（${reason}）且无在途句柄（工人消亡面：2026-10-20 三例 studio-dev-20/25/71 同型）`
  const deadRollback = freshAnchor ?? '跳过（等级未登记流）'
  const deadNote = `${silent}${anchorFace}（${reason}）：无在途句柄（工人消亡面）→ GATE_FAIL 收口；rollback=${deadRollback}；重派=attempt+1（activity 键已释放——活动驱动+rescan 双兜底）`
  const deadStall = await (freshAnchor !== undefined
    ? applyWorkTransition(host.transitionHostOf(tickEvents), { ticket, attempt: workAttempt, toState: freshAnchor, event: { name: 'STALL', extra: { note: deadNote } } })
    : applyWorkTransition(host.transitionHostOf(tickEvents), { ticket, attempt: workAttempt, carrier: fresh, event: { name: 'STALL', extra: { note: deadNote } } }))
  host.makeEvent('GATE_FAIL', deadStall.issue, workAttempt, tickEvents, {
    note: `${detail};rollback=${deadRollback}${host.workerKeysEnabled ? ';wkey=env-离场（无活进程；重派重签新 credentials）' : ''}`,
  })
  // 遗留 running 工位收口（进程内正常链路不产生 running 无 inflight——此面来自 dispose 后
  // 继续推拍等；R-B 启动接管已收口过的查无即跳过。判定面收口=failed，与 failHarvest 同款）
  for (const rec of host.ledger.listWorkRecords({ issue: ticket })) {
    if (rec.status === 'running') {
      host.ledger.endWorkRecord(rec.id, { status: 'failed', ended_at: host.now() })
    }
  }
  host.lanes.release(fresh.lane ?? config.defaultLane, ticket)
  await host.strikeBreaker(ticket, fresh, workAttempt, 'stall:worker-dead', detail, tickEvents)
  return { ticket, actionType: action.type, ok: true, detail: `咬合（消亡面）第${nth}/${threshold}次：GATE_FAIL WORKER_DEAD 收口` }
}
