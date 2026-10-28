/**
 * AUTH 族·通用骨架七类八条（REC-CMD-01/02、REC-DEC-01、REC-RCP-01、REC-COR-01、REC-EVT-01/02/03）
 * ——MIG-03 / IMPL-03-01 补件
 *
 * 补件缘由：v2/11 §1.1 AUTH 权责族为 **16 类**＝授权链 8 类（auth.ts）＋通用骨架 8 类（本文件）；
 *   03-01 单书 §2 只点名 AUTH-01..08，宰相 2026-10-28 令补齐 74 类覆盖（不新增记录类，仍 74）。
 *
 * 依据链：v2/11 §2.1（七类压缩规格：字段/不变量/失败出口）、§〇.2（五分型）、§〇.3（一事件一身份/决定面）、
 *   §〇.5（生效槽位与 payload 区间禁令）、§〇.7（证明边界）｜v2/09 ENU-31（政策结论四态）、ENU-60（完整性三值）、
 *   ENU-68（对账差异六类）、ENU-69（来源核验四值）、ENU-70（修正类别）、ENU-71（回执类别）、ENU-128（命令类别）
 *   ——值集唯一主表在 v2/09，本文件只投影｜v2/08 §〇（事件/修正/对账语义源）｜plan/05 IMPL-03-01
 *
 * 登记缺口（不臆造）：
 *   1. §2.1 未给 `conflict_check`/`event_kind`/`source_kind` 等字段的封闭值集 → 以非空串承载（值集登记待主表补条）。
 *   2. §2.1「未核验只能暂缓或拒绝，不得进入执行步」是**流程**不变量：本文件以 `admittedToExecution` 判定面输入承载
 *      （记录本身可合法存在——请求被暂缓/拒绝正是它该有的样子）。
 *
 * 纪律：只写可擦除语法；相对 import 带 `.ts`；类型导入 `import type`。
 */
import {
  EffectiveSlotSchema,
  FORBIDDEN_DECISION_SUBJECTS,
  IdempotencyScopeSchema,
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
import { z } from 'zod'

// —— §1 记录类型登记（v2/11 §1.1 的通用骨架八条；序即 §2.1 节序）——
export const COMMON_RECORD_TYPES = [
  'REC-CMD-01', 'REC-CMD-02', 'REC-DEC-01', 'REC-RCP-01', 'REC-COR-01', 'REC-EVT-01', 'REC-EVT-02', 'REC-EVT-03',
] as const

export type CommonRecordType = (typeof COMMON_RECORD_TYPES)[number]

// —— §2 枚举投影（v2/09 主表）——

/** ENU-128 命令类别（仅外部/人工入口与无专用类型动作；域动作走专用记录——§2.1 写死） */
export const COMMAND_KINDS = ['external_request', 'manual_action', 'generic_application'] as const
export const CommandKindSchema = z.enum(COMMAND_KINDS)

/** ENU-69 来源核验四值（未核验只能暂缓或拒绝，不得进入执行步——§2.1） */
export const SOURCE_VERIFICATIONS = ['verified', 'unverified', 'verification_failed', 'source_unknown'] as const
export const SourceVerificationSchema = z.enum(SOURCE_VERIFICATIONS)

/** ENU-31 政策结论四态（判定顺序 prohibited→reserved→permitted→uncovered＝deny） */
export const POLICY_VERDICTS = ['permitted', 'reserved', 'prohibited', 'uncovered'] as const
export const PolicyVerdictSchema = z.enum(POLICY_VERDICTS)

/** ENU-71 回执类别（partially_executed 时逐项槽位必填且不得为空列表——§2.1/L3D-13） */
export const ACK_KINDS = ['received', 'rejected', 'executed', 'partially_executed', 'unknown'] as const
export const AckKindSchema = z.enum(ACK_KINDS)

/** ENU-70 修正类别（追加不覆盖——§2.1） */
export const CORRECTION_KINDS = ['supersede', 'revoke', 'scope_limit'] as const
export const CorrectionKindSchema = z.enum(CORRECTION_KINDS)

/**
 * ENU-60 完整性三值（`event_completeness`/`harvest_completeness`/`view_completeness` 共用；
 * 字段名专用不互替——本文件只用 `event_completeness` 与对账 `completeness_claim`）。
 */
export const COMPLETENESS_VALUES = ['complete', 'incomplete', 'unknown'] as const
export const CompletenessSchema = z.enum(COMPLETENESS_VALUES)

/** ENU-68 对账差异六类（缺失/重复/乱序/冲突/迟到/无法判定） */
export const DIFFERENCE_CLASSES = ['missing', 'duplicate', 'disorder', 'conflict', 'late_arrival', 'undeterminable'] as const
export const DifferenceClassSchema = z.enum(DIFFERENCE_CLASSES)

/** 「请求可判定」的占位语黑名单（§2.1：requested_effect 可判定，禁「处理好」类空话） */
export const VAGUE_EFFECT_LITERALS = ['处理好', '处理一下', '优化一下', '看着办', '尽快', '看情况'] as const

// —— §3 REC-CMD-01 命令请求 / REC-CMD-02 权源检查 ——

export const CommandRequestPayloadSchema = z
  .strictObject({
    command_kind: CommandKindSchema,
    target_ref: ObjectRefSchema,
    /** 预期版本（改变状态的写入必须带预期版本——§0.4-4；不匹配即拒绝） */
    expected_version: z.string().min(1),
    /** 期望效果（可判定；禁「处理好」类空话——validateCommandRequest 判定） */
    requested_effect: z.string().min(1),
    claimed_authority: z.array(RecordRefSchema),
    scope: z.array(z.string().min(1)),
    idempotency_key: IdempotencyScopeSchema,
    issued_at: TimestampSchema,
    received_at: TimestampSchema,
    source_verification: SourceVerificationSchema,
    payload_digest: z.string().min(1),
  })
  .superRefine((v, ctx) => {
    if ((VAGUE_EFFECT_LITERALS as readonly string[]).some((literal) => v.requested_effect.trim() === literal)) {
      ctx.addIssue({ code: 'custom', path: ['requested_effect'], message: 'requested_effect 须可判定（禁「处理好」类空话——§2.1）' })
    }
  })

export const CommandRequestRecordSchema = recordEnvelopeSchema(CommandRequestPayloadSchema, 'REC-CMD-01')

export const AuthorityCheckPayloadSchema = z
  .strictObject({
    checked_command: RecordRefSchema,
    /** 可空列表＝无可用授予（不得自动允许——§2.1） */
    resolved_grants: z.array(RecordRefSchema),
    policy_verdict: PolicyVerdictSchema,
    /** 禁配检查（形状未封闭——非空串承载） */
    conflict_check: z.string().min(1),
    /** 子授权不超父授权目的/范围/条件/期限（I-6） */
    delegation_chain_ok: z.boolean(),
    effective_scope: z.array(z.string().min(1)),
    fail_reason: z.string().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.checked_command.refType !== 'REC-CMD-01') {
      ctx.addIssue({ code: 'custom', path: ['checked_command', 'refType'], message: 'checked_command 须指向 REC-CMD-01（命令请求）' })
    }
    if (v.policy_verdict !== 'permitted' && v.fail_reason === undefined) {
      ctx.addIssue({ code: 'custom', path: ['fail_reason'], message: '非 permitted 结论须写 fail_reason（禁止→停止；保留→转呈；未覆盖→请求决定——§2.1）' })
    }
  })

export const AuthorityCheckRecordSchema = recordEnvelopeSchema(AuthorityCheckPayloadSchema, 'REC-CMD-02')

// —— §4 REC-DEC-01 泛型决定（只承载无专用记录类型的决定；已有专用类型再写＝双身份）——

export const GenericDecisionPayloadSchema = z.strictObject({
  decided_by: z.string().min(1),
  decision_kind: z.string().min(1),
  subject_ref: ObjectRefSchema,
  /** 由对象类型决定，不得借用专用类型取值集（§2.1） */
  verdict: z.string().min(1),
  conditions: z.array(z.string().min(1)),
  /** 理由不得为空（§2.1 不变量） */
  rationale: z.string().min(1),
  basis_refs: z.array(RecordRefSchema).min(1),
  /** 判了什么/没判什么（缺 scope_judged 或 dissent_position 的决定只能作意见记录，不得触发迁移） */
  scope_judged: z.strictObject({ judged: z.array(z.string().min(1)).min(1), not_judged: z.array(z.string().min(1)) }),
  dissent_position: z.string().min(1),
  /** 生效槽位（§0.5：与信封同值；payload 不存区间窗口） */
  ...EffectiveSlotSchema.shape,
  external_effect_state: z.string().min(1),
})
export const GenericDecisionRecordSchema = recordEnvelopeSchema(GenericDecisionPayloadSchema, 'REC-DEC-01')

// —— §5 REC-RCP-01 回执（结果不明一律先对账，不得盲目重试）——

export const ReceiptPayloadSchema = z
  .strictObject({
    acknowledges: RecordRefSchema,
    ack_kind: AckKindSchema,
    /** 已执行必填 */
    resulting_version: z.string().min(1).optional(),
    external_ref: ObjectRefSchema.optional(),
    rejection_reason: z.string().min(1).optional(),
    retryable: z.boolean(),
    side_effect_possible: z.boolean(),
    reconcile_hint: z.string().min(1),
    /** 部分执行时逐项｛项、状态、理由｝必填且不得为空列表（治 L3D-13） */
    partial_items: z.array(z.strictObject({ item: z.string().min(1), state: z.string().min(1), reason: z.string().min(1) })).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.ack_kind === 'partially_executed' && (v.partial_items === undefined || v.partial_items.length === 0)) {
      ctx.addIssue({ code: 'custom', path: ['partial_items'], message: 'ack_kind=partially_executed 时 partial_items 必填且不得为空列表（L3D-13）' })
    }
    if (v.ack_kind === 'executed' && v.resulting_version === undefined) {
      ctx.addIssue({ code: 'custom', path: ['resulting_version'], message: '已执行回执必填 resulting_version（§2.1）' })
    }
    if (v.ack_kind === 'rejected' && v.rejection_reason === undefined) {
      ctx.addIssue({ code: 'custom', path: ['rejection_reason'], message: '已拒回执必填 rejection_reason（§2.1）' })
    }
  })
export const ReceiptRecordSchema = recordEnvelopeSchema(ReceiptPayloadSchema, 'REC-RCP-01')

// —— §6 REC-COR-01 修正（追加不覆盖；不得追溯授权过去的越权）——

export const CorrectionPayloadSchema = z.strictObject({
  corrects: z.array(RecordRefSchema).min(1),
  correction_kind: CorrectionKindSchema,
  /** 新旧值逐字段 */
  corrected_fields: z.array(z.strictObject({ field: z.string().min(1), old_value: z.string().min(1), new_value: z.string().min(1) })).min(1),
  affected_conclusions: z.array(z.string().min(1)),
  authority_ref: RecordRefSchema,
  /** 向前适用起点（单时刻；**不承载终点**、不与信封 until 同值绑定——§0.5/v1 区间型 effective_window 废止） */
  effective_from: TimestampSchema,
  /** 恒为真（追加不覆盖；不得把补证伪装成当时证据） */
  original_preserved: z.literal(true),
})
export const CorrectionRecordSchema = recordEnvelopeSchema(CorrectionPayloadSchema, 'REC-COR-01')

// —— §7 REC-EVT-01 事件 / 02 对账批次 / 03 外部未知登记 ——

export const EventPayloadSchema = z.strictObject({
  event_kind: z.string().min(1),
  /** 不得只写工具名（须可追到具名主体——§2.1） */
  actor_ref: z.string().min(1),
  occurred_at: TimestampSchema,
  observed_at: TimestampSchema,
  payload_summary: z.string().min(1),
  source_kind: z.string().min(1),
  cursor: z.string().min(1),
  /** 本类型专用命名（不得与 harvest/view_completeness 互替——ENU-60） */
  event_completeness: CompletenessSchema,
})
export const EventRecordSchema = recordEnvelopeSchema(EventPayloadSchema, 'REC-EVT-01')

export const ReconciliationPayloadSchema = z
  .strictObject({
    scope: z.string().min(1),
    baseline_cursor: z.string().min(1),
    compared_sources: z.array(z.string().min(1)).min(1),
    difference_classes: z.array(DifferenceClassSchema),
    /** 逐项责任位置、处置与期限 */
    per_item_disposition: z.array(
      z.strictObject({ item: z.string().min(1), owner: z.string().min(1), disposition: z.string().min(1), due: TimestampSchema }),
    ),
    completeness_claim: CompletenessSchema,
    /** 是否阻断（有差异却声明不阻断＝把差异当零） */
    blocking_effect: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.difference_classes.length > 0 && v.per_item_disposition.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['per_item_disposition'], message: '有差异类别时须逐项写责任位置/处置/期限（§2.1）' })
    }
    if (v.difference_classes.length > 0 && !v.blocking_effect) {
      ctx.addIssue({ code: 'custom', path: ['blocking_effect'], message: '存在未消解差异时不得声明不阻断（对账完成前不得结清/不得宣称迁移完成——§2.1）' })
    }
  })
export const ReconciliationRecordSchema = recordEnvelopeSchema(ReconciliationPayloadSchema, 'REC-EVT-02')

export const UnknownRegistryPayloadSchema = z.strictObject({
  unknown_scope: z.string().min(1),
  reason: z.string().min(1),
  last_known: z.string().min(1),
  /** 影响面（下游须显示「未知/受损」，不得显示为零/健康/无异常——§2.1） */
  impact: z.string().min(1),
  /** 具名接收位置（owner 非匿名——validateUnknownRegistry 判定） */
  owner: z.string().min(1),
  review_by: TimestampSchema,
})
export const UnknownRegistryRecordSchema = recordEnvelopeSchema(UnknownRegistryPayloadSchema, 'REC-EVT-03')

// —— §8 判定件（纯函数；不抛错） ——

export const COMMON_RECORD_SCHEMAS: Readonly<Record<CommonRecordType, z.ZodType>> = {
  'REC-CMD-01': CommandRequestRecordSchema, 'REC-CMD-02': AuthorityCheckRecordSchema, 'REC-DEC-01': GenericDecisionRecordSchema,
  'REC-RCP-01': ReceiptRecordSchema, 'REC-COR-01': CorrectionRecordSchema, 'REC-EVT-01': EventRecordSchema,
  'REC-EVT-02': ReconciliationRecordSchema, 'REC-EVT-03': UnknownRegistryRecordSchema,
}

/** REC-CMD-01 判定输入（`admittedToExecution`＝该请求是否已被放进执行步——流程判定面输入） */
export interface CommandRequestContext {
  admittedToExecution?: boolean
}

/** REC-CMD-01 判定：未核验只能暂缓或拒绝，不得进入执行步（§2.1 不变量） */
export function validateCommandRequest(record: unknown, ctx: CommandRequestContext = {}): RecordValidationOutcome {
  const parsed = CommandRequestRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (payload.source_verification !== 'verified' && ctx.admittedToExecution === true) {
    checks.push(recordReject('payload.source_verification', '来源未核验只能暂缓或拒绝，不得进入执行步（§2.1）'))
  }
  return mergeOutcomes(...checks)
}

/** REC-CMD-02 判定：禁止优先、未覆盖不自动允许；「命中显式未覆盖条目」与「无条目命中」须区分（§2.1） */
export function validateAuthorityCheck(record: unknown): RecordValidationOutcome {
  const parsed = AuthorityCheckRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (payload.policy_verdict === 'permitted' && payload.resolved_grants.length === 0) {
    checks.push(recordReject('payload.resolved_grants', '无可用授予却判 permitted＝自动允许（未覆盖不自动允许——§2.1）'))
  }
  if (payload.policy_verdict === 'permitted' && !payload.delegation_chain_ok) {
    checks.push(recordReject('payload.delegation_chain_ok', '子授权链不成立却判 permitted（无法判定包含关系不得视为已授权——§2.1/I-6）'))
  }
  return mergeOutcomes(...checks)
}

/** REC-DEC-01 判定输入（`hasDedicatedType`＝该语义事件是否已有专用记录类型——一事件一身份判定面） */
export interface GenericDecisionContext {
  hasDedicatedType?: boolean
}

/** REC-DEC-01 判定：已有专用类型再写＝双身份（不合格写入，§0.3-3/§2.1） */
export function validateGenericDecision(record: unknown, ctx: GenericDecisionContext = {}): RecordValidationOutcome {
  const parsed = GenericDecisionRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (ctx.hasDedicatedType === true) {
    checks.push(recordReject('recordType', '该语义事件已有专用记录类型，再写 REC-DEC-01＝双身份（不合格写入——§0.3-3）'))
  }
  return mergeOutcomes(...checks)
}

/** REC-RCP-01 判定输入（`retriedWithoutReconcile`＝结果不明却已重试——对账前重试判负） */
export interface ReceiptContext {
  retriedWithoutReconcile?: boolean
}

/** REC-RCP-01 判定：结果不明一律先对账，不得盲目重试（§2.1 不变量） */
export function validateReceipt(record: unknown, ctx: ReceiptContext = {}): RecordValidationOutcome {
  const parsed = ReceiptRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (parsed.data.payload.ack_kind === 'unknown' && ctx.retriedWithoutReconcile === true) {
    checks.push(recordReject('payload.ack_kind', '结果不明须先对账（REC-EVT-02），不得盲目重试（§2.1）'))
  }
  return mergeOutcomes(...checks)
}

/** REC-COR-01 判定输入（`retroactivelyAuthorizes`＝该修正是否被用来追溯授权过去的越权） */
export interface CorrectionContext {
  retroactivelyAuthorizes?: boolean
}

/** REC-COR-01 判定：追加不覆盖、不得追溯授权过去的越权（§2.1） */
export function validateCorrection(record: unknown, ctx: CorrectionContext = {}): RecordValidationOutcome {
  const parsed = CorrectionRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (ctx.retroactivelyAuthorizes === true) {
    checks.push(recordReject('payload.effective_from', '修正不得追溯授权过去的越权/不得把补证伪装成当时证据（§2.1）'))
  }
  return mergeOutcomes(...checks)
}

/** REC-EVT-01 判定输入（事件是否被当作迁移驱动源／actor 是否只写工具名） */
export interface EventContext {
  drivesTransition?: boolean
  actorIsToolOnly?: boolean
}

/**
 * REC-EVT-01 判定（§2.1/§十四 总规则）：**事件不得直接驱动工作/任职状态迁移**——迁移只能由
 * REC-WORK-06 / REC-LIFE-02 依决定作出；`actor_ref` 不得只写工具名（须可追到具名主体）。
 */
export function validateEvent(record: unknown, ctx: EventContext = {}): RecordValidationOutcome {
  const parsed = EventRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (ctx.drivesTransition === true) {
    checks.push(recordReject('recordType', '事件不得直接驱动状态迁移（迁移只能由 REC-WORK-06 / REC-LIFE-02 依决定作出——§2.1/§十四）'))
  }
  if (ctx.actorIsToolOnly === true) {
    checks.push(recordReject('payload.actor_ref', 'actor_ref 不得只写工具名（须可追到具名主体——§2.1）'))
  }
  return mergeOutcomes(...checks)
}

/** REC-EVT-02 判定输入（是否在对账未完成时宣称结清/迁移完成） */
export interface ReconciliationContext {
  claimsSettledOrMigrated?: boolean
}

/** REC-EVT-02 判定：对账完成前不得结清、不得宣称迁移完成、不得把镜像升权威（§2.1） */
export function validateReconciliation(record: unknown, ctx: ReconciliationContext = {}): RecordValidationOutcome {
  const parsed = ReconciliationRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (payload.completeness_claim !== 'complete' && ctx.claimsSettledOrMigrated === true) {
    checks.push(recordReject('payload.completeness_claim', '对账未完成（不完整/未知）不得宣称结清或迁移完成（§2.1）'))
  }
  return mergeOutcomes(...checks)
}

/** REC-EVT-03 判定输入（下游是否把未知显示成零/健康/无异常） */
export interface UnknownRegistryContext {
  displayedAsZeroOrHealthy?: boolean
}

/** REC-EVT-03 判定：下游视图必须显示「未知/受损」；owner 不得是匿名主体（§2.1/§0.2-1） */
export function validateUnknownRegistry(record: unknown, ctx: UnknownRegistryContext = {}): RecordValidationOutcome {
  const parsed = UnknownRegistryRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (ctx.displayedAsZeroOrHealthy === true) {
    checks.push(recordReject('payload.impact', '未知/受损不得显示为零/健康/无异常（记录侧未知语义——§2.1/§0.4-4）'))
  }
  if ((FORBIDDEN_DECISION_SUBJECTS as readonly string[]).includes(parsed.data.payload.owner.trim().toLowerCase())) {
    checks.push(recordReject('payload.owner', '未知登记须有具名接收位置（框架/系统/平台/流程/daemon/监控/自动策略不可作 owner——§0.2-1）'))
  }
  return mergeOutcomes(...checks)
}
