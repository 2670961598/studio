/**
 * recovery/orphan-recovery —— stale epoch 拒收后的孤票兜底 + boot 孤儿扫描（studio-dev-838）
 *
 * 背景（809 部署窗口实测）：20:00 定时岗 #836 占 lane core（epoch 0）；20:00:37 重启 daemon
 * （epoch 0→1）；20:16 旧 epoch 迟到完成被 809 fence 拒收（设计正确：不写台账/不释放依赖/
 * 不推进状态），但该单随即成孤票：Taiga=已派发、daemon inflight=0、无 worker、lane 无 holder，
 * 无自动重派路径（人工重置新单才恢复）。本件补两条兜底：
 *   ① stale 拒收路径（hosts epoch-stale）：平台状态回退「新单」→ 下一拍按既有活动/镜像重决策
 *      自动重派（不新造派发通道；幂等：已有新 epoch inflight / 状态已非已派发 / 新 lane holder
 *      在场均跳过；审计=ESCALATE（stale 面已有）+ GATE_FAIL note 带 recovery 锚）；
 *   ② boot 孤儿扫描（启动例行，非第八相位）：扫描「平台=已派发 ∧ 本地 inflight=空 ∧ lane 无
 *      holder」的单，按同一回退路径收口；限速 maxRecover、幂等（重复扫描状态已变即跳过）、
 *      审计逐单 GATE_FAIL note + 启动日志一行；与 R-B 在途接管（台账 running 行）协同——
 *      后者先收口 interrupted，本扫描只看平台侧孤票，重复接管/重复派发互不双写。
 * 边界：不改契约/事件词表（GATE_FAIL/ESCALATE 复用）；不新增 schema/迁移；不直接调平台
 * transition 原语（走 applyWorkTransition 单一出口=迁移+镜像+记录钩子同源）。
 */
import type { EventRecord, IssueRecord, TicketId } from '@studio-next/contract'
import { flowAnchors, type StateFlow } from '@studio-next/core'
import { applyWorkTransition } from '../work/transition.ts'
import type { EngineRuntime } from '../runtime/types.ts'

/** 单次扫描结果（boot 日志/测试断言面） */
export interface OrphanRecoveryResult {
  /** 扫描到的平台单据数 */
  scanned: number
  /** 回退成功的孤票数 */
  recovered: number
  /** 跳过：本地已有 inflight（新 epoch 接管） */
  skippedInflight: number
  /** 跳过：lane 仍有活 holder（等自然释放，下拍/下次扫描再判） */
  skippedLaneBusy: number
  /** 跳过：平台状态已非「已派发」（已回退/已关闭） */
  skippedNotDispatched: number
  /** 回退失败（平台写失败/flow 缺失/扫描不可达等；明细见 errors） */
  failed: number
  /** 失败/异常明细（boot 日志必须可见；不静默） */
  errors: string[]
  items: Array<{ ticket: TicketId; attempt: number; lane: string }>
}

function laneOf(issue: IssueRecord, rt: EngineRuntime): string {
  return issue.lane ?? rt.config.defaultLane
}

function attemptFor(rt: EngineRuntime, ticket: TicketId): number {
  let max = 0
  for (const rec of rt.ledger.listWorkRecords({ issue: ticket })) max = Math.max(max, rec.attempt)
  return max + 1
}

/** 平台状态回退「新单」单一出口（幂等：状态已非已派发即返回 false） */
async function rollbackDispatchedIssue(
  rt: EngineRuntime,
  issue: IssueRecord,
  tickEvents: EventRecord[],
  auditPrefix: string,
  errors: string[],
): Promise<boolean> {
  const flow: StateFlow | undefined = rt.flowOf(issue)
  if (flow === undefined) {
    errors.push(`孤儿恢复跳过 ${issue.id}：等级未登记状态流（flow 缺失，无法回退）`)
    return false
  }
  const anchors = flowAnchors(flow)
  if (issue.state !== anchors.dispatched) return false // 已被新 epoch 接管/已回退/已关闭
  const attempt = attemptFor(rt, issue.id)
  try {
    await applyWorkTransition(rt.transitionHostOf(tickEvents), {
      ticket: issue.id,
      attempt,
      toState: anchors.fresh,
      event: {
        name: 'GATE_FAIL',
        extra: {
          note: `${auditPrefix};ticket=${issue.id};lane=${laneOf(issue, rt)};from=${issue.state};to=${anchors.fresh};attempt=${String(attempt)}——平台状态回退，下一拍按活动/镜像重决策自动重派（不新造派发通道）`,
        },
      },
    })
    return true
  } catch (err) {
    errors.push(`孤儿恢复失败 ${issue.id}：${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

/**
 * stale epoch 拒收后的单票兜底：平台已知仍=已派发且无新 epoch inflight、lane 无新 holder
 * → 回退新单。返回 true=已回退；false=跳过（幂等/无需）。
 */
export async function recoverStaleTicket(
  rt: EngineRuntime,
  ticket: TicketId,
  _attempt: number,
  lane: string,
  tickEvents: EventRecord[],
  errors: string[],
): Promise<boolean> {
  if (rt.inflight.has(ticket)) return false // 新 epoch 已接管
  if (rt.lanes.state(lane).holder !== null) return false // 新 holder 在场（等自然释放/新决策）
  let fresh: IssueRecord
  try {
    fresh = await rt.platform.issues.get(ticket)
  } catch (err) {
    errors.push(`孤儿恢复读取平台失败 ${ticket}：${err instanceof Error ? err.message : String(err)}`)
    return false
  }
  return rollbackDispatchedIssue(rt, fresh, tickEvents, 'lease-epoch-stale-recovery', errors)
}

/** boot 孤儿扫描：平台=已派发 ∧ inflight=空 ∧ lane 无 holder → 回退新单（限速/幂等/审计） */
export async function recoverDispatchedOrphans(
  rt: EngineRuntime,
  opts: { maxRecover?: number; tickEvents?: EventRecord[]; errors?: string[] } = {},
): Promise<OrphanRecoveryResult> {
  const tickEvents = opts.tickEvents ?? []
  const errors = opts.errors ?? []
  const maxRecover = opts.maxRecover ?? 10
  const result: OrphanRecoveryResult = {
    scanned: 0,
    recovered: 0,
    skippedInflight: 0,
    skippedLaneBusy: 0,
    skippedNotDispatched: 0,
    failed: 0,
    errors,
    items: [],
  }
  let issues: readonly IssueRecord[]
  try {
    issues = await rt.platform.issues.list({})
  } catch (err) {
    const message = `boot 孤儿扫描失败：平台 issues.list 不可达（${err instanceof Error ? err.message : String(err)}）——本拍不猜测，下拍/下次重启再扫`
    errors.push(message)
    result.failed = 1
    return result
  }
  result.scanned = issues.length
  for (const issue of issues) {
    if (result.recovered >= maxRecover) break
    const flow = rt.flowOf(issue)
    if (flow === undefined) continue
    const anchors = flowAnchors(flow)
    if (issue.state !== anchors.dispatched) {
      result.skippedNotDispatched += 1
      continue
    }
    if (rt.inflight.has(issue.id)) {
      result.skippedInflight += 1 // 新 epoch 正常在途
      continue
    }
    const lane = laneOf(issue, rt)
    if (rt.lanes.state(lane).holder !== null) {
      result.skippedLaneBusy += 1
      continue
    }
    const ok = await rollbackDispatchedIssue(rt, issue, tickEvents, 'boot-orphan-recovery', errors)
    if (ok) {
      result.recovered += 1
      result.items.push({ ticket: issue.id, attempt: attemptFor(rt, issue.id) - 1, lane })
    } else {
      result.failed += 1
    }
  }
  return result
}
