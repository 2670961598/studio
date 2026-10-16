/**
 * 生命周期测试：create → transition → setField → get / list 全链（含 IssueQuery 各过滤维）
 * 依据：docs/25-§3.2 端口语义 + docs/18-§二 状态权威（transition 唯一通道）
 */
import { rmSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_INITIAL_STATE, createLocalPlatform } from './index.ts'
import { expectLocalReject, fixedClock, tmpRoot } from './testutil.ts'

let root: string

beforeEach(() => {
  root = tmpRoot('lifecycle')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('issues 生命周期全链', () => {
  it('create：落盘 jsonl、id 单调、初始 state 默认 open', async () => {
    const p = createLocalPlatform(root)
    const a = await p.issues.create({ title: '甲', description: 'desc-1', type: 'task', dept: 'platform', level: 2 })
    const b = await p.issues.create({ title: '乙', parent: a.id })
    expect(a.id).toBe('LOCAL-1')
    expect(b.id).toBe('LOCAL-2')
    expect(a).toMatchObject({
      title: '甲',
      state: DEFAULT_INITIAL_STATE,
      type: 'task',
      dept: 'platform',
      level: 2,
    })
    expect(b.parent).toBe('LOCAL-1')
    // updated 是合法 ISO-8601 时间戳
    expect(Number.isNaN(Date.parse(a.updated))).toBe(false)
    // 落盘证据：issues/LOCAL-1.jsonl 首行是 created 事件
    const log = readFileSync(join(root, 'issues', 'LOCAL-1.jsonl'), 'utf8').trim().split('\n')
    expect(log.length).toBe(1)
    const created = JSON.parse(log[0] ?? '') as { type: string; input: { title: string } }
    expect(created.type).toBe('created')
    expect(created.input.title).toBe('甲')
  })

  it('transition：状态推进且只走 transition；updated 随之前进', async () => {
    const p = createLocalPlatform(root)
    const a = await p.issues.create({ title: '甲' })
    const t1 = await p.issues.transition(a.id, '已派发')
    expect(t1.state).toBe('已派发')
    expect(t1.updated >= a.updated).toBe(true)
    const t2 = await p.issues.transition(a.id, '证据就绪')
    const got = await p.issues.get(a.id)
    expect(got.state).toBe('证据就绪')
    expect(got.updated).toBe(t2.updated)
    // 事件流两条 transitioned
    const log = readFileSync(join(root, 'issues', `${a.id}.jsonl`), 'utf8').trim().split('\n')
    expect(log.length).toBe(3)
  })

  it('setField：各维度写入后 get 可见；description 留痕不进记录', async () => {
    const p = createLocalPlatform(root)
    const a = await p.issues.create({ title: '甲' })
    await p.issues.setField(a.id, 'assignee', 'emp-007')
    await p.issues.setField(a.id, 'lane', 'platform')
    await p.issues.setField(a.id, 'dept', 'infra')
    await p.issues.setField(a.id, 'type', 'bug')
    await p.issues.setField(a.id, 'level', 3)
    await p.issues.setField(a.id, 'parent', 'LOCAL-9')
    await p.issues.setField(a.id, 'title', '甲（改名）')
    await p.issues.setField(a.id, 'description', '新描述')
    const got = await p.issues.get(a.id)
    expect(got).toMatchObject({
      title: '甲（改名）',
      assignee: 'emp-007',
      lane: 'platform',
      dept: 'infra',
      type: 'bug',
      level: 3,
      parent: 'LOCAL-9',
    })
    // description 在事件流里留痕
    const log = readFileSync(join(root, 'issues', `${a.id}.jsonl`), 'utf8')
    expect(log).toContain('"field":"description"')
  })

  it('setField 拒收 state / 未知字段 / 类型错值；transition 拒收空状态', async () => {
    const p = createLocalPlatform(root)
    const a = await p.issues.create({ title: '甲' })
    await expectLocalReject(() => p.issues.setField(a.id, 'state', '已交付'), 'CONFIG_INVALID', 'state-via-set-field')
    await expectLocalReject(() => p.issues.setField(a.id, 'nonsense', 'x'), 'CONFIG_INVALID', 'unknown-field')
    await expectLocalReject(() => p.issues.setField(a.id, 'level', '三'), 'CONFIG_INVALID', 'bad-field-value')
    await expectLocalReject(() => p.issues.setField(a.id, 'title', ''), 'CONFIG_INVALID', 'bad-field-value')
    await expectLocalReject(() => p.issues.transition(a.id, '  '), 'CONFIG_INVALID', 'bad-state')
  })

  it('get 不存在的单据 → EXTERNAL_REJECT / issue-not-found', async () => {
    const p = createLocalPlatform(root)
    await expectLocalReject(() => p.issues.get('LOCAL-404'), 'EXTERNAL_REJECT', 'issue-not-found')
  })

  it('create 校验：空 title / 非法 level / 非字符串 dept 拒收（运行时口径）', async () => {
    const p = createLocalPlatform(root)
    await expectLocalReject(() => p.issues.create({ title: '' }), 'CONFIG_INVALID', 'bad-create-input')
    await expectLocalReject(() => p.issues.create({ title: 'x', level: 1.5 }), 'CONFIG_INVALID', 'bad-create-input')
    // 类型外的脏数据（外部输入路径）也要被运行时校验拦下
    const dirty = JSON.parse('{"title":"x","dept":3}') as Parameters<typeof p.issues.create>[0]
    await expectLocalReject(() => p.issues.create(dirty), 'CONFIG_INVALID', 'bad-create-input')
  })

  it('provision 后新建单：初始 state = states[0]，且不动历史单据', async () => {
    const p = createLocalPlatform(root)
    const before = await p.issues.create({ title: '旧单' })
    expect(before.state).toBe(DEFAULT_INITIAL_STATE)
    await p.fields.provision({
      fields: { rank: 'Rank' },
      states: ['新单', '已派发', '已交付'],
      stateFlow: { 新单: ['已派发'], 已派发: ['已交付'] },
    })
    const after = await p.issues.create({ title: '新单据' })
    expect(after.state).toBe('新单')
    // 历史单据初始 state 已定格在 created 事件，改 provision 不影响
    const still = await p.issues.get(before.id)
    expect(still.state).toBe(DEFAULT_INITIAL_STATE)
  })
})

describe('issues.list 过滤维', () => {
  it('stateIn / assignee / lane / updatedSince 各维过滤；stateIn=[] 全不中；project 忽略', async () => {
    // 固定步进时钟：updatedSince 的严格大于语义不靠真实时钟的 ms 抖动
    const p = createLocalPlatform(root, { now: fixedClock() })
    const a = await p.issues.create({ title: '甲', assignee: 'emp-1', type: 'task' })
    await p.issues.setField(a.id, 'lane', 'platform')
    await p.issues.transition(a.id, '已派发')
    const b = await p.issues.create({ title: '乙', assignee: 'emp-2' })
    await p.issues.setField(b.id, 'lane', 'im')
    const c = await p.issues.create({ title: '丙', assignee: 'emp-1' })
    await p.issues.transition(c.id, '已交付')

    expect((await p.issues.list({})).map((r) => r.id)).toEqual(['LOCAL-1', 'LOCAL-2', 'LOCAL-3'])

    expect((await p.issues.list({ stateIn: ['已派发'] })).map((r) => r.id)).toEqual(['LOCAL-1'])
    expect((await p.issues.list({ stateIn: ['已派发', '已交付'] })).map((r) => r.id)).toEqual(['LOCAL-1', 'LOCAL-3'])
    expect(await p.issues.list({ stateIn: [] })).toEqual([])

    expect((await p.issues.list({ assignee: 'emp-1' })).map((r) => r.id)).toEqual(['LOCAL-1', 'LOCAL-3'])
    expect((await p.issues.list({ lane: 'platform' })).map((r) => r.id)).toEqual(['LOCAL-1'])

    // updatedSince：严格大于（ISO-8601 字典序）
    expect((await p.issues.list({ updatedSince: a.updated })).map((r) => r.id)).toEqual(['LOCAL-2', 'LOCAL-3'])
    expect(await p.issues.list({ updatedSince: c.updated })).toEqual([])

    // 组合维
    expect((await p.issues.list({ stateIn: ['已交付'], assignee: 'emp-1' })).map((r) => r.id)).toEqual(['LOCAL-3'])
  })
})

describe('实例无内状态（同根多实例互通）', () => {
  it('第二个实例直接读到第一个实例的单据', async () => {
    const p1 = createLocalPlatform(root)
    const a = await p1.issues.create({ title: '甲' })
    const p2 = createLocalPlatform(root)
    const got = await p2.issues.get(a.id)
    expect(got.title).toBe('甲')
  })
})
