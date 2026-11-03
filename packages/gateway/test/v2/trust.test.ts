/**
 * trust.test.ts —— PORT-TRUST 生产实现（凭据目录/秘密五型）负向与正向（studio-dev-544 差距项 #18）
 *
 * 依据：docs/17-§2/§6、docs/v2/14 §1.7（verifySource/issue/supply/revoke/auditUse）、
 *   docs/v2/15 §4.1/4.3/4.5（五型/轮换吊销/三不入）、docs/v2/11 §2.2（REC-AUTH-04）、
 *   docs/v2/17 §4.1（NEG-SEC-08）。
 *
 * 断言口径（「放行路径必须不存在」）：
 *   1. 启动期 fail-closed：声明非法/重复/值形态/必需缺证＝CONFIG_INVALID 抛错（对象不产出）；
 *   2. 用途越界（allowedUses 外）/未知引用/已撤/过期/类别不符/scope 越权一律 Err；
 *   3. 目录/句柄/审计记录均无值位；明文探针不出现在任何导出物；
 *   4. 轮换只升版本不换 id（改 id/降版本/有后代＝拒）；吊销须三动作证据（无据＝拒）。
 */
import { describe, expect, it } from 'vitest'
import type { CallContext, CredentialRef, PortResult, ReadContext } from '@studio-next/contract'
import { createSecretTrust, type SecretDeclaration, type SecretTrust } from '../../src/trust.ts'

const NOW = Date.parse('2026-06-01T00:00:00Z')
const WINDOW = { from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z' }
const COMPANY = { companyId: 'studio-dev', slug: 'studio-dev' }
const PROBE = 'probe-secret-value-8f2c1d'

const ROOT: SecretDeclaration = {
  secretId: 'SEC-GW-ROOT',
  secretType: 'signing_root_control',
  credentialClass: 'root',
  logicalReference: 'cred-root@company',
  boundGrant: { recordId: 'grant-root-1', refVersion: '1.0.0' },
  allowedUses: ['gateway-sign'],
  validWindow: WINDOW,
  exposureScope: 'position:PRIME-0',
  valueProvider: { type: 'broker-ref', secretId: 'SEC-GW-ROOT', profile: 'root-broker' },
}

const PARTNER: SecretDeclaration = {
  secretId: 'SEC-EXT-PARTNER',
  secretType: 'external_outbound',
  credentialClass: 'scoped',
  logicalReference: 'partner-a@company',
  boundGrant: { recordId: 'grant-scoped-1', refVersion: '1.0.0' },
  parentCredentialRef: 'SEC-GW-ROOT',
  allowedUses: ['trigger-intake', 'outbound-redaction'],
  validWindow: WINDOW,
  exposureScope: 'deployment:studio-dev',
  valueProvider: { type: 'env-ref', name: 'STUDIO_PARTNER_A_TOKEN' },
  holder: { callerId: 'PARTNER-1', kind: 'program', programRef: 'partner-a' },
}

const ROTATABLE: SecretDeclaration = {
  secretId: 'SEC-EXT-ROT',
  secretType: 'external_outbound',
  credentialClass: 'scoped',
  logicalReference: 'partner-rot@company',
  boundGrant: { recordId: 'grant-scoped-2', refVersion: '1.0.0' },
  parentCredentialRef: 'SEC-GW-ROOT',
  allowedUses: ['trigger-intake'],
  validWindow: WINDOW,
  exposureScope: 'deployment:studio-dev',
  valueProvider: { type: 'env-ref', name: 'STUDIO_PARTNER_ROT_TOKEN' },
}

function makeTrust(over: { declarations?: readonly SecretDeclaration[]; proof?: boolean } = {}): { trust: SecretTrust; setNow: (ms: number) => void } {
  let now = NOW
  const declarations = over.declarations ?? [ROOT, PARTNER, ROTATABLE]
  const trust = createSecretTrust({
    declarations,
    clock: () => now,
    ...(over.proof === true
      ? {
          revocationProofFor: (): { recordId: string; injectionStopped: boolean; fenceRejectionRecorded: boolean; evidenceRefs: [string, ...string[]]; noDescendantConfirmation: { probeMethod: string; lastProbedAt: string } } => ({
            recordId: 'rev-1',
            injectionStopped: true,
            fenceRejectionRecorded: true,
            evidenceRefs: ['ev-1', 'ev-2', 'ev-3'],
            noDescendantConfirmation: { probeMethod: 'descendant-scan', lastProbedAt: '2026-06-01T00:00:00Z' },
          }),
        }
      : {}),
  })
  return { trust, setNow: (ms: number) => { now = ms } }
}

function rc(purpose: string): ReadContext {
  return {
    readScope: { company: COMPANY, fields: ['credential_reference'], purpose },
    caller: { callerId: 'gateway/verify', kind: 'program', programRef: 'test' },
  }
}

function ctx(): CallContext {
  return {
    company: COMPANY,
    caller: { callerId: 'PRIME-0', kind: 'employment', personId: 'PRIME-0' },
    authority: [{ recordId: 'grant-root-1', version: { recordId: 'grant-root-1', version: 1 }, grantClass: 'root_delegation' }],
    signature: { actorKind: 'person', actorRef: 'PRIME-0' },
  }
}

function ok<T>(result: PortResult<T>): T {
  if (result.kind !== 'ok') throw new Error(`期望 Ok，实际 ${result.error.category}/${result.error.subcause}`)
  return result.value
}

function code<T>(result: PortResult<T>): string {
  if (result.kind !== 'err') throw new Error('期望 Err（放行路径必须不存在），实际 Ok')
  return `${result.error.category}/${result.error.subcause}`
}

function refOf(credentialId: string, scope: readonly string[]): CredentialRef {
  return { credentialId, credentialClass: 'scoped', scope, ttl: { seconds: 60 } }
}

describe('PORT-TRUST 构造期 fail-closed（缺证即拒）', () => {
  it('空声明集＝显式空目录（不产出条目，后续核验全拒）', () => {
    const trust = createSecretTrust({ declarations: [] })
    expect(trust.rows()).toEqual([])
    expect(code(trust.verifySource({ handleId: 'partner-a@company', tokenKind: 'external_outbound' }, rc('trigger-intake')))).toBe(
      'unverified/trust-source-unknown',
    )
  })

  it('非法 secretId → CONFIG_INVALID/trust-declaration-catalog-entry-invalid', () => {
    expect(() => createSecretTrust({ declarations: [{ ...PARTNER, secretId: 'not-a-secret-id' }] })).toThrow(
      /CONFIG_INVALID\/trust-declaration-catalog-entry-invalid/,
    )
  })

  it('值形态字段 → CONFIG_INVALID/trust-declaration-catalog-value-rejected（目录不是值存放处）', () => {
    expect(() => createSecretTrust({ declarations: [{ ...PARTNER, value: PROBE } as unknown as SecretDeclaration] })).toThrow(
      /CONFIG_INVALID\/trust-declaration-catalog-value-rejected/,
    )
  })

  it('重复 secretId → CONFIG_INVALID/trust-declaration-catalog-entry-duplicate', () => {
    expect(() => createSecretTrust({ declarations: [ROOT, ROOT] })).toThrow(
      /CONFIG_INVALID\/trust-declaration-catalog-entry-duplicate/,
    )
  })

  it('必需秘密缺证 → CONFIG_INVALID/trust-secret-missing（缺证即拒，不降级）', () => {
    expect(() => createSecretTrust({ declarations: [ROOT], requiredSecretIds: ['SEC-MX-BOT-PASSWORD'] })).toThrow(
      /CONFIG_INVALID\/trust-secret-missing/,
    )
  })

  it('过期有效期 → 构造期拒绝（登记即不可用不是「有效」）', () => {
    expect(() => createSecretTrust({ declarations: [{ ...ROOT, validWindow: { from: '2025-01-01T00:00:00Z', to: '2025-02-01T00:00:00Z' } }] })).toThrow(
      /CONFIG_INVALID\/trust-declaration-catalog-window-invalid/,
    )
  })
})

describe('verifySource：来源核验 fail-closed', () => {
  it('命中目录且用途在 allowedUses 内 → 返回持有者（逻辑引用/身份，不含值）', () => {
    const { trust } = makeTrust()
    const caller = ok(trust.verifySource({ handleId: 'partner-a@company', tokenKind: 'external_outbound' }, rc('trigger-intake')))
    expect(caller).toEqual({ callerId: 'PARTNER-1', kind: 'program', programRef: 'partner-a' })
    expect(JSON.stringify(caller)).not.toContain(PROBE)
  })

  it('未知凭据引用 → unverified/trust-source-unknown（不回落匿名）', () => {
    const { trust } = makeTrust()
    expect(code(trust.verifySource({ handleId: 'unknown@company', tokenKind: 'external_outbound' }, rc('trigger-intake')))).toBe(
      'unverified/trust-source-unknown',
    )
  })

  it('用途越界（allowedUses 外）→ rejected_forbidden/trust-use-not-allowed', () => {
    const { trust } = makeTrust()
    expect(code(trust.verifySource({ handleId: 'partner-a@company', tokenKind: 'external_outbound' }, rc('matrix-register')))).toBe(
      'rejected_forbidden/trust-use-not-allowed',
    )
  })

  it('令牌类型与条目 secretType 不符 → unverified/trust-source-kind-mismatch', () => {
    const { trust } = makeTrust()
    expect(code(trust.verifySource({ handleId: 'partner-a@company', tokenKind: 'model_key' }, rc('trigger-intake')))).toBe(
      'unverified/trust-source-kind-mismatch',
    )
  })

  it('缺读上下文（无 purpose/fields/caller）→ rejected_precondition/trust-context-invalid', () => {
    const { trust } = makeTrust()
    expect(code(trust.verifySource({ handleId: 'partner-a@company', tokenKind: 'external_outbound' }, {} as ReadContext))).toBe(
      'rejected_precondition/trust-context-invalid',
    )
  })

  it('过期 → rejected_authority/trust-source-expired（不预支、不复用）', () => {
    const { trust, setNow } = makeTrust()
    setNow(Date.parse('2027-02-01T00:00:00Z'))
    expect(code(trust.verifySource({ handleId: 'partner-a@company', tokenKind: 'external_outbound' }, rc('trigger-intake')))).toBe(
      'rejected_authority/trust-source-expired',
    )
  })
})

describe('supply：短时供给（无值句柄）', () => {
  it('合法引用 → 句柄；无值位（三不入类型级保证）', () => {
    const { trust } = makeTrust()
    const handle = ok(trust.supply(refOf('partner-a@company', ['trigger-intake']), { seconds: 60 }, rc('trigger-intake')))
    expect(handle.singleUse).toBe(true)
    expect('value' in handle).toBe(false)
    expect(handle.credential).not.toHaveProperty('value')
    expect(JSON.stringify(handle)).not.toContain(PROBE)
  })

  it('未知凭据引用 → rejected_precondition/trust-ref-unknown（缺证即拒不产出句柄）', () => {
    const { trust } = makeTrust()
    expect(code(trust.supply(refOf('nope@company', ['trigger-intake']), { seconds: 60 }, rc('trigger-intake')))).toBe(
      'rejected_precondition/trust-ref-unknown',
    )
  })

  it('引用 scope 超出条目 allowedUses → rejected_authority/trust-ref-scope-mismatch', () => {
    const { trust } = makeTrust()
    expect(code(trust.supply(refOf('partner-a@company', ['gateway-sign']), { seconds: 60 }, rc('trigger-intake')))).toBe(
      'rejected_authority/trust-ref-scope-mismatch',
    )
  })

  it('供给用途越界 → rejected_forbidden/trust-use-not-allowed', () => {
    const { trust } = makeTrust()
    expect(code(trust.supply(refOf('partner-a@company', ['trigger-intake']), { seconds: 60 }, rc('matrix-register')))).toBe(
      'rejected_forbidden/trust-use-not-allowed',
    )
  })

  it('短时窗口超出凭据有效期 → catalog-window-invalid（只收紧不放宽）', () => {
    const { trust } = makeTrust()
    expect(code(trust.supply(refOf('partner-a@company', ['trigger-intake']), { seconds: 400 * 24 * 3600 }, rc('trigger-intake')))).toBe(
      'rejected_precondition/catalog-window-invalid',
    )
  })
})

describe('issue：签发只产逻辑引用（类别/父链/用途约束）', () => {
  const base = {
    holder: { callerId: 'PRIME-0', kind: 'employment' as const, personId: 'PRIME-0' },
    secretType: 'per_task_shortlived' as const,
    ttl: { seconds: 60 },
    purpose: 'gateway-sign',
  }

  it('scoped 子凭据：父链在册＋scope⊆父用途 → 逻辑引用，可再供给', () => {
    const { trust } = makeTrust()
    const issued = ok(trust.issue({ ...base, credentialClass: 'scoped', parentCredentialRef: 'SEC-GW-ROOT', scope: ['gateway-sign'] }, ctx()))
    expect(issued.credentialClass).toBe('scoped')
    expect(issued.value).toBeUndefined()
    expect(issued.credentialId).not.toContain(PROBE)
    const handle = ok(trust.supply({ ...issued, scope: ['gateway-sign'] }, { seconds: 30 }, rc('gateway-sign')))
    expect(handle.singleUse).toBe(true)
  })

  it('未知父凭据 → rejected_authority/trust-parent-unknown（父链断不签）', () => {
    const { trust } = makeTrust()
    expect(code(trust.issue({ ...base, credentialClass: 'scoped', parentCredentialRef: 'SEC-NOPE-1', scope: ['gateway-sign'] }, ctx()))).toBe(
      'rejected_authority/trust-parent-unknown',
    )
  })

  it('子 scope 超出父用途 → rejected_forbidden/trust-scope-exceeds-parent（不得扩权）', () => {
    const { trust } = makeTrust()
    expect(code(trust.issue({ ...base, credentialClass: 'scoped', parentCredentialRef: 'SEC-GW-ROOT', scope: ['trigger-intake'], purpose: 'trigger-intake' }, ctx()))).toBe(
      'rejected_forbidden/trust-use-not-allowed',
    )
  })

  it('root 签发无 root_delegation 记录 → rejected_authority/trust-root-not-delegated', () => {
    const { trust } = makeTrust()
    expect(code(trust.issue({ ...base, credentialClass: 'root', rootDelegationRef: 'grant-root-x', scope: ['gateway-sign'] }, ctx()))).toBe(
      'rejected_authority/trust-root-not-delegated',
    )
  })

  it('缺写上下文 → rejected_precondition/trust-context-invalid', () => {
    const { trust } = makeTrust()
    expect(code(trust.issue({ ...base, credentialClass: 'scoped', parentCredentialRef: 'SEC-GW-ROOT', scope: ['gateway-sign'] }, {} as CallContext))).toBe(
      'rejected_precondition/trust-context-invalid',
    )
  })
})

describe('revoke：三动作证据＋后代枚举（NEG-SEC-08 前腿）', () => {
  it('无证据提供面 → rejected_precondition/trust-proof-missing（无据不得宣称吊销完成）', () => {
    const { trust } = makeTrust()
    expect(code(trust.revoke(refOf('partner-a@company', ['trigger-intake']), ctx()))).toBe(
      'rejected_precondition/trust-proof-missing',
    )
  })

  it('三动作不齐/后代枚举缺项 → catalog 拒绝（不落吊销状态）', () => {
    const { trust } = makeTrust()
    const ref = refOf('partner-a@company', ['trigger-intake'])
    expect(
      code(
        trust.revokeWithProof(
          ref,
          { recordId: 'rev-x', injectionStopped: false, fenceRejectionRecorded: true, evidenceRefs: ['ev-1'] },
          ctx(),
        ),
      ),
    ).toBe('rejected_precondition/catalog-proof-missing')
    expect(
      code(
        trust.revokeWithProof(
          refOf('cred-root@company', ['gateway-sign']),
          { recordId: 'rev-x', injectionStopped: true, fenceRejectionRecorded: true, evidenceRefs: ['ev-1', 'ev-2'], descendants: [] },
          ctx(),
        ),
      ),
    ).toBe('rejected_precondition/catalog-descendants-incomplete')
  })

  it('证据齐＋无后代显式确认 → 回执三动作逐项；随后 verify/supply 均拒（NEG-SEC-08）', () => {
    const { trust } = makeTrust({ proof: true })
    const receipt = ok(trust.revoke(refOf('partner-a@company', ['trigger-intake']), ctx()))
    expect(receipt.revocationRecorded).toBe(true)
    expect(receipt.injectionStopped).toBe(true)
    expect(receipt.fenceRejectionRecorded).toBe(true)
    expect(receipt.evidence.length).toBe(3)
    expect(code(trust.verifySource({ handleId: 'partner-a@company', tokenKind: 'external_outbound' }, rc('trigger-intake')))).toBe(
      'rejected_authority/trust-source-revoked',
    )
    expect(code(trust.supply(refOf('partner-a@company', ['trigger-intake']), { seconds: 60 }, rc('trigger-intake')))).toBe(
      'rejected_authority/trust-source-revoked',
    )
  })
})

describe('rotate：轮换只升版本不换 id', () => {
  it('版本递增＋有效期后移 → 新行生效（同 secretId/逻辑引用）', () => {
    const { trust } = makeTrust()
    const rotated = ok(
      trust.rotate('SEC-EXT-ROT', {
        secretId: 'SEC-EXT-ROT',
        secretType: 'external_outbound',
        credentialClass: 'scoped',
        logicalReference: 'partner-rot@company',
        boundGrant: { recordId: 'grant-scoped-2', refVersion: '1.1.0' },
        parentCredentialRef: 'SEC-GW-ROOT',
        permittedOperations: ROTATABLE.allowedUses,
        validWindow: { from: '2026-07-01T00:00:00Z', to: '2028-01-01T00:00:00Z' },
        exposureScope: 'deployment:studio-dev',
        valueProvider: { type: 'env-ref', name: 'STUDIO_PARTNER_ROT_TOKEN' },
      }),
    )
    expect(trust.rows().find((row) => row.logical_reference === 'partner-rot@company')?.valid_window.to).toBe('2028-01-01T00:00:00Z')
    expect(rotated.logical_reference).toBe('partner-rot@company')
  })

  it('版本未递增 → rejected_precondition/catalog-rotation-invalid', () => {
    const { trust } = makeTrust()
    expect(
      code(
        trust.rotate('SEC-EXT-ROT', {
          secretId: 'SEC-EXT-ROT',
          secretType: 'external_outbound',
          credentialClass: 'scoped',
          logicalReference: 'partner-rot@company',
          boundGrant: { recordId: 'grant-scoped-2', refVersion: '1.0.0' },
          parentCredentialRef: 'SEC-GW-ROOT',
          permittedOperations: ROTATABLE.allowedUses,
          validWindow: { from: '2026-07-01T00:00:00Z', to: '2028-01-01T00:00:00Z' },
          exposureScope: 'deployment:studio-dev',
          valueProvider: { type: 'env-ref', name: 'STUDIO_PARTNER_ROT_TOKEN' },
        }),
      ),
    ).toBe('rejected_precondition/catalog-rotation-invalid')
  })

  it('有后代时轮换父凭据 → rejected_precondition/catalog-rotation-has-descendants', () => {
    const { trust } = makeTrust()
    expect(
      code(
        trust.rotate('SEC-GW-ROOT', {
          secretId: 'SEC-GW-ROOT',
          secretType: 'signing_root_control',
          credentialClass: 'root',
          logicalReference: 'cred-root@company',
          boundGrant: { recordId: 'grant-root-1', refVersion: '2.0.0' },
          permittedOperations: ROOT.allowedUses,
          validWindow: { from: '2026-07-01T00:00:00Z', to: '2028-01-01T00:00:00Z' },
          exposureScope: 'position:PRIME-0',
          valueProvider: { type: 'broker-ref', secretId: 'SEC-GW-ROOT', profile: 'root-broker' },
        }),
      ),
    ).toBe('rejected_precondition/catalog-rotation-has-descendants')
  })
})

describe('无值面（三不入）与审计记录面', () => {
  it('目录行/审计视图/审计记录均无值位，探针明文不出现', () => {
    const { trust } = makeTrust()
    ok(trust.supply(refOf('partner-a@company', ['trigger-intake']), { seconds: 60 }, rc('trigger-intake')))
    const dump = JSON.stringify({ rows: trust.rows(), views: trust.entryViews(), uses: trust.useRecords() })
    expect(dump).not.toContain(PROBE)
    expect(dump).not.toContain('"value":')
    expect(trust.useRecords().length).toBeGreaterThan(0)
    expect(trust.useRecords()[0]?.purpose).toBe('trigger-intake')
  })
})
