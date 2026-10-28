/**
 * MEM 记忆族记录形状与判定件（REC-MEM-01..04 四类）——MIG-03 / IMPL-03-02
 *
 * 依据链：
 *   - v2/11 §十三（记忆条目/访问审计/处置决定/污染处置字段与不变量）；§1.12 MEM 族 4 类登记；
 *     §〇.7 证明边界（决定类）；§〇.6 枚举零重述
 *   - v2/09 ENU-63 记忆三域、ENU-64 个人记忆四子类、ENU-65 记忆处置操作（含「归档」）、
 *     ENU-66 访问结果、ENU-67 置信集（缺省＝未标即不合格）
 *   - v2/08 §三（三域唯一主表）/§3.2（处置授权）/§3.3（访问审计）/§3.4（污染处置）；
 *     v2/02 §八（个人记忆四子类）；v2/03 表 D 行 10/11（处置授权位置）；v2/04 §十一（工作终止三路分流）；
 *     v2/01 R-33（污染传播）/I-17
 *   - plan/05 IMPL-03-02
 *
 * 登记缺口（不臆造）：
 *   1. 「观察与解释之分」未给机器值集 → 双槽 {observation, interpretation} 显式分列（不新立枚举）。
 *   2. 处置凭证（三路分流）正文只给「归档/清除/转出」三路语义 → `disposal_evidence.route` 三值投影
 *      （归档/清除/转出，非新枚举语义），各路的接收确认/保留义务核对/留痕为条件槽。
 *   3. 污染痊愈判据指标未给机器值集 → 结构化三槽（撤回率/多轮后验/退化比较）。
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

// —— §1 记录类型登记（v2/11 §1.12：MEM 族 4 类） ——

/** v2/11 §1.12 MEM 记忆族 4 类（序即 §1.12 表序） */
export const MEM_RECORD_TYPES = ['REC-MEM-01', 'REC-MEM-02', 'REC-MEM-03', 'REC-MEM-04'] as const

export type MemRecordType = (typeof MEM_RECORD_TYPES)[number]

// —— §2 枚举投影（v2/09 主表） ——

/** ENU-63 记忆三域（三域唯一主表 v2/08 §三） */
export const MEMORY_DOMAINS = ['personal', 'work', 'corporate'] as const
export const MemoryDomainSchema = z.enum(MEMORY_DOMAINS)
export type MemoryDomain = (typeof MEMORY_DOMAINS)[number]

/** ENU-64 个人记忆四子类（仅个人域必填——治 V4-P1-1） */
export const PERSONAL_MEMORY_SUBTYPES = ['fact', 'experience', 'skill', 'commitment_relation'] as const
export const PersonalMemorySubtypeSchema = z.enum(PERSONAL_MEMORY_SUBTYPES)
export type PersonalMemorySubtype = (typeof PERSONAL_MEMORY_SUBTYPES)[number]

/** ENU-65 记忆处置操作（取值集含「归档」，与封存分立；三路分流＝归档/清除/转出） */
export const MEMORY_DISPOSAL_OPERATIONS = ['correct', 'erase', 'inherit', 'transfer_layer', 'seal', 'archive', 'transfer_out'] as const
export const MemoryDisposalOperationSchema = z.enum(MEMORY_DISPOSAL_OPERATIONS)
export type MemoryDisposalOperation = (typeof MEMORY_DISPOSAL_OPERATIONS)[number]

/** ENU-66 记忆访问结果（访问被拒也是审计事件） */
export const MEMORY_ACCESS_RESULTS = ['provided', 'denied', 'partial_provided'] as const
export const MemoryAccessResultSchema = z.enum(MEMORY_ACCESS_RESULTS)
export type MemoryAccessResult = (typeof MEMORY_ACCESS_RESULTS)[number]

/** ENU-67 置信集（`low`｜`medium`｜`high`；缺省＝未标即不合格） */
export const MEMORY_CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const
export const MemoryConfidenceSchema = z.enum(MEMORY_CONFIDENCE_LEVELS)
export type MemoryConfidence = (typeof MEMORY_CONFIDENCE_LEVELS)[number]

/** 三路分流凭证的路由（ENU-65 归档/清除/转出的程序侧投影——登记缺口 2） */
export const DISPOSAL_ROUTES = ['archive', 'erase', 'transfer_out'] as const
export const DisposalRouteSchema = z.enum(DISPOSAL_ROUTES)

// —— §3 REC-MEM-01 记忆条目（三域之一；记忆是历史的派生物，非证据） ——

export const MemoryEntryPayloadSchema = z.strictObject({
  domain: MemoryDomainSchema,
  /** 仅个人域必填（ENU-64） */
  personal_subtype: PersonalMemorySubtypeSchema.optional(),
  owner_scope: z.string().min(1),
  /** 来源引用（不得引用传闻或他工作结论——§十三） */
  source_refs: z.array(RecordRefSchema).min(1),
  /** 观察与解释之分（显式双槽——登记缺口 1） */
  observation_vs_interpretation: z.strictObject({
    observation: z.string().min(1),
    interpretation: z.string().min(1),
  }),
  formed_at: TimestampSchema,
  valid_at: TimestampSchema,
  review_at: TimestampSchema,
  /** ENU-67 置信集（必填：缺省＝未标即不合格） */
  confidence: MemoryConfidenceSchema,
  knowledge_scope: z.string().min(1),
  /** 修正世系（保留原文与理由——不删除历史） */
  correction_lineage: z.array(
    z.strictObject({ corrected_ref: RecordRefSchema, original_preserved: z.literal(true), reason: z.string().min(1) }),
  ),
  disputed: z.boolean(),
})

export type MemoryEntryPayload = z.infer<typeof MemoryEntryPayloadSchema>
export const MemoryEntryRecordSchema = recordEnvelopeSchema(MemoryEntryPayloadSchema, 'REC-MEM-01')

/** REC-MEM-01 判定输入（传闻写入／当作证据／与可核验记录冲突未标） */
export interface MemoryEntryContext {
  /** 来源为传闻或未经核验的推断（不得写入——§十三） */
  rumorSource?: boolean
  /** 以记忆替代证据（E-12 判负） */
  usedAsEvidenceStandalone?: boolean
  /** 与可核验记录冲突却未标 disputed（以记录为准并标注不确定——§十三） */
  conflictsWithRecordUnmarked?: boolean
}

// —— §4 REC-MEM-02 访问审计（谁为何读了哪域哪些条目、用到哪里） ——

export const MemoryAccessAuditPayloadSchema = z.strictObject({
  /** 任职/位置/程序三者分开 */
  who: z.strictObject({
    holder_ref: ObjectRefSchema.nullable(),
    position_ref: ObjectRefSchema.nullable(),
    procedure_ref: ObjectRefSchema.nullable(),
  }),
  when: TimestampSchema,
  /** 为何目的、用于哪件工作或决定 */
  purpose: z.strictObject({ why: z.string().min(1), for_work_or_decision_ref: RecordRefSchema }),
  /** 读了哪域哪些条目 */
  layer_and_entries: z.strictObject({
    domain: MemoryDomainSchema,
    entry_refs: z.array(RecordRefSchema).min(1),
  }),
  /** 授权依据与到期 */
  authority_ref: z.strictObject({ basis_ref: RecordRefSchema, expires_at: TimestampSchema }),
  /** ENU-66（访问被拒也是审计事件） */
  result: MemoryAccessResultSchema,
  /** 知悉范围变化须重新审批（scope_change 必载审批引用） */
  scope_change: z.strictObject({ new_scope: z.string().min(1), reapproval_ref: RecordRefSchema }).optional(),
})

export type MemoryAccessAuditPayload = z.infer<typeof MemoryAccessAuditPayloadSchema>
export const MemoryAccessAuditRecordSchema = recordEnvelopeSchema(MemoryAccessAuditPayloadSchema, 'REC-MEM-02')

/** REC-MEM-02 判定输入（是否只统计次数／知悉范围变化未重审） */
export interface MemoryAccessAuditContext {
  countsOnly?: boolean
  scopeChangedWithoutReapproval?: boolean
}

// —— §5 REC-MEM-03 处置决定（修正/清除/继承/转层/封存/归档/转出的授权与凭证） ——

/** 授权列表（转层时源层与目标层双授权必填，缺一即拒——L3E-10） */
export const DisposalAuthorizationSchema = z.strictObject({
  layer: z.string().min(1),
  authorized_by: z.string().min(1),
})

/** 三路分流凭证（归档/清除/转出；技术校验不替代接受——L3E-08） */
export const DisposalEvidenceSchema = z.strictObject({
  route: DisposalRouteSchema,
  /** 归档：归档位置＋接收确认 */
  archive_location: z.string().min(1).optional(),
  acceptance_ref: RecordRefSchema.optional(),
  /** 清除：保留义务核对＋留痕 */
  retention_check: z.string().min(1).optional(),
  trail_ref: RecordRefSchema.optional(),
  /** 转出/转层：转层字段 */
  layer_fields: z.array(z.string().min(1)).optional(),
})

export const MemoryDisposalPayloadSchema = z.strictObject({
  /** ENU-65 处置操作（含「归档」；三路分流各有凭证） */
  operation: MemoryDisposalOperationSchema,
  target_entries: z.array(RecordRefSchema).min(1),
  /** `[{layer, authorized_by}]`——转层时源层与目标层双授权必填（缺一即拒） */
  authorizations: z.array(DisposalAuthorizationSchema).min(1),
  /** 理由、影响范围、不可恢复后果告知 */
  reason_and_impact: z.strictObject({
    reason: z.string().min(1),
    impact_scope: z.string().min(1),
    irrecoverable_notice: z.string().min(1),
  }),
  /** 因保留义务/审计不得清除的部分 */
  retained_obligations: z.array(z.string().min(1)),
  disposal_evidence: DisposalEvidenceSchema,
  /** 通知对象；原始来源与外部副本可能仍存在的事实（不消灭历史——§十三） */
  notice: z.strictObject({ notified: z.array(ObjectRefSchema).min(1), residue_statement: z.string().min(1) }),
})

export type MemoryDisposalPayload = z.infer<typeof MemoryDisposalPayloadSchema>
export const MemoryDisposalRecordSchema = recordEnvelopeSchema(MemoryDisposalPayloadSchema, 'REC-MEM-03')

/** REC-MEM-03 判定输入（是否清除受保护记录／转层单授权／恢复出厂式删除） */
export interface MemoryDisposalContext {
  /** 借记忆清除消灭责任记录/承诺/证据/历史/权利相关信息/审计线索（§十三 判负） */
  clearsProtectedRecords?: boolean
  /** 恢复出厂式删除、停索引、丢弃向量库（不构成合法结清——§十三） */
  factoryReset?: boolean
}

// —— §6 REC-MEM-04 污染处置（隔离、传播半径追溯、批量标记、痊愈判据） ——

export const MemoryContaminationPayloadSchema = z.strictObject({
  /** 错误经验/同源盲点/被污染规则 */
  contaminated_entries: z.array(RecordRefSchema).min(1),
  /** 隔离来源（不得先删后查——§十三） */
  isolation: z.strictObject({ source: z.string().min(1), method: z.string().min(1) }),
  /** 沿引用链标定受影响范围：哪些决定、工作、下游记忆引用过 */
  propagation_radius: z.strictObject({
    affected_decisions: z.array(RecordRefSchema).min(1),
    affected_works: z.array(RecordRefSchema),
    downstream_memories: z.array(RecordRefSchema),
  }),
  /** 受影响决定的批量标记与责任（按新证据标准批量重开→REC-WORK-11，限定影响范围） */
  affected_decisions: z.strictObject({
    batch_marked: z.boolean(),
    reopen_scope_ref: RecordRefSchema.optional(),
  }),
  /** 痊愈判据：撤回率、多轮后验、退化比较（不得仅删除最近一条错误经验宣布痊愈） */
  recovery_criteria: z.strictObject({
    withdrawal_rate: z.string().min(1),
    multi_round_posterior: z.array(z.string().min(1)).min(1),
    degradation_comparison: z.string().min(1),
  }),
})

export type MemoryContaminationPayload = z.infer<typeof MemoryContaminationPayloadSchema>
export const MemoryContaminationRecordSchema = recordEnvelopeSchema(MemoryContaminationPayloadSchema, 'REC-MEM-04')

/** REC-MEM-04 判定输入（先删后查／单删即宣布痊愈） */
export interface MemoryContaminationContext {
  deletedBeforeInvestigation?: boolean
  recoveryBySingleDeletion?: boolean
}

// —— §7 形状闸（四类） ——

export const MEM_RECORD_SCHEMAS: Readonly<Record<MemRecordType, z.ZodType>> = {
  'REC-MEM-01': MemoryEntryRecordSchema,
  'REC-MEM-02': MemoryAccessAuditRecordSchema,
  'REC-MEM-03': MemoryDisposalRecordSchema,
  'REC-MEM-04': MemoryContaminationRecordSchema,
}

// —— §8 判定件（纯函数；不抛错） ——

/**
 * REC-MEM-01 判定（§十三 不变量）：
 *   ① 个人域必填 personal_subtype（四子类）；② 传闻与未验证推断不得写入；
 *   ③ 记忆可指向证据但不能替代（E-12）；④ 与可核验记录冲突以记录为准并标注不确定；
 *   ⑤ 置信必标（缺省＝不合格）；⑥ 修正保留原文（original_preserved 恒真）。
 */
export function validateMemoryEntry(record: unknown, ctx: MemoryEntryContext = {}): RecordValidationOutcome {
  const parsed = MemoryEntryRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (payload.domain === 'personal' && payload.personal_subtype === undefined) {
    checks.push(recordReject('payload.personal_subtype', '个人域必填个人记忆四子类（V4-P1-1——§十三）'))
  }
  if (ctx.rumorSource === true) {
    checks.push(recordReject('payload.source_refs', '传闻与未验证推断不得写入记忆（§十三）'))
  }
  if (ctx.usedAsEvidenceStandalone === true) {
    checks.push(recordReject('recordType', '记忆是历史的派生物：可指向证据但不能替代（E-12——§十三）'))
  }
  if (ctx.conflictsWithRecordUnmarked === true && !payload.disputed) {
    checks.push(recordReject('payload.disputed', '与可核验记录冲突以记录为准并标注不确定（§十三）'))
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-MEM-02 判定（§十三 不变量）：每次访问留痕（只统计次数或命中率不算访问记录）；
 * 知悉范围变化须重新审批；访问被拒也是审计事件（denied 合法，不因被拒拒写）。
 */
export function validateMemoryAccessAudit(record: unknown, ctx: MemoryAccessAuditContext = {}): RecordValidationOutcome {
  const parsed = MemoryAccessAuditRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (ctx.countsOnly === true) {
    checks.push(recordReject('payload.layer_and_entries', '只统计次数或命中率不算访问记录（每次访问须逐条留痕——§十三）'))
  }
  if (ctx.scopeChangedWithoutReapproval === true && payload.scope_change === undefined) {
    checks.push(recordReject('payload.scope_change', '知悉范围变化须重新审批（§十三）'))
  }
  const who = payload.who
  if (who.holder_ref === null && who.position_ref === null && who.procedure_ref === null) {
    checks.push(recordReject('payload.who', '访问主体须至少落在任职/位置/程序之一（三者分开记——§十三）'))
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-MEM-03 判定（§十三 不变量）：
 *   ① 责任记录、承诺、证据、历史、权利相关信息与审计线索不得借记忆清除消灭；
 *   ② 转层须源层与目标层双授权（缺一即拒——L3E-10）；
 *   ③ 三路分流凭证齐备（归档位置＋接收确认／保留义务核对＋留痕／转层字段＋接收确认）；
 *      技术校验不替代接受（L3E-08）；④ 恢复出厂式删除不构成合法结清；
 *   ⑤ 通知对象与外部副本事实必载（不消灭历史）。
 */
export function validateMemoryDisposal(record: unknown, ctx: MemoryDisposalContext = {}): RecordValidationOutcome {
  const parsed = MemoryDisposalRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const evidence = payload.disposal_evidence
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (ctx.clearsProtectedRecords === true && payload.operation === 'erase') {
    checks.push(recordReject('payload.operation', '责任记录/承诺/证据/历史/权利信息/审计线索不得借记忆清除消灭（§十三）'))
  }
  if (ctx.factoryReset === true) {
    checks.push(recordReject('payload.disposal_evidence', '恢复出厂式删除、停索引、丢弃向量库不构成合法结清（§十三）'))
  }
  if (payload.operation === 'transfer_layer') {
    const layers = new Set(payload.authorizations.map((entry) => entry.layer))
    if (layers.size < 2) {
      checks.push(recordReject('payload.authorizations', '转层须源层与目标层双授权（缺一即拒——L3E-10）'))
    }
  }
  if (payload.operation === 'archive' && evidence.route !== 'archive') {
    checks.push(recordReject('payload.disposal_evidence.route', '归档操作须给归档凭证（route=archive——§十三）'))
  }
  if (payload.operation === 'erase' && evidence.route !== 'erase') {
    checks.push(recordReject('payload.disposal_evidence.route', '清除操作须给清除凭证（route=erase——§十三）'))
  }
  if ((payload.operation === 'transfer_out' || payload.operation === 'transfer_layer') && evidence.route !== 'transfer_out') {
    checks.push(recordReject('payload.disposal_evidence.route', '转出/转层须给转出凭证（route=transfer_out——§十三）'))
  }
  if (evidence.route === 'archive' && (evidence.archive_location === undefined || evidence.acceptance_ref === undefined)) {
    checks.push(recordReject('payload.disposal_evidence', '归档须有归档位置与接收确认（技术校验不替代接受——L3E-08）'))
  }
  if (evidence.route === 'erase' && (evidence.retention_check === undefined || evidence.trail_ref === undefined)) {
    checks.push(recordReject('payload.disposal_evidence', '清除须有保留义务核对与留痕（清除留痕，不消灭问责——§十三）'))
  }
  if (evidence.route === 'transfer_out' && (evidence.layer_fields === undefined || evidence.acceptance_ref === undefined)) {
    checks.push(recordReject('payload.disposal_evidence', '转出须有转层字段与接收确认（§十三）'))
  }
  if (payload.notice.residue_statement.trim().length === 0) {
    checks.push(recordReject('payload.notice.residue_statement', '须载明原始来源与外部副本可能仍存在的事实（不消灭历史——§十三）'))
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-MEM-04 判定（§十三/R-33）：
 *   ① 不得先删后查（隔离来源必载）；② 沿引用链标定传播半径，受影响决定批量标记与重开；
 *   ③ 痊愈判据不得仅删除最近一条错误经验（须撤回率/多轮后验/退化比较）；
 *   ④ 指标提升可能来自任务结构变化或判据被改（R-8），不得据此宣布痊愈。
 */
export function validateMemoryContamination(record: unknown, ctx: MemoryContaminationContext = {}): RecordValidationOutcome {
  const parsed = MemoryContaminationRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (ctx.deletedBeforeInvestigation === true) {
    checks.push(recordReject('payload.isolation', '污染处置不得先删后查（隔离来源须先于处置——R-33/§十三）'))
  }
  if (ctx.recoveryBySingleDeletion === true) {
    checks.push(recordReject('payload.recovery_criteria', '不得仅删除最近一条错误经验宣布痊愈（须撤回率/多轮后验/退化比较——§十三）'))
  }
  if (payload.propagation_radius.affected_decisions.length === 0) {
    checks.push(recordReject('payload.propagation_radius', '须沿引用链标定受影响范围（受影响决定逐项登记——§十三）'))
  }
  if (!payload.affected_decisions.batch_marked) {
    checks.push(recordReject('payload.affected_decisions.batch_marked', '受影响决定须批量标记并按新证据标准批量重开（REC-WORK-11——§十三）'))
  }
  return mergeOutcomes(...checks)
}
