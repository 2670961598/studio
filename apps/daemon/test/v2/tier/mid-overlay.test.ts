/**
 * mid 档 overlay 单源 V2 套件（studio-dev-885）
 *
 * 缺陷：provisionModelTierOverlays 只生成 high/low；mid=现役 dsh profile 缺省 → 切 models.yaml
 * 后 mid 档仍走 profile 默认模型（2026-11-07 实测 7 次 GoUsageLimitError，需手改 profile）。
 * 修法①：三档 overlay 全生成；serve 启动把 mid overlay 以 `--patch` 自动挂到 dsh/dsh-mid cmd
 * （不改宿主 agent.yaml/profile；profile 默认仅兜底）。high/low 行为不变。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { DSH_DEFAULT_CMD, loadAgentConfig } from '@studio-next/adapters'
import { parseModelsYaml } from '@studio-next/core'
import { openLedger } from '@studio-next/store'
import { provisionModelTierOverlays } from '../../../src/engine/tier/model-tier.ts'
import { mountMidTierOverlay, wireExecutorFace } from '../../../src/assembly/serve/executor-face.ts'
import { parseDaemonConfig } from '../../../src/assembly/serve/config.ts'

const ROOT = mkdtempSync(path.join(tmpdir(), 'sn885-mid-overlay-'))
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

const MODELS_YAML = `
tiers:
  high: {provider: high-p, model: high-m, price: {inputPerM: 1, outputPerM: 2}}
  mid: {provider: mid-p, model: mid-m, price: {inputPerM: 1, outputPerM: 2}}
  low: {provider: low-p, model: low-m, price: {inputPerM: 1, outputPerM: 2}}
roles: {main_worker: mid}
`
const GENERIC_AGENT = `
executors:
  dsh:
    default: true
  dsh-mid: {}
  dsh-high: {}
  dsh-low: {}
`

describe('885 三档 overlay 生成（mid 纳入单源）', () => {
  it('high/mid/low 三文件齐全；mid 内容=models.yaml tiers.mid；0600+确定性重跑', () => {
    const dir = path.join(ROOT, 'overlays')
    mkdirSync(dir, { recursive: true })
    const models = parseModelsYaml(MODELS_YAML)
    const out = provisionModelTierOverlays(dir, models)
    expect(Object.keys(out).sort()).toEqual(['high', 'low', 'mid'])
    for (const tier of ['high', 'mid', 'low'] as const) {
      expect(existsSync(out[tier])).toBe(true)
      expect(statSync(out[tier]).mode & 0o777).toBe(0o600)
    }
    const mid = readFileSync(out.mid, 'utf8')
    expect(mid).toContain('provider: mid-p')
    expect(mid).toContain('model: mid-m')
    expect(mid).toContain('tier=mid')
    // 确定性：重跑同 bytes（启动覆写刷新面）
    const again = provisionModelTierOverlays(dir, models)
    expect(readFileSync(again.mid, 'utf8')).toBe(mid)
  })
})

describe('885 mid overlay 自动挂载（只动 dsh/dsh-mid cmd）', () => {
  it('dsh 显式 cmd 尾插 --patch；dsh-mid 缺省 cmd 用 DSH_DEFAULT_CMD；幂等；high/low 不动', () => {
    const agent = loadAgentConfig(GENERIC_AGENT)
    const p = path.join(ROOT, 'overlays', 'dsh-tier-mid.yml')
    const first = mountMidTierOverlay(agent, p)
    const dsh = first.config.executors.find((e) => e.name === 'dsh')
    const mid = first.config.executors.find((e) => e.name === 'dsh-mid')
    expect(dsh?.cmd).toEqual([...DSH_DEFAULT_CMD, '--patch', p])
    expect(mid?.cmd).toEqual([...DSH_DEFAULT_CMD, '--patch', p])
    expect([...first.mounted].sort()).toEqual(['dsh', 'dsh-mid'])
    // 幂等：同 overlay 已挂 → 不重复追加
    const second = mountMidTierOverlay(first.config, p)
    expect(second.mounted).toEqual([])
    expect(second.config.executors.find((e) => e.name === 'dsh')?.cmd).toEqual([...DSH_DEFAULT_CMD, '--patch', p])
    // 原 config 不被就地修改
    expect(agent.executors.find((e) => e.name === 'dsh')?.cmd).toBeUndefined()
    // 非 mid 档位/其它家族不挂载
    for (const name of ['dsh-high', 'dsh-low']) {
      expect(first.config.executors.find((e) => e.name === name)?.cmd).toBeUndefined()
    }
    expect(mountMidTierOverlay(agent, undefined).mounted).toEqual([])
  })
})

describe('885 serve 装配：mid overlay 生成+挂载接线', () => {
  it('agentYaml+models：启动日志含 mid 自动挂载，high/low overlay 照生成', () => {
    const root = path.join(ROOT, 'serve')
    mkdirSync(root, { recursive: true })
    const agentYaml = path.join(root, 'agent.yaml')
    const modelsYaml = path.join(root, 'models.yaml')
    writeFileSync(agentYaml, GENERIC_AGENT, 'utf8')
    writeFileSync(modelsYaml, MODELS_YAML, 'utf8')
    const db = path.join(root, 'ledger.sqlite')
    const config = parseDaemonConfig(
      [
        `db: ${db}`,
        'platform: localfile',
        `platformDir: ${path.join(root, 'platform')}`,
        'company: demo',
        `rootDir: ${path.join(root, 'var')}`,
        `agentYaml: ${agentYaml}`,
        `models: ${modelsYaml}`,
      ].join('\n'),
    )
    const ledger = openLedger(db)
    const logs: string[] = []
    try {
      const face = wireExecutorFace(config, { ledger, clock: () => 1_000, log: (line) => logs.push(line) })
      expect(face.registry.list().map((e) => e.name)).toEqual(expect.arrayContaining(['dsh', 'dsh-mid', 'dsh-high', 'dsh-low']))
      expect(logs.some((line) => line.includes('mid overlay 已自动挂载到 dsh/dsh-mid'))).toBe(true)
      expect(existsSync(path.join(root, 'var', 'tmp', 'dsh-tier-mid.yml'))).toBe(true)
      expect(existsSync(path.join(root, 'var', 'tmp', 'dsh-tier-high.yml'))).toBe(true)
      expect(existsSync(path.join(root, 'var', 'tmp', 'dsh-tier-low.yml'))).toBe(true)
    } finally {
      ledger.close()
    }
  })
})

describe('885 catalog 缺失：不生成/不挂载（profile 缺省兜底，不猜）', () => {
  it('无 models 段：overlay 文件不落、cmd 不改，启动日志明示未挂载', () => {
    const root = path.join(ROOT, 'no-models')
    mkdirSync(root, { recursive: true })
    const agentYaml = path.join(root, 'agent.yaml')
    writeFileSync(agentYaml, GENERIC_AGENT, 'utf8')
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
      wireExecutorFace(config, { ledger, clock: () => 1_000, log: (line) => logs.push(line) })
      expect(existsSync(path.join(root, 'var', 'tmp', 'dsh-tier-mid.yml'))).toBe(false)
      expect(logs.some((line) => line.includes('mid overlay 未挂载'))).toBe(true)
      expect(logs.some((line) => line.includes('无 models 段'))).toBe(true)
    } finally {
      ledger.close()
    }
  })
})
