/**
 * OBS 观察族记录形状与判定件（REC-OBS-01..04 四类）——MIG-03 / IMPL-03-02
 *
 * 依据链：
 *   - v2/11 §十二（投影快照/监控故障/持续观察/观察结束字段与不变量）；§1.11 OBS 族 4 类登记；
 *     §〇.7 证明边界；§十二「观察面→记录组映射」（MON-01..15 全 REC 化）
 *   - v2/09 ENU-52 投影六态、ENU-59 监控故障类别、ENU-60 完整性（`view_completeness` 专用命名）
 *   - v2/08 §4.1/4.2（投影与观察面清单）、§4.4（监控故障）、§5.3（观察结束）、§3.3（访问审计）；
 *     v2/04 §八（迟到副作用与孤儿执行体的观察义务）；v2/01 I-11（无终局的持续观察本身是异常）
 *   - plan/05 IMPL-03-02
 *
 * 登记缺口（不臆造）：
 *   1. REC-OBS-02 `display_effect`（未知/受损）未在 v2/09 单列 → 按 §十二 正文二元投影为
 *      `unknown`／`damaged`（两值，不扩集）。
 *   2. REC-OBS-01 `state_assignments` 的「面/指标」键无封闭清单（MON-01..15 是观察面主表）→
 *      以非空串键承载，值内 `state` 走 ENU-52 六态。
 *
 * 纪律：只写可擦除语法；相对 import 带 `.ts`；类型导入 `import type`；不定义族外枚举字面量。
 */
import { z } from 'zod'
import { CompletenessSchema } from './common.ts'
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

// —— §1 记录类型登记（v2/11 §1.11：OBS 族 4 类） ——

/** v2/11 §1.11 OBS 观察族 4 类（序即 §1.11 表序） */
export const OBS_RECORD_TYPES = ['REC-OBS-01', 'REC-OBS-02', 'REC-OBS-03', 'REC-OBS-04'] as const

export type ObsRecordType = (typeof OBS_RECORD_TYPES)[number]

// —— §2 枚举投影（v2/09 主表） ——

/** ENU-52 投影六态（「陈旧」「冲突」由此承载并可复核） */
export const PROJECTION_VIEW_STATES = ['observed', 'derived', 'unknown', 'stale', 'conflicted', 'gapped'] as const
export const ProjectionViewStateSchema = z.enum(PROJECTION_VIEW_STATES)
export type ProjectionViewState = (typeof PROJECTION_VIEW_STATES)[number]

/** ENU-59 监控故障类别（含陈旧视图、未裁冲突等扩展类别） */
export const MONITORING_FAILURE_KINDS = [
  'collection_interrupted', 'coverage_gap', 'projection_failed', 'source_unreachable', 'cursor_broken', 'stale_view', 'conflict_unresolved',
] as const
export const MonitoringFailureKindSchema = z.enum(MONITORING_FAILURE_KINDS)
export type MonitoringFailureKind = (typeof MONITORING_FAILURE_KINDS)[number]

/** 受影响视图的显示效果（§十二 二元投影：未知/受损；登记缺口 1） */
export const DISPLAY_EFFECTS = ['unknown', 'damaged'] as const
export const DisplayEffectSchema = z.enum(DISPLAY_EFFECTS)

// —— §3 REC-OBS-01 投影快照（只读视图；非权威 DOM-05） ——

export const ProjectionSnapshotPayloadSchema = z.strictObject({
  view_identity: z.strictObject({ view_id: z.string().min(1), projection_rule_version: z.string().min(1) }),
  /** 权威来源（端点＋代次——须能解析到 REC-AUTH-07） */
  authoritative_source: z.strictObject({
    endpoint: ObjectRefSchema,
    generation: z.number().int().nonnegative(),
    activation_ref: RecordRefSchema,
  }),
  source_cursor: z.string().min(1),
  generated_at: TimestampSchema,
  /** 业务时间窗（非生效窗口——§0.5） */
  data_valid_window: z.strictObject({ from: TimestampSchema, to: TimestampSchema }),
  knowledge_scope: z.array(z.string().min(1)).min(1),
  /** 本类型专用命名（不得与 event/harvest_completeness 互替——ENU-60） */
  view_completeness: CompletenessSchema,
  /** 逐观察面/逐指标状态槽（面或指标→六态之一＋依据＋最后可信游标——治 L3E-09） */
  state_assignments: z.record(
    z.string().min(1),
    z.strictObject({
      state: ProjectionViewStateSchema,
      basis: z.string().min(1),
      last_trusted_cursor: z.string().min(1),
    }),
  ),
  /** 说明性（降级） */
  state_legend: z.string().min(1).optional(),
})

export type ProjectionSnapshotPayload = z.infer<typeof ProjectionSnapshotPayloadSchema>
export const ProjectionSnapshotRecordSchema = recordEnvelopeSchema(ProjectionSnapshotPayloadSchema, 'REC-OBS-01')

/** REC-OBS-01 判定输入（是否反向改写历史／跨公司泄漏／全绿冒充健康） */
export interface ProjectionSnapshotContext {
  /** 投影被用作写路径或反向改写历史（只读投影不得成为第二事实源——§十二） */
  writesHistory?: boolean
  /** 多公司视图未按公司与知悉范围隔离 */
  crossCompanyLeak?: boolean
  /** 完整性非 complete 却把逐面状态全标 observed（面板全绿冒充健康） */
  claimsAllHealthy?: boolean
}

// —— §4 REC-OBS-02 监控故障（一等观察，不是沉默） ——

export const MonitoringFailurePayloadSchema = z.strictObject({
  failure_kind: MonitoringFailureKindSchema,
  occurred_at: TimestampSchema,
  discovered_at: TimestampSchema,
  affected_views: z.array(z.string().min(1)).min(1),
  last_trusted: z.strictObject({ cursor: z.string().min(1), at: TimestampSchema }),
  /** 受影响视图必须显示未知或受损（不得留空、不得显示为零、不得沿用最后健康快照） */
  display_effect: DisplayEffectSchema,
  recovery_at: TimestampSchema.nullable(),
  root_cause_class: z.string().min(1),
  /** 据投影限制新动作须留授权依据与具名判断主体（§十二） */
  action_restriction: z
    .strictObject({
      authorization_basis: RecordRefSchema,
      decided_by: z.string().min(1),
      scope: z.string().min(1),
      term: TimestampSchema,
      review_point: TimestampSchema,
    })
    .optional(),
})

export type MonitoringFailurePayload = z.infer<typeof MonitoringFailurePayloadSchema>
export const MonitoringFailureRecordSchema = recordEnvelopeSchema(MonitoringFailurePayloadSchema, 'REC-OBS-02')

/** REC-OBS-02 判定输入（受影响视图是否被显示为零/健康/沿用旧快照） */
export interface MonitoringFailureContext {
  displaysZeroOrHealthy?: boolean
  /** 以最后健康快照填充视图（不得——§十二） */
  showsLastHealthySnapshot?: boolean
}

// —— §5 REC-OBS-03 持续观察记录（迟到副作用/孤儿执行体/残留） ——

export const ContinuousObservationPayloadSchema = z.strictObject({
  /** 被观察对象（迟到副作用/孤儿执行体/残留） */
  subject: z.strictObject({ kind: z.string().min(1), ref: ObjectRefSchema }),
  /** 观察窗口与最后可信观察点（事前声明） */
  window: z.strictObject({
    declared_from: TimestampSchema,
    declared_to: TimestampSchema,
    last_trusted_observation_at: TimestampSchema,
  }),
  /** 所见：活性信号／凭据状态对照 REC-EVD-RVK 后代清单／独立发现通道材料 */
  sightings: z.strictObject({
    activity_signals: z.array(z.strictObject({ signal: z.string().min(1), at: TimestampSchema, material_ref: ObjectRefSchema })),
    credential_status_vs_rvk: z.array(z.string().min(1)),
    /** 独立发现通道（不依赖执行体自报——v2/08 §五） */
    independent_discovery_channels: z.array(z.strictObject({ channel: z.string().min(1), material_ref: ObjectRefSchema })).min(1),
  }),
  /** 不可达或不可观测的执行体按「未知」处理，不得记为「已停止」 */
  uncertainty: z.strictObject({ reachable: z.boolean(), treatment: z.string().min(1) }),
  escalation_flag: z.boolean(),
})

export type ContinuousObservationPayload = z.infer<typeof ContinuousObservationPayloadSchema>
export const ContinuousObservationRecordSchema = recordEnvelopeSchema(ContinuousObservationPayloadSchema, 'REC-OBS-03')

/** REC-OBS-03 判定输入（不可达是否被记为「已停止」／观察主体是否具名） */
export interface ContinuousObservationContext {
  treatedAsStoppedWhileUnreachable?: boolean
}

// —— §6 REC-OBS-04 观察结束决定（有据结束＋残留风险登记，非遗忘） ——

export const ObservationClosurePayloadSchema = z.strictObject({
  /** →REC-OBS-03 */
  watch_ref: RecordRefSchema,
  /** 窗口内所见与终局依据 */
  basis: z.array(z.strictObject({ sighting: z.string().min(1), terminal_basis: z.string().min(1) })).min(1),
  /** 残留风险登记（观察结束不是遗忘） */
  residual_risk: z.array(z.string().min(1)).min(1),
  /** 再触发条件（同类副作用再现时按新事项受理并回查原观察记录） */
  retrigger_terms: z.string().min(1),
})

export type ObservationClosurePayload = z.infer<typeof ObservationClosurePayloadSchema>
export const ObservationClosureRecordSchema = recordEnvelopeSchema(ObservationClosurePayloadSchema, 'REC-OBS-04')

// —— §7 形状闸（四类） ——

export const OBS_RECORD_SCHEMAS: Readonly<Record<ObsRecordType, z.ZodType>> = {
  'REC-OBS-01': ProjectionSnapshotRecordSchema,
  'REC-OBS-02': MonitoringFailureRecordSchema,
  'REC-OBS-03': ContinuousObservationRecordSchema,
  'REC-OBS-04': ObservationClosureRecordSchema,
}

// —— §8 判定件（纯函数；不抛错） ——

/**
 * REC-OBS-01 判定（§十二 不变量）：
 *   ① 只读投影不得反向改写历史、不得成为第二事实源或隐蔽写路径；
 *   ② 多公司视图按公司与知悉范围隔离；③ 面板全绿不得冒充健康（六态逐面承载，缺项不得留白）；
 *   ④ 权威来源须解析到 REC-AUTH-07（端点＋代次）。
 */
export function validateProjectionSnapshot(record: unknown, ctx: ProjectionSnapshotContext = {}): RecordValidationOutcome {
  const parsed = ProjectionSnapshotRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (ctx.writesHistory === true) {
    checks.push(recordReject('recordType', '只读投影不得反向改写历史、不得成为第二事实源或隐蔽写路径（§十二）'))
  }
  if (ctx.crossCompanyLeak === true) {
    checks.push(recordReject('payload.knowledge_scope', '多公司视图须按公司与知悉范围隔离（§十二）'))
  }
  if (Object.keys(payload.state_assignments).length === 0) {
    checks.push(recordReject('payload.state_assignments', '逐面/逐指标状态槽不得为空（缺项留白＝面板全绿冒充健康——§十二/L3E-09）'))
  }
  if (ctx.claimsAllHealthy === true && payload.view_completeness !== 'complete') {
    checks.push(recordReject('payload.view_completeness', '完整性非 complete 时不得把逐面状态全标 observed（未知显示为零即判负——§十二）'))
  }
  if (payload.authoritative_source.activation_ref.refType !== 'REC-AUTH-07') {
    checks.push(recordReject('payload.authoritative_source.activation_ref.refType', '权威来源须能解析到 REC-AUTH-07（端点＋代次——§十二）'))
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-OBS-02 判定（§十二 不变量）：监控故障是一等观察不是沉默；
 * 受影响视图必须显示「未知/受损」之一，不得留空、显示为零或沿用最后健康快照。
 */
export function validateMonitoringFailure(record: unknown, ctx: MonitoringFailureContext = {}): RecordValidationOutcome {
  const parsed = MonitoringFailureRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (payload.affected_views.length === 0) {
    checks.push(recordReject('payload.affected_views', '监控故障须明示受影响视图（不得沉默——§十二）'))
  }
  if (ctx.displaysZeroOrHealthy === true) {
    checks.push(recordReject('payload.display_effect', '受影响视图不得显示为零/健康（须显示未知或受损——§十二）'))
  }
  if (ctx.showsLastHealthySnapshot === true) {
    checks.push(recordReject('payload.last_trusted', '受影响视图不得沿用最后健康快照（须显示未知/受损——§十二）'))
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-OBS-03 判定（§十二 不变量）：
 *   ① 观察主体具名（由终止/撤回决定指定；未指定＝保留承载，不得写「框架/公司」）；
 *   ② 不可达或不可观测的执行体按「未知」处理，不得记为「已停止」；
 *   ③ 独立发现通道不得依赖执行体自报；④ 观察窗口事前声明。
 */
export function validateContinuousObservation(record: unknown, ctx: ContinuousObservationContext = {}): RecordValidationOutcome {
  const parsed = ContinuousObservationRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (ctx.treatedAsStoppedWhileUnreachable === true) {
    checks.push(recordReject('payload.uncertainty', '不可达或不可观测的执行体按「未知」处理，不得记为「已停止」（§十二/§5.3）'))
  }
  if (Date.parse(payload.window.declared_to) < Date.parse(payload.window.declared_from)) {
    checks.push(recordReject('payload.window', '观察窗口须事前声明且终点不早于起点（§十二）'))
  }
  if (payload.sightings.independent_discovery_channels.length === 0) {
    checks.push(recordReject('payload.sightings.independent_discovery_channels', '所见须含独立发现通道材料（不依赖执行体自报——§十二）'))
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-OBS-04 判定（§十二 不变量）：观察结束不是遗忘——须有据、须登记残留风险与再触发条件；
 * 无终局的持续观察本身是异常（走强制出口）。
 */
export function validateObservationClosure(record: unknown, ctx: { endedWithoutBasis?: boolean } = {}): RecordValidationOutcome {
  const parsed = ObservationClosureRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (payload.watch_ref.refType !== 'REC-OBS-03') {
    checks.push(recordReject('payload.watch_ref.refType', '观察结束决定须引 REC-OBS-03 持续观察记录（§十二）'))
  }
  if (ctx.endedWithoutBasis === true) {
    checks.push(recordReject('payload.basis', '观察结束不是遗忘：须有窗口内所见与终局依据（§十二）'))
  }
  if (payload.retrigger_terms.trim().length === 0) {
    checks.push(recordReject('payload.retrigger_terms', '须登记再触发条件（同类副作用再现时按新事项受理——§十二）'))
  }
  return mergeOutcomes(...checks)
}
