/**
 * cost-close cache-unpriced 观测 V2 套件（studio-dev-883 后续 B1）
 *
 * 缺陷：foldCostUsd 对 cache_read/cache_creation 缺价按 0 计并登记 unpricedBuckets，但日闭
 * degraded 只数 priceBasis（snapshot 命中但缺 cache 价=静默低估；cache 常占 token 大头）。
 * 修法：报告 JSON 增 `cacheUnpriced:{tokens,rows}`、degraded/REPORT note 加 `cache-unpriced=<tokens>`；
 * **不改 rows/usd、不加事件词/契约、不回写历史**。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ModelTier } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { COST_CLOSE_KV_KEY, runCostCloseTick, type CostCloseDeps } from '../../../src/engine/cost-close/close.ts'

const COMPANY = 'demo-cache'
const localTime = (y: number, m: number, d: number, h: number, min = 0): number => new Date(y, m - 1, d, h, min, 0, 0).valueOf()

function detIds(): (ts: number) => string {
  let n = 0
  return (): string => {
    n += 1
    return '0'.repeat(10) + String(n).padStart(16, '0')
  }
}

let root = ''
beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'sn-cache-unpriced-'))
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

interface Harness {
  ledger: Ledger
  companyDir: string
  events: { kind: 'REPORT_COST_CLOSE' | 'DAILY_ALARM'; note: string }[]
  ids: (ts: number) => string
  deps: (overrides?: Partial<CostCloseDeps>) => CostCloseDeps
  now: number
}

function harness(id: string, tiers?: ModelTier[]): Harness {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  const companyDir = path.join(root, `${id}-company`)
  const events: Harness['events'] = []
  const ids = detIds()
  const now = localTime(2026, 10, 22, 19, 55)
  return {
    ledger,
    companyDir,
    events,
    ids,
    now,
    deps: (overrides) => ({
      ledger,
      company: COMPANY,
      companyDir,
      ...(tiers !== undefined ? { tiers } : {}),
      now: () => now,
      makeId: ids,
      emitReport: (note) => events.push({ kind: 'REPORT_COST_CLOSE', note }),
      emitAlarm: (note) => events.push({ kind: 'DAILY_ALARM', note }),
      onError: () => {},
      ...(overrides ?? {}),
    }),
  }
}

function seedSnapshot(h: Harness, inputPerM: number, outputPerM: number, cacheReadPerM?: number, cacheCreationPerM?: number): void {
  h.ledger.appendPriceSnapshot({
    id: `ps-${h.ids(0)}`,
    company: COMPANY,
    provider: 'test',
    model: 'm-cache',
    price_date: '2026-10-21',
    slot: 'peak',
    input_per_m: inputPerM,
    output_per_m: outputPerM,
    ...(cacheReadPerM !== undefined ? { cache_read_per_m: cacheReadPerM } : {}),
    ...(cacheCreationPerM !== undefined ? { cache_creation_per_m: cacheCreationPerM } : {}),
    billing_track: 'api',
    source_note: 'cache 观测夹具',
    source_ticket: 'studio-dev-883-test',
    published_by: 'eng-6',
  })
}

function seedUsage(h: Harness, tokens: { input: number; output: number; cache_read?: number; cache_creation?: number }): void {
  h.ledger.upsertUsageDaily({
    id: h.ids(0),
    company: COMPANY,
    person_id: 'p1',
    model: 'test/m-cache',
    usage_date: '2026-10-21',
    tokens: { input: tokens.input, output: tokens.output, cache_read: tokens.cache_read ?? 0, cache_creation: tokens.cache_creation ?? 0 },
    first_ts: localTime(2026, 10, 21, 9),
    last_ts: localTime(2026, 10, 21, 10),
    updated_at: localTime(2026, 10, 21, 10),
  })
}

function reportOf(h: Harness): { finals: Array<{ usd: number }>; cacheUnpriced: { tokens: number; rows: number } } & Record<string, unknown> {
  const file = path.join(h.companyDir, 'reports', '综合部', 'cost-close', 'cost-close-2026-10-21.json')
  expect(existsSync(file)).toBe(true)
  return JSON.parse(readFileSync(file, 'utf8')) as never
}

describe('883 cache-unpriced 日闭观测', () => {
  it('有 cache tokens 且快照无 cache 价：报告/告警含计数、rows/usd 不变（cache 按 0 计）', () => {
    const h = harness('no-cache-price')
    try {
      seedSnapshot(h, 1, 2) // 仅 input/output 价
      seedUsage(h, { input: 1_000_000, output: 0, cache_read: 5_000_000, cache_creation: 2_000_000 })
      const r = runCostCloseTick(h.deps())
      expect(r.ran).toBe(true)
      expect(r.finalRows).toBe(1)
      const report = reportOf(h)
      expect(report.cacheUnpriced).toEqual({ tokens: 7_000_000, rows: 1 })
      // usd 不变：只按 input/output 计（cache 仍按 0，下界值）——1M*1$/M=1
      expect(report.finals[0]?.usd).toBeCloseTo(1, 10)
      const alarms = h.events.filter((e) => e.kind === 'DAILY_ALARM' && e.note.startsWith('src=cost-close'))
      expect(alarms).toHaveLength(1)
      expect(alarms[0]?.note).toContain('cache-unpriced=7000000')
      expect(alarms[0]?.note).toContain('cache-unpriced-rows=1')
      const emit = h.events.find((e) => e.kind === 'REPORT_COST_CLOSE' && e.note.startsWith('src=cost-close'))
      expect(emit?.note).toContain('cache-unpriced=7000000')
      expect(emit?.note).toContain('usd=1.0000')
    } finally {
      h.ledger.close()
    }
  })

  it('无 cache tokens：cacheUnpriced=0、无 degraded 告警', () => {
    const h = harness('no-cache-tokens')
    try {
      seedSnapshot(h, 1, 2)
      seedUsage(h, { input: 1_000_000, output: 0 })
      runCostCloseTick(h.deps())
      const report = reportOf(h)
      expect(report.cacheUnpriced).toEqual({ tokens: 0, rows: 0 })
      expect(h.events.filter((e) => e.kind === 'DAILY_ALARM' && e.note.startsWith('src=cost-close'))).toHaveLength(0)
    } finally {
      h.ledger.close()
    }
  })

  it('快照带 cache 价：cache 计入 cost，cacheUnpriced=0、无告警', () => {
    const h = harness('with-cache-price')
    try {
      seedSnapshot(h, 1, 2, 0.5, 0.25) // input 1 / cacheRead 0.5 / cacheCreation 0.25 $/M
      seedUsage(h, { input: 1_000_000, output: 0, cache_read: 2_000_000, cache_creation: 1_000_000 })
      runCostCloseTick(h.deps())
      const report = reportOf(h)
      expect(report.cacheUnpriced).toEqual({ tokens: 0, rows: 0 })
      // usd = 1*1 + 2*0.5 + 1*0.25 = 2.25（cache 价已计入）
      expect(report.finals[0]?.usd).toBeCloseTo(2.25, 10)
      expect(h.events.filter((e) => e.kind === 'DAILY_ALARM' && e.note.startsWith('src=cost-close'))).toHaveLength(0)
    } finally {
      h.ledger.close()
    }
  })

  it('既有降级告警口径不回归：stale/bridge/unpriced 计数保留，cache 计数附加', () => {
    const h = harness('degraded-regression', [
      { tier: 'high', provider: 'test', model: 'm-high', price: { inputPerM: 1, outputPerM: 2 } },
    ])
    try {
      seedSnapshot(h, 1, 2) // test/m-cache 当日快照（exact，但无 cache 价）
      seedUsage(h, { input: 1, output: 0, cache_read: 10 })
      // 桥：test/m-high 无快照但在 tiers；无价：ghost/m-x
      h.ledger.upsertUsageDaily({
        id: h.ids(0), company: COMPANY, person_id: 'p2', model: 'test/m-high', usage_date: '2026-10-21',
        tokens: { input: 100, output: 0, cache_read: 0, cache_creation: 0 }, first_ts: localTime(2026, 10, 21, 9), last_ts: localTime(2026, 10, 21, 10), updated_at: localTime(2026, 10, 21, 10),
      })
      h.ledger.upsertUsageDaily({
        id: h.ids(0), company: COMPANY, person_id: 'p3', model: 'ghost/m-x', usage_date: '2026-10-21',
        tokens: { input: 100, output: 0, cache_read: 0, cache_creation: 0 }, first_ts: localTime(2026, 10, 21, 9), last_ts: localTime(2026, 10, 21, 10), updated_at: localTime(2026, 10, 21, 10),
      })
      runCostCloseTick(h.deps())
      const alarm = h.events.find((e) => e.kind === 'DAILY_ALARM' && e.note.startsWith('src=cost-close'))
      expect(alarm?.note).toContain('degraded=stale:0,bridge:1,unpriced:1')
      expect(alarm?.note).toContain('cache-unpriced=10') // cache 缺价计数附加，不替换原口径
      expect(h.ledger.kvGet(COST_CLOSE_KV_KEY)).toBe('2026-10-21')
    } finally {
      h.ledger.close()
    }
  })
})
