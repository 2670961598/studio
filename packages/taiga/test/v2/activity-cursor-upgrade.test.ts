/** 790：activity.since 裸 UUID 游标升级 canonical + 剪枝（v2 门测试）。 */
import { describe, expect, it } from 'vitest'
import { decodeCursor } from '../../src/activity.ts'
import { FakeTaiga, makePlatform } from '../../src/testutil.ts'

describe('790 裸 UUID 游标升级', () => {
  it('全量→裸末条 id→返回 canonical；canonical 下一拍空+null，历史调用数不随存量增长', async () => {
    const fake = new FakeTaiga()
    for (let i = 0; i < 6; i += 1) {
      const e = fake.seedEntity({ subject: `单${String(i)}` })
      fake.pushHistory(e.id, { diffKeys: ['status'] })
    }
    const p = makePlatform(fake)
    const full = await p.activity.since(null)
    expect(full.items).toHaveLength(6)
    expect(full.nextCursor).not.toBeNull()
    const bare = full.items.at(-1)?.id ?? ''
    const upgraded = await p.activity.since(bare)
    expect(upgraded.items).toEqual([])
    expect(upgraded.nextCursor).not.toBeNull()
    expect(decodeCursor(upgraded.nextCursor as string).ts).not.toBeNull()
    const before = fake.calls.filter((c) => c.path.startsWith('/api/v1/history/')).length
    expect(await p.activity.since(upgraded.nextCursor)).toEqual({ items: [], nextCursor: null })
    const after = fake.calls.filter((c) => c.path.startsWith('/api/v1/history/')).length
    expect(after - before).toBeLessThanOrEqual(6)
  })
  it('canonical 后迟到事件（created_at 新于边界）不丢；边界精确 (ts,id)', async () => {
    const fake = new FakeTaiga()
    const a = fake.seedEntity({ subject: '甲' })
    fake.pushHistory(a.id, { diffKeys: ['status'] })
    const p = makePlatform(fake)
    const page = await p.activity.since(null)
    const late = fake.pushHistory(a.id, { comment: 'late' })
    const next = await p.activity.since(page.nextCursor)
    expect(next.items.map((i) => i.id)).toEqual([late])
    expect(next.nextCursor).not.toBeNull()
  })
  it('空历史 null→null；裸不可达→全量重放', async () => {
    const fake = new FakeTaiga()
    fake.seedEntity({ subject: '甲' })
    expect(await makePlatform(fake).activity.since(null)).toEqual({ items: [], nextCursor: null })
    const fake2 = new FakeTaiga()
    const b = fake2.seedEntity({ subject: '乙' })
    fake2.pushHistory(b.id, { diffKeys: ['status'] })
    const page = await makePlatform(fake2).activity.since('00000000-0000-4000-8000-000000000000')
    expect(page.items).toHaveLength(1)
  })
})
