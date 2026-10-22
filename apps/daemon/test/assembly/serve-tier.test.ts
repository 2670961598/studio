/**
 * serve —— 模型档执行面装配（studio-dev-196）：daemon.yaml modelTierTickets 解析面 +
 * buildServeRuntime 装配面（resolver 组合 / overlay provisioning / 档位声明一致性闸）。
 *
 * 依据：docs/17-§4（models.yaml 三档+角色映射）；制作人 2026-10-22 三档定调
 * （DeepSeekFlash=大 / GLM-5.3=中 / GLM-5.3-Flash=小）；解析件 src/engine/model-tier.ts。
 *
 * 断言面：
 *   1. parseDaemonConfig：modelTierTickets 合法/空串装载；坏段/未知档/重复单号拒（fail-closed）
 *   2. buildServeRuntime + agent.yaml 三档位 + models.yaml：三 overlay 中 low/high 两文件
 *      落盘（mid=现役不生成）、注册日志点名档位、档执行面开日志
 *   3. agent.yaml+judge 位共存：judgeAwareResolver(tierAwareResolver()) 组合——
 *      `<family>-judge` 与 `<family>-<tier>` 两形态同时可装配
 *   4. 档位声明漂移（agent.yaml dsh-high 镜像 ≠ tiers.high）→ CONFIG_INVALID 启动拒
 * env 注入说明：无（dsh cmd 为假命令——装配面只构造适配器不 spawn；真实执行面归
 * probe-evidence 受控真跑，不进 CI）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CompanySnapshot } from '@studio-next/contract'
import { openLedger } from '@studio-next/store'
import { buildServeRuntime, parseDaemonConfig, type ServeConfig } from '../../src/assembly/serve.ts'

const SNAPSHOT: CompanySnapshot = {
  slug: 'demo',
  name: 'Demo 公司',
  level: 2,
  charter: 'charter.md',
  platform: { platform: 'localfile' },
  departments: [
    { name: '工程部', path: 'departments/工程部', parent: null, leader: 'AGENT-1', level: 2, lanes: ['core'], functions: ['交付'], relations: [] },
  ],
  people: [{ id: 'AGENT-1', name: '示例工程师', login: 'agent-1', level: 2, dept: 'departments/工程部' }],
  jobs: [],
}

/** 三档 agent.yaml（record 形；镜像=tiers 同源；dsh-mid 缺省 + low/high + judge 位共存） */
const AGENT_YAML = [
  'executors:',
  '  dsh-mid:',
  '    cmd: [dsh, --model, glm/GLM-5.3]',
  '    default: true',
  '    patches:',
  '      agent-default-model:',
  '        config:',
  '          provider: glm',
  '          model: GLM-5.3',
  '  dsh-low:',
  '    cmd: [dsh, --model, glm/GLM-5.3-Flash]',
  '    patches:',
  '      agent-default-model:',
  '        config:',
  '          provider: glm',
  '          model: GLM-5.3-Flash',
  '  dsh-high:',
  '    cmd: [dsh, --model, deepseek/deepseek-flash]',
  '    patches:',
  '      agent-default-model:',
  '        config:',
  '          provider: deepseek',
  '          model: deepseek-flash',
  '  dsh-judge:',
  '    cmd: [dsh, --model, glm/GLM-5.3-Flash]',
].join('\n')

/** models.yaml（制作人三档定调 + roles 最小集） */
const MODELS_YAML = [
  'tiers:',
  '  high:',
  '    provider: deepseek',
  '    model: deepseek-flash',
  '    price: { inputPerM: 0.27, outputPerM: 1.10 }',
  '  mid:',
  '    provider: glm',
  '    model: GLM-5.3',
  '    price: { inputPerM: 0.50, outputPerM: 2.00 }',
  '  low:',
  '    provider: glm',
  '    model: GLM-5.3-Flash',
  '    price: { inputPerM: 0.10, outputPerM: 0.40 }',
  'roles:',
  '  main_worker: mid',
  '  verifier: low',
  '  micro_judge: low', // judge 注册位在场时的启动闸（studio-dev-160 §6.4：判断调用恒低档）
].join('\n')

const BASE_YAML = ['db: ./x.sqlite', 'company: demo', 'platform: localfile'].join('\n')

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-serve-tier-'))
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('daemon.yaml modelTierTickets 配置面（studio-dev-196）', () => {
  it('缺省 undefined；合法对/空串装载', () => {
    expect(parseDaemonConfig(BASE_YAML).modelTierTickets).toBeUndefined()
    const cfg = parseDaemonConfig(`${BASE_YAML}\nmodelTierTickets: STUDIO-196-H=high;STUDIO-196-L=low`)
    expect(cfg.modelTierTickets).toBe('STUDIO-196-H=high;STUDIO-196-L=low')
  })

  it('坏段/未知档/重复单号 → 拒（fail-closed，不静默忽略段）', () => {
    expect(() => parseDaemonConfig(`${BASE_YAML}\nmodelTierTickets: T-1`)).toThrow(/modelTierTickets/)
    expect(() => parseDaemonConfig(`${BASE_YAML}\nmodelTierTickets: T-1=ultra`)).toThrow(/modelTierTickets/)
    expect(() => parseDaemonConfig(`${BASE_YAML}\nmodelTierTickets: T-1=high;T-1=low`)).toThrow(/modelTierTickets/)
  })
})

function cfgOf(id: string, over: Partial<ServeConfig> = {}): ServeConfig {
  const agentYaml = path.join(root, `${id}-agents.yaml`)
  const models = path.join(root, `${id}-models.yaml`)
  writeFileSync(agentYaml, AGENT_YAML, 'utf8')
  writeFileSync(models, MODELS_YAML, 'utf8')
  return {
    db: path.join(root, `${id}.sqlite`),
    platform: 'fake',
    company: SNAPSHOT.slug,
    rootDir: path.join(root, id),
    tickMs: 10,
    maxActionsPerTick: 4,
    maxInflight: 2,
    stallAfterMs: 60_000,
    stallKillAfterAlarms: 0,
    laneTtlMs: 30 * 60_000,
    breakerThreshold: 3,
    autoApprove: false,
    jobs: false,
    jobPollMs: 15_000,
    matrix: false,
    fileWatch: false,
    cadence: false,
    sla: false,
    reloadWatch: false,
    agentYaml,
    models,
    ...over,
  }
}

describe('buildServeRuntime 模型档装配面（studio-dev-196）', () => {
  it('三档位 + judge 位共存注册；low/high overlay 落盘（mid 不生成）；档面开日志', async () => {
    const ledger = openLedger(cfgOf('tier-ok').db)
    const logs: string[] = []
    const runtime = buildServeRuntime(cfgOf('tier-ok'), ledger, SNAPSHOT, { log: (l) => logs.push(l) })
    try {
      // resolver 组合：tier 位 + judge 位两形态同时可装配（judgeAwareResolver(tierAwareResolver())）
      const reg = logs.find((l) => l.includes('executor 注册')) ?? ''
      expect(reg).toContain('dsh-mid(default)')
      expect(reg).toContain('dsh-low')
      expect(reg).toContain('dsh-high')
      expect(reg).toContain('dsh-judge')
      // overlay：low/high 两文件、mid 不生成
      const dir = path.join(cfgOf('tier-ok').rootDir, 'tmp')
      const low = readFileSync(path.join(dir, 'dsh-tier-low.yml'), 'utf8')
      expect(low).toContain('provider: glm')
      expect(low).toContain('model: GLM-5.3-Flash')
      expect(readFileSync(path.join(dir, 'dsh-tier-high.yml'), 'utf8')).toContain('deepseek-flash')
      expect(existsSync(path.join(dir, 'dsh-tier-mid.yml'))).toBe(false)
      // 档面开日志（观测锚）
      expect(logs.some((l) => l.includes('模型档执行面开') && l.includes('tier→executor'))).toBe(true)
    } finally {
      await runtime.stop()
      try {
        ledger.close()
      } catch {
        // stop() 已收口 db 句柄（装配面所有权）——重复 close 吞掉
      }
    }
  })

  it('档位声明漂移（dsh-high 镜像≠tiers.high）→ CONFIG_INVALID 启动拒', () => {
    const base = cfgOf('tier-drift')
    const drifted = AGENT_YAML.replace('model: deepseek-flash', 'model: deepseek-v4-pro')
    writeFileSync(base.agentYaml as string, drifted, 'utf8')
    const ledger = openLedger(base.db)
    try {
      expect(() => buildServeRuntime(base, ledger, SNAPSHOT, { log: () => {} })).toThrow(/serve\/model-tier-drift/)
    } finally {
      ledger.close()
    }
  })
})
