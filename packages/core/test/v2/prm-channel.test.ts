/**
 * test/v2/prm-channel —— 策略投影签名封套（SEC-SIG-04 机制腿）与 NEG-RUN-01 契约
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/15 §二 SEC-SIG-04：封套三要素＝签名者独立于持有者｜信任锚｜单调代次防重放；
 *     建成＝目标（未证），本件只证**机制面 fail-closed**，不宣称「已防篡改」；
 *   - docs/v2/07 §2.2／§三 EXEC-01＋NEG-RUN-01：派发携带的投影「缺失/摘要不符/过期/
 *     引用不一致」＝不启动、不降级宽权限；
 *   - docs/v2/14 §六（生成器输入输出冻结）／docs/v2/12 §1.6（PRM-G7 摘要可复算）；
 *   - docs/17 §2（主循环七相位——签名通道属「派发」相位前置，不新增相位）。
 *
 * 断言纪律：正向只证「封套可交付消费」；负向逐条断言**拒绝子因**（放行路径必须不存在）；
 * 静态面断言本子域零 IO（不 import fs/net/子进程/时钟）——测试侧读文件不算被断言面。
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { PolicyProjection } from '@studio-next/contract'
import {
  PRM_ENVELOPE_VERSION,
  PRM_SIGNATURE_ALG,
  projectionEnvelopePayloadDigest,
  signProjectionEnvelope,
  verifyProjectionEnvelope,
  type ProjectionEnvelope,
} from '../../src/prm/channel.ts'
import { compileProjection } from '../../src/prm/compile-projection.ts'
import { PROJECTION_SEGMENTS } from '../../src/prm/spec.ts'

const PRM_DIR = fileURLToPath(new URL('../../src/prm/', import.meta.url))
/** 测试侧注入的密码学原语（生产实现=daemon 侧 prmNodeCrypto；core 子域保持零内建依赖） */
const TEST_CRYPTO = {
  hmacSha256Hex: (secret: string, message: string) => createHmac('sha256', secret).update(message, 'utf8').digest('hex'),
  equalHex: (leftHex: string, rightHex: string) => {
    const left = Buffer.from(leftHex, 'hex')
    const right = Buffer.from(rightHex, 'hex')
    return left.length === right.length && timingSafeEqual(left, right)
  },
}
const SECRET = 'test-secret-0123456789abcdef0123456789abcdef'
const KEY_ID = 'k-test'
const NOW = Date.parse('2026-11-01T00:00:00.000Z')

/** 最小可启动投影（九段全承载；有效期 24h） */
function projection(overrides: { until?: string; dropAuthority?: boolean } = {}): PolicyProjection {
  const compiled = compileProjection({
    companyId: 'demo',
    workRef: 'T-1',
    planRef: 'plan:T-1#att1',
    grantRefs: ['person:AGENT-1'],
    capabilityRefs: ['capability:fake@1'],
    host: { hostKind: 'fake', version: '1.0.0', bindingRef: 'bind:fake@1.0.0' },
    secretTypes: [],
    validityFrom: '2026-11-01T00:00:00.000Z',
    validityUntil: overrides.until ?? '2026-11-02T00:00:00.000Z',
    deployment: {
      carriedSegments: overrides.dropAuthority === true ? PROJECTION_SEGMENTS.filter((s) => s !== 'authority') : [...PROJECTION_SEGMENTS],
      sandbox: { mode: 'workspace-write', rootRef: 'workspace:/tmp/w' },
      approvalTemplateRef: 'approval-template:default@demo',
      evidenceSinkRef: 'evidence-sink:workspace:/tmp/w',
    },
  })
  if (compiled.kind === 'err') throw new Error(`夹具投影生成失败：${compiled.error.detail}`)
  return compiled.value
}

function signed(overrides: { generation?: number; secret?: string; projection?: PolicyProjection } = {}): ProjectionEnvelope {
  const envelope = signProjectionEnvelope({
    crypto: TEST_CRYPTO,
    projection: overrides.projection ?? projection(),
    generation: overrides.generation ?? 1,
    issuedAtMs: NOW,
    signer: { kind: 'control', ref: 'daemon:control-plane@demo' },
    keyId: KEY_ID,
    secret: overrides.secret ?? SECRET,
  })
  if (envelope.kind === 'err') throw new Error(`夹具签发失败：${envelope.error.detail}`)
  return envelope.value
}

/** 深拷贝改一处（篡改面；不破坏原封套） */
function cloneWith(envelope: ProjectionEnvelope, patch: (copy: Record<string, unknown>) => void): unknown {
  const copy = JSON.parse(JSON.stringify(envelope)) as Record<string, unknown>
  patch(copy)
  return copy
}

const verifyOk = (envelope: unknown, extra: Parameters<typeof verifyProjectionEnvelope>[1] extends infer C ? Partial<C> : never = {}) =>
  verifyProjectionEnvelope(envelope, { crypto: TEST_CRYPTO, keys: { [KEY_ID]: SECRET }, nowMs: NOW, requireLaunchable: true, ...extra })

describe('SEC-SIG-04 封套三要素：签名者独立／信任锚／单调代次', () => {
  it('签发→验签通过：封套自洽（版本/算法/摘要复算/签名正文可复算）且输出深冻结', () => {
    const envelope = signed()
    expect(envelope.envelopeVersion).toBe(PRM_ENVELOPE_VERSION)
    expect(envelope.alg).toBe(PRM_SIGNATURE_ALG)
    expect(envelope.keyId).toBe(KEY_ID)
    expect(envelope.signature).toMatch(/^[0-9a-f]{64}$/)
    expect(Object.isFrozen(envelope)).toBe(true)
    expect(Object.isFrozen(envelope.projection)).toBe(true)

    const payload = projectionEnvelopePayloadDigest(envelope)
    expect(payload.kind).toBe('ok')
    expect(verifyOk(envelope).kind).toBe('ok')
  })

  it('同输入同摘要（PRM-G2/G7）：重复签发＝逐字节同封套（签名确定，无时钟/随机）', () => {
    expect(JSON.stringify(signed())).toBe(JSON.stringify(signed()))
    expect(projectionEnvelopePayloadDigest(signed())).toEqual(projectionEnvelopePayloadDigest(signed()))
  })

  it('未知 keyId＝拒（信任锚封闭：不尝试任何默认密钥，不回落空密钥）', () => {
    const other = verifyProjectionEnvelope(signed(), { crypto: TEST_CRYPTO, keys: { 'k-other': SECRET }, nowMs: NOW })
    expect(other.kind).toBe('err')
    if (other.kind === 'err') expect(other.error.subcause).toBe('prm-unknown-key')
  })

  it('单调代次：代次 ≤ 已消费代次＝拒（重放面）；严格大于才放行', () => {
    const replay = verifyProjectionEnvelope(signed({ generation: 2 }), { crypto: TEST_CRYPTO, keys: { [KEY_ID]: SECRET }, nowMs: NOW, lastGeneration: 2 })
    expect(replay.kind).toBe('err')
    if (replay.kind === 'err') expect(replay.error.subcause).toBe('prm-generation-replay')
    expect(verifyProjectionEnvelope(signed({ generation: 3 }), { crypto: TEST_CRYPTO, keys: { [KEY_ID]: SECRET }, nowMs: NOW, lastGeneration: 2 }).kind).toBe('ok')
  })

  it('签名者与持有者同体＝拒（独立于持有者：引用面判据）', () => {
    const same = verifyProjectionEnvelope(signed(), {
      crypto: TEST_CRYPTO,
      keys: { [KEY_ID]: SECRET },
      nowMs: NOW,
      holderRef: 'daemon:control-plane@demo',
    })
    expect(same.kind).toBe('err')
    if (same.kind === 'err') expect(same.error.subcause).toBe('prm-signer-is-holder')
    // 不同体（工人引用）→ 放行
    expect(verifyOk(signed(), { holderRef: 'person:AGENT-1' }).kind).toBe('ok')
  })
})

describe('NEG-RUN-01 负向：摘要不符／篡改／过期／缺段一律拒（不启动、不降级）', () => {
  it('篡改投影内容（未重算摘要）＝摘要不符拒', () => {
    const tampered = cloneWith(signed(), (copy) => {
      const body = copy['projection'] as { segments: Record<string, { sourceRefs: string[] }> }
      body.segments['tools']!.sourceRefs = ['cap:evil=1']
    })
    const face = verifyOk(tampered)
    expect(face.kind).toBe('err')
    if (face.kind === 'err') expect(face.error.subcause).toBe('prm-digest-mismatch')
  })

  it('篡改投影内容并重算摘要（攻击者补摘要）＝签名不符拒（签名覆盖摘要＋代次＋签发者）', () => {
    const envelope = signed()
    const tampered = cloneWith(envelope, (copy) => {
      const body = copy['projection'] as { segments: Record<string, { sourceRefs: string[] }> }
      body.segments['tools']!.sourceRefs = ['cap:evil=1']
    })
    // 攻击者按 PRM-G7 复算：用同目录生成器重算摘要后写回（不持密钥）
    const forged = { ...(tampered as ProjectionEnvelope) }
    const recompiled = compileProjection({
      companyId: 'demo',
      workRef: 'T-1',
      planRef: 'plan:T-1#att1',
      grantRefs: ['person:AGENT-1'],
      capabilityRefs: ['cap:evil=1'],
      host: { hostKind: 'fake', version: '1.0.0', bindingRef: 'bind:fake@1.0.0' },
      secretTypes: [],
      validityFrom: '2026-11-01T00:00:00.000Z',
      validityUntil: '2026-11-02T00:00:00.000Z',
      deployment: {
        carriedSegments: [...PROJECTION_SEGMENTS],
        sandbox: { mode: 'workspace-write', rootRef: 'workspace:/tmp/w' },
        approvalTemplateRef: 'approval-template:default@demo',
        evidenceSinkRef: 'evidence-sink:workspace:/tmp/w',
      },
    })
    if (recompiled.kind === 'err') throw new Error('夹具重算失败')
    const face = verifyOk({ ...forged, projection: recompiled.value })
    expect(face.kind).toBe('err')
    if (face.kind === 'err') expect(face.error.subcause).toBe('prm-signature-mismatch')
  })

  it('篡改签名一字节＝拒；篡改代次＝拒（封套字段都在签名正文内）', () => {
    const badSig = cloneWith(signed(), (copy) => {
      const sig = copy['signature'] as string
      copy['signature'] = `${sig.slice(0, -1)}${sig.endsWith('0') ? '1' : '0'}`
    })
    const sigFace = verifyOk(badSig)
    expect(sigFace.kind).toBe('err')
    if (sigFace.kind === 'err') expect(sigFace.error.subcause).toBe('prm-signature-mismatch')

    const badGen = cloneWith(signed(), (copy) => {
      copy['generation'] = 99
    })
    const genFace = verifyOk(badGen)
    expect(genFace.kind).toBe('err')
    if (genFace.kind === 'err') expect(genFace.error.subcause).toBe('prm-signature-mismatch')
  })

  it('过期＝拒（validity.until 已到；不因签名有效而放行）', () => {
    const expired = signed()
    const face = verifyProjectionEnvelope(expired, {
      crypto: TEST_CRYPTO,
      keys: { [KEY_ID]: SECRET },
      nowMs: Date.parse('2026-11-03T00:00:00.000Z'),
      requireLaunchable: true,
    })
    expect(face.kind).toBe('err')
    if (face.kind === 'err') expect(face.error.subcause).toBe('prm-expired')
  })

  it('缺策略面（authority 未承载）＝不可启动拒（不降级宽权限）', () => {
    const face = verifyProjectionEnvelope(signed({ projection: projection({ dropAuthority: true }) }), {
      crypto: TEST_CRYPTO,
      keys: { [KEY_ID]: SECRET },
      nowMs: NOW,
      requireLaunchable: true,
    })
    expect(face.kind).toBe('err')
    if (face.kind === 'err') expect(face.error.subcause).toBe('prm-not-launchable')
  })

  it('封套形状不符／空密钥＝拒（不抛异常、不返回未验签对象）', () => {
    const shape = verifyProjectionEnvelope({ envelopeVersion: PRM_ENVELOPE_VERSION }, { crypto: TEST_CRYPTO, keys: { [KEY_ID]: SECRET }, nowMs: NOW })
    expect(shape.kind).toBe('err')
    if (shape.kind === 'err') expect(shape.error.subcause).toBe('prm-envelope-shape')

    const emptyKey = signProjectionEnvelope({
      crypto: TEST_CRYPTO,
      projection: projection(),
      generation: 1,
      issuedAtMs: NOW,
      signer: { kind: 'control', ref: 'daemon:control-plane@demo' },
      keyId: KEY_ID,
      secret: '',
    })
    expect(emptyKey.kind).toBe('err')
    if (emptyKey.kind === 'err') expect(emptyKey.error.subcause).toBe('prm-key-missing')
  })

  it('签发前置：代次非正安全整数／签发时刻非法／摘要与体不符＝拒签（不签半成品）', () => {
    const badGeneration = signProjectionEnvelope({
      crypto: TEST_CRYPTO,
      projection: projection(),
      generation: 0,
      issuedAtMs: NOW,
      signer: { kind: 'control', ref: 'daemon:control-plane@demo' },
      keyId: KEY_ID,
      secret: SECRET,
    })
    expect(badGeneration.kind).toBe('err')
    if (badGeneration.kind === 'err') expect(badGeneration.error.subcause).toBe('prm-generation-invalid')

    const forgedDigest = { ...projection(), digest: 'sha256:deadbeef' }
    const badDigest = signProjectionEnvelope({
      crypto: TEST_CRYPTO,
      projection: forgedDigest,
      generation: 1,
      issuedAtMs: NOW,
      signer: { kind: 'control', ref: 'daemon:control-plane@demo' },
      keyId: KEY_ID,
      secret: SECRET,
    })
    expect(badDigest.kind).toBe('err')
    if (badDigest.kind === 'err') expect(badDigest.error.subcause).toBe('prm-digest-mismatch')
  })
})

describe('纪律：纯逻辑零 IO（签名正文可复算；不读时钟/随机/环境）', () => {
  it('prm 子域不 import 文件/网络/子进程/时钟（crypto 纯哈希沿 jcs.ts 先例）', () => {
    const files = readdirSync(PRM_DIR).filter((entry) => entry.endsWith('.ts'))
    expect(files).toContain('channel.ts')
    const banned = [/from 'node:fs/, /from 'node:net/, /from 'node:http/, /from 'node:child_process/, /from 'node:os/]
    for (const file of files) {
      const source = readFileSync(`${PRM_DIR}${file}`, 'utf8')
      for (const pattern of banned) expect(source, `${file} 命中 ${String(pattern)}`).not.toMatch(pattern)
      // Date.now()/new Date() 属读时钟；channel.ts 只允许 Date.parse（显式入参）
      expect(source).not.toMatch(/Date\.now\(\)|new Date\(\)/)
    }
  })
})
