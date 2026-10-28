/**
 * trust-anchor.test.ts —— NEG-SEC-04 / N-d：坏锚自动应用被拒（SEC-FC-03 后半）
 *
 * 依据：v2/15 §一 SEC-FC-03（坏锚≠无锚；解析失败/形状不符＝拒绝热重载自动应用＋ESCALATE
 *   具名接收者，重复出现拒启；「无锚」只允许出现在显式声明无锚的装配并记台账）；v2/17
 *   NEG-SEC-04；docs/plan/05 IMPL-07-07；docs/plan/02 §五-5 裁决（O 侧 trust 抛错先行，
 *   E 侧 hot-reload 应用门前置「锚在场且校验过」）。
 *
 * 断言口径（放行路径必须不存在）：
 *   1. 坏 JSON / 形状不符 / 不可读 → 自动应用被拒（apply 零调用）＋ ESCALATE 具名接收者；
 *   2. 坏锚重复出现 → 自动面停用（不静默重试）＋ 坏锚在场构造即拒启（CONFIG_INVALID）；
 *   3. 无锚 ≠ 坏锚：未声明无锚→拒（不按坏锚计停用），显式声明→可应用且台账留痕；
 *   4. 合法锚 → 自动应用照常（正向对照，闸不误伤）。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  TRUST_DIR,
  approveCompanyDirectory,
  initCompany,
  inspectTrustAnchor,
  readDirectoryFiles,
  seedTrustAnchor,
} from '@studio-next/company'
import type { EventRecord } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { createHotReload, writeReloadRequest, type AnchorAbsenceDeclaration, type HotReload, type HotReloadReport } from '../../../src/control/hot-reload.ts'

const T0 = Date.parse('2026-10-28T00:00:00.000Z')
const DEPT = 'departments/工程部'
/** initCompany 的 git 首提身份（只作用于测试进程，不注入框架身份） */
const GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'studio-next-trust-anchor-test',
  GIT_AUTHOR_EMAIL: 'trust-anchor@studio-next.invalid',
  GIT_COMMITTER_NAME: 'studio-next-trust-anchor-test',
  GIT_COMMITTER_EMAIL: 'trust-anchor@studio-next.invalid',
}

let root = ''
let hi = 0
let ledgerSeq = 0
const ledgers: Ledger[] = []

beforeAll(() => {
  Object.assign(process.env, GIT_ENV)
  root = mkdtempSync(path.join(tmpdir(), 'studio-next-trust-anchor-'))
})

afterAll(() => {
  for (const ledger of ledgers) ledger.close()
  rmSync(root, { recursive: true, force: true })
})

/** 确定性 ULID（26 位 Crockford 字符；e2e/hot-reload 旧测试同款） */
function deterministicIds(): (ts: number) => string {
  return (_ts: number): string => {
    hi += 1
    return '0'.repeat(10) + String(hi).padStart(16, '0')
  }
}

function makeClock(): { now(): number; advance(ms: number): void } {
  let t = T0
  return { now: (): number => t, advance: (ms: number): void => { t += ms } }
}

/** 新建一家公司目录（init 通道；无锚） */
async function newCompany(slug: string): Promise<string> {
  const dir = path.join(root, slug)
  await initCompany({ slug, targetDir: dir })
  return dir
}

/** 写信任锚（测试直写——绕过写口以模拟坏 JSON/形状不符） */
function writeAnchor(dir: string, text: string): void {
  writeFileSync(path.join(dir, TRUST_DIR, 'trust.json'), text, 'utf8')
}

interface Harness {
  dir: string
  rootDir: string
  ledger: Ledger
  hot: HotReload
  /** apply 真的被调用的次数（拒绝应用面恒 0） */
  applied: string[]
  clock: { now(): number; advance(ms: number): void }
  /** 改真配置面（org-config 追加注释 + 显式推 mtime）触发自动指纹监听 */
  bumpConfig(): void
}

interface HarnessOptions {
  /** valid＝先落锚并 approve（合法锚正向面） */
  anchor?: 'valid' | 'none'
  anchorAbsence?: AnchorAbsenceDeclaration
}

async function makeHarness(slug: string, dir: string, opts: HarnessOptions = {}): Promise<Harness> {
  if (opts.anchor === 'valid') {
    seedTrustAnchor(dir, slug, await readDirectoryFiles(dir), { by: 'daemon/git-import', at: new Date(T0).toISOString(), note: '导入落锚（测试）' })
    approveCompanyDirectory(dir, await readDirectoryFiles(dir), { by: '制作人-甲', at: new Date(T0 + 1000).toISOString(), note: '首版批准（测试）' })
  }
  ledgerSeq += 1
  const ledger = openLedger(path.join(root, `ledger-${ledgerSeq}.sqlite`))
  ledgers.push(ledger)
  const clock = makeClock()
  const applied: string[] = []
  const makeId = deterministicIds()
  const rootDir = path.join(root, `root-${ledgerSeq}`)
  let bump = 0
  const hot = createHotReload({
    companyDir: dir,
    rootDir,
    ledger,
    company: slug,
    clock: clock.now,
    makeId,
    log: (): void => undefined,
    deptFallback: DEPT,
    watch: true,
    minStableMs: 0,
    ...(opts.anchorAbsence !== undefined ? { anchorAbsence: opts.anchorAbsence } : {}),
    apply(next) {
      applied.push(next.slug)
      return { jobsSeeded: 0, jobsKept: 0, jobsRemoved: 0 }
    },
  })
  return {
    dir,
    rootDir,
    ledger,
    hot,
    applied,
    clock,
    bumpConfig(): void {
      bump += 1
      const target = path.join(dir, 'org-config.yaml')
      writeFileSync(target, `${readFileSync(target, 'utf8')}\n# trust-anchor-test 变更 ${bump}\n`, 'utf8')
      const at = new Date(Date.parse('2026-11-01T00:00:00.000Z') + bump * 10_000)
      utimesSync(target, at, at)
    },
  }
}

/** 自动面两拍：首见 pending（null）→ 稳定窗后真处理 */
async function autoReload(h: Harness): Promise<HotReloadReport | null> {
  expect(await h.hot.check()).toBeNull()
  h.clock.advance(1000)
  return h.hot.check()
}

function escalates(h: Harness, prefix: string): EventRecord[] {
  return h.ledger.queryEvents().filter((e) => e.event === 'ESCALATE' && (e.note ?? '').startsWith(prefix))
}

function reloadEvents(h: Harness): EventRecord[] {
  return h.ledger.queryEvents().filter((e) => e.event === 'SCHEMA_EVOLVE' && (e.note ?? '').startsWith('RELOAD;'))
}

describe('SEC-FC-03 后半 / NEG-SEC-04：坏锚自动应用被拒（hot-reload 应用门前置）', () => {
  it('坏 JSON：拒自动应用（apply 零调用）+ ESCALATE 具名接收者（reason=json）', async () => {
    const dir = await newCompany('bad-json')
    const h = await makeHarness('bad-json', dir, { anchor: 'valid' })
    writeAnchor(dir, '{"schema": "studio-next/trust@1",')
    h.bumpConfig()

    const report = await autoReload(h)

    expect(report?.kind).toBe('trust-anchor-invalid')
    expect(h.applied).toEqual([]) // 放行路径不存在：apply 未被调用
    expect(inspectTrustAnchor(dir).kind).toBe('invalid') // 坏锚≠无锚（三态判别）
    const evts = escalates(h, 'RELOAD_TRUST_ANCHOR_INVALID')
    expect(evts).toHaveLength(1)
    expect(evts[0]?.note).toContain('reason=json')
    expect(evts[0]?.note).toContain('接收者=制作人')
    expect(evts[0]?.dept).toBe(DEPT) // 具名接收者（I-11：事件 dept 有签收位置）
    expect(h.hot.stats.anchorRejects).toBe(1)
    expect(h.hot.stats.autoDisabled).toBe(false)
  })

  it('形状不符（缺 trust/fingerprint/history）：同上拒（reason=shape）', async () => {
    const dir = await newCompany('bad-shape')
    const h = await makeHarness('bad-shape', dir, { anchor: 'valid' })
    writeAnchor(dir, JSON.stringify({ schema: 'studio-next/trust@1', slug: 'bad-shape', trust: 'yes' }))
    h.bumpConfig()

    const report = await autoReload(h)

    expect(report?.kind).toBe('trust-anchor-invalid')
    expect(h.applied).toEqual([])
    const evts = escalates(h, 'RELOAD_TRUST_ANCHOR_INVALID')
    expect(evts).toHaveLength(1)
    expect(evts[0]?.note).toContain('reason=shape')
  })

  it('不可读（trust.json 被替换成目录）：拒自动应用（reason=unreadable）', async () => {
    const dir = await newCompany('bad-unreadable')
    const h = await makeHarness('bad-unreadable', dir, { anchor: 'valid' })
    const anchorPath = path.join(dir, TRUST_DIR, 'trust.json')
    rmSync(anchorPath)
    mkdirSync(anchorPath)
    h.bumpConfig()

    const report = await autoReload(h)

    expect(report?.kind).toBe('trust-anchor-invalid')
    expect(h.applied).toEqual([])
    expect(escalates(h, 'RELOAD_TRUST_ANCHOR_INVALID')[0]?.note).toContain('reason=unreadable')
  })

  it('坏锚重复出现：自动面停用（不静默重试，不再 apply）+ 坏锚在场构造即拒启', async () => {
    const dir = await newCompany('bad-repeat')
    const h = await makeHarness('bad-repeat', dir, { anchor: 'valid' })
    writeAnchor(dir, 'not-json-at-all')

    h.bumpConfig()
    expect((await autoReload(h))?.kind).toBe('trust-anchor-invalid')
    h.bumpConfig()
    expect((await autoReload(h))?.kind).toBe('trust-anchor-disabled')
    expect(h.applied).toEqual([])
    expect(h.hot.stats.autoDisabled).toBe(true)
    expect(h.hot.stats.anchorRejects).toBe(2)
    expect(escalates(h, 'RELOAD_TRUST_ANCHOR_INVALID')).toHaveLength(1)
    expect(escalates(h, 'RELOAD_TRUST_ANCHOR_DISABLED')).toHaveLength(1)

    // 停用后：再改配置也不重试、不静默放行（自动面零动作）
    h.bumpConfig()
    expect(await h.hot.check()).toBeNull()
    h.clock.advance(1000)
    expect(await h.hot.check()).toBeNull()
    expect(h.applied).toEqual([])

    // 坏锚在场＝拒启（不「先起来后补证明」）；构造期检查在基线之前
    expect(() =>
      createHotReload({
        companyDir: dir,
        rootDir: path.join(root, 'root-startup-bad'),
        ledger: h.ledger,
        company: 'bad-repeat',
        clock: h.clock.now,
        makeId: deterministicIds(),
        log: (): void => undefined,
        deptFallback: DEPT,
        watch: false,
        apply: () => ({ jobsSeeded: 0, jobsKept: 0, jobsRemoved: 0 }),
      }),
    ).toThrow(/CONFIG_INVALID：信任锚坏锚，拒绝启动/)
  })

  it('无锚≠坏锚：未声明无锚→拒（不按坏锚计停用）；显式声明后同一目录可应用且台账留痕', async () => {
    const dir = await newCompany('absent')
    const h = await makeHarness('absent', dir, { anchor: 'none' })
    expect(inspectTrustAnchor(dir).kind).toBe('absent')

    h.bumpConfig()
    const first = await autoReload(h)
    expect(first?.kind).toBe('trust-anchor-absent')
    expect(h.applied).toEqual([])
    expect(escalates(h, 'RELOAD_TRUST_ANCHOR_INVALID')).toHaveLength(0) // 无锚不冒充坏锚
    const absent = escalates(h, 'RELOAD_TRUST_ANCHOR_ABSENT')
    expect(absent).toHaveLength(1)
    expect(absent[0]?.note).toContain('无锚≠坏锚')
    expect(absent[0]?.note).toContain('接收者=制作人')
    expect(h.hot.stats.autoDisabled).toBe(false)

    // 重复缺失仍按「缺失」处置（不累计坏锚停用）——缺失与坏锚两类事实分开
    h.bumpConfig()
    expect((await autoReload(h))?.kind).toBe('trust-anchor-absent')
    expect(h.hot.stats.autoDisabled).toBe(false)

    // 显式声明无锚的装配（init 通道）：放行并记台账（RELOAD note 携声明人）
    const declared = await makeHarness('absent', dir, { anchor: 'none', anchorAbsence: { declaredBy: 'test/init-channel' } })
    declared.bumpConfig()
    const applied = await autoReload(declared)
    expect(applied?.kind).toBe('reloaded')
    expect(declared.applied).toEqual(['absent'])
    const evt = reloadEvents(declared)[0]
    expect(evt?.note).toContain('anchor=absent-declared:test/init-channel')
  })

  it('合法锚（valid）：显式 re-approve 后手动 reload 照常应用（SCHEMA_EVOLVE·RELOAD，闸不误伤）', async () => {
    const dir = await newCompany('valid-anchor')
    const h = await makeHarness('valid-anchor', dir, { anchor: 'valid' })
    h.bumpConfig()
    // 合法变更走「显式 re-approve → 手动 reload」通道（自动面在任何内容变更后必是漂移，fail-closed）
    await approveCompanyDirectory(dir, await readDirectoryFiles(dir), {
      by: '制作人-甲',
      at: new Date(h.clock.now()).toISOString(),
      note: '复核变更后有意接受（测试）',
    })
    writeReloadRequest(h.rootDir, { id: 'valid-anchor-reload-1', company: 'valid-anchor', requestedAt: h.clock.now() })

    const report = await h.hot.check()

    expect(report?.kind).toBe('reloaded')
    expect(h.applied).toEqual(['valid-anchor'])
    expect(escalates(h, 'RELOAD_TRUST_ANCHOR_')).toHaveLength(0)
    const evt = reloadEvents(h)[0]
    expect(evt?.note).toContain('anchor=valid:valid-anchor')
    expect(h.hot.stats.reloads).toBe(1)
  })
})
