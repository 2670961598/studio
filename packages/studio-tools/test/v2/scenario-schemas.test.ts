/**
 * studio-dev-548 场景工具入参 schema 测试（V2）
 *
 * 依据：docs/v2/14-§三「入参」列、§三铁律 1（schema 只做形状收口，不判权）；
 * docs/v2/09 ENU-124（交接包十项）、v2/11 §5.2（缺项须写「缺失＋去向」）、v2/07 §一（九维）。
 *
 * 冻结验收：11 个 strictObject 收正确入参；多余字段/空必填/错型/缺维/交接包十项不齐 → 拒（fail-closed）。
 */
import { describe, expect, it } from 'vitest'
import { HANDOVER_ITEM_KINDS } from '../../src/scenario-schemas.ts'
import { SCENARIO_TOOL_NAMES, SCENARIO_TOOL_SPECS } from '../../src/scenario-tools.ts'
import { GOOD_ARGS, HANDOVER_ITEMS } from './scenario-fixtures.ts'

// ---------------------------------------------------------------------------
// ② 输入 schema 收正确、拒坏输入
// ---------------------------------------------------------------------------

describe('输入 schema（strictObject；fail-closed 不猜）', () => {
  it.each([...SCENARIO_TOOL_NAMES])('%s 收正确入参', (name) => {
    const spec = SCENARIO_TOOL_SPECS.find((candidate) => candidate.name === name)
    expect(spec?.input.safeParse(GOOD_ARGS[name]).success).toBe(true)
  })

  it('多余字段拒收（协议层拒，不进 handler）', () => {
    for (const spec of SCENARIO_TOOL_SPECS) {
      expect(spec.input.safeParse({ ...GOOD_ARGS[spec.name], unexpectedField: 1 }).success).toBe(false)
    }
  })

  it('公司维必带且非空（v2/14 §三）', () => {
    for (const spec of SCENARIO_TOOL_SPECS) {
      expect(spec.input.safeParse({ ...GOOD_ARGS[spec.name], company: '' }).success).toBe(false)
      const withoutCompany = { ...GOOD_ARGS[spec.name] }
      delete (withoutCompany as Record<string, unknown>)['company']
      expect(spec.input.safeParse(withoutCompany).success).toBe(false)
    }
  })

  it('错型/空串拒收（抽三人事＋两财务＋两研发＋两通用）', () => {
    expect(SCENARIO_TOOL_SPECS[0]?.input.safeParse({ ...GOOD_ARGS['hr.profileAmend'], subjectRef: 42 }).success).toBe(false)
    expect(SCENARIO_TOOL_SPECS[1]?.input.safeParse({ ...GOOD_ARGS['hr.appointmentPropose'], draftVersion: -1 }).success).toBe(false)
    expect(SCENARIO_TOOL_SPECS[2]?.input.safeParse({ ...GOOD_ARGS['hr.transitionRequest'], to: 'unknown' }).success).toBe(false)
    expect(SCENARIO_TOOL_SPECS[3]?.input.safeParse({ ...GOOD_ARGS['hr.interestDeclare'], holdings: [] }).success).toBe(false)
    expect(
      SCENARIO_TOOL_SPECS[4]?.input.safeParse({ ...GOOD_ARGS['fin.ledgerRead'], segments: ['budget', 'wrong'] }).success,
    ).toBe(false)
    expect(SCENARIO_TOOL_SPECS[6]?.input.safeParse({ ...GOOD_ARGS['dev.permissionRequest'], scope: [] }).success).toBe(false)
    expect(
      SCENARIO_TOOL_SPECS[9]?.input.safeParse({ ...GOOD_ARGS['work.intake'], rawContent: '' }).success,
    ).toBe(false)
    expect(
      SCENARIO_TOOL_SPECS[10]?.input.safeParse({ ...GOOD_ARGS['work.handoverSubmit'], items: HANDOVER_ITEMS.slice(0, 9) })
        .success,
    ).toBe(false)
  })

  it('九维能力声明缺一维即拒（声明不超证据；缺维不猜）', () => {
    const spec = SCENARIO_TOOL_SPECS.find((candidate) => candidate.name === 'dev.capabilityDeclare')
    const args = GOOD_ARGS['dev.capabilityDeclare'] as { dimensions: Record<string, unknown> }
    const broken = { ...args, dimensions: { ...args.dimensions } }
    delete broken.dimensions['evidence_known_incapability']
    expect(spec?.input.safeParse(broken).success).toBe(false)
  })

  it('交接包十项语义校验（缺项/重复/缺失无去向 → 拒）', () => {
    const spec = SCENARIO_TOOL_SPECS.find((candidate) => candidate.name === 'work.handoverSubmit')
    const base = GOOD_ARGS['work.handoverSubmit']
    const missingKind = {
      ...base,
      items: HANDOVER_ITEMS.map((entry, index) => (index === 0 ? { ...entry, item: HANDOVER_ITEM_KINDS[1] } : entry)),
    }
    expect(spec?.check?.(missingKind)).toContain('缺项')
    const duplicated = { ...base, items: [...HANDOVER_ITEMS.slice(0, 9), HANDOVER_ITEMS[0]] }
    expect(spec?.check?.(duplicated)).toBeDefined()
    const missingNoDisposition = {
      ...base,
      items: HANDOVER_ITEMS.map((entry, index) => (index === 0 ? { item: entry.item, presence: 'missing' } : entry)),
    }
    expect(spec?.check?.(missingNoDisposition)).toContain('disposition')
    expect(spec?.check?.(base)).toBeUndefined()
  })
})

