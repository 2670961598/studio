/**
 * judge 闸门纯面测试 —— studio-dev-160 §6.2/§6.4/§6.6（制作人 2026-10-22 全批）：
 *  - 事前三帽 judgePreCallGate：过/单次估算超/址日帽/公司日帽（拒绝不落账由调用库保证，
 *    本面只回结论）+ 事后超耗 judgeOverSpend；
 *  - 按址熔断：同因 3 连开、换因归 1、成功清零、自然日自动复位、阈值冻结值互证；
 *  - 拍闸：址拍额/拍总额/墙钟预算三限（tick-quota/tick-clock）+ onJudgeTickCall 记账；
 *  - roles 机制点 assertJudgeRoleLow：缺位/非 low 拒，low 过（红队 1——高档判断=成本事故）。
 * 值语义：onJudgeFallback/onJudgeSuccess/onJudgeTickCall 返回新值不动旧值（断言面）。
 */
import { describe, expect, it } from 'vitest'
import type { ClassifiedError } from '@studio-next/contract'
import {
  DEFAULT_JUDGE_CAPS,
  DEFAULT_JUDGE_TICK_LIMITS,
  JUDGE_BREAKER_THRESHOLD,
  JUDGE_FALLBACK_REASONS,
  JUDGE_ROLE,
  assertJudgeRoleLow,
  initialJudgeBreaker,
  initialJudgeTick,
  isJudgeSiteOpen,
  judgeOverSpend,
  judgePreCallGate,
  judgeTickGate,
  onJudgeFallback,
  onJudgeSuccess,
  onJudgeTickCall,
} from '../src/judge-gates.ts'

/** 断言抛 CONFIG_INVALID 并返回（同 judge.test.ts 手法） */
function expectConfigInvalid(fn: () => unknown, subcause: string): Error & ClassifiedError {
  try {
    fn()
  } catch (err) {
    const e = err as Error & ClassifiedError
    expect(e.category).toBe('CONFIG_INVALID')
    expect(e.subcause).toBe(subcause)
    return e
  }
  throw new Error('expected CONFIG_INVALID')
}

// —— 事前三帽（§6.2：单次事前估算闸+按址日帽+公司日帽） ————————————

describe('事前三帽 judgePreCallGate', () => {
  it('批示缺省值冻结互证：$0.01/次 + $0.50/址/日 + $5/公司/日（§6.2 全批值）', () => {
    expect(DEFAULT_JUDGE_CAPS).toEqual({ perCallUsd: 0.01, perSiteDailyUsd: 0.5, companyDailyUsd: 5 })
  })

  it('三帽内全过（kind=pass）', () => {
    const r = judgePreCallGate({ estimateUsd: 0.01, siteSpentUsd: 0.49, companySpentUsd: 4.99 })
    expect(r).toEqual({ kind: 'pass' })
  })

  it('单次估算超帽拒（estimate-over-cap——事前不点火）', () => {
    const r = judgePreCallGate({ estimateUsd: 0.010001, siteSpentUsd: 0, companySpentUsd: 0 })
    expect(r).toEqual({ kind: 'refuse', reason: 'estimate-over-cap' })
  })

  it('址日帽拒（site-daily-cap：已花+估算 > $0.50）', () => {
    const r = judgePreCallGate({ estimateUsd: 0.01, siteSpentUsd: 0.495, companySpentUsd: 0 })
    expect(r).toEqual({ kind: 'refuse', reason: 'site-daily-cap' })
  })

  it('公司日帽拒（company-daily-cap：已花+估算 > $5）', () => {
    const r = judgePreCallGate({ estimateUsd: 0.01, siteSpentUsd: 0, companySpentUsd: 4.995 })
    expect(r).toEqual({ kind: 'refuse', reason: 'company-daily-cap' })
  })

  it('帽覆盖位生效（自定义紧帽）', () => {
    const r = judgePreCallGate({ estimateUsd: 0.001, siteSpentUsd: 0, companySpentUsd: 0, caps: { perCallUsd: 0.0005, perSiteDailyUsd: 1, companyDailyUsd: 10 } })
    expect(r).toEqual({ kind: 'refuse', reason: 'estimate-over-cap' })
  })

  it('事后超耗判定 judgeOverSpend：实际>单次帽即弃裁决（仍落账仍计熔断）', () => {
    expect(judgeOverSpend(0.01)).toBe(false)
    expect(judgeOverSpend(0.010001)).toBe(true)
    expect(judgeOverSpend(0.02, { perCallUsd: 0.015, perSiteDailyUsd: 1, companyDailyUsd: 10 })).toBe(true)
  })
})

// —— 降级原因枚举（JUDGE_FALLBACK note 的机器词表） ——————————————————

describe('降级原因枚举 JUDGE_FALLBACK_REASONS', () => {
  it('14 值冻结互证（穷尽性：类型面与值面一致）', () => {
    expect([...JUDGE_FALLBACK_REASONS]).toEqual([
      'bad-json', 'timeout', 'op-not-in-vocab', 'params-domain', 'refusal',
      'estimate-over-cap', 'site-daily-cap', 'company-daily-cap', 'output-truncated',
      'over-spend', 'tick-quota', 'tick-clock', 'site-open', 'no-model',
    ])
    expect(new Set(JUDGE_FALLBACK_REASONS).size).toBe(14)
  })
})

// —— 按址熔断（§6.2：同因连续 3 次 → 当日机械规则直答） ——————————————

describe('按址熔断（值语义状态机）', () => {
  it('阈值冻结值互证：3（提案 §6.2）', () => {
    expect(JUDGE_BREAKER_THRESHOLD).toBe(3)
  })

  it('同因 3 连降级 → 开（openSinceDay=当次 dayKey）', () => {
    let st = initialJudgeBreaker('site-1')
    st = onJudgeFallback(st, 'bad-json', '2026-10-23')
    expect(isJudgeSiteOpen(st, '2026-10-23')).toBe(false)
    st = onJudgeFallback(st, 'bad-json', '2026-10-23')
    expect(isJudgeSiteOpen(st, '2026-10-23')).toBe(false)
    st = onJudgeFallback(st, 'bad-json', '2026-10-23')
    expect(isJudgeSiteOpen(st, '2026-10-23')).toBe(true)
    expect(st.openSinceDay).toBe('2026-10-23')
    expect(st.lastReason).toBe('bad-json')
  })

  it('换因归 1（连续性断——不同因不叠加）', () => {
    let st = initialJudgeBreaker('site-1')
    st = onJudgeFallback(st, 'bad-json', 'd1')
    st = onJudgeFallback(st, 'bad-json', 'd1')
    st = onJudgeFallback(st, 'timeout', 'd1')
    expect(st.streak).toBe(1)
    expect(st.lastReason).toBe('timeout')
    expect(isJudgeSiteOpen(st, 'd1')).toBe(false)
  })

  it('成功清零（成功即证该因已消）', () => {
    let st = initialJudgeBreaker('site-1')
    st = onJudgeFallback(st, 'bad-json', 'd1')
    st = onJudgeFallback(st, 'bad-json', 'd1')
    st = onJudgeSuccess(st)
    expect(st.streak).toBe(0)
    expect(st.lastReason).toBeUndefined()
    st = onJudgeFallback(st, 'bad-json', 'd1')
    expect(st.streak).toBe(1)
  })

  it('自然日自动复位（次日闭合——dayKey 差即复位）', () => {
    let st = initialJudgeBreaker('site-1')
    for (let i = 0; i < 3; i++) st = onJudgeFallback(st, 'bad-json', 'd1')
    expect(isJudgeSiteOpen(st, 'd1')).toBe(true)
    expect(isJudgeSiteOpen(st, 'd2')).toBe(false)
    // 复位后重累计（调用方仍持旧状态——isJudgeSiteOpen 只判日键差）
    st = onJudgeFallback(st, 'bad-json', 'd2')
    expect(st.streak).toBe(1)
  })

  it('值语义：onJudgeFallback/onJudgeSuccess 不动旧值', () => {
    const st = initialJudgeBreaker('s')
    const a = onJudgeFallback(st, 'timeout', 'd1')
    expect(st.streak).toBe(0)
    expect(a.streak).toBe(1)
    const b = onJudgeSuccess(a)
    expect(a.streak).toBe(1)
    expect(b.streak).toBe(0)
  })
})

// —— 拍闸（§6.6-R2 有界延迟：≤1 次/址/拍、≤2 次/拍、拍墙钟 12s） ————————

describe('拍闸与拍记账（值语义）', () => {
  it('缺省限值冻结互证：1 次/址/拍 + 2 次/拍 + 12s（§6.6-R2）', () => {
    expect(DEFAULT_JUDGE_TICK_LIMITS).toEqual({ maxCallsPerSitePerTick: 1, maxCallsPerTick: 2, tickBudgetMs: 12_000 })
  })

  it('址拍额尽拒（tick-quota：同址第二拍）', () => {
    let tick = initialJudgeTick('tick-1')
    tick = onJudgeTickCall(tick, 'site-1', 100)
    expect(judgeTickGate(tick, 'site-1', 5000)).toEqual({ kind: 'refuse', reason: 'tick-quota' })
    // 他址仍可（拍总额未尽）
    expect(judgeTickGate(tick, 'site-2', 5000)).toEqual({ kind: 'ok' })
  })

  it('拍总额尽拒（tick-quota：全公司第三拍）', () => {
    let tick = initialJudgeTick('tick-1')
    tick = onJudgeTickCall(tick, 'site-1', 100)
    tick = onJudgeTickCall(tick, 'site-2', 100)
    expect(judgeTickGate(tick, 'site-3', 5000)).toEqual({ kind: 'refuse', reason: 'tick-quota' })
  })

  it('拍墙钟预算尽拒（tick-clock：已用+本次死线 > 12s——预检不点火）', () => {
    let tick = initialJudgeTick('tick-1')
    tick = onJudgeTickCall(tick, 'site-1', 8000)
    expect(judgeTickGate(tick, 'site-2', 10_000)).toEqual({ kind: 'refuse', reason: 'tick-clock' })
    expect(judgeTickGate(tick, 'site-2', 4000)).toEqual({ kind: 'ok' })
  })

  it('onJudgeTickCall 记账：calls/callsBySite/clockMs 三累计，值语义不动旧值', () => {
    const t0 = initialJudgeTick('t')
    const t1 = onJudgeTickCall(t0, 's1', 100)
    const t2 = onJudgeTickCall(t1, 's1', 50)
    expect(t0).toEqual({ tickId: 't', calls: 0, callsBySite: {}, clockMs: 0 })
    expect(t1).toEqual({ tickId: 't', calls: 1, callsBySite: { s1: 1 }, clockMs: 100 })
    expect(t2).toEqual({ tickId: 't', calls: 2, callsBySite: { s1: 2 }, clockMs: 150 })
  })
})

// —— roles 机制点（§6.4 红队 1：micro_judge 必显式 low） ————————————

describe('roles 启动闸 assertJudgeRoleLow（红队 1）', () => {
  it('角色名冻结：micro_judge', () => {
    expect(JUDGE_ROLE).toBe('micro_judge')
  })

  it('显式 low 过闸', () => {
    expect(() => assertJudgeRoleLow({ main_worker: 'high', micro_judge: 'low' })).not.toThrow()
  })

  it('缺位拒（judge/role-unregistered——judge 面开启时缺位=配置不完整）', () => {
    expectConfigInvalid(() => assertJudgeRoleLow({ main_worker: 'high' }), 'judge/role-unregistered')
  })

  it('非 low 拒（judge/role-not-low——高档判断=成本事故，拦启动面）', () => {
    expectConfigInvalid(() => assertJudgeRoleLow({ micro_judge: 'high' }), 'judge/role-not-low')
    expectConfigInvalid(() => assertJudgeRoleLow({ micro_judge: 'mid' }), 'judge/role-not-low')
  })
})
