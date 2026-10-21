/**
 * 字段面测试：
 *  - schema()（读）：真源反射——state 枚举=平台状态集、自定义属性类型映射
 *    （number→int / date→date / multiline→text / 其余→string）、未映射属性照列
 *  - provision()（写，onboard 三件之一）：GET-first 幂等建档、重入零写、
 *    类型冲突显式报错、坏映射形状报错、schema 反映新档（缓存作废）
 */
import { describe, expect, it } from 'vitest'
import { FakeTaiga, expectTaigaReject, makePlatform } from './testutil.ts'
import { createTaigaPlatform } from './platform.ts'
import { TEST_BASE_URL, TEST_PASSWORD_AUTH } from './platform-fixture.ts'

describe('fields.schema()（真源反射）', () => {
  it('state=枚举（状态集名字序稳定）；基础维齐；自定义属性按平台属性集反射', async () => {
    const fake = new FakeTaiga()
    const schema = await makePlatform(fake).fields.schema()
    const byName = new Map(schema.map((f) => [f.name, f]))
    expect(byName.get('state')).toEqual({ name: 'state', type: 'enum', values: ['New', 'In progress', 'Done'] })
    expect(byName.get('title')).toEqual({ name: 'title', type: 'string' })
    expect(byName.get('description')).toEqual({ name: 'description', type: 'text' })
    expect(byName.get('assignee')).toEqual({ name: 'assignee', type: 'string' })
    expect(byName.get('等级')).toEqual({ name: '等级', type: 'int' }) // number→int
    expect(byName.get('类型')).toEqual({ name: '类型', type: 'string' })
    // 未映射的「工号」属性照列——schema 反射平台真源，与业务映射无关
    expect(byName.get('工号')).toEqual({ name: '工号', type: 'string' })
  })
})

describe('fields.provision()（GET-first 幂等建档）', () => {
  it('缺则建（状态+属性）、已有则复用；重入第二次零写调用', async () => {
    const fake = new FakeTaiga()
    const p = makePlatform(fake)
    const map = {
      fields: { dept: '部门', level: '等级', cost: '成本' },
      types: { level: 'int' as const, cost: 'int' as const },
      states: ['New', 'In progress', 'Done', '验收中'],
      stateFlow: { New: ['In progress'], 'In progress': ['验收中'] },
    }
    await p.fields.provision(map)
    // 已有的 New/In progress/Done 复用，只新建「验收中」；属性只新建「成本」
    expect(fake.statuses.map((s) => s.name)).toContain('验收中')
    expect(fake.attributes.map((a) => a.name)).toContain('成本')
    expect(fake.attributes.find((a) => a.name === '成本')?.type).toBe('number') // types 生效
    expect(fake.countWriteCalls()).toBe(2) // 1 状态 + 1 属性
    // 幂等重入：全部命中现值 → 零写（不重放 POST）
    const before = fake.countWriteCalls()
    await p.fields.provision(map)
    expect(fake.countWriteCalls()).toBe(before)
    // schema 立即反映新档（provision 后缓存已作废）
    const schema = await p.fields.schema()
    expect(schema.some((f) => f.name === '成本' && f.type === 'int')).toBe(true)
    expect(schema.find((f) => f.name === 'state')?.values).toContain('验收中')
  })

  it('同名属性类型冲突 → 显式报错不静默（值只增不删）', async () => {
    const fake = new FakeTaiga()
    const p = makePlatform(fake)
    await expectTaigaReject(
      () => p.fields.provision({ fields: { level: '等级' }, types: { level: 'string' }, states: [], stateFlow: {} }),
      'CONFIG_INVALID',
      'attribute-type-mismatch',
    )
  })

  it('enum 归一为 string 比对：重入不误报（Taiga 属性无枚举约束）', async () => {
    const fake = new FakeTaiga()
    const p = makePlatform(fake)
    await p.fields.provision({ fields: { lane: '泳道枚举' }, types: { lane: 'enum' as const }, states: [], stateFlow: {} })
    await p.fields.provision({ fields: { lane: '泳道枚举' }, types: { lane: 'enum' as const }, states: [], stateFlow: {} }) // 不抛即幂等
    expect(fake.attributes.find((a) => a.name === '泳道枚举')?.type).toBe('text')
  })

  it('坏映射形状 → bad-provision-map（字段名/类型/状态集三路）', async () => {
    const p = makePlatform(new FakeTaiga())
    await expectTaigaReject(() => p.fields.provision({ fields: { dept: '' }, states: [], stateFlow: {} }), 'CONFIG_INVALID', 'bad-provision-map')
    await expectTaigaReject(
      () => p.fields.provision({ fields: { dept: '部门' }, types: { dept: 'float' as never }, states: [], stateFlow: {} }),
      'CONFIG_INVALID',
      'bad-provision-map',
    )
    await expectTaigaReject(() => p.fields.provision({ fields: { dept: '部门' }, states: ['New', 3 as never], stateFlow: {} }), 'CONFIG_INVALID', 'bad-provision-map')
  })
})

// ————————————————— T3 并发 TOCTOU 窗口吸收（studio-dev-126 B 轴，S3 证据 docs/32-§九） —————————————————

describe('fields.provision() 并发 TOCTOU 窗口：判重 GET 后对手先建 → POST 吃 400 → 读回吸收', () => {
  /** 脚本化 fetch：首判重 GET 回空集（对手未落成的时点视图），其余透传真 fake */
  function staleFirstView(fake: FakeTaiga): FakeTaiga['fetch'] {
    let staleLeft = 1
    return async (url: string, init?: RequestInit): Promise<Response> => {
      if (staleLeft > 0 && (init?.method ?? 'GET') === 'GET' && url.includes('/userstory-statuses')) {
        staleLeft -= 1
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return fake.fetch(url, init)
    }
  }

  /** makePlatform 形状复用：仅换 fetch 注入（脚本化视图的确定性来源） */
  function scriptedPlatform(_fake: FakeTaiga, fetch: FakeTaiga['fetch']) {
    return createTaigaPlatform({ baseUrl: TEST_BASE_URL, project: 'probe-co', auth: TEST_PASSWORD_AUTH, fetch })
  }

  it('窗口咬合：GET 空视图判缺 → POST 撞对手已建吃 400 Duplicated → 读回在场即吸收（幂等成功不误报）', async () => {
    const fake = new FakeTaiga()
    fake.statuses.push({ id: 90, name: '验收中', slug: 'yan-shou' }) // 对手已建成（真源在档）
    const p = scriptedPlatform(fake, staleFirstView(fake))
    // 不抛=吸收成立（旧行为：400 → CONFIG_INVALID 假红——B 轴事故面）
    await p.fields.provision({ fields: {}, states: ['验收中'], stateFlow: {} })
    const posts = fake.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/userstory-statuses'))
    expect(posts).toHaveLength(1) // 撞窗那发 POST 留了账（窗口真发生过的证据）
    expect(fake.statuses.filter((s) => s.name === '验收中')).toHaveLength(1) // 真源恰一份（无重复建档）
  })

  it('吸收有界：400 后读回仍不在场 → 原样重抛（真 CONFIG_INVALID 不吞）', async () => {
    const fake = new FakeTaiga()
    // 脚本：POST userstory-statuses 恒回 400 Duplicated（平台谎报重名）而真源并无该名
    const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
      if ((init?.method ?? 'GET') === 'POST' && url.includes('/userstory-statuses')) {
        return new Response(JSON.stringify({ name: ['Duplicated name'] }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      }
      return fake.fetch(url, init)
    }
    const p = scriptedPlatform(fake, fetch)
    await expectTaigaReject(
      () => p.fields.provision({ fields: {}, states: ['验收中'], stateFlow: {} }),
      'CONFIG_INVALID',
      'bad-request',
    )
    expect(fake.statuses.some((s) => s.name === '验收中')).toBe(false) // 真缺：未建档未谎报吸收
  })

  it('属性面同法：400 Already exists（真机 P82-P84 词面）→ 读回吸收', async () => {
    const fake = new FakeTaiga()
    fake.attributes.push({ id: 90, name: '成本', type: 'number' }) // 对手已建
    let staleLeft = 1
    const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
      if (staleLeft > 0 && (init?.method ?? 'GET') === 'GET' && url.includes('/userstory-custom-attributes')) {
        staleLeft -= 1
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return fake.fetch(url, init)
    }
    const p = scriptedPlatform(fake, fetch)
    await p.fields.provision({ fields: { cost: '成本' }, types: { cost: 'int' as const }, states: [], stateFlow: {} }) // 不抛=吸收
    expect(fake.attributes.filter((a) => a.name === '成本')).toHaveLength(1)
  })
})

// ————————————————— 多实体 provision + typeInbox（DEV-43，docs/18-§2.1.1 平台面） —————————————————

/** e2e/demo 同源：spike（无 entity·顶层桶）+ defect（entity: issue）+ task 桶 */
const TYPED_MAP = {
  fields: { type: '类型', dept: '部门' },
  states: ['待探索', '探索中', '探索结论就绪'],
  stateFlow: { 待探索: ['探索中'] },
  typeInbox: { spike: '待探索', defect: '新建' },
  typeFlows: { spike: { 待探索: ['探索中'] }, defect: { 新建: ['待批'] } },
  entities: {
    issue: { states: ['新建', '待批', '修复中', '待复验', '已修复', '已关闭'] },
    task: { states: ['探索任务', '探索任务完成'] },
  },
}

describe('fields.provision() 多实体（entities 桶按实体端点建档）', () => {
  it('entity 态建到对应实体端点：issue-statuses/task-statuses 各自 GET-first 幂等建档', async () => {
    const fake = new FakeTaiga()
    const p = makePlatform(fake)
    await p.fields.provision(TYPED_MAP)
    // issue 桶：6 态全新建（'New' 在场但不与本桶态重名）
    expect(fake.issueStatuses.map((s) => s.name)).toEqual(['New', '新建', '待批', '修复中', '待复验', '已修复', '已关闭'])
    // task 桶：2 态全新建
    expect(fake.taskStatuses.map((s) => s.name)).toEqual(['New', '探索任务', '探索任务完成'])
    // 无 entity 类型折入顶层（userstory-statuses）
    expect(fake.statuses.map((s) => s.name)).toContain('待探索')
    // 写调用=6+2+3（issue/task/顶层三桶各自缺则建；New 各桶在场零写）
    expect(fake.countWriteCalls((c) => c.path.endsWith('-statuses') && c.method === 'POST')).toBe(11)
    // 幂等重入：三桶全命中现值 → 零写
    const before = fake.countWriteCalls()
    await p.fields.provision(TYPED_MAP)
    expect(fake.countWriteCalls()).toBe(before)
  })

  it('entities 键非 Taiga 实体名 → bad-provision-map（值域枚举闸平台侧）', async () => {
    const p = makePlatform(new FakeTaiga())
    await expectTaigaReject(
      () =>
        p.fields.provision({
          fields: {},
          states: [],
          stateFlow: {},
          entities: { epic: { states: ['x'] } } as never,
        }),
      'CONFIG_INVALID',
      'bad-provision-map',
    )
  })

  it('typeInbox/typeFlows 坏形状 → bad-provision-map', async () => {
    const p = makePlatform(new FakeTaiga())
    await expectTaigaReject(
      () => p.fields.provision({ fields: {}, states: [], stateFlow: {}, typeInbox: { spike: 3 as never } }),
      'CONFIG_INVALID',
      'bad-provision-map',
    )
    await expectTaigaReject(
      () => p.fields.provision({ fields: {}, states: [], stateFlow: {}, typeFlows: { spike: { a: '探索中' as never } } }),
      'CONFIG_INVALID',
      'bad-provision-map',
    )
  })
})

describe('TaigaFieldMap.initialStateFor（D11 解析序·平台侧段）', () => {
  it('typeInbox[type] > states[0] > undefined（显式入参优先级在调用方 issues.create）', async () => {
    const fake = new FakeTaiga()
    const p = makePlatform(fake, { fields: TYPED_MAP as never })
    await p.fields.provision(TYPED_MAP) // 平台已有状态档（provision 先行——真链同序）
    // 建单不带 initialState：spike 类型命中 typeInbox['spike']='待探索'
    const created = await p.issues.create({ title: '探索单', type: 'spike' } as never)
    expect(created.state).toBe('待探索')
    // 未声明类型回退 states[0]（同为待探索——D11 第二优先级）
    const fallback = await p.issues.create({ title: '未声明类型单' } as never)
    expect(fallback.state).toBe('待探索')
    // 显式入参最优先：落探索结论就绪
    const explicit = await p.issues.create({ title: '显式落位单', initialState: '探索结论就绪' } as never)
    expect(explicit.state).toBe('探索结论就绪')
  })

  it('无 provision 时 undefined=不指定 → 平台默认态（现状语义）', async () => {
    const fake = new FakeTaiga()
    const p = makePlatform(fake, { fields: undefined })
    const created = await p.issues.create({ title: '裸建单' } as never)
    expect(created.state).toBe('New')
  })
})
