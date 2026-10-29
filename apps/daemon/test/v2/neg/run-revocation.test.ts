/**
 * neg/run-revocation —— NEG-RUN-03「撤回后代枚举」四判据（07 §四；15 SEC-REV-01）
 *
 * 依据（实现单必须引章节号——AGENTS §五.1）：
 *   - docs/v2/17 §4.2 NEG-RUN-03（撤回后派生执行体仍持可用凭据；四判据缺一→撤回记录标未完成）
 *     与 §4.4 NEG-SEC-08 同口径行（对账差异非空即判负）；
 *   - docs/v2/07 §四（派生树四判据：后代清单／停用证据／无后代确认／残留观察）；
 *   - docs/v2/15 §4.3（吊销三动作逐项留证：撤销记录＋停止注入＋围栏拒绝记录）、
 *     §六（停用机制）、§7.3-§7.6（SEC-REV-01 门禁）；
 *   - docs/v2/11 §六 REC-EVD-RVK（后代清单与停用证据；无后代须显式确认方法；
 *     撤回后仍存活的执行体须进 REC-OBS-03）；
 *   - docs/v2/17 §一 V3（fake 只替代外部端口；目录/记录判定真跑）。
 *
 * 被测生产面：
 *   1. `packages/gateway/src/catalog.ts` 的 `createCredentialCatalog().revoke()`——目录侧前腿：
 *      后代枚举逐项相等才落状态（缺口/目录外引用/三动作不齐/无后代无确认一律拒，且零状态变更）；
 *   2. `readRevocationProof`/`reconcileRevocation` 纯判定器（同包 `catalog-entry.ts` 导出）；
 *   3. contract `validateRevocationEvidence`（REC-EVD-RVK 记录判定件）——撤回证据记录面四判据。
 *
 * 断言纪律：全部走真实生产函数与真状态（内存目录真登记/真供给/真吊销），断言拒绝纯码与
 * 对账差异；每条跟正例对照，不以「形状永远红」冒充负例。
 */
import { describe, expect, it } from 'vitest'
import type { PortResult } from '@studio-next/contract'
import {
  createCredentialCatalog,
  reconcileRevocation,
  type CatalogEntryDraft,
  type CatalogEntryView,
  type RevocationProof,
} from '../../../../../packages/gateway/src/catalog.ts'
import { readRevocationProof } from '../../../../../packages/gateway/src/catalog-entry.ts'
import type { RecordValidationOutcome } from '../../../../../packages/contract/src/records/envelope.ts'
import { validateRevocationEvidence } from '../../../../../packages/contract/src/records/evd.ts'

// ————————————————————————— 基座 —————————————————————————

const AT = '2026-10-28T00:00:00Z'
const NOW = Date.parse('2026-06-01T00:00:00Z')
const WINDOW = { from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z' }

/** 根凭据底稿（引用侧字段；无值位） */
const ROOT: CatalogEntryDraft = {
  secretId: 'SEC-GW-SIGNING',
  secretType: 'signing_root_control',
  credentialClass: 'root',
  logicalReference: 'cred-root@company',
  boundGrant: { recordId: 'grant-root-1', refVersion: '1.0.0' },
  permittedOperations: ['gateway-sign'],
  validWindow: WINDOW,
  exposureScope: 'position:PRIME-0',
  valueProvider: { type: 'env-ref', name: 'STUDIO_ROOT_SIGNING_KEY' },
}

/** 子凭据（父=根） */
const CHILD: CatalogEntryDraft = {
  secretId: 'SEC-MX-BOT-PASSWORD',
  secretType: 'platform_credential',
  credentialClass: 'scoped',
  logicalReference: 'bot-password@matrix',
  boundGrant: { recordId: 'grant-child-1', refVersion: '1.0.0' },
  parentCredentialRef: 'SEC-GW-SIGNING',
  permittedOperations: ['login'],
  validWindow: WINDOW,
  exposureScope: 'dept:matrix',
  valueProvider: { type: 'broker-ref', secretId: 'SEC-MX-BOT-PASSWORD' },
}

/** 孙凭据（父=子；派生执行体持之——撤回后最易漏枚举的一层） */
const GRANDCHILD: CatalogEntryDraft = {
  secretId: 'SEC-MX-SUBAGENT',
  secretType: 'per_task_shortlived',
  credentialClass: 'scoped',
  logicalReference: 'subagent@matrix',
  boundGrant: { recordId: 'grant-sub-1', refVersion: '1.0.0' },
  parentCredentialRef: 'SEC-MX-BOT-PASSWORD',
  permittedOperations: ['read-scope'],
  validWindow: WINDOW,
  exposureScope: 'dept:matrix',
  valueProvider: { type: 'local-mint', ticketId: 'T-NEG-1' },
}

/** 真登记三层派生树（父链：根→子→孙） */
function seedTree() {
  const catalog = createCredentialCatalog({ clock: () => NOW })
  for (const draft of [ROOT, CHILD, GRANDCHILD]) {
    const registered = catalog.register(draft)
    if (registered.kind !== 'ok') throw new Error(`登记失败：${registered.error.subcause}`)
  }
  return catalog
}

/** 吊销证明（三动作逐项留证＋后代枚举；判据缺项由用例逐条打开） */
function proof(overrides: Record<string, unknown> = {}): RevocationProof {
  return {
    recordId: 'EVD-RVK-1',
    injectionStopped: true,
    fenceRejectionRecorded: true,
    evidenceRefs: ['ev-stop-injection'],
    descendants: ['SEC-MX-SUBAGENT', 'SEC-MX-BOT-PASSWORD'],
    ...overrides,
  } as unknown as RevocationProof
}

/** 拒绝纯码（`PortResult` Err 的 subcause；放行路径不得存在） */
function subcauseOf(result: PortResult<unknown>): string | undefined {
  return result.kind === 'err' ? result.error.subcause : undefined
}

// ————————————————————————— REC-EVD-RVK 记录面基座 —————————————————————————

function ref(refType: string, refId = 'rec-1', refVersion = '1.0.0') {
  return { refType, refId, refVersion }
}

function envelope(recordType: string, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    recordId: 'rec-neg-0003',
    recordType,
    schemaRef: { schemaId: 'studio-next.records.v2', schemaVersion: '1.0.0' },
    specVersion: '2.0.0',
    companyRef: 'company-a',
    producedAt: AT,
    producer: { decidedBy: 'g9.internal-boss', writtenBy: 'daemon:records' },
    basisRefs: [{ refId: 'basis-1', refVersion: '1.0.0' }],
    payload,
    effectiveState: 'effective',
    effectiveTime: { from: AT },
    proofBoundary: '只证明撤回完成的后代枚举与停用证据；不证明业务授权撤回的理由充分',
  }
}

function reject(outcome: RecordValidationOutcome): readonly { readonly path: string; readonly message: string }[] {
  expect(outcome.ok).toBe(false)
  return outcome.ok ? [] : outcome.issues
}

function hit(issues: readonly { readonly path: string; readonly message: string }[], path: string, fragment: string): boolean {
  return issues.some((issue) => issue.path === path && issue.message.includes(fragment))
}

/** REC-EVD-RVK 载荷（后代清单＋停用证据；无后代确认按用例补） */
function rvkPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subject: ref('REC-AUTH-01', 'grant-root-1'),
    descendants_inventory: [
      {
        descendant_type: 'sub_agent',
        identity_ref: 'child-1',
        credential: { credential_class: 'scoped', logical_reference: 'bot-password@matrix' },
        deactivation_evidence: '停止注入确认（ev-stop-injection）',
        reconcile_entry: 'catalog 对账：stillUsable=[]',
      },
    ],
    deactivation_evidence: { kind: 'revocation_receipt', evidence_ref: 'ev-revoke-receipt-1' },
    ...overrides,
  }
}

// ————————————————————————— 一、后代清单（判据一） —————————————————————————

describe('NEG-RUN-03 判据一·后代清单：枚举缺项/目录外引用即拒，零状态变更', () => {
  it('漏枚举孙代（只报子代）→ catalog-descendants-incomplete；子代凭据仍可用（撤回未生效）', () => {
    const catalog = seedTree()
    // ① 差异非空即判负：已知后代两枚，只枚举一枚
    const short = catalog.revoke('SEC-GW-SIGNING', proof({ descendants: ['SEC-MX-BOT-PASSWORD'] }))
    expect(subcauseOf(short)).toBe('catalog-descendants-incomplete')
    // ② 零状态变更：撤回未完成 ⇒ 后代凭据仍可供给（记录不得标完成）
    expect(catalog.supply('SEC-MX-BOT-PASSWORD', { seconds: 60 }).kind).toBe('ok')
    expect(catalog.rows().every((row) => row.revocation_state === 'active')).toBe(true)
    // ③ 完全不给后代枚举（「父已撤即全撤」的冒充）→ 同样拒
    expect(subcauseOf(catalog.revoke('SEC-GW-SIGNING', proof({ descendants: undefined })))).toBe('catalog-descendants-incomplete')
    // ④ 枚举含目录外引用（不猜归属）
    expect(subcauseOf(catalog.revoke('SEC-GW-SIGNING', proof({ descendants: ['SEC-MX-BOT-PASSWORD', 'SEC-MX-SUBAGENT', 'SEC-GW-GHOST'] })))).toBe(
      'catalog-descendants-unknown',
    )
    // ⑤ 正例对照：逐项相等 → 落状态且回执对账差异为空
    const complete = catalog.revoke('SEC-GW-SIGNING', proof())
    expect(complete.kind).toBe('ok')
    if (complete.kind === 'ok') {
      expect(complete.value.reconciliation.stillUsable).toEqual([])
      expect(complete.value.revoked).toEqual(['SEC-GW-SIGNING', 'SEC-MX-BOT-PASSWORD', 'SEC-MX-SUBAGENT'])
    }
  })
})

// ————————————————————————— 二、停用证据与无后代确认（判据二/三） —————————————————————————

describe('NEG-RUN-03 判据二/三·停用证据＋无后代确认：缺一不得记撤回完成', () => {
  it('三动作缺项 → catalog-proof-missing；无后代却无显式确认方法 → catalog-no-descendant-confirmation', () => {
    const catalog = seedTree()
    // ① 停用证据缺项（未停注入 / 未记围栏拒绝 / 无证据引用）——逐项各拒一次
    expect(subcauseOf(catalog.revoke('SEC-GW-SIGNING', proof({ injectionStopped: false })))).toBe('catalog-proof-missing')
    expect(subcauseOf(catalog.revoke('SEC-GW-SIGNING', proof({ fenceRejectionRecorded: false })))).toBe('catalog-proof-missing')
    expect(subcauseOf(catalog.revoke('SEC-GW-SIGNING', proof({ evidenceRefs: [] })))).toBe('catalog-proof-missing')
    // ② 无后代时不得留空视为零：缺显式确认方法即拒
    expect(subcauseOf(catalog.revoke('SEC-MX-SUBAGENT', proof({ descendants: undefined })))).toBe('catalog-no-descendant-confirmation')
    // ③ 确认方法不完整（缺最后探测时点）→ 同样拒
    expect(
      subcauseOf(catalog.revoke('SEC-MX-SUBAGENT', proof({ descendants: undefined, noDescendantConfirmation: { probeMethod: '进程表＋目录父链扫描' } }))),
    ).toBe('catalog-no-descendant-confirmation')
    // ④ 正例对照：无后代的显式确认方法齐全 → 落状态
    const leaf = catalog.revoke(
      'SEC-MX-SUBAGENT',
      proof({ descendants: undefined, noDescendantConfirmation: { probeMethod: '进程表＋目录父链扫描', lastProbedAt: AT } }),
    )
    expect(leaf.kind).toBe('ok')
  })
})

// ————————————————————————— 三、残留观察（判据四）＋撤回后可用凭据 —————————————————————————

describe('NEG-RUN-03 判据四·残留观察：后代不得仍持可用凭据', () => {
  it('完整撤回 ⇒ 后代供给路径不存在、对账差异为空；父撤子活的快照可判为判负输入', () => {
    const catalog = seedTree()
    const receipt = catalog.revoke('SEC-GW-SIGNING', proof())
    expect(receipt.kind).toBe('ok')
    if (receipt.kind === 'ok') {
      // ① 残留对账：差异非空即判负——本回执差异为空才可宣称已停用
      expect(receipt.value.reconciliation.descendants).toEqual(['SEC-MX-BOT-PASSWORD', 'SEC-MX-SUBAGENT'])
      expect(receipt.value.reconciliation.stillUsable).toEqual([])
    }
    // ② 后代不再持可用凭据（供给路径不存在——不是「已提醒」）
    expect(subcauseOf(catalog.supply('SEC-MX-BOT-PASSWORD', { seconds: 60 }))).toBe('catalog-revoked')
    expect(subcauseOf(catalog.supply('SEC-MX-SUBAGENT', { seconds: 60 }))).toBe('catalog-revoked')
    // ③ 撤回后仍以已撤父凭据登记新后代 → 拒（派生执行体不得取得新凭据）
    expect(
      subcauseOf(
        catalog.register({ ...GRANDCHILD, secretId: 'SEC-MX-LATE', logicalReference: 'late-child@matrix', parentCredentialRef: 'SEC-MX-BOT-PASSWORD' }),
      ),
    ).toBe('catalog-parent-revoked')
    // ④ 纯对账器：父已撤而子仍 active 的快照 → stillUsable 非空（判负输入可判，不得静默抹平）
    const snapshot: readonly CatalogEntryView[] = [
      { ...ROOT, revocationState: 'revoked' },
      { ...CHILD, revocationState: 'active' },
      { ...GRANDCHILD, revocationState: 'active' },
    ]
    expect(reconcileRevocation(snapshot, 'SEC-GW-SIGNING').stillUsable).toEqual(['SEC-MX-BOT-PASSWORD', 'SEC-MX-SUBAGENT'])
  })
})

// ————————————————————————— 四、撤回证据记录面（REC-EVD-RVK） —————————————————————————

describe('NEG-RUN-03 撤回证据记录面：四判据缺一记录标未完成', () => {
  it('活后代未全枚举/仍有存活却称完成/无后代无确认 → 撤回证据记录判负', () => {
    // 正例对照：清单覆盖活后代、无存活、停用证据齐
    expect(validateRevocationEvidence(envelope('REC-EVD-RVK', rvkPayload()), { liveDescendants: [] })).toEqual({ ok: true })
    // ① 活后代缺项（活体知道却没有枚举）→ 后代清单不完整
    expect(
      hit(reject(validateRevocationEvidence(envelope('REC-EVD-RVK', rvkPayload()), { liveDescendants: ['child-1', 'grandchild-1'] })), 'payload.descendants_inventory', '后代未全枚举'),
    ).toBe(true)
    // ② 后代清单已枚举但仍在存活（未全停）却称撤回完成 → 判负
    expect(
      hit(reject(validateRevocationEvidence(envelope('REC-EVD-RVK', rvkPayload()), { liveDescendants: ['child-1'], claimedComplete: true })), 'recordType', '未全停不得称撤回完成'),
    ).toBe(true)
    // ③ 无后代时留空视为零（缺显式确认方法）→ 判负
    expect(
      hit(reject(validateRevocationEvidence(envelope('REC-EVD-RVK', rvkPayload({ descendants_inventory: [] })))), 'payload.no_descendant_confirmation', '不得留空视为零'),
    ).toBe(true)
    // ④ readRevocationProof 纯判定器同口径：缺项/目录外引用/无确认三态各自可判
    expect(readRevocationProof(proof({ descendants: ['SEC-MX-BOT-PASSWORD'] }), ['SEC-MX-BOT-PASSWORD', 'SEC-MX-SUBAGENT']).ok).toBe(false)
    expect(readRevocationProof(proof({ descendants: ['SEC-MX-BOT-PASSWORD', 'SEC-MX-SUBAGENT', 'SEC-GW-GHOST'] }), ['SEC-MX-BOT-PASSWORD', 'SEC-MX-SUBAGENT']).ok).toBe(false)
    expect(readRevocationProof(proof({ descendants: undefined }), []).ok).toBe(false)
  })
})
