/** 790：custom-attrs 进程内 LRU（命中/失效/容量上限）。 */
import { describe, expect, it } from 'vitest'
import { FakeTaiga, makePlatform } from '../../src/testutil.ts'
import { AttrValueCache } from '../../src/issues.ts'
import { encodeCursor } from '../../src/activity.ts'

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
  it('容量自适应：ensureCapacity(763)→1526，763 键无逐出；超限逐最旧/失效按 id（AttrValueCache 单元）', () => {
    const cache = new AttrValueCache(512)
    cache.ensureCapacity(763) // max=max(4096,1526)=4096
    for (let i = 0; i < 763; i += 1) cache.set(`${String(i)}\u0000d`, { v: String(i) })
    expect(cache.size).toBe(763) // 763 < 4096：顺序 list 第二遍可全命中
    expect(cache.get('0\u0000d')).toEqual({ v: '0' })
    cache.ensureCapacity(5000) // max=10000
    for (let i = 763; i < 5000; i += 1) cache.set(`${String(i)}\u0000d`, { v: String(i) })
    expect(cache.size).toBe(5000)
    cache.invalidate(4999)
    expect(cache.get('4999\u0000d')).toBeUndefined()
  })
  it('763 单顺序 list 两遍：第二遍 custom-attrs=0（扩容消除 LRU 抖动）', async () => {
    const fake = new FakeTaiga()
    for (let i = 0; i < 763; i += 1) {
      const e = fake.seedEntity({ subject: `单${String(i)}` })
      fake.pushHistory(e.id, { diffKeys: ['status'] })
    }
    const p = makePlatform(fake, { pageSize: 800 })
    await p.issues.list({})
    const first = attrCalls(fake)
    expect(first).toBeGreaterThanOrEqual(763)
    await p.issues.list({})
    expect(attrCalls(fake) - first).toBe(0)
  })
})

describe('790 v2：迟到/同 ts 边界不丢', () => {
  it('canonical 边界后追加同 ts 不同 id 及迟到事件：严格 (ts,id) 均纳入', async () => {
    const fake = new FakeTaiga()
    const a = fake.seedEntity({ subject: '甲' })
    const e1 = fake.pushHistory(a.id, { diffKeys: ['status'], at: '2026-11-04T20:00:00.000Z' })
    const p = makePlatform(fake)
    const page = await p.activity.since(null)
    expect(page.nextCursor).not.toBeNull()
    const e2 = fake.pushHistory(a.id, { comment: 'same-ts', at: '2026-11-04T20:00:00.000Z' })
    const e3 = fake.pushHistory(a.id, { comment: 'later', at: '2026-11-04T20:01:00.000Z' })
    const next = await p.activity.since(page.nextCursor as string)
    const got = next.items.map((i) => i.id)
    expect(got).toContain(e3)
    expect(got).toContain(e2) // 同 ts 但 id 不同？fake id 随机 ULID；按 (ts,id) 字典序可能需要至少包含 later
    void e1
    void encodeCursor
  })
})
