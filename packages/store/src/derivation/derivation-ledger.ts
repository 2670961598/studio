/**
 * derivation-ledger —— 派生树登记账本持久面（GAP-V2-04 S6；append-only 写口）
 *
 * 依据（实现单引用设计文档章节号——AGENTS §五.1）：
 *   - docs/v2/07 §四「派生即登记」：父引用/后端形态/能力子集/凭据类别＋逻辑引用/时点必须可审计；
 *     登记账本＝执行体派生树的持久投影，**不是**凭据事实源（目录仍是唯一状态面）。
 *   - docs/v2/11 §2.2 REC-AUTH-03/REC-AUTH-04（后代清单/逻辑引用无值）；docs/v2/15 §六
 *     SEC-REV-01（逐后代停用证据）；docs/17-§2（派发前判定）／§6（撤回完成须以证据面收口）。
 *   - docs/v2/16 §三 store 行：append-only 由触发器机制保证（v16 三表，UPDATE/DELETE 拒）。
 *
 * 边界：
 *   - 零凭据值：catalog 行存 `CatalogEntryDraft` 的逻辑引用；本面不做取值/供给。
 *   - 零时钟读取：`registeredAt`/`revokedAt` 由调用方注入，测试可复现。
 *   - 同 id 幂等：登记/catalog 行同 id 同内容＝跳过；同 id 异内容＝CONFIG_INVALID（append-only
 *     拒覆盖语义，events/probes 同款）。撤回行同 (scope,target,record) 幂等。
 *   - 跨进程互斥不新增：本面只使用调用方持有的 `Ledger.db`（daemon 经 `openLedgerWriter` 的
 *     202-P4 写者租约；本面不自行开库/不建新锁）。
 */
import type { DatabaseSync } from 'node:sqlite'
import { configInvalid } from '@studio-next/contract'
import { optStr, str, type SqlRow } from '../row-helpers.ts'

/** 派生登记行（与 gateway `DerivationRecord` 同形；store 不 import gateway，按 JSON 原样存取） */
export interface DerivationRegistrationRow {
  readonly derivationId: string
  readonly parentDerivationId?: string
  readonly ticket: string
  readonly executor: string
  readonly executorName?: string
  readonly backend: string
  readonly capabilitySubset: string
  readonly credentials: readonly unknown[]
  readonly inheritance?: unknown
  readonly derivedAt: string
  readonly registeredAt: number
}

/** 凭据目录逻辑引用行（CatalogEntryDraft 原样 JSON；值/路径不入库） */
export interface DerivationCatalogRow {
  readonly secretId: string
  readonly draft: Readonly<Record<string, unknown>>
  readonly registeredAt: number
}

/** 撤回传播行（scope=credential|derivation；同目标同 record 幂等） */
export interface DerivationRevocationRow {
  readonly scope: 'credential' | 'derivation'
  readonly targetId: string
  readonly recordId: string
  readonly evidenceRef: string
  readonly revokedAt: number
}

/** 追加结果：appended=false＝同 id 同内容重放（幂等跳过） */
export interface DerivationAppendResult {
  readonly id: string
  readonly appended: boolean
}

/** 派生账本写/读面（createDerivationLedger 返回；单句柄＝同库同租约） */
export interface DerivationLedgerFace {
  appendRegistration(row: DerivationRegistrationRow): DerivationAppendResult
  listRegistrations(): readonly DerivationRegistrationRow[]
  appendCatalog(row: DerivationCatalogRow): DerivationAppendResult
  listCatalog(): readonly DerivationCatalogRow[]
  /** 批量追加撤回行（单事务；同键幂等跳过）；返回实际新增行数 */
  appendRevocations(rows: readonly DerivationRevocationRow[]): number
  listRevocations(): readonly DerivationRevocationRow[]
  /** 已撤回的派生执行体 id（稳定序） */
  revokedDerivationIds(): readonly string[]
  /** 已撤回的凭据 secretId（稳定序） */
  revokedCredentialIds(): readonly string[]
}

const INSERT_REGISTRATION =
  'INSERT INTO derivation_registry (derivation_id, parent_derivation_id, ticket, executor, executor_name, backend, capability_subset, credentials, inheritance, derived_at, registered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
const INSERT_CATALOG =
  'INSERT INTO derivation_catalog (secret_id, draft, registered_at) VALUES (?, ?, ?)'
const INSERT_REVOCATION =
  'INSERT OR IGNORE INTO derivation_revocation (scope, target_id, record_id, evidence_ref, revoked_at) VALUES (?, ?, ?, ?, ?)'

/** 非空字符串闸（同 store 其它面口径：坏行=调用方 bug，CONFIG_INVALID 明报） */
function required(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    configInvalid('store/derivation:invalid', `${field} 须为非空字符串`)
  }
  return value
}

function jsonOf(value: unknown, field: string): string {
  try {
    return JSON.stringify(value)
  } catch {
    configInvalid('store/derivation:invalid', `${field} 不可 JSON 序列化`)
  }
}

function parseJson(text: string, field: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    configInvalid('store/derivation:corrupt', `${field} 不是合法 JSON（append-only 账本坏行即拒读）`)
  }
}

function rowToRegistration(row: SqlRow): DerivationRegistrationRow {
  const parent = optStr(row, 'parent_derivation_id')
  const executorName = optStr(row, 'executor_name')
  const inheritance = optStr(row, 'inheritance')
  const credentials = parseJson(str(row, 'credentials'), 'derivation_registry.credentials')
  if (!Array.isArray(credentials)) configInvalid('store/derivation:corrupt', 'derivation_registry.credentials 须为数组')
  return {
    derivationId: str(row, 'derivation_id'),
    ...(parent !== undefined ? { parentDerivationId: parent } : {}),
    ticket: str(row, 'ticket'),
    executor: str(row, 'executor'),
    ...(executorName !== undefined ? { executorName } : {}),
    backend: str(row, 'backend'),
    capabilitySubset: str(row, 'capability_subset'),
    credentials,
    ...(inheritance !== undefined ? { inheritance: parseJson(inheritance, 'derivation_registry.inheritance') } : {}),
    derivedAt: str(row, 'derived_at'),
    registeredAt: Number(row['registered_at']),
  }
}

function rowToCatalog(row: SqlRow): DerivationCatalogRow {
  const draft = parseJson(str(row, 'draft'), 'derivation_catalog.draft')
  if (typeof draft !== 'object' || draft === null || Array.isArray(draft)) {
    configInvalid('store/derivation:corrupt', 'derivation_catalog.draft 须为对象')
  }
  return {
    secretId: str(row, 'secret_id'),
    draft: draft as Record<string, unknown>,
    registeredAt: Number(row['registered_at']),
  }
}

function rowToRevocation(row: SqlRow): DerivationRevocationRow {
  const scope = str(row, 'scope')
  if (scope !== 'credential' && scope !== 'derivation') {
    configInvalid('store/derivation:corrupt', `derivation_revocation.scope=${scope} 枚举外`)
  }
  return {
    scope,
    targetId: str(row, 'target_id'),
    recordId: str(row, 'record_id'),
    evidenceRef: str(row, 'evidence_ref'),
    revokedAt: Number(row['revoked_at']),
  }
}

/** 建账本面（调用方须持 ledger 写者租约；本面不取锁） */
export function createDerivationLedger(db: DatabaseSync): DerivationLedgerFace {
  const appendRegistration = (row: DerivationRegistrationRow): DerivationAppendResult => {
    const derivationId = required(row.derivationId, 'derivationId')
    required(row.ticket, 'ticket')
    required(row.executor, 'executor')
    required(row.backend, 'backend')
    required(row.capabilitySubset, 'capabilitySubset')
    required(row.derivedAt, 'derivedAt')
    if (!Number.isFinite(row.registeredAt)) configInvalid('store/derivation:invalid', 'registeredAt 须为有限数字')
    const existing = db.prepare('SELECT * FROM derivation_registry WHERE derivation_id = ?').get(derivationId) as SqlRow | undefined
    const payload = [
      row.parentDerivationId ?? null,
      row.ticket,
      row.executor,
      row.executorName ?? null,
      row.backend,
      row.capabilitySubset,
      jsonOf(row.credentials, 'credentials'),
      row.inheritance === undefined ? null : jsonOf(row.inheritance, 'inheritance'),
      row.derivedAt,
      row.registeredAt,
    ]
    if (existing !== undefined) {
      const same =
        optStr(existing, 'parent_derivation_id') === (row.parentDerivationId ?? undefined) &&
        str(existing, 'ticket') === row.ticket &&
        str(existing, 'executor') === row.executor &&
        optStr(existing, 'executor_name') === (row.executorName ?? undefined) &&
        str(existing, 'backend') === row.backend &&
        str(existing, 'capability_subset') === row.capabilitySubset &&
        str(existing, 'credentials') === jsonOf(row.credentials, 'credentials') &&
        optStr(existing, 'inheritance') === (row.inheritance === undefined ? undefined : jsonOf(row.inheritance, 'inheritance')) &&
        str(existing, 'derived_at') === row.derivedAt
      if (same) return { id: derivationId, appended: false }
      configInvalid('store/derivation:id-conflict', `派生 ${derivationId} 已登记且内容不一致（append-only 拒覆盖；轮换不换 id 的登记须先撤回再新登记）`)
    }
    db.prepare(INSERT_REGISTRATION).run(derivationId, ...payload)
    return { id: derivationId, appended: true }
  }

  const listRegistrations = (): readonly DerivationRegistrationRow[] =>
    (db.prepare('SELECT * FROM derivation_registry ORDER BY seq ASC').all() as SqlRow[]).map(rowToRegistration)

  const appendCatalog = (row: DerivationCatalogRow): DerivationAppendResult => {
    const secretId = required(row.secretId, 'secretId')
    if (!Number.isFinite(row.registeredAt)) configInvalid('store/derivation:invalid', 'registeredAt 须为有限数字')
    const draftJson = jsonOf(row.draft, 'draft')
    const existing = db.prepare('SELECT * FROM derivation_catalog WHERE secret_id = ?').get(secretId) as SqlRow | undefined
    if (existing !== undefined) {
      if (str(existing, 'draft') === draftJson) return { id: secretId, appended: false }
      configInvalid('store/derivation:id-conflict', `凭据引用 ${secretId} 已登记且内容不一致（append-only 拒覆盖；轮换须新 secretId）`)
    }
    db.prepare(INSERT_CATALOG).run(secretId, draftJson, row.registeredAt)
    return { id: secretId, appended: true }
  }

  const listCatalog = (): readonly DerivationCatalogRow[] =>
    (db.prepare('SELECT * FROM derivation_catalog ORDER BY seq ASC').all() as SqlRow[]).map(rowToCatalog)

  const appendRevocations = (rows: readonly DerivationRevocationRow[]): number => {
    if (rows.length === 0) return 0
    db.exec('BEGIN')
    let added = 0
    try {
      for (const row of rows) {
        if (row.scope !== 'credential' && row.scope !== 'derivation') {
          configInvalid('store/derivation:invalid', `revocation.scope=${String(row.scope)} 枚举外`)
        }
        required(row.targetId, 'targetId')
        required(row.recordId, 'recordId')
        required(row.evidenceRef, 'evidenceRef')
        if (!Number.isFinite(row.revokedAt)) configInvalid('store/derivation:invalid', 'revokedAt 须为有限数字')
        const result = db.prepare(INSERT_REVOCATION).run(row.scope, row.targetId, row.recordId, row.evidenceRef, row.revokedAt)
        added += Number(result.changes)
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    return added
  }

  const listRevocations = (): readonly DerivationRevocationRow[] =>
    (db.prepare('SELECT * FROM derivation_revocation ORDER BY seq ASC').all() as SqlRow[]).map(rowToRevocation)

  return {
    appendRegistration,
    listRegistrations,
    appendCatalog,
    listCatalog,
    appendRevocations,
    listRevocations,
    revokedDerivationIds: (): readonly string[] =>
      [...new Set(listRevocations().filter((row) => row.scope === 'derivation').map((row) => row.targetId))].sort(),
    revokedCredentialIds: (): readonly string[] =>
      [...new Set(listRevocations().filter((row) => row.scope === 'credential').map((row) => row.targetId))].sort(),
  }
}
