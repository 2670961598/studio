/**
 * wkey 机制测试 —— 签发/校验/吊销 fail-closed 全家（17-§7）
 * 覆盖：往返/篡改/异密/过期含边界/单号/scope/重放/吊销/形状/ttl 格式/secret 不泄漏
 */
import { createHmac } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { GATEWAY_ACTIONS } from '@studio-next/contract'
import type { WkeyClaims } from '@studio-next/contract'
import { CONTROL_TICKET, CONTROL_TTL_DEFAULT, createWkeyAuthority, issueControlKey } from './wkey.ts'

const SECRET = new TextEncoder().encode('0123456789abcdef0123456789abcdef') // 32B
const SECRET2 = new TextEncoder().encode('fedcba9876543210fedcba9876543210')

/** 可拨假钟（epoch ms） */
function fakeClock(start = 1_000_000_000_000): { clock: () => number; set: (n: number) => void } {
  let now = start
  return { clock: () => now, set: (n) => (now = n) }
}

const CLAIMS: WkeyClaims = { ticket: '2-100', scope: ['comment', 'heartbeat'], ttl: '10m', nonce: 'n-001' }

function issueWith(claims: WkeyClaims = CLAIMS, secret: Uint8Array = SECRET, start = 1_000_000_000_000): { token: string; clock: ReturnType<typeof fakeClock> } {
  const clock = fakeClock(start)
  const token = createWkeyAuthority(secret, clock.clock).issue(claims)
  return { token, clock }
}

describe('wkey 签发与往返', () => {
  test('往返成功：claims 回读一致（ticket/scope/nonce/exp）', () => {
    const { clock, token } = issueWith()
    const r = createWkeyAuthority(SECRET, clock.clock).verify(token, { now: 1_000_000_000_000 + 1, ticket: '2-100' })
    expect(r).toEqual({ ok: true, claims: { ticket: '2-100', scope: ['comment', 'heartbeat'], exp: 1_000_000_000_000 + 600_000, nonce: 'n-001' } })
  })

  test('token 形态：恰好一个点分隔两段 base64url', () => {
    const { token } = issueWith()
    const parts = token.split('.')
    expect(parts).toHaveLength(2)
    expect(parts[0]).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(parts[1]).toMatch(/^[A-Za-z0-9_-]+$/)
    // payload 可解码且含冻结字段
    const payload = JSON.parse(Buffer.from(parts[0] as string, 'base64url').toString('utf8')) as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(['exp', 'nonce', 'scope', 'ticket', 'v'])
  })

  test('不同 nonce 同单两张 key 互不干扰（重放按 nonce 不按单）', () => {
    const { clock, token: t1 } = issueWith()
    const auth = createWkeyAuthority(SECRET, clock.clock)
    const t2 = auth.issue({ ...CLAIMS, nonce: 'n-002' })
    expect(auth.verify(t1, { now: 1_000_000_000_001, ticket: '2-100' }).ok).toBe(true)
    expect(auth.verify(t2, { now: 1_000_000_000_001, ticket: '2-100' }).ok).toBe(true)
  })

  test('ttl 各单位换算 exp 正确（s/m/h/d）', () => {
    const cases: ReadonlyArray<[string, number]> = [
      ['30s', 30_000],
      ['10m', 600_000],
      ['2h', 7_200_000],
      ['1d', 86_400_000],
    ]
    for (const [ttl, ms] of cases) {
      const { clock, token } = issueWith({ ...CLAIMS, ttl })
      const r = createWkeyAuthority(SECRET, clock.clock).verify(token, { now: 1_000_000_000_000 })
      expect(r.ok && r.claims.exp).toBe(1_000_000_000_000 + ms)
    }
  })

  test('scope 白名单外动词在签发期即拒（表外动作进不了 token）', () => {
    const { clock } = issueWith()
    const auth = createWkeyAuthority(SECRET, clock.clock)
    // @ts-expect-error 故意传表外动词：运行时也要拦（zod 是真闸不是类型摆设）
    expect(() => auth.issue({ ...CLAIMS, scope: ['transition'] })).toThrowError(/CONFIG_INVALID/)
  })
})

describe('wkey 校验 fail-closed 家族', () => {
  test('篡改 payload（同签名换正文）→ bad-signature', () => {
    const { clock, token } = issueWith()
    const [p, m] = token.split('.') as [string, string]
    const forged = Buffer.from(JSON.stringify({ v: 1, ticket: '2-999', scope: ['comment'], exp: 9_999_999_999_999, nonce: 'n-x' }), 'utf8').toString('base64url')
    const auth = createWkeyAuthority(SECRET, clock.clock)
    expect(auth.verify(`${forged}.${m}`, { now: 1_000_000_000_001, ticket: '2-999' })).toEqual({ ok: false, reason: 'bad-signature' })
    expect(p.length).toBeGreaterThan(0)
  })

  test('篡改 mac → bad-signature；异密签发 → bad-signature', () => {
    const { clock, token } = issueWith()
    const auth = createWkeyAuthority(SECRET, clock.clock)
    const [p, m] = token.split('.') as [string, string]
    const flipped = m.startsWith('A') ? `B${m.slice(1)}` : `A${m.slice(1)}`
    expect(auth.verify(`${p}.${flipped}`, { now: 1_000_000_000_001, ticket: '2-100' })).toEqual({ ok: false, reason: 'bad-signature' })
    // 异密机构验别人的 token
    expect(createWkeyAuthority(SECRET2, clock.clock).verify(token, { now: 1_000_000_000_001, ticket: '2-100' })).toEqual({ ok: false, reason: 'bad-signature' })
  })

  test('过期：now === exp 边界即拒；now = exp-1 放行（fail-closed 边界）', () => {
    const { clock, token } = issueWith() // exp = start + 600_000
    const auth = createWkeyAuthority(SECRET, clock.clock)
    expect(auth.verify(token, { now: 1_000_000_000_000 + 600_000, ticket: '2-100' })).toEqual({ ok: false, reason: 'expired' })
    expect(auth.verify(token, { now: 1_000_000_000_000 + 599_999, ticket: '2-100' }).ok).toBe(true)
  })

  test('单号不匹配 → ticket-mismatch；不传 ticket 跳过绑定', () => {
    const { clock, token } = issueWith()
    const auth = createWkeyAuthority(SECRET, clock.clock)
    expect(auth.verify(token, { now: 1_000_000_000_001, ticket: '2-999' })).toEqual({ ok: false, reason: 'ticket-mismatch' })
    expect(auth.verify(token, { now: 1_000_000_000_001 }).ok).toBe(true)
  })

  test('scope 外动作 → scope；scope 内动作放行', () => {
    const { clock, token } = issueWith() // scope: comment/heartbeat
    const auth = createWkeyAuthority(SECRET, clock.clock)
    expect(auth.verify(token, { now: 1_000_000_000_001, ticket: '2-100', action: 'kb-search' })).toEqual({ ok: false, reason: 'scope' })
    expect(auth.verify(token, { now: 1_000_000_000_001, ticket: '2-100', action: 'comment' }).ok).toBe(true)
  })

  test('nonce 重放：同 token 二次 → replay；失败校验不消费 nonce', () => {
    const { clock, token } = issueWith()
    const auth = createWkeyAuthority(SECRET, clock.clock)
    expect(auth.verify(token, { now: 1_000_000_000_001, ticket: '2-100' }).ok).toBe(true)
    expect(auth.verify(token, { now: 1_000_000_000_001, ticket: '2-100' })).toEqual({ ok: false, reason: 'replay' })
    // 失败（scope 拒）不烧 nonce：随后 scope 内动作仍可用
    const auth2 = createWkeyAuthority(SECRET, clock.clock)
    const t2 = auth2.issue({ ...CLAIMS, nonce: 'n-010' })
    expect(auth2.verify(t2, { now: 1_000_000_000_001, ticket: '2-100', action: 'kb-search' })).toEqual({ ok: false, reason: 'scope' })
    expect(auth2.verify(t2, { now: 1_000_000_000_001, ticket: '2-100', action: 'comment' }).ok).toBe(true)
  })

  test('吊销：revoke(单号) 后同单全部 key 立即失效；他单不受牵连；幂等', () => {
    const { clock } = issueWith()
    const auth = createWkeyAuthority(SECRET, clock.clock)
    const t1 = auth.issue({ ...CLAIMS, nonce: 'a' })
    const t2 = auth.issue({ ...CLAIMS, nonce: 'b' })
    const other = auth.issue({ ...CLAIMS, ticket: '2-200', nonce: 'c' })
    auth.revoke('2-100')
    expect(auth.verify(t1, { now: 1_000_000_000_001, ticket: '2-100' })).toEqual({ ok: false, reason: 'revoked' })
    expect(auth.verify(t2, { now: 1_000_000_000_001, ticket: '2-100' })).toEqual({ ok: false, reason: 'revoked' })
    expect(auth.verify(other, { now: 1_000_000_000_001, ticket: '2-200' }).ok).toBe(true)
    auth.revoke('2-100') // 幂等
    const again = auth.verify(t1, { now: 1_000_000_000_001, ticket: '2-100' })
    expect(!again.ok && again.reason).toBe('revoked')
  })

  test('吊销判定先于过期（已吊销且已过期 → revoked）', () => {
    const { clock } = issueWith()
    const auth = createWkeyAuthority(SECRET, clock.clock)
    const t = auth.issue({ ...CLAIMS, ttl: '1s', nonce: 'z' })
    auth.revoke('2-100')
    const r = auth.verify(t, { now: 1_000_000_000_000 + 5_000, ticket: '2-100' })
    expect(!r.ok && r.reason).toBe('revoked')
  })

  test('形状不符 → malformed（垃圾串/三段/空段/坏字符/坏 JSON/表外 scope/异形 payload）', () => {
    const { clock } = issueWith()
    const auth = createWkeyAuthority(SECRET, clock.clock)
    expect(auth.verify('garbage', { now: 1 })).toEqual({ ok: false, reason: 'malformed' })
    expect(auth.verify('a.b.c', { now: 1 })).toEqual({ ok: false, reason: 'malformed' })
    expect(auth.verify('.abc', { now: 1 })).toEqual({ ok: false, reason: 'malformed' })
    expect(auth.verify('abc.', { now: 1 })).toEqual({ ok: false, reason: 'malformed' })
    expect(auth.verify('a*b.c*d', { now: 1 })).toEqual({ ok: false, reason: 'malformed' })
    // 合签名包坏 JSON：自己造 payload+签名
    const badJson = Buffer.from('not json', 'utf8').toString('base64url')
    const mac = createHmac('sha256', SECRET).update(badJson, 'utf8').digest().toString('base64url')
    expect(auth.verify(`${badJson}.${mac}`, { now: 1 })).toEqual({ ok: false, reason: 'malformed' })
    // 合 JSON 但 scope 表外（重签绕道：签发期已拦，此处直接构造）
    const evil = Buffer.from(JSON.stringify({ v: 1, ticket: '2-100', scope: ['transition'], exp: 9_999_999_999_999, nonce: 'e' }), 'utf8').toString('base64url')
    const mac2 = createHmac('sha256', SECRET).update(evil, 'utf8').digest().toString('base64url')
    expect(auth.verify(`${evil}.${mac2}`, { now: 1 })).toEqual({ ok: false, reason: 'malformed' })
    // JSON 数组形态
    const arr = Buffer.from(JSON.stringify([1, 2]), 'utf8').toString('base64url')
    const mac3 = createHmac('sha256', SECRET).update(arr, 'utf8').digest().toString('base64url')
    expect(auth.verify(`${arr}.${mac3}`, { now: 1 })).toEqual({ ok: false, reason: 'malformed' })
  })
})

describe('wkey 构造期 CONFIG_INVALID 通道', () => {
  test('空 secret / 过短 secret 抛 CONFIG_INVALID/gw-secret-*', () => {
    const clock = fakeClock()
    expect(() => createWkeyAuthority(new Uint8Array(0), clock.clock)).toThrowError(/CONFIG_INVALID\/gw-secret-empty/)
    expect(() => createWkeyAuthority(new Uint8Array(16), clock.clock)).toThrowError(/CONFIG_INVALID\/gw-secret-too-short/)
  })

  test('ttl 非法格式抛 CONFIG_INVALID/gw-bad-ttl（空/无单位/多段/零/负）', () => {
    const clock = fakeClock()
    const auth = createWkeyAuthority(SECRET, clock.clock)
    for (const ttl of ['', '10', 'm', '1h30m', '0m', '-5m', '1.5h', '1y']) {
      expect(() => auth.issue({ ...CLAIMS, ttl })).toThrowError(/CONFIG_INVALID\/gw-bad-ttl/)
    }
  })

  test('claims 空字段抛 CONFIG_INVALID/gw-bad-claims（空单号/空 nonce/空 scope）', () => {
    const clock = fakeClock()
    const auth = createWkeyAuthority(SECRET, clock.clock)
    expect(() => auth.issue({ ...CLAIMS, ticket: '' })).toThrowError(/CONFIG_INVALID\/gw-bad-claims/)
    expect(() => auth.issue({ ...CLAIMS, nonce: '' })).toThrowError(/CONFIG_INVALID\/gw-bad-claims/)
    expect(() => auth.issue({ ...CLAIMS, scope: [] })).toThrowError(/CONFIG_INVALID\/gw-bad-claims/)
  })
})

describe('secret 卫生：明文永不进错误消息', () => {
  test('构造/校验全部错误消息不含 secret 子串（含多形态：原文/hex/utf8）', () => {
    const secretStr = '0123456789abcdef0123456789abcdef'
    const errs: string[] = []
    try {
      createWkeyAuthority(new Uint8Array(0), () => 0)
    } catch (e) {
      errs.push(String(e))
    }
    const clock = fakeClock()
    const auth = createWkeyAuthority(SECRET, clock.clock)
    const r1 = auth.verify('garbage', { now: 1 })
    const r2 = auth.verify('a*b.c*d', { now: 1 })
    errs.push(JSON.stringify(r1), JSON.stringify(r2))
    const secretHex = Buffer.from(SECRET).toString('hex')
    const secretB64 = Buffer.from(SECRET).toString('base64')
    for (const msg of errs) {
      expect(msg).not.toContain(secretStr)
      expect(msg).not.toContain(secretHex)
      expect(msg).not.toContain(secretB64)
    }
  })
})

describe('控制面 wkey（issueControlKey）', () => {
  test('scope 全开（= GATEWAY_ACTIONS 全量）、单号=CONTROL_TICKET、默认 TTL 生效', () => {
    const { clock } = issueWith()
    const auth = createWkeyAuthority(SECRET, clock.clock)
    const key = issueControlKey(auth)
    const r = auth.verify(key, { now: 1_000_000_000_000 + 1, ticket: CONTROL_TICKET })
    expect(r.ok && [...r.claims.scope]).toEqual([...GATEWAY_ACTIONS])
    expect(r.ok && r.claims.ticket).toBe(CONTROL_TICKET)
    // 默认 15m：+15min 整拒（边界），-1ms 放行
    const edge = auth.verify(issueControlKey(auth), { now: 1_000_000_000_000 + 15 * 60_000, ticket: CONTROL_TICKET })
    expect(edge).toEqual({ ok: false, reason: 'expired' })
    expect(CONTROL_TTL_DEFAULT).toBe('15m')
  })

  test('nonce 随机：两张控制 key 互不构成重放；revoke(CONTROL_TICKET) 一刀切', () => {
    const { clock } = issueWith()
    const auth = createWkeyAuthority(SECRET, clock.clock)
    const k1 = issueControlKey(auth)
    const k2 = issueControlKey(auth)
    expect(auth.verify(k1, { now: 1_000_000_000_001, ticket: CONTROL_TICKET }).ok).toBe(true)
    expect(auth.verify(k2, { now: 1_000_000_000_001, ticket: CONTROL_TICKET }).ok).toBe(true)
    auth.revoke(CONTROL_TICKET)
    const k3 = issueControlKey(auth)
    expect(auth.verify(k3, { now: 1_000_000_000_001, ticket: CONTROL_TICKET })).toEqual({ ok: false, reason: 'revoked' })
  })
})
