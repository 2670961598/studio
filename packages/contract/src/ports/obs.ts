/**
 * PORT-OBS 观察与基础服务 —— 只读投影、时钟、标识、健康与资源观察
 * （docs/v2/05 §四；签名 docs/v2/14 §1.8；六态 docs/v2/08 §4.1；故障 §4.4；
 *   记录形状 v2/11 REC-OBS-01/02）
 *
 * 定位：监控/概览/对外三面共享的**只读**读面＋基础服务（时钟/标识注入）。
 * 必须拒绝：
 *   - 监控改事实：投影与故障回执在类型上恒 `mutatesFacts:false`／`readOnly:true`，
 *     本端口无写台账、无改事实源的方法槽（NEG-MON-03）；
 *   - 未知显示为零/空/绿：指标读数在 `unknown|stale|conflicted|gapped` 四态下**无
 *     `value` 槽**（NEG-MON-01）；受影响视图只能显示「未知/受损」，不得留空或沿用
 *     最后一张健康快照（§4.4）；
 *   - 在线率证明自治：健康报告 `autonomyProven` 恒 `false`（v2/05 §四）；
 *   - 三不可合并态（ENU-57）并入成功：`availability` 显式承载
 *     `unsupported|unavailable|unverified`，不得折叠为「健康」。
 * 零实现、零 IO；实现域 engine/observe＋panel/api 读面（v2/14 §二）。
 */
import type { EndpointRef } from './reg.ts'
import type {
  CallContext,
  CallerRef,
  CompanyRef,
  PortResult,
  ProofBoundary,
  ReadContext,
} from './def.ts'

/** 端口名常量 */
export const PORT_OBS = 'PORT-OBS' as const

// ─────────────────────────────────────────────────────────────────────────────
// 一、投影六态与快照（REC-OBS-01；MON-ST）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 投影六态（值集唯一主表 v2/09 ENU-52；语义主表 v2/08 §4.1）：
 * observed 已观察（有来源材料≠内容为真）｜derived 已推导（按声明规则可复算/解释）｜
 * unknown 未知（材料不足——**不得显示为零/无风险/已完成**）｜stale 陈旧（超新鲜度）｜
 * conflicted 冲突/受损（未解决差异，不得静默选边）｜gapped 缺口/中断（整段降级受损）。
 */
export const PROJECTION_STATES = [
  'observed',
  'derived',
  'unknown',
  'stale',
  'conflicted',
  'gapped',
] as const
export type ProjectionState = (typeof PROJECTION_STATES)[number]

/**
 * 观测面标识：`viewName` 取 MON- 观测面或端点视图名（值集不入契约——v2/09 零字面量
 * 纪律）；多公司视图按公司与知悉范围隔离，故 `company` 必填（SEC-WD-01）。
 */
export interface ViewId {
  readonly viewName: string
  readonly company: CompanyRef
}

/** 权威来源＝端点＋代次（须可解析到 REC-AUTH-07 激活记录，v2/11 REC-OBS-01） */
export interface ProjectionSource {
  readonly endpoint: EndpointRef
  readonly generation: number
}

/** 业务有效时间窗（v2/11 REC-OBS-01.data_valid_window；不是生成时间） */
export interface DataValidWindow {
  readonly from: string
  readonly to: string
}

/**
 * 逐观察面/逐指标状态槽（治 L3E-09）：「陈旧」「冲突」由此承载并可复核——
 * 依据＋最后可信游标必填，空依据不得自称已观察。
 */
export interface StateAssignment {
  readonly face: string
  readonly state: ProjectionState
  readonly basis: string
  readonly lastTrustedCursor: string
}

/** 完整性三值（值集唯一主表 v2/09 ENU-60；本类型专用命名 `view_completeness`） */
export type ViewCompleteness = 'complete' | 'incomplete' | 'unknown'

/**
 * 投影快照（REC-OBS-01；DOM-05 非权威）：只读、不得反向改写历史、不得成为第二事实源；
 * `stateAssignments` 非空（逐面状态槽），`stateLegend` 说明性可降级。
 * `readOnly`/`mutatesFacts` 两枚字面量是「监控不改事实」的公共类型承载。
 */
export interface Projection {
  readonly view: ViewId
  readonly projectionRuleVersion: string
  readonly authoritativeSource: ProjectionSource
  readonly sourceCursor: string
  readonly generatedAt: string
  readonly dataValidWindow: DataValidWindow
  readonly knowledgeScope: readonly [string, ...string[]]
  readonly viewCompleteness: ViewCompleteness
  readonly stateAssignments: readonly [StateAssignment, ...StateAssignment[]]
  readonly stateLegend?: string
  readonly readOnly: true
  readonly mutatesFacts: false
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、指标读数（未知不补 0 的类型表达；NEG-MON-01）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 指标读数：数值只在 `observed`/`derived` 两态存在；`unknown|stale|conflicted|gapped`
 * 在类型上**没有 `value` 槽**——不得以 0、空串、上一张健康快照或「全部正常」代替。
 * 非数值面（资源余额等）同此规：缺源＝未知，不补 0（v2/08 §4.1）。
 */
export type MetricReading =
  | {
      readonly metric: string
      readonly state: 'observed' | 'derived'
      readonly value: number
      readonly unit: string
      readonly basis: string
    }
  | {
      readonly metric: string
      readonly state: 'unknown' | 'stale' | 'conflicted' | 'gapped'
      readonly stateNote: string
      readonly lastTrustedCursor: string
      readonly value?: undefined
      readonly unit?: undefined
    }

// ─────────────────────────────────────────────────────────────────────────────
// 三、监控故障（REC-OBS-02；一等观察，不是沉默）
// ─────────────────────────────────────────────────────────────────────────────

/** 监控故障类别（值集唯一主表 v2/09 ENU-59；含陈旧视图/未裁冲突扩展类别） */
export const PROJECTION_FAULT_KINDS = [
  'collection_interrupted',
  'coverage_gap',
  'projection_failed',
  'source_unreachable',
  'cursor_broken',
  'stale_view',
  'conflict_unresolved',
] as const
export type ProjectionFaultKind = (typeof PROJECTION_FAULT_KINDS)[number]

/**
 * 受影响视图的显示效果：只允许「未知」或「受损」——留空、显示为零、沿用最后健康
 * 快照三者在此类型上都不成立（v2/08 §4.4）。
 */
export type DisplayEffect = 'unknown' | 'impaired'

/**
 * 依据投影限制新动作（v2/08 §4.4）：只能由信息门、预设叫停位置或事前授权的
 * fail-closed 策略执行，须留授权依据＋具名判断主体＋范围/期限/复审点。
 * 无 `basisRef` 的动作限制＝匿名限制，不得成立。
 */
export interface FaultActionRestriction {
  readonly basisRef: string
  readonly namedSubject: CallerRef
  readonly scope: readonly [string, ...string[]]
  readonly expiry: string
  readonly reviewPoint: string
}

/**
 * 监控故障（REC-OBS-02 写入面）：发生与发现时间分离；`lastTrustedCursor` 必填
 * （受影响视图期间以它为最后可信点）；恢复与根因可后补但不得省略显示效果。
 */
export interface ProjectionFault {
  readonly failureKind: ProjectionFaultKind
  readonly occurredAt: string
  readonly discoveredAt: string
  readonly affectedViews: readonly [ViewId, ...ViewId[]]
  readonly lastTrustedCursor: string
  readonly displayEffect: DisplayEffect
  readonly recoveryAt?: string
  readonly rootCauseClass: string
  readonly actionRestriction?: FaultActionRestriction
}

/**
 * 故障回执：`recordedAs:'projection_fault'`＋`mutatesFacts:false`＝投影侧记录，
 * **不进入事实 mutation 计数**（治 L3K-07；NEG-MON-03）。
 */
export interface FaultRef {
  readonly recordId: string
  readonly version: number
  readonly recordedAs: 'projection_fault'
  readonly mutatesFacts: false
}

// ─────────────────────────────────────────────────────────────────────────────
// 四、基础服务（时钟/标识注入、健康与资源观察）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 时钟读数：注入源须显式（`injected|system`）——读侧时钟与业务时钟的归属归实现，
 * 不得把局部操作状态混入权威历史（v2/08 §4.4）。
 */
export interface ClockReading {
  readonly now: string
  readonly source: 'injected' | 'system'
}

/** 标识（`newId`）：`kind` 为调用方命名空间字符串（值集不入契约）；`sortable` 声明可排序性 */
export interface Identifier {
  readonly kind: string
  readonly value: string
  readonly sortable: boolean
}

/**
 * 观察可用性（三不可合并态 ENU-57＋可用）：`unsupported|unavailable|unverified`
 * 不得并入「健康」；不可达不是健康，未核验不是可用（v2/05 §四）。
 */
export type ObservationAvailability = 'available' | 'unsupported' | 'unavailable' | 'unverified'

/** 资源读数一条（读数复用 `MetricReading`：未知不补 0） */
export interface ResourceSample {
  readonly resource: string
  readonly reading: MetricReading
  readonly sampledAt: string
}

/**
 * 健康与资源观察报告：`autonomyProven` 恒 `false`——在线率/心跳不证明自治
 * （v2/05 §四「在线率不证明自治」）；`proofBoundary` 逐项写证明/不证明什么。
 */
export interface HealthReport {
  readonly service: string
  readonly checkedAt: string
  readonly availability: ObservationAvailability
  readonly resources: readonly ResourceSample[]
  readonly autonomyProven: false
  readonly proofBoundary: ProofBoundary
}

// ─────────────────────────────────────────────────────────────────────────────
// 五、端口接口（读面＋基础服务；无改事实方法槽）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PORT-OBS：三面（监控/概览/对外 API）共享只读投影。
 * `reportFault` 是本端口唯一写方法，且只落投影侧故障记录（REC-OBS-02），
 * 不进事实 mutation 计数、不改历史。
 */
export interface ObservationPort {
  snapshot(view: ViewId, rc: ReadContext): PortResult<Projection>
  reportFault(f: ProjectionFault, ctx: CallContext): PortResult<FaultRef>
  clock(): ClockReading
  newId(kind: string): Identifier
  health(rc: ReadContext): PortResult<HealthReport>
}
