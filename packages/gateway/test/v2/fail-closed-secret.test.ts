/**
 * fail-closed-secret.test.ts —— 网关构造期 fail-closed（SEC-FC-02；plan/05 IMPL-07-06）
 *
 * 依据：v2/15 §一 SEC-FC-02（gatewaySecret 缺省回落公开常量＝签根公开化；目标＝无配置＝拒启
 *   CONFIG_INVALID、dev 常量删除）；v2/17 §4.1 NEG-SEC-01（`gateway:false` 在生产配置面不存在）；
 *   docs/plan/05 IMPL-07-06 验收「`bun run test:v2 -- packages/gateway` 绿」。
 *
 * 断言口径（「放行路径必须不存在」）：
 *   1. 缺/空/过短/弱形态签根＝构造期 CONFIG_INVALID 抛错（对象不产出，无降级告警继续）；
 *   2. 无仓内缺省常量：本套件不依赖任何"开发密钥"，合法实例必须显式注入材料；
 *   3. 错误消息只报形态（长度/类别），不打印签根值（明文/hex/base64 三形态都不行）。
 */
import { describe, expect, it } from 'vitest'
import { CONTROL_TICKET, createGateway } from '../../src/gateway.ts'
import type { GatewayOptions } from '../../src/gateway.ts'
import type { SignatureContext } from '../../src/signature.ts'

const CTX: SignatureContext = { company: '测试公司', dept: 'departments/平台部', role: 'daemon', level: 2 }
/** 合法签根（32 ASCII 字节、非重复）——显式注入，不来自仓内常量 */
const STRONG_SECRET = new TextEncoder().encode('0123456789abcdef0123456789abcdef')

function options(over: Partial<GatewayOptions> = {}): GatewayOptions {
  return { secret: STRONG_SECRET, clock: (): number => 1_700_000_000_000, ticket: CONTROL_TICKET, ctx: CTX, author: 'PRIME-0', ...over }
}

/** 捕获构造期异常消息（只断言消息；不断言错误类型，避免与 contract 分类实现耦合） */
function constructError(over: Partial<GatewayOptions>): string {
  try {
    createGateway(options(over))
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
  throw new Error('期望构造期抛 CONFIG_INVALID，实际构造成功（fail-open 路径仍在）')
}

describe('SEC-FC-02 签根 fail-closed（无缺省、无降级）', () => {
  it('未注入签根（undefined）→ CONFIG_INVALID/gw-secret-missing（不回落任何仓内常量）', () => {
    expect(constructError({ secret: undefined as unknown as Uint8Array })).toMatch(/CONFIG_INVALID\/gw-secret-missing/)
  })

  it('非 Uint8Array（字符串形态）→ CONFIG_INVALID/gw-secret-missing', () => {
    expect(constructError({ secret: '0123456789abcdef0123456789abcdef' as unknown as Uint8Array })).toMatch(
      /CONFIG_INVALID\/gw-secret-missing/,
    )
  })

  it('空签根 → CONFIG_INVALID/gw-secret-empty', () => {
    expect(constructError({ secret: new Uint8Array(0) })).toMatch(/CONFIG_INVALID\/gw-secret-empty/)
  })

  it('过短（31 字节）→ CONFIG_INVALID/gw-secret-too-short（32 字节门限）', () => {
    expect(constructError({ secret: new TextEncoder().encode('0123456789abcdef0123456789abcde') })).toMatch(
      /CONFIG_INVALID\/gw-secret-too-short/,
    )
  })

  it('弱形态（全零）→ CONFIG_INVALID/gw-secret-weak', () => {
    expect(constructError({ secret: new Uint8Array(32) })).toMatch(/CONFIG_INVALID\/gw-secret-weak/)
  })

  it('弱形态（单一可打印字节重复＝占位密钥形态）→ CONFIG_INVALID/gw-secret-weak', () => {
    expect(constructError({ secret: new Uint8Array(32).fill('a'.charCodeAt(0)) })).toMatch(/CONFIG_INVALID\/gw-secret-weak/)
  })

  it('错误消息不打印签根值（明文/hex/base64 三形态均不得出现）', () => {
    const secret = STRONG_SECRET.slice(0, 31) // 触发过短门，消息会带长度
    const message = constructError({ secret })
    const text = new TextDecoder().decode(secret)
    expect(message).not.toContain(text)
    expect(message).not.toContain(Buffer.from(secret).toString('hex'))
    expect(message).not.toContain(Buffer.from(secret).toString('base64'))
  })

  it('显式注入 32 字节材料＝唯一合法路径（构造成功且可签发）', () => {
    const gateway = createGateway(options())
    const token = gateway.issue({ ticket: 'T-1', scope: ['comment'], ttl: '10m', nonce: 'n-1' })
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  })
})
