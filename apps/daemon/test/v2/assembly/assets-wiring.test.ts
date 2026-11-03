/**
 * assembly/assets/wire —— 资产部生产接线 V2 测试（DOM-07；studio-dev-549）
 *
 * 依据（实现单引用）：
 *   - docs/17-§2（boot 装配相位＋拍边界热载 apply；主循环七相位不增不减）；
 *   - v2/05 §三 DOM-07（资产部唯一权威；索引＝投影）；
 *   - v2/06 §3.4（装载报告逐项明示；必备不可用缺省拒绝＝fail-closed）、§4.5（plugins/ 专属位）；
 *   - docs/43-§四/§十-8（插件安装与指纹幂等；收缩不卸载）；
 *   - v2/11 §十一 REC-ASSET-01（专属标记/目标执行器不丢；本刀只做读取口径，不冒充落库）。
 *
 * 覆盖：
 *   ① 正例：assets.yaml 两项（插件专属＋通用技能）逐项 loaded；dependencies.yaml 绑定命中→隔离根
 *      安装落位（registry/plugin-state/install-log）；第二次同指纹＝零动作（热载幂等）；
 *   ② 负向：必备资产不可用＝拒载（required-unavailable），且不进入插件同步（无半载态）；
 *   ③ 拒启包装：onRefuse 恰一次（台账锁/连接收口），错误带「拒绝启动」前缀；agent.yaml 坏形态
 *      同样走拒启收口（执行器族解析不绕过 fail-closed）；
 *   ④ 执行器族投影：`dsh-mid`/`dsh-judge` 归 dsh、未知名忽略；空集＝专属资产 incompatible。
 *
 * 夹具全落 os.tmpdir()；不写仓内文件、不碰生产目录、不执行任何资产字节。
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { digestAssetDirectory } from '@studio-next/company'
import {
  executorFamiliesOf,
  wireCompanyAssets,
  wireCompanyAssetsAtBoot,
} from '../../../src/assembly/assets/wire.ts'

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sn-assets-wire-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 最小公司目录（本件只消费 org-config.yaml／assets.yaml／dependencies.yaml／plugins/） */
async function makeCompany(name: string, files: Record<string, string>): Promise<string> {
  const dir = path.join(root, name)
  await mkdir(dir, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    await mkdir(path.dirname(abs), { recursive: true })
    await writeFile(abs, content, 'utf8')
  }
  return dir
}

const ORG_CONFIG = [
  'schema: org-config/v1',
  'company:',
  '  name: 资产接线示范公司',
  '  slug: assets-wire-demo',
  '  level: 2',
  'people:',
  '  - id: AGENT-1',
  '    dept: departments/工程部',
  '    level: 1',
  '',
].join('\n')

/** DSH 插件最小合法形态（51-D-4：package.json name/version + dsh.bundle.patch 在位） */
const PLUGIN_FILES: Record<string, string> = {
  'plugins/dsh-web-test/package.json': `${JSON.stringify(
    { name: 'dsh-web-test', version: '1.0.0', type: 'module', dsh: { bundle: { patch: './cordis.patch.yml' } } },
    null,
    2,
  )}\n`,
  'plugins/dsh-web-test/cordis.patch.yml': '- insert:\n    - id: dsh-web-test\n      name: ./src/index.mjs\n      config: {}\n',
  'plugins/dsh-web-test/src/index.mjs': "export const name = 'dsh-web-test'\nexport function apply() {\n  return name\n}\n",
  'assets/skill-x/SKILL.md': '# 技能\n只读说明（夹具：装载≠执行授权）\n',
}

/** assets.yaml 两项：插件（DSH 专属位）＋通用技能；摘要按实现面 digestAssetDirectory 计算 */
async function assetsManifest(companyDir: string, opts: { pluginRequired?: boolean } = {}): Promise<string> {
  const pluginDigest = (await digestAssetDirectory(path.join(companyDir, 'plugins/dsh-web-test'))).value
  const skillDigest = (await digestAssetDirectory(path.join(companyDir, 'assets/skill-x'))).value
  return [
    'schema: studio-next/assets@1',
    'assets:',
    '  - assetId: dsh-web-test',
    '    type: plugin',
    '    contentDigest: { algorithm: sha-256, value: ' + pluginDigest + ', kind: byte }',
    '    provenance: { publisher: studio-next.test, version: 1.0.0 }',
    '    binding: exclusive',
    '    targetExecutor: dsh',
    `    requiredness: { required: ${opts.pluginRequired === false ? 'false' : 'true'}, impactNote: 必备资产：缺则公司声明不完整 }`,
    '    availability: { need: needed, impact: 缺插件则专属能力不可用 }',
    '  - assetId: skill-x',
    '    type: skill',
    '    contentDigest: { algorithm: sha-256, value: ' + skillDigest + ', kind: byte }',
    '    provenance: { publisher: studio-next.test }',
    '    binding: generic',
    '    requiredness: { required: false, impactNote: 缺失可运行 }',
    '    availability: { need: optional, impact: 无 }',
    '',
  ].join('\n')
}

/** agent.yaml 最小合法形态（拒启包装用例：执行器族解析成功，失败必须来自资产装载） */
const AGENT_YAML = [
  'executors:',
  '  dsh:',
  '    default: true',
  '    version: "1.0.0"',
  '    cmd: [dsh, --json]',
  '',
].join('\n')

const DEPENDENCIES = [
  'schema: studio-next/dependencies@1',
  'bindings:',
  '  - when: { attr: level, is: "1" }',
  '    plugins: [{ name: dsh-web-test, version: ^1.0 }]',
  '',
].join('\n')

describe('公司资产部生产接线（boot 装载＋热载 apply 共用体）', () => {
  it('正例：装载报告逐项 + 插件安装落位 + 同指纹第二次零动作（幂等）', async () => {
    const companyDir = await makeCompany('positive', { 'org-config.yaml': ORG_CONFIG, ...PLUGIN_FILES })
    // 摘要需在资产文件落盘后计算（先建目录树，再写清单）
    await writeFile(path.join(companyDir, 'assets.yaml'), await assetsManifest(companyDir), 'utf8')
    await writeFile(path.join(companyDir, 'dependencies.yaml'), DEPENDENCIES, 'utf8')
    const pluginRoot = path.join(root, 'positive-plugins')

    const logs: string[] = []
    const first = await wireCompanyAssets({
      companyDir,
      pluginRoot,
      executorFamilies: ['dsh'],
      log: (line) => logs.push(line),
    })
    expect(first.assets.manifestPresent).toBe(true)
    expect(first.assets.items.map((item) => [item.assetId, item.state])).toEqual([
      ['dsh-web-test', 'loaded'],
      ['skill-x', 'loaded'],
    ])
    expect(first.assets.required.outcome).toBe('none')
    expect(first.plugins.changed).toBe(true)
    expect(first.plugins.enabled['AGENT-1']?.map((ref) => ref.name)).toEqual(['dsh-web-test'])
    expect(existsSync(path.join(pluginRoot, 'registry.json'))).toBe(true)
    expect(existsSync(path.join(pluginRoot, 'plugin-state.json'))).toBe(true)
    expect(existsSync(path.join(pluginRoot, 'install-log.jsonl'))).toBe(true)
    expect(logs.join('\n')).toContain('[serve] 公司资产装载')
    expect(logs.join('\n')).toContain('manifest=present')
    expect(logs.join('\n')).toContain('插件同步')

    const secondLogs: string[] = []
    const second = await wireCompanyAssets({
      companyDir,
      pluginRoot,
      executorFamilies: ['dsh'],
      log: (line) => secondLogs.push(line),
    })
    expect(second.plugins.changed).toBe(false)
    expect(second.plugins.install).toBeUndefined()
    expect(secondLogs.join('\n')).toContain('零动作（指纹未变，幂等）')
  })

  it('负向：必备资产不可用＝拒载（fail-closed），且不进入插件同步（无半载态）', async () => {
    const companyDir = await makeCompany('required-missing', {
      'org-config.yaml': ORG_CONFIG,
      'assets.yaml': [
        'schema: studio-next/assets@1',
        'assets:',
        '  - assetId: skill-required',
        '    type: skill',
        '    contentDigest: { algorithm: sha-256, value: "' + '0'.repeat(64) + '", kind: byte }',
        '    provenance: { publisher: studio-next.test }',
        '    binding: generic',
        '    requiredness: { required: true, impactNote: 必备：缺则公司声明不完整 }',
        '    availability: { need: needed, impact: 不可用 }',
        '',
      ].join('\n'),
    })
    await writeFile(path.join(companyDir, 'dependencies.yaml'), DEPENDENCIES, 'utf8')
    const agentYaml = path.join(root, 'required-missing-agent.yaml')
    await writeFile(agentYaml, AGENT_YAML, 'utf8')
    const pluginRoot = path.join(root, 'required-missing-plugins')
    let refused = 0
    let message = ''
    try {
      await wireCompanyAssetsAtBoot({
        companyDir,
        pluginRoot,
        agentYaml,
        log: () => {},
        onRefuse: () => {
          refused += 1
        },
      })
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }
    expect(message).toContain('拒绝启动')
    expect(message).toContain('assets/required-unavailable')
    expect(refused).toBe(1)
    expect(existsSync(path.join(pluginRoot, 'plugin-state.json'))).toBe(false)
  })

  it('拒启包装：agent.yaml 坏形态也走 onRefuse（不绕过 fail-closed、不漏台账锁收口）', async () => {
    const companyDir = await makeCompany('bad-agent', { 'org-config.yaml': ORG_CONFIG })
    const badAgent = path.join(root, 'bad-agent.yaml')
    await writeFile(badAgent, 'executors: [\n', 'utf8')
    let refused = 0
    let message = ''
    try {
      await wireCompanyAssetsAtBoot({
        companyDir,
        pluginRoot: path.join(root, 'bad-agent-plugins'),
        agentYaml: badAgent,
        log: () => {},
        onRefuse: () => {
          refused += 1
        },
      })
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }
    expect(message).toContain('拒绝启动')
    expect(refused).toBe(1)
  })
})

describe('执行器族投影（v2/06 §3.4：专属资产缺目标执行器＝明示不可用）', () => {
  it('dsh 档位/判断位归 dsh 族；未知名忽略；空集→专属资产 incompatible', async () => {
    expect(executorFamiliesOf(['dsh', 'dsh-mid', 'dsh-high', 'dsh-judge', 'claude', 'fake-provider'])).toEqual([
      'claude',
      'dsh',
    ])
    expect(executorFamiliesOf([])).toEqual([])

    const companyDir = await makeCompany('incompatible', {
      'org-config.yaml': ORG_CONFIG,
      ...PLUGIN_FILES,
    })
    await writeFile(path.join(companyDir, 'assets.yaml'), await assetsManifest(companyDir, { pluginRequired: false }), 'utf8')
    const report = await wireCompanyAssets({
      companyDir,
      pluginRoot: path.join(root, 'incompatible-plugins'),
      executorFamilies: [],
      log: () => {},
    })
    const plugin = report.assets.items.find((item) => item.assetId === 'dsh-web-test')
    expect(plugin?.state).toBe('incompatible')
    expect(plugin?.reason).toContain('缺执行器 dsh')
    // 报告不丢专属标记与目标执行器（REC-ASSET-01 读取口径）
    expect(plugin?.binding).toBe('exclusive')
    expect(plugin?.targetExecutor).toBe('dsh')
  })
})

describe('生产接线面（分析件 #23 的 grep 判据：daemon 引用非零）', () => {
  it('boot 装配（run.ts→boot.ts）与热载 apply（runtime.ts）都引用接线体；company 包导出装载面', () => {
    const runSrc = readFileSync(new URL('../../../src/assembly/serve/run.ts', import.meta.url), 'utf8')
    const bootSrc = readFileSync(new URL('../../../src/assembly/assets/boot.ts', import.meta.url), 'utf8')
    const runtimeSrc = readFileSync(new URL('../../../src/assembly/serve/runtime.ts', import.meta.url), 'utf8')
    const companyIndex = readFileSync(new URL('../../../../../packages/company/src/index.ts', import.meta.url), 'utf8')
    expect(runSrc).toContain('loadCompanyAtBoot(')
    expect(bootSrc).toContain('wireCompanyAssetsAtBoot(')
    expect(runtimeSrc).toContain('wireCompanyAssets(')
    expect(companyIndex).toContain("export * from './assets/index.ts'")
  })
})

/** 防止夹具被静默改名：清单/依赖原文可读（证据面） */
describe('夹具自检', () => {
  it('assets.yaml/dependencies.yaml 可被装载面解析（不留空壳夹具）', async () => {
    const companyDir = path.join(root, 'positive')
    expect((await readFile(path.join(companyDir, 'assets.yaml'), 'utf8')).includes('schema: studio-next/assets@1')).toBe(
      true,
    )
    expect(
      (await readFile(path.join(companyDir, 'dependencies.yaml'), 'utf8')).includes(
        'schema: studio-next/dependencies@1',
      ),
    ).toBe(true)
  })
})
