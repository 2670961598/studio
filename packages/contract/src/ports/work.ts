/**
 * PORT-WORK 协作与工作记录 —— 意图、受理、合同、五门、计划、迁移、效果级、
 * 完成/验收/维持验收、异常、重开/结清、交接/派工、评论（docs/v2/05 §四；
 * 签名 docs/v2/14 §1.4）
 *
 * 必须拒绝：评论塞无权决定（`WorkComment` 类型上无决定面/权源槽）；
 *   事件流、执行面自报终态、平台「完成」标记触发迁移（迁移只认
 *   `WorkTransitionRequest.triggerRef` 前置记录＋三分生产者）；
 *   不支持的流程静默降级（以 `unsupported` 显式失败）。
 * 五门判据：权/能力/资源/信息/禁止（v2/04 §四）；判者→岗位封闭映射归 v2/11。
 * 零实现、零 IO；平台写入唯一经网关（DOM-02）。
 */
import type { TerminalState } from './exec.ts'
import type {
  CallContext,
  CallerRef,
  CompanyRef,
  GrantRef,
  PortResult,
  ProofBoundary,
  ReadContext,
  VersionRef,
} from './def.ts'

/** 端口名常量 */
export const PORT_WORK = 'PORT-WORK' as const

// ─────────────────────────────────────────────────────────────────────────────
// 一、意图（REC-WORK-01；外部意图唯一入口只落单不派工）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 意图幂等四槽＝（公司×来源×种类×票据或去重键）。票据与去重键至少一者存在：
 * 类型上不允许「两者都缺」，也不允许「去重键空串」语义（空串校验归实现）。
 */
export type IntentIdentity =
  | { readonly ticket: string; readonly dedupKey?: string }
  | { readonly ticket?: undefined; readonly dedupKey: string }

export type IntentEnvelope = IntentIdentity & {
  readonly company: CompanyRef
  readonly source: string
  readonly kind: string
  readonly submittedBy: CallerRef
  readonly payloadDigest: string
}

/** 意图票据：`deduped:true`＝同键同内容返回既有结果，不产生第二次副作用 */
export interface IntentTicket {
  readonly intentRef: string
  readonly idempotency: {
    readonly companyId: string
    readonly source: string
    readonly kind: string
    readonly key: string
  }
  readonly queuedAt: string
  readonly deduped: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、受理与合同（REC-WORK-02/03）
// ─────────────────────────────────────────────────────────────────────────────

/** 受理五取值（值集唯一主表 v2/09 ENU-08） */
export type IntakeVerdict =
  | 'accepted'
  | 'conditional_accepted'
  | 'hold'
  | 'rejected'
  | 'referred'

/** 附条件接受必须给条件（非空）；其余受理取值不得携带条件 */
export type IntakeConditions =
  | {
      readonly verdict: 'conditional_accepted'
      readonly conditions: readonly [string, ...string[]]
    }
  | {
      readonly verdict: Exclude<IntakeVerdict, 'conditional_accepted'>
      readonly conditions?: undefined
    }

export type IntakeDecisionDraft = IntakeConditions & {
  readonly workRef: string
  readonly decidedBy: CallerRef
  readonly reason: string
  readonly authority: readonly GrantRef[]
  readonly expected?: VersionRef
}

export interface IntakeRef {
  readonly recordId: string
  readonly version: number
  readonly verdict: IntakeVerdict
}

/** 承诺类变更须走 COMMIT-CHANGE：`changesCommitment:true` 时程序引用必填 */
export type ContractChangeScope =
  | { readonly changesCommitment: true; readonly commitChangeProgramRef: string }
  | { readonly changesCommitment: false; readonly commitChangeProgramRef?: undefined }

export type ContractRevisionDraft = ContractChangeScope & {
  readonly workRef: string
  readonly base: VersionRef
  readonly changes: readonly string[]
  readonly revisedBy: CallerRef
  readonly authority: readonly GrantRef[]
}

export interface ContractRef {
  readonly recordId: string
  readonly version: number
  readonly changesCommitment: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// 三、五门、计划、迁移（REC-WORK-04/05/06）
// ─────────────────────────────────────────────────────────────────────────────

/** 开工五门：权/能力/资源/信息/禁止（v2/04 §四；中文名照录表头，非 v2/09 枚举） */
export type ReadinessGate = '权' | '能力' | '资源' | '信息' | '禁止'

/** 开工判断三值（值集唯一主表 v2/09 ENU-12） */
export type ReadinessVerdict = 'ready' | 'conditional_ready' | 'not_ready'

/** 附条件开工必须给条件＋责任者＋到期处置；否则不成立（不得以「先干再说」补齐） */
export interface ReadinessCondition {
  readonly condition: string
  readonly owner: CallerRef
  readonly due: string
  readonly onExpiry: string
}

export type ReadinessConditions =
  | {
      readonly verdict: 'conditional_ready'
      readonly conditions: readonly [ReadinessCondition, ...ReadinessCondition[]]
    }
  | {
      readonly verdict: 'ready' | 'not_ready'
      readonly conditions?: undefined
    }

export type ReadinessJudgmentDraft = ReadinessConditions & {
  readonly workRef: string
  readonly gate: ReadinessGate
  readonly judge: CallerRef
  /** 依据留痕：授权、资格、额度、输入、禁止清单各自引用（非空） */
  readonly basisRefs: readonly [string, ...string[]]
  readonly expected?: VersionRef
}

export interface GateRef {
  readonly recordId: string
  readonly version: number
  readonly gate: ReadinessGate
  readonly verdict: ReadinessVerdict
}

export interface PlanLockDraft {
  readonly workRef: string
  readonly planVersion: string
  readonly lockedBy: CallerRef
  readonly authority: readonly GrantRef[]
  readonly scope: readonly string[]
  readonly expected?: VersionRef
}

export interface PlanRef {
  readonly recordId: string
  readonly version: number
  readonly planVersion: string
}

/** 工作十态（值集唯一主表 v2/09 ENU-03） */
export type WorkState =
  | 'intake'
  | 'pending_start'
  | 'in_progress'
  | 'paused'
  | 'awaiting_review'
  | 'rework'
  | 'accepted'
  | 'rejected'
  | 'terminated'
  | 'settled'

/**
 * 工作迁移（REC-WORK-06）：`triggerRef` 必填且须为前置记录；生产者只允许
 * 三分（ENU-13）。观察事件/执行面自报终态/平台完成标记不在生产者集合内——
 * 它们不构成迁移权源（v2/07 §三总规则）。
 */
export interface WorkTransitionRequest {
  readonly workRef: string
  readonly from: WorkState
  readonly to: WorkState
  readonly triggerRef: string
  readonly triggerProducer: 'initiator' | 'decisive' | 'rule'
  readonly expected: VersionRef
  readonly reason: string
}

export interface WorkTransitionRef {
  readonly recordId: string
  readonly workRef: string
  readonly from: WorkState
  readonly to: WorkState
  readonly effective: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// 四、效果级、完成与验收（REC-WORK-07/08/09/ACCEPT-MAINT）
// ─────────────────────────────────────────────────────────────────────────────

/** EX- 效果级（值集唯一主表 v2/09 ENU-14；EX-2+＝高侧，存疑/未分级/争议/升级一律高侧） */
export type EffectClass = 'EX-0' | 'EX-1' | 'EX-2' | 'EX-3' | 'EX-4' | 'EX-5' | 'EX-6'

/** 效果级首判（REC-WORK-07）：交付方＋1 独立首判；`uncertain:true` 时不得给低侧 EX-0/EX-1 */
export interface EffectClassDraft {
  readonly workRef: string
  readonly effectClass: EffectClass
  readonly firstJudge: CallerRef
  readonly independentOfDeliverer: true
  readonly uncertain: boolean
  readonly basisRefs: readonly [string, ...string[]]
  readonly proofBoundary: ProofBoundary
}

export interface ClassRef {
  readonly recordId: string
  readonly version: number
  readonly effectClass: EffectClass
}

/**
 * 完成申报（REC-WORK-08）：终态五值＋非空输出＋REPORT 落盘＋闸门 exit=0 是四要件；
 * 启动回执/平台「完成」标记不得当验收。`isAcceptance:false` 为类型级提醒。
 */
export interface CompletionDraft {
  readonly workRef: string
  readonly terminal: TerminalState
  readonly outputNonEmpty: boolean
  readonly reportRef: string
  readonly gateExitCode: number
  readonly evidencePackageRef: string
  readonly declaredBy: CallerRef
  readonly proofBoundary: ProofBoundary
}

/** 验收四取值（值集唯一主表 v2/09 ENU-09） */
export type AcceptanceVerdict =
  | 'accepted'
  | 'conditional_accepted'
  | 'rejected'
  | 'terminated_by_authority'

export interface AcceptanceDraft {
  readonly workRef: string
  readonly verdict: AcceptanceVerdict
  readonly acceptor: CallerRef
  readonly basisRefs: readonly [string, ...string[]]
  readonly proofBoundary: ProofBoundary
  readonly expected?: VersionRef
}

/** 维持结论三值（值集唯一主表 v2/09 ENU-15） */
export type MaintenanceVerdict = 'maintained' | 'not_maintained' | 'undeterminable'

export interface MaintAcceptanceDraft {
  readonly workRef: string
  readonly verdict: MaintenanceVerdict
  readonly verifier: CallerRef
  readonly basisRefs: readonly [string, ...string[]]
  readonly proofBoundary: ProofBoundary
  readonly expected?: VersionRef
}

/** 三类工作决定引用（顶层 `kind` 判别；启动/完成申报与验收互不代签） */
export type WorkDecisionRef =
  | { readonly kind: 'completion'; readonly recordId: string; readonly version: number }
  | { readonly kind: 'acceptance'; readonly recordId: string; readonly version: number }
  | { readonly kind: 'maint_acceptance'; readonly recordId: string; readonly version: number }

// ─────────────────────────────────────────────────────────────────────────────
// 五、异常、重开、结清、交接、评论（REC-WORK-17/11/12/HANDOVER/13、REC-EVT-01）
// ─────────────────────────────────────────────────────────────────────────────

/** 异常类别（值集唯一主表 v2/09 ENU-26） */
export type ExceptionCategory =
  | 'rule_deviation'
  | 'rule_gap'
  | 'rule_conflict'
  | 'source_doubt'
  | 'irreversible_harm_ongoing'
  | 'no_comparable_criteria'
  | 'criteria_invalid'
  | 'slow_drift'
  | 'holistically_unacceptable'
  | 'report_overdue'
  | 'report_integrity_doubt'

/** 异常（REC-WORK-17）：`receiver` 必填具名；不得以「框架/系统/平台」代收（I-9） */
export interface ExceptionDraft {
  readonly workRef: string
  readonly category: ExceptionCategory
  readonly receiver: CallerRef
  readonly description: string
  readonly authority: readonly GrantRef[]
  readonly proofBoundary: ProofBoundary
  readonly expected?: VersionRef
}

export interface ExceptionRef {
  readonly recordId: string
  readonly version: number
  readonly category: ExceptionCategory
}

/** 重开回退去向（ENU-28 六值子集；终态上重开＝复核动作或新事项，不是回退） */
export type ReopenTarget =
  | 'intake'
  | 'pending_start'
  | 'in_progress'
  | 'paused'
  | 'awaiting_review'
  | 'rework'

export interface ReopenRequest {
  readonly workRef: string
  readonly to: ReopenTarget
  readonly reason: string
  readonly reopenedBy: CallerRef
  readonly authority: readonly GrantRef[]
  readonly expected: VersionRef
}

/** 工作结清四态（值集唯一主表 v2/09 ENU-10） */
export type WorkSettlementState =
  | 'fully_settled'
  | 'settled_with_reservations'
  | 'unsettled'
  | 'into_liquidation'

export interface WorkSettlementDraft {
  readonly workRef: string
  readonly settlement: WorkSettlementState
  readonly settledBy: CallerRef
  readonly reservationRefs: readonly string[]
  readonly proofBoundary: ProofBoundary
  readonly expected: VersionRef
}

export interface WorkSettlementRef {
  readonly recordId: string
  readonly version: number
  readonly settlement: WorkSettlementState
}

/** 交接提交（REC-WORK-HANDOVER）：包引用＋交接十项不全即不得宣称交接完成 */
export interface HandoverSubmission {
  readonly workRef: string
  readonly packageRef: string
  readonly from: CallerRef
  readonly to: CallerRef
  readonly items: readonly string[]
  readonly expected: VersionRef
}

export interface HandoverRef {
  readonly recordId: string
  readonly version: number
  readonly packageRef: string
}

/** 派工/领取请求（REC-WORK-13）：转派＝一次新派工并触发五门重判 */
export interface AssignmentRequest {
  readonly workRef: string
  readonly requestedTo: CallerRef
  readonly requestedBy: CallerRef
  readonly reason: string
  readonly authority: readonly GrantRef[]
  readonly expected: VersionRef
}

export interface AssignmentRef {
  readonly recordId: string
  readonly version: number
  readonly assignee: CallerRef
}

/**
 * 平台活动（REC-EVT-01；本方法只收评论）。v2/14 称 `PlatformActivity`；与 v0
 * `platform.ts` 同名类型避撞，本端口取 `WorkComment`。类型上无 `decision`/
 * `authority` 槽：评论塞无权决定＝拒（不得以评论名目承载决定面）。
 */
export interface WorkComment {
  readonly kind: 'comment'
  readonly workRef: string
  readonly actor: CallerRef
  readonly body: string
  readonly inReplyTo?: string
  readonly decision?: undefined
  readonly authority?: undefined
}

export interface ActivityRef {
  readonly recordId: string
  readonly version: number
}

// ─────────────────────────────────────────────────────────────────────────────
// 六、端口接口
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkPort {
  reserveIntent(intent: IntentEnvelope, ctx: CallContext): PortResult<IntentTicket>
  recordIntake(d: IntakeDecisionDraft, ctx: CallContext): PortResult<IntakeRef>
  reviseContract(d: ContractRevisionDraft, ctx: CallContext): PortResult<ContractRef>
  judgeReadiness(d: ReadinessJudgmentDraft, ctx: CallContext): PortResult<GateRef>
  lockPlan(d: PlanLockDraft, ctx: CallContext): PortResult<PlanRef>
  transition(req: WorkTransitionRequest, ctx: CallContext): PortResult<WorkTransitionRef>
  classifyEffect(d: EffectClassDraft, ctx: CallContext): PortResult<ClassRef>
  recordCompletion(d: CompletionDraft, ctx: CallContext): PortResult<WorkDecisionRef>
  recordAcceptance(d: AcceptanceDraft, ctx: CallContext): PortResult<WorkDecisionRef>
  recordMaintAcceptance(
    d: MaintAcceptanceDraft,
    ctx: CallContext,
  ): PortResult<WorkDecisionRef>
  raiseException(d: ExceptionDraft, ctx: CallContext): PortResult<ExceptionRef>
  reopen(d: ReopenRequest, ctx: CallContext): PortResult<WorkTransitionRef>
  recordSettlement(d: WorkSettlementDraft, ctx: CallContext): PortResult<WorkSettlementRef>
  submitHandover(d: HandoverSubmission, ctx: CallContext): PortResult<HandoverRef>
  requestAssignment(d: AssignmentRequest, ctx: CallContext): PortResult<AssignmentRef>
  addComment(a: WorkComment, ctx: CallContext): PortResult<ActivityRef>
}

/** 读面辅助：本端口没有独立读方法，工作视图经 PORT-HIST 按记录查询（防双源） */
export type WorkReadContext = ReadContext & { readonly company: CompanyRef }
