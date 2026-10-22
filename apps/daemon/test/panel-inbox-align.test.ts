/**
 * panel 收件箱行序 ↔ core 排序键对齐测试（129-§6.2 R2/R5，studio-dev-167 单B）。
 *
 * 为什么落 daemon：panel 运行面依赖冻结为 contract+store（guard:boundaries 边表），
 * panel→core 是非法边；而对齐测试需要同时引 panel 读面比较器与 core 冻结比较器。
 * daemon→panel、daemon→core 均为合法边——跨包对齐面钉在这里（测试面不进 panel 运行面）。
 *
 * 断言：对任意行集，panel compareInboxRows 的全序与 core compareQueueEntries
 * （rankQueue 冻结公式）逐对一致——读面漂移即红（制作人面板看到的顺序=引擎实际派发顺序）。
 */
import { describe, expect, it } from 'vitest'
import { compareQueueEntries, rankQueue, type QueueEntryRank } from '@studio-next/core'
import type { TodoQueueRecord } from '@studio-next/store'
import { compareInboxRows } from '@studio-next/panel/inbox'

/** 投影行 → 排序键条目（字段同形：priority/pinned/boost_tier/first_seen_at/ticket） */
function toRank(r: TodoQueueRecord): QueueEntryRank {
  return {
    ticket: r.ticket,
    priority: r.priority,
    pinned: r.pinned !== 0,
    firstSeenAt: r.first_seen_at,
    boostTier: r.boost_tier,
  }
}

function row(over: Partial<TodoQueueRecord>): TodoQueueRecord {
  return {
    company: 'demo',
    ticket: 'T-1',
    person: 'P1',
    priority: 1,
    pinned: 0,
    boost_tier: 0,
    first_seen_at: 1000,
    ready_state: 'ready',
    updated_at: 5000,
    ...over,
  }
}

describe('收件箱行序对齐 core 排序键（读面=决策面，不漂移）', () => {
  it('结构面红证：置顶恒首 / score 降序 / 同分 FIFO / 单号全序——两个比较器逐对一致', () => {
    const rows = [
      row({ ticket: 'T-1', priority: 0, boost_tier: 0, first_seen_at: 100 }), // score 0 最老
      row({ ticket: 'T-2', priority: 3, boost_tier: 2, first_seen_at: 500 }), // score 5 最高非置顶
      row({ ticket: 'T-3', priority: 1, boost_tier: 2, first_seen_at: 300 }), // score 3
      row({ ticket: 'T-4', priority: 3, boost_tier: 0, first_seen_at: 500, pinned: 1 }), // 置顶 ∞
      row({ ticket: 'T-5', priority: 1, boost_tier: 2, first_seen_at: 300 }), // 与 T-3 同分同钟
      row({ ticket: 'T-6', priority: 2, boost_tier: 0, first_seen_at: 200 }), // score 2
    ]
    const byPanel = [...rows].sort(compareInboxRows)
    const byCore = rankQueue(rows.map(toRank))
    expect(byPanel.map((r) => r.ticket)).toEqual(byCore.map((r) => r.ticket))
    expect(byPanel.map((r) => r.ticket)).toEqual(['T-4', 'T-2', 'T-3', 'T-5', 'T-6', 'T-1'])
  })

  it('逐对一致性（全叉积——符号与返回约定 -1/0/1 全等）', () => {
    const rows = [
      row({ ticket: 'T-1', priority: 0, first_seen_at: 100 }),
      row({ ticket: 'T-2', priority: 0, first_seen_at: 100 }),
      row({ ticket: 'T-3', priority: 2, boost_tier: 1, first_seen_at: 400 }),
      row({ ticket: 'T-4', priority: 0, boost_tier: 2, first_seen_at: 400 }),
      row({ ticket: 'T-5', priority: 1, pinned: 1, first_seen_at: 900 }),
      row({ ticket: 'T-6', priority: 1, pinned: 1, first_seen_at: 100 }),
    ]
    for (const a of rows) {
      for (const b of rows) {
        expect(compareInboxRows(a, b)).toBe(compareQueueEntries(toRank(a), toRank(b)))
      }
    }
  })
})
