/**
 * 785：events 哈希链 checkpoint+delta 校验（旧前缀锚定、只验新增链行；检查点失效 fail-closed）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openLedger, verifyEventsChain, verifyEventsChainDelta } from '../../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function tempLedger() {
  const dir = mkdtempSync(path.join(tmpdir(), 'events-chain-delta-'))
  dirs.push(dir)
  return openLedger(path.join(dir, 'ledger.sqlite'))
}
let n = 0
function append(ledger: ReturnType<typeof tempLedger>, issue: string): { id: string; ts: number } {
  n += 1
  const ts = 1_700_000_000_000 + n
  const id = `01J${String(n).padStart(23, '0')}`
  const r = ledger.appendEvent({ id, ts, company: 'demo', issue, event: 'HEARTBEAT', actor: 'daemon', attempt: 1, level: 1, dept: 'departments/工程部', tokens: { input: 0 } })
  expect(r.appended).toBe(true)
  return { id, ts }
}

describe('verifyEventsChainDelta（checkpoint+delta）', () => {
  it('全量→检查点→新增事件→delta tip 与全量一致；增量不重算旧前缀', () => {
    const ledger = tempLedger()
    try {
      append(ledger, 'T-1')
      const full1 = verifyEventsChain(ledger.db)
      const checkpoint = { seq: full1.events, tip: full1.tip, events: full1.events }
      expect(verifyEventsChainDelta(ledger.db, checkpoint)).toEqual(full1) // 零增量
      append(ledger, 'T-2')
      append(ledger, 'T-3')
      const delta = verifyEventsChainDelta(ledger.db, checkpoint)
      const full2 = verifyEventsChain(ledger.db)
      expect(delta).toEqual(full2)
    } finally {
      ledger.close()
    }
  })
  it('检查点 tip/seq 不符/计数不符 → CONFIG_INVALID（调用方回退全量）', () => {
    const ledger = tempLedger()
    try {
      append(ledger, 'T-1')
      const full = verifyEventsChain(ledger.db)
      expect(() => verifyEventsChainDelta(ledger.db, { seq: full.events, tip: 'f'.repeat(64), events: full.events })).toThrow(/checkpoint-invalid/)
      expect(() => verifyEventsChainDelta(ledger.db, { seq: full.events + 5, tip: full.tip, events: full.events })).toThrow(/checkpoint-invalid/)
      append(ledger, 'T-2')
      expect(() => verifyEventsChainDelta(ledger.db, { seq: full.events, tip: full.tip, events: full.events + 99 })).toThrow(/checkpoint-invalid/)
    } finally {
      ledger.close()
    }
  })
})
