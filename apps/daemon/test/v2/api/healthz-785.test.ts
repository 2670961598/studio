/** 785 加法字段：chain.mode/sinceSeq + loop.lagMs（旧字段不回归）。 */
import { describe, expect, it } from 'vitest'
import { buildHealthz } from '../../../src/assembly/api/healthz.ts'

const NOW = 1_790_000_000_000
function base(over: Partial<Parameters<typeof buildHealthz>[0]> = {}): Parameters<typeof buildHealthz>[0] {
  return {
    pid: 1,
    startedAt: NOW - 10_000,
    now: NOW,
    tick: { seq: 5, count: 5, lastAt: NOW - 1_000, tickMs: 1_000 },
    chain: { ok: true, events: 10, tipPrefix: 'abc', checkedAt: NOW - 500, mode: 'delta', sinceSeq: 8 },
    loop: { lagMs: 42, windowMs: 60_000 },
    ...over,
  }
}

describe('785 healthz 加法字段', () => {
  it('chain.mode/sinceSeq 与 loop.lagMs 原样出 body；旧字段/200 判定不变', () => {
    const report = buildHealthz(base())
    expect(report.status).toBe(200)
    expect(report.body.chain).toMatchObject({ mode: 'delta', sinceSeq: 8 })
    expect(report.body.loop).toEqual({ lagMs: 42, windowMs: 60_000 })
    expect(report.body.tick.advancing).toBe(true)
  })
  it('缺省 loop 不出现；缺省 mode=full/sinceSeq=0（旧调用兼容）', () => {
    const { loop: _withoutLoop, ...rest } = base()
    void _withoutLoop
    const report = buildHealthz({ ...rest, chain: { ok: true, checkedAt: NOW - 1 } })
    expect(report.body.loop).toBeUndefined()
    expect(report.body.chain.mode).toBe('full')
    expect(report.body.chain.sinceSeq).toBe(0)
  })
})
