/**
 * prm/channel —— 策略投影的签名封套与验签（SEC-SIG-04 通道机制腿；纯逻辑零 IO）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/15 §二 **SEC-SIG-04 投影验签通道**：签名封套要素＝**签名者独立于持有者**｜
 *     **信任锚**｜**单调代次防重放**；建成＝目标（未证），建成前以启动器侧摘要＋引用可解析
 *     校验代偿，**不得**宣称「策略投影已防篡改」（GAP 登记 v2/17、探针 PRB-08 未执行）；
 *   - docs/v2/07 §2.2／§三 EXEC-01（派发须携带策略投影引用；校验失败＝**不启动、不降级
 *     宽权限**——NEG-RUN-01「缺失/摘要不符/过期/引用不一致」）；
 *   - docs/v2/14 §六（compileProjection 输入输出冻结；本件不扩契约面）；
 *   - docs/v2/12 §1.6（九段语义与 PRM-G7 可复算：摘要＝JCS 规范文本 SHA-256）；
 *   - docs/v2/10 §二（JCS 规范化身份；摘要算法唯一源，本件只引用）。
 *
 * 本件只承载「封套形状＋签名/验签判定」，**零 IO**：不碰文件/网络/子进程/时钟/随机；
 *   密钥由调用方注入（秘密只经参数，不入返回值、不入日志）；时刻一律入参（`nowMs`）；
 *   **密码学原语（HMAC-SHA256/常量时间比较）也由调用方注入**——本子域不 import 任何 node
 *   内建（守 `src/prm/**` 零 IO 静态门；实现件在 daemon 侧 `engine/prm/`）。
 *   **代次单调**：本件只做「本次代次 vs 上次代次」判定，持久化归调用方（daemon 侧）。
 *
 * 分工边界（不得混淆，见 `docs/v2/14 §六`）：
 *   - **v2 策略投影（PRM）**：本目录 `core/src/prm/`——执行端口 `PORT-EXEC.compileProjection`
 *     的策略面（九段/摘要/损失面）；本件是它的**签名交付通道**；
 *   - **v0 公司投影**：`packages/company/src/projection/`——公司目录的组织/权力/单元投影，
 *     与执行策略无关；两面**不互相冒充**，本件不 import、不替代、不改写 v0 面。
 *
 * 语义边界（不得读成更强结论）：
 *   - 验签通过只证「封套由持该 keyId 密钥者签发且内容未被改动、代次未回退、未过期」；
 *     **不证**签发者与持有者处于独立信任域（SEC-SIG-02 目标未证）——同进程自签自验仍是
 *     「信封闸」，部署形态归 daemon 侧登记；
 *   - 不证宿主已加载/已生效（v2/12 §1.6 第 6/11 态另证）；不证引用可解析（归启动器）；
 *   - 本件不产生授权、不落盘、不调宿主。
 */
import type { PolicyProjection, PortFailure, PortResult } from '@studio-next/contract'
import { projectionDigest, projectionGate } from './compile-projection.ts'
import { PRM_DIGEST_PREFIX, deepFreeze, failure } from './spec.ts'
import { semanticDigestOfJson } from '../jcs.ts'

/** 失败面（PortResult 的 err 分支；本件所有拒绝走这里，不抛异常、不返回半成品） */
function err<T>(category: PortFailure['category'], subcause: string, detail: string): PortResult<T> {
  return { kind: 'err', error: failure(category, subcause, detail) }
}

// ─────────────────────────────────────────────────────────────────────────────
// 一、封套形状（签名者/信任锚/单调代次三要素）
// ─────────────────────────────────────────────────────────────────────────────

/** 封套版本（形状变更＝发新版本，不得原地改版） */
export const PRM_ENVELOPE_VERSION = 'studio-next/prm-envelope@1' as const

/** 签名算法（值集单点；换算法＝加值不改义） */
export const PRM_SIGNATURE_ALG = 'hmac-sha256' as const

/**
 * 签名者（**必须独立于持有者**）：
 *   - `control`＝框架控制面（daemon 派发侧；本单实现形态）；
 *   - `system`＝系统代写（须能还原触发源；本单不使用，值位为后续形态保留）。
 * `ref` 是签名者引用（如 `daemon:control-plane@<公司>`），**不是**秘密值。
 */
export interface ProjectionSignerRef {
  readonly kind: 'control' | 'system'
  readonly ref: string
}

/** 签名封套：投影本体＋代次＋签发时刻＋签名者＋keyId＋签名 */
export interface ProjectionEnvelope {
  readonly envelopeVersion: typeof PRM_ENVELOPE_VERSION
  readonly alg: typeof PRM_SIGNATURE_ALG
  readonly projection: PolicyProjection
  readonly generation: number
  readonly issuedAtMs: number
  readonly signer: ProjectionSignerRef
  readonly keyId: string
  /** `hmac-sha256` 签名（小写 hex；长度=32 字节） */
  readonly signature: string
}

/** 信任锚：keyId → 密钥（值不出本函数作用域；调用方负责装载与吊销） */
export type ProjectionKeyRing = Readonly<Record<string, string>>

/**
 * 密码学原语（由调用方注入，保持本子域零 node 内建依赖）：
 *   - `hmacSha256Hex`＝HMAC-SHA256(secret, message) 的小写 hex；
 *   - `equalHex`＝常量时间比较（实现方须用恒定时间原语，不得短路比较）。
 * 注入面只承载算法调用，不承载密钥容器——密钥仍逐次入参。
 */
export interface ProjectionCrypto {
  readonly hmacSha256Hex: (secret: string, message: string) => string
  readonly equalHex: (leftHex: string, rightHex: string) => boolean
}

/** 验签上下文（时刻/代次/持有者引用一律显式入参——零时钟、零全局态） */
export interface ProjectionVerifyContext {
  /** 密码学原语（调用方注入；见 ProjectionCrypto） */
  readonly crypto: ProjectionCrypto
  /** 信任锚：只认这里列出的 keyId；未列＝未知密钥（拒，不回落任何默认密钥） */
  readonly keys: ProjectionKeyRing
  /** 判定时刻（epoch-ms；过期判定与签发时刻无关，只看 validity.until） */
  readonly nowMs: number
  /** 同 (company, workRef) 上次已消费代次；本次须 **严格大于** 它（防重放） */
  readonly lastGeneration?: number | undefined
  /** 持有者引用（如 `person:AGENT-1`）；与 `signer.ref` 相同＝签名者不独立（拒） */
  readonly holderRef?: string | undefined
  /** true＝同时要求投影本身可启动（四策略面全承载；NEG-RUN-01 缺失面拒） */
  readonly requireLaunchable?: boolean | undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、签名面（先复算摘要，再签「摘要＋代次＋签发者」）
// ─────────────────────────────────────────────────────────────────────────────

/** 签名覆盖体（JCS 规范化；投影内容经 digest 间接覆盖——PRM-G7 可复算） */
interface EnvelopePayload {
  readonly envelopeVersion: typeof PRM_ENVELOPE_VERSION
  readonly alg: typeof PRM_SIGNATURE_ALG
  readonly keyId: string
  readonly generation: number
  readonly issuedAtMs: number
  readonly signer: ProjectionSignerRef
  readonly projectionDigest: string
}

function payloadOf(envelope: ProjectionEnvelope): EnvelopePayload {
  return {
    envelopeVersion: envelope.envelopeVersion,
    alg: envelope.alg,
    keyId: envelope.keyId,
    generation: envelope.generation,
    issuedAtMs: envelope.issuedAtMs,
    signer: envelope.signer,
    projectionDigest: envelope.projection.digest,
  }
}

/**
 * 签名正文（规范字节的语义摘要）：`sha256:<hex>`。
 * 供验签复算与测试断言；不是秘密。
 */
export function projectionEnvelopePayloadDigest(envelope: ProjectionEnvelope): PortResult<string> {
  const face = semanticDigestOfJson(payloadOf(envelope))
  if (!face.ok) {
    return err('rejected_precondition', 'prm-envelope-payload-uncomputable', '封套签名正文无法按 JCS 规范化')
  }
  return { kind: 'ok', value: `${PRM_DIGEST_PREFIX}${face.value.value}` }
}

/** 签名请求（生成侧；`secret` 只经参数，不出现在返回值/错误详情里） */
export interface SignProjectionRequest {
  /** 密码学原语（调用方注入；见 ProjectionCrypto） */
  readonly crypto: ProjectionCrypto
  readonly projection: PolicyProjection
  readonly generation: number
  readonly issuedAtMs: number
  readonly signer: ProjectionSignerRef
  readonly keyId: string
  readonly secret: string
}

/**
 * 签发封套。前置（任一不满足＝拒，不签半成品）：
 *   - 投影摘要可复算且与 `projection.digest` 一致（防「摘要与体不符」被签出去）；
 *   - generation 为正安全整数、issuedAtMs 为安全整数、keyId/secret 非空、signer.ref 非空。
 */
export function signProjectionEnvelope(request: SignProjectionRequest): PortResult<ProjectionEnvelope> {
  const { crypto, projection, generation, issuedAtMs, signer, keyId, secret } = request
  if (!Number.isSafeInteger(generation) || generation < 1) {
    return err('rejected_precondition', 'prm-generation-invalid', `代次须为正安全整数（实际 ${String(generation)}）`)
  }
  if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs < 0) {
    return err('rejected_precondition', 'prm-issued-at-invalid', '签发时刻须为非负安全整数（epoch-ms）')
  }
  if (keyId.trim().length === 0) {
    return err('rejected_precondition', 'prm-key-id-empty', 'keyId 不得为空')
  }
  if (secret.length === 0) {
    return err('rejected_authority', 'prm-key-missing', '签名密钥缺失：拒绝签发（不回落默认/空密钥）')
  }
  if (signer.ref.trim().length === 0) {
    return err('rejected_precondition', 'prm-signer-empty', '签名者引用不得为空')
  }
  const recomputed = projectionDigest(projection)
  if (recomputed.kind === 'err') return recomputed
  if (recomputed.value !== projection.digest) {
    return err(
      'rejected_precondition',
      'prm-digest-mismatch',
      `投影体摘要不符：body=${recomputed.value} declared=${projection.digest}（摘要与体不一致不得签发）`,
    )
  }
  const base: ProjectionEnvelope = {
    envelopeVersion: PRM_ENVELOPE_VERSION,
    alg: PRM_SIGNATURE_ALG,
    projection,
    generation,
    issuedAtMs,
    signer,
    keyId,
    signature: '',
  }
  const payload = projectionEnvelopePayloadDigest(base)
  if (payload.kind === 'err') return payload
  return { kind: 'ok', value: deepFreeze({ ...base, signature: crypto.hmacSha256Hex(secret, payload.value) }) }
}

// ─────────────────────────────────────────────────────────────────────────────
// 三、验签面（fail-closed：任一项不符＝拒；不降级、不返回未验签的投影）
// ─────────────────────────────────────────────────────────────────────────────

const HEX_SIGNATURE = /^[0-9a-f]{64}$/
const SIGNER_KINDS: ReadonlySet<string> = new Set(['control', 'system'])

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function signatureMatches(crypto: ProjectionCrypto, secret: string, payloadDigest: string, signature: string): boolean {
  return crypto.equalHex(crypto.hmacSha256Hex(secret, payloadDigest), signature)
}

/**
 * 验签（封套完整性＋签名＋代次＋有效期＋（可选）可启动面）。
 * 返回 `Ok(envelope)` 只表示「可交付消费」；调用方仍须按宿主能力消费，不得把验签当授权。
 *
 * 失败子因（封闭清单，供台账/探针判读）：
 *   `prm-envelope-shape`｜`prm-unknown-key`｜`prm-digest-mismatch`｜`prm-signature-mismatch`｜
 *   `prm-generation-replay`｜`prm-signer-is-holder`｜`prm-expired`｜`prm-not-launchable`｜
 *   `prm-envelope-frozen`（输出不可变面被破坏——深冻结前检出，按形状拒）
 */
export function verifyProjectionEnvelope(
  envelope: unknown,
  context: ProjectionVerifyContext,
): PortResult<ProjectionEnvelope> {
  const shape = asRecord(envelope)
  if (shape === undefined) {
    return err('rejected_precondition', 'prm-envelope-shape', '封套不是对象')
  }
  const projectionFace = asRecord(shape['projection'])
  const signerFace = asRecord(shape['signer'])
  if (
    shape['envelopeVersion'] !== PRM_ENVELOPE_VERSION ||
    shape['alg'] !== PRM_SIGNATURE_ALG ||
    typeof shape['keyId'] !== 'string' ||
    shape['keyId'].length === 0 ||
    typeof shape['signature'] !== 'string' ||
    !HEX_SIGNATURE.test(shape['signature']) ||
    typeof shape['generation'] !== 'number' ||
    !Number.isSafeInteger(shape['generation']) ||
    shape['generation'] < 1 ||
    typeof shape['issuedAtMs'] !== 'number' ||
    !Number.isSafeInteger(shape['issuedAtMs']) ||
    projectionFace === undefined ||
    typeof projectionFace['digest'] !== 'string' ||
    signerFace === undefined ||
    typeof signerFace['kind'] !== 'string' ||
    !SIGNER_KINDS.has(signerFace['kind']) ||
    typeof signerFace['ref'] !== 'string' ||
    signerFace['ref'].length === 0
  ) {
    return err('rejected_precondition', 'prm-envelope-shape', '封套形状不符（版本/算法/keyId/签名/代次/签名者逐项验型）')
  }
  const candidate = shape as unknown as ProjectionEnvelope

  // 信任锚：只认 keyring 里的 keyId（未知密钥＝拒；不尝试任何默认密钥）
  const secret = context.keys[candidate.keyId]
  if (secret === undefined || secret.length === 0) {
    return err('rejected_authority', 'prm-unknown-key', `未知签发密钥 keyId=${candidate.keyId}（不在信任锚内）`)
  }

  // 投影体自洽：摘要可复算且与声明一致（PRM-G7）
  const recomputed = projectionDigest(candidate.projection)
  if (recomputed.kind === 'err') return recomputed
  if (recomputed.value !== candidate.projection.digest) {
    return err(
      'rejected_precondition',
      'prm-digest-mismatch',
      `投影摘要不符：body=${recomputed.value} declared=${candidate.projection.digest}`,
    )
  }

  // 签名正文重算＋常量时间比较
  const payload = projectionEnvelopePayloadDigest(candidate)
  if (payload.kind === 'err') return payload
  if (!signatureMatches(context.crypto, secret, payload.value, candidate.signature)) {
    return err('rejected_authority', 'prm-signature-mismatch', `验签失败 keyId=${candidate.keyId}（封套被改动或非本锚签发）`)
  }

  // 单调代次（防重放）：本次须严格大于已消费代次
  if (context.lastGeneration !== undefined && candidate.generation <= context.lastGeneration) {
    return err(
      'rejected_precondition',
      'prm-generation-replay',
      `代次回退/重放：本次 ${candidate.generation} ≤ 已消费 ${context.lastGeneration}`,
    )
  }

  // 签名者独立于持有者（SEC-SIG-04 第一要素）
  if (context.holderRef !== undefined && context.holderRef === candidate.signer.ref) {
    return err('rejected_authority', 'prm-signer-is-holder', `签名者与持有者同体（${candidate.signer.ref}）`)
  }

  // 有效期（NEG-RUN-01「过期清单一律拒」；无 until＝开放窗，不补默认值）
  const until = candidate.projection.validity.until
  if (until !== undefined) {
    const untilMs = Date.parse(until)
    if (Number.isNaN(untilMs)) {
      return err('rejected_precondition', 'prm-envelope-shape', `有效期上界不可解析：${until}`)
    }
    if (context.nowMs >= untilMs) {
      return err('rejected_precondition', 'prm-expired', `投影已过期：until=${until} nowMs=${context.nowMs}（epoch-ms，显式入参）`)
    }
  }

  // 生成期门禁前腿（四策略面全承载——缺失面＝不启动，不降级宽权限）
  if (context.requireLaunchable === true) {
    const gateFace = projectionGate(candidate.projection)
    if (!gateFace.launchable) {
      return err(
        'rejected_precondition',
        'prm-not-launchable',
        `投影缺失策略面：${gateFace.blockingSegments.join(',')}（未承载段不得以默认值放行）`,
      )
    }
  }

  return { kind: 'ok', value: deepFreeze(candidate) }
}
