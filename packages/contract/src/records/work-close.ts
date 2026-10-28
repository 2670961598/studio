/**
 * WORK 任务族·结清/义务/承诺/交接（REC-WORK-12、14、15、16、HANDOVER、COMMIT-CHANGE）——MIG-03 / IMPL-03-02
 *
 * 依据链：
 *   - v2/11 §5.2（12 结清＋HANDOVER）、§5.3（14..16＋COMMIT-CHANGE）；§1.4 WORK 族 21 类登记；
 *     §〇.3-2 决定面封闭清单（WORK-12 必带）；§〇.7 证明边界；§十四 §14.1 M-26..M-28；
 *     §十五-2（结清重核验/派生面/履约派生值/相对方验收）
 *   - v2/09 ENU-10 结清四态、ENU-11 结清九项、ENU-20 承诺类别、ENU-21 承诺变更去向、
 *     ENU-22 履约状态（派生值）、ENU-107 义务形态、ENU-124 交接包十项、ENU-126 结清项状态、
 *     ENU-127 义务处置
 *   - v2/04 §六/§九/§十；v2/08 §1.4（W-07/W-12）；v2/01 I-11/I-15
 *   - plan/05 IMPL-03-02（拆件：本件＝12/14/15/16＋三条具名类；10/11/13/17/18 在 work-exec.ts）
 *
 * 登记缺口（不臆造）：
 *   1. REC-WORK-12 逐项转入清算无独立项状态值（ENU-126 只有三值）→ 项级 `into_liquidation: boolean`，
 *      四态推导规则写死在判定件（L3E-13）。
 *   2. REC-WORK-COMMIT-CHANGE 申请段六要素值集未登记 → 结构化槽承载（v2/04 §九 正文名）。
 *   3. REC-WORK-14 `closed_or_assumed` 不另立三值枚举 → 两个布尔＋接收确认引用（避免新立值集）。
 *
 * 纪律：只写可擦除语法；相对 import 带 `.ts`；类型导入 `import type`；不定义族外枚举字面量。
 */
import { z } from 'zod'
import { SettlementItemStateSchema } from './life.ts'
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
import { ThreePartConditionSchema, type WorkState } from './work-intent.ts'
import { IndependenceVerificationSchema } from './work-state.ts'

/** ENU-126 结清项状态（life.ts 投影的本地别名；不另立值集） */
type SettlementItemState = z.infer<typeof SettlementItemStateSchema>

// —— §1 枚举投影（v2/09 主表；本文件只投影） ——

/** ENU-10 结清四态（推导规则写死：未结清＞转入清算＞保留事项＞完全结清——§5.2/L3E-13） */
export const WORK_SETTLED_STATES = ['fully_settled', 'settled_with_reservations', 'unsettled', 'into_liquidation'] as const
export const WorkSettledStateSchema = z.enum(WORK_SETTLED_STATES)
export type WorkSettledState = (typeof WORK_SETTLED_STATES)[number]

/** ENU-11 结清清单九项（本栏不复列机器值语义——§5.2） */
export const WORK_SETTLEMENT_ITEMS = [
  'artifact', 'resource', 'evidence', 'open_items', 'commitment', 'counterparty', 'responsibility', 'memory', 'derived_face',
] as const
export const WorkSettlementItemSchema = z.enum(WORK_SETTLEMENT_ITEMS)
export type WorkSettlementItem = (typeof WORK_SETTLEMENT_ITEMS)[number]

/** ENU-20 承诺类别（内部任务不得冒称对外承诺——§5.3） */
export const COMMITMENT_KINDS = ['specific', 'public'] as const
export const CommitmentKindSchema = z.enum(COMMITMENT_KINDS)

/** ENU-21 承诺变更去向（相对方不同意时仅三种合法去向——§5.3） */
export const COMMIT_CHANGE_OUTCOMES = ['keep_original', 'negotiate_substitute', 'terminate_by_law'] as const
export const CommitChangeOutcomeSchema = z.enum(COMMIT_CHANGE_OUTCOMES)

/** ENU-22 履约状态（派生值，禁独立写入——§5.3/§十五-2） */
export const FULFILLMENT_STATES = ['on_track', 'at_risk', 'fulfilled', 'undeterminable'] as const
export const FulfillmentStateSchema = z.enum(FULFILLMENT_STATES)

/** ENU-107 义务形态五型（定义包侧定义，本卷只引用——§5.3） */
export const OBLIGATION_FORMS = ['action', 'maintain_state', 'avoid_outcome', 'report', 'stop'] as const
export const ObligationFormSchema = z.enum(OBLIGATION_FORMS)

/** ENU-127 义务实例处置（问责→REC-ACC-01；救济→REC-ACC-02——§5.3） */
export const OBLIGATION_DISPOSITIONS = ['none', 'escalate', 'accountability', 'remedy', 'terminate', 'reassigned'] as const
export const ObligationDispositionSchema = z.enum(OBLIGATION_DISPOSITIONS)

/** ENU-124 交接包十项（逐项记已含/缺失＋去向——§5.2） */
export const HANDOVER_ITEMS = [
  'contract_version', 'in_flight_status', 'progress_account', 'evidence_open_issues', 'resource_balance',
  'external_contacts_commitments', 'risks_assumptions', 'open_questions', 'authorization_scope_expiry',
  'derived_executors_credentials',
] as const
export const HandoverItemSchema = z.enum(HANDOVER_ITEMS)
export type HandoverItem = (typeof HANDOVER_ITEMS)[number]

/** 承诺变更在途四段（申请→受理→相对方表达→决定；逐段留痕——§5.3） */
export const COMMIT_CHANGE_STAGES = ['application', 'acceptance', 'counterparty_statement', 'decision'] as const
export const CommitChangeStageSchema = z.enum(COMMIT_CHANGE_STAGES)

/** 派生面逐项（第⑩项展开：类型/标识/凭据逻辑引用/终止或围栏证据——与 REC-AUTH-03 同构子集） */
export const DerivedFaceEntrySchema = z.strictObject({
  descendant_type: z.string().min(1),
  identity_ref: z.string().min(1),
  credential_logical_reference: z.string().min(1),
  deactivation_or_fence_evidence: z.string().min(1),
})

// —— §4 REC-WORK-12 工作结清记录（决定面封闭清单成员；独立核验） ——

/** 结清单项（单列表：items[] 逐项 {item, state, into_liquidation?, reservation_ref?}——§5.2/L3E-13） */
export const WorkSettlementItemEntrySchema = z.strictObject({
  item: WorkSettlementItemSchema,
  state: SettlementItemStateSchema,
  into_liquidation: z.boolean().optional(),
  /** 保留事项引用（state=reservation 时必填） */
  reservation_ref: z.string().min(1).optional(),
})

export const WorkSettlementPayloadSchema = z.strictObject({
  work_ref: RecordRefSchema,
  /** 逐项（缺项即拒收；单列表不得两平行） */
  items: z.array(WorkSettlementItemEntrySchema).min(1),
  /** 结清四态（推导规则写死——判定件核对） */
  settled_state: WorkSettledStateSchema,
  /** 保留事项：内容/责任者/到期（可空列表） */
  reservations: z.array(z.strictObject({ content: z.string().min(1), owner: z.string().min(1), due: TimestampSchema })),
  /** 承接字段（转入清算/工作已终止必填——治 L3E-01/DSF P0-8(b)） */
  handover_ref: RecordRefSchema.optional(),
  handover_acceptance: z.strictObject({ accepted: z.boolean(), accepted_by: z.string().min(1), at: TimestampSchema }).optional(),
  /** 派生面证据（撤回/回收/清算类或曾触及 EX-2+ 敏感面——W-12） */
  derived_face_evidence: z.array(RecordRefSchema),
  /** 价值评估引用（完全结清且未作评估须写理由/责任者/复审点——治 L3E-03） */
  value_ref: RecordRefSchema.optional(),
  value_evaluation_gap: z.strictObject({ reason: z.string().min(1), owner: z.string().min(1), review_point: TimestampSchema }).optional(),
  /** 出工记忆三路分流凭证（→REC-MEM-03；未完成不得结清——§5.2） */
  memory_disposition_refs: z.array(RecordRefSchema),
  verified_by: z.string().min(1),
  independence: IndependenceVerificationSchema,
  /** 只判「是否关闭」，不重作验收判断、不判价值 */
  verified_scope: z.string().min(1),
  dissent_position: z.string().min(1),
  decision_face: DecisionFaceSchema,
})

export type WorkSettlementPayload = z.infer<typeof WorkSettlementPayloadSchema>
export const WorkSettlementRecordSchema = recordEnvelopeSchema(WorkSettlementPayloadSchema, 'REC-WORK-12')

/** REC-WORK-12 判定输入（工作是否终止／是否触及敏感面或 EX-2+／是否作过价值评估） */
export interface WorkSettlementContext {
  workTerminated?: boolean
  touchedSensitive?: boolean
  ex2Plus?: boolean
  valueEvaluated?: boolean
  verifierIsOwner?: boolean
}

// —— §5 REC-WORK-HANDOVER 交接包（十项逐项已含/缺失＋去向；连续性四问） ——

export const HandoverPackagePayloadSchema = z.strictObject({
  /** 交接语境（换人/换能力/换班次）＋工作与合同版本引用 */
  context: z.strictObject({
    kind: z.string().min(1),
    work_ref: RecordRefSchema,
    contract_ref: RecordRefSchema,
  }),
  /** 交接包十项逐项（缺项不得留空，必须写「缺失＋去向」） */
  items: z.array(
    z.strictObject({
      item: HandoverItemSchema,
      present: z.boolean(),
      /** 缺失时必填：去向 */
      missing_route: z.string().min(1).optional(),
    }),
  ),
  /** 连续性检验四问答案引用（为什么做/做到哪/还欠什么/下一步按什么判据） */
  continuity_answers: z.strictObject({
    why: RecordRefSchema,
    progress: RecordRefSchema,
    owed: RecordRefSchema,
    next_criteria: RecordRefSchema,
  }),
  /** 换能力（实质变更）时→REC-CAP-02 重认结论 */
  requalification_ref: RecordRefSchema.optional(),
  /** 第⑩项展开：派生执行体与凭据清单 */
  derived_face: z.array(DerivedFaceEntrySchema),
  submission: z.strictObject({ submitted_by: z.string().min(1), at: TimestampSchema }),
  verification: z.strictObject({ verified_by: z.string().min(1), conclusion: z.string().min(1) }),
  acceptance: z.strictObject({
    accepted: z.boolean(),
    conditions: z.array(ThreePartConditionSchema),
  }),
  dissent_position: z.string().min(1),
})

export type HandoverPackagePayload = z.infer<typeof HandoverPackagePayloadSchema>
export const HandoverPackageRecordSchema = recordEnvelopeSchema(HandoverPackagePayloadSchema, 'REC-WORK-HANDOVER')

/** REC-WORK-HANDOVER 判定输入（换能力＝实质变更） */
export interface HandoverPackageContext {
  capabilityChanged?: boolean
}

// —— §6 REC-WORK-COMMIT-CHANGE 承诺变更在途（四段留痕＋僵局计时） ——

/** 申请段六要素（v2/04 §九；值集未登记——缺口 2） */
export const CommitmentChangeElementsSchema = z.strictObject({
  original_commitment_ref: RecordRefSchema,
  proposed_change: z.string().min(1),
  reason_and_evidence: z.array(z.string().min(1)).min(1),
  alternative_or_compensation: z.string().min(1),
  counterparty_opinion: z.string().min(1),
  disposition_if_declined: z.string().min(1),
})

export const CommitmentChangePayloadSchema = z.strictObject({
  commitment_ref: RecordRefSchema,
  /** 在途四段逐段留痕（每段带时点、作出者、材料引用） */
  stages: z.array(
    z.strictObject({
      stage: CommitChangeStageSchema,
      at: TimestampSchema,
      actor: z.string().min(1),
      materials: z.array(RecordRefSchema).min(1),
    }),
  ),
  elements: CommitmentChangeElementsSchema,
  /** 僵局时限自申请受理时起算（否则强制出口无计时依据——§5.3） */
  deadlock_clock: TimestampSchema,
  /** 在途期间履约状态不得标「已变更」，按原口径结算（恒为真） */
  original_terms_stand: z.literal(true),
  /** 相对方不同意时合法去向仅三种（取值主表 ENU-21） */
  outcome: CommitChangeOutcomeSchema.optional(),
})

export type CommitmentChangePayload = z.infer<typeof CommitmentChangePayloadSchema>
export const CommitmentChangeRecordSchema = recordEnvelopeSchema(CommitmentChangePayloadSchema, 'REC-WORK-COMMIT-CHANGE')

/** REC-WORK-COMMIT-CHANGE 判定输入（相对方是否明确不同意） */
export interface CommitmentChangeContext {
  counterpartyDeclined?: boolean
}

// —— §8 REC-WORK-14 义务实例（定义的一次实际触发、到期与承接） ——

export const ObligationInstancePayloadSchema = z.strictObject({
  definition_ref: RecordRefSchema,
  /** ENU-107 义务形态（定义包侧定义，本卷只引用） */
  form: ObligationFormSchema,
  holder: ObjectRefSchema,
  /** 权源与接受分开记（§5.3） */
  authority_source: RecordRefSchema,
  acceptance_state: z.string().min(1),
  counterparty: ObjectRefSchema.nullable(),
  trigger_state: z.string().min(1),
  /** 附复审点 */
  due_state: z.strictObject({ due: TimestampSchema, review_point: TimestampSchema.nullable() }),
  /** 口径版本/证据/判断者/结论 */
  completion: z.strictObject({
    criteria_version: z.string().min(1),
    evidence_refs: z.array(RecordRefSchema),
    judged_by: z.string().min(1).nullable(),
    conclusion: z.string().min(1).nullable(),
  }),
  disposition: ObligationDispositionSchema,
  parent_and_delegation: z.strictObject({ parent_ref: RecordRefSchema.nullable(), delegation_ref: RecordRefSchema.nullable() }),
  /** 已结清/未结/已承接（已承接须含接收确认——移交须接收方接受） */
  closed_or_assumed: z.strictObject({
    closed: z.boolean(),
    assumed: z.boolean(),
    receiver_confirmation_ref: RecordRefSchema.optional(),
  }),
})

export type ObligationInstancePayload = z.infer<typeof ObligationInstancePayloadSchema>
export const ObligationInstanceRecordSchema = recordEnvelopeSchema(ObligationInstancePayloadSchema, 'REC-WORK-14')

// —— §9 REC-WORK-15 具体承诺（承诺授权位置；内部任务不得冒称） ——

export const CommitmentPayloadSchema = z.strictObject({
  commitment_kind: CommitmentKindSchema,
  committed_by: ObjectRefSchema,
  /** 相对方（公开承诺填相对方类别与代表/异议通道） */
  counterparty: z.strictObject({
    class_or_ref: z.string().min(1),
    representative: z.string().min(1).optional(),
    objection_channel: z.string().min(1),
  }),
  /** 承诺什么、条件、判什么算兑现 */
  content: z.strictObject({ what: z.string().min(1), conditions: z.array(z.string().min(1)), fulfillment_criteria: z.string().min(1) }),
  /** 到期语义 */
  term: z.strictObject({ due: TimestampSchema, expiry_semantics: z.string().min(1) }),
  consequence: z.string().min(1),
  /** 历次变更（每条目引用 REC-WORK-COMMIT-CHANGE） */
  revision_chain: z.array(RecordRefSchema),
  consent_state: z.string().min(1),
})

export type CommitmentPayload = z.infer<typeof CommitmentPayloadSchema>
export const CommitmentRecordSchema = recordEnvelopeSchema(CommitmentPayloadSchema, 'REC-WORK-15')

/** REC-WORK-15 判定输入（内部任务冒称对外承诺／承接者自行加码或单方降标） */
export interface CommitmentContext {
  internalOnly?: boolean
  modifiedByExecutor?: boolean
}

// —— §10 REC-WORK-16 履约对应（派生值，无独立写入路径） ——

export const FulfillmentMappingPayloadSchema = z.strictObject({
  commitment_ref: RecordRefSchema,
  /** 多对多写合并方式或优先级 */
  work_refs: z.array(RecordRefSchema).min(1),
  merge_rule: z.string().min(1),
  /** 履约状态（派生值——只能由工作状态＋验收结论推出，禁止独立写入） */
  derived_status: FulfillmentStateSchema,
  derivation_refs: z.array(RecordRefSchema).min(1),
  early_warning: z.string().min(1).optional(),
  /** 已兑现时必填：相对方验收方式与结果引用（无则最多到有风险/无法判断——治 L3E-06） */
  counterparty_acceptance: z.strictObject({ method: z.string().min(1), result_ref: RecordRefSchema }).optional(),
})

export type FulfillmentMappingPayload = z.infer<typeof FulfillmentMappingPayloadSchema>
export const FulfillmentMappingRecordSchema = recordEnvelopeSchema(FulfillmentMappingPayloadSchema, 'REC-WORK-16')

/** REC-WORK-16 判定输入（是否独立写入／工作当前状态） */
export interface FulfillmentMappingContext {
  writtenIndependently?: boolean
  workStates?: readonly WorkState[]
}

// —— §8 本半形状闸（WORK 12/14/15/16/HANDOVER/COMMIT-CHANGE） ——

export const WORK_CLOSE_RECORD_SCHEMAS = {
  'REC-WORK-12': WorkSettlementRecordSchema,
  'REC-WORK-14': ObligationInstanceRecordSchema,
  'REC-WORK-15': CommitmentRecordSchema,
  'REC-WORK-16': FulfillmentMappingRecordSchema,
  'REC-WORK-HANDOVER': HandoverPackageRecordSchema,
  'REC-WORK-COMMIT-CHANGE': CommitmentChangeRecordSchema,
} as const

// —— §9 判定件（纯函数；不抛错） ——

/** 结清四态推导（§5.2 写死：未结清＞转入清算＞保留事项＞完全结清——L3E-13） */
export function deriveWorkSettledState(
  items: readonly { state: SettlementItemState; into_liquidation?: boolean | undefined }[],
): WorkSettledState {
  if (items.some((entry) => entry.state === 'open')) return 'unsettled'
  if (items.some((entry) => entry.into_liquidation === true)) return 'into_liquidation'
  if (items.some((entry) => entry.state === 'reservation')) return 'settled_with_reservations'
  return 'fully_settled'
}

/**
 * REC-WORK-12 判定（§5.2/§十五-2）：
 *   ① 结清清单逐项单列表且四态按推导规则写死（不得自报）；
 *   ② 转入清算/已终止必含承接（REC-LIFE-10 或 REC-WORK-HANDOVER）＋接收确认（治 L3E-01）；
 *   ③ 撤回/回收/清算或曾触及 EX-2+ 须派生面证据（W-12）；
 *   ④ 记忆三路分流凭证必填（未完成不得结清）；⑤ 完全结清且未作价值评估须写理由/责任者/复审点；
 *   ⑥ 核验者不得为工作责任者本人或其控制者（只判是否关闭，不重作验收）。
 */
export function validateWorkSettlement(record: unknown, ctx: WorkSettlementContext = {}): RecordValidationOutcome {
  const parsed = WorkSettlementRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  const derived = deriveWorkSettledState(payload.items)
  if (payload.settled_state !== derived) {
    checks.push(recordReject('payload.settled_state', `结清四态须按推导规则（逐项实得 ${derived}，声称 ${payload.settled_state}——L3E-13）`))
  }
  const needsHandover = payload.settled_state === 'into_liquidation' || ctx.workTerminated === true
  if (needsHandover && (payload.handover_ref === undefined || payload.handover_acceptance === undefined)) {
    checks.push(recordReject('payload.handover_ref', '转入清算/已终止必含承接记录与接收确认（未决事项有指派≠承接已被接受——L3E-01）'))
  }
  if (payload.handover_acceptance !== undefined && !payload.handover_acceptance.accepted) {
    checks.push(recordReject('payload.handover_acceptance.accepted', '接收确认未接受不得称已承接（§5.2）'))
  }
  const needsDerivedFace = payload.settled_state === 'into_liquidation' || ctx.touchedSensitive === true || ctx.ex2Plus === true
  if (needsDerivedFace && payload.derived_face_evidence.length === 0) {
    checks.push(recordReject('payload.derived_face_evidence', '撤回/回收/清算或曾触及 EX-2+ 须派生面证据（后代枚举与停用证据齐备，W-12）'))
  }
  if (payload.memory_disposition_refs.length === 0) {
    checks.push(recordReject('payload.memory_disposition_refs', '出工记忆三路分流凭证未完成不得结清（→REC-MEM-03——§5.2）'))
  }
  if (payload.settled_state === 'fully_settled' && ctx.valueEvaluated !== true && payload.value_ref === undefined && payload.value_evaluation_gap === undefined) {
    checks.push(recordReject('payload.value_ref', '完全结清且未作价值评估须写理由、责任者与复审点（治 L3E-03）'))
  }
  if (ctx.verifierIsOwner === true) {
    checks.push(recordReject('payload.verified_by', '核验者不得为工作责任者本人或其控制者（只判关闭，不重作验收——L3E-02）'))
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-WORK-HANDOVER 判定（§5.2 不变量）：
 *   ① 十项逐项表示，缺项不得留空（缺失须写去向）；② 换能力（实质变更）须引重认结论；
 *   ③ 交接只转移在途责任不是验收；无人接收须暂停并计时（由 acceptance 承载）。
 */
export function validateHandoverPackage(record: unknown, ctx: HandoverPackageContext = {}): RecordValidationOutcome {
  const parsed = HandoverPackageRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  const presentItems = payload.items.map((entry) => entry.item)
  for (const item of HANDOVER_ITEMS) {
    if (!presentItems.includes(item)) {
      checks.push(recordReject('payload.items', `交接包十项须逐项表示（缺 ${item}——§5.2）`))
    }
  }
  for (const entry of payload.items) {
    if (!entry.present && entry.missing_route === undefined) {
      checks.push(recordReject('payload.items', `第 ${entry.item} 项缺失须写去向（不得留空——§5.2）`))
    }
  }
  if (ctx.capabilityChanged === true && payload.requalification_ref === undefined) {
    checks.push(recordReject('payload.requalification_ref', '换能力（实质变更）须引 REC-CAP-02 重认结论；重认完成前高风险在途动作暂停（§5.2）'))
  }
  if (payload.derived_face.length === 0) {
    checks.push(recordReject('payload.derived_face', '第⑩项派生执行体与凭据清单不得为空（派生即登记——§5.2）'))
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-WORK-COMMIT-CHANGE 判定（§5.3 不变量）：
 *   ① 四段逐段留痕且次序不可跳；② 僵局时限自申请受理起算；
 *   ③ 相对方不同意时 outcome 必为三种合法去向之一（不得拖到过期造成既成事实）。
 */
export function validateCommitmentChange(record: unknown, ctx: CommitmentChangeContext = {}): RecordValidationOutcome {
  const parsed = CommitmentChangeRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  const stages = payload.stages.map((entry) => entry.stage)
  const expected = COMMIT_CHANGE_STAGES.slice(0, stages.length)
  if (stages.some((stage, index) => stage !== expected[index])) {
    checks.push(recordReject('payload.stages', `在途四段须按 申请→受理→相对方表达→决定 次序逐段留痕（实得 ${stages.join('/')}）`))
  }
  if (stages.length > 0) {
    const first = payload.stages[0]
    if (first !== undefined && Date.parse(payload.deadlock_clock) < Date.parse(first.at)) {
      checks.push(recordReject('payload.deadlock_clock', '僵局时限自申请受理时起算（不得早于申请时点——§5.3）'))
    }
  }
  if (ctx.counterpartyDeclined === true && payload.outcome === undefined) {
    checks.push(recordReject('payload.outcome', '相对方不同意时合法去向仅三种（维持原承诺/协商替代/依法终止），不得拖到过期造成既成事实（§5.3）'))
  }
  return mergeOutcomes(...checks)
}

/** REC-WORK-14 判定：移交须接收方接受；已结清与已承接不得同真（§5.3） */
export function validateObligationInstance(record: unknown): RecordValidationOutcome {
  const parsed = ObligationInstanceRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (payload.closed_or_assumed.assumed && payload.closed_or_assumed.receiver_confirmation_ref === undefined) {
    checks.push(recordReject('payload.closed_or_assumed', '移交须接收方接受（已承接须含接收确认——§5.3）'))
  }
  if (payload.closed_or_assumed.closed && payload.closed_or_assumed.assumed) {
    checks.push(recordReject('payload.closed_or_assumed', '已结清与已承接不得同真（结清 vs 承接二义——§5.3）'))
  }
  if (payload.completion.judged_by === null && payload.closed_or_assumed.closed) {
    checks.push(recordReject('payload.completion.judged_by', '已结清须有判断者与结论（无判断者不得结清——§5.3）'))
  }
  return mergeOutcomes(...checks)
}

/** REC-WORK-15 判定：内部任务不得冒称对外承诺；承接者不得自行加码或单方降标（§5.3） */
export function validateCommitment(record: unknown, ctx: CommitmentContext = {}): RecordValidationOutcome {
  const parsed = CommitmentRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (ctx.internalOnly === true) {
    checks.push(recordReject('payload.commitment_kind', '内部任务不得冒称对外承诺（受理≠承诺——§5.3）'))
  }
  if (ctx.modifiedByExecutor === true) {
    checks.push(recordReject('payload.content', '承诺不得由承接者自行加码或单方降标（须承诺授权位置程序——§5.3）'))
  }
  for (const ref of parsed.data.payload.revision_chain) {
    if (ref.refType !== 'REC-WORK-COMMIT-CHANGE') {
      checks.push(recordReject('payload.revision_chain', '历次变更须引用 REC-WORK-COMMIT-CHANGE（§5.3）'))
    }
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-WORK-16 判定（§5.3/§十五-2）：履约状态为派生值（无独立写入路径）；
 * 已兑现必含相对方验收引用；工作返工/暂停时不得标「进行顺利」。
 */
export function validateFulfillmentMapping(record: unknown, ctx: FulfillmentMappingContext = {}): RecordValidationOutcome {
  const parsed = FulfillmentMappingRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (ctx.writtenIndependently === true) {
    checks.push(recordReject('recordType', '履约状态为派生值：只能由工作状态＋验收结论推出，禁止独立写入（§5.3/§十五-2）'))
  }
  if (payload.derived_status === 'fulfilled' && payload.counterparty_acceptance === undefined) {
    checks.push(recordReject('payload.counterparty_acceptance', '已兑现必含相对方验收引用；无则最多到有风险/无法判断（治 L3E-06）'))
  }
  const states = ctx.workStates ?? []
  if (states.includes('rework') && payload.derived_status === 'on_track') {
    checks.push(recordReject('payload.derived_status', '工作返工时履约不得标「进行顺利」（§5.3）'))
  }
  if (states.includes('paused') && payload.derived_status === 'on_track') {
    checks.push(recordReject('payload.derived_status', '工作暂停时履约须标「有风险」并给原因（§5.3）'))
  }
  return mergeOutcomes(...checks)
}

