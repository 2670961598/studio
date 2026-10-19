/**
 * 安全基线 · 附录A-4 语法域负断言（docs/43-附录A-4；spike 验证记录 docs/44-§二 条款5——
 * 恶意样本② output ../../.. 逃逸 / 大写下划线 slug）
 *
 * 断言面（DEV-33b 正式化——spike 同款负断言移植）：
 *   1. isSafeRelativeOutputPath 纯函数：合法（相对 POSIX 路径、尾段空=目录标记）与
 *      非法（.. 逃逸段/绝对路径/Windows 盘符/反斜杠/空串）全口径
 *   2. org-config jobs output / outputs 携逃逸或绝对路径 → loadCompanyDirectory 拒收
 *      （文件:行+修法——zod refine 面经 zodIssuesToDirectoryIssues 落 rule/fix）
 *   3. SLUG_RE 单表（init.ts / validator.ts / panel external+overview 共一张表）：
 *      纯函数口径 + org-config channel 拒收 + init channel 拒收（init/bad-slug）
 *   4. 正向对照：合法 output/outputs 原样装载进 snapshot.jobs payload（闸不误伤良性面）
 *
 * import 通道的未知文件拒收（import/unknown-entry）与自带锚拒收（import/anchor-present）
 * 已由 DEV-27 落在 git-import.test.ts——同属附录A-4 面，此处不重复（证据面互引）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { initCompany, loadCompanyDirectory, readDirectoryFiles } from '../src/index.ts'
import { isSafeRelativeOutputPath, SLUG_RE } from '../src/validator.ts'

/** 单文件语料（strictFiles:false——多文件面归 multifile.test.ts，本套聚焦语法域闸） */
const mount = (yaml: string) => loadCompanyDirectory({ 'org-config.yaml': yaml }, { strictFiles: false })

/** 最小合法骨架（jobs-loading.test 同款；jobsBlock 追加在尾部第 23 行起） */
function orgYaml(jobsBlock: string): string {
  return [
    'schema: org-config/v1', // 1
    'company:', // 2
    '  name: 演示公司', // 3
    '  slug: demo-corp', // 4
    '  charter_ref: charter.md', // 5
    '  level: 2', // 6
    '  level_distribution:', // 7
    '    2: 1', // 8
    'departments:', // 9
    '  - name: 工程部', // 10
    '    path: departments/工程部', // 11
    '    leader: AGENT-1', // 12
    '    level: 2', // 13
    '    parent: null', // 14
    '    lanes: [core]', // 15
    '    functions: [交付]', // 16
    'people:', // 17
    '  - id: AGENT-1', // 18
    '    name: 演示工程师', // 19
    '    login: agent-1', // 20
    '    level: 2', // 21
    '    dept: departments/工程部', // 22
    jobsBlock,
  ].join('\n')
}

/** 单条定时岗块（行号受控：jobs.0 起始=第 24 行，output 行=第 24+n 行） */
function jobBlock(fields: string[]): string {
  return ['jobs:', '  - id: j-1', '    dept: departments/工程部', '    cron: "0 18 * * *"', '    role: 工程负责人', '    type: report', ...fields].join('\n')
}

describe('附录A-4 · isSafeRelativeOutputPath 纯函数口径', () => {
  it('合法：相对 POSIX 路径（含中文段、尾段空=目录标记）', () => {
    expect(isSafeRelativeOutputPath('reports/工程部/')).toBe(true)
    expect(isSafeRelativeOutputPath('reports/x.md')).toBe(true)
    expect(isSafeRelativeOutputPath('a/b/c/d.md')).toBe(true)
    expect(isSafeRelativeOutputPath('reports/工程部/')).toBe(true)
  })

  it('非法：.. 逃逸段 / 绝对路径 / Windows 盘符 / 反斜杠 / 空串（恶意样本② 全口径）', () => {
    expect(isSafeRelativeOutputPath('../../..')).toBe(false) // 恶意样本② 主形态
    expect(isSafeRelativeOutputPath('reports/../../etc')).toBe(false) // 内段 .. 夹带
    expect(isSafeRelativeOutputPath('/etc/passwd')).toBe(false) // POSIX 绝对
    expect(isSafeRelativeOutputPath('C:\\evil')).toBe(false) // Windows 盘符
    expect(isSafeRelativeOutputPath('a\\b')).toBe(false) // 反斜杠分隔符
    expect(isSafeRelativeOutputPath('..')).toBe(false)
    expect(isSafeRelativeOutputPath('.')).toBe(false)
    expect(isSafeRelativeOutputPath('')).toBe(false)
    expect(isSafeRelativeOutputPath('reports//x.md')).toBe(false) // 内部空段
  })
})

describe('附录A-4 · jobs output/outputs 路径域闸（org-config channel）', () => {
  it('output: ../../..（恶意样本②）→ 拒收：rule 定位到 output 键、修法含路径域口径', () => {
    const mounted = mount(orgYaml(jobBlock(['    output: ../../..'])))
    expect(mounted.ok).toBe(false)
    if (!mounted.ok) {
      const issue = mounted.issues.find((i) => i.rule.startsWith('org-config/') && i.rule.includes('output'))
      expect(issue).toBeDefined()
      expect(issue?.fix).toContain('相对公司目录根')
      expect(issue?.fix).toContain('..')
      expect(issue?.file).toBe('org-config.yaml')
      expect(issue?.line).toBeGreaterThan(0) // 行号定位（zod 路径回爬）
    }
  })

  it('output: /etc/passwd（绝对路径）与 C:\\evil（盘符）→ 同样拒收', () => {
    for (const evil of ['    output: /etc/passwd', '    output: C:\\\\evil']) {
      const mounted = mount(orgYaml(jobBlock([evil])))
      expect(mounted.ok, evil).toBe(false)
    }
  })

  it('outputs 清单元素携逃逸段 → 拒收（数组面同域闸）', () => {
    const block = jobBlock(['    outputs:', '      - reports/a.md', '      - ../../escape.md'])
    const mounted = mount(orgYaml(block))
    expect(mounted.ok).toBe(false)
    if (!mounted.ok) {
      expect(mounted.issues.some((i) => i.rule.includes('outputs') && i.fix.includes('相对公司目录根'))).toBe(true)
    }
  })

  it('正向对照：合法 output/outputs 装载进 snapshot.jobs payload（闸不误伤良性面）', () => {
    const block = jobBlock(['    output: reports/工程部/', '    outputs:', '      - reports/a.md'])
    const mounted = mount(orgYaml(block))
    expect(mounted.ok).toBe(true)
    if (mounted.ok) {
      expect(mounted.snapshot.jobs).toHaveLength(1)
      expect(mounted.snapshot.jobs[0]?.payload?.output).toBe('reports/工程部/')
      expect(mounted.snapshot.jobs[0]?.payload?.outputs).toEqual(['reports/a.md'])
    }
  })
})

describe('附录A-4 · SLUG_RE 单表（init / org-config / panel 共一张表）', () => {
  it('纯函数口径：小写数字连字符、两端不断字；大写/下划线/空串拒', () => {
    expect(SLUG_RE.test('my-corp')).toBe(true)
    expect(SLUG_RE.test('demo-corp-2')).toBe(true)
    expect(SLUG_RE.test('a')).toBe(true)
    expect(SLUG_RE.test('Bad_Slug')).toBe(false)
    expect(SLUG_RE.test('-corp')).toBe(false)
    expect(SLUG_RE.test('corp-')).toBe(false)
    expect(SLUG_RE.test('')).toBe(false)
    expect(SLUG_RE.test('my corp')).toBe(false) // 空白=路由段歧义
    expect(SLUG_RE.test('../evil')).toBe(false) // 路径分隔符
  })

  it('org-config channel：slug: Benign_Min（大写/下划线）→ 拒收，修法含同规口径', () => {
    const bad = orgYaml(jobBlock([])).replace('  slug: demo-corp', '  slug: Benign_Min')
    const mounted = mount(bad)
    expect(mounted.ok).toBe(false)
    if (!mounted.ok) {
      const issue = mounted.issues.find((i) => i.fix.includes('slug 须形如 my-corp'))
      expect(issue).toBeDefined()
      expect(issue?.rule.includes('slug')).toBe(true)
    }
  })

  it('init channel：initCompany 拒非法 slug（CONFIG_INVALID init/bad-slug——同一张表）', async () => {
    const target = path.join(root, 'bad-slug-company')
    await expect(initCompany({ slug: 'Bad_Slug', targetDir: target })).rejects.toMatchObject({
      category: 'CONFIG_INVALID',
      subcause: 'init/bad-slug',
    })
  })
})

let root = ''
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-secbaseline-'))
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})
