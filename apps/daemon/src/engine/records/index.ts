/**
 * engine/records —— 记录族生产写面接线子域（studio-dev-527 刀A／studio-dev-605 刀B 重出 #559）
 *
 * 依据：docs/17-§2「记录族生产写面」段（相位×记录类型×写入者映射表）、docs/17-§6
 * （收割四要件不改判据）；docs/v2/11 §〇/§1.4-1.9/§5.2/§六/§七/§八/§十；docs/v2/14 §1.6。
 *
 * 件面：
 *   - `types.ts`：草案/结果三态/端口形状（零 IO）；
 *   - `envelope.ts`：草案 → 契约信封（形状唯一源＝contract ALL_RECORD_SCHEMAS）；
 *   - `state-map.ts`：平台流状态 ↔ 工作十态桥接与 §14.1 边解析（缺口登记在头注）；
 *   - `drafts.ts`：相位 → 记录草案（请求型可直写；决定型前置不齐即拒）；
 *   - `close-drafts.ts` / `governance-drafts.ts`：刀D 七族＋ACC-02 草案（前置闸交 contract 判定件＋被引在库）；
 *   - `gate.ts`：跨记录前置闸（引用类型/匿名位置/同体判定；不改族内判据）；
 *   - `hooks.ts`：相位钩子（相位 5/6 结清、相位 6/断路异常、变更链、复盘）；
 *   - `roster.ts`：公司目录名册端口（people/departments 镜像＝任职/授权链唯一事实源，刀B）；
 *   - `authority.ts`：REC-AUTH-01 授权链派生（root 外部事实唯一注入口；转授边由名册派生，刀B）；
 *   - `life.ts`：REC-LIFE-05 禁配申报／REC-LIFE-01 任命／REC-LIFE-04 出工段派生（五条件逐面判，刀B）；
 *   - `wire.ts`：写面实现（PORT-HIST append；幂等/去重/失败不打断拍；族不变量二道闸；对账读者）；
 *   - `projection.ts`：records ↔ events 双向对账（记录为事实源，events 为可重建投影）。
 */
export {
  RECORD_SCHEMA_REF,
  RECORD_SPEC_VERSION,
  RECORD_WRITTEN_BY,
  RECORD_REFUSAL_CODES,
  NO_DISSENT_LITERAL,
  type DraftDecisionFaceInput,
  type DraftRecordRef,
  type RecordAccountabilityArgs,
  type RecordChangeSegmentArgs,
  type RecordExceptionArgs,
  type RecordMemoryDisposalArgs,
  type RecordRemedyArgs,
  type RecordReviewArgs,
  type RecordSettlementArgs,
  type RecordValueEvaluationArgs,
  type RecordDraft,
  type RecordIdempotencyKey,
  type RecordIntakeArgs,
  type RecordHarvestArgs,
  type RecordRefusalCode,
  type RecordShapeFailure,
  type RecordTransitionArgs,
  type RecordAuthorityArgs,
  type RecordRosterLoadArgs,
  type RecordSegmentArgs,
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
  PENDING_PREREQ_FAMILIES,
  UNBLOCKED_RECORD_FAMILIES,
  INTAKE_DEADLINE_MS,
  blockedDraftFor,
  harvestBatchDraft,
  isoAt,
  workIntakeDraft,
  workTransitionDraft,
  type DraftOutcome,
} from './drafts.ts'
export { exceptionDraft, reviewDraft, settlementDraft } from './close-drafts.ts'
export {
  accountabilityDraft,
  changeSegmentDraft,
  memoryDisposalDraft,
  remedyDraft,
  valueEvaluationDraft,
} from './governance-drafts.ts'
export {
  PHASE_RECORD_FAMILIES,
  RECORDS_RECONCILE_AT_KEY,
  RECORDS_RECONCILE_EVERY_TICKS,
  RECORDS_RECONCILE_LAST_KEY,
  RECORDS_RECONCILE_OVERLAP_MS,
  recordChangePhase,
  recordClosingPhase,
  recordExceptionPhase,
  recordHarvest,
  recordReconcileTick,
  recordReviewPhase,
  recordRosterLoad,
  recordTickIntake,
  recordTransition,
  type PhaseRecordResults,
  type RecordsReconcileKv,
} from './hooks.ts'
export { refMatches, isAnonymousSubject, samePosition } from './gate.ts'
export {
  EXTERNAL_OWNER,
  deptOf,
  isOnDuty,
  personObjectRef,
  personOf,
  positionRefIdOf,
  rosterOf,
  rootDeptsOf,
  topPersonOf,
  type CompanyRoster,
  type RosterDept,
  type RosterPerson,
  type RosterPort,
} from './roster.ts'
export {
  GRANT_FORBIDDEN,
  RECORD_TYPE_VERSION,
  coveringGrantOf,
  delegationDraft,
  delegationRecordId,
  grantRef,
  leaderGrantRecordId,
  rootGrantDraft,
  rootGrantRecordId,
  type AuthorityChain,
  type AuthorityChainEdge,
  type RootGrantFact,
} from './authority.ts'
export {
  APPOINTMENT_PROPOSED_VERSION,
  PROPOSED_TERM_MS,
  appointmentDraft,
  appointmentRecordId,
  conflictRegistryDraft,
  conflictRegistryRecordId,
  independentCheckerOf,
  positionGradeOf,
  workSegmentDraft,
  workSegmentRecordId,
  type PositionGrade,
  type WorkSegmentPrereqs,
} from './life.ts'
export { createRecordWire, authorizationRecordId, planLockRecordId, qualificationRecordId, type RecordWire, type RecordWireDeps } from './wire.ts'
export {
  RECORDED_TYPES,
  ROSTER_ANCHORED_TYPES,
  dispatchedTicketsOf,
  phaseAnchorsOf,
  reconcileProjection,
  rowOf,
  type ProjectionDifference,
  type ProjectionReconciliation,
  type RecordProjectionRow,
} from './projection.ts'
