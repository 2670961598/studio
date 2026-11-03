/**
 * derivation-shape —— 派生登记/撤回面的形状闸与索引小件（GAP-V2-04 S6 拆件）
 *
 * 依据：docs/v2/07 §四「派生即登记」三规则（父引用/后端/能力子集/凭据类别＋逻辑引用/时点）、
 *   SEC-ROOT-03（子执行体不得持 root key）、docs/v2/11 §2.2 REC-AUTH-04（凭据只记逻辑引用）；
 *   docs/20-§十五.三（文件 >600 行必须拆——`derivation-gateway.ts` 已 600/600，S6 增面先拆件）。
 *
 * 边界：纯形状/索引函数，零 IO、零时钟、零状态；拒绝码与 `derivation-gateway.ts` 同族
 * （`derivation/invalid` 等），本文件不新增码、不复制目录判据。
 */
import type { CredentialCategory, FailureCategory, PortFailure, PortResult } from '@studio-next/contract'
import { deepFreeze } from './catalog-entry.ts'
import type { CatalogEntryView } from './catalog.ts'

/** 派生执行体稳定 id 形状（字母/数字起；无空白） */
export const DERIVATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/

/** 带偏移的 ISO 时刻（派生即登记须有时点；无偏移本地时间拒收） */
export const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/

/** 后代持有凭据（逻辑引用；值永不入本件——v2/15 §4.5 三不入） */
export interface DerivationCredentialRef {
  /** 目录中的凭据逻辑 id（`SEC-<域>-<slug>`；与 REC-AUTH-04 同一引用面） */
  readonly secretId: string
  /** 凭据类别（ENU-136：root|scoped；派生执行体只准 scoped——SEC-ROOT-03） */
  readonly credentialClass: CredentialCategory
  /** 逻辑引用（非值非路径；须与目录登记逐字一致，防登记面与目录面漂移） */
  readonly logicalReference: string
}

export function failure(category: FailureCategory, subcause: string, detail: string): PortFailure {
  return {
    category,
    subcause,
    detail,
    retryable: false,
    sideEffectPossible: false,
    reconcile: { required: false, reason: '派生登记为内存账本；状态判定无外部副作用' },
    responsiblePosition: 'daemon',
  }
}

export function reject<T>(category: FailureCategory, subcause: string, detail: string): PortResult<T> {
  return { kind: 'err', error: failure(category, subcause, detail) }
}

export function accept<T>(value: T): PortResult<T> {
  return { kind: 'ok', value }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 非空、无首尾空白、无内部空白的标识文本（拒绝用空白冒充已登记） */
export function readText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (value === '' || value !== value.trim() || /\s/.test(value)) return undefined
  return value
}

export function readIso(value: unknown): string | undefined {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return undefined
  return Number.isFinite(Date.parse(value)) ? value : undefined
}

/** 目录视图索引（secretId → 视图；目录是凭据状态的唯一算面） */
export function viewMapOf(views: readonly CatalogEntryView[]): ReadonlyMap<string, CatalogEntryView> {
  return new Map(views.map((view) => [view.secretId, view] as const))
}

/** secretId 的父链是否经过给定祖先集（含自身；父链断/环＝不在面内，fail-closed） */
export function withinAncestorClosure(
  views: ReadonlyMap<string, CatalogEntryView>,
  secretId: string,
  ancestors: ReadonlySet<string>,
): boolean {
  let cursor: string | undefined = secretId
  const seen = new Set<string>()
  while (cursor !== undefined) {
    if (seen.has(cursor)) return false
    seen.add(cursor)
    if (ancestors.has(cursor)) return true
    cursor = views.get(cursor)?.parentCredentialRef
  }
  return false
}

/** 读一个后代持有凭据（只收引用侧；未知键/值形态不经本件解释） */
export function readCredential(raw: unknown): PortResult<DerivationCredentialRef> {
  if (!isRecord(raw)) {
    return reject('rejected_precondition', 'derivation/invalid', 'credentials[] 项须为对象 {secretId,credentialClass,logicalReference}')
  }
  const allowed = ['secretId', 'credentialClass', 'logicalReference']
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      return reject('rejected_precondition', 'derivation/invalid', `credentials[] 出现未声明字段 \`${key}\`（只收引用侧；值/路径不入登记）`)
    }
  }
  const secretId = readText(raw['secretId'])
  const logicalReference = readText(raw['logicalReference'])
  const credentialClass = raw['credentialClass']
  if (secretId === undefined || logicalReference === undefined) {
    return reject('rejected_precondition', 'derivation/invalid', 'credentials[].secretId/logicalReference 须为非空引用（空白视为未登记）')
  }
  if (credentialClass !== 'root' && credentialClass !== 'scoped') {
    return reject('rejected_precondition', 'derivation/invalid', 'credentials[].credentialClass 须为 ENU-136 的 root|scoped')
  }
  return accept(deepFreeze({ secretId, credentialClass, logicalReference }))
}
