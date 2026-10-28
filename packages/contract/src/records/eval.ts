/**
 * EVAL 结构评价族记录形状与判定件（REC-EVAL-01 一类）——MIG-03 / IMPL-03-02
 *
 * 依据链：
 *   - v2/11 §十（结构评价字段/不变量）；§1.9 EVAL 族 1 类登记；§〇.7 证明边界（决定类）
 *   - v2/05 OBJ-05（结构评价对象本体）；v2/03 §2.4/表 D 行 19/20（结构存在理由、成本、空编、
 *     协调失败掩盖、整体资源趋势）；v2/01 R-22 语义、I-11（评价未被接收＝异常）
 *   - v2/09 ENU-79 结构评价结论
 *   - plan/05 IMPL-03-02
 *
 * 登记缺口（不臆造）：评价对象「层级/部门/岗位设置/授权与审计结构」未给机器值集 →
 * `object.kind` 非空串承载（不新立枚举），`object.ref` 走 ID＋版本引用。
 *
 * 纪律：只写可擦除语法；相对 import 带 `.ts`；类型导入 `import type`；不定义族外枚举字面量。
 */
import { z } from 'zod'
import {
  DecisionFaceSchema,
  ObjectRefSchema,
  RecordRefSchema,
  checkEffectiveSlotConsistency,
  issuesFromZod,
  mergeOutcomes,
  recordEnvelopeSchema,
  recordReject,
  type RecordValidationOutcome,
} from './envelope.ts'

// —— §1 记录类型登记（v2/11 §1.9：EVAL 族 1 类） ——

/** v2/11 §1.9 EVAL 结构评价族 1 类 */
export const EVAL_RECORD_TYPES = ['REC-EVAL-01'] as const

export type EvalRecordType = (typeof EVAL_RECORD_TYPES)[number]

// —— §2 枚举投影（v2/09 主表） ——

/** ENU-79 结构评价结论（维持/调整/撤销/升降级建议） */
export const STRUCTURAL_EVALUATION_CONCLUSIONS = ['maintain', 'adjust', 'abolish', 'level_change_suggest'] as const
export const StructuralEvaluationConclusionSchema = z.enum(STRUCTURAL_EVALUATION_CONCLUSIONS)
export type StructuralEvaluationConclusion = (typeof STRUCTURAL_EVALUATION_CONCLUSIONS)[number]

// —— §3 REC-EVAL-01 结构评价（对组织结构本身的后验评价） ——

export const StructuralEvaluationPayloadSchema = z.strictObject({
  /** 评价对象（层级/部门/岗位设置/授权与审计结构；kind 为正文类别名，不新立值集） */
  object: z.strictObject({ kind: z.string().min(1), ref: ObjectRefSchema }),
  /** 判据源：v2/03 §2.4 与表 D 行 19/20 */
  criteria: z.strictObject({
    existence_reason: z.string().min(1),
    cost: z.string().min(1),
    vacancy_state: z.string().min(1),
    coordination_failure_masking: z.string().min(1),
    overall_resource_trend: z.string().min(1),
  }),
  /** 输入：组织绩效口径（v2/03）、整体资源账（代价）、异常与漂移趋势 */
  inputs: z.strictObject({
    org_performance_basis: z.array(RecordRefSchema).min(1),
    resource_account_ref: RecordRefSchema,
    exception_trend_refs: z.array(RecordRefSchema),
  }),
  conclusion: StructuralEvaluationConclusionSchema,
  /** 决定权＝v2/03 表 A′ 行 11（评价自身不作出组织变更） */
  decision_routing: z.strictObject({ decision_body: z.string().min(1), procedure_ref: RecordRefSchema }),
  dissent_position: z.string().min(1),
  decision_face: DecisionFaceSchema,
})

export type StructuralEvaluationPayload = z.infer<typeof StructuralEvaluationPayloadSchema>
export const StructuralEvaluationRecordSchema = recordEnvelopeSchema(StructuralEvaluationPayloadSchema, 'REC-EVAL-01')

/** REC-EVAL-01 判定输入（是否自审／是否以新增层级掩盖协调失败／评价是否被接收） */
export interface StructuralEvaluationContext {
  /** 评价位置处于被评价结构的自审位（不得——须按分层审计上提） */
  evaluatorInSelfReviewPosition?: boolean
  /** 以新增层级掩盖协调失败（R-22 语义判负） */
  addsLayerToMaskCoordinationFailure?: boolean
  /** 评价未被接收（＝异常，走 I-11） */
  received?: boolean
}

// —— §4 形状闸（一类） ——

export const EVAL_RECORD_SCHEMAS: Readonly<Record<EvalRecordType, z.ZodType>> = {
  'REC-EVAL-01': StructuralEvaluationRecordSchema,
}

// —— §5 判定件（纯函数；不抛错） ——

/**
 * REC-EVAL-01 判定（§十 不变量）：
 *   ① 评价位置不得处于被评价结构的自审位（按分层审计上提）；
 *   ② 不得以新增层级掩盖协调失败（R-22 语义）；
 *   ③ 评价未被接收＝异常，走 I-11（不得当作已闭环）；
 *   ④ 评价自身不作出组织变更（决定权在 v2/03 表 A′ 行 11）。
 */
export function validateStructuralEvaluation(record: unknown, ctx: StructuralEvaluationContext = {}): RecordValidationOutcome {
  const parsed = StructuralEvaluationRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (ctx.evaluatorInSelfReviewPosition === true) {
    checks.push(recordReject('payload.decision_face.decided_by', '评价位置不得处于被评价结构的自审位（按 v2/03 分层审计上提——§十）'))
  }
  if (ctx.addsLayerToMaskCoordinationFailure === true) {
    checks.push(recordReject('payload.conclusion', '不得以新增层级掩盖协调失败（R-22 语义——§十）'))
  }
  if (ctx.received === false) {
    checks.push(recordReject('payload.decision_routing', '评价未被接收＝异常，走 I-11（不得当作已闭环——§十）'))
  }
  if (payload.conclusion === 'level_change_suggest' && payload.decision_routing.decision_body.trim().length === 0) {
    checks.push(recordReject('payload.decision_routing', '升降级建议须写决定去向（评价自身不作出组织变更——§十）'))
  }
  return mergeOutcomes(...checks)
}
