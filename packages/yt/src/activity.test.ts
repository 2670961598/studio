/**
 * 活动流测试（重点，口径对齐 localplatform 基线）：
 *  - 游标语义：连续三轮 since()——首轮全量、次轮只增量、无新增空+游标不动；
 *    穿插其他单活动不串；分页不重不漏；坏游标如实报错
 *  - 请求契约：activities 只用 fields/$top/$skip（绝无 after/start——NA1）
 *  - 公司作用域：项目前缀过滤；非单据活动（kb 类）保留
 *  - 写后即见：transition/评论自动产生活动，下轮轮询拾取
 * 依据：docs/25-§3.2 游标语义 + docs/03 N10
 */
import { describe, expect, it } from 'vitest'
import { FakeYouTrack, makePlatform, expectYtReject } from './testutil.ts'

const ids = (items: { id: string }[]): string[] => items.map((x) => x.id)

describe('游标语义：连续三轮 since()', () => {
  it('首轮全量（升序）→ 次轮只增量 → 无新增返回空（游标不动）', async () => {
    const fake = new FakeYouTrack()
    const p = makePlatform(fake, { project: 'STUDIO' })

    // 第一轮：cursor=null 全量，升序，无更多（POLY 活动被公司作用域滤除）
    const r1 = await p.activity.since(null)
    expect(ids(r1.items)).toEqual(['168-1', '168-2', '168-3', '168-4', '168-5', '168-6', '168-7'])
    expect(r1.nextCursor).toBeNull()
    const cursor1 = r1.items[r1.items.length - 1]?.id
    expect(cursor1).toBe('168-7')

    // 第二轮：写后即见——transition 产生新活动，只增量返回
    await p.issues.transition('STUDIO-1', '已派发')
    const r2 = await p.activity.since(cursor1 ?? null)
    expect(ids(r2.items)).toEqual(['170-1'])
    expect(r2.items[0]).toMatchObject({ issue: 'STUDIO-1', kind: 'field-set', actor: 'svc-agent' })
    expect(r2.nextCursor).toBeNull()
    const cursor2 = r2.items[0]?.id

    // 第三轮：无新增 → 空 + null；调用方游标原样再问，仍是空（游标不动）
    const r3 = await p.activity.since(cursor2 ?? null)
    expect(r3.items).toEqual([])
    expect(r3.nextCursor).toBeNull()
    expect(await p.activity.since(cursor2 ?? null)).toEqual({ items: [], nextCursor: null })
    expect(cursor2).toBe('170-1')
  })

  it('穿插其他单的活动不串：边界是活动 id，不是单据', async () => {
    const fake = new FakeYouTrack()
    const p = makePlatform(fake, { project: 'STUDIO' })
    const page = await p.activity.since(null)
    const cursor = page.items[page.items.length - 1]?.id ?? null

    // 三个单的活动穿插注入（时间步进=注入顺序）
    fake.pushActivity({ timestamp: 1767225608000, category: 'IssueCreatedCategory', issueIdReadable: 'STUDIO-4', login: 'agent-1' })
    fake.pushActivity({ timestamp: 1767225609000, category: 'IssueCommentedCategory', issueIdReadable: 'STUDIO-2', login: 'agent-2' })
    fake.pushActivity({ timestamp: 1767225610000, category: 'IssueUpdatedCategory', issueIdReadable: 'STUDIO-4', login: 'agent-1' })
    fake.pushActivity({ timestamp: 1767225611000, category: 'IssueUpdatedCategory', issueIdReadable: 'STUDIO-1', login: 'agent-3' })

    const next = await p.activity.since(cursor)
    expect(ids(next.items)).toEqual(['170-1', '170-2', '170-3', '170-4'])
    // 逐条归属正确（不串单）；kind 归一动词
    expect(next.items.map((x) => x.issue)).toEqual(['STUDIO-4', 'STUDIO-2', 'STUDIO-4', 'STUDIO-1'])
    expect(next.items.map((x) => x.kind)).toEqual(['created', 'commented', 'field-set', 'field-set'])
    expect(next.items.map((x) => x.actor)).toEqual(['agent-1', 'agent-2', 'agent-1', 'agent-3'])
    // 再问一轮：空
    const tail = next.items[next.items.length - 1]?.id ?? null
    expect(await p.activity.since(tail)).toEqual({ items: [], nextCursor: null })
  })

  it('游标边界精确：since(168-6) 不重不漏（不含 6，含 7）', async () => {
    const fake = new FakeYouTrack()
    const p = makePlatform(fake, { project: 'STUDIO' })
    const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64url')
    const cursor = b64(JSON.stringify({ v: 1, last: '168-6' }))
    const page = await p.activity.since(cursor)
    expect(ids(page.items)).toEqual(['168-7'])
    expect(page.nextCursor).toBeNull()
  })

  it('坏游标如实报错（不静默当从头）', async () => {
    const fake = new FakeYouTrack()
    const p = makePlatform(fake, { project: 'STUDIO' })
    const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64url')
    await expectYtReject(() => p.activity.since('garbage'), 'CONFIG_INVALID', 'bad-cursor')
    await expectYtReject(() => p.activity.since(b64('not json')), 'CONFIG_INVALID', 'bad-cursor')
    await expectYtReject(() => p.activity.since(b64('{"v":1}')), 'CONFIG_INVALID', 'bad-cursor') // 缺 last
    await expectYtReject(() => p.activity.since(b64('{"v":2,"last":"168-7"}')), 'CONFIG_INVALID', 'bad-cursor') // 版本不认
    await expectYtReject(() => p.activity.since(b64('{"v":1,"last":"  "}')), 'CONFIG_INVALID', 'bad-cursor') // 空边界
  })

  it('分页（pageSize=2）：nextCursor 翻页，拼起来不重不漏', async () => {
    const fake = new FakeYouTrack()
    const p = makePlatform(fake, { project: 'STUDIO', pageSize: 2 })

    const collected: string[] = []
    let cursor: string | null = null
    for (let round = 0; round < 10; round++) {
      const page = await p.activity.since(cursor)
      collected.push(...ids(page.items))
      if (page.nextCursor === null) break
      cursor = page.nextCursor
    }
    expect(collected).toEqual(['168-1', '168-2', '168-3', '168-4', '168-5', '168-6', '168-7'])

    // 首页边界正确
    const first = await p.activity.since(null)
    expect(ids(first.items)).toEqual(['168-1', '168-2'])
    expect(first.nextCursor).not.toBeNull()
    // 翻页期间新增活动：并入后续页（边界按活动 id，不丢不重）
    fake.pushActivity({ timestamp: 1767225608000, category: 'IssueCommentedCategory', issueIdReadable: 'STUDIO-3' })
    const again: string[] = []
    let c2: string | null = null
    for (let round = 0; round < 10; round++) {
      const page = await p.activity.since(c2)
      again.push(...ids(page.items))
      if (page.nextCursor === null) break
      c2 = page.nextCursor
    }
    expect(again.length).toBe(8)
    expect(new Set(again).size).toBe(8)
  })
})

describe('请求契约与公司作用域', () => {
  it('activities 请求参数集=fields/$top/$skip/reverse/categories——绝无 after/start（NA1；reverse/categories 为 2026-10-17 真实例冒烟实证必带：默认排序旧→新、缺 categories 即 400）', async () => {
    const fake = new FakeYouTrack()
    const p = makePlatform(fake, { project: 'STUDIO', pageSize: 3 })
    let cursor: string | null = null
    for (let round = 0; round < 5; round++) {
      const page = await p.activity.since(cursor)
      if (page.nextCursor === null) break
      cursor = page.nextCursor
    }
    const activityCalls = fake.calls.filter((c) => c.path === '/api/activities')
    expect(activityCalls.length).toBeGreaterThan(1)
    for (const call of activityCalls) {
      // 契约：参数集恰为五项（after/start 会被静默忽略→漏增量；reverse/categories 为
      // 2026-10-17 真实例冒烟实证必带：默认排序旧→新、缺 categories 即 400）
      expect(Object.keys(call.query).sort()).toEqual(['$skip', '$top', 'categories', 'fields', 'reverse'])
      expect(call.query['$top']).toBe('3')
    }
    // 单轮全量取数确实推进过 $skip（倒序翻页发生）
    const skips = activityCalls.map((c) => c.query['$skip'])
    expect(skips.some((s) => s !== '0')).toBe(true)
  })

  it('公司作用域：POLY 平台只见 POLY 活动；非单据活动保留；无绑定=全量', async () => {
    const poly = makePlatform(new FakeYouTrack(), { project: 'POLY' })
    const scoped = await poly.activity.since(null)
    expect(ids(scoped.items)).toEqual(['168-4', '168-8']) // 168-4=文章活动（无单，保留）
    expect(scoped.items[1]?.issue).toBe('POLY-1')

    const noscope = makePlatform(new FakeYouTrack())
    const all = await noscope.activity.since(null)
    expect(ids(all.items)).toEqual(['168-1', '168-2', '168-3', '168-4', '168-5', '168-6', '168-7', '168-8'])
  })

  it('未知类别原样透传（kind 词表未冻结——契约疑点见 index 头注）', async () => {
    const p = makePlatform(new FakeYouTrack(), { project: 'STUDIO' })
    const page = await p.activity.since(null)
    const article = page.items.find((x) => x.id === '168-4')
    expect(article).toMatchObject({ kind: 'ArticlesCategory' })
    expect(article?.issue).toBeUndefined()
    const links = page.items.find((x) => x.id === '168-5')
    expect(links?.kind).toBe('IssueLinksCategory')
  })

  it('ts 由平台时间戳派生为 ISO-8601', async () => {
    const p = makePlatform(new FakeYouTrack(), { project: 'STUDIO' })
    const page = await p.activity.since(null)
    expect(page.items[0]?.ts).toBe('2026-01-01T00:00:00.000Z')
    expect(Number.isNaN(Date.parse(page.items[6]?.ts ?? ''))).toBe(false)
  })
})
