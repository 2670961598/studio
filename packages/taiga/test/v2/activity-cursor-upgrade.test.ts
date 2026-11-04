/** 790：activity.since 裸 UUID 游标升级 canonical + 剪枝（v2 门测试）。 */
import { describe, expect, it } from 'vitest'
import { decodeCursor, encodeCursor } from '../../src/activity.ts'
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
    const steady = await p.activity.since(upgraded.nextCursor)
    expect(steady.items).toEqual([])
    expect(steady.nextCursor).not.toBeNull() // canonical 稳态：游标写回同值
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

describe('790 v2：canonical 剪枝 + owner 缓存 + 真不可达语义', () => {
  it('modified_date 全部早于边界但边界可达：owner 未知首拍学习一次，第二拍仅 1 次 history', async () => {
    const fake = new FakeTaiga()
    for (let i = 0; i < 5; i += 1) {
      const e = fake.seedEntity({ subject: `单${String(i)}` })
      fake.pushHistory(e.id, { diffKeys: ['status'] })
    }
    const p1 = makePlatform(fake)
    const first = await p1.activity.since(null)
    const cursor = first.nextCursor as string
    // 人为把全部 modified_date 改成远早于边界（复刻 live：max modified 19:10 < 边界 20:35）
    for (const entity of fake.entities) entity.modifiedDate = '2020-01-01T00:00:00.000Z'
    // 新 platform＝新 ctx（owner 缓存未知）→ 首拍全量学习一次（history=5），仍返回空增量
    const p2 = makePlatform(fake)
    const before1 = fake.calls.filter((c) => c.path.startsWith('/api/v1/history/')).length
    const r1 = await p2.activity.since(cursor)
    const calls1 = fake.calls.filter((c) => c.path.startsWith('/api/v1/history/')).length - before1
    expect(r1.items).toEqual([])
    expect(r1.nextCursor).not.toBeNull()
    expect(calls1).toBeLessThanOrEqual(5) // 首拍学习
    // 第二拍：owner 已知 → 只拉该单 1 次 history（不再是全量 5 次）
    const before2 = fake.calls.filter((c) => c.path.startsWith('/api/v1/history/')).length
    const r2 = await p2.activity.since(cursor)
    const calls2 = fake.calls.filter((c) => c.path.startsWith('/api/v1/history/')).length - before2
    expect(r2.items).toEqual([])
    expect(calls2).toBeLessThanOrEqual(1)
  })
  it('边界真不可达（条目不存在）→ 本拍全量重放一次；cursor 推进到最新后下一拍快速可达', async () => {
    const fake = new FakeTaiga()
    for (let i = 0; i < 3; i += 1) {
      const e = fake.seedEntity({ subject: `单${String(i)}` })
      fake.pushHistory(e.id, { diffKeys: ['status'] })
    }
    const p = makePlatform(fake)
    const ghost = encodeCursor('2030-01-01T00:00:00.000Z', '00000000-0000-4000-8000-000000000000')
    const replay = await p.activity.since(ghost)
    expect(replay.items).toHaveLength(3) // 全量重放（yt(a)）
    expect(replay.nextCursor).not.toBeNull()
    // cursor 推进到最新活动 canonical：下一拍应快速空增量（history ≤ 1）
    const before = fake.calls.filter((c) => c.path.startsWith('/api/v1/history/')).length
    const next = await p.activity.since(replay.nextCursor as string)
    const calls = fake.calls.filter((c) => c.path.startsWith('/api/v1/history/')).length - before
    expect(next.items).toEqual([])
    expect(calls).toBeLessThanOrEqual(1)
  })
})
