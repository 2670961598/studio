/**
 * 一级单元字段形状闸（GAP-V2-17 投影输入边界加固；**非契约面**）
 *
 * 依据链：
 *   - docs/v2/06 §5.2/§5.3（包内组织面须表达一级单元 N 与各单元域划分）；
 *   - docs/v2/03 §八（N 单元域重叠=结构违规判负；空编静默=违规）；
 *   - docs/v2/10 §4.3（SCH-ORG-01 字段表；**本轮不新增字段**——本件只在已冻结的投影输入
 *     边界（`ParsedUnit`）加固 fail-closed，不改 schema、不新增 YAML 键/记录类）；
 *   - docs/v2/17 §4.5（GAP-V2-17：字段级承载未收口，登记不冒称闭合）；
 *   - docs/baselines/split-plan-company.md §六（投影载形登记：`units.count`/`units[]`/
 *     `unitId`/`domain`/`headRef`/`vacancyState`；闭口条件归 06/10/17 修订流）。
 *
 * 验收口径（定向负向→拒）：字段形状非法即 blocking，不静默强转（字符串域按字符拆）、
 * 不静默置空（非 ISO reviewAt）、不静默退化（未知 vacancyState）、不抛裸 TypeError
 * （非数组 units/domain 走可读问题面）。合法声明与旧模板只读投影（无 units）零变化。
 */
import { describe, expect, it } from 'vitest'
import { ISSUE_CODES, projectOrganization } from '../../src/projection/index.ts'
import type { OrganizationProjection, OrganizationProjectionInput } from '../../src/projection/index.ts'

/** 最小合法组织面（legacy 只读；people 含 ENG-0 供 headRef 解析）。 */
function inputOf(units?: unknown, definitionUnits?: unknown): OrganizationProjectionInput {
  const org: Record<string, unknown> = {
    company: { name: '示例公司', slug: 'example', level: 3 },
    departments: [{ name: '研发部', path: 'departments/研发部', leader: 'ENG-0' }],
    people: [{ id: 'ENG-0', level: 3 }],
  }
  if (units !== undefined) org['units'] = units
  const base: Record<string, unknown> = { org }
  if (definitionUnits !== undefined) base['definition'] = { units: definitionUnits }
  return base as unknown as OrganizationProjectionInput
}

function project(units?: unknown, definitionUnits?: unknown): OrganizationProjection {
  return projectOrganization(inputOf(units, definitionUnits))
}

const codesOf = (out: OrganizationProjection): readonly string[] => out.issues.map((issue) => issue.code)
const blockingOf = (out: OrganizationProjection): readonly string[] =>
  out.issues.filter((issue) => issue.blocking).map((issue) => issue.code)

describe('一级单元字段形状：非法即拒（fail-closed，不猜不补）', () => {
  it('domain 为字符串：拒，不得按字符拆成域', () => {
    const out = project([{ unitId: 'u1', domain: '研发', headRef: null }])
    expect(out.status).toBe('blocked')
    expect(blockingOf(out)).toContain(ISSUE_CODES.unitFieldShape)
    expect(out.structure.units.units.some((unit) => unit.unitId === 'u1')).toBe(false)
  })

  it('domain 为数字：拒而非抛裸异常', () => {
    expect(() => project([{ unitId: 'u1', domain: 123, headRef: null }])).not.toThrow()
    const out = project([{ unitId: 'u1', domain: 123, headRef: null }])
    expect(out.status).toBe('blocked')
    expect(blockingOf(out)).toContain(ISSUE_CODES.unitFieldShape)
  })

  it('domain 含空串 token：拒（不得静默过滤）', () => {
    const out = project([{ unitId: 'u1', domain: ['研发', ''], headRef: null }])
    expect(out.status).toBe('blocked')
    expect(blockingOf(out)).toContain(ISSUE_CODES.unitFieldShape)
  })

  it('units 声明为非数组：拒而非抛裸异常', () => {
    expect(() => project({ u1: { unitId: 'u1' } })).not.toThrow()
    const out = project({ u1: { unitId: 'u1' } })
    expect(out.status).toBe('blocked')
    expect(codesOf(out)).toContain(ISSUE_CODES.unitFieldShape)
  })

  it('vacancyState 未知值：拒，不得静默退化成默认形态', () => {
    const out = project([{ unitId: 'u1', domain: ['研发'], headRef: null, vacancyState: 'bogus' }])
    expect(out.status).toBe('blocked')
    expect(blockingOf(out)).toContain(ISSUE_CODES.unitFieldShape)
    expect(out.structure.units.units.some((unit) => unit.unitId === 'u1')).toBe(false)
  })

  it('reviewAt 非 ISO 8601：拒，不得静默置空', () => {
    const out = project([{ unitId: 'u1', domain: ['研发'], headRef: 'ENG-0', vacancyState: 'staffed', reviewAt: '2026/01/01' }])
    expect(out.status).toBe('blocked')
    expect(blockingOf(out)).toContain(ISSUE_CODES.unitFieldShape)
  })

  it('headRef 为空串：拒（空串≠缺省）', () => {
    const out = project([{ unitId: 'u1', domain: ['研发'], headRef: '' }])
    expect(out.status).toBe('blocked')
    expect(blockingOf(out)).toContain(ISSUE_CODES.unitFieldShape)
  })
})

describe('一级单元字段形状：合法声明与旧模板只读投影零变化', () => {
  it('合法单元声明（domain 数组/工号 headRef/staffed）：投影 ok 且字段一致', () => {
    const out = project([{ unitId: 'u1', domain: ['研发'], headRef: 'ENG-0', vacancyState: 'staffed' }])
    expect(out.status).toBe('ok')
    expect(out.structure.units.count).toBe(1)
    const unit = out.structure.units.units[0]
    expect(unit?.unitId).toBe('u1')
    expect(unit?.domain).toEqual(['研发'])
    expect(unit?.headRef).toBe('ENG-0')
    expect(unit?.headState).toBe('staffed')
    expect(unit?.authority).toBe('legacy-readonly')
  })

  it('未声明 units（旧模板只读投影）：默认 N=1 形态不变', () => {
    const out = project()
    expect(out.status).toBe('ok')
    expect(out.structure.units.count).toBe(1)
    expect(out.structure.units.source).toBe('default-single')
    expect(out.structure.units.units[0]?.unitId).toBe('(whole-company)')
  })

  it('definition 面合法单元：authority=definition（权威面不因形状闸改变）', () => {
    const out = project(undefined, [{ unitId: 'u1', domain: ['研发'], headRef: 'ENG-0', vacancyState: 'staffed' }])
    expect(out.status).toBe('ok')
    expect(out.structure.units.units[0]?.authority).toBe('definition')
  })

  it('一个坏单元不吞掉好单元：好单元仍投影，但整体 blocked', () => {
    const out = project([
      { unitId: 'bad', domain: '研发', headRef: null },
      { unitId: 'good', domain: ['研发'], headRef: 'ENG-0', vacancyState: 'staffed' },
    ])
    expect(out.status).toBe('blocked')
    expect(out.structure.units.units.map((unit) => unit.unitId)).toEqual(['good'])
  })
})
