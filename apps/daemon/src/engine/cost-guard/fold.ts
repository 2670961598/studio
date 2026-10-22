/**
 * cost-guard/fold —— 成本警戒 daemon 折算件（132-§6.4 单C·studio-dev-177）
 *
 * 三个纯 IO 缝件（判定纯体在 core/costguard.ts，本文件只做台账读面接线）：
 *
 * 1. makeBasisResolver：模型键→「单价+基准」解析器——快照优先（price_snapshots
 *    ≤D 最近行，132-§6.2 解析规则）→ models.yaml 三档兜底（静态缺省价）→
 *    unpriced（按 0 计+如实标记，DEV-19 不猜价）。收割即时折算（R4）与
 *    cost-threshold 源评估值折算共用同一入口——两处口径恒一致的结构性保证。
 * 2. personDaySpentUsd：人日已结实际——budgets 人档 scope 当日（本地日）
 *    settle 行 actual_usd 合计（「今日已落账」分量；在途 reserve 分量归
 *    foldBudgets 视图，两者相加=running_usd，F4 双口径）。
 * 3. personDayGateInput：reserve 闸四（R6 hard 线联动）入参组装——capUsd=
 *    人日预算（cost_caps.daily_usd 覆盖 ?? per_person_default）× route='gate'
 *    档 at_pct%。段未声明/无 gate 档=undefined（闸四缺席，行为零变化）。
 */
import type { CostGuardConfig, ModelTier, PersonRef, TokenCounts } from '@studio-next/contract'
import {
  bridgePriceFor,
  foldBudgets,
  budgetView,
  foldCostUsd,
  localDateKey,
  parseModelKey,
  type UnitPrice,
} from '@studio-next/core'
import type { Ledger } from '@studio-next/store'

/** 取价基准（R4 留痕位——GATE_PASS note `;cost=basis=…`） */
export type PriceBasis = 'snapshot' | 'models-yaml' | 'unpriced'

/** 解析结果：unit=undefined 即 unpriced（按 0 计，不猜价） */
export interface ResolvedUnit {
  unit?: UnitPrice | undefined
  basis: PriceBasis
  /** basis='snapshot' 时：命中快照行 id（price_snapshot_ref 事实包锚） */
  snapshotId?: string | undefined
  /** basis='snapshot' 时：快照价日（沿用=早于 D） */
  priceDate?: string | undefined
  /** basis='snapshot' 时：沿用天数（exact=0；stale_flag 事实包源） */
  staleDays?: number | undefined
}

/**
 * 模型键→单价解析器（收割折算/源评估共用）。快照行集一次拉取（≤D 全行，
 * resolve 内部择最近），解析零再读——单拍批量折算的读面成本恒定一次查询。
 */
export function makeBasisResolver(
  ledger: Ledger,
  company: string,
  date: string,
  declared?: readonly ModelTier[],
): (model: string) => ResolvedUnit {
  const rows = ledger.listPriceSnapshots({ company, on_or_before: date })
  return (model: string): ResolvedUnit => {
    const key = parseModelKey(model)
    if (key === undefined) return { basis: 'unpriced' }
    const bridged = bridgePriceFor(rows, declared ?? [], { ...key, date })
    if (bridged === undefined) return { basis: 'unpriced' }
    if (bridged.source === 'models-yaml') return { unit: bridged.unit, basis: 'models-yaml' }
    return {
      unit: bridged.unit,
      basis: 'snapshot',
      snapshotId: bridged.snapshotId,
      priceDate: bridged.priceDate,
      staleDays: bridged.staleDays,
    }
  }
}

/** tokens 四桶折算（core foldCostUsd 同式）+ 基准留痕——收割即时折算（R4）用 */
export function foldTokensWithBasis(
  tokens: TokenCounts,
  model: string,
  resolve: (model: string) => ResolvedUnit,
): { usd: number; basis: PriceBasis; snapshotId?: string | undefined; staleDays?: number | undefined; unpricedBuckets: string[] } {
  const r = resolve(model)
  if (r.unit === undefined) return { usd: 0, basis: 'unpriced', unpricedBuckets: [] }
  const folded = foldCostUsd(tokens, r.unit)
  return {
    usd: folded.usd,
    basis: r.basis,
    ...(r.snapshotId !== undefined ? { snapshotId: r.snapshotId } : {}),
    ...(r.staleDays !== undefined ? { staleDays: r.staleDays } : {}),
    unpricedBuckets: folded.unpricedBuckets,
  }
}

/** 人日已结实际（USD）：该人 settle 行 actual_usd 按本地日归属当日合计（R6 判定面） */
export function personDaySpentUsd(ledger: Ledger, personId: string, date: string): number {
  let spent = 0
  for (const row of ledger.queryBudgets({ scope_kind: 'person', scope_id: personId })) {
    if (row.kind !== 'settle' || row.actual_usd === undefined) continue
    if (localDateKey(row.ts) === date) spent += row.actual_usd
  }
  return spent
}

/** 人日预算（USD）：人档覆盖帽 ?? 段缺省帽（132-§6.4 per_person_default） */
export function personDailyBudgetUsd(guard: CostGuardConfig, person: PersonRef): number {
  return person.costCaps?.dailyUsd ?? guard.dailyBudgetUsd.perPersonDefault
}

/**
 * reserve 闸四入参（R6 hard 线联动）：今日已结实际 + 在途净预留 + 估算 ≤ capUsd。
 * capUsd=人日预算 × route='gate' 档 at_pct%（hard 线样例 8×120%=$9.6）。
 * 段未声明/无 gate 档 → undefined（闸四缺席——面关零行为）。
 */
export function personDayGateInput(
  guard: CostGuardConfig | undefined,
  person: PersonRef,
  ledger: Ledger,
  at: number,
): { spentUsd: number; capUsd: number } | undefined {
  if (guard === undefined) return undefined
  const gateTier = guard.alertTiers.find((t) => t.route === 'gate')
  if (gateTier === undefined) return undefined
  const budgetUsd = personDailyBudgetUsd(guard, person)
  return {
    spentUsd: personDaySpentUsd(ledger, person.id, localDateKey(at)),
    capUsd: (budgetUsd * gateTier.atPct) / 100,
  }
}

/** 人档在途净预留（USD）——源评估值的 forecast 分量（跨票合计） */
export function personReservedUsd(ledger: Ledger, personId: string): number {
  return budgetView(foldBudgets(ledger.queryBudgets({ scope_kind: 'person', scope_id: personId })), 'person', personId).reserved
}
