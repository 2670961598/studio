/**
 * WORK 任务族·返工/重开/协作/异常/止损（REC-WORK-10、11、13、17、18）——MIG-03 / IMPL-03-02
 *
 * 依据链：
 *   - v2/11 §5.2（10 返工/11 重开）、§5.3（13 派工协作）、§5.4（17 异常/18 紧急止损）；
 *     §1.4 WORK 族 21 类登记；§十四 §14.1 M-24/M-29（达阈值强制重新受理／终态复核非迁移）
 *   - v2/09 ENU-19 返工原因、ENU-23 协作动作、ENU-24 协作答复、ENU-25 未响应语义、
 *     ENU-26 异常类别、ENU-27 异常终局、ENU-28 重开回退去向
 *   - v2/04 §五/§九/§十；v2/01 I-11/I-15；v2/08 §五（观察义务）
 *   - plan/05 IMPL-03-02（拆件：本件＝10/11/13/17/18；12..16 与三条具名类在 work-close.ts）
 *
 * 登记缺口（不臆造）：
 *   1. REC-WORK-11 `second_terminal` 形状正文未给 → `second_terminal_ref` 引用承载。
 *   2. REC-WORK-17 `terminal` 的「未终局」是缺省标记非终局值（§5.4 写死）→ `null` 承载，不入 ENU-27。
 *   3. REC-WORK-11 复核动作（受理位置/范围/期限/结论去向）正文未给形状 → 结构化槽承载。
 *
 * 纪律：只写可擦除语法；相对 import 带 `.ts`；类型导入 `import type`；不定义族外枚举字面量。
 */
import { z } from 'zod'
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

// —— §1 枚举投影（v2/09 主表；本文件只投影） ——

/** ENU-19 返工原因归类（无原因归类不得「再改一版」——§5.2） */
export const REWORK_CAUSES = ['criteria', 'capability', 'information', 'collaboration', 'external_change'] as const
export const ReworkCauseSchema = z.enum(REWORK_CAUSES)

/** ENU-23 协作动作十一取值 */
export const COLLAB_ACTIONS = [
  'dispatch', 'claim', 'reassign', 'request_input', 'request_review', 'request_authority',
  'handover_move', 'relay', 'countersign', 'objection', 'request_arbitration',
] as const
export const CollabActionSchema = z.enum(COLLAB_ACTIONS)

/** ENU-24 协作答复取值（含「已转呈」） */
export const COLLAB_RESPONSES = ['accepted', 'conditional', 'rejected', 'referred'] as const
export const CollabResponseSchema = z.enum(COLLAB_RESPONSES)

/** ENU-25 未响应语义六值（请求授权未响应不得默认授权——§5.3） */
export const NO_RESPONSE_EFFECTS = [
  'escalate_on_expiry', 'silence_not_consent', 'unconfirmed_not_transferred', 'unsigned_not_effective',
  'breakpoint_to_dispatcher', 'no_default_authorization',
] as const
export const NoResponseEffectSchema = z.enum(NO_RESPONSE_EFFECTS)

/** ENU-26 异常类别（类别是输入维度，出口是输出维度，不得互替——§5.4） */
export const EXCEPTION_CLASSES = [
  'rule_deviation', 'rule_gap', 'rule_conflict', 'source_doubt', 'irreversible_harm_ongoing', 'no_comparable_criteria',
  'criteria_invalid', 'slow_drift', 'holistically_unacceptable', 'report_overdue', 'report_integrity_doubt',
] as const
export const ExceptionClassSchema = z.enum(EXCEPTION_CLASSES)

/** ENU-27 异常终局取值（「未终局」是缺省标记非终局值——§5.4） */
export const EXCEPTION_TERMINALS = ['closed_by_correction', 'closed_by_termination', 'referred_up'] as const
export const ExceptionTerminalSchema = z.enum(EXCEPTION_TERMINALS)

/** ENU-28 重开回退去向（非终态六值子集；终态上重开一律复核动作，不产生状态回退——§5.2/M-29） */
export const REOPEN_RETURN_STATES = ['intake', 'pending_start', 'in_progress', 'paused', 'awaiting_review', 'rework'] as const
export const ReopenReturnStateSchema = z.enum(REOPEN_RETURN_STATES)

/** 重开复核动作（终态复核：受理位置/范围/期限/结论去向——§5.2 写死，不产生状态回退） */
export const ReviewActionSchema = z.strictObject({
  position: z.string().min(1),
  scope: z.string().min(1),
  deadline: TimestampSchema,
  conclusion_route: z.string().min(1),
})

// —— §2 REC-WORK-10 返工记录（原因归类/范围/次数/阈值状态） ——

export const ReworkRecordPayloadSchema = z.strictObject({
  triggered_by: RecordRefSchema,
  cause_class: ReworkCauseSchema,
  scope: z.string().min(1),
  /** 返工次数（达阈值强制重新受理 M-24） */
  count: z.number().int().min(1),
  threshold_state: z.strictObject({
    threshold: z.number().int().min(1),
    reached: z.boolean(),
    post_reached_disposition: z.string().min(1).optional(),
  }),
  deadline: TimestampSchema,
})

export type ReworkRecordPayload = z.infer<typeof ReworkRecordPayloadSchema>
export const ReworkRecordRecordSchema = recordEnvelopeSchema(ReworkRecordPayloadSchema, 'REC-WORK-10')

// —— §3 REC-WORK-11 重开记录（限定范围；终态上重开是复核动作非状态回退） ——

export const ReopenRecordPayloadSchema = z.strictObject({
  reopened_refs: z.array(RecordRefSchema).min(1),
  new_evidence: z.array(ObjectRefSchema).min(1),
  standard_applied: z.string().min(1),
  /** 明确不影响部分保持原状 */
  affected_scope: z.string().min(1),
  /** 非终态回退的限定去向（终态上重开为空——M-29 写死） */
  return_state: ReopenReturnStateSchema.optional(),
  /** 终态复核动作（受理位置/范围/期限/结论去向） */
  review_action: ReviewActionSchema,
  decided_by: z.string().min(1),
  dissent_position: z.string().min(1),
  /** 不受理理由与缺失证据类别（L3E-07） */
  rejection: z.strictObject({ reason: z.string().min(1), missing_evidence_classes: z.array(z.string().min(1)) }).optional(),
  /** 原结论标「已被重开」，不删除 */
  original_annotation: z.string().min(1),
  second_terminal_ref: RecordRefSchema.optional(),
})

export type ReopenRecordPayload = z.infer<typeof ReopenRecordPayloadSchema>
export const ReopenRecordRecordSchema = recordEnvelopeSchema(ReopenRecordPayloadSchema, 'REC-WORK-11')

/** REC-WORK-11 判定输入（被重开对象是否为终态／本次是否受理） */
export interface ReopenRecordContext {
  reopensTerminal?: boolean
  acceptedAction?: boolean
}

// —— §7 REC-WORK-13 派工/领取/协作请求 ——

export const CollaborationRequestPayloadSchema = z.strictObject({
  action_kind: CollabActionSchema,
  work_ref: RecordRefSchema,
  from: ObjectRefSchema,
  to: ObjectRefSchema,
  /** 随合同走的要件（缺要件被派方有权要求补齐） */
  carried_terms: z.array(z.string().min(1)),
  deadline: TimestampSchema,
  /** 答复（未响应为 null——不得默认同意） */
  response: CollabResponseSchema.nullable(),
  /** 未响应语义（ENU-25；请求授权未响应不得默认授权） */
  no_response_effect: NoResponseEffectSchema,
  /** 移交/接力时→REC-WORK-HANDOVER */
  handover_ref: RecordRefSchema.optional(),
})

export type CollaborationRequestPayload = z.infer<typeof CollaborationRequestPayloadSchema>
export const CollaborationRequestRecordSchema = recordEnvelopeSchema(CollaborationRequestPayloadSchema, 'REC-WORK-13')

// —— §11 REC-WORK-17 异常记录（具名接收＋升级链；每类异常逐类必有出口） ——

export const ExceptionRecordPayloadSchema = z.strictObject({
  subject_ref: RecordRefSchema,
  exception_class: ExceptionClassSchema,
  /** 口径缺失须显式「无可比口径」表示＋理由（治 L3E-12） */
  judged_against: z.string().min(1),
  impact_scope: z.string().min(1),
  discovered_by: z.string().min(1),
  /** 具名接收位置（不得「框架/系统/公司」，不得默认未认领——治 L3E-16） */
  receiver: z.string().min(1),
  escalation_target: z.strictObject({
    position: z.string().min(1),
    deadline: TimestampSchema,
    re_escalate_to: z.string().min(1),
  }),
  response_deadline: TimestampSchema,
  review_condition: z.string().min(1),
  /** 终局取值（null＝未终局缺省标记，非终局值——§5.4） */
  terminal: ExceptionTerminalSchema.nullable(),
  /** 终局＝终止/变更时必填对应决定引用 */
  terminal_decided_by: z.string().min(1).optional(),
  terminal_decision_ref: RecordRefSchema.optional(),
  dissent_position: z.string().min(1),
  /** 只报有利证据＝报告完整性存疑（不定责，处置升级＋标记） */
  concealment_finding: z.string().min(1).optional(),
})

export type ExceptionRecordPayload = z.infer<typeof ExceptionRecordPayloadSchema>
export const ExceptionRecordRecordSchema = recordEnvelopeSchema(ExceptionRecordPayloadSchema, 'REC-WORK-17')

// —— §12 REC-WORK-18 紧急止损记录（预设边界内先行保全，事后独立复核） ——

export const EmergencyStopPayloadSchema = z.strictObject({
  trigger: z.string().min(1),
  /** 预设紧急边界；无预设边界时只能采取不进入禁止/保留权限的保全与升级 */
  boundary_ref: RecordRefSchema.nullable(),
  actions_taken: z.array(z.string().min(1)).min(1),
  /** 明确未做的事 */
  not_authorized: z.array(z.string().min(1)),
  evidence_preserved: z.array(ObjectRefSchema),
  notified: z.array(ObjectRefSchema).min(1),
  independent_review: z.strictObject({ position: z.string().min(1), deadline: TimestampSchema, conclusion: z.string().min(1) }),
  /** 不追认原动作、不等于恢复、不推广为常态 */
  effect_on_original: z.string().min(1),
})

export type EmergencyStopPayload = z.infer<typeof EmergencyStopPayloadSchema>
export const EmergencyStopRecordSchema = recordEnvelopeSchema(EmergencyStopPayloadSchema, 'REC-WORK-18')

// —— §5 本半形状闸（WORK 10/11/13/17/18） ——

export const WORK_EXEC_RECORD_SCHEMAS = {
  'REC-WORK-10': ReworkRecordRecordSchema,
  'REC-WORK-11': ReopenRecordRecordSchema,
  'REC-WORK-13': CollaborationRequestRecordSchema,
  'REC-WORK-17': ExceptionRecordRecordSchema,
  'REC-WORK-18': EmergencyStopRecordSchema,
} as const

// —— §6 判定件（纯函数；不抛错） ——

/** REC-WORK-10 判定：达阈值强制重新受理；超阈值须有权位置判断问题在口径/能力/资源/承诺（§5.2） */
export function validateReworkRecord(record: unknown): RecordValidationOutcome {
  const parsed = ReworkRecordRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (payload.count > payload.threshold_state.threshold && payload.threshold_state.post_reached_disposition === undefined) {
    checks.push(recordReject('payload.threshold_state', '返工次数超阈值须写达后处置（强制重新受理/口径复审——§5.2/M-24）'))
  }
  if (payload.threshold_state.reached && payload.threshold_state.threshold > payload.count) {
    checks.push(recordReject('payload.threshold_state.reached', 'threshold_state.reached 与 count/threshold 不一致（达阈值判定须可复算）'))
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-WORK-11 判定（§5.2/M-29）：
 *   ① 终态上重开一律是复核动作或新事项受理，不产生状态回退（return_state 必空）；
 *   ② 不受理须写理由与缺失证据类别（L3E-07）；③ 原结论标「已被重开」，不删除。
 */
export function validateReopenRecord(record: unknown, ctx: ReopenRecordContext = {}): RecordValidationOutcome {
  const parsed = ReopenRecordRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (ctx.reopensTerminal === true && payload.return_state !== undefined) {
    checks.push(recordReject('payload.return_state', '终态上重开不产生状态回退（复核动作或新事项受理——M-29/L3D-03）'))
  }
  if (ctx.acceptedAction === false && payload.rejection === undefined) {
    checks.push(recordReject('payload.rejection', '不受理须写理由与缺失证据类别（L3E-07）'))
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-WORK-13 判定（§5.3）：请求授权未响应不得默认授权；移交/接力须引交接包；
 * 派工随合同走，缺要件被派方有权要求补齐；无人接受不得无限挂起（须带到期语义）。
 */
export function validateCollaborationRequest(record: unknown): RecordValidationOutcome {
  const parsed = CollaborationRequestRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (payload.action_kind === 'request_authority' && payload.response === null && payload.no_response_effect !== 'no_default_authorization') {
    checks.push(recordReject('payload.no_response_effect', '请求授权未响应不得默认授权（ENU-25 no_default_authorization——§5.3）'))
  }
  if ((payload.action_kind === 'handover_move' || payload.action_kind === 'relay') && payload.handover_ref === undefined) {
    checks.push(recordReject('payload.handover_ref', '移交/接力须引交接包（REC-WORK-HANDOVER——§5.3）'))
  }
  if (payload.action_kind === 'dispatch' && payload.carried_terms.length === 0) {
    checks.push(recordReject('payload.carried_terms', '派工随合同走：须携要件，缺要件被派方有权要求补齐（§5.3）'))
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-WORK-17 判定（§5.4 不变量）：
 *   ① 接收者须具名（不得「框架/系统/公司」）；② 终局＝终止/变更须有决定引用与决定者；
 *   ③ 缺可比口径须显式表示（no_comparable_criteria 时 judged_against 不得空话）；
 *   ④ 「未终局」是缺省标记非终局值——未终局记录不得被当作已结案。
 */
export function validateExceptionRecord(record: unknown, ctx: { treatedAsClosed?: boolean } = {}): RecordValidationOutcome {
  const parsed = ExceptionRecordRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  const ANONYMOUS = ['框架', '系统', '公司', '平台', '流程', 'daemon', '监控', '自动策略']
  if (ANONYMOUS.some((alias) => payload.receiver.trim().toLowerCase() === alias)) {
    checks.push(recordReject('payload.receiver', '接收者须具名（不得「框架/系统/公司」，不得默认未认领——治 L3E-16）'))
  }
  if (payload.exception_class === 'no_comparable_criteria' && payload.judged_against.trim().length === 0) {
    checks.push(recordReject('payload.judged_against', '缺可比口径须显式「无可比口径」表示＋理由（治 L3E-12）'))
  }
  if (payload.terminal === 'closed_by_termination' && payload.terminal_decision_ref === undefined) {
    checks.push(recordReject('payload.terminal_decision_ref', '终局＝终止/变更须有对应决定引用（§5.4）'))
  }
  if (payload.terminal !== null && payload.terminal_decided_by === undefined) {
    checks.push(recordReject('payload.terminal_decided_by', '终局须有具名决定者（§5.4）'))
  }
  if (payload.terminal === null && ctx.treatedAsClosed === true) {
    checks.push(recordReject('payload.terminal', '未终局是缺省标记非终局值：无终局的异常状态本身是异常，不得当作已结案（§5.4）'))
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-WORK-18 判定（§5.4）：紧急止损是唯一允许在验收缺位下先行的情形，且只允许最小保全与止损；
 * 无预设边界时不得进入禁止/保留权限；事后独立复核必填。
 */
export function validateEmergencyStop(record: unknown, ctx: { entersForbiddenOrReserved?: boolean } = {}): RecordValidationOutcome {
  const parsed = EmergencyStopRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (payload.boundary_ref === null && ctx.entersForbiddenOrReserved === true) {
    checks.push(recordReject('payload.boundary_ref', '无预设边界时只能采取不进入禁止/保留权限的保全与升级（§5.4）'))
  }
  if (payload.not_authorized.length === 0) {
    checks.push(recordReject('payload.not_authorized', '须明确未做的事（不追认、不等于恢复、不推广为常态——§5.4）'))
  }
  return mergeOutcomes(...checks)
}

