/**
 * WORK 任务族·迁移与判定（REC-WORK-06..09＋REC-WORK-ACCEPT-MAINT）——MIG-03 / IMPL-03-02
 *
 * 依据链：
 *   - v2/11 §5.2（06..09＋ACCEPT-MAINT 字段/不变量/失败出口）；§1.4 WORK 族 21 类登记；
 *     §〇.3-2 决定面封闭清单（WORK-06/07/09 必带）；§〇.7 证明边界；§十四 §14.1（M-01..M-29 边全集）
 *   - v2/09 ENU-03 工作十态、ENU-09 验收四值、ENU-13 迁移生产者三分、ENU-14 效果级、
 *     ENU-15 维持三值、ENU-16 验收分型六类、ENU-17 无产物结果六类、ENU-50 要素三态、ENU-80 状态族
 *   - v2/04 §五（十态与生产者三分/非法迁移）、§六（验收四值与可返工性）、§七（维持性验收）；
 *     v2/07 §一；v2/08 §1.4（四要件/独立收割）；v2/01 I-11
 *   - plan/05 IMPL-03-02（拆件：本件＝06..09＋ACCEPT-MAINT；01..05 在 work-intent.ts）
 *
 * 登记缺口（不臆造）：
 *   1. REC-WORK-08 分级要素名（四要件/低侧三件）v2/09 未登记 → 取 v2/04 §1.2/§5.2 正文中文名。
 *   2. REC-WORK-06 的 M-29 是「终态复核（非迁移）」→ 不入边集，由 REC-WORK-11 `review_action` 承载。
 *
 * 纪律：只写可擦除语法；相对 import 带 `.ts`；类型导入 `import type`；不定义族外枚举字面量。
 */
import { z } from 'zod'
import { EvidenceElementStateSchema } from './evd.ts'
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
import {
  HIGH_SIDE_EFFECT_LEVELS,
  NO_DISSENT_LITERAL,
  ThreePartConditionSchema,
  WORK_STATE_FAMILY,
  AcceptanceKindSchema,
  AcceptanceVerdictSchema,
  EffectLevelSchema,
  MigrationProducerTypeSchema,
  WorkStateSchema,
  type EffectLevel,
  type WorkState,
} from './work-intent.ts'

// —— §7 REC-WORK-06 工作状态迁移（决定面封闭清单成员；表外即非法） ——

/** 前置记录（§14.1 表「前置记录」列）：边→必引记录类型；表外边一律拒写 */
export interface WorkTransitionEdge {
  edge: string
  from: WorkState
  to: WorkState
  /** 〔可选〕边：绑定启用须声明语义损失（§14.1 表注） */
  optional: boolean
  /** 该边必引的前置记录类型（§14.1 前置记录列；产出记录入 produced_refs 不算前置） */
  evidence: readonly string[]
}

/** 工作十态合法边全集（§14.1 M-01..M-28；M-29＝终态复核非迁移，由 REC-WORK-11 `review_action` 承载） */
export const WORK_TRANSITIONS: readonly WorkTransitionEdge[] = [
  { edge: 'M-01', from: 'intake', to: 'pending_start', optional: false, evidence: ['REC-WORK-02', 'REC-WORK-03'] },
  { edge: 'M-02', from: 'intake', to: 'rejected', optional: false, evidence: ['REC-WORK-02', 'REC-WORK-03'] },
  { edge: 'M-03', from: 'intake', to: 'intake', optional: false, evidence: ['REC-WORK-02'] },
  { edge: 'M-04', from: 'intake', to: 'intake', optional: false, evidence: ['REC-WORK-02'] },
  { edge: 'M-05', from: 'pending_start', to: 'in_progress', optional: false, evidence: ['REC-WORK-04', 'REC-WORK-05'] },
  { edge: 'M-06', from: 'pending_start', to: 'pending_start', optional: false, evidence: ['REC-WORK-04'] },
  { edge: 'M-07', from: 'pending_start', to: 'paused', optional: false, evidence: ['REC-WORK-04'] },
  { edge: 'M-08', from: 'pending_start', to: 'intake', optional: false, evidence: ['REC-WORK-03', 'REC-WORK-02'] },
  { edge: 'M-09', from: 'pending_start', to: 'terminated', optional: false, evidence: [] },
  { edge: 'M-10', from: 'in_progress', to: 'awaiting_review', optional: false, evidence: ['REC-WORK-08', 'REC-EVD-03'] },
  { edge: 'M-11', from: 'in_progress', to: 'paused', optional: false, evidence: [] },
  { edge: 'M-12', from: 'in_progress', to: 'terminated', optional: false, evidence: [] },
  { edge: 'M-13', from: 'paused', to: 'in_progress', optional: false, evidence: [] },
  { edge: 'M-14', from: 'paused', to: 'rework', optional: false, evidence: ['REC-WORK-10'] },
  { edge: 'M-15', from: 'paused', to: 'terminated', optional: false, evidence: [] },
  { edge: 'M-16', from: 'paused', to: 'awaiting_review', optional: true, evidence: ['REC-WORK-08', 'REC-EVD-03'] },
  { edge: 'M-17', from: 'awaiting_review', to: 'accepted', optional: false, evidence: ['REC-WORK-09'] },
  { edge: 'M-18', from: 'awaiting_review', to: 'awaiting_review', optional: false, evidence: ['REC-WORK-09'] },
  { edge: 'M-19', from: 'awaiting_review', to: 'paused', optional: false, evidence: ['REC-WORK-09'] },
  { edge: 'M-20', from: 'awaiting_review', to: 'rework', optional: false, evidence: ['REC-WORK-09', 'REC-WORK-10'] },
  { edge: 'M-21', from: 'awaiting_review', to: 'rejected', optional: false, evidence: ['REC-WORK-09'] },
  { edge: 'M-22', from: 'awaiting_review', to: 'terminated', optional: false, evidence: ['REC-WORK-09'] },
  { edge: 'M-23', from: 'rework', to: 'awaiting_review', optional: false, evidence: ['REC-WORK-10'] },
  { edge: 'M-24', from: 'rework', to: 'intake', optional: false, evidence: ['REC-WORK-10', 'REC-WORK-02'] },
  { edge: 'M-25', from: 'rework', to: 'terminated', optional: false, evidence: [] },
  { edge: 'M-26', from: 'accepted', to: 'settled', optional: false, evidence: ['REC-WORK-12'] },
  { edge: 'M-27', from: 'rejected', to: 'settled', optional: false, evidence: ['REC-WORK-12'] },
  { edge: 'M-28', from: 'terminated', to: 'settled', optional: false, evidence: ['REC-WORK-12'] },
]

/** 某一状态的全部合法出口（非法迁移须返回「当前状态/期望状态/合法出口列表」——§5.2） */
export function legalWorkExits(from: WorkState): WorkState[] {
  return WORK_TRANSITIONS.filter((edge) => edge.from === from).map((edge) => edge.to)
}

export const WorkTransitionPayloadSchema = z.strictObject({
  /** ENU-80：工作族恒 work（不得与任职/身份族混用） */
  state_family: z.literal(WORK_STATE_FAMILY),
  from_state: WorkStateSchema,
  to_state: WorkStateSchema,
  producer_type: MigrationProducerTypeSchema,
  /** 规则型必附规则依据引用（守护计时者目标未证，建成前由上级位置人工留痕——§14） */
  rule_basis_ref: RecordRefSchema.optional(),
  trigger_ref: RecordRefSchema,
  /** 权源（不写「系统判定」——§5.2） */
  authority_ref: RecordRefSchema,
  precondition_results: z.array(z.strictObject({ item: z.string().min(1), satisfied: z.boolean(), basis: z.string().min(1) })),
  expected_version: z.string().min(1),
  /** 实际行为人（与写入者分开——§0.2） */
  actual_actor: z.string().min(1),
  /** 异议位置（来源白名单；「无异议」为合法表示——§5.2） */
  dissent_position: z.string().min(1),
  dissent_source_ref: RecordRefSchema.optional(),
  /** 三时点（双时间轴——§0.4-3） */
  occurred_at: TimestampSchema,
  observed_at: TimestampSchema,
  recorded_at: TimestampSchema,
  /** 外部落实类才填 */
  receipt_ref: RecordRefSchema.optional(),
  side_effects: z.array(z.string().min(1)),
  /** 前置证据（§14.1 前置记录列） */
  evidence_refs: z.array(RecordRefSchema),
  /** 本迁移产出的记录（如同事务出工段/结清记录——不算前置证据，治 L3D-05） */
  produced_refs: z.array(RecordRefSchema),
  rejection_reason: z.string().min(1).optional(),
  correction_ref: RecordRefSchema.optional(),
  /** 〔可选〕边 M-16 绑定启用时必填：语义损失声明（§14.1 表注） */
  optional_edge_loss_declaration: z.string().min(1).optional(),
  decision_face: DecisionFaceSchema,
})

export type WorkTransitionPayload = z.infer<typeof WorkTransitionPayloadSchema>
export const WorkTransitionRecordSchema = recordEnvelopeSchema(WorkTransitionPayloadSchema, 'REC-WORK-06')

/** REC-WORK-06 判定输入（`triggerAsAuthority`＝把事件/写入者意图当迁移权源——§5.2 不变量） */
export interface WorkTransitionContext {
  triggerAsAuthority?: boolean
}

// —— §8 REC-WORK-07 效果级判定（决定面封闭清单成员） ——

export const EffectLevelPayloadSchema = z.strictObject({
  subject_ref: RecordRefSchema,
  effect_level: EffectLevelSchema,
  reversibility: z.string().min(1),
  affected_rights: z.array(z.string().min(1)),
  /** 交付方 +1（独立首判，不得受交付方控制——§5.2） */
  classified_by: z.string().min(1),
  basis: z.array(z.string().min(1)).min(1),
  /** 争议（争议方/争议点/终裁位置与时限——与 dissent_position 分列） */
  dispute: z.array(
    z.strictObject({
      party: z.string().min(1),
      point: z.string().min(1),
      final_arbiter: z.string().min(1),
      deadline: TimestampSchema,
    }),
  ),
  /** 由级推出的程序口径（EX-2+ 高侧四要件＋独立收割；低侧三件） */
  effect_on_procedure: z.array(z.string().min(1)),
  scope_judged: z.strictObject({
    judged: z.array(z.string().min(1)).min(1),
    not_judged: z.array(z.string().min(1)),
  }),
  dissent_position: z.string().min(1),
  decision_face: DecisionFaceSchema,
})

export type EffectLevelPayload = z.infer<typeof EffectLevelPayloadSchema>
export const EffectLevelRecordSchema = recordEnvelopeSchema(EffectLevelPayloadSchema, 'REC-WORK-07')

/** REC-WORK-07 判定输入（触及敏感面清单／是否存疑未分级／旧结论级——重判不得降档） */
export interface EffectLevelContext {
  /** 触及敏感面任一项即 EX-2+（§5.2） */
  sensitiveSurfaces?: readonly string[]
  /** 存疑/未分级/争议/重判升级一律高侧 */
  doubtful?: boolean
  /** 旧结论效果级（重判是对新事实的重新分类，不是旧结论追溯降级——§5.2） */
  previousLevel?: EffectLevel
}

// —— §9 REC-WORK-08 完成判据记录（完成≠验收≠结清） ——

/** EX-2+ 四要件（终态事件/非空输出/REPORT 落盘/闸门 exit=0——v2/04 §1.2/§5.2） */
export const EX2_COMPLETION_ELEMENTS = ['终态事件', '非空输出', 'REPORT 落盘', '闸门 exit=0'] as const

/** 低侧三件（终态/自报/抽样复核——§5.2） */
export const LOW_SIDE_COMPLETION_ELEMENTS = ['终态事件', '自报', '抽样复核'] as const

/** 分级要素逐项（「不适用」记不适用＋理由＋判者，不得空着——ENU-50/§5.2） */
export const CompletionElementSchema = z.strictObject({
  element: z.string().min(1),
  state: EvidenceElementStateSchema,
  reason: z.string().min(1).optional(),
  judged_by: z.string().min(1).optional(),
})

export const CompletionRecordPayloadSchema = z.strictObject({
  work_ref: RecordRefSchema,
  /** →REC-WORK-07（分级必须真的按效果级执行——§5.2） */
  effect_level_ref: RecordRefSchema,
  completion_basis: z.array(CompletionElementSchema).min(1),
  /** 采集者与独立性标注（EX-2+ 收割者≠交付者；低侧自报须标注） */
  collector_identity: z.strictObject({
    collector: z.string().min(1),
    independence: z.string().min(1),
    self_reported: z.boolean(),
    harvest_batch_ref: RecordRefSchema.optional(),
  }),
  harvest_ref: RecordRefSchema.optional(),
  /** 低侧抽样（样本不得由被查方安排） */
  sampling_ref: RecordRefSchema.optional(),
  gaps: z.array(z.string().min(1)),
  proof_boundary: z.string().min(1),
})

export type CompletionRecordPayload = z.infer<typeof CompletionRecordPayloadSchema>
export const CompletionRecordRecordSchema = recordEnvelopeSchema(CompletionRecordPayloadSchema, 'REC-WORK-08')

// —— §10 REC-WORK-09 验收记录（决定面封闭清单成员；验者≠交付者） ——

/** 独立性核验槽（独立检查位置＋控制关系依据→REC-LIFE-05 禁配结论；自填即拒收——§5.2/L3E-02） */
export const IndependenceVerificationSchema = z.strictObject({
  verified_by: z.string().min(1),
  control_basis_ref: RecordRefSchema,
  self_declared: z.boolean().optional(),
})

export const WorkAcceptancePayloadSchema = z.strictObject({
  work_ref: RecordRefSchema,
  /** 当时验收口径版本（不得用事后口径——§5.2） */
  criteria_revision: z.string().min(1),
  verdict: AcceptanceVerdictSchema,
  /** 拒绝时是否可返工（决定 M-20/M-21 走向——§5.2） */
  reworkable: z.boolean(),
  /** 终局拒绝须说明为何不可返工（L3D-09） */
  non_reworkable_basis: z.string().min(1).optional(),
  scope_judged: z.strictObject({
    judged: z.array(z.string().min(1)).min(1),
    not_judged: z.array(z.string().min(1)),
  }),
  judged_by: z.string().min(1),
  independence_verified_by: IndependenceVerificationSchema,
  /** →REC-EVD-03 证据包＋关键证据项；EX-2+ 须含收割批次 REC-EVD-01 */
  evidence_refs: z.array(RecordRefSchema).min(1),
  /** 附条件必填：条件/责任者/到期处置/复核结果 */
  conditions: z.array(ThreePartConditionSchema),
  basis_and_dissent: z.strictObject({
    basis: z.array(z.string().min(1)).min(1),
    dissent_position: z.string().min(1),
    reply_deadline: TimestampSchema,
  }),
  effect_level_applied: RecordRefSchema,
  acceptance_kind: AcceptanceKindSchema,
  decision_face: DecisionFaceSchema,
})

export type WorkAcceptancePayload = z.infer<typeof WorkAcceptancePayloadSchema>
export const WorkAcceptanceRecordSchema = recordEnvelopeSchema(WorkAcceptancePayloadSchema, 'REC-WORK-09')

/** REC-WORK-09 判定输入（验者是否＝交付者／是否以自检冒充独立验收／效果级） */
export interface WorkAcceptanceContext {
  judgedByDeliverer?: boolean
  selfCheckOnly?: boolean
  effectLevel?: EffectLevel
}

// —— §10 REC-WORK-ACCEPT-MAINT 枚举投影（v2/09） ——

/** ENU-15 维持结论三值（无法判断须写补证路径、由谁在何时补——§5.2） */
export const MAINT_VERDICTS = ['maintained', 'not_maintained', 'undeterminable'] as const
export const MaintVerdictSchema = z.enum(MAINT_VERDICTS)

/** ENU-17 无产物结果六类（维持/无产物按分型口径，不套产物模板） */
export const MAINT_RESULT_KINDS = ['standby', 'upkeep', 'avoidance', 'refusal', 'deferral', 'withdrawal'] as const
export const MaintResultKindSchema = z.enum(MAINT_RESULT_KINDS)


// —— §13 REC-WORK-ACCEPT-MAINT 维持性验收记录（双指标分判＋独立抽样＋三段证据） ——

export const MaintenanceAcceptancePayloadSchema = z.strictObject({
  work_ref: RecordRefSchema,
  /** 工作与事前声明版本（维持什么/界/检查频率/响应时限/退出条件） */
  criteria_revision: z.string().min(1),
  /** ENU-17 无产物结果分型 */
  result_kind: MaintResultKindSchema,
  /** 状态指标材料（界内时间比例、恢复时长、漂移幅度） */
  state_indicators: z.array(z.strictObject({ indicator: z.string().min(1), material_ref: ObjectRefSchema })),
  /** 过程指标材料（覆盖、响应、误报漏报；两组分别判断、不可互替） */
  process_indicators: z.array(z.strictObject({ indicator: z.string().min(1), material_ref: ObjectRefSchema })),
  /** 独立抽样核验记录（样本不得由被查方安排） */
  sampling_refs: z.array(RecordRefSchema).min(1),
  /** 避免类三段证据（事前/期间/事后；三段不全结论只能「无法判断」） */
  three_stage_refs: z
    .strictObject({ ex_ante: ObjectRefSchema, during: ObjectRefSchema, ex_post: ObjectRefSchema })
    .optional(),
  /** ENU-15 维持结论三值 */
  verdict: MaintVerdictSchema,
  /** 无法判断须写补证路径（由谁在何时补） */
  refill_path: z.string().min(1).optional(),
  /** 复审周期与终止条件 */
  review_cycle: z.strictObject({ cycle: z.string().min(1), exit_terms: z.string().min(1), risk_successor: z.string().min(1) }),
  proof_boundary: z.string().min(1),
})

export type MaintenanceAcceptancePayload = z.infer<typeof MaintenanceAcceptancePayloadSchema>
export const MaintenanceAcceptanceRecordSchema = recordEnvelopeSchema(MaintenanceAcceptancePayloadSchema, 'REC-WORK-ACCEPT-MAINT')

// —— §11 本半形状闸（WORK 06..09＋ACCEPT-MAINT） ——

export const WORK_STATE_RECORD_SCHEMAS = {
  'REC-WORK-06': WorkTransitionRecordSchema,
  'REC-WORK-07': EffectLevelRecordSchema,
  'REC-WORK-08': CompletionRecordRecordSchema,
  'REC-WORK-09': WorkAcceptanceRecordSchema,
  'REC-WORK-ACCEPT-MAINT': MaintenanceAcceptanceRecordSchema,
} as const

/**
 * REC-WORK-06 判定（§14.1/§5.2）：
 *   ① from→to 必在 M-01..M-28 边集内（表外即非法；拒写返回当前状态与合法出口列表）；
 *   ② 该边必引前置记录（§14.1 前置记录列；产出记录入 produced_refs 不算前置——治 L3D-05）；
 *   ③ 规则型必附规则依据引用；④ 事件/写入者意图不得作迁移权源；
 *   ⑤ 异议位置只可因「缺载且无『无异议』表示」拒写；⑥〔可选〕边绑定须声明语义损失。
 */
export function validateWorkTransition(record: unknown, ctx: WorkTransitionContext = {}): RecordValidationOutcome {
  const parsed = WorkTransitionRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]

  const edges = WORK_TRANSITIONS.filter((edge) => edge.from === payload.from_state && edge.to === payload.to_state)
  if (edges.length === 0) {
    checks.push(
      recordReject(
        'payload.to_state',
        `非法迁移 ${payload.from_state}→${payload.to_state}（当前 ${payload.from_state}；合法出口 ${legalWorkExits(payload.from_state).join('/') || '无（终态）'}——表外即非法，§14.1）`,
      ),
    )
  } else {
    const evidenceTypes = new Set(payload.evidence_refs.map((ref) => ref.refType))
    for (const edge of edges) {
      for (const required of edge.evidence) {
        if (!evidenceTypes.has(required)) {
          checks.push(recordReject('payload.evidence_refs', `边 ${edge.edge} 必引前置记录 ${required}（§14.1 前置记录列）`))
        }
      }
      if (edge.optional && payload.optional_edge_loss_declaration === undefined) {
        checks.push(recordReject('payload.optional_edge_loss_declaration', `〔可选〕边 ${edge.edge} 绑定启用须声明语义损失（§14.1 表注）`))
      }
    }
  }
  if (payload.producer_type === 'rule' && payload.rule_basis_ref === undefined) {
    checks.push(recordReject('payload.rule_basis_ref', '规则型生产者必附规则依据引用（§5.2/§14.1）'))
  }
  if (ctx.triggerAsAuthority === true) {
    checks.push(recordReject('payload.trigger_ref', '事件流/写入者意图不得直接触发迁移（须有权位置决定——§5.2/§十四）'))
  }
  if (payload.trigger_ref.refType === 'REC-EVT-01') {
    checks.push(recordReject('payload.trigger_ref.refType', '事件（REC-EVT-01）不得作为迁移的 trigger 权源（§十五-2）'))
  }
  const dissent = payload.dissent_position.trim()
  if (payload.dissent_source_ref === undefined && dissent !== NO_DISSENT_LITERAL) {
    checks.push(recordReject('payload.dissent_position', '异议位置缺载且无「无异议」表示（只可因缺载且无表示拒写——§5.2）'))
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-WORK-07 判定（§5.2 不变量）：
 *   ① 触及敏感面任一项即 EX-2+；② 存疑/未分级/争议一律高侧；
 *   ③ 重判是对新事实的重新分类，不是旧结论追溯降级。
 */
export function validateEffectLevel(record: unknown, ctx: EffectLevelContext = {}): RecordValidationOutcome {
  const parsed = EffectLevelRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  const isHigh = HIGH_SIDE_EFFECT_LEVELS.includes(payload.effect_level)
  const touchesSensitive = (ctx.sensitiveSurfaces ?? []).some((surface) => payload.affected_rights.includes(surface))
  if ((touchesSensitive || ctx.doubtful === true || payload.dispute.length > 0) && !isHigh) {
    checks.push(recordReject('payload.effect_level', '触及敏感面/存疑/争议/未分级一律 EX-2+（不得自评低档——§5.2）'))
  }
  if (ctx.previousLevel !== undefined && HIGH_SIDE_EFFECT_LEVELS.includes(ctx.previousLevel) && !isHigh) {
    checks.push(recordReject('payload.effect_level', `重判不得把旧结论 ${ctx.previousLevel} 追溯降档（重判是对新事实的重新分类——§5.2）`))
  }
  return mergeOutcomes(...checks)
}

/** REC-WORK-08 判定输入（效果级由 REC-WORK-07 解析；采集者是否交付方） */
export interface CompletionRecordContext {
  effectLevel?: EffectLevel
  collectorIsDeliverer?: boolean
}

/**
 * REC-WORK-08 判定（§5.2/§十五-2）：
 *   ① 分级必须真的按效果级执行——EX-2+ 须四要件齐备（present）＋独立收割（收割者≠交付者）；
 *      按低侧自报闭合＝降档逃证（W-13），完成无效；
 *   ② 证据弱/缺项按「不适用＋理由＋判者」表示，不得空着；
 *   ③ 证明边界必填（§0.7-1）；④ 引用须指向 REC-WORK-07。
 */
export function validateCompletionRecord(record: unknown, ctx: CompletionRecordContext = {}): RecordValidationOutcome {
  const parsed = CompletionRecordRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const envelope = parsed.data
  const payload = envelope.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(envelope)]
  const issues: { path: string; message: string }[] = []
  if (payload.effect_level_ref.refType !== 'REC-WORK-07') {
    issues.push({ path: 'payload.effect_level_ref.refType', message: '完成判据须引 REC-WORK-07 效果级判定（§5.2）' })
  }
  if (envelope.proofBoundary === undefined) {
    issues.push({ path: 'proofBoundary', message: '证明边界必填（本记录证明什么、不证明什么——§0.7-1）' })
  }
  const weakElements = payload.completion_basis.filter(
    (entry) => entry.state !== 'present' && (entry.reason === undefined || entry.judged_by === undefined),
  )
  for (const entry of weakElements) {
    issues.push({ path: 'payload.completion_basis', message: `要素「${entry.element}」非 present 须记不适用＋理由＋判者，不得空着（ENU-50）` })
  }
  const highSide = ctx.effectLevel !== undefined && HIGH_SIDE_EFFECT_LEVELS.includes(ctx.effectLevel)
  if (highSide) {
    const present = new Set(payload.completion_basis.filter((entry) => entry.state === 'present').map((entry) => entry.element))
    for (const required of EX2_COMPLETION_ELEMENTS) {
      if (!present.has(required)) {
        issues.push({ path: 'payload.completion_basis', message: `EX-2+ 须四要件齐备（缺「${required}」——按低侧自报闭合＝降档逃证 W-13）` })
      }
    }
    if (payload.harvest_ref === undefined || payload.collector_identity.harvest_batch_ref === undefined) {
      issues.push({ path: 'payload.harvest_ref', message: 'EX-2+ 须由独立收割者（REC-EVD-01 收割批次）支撑（§5.2）' })
    }
    if (payload.collector_identity.self_reported || ctx.collectorIsDeliverer === true) {
      issues.push({ path: 'payload.collector_identity', message: 'EX-2+ 收割者≠交付者：自报只能是线索，不得冒充独立收缴（§5.2/v2/08 §1.4）' })
    }
  } else {
    const lowSide = new Set(payload.completion_basis.map((entry) => entry.element))
    if (!lowSide.has('终态事件') && !lowSide.has('自报')) {
      issues.push({ path: 'payload.completion_basis', message: '低侧至少须含终态（框架收割）或自报，并按需抽样复核（§5.2）' })
    }
    if (payload.sampling_ref === undefined && payload.gaps.length === 0) {
      issues.push({ path: 'payload.sampling_ref', message: '低侧抽样复核须有引用；样本不得由被查方安排（§5.2）' })
    }
  }
  checks.push(issues.length === 0 ? { ok: true } : { ok: false, issues })
  return mergeOutcomes(...checks)
}

/**
 * REC-WORK-09 判定（§5.2/§十五-2）：
 *   ① 自检不构成独立验收（W-03），验者≠交付者；
 *   ② 证据须含 REC-EVD-03；EX-2+ 须含 REC-EVD-01 收割批次；
 *   ③ 终局拒绝（reworkable=false）须说明为何不可返工（L3D-09）；
 *   ④ 附条件接受须三件齐备；⑤ 证明边界必填；⑥ 独立性核验槽自填即拒收。
 */
export function validateWorkAcceptance(record: unknown, ctx: WorkAcceptanceContext = {}): RecordValidationOutcome {
  const parsed = WorkAcceptanceRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const envelope = parsed.data
  const payload = envelope.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(envelope)]
  const issues: { path: string; message: string }[] = []
  if (envelope.proofBoundary === undefined) {
    issues.push({ path: 'proofBoundary', message: '证明边界必填（§0.7-1）' })
  }
  if (ctx.selfCheckOnly === true) {
    issues.push({ path: 'payload.evidence_refs', message: '自检不构成独立验收（W-03——§5.2）' })
  }
  if (ctx.judgedByDeliverer === true) {
    issues.push({ path: 'payload.judged_by', message: '验者≠交付者（自检不构成独立验收——§5.2）' })
  }
  if (payload.independence_verified_by.self_declared === true) {
    issues.push({ path: 'payload.independence_verified_by', message: '独立性自填即拒收：须独立检查位置＋控制关系依据（L3E-02）' })
  }
  const evidenceTypes = new Set(payload.evidence_refs.map((ref) => ref.refType))
  if (!evidenceTypes.has('REC-EVD-03')) {
    issues.push({ path: 'payload.evidence_refs', message: '验收必引证据包 REC-EVD-03（§十五-2）' })
  }
  if (ctx.effectLevel !== undefined && HIGH_SIDE_EFFECT_LEVELS.includes(ctx.effectLevel) && !evidenceTypes.has('REC-EVD-01')) {
    issues.push({ path: 'payload.evidence_refs', message: 'EX-2+ 验收须含收割批次 REC-EVD-01（§十五-2）' })
  }
  if (payload.verdict === 'rejected' && !payload.reworkable && payload.non_reworkable_basis === undefined) {
    issues.push({ path: 'payload.non_reworkable_basis', message: '终局拒绝（reworkable=false）须说明为何不可返工（L3D-09/§5.2）' })
  }
  if (payload.verdict === 'conditional_accepted' && payload.conditions.length === 0) {
    issues.push({ path: 'payload.conditions', message: '附条件接受须写条件/责任者/到期处置/复核结果（§5.2）' })
  }
  checks.push(issues.length === 0 ? { ok: true } : { ok: false, issues })
  return mergeOutcomes(...checks)
}

/**
 * REC-WORK-ACCEPT-MAINT 判定（§5.2/K4）：
 *   ① 状态指标与过程指标两组分判、不可互替（动作数量不是成效——W-07）；
 *   ② 避免类三段证据缺一 → 结论只能「无法判断」；
 *   ③ 无法判断须写补证路径；④ 不得以收割四要件替代本记录（W-07）；
 *   ⑤ 证明边界必填。
 */
export function validateMaintenanceAcceptance(record: unknown, ctx: { fourElementsOnly?: boolean } = {}): RecordValidationOutcome {
  const parsed = MaintenanceAcceptanceRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const envelope = parsed.data
  const payload = envelope.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(envelope)]
  const issues: { path: string; message: string }[] = []
  if (envelope.proofBoundary === undefined) issues.push({ path: 'proofBoundary', message: '证明边界必填（§0.7-1）' })
  if (payload.state_indicators.length === 0 || payload.process_indicators.length === 0) {
    issues.push({ path: 'payload.state_indicators', message: '状态指标与过程指标两组分别判断、不可互替（§5.2/W-07）' })
  }
  if (payload.result_kind === 'avoidance' && payload.three_stage_refs === undefined) {
    issues.push({ path: 'payload.three_stage_refs', message: '避免类须三段证据（事前/期间/事后）；三段不全结论只能「无法判断」（§5.2）' })
  }
  if (payload.verdict === 'undeterminable' && payload.refill_path === undefined) {
    issues.push({ path: 'payload.refill_path', message: '无法判断须写补证路径（由谁在何时补——§5.2）' })
  }
  if (ctx.fourElementsOnly === true) {
    issues.push({ path: 'recordType', message: '不得以收割四要件替代维持性验收记录（W-07——§5.2）' })
  }
  checks.push(issues.length === 0 ? { ok: true } : { ok: false, issues })
  return mergeOutcomes(...checks)
}
