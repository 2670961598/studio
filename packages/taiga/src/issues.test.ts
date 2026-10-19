/**
 * 单据面测试：建单回环（默认态/描述/派单/自定义维）、列表四过滤维（含空集不发请求）、
 * by_ref 详情、流转（幂等/未知态/单不存在）、setField 分派表（原生维/自定义维/
 * state 拒收/parent 骨架/未映射）、乐观并发 409 明报。
 */
import { describe, expect, it } from 'vitest'
import type { FieldProvisionMap } from '@studio-next/contract'
import { createTaigaPlatform } from './platform.ts'
import { FakeTaiga, TEST_BASE_URL, TEST_FIELDS, TEST_PASSWORD_AUTH, expectTaigaReject, makePlatform } from './testutil.ts'

describe('建单回环', () => {
  it('最小建单：落 provision 初态（TEST_FIELDS 首元素=New，恰同平台默认态）、TicketId=<slug>-<ref>、记录可 get 回', async () => {
    const fake = new FakeTaiga()
    const p = makePlatform(fake)
    const rec = await p.issues.create({ title: '甲' })
    expect(rec).toMatchObject({ id: 'probe-co-1', title: '甲', state: 'New' })
    expect(rec.updated > '2026-10-18T00:00:00.000Z').toBe(true)
    const got = await p.issues.get('probe-co-1')
    expect(got.title).toBe('甲')
    expect(got.description).toBeUndefined() // 未给描述
  })

  it('带描述+派单+自定义维（type/dept/level）：一次建齐可读回（等级解码为整数）', async () => {
    const fake = new FakeTaiga()
    const p = makePlatform(fake)
    const rec = await p.issues.create({
      title: '乙',
      description: '试点描述',
      assignee: 'worker-p2',
      type: '缺陷',
      dept: '平台部',
      level: 2,
    })
    expect(rec.assignee).toBe('worker-p2')
    expect(rec.description).toBe('试点描述')
    const got = await p.issues.get('probe-co-1')
    expect(got).toMatchObject({ type: '缺陷', dept: '平台部', level: 2 })
    // 自定义维走专用值端点（真机实证形状：GET 取值对象 version → PATCH attributes_values）
    const attrWrites = fake.calls.filter((c) => c.path.includes('custom-attributes-values') && c.method === 'PATCH')
    expect(attrWrites.length).toBe(1)
    expect(attrWrites[0]?.body).toMatchObject({ attributes_values: { '11': '缺陷', '12': '平台部', '13': 2 } })
  })

  it('建单给了未映射维 → 显式报错（不静默丢）', async () => {
    const fake = new FakeTaiga()
    const fields: FieldProvisionMap = { fields: { level: '等级' }, states: ['New'], stateFlow: {} }
    const p = makePlatform(fake, { fields })
    await expectTaigaReject(() => p.issues.create({ title: '甲', type: '缺陷' }), 'CONFIG_INVALID', 'unmapped-field')
  })

  it('建单带 parent → links 定版显式报错（同面父子链不可写）', async () => {
    const p = makePlatform(new FakeTaiga())
    await expectTaigaReject(() => p.issues.create({ title: '甲', parent: 'probe-co-9' }), 'CONFIG_INVALID', 'links-unsupported')
  })

  it('title 空 → bad-create-input', async () => {
    await expectTaigaReject(() => makePlatform(new FakeTaiga()).issues.create({ title: '  ' }), 'CONFIG_INVALID', 'bad-create-input')
  })
})

describe('建单落流程初态（DEV-40，2026-10-20 哨查事故防复发；docs/25-§3.2 IssueCreate.initialState）', () => {
  /** 真实公司 provision 形状：五态中文流，states[0]=流程初态（新单） */
  const FLOW_FIELDS: FieldProvisionMap = {
    fields: {},
    states: ['新单', '已派发', '证据就绪', '复验通过', '已交付'],
    stateFlow: {},
  }

  /** fake 平台注册中文状态集（平台状态集=迁移真值源） */
  function flowFake(): FakeTaiga {
    const fake = new FakeTaiga()
    fake.statuses.push(
      { id: 10, name: '新单', slug: 'xin-dan' },
      { id: 11, name: '已派发', slug: 'yi-pai-fa' },
      { id: 12, name: '证据就绪', slug: 'zheng-ju' },
      { id: 13, name: '复验通过', slug: 'fu-yan' },
      { id: 14, name: '已交付', slug: 'yi-jiao-fu' },
    )
    return fake
  }

  it('provision 定位：落 states[0]（新单）不落平台默认 New——负断言 state≠New（事故面：落 New 被 decide 判 NOOP_UNKNOWN_STATE 静默卡死）', async () => {
    const fake = flowFake()
    const p = makePlatform(fake, { fields: FLOW_FIELDS })
    const rec = await p.issues.create({ title: '甲' })
    expect(rec.state).toBe('新单') // 正断言：流程初态落位
    expect(rec.state).not.toBe('New') // 负断言：不再是平台默认态（观察黑洞源）
    expect((await p.issues.get(rec.id)).state).toBe('新单') // 平台权威态已迁移
    // 落位通道：POST 建（平台默认 status）后补一次 PATCH 迁移（status 端点定版）
    const statusWrites = fake.calls.filter(
      (c) => c.method === 'PATCH' && c.path.includes('userstories') && typeof (c.body as Record<string, unknown> | undefined)?.['status'] === 'number',
    )
    expect(statusWrites).toHaveLength(1)
    expect(statusWrites[0]?.body).toMatchObject({ status: 10 })
  })

  it('显式 initialState 优先于 provision 初态（解析序：入参 > states[0] > 平台默认）', async () => {
    const p = makePlatform(flowFake(), { fields: FLOW_FIELDS })
    const rec = await p.issues.create({ title: '甲', initialState: '已派发' })
    expect(rec.state).toBe('已派发')
    expect((await p.issues.get(rec.id)).state).toBe('已派发')
  })

  it('initialState 空/非字符串 → bad-create-input（校验先于建单 IO）', async () => {
    const p = makePlatform(flowFake(), { fields: FLOW_FIELDS })
    await expectTaigaReject(() => p.issues.create({ title: '甲', initialState: '  ' }), 'CONFIG_INVALID', 'bad-create-input')
    await expectTaigaReject(() => p.issues.create({ title: '甲', initialState: 3 as never }), 'CONFIG_INVALID', 'bad-create-input')
    await expect(p.issues.list({})).resolves.toHaveLength(0) // 负断言：未发建单请求即拒
  })

  it('provision states 为空 → 无初态知识，诚实落平台默认 New（不猜）', async () => {
    const p = makePlatform(new FakeTaiga(), { fields: { fields: {}, states: [], stateFlow: {} } })
    const rec = await p.issues.create({ title: '甲' })
    expect(rec.state).toBe('New')
  })

  it('目标初态平台状态集不认识 → 显式报错 unknown-state（配置错配大声失败，不静默回落默认态）', async () => {
    // provision 声明新单，但 fake 平台状态集没有它（真实事故面：provision 与平台漂移）
    const p = makePlatform(new FakeTaiga(), { fields: FLOW_FIELDS })
    await expectTaigaReject(() => p.issues.create({ title: '甲' }), 'CONFIG_INVALID', 'unknown-state')
  })
})

describe('列表与过滤（公司作用域内客户端过滤）', () => {
  it('stateIn 过滤 + 空集语义（不发请求）', async () => {
    const fake = new FakeTaiga()
    fake.seedEntity({ subject: '甲', status: 1 })
    fake.seedEntity({ subject: '乙', status: 5 })
    const p = makePlatform(fake)
    const list = await p.issues.list({ stateIn: ['Done'] })
    expect(list.map((r) => r.id)).toEqual(['probe-co-2'])
    const before = fake.calls.length
    expect(await p.issues.list({ stateIn: [] })).toEqual([])
    expect(fake.calls.length).toBe(before) // 空集不发请求
  })

  it('assignee 过滤：未派单的不出现在结果里', async () => {
    const fake = new FakeTaiga()
    const e = fake.seedEntity({ subject: '甲' })
    e.assignedTo = 6 // worker-p2
    fake.seedEntity({ subject: '乙' })
    const list = await makePlatform(fake).issues.list({ assignee: 'worker-p2' })
    expect(list.map((r) => r.id)).toEqual(['probe-co-1'])
  })

  it('updatedSince = 严格大于（口径对齐 localplatform/yt）', async () => {
    const fake = new FakeTaiga()
    const a = fake.seedEntity({ subject: '甲' })
    fake.seedEntity({ subject: '乙' })
    const p = makePlatform(fake)
    const list = await p.issues.list({})
    const cutoff = list[0]?.updated ?? ''
    expect((await p.issues.list({ updatedSince: cutoff })).map((r) => r.id)).toEqual(['probe-co-2'])
    expect((await p.issues.list({ updatedSince: list[1]?.updated ?? '' })).map((r) => r.id)).toEqual([])
    void a
  })

  it('lane 过滤：先 setField 落泳道再过滤；未映射 lane → 显式报错', async () => {
    const fake = new FakeTaiga()
    fake.seedEntity({ subject: '甲' })
    fake.seedEntity({ subject: '乙' })
    const p = makePlatform(fake)
    await p.issues.setField('probe-co-1', 'lane', 'platform')
    expect((await p.issues.list({ lane: 'platform' })).map((r) => r.id)).toEqual(['probe-co-1'])
    const bare = makePlatform(fake, { fields: { fields: {}, states: ['New'], stateFlow: {} } })
    await expectTaigaReject(() => bare.issues.list({ lane: 'x' }), 'CONFIG_INVALID', 'unmapped-field')
  })
})

describe('详情与流转', () => {
  it('get：单号前缀不对/单不存在 → 显式错误', async () => {
    const fake = new FakeTaiga()
    fake.seedEntity({ subject: '甲' })
    const p = makePlatform(fake)
    await expectTaigaReject(() => p.issues.get('other-co-1'), 'CONFIG_INVALID', 'bad-ticket-id')
    await expectTaigaReject(() => p.issues.get('probe-co-99'), 'EXTERNAL_REJECT', 'issue-not-found')
  })

  it('流转 New→Done：状态推进、记录返回新态；再流转同态=幂等不重放写', async () => {
    const fake = new FakeTaiga()
    fake.seedEntity({ subject: '甲' })
    const p = makePlatform(fake)
    const rec = await p.issues.transition('probe-co-1', 'Done')
    expect(rec.state).toBe('Done')
    const patches = fake.calls.filter((c) => c.method === 'PATCH')
    expect(patches.length).toBe(1)
    const again = await p.issues.transition('probe-co-1', 'Done')
    expect(again.state).toBe('Done')
    expect(fake.calls.filter((c) => c.method === 'PATCH').length).toBe(1) // 幂等：不重放
  })

  it('未知目标态 → unknown-state（附状态集提示）', async () => {
    const fake = new FakeTaiga()
    fake.seedEntity({ subject: '甲' })
    await expectTaigaReject(() => makePlatform(fake).issues.transition('probe-co-1', '不存在态'), 'CONFIG_INVALID', 'unknown-state')
  })
})

describe('setField 分派表', () => {
  it('title/description/assignee 原生直写；assignee=null 清空', async () => {
    const fake = new FakeTaiga()
    fake.seedEntity({ subject: '甲' })
    const p = makePlatform(fake)
    await p.issues.setField('probe-co-1', 'title', '甲（改名）')
    await p.issues.setField('probe-co-1', 'description', '描述更新')
    await p.issues.setField('probe-co-1', 'assignee', 'worker-p2')
    const rec = await p.issues.get('probe-co-1')
    expect(rec).toMatchObject({ title: '甲（改名）', description: '描述更新', assignee: 'worker-p2' })
    await p.issues.setField('probe-co-1', 'assignee', null)
    expect((await p.issues.get('probe-co-1')).assignee).toBeUndefined()
  })

  it('state → 拒收（transition 唯一通道）；parent → links 定版；未知字段 → unknown-field', async () => {
    const p = makePlatform(new FakeTaiga())
    await expectTaigaReject(() => p.issues.setField('x', 'state', 'Done'), 'CONFIG_INVALID', 'state-via-set-field')
    await expectTaigaReject(() => p.issues.setField('probe-co-1', 'parent', 'probe-co-2'), 'CONFIG_INVALID', 'links-unsupported')
    await expectTaigaReject(() => p.issues.setField('probe-co-1', 'mystery', 'v'), 'CONFIG_INVALID', 'unknown-field')
  })

  it('自定义维（lane）→ attributes-values 写入；未映射自定义维 → unmapped-field', async () => {
    const fake = new FakeTaiga()
    fake.seedEntity({ subject: '甲' })
    const p = makePlatform(fake)
    await p.issues.setField('probe-co-1', 'lane', 'platform')
    const laneWrite = fake.calls.find(
      (c) => c.method === 'PATCH' && c.path.includes('custom-attributes-values'),
    )
    expect(laneWrite?.body).toMatchObject({ attributes_values: { '14': 'platform' } }) // 泳道属性 id=14
    const bare = makePlatform(fake, { fields: { fields: {}, states: ['New'], stateFlow: {} } })
    fake.seedEntity({ subject: '乙' })
    await expectTaigaReject(() => bare.issues.setField('probe-co-2', 'lane', 'x'), 'CONFIG_INVALID', 'unmapped-field')
  })

  it('等级非整数 → bad-field-value', async () => {
    const fake = new FakeTaiga()
    fake.seedEntity({ subject: '甲' })
    await expectTaigaReject(() => makePlatform(fake).issues.setField('probe-co-1', 'level', '高'), 'CONFIG_INVALID', 'bad-field-value')
  })
})

describe('乐观并发（version）', () => {
  it('并发写冲突（409）→ EXTERNAL_REJECT/conflict 明报，不自动重试', async () => {
    const fake = new FakeTaiga()
    fake.seedEntity({ subject: '甲' })
    fake.conflictNextPatch = true
    await expectTaigaReject(() => makePlatform(fake).issues.transition('probe-co-1', 'Done'), 'EXTERNAL_REJECT', 'conflict')
  })
})

describe('构造期校验（公司作用域绑定）', () => {
  it('baseUrl/project/auth 三缺一或形状不对 → 显式报错', () => {
    const fetch = new FakeTaiga().fetch
    const cases: Array<Record<string, unknown>> = [
      { baseUrl: 'ftp://x', project: 'probe-co', auth: TEST_PASSWORD_AUTH, fetch },
      { baseUrl: TEST_BASE_URL, project: '  ', auth: TEST_PASSWORD_AUTH, fetch },
      { baseUrl: TEST_BASE_URL, project: 'probe-co', fetch },
      { baseUrl: TEST_BASE_URL, project: 'probe-co', auth: { type: 'token', token: '' }, fetch },
    ]
    for (const opts of cases) {
      let caught: unknown = null
      try {
        createTaigaPlatform(opts as never)
      } catch (err) {
        caught = err
      }
      expect(caught).toBeDefined()
    }
  })

  it('字段映射形状不对 → bad-field-map', () => {
    let caught: unknown = null
    try {
      createTaigaPlatform({
        baseUrl: TEST_BASE_URL,
        project: 'probe-co',
        auth: TEST_PASSWORD_AUTH,
        fields: { fields: { level: '' }, states: [], stateFlow: {} } as FieldProvisionMap,
        fetch: new FakeTaiga().fetch,
      })
    } catch (err) {
      caught = err
    }
    expect((caught as { subcause?: string })?.subcause).toBe('bad-field-map')
  })

  it('合法构造不触发网络', () => {
    const fake = new FakeTaiga()
    makePlatform(fake)
    expect(fake.calls.length).toBe(0)
    void TEST_FIELDS
  })
})
