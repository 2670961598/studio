/**
 * PORT-EVD 产物与证据 —— 收割、证据项、八要素包、价值/事后审计、吊销记录
 * （docs/v2/05 §四；签名 docs/v2/14 §1.6；证据对象 docs/v2/08 §一）
 *
 * 必须拒绝：日志/交付方自述替代实际结果（`HarvestBatch.completeness` 三态显式，
 *   不得以「有输出」冒充完整）；交付方单独宣布证据充分（`PackageRef.
 *   eightElementComplete` 只是形状完整，充分性归验收/审计位置）；
 *   收记录冒充收草案（`registerItem` 只收 `EvidenceItemDraft`，记录写入归 PORT-HIST）；
 *   事后审计/价值判断缺独立性（`independent` 必填，`judgedBy` 不得是交付方）。
 * 幂等键：收割＝（出工段×采集区间）。零实现、零 IO；收割只读材料目录。
 */
import type { SegmentRef } from './exec.ts'
import type {
  CallContext,
  CallerRef,
  PortResult,
  ProofBoundary,
  ReadContext,
  VersionRef,
} from './def.ts'

/** 端口名常量 */
export const PORT_EVD = 'PORT-EVD' as const

/** 采集区间（闭开区间由实现校验；只承载时间串） */
export interface Window {
  readonly from: string
  readonly to: string
}

/** 完整性三态（值集唯一主表 v2/09 ENU-60；三字段共用，不互替） */
export type Completeness = 'complete' | 'incomplete' | 'unknown'

/** 收割批次（REC-EVD-01）：幂等键＝（出工段×采集区间）；`deduped` 同键同内容 */
export interface HarvestBatch {
  readonly segment: SegmentRef
  readonly window: Window
  readonly items: readonly ItemRef[]
  readonly completeness: Completeness
  readonly deduped: boolean
  readonly harvestedAt: string
}

/**
 * 八要素（EVD-ELM-01..08，唯一主表 v2/08 §1.2）：权源/输入/行动/验收对象/
 * 自检/外部反馈/代价/未决。键名是本端口对八要素的稳定承载名，不重定义语义。
 */
export type EvidenceElementId =
  | 'authority'
  | 'input'
  | 'action'
  | 'acceptance_object'
  | 'self_check'
  | 'external_feedback'
  | 'cost'
  | 'open_items'

/** 证据要素三态（值集唯一主表 v2/09 ENU-50）：不适用须记理由与判者 */
export type EvidenceElementState = 'present' | 'not_applicable' | 'missing'

export interface EvidenceElement {
  readonly id: EvidenceElementId
  readonly state: EvidenceElementState
  readonly refs: readonly string[]
  readonly reason?: string
}

/** 字节摘要三态（值集唯一主表 v2/09 ENU-61） */
export type ByteDigestState = 'present' | 'unknown' | 'not_collected'

/** 证据项草案（REC-EVD-02）：收草案不收记录——落记录由 PORT-HIST.append 完成 */
export interface EvidenceItemDraft {
  readonly workRef: string
  readonly element: EvidenceElementId
  readonly sourceKind: string
  readonly sourceRef: string
  readonly byteDigestState: ByteDigestState
  readonly proofBoundary: ProofBoundary
  readonly recordedBy: CallerRef
  readonly independentOfDeliverer: boolean
}

export interface ItemRef {
  readonly recordId: string
  readonly version: number
  readonly element: EvidenceElementId
}

/** 证据包草案（REC-EVD-03）：八要素全键必填（Record 键集不可缺省） */
export interface PackageDraft {
  readonly workRef: string
  readonly elements: Readonly<Record<EvidenceElementId, EvidenceElement>>
  readonly assembledBy: CallerRef
  readonly proofBoundary: ProofBoundary
  readonly expected?: VersionRef
}

/**
 * 证据包引用。`eightElementComplete` 只证形状（八键均有状态），不证实质充分；
 * 充分性判定归验收/事后审计位置（v2/04 §六、v2/08 §1.1）。
 */
export interface PackageRef {
  readonly recordId: string
  readonly version: number
  readonly eightElementComplete: boolean
}

/** 价值结论（值集唯一主表 v2/09 ENU-54） */
export type ValueVerdict = 'positive' | 'negative' | 'neutral' | 'value_unknown'

/** 四本账（值集唯一主表 v2/09 ENU-55）：不得压成总分 */
export type ValueAccount =
  | 'artifact_account'
  | 'state_account'
  | 'impact_account'
  | 'cost_account'

/** 价值评估（REC-EVD-04）：`independent:true` 才可作验收/审计输入 */
export interface ValueAssessmentDraft {
  readonly workRef: string
  readonly verdict: ValueVerdict
  readonly accounts: Readonly<Record<ValueAccount, string>>
  readonly judgedBy: CallerRef
  readonly independent: true
  readonly proofBoundary: ProofBoundary
  readonly expected?: VersionRef
}

/** 事后审计结论集（值集唯一主表 v2/09 ENU-51；禁用验收四值） */
export type PostAuditConclusion = 'no_violation' | 'violation_found' | 'insufficient_evidence'

/** 事后审计（REC-EVD-05）：审计者独立于交付方；结论不得复用验收四值 */
export interface PostAuditDraft {
  readonly workRef: string
  readonly conclusion: PostAuditConclusion
  readonly auditor: CallerRef
  readonly independent: true
  readonly basisRefs: readonly [string, ...string[]]
  readonly proofBoundary: ProofBoundary
}

/** 停用证据三选一（值集唯一主表 v2/09 ENU-130） */
export type RevocationEvidenceKind =
  | 'revocation_receipt'
  | 'injection_stop_confirm'
  | 'fence_rejection_record'

/** 吊销记录（REC-EVD-RVK）：`judgedBy`＋独立性必填 */
export interface RevocationDraft {
  readonly grantRef: string
  readonly evidenceKind: RevocationEvidenceKind
  readonly evidenceRef: string
  readonly judgedBy: CallerRef
  readonly independent: true
  readonly reason: string
}

/** 证据族记录引用（价值/审计/吊销共用） */
export interface EvidenceRecordRef {
  readonly recordId: string
  readonly version: number
}

/** 端口接口：收割/收草案/组包/评估/审计/吊销 */
export interface EvidencePort {
  harvest(seg: SegmentRef, window: Window, ctx: CallContext): PortResult<HarvestBatch>
  registerItem(d: EvidenceItemDraft, ctx: CallContext): PortResult<ItemRef>
  assemblePackage(d: PackageDraft, ctx: CallContext): PortResult<PackageRef>
  assessValue(d: ValueAssessmentDraft, ctx: CallContext): PortResult<EvidenceRecordRef>
  postAudit(d: PostAuditDraft, ctx: CallContext): PortResult<EvidenceRecordRef>
  recordRevocation(d: RevocationDraft, ctx: CallContext): PortResult<EvidenceRecordRef>
}

/** 读面辅助：证据包按记录查询归 PORT-HIST（本端口不另立读口，防双源） */
export type EvidenceReadContext = ReadContext
