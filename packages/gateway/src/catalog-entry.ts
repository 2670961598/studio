/**
 * catalog-entry —— 凭据目录**条目形状与形状闸**（含 `NEG-SEC-08` 前腿的撤回对账器）
 *
 * 依据（同 `./catalog.ts` 头注，本件为同域拆件——20-§十五.三「>600 行必须拆；先拆再增」）：
 *   - docs/plan/05 IMPL-07-12「秘密 catalog＋bot 密码收敛」；
 *   - docs/v2/15 §4.1 SEC-T1..T5 五型分类与「类别＋逻辑引用」纪律、§4.3 吊销三动作、§4.5 三不入；
 *   - docs/v2/11 §2.2 `REC-AUTH-04` 凭据逻辑引用（字段名逐项同名，无值位）；
 *   - docs/v2/17 §4.1 `NEG-SEC-08`（「对账差异非空即判负」——`reconcileRevocation` 即该前腿）。
 *
 * 边界：
 *   1. **零 IO、零值**：本件只读入参、只产形状与拒绝码；不读 env/文件/网络/时钟（`now` 由调用方
 *      显式传入）。任何未知键/值形态字段/路径一律拒（`catalog-value-rejected`）——目录不是值的
 *      第二存放处（80-§6.2 `TS-PORT-AUTH-06`）。
 *   2. **依赖方向**：本件不 import `./catalog.ts`（条目形状是更低层）；`catalog.ts` 反向消费本件。
 *   3. **不复制记录类**：行形状唯一源＝v2/11 §2.2 / contract `records/auth.ts`；本件只产同名
 *      payload 视图（缺口同 `root-delegation.ts` 已登记），由 `catalog.test.ts` 用 contract schema 核对。
 */
import type {
  CredentialCategory,
  FailureCategory,
  PortFailure,
  PortResult,
  SecretType,
} from '@studio-next/contract'

// ————————————————————————— 值集投影与拒绝码 —————————————————————————

/** 五型运行时投影（值集唯一主表 v2/09 ENU-117，本体=contract `SecretType`；本件不新立值集） */
const SECRET_TYPES: ReadonlySet<string> = new Set<SecretType>([
  'platform_credential',
  'model_key',
  'signing_root_control',
  'per_task_shortlived',
  'external_outbound',
])

/** 凭据类别运行时投影（值集唯一主表 v2/09 ENU-136） */
const CREDENTIAL_CATEGORIES: ReadonlySet<string> = new Set<CredentialCategory>(['root', 'scoped'])

/**
 * 目录拒绝码（`catalog-*` 纯码族；一码对一条拒绝判据，测试按码断言「放行路径不存在」）：
 *   - `catalog-entry-invalid`            登记底稿形状/必填/未知键不符（含未声明字段）
 *   - `catalog-value-rejected`           检测到值/路径/可逆材料（目录不得成为值的第二存放处）
 *   - `catalog-entry-duplicate`          同 `secretId` 重复登记（轮换不换 id，但登记唯一）
 *   - `catalog-entry-missing`            未登记（`resolve` 用 `Ok(undefined)`，不套用本码）
 *   - `catalog-parent-unknown`           父凭据引用未登记（父链断，不猜）
 *   - `catalog-parent-revoked`           父链已撤回（不得给已撤权的后代签新凭据）
 *   - `catalog-revoked`                  自身或祖先已撤回（供给路径不存在）
 *   - `catalog-expired`                  凭据有效期已过/未开始（不预支、不复用）
 *   - `catalog-window-invalid`           短时窗口非法/超出凭据有效期
 *   - `catalog-proof-missing`            吊销三动作证据不齐（不得记吊销完成）
 *   - `catalog-no-descendant-confirmation` 无后代时缺显式确认方法（不得留空视为零）
 *   - `catalog-descendants-incomplete`   后代枚举缺项（差异非空即判负——NEG-SEC-08 前腿）
 *   - `catalog-descendants-unknown`      后代枚举出现目录外引用（不猜、不静默接受）
 */
export type CatalogRejectReason =
  | 'catalog-entry-invalid'
  | 'catalog-value-rejected'
  | 'catalog-entry-duplicate'
  | 'catalog-entry-missing'
  | 'catalog-parent-unknown'
  | 'catalog-parent-revoked'
  | 'catalog-revoked'
  | 'catalog-expired'
  | 'catalog-window-invalid'
  | 'catalog-proof-missing'
  | 'catalog-no-descendant-confirmation'
  | 'catalog-descendants-incomplete'
  | 'catalog-descendants-unknown'

// ————————————————————————— 条目形状（只有引用侧，无值位） —————————————————————————

/**
 * 取值通道四型（78-§7.4.1 判别联合：不是字符串前缀；`file-ref` 只带逻辑 id，不带路径）。
 * `local-mint` 是按单 wkey 的网关签发通道——per-ticket wkey 本身**不进 catalog**（78-§7.4.1），
 * 本件不为它造条目；四型原样照录，不删值集成员。
 */
export type ValueProviderRef =
  | { readonly type: 'env-ref'; readonly name: string }
  | { readonly type: 'file-ref'; readonly secretId: string }
  | { readonly type: 'broker-ref'; readonly secretId: string; readonly profile?: string }
  | { readonly type: 'local-mint'; readonly ticketId: string }

/** 逻辑引用（记录引用＝ID＋版本；「当前最新」不是引用，v2/11 §0.4-1/2） */
export interface GrantRefView {
  readonly recordId: string
  readonly refVersion: string
}

/**
 * 登记底稿：只允许引用侧字段。`value`/`material`/`password` 等任何未知键一律拒
 * （`catalog-value-rejected`）——**目录里没有值位不是靠自律，是靠形状闸**。
 */
export interface CatalogEntryDraft {
  readonly secretId: string
  readonly secretType: SecretType
  readonly credentialClass: CredentialCategory
  /** 逻辑引用：非路径、非值（如 `cred-root@company`） */
  readonly logicalReference: string
  /** 绑定授予（root 类须为 `REC-AUTH-01` 根授予记录；记录面判定归 contract） */
  readonly boundGrant: GrantRefView
  /** `scoped` 必带父凭据 `secretId`（可追溯）；`root` 禁带（类别不得原地升级） */
  readonly parentCredentialRef?: string
  readonly permittedOperations: readonly [string, ...string[]]
  /** 凭据有效期区间（**不是生效窗口**；v2/11 §2.2 明文豁免） */
  readonly validWindow: { readonly from: string; readonly to: string }
  /** 知悉范围/可注入上下文/禁止去向（v1 77-§3.4 字段语义） */
  readonly exposureScope: string
  readonly valueProvider: ValueProviderRef
}

/** 目录条目（内部与审计视图同形；无值位） */
export interface CatalogEntry {
  readonly secretId: string
  readonly secretType: SecretType
  readonly credentialClass: CredentialCategory
  readonly logicalReference: string
  readonly boundGrant: GrantRefView
  readonly parentCredentialRef?: string
  readonly permittedOperations: readonly string[]
  readonly validWindow: { readonly from: string; readonly to: string }
  readonly exposureScope: string
  readonly valueProvider: ValueProviderRef
}

/** 凭据状态：本件只投影两个可达值（轮换/过期/未知由签发位置在记录面给，本件零 IO 不导入） */
export type RevocationState = 'active' | 'revoked'

/**
 * `REC-AUTH-04` 落表行（payload 视图；字段名与 v2/11 §2.2 同名、**无值位**）。
 * 由持久面（store）追加为记录；本件只产行，不落盘。
 */
export interface CredentialReferenceRow {
  readonly credential_class: CredentialCategory
  readonly logical_reference: string
  readonly bound_grant: {
    readonly refType: 'REC-AUTH-01'
    readonly refId: string
    readonly refVersion: string
  }
  readonly permitted_operations: readonly string[]
  readonly valid_window: { readonly from: string; readonly to: string }
  readonly revocation_state: RevocationState
  readonly exposure_scope: string
}

/** 审计视图（父链＋当前吊销状态；`NEG-SEC-08` 前腿对账输入） */
export interface CatalogEntryView extends CatalogEntry {
  readonly revocationState: RevocationState
}

/** 吊销证明（三动作逐项留证＋后代枚举；`SEC-REV-01` 第 1/2 条） */
export interface RevocationProof {
  readonly recordId: string
  readonly injectionStopped: boolean
  readonly fenceRejectionRecorded: boolean
  readonly evidenceRefs: readonly [string, ...string[]]
  /** 后代枚举：有后代时必须与目录父链**逐项相等**（多/少都拒，差异非空即判负） */
  readonly descendants?: readonly string[]
  /** 无后代时的显式确认方法（REC-AUTH-03/EVD-RVK：不得留空视为零） */
  readonly noDescendantConfirmation?: { readonly probeMethod: string; readonly lastProbedAt: string }
}

/** 吊销回执（`RevocationReceipt` 同义；`reconciliation.stillUsable` 必须为空才可宣称已停用） */
export interface RevocationReceipt {
  readonly recordId: string
  readonly revoked: readonly string[]
  readonly injectionStopped: true
  readonly fenceRejectionRecorded: true
  readonly evidenceRefs: readonly string[]
  readonly reconciliation: RevocationReconciliation
}

/** 撤回后对账（`SEC-REV-01`/`NEG-SEC-08`）：`stillUsable` 非空＝判负输入 */
export interface RevocationReconciliation {
  readonly revokedRef: string
  /** 目录按父链枚举到的后代（不含自身；稳定序） */
  readonly descendants: readonly string[]
  /** 对账差异：撤回后仍未被逐项吊销的后代（非空即判负） */
  readonly stillUsable: readonly string[]
}

// ————————————————————————— 形状闸（纯函数，零 IO） —————————————————————————

/** 判别检查结果（不抛异常；失败即 `Err` 材料） */
export type Checked<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PortFailure }

const SECRET_ID_PATTERN = /^SEC-[A-Z0-9]{2,}-[A-Z0-9][A-Z0-9-]*$/
/** 逻辑引用：小写字母起、分隔符只认 `.`/`:`/`@`（不含 `/`——路径即拒） */
const LOGICAL_REFERENCE_PATTERN = /^[a-z][a-z0-9-]*(?:[.:@][a-z0-9@_-]+)*$/i
/** 值形态前缀（与 contract `CredentialReferencePayloadSchema` 同源判据；命中即当值拒收） */
const VALUE_SHAPED_PATTERN = /^(?:sk-|ghp_|xox[bp]-|Bearer\s|eyJ)/i
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const VALUE_KEY_PATTERN = /value|material|password|token|bytes|raw|inline|content/i
/** 时刻形态（与 contract `TimestampSchema` 同源：带偏移、秒必填；不接受无时区的模糊日期） */
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
const MAX_REFERENCE_LENGTH = 120
const MAX_SCOPE_LENGTH = 160
const MAX_OPERATIONS = 32

function failure(category: FailureCategory, subcause: CatalogRejectReason, detail: string): PortFailure {
  return {
    category,
    subcause,
    detail,
    retryable: false,
    sideEffectPossible: false,
    reconcile: { required: false, reason: '目录零 IO：无外部副作用，无需对账' },
    responsiblePosition: 'daemon',
  }
}

/** 目录侧拒绝通道（不抛；纯码由测试按 `category/subcause` 断言） */
export function rejected(category: FailureCategory, subcause: CatalogRejectReason, detail: string): PortResult<never> {
  return { kind: 'err', error: failure(category, subcause, detail) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 未声明键：值形态键→值拒收；其余→形状拒收（不静默忽略未知字段） */
function rejectUnknownKey(key: string, where: string): PortFailure {
  return VALUE_KEY_PATTERN.test(key)
    ? failure('rejected_forbidden', 'catalog-value-rejected', `${where} 出现值形态字段 \`${key}\`——目录不得成为值的第二存放处（80-§6.2 / v2/15 §4.5）`)
    : failure('rejected_precondition', 'catalog-entry-invalid', `${where} 出现未声明字段 \`${key}\`（只收引用侧字段）`)
}

function checkKeys(value: Record<string, unknown>, allowed: readonly string[], where: string): Checked<true> {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return { ok: false, error: rejectUnknownKey(key, where) }
  }
  return { ok: true, value: true }
}

function readNonEmptyString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text === '' || text !== value || text.length > max) return undefined
  if (/\s/.test(text)) return undefined
  return text
}

function readIso(value: unknown): { readonly text: string; readonly ms: number } | undefined {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return undefined
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? { text: value, ms } : undefined
}

function readStringArray(value: unknown, max: number): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const out: string[] = []
  for (const item of value) {
    const text = readNonEmptyString(item, max)
    if (text === undefined) return undefined
    if (!out.includes(text)) out.push(text)
  }
  return out
}

function readSecretId(value: unknown): string | undefined {
  if (typeof value !== 'string' || !SECRET_ID_PATTERN.test(value)) return undefined
  return value
}

function readProvider(value: unknown): Checked<ValueProviderRef> {
  if (!isRecord(value)) {
    return { ok: false, error: failure('rejected_precondition', 'catalog-entry-invalid', 'valueProvider 须为四型判别联合（env-ref/file-ref/broker-ref/local-mint），不是字符串前缀（78-§7.4.1）') }
  }
  const type = value['type']
  if (type === 'env-ref') {
    const keys = checkKeys(value, ['type', 'name'], 'valueProvider.env-ref')
    if (!keys.ok) return keys
    const name = readNonEmptyString(value['name'], MAX_REFERENCE_LENGTH)
    if (name === undefined || !ENV_NAME_PATTERN.test(name)) {
      return { ok: false, error: failure('rejected_precondition', 'catalog-entry-invalid', 'env-ref.name 须为环境变量名形态（大写字母/数字/下划线），不带值也不带 `=`') }
    }
    return { ok: true, value: { type: 'env-ref', name } }
  }
  if (type === 'file-ref' || type === 'broker-ref') {
    const allowed = type === 'file-ref' ? ['type', 'secretId'] : ['type', 'secretId', 'profile']
    const keys = checkKeys(value, allowed, `valueProvider.${type}`)
    if (!keys.ok) return keys
    const secretId = readSecretId(value['secretId'])
    if (secretId === undefined) {
      return { ok: false, error: failure('rejected_precondition', 'catalog-entry-invalid', `${type}.secretId 须为逻辑 id（SEC-<域>-<slug>；不得写路径/本机绝对路径）`) }
    }
    if (type === 'file-ref') return { ok: true, value: { type: 'file-ref', secretId } }
    const profileRaw = value['profile']
    if (profileRaw === undefined) return { ok: true, value: { type: 'broker-ref', secretId } }
    const profile = readNonEmptyString(profileRaw, MAX_REFERENCE_LENGTH)
    if (profile === undefined || !/^[a-z][a-z0-9-]*$/.test(profile)) {
      return { ok: false, error: failure('rejected_precondition', 'catalog-entry-invalid', 'broker-ref.profile 须为逻辑档案名（不得是路径或值）') }
    }
    return { ok: true, value: { type: 'broker-ref', secretId, profile } }
  }
  if (type === 'local-mint') {
    const keys = checkKeys(value, ['type', 'ticketId'], 'valueProvider.local-mint')
    if (!keys.ok) return keys
    const ticketId = readNonEmptyString(value['ticketId'], MAX_REFERENCE_LENGTH)
    if (ticketId === undefined) {
      return { ok: false, error: failure('rejected_precondition', 'catalog-entry-invalid', 'local-mint.ticketId 须为非空单号引用（不猜、不回落 env）') }
    }
    return { ok: true, value: { type: 'local-mint', ticketId } }
  }
  return { ok: false, error: failure('rejected_precondition', 'catalog-entry-invalid', 'valueProvider.type 只认 env-ref/file-ref/broker-ref/local-mint 四型') }
}

/** 递归冻结（条目入目录后调用方拿不到可变句柄） */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key])
    Object.freeze(value)
  }
  return value
}

// ————————————————————————— 底稿形状闸（只收引用侧字段） —————————————————————————

/** 底稿形状闸：未知键按「值形态/形状」两分拒收；形状正确才产规范条目（拷贝＋深冻结） */
export function readCatalogEntry(draft: unknown, now: number): Checked<CatalogEntry> {
  if (!isRecord(draft)) {
    return { ok: false, error: failure('rejected_precondition', 'catalog-entry-invalid', '登记底稿须为对象（引用侧字段）') }
  }
  const keys = checkKeys(draft, [
    'secretId', 'secretType', 'credentialClass', 'logicalReference', 'boundGrant',
    'parentCredentialRef', 'permittedOperations', 'validWindow', 'exposureScope', 'valueProvider',
  ], '目录条目')
  if (!keys.ok) return keys

  const secretId = readSecretId(draft['secretId'])
  if (secretId === undefined) {
    return { ok: false, error: failure('rejected_precondition', 'catalog-entry-invalid', 'secretId 须为 `SEC-<域>-<slug>` 稳定命名空间（轮换不换 id）') }
  }
  const secretTypeRaw = draft['secretType']
  if (typeof secretTypeRaw !== 'string' || !SECRET_TYPES.has(secretTypeRaw)) {
    return { ok: false, error: failure('rejected_precondition', 'catalog-entry-invalid', 'secretType 须为五型之一（ENU-117：platform_credential/model_key/signing_root_control/per_task_shortlived/external_outbound）') }
  }
  const credentialClassRaw = draft['credentialClass']
  if (typeof credentialClassRaw !== 'string' || !CREDENTIAL_CATEGORIES.has(credentialClassRaw)) {
    return { ok: false, error: failure('rejected_precondition', 'catalog-entry-invalid', 'credentialClass 须为 ENU-136 的 root|scoped') }
  }
  const credentialClass = credentialClassRaw as CredentialCategory

  const logicalReference = readNonEmptyString(draft['logicalReference'], MAX_REFERENCE_LENGTH)
  if (logicalReference === undefined || !LOGICAL_REFERENCE_PATTERN.test(logicalReference)) {
    return { ok: false, error: failure('rejected_precondition', 'catalog-entry-invalid', 'logicalReference 须为逻辑引用形态（小写字母起，分隔符只认 . : @），不含空格/路径分隔符') }
  }
  if (/[/\\]/.test(logicalReference) || VALUE_SHAPED_PATTERN.test(logicalReference)) {
    return { ok: false, error: failure('rejected_forbidden', 'catalog-value-rejected', 'logicalReference 含路径分隔符或秘密值形态（逻辑引用非路径非值——v2/11 §2.2）') }
  }

  const boundGrantRaw = draft['boundGrant']
  if (!isRecord(boundGrantRaw)) {
    return { ok: false, error: failure('rejected_precondition', 'catalog-entry-invalid', 'boundGrant 须为 {recordId, refVersion}（缺省不得当「无授予」）') }
  }
  const boundGrantKeys = checkKeys(boundGrantRaw, ['recordId', 'refVersion'], 'boundGrant')
  if (!boundGrantKeys.ok) return boundGrantKeys
  const grantRecordId = readNonEmptyString(boundGrantRaw['recordId'], MAX_REFERENCE_LENGTH)
  if (grantRecordId === undefined) {
    return { ok: false, error: failure('rejected_precondition', 'catalog-entry-invalid', 'boundGrant.recordId 须为非空记录引用') }
  }
  const grantVersion = boundGrantRaw['refVersion']
  if (typeof grantVersion !== 'string' || !SEMVER_PATTERN.test(grantVersion)) {
    return { ok: false, error: failure('rejected_precondition', 'catalog-entry-invalid', 'boundGrant.refVersion 须为 semver（「当前最新」不是引用）') }
  }

  const parentRaw = draft['parentCredentialRef']
  let parentCredentialRef: string | undefined
  if (credentialClass === 'root') {
    if (parentRaw !== undefined) {
      return { ok: false, error: failure('rejected_precondition', 'catalog-entry-invalid', 'root 凭据禁带父凭据（类别不得原地升级/降级——v2/11 §2.2）') }
    }
  } else {
    parentCredentialRef = readSecretId(parentRaw)
    if (parentCredentialRef === undefined) {
      return { ok: false, error: failure('rejected_precondition', 'catalog-entry-invalid', 'scoped 凭据必带父凭据 secretId（可追溯的父凭据——v2/11 §2.2）') }
    }
  }

  const permittedOperations = readStringArray(draft['permittedOperations'], MAX_REFERENCE_LENGTH)
  if (permittedOperations === undefined || permittedOperations.length > MAX_OPERATIONS) {
    return { ok: false, error: failure('rejected_precondition', 'catalog-entry-invalid', `permittedOperations 须为非空引用列表（≤${MAX_OPERATIONS} 项，逐项非空、无空白）`) }
  }

  const windowRaw = draft['validWindow']
  if (!isRecord(windowRaw)) {
    return { ok: false, error: failure('rejected_precondition', 'catalog-entry-invalid', 'validWindow 须为 {from, to} 区间（凭据有效期，不是生效窗口）') }
  }
  const windowKeys = checkKeys(windowRaw, ['from', 'to'], 'validWindow')
  if (!windowKeys.ok) return windowKeys
  const from = readIso(windowRaw['from'])
  const to = readIso(windowRaw['to'])
  if (from === undefined || to === undefined || to.ms <= from.ms) {
    return { ok: false, error: failure('rejected_precondition', 'catalog-window-invalid', 'validWindow 须为可解析时刻且 to > from（不补默认值）') }
  }
  if (to.ms <= now) {
    return { ok: false, error: failure('rejected_precondition', 'catalog-window-invalid', 'validWindow 已过期（拒绝登记过期凭据：登记即不可用不是「有效」）') }
  }

  const exposureScope = readNonEmptyString(draft['exposureScope'], MAX_SCOPE_LENGTH)
  if (exposureScope === undefined || /[/\\]/.test(exposureScope)) {
    return { ok: false, error: failure('rejected_precondition', 'catalog-entry-invalid', 'exposureScope 须为非空知悉范围声明（不得写路径；路径只决定读哪里、不决定能否读）') }
  }

  const provider = readProvider(draft['valueProvider'])
  if (!provider.ok) return provider

  const normalized: CatalogEntry = deepFreeze({
    secretId,
    secretType: secretTypeRaw as SecretType,
    credentialClass,
    logicalReference,
    boundGrant: { recordId: grantRecordId, refVersion: grantVersion },
    ...(parentCredentialRef !== undefined ? { parentCredentialRef } : {}),
    permittedOperations,
    validWindow: { from: from.text, to: to.text },
    exposureScope,
    valueProvider: provider.value,
  })
  return { ok: true, value: normalized }
}

// ————————————————————————— 撤回后对账（NEG-SEC-08 前腿） —————————————————————————

/**
 * 撤回后对账（`SEC-REV-01`/`NEG-SEC-08` 前腿，纯函数）：按父链枚举后代并给出
 * 「撤回后仍未被逐项吊销」的差异。**差异非空即判负**——不得以「父已撤」代替
 * 「逐后代停用＋证据」，也不得静默少撤。
 */
export function reconcileRevocation(
  views: readonly CatalogEntryView[],
  revokedRef: string,
): RevocationReconciliation {
  const children = new Map<string, string[]>()
  for (const view of views) {
    const parent: string | undefined = view.parentCredentialRef
    if (parent === undefined) continue
    const list: string[] = children.get(parent) ?? []
    list.push(view.secretId)
    children.set(parent, list)
  }
  const descendants: string[] = []
  const queue: string[] = [...(children.get(revokedRef) ?? [])]
  const seen = new Set<string>()
  while (queue.length > 0) {
    const id: string | undefined = queue.shift()
    if (id === undefined) break
    if (seen.has(id)) continue
    seen.add(id)
    descendants.push(id)
    queue.push(...(children.get(id) ?? []))
  }
  descendants.sort()
  const states = new Map<string, RevocationState>(
    views.map((view) => [view.secretId, view.revocationState] as const),
  )
  const stillUsable = descendants.filter((id) => states.get(id) === 'active').sort()
  return deepFreeze({ revokedRef, descendants, stillUsable })
}

// ————————————————————————— 吊销证明形状闸（三动作＋后代枚举） —————————————————————————

/**
 * 吊销证明形状闸：三动作（撤销记录/停止注入/围栏拒绝记录）逐项为真且有证据引用；
 * 后代枚举须与目录父链**逐项相等**（缺项＝`catalog-descendants-incomplete`＝NEG-SEC-08 判负输入；
 * 目录外引用＝`catalog-descendants-unknown`，不猜归属）；无后代时必须给显式确认方法。
 * 只做形状与枚举一致性判定，不改状态（状态迁移归 `createCredentialCatalog.revoke`）。
 */
export function readRevocationProof(proof: unknown, knownDescendants: readonly string[]): Checked<RevocationProof> {
  if (!isRecord(proof)) {
    return { ok: false, error: failure('rejected_precondition', 'catalog-entry-invalid', '吊销证明须为对象（三动作逐项留证）') }
  }
  const keys = checkKeys(proof, [
    'recordId', 'injectionStopped', 'fenceRejectionRecorded', 'evidenceRefs', 'descendants', 'noDescendantConfirmation',
  ], '吊销证明')
  if (!keys.ok) return keys
  const recordId = readNonEmptyString(proof['recordId'], MAX_REFERENCE_LENGTH)
  const evidenceList = readStringArray(proof['evidenceRefs'], MAX_REFERENCE_LENGTH)
  if (
    recordId === undefined ||
    evidenceList === undefined ||
    proof['injectionStopped'] !== true ||
    proof['fenceRejectionRecorded'] !== true
  ) {
    return {
      ok: false,
      error: failure(
        'rejected_precondition',
        'catalog-proof-missing',
        '吊销三动作未齐（撤销记录＋停止注入＋围栏拒绝记录，逐项为真且有证据引用）——不得记吊销完成（SEC-REV-01/SEC-SEC-03）',
      ),
    }
  }
  const evidenceRefs = evidenceList as readonly [string, ...string[]]

  if (knownDescendants.length === 0) {
    const confirmation = proof['noDescendantConfirmation']
    if (!isRecord(confirmation)) {
      return {
        ok: false,
        error: failure(
          'rejected_precondition',
          'catalog-no-descendant-confirmation',
          '无后代时须给显式确认方法（探测方法＋最后探测时点）——不得留空视为零（REC-AUTH-03/EVD-RVK）',
        ),
      }
    }
    const confirmationKeys = checkKeys(confirmation, ['probeMethod', 'lastProbedAt'], 'noDescendantConfirmation')
    if (!confirmationKeys.ok) return confirmationKeys
    const probeMethod = typeof confirmation['probeMethod'] === 'string' ? confirmation['probeMethod'] : undefined
    const lastProbedAt = readIso(confirmation['lastProbedAt'])
    if (probeMethod === undefined || probeMethod.trim() === '' || lastProbedAt === undefined) {
      return {
        ok: false,
        error: failure(
          'rejected_precondition',
          'catalog-no-descendant-confirmation',
          '无后代时的确认方法不完整（探测方法非空＋最后探测时点为带偏移时刻）——不得留空视为零',
        ),
      }
    }
    return { ok: true, value: { recordId, injectionStopped: true, fenceRejectionRecorded: true, evidenceRefs } }
  }

  const declaredRaw = proof['descendants']
  if (!Array.isArray(declaredRaw)) {
    return {
      ok: false,
      error: failure(
        'rejected_precondition',
        'catalog-descendants-incomplete',
        `目录已知 ${knownDescendants.length} 个后代，未给后代枚举（枚举不完整即判负——NEG-SEC-08 前腿）`,
      ),
    }
  }
  const declared: string[] = []
  for (const item of declaredRaw) {
    const id = readSecretId(item)
    if (id === undefined) {
      return {
        ok: false,
        error: failure('rejected_precondition', 'catalog-descendants-unknown', '后代枚举含非 secretId 项（不猜、不静默接受）'),
      }
    }
    if (!declared.includes(id)) declared.push(id)
  }
  const missing = knownDescendants.filter((id) => !declared.includes(id))
  if (missing.length > 0) {
    return {
      ok: false,
      error: failure(
        'rejected_precondition',
        'catalog-descendants-incomplete',
        `后代枚举缺 ${missing.join('/')}——差异非空即判负（NEG-SEC-08 前腿；SEC-REV-01 第 1 条）`,
      ),
    }
  }
  const unknown = declared.filter((id) => !knownDescendants.includes(id))
  if (unknown.length > 0) {
    return {
      ok: false,
      error: failure('rejected_precondition', 'catalog-descendants-unknown', `后代枚举含目录外引用 ${unknown.join('/')}（不猜归属）`),
    }
  }
  return {
    ok: true,
    value: { recordId, injectionStopped: true, fenceRejectionRecorded: true, evidenceRefs, descendants: declared },
  }
}
