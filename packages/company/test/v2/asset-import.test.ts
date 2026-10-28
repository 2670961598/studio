/**
 * asset-import —— 资产部装载面 V2 测试（IMPL-05-01；G-DOM-07 / G-REC-ASSET）
 *
 * 覆盖（冻结验收口径）：
 *   - 正例：资产清单唯一索引 → loaded 逐项；专属标记/目标执行器/必备性/可执行标记不丢；
 *     REC-ASSET-01 payload 形状经 contract 工件（AssetRegistrationPayloadSchema）校验；
 *   - 无清单=零资产（不按目录名默认全收）；
 *   - NEG-PKG-01 类型封闭（未知资产类型/封闭枚举值逐条指名拒收）；
 *   - NEG-PKG-03 秘密/本机路径（隔离＋明示，不回显值，不称绝无）；
 *   - NEG-PKG-04 必备资产不可用（缺省拒绝；降级须具名留痕；装载报告逐项明示，不冒充已装）；
 *   - NEG-PKG-05 资产执行边界（代码只允许 plugins/ 下 DSH 插件；装载不执行任何文件）；
 *   - 装载四态逐项：loaded/missing/incompatible/blocked。
 *
 * 依据：v2/06 §3.2/§3.4/§3.5/§4.5/§九；v2/10 §4.4/§4.8；v2/11 §十一 REC-ASSET-01；
 *       v2/15 §四；plan/05 IMPL-05-01。夹具全落 tmp，不写仓内文件。
 */
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { stringify } from 'yaml'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ASSET_KINDS, EXECUTOR_VALUES, AssetRegistrationPayloadSchema } from '../../../contract/src/records/asset.ts'
import {
  loadCompanyAssets,
  readAssetManifest,
  summarizeAssetReport,
  toAssetRegistrationPayload,
} from '../../src/assets/index.ts'
import {
  captureError,
  makeTempRoot,
  pluginTree,
  writeAssetsManifest,
  writeTree,
} from './assets-fixtures.ts'

let root = ''

beforeAll(async () => {
  root = await makeTempRoot('assets')
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 插件文件树（带 plugins/<name>/ 前缀） */
function pluginAt(name = 'dsh-web-test', version = '1.0.0', extra: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(pluginTree(name, version, extra)).map(([rel, data]) => [`plugins/${name}/${rel}`, data]),
  )
}

async function makeCompany(name: string, files: Record<string, string | Buffer> = {}): Promise<string> {
  const dir = path.join(root, name)
  await mkdir(dir, { recursive: true })
  if (Object.keys(files).length > 0) await writeTree(dir, files)
  return dir
}

describe('资产部装载正例（v2/06 §3.2：清单唯一索引）', () => {
  it('三资产装载：插件专属/通用技能/专属 MCP —— 标记不丢、摘要一致、逐项 loaded', async () => {
    const dir = await makeCompany('positive', {
      ...pluginAt(),
      'assets/skill-x/SKILL.md': '# 技能\n只读说明\n',
      'assets/mcp-y/server.yaml': 'name: mcp-y\n',
    })
    await writeAssetsManifest(dir, [
      { assetId: 'dsh-web-test', type: 'plugin', rel: 'plugins/dsh-web-test', binding: 'exclusive', targetExecutor: 'dsh', required: true, availabilityNeed: 'needed', version: '1.0.0' },
      { assetId: 'skill-x', type: 'skill', rel: 'assets/skill-x', binding: 'generic', license: true },
      { assetId: 'mcp-y', type: 'mcp', rel: 'assets/mcp-y', binding: 'exclusive', targetExecutor: 'dsh' },
    ])

    const report = await loadCompanyAssets({ companyDir: dir, availableExecutors: ['dsh'] })
    expect(report.manifestPresent).toBe(true)
    expect(report.items.map((item) => item.assetId)).toEqual(['dsh-web-test', 'mcp-y', 'skill-x'])
    expect(report.items.every((item) => item.state === 'loaded')).toBe(true)
    expect(report.unlisted).toEqual([])
    expect(report.issues).toEqual([])
    expect(summarizeAssetReport(report)).toEqual({ loaded: 3, missing: 0, incompatible: 0, blocked: 0 })

    const plugin = report.items.find((item) => item.assetId === 'dsh-web-test')
    expect(plugin).toMatchObject({
      type: 'plugin',
      binding: 'exclusive',
      targetExecutor: 'dsh',
      required: true,
      installAuthorization: 'required',
      location: 'plugins/dsh-web-test',
    })
    expect(plugin?.executableContent).toBe(true)
    expect(plugin?.reason).toContain('装载≠安装授权')
    expect(ASSET_KINDS).toContain(plugin?.type)
    expect(EXECUTOR_VALUES).toContain(plugin?.targetExecutor)

    const skill = report.items.find((item) => item.assetId === 'skill-x')
    expect(skill).toMatchObject({ binding: 'generic', required: false, executableContent: false })
    expect(skill?.targetExecutor).toBeUndefined()

    // 专属标记/目标执行器进入 REC-ASSET-01 payload（contract 工件校验，不复制字段表）
    const manifest = await readAssetManifest(dir)
    const entry = manifest.entries.find((candidate) => candidate.assetId === 'dsh-web-test')
    expect(entry).toBeDefined()
    const payload = entry === undefined ? null : toAssetRegistrationPayload(entry, { refId: 'company.asset-demo.assets', refVersion: '1.0.0' })
    expect(payload).not.toBeNull()
    const parsed = AssetRegistrationPayloadSchema.safeParse(payload)
    expect(parsed.success).toBe(true)
    expect(payload?.exclusivity).toMatchObject({ marker: 'exclusive', target_executor: 'dsh' })
    expect(payload?.provenance.digest).toBe(entry?.contentDigest.value)
  })

  it('无清单=零资产：plugins/ 有文件也不默认全收，登记为未列出索引违反', async () => {
    const dir = await makeCompany('no-manifest', pluginAt())
    const report = await loadCompanyAssets({ companyDir: dir })
    expect(report.manifestPresent).toBe(false)
    expect(report.items).toEqual([])
    expect(report.unlisted).toContain('plugins/dsh-web-test')
    expect(report.issues.map((issue) => issue.code)).toContain('assets/unlisted')
    expect(report.scan.note).toContain('不证明绝无秘密')
  })

  it('清单缺 binding → 按 generic 处理并警示（W-SCH-002——不静默丢弃）', async () => {
    const dir = await makeCompany('binding-default', { 'assets/skill-z/SKILL.md': '# z\n' })
    await writeAssetsManifest(dir, [{ assetId: 'skill-z', type: 'skill', rel: 'assets/skill-z' }])
    const report = await loadCompanyAssets({ companyDir: dir, availableExecutors: ['dsh'] })
    expect(report.warnings).toEqual([expect.objectContaining({ code: 'W-SCH-002', assetId: 'skill-z' })])
    expect(report.items[0]).toMatchObject({ binding: 'generic', state: 'loaded' })
  })
})

describe('NEG-PKG-01 类型封闭（未知资产类型/封闭枚举值逐条指名）', () => {
  it('未知 type/binding/targetExecutor/availability.need → 拒收并逐条指名（E-SCH-001）', async () => {
    const dir = await makeCompany('unknown-type')
    await writeFile(
      path.join(dir, 'assets.yaml'),
      stringify({
        schema: 'studio-next/assets@1',
        assets: [
          {
            assetId: 'evil',
            type: 'worm',
            contentDigest: { algorithm: 'sha-256', value: '0'.repeat(64), kind: 'byte' },
            provenance: { publisher: 'unknown' },
            binding: 'weird',
            targetExecutor: 'gpt',
            requiredness: { required: true, impactNote: 'x' },
            availability: { need: 'sometimes', impact: 'x' },
          },
        ],
      }),
      'utf8',
    )
    const error = await captureError(() => loadCompanyAssets({ companyDir: dir }))
    expect(error.subcause).toBe('assets/unknown-type')
    for (const token of ['worm', 'weird', 'gpt', 'sometimes']) expect(error.message).toContain(token)
    expect(error.message).toContain('E-SCH-001')
  })

  it('assetId 非 dotid（绝对路径/.. 逃逸）→ 拒收（assets/invalid-id）', async () => {
    const dir = await makeCompany('unsafe-id')
    await writeFile(
      path.join(dir, 'assets.yaml'),
      stringify({
        schema: 'studio-next/assets@1',
        assets: [
          {
            assetId: '../../etc/passwd',
            type: 'skill',
            contentDigest: { algorithm: 'sha-256', value: '0'.repeat(64), kind: 'byte' },
            provenance: { publisher: 'unknown' },
            requiredness: { required: false, impactNote: 'x' },
            availability: { need: 'optional', impact: 'x' },
          },
        ],
      }),
      'utf8',
    )
    const error = await captureError(() => loadCompanyAssets({ companyDir: dir }))
    expect(error.subcause).toBe('assets/invalid-id')
    expect(error.message).toContain('../../etc/passwd')
  })

  it('专属标记与目标执行器互斥：exclusive 缺 targetExecutor 拒；generic 带 targetExecutor 拒', async () => {
    const missing = await makeCompany('exclusive-no-target', { 'plugins/dsh-web-test/package.json': '{}\n' })
    await writeAssetsManifest(missing, [
      { assetId: 'dsh-web-test', type: 'plugin', rel: 'plugins/dsh-web-test', binding: 'exclusive' },
    ])
    const first = await captureError(() => loadCompanyAssets({ companyDir: missing, availableExecutors: ['dsh'] }))
    expect(first.subcause).toBe('assets/binding-invalid')
    expect(first.message).toContain('dsh-web-test')

    const extra = await makeCompany('generic-with-target', { 'assets/skill-q/SKILL.md': '# q\n' })
    await writeAssetsManifest(extra, [
      { assetId: 'skill-q', type: 'skill', rel: 'assets/skill-q', binding: 'generic', targetExecutor: 'dsh' },
    ])
    const second = await captureError(() => loadCompanyAssets({ companyDir: extra }))
    expect(second.subcause).toBe('assets/binding-invalid')
    expect(second.message).toContain('skill-q')
  })
})

describe('NEG-PKG-04 必备资产（缺省拒绝／降级具名／报告明示）', () => {
  it('必备专属资产缺执行器：缺省拒绝装载，错误指名资产与缺执行器原因', async () => {
    const dir = await makeCompany('required-refuse', pluginAt())
    await writeAssetsManifest(dir, [
      { assetId: 'dsh-web-test', type: 'plugin', rel: 'plugins/dsh-web-test', binding: 'exclusive', targetExecutor: 'dsh', required: true },
    ])
    const error = await captureError(() => loadCompanyAssets({ companyDir: dir, availableExecutors: [] }))
    expect(error.subcause).toBe('assets/required-unavailable')
    expect(error.message).toContain('dsh-web-test')
    expect(error.message).toContain('缺执行器 dsh')
    expect(error.message).toContain('缺执行器')
  })

  it('降级必须具名留痕：无 decision 拒；有 decision 时逐项 incompatible 且不冒充已装', async () => {
    const dir = await makeCompany('required-degrade', pluginAt())
    await writeAssetsManifest(dir, [
      { assetId: 'dsh-web-test', type: 'plugin', rel: 'plugins/dsh-web-test', binding: 'exclusive', targetExecutor: 'dsh', required: true },
    ])
    const silent = await captureError(() =>
      loadCompanyAssets({ companyDir: dir, availableExecutors: [], requiredAssetPolicy: 'degrade' }),
    )
    expect(silent.subcause).toBe('assets/degrade-decision-required')

    const report = await loadCompanyAssets({
      companyDir: dir,
      availableExecutors: [],
      requiredAssetPolicy: 'degrade',
      decision: { actor: '制作人', note: '接受缺 DSH 插件运行，损失面已登记' },
    })
    expect(report.required).toMatchObject({ policy: 'degrade', outcome: 'degraded' })
    expect(report.required.decision?.actor).toBe('制作人')
    expect(report.required.unavailable.map((item) => item.assetId)).toEqual(['dsh-web-test'])
    const item = report.items[0]
    expect(item?.state).toBe('incompatible')
    expect(item?.reason).toContain('缺执行器 dsh')
    expect(report.items.filter((candidate) => candidate.state === 'loaded')).toEqual([])
  })

  it('非必备资产缺失（missing）明示进报告，不阻断、不静默补', async () => {
    const dir = await makeCompany('non-required-missing', { 'assets/skill-ok/SKILL.md': '# ok\n' })
    await writeAssetsManifest(dir, [
      { assetId: 'skill-ok', type: 'skill', rel: 'assets/skill-ok', binding: 'generic' },
      { assetId: 'skill-ghost', type: 'skill', rel: 'assets/skill-ghost', binding: 'generic', digestOverride: 'a'.repeat(64) },
    ])
    const report = await loadCompanyAssets({ companyDir: dir })
    const ghost = report.items.find((item) => item.assetId === 'skill-ghost')
    expect(ghost?.state).toBe('missing')
    expect(ghost?.reason).toContain('资产文件不在位')
    expect(report.required).toMatchObject({ policy: 'refuse', outcome: 'none' })
    expect(summarizeAssetReport(report)).toEqual({ loaded: 1, missing: 1, incompatible: 0, blocked: 0 })
  })
})

describe('NEG-PKG-03 秘密/本机路径（隔离不放行、不回显值）', () => {
  it('资产文件含疑似秘密 → blocked 且错误不回显秘密值', async () => {
    const secret = 'sk-' + 'abcdefghijklmnopqrstuvwxyz012345'
    const dir = await makeCompany('secret-asset', {
      ...pluginAt('dsh-leaky', '1.0.0', { 'src/settings.txt': `api_key = "${secret}"\n` }),
    })
    await writeAssetsManifest(dir, [
      { assetId: 'dsh-leaky', type: 'plugin', rel: 'plugins/dsh-leaky', binding: 'exclusive', targetExecutor: 'dsh' },
    ])
    const report = await loadCompanyAssets({ companyDir: dir, availableExecutors: ['dsh'] })
    const item = report.items[0]
    expect(item?.state).toBe('blocked')
    expect(item?.reason).toContain('疑似秘密值')
    expect(report.issues.map((issue) => issue.code)).toContain('assets/secret-suspect')
    expect(report.scan.suspects).toBeGreaterThan(0)
    expect(JSON.stringify(report)).not.toContain(secret)
  })

  it('资产文件含本机绝对路径 → blocked（不称「绝无」，只报类别）', async () => {
    const localPath = '/Users/alice/StudioNext/company'
    const dir = await makeCompany('local-path-asset', {
      'assets/skill-local/SKILL.md': `# 说明\n源目录：${localPath}\n`,
    })
    await writeAssetsManifest(dir, [{ assetId: 'skill-local', type: 'skill', rel: 'assets/skill-local', binding: 'generic' }])
    const report = await loadCompanyAssets({ companyDir: dir })
    expect(report.items[0]?.state).toBe('blocked')
    expect(report.issues.map((issue) => issue.code)).toContain('assets/secret-suspect')
    expect(report.scan.note).toContain('不证明绝无秘密')
    expect(JSON.stringify(report)).not.toContain('alice')
  })
})

describe('NEG-PKG-05 资产执行边界（代码只允许 plugins/ 下 DSH 插件）', () => {
  it('通用资产目录含可执行内容 → blocked（不得把代码装在定义部/通用资产位）', async () => {
    const dir = await makeCompany('generic-code', { 'assets/tool-x/run.mjs': 'console.log(1)\n' })
    await writeAssetsManifest(dir, [{ assetId: 'tool-x', type: 'skill', rel: 'assets/tool-x', binding: 'generic' }])
    const report = await loadCompanyAssets({ companyDir: dir })
    const item = report.items[0]
    expect(item?.state).toBe('blocked')
    expect(item?.reason).toContain('可执行内容')
    expect(report.issues.map((issue) => issue.code)).toContain('assets/executable-outside-plugins')
  })

  it('plugins/ 位置的插件必须是 DSH 专属（targetExecutor=claude 拒，不改判通用）', async () => {
    const dir = await makeCompany('plugin-wrong-executor', pluginAt())
    await writeAssetsManifest(dir, [
      { assetId: 'dsh-web-test', type: 'plugin', rel: 'plugins/dsh-web-test', binding: 'exclusive', targetExecutor: 'claude' },
    ])
    const report = await loadCompanyAssets({ companyDir: dir, availableExecutors: ['dsh', 'claude'] })
    expect(report.items[0]?.state).toBe('blocked')
    expect(report.issues.map((issue) => issue.code)).toContain('assets/plugin-position')
  })

  it('插件形态闸（51-D-4）：缺 dsh.bundle 拒；patch 越出资产目录拒', async () => {
    const noBundle = await makeCompany('plugin-no-bundle', {
      'plugins/dsh-bad/package.json': `${JSON.stringify({ name: 'dsh-bad', version: '1.0.0' })}\n`,
      'plugins/dsh-bad/src/index.mjs': 'export const name = "dsh-bad"\n',
    })
    await writeAssetsManifest(noBundle, [
      { assetId: 'dsh-bad', type: 'plugin', rel: 'plugins/dsh-bad', binding: 'exclusive', targetExecutor: 'dsh' },
    ])
    const first = await loadCompanyAssets({ companyDir: noBundle, availableExecutors: ['dsh'] })
    expect(first.items[0]?.state).toBe('blocked')
    expect(first.issues.map((issue) => issue.code)).toContain('assets/plugin-shape')
    expect(first.items[0]?.reason).toContain('dsh.bundle')

    const escape = await makeCompany('plugin-patch-escape', {
      'plugins/dsh-escape/package.json': `${JSON.stringify({ name: 'dsh-escape', version: '1.0.0', dsh: { bundle: { patch: '../outside.yml' } } })}\n`,
      'plugins/dsh-escape/src/index.mjs': 'export const name = "x"\n',
      'plugins/outside.yml': '- insert: []\n',
    })
    await writeAssetsManifest(escape, [
      { assetId: 'dsh-escape', type: 'plugin', rel: 'plugins/dsh-escape', binding: 'exclusive', targetExecutor: 'dsh' },
    ])
    const second = await loadCompanyAssets({ companyDir: escape, availableExecutors: ['dsh'] })
    expect(second.items[0]?.state).toBe('blocked')
    expect(second.items[0]?.reason).toContain('路径逃逸')
  })

  it('摘要不符 → blocked（无摘要一致不得进入分发）', async () => {
    const dir = await makeCompany('digest-mismatch', { 'assets/skill-d/SKILL.md': '# d\n' })
    await writeAssetsManifest(dir, [
      { assetId: 'skill-d', type: 'skill', rel: 'assets/skill-d', binding: 'generic', digestOverride: 'a'.repeat(64) },
    ])
    const report = await loadCompanyAssets({ companyDir: dir })
    expect(report.items[0]?.state).toBe('blocked')
    expect(report.issues.map((issue) => issue.code)).toContain('assets/digest-mismatch')
  })

  it('未列出资产文件 → 报告 unlisted（索引唯一性；不默认收集）', async () => {
    const dir = await makeCompany('unlisted', {
      ...pluginAt('dsh-declared'),
      'plugins/dsh-extra/package.json': `${JSON.stringify({ name: 'dsh-extra', version: '1.0.0' })}\n`,
    })
    await writeAssetsManifest(dir, [
      { assetId: 'dsh-declared', type: 'plugin', rel: 'plugins/dsh-declared', binding: 'exclusive', targetExecutor: 'dsh' },
    ])
    const report = await loadCompanyAssets({ companyDir: dir, availableExecutors: ['dsh'] })
    expect(report.items.map((item) => item.assetId)).toEqual(['dsh-declared'])
    expect(report.unlisted).toContain('plugins/dsh-extra')
    expect(report.issues.map((issue) => issue.code)).toContain('assets/unlisted')
  })

  it('资产目录内符号链接 → blocked（当前口径全拒，路径逃逸不可行）', async () => {
    const dir = await makeCompany('asset-symlink', {
      ...pluginAt('dsh-linked'),
    })
    await writeAssetsManifest(dir, [
      { assetId: 'dsh-linked', type: 'plugin', rel: 'plugins/dsh-linked', binding: 'exclusive', targetExecutor: 'dsh' },
    ])
    await symlink(path.join(root, 'outside-target'), path.join(dir, 'plugins', 'dsh-linked', 'escape'))
    const report = await loadCompanyAssets({ companyDir: dir, availableExecutors: ['dsh'] })
    expect(report.items[0]?.state).toBe('blocked')
    expect(report.items[0]?.reason).toContain('符号链接')
    expect(report.issues.map((issue) => issue.code)).toContain('assets/symlink')
  })
})
