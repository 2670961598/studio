/**
 * 模型端口 —— 三档+角色映射+价目表协议（docs/25-§3.3，依据 17-§4 models.yaml）
 * 换模型=改配置一行；价目表改动走批示。
 */
import type { Money, TokenCounts } from './kernel.ts'

export interface PriceEntry {
  /** 每百万 token 美元 */
  inputPerM: number
  outputPerM: number
}

export interface ModelTier {
  tier: 'high' | 'mid' | 'low'
  provider: string
  model: string
  price: PriceEntry
}

/** 岗位名：v0 已知岗 + 公司可扩展（模板与建议不写死） */
export type RoleName = 'main_worker' | 'verifier' | 'summarizer' | 'precheck' | (string & {})

export interface ModelCatalog {
  tiers(): ModelTier[]
  resolve(role: RoleName): ModelTier
  estimateCost(tokens: TokenCounts, tier: ModelTier['tier']): Money
}

// —— 计费轨词表（132-§6.1 单A·制作人 2026-10-22 补充令，studio-dev-168）——

/**
 * 计费轨冻结词表三件套（沿 schemas/errors.ts EXECUTOR_ERROR_CODES 先例——kernel 守
 * 零运行时纪律，词表落端口文件）：
 *   - `api`：按量 API 轨——价格由 price_snapshots 折算（132-§6.2，单B）；
 *   - `coding_plan`：包月 coding plan 订阅轨——边际成本 $0，影子价轨仍按 §6 快照价
 *     折算供跨模型可比（DEV-19 影子价法），实付摊销归机构层另立单（132-§7-7 缓）。
 * 预设结构依据：制作人 2026-10-22 补充令「包月 coding plan 双轨口径的预设结构按 §6
 * 一并入契约刀」（令文经任务书下达，正本未落 docs——如实记录）；生产实证=profile
 * `agent-default-model` 已切 GLM bigmodel coding plan（订阅制）＋ Kimi
 * api.kimi.com/coding 先例（docs/31-§7 脚注）。
 * 词表只增不改（加值走批示）；消费方=单B 定价面/单C 日账警戒/单D 定型对账——本刀
 * 只立词表不接消费（轨的归属声明——哪个 provider/model 走哪轨——归单B 定价面批示
 * 定稿，本刀不发明 per-model 声明结构）。
 */
export const BILLING_TRACKS = ['api', 'coding_plan'] as const

/** 冻结词表成员类型（消费方落库/落账字段保持 string：靠词表判定把关，同 errorCode 先例） */
export type BillingTrack = (typeof BILLING_TRACKS)[number]

/** 计费轨词表判定：越界=实现缺陷，消费方校验据此拒收 */
export function isBillingTrack(v: string): v is BillingTrack {
  return (BILLING_TRACKS as readonly string[]).includes(v)
}
