/**
 * WORK 任务族·入口与合同（REC-WORK-01..05）——MIG-03 / IMPL-03-02
 *
 * 依据链：
 *   - v2/11 §5.1（入口与合同 01..05 字段/不变量/失败出口）；§1.4 WORK 族 21 类登记；
 *     §〇.3-2 决定面封闭清单（WORK-02/04 必带 `decision_face`）；§〇.5 时间分层；§〇.7 证明边界
 *   - v2/09 ENU-03 工作十态、ENU-07 工作主类型、ENU-08 受理五取值、ENU-12 开工三值、
 *     ENU-13 迁移生产者三分、ENU-14 效果级、ENU-80 状态族——值集唯一主表在 v2/09，本文件只投影
 *   - v2/04 §二（受理五取值/未分类不得开工）、§三（合同五要件/探索四条款/四责任位置）、
 *     §四（开工五门与 gate→role）；v2/07 §一（计划锁）；v2/01 I-11（无无限期悬置）
 *   - plan/05 IMPL-03-02（WORK 超 600 行拆件：本件＝01..05，06..09＋ACCEPT-MAINT 在 work-state.ts，
 *     10/11/13/17/18 在 work-exec.ts，12/14/15/16/HANDOVER/COMMIT-CHANGE 在 work-close.ts）
 *
 * 登记缺口（不臆造，如实标出）：
 *   1. REC-WORK-01 `authenticity_state` 值集未在 v2/09 单列 → 按 ENU-69 来源核验四值投影（同义字段）；
 *      主表补条后回填。
 *   2. REC-WORK-04 五门「门标识」与 gate→role 机器字面未登记 → 取 v2/04 §四/§5.2 正文中文名。
 *   3. REC-WORK-04 `resource_baseline` 的「不可知」不另立值集：`sufficient: boolean | null`
 *      （null＝不可知；unknown≠充足、缺省≠0）。
 *   4. REC-WORK-03 探索四条款/原合同去向：正文未给形状 → 结构化可选槽，条件必填由判定件强制。
 *
 * 纪律：只写可擦除语法；相对 import 带 `.ts`；类型导入 `import type`；不定义族外枚举字面量。
 */
import { z } from 'zod'
import { SourceVerificationSchema } from './common.ts'
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

// —— §1 枚举投影（字面量唯一主表 v2/09；本文件只投影） ——

/** ENU-07 工作主类型（`unclassified` 不得据此开工——§5.2 REC-WORK-04 信息门） */
export const WORK_TYPES = ['create', 'maintain', 'explore', 'investigate', 'recycle', 'liquidate', 'unclassified'] as const
export const WorkTypeSchema = z.enum(WORK_TYPES)
export type WorkType = (typeof WORK_TYPES)[number]

/** ENU-08 受理五取值（受理≠承诺；终局拒绝不产生工作状态迁移——§5.1） */
export const INTAKE_OUTCOMES = ['accepted', 'conditional_accepted', 'hold', 'rejected', 'referred'] as const
export const IntakeOutcomeSchema = z.enum(INTAKE_OUTCOMES)
export type IntakeOutcome = (typeof INTAKE_OUTCOMES)[number]

/** ENU-12 开工三值（门级与整体共用同一组；不另造门级取值——§5.2） */
export const START_VERDICTS = ['ready', 'conditional_ready', 'not_ready'] as const
export const StartVerdictSchema = z.enum(START_VERDICTS)
export type StartVerdict = (typeof START_VERDICTS)[number]

/** ENU-13 迁移生产者三分（规则型必附规则依据引用） */
export const MIGRATION_PRODUCER_TYPES = ['initiator', 'decisive', 'rule'] as const
export const MigrationProducerTypeSchema = z.enum(MIGRATION_PRODUCER_TYPES)

/** ENU-14 效果级（EX-2+＝高侧缺省；禁裸写 E0/E1——治 K11 撞号） */
export const EFFECT_LEVELS = ['EX-0', 'EX-1', 'EX-2', 'EX-3', 'EX-4', 'EX-5', 'EX-6'] as const
export const EffectLevelSchema = z.enum(EFFECT_LEVELS)
export type EffectLevel = (typeof EFFECT_LEVELS)[number]

/** EX-2+ 高侧（存疑/未分级/争议/升级一律高侧——§5.2 REC-WORK-07） */
export const HIGH_SIDE_EFFECT_LEVELS: readonly EffectLevel[] = ['EX-2', 'EX-3', 'EX-4', 'EX-5', 'EX-6']

/** ENU-03 工作十态 */
export const WORK_STATES = [
  'intake', 'pending_start', 'in_progress', 'paused', 'awaiting_review', 'rework', 'accepted', 'rejected', 'terminated', 'settled',
] as const
export const WorkStateSchema = z.enum(WORK_STATES)
export type WorkState = (typeof WORK_STATES)[number]

/** ENU-80 状态族标识：工作族恒 `work`（不得与任职/身份族混用——§5.2） */
export const WORK_STATE_FAMILY = 'work'

/** ENU-09 验收四取值（`terminated_by_authority`＝依授权终止，不得读成拒绝） */
export const ACCEPTANCE_VERDICTS = ['accepted', 'conditional_accepted', 'rejected', 'terminated_by_authority'] as const
export const AcceptanceVerdictSchema = z.enum(ACCEPTANCE_VERDICTS)
export type AcceptanceVerdict = (typeof ACCEPTANCE_VERDICTS)[number]

/** ENU-16 验收对象分型六类（维持/探索类按分型口径，不套产物模板） */
export const ACCEPTANCE_KINDS = ['artifact', 'state', 'learning_delivery', 'fact_chain', 'no_residue', 'handover_confirmation'] as const
export const AcceptanceKindSchema = z.enum(ACCEPTANCE_KINDS)
export type AcceptanceKind = (typeof ACCEPTANCE_KINDS)[number]

/** §5.2 五门门标识（v2/09 未登记——缺口 2；取 v2/04 §四 正文门名） */
export const GATE_NAMES = ['权', '能力', '资源', '信息', '禁止'] as const
export const GateNameSchema = z.enum(GATE_NAMES)
export type GateName = (typeof GATE_NAMES)[number]

/** gate→role 封闭映射（§5.2 REC-WORK-04；承接者只以申请者/记录者身份出现） */
export const GATE_ROLE_REQUIRED: Readonly<Record<GateName, string>> = {
  权: '授权者', 能力: '认定位置', 资源: '资源责任者', 信息: '信息持有者', 禁止: '禁止清单所有者',
}

/** 责任位置禁用代名（§5.1 REC-WORK-03：四位置具名，不得「团队/部门/公司」） */
export const FORBIDDEN_RESPONSIBILITY_ALIASES = ['团队', '部门', '公司', '全体', '大家'] as const

/** 决定面异议缺省的合法表示（§5.2 REC-WORK-06 白名单：不得因「无异议」本身拒写） */
export const NO_DISSENT_LITERAL = '无异议'

// —— §2 REC-WORK-01 意图信封（入口只产生意图不产生承诺） ——

/** REC-WORK-01 payload（§5.1 字段表序） */
export const WorkIntakePayloadSchema = z.strictObject({
  /** 原始内容（不改写——§5.1） */
  raw_content: z.string().min(1),
  source: z.string().min(1),
  identity_mapping: z.string().min(1),
  /** 来源真实性（ENU-69 投影——缺口 1；未核验不得使用） */
  authenticity_state: SourceVerificationSchema,
  received_at: TimestampSchema,
  /** 受理责任位置（具名；不得「框架/系统」——§0.2-1） */
  intake_owner: z.string().min(1),
  /** 受理时限（超时本身是异常 → REC-WORK-17） */
  intake_deadline: TimestampSchema,
  known_constraints: z.array(z.string().min(1)),
  /** 请求方希望的工作状态（ENU-03 投影） */
  requested_state: WorkStateSchema,
})

export type WorkIntakePayload = z.infer<typeof WorkIntakePayloadSchema>
export const WorkIntakeRecordSchema = recordEnvelopeSchema(WorkIntakePayloadSchema, 'REC-WORK-01')

// —— §3 REC-WORK-02 受理结论（决定面封闭清单成员） ——

/** 附条件三件（条件/责任者/到期处置；缺一只能停在待开工——§5.1） */
export const ThreePartConditionSchema = z.strictObject({
  condition: z.string().min(1),
  owner: z.string().min(1),
  due_disposition: z.string().min(1),
})

export const IntakeDecisionPayloadSchema = z.strictObject({
  intent_ref: RecordRefSchema,
  /** 具名任职者（受理位置；不因受理取得承诺权） */
  decided_by: z.string().min(1),
  authority_ref: RecordRefSchema,
  work_type: WorkTypeSchema,
  /** 主类型判定依据（未分类不得据此开工——§5.2 信息门） */
  type_basis: z.string().min(1),
  outcome: IntakeOutcomeSchema,
  scope_judged: z.strictObject({
    judged: z.array(z.string().min(1)).min(1),
    not_judged: z.array(z.string().min(1)),
  }),
  /** 理由（拒绝须含异议位置与新证据标准——§5.1；新证据标准另置槽位） */
  reason: z.string().min(1),
  new_evidence_standard: z.string().min(1).optional(),
  conditions: z.array(ThreePartConditionSchema),
  /** 暂缓必填：期限或复审条件＋保全义务（§5.1） */
  hold_terms: z
    .strictObject({
      deadline: TimestampSchema.optional(),
      review_condition: z.string().min(1).optional(),
      preservation_duty: z.string().min(1),
    })
    .optional(),
  /** 转呈必填：受转位置（具名） */
  referred_to: ObjectRefSchema.optional(),
  next_deadline: TimestampSchema.optional(),
  dissent_position: z.string().min(1),
  decision_face: DecisionFaceSchema,
})

export type IntakeDecisionPayload = z.infer<typeof IntakeDecisionPayloadSchema>
export const IntakeDecisionRecordSchema = recordEnvelopeSchema(IntakeDecisionPayloadSchema, 'REC-WORK-02')

/** REC-WORK-02 判定输入（合同是否已成立／本记录是否被主张为状态迁移载体——M-02 口径） */
export interface IntakeDecisionContext {
  contractEstablished?: boolean
  claimsWorkTransition?: boolean
}

// —— §4 REC-WORK-03 任务合同修订（五要件＋附加三件全部必填成立） ——

/** 验收口径（判什么/怎么判/谁判/何时判＋效果级——v2/04 §三） */
export const AcceptanceCriteriaSchema = z.strictObject({
  judged: z.string().min(1),
  how: z.string().min(1),
  who: z.string().min(1),
  when: TimestampSchema,
  effect_level_ref: RecordRefSchema,
})

/** 四责任位置（工作责任者/验收者/承诺者/记录者——§5.1/§5.2；不得代名） */
export const ResponsibilityPositionsSchema = z.strictObject({
  work_owner: z.string().min(1),
  acceptor: z.string().min(1),
  committer: z.string().min(1),
  recorder: z.string().min(1),
})

/** 探索合同四条款（缺一不成立——v2/04 §三；登记缺口 4） */
export const ExploreTermsSchema = z.strictObject({
  boundary: z.string().min(1),
  learning_delivery: z.string().min(1),
  stop_condition: z.string().min(1),
  evaluation: z.string().min(1),
})

export const WorkContractPayloadSchema = z.strictObject({
  contract_id: z.string().min(1),
  revision: z.string().min(1),
  /** 五要件 ①②（来源/具体承诺；内部任务不得冒称对外承诺——§5.1） */
  source_clause: z.string().min(1),
  commitment_ref: RecordRefSchema,
  acceptance_criteria: AcceptanceCriteriaSchema,
  deadlines: z.strictObject({
    delivery_by: TimestampSchema,
    review_points: z.array(TimestampSchema),
    expiry_semantics: z.string().min(1),
  }),
  responsibility_positions: ResponsibilityPositionsSchema,
  /** 风险分类（→REC-WORK-07；无独立判定按高档——§5.1） */
  risk_classification_ref: RecordRefSchema,
  resources_and_info: z.array(z.string().min(1)),
  collaboration_and_handover: z.string().min(1),
  /** 被新任务顶替须显式记原合同去向（不得静默消失——§5.1） */
  supersedes: RecordRefSchema.optional(),
  superseded_disposition: z.string().min(1).optional(),
  /** 探索类四条款（条件必填——登记缺口 4） */
  explore_terms: ExploreTermsSchema.optional(),
})

export type WorkContractPayload = z.infer<typeof WorkContractPayloadSchema>
export const WorkContractRecordSchema = recordEnvelopeSchema(WorkContractPayloadSchema, 'REC-WORK-03')

// —— §5 REC-WORK-04 开工判断（决定面封闭清单成员；计划锁在五门之前） ——

/** 门级结论（五门各一：门标识/判据引用/结论/依据材料——不得缺门重复） */
export const GateResultSchema = z.strictObject({
  gate: GateNameSchema,
  criteria_ref: ObjectRefSchema,
  verdict: StartVerdictSchema,
  materials: z.array(ObjectRefSchema).min(1),
})

/** 每门判者（gate→role 封闭映射；自判须宪制指定依据引用——§5.2/L3D-08） */
export const JudgeRoleSchema = z.strictObject({
  gate: GateNameSchema,
  role: z.string().min(1),
  constitutional_basis_ref: RecordRefSchema.optional(),
})

/** 资源基线只读派生快照（`sufficient=null`＝不可知；unknown≠充足、缺省≠0——§5.2） */
export const ResourceBaselineSchema = z.strictObject({
  subject: z.string().min(1),
  quota_ref: ObjectRefSchema,
  entries: z.array(
    z.strictObject({
      resource_ref: ObjectRefSchema,
      sufficient: z.boolean().nullable(),
      basis: z.string().min(1),
    }),
  ),
  as_of: TimestampSchema,
  gaps: z.array(z.string().min(1)),
})

export const StartDecisionPayloadSchema = z.strictObject({
  contract_ref: RecordRefSchema,
  decided_by: z.string().min(1),
  authority_ref: RecordRefSchema,
  gate_results: z.array(GateResultSchema).min(1),
  judge_role: z.array(JudgeRoleSchema).min(1),
  /** 三值聚合（任一门不可开工→不可开工；否则任一附条件→附条件；全可开工→可开工——§5.2 写死） */
  verdict: StartVerdictSchema,
  conditions: z.array(ThreePartConditionSchema),
  repudiation_triggers: z.array(z.string().min(1)).min(1),
  resource_baseline: ResourceBaselineSchema,
  /** 资源消耗与责任起算点（§5.2） */
  decided_at: TimestampSchema,
  dissent_position: z.string().min(1),
  decision_face: DecisionFaceSchema,
})

export type StartDecisionPayload = z.infer<typeof StartDecisionPayloadSchema>
export const StartDecisionRecordSchema = recordEnvelopeSchema(StartDecisionPayloadSchema, 'REC-WORK-04')

/** REC-WORK-04 判定输入（主类型来自 REC-WORK-02；计划锁读序来自前置记录面） */
export interface StartDecisionContext {
  /** 工作主类型（信息门须核对主类型非 `unclassified`——§5.2/L3D-11） */
  workType?: WorkType
  /** 计划锁是否在五门之前成立（读序不得倒置——§5.2） */
  planLockBeforeGates?: boolean
}

// —— §6 REC-WORK-05 执行计划锁（只回答「用哪一套、占多少」，不产生门结论） ——

export const PlanLockPayloadSchema = z.strictObject({
  definition_revision: z.string().min(1),
  contract_ref: RecordRefSchema,
  /** →REC-CAP-02＋版本（资格认定） */
  qualification_refs: z.array(RecordRefSchema),
  /** →REC-CAP-01＋版本＋摘要 */
  capability_descriptors: z.array(z.strictObject({ capability_ref: RecordRefSchema, digest: z.string().min(1) })),
  execution_config: z.string().min(1),
  /** →v2/12 绑定档案卡（BIND-；非 REC 对象） */
  binding_profile_ref: ObjectRefSchema,
  rule_profile_version: z.string().min(1),
  known_incapabilities: z.array(z.string().min(1)),
  substitution_plan: z.string().min(1),
  /** 资源预留（每项 {resource_ref, amount, unit, period, quota_ref}——定义引用非记录） */
  resource_reservations: z.array(
    z.strictObject({
      resource_ref: ObjectRefSchema,
      amount: z.number().nonnegative(),
      unit: z.string().min(1),
      period: z.strictObject({ from: TimestampSchema, to: TimestampSchema }),
      quota_ref: ObjectRefSchema,
    }),
  ),
  /** 空列表须写理由与依据（§5.2） */
  empty_reservation_reason: z.string().min(1).optional(),
})

export type PlanLockPayload = z.infer<typeof PlanLockPayloadSchema>
export const PlanLockRecordSchema = recordEnvelopeSchema(PlanLockPayloadSchema, 'REC-WORK-05')

// —— §7 本半形状闸（WORK 01..05；21 类并集闸在 work.ts） ——

export const WORK_INTENT_RECORD_SCHEMAS = {
  'REC-WORK-01': WorkIntakeRecordSchema,
  'REC-WORK-02': IntakeDecisionRecordSchema,
  'REC-WORK-03': WorkContractRecordSchema,
  'REC-WORK-04': StartDecisionRecordSchema,
  'REC-WORK-05': PlanLockRecordSchema,
} as const

// —— §12 判定件（纯函数；不抛错，返回 RecordValidationOutcome） ——

/** REC-WORK-01 判定：入口责任位置须具名；来源未核验不得使用（§5.1） */
export function validateWorkIntake(record: unknown, ctx: { usedAsBasis?: boolean } = {}): RecordValidationOutcome {
  const parsed = WorkIntakeRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (payload.intake_owner.trim().toLowerCase() === 'framework' || payload.intake_owner.trim() === '系统') {
    checks.push(recordReject('payload.intake_owner', '入口须有具名责任位置（框架/系统不可作受理者——§0.2-1）'))
  }
  if (payload.authenticity_state !== 'verified' && ctx.usedAsBasis === true) {
    checks.push(recordReject('payload.authenticity_state', '来源未核验不得使用（入口只产生意图；未核验不得进入执行步——§5.1）'))
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-WORK-02 判定（§5.1 不变量）：
 *   ① 暂缓必填期限或复审条件＋保全义务（无期限且无复审条件＝悬置，I-11）；
 *   ② 转呈必填受转位置；拒绝须含异议位置与新证据标准；
 *   ③ 附条件接受三件（条件/责任者/到期处置）缺一只能停在待开工；
 *   ④ 合同未成立时的受理拒绝不产生工作状态迁移（M-02 只覆盖合同已成立后的撤销——治 L3D-06）。
 */
export function validateIntakeDecision(record: unknown, ctx: IntakeDecisionContext = {}): RecordValidationOutcome {
  const parsed = IntakeDecisionRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  const rules: [boolean, string, string][] = [
    [
      payload.outcome === 'hold' &&
        (payload.hold_terms === undefined || (payload.hold_terms.deadline === undefined && payload.hold_terms.review_condition === undefined)),
      'payload.hold_terms',
      '暂缓必填期限或复审条件＋保全义务（无期限且无复审条件＝无限期悬置——§5.1/I-11）',
    ],
    [payload.outcome === 'referred' && payload.referred_to === undefined, 'payload.referred_to', '转呈必填受转位置（具名——§5.1）'],
    [
      payload.outcome === 'rejected' && payload.new_evidence_standard === undefined,
      'payload.new_evidence_standard',
      '拒绝须含异议位置与新证据标准（决定面 dissent_position＋本槽位——§5.1）',
    ],
    [
      payload.outcome === 'conditional_accepted' && payload.conditions.length === 0,
      'payload.conditions',
      '附条件接受三件（条件/责任者/到期处置）缺一只能停在待开工（§5.1）',
    ],
    [
      payload.outcome === 'rejected' && ctx.claimsWorkTransition === true && ctx.contractEstablished !== true,
      'payload.outcome',
      '合同未成立的受理拒绝不产生工作状态迁移——本记录即终局载体（M-02 只覆盖合同已成立后的撤销，L3D-06）',
    ],
  ]
  for (const [violated, path, message] of rules) if (violated) checks.push(recordReject(path, message))
  return mergeOutcomes(...checks)
}

/**
 * REC-WORK-03 判定（§5.1/§四）：
 *   ① 四责任位置不得以「团队/部门/公司」代名；
 *   ② 探索类必带四条款（缺一不成立）；③ 被顶替的原合同须显式记去向（不得静默消失）；
 *   ④ 风险分类引用须指向 REC-WORK-07（无独立判定按高档）。
 */
export function validateWorkContract(record: unknown, ctx: { workType?: WorkType } = {}): RecordValidationOutcome {
  const parsed = WorkContractRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  const positions = payload.responsibility_positions
  for (const [key, value] of Object.entries(positions)) {
    const trimmed = value.trim()
    if ((FORBIDDEN_RESPONSIBILITY_ALIASES as readonly string[]).includes(trimmed)) {
      checks.push(recordReject(`payload.responsibility_positions.${key}`, '四责任位置须具名，不得以「团队/部门/公司」代名（§5.1）'))
    }
  }
  if (ctx.workType === 'explore' && payload.explore_terms === undefined) {
    checks.push(recordReject('payload.explore_terms', '探索合同四条款（边界/学习交付/停止条件/评价方式）缺一不成立（v2/04 §三）'))
  }
  if (payload.supersedes !== undefined && payload.superseded_disposition === undefined) {
    checks.push(recordReject('payload.superseded_disposition', '被新任务顶替须显式记原合同去向（完成/终止/被替代），不得静默消失（§5.1）'))
  }
  if (payload.risk_classification_ref.refType !== 'REC-WORK-07') {
    checks.push(recordReject('payload.risk_classification_ref.refType', '风险分类须引 REC-WORK-07（无独立判定按高档——§5.1）'))
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-WORK-04 判定（§5.1/§5.2 不变量）：
 *   ① 五门各一不得缺门重复；② gate→role 封闭映射（自判须宪制指定依据引用）；
 *   ③ 三值聚合规则写死；④ 附条件必填三件；
 *   ⑤ 资源门判可开工须逐项 sufficient=true（unknown≠充足）；⑥ 信息门核对主类型非「未分类」；
 *   ⑦ 计划锁在五门之前（读序不得倒置）；⑧ 异议位置。
 */
export function validateStartDecision(record: unknown, ctx: StartDecisionContext = {}): RecordValidationOutcome {
  const parsed = StartDecisionRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]

  const gates = payload.gate_results.map((entry) => entry.gate)
  const duplicated = gates.filter((gate, index) => gates.indexOf(gate) !== index)
  if (gates.length !== GATE_NAMES.length || duplicated.length > 0) {
    checks.push(recordReject('payload.gate_results', `五门各一不得缺门重复（实得 ${gates.join('/') || '空'}——§5.2）`))
  }
  for (const gate of GATE_NAMES) {
    const roles = payload.judge_role.filter((entry) => entry.gate === gate)
    if (roles.length !== 1) {
      checks.push(recordReject('payload.judge_role', `门 ${gate} 须恰有一个判者（gate→role 封闭映射——§5.2）`))
      continue
    }
    const role = roles[0]
    if (role !== undefined && role.role !== GATE_ROLE_REQUIRED[gate] && role.constitutional_basis_ref === undefined) {
      checks.push(recordReject('payload.judge_role', `门 ${gate} 判者须为「${GATE_ROLE_REQUIRED[gate]}」；自判须宪制指定依据引用（§5.2/L3D-08）`))
    }
  }

  const gateVerdicts = new Map(payload.gate_results.map((entry) => [entry.gate, entry.verdict]))
  const anyNotReady = [...gateVerdicts.values()].includes('not_ready')
  const anyConditional = [...gateVerdicts.values()].includes('conditional_ready')
  const expected: StartVerdict = anyNotReady ? 'not_ready' : anyConditional ? 'conditional_ready' : 'ready'
  if (gateVerdicts.size === GATE_NAMES.length && payload.verdict !== expected) {
    checks.push(recordReject('payload.verdict', `三值聚合规则写死：门级实得应聚合为 ${expected}（实际 ${payload.verdict}——§5.2）`))
  }
  if (payload.verdict === 'conditional_ready' && payload.conditions.length === 0) {
    checks.push(recordReject('payload.conditions', '附条件开工必填条件/责任者/到期处置（缺一即无法判定——§5.2）'))
  }
  if (gateVerdicts.get('资源') === 'ready' && payload.resource_baseline.entries.some((entry) => entry.sufficient !== true)) {
    checks.push(recordReject('payload.resource_baseline', '额度或占用不可知即不判充足（unknown≠充足、缺省≠0——§5.2）'))
  }
  if (gateVerdicts.get('信息') === 'ready' && ctx.workType === 'unclassified') {
    checks.push(recordReject('payload.gate_results', '信息门须核对主类型非「未分类」——未分类不得据此开工（§5.2/L3D-11）'))
  }
  if (ctx.planLockBeforeGates === false) {
    checks.push(recordReject('payload.gate_results', '计划锁在五门之前（读序不得倒置——§5.2）'))
  }
  if (payload.repudiation_triggers.length === 0) {
    checks.push(recordReject('payload.repudiation_triggers', '开工判断不是一次性仪式：须登记重判触发（§5.2）'))
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-WORK-05 判定（§5.2）：只回答「本次用哪一套、占多少」——不产生门结论；
 * 引用一律 ID＋版本（资格→REC-CAP-02、能力描述→REC-CAP-01）；空预留须写理由与依据。
 */
export function validatePlanLock(record: unknown): RecordValidationOutcome {
  const parsed = PlanLockRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  for (const ref of payload.qualification_refs) {
    if (ref.refType !== 'REC-CAP-02') {
      checks.push(recordReject('payload.qualification_refs', '资格引用须指向 REC-CAP-02（资格认定＋版本——§5.2）'))
    }
  }
  for (const descriptor of payload.capability_descriptors) {
    if (descriptor.capability_ref.refType !== 'REC-CAP-01') {
      checks.push(recordReject('payload.capability_descriptors', '能力描述须指向 REC-CAP-01＋版本＋摘要（§5.2）'))
    }
  }
  if (payload.resource_reservations.length === 0 && payload.empty_reservation_reason === undefined) {
    checks.push(recordReject('payload.empty_reservation_reason', '资源预留空列表须写理由与依据（不得静默为零——§5.2）'))
  }
  return mergeOutcomes(...checks)
}
