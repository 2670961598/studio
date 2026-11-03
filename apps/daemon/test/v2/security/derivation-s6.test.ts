/**
 * derivation-s6.test —— 撤回后代凭据 S6 收尾（GAP-V2-04）定向红→绿
 *
 * 依据（实现单引用设计文档章节号——AGENTS §五.1）：
 *   - docs/v2/07 §四「派生即登记」与撤回四判据；
 *   - docs/v2/14 §1.2 PORT-AUTH.withdraw；docs/v2/15 §六 SEC-REV-01/02；
 *   - docs/v2/11 §2.2 REC-AUTH-03、§六 REC-EVD-RVK；docs/17-§2／§6；
 *   - 任务书 §4②：真实撤回动作（经 PORT-AUTH withdraw → gateway.revoke）→ 派生凭据失效 →
 *     三面复验（目录供给／派生树／派发闸），并验证 REC 行与重启重建。
 *
 * 纪律：只调生产函数（createPersistentDerivation / createWithdrawalFace / createAuthorityGate /
 *   resolveWorkerDispatchSeatbelt / createHistFace），不用 mock 替身代证。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CallContext } from '@studio-next/contract'
import type { GrantLink } from '@studio-next/core'
import { createHistFace, openLedger, type Ledger } from '@studio-next/store'
import { createPersistentDerivation } from '../../../src/engine/derivation/persistent-gateway.ts'
import { wireDerivation } from '../../../src/assembly/serve/derivation.ts'
import {
  createWithdrawalFace,
  parseControlWithdraw,
  type DaemonWithdrawRequest,
} from '../../../src/engine/derivation/withdrawal.ts'
import { createAuthorityGate } from '../../../src/engine/tools/authority-gate.ts'
import { resolveWorkerDispatchSeatbelt } from '../../../src/engine/work/dispatch-seatbelt.ts'

const NOW = Date.parse('2026-06-01T00:00:00Z')
const DERIVED_AT = '2026-06-01T00:00:00Z'
const LAST_PROBED = '2026-06-01T00:00:00Z'
const WINDOW = { from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z' }
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempLedgerPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sn562-s6-'))
  dirs.push(dir)
  return join(dir, 'ledger.sqlite')
}

const ROOT_CREDENTIAL = {
  secretId: 'SEC-GR-ROOT',
  secretType: 'signing_root_control',
  credentialClass: 'root',
  logicalReference: 'cred-root@grant',
  boundGrant: { recordId: 'g-root', refVersion: '1.0.0' },
  permittedOperations: ['gateway-sign'],
  validWindow: WINDOW,
  exposureScope: 'position:prime',
  valueProvider: { type: 'broker-ref', secretId: 'SEC-GR-ROOT', profile: 'root-broker' },
} as const

const SCOPE_CREDENTIAL = {
  secretId: 'SEC-GR-SCOPE',
  secretType: 'platform_credential',
  credentialClass: 'scoped',
  logicalReference: 'scope@grant',
  boundGrant: { recordId: 'g-scope', refVersion: '1.0.0' },
  parentCredentialRef: 'SEC-GR-ROOT',
  permittedOperations: ['platform.comment'],
  validWindow: WINDOW,
  exposureScope: 'ticket:T-1',
  valueProvider: { type: 'env-ref', name: 'SEC_GR_SCOPE_REF' },
} as const

const CHILD_CREDENTIAL = {
  secretId: 'SEC-GR-SCOPE-CHILD',
  secretType: 'per_task_shortlived',
  credentialClass: 'scoped',
  logicalReference: 'scope-child@grant',
  boundGrant: { recordId: 'g-scope-child', refVersion: '1.0.0' },
  parentCredentialRef: 'SEC-GR-SCOPE',
  permittedOperations: ['platform.heartbeat'],
  validWindow: WINDOW,
  exposureScope: 'ticket:T-1',
  valueProvider: { type: 'local-mint', ticketId: 'T-1' },
} as const

const ROOT_GRANT: GrantLink = {
  grantId: 'g-root',
  grantClass: 'root_delegation',
  grantor: 'external-boss',
  grantorKind: 'external_boss',
  grantee: 'internal-boss',
  purpose: 'company.operations',
  scope: ['platform.comment'],
  conditions: [],
  term: { fromMs: 0 },
  delegable: true,
  proof: { proofMode: 'ritual_and_key', keyFingerprint: 'sha256:abcd' },
}

const SCOPE_GRANT: GrantLink = {
  grantId: 'g-scope',
  grantClass: 'delegation',
  grantor: 'internal-boss',
  grantorKind: 'internal_position',
  grantee: 'dept-head',
  parentGrantId: 'g-root',
  purpose: 'company.operations',
  scope: ['platform.comment'],
  conditions: [],
  term: { fromMs: 0 },
  delegable: false,
}

const CTX: CallContext = {
  company: { companyId: 'CO', slug: 'co' },
  caller: { callerId: 'position:prime', kind: 'position', positionRef: 'position:prime' },
  authority: [],
  signature: { actorKind: 'person', actorRef: 'eng-5' },
}

const APPROVED = { approvedBy: 'position:prime', reason: '按单派发批准的子集继承' }

function seed(): {
  path: string
  ledger: Ledger
  authority: ReturnType<typeof createAuthorityGate>
  persistent: ReturnType<typeof createPersistentDerivation>
  withdrawal: ReturnType<typeof createWithdrawalFace>
  hist: ReturnType<typeof createHistFace>
  evidence: Array<{ evidenceId: string; action: string }>
} {
  const path = tempLedgerPath()
  const ledger = openLedger(path)
  const evidence: Array<{ evidenceId: string; action: string }> = []
  const authority = createAuthorityGate({
    grants: () => [ROOT_GRANT, SCOPE_GRANT],
    now: () => NOW,
    record: (item) => evidence.push({ evidenceId: item.evidenceId, action: item.action }),
  })
  const persistent = createPersistentDerivation({ ledger, clock: () => NOW })
  for (const draft of [ROOT_CREDENTIAL, SCOPE_CREDENTIAL, CHILD_CREDENTIAL]) {
    const registered = persistent.registerCredential(draft)
    if (registered.kind !== 'ok') throw new Error(`凭据登记失败：${registered.error.subcause}`)
  }
  const parent = persistent.register({
    derivationId: 'T-1:att1:dsh',
    ticket: 'T-1',
    executor: 'dsh',
    executorName: 'dsh',
    backend: 'external-cli',
    capabilitySubset: 'executor:dsh@1.4.3',
    credentials: [{ secretId: 'SEC-GR-SCOPE', credentialClass: 'scoped', logicalReference: 'scope@grant' }],
    inheritance: APPROVED,
    derivedAt: DERIVED_AT,
  })
  if (parent.kind !== 'ok') throw new Error(`派生登记失败：${parent.error.subcause}`)
  const child = persistent.register({
    derivationId: 'T-1:att1:dsh:child',
    parentDerivationId: 'T-1:att1:dsh',
    ticket: 'T-1',
    executor: 'dsh-child',
    backend: 'external-cli',
    capabilitySubset: 'preset:child',
    credentials: [],
    derivedAt: DERIVED_AT,
  })
  if (child.kind !== 'ok') throw new Error(`子派生登记失败：${child.error.subcause}`)
  const hist = createHistFace(ledger.db)
  const withdrawal = createWithdrawalFace({
    authority,
    gateway: persistent.gateway,
    catalog: persistent.gateway.catalog,
    revoke: persistent.revoke,
    hist,
    clock: () => NOW,
    company: 'CO',
    writtenBy: 'daemon:test',
  })
  return { path, ledger, authority, persistent, withdrawal, hist, evidence }
}

function request(overrides: Partial<DaemonWithdrawRequest> = {}): DaemonWithdrawRequest {
  return {
    grant: { recordId: 'g-scope', version: { recordId: 'g-scope', version: 1 }, grantClass: 'delegation' },
    reason: 'active_withdrawal',
    closure: { descendants: [], noDescendantsConfirmed: true },
    deactivationEvidence: [
      { kind: 'revocation_receipt', evidenceRef: 'ev-revoke' },
      { kind: 'injection_stop_confirm', evidenceRef: 'ev-stop' },
      { kind: 'fence_rejection_record', evidenceRef: 'ev-fence' },
    ],
    probeMethod: '目录父链＋派生树闭包枚举',
    lastProbedAt: LAST_PROBED,
    inFlightInventory: ['work:T-1:att1'],
    residualSideEffects: ['观察窗口：迟到写入按 REC-OBS-03'],
    ...overrides,
  }
}

describe('S6 真实撤回触发源：PORT-AUTH.withdraw → gateway.revoke → 三面复验', () => {
  it('撤回前可用、撤回后目录/派生树/派发闸三面全失效，并落 REC-AUTH-03＋REC-EVD-RVK', () => {
    const { ledger, persistent, withdrawal, hist, evidence } = seed()
    const guard = persistent.gateway.revocationPort()

    // —— 撤回前：三面均可用 ——
    expect(persistent.gateway.catalog.supply('SEC-GR-SCOPE', { seconds: 60 }).kind).toBe('ok')
    expect(guard.isRevoked('T-1', 'dsh')).toBe(false)
    expect(() =>
      resolveWorkerDispatchSeatbelt({ ticket: 'T-1', executor: 'dsh', workspace: process.cwd(), derivationGuard: guard }),
    ).not.toThrow()

    // —— 真实撤回动作：PORT-AUTH.withdraw（#528 完整性判定）→ gateway.revoke（派生树传播） ——
    const result = withdrawal.withdraw(request(), CTX)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error(JSON.stringify(result.error))
    expect(result.value.gatewayEnforced).toBe(true)
    expect(result.value.recordId).toMatch(/^EVD-RVK-AUTH-/)
    expect(evidence.some((item) => item.action === 'withdraw')).toBe(true)

    // —— 三面复验①：目录面供给路径不存在（NEG-SEC-08） ——
    const supply = persistent.gateway.catalog.supply('SEC-GR-SCOPE', { seconds: 60 })
    expect(supply.kind).toBe('err')
    if (supply.kind === 'err') expect(supply.error.subcause).toBe('catalog-revoked')
    const childSupply = persistent.gateway.catalog.supply('SEC-GR-SCOPE-CHILD', { seconds: 60 })
    expect(childSupply.kind).toBe('err')
    if (childSupply.kind === 'err') expect(childSupply.error.subcause).toBe('catalog-revoked')

    // —— 三面复验②：派生树面后代闭包 revoked ——
    expect(guard.isRevoked('T-1', 'dsh')).toBe(true)
    expect(guard.isRevoked('T-1', 'dsh-child')).toBe(true)
    expect(persistent.gateway.dispatchState('T-1', 'dsh')).toBe('revoked')
    expect(persistent.gateway.dispatchState('T-1', 'dsh-child')).toBe('revoked')

    // —— 三面复验③：派发面同 ticket/executor 被 dispatch/derivation-revoked 拒 ——
    let refusal: { subcause?: string } | undefined
    try {
      resolveWorkerDispatchSeatbelt({ ticket: 'T-1', executor: 'dsh', workspace: process.cwd(), derivationGuard: guard })
    } catch (error) {
      refusal = error as { subcause?: string }
    }
    expect(refusal?.subcause).toBe('dispatch/derivation-revoked')

    // —— REC 写面：REC-AUTH-03 与 REC-EVD-RVK 各一行，后代清单闭合 ——
    const authRows = hist.query({ company: 'CO', type: 'REC-AUTH-03' })
    const evdRows = hist.query({ company: 'CO', type: 'REC-EVD-RVK' })
    expect(authRows).toHaveLength(1)
    expect(evdRows).toHaveLength(1)
    const authPayload = authRows[0]?.payload as {
      descendants: Array<{ identity_ref: string; credential: { logical_reference: string } }>
      credential_actions: string[]
      withdrawn_grant_class: string
    }
    expect(authPayload.descendants.map((item) => item.identity_ref).sort()).toEqual([
      'SEC-GR-SCOPE-CHILD',
      'T-1:att1:dsh',
      'T-1:att1:dsh:child',
    ])
    expect(authPayload.descendants.some((item) => item.credential.logical_reference === 'scope@grant')).toBe(true)
    expect(authPayload.credential_actions).toContain('revoked:SEC-GR-SCOPE')
    expect(authPayload.credential_actions).toContain('revoked:SEC-GR-SCOPE-CHILD')
    expect(authPayload.withdrawn_grant_class).toBe('delegation')
    const evdPayload = evdRows[0]?.payload as { descendants_inventory: unknown[]; subject: { refId: string } }
    expect(evdPayload.descendants_inventory).toHaveLength(3)
    expect(evdPayload.subject.refId).toBe('g-scope')

    ledger.close()
  })

  it('重启重建：目录吊销＋派生闭包撤回原样恢复（不新增事实源）', () => {
    const first = seed()
    expect(first.withdrawal.withdraw(request(), CTX).kind).toBe('ok')
    expect(first.persistent.rebuild.revokedDerivations).toBe(0)
    first.ledger.close()

    const reopened = openLedger(first.path)
    const rebuilt = createPersistentDerivation({ ledger: reopened, clock: () => NOW })
    expect(rebuilt.rebuild).toEqual({
      catalogEntries: 3,
      registeredDerivations: 2,
      revokedCredentials: 2,
      revokedDerivations: 2,
    })
    expect(rebuilt.gateway.revocationPort().isRevoked('T-1', 'dsh')).toBe(true)
    expect(rebuilt.gateway.revocationPort().isRevoked('T-1', 'dsh-child')).toBe(true)
    expect(rebuilt.gateway.catalog.supply('SEC-GR-SCOPE', { seconds: 60 }).kind).toBe('err')
    expect(createHistFace(reopened.db).query({ company: 'CO', type: 'REC-AUTH-03' })).toHaveLength(1)
    reopened.close()
  })
})

describe('S6 撤回 fail-closed：缺证据/未映射/控制面代签均不记完成', () => {
  it('停用证据缺停止注入/围栏记录 → 拒且零状态变更', () => {
    const { ledger, persistent, withdrawal } = seed()
    const guard = persistent.gateway.revocationPort()
    const result = withdrawal.withdraw(
      request({ deactivationEvidence: [{ kind: 'revocation_receipt', evidenceRef: 'ev-revoke' }] as unknown as DaemonWithdrawRequest['deactivationEvidence'] }),
      CTX,
    )
    expect(result.kind).toBe('err')
    if (result.kind === 'err') expect(result.error.subcause).toBe('auth/withdraw-evidence-incomplete')
    expect(guard.isRevoked('T-1', 'dsh')).toBe(false)
    expect(persistent.gateway.catalog.supply('SEC-GR-SCOPE', { seconds: 60 }).kind).toBe('ok')
    ledger.close()
  })

  it('撤回原因不在 ENU 值集 → auth/reason-invalid（先判后写，零状态变更）', () => {
    const { ledger, persistent, withdrawal } = seed()
    const result = withdrawal.withdraw(request({ reason: 'made-up' as unknown as DaemonWithdrawRequest['reason'] }), CTX)
    expect(result.kind).toBe('err')
    if (result.kind === 'err') expect(result.error.subcause).toBe('auth/reason-invalid')
    expect(persistent.gateway.revocationPort().isRevoked('T-1', 'dsh')).toBe(false)
    ledger.close()
  })

  it('授予未映射到目录凭据 → auth/credential-unmapped（不以「父已撤」冒充）', () => {
    const { ledger, withdrawal } = seed()
    const result = withdrawal.withdraw(
      request({
        grant: { recordId: 'g-unmapped', version: { recordId: 'g-unmapped', version: 1 }, grantClass: 'delegation' },
      }),
      CTX,
    )
    expect(result.kind).toBe('err')
    if (result.kind === 'err') expect(result.error.subcause).toBe('auth/credential-unmapped')
    ledger.close()
  })

  it('控制面 ctl- 入口：否决框架/系统代签；严格参数拒未知键', () => {
    const { ledger, withdrawal } = seed()
    const denied = withdrawal.controlWithdraw({ ...request(), decidedBy: 'daemon' }, CTX)
    expect(denied.kind).toBe('err')
    if (denied.kind === 'err') expect(denied.error.subcause).toBe('auth/control-decider-forbidden')
    const parsed = parseControlWithdraw({ ...request(), decidedBy: 'position:prime', extra: 1 })
    expect(parsed.kind).toBe('err')
    if (parsed.kind === 'err') expect(parsed.error.subcause).toBe('auth/control-args-invalid')
    const ok = parseControlWithdraw({ ...request(), decidedBy: 'position:prime' })
    expect(ok.kind).toBe('ok')
    ledger.close()
  })
})

describe('S6 生产组合根装配：wireDerivation（runtime.ts 默认调用面，非测试态分支）', () => {
  it('装配即注入 revocationPort/registry；一次控制面撤回事件后目录/派生树/派发 0 号闸三面失效', () => {
    const path = tempLedgerPath()
    const ledger = openLedger(path)
    const logs: string[] = []
    try {
      const face = wireDerivation({
        ledger,
        clock: () => NOW,
        company: 'CO',
        log: (line) => logs.push(line),
        grants: () => [ROOT_GRANT, SCOPE_GRANT],
      })
      // 生产装配日志锚（部署窗口取证同形）
      expect(logs.some((line) => line.includes('[serve] 派生树面已接'))).toBe(true)

      for (const draft of [ROOT_CREDENTIAL, SCOPE_CREDENTIAL, CHILD_CREDENTIAL]) {
        expect(face.persistent.registerCredential(draft).kind).toBe('ok')
      }
      // L1 登记口：与 engine dispatch 前调用的是同一个结构端口（独立 attempt 证明口可用）
      const registered = face.registry.register({
        derivationId: 'T-2:att1:dsh',
        ticket: 'T-2',
        executor: 'dsh',
        backend: 'external-cli',
        capabilitySubset: 'executor:dsh@1.4.3',
        derivedAt: DERIVED_AT,
      })
      expect(registered.kind).toBe('ok')
      // T-1 派生树：父持目录凭据（scoped），子为父的后代——撤回传播的分母
      const parent = face.persistent.register({
        derivationId: 'T-1:att1:dsh',
        ticket: 'T-1',
        executor: 'dsh',
        executorName: 'dsh',
        backend: 'external-cli',
        capabilitySubset: 'executor:dsh@1.4.3',
        credentials: [{ secretId: 'SEC-GR-SCOPE', credentialClass: 'scoped', logicalReference: 'scope@grant' }],
        inheritance: APPROVED,
        derivedAt: DERIVED_AT,
      })
      expect(parent.kind).toBe('ok')
      const child = face.persistent.register({
        derivationId: 'T-1:att1:dsh:child',
        parentDerivationId: 'T-1:att1:dsh',
        ticket: 'T-1',
        executor: 'dsh-child',
        backend: 'external-cli',
        capabilitySubset: 'preset:child',
        credentials: [],
        derivedAt: DERIVED_AT,
      })
      expect(child.kind).toBe('ok')

      // 撤回前：目录供给可用、派生闸放行
      expect(face.persistent.gateway.catalog.supply('SEC-GR-SCOPE', { seconds: 60 }).kind).toBe('ok')
      expect(face.guard.isRevoked('T-1', 'dsh')).toBe(false)
      expect(() =>
        resolveWorkerDispatchSeatbelt({ ticket: 'T-1', executor: 'dsh', workspace: process.cwd(), derivationGuard: face.guard }),
      ).not.toThrow()

      // 真实撤回事件：走生产 PORT-AUTH.withdraw 入口（控制面 ctl- 与 PORT-AUTH 同一核心）
      const result = face.withdrawal.controlWithdraw({ ...request(), decidedBy: 'position:prime' }, CTX)
      expect(result.kind).toBe('ok')
      expect(result.kind === 'ok' && result.value.gatewayEnforced).toBe(true)

      // L1 目录面：供给路径不存在
      expect(face.persistent.gateway.catalog.supply('SEC-GR-SCOPE', { seconds: 60 }).kind).toBe('err')
      // L2 派生树：父＋子闭包均撤回
      expect(face.guard.isRevoked('T-1', 'dsh')).toBe(true)
      expect(face.guard.isRevoked('T-1', 'dsh-child')).toBe(true)
      // L3 派发面：engine.ts 的 0 号闸同函数同实例，具名拒绝
      let refusal: { subcause?: string } | undefined
      try {
        resolveWorkerDispatchSeatbelt({ ticket: 'T-1', executor: 'dsh', workspace: process.cwd(), derivationGuard: face.guard })
      } catch (error) {
        refusal = error as { subcause?: string }
      }
      expect(refusal?.subcause).toBe('dispatch/derivation-revoked')
    } finally {
      ledger.close()
    }
  })
})
