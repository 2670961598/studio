/**
 * trust-cli.test.ts —— `company seed` / `company approve` CLI（studio-dev-508 修复方向②）
 *
 * 依据：docs/44-§2.3 条款4（批准指纹）/ docs/43 附录 A-3 / docs/v2/15 §一 SEC-FC-03
 *   （坏锚≠无锚；无锚只允许显式声明并记台账）。CLI 面此前自述欠账
 *   （apps/daemon/src/cli/company.ts 旧 L64「CLI 批准命令未立——docs/44 另案」）。
 *
 * 断言口径：
 *   1. seed：init 通道目录落锚 trust=false + 指纹=内容面（排除锚自指与 reports/）；
 *   2. seed 拒绝面：锚已在场/坏锚在场/--slug 不符/目录非法——一律 exit 1 且零改写；
 *   3. approve：--by 必填（署名可还原决定人）；无锚/坏锚拒绝；批准=trust=true + 留痕；
 *      重复批准幂等（零重复 history）；reports/ 写入不改批准指纹（否则产出即漂移）。
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  REPORTS_DIR,
  TRUST_DIR,
  contentFingerprint,
  excludeNonContentFiles,
  inspectTrustAnchor,
  readDirectoryFiles,
  readTrustAnchor,
} from '@studio-next/company'
import { cmdCompany } from '../../../src/cli/company.ts'

const TEMPLATE = fileURLToPath(new URL('../../../../../templates/company-2-level', import.meta.url))
const T0 = Date.parse('2026-11-03T00:00:00.000Z')

let root = ''

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'studio-next-trust-cli-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

/** 模板 → 公司目录（init 通道同形；不跑 git 首提） */
function makeCompany(slug: string): string {
  const dir = path.join(root, slug)
  cpSync(TEMPLATE, dir, { recursive: true })
  const orgPath = path.join(dir, 'org-config.yaml')
  const org = readFileSync(orgPath, 'utf8').replace('slug: example-corp', `slug: ${slug}`).replace('name: 示例公司', `name: ${slug}`)
  writeFileSync(orgPath, org, 'utf8')
  const metaPath = path.join(dir, '.studio-next.yaml')
  writeFileSync(metaPath, readFileSync(metaPath, 'utf8').replace('created_at: null', `created_at: ${new Date(T0).toISOString()}`), 'utf8')
  return dir
}

/** 捕获两流跑 cmdCompany（in-process） */
async function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const logs: string[] = []
  const errors: string[] = []
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')))
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errors.push(a.join(' ')))
  try {
    const code = await cmdCompany(argv)
    return { code, out: logs.join('\n'), err: errors.join('\n') }
  } finally {
    logSpy.mockRestore()
    errSpy.mockRestore()
  }
}

async function expectedFingerprint(dir: string): Promise<string> {
  return contentFingerprint(excludeNonContentFiles(await readDirectoryFiles(dir)))
}

describe('company seed：init 通道补锚（trust=false）', () => {
  it('落锚 trust=false + 指纹=内容面（锚自指与 reports/ 均排除）', async () => {
    const dir = makeCompany('seed-corp')
    const r = await run(['seed', dir, '--by', 'cli:test'])
    expect(r.code).toBe(0)
    expect(r.err).toBe('')
    expect(r.out).toContain('trust=false')
    const anchor = readTrustAnchor(dir)
    expect(anchor).not.toBeNull()
    expect(anchor?.slug).toBe('seed-corp')
    expect(anchor?.trust).toBe(false)
    expect(anchor?.fingerprint).toBe(await expectedFingerprint(dir))
    // reports/.gitkeep 在盘但不在指纹里（内容面排除）
    expect(anchor?.fingerprint).not.toBe(contentFingerprint(await readDirectoryFiles(dir)))
    expect(anchor?.history.map((h) => h.action)).toEqual(['import'])
    expect(anchor?.history[0]?.by).toBe('cli:test')
  })

  it('--json 机器面：单行 JSON 带 trust/fingerprint/action', async () => {
    const dir = makeCompany('seed-json')
    const r = await run(['seed', dir, '--json'])
    expect(r.code).toBe(0)
    const parsed = JSON.parse(r.out) as { ok: boolean; trust: boolean; slug: string; action: string; fingerprint: string }
    expect(parsed).toMatchObject({ ok: true, trust: false, slug: 'seed-json', action: 'import' })
    expect(parsed.fingerprint).toBe(await expectedFingerprint(dir))
  })

  it('锚已在场：拒（exit 1，零改写）', async () => {
    const dir = makeCompany('seed-twice')
    expect((await run(['seed', dir])).code).toBe(0)
    const before = readFileSync(path.join(dir, TRUST_DIR, 'trust.json'), 'utf8')
    const r = await run(['seed', dir])
    expect(r.code).toBe(1)
    expect(r.err).toContain('锚已在场')
    expect(readFileSync(path.join(dir, TRUST_DIR, 'trust.json'), 'utf8')).toBe(before)
  })

  it('坏锚在场：拒（SEC-FC-03 坏锚≠无锚，不覆盖坏值）', async () => {
    const dir = makeCompany('seed-bad-anchor')
    mkdirSync(path.join(dir, TRUST_DIR), { recursive: true })
    writeFileSync(path.join(dir, TRUST_DIR, 'trust.json'), 'not-json', 'utf8')
    const r = await run(['seed', dir])
    expect(r.code).toBe(1)
    expect(r.err).toContain('坏锚在场')
    expect(readFileSync(path.join(dir, TRUST_DIR, 'trust.json'), 'utf8')).toBe('not-json')
  })

  it('--slug 与目录真 slug 不符：拒（同家判据）', async () => {
    const dir = makeCompany('seed-slug')
    const r = await run(['seed', dir, '--slug', 'other-corp'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('不符')
    expect(inspectTrustAnchor(dir).kind).toBe('absent')
  })
})

describe('company approve：显式批准（trust=true + 留痕）', () => {
  it('--by 必填（署名可还原决定人——SEC-SIG-01）', async () => {
    const dir = makeCompany('approve-no-by')
    await run(['seed', dir])
    const r = await run(['approve', dir])
    expect(r.code).toBe(1)
    expect(r.err).toContain('缺少 --by')
    expect(readTrustAnchor(dir)?.trust).toBe(false) // 未批准面不动
  })

  it('无锚：拒（先 seed）', async () => {
    const dir = makeCompany('approve-absent')
    const r = await run(['approve', dir, '--by', '制作人-甲'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('无锚')
    expect(inspectTrustAnchor(dir).kind).toBe('absent')
  })

  it('坏锚：拒（不在坏值上批准）', async () => {
    const dir = makeCompany('approve-bad')
    mkdirSync(path.join(dir, TRUST_DIR), { recursive: true })
    writeFileSync(path.join(dir, TRUST_DIR, 'trust.json'), '{"schema":"studio-next/trust@1"}', 'utf8')
    const r = await run(['approve', dir, '--by', '制作人-甲'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('坏锚')
  })

  it('批准→trust=true 动作 approve；重复批准幂等（零重复 history）', async () => {
    const dir = makeCompany('approve-ok')
    await run(['seed', dir, '--by', 'cli:test'])
    const first = await run(['approve', dir, '--by', '制作人-甲', '--note', '首版批准'])
    expect(first.code).toBe(0)
    expect(first.out).toContain('trust=true')
    expect(first.out).toContain('动作=approve')
    const anchor = readTrustAnchor(dir)
    expect(anchor?.trust).toBe(true)
    expect(anchor?.fingerprint).toBe(await expectedFingerprint(dir))
    expect(anchor?.history.map((h) => h.action)).toEqual(['import', 'approve'])
    expect(anchor?.history[1]?.by).toBe('制作人-甲')

    const second = await run(['approve', dir, '--by', '制作人-甲'])
    expect(second.code).toBe(0)
    const after = readTrustAnchor(dir)
    expect(after?.history).toHaveLength(2) // 幂等：不追加重复 history
    expect(after?.fingerprint).toBe(anchor?.fingerprint)
  })

  it('reports/ 写入不改批准指纹：再次 approve 指纹不变（产出不是配置漂移）', async () => {
    const dir = makeCompany('approve-reports')
    await run(['seed', dir, '--by', 'cli:test'])
    expect((await run(['approve', dir, '--by', '制作人-甲'])).code).toBe(0)
    const before = readTrustAnchor(dir)?.fingerprint

    mkdirSync(path.join(dir, REPORTS_DIR, '工程部'), { recursive: true })
    writeFileSync(path.join(dir, REPORTS_DIR, '工程部', '2026-11-03-report-工程部-x.md'), '# 报表\n', 'utf8')

    const r = await run(['approve', dir, '--by', '制作人-甲', '--json'])
    expect(r.code).toBe(0)
    const parsed = JSON.parse(r.out) as { fingerprint: string; trust: boolean }
    expect(parsed.trust).toBe(true)
    expect(parsed.fingerprint).toBe(before)
    expect(readTrustAnchor(dir)?.fingerprint).toBe(before)
  })
})
