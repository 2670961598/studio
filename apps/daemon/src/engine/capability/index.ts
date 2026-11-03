/**
 * engine/capability —— 能力供给 CAP 记录写面＋能力缺口五出口决策接线（NEG-RING-03）
 *
 * 依据：docs/v2/11 §9（REC-CAP 四类）、docs/v2/02 §五（缺能力处置）、docs/v2/17 §5.1
 * NEG-RING-03 / §3.3 TR-RING-03、docs/17-§2（主循环七相位）。
 *
 * 子域三件（20-§十五「先拆再增」，engine 平面基线不增散件）：
 *   - gap.ts：纯判定编排（core `decideCapabilityGap` 接线；零 IO）；
 *   - supply.ts：REC-CAP-01/RECEIPT 信封映射 → PORT-HIST 唯一写口＋面工厂；
 *   - dispatch.ts：派发失败收口工厂（缺口判定/回执/ESCALATE 留痕；engine 侧一次装配）。
 */
export {
  makeDispatchFail,
  type DispatchFail,
  type DispatchFailArgs,
  type DispatchGapAsk,
} from './dispatch.ts'
export {
  defaultCapabilityGapPolicy,
  judgeCapabilityGap,
  type CapabilityGapDisposition,
  type CapabilityGapPolicy,
  type CapabilityGapRequest,
  type CapabilityGapRuling,
  type CapabilityGapRulingErr,
  type CapabilityGapRulingOk,
} from './gap.ts'
export {
  CAP_RECORD_SCHEMA_REF,
  CAP_RECORD_SPEC_VERSION,
  CAP_RECORD_TYPE_VERSION,
  CAP_RECORD_WRITTEN_BY,
  createCapabilitySupplyFace,
  type CapabilityDeclarationRef,
  type CapabilityProbeRequest,
  type CapabilitySupplyDeps,
  type CapabilitySupplyExecutor,
  type CapabilitySupplyFace,
} from './supply.ts'
