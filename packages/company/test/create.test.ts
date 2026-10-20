/**
 * DEV-15 company create 验收测试（docs/36-§4 M-B 骨架刀；docs/36-§2⑤ 执行链）
 *
 * 覆盖四块：
 *   1. 内核 fresh 全链（localfile）：六相位状态词汇、平台绑定行、git 两提交、provision 落
 *      localplatform、.AIWS 工位树、jobs 播种注入、插件零依赖面、报告落盘
 *   2. 幂等再跑（docs/30-§6 基线）：adopt 收敛不重建——git 提交数不增、播种 kept 计数、
 *      报告覆盖式
 *   3. --dry-run 零落盘（docs/36-§2⑤「全程 --dry-run 可预演」）：fresh 与 adopt 两通道
 *   4. fail-closed 面：坏 slug / 占用异 slug / 非公司目录 / 平台错配 / 账号锚点错档 /
 *      绑定子步失败整体撤除（宁失败不半成品）
 *   5. spawn 冒烟（CLI 面）：bin.ts company create --dry-run exit 0；真跑 exit 0 → 再跑
 *      exit 0（幂等）；验收报告文件存在
 * 环境：os.tmpdir() 临时目录，用后清理；git 身份由测试注入 GIT_* 环境变量保证确定性
 *（产品代码署名走 git 默认配置/仓库局部配置，测试注入只作用于测试进程，不改产品行为）。
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { simpleGit } from 'simple-git'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { companyCreate, createLocalAnchorAccounts } from '../src/index.ts'
import type { JobsSeeder } from '../src/index.ts'
import { createLocalPlatform } from '@studio-next/localplatform'
import type { FlowPlatform } from '@studio-next/contract'

const GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'studio-next-create-test',
  GIT_AUTHOR_EMAIL: 'create-test@studio-next.invalid',
  GIT_COMMITTER_NAME: 'studio-next-create-test',
  GIT_COMMITTER_EMAIL: 'create-test@studio-next.invalid',
}

const savedEnv: Record<string, string | undefined> = {}
let root = ''

beforeAll(async () => {
  for (const [key, value] of Object.entries(GIT_ENV)) {
    savedEnv[key] = process.env[key]
    process.env[key] = value
  }
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-create-'))
})

afterAll(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(root, { recursive: true, force: true })
})

/** 固定时钟（报告时间戳与播种 at 确定性） */
const FIXED_NOW = (): Date => new Date('2026-10-19T08:00:00.000Z')

/** 播种注入伪件：复刻 seedJobs 语义（首次=seeded，再跑=kept），并记录调用 */
function fakeSeeder(): { fn: JobsSeeder; calls: number[][] } {
  const seen = new Set<string>()
  const calls: number[][] = []
  const fn: JobsSeeder = (jobs, at) => {
    let seeded = 0
    let kept = 0
    for (const j of jobs) {
      if (seen.has(j.job_id)) kept += 1
      else {
        seen.add(j.job_id)
        seeded += 1
      }
    }
    calls.push([seeded, kept, at, jobs.length])
    return { seeded, kept }
  }
  return { fn, calls }
}

/** 一套完整注入（测试内组装依赖——与 CLI 组装面对齐） */
function harness(workRoot: string, slug: string) {
  const targetDir = path.join(workRoot, slug)
  const platformRoot = path.join(workRoot, 'var', 'platform')
  const pluginRoot = path.join(workRoot, 'var', 'plugins')
  const seeder = fakeSeeder()
  return {
    targetDir,
    platformRoot,
    pluginRoot,
    seeder,
    opts: {
      slug,
      targetDir,
      workRoot,
      // 惰性工厂（localplatform 构造即 ensureDir——dry-run 零落盘契约的测试面对齐）
      platformPort: (): FlowPlatform => createLocalPlatform(platformRoot),
      pluginRoot,
      jobsSeeder: seeder.fn,
      createdBy: 'create-test',
      now: FIXED_NOW,
    } as const,
  }
}

describe('companyCreate 内核 · fresh 全链（localfile）', () => {
  it('六相位一次串完：绑定行/git 两提交/provision 落盘/.AIWS 工位/播种/报告', async () => {
    const workRoot = path.join(root, 'full')
    const h = harness(workRoot, 'acme')

    const result = await companyCreate({ ...h.opts, name: '王牌公司', platform: 'localfile' })

    // 相位状态词汇（固定序）
    expect(result.phases.map((p) => `${p.phase}:${p.status}`)).toEqual([
      'init:created',
      'provision:provisioned',
      'accounts:provisioned',
      'jobs:provisioned',
      'plugins:provisioned',
      'report:provisioned',
    ])

    // 平台绑定行落 org-config company 段（docs/23-§二），且快照回读 localfile
    const orgSrc = await readFile(path.join(h.targetDir, 'org-config.yaml'), 'utf8')
    expect(orgSrc).toMatch(/^\s*platform: localfile/mu)
    expect(result.snapshot.platform.platform).toBe('localfile')
    expect(result.snapshot.slug).toBe('acme')

    // git：init 首提 + 平台绑定提交，工作区干净
    const git = simpleGit(h.targetDir)
    expect((await git.status()).isClean()).toBe(true)
    const log = await git.log()
    expect(log.total).toBe(2)
    expect(log.latest?.message).toContain('平台绑定落 localfile')
    expect(result.gitCommit).toMatch(/^[0-9a-f]{40}$/)

    // provision 真落 localplatform（<platformRoot>/meta/fields.json.provision——缺省映射）
    const fieldsJson = JSON.parse(await readFile(path.join(h.platformRoot, 'meta', 'fields.json'), 'utf8')) as {
      provision: { fields: Record<string, string>; states: string[] }
    }
    expect(fieldsJson.provision.fields).toMatchObject({ state: 'State', dept: '部门', level: '等级' })
    expect(fieldsJson.provision.states[0]).toBe('新单')

    // .AIWS 工位树（workRoot 下，不进公司 git 目录——docs/43-§五）
    expect(existsSync(path.join(workRoot, '.AIWS', 'departments', '工程部', 'AGENT-1'))).toBe(true)
    expect(result.aiws.personDirs).toHaveLength(1)

    // jobs 播种：模板 2 岗首跑全下槽（docs/17-§2）
    expect(h.seeder.calls).toEqual([[2, 0, FIXED_NOW().getTime(), 2]])

    // 插件面：模板无 dependencies.yaml → 零行为面、confirm 不触
    expect(result.install?.items).toEqual([])

    // 验收报告落盘（末次 run 覆盖式）
    expect(result.reportFile).toBe(path.join(workRoot, 'var', 'create-reports', 'acme.md'))
    const report = await readFile(result.reportFile as string, 'utf8')
    expect(report).toContain('# company create 验收报告 · acme')
    expect(report).toContain('| init | created |')
    expect(report).toContain('| jobs | provisioned |')
    expect(report).toContain('docs/36-§2⑤')
  })

  it('再跑=adopt 收敛（docs/30-§6 幂等基线）：git 不增、播种 kept、报告覆盖', async () => {
    const workRoot = path.join(root, 'rerun')
    const h = harness(workRoot, 'acme')
    await companyCreate({ ...h.opts, platform: 'localfile' })

    const again = await companyCreate({ ...h.opts, platform: 'localfile' })

    expect(again.phases[0]).toMatchObject({ phase: 'init', status: 'adopted' })
    expect(again.phases.slice(1).map((p) => p.status)).toEqual(['provisioned', 'provisioned', 'provisioned', 'provisioned', 'provisioned'])

    // git 提交数不增（adopt 不重建不补建）
    const log = await simpleGit(h.targetDir).log()
    expect(log.total).toBe(2)

    // 播种语义：再跑 kept=2、seeded=0
    expect(h.seeder.calls[1]).toEqual([0, 2, FIXED_NOW().getTime(), 2])

    // 报告覆盖（同路径，内容已是 adopt 面）
    const report = await readFile(again.reportFile as string, 'utf8')
    expect(report).toContain('| init | adopted |')
  })
})

describe('companyCreate · --dry-run 零落盘（docs/36-§2⑤ 可预演）', () => {
  it('fresh 通道：模板可挂载即出计划，目录/var/.AIWS/播种/报告全不落', async () => {
    const workRoot = path.join(root, 'dry')
    const h = harness(workRoot, 'ghost')

    const result = await companyCreate({ ...h.opts, platform: 'localfile', dryRun: true })

    expect(result.phases.map((p) => `${p.phase}:${p.status}`)).toEqual([
      'init:planned',
      'provision:planned',
      'accounts:planned',
      'jobs:planned',
      'plugins:planned',
      'report:planned',
    ])
    expect(existsSync(h.targetDir)).toBe(false)
    expect(existsSync(workRoot)).toBe(false)
    expect(h.seeder.calls).toEqual([])
    expect(result.reportFile).toBeUndefined()
    expect(result.aiws.personDirs).toEqual([])
  })

  it('adopt 通道：既有公司只读复用（init=adopted），其余相位全 planned 且零新写', async () => {
    const workRoot = path.join(root, 'dry-adopt')
    const h = harness(workRoot, 'acme')
    await companyCreate({ ...h.opts, platform: 'localfile' })
    const before = await simpleGit(h.targetDir).log()

    const result = await companyCreate({ ...h.opts, platform: 'localfile', dryRun: true })

    expect(result.phases[0]).toMatchObject({ phase: 'init', status: 'adopted' })
    expect(result.phases.slice(1).every((p) => p.status === 'planned')).toBe(true)
    expect((await simpleGit(h.targetDir).log()).total).toBe(before.total)
    expect(h.seeder.calls).toHaveLength(1) // 只有首跑那次
  })
})

describe('companyCreate · fail-closed 面', () => {
  it('坏 slug → CONFIG_INVALID(create/bad-slug)（dry-run 也拒——入口闸）', async () => {
    const workRoot = path.join(root, 'bad-slug')
    await expect(companyCreate({ slug: 'Bad Slug', workRoot, dryRun: true })).rejects.toMatchObject({
      category: 'CONFIG_INVALID',
      subcause: 'create/bad-slug',
    })
  })

  it('坏平台名 → CONFIG_INVALID(create/bad-platform)（M-B 只接 localfile）', async () => {
    const workRoot = path.join(root, 'bad-platform')
    await expect(companyCreate({ slug: 'acme', workRoot, dryRun: true, platform: 'taiga' as never })).rejects.toMatchObject({
      category: 'CONFIG_INVALID',
      subcause: 'create/bad-platform',
    })
  })

  it('占用目录是别家公司 → CONFIG_INVALID(create/slug-mismatch)', async () => {
    const workRoot = path.join(root, 'mismatch')
    const h = harness(workRoot, 'acme')
    await companyCreate({ ...h.opts, platform: 'localfile' })

    await expect(companyCreate({ ...h.opts, slug: 'other-corp', platform: 'localfile' })).rejects.toMatchObject({
      category: 'CONFIG_INVALID',
      subcause: 'create/slug-mismatch',
    })
    // 既有公司目录不受扰动
    expect(existsSync(path.join(h.targetDir, 'org-config.yaml'))).toBe(true)
  })

  it('占用目录非公司目录 → CONFIG_INVALID(create/target-not-company) 且问题定位带 文件:行', async () => {
    const workRoot = path.join(root, 'not-company')
    const target = path.join(workRoot, 'junk')
    await mkdir(target, { recursive: true })
    await writeFile(path.join(target, 'keep.txt'), '既有内容')

    await expect(companyCreate({ slug: 'acme', targetDir: target, workRoot, dryRun: true })).rejects.toMatchObject({
      category: 'CONFIG_INVALID',
      subcause: 'create/target-not-company',
      message: expect.stringContaining('org-config.yaml'),
    })
    expect(await readdir(target)).toEqual(['keep.txt'])
  })

  it('平台错配再跑 → CONFIG_INVALID(create/platform-mismatch)（绑定创建时定版）', async () => {
    const workRoot = path.join(root, 'plat-mismatch')
    const h = harness(workRoot, 'acme')
    await companyCreate({ ...h.opts }) // 不落绑定行=模板缺省 youtrack

    await expect(companyCreate({ ...h.opts, platform: 'localfile' })).rejects.toMatchObject({
      category: 'CONFIG_INVALID',
      subcause: 'create/platform-mismatch',
    })
  })

  it('账号锚点错档 → CONFIG_INVALID(create/accounts-inconsistent)（账号=等级锚点）且目录保留', async () => {
    const workRoot = path.join(root, 'anchor')
    const h = harness(workRoot, 'acme')
    await companyCreate({ ...h.opts, platform: 'localfile' })

    // 篡改：账号锚 level 2→3（与人档案错档）
    const orgPath = path.join(h.targetDir, 'org-config.yaml')
    const orgSrc = (await readFile(orgPath, 'utf8')).replace(/(login: agent-1\n\s+level: )2/u, '$13')
    await writeFile(orgPath, orgSrc, 'utf8')

    await expect(companyCreate({ ...h.opts, platform: 'localfile' })).rejects.toMatchObject({
      category: 'CONFIG_INVALID',
      subcause: 'create/accounts-inconsistent',
      message: expect.stringContaining('等级锚点错档'),
    })
    // P2+ 相位失败=目录保留（已是合法公司），再跑收敛
    expect(existsSync(orgPath)).toBe(true)
  })

  it('绑定子步失败 → CONFIG_INVALID(create/platform-already-bound) 且整体撤除不留半成品', async () => {
    const workRoot = path.join(root, 'atomic')
    const h = harness(workRoot, 'acme')
    // 毒模板：org-config 已带 platform 行 → init 过、绑定子步 fail-closed（全树拷贝再打毒）
    const poisoned = path.join(root, 'poisoned-template')
    cpSync(path.join(repoRoot(), 'templates', 'company-2-level'), poisoned, { recursive: true })
    const orgPath = path.join(poisoned, 'org-config.yaml')
    await writeFile(orgPath, (await readFile(orgPath, 'utf8')).replace(/^company:$/m, 'company:\n  platform: localfile'), 'utf8')

    await expect(companyCreate({ ...h.opts, platform: 'localfile', templateDir: poisoned })).rejects.toMatchObject({
      category: 'CONFIG_INVALID',
      subcause: 'create/platform-already-bound',
    })
    // 宁失败不半成品：本 run 新建目录整体撤除，P2+ 相位未触
    expect(existsSync(h.targetDir)).toBe(false)
    expect(existsSync(path.join(workRoot, '.AIWS'))).toBe(false)
    expect(h.seeder.calls).toEqual([])
  })

  it('缺账号锚 → create/accounts-inconsistent（localfile 退化实现：断言不代写）', async () => {
    const workRoot = path.join(root, 'missing-anchor')
    const h = harness(workRoot, 'acme')
    await companyCreate({ ...h.opts, platform: 'localfile' })

    const orgPath = path.join(h.targetDir, 'org-config.yaml')
    const orgSrc = await readFile(orgPath, 'utf8')
    // 整段摘除 accounts（人仍在——锚全缺；validator 不做 people↔accounts 交叉检，仍可挂载）
    await writeFile(orgPath, orgSrc.replace(/^accounts:\n(?:  [^\n]*\n)*/mu, ''), 'utf8')

    await expect(companyCreate({ ...h.opts, platform: 'localfile' })).rejects.toMatchObject({
      category: 'CONFIG_INVALID',
      subcause: 'create/accounts-inconsistent',
      message: expect.stringContaining('缺账号锚'),
    })
  })

  it('注入建号面被采用（AccountProvisioner 注入位——平台侧 memberships 后续单的接缝）', async () => {
    const workRoot = path.join(root, 'custom-provisioner')
    const h = harness(workRoot, 'acme')
    let called = 0
    const result = await companyCreate({
      ...h.opts,
      platform: 'localfile',
      accounts: {
        kind: 'test-provisioner',
        provisionMembers: async ({ slug, dryRun, people }) => {
          called += 1
          return { provisioned: people.length, reused: 0, note: `test:${slug}:${dryRun ? 'dry' : 'run'}` }
        },
      },
    })
    expect(called).toBe(1)
    expect(result.phases[2]?.detail).toContain('test-provisioner')
    expect(result.phases[2]?.detail).toContain('test:acme:run')
  })
})

describe('companyCreate · 建号退化实现的纯函数面', () => {
  it('createLocalAnchorAccounts：锚全对齐 → 全 reused；localfile 无平台账号层', async () => {
    const p = createLocalAnchorAccounts(['accounts:', '  - login: agent-1', '    level: 2', ''].join('\n'))
    const report = await p.provisionMembers({ slug: 'acme', dryRun: false, people: [{ id: 'AGENT-1', login: 'agent-1', level: 2 }] })
    expect(report).toEqual({ provisioned: 0, reused: 1, note: expect.stringContaining('无平台账号层') })
  })
})

describe('spawn 冒烟（CLI 面：studio-next company create）', () => {
  const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/daemon/src/bin.ts')

  function run(args: string[]): ReturnType<typeof spawnSync> {
    return spawnSync(process.execPath, [bin, 'company', 'create', ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...GIT_ENV },
    })
  }

  it('--dry-run：exit 0、全相位计划面、零落盘', () => {
    const workRoot = path.join(root, 'cli-dry')
    const out = run(['demo-corp', '--work-root', workRoot, '--platform', 'localfile', '--dry-run'])
    expect(out.status).toBe(0)
    expect(out.stdout).toContain('[init] planned')
    expect(out.stdout).toContain('[provision] planned')
    expect(out.stdout).toContain('零落盘')
    expect(existsSync(workRoot)).toBe(false)
  })

  it('真跑 → exit 0；再跑 → exit 0（幂等）；报告/台账/provision 全落', () => {
    const workRoot = path.join(root, 'cli-run')
    const args = ['demo-corp', '--name', '演示公司', '--work-root', workRoot, '--platform', 'localfile']
    const first = run(args)
    expect(first.status).toBe(0)
    expect(first.stdout).toContain('[init] created')
    expect(first.stdout).toContain('[jobs] provisioned')

    // 幂等再跑：adopt 收敛
    const second = run(args)
    expect(second.status).toBe(0)
    expect(second.stdout).toContain('[init] adopted')

    expect(existsSync(path.join(workRoot, 'var', 'create-reports', 'demo-corp.md'))).toBe(true)
    expect(existsSync(path.join(workRoot, 'var', 'ledger.sqlite'))).toBe(true)
    expect(existsSync(path.join(workRoot, 'var', 'platform', 'meta', 'fields.json'))).toBe(true)
    expect(existsSync(path.join(workRoot, '.AIWS', 'departments', '工程部', 'AGENT-1'))).toBe(true)
  })

  it('坏用法：缺 slug → exit 1 + 用法提示', () => {
    const out = run(['--dry-run'])
    expect(out.status).toBe(1)
    expect(out.stderr).toContain('缺少 <slug>')
  })
})

/** 仓根（模板源——毒模板用例就近取模板文件） */
function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
}
