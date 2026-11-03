/**
 * serveconfig/signature —— 署名决定人解析与 daemon.yaml 键（SEC-FC-06 / SEC-SIG-01）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/15 §一 SEC-FC-06（系统代写署名常量：daemon 一切代写署名不得恒为 `actor:'daemon'`；
 *     代写必须走 `system` 署名语义，`onBehalfOf` 指向可还原工号或决定记录引用；常量 `daemon`
 *     不得作为最终署名出现在任何写路径）；
 *   - docs/v2/15 §二 SEC-SIG-01（署名主体三值 person/control/system；system 的 onBehalfOf 必填）；
 *   - docs/v2/17 NEG-SEC-06/N-f（署名不可还原决定人＝判负）；
 *   - docs/17-§2（主循环七相位：写路径归引擎相位 3-7，署名随写路径落账）、docs/17-§6（收割四要件）。
 *
 * 边界：本件零 IO（不读 env/墙钟），只做纯解析与配置键收窄；「先拆再增」（20-§十五.三.3：
 * serve/config.ts 顶 600 行阈）——studio-dev-567 真拆：daemon.yaml 署名键的**键面判定＋值域
 * 收窄整体**归本件单点入口 `coerceSignatureServeKey`，serve/config.ts 只留 import/extends 与
 * 一行委派（零分派实现、零注释折行）。
 */
import { configInvalid } from '@studio-next/contract'
import type { CompanySnapshot } from '@studio-next/contract'
import { NON_ACTOR_AUTHORS } from '@studio-next/gateway'
import { ENGINE_CONFIG_DEFAULTS, type EngineSignatureDraft } from '../../engine/engine.ts'

/** daemon.yaml 署名决定人键（扁平标量；SEC-FC-06） */
export const SIGNATURE_ON_BEHALF_OF_KEY = 'signatureOnBehalfOf' as const

/** 署名子配置面（ServeConfig extends 本接口——与 HrServeConfig/RestartServeConfig 同款扩法） */
export interface SignatureServeConfig {
  /**
   * 署名决定人（system 代写署名的 `onBehalfOf`）：可还原工号或决定记录引用。
   * 缺省=组织快照在册最高责任人；无公司目录 demo 装配回落迁移期常量（降级标记）；其余形态
   * 无在册人员＝CONFIG_INVALID 拒启（常量 daemon 不得作为最终署名——不静默回落公开常量）。
   */
  signatureOnBehalfOf?: string
}

/**
 * 签名键分派唯一入口（studio-dev-567 真拆：键面判定＋值域收窄一体，调用方零分派实现）。
 * 命中本件键→校验并写值、返回 true；未命中→返回 false（未知键仍由调用方 fail-closed 拒——
 * 本件不接管未知键错误面，错误消息归配置键表所有者）。
 */
export function coerceSignatureServeKey(cfg: SignatureServeConfig, key: string, value: string | number | boolean): boolean {
  if (key !== SIGNATURE_ON_BEHALF_OF_KEY) return false
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`daemon.yaml：${SIGNATURE_ON_BEHALF_OF_KEY} 须为非空字符串（可还原工号或决定记录引用）`)
  }
  cfg.signatureOnBehalfOf = value.trim()
  return true
}

/** 署名决定人来源（启动日志判读面；SEC-FC-06「决定人可还原」的证据位） */
export type SignatureOnBehalfOfOrigin = 'config' | 'snapshot' | 'migration'

/** 署名身份三件（DaemonIdentity 的署名面；author=决定人，signature=引擎写路径三值） */
export interface SignatureIdentity {
  /** 最终署名主体＝决定人（SignedBody.author / 网关落款；不再恒 'daemon'） */
  author: string
  /** 引擎写路径署名三值（createEngine 注入；system 必携 onBehalfOf） */
  signature: EngineSignatureDraft
  /** 决定人来源（config=daemon.yaml 显式；snapshot=组织快照最高责任人；migration=demo 迁移期常量） */
  signatureOrigin: SignatureOnBehalfOfOrigin
}

/** 非人占位主体（与 gateway `NON_ACTOR_AUTHORS` 同源；常量 daemon 不得作为最终署名） */
const NON_ACTOR_AUTHOR_SET: ReadonlySet<string> = new Set(NON_ACTOR_AUTHORS)

/** 解析所需配置面（结构参数——避免 serve/config 与本件类型环） */
export interface SignatureIdentityConfig {
  readonly signatureOnBehalfOf?: string
  readonly companyDir?: string
  readonly platform: string
}

/**
 * 署名决定人解析（SEC-FC-06 / SEC-SIG-01；studio-dev-529）。
 *
 * 解析序（前者在场即胜，不静默混用）：
 *   ①daemon.yaml `signatureOnBehalfOf`（显式：工号或决定记录引用；非人占位主体拒）；
 *   ②组织快照在册最高责任人（status=active，G 档最高；同档按工号定序——确定性、可还原）；
 *   ③无公司目录 demo 装配（platform: fake 且未挂公司目录）→ 迁移期常量并打降级标记；
 *   ④其余形态（真实平台/已挂公司目录但无在册人员）＝ `CONFIG_INVALID/sig-no-decision-maker` 拒启。
 */
export function resolveSignatureIdentity(config: SignatureIdentityConfig, snapshot: CompanySnapshot): SignatureIdentity {
  const explicit = (config.signatureOnBehalfOf ?? '').trim()
  if (explicit !== '') {
    if (NON_ACTOR_AUTHOR_SET.has(explicit.toLowerCase())) {
      configInvalid(
        'sig-placeholder-decision-maker',
        `${SIGNATURE_ON_BEHALF_OF_KEY}=${explicit} 是非人占位主体（daemon/system/tool/company 不是可结算署名）——须填可还原工号或决定记录引用（SEC-FC-06/SEC-SIG-01）`,
      )
    }
    return signatureOf(explicit, 'config')
  }
  // 在册最高责任人（status 缺省按 active 消费——PersonRef 同款口径）；同档按工号定序
  const active = snapshot.people.filter((person) => (person.status ?? 'active') === 'active')
  const top = [...active].sort((a, b) => b.level - a.level || a.id.localeCompare(b.id))[0]
  if (top !== undefined) return signatureOf(top.id, 'snapshot')
  // 无人员档案：仅「无公司目录 demo 装配」允许迁移期常量（与 SEC-FC-02 同款 demo 豁免）
  if (config.companyDir === undefined && config.platform === 'fake') return signatureOf(ENGINE_CONFIG_DEFAULTS.actor, 'migration')
  configInvalid(
    'sig-no-decision-maker',
    `署名决定人无法还原：daemon.yaml 未配 ${SIGNATURE_ON_BEHALF_OF_KEY} 且公司目录无在册人员（system 代写必须可还原决定人——SEC-FC-06/SEC-SIG-01；常量 daemon 不得作为最终署名）`,
  )
}

/** 三值署名组装（actorRef=通道位 daemon 进程，onBehalfOf=决定人——actorRef 不充当最终署名） */
function signatureOf(onBehalfOf: string, origin: SignatureOnBehalfOfOrigin): SignatureIdentity {
  return {
    author: onBehalfOf,
    signature: { actorKind: 'system', actorRef: ENGINE_CONFIG_DEFAULTS.actor, onBehalfOf },
    signatureOrigin: origin,
  }
}
