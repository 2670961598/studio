/**
 * pricing 快照自愈兜底 V2 套件（studio-dev-837）
 *
 * 依据：/tmp/fault-scout-812-837-plan-2026-11-06.md B3；837 票「供给面自愈兜底」。
 * 断言面：当日首拍写入 / 同日重跑与重启幂等 / 已有快照跳过不覆盖 / 坏档失败
 * （DAILY_ALARM+errors+kv 不前进，下拍重试）/ 单价与模型归一形（离线 models.yaml 投影）。
 * 不写 schema/契约；不用 skip/only/todo/retry。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { ModelTier } from '@studio-next/contract'
import { openLedger } from '@studio-next/store'
import { ensurePricingSnapshotTick, PRICING_SEED_DATE_KEY } from '../../../src/engine/pricing/publish.ts'
import { makeUlid } from '../../../src/engine/tools/id.ts'

const ROOT = mkdtempSync(path.join(tmpdir(), 'sn837-seed-'))
afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true })
})

const COMPANY = 'studio-dev'
/** 本地 2026-11-05 12:00（>10:00；seed 不依赖小时，仅取本地日） */
const NOW = new Date(2026, 10, 5, 12, 0, 0).getTime()
const DATE = '2026-11-05'

function tier(id: ModelTier['tier'], provider: string, model: string, input: number, output: number): ModelTier {
  return { tier: id, provider, model, price: { inputPerM: input, outputPerM: output } }
}

/** 生产形（2026-11-03 models.yaml）：三档同模型同价 → 折叠 1 行 */
const SAME_MODEL: ModelTier[] = [
  tier('high', 'opencode-go', 'deepseek-v4.1-flash', 0.015, 0.06),
  tier('mid', 'opencode-go', 'deepseek-v4.1-flash', 0.015, 0.06),
  tier('low', 'opencode-go', 'deepseek-v4.1-flash', 0.015, 0.06),
]

interface Harness {
  ledger: ReturnType<typeof openLedger>
  alarms: string[]
  errors: string[]
  deps: (tiers: readonly ModelTier[] | undefined) => Parameters<typeof ensurePricingSnapshotTick>[0]
}

let seq = 0
function harness(label: string): Harness {
  const ledger = openLedger(path.join(ROOT, `${label}.sqlite`))
  const alarms: string[] = []
  const errors: string[] = []
  const makeId = (): string => makeUlid(NOW + seq++)
  return {
    ledger,
    alarms,
    errors,
    deps: (tiers) => ({
      ledger,
      company: COMPANY,
      tiers,
      now: () => NOW,
      makeId,
      emitAlarm: (note) => alarms.push(note),
      onError: (message) => errors.push(message),
    }),
  }
}

describe('837 pricing 快照自愈兜底', () => {
  it('空库首拍：写入 today 快照、kv 前进、单价/模型归一形（离线 models.yaml 投影）', () => {
    const h = harness('first')
    const report = ensurePricingSnapshotTick(h.deps(SAME_MODEL))
    expect(report).toMatchObject({ date: DATE, seeded: true, appended: 1, outcome: 'seeded' })
    expect(h.ledger.kvGet(PRICING_SEED_DATE_KEY)).toBe(DATE)
    const rows = h.ledger.listPriceSnapshots({ company: COMPANY, price_date: DATE })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      provider: 'opencode-go',
      model: 'deepseek-v4.1-flash',
      price_date: DATE,
      slot: 'peak',
      input_per_m: 0.015,
      output_per_m: 0.06,
      currency: 'USD',
      source_ticket: `seed-pricing:${DATE}`,
      published_by: 'HF-1',
      billing_track: 'api',
    })
    expect(rows[0]?.source_note).toContain('自愈兜底')
    expect(h.alarms).toEqual([])
    expect(h.errors).toEqual([])
  })

  it('同日重跑 + 模拟重启：appended=0（kv 命中/已有快照跳过），不重复写', () => {
    const h = harness('idempotent')
    ensurePricingSnapshotTick(h.deps(SAME_MODEL))
    const count = h.ledger.listPriceSnapshots({ company: COMPANY, price_date: DATE }).length
    expect(ensurePricingSnapshotTick(h.deps(SAME_MODEL))).toMatchObject({ appended: 0, outcome: 'kv' })
    // 模拟重启：kv 日锚丢失后重跑（已有今日快照 → 尊重既有，不覆盖不追加）
    h.ledger.kvSet(PRICING_SEED_DATE_KEY, '')
    expect(ensurePricingSnapshotTick(h.deps(SAME_MODEL))).toMatchObject({ appended: 0, outcome: 'existing' })
    expect(h.ledger.kvGet(PRICING_SEED_DATE_KEY)).toBe(DATE)
    expect(h.ledger.listPriceSnapshots({ company: COMPANY, price_date: DATE })).toHaveLength(count)
  })

  it('已有今日快照（人工/定价单来源）→ 跳过不覆盖、无告警', () => {
    const h = harness('existing')
    h.ledger.appendPriceSnapshot({
      id: `ps-${makeUlid(NOW + 900)}`,
      company: COMPANY,
      provider: 'manual-provider',
      model: 'manual-model',
      price_date: DATE,
      slot: 'peak',
      input_per_m: 9,
      output_per_m: 18,
      source_note: '人工补种',
      source_ticket: 'manual:2026-11-05',
      published_by: 'HF-1',
    })
    expect(ensurePricingSnapshotTick(h.deps(SAME_MODEL))).toMatchObject({ appended: 0, outcome: 'existing' })
    expect(h.alarms).toEqual([])
    const rows = h.ledger.listPriceSnapshots({ company: COMPANY, price_date: DATE })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.model).toBe('manual-model') // 不覆盖既有
  })

  it('catalog 缺席=态B零行为；缺档/档数不足 → DAILY_ALARM+errors+kv 不前进；修好后下拍重试成功', () => {
    const h = harness('bad-tiers')
    // 态 B（catalog 缺席）：零行为（不写/不告警/不报错）——既有无 models.yaml 基线不被污染
    expect(ensurePricingSnapshotTick(h.deps(undefined))).toMatchObject({ outcome: 'catalog-absent', appended: 0 })
    expect(h.alarms).toEqual([])
    expect(h.errors).toEqual([])
    expect(h.ledger.kvGet(PRICING_SEED_DATE_KEY)).toBeNull()
    const bad = ensurePricingSnapshotTick(h.deps(SAME_MODEL.slice(0, 2)))
    expect(bad).toMatchObject({ seeded: false, appended: 0, outcome: 'error' })
    expect(h.ledger.kvGet(PRICING_SEED_DATE_KEY)).toBeNull() // 失败不前进
    expect(h.ledger.listPriceSnapshots({ company: COMPANY, price_date: DATE })).toHaveLength(0) // 不写半表
    expect(h.alarms).toHaveLength(1)
    expect(h.alarms[0]).toContain('src=pricing-seed')
    expect(h.alarms[0]).toContain('tiers-incomplete')
    expect(h.errors.some((e) => e.includes('定价快照自愈兜底失败'))).toBe(true)
    // 下拍重试（tiers 修复）→ 成功并前进 kv
    expect(ensurePricingSnapshotTick(h.deps(SAME_MODEL))).toMatchObject({ seeded: true, appended: 1, outcome: 'seeded' })
    expect(h.ledger.kvGet(PRICING_SEED_DATE_KEY)).toBe(DATE)
    expect(h.ledger.listPriceSnapshots({ company: COMPANY, price_date: DATE })).toHaveLength(1)
  })

  it('同模型异价（坏配置）→ 失败告警且 kv 不前进（不猜价、不写坏价）', () => {
    const h = harness('conflict')
    const conflict = [
      tier('high', 'zhipu', 'glm-5.3', 0.6, 2.2),
      tier('mid', 'zhipu', 'glm-5.3', 0.3, 1.1),
      tier('low', 'zhipu', 'glm-5.4', 0.1, 0.4),
    ]
    expect(ensurePricingSnapshotTick(h.deps(conflict))).toMatchObject({ outcome: 'error', appended: 0 })
    expect(h.ledger.kvGet(PRICING_SEED_DATE_KEY)).toBeNull()
    expect(h.ledger.listPriceSnapshots({ company: COMPANY, price_date: DATE })).toHaveLength(0)
    expect(h.alarms[0]).toContain('price-conflict')
  })
})

/** 三模型三价（partial 用例用：期望 3 行；便于构造半表+其他来源行） */
const THREE_MODELS: ModelTier[] = [
  tier('high', 'deepseek', 'v4-pro', 1.32, 3.96),
  tier('mid', 'zhipu', 'glm-5.3', 0.6, 2.2),
  tier('low', 'deepseek', 'flash', 0.15, 0.6),
]

function appendRow(
  h: Harness,
  row: { id: string; provider: string; model: string; price_date: string; slot?: 'peak'; input: number; output: number; source_ticket: string; source_note?: string },
): void {
  h.ledger.appendPriceSnapshot({
    id: `ps-${row.id}`,
    company: COMPANY,
    provider: row.provider,
    model: row.model,
    price_date: row.price_date,
    slot: row.slot ?? 'peak',
    input_per_m: row.input,
    output_per_m: row.output,
    source_note: row.source_note ?? 'fixture',
    source_ticket: row.source_ticket,
    published_by: 'HF-1',
  })
}

describe('837 v2 F1/F2：partial 不覆盖其他来源行 + 坏档不静默前进', () => {
  it('F1 partial+人工行重试：人工 version/价不变，只补缺键', () => {
    const h = harness('partial-manual')
    // 半表：seed 已有 A 行；同日人工行 B（价故意不同）→ existing=2 < expected 3
    appendRow(h, {
      id: makeUlid(NOW + 100),
      provider: 'deepseek',
      model: 'v4-pro',
      price_date: DATE,
      input: 1.32,
      output: 3.96,
      source_ticket: `seed-pricing:${DATE}`,
    })
    appendRow(h, {
      id: makeUlid(NOW + 101),
      provider: 'zhipu',
      model: 'glm-5.3',
      price_date: DATE,
      input: 9,
      output: 18,
      source_ticket: 'manual:2026-11-05',
      source_note: '人工价（不得覆盖）',
    })
    const report = ensurePricingSnapshotTick(h.deps(THREE_MODELS))
    expect(report).toMatchObject({ outcome: 'partial', appended: 1, seeded: true })
    const rows = h.ledger.listPriceSnapshots({ company: COMPANY, price_date: DATE })
    expect(rows).toHaveLength(3)
    // 人工行原样：version=1、价 9/18、来源 manual（未被 seed v2 覆盖）
    const manual = rows.filter((r) => r.model === 'glm-5.3')
    expect(manual).toHaveLength(1)
    expect(manual[0]).toMatchObject({ input_per_m: 9, output_per_m: 18, version: 1, source_ticket: 'manual:2026-11-05' })
    // seed 已有行也不重复追加；只补缺键（deepseek/flash）
    const seedA = rows.filter((r) => r.provider === 'deepseek' && r.model === 'v4-pro')
    expect(seedA).toHaveLength(1)
    expect(seedA[0]?.version).toBe(1)
    const missing = rows.filter((r) => r.model === 'flash')
    expect(missing).toHaveLength(1)
    expect(missing[0]?.source_ticket).toBe(`seed-pricing:${DATE}`)
    // 自然键唯一（无 v2 覆盖行）
    const keys = rows.map((r) => `${r.provider}/${r.model}/${r.price_date}/${r.slot}`)
    expect(new Set(keys).size).toBe(3)
  })

  it('F2 partial+坏档：kv 空+DAILY_ALARM+errors；修好后补齐半表', () => {
    const h = harness('partial-badtiers')
    appendRow(h, {
      id: makeUlid(NOW + 200),
      provider: 'deepseek',
      model: 'v4-pro',
      price_date: DATE,
      input: 1.32,
      output: 3.96,
      source_ticket: `seed-pricing:${DATE}`,
    })
    const bad = ensurePricingSnapshotTick(h.deps(THREE_MODELS.slice(0, 2)))
    expect(bad).toMatchObject({ outcome: 'error', appended: 0 })
    expect(h.ledger.kvGet(PRICING_SEED_DATE_KEY)).toBeNull() // 不静默前进
    expect(h.alarms).toHaveLength(1)
    expect(h.alarms[0]).toContain('src=pricing-seed')
    expect(h.alarms[0]).toContain('tiers-incomplete')
    expect(h.errors.some((e) => e.includes('定价快照自愈兜底失败'))).toBe(true)
    expect(h.ledger.listPriceSnapshots({ company: COMPANY, price_date: DATE })).toHaveLength(1) // 无新写
    // 修好 tiers → 现实中下拍重试：补齐缺键、写日锚
    const fixed = ensurePricingSnapshotTick(h.deps(THREE_MODELS))
    expect(fixed).toMatchObject({ outcome: 'partial', appended: 2, seeded: true })
    expect(h.ledger.kvGet(PRICING_SEED_DATE_KEY)).toBe(DATE)
    expect(h.ledger.listPriceSnapshots({ company: COMPANY, price_date: DATE })).toHaveLength(3)
  })
})
