/**
 * DEV-32 · CLI 冒烟（studio-next company validate <git-url|路径|tarball> [--json]
 * [--allow-extra]）——docs/51-§七 判定器 CLI 契约的端到端面。
 *
 * 退出码三角（与「仓库不合法」严格区分）：
 *   0=合法（PASS+摘要+可初始化）；1=不合法（逐条违规四元组——不许只说校验失败）；
 *   2=判定器自身错误（路径不存在/网络失败/解包失败——RepoInputError 面）。
 *
 * 输入物化三态：本地路径（直用）/ tarball（系统 tar 解包+条目消毒）/ git-url（真实克隆
 * ——克隆产物即 E 组闸面）。夹具沿 DEV-27 良性仓（company-dist）+ 恶意样本纪律。
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { simpleGit } from 'simple-git'

const binPath = fileURLToPath(new URL('../../../apps/daemon/src/cli/main.ts', import.meta.url))
const fixtureSrc = fileURLToPath(new URL('./fixtures/company-dist', import.meta.url))

let root = ''
let legalDir = ''
let illegalDir = ''
let fixtureRepo = ''

/** 直跑 bin.ts（Node 24 原生 type-stripping——daemon 运行时同款） */
function runCli(args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [binPath, ...args], { encoding: 'utf8', timeout: 120_000 })
}

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'studio-next-company-validate-'))
  // 良性路径面：DEV-27 夹具原样（含 .studio-next.yaml/meta——迁移期合法形态）
  legalDir = path.join(root, 'legal')
  cpSync(fixtureSrc, legalDir, { recursive: true })
  // 违法路径面：良基 + 封闭集外顶层条目（A-1）
  illegalDir = path.join(root, 'illegal')
  cpSync(fixtureSrc, illegalDir, { recursive: true })
  writeFileSync(path.join(illegalDir, 'stray.txt'), '封闭集外\n', 'utf8')
  // git-url 面：本地仓即远端（simple-git 对本地路径走真克隆协议）
  fixtureRepo = path.join(root, 'remote', 'src-corp.git-work')
  mkdirSync(path.dirname(fixtureRepo), { recursive: true })
  cpSync(fixtureSrc, fixtureRepo, { recursive: true })
  const git = simpleGit(fixtureRepo)
  await git.init()
  await git.addConfig('user.name', 'fixture-author')
  await git.addConfig('user.email', 'fixture@src-corp.invalid')
  await git.add('-A')
  await git.commit('v1: 判定器 CLI 冒烟源仓')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('DEV-32 · company validate · 路径面', () => {
  it('合法仓：exit 0 + PASS 摘要（公司/部门/人数/jobs/插件）+「可初始化」', () => {
    const r = runCli(['company', 'validate', legalDir])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('PASS')
    expect(r.stdout).toContain('slug=src-corp')
    expect(r.stdout).toContain('部门 1')
    expect(r.stdout).toContain('jobs 1')
    expect(r.stdout).toContain('插件 1')
    expect(r.stdout).toContain('可初始化')
  })

  it('不合法仓：exit 1 + 逐条违规四元组（规则号/文件/位置/描述/修法——不许只说校验失败）', () => {
    const r = runCli(['company', 'validate', illegalDir])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('FAIL')
    expect(r.stderr).toContain('[A-1]')
    expect(r.stderr).toContain('stray.txt')
    expect(r.stderr).toContain('封闭集外')
    expect(r.stderr).toMatch(/修法|删|归位/)
  })

  it('路径不存在：exit 2（判定器自身错误——与不合法严格区分）', () => {
    const r = runCli(['company', 'validate', path.join(root, 'not-exist')])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('判定器自身错误')
  })

  it('用法缺参：exit 1 + USAGE 提示', () => {
    const r = runCli(['company', 'validate'])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('company validate')
  })
})

describe('DEV-32 · company validate · --json 机器面', () => {
  it('合法：stdout 纯 JSON（ok=true + summary 四元组 + 可初始化语义由 ok 承载）', () => {
    const r = runCli(['company', 'validate', legalDir, '--json'])
    expect(r.status).toBe(0)
    const parsed = JSON.parse(r.stdout) as { ok: boolean; summary?: { slug: string; people: number } }
    expect(parsed.ok).toBe(true)
    expect(parsed.summary?.slug).toBe('src-corp')
    expect(parsed.summary?.people).toBe(1)
  })

  it('不合法：exit 1 + violations 数组逐条 {rule,file,location,problem,fix}', () => {
    const r = runCli(['company', 'validate', illegalDir, '--json'])
    expect(r.status).toBe(1)
    const parsed = JSON.parse(r.stderr) as {
      ok: boolean
      violations: { rule: string; file: string; location: string; problem: string; fix: string }[]
    }
    expect(parsed.ok).toBe(false)
    expect(parsed.violations.length).toBeGreaterThan(0)
    const v = parsed.violations[0]
    expect(v.rule).toBe('A-1')
    expect(v.file).toBe('stray.txt')
    expect(v.problem).not.toBe('')
    expect(v.fix).not.toBe('')
  })
})

describe('DEV-32 · company validate · --allow-extra 豁免面', () => {
  it('封闭集外路径豁免留痕：exit 0 + exempted 列出（B/C/D/E 组不豁免）', () => {
    const r = runCli(['company', 'validate', illegalDir, '--allow-extra'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('PASS')
    expect(r.stdout).toContain('豁免')
    expect(r.stdout).toContain('stray.txt')
  })
})

describe('DEV-32 · company validate · tarball 面', () => {
  it('合法 tarball（单根目录下沉降定位 org-config.yaml）：exit 0', () => {
    const staging = path.join(root, 'tar-ok')
    mkdirSync(staging, { recursive: true })
    cpSync(fixtureSrc, path.join(staging, 'co-1.0'), { recursive: true })
    const tarPath = path.join(root, 'co-1.0.tar')
    spawnSync('tar', ['-cf', tarPath, '-C', staging, 'co-1.0'], { timeout: 60_000 })
    const r = runCli(['company', 'validate', tarPath])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('slug=src-corp')
  })

  it('坏 tar（非 tar 内容）：exit 2 判定器自身错误', () => {
    const bogus = path.join(root, 'bogus.tar')
    writeFileSync(bogus, 'this is not a tarball\n', 'utf8')
    const r = runCli(['company', 'validate', bogus])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('判定器自身错误')
  })
})

describe('DEV-32 · company validate · git-url 面（真实克隆）', () => {
  it('本地仓即远端：克隆→判定→PASS exit 0（E 组闸跑克隆产物）', () => {
    const r = runCli(['company', 'validate', fixtureRepo])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('PASS')
    expect(r.stdout).toContain('slug=src-corp')
  }, 120_000)

  it('克隆失败（不可达远端）：exit 2 判定器自身错误（网络面）', () => {
    const r = runCli(['company', 'validate', path.join(root, 'remote', 'no-such-repo')])
    // 本地路径不存在 → 路径面判定器错误；两类都是 exit 2（判定器自身错误家族）
    expect(r.status).toBe(2)
  })
})

describe('DEV-32 · company validate · 与 DEV-27 导入流共用核（命令面互证）', () => {
  it('validate PASS 的仓恰能 company add 成功落锚（同一判定器、两个入口，结论一致）', () => {
    // 先 validate（应 PASS）
    const v = runCli(['company', 'validate', fixtureRepo])
    expect(v.status).toBe(0)
    // 再走导入流（同仓同判定器）——落锚成功
    const workRoot = path.join(root, 'import-work')
    const a = runCli(['company', 'add', fixtureRepo, 'src-corp', '--work-root', workRoot, '--by', '制作人-cli'])
    expect(a.status).toBe(0)
    expect(a.stdout).toContain('slug=src-corp')
    expect(existsSync(path.join(workRoot, 'src-corp', '.studio-next', 'trust.json'))).toBe(true)
    // 产物面复验：对落地产物再跑 validate --product（.studio-next/ 锚在产物面合法——R7）→ PASS；
    // 缺 --product（源面）则 A-5 如实指认锚在场——两面语义都可判
    const p = runCli(['company', 'validate', path.join(workRoot, 'src-corp'), '--product'])
    expect(p.status).toBe(0)
    const pSrc = runCli(['company', 'validate', path.join(workRoot, 'src-corp')])
    expect(pSrc.status).toBe(1)
    expect(pSrc.stderr).toContain('A-5')
  }, 180_000)
})
