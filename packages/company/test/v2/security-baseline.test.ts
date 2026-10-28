/**
 * MIG-05 / IMPL-05-07 · SEC-FC-03 坏锚 fail-closed（O 侧前半）
 *
 * 依据：docs/v2/15 §一 SEC-FC-03（「信任锚坏值放行」：坏 JSON/形状不符返回 null＝无锚；
 * 闸门 if(anchor !== null) 即跳过校验）；docs/v2/03 §八；docs/plan/05 IMPL-05-07
 * （`:86-109` 坏锚≠无锚：解析失败改抛错）；SEC-FC-03 后半（hot-reload 应用门＋ESCALATE）
 * 归 IMPL-07-07。
 *
 * 断言面（坏锚≠无锚，两类事实分开）：
 *   1. 无锚（文件不存在）＝ `readTrustAnchor` 返回 null；`trustStateOf` 保持 init 通道受信；
 *      `inspectTrustAnchor` 返回 absent——「无锚」仍是合法装配态。
 *   2. 坏 JSON / 形状不符 / 不可读＝抛 `TrustAnchorError`（不返回 null、不回落无锚）；
 *      `trustStateOf` 同样抛（不得折算成 trusted=true）；`inspectTrustAnchor` 返回 invalid
 *      （与 absent 分列），错误对象带 reason/file。
 *   3. 写入/批准/撤销/升级通道因同读锚一并 fail-closed：坏锚在场时不静默覆盖（文件字节不变）。
 *   4. 合法锚的读写/批准链路保持兼容（旧 API 签名不变，history 逐条验型）。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  approveCompanyDirectory,
  inspectTrustAnchor,
  parseTrustAnchor,
  readTrustAnchor,
  reseedTrustAnchorOnUpgrade,
  revokeTrust,
  seedTrustAnchor,
  trustStateOf,
  TrustAnchorError,
  writeTrustAnchor,
} from '../../src/trust.ts'
import type { TrustAnchor } from '../../src/trust.ts'

let root = ''

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'studio-next-sec-fc03-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

let seq = 0
/** 新公司目录（.studio-next/ 已建，锚文件按需写）。 */
function companyDir(label: string): string {
  seq += 1
  const dir = path.join(root, `${String(seq).padStart(2, '0')}-${label}`)
  mkdirSync(path.join(dir, '.studio-next'), { recursive: true })
  return dir
}

const ANCHOR_FILE = '.studio-next/trust.json'

/** 内容指纹面用文件表（与锚目录无关的纯内容输入）。 */
const files = { 'org-config.yaml': 'schema: org-config/v1\n', 'charter.md': '# 章程\n' }

function writeAnchorRaw(dir: string, raw: string): string {
  const file = path.join(dir, ANCHOR_FILE)
  writeFileSync(file, raw, 'utf8')
  return file
}

function validAnchor(): TrustAnchor {
  return {
    schema: 'studio-next/trust@1',
    slug: 'demo-corp',
    trust: true,
    fingerprint: 'sha256:abc123',
    history: [
      { action: 'import', by: '制作人', at: '2026-10-28T00:00:00.000Z', fingerprint: 'sha256:abc123' },
      { action: 'approve', by: '制作人', at: '2026-10-28T00:01:00.000Z', fingerprint: 'sha256:abc123' },
    ],
  }
}

function catchTrustError(run: () => unknown): TrustAnchorError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(TrustAnchorError)
    return error as TrustAnchorError
  }
  throw new Error('期望抛 TrustAnchorError，但未抛（坏锚被当成了无锚/合法锚）')
}

// ───────────────────────── 一、无锚（合法装配态） ─────────────────────────

describe('SEC-FC-03 · 无锚与坏锚分开：无锚不是坏锚', () => {
  it('无锚文件 → null（init 通道：trustStateOf trusted=true，anchor=null；inspect=absent）', () => {
    const dir = companyDir('absent')
    expect(readTrustAnchor(dir)).toBeNull()
    expect(trustStateOf(dir)).toEqual({ trusted: true, anchor: null })
    expect(inspectTrustAnchor(dir)).toEqual({ kind: 'absent' })
  })
})

// ───────────────────────── 二、坏 JSON（解析失败≠无锚） ─────────────────────────

describe('SEC-FC-03 · 坏 JSON fail-closed（抛错而非 null）', () => {
  it('坏 JSON → TrustAnchorError(reason=json)，绝不返回 null', () => {
    const dir = companyDir('bad-json')
    writeAnchorRaw(dir, '{ "schema": "studio-next/trust@1", ')
    const error = catchTrustError(() => readTrustAnchor(dir))
    expect(error.reason).toBe('json')
    expect(error.name).toBe('TrustAnchorError')
    expect(error.message).toContain('坏锚≠无锚')
    expect(error.file?.endsWith(ANCHOR_FILE)).toBe(true)
  })

  it('空文件 → 同样 json 错误（不是「空锚=无锚」）', () => {
    const dir = companyDir('empty')
    writeAnchorRaw(dir, '')
    expect(catchTrustError(() => readTrustAnchor(dir)).reason).toBe('json')
  })

  it('trustStateOf 对坏锚同样抛错——不得折算成「无锚→trusted=true」', () => {
    const dir = companyDir('truststate-bad')
    writeAnchorRaw(dir, 'not-json')
    const error = catchTrustError(() => trustStateOf(dir))
    expect(error.reason).toBe('json')
  })
})

// ───────────────────────── 三、形状不符（逐项验型） ─────────────────────────

describe('SEC-FC-03 · 形状不符 fail-closed（「像锚」不算锚）', () => {
  const badShapes: ReadonlyArray<{ label: string; raw: string }> = [
    { label: '根为数组', raw: JSON.stringify([]) },
    { label: '根为 null', raw: JSON.stringify(null) },
    { label: 'schema 不符', raw: JSON.stringify({ schema: 'studio-next/trust@2', slug: 'x', trust: true, fingerprint: null, history: [] }) },
    { label: 'slug 缺失', raw: JSON.stringify({ schema: 'studio-next/trust@1', trust: true, fingerprint: null, history: [] }) },
    { label: 'trust 非布尔', raw: JSON.stringify({ schema: 'studio-next/trust@1', slug: 'x', trust: 'true', fingerprint: null, history: [] }) },
    { label: 'fingerprint 缺失', raw: JSON.stringify({ schema: 'studio-next/trust@1', slug: 'x', trust: true, history: [] }) },
    { label: 'fingerprint 非串非 null', raw: JSON.stringify({ schema: 'studio-next/trust@1', slug: 'x', trust: true, fingerprint: 42, history: [] }) },
    { label: 'history 非数组', raw: JSON.stringify({ schema: 'studio-next/trust@1', slug: 'x', trust: true, fingerprint: null, history: {} }) },
    { label: 'history 条目非对象', raw: JSON.stringify({ schema: 'studio-next/trust@1', slug: 'x', trust: true, fingerprint: null, history: ['import'] }) },
    { label: 'history 条目缺 at', raw: JSON.stringify({ schema: 'studio-next/trust@1', slug: 'x', trust: true, fingerprint: null, history: [{ action: 'import', by: 'x' }] }) },
    { label: 'history action 未登记', raw: JSON.stringify({ schema: 'studio-next/trust@1', slug: 'x', trust: true, fingerprint: null, history: [{ action: 'bless', by: 'x', at: '2026-10-28' }] }) },
    { label: 'history note 非串', raw: JSON.stringify({ schema: 'studio-next/trust@1', slug: 'x', trust: true, fingerprint: null, history: [{ action: 'import', by: 'x', at: '2026-10-28', note: 1 }] }) },
  ]

  for (const candidate of badShapes) {
    it(`${candidate.label} → shape 错误（不是 null）`, () => {
      const dir = companyDir(`shape-${badShapes.indexOf(candidate)}`)
      writeAnchorRaw(dir, candidate.raw)
      const error = catchTrustError(() => readTrustAnchor(dir))
      expect(error.reason).toBe('shape')
    })
  }

  it('parseTrustAnchor 纯函数同规则：合法对象通过且逐条 history 验型；非对象/坏 action 抛 shape', () => {
    expect(parseTrustAnchor(validAnchor())).toEqual(validAnchor())
    expect(catchTrustError(() => parseTrustAnchor(null)).reason).toBe('shape')
    expect(catchTrustError(() => parseTrustAnchor({ ...validAnchor(), history: [{ action: 'bless', by: 'x', at: 'y' }] })).reason).toBe('shape')
  })

  it('锚文件不可读（路径为目录）→ unreadable 错误（不可读≠无锚）', () => {
    const dir = companyDir('unreadable')
    mkdirSync(path.join(dir, ANCHOR_FILE), { recursive: true })
    expect(catchTrustError(() => readTrustAnchor(dir)).reason).toBe('unreadable')
  })
})

// ───────────────────────── 四、三态判别（absent/invalid 分开） ─────────────────────────

describe('SEC-FC-03 · inspectTrustAnchor 三态判别（供热重载前置，IMPL-07-07）', () => {
  it('坏锚 → kind=invalid（不是 absent），错误对象原样携带', () => {
    const dir = companyDir('inspect-bad')
    writeAnchorRaw(dir, '{oops')
    const inspected = inspectTrustAnchor(dir)
    expect(inspected.kind).toBe('invalid')
    if (inspected.kind === 'invalid') {
      expect(inspected.error).toBeInstanceOf(TrustAnchorError)
      expect(inspected.error.reason).toBe('json')
    }
    expect(inspected).not.toEqual({ kind: 'absent' })
  })

  it('合法锚 → kind=valid，anchor 与 readTrustAnchor 同值', () => {
    const dir = companyDir('inspect-valid')
    const anchor = validAnchor()
    writeTrustAnchor(dir, anchor)
    const inspected = inspectTrustAnchor(dir)
    expect(inspected.kind).toBe('valid')
    if (inspected.kind === 'valid') expect(inspected.anchor).toEqual(anchor)
    expect(readTrustAnchor(dir)).toEqual(anchor)
    expect(trustStateOf(dir)).toEqual({ trusted: true, anchor })
  })
})

// ───────────────────────── 五、写/批准/撤销链路同读锚 fail-closed ─────────────────────────

describe('SEC-FC-03 · 坏锚在场时写通道不静默覆盖（fail-closed）', () => {
  it('approveCompanyDirectory：坏锚 → 抛错且锚文件字节不变（不重写、不降级为 seed）', () => {
    const dir = companyDir('approve-bad')
    const file = writeAnchorRaw(dir, '{oops')
    const before = readFileSync(file, 'utf8')
    expect(catchTrustError(() => approveCompanyDirectory(dir, files, { by: '制作人', at: '2026-10-28' })).reason).toBe('json')
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('reseed upgrade：坏锚 → 抛错且锚文件不变（不得借升级覆盖坏锚）', () => {
    const dir = companyDir('reseed-bad')
    const file = writeAnchorRaw(dir, '{"schema":"wrong"}')
    const before = readFileSync(file, 'utf8')
    expect(catchTrustError(() => reseedTrustAnchorOnUpgrade(dir, 'demo-corp', files, { by: '制作人', at: '2026-10-28' })).reason).toBe('shape')
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('revokeTrust：坏锚 → 抛错且锚文件不变（不得把坏锚当「无锚」静默返回）', () => {
    const dir = companyDir('revoke-bad')
    const file = writeAnchorRaw(dir, 'not-json')
    const before = readFileSync(file, 'utf8')
    expect(catchTrustError(() => revokeTrust(dir, { by: 'daemon/hot-reload', at: '2026-10-28' })).reason).toBe('json')
    expect(readFileSync(file, 'utf8')).toBe(before)
  })
})

// ───────────────────────── 六、合法链路兼容（旧 API 不破） ─────────────────────────

describe('SEC-FC-03 · 合法锚链路保持兼容（外部 API 签名不变）', () => {
  it('import 落锚 trust=false → 读回一致；approve 追加留痕并 trust=true；trustStateOf 跟随', () => {
    const dir = companyDir('happy-path')
    const seeded = seedTrustAnchor(dir, 'demo-corp', files, { by: '制作人', at: '2026-10-28T00:00:00.000Z' })
    expect(seeded.trust).toBe(false)
    expect(readTrustAnchor(dir)).toEqual(seeded)
    expect(trustStateOf(dir).trusted).toBe(false)

    const approved = approveCompanyDirectory(dir, files, { by: '制作人', at: '2026-10-28T00:01:00.000Z' })
    expect(approved.trust).toBe(true)
    expect(approved.history.map((entry) => entry.action)).toEqual(['import', 'approve'])
    const reread = readTrustAnchor(dir)
    expect(reread).toEqual(approved)
    expect(trustStateOf(dir).trusted).toBe(true)
  })

  it('已批准且指纹相同 → approve 幂等（不追加重复 history）', () => {
    const dir = companyDir('idempotent')
    const first = approveCompanyDirectory(dir, files, { by: '制作人', at: '2026-10-28T00:00:00.000Z' })
    const second = approveCompanyDirectory(dir, files, { by: '制作人', at: '2026-10-28T00:02:00.000Z' })
    expect(second).toEqual(first)
    expect(second.history).toHaveLength(1)
  })

  it('TrustAnchorError 是 Error 子类（可被既有错误分类链识别）', () => {
    const error = catchTrustError(() => parseTrustAnchor({}))
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('TrustAnchorError')
    expect(error.reason).toBe('shape')
    expect(error.file).toBeNull()
  })
})
