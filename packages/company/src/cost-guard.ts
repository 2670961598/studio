/**
 * cost-guard —— org-config cost_guard 段（132-§6.4 单C·studio-dev-177；批示 P1/P2
 * 载体=132 提案，制作人 2026-10-22 全批——章程第四条「预算类需人批」已过批）。
 *
 * 段不声明=面关=现状零变化（daemon 侧不装 cost-threshold 源、reserve 不带人日
 * 闸——可选项缺席零行为差）。本模块三件：
 *   - CostGuardSectionSchema：结构闸（strictObject 未知键拒——org-config 同纪律）；
 *   - costGuardRules：内容规则 CG-1..CG-3（tier 唯一 / at_pct 唯一 / route='gate'
 *     至多一档——hard 联动锚唯一性，逐条指认到文件:行）；
 *   - toCostGuard：快照装载（snake→camel；装载体零二审——形态前置拦下）。
 *
 * BC-S2 先拆再增：validator.ts 已近尺寸阈（20-§十五.三），本段随拆分件落独立文件
 * （state-hygiene.ts 同款先例），validator.ts 仅摊 import/optional 段/装载一行。
 */
import type { LineCounter } from 'yaml'
import { parseDocument } from 'yaml'
import { COST_GUARD_ROUTES, type CostGuardConfig, type DirectoryIssue } from '@studio-next/contract'
import { z } from 'zod'
import { lineOfPath } from './multifile.ts'

const ORG_CONFIG_FILE = 'org-config.yaml'

/**
 * 警戒档（132-§6.4 定稿表直译）：tier=档名（缺省四档 watch/warn/alarm/hard 见 132
 * §6.4 样例——本层开放字符串，缺省值归公司 org-config 自声明）；at_pct=占预算比
 * （%·正有限；hard 线样例 120=预算外 20% 容量，故不封顶 100）；route=路由（四值
 * 冻结词表 COST_GUARD_ROUTES：notify/dispatch/dispatch+notify/gate——alarm 档
 * 「物化处置单+notify」即 dispatch+notify 直译）。
 */
const CostGuardTierSchema = z.strictObject({
  tier: z.string().min(1),
  at_pct: z.number().positive(),
  route: z.enum(COST_GUARD_ROUTES),
})

/** cost_guard 段结构闸（daily_budget_usd 两帽必填正数；alert_tiers 至少一档） */
export const CostGuardSectionSchema = z.strictObject({
  daily_budget_usd: z.strictObject({
    /** 公司日预算（USD；标定依据 132-§6.6） */
    company: z.number().positive(),
    /** 人日缺省帽（USD；可按人覆盖 people[].cost_caps） */
    per_person_default: z.number().positive(),
  }),
  alert_tiers: z.array(CostGuardTierSchema).min(1),
})

/** org-config cost_guard 段解析后的强类型（validator OrgConfig 组入） */
export type CostGuardSection = z.infer<typeof CostGuardSectionSchema>

/** 人档覆盖帽（people[].cost_caps——daily_usd 覆盖 per_person_default） */
export const PersonCostCapsSchema = z.strictObject({
  daily_usd: z.number().positive(),
})

/**
 * 内容规则 CG-1..CG-3（validator.ts issues 面拼装；段缺省=零规则）：
 *   - CG-1 tier 唯一（dedupKey `cost:<scope>:<period>:<tier>` 含 tier 段——重复档名
 *     即 dedup 键碰撞，升档必醒语义被破坏）
 *   - CG-2 at_pct 唯一（同阈值两档=判定序歧义；「按档序取最高达标档」要求档阈值
 *     可严格排序）
 *   - CG-3 route='gate' 至多一档（hard 联动锚唯一——人档 refusal 只挂一条硬线）
 */
export function costGuardRules(
  doc: ReturnType<typeof parseDocument>,
  lc: LineCounter,
  section: CostGuardSection | undefined,
): DirectoryIssue[] {
  if (section === undefined) return []
  const out: DirectoryIssue[] = []
  const push = (path: (string | number)[], rule: string, fix: string): void => {
    out.push({ file: ORG_CONFIG_FILE, line: lineOfPath(doc, lc, ['cost_guard', ...path]), rule: `org-config/${rule}`, fix })
  }

  // CG-1：tier 唯一
  const tiers = section.alert_tiers.map((t) => t.tier)
  const dupTiers = [...new Set(tiers)].filter((name) => tiers.filter((v) => v === name).length > 1)
  for (const name of dupTiers) {
    const i = tiers.indexOf(name)
    push(['alert_tiers', i, 'tier'], 'cost-guard-dup-tier', `alert_tiers 有重复档名 ${name}（dedupKey 含 tier 段，重复即升档唤醒语义被破坏——132-§6.4）`)
  }

  // CG-2：at_pct 唯一（阈值可严格排序）
  const pcts = section.alert_tiers.map((t) => t.at_pct)
  const dupPcts = [...new Set(pcts)].filter((v) => pcts.filter((p) => p === v).length > 1)
  for (const v of dupPcts) {
    const i = pcts.indexOf(v)
    push(['alert_tiers', i, 'at_pct'], 'cost-guard-dup-pct', `alert_tiers 有重复阈值 at_pct=${v}（同阈值两档=「按档序取最高达标档」判定序歧义）`)
  }

  // CG-3：route='gate' 至多一档
  const gateIdx = section.alert_tiers.map((t, i) => (t.route === 'gate' ? i : -1)).filter((i) => i >= 0)
  if (gateIdx.length > 1) {
    push(['alert_tiers', gateIdx[1] ?? -1, 'route'], 'cost-guard-multi-gate', `route='gate' 档至多一条（实有 ${gateIdx.length} 条：${gateIdx.map((i) => section.alert_tiers[i]?.tier).join('、')}）——hard 联动人档 refusal 只挂一条硬线（R6）`)
  }
  return out
}

/** 快照装载（snake→camel；形态已由 schema+CG 规则前置拦下，此处只装载不二审） */
export function toCostGuard(section: CostGuardSection): CostGuardConfig {
  return {
    dailyBudgetUsd: {
      company: section.daily_budget_usd.company,
      perPersonDefault: section.daily_budget_usd.per_person_default,
    },
    alertTiers: section.alert_tiers.map((t) => ({ tier: t.tier, atPct: t.at_pct, route: t.route })),
  }
}
