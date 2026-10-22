/**
 * cost-guard/usage —— usage_daily 投影的 daemon 写面（132-§6.1 单C·studio-dev-177）
 *
 * 两个写缝（store usage face 的唯一生产调用方——写口收口纪律）：
 *
 * 1. writeThroughUsageDaily（收割相位尾缝·write-through）：一次收割=一格一增量
 *    upsert（落账日=ended_at 本地日 R1）。model/tokens/ended_at 任一缺席=跳过
 *    返回 false（132-A 冻结口径下 fail 路径不带 tokens——如实不投影，不造假账）；
 *    零 tokens 也写（runs_count 照计——跑过即占用档位容量，R3 全量口径）。
 * 2. rebuildUsageDailyProjection（重建面）：work_records 全量 → core.foldUsageDaily
 *    纯折叠 → replaceUsageDaily 原子整组替换（C8 投影纪律：随时可重算；非第二
 *    事实源）。函数面（CLI 壳归后续运维刀——申报偏差见单C plan）。
 */
import { foldUsageDaily, localDateKey } from '@studio-next/core'
import type { Ledger } from '@studio-next/store'
import type { TokenCounts } from '@studio-next/contract'

/** write-through 入参（收割行面的最小投影） */
export interface UsageWriteThrough {
  personId: string
  /** 归一形 'provider/model'（ResultStats.model；undefined=旧执行/未声明——跳过） */
  model?: string | undefined
  tokens?: TokenCounts | undefined
  started_at: number
  /** ended_at=undefined（running/未落账）——跳过（落账日不可知不投影） */
  ended_at?: number | undefined
}

/** 并格成功=true；跳过（缺 model/tokens/ended_at）=false */
export function writeThroughUsageDaily(
  ledger: Ledger,
  company: string,
  rec: UsageWriteThrough,
  makeId: (ts: number) => string,
  at: number,
): boolean {
  if (rec.model === undefined || rec.tokens === undefined || rec.ended_at === undefined) return false
  ledger.upsertUsageDaily({
    id: makeId(at),
    company,
    person_id: rec.personId,
    model: rec.model,
    usage_date: localDateKey(rec.ended_at),
    tokens: {
      input: rec.tokens.input,
      output: rec.tokens.output,
      cache_read: rec.tokens.cache_read ?? 0,
      cache_creation: rec.tokens.cache_creation ?? 0,
    },
    first_ts: rec.started_at,
    last_ts: rec.ended_at,
    updated_at: at,
  })
  return true
}

/** 重建报告 */
export interface UsageRebuildReport {
  /** work_records 全量行数（含不可归属跳过行） */
  scanned: number
  /** 折叠产出的投影格数（=替换后该公司行数） */
  cells: number
}

/** 全量重建（C8）：work_records → 人×模型×日格 → 原子替换该公司投影 */
export function rebuildUsageDailyProjection(
  ledger: Ledger,
  company: string,
  makeId: (ts: number) => string,
  at: number,
): UsageRebuildReport {
  const records = ledger.listWorkRecords()
  const cells = foldUsageDaily(records, company)
  const replaced = ledger.replaceUsageDaily(
    company,
    cells.map((c) => ({ ...c, id: makeId(at), updated_at: at })),
  )
  return { scanned: records.length, cells: replaced.rows }
}
