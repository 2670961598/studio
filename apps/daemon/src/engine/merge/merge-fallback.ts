/**
 * merge-fallback —— 非真单刀轨道共体（202-P3 拆自 merge-run.ts：BC-S2 600 行阈——
 * merge-run.ts 头注仍是语义总纲，本模块承载其「非真单刀」三轨实现体）：
 *   - noteSafe：note 动态字段净化（分号/换行清洗——事件 note 键值面防注入）；
 *   - simulatedMergeTransition：模拟迁移收口共体（v0 模拟轨与手工链收口同一代码体）；
 *   - degradeToManualChain：降级宰相手工链标记轨（chain=manual 锚每单一次 dedupe）。
 * 类型自 merge-run.ts import type 回引（擦除面，无运行时环；值依赖单向 merge-run→本模块）。
 */
import type { EventRecord, IssueRecord } from '@studio-next/contract'
import { MERGE_CHAIN_ANCHOR, type EventIndex } from '../sentinel/events-index.ts'
import type { MergeAction, MergeActionOutcome, MergeRunHost } from './merge-run.ts'

/** note 动态字段净化（分号/换行清洗——事件 note 键值面防注入，mention 同款纪律） */
export function noteSafe(text: string): string {
  return text.replace(/[;\r\n]/g, '，')
}

/**
 * 模拟迁移收口共体（202-P3 转正）：v0 模拟轨与手工链收口**同一代码体**——平台迁移
 * toState＋syncMirror＋MERGE 事件＋计数（不删不改语义，只分轨 note 如实）。v0 轨 note
 * 逐字节不变（P1 byte-identical 钉子）；手工链轨 note 如实＝宰相手工链收口（无真 git
 * 合并——判负线：迁移 note 冒充真合并=判负，禁 sha=/真单刀 字样）。
 */
export async function simulatedMergeTransition(
  host: MergeRunHost,
  action: MergeAction,
  index: EventIndex,
  tickEvents: EventRecord[],
  note: string,
  detail: string,
): Promise<MergeActionOutcome> {
  const transitioned = await host.platform.issues.transition(action.ticket, action.toState)
  host.syncMirror(transitioned)
  host.makeEvent('MERGE', transitioned, index.attemptOf(action.ticket), tickEvents, { note })
  return { result: { ticket: action.ticket, actionType: action.type, ok: true, detail }, deferred: false, counted: true, mutated: true }
}

/** 降级宰相手工链：ESCALATE chain=manual 锚（每单一次——events-index dedupe），位不动零迁移 */
export function degradeToManualChain(
  host: MergeRunHost,
  fresh: IssueRecord,
  index: EventIndex,
  tickEvents: EventRecord[],
  reason: string,
): MergeActionOutcome {
  const ticket = fresh.id
  const noted = index.manualChainNotedOf(ticket)
  if (!noted) {
    host.makeEvent('ESCALATE', fresh, index.attemptOf(ticket), tickEvents, {
      note: `${MERGE_CHAIN_ANCHOR}：合并跑触发不齐（${noteSafe(reason)}）——降级宰相手工链（每拍重查：阻断件修复即自恢复；本锚每单一次）`,
    })
  }
  return {
    result: { ticket, actionType: 'merge', ok: true, detail: `降级宰相手工链（${reason}）` },
    deferred: false,
    counted: false,
    mutated: !noted,
  }
}
