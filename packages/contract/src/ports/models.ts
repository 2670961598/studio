/**
 * 模型端口 —— 三档+角色映射+价目表协议（docs/25-§3.3，依据 17-§4 models.yaml）
 * 换模型=改配置一行；价目表改动走批示。
 */
import type { Money, TokenCounts } from './kernel.js'

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
