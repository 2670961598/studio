/**
 * 行业模板包打样（DEV-30；docs/43-§三「行业模板包：同 schema、不同资产」）——包侧结构测试
 *
 * 断言面（对照 docs/43-§三 + docs/51 契约）：
 *   1. 两套行业包（互联网/游戏）模板全树直读全绿：org-config/departments/people/jobs
 *      全目录面（loadCompanyDirectory 真实校验器，非 mock）；
 *   2. **同 schema 不同资产**：两包 schema 字面量相同（org-config/v1）、slug/部门轴/
 *      定时岗/依赖清单各不相同（行业差异只落资产，不落 schema——docs/43-§二末条）；
 *   3. 行业资产在位：charter.md（charter_ref 悬空检）/ prompts 战役 / README 上手说明 /
 *      dependencies.yaml（docs/43-§四）；
 *   4. 包侧面结构纪律（docs/51 契约 E / git-import 结构闸的包侧面）：顶层条目 ∈ 封闭
 *      内容集、无 exec 位、无符号链接；
 *   5. 插件形态（docs/51-D-4）：package.json name/version + dsh.bundle 声明指向存在
 *      的补丁文件 + src/index.mjs 具名导出 name/apply；
 *   6. 依赖清单求值：绑定命中（role/dept/skills 三面）+ 安装计划 install/missing
 *      （缺源=能力声明面，docs/43-§十-7——不装错、不阻断）。
 *
 * 导入流可装可跑的**全链证据**在 apps/daemon/test/industry-templates.e2e.test.ts
 * （DEV-27 company add 真 CLI + fake 一单）——本文件只锁包内容本身。
 */
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseDependencies, planPluginInstalls, enabledPluginsFor, extractPersonAttrs, type PluginPlanSource } from '../src/dependencies.ts'
import { readDirectoryFiles } from '../src/init.ts'
import { loadCompanyDirectory } from '../src/validator.ts'

const templatesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../templates')

/** 行业示例包清单（DEV-30 打样面：互联网 + 游戏） */
const PACKAGES = [
  {
    dir: 'company-internet',
    slug: 'internet-corp',
    name: '星潮互联网公司',
    deptPaths: ['departments/研发部', 'departments/增长部'],
    people: ['NET-1', 'NET-2', 'GRO-1'],
    jobs: ['net-site-patrol', 'net-growth-daily'],
    plugin: 'dsh-web-test',
    missingPlugin: 'dsh-metrics-board',
    charterKeyword: '互联网行业条款',
    campaignKeyword: '北极星指标体系',
  },
  {
    dir: 'company-game',
    slug: 'game-corp',
    name: '星火游戏工作室',
    deptPaths: ['departments/研发部', 'departments/内容部'],
    people: ['GAME-1', 'GAME-3', 'GAME-2'],
    jobs: ['game-build-smoke', 'game-feedback-patrol'],
    plugin: 'dsh-asset-check',
    missingPlugin: 'dsh-loc-lint',
    charterKeyword: '游戏行业条款',
    campaignKeyword: 'S3 赛季更新',
  },
] as const

/**
 * 顶层封闭内容集（镜像 git-import.ts TOP_LEVEL_CONTENT_ALLOWLIST / docs/51-A-4 基线；
 * 导入流真实闸门在 daemon e2e 全链跑，此处锁包源面不漂移）。
 */
const TOP_LEVEL_ALLOWLIST = [
  '.studio-next.yaml', 'org-config.yaml', 'dependencies.yaml', 'README.md',
  'charter.md', 'charter', 'departments', 'prompts', 'docs', 'reports', 'plugins',
] as const

/** 递归走查：文件相对路径列表（含隐藏文件；目录不入列） */
function walkFiles(dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkFiles(abs, rel))
    else out.push(rel)
  }
  return out
}

describe.each(PACKAGES)('DEV-30 · 行业模板包 $dir（docs/43-§三）', (pkg) => {
  const dir = path.join(templatesRoot, pkg.dir)

  it('模板全树直读全绿：org-config/departments/people/jobs 全目录面（真实校验器）', async () => {
    const r = loadCompanyDirectory(await readDirectoryFiles(dir))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.snapshot.slug).toBe(pkg.slug)
    expect(r.snapshot.name).toBe(pkg.name)
    expect(r.snapshot.departments.map((d) => d.path)).toEqual(pkg.deptPaths)
    expect(r.snapshot.people.map((p) => p.id)).toEqual(pkg.people)
    expect(r.snapshot.jobs.map((j) => j.job_id)).toEqual(pkg.jobs)
  })

  it('jobs 装载面：cron 岗直读 + 节奏档位岗展开成真 cron（docs/35-§3）', async () => {
    const r = loadCompanyDirectory(await readDirectoryFiles(dir))
    if (!r.ok) throw new Error('前置全绿失败')
    const byId = new Map(r.snapshot.jobs.map((j) => [j.job_id, j]))
    if (pkg.dir === 'company-internet') {
      const patrol = byId.get('net-site-patrol')
      expect(patrol?.cron).toBe('*/10 * * * *')
      expect(patrol?.payload?.type).toBe('patrol')
      expect(patrol?.payload?.output).toBeUndefined() // 127-A R3：patrol 不声明 output（结构性零产出）
      expect(patrol?.payload?.sla?.first_ack_ms).toBe(10 * 60_000)
      const daily = byId.get('net-growth-daily')
      expect(daily?.cron).toBe('30 18 * * *') // daily@18:30 展开形态
      expect(daily?.payload?.cadence_tier).toBe('daily')
      expect(daily?.payload?.cadence_at).toBe('18:30')
      expect(daily?.payload?.outputs).toEqual(['daily-growth-report'])
      expect(daily?.payload?.sla?.resolve_hint_ms).toBe(4 * 3_600_000)
      expect(daily?.payload?.grace_ms).toBe(2 * 3_600_000) // 127-A R2：grace → payload.grace_ms
    } else {
      const smoke = byId.get('game-build-smoke')
      expect(smoke?.cron).toBe('0 9 * * 1-5')
      expect(smoke?.payload?.type).toBe('smoke')
      const patrol = byId.get('game-feedback-patrol')
      expect(patrol?.cron).toBe('0 * * * *') // hourly 缺省整点档
      expect(patrol?.payload?.cadence_tier).toBe('hourly')
      expect(patrol?.payload?.escalate).toEqual([{ after_ms: 30 * 60_000, unacked: 'game-lead' }])
    }
  })

  it('行业资产在位：charter（含行业条款）/ prompts 战役 / README 上手说明 / dependencies.yaml', async () => {
    const files = await readDirectoryFiles(dir)
    // charter_ref 悬空检已由 loadCompanyDirectory 保证；此处锁行业味道与上手说明
    expect(files['charter.md']).toContain(pkg.charterKeyword)
    expect(files['prompts/company.md']).toContain('## 战役（近期）')
    expect(files['prompts/company.md']).toContain(pkg.campaignKeyword)
    expect(files['README.md']).toContain('studio-next company add')
    expect(files['README.md']).toContain('org-config/v1')
    expect(files['dependencies.yaml']).toContain('studio-next/dependencies@1')
    // 挂载元信息随行（schema 与 org-config 同源；template 字段=包名）
    expect(files['.studio-next.yaml']).toContain(`template: ${pkg.dir}`)
    // 六节档案逐人在位（front-matter 由 loadCompanyDirectory 保证，此处锁 AUTO 受管区块纪律）
    for (const p of pkg.people) {
      const file = Object.entries(files).find(([k]) => k.endsWith(`/${p}.md`))?.[1]
      expect(file, `档案 ${p}.md 不在包内`).toBeDefined()
      expect(file).toContain('<!--AUTO-->')
    }
  })

  it('包侧面结构纪律：顶层条目 ∈ 封闭内容集 + 全树无 exec 位 + 无符号链接（docs/51-E）', () => {
    for (const entry of readdirSync(dir)) {
      expect(TOP_LEVEL_ALLOWLIST, `顶层条目 ${entry} 不在封闭内容集`).toContain(entry)
    }
    for (const rel of walkFiles(dir)) {
      const st = lstatSync(path.join(dir, rel))
      expect(st.isSymbolicLink(), `${rel} 是符号链接`).toBe(false)
      if (st.isFile()) {
        expect(st.mode & 0o111, `${rel} 带可执行位`).toBe(0)
      }
    }
  })

  it('插件形态（docs/51-D-4）：package.json + dsh.bundle 指向存在的补丁 + src 具名导出 name/apply', () => {
    const pj = JSON.parse(readFileSync(path.join(dir, 'plugins', pkg.plugin, 'package.json'), 'utf8')) as {
      name: string
      version: string
      dsh?: { bundle?: { patch?: string } }
    }
    expect(pj.name).toBe(pkg.plugin)
    expect(pj.version).toMatch(/^\d+\.\d+\.\d+$/)
    const patch = pj.dsh?.bundle?.patch
    expect(patch).toBe('./cordis.patch.yml')
    expect(existsSync(path.join(dir, 'plugins', pkg.plugin, 'cordis.patch.yml'))).toBe(true)
    const src = readFileSync(path.join(dir, 'plugins', pkg.plugin, 'src', 'index.mjs'), 'utf8')
    expect(src).toContain('export const name')
    expect(src).toContain('export function apply')
  })

  it('依赖清单求值（docs/43-§四/§十）：绑定命中面 + install/missing 计划（缺源=能力声明）', () => {
    const deps = parseDependencies(readFileSync(path.join(dir, 'dependencies.yaml'), 'utf8'))
    const persons = extractPersonAttrs(readFileSync(path.join(dir, 'org-config.yaml'), 'utf8'))
    expect(deps.schema).toBe('studio-next/dependencies@1')
    expect(deps.bindings.length).toBeGreaterThanOrEqual(2)
    // 三种命中面至少覆盖两种（role/dept/skills——attr 封闭枚举 51-C-7 由 schema 保证）
    const attrs = new Set(deps.bindings.map((b) => b.when.attr))
    expect([...attrs].filter((a) => ['role', 'dept', 'skills'].includes(a)).length).toBeGreaterThanOrEqual(2)
    // 安装计划：包内自带源 install；声明的缺源插件 missing（如实可见，不阻断）
    const sources: Record<string, PluginPlanSource> = {
      [pkg.plugin]: { origin: 'package', version: readPkgVersion(dir, pkg.plugin) },
    }
    const plan = planPluginInstalls({ deps, persons, installed: {}, sources })
    const byName = new Map(plan.map((x) => [x.name, x]))
    expect(byName.get(pkg.plugin)?.action).toBe('install')
    expect(byName.get(pkg.missingPlugin)?.action).toBe('missing')
    // 每个有命中的人都能列出插件面（员工行为面）
    expect(persons.filter((p) => enabledPluginsFor(p, deps).length > 0).length).toBeGreaterThanOrEqual(2)
  })
})

describe('DEV-30 · 同 schema 不同资产（docs/43-§三核心取舍）', () => {
  it('两包共用同一 schema 字面量，slug/部门轴/定时岗/依赖清单互不相同', async () => {
    const loaded = []
    for (const pkg of PACKAGES) {
      const files = await readDirectoryFiles(path.join(templatesRoot, pkg.dir))
      const org = files['org-config.yaml'] ?? ''
      expect(org).toContain('schema: org-config/v1')
      loaded.push({ org, files })
    }
    const [a, b] = loaded
    expect(a.org).not.toBe(b.org) // 资产不同
    expect(a.files['charter.md']).not.toBe(b.files['charter.md'])
    expect(a.files['prompts/company.md']).not.toBe(b.files['prompts/company.md'])
    expect(a.files['dependencies.yaml']).not.toBe(b.files['dependencies.yaml'])
  })

  it('与既有最小模板同 schema（templates/company-2-level 也不漂移）', async () => {
    const base = loadCompanyDirectory(await readDirectoryFiles(path.join(templatesRoot, 'company-2-level')))
    expect(base.ok).toBe(true)
  })
})

function readPkgVersion(dir: string, name: string): string {
  const st = statSync(path.join(dir, 'plugins', name, 'package.json'))
  expect(st.isFile()).toBe(true)
  return (JSON.parse(readFileSync(path.join(dir, 'plugins', name, 'package.json'), 'utf8')) as { version: string }).version
}
