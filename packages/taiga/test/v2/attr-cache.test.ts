/** 790：custom-attrs 进程内 LRU（命中/失效/容量上限）。 */
import { describe, expect, it } from 'vitest'
import { FakeTaiga, makePlatform } from '../../src/testutil.ts'
import { AttrValueCache } from '../../src/issues.ts'

const attrCalls = (fake: FakeTaiga): number => fake.calls.filter((c) => c.path.includes('/custom-attributes-values/')).length

describe('790 custom-attrs LRU', () => {
  it('同 modified_date 二次 list 命中原值（0 次重取）；modified 变化→失效重取', async () => {
    const fake = new FakeTaiga()
    const e = fake.seedEntity({ subject: '甲' })
    fake.pushHistory(e.id, { diffKeys: ['status'] })
    const p = makePlatform(fake)
    const r1 = await p.issues.list({})
    expect(r1).toHaveLength(1)
    const c1 = attrCalls(fake)
    expect(c1).toBeGreaterThan(0)
    const r2 = await p.issues.list({})
    expect(r2).toHaveLength(1)
    expect(attrCalls(fake)).toBe(c1) // 命中：零新增
    // 失效：modified_date 变化（status 变更）→ 重取一次
    fake.pushHistory(e.id, { diffKeys: ['status'] })
    await p.issues.list({})
    expect(attrCalls(fake)).toBe(c1 + 1)
  })
  it('容量上限 512：超限逐出最旧（AttrValueCache 单元）', () => {
    const cache = new AttrValueCache(512)
    for (let i = 0; i < 520; i += 1) cache.set(`${String(i)}\u0000d`, { v: String(i) })
    expect(cache.size).toBe(512)
    expect(cache.get('0\u0000d')).toBeUndefined() // 最旧逐出
    expect(cache.get('519\u0000d')).toEqual({ v: '519' })
    cache.invalidate(519)
    expect(cache.get('519\u0000d')).toBeUndefined()
  })
})
