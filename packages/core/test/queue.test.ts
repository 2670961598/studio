/**
 * queue 纯函数测试 —— 排序键冻结公式（129-§6.2-R1/R4，studio-dev-167 单B）：
 * score = 钳后意图优先级(0..3) + ageBoost(min(floor(waitMs/ageStepMs), 2))；pinned=∞ 恒首；
 * 并列 FIFO（first_seen_at 升序 → 单号升序全序）。分支全覆盖：钳边/档界/封顶/防御。
 */
import { describe, expect, it } from 'vitest'
import {
  AGE_BOOST_MAX_TIERS,
  DEFAULT_QUEUE_AGE_STEP_MS,
  ageBoostTier,
  clampPriority,
  compareQueueEntries,
  queueScore,
  rankQueue,
  type QueueEntryRank,
} from '../src/queue.ts'

const STEP = DEFAULT_QUEUE_AGE_STEP_MS

function entry(o: Partial<QueueEntryRank> & { ticket: string }): QueueEntryRank {
  return { priority: 1, pinned: false, firstSeenAt: 0, boostTier: 0, ...o }
}

describe('clampPriority（0..3 钳边——外部输入面防御）', () => {
  it('undefined/NaN → 0（缺省档）', () => {
    expect(clampPriority(undefined)).toBe(0)
    expect(clampPriority(Number.NaN)).toBe(0)
  })
  it('越界钳边不拒：-3→0、7→3', () => {
    expect(clampPriority(-3)).toBe(0)
    expect(clampPriority(7)).toBe(3)
  })
  it('小数截断：2.9→2（离散档）', () => {
    expect(clampPriority(2.9)).toBe(2)
  })
  it('合法值原样：0..3', () => {
    expect(clampPriority(0)).toBe(0)
    expect(clampPriority(3)).toBe(3)
  })
})

describe('ageBoostTier（离散两档封顶——R1「封顶 2 档」）', () => {
  it('未满一步=0 档；满一步=1 档；满两步=2 档；再多仍 2（封顶）', () => {
    expect(ageBoostTier(STEP - 1, STEP)).toBe(0)
    expect(ageBoostTier(STEP, STEP)).toBe(1)
    expect(ageBoostTier(2 * STEP, STEP)).toBe(2)
    expect(ageBoostTier(9 * STEP, STEP)).toBe(AGE_BOOST_MAX_TIERS)
  })
  it('ageStepMs ≤ 0 / 非数 → 0 档（坏配置 fail-closed 到无 boost，不恒满档）', () => {
    expect(ageBoostTier(STEP * 5, 0)).toBe(0)
    expect(ageBoostTier(STEP * 5, -10)).toBe(0)
    expect(ageBoostTier(STEP * 5, Number.NaN)).toBe(0)
  })
  it('负等待（时钟回拨）/非数等待 → 0 档', () => {
    expect(ageBoostTier(-100, STEP)).toBe(0)
    expect(ageBoostTier(Number.NaN, STEP)).toBe(0)
  })
})

describe('queueScore（冻结公式）', () => {
  it('score = priority + boostTier（值域 0..5）', () => {
    expect(queueScore(entry({ priority: 3, boostTier: 2 }))).toBe(5)
    expect(queueScore(entry({ priority: 0, boostTier: 0 }))).toBe(0)
  })
  it('pinned = ∞ 恒首（无论优先级多低）', () => {
    expect(queueScore(entry({ priority: 0, boostTier: 0, pinned: true }))).toBe(Number.POSITIVE_INFINITY)
    expect(queueScore(entry({ priority: 0, pinned: true }))).toBeGreaterThan(queueScore(entry({ priority: 3, boostTier: 2 })))
  })
})

describe('compareQueueEntries / rankQueue（全序、确定性）', () => {
  it('score 降序：高优在前', () => {
    const a = entry({ ticket: 'A', priority: 1 })
    const b = entry({ ticket: 'B', priority: 3 })
    expect(compareQueueEntries(b, a)).toBe(-1)
    expect(rankQueue([a, b]).map((e) => e.ticket)).toEqual(['B', 'A'])
  })
  it('ageBoost 反超：优先级 0 老单（两档）压过优先级 1 新单（饥饿防线）', () => {
    const low = entry({ ticket: 'LOW', priority: 0, boostTier: 2 })
    const high = entry({ ticket: 'HIGH', priority: 1, boostTier: 0 })
    expect(rankQueue([high, low]).map((e) => e.ticket)).toEqual(['LOW', 'HIGH'])
  })
  it('两档反超后并列（0+2 == 2+0）→ FIFO：老单在前', () => {
    const old = entry({ ticket: 'OLD', priority: 0, boostTier: 2, firstSeenAt: 1_000 })
    const newer = entry({ ticket: 'NEW', priority: 2, boostTier: 0, firstSeenAt: 9_000 })
    expect(rankQueue([newer, old]).map((e) => e.ticket)).toEqual(['OLD', 'NEW'])
  })
  it('置顶恒首：pinned 压过一切非置顶', () => {
    const pinned = entry({ ticket: 'PIN', priority: 0, boostTier: 0, pinned: true })
    const best = entry({ ticket: 'BEST', priority: 3, boostTier: 2 })
    expect(rankQueue([best, pinned]).map((e) => e.ticket)).toEqual(['PIN', 'BEST'])
  })
  it('双置顶并列 → FIFO（先入队者首）；再并列 → 单号升序（全序尾锚）', () => {
    const p1 = entry({ ticket: 'Z-1', pinned: true, firstSeenAt: 100 })
    const p2 = entry({ ticket: 'A-9', pinned: true, firstSeenAt: 50 })
    expect(rankQueue([p1, p2]).map((e) => e.ticket)).toEqual(['A-9', 'Z-1'])
    const sameTs1 = entry({ ticket: 'B-2', pinned: true, firstSeenAt: 100 })
    const sameTs2 = entry({ ticket: 'A-1', pinned: true, firstSeenAt: 100 })
    expect(rankQueue([sameTs1, sameTs2]).map((e) => e.ticket)).toEqual(['A-1', 'B-2'])
  })
  it('rankQueue 不 mutate 入参（纯函数纪律）', () => {
    const input = [entry({ ticket: 'B', priority: 0 }), entry({ ticket: 'A', priority: 3 })]
    const snapshot = JSON.stringify(input)
    rankQueue(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
  it('同输入恒同输出（可重放）', () => {
    const input = [entry({ ticket: 'C' }), entry({ ticket: 'A', priority: 2, boostTier: 1 }), entry({ ticket: 'B', pinned: true })]
    expect(JSON.stringify(rankQueue(input))).toBe(JSON.stringify(rankQueue(input)))
  })
  it('空集/单集边界', () => {
    expect(rankQueue([])).toEqual([])
    expect(rankQueue([entry({ ticket: 'ONLY' })]).map((e) => e.ticket)).toEqual(['ONLY'])
  })
})
