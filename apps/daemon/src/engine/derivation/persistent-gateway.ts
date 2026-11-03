/**
 * derivation/persistent-gateway —— 派生登记网关的持久包装（GAP-V2-04 S6）
 *
 * 依据（实现单引用设计文档章节号——AGENTS §五.1）：
 *   - docs/v2/07 §四「派生即登记」：登记是证据/判定面，必须跨进程可重建；
 *   - docs/17-§2（派发前判定）／§6（撤回完成须以证据面收口）；
 *   - docs/v2/16 §三 store 行：append-only 投影＋启动重建；跨进程互斥不新增事实源，
 *     沿用 202-P4 `openLedgerWriter` 写者租约（daemon 持 ledger 句柄，本件不另开库/不另建锁）。
 *
 * 写入序（fail-closed 方向）：
 *   1. 先由内存网关做形状/父链/目录/撤回面判定（唯一判据在 `derivation-gateway.ts`）；
 *   2. 通过后才追加 store 行；追加失败不静默吞——登记/撤回回执带 failure，派发侧不 spawn。
 *   3. 启动重建只回放「已登记＋已撤回」事实；凭据目录先按逻辑引用重建，再恢复吊销状态。
 *
 * 边界（如实登记）：
 *   - 本件不拥有目录/网关判定规则，不复制拒绝码；只做投影与回放。
 *   - 不存凭据值：catalog 行是 `CatalogEntryDraft`（逻辑引用/值提供者描述）。
 */
import type { PortResult } from '@studio-next/contract'
import {
  createCredentialCatalog,
  createDerivationGateway,
  reconcileRevocation,
  type CatalogEntryDraft,
  type CredentialCatalog,
  type CredentialReferenceRow,
  type DerivationDeactivationEvidence,
  type DerivationGateway,
  type DerivationRecord,
  type DerivationRevocationReceipt,
  type RevocationProof,
} from '@studio-next/gateway'
import type { Ledger } from '@studio-next/store'
import { createDerivationLedger, type DerivationLedgerFace, type DerivationRegistrationRow } from '@studio-next/store'

export interface PersistentDerivationOptions {
  readonly ledger: Ledger
  readonly clock: () => number
  /** 目录注入（测试/装配单元可给已登记目录；缺省新建内存目录） */
  readonly catalog?: CredentialCatalog
}

/** 持久派生面：网关本体＋账本＋启动重建摘要 */
export interface PersistentDerivationFace {
  readonly gateway: DerivationGateway
  readonly ledger: DerivationLedgerFace
  /** 持久登记（先内存判定，通过后 append store；同 id 同内容幂等） */
  register(record: DerivationRecord): PortResult<DerivationRecord>
  /** 持久登记凭据目录逻辑引用（无值；通过目录形状闸后落账） */
  registerCredential(draft: CatalogEntryDraft): PortResult<CredentialReferenceRow>
  /** 撤回传播（先内存判定/传播，通过后把凭据与派生闭包写入撤回账） */
  revoke(
    secretId: string,
    proof: RevocationProof,
    deactivationEvidence?: readonly DerivationDeactivationEvidence[],
  ): PortResult<DerivationRevocationReceipt>
  /** 启动重建摘要（诊断/证据锚；不参与判定） */
  readonly rebuild: {
    readonly catalogEntries: number
    readonly registeredDerivations: number
    readonly revokedCredentials: number
    readonly revokedDerivations: number
  }
}

function rowOf(record: DerivationRecord, registeredAt: number): DerivationRegistrationRow {
  return {
    derivationId: record.derivationId,
    ...(record.parentDerivationId !== undefined ? { parentDerivationId: record.parentDerivationId } : {}),
    ticket: record.ticket,
    executor: record.executor,
    ...(record.executorName !== undefined ? { executorName: record.executorName } : {}),
    backend: record.backend,
    capabilitySubset: record.capabilitySubset,
    credentials: record.credentials,
    ...(record.inheritance !== undefined ? { inheritance: record.inheritance } : {}),
    derivedAt: record.derivedAt,
    registeredAt,
  }
}

function recordOf(row: DerivationRegistrationRow): DerivationRecord {
  return {
    derivationId: row.derivationId,
    ...(row.parentDerivationId !== undefined ? { parentDerivationId: row.parentDerivationId } : {}),
    ticket: row.ticket,
    executor: row.executor,
    ...(row.executorName !== undefined ? { executorName: row.executorName } : {}),
    backend: row.backend as DerivationRecord['backend'],
    capabilitySubset: row.capabilitySubset,
    credentials: row.credentials as DerivationRecord['credentials'],
    ...(row.inheritance !== undefined ? { inheritance: row.inheritance as NonNullable<DerivationRecord['inheritance']> } : {}),
    derivedAt: row.derivedAt,
  }
}

/** 同 id 幂等比较（同内容＝重放；异内容＝拒——append-only 语义） */
function sameDerivation(a: DerivationRecord, b: DerivationRecord): boolean {
  return (
    a.derivationId === b.derivationId &&
    a.parentDerivationId === b.parentDerivationId &&
    a.ticket === b.ticket &&
    a.executor === b.executor &&
    a.executorName === b.executorName &&
    a.backend === b.backend &&
    a.capabilitySubset === b.capabilitySubset &&
    JSON.stringify(a.credentials) === JSON.stringify(b.credentials) &&
    JSON.stringify(a.inheritance) === JSON.stringify(b.inheritance)
    // derivedAt 是首次登记时点（历史事实）；同 attempt 重派/崩溃恢复沿用首条，不因新时钟改写
  )
}

function startupInvalid(detail: string): Error {
  return new Error(`CONFIG_INVALID：派生登记账本重建失败——${detail}（fail-closed：不静默丢弃历史撤回面）`)
}

/**
 * 建持久派生面：重建目录引用→恢复凭据吊销→回放登记→恢复派生撤回。
 * 任一步失败即抛（装配期 fail-closed，不静默关闸——任务书 §2-1）。
 */
export function createPersistentDerivation(options: PersistentDerivationOptions): PersistentDerivationFace {
  const ledger = createDerivationLedger(options.ledger.db)
  const catalog = options.catalog ?? createCredentialCatalog({ clock: options.clock })

  const catalogRows = ledger.listCatalog()
  for (const row of catalogRows) {
    const registered = catalog.register(row.draft as unknown as CatalogEntryDraft)
    if (registered.kind !== 'ok') {
      throw startupInvalid(`凭据引用 ${row.secretId} 重建被拒：${registered.error.subcause} ${registered.error.detail ?? ''}`)
    }
  }
  const gateway = createDerivationGateway({ catalog })
  const registrationRows = ledger.listRegistrations()
  // 先回放历史登记（当时凭据仍 active），再恢复吊销/撤回位——顺序反了会把历史事实误判为
  // 「给已失效凭据登记新持有者」（v2/07 §四规则 1 的登记时点语义）。
  for (const row of registrationRows) {
    const registered = gateway.register(recordOf(row))
    if (registered.kind !== 'ok') {
      throw startupInvalid(`派生 ${row.derivationId} 回放被拒：${registered.error.subcause} ${registered.error.detail ?? ''}`)
    }
  }
  catalog.restoreRevoked(ledger.revokedCredentialIds())
  const revokedDerivations = ledger.revokedDerivationIds()
  gateway.restoreRevoked(revokedDerivations)

  const persistRegistration = (record: DerivationRecord): PortResult<DerivationRecord> => {
    try {
      ledger.appendRegistration(rowOf(record, options.clock()))
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return {
        kind: 'err',
        error: {
          category: 'unavailable',
          subcause: 'derivation/persistence-failed',
          detail: `派生 ${record.derivationId} 内存登记成功但账本追加失败：${detail}（不 spawn；重启前须人工对账）`,
          retryable: false,
          sideEffectPossible: true,
          reconcile: { required: true, query: { recordType: 'REC-AUTH-03', keys: { derivation: record.derivationId } } },
          responsiblePosition: 'daemon',
        },
      }
    }
    return { kind: 'ok', value: record }
  }

  return {
    gateway,
    ledger,
    rebuild: {
      catalogEntries: catalogRows.length,
      registeredDerivations: registrationRows.length,
      revokedCredentials: ledger.revokedCredentialIds().length,
      revokedDerivations: revokedDerivations.length,
    },

    register(record: DerivationRecord): PortResult<DerivationRecord> {
      const existing = gateway.records().find((item) => item.derivationId === record.derivationId)
      if (existing !== undefined) {
        if (sameDerivation(existing, record)) return { kind: 'ok', value: existing }
        return {
          kind: 'err',
          error: {
            category: 'rejected_state',
            subcause: 'derivation/id-duplicate',
            detail: `派生 ${record.derivationId} 已登记且内容不同（同 attempt 同 executor 只登记一次；轮换不换 id 须先撤回）`,
            retryable: false,
            sideEffectPossible: false,
            reconcile: { required: false, reason: '登记幂等面' },
            responsiblePosition: 'daemon',
          },
        }
      }
      const result = gateway.register(record)
      if (result.kind !== 'ok') return result
      return persistRegistration(result.value)
    },

    registerCredential(draft: CatalogEntryDraft): PortResult<CredentialReferenceRow> {
      const result = catalog.register(draft)
      if (result.kind !== 'ok') return result
      try {
        ledger.appendCatalog({ secretId: draft.secretId, draft: draft as unknown as Record<string, unknown>, registeredAt: options.clock() })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        return {
          kind: 'err',
          error: {
            category: 'unavailable',
            subcause: 'derivation/persistence-failed',
            detail: `凭据引用 ${draft.secretId} 目录登记成功但账本追加失败：${detail}`,
            retryable: false,
            sideEffectPossible: true,
            reconcile: { required: true, query: { recordType: 'REC-AUTH-04', keys: { secret: draft.secretId } } },
            responsiblePosition: 'daemon',
          },
        }
      }
      return result
    },

    revoke(
      secretId: string,
      proof: RevocationProof,
      deactivationEvidence?: readonly DerivationDeactivationEvidence[],
    ): PortResult<DerivationRevocationReceipt> {
      const result = gateway.revoke(secretId, proof, deactivationEvidence)
      if (result.kind !== 'ok') return result
      const receipt = result.value
      const evidenceFor = (derivationId: string): string => {
        const direct = receipt.deactivationEvidence.find((item) => item.derivationId === derivationId)
        if (direct !== undefined) return direct.evidenceRef
        return receipt.deactivationEvidence[0]?.evidenceRef ?? receipt.catalogReceipt.evidenceRefs[0] ?? receipt.recordId
      }
      const rows = [
        ...receipt.revokedCredentials.map((targetId) => ({
          scope: 'credential' as const,
          targetId,
          recordId: receipt.recordId,
          evidenceRef: receipt.catalogReceipt.evidenceRefs[0] ?? receipt.recordId,
          revokedAt: options.clock(),
        })),
        ...receipt.revokedDerivations.map((record) => ({
          scope: 'derivation' as const,
          targetId: record.derivationId,
          recordId: receipt.recordId,
          evidenceRef: evidenceFor(record.derivationId),
          revokedAt: options.clock(),
        })),
      ]
      try {
        ledger.appendRevocations(rows)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        return {
          kind: 'err',
          error: {
            category: 'unavailable',
            subcause: 'derivation/persistence-failed',
            detail: `撤回 ${secretId} 内存传播成功但撤回账追加失败：${detail}（不得记撤回完成）`,
            retryable: false,
            sideEffectPossible: true,
            reconcile: { required: true, query: { recordType: 'REC-AUTH-03', keys: { credential: secretId } } },
            responsiblePosition: 'daemon',
          },
        }
      }
      return result
    },
  }
}

/** 供撤回面构造后代清单（目录父链枚举；只读纯函数，不新增判据） */
export function catalogDescendants(catalog: CredentialCatalog, secretId: string): readonly string[] {
  return reconcileRevocation(catalog.entryViews(), secretId).descendants
}
