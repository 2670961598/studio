/**
 * engine/records —— 记录族生产写面接线子域（studio-dev-527）
 *
 * 依据：docs/17-§2「记录族生产写面」段（相位×记录类型×写入者映射表）、docs/17-§6
 * （收割四要件不改判据）；docs/v2/11 §〇/§1.4-1.9/§5.2/§六/§七/§八/§十；docs/v2/14 §1.6。
 *
 * 件面：
 *   - `types.ts`：草案/结果三态/端口形状（零 IO）；
 *   - `envelope.ts`：草案 → 契约信封（形状唯一源＝contract ALL_RECORD_SCHEMAS）；
 *   - `state-map.ts`：平台流状态 ↔ 工作十态桥接与 §14.1 边解析（缺口登记在头注）；
 *   - `drafts.ts`：相位 → 记录草案（请求型可直写；决定型前置不齐即拒）；
 *   - `wire.ts`：写面实现（PORT-HIST append；幂等/去重/失败不打断拍）；
 *   - `projection.ts`：records ↔ events 双向对账（记录为事实源，events 为可重建投影）。
 */
export {
  RECORD_SCHEMA_REF,
  RECORD_SPEC_VERSION,
  RECORD_WRITTEN_BY,
  RECORD_REFUSAL_CODES,
  NO_DISSENT_LITERAL,
  type RecordDraft,
  type RecordIdempotencyKey,
  type RecordIntakeArgs,
  type RecordHarvestArgs,
  type RecordRefusalCode,
  type RecordShapeFailure,
  type RecordTransitionArgs,
  type RecordWirePort,
  type RecordWriteResult,
} from './types.ts'
export { buildEnvelope, type EnvelopeContext, type EnvelopeOutcome } from './envelope.ts'
export {
  PLATFORM_STATES,
  PLATFORM_TO_WORK_STATE,
  WORK_STATE_TO_PLATFORM,
  WORK_STATE_SET,
  assertStateMapComplete,
  requiredEvidenceOf,
  workEdgeOf,
  workStateOf,
} from './state-map.ts'
export {
  BLOCKED_RECORD_FAMILIES,
  INTAKE_DEADLINE_MS,
  blockedDraftFor,
  harvestBatchDraft,
  isoAt,
  workIntakeDraft,
  workTransitionDraft,
  type DraftDecisionFaceInput,
  type DraftOutcome,
  type DraftRecordRef,
} from './drafts.ts'
export { createRecordWire, type RecordWire, type RecordWireDeps } from './wire.ts'
export {
  RECORDED_TYPES,
  dispatchedTicketsOf,
  phaseAnchorsOf,
  reconcileProjection,
  rowOf,
  type ProjectionDifference,
  type ProjectionReconciliation,
  type RecordProjectionRow,
} from './projection.ts'
