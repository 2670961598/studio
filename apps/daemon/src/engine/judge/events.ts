/**
 * judge/events —— 判断调用可观测面（studio-dev-160 §6.5 P6；单 164）
 *
 * 语义（提案 §6.5：判断调用零生命周期——不进收割契约/work_records，JUDGE_* 事件族是
 * 其唯一台账锚；事件名走 contract 前缀族通道 JUDGE_OK/JUDGE_FALLBACK）：
 *   - JUDGE_OK：每次采纳裁决的调用——note=site/op/词表指纹/是否降级=no，cost_usd/
 *     duration_ms/tokens（四桶；零用量约定 {input:0}）如实在场。
 *   - JUDGE_FALLBACK：每次降级（无论是否唤起过模型）——note=site/reason（枚举值，
 *     机器可比对：熔断签名/面板分组消费）；未唤起的降级 cost=0 duration≈真实值。
 *   - 事件落账口径：issue 列挂 **site_id 哨兵**（判断调用不占派工单号空间；17-§3
 *     issue 非空列的哨兵约定同「零活动日事件」，contract schemas/events.ts 行注）；
 *     actor='daemon:micro-judge'；attempt=1（一次性无重试）；level=1（程序面等级）；
 *     dept='framework'（判断调用属框架面，不挂业务部门）。
 *
 * 依据：docs/17-§3 事件列；contract EVENT_PREFIX_FAMILIES（P6 增补 JUDGE_，本单落）；
 * docs/02-F2-04 tokens 四桶；studio-dev-160 §8-S7（观测锚）。
 */
import type { EventRecord, TokenCounts } from '@studio-next/contract'
import type { JudgeFallbackReason } from '@studio-next/core'

/** 判断事件公共列（单 164 冻结：哨兵 issue/框架 actor/attempt 1/level 1/dept framework） */
const JUDGE_EVENT_BASE = {
  actor: 'daemon:micro-judge',
  attempt: 1,
  level: 1,
  dept: 'framework',
} as const

/** 零用量约定（未唤起模型的降级事件——四桶非空校验的最小真值） */
const ZERO_TOKENS: TokenCounts = { input: 0, output: 0 }

/** JUDGE_OK 记录（采纳裁决=非降级路径专属；降级走 JUDGE_FALLBACK——两事件互斥） */
export function judgeOkEvent(input: {
  id: string
  ts: number
  company: string
  site: string
  op: string
  vocabFingerprint: string
  costUsd: number
  durationMs: number
  tokens: TokenCounts
}): EventRecord {
  return {
    id: input.id,
    ts: input.ts,
    company: input.company,
    issue: input.site,
    event: 'JUDGE_OK',
    ...JUDGE_EVENT_BASE,
    tokens: input.tokens,
    cost_usd: input.costUsd,
    duration_ms: input.durationMs,
    note: `site=${input.site} op=${input.op} vocab=${input.vocabFingerprint} degraded=no`,
  }
}

/** JUDGE_FALLBACK 记录（降级路径专属；reason=冻结枚举值——熔断签名按此分组） */
export function judgeFallbackEvent(input: {
  id: string
  ts: number
  company: string
  site: string
  reason: JudgeFallbackReason
  detail?: string
  costUsd?: number
  durationMs?: number
  tokens?: TokenCounts
}): EventRecord {
  const rec: EventRecord = {
    id: input.id,
    ts: input.ts,
    company: input.company,
    issue: input.site,
    event: 'JUDGE_FALLBACK',
    ...JUDGE_EVENT_BASE,
    tokens: input.tokens ?? ZERO_TOKENS,
    note:
      `site=${input.site} reason=${input.reason}` +
      (input.detail === undefined ? '' : ` ${input.detail}`),
  }
  if (input.costUsd !== undefined) rec.cost_usd = input.costUsd
  if (input.durationMs !== undefined) rec.duration_ms = input.durationMs
  return rec
}
