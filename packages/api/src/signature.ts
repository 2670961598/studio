/**
 * packages/api/src/signature.ts —— 入站 hooks 签名校验（API-15）
 *
 * 依据：docs/v2/14 §四（API-15：HMAC＋时间戳＋nonce＋重放窗＋载荷上限；产意图同触发面
 * 收口）；docs/v2/15 §四 SEC-T5（webhook 验签 secret 属出站/入站通道专用，不经提示词）、
 * §二 SEC-SIG-01（signed 署名）。
 *
 * 约定（实现即文档，测试同源）：
 *   - `X-SN-Timestamp`：epoch 毫秒（十进制整数；容差默认 5 分钟，可由注入源覆盖）；
 *   - `X-SN-Nonce`：1..128 字符，窗口内不得复用（进程内缓存，非台账写）；
 *   - `X-SN-Signature`：hex HMAC-SHA256，签名串＝`${timestamp}.${nonce}.${rawBody}`；
 *   - secret 值只来自运行时注入（ApiHookSource.signingSecret），不进日志/响应；
 *   - 先验签、后查重放（防坏签名污染 nonce 缓存）。
 *
 * 残留缺口（如实登记，不宣称已证）：本件不做 DNS 解析/防 rebinding（无网络 IO），
 * 跨进程重放缓存不共享（单进程部署形态 = daemon assembly 同进程注入）。
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ApiHookSource } from './types.ts'

/** 签名/时间戳/nonce 头（仓内新面，值集未入 contract——协议头不是端口/记录类） */
export const HOOK_SIGNATURE_HEADER = 'x-sn-signature'
export const HOOK_TIMESTAMP_HEADER = 'x-sn-timestamp'
export const HOOK_NONCE_HEADER = 'x-sn-nonce'
export const HOOK_DELIVERY_HEADER = 'x-sn-delivery'

/** 缺省重放窗（5 分钟）与上限（1 小时） */
export const DEFAULT_HOOK_TOLERANCE_MS = 5 * 60_000
export const MAX_HOOK_TOLERANCE_MS = 60 * 60_000

/** 进程内 nonce 缓存上限（超出按插入序淘汰；缓存只防重放，不是台账） */
const NONCE_CACHE_LIMIT = 4096

/** 验签成功：timestamp/nonce 进 IntentAuth（logical refs，不含 secret） */
export interface HookAuthSuccess {
  readonly ok: true
  readonly timestamp: string
  readonly nonce: string
}

/** 验签失败（status 401=签名/窗口/重放；401/422 之外的载荷超限由路由先判） */
export interface HookAuthFailure {
  readonly ok: false
  readonly status: 401 | 422
  readonly subcause: string
  readonly detail?: string
}

export type HookAuthResult = HookAuthSuccess | HookAuthFailure

function fail(status: 401 | 422, subcause: string, detail: string): HookAuthFailure {
  return { ok: false, status, subcause, detail }
}

/** 恒时比较（先等长化：长度差本身不构成签名匹配路径） */
function signaturesMatch(expectedHex: string, providedHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'utf8')
  const provided = Buffer.from(providedHex.toLowerCase(), 'utf8')
  if (expected.length !== provided.length) return false
  return timingSafeEqual(expected, provided)
}

/**
 * 造一个验签器（闭包持 nonce 缓存；每次 createApiApp 独立）。
 * @param nowMs 注入时钟（测试固定；缺省 Date.now）
 */
export function createHookVerifier(nowMs: () => number): (
  source: ApiHookSource,
  headers: Headers,
  rawBody: string,
) => HookAuthResult {
  const nonces = new Map<string, number>()

  return (source, headers, rawBody) => {
    const timestamp = headers.get(HOOK_TIMESTAMP_HEADER)
    const nonce = headers.get(HOOK_NONCE_HEADER)
    const signature = headers.get(HOOK_SIGNATURE_HEADER)
    if (timestamp === null || timestamp.trim() === '') {
      return fail(401, 'hook-timestamp-missing', `缺 ${HOOK_TIMESTAMP_HEADER} 头（epoch ms）`)
    }
    if (nonce === null || nonce.trim() === '') {
      return fail(401, 'hook-nonce-missing', `缺 ${HOOK_NONCE_HEADER} 头（重放窗去重键）`)
    }
    if (signature === null || signature.trim() === '') {
      return fail(401, 'hook-signature-missing', `缺 ${HOOK_SIGNATURE_HEADER} 头（hex HMAC-SHA256）`)
    }
    if (nonce.length > 128) return fail(422, 'hook-nonce-invalid', 'nonce 长度超限（>128）')
    if (timestamp.length > 32 || !/^\d+$/.test(timestamp)) {
      return fail(422, 'hook-timestamp-invalid', 'timestamp 须为 epoch 毫秒十进制整数')
    }
    if (signature.length > 256) return fail(422, 'hook-signature-invalid', 'signature 长度超限')

    const now = nowMs()
    const stamp = Number.parseInt(timestamp, 10)
    if (!Number.isInteger(stamp)) return fail(422, 'hook-timestamp-invalid', 'timestamp 解析失败')
    const tolerance = source.toleranceMs ?? DEFAULT_HOOK_TOLERANCE_MS
    if (Math.abs(now - stamp) > tolerance) {
      return fail(
        401,
        'hook-timestamp-out-of-window',
        `时间戳超出重放窗（容差 ${String(tolerance)}ms）——签名有效也拒绝`,
      )
    }

    const expected = createHmac('sha256', source.signingSecret)
      .update(`${timestamp}.${nonce}.${rawBody}`)
      .digest('hex')
    if (!signaturesMatch(expected, signature.trim())) {
      return fail(401, 'hook-signature-mismatch', 'HMAC 校验失败（签名串＝timestamp.nonce.rawBody）')
    }

    // 验签通过后才登记 nonce：坏签名不能污染缓存
    const cacheKey = `${source.source}:${nonce}`
    const seenAt = nonces.get(cacheKey)
    if (seenAt !== undefined && Math.abs(now - seenAt) <= tolerance) {
      return fail(401, 'hook-nonce-replayed', 'nonce 在重放窗内已使用（重放拒绝）')
    }
    nonces.set(cacheKey, now)
    if (nonces.size > NONCE_CACHE_LIMIT) {
      for (const [key, at] of nonces) {
        if (Math.abs(now - at) > MAX_HOOK_TOLERANCE_MS) nonces.delete(key)
      }
      while (nonces.size > NONCE_CACHE_LIMIT) {
        const oldest = nonces.keys().next()
        if (oldest.done === true) break
        nonces.delete(oldest.value)
      }
    }
    return { ok: true, timestamp, nonce }
  }
}
