/**
 * PORT-OPS 操作与处置面 —— 打包、迁移候选、保全、止损、围栏、紧急处置工具
 * （docs/v2/05 §四；签名 docs/v2/14 §1.8；ctl- 词族 ENU-119；紧急止损 REC-WORK-18）
 *
 * 定位：CLI/运维侧的操作工具面（一命令一模块的实现域，v2/14 §二）。
 * 必须拒绝：
 *   - 自身新增权源：供能链**单向 PORT-AUTH→PORT-OPS**，每次操作必引已核验的政策
 *     结论或具名决定（`OpsAuthorization`）；本端口不核验、不代批、不扩权，
 *     `CallContext.authority` 只是主张（`selfGranted` 槽在类型上不存在）；
 *   - 迁移候选当激活：部署只供候选，激活是公司有权位置的决定记录
 *     （`MigrationCandidate.activatable` 恒 `false`，v2/05 §三通则 3）；
 *   - 紧急止损越过预设边界：无预设边界时只能取不进入禁止/保留权限的保全与升级
 *     （`EmergencyBoundary` 两态）；止损不追认原动作、不等于恢复、不推广为常态
 *     （`StopReceipt.effectOnOriginal` 三枚 `false` 字面量）；
 *   - 控制面动作借道 comment：`ControlPlaneDeclaration` 只收 ctl- 词族；迁移期 `op`
 *     借道须显式降级标记（ENU-119；transition 不得显示为 comment）。
 * 零实现、零 IO；实现域 control＋cli 一命令一模块。
 */
import type { EndpointRef } from './reg.ts'
import type { CallContext, PortResult, ReconcileHandle } from './def.ts'

/** 端口名常量 */
export const PORT_OPS = 'PORT-OPS' as const

/** 供能来源（单向）：PORT-OPS 的一切操作由 PORT-AUTH 供能，自身不新增权源 */
export const OPS_AUTHORITY_SOURCE = 'PORT-AUTH' as const

// ─────────────────────────────────────────────────────────────────────────────
// 一、供能与控制面动作申报（不新增权源；ENU-119）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 控制面动作词族（值集唯一主表 v2/09 ENU-119；SEC-SIG-03）：
 * create/transition/set-field/link/provision/guards 六动词。网关校验申报动词与实文
 * 一致（沿 `gw-action-mismatch`）；**transition 不得显示为 comment**。
 */
export const CONTROL_PLANE_ACTIONS = [
  'ctl-create',
  'ctl-transition',
  'ctl-set-field',
  'ctl-link',
  'ctl-provision',
  'ctl-guards',
] as const
export type ControlPlaneAction = (typeof CONTROL_PLANE_ACTIONS)[number]

/**
 * 控制面动作申报：动词只能是 ctl- 词族；迁移期借道 `op` 允许但须记台账降级标记。
 * `comment` 不在本类型内——自由评论不承载控制面动作（借道即违规）。
 */
export type ControlPlaneDeclaration =
  | {
      readonly action: ControlPlaneAction
      readonly degradedBypass?: undefined
    }
  | {
      readonly action: 'op'
      readonly degradedBypass: 'ledger_marked'
    }

/**
 * 平台触达申报：本次操作是否触发平台写。触发时控制面动作申报必填且只能是 ctl-
 * 词族；不触发时不得携带申报（防「无平台写却申报控制面动作」）。
 */
export type OpsPlatformTouch =
  | {
      readonly requiresPlatformWrite: true
      readonly declaration: ControlPlaneDeclaration
    }
  | {
      readonly requiresPlatformWrite: false
      readonly declaration?: undefined
    }

/**
 * 供能凭据（PORT-AUTH→PORT-OPS 单向）：必须引**已核验的政策结论**或**具名决定**；
 * 本端口不自行核验权源、不新增权源——`selfGranted`/`bypassAuth` 槽不存在，
 * `CallContext.authority` 只作主张（v2/14 §1.2「不供能绕过其余端口的直写路径」）。
 */
export type OpsAuthorization =
  | {
      readonly poweredBy: 'policy_verdict'
      readonly commandRef: string
      readonly verdict: 'permitted'
    }
  | {
      readonly poweredBy: 'decision'
      readonly decisionRef: string
    }

/** 一切操作请求公共槽：供能引用＋理由（无理由的处置＝匿名处置，不成立） */
export interface OpsRequestBase {
  readonly authorization: OpsAuthorization
  readonly reason: string
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、打包与迁移候选（只读导出；候选≠激活）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 导出打包请求：`includes` 逐项列全（空集不得冒充「全量」）；出站前必须过秘密
 * 扫描（v2/15 SEC-SEC-04/05 三不入），`outboundScanRef` 必填。
 */
export interface ExportBundleRequest extends OpsRequestBase {
  readonly bundleKind: string
  readonly includes: readonly [string, ...string[]]
  readonly scope: readonly [string, ...string[]]
  readonly outboundScanRef: string
  readonly destination: string
}

/** 打包回执：只读导出（`mutatesFacts:false`）；摘要可复算 */
export interface BundleReceipt {
  readonly bundleRef: string
  readonly digest: string
  readonly files: readonly string[]
  readonly exportedAt: string
  readonly mutatesFacts: false
}

/**
 * 迁移候选请求（权威切换三段之一「候选端点」）：只产候选；`sourceGeneration` 为
 * 当前权威代次（不匹配＝`rejected_version`，不得最后写入为准）。
 */
export interface MigrationCandidateRequest extends OpsRequestBase {
  readonly domain: string
  readonly sourceEndpoint: EndpointRef
  readonly sourceGeneration: number
  readonly comparedSources: readonly [string, ...string[]]
}

/**
 * 迁移候选：`activatable` 恒 `false`——激活不属部署配置（v2/05 §三通则 3）；
 * 对账未完成不得宣称可迁移（REC-EVT-02），故 `reconcileRef` 必填、`blocking` 逐项列。
 */
export interface MigrationCandidate {
  readonly candidateRef: string
  readonly activatable: false
  readonly requiresActivationDecision: true
  readonly reconcileRef: string
  readonly blocking: readonly string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// 三、保全（可补偿与不可补偿损害先保全再说明）
// ─────────────────────────────────────────────────────────────────────────────

/** 保全请求：逐项列证据与缺口；不可补偿损害须显式标记（不得用收益抵销） */
export interface PreserveRequest extends OpsRequestBase {
  readonly subjectRef: string
  readonly evidenceRefs: readonly [string, ...string[]]
  readonly gaps: readonly string[]
  readonly retainUntil: string
  readonly irreversibleHarm: boolean
}

/**
 * 保全回执：`preserved` 与 `gaps` 分列（保全了什么、缺什么），不得以「已保全」一句
 * 覆盖缺口；`irreversible:true` 时后续处置须带不可补偿说明。
 */
export interface PreservationReceipt {
  readonly preservationRef: string
  readonly preserved: readonly string[]
  readonly gaps: readonly string[]
  readonly irreversible: boolean
  readonly retainedUntil: string
}

// ─────────────────────────────────────────────────────────────────────────────
// 四、止损与围栏（先止损、保全、说明）
// ─────────────────────────────────────────────────────────────────────────────

/** 止损目标：只引用既有工作/出工段/执行体，不新造对象 */
export type BreakTarget =
  | { readonly kind: 'work'; readonly workRef: string }
  | { readonly kind: 'segment'; readonly segmentRef: string }
  | { readonly kind: 'executor'; readonly bindingRef: string }

/**
 * 围栏声明：冻结旧写入者/派生执行体（v2/05 §三通则 2）。围栏机制建成＝**目标
 * （未证）**——`mechanismProven:false` 时不得宣称旧写入者已被冻结。
 */
export interface FenceDeclaration {
  readonly scope: readonly [string, ...string[]]
  readonly stopInjection: boolean
  readonly revokeDerived: boolean
  readonly mechanismProven: boolean
}

/** 止损围栏请求：`triggerRef` 为触发记录引用（观察事件不构成迁移权源，也不构成止损权源） */
export type CircuitBreakRequest = OpsRequestBase &
  OpsPlatformTouch & {
    readonly target: BreakTarget
    readonly fence: FenceDeclaration
    readonly triggerRef: string
  }

/**
 * 止损回执：`outcome` 只 `executed|unknown`——已发送而未确认＝不明先对账（§0.2-2），
 * 不得压成失败重试；`residual` 为残留清单（围栏后仍存活者，须逐项具名）。
 */
export interface BreakReceipt {
  readonly recordId: string
  readonly stopped: readonly string[]
  readonly fence: FenceDeclaration
  readonly residual: readonly string[]
  readonly outcome: 'executed' | 'unknown'
  readonly reconcile: ReconcileHandle
}

// ─────────────────────────────────────────────────────────────────────────────
// 五、紧急处置（REC-WORK-18 落口；命名治 L3J-P1-07「停机通道」无名）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 紧急边界两态（REC-WORK-18.boundary_ref）：有预设边界＝边界内先行保全与止损；
 * 无预设边界＝只能采取不进入禁止/保留权限的保全与升级（`escalationRef` 必填）。
 * 紧急止损是唯一允许在生效前验收缺位下先行的情形，且只允许最小保全与止损。
 */
export type EmergencyBoundary =
  | {
      readonly preset: true
      readonly boundaryRef: string
      readonly permittedActions: readonly [string, ...string[]]
    }
  | {
      readonly preset: false
      readonly escalationRef: string
      readonly prohibitedAmplification: true
    }

/** 事后独立复核位置与期限（REC-WORK-18.independent_review）；复核须独立于现场责任主体 */
export interface EmergencyReview {
  readonly reviewerRef: string
  readonly due: string
  readonly conclusion?: string
}

/**
 * 紧急止损请求：`notAuthorized` 逐项写**明确未做的事**（空集不得冒充「未越权」）；
 * `notified` 为具名接收者（禁匿名责任者，I-11）；`evidencePreserved` 逐项列保全物。
 */
export type EmergencyStopRequest = OpsRequestBase &
  OpsPlatformTouch & {
    readonly triggerRef: string
    readonly boundary: EmergencyBoundary
    readonly notAuthorized: readonly [string, ...string[]]
    readonly evidencePreserved: readonly string[]
    readonly notified: readonly [string, ...string[]]
    readonly review: EmergencyReview
  }

/**
 * 紧急止损回执（REC-WORK-18）：
 * `effectOnOriginal` 三枚 `false`＝不追认原动作、不等于恢复、不推广为常态；
 * `outcome` 允许 `unknown`（已发出未确认＝先对账）。
 */
export interface StopReceipt {
  readonly recordId: string
  readonly version: number
  readonly actionsTaken: readonly string[]
  readonly notAuthorized: readonly string[]
  readonly evidencePreserved: readonly string[]
  readonly notified: readonly [string, ...string[]]
  readonly review: EmergencyReview
  readonly effectOnOriginal: {
    readonly retroactiveApproval: false
    readonly equalsRecovery: false
    readonly normalizable: false
  }
  readonly outcome: 'executed' | 'unknown'
  readonly reconcile: ReconcileHandle
}

// ─────────────────────────────────────────────────────────────────────────────
// 六、端口接口
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PORT-OPS：打包/迁移候选/保全/止损围栏/紧急处置五方法。
 * 全部方法只取 `OpsAuthorization` 供能；本端口不提供授权判定、不直写记录
 * （记录写口唯一归 PORT-HIST）。
 */
export interface OperationsPort {
  exportBundle(req: ExportBundleRequest, ctx: CallContext): PortResult<BundleReceipt>
  migrationCandidate(
    req: MigrationCandidateRequest,
    ctx: CallContext,
  ): PortResult<MigrationCandidate>
  preserve(req: PreserveRequest, ctx: CallContext): PortResult<PreservationReceipt>
  circuitBreak(req: CircuitBreakRequest, ctx: CallContext): PortResult<BreakReceipt>
  emergencyStop(req: EmergencyStopRequest, ctx: CallContext): PortResult<StopReceipt>
}
