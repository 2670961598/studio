/**
 * 模型多源路由 V2 套件（task-51 MVP；纯 parser/router 面）
 *
 * 覆盖：models.yaml sources[] 旧单源兼容/归一/混写拒收；优先级选择；预算预检 HOLD；
 * 429/5xx 冷却+跳过+half-open 恢复；400 不换源；全失败可读；状态序列化保守重置。
 * 注：dispatch/executor 注入与真机 E2E 属本单后续切片（当前 patch 仅核心选择面）。
 */
import { describe, expect, it } from 'vitest'
import { parseModelsYaml, modelSourcesOf, type ModelSourceSpec } from '@studio-next/core'
import {
  COOLDOWN_DEFAULTS,
  classifyFailure,
  deserializeRoutingState,
  emptyRoutingState,
  estimateSourceCost,
  isFailoverClass,
  recordSourceFailure,
  recordSourceSuccess,
  selectModelSource,
  serializeRoutingState,
} from '../../../src/engine/routing/router.ts'

const LEGACY = `
tiers:
  high: {provider: glm, model: GLM-5.3, price: {inputPerM: 1.1111, outputPerM: 3.8889, cacheReadPerM: 0.2778}}
  mid: {provider: glm, model: GLM-5.3, price: {inputPerM: 1.1111, outputPerM: 3.8889}}
  low: {provider: glm, model: GLM-5.3-Flash, price: {inputPerM: 0.1111, outputPerM: 0.3889}}
roles: {main_worker: mid}
`
const MULTI = `
tiers:
  high:
    sources:
      - id: glu
        provider: glm
        model: GLM-5.3
        priority: 10
        price: {inputPerM: 1, outputPerM: 2}
        cooldown: {baseMs: 60000, maxMs: 600000, circuitAfter: 2}
      - id: kimi
        provider: opencode-go
        model: kimi-k3.1-pro
        priority: 20
        price: {inputPerM: 2, outputPerM: 10, cacheReadPerM: 0.2}
        enabled: true
  mid:
    sources:
      - id: mid-glm
        provider: glm
        model: GLM-5.3
        price: {inputPerM: 1.1111, outputPerM: 3.8889}
  low:
    provider: glm
    model: GLM-5.3-Flash
    price: {inputPerM: 0.1111, outputPerM: 0.3889}
roles: {main_worker: mid, verifier: high}
`
const SOURCES: ModelSourceSpec[] = [
  { id: 'a', provider: 'glm', model: 'GLM-5.3', priority: 10, price: { inputPerM: 1, outputPerM: 2 }, cooldown: { baseMs: 60_000, maxMs: 600_000, circuitAfter: 2 } },
  { id: 'b', provider: 'opencode-go', model: 'kimi-k3.1-pro', priority: 20, price: { inputPerM: 2, outputPerM: 10 } },
]
const TOKENS = { input: 1_000_000, output: 100_000 }

describe('models.yaml sources 解析/兼容', () => {
  it('旧单源严格兼容、归一 id=default/priority=0；sources[] 归一 priority/首源派生旧三键', () => {
    const legacy = parseModelsYaml(LEGACY)
    expect(legacy.sources).toBeUndefined()
    expect(modelSourcesOf(legacy, 'high')).toEqual([{ id: 'default', provider: 'glm', model: 'GLM-5.3', priority: 0, price: { inputPerM: 1.1111, outputPerM: 3.8889, cacheReadPerM: 0.2778 } }])
    const multi = parseModelsYaml(MULTI)
    expect(multi.sources?.high?.map((s) => s.id)).toEqual(['glu', 'kimi'])
    expect(multi.sources?.high?.[1]?.priority).toBe(20)
    expect(multi.tiers.high).toEqual({ provider: 'glm', model: 'GLM-5.3', price: { inputPerM: 1, outputPerM: 2 } })
    expect(multi.tiers.low.provider).toBe('glm') // 混合档：低档仍旧单源
  })
  it('同档混写/重复 source id/缺价 → CONFIG_INVALID', () => {
    expect(() => parseModelsYaml(LEGACY.replace('high: {provider: glm, model: GLM-5.3, price: {inputPerM: 1.1111, outputPerM: 3.8889, cacheReadPerM: 0.2778}}', 'high: {provider: glm, model: GLM-5.3, price: {inputPerM: 1, outputPerM: 2}, sources: [{id: x, provider: glm, model: m, price: {inputPerM: 1, outputPerM: 2}}]}'))).toThrow(/二选一|sources/)
    expect(() => parseModelsYaml(MULTI.replace('id: kimi', 'id: glu'))).toThrow(/重复/)
  })
})

describe('优先级/预算/冷却', () => {
  it('优先级选择；预算超任务/公司剩余 → BUDGET_EXCEEDED HOLD（不静默降档）', () => {
    const base = { tier: 'high' as const, sources: SOURCES, now: 1_000, tokens: TOKENS }
    const first = selectModelSource({ ...base, state: emptyRoutingState() })
    expect(first.ok && first.source.id).toBe('a')
    expect(first.ok && first.estimatedUsd).toBeCloseTo(1.2)
    const overTicket = selectModelSource({ ...base, state: emptyRoutingState(), budget: { ticketRemainingUsd: 1.0 } })
    expect(overTicket).toMatchObject({ ok: false, reason: 'BUDGET_EXCEEDED', source: { id: 'a' } })
    const overCompany = selectModelSource({ ...base, state: emptyRoutingState(), budget: { companyRemainingUsd: 0.5 } })
    expect(overCompany).toMatchObject({ ok: false, reason: 'BUDGET_EXCEEDED' })
    // 显式允许降档才继续找更便宜/后续源
    const downgrade = selectModelSource({ ...base, state: emptyRoutingState(), budget: { ticketRemainingUsd: 2.5, allowBudgetDowngrade: true } })
    expect(downgrade.ok).toBe(true)
  })
  it('429 冷却跳过、half-open 到期恢复；400 不冷却且不换源', () => {
    const now = 1_000
    const selected = selectModelSource({ tier: 'high', sources: SOURCES, state: emptyRoutingState(), now, tokens: TOKENS })
    expect(selected.ok).toBe(true)
    if (!selected.ok) return
    const fail = recordSourceFailure(emptyRoutingState(), SOURCES[0]!, { status: 429 }, now, 120_000)
    expect(fail.class).toBe('quota')
    expect(fail.cooldownMs).toBe(120_000)
    const second = selectModelSource({ tier: 'high', sources: SOURCES, state: fail.state, now: now + 1, tokens: TOKENS })
    expect(second.ok && second.source.id).toBe('b')
    // 到期 half-open 选择 a（调用方每 half-open 失败会继续冷却）
    const recovered = selectModelSource({ tier: 'high', sources: SOURCES, state: fail.state, now: now + 120_001, tokens: TOKENS })
    expect(recovered.ok && recovered.source.id).toBe('a')
    expect(recovered.ok && recovered.halfOpen).toBe(true)
    const success = recordSourceSuccess(fail.state, SOURCES[0]!, now + 120_001)
    expect(success['a']?.cooldownUntil).toBe(0)
    // 400 不进入 failover 类/不设冷却
    const bad = recordSourceFailure(emptyRoutingState(), SOURCES[0]!, { status: 400 }, now)
    expect(isFailoverClass(bad.class)).toBe(false)
    expect(bad.cooldownMs).toBe(0)
  })
  it('F1 失败分类：408→timeout、ECONNREFUSED/ENOTFOUND→network（均换源）；真 400/refusal 不换源', () => {
    const cases: Array<[unknown, string, boolean]> = [
      [{ status: 408 }, 'timeout', true],
      [{ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:443' }, 'network', true],
      [{ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND api.example' }, 'network', true],
      [{ code: 'EAI_AGAIN' }, 'network', true],
      [{ status: 400, message: 'bad request' }, 'bad_request', false],
      [{ status: 400, message: 'safety refusal by upstream' }, 'refusal', false],
    ]
    for (const [err, cls, failover] of cases) {
      expect(classifyFailure(err)).toBe(cls)
      const rec = recordSourceFailure(emptyRoutingState(), SOURCES[0]!, err, 1_000)
      expect(rec.class).toBe(cls)
      expect(isFailoverClass(rec.class)).toBe(failover)
      if (!failover) expect(rec.cooldownMs).toBe(0)
    }
    expect(classifyFailure({ status: 500 })).toBe('server')
    expect(classifyFailure({ status: 401 })).toBe('auth')
  })
  it('F2 冷却缺省：429/quota 15m/8d、5xx 1m/10m、其余 60s/8h（可配）', () => {
    expect(COOLDOWN_DEFAULTS.quota).toEqual({ baseMs: 15 * 60_000, maxMs: 8 * 24 * 60 * 60_000 })
    expect(COOLDOWN_DEFAULTS.server).toEqual({ baseMs: 60_000, maxMs: 10 * 60_000 })
    expect(COOLDOWN_DEFAULTS.general).toEqual({ baseMs: 60_000, maxMs: 8 * 60 * 60_000 })
    const plain = { id: 'plain', provider: 'glm', model: 'GLM-5.3', priority: 0, price: { inputPerM: 1, outputPerM: 2 } }
    const quota = recordSourceFailure(emptyRoutingState(), plain, { status: 429 }, 1_000)
    expect(quota.cooldownMs).toBe(15 * 60_000)
    const server = recordSourceFailure(emptyRoutingState(), plain, { status: 503 }, 1_000)
    expect(server.cooldownMs).toBe(60_000)
    const network = recordSourceFailure(emptyRoutingState(), plain, { code: 'ENOTFOUND' }, 1_000)
    expect(network.cooldownMs).toBe(60_000)
    // 源显式 cooldown 仍可覆盖
    const custom = { ...SOURCES[0]!, cooldown: { baseMs: 5_000, maxMs: 20_000, circuitAfter: 2 } }
    expect(recordSourceFailure(emptyRoutingState(), custom, { status: 429 }, 1_000).cooldownMs).toBe(5_000)
  })
  it('全部冷却/禁用 → ALL_SOURCES_UNAVAILABLE 可读；状态序列化坏值保守重置', () => {
    const state = { a: { consecutiveFailures: 1, cooldownUntil: 9_999_999, halfOpen: false }, b: { consecutiveFailures: 0, cooldownUntil: 0, halfOpen: false } }
    const all = selectModelSource({ tier: 'high', sources: [SOURCES[0]!, { ...SOURCES[1]!, enabled: false }], state, now: 1_000, tokens: TOKENS })
    expect(all).toMatchObject({ ok: false, reason: 'ALL_SOURCES_UNAVAILABLE' })
    expect(JSON.parse(serializeRoutingState(state)).version).toBe(1)
    expect(deserializeRoutingState('{bad')).toEqual({})
    expect(deserializeRoutingState(serializeRoutingState(state))).toMatchObject({ a: { cooldownUntil: 9_999_999 } })
    expect(estimateSourceCost(SOURCES[1]!, TOKENS)).toBeCloseTo(3)
  })
})
