/**
 * PORT-AUTH 授权与决定 —— 权源核验、具名决定、行使落账、撤回、禁配核验
 * （docs/v2/05 §四；签名 docs/v2/14 §1.2）
 *
 * 必须拒绝：代批/自批（决定面须具名位置＋权源引用）；token/凭据当权源（权源只认
 *   `GrantRef` 记录引用）；持 operating root key 自动构成授权判定（root key 只证明
 *   「以内部老板身份签发」，授权仍须按链核验）；撤回无后代时不做显式确认。
 * 本端口不向任何其他端口供给「绕过端口」的直写路径（PORT-OPS 的唯一供能者）。
 * 零实现、零 IO。
 */
import type {
  CallContext,
  CallerRef,
  CompanyRef,
  GrantRef,
  PortResult,
  ReadContext,
} from './def.ts'

/** 端口名常量 */
export const PORT_AUTH = 'PORT-AUTH' as const

/** 命令类别（值集唯一主表 v2/09 ENU-128）：域动作走专用记录，泛型申请只限外部/人工入口 */
export type CommandClass = 'external_request' | 'manual_action' | 'generic_application'

/** 待核验命令引用（REC-CMD-01/02）：载荷只留摘要，原文按记录引用回读 */
export interface CommandRef {
  readonly commandId: string
  readonly commandClass: CommandClass
  readonly company: CompanyRef
  readonly requestedBy: CallerRef
  readonly target: string
  readonly payloadDigest: string
}

/** 核验对象（人/岗位/单元/公司）；`subjectType` 的取值登记归 v2/03，本件不复制枚举 */
export interface SubjectRef {
  readonly subjectType: string
  readonly subjectId: string
}

export interface ConflictFinding {
  readonly withSubject: SubjectRef
  readonly kind: string
  readonly detail: string
}

/** 禁配与独立性核验报告：`compatible:false` 时不得进入允许路径 */
export interface ConflictReport {
  readonly subject: SubjectRef
  readonly compatible: boolean
  readonly findings: readonly ConflictFinding[]
  readonly checkedAt: string
}

/** 政策结论四态（值集唯一主表 v2/09 ENU-31；判定顺序 prohibited→reserved→permitted→uncovered） */
export type PolicyState = 'permitted' | 'reserved' | 'prohibited' | 'uncovered'

interface PolicyVerdictBase {
  readonly command: CommandRef
  readonly conflictCheck: ConflictReport
  readonly effectiveScope: readonly string[]
  readonly checkedAt: string
}

/**
 * 核验结论（REC-CMD-02）。`permitted` 类型上要求至少一条解析到的授权且链核验通过；
 * 其余三态必须给出 `failReason`——「无可用授权」不得静默成允许（resolvedGrants 空
 * 列表本身只表示「无可用授予」，不表示拒绝理由已写）。
 */
export type PolicyVerdict =
  | (PolicyVerdictBase & {
      readonly verdict: 'permitted'
      readonly resolvedGrants: readonly [GrantRef, ...GrantRef[]]
      readonly delegationChainOk: true
      readonly failReason?: undefined
    })
  | (PolicyVerdictBase & {
      readonly verdict: 'reserved' | 'prohibited' | 'uncovered'
      readonly resolvedGrants: readonly GrantRef[]
      readonly delegationChainOk: boolean
      readonly failReason: string
    })

/**
 * 决定草案。专用决定类型优先；只有无专用类型时才落 REC-DEC-01（一事件一身份）。
 * `decidedBy` 与 `authority` 必填：写入者不得替决定者补写理由或补造权源。
 */
export interface DecisionDraft {
  readonly subject: SubjectRef
  readonly decisionKind: string
  readonly decidedBy: CallerRef
  readonly reason: string
  readonly authority: readonly GrantRef[]
  readonly scope: readonly string[]
  readonly undecided: readonly string[]
}

export interface DecisionRef {
  readonly recordId: string
  readonly version: number
  readonly decisionKind: string
}

/** 授权行使身份（值集唯一主表 v2/09 ENU-139）；子 agent 不得取 `internal_boss` */
export type OnBehalfOf = 'self' | 'internal_boss'

/** 行使主张：权源引用＋行使者＋行使身份；主张不是事实，回执由端口侧落账 */
export interface ExerciseClaim {
  readonly grant: GrantRef
  readonly exercisedBy: CallerRef
  readonly onBehalfOf: OnBehalfOf
  readonly action: string
  readonly commandRef?: string
}

/** 行使回执：`selfReported:false` 表示由端口落账（L3K-14 教训：禁调用方自报） */
export interface ExerciseReceipt {
  readonly recordId: string
  readonly grant: GrantRef
  readonly recordedAt: string
  readonly selfReported: false
}

/** 停用证据三选一（值集唯一主表 v2/09 ENU-130） */
export type DeactivationEvidenceKind =
  | 'revocation_receipt'
  | 'injection_stop_confirm'
  | 'fence_rejection_record'

export interface DeactivationEvidence {
  readonly kind: DeactivationEvidenceKind
  readonly evidenceRef: string
}

/**
 * 后代枚举结果（REC-AUTH-03）：有后代时须逐项列全（非空）；无后代时须显式确认
 * `noDescendantsConfirmed:true`——空数组＋无确认不得冒充「查过了」。
 */
export type DescendantClosure =
  | {
      readonly descendants: readonly [GrantRef, ...GrantRef[]]
      readonly noDescendantsConfirmed?: undefined
    }
  | {
      readonly descendants: readonly []
      readonly noDescendantsConfirmed: true
    }

/** 撤回请求：`deactivationEvidence` 非空（三选一），后代闭包见 `DescendantClosure` */
export interface WithdrawRequest {
  readonly grant: GrantRef
  readonly reason: string
  readonly closure: DescendantClosure
  readonly deactivationEvidence: readonly [DeactivationEvidence, ...DeactivationEvidence[]]
}

/**
 * 撤回回执。`gatewayEnforced` 如实报网关强制是否已执行——后代批量吊销为目标（未证），
 * 未建成前以 REC-EVD-RVK＋审计断言代偿（v2/15 SEC-REV-02）。
 */
export interface WithdrawReceipt {
  readonly recordId: string
  readonly revoked: readonly GrantRef[]
  readonly noDescendants: boolean
  readonly gatewayEnforced: boolean
  readonly deactivationEvidence: readonly DeactivationEvidence[]
}

/** 端口接口：不供能任何绕过其余端口的直写路径 */
export interface AuthorizationPort {
  verify(cmd: CommandRef, rc: ReadContext): PortResult<PolicyVerdict>
  registerDecision(d: DecisionDraft, ctx: CallContext): PortResult<DecisionRef>
  exercise(use: ExerciseClaim, ctx: CallContext): PortResult<ExerciseReceipt>
  withdraw(req: WithdrawRequest, ctx: CallContext): PortResult<WithdrawReceipt>
  checkConflicts(subject: SubjectRef, rc: ReadContext): PortResult<ConflictReport>
}
