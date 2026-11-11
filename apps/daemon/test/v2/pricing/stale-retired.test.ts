/**
 * pricing-stale 退役模型降噪 V2 套件（studio-dev-886）
 *
 * 规则：未在册（declared=false）且近 3 个自然日无 usage → retired：不写 DAILY_ALARM，
 * 仅在 report/log 标 retired；近 3 日有 usage 或已声明 → 保持原 stale 告警。
 * 不改快照/结算口径/事件词（DAILY_ALARM 仍用于真实 stale）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { openLedger, type Ledger } from '@studio-next/store'
import { makeUlid } from '../../../src/engine/tools/id.ts'
import {
  PRICING_RETIRED_USAGE_DAYS,
  PRICING_STALE_CHECK_DATE_KEY,
  PRICING_STALE_CHECK_HOUR,
  runPricingStaleCheck,
  type PricingStaleDeps,
} from '../../../src/engine/pricing/pricing.ts'

const COMPANY = 'demo-stale'
const localTime = (y: number, m: number, d: number, h: number, min = 0): number => new Date(y, m - 1, d, h, min, 0, 0).valueOf()
const DATE = '2026-11-11'
const ROOT = mkdtempSync(path.join(tmpdir(), 'sn886-stale-'))
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))
let seq = 0
beforeEach(() => {
  seq += 1
})

interface Harness {
  ledger: Ledger
  deps: (over: Partial<PricingStaleDeps>) => PricingStaleDeps
  alarms: string[]
  logs: string[]
  errors: string[]
}

function harness(): Harness {
  const ledger = openLedger(path.join(ROOT, `stale-${String(seq)}.sqlite`))
  const alarms: string[] = []
  const logs: string[] = []
  const errors: string[] = []
  return {
    ledger,
    alarms,
    logs,
    errors,
    deps: (over) => ({
      ledger,
      company: COMPANY,
      declared: [],
      now: () => localTime(2026, 11, 11, PRICING_STALE_CHECK_HOUR, 5),
      emitAlarm: (note) => alarms.push(note),
      onError: (message) => errors.push(message),
      log: (line) => logs.push(line),
      ...(over ?? {}),
    }),
  }
}

function seedSnapshot(h: Harness, provider: string, model: string, priceDate: string): void {
  h.ledger.appendPriceSnapshot({
    id: `ps-${makeUlid(Date.now() + seq)}`,
    company: COMPANY,
    provider,
    model,
    price_date: priceDate,
    slot: 'peak',
    input_per_m: 1,
    output_per_m: 2,
    source_note: 'stale 夹具',
    source_ticket: 'studio-dev-886-test',
    published_by: 'HF-1',
  })
}

function seedUsage(h: Harness, model: string, usageDate: string): void {
  h.ledger.upsertUsageDaily({
    id: makeUlid(Date.now() + seq),
    company: COMPANY,
    person_id: 'p1',
    model,
    usage_date: usageDate,
    tokens: { input: 1, output: 1, cache_read: 0, cache_creation: 0 },
    first_ts: localTime(2026, 11, 10, 9),
    last_ts: localTime(2026, 11, 10, 10),
    updated_at: localTime(2026, 11, 10, 10),
  })
}

describe('886 pricing-stale 退役模型降噪', () => {
  it('未在册+近 N 日无 usage → retired：不写 DAILY_ALARM，report/log 标 retired', () => {
    const h = harness()
    try {
      seedSnapshot(h, 'opencode-go', 'deepseek-v4.1-flash', '2026-11-05') // stale=6 但已退役
      const r = runPricingStaleCheck(h.deps({ declared: [] }))
      expect(r.checked).toBe(1)
      expect(r.alarmed).toBe(0)
      expect(r.retired).toBe(1)
      expect(r.retiredModels).toEqual(['opencode-go/deepseek-v4.1-flash'])
      expect(h.alarms).toEqual([]) // 不写 DAILY_ALARM
      expect(h.logs.some((line) => line.includes('退役模型 1 个不告警'))).toBe(true)
      expect(h.ledger.kvGet(PRICING_STALE_CHECK_DATE_KEY)).toBe(DATE)
      expect(PRICING_RETIRED_USAGE_DAYS).toBe(3)
    } finally {
      h.ledger.close()
    }
  })

  it('未在册但近 N 日内有 usage → 仍保持 stale 告警（不静默真实风险）', () => {
    const h = harness()
    try {
      seedSnapshot(h, 'ghost', 'old-model', '2026-11-05')
      seedUsage(h, 'ghost/old-model', '2026-11-10')
      const r = runPricingStaleCheck(h.deps({ declared: [] }))
      expect(r.alarmed).toBe(1)
      expect(r.retired).toBe(0)
      expect(h.alarms).toHaveLength(1)
      expect(h.alarms[0]).toContain('src=pricing-stale;model=ghost/old-model;date=2026-11-11;stale=6;declared=no(在册)')
    } finally {
      h.ledger.close()
    }
  })

  it('已声明模型 stale → 仍告警（即使无 usage）', () => {
    const h = harness()
    try {
      seedSnapshot(h, 'glm', 'GLM-5.3', '2026-11-05')
      const r = runPricingStaleCheck(h.deps({ declared: [{ provider: 'glm', model: 'GLM-5.3' }] }))
      expect(r.alarmed).toBe(1)
      expect(r.retired).toBe(0)
      expect(h.alarms[0]).toContain('model=glm/GLM-5.3')
      expect(h.alarms[0]).not.toContain('declared=no(在册)')
    } finally {
      h.ledger.close()
    }
  })

  it('近 N 天边界：usage_date=date-N 算近期（告警）；date-N-1 算退役（不告警）', () => {
    const h = harness()
    try {
      seedSnapshot(h, 'edge', 'recent', '2026-11-05')
      seedSnapshot(h, 'edge', 'older', '2026-11-05')
      seedUsage(h, 'edge/recent', '2026-11-08') // date(11-11)-3 = 11-08 含边界
      seedUsage(h, 'edge/older', '2026-11-07') // 11-08 之前 → 退役
      const r = runPricingStaleCheck(h.deps({ declared: [] }))
      expect(r.retiredModels).toEqual(['edge/older'])
      expect(h.alarms).toHaveLength(1)
      expect(h.alarms[0]).toContain('model=edge/recent')
    } finally {
      h.ledger.close()
    }
  })

  it('既有行为不回归：已声明且当日快照新鲜 → 无告警、无退役', () => {
    const h = harness()
    try {
      seedSnapshot(h, 'glm', 'GLM-5.3', DATE)
      const r = runPricingStaleCheck(h.deps({ declared: [{ provider: 'glm', model: 'GLM-5.3' }] }))
      expect(r).toMatchObject({ checked: 1, alarmed: 0, retired: 0 })
      expect(h.alarms).toEqual([])
      expect(h.errors).toEqual([])
    } finally {
      h.ledger.close()
    }
  })
})
