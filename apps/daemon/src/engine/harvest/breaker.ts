/**
 * engine/harvest/breaker.ts —— 断路器入账+熔断链（17-§6：worker 错误→onWorkerError 同单
 * 同签名连击；达阈→ESCALATE 落账+自动开 bug 单（恰一次）——冷却窗内 HOLD_BREAKER_OPEN
 * 压制重派，窗过放行一次半开试探（DEV-46：熔断不再是死锁终态——复位不再只靠被压制的
 * 成功信号）。
 *
 * failHarvest（收割失败）与 executeStallResponse（STALL 咬合，DEV-44）共用——单一实现，
 * 防两面熔断链漂移。20-§十五「按域拆件」：体自 engine.ts 逐字迁出（引擎闭包经 rt）。
 */
import type { EventRecord, IssueRecord, TicketId } from '@studio-next/contract'
import { onWorkerError } from '@studio-next/core'
import { evtDept } from '../sentinel/shape.ts'
import type { EngineRuntime } from '../runtime/types.ts'

export async function strikeBreakerAndMaybeTrip(
  rt: EngineRuntime,
  ticket: TicketId,
  fresh: IssueRecord,
  attempt: number,
  signature: string,
  detail: string,
  tickEvents: EventRecord[],
): Promise<void> {
  const result = onWorkerError(rt.breaker, ticket, signature, rt.now(), { threshold: rt.config.breakerThreshold })
  rt.breaker = result.newState
  if (result.action === null) return
  // 首次熔断：开 bug 单（恰一次；trippedAt 已入账——冷却窗由此起算，窗过 decide 放
  // 半开试探）。DEV-46 wkey 修订：熔断**不再吊销** ticket——半开试探要重签新 key，
  // ticket 级吊销会令试探 key 出生即死（revokedTickets 按单杀全 key，无解吊面）；
  // 凭据撤离走 env-离场（同 GATE_FAIL 语义），终局吊销唯一收口=CLOSE（worker-key.ts 头注）
  const bug = await rt.platform.issues.create({
    title: `[bug] ${ticket} 断路熔断（同签名 ${result.action.strikes} 连击：${signature}）`,
    description: detail,
    type: 'bug',
    dept: evtDept(fresh, rt.config.deptFallback),
    // 不定级：未定级单无状态流（decide NOOP_UNKNOWN_FLOW 明报不动），bug 单待人定级后派
  })
  await rt.platform.links.link(bug.id, ticket, 'relates-to').catch(() => undefined)
  // note 形状冻结（panel BREAKER_NOTE_PATTERN 全锚定解析）：CIRCUIT_BREAK：单号 连击 N
  // 达阈值 M（签名 S）→ 自动开 bug 单 B——DEV-46 半开语义不进本 note（试探观测面=
  // DISPATCH half-open-probe 锚）；wkey 段无空格，随 bug 单号入 (\S+) 捕获，与旧一致
  rt.makeEvent('ESCALATE', fresh, attempt, tickEvents, {
    note: `CIRCUIT_BREAK：${ticket} 连击 ${result.action.strikes} 达阈值 ${rt.config.breakerThreshold}（签名 ${signature}）→ 自动开 bug 单 ${bug.id}${rt.workerKeys !== undefined ? '；wkey=env-离场（熔断非终局——冷却后半开试探重签，DEV-46）' : ''}`,
  })
  rt.syncMirror(bug)
}
