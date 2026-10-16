/**
 * golden trace 回放测试 —— F1-03 验收口径：golden trace 回放决策一致。
 * trace 文件即契约雏形（将来进 contract 包）：文件与回放器同批演进，禁单侧漂移。
 * IO 只在测试层（读 fixture）；replayTrace 本体零 IO（src/golden.ts）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { replayTrace, type GoldenTrace } from '../src/golden.ts'
import { makeInput } from './helpers.ts'

const goldenDir = fileURLToPath(new URL('./golden/', import.meta.url))

function loadTraces(): GoldenTrace[] {
  const out: GoldenTrace[] = []
  for (const f of readdirSync(goldenDir)) {
    if (!f.endsWith('.json')) continue
    out.push(JSON.parse(readFileSync(`${goldenDir}${f}`, 'utf8')) as GoldenTrace)
  }
  return out
}

describe('golden trace 回放全绿（F1-03）', () => {
  const traces = loadTraces()

  it('至少 3 份 trace 文件（任务口径：正常派发链/断路器链/幂等链）', () => {
    expect(traces.length).toBeGreaterThanOrEqual(3)
    const names = traces.map((t) => t.name)
    expect(names).toContain('normal-dispatch-chain')
    expect(names).toContain('breaker-trip-chain')
    expect(names).toContain('dedup-chain')
  })

  it('结构合法：有名字、inputs 与 expected 等长且非空', () => {
    for (const t of traces) {
      expect(t.name.length).toBeGreaterThan(0)
      expect(t.inputs.length).toBeGreaterThan(0)
      expect(t.expected.length).toBe(t.inputs.length)
    }
  })

  it('回放零分歧：全部命中（失败清单为空）', () => {
    for (const t of traces) {
      const failures = replayTrace(t)
      expect(failures, `${t.name}: ${failures.map((f) => f.reason).join('; ')}`).toEqual([])
    }
  })

  it('回放纯度：两次回放结果一致', () => {
    for (const t of traces) {
      expect(replayTrace(t)).toEqual(replayTrace(t))
    }
  })
})

describe('replayTrace 失配报告（判据自证）', () => {
  it('单步失配：报出步号/期望/实际', () => {
    const trace: GoldenTrace = {
      name: 'bad-trace',
      inputs: [makeInput()],
      expected: [{ type: 'noop', code: 'DEDUP_NOOP' }], // 实际会 dispatch
    }
    const failures = replayTrace(trace)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({
      trace: 'bad-trace',
      step: 0,
      expected: { type: 'noop', code: 'DEDUP_NOOP' },
      actual: { type: 'dispatch', code: 'DISPATCH' },
    })
  })

  it('结构性失配：inputs 与 expected 步数不等即红', () => {
    const trace: GoldenTrace = { name: 'uneven', inputs: [makeInput(), makeInput()], expected: [] }
    const failures = replayTrace(trace)
    expect(failures).toHaveLength(1)
    expect(failures[0]?.step).toBe(-1)
    expect(failures[0]?.reason).toContain('步数不等')
  })
})
