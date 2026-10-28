/**
 * PORT-EXEC 执行能力 —— 选执行体、派发、观察、终态统计、终止、策略投影生成
 * （docs/v2/05 §四；签名 docs/v2/14 §1.5；执行行为 docs/v2/07 §三）
 *
 * 必须拒绝：启动当验收（`SegmentReceipt.isAcceptance:false`；验收走 PORT-WORK）；
 *   选择当授权（`ExecutorChoice.isAuthorization:false`；权源唯一经 PORT-AUTH）；
 *   三 fail-closed 前置缺一仍派发（`LaunchPreflight` 四引用全必填——策略投影/
 *   能力探测/秘密确认各带证据引用，缺一＝构造期非法）；虚构暂停/恢复/热更
 *   （接口不提供这些方法——不存在即不可调用）；无终态事件仍宣称完成
 *   （`KillReceipt` 无终态分支必须带对账入口）。
 *
 * v0 四原语承继：旧 `executor.ts` 的 launch/stream/resultStats/kill 四原语在本件以
 *   `ExecutorPrimitiveSet` 显式承载（类型取自旧件，不复制、不更名导出）；旧件保留
 *   至 MIG-06 退役，03-04 收口时再展平。其余 v2 签名（select/observe/kill/
 *   compileProjection）与 v0 面并存，不互相冒充。
 *
 * 零实现、零 IO；适配器实现归 packages/adapters。
 */
import type { ExecutorAdapter as V0ExecutorAdapter } from './executor.ts'
import type { DurationMs, TokenCounts } from './kernel.ts'
import type {
  CallContext,
  PortResult,
  ReadContext,
  ReconcileHandle,
} from './def.ts'

/** 端口名常量 */
export const PORT_EXEC = 'PORT-EXEC' as const

/**
 * v0 四原语承继面（launch/stream/resultStats/kill）。类型源仍是旧 `executor.ts`
 * （本单不改旧件）；03-04 收口时展平到本件、旧件退役。detect/estimate 属能力探测
 * 面，不在四原语内，见旧件 `ExecutorAdapter`。
 */
export type ExecutorPrimitiveSet = Pick<
  V0ExecutorAdapter,
  'launch' | 'stream' | 'resultStats' | 'kill'
>

// ─────────────────────────────────────────────────────────────────────────────
// 一、选择执行体（选择≠授权）
// ─────────────────────────────────────────────────────────────────────────────

/** 执行体绑定引用（DSH 为默认；选择顺序：单据指定＞岗位绑定＞默认） */
export interface ExecutorBindingRef {
  readonly executor: string
  readonly bindingRef: string
  readonly version: string
}

export interface SelectionChain {
  /** 单据指定（最高优先；缺省则看岗位绑定） */
  readonly ticket?: ExecutorBindingRef
  /** 岗位绑定 */
  readonly position?: ExecutorBindingRef
  /** 默认（DSH）——链尾必须有，链不完整＝拒 */
  readonly fallback: ExecutorBindingRef
}

/** 选择结果：只报「依据哪条链选出」，不产生任何授权（`isAuthorization:false`） */
export interface ExecutorChoice {
  readonly binding: ExecutorBindingRef
  readonly selectedFrom: 'ticket' | 'position' | 'default'
  readonly isAuthorization: false
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、派发简报（九件＋三 fail-closed 前置）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 派发前三 fail-closed 前置（v2/07 EXEC-01）：策略投影校验、能力覆盖、秘密供给确认。
 * 四项引用全必填且由对应端口出具；任一缺失/未确认＝不得 launch（构造期非法）。
 */
export interface LaunchPreflight {
  readonly policyProjectionRef: string
  readonly policyProjectionDigest: string
  readonly capabilityProbeRef: string
  readonly secretConfirmationRef: string
}

/** 秘密绑定：只带类别＋逻辑引用，`value` 类型上不存在（值不进简报/日志/提示词） */
export interface SecretBinding {
  readonly secretType: string
  readonly credentialRef: string
  readonly value?: undefined
}

export interface HostShape {
  readonly hostKind: string
  readonly version: string
  readonly bindingRef: string
}

export interface BudgetEnvelope {
  readonly currency: 'USD'
  readonly cap: number
  readonly perTurnCap?: number
}

export interface WatchdogParams {
  readonly heartbeatMs: number
  readonly wallClockCapMs: number
  readonly cancelGraceMs: number
}

export interface EvidenceObligation {
  readonly packageRef: string
  readonly requiredElements: readonly string[]
}

/**
 * 派发简报九件（v2/07 EXEC-01）：工作/合同版本、计划锁定、工作区、秘密类别＋逻辑
 * 引用、宿主形态、预算与看护参数、证据义务、策略投影引用与校验结论（preflight）。
 */
export interface DispatchBrief {
  readonly workRef: string
  readonly contractRef: string
  readonly planRef: string
  readonly workspaceRef: string
  readonly secrets: readonly SecretBinding[]
  readonly host: HostShape
  readonly budget: BudgetEnvelope
  readonly watchdog: WatchdogParams
  readonly evidenceObligation: EvidenceObligation
  readonly preflight: LaunchPreflight
}

/** 出工段引用（收割输入；也是 PORT-EVD.harvest 的段标识） */
export interface SegmentRef {
  readonly segmentId: string
  readonly workRef: string
  readonly attempt: number
  readonly executor: string
}

/** 启动回执：`started:true` 只证已启动；`isAcceptance:false` 阻「启动当验收」 */
export interface SegmentReceipt {
  readonly segment: SegmentRef
  readonly started: true
  readonly isAcceptance: false
  readonly startedAt: string
}

// ─────────────────────────────────────────────────────────────────────────────
// 三、观察与终态（流式事件只观察，不驱动迁移）
// ─────────────────────────────────────────────────────────────────────────────

/** 执行终态五值（值集唯一主表 v2/09 ENU-53；不压缩布尔） */
export type TerminalState = 'completed' | 'error' | 'blocked' | 'aborted' | 'limit_exceeded'

/** 出工段事件（只观察；收割输入，不得作为迁移触发器） */
export type SegmentEvent =
  | { readonly kind: 'started'; readonly segment: SegmentRef; readonly at: string }
  | { readonly kind: 'output'; readonly stream: 'stdout' | 'stderr'; readonly text: string }
  | { readonly kind: 'usage'; readonly tokens: TokenCounts }
  | {
      readonly kind: 'terminal'
      readonly terminal: TerminalState
      readonly resultUnknown: boolean
      readonly at: string
    }
  | { readonly kind: 'log'; readonly text: string }

/** 终态统计：五值原生字段，不压布尔；`resultUnknown:true`＝结果不明先对账 */
export interface TerminalStats {
  readonly terminal: TerminalState
  readonly resultUnknown: boolean
  readonly exitCode?: number
  readonly tokens: TokenCounts
  readonly duration: DurationMs
  readonly model?: string
}

export interface KillRequest {
  readonly segment: SegmentRef
  readonly reason: string
  readonly graceMs: number
}

/**
 * 终止回执（整树终止＋围栏）。观察到终态才可写 `terminal`；未观察到终态＝
 * `kind:'terminal-unobserved'` 且必带对账入口——不得按「已杀死」结案。
 */
export type KillReceipt =
  | {
      readonly kind: 'terminal-observed'
      readonly treeTerminated: true
      readonly fenced: true
      readonly terminal: TerminalState
    }
  | {
      readonly kind: 'terminal-unobserved'
      readonly treeTerminated: true
      readonly fenced: true
      readonly reconcile: ReconcileHandle
    }

// ─────────────────────────────────────────────────────────────────────────────
// 四、策略投影生成器（PRM；纯函数，v2/14 §六）
// ─────────────────────────────────────────────────────────────────────────────

/** 策略投影九段（值集唯一主表 v2/09 ENU-108） */
export type ProjectionSegment =
  | 'identity'
  | 'authority'
  | 'plan'
  | 'tools'
  | 'sandbox'
  | 'approval'
  | 'persona'
  | 'evidence'
  | 'validity'

export interface ProjectionSegmentValue {
  readonly enabled: boolean
  readonly sourceRefs: readonly string[]
  readonly note?: string
}

/**
 * 策略投影（PRM 生成结果）。九段全键必填；不支持的段进 `unsupportedSegments`
 * （不猜不填、不以缺省冒充支持）；`digest` 供逐字核对与重放。
 */
export interface PolicyProjection {
  readonly segments: Readonly<Record<ProjectionSegment, ProjectionSegmentValue>>
  readonly unsupportedSegments: readonly ProjectionSegment[]
  readonly digest: string
  readonly authorityRefs: readonly string[]
  readonly validity: {
    readonly from: string
    readonly until?: string
  }
}

/** 生成器输入：纯配置/引用面，不含秘密值、不含平台写入 */
export interface ProjectionInput {
  readonly companyId: string
  readonly workRef: string
  readonly planRef: string
  readonly grantRefs: readonly string[]
  readonly capabilityRefs: readonly string[]
  readonly host: HostShape
  readonly secretTypes: readonly string[]
  readonly validityFrom: string
  readonly validityUntil?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// 五、端口接口
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionPort {
  selectExecutor(c: SelectionChain, rc: ReadContext): PortResult<ExecutorChoice>
  launch(b: DispatchBrief, ctx: CallContext): PortResult<SegmentReceipt>
  observe(handle: SegmentRef): AsyncIterable<SegmentEvent>
  resultStats(handle: SegmentRef, rc: ReadContext): PortResult<TerminalStats>
  kill(req: KillRequest, ctx: CallContext): PortResult<KillReceipt>
  compileProjection(input: ProjectionInput): PortResult<PolicyProjection>
}
