/**
 * CAP 能力供给族记录形状与判定件（REC-CAP-01/02/RECEIPT/ACTIVATE 四类）——MIG-03 / IMPL-03-02
 *
 * 依据链：
 *   - v2/11 §九（CAP 四类字段/不变量/失败出口）；§1.8 CAP 族 4 类登记；
 *     §〇.3-2 决定面封闭清单（REC-CAP-ACTIVATE 必带 `decision_face`）；§〇.7-1（证明边界按类）
 *   - v2/09 ENU-39 资格认定结论、ENU-72 能力回执类别、ENU-73 能力状态链（本文件只引用状态号为判据注释）
 *   - v2/07 §一（九维声明与状态链/采集者独立性）、§六（HCL-0A..HCL-4 闭合判据/双差分/三门不合并）；
 *     v2/08 §六（激活批准段专用形状）；v2/02 §五（资格链，E-3/E-4/E-11/E-13）；v2/15（秘密值不入库）
 *   - plan/05 IMPL-03-02
 *
 * 登记缺口（不臆造）：
 *   1. REC-CAP-01 九维「维度集主表 v2/09」实测无 ENU 条目 → 取 v2/07 §一 正文九维名（中文键），
 *      标 GAP（主表补条后回填）。
 *   2. REC-CAP-RECEIPT `result` 不另立 proved/not_proved 枚举 → `proved: boolean`＋负向结果列表
 *      （「探测记录必须能记录负向结果」以列表承载）。
 *   3. `permission_diff`/`secret_class_diff` 差分形状正文未给 → 结构化 {added, removed} 槽（双差分单列）。
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

// —— §1 记录类型登记（v2/11 §1.8：CAP 族 4 类） ——

/** v2/11 §1.8 CAP 能力供给族 4 类（序即 §1.8 表序） */
export const CAP_RECORD_TYPES = ['REC-CAP-01', 'REC-CAP-02', 'REC-CAP-RECEIPT', 'REC-CAP-ACTIVATE'] as const

export type CapRecordType = (typeof CAP_RECORD_TYPES)[number]

// —— §2 枚举投影（v2/09 主表） ——

/** ENU-39 资格认定结论（承认/附条件承认/不承认） */
export const QUALIFICATION_CONCLUSIONS = ['recognized', 'conditional_recognition', 'not_recognized'] as const
export const QualificationConclusionSchema = z.enum(QUALIFICATION_CONCLUSIONS)
export type QualificationConclusion = (typeof QUALIFICATION_CONCLUSIONS)[number]

/** ENU-72 能力回执类别（落位/安装/挂载/加载/探测/运行时暴露观测/退役/链后清理） */
export const CAPABILITY_RECEIPT_KINDS = [
  'placement', 'installation', 'mounting', 'loading', 'probing', 'runtime_exposure', 'retirement', 'post_chain_cleanup',
] as const
export const CapabilityReceiptKindSchema = z.enum(CAPABILITY_RECEIPT_KINDS)
export type CapabilityReceiptKind = (typeof CAPABILITY_RECEIPT_KINDS)[number]

/** REC-CAP-01 九维名（v2/07 §一 正文；v2/09 未登记 ENU——缺口 1） */
export const CAPABILITY_DIMENSIONS = [
  '中立能力与类型', '实现与来源', '宿主与绑定', '依赖与冲突', '输入输出与已知限制',
  '副作用请求', '生命周期', '观测与成本', '证据与已知不能',
] as const

// —— §3 REC-CAP-01 能力声明（声明是主张非认定） ——

/** 九维声明（strictObject 钉死恰九维：少一维即声明不完整——§九） */
export const CapabilityClaimSchema = z.strictObject({
  中立能力与类型: z.string().min(1),
  实现与来源: z.string().min(1),
  宿主与绑定: z.string().min(1),
  依赖与冲突: z.string().min(1),
  输入输出与已知限制: z.string().min(1),
  /** 副作用请求：只是请求不是授权（§九） */
  副作用请求: z.array(z.string().min(1)),
  /** 生命周期：须列明确不支持项（不得隐藏限制——v2/07 §〇） */
  生命周期: z.strictObject({
    supported: z.array(z.string().min(1)).min(1),
    unsupported: z.array(z.string().min(1)).min(1),
  }),
  观测与成本: z.string().min(1),
  证据与已知不能: z.string().min(1),
})

export const CapabilityDeclarationPayloadSchema = z.strictObject({
  claim: CapabilityClaimSchema,
  /** 声明来源/公司需求（具名） */
  claimant: z.string().min(1),
  version: z.string().min(1),
  /** 声明所依据的证据（声明不超证据；拟稿按不支持处理——§九） */
  evidence_refs: z.array(RecordRefSchema),
})

export type CapabilityDeclarationPayload = z.infer<typeof CapabilityDeclarationPayloadSchema>
export const CapabilityDeclarationRecordSchema = recordEnvelopeSchema(CapabilityDeclarationPayloadSchema, 'REC-CAP-01')

// —— §4 REC-CAP-02 资格认定（独立认定位置；不得自证） ——

export const QualificationDecisionPayloadSchema = z.strictObject({
  subject: RecordRefSchema,
  scope: z.string().min(1),
  /** ENU-39 */
  conclusion: QualificationConclusionSchema,
  conditions: z.array(z.string().min(1)),
  /** 期限（过期即失效不默认延续——§九） */
  term: z.strictObject({ expires_at: TimestampSchema, renewal_rule: z.string().min(1) }),
  /** 声明/实测/探测记录引用（含 REC-CAP-RECEIPT） */
  evidence_refs: z.array(RecordRefSchema).min(1),
  decided_by: z.string().min(1),
  /** 独立性（结构性不可得时：不承认＋明示不能，或附条件承认＋局限记录＋缩短复审＋范围收窄——E-13） */
  independence: z.strictObject({
    verified_by: z.string().min(1),
    control_basis_ref: RecordRefSchema,
    structurally_unavailable: z.boolean(),
    limitation_note: z.string().min(1).optional(),
    shortened_review: z.boolean().optional(),
    narrowed_scope: z.boolean().optional(),
    /** 独立性自填标记（自填即拒收——§九） */
    self_declared: z.boolean().optional(),
  }),
  review_and_invalidation: z.strictObject({
    review_point: TimestampSchema,
    invalidation_rule: z.string().min(1),
    dispute_entry: z.string().min(1),
  }),
  /** 重认（程序同初次，证据充分可简化，不得自认） */
  requalification_basis: z.string().min(1).optional(),
})

export type QualificationDecisionPayload = z.infer<typeof QualificationDecisionPayloadSchema>
export const QualificationDecisionRecordSchema = recordEnvelopeSchema(QualificationDecisionPayloadSchema, 'REC-CAP-02')

/** REC-CAP-02 判定输入（认定者与被认定方关系／职级或安装事实是否被当作资格） */
export interface QualificationDecisionContext {
  /** 认定者＝提供方或直接受益方（自证即拒——§九） */
  providerOrBeneficiaryIsDecider?: boolean
  /** 以职级高/模型贵/安装成功作为资格依据（E-11：都不自动产生资格） */
  rankOrInstallOnly?: boolean
}

// —— §5 REC-CAP-RECEIPT 能力回执（宿主回执或独立探测通道；自报仅线索） ——

export const CapabilityReceiptPayloadSchema = z.strictObject({
  /** ENU-72 */
  receipt_kind: CapabilityReceiptKindSchema,
  /** →REC-CAP-01＋版本（与内容摘要） */
  capability_ref: RecordRefSchema,
  capability_digest: z.string().min(1),
  /** 观测手段（探针步骤与清单唯一主表 v2/12；本卷不定义探针编号） */
  probe_method: z.strictObject({ method: z.string().min(1), checklist_ref: ObjectRefSchema }),
  /** 结论只覆盖被探测的范围/版本/时间（不得外推——§九） */
  environment: z.strictObject({ host_form: z.string().min(1), environment: z.string().min(1), version: z.string().min(1) }),
  /** 结论：proved／not_proved（负向结果必须可记录——§九） */
  result: z.strictObject({
    proved: z.boolean(),
    evidence_refs: z.array(ObjectRefSchema).min(1),
    negative_findings: z.array(z.string().min(1)),
  }),
  /** 采集者与独立性标注（宿主回执/独立通道/自报线索——§九） */
  collector_identity: z.strictObject({
    collector: z.string().min(1),
    channel: z.string().min(1),
    independent: z.boolean(),
  }),
  /** 观测时点（双时间轴） */
  observed_at: TimestampSchema,
})

export type CapabilityReceiptPayload = z.infer<typeof CapabilityReceiptPayloadSchema>
export const CapabilityReceiptRecordSchema = recordEnvelopeSchema(CapabilityReceiptPayloadSchema, 'REC-CAP-RECEIPT')

/** REC-CAP-RECEIPT 判定输入（自报是否被当作已生效证明／结论是否外推） */
export interface CapabilityReceiptContext {
  claimsEffective?: boolean
  scopeExtrapolated?: boolean
}

// —— §6 REC-CAP-ACTIVATE 能力激活批准（决定面封闭清单成员；HCL-2 双差分） ——

/** 差分（权限差分与秘密类别差分须单列，不可由其他探针代证——§九） */
export const DiffSchema = z.strictObject({
  added: z.array(z.string().min(1)),
  removed: z.array(z.string().min(1)),
  basis_ref: ObjectRefSchema,
})

export const CapabilityActivationPayloadSchema = z.strictObject({
  /** →REC-CHG-01 激活批准段（本记录即该段专用形状，不另写 CHG 同段记录） */
  chain_ref: RecordRefSchema,
  /** 被激活能力组合与版本 */
  capability_set: z.array(z.strictObject({ capability_ref: RecordRefSchema, version: z.string().min(1) })).min(1),
  /** HCL-2 权限差分（须单列） */
  permission_diff: DiffSchema,
  /** HCL-2 秘密类别/逻辑引用差分（须单列） */
  secret_class_diff: DiffSchema,
  /** 部署供给确认引用（部署确认不扩权：只供候选与硬限制——§九） */
  supply_confirmation_ref: RecordRefSchema,
  /** 在途出工钉旧版声明 */
  in_flight_pinning: z.array(RecordRefSchema),
  approval_basis: z.array(z.string().min(1)).min(1),
  rollback_path: z.string().min(1),
  dissent_position: z.string().min(1),
  decision_face: DecisionFaceSchema,
  proof_boundary: z.string().min(1),
})

export type CapabilityActivationPayload = z.infer<typeof CapabilityActivationPayloadSchema>
export const CapabilityActivationRecordSchema = recordEnvelopeSchema(CapabilityActivationPayloadSchema, 'REC-CAP-ACTIVATE')

/** REC-CAP-ACTIVATE 判定输入（激活批准是否由验证通过倒推／差分类别是否被合并） */
export interface CapabilityActivationContext {
  /** 「验证已通过」被当作激活批准（三门不合并——§九） */
  inferredFromVerification?: boolean
  /** 权限差分与秘密类别差分被合并成单一差分（须单列——§九） */
  diffsMerged?: boolean
  /** 批准者＝被进化对象或直接受益方 */
  beneficiaryApprover?: boolean
}

// —— §7 形状闸（四类） ——

export const CAP_RECORD_SCHEMAS: Readonly<Record<CapRecordType, z.ZodType>> = {
  'REC-CAP-01': CapabilityDeclarationRecordSchema,
  'REC-CAP-02': QualificationDecisionRecordSchema,
  'REC-CAP-RECEIPT': CapabilityReceiptRecordSchema,
  'REC-CAP-ACTIVATE': CapabilityActivationRecordSchema,
}

// —— §8 判定件（纯函数；不抛错） ——

/**
 * REC-CAP-01 判定（§九）：声明是主张非认定；声明不超证据（有证据引用才可声称已证），
 * 虚报或重大遗漏可问责；声明中没有「明确不支持」清单即隐藏限制。
 */
export function validateCapabilityDeclaration(record: unknown, ctx: { claimsBeyondEvidence?: boolean } = {}): RecordValidationOutcome {
  const parsed = CapabilityDeclarationRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (ctx.claimsBeyondEvidence === true && payload.evidence_refs.length === 0) {
    checks.push(recordReject('payload.evidence_refs', '声明不超证据：无证据引用不得声称已验证（拟稿按不支持处理——§九）'))
  }
  if (payload.claim.生命周期.unsupported.length === 0) {
    checks.push(recordReject('payload.claim.生命周期.unsupported', '生命周期维须列明确不支持项（禁止隐藏限制——§九/v2/07 §〇）'))
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-CAP-02 判定（§九 不变量）：
 *   ① 不得由提供方或直接受益方自证（E-4）；② 职级高/模型贵/安装成功都不自动产生资格（E-11）；
 *   ③ 独立性结构性不可得时须明示限制（不承认或附条件承认＋局限记录＋缩短复审＋范围收窄——E-13）；
 *   ④ 过期即失效不默认延续（期限必填）。
 */
export function validateQualificationDecision(record: unknown, ctx: QualificationDecisionContext = {}): RecordValidationOutcome {
  const parsed = QualificationDecisionRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (payload.independence.self_declared === true) {
    checks.push(recordReject('payload.independence', '独立性自填即拒收（§九）'))
  }
  if (ctx.providerOrBeneficiaryIsDecider === true) {
    checks.push(recordReject('payload.decided_by', '不得由提供方或直接受益方自证（E-4 判负——§九）'))
  }
  if (ctx.rankOrInstallOnly === true) {
    checks.push(recordReject('payload.evidence_refs', '职级高/模型贵/安装成功都不自动产生资格（E-11——§九）'))
  }
  if (payload.independence.structurally_unavailable && payload.conclusion === 'recognized') {
    checks.push(recordReject('payload.independence', '独立性结构性不可得时只能不承认或附条件承认＋局限记录＋缩短复审＋范围收窄（E-13）'))
  }
  if (payload.conclusion === 'conditional_recognition' && payload.conditions.length === 0) {
    checks.push(recordReject('payload.conditions', '附条件承认须写条件（§九）'))
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-CAP-RECEIPT 判定（§九 不变量）：
 *   ① 交付方/执行体自报仅作线索，不得冒充「已生效」证明（collector.identity）；
 *   ② 结论只覆盖被探测范围/版本/时间（不得外推）；
 *   ③ not_proved 须含负向结果（能记录负向结果——HCL 闭合判据）。
 */
export function validateCapabilityReceipt(record: unknown, ctx: CapabilityReceiptContext = {}): RecordValidationOutcome {
  const parsed = CapabilityReceiptRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (!payload.result.proved && payload.result.negative_findings.length === 0) {
    checks.push(recordReject('payload.result.negative_findings', '探测记录必须能记录负向结果：not_proved 须含负向发现（§九）'))
  }
  if (!payload.collector_identity.independent && ctx.claimsEffective === true) {
    checks.push(recordReject('payload.collector_identity', '自报仅作线索，不得冒充「已生效」证明（须宿主回执或独立探测通道——§九）'))
  }
  if (ctx.scopeExtrapolated === true) {
    checks.push(recordReject('payload.environment', '结论只覆盖被探测的范围/版本/时间，不得外推（§九）'))
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-CAP-ACTIVATE 判定（§九 不变量）：
 *   ① 「验证已通过」不得替代激活批准，亦不得倒推（三门不合并）；
 *   ② 版本批准不新增权限、不夹带秘密：权限差分与秘密类别差分须单列（HCL-2 双差分）；
 *   ③ 不得由被进化对象及其直接受益方单独作出；④ 在途出工钉旧版（须登记）。
 */
export function validateCapabilityActivation(record: unknown, ctx: CapabilityActivationContext = {}): RecordValidationOutcome {
  const parsed = CapabilityActivationRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (ctx.inferredFromVerification === true) {
    checks.push(recordReject('recordType', '「验证已通过」不得替代激活批准，亦不得倒推（三门不合并——§九）'))
  }
  if (ctx.diffsMerged === true) {
    checks.push(recordReject('payload.permission_diff', '权限差分与秘密类别差分须单列、不可由其他探针代证（HCL-2 双差分——§九）'))
  }
  if (ctx.beneficiaryApprover === true) {
    checks.push(recordReject('payload.decision_face.decided_by', '不得由被进化对象及其直接受益方单独作出（§九）'))
  }
  if (payload.permission_diff.added.length > 0 || payload.secret_class_diff.added.length > 0) {
    if (payload.supply_confirmation_ref === undefined) {
      checks.push(recordReject('payload.supply_confirmation_ref', '新增权限或秘密类别须另经本记录＋供给确认（不扩权——§九）'))
    }
  }
  if (payload.in_flight_pinning.length === 0) {
    checks.push(recordReject('payload.in_flight_pinning', '在途出工须钉旧版声明（新版本不自动适用于在途——§九）'))
  }
  return mergeOutcomes(...checks)
}
