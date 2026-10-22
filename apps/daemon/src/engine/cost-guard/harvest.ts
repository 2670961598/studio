/**
 * cost-guard/harvest —— 收割相位的成本警戒缝件（132-§6.4 单C·studio-dev-177）
 *
 * 两个缝（engine.ts finalizeHarvest 只留调用行——缝体收口本文件）：
 *
 * 1. foldHarvestCost（R4 即时折算）：native>0 直用（executor 自报为尊）；否则
 *    tokens×当日取价折算 provisional（快照优先→models.yaml 兜底→unpriced 按 0
 *    计+如实留痕——DEV-19 不猜价）。endWorkRecord.cost_usd / settle actual /
 *    GATE_PASS cost_usd 三面共用同一返回值——账面恒一致的结构性保证。
 * 2. writeThroughHarvestUsage（R1 相位尾缝 write-through）：done 路径一格增量
 *    upsert（落账日=ended_at 本地日）；model 缺席=跳过（132-A 冻结口径）；
 *    失败不回滚收割（errors 如实上报——四要件语义不动，17-§6）。
 */
import type { ModelTier, ResultStats, TokenCounts } from '@studio-next/contract'
import { localDateKey } from '@studio-next/core'
import type { Ledger } from '@studio-next/store'
import { foldTokensWithBasis, makeBasisResolver } from './fold.ts'
import { writeThroughUsageDaily } from './usage.ts'

/** 收割成本结论：三面共值 + note 留痕（`;cost=basis=…`） */
export interface HarvestCost {
  usd: number
  noteSuffix: string
}

export function foldHarvestCost(
  ledger: Ledger,
  company: string,
  stats: ResultStats,
  declared: readonly ModelTier[] | undefined,
  at: number,
): HarvestCost {
  if (stats.cost.usd > 0) return { usd: stats.cost.usd, noteSuffix: ';cost=basis=native' }
  if (stats.model === undefined) return { usd: 0, noteSuffix: ';cost=basis=unpriced（无模型声明，无从折算）' }
  const folded = foldTokensWithBasis(
    stats.tokens,
    stats.model,
    makeBasisResolver(ledger, company, localDateKey(at), declared),
  )
  if (folded.basis === 'unpriced') {
    return { usd: 0, noteSuffix: `;cost=basis=unpriced（model=${stats.model} 无当日价）` }
  }
  const snapNote =
    folded.basis === 'snapshot' && folded.snapshotId !== undefined ? `;cost-snap=${folded.snapshotId}` : ''
  const bucketNote =
    folded.unpricedBuckets.length > 0 ? `;cost-unpriced=${folded.unpricedBuckets.join('+')}` : ''
  return { usd: folded.usd, noteSuffix: `;cost=basis=${folded.basis}${snapNote}${bucketNote}` }
}

/** write-through 缝入参（finalizeHarvest 行面） */
export interface HarvestUsageWrite {
  ledger: Ledger
  company: string
  personId: string
  workRecordId: string
  /** ResultStats.model（undefined=跳过——132-A fail 面零 tokens 的镜像：无模型不投影） */
  model?: string | undefined
  tokens?: TokenCounts | undefined
  endedAt: number
  makeId: (ts: number) => string
  onError: (message: string) => void
}

/** 返回 GATE_PASS note 后缀（ok/skip/失败三态——失败不回滚收割，errors 上报） */
export function writeThroughHarvestUsage(d: HarvestUsageWrite): string {
  try {
    const started = d.ledger.getWorkRecord(d.workRecordId)?.started_at ?? d.endedAt
    const wrote = writeThroughUsageDaily(
      d.ledger,
      d.company,
      { personId: d.personId, model: d.model, tokens: d.tokens, started_at: started, ended_at: d.endedAt },
      d.makeId,
      d.endedAt,
    )
    return wrote ? ';usage=daily ok' : ';usage=daily skip（无 model——132-A 冻结口径不投影）'
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    d.onError(`usage_daily 落账异常：${msg}`)
    return `;usage=daily 失败（${msg}）`
  }
}
