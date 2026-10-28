/**
 * root-delegation —— `root_delegation` 验签/指纹/期限/范围 preflight（网关侧判定件）
 *
 * 依据（实现单引用）：
 *   - docs/plan/05 IMPL-07-06「gateway fail-closed·FC-01/02＋root 验签＋绑定一致性」（LANE-G）；
 *   - docs/v2/15 §七 SEC-ROOT-01..05：7.3 启动验签五步（读 `REC-AUTH-01` 根授予 → 验外部签名/
 *     离线批准件 → 比对 operating root key 指纹 → 校验 scope/term/revocable → 写启动结论）、
 *     7.4 scoped 不得升级为 root、7.5 撤回/轮换枚举停用（**不设宽限窗口**）、7.6 四硬拒绝形态；
 *   - docs/v2/17 §4.1 NEG-ORG-09（无有效 root_delegation）/10（撤回轮换后旧 root 签名）/
 *     11（子 agent 持 root key）/12（root 超范围）——本件是这四条的**判定腿**；
 *   - 记录形状唯一源：v2/11 §2.2（`REC-AUTH-01` 根授予子类型、`REC-AUTH-03` 撤回）→
 *     `packages/contract/src/records/auth.ts`（本件不复制记录类，见「边界」2）。
 *
 * 边界（如实登记，禁互相代证）：
 *   1. **不含外部签名的验签本体**：验签件须部署在独立信任域（SEC-SIG-02 为目标（未证）），本件只
 *      消费注入结论 `proofVerified`；但「外部签名/离线批准件引用是否存在」「proof_mode 是否
 *      ritual_and_key」仍在此校验——缺件不等于「已验」。
 *   2. **不复制 `REC-AUTH-01/03` 形状**：`readRootDelegation` 只读本 preflight 需要消费的字段，
 *      缺失/类型不符＝unreadable＝拒（fail-closed）；形状闸唯一源仍是 contract（v2/11 §2.2）。
 *      **登记缺口**：contract 包根出口（`src/index.ts`）当前未导出 `records/*`，故本件不能直调
 *      `validateAuthGrant`/`checkRootActionPreflight`；待 LANE-C 一行导出后改为直调（不另立形状）。
 *   3. **纯函数＋可注入时钟**：判定不读进程态；撤回登记与当前指纹走「当前值源」注入，撤回/轮换
 *      写入后**下一次 preflight 即拒**（NEG-ORG-10：在途动作不设宽限）。
 *   4. **零材料输出**：指纹是单向散列（`sha256:<hex>`），root 钥材料不出现在返回值/错误消息/日志。
 */
import { createHash } from 'node:crypto'
import { configInvalid } from '@studio-next/contract'
import type { CredentialCategory } from '@studio-next/contract'

/**
 * 判定面主体类别（值集投影，语义唯一主表 v2/09；记录面 `SubjectClass` 同源）。
 * 只作判定输入，**不落入任何记录**（记录不复制权源解析结论——v2/11 §0.6）。
 */
export type RootSubjectClass = 'external_owner' | 'internal_boss' | 'internal_position' | 'derived_executor'

/** `REC-AUTH-01` 的记录类型 id（引用面常量；形状归 contract，不复制字段表） */
const AUTH_GRANT_RECORD_TYPE = 'REC-AUTH-01'

/**
 * root 面拒绝码（`gw-root-*` 纯码族；一码对应一条 v2/15 §7.6 硬拒绝形态或 §7.4 升级禁令，
 * 与 v2/17 `NEG-ORG-09..12` 一一可判）：
 *   - `gw-root-no-delegation`      无有效委任（NEG-ORG-09）
 *   - `gw-root-delegation-invalid` 记录不可读/非根授予子类型/未生效（NEG-ORG-09）
 *   - `gw-root-grantor-ineligible` 授予人非外部老板（NEG-ORG-09）
 *   - `gw-root-proof-unverified`   证明未核验或缺外部签名/离线批准件（NEG-ORG-09）
 *   - `gw-root-fingerprint-mismatch` 委任指纹 ≠ 当前信任指纹（轮换后旧委任——NEG-ORG-10）
 *   - `gw-root-revoked`            已有 `REC-AUTH-03` 撤回/轮换（NEG-ORG-10）
 *   - `gw-root-stale-key`          本次签名非当前根钥（旧钥/在途——NEG-ORG-10）
 *   - `gw-root-term-out`           期限外（NEG-ORG-12）
 *   - `gw-root-scope-out`          范围外（NEG-ORG-12）
 *   - `gw-root-empty-scope`        未声明动作范围（fail-closed，不把「空」当「全」）
 *   - `gw-root-actor-ineligible`   行使人非最高宰相（子 agent/部门首长——NEG-ORG-11）
 *   - `gw-root-credential-scoped`  scoped 凭据不得行 root（NEG-ORG-11）
 */
export type RootRejectReason =
  | 'gw-root-no-delegation'
  | 'gw-root-delegation-invalid'
  | 'gw-root-grantor-ineligible'
  | 'gw-root-proof-unverified'
  | 'gw-root-fingerprint-mismatch'
  | 'gw-root-revoked'
  | 'gw-root-stale-key'
  | 'gw-root-term-out'
  | 'gw-root-scope-out'
  | 'gw-root-empty-scope'
  | 'gw-root-actor-ineligible'
  | 'gw-root-credential-scoped'

/** 当前值源：直接值，或「每次判定重读」的取值函数（撤回/轮换后即拒，不设宽限窗口） */
export type CurrentValue<T> = T | (() => T)

/** root 签发面装配输入（`SEC-ROOT-02` 五步中本件可判的四步；验签本体另见「边界」1） */
export interface RootDelegationOptions {
  /** `REC-AUTH-01` 记录（根授予子类型）；缺＝无权源（不得以「内部程序」补位） */
  delegation?: unknown
  /** `REC-AUTH-03` 撤回/轮换记录集合（当前值源：撤回写入后下一次判定即拒） */
  withdrawals?: CurrentValue<readonly unknown[]>
  /** 当前信任的 operating root key 指纹（信任锚/外部登记；缺＝拒，不猜） */
  trustedFingerprint?: CurrentValue<string | undefined>
  /** 外部签名或离线批准件的核验结论（验签件独立信任域：本件只消费结论） */
  proofVerified: boolean
  /** 授予人主体类别（根授予只能由外部老板签发——agent/宰相本人一律拒） */
  grantorClass: RootSubjectClass
  /** 行使人主体类别（root 动作只能由最高宰相行；子 agent/派生执行体一律拒） */
  actorClass: RootSubjectClass
  /** 行使人持有的凭据类别（scoped 不得升级为 root——SEC-ROOT-03） */
  credentialClass: CredentialCategory
  /** epoch ms 时钟（注入求确定性；缺省 Date.now） */
  clock?: () => number
}

/** 待签发 root 动作（声明范围＝签发锚点；空范围不解释为「全范围」） */
export interface RootActionRequest {
  /** 逐项声明的动作范围（须全部落在 `scope.included` 内且不在 `scope.forbidden` 内） */
  actionScope: readonly string[]
  /** 本次签发所用 root 钥的指纹（单向散列；钥材料不进任何结构） */
  signerFingerprint: string
}

/** root preflight 结论（运行期不抛错：拒绝返纯码，构造期由 `createRootDelegationGate` 抛 CONFIG_INVALID） */
export type RootPreflightResult =
  | { allowed: true; delegationRef: string; fingerprint: string; at: string }
  | { allowed: false; reason: RootRejectReason }

export interface RootDelegationGate {
  /** 已验过的根授予记录引用（`REC-AUTH-01.recordId`） */
  readonly delegationRef: string
  /** 装配期信任的 operating root key 指纹（`sha256:<hex>`，非密钥材料） */
  readonly fingerprint: string
  /** 每次签发前重判（当前时钟/当前撤回登记/当前指纹/范围/期限） */
  preflight(request: RootActionRequest): RootPreflightResult
}

/** 根授予记录的判定面视图（只含本 preflight 消费的字段；形状闸归 contract） */
export interface RootDelegationView {
  recordRef: string
  grantClass: string
  effectiveState: string
  termFrom: number
  termTo: number
  includedScope: readonly string[]
  forbiddenScope: readonly string[]
  keyFingerprint: string | undefined
  proofMode: string | undefined
  hasExternalProof: boolean
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function asStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: string[] = []
  for (const item of value) {
    const text = asNonEmptyString(item)
    if (text === undefined) return undefined
    out.push(text)
  }
  return out
}

/**
 * 读 `REC-AUTH-01` 根授予的判定面视图（**不是形状闸**）。
 * 返回 undefined＝结构不可读（信封/recordId/payload/term/scope 缺或类型不符）——调用方按
 * `gw-root-delegation-invalid` 拒（fail-closed：坏记录 ≠ 无记录 ≠ 放行）。
 */
export function readRootDelegation(raw: unknown): RootDelegationView | undefined {
  const envelope = asObject(raw)
  if (envelope === undefined) return undefined
  // 记录类型必须是 REC-AUTH-01：写错类的记录不得当根授予用（fail-closed，不按「字段像」认）
  if (envelope['recordType'] !== AUTH_GRANT_RECORD_TYPE) return undefined
  const recordRef = asNonEmptyString(envelope['recordId'])
  const payload = asObject(envelope['payload'])
  if (recordRef === undefined || payload === undefined) return undefined
  const term = asObject(payload['term'])
  const scope = asObject(payload['scope'])
  const includedScope = asStringArray(scope?.['included'])
  if (term === undefined || includedScope === undefined || includedScope.length === 0) return undefined
  const fromRaw = asNonEmptyString(term['from'])
  const toRaw = asNonEmptyString(term['to'])
  if (fromRaw === undefined || toRaw === undefined) return undefined
  const termFrom = Date.parse(fromRaw)
  const termTo = Date.parse(toRaw)
  if (Number.isNaN(termFrom) || Number.isNaN(termTo)) return undefined
  const forbiddenScope = scope?.['forbidden'] === undefined ? [] : asStringArray(scope['forbidden'])
  if (forbiddenScope === undefined) return undefined
  return {
    recordRef,
    grantClass: typeof payload['grant_class'] === 'string' ? payload['grant_class'] : '',
    effectiveState: typeof envelope['effectiveState'] === 'string' ? envelope['effectiveState'] : '',
    termFrom,
    termTo,
    includedScope,
    forbiddenScope,
    keyFingerprint: asNonEmptyString(payload['key_fingerprint']),
    proofMode: asNonEmptyString(payload['proof_mode']),
    hasExternalProof: asObject(payload['external_signature']) !== undefined || asObject(payload['offline_approval_ref']) !== undefined,
  }
}

/** 当前值源求值（函数＝重读；直接值＝固定） */
function current<T>(source: CurrentValue<T> | undefined, fallback: T): T {
  if (source === undefined) return fallback
  return typeof source === 'function' ? (source as () => T)() : source
}

/**
 * 撤回判定（`REC-AUTH-03` → `withdrawn_grant.refId` 指向当前根授予即撤）。
 * **不看 `effectiveState`**：pending 撤回同样拒（fail-closed，不设宽限窗口与「等生效」窗口）。
 */
function isWithdrawn(delegationRef: string, withdrawals: readonly unknown[]): boolean {
  for (const item of withdrawals) {
    const payload = asObject(asObject(item)?.['payload'])
    const target = asObject(payload?.['withdrawn_grant'])
    if (asNonEmptyString(target?.['refType']) === AUTH_GRANT_RECORD_TYPE && asNonEmptyString(target?.['refId']) === delegationRef) {
      return true
    }
  }
  return false
}

/** 构造期失败详情（**不含钥材料/指纹值以外的秘密**；指纹是单向散列，可入错误面） */
function constructionDetail(reason: RootRejectReason): string {
  switch (reason) {
    case 'gw-root-no-delegation':
      return '无有效 root_delegation（SEC-ROOT-02 启动腿：无权源即空位，不得以内部程序补位）'
    case 'gw-root-delegation-invalid':
      return 'root_delegation 记录不可读/非根授予子类型/未生效（v2/11 §2.2 形状闸归 contract）'
    case 'gw-root-grantor-ineligible':
      return '根授予只能由外部老板签发（授予人类别不是 external_owner）'
    case 'gw-root-proof-unverified':
      return '根授予证明未核验（外部签名/离线批准件缺失，或 proof_mode 非 ritual_and_key）'
    case 'gw-root-fingerprint-mismatch':
      return 'root_delegation 的 key_fingerprint 与当前信任指纹不符（轮换后旧委任不得续用）'
    case 'gw-root-revoked':
      return 'root_delegation 已被 REC-AUTH-03 撤回/轮换（旧签名一律拒，不设宽限窗口）'
    case 'gw-root-stale-key':
      return '本次签名的签根不是当前 operating root key（旧钥/在途动作须重走新钥）'
    case 'gw-root-term-out':
      return '当前时刻越出 root_delegation 期限（term.from..term.to）'
    case 'gw-root-scope-out':
      return '动作越出 root_delegation 范围（含 forbidden 边界）'
    case 'gw-root-empty-scope':
      return '未声明动作范围（空范围不解释为全范围）'
    case 'gw-root-actor-ineligible':
      return 'root 动作只能由最高宰相本人行（子 agent/部门首长不得行 root——SEC-ROOT-03）'
    case 'gw-root-credential-scoped':
      return 'scoped 凭据不得升级为 root（升级唯一路径＝外部老板新签/换发 root_delegation）'
  }
}

/** 纯判定核心（不抛错；request 省略＝只判装配期静态项，供构造腿复用） */
function evaluate(opts: RootDelegationOptions, request: RootActionRequest | undefined, at: number): RootPreflightResult {
  // —— SEC-ROOT-03：凭据类别 / 行使人资格（先于委任判定：子 agent 持 root 是供给面已破）——
  if (opts.credentialClass !== 'root') return { allowed: false, reason: 'gw-root-credential-scoped' }
  if (opts.actorClass !== 'internal_boss') return { allowed: false, reason: 'gw-root-actor-ineligible' }
  // —— SEC-ROOT-02 步①：读根授予 ——
  if (opts.delegation === undefined || opts.delegation === null) return { allowed: false, reason: 'gw-root-no-delegation' }
  const view = readRootDelegation(opts.delegation)
  if (view === undefined || view.grantClass !== 'root_delegation' || view.effectiveState !== 'effective') {
    return { allowed: false, reason: 'gw-root-delegation-invalid' }
  }
  // —— 步②：授予人资格＋外部证明（验签结论注入）——
  if (opts.grantorClass !== 'external_owner') return { allowed: false, reason: 'gw-root-grantor-ineligible' }
  if (!view.hasExternalProof || view.proofMode !== 'ritual_and_key' || opts.proofVerified !== true) {
    return { allowed: false, reason: 'gw-root-proof-unverified' }
  }
  // —— 步③：指纹（委任指纹 vs 当前信任指纹；轮换后旧委任即拒）——
  const trusted = current(opts.trustedFingerprint, undefined)
  if (view.keyFingerprint === undefined || trusted === undefined || view.keyFingerprint !== trusted) {
    return { allowed: false, reason: 'gw-root-fingerprint-mismatch' }
  }
  // —— 步④a：撤回/轮换（当前值源；不设宽限窗口）——
  if (isWithdrawn(view.recordRef, current(opts.withdrawals, []))) return { allowed: false, reason: 'gw-root-revoked' }
  // —— NEG-ORG-10 轮换腿：本次签名的签根必须是**当前**根钥（旧钥/在途一律拒）——
  if (request !== undefined && request.signerFingerprint !== trusted) return { allowed: false, reason: 'gw-root-stale-key' }
  // —— 步④b：期限（当前时刻；边界含端点，与 contract term 语义一致）——
  if (!(at >= view.termFrom && at <= view.termTo)) return { allowed: false, reason: 'gw-root-term-out' }
  // —— 步④c：范围（逐项；空范围不解释为全范围）——
  if (request !== undefined) {
    if (request.actionScope.length === 0) return { allowed: false, reason: 'gw-root-empty-scope' }
    const forbidden = new Set(view.forbiddenScope)
    const outside = request.actionScope.filter((item) => !view.includedScope.includes(item) || forbidden.has(item))
    if (outside.length > 0) return { allowed: false, reason: 'gw-root-scope-out' }
  }
  return { allowed: true, delegationRef: view.recordRef, fingerprint: view.keyFingerprint, at: new Date(at).toISOString() }
}

/**
 * 装 root 签发面（`SEC-ROOT-02` 启动腿）：构造期走完静态四项，任一失败＝`CONFIG_INVALID` 抛错。
 * 抛错即「最高宰相位不得落成可签发状态」——禁降级为告警继续，禁「先起来后补证明」。
 */
export function createRootDelegationGate(opts: RootDelegationOptions): RootDelegationGate {
  const clock = opts.clock ?? ((): number => Date.now())
  const base = evaluate(opts, undefined, clock())
  if (!base.allowed) configInvalid(base.reason, constructionDetail(base.reason))
  return {
    delegationRef: base.delegationRef,
    fingerprint: base.fingerprint,
    preflight(request: RootActionRequest): RootPreflightResult {
      return evaluate(opts, request, clock())
    },
  }
}

/**
 * operating root key 的单向指纹（`sha256:<hex>`）——登记/比对只用它，**钥材料不落盘面**
 * （SEC-ROOT-01：台账/公司目录/daemon.yaml 只允许出现 `key_fingerprint` 与逻辑引用）。
 */
export function rootKeyFingerprint(material: Uint8Array): string {
  return `sha256:${createHash('sha256').update(material).digest('hex')}`
}

