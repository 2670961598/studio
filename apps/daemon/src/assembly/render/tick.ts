/**
 * render/tick —— serve 运行面拍日志行（自 assembly/serve.ts 抽件——20-§十五
 * 「先拆再增」；纯渲染函数，无 serve 闭包）。
 */
import type { TickDecisionEntry, TickReport } from '../../engine/tick-report/types.ts'

/** 一拍心跳日志行（serve 运行面观测；事件面账目在台账） */
export function renderTick(report: TickReport): string {
  const p = report.phases
  return (
    `tick#${report.seq} actions=${report.actions.length} dispatched=${p.dispatch.dispatched} ` +
    `budget=${p.dispatch.budgetReserved}reserved/${p.dispatch.budgetRefused}refused ` +
    `harvest=${p.harvest.completed}/${p.harvest.checked}/p${p.harvest.pending} merged=${p.merge.merged} recycled=${p.recycle.recycled} ` +
    `events=${p.account.eventsAppended} inflight=${report.inflightAfter} cursor=${p.collect.cursorAfter ?? '-'}${
      p.stateDiff.reopened > 0 ? ` reopened=${p.stateDiff.reopened}` : ''
    }${p.stateDiff.rescanned > 0 ? ` rescan=+${p.stateDiff.rescanned}` : ''}${p.account.heartbeat ? ' [heartbeat]' : ''}`
  )
}

/**
 * noop 决策观测行（docs/17-§2 state-diff 相位；导出纯函数供测试）。
 * noop（NOOP_UNKNOWN_STATE/NOOP_UNKNOWN_FLOW/NOOP_IDLE/WAIT_APPROVAL/DEDUP_NOOP）
 * 不落台账事件（事件词表冻结）也不改平台——若再无日志行即成观察黑洞：单据静默卡死
 * 无处可见（2026-10-20 哨查事故：14 张 P0/P1 单落 New 态被 NOOP_UNKNOWN_STATE
 * 静默跳过 2 小时，靠台账缺席+镜像态反推才定位）。故 serve 运行面每拍为每个 noop
 * 决策落一行：单号+原因码+决策时平台态。行量有界：候选=活动驱动 + 镜像对账扫描拍
 * （每 mirrorRescanEveryTicks 拍一轮，DEV-42①——节流闸即 noop 行量闸）。
 */
export function renderNoopDecision(seq: number, entry: TickDecisionEntry): string {
  return `[serve] tick#${seq} noop：${entry.ticket} code=${entry.code} state=${entry.state}（noop 无台账事件，此行=唯一观测面）`
}

/** 一拍全部 noop 决策观测行（actionType=noop 的决策逐条可见） */
export function noopLinesOf(report: TickReport): string[] {
  return report.phases.stateDiff.decisions.filter((d) => d.actionType === 'noop').map((d) => renderNoopDecision(report.seq, d))
}
