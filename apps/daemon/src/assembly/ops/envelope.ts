/**
 * assembly/ops/envelope —— PORT-OPS 记录草案 → contract 记录信封（REC-WORK-18）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/11 §〇（记录信封：recordId/recordType/schemaRef/specVersion/companyRef/
 *     producedAt/producer/basisRefs/payload/effectiveState/effectiveTime/proofBoundary）、
 *     §0.5（生效槽：pending/effective 必填 effectiveTime）、§六 REC-WORK-18；
 *   - docs/v2/14 §1.8（PORT-OPS 请求形状；OPS 补形 A）、§1.6（PORT-HIST 唯一记录写口）；
 *   - docs/v2/10 §4.1（schemaRef/specVersion 引用串）；
 *   - docs/49「OPS 补形 A」（决定 A：补形状到 REC-WORK-18 必填面，不臆造版本、不记形状缺口）。
 *
 * 映射纪律：
 *   - 一切引用版本取自 `OpsStopRecord`（其值来自调用方显式提供的 `OpsRef`/`OpsRecordRef`）——
 *     本件不硬编码、不臆造 refVersion；
 *   - `basisRefs` 恒空：v14 records 列集无 basis_refs 列（store/hist:basis-refs-unlanded），
 *     授权引用留在请求面，不冒充已入记录（见 proofBoundary 的「不证明」段）；
 *   - 一事件一主 payload（REC-WORK-18 八字段）；请求侧 `reason`/`authorizationRef` 无记录槽，
 *     不塞进 payload（strictObject 拒收多余键）。
 */
import type { OpsRecordRef, OpsRef } from '@studio-next/contract'
import type { OpsStopRecord } from '../../control/ops/index.ts'

/** 冻结 schema 工件引用（v2/10 §4.1；仓库内记录工件统一口径，见 contract test fixtures） */
export const OPS_RECORD_SCHEMA_REF = { schemaId: 'studio-next.records.v2', schemaVersion: '1.0.0' } as const

/** 依循的 V2 规范版本（与 packages/contract/src/artifacts/generate.ts SPEC_VERSION 同值） */
export const OPS_RECORD_SPEC_VERSION = '2.0.0'

/** 写入路径名（producer.writtenBy：写路径与具名决定者分开——v2/11 §0.2-1） */
export const OPS_RECORD_WRITTEN_BY = 'daemon:assembly/ops'

/** REC-WORK-18 `effect_on_original`（不追认原动作、不等于恢复、不推广为常态——v2/11 §六） */
export const OPS_EFFECT_ON_ORIGINAL_TEXT = '不追认原动作、不等于恢复、不推广为常态'

/** REC-WORK-18 payload（字段名对齐 v2/11 §六；形状由 contract EmergencyStopPayloadSchema 判） */
export interface OpsEmergencyStopPayload {
  readonly trigger: string
  readonly boundary_ref: OpsRecordRef | null
  readonly actions_taken: readonly string[]
  readonly not_authorized: readonly string[]
  readonly evidence_preserved: readonly OpsRef[]
  readonly notified: readonly OpsRef[]
  readonly independent_review: { readonly position: string; readonly deadline: string; readonly conclusion: string }
  readonly effect_on_original: string
}

/**
 * 记录信封（结构与 contract `RecordEnvelope<OpsEmergencyStopPayload>` 同形；本件不新增
 * 记录类——REC-WORK-18 形状唯一源仍是 packages/contract/src/records/work-exec.ts）。
 */
export interface OpsStopEnvelope {
  readonly recordId: string
  readonly recordType: 'REC-WORK-18'
  readonly schemaRef: { readonly schemaId: string; readonly schemaVersion: string }
  readonly specVersion: string
  readonly companyRef: string
  readonly producedAt: string
  readonly producer: { readonly decidedBy: string; readonly writtenBy: string }
  readonly basisRefs: readonly OpsRef[]
  readonly payload: OpsEmergencyStopPayload
  readonly effectiveState: 'effective'
  readonly effectiveTime: { readonly from: string }
  readonly proofBoundary: string
}

/**
 * 具名决定者：person/control 取署名 actorRef（控制面位置具名）；
 * system 代写取 onBehalfOf（可还原决定人——SEC-FC-06），不把通道位充当决定者。
 */
function decidedByOf(record: OpsStopRecord): string {
  return record.signature.actorKind === 'system' ? record.signature.onBehalfOf : record.signature.actorRef
}

/** 证明边界（§0.7：证明什么/不证明什么；真实缺口逐条列，不以「已记录」一句覆盖） */
function proofBoundaryOf(record: OpsStopRecord): string {
  const base =
    '本记录证明止损/围栏请求已按 REC-WORK-18 登记（触发、边界、实际处置动作、未授权清单、保全物、通知对象、独立复核）；' +
    '不证明执行面已完成停止或围栏（outcome=unknown，执行确认以对账与独立复核为准）；不证明授权链（authorizationRef 属请求面，REC-WORK-18 无该槽）'
  return record.gaps.length === 0 ? base : `${base}；显式缺口：${record.gaps.join('；')}`
}

/**
 * OpsStopRecord → contract 记录信封。
 * 幂等由 PORT-HIST 按 recordId/幂等键判（同 id 同内容＝返回既有，不产生第二次副作用）；
 * 本函数纯映射、零 IO、确定性（同输入同输出——重放可判等）。
 */
export function opsStopEnvelope(record: OpsStopRecord): OpsStopEnvelope {
  return {
    recordId: record.recordId,
    recordType: 'REC-WORK-18',
    schemaRef: OPS_RECORD_SCHEMA_REF,
    specVersion: OPS_RECORD_SPEC_VERSION,
    companyRef: record.company,
    producedAt: record.at,
    producer: { decidedBy: decidedByOf(record), writtenBy: OPS_RECORD_WRITTEN_BY },
    // v14 列集缺口：basisRefs 非空即拒（不静默丢弃）——留空并显式登记在 proofBoundary
    basisRefs: [],
    payload: {
      trigger: record.trigger,
      boundary_ref: record.boundaryRef,
      actions_taken: record.actionsTaken,
      not_authorized: record.notAuthorized,
      evidence_preserved: record.evidencePreserved,
      notified: record.notified,
      independent_review: {
        position: record.review.position,
        deadline: record.review.due,
        conclusion: record.review.conclusion,
      },
      effect_on_original: OPS_EFFECT_ON_ORIGINAL_TEXT,
    },
    effectiveState: 'effective',
    effectiveTime: { from: record.at },
    proofBoundary: proofBoundaryOf(record),
  }
}
