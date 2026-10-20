/**
 * v0.1-M3 init 验收测试（docs/16-§四 v0.1 验收口径：studio-next init 出模板公司并通过自检）
 *
 * 拟冻结验收命令（测试内固化，16-§四 口径的可执行化）：
 *   node apps/daemon/src/cli/main.ts init demo --dir <tmp>    → exit 0（复制/替换/自检/git 首提全过）
 *   node apps/daemon/src/cli/main.ts validate <tmp>/demo      → exit 0（slug/level 摘要）
 *
 * 两段：
 *   1. initCompany 全链（复制 / 占位替换 / 自检 / git 首提）——进程内直调，断言到文件内容与 git 状态
 *   2. spawn 冒烟——node 直跑 bin.ts，对齐冻结验收命令的退出码与输出
 * 环境：os.tmpdir() 临时目录，用后清理；git 身份由测试注入 GIT_* 环境变量保证确定性
 *（产品代码署名走 git 默认配置，测试注入只作用于测试进程，不改产品行为）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { simpleGit } from 'simple-git'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { initCompany, loadCompanyDirectory, readDirectoryFiles } from '../src/index.ts'

const GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'studio-next-init-test',
  GIT_AUTHOR_EMAIL: 'init-test@studio-next.invalid',
  GIT_COMMITTER_NAME: 'studio-next-init-test',
  GIT_COMMITTER_EMAIL: 'init-test@studio-next.invalid',
}

/** 破模板的 org-config.yaml：占位符齐全（slug/name 可替换），但 level 1 越下限（04-§四：2 级起步） */
const BROKEN_ORG_CONFIG = [
  'schema: org-config/v1',
  'company:',
  '  name: 示例公司',
  '  slug: example-corp',
  '  charter_ref: charter.md',
  '  level: 1',
  '  level_distribution:',
  '    2: 1',
  'departments:',
  '  - name: 工程部',
  '    path: departments/工程部',
  '    leader: AGENT-1',
  '    level: 2',
  '    parent: null',
  '    lanes: [core]',
  '    functions: [交付]',
  'people:',
  '  - id: AGENT-1',
  '    name: 演示工程师',
  '    login: agent-1',
  '    level: 2',
  '    dept: departments/工程部',
  '',
].join('\n')

/** 占位替换涉及的另两张契约文件（init 对模板的健全性要求：三件齐备） */
const BROKEN_README = '# 示例公司（公司自述）\n'
const BROKEN_META = [
  'schema: org-config/v1',
  'template: company-2-level',
  'created_at: null',
  'last_validated_at: null',
  'last_validation: null',
  'framework_version: null',
  '',
].join('\n')

const savedEnv: Record<string, string | undefined> = {}
let root = ''

beforeAll(async () => {
  for (const [key, value] of Object.entries(GIT_ENV)) {
    savedEnv[key] = process.env[key]
    process.env[key] = value
  }
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-init-'))
})

afterAll(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(root, { recursive: true, force: true })
})

describe('initCompany 全链（复制 / 占位替换 / 自检 / git 首提）', () => {
  it('默认模板 init：产物合法、占位已替换、git 首提且工作区干净', async () => {
    const target = path.join(root, 'demo-corp')
    const result = await initCompany({ slug: 'demo-corp', name: '演示公司', targetDir: target })

    expect(result.dir).toBe(path.resolve(target))
    expect(result.gitCommit).toMatch(/^[0-9a-f]{40}$/)

    // 模板树 9 文件原样复制（含 .studio-next.yaml / .gitkeep 点文件）
    const files = await readDirectoryFiles(target)
    expect(Object.keys(files).sort()).toEqual([
      '.studio-next.yaml',
      'README.md',
      'charter.md',
      'departments/工程部/config.yaml',
      'departments/工程部/people/AGENT-1.md',
      'docs/.gitkeep',
      'org-config.yaml',
      'prompts/company.md',
      'reports/.gitkeep',
    ])

    // 占位替换（org-config slug/name；README 标题；元信息三戳）——模板占位零残留
    expect(files['org-config.yaml']).toContain('slug: demo-corp')
    expect(files['org-config.yaml']).toContain('name: 演示公司')
    expect(files['org-config.yaml']).not.toContain('example-corp')
    expect(files['org-config.yaml']).not.toContain('示例公司')
    expect(files['README.md']).toContain('# 演示公司（公司自述）')
    expect(files['.studio-next.yaml']).toContain('template: company-2-level')
    expect(files['.studio-next.yaml']).toMatch(/created_at: "2\d{3}-\d{2}-\d{2}T/)
    expect(files['.studio-next.yaml']).toMatch(/last_validated_at: "2\d{3}-\d{2}-\d{2}T/)
    expect(files['.studio-next.yaml']).toContain('last_validation: pass')

    // 自检可重放：文件映射再过校验器 → 合法快照（slug/level 摘要的来源）
    const mounted = loadCompanyDirectory(files)
    expect(mounted.ok).toBe(true)
    if (mounted.ok) {
      expect(mounted.snapshot.slug).toBe('demo-corp')
      expect(mounted.snapshot.level).toBe(2)
      expect(mounted.snapshot.departments).toHaveLength(1)
      expect(mounted.snapshot.people).toHaveLength(1)
    }

    // git 首提：恰好 1 个 commit、哈希与返回值一致、工作区干净（全量入库）
    const git = simpleGit(target)
    const log = await git.log()
    expect(log.total).toBe(1)
    expect(log.latest?.hash).toBe(result.gitCommit)
    const status = await git.status()
    expect(status.files).toHaveLength(0)
    expect(status.not_added).toHaveLength(0)
    expect(status.staged).toHaveLength(0)
  })

  it('slug 不合法 → CONFIG_INVALID(init/bad-slug)，且不留半成品', async () => {
    const target = path.join(root, 'bad-slug')
    await expect(initCompany({ slug: 'Bad Slug', targetDir: target })).rejects.toMatchObject({
      category: 'CONFIG_INVALID',
      subcause: 'init/bad-slug',
    })
    expect(existsSync(target)).toBe(false)
  })

  it('目标目录非空 → CONFIG_INVALID(init/target-not-empty)，不动既有内容', async () => {
    const target = path.join(root, 'occupied')
    await mkdir(target, { recursive: true })
    await writeFile(path.join(target, 'keep.txt'), '既有内容')
    await expect(initCompany({ slug: 'demo-2', targetDir: target })).rejects.toMatchObject({
      category: 'CONFIG_INVALID',
      subcause: 'init/target-not-empty',
    })
    expect(await readdir(target)).toEqual(['keep.txt'])
  })

  it('模板产物自检不通过 → CONFIG_INVALID(init/self-check-failed) 且问题带 文件:行，产物整体撤除', async () => {
    const broken = path.join(root, 'broken-template')
    await mkdir(broken, { recursive: true })
    await writeFile(path.join(broken, 'org-config.yaml'), BROKEN_ORG_CONFIG)
    await writeFile(path.join(broken, 'README.md'), BROKEN_README)
    await writeFile(path.join(broken, '.studio-next.yaml'), BROKEN_META)
    const target = path.join(root, 'broken-product')
    await expect(initCompany({ slug: 'demo-3', targetDir: target, templateDir: broken })).rejects.toMatchObject({
      category: 'CONFIG_INVALID',
      subcause: 'init/self-check-failed',
      message: expect.stringContaining('org-config.yaml:6'),
    })
    expect(existsSync(target)).toBe(false)
  })
})

describe('spawn 冒烟（拟冻结验收命令：init demo → validate demo → exit 0）', () => {
  const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/daemon/src/cli/main.ts')
  const run = (args: string[]) =>
    spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: { ...process.env, ...GIT_ENV } })

  it('init demo → validate demo 全链 exit 0（16-§四 v0.1 验收口径）', () => {
    const target = path.join(root, 'smoke', 'demo')
    const initRun = run(['init', 'demo', '--name', '冒烟公司', '--dir', target])
    expect(initRun.status).toBe(0)
    expect(initRun.stdout).toContain('已生成公司目录')
    expect(initRun.stdout).toContain(target)
    expect(initRun.stdout).toContain('目录自检：通过')

    const validateRun = run(['validate', target])
    expect(validateRun.status).toBe(0)
    expect(validateRun.stderr).toBe('')
    expect(validateRun.stdout).toContain('demo')
    expect(validateRun.stdout).toContain('2 级公司')
  })

  it('validate 坏目录 → 逐条「文件:行 [规则] 修法」到 stderr，exit 1', () => {
    const bad = path.join(root, 'smoke-bad')
    mkdirSync(bad)
    writeFileSync(path.join(bad, 'org-config.yaml'), BROKEN_ORG_CONFIG)
    const validateRun = run(['validate', bad])
    expect(validateRun.status).toBe(1)
    expect(validateRun.stderr).toMatch(/org-config\.yaml:\d+ \[org-config\//)
    expect(validateRun.stderr).toContain('校验不通过')
  })

  it('serve 已落地（v0.5 主循环）→ 缺 --config 即用法错误 exit 1（真跑归 e2e：apps/daemon/test/e2e.test.ts）', () => {
    const serveRun = run(['serve'])
    expect(serveRun.status).toBe(1)
    expect(serveRun.stderr).toContain('缺少 --config')
  })

  it('未知子命令 / 缺参 → exit 1 + 用法到 stderr', () => {
    const bogusRun = run(['bogus'])
    expect(bogusRun.status).toBe(1)
    expect(bogusRun.stderr).toContain('未知子命令')

    const noSlugRun = run(['init'])
    expect(noSlugRun.status).toBe(1)
    expect(noSlugRun.stderr).toContain('缺少 <slug>')
  })
})
