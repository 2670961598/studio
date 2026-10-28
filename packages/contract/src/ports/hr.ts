/**
 * PORT-HR 任职生命周期 —— 拟任、迁移、结清、绩效、利益申报、任职视图
 * （docs/v2/05 §四；签名 docs/v2/14 §1.3；状态机 docs/v2/02 §三）
 *
 * 必须拒绝：非在岗态发起出工（目标（未证）：网关闸门建成前以 REC-LIFE-02＋
 *   审计断言代偿——本端口只落迁移事实，不冒充闸门）；自评（绩效须独立位置）；
 *   交接不完整进入离岗待结清（`SettlementRef.blockingItems` 非空即不得宣称完成）。
 * 任命幂等键为四元组（位置引用＋任职者＋任期起点＋拟任版本），不得缩写（v2/11 §0.4-5）。
 * 零实现、零 IO；人事事实落公司 git 目录，唯一写入者仍是 daemon。
 */
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
export const PORT_HR = 'PORT-HR' as const

/** 任职六状态（值集唯一主表 v2/09 ENU-01；`null` 只表示入职前的 ∅，不是状态值） */
export type LifecycleState =
  | 'candidate'
  | 'active'
  | 'suspended'
  | 'handover'
  | 'settling'
  | 'retired'

/** 迁移生产者三分（值集唯一主表 v2/09 ENU-13）：发起型/决定型/规则型 */
export type TransitionProducer = 'initiator' | 'decisive' | 'rule'

/**
 * 任职迁移请求（REC-LIFE-02）：按边触发者（v2/02 §3.2）。
 * `from:null` 表示 ∅→候选；`trigger.recordRef` 必填且须为前置记录；
 * `expected` 不匹配＝`rejected_version`，不得最后写入为准。
 */
export interface LifecycleTransitionRequest {
  readonly employmentRef: string
  readonly from: LifecycleState | null
  readonly to: LifecycleState
  readonly trigger: {
    readonly producer: TransitionProducer
    readonly recordRef: string
  }
  readonly expected: VersionRef
  readonly reason: string
}

export interface LifecycleTransitionRef {
  readonly recordId: string
  readonly employmentRef: string
  readonly from: LifecycleState | null
  readonly to: LifecycleState
  readonly effective: boolean
}

/** 任命四类型（值集唯一主表 v2/09 ENU-30） */
export type AppointmentType = 'appointment' | 'concurrent' | 'acting' | 'succession'

/**
 * 任命幂等键＝「位置引用＋任职者＋任期起点＋拟任版本」四元组（唯一口径，禁缩写）。
 * 四槽缺一＝构造期非法；同键同内容＝返回既有结果＋deduped，同键不同内容＝拒。
 */
export interface AppointmentIdempotencyKey {
  readonly positionRef: string
  readonly holder: string
  readonly termStart: string
  readonly draftVersion: VersionRef
}

/** 拟任面（REC-LIFE-01）：提名者与权源分列；「已提交」不等于任命生效 */
export interface AppointmentDraft {
  readonly appointmentType: AppointmentType
  readonly idempotency: AppointmentIdempotencyKey
  readonly nominator: CallerRef
  readonly authority: readonly GrantRef[]
  readonly effectiveFrom: string
  readonly conditions?: readonly string[]
}

export interface AppointmentRef {
  readonly recordId: string
  readonly version: number
  readonly idempotency: AppointmentIdempotencyKey
  readonly deduped: boolean
}

/** 结清面两段式（值集唯一主表 v2/09 ENU-125）：交接面/结清面互不代签 */
export type SettlementFace = 'handover' | 'settlement'

/** 结清项状态（值集唯一主表 v2/09 ENU-126）：closed/reservation/open */
export type SettlementItemState = 'closed' | 'reservation' | 'open'

/** 结清清单九项（值集唯一主表 v2/09 ENU-11） */
export type SettlementItemKind =
  | 'artifact'
  | 'resource'
  | 'evidence'
  | 'open_items'
  | 'commitment'
  | 'counterparty'
  | 'responsibility'
  | 'memory'
  | 'derived_face'

export interface SettlementItem {
  readonly item: SettlementItemKind
  readonly state: SettlementItemState
  /** reservation/open 必填责任者；closed 可省略 */
  readonly owner?: string
  /** reservation 必填到期/复审条件 */
  readonly due?: string
}

/**
 * 结清回执（REC-LIFE-03）。`blockingItems` 非空⇒`completed:false`；
 * 交接不完整不得进入离岗待结清，结清有争议不得宣称退役。
 */
export interface SettlementRef {
  readonly recordId: string
  readonly face: SettlementFace
  readonly completed: boolean
  readonly blockingItems: readonly SettlementItem[]
}

/** 绩效评价（REC-PERF-01）：评价位置独立，`evaluatorIsSubject` 只允许 false */
export interface PerformanceDraft {
  readonly subject: string
  readonly evaluator: CallerRef
  readonly evaluatorPosition: string
  readonly subjectPosition: string
  readonly evaluatorIsSubject: false
  readonly rating: string
  readonly basisRefs: readonly [string, ...string[]]
  readonly proofBoundary: ProofBoundary
}

export interface PerformanceRef {
  readonly recordId: string
  readonly version: number
  readonly subject: string
}

/** 利益关系申报（REC-LIFE-05）：申报不是批准，进入禁配/独立性核验 */
export interface InterestDeclaration {
  readonly declaredBy: CallerRef
  readonly subject: string
  readonly relationship: string
  readonly scope: readonly string[]
  readonly authority: readonly GrantRef[]
}

export interface RegistryRef {
  readonly recordId: string
  readonly version: number
  readonly registry: string
}

/** 任职视图查询（读面必带 ReadContext；`state` 过滤为六状态投影） */
export interface HolderQuery {
  readonly company: CompanyRef
  readonly personId?: string
  readonly positionRef?: string
  readonly state?: LifecycleState
}

/**
 * 任职视图（六状态投影）。`vacancyState` 是空缺字段（GAP-V2-17：N 一级单元字段
 * 不在 MIG-03 冻结物内），本件只留可选位，不定义其取值。
 */
export interface EmploymentView {
  readonly employmentRef: string
  readonly personId: string
  readonly positionRef: string
  readonly state: LifecycleState
  readonly vacancyState?: string
  readonly effectiveFrom?: string
  readonly authorityScope: readonly string[]
}

/** 端口接口：方法集覆盖任命/迁移/两段结清/绩效/申报/视图 */
export interface HumanResourcesPort {
  submitAppointment(d: AppointmentDraft, ctx: CallContext): PortResult<AppointmentRef>
  transitionLifecycle(
    req: LifecycleTransitionRequest,
    ctx: CallContext,
  ): PortResult<LifecycleTransitionRef>
  settleEmployment(
    face: SettlementFace,
    items: readonly [SettlementItem, ...SettlementItem[]],
    ctx: CallContext,
  ): PortResult<SettlementRef>
  recordPerformance(d: PerformanceDraft, ctx: CallContext): PortResult<PerformanceRef>
  declareInterest(d: InterestDeclaration, ctx: CallContext): PortResult<RegistryRef>
  current(q: HolderQuery, rc: ReadContext): PortResult<EmploymentView>
}
