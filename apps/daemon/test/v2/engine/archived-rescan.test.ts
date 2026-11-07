/**
 * mirror rescan Archived 早过滤 V2 套件（studio-dev-884）
 *
 * 背景：rescan 每 10 拍把未 closed 的全部 mirror 单补候选；Archived 不在任何 flow 状态集 →
 * 恒 NOOP_UNKNOWN_STATE（~135 决策/拍）。修法：rescan 跳过 issue.state==='Archived'
 * （活动驱动/statusSetPatrol 兜底；不改 collect/state-diff 其他语义）。
 */
import { describe, expect, it } from 'vitest'
import type { IssueRecord } from '@studio-next/contract'
import { collectWorkIntents, type WorkIntakeDeps } from '../../../src/engine/work/intent.ts'

function issue(id: string, state = '新单'): IssueRecord {
  return { id, title: id, state, type: 'devtask', dept: 'departments/工程部', level: 1, assignee: 'AGENT-1', updated: '2026-11-07T00:00:00.000Z' } as IssueRecord
}

function deps(over: Partial<WorkIntakeDeps>): WorkIntakeDeps {
  return {
    candidates: [],
    affected: [],
    issues: [],
    closed: new Set(),
    company: 'demo',
    intentSource: 'activity',
    seq: 10, // rescanEvery=10 → 触发 rescan
    mirrorRescanEveryTicks: 10,
    ...over,
  }
}

describe('884 mirror rescan 跳过 Archived', () => {
  it('Archived 不补候选；非 Archived 正常补；候选/决策源数量下降（135→20 式）', () => {
    const archived = Array.from({ length: 135 }, (_, i) => issue(`arch-${String(i)}`, 'Archived'))
    const live = Array.from({ length: 20 }, (_, i) => issue(`live-${String(i)}`, '新单'))
    const d = deps({ issues: [...archived, ...live] })
    const result = collectWorkIntents(d)
    const tickets = d.candidates.map((c) => c.ticket)
    expect(tickets).toHaveLength(20) // 旧行为=155
    expect(tickets.every((t) => t.startsWith('live-'))).toBe(true)
    expect(result.rescanned).toBe(20)
    // 非 Archived 的其它状态仍正常补（不误伤）
    const other = deps({ issues: [issue('e-1', '证据就绪'), issue('new-1', '新单'), issue('arch-2', 'Archived')] })
    collectWorkIntents(other)
    expect(other.candidates.map((c) => c.ticket).sort()).toEqual(['e-1', 'new-1'])
  })

  it('Archived→新单 状态变化后（取消归档）下一轮 rescan 能补回候选', () => {
    const archived = issue('flip-1', 'Archived')
    const first = deps({ issues: [archived] })
    collectWorkIntents(first)
    expect(first.candidates).toHaveLength(0)
    // 平台侧取消归档/改状态：mirror 刷新后下一轮 rescan 必须补回（状态非 Archived）
    const revived = { ...archived, state: '新单' }
    const second = deps({ issues: [revived] })
    collectWorkIntents(second)
    expect(second.candidates.map((c) => c.ticket)).toEqual(['flip-1'])
  })

  it('活动驱动路径不回归：Archived 单若被本拍活动命中仍进候选（过滤只在 mirror rescan）', () => {
    const d = deps({ issues: [issue('arch-1', 'Archived')], affected: ['arch-1'] })
    collectWorkIntents(d)
    // 活动候选 priority=1（intentSource），不被 rescan 的 archived 过滤误杀
    expect(d.candidates.map((c) => c.ticket)).toEqual(['arch-1'])
    expect(d.candidates[0]?.intent.source).toBe('activity')
    expect(d.candidates[0]?.intent.priority).toBe(1)
  })

  it('既有语义不回归：closed 单仍排除、已候选不重复、非 rescan 拍不补', () => {
    const d = deps({
      issues: [issue('arch-1', 'Archived'), issue('closed-1'), issue('live-1')],
      closed: new Set(['closed-1']),
      candidates: [{ ticket: 'live-1', intent: { kind: 'ticket', company: 'demo', ticket: 'live-1', source: 'activity', priority: 1 } }],
    })
    collectWorkIntents(d)
    expect(d.candidates.map((c) => c.ticket)).toEqual(['live-1'])
    const noRescan = deps({ seq: 9, issues: [issue('live-2')] })
    collectWorkIntents(noRescan)
    expect(noRescan.candidates).toHaveLength(0)
  })
})
