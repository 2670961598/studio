/**
 * EVD 证据族记录形状与判定件（REC-EVD-01..05＋REC-EVD-RVK 六类）——MIG-03 / IMPL-03-02
 *
 * 依据链：
 *   - v2/11 §六（EVD 六类字段/不变量/失败出口）；§1.5 EVD 族 6 类登记；
 *     §〇.7-1（证据类必填 `proof_boundary`）；§〇.5（时间分层：形成/观察分开记）；
 *     §十五-2（EX-2+ 必引收割批次且采集者独立；撤回完成必含后代枚举＋停用证据）
 *   - v2/09 ENU-48（证据八要素以 EVD-ELM-01..08 对象 ID 引用）、ENU-49 来源两级、ENU-50 要素三态、
 *     ENU-51 事后审计结论集（**禁用验收四值**）、ENU-53 执行终态五值、ENU-54 价值结论、ENU-55 四本账、
 *     ENU-60 完整性（`harvest_completeness` 专用命名）、ENU-135 审计身份标注（投影复用 perf.ts）
 *   - v2/08 §1.2/1.3（八要素与来源锚）、§1.4（收割批次与 EX 各级最小集）、§1.6（事后审计）、
 *     §1.7（价值面四本账/负价值）、§1.8（撤回完成＝后代清单＋停用证据）；v2/15 §六（停用机制）
 *   - plan/05 IMPL-03-02
 *
 * 登记缺口（不臆造）：
 *   1. REC-EVD-02 `integrity_state` 值集未在 v2/09 单列（ENU-61 是 v2/14 byteDigestState）→ 非空串承载。
 *   2. REC-EVD-04 四本账的账目结构语义源为 v2/08 §1.7（未给机器形状）→ 每账以 {entries[], basis} 承载，
 *      条目 amount 用 `number | null`（null＝不可量化/未标，**不得压成总分**）。
 *   3. REC-EVD-01 `usage_and_cost` 与 v2/11 §5.1 REC-WORK-05 预留分开记；形状正文未给 → 数组项
 *      {item, amount, unit}（实际消耗/用量，非预留）。
 *
 * 纪律：只写可擦除语法；相对 import 带 `.ts`；类型导入 `import type`；不定义族外枚举字面量。
 */
import { z } from 'zod'
import {
  DeactivationEvidenceSchema,
  RevokedDescendantSchema,
  type GrantClass,
} from './auth.ts'
import { CompletenessSchema } from './common.ts'
import {
  ObjectRefSchema,
  RecordRefSchema,
  TimestampSchema,
  checkEffectiveSlotConsistency,
  issuesFromZod,
  mergeOutcomes,
  recordEnvelopeSchema,
  recordReject,
  type RecordValidationOutcome,
} from './envelope.ts'
import { AuditClassSchema, type AuditClass } from './perf.ts'

// —— §1 记录类型登记（v2/11 §1.5：EVD 族 6 类） ——

/** v2/11 §1.5 EVD 证据族 6 类（序即 §1.5 表序；`REC-EVD-RVK` 为具名段） */
export const EVD_RECORD_TYPES = ['REC-EVD-01', 'REC-EVD-02', 'REC-EVD-03', 'REC-EVD-04', 'REC-EVD-05', 'REC-EVD-RVK'] as const

export type EvdRecordType = (typeof EVD_RECORD_TYPES)[number]

// —— §2 枚举投影（v2/09 主表） ——

/** ENU-48 证据八要素（用对象 ID 引用，不另造字面量——治 L3E-12） */
export const EVIDENCE_ELEMENT_IDS = ['EVD-ELM-01', 'EVD-ELM-02', 'EVD-ELM-03', 'EVD-ELM-04', 'EVD-ELM-05', 'EVD-ELM-06', 'EVD-ELM-07', 'EVD-ELM-08'] as const
export const EvidenceElementIdSchema = z.enum(EVIDENCE_ELEMENT_IDS)
export type EvidenceElementId = (typeof EVIDENCE_ELEMENT_IDS)[number]

/** ENU-49 证据来源两级（自述不得单独支撑 EX-2+） */
export const EVIDENCE_SOURCE_ANCHORS = ['independent_collection', 'self_reported'] as const
export const EvidenceSourceAnchorSchema = z.enum(EVIDENCE_SOURCE_ANCHORS)
export type EvidenceSourceAnchor = (typeof EVIDENCE_SOURCE_ANCHORS)[number]

/** ENU-50 证据要素三态（not_applicable 须理由与判者；missing 退回补件并传导下游） */
export const EVIDENCE_ELEMENT_STATES = ['present', 'not_applicable', 'missing'] as const
export const EvidenceElementStateSchema = z.enum(EVIDENCE_ELEMENT_STATES)
export type EvidenceElementState = (typeof EVIDENCE_ELEMENT_STATES)[number]

/** ENU-51 事后审计结论集（专用结论集；审计不是第二次验收——§六） */
export const AUDIT_CONCLUSIONS = ['no_violation', 'violation_found', 'insufficient_evidence'] as const
export const AuditConclusionSchema = z.enum(AUDIT_CONCLUSIONS)
export type AuditConclusion = (typeof AUDIT_CONCLUSIONS)[number]

/** ENU-53 执行终态五值（执行面自报终态仅作观察；不得压缩为布尔——§六） */
export const EXECUTION_TERMINALS = ['completed', 'error', 'blocked', 'aborted', 'limit_exceeded'] as const
export const ExecutionTerminalSchema = z.enum(EXECUTION_TERMINALS)
export type ExecutionTerminal = (typeof EXECUTION_TERMINALS)[number]

/** ENU-54 价值结论（不得默认有价值；外部反馈为空只能「价值不明」） */
export const VALUE_CONCLUSIONS = ['positive', 'negative', 'neutral', 'value_unknown'] as const
export const ValueConclusionSchema = z.enum(VALUE_CONCLUSIONS)
export type ValueConclusion = (typeof VALUE_CONCLUSIONS)[number]

/** ENU-55 四本账（不得压成一个总分；负价值单独列示） */
export const VALUE_ACCOUNTS = ['artifact_account', 'state_account', 'impact_account', 'cost_account'] as const
export type ValueAccount = (typeof VALUE_ACCOUNTS)[number]

// —— §3 REC-EVD-01 收割批次（观察与输入，不是判断） ——

/** 收割幂等键＝（出工段×采集区间）（§0.4-5 特化键；重复收割按此去重） */
export const HarvestIdempotencyKeySchema = z.strictObject({
  segment_ref: RecordRefSchema,
  collection_from: TimestampSchema,
  collection_to: TimestampSchema,
})

/** 实际用量与成本（与 REC-WORK-05 预留分开记——§六） */
export const UsageAndCostSchema = z.strictObject({
  usage: z.array(z.strictObject({ item: z.string().min(1), amount: z.number().nonnegative(), unit: z.string().min(1) })),
  cost: z.array(z.strictObject({ item: z.string().min(1), amount: z.number().nonnegative(), unit: z.string().min(1) })),
})

export const HarvestBatchPayloadSchema = z.strictObject({
  /** →REC-LIFE-04 出工段 */
  segment_ref: RecordRefSchema,
  source_cursor: z.string().min(1),
  collected_items: z.array(z.strictObject({ item: z.string().min(1), content_ref: ObjectRefSchema })),
  /** 本类型专用命名（不得与 event/view_completeness 互替——ENU-60） */
  harvest_completeness: CompletenessSchema,
  gaps: z.array(z.string().min(1)),
  /** 执行面自报终态——仅作观察（ENU-53 五值，不得压缩为布尔） */
  execution_terminal: ExecutionTerminalSchema,
  usage_and_cost: UsageAndCostSchema,
  idempotency_key: HarvestIdempotencyKeySchema,
})

export type HarvestBatchPayload = z.infer<typeof HarvestBatchPayloadSchema>
export const HarvestBatchRecordSchema = recordEnvelopeSchema(HarvestBatchPayloadSchema, 'REC-EVD-01')

/** REC-EVD-01 判定输入（`usedAsAcceptanceInput`＝该批次被当作验收判断输入） */
export interface HarvestBatchContext {
  usedAsAcceptanceInput?: boolean
  duplicateDelivery?: boolean
}

// —— §4 REC-EVD-02 证据项（单个可复核材料；证明边界本类必填） ——

export const EvidenceItemPayloadSchema = z.strictObject({
  /** →EVD-ELM-01..08 对象 ID（不另造字面量——治 L3E-12） */
  element: EvidenceElementIdSchema,
  /** 原始材料或不可变引用 */
  content_ref: ObjectRefSchema,
  formed_at: TimestampSchema,
  observed_at: TimestampSchema,
  /** 来源链（谁采集、能否独立复采——§1.2） */
  source_chain: z.array(z.string().min(1)).min(1),
  /** 来源两级（ENU-49；自述不得单独支撑 EX-2+） */
  source_anchor: EvidenceSourceAnchorSchema,
  element_state: EvidenceElementStateSchema,
  /** not_applicable 时须理由与判者（不得空着——§六） */
  not_applicable_reason: z.string().min(1).optional(),
  not_applicable_judged_by: z.string().min(1).optional(),
  /** missing 时的补件去向（退回补件并传导下游） */
  missing_refill_route: z.string().min(1).optional(),
  knowledge_scope: z.string().min(1),
  /** 完整性/不可变性状态（值集未登记——缺口 1） */
  integrity_state: z.string().min(1),
  /** 证明边界（本类必填——§六/§0.7-1） */
  proves: z.string().min(1),
  does_not_prove: z.string().min(1),
})

export type EvidenceItemPayload = z.infer<typeof EvidenceItemPayloadSchema>
export const EvidenceItemRecordSchema = recordEnvelopeSchema(EvidenceItemPayloadSchema, 'REC-EVD-02')

// —— §5 REC-EVD-03 证据包（八要素齐备或合法缺项表示） ——

/** 单要素在场表示（`ref` 与 `missing_reason` 二者其一；治 L3E-12 按要素 ID 键的映射） */
export const ElementPresenceSchema = z.strictObject({
  ref: ObjectRefSchema.optional(),
  missing_reason: z.string().min(1).optional(),
})

export const EvidencePackagePayloadSchema = z.strictObject({
  work_ref: RecordRefSchema,
  contract_revision: z.string().min(1),
  /** 按要素 ID 键的映射（不得两平行列表——治 L3E-12） */
  elements_present: z.record(EvidenceElementIdSchema, ElementPresenceSchema),
  /** 自检清单引用与结论（自检恒为交付方自述，不构成独立验收——§六） */
  self_check: z.strictObject({
    checklist_ref: RecordRefSchema,
    conclusion: z.string().min(1),
    self_reported: z.literal(true),
  }),
  /** 自评（真判断归验收位置） */
  sufficiency_claim: z.string().min(1),
  unresolved: z.array(z.string().min(1)),
  dissent_entries: z.array(z.string().min(1)),
})

export type EvidencePackagePayload = z.infer<typeof EvidencePackagePayloadSchema>
export const EvidencePackageRecordSchema = recordEnvelopeSchema(EvidencePackagePayloadSchema, 'REC-EVD-03')

/** REC-EVD-03 判定输入（`forEx2Acceptance`＝本包用于 EX-2+ 验收判断） */
export interface EvidencePackageContext {
  forEx2Acceptance?: boolean
}

// —— §6 REC-EVD-04 价值评估（四本账与价值结论；判断者独立） ——

/** 单本账（entries 逐项；amount=null 表不可量化，不得压成单一分数） */
export const ValueAccountSchema = z.strictObject({
  entries: z.array(z.strictObject({ item: z.string().min(1), amount: z.number().nullable(), note: z.string().min(1) })).min(1),
  basis: z.string().min(1),
})

export const ValueEvaluationPayloadSchema = z.strictObject({
  work_ref: RecordRefSchema,
  /** 价值在验收后作，不回溯改验收（终止单据亦为合法输入） */
  acceptance_ref: RecordRefSchema.nullable(),
  artifact_account: ValueAccountSchema,
  state_account: ValueAccountSchema,
  impact_account: ValueAccountSchema,
  cost_account: ValueAccountSchema,
  /** 负价值单独列示（I-3：好结果不洗掉违规过程与隐性成本） */
  negative_value_items: z.array(z.string().min(1)),
  /** 外部反馈（为空时 conclusion 只能是「价值不明」——治 L3E-03） */
  external_feedback: z.array(z.strictObject({ party: z.string().min(1), feedback_ref: ObjectRefSchema })),
  conclusion: ValueConclusionSchema,
  uncertainty_and_dissent: z.strictObject({
    uncertainty: z.string().min(1),
    dissent_position: z.string().min(1),
  }),
  judged_by: z.string().min(1),
  independence: z.strictObject({
    verified_by: z.string().min(1),
    control_basis_ref: RecordRefSchema,
    self_declared: z.boolean().optional(),
  }),
  /** 证明边界（证据类与决定类必填——§0.7-1） */
  proof_boundary: z.string().min(1),
})

export type ValueEvaluationPayload = z.infer<typeof ValueEvaluationPayloadSchema>
export const ValueEvaluationRecordSchema = recordEnvelopeSchema(ValueEvaluationPayloadSchema, 'REC-EVD-04')

// —— §7 REC-EVD-05 事后独立审计（EX-0/1 闭合第三段；专用结论集） ——

export const PostAuditPayloadSchema = z.strictObject({
  scope: z.string().min(1),
  /** ENU-135 审计身份标注（external 为唯一可称「独立」的取值——目标未证） */
  audit_class: AuditClassSchema,
  /** ENU-51 专用结论集（禁用验收四值——审计不是第二次验收） */
  conclusion: AuditConclusionSchema,
  audited_by: z.string().min(1),
  independence_verified_by: z.strictObject({
    verified_by: z.string().min(1),
    control_basis_ref: RecordRefSchema,
    self_declared: z.boolean().optional(),
  }),
  basis_refs: z.array(RecordRefSchema).min(1),
  /** 发现与建议（处置决定权在被审计对象的任免者） */
  findings: z.array(z.strictObject({ finding: z.string().min(1), recommendation: z.string().min(1) })),
  deadline: TimestampSchema,
  /** 逾期去向（逾期未审计＝异常 REC-WORK-17 并标注「未经事后审计」） */
  overdue_disposition: z.string().min(1),
  dissent_position: z.string().min(1),
})

export type PostAuditPayload = z.infer<typeof PostAuditPayloadSchema>
export const PostAuditRecordSchema = recordEnvelopeSchema(PostAuditPayloadSchema, 'REC-EVD-05')

/** REC-EVD-05 判定输入（审计者是否同体／外部通道是否建成） */
export interface PostAuditContext {
  sameBody?: boolean
  externalAuditAvailable?: boolean
}

// —— §8 REC-EVD-RVK 撤回完成证据（后代清单＋停用证据；与 REC-AUTH-03 同构互证） ——

export const RevocationEvidencePayloadSchema = z.strictObject({
  /** 被撤回的授予/资格/授权引用 */
  subject: RecordRefSchema,
  /** 后代清单（与 REC-AUTH-03.descendants 同构） */
  descendants_inventory: z.array(RevokedDescendantSchema),
  deactivation_evidence: DeactivationEvidenceSchema,
  /** 无后代的显式确认方法（探测方法＋最后探测时点；不得留空视为零） */
  no_descendant_confirmation: z
    .strictObject({ probe_method: z.string().min(1), last_probed_at: TimestampSchema })
    .optional(),
  /** 残留检查期观察义务 → REC-OBS-03 */
  residual_watch_ref: RecordRefSchema.optional(),
})

export type RevocationEvidencePayload = z.infer<typeof RevocationEvidencePayloadSchema>
export const RevocationEvidenceRecordSchema = recordEnvelopeSchema(RevocationEvidencePayloadSchema, 'REC-EVD-RVK')

// —— §9 形状闸（六类） ——

export const EVD_RECORD_SCHEMAS: Readonly<Record<EvdRecordType, z.ZodType>> = {
  'REC-EVD-01': HarvestBatchRecordSchema,
  'REC-EVD-02': EvidenceItemRecordSchema,
  'REC-EVD-03': EvidencePackageRecordSchema,
  'REC-EVD-04': ValueEvaluationRecordSchema,
  'REC-EVD-05': PostAuditRecordSchema,
  'REC-EVD-RVK': RevocationEvidenceRecordSchema,
}

// —— §10 判定件（纯函数；不抛错） ——

/**
 * REC-EVD-01 判定（§六 不变量）：
 *   ① 收割批次是观察与输入不是判断——完整性存疑时不得判接受（须补偿控制＋独立复核＋期限）；
 *   ② 「无输出」与「没采集到」是两件事（采集为空且 gaps 为空＝冒充无输出）；
 *   ③ 重复收割按幂等键去重（不得产生第二次副作用）。
 */
export function validateHarvestBatch(record: unknown, ctx: HarvestBatchContext = {}): RecordValidationOutcome {
  const parsed = HarvestBatchRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (ctx.duplicateDelivery === true) {
    checks.push(recordReject('payload.idempotency_key', '重复收割须按幂等键去重（出工段×采集区间——§0.4-5/§六）'))
  }
  if (payload.harvest_completeness !== 'complete' && ctx.usedAsAcceptanceInput === true) {
    checks.push(recordReject('payload.harvest_completeness', '完整性存疑时不得判接受（补偿控制＋独立复核＋期限除外——§六）'))
  }
  if (payload.collected_items.length === 0 && payload.gaps.length === 0) {
    checks.push(recordReject('payload.gaps', '「无输出」与「没采集到」是两件事：采集为空须登记缺口（§六）'))
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-EVD-02 判定（§六 不变量）：
 *   ① `element_state=not_applicable` 须理由与判者（不得空着）；`missing` 须写补件去向；
 *   ② 自述不得单独支撑 EX-2+（`selfReportedOnly` 且用于 EX-2+ → 拒）。
 */
export function validateEvidenceItem(record: unknown, ctx: { forEx2Acceptance?: boolean } = {}): RecordValidationOutcome {
  const parsed = EvidenceItemRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (payload.element_state === 'not_applicable' && (payload.not_applicable_reason === undefined || payload.not_applicable_judged_by === undefined)) {
    checks.push(recordReject('payload.element_state', '不适用要素须记理由与判者（不得空着视为零——ENU-50）'))
  }
  if (payload.element_state === 'missing' && payload.missing_refill_route === undefined) {
    checks.push(recordReject('payload.missing_refill_route', 'missing 退回补件并传导下游（须写补件去向——§六）'))
  }
  if (payload.source_anchor === 'self_reported' && ctx.forEx2Acceptance === true) {
    checks.push(recordReject('payload.source_anchor', '自述不得单独支撑 EX-2+ 验收（ENU-49/§六）'))
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-EVD-03 判定（§六 不变量）：
 *   ① 八要素逐项在场或合法缺项表示（每项恰有 ref 或 missing_reason）；
 *   ② 自检恒为交付方自述，不构成独立验收；③ EX-2+ 用途时缺项即不得判接受。
 */
export function validateEvidencePackage(record: unknown, ctx: EvidencePackageContext = {}): RecordValidationOutcome {
  const parsed = EvidencePackageRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  const issues: { path: string; message: string }[] = []
  for (const element of EVIDENCE_ELEMENT_IDS) {
    const presence = payload.elements_present[element]
    if (presence === undefined) {
      issues.push({ path: `payload.elements_present.${element}`, message: `证据包须逐要素表示（缺 ${element} 键——八要素齐备或合法缺项，§六）` })
      continue
    }
    if (presence.ref === undefined && presence.missing_reason === undefined) {
      issues.push({ path: `payload.elements_present.${element}`, message: `要素 ${element} 须给 ref 或 missing_reason（不得留空——§六）` })
    }
    if (presence.ref !== undefined && presence.missing_reason !== undefined) {
      issues.push({ path: `payload.elements_present.${element}`, message: `要素 ${element} 不得同时给 ref 与 missing_reason（二选一）` })
    }
    if (ctx.forEx2Acceptance === true && presence.missing_reason !== undefined) {
      issues.push({ path: `payload.elements_present.${element}`, message: `EX-2+ 验收不得以缺项证据包支撑（元素 ${element} 缺失——§六）` })
    }
  }
  if (payload.self_check.self_reported !== true) {
    issues.push({ path: 'payload.self_check.self_reported', message: '自检恒为交付方自述（不构成独立验收——§六）' })
  }
  checks.push(issues.length === 0 ? { ok: true } : { ok: false, issues })
  return mergeOutcomes(...checks)
}

/**
 * REC-EVD-04 判定（§六/§十五-2）：
 *   ① 外部反馈为空时 conclusion 只能是「价值不明」（治 L3E-03）；
 *   ② 四本账不得压成单一总分；负价值单独列示；
 *   ③ 判断者独立性必填且不得自填（self_declared 即拒）；④ 证明边界必填。
 */
export function validateValueEvaluation(record: unknown, ctx: { negativeValueUnlisted?: boolean } = {}): RecordValidationOutcome {
  const parsed = ValueEvaluationRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (payload.external_feedback.length === 0 && payload.conclusion !== 'value_unknown') {
    checks.push(recordReject('payload.conclusion', '外部反馈为空时 conclusion 只能是「价值不明」（不得默认有价值——治 L3E-03）'))
  }
  if (payload.independence.self_declared === true) {
    checks.push(recordReject('payload.independence', '独立性不得自填（judged_by＋independence 必填且独立——治 L3E-03/C-E1）'))
  }
  if (ctx.negativeValueUnlisted === true) {
    checks.push(recordReject('payload.negative_value_items', '负价值须单独列示（I-3：好结果不洗掉违规过程与隐性成本）'))
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-EVD-05 判定（§六 不变量）：
 *   ① 审计不是第二次验收——结论集为专用三值（形状闸已封死验收四值）；
 *   ② 独立性不得自填；公司级/同体只能 `internal_boss_self_audit` 且不得自称独立；
 *   ③ `external` 仅指外部老板/外部锚（通道未建成不得填——fail-closed）；
 *   ④ 逾期未审计＝异常并标注「未经事后审计」。
 */
export function validatePostAudit(record: unknown, ctx: PostAuditContext & { overdue?: boolean } = {}): RecordValidationOutcome {
  const parsed = PostAuditRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (payload.independence_verified_by.self_declared === true) {
    checks.push(recordReject('payload.independence_verified_by', '独立性自填即拒收（须独立检查位置＋控制关系依据——§六/§2.1）'))
  }
  if (ctx.sameBody === true && payload.audit_class !== 'internal_boss_self_audit') {
    checks.push(recordReject('payload.audit_class', '同体审计只能填 internal_boss_self_audit 并标注「内部老板自审」，不得自称独立（ENU-135）'))
  }
  if (payload.audit_class === 'external' && ctx.externalAuditAvailable !== true) {
    checks.push(recordReject('payload.audit_class', 'external 仅指外部老板/外部锚，通道未建成不得填（GAP-V2-03 fail-closed）'))
  }
  if (ctx.overdue === true) {
    checks.push(recordReject('payload.deadline', '逾期未审计＝异常（REC-WORK-17）并标注「未经事后审计」（§六）'))
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-EVD-RVK 判定（§六 不变量，I-6）：
 *   ① 撤回完成＝后代清单＋停用证据，缺任一项不得称完成；
 *   ② 无后代时须显式确认方法（探测方法＋最后探测时点），不得留空视为零；
 *   ③ 撤回后仍存活的执行体须进 REC-OBS-03 持续观察。
 */
export function validateRevocationEvidence(record: unknown, ctx: { liveDescendants?: readonly string[]; claimedComplete?: boolean } = {}): RecordValidationOutcome {
  const parsed = RevocationEvidenceRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (payload.descendants_inventory.length === 0 && payload.no_descendant_confirmation === undefined) {
    checks.push(recordReject('payload.no_descendant_confirmation', '无后代时须给显式确认方法（探测方法与最后探测时点），不得留空视为零（§六/§十五-2）'))
  }
  const enumerated = new Set(payload.descendants_inventory.map((item) => item.identity_ref))
  const missing = (ctx.liveDescendants ?? []).filter((id) => !enumerated.has(id))
  if (missing.length > 0) {
    checks.push(recordReject('payload.descendants_inventory', `后代未全枚举（缺 ${missing.join('/')}）——撤回完成须含后代清单＋停用证据（I-6/§十五-2）`))
  }
  const survivors = (ctx.liveDescendants ?? []).filter((id) => enumerated.has(id))
  if (survivors.length > 0 && ctx.claimedComplete === true) {
    checks.push(recordReject('recordType', '撤回后仍存活的执行体须进 REC-OBS-03 持续观察；未全停不得称撤回完成（§六）'))
  }
  return mergeOutcomes(...checks)
}

/** `subject` 允许的撤回对象记录类型（授予/授权撤回/资格认定——§六） */
export const REVOCATION_SUBJECT_TYPES = ['REC-AUTH-01', 'REC-AUTH-03', 'REC-CAP-02'] as const

/** 供上游（如 REC-AUTH-03 撤回口径）复用的类型别名（避免二次定义 grant_class 值集） */
export type RevocationSubjectGrantClass = GrantClass

/** 复用审计类别别名（REC-EVD-05 与 REC-PERF-01 同一 ENU-135 投影） */
export type PostAuditClass = AuditClass
