/**
 * breaker 断路器测试 —— docs/17-§6 末 / F1-10（DEV-46 半开修订）：连击语义 / 熔断三动作 /
 * trippedAt 熔断时刻（冷却窗起算点）/ 复位 / 参数化 N / 不可变更新。
 * 四态全覆盖：净（0）→ 连击（1..N-1）→ 熔断（trippedAt 在册）→ 复位回净。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BREAKER_COOLDOWN_MS,
  DEFAULT_BREAKER_CONFIG,
  breakerSignature,
  breakerStrikes,
  breakerTrippedAt,
  emptyBreakerState,
  onWorkerError,
  onSuccess,
} from '../src/breaker.ts'

const SIG = 'GATE_FAIL:gate-exit-1'
const T0 = 1_000_000

describe('连击（streak 语义：同单同签名连续）', () => {
  it('首错：连击 1、未熔断、无动作、无熔断时刻', () => {
    const r = onWorkerError(emptyBreakerState(), 'T-1', SIG, T0)
    expect(r.tripped).toBe(false)
    expect(r.action).toBeNull()
    expect(breakerStrikes(r.newState, 'T-1')).toBe(1)
    expect(breakerSignature(r.newState, 'T-1')).toBe(SIG)
    expect(breakerTrippedAt(r.newState, 'T-1')).toBeUndefined()
  })

  it('换签名断旧连击：新签名从 1 起（连击字面义拟稿）', () => {
    const s1 = onWorkerError(emptyBreakerState(), 'T-1', SIG, T0).newState
    const s2 = onWorkerError(s1, 'T-1', 'WORKER_DEAD:timeout', T0 + 1).newState
    expect(breakerSignature(s2, 'T-1')).toBe('WORKER_DEAD:timeout')
    expect(breakerStrikes(s2, 'T-1')).toBe(1)
  })

  it('多单互不干扰', () => {
    const s = onWorkerError(emptyBreakerState(), 'T-1', SIG, T0).newState
    const s2 = onWorkerError(s, 'T-2', SIG, T0).newState
    expect(breakerStrikes(s2, 'T-1')).toBe(1)
    expect(breakerStrikes(s2, 'T-2')).toBe(1)
  })
})

describe('熔断（连击 3 → 停重派+回首批位+自动开 bug 单恰一次）', () => {
  it('N=3：第三击熔断，返回 open_bug 动作（code/签名/连击数），trippedAt=本击时刻', () => {
    let state = emptyBreakerState()
    state = onWorkerError(state, 'T-1', SIG, T0).newState
    state = onWorkerError(state, 'T-1', SIG, T0 + 1).newState
    const r = onWorkerError(state, 'T-1', SIG, T0 + 2)
    expect(r.tripped).toBe(true)
    expect(breakerTrippedAt(r.newState, 'T-1')).toBe(T0 + 2)
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
    state = onWorkerError(state, 'T-1', SIG, T0).newState
    const r = onWorkerError(state, 'T-1', SIG, T0 + 1)
    expect(r.tripped).toBe(false)
    expect(r.action).toBeNull()
    expect(breakerTrippedAt(r.newState, 'T-1')).toBeUndefined()
  })

  it('熔断后同签名再错：保持熔断、连击续计、trippedAt 刷新（冷却窗重起）、不再开 bug 单', () => {
    let state = emptyBreakerState()
    for (let i = 0; i < 3; i++) state = onWorkerError(state, 'T-1', SIG, T0 + i).newState
    const r = onWorkerError(state, 'T-1', SIG, T0 + 100)
    expect(r.tripped).toBe(true)
    expect(r.action).toBeNull()
    expect(breakerStrikes(r.newState, 'T-1')).toBe(4)
    expect(breakerTrippedAt(r.newState, 'T-1')).toBe(T0 + 100)
  })

  it('熔断后换签名：熔断态保持（trippedAt 在册），连击从 1 起、不再开 bug 单（DEV-46 缝修复：换签名不再静默解除熔断，也不再二次熔断）', () => {
    let state = emptyBreakerState()
    for (let i = 0; i < 3; i++) state = onWorkerError(state, 'T-1', SIG, T0 + i).newState
    const r = onWorkerError(state, 'T-1', 'LLM_FAIL:parse', T0 + 200)
    expect(r.tripped).toBe(true)
    expect(r.action).toBeNull() // 首次熔断已开过 bug 单——换签名不重开
    expect(breakerStrikes(r.newState, 'T-1')).toBe(1)
    expect(breakerTrippedAt(r.newState, 'T-1')).toBe(T0 + 200)
  })
})

describe('参数化 N 与冷却窗（默认 3/30min，docs/17-§6 冻结值 + DEV-46 拟稿）', () => {
  it('N=2：第二击即熔断', () => {
    let state = emptyBreakerState()
    state = onWorkerError(state, 'T-1', SIG, T0, { threshold: 2 }).newState
    const r = onWorkerError(state, 'T-1', SIG, T0 + 1, { threshold: 2 })
    expect(r.tripped).toBe(true)
    expect(r.action?.strikes).toBe(2)
  })

  it('默认配置 threshold=3 / cooldownMs=30min', () => {
    expect(DEFAULT_BREAKER_CONFIG.threshold).toBe(3)
    expect(DEFAULT_BREAKER_CONFIG.cooldownMs).toBe(30 * 60_000)
    expect(DEFAULT_BREAKER_COOLDOWN_MS).toBe(30 * 60_000)
  })

  it('cooldownMs=0：熔断即半开（负对照/测试隔离面）——trippedAt 仍入账（事实不丢）', () => {
    let state = emptyBreakerState()
    for (let i = 0; i < 3; i++) state = onWorkerError(state, 'T-1', SIG, T0, { threshold: 3, cooldownMs: 0 }).newState
    expect(breakerTrippedAt(state, 'T-1')).toBe(T0)
  })
})

describe('复位（成功信号——半开试探成功即走此路）', () => {
  it('成功清该单全部连击与熔断时刻', () => {
    let state = emptyBreakerState()
    for (let i = 0; i < 3; i++) state = onWorkerError(state, 'T-1', SIG, T0 + i).newState
    const r = onSuccess(state, 'T-1')
    expect(r.tripped).toBe(false)
    expect(r.action).toBeNull()
    expect(breakerStrikes(r.newState, 'T-1')).toBe(0)
    expect(breakerSignature(r.newState, 'T-1')).toBeNull()
    expect(breakerTrippedAt(r.newState, 'T-1')).toBeUndefined()
  })

  it('净单复位：原引用返回（无变化不动对象）', () => {
    const state = emptyBreakerState()
    expect(onSuccess(state, 'T-1').newState).toBe(state)
  })
})

describe('不可变纪律', () => {
  it('onWorkerError 不改旧状态（纯更新）', () => {
    const state = onWorkerError(emptyBreakerState(), 'T-1', SIG, T0).newState
    const before = breakerStrikes(state, 'T-1')
    onWorkerError(state, 'T-1', SIG, T0 + 1)
    expect(breakerStrikes(state, 'T-1')).toBe(before)
  })
})
