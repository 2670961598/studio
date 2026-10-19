/**
 * dependencies —— 依赖清单与插件绑定引擎正式测试（DEV-26；docs/43-§四 + §十-5/6/7/8）
 *
 * 覆盖面（真实文件系统 / tmp 隔离；绝不触碰用户 ~/.dsh——插件根全部注入 tmp）：
 *   1. dependencies.yaml 解析（strictObject 拒未知键；version 两形态语法——docs/43-§四）；
 *   2. 属性绑定求值：role 命中 / dept 命中（path 末段名双候选）/ 不命中（docs/43-§十-5）；
 *   3. 版本解析与判定：^caret 区间（^0.x 锁 minor）与精确版（缺 patch 归一）、
 *      冲突不装错版本（docs/43-§十-6 / 51-D-1/D-2）；
 *   4. 自动安装全链：公司包 plugins/ 源 → 隔离根落位 + registry 登记 + 安装清单日志；
 *      确认位（confirm=false → 只出清单零落盘）；缺源双面（missing 如实可见 /
 *      failOnMissing 抛——docs/43-§十-7 / 51-D-3）；外部源接口第二源；
 *   5. 热重载：配置指纹变化 → 插件集重算+补装；指纹不变 → 零动作幂等；启用集收缩
 *      不卸载（docs/43-§十-8）；
 *   6. DEV-26 正式化增量：51-D-4 dsh 插件形态闸（公司包 plugins/ 源）、安装决策纯面
 *      planPluginInstalls 五动作判定表（零 IO——契约 deps 域同面）、replace 动作。
 *
 * 前 22 用例与 spike 证据面对齐（StudioNext-spike 仓 packages/company，docs/44-§v1.1
 * 机制二判定通过——语义不回退）；正式化增量单列 describe。
 *
 * 插件夹具：test/fixtures/company-src/plugins/dsh-web-test（1.2.0）+
 * test/fixtures/plugins/dsh-git-flow（2.0.1）——两个最小合法 dsh 插件
 * （docs/34-§3.1 形态：ESM 具名导出+dsh.bundle+insert 条目）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ClassifiedError } from '@studio-next/contract'
import {
  DEPENDENCIES_FILE,
  attributeCandidates,
  demandedPlugins,
  enabledPluginsFor,
  extractPersonAttrs,
  installCompanyPlugins,
  listInstalledPlugins,
  listPluginRootEntries,
  parseDependencies,
  parseVersionSpec,
  planPluginInstalls,
  satisfiesSpec,
  syncCompanyPlugins,
  pluginSetFingerprint,
  type CompanyDependencies,
  type PersonAttrs,
} from '../src/index.ts'

const fixtureSrc = fileURLToPath(new URL('./fixtures/company-src', import.meta.url))
const fixtureGitFlow = fileURLToPath(new URL('./fixtures/plugins/dsh-git-flow', import.meta.url))
const fixtureDepsSrc = (): string => readFileSync(path.join(fixtureSrc, DEPENDENCIES_FILE), 'utf8')
const T0 = '2026-10-20T08:00:00.000Z'
const NOW = (): Date => new Date(T0)

const AGENT_1: PersonAttrs = { id: 'AGENT-1', dept: 'departments/工程部', level: 2, role: '工程负责人', skills: ['typescript'], executor: 'dsh', status: 'active' }
// 设计师放**另一个部门**：隔离「dept=工程部 绑定」的干扰——第三条绑定（role=设计师）单独命中
const DESIGNER: PersonAttrs = { id: 'AGENT-2', dept: 'departments/设计部', level: 2, role: '设计师' }

/** 单绑定依赖清单（D-4 闸/replace 场景改写用） */
const singleBindingDeps = (version: string): string =>
  `schema: studio-next/dependencies@1\nbindings:\n  - when:\n      attr: role\n      is: 工程负责人\n    plugins:\n      - name: dsh-web-test\n        version: "${version}"\n`

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-deps-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

function errOf(err: unknown): Error & Partial<ClassifiedError> {
  return err as Error & Partial<ClassifiedError>
}

async function expectConfigInvalid(fn: () => Promise<unknown> | unknown, subcause: string): Promise<void> {
  try {
    await fn()
  } catch (err) {
    const e = errOf(err)
    expect(e.category).toBe('CONFIG_INVALID')
    expect(e.subcause).toBe(subcause)
    return
  }
  throw new Error(`期待 CONFIG_INVALID/${subcause}，实际未抛`)
}

/** 组装一个双插件公司目录（fixture 公司 + dsh-git-flow 进 plugins/ + deps 追加 dept→git-flow 绑定） */
async function composeTwoPluginCompany(name: string): Promise<{ dir: string; persons: PersonAttrs[] }> {
  const dir = path.join(root, name)
  await cp(fixtureSrc, dir, { recursive: true })
  await cp(fixtureGitFlow, path.join(dir, 'plugins', 'dsh-git-flow'), { recursive: true })
  const depsPath = path.join(dir, DEPENDENCIES_FILE)
  const deps = readFileSync(depsPath, 'utf8')
  await writeFile(
    depsPath,
    `${deps}\n  - when:\n      attr: dept\n      is: departments/工程部\n    plugins:\n      - name: dsh-git-flow\n        version: "2.0.1"\n`,
  )
  const persons = extractPersonAttrs(readFileSync(path.join(dir, 'org-config.yaml'), 'utf8'))
  return { dir, persons }
}

// ————————————————————————— 1. 解析与版本语义（纯函数面——docs/43-§四/§十-6） —————————————————————————

describe('依赖清单解析（docs/43-§四：strictObject）', () => {
  it('良性夹具解析：三条绑定（role 命中/dept 命中/不命中）', () => {
    const deps = parseDependencies(fixtureDepsSrc())
    expect(deps.schema).toBe('studio-next/dependencies@1')
    expect(deps.bindings.map((b) => `${b.when.attr}=${b.when.is}`)).toEqual(['role=工程负责人', 'dept=工程部', 'role=设计师'])
    expect(deps.bindings[0]?.plugins).toEqual([{ name: 'dsh-web-test', version: '^1.2' }])
  })

  it('strictObject：未知顶层键/坏 schema/未知绑定键/坏 version 形态/未知 attr 全拒', async () => {
    const base = fixtureDepsSrc()
    await expectConfigInvalid(() => parseDependencies(`${base}\nharmless: true\n`), 'deps/invalid')
    await expectConfigInvalid(() => parseDependencies(base.replace('schema: studio-next/dependencies@1', 'schema: other@1')), 'deps/invalid')
    await expectConfigInvalid(() => parseDependencies(base.replace('is: 工程负责人', 'is: 工程负责人\n      extra: 1')), 'deps/invalid')
    await expectConfigInvalid(() => parseDependencies(base.replace('"^1.2"', '"~1.2.3"')), 'deps/invalid') // 只收 ^ 与精确两形态（51-D-1）
    await expectConfigInvalid(() => parseDependencies(base.replace('attr: role', 'attr: mood')), 'deps/invalid') // attr 限档案已知键（43-§十-5 / 51-C-7）
  })
})

describe('版本解析（docs/43-§十-6：最小语义化——两形态）', () => {
  it('parseVersionSpec：^caret 与精确两形态（缺 patch 归一 .0）', () => {
    expect(parseVersionSpec('^1.2')).toEqual({ kind: 'caret', major: 1, minor: 2, patch: 0 })
    expect(parseVersionSpec('^1.2.3')).toEqual({ kind: 'caret', major: 1, minor: 2, patch: 3 })
    expect(parseVersionSpec('2.0.1')).toEqual({ kind: 'exact', major: 2, minor: 0, patch: 1 })
    expect(parseVersionSpec('1.2')).toEqual({ kind: 'exact', major: 1, minor: 2, patch: 0 })
    expect(parseVersionSpec('~1.2')).toBeNull()
    expect(parseVersionSpec('abc')).toBeNull()
  })

  it('satisfiesSpec：caret 区间（major>0 同大版本；^0.x 锁 minor）与精确等值', () => {
    const caret12 = parseVersionSpec('^1.2')
    if (caret12 === null) throw new Error('unreachable')
    expect(satisfiesSpec(caret12, '1.2.0')).toBe(true)
    expect(satisfiesSpec(caret12, '1.9.9')).toBe(true)
    expect(satisfiesSpec(caret12, '1.1.9')).toBe(false)
    expect(satisfiesSpec(caret12, '2.0.0')).toBe(false)
    const caret02 = parseVersionSpec('^0.2')
    if (caret02 === null) throw new Error('unreachable')
    expect(satisfiesSpec(caret02, '0.2.5')).toBe(true)
    expect(satisfiesSpec(caret02, '0.3.0')).toBe(false)
    const exact = parseVersionSpec('2.0.1')
    if (exact === null) throw new Error('unreachable')
    expect(satisfiesSpec(exact, '2.0.1')).toBe(true)
    expect(satisfiesSpec(exact, '2.0.0')).toBe(false)
    const exactShort = parseVersionSpec('1.2')
    if (exactShort === null) throw new Error('unreachable')
    expect(satisfiesSpec(exactShort, '1.2.0')).toBe(true) // 缺 patch 归一
    expect(satisfiesSpec(exactShort, '1.2.1')).toBe(false)
  })
})

// ————————————————————————— 2. 属性绑定求值（docs/43-§十-5） —————————————————————————

describe('属性绑定求值（docs/43-§十-5：role 命中 / dept 命中 / 不命中）', () => {
  const deps = parseDependencies(fixtureDepsSrc())

  it('属性候选：dept=path 全量+末段名；skills 逐元素；level 字符串化', () => {
    const c = attributeCandidates(AGENT_1)
    expect(c.dept).toEqual(['departments/工程部', '工程部'])
    expect(c.role).toEqual(['工程负责人'])
    expect(c.skills).toEqual(['typescript'])
    expect(c.level).toEqual(['2'])
  })

  it('role 命中：AGENT-1（工程负责人）→ dsh-web-test', () => {
    expect(enabledPluginsFor(AGENT_1, deps)).toEqual([{ name: 'dsh-web-test', version: '^1.2' }])
  })

  it('dept 命中：绑定 is: 工程部 命中 path=departments/工程部 的员工（末段名匹配）', () => {
    const deptBinding = deps.bindings.find((b) => b.when.attr === 'dept')
    expect(deptBinding?.when.is).toBe('工程部')
    expect(attributeCandidates(AGENT_1).dept?.includes('工程部')).toBe(true)
    // 同名去重：AGENT-1 同时命中 role 与 dept 两条绑定 → 一枚插件（全约束并集在安装面判）
    const demanded = demandedPlugins(deps, [AGENT_1])
    expect([...demanded.keys()]).toEqual(['dsh-web-test'])
    expect(demanded.get('dsh-web-test')).toEqual(['^1.2', '1.2.0'])
  })

  it('不命中：设计师角色的绑定对 AGENT-1 零启用；设计师只命中第三条', () => {
    expect(enabledPluginsFor(AGENT_1, deps).some((p) => p.version === '^9.0')).toBe(false)
    expect(enabledPluginsFor(DESIGNER, deps)).toEqual([{ name: 'dsh-web-test', version: '^9.0' }])
  })

  it('无任何属性命中的人 → 空启用集', () => {
    const nobody: PersonAttrs = { id: 'AGENT-9', dept: 'departments/市场部', level: 3, role: '增长官' }
    expect(enabledPluginsFor(nobody, deps)).toEqual([])
    expect(demandedPlugins(deps, [nobody]).size).toBe(0)
  })
})

// ————————————————————————— 3. 自动安装 e2e（真实 fs，隔离根注入——docs/43-§四） —————————————————————————

describe('自动安装全链（docs/43-§四：公司包 plugins/ 源 → 隔离根落位+登记+日志）', () => {
  let companyDir = ''
  let persons: PersonAttrs[]
  let pluginRoot = ''

  beforeAll(async () => {
    const composed = await composeTwoPluginCompany('company-two-plugins')
    companyDir = composed.dir
    persons = composed.persons
    pluginRoot = path.join(root, 'plugins-root-a')
  })

  it('e2e：两插件按属性命中自动安装到隔离根（绝不写用户 ~/.dsh——根为注入的 tmp）', async () => {
    const report = await installCompanyPlugins({ companyDir, pluginRoot, persons, by: '制作人', now: NOW })
    expect(report.confirmed).toBe(true)
    const installed = report.items.filter((i) => i.action === 'install')
    expect(installed.map((i) => i.name).sort()).toEqual(['dsh-git-flow', 'dsh-web-test'])
    expect(installed.every((i) => i.origin === 'package')).toBe(true) // 源=公司包 plugins/ 目录

    // 落位：插件目录完整复制进隔离根（dsh.bundle 形态随行——cordis.patch.yml + src/index.mjs）
    expect(existsSync(path.join(pluginRoot, 'dsh-web-test', 'src', 'index.mjs'))).toBe(true)
    expect(existsSync(path.join(pluginRoot, 'dsh-web-test', 'cordis.patch.yml'))).toBe(true)
    expect(existsSync(path.join(pluginRoot, 'dsh-git-flow', 'src', 'index.mjs'))).toBe(true)

    // 登记：registry.json 两员（name/version/source）
    const registry = await listInstalledPlugins(pluginRoot)
    expect(registry.map((e) => `${e.name}@${e.version}`).sort()).toEqual(['dsh-git-flow@2.0.1', 'dsh-web-test@1.2.0'])
    expect(registry.every((e) => e.source === 'company-package' && e.installedAt === T0 && e.by === '制作人')).toBe(true)

    // 可见面：安装清单日志落盘（install-log.jsonl 一行，含两插件名）；全部产物都在注入根内
    const log = readFileSync(report.logFile, 'utf8').trim().split('\n')
    expect(log.length).toBe(1)
    expect(log[0]).toContain('dsh-web-test')
    expect(log[0]).toContain('dsh-git-flow')
  })

  it('幂等重跑：已装版本满足全部约束 → satisfied，registry 不变、根内插件集不变', async () => {
    const before = await listInstalledPlugins(pluginRoot)
    const report = await installCompanyPlugins({ companyDir, pluginRoot, persons, by: '制作人', now: NOW })
    expect(report.items.every((i) => i.action === 'satisfied')).toBe(true)
    expect(await listInstalledPlugins(pluginRoot)).toEqual(before)
    expect((await listPluginRootEntries(pluginRoot)).filter((e) => e !== 'registry.json' && e !== 'install-log.jsonl' && e !== 'plugin-state.json').sort()).toEqual(['dsh-git-flow', 'dsh-web-test'])
  })

  it('多约束并集求值：AGENT-1 的 ^1.2 与 1.2.0 双约束同被 1.2.0 满足（一次安装）', async () => {
    const report = await installCompanyPlugins({ companyDir, pluginRoot: path.join(root, 'plugins-root-multi'), persons, now: NOW })
    const item = report.items.find((i) => i.name === 'dsh-web-test')
    expect(item?.required.sort()).toEqual(['1.2.0', '^1.2'])
    expect(item?.action).toBe('install') // 新根上一次装齐
  })

  it('确认位：confirm=false → 只出安装清单，零落盘零登记', async () => {
    const root2 = path.join(root, 'plugins-root-confirm')
    const report = await installCompanyPlugins({
      companyDir,
      pluginRoot: root2,
      persons,
      by: '制作人',
      now: NOW,
      confirm: ({ planned }) => {
        // 制作人看到的计划面：齐全才准拒
        expect(planned.filter((i) => i.action === 'install').map((i) => i.name).sort()).toEqual(['dsh-git-flow', 'dsh-web-test'])
        return false
      },
    })
    expect(report.confirmed).toBe(false)
    expect(report.items.every((i) => i.action === 'skipped')).toBe(true)
    expect(existsSync(path.join(root2, 'dsh-web-test'))).toBe(false) // 零落位
    expect(await listInstalledPlugins(root2)).toEqual([]) // 零登记
    expect(readFileSync(report.logFile, 'utf8')).toContain('confirm=false') // 日志如实留痕
  })

  it('缺源处理：绑定命中但公司包 plugins/ 无此插件 → missing 如实可见（默认不阻断；failOnMissing=true 则抛）', async () => {
    const ghostCompany = path.join(root, 'company-ghost')
    await cp(fixtureSrc, ghostCompany, { recursive: true })
    await writeFile(
      path.join(ghostCompany, DEPENDENCIES_FILE),
      `${fixtureDepsSrc()}\n  - when:\n      attr: role\n      is: 工程负责人\n    plugins:\n      - name: dsh-ghost\n        version: "^1.0"\n`,
    )
    const ghostRoot = path.join(root, 'plugins-root-ghost')
    const report = await installCompanyPlugins({ companyDir: ghostCompany, pluginRoot: ghostRoot, persons: [AGENT_1], now: NOW })
    const ghostItem = report.items.find((i) => i.name === 'dsh-ghost')
    expect(ghostItem?.action).toBe('missing')
    expect(ghostItem?.origin).toBe('none')
    expect(ghostItem?.detail).toContain('缺源')
    expect(existsSync(path.join(ghostRoot, 'dsh-ghost'))).toBe(false)

    await expectConfigInvalid(
      () => installCompanyPlugins({ companyDir: ghostCompany, pluginRoot: ghostRoot, persons: [AGENT_1], now: NOW, failOnMissing: true }),
      'deps/plugin-missing',
    )
  })

  it('版本冲突：源 1.2.0 不满足 ^9.0 → conflict 不装错版本、不落位', async () => {
    const conflictRoot = path.join(root, 'plugins-root-conflict')
    const report = await installCompanyPlugins({ companyDir, pluginRoot: conflictRoot, persons: [DESIGNER], now: NOW })
    const item = report.items[0]
    expect(item?.name).toBe('dsh-web-test')
    expect(item?.action).toBe('conflict')
    expect(item?.detail).toContain('不满足约束')
    expect(existsSync(path.join(conflictRoot, 'dsh-web-test'))).toBe(false)
  })

  it('外部源接口：PluginSource 注入可作第二源（公司包无该插件时按序问外部源）', async () => {
    const externalDir = path.join(root, 'external-source', 'dsh-external-tool')
    await cp(fixtureGitFlow, externalDir, { recursive: true })
    const pkgPath = path.join(externalDir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name: string; version: string }
    pkg.name = 'dsh-external-tool'
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
    const externalCompany = path.join(root, 'company-external')
    await cp(fixtureSrc, externalCompany, { recursive: true })
    await writeFile(
      path.join(externalCompany, DEPENDENCIES_FILE),
      `${fixtureDepsSrc()}\n  - when:\n      attr: role\n      is: 工程负责人\n    plugins:\n      - name: dsh-external-tool\n        version: "^2.0"\n`,
    )
    const externalRoot = path.join(root, 'plugins-root-external')
    const report = await installCompanyPlugins({
      companyDir: externalCompany,
      pluginRoot: externalRoot,
      persons: [AGENT_1],
      now: NOW,
      externalSources: [{ source: 'test-external', resolve: async (name) => (name === 'dsh-external-tool' ? externalDir : null) }],
    })
    const item = report.items.find((i) => i.name === 'dsh-external-tool')
    expect(item?.origin).toBe('external')
    expect(item?.action).toBe('install')
    expect((await listInstalledPlugins(externalRoot)).find((e) => e.name === 'dsh-external-tool')).toMatchObject({ version: '2.0.1', source: 'external' })
  })

  it('无依赖清单的公司 → 空报告（依赖清单同时是能力声明，不写=零行为面）', async () => {
    const noDepsCompany = path.join(root, 'company-no-deps')
    await cp(fixtureSrc, noDepsCompany, { recursive: true })
    await rm(path.join(noDepsCompany, DEPENDENCIES_FILE))
    const emptyRoot = path.join(root, 'plugins-root-empty')
    const report = await installCompanyPlugins({ companyDir: noDepsCompany, pluginRoot: emptyRoot, persons: [AGENT_1], now: NOW })
    expect(report.items).toEqual([])
    expect(readFileSync(report.logFile, 'utf8')).toContain('no-dependencies')
  })
})

// ————————————————————————— 4. 热重载（docs/43-§十-8：配置指纹 → 插件集重算） —————————————————————————

describe('热重载（docs/43-§十-8：配置指纹变化 → 插件集重算）', () => {
  let companyDir = ''
  let persons: PersonAttrs[]
  let pluginRoot = ''

  beforeAll(async () => {
    companyDir = path.join(root, 'company-hot')
    await cp(fixtureSrc, companyDir, { recursive: true }) // v1 依赖清单：只有 dsh-web-test 绑定
    persons = extractPersonAttrs(readFileSync(path.join(companyDir, 'org-config.yaml'), 'utf8'))
    pluginRoot = path.join(root, 'plugins-root-hot')
  })

  it('首次 sync：changed=true，AGENT-1 启用 dsh-web-test 并安装', async () => {
    const result = await syncCompanyPlugins({ companyDir, pluginRoot, persons, now: NOW })
    expect(result.changed).toBe(true)
    expect(result.enabled['AGENT-1']).toEqual([{ name: 'dsh-web-test', version: '^1.2' }])
    expect((await listInstalledPlugins(pluginRoot)).map((e) => e.name)).toEqual(['dsh-web-test'])
  })

  it('指纹不变再 sync：changed=false 零动作（无新安装报告、日志不增行）', async () => {
    const logFile = path.join(pluginRoot, 'install-log.jsonl')
    const linesBefore = readFileSync(logFile, 'utf8').trim().split('\n').length
    const result = await syncCompanyPlugins({ companyDir, pluginRoot, persons, now: NOW })
    expect(result.changed).toBe(false)
    expect(result.install).toBeUndefined()
    expect(readFileSync(logFile, 'utf8').trim().split('\n').length).toBe(linesBefore)
  })

  it('配置指纹变化（deps 追加 dept→dsh-git-flow 绑定 + 插件入包）→ 重算并补装', async () => {
    await cp(fixtureGitFlow, path.join(companyDir, 'plugins', 'dsh-git-flow'), { recursive: true })
    const depsPath = path.join(companyDir, DEPENDENCIES_FILE)
    await writeFile(
      depsPath,
      `${readFileSync(depsPath, 'utf8')}\n  - when:\n      attr: dept\n      is: 工程部\n    plugins:\n      - name: dsh-git-flow\n        version: "2.0.1"\n`,
    )
    const result = await syncCompanyPlugins({ companyDir, pluginRoot, persons, now: NOW })
    expect(result.changed).toBe(true)
    // 启用集重算：AGENT-1 双插件
    expect(result.enabled['AGENT-1']?.map((p) => p.name).sort()).toEqual(['dsh-git-flow', 'dsh-web-test'])
    // 补装：只有 dsh-git-flow 是新装；dsh-web-test satisfied
    expect(result.install?.items.find((i) => i.name === 'dsh-git-flow')?.action).toBe('install')
    expect(result.install?.items.find((i) => i.name === 'dsh-web-test')?.action).toBe('satisfied')
    expect((await listInstalledPlugins(pluginRoot)).map((e) => e.name).sort()).toEqual(['dsh-git-flow', 'dsh-web-test'])
    // 状态落盘：新指纹与新启用集
    const state = JSON.parse(await readFile(path.join(pluginRoot, 'plugin-state.json'), 'utf8')) as { fingerprint: string; enabled: Record<string, { name: string }[]> }
    expect(state.fingerprint).toBe(result.fingerprint)
    expect(state.enabled['AGENT-1']?.map((p) => p.name).sort()).toEqual(['dsh-git-flow', 'dsh-web-test'])
  })

  it('pluginSetFingerprint：deps 内容或启用面任一变化都翻指纹；双不变=同指纹', () => {
    const depsA = fixtureDepsSrc()
    const depsB = `${depsA}\n  - when:\n      attr: role\n      is: 审计官\n    plugins:\n      - name: dsh-x\n        version: "^1.0"\n`
    const enabledA: Record<string, { name: string; version: string }[]> = { 'AGENT-1': [{ name: 'dsh-web-test', version: '^1.2' }] }
    const enabledB: Record<string, { name: string; version: string }[]> = {
      'AGENT-1': [
        { name: 'dsh-web-test', version: '^1.2' },
        { name: 'dsh-git-flow', version: '2.0.1' },
      ],
    }
    expect(pluginSetFingerprint(depsA, enabledA)).not.toBe(pluginSetFingerprint(depsB, enabledA)) // deps 变
    expect(pluginSetFingerprint(depsA, enabledA)).not.toBe(pluginSetFingerprint(depsA, enabledB)) // 启用面变
    expect(pluginSetFingerprint(depsA, enabledA)).toBe(pluginSetFingerprint(depsA, enabledA)) // 双不变=同指纹
  })

  it('员工属性面变化同样触发重算（无人 → 启用集收缩；已装保留=v1 保留策略）', async () => {
    const result = await syncCompanyPlugins({ companyDir, pluginRoot, persons: [], now: NOW })
    expect(result.changed).toBe(true)
    expect(result.enabled).toEqual({}) // 无人=零启用
    expect(result.install?.items.every((i) => i.action === 'satisfied')).toBe(true) // 不卸载（docs/43-§十-8：registry=追加事实，卸载语义归后续单）
  })
})

// ————————————————————————— 5. DEV-26 正式化增量（51-D-4 形态闸 + 决策纯面 + replace） —————————————————————————

describe('DEV-26 正式化：51-D-4 dsh 插件形态闸（公司包 plugins/ 源）', () => {
  it('缺 dsh.bundle 声明 → deps/plugin-package-invalid（profile 层入场券，docs/34-§3.1）', async () => {
    const broken = path.join(root, 'company-broken-bundle')
    await cp(fixtureSrc, broken, { recursive: true })
    const pkgPath = path.join(broken, 'plugins', 'dsh-web-test', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>
    delete pkg['dsh']
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
    await expectConfigInvalid(
      () => installCompanyPlugins({ companyDir: broken, pluginRoot: path.join(root, 'plugins-root-broken-bundle'), persons: [AGENT_1], now: NOW }),
      'deps/plugin-package-invalid',
    )
  })

  it('dsh.bundle.patch 所指文件不在位 → 同 subcause 拒收（patch 悬空=形态不完整）', async () => {
    const broken = path.join(root, 'company-broken-patch')
    await cp(fixtureSrc, broken, { recursive: true })
    const pkgPath = path.join(broken, 'plugins', 'dsh-web-test', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { dsh: { bundle: { patch: string } } }
    pkg.dsh.bundle.patch = './not-there.patch.yml'
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
    await expectConfigInvalid(
      () => installCompanyPlugins({ companyDir: broken, pluginRoot: path.join(root, 'plugins-root-broken-patch'), persons: [AGENT_1], now: NOW }),
      'deps/plugin-package-invalid',
    )
  })

  it('外部源不做形态闸（注入方责任面）：name/version 齐即认源——宽松与公司包闸对照', async () => {
    const externalDir = path.join(root, 'external-no-bundle', 'dsh-loose-tool')
    await cp(fixtureGitFlow, externalDir, { recursive: true })
    const pkgPath = path.join(externalDir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name: string; dsh?: unknown }
    pkg.name = 'dsh-loose-tool'
    delete pkg['dsh'] // 无 dsh.bundle——公司包内会拒，外部源只认 name/version
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
    const company = path.join(root, 'company-external-loose')
    await cp(fixtureSrc, company, { recursive: true })
    await writeFile(path.join(company, DEPENDENCIES_FILE), singleBindingDeps('^2.0').replaceAll('dsh-web-test', 'dsh-loose-tool'))
    const report = await installCompanyPlugins({
      companyDir: company,
      pluginRoot: path.join(root, 'plugins-root-external-loose'),
      persons: [AGENT_1],
      now: NOW,
      externalSources: [{ source: 'test-external', resolve: async (name) => (name === 'dsh-loose-tool' ? externalDir : null) }],
    })
    expect(report.items[0]).toMatchObject({ name: 'dsh-loose-tool', origin: 'external', action: 'install' })
  })
})

describe('DEV-26 正式化：安装决策纯面 planPluginInstalls（零 IO——契约 deps 域同面）', () => {
  const mkDeps = (version: string): CompanyDependencies => parseDependencies(singleBindingDeps(version))
  const persons: PersonAttrs[] = [AGENT_1]

  it('五动作判定表：missing/conflict/satisfied/install/replace 由快照唯一决定（与 fs 无关）', () => {
    // missing：无源（43-§十-7 默认面）
    expect(planPluginInstalls({ deps: mkDeps('^1.0'), persons, installed: {}, sources: {} })[0]?.action).toBe('missing')
    // conflict：源 2.0.0 不满足 ^1.0（51-D-2 不装错）
    expect(planPluginInstalls({ deps: mkDeps('^1.0'), persons, installed: {}, sources: { 'dsh-web-test': { origin: 'package', version: '2.0.0' } } })[0]).toMatchObject({ action: 'conflict', sourceVersion: '2.0.0' })
    // satisfied：已装 1.4.2 满足 ^1.0（幂等零动作）
    expect(planPluginInstalls({ deps: mkDeps('^1.0'), persons, installed: { 'dsh-web-test': '1.4.2' }, sources: { 'dsh-web-test': { origin: 'package', version: '1.2.0' } } })[0]).toMatchObject({ action: 'satisfied', installedVersion: '1.4.2' })
    // install：首装（源版本随行）
    expect(planPluginInstalls({ deps: mkDeps('^1.0'), persons, installed: {}, sources: { 'dsh-web-test': { origin: 'external', version: '1.2.0' } } })[0]).toMatchObject({ action: 'install', origin: 'external' })
    // replace：已装 0.9.0 不合 ^1.0，源 1.2.0 合 → 换装（保留旧版登记回填）
    expect(planPluginInstalls({ deps: mkDeps('^1.0'), persons, installed: { 'dsh-web-test': '0.9.0' }, sources: { 'dsh-web-test': { origin: 'package', version: '1.2.0' } } })[0]).toMatchObject({ action: 'replace', installedVersion: '0.9.0' })
  })
})

describe('DEV-26 正式化：replace 动作 e2e（约束升版 → 换装+registry 换登记）', () => {
  it('已装 1.2.0 不合 ^2.0 且源 2.1.0 满足 → 替换落位、registry 换登记（卸载语义归后续单）', async () => {
    const dir = path.join(root, 'company-replace')
    await cp(fixtureSrc, dir, { recursive: true })
    const depsPath = path.join(dir, DEPENDENCIES_FILE)
    await writeFile(depsPath, singleBindingDeps('^1.2'))
    const proot = path.join(root, 'plugins-root-replace')

    const r1 = await installCompanyPlugins({ companyDir: dir, pluginRoot: proot, persons: [AGENT_1], now: NOW })
    expect(r1.items[0]?.action).toBe('install')

    // 源升 2.1.0 + 约束升 ^2.0 → replace
    const pkgPath = path.join(dir, 'plugins', 'dsh-web-test', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }
    pkg.version = '2.1.0'
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
    await writeFile(depsPath, singleBindingDeps('^2.0'))

    const r2 = await installCompanyPlugins({ companyDir: dir, pluginRoot: proot, persons: [AGENT_1], now: NOW })
    expect(r2.items[0]).toMatchObject({ name: 'dsh-web-test', action: 'replace', installedVersion: '2.1.0' })
    expect(await listInstalledPlugins(proot)).toMatchObject([{ name: 'dsh-web-test', version: '2.1.0' }])
    expect(existsSync(path.join(proot, 'dsh-web-test', 'src', 'index.mjs'))).toBe(true)
  })
})
