/**
 * render/tick noop 聚合/签名去重 V2 套件（studio-dev-878 后续：归档票 noop 日志降噪）
 *
 * 原状：archived 票每拍仍进候选，每拍 ~135 行 `noop：<ticket> code=NOOP_UNKNOWN_STATE state=Archived`；
 * 本 boot 约 35% 日志量 + 批量决策/日志与 8.8s lag 尖峰相关。方案 A+B：
 * 按 (code,state) 聚合（count+样本）+ 签名去重（同签名不重复）；逐票 `noopLinesOf` 保留为排障入口。
 * 断言面：稳态 ≤3 行、变化必出、多票样本可追溯、其他 render/hold 行不回归、逐票入口不回归。
 */
import { describe, expect, it } from 'vitest'
import type { TickDecisionEntry, TickReport } from '../../../src/engine/tick-report/types.ts'
import {
  holdLaneBusyLinesOf,
  noopAggregatedLinesOf,
  noopLinesOf,
  renderTick,
} from '../../../src/assembly/render/tick.ts'

function decision(ticket: string, over: Partial<TickDecisionEntry> = {}): TickDecisionEntry {
  return { ticket, intentKey: `k-${ticket}`, code: 'NOOP_UNKNOWN_STATE', actionType: 'noop', state: 'Archived', ...over } as TickDecisionEntry
}

function reportOf(seq: number, decisions: readonly TickDecisionEntry[]): TickReport {
  return {
    seq,
    actions: decisions,
    ts: { start: seq * 1_000, end: seq * 1_000 + 900 },
    inflightAfter: 0,
    phases: {
      collect: { cursorAfter: 'c', cursorBefore: 'c' },
      stateDiff: { decisions, reopened: 0, rescanned: 0 },
      dispatch: { dispatched: 0, budgetReserved: 0, budgetRefused: 0 },
      harvest: { completed: 0, checked: 0, pending: 0 },
      merge: { merged: 0 },
      recycle: { recycled: 0 },
      account: { eventsAppended: 0 },
    },
  } as unknown as TickReport
}

describe('878 后续：noop 聚合 + 签名去重', () => {
  it('稳态：135 归档票同码同态连续 5 拍 → 首拍 1 行聚合（count=135+样本），后续 0 行；总 ≤3 行', () => {
    const tickets = Array.from({ length: 135 }, (_, i) => `studio-dev-${String(i + 1)}`)
    const seen = new Map<string, string>()
    let total = 0
    let firstLines: string[] = []
    for (let tick = 1; tick <= 5; tick += 1) {
      const lines = noopAggregatedLinesOf(reportOf(tick, tickets.map((t) => decision(t))), seen)
      if (tick === 1) firstLines = lines
      else expect(lines).toEqual([])
      expect(lines.length).toBeLessThanOrEqual(3)
      total += lines.length
    }
    expect(total).toBeLessThanOrEqual(3)
    expect(firstLines).toHaveLength(1)
    expect(firstLines[0]).toContain('count=135')
    expect(firstLines[0]).toContain('samples=studio-dev-1,studio-dev-10,studio-dev-100')
    expect(firstLines[0]).toContain('(+132 其余)')
    // 对照：旧逐票入口仍全量可见（排障/verbose 不回归）
    expect(noopLinesOf(reportOf(1, tickets.map((t) => decision(t))))).toHaveLength(135)
  })

  it('变化必出：同组新票加入 → 聚合行重现（count/样本更新）；再同→0 行', () => {
    const seen = new Map<string, string>()
    const base = ['studio-dev-1', 'studio-dev-2']
    expect(noopAggregatedLinesOf(reportOf(1, base.map((t) => decision(t))), seen)).toHaveLength(1)
    expect(noopAggregatedLinesOf(reportOf(2, [...base, 'studio-dev-3'].map((t) => decision(t))), seen)).toHaveLength(1)
    const line = noopAggregatedLinesOf(reportOf(3, [...base, 'studio-dev-3', 'studio-dev-4'].map((t) => decision(t))), seen)
    expect(line).toHaveLength(1)
    expect(line[0]).toContain('count=4')
    expect(line[0]).toContain('(+1 其余)') // 样本=排序前 3；第 4 票折叠
    expect(noopAggregatedLinesOf(reportOf(4, [...base, 'studio-dev-3', 'studio-dev-4'].map((t) => decision(t))), seen)).toEqual([])
  })

  it('多票首条可见：同组 3 票 → 一行聚合含全部样本与 count；不同 code/state 分组各自一行', () => {
    const seen = new Map<string, string>()
    const mixed = [
      decision('t-1', { code: 'NOOP_UNKNOWN_STATE', state: 'Archived' }),
      decision('t-2', { code: 'NOOP_UNKNOWN_STATE', state: 'Archived' }),
      decision('t-3', { code: 'NOOP_UNKNOWN_STATE', state: 'Archived' }),
      decision('t-4', { code: 'NOOP_UNKNOWN_FLOW', state: '新单' }),
    ]
    const lines = noopAggregatedLinesOf(reportOf(1, mixed), seen)
    expect(lines).toHaveLength(2) // 两个 (code,state) 组
    const archived = lines.find((line) => line.includes('state=Archived'))
    expect(archived).toContain('count=3')
    expect(archived).toContain('samples=t-1,t-2,t-3')
    const unknownFlow = lines.find((line) => line.includes('NOOP_UNKNOWN_FLOW'))
    expect(unknownFlow).toContain('count=1')
    // code/state 变化（同票）→ 新组必出
    const changed = noopAggregatedLinesOf(reportOf(2, [decision('t-1', { code: 'NOOP_UNKNOWN_FLOW', state: '新单' })]), seen)
    expect(changed).toHaveLength(1)
    expect(changed[0]).toContain('NOOP_UNKNOWN_FLOW')
    expect(changed[0]).toContain('state=新单')
  })

  it('变化组 >3 时每拍仍 ≤3 行（前 2 组 + 其余汇总）', () => {
    const seen = new Map<string, string>()
    const codes = ['NOOP_UNKNOWN_STATE', 'NOOP_UNKNOWN_FLOW', 'NOOP_IDLE', 'WAIT_APPROVAL', 'DEDUP_NOOP'] as const
    const decisions = codes.map((code, i) => decision(`t-${String(i)}`, { code, state: 'Archived' }))
    const lines = noopAggregatedLinesOf(reportOf(1, decisions), seen)
    expect(lines).toHaveLength(3)
    expect(lines[2]).toContain('其余 3 组')
  })

  it('其他行不回归：renderTick 输出不变、holdLaneBusyLinesOf 签名去重仍正常', () => {
    const report = reportOf(9, [decision('t-1')])
    expect(renderTick(report)).toContain('tick#9 actions=1')
    const holdSeen = new Map<string, string>()
    const hold = { ticket: 't-9', intentKey: 'k', code: 'HOLD_LANE_BUSY', actionType: 'hold', state: '已派发', lane: 'core', laneHolder: 't-1', laneExpiresAt: 1_800_000_000_000 } as TickDecisionEntry
    expect(holdLaneBusyLinesOf(reportOf(1, [hold]), holdSeen)).toHaveLength(1)
    expect(holdLaneBusyLinesOf(reportOf(2, [hold]), holdSeen)).toHaveLength(0) // 同签名不重复
  })
})
