/**
 * PORT-TRUST 信任与秘密 —— 来源核验、凭据签发（逻辑引用）、短时供给、吊销、
 * 使用审计（docs/v2/05 §四；签名 docs/v2/14 §1.7；秘密五型 docs/v2/15 §四）
 *
 * 必须拒绝：秘密入包/提示词/快照/日志（`CredentialRef.value` 与
 *   `ShortLivedHandle.value` 在公共类型上恒不存在——值只走短时供给通道）；
 *   子 agent 持 root（`credentialClass:'root'` 类型上强制 root_delegation 引用；
 *   `'scoped'` 强制父凭据引用，且不得原地升级为 root）；未核验来源当已核验
 *   （`verifySource` 的未核验/失败＝Err，不返回部分 CallerRef）；吊销只删清单
 *   不验运行时（`RevocationReceipt` 三动作逐项字段）。
 * 目录不存值；值不入提示词/日志/快照（SEC-T3 域归 v2/15）。
 * 零实现、零 IO；凭据实现归 gateway/assembly 供给面。
 */
import type { DeactivationEvidence } from './auth.ts'
import type { CallContext, CallerRef, Page, PortResult, ReadContext } from './def.ts'

/** 端口名常量 */
export const PORT_TRUST = 'PORT-TRUST' as const

/** 来源令牌句柄（不透明；核验前不得当调用者身份） */
export interface TokenHandle {
  readonly handleId: string
  readonly tokenKind: string
}

/** 秘密五型（值集唯一主表 v2/09 ENU-117） */
export type SecretType =
  | 'platform_credential'
  | 'model_key'
  | 'signing_root_control'
  | 'per_task_shortlived'
  | 'external_outbound'

/**
 * 凭据类别（值集唯一主表 v2/09 ENU-136）：root 仅最高宰相；子 agent 只能 scoped。
 * v2/14 字段名 `credential_class`；与记录面同名类型避撞，本端口取 `CredentialCategory`。
 */
export type CredentialCategory = 'root' | 'scoped'

/** TTL 窗口：短时供给必带；`seconds` 是上限，不是预算 */
export interface TtlWindow {
  readonly seconds: number
}

/**
 * 签发请求的类别槽：root 必带 `rootDelegationRef`（外部老板→最高宰相的根授予）；
 * scoped 必带 `parentCredentialRef`（可追溯的父凭据）。两者互斥，不得同时出现。
 */
export type CredentialCategoryFields =
  | {
      readonly credentialClass: 'root'
      readonly rootDelegationRef: string
      readonly parentCredentialRef?: undefined
    }
  | {
      readonly credentialClass: 'scoped'
      readonly parentCredentialRef: string
      readonly rootDelegationRef?: undefined
    }

/** 签发请求（REC-AUTH-04）：只产逻辑引用，永不回值 */
export type CredentialIssueRequest = CredentialCategoryFields & {
  readonly holder: CallerRef
  readonly secretType: SecretType
  readonly scope: readonly [string, ...string[]]
  readonly ttl: TtlWindow
  readonly purpose: string
}

/**
 * 凭据逻辑引用（类别＋引用，永不带值）。`value` 恒不存在是类型级三不入
 * （提示词/日志/快照）的公共面保证。
 */
export interface CredentialRef {
  readonly credentialId: string
  readonly credentialClass: CredentialCategory
  readonly scope: readonly string[]
  readonly ttl: TtlWindow
  readonly value?: undefined
}

/**
 * 短时供给句柄：`singleUse:true`＋到期时点；值不在此结构内（只走实现侧
 * 受限通道，且不落日志/快照/提示词）。`value` 恒不存在。
 */
export interface ShortLivedHandle {
  readonly handleId: string
  readonly credential: CredentialRef
  readonly issuedAt: string
  readonly expiresAt: string
  readonly singleUse: true
  readonly value?: undefined
}

/**
 * 吊销回执：三动作逐项留证（撤销回执/停止注入/围栏拒绝记录）；
 * `injectionStopped:false` 时不得宣称凭据已失效。
 */
export interface RevocationReceipt {
  readonly recordId: string
  readonly revocationRecorded: true
  readonly injectionStopped: boolean
  readonly fenceRejectionRecorded: boolean
  readonly evidence: readonly DeactivationEvidence[]
}

export interface UseQuery {
  readonly credentialRef?: string
  readonly holder?: CallerRef
  readonly since?: string
  readonly until?: string
  readonly cursor?: string
  readonly limit?: number
}

/** 访问留痕（MON-09 消费面）：一次使用一条，含用途/结果/时点 */
export interface UseRecord {
  readonly recordId: string
  readonly credentialRef: string
  readonly holder: CallerRef
  readonly purpose: string
  readonly at: string
  readonly outcome: string
}

/** 端口接口：验来源/签发/短时供给/吊销/使用审计 */
export interface TrustPort {
  verifySource(handle: TokenHandle, rc: ReadContext): PortResult<CallerRef>
  issue(req: CredentialIssueRequest, ctx: CallContext): PortResult<CredentialRef>
  supply(ref: CredentialRef, window: TtlWindow, rc: ReadContext): PortResult<ShortLivedHandle>
  revoke(ref: CredentialRef, ctx: CallContext): PortResult<RevocationReceipt>
  auditUse(q: UseQuery, rc: ReadContext): PortResult<Page<UseRecord>>
}
