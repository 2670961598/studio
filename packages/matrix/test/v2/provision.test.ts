/**
 * provision.test.ts —— bot 密码秘密目录条目（plan/05 IMPL-07-12「秘密 catalog＋bot 密码收敛」）
 *
 * 依据：v2/15 §4.1 SEC-T1（平台凭据只出现「类别＋逻辑引用」）；v2/16 §三 matrix 行
 *   （bot 密码 `allowedUses` **恰两项**＝platform-auth+outbound-redaction，不含 matrix-register
 *   ——治 L3O-01/Q-01）；78-§7.4.1／80-§11.2.1（恰两项、无「保留未用」位；请求 matrix-register
 *   即 rejected_forbidden）；docs/plan/05 IMPL-07-12 验收「matrix allowedUses 断言恰两项」。
 *
 * 断言口径：
 *   1. 恰两项且顺序冻结；类型级也是两值元组——**加第三项即编译红**（不靠人盯）。
 *   2. 不扩用：`matrix-register` 不在集内（建号只认 SEC-MX-HR-SHARED，bot 密码无建号旁路）。
 *   3. 秘密不入日志/包：条目只含 secretId/kind/allowedUses 三键、无值位；模块全部导出物
 *      检索不到探针密码值，声明冻结不可写。
 */
import { describe, expect, expectTypeOf, it } from 'vitest'
import * as provision from '../../src/provision.ts'
import { BOT_PASSWORD_SECRET } from '../../src/provision.ts'

const PROBE = 'probe-bot-password-6a1f0c'
const PROBE_ENV = 'MATRIX_BOT_PASSWORD'

describe('SEC-MX-BOT-PASSWORD 目录条目（SEC-T1；matrix 行改造项）', () => {
  it('标识与类别：SEC-MX-BOT-PASSWORD / password', () => {
    expect(BOT_PASSWORD_SECRET.secretId).toBe('SEC-MX-BOT-PASSWORD')
    expect(BOT_PASSWORD_SECRET.kind).toBe('password')
  })

  it('allowedUses 恰两项＝platform-auth + outbound-redaction（顺序冻结、去重、冻结不可写）', () => {
    expect(BOT_PASSWORD_SECRET.allowedUses).toEqual(['platform-auth', 'outbound-redaction'])
    expect(BOT_PASSWORD_SECRET.allowedUses.length).toBe(2)
    expect(new Set(BOT_PASSWORD_SECRET.allowedUses).size).toBe(2)
    expectTypeOf(BOT_PASSWORD_SECRET.allowedUses).toEqualTypeOf<readonly ['platform-auth', 'outbound-redaction']>()
    expect(Object.isFrozen(BOT_PASSWORD_SECRET)).toBe(true)
    expect(Object.isFrozen(BOT_PASSWORD_SECRET.allowedUses)).toBe(true)
    expect(() => {
      ;(BOT_PASSWORD_SECRET as { kind: string }).kind = 'mutated'
    }).toThrow()
  })

  it('不扩用：matrix-register 不在集内（建号只认 SEC-MX-HR-SHARED；bot 密码无建号旁路）', () => {
    const allowed = new Set<string>(BOT_PASSWORD_SECRET.allowedUses)
    expect(allowed.has('matrix-register')).toBe(false)
    expect(allowed.has('platform-auth')).toBe(true)
    expect(allowed.has('outbound-redaction')).toBe(true)
    // 恰两项 ⇒ 六值域其余成员一律不得出现（不设「保留未用」位）
    for (const other of ['gateway-sign', 'matrix-notify', 'broker-issue']) {
      expect(allowed.has(other)).toBe(false)
    }
  })

  it('秘密不入日志/包：三键无值位，模块导出物检索不到探针密码值', () => {
    process.env[PROBE_ENV] = PROBE
    try {
      expect(Object.keys(BOT_PASSWORD_SECRET).sort()).toEqual(['allowedUses', 'kind', 'secretId'])
      expect('value' in BOT_PASSWORD_SECRET).toBe(false)
      expect('material' in BOT_PASSWORD_SECRET).toBe(false)
      for (const exported of Object.values(provision)) {
        const text = typeof exported === 'function' ? String(exported) : JSON.stringify(exported) ?? ''
        expect(text).not.toContain(PROBE)
      }
      expect(JSON.stringify(BOT_PASSWORD_SECRET)).not.toContain(PROBE)
    } finally {
      delete process.env[PROBE_ENV]
    }
  })
})
