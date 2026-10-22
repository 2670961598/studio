/**
 * suggest 单测 —— 拆单候选打分件（130-P2，studio-dev-173；提案 §6.5.2 三因子＋集中派工）
 *
 * 断言面（判负线=随机序/静默降档炸面）：
 *   1. F1 技能匹配：skills×子单题面关键词命中加分；skills 未载降档 role/dept 文本不炸
 *   2. F2 在途主题相近度：与该人在途单标题重叠=集中派工主因子
 *   3. F3 负载：队列深度×2＋在途数负分——轻者优先
 *   4. B1 集中派工：同清单已点将者加分（组织律 2026-10-22：相关任务集中同一人）
 *   5. 确定性：score 降序、并列按工号升序——同输入恒同序（禁随机抢单的算法面）
 *   6. 产出面：排序清单＋逐人打分理由（部长抄改即派，决定权在部长）；非 active 排除
 */
import { describe, expect, it } from 'vitest'
import { renderSuggestionComment, suggestAssignees, type SuggestContext } from '../../../src/engine/split/suggest.ts'
import type { PersonRef } from '@studio-next/contract'

function person(id: string, over?: Partial<PersonRef>): PersonRef {
  return { id, name: `人${id}`, login: id.toLowerCase(), level: 1, dept: 'departments/工程部', role: '工程师', ...over }
}

function ctx(over?: Partial<SuggestContext>): SuggestContext {
  return {
    people: [person('AGENT-1', { level: 2, role: '工程负责人', skills: ['typescript'] }), person('AGENT-2', { skills: ['typescript', 'vitest'] }), person('AGENT-3')],
    inflightTitles: new Map(),
    queueDepth: new Map(),
    siblingAssignees: [],
    ...over,
  }
}

describe('三因子打分', () => {
  it('F1 技能命中：skills 含子单题面词者排前（typescript 命中者并列，工号序——见下例）', () => {
    const out = suggestAssignees({ title: '重构 typescript 网关层', acceptance: '', docs: '' }, ctx())
    expect(out[0]?.personId).toBe('AGENT-1')
    expect(out[0]?.reasons.some((r) => r.includes('技能匹配'))).toBe(true)
  })

  it('F1 并列同分 → 工号升序决（确定性零随机）', () => {
    const out = suggestAssignees({ title: 'typescript', acceptance: '', docs: '' }, ctx())
    const first2 = out.slice(0, 2).map((s) => s.personId)
    expect(first2).toEqual(['AGENT-1', 'AGENT-2']) // 同命中同分，工号序
  })

  it('F2 在途主题相近为主因子：在途单标题重叠者反超技能面', () => {
    // AGENT-3 无 skills（F1=0）但正做着同主题在途单 → F2×3 反超
    const out = suggestAssignees(
      { title: '登录网关', acceptance: '', docs: '' },
      ctx({ inflightTitles: new Map([['AGENT-3', ['登录网关改造']]]) }),
    )
    expect(out[0]?.personId).toBe('AGENT-3')
    expect(out[0]?.reasons.some((r) => r.includes('在途主题相近'))).toBe(true)
  })

  it('F3 负载：队列深度×2＋在途数扣分——轻者优先', () => {
    const out = suggestAssignees(
      { title: '无技能词单', acceptance: '', docs: '' },
      ctx({
        people: [person('AGENT-1'), person('AGENT-2')],
        queueDepth: new Map([['AGENT-1', 3]]),
        inflightTitles: new Map([['AGENT-1', ['a', 'b']]]),
      }),
    )
    expect(out[0]?.personId).toBe('AGENT-2') // AGENT-1 扣 3×2+2=8
    expect(out[0]?.reasons.some((r) => r.includes('负载'))).toBe(true)
  })

  it('B1 集中派工：同清单已点将者 +6（相关任务集中同一人）', () => {
    const base = ctx({ siblingAssignees: ['AGENT-3'] })
    const out = suggestAssignees({ title: '无技能词单', acceptance: '', docs: '' }, base)
    expect(out[0]?.personId).toBe('AGENT-3')
    expect(out[0]?.reasons.some((r) => r.includes('集中派工'))).toBe(true)
  })

  it('非 active 成员不进候选（paused/retired 排除）；skills 未载不炸（降档 role/dept 文本）', () => {
    const out = suggestAssignees(
      { title: 'typescript 工程改造', acceptance: '', docs: '' },
      ctx({ people: [person('AGENT-1', { skills: ['typescript'] }), person('AGENT-2', { status: 'paused' }), person('AGENT-3')] }),
    )
    expect(out.map((s) => s.personId)).toEqual(['AGENT-1', 'AGENT-3'])
    expect(out[0]?.reasons.some((r) => r.includes('技能匹配'))).toBe(true) // AGENT-1 skills 命中
    expect(out[1]?.reasons.some((r) => r.includes('岗位/部门文本'))).toBe(true) // AGENT-3 无 skills → role/dept 降档命中（工程师/工程部×「工程」）
  })

  it('同输入恒同序（连调 5 次）——禁随机抢单的算法面保证', () => {
    const c = ctx()
    const runs = Array.from({ length: 5 }, () => suggestAssignees({ title: 'typescript 登录', acceptance: 'vitest', docs: '' }, c).map((s) => s.personId).join(','))
    expect(new Set(runs).size).toBe(1)
  })
})

describe('建议面评论文本（§6.5.2 产出形态）', () => {
  it('排序清单＋打分理由（头 5 名；超员注明全景）＋决定权在部长', () => {
    const people = Array.from({ length: 8 }, (_, i) => person(`AGENT-${String(i + 1)}`))
    const out = suggestAssignees({ title: '单', acceptance: '', docs: '' }, ctx({ people }))
    const text = renderSuggestionComment('单', out)
    expect(text).toContain('候选清单＋打分理由')
    expect(text).toContain('决定权在部长')
    expect(text).toContain('1. AGENT-')
    expect(text).toContain('另有 3 人全景见台账') // 8 人-头 5
  })

  it('空人事面：如实标注不炸', () => {
    expect(renderSuggestionComment('单', [])).toContain('无 active 成员')
  })
})
