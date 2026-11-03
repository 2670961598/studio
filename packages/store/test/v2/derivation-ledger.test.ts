/**
 * derivation-ledger.test —— store v17 派生树登记账本（GAP-V2-04 S6）
 *
 * 依据：docs/v2/07 §四「派生即登记」；docs/v2/16 §三 store 行（append-only 机制）；
 *   docs/17-§2／§6（登记是撤回回执的后代清单来源）；202-P4 写者租约（跨进程互斥不新增锁）。
 *
 * 断言面：①登记/catalog/撤回三面追加与读回；②同 id 同内容幂等、异内容拒；
 *   ③append-only 触发器拒 UPDATE/DELETE；④重开库重建；⑤writer lease 双开拒。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openLedger } from '../../src/ledger.ts'
import { openLedgerWriter } from '../../src/writer-lease.ts'
import { createDerivationLedger, type DerivationRevocationRow } from '../../src/derivation/derivation-ledger.ts'

const dirs: string[] = []
function dbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sn562-derivation-'))
  dirs.push(dir)
  return join(dir, 'ledger.sqlite')
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const REG = {
  derivationId: 'T-1:att1:dsh',
  ticket: 'T-1',
  executor: 'dsh',
  backend: 'external-cli',
  capabilitySubset: 'executor:dsh@1.4.3',
  credentials: [],
  derivedAt: '2026-06-01T00:00:00Z',
  registeredAt: 1_700_000_000_000,
} as const

const DRAFT = {
  secretId: 'SEC-GR-SCOPE',
  secretType: 'platform_credential',
  credentialClass: 'scoped',
  logicalReference: 'scope@grant',
  boundGrant: { recordId: 'g-scope', refVersion: '1.0.0' },
  permittedOperations: ['platform.comment'],
  validWindow: { from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z' },
  exposureScope: 'ticket:T-1',
  valueProvider: { type: 'env-ref', name: 'SEC_GR_SCOPE_REF' },
} as const

describe('派生账本：append-only 三面', () => {
  it('登记/catalog/撤回追加后读回；同 id 同内容幂等、异内容拒', () => {
    const ledger = openLedger(dbPath())
    const face = createDerivationLedger(ledger.db)

    expect(face.appendRegistration(REG)).toEqual({ id: REG.derivationId, appended: true })
    expect(face.appendRegistration(REG)).toEqual({ id: REG.derivationId, appended: false })
    expect(face.listRegistrations()).toHaveLength(1)
    expect(() => face.appendRegistration({ ...REG, capabilitySubset: 'preset:other' })).toThrow(/id-conflict|append-only/)

    expect(face.appendCatalog({ secretId: DRAFT.secretId, draft: DRAFT, registeredAt: 1 }).appended).toBe(true)
    expect(face.appendCatalog({ secretId: DRAFT.secretId, draft: DRAFT, registeredAt: 1 }).appended).toBe(false)
    expect(face.listCatalog()[0]?.secretId).toBe(DRAFT.secretId)

    const rows: DerivationRevocationRow[] = [
      { scope: 'credential', targetId: 'SEC-GR-SCOPE', recordId: 'EVD-1', evidenceRef: 'ev-1', revokedAt: 2 },
      { scope: 'derivation', targetId: REG.derivationId, recordId: 'EVD-1', evidenceRef: 'ev-2', revokedAt: 2 },
    ]
    expect(face.appendRevocations(rows)).toBe(2)
    expect(face.appendRevocations(rows)).toBe(0)
    expect(face.revokedCredentialIds()).toEqual(['SEC-GR-SCOPE'])
    expect(face.revokedDerivationIds()).toEqual([REG.derivationId])
    ledger.close()
  })

  it('UPDATE/DELETE 被触发器拒绝（append-only 机制保证）', () => {
    const ledger = openLedger(dbPath())
    const face = createDerivationLedger(ledger.db)
    face.appendRegistration(REG)
    expect(() => ledger.db.prepare("UPDATE derivation_registry SET executor = 'claude'").run()).toThrow(/append-only/)
    expect(() => ledger.db.prepare('DELETE FROM derivation_registry').run()).toThrow(/append-only/)
    expect(face.listRegistrations()[0]?.executor).toBe('dsh')
    ledger.close()
  })

  it('重开库重建：登记/目录/撤回行原样读回', () => {
    const path = dbPath()
    const first = openLedger(path)
    const face = createDerivationLedger(first.db)
    face.appendRegistration(REG)
    face.appendCatalog({ secretId: DRAFT.secretId, draft: DRAFT, registeredAt: 1 })
    face.appendRevocations([
      { scope: 'credential', targetId: DRAFT.secretId, recordId: 'EVD-1', evidenceRef: 'ev-1', revokedAt: 2 },
      { scope: 'derivation', targetId: REG.derivationId, recordId: 'EVD-1', evidenceRef: 'ev-2', revokedAt: 2 },
    ])
    first.close()

    const second = openLedger(path)
    const rebuilt = createDerivationLedger(second.db)
    expect(rebuilt.listRegistrations().map((row) => row.derivationId)).toEqual([REG.derivationId])
    expect(rebuilt.listCatalog().map((row) => row.secretId)).toEqual([DRAFT.secretId])
    expect(rebuilt.revokedCredentialIds()).toEqual([DRAFT.secretId])
    expect(rebuilt.revokedDerivationIds()).toEqual([REG.derivationId])
    second.close()
  })

  it('跨进程互斥沿用 writer lease：同库第二写者 STALL/writer-lease-held', () => {
    const path = dbPath()
    const first = openLedgerWriter(path, 'test:first')
    try {
      expect(() => openLedgerWriter(path, 'test:second')).toThrow(/writer-lease-held/)
    } finally {
      first.close()
    }
  })
})
