/**
 * dispositions 错误处置语义表测试 —— docs/17-§9 文字落成表：11 类全覆盖、
 * 四语义合法性、retry 族连击归属、表可替换。全表为拟稿（见 src 头注），测试锁形状。
 */
import { describe, expect, it } from 'vitest'
import type { ErrorCategory } from '@studio-next/contract'
import { DEFAULT_DISPOSITIONS, breakerCountedCategories, dispositionFor, type Disposition } from '../src/dispositions.ts'

const ALL_CATEGORIES: readonly ErrorCategory[] = [
  'GATE_FAIL',
  'WORKER_DEAD',
  'QA_BACK',
  'STALL',
  'NO_LANE',
  'DISPATCH_FAIL',
  'MERGE_CONFLICT',
  'LLM_FAIL',
  'CONFIG_INVALID',
  'EVOLVE_REJECT',
  'EXTERNAL_REJECT',
]

const FOUR_SEMANTICS: readonly Disposition[] = ['retry', 'send_back', 'open_ticket', 'circuit_break']

describe('表形状（17-§9 冻结 11 类）', () => {
  it('全类覆盖、无多余键', () => {
    expect(Object.keys(DEFAULT_DISPOSITIONS).sort()).toEqual([...ALL_CATEGORIES].sort())
  })

  it('每类处置 ∈ 四语义（重试/退审/开单/熔断）且带落表理由', () => {
    for (const c of ALL_CATEGORIES) {
      const d = dispositionFor(c)
      expect(FOUR_SEMANTICS).toContain(d.disposition)
      expect(d.category).toBe(c)
      expect(d.note.length).toBeGreaterThan(0)
    }
  })

  it('dispositionFor 全类恒有值（类型层全枚举）', () => {
    for (const c of ALL_CATEGORIES) {
      expect(dispositionFor(c)).toBeDefined()
    }
  })
})

describe('逐类拟稿锁定（冻结后禁改）', () => {
  it('机器可自愈族 → retry 且计入连击', () => {
    for (const c of ['GATE_FAIL', 'WORKER_DEAD', 'QA_BACK', 'STALL', 'DISPATCH_FAIL', 'MERGE_CONFLICT', 'LLM_FAIL'] as const) {
      expect(dispositionFor(c).disposition).toBe('retry')
      expect(dispositionFor(c).countsTowardBreaker).toBe(true)
    }
  })

  it('人因/配置/外部族 → send_back 且不计连击', () => {
    for (const c of ['NO_LANE', 'CONFIG_INVALID', 'EXTERNAL_REJECT'] as const) {
      expect(dispositionFor(c).disposition).toBe('send_back')
      expect(dispositionFor(c).countsTowardBreaker).toBe(false)
    }
  })

  it('EVOLVE_REJECT → open_ticket（治理结论自动开改进单）', () => {
    const d = dispositionFor('EVOLVE_REJECT')
    expect(d.disposition).toBe('open_ticket')
    expect(d.countsTowardBreaker).toBe(false)
  })

  it('breakerCountedCategories = retry 族七类', () => {
    expect([...breakerCountedCategories()].sort()).toEqual(
      ['DISPATCH_FAIL', 'GATE_FAIL', 'LLM_FAIL', 'MERGE_CONFLICT', 'QA_BACK', 'STALL', 'WORKER_DEAD'],
    )
  })
})

describe('表可替换（公司级覆盖拟稿）', () => {
  it('传入自定义表整体替换', () => {
    const custom = { ...DEFAULT_DISPOSITIONS, NO_LANE: { ...DEFAULT_DISPOSITIONS.NO_LANE!, disposition: 'retry' as const } }
    expect(dispositionFor('NO_LANE', custom).disposition).toBe('retry')
    expect(dispositionFor('NO_LANE')).not.toBe(dispositionFor('NO_LANE', custom))
  })
})
