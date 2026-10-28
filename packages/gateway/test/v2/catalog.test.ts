/**
 * catalog.test.ts —— 凭据目录零值/逻辑引用落表/NEG-SEC-08 前腿（plan/05 IMPL-07-12）
 *
 * 依据：v2/15 §4.1（SEC-T1..T5 五型；台账/简报只准出现「类别＋逻辑引用」）、§4.3（吊销三动作
 *   逐项留证）、§4.5（三不入）；v2/11 §2.2 `REC-AUTH-04`（字段面＋root/scoped 类别约束）；
 *   v2/14 §1.7 `PORT-TRUST`（只产逻辑引用/短时句柄无值位/吊销回执）；v2/17 §4.1 `NEG-SEC-08`
 *   （撤回后子体仍持可用凭据＝判负；对账差异非空即判负）；docs/plan/05 IMPL-07-12 验收
 *   「catalog 零值断言（目录不存值）；REC-AUTH-04 逻辑引用落表」。
 *
 * 断言口径（「放行路径必须不存在」）：
 *   1. 零值：任何值形态字段/路径/值形态引用=拒（`catalog-value-rejected`）；目录导出物与
 *      短时句柄里检索不到探针值；`value` 位在 contract 类型上恒 `undefined`（类型级断言）。
 *   2. 落表：登记返回 `REC-AUTH-04` payload 同名行，并逐行过 contract
 *      `CredentialReferencePayloadSchema`（形状唯一源；本套件不改契约）。
 *   3. NEG-SEC-08 前腿：后代枚举缺项=拒（零状态变更）＋撤回后供给路径不存在＋纯对账器能
 *      把「父已撤而子仍 active」判成非空差异（判负输入可判）。
 * 拒绝一律 `PortResult` 的 `Err` 纯码（不抛）；本套件按 `category/subcause` 断言。
 */
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { PortFailure, PortResult, ShortLivedHandle } from '@studio-next/contract'
import {
  createCredentialCatalog,
  reconcileRevocation,
  type CatalogEntryDraft,
  type CatalogEntryView,
  type RevocationProof,
  type RevocationState,
} from '../../src/catalog.ts'
import { CredentialReferencePayloadSchema } from '../../../contract/src/records/auth.ts'

const NOW = Date.parse('2026-06-01T00:00:00Z')
const PROBE = 'probe-bot-password-9f3c1d7a'
const PROBE_ENV = 'STUDIO_CATALOG_TEST_PROBE'
const WINDOW = { from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z' }
const ROW_KEYS = [
  'bound_grant',
  'credential_class',
  'exposure_scope',
  'logical_reference',
  'permitted_operations',
  'revocation_state',
  'valid_window',
]

/** 根凭据底稿（`credentialClass=root`；只含引用侧字段） */
const ROOT: CatalogEntryDraft = {
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

/** 子凭据（`scoped`，父=根；用途只声明登录——与 bot 密码条目口径一致） */
const CHILD: CatalogEntryDraft = {
  secretId: 'SEC-MX-BOT-PASSWORD',
  secretType: 'platform_credential',
  credentialClass: 'scoped',
  logicalReference: 'mx-bot@company',
  boundGrant: { recordId: 'grant-scoped-1', refVersion: '1.0.0' },
  parentCredentialRef: 'SEC-GW-SIGNING',
  permittedOperations: ['matrix-login'],
  validWindow: WINDOW,
  exposureScope: 'deployment:studio-dev',
  valueProvider: { type: 'env-ref', name: PROBE_ENV },
}

/** 孙凭据（`scoped`，父=子；验证撤回的传递停用面） */
const GRANDCHILD: CatalogEntryDraft = {
  secretId: 'SEC-MX-ROOM-TOKEN',
  secretType: 'platform_credential',
  credentialClass: 'scoped',
  logicalReference: 'mx-room@company',
  boundGrant: { recordId: 'grant-scoped-2', refVersion: '1.0.0' },
  parentCredentialRef: 'SEC-MX-BOT-PASSWORD',
  permittedOperations: ['matrix-notify'],
  validWindow: WINDOW,
  exposureScope: 'deployment:studio-dev',
  valueProvider: { type: 'file-ref', secretId: 'SEC-MX-ROOM-TOKEN' },
}

/** 底稿覆写（只用于造非法/负向输入；合法输入走上面三常量） */
function draft(base: CatalogEntryDraft, over: Record<string, unknown> = {}): CatalogEntryDraft {
  return { ...base, ...over } as unknown as CatalogEntryDraft
}

function makeCatalog(): { catalog: ReturnType<typeof createCredentialCatalog>; setNow: (ms: number) => void } {
  let now = NOW
  const catalog = createCredentialCatalog({ clock: () => now })
  return { catalog, setNow: (ms: number) => { now = ms } }
}

function okValue<T>(result: PortResult<T>): T {
  if (result.kind !== 'ok') throw new Error(`期望 Ok，实际 ${result.error.category}/${result.error.subcause}`)
  return result.value
}

function failureOf<T>(result: PortResult<T>): PortFailure {
  if (result.kind !== 'err') throw new Error('期望 Err（放行路径必须不存在），实际 Ok')
  return result.error
}

function codeOf<T>(result: PortResult<T>): string {
  const failure = failureOf(result)
  return `${failure.category}/${failure.subcause}`
}

/** 根→子→孙 的目录夹具（三件全部登记成功才返回） */
function chainCatalog(): {
  catalog: ReturnType<typeof createCredentialCatalog>
  root: unknown
  child: unknown
  grandchild: unknown
  setNow: (ms: number) => void
} {
  const { catalog, setNow } = makeCatalog()
  const root = okValue(catalog.register(ROOT))
  const child = okValue(catalog.register(CHILD))
  const grandchild = okValue(catalog.register(GRANDCHILD))
  return { catalog, root, child, grandchild, setNow }
}

/** 吊销证明（三动作齐＋证据；覆写用于负向） */
function proof(over: Record<string, unknown> = {}): RevocationProof {
  return {
    recordId: 'rvk-1',
    injectionStopped: true,
    fenceRejectionRecorded: true,
    evidenceRefs: ['rvk-receipt-1', 'injection-stop-1', 'fence-reject-1'],
    ...over,
  } as unknown as RevocationProof
}

/** 审计视图夹具（纯对账器用例：手工快照，不经过目录） */
function viewOf(secretId: string, parent: string | undefined, revocationState: RevocationState): CatalogEntryView {
  return {
    secretId,
    secretType: 'platform_credential',
    credentialClass: parent === undefined ? 'root' : 'scoped',
    logicalReference: `ref-${secretId.toLowerCase()}`,
    boundGrant: { recordId: 'grant-1', refVersion: '1.0.0' },
    ...(parent !== undefined ? { parentCredentialRef: parent } : {}),
    permittedOperations: ['op'],
    validWindow: WINDOW,
    exposureScope: 'deployment:studio-dev',
    valueProvider: { type: 'env-ref', name: PROBE_ENV },
    revocationState,
  }
}

// ————————————————————————— 一、零值：目录不存值、永不回值 —————————————————————————

describe('零值断言：目录不是值的第二存放处', () => {
  it('登记 env-ref 后，行/视图/解析/句柄全部检索不到探针值', () => {
    process.env[PROBE_ENV] = PROBE
    try {
      const { catalog } = chainCatalog()
      const artifacts = [
        JSON.stringify(catalog.rows()),
        JSON.stringify(catalog.entryViews()),
        JSON.stringify(catalog.resolve('SEC-MX-BOT-PASSWORD')),
        JSON.stringify(catalog.supply('SEC-MX-BOT-PASSWORD', { seconds: 600 })),
      ]
      for (const text of artifacts) expect(text).not.toContain(PROBE)
    } finally {
      delete process.env[PROBE_ENV]
    }
  })

  it('底稿带 value 键 ⇒ rejected_forbidden/catalog-value-rejected，目录零条目，错误不回显该值', () => {
    const { catalog } = makeCatalog()
    const result = catalog.register(draft(ROOT, { value: PROBE }))
    expect(codeOf(result)).toBe('rejected_forbidden/catalog-value-rejected')
    expect(failureOf(result).detail).not.toContain(PROBE)
    expect(catalog.rows()).toEqual([])
  })

  it('值形态 logicalReference（sk- 前缀）⇒ 值拒收', () => {
    const { catalog } = makeCatalog()
    expect(codeOf(catalog.register(draft(ROOT, { logicalReference: `sk-${PROBE}` })))).toBe(
      'rejected_forbidden/catalog-value-rejected',
    )
  })

  it('路径形态引用/来源（logicalReference 带 /、file-ref 绝对路径、字符串前缀 provider）⇒ 形状拒收', () => {
    const { catalog } = makeCatalog()
    expect(codeOf(catalog.register(draft(ROOT, { logicalReference: 'cred/root' })))).toBe('rejected_precondition/catalog-entry-invalid')
    expect(codeOf(catalog.register(draft(ROOT, { valueProvider: { type: 'file-ref', secretId: '/etc/secrets/mx' } })))).toBe(
      'rejected_precondition/catalog-entry-invalid',
    )
    expect(codeOf(catalog.register(draft(ROOT, { valueProvider: 'env:MATRIX_BOT_PASSWORD' })))).toBe(
      'rejected_precondition/catalog-entry-invalid',
    )
    expect(codeOf(catalog.register(draft(ROOT, { valueProvider: { type: 'env-ref', name: 'MATRIX_BOT_PASSWORD', value: PROBE } })))).toBe(
      'rejected_forbidden/catalog-value-rejected',
    )
  })

  it('落表行只有 REC-AUTH-04 字段面（无 secretId/父链/值位）', () => {
    const { catalog } = chainCatalog()
    const row = okValue(catalog.register(draft(ROOT, { secretId: 'SEC-TG-TOKEN', logicalReference: 'tg-main@company', valueProvider: { type: 'env-ref', name: 'TAIGA_TOKEN' } })))
    expect(Object.keys(row).sort()).toEqual(ROW_KEYS)
    expect('secretId' in row).toBe(false)
    expect('parentCredentialRef' in row).toBe(false)
    expect('value' in row).toBe(false)
  })

  it('短时句柄无值位（类型级恒 undefined＋运行级无 key）', () => {
    const { catalog } = chainCatalog()
    const handle = okValue(catalog.supply('SEC-MX-BOT-PASSWORD', { seconds: 600 }))
    expectTypeOf<ShortLivedHandle['value']>().toEqualTypeOf<undefined>()
    expect('value' in handle).toBe(false)
    expect(Object.keys(handle).sort()).toEqual(['credential', 'expiresAt', 'handleId', 'issuedAt', 'singleUse'])
    expect(handle.singleUse).toBe(true)
    expect(handle.expiresAt).toBe(new Date(NOW + 600_000).toISOString())
    expect(Object.keys(handle.credential).sort()).toEqual(['credentialClass', 'credentialId', 'scope', 'ttl'])
  })
})

// ————————————————————————— 二、REC-AUTH-04 逻辑引用落表 —————————————————————————

describe('REC-AUTH-04 逻辑引用落表', () => {
  it('登记返回字段逐项：类别/逻辑引用/绑定授予/操作/有效期/吊销状态/知悉范围', () => {
    const { catalog } = makeCatalog()
    const row = okValue(catalog.register(ROOT))
    expect(row.credential_class).toBe('root')
    expect(row.logical_reference).toBe('cred-root@company')
    expect(row.bound_grant).toEqual({ refType: 'REC-AUTH-01', refId: 'grant-root-1', refVersion: '1.0.0' })
    expect(row.permitted_operations).toEqual(['gateway-sign'])
    expect(row.valid_window).toEqual(WINDOW)
    expect(row.revocation_state).toBe('active')
    expect(row.exposure_scope).toBe('position:PRIME-0')
  })

  it('行过 contract CredentialReferencePayloadSchema（形状唯一源核对）', () => {
    const { catalog } = chainCatalog()
    const rows = catalog.rows()
    expect(rows.length).toBe(3)
    for (const row of rows) {
      const parsed = CredentialReferencePayloadSchema.safeParse(row)
      expect(parsed.success).toBe(true)
    }
  })

  it('rows() 按 secretId 稳定序；resolve 未登记＝Ok(undefined)（不是拒绝）', () => {
    const { catalog } = chainCatalog()
    expect(catalog.rows().map((row) => row.logical_reference)).toEqual(['cred-root@company', 'mx-bot@company', 'mx-room@company'])
    expect(okValue(catalog.resolve('SEC-NOPE-NONE'))).toBeUndefined()
  })

  it('root 禁带父凭据；scoped 必带父凭据且父须已登记', () => {
    const { catalog } = makeCatalog()
    expect(codeOf(catalog.register(draft(ROOT, { parentCredentialRef: 'SEC-GW-SIGNING' })))).toBe(
      'rejected_precondition/catalog-entry-invalid',
    )
    expect(codeOf(catalog.register(draft(CHILD, { parentCredentialRef: undefined })))).toBe(
      'rejected_precondition/catalog-entry-invalid',
    )
    expect(codeOf(catalog.register(CHILD))).toBe('rejected_authority/catalog-parent-unknown')
    okValue(catalog.register(ROOT))
    okValue(catalog.register(CHILD))
    expect(codeOf(catalog.register(CHILD))).toBe('rejected_precondition/catalog-entry-duplicate')
  })

  it('五型/两类别值集之外、semver/时刻/窗口形状不符 ⇒ 拒', () => {
    const { catalog } = makeCatalog()
    expect(codeOf(catalog.register(draft(ROOT, { secretType: 'api_key' })))).toBe('rejected_precondition/catalog-entry-invalid')
    expect(codeOf(catalog.register(draft(ROOT, { credentialClass: 'admin' })))).toBe('rejected_precondition/catalog-entry-invalid')
    expect(codeOf(catalog.register(draft(ROOT, { boundGrant: { recordId: 'grant-1', refVersion: 'latest' } })))).toBe(
      'rejected_precondition/catalog-entry-invalid',
    )
    expect(codeOf(catalog.register(draft(ROOT, { validWindow: { from: '2026-06-01', to: '2027-01-01' } })))).toBe(
      'rejected_precondition/catalog-window-invalid',
    )
    expect(codeOf(catalog.register(draft(ROOT, { validWindow: { from: '2027-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' } })))).toBe(
      'rejected_precondition/catalog-window-invalid',
    )
    expect(codeOf(catalog.register(draft(ROOT, { validWindow: { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' } })))).toBe(
      'rejected_precondition/catalog-window-invalid',
    )
    expect(codeOf(catalog.register(draft(ROOT, { secretId: 'MATRIX_BOT_PASSWORD' })))).toBe('rejected_precondition/catalog-entry-invalid')
    expect(catalog.rows()).toEqual([])
  })
})

// ————————————————————————— 三、短时供给：只收紧、不回值 —————————————————————————

describe('短时供给：未登记/越窗/过期一律拒，零句柄', () => {
  it('未登记 ⇒ catalog-entry-missing', () => {
    const { catalog } = makeCatalog()
    expect(codeOf(catalog.supply('SEC-NOPE-NONE', { seconds: 60 }))).toBe('rejected_precondition/catalog-entry-missing')
  })

  it('窗口 0/非整数/超出凭据有效期 ⇒ catalog-window-invalid（只收紧不放宽）', () => {
    const { catalog } = chainCatalog()
    expect(codeOf(catalog.supply('SEC-MX-BOT-PASSWORD', { seconds: 0 }))).toBe('rejected_precondition/catalog-window-invalid')
    expect(codeOf(catalog.supply('SEC-MX-BOT-PASSWORD', { seconds: 1.5 }))).toBe('rejected_precondition/catalog-window-invalid')
    const remaining = Date.parse(WINDOW.to) - NOW
    expect(codeOf(catalog.supply('SEC-MX-BOT-PASSWORD', { seconds: Math.ceil(remaining / 1000) + 1 }))).toBe(
      'rejected_precondition/catalog-window-invalid',
    )
  })

  it('有效期已过 ⇒ catalog-expired；未开始 ⇒ 拒（不预支）', () => {
    const { catalog, setNow } = makeCatalog()
    const shortLived = draft(ROOT, { secretId: 'SEC-TG-TOKEN', logicalReference: 'tg-main@company', validWindow: { from: '2026-01-01T00:00:00Z', to: '2026-06-02T00:00:00Z' } })
    okValue(catalog.register(shortLived))
    setNow(Date.parse('2026-06-03T00:00:00Z'))
    expect(codeOf(catalog.supply('SEC-TG-TOKEN', { seconds: 60 }))).toBe('rejected_authority/catalog-expired')
    // 解析仍返回行（状态可读），但不可供给——「有记录」不证明「可用」
    expect(okValue(catalog.resolve('SEC-TG-TOKEN'))?.revocation_state).toBe('active')

    const { catalog: late, setNow: setLate } = makeCatalog()
    okValue(late.register(draft(ROOT, { secretId: 'SEC-TG-TOKEN', secretType: 'platform_credential', credentialClass: 'root', logicalReference: 'tg-main@company', validWindow: { from: '2026-07-01T00:00:00Z', to: '2027-01-01T00:00:00Z' } })))
    setLate(NOW)
    expect(codeOf(late.supply('SEC-TG-TOKEN', { seconds: 60 }))).toBe('rejected_authority/catalog-expired')
  })
})

// ————————————————————————— 四、NEG-SEC-08 前腿：撤回后代凭据 —————————————————————————

describe('NEG-SEC-08 前腿：撤回后子体不得仍持可用凭据', () => {
  it('三动作缺一 ⇒ catalog-proof-missing，零状态变更（仍可供给）', () => {
    const { catalog } = chainCatalog()
    expect(codeOf(catalog.revoke('SEC-GW-SIGNING', proof({ injectionStopped: false })))).toBe(
      'rejected_precondition/catalog-proof-missing',
    )
    expect(codeOf(catalog.revoke('SEC-GW-SIGNING', proof({ evidenceRefs: [] })))).toBe(
      'rejected_precondition/catalog-proof-missing',
    )
    expect(catalog.rows().every((row) => row.revocation_state === 'active')).toBe(true)
    okValue(catalog.supply('SEC-MX-BOT-PASSWORD', { seconds: 60 }))
  })

  it('后代枚举缺项 ⇒ catalog-descendants-incomplete（差异非空即判负），零状态变更', () => {
    const { catalog } = chainCatalog()
    const result = catalog.revoke('SEC-GW-SIGNING', proof({ descendants: ['SEC-MX-BOT-PASSWORD'] }))
    expect(codeOf(result)).toBe('rejected_precondition/catalog-descendants-incomplete')
    expect(failureOf(result).detail).toContain('SEC-MX-ROOM-TOKEN')
    expect(catalog.rows().every((row) => row.revocation_state === 'active')).toBe(true)
    okValue(catalog.supply('SEC-MX-BOT-PASSWORD', { seconds: 60 }))
  })

  it('后代枚举含目录外引用 ⇒ catalog-descendants-unknown', () => {
    const { catalog } = chainCatalog()
    expect(codeOf(catalog.revoke('SEC-GW-SIGNING', proof({ descendants: ['SEC-MX-BOT-PASSWORD', 'SEC-MX-ROOM-TOKEN', 'SEC-XX-OTHER'] })))).toBe(
      'rejected_precondition/catalog-descendants-unknown',
    )
  })

  it('无后代且无显式确认方法 ⇒ catalog-no-descendant-confirmation（不得留空视为零）', () => {
    const { catalog } = makeCatalog()
    okValue(catalog.register(draft(ROOT, { secretId: 'SEC-TG-TOKEN', logicalReference: 'tg-main@company' })))
    expect(codeOf(catalog.revoke('SEC-TG-TOKEN', proof()))).toBe('rejected_precondition/catalog-no-descendant-confirmation')
    const okProof = proof({ noDescendantConfirmation: { probeMethod: 'descendant-registry-scan', lastProbedAt: '2026-06-01T00:00:00Z' } })
    expect(okValue(catalog.revoke('SEC-TG-TOKEN', okProof)).revoked).toEqual(['SEC-TG-TOKEN'])
  })

  it('完整枚举 ⇒ 自身＋全后代逐项 revoked；回执对账 stillUsable=[]；供给路径全不存在', () => {
    const { catalog } = chainCatalog()
    const receipt = okValue(catalog.revoke('SEC-GW-SIGNING', proof({ descendants: ['SEC-MX-ROOM-TOKEN', 'SEC-MX-BOT-PASSWORD'] })))
    expect(receipt.revoked).toEqual(['SEC-GW-SIGNING', 'SEC-MX-BOT-PASSWORD', 'SEC-MX-ROOM-TOKEN'])
    expect(receipt.injectionStopped).toBe(true)
    expect(receipt.fenceRejectionRecorded).toBe(true)
    expect(receipt.reconciliation.stillUsable).toEqual([])
    expect(catalog.rows().map((row) => row.revocation_state)).toEqual(['revoked', 'revoked', 'revoked'])
    for (const secretId of ['SEC-GW-SIGNING', 'SEC-MX-BOT-PASSWORD', 'SEC-MX-ROOM-TOKEN']) {
      expect(codeOf(catalog.supply(secretId, { seconds: 60 }))).toBe('rejected_authority/catalog-revoked')
    }
    // 幂等：同证明再调不改变终态
    expect(okValue(catalog.revoke('SEC-GW-SIGNING', proof({ descendants: ['SEC-MX-BOT-PASSWORD', 'SEC-MX-ROOM-TOKEN'] }))).reconciliation.stillUsable).toEqual([])
  })

  it('撤回后再以已撤父凭据登记子凭据 ⇒ catalog-parent-revoked（不给已撤后代签新凭据）', () => {
    const { catalog } = chainCatalog()
    okValue(catalog.revoke('SEC-GW-SIGNING', proof({ descendants: ['SEC-MX-BOT-PASSWORD', 'SEC-MX-ROOM-TOKEN'] })))
    const fresh = draft(GRANDCHILD, { secretId: 'SEC-MX-NEW-TOKEN', logicalReference: 'mx-new@company' })
    expect(codeOf(catalog.register(fresh))).toBe('rejected_authority/catalog-parent-revoked')
    expect(okValue(catalog.resolve('SEC-MX-NEW-TOKEN'))).toBeUndefined()
  })

  it('纯对账器：父已撤而子仍 active 的快照 ⇒ stillUsable 非空（判负输入可判）', () => {
    const snapshot = [viewOf('SEC-A-ROOT', undefined, 'revoked'), viewOf('SEC-B-CHILD', 'SEC-A-ROOT', 'active')]
    const reconciliation = reconcileRevocation(snapshot, 'SEC-A-ROOT')
    expect(reconciliation.descendants).toEqual(['SEC-B-CHILD'])
    expect(reconciliation.stillUsable).toEqual(['SEC-B-CHILD'])
    // 差异非空 ⇒ 不得宣称撤回完成/后代已停用
    expect(reconciliation.stillUsable.length > 0).toBe(true)
  })

  it('纯对账器：父链全撤的快照 ⇒ stillUsable=[] 且后代逐项（含孙代）', () => {
    const snapshot = [
      viewOf('SEC-A-ROOT', undefined, 'revoked'),
      viewOf('SEC-B-CHILD', 'SEC-A-ROOT', 'revoked'),
      viewOf('SEC-C-GRAND', 'SEC-B-CHILD', 'revoked'),
    ]
    const reconciliation = reconcileRevocation(snapshot, 'SEC-A-ROOT')
    expect(reconciliation.descendants).toEqual(['SEC-B-CHILD', 'SEC-C-GRAND'])
    expect(reconciliation.stillUsable).toEqual([])
  })
})
