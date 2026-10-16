/**
 * 网关门面 —— 写路径收口闸（docs/17-§7：agent 对平台的一切写入经此，不留绕过通道）
 *
 * 组装三件：wkey 校验（鉴权）→ 动作词校验（结构化意图）→ 署名注入（身份落款）。
 *
 * 冻结口径（拟稿，改动先过批示）：
 *   - 两级错误对齐（17-§9 / errors.ts）：**构造期**配置非法（空 secret、坏署名上下文）抛
 *     CONFIG_INVALID/gw-*（configInvalid 通道）；**运行期**拒绝不抛——返回 {allowed:false,
 *     reason:'gw-verify-<子码>'|'gw-action-<子码>'|...}，子码与 wkey/actions 的拒绝码一一对应
 *   - gateWrite(token, action, payload)：action=调用方申报的动作（scope 校验锚点）；
 *     payload=写入正文。payload 首行若是 `@action` 指令则解析出的动作必须与申报动作一致
 *     （不一致=gw-action-mismatch——申报与实文分叉即拒，不猜以哪边为准）
 *   - 署名不改写正文：signed.body = payload 原文（gateway 只做鉴权+落款，正文语义归平台适配器）
 *   - 【顺序拟稿】任务书口径「先 verify 后 parseAction」在结构化路径原样执行；自由中文路径
 *     **前置短路**（isFreeformChinese 且非 @action 行 → 直接 needsLlmFallback，不跑 verify 不烧
 *     nonce——LLM 回退重提交要用同一 token；fallback 只是路由信号不是授权，无信息泄露）。
 *     结构化路径 verify 成功即烧 nonce，其后 parse 失败不退（客户端须重新领 key：一调用一签发）
 *   - 实例按单绑定：opts.ticket 是本闸收口的单号（verify 的单号绑定锚）。控制面自用请用
 *     ticket=CONTROL_TICKET 的独立实例（17-§7：控制面也过网关，但不与按单实例混用）
 */
import { CONTROL_TICKET, createWkeyAuthority, issueControlKey as issueControlKeyOn } from './wkey.ts'
import type { ControlKey, WkeyAuthority, WkeyRejectReason } from './wkey.ts'
import { isFreeformChinese, parseAction } from './actions.ts'
import type { ActionRejectReason } from './actions.ts'
import { signedBody } from './signature.ts'
import type { SignatureContext } from './signature.ts'
import { configInvalid } from '@studio-next/contract'
import type { GatewayAction, PersonId, SignedBody, TicketId, WkeyClaims } from '@studio-next/contract'

/** 运行期拒绝码（gw- 前缀族；子码继承 wkey/actions 的拒绝码） */
export type GateRejectReason = `gw-verify-${WkeyRejectReason}` | `gw-action-${ActionRejectReason}` | 'gw-action-mismatch' | 'gw-freeform-chinese'

export type GateWriteResult =
  | { allowed: true; action: GatewayAction; args: Record<string, unknown>; signed: SignedBody }
  | { allowed: false; reason: GateRejectReason; needsLlmFallback?: true }

export interface GatewayOptions {
  /** HMAC 密钥（透传 wkey 机构；非法即构造期抛 CONFIG_INVALID） */
  secret: Uint8Array
  /** epoch ms 时钟（求确定性可注入） */
  clock: () => number
  /** 本闸收口的单号（verify 单号绑定锚；控制面实例用 CONTROL_TICKET） */
  ticket: TicketId
  /** 署名上下文（公司/部门/岗位/级别——人事档案四身份位） */
  ctx: SignatureContext
  /** 署名工号（SignedBody.author） */
  author: PersonId
}

export interface Gateway {
  /** 写路径闸：鉴权 → 结构化校验 → 署名。任一步失败=拒+reason 码 */
  gateWrite(token: string, action: GatewayAction, payload: string): GateWriteResult
  /** 签发按单 wkey（daemon 派工时给 worker 的唯一凭据；nonce 由调用方给定） */
  issue(claims: WkeyClaims): string
  /** 控制面自用 wkey（scope 全开，独立类型；头注警示见 wkey.ts） */
  issueControlKey(opts?: { ttl?: string }): ControlKey
  /** 关单即吊销（透传 wkey 机构；幂等） */
  revoke(ticket: TicketId): void
  /** 底层机构（审计/测试用；生产不得绕过 gateWrite 直调 verify 写路径） */
  readonly authority: WkeyAuthority
}

/** createGateway —— 组装写路径收口闸（纯逻辑零 IO） */
export function createGateway(opts: GatewayOptions): Gateway {
  const authority = createWkeyAuthority(opts.secret, opts.clock)
  if (opts.ticket === '') throw configInvalid('gw-empty-ticket', '网关实例绑定的单号不得为空')
  return {
    authority,
    issue: (claims) => authority.issue(claims),
    issueControlKey: (o) => issueControlKeyOn(authority, o),
    revoke: (ticket) => authority.revoke(ticket),

    gateWrite(token: string, action: GatewayAction, payload: string): GateWriteResult {
      // 0) 自由中文前置短路（不烧 nonce；只标记，LLM 回退归上层——17-§7）
      if (!payload.startsWith('@action') && isFreeformChinese(payload)) {
        return { allowed: false, reason: 'gw-freeform-chinese', needsLlmFallback: true }
      }
      // 1) 鉴权（签名/吊销/过期/单号/scope/nonce 重放，fail-closed 全家）
      const verified = authority.verify(token, { now: opts.clock(), ticket: opts.ticket, action })
      if (!verified.ok) return { allowed: false, reason: `gw-verify-${verified.reason}` }
      // 2) 结构化校验（申报动作 vs payload 动作词，分叉即拒）
      const parsed = parseAction(payload)
      if (!parsed.ok) {
        // 到这一步的 not-an-action 必是非中文非结构化正文（中文已在 0 短路）——纯拒
        return { allowed: false, reason: `gw-action-${parsed.reason}` }
      }
      if (parsed.action !== action) return { allowed: false, reason: 'gw-action-mismatch' }
      // 3) 署名注入（正文不改写；落款=四身份位）
      return { allowed: true, action, args: parsed.args, signed: signedBody(opts.ctx, opts.author, payload) }
    },
  }
}

export { CONTROL_TICKET }
