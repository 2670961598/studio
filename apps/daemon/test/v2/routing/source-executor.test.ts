/**
 * task-141：模型源 per-source executor 解析面（engine/routing/source-executor.ts）V2 套件
 *
 * 依据：docs/quality/model-routing.md §10（源 executor 与跨执行器换源）、
 * docs/quality/tier-executors.md「选择链登记面」（放行集合=tierExecutors ∪ 本档 sources executor）。
 *
 * 断言面（纯函数，fake 适配器——不真调任何执行器）：
 *   ① 家族集合：显式 executor 归一为家族；**按派发档位取、不跨档**；缺省/值域外名不入集合；
 *      无配置=空集（零漂移）。
 *   ② 登记校验：未登记名出问题行（serve 启动/热切共用判据）；已登记/缺省 executor 零问题。
 *   ③ 解析：显式 executor=registry 指名；缺省=档位候选原样（身份不变）；未登记=err 可读。
 *   ④ 续跑对账：同族=续跑位优先；跨族=不强行续跑（降级新派锚，因果链不断）；无面=原样。
 *   ⑤ 审计锚与健康行：`<id>@<executor>`/`<id>`；可选键缺省不出现、既有键口径不变。
 *   ⑥ 同族判定：familyOfExecutorName 归一（dsh/dsh-high 同族）；值域外名按注册名自比。
 */
import { describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import { modelSourcesOf, parseModelsYaml } from '@studio-next/core'
import { createFakeAdapter } from '../../../src/engine/fakes.ts'
import {
  adapterForSource,
  reconcileSourceResume,
  routingHealthRow,
  sameExecutorFamily,
  sourceExecutorFamilies,
  sourceExecutorIssues,
  sourceRef,
} from '../../../src/engine/routing/source-executor.ts'

const MODELS_YAML = `tiers:
  high:
    sources:
      - {id: a, provider: glm, model: GLM-5.3, price: {inputPerM: 1, outputPerM: 2}, executor: agy}
      - {id: b, provider: opencode-go, model: kimi-k3.1-pro, price: {inputPerM: 2, outputPerM: 10}}
  mid:
    sources:
      - {id: c, provider: glm, model: GLM-5.3, price: {inputPerM: 1, outputPerM: 2}, executor: dsh-high}
      - {id: d, provider: custom, model: x, price: {inputPerM: 1, outputPerM: 2}, executor: fake}
  low: {provider: glm, model: GLM-5.3-Flash, price: {inputPerM: 0.1, outputPerM: 0.4}}
roles: {main_worker: high}
`
const models = parseModelsYaml(MODELS_YAML)
const plan = { high: modelSourcesOf(models, 'high'), mid: modelSourcesOf(models, 'mid') }
const [a, b] = plan.high
const [c] = plan.mid

function registryOf(...names: string[]): ReturnType<typeof createRegistry> {
  const registry = createRegistry()
  for (const name of names) registry.register(createFakeAdapter({ name }), names.indexOf(name) === 0 ? { default: true } : {})
  return registry
}

describe('task-141 源 executor 家族集合（选择闸放行集合扩展）', () => {
  it('显式 executor 归一为家族（含档位位名 dsh-high→dsh）；按派发档位取不跨档；值域外名（fake）不入；无配置=空集', () => {
    expect(a?.executor).toBe('agy')
    expect(b?.executor).toBeUndefined()
    expect([...sourceExecutorFamilies(plan.high)]).toEqual(['agy'])
    expect([...sourceExecutorFamilies(plan.mid)]).toEqual(['dsh']) // high 的 agy 不随 mid 档放行
    expect(sourceExecutorFamilies([b!])).toEqual(new Set())
    expect(sourceExecutorFamilies(undefined).size).toBe(0)
  })

  it('同族判定：dsh/dsh-high 同族；dsh/kimi 异族；值域外名按注册名自比', () => {
    expect(sameExecutorFamily(createFakeAdapter({ name: 'dsh' }), createFakeAdapter({ name: 'dsh-high' }))).toBe(true)
    expect(sameExecutorFamily(createFakeAdapter({ name: 'dsh' }), createFakeAdapter({ name: 'kimi' }))).toBe(false)
    expect(sameExecutorFamily(createFakeAdapter({ name: 'fake' }), createFakeAdapter({ name: 'fake' }))).toBe(true)
    expect(sameExecutorFamily(createFakeAdapter({ name: 'fake' }), createFakeAdapter({ name: 'other' }))).toBe(false)
  })
})

describe('task-141 源 executor 登记校验（serve 启动 / 热切共用判据）', () => {
  it('未登记名出问题行（档位/源 id/名/已登记清单）；已登记与缺省 executor 零问题', () => {
    const issues = sourceExecutorIssues(plan, ['dsh', 'dsh-high', 'fake'])
    expect(issues).toEqual(['high/sources[a].executor=agy 未登记（已登记：dsh、dsh-high、fake）'])
    expect(sourceExecutorIssues(plan, ['agy', 'dsh-high', 'fake'])).toEqual([])
  })

  it('无 executor 配置=零问题（注册表空也不误报）；注册表空时清单段=无', () => {
    expect(sourceExecutorIssues({ high: [b!] }, [])).toEqual([])
    expect(sourceExecutorIssues({ high: [a!] }, [])).toEqual(['high/sources[a].executor=agy 未登记（已登记：无）'])
    expect(sourceExecutorIssues(undefined, ['dsh'])).toEqual([])
  })
})

describe('task-141 源 → 适配器解析（缺省回退档位既有候选）', () => {
  it('显式 executor=registry.resolve 指名实例；缺省 executor=档位候选身份原样（零漂移）', () => {
    const registry = registryOf('dsh', 'agy')
    const tierCandidate = registry.resolve('dsh')
    const picked = adapterForSource(a!, registry, tierCandidate)
    expect(picked.kind === 'ok' ? picked.value.name : '').toBe('agy')
    const fallback = adapterForSource(b!, registry, tierCandidate)
    expect(fallback.kind === 'ok' ? fallback.value : undefined).toBe(tierCandidate) // 身份原样（同实例，不重解析）
  })

  it('未登记 executor=err（可读：源 id/executor 名/已登记清单），不静默回落候选', () => {
    const registry = registryOf('dsh')
    const picked = adapterForSource(a!, registry, registry.resolve('dsh'))
    expect(picked).toEqual({ kind: 'err', error: '源 a 的 executor=agy 未在注册表登记（已登记：dsh）' })
  })
})

describe('task-141 续跑面 × 源 executor 对账（跨执行器不强行续跑）', () => {
  const face = (adapterName: string, active = true) => ({
    active,
    adapter: createFakeAdapter({ name: adapterName }),
    noteAnchor: `;resume=s1@${adapterName}（续自第 1 誓）`,
    detailSegment: `;resume=s1@${adapterName}（续自第 1 誓，F1-15）`,
    causationId: 'WRK-PREV',
  })

  it('无续跑面 → 源 executor 位原样（face 缺席、不锁）', () => {
    const next = createFakeAdapter({ name: 'agy' })
    expect(reconcileSourceResume(undefined, a!, next)).toEqual({ adapter: next, face: undefined, resumeLocked: false })
  })

  it('同族（续跑位 dsh-high × 源 executor dsh）→ 续跑位优先、面原对象、上锁', () => {
    const resume = face('dsh-high')
    const next = createFakeAdapter({ name: 'dsh' })
    const out = reconcileSourceResume(resume, c!, next)
    expect(out.adapter).toBe(resume.adapter)
    expect(out.face).toBe(resume)
    expect(out.resumeLocked).toBe(true)
  })

  it('跨族（续跑位 dsh × 源 executor agy）→ 降级新派：锚明报、因果链仍挂上次工时单', () => {
    const out = reconcileSourceResume(face('dsh'), a!, createFakeAdapter({ name: 'agy' }))
    expect(out.adapter.name).toBe('agy')
    expect(out.resumeLocked).toBe(false)
    expect(out.face).toEqual({
      active: false,
      adapter: out.adapter,
      noteAnchor: ';resume=降级新派（路由源 a@agy 非续跑同族 dsh——task-141 跨执行器不强行续跑——F1-15）',
      detailSegment: ';resume=降级新派（路由源 a@agy 非续跑同族 dsh——task-141 跨执行器不强行续跑——F1-15）',
      causationId: 'WRK-PREV',
    })
  })

  it('已降级面（active=false）不再二次对账：源 executor 位原样', () => {
    const degraded = reconcileSourceResume(face('dsh'), a!, createFakeAdapter({ name: 'agy' })).face
    const next = createFakeAdapter({ name: 'dsh' })
    expect(reconcileSourceResume(degraded, c!, next)).toEqual({ adapter: next, face: degraded, resumeLocked: false })
  })
})

describe('task-141 审计锚与只读健康行', () => {
  it('源引用：显式 executor=<id>@<executor>；缺省=<id>（既有锚逐字节一致）', () => {
    expect(sourceRef(a!)).toBe('a@agy')
    expect(sourceRef(b!)).toBe('b')
  })

  it('健康行：常驻加法列 provider/model/priority/enabled；可选 executor/cooldown 缺省不出现；既有键口径不变', () => {
    const row = routingHealthRow('high', a!, { cooldownUntil: 2_000, lastFailureClass: 'quota' }, 1_000)
    expect(row).toEqual({
      tier: 'high',
      id: 'a',
      executor: 'agy',
      provider: 'glm',
      model: 'GLM-5.3',
      priority: 0,
      enabled: true,
      available: false,
      cooldownUntil: 2_000,
      lastFailureClass: 'quota',
    })
    const legacy = routingHealthRow('high', b!, undefined, 1_000)
    expect(legacy).toEqual({ tier: 'high', id: 'b', provider: 'opencode-go', model: 'kimi-k3.1-pro', priority: 1, enabled: true, available: true, cooldownUntil: 0 })
    expect('executor' in legacy).toBe(false)
    expect('cooldown' in legacy).toBe(false)
    expect(Object.keys(legacy)).toEqual(['tier', 'id', 'provider', 'model', 'priority', 'enabled', 'available', 'cooldownUntil'])
  })
})
