/**
 * pricing 测试（132-§6.2 单B·studio-dev-169）：定价面纯逻辑。
 * 覆盖：
 *   - parsePricingTable：正例（缺省 slot/billingTrack 展开）/负例（未知键行号定位/
 *     重复模型/重复 slot/坏日期/双轨互斥/coding_plan 缺月费）；
 *   - validatePricingTable：覆盖 ⊇ 三档（缺档拒/超额放行/declared 缺席=态 B 降级跳过）；
 *   - resolveSnapshotPrice：exact（同日最高 version）/carry（最近 <D+staleDays）/
 *     未来行不参与 carry（F5）/从未定价=undefined/异 slot 独立；
 *   - foldCostUsd：四桶折算/cache 缺价按 0 计+低估标记/cached 兼容读（132-A）；
 *   - pricingStaleReport：fresh/stale1/stale2 告警/从未定价/超额模型在册；
 *   - bridgePriceFor：快照优先/models.yaml 静态兜底/都不中=undefined；
 *   - 模型归一键：normalizeModelKey/parseModelKey（work_records.model 桥接）。
 */
import { describe, expect, it } from 'vitest'
import type { ModelTier, TokenCounts } from '@studio-next/contract'
import {
  bridgePriceFor,
  foldCostUsd,
  normalizeModelKey,
  parseModelKey,
  parsePricingTable,
  pricingStaleReport,
  PRICING_STALE_ALARM_DAYS,
  resolveSnapshotPrice,
  validatePricingTable,
  type PriceSnapshotLike,
} from '../src/pricing.ts'

/** 首批样表（132-§5-F2 DeepSeek 四维价+GLM 双轨——plan.md §2.6 同源） */
const TABLE_YAML = `# 定价更新单附件（HF-1 每晨发布）
priceDate: '2026-10-23'
sourceNote: DeepSeek 官网价目页（2026-10-23 晨采）
models:
  - provider: deepseek
    model: deepseek-flash
    billingTrack: api
    prices:
      - slot: peak
        inputPerM: 0.3
        outputPerM: 1.2
        cacheReadPerM: 0.006
        cacheCreationPerM: 0.3
      - slot: offpeak
        inputPerM: 0.15
        outputPerM: 0.6
        cacheReadPerM: 0.003
        cacheCreationPerM: 0.15
  - provider: deepseek
    model: v4-pro
    prices:
      - inputPerM: 1.32
        outputPerM: 3.96
        cacheReadPerM: 0.044
        cacheCreationPerM: 1.32
  - provider: zhipu
    model: glm-5.3
    billingTrack: coding_plan
    planMonthlyUsd: 30
    prices:
      - inputPerM: 0.6
        outputPerM: 2.2
`

const DECLARED = [
  { provider: 'deepseek', model: 'deepseek-flash' },
  { provider: 'deepseek', model: 'v4-pro' },
  { provider: 'zhipu', model: 'glm-5.3' },
]

const TIERS: ModelTier[] = [
  { tier: 'high', provider: 'zhipu', model: 'glm-5.3', price: { inputPerM: 0.6, outputPerM: 2.2 } },
  { tier: 'mid', provider: 'deepseek', model: 'v4-pro', price: { inputPerM: 1.32, outputPerM: 3.96 } },
  { tier: 'low', provider: 'deepseek', model: 'deepseek-flash', price: { inputPerM: 0.3, outputPerM: 1.2 } },
]

/** 快照行造样（store PriceSnapshotRecord 投影形） */
function snap(over: Partial<PriceSnapshotLike> & { price_date: string; version?: number }): PriceSnapshotLike {
  return {
    provider: 'deepseek',
    model: 'deepseek-flash',
    slot: 'peak',
    input_per_m: 0.3,
    output_per_m: 1.2,
    billing_track: 'api',
    version: 1,
    id: `ps-${over.price_date}-${String(over.version ?? 1)}`,
    ...over,
  }
}

describe('parsePricingTable（附件解析）', () => {
  it('正例：峰谷双 slot+api 默认轨+coding_plan 双轨；v4-pro 行省略 slot=peak 缺省', () => {
    const t = parsePricingTable(TABLE_YAML)
    expect(t.priceDate).toBe('2026-10-23')
    expect(t.models).toHaveLength(3)
    const flash = t.models[0]
    expect(flash?.billingTrack).toBe('api')
    expect(flash?.prices[0]).toMatchObject({ slot: 'peak', inputPerM: 0.3, cacheReadPerM: 0.006 })
    const pro = t.models[1]
    expect(pro?.prices[0]?.slot).toBe('peak')
    const glm = t.models[2]
    expect(glm).toMatchObject({ billingTrack: 'coding_plan', planMonthlyUsd: 30 })
  })

  it.each([
    ['未知键行号定位', 'priceDate: \'2026-10-23\'\nsourceNote: s\nmodels:\n  - provider: a\n    model: m\n    prices:\n      - inputPerM: 1\n        outputPerM: 1\n        badKey: 1\n', /pricing\/unknown-key:models\.0\.prices\.0\.badKey/],
    ['重复模型', "priceDate: '2026-10-23'\nsourceNote: s\nmodels:\n  - { provider: a, model: m, prices: [{ inputPerM: 1, outputPerM: 1 }] }\n  - { provider: a, model: m, prices: [{ inputPerM: 2, outputPerM: 2 }] }\n", /重复模型/],
    ['重复 slot', "priceDate: '2026-10-23'\nsourceNote: s\nmodels:\n  - { provider: a, model: m, prices: [{ slot: peak, inputPerM: 1, outputPerM: 1 }, { slot: peak, inputPerM: 2, outputPerM: 2 }] }\n", /重复 slot/],
    ['坏日期（非真日）', "priceDate: '2026-02-30'\nsourceNote: s\nmodels:\n  - { provider: a, model: m, prices: [{ inputPerM: 1, outputPerM: 1 }] }\n", /真日历日/],
    ['coding_plan 缺月费', "priceDate: '2026-10-23'\nsourceNote: s\nmodels:\n  - { provider: a, model: m, billingTrack: coding_plan, prices: [{ inputPerM: 1, outputPerM: 1 }] }\n", /planMonthlyUsd/],
    ['api 行带月费（双轨互斥）', "priceDate: '2026-10-23'\nsourceNote: s\nmodels:\n  - { provider: a, model: m, planMonthlyUsd: 30, prices: [{ inputPerM: 1, outputPerM: 1 }] }\n", /双轨互斥/],
    ['yaml 语法坏', 'priceDate: [broken\n', /pricing\/yaml-syntax/],
    ['空 models', "priceDate: '2026-10-23'\nsourceNote: s\nmodels: []\n", /pricing\/parse/],
  ])('拒收：%s', (_name, yaml, re) => {
    expect(() => parsePricingTable(yaml)).toThrowError(re)
  })
})

describe('validatePricingTable（覆盖 ⊇ models.yaml 三档）', () => {
  it('全covered+表有超额模型：过（「⊇」语义——扩展模型先于 models.yaml 改档合法）', () => {
    const t = parsePricingTable(TABLE_YAML)
    expect(() => validatePricingTable(t, DECLARED.slice(0, 2))).not.toThrow()
  })

  it('缺档：CONFIG_INVALID pricing/coverage 整表拒（晨间发布必须完整）', () => {
    const t = parsePricingTable(TABLE_YAML)
    expect(() => validatePricingTable(t, [...DECLARED, { provider: 'zhipu', model: 'glm-4.7-flash' }])).toThrowError(/pricing\/coverage.*glm-4\.7-flash/)
  })

  it('declared 缺席（态 B 无 models.yaml）：跳过覆盖校验（如实降级归 daemon note）', () => {
    const t = parsePricingTable(TABLE_YAML)
    expect(() => validatePricingTable(t, undefined)).not.toThrow()
  })
})

describe('resolveSnapshotPrice（解析规则 132-§6.2 直译）', () => {
  it('exact：price_date=D 的最高 version 行（F1 同日修订取最新）', () => {
    const rows = [
      snap({ price_date: '2026-10-23', version: 1, input_per_m: 0.3 }),
      snap({ price_date: '2026-10-23', version: 2, input_per_m: 0.45 }),
    ]
    const r = resolveSnapshotPrice(rows, { provider: 'deepseek', model: 'deepseek-flash', date: '2026-10-23' })
    expect(r).toMatchObject({ exact: true, staleDays: 0, unit: { inputPerM: 0.45 } })
  })

  it('carry：缺 D 沿用最近 <D 行+staleDays 计数', () => {
    const rows = [
      snap({ price_date: '2026-10-21', version: 1 }),
      snap({ price_date: '2026-10-22', version: 1 }),
    ]
    const r = resolveSnapshotPrice(rows, { provider: 'deepseek', model: 'deepseek-flash', date: '2026-10-24' })
    expect(r).toMatchObject({ exact: false, priceDate: '2026-10-22', staleDays: 2 })
  })

  it('未来行不参与 carry（F5 生效期：预发布价到日自然生效）', () => {
    const rows = [snap({ price_date: '2026-10-25', version: 1 })]
    expect(resolveSnapshotPrice(rows, { provider: 'deepseek', model: 'deepseek-flash', date: '2026-10-24' })).toBeUndefined()
    expect(resolveSnapshotPrice(rows, { provider: 'deepseek', model: 'deepseek-flash', date: '2026-10-25' })).toMatchObject({ exact: true })
  })

  it('从未定价=undefined；异 slot 独立（offpeak 缺不串 peak 价）', () => {
    const rows = [snap({ price_date: '2026-10-23', version: 1 })]
    expect(resolveSnapshotPrice(rows, { provider: 'zhipu', model: 'glm-5.3', date: '2026-10-23' })).toBeUndefined()
    expect(resolveSnapshotPrice(rows, { provider: 'deepseek', model: 'deepseek-flash', date: '2026-10-23', slot: 'offpeak' })).toBeUndefined()
  })

  it('billing_track/plan_monthly_usd 随行透出（单C/D 折算消费面）', () => {
    const rows = [snap({ price_date: '2026-10-23', version: 1, billing_track: 'coding_plan', plan_monthly_usd: 30 })]
    const r = resolveSnapshotPrice(rows, { provider: 'deepseek', model: 'deepseek-flash', date: '2026-10-23' })
    expect(r).toMatchObject({ billingTrack: 'coding_plan', planMonthlyUsd: 30 })
  })
})

describe('foldCostUsd（四桶折算+低估标记 DEV-19）', () => {
  it('四桶全价：Σ桶/1e6×单价（IEEE-754 直算）', () => {
    const tokens: TokenCounts = { input: 1_000_000, output: 500_000, cache_read: 10_000_000, cache_creation: 2_000_000 }
    const r = foldCostUsd(tokens, { inputPerM: 0.3, outputPerM: 1.2, cacheReadPerM: 0.006, cacheCreationPerM: 0.3 })
    expect(r.usd).toBeCloseTo(0.3 + 0.6 + 0.06 + 0.6, 12)
    expect(r.unpricedBuckets).toEqual([])
  })

  it('cache 缺价：按 0 计+低估标记（NULL=未定价非零价）；零用量缺价不标', () => {
    const used: TokenCounts = { input: 100, output: 100, cache_read: 500 }
    const r = foldCostUsd(used, { inputPerM: 0.3, outputPerM: 1.2 })
    expect(r.usd).toBeCloseTo((100 / 1e6) * 0.3 + (100 / 1e6) * 1.2, 12)
    expect(r.unpricedBuckets).toEqual(['cache_read'])
    const idle = foldCostUsd({ input: 1, output: 1 }, { inputPerM: 0.3, outputPerM: 1.2 })
    expect(idle.unpricedBuckets).toEqual([])
  })

  it('cached 兼容读（132-A：cache_read ?? cached——旧账键）', () => {
    const legacy: TokenCounts = { input: 0, output: 0, cached: 1_000_000 }
    const r = foldCostUsd(legacy, { inputPerM: 1, outputPerM: 1, cacheReadPerM: 0.006 })
    expect(r.usd).toBeCloseTo(0.006, 12)
    expect(r.unpricedBuckets).toEqual([])
  })
})

describe('pricingStaleReport（P5 守夜面）', () => {
  it('fresh=0 不告警；stale1=标记不告警；stale≥2=告警；从未定价=告警', () => {
    const rows = [
      snap({ price_date: '2026-10-24', version: 1 }), // fresh（D=10-24）
      snap({ price_date: '2026-10-22', version: 1, model: 'v4-pro' }), // stale=2 → alarm
    ]
    const declared = [
      { provider: 'deepseek', model: 'deepseek-flash' },
      { provider: 'deepseek', model: 'v4-pro' },
      { provider: 'zhipu', model: 'glm-5.3' }, // 从未定价 → alarm
    ]
    const report = pricingStaleReport(rows, declared, '2026-10-24')
    expect(report).toHaveLength(3)
    const by = (m: string): (typeof report)[number] => report.find(e => e.model === m) as (typeof report)[number]
    expect(by('deepseek-flash')).toMatchObject({ staleDays: 0, alarm: false, declared: true })
    expect(by('v4-pro')).toMatchObject({ staleDays: 2, alarm: true, latestDate: '2026-10-22' })
    expect(by('glm-5.3')).toMatchObject({ staleDays: undefined, alarm: true, latestDate: undefined })
    expect(PRICING_STALE_ALARM_DAYS).toBe(2)
  })

  it('超额模型在册同守（凡在册皆有消费面——漏更同样低估）', () => {
    const rows = [snap({ price_date: '2026-10-20', version: 1, provider: 'other', model: 'extra-model' })]
    const report = pricingStaleReport(rows, undefined, '2026-10-24')
    expect(report).toHaveLength(1)
    expect(report[0]).toMatchObject({ provider: 'other', model: 'extra-model', declared: false, staleDays: 4, alarm: true })
  })
})

describe('bridgePriceFor（models.yaml 桥）', () => {
  it('快照命中优先（exact 与 carry 皆然）', () => {
    const rows = [snap({ price_date: '2026-10-23', version: 1, input_per_m: 0.33 })]
    const exact = bridgePriceFor(rows, TIERS, { provider: 'deepseek', model: 'deepseek-flash', date: '2026-10-23' })
    expect(exact).toMatchObject({ source: 'snapshot', exact: true })
    const carry = bridgePriceFor(rows, TIERS, { provider: 'deepseek', model: 'deepseek-flash', date: '2026-10-24' })
    expect(carry).toMatchObject({ source: 'snapshot', exact: false, staleDays: 1 })
  })

  it('无快照命中三档=modelss.yaml 静态价兜底（cache 无价=低估标记面）', () => {
    const r = bridgePriceFor([], TIERS, { provider: 'zhipu', model: 'glm-5.3', date: '2026-10-23' })
    expect(r).toMatchObject({ source: 'models-yaml', unit: { inputPerM: 0.6, outputPerM: 2.2 } })
  })

  it('都不中=undefined（未声明未定价——不猜价）', () => {
    expect(bridgePriceFor([], TIERS, { provider: 'other', model: 'x', date: '2026-10-23' })).toBeUndefined()
  })
})

describe('模型归一键（work_records.model 桥——132-A 归一形）', () => {
  it('normalize/parse 往返；坏形=undefined', () => {
    expect(normalizeModelKey('deepseek', 'deepseek-flash')).toBe('deepseek/deepseek-flash')
    expect(parseModelKey('deepseek/deepseek-flash')).toEqual({ provider: 'deepseek', model: 'deepseek-flash' })
    expect(parseModelKey('glm/GLM-5.3')).toEqual({ provider: 'glm', model: 'GLM-5.3' })
    expect(parseModelKey('no-slash')).toBeUndefined()
    expect(parseModelKey('/leading')).toBeUndefined()
    expect(parseModelKey('trailing/')).toBeUndefined()
  })
})
