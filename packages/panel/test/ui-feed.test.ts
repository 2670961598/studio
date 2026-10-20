/**
 * ui/lib/feed.js mergeFeed 单测（SSE + backlog 合流面的钉死单）。
 * 依据：DEV-1 方案 §6.2（去重/排序/截断/坏输入免疫）；该文件是纯 JS（ui/ 不进类型门禁），
 * 测试直接 import 驱动——node 原生可吃无类型 JS。
 */
import { describe, expect, it } from 'vitest'
import { mergeFeed } from '../ui/lib/feed.js'

const ev = (id: string, ts: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  ts,
  event: 'DISPATCH',
  company: 'demo',
  issue: 'X-1',
  actor: 'P1',
  ...extra,
})

describe('mergeFeed（SSE + backlog 合流）', () => {
  it('按 id 去重：incoming 覆盖 current 同 id 行（SSE 重连重放场景）', () => {
    const current = [ev('a', 1), ev('b', 2)]
    const incoming = [ev('b', 2, { event: 'GATE_PASS' }), ev('c', 3)]
    const merged = mergeFeed(current, incoming)
    expect(merged.map((e) => e.id)).toEqual(['c', 'b', 'a'])
    expect(merged[1]?.event).toBe('GATE_PASS')
  })

  it('排序：ts 降序，同 ts 按 id 降序（(ts,id) 双键全序——与服务端游标同口径）', () => {
    const merged = mergeFeed(
      [ev('id-1', 100), ev('id-3', 100), ev('id-2', 200)],
      [ev('id-0', 100), ev('id-9', 50)],
    )
    expect(merged.map((e) => e.id)).toEqual(['id-2', 'id-3', 'id-1', 'id-0', 'id-9'])
  })

  it('截断：上限 limit 条（环形窗口，最新者保留）', () => {
    const current = [1, 2, 3, 4, 5].map((n) => ev(`e${String(n)}`, n))
    const incoming = [ev('new', 10)]
    expect(mergeFeed(current, incoming, 3).map((e) => e.id)).toEqual(['new', 'e5', 'e4'])
    // 缺省 50
    const hundred = Array.from({ length: 100 }, (_, i) => ev(`x${String(i).padStart(3, '0')}`, i))
    expect(mergeFeed([], hundred).length).toBe(50)
    expect(mergeFeed([], hundred)[0]?.id).toBe('x099')
  })

  it('坏输入免疫：null/非对象/缺 id/非数 ts 直接丢弃，不炸流', () => {
    const bad = [null, 42, 'x', { ts: 1 }, { id: '' }, { id: 'ok-but-ts', ts: 'nope' }, ev('good', 1)]
    const merged = mergeFeed(bad as unknown[], [undefined, ev('fine', 2)] as unknown[])
    expect(merged.map((e) => e.id)).toEqual(['fine', 'good'])
  })

  it('入参不修改（纯函数）+ 空输入容错（null 视同空）', () => {
    const current = [ev('a', 1), ev('b', 2)]
    const snapshot = JSON.stringify(current)
    mergeFeed(current, [ev('c', 3)])
    expect(JSON.stringify(current)).toBe(snapshot)
    expect(mergeFeed(null, undefined)).toEqual([])
    expect(mergeFeed(undefined, [ev('only', 1)])).toEqual([ev('only', 1)])
  })
})
