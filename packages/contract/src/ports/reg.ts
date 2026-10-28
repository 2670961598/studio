/**
 * PORT-REG 定义与权威登记 —— 提交修订、具名批准、权威激活、围栏旧写入者
 * （docs/v2/05 §四；签名 docs/v2/14 §1.1）
 *
 * 必须拒绝：自行批准或自行激活（批准面/激活决定面均须具名记录与权源引用）；
 *           把「已提交」当「已生效」（`RevisionTicket.status` 仅 `draft|submitted`，
 *           生效另走 `ActivationReceipt`）；代次竞争（`expectedGeneration` 不匹配
 *           ＝`rejected_version`，不得最后写入为准）。
 * 目标（未证）：围栏（fencing）机制尚未证成；`FenceObservation` 只报观察
 *   （`mechanismProven:false`），不得据此宣称旧写入者已被冻结。
 * 零实现、零 IO；公司目录写入仍唯一归 daemon（挂单 commit）。
 */
import type {
  CallContext,
  CallerRef,
  DefRef,
  GrantRef,
  PortResult,
  VersionRef,
} from './def.ts'

/** 端口名常量 */
export const PORT_REG = 'PORT-REG' as const

/**
 * 修订草案。`base` 是精确的父修订引用（禁「当前最新」）；`digest` 是内容摘要，
 * 供批准面与激活面逐字核对（同一摘要不得对应两份内容）。
 */
export interface RevisionDraft {
  readonly definitionId: string
  readonly base: DefRef
  readonly content: Readonly<Record<string, unknown>>
  readonly digest: string
  readonly author: CallerRef
}

/**
 * 修订票据：只证明「已提交候选」，不证明已批准、更不证明已生效。
 * `status` 值集引 v2/09 ENU-04；`candidate` 指向本票据产生的候选修订。
 */
export interface RevisionTicket {
  readonly ticketId: string
  readonly status: 'draft' | 'submitted'
  readonly candidate: DefRef
  readonly submittedAt: string
  readonly deduped?: boolean
}

/**
 * 具名决定面（批准面；v2/14 称 `DecisionFace`，与记录面同名类型避撞而取本名）：
 * 必须是既有决定记录＋作决定的位置＋权源引用；缺 `decisionRef`/`decidedBy`/
 * `authority` 任一＝不得登记为批准。
 */
export interface ApprovalDecisionFace {
  readonly decisionRef: string
  readonly decidedBy: CallerRef
  readonly authority: readonly GrantRef[]
  readonly reason: string
  readonly scope: readonly string[]
}

/**
 * 批准登记引用。`activationRequired:true` 是类型级提醒：批准≠激活，
 * 权威切换必须另调 `activateAuthority`（REC-AUTH-07）。
 */
export interface ApprovalRef {
  readonly recordId: string
  readonly ticketId: string
  readonly approvedRevision: DefRef
  readonly activationRequired: true
}

/** 权威端点；`location` 是端点定位串（不得含秘密值——秘密只经 PORT-TRUST 逻辑引用） */
export interface EndpointRef {
  readonly endpointId: string
  readonly kind: string
  readonly location: string
}

/**
 * 权威激活请求（REC-AUTH-07）。幂等键＝（域×端点×新代次）三元组；
 * `decision` 必须是已成立的激活决定，调用方不得以「部署完成」自称激活。
 */
export interface ActivationRequest {
  readonly domain: string
  readonly endpoint: EndpointRef
  readonly generation: number
  readonly decision: ApprovalDecisionFace
  /** 代次竞争前置：给出当前代次，不匹配＝拒并回当前值（v2/11 §0.4-4） */
  readonly expectedGeneration?: number
}

export interface ActivationReceipt {
  readonly recordId: string
  readonly domain: string
  readonly endpoint: EndpointRef
  readonly generation: number
  readonly effectiveAt: string
  readonly deduped: boolean
}

/**
 * 围栏请求（REC-AUTH-06）：冻结旧写入者。`previousWriter` 必须是具名位置/端点，
 * `expectedGeneration` 防止对已切换代次重复围栏。
 */
export interface FenceRequest {
  readonly domain: string
  readonly endpoint: EndpointRef
  readonly previousWriter: string
  readonly expectedGeneration: number
  readonly decision: ApprovalDecisionFace
}

/**
 * 围栏观察。只报「是否观察到旧写入者被拒」，不报「围栏机制已建立」——
 * 后者为目标（未证）（v2/05 §四、v2/15 SEC-REV-02）。
 */
export interface FenceObservation {
  readonly observedAt: string
  readonly oldWriterWriteRejected: boolean
  readonly evidenceRef?: string
  readonly mechanismProven: false
}

/** 端口接口（写方法全带 `CallContext`；approval/activation 不得由调用方自行成立） */
export interface RegistrationPort {
  submitRevision(d: RevisionDraft, ctx: CallContext): PortResult<RevisionTicket>
  registerApproval(
    t: RevisionTicket,
    decision: ApprovalDecisionFace,
    ctx: CallContext,
  ): PortResult<ApprovalRef>
  activateAuthority(req: ActivationRequest, ctx: CallContext): PortResult<ActivationReceipt>
  fenceWriter(req: FenceRequest, ctx: CallContext): PortResult<FenceObservation>
}

/** 本端口登记的特化幂等键＝（域×端点×新代次）；`VersionRef` 供调用方回读当前代次 */
export type ActivationKey = {
  readonly domain: string
  readonly endpointId: string
  readonly generation: number
  readonly current: VersionRef
}
