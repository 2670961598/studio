/**
 * defpkg-import —— PKG-DEF 定义包导入 V2 测试（IMPL-05-02）
 *
 * 覆盖（冻结验收口径）：
 *   - 正例：先校验后落位；落位文件齐、资产报告 loaded、资产安装授权仍 required（传播≠授权）；
 *   - 导入失败零落位（暂存目录清理、目标目录不动——「不留半包」）；
 *   - NEG-PKG-01 未知 part 类型拒收并指名；
 *   - NEG-PKG-02 身份/状态主张从属（自授/信任态拒；普通主张非权威、不得激活，冲突以记录为准）；
 *   - NEG-PKG-03 秘密/本机路径拒收（不回显值）；
 *   - NEG-PKG-04 导入面必备不可用（缺省拒绝；具名降级可装但逐项明示不可用）；
 *   - NEG-PKG-05 资产执行边界（代码只允许 plugins/ 下 DSH 插件；绝不执行包内文件）；
 *   - NEG-PKG-06 挂载戳记剥离（导入产物无 created_at/last_validated_at/last_validation/framework_version）；
 *   - NEG-PKG-08 CL 结构判据（主张超出结构上限即拒）；
 *   - NEG-PKG-09 定义部装不动即拒收，且不得「降级装资产凑合」（资产零落位）。
 *
 * 依据：v2/06 §3.4/§4.1/§4.4/§4.5/§4.7/§九；v2/10 §4.7/§4.8；v2/03 §2.4；v2/15 §四；
 *       plan/03 MIG-05 回滚列；plan/05 IMPL-05-02。夹具全落 tmp，不写仓内文件。
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, symlink } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  importDefinitionPackage,
  type OrgStructureFacts,
} from '../../src/assets/index.ts'
import {
  captureError,
  makeTempRoot,
  orgConfigFiles,
  packageManifest,
  pluginTree,
  studioNextYaml,
  writeAssetsManifest,
  writeTree,
} from './assets-fixtures.ts'

let root = ''

beforeAll(async () => {
  root = await makeTempRoot('defpkg')
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** CL2 最低合法结构（与 pkg-hygiene 同口径；结构事实由记录/投影面注入） */
const CL2_FACTS: OrgStructureFacts = {
  established: true,
  rootDelegation: true,
  bossCovered: true,
  inPositionLevels: [],
  deptCount: 0,
  maxDeptDepth: 1,
  auditPosition: false,
}

function pluginAt(name = 'dsh-web-test', version = '1.0.0', extra: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(pluginTree(name, version, extra)).map(([rel, data]) => [`plugins/${name}/${rel}`, data]),
  )
}

function baseFiles(
  opts: { level?: number; orgExtra?: Record<string, unknown>; studioNext?: string | null; files?: Record<string, string | Buffer> } = {},
): Record<string, string | Buffer> {
  return {
    'package.yaml': packageManifest(),
    ...orgConfigFiles(opts.level ?? 2, opts.orgExtra ?? {}),
    ...(opts.studioNext === null ? {} : { '.studio-next.yaml': opts.studioNext ?? studioNextYaml(true) }),
    ...(opts.files ?? {}),
  }
}

async function makePkg(name: string, files: Record<string, string | Buffer>): Promise<string> {
  const dir = path.join(root, name)
  await mkdir(dir, { recursive: true })
  await writeTree(dir, files)
  return dir
}

/** 失败面共同断言：目标不存在，父目录无暂存残留（「导入失败不留半包」） */
async function expectZeroPlacement(target: string): Promise<void> {
  expect(existsSync(target)).toBe(false)
  const siblings = await readdir(path.dirname(target))
  expect(siblings.filter((entry) => entry.startsWith('.defpkg-staging-'))).toEqual([])
}

describe('PKG-DEF 导入正例（先校验后落位）', () => {
  it('定义部＋资产部整包导入：文件齐、资产 loaded、安装授权仍需（传播≠授权）', async () => {
    const src = await makePkg('ok-src', {
      ...baseFiles({ files: { 'departments/工程部/people/AGENT-1.md': '# 人员档案\n' } }),
      ...pluginAt(),
    })
    await writeAssetsManifest(src, [
      { assetId: 'dsh-web-test', type: 'plugin', rel: 'plugins/dsh-web-test', binding: 'exclusive', targetExecutor: 'dsh', required: true, version: '1.0.0' },
    ])
    const target = path.join(root, 'ok-target')
    const report = await importDefinitionPackage({
      sourceDir: src,
      targetDir: target,
      availableExecutors: ['dsh'],
      structureFacts: CL2_FACTS,
    })

    expect(report.artifactId).toBe('company.asset-demo')
    expect(report.artifactVersion).toBe('1.0.0')
    expect(report.parts.map((part) => part.partType)).toEqual(['definition'])
    expect(report.files).toContain('org-config.yaml')
    expect(report.files).toContain('package.yaml')
    expect(report.files).toContain('plugins/dsh-web-test/src/index.mjs')
    expect(report.assets.items.map((item) => [item.assetId, item.state])).toEqual([['dsh-web-test', 'loaded']])
    expect(report.installAuthorization).toBe('required')
    expect(report.staged).toBe(false)
    expect(report.scanNote).toContain('不证明绝无秘密')
    expect(report.levelClaim).toMatchObject({ claimed: 2, computedMax: 2, verified: true, ok: true })

    expect(existsSync(path.join(target, 'org-config.yaml'))).toBe(true)
    expect(existsSync(path.join(target, 'plugins/dsh-web-test/src/index.mjs'))).toBe(true)
    // 自动落位≠自动安装：导入不写插件登记/安装日志（安装授权走 v2/07 能力链）
    expect(existsSync(path.join(target, 'registry.json'))).toBe(false)
    expect(existsSync(path.join(target, 'install-log.jsonl'))).toBe(false)
    // 不落位到可执行位置：插件代码文件带 0644（无执行位）
    const pluginMode = (await stat(path.join(target, 'plugins/dsh-web-test/src/index.mjs'))).mode
    expect(pluginMode & 0o111).toBe(0)
    // 源包仍在（导入是复制语义，不改来源）
    expect(existsSync(path.join(src, 'org-config.yaml'))).toBe(true)
  })
})

describe('导入失败零落位（v2/16 §五「失败不留半包」）', () => {
  it('资产摘要不符 → 整包拒收；目标零落位、无暂存残留', async () => {
    const src = await makePkg('bad-digest', {
      ...baseFiles(),
      'assets/skill-x/SKILL.md': '# x\n',
    })
    await writeAssetsManifest(src, [
      { assetId: 'skill-x', type: 'skill', rel: 'assets/skill-x', binding: 'generic', digestOverride: 'a'.repeat(64) },
    ])
    const target = path.join(root, 'bad-digest-target')
    const error = await captureError(() => importDefinitionPackage({ sourceDir: src, targetDir: target }))
    expect(error.subcause).toBe('defpkg/assets-invalid')
    expect(error.message).toContain('skill-x')
    await expectZeroPlacement(target)
  })

  it('目标已存在 → 拒绝覆盖（不合并旧包）；既有内容不动', async () => {
    const src = await makePkg('existing-src', baseFiles())
    const target = path.join(root, 'existing-target')
    await mkdir(target, { recursive: true })
    await writeTree(target, { 'keep.txt': 'keep\n' })
    const error = await captureError(() => importDefinitionPackage({ sourceDir: src, targetDir: target }))
    expect(error.subcause).toBe('defpkg/target-exists')
    expect(await readFile(path.join(target, 'keep.txt'), 'utf8')).toBe('keep\n')
  })

  it('缺 package.yaml → 拒收（part 语义不得由默认值虚构完整）', async () => {
    const src = await makePkg('no-manifest', { 'org-config.yaml': orgConfigFiles(2)['org-config.yaml'] ?? '' })
    const target = path.join(root, 'no-manifest-target')
    const error = await captureError(() => importDefinitionPackage({ sourceDir: src, targetDir: target }))
    expect(error.subcause).toBe('defpkg/manifest-missing')
    await expectZeroPlacement(target)
  })
})

describe('NEG-PKG-09 定义部可装性（装不动即拒收，不得降级装资产凑合）', () => {
  it('dependencies.yaml 不合法 → 整包拒收，插件资产零落位', async () => {
    const src = await makePkg('bad-deps', {
      ...baseFiles({ files: { 'dependencies.yaml': 'schema: studio-next/dependencies@1\nbindings: 3\n' } }),
      ...pluginAt(),
    })
    await writeAssetsManifest(src, [
      { assetId: 'dsh-web-test', type: 'plugin', rel: 'plugins/dsh-web-test', binding: 'exclusive', targetExecutor: 'dsh' },
    ])
    const target = path.join(root, 'bad-deps-target')
    const error = await captureError(() =>
      importDefinitionPackage({ sourceDir: src, targetDir: target, availableExecutors: ['dsh'] }),
    )
    expect(error.subcause).toBe('defpkg/definition-uninstallable')
    await expectZeroPlacement(target)
  })

  it('缺 org-config.yaml → 定义部装不动，拒收并指名', async () => {
    const src = await makePkg('no-org', { 'package.yaml': packageManifest() })
    const target = path.join(root, 'no-org-target')
    const error = await captureError(() => importDefinitionPackage({ sourceDir: src, targetDir: target }))
    expect(error.subcause).toBe('defpkg/definition-uninstallable')
    expect(error.message).toContain('org-config.yaml')
    await expectZeroPlacement(target)
  })
})

describe('NEG-PKG-06 挂载戳记剥离（传播前剥离——v2/06 §4.4）', () => {
  it('导入成功：报告列四类戳记；目标 .studio-next.yaml 只剩定义段', async () => {
    const src = await makePkg('stamps', baseFiles())
    const target = path.join(root, 'stamps-target')
    const report = await importDefinitionPackage({ sourceDir: src, targetDir: target })
    expect(report.strippedStamps).toEqual(['created_at', 'last_validated_at', 'last_validation', 'framework_version'])

    const raw = await readFile(path.join(target, '.studio-next.yaml'), 'utf8')
    const parsed = parseYaml(raw) as Record<string, unknown>
    expect(parsed).toEqual({ schema: 'studio-next/org@1', template: 'company-2-level' })
    for (const key of report.strippedStamps) expect(raw).not.toContain(key)
  })

  it('戳记之外的未知键 → 拒收（trust 不得随包传播）', async () => {
    const src = await makePkg('stamp-unknown', baseFiles({ studioNext: 'schema: studio-next/org@1\ntrust: true\n' }))
    const target = path.join(root, 'stamp-unknown-target')
    const error = await captureError(() => importDefinitionPackage({ sourceDir: src, targetDir: target }))
    expect(error.subcause).toBe('defpkg/stamp-unknown-key')
    expect(error.message).toContain('trust')
    await expectZeroPlacement(target)
  })
})

describe('NEG-PKG-02 身份/状态主张从属（记录为准，不得激活）', () => {
  it('包内主张与记录冲突：导入保留主张但非权威、未激活、冲突明示', async () => {
    const src = await makePkg(
      'identity-claim',
      baseFiles({ orgExtra: { identity: { displayName: '主张公司', claimedIdentityState: 'active' } } }),
    )
    const target = path.join(root, 'identity-claim-target')
    const report = await importDefinitionPackage({
      sourceDir: src,
      targetDir: target,
      identityRecordState: 'suspended',
    })
    expect(report.identityClaim).toMatchObject({
      present: true,
      claimedState: 'active',
      authoritative: false,
      activation: 'none',
      conflict: true,
    })
    expect(report.identityClaim.note).toContain('以记录为准')
  })

  it('自授/信任态字段与文本 → 拒收（信任决定不随包）', async () => {
    const field = await makePkg('trust-field', baseFiles({ orgExtra: { trust: true } }))
    const first = await captureError(() =>
      importDefinitionPackage({ sourceDir: field, targetDir: path.join(root, 'trust-field-target') }),
    )
    expect(first.subcause).toBe('defpkg/trust-claim')

    const text = await makePkg('trust-text', baseFiles({ files: { 'README.md': '# 说明\n本目录即权威\n' } }))
    const second = await captureError(() =>
      importDefinitionPackage({ sourceDir: text, targetDir: path.join(root, 'trust-text-target') }),
    )
    expect(second.subcause).toBe('defpkg/trust-claim')
    await expectZeroPlacement(path.join(root, 'trust-text-target'))
  })
})

describe('NEG-PKG-08 CL 结构判据（主张须由结构背书）', () => {
  it('主张 CL6 而结构只到 CL2 → 拒收（只改 level 字段无效）', async () => {
    const src = await makePkg('level-inflated', baseFiles({ level: 6 }))
    const target = path.join(root, 'level-inflated-target')
    const error = await captureError(() =>
      importDefinitionPackage({ sourceDir: src, targetDir: target, structureFacts: CL2_FACTS }),
    )
    expect(error.subcause).toBe('defpkg/level-claim')
    expect(error.message).toContain('只改 level 字段')
    await expectZeroPlacement(target)
  })

  it('无结构事实 → 未核验（不冒充已核验通过）', async () => {
    const src = await makePkg('level-unverified', baseFiles({ level: 6 }))
    const target = path.join(root, 'level-unverified-target')
    const report = await importDefinitionPackage({ sourceDir: src, targetDir: target })
    expect(report.levelClaim).toMatchObject({ claimed: 6, verified: false, ok: true })
    expect(report.levelClaim.reason).toContain('未核验')
  })
})

describe('NEG-PKG-01 part 类型封闭（逐条指名拒收）', () => {
  it('未知 part 类型 → 拒收并指名；目标零落位', async () => {
    const src = await makePkg('unknown-part', {
      'package.yaml': packageManifest([
        { partId: 'definition.main', partType: 'definition' },
        { partId: 'evil.part', partType: 'worm' },
      ]),
      ...orgConfigFiles(2),
    })
    const target = path.join(root, 'unknown-part-target')
    const error = await captureError(() => importDefinitionPackage({ sourceDir: src, targetDir: target }))
    expect(error.subcause).toBe('defpkg/unknown-part')
    expect(error.message).toContain('worm')
    await expectZeroPlacement(target)
  })
})

describe('NEG-PKG-05 资产执行边界（代码只允许 plugins/ 下 DSH 插件）', () => {
  it('定义部出现可执行内容 → 拒收（prompts/*.sh 亦不例外）', async () => {
    const src = await makePkg('exec-in-def', baseFiles({ files: { 'prompts/run.sh': '#!/bin/sh\necho hi\n' } }))
    const target = path.join(root, 'exec-in-def-target')
    const error = await captureError(() => importDefinitionPackage({ sourceDir: src, targetDir: target }))
    expect(error.subcause).toBe('defpkg/executable-outside-plugins')
    expect(error.message).toContain('prompts/run.sh')
    await expectZeroPlacement(target)
  })

  it('无扩展名的二进制可执行（ELF 魔数）→ 拒收（不以「看起来是文档」放行）', async () => {
    const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00, 0x00, 0x00])
    const src = await makePkg('exec-magic', baseFiles({ files: { 'docs/payload': elf } }))
    const target = path.join(root, 'exec-magic-target')
    const error = await captureError(() => importDefinitionPackage({ sourceDir: src, targetDir: target }))
    expect(error.subcause).toBe('defpkg/executable-outside-plugins')
    expect(error.message).toContain('docs/payload')
    await expectZeroPlacement(target)
  })

  it('包管理生命周期脚本 → 拒收（解包不得触发安装脚本）', async () => {
    const risky = { ...pluginTree('dsh-risky', '1.0.0'), 'package.json': `${JSON.stringify({ name: 'dsh-risky', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } }, scripts: { postinstall: 'node src/index.mjs' } })}\n` }
    const src = await makePkg('lifecycle', {
      ...baseFiles(),
      ...Object.fromEntries(Object.entries(risky).map(([rel, data]) => [`plugins/dsh-risky/${rel}`, data])),
    })
    await writeAssetsManifest(src, [
      { assetId: 'dsh-risky', type: 'plugin', rel: 'plugins/dsh-risky', binding: 'exclusive', targetExecutor: 'dsh' },
    ])
    const target = path.join(root, 'lifecycle-target')
    const error = await captureError(() =>
      importDefinitionPackage({ sourceDir: src, targetDir: target, availableExecutors: ['dsh'] }),
    )
    expect(error.subcause).toBe('defpkg/lifecycle-script')
    await expectZeroPlacement(target)
  })

  it('插件内代码合法落位但绝不执行（顶层抛错也不影响导入）', async () => {
    const src = await makePkg('no-execute', {
      ...baseFiles(),
      ...pluginAt('dsh-side-effect', '1.0.0', {
        'src/index.mjs': "export const name = 'dsh-side-effect'\nthrow new Error('插件被导入器执行了——违规')\n",
      }),
    })
    await writeAssetsManifest(src, [
      { assetId: 'dsh-side-effect', type: 'plugin', rel: 'plugins/dsh-side-effect', binding: 'exclusive', targetExecutor: 'dsh' },
    ])
    const target = path.join(root, 'no-execute-target')
    const report = await importDefinitionPackage({ sourceDir: src, targetDir: target, availableExecutors: ['dsh'] })
    expect(report.assets.items[0]?.state).toBe('loaded')
    expect(report.files).toContain('plugins/dsh-side-effect/src/index.mjs')
    expect(report.installAuthorization).toBe('required')
  })
})

describe('NEG-PKG-03 秘密/本机路径（隔离不放行、不回显值）', () => {
  it('定义部含疑似秘密 → 拒收，错误信息不含秘密值', async () => {
    const secret = 'sk-' + 'zyxwvutsrqponmlkjihgfedcba987654'
    const src = await makePkg('def-secret', baseFiles({ files: { 'docs/setup.md': `# 配置\n密钥：${secret}\n` } }))
    const target = path.join(root, 'def-secret-target')
    const error = await captureError(() => importDefinitionPackage({ sourceDir: src, targetDir: target }))
    expect(error.subcause).toBe('defpkg/secret-suspect')
    expect(error.message).not.toContain(secret)
    await expectZeroPlacement(target)
  })

  it('定义部含本机绝对路径 → 拒收（只报计数与类别）', async () => {
    const src = await makePkg('def-path', baseFiles({ files: { 'docs/paths.md': '源：/Users/alice/StudioNext\n' } }))
    const target = path.join(root, 'def-path-target')
    const error = await captureError(() => importDefinitionPackage({ sourceDir: src, targetDir: target }))
    expect(error.subcause).toBe('defpkg/secret-suspect')
    expect(error.detail ?? '').not.toContain('alice')
    await expectZeroPlacement(target)
  })
})

describe('NEG-PKG-04 导入面必备资产（拒绝或具名降级）', () => {
  async function requiredPluginPackage(name: string): Promise<string> {
    const src = await makePkg(name, { ...baseFiles(), ...pluginAt() })
    await writeAssetsManifest(src, [
      { assetId: 'dsh-web-test', type: 'plugin', rel: 'plugins/dsh-web-test', binding: 'exclusive', targetExecutor: 'dsh', required: true },
    ])
    return src
  }

  it('缺省拒绝：必备插件缺 DSH → 不落位', async () => {
    const src = await requiredPluginPackage('required-refuse')
    const target = path.join(root, 'required-refuse-target')
    const error = await captureError(() =>
      importDefinitionPackage({ sourceDir: src, targetDir: target, availableExecutors: [] }),
    )
    expect(error.subcause).toBe('assets/required-unavailable')
    await expectZeroPlacement(target)
  })

  it('降级无具名留痕 → 拒；有具名留痕 → 装载但逐项明示不可用', async () => {
    const src = await requiredPluginPackage('required-degrade')
    const silentTarget = path.join(root, 'required-degrade-silent')
    const silent = await captureError(() =>
      importDefinitionPackage({
        sourceDir: src,
        targetDir: silentTarget,
        availableExecutors: [],
        requiredAssetPolicy: 'degrade',
      }),
    )
    expect(silent.subcause).toBe('assets/degrade-decision-required')
    await expectZeroPlacement(silentTarget)

    const target = path.join(root, 'required-degrade-target')
    const report = await importDefinitionPackage({
      sourceDir: src,
      targetDir: target,
      availableExecutors: [],
      requiredAssetPolicy: 'degrade',
      decision: { actor: '制作人', note: '接受缺 DSH 插件，按缺资产形态运行' },
    })
    expect(report.assets.required.outcome).toBe('degraded')
    expect(report.assets.required.unavailable.map((item) => item.assetId)).toEqual(['dsh-web-test'])
    expect(report.assets.items[0]?.state).toBe('incompatible')
    expect(existsSync(path.join(target, 'plugins/dsh-web-test/package.json'))).toBe(true)
  })
})

describe('目录契约卫生（v2/06 §4.1 封闭集；只读校验拒收）', () => {
  it('本地产物/信任态目录（.AIWS/）→ 拒收', async () => {
    const src = await makePkg('forbidden', baseFiles({ files: { '.AIWS/AGENT-1/note.md': '# 本地\n' } }))
    const target = path.join(root, 'forbidden-target')
    const error = await captureError(() => importDefinitionPackage({ sourceDir: src, targetDir: target }))
    expect(error.subcause).toBe('defpkg/forbidden-path')
    await expectZeroPlacement(target)
  })

  it('封闭集外顶层项 → 拒收', async () => {
    const src = await makePkg('unknown-top', baseFiles({ files: { 'random.txt': 'x\n' } }))
    const target = path.join(root, 'unknown-top-target')
    const error = await captureError(() => importDefinitionPackage({ sourceDir: src, targetDir: target }))
    expect(error.subcause).toBe('defpkg/unknown-top-level')
    expect(error.message).toContain('random.txt')
    await expectZeroPlacement(target)
  })

  it('包内符号链接 → 拒收（路径逃逸不可行）', async () => {
    const src = await makePkg('symlink', baseFiles())
    await symlink(path.join(root, 'outside'), path.join(src, 'docs-link'))
    const target = path.join(root, 'symlink-target')
    const error = await captureError(() => importDefinitionPackage({ sourceDir: src, targetDir: target }))
    expect(error.subcause).toBe('defpkg/symlink')
    await expectZeroPlacement(target)
  })
})
