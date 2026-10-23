/**
 * serve —— hrMatrix 人事面注入契约（studio-dev-217，docs/52-§七/§九）。
 *
 * 断言面（buildServeRuntime 装配层——runServe opts.hrMatrixFace 透传到此）：
 *   1. hrSync+hrMatrix: true 且注入 hrMatrixFace → 装配通过（开而注入=正常启动）
 *   2. 开而未注入 → CONFIG_INVALID（「Matrix 人事面」明报——daemon 不强依赖
 *      @studio-next/matrix，装配单元 apps/boot 注入 createMatrixHrFace 产物）
 *   3. hrMatrix: false 时注入被忽略（开关面与装配面一致——零装配零注入行为零变）
 *
 * 注：本文件测装配契约不测 Matrix 网络行为（ensure 幂等归 packages/matrix hr-face
 * 测试；boot 侧 env/密钥面归 apps/boot boot.test）。fake face 零网络。
 */
import { writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CompanySnapshot } from '@studio-next/contract'
import { openLedger } from '@studio-next/store'
import { buildServeRuntime, type MatrixHrFace, type ServeConfig } from '../../src/assembly/serve.ts'

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

/** 最小 agent.yaml/models.yaml（装配面只需要可解析执行面，不 spawn） */
const AGENT_YAML = ['executors:', '  dsh-mid:', '    cmd: [dsh]', '    default: true'].join('\n')
const MODELS_YAML = [
  'tiers:',
  '  high: { provider: deepseek, model: deepseek-flash, price: { inputPerM: 0.27, outputPerM: 1.10 } }',
  '  mid: { provider: glm, model: GLM-5.3, price: { inputPerM: 0.50, outputPerM: 2.00 } }',
  '  low: { provider: glm, model: GLM-5.3-Flash, price: { inputPerM: 0.10, outputPerM: 0.40 } }',
  'roles:',
  '  main_worker: mid',
  '  verifier: low',
  '  micro_judge: low',
].join('\n')

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-serve-hrmatrix-'))
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
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
    // hr 面（studio-dev-217）：hrSync+hrMatrix 双开 + 房间面合法形
    hrSync: true,
    hrMatrix: true,
    hrMatrixRooms: 'company=#hall:studio.local;departments/工程部=#eng-hall:studio.local',
    ...over,
  }
}

/** 零网络 fake 人事面（结构同形 engine/hrsync MatrixHrFace——只验装配契约不验行为） */
const FAKE_HR_FACE: MatrixHrFace = {
  ensureAccount: async () => ({ userId: '@demo:studio.local', created: true }),
  ensureMembership: async () => {},
  ensurePowerLevel: async () => {},
  kickFromRoom: async () => {},
}

describe('buildServeRuntime hrMatrix 人事面装配契约（studio-dev-217）', () => {
  it('hrSync+hrMatrix: true + 注入 hrMatrixFace → 装配通过', () => {
    const cfg = cfgOf('hr-on')
    const ledger = openLedger(cfg.db)
    const runtime = buildServeRuntime(cfg, ledger, SNAPSHOT, {
      hrMatrixFace: (): MatrixHrFace => FAKE_HR_FACE,
      log: () => {},
    })
    expect(runtime.engine).toBeDefined()
    ledger.close()
  })

  it('开而未注入 → CONFIG_INVALID「Matrix 人事面」明报（拒启动）', () => {
    const cfg = cfgOf('hr-noface')
    const ledger = openLedger(cfg.db)
    expect(() => buildServeRuntime(cfg, ledger, SNAPSHOT, { log: () => {} })).toThrow(/Matrix 人事面/)
    ledger.close()
  })

  it('hrMatrix: false 时注入被忽略（开关面与装配面一致——零装配零变）', () => {
    const cfg = cfgOf('hr-off', { hrMatrix: false, hrMatrixRooms: undefined })
    const ledger = openLedger(cfg.db)
    const runtime = buildServeRuntime(cfg, ledger, SNAPSHOT, {
      hrMatrixFace: (): MatrixHrFace => FAKE_HR_FACE,
      log: () => {},
    })
    expect(runtime.engine).toBeDefined()
    ledger.close()
  })
})
