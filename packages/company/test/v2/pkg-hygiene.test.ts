/**
 * pkg-hygiene —— 依赖解析／挂载戳记／CL 结构判据／模板资产计数 V2 测试（IMPL-05-02）
 *
 * 覆盖（冻结验收口径）：
 *   - 依赖声明解析（v1 dependencies.yaml strictObject）与版本并集（多约束求交，绝不隐式选「最新」）；
 *   - 绑定求值（属性命中 → 候选；并集输入）与必备资产判定（judgeRequiredAssets 二选一）；
 *   - NEG-PKG-06 挂载戳记/信任态剥离（纯面：四类戳记剥离、unknown 键暴露给导入器拒收）；
 *   - NEG-PKG-08 CL 结构判据（「只改 level 字段」无效；结构事实为准，未核验不得宣称升层）；
 *   - NEG-PKG-01 part 类型闭包（未知/unknown part 类型逐条指名拒收）；
 *   - B13 模板 DSH 插件不迁出：`find templates -path '*plugins*' -type f` 计数＝6（只断言，不改 templates）。
 *
 * 依据：v2/06 §四.1（目录契约）、§4.4（戳记拆分）、§九；v2/10 §4.2/§4.7；v2/03 §2.4；
 *       v2/15 §四；84-D1（plugins 6 件保留）；plan/04 MIG-05 出口③；plan/05 IMPL-05-02。
 */
import path from 'node:path'
import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  computedMaxLevel,
  judgeLevelClaim,
  parseDefinitionManifest,
  splitStudioNextYaml,
  serializeStudioNextDefinition,
  MOUNT_STAMP_KEYS,
  type OrgStructureFacts,
} from '../../src/assets/index.ts'
import {
  parseDependencies,
  resolveVersionUnion,
  judgeRequiredAssets,
  demandedPlugins,
  enabledPluginsFor,
  satisfiesSpec,
  parseVersionSpec,
  type PersonAttrs,
} from '../../src/dependencies.ts'
import { captureError, studioNextYaml } from './assets-fixtures.ts'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

const DEPS_OK = `schema: studio-next/dependencies@1
bindings:
  - when: {attr: role, is: 工程负责人}
    plugins:
      - {name: dsh-web-test, version: "^1.2"}
  - when: {attr: dept, is: 工程部}
    plugins:
      - {name: dsh-web-test, version: "1.2.0"}
`

const PERSON: PersonAttrs = { id: 'AGENT-1', dept: 'departments/工程部', level: 2, role: '工程负责人' }

/** CL2 最低合法结构（设立＋root_delegation＋最高宰相在编/缺位登记） */
const CL2_FACTS: OrgStructureFacts = {
  established: true,
  rootDelegation: true,
  bossCovered: true,
  inPositionLevels: [],
  deptCount: 0,
  maxDeptDepth: 1,
  auditPosition: false,
}

describe('依赖声明解析与版本并集（v2/06 §3.5 候选生成器；51-D-1/D-2）', () => {
  it('dependencies.yaml strictObject：合法解析、未知键拒、通配版本拒', async () => {
    const deps = parseDependencies(DEPS_OK)
    expect(deps.bindings).toHaveLength(2)

    const unknownKey = await captureError(() => parseDependencies(`${DEPS_OK}extra: true\n`))
    expect(unknownKey.subcause).toBe('deps/invalid')

    const wildcard = await captureError(() =>
      parseDependencies('schema: studio-next/dependencies@1\nbindings:\n  - when: {attr: role, is: x}\n    plugins:\n      - {name: p, version: "~1.2"}\n'),
    )
    expect(wildcard.subcause).toBe('deps/invalid')
  })

  it('绑定求值：同人命中两条绑定 → demandedPlugins 保留全部约束（并集输入）', () => {
    const deps = parseDependencies(DEPS_OK)
    expect(enabledPluginsFor(PERSON, deps).map((ref) => ref.version)).toEqual(['^1.2'])
    const demanded = demandedPlugins(deps, [PERSON])
    expect(demanded.get('dsh-web-test')).toEqual(['^1.2', '1.2.0'])
  })

  it('版本并集：候选须满足全部约束；无解=conflict 如实上报（不装错版本）', () => {
    const exact = resolveVersionUnion(['^1.2', '1.2.0'], ['1.1.0', '1.2.0', '1.2.5'])
    expect(exact.ok).toBe(true)
    expect(exact.satisfying).toEqual(['1.2.0'])

    const range = resolveVersionUnion(['^1.2', '^1.2.0'], ['1.1.0', '1.2.0', '1.2.5'])
    expect(range.ok).toBe(true)
    expect(range.satisfying).toEqual(['1.2.0', '1.2.5'])

    const conflict = resolveVersionUnion(['^1.2', '2.0.0'], ['1.2.0', '2.0.0'])
    expect(conflict.ok).toBe(false)
    expect(conflict.satisfying).toEqual([])
    expect(conflict.conflict).toContain('无候选满足全部约束')

    const badForm = resolveVersionUnion(['~1.2'], ['1.2.0'])
    expect(badForm.ok).toBe(false)
    expect(badForm.conflict).toContain('形态不支持')
    expect(parseVersionSpec('~1.2')).toBeNull()
    expect(parseVersionSpec('^1.2')).not.toBeNull()
    expect(satisfiesSpec(parseVersionSpec('^0.4')!, '0.4.9')).toBe(true)
    expect(satisfiesSpec(parseVersionSpec('^0.4')!, '0.5.0')).toBe(false)
  })
})

describe('必备资产判定（v2/06 §3.4：拒绝或明示降级二选一）', () => {
  const unavailable = [{ assetId: 'dsh-web-test', state: 'incompatible' as const, reason: '缺执行器 dsh' }]

  it('无不可用 → outcome=none（不因策略字段虚构处置）', () => {
    expect(judgeRequiredAssets([], { policy: 'degrade' })).toEqual({ policy: 'degrade', outcome: 'none', unavailable: [] })
  })

  it('缺省拒绝（fail-closed）：outcome=refused 且逐项带不可用原因', () => {
    const verdict = judgeRequiredAssets(unavailable)
    expect(verdict.policy).toBe('refuse')
    expect(verdict.outcome).toBe('refused')
    expect(verdict.unavailable).toEqual(unavailable)
  })

  it('降级无具名留痕 → 拒（assets/degrade-decision-required）；有则 degraded', async () => {
    const silent = await captureError(() => judgeRequiredAssets(unavailable, { policy: 'degrade' }))
    expect(silent.subcause).toBe('assets/degrade-decision-required')

    const verdict = judgeRequiredAssets(unavailable, {
      policy: 'degrade',
      decision: { actor: '制作人', note: '接受缺插件运行并登记损失面' },
    })
    expect(verdict.outcome).toBe('degraded')
    expect(verdict.decision?.actor).toBe('制作人')
  })
})

describe('NEG-PKG-08 CL 结构判据（v2/03 §2.4：只改 level 字段无效）', () => {
  it('CL2 结构＋主张 CL6 → 拒，理由指名结构上限', () => {
    expect(computedMaxLevel(CL2_FACTS)).toBe(2)
    const verdict = judgeLevelClaim(6, CL2_FACTS)
    expect(verdict.ok).toBe(false)
    expect(verdict.verified).toBe(true)
    expect(verdict.computedMax).toBe(2)
    expect(verdict.reason).toContain('只改 level 字段')
  })

  it('主张与结构一致 → 放行；结构全链才到 CL9', () => {
    const full: OrgStructureFacts = {
      established: true,
      rootDelegation: true,
      bossCovered: true,
      inPositionLevels: [2, 3, 4, 5, 6, 7, 8],
      deptCount: 3,
      maxDeptDepth: 3,
      auditPosition: true,
    }
    expect(computedMaxLevel(full)).toBe(9)
    expect(judgeLevelClaim(9, full)).toMatchObject({ ok: true, verified: true, computedMax: 9 })
    expect(judgeLevelClaim(2, CL2_FACTS)).toMatchObject({ ok: true, verified: true, computedMax: 2 })
  })

  it('无结构事实 → 未核验（不得据此宣称已升层，也不得由默认值判通过）', () => {
    const verdict = judgeLevelClaim(7)
    expect(verdict.verified).toBe(false)
    expect(verdict.ok).toBe(true)
    expect(verdict.reason).toContain('未核验')
  })
})

describe('NEG-PKG-06 挂载戳记/信任态剥离（v2/06 §4.4；v2/10 §4.7）', () => {
  it('四类戳记剥离、定义段保留（schema/template → 随公开定义传播）', () => {
    const split = splitStudioNextYaml(studioNextYaml(true))
    expect(split.stripped).toEqual([...MOUNT_STAMP_KEYS])
    expect(split.definition).toEqual({ schema: 'studio-next/org@1', template: 'company-2-level' })
    const serialized = serializeStudioNextDefinition(split.definition) ?? ''
    for (const key of MOUNT_STAMP_KEYS) expect(serialized).not.toContain(key)
    expect(serialized).toContain('studio-next/org@1')
  })

  it('只有戳记（无定义段）→ serialize=null（不写空壳文件）', () => {
    const split = splitStudioNextYaml(studioNextYaml(true).split('\n').filter((line) => !line.startsWith('schema:') && !line.startsWith('template:')).join('\n'))
    expect(split.definition).toEqual({})
    expect(serializeStudioNextDefinition(split.definition)).toBeNull()
  })

  it('戳记之外的未知键暴露给导入器拒收（trust 不得随包传播）', () => {
    const split = splitStudioNextYaml('schema: studio-next/org@1\ntrust: true\n')
    expect(split.unknownKeys).toContain('trust')
  })
})

describe('NEG-PKG-01 part 类型闭包（v2/10 §4.2；unknown 一律拒收）', () => {
  it('合法 part 索引可解析', () => {
    const manifest = parseDefinitionManifest(
      'schema: studio-next/pkg-def@1\nartifactId: company.demo\nartifactVersion: 1.0.0\nspecVersion: 2.0.0\nparts:\n  - {partId: definition.main, partType: definition}\n  - {partId: assets.main, partType: asset}\n',
    )
    expect(manifest.parts.map((part) => part.partType)).toEqual(['definition', 'asset'])
  })

  it('未知 part 类型/unknown → 逐条指名拒收；未知主版本拒收', async () => {
    const unknown = await captureError(() =>
      parseDefinitionManifest(
        'schema: studio-next/pkg-def@1\nartifactId: company.demo\nartifactVersion: 1.0.0\nspecVersion: 2.0.0\nparts:\n  - {partId: p.one, partType: worm}\n  - {partId: p.two, partType: unknown}\n',
      ),
    )
    expect(unknown.subcause).toBe('defpkg/unknown-part')
    expect(unknown.message).toContain('worm')
    expect(unknown.message).toContain('unknown')

    const version = await captureError(() =>
      parseDefinitionManifest(
        'schema: studio-next/pkg-def@1\nartifactId: company.demo\nartifactVersion: 1.0.0\nspecVersion: 3.0.0\nparts:\n  - {partId: p.one, partType: definition}\n',
      ),
    )
    expect(version.subcause).toBe('defpkg/spec-version')
  })
})

describe('B13 模板 DSH 插件不迁出（84 裁决一；只断言，不改 templates）', () => {
  async function walk(rel: string, out: string[] = []): Promise<string[]> {
    const abs = path.join(REPO_ROOT, rel)
    for (const entry of await readdir(abs, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const child = `${rel}/${entry.name}`
      if (entry.isDirectory()) await walk(child, out)
      else if (entry.isFile()) out.push(child)
    }
    return out.sort()
  }

  it('find templates -path "*plugins*" -type f | wc -l = 6（设备：只读遍历）', async () => {
    const templateFiles = await walk('templates')
    const pluginFiles = templateFiles.filter((rel) => rel.split('/').includes('plugins'))
    expect(pluginFiles).toHaveLength(6)
    expect(pluginFiles).toEqual([
      'templates/company-game/plugins/dsh-asset-check/cordis.patch.yml',
      'templates/company-game/plugins/dsh-asset-check/package.json',
      'templates/company-game/plugins/dsh-asset-check/src/index.mjs',
      'templates/company-internet/plugins/dsh-web-test/cordis.patch.yml',
      'templates/company-internet/plugins/dsh-web-test/package.json',
      'templates/company-internet/plugins/dsh-web-test/src/index.mjs',
    ])
  })
})
