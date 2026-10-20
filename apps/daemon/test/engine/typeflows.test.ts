/**
 * flowsFromWorkflows 单测（DEV-43，apps/daemon/src/engine/typeflows.ts）：
 * workflows 声明 → T 键流表（供 engine.config.flows 与 decide 消费——serve 同源装配）。
 *
 * 断言面：
 *   1. 无声明（undefined/空 types）→ undefined（serve 不注入 flows 键——现状形状零变化）
 *   2. T 键形状：typeFlowKey 键 + mainline/typeEdges/finalStates/anchors 全量装配
 *      （fresh=anchors.inbox、evidenceReady=anchors.evidence、approval 缺省哨兵 ''）
 *   3. finalStates 只在有终态时落（空集不落——forwardStates 缺省全主干语义）
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_FLOW_TABLE, resolveTicketFlow } from '@studio-next/core'
import type { TicketWorkflows } from '@studio-next/contract'
import { flowsFromWorkflows } from '../../src/engine/typeflows.ts'

const WF: TicketWorkflows = {
  types: [
    {
      id: 'spike',
      states: [
        { name: '待探索' },
        { name: '探索中' },
        { name: '探索结论就绪' },
        { name: '复验通过' },
        { name: '已归档', final: true },
      ],
      edges: [{ from: '已归档', to: '待探索' }],
      anchors: { inbox: '待探索', dispatched: '探索中', evidence: '探索结论就绪', verified: '复验通过', delivered: '已归档' },
    },
    {
      id: 'defect',
      entity: 'issue',
      states: [
        { name: '新建' },
        { name: '待批' },
        { name: '修复中' },
        { name: '待复验' },
        { name: '已修复' },
        { name: '已关闭', final: true },
      ],
      edges: [{ from: '待复验', to: '修复中' }],
      anchors: { inbox: '新建', approval: '待批', dispatched: '修复中', evidence: '待复验', verified: '已修复', delivered: '已关闭' },
    },
    {
      id: 'note',
      states: [
        { name: '随手记' },
        { name: '已记', final: true },
      ],
      anchors: { inbox: '随手记', dispatched: '已记', evidence: '已记', verified: '已记', delivered: '已记' },
    },
  ],
}

describe('flowsFromWorkflows（workflows → T 键流表）', () => {
  it('无声明/空 types → undefined（不注入 flows 键——现状零变化）', () => {
    expect(flowsFromWorkflows(undefined)).toBeUndefined()
    expect(flowsFromWorkflows({ types: [] })).toBeUndefined()
  })

  it('T 键全量装配：mainline 前向 + typeEdges 声明边 + finalStates + 锚点映射', () => {
    const t = flowsFromWorkflows(WF)
    expect(t).toBeDefined()
    if (t === undefined) return
    expect(Object.keys(t).sort()).toEqual(['T:defect', 'T:note', 'T:spike'])
    const spike = t['T:spike']
    if (spike === undefined) throw new Error('unreachable')
    expect(spike.mainline).toEqual(['待探索', '探索中', '探索结论就绪', '复验通过', '已归档'])
    expect(spike.typeEdges).toEqual([{ from: '已归档', to: '待探索' }])
    expect(spike.finalStates).toEqual(['已归档'])
    expect(spike.anchors).toEqual({
      fresh: '待探索',
      approval: '',
      dispatched: '探索中',
      evidenceReady: '探索结论就绪',
      verified: '复验通过',
      delivered: '已归档',
    })
  })

  it('approval 缺省哨兵 ""（不误命中五锚审批位）；defect 审批环锚装配', () => {
    const t = flowsFromWorkflows(WF)
    const defect = t?.['T:defect']
    if (defect === undefined) throw new Error('unreachable')
    expect(defect.anchors.approval).toBe('待批')
    const note = t?.['T:note']
    if (note === undefined) throw new Error('unreachable')
    expect(note.anchors.approval).toBe('')
  })

  it('与 serve 装配合成后解析序正确：T 键覆盖顶、L 键铺底不扰', () => {
    const t = flowsFromWorkflows(WF)
    if (t === undefined) throw new Error('unreachable')
    const merged = { ...DEFAULT_FLOW_TABLE, ...t }
    expect(resolveTicketFlow(merged, 'spike', undefined)?.mainline[0]).toBe('待探索')
    expect(resolveTicketFlow(merged, 'task', 0)?.mainline[0]).toBe('新单') // W-9 保留词回退 L0
    expect(resolveTicketFlow(merged, undefined, 0)?.mainline[0]).toBe('新单') // 未声明类型回退
  })
})
