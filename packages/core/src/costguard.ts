/**
 * costguard —— 成本警戒纯逻辑（132-§6.4 单C·studio-dev-177；批示 P1/P2 载体=132 提案）
 *
 * 三块纯体（零 IO，消费面在 daemon engine/cost-guard/）：
 *
 * 1. localDateKey：本地日串 'YYYY-MM-DD'——period 口径（132-§6.4「day:<YYYY-MM-DD>
 *    （本地时区）」）与 usage_daily 落账日归属（R1：落账日=ended_at 本地日）共用的
 *    日键单一实现（engine/pricing localDateString 同口径，两处并存历史先例；
 *    本面为成本域单一源）。
 *
 * 2. highestReachedTier：档位判定（每 tick 评估，按档序取最高达标档）——判定式
 *    `running_usd ≥ budget_usd × at_pct`（132-§6.4 定稿直译）。升档=新 tier=新
 *    dedupKey（升档必醒，降档不重复醒）由 dedupKey 含 tier 段机械保证，本函数
 *    只管「此刻最高达标档是哪档」。
 *
 * 3. foldUsageDaily / usageCellsCostUsd：usage_daily 投影的两个纯侧——
 *    全量重建折叠（work_records → 人×模型×日格，不分 status R3）与格价折算
 *    （格 × 单价 → USD，running_usd 的「今日已落账」分量）。在途 reserve 分量
 *    （F4 actual+forecast 双口径）由调用方从 budgets 台账另加——core 不碰存储。
 */
import type { CostGuardTier } from '@studio-next/contract'
import type { UnitPrice } from './pricing.ts'

// ---------------------------------------------------------------------------
// 日键（本地时区日历日——预算/警戒的业务日；UTC 日会导致 08:00 前的收割记入昨日）
// ---------------------------------------------------------------------------

/** 本地日串 'YYYY-MM-DD'（132-§6.4 period 与 R1 落账日归属共用口径） */
export function localDateKey(ms: number): string {
  const d = new Date(ms)
  const pad = (v: number): string => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ---------------------------------------------------------------------------
// 档位判定（132-§6.4 定稿表）
// ---------------------------------------------------------------------------

/** 档位评估结果（pct=评估值占预算百分比，未取整如实透出） */
export interface CostGuardEval {
  tier: CostGuardTier
  /** running_usd ÷ budget_usd × 100（budget=0 且 running>0 → Infinity 超支语义） */
  pct: number
}

/**
 * 最高达标档：按 at_pct 升序找最后一个 `running_usd ≥ budget_usd × at_pct/100`
 * 的档（预算=0 且有消耗=全档达标；零消耗=零档达标）。tiers 原序不假设有序——
 * 本函数自排序（配置面档序不冻结，判定序=at_pct 升序）。
 */
export function highestReachedTier(
  tiers: readonly CostGuardTier[],
  runningUsd: number,
  budgetUsd: number,
): CostGuardEval | undefined {
  let reached: CostGuardEval | undefined
  for (const tier of [...tiers].sort((a, b) => a.atPct - b.atPct)) {
    const pct = budgetUsd > 0 ? (runningUsd / budgetUsd) * 100 : runningUsd > 0 ? Infinity : 0
    if (runningUsd >= (budgetUsd * tier.atPct) / 100 && runningUsd > 0) {
      reached = { tier, pct }
    }
  }
  return reached
}

// ---------------------------------------------------------------------------
// usage_daily 投影纯侧（132-§6.1 单C）
// ---------------------------------------------------------------------------

/** 人×模型×日格（store usage_daily 的纯形；列名=DDL 直译，snake 同 WorkRecord 惯例） */
export interface UsageDailyCell {
  company: string
  person_id: string
  model: string
  usage_date: string
  tokens_in: number
  tokens_out: number
  cache_read: number
  cache_creation: number
  /** 归并的 work_record 数（含 failed/interrupted——R3 全量不分 status） */
  runs_count: number
  /** 格内最早单 started_at（缺省=折叠首见行的 started_at） */
  first_ts?: number
  /** 格内最晚单 ended_at */
  last_ts?: number
}

/**
 * work_record 最小投影形（结构字段名=store work_records 列——core 零 store 依赖，
 * store/daemon 以结构兼容传入）。缺 ended_at（running 单）/缺 tokens /缺 model
 * （132-A 之前的存量行，模型不可归属）的行**跳过不计**——落账日与归属格不可知
 * 的行进投影即造假；跳过数由调用方如需观测自行比对（申报偏差见单C plan.md §3）。
 */
export interface UsageRecordLike {
  person_id: string
  model?: string | undefined
  started_at: number
  ended_at?: number | undefined
  tokens?:
    | {
        input: number
        output: number
        cache_read?: number | undefined
        cache_creation?: number | undefined
      }
    | undefined
}

/**
 * 全量重建折叠：work_records → 人×模型×日格（投影纪律 C8：SQLite=可重建投影，
 * 本函数即「随时从 work_records 重算」的纯体）。落账日=ended_at 本地日（R1）；
 * 同格四桶累加、runs_count 计数、first_ts=min(started_at)/last_ts=max(ended_at)。
 */
export function foldUsageDaily(records: readonly UsageRecordLike[], company: string): UsageDailyCell[] {
  const cells = new Map<string, UsageDailyCell>()
  for (const r of records) {
    if (r.ended_at === undefined || r.model === undefined || r.tokens === undefined) continue
    const date = localDateKey(r.ended_at)
    const key = `${r.person_id}\u0000${r.model}\u0000${date}`
    const prev = cells.get(key)
    if (prev === undefined) {
      cells.set(key, {
        company,
        person_id: r.person_id,
        model: r.model,
        usage_date: date,
        tokens_in: r.tokens.input,
        tokens_out: r.tokens.output,
        cache_read: r.tokens.cache_read ?? 0,
        cache_creation: r.tokens.cache_creation ?? 0,
        runs_count: 1,
        first_ts: r.started_at,
        last_ts: r.ended_at,
      })
      continue
    }
    prev.tokens_in += r.tokens.input
    prev.tokens_out += r.tokens.output
    prev.cache_read += r.tokens.cache_read ?? 0
    prev.cache_creation += r.tokens.cache_creation ?? 0
    prev.runs_count += 1
    if (r.started_at < (prev.first_ts ?? r.started_at)) prev.first_ts = r.started_at
    if (r.ended_at > (prev.last_ts ?? r.ended_at)) prev.last_ts = r.ended_at
  }
  return [...cells.values()]
}

/** 格价折算结果（unpriced=单价缺失的模型清单——按 0 计并如实上报，不猜价） */
export interface UsageCellsCost {
  usd: number
  unpricedModels: string[]
}

/**
 * 格价折算：逐格 foldCostUsd（core/pricing 同式：四桶×单价/1e6，NULL 价桶按 0 计）。
 * unitOf 是「模型键→单价」的解析器（快照优先→models.yaml 兜底的桥由调用方注入——
 * 本函数不碰快照/models.yaml，纯算术）。单价缺失模型按 0 折并进 unpricedModels
 * （低估标记面，DEV-19 法则三：不静默、不猜价）。
 */
export function usageCellsCostUsd(
  cells: readonly UsageDailyCell[],
  unitOf: (model: string) => UnitPrice | undefined,
): UsageCellsCost {
  let usd = 0
  const unpriced = new Set<string>()
  for (const c of cells) {
    const unit = unitOf(c.model)
    if (unit === undefined) {
      unpriced.add(c.model)
      continue
    }
    usd +=
      (c.tokens_in / 1e6) * unit.inputPerM +
      (c.tokens_out / 1e6) * unit.outputPerM +
      (c.cache_read / 1e6) * (unit.cacheReadPerM ?? 0) +
      (c.cache_creation / 1e6) * (unit.cacheCreationPerM ?? 0)
  }
  return { usd, unpricedModels: [...unpriced] }
}
