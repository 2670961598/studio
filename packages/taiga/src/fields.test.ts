/**
 * 字段面测试（读）：schema() 真源反射——state 枚举=平台状态集、自定义属性类型映射
 * （number→int / date→date / multiline→text / 其余→string）、未映射属性照列（平台真源）。
 * provision：显式未实现（首刀写面边界=issues+comments）。
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

describe('fields.provision()（显式未实现）', () => {
  it('调用即明报，指向 onboard 落地路径', async () => {
    await expectTaigaReject(
      () => makePlatform(new FakeTaiga()).fields.provision({ fields: {}, states: [], stateFlow: {} }),
      'CONFIG_INVALID',
      'taiga-provision-not-implemented',
    )
  })
})
