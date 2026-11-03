/**
 * derivation-gateway —— 派生树登记网关＋撤回传播面（GAP-V2-04 登记腿；NEG-SEC-08/NEG-RUN-05）
 *
 * 依据（实现单引用设计文档章节号——AGENTS §五.1）：
 *   - docs/v2/07 §四「执行体派生树」三规则：①派生即登记（父引用/后端形态/preset 或能力子集/
 *     凭据类别＋逻辑引用/时点）；②子执行体不得持 operating root key、不得自授（SEC-ROOT-03）；
 *     ③凭据继承缺省「无」，子集继承须显式批准并记入派生登记；撤回四判据（后代清单/逐个停用
 *     或凭据失效证据/无后代显式确认/残留观察）——后代未全停或凭据未失效时撤回不得记完成。
 *   - docs/v2/15 §六 SEC-REV-01（撤回三件套：枚举派生执行体/批量吊销/逐个停用证据）与
 *     SEC-REV-02（撤回网关强制=从按单 wkey 扩到整树）——本件是其登记与传播面的**仓内实现腿**；
 *     真实进程终止/批量注入停止仍属执行面（本件不冒充已停，只登记状态与回执）。
 *   - docs/v2/17 §4.1 NEG-SEC-08（撤回后子体仍持可用凭据＝判负；对账差异非空即判负）与
 *     NEG-RUN-05（无登记选择链直连非主绑定执行器＝拒；GAP-V2-04 建成前以代偿校验拒）。
 *   - docs/v2/11 §2.2 REC-AUTH-03（`descendants[]`＋`deactivation_evidence`＋无后代显式确认）
 *     与 REC-AUTH-04（凭据逻辑引用无值）；doc/17-§2（主循环七相位：派发前判定）／§6（收割
 *     四要件：撤回完成须以证据面收口，不以「父已撤」代替逐后代结清）。
 *
 * 能力边界（如实登记，禁互相代证）：
 *   1. **登记是证据/判定面，不是进程控制面**：本件不做 kill、不停止注入、不接触秘密值；
 *      它把「派生关系＋后代身份＋后代持有凭据（逻辑引用）」登记成可判定账本，并在撤回时
 *      产出逐后代清单与对账回执。真实执行面的停用证据由调用方逐条注入（SEC-REV-01）。
 *   2. **零 IO/零值**：不读 env/文件/网络/时钟（`derivedAt` 由调用方给）；凭据只收
 *      `secretId`＋类别＋逻辑引用，目录（catalog）是取值与状态的唯一面——本件不存值、不产值。
 *   3. **撤回不静默少撤**：后代枚举以目录父链为唯一算面（`reconcileRevocation` 与
 *      `readRevocationProof` 同源），派生执行体所持凭据必须全部落在撤回面内；出现面外凭据
 *      即拒（`derivation/credential-outside-tree`）而不是替调用方猜归属。无后代必须显式确认
 *      方法（不得留空视为零）。任一差异非空＝不得记完成（NEG-SEC-08）。
 *   4. **选择不是授权**：本件导出的 `revocationPort` 只回答「该单该执行体是否落在已撤回
 *      派生树内」，不颁发任何 granted 位；授权判定仍归 v2/03/04 与 PORT-AUTH。
 *   5. **目录仍由目录实现持有**：`createCredentialCatalog().revoke` 的三动作＋枚举闸不变，
 *      本件在其上做派生树并集与传播，不复制目录拒绝码、不改契约记录形状。
 */
import type { CredentialCategory, FailureCategory, PortFailure, PortResult } from '@studio-next/contract'
import { createCredentialCatalog, reconcileRevocation } from './catalog.ts'
import type {
  CatalogEntryView,
  CredentialCatalog,
  RevocationProof,
  RevocationReceipt,
  RevocationReconciliation,
} from './catalog.ts'
import { deepFreeze, readRevocationProof } from './catalog-entry.ts'

// ————————————————————————— 值集投影（不新立枚举；字面量唯一主表在 v2/09） —————————————————————————

/** 派生执行体后端形态（v2/07 §四：进程内/外部 CLI） */
export const DERIVATION_BACKENDS = ['in-process', 'external-cli'] as const
export type DerivationBackend = (typeof DERIVATION_BACKENDS)[number]

/** 派发面撤回状态三值（供选择链/派发闸消费；unregistered＝未登记派生，不冒充 active） */
export const DERIVATION_DISPATCH_STATES = ['active', 'revoked', 'unregistered'] as const
export type DerivationDispatchState = (typeof DERIVATION_DISPATCH_STATES)[number]

// ————————————————————————— 登记形状（v2/07 §四；只收引用侧） —————————————————————————

/** 后代持有凭据（逻辑引用；值永不入本件——v2/15 §4.5 三不入） */
export interface DerivationCredentialRef {
  /** 目录中的凭据逻辑 id（`SEC-<域>-<slug>`；与 REC-AUTH-04 同一引用面） */
  readonly secretId: string
  /** 凭据类别（ENU-136：root|scoped；派生执行体只准 scoped——SEC-ROOT-03） */
  readonly credentialClass: CredentialCategory
  /** 逻辑引用（非值非路径；须与目录登记逐字一致，防登记面与目录面漂移） */
  readonly logicalReference: string
}

/** 凭据继承的显式批准（v2/07 §四规则 3：缺省不继承；子集继承须批准并记入登记） */
export interface DerivationInheritance {
  /** 具名批准位置（不得匿名/不得写「系统」） */
  readonly approvedBy: string
  readonly reason: string
}

/** 派生登记条目（派生即登记；一条＝一个后代执行体的身份＋能力子集＋持有凭据） */
export interface DerivationRecord {
  /** 派生执行体稳定 id（同树唯一；轮换/续跑不换 id） */
  readonly derivationId: string
  /** 父派生执行体；缺省＝本次派发的根执行体 */
  readonly parentDerivationId?: string
  /** 落在哪张单上（撤回入口按派生树归属到单） */
  readonly ticket: string
  /** 执行体家族（ENU-88；选择链消费面） */
  readonly executor: string
  /** 执行体注册名（可选；派发闸消费面，如 `dsh-mid`） */
  readonly executorName?: string
  readonly backend: DerivationBackend
  /** preset 或能力子集引用（不得为空——「不知道继承了啥」不是合法登记） */
  readonly capabilitySubset: string
  /** 持有凭据（默认空＝不继承；非空须带 inheritance 批准） */
  readonly credentials: readonly DerivationCredentialRef[]
  /** 子集继承的显式批准（credentials 非空时必填） */
  readonly inheritance?: DerivationInheritance
  /** 派生时点（调用方给；本件不读时钟） */
  readonly derivedAt: string
}

/** 派生执行体逐个停用证据（SEC-REV-01 第 2 条：逐后代一条，不得一条覆盖全树） */
export interface DerivationDeactivationEvidence {
  /** 被停用的派生执行体 id（须在本树内；不猜归属） */
  readonly derivationId: string
  /** 停用/凭据失效证据引用（撤销回执/注入停止确认/围栏拒绝记录，ENU-130 三选一） */
  readonly evidenceRef: string
}

/** 撤回回执（派生面；与目录回执成对——REC-AUTH-03 的 descendants[] 由此处清单填充） */
export interface DerivationRevocationReceipt {
  /** 吊销证据记录引用（EVD-RVK/REC-AUTH-03 的 recordId） */
  readonly recordId: string
  /** 被撤回的锚凭据 */
  readonly revokedCredentialId: string
  /** 已逐项失效的凭据（含锚自身；目录回执同源） */
  readonly revokedCredentials: readonly string[]
  /** 本次撤回传播到的派生执行体（含受影响的祖先/后代闭包） */
  readonly revokedDerivations: readonly DerivationRecord[]
  /** 逐后代停用证据（与 revokedDerivations 一一对应；SEC-REV-01 第 2 条） */
  readonly deactivationEvidence: readonly DerivationDeactivationEvidence[]
  /** 撤回后对账（`stillUsable` 必须为空才可宣称已停用——NEG-SEC-08） */
  readonly reconciliation: RevocationReconciliation
  /** 目录侧回执（三动作逐项留证；本件不复制其判据） */
  readonly catalogReceipt: RevocationReceipt
}

/** 派发面撤回端口（结构类型：adapters/bindcard/selection 以同形注入，不跨包 import） */
export interface DerivationRevocationPort {
  /**
   * true＝该单该执行体落在已撤回派生树内（后代凭据/派生树已失效）；
   * false＝未撤回或未登记（未登记不拦——选择链登记闸另判，本端口只证撤回传播面）。
   */
  readonly isRevoked: (ticket: string, executor: string) => boolean
}

/** 受影响派生清单（供撤回记录写面组装 descendants[]；类型/标识/凭据逐项） */
export interface DerivationInventory {
  readonly derivation: DerivationRecord
  readonly credentials: readonly DerivationCredentialRef[]
}

/** 目录/时钟可注入（测试求确定性；缺省新建内存目录） */
export interface DerivationGatewayOptions {
  readonly catalog?: CredentialCatalog
}

/** 派生树登记网关（纯内存账本；每个 daemon 装配实例一份） */
export interface DerivationGateway {
  /** 目录引用（登记凭据/撤回判定的唯一状态面；本件不另存凭据状态） */
  readonly catalog: CredentialCatalog
  /** 派生登记全集（稳定序：按登记顺序） */
  records(): readonly DerivationRecord[]
  /** 登记派生（fail-closed：形状/父引用/根凭据/继承批准/目录一致性/已撤父） */
  register(record: DerivationRecord): PortResult<DerivationRecord>
  /** 传递后代 id（不含自身；稳定序） */
  enumerateDescendants(derivationId: string): PortResult<readonly string[]>
  /** 锚凭据撤回面内受影响的派生执行体（直接持有锚或其后代凭据） */
  affectedByCredential(secretId: string): PortResult<readonly DerivationInventory[]>
  /** 派发面三态（供选择链/派发闸；目录状态为第二判据——目录已撤即视同撤回） */
  dispatchState(ticket: string, executor: string): DerivationDispatchState
  /** 撤回传播：目录父链枚举＋派生树并集校验＋逐后代停用证据＋逐项失效＋撤回后对账 */
  revoke(
    secretId: string,
    proof: RevocationProof,
    deactivationEvidence?: readonly DerivationDeactivationEvidence[],
  ): PortResult<DerivationRevocationReceipt>
  /** 派发闸端口（结构类型；注入选择链） */
  revocationPort(): DerivationRevocationPort
}

// ————————————————————————— 形状工具（零 IO；不复制目录的值形态判据） —————————————————————————

const DERIVATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/

function failure(category: FailureCategory, subcause: string, detail: string): PortFailure {
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

function reject<T>(category: FailureCategory, subcause: string, detail: string): PortResult<T> {
  return { kind: 'err', error: failure(category, subcause, detail) }
}

function accept<T>(value: T): PortResult<T> {
  return { kind: 'ok', value }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 非空、无首尾空白、无内部空白的标识文本（拒绝用空白冒充已登记） */
function readText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (value === '' || value !== value.trim() || /\s/.test(value)) return undefined
  return value
}

function readIso(value: unknown): string | undefined {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return undefined
  return Number.isFinite(Date.parse(value)) ? value : undefined
}

/** 目录视图索引（secretId → 视图；目录是凭据状态的唯一算面） */
function viewMapOf(views: readonly CatalogEntryView[]): ReadonlyMap<string, CatalogEntryView> {
  return new Map(views.map((view) => [view.secretId, view] as const))
}

/** secretId 的父链是否经过给定祖先集（含自身；父链断/环＝不在面内，fail-closed） */
function withinAncestorClosure(
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
function readCredential(raw: unknown): PortResult<DerivationCredentialRef> {
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

// ————————————————————————— 登记网关实现 —————————————————————————

export function createDerivationGateway(options: DerivationGatewayOptions = {}): DerivationGateway {
  const catalog: CredentialCatalog = options.catalog ?? createCredentialCatalog()
  const records: DerivationRecord[] = []
  /** 已撤回派生执行体 id（撤回传播落点；目录凭据状态仍是凭据面的唯一源） */
  const revokedDerivations = new Set<string>()

  const byId = (): ReadonlyMap<string, DerivationRecord> =>
    new Map(records.map((record) => [record.derivationId, record] as const))

  /** 自身或任一代祖先已撤回（派生树上的撤回传播；环按已撤保守处理） */
  const isRevokedDerivation = (derivationId: string): boolean => {
    const index = byId()
    let cursor: DerivationRecord | undefined = index.get(derivationId)
    const seen = new Set<string>()
    while (cursor !== undefined) {
      if (seen.has(cursor.derivationId)) return true
      seen.add(cursor.derivationId)
      if (revokedDerivations.has(cursor.derivationId)) return true
      cursor = cursor.parentDerivationId === undefined ? undefined : index.get(cursor.parentDerivationId)
    }
    return false
  }

  /** 该派生执行体所持凭据在目录中是否已撤（目录独立撤回也能触发派发闸，不靠登记面自报） */
  const holdsRevokedCredential = (record: DerivationRecord, views: ReadonlyMap<string, CatalogEntryView>): boolean =>
    record.credentials.some((credential) => views.get(credential.secretId)?.revocationState === 'revoked')

  const descendantsOf = (derivationId: string): readonly string[] => {
    const out: string[] = []
    const queue: string[] = records
      .filter((record) => record.parentDerivationId === derivationId)
      .map((record) => record.derivationId)
      .sort()
    const seen = new Set<string>()
    while (queue.length > 0) {
      const id = queue.shift() as string
      if (seen.has(id)) continue
      seen.add(id)
      out.push(id)
      const children = records
        .filter((record) => record.parentDerivationId === id)
        .map((record) => record.derivationId)
        .sort()
      queue.push(...children)
    }
    return out
  }

  const gateway: DerivationGateway = {
    catalog,

    records(): readonly DerivationRecord[] {
      return [...records]
    },

    register(record: DerivationRecord): PortResult<DerivationRecord> {
      if (!isRecord(record)) {
        return reject('rejected_precondition', 'derivation/invalid', '派生登记须为对象（父引用/后端/能力子集/凭据引用/时点）')
      }
      const derivationId = readText(record['derivationId'])
      if (derivationId === undefined || !DERIVATION_ID_PATTERN.test(derivationId)) {
        return reject('rejected_precondition', 'derivation/invalid', 'derivationId 须为稳定 id（字母/数字起，无空白；轮换不换 id）')
      }
      if (records.some((item) => item.derivationId === derivationId)) {
        return reject('rejected_state', 'derivation/id-duplicate', `派生 ${derivationId} 已登记（同一后代不重复登记）`)
      }
      const ticket = readText(record['ticket'])
      if (ticket === undefined) {
        return reject('rejected_precondition', 'derivation/invalid', 'ticket 须为非空单号（派生必须落在具体单上）')
      }
      const executor = readText(record['executor'])
      if (executor === undefined) {
        return reject('rejected_precondition', 'derivation/invalid', 'executor 须为非空执行体注册名（不猜后端）')
      }
      const backend = record['backend']
      if (!(DERIVATION_BACKENDS as readonly unknown[]).includes(backend)) {
        return reject('rejected_precondition', 'derivation/invalid', `backend 须为 ${DERIVATION_BACKENDS.join('|')}（v2/07 §四后端形态两值）`)
      }
      const capabilitySubset = readText(record['capabilitySubset'])
      if (capabilitySubset === undefined) {
        return reject('rejected_precondition', 'derivation/invalid', 'capabilitySubset 须为非空 preset/能力子集引用（不知道继承了啥不是合法登记）')
      }
      const executorNameRaw = record['executorName']
      const executorName = executorNameRaw === undefined ? undefined : readText(executorNameRaw)
      if (executorNameRaw !== undefined && executorName === undefined) return reject('rejected_precondition', 'derivation/invalid', 'executorName 给值即须为非空注册名')
      const derivedAt = readIso(record['derivedAt'])
      if (derivedAt === undefined) {
        return reject('rejected_precondition', 'derivation/invalid', 'derivedAt 须为带偏移的 ISO 时刻（派生即登记须有时点）')
      }

      let parent: DerivationRecord | undefined
      const parentRaw = record['parentDerivationId']
      if (parentRaw !== undefined) {
        const parentId = readText(parentRaw)
        if (parentId === undefined) {
          return reject('rejected_precondition', 'derivation/invalid', 'parentDerivationId 给值即须为非空 id（空串不等于根）')
        }
        parent = byId().get(parentId)
        if (parent === undefined) {
          return reject('rejected_precondition', 'derivation/parent-unknown', `父派生 ${parentId} 未登记（父链断即拒，不猜根）`)
        }
        if (isRevokedDerivation(parent.derivationId)) {
          return reject('rejected_authority', 'derivation/parent-revoked', `父派生 ${parentId} 已撤回——不得给已撤权的后代登记新派生（NEG-SEC-08 前腿）`)
        }
      }

      const credentialsRaw = record['credentials']
      if (!Array.isArray(credentialsRaw)) {
        return reject('rejected_precondition', 'derivation/invalid', 'credentials 须为数组（默认空＝不继承；缺省不收 undefined）')
      }
      const credentials: DerivationCredentialRef[] = []
      for (const raw of credentialsRaw) {
        const read = readCredential(raw)
        if (read.kind !== 'ok') return read
        if (credentials.some((item) => item.secretId === read.value.secretId)) {
          return reject('rejected_precondition', 'derivation/invalid', `credentials 重复登记 ${read.value.secretId}（逐项唯一）`)
        }
        credentials.push(read.value)
      }

      let inheritance: DerivationInheritance | undefined
      const inheritanceRaw = record['inheritance']
      if (inheritanceRaw !== undefined) {
        if (!isRecord(inheritanceRaw)) {
          return reject('rejected_precondition', 'derivation/invalid', 'inheritance 须为 {approvedBy,reason}')
        }
        const approvedBy = readText(inheritanceRaw['approvedBy'])
        const reason = readText(inheritanceRaw['reason'])
        if (approvedBy === undefined || reason === undefined) {
          return reject('rejected_precondition', 'derivation/inheritance-unapproved', '继承批准须具名位置＋依据（无主批准＝不可审计）')
        }
        inheritance = deepFreeze({ approvedBy, reason })
      }
      if (credentials.length > 0 && inheritance === undefined) {
        return reject(
          'rejected_authority',
          'derivation/inheritance-unapproved',
          '子执行体持有凭据＝继承（缺省值为「无」）——须显式批准并记入派生登记（v2/07 §四规则 3）',
        )
      }

      const views = viewMapOf(catalog.entryViews())
      const parentCredentialIds = new Set((parent?.credentials ?? []).map((credential) => credential.secretId))
      for (const credential of credentials) {
        if (credential.credentialClass === 'root') {
          return reject(
            'rejected_authority',
            'derivation/root-credential-forbidden',
            `${credential.secretId} 为 root 凭据——子执行体不得持 operating root key、不得自授（SEC-ROOT-03）`,
          )
        }
        const view = views.get(credential.secretId)
        if (view === undefined) {
          return reject(
            'rejected_precondition',
            'derivation/credential-unregistered',
            `凭据 ${credential.secretId} 未在目录登记——派生登记不得引用目录外凭据（不猜归属）`,
          )
        }
        if (view.credentialClass !== credential.credentialClass || view.logicalReference !== credential.logicalReference) {
          return reject(
            'rejected_precondition',
            'derivation/credential-mismatch',
            `凭据 ${credential.secretId} 的类别/逻辑引用与目录登记不一致——登记面不得另立第二套凭据事实`,
          )
        }
        if (view.revocationState === 'revoked') {
          return reject(
            'rejected_authority',
            'derivation/credential-revoked',
            `凭据 ${credential.secretId} 已撤回——不得给已失效凭据登记新持有者（NEG-SEC-08 前腿）`,
          )
        }
        if (parent !== undefined && !withinAncestorClosure(views, credential.secretId, parentCredentialIds)) {
          return reject(
            'rejected_authority',
            'derivation/credential-outside-tree',
            `凭据 ${credential.secretId} 不在父派生 ${parent.derivationId} 的凭据闭包内——派生不得持父面外凭据（授权不放大，I-6）`,
          )
        }
      }

      const normalized: DerivationRecord = deepFreeze({
        derivationId,
        ...(parent !== undefined ? { parentDerivationId: parent.derivationId } : {}),
        ticket,
        executor,
        ...(executorName !== undefined ? { executorName } : {}),
        backend: backend as DerivationBackend,
        capabilitySubset,
        credentials: deepFreeze([...credentials]),
        ...(inheritance !== undefined ? { inheritance } : {}),
        derivedAt,
      })
      records.push(normalized)
      return accept(normalized)
    },

    enumerateDescendants(derivationId: string): PortResult<readonly string[]> {
      const id = readText(derivationId)
      if (id === undefined) {
        return reject('rejected_precondition', 'derivation/invalid', 'enumerateDescendants 须给非空派生 id')
      }
      if (!byId().has(id)) {
        return reject('rejected_precondition', 'derivation/unknown', `派生 ${id} 未登记（不猜树）`)
      }
      return accept(deepFreeze(descendantsOf(id)))
    },

    affectedByCredential(secretId: string): PortResult<readonly DerivationInventory[]> {
      const id = readText(secretId)
      if (id === undefined) {
        return reject('rejected_precondition', 'catalog-entry-invalid', 'affectedByCredential 须给非空 secretId')
      }
      // 目录父链枚举（生产调用共体：与 readRevocationProof/revoke 同一算面）
      const known = reconcileRevocation(catalog.entryViews(), id).descendants
      const within = new Set<string>([id, ...known])
      const inventories = records
        .filter((record) => record.credentials.some((credential) => within.has(credential.secretId)))
        .map((record) => ({ derivation: record, credentials: record.credentials }))
      return accept(deepFreeze(inventories))
    },

    dispatchState(ticket: string, executor: string): DerivationDispatchState {
      const candidates = records.filter((record) => record.ticket === ticket && (record.executor === executor || record.executorName === executor))
      if (candidates.length === 0) return 'unregistered'
      const views = viewMapOf(catalog.entryViews())
      const revoked = candidates.some(
        (record) => isRevokedDerivation(record.derivationId) || holdsRevokedCredential(record, views),
      )
      return revoked ? 'revoked' : 'active'
    },

    revoke(
      secretId: string,
      proof: RevocationProof,
      deactivationEvidence: readonly DerivationDeactivationEvidence[] = [],
    ): PortResult<DerivationRevocationReceipt> {
      const id = readText(secretId)
      if (id === undefined) {
        return reject('rejected_precondition', 'catalog-entry-invalid', 'revoke 须给非空 secretId')
      }
      const resolved = catalog.resolve(id)
      if (resolved.kind !== 'ok') return resolved
      if (resolved.value === undefined) {
        return reject('rejected_precondition', 'catalog-entry-missing', `secretId ${id} 未登记（撤回不存在的引用不是「已停用」）`)
      }

      const views = viewMapOf(catalog.entryViews())
      // ① 后代枚举算面＝目录父链（与目录 revoke 同源；生产调用共体）
      const known = reconcileRevocation([...views.values()], id).descendants
      const within = new Set<string>([id, ...known])

      // ② 派生树并集校验：受影响派生所持凭据必须全部落在撤回面内；面外凭据＝拒（不静默少撤）
      const affected = records.filter((record) =>
        record.credentials.some((credential) => within.has(credential.secretId)),
      )
      const outside: string[] = []
      for (const record of affected) {
        for (const credential of record.credentials) {
          if (!within.has(credential.secretId) && !outside.includes(credential.secretId)) outside.push(credential.secretId)
        }
      }
      if (outside.length > 0) {
        return reject(
          'rejected_state',
          'derivation/credential-outside-tree',
          `派生执行体 ${affected
            .filter((record) => record.credentials.some((credential) => outside.includes(credential.secretId)))
            .map((record) => record.derivationId)
            .join('/')} 另持撤回面外凭据 ${outside.join('/')}——差异非空不得记撤回完成（NEG-SEC-08）；须先单独撤回这些凭据再重试`,
        )
      }

      // ③ 传播闭包（受影响执行体＋其全部后代）与逐后代停用证据（缺一条即拒，SEC-REV-01 第 2 条）
      const planned: string[] = []
      for (const record of affected) {
        if (!planned.includes(record.derivationId)) planned.push(record.derivationId)
        for (const descendantId of descendantsOf(record.derivationId)) {
          if (!planned.includes(descendantId)) planned.push(descendantId)
        }
      }
      const evidenceById = new Map<string, string>()
      for (const item of deactivationEvidence) {
        const derivationId = readText(item.derivationId)
        const evidenceRef = readText(item.evidenceRef)
        if (derivationId === undefined || evidenceRef === undefined) {
          return reject('rejected_precondition', 'derivation/invalid', '停用证据须为 {derivationId,evidenceRef} 且逐项非空（不得匿名/空白充数）')
        }
        if (!planned.includes(derivationId)) {
          return reject('rejected_precondition', 'derivation/evidence-unknown', `停用证据指向撤回面外派生 ${derivationId}（不猜归属）`)
        }
        if (evidenceById.has(derivationId)) {
          return reject('rejected_precondition', 'derivation/evidence-duplicate', `派生 ${derivationId} 重复停用证据（逐后代一条）`)
        }
        evidenceById.set(derivationId, evidenceRef)
      }
      const missingEvidence = planned.filter((derivationId) => !evidenceById.has(derivationId))
      if (missingEvidence.length > 0) {
        return reject(
          'rejected_precondition',
          'derivation/deactivation-evidence-missing',
          `派生执行体 ${missingEvidence.join('/')} 缺逐个停用/凭据失效证据——后代未全停不得记撤回完成（SEC-REV-01/I-6）`,
        )
      }

      // ④ 枚举完整性闸：三动作＋后代逐项相等＋无后代显式确认（拒绝码归 catalog-entry，不复制判据）
      const readProof = readRevocationProof(proof, known)
      if (!readProof.ok) return { kind: 'err', error: readProof.error }

      // ⑤ 目录侧落状态（自身＋目录全部后代逐项 revoked；幂等）
      const catalogReceipt = catalog.revoke(id, proof)
      if (catalogReceipt.kind !== 'ok') return catalogReceipt

      // ⑥ 派生树传播：闭包置撤回（真实进程终止不在本件；证据为调用方逐条注入的执行面回执）
      for (const derivationId of planned) revokedDerivations.add(derivationId)

      // ⑦ 撤回后对账：目录视图重算，差异非空＝判负输入（不得记完成）
      const reconciliation = reconcileRevocation(catalog.entryViews(), id)
      if (reconciliation.stillUsable.length > 0) {
        return reject(
          'rejected_state',
          'derivation/reconciliation-residual',
          `撤回后仍可用后代 ${reconciliation.stillUsable.join('/')}——对账差异非空即判负（NEG-SEC-08）`,
        )
      }

      const receipt: DerivationRevocationReceipt = deepFreeze({
        recordId: readProof.value.recordId,
        revokedCredentialId: id,
        revokedCredentials: catalogReceipt.value.revoked,
        revokedDerivations: records.filter((record) => planned.includes(record.derivationId)),
        deactivationEvidence: planned.map((derivationId) => ({ derivationId, evidenceRef: evidenceById.get(derivationId) as string })),
        reconciliation,
        catalogReceipt: catalogReceipt.value,
      })
      return accept(receipt)
    },

    revocationPort(): DerivationRevocationPort {
      return deepFreeze({
        isRevoked: (ticket: string, executor: string): boolean => gateway.dispatchState(ticket, executor) === 'revoked',
      })
    },
  }
  return gateway
}
