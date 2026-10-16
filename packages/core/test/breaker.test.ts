/**
 * breaker 断路器测试 —— docs/17-§6 末 / F1-10：连击语义 / 熔断三动作 / 复位 / 参数化 N /
 * 不可变更新。三态全覆盖：净（0）→ 连击（1..N-1）→ 熔断（≥N）→ 复位回净。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BREAKER_CONFIG,
  breakerSignature,
  breakerStrikes,
  emptyBreakerState,
  onWorkerError,
  onSuccess,
} from '../src/breaker.ts'

const SIG = 'GATE_FAIL:gate-exit-1'

describe('连击（streak 语义：同单同签名连续）', () => {
  it('首错：连击 1、未熔断、无动作', () => {
    const r = onWorkerError(emptyBreakerState(), 'T-1', SIG)
    expect(r.tripped).toBe(false)
    expect(r.action).toBeNull()
    expect(breakerStrikes(r.newState, 'T-1')).toBe(1)
    expect(breakerSignature(r.newState, 'T-1')).toBe(SIG)
  })

  it('换签名断旧连击：新签名从 1 起（连击字面义拟稿）', () => {
    const s1 = onWorkerError(emptyBreakerState(), 'T-1', SIG).newState
    const s2 = onWorkerError(s1, 'T-1', 'WORKER_DEAD:timeout').newState
    expect(breakerSignature(s2, 'T-1')).toBe('WORKER_DEAD:timeout')
    expect(breakerStrikes(s2, 'T-1')).toBe(1)
  })

  it('多单互不干扰', () => {
    const s = onWorkerError(emptyBreakerState(), 'T-1', SIG).newState
    const s2 = onWorkerError(s, 'T-2', SIG).newState
    expect(breakerStrikes(s2, 'T-1')).toBe(1)
    expect(breakerStrikes(s2, 'T-2')).toBe(1)
  })
})

describe('熔断（连击 3 → 停重派+回首批位+自动开 bug 单）', () => {
  it('N=3：第三击熔断，返回 open_bug 动作（code/签名/连击数）', () => {
    let state = emptyBreakerState()
    state = onWorkerError(state, 'T-1', SIG).newState
    state = onWorkerError(state, 'T-1', SIG).newState
    const r = onWorkerError(state, 'T-1', SIG)
    expect(r.tripped).toBe(true)
    expect(r.action).toEqual({
      type: 'open_bug',
      code: 'BREAKER_TRIPPED',
      ticket: 'T-1',
      errorSignature: SIG,
      strikes: 3,
    })
  })

  it('差一击不熔断（2/3）', () => {
    let state = emptyBreakerState()
    state = onWorkerError(state, 'T-1', SIG).newState
    const r = onWorkerError(state, 'T-1', SIG)
    expect(r.tripped).toBe(false)
    expect(r.action).toBeNull()
  })

  it('熔断后同签名再错：保持熔断、连击续计、不再开 bug 单', () => {
    let state = emptyBreakerState()
    for (let i = 0; i < 3; i++) state = onWorkerError(state, 'T-1', SIG).newState
    const r = onWorkerError(state, 'T-1', SIG)
    expect(r.tripped).toBe(true)
    expect(r.action).toBeNull()
    expect(breakerStrikes(r.newState, 'T-1')).toBe(4)
  })

  it('换签名也断已熔断单的连击（但连击 1 不熔断——熔断态由 decide 侧停重派保持）', () => {
    let state = emptyBreakerState()
    for (let i = 0; i < 3; i++) state = onWorkerError(state, 'T-1', SIG).newState
    const r = onWorkerError(state, 'T-1', 'LLM_FAIL:parse')
    expect(r.tripped).toBe(false)
    expect(breakerStrikes(r.newState, 'T-1')).toBe(1)
  })
})

describe('参数化 N（默认 3，docs/17-§6 冻结值）', () => {
  it('N=2：第二击即熔断', () => {
    let state = emptyBreakerState()
    state = onWorkerError(state, 'T-1', SIG, { threshold: 2 }).newState
    const r = onWorkerError(state, 'T-1', SIG, { threshold: 2 })
    expect(r.tripped).toBe(true)
    expect(r.action?.strikes).toBe(2)
  })

  it('默认配置 threshold=3', () => {
    expect(DEFAULT_BREAKER_CONFIG.threshold).toBe(3)
  })
})

describe('复位（成功信号）', () => {
  it('成功清该单全部连击', () => {
    let state = emptyBreakerState()
    state = onWorkerError(state, 'T-1', SIG).newState
    state = onWorkerError(state, 'T-1', SIG).newState
    const r = onSuccess(state, 'T-1')
    expect(r.tripped).toBe(false)
    expect(r.action).toBeNull()
    expect(breakerStrikes(r.newState, 'T-1')).toBe(0)
    expect(breakerSignature(r.newState, 'T-1')).toBeNull()
  })

  it('净单复位：原引用返回（无变化不动对象）', () => {
    const state = emptyBreakerState()
    expect(onSuccess(state, 'T-1').newState).toBe(state)
  })
})

describe('不可变纪律', () => {
  it('onWorkerError 不改旧状态（纯更新）', () => {
    const state = onWorkerError(emptyBreakerState(), 'T-1', SIG).newState
    const before = breakerStrikes(state, 'T-1')
    onWorkerError(state, 'T-1', SIG)
    expect(breakerStrikes(state, 'T-1')).toBe(before)
  })
})
