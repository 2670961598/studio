/**
 * auth-trust.test.ts —— 触发面 partner 档接入 PORT-TRUST 凭据目录（studio-dev-544 差距项 #18）
 *
 * 依据：docs/v2/14 §四（凭证三档；伙伴档＝凭据目录条目：随机 credential ID＋scope＋TTL＋
 *   吊销）、docs/v2/15 §4.1/4.3（五型/吊销）、§七 SEC-ROOT-01（root 不进接口面）、
 *   docs/17-§2/§6（七相位/收割四要件之外的前腿，不新增相位）。
 *
 * 断言口径（放行路径必须不存在）：
 *   1. 未注入凭据目录 → 仍 401 `partner-credential-unwired`（旧口径不漂移）；
 *   2. 注入目录 → 未知/过期/已撤/用途越界/scope 不符一律 401/403，**不回落匿名**；
 *   3. 合法条目 → `ok:true` 且 tier=partner、caller=目录持有者、类别=scoped；root 仍 403。
 */
import { describe, expect, it } from 'vitest'
import { buildApiIntakeAuth } from '../../../src/assembly/api/auth.ts'
import { createSecretTrust, type SecretDeclaration } from '@studio-next/gateway'
import type { ApiIntakeAuthResult } from '@studio-next/api'

const NOW = Date.parse('2026-06-01T00:00:00Z')
const WINDOW = { from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z' }
const COMPANY = { companyId: 'studio-dev', slug: 'studio-dev' }

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

function partner(over: Partial<SecretDeclaration> = {}): SecretDeclaration {
  return {
    secretId: 'SEC-EXT-PARTNER',
    secretType: 'platform_credential',
    credentialClass: 'scoped',
    logicalReference: 'partner-a@company',
    boundGrant: { recordId: 'grant-scoped-1', refVersion: '1.0.0' },
    parentCredentialRef: 'SEC-GW-ROOT',
    allowedUses: ['trigger-intake', 'outbound-redaction'],
    validWindow: WINDOW,
    exposureScope: 'deployment:studio-dev',
    valueProvider: { type: 'env-ref', name: 'STUDIO_PARTNER_A_TOKEN' },
    holder: { callerId: 'PARTNER-1', kind: 'program', programRef: 'partner-a' },
    ...over,
  }
}

function makeAuth(over: { declarations?: readonly SecretDeclaration[]; company?: boolean; clock?: () => number; intakeSecretType?: 'platform_credential' | 'external_outbound' } = {}): ReturnType<typeof buildApiIntakeAuth> {
  let now = NOW
  const trust = createSecretTrust({ declarations: over.declarations ?? [ROOT, partner()], clock: over.clock ?? (() => now) })
  return buildApiIntakeAuth({
    trust,
    ...(over.company === false ? {} : { company: COMPANY }),
    ...(over.intakeSecretType !== undefined ? { intakeSecretType: over.intakeSecretType } : {}),
    log: () => {},
  })
}

function bearer(value: string): Headers {
  return new Headers({ authorization: `Bearer ${value}` })
}

function call(auth: ReturnType<typeof buildApiIntakeAuth>, headers: Headers): ApiIntakeAuthResult {
  const result = auth({ method: 'POST', path: '/v1/requests', headers })
  if (result instanceof Promise) throw new Error('认证器应为同步实现（本测试不驱动 async 面）')
  return result
}

describe('partner 档 = 凭据目录条目（fail-closed）', () => {
  it('未注入凭据目录 → 401 partner-credential-unwired（旧口径不漂移）', () => {
    const auth = buildApiIntakeAuth({ log: () => {} })
    const result = call(auth, bearer('partner-a@company'))
    expect(result).toMatchObject({ ok: false, status: 401, subcause: 'partner-credential-unwired' })
  })

  it('合法目录条目 → ok:true（tier=partner、caller=持有者、credentialClass=scoped）', () => {
    const result = call(makeAuth(), bearer('partner-a@company'))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.auth).toEqual({ tier: 'partner', credentialRef: 'partner-a@company' })
      expect(result.caller).toEqual({ callerId: 'PARTNER-1', kind: 'program', programRef: 'partner-a' })
      expect(result.credentialClass).toBe('scoped')
    }
  })

  it('未知凭据引用 → 401 trust-source-unknown（缺证即拒，不回落匿名）', () => {
    const result = call(makeAuth(), bearer('unknown@company'))
    expect(result).toMatchObject({ ok: false, status: 401, subcause: 'trust-source-unknown' })
  })

  it('用途越界（allowedUses 外）→ 403 trust-use-not-allowed', () => {
    const auth = makeAuth({ declarations: [ROOT, partner({ allowedUses: ['outbound-redaction'] })] })
    const result = call(auth, bearer('partner-a@company'))
    expect(result).toMatchObject({ ok: false, status: 403, subcause: 'trust-use-not-allowed' })
  })

  it('已撤条目 → 403 trust-source-revoked', () => {
    const trust = createSecretTrust({ declarations: [ROOT, partner()], clock: () => NOW })
    const revoked = trust.revokeWithProof(
      { credentialId: 'partner-a@company', credentialClass: 'scoped', scope: ['trigger-intake'], ttl: { seconds: 60 } },
      {
        recordId: 'rev-1',
        injectionStopped: true,
        fenceRejectionRecorded: true,
        evidenceRefs: ['ev-1', 'ev-2', 'ev-3'],
        noDescendantConfirmation: { probeMethod: 'descendant-scan', lastProbedAt: '2026-06-01T00:00:00Z' },
      },
      {
        company: COMPANY,
        caller: { callerId: 'PRIME-0', kind: 'employment', personId: 'PRIME-0' },
        authority: [{ recordId: 'grant-root-1', version: { recordId: 'grant-root-1', version: 1 }, grantClass: 'root_delegation' }],
        signature: { actorKind: 'person', actorRef: 'PRIME-0' },
      },
    )
    expect(revoked.kind).toBe('ok')
    const result = call(buildApiIntakeAuth({ trust, company: COMPANY, log: () => {} }), bearer('partner-a@company'))
    expect(result).toMatchObject({ ok: false, status: 403, subcause: 'trust-source-revoked' })
  })

  it('过期条目 → 403 trust-source-expired（注入时钟越过有效期）', () => {
    let now = NOW
    const trust = createSecretTrust({ declarations: [ROOT, partner()], clock: () => now })
    now = Date.parse('2027-02-01T00:00:00Z')
    const result = call(buildApiIntakeAuth({ trust, company: COMPANY, log: () => {} }), bearer('partner-a@company'))
    expect(result).toMatchObject({ ok: false, status: 403, subcause: 'trust-source-expired' })
  })

  it('目录已注入但公司维缺失 → 401 partner-credential-context-missing（不猜公司）', () => {
    const result = call(makeAuth({ company: false }), bearer('partner-a@company'))
    expect(result).toMatchObject({ ok: false, status: 401, subcause: 'partner-credential-context-missing' })
  })

  it('SEC-T5 出站伙伴凭据：显式 intakeSecretType=external_outbound → ok（类型显式，不猜）', () => {
    const result = call(
      makeAuth({ declarations: [ROOT, partner({ secretType: 'external_outbound' })], intakeSecretType: 'external_outbound' }),
      bearer('partner-a@company'),
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.credentialClass).toBe('scoped')
  })

  it('缺省 intakeSecretType 与条目类型不符 → 401 trust-source-kind-mismatch（不猜类型放行）', () => {
    const result = call(makeAuth({ declarations: [ROOT, partner({ secretType: 'external_outbound' })] }), bearer('partner-a@company'))
    expect(result).toMatchObject({ ok: false, status: 401, subcause: 'trust-source-kind-mismatch' })
  })

  it('root 档仍 403 root-credential-forbidden（SEC-ROOT-01 不因目录接线放宽）', () => {
    expect(call(makeAuth(), new Headers({ authorization: 'Root operating-key' }))).toMatchObject({
      ok: false,
      status: 403,
      subcause: 'root-credential-forbidden',
    })
    expect(
      call(makeAuth(), new Headers({ 'x-studio-credential-class': 'root', authorization: 'Bearer partner-a@company' })),
    ).toMatchObject({ ok: false, status: 403, subcause: 'root-credential-forbidden' })
  })
})
