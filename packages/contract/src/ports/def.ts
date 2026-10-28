/**
 * PORT-DEF 定义目录 —— 定义修订的只读面（docs/v2/05 §四；签名 docs/v2/14 §1.1）
 *
 * 定位：读不可变修订、校验引用链、提供差异、列出定义条目。
 * 必须拒绝：草案当已批准（`DefinitionSnapshot.status` 只收 `effective`）；
 *           以「当前最新」代替精确修订引用（`DefRef.revision` 必填）；
 *           断链/版本漂移按 `ResolutionReport.problems` 显式报，不静默补链。
 * 零实现、零 IO：本件只有类型与字面量常量；写路径归 PORT-REG（domain 写者仍为 daemon）。
 *
 * ── 公共签名封套（v2/14 §0.2；跨端口共享）──────────────────────────────
 * 本件同时承载 `CallContext`/`ReadContext`/`PortResult`/失败十四类等公共封套。
 * 寄居原因：03-03 只允许在 `ports/` 新增十件且公共封套不属任何单一端口；为避免
 * 第十一件平铺散件（终态 20 件预算，v2/14 §二），以 def.ts（定义目录＝依赖图根）
 * 暂驻。其余九件一律 `import type` 本件，不复制形状；03-04 收口导出面时再评估
 * 是否移入 `index.ts`（本单不改 index.ts）。
 */

/** 端口名常量（03-04 导出面收口前，供 V2 冒烟按 §二映射逐件核对） */
export const PORT_DEF = 'PORT-DEF' as const

// ─────────────────────────────────────────────────────────────────────────────
// 一、公共签名封套（v2/14 §0.2）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 失败十四类（值集唯一主表 v2/09 ENU-58；本件只做类型面，不改义、不增删）。
 * `Err` 必答「副作用可能 / 可否重试 / 对账入口 / 责任位置」（v2/11 §0.4-6）。
 */
export type FailureCategory =
  | 'rejected_precondition'
  | 'rejected_authority'
  | 'rejected_forbidden'
  | 'rejected_state'
  | 'rejected_version'
  | 'rejected_idempotency'
  | 'unsupported'
  | 'unavailable'
  | 'unverified'
  | 'partial'
  | 'conflict'
  | 'timeout'
  | 'cancelled'
  | 'degraded'

/** 公司维（SEC-WD-01）：多公司部署的每个写方法必带；与平台绑定维不一致＝拒写 */
export interface CompanyRef {
  readonly companyId: string
  readonly slug: string
}

/**
 * 调用者三分（v2/11 REC-MEM-02.who 同轴）：任职／位置／程序。
 * 只承载身份，不承载权源——权源一律走 `CallContext.authority`（token/凭据不作权源）。
 */
export type CallerKind = 'employment' | 'position' | 'program'

export interface CallerRef {
  readonly callerId: string
  readonly kind: CallerKind
  readonly personId?: string
  readonly positionRef?: string
  readonly programRef?: string
}

/** 记录引用＝ID＋版本（v2/11 §0.4-1/2）；「当前最新」不是合法引用 */
export interface VersionRef {
  readonly recordId: string
  readonly version: number
}

/**
 * 授权子类型（值集唯一主表 v2/09 ENU-137）。v2/14 字段名 `grant_class`；
 * 与记录面同名类型避撞，本端口类型名取 `AuthorityGrantClass`（值集不复制）。
 */
export type AuthorityGrantClass = 'delegation' | 'root_delegation'

/** 权源主张＝记录引用；只作主张，核验唯一经 PORT-AUTH（v2/14 §0.2） */
export interface GrantRef {
  readonly recordId: string
  readonly version: VersionRef
  readonly grantClass: AuthorityGrantClass
}

/**
 * 署名三值（SEC-SIG-01；值集唯一主表 v2/09 ENU-118）：
 * person＝人员工号；control＝控制面位置＋决定记录引用；system＝系统代写（onBehalfOf 必填）。
 * 控制面署名缺 `decisionRef`、系统署名缺 `onBehalfOf`＝构造期非法。
 */
export type Signature =
  | { readonly actorKind: 'person'; readonly actorRef: string; readonly onBehalfOf?: string }
  | {
      readonly actorKind: 'control'
      readonly actorRef: string
      readonly decisionRef: string
      readonly onBehalfOf?: string
    }
  | { readonly actorKind: 'system'; readonly actorRef: string; readonly onBehalfOf: string }

/** 读面范围（SEC-RD-01 字段承载）：`fields` 非空＝至少声明一个可读字段；空集＝拒 */
export interface ReadScope {
  readonly company: CompanyRef
  readonly fields: readonly [string, ...string[]]
  readonly purpose: string
}

/** 读方法必带（v2/14 §0.2-1：读面缺省＝拒；越权 Err，不得 Ok(undefined) 冒充无行） */
export interface ReadContext {
  readonly readScope: ReadScope
  readonly caller: CallerRef
}

/**
 * 写方法封套（v2/14 §0.2；缺任一即构造期非法）。
 * `expected` 改状态调用必带（v2/11 §0.4-4：不匹配即拒并回当前版本）。
 */
export interface CallContext {
  readonly company: CompanyRef
  readonly caller: CallerRef
  readonly authority: readonly GrantRef[]
  readonly signature: Signature
  readonly expected?: VersionRef
}

/** 对账入口提示（REC-EVT-02）：记录类型＋定位键；`required:false` 也须给理由 */
export interface ReconcileQueryHint {
  readonly recordType: string
  readonly keys: Readonly<Record<string, string>>
}

export type ReconcileHandle =
  | { readonly required: true; readonly query: ReconcileQueryHint }
  | { readonly required: false; readonly reason: string }

/**
 * 分类失败（v2/14 §0.2 的 `ClassifiedError`；与 v0 `kernel.ts` 的两级错误分类
 * `ClassifiedError` 不同面——命名避撞，03-04 收口时保留本名）。
 */
export interface PortFailure {
  readonly category: FailureCategory
  readonly subcause: string
  readonly detail?: string
  readonly retryable: boolean
  readonly sideEffectPossible: boolean
  readonly reconcile: ReconcileHandle
  readonly responsiblePosition: string
}

/** 通用结果（顶层 `kind` 判别，v2/14 §0.2-6） */
export type Result<T, E> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'err'; readonly error: E }

export type PortResult<T> = Result<T, PortFailure>

/** 分页读面；`nextCursor` 缺省＝已到末页（不是「可能还有」） */
export interface Page<T> {
  readonly items: readonly T[]
  readonly nextCursor?: string
  readonly total?: number
}

/** 证据/决定的证明边界（v2/11 §0.7-1：证明什么、不证明什么） */
export interface ProofBoundary {
  readonly proves: readonly string[]
  readonly doesNotProve: readonly string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、PORT-DEF 定义目录
// ─────────────────────────────────────────────────────────────────────────────

/** 精确修订引用：ID＋修订号＋内容摘要；禁以「当前最新」代替 */
export interface DefRef {
  readonly definitionId: string
  readonly revision: number
  readonly digest: string
}

/** 具名批准戳（读面只读投影；权源引用保留，供审计链回溯） */
export interface ApprovalStamp {
  readonly approvalRef: string
  readonly approvedBy: CallerRef
  readonly decidedAt: string
  readonly authority: readonly GrantRef[]
}

/**
 * 不可变定义修订快照。`status` 只收 `effective`：草案/已提交（ENU-04）不得伪装成
 * 已批准（生效状态值集引 v2/09 ENU-62；草案读取不在本方法签名内）。
 */
export interface DefinitionSnapshot {
  readonly ref: DefRef
  readonly status: 'effective'
  readonly approval: ApprovalStamp
  readonly content: Readonly<Record<string, unknown>>
  readonly digest: string
  readonly immutable: true
}

/** 单条引用的解析结果：请求版本与解析版本必须可逐项对照 */
export interface ResolvedDefinition {
  readonly requested: DefRef
  readonly resolved: DefRef
  readonly chainComplete: boolean
}

/** 引用链问题（断链/版本漂移/非法「最新」引用）；`rejected:true`＝本次解析不得使用 */
export interface ResolutionProblem {
  readonly ref: DefRef
  readonly reason: string
  readonly rejected: boolean
}

export interface ResolutionReport {
  readonly resolved: readonly ResolvedDefinition[]
  readonly complete: boolean
  readonly versionAligned: boolean
  readonly problems: readonly ResolutionProblem[]
}

/** 定义差异的一条变更；`from/to` 缺省表示新增/删除 */
export interface DefinitionChange {
  readonly path: string
  readonly from?: unknown
  readonly to?: unknown
}

export interface DefDiff {
  readonly from: DefRef
  readonly to: DefRef
  readonly changes: readonly DefinitionChange[]
  readonly compatible: boolean
}

export interface DefQuery {
  readonly company: CompanyRef
  readonly kind?: string
  readonly cursor?: string
  readonly limit?: number
}

export interface DefEntry {
  readonly ref: DefRef
  readonly title: string
  readonly effective: boolean
}

/** PORT-DEF 只读端口（方法集覆盖读面：单修订/解析/差异/列表） */
export interface DefinitionPort {
  readRevision(ref: DefRef, rc: ReadContext): PortResult<DefinitionSnapshot>
  resolve(refs: readonly DefRef[], rc: ReadContext): PortResult<ResolutionReport>
  diff(from: DefRef, to: DefRef, rc: ReadContext): PortResult<DefDiff>
  list(q: DefQuery & ReadContext): PortResult<Page<DefEntry>>
}
