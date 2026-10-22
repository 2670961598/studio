/**
 * daemon.yaml matrixChannels 频道供给配置面测试（130-P3，130 提案 §6.7.3-③）：
 *   - 缺省关（matrixChannels=false——零装配零注入，既有行为字节不变）
 *   - 开=交叉校验 fail-fast（matrixHomeserverUrl/matrixUserId/matrixDeptMap 必配；
 *     密码经 env MATRIX_BOT_PASSWORD，不入 yaml——同 matrix 源先例）
 *   - 只开供给不开唤醒源（matrixChannels: true + matrix: false）= 合法形态
 *   - matrixProducerMxid 可选装载
 *   - buildServeRuntime 工厂注入面：开而无工厂 → CONFIG_INVALID；开而有工厂 →
 *     启动期 ensure 八类地图（fire-and-forget 报告面落日志）；关=工厂不被调用
 * daemon 不 import @studio-next/matrix（25-§一.2 依赖方向冻结）——工厂=结构同形替身。
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CompanySnapshot } from '@studio-next/contract'
import { openLedger } from '@studio-next/store'
import { buildServeRuntime, parseDaemonConfig, type ServeConfig } from '../../src/assembly/serve.ts'
import type { MatrixRoomFace, MatrixRoomFaceContext } from '../../src/engine/rooms/room-duty.ts'

const BASE_YAML = ['db: ./x.sqlite', 'company: demo', 'platform: localfile'].join('\n')
const CHANNELS_YAML = [
  BASE_YAML,
  'matrixChannels: true',
  'matrixHomeserverUrl: http://localhost:8008',
  'matrixUserId: "@studionext-bot:localhost"',
  'matrixDeptMap: /etc/studio-next/dept-map.json',
].join('\n')

// ————————————————————————— 配置解析与交叉校验 —————————————————————————

describe('daemon.yaml matrixChannels 配置面（130-P3）', () => {
  it('缺省：matrixChannels=false、matrixDeptMap/matrixProducerMxid 缺席（零行为变更）', () => {
    const cfg = parseDaemonConfig(BASE_YAML)
    expect(cfg.matrixChannels).toBe(false)
    expect(cfg.matrixDeptMap).toBeUndefined()
    expect(cfg.matrixProducerMxid).toBeUndefined()
  })

  it('matrixChannels: true 缺必配键 → fail-fast（逐键点名；密码只经 env 不入 yaml）', () => {
    expect(() => parseDaemonConfig(`${BASE_YAML}\nmatrixChannels: true`)).toThrow(
      /matrixChannels: true 缺必配键：matrixHomeserverUrl、matrixUserId、matrixDeptMap/,
    )
    expect(() => parseDaemonConfig(`${BASE_YAML}\nmatrixChannels: true\nmatrixHomeserverUrl: http://localhost:8008`)).toThrow(
      /缺必配键：matrixUserId、matrixDeptMap/,
    )
  })

  it('必配键齐 → 过闸；只开供给不开唤醒源（matrix: false）= 合法形态', () => {
    const cfg = parseDaemonConfig(CHANNELS_YAML)
    expect(cfg.matrixChannels).toBe(true)
    expect(cfg.matrix).toBe(false) // channels-only：矩阵频道先建、mention 源后开灰度
    expect(cfg.matrixDeptMap).toBe('/etc/studio-next/dept-map.json')
  })

  it('matrixProducerMxid 可选装载（缺省制作人缺席=供给面自兜底）', () => {
    const cfg = parseDaemonConfig(`${CHANNELS_YAML}\nmatrixProducerMxid: "@producer:localhost"`)
    expect(cfg.matrixProducerMxid).toBe('@producer:localhost')
  })

  it('matrixChannels 坏值拒绝（布尔闸）', () => {
    expect(() => parseDaemonConfig(`${BASE_YAML}\nmatrixChannels: yes-please`)).toThrow(/matrixChannels/)
  })
})

// ————————————————————————— buildServeRuntime 工厂注入面 —————————————————————————

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

let root = ''
const dirs: string[] = []

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-serve-channels-'))
  dirs.push(root)
})

afterAll(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })))
})

function cfgOf(id: string, over?: Partial<ServeConfig>): ServeConfig {
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
    ...over,
  }
}

const CHANNELS_ON: Partial<ServeConfig> = {
  matrixChannels: true,
  matrixHomeserverUrl: 'http://localhost:8008',
  matrixUserId: '@studionext-bot:localhost',
  matrixDeptMap: '/etc/studio-next/dept-map.json',
}

/** 微任务冲刷：fire-and-forget ensure 的报告面落日志（then 链排空） */
const flush = async (): Promise<void> => new Promise((r) => setImmediate(r))

describe('buildServeRuntime：供给面工厂注入（130-P3 §6.7.3）', () => {
  it('matrixChannels: true 无工厂 → CONFIG_INVALID（daemon 不强依赖 matrix——boot 组合根注入）', async () => {
    const ledger = openLedger(path.join(root, 'no-factory.sqlite'))
    expect(() => buildServeRuntime(cfgOf('no-factory', CHANNELS_ON), ledger, SNAPSHOT, { log: () => {} })).toThrow(
      /CONFIG_INVALID：matrixChannels: true 需注入频道供给面工厂/,
    )
    ledger.close()
  })

  it('开而有工厂：工厂收 ctx.snapshot（活取热重载面）＋启动期 ensure 八类地图（报告面落日志）', async () => {
    const ledger = openLedger(path.join(root, 'with-factory.sqlite'))
    const logs: string[] = []
    const seenCtx: MatrixRoomFaceContext[] = []
    let ensureCalls = 0
    const face: MatrixRoomFace = {
      async ensureCompanyChannels(): Promise<{ ensured: number; created: number; problems: string[]; failures: string[] }> {
        ensureCalls += 1
        return { ensured: 8, created: 0, problems: [], failures: [] }
      },
      async onDispatched(): Promise<void> {},
      async onClosed(): Promise<void> {},
    }
    const runtime = buildServeRuntime(cfgOf('with-factory', CHANNELS_ON), ledger, SNAPSHOT, {
      log: (l) => logs.push(l),
      matrixRoomFace: (ctx) => {
        seenCtx.push(ctx)
        return face
      },
    })
    try {
      expect(seenCtx).toHaveLength(1) // 装配期一次调用
      expect(seenCtx[0]?.snapshot()).toEqual(SNAPSHOT) // ctx.snapshot 活取=此刻盘面
      await flush()
      expect(ensureCalls).toBe(1) // 启动期 ensure（fire-and-forget 已排空）
      expect(logs.some((l) => l.includes('matrix 频道供给') && l.includes('确保 8 房'))).toBe(true)
      const report = await runtime.engine.tick() // 主循环照常——供给不阻启动
      expect(report.errors).toEqual([])
    } finally {
      await runtime.stop()
    }
  })

  it('供给异常（ensure 整体 reject）→ 日志明报不阻主循环（沟通面非执行前置）', async () => {
    const ledger = openLedger(path.join(root, 'ensure-reject.sqlite'))
    const logs: string[] = []
    const face: MatrixRoomFace = {
      async ensureCompanyChannels(): Promise<{ ensured: number; created: number; problems: string[]; failures: string[] }> {
        throw new Error('fake：断网')
      },
      async onDispatched(): Promise<void> {},
      async onClosed(): Promise<void> {},
    }
    const runtime = buildServeRuntime(cfgOf('ensure-reject', CHANNELS_ON), ledger, SNAPSHOT, {
      log: (l) => logs.push(l),
      matrixRoomFace: () => face,
    })
    try {
      await flush()
      expect(logs.some((l) => l.includes('matrix 频道供给异常') && l.includes('不阻主循环'))).toBe(true)
      const report = await runtime.engine.tick()
      expect(report.errors).toEqual([])
    } finally {
      await runtime.stop()
    }
  })

  it('matrixChannels 关=工厂不被调用（零装配零注入——回归锚）', async () => {
    const ledger = openLedger(path.join(root, 'channels-off.sqlite'))
    const logs: string[] = []
    let factoryCalls = 0
    const runtime = buildServeRuntime(cfgOf('channels-off'), ledger, SNAPSHOT, {
      log: (l) => logs.push(l),
      matrixRoomFace: () => {
        factoryCalls += 1
        throw new Error('不应被调用')
      },
    })
    try {
      expect(factoryCalls).toBe(0)
      await flush()
      expect(logs.some((l) => l.includes('频道供给'))).toBe(false)
      const report = await runtime.engine.tick()
      expect(report.errors).toEqual([])
    } finally {
      await runtime.stop()
    }
  })
})
