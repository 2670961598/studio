/**
 * B2 cache 价扩键（132-§6.1 单B，2026-11-10 制作人过审）V2 套件
 *
 * 链：models.yaml price.cacheReadPerM/cacheCreationPerM → PriceEntry（可选）→ estimateCost
 * 计 cache 桶；bridgePriceFor models-yaml 分支透传；foldCostUsd 有价即计价、unpricedBuckets 空。
 * 缺省键=旧行为零变（回归）。
 */
import { describe, expect, it } from 'vitest'
import { createModelCatalog, parseModelsYaml } from '../../src/models.ts'
import { bridgePriceFor, foldCostUsd, type UnitPrice } from '../../src/pricing.ts'

const MODELS_CACHE = `
tiers:
  high: {provider: glm, model: GLM-5.3, price: {inputPerM: 1.1111, outputPerM: 3.8889, cacheReadPerM: 0.2778, cacheCreationPerM: 0}}
  mid: {provider: glm, model: GLM-5.3, price: {inputPerM: 1.1111, outputPerM: 3.8889, cacheReadPerM: 0.2778, cacheCreationPerM: 0}}
  low: {provider: glm, model: GLM-5.3, price: {inputPerM: 1.1111, outputPerM: 3.8889, cacheReadPerM: 0.2778, cacheCreationPerM: 0}}
roles: {main_worker: mid}
`

const MODELS_NO_CACHE = `
tiers:
  high: {provider: glm, model: GLM-5.3, price: {inputPerM: 1.1111, outputPerM: 3.8889}}
  mid: {provider: glm, model: GLM-5.3, price: {inputPerM: 1.1111, outputPerM: 3.8889}}
  low: {provider: glm, model: GLM-5.3, price: {inputPerM: 1.1111, outputPerM: 3.8889}}
roles: {main_worker: mid}
`

describe('B2 models.yaml parser：cache 价可选键', () => {
  it('接受非负 cache 键并保留数值（PriceEntry 可选键透传）', () => {
    const cfg = parseModelsYaml(MODELS_CACHE)
    expect(cfg.tiers.high.price.cacheReadPerM).toBe(0.2778)
    expect(cfg.tiers.high.price.cacheCreationPerM).toBe(0)
    expect(cfg.tiers.low.price.cacheReadPerM).toBe(0.2778)
    // 无 cache 键=兼容旧表（undefined 不发明）
    const old = parseModelsYaml(MODELS_NO_CACHE)
    expect(old.tiers.high.price.cacheReadPerM).toBeUndefined()
    expect(old.tiers.high.price.cacheCreationPerM).toBeUndefined()
  })

  it('坏 cache 值 fail-closed：负值/字符串拒收（不猜、不静默忽略）', () => {
    const bad = MODELS_CACHE.replace('cacheReadPerM: 0.2778', 'cacheReadPerM: -1')
    expect(() => parseModelsYaml(bad)).toThrow(/cacheReadPerM/)
    const badString = MODELS_CACHE.replace('cacheCreationPerM: 0', 'cacheCreationPerM: "0"')
    expect(() => parseModelsYaml(badString)).toThrow(/cacheCreationPerM/)
  })
})

describe('B2 estimateCost：档位价含 cache 键时计入 cache 桶', () => {
  it('四桶直算（cacheRead 0.2778 / cacheCreation 0）', () => {
    const catalog = createModelCatalog(parseModelsYaml(MODELS_CACHE))
    const usd = catalog.estimateCost(
      { input: 1_000_000, output: 1_000_000, cache_read: 10_000_000, cache_creation: 2_000_000 },
      'mid',
    ).usd
    // 1*1.1111 + 1*3.8889 + 10*0.2778 + 2*0 = 7.778
    expect(usd).toBeCloseTo(7.778, 10)
  })

  it('无 cache 键回归：cache 桶不计价（旧口径零变）', () => {
    const catalog = createModelCatalog(parseModelsYaml(MODELS_NO_CACHE))
    const usd = catalog.estimateCost(
      { input: 1_000_000, output: 1_000_000, cache_read: 10_000_000, cache_creation: 2_000_000 },
      'mid',
    ).usd
    expect(usd).toBeCloseTo(5, 10) // 1.1111+3.8889
  })
})

describe('B2 fold/bridge：Snapshot/Models-yaml 两路都带 cache 价', () => {
  it('foldCostUsd 有 cache 价：cache 计费、unpricedBuckets 空', () => {
    const unit: UnitPrice = { inputPerM: 1, outputPerM: 2, cacheReadPerM: 0.5, cacheCreationPerM: 0.25 }
    const folded = foldCostUsd({ input: 1_000_000, output: 0, cache_read: 2_000_000, cache_creation: 1_000_000 }, unit)
    expect(folded.usd).toBeCloseTo(2.25, 10) // 1 + 1 + 0.25
    expect(folded.unpricedBuckets).toEqual([])
  })

  it('bridgePriceFor models-yaml 分支透传 cache 键（无快照时）', () => {
    const tiers = createModelCatalog(parseModelsYaml(MODELS_CACHE)).tiers()
    const bridged = bridgePriceFor([], tiers, { provider: 'glm', model: 'GLM-5.3', date: '2026-11-11' })
    expect(bridged?.source).toBe('models-yaml')
    expect(bridged?.unit.cacheReadPerM).toBe(0.2778)
    expect(bridged?.unit.cacheCreationPerM).toBe(0)
    // 无 cache 键的旧档：bridge unit 不带 cache 键（不发明）
    const oldTiers = createModelCatalog(parseModelsYaml(MODELS_NO_CACHE)).tiers()
    const oldBridged = bridgePriceFor([], oldTiers, { provider: 'glm', model: 'GLM-5.3', date: '2026-11-11' })
    expect(oldBridged?.unit.cacheReadPerM).toBeUndefined()
  })
})
