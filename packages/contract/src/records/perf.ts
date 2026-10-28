/**
 * PERF 绩效族记录形状与判定件（MIG-03 / IMPL-03-01；K3 载体）
 *
 * 依据链：
 *   - v2/11 §四 REC-PERF-01（字段表/不变量）；§1.3 PERF 族 1 类登记；§〇.7 证明边界（必填）；
 *     §0.5 时间分层（时间窗属业务语义，非生效窗口）；§十五-2（绩效输入必含验收结论与分级完成记录、
 *     审计标注规则）
 *   - v2/09 ENU-135 审计身份标注（internal_boss_self_audit｜superior_audit｜cross_unit｜external——
 *     唯一可称「独立」的是 external）
 *   - v2/02 §九（绩效对象与三层归因、五维结论、不得自评、证据弱→暂不能归因）、§4.2/§4.3（晋升程序第 3 步/
 *     最高宰相同载体同纪律）；v2/08 §二（独立性功能标准）
 *   - plan/05 IMPL-03-01；plan/03 §四（MIG-03）
 *
 * 登记缺口（不臆造，如实标出）：
 *   1. v2/11 §四写「维度集主表 v2/09」，而 v2/09 实测无「绩效五维」ENU 条目 → 本文件取 §四/§02 §九
 *      正文中文五维名（结果/过程/代价/合规/价值）作机器键，标 PERF_DIMENSIONS；登记缺口待主表补条。
 *   2. `layer`（归因层别）同样未在 v2/09 登记 → 取 §四正文中文名，且只收本对象承载的前两层。
 *   3. `proof_boundary` 在 v2/11 §四既是 REC-PERF-01 字段、又是 §0.7-1 全库必填项 → 本文件不在 payload
 *      重复一遍（§0.3-4：同义两处冲突即拒收），由**信封 `proofBoundary`** 承载，判定件强制其在场。
 *
 * 纪律：只写可擦除语法；相对 import 带 `.ts`；类型导入 `import type`。
 */
import { z } from 'zod'
import {
  RecordRefSchema,
  TimestampSchema,
  checkEffectiveSlotConsistency,
  issuesFromZod,
  mergeOutcomes,
  recordEnvelopeSchema,
  type RecordValidationOutcome,
  type SubjectClass,
} from './envelope.ts'

// —— §1 记录类型登记（v2/11 §1.3：PERF 族 1 类）——

/** v2/11 §1.3 PERF 绩效族 1 类 */
export const PERF_RECORD_TYPES = ['REC-PERF-01'] as const

export type PerfRecordType = (typeof PERF_RECORD_TYPES)[number]

// —— §2 枚举/维度投影（ENU-135 在 v2/09；五维与层别见头注缺口 1/2）——

/** ENU-135 审计身份标注（`external` 为唯一可称「独立」的取值；建成＝目标未证 GAP-V2-03） */
export const AUDIT_CLASSES = ['internal_boss_self_audit', 'superior_audit', 'cross_unit', 'external'] as const
export const AuditClassSchema = z.enum(AUDIT_CLASSES)
export type AuditClass = (typeof AUDIT_CLASSES)[number]

/** 绩效五维（§四/§02 §九：不得互相抵消、不得合并为单一分数） */
export const PERF_DIMENSIONS = ['结果', '过程', '代价', '合规', '价值'] as const

/** 归因层别——本对象只承载前两层（组织绩效口径 v2/03，不属本记录） */
export const PERF_LAYERS_IN_SCOPE = ['执行能力表现', '任职者绩效'] as const
export const PerfLayerSchema = z.enum(PERF_LAYERS_IN_SCOPE)

/** 证据弱时的唯一结论表示（§四：证据弱时结论只能是「暂不能归因」；v2/09 未登记机器值——按正文中文） */
export const WEAK_EVIDENCE_CONCLUSION = '暂不能归因'

// —— §3 REC-PERF-01 payload（§四字段表序）——

/** 五维逐维结论（strictObject 钉死恰五维：多一维/少一维/合并为单一分数即拒收） */
export const PerfDimensionsSchema = z.strictObject({
  结果: z.string().min(1),
  过程: z.string().min(1),
  代价: z.string().min(1),
  合规: z.string().min(1),
  价值: z.string().min(1),
})

/** 评价者与独立性声明（§四：evaluator_and_independence；audit_class 必填——ENU-135） */
export const EvaluatorIndependenceSchema = z.strictObject({
  evaluator_ref: RecordRefSchema,
  audit_class: AuditClassSchema,
  /** 是否声明「独立」（唯一可称独立的是 external——内部自审／上级审计不得自称独立） */
  independence_claimed: z.boolean(),
  /** 独立性局限记录（不可得时按附条件承认＋局限性登记传播——v2/02 §五/E-13） */
  limitation_note: z.string().min(1).optional(),
})

export const PerformanceEvaluationPayloadSchema = z.strictObject({
  /** 被评价任职者（→REC-LIFE-01 生效版本；G9 与 G8 同载体同纪律） */
  subject: RecordRefSchema,
  layer: PerfLayerSchema,
  dimensions: PerfDimensionsSchema,
  /** 时间窗与任务分布（业务语义时间窗，非生效窗口——§0.5 禁的是生效语义区间） */
  window_and_distribution: z.strictObject({
    window_from: TimestampSchema,
    window_to: TimestampSchema,
    task_distribution: z.string().min(1),
  }),
  /** 不确定性标注（证据弱时 conclusion 只能是「暂不能归因」） */
  uncertainty: z.strictObject({
    note: z.string().min(1),
    evidence_weak: z.boolean(),
    conclusion: z.string().min(1),
  }),
  evaluator_and_independence: EvaluatorIndependenceSchema,
  /** 申诉入口与期限（§四：必填） */
  appeal_entry: z.strictObject({ entry_ref: RecordRefSchema, deadline: TimestampSchema }),
  /** 输入证据：必含 REC-WORK-09 验收结论＋REC-WORK-08 分级完成记录（§十五-2 跨记录不变量） */
  input_refs: z.array(RecordRefSchema).min(1),
})

export const PerformanceEvaluationRecordSchema = recordEnvelopeSchema(PerformanceEvaluationPayloadSchema, 'REC-PERF-01')

/** 绩效判定输入（主体/评价者类别与审计通道状态——判定面输入，不是记录字段） */
export interface PerformanceEvaluationContext {
  /** 评价者与被评价者是否同体（不得自评；同体只允许 internal_boss_self_audit 标注） */
  sameBody: boolean
  /** 被评价者主体类别（G9 最高宰相/公司整体＝internal_boss） */
  subjectClass?: SubjectClass
  /** 评价者主体类别 */
  evaluatorClass?: SubjectClass
  /** 外部审计通道是否已建成（`external`＝目标未证 GAP-V2-03；默认未建成＝fail-closed） */
  externalAuditAvailable?: boolean
}

// —— §4 判定件 ——

export const PERF_RECORD_SCHEMAS: Readonly<Record<PerfRecordType, z.ZodType>> = {
  'REC-PERF-01': PerformanceEvaluationRecordSchema,
}

/**
 * REC-PERF-01 判定（§四/§十五-2）：
 *   ① 证明边界必填（§0.7-1：证据类与决定类记录）；
 *   ② 不得自评：同体时 audit_class 只能是 `internal_boss_self_audit` 并标「内部老板自审」，
 *      不得填 `external`、不得自称独立（NEG-ORG-15）；
 *   ③ `external` 仅指外部老板/外部锚——通道未建成不得填（GAP-V2-03 fail-closed）；
 *   ④ 单元首长由最高宰相评价→`superior_audit`（ENU-135 逐级 +1、非同体）；
 *   ⑤ 输入必含验收结论（REC-WORK-09）与分级完成记录（REC-WORK-08），不得以执行面终态为输入；
 *   ⑥ 证据弱时结论只能是「暂不能归因」（不得据此作重大任职决定）。
 */
export function validatePerformanceEvaluation(record: unknown, ctx: PerformanceEvaluationContext): RecordValidationOutcome {
  const parsed = PerformanceEvaluationRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const envelope = parsed.data
  const payload = envelope.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(envelope)]
  const issues: { path: string; message: string }[] = []
  const { audit_class: auditClass, independence_claimed: claimsIndependent } = payload.evaluator_and_independence

  if (envelope.proofBoundary === undefined) {
    issues.push({ path: 'proofBoundary', message: '证明边界必填（本记录证明什么、不证明什么——§0.7-1/§四）' })
  }
  if (ctx.sameBody) {
    if (auditClass !== 'internal_boss_self_audit') {
      issues.push({
        path: 'payload.evaluator_and_independence.audit_class',
        message: `评价者与被评价者同体时只能填 internal_boss_self_audit 并标「内部老板自审」（实际 ${auditClass}——ENU-135/NEG-ORG-15）`,
      })
    }
    if (claimsIndependent) {
      issues.push({ path: 'payload.evaluator_and_independence.independence_claimed', message: '内部老板自审不得自称独立（唯一可称独立的是 external——ENU-135）' })
    }
  }
  if (auditClass === 'external' && ctx.externalAuditAvailable !== true) {
    issues.push({
      path: 'payload.evaluator_and_independence.audit_class',
      message: 'external 仅指外部老板/外部锚，通道未建成不得填（GAP-V2-03：外部锚＝目标未证）',
    })
  }
  if (ctx.evaluatorClass === 'internal_boss' && ctx.subjectClass === 'internal_position' && auditClass !== 'superior_audit') {
    issues.push({
      path: 'payload.evaluator_and_independence.audit_class',
      message: `单元首长由最高宰相评价时填 superior_audit（实际 ${auditClass}——ENU-135/§四）`,
    })
  }
  const inputTypes = new Set(payload.input_refs.map((ref) => ref.refType))
  for (const required of ['REC-WORK-09', 'REC-WORK-08'] as const) {
    if (!inputTypes.has(required)) {
      issues.push({
        path: 'payload.input_refs',
        message: `绩效输入必含 ${required}（完成≠验收≠结清三分离；不得以执行面终态为输入——§十五-2）`,
      })
    }
  }
  if (payload.uncertainty.evidence_weak && payload.uncertainty.conclusion !== WEAK_EVIDENCE_CONCLUSION) {
    issues.push({
      path: 'payload.uncertainty.conclusion',
      message: `证据弱时结论只能是「${WEAK_EVIDENCE_CONCLUSION}」（实际「${payload.uncertainty.conclusion}」——§四/v2/02 §九）`,
    })
  }
  checks.push(issues.length === 0 ? { ok: true } : { ok: false, issues })
  return mergeOutcomes(...checks)
}
