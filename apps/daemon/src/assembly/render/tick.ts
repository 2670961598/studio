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
      p.collect.cursorLoop ? ' [cursor-loop]' : ''
    }${
      p.stateDiff.reopened > 0 ? ` reopened=${p.stateDiff.reopened}` : ''
    }${p.stateDiff.rescanned > 0 ? ` rescan=+${p.stateDiff.rescanned}` : ''}${
      p.collect.obs !== undefined ? ` obs=${p.collect.obs.faultsRecorded}f/${p.collect.obs.watchesOpened}o/${p.collect.obs.watchesClosed}c open=${p.collect.obs.openWatches}` : ''
    }${p.account.heartbeat ? ' [heartbeat]' : ''}`
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

/**
 * HOLD_LANE_BUSY 观测行（docs/17-§2 泳道租约释放对称；studio-dev-713）。
 *
 * 背景：hold 决策不落台账事件——studio-profit 2026-11-04 因成功收割未释放泳道租约，
 * 同泳道单被 HOLD_LANE_BUSY 静默挡 20.5min（actions=4 dispatched=0，日志无线索）。
 * 故每拍为 lane-busy hold 落一行（ticket/lane/holder/到期），但**按签名去重**：
 * 同单同 lane+holder+expiresAt 只落一次（租约变化/到期换主/释放后再次 busy 才会再落），
 * 避免 30min 停摆期间每拍刷屏。
 */
export function renderHoldLaneBusy(seq: number, entry: TickDecisionEntry): string {
  const expiresAt = entry.laneExpiresAt !== undefined ? new Date(entry.laneExpiresAt).toISOString() : '-'
  return (
    `[serve] tick#${seq} hold：${entry.ticket} code=HOLD_LANE_BUSY lane=${entry.lane ?? '-'} ` +
    `holder=${entry.laneHolder ?? '-'} expiresAt=${expiresAt}（hold 无台账事件；此行=唯一观测面，签名去重）`
  )
}

/**
 * 一拍 lane-busy hold 观测行（带签名去重；`seen` 由调用方跨拍持有）。
 * 去重键=ticket+lane+holder+expiresAt；从决策集消失（释放/派发/关单）→ 清 seen，
 * 下次再 busy 可重新可见（避免「曾经 busy」永久遮蔽）。
 */
export function holdLaneBusyLinesOf(report: TickReport, seen: Map<string, string>): string[] {
  const current = new Map<string, string>()
  const lines: string[] = []
  for (const entry of report.phases.stateDiff.decisions) {
    if (entry.actionType !== 'hold' || entry.code !== 'HOLD_LANE_BUSY') continue
    const signature = `${entry.lane ?? ''}|${entry.laneHolder ?? ''}|${entry.laneExpiresAt ?? ''}`
    current.set(entry.ticket, signature)
    if (seen.get(entry.ticket) !== signature) lines.push(renderHoldLaneBusy(report.seq, entry))
  }
  for (const ticket of [...seen.keys()]) {
    if (!current.has(ticket)) seen.delete(ticket)
  }
  for (const [ticket, signature] of current) seen.set(ticket, signature)
  return lines
}

/** noop 聚合行（方案 A+B：按 (code,state) 分组、签名去重；count+前 3 样本可追溯） */
export function renderNoopAggregate(seq: number, code: string, state: string, tickets: readonly string[]): string {
  const sample = tickets.slice(0, 3).join(',')
  const rest = tickets.length - 3
  return (
    `[serve] tick#${seq} noop聚合：code=${code} state=${state} count=${String(tickets.length)} ` +
    `samples=${sample}${rest > 0 ? `(+${String(rest)} 其余)` : ''}（noop 无台账事件；按签名去重，未变不重复）`
  )
}

/**
 * 一拍 noop 聚合观测行（studio-dev-878 后续：归档票 noop 日志 35% 降噪；方案 A+B）。
 *
 * 背景：archived 票每拍仍进候选（平台全量镜像），每拍 ~135 行 `noop：<ticket> code=… state=Archived`；
 * 本 boot 约 21 万行（35%），且批量日志/决策连带单次 8.8s lag 尖峰。noop 无台账事件，日志=唯一
 * 观测面，不能闭嘴；改为**按 (code,state) 聚合 + 签名去重**：
 *   - 每拍把同码同态决策聚合为一行（count + 前 3 样本 ticket + 其余计数）——可追溯；
 *   - 签名=(code,state,sorted tickets) 与上拍相同 → 不输出（稳态 0–3 行/拍）；
 *   - 新票加入/移除、code/state 变化 → 签名变，输出新聚合行；
 *   - 组从决策集消失 → 清 seen（再现可重新可见，避免永久遮蔽）；
 *   - 变化组 >3 时只输出前 2 组+1 行其余汇总，保证 ≤3 行/拍；
 *   - 逐票全量入口保留 `noopLinesOf(report)`（旧函数不动，排障/verbose 用）。
 * seen 由调用方跨拍持有（同 holdLaneBusyLinesOf 范式）。
 */
export function noopAggregatedLinesOf(report: TickReport, seen: Map<string, string>): string[] {
  const groups = new Map<string, { code: string; state: string; tickets: string[] }>()
  for (const entry of report.phases.stateDiff.decisions) {
    if (entry.actionType !== 'noop') continue
    const key = `${entry.code}|${entry.state}`
    const group = groups.get(key) ?? { code: entry.code, state: entry.state, tickets: [] }
    group.tickets.push(entry.ticket)
    groups.set(key, group)
  }
  const changed: Array<{ code: string; state: string; tickets: string[] }> = []
  for (const key of [...groups.keys()].sort()) {
    const group = groups.get(key)
    if (group === undefined) continue
    const tickets = [...group.tickets].sort()
    const signature = tickets.join(',')
    if (seen.get(key) === signature) continue
    changed.push({ code: group.code, state: group.state, tickets })
  }
  // seen 清理：本拍不存在的组移除（释放/关单/归档退出后不再永久遮蔽）
  for (const key of [...seen.keys()]) {
    if (!groups.has(key)) seen.delete(key)
  }
  for (const key of [...groups.keys()]) {
    const group = groups.get(key)
    if (group !== undefined) seen.set(key, [...group.tickets].sort().join(','))
  }
  const lines: string[] = []
  if (changed.length <= 3) {
    for (const group of changed) lines.push(renderNoopAggregate(report.seq, group.code, group.state, group.tickets))
    return lines
  }
  // 变化组 >3：前 2 组逐组 + 第 3 行汇总其余（保证 ≤3 行/拍）
  for (const group of changed.slice(0, 2)) lines.push(renderNoopAggregate(report.seq, group.code, group.state, group.tickets))
  const rest = changed.slice(2)
  const total = rest.reduce((n, group) => n + group.tickets.length, 0)
  lines.push(
    `[serve] tick#${report.seq} noop聚合：其余 ${String(rest.length)} 组 count=${String(total)} ` +
      `samples=${rest[0]?.tickets.slice(0, 3).join(',') ?? ''}（noop 无台账事件；按签名去重，未变不重复）`,
  )
  return lines
}
