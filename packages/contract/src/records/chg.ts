/**
 * CHG 变更链族记录形状与判定件（REC-CHG-01 一类）——MIG-03 / IMPL-03-02
 *
 * 依据链：
 *   - v2/11 §八（变更链段记录字段/不变量/专用段规则）；§1.7 CHG 族 1 类登记；
 *     §〇.5（生效槽位）；§十四 §14.4-2（段间推进、三门不合并、不可跳段）
 *   - v2/09 ENU-77 变更链段名（段名与次序唯一主表 v2/08 §六）、ENU-78 变更对象类别
 *   - v2/05 OBJ-03；v2/08 §六（三门不合并/CAP-03 影响评估口径）；v2/01 R-8/R-24
 *   - plan/05 IMPL-03-02
 *
 * 专用段规则（§八 写死）：
 *   1. 能力语境的「激活批准」段由 REC-CAP-ACTIVATE 专用形状承载 → 本记录不得为同段另写（双身份）。
 *   2. 组织语境的合并/分立在 REC-LIFE-09 承载并引用本链 → 本记录不复制身份承继字段。
 *   3. 方法沉淀不得只落泛型 REC-DEC-01 而无激活/后验语义段。
 *
 * 登记缺口（不臆造）：
 *   1. `impact_assessment` 形状正文只给口径（CAP-03：任务/信息/权限/承诺/证据/资格/在途副作用）→
 *      本文件以七槽结构化承载。
 *   2. `controlled_rollout` / `post_review` / `post_chain_duties` 正文未给机器形状 → 结构化槽。
 *
 * 纪律：只写可擦除语法；相对 import 带 `.ts`；类型导入 `import type`；不定义族外枚举字面量。
 */
import { z } from 'zod'
import {
  EffectiveSlotSchema,
  ObjectRefSchema,
  RecordRefSchema,
  checkEffectiveSlotConsistency,
  issuesFromZod,
  mergeOutcomes,
  recordEnvelopeSchema,
  type RecordValidationOutcome,
} from './envelope.ts'

// —— §1 记录类型登记（v2/11 §1.7：CHG 族 1 类） ——

/** v2/11 §1.7 CHG 变更链族 1 类 */
export const CHG_RECORD_TYPES = ['REC-CHG-01'] as const

export type ChgRecordType = (typeof CHG_RECORD_TYPES)[number]

// —— §2 枚举投影（v2/09 主表） ——

/** ENU-77 变更链段名（次序即链序；保留/停止/恢复/修复为后验观察之后的分支段） */
export const CHANGE_SEGMENTS = [
  'candidate', 'substantive_classification', 'verification_authorization', 'independent_verification',
  'activation_approval', 'controlled_effective', 'post_review', 'retain', 'stop', 'restore', 'repair', 'post_chain_duty',
] as const
export const ChangeSegmentSchema = z.enum(CHANGE_SEGMENTS)
export type ChangeSegment = (typeof CHANGE_SEGMENTS)[number]

/** 三门段（验证授权／独立验证／激活批准——不得合并、不得互替——§八/§14.4-2） */
export const CHANGE_GATE_SEGMENTS = ['verification_authorization', 'independent_verification', 'activation_approval'] as const

/** ENU-78 变更对象类别 */
export const CHANGE_SUBJECT_KINDS = ['norm', 'rule', 'criteria', 'method', 'structure', 'capability_pack', 'config'] as const
export const ChangeSubjectKindSchema = z.enum(CHANGE_SUBJECT_KINDS)
export type ChangeSubjectKind = (typeof CHANGE_SUBJECT_KINDS)[number]

/** 段间推进：给定前一段，返回合法的下一段集合（空数组＝链尾）——§14.4-2 不可跳段 */
export function nextChangeSegments(previous: ChangeSegment | undefined): readonly ChangeSegment[] {
  switch (previous) {
    case undefined:
      return ['candidate']
    case 'candidate':
      return ['substantive_classification']
    case 'substantive_classification':
      return ['verification_authorization']
    case 'verification_authorization':
      return ['independent_verification']
    case 'independent_verification':
      return ['activation_approval']
    case 'activation_approval':
      return ['controlled_effective']
    case 'controlled_effective':
      return ['post_review']
    case 'post_review':
      return ['retain', 'stop', 'restore', 'repair']
    case 'retain':
    case 'stop':
    case 'restore':
    case 'repair':
      return ['post_chain_duty']
    case 'post_chain_duty':
      return []
  }
}

// —— §3 REC-CHG-01 变更链段记录（每段一条；段不可互替、不可跳段） ——

/** 影响评估七槽（CAP-03 口径：任务/信息/权限/承诺/证据/资格/在途副作用——§八） */
export const ImpactAssessmentSchema = z.strictObject({
  tasks: z.array(z.string().min(1)),
  information: z.array(z.string().min(1)),
  permissions: z.array(z.string().min(1)),
  commitments: z.array(z.string().min(1)),
  evidence: z.array(z.string().min(1)),
  qualifications: z.array(z.string().min(1)),
  in_flight_side_effects: z.array(z.string().min(1)),
})

/** 受控生效（范围与围栏） */
export const ControlledRolloutSchema = z.strictObject({
  scope: z.string().min(1),
  fencing: z.string().min(1),
  monitoring: z.array(z.string().min(1)).min(1),
})

/** 后验观察结论（撤回率/多轮后验/退化比较——不得仅删除最近一条错误经验宣布痊愈） */
export const PostReviewSchema = z.strictObject({
  withdrawal_rate: z.string().min(1),
  multi_round_observations: z.array(z.string().min(1)).min(1),
  degradation_comparison: z.string().min(1),
  conclusion: z.string().min(1),
})

/** 链后义务逐项完成证据（凭据轮换/旧版本退役与清理/残余清点） */
export const PostChainDutySchema = z.strictObject({
  duty: z.string().min(1),
  completion_evidence_ref: ObjectRefSchema,
  residual_inventory: z.array(z.string().min(1)),
})

/** 回退路径（停止条件、监测与回退——撤回与修复是链的后段而非链外动作） */
export const RollbackPathSchema = z.strictObject({
  stop_conditions: z.array(z.string().min(1)).min(1),
  monitoring: z.array(z.string().min(1)).min(1),
  rollback_steps: z.array(z.string().min(1)).min(1),
})

export const ChangeSegmentPayloadSchema = z.strictObject({
  chain_id: z.string().min(1),
  /** ENU-77 段名（每段一条记录） */
  segment: ChangeSegmentSchema,
  /** 被变更对象（引用＋类别） */
  subject: ObjectRefSchema,
  subject_kind: ChangeSubjectKindSchema,
  /** 该段具名作出者与权源（三门不合并——都不能由被进化对象及其直接受益方单独作出） */
  decided_by: z.string().min(1),
  authority_ref: RecordRefSchema,
  basis_refs: z.array(RecordRefSchema).min(1),
  impact_assessment: ImpactAssessmentSchema,
  /** 实质分类段必填（受益方不得单方分类——R-24） */
  classification_basis: z.strictObject({
    criteria: z.array(z.string().min(1)).min(1),
    classification: z.string().min(1),
    beneficiary_involvement: z.string().min(1),
  }).optional(),
  /** 判据资产版本引用（判据变更不得覆盖原结论——R-8：新口径只向前适用） */
  criteria_version: z.string().min(1),
  /** 布尔必填：本段是否覆盖原结论；为真即判负（R-8） */
  no_override: z.boolean(),
  /** 受控生效段必填 */
  controlled_rollout: ControlledRolloutSchema.optional(),
  /** 后验观察段必填 */
  post_review: PostReviewSchema.optional(),
  /** 链后义务段必填（逐项完成证据与残余清点） */
  post_chain_duties: z.array(PostChainDutySchema).optional(),
  rollback_path: RollbackPathSchema,
  dissent_position: z.string().min(1),
  /** 生效槽位（与信封同值——§0.5） */
  ...EffectiveSlotSchema.shape,
})

export type ChangeSegmentPayload = z.infer<typeof ChangeSegmentPayloadSchema>
export const ChangeSegmentRecordSchema = recordEnvelopeSchema(ChangeSegmentPayloadSchema, 'REC-CHG-01')

/** REC-CHG-01 判定输入（链上已有段／各段作出者／受益方关系——判据输入不复制 v2/03 结构） */
export interface ChangeSegmentContext {
  /** 链上已成立的段（次序判定用） */
  previousSegment?: ChangeSegment
  /** 需要三门不合并时：三门各段的具名作出者（键＝段名） */
  gateDeciders?: Partial<Record<(typeof CHANGE_GATE_SEGMENTS)[number], string>>
  /** 被进化对象与直接受益方的具名主体（不得单独作出实质分类/激活批准——§八） */
  beneficiaryActors?: readonly string[]
  /** 实质分类由受益方单方作出（R-24 判负） */
  classifiedByBeneficiary?: boolean
  /** 判据变更覆盖原结论（R-8 判负） */
  criteriaOverridesOriginal?: boolean
  /** 已成立段集合（无验证生效为零的判定输入——§14.4-2） */
  establishedSegments?: readonly ChangeSegment[]
}

// —— §4 形状闸（一类） ——

export const CHG_RECORD_SCHEMAS: Readonly<Record<ChgRecordType, z.ZodType>> = {
  'REC-CHG-01': ChangeSegmentRecordSchema,
}

// —— §5 判定件（纯函数；不抛错） ——

/**
 * REC-CHG-01 判定（§八/§14.4-2）：
 *   ① 段不可跳：`segment` 必为 `previousSegment` 的合法下一段（首段＝candidate）；
 *   ② 三门不合并：验证授权/独立验证/激活批准不得由同一具名位置作出（也不能由被进化对象及其
 *      直接受益方单独作出）；
 *   ③ 受益方不得单方分类（R-24）；判据变更不得覆盖原结论（R-8）；
 *   ④ 无验证生效为零：受控生效/后验须在验证授权＋独立验证＋激活批准之后；
 *   ⑤ 各段条件字段齐备（实质分类/受控生效/后验/链后义务）。
 */
export function validateChangeSegment(record: unknown, ctx: ChangeSegmentContext = {}): RecordValidationOutcome {
  const parsed = ChangeSegmentRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  const issues: { path: string; message: string }[] = []

  const legalNext = nextChangeSegments(ctx.previousSegment)
  if (!legalNext.includes(payload.segment)) {
    issues.push({
      path: 'payload.segment',
      message: `段不可跳不可互替：${ctx.previousSegment ?? '∅'} 之后合法段为 ${legalNext.join('/') || '无（链尾）'}（实得 ${payload.segment}——§八/§14.4-2）`,
    })
  }
  const gateDeciders = ctx.gateDeciders ?? {}
  const deciders = CHANGE_GATE_SEGMENTS.map((segment) => gateDeciders[segment]).filter((value): value is string => value !== undefined)
  if (deciders.length > 1 && new Set(deciders).size === 1) {
    issues.push({ path: 'payload.decided_by', message: '验证授权/独立验证/激活批准三门不得由同一具名位置作出（三门不合并——§八）' })
  }
  if ((ctx.beneficiaryActors ?? []).includes(payload.decided_by) && (payload.segment === 'activation_approval' || payload.segment === 'substantive_classification')) {
    issues.push({ path: 'payload.decided_by', message: '不得由被进化对象及其直接受益方单独作出（§八）' })
  }
  if (payload.segment === 'substantive_classification') {
    if (payload.classification_basis === undefined) {
      issues.push({ path: 'payload.classification_basis', message: '实质分类段必填 classification_basis（受益方不得单方分类——R-24）' })
    }
    if (ctx.classifiedByBeneficiary === true) {
      issues.push({ path: 'payload.decided_by', message: '受益方不得单方分类（R-24——§八）' })
    }
  }
  if (!payload.no_override) {
    issues.push({ path: 'payload.no_override', message: '判据变更不得覆盖原结论（R-8：新口径只向前适用）' })
  }
  if (ctx.criteriaOverridesOriginal === true) {
    issues.push({ path: 'payload.criteria_version', message: '判据变更覆盖原结论＝R-8 判负（原结论保留，新口径只向前适用——§八）' })
  }
  if (payload.segment === 'controlled_effective' || payload.segment === 'post_review') {
    const established = new Set(ctx.establishedSegments ?? [])
    for (const required of CHANGE_GATE_SEGMENTS) {
      if (!established.has(required) && ctx.establishedSegments !== undefined) {
        issues.push({ path: 'payload.segment', message: `无验证生效为零：须先有 ${required} 段（§八/§14.4-2）` })
      }
    }
  }
  if (payload.segment === 'controlled_effective' && payload.controlled_rollout === undefined) {
    issues.push({ path: 'payload.controlled_rollout', message: '受控生效段必填 controlled_rollout（范围与围栏——§八）' })
  }
  if (payload.segment === 'post_review' && payload.post_review === undefined) {
    issues.push({ path: 'payload.post_review', message: '后验观察段必填 post_review（撤回率/多轮后验/退化比较——§八）' })
  }
  if (payload.segment === 'post_chain_duty' && (payload.post_chain_duties === undefined || payload.post_chain_duties.length === 0)) {
    issues.push({ path: 'payload.post_chain_duties', message: '链后义务段必填逐项完成证据与残余清点（MON-13/14——§八）' })
  }
  checks.push(issues.length === 0 ? { ok: true } : { ok: false, issues })
  return mergeOutcomes(...checks)
}
