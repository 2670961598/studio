/**
 * derivation-gateway.test.ts —— GAP-V2-04 派生树登记网关＋撤回传播面（NEG-SEC-08/NEG-RUN-05）
 *
 * 依据（实现单引用设计文档章节号——AGENTS §五.1）：
 *   - docs/v2/07 §四 执行体派生树三规则（派生即登记／子执行体不得持 root key／凭据继承默认
 *     不继承）＋撤回四判据（后代清单／逐个停用证据／无后代显式确认／残留观察）。
 *   - docs/v2/15 §六 SEC-REV-01（撤回三件套）／SEC-REV-02（整树撤回网关＝目标；本件为其仓内
 *     登记与传播腿，不宣称进程已停）。
 *   - docs/v2/17 §4.1 NEG-SEC-08（撤回后子体仍持可用凭据＝判负；对账差异非空即判负）／
 *     NEG-RUN-05（无登记选择链直连非主绑定执行器＝拒；GAP-V2-04）。
 *   - docs/v2/11 §2.2 REC-AUTH-03（后代枚举＋逐个停用证据＋无后代显式确认）。
 *
 * 断言纪律：只调用生产函数并断言其具名拒绝结论（`PortResult` 的 subcause）；每条负例都跟
 * 「零状态变更」或正例对照——不以「形状永远红」冒充负例（同 neg/ring.test.ts 口径）。
 */
import { describe, expect, it } from 'vitest'
import type { PortResult } from '@studio-next/contract'
import { createCredentialCatalog, type CatalogEntryDraft } from '../../src/catalog.ts'
import type { RevocationProof } from '../../src/catalog.ts'
import {
  createDerivationGateway,
  type DerivationCredentialRef,
  type DerivationDeactivationEvidence,
  type DerivationGateway,
  type DerivationRecord,
} from '../../src/derivation-gateway.ts'

const NOW = Date.parse('2026-06-01T00:00:00Z')
const DERIVED_AT = '2026-06-01T00:00:00Z'
const WINDOW = { from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z' }

const ROOT_ENTRY: CatalogEntryDraft = {
  secretId: 'SEC-GW-SIGNING',
  secretType: 'signing_root_control',
  credentialClass: 'root',
  logicalReference: 'cred-root@company',
  boundGrant: { recordId: 'grant-root-1', refVersion: '1.0.0' },
  permittedOperations: ['gateway-sign'],
  validWindow: WINDOW,
  exposureScope: 'position:PRIME-0',
  valueProvider: { type: 'broker-ref', secretId: 'SEC-GW-SIGNING', profile: 'root-broker' },
}

const TEAM_ENTRY: CatalogEntryDraft = {
  secretId: 'SEC-MX-TEAM',
  secretType: 'platform_credential',
  credentialClass: 'scoped',
  logicalReference: 'team@matrix',
  boundGrant: { recordId: 'grant-team-1', refVersion: '1.0.0' },
  parentCredentialRef: 'SEC-GW-SIGNING',
  permittedOperations: ['matrix-login'],
  validWindow: WINDOW,
  exposureScope: 'dept:matrix',
  valueProvider: { type: 'env-ref', name: 'SEC_MX_TEAM_REF' },
}

const TASK_ENTRY: CatalogEntryDraft = {
  secretId: 'SEC-MX-TASK',
  secretType: 'per_task_shortlived',
  credentialClass: 'scoped',
  logicalReference: 'task@matrix',
  boundGrant: { recordId: 'grant-task-1', refVersion: '1.0.0' },
  parentCredentialRef: 'SEC-MX-TEAM',
  permittedOperations: ['matrix-read'],
  validWindow: WINDOW,
  exposureScope: 'ticket:T-532',
  valueProvider: { type: 'local-mint', ticketId: 'T-532' },
}

const SUB_ENTRY: CatalogEntryDraft = {
  secretId: 'SEC-MX-SUB',
  secretType: 'per_task_shortlived',
  credentialClass: 'scoped',
  logicalReference: 'subagent@matrix',
  boundGrant: { recordId: 'grant-sub-1', refVersion: '1.0.0' },
  parentCredentialRef: 'SEC-MX-TASK',
  permittedOperations: ['matrix-read'],
  validWindow: WINDOW,
  exposureScope: 'ticket:T-532',
  valueProvider: { type: 'local-mint', ticketId: 'T-532' },
}

const TEAM_CRED: DerivationCredentialRef = { secretId: 'SEC-MX-TEAM', credentialClass: 'scoped', logicalReference: 'team@matrix' }
const TASK_CRED: DerivationCredentialRef = { secretId: 'SEC-MX-TASK', credentialClass: 'scoped', logicalReference: 'task@matrix' }
const SUB_CRED: DerivationCredentialRef = { secretId: 'SEC-MX-SUB', credentialClass: 'scoped', logicalReference: 'subagent@matrix' }

const APPROVED = { approvedBy: 'position:PRIME-0', reason: '按单派发批准的子集继承' }

function record(overrides: Record<string, unknown>): DerivationRecord {
  return {
    derivationId: 'D-PARENT',
    ticket: 'T-532',
    executor: 'dsh',
    backend: 'in-process',
    capabilitySubset: 'preset:worker',
    credentials: [],
    derivedAt: DERIVED_AT,
    ...overrides,
  } as unknown as DerivationRecord
}

function okOf<T>(result: PortResult<T>): T {
  if (result.kind !== 'ok') throw new Error(`期望 ok，实际 ${result.error.category}/${result.error.subcause}：${result.error.detail ?? ''}`)
  return result.value
}

function failureOf(result: PortResult<unknown>): { category: string; subcause: string; detail: string } {
  if (result.kind !== 'err') throw new Error('期望 Err（放行路径必须不存在）')
  return { category: result.error.category, subcause: result.error.subcause, detail: result.error.detail ?? '' }
}

function proof(overrides: Record<string, unknown> = {}): RevocationProof {
  return {
    recordId: 'EVD-RVK-532',
    injectionStopped: true,
    fenceRejectionRecorded: true,
    evidenceRefs: ['ev-stop-injection'],
    descendants: ['SEC-MX-TASK', 'SEC-MX-SUB'],
    ...overrides,
  } as unknown as RevocationProof
}

function evidenceFor(...derivationIds: readonly string[]): readonly DerivationDeactivationEvidence[] {
  return derivationIds.map((derivationId) => ({ derivationId, evidenceRef: `ev-stop-${derivationId}` }))
}

/** 真目录三层凭据＋三层派生（根→子→孙）：root 撤领域只到 TEAM/TASK/SUB 三凭据 */
function seedTree(): DerivationGateway {
  const catalog = createCredentialCatalog({ clock: () => NOW })
  for (const draft of [ROOT_ENTRY, TEAM_ENTRY, TASK_ENTRY, SUB_ENTRY]) {
    const registered = catalog.register(draft)
    if (registered.kind !== 'ok') throw new Error(`目录登记失败：${registered.error.subcause}`)
  }
  const gateway = createDerivationGateway({ catalog })
  okOf(gateway.register(record({ derivationId: 'D-PARENT', executor: 'dsh', executorName: 'dsh-mid', credentials: [TEAM_CRED], inheritance: APPROVED })))
  okOf(gateway.register(record({ derivationId: 'D-CHILD', parentDerivationId: 'D-PARENT', executor: 'claude', credentials: [TASK_CRED], inheritance: APPROVED })))
  okOf(gateway.register(record({ derivationId: 'D-GRAND', parentDerivationId: 'D-CHILD', executor: 'kimi', credentials: [SUB_CRED], inheritance: APPROVED })))
  return gateway
}

// ————————————————————————— 一、派生即登记（v2/07 §四规则 1/3） —————————————————————————

describe('派生即登记：父引用/后端/能力子集/凭据引用/时点', () => {
  it('三层派生登记成功；传递后代按稳定序（不含自身）', () => {
    const gateway = seedTree()
    expect(gateway.records().map((item) => item.derivationId)).toEqual(['D-PARENT', 'D-CHILD', 'D-GRAND'])
    expect(okOf(gateway.enumerateDescendants('D-PARENT'))).toEqual(['D-CHILD', 'D-GRAND'])
    expect(okOf(gateway.enumerateDescendants('D-GRAND'))).toEqual([])
    expect(failureOf(gateway.enumerateDescendants('D-UNKNOWN')).subcause).toBe('derivation/unknown')
  })

  it('重复 id / 父不存在 / 非法后端 / 非法时点 / 空能力子集 = 拒', () => {
    const gateway = seedTree()
    expect(failureOf(gateway.register(record({ derivationId: 'D-PARENT' }))).subcause).toBe('derivation/id-duplicate')
    expect(failureOf(gateway.register(record({ derivationId: 'D-X', parentDerivationId: 'D-NOPE' }))).subcause).toBe('derivation/parent-unknown')
    expect(failureOf(gateway.register(record({ derivationId: 'D-X', backend: 'in-process-x' }))).subcause).toBe('derivation/invalid')
    expect(failureOf(gateway.register(record({ derivationId: 'D-X', derivedAt: '2026-06-01' }))).subcause).toBe('derivation/invalid')
    expect(failureOf(gateway.register(record({ derivationId: 'D-X', capabilitySubset: '' }))).subcause).toBe('derivation/invalid')
    expect(gateway.records()).toHaveLength(3)
  })

  it('子执行体持 root 凭据 = 拒（SEC-ROOT-03）；未登记凭据/目录外凭据 = 拒', () => {
    const gateway = seedTree()
    const rootCred: DerivationCredentialRef = { secretId: 'SEC-GW-SIGNING', credentialClass: 'root', logicalReference: 'cred-root@company' }
    expect(failureOf(gateway.register(record({ derivationId: 'D-X', credentials: [rootCred], inheritance: APPROVED }))).subcause).toBe(
      'derivation/root-credential-forbidden',
    )
    const missing: DerivationCredentialRef = { secretId: 'SEC-MX-NOPE', credentialClass: 'scoped', logicalReference: 'nope@matrix' }
    expect(failureOf(gateway.register(record({ derivationId: 'D-X', credentials: [missing], inheritance: APPROVED }))).subcause).toBe(
      'derivation/credential-unregistered',
    )
    // 父闭包＝{TASK}；TEAM 是父的祖先不是父闭包成员，也不在父持有集合内 → 授权不放大
    expect(
      failureOf(gateway.register(record({ derivationId: 'D-X', parentDerivationId: 'D-GRAND', credentials: [TEAM_CRED], inheritance: APPROVED }))).subcause,
    ).toBe('derivation/credential-outside-tree')
    expect(gateway.records()).toHaveLength(3)
  })

  it('凭据继承缺省「无」：有凭据无批准 = 拒；无凭据不需要批准', () => {
    const gateway = seedTree()
    expect(failureOf(gateway.register(record({ derivationId: 'D-X', credentials: [TEAM_CRED] }))).subcause).toBe(
      'derivation/inheritance-unapproved',
    )
    expect(okOf(gateway.register(record({ derivationId: 'D-X', credentials: [] }))).derivationId).toBe('D-X')
  })
})

// ————————————————————————— 二、撤回传播（NEG-SEC-08 前腿） —————————————————————————

describe('撤回父凭据：后代凭据/派生树同步失效（fail-closed）', () => {
  it('后代枚举缺项 ⇒ catalog-descendants-incomplete，零状态变更（派生仍 active、凭据仍可供给）', () => {
    const gateway = seedTree()
    const result = gateway.revoke('SEC-MX-TEAM', proof({ descendants: ['SEC-MX-TASK'] }), evidenceFor('D-PARENT', 'D-CHILD', 'D-GRAND'))
    expect(failureOf(result).subcause).toBe('catalog-descendants-incomplete')
    expect(failureOf(result).detail).toContain('SEC-MX-SUB')
    expect(gateway.dispatchState('T-532', 'kimi')).toBe('active')
    expect(okOf(gateway.catalog.supply('SEC-MX-TASK', { seconds: 60 })).credential.credentialId).toBe('task@matrix')
  })

  it('后代枚举含目录外引用 ⇒ catalog-descendants-unknown（不猜归属）', () => {
    const gateway = seedTree()
    const result = gateway.revoke('SEC-MX-TEAM', proof({ descendants: ['SEC-MX-TASK', 'SEC-MX-SUB', 'SEC-XX-OTHER'] }), evidenceFor('D-PARENT', 'D-CHILD', 'D-GRAND'))
    expect(failureOf(result).subcause).toBe('catalog-descendants-unknown')
  })

  it('逐后代停用证据缺一条 ⇒ derivation/deactivation-evidence-missing（不得一条覆盖全树）', () => {
    const gateway = seedTree()
    const result = gateway.revoke('SEC-MX-TEAM', proof(), evidenceFor('D-PARENT'))
    expect(failureOf(result).subcause).toBe('derivation/deactivation-evidence-missing')
    expect(failureOf(result).detail).toContain('D-CHILD')
    expect(failureOf(result).detail).toContain('D-GRAND')
    expect(gateway.dispatchState('T-532', 'dsh-mid')).toBe('active')
  })

  it('停用证据指向撤回面外派生/重复证据 ⇒ 拒（零状态变更）', () => {
    const gateway = seedTree()
    expect(failureOf(gateway.revoke('SEC-MX-TEAM', proof(), evidenceFor('D-PARENT', 'D-CHILD', 'D-GRAND', 'D-NOPE'))).subcause).toBe(
      'derivation/evidence-unknown',
    )
    expect(
      failureOf(
        gateway.revoke('SEC-MX-TEAM', proof(), [
          ...evidenceFor('D-PARENT', 'D-CHILD', 'D-GRAND'),
          { derivationId: 'D-PARENT', evidenceRef: 'ev-second' },
        ]),
      ).subcause,
    ).toBe('derivation/evidence-duplicate')
    expect(gateway.catalog.rows().every((row) => row.revocation_state === 'active')).toBe(true)
  })

  it('无后代且无显式确认方法 ⇒ catalog-no-descendant-confirmation；带确认＝放行', () => {
    const catalog = createCredentialCatalog({ clock: () => NOW })
    okOf(catalog.register(ROOT_ENTRY))
    const gateway = createDerivationGateway({ catalog })
    okOf(gateway.register(record({ derivationId: 'D-ONLY', ticket: 'T-ONLY', executor: 'dsh' })))
    expect(failureOf(gateway.revoke('SEC-GW-SIGNING', proof({ descendants: undefined }))).subcause).toBe(
      'catalog-no-descendant-confirmation',
    )
    const receipt = okOf(
      gateway.revoke('SEC-GW-SIGNING', proof({
        descendants: undefined,
        noDescendantConfirmation: { probeMethod: 'descendant-registry-scan', lastProbedAt: '2026-06-01T00:00:00Z' },
      })),
    )
    expect(receipt.revokedCredentials).toEqual(['SEC-GW-SIGNING'])
    expect(receipt.revokedDerivations).toEqual([])
  })

  it('完整撤回：凭据逐项 revoked＋派生树闭包同步失效＋对账 stillUsable=[]＋供给路径不存在', () => {
    const gateway = seedTree()
    const receipt = okOf(gateway.revoke('SEC-MX-TEAM', proof(), evidenceFor('D-PARENT', 'D-CHILD', 'D-GRAND')))
    expect([...receipt.revokedCredentials].sort()).toEqual(['SEC-MX-SUB', 'SEC-MX-TASK', 'SEC-MX-TEAM'])
    expect(receipt.revokedDerivations.map((item) => item.derivationId)).toEqual(['D-PARENT', 'D-CHILD', 'D-GRAND'])
    expect(receipt.deactivationEvidence.map((item) => item.derivationId)).toEqual(['D-PARENT', 'D-CHILD', 'D-GRAND'])
    expect(receipt.reconciliation.stillUsable).toEqual([])
    expect(receipt.catalogReceipt.injectionStopped).toBe(true)
    expect(receipt.catalogReceipt.fenceRejectionRecorded).toBe(true)
    for (const secretId of ['SEC-MX-TEAM', 'SEC-MX-TASK', 'SEC-MX-SUB']) {
      expect(failureOf(gateway.catalog.supply(secretId, { seconds: 60 })).subcause).toBe('catalog-revoked')
    }
    // 派生树整棵失效：同单三层执行体全部 blocked；别单不受影响
    for (const executor of ['dsh', 'dsh-mid', 'claude', 'kimi']) {
      expect(gateway.dispatchState('T-532', executor)).toBe('revoked')
    }
    expect(gateway.dispatchState('T-OTHER', 'claude')).toBe('unregistered')
    const port = gateway.revocationPort()
    expect(port.isRevoked('T-532', 'claude')).toBe(true)
    expect(port.isRevoked('T-OTHER', 'claude')).toBe(false)
    // 幂等：同证明＋同证据再调不改终态
    expect(okOf(gateway.revoke('SEC-MX-TEAM', proof(), evidenceFor('D-PARENT', 'D-CHILD', 'D-GRAND'))).reconciliation.stillUsable).toEqual([])
  })

  it('撤回后不得给已撤派生登记新后代 / 不得给已撤凭据登记新持有者', () => {
    const gateway = seedTree()
    okOf(gateway.revoke('SEC-MX-TEAM', proof(), evidenceFor('D-PARENT', 'D-CHILD', 'D-GRAND')))
    expect(failureOf(gateway.register(record({ derivationId: 'D-NEW', parentDerivationId: 'D-GRAND', executor: 'dsh' }))).subcause).toBe(
      'derivation/parent-revoked',
    )
    expect(
      failureOf(gateway.register(record({ derivationId: 'D-NEW2', credentials: [SUB_CRED], inheritance: APPROVED }))).subcause,
    ).toBe('derivation/credential-revoked')
  })

  it('affectedByCredential：只列撤回面内持有凭据的派生（清单供 REC-AUTH-03 descendants[] 组装）', () => {
    const gateway = seedTree()
    const affected = okOf(gateway.affectedByCredential('SEC-MX-TEAM'))
    expect(affected.map((item) => item.derivation.derivationId)).toEqual(['D-PARENT', 'D-CHILD', 'D-GRAND'])
    expect(affected[0]?.credentials.map((item) => item.secretId)).toEqual(['SEC-MX-TEAM'])
  })
})
