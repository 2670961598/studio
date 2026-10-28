/**
 * catalog —— 凭据目录（类别＋逻辑引用；**永不回值**）
 *
 * 依据（实现单引用）：
 *   - docs/plan/05 IMPL-07-12「秘密 catalog＋bot 密码收敛」（LANE-G）；
 *   - docs/v2/15 §4.1 SEC-T1..T5 五型分类（逻辑引用纪律：台账/简报只准出现「类别＋逻辑引用」）、
 *     §4.2 供给差分、§4.3 轮换与吊销（吊销＝撤销记录＋停止注入＋围栏三动作逐项留证，
 *     **不是换文件**）、§4.5 三不入（不入库/不入提示词/不入日志）；
 *   - docs/v2/11 §2.2 `REC-AUTH-04` 凭据逻辑引用：`credential_class`/`logical_reference`/
 *     `bound_grant`/`permitted_operations`/`valid_window`/`revocation_state`/`exposure_scope`，
 *     `credential_class=root` 仅最高宰相且绑 `root_delegation`、`scoped` 不得原地升级；
 *   - docs/v2/14 §1.7 `PORT-TRUST`（签发只产逻辑引用、`supply` 返回短时句柄、`revoke` 回执）；
 *   - docs/v2/17 §4.1 `NEG-SEC-08`（撤回后子体仍持可用凭据＝判负；「对账差异非空即判负」）
 *     ——本件承担该负向行的**目录侧前腿**：后代枚举完整性闸＋撤回后供给路径不存在＋
 *     残留差异对账器；网关侧整树强制（`SEC-REV-02`）仍是目标（未证）。
 *
 * 边界（如实登记，禁互相代证）：
 *   1. **目录不是值的第二存放处**（80-§6.2 `TS-PORT-AUTH-06`）：本件零 IO——不读 env/文件/
 *      网络；`valueProvider` 只存四型**逻辑引用**，`CredentialRef`/短时句柄的值位在 contract
 *      类型上恒为 `undefined`。明文只在部署 provider 内存与短时句柄通道（v2/15 §4.1 通则），
 *      本件不接触、不转发、不打印。
 *   2. **同域拆件**（20-§十五.三，>600 行必须拆）：条目形状/值集闸/撤回对账器落
 *      `./catalog-entry.ts`（更底层，不反向依赖本件）；本件只做目录实现与公共面导出。
 *   3. **不复制 `REC-AUTH-04` 记录类**：落表行形状唯一源＝v2/11 §2.2 ／ contract
 *      `records/auth.ts` 的 `CredentialReferenceRecordSchema`。contract 包根出口当前未导出
 *      `records/*`，故本件产出**同名 payload 字段的视图**（缺口同 `root-delegation.ts` 已登记）；
 *      `catalog.test.ts` 用 contract schema 逐行核对，不改契约、不另立第二套字段。
 *   4. **零 IO / 注入时钟**：注册、解析、短时供给、吊销都在内存目录上判定；有效期与句柄到期
 *      用注入时钟算（缺省 `Date.now`），不写台账。`REC-AUTH-04` 的持久追加（store）与部署
 *      provider 编排（assembly）属其它单领土（v2/16 §三 store/gateway 行），本件不代做。
 *   5. **吊销 ≠ 业务授权撤回**（v2/11 §2.2 不变量）：本件只记凭据侧状态；撤回完成仍须
 *      `REC-AUTH-03`/`EVD-RVK` 的后代清单＋逐项停用证据（`SEC-REV-01`）。本件只保证
 *      「目录侧枚举不完整即拒」与「已撤后代无可用供给路径」，不宣称撤回已完成。
 *   6. **导出面收口不在本单领土**：`src/index.ts` 不在 IMPL-07-12 领土，故本件暂由显式路径
 *      消费（`./catalog.ts`），不新增包根导出；收口随 LANE-G 后续单。
 */
import type { CredentialRef, PortResult, ShortLivedHandle, TtlWindow } from '@studio-next/contract'
import { deepFreeze, readCatalogEntry, readRevocationProof, reconcileRevocation, rejected } from './catalog-entry.ts'
import type {
  CatalogEntry,
  CatalogEntryDraft,
  CatalogEntryView,
  CredentialReferenceRow,
  RevocationProof,
  RevocationReceipt,
  RevocationState,
} from './catalog-entry.ts'

// 公共面同源再导出（消费面只 import `./catalog.ts`；形状/拒绝码/对账器的家在 catalog-entry.ts）
export type {
  CatalogEntry,
  CatalogEntryDraft,
  CatalogEntryView,
  CatalogRejectReason,
  Checked,
  CredentialReferenceRow,
  GrantRefView,
  RevocationProof,
  RevocationReceipt,
  RevocationReconciliation,
  RevocationState,
  ValueProviderRef,
} from './catalog-entry.ts'
export { readCatalogEntry, reconcileRevocation } from './catalog-entry.ts'

// ————————————————————————— 目录装配面 —————————————————————————

/** 目录装配选项（时钟/句柄 id 可注入求确定性；零随机） */
export interface CredentialCatalogOptions {
  readonly clock?: () => number
  readonly nextHandleId?: () => string
}

/** 凭据目录（`PORT-TRUST` 的目录侧前腿；不含值的供给通道） */
export interface CredentialCatalog {
  /** 登记底稿 → `REC-AUTH-04` 落表行（值/路径/非法类别一律拒；重复 `secretId` 拒） */
  register(draft: CatalogEntryDraft): PortResult<CredentialReferenceRow>
  /** 解析：命中返回行（含吊销状态）；未登记返回 `Ok(undefined)`（不是拒绝） */
  resolve(secretId: string): PortResult<CredentialReferenceRow | undefined>
  /** 落表行全集（按 `secretId` 稳定序；只含引用侧） */
  rows(): readonly CredentialReferenceRow[]
  /** 审计视图全集（父链＋吊销状态；稳定序） */
  entryViews(): readonly CatalogEntryView[]
  /** 短时供给：返回句柄（`value` 恒不存在）；已撤/过期/越窗＝拒，不给句柄 */
  supply(secretId: string, window: TtlWindow): PortResult<ShortLivedHandle>
  /** 吊销：三动作证据齐＋后代枚举逐项相等才落状态（幂等）；回执带回对账 */
  revoke(secretId: string, proof: RevocationProof): PortResult<RevocationReceipt>
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

// ————————————————————————— 目录实现 —————————————————————————

/**
 * 建目录（零 IO；值永不入本件）。
 * 注册/供给/吊销都是纯判定：拒绝返回 `PortResult` 的 `Err`（不抛），**不产出任何明文**。
 */
export function createCredentialCatalog(options: CredentialCatalogOptions = {}): CredentialCatalog {
  const clock = options.clock ?? ((): number => Date.now())
  let handleSeq = 0
  const nextHandleId = options.nextHandleId ?? ((): string => {
    handleSeq += 1
    return `h-${handleSeq}`
  })
  const entries = new Map<string, CatalogEntry>()
  const revokedIds = new Set<string>()

  /** 祖先链全为 active 才算可用（父链断=不可用，不猜；root 无父） */
  const isRevokedChain = (secretId: string): boolean => {
    let current: string | undefined = secretId
    const seen = new Set<string>()
    while (current !== undefined) {
      if (seen.has(current)) return true
      seen.add(current)
      if (revokedIds.has(current)) return true
      const entry: CatalogEntry | undefined = entries.get(current)
      if (entry === undefined) return true // 父链断＝不可用（fail-closed，不猜「父凭据不存在≈无父」）
      current = entry.parentCredentialRef
    }
    return false
  }

  /** 目录按父链枚举后代（不含自身；稳定序） */
  const descendantsOf = (secretId: string): readonly string[] => {
    const children = new Map<string, string[]>()
    for (const entry of entries.values()) {
      const parent: string | undefined = entry.parentCredentialRef
      if (parent === undefined) continue
      const list: string[] = children.get(parent) ?? []
      list.push(entry.secretId)
      children.set(parent, list)
    }
    const out: string[] = []
    const queue: string[] = [...(children.get(secretId) ?? [])]
    const seen = new Set<string>()
    while (queue.length > 0) {
      const id: string | undefined = queue.shift()
      if (id === undefined) break
      if (seen.has(id)) continue
      seen.add(id)
      out.push(id)
      queue.push(...(children.get(id) ?? []))
    }
    out.sort()
    return out
  }

  const stateOf = (secretId: string): RevocationState => (revokedIds.has(secretId) ? 'revoked' : 'active')

  const rowOf = (entry: CatalogEntry): CredentialReferenceRow => deepFreeze({
    credential_class: entry.credentialClass,
    logical_reference: entry.logicalReference,
    bound_grant: { refType: 'REC-AUTH-01', refId: entry.boundGrant.recordId, refVersion: entry.boundGrant.refVersion },
    permitted_operations: [...entry.permittedOperations],
    valid_window: { from: entry.validWindow.from, to: entry.validWindow.to },
    revocation_state: stateOf(entry.secretId),
    exposure_scope: entry.exposureScope,
  } satisfies CredentialReferenceRow)

  const viewOf = (entry: CatalogEntry): CatalogEntryView =>
    deepFreeze({ ...entry, revocationState: stateOf(entry.secretId) })

  /** 审计视图全集（稳定序；吊销回执与外部对账共用同一口径） */
  const allViews = (): readonly CatalogEntryView[] =>
    [...entries.keys()].sort().map((id) => viewOf(entries.get(id) as CatalogEntry))

  return {
    register(draft: CatalogEntryDraft): PortResult<CredentialReferenceRow> {
      const read = readCatalogEntry(draft, clock())
      if (!read.ok) return { kind: 'err', error: read.error }
      const entry = read.value
      if (entries.has(entry.secretId)) {
        return rejected('rejected_precondition', 'catalog-entry-duplicate', `secretId ${entry.secretId} 已登记（轮换只递增版本、不换 id；重复登记即配置错误）`)
      }
      const parent = entry.parentCredentialRef
      if (parent !== undefined) {
        if (!entries.has(parent)) {
          return rejected('rejected_authority', 'catalog-parent-unknown', `父凭据 ${parent} 未登记（父链断即拒，不猜父凭据）`)
        }
        if (isRevokedChain(parent)) {
          return rejected('rejected_authority', 'catalog-parent-revoked', `父凭据 ${parent} 已撤回（不得给已撤权的后代签新凭据——NEG-SEC-08 前腿）`)
        }
      }
      entries.set(entry.secretId, entry)
      return { kind: 'ok', value: rowOf(entry) }
    },

    resolve(secretId: string): PortResult<CredentialReferenceRow | undefined> {
      if (typeof secretId !== 'string' || secretId === '') {
        return rejected('rejected_precondition', 'catalog-entry-invalid', 'resolve 须给非空 secretId')
      }
      const entry = entries.get(secretId)
      return { kind: 'ok', value: entry === undefined ? undefined : rowOf(entry) }
    },

    rows(): readonly CredentialReferenceRow[] {
      return [...entries.keys()].sort().map((id) => rowOf(entries.get(id) as CatalogEntry))
    },

    entryViews(): readonly CatalogEntryView[] {
      return allViews()
    },

    supply(secretId: string, window: TtlWindow): PortResult<ShortLivedHandle> {
      if (typeof secretId !== 'string' || secretId === '') {
        return rejected('rejected_precondition', 'catalog-entry-invalid', 'supply 须给非空 secretId')
      }
      const entry = entries.get(secretId)
      if (entry === undefined) {
        return rejected('rejected_precondition', 'catalog-entry-missing', `secretId ${secretId} 未登记（装配期按配置缺失处置，不进运行期补）`)
      }
      if (isRevokedChain(secretId)) {
        return rejected('rejected_authority', 'catalog-revoked', `secretId ${secretId} 或祖先已撤回——不产出可用句柄（NEG-SEC-08）`)
      }
      const seconds: unknown = typeof window === 'object' && window !== null ? (window as unknown as { seconds?: unknown }).seconds : undefined
      if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 1) {
        return rejected('rejected_precondition', 'catalog-window-invalid', '短时窗口须为 ≥1 的整数秒（上限不是预算，不得以 0/NaN 触发不过期）')
      }
      const now = clock()
      const fromMs = Date.parse(entry.validWindow.from)
      const toMs = Date.parse(entry.validWindow.to)
      if (now >= toMs) {
        return rejected('rejected_authority', 'catalog-expired', `secretId ${secretId} 有效期已过（凭据不可用；续期须新登记/轮换）`)
      }
      if (now < fromMs) {
        return rejected('rejected_authority', 'catalog-expired', `secretId ${secretId} 有效期未开始（不得预支凭据）`)
      }
      const expiresAtMs = now + seconds * 1000
      if (expiresAtMs > toMs) {
        return rejected('rejected_precondition', 'catalog-window-invalid', `短时窗口 ${seconds}s 超出凭据有效期（${entry.validWindow.to}）——短时供给只收紧不放宽`)
      }
      const credential: CredentialRef = {
        credentialId: entry.logicalReference,
        credentialClass: entry.credentialClass,
        scope: entry.permittedOperations,
        ttl: { seconds },
      }
      const handle: ShortLivedHandle = {
        handleId: nextHandleId(),
        credential,
        issuedAt: iso(now),
        expiresAt: iso(expiresAtMs),
        singleUse: true,
      }
      return { kind: 'ok', value: handle }
    },

    revoke(secretId: string, proof: RevocationProof): PortResult<RevocationReceipt> {
      if (typeof secretId !== 'string' || secretId === '') {
        return rejected('rejected_precondition', 'catalog-entry-invalid', 'revoke 须给非空 secretId')
      }
      if (!entries.has(secretId)) {
        return rejected('rejected_precondition', 'catalog-entry-missing', `secretId ${secretId} 未登记（吊销不存在的引用不是「已停用」）`)
      }
      const known = descendantsOf(secretId)
      const readProof = readRevocationProof(proof, known)
      if (!readProof.ok) return { kind: 'err', error: readProof.error }
      const { recordId, evidenceRefs } = readProof.value

      // 三动作齐＋枚举全：逐项置为已吊销（自身＋已知后代；幂等——重复吊销不改状态）
      revokedIds.add(secretId)
      for (const id of known) revokedIds.add(id)
      const receipt: RevocationReceipt = deepFreeze({
        recordId,
        revoked: [secretId, ...known],
        injectionStopped: true,
        fenceRejectionRecorded: true,
        evidenceRefs: [...evidenceRefs],
        reconciliation: reconcileRevocation(allViews(), secretId),
      })
      return { kind: 'ok', value: receipt }
    },
  }
}
