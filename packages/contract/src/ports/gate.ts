/**
 * PORT-GATE 入口与通知 —— 外部意图/反馈入口、通知、送达与来源证据
 * （docs/v2/05 §四；签名 docs/v2/14 §1.8；对外端点面 §四；凭证三档 ENU-120/工具面分级 ENU-121）
 *
 * 定位：外部（MCP/HTTP/订阅）意图的**唯一入口**，只落单不派工——`receiveIntent` 只产
 *   意图与回执；受理结论（REC-WORK-02）在 PORT-WORK，派工与收割是**显式不存在的
 *   第三级工具面**（ENU-121），故本端口没有 launch/dispatch/直写台账的方法槽。
 * 必须拒绝：
 *   - 消息当承诺：回执 `outcome` 只取 `queued`（202＝已入队≠已受理），且受理/验收
 *     结论槽恒不存在（`intakeVerdict`/`acceptedAt`）；
 *   - 通知发送当对方接受：`deliveryState` 只 `sent|unknown`，`acceptedBy` 恒不存在；
 *     已发送而结果不明＝先对账（不按失败重试，§0.2-2）；
 *   - 「查不到＝没有」：`receipt` 的 `undefined` 只表**本进程投影快照未命中**，
 *     对外映射 503（receipt-not-in-snapshot），不得映射 404；
 *   - 单静态 token 入站（三档凭证在类型上无 `token` 槽；`public` 档只读，不入站）；
 *   - 外部委托主体/派单人锚留空（未映射＝显式声明＋identity_mapping 依据）。
 * 零实现、零 IO；实现域 assembly/intent＋api 装配（v2/14 §二）。
 */
import type {
  CallContext,
  CallerRef,
  CompanyRef,
  PortResult,
  ReadContext,
  ReconcileHandle,
} from './def.ts'

/** 端口名常量 */
export const PORT_GATE = 'PORT-GATE' as const

// ─────────────────────────────────────────────────────────────────────────────
// 一、凭证与工具面分级（ENU-120/ENU-121；对外 API 面唯一入口口径）
// ─────────────────────────────────────────────────────────────────────────────

/** 入站凭证三档（值集唯一主表 v2/09 ENU-120）；单静态 token＝禁止形态 */
export const API_CREDENTIAL_TIERS = ['public', 'partner', 'signed'] as const
export type ApiCredentialTier = (typeof API_CREDENTIAL_TIERS)[number]

/**
 * 工具面分级（值集唯一主表 v2/09 ENU-121）：只读｜落单与评论。
 * 第三级「派工与收割」**显式不存在**（不是「默认不授」的开关）。
 */
export const API_TOOL_SCOPES = ['read_only', 'intake_comment'] as const
export type ApiToolScope = (typeof API_TOOL_SCOPES)[number]

/**
 * 入站凭证槽：`partner` 携凭据目录逻辑引用（→REC-AUTH-04）；`signed` 携 HMAC＋时间戳
 * ＋nonce（重放窗与载荷上限归实现）。`public` 档只读面，**不在本入口的入站类型内**
 * ——落单必须是有身份的可追溯档。
 */
export type IntentAuth =
  | {
      readonly tier: 'partner'
      readonly credentialRef: string
      readonly timestamp?: undefined
    }
  | {
      readonly tier: 'signed'
      readonly hmacRef: string
      readonly timestamp: string
      readonly nonce: string
      readonly credentialRef?: undefined
    }

// ─────────────────────────────────────────────────────────────────────────────
// 二、外部意图（REC-WORK-01 入口；外部委托主体与派单人锚 V11-01）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 外部委托主体（v2/14 §四公共槽）：未映射时须显式声明外部主体＋`identity_mapping`
 * 依据，不得留空——空主体＝匿名委托，类型上不成立。
 */
export type CommissionerRef =
  | {
      readonly mapped: true
      readonly caller: CallerRef
      readonly identityMappingBasis?: undefined
    }
  | {
      readonly mapped: false
      readonly externalPrincipal: string
      readonly identityMappingBasis: string
      readonly caller?: undefined
    }

/**
 * 派单人锚：缺省＝**意图受理治理位**（N=1 默认形态＝最高宰相；N>1 按域＝所属一级
 * 单元首长，v2/03 表 D），等级封顶随锚声明。缺省不是「无锚」：须显式声明
 * `defaulted:true`＋解析依据，省略与留空在类型上不可互换。
 */
export type DispatcherAnchor =
  | {
      readonly defaulted?: false
      readonly anchor: CallerRef
      readonly resolvedBy?: undefined
    }
  | {
      readonly defaulted: true
      readonly resolvedBy: 'intake_governance_position'
      readonly anchor?: undefined
    }

/**
 * 意图保留键四槽＝（公司×来源×种类×票据或去重键）；四槽任一留空即不构成保留键
 * （实例化自幂等五元组，v2/14 §0.2-3）。`key`＝票据 ID 或去重键；`receipt` 以此回查。
 */
export interface IntentKey {
  readonly company: CompanyRef
  readonly source: string
  readonly requestKind: string
  readonly key: string
}

/**
 * 外部意图封套。`toolScope` 恒为 `intake_comment`：只读级调用本入口＝越级；
 * 类型上无 worker/执行体/台账槽（只落单不派工）。
 */
export type ExternalIntent = IntentKey & {
  readonly toolScope: 'intake_comment'
  readonly auth: IntentAuth
  readonly commissioner: CommissionerRef
  readonly dispatcherAnchor: DispatcherAnchor
  readonly submittedBy: CallerRef
  readonly body: Readonly<Record<string, unknown>>
  readonly payloadDigest: string
  readonly correlation?: string
  readonly receivedAt: string
}

/**
 * 意图回执（REC-WORK-01 入口侧）：`outcome` 只取 `queued`（ENU-122 五值中唯一属
 * 触发回执者）；`intentRef` 随队列传递到受理面（治 L3J-P1-04）；`deduped:true`＝
 * 同键同内容返回既有结果，不产生第二次副作用（同键异内容＝`rejected_idempotency`）。
 */
export interface IntentReceipt {
  readonly intentRef: string
  readonly identity: IntentKey
  readonly outcome: 'queued'
  readonly commissionerRef: string
  readonly anchorRef: string
  readonly queuedAt: string
  readonly deduped: boolean
  /** 受理结论不在入口（归 PORT-WORK.recordIntake → REC-WORK-02） */
  readonly intakeVerdict?: undefined
  readonly acceptedAt?: undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// 三、通知与送达（送达≠接受；保存送达与来源证据）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 通知封套（吸收 v0 `notifier.ts` 的 Notification 语义；MIG-06 前两件并存，
 * 见 notifier.ts 头注）：`notificationId`＋`dedupKey` 直达订阅方；
 * `evidenceRefs` 留送达与来源证据（缺证据不得宣称已送达）。
 */
export interface NotificationEnvelope {
  readonly notificationId: string
  readonly dedupKey: string
  readonly company: CompanyRef
  readonly kind: string
  readonly title: string
  readonly body: string
  readonly subscriptionRefs: readonly [string, ...string[]]
  readonly correlation?: string
  readonly evidenceRefs: readonly string[]
}

/**
 * 送达状态：`sent`＝已交出（**不证明对方接受**）；`unknown`＝已发送结果不明
 * （先对账，REC-EVT-02；不得按失败一刀切重试）。
 */
export type DeliveryState = 'sent' | 'unknown'

/**
 * 送达回执：`acceptedBy` 恒不存在＝发送与接受分离（v2/05 §四「通知发送≠对方接受」）；
 * 对方的接受/异议只经外部意图另行受理，不在此回执内宣告。
 */
export interface DeliveryReceipt {
  readonly notificationId: string
  readonly dedupKey: string
  readonly deliveryState: DeliveryState
  readonly deliveredAt?: string
  readonly targets: readonly [string, ...string[]]
  readonly evidenceRefs: readonly string[]
  readonly deduped: boolean
  readonly acceptedBy?: undefined
  readonly reconcile: ReconcileHandle
}

// ─────────────────────────────────────────────────────────────────────────────
// 四、端口接口（三方法；无派工/收割/直写面＝显式不存在的第三级）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PORT-GATE：外部意图唯一入口＋通知出口。
 * `receipt` 的读面语义：`undefined`＝快照未命中（≠不存在）；越权＝`Err`（§0.2-1）。
 */
export interface GatePort {
  receiveIntent(p: ExternalIntent, ctx: CallContext): PortResult<IntentReceipt>
  receipt(key: IntentKey, rc: ReadContext): PortResult<IntentReceipt | undefined>
  notify(e: NotificationEnvelope, ctx: CallContext): PortResult<DeliveryReceipt>
}
