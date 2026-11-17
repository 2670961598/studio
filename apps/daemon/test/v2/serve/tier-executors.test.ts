/** task-100：tierExecutors 跨家族档位映射 + 配置校验；缺省/未注册回退零漂移。 */
import { describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import { createFakeAdapter } from '../../../src/engine/fakes.ts'
import { modelTierDispatchFace } from '../../../src/engine/tier/model-tier.ts'
import { parseDaemonConfig } from '../../../src/assembly/serve/config.ts'

const BASE = ['db: /tmp/x/var/ledger.sqlite', 'platform: localfile', 'company: demo', 'rootDir: /tmp/x/var', 'jobs: false'].join('\n')
function registry(): ReturnType<typeof createRegistry> {
  const r = createRegistry()
  r.register(createFakeAdapter({ name: 'dsh' }), { default: true })
  r.register(createFakeAdapter({ name: 'kimi' }))
  return r
}

describe('task-100 tierExecutors', () => {
  it('配置 high:kimi → 档位面选 kimi 且 note 标配置；mid 未配回退 dsh 家族', () => {
    const r = registry()
    const fallback = r.resolve('dsh')
    const high = modelTierDispatchFace(r, 'high', fallback, 'kimi')
    expect(high.adapter.name).toBe('kimi')
    expect(high.noteAnchor).toContain('tier=high@kimi')
    expect(high.noteAnchor).toContain('tierExecutors 配置')
    const mid = modelTierDispatchFace(r, 'mid', fallback)
    expect(mid.adapter.name).toBe('dsh')
    expect(mid.noteAnchor).toContain('tier=mid@dsh')
  })

  it('配置未注册执行器/缺失 → 回退现逻辑（零漂移）', () => {
    const r = registry()
    const fallback = r.resolve('dsh')
    const missing = modelTierDispatchFace(r, 'high', fallback, 'claude')
    expect(missing.adapter.name).toBe('dsh')
    expect(missing.noteAnchor).toContain('tier=high@dsh')
    expect(modelTierDispatchFace(r, 'high', fallback, 'dsh-judge').adapter.name).toBe('dsh')
  })

  it('daemon.yaml tierExecutors 解析：合法 JSON/非法 executor/非法档位拒启', () => {
    const cfg = parseDaemonConfig(`${BASE}\ntierExecutors: '{"high":"kimi","mid":"dsh","low":"dsh"}'`)
    expect(cfg.tierExecutors).toEqual({ high: 'kimi', mid: 'dsh', low: 'dsh' })
    expect(() => parseDaemonConfig(`${BASE}\ntierExecutors: '{"high":"nope"}'`)).toThrow(/ENU-88/)
    expect(() => parseDaemonConfig(`${BASE}\ntierExecutors: '{"ultra":"kimi"}'`)).toThrow(/high\|mid\|low/)
    expect(() => parseDaemonConfig(`${BASE}\ntierExecutors: 'not-json'`)).toThrow(/JSON/)
  })
})
