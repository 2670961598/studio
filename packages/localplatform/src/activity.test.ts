/**
 * 活动流测试（重点）：
 *  - 游标语义：连续三轮 since()——首轮全量、次轮只增量、无新增空+游标不动；
 *    穿插其他单活动不串；分页不重不漏；坏游标如实报错
 *  - 确定性回放：同一操作序列（+同一注入时钟）在两个根目录重放，activity.jsonl 逐字节一致
 * 依据：docs/25-§3.2 游标语义（NA1 教训：增量必须不重不漏）
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FlowPlatform } from '@studio-next/contract'
import { createLocalPlatform } from './index.ts'
import { expectLocalReject, fixedClock, tmpRoot } from './testutil.ts'

let root: string

beforeEach(() => {
  root = tmpRoot('activity')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const ids = (items: { id: string }[]): string[] => items.map((x) => x.id)

describe('游标语义：连续三轮 since()', () => {
  it('首轮全量 → 次轮只增量 → 无新增返回空（游标不动）', async () => {
    const p = createLocalPlatform(root)
    await p.issues.create({ title: '甲' }) // a-000001
    await p.issues.create({ title: '乙' }) // a-000002
    await p.comments.add('LOCAL-1', { body: 'first', signature: '[demo·平台部·工兵·L2]', author: 'AGENT-1' }) // a-000003

    // 第一轮：cursor=null 全量，升序，无更多
    const r1 = await p.activity.since(null)
    expect(ids(r1.items)).toEqual(['a-000001', 'a-000002', 'a-000003'])
    expect(r1.nextCursor).toBeNull()
    const cursor1 = r1.items[r1.items.length - 1]?.id
    expect(cursor1).toBe('a-000003')

    // 第二轮：只增量（新 transition），旧的不再出现
    await p.issues.transition('LOCAL-1', '已派发') // a-000004
    const r2 = await p.activity.since(cursor1 ?? null)
    expect(ids(r2.items)).toEqual(['a-000004'])
    expect(r2.items[0]).toMatchObject({ issue: 'LOCAL-1', kind: 'transitioned' })
    expect(r2.nextCursor).toBeNull()
    const cursor2 = r2.items[0]?.id

    // 第三轮：无新增 → 空 + null；调用方持有的游标原样再问，仍是空（游标不动）
    const r3 = await p.activity.since(cursor2 ?? null)
    expect(r3.items).toEqual([])
    expect(r3.nextCursor).toBeNull()
    const r3again = await p.activity.since(cursor2 ?? null)
    expect(r3again.items).toEqual([])
    expect(cursor2).toBe('a-000004')
  })

  it('穿插其他单的活动不串：边界是活动 id，不是单据', async () => {
    const p = createLocalPlatform(root)
    await p.issues.create({ title: '甲' }) // a-000001
    await p.issues.create({ title: '乙' }) // a-000002
    let page = await p.activity.since(null)
    const cursor = page.items[page.items.length - 1]?.id ?? null
    expect(cursor).toBe('a-000002')

    // 甲乙之外的丙丁穿插活动
    const c = await p.issues.create({ title: '丙' }) // a-000003
    await p.comments.add('LOCAL-2', { body: 'on B', signature: '[s]', author: 'AGENT-1' }) // a-000004（乙的单）
    await p.issues.setField(c.id, 'lane', 'platform') // a-000005（丙的单）
    await p.issues.transition('LOCAL-1', '已派发') // a-000006（甲的单，压轴）

    page = await p.activity.since(cursor)
    expect(ids(page.items)).toEqual(['a-000003', 'a-000004', 'a-000005', 'a-000006'])
    // 逐条归属正确（不串单）
    expect(page.items.map((x) => x.issue)).toEqual(['LOCAL-3', 'LOCAL-2', 'LOCAL-3', 'LOCAL-1'])
    expect(page.items.map((x) => x.kind)).toEqual(['created', 'commented', 'field-set', 'transitioned'])
    // 评论活动带 actor（v1.2：actor=工号归因；署名是展示形态）
    expect(page.items[1]?.actor).toBe('AGENT-1')
    // 再问一轮：空
    const tail = page.items[page.items.length - 1]?.id ?? null
    expect(await p.activity.since(tail)).toEqual({ items: [], nextCursor: null })
  })

  it('游标边界精确：since(a-000003) 不重不漏（不含 3，含 4、5）', async () => {
    const p = createLocalPlatform(root)
    for (const t of ['一', '二', '三', '四', '五']) await p.issues.create({ title: t }) // a-000001..5
    const page = await p.activity.since('a-000003')
    expect(ids(page.items)).toEqual(['a-000004', 'a-000005'])
    expect(page.nextCursor).toBeNull()
  })

  it('坏游标如实报错（不静默当从头）', async () => {
    const p = createLocalPlatform(root)
    await p.issues.create({ title: '甲' })
    await expectLocalReject(() => p.activity.since('garbage'), 'CONFIG_INVALID', 'bad-cursor')
    await expectLocalReject(() => p.activity.since('a-0000xx'), 'CONFIG_INVALID', 'bad-cursor')
    await expectLocalReject(() => p.activity.since('a-0'), 'CONFIG_INVALID', 'bad-cursor')
  })

  it('分页（pageSize=2）：nextCursor 翻页，拼起来不重不漏', async () => {
    const p = createLocalPlatform(root, { pageSize: 2 })
    const a = await p.issues.create({ title: '一' }) // 1
    await p.issues.create({ title: '二' }) // 2
    await p.issues.create({ title: '三' }) // 3
    await p.comments.add(a.id, { body: 'x', signature: '[s]', author: 'AGENT-1' }) // 4
    await p.issues.transition(a.id, '已派发') // 5

    const collected: string[] = []
    let cursor: string | null = null
    for (let round = 0; round < 10; round++) {
      const page = await p.activity.since(cursor)
      collected.push(...ids(page.items))
      if (page.nextCursor === null) break
      cursor = page.nextCursor
    }
    expect(collected).toEqual(['a-000001', 'a-000002', 'a-000003', 'a-000004', 'a-000005'])

    // 首页边界正确
    const first = await p.activity.since(null)
    expect(ids(first.items)).toEqual(['a-000001', 'a-000002'])
    expect(first.nextCursor).toBe('a-000002')
  })
})

describe('确定性回放', () => {
  const runScenario = async (dir: string): Promise<void> => {
    const p = createLocalPlatform(dir, { now: fixedClock() })
    await p.fields.provision({
      fields: { rank: 'Rank' },
      states: ['新单', '已派发', '已交付'],
      stateFlow: { 新单: ['已派发'], 已派发: ['已交付'] },
    })
    await p.issues.create({ title: '甲', description: '描述', type: 'task', dept: 'platform', level: 2 })
    await p.issues.create({ title: '乙', parent: 'LOCAL-1' })
    await p.issues.transition('LOCAL-1', '已派发')
    await p.issues.setField('LOCAL-2', 'lane', 'platform')
    await p.comments.add('LOCAL-1', { body: '评论第一行\n评论第二行', signature: '[demo·平台部·工兵·L2]', author: 'AGENT-1' })
    await p.comments.add('LOCAL-2', { body: 'ok', signature: '[demo·平台部·PM·L3]', author: 'AGENT-1' })
    await p.links.link('LOCAL-1', 'LOCAL-2', 'parent-child')
    await p.kb.upsert('guide/deploy.md', '# 部署指南\n零依赖跑法')
    await p.guards.install('demo-co', [{ from: '新单', to: '已派发' }])
  }

  it('同一操作序列重放：activity.jsonl 逐字节一致（含单据/评论文件）', async () => {
    const rootA = tmpRoot('replay-a')
    const rootB = tmpRoot('replay-b')
    try {
      await runScenario(rootA)
      await runScenario(rootB)

      const read = (dir: string, rel: string): string => readFileSync(join(dir, rel), 'utf8')
      for (const rel of [
        'activity.jsonl',
        'issues/LOCAL-1.jsonl',
        'issues/LOCAL-2.jsonl',
        'issues/LOCAL-1.comments.md',
        'issues/LOCAL-2.comments.md',
        'meta/links.jsonl',
      ]) {
        const a = read(rootA, rel)
        const b = read(rootB, rel)
        expect(a.length, `${rel} 不该是空文件`).toBeGreaterThan(0)
        expect(b, `${rel} 逐字节一致`).toBe(a)
      }
      // 活动内容非平凡（6 条：created×2 + transition + setField + comment×2；
      // link/kb/guards 变更不进活动流——PlatformActivity.issue 必填的端口疑点，见 index 头注）
      const lines = read(rootA, 'activity.jsonl').trim().split('\n')
      expect(lines.length).toBe(6)
      expect(lines[0]).toContain('"id":"a-000001"')
      expect(lines[5]).toContain('"id":"a-000006"')
    } finally {
      rmSync(rootA, { recursive: true, force: true })
      rmSync(rootB, { recursive: true, force: true })
    }
  })

  it('回放后轮询视角一致：两根各自 since(null) 拿到相同 id 序列', async () => {
    const rootA = tmpRoot('replay-poll-a')
    const rootB = tmpRoot('replay-poll-b')
    try {
      await runScenario(rootA)
      await runScenario(rootB)
      const pa: FlowPlatform = createLocalPlatform(rootA)
      const pb: FlowPlatform = createLocalPlatform(rootB)
      const ra = await pa.activity.since(null)
      const rb = await pb.activity.since(null)
      expect(ids(ra.items)).toEqual(ids(rb.items))
      expect(JSON.stringify(ra.items)).toBe(JSON.stringify(rb.items))
    } finally {
      rmSync(rootA, { recursive: true, force: true })
      rmSync(rootB, { recursive: true, force: true })
    }
  })
})
