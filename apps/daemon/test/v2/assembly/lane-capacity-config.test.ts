/**
 * lane-capacity-config —— 泳道容量表配置面（LOCAL-329 泳道容量域）
 *
 * 依据（实现单引用）：docs/quality/lane-capacity.md §2（配置：daemon.yaml `laneCapacity`
 * JSON 字符串对象，缺省 {}＝全泳道容量 1）；docs/17-§4 配置体系（全部外置、坏配拒启）；
 * 2026-11-03 #488 泳道容量域落单（2026-11-24 事故根因＝单持有者模型）。
 *
 * 断言面：①缺省不配={}（全泳道容量 1，既有部署字节不变——回滚面）；②合法 JSON 对象
 * 解析（YAML 值双/单引号均可——parseScalar 剥外层引号）；③坏值 fail-closed 拒启
 * （非 JSON/非对象/空泳道名/非整数/越界 1..8——CONFIG_INVALID，与 tierExecutors 同款）；
 * ④serve → engine 投影：缺省不注入键；配了即透传（createLaneRegistry 收口）。
 */
import { describe, expect, it } from 'vitest'
import { buildServeEngineConfig } from '../../../src/assembly/serve/engine-config.ts'
import { parseDaemonConfig } from '../../../src/assembly/serve.ts'
import { ENGINE_CONFIG_DEFAULTS } from '../../../src/engine/engine.ts'
import { LANE_CAPACITY_MAX, parseLaneCapacity } from '../../../src/engine/lanes/registry.ts'

const BASE_YAML = ['db: ./x.sqlite', 'company: demo', 'platform: localfile'].join('\n')

/** buildServeEngineConfig 最小入参（零 IO——容量投影只读 config） */
function engineConfigOf(config: ReturnType<typeof parseDaemonConfig>) {
  return buildServeEngineConfig({
    config,
    snapshot: {
      slug: 'demo',
      name: 'Demo',
      level: 2,
      charter: 'charter.md',
      platform: { platform: 'localfile' },
      departments: [{ name: '工程部', path: 'departments/工程部', parent: null, leader: 'AGENT-1', level: 2, lanes: ['core'], functions: ['交付'], relations: [] }],
      people: [{ id: 'AGENT-1', name: '示例工程师', login: 'agent-1', level: 2, dept: 'departments/工程部' }],
      jobs: [],
    },
    aiwsRoot: '/tmp/aiws',
    dataChangeRoutes: undefined,
    modelRoles: undefined,
    modelTierTickets: undefined,
    acceptance: [],
    typeFlows: undefined,
    evidenceExportGuard: (text) => text,
  })
}

describe('laneCapacity 解析即验（LOCAL-329；坏值＝启动拒 fail-closed）', () => {
  it('缺省不配＝{}（全泳道容量 1——既有部署零行为变，回滚面）', () => {
    const cfg = parseDaemonConfig(BASE_YAML)
    expect(cfg.laneCapacity).toEqual({})
    expect(engineConfigOf(cfg).laneCapacity).toEqual({}) // 空表透传＝registry 全泳道容量 1
  })

  it('合法 JSON 对象装载（YAML 值双引号/单引号均可）', () => {
    const cfg = parseDaemonConfig(`${BASE_YAML}\nlaneCapacity: '{"core":4,"qa":2,"ops":2}'`)
    expect(cfg.laneCapacity).toEqual({ core: 4, qa: 2, ops: 2 })
    const cfg2 = parseDaemonConfig(`${BASE_YAML}\nlaneCapacity: '{"core":1}'`)
    expect(cfg2.laneCapacity).toEqual({ core: 1 })
  })

  it('空对象＝空表（显式 {} 与缺省同义）', () => {
    expect(parseLaneCapacity('')).toEqual({})
    expect(parseLaneCapacity('{}')).toEqual({})
  })

  it.each([
    ['非 JSON', 'core=4'],
    ['JSON 数组', '["core",4]'],
    ['JSON 字符串', '"core"'],
    ['JSON 数字', '4'],
    ['JSON null', 'null'],
    ['空泳道名', '{"":4}'],
    ['空白泳道名', '{" ":4}'],
    ['零值', '{"core":0}'],
    ['负值', '{"core":-1}'],
    ['小数', '{"core":1.5}'],
    ['字符串值', '{"core":"4"}'],
    ['超上限', `{"core":${LANE_CAPACITY_MAX + 1}}`],
  ])('坏配 %s → 抛错（fail-closed 不取整不静默）', (_label, spec) => {
    expect(() => parseLaneCapacity(spec)).toThrow(/laneCapacity/)
  })

  it('daemon.yaml 坏配 → 装载拒启（CONFIG_INVALID 面不静默回退缺省）', () => {
    expect(() => parseDaemonConfig(`${BASE_YAML}\nlaneCapacity: '{"core":9}'`)).toThrow(/laneCapacity/)
    expect(() => parseDaemonConfig(`${BASE_YAML}\nlaneCapacity: not-json`)).toThrow(/laneCapacity/)
  })
})

describe('serve → engine 泳道容量投影（LOCAL-329 L4：配置+重启即启用/回滚）', () => {
  it('配了即透传 buildServeEngineConfig（registry 构造收口）', () => {
    const cfg = parseDaemonConfig(`${BASE_YAML}\nlaneCapacity: '{"core":4,"qa":2}'`)
    const engineConfig = engineConfigOf(cfg)
    expect(engineConfig.laneCapacity).toEqual({ core: 4, qa: 2 })
    // 其余引擎缺省面不被扰动
    expect(engineConfig.laneTtlMs).toBe(ENGINE_CONFIG_DEFAULTS.laneTtlMs)
  })

  it('边界值：1（单持有者）与 LANE_CAPACITY_MAX（8）均合法', () => {
    const cfg = parseDaemonConfig(`${BASE_YAML}\nlaneCapacity: '{"core":1,"qa":${LANE_CAPACITY_MAX}}'`)
    expect(cfg.laneCapacity).toEqual({ core: 1, qa: LANE_CAPACITY_MAX })
  })
})
