/**
 * costclose —— 定型面日终收口纯逻辑（132-§6.3 单D·studio-dev-179）
 *
 * 职责边界（零 IO——LLM 不做算术，R3/DEV-19：折算/对账/洞察全部机械可复算）：
 *   - planCostCells：usage_daily(X) × 价（快照 exact/carry→桥→无价 三路降级）→ final 行计划；
 *   - planAdjustments：已冻行 vs 现在应有真值 → signed delta 补账计划（S3 迟到事实）；
 *   - reconcileDate：Σcost_daily(X) vs ΣGATE_PASS(X) 对账段（132-§6.4 R4）；
 *   - mergeTinyAdjustments：|usd|<$0.01 补账行合并展示（批示 P7——展示层合并，
 *     合计仍全量计入，不改账）；
 *   - costInsights：财务岗分析面四规则——独立文件 cost-insights.ts（BC-S2 拆分，
 *     阈值拟稿常量同处申报）。
 *
 * 定价三路降级语义（与 132-C 收割折算 basis 解析同款，单一真值口径）：
 *   snapshot（exact 或 carry 沿用，含 stale）→ 定价锚=快照行 id；
 *   models-yaml 桥（无快照而 models.yaml 声明在册）→ 锚='models-yaml:<model>'
 *     （interlock 降级为声明面版本，不静默——收口事件注 degraded）；
 *   unpriced（任何 ≤X 价皆无）→ usd=0 下界口径收口，锚='unpriced'（不编造价格，
 *     DEV-19；收口事件注 unpriced——不静默）。
 *
 * 时间语义（R1 落账日）：cost_date='YYYY-MM-DD' 本地日；收口时刻锚 19:55 本地
 * （132-§6.0 时间线：19:55 收 D-1，20:00 hf-finance-daily 读 cost_daily+对账段）。
 */
import type { TokenCounts } from '@studio-next/contract'
import { bridgePriceFor, foldCostUsd, parseModelKey, type PriceSnapshotLike } from './pricing.ts'
import type { ModelTier } from '@studio-next/contract'
import type { CostInsight } from './cost-insights.ts'

// ---------------------------------------------------------------------------
// 常量（工序锚与阈值——拟稿除注明外均本刀申报，见 studio-dev-179 plan.md）
// ---------------------------------------------------------------------------

/** 收口时刻（本地时区；132-§6.0 时间线冻结：19:55 收 D-1） */
export const COST_CLOSE_HOUR = 19
export const COST_CLOSE_MINUTE = 55
/** kv 幂等锚键（R3 冻结键名——tick 重入/崩溃重放不双收） */
export const COST_CLOSE_KV_KEY = 'cost_close_last_date'
/** P7 展示合并阈（USD）：|usd| 小于此值的 adjustment 行合并为一行展示（合计仍全量） */
export const ADJUSTMENT_MERGE_USD = 0.01
/** 对账差超过此值=注因段展开（IEEE-754 直算的自然容差；≤此值视为平） */
export const RECON_EPS_USD = 0.005
/** 补账判定容差：|Δusd| 低于此值且四桶 Δ 全 0=视为一致不补（浮点尾差不产噪声行） */
export const ADJUST_EPS_USD = 1e-9

// ---------------------------------------------------------------------------
// final 行计划（usage × 价 → 应有真值）
// ---------------------------------------------------------------------------

/** usage_daily 行的最小投影面（store UsageDailyRecord 结构兼容） */
export interface UsageCellLike {
  person_id: string
  model: string
  tokens_in: number
  tokens_out: number
  cache_read: number
  cache_creation: number
}

/** 定价锚三路（见头注降级语义） */
export type CostPriceBasis = 'snapshot' | 'models-yaml' | 'unpriced'

/** 一格（人×模型×日）的应有真值计划（收口 final 行 / 巡检比对面） */
export interface CostCellPlan {
  person_id: string
  model: string
  tokens: { tokens_in: number; tokens_out: number; cache_read: number; cache_creation: number }
  usd: number
  priceBasis: CostPriceBasis
  /** 定价锚：快照行 id / 'models-yaml:<model>' / 'unpriced' */
  priceSnapshotId: string
  /** 快照当日价=true；沿用（stale）=false；桥/无价=false */
  exact: boolean
  /** 沿用天数（快照 carry：X−price_date；其余 0） */
  staleDays: number
  /** 未定价桶（cache 缺价=低估标记；无价=全桶） */
  unpricedBuckets: readonly string[]
}

function usageTokens(u: UsageCellLike): TokenCounts {
  return { input: u.tokens_in, output: u.tokens_out, cache_read: u.cache_read, cache_creation: u.cache_creation }
}

/**
 * 折算一格：桥（快照→models.yaml→无价三路）+ foldCostUsd 同式直算。
 * 每格独立取价（人×模型粒度）；slot 统一 'peak'（§6.2 保守缺省——收口是账不
 * 是预算，峰谷拆分进后续刀）。
 */
export function planCostCell(
  usage: UsageCellLike,
  snapshots: readonly PriceSnapshotLike[],
  tiers: readonly ModelTier[],
  date: string,
): CostCellPlan {
  const key = parseModelKey(usage.model)
  const bridged =
    key !== undefined
      ? bridgePriceFor(snapshots, tiers, { provider: key.provider, model: key.model, date, slot: 'peak' })
      : undefined
  if (bridged === undefined) {
    // 无价：usd=0 下界口径（不编造价格）；桶全量标 unpriced（有量的桶才标）
    const unpricedBuckets: string[] = []
    if (usage.tokens_in > 0) unpricedBuckets.push('tokens_in')
    if (usage.tokens_out > 0) unpricedBuckets.push('tokens_out')
    if (usage.cache_read > 0) unpricedBuckets.push('cache_read')
    if (usage.cache_creation > 0) unpricedBuckets.push('cache_creation')
    return {
      person_id: usage.person_id,
      model: usage.model,
      tokens: {
        tokens_in: usage.tokens_in,
        tokens_out: usage.tokens_out,
        cache_read: usage.cache_read,
        cache_creation: usage.cache_creation,
      },
      usd: 0,
      priceBasis: 'unpriced',
      priceSnapshotId: 'unpriced',
      exact: false,
      staleDays: 0,
      unpricedBuckets,
    }
  }
  const fold = foldCostUsd(usageTokens(usage), bridged.source === 'snapshot' ? bridged.unit : bridged.unit)
  if (bridged.source === 'snapshot') {
    return {
      person_id: usage.person_id,
      model: usage.model,
      tokens: {
        tokens_in: usage.tokens_in,
        tokens_out: usage.tokens_out,
        cache_read: usage.cache_read,
        cache_creation: usage.cache_creation,
      },
      usd: fold.usd,
      priceBasis: 'snapshot',
      priceSnapshotId: bridged.snapshotId ?? 'snapshot:no-id',
      exact: bridged.exact,
      staleDays: bridged.staleDays,
      unpricedBuckets: fold.unpricedBuckets,
    }
  }
  return {
    person_id: usage.person_id,
    model: usage.model,
    tokens: {
      tokens_in: usage.tokens_in,
      tokens_out: usage.tokens_out,
      cache_read: usage.cache_read,
      cache_creation: usage.cache_creation,
    },
    usd: fold.usd,
    priceBasis: 'models-yaml',
    priceSnapshotId: `models-yaml:${usage.model}`,
    exact: false,
    staleDays: 0,
    unpricedBuckets: fold.unpricedBuckets,
  }
}

/** 整日折算：usage_daily(X) 全行 → final 行计划集（逐格独立取价） */
export function planCostCells(
  usageRows: readonly UsageCellLike[],
  snapshots: readonly PriceSnapshotLike[],
  tiers: readonly ModelTier[],
  date: string,
): CostCellPlan[] {
  return usageRows.map((u) => planCostCell(u, snapshots, tiers, date))
}

// ---------------------------------------------------------------------------
// adjustment 计划（已冻行 vs 应有真值 → signed delta；S3 迟到事实）
// ---------------------------------------------------------------------------

/** cost_daily 行的最小投影面（store CostDailyRecord 结构兼容） */
export interface CostRowLike {
  id: string
  person_id: string
  model: string
  cost_date: string
  tokens_in: number
  tokens_out: number
  cache_read: number
  cache_creation: number
  cost_usd: number
  kind: 'final' | 'adjustment'
  note?: string | undefined
}

/** 补账行计划（signed delta；挂同格 final 行） */
export interface AdjustmentPlan {
  person_id: string
  model: string
  adjustsId: string
  tokensDelta: { tokens_in: number; tokens_out: number; cache_read: number; cache_creation: number }
  usdDelta: number
  /** 用量升=迟到事实（重建回填）；用量降/归零=数据修复（重建改判） */
  reason: 'late-facts' | 'data-repair'
}

/** 巡检产物：同格补账行（已有 final）+ 迟到新格（收口时无用量、后补出的 final） */
export interface AdjustmentSweep {
  adjustments: AdjustmentPlan[]
  newCells: CostCellPlan[]
  /** 各格冻结真值（final+已冻 adjustment Σ）——报告/对账共用口径 */
  cellTruths: Array<{ person_id: string; model: string; usd: number }>
}

function cellKeyOf(personId: string, model: string): string {
  return `${personId}\u0000${model}`
}

/**
 * 巡检比对面（统一冻结语义：每行首冻、日 kv 只闸调度收口）：
 *   - 同格（有 final）：Σ(final+已冻 adjustment) vs 现在应有真值 → Δ≠0 补一行
 *     signed delta（崩溃重放同参=Δ0 无行——天然幂等）；
 *   - 迟到新格（用量在而 final 无）：补 final 行（每行首冻的自然延伸——partial
 *     UNIQUE 仍拒同格第二 final；申报见 daemon cost-close 头注）；
 *   - 用量消失格（final 在而用量无）：应有=0 → 负 delta 补账（数据修复）。
 */
export function sweepClosedDate(
  frozen: readonly CostRowLike[],
  desired: readonly CostCellPlan[],
): AdjustmentSweep {
  const frozenByCell = new Map<string, { final?: CostRowLike; rows: CostRowLike[] }>()
  for (const row of frozen) {
    const k = cellKeyOf(row.person_id, row.model)
    const entry = frozenByCell.get(k) ?? { rows: [] }
    entry.rows.push(row)
    if (row.kind === 'final') entry.final = row
    frozenByCell.set(k, entry)
  }
  const desiredByCell = new Map<string, CostCellPlan>()
  for (const cell of desired) desiredByCell.set(cellKeyOf(cell.person_id, cell.model), cell)

  const adjustments: AdjustmentPlan[] = []
  const newCells: CostCellPlan[] = []
  const cellTruths: Array<{ person_id: string; model: string; usd: number }> = []

  // ① 冻结在册格：比差补账
  for (const [k, entry] of frozenByCell) {
    const final = entry.final
    if (final === undefined) continue // 脏行防御（partial UNIQUE 下不应存在）
    const want = desiredByCell.get(k)
    const frozenUsd = entry.rows.reduce((sum, r) => sum + r.cost_usd, 0)
    cellTruths.push({ person_id: final.person_id, model: final.model, usd: frozenUsd })
    const wantUsd = want?.usd ?? 0
    const dIn = (want?.tokens.tokens_in ?? 0) - entry.rows.reduce((s, r) => s + r.tokens_in, 0)
    const dOut = (want?.tokens.tokens_out ?? 0) - entry.rows.reduce((s, r) => s + r.tokens_out, 0)
    const dRead = (want?.tokens.cache_read ?? 0) - entry.rows.reduce((s, r) => s + r.cache_read, 0)
    const dCreat = (want?.tokens.cache_creation ?? 0) - entry.rows.reduce((s, r) => s + r.cache_creation, 0)
    const dUsd = wantUsd - frozenUsd
    const tokensMoved = dIn !== 0 || dOut !== 0 || dRead !== 0 || dCreat !== 0
    if (Math.abs(dUsd) < ADJUST_EPS_USD && !tokensMoved) continue
    adjustments.push({
      person_id: final.person_id,
      model: final.model,
      adjustsId: final.id,
      tokensDelta: { tokens_in: dIn, tokens_out: dOut, cache_read: dRead, cache_creation: dCreat },
      usdDelta: dUsd,
      reason: dIn + dOut + dRead + dCreat >= 0 ? 'late-facts' : 'data-repair',
    })
  }
  // ② 迟到新格：用量在而 final 无 → 补 final（首冻）
  for (const [k, cell] of desiredByCell) {
    if (!frozenByCell.has(k)) {
      newCells.push(cell)
      cellTruths.push({ person_id: cell.person_id, model: cell.model, usd: cell.usd })
    }
  }
  return { adjustments, newCells, cellTruths }
}

// ---------------------------------------------------------------------------
// 对账段（Σcost_daily(X) vs ΣGATE_PASS.cost_usd(X)；132-§6.4 R4）
// ---------------------------------------------------------------------------

export interface ReconModelLine {
  model: string
  closedUsd: number
  harvestUsd: number
  deltaUsd: number
}

export interface ReconSegment {
  date: string
  /** 定型账合计（final+adjustment 全量） */
  closedUsd: number
  /** 收割账合计（GATE_PASS 事件 cost_usd Σ；undefined 记 0——收割面无账=如实） */
  harvestUsd: number
  deltaUsd: number
  /** |delta|>RECON_EPS_USD=true（注因段展开） */
  diverged: boolean
  perModel: ReconModelLine[]
}

/** GATE_PASS note 的模型后缀解析（132-C R4 note 形：'…model=<provider/model>'） */
export function parseModelFromNote(note: string | undefined): string {
  if (note === undefined) return '(unattributed)'
  const m = /model=([^;\s]+)/.exec(note)
  return m?.[1] ?? '(unattributed)'
}

/**
 * 单日对账：两边各自 Σ+按模型分拆。差异成因注记（不自动调账——两账口径本就
 * 异源：收口时刻 vs 收割时刻的快照版本/沿用天窗；|Δ|≤eps 视为平）。
 */
export function reconcileDate(
  date: string,
  costRows: readonly CostRowLike[],
  gatePass: ReadonlyArray<{ usd?: number | undefined; note?: string | undefined }>,
): ReconSegment {
  const closedUsd = costRows.reduce((sum, r) => sum + r.cost_usd, 0)
  const harvestUsd = gatePass.reduce((sum, e) => sum + (e.usd ?? 0), 0)
  const byModel = new Map<string, { closed: number; harvest: number }>()
  for (const r of costRows) {
    const e = byModel.get(r.model) ?? { closed: 0, harvest: 0 }
    e.closed += r.cost_usd
    byModel.set(r.model, e)
  }
  for (const e of gatePass) {
    const model = parseModelFromNote(e.note)
    const entry = byModel.get(model) ?? { closed: 0, harvest: 0 }
    entry.harvest += e.usd ?? 0
    byModel.set(model, entry)
  }
  const deltaUsd = closedUsd - harvestUsd
  const perModel = [...byModel.entries()]
    .map(([model, v]) => ({ model, closedUsd: v.closed, harvestUsd: v.harvest, deltaUsd: v.closed - v.harvest }))
    .sort((a, b) => (a.model < b.model ? -1 : a.model > b.model ? 1 : 0))
  return { date, closedUsd, harvestUsd, deltaUsd, diverged: Math.abs(deltaUsd) > RECON_EPS_USD, perModel }
}

// ---------------------------------------------------------------------------
// P7：补账行合并展示（|usd|<$0.01——展示层合并，合计仍全量计入）
// ---------------------------------------------------------------------------

export interface AdjustmentDisplayLine {
  person_id?: string
  model?: string
  usd: number
  note?: string
  /** merged=true：P7 合并行（count=被并行数；person/model 留空） */
  merged?: boolean
  count?: number
}

export interface AdjustmentDisplay {
  lines: AdjustmentDisplayLine[]
  mergedCount: number
  mergedUsd: number
  /** 全量合计（含被合并行——P7：合计不缩水） */
  totalUsd: number
}

export function mergeTinyAdjustments(
  rows: ReadonlyArray<{ person_id: string; model: string; usd: number; note?: string | undefined }>,
  thresholdUsd: number = ADJUSTMENT_MERGE_USD,
): AdjustmentDisplay {
  const big: AdjustmentDisplayLine[] = []
  let mergedCount = 0
  let mergedUsd = 0
  let totalUsd = 0
  for (const r of rows) {
    totalUsd += r.usd
    if (Math.abs(r.usd) < thresholdUsd) {
      mergedCount += 1
      mergedUsd += r.usd
    } else {
      big.push(r.note !== undefined ? { person_id: r.person_id, model: r.model, usd: r.usd, note: r.note } : { person_id: r.person_id, model: r.model, usd: r.usd })
    }
  }
  const lines = mergedCount > 0 ? [...big, { usd: mergedUsd, merged: true, count: mergedCount }] : big
  return { lines, mergedCount, mergedUsd, totalUsd }
}


// ---------------------------------------------------------------------------
// 日报装配（收口报告 JSON 体——20:00 hf-finance-daily 的读面之一）
// ---------------------------------------------------------------------------

export interface CostCloseReportBody {
  company: string
  date: string
  generated_at: number
  caliber: 'cost-close/v1'
  finals: ReadonlyArray<{
    person_id: string
    model: string
    tokens: { tokens_in: number; tokens_out: number; cache_read: number; cache_creation: number }
    usd: number
    price_snapshot_id: string
    price_basis: CostPriceBasis
    exact: boolean
    stale_days: number
    unpriced_buckets: readonly string[]
  }>
  adjustments: {
    display: AdjustmentDisplay
    rows: ReadonlyArray<{ person_id: string; model: string; usd: number; reason: string; adjusts_id: string }>
    new_cells: ReadonlyArray<{ person_id: string; model: string; usd: number; price_snapshot_id: string }>
  }
  recon?: ReconSegment | undefined
  insights: readonly CostInsight[]
  /** 注因段（机械解释非猜测：对账差成因/定价降级——daemon 供，可空） */
  notes?: readonly string[]
  anchors: { closed_by: string; kv_key: string }
}

/** 报告体装配（纯函数——文件落盘与 insertReport 归 daemon 工序） */
export function buildCostCloseReport(input: {
  company: string
  date: string
  generatedAt: number
  finals: readonly CostCellPlan[]
  adjustments: readonly AdjustmentPlan[]
  newCells: readonly CostCellPlan[]
  recon?: ReconSegment | undefined
  insights: readonly CostInsight[]
  notes?: readonly string[]
  closedBy: string
}): CostCloseReportBody {
  return {
    company: input.company,
    date: input.date,
    generated_at: input.generatedAt,
    caliber: 'cost-close/v1',
    finals: input.finals.map((f) => ({
      person_id: f.person_id,
      model: f.model,
      tokens: f.tokens,
      usd: f.usd,
      price_snapshot_id: f.priceSnapshotId,
      price_basis: f.priceBasis,
      exact: f.exact,
      stale_days: f.staleDays,
      unpriced_buckets: f.unpricedBuckets,
    })),
    adjustments: {
      display: mergeTinyAdjustments(
        input.adjustments.map((a) => ({ person_id: a.person_id, model: a.model, usd: a.usdDelta, note: a.reason })),
      ),
      rows: input.adjustments.map((a) => ({
        person_id: a.person_id,
        model: a.model,
        usd: a.usdDelta,
        reason: a.reason,
        adjusts_id: a.adjustsId,
      })),
      new_cells: input.newCells.map((c) => ({ person_id: c.person_id, model: c.model, usd: c.usd, price_snapshot_id: c.priceSnapshotId })),
    },
    recon: input.recon,
    insights: input.insights,
    ...(input.notes !== undefined && input.notes.length > 0 ? { notes: input.notes } : {}),
    anchors: { closed_by: input.closedBy, kv_key: COST_CLOSE_KV_KEY },
  }
}
