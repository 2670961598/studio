/**
 * neg/ring —— NEG 最后一组的可执行两行：RING-02 权责环·撤回结清｜RING-05 进化环·未批生效
 *
 * 依据（实现单必须引章节号——AGENTS §五.1）：
 *   - docs/v2/17 §4.1 NEG-RING-02（撤回不含派生枚举与凭据结清即宣称完成→I-6 判负；对账差异非空即拒
 *     〔08 §1.3〕）与 NEG-RING-05（未批准/未验证的变更生效；失败后修低判据→无验证生效为零；I-13 判负〔01 §5.4〕）；
 *   - docs/v2/05 §五 五环表（权责环强制失败列「撤回含派生与凭据结清（I-6）」；进化环「未批准或未验证
 *     不得生效；失败不得修低判据冒充成功（I-13）」）；
 *   - docs/v2/01 §5.4（公司层变更：未获批准不生效、原规则继续有效；分类不得改名降级 R-24）＋§三 I-6/I-13；
 *   - docs/v2/07 §四（派生树四判据：后代清单／停用证据／无后代确认／残留观察）、15 §4.3/§六（SEC-REV-01
 *     三动作逐项留证）；docs/v2/11 §六 REC-EVD-RVK、§八 REC-CHG-01（段不可跳/三门不合并）；
 *   - docs/v2/12 §5.1/§5.3（探针状态三值；负向结论也用 executed）＋§六（BIND-LOSS：卸载宿主即损失，
 *     不得把「判定件放行」当能力证明）——本文件只证判定面，不证五环闭合、不证撤回已完成、不证能力具备；
 *   - docs/v2/17 §一 V1（形状/记录判定真跑）＋V3（fake 只替代外部端口；目录/记录判定真跑）。
 *
 * 被测生产面（四处，均为真实生产函数）：
 *   1. `packages/gateway/src/catalog.ts` `createCredentialCatalog().revoke()`——目录侧前腿：
 *      三动作齐＋后代枚举逐项相等才落状态；拒时零状态变更（撤回未完成）。
 *   2. 同包 `catalog-entry.ts` 的 `readRevocationProof`/`reconcileRevocation`——四判据读法与残留对账
 *      （`stillUsable` 非空＝判负输入）。
 *   3. contract `validateRevocationEvidence`（REC-EVD-RVK）——撤回完成证据记录面（I-6）。
 *   4. contract `validateChangeSegment`（REC-CHG-01）——段序/三门/无验证生效为零（I-13）。
 *
 * 断言纪律：只调用生产函数并断言其具名拒绝结论（PortResult subcause ／ issue 路径＋文案），每条负例
 * 跟正例对照；不以「形状永远红」冒充负例（同 neg/work-gates.test.ts 口径）。
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
import { validateChangeSegment, type ChangeSegment } from '../../../../../packages/contract/src/records/chg.ts'

// ————————————————————————— 基座：目录三层派生树 —————————————————————————

const AT = '2026-10-28T00:00:00Z'
const NOW = Date.parse('2026-06-01T00:00:00Z')
const WINDOW = { from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z' }

/** 根凭据（引用侧；无值位） */
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

/** 孙凭据（父=子；派生执行体持之——撤回最易漏枚举的一层） */
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
  valueProvider: { type: 'local-mint', ticketId: 'T-RING02-1' },
}

/** 真登记三层派生树（根→子→孙） */
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
    recordId: 'EVD-RVK-RING-02',
    injectionStopped: true,
    fenceRejectionRecorded: true,
    evidenceRefs: ['ev-stop-injection'],
    descendants: ['SEC-MX-SUBAGENT', 'SEC-MX-BOT-PASSWORD'],
    ...overrides,
  } as unknown as RevocationProof
}

/** 拒绝纯码（放行路径不存在才算负例成立） */
function subcauseOf(result: PortResult<unknown>): string | undefined {
  return result.kind === 'err' ? result.error.subcause : undefined
}

// ————————————————————————— 基座：REC-EVD-RVK 记录面 —————————————————————————

type Issue = { readonly path: string; readonly message: string }

function ref(refType: string, refId = 'rec-1', refVersion = '1.0.0') {
  return { refType, refId, refVersion }
}

/** 记录信封（§0.5 生效槽与信封同值；producer 具名） */
function envelope(recordType: string, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    recordId: 'rec-neg-ring-02',
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
    proofBoundary: '只证明撤回完成的后代枚举与停用证据；不证明撤回理由充分、不证明价值',
  }
}

function reject(outcome: RecordValidationOutcome): readonly Issue[] {
  expect(outcome.ok).toBe(false)
  return outcome.ok ? [] : outcome.issues
}

function hit(issues: readonly Issue[], path: string, fragment: string): boolean {
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

// ————————————————————————— NEG-RING-02 权责环·撤回结清 —————————————————————————

describe('NEG-RING-02 权责环·撤回结清：派生枚举＋凭据结清四判据缺一即未完成', () => {
  it('NEG-RING-02 判据一·后代清单：撤回不含后代枚举→拒；后代凭据仍可供给＝结清未发生', () => {
    const catalog = seedTree()
    // ①「父撤即全撤」的冒充：完全不给后代枚举 → 拒（四判据缺一即未完成）
    expect(subcauseOf(catalog.revoke('SEC-GW-SIGNING', proof({ descendants: undefined })))).toBe('catalog-descendants-incomplete')
    // ② 只枚举子代、漏孙代（派生执行体最易漏的一层）→ 拒
    expect(subcauseOf(catalog.revoke('SEC-GW-SIGNING', proof({ descendants: ['SEC-MX-BOT-PASSWORD'] })))).toBe('catalog-descendants-incomplete')
    // ③ 凭据结清未发生：被拒后子/孙仍持可用凭据（供给路径存在，不是「已提醒」）
    expect(catalog.supply('SEC-MX-BOT-PASSWORD', { seconds: 60 }).kind).toBe('ok')
    expect(catalog.supply('SEC-MX-SUBAGENT', { seconds: 60 }).kind).toBe('ok')
    // ④ 零状态变更：不得「先撤再补枚举」——记录不得标撤回完成
    expect(catalog.rows().every((row) => row.revocation_state === 'active')).toBe(true)
    // ⑤ 记录面同判（I-6）：活后代未全枚举 → 撤回证据判负
    const verdict = reject(validateRevocationEvidence(envelope('REC-EVD-RVK', rvkPayload()), { liveDescendants: ['child-1', 'grandchild-1'] }))
    expect(hit(verdict, 'payload.descendants_inventory', '后代未全枚举')).toBe(true)
  })

  it('NEG-RING-02 判据一·差异非空：漏项/目录外引用均拒；残留对账非空即判负输入', () => {
    // ① 纯判定器三态：缺项 / 目录外引用 / 无后代却无显式确认
    const known = ['SEC-MX-BOT-PASSWORD', 'SEC-MX-SUBAGENT']
    expect(readRevocationProof(proof({ descendants: ['SEC-MX-BOT-PASSWORD'] }), known).ok).toBe(false)
    expect(readRevocationProof(proof({ descendants: [...known, 'SEC-GW-GHOST'] }), known).ok).toBe(false)
    expect(readRevocationProof(proof({ descendants: undefined }), []).ok).toBe(false)
    // ② 目录入口同判：目录外引用 → 拒且零状态变更（不猜归属）
    const catalog = seedTree()
    expect(subcauseOf(catalog.revoke('SEC-GW-SIGNING', proof({ descendants: [...known, 'SEC-GW-GHOST'] })))).toBe('catalog-descendants-unknown')
    // ③ 残留观察（判据四）：父已撤而子仍 active 的快照 → stillUsable 非空＝判负输入可判、不得抹平
    const snapshot: readonly CatalogEntryView[] = [
      { ...ROOT, revocationState: 'revoked' },
      { ...CHILD, revocationState: 'active' },
      { ...GRANDCHILD, revocationState: 'active' },
    ]
    expect(reconcileRevocation(snapshot, 'SEC-GW-SIGNING').stillUsable).toEqual(['SEC-MX-BOT-PASSWORD', 'SEC-MX-SUBAGENT'])
    // ④ 记录面：清单已枚举但仍有存活却称撤回完成 → 判负（未全停不得称完成）
    const verdict = reject(validateRevocationEvidence(envelope('REC-EVD-RVK', rvkPayload()), { liveDescendants: ['child-1'], claimedComplete: true }))
    expect(hit(verdict, 'recordType', '未全停不得称撤回完成')).toBe(true)
  })

  it('NEG-RING-02 判据二/三·停用证据＋无后代确认：缺一不得记撤回完成', () => {
    const catalog = seedTree()
    // ① 停用证据缺项：未停注入 / 未记围栏拒绝 / 无证据引用（三动作逐项留证）
    expect(subcauseOf(catalog.revoke('SEC-GW-SIGNING', proof({ injectionStopped: false })))).toBe('catalog-proof-missing')
    expect(subcauseOf(catalog.revoke('SEC-GW-SIGNING', proof({ fenceRejectionRecorded: false })))).toBe('catalog-proof-missing')
    expect(subcauseOf(catalog.revoke('SEC-GW-SIGNING', proof({ evidenceRefs: [] })))).toBe('catalog-proof-missing')
    // ② 无后代不得留空视为零：缺显式确认方法 / 确认方法不完整（缺最后探测时点）均拒
    expect(subcauseOf(catalog.revoke('SEC-MX-SUBAGENT', proof({ descendants: undefined })))).toBe('catalog-no-descendant-confirmation')
    expect(
      subcauseOf(catalog.revoke('SEC-MX-SUBAGENT', proof({ descendants: undefined, noDescendantConfirmation: { probeMethod: '进程表＋目录父链扫描' } }))),
    ).toBe('catalog-no-descendant-confirmation')
    // ③ 记录面：空清单且无 no_descendant_confirmation → 判负
    const verdict = reject(validateRevocationEvidence(envelope('REC-EVD-RVK', rvkPayload({ descendants_inventory: [] }))))
    expect(hit(verdict, 'payload.no_descendant_confirmation', '不得留空视为零')).toBe(true)
    // ④ 正例对照：无后代＋确认方法齐 → 落状态（四判据齐才完成）
    const leaf = catalog.revoke(
      'SEC-MX-SUBAGENT',
      proof({ descendants: undefined, noDescendantConfirmation: { probeMethod: '进程表＋目录父链扫描', lastProbedAt: AT } }),
    )
    expect(leaf.kind).toBe('ok')
  })

  it('NEG-RING-02 判据四·残留观察＋正例：对账差异为空＋供给路径不存在才可称撤回完成', () => {
    const catalog = seedTree()
    const receipt = catalog.revoke('SEC-GW-SIGNING', proof())
    expect(receipt.kind).toBe('ok')
    if (receipt.kind === 'ok') {
      // ① 对账差异为空（差异非空即判负）：后代逐项落状态且无残留
      expect(receipt.value.reconciliation.stillUsable).toEqual([])
      expect(receipt.value.reconciliation.descendants).toEqual(['SEC-MX-BOT-PASSWORD', 'SEC-MX-SUBAGENT'])
      expect(receipt.value.revoked).toEqual(['SEC-GW-SIGNING', 'SEC-MX-BOT-PASSWORD', 'SEC-MX-SUBAGENT'])
    }
    // ② 真实目录视图对账同样为空（不是回执自说）
    expect(reconcileRevocation(catalog.entryViews(), 'SEC-GW-SIGNING').stillUsable).toEqual([])
    // ③ 凭据结清：撤回后后代不再持可用凭据（供给路径不存在——不是「已提醒」）
    expect(subcauseOf(catalog.supply('SEC-MX-BOT-PASSWORD', { seconds: 60 }))).toBe('catalog-revoked')
    expect(subcauseOf(catalog.supply('SEC-MX-SUBAGENT', { seconds: 60 }))).toBe('catalog-revoked')
    // ④ 撤回后新派生仍取得凭据 → 拒（后代不得换壳复活）
    expect(
      subcauseOf(catalog.register({ ...GRANDCHILD, secretId: 'SEC-MX-LATE', logicalReference: 'late-child@matrix' })),
    ).toBe('catalog-parent-revoked')
    // ⑤ 记录面正例：活后代为空＋清单与停用证据齐 → 撤回完成证据成立
    expect(validateRevocationEvidence(envelope('REC-EVD-RVK', rvkPayload()), { liveDescendants: [] })).toEqual({ ok: true })
  })
})

// ————————————————————————— NEG-RING-05 进化环·未批生效 —————————————————————————

/** 三门段（验证授权/独立验证/激活批准——不得合并、不得互替） */
const GATES: readonly ChangeSegment[] = ['verification_authorization', 'independent_verification', 'activation_approval']

function impactAssessment(): Record<string, unknown> {
  return { tasks: [], information: [], permissions: [], commitments: [], evidence: [], qualifications: [], in_flight_side_effects: [] }
}

function rollout(): Record<string, unknown> {
  return { scope: '仅内部工作区', fencing: '独占交接', monitoring: ['MON-14'] }
}

/** REC-CHG-01 段记录载荷（判据缺项由用例逐条打开） */
function segmentPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chain_id: 'chain-ring-05',
    segment: 'candidate',
    subject: { refId: 'rule-1', refVersion: '1.0.0' },
    subject_kind: 'rule',
    decided_by: 'unit-head-1',
    authority_ref: ref('REC-AUTH-01'),
    basis_refs: [ref('REC-WORK-17')],
    impact_assessment: impactAssessment(),
    criteria_version: 'criteria@1.0.0',
    no_override: true,
    rollback_path: { stop_conditions: ['撤回率升高'], monitoring: ['MON-14'], rollback_steps: ['回退旧版本并清理'] },
    dissent_position: '无异议',
    effective_state: 'effective',
    effective_time: AT,
    ...overrides,
  }
}

describe('NEG-RING-05 进化环·未批生效：未批准/未验证的变更生效即判负（I-13）', () => {
  it('NEG-RING-05 未批准生效：跳过激活批准段直接受控生效→拒（段不可跳、三门不得互替）', () => {
    const payload = segmentPayload({ segment: 'controlled_effective', controlled_rollout: rollout() })
    // 上一段是独立验证：激活批准这一门还没成立就进受控生效 → 拒
    const issues = reject(validateChangeSegment(envelope('REC-CHG-01', payload), { previousSegment: 'independent_verification' }))
    expect(hit(issues, 'payload.segment', '段不可跳不可互替')).toBe(true)
  })

  it('NEG-RING-05 未验证生效：三门段未成立→拒（无验证生效为零）；三门齐＋已批准才放行', () => {
    const payload = segmentPayload({ segment: 'controlled_effective', controlled_rollout: rollout() })
    // ① 三门段全缺 → 三条「无验证生效为零」逐门指名
    const none = reject(validateChangeSegment(envelope('REC-CHG-01', payload), { previousSegment: 'activation_approval', establishedSegments: [] }))
    expect(none.filter((issue) => issue.message.includes('无验证生效为零')).length).toBe(3)
    // ② 已验证、未批准（缺激活批准一门）→ 拒
    const unapproved = reject(
      validateChangeSegment(envelope('REC-CHG-01', payload), {
        previousSegment: 'activation_approval',
        establishedSegments: ['verification_authorization', 'independent_verification'],
      }),
    )
    expect(unapproved.length).toBe(1)
    expect(hit(unapproved, 'payload.segment', '无验证生效为零：须先有 activation_approval 段')).toBe(true)
    // ③ 正例对照：三道门段全成立 → 放行
    expect(
      validateChangeSegment(envelope('REC-CHG-01', payload), { previousSegment: 'activation_approval', establishedSegments: [...GATES] }),
    ).toEqual({ ok: true })
  })

  it('NEG-RING-05 三门合并：验证授权/独立验证/激活批准同一位置作出→拒（I-13 两道门不合并）', () => {
    const payload = segmentPayload({ segment: 'activation_approval' })
    // ① 三门同一具名位置 → 拒（自批自验＝未批准的变体）
    const merged = reject(
      validateChangeSegment(envelope('REC-CHG-01', payload), {
        previousSegment: 'independent_verification',
        gateDeciders: { verification_authorization: 'same-position', independent_verification: 'same-position', activation_approval: 'same-position' },
      }),
    )
    expect(hit(merged, 'payload.decided_by', '三门不得由同一具名位置作出')).toBe(true)
    // ② 正例对照：三门三个具名位置 → 放行
    expect(
      validateChangeSegment(envelope('REC-CHG-01', payload), {
        previousSegment: 'independent_verification',
        gateDeciders: { verification_authorization: 'auth-1', independent_verification: 'verify-1', activation_approval: 'approve-1' },
      }),
    ).toEqual({ ok: true })
  })

  it('NEG-RING-05 失败后修低判据：no_override=false 或判据变更覆盖原结论→拒（R-8）', () => {
    // ① 记录自称「覆盖原结论」/未担保不覆盖 → 拒
    const lowered = reject(validateChangeSegment(envelope('REC-CHG-01', segmentPayload({ no_override: false }))))
    expect(hit(lowered, 'payload.no_override', '判据变更不得覆盖原结论')).toBe(true)
    // ② 判据变更覆盖原结论（R-8 判负输入）→ 拒
    const overridden = reject(
      validateChangeSegment(
        envelope(
          'REC-CHG-01',
          segmentPayload({
            segment: 'substantive_classification',
            classification_basis: { criteria: ['是否触及判据资产'], classification: '判据变更', beneficiary_involvement: '受益方仅提供材料' },
          }),
        ),
        { previousSegment: 'candidate', criteriaOverridesOriginal: true },
      ),
    )
    expect(hit(overridden, 'payload.criteria_version', '判据变更覆盖原结论＝R-8 判负')).toBe(true)
    // ③ 正例对照：首段 candidate＋不覆盖原结论 → 放行
    expect(validateChangeSegment(envelope('REC-CHG-01', segmentPayload()))).toEqual({ ok: true })
  })
})
