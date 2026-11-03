/**
 * capability/dispatch —— 派发失败收口的能力缺口接线（五出口决策 + REC-CAP-RECEIPT）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/17-§2（主循环七相位）：本件只做相位 3 派发失败的收口，不增删相位、不改判定相位；
 *   - docs/17-§6（收割四要件）：记录/决策在判定之外留痕，不倒推四要件（记录是留痕不是判据）；
 *   - docs/v2/02 §五（缺能力/退化/成本不可接受处置阶梯；不得静默退化/降标）；
 *   - docs/v2/11 §9（REC-CAP-RECEIPT 探测回执；自报仅线索、负向结果必载）、§0.7（证明边界）；
 *   - docs/v2/17 §5.1 NEG-RING-03（五出口必答；出口缺失/非法 fail-closed 不继续）。
 *
 * 为什么单独一件（20-§十五.三.3「先拆再增」）：engine.ts 冻结尺寸基线 1998 行只减不增；
 * 派发失败收口原为 executeDispatch 内联闭包，本单把它抽为工厂——缺口判定、探测回执、
 * ESCALATE 留痕全驻本件，engine 侧只留一次装配调用（派发失败路径零逻辑复制）。
 *
 * fail-closed：面关（capabilitySupply 未注入）＝原失败路径逐字节不变；面开而决策拒绝
 * （出口缺失/非法/三件不全/策略抛错）时 detail 携 `fail-closed` 短串，调用方不派发。
 */
import type { CapabilityGapRequest } from './gap.ts'
import type { CapabilityProbeRequest, CapabilitySupplyFace } from './supply.ts'
import type { TickActionResult } from '../tick-report/types.ts'

/** 派发失败时携带的能力缺口事实（不含单号/时点——由装配方统一提供） */
export interface DispatchGapAsk {
  readonly kind: CapabilityGapRequest['kind']
  readonly capabilityRef: string
  /** detect 不达标时的探测事实（落 REC-CAP-RECEIPT；其余触发面不传） */
  readonly probe?: Omit<CapabilityProbeRequest, 'ticket' | 'at'>
}

/** 派发失败收口工厂入参（engine 闭包经显式回调接入，本件零 engine 源码依赖） */
export interface DispatchFailArgs {
  /** CAP 面（缺省＝面关：失败路径零行为变更） */
  readonly face: CapabilitySupplyFace | undefined
  readonly ticket: string
  readonly actionType: TickActionResult['actionType']
  readonly attemptOf: () => number
  /** 观测时点（调用方时钟；本件不读墙钟） */
  readonly at: () => string
  /** 归还泳道（决策即占用；失败路径必还，不留死锁） */
  readonly releaseLane: () => void
  /** 删除在途占位 */
  readonly dropInflight: () => void
  /** ESCALATE 事件落账（17-§3 冻结词表内，note 携缺口留痕锚） */
  readonly emitEscalate: (note: string) => void
}

export type DispatchFail = (detail: string, gap?: DispatchGapAsk) => TickActionResult

/**
 * 建派发失败收口：释放占用 → （面开且有缺口事实）落探测回执 → 五出口决策 →
 * ESCALATE 留痕 → detail 追加出口短串。决策拒绝时 detail 携 `fail-closed`，
 * 调用方据此不派发（不静默降级、不以「继续原路径」代替出口）。
 */
export function makeDispatchFail(args: DispatchFailArgs): DispatchFail {
  return (detail, gap) => {
    args.releaseLane()
    args.dropInflight()
    const face = args.face
    if (gap === undefined || face === undefined) {
      return { ticket: args.ticket, actionType: args.actionType, ok: false, detail }
    }
    // 退化事实先落回执（负向发现必载；回执失败不阻断决策面——supply 内日志明报）
    if (gap.probe !== undefined) face.recordProbe({ ...gap.probe, ticket: args.ticket, at: args.at() })
    const ruling = face.judgeGap({
      ticket: args.ticket,
      attempt: args.attemptOf(),
      kind: gap.kind,
      capabilityRef: gap.capabilityRef,
      impactRef: `ticket:${args.ticket}`,
      at: args.at(),
    })
    args.emitEscalate(ruling.trace)
    return { ticket: args.ticket, actionType: args.actionType, ok: false, detail: `${detail}；${ruling.detail}` }
  }
}
