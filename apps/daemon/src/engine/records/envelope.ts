/**
 * engine/records/envelope —— 记录草案 → contract 记录信封（形状唯一源＝packages/contract）
 *
 * 依据（实现单必须引文档章节号）：
 *   - docs/17-§2「记录族生产写面」段（相位×记录类型×写入者）；
 *   - docs/v2/11 §〇（信封 13 槽）/§0.4-5（幂等五元组）/§0.5（生效槽：pending/effective 必填
 *     effectiveTime）——本件**不复制**字段表，判定一律交 contract `ALL_RECORD_SCHEMAS`
 *     （v2/11 §一 74 类唯一登记处）与 `checkEffectiveSlotConsistency`；
 *   - docs/v2/14 §1.6（PORT-HIST 唯一写口）：本件只造信封，落库在 wire.ts→`hist.append`。
 *
 * 纪律：零 IO、确定性（同草案同信封）；契约校验前置＝写库前就给出 path 级 issues，
 * 不给 store 留「形状坏行」面（store 的 fail-closed 仍是最后一道）。
 */
import {
  ALL_RECORD_SCHEMAS,
  checkEffectiveSlotConsistency,
  issuesFromZod,
  type AllRecordType,
  type RecordEnvelope,
} from '@studio-next/contract/records'
import {
  RECORD_SCHEMA_REF,
  RECORD_SPEC_VERSION,
  RECORD_WRITTEN_BY,
  type RecordDraft,
  type RecordShapeFailure,
} from './types.ts'

/** 成信封入参（company 由装配面注入＝一进程一公司，草案不携公司标识） */
export interface EnvelopeContext {
  readonly company: string
}

/** 成信封结果：ok＝已过契约形状闸与生效槽一致性 */
export type EnvelopeOutcome =
  | { readonly ok: true; readonly envelope: RecordEnvelope<unknown> }
  | RecordShapeFailure

/**
 * 草案 → 信封（§0.5：pending/effective 时 `effectiveTime.from` 必填；缺省按 effective 落
 * 实际生效起点＝草案 producedAt——记录的是「已发生」相位事件，不冒充计划时点）。
 * 契约面零变更：recordType 不在 74 类登记集即拒（不新增类、不静默降级）。
 */
export function buildEnvelope(draft: RecordDraft, ctx: EnvelopeContext): EnvelopeOutcome {
  const schema = ALL_RECORD_SCHEMAS[draft.recordType as AllRecordType]
  if (schema === undefined) {
    return {
      ok: false,
      recordType: draft.recordType,
      code: 'record-shape-invalid',
      reason: `recordType=${draft.recordType} 不在 v2/11 §一 74 类登记集（形状唯一源=contract ALL_RECORD_SCHEMAS）`,
      issues: [{ path: 'recordType', message: `未登记记录类型：${draft.recordType}` }],
    }
  }
  const effectiveState = draft.effectiveState ?? 'effective'
  const envelope: RecordEnvelope<unknown> = {
    recordId: draft.recordId,
    recordType: draft.recordType as RecordEnvelope<unknown>['recordType'],
    schemaRef: RECORD_SCHEMA_REF,
    specVersion: RECORD_SPEC_VERSION,
    companyRef: ctx.company,
    producedAt: draft.producedAt,
    producer: { decidedBy: draft.decidedBy, writtenBy: RECORD_WRITTEN_BY },
    basisRefs: [],
    payload: draft.payload,
    effectiveState,
    effectiveTime: { from: draft.effectiveFrom ?? draft.producedAt },
    ...(draft.proofBoundary !== undefined ? { proofBoundary: draft.proofBoundary } : {}),
    ...(draft.idempotencyKey !== undefined
      ? { idempotencyKey: { ...draft.idempotencyKey, companyRef: ctx.company } }
      : {}),
  }
  const parsed = schema.safeParse(envelope)
  if (!parsed.success) {
    const issues = issuesFromZod(parsed.error)
    return {
      ok: false,
      recordType: draft.recordType,
      code: 'record-shape-invalid',
      reason: `记录形状不符 contract ${draft.recordType} 判据：${issues.map((i) => `${i.path}=${i.message}`).join('; ')}`,
      issues,
    }
  }
  const record = parsed.data as RecordEnvelope<unknown>
  const slot = checkEffectiveSlotConsistency(record)
  if (!slot.ok) {
    return {
      ok: false,
      recordType: draft.recordType,
      code: 'record-shape-invalid',
      reason: `生效槽不一致（§0.5）：${slot.issues.map((i) => `${i.path}=${i.message}`).join('; ')}`,
      issues: slot.issues,
    }
  }
  return { ok: true, envelope: record }
}
