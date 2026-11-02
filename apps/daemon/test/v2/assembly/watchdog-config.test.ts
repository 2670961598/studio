/**
 * watchdog-config —— stallAfterMs 按 executor 分级配置面（studio-dev-505）
 *
 * 依据（实现单引用）：docs/02-F1-08 看门狗三道（daemon 侧兜底阈值可配）；
 * docs/17-§4 配置体系（全部外置、坏配拒启）；docs/v2/07-§三 EXEC-01（看护参数）。
 *
 * 断言面：①缺省不配=undefined（回退 stallAfterMs=3600000，旧世界零漂移）；
 * ②合法表解析（;/,/空白分隔）；③坏段/坏键/重复键/非正整数 → 拒启（fail-closed，
 * 不静默忽略、不取整）；④runtime 投影缺省不注入键（字节不变）。
 */
import { describe, expect, it } from 'vitest'
import { parseDaemonConfig } from '../../../src/assembly/serve.ts'
import { parseStallAfterMsByExecutor, stallServeOverrides } from '../../../src/assembly/serve/watchdog-config.ts'

const BASE_YAML = ['db: ./x.sqlite', 'company: demo', 'platform: localfile'].join('\n')

describe('stallAfterMsByExecutor 解析（studio-dev-505）', () => {
  it('缺省不配=undefined；stallAfterMs 缺省值仍为 3600000', () => {
    const cfg = parseDaemonConfig(BASE_YAML)
    expect(cfg.stallAfterMsByExecutor).toBeUndefined()
    expect(cfg.stallAfterMs).toBe(3_600_000)
  })

  it('合法表：;/,/空白分隔均可，值=正整数 ms', () => {
    const a = parseStallAfterMsByExecutor('dsh-mid=5400000;dsh-high=7200000')
    expect(a).toEqual({ 'dsh-mid': 5_400_000, 'dsh-high': 7_200_000 })
    const b = parseStallAfterMsByExecutor(' dsh-mid = 5400000 , dsh-low=1800000 ')
    expect(b).toEqual({ 'dsh-mid': 5_400_000, 'dsh-low': 1_800_000 })
  })

  it('daemon.yaml 装载：配了即进 ServeConfig（坏配在装载期抛错拒启）', () => {
    const cfg = parseDaemonConfig(`${BASE_YAML}\nstallAfterMsByExecutor: dsh-mid=5400000;dsh-high=7200000`)
    expect(cfg.stallAfterMsByExecutor).toEqual({ 'dsh-mid': 5_400_000, 'dsh-high': 7_200_000 })
  })

  it.each([
    ['空串', ''],
    ['缺等号', 'dsh-mid'],
    ['空 executor', '=5400000'],
    ['空值', 'dsh-mid='],
    ['非数字值', 'dsh-mid=1h'],
    ['零值', 'dsh-mid=0'],
    ['负值', 'dsh-mid=-1'],
    ['小数', 'dsh-mid=1.5'],
    ['重复键', 'dsh-mid=1;dsh-mid=2'],
    ['路径穿越键', '../x=1'],
  ])('坏配 %s → 抛错（fail-closed）', (_label, spec) => {
    expect(() => parseStallAfterMsByExecutor(spec)).toThrow(/stallAfterMsByExecutor/)
  })

  it('daemon.yaml 坏配 → 装载拒启（不静默回退缺省）', () => {
    expect(() => parseDaemonConfig(`${BASE_YAML}\nstallAfterMsByExecutor: dsh-mid=1h`)).toThrow(/stallAfterMsByExecutor/)
  })
})

describe('serve → engine 阈值投影（runtime 装配单一出口）', () => {
  it('未配分级表：不注入键（旧世界字节不变）', () => {
    const out = stallServeOverrides({ stallAfterMs: 3_600_000, stallKillAfterAlarms: 2 })
    expect(out).toEqual({ stallAfterMs: 3_600_000, stallKillAfterAlarms: 2 })
    expect('stallAfterMsByExecutor' in out).toBe(false)
  })

  it('配了分级表：整表投影', () => {
    const out = stallServeOverrides({ stallAfterMs: 3_600_000, stallKillAfterAlarms: 2, stallAfterMsByExecutor: { 'dsh-mid': 5_400_000 } })
    expect(out.stallAfterMsByExecutor).toEqual({ 'dsh-mid': 5_400_000 })
  })
})
