/**
 * 网关门面测试 —— gateWrite 全链与 fail-closed 矩阵（17-§7 写入全收口）
 * 覆盖：鉴权七拒路由/动作词三拒/申报与实文分叉/中文回退不烧 key/控制面 key/secret 卫生
 */
import { describe, expect, test } from 'vitest'
import { GATEWAY_ACTIONS } from '@studio-next/contract'
import type { WkeyClaims } from '@studio-next/contract'
import { CONTROL_TICKET, createGateway } from './gateway.ts'
import type { Gateway } from './gateway.ts'
import type { SignatureContext } from './signature.ts'

const SECRET = new TextEncoder().encode('0123456789abcdef0123456789abcdef')
const CTX: SignatureContext = { company: '指尖游戏', dept: '平台部', role: '工程师', level: 3 }

/** 可拨假钟 */
function makeGateway(ticket: string): { gw: Gateway; setNow: (n: number) => void } {
  let now = 1_000_000_000_000
  const gw = createGateway({ secret: SECRET, clock: () => now, ticket, ctx: CTX, author: 'P-001' })
  return { gw, setNow: (n) => (now = n) }
}

const CLAIMS = (over: Partial<WkeyClaims> = {}): WkeyClaims => ({ ticket: '2-100', scope: ['comment'], ttl: '10m', nonce: 'n-1', ...over })

describe('gateWrite 全链（鉴权 → 结构化 → 署名）', () => {
  test('合法写：allowed + 署名注入 + args 透出 + 正文不改写', () => {
    const { gw } = makeGateway('2-100')
    const token = gw.issue(CLAIMS())
    const r = gw.gateWrite(token, 'comment', '@action comment {"body":"完成，证据已落盘"}')
    expect(r).toEqual({
      allowed: true,
      action: 'comment',
      args: { body: '完成，证据已落盘' },
      signed: { author: 'P-001', body: '@action comment {"body":"完成，证据已落盘"}', signature: '[指尖游戏·平台部·工程师·3]' },
    })
  })

  test('鉴权失败路由：篡改/过期/吊销/单号/scope → gw-verify-* 拒码', () => {
    const { gw, setNow } = makeGateway('2-100')
    const tampered = `${gw.issue(CLAIMS())}.x` // 三段 → 形状不符
    expect(gw.gateWrite(tampered, 'comment', '@action comment {}')).toEqual({ allowed: false, reason: 'gw-verify-malformed' })

    const expired = gw.issue(CLAIMS({ nonce: 'n-e' }))
    setNow(1_000_000_000_000 + 600_001) // ttl 10m 边界外
    expect(gw.gateWrite(expired, 'comment', '@action comment {}')).toEqual({ allowed: false, reason: 'gw-verify-expired' })

    const { gw: gw2 } = makeGateway('2-100')
    const t2 = gw2.issue(CLAIMS({ nonce: 'n-r' }))
    gw2.revoke('2-100')
    expect(gw2.gateWrite(t2, 'comment', '@action comment {}')).toEqual({ allowed: false, reason: 'gw-verify-revoked' })

    const { gw: gw3 } = makeGateway('2-300') // 闸绑 2-300，key 是 2-100 的
    expect(gw3.gateWrite(gw3.issue(CLAIMS({ nonce: 'n-t' })), 'comment', '@action comment {}')).toEqual({ allowed: false, reason: 'gw-verify-ticket-mismatch' })

    const { gw: gw4 } = makeGateway('2-100')
    expect(gw4.gateWrite(gw4.issue(CLAIMS({ scope: ['heartbeat'], nonce: 'n-s' })), 'comment', '@action comment {}')).toEqual({
      allowed: false,
      reason: 'gw-verify-scope',
    })
  })

  test('重放：同 token 二次过闸 → gw-verify-replay（一调用一签发）', () => {
    const { gw } = makeGateway('2-100')
    const token = gw.issue(CLAIMS())
    expect(gw.gateWrite(token, 'comment', '@action comment {}').allowed).toBe(true)
    expect(gw.gateWrite(token, 'comment', '@action comment {}')).toEqual({ allowed: false, reason: 'gw-verify-replay' })
  })

  test('动作词失败路由：未知动词/坏 JSON/非对象 → gw-action-*；非结构化非中文 → not-an-action 无回退标记', () => {
    const { gw } = makeGateway('2-100')
    const t = () => gw.issue(CLAIMS({ nonce: `n-${Math.random()}` }))
    expect(gw.gateWrite(t(), 'comment', '@action sudo {}')).toEqual({ allowed: false, reason: 'gw-action-unknown-verb' })
    expect(gw.gateWrite(t(), 'comment', '@action comment {oops}')).toEqual({ allowed: false, reason: 'gw-action-bad-json' })
    expect(gw.gateWrite(t(), 'comment', '@action comment [1]')).toEqual({ allowed: false, reason: 'gw-action-bad-args' })
    expect(gw.gateWrite(t(), 'comment', '@action comment')).toEqual({ allowed: false, reason: 'gw-action-bad-format' })
    const r = gw.gateWrite(t(), 'comment', 'plain english body')
    expect(r).toEqual({ allowed: false, reason: 'gw-action-not-an-action' })
    expect('needsLlmFallback' in r && r.needsLlmFallback).toBeFalsy()
  })

  test('申报与实文分叉 → gw-action-mismatch（不猜以哪边为准）', () => {
    const { gw } = makeGateway('2-100')
    const token = gw.issue(CLAIMS({ scope: ['comment', 'heartbeat'] }))
    expect(gw.gateWrite(token, 'heartbeat', '@action comment {}')).toEqual({ allowed: false, reason: 'gw-action-mismatch' })
  })

  test('中文自由批示 → gw-freeform-chinese + needsLlmFallback，且不烧 key（回退后同 token 重提交可用）', () => {
    const { gw } = makeGateway('2-100')
    const token = gw.issue(CLAIMS())
    expect(gw.gateWrite(token, 'comment', '请把这单的结果记到知识库并标记完成')).toEqual({
      allowed: false,
      reason: 'gw-freeform-chinese',
      needsLlmFallback: true,
    })
    // LLM 回退转结构化后用同一 token 重提交 → 放行
    expect(gw.gateWrite(token, 'comment', '@action comment {"body":"已记录"}').allowed).toBe(true)
  })

  test('结构化路径 verify 成功即烧 nonce：其后 parse 失败也不退（客户端须重领 key）', () => {
    const { gw } = makeGateway('2-100')
    const token = gw.issue(CLAIMS())
    const bad = gw.gateWrite(token, 'comment', '@action comment {bad')
    expect(!bad.allowed && bad.reason).toBe('gw-action-bad-json')
    expect(gw.gateWrite(token, 'comment', '@action comment {}')).toEqual({ allowed: false, reason: 'gw-verify-replay' })
  })
})

describe('控制面自用通道（控制面也过网关，不留绕过通道）', () => {
  test('控制面实例：issueControlKey 对全部白名单动作逐个放行（一调用一签发——nonce 单次有效）', () => {
    const { gw } = makeGateway(CONTROL_TICKET)
    for (const action of GATEWAY_ACTIONS) {
      const key = gw.issueControlKey()
      const r = gw.gateWrite(key, action, `@action ${action} {}`)
      expect(r.allowed).toBe(true)
    }
  })

  test('控制 key 不得用于按单闸；按单 key 不得用于控制闸（单号绑定互斥）', () => {
    const { gw: ctlGw } = makeGateway(CONTROL_TICKET)
    const { gw: ticketGw } = makeGateway('2-100')
    const ctlKey = ctlGw.issueControlKey()
    expect(ticketGw.gateWrite(ctlKey, 'comment', '@action comment {}')).toEqual({ allowed: false, reason: 'gw-verify-ticket-mismatch' })
    const ticketKey = ctlGw.issue(CLAIMS({ nonce: 'cross' }))
    expect(ctlGw.gateWrite(ticketKey, 'comment', '@action comment {}')).toEqual({ allowed: false, reason: 'gw-verify-ticket-mismatch' })
  })

  test('控制面吊销：revoke(CONTROL_TICKET) 后控制 key 全灭', () => {
    const { gw } = makeGateway(CONTROL_TICKET)
    const key = gw.issueControlKey()
    gw.revoke(CONTROL_TICKET)
    expect(gw.gateWrite(key, 'comment', '@action comment {}')).toEqual({ allowed: false, reason: 'gw-verify-revoked' })
  })

  test('控制面自定义 TTL 生效（1s 边界即拒）', () => {
    const { gw, setNow } = makeGateway(CONTROL_TICKET)
    const key = gw.issueControlKey({ ttl: '1s' })
    expect(gw.gateWrite(key, 'comment', '@action comment {}').allowed).toBe(true)
    const key2 = gw.issueControlKey({ ttl: '1s' })
    setNow(1_000_000_000_000 + 1_000)
    const r2 = gw.authority.verify(key2, { now: 1_000_000_000_000 + 1_000, ticket: CONTROL_TICKET })
    expect(r2).toEqual({ ok: false, reason: 'expired' })
  })
})

describe('门面卫生与构造期', () => {
  test('全部拒绝 reason 均为 gw-* 纯码，不含 secret 明文/hex/base64', () => {
    const { gw } = makeGateway('2-100')
    const reasons: string[] = []
    for (const [token, payload] of [
      ['garbage', '@action comment {}'],
      [gw.issue(CLAIMS({ nonce: 'x1' })), '乱写'],
      [gw.issue(CLAIMS({ nonce: 'x2' })), 'plain'],
    ] as const) {
      const r = gw.gateWrite(token, 'comment', payload)
      reasons.push(!r.allowed ? r.reason : '(unexpected-allow)')
    }
    const secretStr = new TextDecoder().decode(SECRET)
    const secretHex = Buffer.from(SECRET).toString('hex')
    const secretB64 = Buffer.from(SECRET).toString('base64')
    for (const r of reasons) {
      expect(r).toMatch(/^gw-/)
      expect(r).not.toContain(secretStr)
      expect(r).not.toContain(secretHex)
      expect(r).not.toContain(secretB64)
    }
  })

  test('构造期非法：空单号/空 secret 抛 CONFIG_INVALID（两级分类：配置错抛、运行错返码）', () => {
    let now = 1_000_000_000_000
    expect(() => createGateway({ secret: SECRET, clock: () => now, ticket: '', ctx: CTX, author: 'P-001' })).toThrowError(/CONFIG_INVALID\/gw-empty-ticket/)
    expect(() => createGateway({ secret: new Uint8Array(0), clock: () => now, ticket: '2-100', ctx: CTX, author: 'P-001' })).toThrowError(
      /CONFIG_INVALID\/gw-secret-empty/,
    )
  })
})
