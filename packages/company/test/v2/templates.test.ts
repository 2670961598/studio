/**
 * MIG-05 / IMPL-05-04＋05-05 · 模板八层级＋game/internet＋plugins 升格登记（V2 新套件）
 *
 * 覆盖（冻结验收口径）：
 *   1. 八层级模板（company-2-level..9-level）可装载/可校验：loadCompanyDirectory 真实校验器全绿；
 *   2. 行业模板（company-game/internet）同口径可装载；
 *   3. 纯配置边界（NEG-PKG-03/07；v2/06 §2.1/§2.2、v2/10 §4.8）：无符号链接、无 exec 位、除
 *      plugins/ 下 DSH 插件外无可执行内容/无 shebang/无 bash 围栏/无宿主命令/无本机路径/无疑似秘密；
 *   4. B13：模板 plugins 恰 6 件保留不迁出（84 裁决一），与 registry `builtinAssets` 清单逐件一致；
 *   5. 资产升格登记（ASSET-01）：exclusive＋targetExecutor=dsh＋requiredness/availability/
 *      provenance/license/digest 齐全；REC-ASSET-01 payload 专属标记与传播损失说明不丢（NEG-REC-11）；
 *   6. 传播语义（v2/06 §3.4）：有 dsh → loaded；缺 dsh → 必备不可用（默认拒绝装载；降级须具名）；
 *   7. DEC-OPEN-16 未裁：模板不写解散/清算条款并登记缺口；
 *   8. CL 与部门结构符合 v2/03：表 A 下限齐备、Dn=负责人 Gn（表 E 最低设立层）、N 参数不写死；
 *      并复用 defpkg 的 CL 判据：模板自身（无设立记录）不冒充设立（NEG-PKG-07）。
 *
 * 依据：v2/06 §2.1/§2.2/§三/§3.4/§4.5/§4.6/§5.1/§5.2/§六/§九；v2/03 §2.2 表 A/§2.4/§6.2 表 E；
 *       v2/10 §3.3/§4.3/§4.4/§4.7/§4.8；v2/17 NEG-PKG-03/07/08、NEG-ORG-06、NEG-REC-11；
 *       plan/05 IMPL-05-04/05-05；plan/03 MIG-05 冻结物 B13。
 *
 * 纪律：只读仓内模板（不改模板、不落仓内文件）；临时物只落 os.tmpdir()；无 LLM 打桩；
 *       断言失败＝模板不合规，改模板不改断言。秘密扫描只声明「未发现疑似」，不称「绝无秘密」。
 *
 * 触及面旧测试登记（V2 开工 tag 前已有＝旧测试，不作施工门；红也登记——plan/04 §1.8）：
 *   - packages/company/test/gen-template.test.ts（7 例）：3-9 逐字节==生成器输出。生成器仍是 v1 骨架
 *     （level-specs.ts/gen-template.ts），MIG-05 已把模板迁到 V2 结构；生成器重写/退役归后续单
 *     （本单领土不含 src，只登记不修）。
 *   - packages/company/test/industry-templates.test.ts（2 例）：people 精确清单——新增最高宰相 G9 拟任。
 *   - packages/company/test/init.test.ts（2 例）：2 级模板文件集 9→10（新增 PRIME-0 档案）、5 级
 *     jobs 12→13（新增 audit-cycle 部门审计岗）——结构变更，非回归；spawn 冒烟 1 例属既有 5s 超时族
 *     （old-tests-ledger；30s 复跑绿）。
 *   - packages/company/test/create.test.ts（1 例）：AIWS 工位 1→2（people 1→2，同上）。
 *   - packages/company/test/multifile.test.ts（1 例）：模板 people 精确清单 ['AGENT-1']——同上。
 *   - 已复跑仍绿：apps/daemon/test/cli/industry-templates.e2e.test.ts、packages/panel/test/overview*.test.ts、
 *     packages/company/test/{jobs-loading,groups,hooks,state-hygiene,workflows,cost-guard}.test.ts。
 */
import { cp, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { readDirectoryFiles } from '../../src/init.ts'
import { loadCompanyDirectory } from '../../src/validator.ts'
import {
  assetLocation,
  builtinAssets,
  digestAssetDirectory,
  isExecutableContent,
  isPluginAssetPosition,
  judgeLevelClaim,
  loadCompanyAssets,
  parseAssetManifest,
  scanSuspiciousText,
  splitStudioNextYaml,
  toAssetRegistrationPayload,
  walkTree,
  type AssetEntry,
  type OrgStructureFacts,
} from '../../src/assets/index.ts'
import { captureError } from './assets-fixtures.ts'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const TEMPLATES_ROOT = path.join(REPO_ROOT, 'templates')

interface TemplateSpec {
  dir: string
  /** 模板声明的 CL 主张（company.level） */
  level: number
  /** 一级单元 N 的**示例值**（默认 1 的形态不算写死；N=3 仅示例） */
  nExample: number
}

const LEVEL_TEMPLATES: readonly TemplateSpec[] = [
  { dir: 'company-2-level', level: 2, nExample: 1 },
  { dir: 'company-3-level', level: 3, nExample: 1 },
  { dir: 'company-4-level', level: 4, nExample: 1 },
  { dir: 'company-5-level', level: 5, nExample: 1 },
  { dir: 'company-6-level', level: 6, nExample: 1 },
  { dir: 'company-7-level', level: 7, nExample: 2 },
  { dir: 'company-8-level', level: 8, nExample: 3 },
  { dir: 'company-9-level', level: 9, nExample: 3 },
]

const INDUSTRY_TEMPLATES: readonly TemplateSpec[] = [
  { dir: 'company-game', level: 3, nExample: 1 },
  { dir: 'company-internet', level: 3, nExample: 1 },
]

const ALL_TEMPLATES: readonly TemplateSpec[] = [...LEVEL_TEMPLATES, ...INDUSTRY_TEMPLATES]

const templateDir = (dir: string): string => path.join(TEMPLATES_ROOT, dir)
const readTemplate = (dir: string): Promise<Record<string, string>> => readDirectoryFiles(templateDir(dir))

// ───────────────────────── 结构读取（org-config 的 V2 判定输入） ─────────────────────────

interface OrgDept {
  name: string
  path: string
  leader: string
  level: number
  parent: string | null
}
interface OrgPerson {
  id: string
  level: number
  dept: string
  role: string
}
interface OrgDoc {
  company: { level: number; name: string; slug: string; charter_ref: string; level_distribution: Record<string, number> }
  departments: OrgDept[]
  people: OrgPerson[]
}

function parseOrg(src: string): OrgDoc {
  const raw: unknown = parseYaml(src)
  if (typeof raw !== 'object' || raw === null) throw new Error('org-config 顶层须为对象（SCH-ORG-01）')
  return raw as OrgDoc
}

/** 部门嵌套深度：路径中 `departments` 段数（根部门=1；一层嵌套=2……v2/03 §2.4 CL8 判据） */
function deptDepth(deptPath: string): number {
  return deptPath.split('/').filter((seg) => seg === 'departments').length
}

/** 组织面结构事实（拟任面；established/rootDelegation 由测试显式给，不由模板自称） */
function structureFacts(org: OrgDoc): OrgStructureFacts {
  const levelById = new Map(org.people.map((p) => [p.id, p.level]))
  const leaderLevel = (dept: OrgDept): number => levelById.get(dept.leader) ?? -1
  return {
    established: false,
    rootDelegation: false,
    bossCovered: org.people.some((p) => p.level === 9 && p.role.includes('最高宰相')),
    inPositionLevels: org.people.map((p) => p.level),
    deptCount: org.departments.filter((dept) => leaderLevel(dept) === 8).length,
    maxDeptDepth: Math.max(1, ...org.departments.map((dept) => deptDepth(dept.path))),
    auditPosition: org.departments.some((dept) => dept.path.includes('审计') && leaderLevel(dept) >= 5),
  }
}

/** 表 E 最低设立层（v2/03 §6.2）：Dn 只能在该 CL 及以上设立；D1/D2 任意 */
const MIN_ESTABLISH_CL: Readonly<Record<number, number>> = { 8: 4, 7: 5, 6: 6, 5: 8, 4: 8, 3: 8 }

/** 表 A 必设下限（v2/03 §2.2；只查该 CL 行要求的角色是否在拟任结构里在位） */
function assertTableAMinimums(org: OrgDoc, claim: number): void {
  const levels = new Set(org.people.map((p) => p.level))
  const levelById = new Map(org.people.map((p) => [p.id, p.level]))
  const leaderLevel = (dept: OrgDept): number => levelById.get(dept.leader) ?? -1
  const d8 = org.departments.filter((dept) => leaderLevel(dept) === 8)
  expect(org.people.some((p) => p.level === 9 && p.role.includes('最高宰相')), '最高宰相 G9 必设（CL2-CL9）').toBe(true)
  if (claim >= 3) expect(levels.has(1) || levels.has(2), '执行成员 G2-G1 必设（CL3+）').toBe(true)
  if (claim >= 4) expect(d8.length, '首个 D8 部门与 G8 部长必设（CL4+）').toBeGreaterThanOrEqual(1)
  if (claim >= 5) expect(levels.has(7), '中间层 G7 必设（CL5+）').toBe(true)
  if (claim >= 6) {
    expect(levels.has(6), '中间层 G6 必设（CL6+）').toBe(true)
    expect(d8.length, '第二个 D8 部门必设（CL6+）').toBeGreaterThanOrEqual(2)
  }
  if (claim >= 7) {
    expect(
      org.departments.some((dept) => leaderLevel(dept) === 7 && deptDepth(dept.path) >= 2),
      'D7 子部门（部门内嵌套）必设（CL7+）',
    ).toBe(true)
    expect(
      org.departments.some((dept) => dept.path.includes('审计') && leaderLevel(dept) >= 5),
      '专职部门审计位置必设（CL7+）',
    ).toBe(true)
  }
  if (claim >= 8) {
    expect(levels.has(5) && levels.has(4) && levels.has(3), 'G5-G3 层在编（CL8+）').toBe(true)
    expect(Math.max(...org.departments.map((dept) => deptDepth(dept.path))), '部门嵌套深度≥3（CL8+）').toBeGreaterThanOrEqual(3)
  }
  if (claim >= 9) {
    for (const g of [2, 3, 4, 5, 6, 7, 8]) expect(levels.has(g), `G${g} 全链在编（CL9）`).toBe(true)
    expect(d8.length, '≥3 个 D8 部门在编（CL9）').toBeGreaterThanOrEqual(3)
  }
}

/** D 族：Dn=负责人 Gn（D9 不启用）＋表 E 最低设立层 */
function assertDeptLevels(org: OrgDoc, claim: number): void {
  const levelById = new Map(org.people.map((p) => [p.id, p.level]))
  expect(org.departments.length).toBeGreaterThanOrEqual(1)
  for (const dept of org.departments) {
    const leaderLevel = levelById.get(dept.leader)
    expect(leaderLevel, `${dept.path} 的 leader ${dept.leader} 不在 people 索引（悬空）`).toBeDefined()
    if (leaderLevel === undefined) continue
    expect(dept.level, `${dept.path}：Dn 必须=负责人 Gn（v2/03 §6.2；NEG-ORG-06 同型）`).toBe(leaderLevel)
    expect(dept.level, `${dept.path}：D9 不启用（G9=公司层）`).toBeLessThanOrEqual(8)
    const minCl = MIN_ESTABLISH_CL[dept.level]
    if (minCl !== undefined) {
      expect(claim, `${dept.path}：D${dept.level} 最低设立层 CL${minCl}（表 E）`).toBeGreaterThanOrEqual(minCl)
    } else {
      expect(dept.level, `${dept.path}：非 D3-D8 时只能是 D1/D2`).toBeLessThanOrEqual(2)
    }
  }
}

/** AssetEntry → assets.yaml 条目原文（SCH-ASSET-01 封闭字段集；可选键缺省不写） */
function manifestEntry(entry: AssetEntry): Record<string, unknown> {
  return {
    assetId: entry.assetId,
    type: entry.type,
    contentDigest: entry.contentDigest,
    provenance: entry.provenance,
    binding: entry.binding,
    ...(entry.targetExecutor !== undefined ? { targetExecutor: entry.targetExecutor } : {}),
    requiredness: entry.requiredness,
    availability: entry.availability,
  }
}

// 纯配置边界的补充形态闸（hygiene.scanSuspiciousText 之外：shell 围栏/宿主命令/家目录/解释器行）
const SHELL_FENCE = /^\s*```(?:bash|sh|zsh|shell|console|powershell)\s*$/m
const HOST_COMMAND = /(?:^|\n)\s*(?:curl|wget|chmod|sudo|git clone|npm (?:install|i)|bun install)\b/
const HOME_PATH = /(?:^|\s)~\/|\/Users\/|\/Volumes\/|\/home\/|file:\/\//

// ───────────────────────── 1. 可装载/可校验 ─────────────────────────

describe('八层级模板可装载/可校验（IMPL-05-04；v2/06 §六）', () => {
  for (const spec of LEVEL_TEMPLATES) {
    it(`${spec.dir}：目录校验全绿且等级回读 CL${spec.level}`, async () => {
      const files = await readTemplate(spec.dir)
      const result = loadCompanyDirectory(files)
      expect(result.ok, result.ok ? '' : JSON.stringify(result.issues.slice(0, 6))).toBe(true)
      if (!result.ok) return
      expect(result.snapshot.level).toBe(spec.level)
      expect(result.snapshot.slug).toBe('example-corp')
      expect(result.snapshot.name).toBe('示例公司')
      expect(result.snapshot.departments.length).toBeGreaterThanOrEqual(1)
      expect(files['charter.md']).toBeDefined() // charter_ref 不悬空（validator 已查，此处锁在位）
      expect(files['prompts/company.md']).toBeDefined() // prompts 定义部人读资产
      expect(files['README.md']).toBeDefined()
    })
  }
})

describe('行业模板可装载/可校验（IMPL-05-05；docs/43-§三）', () => {
  for (const spec of INDUSTRY_TEMPLATES) {
    it(`${spec.dir}：目录校验全绿（同 schema 不同资产）`, async () => {
      const files = await readTemplate(spec.dir)
      const result = loadCompanyDirectory(files)
      expect(result.ok, result.ok ? '' : JSON.stringify(result.issues.slice(0, 6))).toBe(true)
      if (!result.ok) return
      expect(result.snapshot.level).toBe(spec.level)
      expect(files['org-config.yaml']).toContain('schema: org-config/v1')
      expect(files['dependencies.yaml']).toBeDefined()
      expect(files['prompts/company.md']).toBeDefined()
    })
  }
})

// ───────────────────────── 2. 纯配置边界 ─────────────────────────

describe('纯配置边界：无可执行内容/无本机路径/无疑似秘密（NEG-PKG-03/07）', () => {
  it('全模板：无符号链接、无 exec 位；可执行内容恰为 plugins/ 下 2 个 DSH 插件模块', async () => {
    const executable: string[] = []
    for (const spec of ALL_TEMPLATES) {
      for (const entry of await walkTree(templateDir(spec.dir))) {
        const label = `${spec.dir}/${entry.rel}`
        expect(entry.kind, `${label} 是符号链接（v2/06 §4.6 现状口径全拒）`).not.toBe('symlink')
        if (entry.kind !== 'file') continue
        const stat = await lstat(entry.abs)
        expect(stat.mode & 0o111, `${label} 带可执行位（字节惰性面）`).toBe(0)
        const data = await readFile(entry.abs)
        if (isExecutableContent(entry.rel, data)) executable.push(label)
      }
    }
    expect(executable).toEqual([
      'company-game/plugins/dsh-asset-check/src/index.mjs',
      'company-internet/plugins/dsh-web-test/src/index.mjs',
    ])
  })

  it('非 plugins 文件：无 shebang／bash 围栏／宿主命令／本机路径／疑似秘密（只声明「未发现疑似」）', async () => {
    const hits: string[] = []
    for (const spec of ALL_TEMPLATES) {
      for (const entry of await walkTree(templateDir(spec.dir))) {
        if (entry.kind !== 'file') continue
        if (entry.rel.split('/').includes('plugins')) continue // 资产部专属资产位（84 裁决一；代码只允许此处）
        const text = await readFile(entry.abs, 'utf8')
        const label = `${spec.dir}/${entry.rel}`
        for (const hit of scanSuspiciousText(text, label)) hits.push(`${label}:${hit.line}(${hit.kind}/${hit.pattern})`)
        if (SHELL_FENCE.test(text)) hits.push(`${label}:shell-fence`)
        if (HOST_COMMAND.test(text)) hits.push(`${label}:host-command`)
        if (HOME_PATH.test(text)) hits.push(`${label}:local-path`)
        if (/^#!/m.test(text)) hits.push(`${label}:shebang`)
      }
    }
    expect(hits, '模板纯配置边界被破（NEG-PKG-03；扫描只声明未发现疑似，不称绝无秘密——v2/15 §四）').toEqual([])
  })

  it('模板不携带 assets.yaml（现行仓库封闭集未收；过渡索引=registry builtinAssets，迁移归 v2/16）', async () => {
    for (const spec of ALL_TEMPLATES) {
      const files = await readTemplate(spec.dir)
      expect(
        files['assets.yaml'],
        `${spec.dir} 出现 assets.yaml：须先放宽 repo-validate 封闭集（v2/16），否则导入闸会拒收`,
      ).toBeUndefined()
    }
  })
})

// ───────────────────────── 3. B13＋registry 升格登记 ─────────────────────────

describe('B13 plugins 6 件保留＋registry 升格登记（IMPL-05-05；84 裁决一）', () => {
  it('模板 plugins 恰 6 件，且与 builtinAssets 文件清单逐件一致', async () => {
    const pluginFiles: string[] = []
    for (const spec of ALL_TEMPLATES) {
      for (const entry of await walkTree(templateDir(spec.dir))) {
        if (entry.kind === 'file' && entry.rel.split('/').includes('plugins')) pluginFiles.push(`${spec.dir}/${entry.rel}`)
      }
    }
    expect(pluginFiles).toHaveLength(6) // B13 冻结值
    const declared = builtinAssets.flatMap((record) =>
      record.files.map((file) => `${record.template.replace(/^templates\//, '')}/${file}`),
    )
    expect([...pluginFiles].sort()).toEqual([...declared].sort())
  })

  it('2 资产登记：exclusive＋targetExecutor=dsh＋必备/可选性/来源许可/byte 摘要齐全', async () => {
    expect(builtinAssets).toHaveLength(2)
    for (const record of builtinAssets) {
      const entry = record.entry
      expect(entry.type).toBe('plugin')
      expect(entry.binding, '专属标记不得丢失（NEG-REC-11）').toBe('exclusive')
      expect(entry.targetExecutor).toBe('dsh')
      expect(isPluginAssetPosition(entry)).toBe(true)
      expect(assetLocation(entry)).toBe(`plugins/${entry.assetId}`)
      expect(entry.requiredness.required).toBe(true)
      expect(entry.requiredness.impactNote.length).toBeGreaterThan(0)
      expect(entry.availability.need).toBe('needed')
      expect(entry.availability.impact.length).toBeGreaterThan(0)
      expect(entry.provenance.publisher.length).toBeGreaterThan(0)
      expect(entry.provenance.upstreamRef).toBe(`template.${record.template.split('/')[1]}`)
      expect(entry.provenance.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(entry.provenance.license?.licenseId).toBe('mit')
      // 摘要复算：登记≠实物即红（口径同 digestAssetDirectory；模板插件改字节必须同改登记）
      const digest = await digestAssetDirectory(
        path.join(TEMPLATES_ROOT, record.template.replace(/^templates\//, ''), 'plugins', entry.assetId),
      )
      expect(digest.kind).toBe('byte')
      expect(entry.contentDigest.value, `${record.template} 插件字节已变——同改 builtinAssets 摘要`).toBe(digest.value)
    }
  })

  it('REC-ASSET-01 payload：专属标记与传播损失说明不丢（NEG-REC-11）', () => {
    for (const record of builtinAssets) {
      const payload = toAssetRegistrationPayload(record.entry, { refId: 'asset.index.templates', refVersion: '1.0.0' })
      expect(payload).not.toBeNull()
      if (payload === null) continue
      expect(payload.exclusivity.marker).toBe('exclusive')
      expect(payload.exclusivity.target_executor).toBe('dsh')
      expect(payload.compatibility).toEqual(['executor:dsh'])
      expect(payload.propagation.semantics).toContain('传播≠授权')
      expect(payload.propagation.notes.join('')).toContain('专属资产')
      expect(payload.provenance.digest).toBe(record.entry.contentDigest.value)
      expect(payload.provenance.license).toBe('mit')
    }
  })

  it('登记条目可被 SCH-ASSET-01 解析器原样装载（数据面不是自造字段；无 W-SCH-002）', () => {
    const parsed = parseAssetManifest(
      stringifyYaml({ schema: 'studio-next/assets@1', assets: builtinAssets.map((record) => manifestEntry(record.entry)) }),
    )
    expect(parsed.warnings).toEqual([])
    expect(parsed.entries.map((entry) => entry.assetId).sort()).toEqual(
      builtinAssets.map((record) => record.entry.assetId).sort(),
    )
    for (const [index, entry] of parsed.entries.entries()) {
      expect(entry).toEqual(builtinAssets[index]?.entry)
    }
  })
})

// ───────────────────────── 4. 传播语义 ─────────────────────────

describe('资产传播语义（v2/06 §3.4；NEG-REC-11）', () => {
  it('有 dsh→loaded；缺 dsh→必备不可用默认拒绝装载；降级须具名且专属标记逐项保留', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'studio-next-mig05-tpl-'))
    try {
      for (const record of builtinAssets) {
        const from = path.join(
          TEMPLATES_ROOT,
          record.template.replace(/^templates\//, ''),
          'plugins',
          record.entry.assetId,
        )
        await cp(from, path.join(root, 'plugins', record.entry.assetId), { recursive: true })
      }
      await writeFile(
        path.join(root, 'assets.yaml'),
        stringifyYaml({ schema: 'studio-next/assets@1', assets: builtinAssets.map((record) => manifestEntry(record.entry)) }),
        'utf8',
      )

      const loaded = await loadCompanyAssets({ companyDir: root, availableExecutors: ['dsh'] })
      expect(loaded.manifestPresent).toBe(true)
      expect(loaded.items).toHaveLength(2)
      expect(loaded.items.every((item) => item.state === 'loaded')).toBe(true)
      expect(loaded.required.outcome).toBe('none')
      expect(loaded.scan.suspects).toBe(0) // 只声明「未发现疑似」

      const refused = await captureError(() => loadCompanyAssets({ companyDir: root, availableExecutors: [] }))
      expect(refused.subcause).toBe('assets/required-unavailable') // 不得静默忽略（v2/06 §3.4）

      const degraded = await loadCompanyAssets({
        companyDir: root,
        availableExecutors: [],
        requiredAssetPolicy: 'degrade',
        decision: { actor: '测试部署者', note: '缺 dsh：具名选择降级装载并明示代价' },
      })
      expect(degraded.required.outcome).toBe('degraded')
      expect(degraded.required.unavailable).toHaveLength(2)
      for (const item of degraded.items) {
        expect(item.state).toBe('incompatible')
        expect(item.binding).toBe('exclusive')
        expect(item.targetExecutor).toBe('dsh')
        expect(item.reason).toContain('dsh')
        expect(item.installAuthorization).toBe('required') // 装载≠授权（v2/06 §3.5）
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

// ───────────────────────── 5. DEC-OPEN-16 缺口 ─────────────────────────

describe('DEC-OPEN-16 缺口登记（未裁：模板不写解散/清算条款）', () => {
  it('每模板 org-config 登记缺口；其余文件无解散/清算条款（不预设裁决结果）', async () => {
    for (const spec of ALL_TEMPLATES) {
      const files = await readTemplate(spec.dir)
      expect(files['org-config.yaml'] ?? '').toContain('DEC-OPEN-16')
      for (const [rel, content] of Object.entries(files)) {
        if (rel === 'org-config.yaml') continue // 缺口登记本行（含「解散/清算」字样）
        if (rel.split('/').includes('plugins')) continue
        const wrote = content.includes('解散') || content.includes('清算')
        expect(wrote, `${spec.dir}/${rel} 写了未裁条款（DEC-OPEN-16 软阻断：未裁不写）`).toBe(false)
      }
    }
  })
})

// ───────────────────────── 6. CL／部门结构／N 参数 ─────────────────────────

describe('CL 与部门结构符合 v2/03（表 A/表 E；NEG-PKG-08/NEG-ORG-06/NEG-PKG-07）', () => {
  for (const spec of LEVEL_TEMPLATES) {
    it(`${spec.dir}：CL${spec.level} 主张由拟任结构支撑；模板自身不冒充设立`, async () => {
      const files = await readTemplate(spec.dir)
      const src = files['org-config.yaml'] ?? ''
      const org = parseOrg(src)
      expect(org.company.level).toBe(spec.level)
      const facts = structureFacts(org)

      // 模板不冒充设立（NEG-PKG-07）：无设立记录/root_delegation ⇒ 结构可判上限 CL1，「初始化≠已设立」
      const unestablished = judgeLevelClaim(org.company.level, facts)
      expect(unestablished.computedMax).toBe(1)
      expect(unestablished.ok).toBe(false)

      // 拟任结构面：设立记录到位时结构支持主张；超出结构＝虚记层级（v2/03 §2.4）
      const verified = judgeLevelClaim(org.company.level, { ...facts, established: true, rootDelegation: true })
      expect(verified.ok, verified.reason).toBe(true)
      expect(verified.computedMax).toBeGreaterThanOrEqual(spec.level)

      assertTableAMinimums(org, spec.level)
      assertDeptLevels(org, spec.level)
      // CL4 起部门审计制度（周期记录）必设：模板须声明并由 audit-cycle 周期岗承载
      if (spec.level >= 4) {
        expect(src).toContain('部门审计制度')
        expect(files['org-config.yaml']).toMatch(/id: audit-cycle-/)
      }
      // 拟任≠事实：org-config 必须显式声明（v2/06 §5.1）
      expect(src).toContain('拟任')
      expect(src).toContain('root_delegation')
    })
  }

  it('行业模板同口径：结构支撑 CL 主张，最高宰相 G9 拟任在位', async () => {
    for (const spec of INDUSTRY_TEMPLATES) {
      const org = parseOrg((await readTemplate(spec.dir))['org-config.yaml'] ?? '')
      const facts = structureFacts(org)
      expect(judgeLevelClaim(org.company.level, { ...facts, established: true, rootDelegation: true }).ok).toBe(true)
      expect(facts.bossCovered, `${spec.dir} 缺最高宰相 G9 拟任`).toBe(true)
      assertDeptLevels(org, org.company.level)
    }
  })
})

describe('N 一级单元参数不写死（GAP-V2-17 记录面方案；默认 1）', () => {
  for (const spec of ALL_TEMPLATES) {
    it(`${spec.dir}：N 声明=示例 ${spec.nExample}（默认 1）且不新增 SCH-ORG-01 字段`, async () => {
      const src = (await readTemplate(spec.dir))['org-config.yaml'] ?? ''
      expect(src).toContain('一级单元 N（GAP-V2-17')
      expect(src).toContain('默认 1')
      expect(src).toContain('示例不是规范')
      const matched = /^# 本模板结构示例 N（示例）= (\d+)/m.exec(src)
      expect(matched, '缺 N 参数声明行（一级单元数量由设立记录确认，不写死）').not.toBeNull()
      expect(Number(matched === null ? Number.NaN : matched[1])).toBe(spec.nExample)
      expect(spec.nExample).toBeGreaterThanOrEqual(1)
      // 本轮不新增字段（v2/10 §4.3）：units/unitCount 不得出现在 org-config 顶层
      const org = parseOrg(src)
      expect(Object.keys(org)).not.toContain('units')
      expect(Object.keys(org)).not.toContain('unitCount')
    })
  }

  it('N 不写死 3：默认形态（N=1）存在于低层模板；N=3 只作 8/9 层示例', () => {
    expect(LEVEL_TEMPLATES.some((tpl) => tpl.nExample === 1)).toBe(true)
    expect(LEVEL_TEMPLATES.some((tpl) => tpl.nExample !== 1)).toBe(true)
    expect(LEVEL_TEMPLATES.filter((tpl) => tpl.nExample === 3).map((tpl) => tpl.dir)).toEqual([
      'company-8-level',
      'company-9-level',
    ])
  })
})

// ───────────────────────── 7. 迁移期绑定标识与挂载戳记 ─────────────────────────

describe('迁移期绑定标识与挂载戳记拆分（v2/10 §3.3/§4.7；v2/06 §4.4）', () => {
  it('每模板 .studio-next.yaml 与 org-config schema 同源；戳记四字段可剥离，定义段只含 schema/template', async () => {
    for (const spec of ALL_TEMPLATES) {
      const files = await readTemplate(spec.dir)
      const meta = files['.studio-next.yaml'] ?? ''
      const split = splitStudioNextYaml(meta)
      expect(split.stripped.sort()).toEqual(['created_at', 'framework_version', 'last_validated_at', 'last_validation'])
      expect(split.unknownKeys).toEqual([])
      expect(Object.keys(split.definition).sort()).toEqual(['schema', 'template'])
      expect(split.definition['template']).toBe(spec.dir)
      const orgRaw: unknown = parseYaml(files['org-config.yaml'] ?? '')
      const orgSchema = typeof orgRaw === 'object' && orgRaw !== null ? (orgRaw as { schema?: unknown }).schema : undefined
      expect(split.definition['schema']).toBe(orgSchema)
    }
  })
})
