/**
 * 活动流测试（重点）：游标语义（NA1 教训——增量不重不漏）：
 *  - 三轮 since：null 全量（最旧起头）→ 增量 → 无新增空+游标不动
 *  - 边界精确（(ts,id) 严格新于）；分页翻页不重不漏；坏游标显式报错
 *  - 边界不可达（边界所在单被删）→ 全量重放（yt 裁决(a) 对齐）
 *  - 剪枝：边界后只有改动过的单才拉 history（call 断言）
 *  - kind 归一（commented/transitioned/field-set）+ actor + issue 归属
 *  - 建单事件缺席（history 不录建单——实测口径，webhook 主通道负责）
 */
import { describe, expect, it } from 'vitest'
import { encodeCursor } from './index.ts'
import { FakeTaiga, expectTaigaReject, makePlatform } from './testutil.ts'

const ids = (items: { id: string }[]): string[] => items.map((x) => x.id)

describe('游标语义：连续三轮 since()', () => {
  it('null=自最旧起对账全量 → 增量只新 → 无新增空（游标不动）', async () => {
    const fake = new FakeTaiga()
    const a = fake.seedEntity({ subject: '甲' })
    const b = fake.seedEntity({ subject: '乙' })
    fake.pushHistory(a.id, { diffKeys: ['status'] }) // e1
    const e2 = fake.pushHistory(b.id, { comment: 'first' }) // e2
    const p = makePlatform(fake)

    // 第一轮：全量，升序，无更多
    const r1 = await p.activity.since(null)
    expect(r1.items.map((x) => [x.issue, x.kind])).toEqual([
      ['probe-co-1', 'transitioned'],
      ['probe-co-2', 'commented'],
    ])
    expect(r1.nextCursor).toBeNull()
    expect(r1.items[1]?.actor).toBe('admin')

    // 第二轮：乙再动一次 → 只增量（严格新于 e2）
    const e3 = fake.pushHistory(b.id, { diffKeys: ['subject'] })
    const r2 = await p.activity.since(e2)
    expect(ids(r2.items)).toEqual([e3])
    expect(r2.items[0]).toMatchObject({ issue: 'probe-co-2', kind: 'field-set' })

    // 第三轮：无新增 → 空 + null；再问仍空（游标不动）
    const r3 = await p.activity.since(e3)
    expect(r3).toEqual({ items: [], nextCursor: null })
    expect(await p.activity.since(e3)).toEqual({ items: [], nextCursor: null })
  })

  it('canonical 游标（nextCursor 产出形态）与裸 id 等价续问', async () => {
    const fake = new FakeTaiga()
    const a = fake.seedEntity({ subject: '甲' })
    const b = fake.seedEntity({ subject: '乙' })
    fake.pushHistory(a.id, { diffKeys: ['status'] })
    fake.pushHistory(b.id, { comment: 'c' })
    fake.pushHistory(b.id, { diffKeys: ['status'] })
    const p = makePlatform(fake, { pageSize: 2 })
    const page1 = await p.activity.since(null)
    expect(ids(page1.items).length).toBe(2)
    expect(page1.nextCursor).not.toBeNull()
    const page2 = await p.activity.since(page1.nextCursor)
    expect(ids(page2.items).length).toBe(1)
    expect(page2.nextCursor).toBeNull()
    // 裸条目 id（轮询方拿末条 id 续问的惯例）也能当边界
    const lastId = page2.items[0]?.id ?? ''
    expect(await p.activity.since(lastId)).toEqual({ items: [], nextCursor: null })
  })

  it('分页不重不漏（pageSize=2 五条活动翻三页）', async () => {
    const fake = new FakeTaiga()
    const a = fake.seedEntity({ subject: '甲' })
    const b = fake.seedEntity({ subject: '乙' })
    const c = fake.seedEntity({ subject: '丙' })
    fake.pushHistory(a.id, { diffKeys: ['status'] })
    fake.pushHistory(b.id, { comment: '1' })
    fake.pushHistory(c.id, { diffKeys: ['subject'] })
    fake.pushHistory(a.id, { comment: '2' })
    fake.pushHistory(b.id, { diffKeys: ['status'] })
    const p = makePlatform(fake, { pageSize: 2 })

    const collected: string[] = []
    let cursor: string | null = null
    for (let round = 0; round < 10; round++) {
      const page = await p.activity.since(cursor)
      collected.push(...ids(page.items))
      if (page.nextCursor === null) break
      cursor = page.nextCursor
    }
    expect(collected.length).toBe(5)
    expect(new Set(collected).size).toBe(5) // 不重
    const all = await p.activity.since(null)
    void all
    // 拼接结果=全量集合（不漏）：手工核对五条都来自 fake
    const every = [...a.history, ...b.history, ...c.history].map((h) => h.id)
    expect(collected.sort()).toEqual([...every].sort())
  })

  it('坏游标显式报错（不静默当从头）', async () => {
    const fake = new FakeTaiga()
    const a = fake.seedEntity({ subject: '甲' })
    fake.pushHistory(a.id, { diffKeys: ['status'] })
    const p = makePlatform(fake)
    await expectTaigaReject(() => p.activity.since('garbage'), 'CONFIG_INVALID', 'bad-cursor')
    await expectTaigaReject(() => p.activity.since('e30'), 'CONFIG_INVALID', 'bad-cursor') // 非 base64url JSON
  })

  it('建单事件缺席：播种单不产活动（history 不录建单——实测口径）', async () => {
    const fake = new FakeTaiga()
    fake.seedEntity({ subject: '甲' })
    fake.seedEntity({ subject: '乙' })
    const page = await makePlatform(fake).activity.since(null)
    expect(page).toEqual({ items: [], nextCursor: null })
  })
})

describe('边界不可达 = 全量重放（yt 裁决(a) 对齐）', () => {
  it('边界所在单被删 → 游标跨作用域变化 → 返回全部活动', async () => {
    const fake = new FakeTaiga()
    const a = fake.seedEntity({ subject: '甲' })
    const b = fake.seedEntity({ subject: '乙' })
    fake.pushHistory(a.id, { diffKeys: ['status'] })
    const boundary = fake.pushHistory(b.id, { comment: '边界' })
    fake.pushHistory(a.id, { diffKeys: ['subject'] })
    const p = makePlatform(fake)
    // 正常增量：边界后 1 条
    const r1 = await p.activity.since(boundary)
    expect(ids(r1.items).length).toBe(1)
    // 乙单被删 → 边界永不可达 → 全量重放（2 条：甲的两条）
    fake.entities = fake.entities.filter((e) => e.id !== b.id)
    const r2 = await p.activity.since(boundary)
    expect(ids(r2.items).length).toBe(2)
    expect(r2.items.every((x) => x.issue === 'probe-co-1')).toBe(true)
  })
})

describe('剪枝（成本面：modified_date 早于边界的单不拉 history）', () => {
  it('canonical 边界（带 ts）：只有 modified_date ≥ 边界的单拉 history', async () => {
    const fake = new FakeTaiga()
    const a = fake.seedEntity({ subject: '甲' })
    const b = fake.seedEntity({ subject: '乙' })
    const c = fake.seedEntity({ subject: '丙' })
    fake.pushHistory(a.id, { diffKeys: ['status'] })
    const boundaryId = fake.pushHistory(b.id, { diffKeys: ['status'] })
    const boundaryEntry = b.history.find((h) => h.id === boundaryId)
    expect(boundaryEntry).toBeDefined()
    const canonical = encodeCursor(boundaryEntry?.createdAt ?? '', boundaryId)
    const p = makePlatform(fake)
    const before = fake.countHistoryFetches()
    const page = await p.activity.since(canonical) // 边界后无新增
    const fetched = fake.countHistoryFetches() - before
    // 候选=乙（边界所在单，modified_date=边界 ts）；甲丙 modified_date 早于边界 → 剪掉
    expect(fetched).toBe(1)
    expect(page).toEqual({ items: [], nextCursor: null })
    void c
  })

  it('裸 id 边界（无 ts）：退全扫——所有单都拉一遍（兼容换代价）', async () => {
    const fake = new FakeTaiga()
    const a = fake.seedEntity({ subject: '甲' })
    const b = fake.seedEntity({ subject: '乙' })
    fake.pushHistory(a.id, { diffKeys: ['status'] })
    const boundary = fake.pushHistory(b.id, { diffKeys: ['status'] })
    const before = fake.countHistoryFetches()
    await makePlatform(fake).activity.since(boundary)
    expect(fake.countHistoryFetches() - before).toBe(2)
  })

  it('全量模式（null）不剪枝：每单都拉', async () => {
    const fake = new FakeTaiga()
    const a = fake.seedEntity({ subject: '甲' })
    const b = fake.seedEntity({ subject: '乙' })
    fake.pushHistory(a.id, { diffKeys: ['status'] })
    fake.pushHistory(b.id, { diffKeys: ['status'] })
    const before = fake.countHistoryFetches()
    await makePlatform(fake).activity.since(null)
    expect(fake.countHistoryFetches() - before).toBe(2)
  })
})
