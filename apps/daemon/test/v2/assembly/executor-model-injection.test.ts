/**
 * executor model 声明镜像注入 V2 套件（studio-dev-882）
 *
 * 缺陷：agent.yaml 四档 executor 无 patches 段；serve 只把 models.yaml overlay 喂 dsh CLI，
 * 不回填 adapter 声明镜像 → ResultStats.model undefined → harvest usage/cost fail-closed
 * （work_records.model 全 NULL、USD 恒 0）。修法 A：models.yaml tiers 派生
 * `patches['agent-default-model']` 注入 agentConf（不猜模型、catalog 缺失不注入+WARN）。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { loadAgentConfig } from '@studio-next/adapters'
import { parseModelsYaml } from '@studio-next/core'
import { openLedger } from '@studio-next/store'
import { parseDaemonConfig } from '../../../src/assembly/serve/config.ts'
import { injectTierModelPatches, wireExecutorFace } from '../../../src/assembly/serve/executor-face.ts'

const ROOT = mkdtempSync(path.join(tmpdir(), 'sn-882-model-'))
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

const MODELS_YAML = [
  'tiers:',
  '  high: {provider: p-high, model: m-high, price: {inputPerM: 1, outputPerM: 2}}',
  '  mid: {provider: p-mid, model: m-mid, price: {inputPerM: 1, outputPerM: 2}}',
  '  low: {provider: p-low, model: m-low, price: {inputPerM: 1, outputPerM: 2}}',
  'roles:',
  '  main_worker: mid',
].join('\n')

const AGENT_YAML = [
  'executors:',
  '  dsh:',
  '    default: true',
  '  dsh-mid: {}',
  '  dsh-high: {}',
  '  dsh-low: {}',
].join('\n')

describe('882 executor model 声明镜像注入', () => {
  it('四档 executor 均从 models.yaml tiers 派生正确 provider/model；已有显式声明不覆盖', () => {
    const models = parseModelsYaml(MODELS_YAML)
    const agent = loadAgentConfig(`${AGENT_YAML}\n`.replace('  dsh-low: {}', '  dsh-low:\n    patches:\n      agent-default-model:\n        config: {provider: manual, model: manual-low}'))
    const out = injectTierModelPatches(agent, models)
    const modelOf = (name: string): unknown => out.executors.find((e) => e.name === name)?.patches?.['agent-default-model']
    expect(modelOf('dsh')).toEqual({ config: { provider: 'p-mid', model: 'm-mid' } }) // dsh=中档
    expect(modelOf('dsh-mid')).toEqual({ config: { provider: 'p-mid', model: 'm-mid' } })
    expect(modelOf('dsh-high')).toEqual({ config: { provider: 'p-high', model: 'm-high' } })
    // 显式声明优先（漂移由 checkTierPositionDeclarations 拒启，不在注入面静默覆盖）
    expect(modelOf('dsh-low')).toEqual({ config: { provider: 'manual', model: 'manual-low' } })
    // 原 agentConf 不被就地修改（纯函数）
    expect(agent.executors.find((e) => e.name === 'dsh')?.patches).toBeUndefined()
  })

  it('catalog 缺失：不注入 + 启动 WARN，保留 fail-closed skip 语义（不猜模型）', async () => {
    const root = path.join(ROOT, 'nomodels')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(root, { recursive: true })
    const agentYaml = path.join(root, 'agent.yaml')
    writeFileSync(agentYaml, `${AGENT_YAML}\n`.replace('  dsh-low: {}', '  dsh-low: {}'), 'utf8')
    const db = path.join(root, 'ledger.sqlite')
    const config = parseDaemonConfig(
      [
        `db: ${db}`,
        'platform: localfile',
        `platformDir: ${path.join(root, 'platform')}`,
        'company: demo',
        `rootDir: ${path.join(root, 'var')}`,
        `agentYaml: ${agentYaml}`,
      ].join('\n'),
    )
    const ledger = openLedger(db)
    const logs: string[] = []
    try {
      const face = wireExecutorFace(config, { ledger, clock: () => 1_000, log: (line) => logs.push(line) })
      expect(face.catalog).toBeUndefined() // 态 B：无 catalog
      // 不注入：registry 仍可用，但 WARN 必须可见（不静默 fail-closed）
      expect(logs.some((line) => line.includes('无 models 段——executor model 声明镜像不注入'))).toBe(true)
      expect(logs.some((line) => line.includes('fail-closed skip'))).toBe(true)
      expect(face.registry.list().map((e) => e.name)).toContain('dsh')
    } finally {
      ledger.close()
    }
  })
})
