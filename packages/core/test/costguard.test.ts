/**
 * costguard 纯逻辑测试（132-§6.1/§6.4 单C，studio-dev-177）：日键/档位判定/
 * 用量投影折叠/格价折算。
 * 覆盖（132 §6.4 定稿表+§8 验收）：
 *   - localDateKey：本地时区日历日（UTC 日切割不串日）；
 *   - highestReachedTier：零消耗零档/恰好达线=达标/超线取最高/budget=0 有耗=Infinity
 *     超支语义/档序乱序自排；
 *   - foldUsageDaily：同格四桶累加+runs 计数+MIN/MAX 锚；跳过规则（running 缺
 *     ended_at/缺 model/缺 tokens——不可归属即不造假）；
 *   - usageCellsCostUsd：四桶×单价/1e6；缺价模型按 0 计+unpricedModels 如实上报。
 */
import { describe, expect, it } from 'vitest'
import { foldUsageDaily, highestReachedTier, localDateKey, usageCellsCostUsd, type UsageDailyCell } from '../src/costguard.ts'
import type { CostGuardTier } from '@studio-next/contract'
import type { UnitPrice } from '../src/pricing.ts'

const TIERS: readonly CostGuardTier[] = [
  { tier: 'watch', atPct: 50, route: 'notify' },
  { tier: 'warn', atPct: 80, route: 'dispatch' },
  { tier: 'alarm', atPct: 100, route: 'dispatch+notify' },
  { tier: 'hard', atPct: 120, route: 'gate' },
]

describe('localDateKey（132-§6.4 period 口径）', () => {
  it('本地日历日串 YYYY-MM-DD', () => {
    const d = new Date(2026, 9, 23, 8, 30, 0) // 2026-10-23 08:30 本地
    expect(localDateKey(d.getTime())).toBe('2026-10-23')
  })
  it('年末/月首边界不串日', () => {
    expect(localDateKey(new Date(2026, 11, 31, 23, 59, 59).getTime())).toBe('2026-12-31')
    expect(localDateKey(new Date(2027, 0, 1, 0, 0, 0).getTime())).toBe('2027-01-01')
  })
})

describe('highestReachedTier（132-§6.4 触发条件：最高达标档）', () => {
  it('零消耗=零档达标', () => {
    expect(highestReachedTier(TIERS, 0, 25)).toBeUndefined()
  })
  it('预算为 0 且有消耗=超支语义（Infinity pct，全档达标→取最高）', () => {
    const hit = highestReachedTier(TIERS, 0.01, 0)
    expect(hit?.tier.tier).toBe('hard')
    expect(hit?.pct).toBe(Infinity)
  })
  it('恰好达线=达标（running == budget×pct/100）', () => {
    expect(highestReachedTier(TIERS, 12.5, 25)?.tier.tier).toBe('watch') // 恰好 50%
    expect(highestReachedTier(TIERS, 20, 25)?.tier.tier).toBe('warn') // 恰好 80%
    expect(highestReachedTier(TIERS, 25, 25)?.tier.tier).toBe('alarm') // 恰好 100%
    expect(highestReachedTier(TIERS, 30, 25)?.tier.tier).toBe('hard') // 恰好 120%
  })
  it('线下一档不达标：49.99% 未达 watch', () => {
    expect(highestReachedTier(TIERS, 12.4999, 25)).toBeUndefined()
  })
  it('跨多档取最高（90% → warn 非两档连发）', () => {
    const hit = highestReachedTier(TIERS, 22.5, 25)
    expect(hit?.tier.tier).toBe('warn')
    expect(hit?.pct).toBeCloseTo(90, 10)
  })
  it('档序乱序配置自排（判定序=at_pct 升序，不信任配置序）', () => {
    const shuffled = [...TIERS].reverse()
    expect(highestReachedTier(shuffled, 30, 25)?.tier.tier).toBe('hard')
  })
})

describe('foldUsageDaily（132-§6.1 R1 投影折叠）', () => {
  const day = (h: number): number => new Date(2026, 9, 23, h, 0, 0).getTime()
  const day2 = (h: number): number => new Date(2026, 9, 24, h, 0, 0).getTime()

  it('同格累加：四桶+runs_count+first/last MIN-MAX', () => {
    const cells = foldUsageDaily(
      [
        { person_id: 'ENG-2', model: 'deepseek/deepseek-flash', started_at: day(1), ended_at: day(2), tokens: { input: 1000, output: 200, cache_read: 50, cache_creation: 10 } },
        { person_id: 'ENG-2', model: 'deepseek/deepseek-flash', started_at: day(0), ended_at: day(5), tokens: { input: 11, output: 22 } },
      ],
      'studio-dev',
    )
    expect(cells.length).toBe(1)
    const c = cells[0]
    expect(c.usage_date).toBe('2026-10-23')
    expect(c.tokens_in).toBe(1011)
    expect(c.tokens_out).toBe(222)
    expect(c.cache_read).toBe(50)
    expect(c.cache_creation).toBe(10)
    expect(c.runs_count).toBe(2)
    expect(c.first_ts).toBe(day(0))
    expect(c.last_ts).toBe(day(5))
  })

  it('人/模型/落账日三维分格（ended_at 本地日=归属日）', () => {
    const cells = foldUsageDaily(
      [
        { person_id: 'ENG-2', model: 'a/a', started_at: day(1), ended_at: day(2), tokens: { input: 1, output: 1 } },
        { person_id: 'ENG-3', model: 'a/a', started_at: day(1), ended_at: day(2), tokens: { input: 1, output: 1 } },
        { person_id: 'ENG-2', model: 'b/b', started_at: day(1), ended_at: day(2), tokens: { input: 1, output: 1 } },
        { person_id: 'ENG-2', model: 'a/a', started_at: day2(1), ended_at: day2(2), tokens: { input: 1, output: 1 } },
      ],
      'studio-dev',
    )
    expect(cells.length).toBe(4)
  })

  it('跳过规则：running（缺 ended_at）/缺 model/缺 tokens 不进投影（不造假）', () => {
    const cells = foldUsageDaily(
      [
        { person_id: 'ENG-2', model: 'a/a', started_at: day(1), tokens: { input: 1, output: 1 } }, // running
        { person_id: 'ENG-2', started_at: day(1), ended_at: day(2), tokens: { input: 1, output: 1 } }, // 无 model
        { person_id: 'ENG-2', model: 'a/a', started_at: day(1), ended_at: day(2) }, // 无 tokens
      ],
      'studio-dev',
    )
    expect(cells).toEqual([])
  })
})

describe('usageCellsCostUsd（格价折算，DEV-19 不猜价）', () => {
  const UNIT: UnitPrice = { inputPerM: 0.3, outputPerM: 1.2, cacheReadPerM: 0.006, cacheCreationPerM: 0.3 }
  const cell = (model: string, t: Partial<UsageDailyCell>): UsageDailyCell => ({
    company: 'studio-dev', person_id: 'ENG-2', model, usage_date: '2026-10-23',
    tokens_in: 1_000_000, tokens_out: 1_000_000, cache_read: 0, cache_creation: 0, runs_count: 1,
    ...t,
  })

  it('四桶×单价/1e6（NULL 价桶按 0 计——pricing 同式）', () => {
    const { usd, unpricedModels } = usageCellsCostUsd(
      [cell('m/m', { cache_read: 1_000_000, cache_creation: 1_000_000 })],
      () => UNIT,
    )
    expect(usd).toBeCloseTo(0.3 + 1.2 + 0.006 + 0.3, 10)
    expect(unpricedModels).toEqual([])
  })

  it('缺价模型按 0 计+如实上报（不静默）', () => {
    const table = new Map<string, UnitPrice>([['a/a', UNIT]])
    const { usd, unpricedModels } = usageCellsCostUsd(
      [cell('a/a'), cell('z/z')],
      (m) => table.get(m),
    )
    expect(usd).toBeCloseTo(1.5, 10)
    expect(unpricedModels).toEqual(['z/z'])
  })
})
