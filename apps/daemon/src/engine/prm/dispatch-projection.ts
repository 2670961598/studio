/**
 * engine/prm/dispatch-projection —— 派发前策略投影通道（生成→签名→落盘→回读验签→消费）
 *
 * 规格依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/07 §2.2／§三 **EXEC-01 派发**：派发简报必含「策略投影引用与校验结论」；
 *     **策略投影校验 fail-closed**——缺失/摘要不符/过期/引用不一致＝**不启动、不降级宽权限**；
 *   - docs/v2/15 §二 **SEC-SIG-04**：封套三要素＝签名者独立于持有者｜信任锚｜单调代次
 *     防重放；建成＝目标（未证），**不得**宣称「策略投影已防篡改」（GAP-V2-02／PRB-08 未执行）；
 *   - docs/v2/14 §六（生成器归 daemon 侧；本件是它唯一的**生产调用点**，v0 面不参与）；
 *   - docs/v2/12 §1.6（PRM-G1..G8；摘要可复算；未承载段显式损失，不静默）；
 *   - docs/17 §2（主循环七相位：本件在「派发」相位内做派发前置，不新增相位/步骤语义）；
 *   - docs/17 §6（收割四要件不受影响：本件只加派发前置，不改收割判据）。
 *
 * 数据流（何时/传给谁/如何验签）：
 *   ① 生成：`executeDispatch` 解析出工位/执行体/人之后、写任务书之前，按
 *      `ProjectionInput`（公司/工单/计划锁/授权引用/能力声明/宿主形态/秘密类别/有效期）调
 *      `compileProjection`（core 纯函数，零 IO）；
 *   ② 签名：daemon 控制面密钥（根 `<rootDir>/prm/signing.key`，env 可覆盖）对
 *      「投影摘要＋代次＋签发者＋keyId」的 JCS 语义摘要做 HMAC-SHA256；代次按
 *      `<rootDir>/prm/generations.json` 中同单上次代次 +1（持久化失败＝拒派，不回退）；
 *   ③ 传输：封套落 `<workspace>/prm/projection.json`（0600，工位内，紧随
 *      任务书一起交给执行体）；任务书追加「策略投影」段（只携摘要/代次/keyId，不携秘密）；
 *   ④ 验签/消费：**回读刚落的文件**（不经内存句柄）→ `verifyProjectionEnvelope`
 *      （信任锚唯一 keyId；摘要复算；签名常量时间比较；代次严格递增；有效期；四策略面
 *      可启动）→ 通过才返回给派发继续（launch）；任一步失败＝`rejected`，`executeDispatch`
 *      直接 `fail(...)`，**不 launch、不降级**；
 *   ⑤ 观测：DISPATCH note 追加 `prm=<digest>;prm.gen=<n>;prm.sig=ok;prm.key=<keyId>`
 *      锚（台账可查）；失败面的子因进 DISPATCH_FAIL 详情。
 *
 * 与 v0 面边界（不互相冒充）：v0 公司投影＝`packages/company/src/projection/`（公司目录的
 * 组织/权力/单元投影，供组织视图与董事会可达性用）；本件是**执行策略投影**（PORT-EXEC.
 * compileProjection），两面对象/消费者/失败面均不同——本件不读不写 v0 面，也不以 v0 面
 * 的成功替代本通道的验签结论。
 *
 * 诚实边界（如实登记，不冒充已闭合）：
 *   - **签名者独立性未证**：密钥由 daemon 同进程装载与使用，属「信封闸」形态；独立信任域
 *     部署（SEC-SIG-02 共用施工件）仍未证——不得据此宣称防篡改已成立；
 *   - **PRB-08 未执行**：真机探针（篡改一字节→拒载且不 spawn）由本通道的定向红绿测试与
 *     daemon 真栈探针代偿，探针报告落点归 v2/17，本件不改探针状态；
 *   - 引用可解析（REC-LIFE-01/REC-WORK-05/REC-CAP-01 在台账可解析）归启动器另判；本件只
 *     做形状/摘要/签名/代次/有效期/段承载六项。
 *
 * 纪律：IO 只在本件（fs 读写工位与 daemon 状态目录）；判定零重复——签名/验签纯逻辑在
 * core/prm/channel.ts，投影生成在 core/prm/compile-projection.ts，本件只做接线与持久化。
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { PolicyProjection } from '@studio-next/contract'
import type { CompileProjectionInput, ProjectionCrypto, ProjectionEnvelope } from '@studio-next/core'
import {
  PROJECTION_SEGMENTS,
  compileProjection,
  signProjectionEnvelope,
  verifyProjectionEnvelope,
} from '@studio-next/core'

/**
 * 密码学原语实现（core/prm 保持零 node 内建，HMAC 与常量时间比较落在这里）：
 * 签名正文已是 JCS 语义摘要，HMAC-SHA256 覆盖它即可绑定内容＋代次＋签发者。
 */
export const prmNodeCrypto: ProjectionCrypto = {
  hmacSha256Hex: (secret, message) => createHmac('sha256', secret).update(message, 'utf8').digest('hex'),
  equalHex: (leftHex, rightHex) => {
    const left = Buffer.from(leftHex, 'hex')
    const right = Buffer.from(rightHex, 'hex')
    return left.length === right.length && timingSafeEqual(left, right)
  },
}

/** 签发密钥环境变量名（部署面注入；**值不入仓/不入日志**，只用于本函数作用域） */
export const PRM_SIGNING_KEY_ENV = 'STUDIO_PRM_SIGNING_KEY'

/** daemon 状态目录（相对 `<rootDir>`；与工位分离——代次状态是 daemon 的，不是工人的） */
export const PRM_STATE_DIR = 'prm'

/**
 * 投影封套在工位内的落点（相对工位根；执行体据此消费）。
 * 不落 `.studio-next/`：该目录是 daemon 自管信任锚面（公司目录口径），工位内出现会与
 * 「凭据文件通道已废」的既有回归锚（wkey 零文件残留）冲突——策略投影走独立 `prm/` 子目录。
 */
export const PRM_ENVELOPE_FILE = path.join('prm', 'projection.json')

/** 缺省有效期窗（24h；显式常量而非读时钟——配置化归后续单，本单不猜配置键） */
export const PRM_DEFAULT_VALIDITY_MS = 24 * 60 * 60 * 1000

/** 签名者引用（控制面；与持有者引用不同面——`person:<工号>`） */
export function prmSignerRef(company: string): string {
  return `daemon:control-plane@${company}`
}

/** 一次派发的投影通道请求（值全部来自派发上下文；不含秘密值） */
export interface DispatchProjectionRequest {
  readonly company: string
  readonly ticket: string
  readonly attempt: number
  /** 持有者引用（`person:<工号>`；与签名者引用比较——同体即拒） */
  readonly personRef: string
  readonly executor: string
  readonly executorVersion: string
  readonly capabilityRefs: readonly string[]
  readonly grantRefs: readonly string[]
  readonly planRef: string
  readonly secretTypes: readonly string[]
  /** 该 attempt 工位（绝对路径） */
  readonly workspace: string
  /** daemon 状态目录根（`config.rootDir`；密钥与代次簿落点） */
  readonly rootDir: string
  readonly atMs: number
  /** 显式密钥注入（测试/部署）；缺省=env → 状态目录文件（首次自动生成 0600） */
  readonly signingKey?: string | undefined
  readonly validityMs?: number | undefined
}

/** 通道通过面（消费成功的投影；调用方只读） */
export interface DispatchProjectionConsumed {
  readonly kind: 'ok'
  readonly projection: PolicyProjection
  readonly envelope: ProjectionEnvelope
  readonly digest: string
  readonly generation: number
  readonly keyId: string
  readonly envelopePath: string
  /** DISPATCH note 锚（台账可观测；不含秘密） */
  readonly noteAnchor: string
  /** 任务书追加段（交执行体的投影交付面） */
  readonly briefBlock: string
}

/** 通道失败面（caller 必须据此拒派——不降级、不省略验签重试） */
export interface DispatchProjectionRejected {
  readonly kind: 'rejected'
  readonly subcause: string
  readonly detail: string
}

export type DispatchProjectionFace = DispatchProjectionConsumed | DispatchProjectionRejected

const reject = (subcause: string, detail: string): DispatchProjectionRejected => ({ kind: 'rejected', subcause, detail })

const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

// ─────────────────────────────────────────────────────────────────────────────
// 一、信任锚（keyId → 密钥）与代次簿（持久化；坏态 fail-closed）
// ─────────────────────────────────────────────────────────────────────────────

interface SigningKey {
  readonly secret: string
  readonly keyId: string
}

/** 密钥文件路径（`<rootDir>/prm/signing.key`；0600，永不入仓） */
export function prmSigningKeyPath(rootDir: string): string {
  return path.join(rootDir, PRM_STATE_DIR, 'signing.key')
}

/**
 * 装载/首次生成签发密钥。优先级：显式注入 > env > 状态目录文件（不存在则生成 32B 随机）。
 * 坏态（空/不可读/过短）＝拒，**不**回落到新生成的密钥（换钥会静默让旧封套全部失效）。
 */
function loadSigningKey(request: DispatchProjectionRequest): SigningKey | DispatchProjectionRejected {
  const explicit = request.signingKey ?? process.env[PRM_SIGNING_KEY_ENV]
  if (explicit !== undefined && explicit.length > 0) {
    return { secret: explicit, keyId: `k-${sha256Hex(explicit).slice(0, 16)}` }
  }
  const file = prmSigningKeyPath(request.rootDir)
  let secret: string | undefined
  try {
    secret = readFileSync(file, 'utf8').trim()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      return reject('prm-key-unreadable', `签发密钥不可读（${file}）：${(err as Error).message}`)
    }
  }
  if (secret !== undefined && secret.length > 0) {
    if (secret.length < 32) {
      return reject('prm-key-invalid', `签发密钥长度不足（${file}；须 ≥32 字符）——不换钥、不回落`)
    }
    return { secret, keyId: `k-${sha256Hex(secret).slice(0, 16)}` }
  }
  if (secret !== undefined) {
    return reject('prm-key-invalid', `签发密钥为空（${file}）——不自动重生成（避免旧封套静默失效）`)
  }
  const generated = randomBytes(32).toString('hex')
  try {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    writeFileSync(file, generated, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    return { secret: generated, keyId: `k-${sha256Hex(generated).slice(0, 16)}` }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      // 并发首次：以已落盘者为准（不覆盖他人密钥）
      try {
        const raced = readFileSync(file, 'utf8').trim()
        if (raced.length >= 32) return { secret: raced, keyId: `k-${sha256Hex(raced).slice(0, 16)}` }
      } catch {
        // 落到下面的统一拒绝
      }
    }
    return reject('prm-key-provision-failed', `签发密钥落盘失败（${file}）：${(err as Error).message}`)
  }
}

function generationsPath(rootDir: string): string {
  return path.join(rootDir, PRM_STATE_DIR, 'generations.json')
}

/** 读代次簿：缺文件＝空簿；坏 JSON/坏值＝拒（**不**重置，防静默清空重放面） */
interface GenerationBook {
  readonly kind: 'ok'
  readonly generations: Readonly<Record<string, number>>
}

function readGenerations(rootDir: string): GenerationBook | DispatchProjectionRejected {
  const file = generationsPath(rootDir)
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'ok', generations: {} }
    return reject('prm-generation-state-unreadable', `代次簿不可读（${file}）：${(err as Error).message}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    return reject('prm-generation-state-corrupt', `代次簿坏 JSON（${file}）：${(err as Error).message}——不重置`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return reject('prm-generation-state-corrupt', `代次簿形状不符（${file}）——不重置`)
  }
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
      return reject('prm-generation-state-corrupt', `代次簿值非法（${key}）——不重置`)
    }
    out[key] = value
  }
  return { kind: 'ok', generations: out }
}

/** 写代次簿（tmp → rename 原子替换；失败＝拒派） */
function writeGenerations(rootDir: string, generations: Readonly<Record<string, number>>): DispatchProjectionRejected | undefined {
  const file = generationsPath(rootDir)
  const tmp = `${file}.tmp-${process.pid}`
  try {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    writeFileSync(tmp, JSON.stringify(generations), { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, file)
    return undefined
  } catch (err) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      // 清理失败不掩盖原始失败
    }
    return reject('prm-generation-state-write-failed', `代次簿落盘失败（${file}）：${(err as Error).message}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、生成器输入（派发上下文 → ProjectionInput；refs 只引用不内联）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 由派发上下文构造生成器输入：引用一律用「可定位的 ref 串」，**不内联**人员/凭据内容。
 * 部署面（`deployment`）＝daemon 侧承载声明：本框架承载九段中的执行面各段（沙箱写域=工位、
 * 审批模板/证据汇=部署缺省引用），人设段不出现（无 persona 引用=不计损失，81-files/12）。
 */
export function projectionInputOf(request: DispatchProjectionRequest, nowMs: number): CompileProjectionInput {
  const validityMs = request.validityMs ?? PRM_DEFAULT_VALIDITY_MS
  return {
    companyId: request.company,
    workRef: request.ticket,
    planRef: request.planRef,
    grantRefs: request.grantRefs,
    capabilityRefs: request.capabilityRefs,
    host: {
      hostKind: request.executor,
      version: request.executorVersion,
      bindingRef: `bind:${request.executor}@${request.executorVersion}`,
    },
    secretTypes: request.secretTypes,
    validityFrom: new Date(nowMs).toISOString(),
    validityUntil: new Date(nowMs + validityMs).toISOString(),
    deployment: {
      carriedSegments: [...PROJECTION_SEGMENTS],
      sandbox: { mode: 'workspace-write', rootRef: `workspace:${request.workspace}` },
      approvalTemplateRef: `approval-template:default@${request.company}`,
      evidenceSinkRef: `evidence-sink:workspace:${request.workspace}`,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 三、落盘与回读（传输面：写 0600、回读解析——不经内存句柄消费）
// ─────────────────────────────────────────────────────────────────────────────

/** 封套落点（绝对路径） */
export function prmEnvelopePath(workspace: string): string {
  return path.join(workspace, PRM_ENVELOPE_FILE)
}

function publishEnvelope(workspace: string, envelope: ProjectionEnvelope): DispatchProjectionRejected | undefined {
  const file = prmEnvelopePath(workspace)
  try {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    writeFileSync(file, `${JSON.stringify(envelope)}\n`, { encoding: 'utf8', mode: 0o600 })
    return undefined
  } catch (err) {
    return reject('prm-envelope-publish-failed', `投影封套落盘失败（${file}）：${(err as Error).message}`)
  }
}

/** 回读封套（消费侧读面；坏 JSON=拒，不吞成「无封套」） */
export function readPublishedProjection(workspace: string): ProjectionEnvelope | DispatchProjectionRejected {
  const file = prmEnvelopePath(workspace)
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    return reject('prm-envelope-missing', `投影封套不可读（${file}）：${(err as Error).message}`)
  }
  try {
    return JSON.parse(text) as ProjectionEnvelope
  } catch (err) {
    return reject('prm-envelope-unreadable', `投影封套坏 JSON（${file}）：${(err as Error).message}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 四、通道入口（生成→签名→落盘→回读验签→消费；任一步失败＝rejected）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 一次派发的完整通道。**通过面只由回读文件的验签结论产生**——签名后不直接消费内存对象，
 * 避免「签发对象与交付对象不一致」被静默放过（传输通道的最小闭环）。
 */
export function resolveDispatchProjection(request: DispatchProjectionRequest): DispatchProjectionFace {
  const key = loadSigningKey(request)
  if ('kind' in key) return key

  const book = readGenerations(request.rootDir)
  if (book.kind === 'rejected') return book
  const previous = book.generations[request.ticket] ?? 0
  const generation = previous + 1

  // ① 生成（core 纯函数；失败面原样上抛＝拒派）
  const compiled = compileProjection(projectionInputOf(request, request.atMs))
  if (compiled.kind === 'err') {
    return reject(compiled.error.subcause, `投影生成被拒：${compiled.error.detail}`)
  }

  // ② 签发（密钥只在参数里；keyId 是密钥指纹，不是密钥）
  const signed = signProjectionEnvelope({
    crypto: prmNodeCrypto,
    projection: compiled.value,
    generation,
    issuedAtMs: request.atMs,
    signer: { kind: 'control', ref: prmSignerRef(request.company) },
    keyId: key.keyId,
    secret: key.secret,
  })
  if (signed.kind === 'err') {
    return reject(signed.error.subcause, `投影签发被拒：${signed.error.detail}`)
  }

  // ③ 代次先占（落盘失败＝不发布，宁可拒派也不留可重放代次）
  const persisted = writeGenerations(request.rootDir, { ...book.generations, [request.ticket]: generation })
  if (persisted !== undefined) return persisted

  // ④ 落盘（工位内，随任务书交给执行体）
  const published = publishEnvelope(request.workspace, signed.value)
  if (published !== undefined) return published

  // ⑤ 回读＋验签（消费面；失败＝不消费、不降级）
  const readBack = readPublishedProjection(request.workspace)
  if ('kind' in readBack) return readBack
  const verified = verifyProjectionEnvelope(readBack, {
    crypto: prmNodeCrypto,
    keys: { [key.keyId]: key.secret },
    nowMs: request.atMs,
    lastGeneration: previous,
    holderRef: request.personRef,
    requireLaunchable: true,
  })
  if (verified.kind === 'err') {
    return reject(verified.error.subcause, `投影验签/消费被拒：${verified.error.detail}`)
  }

  const envelope = verified.value
  const envelopePath = prmEnvelopePath(request.workspace)
  return {
    kind: 'ok',
    projection: envelope.projection,
    envelope,
    digest: envelope.projection.digest,
    generation: envelope.generation,
    keyId: envelope.keyId,
    envelopePath,
    noteAnchor: `;prm=${envelope.projection.digest};prm.gen=${envelope.generation};prm.sig=ok;prm.key=${envelope.keyId}`,
    briefBlock: prmBriefBlock({ digest: envelope.projection.digest, generation: envelope.generation, keyId: envelope.keyId, envelopePath, signerRef: envelope.signer.ref, company: request.company }),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 五、交付文本（任务书段；只携摘要/代次/keyId——秘密与密钥值永不入文本）
// ─────────────────────────────────────────────────────────────────────────────

export interface PrmBriefInput {
  readonly digest: string
  readonly generation: number
  readonly keyId: string
  readonly envelopePath: string
  readonly signerRef: string
  readonly company: string
}

/**
 * 任务书「策略投影」段：让执行体知道**收到的是哪一份清单、由谁签发、如何判读**；
 * 明确「验签通过≠授权/≠已防篡改」（v2/15 §二目标未证，不得由提示词放大结论）。
 */
export function prmBriefBlock(input: PrmBriefInput): string {
  return [
    '## 策略投影（PRM · SEC-SIG-04 信封闸）',
    '',
    `- 封套：\`${PRM_ENVELOPE_FILE}\`（digest=\`${input.digest}\`；generation=${input.generation}；keyId=\`${input.keyId}\`）`,
    `- 签发者：\`${input.signerRef}\`（公司 ${input.company}；控制面签发，工人侧只持交付件、不持密钥）`,
    '- 消费口径：daemon 已在派发前回读校验（摘要复算＋签名＋代次＋有效期＋四策略面）；' +
      '篡改/过期/代次回退一律拒载，**不降级宽权限**。',
    '- 边界：验签通过≠授权、≠验收、≠已防篡改（独立信任域未部署，本形态为信封闸）；' +
      '投影只是策略面清单，权源仍经 PORT-AUTH。',
    '',
  ].join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// 六、派发点接线体（engine 只留 1 行调用；20-§十五.三「先拆再增」——字段拼装在体、
//     engine.ts 行数基线只减不增；行为与内联逐字等价）
// ─────────────────────────────────────────────────────────────────────────────

/** engine 派发点接线输入（值全部来自派发上下文；不含秘密值） */
export interface DispatchProjectionApplyInput {
  readonly company: string
  readonly ticket: string
  readonly attempt: number
  readonly personId: string
  readonly personDept: string
  readonly executor: string
  readonly executorVersion: string
  /** 执行体能力声明（原样透传，只用于 capability refs 观测面，不参与判定） */
  readonly capabilities: object
  readonly workspace: string
  readonly rootDir: string
  readonly atMs: number
}

/** 派发点接线结果：ok=任务书追加段＋note 锚；rejected＝调用方必须 fail（不 launch、不降级） */
export type DispatchProjectionApplyResult =
  | { readonly kind: 'ok'; readonly briefBlock: string; readonly noteAnchor: string }
  | { readonly kind: 'rejected'; readonly detail: string }

/**
 * 派发点接线体：装配 `DispatchProjectionRequest` → 走通道（生成→签名→落盘→回读验签）→
 * 只回传 engine 消费所需的两件（任务书段/note 锚）或拒绝详情。**本件不吞拒绝**——
 * rejected 原样上抛调用方，由 engine 显式 `fail()`（NEG-RUN-01 fail-closed）。
 */
export function applyDispatchProjection(input: DispatchProjectionApplyInput): DispatchProjectionApplyResult {
  const face = resolveDispatchProjection({
    company: input.company,
    ticket: input.ticket,
    attempt: input.attempt,
    personRef: `person:${input.personId}`,
    executor: input.executor,
    executorVersion: input.executorVersion,
    capabilityRefs: [
      `capability:${input.executor}@${input.executorVersion}`,
      ...Object.entries(input.capabilities).map(([key, value]) => `cap:${key}=${String(value)}`),
    ],
    grantRefs: [`person:${input.personId}`, `dept:${input.personDept}`, `ticket:${input.ticket}`],
    planRef: `plan:${input.ticket}#att${input.attempt}`,
    secretTypes: [],
    workspace: input.workspace,
    rootDir: input.rootDir,
    atMs: input.atMs,
  })
  if (face.kind === 'rejected') return { kind: 'rejected', detail: face.detail }
  return { kind: 'ok', briefBlock: face.briefBlock, noteAnchor: face.noteAnchor }
}
