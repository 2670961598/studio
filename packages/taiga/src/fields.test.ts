/**
 * 字段面测试：
 *  - schema()（读）：真源反射——state 枚举=平台状态集、自定义属性类型映射
 *    （number→int / date→date / multiline→text / 其余→string）、未映射属性照列
 *  - provision()（写，onboard 三件之一）：GET-first 幂等建档、重入零写、
 *    类型冲突显式报错、坏映射形状报错、schema 反映新档（缓存作废）
 */
import { describe, expect, it } from 'vitest'
import { FakeTaiga, expectTaigaReject, makePlatform } from './testutil.ts'

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
