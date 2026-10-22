/**
 * cost-insights —— 财务岗分析面四规则（132-§6.3 单D·studio-dev-179；制作人
 * 2026-10-22 补充令：成本异常/档位错配/缓存优化/包月 vs API 取舍）
 *
 * 纯函数阈值规则（零 IO——LLM 不做算术 R3/DEV-19）；阈值=拟稿常量（改值走批示，
 * plan.md §申报）。消费面：costclose 报告装配（buildCostCloseReport insights 段）
 * → daemon 收口工序 → <companyDir>/reports/综合部/cost-close/*.json。
 * 文件拆分：BC-S2 600 行阈（costclose.ts 主面）。
 */
import type { CostCellPlan } from './costclose.ts'

// —— 财务分析面阈值（拟稿——财务岗可随季度调，改值走批示） ——
/** 成本异常：单格日成本下限（USD）——低于此值不告警（噪声闸） */
export const COST_ANOMALY_MIN_USD = 5
/** 成本异常：对 7 日均值的突增倍数 */
export const COST_ANOMALY_SPIKE_MULT = 3
/** 缓存优化：命中率下限（cache_read/(tokens_in+cache_read)） */
export const CACHE_HIT_LOW = 0.5
/** 缓存优化：分母下限（tokens_in+cache_read 总量）——小量不评（统计无意义） */
export const CACHE_MIN_TOKENS = 1_000_000
/** 包月 vs API：api 轨折算月流量 ≥ 包月费 × 此倍数 → 建议评估切换 */
export const PLAN_SWITCHEVER_MULT = 1.2
/** 洞察回看窗（日）——成本异常基线/包月取舍的用量窗 */
export const INSIGHT_WINDOW_DAYS = 7

// ---------------------------------------------------------------------------
// 财务岗分析面（制作人 2026-10-22 补充令四规则——纯函数，阈值拟稿）
// ---------------------------------------------------------------------------

export type CostInsightKind = 'cost-anomaly' | 'tier-mismatch' | 'cache-optimization' | 'plan-vs-api'

export interface CostInsight {
  kind: CostInsightKind
  message: string
  facts: Record<string, string | number>
}

export interface CostInsightInput {
  /** 收口日（'YYYY-MM-DD'） */
  date: string
  /** 当日折算格（planCostCells 产物） */
  cells: readonly CostCellPlan[]
  /** 回看窗内已冻行（INSIGHT_WINDOW_DAYS；daemon 从 cost_daily 取） */
  history: ReadonlyArray<{ cost_date: string; model: string; usd: number }>
  /** 声明面（models.yaml 三档；undefined=catalog 未注入态 B——规则 2 降级跳过） */
  declared?: ReadonlyArray<{ provider: string; model: string; tier: string }> | undefined
  /** 包月在册模型（快照 coding_plan 轨；同 provider/model 有包月选项即入） */
  planTrack?: ReadonlyArray<{ provider: string; model: string; planMonthlyUsd: number }> | undefined
}

/** 四规则机械评估（顺序即报告呈现序；零规则命中=空数组——如实不凑数） */
export function costInsights(input: CostInsightInput): CostInsight[] {
  const out: CostInsight[] = []
  const today = input.date

  // 每模型当日合计与 7 日均值基线
  const todayByModel = new Map<string, number>()
  for (const c of input.cells) todayByModel.set(c.model, (todayByModel.get(c.model) ?? 0) + c.usd)
  const windowByModel = new Map<string, { sum: number; days: number }>()
  for (const h of input.history) {
    const e = windowByModel.get(h.model) ?? { sum: 0, days: 0 }
    e.sum += h.usd
    e.days += 1
    windowByModel.set(h.model, e)
  }

  // —— 规则 1：成本异常（单模型日成本 ≥ 下限，且无基线=新高贵/有基线=突增倍数） ——
  for (const [model, usd] of todayByModel) {
    if (usd < COST_ANOMALY_MIN_USD) continue
    const base = windowByModel.get(model)
    if (base === undefined || base.days === 0 || base.sum === 0) {
      out.push({
        kind: 'cost-anomaly',
        message: `模型 ${model} 当日折算 $${usd.toFixed(2)}（无 ${INSIGHT_WINDOW_DAYS} 日基线——新贵用量关注）`,
        facts: { model, date: today, usd, baseline: 'none' },
      })
    } else {
      const dailyMean = base.sum / base.days
      if (usd >= dailyMean * COST_ANOMALY_SPIKE_MULT) {
        out.push({
          kind: 'cost-anomaly',
          message: `模型 ${model} 当日 $${usd.toFixed(2)} ≈ ${INSIGHT_WINDOW_DAYS} 日均值 $${dailyMean.toFixed(2)} 的 ${(usd / dailyMean).toFixed(1)} 倍（≥${COST_ANOMALY_SPIKE_MULT}× 阈）`,
          facts: { model, date: today, usd, dailyMean, mult: Number((usd / dailyMean).toFixed(2)) },
        })
      }
    }
  }

  // —— 规则 2：档位错配（用量模型不在声明面；或同供商低价档在册全闲置+高价档高耗） ——
  if (input.declared !== undefined) {
    const declaredKeys = new Set(input.declared.map((d) => `${d.provider}/${d.model}`))
    for (const model of todayByModel.keys()) {
      if (!declaredKeys.has(model)) {
        out.push({
          kind: 'tier-mismatch',
          message: `模型 ${model} 有用量但不在 models.yaml 声明面（档位/价目面缺口——快照超额模型同 P5 守夜面）`,
          facts: { model, date: today },
        })
      }
    }
    // 同供商：高价档日耗 ≥ 下限而低价档在册零用 → 档位错配候选
    const spendByTier = new Map<string, { tier: string; usd: number; model: string }>()
    for (const d of input.declared) {
      const usd = todayByModel.get(`${d.provider}/${d.model}`) ?? 0
      spendByTier.set(d.provider + '\u0000' + d.tier, { tier: d.tier, usd, model: `${d.provider}/${d.model}` })
    }
    for (const d of input.declared) {
      if (d.tier !== 'high') continue
      const high = spendByTier.get(d.provider + '\u0000' + 'high')
      if (high === undefined || high.usd < COST_ANOMALY_MIN_USD) continue
      const cheap = input.declared.find((x) => x.provider === d.provider && x.tier !== 'high')
      if (cheap === undefined) continue
      const cheapUsd = todayByModel.get(`${cheap.provider}/${cheap.model}`) ?? 0
      if (cheapUsd === 0) {
        out.push({
          kind: 'tier-mismatch',
          message: `${d.provider} 高价档 ${high.model} 日耗 $${high.usd.toFixed(2)}，同供商 ${cheap.tier} 价档 ${cheap.model} 在册零用——档位错配候选（任务路由/岗级档位评估）`,
          facts: { provider: d.provider, highModel: high.model, highUsd: high.usd, cheapModel: `${cheap.provider}/${cheap.model}`, date: today },
        })
      }
    }
  }

  // —— 规则 3：缓存优化（按模型聚合：命中率低/写多读少） ——
  const cacheByModel = new Map<string, { in: number; read: number; creation: number }>()
  for (const c of input.cells) {
    const e = cacheByModel.get(c.model) ?? { in: 0, read: 0, creation: 0 }
    e.in += c.tokens.tokens_in
    e.read += c.tokens.cache_read
    e.creation += c.tokens.cache_creation
    cacheByModel.set(c.model, e)
  }
  for (const [model, t] of cacheByModel) {
    const denom = t.in + t.read
    if (denom >= CACHE_MIN_TOKENS) {
      const hitRatio = denom > 0 ? t.read / denom : 0
      if (hitRatio < CACHE_HIT_LOW) {
        out.push({
          kind: 'cache-optimization',
          message: `模型 ${model} 缓存命中率 ${(hitRatio * 100).toFixed(1)}%（<${CACHE_HIT_LOW * 100}% 阈）——提示词/上下文复用度低，缓存策略评估`,
          facts: { model, date: today, hitRatio: Number((hitRatio * 100).toFixed(1)), tokensIn: t.in, cacheRead: t.read },
        })
      }
    }
    if (t.creation >= CACHE_MIN_TOKENS && t.creation > t.read) {
      out.push({
        kind: 'cache-optimization',
        message: `模型 ${model} 缓存写(${t.creation})多于读(${t.read})——写多读少（churn）：写入成本未回收，上下文稳定性评估`,
        facts: { model, date: today, cacheCreation: t.creation, cacheRead: t.read },
      })
    }
  }

  // —— 规则 4：包月 vs API 取舍（api 轨月化流量 ≥ 包月费×倍数 → 切换评估） ——
  if (input.planTrack !== undefined && input.planTrack.length > 0) {
    for (const plan of input.planTrack) {
      const key = `${plan.provider}/${plan.model}`
      const todayUsd = todayByModel.get(key)
      if (todayUsd === undefined) continue
      const base = windowByModel.get(key)
      const windowSum = (base?.sum ?? 0) + todayUsd
      const observedDays = (base?.days ?? 0) + 1
      const monthlyRunRate = (windowSum / observedDays) * 30
      if (monthlyRunRate >= plan.planMonthlyUsd * PLAN_SWITCHEVER_MULT) {
        out.push({
          kind: 'plan-vs-api',
          message: `${key} api 轨折算月流量 ≈ $${monthlyRunRate.toFixed(2)} ≥ 包月费 $${plan.planMonthlyUsd.toFixed(2)}×${PLAN_SWITCHEVER_MULT}——包月切换评估`,
          facts: { model: key, date: today, monthlyRunRate: Number(monthlyRunRate.toFixed(2)), planMonthlyUsd: plan.planMonthlyUsd, observedDays },
        })
      }
    }
  }
  return out
}

