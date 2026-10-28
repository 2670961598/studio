/**
 * REV 复盘族记录形状与判定件（REC-REV-01 一类）——MIG-03 / IMPL-03-02
 *
 * 依据链：
 *   - v2/11 §十（复盘字段/不变量）；§1.9 REV 族 1 类登记；§〇.7 证明边界（决定类）
 *   - v2/05 OBJ-04（复盘对象本体）；v2/04 §十一（个人经验与学习三层）；v2/01 I-3（负价值同样入账）
 *   - v2/09：复盘无专属值集（产出三去向分别引 REC-MEM-01 / REC-CHG-01 / REC-EVAL-01，不另立枚举）
 *   - plan/05 IMPL-03-02
 *
 * 登记缺口（不臆造）：产出三去向正文未给机器形状 → 结构化三槽（个人经验/方法与规则候选/结构问题），
 * 槽位值一律为记录引用（不新立值集）。
 *
 * 纪律：只写可擦除语法；相对 import 带 `.ts`；类型导入 `import type`；不定义族外枚举字面量。
 */
import { z } from 'zod'
import {
  DecisionFaceSchema,
  RecordRefSchema,
  TimestampSchema,
  checkEffectiveSlotConsistency,
  issuesFromZod,
  mergeOutcomes,
  recordEnvelopeSchema,
  recordReject,
  type RecordValidationOutcome,
} from './envelope.ts'

// —— §1 记录类型登记（v2/11 §1.9：REV 族 1 类） ——

/** v2/11 §1.9 REV 复盘族 1 类 */
export const REV_RECORD_TYPES = ['REC-REV-01'] as const

export type RevRecordType = (typeof REV_RECORD_TYPES)[number]

// —— §2 REC-REV-01 复盘（已终局事项/周期的价值与过程评价；产出三去向） ——

export const ReviewPayloadSchema = z.strictObject({
  /** 事项集/时间窗（业务时间窗，非生效窗口——§0.5） */
  scope: z.strictObject({
    matters: z.array(RecordRefSchema).min(1),
    window: z.strictObject({ from: TimestampSchema, to: TimestampSchema }),
  }),
  /** 输入：验收结论、代价账（REC-EVD-04）、相对方与受影响者反馈、反例与未兑现承诺 */
  inputs: z.strictObject({
    acceptance_refs: z.array(RecordRefSchema),
    cost_account_ref: RecordRefSchema,
    counterparty_feedback: z.array(z.string().min(1)),
    affected_party_feedback: z.array(z.string().min(1)),
    contrary_examples: z.array(z.string().min(1)),
    unfulfilled_commitments: z.array(RecordRefSchema),
  }),
  findings: z.array(
    z.strictObject({
      finding: z.string().min(1),
      basis_refs: z.array(RecordRefSchema).min(1),
    }),
  ).min(1),
  /** 产出三去向（方法与规则候选入变更链，不直接生效；结构问题转 EVAL） */
  outputs: z.strictObject({
    personal_experience_refs: z.array(RecordRefSchema),
    method_rule_candidates: z.array(RecordRefSchema),
    structural_issues: z.array(RecordRefSchema),
  }),
  /** 复盘位置（不由被交付方单独作出）＋独立性声明 */
  independence: z.strictObject({
    decided_by: z.string().min(1),
    independence_note: z.string().min(1),
    self_declared: z.boolean().optional(),
  }),
  dissent_position: z.string().min(1),
  decision_face: DecisionFaceSchema,
})

export type ReviewPayload = z.infer<typeof ReviewPayloadSchema>
export const ReviewRecordSchema = recordEnvelopeSchema(ReviewPayloadSchema, 'REC-REV-01')

/** REC-REV-01 判定输入（是否被用来追认/改写历史／负价值是否漏记／候选是否直接生效） */
export interface ReviewContext {
  /** 以复盘结论补授权（追认化） */
  usedToRatifyAuthorization?: boolean
  /** 以复盘结论改写验收历史 */
  rewritesAcceptanceHistory?: boolean
  /** 负价值未入账（I-3 判负） */
  negativeValueOmitted?: boolean
  /** 方法与规则候选未入变更链却直接生效（不得直接生效——§十） */
  methodCandidateTakesEffectDirectly?: boolean
}

// —— §3 形状闸（一类） ——

export const REV_RECORD_SCHEMAS: Readonly<Record<RevRecordType, z.ZodType>> = {
  'REC-REV-01': ReviewRecordSchema,
}

// —— §4 判定件（纯函数；不抛错） ——

/**
 * REC-REV-01 判定（§十 不变量）：
 *   ① 复盘≠追认：不得以复盘结论补授权或改写验收历史；
 *   ② 负价值同样入账（I-3）：代价账必引且不得漏记负价值；
 *   ③ 方法与规则候选入变更链不直接生效；④ 复盘位置不由被交付方单独作出（独立性不得自填）；
 *   ⑤ 复盘结论自身可被异议与重开（异议位置必填）。
 */
export function validateReview(record: unknown, ctx: ReviewContext = {}): RecordValidationOutcome {
  const parsed = ReviewRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (ctx.usedToRatifyAuthorization === true) {
    checks.push(recordReject('payload.outputs', '复盘≠追认：不得以复盘结论补授权或改写验收历史（§十）'))
  }
  if (ctx.rewritesAcceptanceHistory === true) {
    checks.push(recordReject('payload.inputs.acceptance_refs', '复盘不得改写验收历史（复盘结论自身可被异议与重开——§十）'))
  }
  if (payload.independence.self_declared === true) {
    checks.push(recordReject('payload.independence', '复盘位置不由被交付方单独作出（独立性不得自填——§十）'))
  }
  if (ctx.negativeValueOmitted === true) {
    checks.push(recordReject('payload.inputs.cost_account_ref', '负价值同样入账（I-3：好结果不洗掉违规过程与隐性成本——§十）'))
  }
  if (ctx.methodCandidateTakesEffectDirectly === true) {
    checks.push(recordReject('payload.outputs.method_rule_candidates', '方法与规则候选入变更链不直接生效（须走 REC-CHG-01 段——§十）'))
  }
  return mergeOutcomes(...checks)
}
