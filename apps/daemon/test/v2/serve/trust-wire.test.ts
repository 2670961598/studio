/**
 * trust-wire.test.ts —— PORT-TRUST 生产装配腿（studio-dev-544 差距项 #18）
 *
 * 依据：docs/v2/14 §1.7（PORT-TRUST 装配域=gateway 凭据＋assembly 供给）、docs/v2/15
 *   §4.1/4.5（五型/三不入）、docs/17-§2（七相位不增删——装配在 serve 组合根，不在主循环）。
 *
 * 断言口径：未注入＝目录空置（fail-closed 面保留）；注入非法/必需缺证＝CONFIG_INVALID 拒启；
 * 观测行只报条数/纪律，不报值。
 */
import { describe, expect, it } from 'vitest'
import { readSecretDeclarations, wireSecretTrust } from '../../../src/assembly/trust/wire.ts'

const WINDOW = { from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z' }
const DECLARATION = {
  secretId: 'SEC-MX-BOT-PASSWORD',
  secretType: 'platform_credential' as const,
  credentialClass: 'scoped' as const,
  logicalReference: 'mx-bot@company',
  boundGrant: { recordId: 'grant-root-1', refVersion: '1.0.0' },
  parentCredentialRef: 'SEC-GW-ROOT',
  allowedUses: ['platform-auth', 'outbound-redaction'] as const,
  validWindow: WINDOW,
  exposureScope: 'deployment:studio-dev',
  valueProvider: { type: 'env-ref' as const, name: 'MATRIX_BOT_PASSWORD' },
}

const ROOT = {
  secretId: 'SEC-GW-ROOT',
  secretType: 'signing_root_control' as const,
  credentialClass: 'root' as const,
  logicalReference: 'cred-root@company',
  boundGrant: { recordId: 'grant-root-1', refVersion: '1.0.0' },
  allowedUses: ['gateway-sign'] as const,
  validWindow: WINDOW,
  exposureScope: 'position:PRIME-0',
  valueProvider: { type: 'broker-ref' as const, secretId: 'SEC-GW-ROOT', profile: 'root-broker' },
}

describe('wireSecretTrust：装配期 fail-closed', () => {
  it('未注入声明 → undefined（目录空置，伙伴档/供给保持拒；不造缺省条目）', () => {
    const lines: string[] = []
    const trust = wireSecretTrust({ log: (line) => lines.push(line) })
    expect(trust).toBeUndefined()
    expect(lines.join('\n')).toContain('未注入秘密声明')
    expect(lines.join('\n')).toContain('fail-closed')
  })

  it('注入声明 → 登记成功并输出条数（不输出值）', () => {
    const lines: string[] = []
    const trust = wireSecretTrust({ declarations: [ROOT, DECLARATION], log: (line) => lines.push(line) })
    expect(trust?.rows().length).toBe(2)
    const text = lines.join('\n')
    expect(text).toContain('PORT-TRUST 凭据目录已接：2 条')
    expect(text).toContain('值不入目录')
    expect(text).not.toContain('MATRIX_BOT_PASSWORD=')
  })

  it('声明非法 → 构造期抛 CONFIG_INVALID（启动即拒，不降级告警继续）', () => {
    expect(() =>
      wireSecretTrust({ declarations: [{ ...DECLARATION, secretId: 'bad-id' }], log: () => {} }),
    ).toThrow(/CONFIG_INVALID\/trust-declaration-catalog-entry-invalid/)
  })

  it('必需秘密缺证 → 构造期抛 CONFIG_INVALID/trust-secret-missing', () => {
    expect(() =>
      wireSecretTrust({ declarations: [ROOT], requiredSecretIds: ['SEC-MX-BOT-PASSWORD'], log: () => {} }),
    ).toThrow(/CONFIG_INVALID\/trust-secret-missing/)
  })

  it('声明 JSON 形状闸：非数组/项缺 secretId → CONFIG_INVALID/trust-declarations-invalid', () => {
    expect(() => readSecretDeclarations({})).toThrow(/CONFIG_INVALID\/trust-declarations-invalid/)
    expect(() => readSecretDeclarations([{}])).toThrow(/CONFIG_INVALID\/trust-declarations-invalid/)
    expect(readSecretDeclarations([DECLARATION])).toHaveLength(1)
  })
})
