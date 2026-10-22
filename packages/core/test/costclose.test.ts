/**
 * costclose 纯逻辑单测（132-§6.3 单D·studio-dev-179）：折算计划三路降级/巡检补账/
 * 对账段/P7 合并展示/财务分析面四规则/报告装配。
 *
 * 断言面对 plan.md §3：LLM 不做算术——一切 Δ/Σ 皆机械可复算（本套即复算标尺）；
 * 阈值=拟稿常量（COST_ANOMALY_* 等——改值走批示，测试引用常量不写死数字）。
 */
import { describe, expect, it } from 'vitest'
import type { ModelTier } from '@studio-next/contract'
import {
  ADJUSTMENT_MERGE_USD,
  CACHE_HIT_LOW,
  COST_ANOMALY_MIN_USD,
  COST_ANOMALY_SPIKE_MULT,
  COST_CLOSE_HOUR,
  COST_CLOSE_KV_KEY,
  COST_CLOSE_MINUTE,
  PLAN_SWITCHEVER_MULT,
  RECON_EPS_USD,
  buildCostCloseReport,
  mergeTinyAdjustments,
  planCostCells,
  reconcileDate,
  sweepClosedDate,
  type CostCellPlan,
  type CostRowLike,
  type PriceSnapshotLike,
} from '../src/costclose.ts'
import {
  CACHE_HIT_LOW,
  COST_ANOMALY_MIN_USD,
  COST_ANOMALY_SPIKE_MULT,
  PLAN_SWITCHEVER_MULT,
  costInsights,
} from '../src/cost-insights.ts'

/** 快照行构造（core 投影面——provider/model/price_date/单价） */
function snap(provider: string, model: string, priceDate: string, input: number, output: number, cacheRead?: number): PriceSnapshotLike {
  return {
    provider,
    model,
    price_date: priceDate,
    slot: 'peak',
    version: 1,
    input_per_m: input,
    output_per_m: output,
    ...(cacheRead !== undefined ? { cache_read_per_m: cacheRead } : {}),
    billing_track: 'api',
  }
}

function usage(person: string, model: string, input: number, output: number, read = 0, creation = 0): { person_id: string; model: string; tokens_in: number; tokens_out: number; cache_read: number; cache_creation: number } {
  return { person_id: person, model, tokens_in: input, tokens_out: output, cache_read: read, cache_creation: creation }
}

const TIERS: ModelTier[] = [
  { tier: 'high', provider: 'test', model: 'm-high', price: { inputPerM: 600, outputPerM: 2200 } },
  { tier: 'mid', provider: 'test', model: 'm-mid', price: { inputPerM: 200, outputPerM: 800 } },
  { tier: 'low', provider: 'test', model: 'm-low', price: { inputPerM: 50, outputPerM: 250 } },
]

describe('planCostCells：三路降级折算', () => {
  it('快照当日（exact）：全桶折算机械复算（1M×1.32 + 2M×3.96 + 0.5M×0.044 = 9.262）', () => {
    const cells = planCostCells([usage('p1', 'test/m-high', 1_000_000, 2_000_000, 500_000)], [snap('test', 'm-high', '2026-10-22', 1.32, 3.96, 0.044)], TIERS, '2026-10-22')
    expect(cells).toHaveLength(1)
    const c = cells[0] as CostCellPlan
    expect(c.usd).toBeCloseTo(9.262, 10)
    expect(c.priceBasis).toBe('snapshot')
    expect(c.exact).toBe(true)
    expect(c.staleDays).toBe(0)
    expect(c.unpricedBuckets).toEqual([])
  })

  it('快照沿用（carry）：exact=false + staleDays=日差；cache_creation 未定价桶如实标记', () => {
    const cells = planCostCells([usage('p1', 'test/m-high', 1_000_000, 0, 0, 200_000)], [snap('test', 'm-high', '2026-10-19', 1.32, 3.96)], TIERS, '2026-10-22')
    const c = cells[0] as CostCellPlan
    expect(c.priceBasis).toBe('snapshot')
    expect(c.exact).toBe(false)
    expect(c.staleDays).toBe(3)
    // in=1M×1.32=1.32；creation 无价=0 计+桶标记（低估不编造）
    expect(c.usd).toBeCloseTo(1.32, 10)
    expect(c.unpricedBuckets).toEqual(['cache_creation'])
  })

  it('models-yaml 桥：无快照而在册——锚 sentinel models-yaml:<model>', () => {
    const cells = planCostCells([usage('p1', 'test/m-mid', 1_000_000, 1_000_000)], [snap('other', 'x', '2026-10-22', 9, 9)], TIERS, '2026-10-22')
    const c = cells[0] as CostCellPlan
    expect(c.priceBasis).toBe('models-yaml')
    expect(c.priceSnapshotId).toBe('models-yaml:test/m-mid')
    // 声明面价 $200/$800 per 1M → 1M×200/1M + 1M×800/1M = 1000
    expect(c.usd).toBeCloseTo(1_000_000 * 200 / 1_000_000 + 1_000_000 * 800 / 1_000_000, 10)
    expect(c.exact).toBe(false)
  })

  it('无价：usd=0 下界收口+有量桶全标 unpriced（不编造价格）', () => {
    const cells = planCostCells([usage('p1', 'ghost/m-x', 100, 50, 5)], [], TIERS, '2026-10-22')
    const c = cells[0] as CostCellPlan
    expect(c.priceBasis).toBe('unpriced')
    expect(c.priceSnapshotId).toBe('unpriced')
    expect(c.usd).toBe(0)
    expect(c.unpricedBuckets).toEqual(['tokens_in', 'tokens_out', 'cache_read'])
  })
})

describe('sweepClosedDate：巡检补账（S3）', () => {
  const finalRow = (id: string, person: string, model: string, usd: number, inTok: number): CostRowLike => ({
    id, person_id: person, model, cost_date: '2026-10-22',
    tokens_in: inTok, tokens_out: 0, cache_read: 0, cache_creation: 0,
    cost_usd: usd, kind: 'final',
  })
  const adjRow = (person: string, model: string, usd: number, adjusts: string, inTok = 0): CostRowLike => ({
    id: 'adj-1', person_id: person, model, cost_date: '2026-10-22',
    tokens_in: inTok, tokens_out: 0, cache_read: 0, cache_creation: 0,
    cost_usd: usd, kind: 'adjustment', adjusts_id: adjusts, note: '迟到事实补账',
  })
  const desired = (person: string, model: string, usd: number, inTok: number): CostCellPlan => ({
    person_id: person, model, tokens: { tokens_in: inTok, tokens_out: 0, cache_read: 0, cache_creation: 0 },
    usd, priceBasis: 'snapshot', priceSnapshotId: 'ps-x', exact: true, staleDays: 0, unpricedBuckets: [],
  })

  it('迟到事实（用量升）：signed 正 delta + late-facts；挂 final 行 id', () => {
    const frozen = [finalRow('f1', 'p1', 'test/m-high', 1.0, 100)]
    const want = [desired('p1', 'test/m-high', 1.25, 125)]
    const sweep = sweepClosedDate(frozen, want)
    expect(sweep.adjustments).toHaveLength(1)
    const a = sweep.adjustments[0] as { adjustsId: string; usdDelta: number; reason: string; tokensDelta: { tokens_in: number } }
    expect(a.adjustsId).toBe('f1')
    expect(a.usdDelta).toBeCloseTo(0.25, 10)
    expect(a.tokensDelta.tokens_in).toBe(25)
    expect(a.reason).toBe('late-facts')
    expect(sweep.newCells).toHaveLength(0)
  })

  it('数据修复（用量降/归零）：负 delta + data-repair', () => {
    const sweep = sweepClosedDate([finalRow('f1', 'p1', 'test/m-high', 1.0, 100)], [desired('p1', 'test/m-high', 0.4, 40)])
    expect(sweep.adjustments).toHaveLength(1)
    expect(sweep.adjustments[0]?.usdDelta).toBeCloseTo(-0.6, 10)
    expect(sweep.adjustments[0]?.reason).toBe('data-repair')
  })

  it('一致=零行（崩溃重放同参幂等）；已冻 adjustment 计入 Σ', () => {
    const frozen = [finalRow('f1', 'p1', 'test/m-high', 1.0, 100), adjRow('p1', 'test/m-high', 0.25, 'f1', 25)]
    const sweep = sweepClosedDate(frozen, [desired('p1', 'test/m-high', 1.25, 125)])
    expect(sweep.adjustments).toHaveLength(0)
    expect(sweep.cellTruths[0]?.usd).toBeCloseTo(1.25, 10)
  })

  it('迟到新格（用量在 final 无）→ newCells 首冻', () => {
    const sweep = sweepClosedDate([finalRow('f1', 'p1', 'test/m-high', 1.0, 100)], [desired('p1', 'test/m-high', 1.0, 100), desired('p2', 'test/m-mid', 0.5, 50)])
    expect(sweep.adjustments).toHaveLength(0)
    expect(sweep.newCells.map((c) => c.person_id)).toEqual(['p2'])
  })
})

describe('reconcileDate：对账段（R4）', () => {
  const row = (model: string, usd: number): CostRowLike => ({
    id: 'r', person_id: 'p1', model, cost_date: '2026-10-22',
    tokens_in: 0, tokens_out: 0, cache_read: 0, cache_creation: 0,
    cost_usd: usd, kind: 'final',
  })
  it('平（|Δ|≤eps）：diverged=false', () => {
    const seg = reconcileDate('2026-10-22', [row('test/m-high', 9.262)], [{ usd: 9.262, note: 'src=x;model=test/m-high' }])
    expect(seg.closedUsd).toBeCloseTo(9.262, 10)
    expect(seg.deltaUsd).toBeCloseTo(0, 10)
    expect(seg.diverged).toBe(false)
    expect(seg.perModel).toHaveLength(1)
  })
  it('差（|Δ|>eps）：diverged=true + 分模型段', () => {
    const seg = reconcileDate('2026-10-22', [row('test/m-high', 9.26), row('test/m-mid', 1.0)], [{ usd: 3.0, note: 'model=test/m-high' }, { usd: 1.0, note: 'model=test/m-mid' }])
    expect(seg.diverged).toBe(true)
    expect(seg.deltaUsd).toBeCloseTo(6.26, 10)
    const high = seg.perModel.find((m) => m.model === 'test/m-high')
    expect(high?.deltaUsd).toBeCloseTo(6.26, 10)
  })
  it('note 无 model=未归因行；无 usd 记 0', () => {
    const seg = reconcileDate('2026-10-22', [row('test/m-high', 1.0)], [{ note: 'no model here' }])
    expect(seg.harvestUsd).toBe(0)
    expect(seg.perModel.find((m) => m.model === '(unattributed)')?.harvestUsd).toBe(0)
  })
})

describe('mergeTinyAdjustments：P7 合并展示', () => {
  it('|usd|<阈 合并一行；大额逐行；合计全量不缩水', () => {
    const d = mergeTinyAdjustments([
      { person_id: 'p1', model: 'test/m-high', usd: 0.005 },
      { person_id: 'p2', model: 'test/m-mid', usd: -0.003 },
      { person_id: 'p3', model: 'test/m-high', usd: 0.5 },
    ])
    expect(d.mergedCount).toBe(2)
    expect(d.mergedUsd).toBeCloseTo(0.002, 10)
    expect(d.totalUsd).toBeCloseTo(0.502, 10)
    const mergedLine = d.lines.find((l) => l.merged === true)
    expect(mergedLine?.count).toBe(2)
    expect(d.lines.filter((l) => l.merged !== true)).toHaveLength(1)
  })
  it('零并行=无合并行（不产噪声空行）', () => {
    const d = mergeTinyAdjustments([{ person_id: 'p1', model: 'm', usd: 0.5 }])
    expect(d.mergedCount).toBe(0)
    expect(d.lines.every((l) => l.merged !== true)).toBe(true)
  })
})

describe('costInsights：财务分析面四规则（阈值=拟稿常量引用）', () => {
  const cell = (model: string, usd: number, inTok = 0, read = 0, creation = 0): CostCellPlan => ({
    person_id: 'p1', model, tokens: { tokens_in: inTok, tokens_out: 0, cache_read: read, cache_creation: creation },
    usd, priceBasis: 'snapshot', priceSnapshotId: 'ps-x', exact: true, staleDays: 0, unpricedBuckets: [],
  })
  const HISTORY_DAYS = 7

  it('成本异常：≥下限且 ≥均值×倍数 → 突增；无基线 → 新贵关注', () => {
    const mean = COST_ANOMALY_MIN_USD / 2 // 均值 $2.5 → 3× = $7.5 < $15 → 命中
    const today = COST_ANOMALY_MIN_USD * 1.5
    const history = Array.from({ length: HISTORY_DAYS }, (_, i) => ({ cost_date: `d${String(i)}`, model: 'test/m-high', usd: mean }))
    let out = costInsights({ date: '2026-10-22', cells: [cell('test/m-high', today)], history })
    expect(out.filter((i) => i.kind === 'cost-anomaly')).toHaveLength(1)
    // 突增不足（<3×均值）→ 不告
    out = costInsights({ date: '2026-10-22', cells: [cell('test/m-high', today * 0.5)], history })
    expect(out.filter((i) => i.kind === 'cost-anomaly')).toHaveLength(0)
    // 无基线新高 → 关注面（不静默不噪声）
    out = costInsights({ date: '2026-10-22', cells: [cell('test/m-high', COST_ANOMALY_MIN_USD + 1)], history: [] })
    expect(out.filter((i) => i.kind === 'cost-anomaly' && i.facts['baseline'] === 'none')).toHaveLength(1)
    // 低于下限 → 零命中（噪声闸）
    out = costInsights({ date: '2026-10-22', cells: [cell('test/m-high', 0.1)], history: [] })
    expect(out).toHaveLength(0)
  })

  it('档位错配：用量模型不在声明面；高价档在用+低价档在册零用', () => {
    const declared = TIERS.map((t) => ({ provider: t.provider, model: t.model, tier: t.tier }))
    const out = costInsights({
      date: '2026-10-22',
      cells: [cell('test/m-high', COST_ANOMALY_MIN_USD), cell('ghost/m-x', 0.01)],
      history: [],
      declared,
    })
    const mismatches = out.filter((i) => i.kind === 'tier-mismatch')
    expect(mismatches.some((i) => i.message.includes('ghost/m-x'))).toBe(true)
    expect(mismatches.some((i) => i.message.includes('m-mid') && i.message.includes('高价档'))).toBe(true)
  })

  it('缓存优化：命中率低（总量达标）+ 写多读少 churn', () => {
    const inTok = 2_000_000 // 命中率 0.5M/(2M+0.5M)=0.2 < 0.5
    const out = costInsights({ date: '2026-10-22', cells: [cell('test/m-high', 1, inTok, 500_000)], history: [] })
    expect(out.filter((i) => i.kind === 'cache-optimization' && i.message.includes('命中率'))).toHaveLength(1)
    const churn = costInsights({ date: '2026-10-22', cells: [cell('test/m-high', 1, 100_000, 50_000, 1_500_000)], history: [] })
    expect(churn.filter((i) => i.kind === 'cache-optimization' && i.message.includes('写多读少'))).toHaveLength(1)
    // 总量不足 → 不评
    const small = costInsights({ date: '2026-10-22', cells: [cell('test/m-high', 1, 1000, 100)], history: [] })
    expect(small).toHaveLength(0)
  })

  it('包月 vs API：月化流量 ≥ 包月费×倍数 → 切换评估', () => {
    const planMonthly = 100
    const dailyUsd = (planMonthly * PLAN_SWITCHEVER_MULT * 2) / 30 // 月化=$240 ≥ $120
    const history = Array.from({ length: HISTORY_DAYS }, (_, i) => ({ cost_date: `d${String(i)}`, model: 'test/m-high', usd: dailyUsd }))
    const out = costInsights({
      date: '2026-10-22',
      cells: [cell('test/m-high', dailyUsd)],
      history,
      planTrack: [{ provider: 'test', model: 'm-high', planMonthlyUsd: planMonthly }],
    })
    expect(out.filter((i) => i.kind === 'plan-vs-api')).toHaveLength(1)
  })
})

describe('buildCostCloseReport + 常量锚', () => {
  it('装配体：caliber/锚/注因段（空数组不产 notes 键）', () => {
    const plans = planCostCells([usage('p1', 'test/m-high', 1_000_000, 0)], [snap('test', 'm-high', '2026-10-22', 1, 1)], TIERS, '2026-10-22')
    const body = buildCostCloseReport({
      company: 'demo-corp', date: '2026-10-22', generatedAt: 1,
      finals: plans, adjustments: [], newCells: [], insights: [], closedBy: 'cost-close:2026-10-22',
    })
    expect(body.caliber).toBe('cost-close/v1')
    expect(body.anchors).toEqual({ closed_by: 'cost-close:2026-10-22', kv_key: 'cost_close_last_date' })
    expect('notes' in body).toBe(false)
    expect(body.finals).toHaveLength(1)
    const withNotes = buildCostCloseReport({
      company: 'demo-corp', date: '2026-10-22', generatedAt: 1,
      finals: plans, adjustments: [], newCells: [], insights: [], notes: ['x'], closedBy: 'cost-close:2026-10-22',
    })
    expect(withNotes.notes).toEqual(['x'])
  })
  it('常量锚（拟稿值冻结面——改值走批示）', () => {
    expect(COST_CLOSE_HOUR).toBe(19)
    expect(COST_CLOSE_MINUTE).toBe(55)
    expect(COST_CLOSE_KV_KEY).toBe('cost_close_last_date')
    expect(ADJUSTMENT_MERGE_USD).toBe(0.01)
    expect(RECON_EPS_USD).toBe(0.005)
    expect(COST_ANOMALY_SPIKE_MULT).toBe(3)
    expect(CACHE_HIT_LOW).toBe(0.5)
  })
})
