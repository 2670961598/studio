/**
 * 单据面测试：
 *  - 映射往返：IssueRecord ↔ YouTrack customFields（enum={name}/person={login}/int 裸值）
 *  - 查询翻译：IssueQuery → YouTrack 查询语言（白名单语法）+ 未映射过滤维显式报错
 *  - 生命周期：create（含 parent 落链/项目绑定/N11 按名解析）/transition/setField 分派
 *  - 建单落流程初态（DEV-40）：显式 initialState > provision states[0] > 实例默认
 *  - 分页拼接：$top/$skip 内部翻页取全量
 * 依据：docs/25-§3.2 + docs/03 N10/N11
 */
import { describe, expect, it } from 'vitest'
import { TEST_PROVISION, FakeYouTrack, expectYtReject, makePlatform } from './testutil.ts'
import type { FieldProvisionMap } from '@studio-next/contract'

const lastCallTo = (fake: FakeYouTrack, method: string, path: string): (typeof fake.calls)[number] | undefined =>
  [...fake.calls].reverse().find((c) => c.method === method && c.path === path)

describe('读映射：IssueJson → IssueRecord', () => {
  it('get：全维映射（enum/person/int/内建/parent 派生）', async () => {
    const p = makePlatform(new FakeYouTrack(), { project: 'STUDIO' })
    const rec = await p.issues.get('STUDIO-1')
    expect(rec).toMatchObject({
      id: 'STUDIO-1',
      title: '甲：走通全流程',
      state: '待批',
      description: '甲单描述',
      type: '需求',
      dept: '平台部',
      level: 2,
      assignee: 'emp-1',
      lane: 'platform',
    })
    expect(rec.parent).toBeUndefined()
    expect(rec.updated).toBe('2026-01-01T00:00:05.000Z')
  })

  it('get：parent 从 INWARD Subtask 链派生；未携带维缺省', async () => {
    const p = makePlatform(new FakeYouTrack(), { project: 'STUDIO' })
    const rec = await p.issues.get('STUDIO-2')
    expect(rec).toMatchObject({ id: 'STUDIO-2', state: '已派发', assignee: 'emp-2', parent: 'STUDIO-1' })
    expect(rec.description).toBeUndefined()
    expect(rec.dept).toBeUndefined()
  })

  it('get：字段缺 State（实例与 provision 漂移）→ CONFIG_INVALID 明报', async () => {
    const fake = new FakeYouTrack()
    const issue = fake.issues.find((i) => i.idReadable === 'STUDIO-3')
    if (issue !== undefined) issue.customFields = []
    const p = makePlatform(fake, { project: 'STUDIO' })
    await expectYtReject(() => p.issues.get('STUDIO-3'), 'CONFIG_INVALID', 'issue-missing-state')
  })

  it('get 不存在 → EXTERNAL_REJECT / issue-not-found', async () => {
    const p = makePlatform(new FakeYouTrack(), { project: 'STUDIO' })
    await expectYtReject(() => p.issues.get('STUDIO-404'), 'EXTERNAL_REJECT', 'issue-not-found')
  })

  it('未映射的记录维：读侧跳过（映射了才可见）', async () => {
    const fields: FieldProvisionMap = { ...TEST_PROVISION, fields: { state: 'State' } } // 只映射 state
    const p = makePlatform(new FakeYouTrack(), { project: 'STUDIO', fields })
    const rec = await p.issues.get('STUDIO-1')
    expect(rec).toMatchObject({ id: 'STUDIO-1', state: '待批' })
    expect(rec.dept).toBeUndefined()
    expect(rec.assignee).toBeUndefined()
  })
})

describe('list：查询翻译与分页拼接', () => {
  it('空查询：项目作用域子句 + 排序子句；POLY 单不在结果', async () => {
    const fake = new FakeYouTrack()
    const p = makePlatform(fake, { project: 'STUDIO' })
    const list = await p.issues.list({})
    expect(list.map((r) => r.id)).toEqual(['STUDIO-1', 'STUDIO-2', 'STUDIO-3'])
    const call = lastCallTo(fake, 'GET', '/api/issues')
    expect(call?.query['query']).toBe('project: STUDIO sort by: updated asc')
    expect(call?.query['fields']).toContain('idReadable')
    expect(call?.query['$top']).toBe('100')
    expect(call?.query['$skip']).toBe('0')
  })

  it('stateIn/assignee/lane/updatedSince 各维翻译（白名单语法）', async () => {
    const fake = new FakeYouTrack()
    const p = makePlatform(fake, { project: 'STUDIO' })
    await p.issues.list({ stateIn: ['待批', '已派发'], assignee: 'emp-1', lane: 'platform', updatedSince: '2026-01-01T00:00:02.000Z' })
    const call = lastCallTo(fake, 'GET', '/api/issues')
    expect(call?.query['query']).toBe(
      'project: STUDIO State: 待批,已派发 派单人: emp-1 泳道: platform updated: 2026-01-01T00:00:02.000Z .. * sort by: updated asc',
    )
    // updatedSince=严格大于：客户端后滤兜平（STUDIO-3 updated==下界被排除）
    const filtered = await p.issues.list({ updatedSince: '2026-01-01T00:00:02.000Z' })
    expect(filtered.map((r) => r.id)).toEqual(['STUDIO-1', 'STUDIO-2'])
  })

  it('stateIn=[] → 空集不发请求', async () => {
    const fake = new FakeYouTrack()
    const p = makePlatform(fake, { project: 'STUDIO' })
    expect(await p.issues.list({ stateIn: [] })).toEqual([])
    expect(fake.calls.filter((c) => c.path === '/api/issues').length).toBe(0)
  })

  it('未映射过滤维 → 显式报错（不静默丢过滤）', async () => {
    const fields: FieldProvisionMap = { ...TEST_PROVISION, fields: { state: 'State', dept: '部门' } }
    const p = makePlatform(new FakeYouTrack(), { project: 'STUDIO', fields })
    await expectYtReject(() => p.issues.list({ assignee: 'emp-1' }), 'CONFIG_INVALID', 'unmapped-field')
    await expectYtReject(() => p.issues.list({ lane: 'im' }), 'CONFIG_INVALID', 'unmapped-field')
  })

  it('分页拼接：108 单两页取全（$skip 0→100），不重不漏', async () => {
    const fake = new FakeYouTrack()
    for (let i = 0; i < 105; i++) {
      fake.issues.push({
        id: `9-${String(i)}`,
        idReadable: `STUDIO-${String(1000 + i)}`,
        summary: `bulk-${String(i)}`,
        description: null,
        created: 1767225800000 + i,
        updated: 1767225800000 + i,
        customFields: [{ name: 'State', value: { name: '新单' } }],
        links: [],
      })
    }
    const p = makePlatform(fake, { project: 'STUDIO' })
    const list = await p.issues.list({})
    expect(list.length).toBe(108)
    const ids = list.map((r) => r.id)
    expect(new Set(ids).size).toBe(108)
    const listCalls = fake.calls.filter((c) => c.method === 'GET' && c.path === '/api/issues')
    expect(listCalls.map((c) => c.query['$skip'])).toEqual(['0', '100'])
  })
})

describe('create / transition / setField', () => {
  it('create：全维翻译落 customFields（值形状表）+ 项目按名解析（N11）+ 默认态', async () => {
    const fake = new FakeYouTrack()
    const p = makePlatform(fake, { project: 'STUDIO' })
    const rec = await p.issues.create({
      title: '丁：新需求',
      description: '丁单描述',
      type: '需求',
      dept: '平台部',
      level: 3,
      assignee: 'emp-9',
    })
    expect(rec).toMatchObject({
      id: 'STUDIO-4',
      title: '丁：新需求',
      state: '新单', // 实例侧 State 默认值
      type: '需求',
      dept: '平台部',
      level: 3,
      assignee: 'emp-9',
    })
    // 项目内部 id 是按名解析的（不落盘、不硬编码）
    const projectsCall = fake.calls.find((c) => c.path === '/api/admin/projects')
    expect(projectsCall).toBeDefined()
    const create = lastCallTo(fake, 'POST', '/api/issues')
    expect(create?.body).toEqual({
      project: { id: '0-1' },
      summary: '丁：新需求',
      description: '丁单描述',
      customFields: [
        { name: 'Type', value: { name: '需求' } },
        { name: '部门', value: { name: '平台部' } },
        { name: '等级', value: 3 },
        { name: '派单人', value: { login: 'emp-9' } },
      ],
    })
  })

  it('create：parent → 建单后落 Subtask 链，返回记录含 parent', async () => {
    const fake = new FakeYouTrack()
    const p = makePlatform(fake, { project: 'STUDIO' })
    const rec = await p.issues.create({ title: '戊：子单', parent: 'STUDIO-1' })
    expect(rec.parent).toBe('STUDIO-1')
    // 落链请求：子（源）→ 父（目标），类型按名解析到 lt-1
    const linkCall = fake.calls.find((c) => c.method === 'POST' && /\/links\/lt-1\/issues\/STUDIO-1$/.test(c.path))
    expect(linkCall?.path).toBe('/api/issues/2-100/links/lt-1/issues/STUDIO-1')
    expect(await p.links.children('STUDIO-1')).toEqual(['STUDIO-2', 'STUDIO-4'])
  })

  it('create：无项目绑定 / 未映射维 / 空标题 / 非整数等级 拒收', async () => {
    const noProject = makePlatform(new FakeYouTrack())
    await expectYtReject(() => noProject.issues.create({ title: 'x' }), 'CONFIG_INVALID', 'missing-project-binding')
    const fields: FieldProvisionMap = { ...TEST_PROVISION, fields: { state: 'State' } }
    const p = makePlatform(new FakeYouTrack(), { project: 'STUDIO', fields })
    await expectYtReject(() => p.issues.create({ title: 'x', dept: '平台部' }), 'CONFIG_INVALID', 'unmapped-field')
    await expectYtReject(() => p.issues.create({ title: '  ' }), 'CONFIG_INVALID', 'bad-create-input')
    const full = makePlatform(new FakeYouTrack(), { project: 'STUDIO' })
    await expectYtReject(() => full.issues.create({ title: 'x', level: 1.5 }), 'CONFIG_INVALID', 'bad-field-value')
  })

  it('transition：写 state 自定义字段（{name} 名字寻址），返回推进后记录', async () => {
    const fake = new FakeYouTrack()
    const p = makePlatform(fake, { project: 'STUDIO' })
    const rec = await p.issues.transition('STUDIO-1', '已派发')
    expect(rec.state).toBe('已派发')
    const call = lastCallTo(fake, 'POST', '/api/issues/STUDIO-1')
    expect(call?.body).toEqual({ customFields: [{ name: 'State', value: { name: '已派发' } }] })
    expect((await p.issues.get('STUDIO-1')).state).toBe('已派发')
    await expectYtReject(() => p.issues.transition('STUDIO-1', '  '), 'CONFIG_INVALID', 'bad-state')
    await expectYtReject(() => p.issues.transition('STUDIO-404', '已派发'), 'EXTERNAL_REJECT', 'issue-not-found')
  })

  it('setField 映射往返：写形状=读形状，get 查回一致（字段映射往返）', async () => {
    const fake = new FakeYouTrack()
    const p = makePlatform(fake, { project: 'STUDIO' })
    await p.issues.setField('STUDIO-3', 'dept', '游戏部')
    await p.issues.setField('STUDIO-3', 'level', 5)
    await p.issues.setField('STUDIO-3', 'assignee', 'emp-7')
    await p.issues.setField('STUDIO-3', 'lane', 'games')
    await p.issues.setField('STUDIO-3', 'title', '丙（改名）')
    await p.issues.setField('STUDIO-3', 'description', '新描述')
    const rec = await p.issues.get('STUDIO-3')
    expect(rec).toMatchObject({
      title: '丙（改名）',
      description: '新描述',
      dept: '游戏部',
      level: 5,
      assignee: 'emp-7',
      lane: 'games',
    })
    // 平台侧落库形状（写方向编码表）
    const issue = fake.issues.find((i) => i.idReadable === 'STUDIO-3')
    const cf = Object.fromEntries((issue?.customFields ?? []).map((x) => [x.name, x.value]))
    expect(cf['部门']).toEqual({ name: '游戏部' })
    expect(cf['等级']).toBe(5)
    expect(cf['派单人']).toEqual({ login: 'emp-7' })
    expect(cf['泳道']).toEqual({ name: 'games' })
    expect(issue?.summary).toBe('丙（改名）')
  })

  it('setField 分派拒绝面：state/未知字段/类型错值', async () => {
    const p = makePlatform(new FakeYouTrack(), { project: 'STUDIO' })
    await expectYtReject(() => p.issues.setField('STUDIO-1', 'state', '已交付'), 'CONFIG_INVALID', 'state-via-set-field')
    await expectYtReject(() => p.issues.setField('STUDIO-1', 'nonsense', 'x'), 'CONFIG_INVALID', 'unmapped-field')
    await expectYtReject(() => p.issues.setField('STUDIO-1', 'level', '三'), 'CONFIG_INVALID', 'bad-field-value')
    await expectYtReject(() => p.issues.setField('STUDIO-1', 'dept', 42), 'CONFIG_INVALID', 'bad-field-value')
  })

  it('setField("parent") → 落 Subtask 链（对齐 localplatform：parent 字段也算 children 来源）', async () => {
    const fake = new FakeYouTrack()
    const p = makePlatform(fake, { project: 'STUDIO' })
    await p.issues.setField('STUDIO-3', 'parent', 'STUDIO-1')
    expect((await p.issues.get('STUDIO-3')).parent).toBe('STUDIO-1')
    expect(await p.links.children('STUDIO-1')).toEqual(['STUDIO-2', 'STUDIO-3'])
  })
})

describe('建单落流程初态（DEV-40，2026-10-20 哨查事故防复发；docs/25-§3.2 IssueCreate.initialState）', () => {
  it('默认建单：provision states[0]（新单）恰同实例 bundle 默认 → 落新单，零多余迁移 POST（负断言）', async () => {
    const fake = new FakeYouTrack()
    const p = makePlatform(fake, { project: 'STUDIO' })
    const rec = await p.issues.create({ title: '甲' })
    expect(rec.state).toBe('新单')
    // 负断言：目标=落位态 → 不补迁移写（幂等通道不发请求）
    expect(fake.calls.filter((c) => c.method === 'POST' && /^\/api\/issues\/STUDIO-\d+$/.test(c.path))).toHaveLength(0)
    expect(fake.calls.filter((c) => c.method === 'POST' && c.path === '/api/issues')).toHaveLength(1)
  })

  it('provision 初态≠实例默认 → 建后补一次 transition 落 states[0]（负断言：不落平台默认新单）', async () => {
    const fake = new FakeYouTrack()
    const fields: FieldProvisionMap = { ...TEST_PROVISION, states: ['待批', '新单', '已派发', '已交付'] }
    const p = makePlatform(fake, { project: 'STUDIO', fields })
    const rec = await p.issues.create({ title: '甲' })
    expect(rec.state).toBe('待批') // 正断言：provision 首元素落位
    expect(rec.state).not.toBe('新单') // 负断言：实例 bundle 默认不再穿透（事故面）
    expect((await p.issues.get(rec.id)).state).toBe('待批')
    // 落位通道：POST 建 + POST 迁移（State customField 名字寻址）
    const migrate = lastCallTo(fake, 'POST', `/api/issues/${rec.id}`)
    expect(migrate?.body).toEqual({ customFields: [{ name: 'State', value: { name: '待批' } }] })
  })

  it('显式 initialState 优先于 provision 初态（解析序：入参 > states[0] > 实例默认）', async () => {
    const fake = new FakeYouTrack()
    const p = makePlatform(fake, { project: 'STUDIO' })
    const rec = await p.issues.create({ title: '甲', initialState: '已派发' })
    expect(rec.state).toBe('已派发')
    expect(rec.state).not.toBe('新单')
    const migrate = lastCallTo(fake, 'POST', `/api/issues/${rec.id}`)
    expect(migrate?.body).toEqual({ customFields: [{ name: 'State', value: { name: '已派发' } }] })
  })

  it('initialState 空白串 → bad-create-input（校验先于建单 IO；负断言：零建单请求）', async () => {
    const fake = new FakeYouTrack()
    const p = makePlatform(fake, { project: 'STUDIO' })
    await expectYtReject(() => p.issues.create({ title: '甲', initialState: '  ' }), 'CONFIG_INVALID', 'bad-create-input')
    expect(fake.calls.filter((c) => c.method === 'POST' && c.path === '/api/issues')).toHaveLength(0)
  })
})
