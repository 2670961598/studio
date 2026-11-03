/**
 * trust —— `PORT-TRUST` 生产实现（凭据目录＋秘密五型；**无值、fail-closed**）
 *
 * 依据（实现单引用；本单 studio-dev-544 差距项 #18）：
 *   - docs/17-§2（主循环七相位：本件挂在「派发/收割」之间的写读授权前腿，不新增相位）、
 *     docs/17-§6（收割四要件：本件只产证据/审计行，不代替收割判定）；
 *   - docs/v2/14 §1.7 `PORT-TRUST`（verifySource/issue/supply/revoke/auditUse；签发只产逻辑
 *     引用、供给只回短时句柄、吊销回执逐项留证）；
 *   - docs/v2/15 §4.1 五型分类（SEC-T1..T5）、§4.3 轮换与吊销（撤销记录＋停止注入＋围栏
 *     三项逐项留证，**不是换文件**）、§4.5 三不入（不入库/不入提示词/不入日志）；
 *   - docs/v2/11 §2.2 `REC-AUTH-04`（类别＋逻辑引用；root 仅最高宰相、scoped 不得原地升级）；
 *   - docs/v2/17 §4.1 `NEG-SEC-08`（撤回后子体仍持可用凭据＝判负；差异非空即判负）。
 *
 * 边界（如实登记，禁互相代证）：
 *   1. **目录不存值**：条目只收引用侧字段（值形态键/路径一律被 `catalog-entry.ts` 形状闸拒）；
 *      `CredentialRef.value`/`ShortLivedHandle.value` 在 contract 类型上恒不存在，本件不接触、
 *      不转发、不打印任何明文。取值通道（env/broker）的**值**由部署 provider 持有，不在本件。
 *   2. **零 IO**：登记/解析/供给/轮换/吊销都是注入时钟上的纯判定；不读 env/文件/网络、不写台账。
 *      审计面＝进程内 append-only `UseRecord`（MON-09 消费面），持久追加归 store/装配面（其它单）。
 *   3. **fail-closed**：未知 secretId/逻辑引用、用途越界、类别不符、已撤/过期、窗口越界、
 *      缺上下文、缺吊销证据——一律 `Err`（不抛、不猜、不回落匿名、不降级放行）。
 *   4. **启动期 fail-closed**：声明形状非法/重复/必需秘密缺证＝构造期 `CONFIG_INVALID` 抛错
 *      （对象不产出）；「没配＝不用验」的缺口路径不存在。值只报键名/逻辑 id，不报值。
 *   5. **轮换与撤回**：`rotate` 只认同 id/同类/同型/同逻辑引用＋版本递增＋有效期单调后移，
 *      有后代先处置（父轮换不得让旧值沿后代继续可用）；`revoke` 必须给三动作证据与后代枚举
 *      （或显式无后代确认），回执带 `reconciliation`——差异非空即判负（NEG-SEC-08 前腿）。
 *      值/句柄的「旧值全量失效验证」超本件领土（目录无值）——归部署 provider 证据，本件不冒证。
 */
import { configInvalid } from '@studio-next/contract'
import type {
  CallContext,
  CallerRef,
  CredentialIssueRequest,
  CredentialRef,
  DeactivationEvidence,
  FailureCategory,
  Page,
  PortFailure,
  PortResult,
  ReadContext,
  RevocationReceipt as ContractRevocationReceipt,
  ShortLivedHandle,
  TokenHandle,
  TrustPort,
  TtlWindow,
  UseQuery,
  UseRecord,
} from '@studio-next/contract'
import { createCredentialCatalog } from './catalog.ts'
import { SECRET_TYPES } from './catalog-entry.ts'
import type {
  CatalogEntryDraft,
  CatalogEntryView,
  CredentialCatalog,
  CredentialReferenceRow,
  RevocationProof,
  RevocationReceipt,
} from './catalog.ts'

// 五型运行时投影单一源＝`catalog-entry.ts` 的 `SECRET_TYPES`（值集主表 v2/09 ENU-117）；本件只消费。

/**
 * 部署侧秘密声明（**只含引用侧字段**）：`allowedUses`＝用途白名单（v2/15 §4.1 逻辑引用纪律），
 * `holder`＝凭据持有人身份（可选；缺省按程序主体投影，不猜人员）。值只给 `valueProvider`
 * 引用（env 名/broker id），**永不给值**。
 */
export interface SecretDeclaration extends Omit<CatalogEntryDraft, 'permittedOperations'> {
  readonly allowedUses: readonly [string, ...string[]]
  readonly holder?: CallerRef
}

/** 构造选项（时钟/句柄 id/记录 id 可注入求确定性；零随机） */
export interface SecretTrustOptions {
  /** 部署声明全集（启动期一次登记；空数组＝目录为空，所有核验路径 fail-closed） */
  readonly declarations: readonly SecretDeclaration[]
  /** 必需秘密 id（缺一条即 `CONFIG_INVALID/trust-secret-missing` 拒启——缺证即拒） */
  readonly requiredSecretIds?: readonly string[]
  readonly clock?: () => number
  readonly nextHandleId?: () => string
  readonly nextRecordId?: () => string
  /** 吊销证据提供面（缺省＝不提供证据；`revoke` 恒拒——无据不得宣称吊销完成） */
  readonly revocationProofFor?: (secretId: string, ctx: CallContext) => RevocationProof | undefined
}

/** 生产凭据目录（`PORT-TRUST` 实现；目录侧只读投影与轮换面补在 TrustPort 之外） */
export interface SecretTrust extends TrustPort {
  /** `REC-AUTH-04` 落表行全集（引用侧；无值位） */
  rows(): readonly CredentialReferenceRow[]
  /** 审计视图全集（父链＋吊销状态；稳定序） */
  entryViews(): readonly CatalogEntryView[]
  /** 按逻辑引用解析条目（未命中 `Ok(undefined)`，不是拒绝） */
  resolveByReference(logicalReference: string): PortResult<CatalogEntryView | undefined>
  /** 轮换（同 id 版本递增＋有效期后移；有后代/改类/降版本＝拒） */
  rotate(secretId: string, draft: CatalogEntryDraft): PortResult<CredentialReferenceRow>
  /** 携证据吊销（`revoke` 的显式证据入口；装配面测试/部署对账用） */
  revokeWithProof(ref: CredentialRef, proof: RevocationProof, ctx: CallContext): PortResult<ContractRevocationReceipt>
  /** 访问留痕只读面（MON-09；进程内 append-only，永不落值） */
  useRecords(): readonly UseRecord[]
}

function failure(category: FailureCategory, subcause: string, detail: string): PortFailure {
  return {
    category,
    subcause,
    detail,
    retryable: false,
    sideEffectPossible: false,
    reconcile: { required: false, reason: '凭据目录零 IO：无外部副作用，无需对账' },
    responsiblePosition: 'daemon',
  }
}

function fail<T>(category: FailureCategory, subcause: string, detail: string): PortResult<T> {
  return { kind: 'err', error: failure(category, subcause, detail) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

/** 非空、无空白、限长文本（上下文/身份字段；不合规即拒） */
function readText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text === '' || text !== value || text.length > max || /\s/.test(text)) return undefined
  return text
}

/** 读上下文闸：缺 readScope.purpose/fields 或 caller＝拒绝（读面缺省＝拒，不 Ok 冒充） */
function readContextOf(rc: ReadContext): { readonly purpose: string; readonly caller: CallerRef } | undefined {
  if (!isRecord(rc)) return undefined
  const readScope = (rc as unknown as Record<string, unknown>)['readScope']
  if (!isRecord(readScope)) return undefined
  const purpose = readText(readScope['purpose'], 160)
  const fields = readScope['fields']
  const callerRaw = (rc as unknown as Record<string, unknown>)['caller']
  if (purpose === undefined || !Array.isArray(fields) || fields.length === 0 || !isRecord(callerRaw)) return undefined
  if (readText(callerRaw['callerId'], 160) === undefined) return undefined
  return { purpose, caller: callerRaw as unknown as CallerRef }
}

/** 写上下文闸：company/caller/authority/signature 缺一即拒（v2/14 §0.2 写方法封套） */
function callContextOk(ctx: CallContext): boolean {
  if (!isRecord(ctx)) return false
  const raw = ctx as unknown as Record<string, unknown>
  const company = raw['company']
  const caller = raw['caller']
  const authority = raw['authority']
  const signature = raw['signature']
  return (
    isRecord(company) &&
    readText(company['companyId'], 160) !== undefined &&
    readText(company['slug'], 160) !== undefined &&
    isRecord(caller) &&
    readText(caller['callerId'], 160) !== undefined &&
    Array.isArray(authority) &&
    isRecord(signature)
  )
}

function readTtl(window: TtlWindow): { readonly seconds: number } | undefined {
  const seconds = isRecord(window) ? (window as unknown as Record<string, unknown>)['seconds'] : undefined
  if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 1) return undefined
  return { seconds }
}

function readScope(value: unknown): readonly [string, ...string[]] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) return undefined
  const out: string[] = []
  for (const item of value) {
    const text = readText(item, 120)
    if (text === undefined) return undefined
    if (!out.includes(text)) out.push(text)
  }
  return out as unknown as readonly [string, ...string[]]
}

/**
 * 建生产凭据目录（启动期登记全部声明；任一非法/重复/必需缺证＝`CONFIG_INVALID` 拒启）。
 * 构造函数**只报声明键名/逻辑 id**，永不打印任何值。
 */
export function createSecretTrust(options: SecretTrustOptions): SecretTrust {
  if (!isRecord(options) || !Array.isArray(options.declarations)) {
    configInvalid('trust-declarations-missing', '秘密声明全集未注入（PORT-TRUST 构造期 fail-closed：无声明＝目录不产出）')
  }
  const clock = options.clock ?? ((): number => Date.now())
  let handleSeq = 0
  const nextHandleId =
    options.nextHandleId ??
    ((): string => {
      handleSeq += 1
      return `h-${handleSeq}`
    })
  let recordSeq = 0
  const nextRecordId =
    options.nextRecordId ??
    ((): string => {
      recordSeq += 1
      return `use-${recordSeq}`
    })
  const catalog: CredentialCatalog = createCredentialCatalog({ clock, nextHandleId: options.nextHandleId ?? nextHandleId })
  const holders = new Map<string, CallerRef>()
  const useRecords: UseRecord[] = []
  let mintSeq = 0

  const views = (): readonly CatalogEntryView[] => catalog.entryViews()
  const viewOfSecret = (secretId: string): CatalogEntryView | undefined => views().find((view) => view.secretId === secretId)
  const viewOfReference = (logicalReference: string): CatalogEntryView | undefined =>
    views().find((view) => view.logicalReference === logicalReference)

  const audit = (credentialRef: string, holder: CallerRef, purpose: string, outcome: string): void => {
    useRecords.push({
      recordId: nextRecordId(),
      credentialRef,
      holder,
      purpose,
      at: iso(clock()),
      outcome,
    })
  }

  /** 用途约束（allowedUses）：越界即拒，不是「未知用途放行」 */
  const useAllowed = (view: CatalogEntryView, purpose: string): boolean => view.permittedOperations.includes(purpose)

  /** 条目可用性（吊销状态由目录给出；有效期按注入时钟判） */
  const availability = (view: CatalogEntryView): PortResult<CredentialReferenceRow> => {
    const resolved = catalog.resolve(view.secretId)
    if (resolved.kind === 'err') return resolved
    const row = resolved.value
    if (row === undefined) return fail('rejected_precondition', 'trust-ref-unknown', `secretId ${view.secretId} 未登记（缺证即拒）`)
    if (row.revocation_state === 'revoked') {
      return fail('rejected_authority', 'trust-source-revoked', `secretId ${view.secretId} 或祖先已撤回——不得核验/供给（NEG-SEC-08）`)
    }
    const now = clock()
    if (now < Date.parse(row.valid_window.from) || now >= Date.parse(row.valid_window.to)) {
      return fail('rejected_authority', 'trust-source-expired', `secretId ${view.secretId} 不在有效期内（${row.valid_window.from}..${row.valid_window.to}）`)
    }
    return { kind: 'ok', value: row }
  }

  const registered = new Set<string>()
  for (const declaration of options.declarations as readonly unknown[]) {
    if (!isRecord(declaration)) {
      configInvalid('trust-declaration-invalid', '声明须为对象（只含引用侧字段；值/路径一律拒）')
    }
    const allowedUses = declaration['allowedUses']
    if (!Array.isArray(allowedUses) || allowedUses.length === 0) {
      configInvalid('trust-declaration-invalid', `声明 ${String(declaration['secretId'])} 的 allowedUses 须为非空用途白名单（用途越界即拒的判据源）`)
    }
    const { allowedUses: _uses, holder: holderRaw, ...rest } = declaration
    void _uses
    const draft = { ...rest, permittedOperations: allowedUses } as unknown as CatalogEntryDraft
    const result = catalog.register(draft)
    if (result.kind === 'err') {
      configInvalid(`trust-declaration-${result.error.subcause}`, result.error.detail ?? `声明 ${String(declaration['secretId'])} 登记失败`)
    }
    const secretId = draft.secretId
    registered.add(secretId)
    if (isRecord(holderRaw) && readText((holderRaw as Record<string, unknown>)['callerId'], 160) !== undefined) {
      holders.set(secretId, holderRaw as unknown as CallerRef)
    }
  }
  for (const secretId of options.requiredSecretIds ?? []) {
    if (!registered.has(secretId)) {
      configInvalid('trust-secret-missing', `必需秘密 ${secretId} 未在声明中登记（缺证即拒，不降级不猜）`)
    }
  }

  const trust: SecretTrust = {
    rows: (): readonly CredentialReferenceRow[] => catalog.rows(),
    entryViews: (): readonly CatalogEntryView[] => catalog.entryViews(),
    useRecords: (): readonly UseRecord[] => [...useRecords],

    resolveByReference(logicalReference: string): PortResult<CatalogEntryView | undefined> {
      if (typeof logicalReference !== 'string' || logicalReference === '') {
        return fail('rejected_precondition', 'trust-ref-invalid', 'resolveByReference 须给非空逻辑引用')
      }
      return { kind: 'ok', value: viewOfReference(logicalReference) }
    },

    verifySource(handle: TokenHandle, rc: ReadContext): PortResult<CallerRef> {
      const context = readContextOf(rc)
      if (context === undefined) {
        return fail('rejected_precondition', 'trust-context-invalid', '来源核验缺读上下文（purpose/fields/caller）——读面缺省＝拒')
      }
      if (!isRecord(handle)) return fail('unverified', 'trust-source-invalid', '来源句柄须为对象（handleId/tokenKind）')
      const handleId = readText((handle as unknown as Record<string, unknown>)['handleId'], 160)
      const tokenKind = readText((handle as unknown as Record<string, unknown>)['tokenKind'], 120)
      if (handleId === undefined || tokenKind === undefined) {
        return fail('unverified', 'trust-source-invalid', '来源句柄缺 handleId/tokenKind（不可核验＝拒）')
      }
      const view = viewOfReference(handleId)
      if (view === undefined) {
        return fail('unverified', 'trust-source-unknown', '凭据引用未在目录登记——不可核验＝拒（不回落匿名）')
      }
      if (!SECRET_TYPES.has(tokenKind) || tokenKind !== view.secretType) {
        return fail('unverified', 'trust-source-kind-mismatch', `来源令牌类型与目录条目不符（${tokenKind}≠${view.secretType}）——不猜类别`)
      }
      const usable = availability(view)
      if (usable.kind === 'err') {
        audit(view.logicalReference, context.caller, context.purpose, `err:${usable.error.subcause}`)
        return usable
      }
      if (!useAllowed(view, context.purpose)) {
        audit(view.logicalReference, context.caller, context.purpose, 'err:trust-use-not-allowed')
        return fail('rejected_forbidden', 'trust-use-not-allowed', `用途 ${context.purpose} 不在 ${view.secretId} 的 allowedUses（${view.permittedOperations.join('/')}）——用途越界即拒`)
      }
      const caller = holders.get(view.secretId) ?? { callerId: view.logicalReference, kind: 'program' as const, programRef: view.secretId }
      audit(view.logicalReference, caller, context.purpose, 'verified')
      return { kind: 'ok', value: caller }
    },

    issue(req: CredentialIssueRequest, ctx: CallContext): PortResult<CredentialRef> {
      if (!callContextOk(ctx)) {
        return fail('rejected_precondition', 'trust-context-invalid', '签发缺写上下文（company/caller/authority/signature）——缺省＝拒')
      }
      if (!isRecord(req)) return fail('rejected_precondition', 'trust-issue-invalid', '签发请求须为对象（REC-AUTH-04）')
      const raw = req as unknown as Record<string, unknown>
      const secretType = raw['secretType']
      const purpose = readText(raw['purpose'], 160)
      const scope = readScope(raw['scope'])
      const ttl = readTtl(raw['ttl'] as TtlWindow)
      if (typeof secretType !== 'string' || !SECRET_TYPES.has(secretType)) {
        return fail('rejected_precondition', 'trust-issue-invalid', 'secretType 须为五型之一（ENU-117）')
      }
      if (purpose === undefined || scope === undefined || ttl === undefined) {
        return fail('rejected_precondition', 'trust-issue-invalid', '签发请求缺 purpose/scope/ttl 或形态非法（不补默认值）')
      }
      if (raw['credentialClass'] === 'root') {
        const delegation = readText(raw['rootDelegationRef'], 160)
        const granted = Array.isArray(ctx.authority)
          ? ctx.authority.some((grant) => grant.grantClass === 'root_delegation' && grant.recordId === delegation)
          : false
        if (delegation === undefined || !granted) {
          return fail('rejected_authority', 'trust-root-not-delegated', 'root 签发须携 root_delegation 记录引用且在 ctx.authority 中——无据不签（root 仅最高宰相）')
        }
        return fail('rejected_authority', 'trust-root-issue-unregistered', 'root 凭据须由部署预登记（目录不接受运行期凭空造根）——不回落 scoped')
      }
      if (raw['credentialClass'] !== 'scoped') {
        return fail('rejected_precondition', 'trust-issue-invalid', 'credentialClass 只认 root|scoped（类别不得原地升级）')
      }
      const parentId = readText(raw['parentCredentialRef'], 160)
      if (parentId === undefined) {
        return fail('rejected_precondition', 'trust-issue-invalid', 'scoped 签发必带可追溯父凭据（parentCredentialRef）')
      }
      const parent = viewOfSecret(parentId)
      if (parent === undefined) {
        return fail('rejected_authority', 'trust-parent-unknown', `父凭据 ${parentId} 未登记——父链断不签（不猜）`)
      }
      const parentUsable = availability(parent)
      if (parentUsable.kind === 'err') return parentUsable
      if (!useAllowed(parent, purpose)) {
        return fail('rejected_forbidden', 'trust-use-not-allowed', `用途 ${purpose} 不在父凭据 ${parentId} 的 allowedUses——不签越权子凭据`)
      }
      const exceeds = scope.filter((use) => !parent.permittedOperations.includes(use))
      if (exceeds.length > 0) {
        return fail('rejected_forbidden', 'trust-scope-exceeds-parent', `子凭据 scope 超出父凭据允许用途 ${exceeds.join('/')}——scoped 不得扩权/原地升级`)
      }
      const now = clock()
      const parentRow = parentUsable.value
      const parentTo = Date.parse(parentRow.valid_window.to)
      const expiresAt = now + ttl.seconds * 1000
      if (expiresAt > parentTo) {
        return fail('rejected_precondition', 'trust-window-invalid', `子凭据 TTL 超出父凭据有效期（${parentRow.valid_window.to}）——短时供给只收紧不放宽`)
      }
      mintSeq += 1
      const secretId = `SEC-SL-${String(mintSeq)}`
      const logicalReference = `cred-sl-${String(mintSeq)}@company`
      const draft: CatalogEntryDraft = {
        secretId,
        secretType: secretType as CredentialIssueRequest['secretType'],
        credentialClass: 'scoped',
        logicalReference,
        boundGrant: { recordId: parent.boundGrant.recordId, refVersion: parent.boundGrant.refVersion },
        parentCredentialRef: parentId,
        permittedOperations: scope,
        validWindow: { from: iso(now), to: iso(expiresAt) },
        exposureScope: `holder:${ctx.caller.callerId}`,
        valueProvider: { type: 'broker-ref', secretId: 'SEC-BROKER-SHORTLIVED', profile: 'per-task' },
      }
      const result = catalog.register(draft)
      if (result.kind === 'err') return result
      holders.set(secretId, ctx.caller)
      audit(logicalReference, ctx.caller, purpose, 'issued')
      return {
        kind: 'ok',
        value: { credentialId: logicalReference, credentialClass: 'scoped', scope, ttl },
      }
    },

    supply(ref: CredentialRef, window: TtlWindow, rc: ReadContext): PortResult<ShortLivedHandle> {
      const context = readContextOf(rc)
      if (context === undefined) {
        return fail('rejected_precondition', 'trust-context-invalid', '供给缺读上下文（purpose/fields/caller）——缺省＝拒')
      }
      if (!isRecord(ref)) return fail('rejected_precondition', 'trust-ref-invalid', '供给须给凭据逻辑引用（CredentialRef）')
      const credentialId = readText((ref as unknown as Record<string, unknown>)['credentialId'], 160)
      const credentialClass = (ref as unknown as Record<string, unknown>)['credentialClass']
      if (credentialId === undefined || (credentialClass !== 'root' && credentialClass !== 'scoped')) {
        return fail('rejected_precondition', 'trust-ref-invalid', '凭据引用缺 credentialId/credentialClass（类别不得缺省）')
      }
      const view = viewOfReference(credentialId)
      if (view === undefined) {
        return fail('rejected_precondition', 'trust-ref-unknown', `凭据引用 ${credentialId} 未在目录登记——缺证即拒（不产出句柄）`)
      }
      if (view.credentialClass !== credentialClass) {
        return fail('rejected_authority', 'trust-ref-class-mismatch', `凭据引用类别与目录不符（${credentialClass}≠${view.credentialClass}）——不猜类别`)
      }
      const scope = readScope((ref as unknown as Record<string, unknown>)['scope'])
      if (scope === undefined) return fail('rejected_precondition', 'trust-ref-invalid', '凭据引用缺 scope（空集＝拒）')
      const exceeds = scope.filter((use) => !view.permittedOperations.includes(use))
      if (exceeds.length > 0) {
        return fail('rejected_authority', 'trust-ref-scope-mismatch', `凭据引用 scope 超出目录允许用途 ${exceeds.join('/')}——越权即拒`)
      }
      const usable = availability(view)
      if (usable.kind === 'err') {
        audit(view.logicalReference, context.caller, context.purpose, `err:${usable.error.subcause}`)
        return usable
      }
      if (!useAllowed(view, context.purpose)) {
        audit(view.logicalReference, context.caller, context.purpose, 'err:trust-use-not-allowed')
        return fail('rejected_forbidden', 'trust-use-not-allowed', `用途 ${context.purpose} 不在 ${view.secretId} 的 allowedUses（${view.permittedOperations.join('/')}）——用途越界即拒`)
      }
      const result = catalog.supply(view.secretId, window)
      if (result.kind === 'err') {
        audit(view.logicalReference, context.caller, context.purpose, `err:${result.error.subcause}`)
        return result
      }
      audit(view.logicalReference, context.caller, context.purpose, 'supplied')
      return result
    },

    revoke(ref: CredentialRef, ctx: CallContext): PortResult<ContractRevocationReceipt> {
      if (!callContextOk(ctx)) {
        return fail('rejected_precondition', 'trust-context-invalid', '吊销缺写上下文（company/caller/authority/signature）——缺省＝拒')
      }
      const credentialId = isRecord(ref) ? readText((ref as unknown as Record<string, unknown>)['credentialId'], 160) : undefined
      if (credentialId === undefined) return fail('rejected_precondition', 'trust-ref-invalid', '吊销须给凭据逻辑引用')
      const view = viewOfReference(credentialId)
      if (view === undefined) return fail('rejected_precondition', 'trust-ref-unknown', `凭据引用 ${credentialId} 未在目录登记（吊销不存在的引用不是「已停用」）`)
      const proof = options.revocationProofFor?.(view.secretId, ctx)
      if (proof === undefined) {
        return fail('rejected_precondition', 'trust-proof-missing', '吊销三动作证据未提供——无据不得宣称吊销完成（签发端须给撤销记录/停止注入/围栏拒绝）')
      }
      return trust.revokeWithProof(ref, proof, ctx)
    },

    revokeWithProof(ref: CredentialRef, proof: RevocationProof, ctx: CallContext): PortResult<ContractRevocationReceipt> {
      if (!callContextOk(ctx)) {
        return fail('rejected_precondition', 'trust-context-invalid', '吊销缺写上下文（company/caller/authority/signature）——缺省＝拒')
      }
      const credentialId = isRecord(ref) ? readText((ref as unknown as Record<string, unknown>)['credentialId'], 160) : undefined
      if (credentialId === undefined) return fail('rejected_precondition', 'trust-ref-invalid', '吊销须给凭据逻辑引用')
      const view = viewOfReference(credentialId)
      if (view === undefined) return fail('rejected_precondition', 'trust-ref-unknown', `凭据引用 ${credentialId} 未在目录登记（吊销不存在的引用不是「已停用」）`)
      const result: PortResult<RevocationReceipt> = catalog.revoke(view.secretId, proof)
      if (result.kind === 'err') return result
      const kinds: readonly DeactivationEvidence['kind'][] = ['revocation_receipt', 'injection_stop_confirm', 'fence_rejection_record']
      const evidence: readonly DeactivationEvidence[] = result.value.evidenceRefs.map((evidenceRef, index) => ({
        kind: kinds[index % kinds.length] ?? 'revocation_receipt',
        evidenceRef,
      }))
      audit(view.logicalReference, ctx.caller, 'revocation', 'revoked')
      return {
        kind: 'ok',
        value: {
          recordId: result.value.recordId,
          revocationRecorded: true,
          injectionStopped: result.value.injectionStopped,
          fenceRejectionRecorded: result.value.fenceRejectionRecorded,
          evidence,
        },
      }
    },

    auditUse(query: UseQuery, rc: ReadContext): PortResult<Page<UseRecord>> {
      const context = readContextOf(rc)
      if (context === undefined) {
        return fail('rejected_precondition', 'trust-context-invalid', '访问留痕查询缺读上下文（purpose/fields/caller）——缺省＝拒')
      }
      if (!isRecord(query)) return fail('rejected_precondition', 'trust-query-invalid', '访问留痕查询须为对象（UseQuery）')
      const raw = query as unknown as Record<string, unknown>
      const credentialRef = raw['credentialRef']
      let records: readonly UseRecord[] = useRecords
      if (credentialRef !== undefined) {
        const reference = readText(credentialRef, 160)
        if (reference === undefined) return fail('rejected_precondition', 'trust-query-invalid', 'credentialRef 须为非空逻辑引用')
        const view = viewOfReference(reference)
        if (view === undefined) return fail('rejected_precondition', 'trust-ref-unknown', `凭据引用 ${reference} 未在目录登记——不返回他人访问记录`)
        if (!useAllowed(view, context.purpose)) {
          return fail('rejected_forbidden', 'trust-use-not-allowed', `用途 ${context.purpose} 不在 ${view.secretId} 的允许用途——访问留痕也是用途`)
        }
        records = records.filter((record) => record.credentialRef === reference)
      } else if (context.purpose !== 'security-audit' && context.purpose !== 'audit') {
        return fail('rejected_forbidden', 'trust-use-not-allowed', '全量访问留痕只允许审计用途（security-audit/audit）——不放开匿名读')
      }
      const holder = raw['holder']
      if (isRecord(holder)) {
        const holderId = readText((holder as Record<string, unknown>)['callerId'], 160)
        if (holderId === undefined) return fail('rejected_precondition', 'trust-query-invalid', 'holder.callerId 须为非空身份')
        records = records.filter((record) => record.holder.callerId === holderId)
      }
      const since = raw['since'] === undefined ? undefined : readText(raw['since'], 64)
      const until = raw['until'] === undefined ? undefined : readText(raw['until'], 64)
      if (raw['since'] !== undefined && since === undefined) return fail('rejected_precondition', 'trust-query-invalid', 'since 须为可解析时刻')
      if (raw['until'] !== undefined && until === undefined) return fail('rejected_precondition', 'trust-query-invalid', 'until 须为可解析时刻')
      if (since !== undefined) records = records.filter((record) => record.at >= since)
      if (until !== undefined) records = records.filter((record) => record.at <= until)
      const limitRaw = raw['limit']
      const limit = limitRaw === undefined ? 50 : typeof limitRaw === 'number' && Number.isInteger(limitRaw) && limitRaw >= 1 && limitRaw <= 200 ? limitRaw : 0
      if (limit === 0) return fail('rejected_precondition', 'trust-query-invalid', 'limit 须为 1..200 的整数（不放大页）')
      const cursor = raw['cursor'] === undefined ? 0 : Number(raw['cursor'])
      if (!Number.isInteger(cursor) || cursor < 0) return fail('rejected_precondition', 'trust-query-invalid', 'cursor 须为非负整数偏移')
      const page = records.slice(cursor, cursor + limit)
      const nextCursor = cursor + limit < records.length ? String(cursor + limit) : undefined
      return {
        kind: 'ok',
        value: {
          items: page,
          ...(nextCursor !== undefined ? { nextCursor } : {}),
          total: records.length,
        },
      }
    },

    rotate(secretId: string, draft: CatalogEntryDraft): PortResult<CredentialReferenceRow> {
      const result = catalog.rotate(secretId, draft)
      if (result.kind === 'err') return result
      return result
    },
  }
  return trust
}

/**
 * 部署声明 JSON 的形状闸（装配单元/组合根用：启动期一次；值形态键一律拒）。
 * 只校验「数组＋每项对象＋secretId 字符串」，其余字段交 `createSecretTrust` 的形状闸——
 * 单一判据源，不另立第二套校验。
 */
export function readSecretDeclarations(raw: unknown): readonly unknown[] {
  if (!Array.isArray(raw)) {
    configInvalid('trust-declarations-invalid', '秘密声明须为数组（每项一条引用侧声明；值/路径一律拒）')
  }
  for (const item of raw) {
    if (!isRecord(item) || typeof item['secretId'] !== 'string' || item['secretId'] === '') {
      configInvalid('trust-declarations-invalid', '秘密声明每项须为对象且携非空 secretId')
    }
  }
  return raw
}
