/**
 * 网关门面 —— 写路径收口闸（docs/17-§7：agent 对平台的一切写入经此，不留绕过通道）
 *
 * 组装三件：wkey 校验（鉴权）→ 动作词校验（结构化意图）→ 署名注入（身份落款）。
 *
 * 冻结口径（拟稿，改动先过批示）：
 *   - 两级错误对齐（17-§9 / errors.ts）：**构造期**配置非法（缺/空/过短/弱形态签根、坏署名上下文）
 *     抛 CONFIG_INVALID/gw-*（configInvalid 通道）；**运行期**拒绝不抛——返回 {allowed:false,
 *     reason:'gw-verify-<子码>'|'gw-action-<子码>'|'gw-root-<子码>'|...}，子码与 wkey/actions/
 *     root-delegation 的拒绝码一一对应
 *   - **SEC-FC-02 fail-closed**（v2/15 §一；plan/05 IMPL-07-06）：签根只从装配注入，**不回落任何
 *     仓内常量**——缺失（非 Uint8Array）/空/不足 32 字节/弱形态（全零、单一可打印字节重复）＝
 *     构造期 CONFIG_INVALID 拒启；错误消息只报形态不报值
 *   - **SEC-ROOT-02 启动腿**（v2/15 §7.3；plan/05 IMPL-07-06）：给出 `root` 装配面即在构造期验
 *     `root_delegation`，任一失败＝CONFIG_INVALID 拒启（最高宰相位不得落成可签发状态）；未装配
 *     root 面时 `rootPreflight` 恒拒 `gw-root-no-delegation`（fail-closed，不开「缺省放行」口）
 *   - gateWrite(token, action, payload)：action=调用方申报的动作（scope 校验锚点）；
 *     payload=写入正文。payload 首行若是 `@action` 指令则解析出的动作必须与申报动作一致
 *     （不一致=gw-action-mismatch——申报与实文分叉即拒，不猜以哪边为准）
 *   - 署名不改写正文：signed.body = payload 原文（gateway 只做鉴权+落款，正文语义归平台适配器）
 *   - 【顺序拟稿】任务书口径「先 verify 后 parseAction」在结构化路径原样执行；自由中文路径
 *     **前置短路**（isFreeformChinese 且非 @action 行 → 直接 needsLlmFallback，不跑 verify 不烧
 *     nonce——LLM 回退重提交要用同一 token；fallback 只是路由信号不是授权，无信息泄露）。
 *     结构化路径 verify 成功即烧 nonce，其后 parse 失败不退（客户端须重新领 key：一调用一签发）
 *   - **ctl- 词族二次入口**（SEC-SIG-03；plan/05 IMPL-07-10）：控制面平台写走 `gateWriteCtl`
 *     （申报动作 ∈ ctl- 六动词），与 `gateWrite`（worker 面六动词）共用同一闸链（verify →
 *     parse → 申报/实文一致 → 署名）；两个入口只切申报动词域，**不是两条闸**、不设旁路。
 *     申报与首行字面动词分叉＝gw-action-mismatch；args.op 自述与申报动作分叉同拒
 *     （resolveAuditAction.mismatch → gw-action-mismatch，不猜以哪边为准）。
 *     迁移期 comment + args.op 借道允许：结果附 audit（审计动作还原为 ctl-，downgraded=true），
 *     交台账记降级标记——transition 不得显示为 comment（v2/15 §二）。
 *   - 实例按单绑定：opts.ticket 是本闸收口的单号（verify 的单号绑定锚）。控制面自用请用
 *     ticket=CONTROL_TICKET 的独立实例（17-§7：控制面也过网关，但不与按单实例混用）
 */
import { CONTROL_TICKET, createWkeyAuthority, issueControlKey as issueControlKeyOn } from './wkey.ts'
import type { ControlKey, GatewayWkeyClaims, WkeyAuthority, WkeyRejectReason } from './wkey.ts'
import { isCtlAction, isFreeformChinese, isGatewayAction, parseAction, resolveAuditAction } from './actions.ts'
import type { ActionAudit, ActionRejectReason, CtlAction, GatewayActionWord } from './actions.ts'
import { signedBody } from './signature.ts'
import type { SignatureContext } from './signature.ts'
import { createRootDelegationGate } from './root-delegation.ts'
import type { RootActionRequest, RootDelegationOptions, RootPreflightResult } from './root-delegation.ts'
import { configInvalid } from '@studio-next/contract'
import type { GatewayAction, PersonId, SignedBody, TicketId } from '@studio-next/contract'

/** 运行期拒绝码（gw- 前缀族；子码继承 wkey/actions 的拒绝码） */
export type GateRejectReason = `gw-verify-${WkeyRejectReason}` | `gw-action-${ActionRejectReason}` | 'gw-action-mismatch' | 'gw-freeform-chinese'

export type GateWriteResult =
  | {
      allowed: true
      /** 申报动作（worker 面六动词或 ctl- 六动词）——审计面 transition 不得显示为 comment */
      action: GatewayActionWord
      args: Record<string, unknown>
      signed: SignedBody
      /** 仅迁移期 comment + args.op 借道时出现：审计动作已还原为 ctl-，downgraded=true（记台账） */
      audit?: ActionAudit
    }
  | { allowed: false; reason: GateRejectReason; needsLlmFallback?: true }

/** 签根最小长度（HMAC-SHA256 门限；SEC-FC-02：不足即拒启，不做「短钥也能跑」的降级） */
const MIN_GATEWAY_SECRET_BYTES = 32

export interface GatewayOptions {
  /**
   * HMAC 签根（透传 wkey 机构）。**无缺省、不回落仓内常量**（SEC-FC-02）：缺失/空/不足 32 字节/
   * 弱形态即构造期 CONFIG_INVALID 拒启。值只进 HMAC，永不入日志/错误消息/台账。
   */
  secret: Uint8Array
  /** epoch ms 时钟（求确定性可注入） */
  clock: () => number
  /** 本闸收口的单号（verify 单号绑定锚；控制面实例用 CONTROL_TICKET） */
  ticket: TicketId
  /** 署名上下文（公司/部门/岗位/级别——人事档案四身份位） */
  ctx: SignatureContext
  /** 署名工号（SignedBody.author） */
  author: PersonId
  /**
   * root 签发面装配输入（可选；SEC-ROOT-02 启动腿）：给出即在构造期验 `root_delegation`——
   * 无委任/记录不可读/授予人非外部老板/证明未核验/指纹不符/已撤回/期限外/行使人或凭据类别
   * 不合，任一失败＝CONFIG_INVALID 拒启（**不降级为告警继续**）。
   */
  root?: RootDelegationOptions
}

export interface Gateway {
  /** worker 面写路径闸（申报动作 ∈ contract 六动词）：鉴权 → 结构化校验 → 署名。任一步失败=拒+reason 码 */
  gateWrite(token: string, action: GatewayAction, payload: string): GateWriteResult
  /**
   * 控制面平台写路径闸（申报动作 ∈ ctl- 六动词；SEC-SIG-03）：与 gateWrite 同一条闸链，
   * 只切申报动词域——不是第二条闸，无旁路。申报/实文分叉仍返 gw-action-mismatch。
   */
  gateWriteCtl(token: string, action: CtlAction, payload: string): GateWriteResult
  /** 签发按单 wkey（daemon 派工时给 worker 的唯一凭据；nonce 由调用方给定） */
  issue(claims: GatewayWkeyClaims): string
  /** 控制面自用 wkey（scope 全开，独立类型；头注警示见 wkey.ts） */
  issueControlKey(opts?: { ttl?: string }): ControlKey
  /** 关单即吊销（透传 wkey 机构；幂等） */
  revoke(ticket: TicketId): void
  /**
   * root 动作签发 preflight（SEC-ROOT-05 四硬拒绝；运行期不抛错，拒绝返 `gw-root-*` 纯码）。
   * 未装配 root 面时恒拒 `gw-root-no-delegation`——「没配」不得解释成「不用验」。
   */
  rootPreflight(request: RootActionRequest): RootPreflightResult
  /** 底层机构（审计/测试用；生产不得绕过 gateWrite 直调 verify 写路径） */
  readonly authority: WkeyAuthority
}

/**
 * 签根 fail-closed 校验（SEC-FC-02）：类型/空/长度/弱形态四门，任一不过即构造期抛。
 * 弱形态判据＝全零，或「单一可打印 ASCII 字节重复」（占位密钥形态，如 'aaaa…'/'0000…'）；
 * 二进制夹具（非可打印单字节填充）不在此列——那由长度门与调用面纪律管，不臆造熵估计。
 */
function assertGatewaySecret(secret: unknown): Uint8Array {
  if (!(secret instanceof Uint8Array)) {
    throw configInvalid(
      'gw-secret-missing',
      '网关签根未注入（GatewayOptions.secret 须为 Uint8Array；SEC-FC-02：无配置＝拒启，不回落仓内常量）',
    )
  }
  if (secret.byteLength === 0) throw configInvalid('gw-secret-empty', '网关签根不得为空（SEC-FC-02）')
  if (secret.byteLength < MIN_GATEWAY_SECRET_BYTES) {
    throw configInvalid(
      'gw-secret-too-short',
      `网关签根至少 ${MIN_GATEWAY_SECRET_BYTES} 字节（HMAC-SHA256 门限；SEC-FC-02），收到 ${secret.byteLength}`,
    )
  }
  const first = secret[0]
  if (first === undefined) throw configInvalid('gw-secret-empty', '网关签根不得为空（SEC-FC-02）')
  let uniform = true
  for (const byte of secret) {
    if (byte !== first) {
      uniform = false
      break
    }
  }
  const printable = first >= 0x20 && first <= 0x7e
  if (uniform && (first === 0x00 || printable)) {
    throw configInvalid('gw-secret-weak', '网关签根形态过弱（全零或单一可打印字节重复＝占位密钥；SEC-FC-02 拒启）')
  }
  return secret
}

/** createGateway —— 组装写路径收口闸（纯逻辑零 IO） */
export function createGateway(opts: GatewayOptions): Gateway {
  const secret = assertGatewaySecret(opts.secret)
  const authority = createWkeyAuthority(secret, opts.clock)
  if (opts.ticket === '') throw configInvalid('gw-empty-ticket', '网关实例绑定的单号不得为空')
  // root 面装配（SEC-ROOT-02 启动腿）：构造期即验，失败＝CONFIG_INVALID 抛错（对象不产出）
  const rootGate =
    opts.root === undefined
      ? undefined
      : createRootDelegationGate({ ...opts.root, clock: opts.root.clock ?? opts.clock })

  /**
   * 唯一闸链（两个入口共用；SEC-SIG-03）：申报动作→verify（含 scope）→parse→申报/实文一致
   * →op 自述一致→署名。入口只决定申报动词域，不增删任何一步检查。
   */
  function runGate(token: string, action: GatewayActionWord, payload: string): GateWriteResult {
    // 0) 自由中文前置短路（不烧 nonce；只标记，LLM 回退归上层——17-§7）
    if (!payload.startsWith('@action') && isFreeformChinese(payload)) {
      return { allowed: false, reason: 'gw-freeform-chinese', needsLlmFallback: true }
    }
    // 1) 鉴权（签名/吊销/过期/单号/scope/nonce 重放，fail-closed 全家）
    const verified = authority.verify(token, { now: opts.clock(), ticket: opts.ticket, action })
    if (!verified.ok) return { allowed: false, reason: `gw-verify-${verified.reason}` }
    // 2) 结构化校验（申报动作 vs payload 首行字面动词，分叉即拒）
    const parsed = parseAction(payload)
    if (!parsed.ok) {
      // 到这一步的 not-an-action 必是非中文非结构化正文（中文已在 0 短路）——纯拒
      return { allowed: false, reason: `gw-action-${parsed.reason}` }
    }
    if (parsed.action !== action) return { allowed: false, reason: 'gw-action-mismatch' }
    // 3) args.op 自述一致性（迁移期借道口径）：分叉同拒；借道只在 comment + 控制面 op 一处合法
    const audit = resolveAuditAction(action, parsed.args)
    if (audit.mismatch) return { allowed: false, reason: 'gw-action-mismatch' }
    // 4) 署名注入（正文不改写；落款=四身份位）
    const signed = signedBody(opts.ctx, opts.author, payload)
    // 借道写附审计行（降级标记）——transition 不得显示为 comment；非借道不增字段（冻结结果形状）
    return audit.downgraded ? { allowed: true, action, args: parsed.args, signed, audit } : { allowed: true, action, args: parsed.args, signed }
  }

  return {
    authority,
    issue: (claims) => authority.issue(claims),
    issueControlKey: (o) => issueControlKeyOn(authority, o),
    revoke: (ticket) => authority.revoke(ticket),
    rootPreflight: (request) =>
      rootGate === undefined ? { allowed: false, reason: 'gw-root-no-delegation' } : rootGate.preflight(request),

    gateWrite(token: string, action: GatewayAction, payload: string): GateWriteResult {
      // 运行期硬化（擦除后无类型）：worker 面入口只收 contract 六动词，ctl- 不得从此口混入
      if (!isGatewayAction(action)) return { allowed: false, reason: 'gw-action-mismatch' }
      return runGate(token, action, payload)
    },

    gateWriteCtl(token: string, action: CtlAction, payload: string): GateWriteResult {
      // 运行期硬化（同上）：控制面入口只收 ctl- 六动词
      if (!isCtlAction(action)) return { allowed: false, reason: 'gw-action-mismatch' }
      return runGate(token, action, payload)
    },
  }
}

export { CONTROL_TICKET }
