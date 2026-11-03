/**
 * root-face —— daemon 侧根委任（`root_delegation`）装载面：启动腿接线（studio-dev-530）
 *
 * 依据（实现单引用）：
 *   - docs/v2/15 §7.3「SEC-ROOT-02 启动验签五步」：①读 `REC-AUTH-01` 根授予 →②验外部签名/
 *     离线批准件（`proof_mode=ritual_and_key`）→③比对 operating root key 指纹→④校验
 *     scope/term/revocable→⑤把「已验/未验」写入启动事件供审计判读（只写结论、不写材料）；
 *     任一失败＝启动即 `CONFIG_INVALID` 拒启，**禁降级为告警继续、禁「先起来后补证明」**；
 *   - docs/v2/15 §7.2（三不入＋不入日志）：本件只装载**指纹与引用**，钥材料不入任何结构；
 *     启动日志只出 `sha256:` 指纹（单向散列，审计面可判），不出钥材料；
 *   - docs/v2/17 §4.1 `NEG-ORG-09`（无有效 root_delegation）/10（撤回轮换后旧 root 签名）——
 *     本件是守护这两条的**生产腿**：无载体＝不开 root 面（preflight 恒拒），载体坏＝拒启；
 *   - docs/17-§2（主循环七相位）：装配序不变，根委任装载发生在**装配期**（相位前），不新增
 *     相位、不改拍内行为；
 *   - 判定本体（四项静态校验＋preflight）在 `packages/gateway/src/root-delegation.ts`
 *     （`createRootDelegationGate`）；本件**不复制判据**，只负责「从部署信任域取值 → 交给
 *     gateway 构造期验」。
 *
 * 载体（部署信任域产物，**不入仓**；daemon 只读）：
 *   env `STUDIO_ROOT_DELEGATION_FILE` → JSON 授权包：
 *   ```
 *   {
 *     "schema": "studio-next/root-delegation-bundle@1",
 *     "delegation": { …REC-AUTH-01 信封… },          // 根授予记录（形状闸归 contract v2/11 §2.2）
 *     "trustedFingerprint": "sha256:<64 hex>",        // 当前 operating root key 指纹（信任锚）
 *     "proof": { "verified": true, "verifier": "<核验件标识>", "verifiedAt": "<ISO 时间>" },
 *     "subject": { "grantorClass": "external_owner", "actorClass": "internal_boss",
 *                  "credentialClass": "root" },
 *     "withdrawals": [ …REC-AUTH-03 撤回/轮换记录… ]  // 可选；**当前值源**（每次 preflight 重读载体：
 *                                                    撤回写入后下一次判定即拒，不设宽限窗口；载体读不回
 *                                                    ＝按「已撤回」拒——fail-closed，不静默当空表）
 *   }
 *   ```
 *
 * 边界（如实登记，禁互相代证）：
 *   1. **验签本体不在本件**（v2/15 §7.3 步②的签名核验归独立信任域，`SEC-SIG-02` 目标未证）：
 *      本件只消费注入结论 `proof.verified`＋核验人标识；「载体文件可被同机改写」这一残余风险
 *      = 部署面信任（文件权限/秘密源）责任，已在实现单 REPORT 登记为**未闭合项**，不以本件冒充
 *      验签实现；
 *   2. **不把「没配」当「不用验」**：env 缺省＝不产 root 面（`rootPreflight` 恒拒
 *      `gw-root-no-delegation`，行为与接线前一致）；env 配了但载体坏/证明缺/指纹非法＝
 *      `CONFIG_INVALID` 拒启（fail-closed），**不存在**「配错就静默降级为空位」的路径；
 *   3. **零材料**：返回结构/错误消息/日志不含钥材料；指纹是单向散列（`sha256:<hex>`）；
 *      **载体路径不入日志**（只报 env 键名——路径属部署面拓扑）；
 *   4. 坏记录判定（记录类型/根授予子类型/生效态/期限/范围/证明形态/指纹）**仍归 gateway**
 *      `createRootDelegationGate`（单一判据源）；本件只前置拦「连判定输入都读不出」的形态，
 *      避免把解析失败伪装成「无委任」。
 */
import { lstatSync, readFileSync } from 'node:fs'
import { configInvalid } from '@studio-next/contract'
import type { CredentialCategory } from '@studio-next/contract'
import { readRootDelegation } from '@studio-next/gateway'
import type { RootDelegationOptions, RootDelegationView, RootSubjectClass } from '@studio-next/gateway'

/** 根委任载体路径的 env 键名（部署秘密源注入；值不入仓/不入日志） */
export const ROOT_DELEGATION_FILE_ENV = 'STUDIO_ROOT_DELEGATION_FILE'

/** 授权包格式版本（形状不符＝拒启，不做「字段像就认」的宽松解析） */
export const ROOT_DELEGATION_BUNDLE_SCHEMA = 'studio-next/root-delegation-bundle@1'

/** 可注入 env 面（求确定性；缺省＝`process.env`） */
export type RootDelegationEnv = Readonly<Record<string, string | undefined>>

/**
 * 启动结论的审计投影（v2/15 §7.3 步⑤：记录引用/指纹/行使人/期限/凭据类别；**不含材料**）。
 * 只作观测/留痕面，不参与判定（判定归 gateway）。
 */
export interface RootDelegationTrace {
  /** `REC-AUTH-01.recordId`（根授予记录引用） */
  delegationRef: string
  /** 当前信任的 operating root key 指纹（`sha256:<hex>`，单向散列） */
  fingerprint: string
  /** 授予人主体类别（根授予只能外部老板签发） */
  grantorClass: RootSubjectClass
  /** 行使人主体类别（root 动作只能最高宰相行） */
  actorClass: RootSubjectClass
  /** 凭据类别（root｜scoped——scoped 不得升级为 root） */
  credentialClass: CredentialCategory
  /** 期限起（ISO；判定用原始 epoch 由 gateway 持有） */
  termFrom: string
  /** 期限止（ISO） */
  termTo: string
  /** 证明形态（`ritual_and_key` 才是有效根授予） */
  proofMode: string
  /** 核验件标识（独立信任域；本件只消费结论） */
  proofVerifier: string
  /** 核验时间（ISO） */
  proofVerifiedAt: string
  /** 来源面（只记 env 键名，不记路径） */
  source: string
}

/** 根委任面：gateway 装配输入＋审计投影（失败＝构造期抛 CONFIG_INVALID，不返回半成品） */
export interface RootDelegationFace {
  options: RootDelegationOptions
  trace: RootDelegationTrace
}

/** `sha256:<64 hex>`（与 `rootKeyFingerprint` 同形；算法扩展属运维裁决，v0 只认此形） */
const FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/

/** 启动结论单行投影（引用/指纹/行使人/期限/凭据类别/证明；**不含材料、不含载体路径**） */
export function formatRootDelegationTrace(trace: RootDelegationTrace): string {
  return (
    `ref=${trace.delegationRef} 指纹=${trace.fingerprint}（sha256 单向散列，非钥材料）` +
    `授予人=${trace.grantorClass} 行使人=${trace.actorClass} 凭据类别=${trace.credentialClass}` +
    ` 期限=${trace.termFrom}..${trace.termTo} 证明=${trace.proofMode} 核验件=${trace.proofVerifier}@${trace.proofVerifiedAt} 来源=${trace.source}`
  )
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** 读载体文本（不可读/非普通文件/空文件＝拒；世界可写＝拒） */
function readBundleText(file: string): string {
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(file)
  } catch {
    configInvalid(
      'gw-root-delegation-invalid',
      `root 委任载体不可读（env ${ROOT_DELEGATION_FILE_ENV} 指向的文件不存在或无权读取；只报 env 键名，不报路径/内容）`,
    )
  }
  if (stat.isSymbolicLink()) {
    configInvalid('gw-root-delegation-invalid', `root 委任载体不得是符号链接（env ${ROOT_DELEGATION_FILE_ENV}；信任域件须为实体文件）`)
  }
  if (!stat.isFile()) {
    configInvalid('gw-root-delegation-invalid', `root 委任载体须为普通文件（env ${ROOT_DELEGATION_FILE_ENV}）`)
  }
  if ((stat.mode & 0o022) !== 0) {
    configInvalid(
      'gw-root-delegation-invalid',
      `root 委任载体不得组/世界可写（env ${ROOT_DELEGATION_FILE_ENV}；信任域件权限过宽＝可被同机改写）`,
    )
  }
  try {
    return readFileSync(file, 'utf8')
  } catch {
    configInvalid('gw-root-delegation-invalid', `root 委任载体读取失败（env ${ROOT_DELEGATION_FILE_ENV}）`)
  }
}

/** 解析 JSON 对象（坏 JSON＝拒，不猜） */
function parseBundle(text: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    configInvalid('gw-root-delegation-invalid', `root 委任载体不是合法 JSON（env ${ROOT_DELEGATION_FILE_ENV}）`)
  }
  const bundle = asObject(parsed)
  if (bundle === undefined) {
    configInvalid('gw-root-delegation-invalid', `root 委任载体须为 JSON 对象（env ${ROOT_DELEGATION_FILE_ENV}）`)
  }
  return bundle
}

/** 主体面三值（授予人/行使人/凭据类别；值域判定仍归 gateway——本件只拦「缺字段/非字符串」） */
function readSubject(bundle: Record<string, unknown>): {
  grantorClass: RootSubjectClass
  actorClass: RootSubjectClass
  credentialClass: CredentialCategory
} {
  const subject = asObject(bundle['subject'])
  const grantorClass = asNonEmptyString(subject?.['grantorClass'])
  const actorClass = asNonEmptyString(subject?.['actorClass'])
  const credentialClass = asNonEmptyString(subject?.['credentialClass'])
  if (grantorClass === undefined || actorClass === undefined || credentialClass === undefined) {
    configInvalid(
      'gw-root-delegation-invalid',
      'root 委任载体缺主体面三值（subject.grantorClass/actorClass/credentialClass；凭证类别与行使人资格不可缺省猜）',
    )
  }
  return {
    grantorClass: grantorClass as RootSubjectClass,
    actorClass: actorClass as RootSubjectClass,
    credentialClass: credentialClass as CredentialCategory,
  }
}

/** 外部证明结论（验签本体在独立信任域；本件只消费结论——缺结论＝拒，不默认 true） */
function readProof(bundle: Record<string, unknown>): { verifier: string; verifiedAtMs: number } {
  const proof = asObject(bundle['proof'])
  const verifier = asNonEmptyString(proof?.['verifier'])
  const verifiedAtRaw = asNonEmptyString(proof?.['verifiedAt'])
  const verifiedAtMs = verifiedAtRaw === undefined ? Number.NaN : Date.parse(verifiedAtRaw)
  if (proof?.['verified'] !== true || verifier === undefined || Number.isNaN(verifiedAtMs)) {
    configInvalid(
      'gw-root-proof-unverified',
      'root 委任证明未核验（proof.verified 须为 true，且 proof.verifier/verifiedAt 齐备；SEC-ROOT-02 步②：缺证明＝拒启）',
    )
  }
  return { verifier, verifiedAtMs }
}

/** 合成撤回记录（`REC-AUTH-03` 形状最小面；载体读不回时按「已撤回」拒——不设宽限窗口） */
function syntheticRevocation(delegationRef: string): readonly unknown[] {
  return [
    {
      recordType: 'REC-AUTH-03',
      payload: {
        withdrawn_grant: { refType: 'REC-AUTH-01', refId: delegationRef },
        reason: 'withdrawal-source-unreadable',
      },
    },
  ]
}

/**
 * 撤回/轮换面（**当前值源**；docs/v2/15 §7.5 无宽限窗口）：gateway 每次 preflight 重读载体
 * `withdrawals`——撤回写入后下一次判定即拒；载体读不回/形态坏＝合成「已撤回」拒（fail-closed，
 * 不把「读不到」当「没撤回」）。构造期仍以载入时快照验收（坏形态装载即拒，见 readBundleText）。
 */
function liveWithdrawals(file: string, delegationRef: string): () => readonly unknown[] {
  return (): readonly unknown[] => {
    try {
      const bundle = parseBundle(readBundleText(file))
      const raw = bundle['withdrawals']
      if (raw === undefined) return []
      return Array.isArray(raw) ? (raw as readonly unknown[]) : syntheticRevocation(delegationRef)
    } catch {
      return syntheticRevocation(delegationRef)
    }
  }
}

/**
 * 装载根委任面（SEC-ROOT-02 启动腿；装配期调用一次）。
 *
 * - env 缺省/空值 → `undefined`（**不产 root 面**：gateway `rootPreflight` 恒拒
 *   `gw-root-no-delegation`，与接线前行为一致——「没配」不等于「不用验」）；
 * - env 给了 → 载体必须可读、格式合法、证明齐、指纹合法；任一不满足＝`CONFIG_INVALID` 抛
 *   （携 `gw-root-*` 子码），**禁降级继续**；
 * - 记录本体（记录类型/根授予子类型/生效态/指纹相符/期限/范围/撤回）由调用方交给
 *   `createGateway({root})` 在构造期以 `createRootDelegationGate` 判定——本函数不重复判。
 */
export function loadRootDelegationFace(args: {
  /** env 面（缺省 `process.env`；测试注入求确定性） */
  env?: RootDelegationEnv
  /** 装配日志出口（出站闸已包；只出指纹/引用/类别，不出路径与材料） */
  log: (line: string) => void
}): RootDelegationFace | undefined {
  const env = args.env ?? process.env
  const rawPath = env[ROOT_DELEGATION_FILE_ENV]
  if (rawPath === undefined || rawPath.trim() === '') {
    args.log(
      `[serve] root 委任未配置（env ${ROOT_DELEGATION_FILE_ENV} 缺省）：rootPreflight 恒拒 gw-root-no-delegation` +
        '——「没配」≠「不用验」（SEC-ROOT-02 fail-closed；行为与接线前一致，不误放行）',
    )
    return undefined
  }

  const bundle = parseBundle(readBundleText(rawPath.trim()))
  if (bundle['schema'] !== ROOT_DELEGATION_BUNDLE_SCHEMA) {
    configInvalid(
      'gw-root-delegation-invalid',
      `root 委任载体格式不符（schema 须为 ${ROOT_DELEGATION_BUNDLE_SCHEMA}；旧格式/未知格式一律拒启，不做宽松解析）`,
    )
  }

  const delegation = bundle['delegation']
  if (delegation === undefined || delegation === null) {
    configInvalid('gw-root-no-delegation', 'root 委任载体无 delegation（SEC-ROOT-02 步①：无权源即空位，不得以内部程序补位）')
  }
  const view: RootDelegationView | undefined = readRootDelegation(delegation)
  if (view === undefined) {
    configInvalid('gw-root-delegation-invalid', 'root 委任记录不可读（delegation 非 REC-AUTH-01 信封或缺判定字段）')
  }

  const fingerprint = asNonEmptyString(bundle['trustedFingerprint'])
  if (fingerprint === undefined || !FINGERPRINT_PATTERN.test(fingerprint)) {
    configInvalid(
      'gw-root-fingerprint-mismatch',
      'root 委任载体的 trustedFingerprint 缺失或形态非法（须为 sha256:<64 hex> 单向散列；SEC-ROOT-01：只允许指纹，不允许材料）',
    )
  }

  const proof = readProof(bundle)
  const subject = readSubject(bundle)
  // 撤回集合形态（构造期严判：坏形态＝载体坏＝拒启；运行期重读失败另按「已撤回」拒）
  const withdrawalsRaw = bundle['withdrawals']
  if (withdrawalsRaw !== undefined && !Array.isArray(withdrawalsRaw)) {
    configInvalid('gw-root-delegation-invalid', 'root 委任载体的 withdrawals 须为数组（REC-AUTH-03 集合；坏形态＝拒启）')
  }
  // 构造期也先判一次撤回（坏形态/已撤回＝拒启，不留「起来后第一次 preflight 才炸」的面）
  const withdrawalsNow = liveWithdrawals(rawPath.trim(), view.recordRef)()
  const options: RootDelegationOptions = {
    delegation,
    trustedFingerprint: fingerprint,
    proofVerified: true,
    grantorClass: subject.grantorClass,
    actorClass: subject.actorClass,
    credentialClass: subject.credentialClass,
    // 当前值源：每次 preflight 重读载体（撤回/轮换不设宽限窗口）
    withdrawals: liveWithdrawals(rawPath.trim(), view.recordRef),
  }
  if (withdrawalsNow.length > 0) {
    configInvalid('gw-root-revoked', 'root_delegation 已被 REC-AUTH-03 撤回/轮换（装载期即拒，不设宽限窗口）')
  }

  const trace: RootDelegationTrace = {
    delegationRef: view.recordRef,
    fingerprint,
    grantorClass: subject.grantorClass,
    actorClass: subject.actorClass,
    credentialClass: subject.credentialClass,
    termFrom: new Date(view.termFrom).toISOString(),
    termTo: new Date(view.termTo).toISOString(),
    proofMode: view.proofMode ?? 'unknown',
    proofVerifier: proof.verifier,
    proofVerifiedAt: new Date(proof.verifiedAtMs).toISOString(),
    source: `env:${ROOT_DELEGATION_FILE_ENV}`,
  }
  // 只报「已载入」：记录本体四项静态校验归 gateway 构造期（`createRootDelegationGate`）——
  // 装载面先喊「已验」会把「载入」伪装成「验过」（坏指纹/期限外在构造期才拒），故结论行
  // 由装配方在 `createGateway` 成功后落（见 worker-key-face.ts）。
  args.log(`[serve] root 委任已载入（待构造期验签；SEC-ROOT-02 启动腿，docs/v2/15 §7.3）：${formatRootDelegationTrace(trace)}`)
  return { options, trace }
}
