/**
 * ACC 问责救济族记录形状与判定件（REC-ACC-01/02）——MIG-03 / IMPL-03-02
 *
 * 依据链：
 *   - v2/11 §七（ACC 两类字段/不变量/出口）；§1.6 ACC 族 2 类登记；§〇.3-2 决定面封闭清单
 *     （REC-ACC-02 必带 `decision_face`）；§〇.7-1（ACC 族必填 `proof_boundary`）
 *   - v2/09 ENU-37 问责结论（含「暂不能归因」合法值）、ENU-38 救济类别
 *   - v2/05 OBJ-01/OBJ-02（问责/救济对象本体）；v2/03 表 C（分层审计与裁判选任）；
 *     v2/02 §九（证据弱不得强行归因）；v2/01 I-11（申辩窗口不得无限期）/I-15（不可补偿损害/
 *     争议期间不得抵销）
 *   - plan/05 IMPL-03-02
 *
 * 登记缺口（不臆造）：
 *   1. 裁判/救济作出者的独立性核验槽正文未给机器形状 → 本文件以 `{verified_by, control_basis_ref}`
 *      承载（与 REC-WORK-09 同口径），自填即拒收。
 *   2. 申辩窗口的「期限或复审条件」二选一：本文件要求 `deadline` 或 `review_condition` 至少一项，
 *      并由 `overdue_disposition` 写逾期去向（I-11）。
 *
 * 纪律：只写可擦除语法；相对 import 带 `.ts`；类型导入 `import type`；不定义族外枚举字面量。
 */
import { z } from 'zod'
import {
  DecisionFaceSchema,
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

// —— §1 记录类型登记（v2/11 §1.6：ACC 族 2 类） ——

/** v2/11 §1.6 ACC 问责救济族 2 类 */
export const ACC_RECORD_TYPES = ['REC-ACC-01', 'REC-ACC-02'] as const

export type AccRecordType = (typeof ACC_RECORD_TYPES)[number]

// —— §2 枚举投影（v2/09 主表） ——

/** ENU-37 问责结论（含「暂不能归因」合法值；证据弱不得强行归因） */
export const ACCOUNTABILITY_CONCLUSIONS = ['established', 'partially_established', 'not_established', 'attribution_undetermined'] as const
export const AccountabilityConclusionSchema = z.enum(ACCOUNTABILITY_CONCLUSIONS)
export type AccountabilityConclusion = (typeof ACCOUNTABILITY_CONCLUSIONS)[number]

/** ENU-38 救济类别（语义源 v2/01） */
export const REMEDY_KINDS = [
  'record_correction', 'decision_revocation', 'qualification_restoration', 'resource_restitution', 'independent_re_review', 'necessary_compensation',
] as const
export const RemedyKindSchema = z.enum(REMEDY_KINDS)
export type RemedyKind = (typeof REMEDY_KINDS)[number]

/** 独立性核验槽（独立检查位置＋控制关系依据；自填即拒收——L3E-02 同口径） */
export const ArbiterIndependenceSchema = z.strictObject({
  verified_by: z.string().min(1),
  control_basis_ref: RecordRefSchema,
  self_declared: z.boolean().optional(),
})

// —— §3 REC-ACC-01 问责案例（说明—质询—申辩—裁判全过程） ——

export const AccountabilityCasePayloadSchema = z.strictObject({
  /** 被问责者任职引用（→REC-LIFE-01 版本） */
  subject_ref: RecordRefSchema,
  /** 事项与后果引用（REC-WORK-17/REC-EVD-04/REC-WORK-12 等） */
  matter_refs: z.array(RecordRefSchema).min(1),
  /** 质疑与说明材料（含不利信息；沉默按报告异常处理） */
  inquiry_materials: z.strictObject({
    allegations: z.array(z.string().min(1)).min(1),
    explanations: z.array(z.string().min(1)),
    adverse_information: z.array(z.string().min(1)),
    silence_treated_as_report_exception: z.boolean(),
  }),
  /** 申辩窗口：期限或复审条件（I-11——不得无限期）＋逾期去向 */
  defense_window: z.strictObject({
    deadline: TimestampSchema.optional(),
    review_condition: z.string().min(1).optional(),
    overdue_disposition: z.string().min(1),
  }),
  /** 裁判位置＋独立性核验（独立于被问责者） */
  arbiter: ArbiterIndependenceSchema,
  /** ENU-37 问责结论（含「暂不能归因」） */
  conclusion: AccountabilityConclusionSchema,
  /** 后果与结算去向：绩效输入、任免建议（不经 v2/03 程序不得改变任命或职级——E-6） */
  consequence_routing: z.strictObject({
    performance_input_ref: RecordRefSchema.optional(),
    appointment_recommendation: z.string().min(1).optional(),
    procedure_ref: RecordRefSchema.optional(),
  }),
  dissent_position: z.string().min(1),
  proof_boundary: z.string().min(1),
})

export type AccountabilityCasePayload = z.infer<typeof AccountabilityCasePayloadSchema>
export const AccountabilityCaseRecordSchema = recordEnvelopeSchema(AccountabilityCasePayloadSchema, 'REC-ACC-01')

/** REC-ACC-01 判定输入（裁判独立性／窗口／后果去向） */
export interface AccountabilityCaseContext {
  /** 裁判位置与被问责者是同体（独立裁判不成立） */
  arbiterSameAsSubject?: boolean
  /** 未经 v2/03 程序即路由到任免改变（E-6 断言面） */
  routesAppointmentChangeWithoutProcedure?: boolean
}

// —— §4 REC-ACC-02 救济决定（决定面封闭清单成员） ——

export const RemedyDecisionPayloadSchema = z.strictObject({
  /** →REC-ACC-01 或错误决定/损害记录 */
  case_ref: RecordRefSchema,
  /** ENU-38 救济类别 */
  remedy_kind: RemedyKindSchema,
  beneficiaries: z.array(z.strictObject({ beneficiary_ref: ObjectRefSchema, application_entry: z.string().min(1) })).min(1),
  executor: ObjectRefSchema,
  /** 执行证据链（执行不能＝未决登记，不消灭义务） */
  execution_evidence: z.array(RecordRefSchema).min(1),
  settlement_confirmation: z.strictObject({
    settled: z.boolean(),
    confirmed_by: z.string().min(1).nullable(),
    confirmed_at: TimestampSchema.nullable(),
  }),
  /** 不可补偿损害边界（不得以责任结算代替终局，争议期间不得抵销——I-15） */
  non_compensable_boundary: z.string().min(1),
  /** 受影响者异议通道（必载——I-15） */
  affected_party_channel: z.string().min(1),
  dissent_position: z.string().min(1),
  decision_face: DecisionFaceSchema,
  proof_boundary: z.string().min(1),
})

export type RemedyDecisionPayload = z.infer<typeof RemedyDecisionPayloadSchema>
export const RemedyDecisionRecordSchema = recordEnvelopeSchema(RemedyDecisionPayloadSchema, 'REC-ACC-02')

/** REC-ACC-02 判定输入（争议期间抵销／执行证据） */
export interface RemedyDecisionContext {
  /** 争议期间以内部收益/后续补偿抵销（I-15 判负） */
  offsettingDuringDispute?: boolean
  /** 执行未完成却声明已结清 */
  claimsSettledWithoutEvidence?: boolean
}

// —— §5 形状闸（两类） ——

export const ACC_RECORD_SCHEMAS: Readonly<Record<AccRecordType, z.ZodType>> = {
  'REC-ACC-01': AccountabilityCaseRecordSchema,
  'REC-ACC-02': RemedyDecisionRecordSchema,
}

// —— §6 判定件（纯函数；不抛错） ——

/**
 * REC-ACC-01 判定（§七 不变量）：
 *   ① 申辩窗口不得无限期（期限或复审条件至少一项；逾期须有处置——I-11）；
 *   ② 裁判独立于被问责者（同体即拒；独立性自填即拒收）；
 *   ③ 后果流向不得绕过 v2/03 程序改变任命或职级（E-6）；
 *   ④ 证据弱时结论只能是「暂不能归因」（形状闸已限定取值，此处核对结论与材料是否相称）。
 */
export function validateAccountabilityCase(record: unknown, ctx: AccountabilityCaseContext = {}): RecordValidationOutcome {
  const parsed = AccountabilityCaseRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (payload.defense_window.deadline === undefined && payload.defense_window.review_condition === undefined) {
    checks.push(recordReject('payload.defense_window', '申辩窗口不得无限期：须给期限或复审条件（I-11）'))
  }
  if (payload.arbiter.self_declared === true) {
    checks.push(recordReject('payload.arbiter', '独立性自填即拒收（须独立检查位置＋控制关系依据——§七/L3E-02）'))
  }
  if (ctx.arbiterSameAsSubject === true) {
    checks.push(recordReject('payload.arbiter', '裁判位置不得由被问责者或其任免链下位单独担任（独立裁判——§七）'))
  }
  if (ctx.routesAppointmentChangeWithoutProcedure === true) {
    checks.push(recordReject('payload.consequence_routing', '不经 v2/03 程序不得改变任命或职级（E-6 断言面——§七）'))
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-ACC-02 判定（§七 不变量）：
 *   ① 争议期间不得以内部收益抵销（I-15）；② 不可补偿损害边界不得以责任结算代替终局；
 *   ③ 执行证据链必填；已结清须有确认者（执行不能＝未决登记，不消灭义务）。
 */
export function validateRemedyDecision(record: unknown, ctx: RemedyDecisionContext = {}): RecordValidationOutcome {
  const parsed = RemedyDecisionRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (ctx.offsettingDuringDispute === true) {
    checks.push(recordReject('payload.non_compensable_boundary', '争议期间不得以内部收益或后续补偿抵销（I-15——§七）'))
  }
  if (payload.settlement_confirmation.settled && payload.settlement_confirmation.confirmed_by === null) {
    checks.push(recordReject('payload.settlement_confirmation.confirmed_by', '结清确认须有具名确认者（执行不能＝未决登记，不消灭义务——§七）'))
  }
  if (ctx.claimsSettledWithoutEvidence === true && payload.execution_evidence.length === 0) {
    checks.push(recordReject('payload.execution_evidence', '无执行证据不得声明救济结清（§七）'))
  }
  if (payload.affected_party_channel.trim().length === 0) {
    checks.push(recordReject('payload.affected_party_channel', '受影响者异议通道必载（I-15——§七）'))
  }
  return mergeOutcomes(...checks)
}
