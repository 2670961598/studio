/**
 * 737 每日成本对账（cost_daily=结算权威；GATE_PASS.cost_usd=明细；log-only 不阻断）
 * 造 3 组差异（忽略/告警/升级）+ 无明细：断言日志、daemon_kv、既有 DAILY_ALARM。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { EventRecord } from '@studio-next/contract'
import { openLedger } from '@studio-next/store'
import { runCostCloseTick, type CostCloseDeps } from '../../../src/engine/cost-close/close.ts'

const COMPANY = 'demo-corp'
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'cost-recon-737-'))
  dirs.push(dir)
  return dir
}
function harness() {
  const ledger = openLedger(path.join(tempDir(), 'ledger.sqlite'))
  const reports: string[] = []
  const alarms: string[] = []
  const logs: string[] = []
  const errors: string[] = []
  let n = 0
  let t = new Date(2026, 9, 22, 19, 55, 0, 0).valueOf()
  const makeId = (): string => `0${String(++n).padStart(25, '0')}`
  const deps = (): CostCloseDeps => ({
    ledger,
    company: COMPANY,
    now: () => t,
    makeId,
    emitReport: (note) => reports.push(note),
    emitAlarm: (note) => alarms.push(note),
    onError: (message) => errors.push(message),
    log: (line) => logs.push(line),
  })
  return { ledger, deps, reports, alarms, logs, errors }
}
function seed(h: ReturnType<typeof harness>, gateUsd: number): void {
  // 结算权威侧：直接冻结 cost_daily final 行（$100）；收割明细侧：GATE_PASS.cost_usd
  h.ledger.appendCostDaily({
    id: `${'0'.repeat(25)}4`,
    company: COMPANY,
    person_id: 'AGENT-1',
    model: 'm-high',
    cost_date: '2026-10-21',
    tokens: { tokens_in: 1_000_000, tokens_out: 0, cache_read: 0, cache_creation: 0 },
    price_snapshot_id: `ps-${'0'.repeat(25)}1`,
    cost_usd: 100,
    kind: 'final',
    closed_at: new Date(2026, 9, 21, 20).valueOf(),
    closed_by: 'cost-close:2026-10-21',
    note: '737-test 结算权威行',
  })
  const gate: EventRecord = {
    id: `${'0'.repeat(25)}3`, ts: new Date(2026, 9, 21, 12).valueOf(), company: COMPANY, issue: 'hb-sentinel',
    event: 'GATE_PASS', actor: 'daemon', attempt: 1, level: 1, dept: 'departments/工程部',
    tokens: { input: 0 }, cost_usd: gateUsd, note: 'src=harvest;model=m-high',
  }
  expect(h.ledger.appendEvent(gate).appended).toBe(true)
}

function reconKv(h: ReturnType<typeof harness>): { level: string; closedUsd: number; harvestUsd: number; deltaUsd: number; date: string } {
  const raw = h.ledger.kvGet('cost.recon.last')
  expect(raw).not.toBeNull()
  return JSON.parse(raw as string) as { level: string; closedUsd: number; harvestUsd: number; deltaUsd: number; date: string }
}

describe('737 cost recon：3 组差异 + 无明细（log-only 不阻断）', () => {
  it('忽略：gate=99.999 → level=ignore，无 COST_RECON 告警，kv/日志在案', () => {
    const h = harness()
    try {
      seed(h, 99.999)
      const report = runCostCloseTick(h.deps())
      expect(report.ran).toBe(true)
      const kv = reconKv(h)
      expect(kv.level).toBe('ignore')
      expect(kv.date).toBe('2026-10-21')
      expect(kv.closedUsd).toBeCloseTo(100, 6)
      expect(kv.deltaUsd).toBeCloseTo(0.001, 6)
      expect(h.logs.some((line) => line.includes('[cost-recon]') && line.includes('level=ignore'))).toBe(true)
      expect(h.alarms.some((note) => note.includes('COST_RECON_'))).toBe(false)
    } finally {
      h.ledger.close()
    }
  })

  it('告警：gate=99 → level=warn，DAILY_ALARM 含 COST_RECON_WARN；不阻断收口（final 行照落）', () => {
    const h = harness()
    try {
      seed(h, 99)
      const report = runCostCloseTick(h.deps())
      expect(report.ran).toBe(true)
      expect(report.ran).toBe(true)
      const kv = reconKv(h)
      expect(kv.level).toBe('warn')
      expect(kv.deltaUsd).toBeCloseTo(1, 6)
      expect(h.alarms.some((note) => note.includes('COST_RECON_WARN'))).toBe(true)
      expect(h.errors).toEqual([])
    } finally {
      h.ledger.close()
    }
  })

  it('升级：gate=94 → level=escalate；无明细（gate=0）→ escalate（不静默）', () => {
    const h = harness()
    try {
      seed(h, 94)
      runCostCloseTick(h.deps())
      expect(reconKv(h).level).toBe('escalate')
      expect(h.alarms.some((note) => note.includes('COST_RECON_ESCALATE'))).toBe(true)
    } finally {
      h.ledger.close()
    }
    const h2 = harness()
    try {
      seed(h2, 0)
      runCostCloseTick(h2.deps())
      const kv = reconKv(h2)
      expect(kv.level).toBe('escalate')
      expect(kv.harvestUsd).toBe(0)
      expect(h2.alarms.some((note) => note.includes('COST_RECON_ESCALATE'))).toBe(true)
    } finally {
      h2.ledger.close()
    }
  })
  it('跨日：次日收口把 kv 推进到新日期，差异分级独立重算（不沿用上日结论）', () => {
    const h = harness()
    try {
      // D-2（10-21）：$100 结算 vs $99 明细 → warn
      seed(h, 99)
      const first = runCostCloseTick(h.deps())
      expect(first.closedDates).toEqual(['2026-10-21'])
      expect(reconKv(h).date).toBe('2026-10-21')
      expect(reconKv(h).level).toBe('warn')
      // D-1（10-22）：另一日 $10 结算 vs $10 明细 → ignore（独立分级）
      h.ledger.appendCostDaily({
        id: `${'0'.repeat(25)}5`, company: COMPANY, person_id: 'AGENT-2', model: 'm-high', cost_date: '2026-10-22',
        tokens: { tokens_in: 100_000, tokens_out: 0, cache_read: 0, cache_creation: 0 },
        price_snapshot_id: `ps-${'0'.repeat(25)}1`, cost_usd: 10, kind: 'final',
        closed_at: new Date(2026, 9, 22, 20).valueOf(), closed_by: 'cost-close:2026-10-22',
      })
      const gate2: EventRecord = {
        id: `${'0'.repeat(25)}6`, ts: new Date(2026, 9, 22, 12).valueOf(), company: COMPANY, issue: 'hb-sentinel',
        event: 'GATE_PASS', actor: 'daemon', attempt: 1, level: 1, dept: 'departments/工程部',
        tokens: { input: 0 }, cost_usd: 10, note: 'src=harvest;model=m-high',
      }
      expect(h.ledger.appendEvent(gate2).appended).toBe(true)
      // 推进到 10-23 19:55（收 10-22）
      const h2 = h as unknown as { setNow?: (t: number) => void }
      void h2
      const deps = h.deps()
      const second = runCostCloseTick({ ...deps, now: () => new Date(2026, 9, 23, 19, 55).valueOf() })
      expect(second.closedDates).toContain('2026-10-22')
      const kv = reconKv(h)
      expect(kv.date).toBe('2026-10-22')
      expect(kv.level).toBe('ignore')
      expect(kv.closedUsd).toBe(10)
      expect(kv.harvestUsd).toBe(10)
    } finally {
      h.ledger.close()
    }
  })

})
