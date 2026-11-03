/**
 * root-delegation-wire.test.ts —— daemon 侧根委任启动验签接线（SEC-ROOT-02 启动腿；studio-dev-530）
 *
 * 依据：docs/v2/15 §7.3（启动验签五步：读 REC-AUTH-01 → 验外部证明 → 比对指纹 → 校验
 *   scope/term/revocable → 写启动结论；任一失败＝CONFIG_INVALID 拒启，禁「先起来后补」）；
 *   §7.2（三不入＋不入日志：只允许指纹与引用）；docs/v2/17 §4.1 NEG-ORG-09（无有效委任）/
 *   NEG-ORG-10（撤回轮换后旧签名）/NEG-ORG-11（scoped 不得行 root）/NEG-ORG-12（超范围）；
 *   docs/17-§2（主循环七相位：装载在装配期，不新增相位/不改拍内行为）。
 *
 * 断言口径（定向红→绿）：
 *   ① 有委任 → 装配通过且留痕（trace 记录引用/指纹/行使人/期限/凭据类别，日志同源）；
 *   ② 无委任 → rootPreflight 仍拒 gw-root-no-delegation（行为与接线前一致，不误放行）；
 *   ③ 坏委任/缺证明/指纹不符/期限外/已撤回 → 构造期 CONFIG_INVALID（对象不产出）。
 */
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { rootKeyFingerprint } from '@studio-next/gateway'
import { openLedger, type Ledger } from '@studio-next/store'
import { buildServeRuntime } from '../../../src/assembly/serve/runtime.ts'
import { GATEWAY_SECRET_ENV, daemonIdentity, parseDaemonConfig } from '../../../src/assembly/serve/config.ts'
import {
  loadRootDelegationFace,
  ROOT_DELEGATION_BUNDLE_SCHEMA,
  ROOT_DELEGATION_FILE_ENV,
  type RootDelegationEnv,
} from '../../../src/assembly/serve/root-delegation/root-face.ts'
import { wireWorkerKeys } from '../../../src/assembly/serve/root-delegation/worker-key-face.ts'
import { wireGatedPlatform } from '../../../src/assembly/platform/wire.ts'
import { createFakePlatform } from '../../../src/engine/fakes.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/demo/demo-snapshot.ts'

const AT_MS = Date.parse('2026-06-01T00:00:00Z')
const AT_ISO = new Date(AT_MS).toISOString()
const TERM = { from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z' }
const SECRET_TEXT = '0123456789abcdef0123456789abcdef'
const ROOT_MATERIAL = new TextEncoder().encode('root-key-material-530-never-logged')
const ROOT_FP = rootKeyFingerprint(ROOT_MATERIAL)
const CLOCK = (): number => AT_MS

const CONFIG = parseDaemonConfig(
  ['db: ./var/x.sqlite', 'company: demo', 'platform: fake', 'rootDir: ./var', ''].join('\n'),
)
const IDENTITY = daemonIdentity(CONFIG, DEMO_SNAPSHOT, { env: { [GATEWAY_SECRET_ENV]: SECRET_TEXT } })
const IN_SCOPE = { actionScope: ['appoint_g8'], signerFingerprint: ROOT_FP }

/** REC-AUTH-01 根授予（只造判定消费的字段；形状闸归 contract v2/11 §2.2） */
function rootGrant(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recordId: 'root-grant-530',
    recordType: 'REC-AUTH-01',
    schemaRef: { schemaId: 'studio-next.records.v2', schemaVersion: '1.0.0' },
    specVersion: '2.0.0',
    companyRef: 'demo',
    producedAt: AT_ISO,
    producer: { decidedBy: 'external-owner', writtenBy: 'daemon:records' },
    basisRefs: [],
    payload: {
      grantor: { refId: 'external-owner', refVersion: '1.0.0' },
      grantee: { refId: 'g9.internal-boss', refVersion: '1.0.0' },
      parent_grant: { refType: 'REC-LIFE-07', refId: 'founding-record-1', refVersion: '1.0.0' },
      grant_class: 'root_delegation',
      scope: {
        purpose: '以内部老板身份签发内部硬动作',
        object: '经营权限',
        included: ['approve_internal_hard_action', 'appoint_g8'],
        forbidden: ['外部审计', '清算'],
      },
      conditions: [],
      term: TERM,
      delegable: true,
      withdrawal_terms: '外部老板随时撤回/轮换',
      conflict_check_ref: { refType: 'REC-LIFE-05', refId: 'conflict-1', refVersion: '1.0.0' },
      key_fingerprint: ROOT_FP,
      external_signature: { refId: 'signature-artifact-1' },
      proof_mode: 'ritual_and_key',
      ...overrides,
    },
    effectiveState: 'effective',
    effectiveTime: { from: '2026-01-01T00:00:00Z' },
  }
}

/** REC-AUTH-03 撤回/轮换记录（撤回目标＝根授予） */
function withdrawal(targetId: string): Record<string, unknown> {
  return {
    recordId: 'withdrawal-530',
    recordType: 'REC-AUTH-03',
    payload: {
      withdrawn_grant: { refType: 'REC-AUTH-01', refId: targetId, refVersion: '1.0.0' },
      reason: 'active_withdrawal',
      withdrawn_grant_class: 'root_delegation',
      effective_time: AT_ISO,
    },
    effectiveState: 'effective',
  }
}

/** 部署信任域授权包（合法基座） */
function bundle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: ROOT_DELEGATION_BUNDLE_SCHEMA,
    delegation: rootGrant(),
    trustedFingerprint: ROOT_FP,
    proof: { verified: true, verifier: 'trust-domain:offline-approval-530', verifiedAt: AT_ISO },
    subject: { grantorClass: 'external_owner', actorClass: 'internal_boss', credentialClass: 'root' },
    ...overrides,
  }
}

const roots: string[] = []
function makeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sn-root-530-'))
  roots.push(dir)
  return dir
}

/** 落载体文件（默认 0644：可读、非组/世界可写——信任域基线形态） */
function writeBundleFile(dir: string, content: unknown): string {
  const file = path.join(dir, 'root-delegation.json')
  writeFileSync(file, JSON.stringify(content), 'utf8')
  return file
}

function load(
  file: string | undefined,
  log: string[] = [],
  extraEnv: RootDelegationEnv = {},
): ReturnType<typeof loadRootDelegationFace> {
  const env: Record<string, string | undefined> = { ...extraEnv }
  if (file !== undefined) env[ROOT_DELEGATION_FILE_ENV] = file
  return loadRootDelegationFace({ env, log: (line) => log.push(line) })
}

function loadError(file: string): string {
  try {
    load(file)
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
  throw new Error('期望装载期抛 CONFIG_INVALID，实际返回了 root 面（fail-closed 被破坏）')
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('SEC-ROOT-02 启动腿·装载面：无委任＝不装 root 面（不误放行）', () => {
  it('env 缺省/空值 → 不产 root 面，日志明示 gw-root-no-delegation（「没配」≠「不用验」）', () => {
    const lines: string[] = []
    expect(load(undefined, lines)).toBeUndefined()
    expect(lines.join('\n')).toContain('gw-root-no-delegation')
    expect(lines.join('\n')).toContain(ROOT_DELEGATION_FILE_ENV)
    const blank: string[] = []
    expect(loadRootDelegationFace({ env: { [ROOT_DELEGATION_FILE_ENV]: '   ' }, log: (l) => blank.push(l) })).toBeUndefined()
  })
})

describe('SEC-ROOT-02 启动腿·装载面：有委任＝通过且留痕（引用/指纹/行使人/期限/凭据类别）', () => {
  it('合法授权包 → root 面产出（trace 五要件齐＋证明结论），日志同源且不含材料/路径', () => {
    const dir = makeDir()
    const file = writeBundleFile(dir, bundle())
    const lines: string[] = []
    const face = load(file, lines)
    expect(face).toBeDefined()
    if (face === undefined) return
    expect(face.trace).toEqual({
      delegationRef: 'root-grant-530',
      fingerprint: ROOT_FP,
      grantorClass: 'external_owner',
      actorClass: 'internal_boss',
      credentialClass: 'root',
      termFrom: '2026-01-01T00:00:00.000Z',
      termTo: '2027-01-01T00:00:00.000Z',
      proofMode: 'ritual_and_key',
      proofVerifier: 'trust-domain:offline-approval-530',
      proofVerifiedAt: AT_ISO,
      source: `env:${ROOT_DELEGATION_FILE_ENV}`,
    })
    expect(face.options.proofVerified).toBe(true)
    expect(face.options.trustedFingerprint).toBe(ROOT_FP)
    const log = lines.join('\n')
    // 装载面只报「已载入」：结论行归构造期（createGateway 成功后）——先喊「已验」＝把载入伪装成验过
    expect(log).toContain('root 委任已载入')
    expect(log).not.toContain('root 委任已验')
    expect(log).toContain('root-grant-530')
    expect(log).toContain(ROOT_FP)
    // 三不入：材料值/载体路径不得进日志
    expect(log).not.toContain(new TextDecoder().decode(ROOT_MATERIAL))
    expect(log).not.toContain(dir)
  })

  it('撤回面是「当前值源」：载入后写入 REC-AUTH-03 → 下一次 preflight 即拒（无宽限窗口，NEG-ORG-10）', () => {
    const dir = makeDir()
    const file = writeBundleFile(dir, bundle())
    const face = load(file)
    const workerKeys = wireWorkerKeys(CONFIG, IDENTITY, CLOCK, () => {}, face)
    expect(workerKeys?.gateway.rootPreflight(IN_SCOPE).allowed).toBe(true)
    // 运行期写入撤回（外部老板撤回/轮换）——不重启 daemon，下一次判定即拒
    writeBundleFile(dir, bundle({ withdrawals: [withdrawal('root-grant-530')] }))
    expect(workerKeys?.gateway.rootPreflight(IN_SCOPE)).toEqual({ allowed: false, reason: 'gw-root-revoked' })
  })

  it('载入后载体被删/不可读 → preflight 按「已撤回」拒（读不回≠没撤回，fail-closed）', () => {
    const dir = makeDir()
    const file = writeBundleFile(dir, bundle())
    const face = load(file)
    const workerKeys = wireWorkerKeys(CONFIG, IDENTITY, CLOCK, () => {}, face)
    rmSync(file, { force: true })
    expect(workerKeys?.gateway.rootPreflight(IN_SCOPE)).toEqual({ allowed: false, reason: 'gw-root-revoked' })
  })
})

describe('SEC-ROOT-02 启动腿·装载面：坏载体/缺证明 fail-closed（构造期拒，禁先起来后补）', () => {
  it('载体不存在/坏 JSON/格式版本不符 → CONFIG_INVALID/gw-root-delegation-invalid', () => {
    const dir = makeDir()
    expect(loadError(path.join(dir, 'missing.json'))).toMatch(/CONFIG_INVALID\/gw-root-delegation-invalid/)
    const broken = path.join(dir, 'broken.json')
    writeFileSync(broken, '{not-json', 'utf8')
    expect(loadError(broken)).toMatch(/CONFIG_INVALID\/gw-root-delegation-invalid/)
    expect(loadError(writeBundleFile(dir, bundle({ schema: 'studio-next/root-delegation-bundle@0' })))).toMatch(
      /CONFIG_INVALID\/gw-root-delegation-invalid/,
    )
  })

  it('无 delegation / 记录类型不符 → 拒（无委任≠可放行；错类记录不得冒根授予）', () => {
    const dir = makeDir()
    expect(loadError(writeBundleFile(dir, bundle({ delegation: null })))).toMatch(/CONFIG_INVALID\/gw-root-no-delegation/)
    const misfiled = rootGrant()
    misfiled['recordType'] = 'REC-AUTH-02'
    expect(loadError(writeBundleFile(dir, bundle({ delegation: misfiled })))).toMatch(/CONFIG_INVALID\/gw-root-delegation-invalid/)
  })

  it('证明未核验/核验件缺失 → CONFIG_INVALID/gw-root-proof-unverified', () => {
    const dir = makeDir()
    expect(loadError(writeBundleFile(dir, bundle({ proof: { verified: false, verifier: 'x', verifiedAt: AT_ISO } })))).toMatch(
      /CONFIG_INVALID\/gw-root-proof-unverified/,
    )
    expect(loadError(writeBundleFile(dir, bundle({ proof: { verified: true } })))).toMatch(/CONFIG_INVALID\/gw-root-proof-unverified/)
  })

  it('信任指纹缺失/形态非法 → CONFIG_INVALID/gw-root-fingerprint-mismatch', () => {
    const dir = makeDir()
    expect(loadError(writeBundleFile(dir, bundle({ trustedFingerprint: undefined })))).toMatch(
      /CONFIG_INVALID\/gw-root-fingerprint-mismatch/,
    )
    expect(loadError(writeBundleFile(dir, bundle({ trustedFingerprint: 'sha256:placeholder' })))).toMatch(
      /CONFIG_INVALID\/gw-root-fingerprint-mismatch/,
    )
  })

  it('主体面三值缺失/撤回集合形态坏 → CONFIG_INVALID/gw-root-delegation-invalid', () => {
    const dir = makeDir()
    expect(loadError(writeBundleFile(dir, bundle({ subject: { grantorClass: 'external_owner' } })))).toMatch(
      /CONFIG_INVALID\/gw-root-delegation-invalid/,
    )
    expect(loadError(writeBundleFile(dir, bundle({ withdrawals: 'not-an-array' })))).toMatch(
      /CONFIG_INVALID\/gw-root-delegation-invalid/,
    )
  })

  it('载体为符号链接或组/世界可写 → 拒（信任域件被同机改写的形态不进装配）', () => {
    const dir = makeDir()
    const real = writeBundleFile(dir, bundle())
    const link = path.join(dir, 'link.json')
    symlinkSync(real, link)
    expect(loadError(link)).toMatch(/CONFIG_INVALID\/gw-root-delegation-invalid/)
    chmodSync(real, 0o666)
    expect(loadError(real)).toMatch(/CONFIG_INVALID\/gw-root-delegation-invalid/)
  })
})

describe('装配接线：root 面进 createGateway（有委任→通过；无委任→仍拒；坏委任→拒启）', () => {
  it('无 root 面 → wireWorkerKeys 产出的网关 rootPreflight 仍拒 gw-root-no-delegation（行为与接线前一致）', () => {
    const workerKeys = wireWorkerKeys(CONFIG, IDENTITY, CLOCK, () => {})
    expect(workerKeys).toBeDefined()
    expect(workerKeys?.gateway.rootPreflight(IN_SCOPE)).toEqual({ allowed: false, reason: 'gw-root-no-delegation' })
  })

  it('有 root 面 → wireWorkerKeys 构造期验过，rootPreflight 放行并回执记录引用/指纹（留痕）', () => {
    const dir = makeDir()
    const face = load(writeBundleFile(dir, bundle()))
    const workerKeys = wireWorkerKeys(CONFIG, IDENTITY, CLOCK, () => {}, face)
    expect(workerKeys?.gateway.rootPreflight(IN_SCOPE)).toEqual({
      allowed: true,
      delegationRef: 'root-grant-530',
      fingerprint: ROOT_FP,
      at: AT_ISO,
    })
  })

  it('指纹被篡改（委任指纹≠当前信任指纹）→ 构造期 CONFIG_INVALID/gw-root-fingerprint-mismatch（NEG-ORG-10）', () => {
    const dir = makeDir()
    const rotatedFp = rootKeyFingerprint(new TextEncoder().encode('rotated-root-key-530'))
    const face = load(writeBundleFile(dir, bundle({ trustedFingerprint: rotatedFp })))
    expect(face).toBeDefined()
    if (face === undefined) return
    expect(() => wireWorkerKeys(CONFIG, IDENTITY, CLOCK, () => {}, face)).toThrow(
      /CONFIG_INVALID\/gw-root-fingerprint-mismatch/,
    )
  })

  it('授予人非外部老板 → 构造期 CONFIG_INVALID/gw-root-grantor-ineligible（NEG-ORG-09）', () => {
    const dir = makeDir()
    const face = load(writeBundleFile(dir, bundle({ subject: { grantorClass: 'internal_boss', actorClass: 'internal_boss', credentialClass: 'root' } })))
    if (face === undefined) throw new Error('期望装载成功（主体值域判定归 gateway）')
    expect(() => wireWorkerKeys(CONFIG, IDENTITY, CLOCK, () => {}, face)).toThrow(/CONFIG_INVALID\/gw-root-grantor-ineligible/)
  })

  it('行使人非最高宰相 / scoped 凭据 → 构造期 CONFIG_INVALID（NEG-ORG-11）', () => {
    const dir = makeDir()
    const badActor = load(writeBundleFile(dir, bundle({ subject: { grantorClass: 'external_owner', actorClass: 'derived_executor', credentialClass: 'root' } })))
    if (badActor === undefined) throw new Error('期望装载成功（主体值域判定归 gateway）')
    expect(() => wireWorkerKeys(CONFIG, IDENTITY, CLOCK, () => {}, badActor)).toThrow(/CONFIG_INVALID\/gw-root-actor-ineligible/)
    const dir2 = makeDir()
    const scoped = load(writeBundleFile(dir2, bundle({ subject: { grantorClass: 'external_owner', actorClass: 'internal_boss', credentialClass: 'scoped' } })))
    if (scoped === undefined) throw new Error('期望装载成功（凭据类别判定归 gateway）')
    expect(() => wireWorkerKeys(CONFIG, IDENTITY, CLOCK, () => {}, scoped)).toThrow(/CONFIG_INVALID\/gw-root-credential-scoped/)
  })

  it('期限外（当前时钟越出 term）→ 构造期 CONFIG_INVALID/gw-root-term-out（NEG-ORG-12）', () => {
    const dir = makeDir()
    const face = load(writeBundleFile(dir, bundle()))
    if (face === undefined) throw new Error('期望装载成功')
    const afterTerm = (): number => Date.parse('2027-06-01T00:00:00Z')
    expect(() => wireWorkerKeys(CONFIG, IDENTITY, afterTerm, () => {}, face)).toThrow(/CONFIG_INVALID\/gw-root-term-out/)
  })

  it('载入时即已撤回（REC-AUTH-03 指向根授予）→ 装载期 CONFIG_INVALID/gw-root-revoked（NEG-ORG-10）', () => {
    const dir = makeDir()
    expect(() => load(writeBundleFile(dir, bundle({ withdrawals: [withdrawal('root-grant-530')] })))).toThrow(
      /CONFIG_INVALID\/gw-root-revoked/,
    )
  })

  it('平台写网关同样透传 root 面：坏委任＝装配期拒启（不是「先包上再说」）', () => {
    const platform = createFakePlatform({ now: (): string => AT_ISO })
    const dir = makeDir()
    const rotatedFp = rootKeyFingerprint(new TextEncoder().encode('rotated-root-key-530'))
    const bad = load(writeBundleFile(dir, bundle({ trustedFingerprint: rotatedFp })))
    if (bad === undefined) throw new Error('期望装载成功')
    expect(() =>
      wireGatedPlatform(platform, CONFIG, IDENTITY, CLOCK, () => {}, { root: bad.options }),
    ).toThrow(/CONFIG_INVALID\/gw-root-fingerprint-mismatch/)
  })
})

describe('装配接线：buildServeRuntime 启动期装载（env 通道；真装配面留痕）', () => {
  const withEnv = <T>(file: string | undefined, run: () => T): T => {
    const prior = process.env[ROOT_DELEGATION_FILE_ENV]
    if (file === undefined) delete process.env[ROOT_DELEGATION_FILE_ENV]
    else process.env[ROOT_DELEGATION_FILE_ENV] = file
    try {
      return run()
    } finally {
      if (prior === undefined) delete process.env[ROOT_DELEGATION_FILE_ENV]
      else process.env[ROOT_DELEGATION_FILE_ENV] = prior
    }
  }

  async function assemble(logs: string[]): Promise<{ runtime: ReturnType<typeof buildServeRuntime>; ledger: Ledger }> {
    const dir = makeDir()
    const config = parseDaemonConfig(
      [
        `db: ${JSON.stringify(path.join(dir, 'ledger.sqlite'))}`,
        'platform: fake',
        'company: demo',
        `rootDir: ${JSON.stringify(path.join(dir, 'var'))}`,
        'tickMs: 25',
        '',
      ].join('\n'),
    )
    const ledger = openLedger(config.db)
    try {
      const runtime = buildServeRuntime(config, ledger, DEMO_SNAPSHOT, {
        log: (line: string): void => {
          logs.push(line)
        },
        clock: CLOCK,
      })
      return { runtime, ledger }
    } catch (err) {
      ledger.close()
      throw err
    }
  }

  it('env 指向合法授权包 → runtime.rootDelegation 落 trace（引用/指纹/行使人/期限/凭据类别），日志同源', async () => {
    const dir = makeDir()
    const file = writeBundleFile(dir, bundle())
    const logs: string[] = []
    const assembled = await withEnv(file, () => assemble(logs))
    try {
      expect(assembled.runtime.rootDelegation?.delegationRef).toBe('root-grant-530')
      expect(assembled.runtime.rootDelegation?.fingerprint).toBe(ROOT_FP)
      expect(assembled.runtime.rootDelegation?.credentialClass).toBe('root')
      expect(logs.join('\n')).toContain('root 委任已验')
      expect(logs.join('\n')).not.toContain(new TextDecoder().decode(ROOT_MATERIAL))
    } finally {
      await assembled.runtime.stop()
    }
  })

  it('env 缺省 → runtime 无 root 面（不误放行），启动日志明示 gw-root-no-delegation', async () => {
    const logs: string[] = []
    const assembled = await withEnv(undefined, () => assemble(logs))
    try {
      expect(assembled.runtime.rootDelegation).toBeUndefined()
      expect(logs.join('\n')).toContain('gw-root-no-delegation')
    } finally {
      await assembled.runtime.stop()
    }
  })

  it('env 指向坏载体 → 装配期抛 CONFIG_INVALID（daemon 起不来；不落半面）', async () => {
    const dir = makeDir()
    const file = path.join(dir, 'nope.json')
    const logs: string[] = []
    await expect(withEnv(file, () => assemble(logs))).rejects.toThrow(/CONFIG_INVALID\/gw-root-delegation-invalid/)
  })
})
