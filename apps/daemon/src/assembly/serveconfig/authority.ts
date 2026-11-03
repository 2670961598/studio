/**
 * serveconfig/authority —— 授权闸模式键（studio-dev-579：shadow→enforce 接线路径）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/15 §一 SEC-FC-08（授权闸长期 shadow 放行＋证据只进日志＝禁止形态）；
 *   - docs/v2/08 §1.9（授权判定证据落账与 SQL 读面）；
 *   - docs/17-§2（主循环七相位：写路径经 gated-platform 收口）。
 *
 * 键面（扁平 YAML 标量，缺省不写＝shadow）：
 *   - `authorityRequireClaim: true|false` —— true=无主张即拒（enforce）；缺省 false=shadow。
 *   - `authorityEnforceBy: YYYY-MM-DD`     —— shadow 的失效日（UTC 零点）；过期仍 shadow＝拒启。
 *
 * 边界：本件零 IO；只做键面判定＋值域收窄（日期解析复用 engine/tools/authority-policy 单点）。
 */
import {
  AUTHORITY_ENFORCE_BY_KEY,
  AUTHORITY_REQUIRE_CLAIM_KEY,
  parseAuthorityEnforceByMs,
} from '../../engine/tools/authority-policy.ts'
import type { RootDelegationOptions } from '@studio-next/gateway'
import type { AuthorityEvidenceLedgerFace } from '../../engine/tools/authority-evidence.ts'

/** 授权模式子配置面（ServeConfig extends 本接口——与 SignatureServeConfig 同款扩法） */
export interface AuthorityServeConfig {
  /** true=无主张也拒（enforce）；缺省/false=影子观测（shadow，放行但留痕） */
  authorityRequireClaim?: boolean
  /** shadow 失效日（ISO YYYY-MM-DD，UTC 零点）；缺省=未声明（启动日志打欠账标记） */
  authorityEnforceBy?: string
}

/**
 * 授权键分派唯一入口：命中本件键→校验并写值、返回 true；未命中→false
 *（未知键仍由调用方 fail-closed 拒——本件不接管未知键错误面）。
 */
export function coerceAuthorityServeKey(
  cfg: AuthorityServeConfig,
  key: string,
  value: string | number | boolean,
): boolean {
  if (key === AUTHORITY_REQUIRE_CLAIM_KEY) {
    if (typeof value !== 'boolean') {
      throw new Error(`daemon.yaml：${AUTHORITY_REQUIRE_CLAIM_KEY} 须为 true|false（实得 ${String(value)}）`)
    }
    cfg.authorityRequireClaim = value
    return true
  }
  if (key === AUTHORITY_ENFORCE_BY_KEY) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`daemon.yaml：${AUTHORITY_ENFORCE_BY_KEY} 须为 ISO 日期 YYYY-MM-DD（实得 ${String(value)}）`)
    }
    parseAuthorityEnforceByMs(value) // 解析即验：坏日期启动拒（fail-closed，不猜）
    cfg.authorityEnforceBy = value.trim()
    return true
  }
  return false
}

/**
 * 授权证据/模式装配块（先拆后增：studio-dev-623 Q6 适配——原 buildServeRuntime 内联体整块搬入，
 * 字段/口径逐字等价；runtime 只留一行展开调用——文档见下「搬移前原位注释」）。
 *
 * 搬移前原位注释（随块保留，非折行/非删除）：
 *   - 授权判定证据落账（studio-dev-579；docs/v2/08 §1.9／v2/15 SEC-FC-08）：同一台账句柄（已过
 *     三不入·库闸）注入 sink——证据写 events/GW_AUTHORITY_DECISION，非仅日志；模式键随配置。
 *   - #528 授权链闸与派生树面共用同一实例（同一 grants 快照，不双源）——authority 实例仍由
 *     调用方直接传入 wireGatedPlatform；本件只负责 evidence 与模式三键。
 */
export interface AuthorityEvidenceGateOptions {
  readonly authorityEvidence: {
    readonly ledger: AuthorityEvidenceLedgerFace
    readonly company: string
    readonly actor: string
    readonly dept: string
    readonly level: number
  }
  readonly root?: RootDelegationOptions
  readonly requireClaim?: boolean
  readonly enforceBy?: string
}

export function authorityEvidenceGateOptions(args: {
  readonly ledger: AuthorityEvidenceLedgerFace
  readonly company: string
  readonly actor: string
  readonly dept: string
  readonly level: number
  readonly root?: RootDelegationOptions | undefined
  readonly config: AuthorityServeConfig
}): AuthorityEvidenceGateOptions {
  return {
    ...(args.root !== undefined ? { root: args.root } : {}),
    authorityEvidence: { ledger: args.ledger, company: args.company, actor: args.actor, dept: args.dept, level: args.level },
    ...(args.config.authorityRequireClaim !== undefined ? { requireClaim: args.config.authorityRequireClaim } : {}),
    ...(args.config.authorityEnforceBy !== undefined ? { enforceBy: args.config.authorityEnforceBy } : {}),
  }
}
