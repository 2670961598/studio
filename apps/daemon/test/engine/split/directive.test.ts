/**
 * directive 单测 —— 拆单批示解析件（130-P2，studio-dev-173；提案 §6.2.2 冻结面）
 *
 * 断言面（判负线=半拆/静默丢字段）：
 *   1. 语法：批示行定位（行首前缀）＋```split 围栏块（info 全等、闭栏必备）
 *   2. strict：未知键/坏 JSON/空清单/非对象 → 整条拒收带原因
 *   3. 字段：title/assignee 必填（缺=拒收——禁随机抢单）；level 0..9 整数；lane 非空
 *   4. 键格式：splitChildKey/splitFilingKey（父单#序号 1 起位次；#file 收口槽）
 *   5. description 装配：验收口径/文档锚/点将/dedupKey 溯源六面齐
 */
import { describe, expect, it } from 'vitest'
import { parseSplitDirective, splitChildDescription, splitChildKey, splitFilingKey } from '../../../src/engine/split/directive.ts'

/** 合法清单体（子代用例的基线——单测零共享状态） */
function body(childrenJson: string): string {
  const fence = '`'.repeat(3)
  return ['some prefix', '批示:拆单', `${fence}split`, childrenJson, fence, '后续文字'].join('\n')
}

describe('parseSplitDirective：语法定位', () => {
  it('批示行+围栏块全字段解析过', () => {
    const r = parseSplitDirective(body(`{"children":[{"title":"实现登录","assignee":"AGENT-2","level":1,"lane":"core","acceptance":"test -s REPORT.md","docs":"docs/17-§2"}]}`))
    expect(r).toEqual({
      ok: true,
      children: [{ title: '实现登录', assignee: 'AGENT-2', level: 1, lane: 'core', acceptance: 'test -s REPORT.md', docs: 'docs/17-§2' }],
    })
  })

  it('level/lane/acceptance/docs 可缺省（最小清单=title+assignee）', () => {
    const r = parseSplitDirective(body(`{"children":[{"title":"t","assignee":"AGENT-1"}]}`))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.children).toEqual([{ title: 't', assignee: 'AGENT-1' }])
  })

  it('无批示行 → 拒收', () => {
    const r = parseSplitDirective('```split\n{"children":[{"title":"t","assignee":"AGENT-1"}]}\n```')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('批示行')
  })

  it('批示行后无 split 围栏（裸 json 块不认——防随手贴 JSON 误撞）→ 拒收', () => {
    const r = parseSplitDirective('批示:拆单\n```json\n{"children":[]}\n```')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('split')
  })

  it('围栏未闭合（截断评论）→ 拒收不进物化', () => {
    const r = parseSplitDirective('批示:拆单\n```split\n{"children":[{"title":"t","assignee":"AGENT-1"}]')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('完整')
  })
})

describe('parseSplitDirective：strict 校验（fail-closed）', () => {
  it('坏 JSON → 拒收带解析原因', () => {
    const r = parseSplitDirective(body(`{"children":[}`))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('JSON 解析失败')
  })

  it('非对象/缺 children/空数组 → 拒收', () => {
    expect(parseSplitDirective(body(`[]`)).ok).toBe(false)
    expect(parseSplitDirective(body(`{}`)).ok).toBe(false)
    expect(parseSplitDirective(body(`{"children":[]}`)).ok).toBe(false)
  })

  it('未知键 → 拒收点名（防字段名打错被静默吞）', () => {
    const r = parseSplitDirective(body(`{"children":[{"title":"t","assignee":"AGENT-1","titel":"typo"}]}`))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('titel').toContain('封闭集')
  })

  it('缺 title / 缺 assignee → 拒收（assignee 必填=禁随机抢单的结构保证）', () => {
    const noTitle = parseSplitDirective(body(`{"children":[{"assignee":"AGENT-1"}]}`))
    expect(noTitle.ok).toBe(false)
    if (!noTitle.ok) expect(noTitle.reason).toContain('title')
    const noAssignee = parseSplitDirective(body(`{"children":[{"title":"t"}]}`))
    expect(noAssignee.ok).toBe(false)
    if (!noAssignee.ok) expect(noAssignee.reason).toContain('assignee').toContain('禁随机抢单')
  })

  it('level 越界/非整数 → 拒收不猜', () => {
    expect(parseSplitDirective(body(`{"children":[{"title":"t","assignee":"A","level":10}]}`)).ok).toBe(false)
    expect(parseSplitDirective(body(`{"children":[{"title":"t","assignee":"A","level":-1}]}`)).ok).toBe(false)
    expect(parseSplitDirective(body(`{"children":[{"title":"t","assignee":"A","level":1.5}]}`)).ok).toBe(false)
    expect(parseSplitDirective(body(`{"children":[{"title":"t","assignee":"A","level":"1"}]}`)).ok).toBe(false)
  })

  it('空 lane 字符串 → 拒收（空泳道无意义）', () => {
    expect(parseSplitDirective(body(`{"children":[{"title":"t","assignee":"A","lane":"  "}]}`)).ok).toBe(false)
  })
})

describe('幂等键与装配体', () => {
  it('splitChildKey=父单#序号（1 起位次）；splitFilingKey=#file 槽（子单与立案解耦）', () => {
    expect(splitChildKey('T-9', 1)).toBe('split:T-9#1')
    expect(splitChildKey('T-9', 12)).toBe('split:T-9#12')
    expect(splitFilingKey('T-9')).toBe('split:T-9#file')
  })

  it('description 装配：溯源/验收口径/文档锚/点将四面齐，缺省项如实标未指定', () => {
    const full = splitChildDescription('T-9', 2, { title: '实现登录', assignee: 'AGENT-2', level: 1, lane: 'core', acceptance: 'test -s REPORT.md', docs: 'docs/17-§2' })
    expect(full).toContain('父单 T-9')
    expect(full).toContain('dedupKey=T-9#2')
    expect(full).toContain('test -s REPORT.md')
    expect(full).toContain('docs/17-§2')
    expect(full).toContain('AGENT-2')
    const bare = splitChildDescription('T-9', 1, { title: 't', assignee: 'AGENT-1' })
    expect(bare).toContain('未指定（补全后开工')
    expect(bare).toContain('0（缺省=L0 执行轨）')
  })
})
