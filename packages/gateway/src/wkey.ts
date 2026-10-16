/**
 * wkey 机制 —— 写路径的按单凭据（docs/17-§7、docs/25-§4.1）
 *
 * 语义冻结（本文件头注即拟稿，改动先过批示）：
 *   - wkey = HMAC-SHA256(secret) 签名的紧凑 token：`base64url(payloadJson) + "." + base64url(mac)`
 *     mac 覆盖 payload 的 base64url 串（对编码后字节签名，规范形态，无二次编码歧义）
 *   - payload = { v:1, ticket, scope, exp, nonce }；exp = 签发时刻 + ttl 的**到期时刻**（epoch ms），
 *     ttl 只是签发输入（WkeyClaims.ttl），token 内不存原串
 *   - ttl 严格格式 `<正整数><s|m|h|d>`（单段，如 "30m"；"1h30m" 拒）——格式拟稿待批
 *   - verify 全链 fail-closed，八种拒绝码见 WkeyRejectReason；任何一步失败都不消费 nonce
 *   - nonce 单次有效：verify 完整成功才记入已见集合，同 nonce 二次出现 = 重放拒。
 *     【拟稿疑点】当前语义 = 一个 wkey 只过一次闸（MCP 侧复用同一 wkey 多次调工具会撞重放）；
 *     生产拟改为 nonce 集合落 store 持久化 + 上层「一调用一签发」。与 24-§二「wkey 注入 MCP init」
 *     的相容性待批示（选项：a. 每工具调用现签 b. verify 增复用窗口参数）
 *   - revoke(ticket)：关单即吊销——同单全部 key 立即失效（吊销先于过期/重放判定）
 *   - secret 只进 HMAC，永不进错误消息/reason（reason 是纯码，测试断言不含 secret 子串）
 *   - 签名比对 timing-safe；长度不等直接拒（不抛异常——异长是坏凭据不是程序错）
 *
 * 纯逻辑零 IO：唯一依赖 node:crypto（内建）；已见 nonce/吊销集合均在内存（拟稿：生产换 store）。
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { GATEWAY_ACTIONS, configInvalid } from '@studio-next/contract'
import type { GatewayAction, TicketId, WkeyClaims } from '@studio-next/contract'

/** 拒绝码（fail-closed 家族；facade 侧再加 gw- 前缀路由） */
export type WkeyRejectReason =
  | 'malformed' // token 形状/编码/JSON/payload schema 任一不符
  | 'bad-signature' // 签名不符（篡改/伪造/异密）
  | 'revoked' // 关单吊销
  | 'expired' // now >= exp（边界即拒）
  | 'ticket-mismatch' // 期望单号与 claims 单号不符
  | 'scope' // 动作在 scope 外
  | 'replay' // nonce 已见过（单次有效）

/** 校验通过后回读的 claims 视图（token 内的权威形态：exp 到期时刻，无原 ttl 串） */
export interface VerifiedWkey {
  readonly ticket: TicketId
  readonly scope: readonly GatewayAction[]
  readonly exp: number
  readonly nonce: string
}

export interface WkeyVerifyCheck {
  now: number
  /** 提供则做单号绑定校验（写路径必须提供；省略=跳过，仅控制面自检用，拟稿） */
  ticket?: TicketId
  /** 提供则做 scope 校验 */
  action?: GatewayAction
}

export type WkeyVerifyResult = { ok: true; claims: VerifiedWkey } | { ok: false; reason: WkeyRejectReason }

/** 控制面自用 wkey：scope 全开（GATEWAY_ACTIONS 全量），编译期独立类型防与按单 key 混用 */
export type ControlKey = string & { readonly __controlKey: unique symbol }

/** 控制面 wkey 的单号（不与真实单据 id 冲突的保留名，拟稿） */
export const CONTROL_TICKET = '__control__' as const

/** 控制面 wkey 默认 TTL（短命：全开 scope 越短越安全，拟稿待批） */
export const CONTROL_TTL_DEFAULT = '15m' as const

/** 签发输入 schema（exp 由 clock 计算，不在输入里；scope 必须落在 GATEWAY_ACTIONS 白名单内——表外动作进不了 token） */
const ClaimsInputSchema = z.strictObject({
  ticket: z.string().min(1),
  scope: z.array(z.enum(GATEWAY_ACTIONS)).min(1),
  nonce: z.string().min(1),
})

/** payload schema（token 内冻结形状，v=1 版本钉死） */
const PayloadSchema = z.strictObject({
  v: z.literal(1),
  ticket: z.string().min(1),
  scope: z.array(z.enum(GATEWAY_ACTIONS)).min(1),
  exp: z.number().int().positive(),
  nonce: z.string().min(1),
})

/** ttl 严格格式：单段 `<正整数><s|m|h|d>` */
const TTL_RE = /^([1-9][0-9]*)(s|m|h|d)$/
const TTL_UNITS: Readonly<Record<string, number>> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }

function ttlToMs(ttl: string): number {
  const m = TTL_RE.exec(ttl)
  if (m === null) throw configInvalid('gw-bad-ttl', `ttl 必须是 <正整数><s|m|h|d> 单段格式，收到：${ttl === '' ? '(空)' : '非白名单格式'}`)
  const unit = TTL_UNITS[m[2] as string] as number
  const n = Number(m[1] as string)
  // 上界防溢出：exp 必须仍是安全整数
  const ms = n * unit
  if (!Number.isSafeInteger(ms)) throw configInvalid('gw-bad-ttl', 'ttl 换算出的毫秒数超出安全整数范围')
  return ms
}

/** base64url 严格字符集（Buffer 解码对脏字符宽容，先正则挡，fail-closed） */
const B64U_RE = /^[A-Za-z0-9_-]+$/
const HMAC_LEN = 32 // SHA-256

const b64uEncode = (bytes: Uint8Array): string => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64url')

export interface WkeyAuthority {
  /** 签发（claims 全部由调用方给定——测试可确定性注入 nonce；exp 由 clock 计算） */
  issue(claims: WkeyClaims): string
  /** 校验（fail-closed 全家；完整成功才记 nonce） */
  verify(token: string, check: WkeyVerifyCheck): WkeyVerifyResult
  /** 关单即吊销：同单全部 key 立即失效；幂等 */
  revoke(ticket: TicketId): void
}

/**
 * createWkeyAuthority —— wkey 签发/校验/吊销机构。
 * @param secret HMAC 密钥（>= 32 字节，空/过短抛 CONFIG_INVALID/gw-secret-*；永不入日志与错误消息）
 * @param clock epoch ms 时钟（注入求确定性；生产传 Date.now）
 */
export function createWkeyAuthority(secret: Uint8Array, clock: () => number): WkeyAuthority {
  if (secret.byteLength === 0) throw configInvalid('gw-secret-empty', 'wkey 密钥不得为空')
  if (secret.byteLength < 32) throw configInvalid('gw-secret-too-short', `wkey 密钥至少 32 字节（HMAC-SHA256 门限，拟稿），收到 ${secret.byteLength}`)

  const seenNonces = new Set<string>()
  const revokedTickets = new Set<string>()

  const mac = (payloadB64u: string): Uint8Array => createHmac('sha256', secret).update(payloadB64u, 'utf8').digest()

  return {
    issue(claims: WkeyClaims): string {
      const parsed = ClaimsInputSchema.safeParse({ ticket: claims.ticket, scope: claims.scope, nonce: claims.nonce })
      if (!parsed.success) throw configInvalid('gw-bad-claims', `claims 形状不符：${parsed.error.issues.map((i) => i.path.join('.')).join(',')}`)
      const exp = clock() + ttlToMs(claims.ttl)
      if (!Number.isSafeInteger(exp) || exp <= 0) throw configInvalid('gw-bad-ttl', '签发时刻 + ttl 得到的到期时刻非法')
      const payload = { v: 1 as const, ticket: parsed.data.ticket, scope: parsed.data.scope, exp, nonce: parsed.data.nonce }
      const payloadB64u = b64uEncode(Buffer.from(JSON.stringify(payload), 'utf8'))
      return `${payloadB64u}.${b64uEncode(mac(payloadB64u))}`
    },

    verify(token: string, check: WkeyVerifyCheck): WkeyVerifyResult {
      // 1) 形状：两段、非空、base64url 严格字符集
      const dot = token.indexOf('.')
      if (dot <= 0 || dot === token.length - 1 || token.indexOf('.', dot + 1) !== -1) return { ok: false, reason: 'malformed' }
      const payloadB64u = token.slice(0, dot)
      const macB64u = token.slice(dot + 1)
      if (!B64U_RE.test(payloadB64u) || !B64U_RE.test(macB64u)) return { ok: false, reason: 'malformed' }

      // 2) 签名：重算 + timing-safe 比对（异长直接拒）
      const expect = mac(payloadB64u)
      const got = Buffer.from(macB64u, 'base64url')
      if (got.byteLength !== HMAC_LEN || got.byteLength !== expect.byteLength || !timingSafeEqual(got, expect)) {
        return { ok: false, reason: 'bad-signature' }
      }

      // 3) payload 解析（坏 JSON / 表外 scope / 形状不符 = malformed）
      let raw: unknown
      try {
        raw = JSON.parse(Buffer.from(payloadB64u, 'base64url').toString('utf8'))
      } catch {
        return { ok: false, reason: 'malformed' }
      }
      const parsed = PayloadSchema.safeParse(raw)
      if (!parsed.success) return { ok: false, reason: 'malformed' }
      // 只回读四个权威字段（内部版本号 v 不外泄）
      const claims: VerifiedWkey = { ticket: parsed.data.ticket, scope: parsed.data.scope, exp: parsed.data.exp, nonce: parsed.data.nonce }

      // 4) 吊销（关单即死，先于一切时效判定）
      if (revokedTickets.has(claims.ticket)) return { ok: false, reason: 'revoked' }
      // 5) 过期（边界 now === exp 即拒，fail-closed）
      if (check.now >= claims.exp) return { ok: false, reason: 'expired' }
      // 6) 单号绑定
      if (check.ticket !== undefined && check.ticket !== claims.ticket) return { ok: false, reason: 'ticket-mismatch' }
      // 7) scope
      if (check.action !== undefined && !claims.scope.includes(check.action)) return { ok: false, reason: 'scope' }
      // 8) nonce 单次有效（完整成功才记入；任一前置失败不消费）
      if (seenNonces.has(claims.nonce)) return { ok: false, reason: 'replay' }
      seenNonces.add(claims.nonce)
      return { ok: true, claims }
    },

    revoke(ticket: TicketId): void {
      revokedTickets.add(ticket)
    },
  }
}

/**
 * issueControlKey —— 控制面自用 wkey（17-§7：控制面自身也过网关，不留绕过通道）。
 *
 * 【头注警示】scope 全开（GATEWAY_ACTIONS 全量）——这是系统内权限最大的凭据：
 *   - 类型上独立（ControlKey 品牌类型），按单 key（string）传不进来，反之亦然
 *   - 默认短 TTL（CONTROL_TTL_DEFAULT），用毕即 revoke(CONTROL_TICKET)
 *   - 单号固定 CONTROL_TICKET（保留名，拟稿），吊销 = revoke(CONTROL_TICKET) 一刀切
 *   - 仍走同一 verify 链（含 nonce 单次有效）——控制面不豁免任何检查
 */
export function issueControlKey(authority: WkeyAuthority, opts?: { ttl?: string }): ControlKey {
  const nonce = randomUUID()
  return authority.issue({
    ticket: CONTROL_TICKET,
    scope: [...GATEWAY_ACTIONS],
    ttl: opts?.ttl ?? CONTROL_TTL_DEFAULT,
    nonce,
  }) as ControlKey
}
