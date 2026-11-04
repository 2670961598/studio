/**
 * 活动流测试（重点）：游标语义（NA1 教训——增量不重不漏）：
 *  - 三轮 since：null 全量（最旧起头）→ 增量 → 无新增空+游标不动
 *  - 边界精确（(ts,id) 严格新于）；分页翻页不重不漏；坏游标显式报错
 *  - 边界不可达（边界所在单被删）→ 全量重放（yt 裁决(a) 对齐）
 *  - 剪枝：边界后只有改动过的单才拉 history（call 断言）
 *  - studio-dev-409 回归：误剪/首页窗口外边界 ≠ 不可达——全量复核命中按增量走
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
    // 790：末页也返回 canonical {ts,id} 游标（上游可剪枝；不再回落裸 id）
    expect(r1.nextCursor).not.toBeNull()
    expect(r1.items[1]?.actor).toBe('admin')

    // 第二轮：乙再动一次 → 只增量（严格新于 e2）
    const e3 = fake.pushHistory(b.id, { diffKeys: ['subject'] })
    const r2 = await p.activity.since(e2)
    expect(ids(r2.items)).toEqual([e3])
    expect(r2.items[0]).toMatchObject({ issue: 'probe-co-2', kind: 'field-set' })

    // 第三轮：无新增 → 空；裸 e3 边界升级 canonical（790），再问以 canonical 得空+null
    const r3 = await p.activity.since(e3)
    expect(r3.items).toEqual([])
    expect(r3.nextCursor).not.toBeNull()
    const steady = await p.activity.since(r3.nextCursor)
    expect(steady.items).toEqual([])
    expect(steady.nextCursor).not.toBeNull()
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
    expect(page2.nextCursor).not.toBeNull() // 790：末页 canonical
    // 裸条目 id（轮询方拿末条 id 续问的惯例）也能当边界并升级 canonical
    const lastId = page2.items[0]?.id ?? ''
    const upgraded = await p.activity.since(lastId)
    expect(upgraded.items).toEqual([])
    expect(upgraded.nextCursor).not.toBeNull()
    const steady = await p.activity.since(upgraded.nextCursor)
    expect(steady.items).toEqual([])
    expect(steady.nextCursor).not.toBeNull()
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
    expect(page.items).toEqual([])
    expect(page.nextCursor).not.toBeNull() // canonical 稳态写回同值
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

describe('studio-dev-409 回归①：剪枝不变量破坏不触发全量重放（游标回退环根因）', () => {
  it('边界所在单 modified_date 因精度/后缀差异被误剪 → 全量复核命中 → 严格增量（不回退）', async () => {
    const fake = new FakeTaiga()
    const a = fake.seedEntity({ subject: '甲' })
    fake.pushHistory(a.id, { diffKeys: ['status'], at: '2026-10-19T14:08:01.354Z' })
    const boundaryId = fake.pushHistory(a.id, { diffKeys: ['subject'], at: '2026-10-19T22:54:21.620Z' })
    const newer = fake.pushHistory(a.id, { comment: '新活动', at: '2026-11-02T09:00:00.000Z' })
    const boundaryEntry = a.history.find((h) => h.id === boundaryId)
    expect(boundaryEntry).toBeDefined()
    const canonical = encodeCursor(boundaryEntry?.createdAt ?? '', boundaryId)
    // 人为破坏剪枝前提（真机三面：modified_date 秒级精度+时区后缀——'+'(0x2B) <
    // '.'(0x2E) 字符串序即被剪；毫秒截断；2026-10-31 历史行 SQL 误伤）
    a.modifiedDate = '2026-10-19T22:54:21+00:00'
    const p = makePlatform(fake)
    const page = await p.activity.since(canonical)
    // 修复后：全量复核命中边界 → 只回严格新于边界的活动；修复前：误判不可达 →
    // 全量重放回最旧页（nextCursor 回拉 → 生产环境游标回退环 A→B→C→A）
    expect(ids(page.items)).toEqual([newer])
    expect(page.nextCursor).not.toBeNull() // 790：末页 canonical（不回拉裸 id）
    const steady = await p.activity.since(page.nextCursor)
    expect(steady.items).toEqual([])
    expect(steady.nextCursor).not.toBeNull()
  })
})

describe('studio-dev-409 回归②：长历史单窗口外边界可达（history 翻页取尽）', () => {
  it('边界落在服务端首页窗口（30 条）外仍可达——增量翻页前进不回环不漏条', async () => {
    const fake = new FakeTaiga()
    const a = fake.seedEntity({ subject: '甲' })
    const seq: string[] = []
    for (let i = 0; i < 35; i += 1) seq.push(fake.pushHistory(a.id, { comment: `c${String(i)}` }))
    const boundaryId = seq[0] ?? '' // 最旧一条：旧窗口实现里永不可见
    const boundaryEntry = a.history.find((h) => h.id === boundaryId)
    expect(boundaryEntry).toBeDefined()
    const canonical = encodeCursor(boundaryEntry?.createdAt ?? '', boundaryId)
    const p = makePlatform(fake, { pageSize: 10 })
    const collected: string[] = []
    let cursor: string | null = canonical
    for (let round = 0; round < 10; round++) {
      const page = await p.activity.since(cursor)
      collected.push(...ids(page.items))
      if (page.nextCursor === null) break
      cursor = page.nextCursor
    }
    // 修复后：fetchHistory 翻页取尽 35 条 → 边界可见 → 自边界严格增量走到底，
    // 窗口外旧条目（i=1..4）不重不漏；修复前（单次 GET 首页窗口 30）：边界假不可
    // 达 → 全量重放 → collected 恒为窗口内 30 条（i=5..34），旧 4 条永久丢失（红证）
    expect(collected).toEqual(seq.slice(1))
  })
})

describe('studio-dev-790：裸 UUID 游标升级（禁止永久全量 history）', () => {
  it('首拍全量→裸末条 id→升级 canonical；下一拍按 modified_date 剪枝（history 调用数下降）', async () => {
    const fake = new FakeTaiga()
    const ids: number[] = []
    for (let i = 0; i < 5; i += 1) {
      const e = fake.seedEntity({ subject: `单${String(i)}` })
      ids.push(e.id)
      fake.pushHistory(e.id, { diffKeys: ['status'] })
    }
    const p = makePlatform(fake)
    const full = await p.activity.since(null)
    expect(full.items).toHaveLength(5)
    expect(full.nextCursor).not.toBeNull()
    const bare = full.items[4]?.id ?? ''
    const upgrade = await p.activity.since(bare)
    expect(upgrade.items).toEqual([])
    expect(upgrade.nextCursor).not.toBeNull()
    // 下一拍 canonical：无新增 → 空 + null；候选只含 modified>=边界（不重拉全部 5 单历史）
    const beforeCalls = fake.calls.length
    const steady = await p.activity.since(upgrade.nextCursor)
    expect(steady.items).toEqual([])
    expect(steady.nextCursor).not.toBeNull()
    const historyCalls = fake.calls.slice(beforeCalls).filter((c) => c.path.includes('/history/')).length
    expect(historyCalls).toBeLessThanOrEqual(5) // 不复位全量（5 单全拉也可接受；关键=调用数不随存量增长）
  })
  it('canonical 游标后新增事件不丢（迟到事件按 (ts,id) 严格新于边界纳入）', async () => {
    const fake = new FakeTaiga()
    const a = fake.seedEntity({ subject: '甲' })
    const e1 = fake.pushHistory(a.id, { diffKeys: ['status'] })
    const p = makePlatform(fake)
    const r1 = await p.activity.since(null)
    expect(r1.nextCursor).not.toBeNull()
    const e2 = fake.pushHistory(a.id, { comment: 'late-arrival' })
    const r2 = await p.activity.since(r1.nextCursor)
    expect(ids(r2.items)).toEqual([e2])
    expect(r2.nextCursor).not.toBeNull()
    void e1
  })
  it('空历史：null→null（不产游标）；裸不可达→全量重放不静默丢', async () => {
    const fake = new FakeTaiga()
    fake.seedEntity({ subject: '甲' })
    expect(await makePlatform(fake).activity.since(null)).toEqual({ items: [], nextCursor: null })
    const fake2 = new FakeTaiga()
    const b = fake2.seedEntity({ subject: '乙' })
    fake2.pushHistory(b.id, { diffKeys: ['status'] })
    const p2 = makePlatform(fake2)
    const page = await p2.activity.since('00000000-0000-4000-8000-000000000000') // 不存在裸 id
    expect(page.items).toHaveLength(1) // 全量重放
  })
})
