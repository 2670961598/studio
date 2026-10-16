/**
 * dispositions —— 错误处置语义表（docs/17-§9 文字落成表，需求 F1 错误面）
 *
 * 规格依据（实现单引用）：
 *   - docs/17-§9：错误分类两级（类别×子因），11 类冻结枚举（contract.ErrorCategory）；
 *     「每类带处置语义（重试/退审/开单/熔断）」——文字只有四语义，逐类映射是本刀落表，
 *     **全表为拟稿待批**（见头注末段），冻结后禁改、升 contract 走进化管线。
 *   - docs/17-§10 / F1-10：报错升级电路=断路器（src/breaker.ts）；本表只回答
 *     「这类错误归哪条处置路线、是否计入连击」，与断路器正交组合：
 *     disposition=retry 且 countsTowardBreaker=true 的错误才会在连击达 N 时熔断开单。
 *
 * 四处置语义（docs/17-§9 冻结词汇）：
 *   retry        重试——机器可自行再派（受断路器约束；attempt 照计，F1-10）
 *   send_back    退审——退回制作人/上级人裁（机器不得自愈的错）
 *   open_ticket  开单——自动开衍生单（bug/改进单）留痕并另派
 *   circuit_break熔断——立即停线（不等连击），人介入后复位
 */

import type { ErrorCategory } from '@studio-next/contract'

export type Disposition = 'retry' | 'send_back' | 'open_ticket' | 'circuit_break'

/** 单类处置条目 */
export interface ErrorDisposition {
  category: ErrorCategory
  /** 主处置路线（四语义之一） */
  disposition: Disposition
  /** 是否计入断路器连击（同单同签名）——机器自愈路线通常计，人因/配置错不计 */
  countsTowardBreaker: boolean
  /** 落表理由（引用 docs/17-§9 子因；拟稿批注） */
  note: string
}

/**
 * 默认处置表（拟稿待批——docs/17-§9 未逐类冻结，本表为首刀拟稿）：
 *   GATE_FAIL      重试：验收红/超时/环境多为一过性，重派过闸；连击熔断兜底（子因：验收红/超时/环境）
 *   WORKER_DEAD    重试：进程死了重派新命（子因：wall/budget/心跳/僵尸；budget 超帽子因另走
 *                  预算 refusal→退审，F1-09，本表类别级不拆子因——拟升两级时拆）
 *   QA_BACK        重试：复验打回=带打回理由重派续跑（summary sidecar 注入前情）
 *   STALL          重试：看门狗 kill 后重派（stall_alarm 先行，心跳超时属此类）
 *   NO_LANE        退审：无泳道可用是配置/资源问题，人裁泳道归属（泳道忙=正常排队不计错）
 *   DISPATCH_FAIL  重试：脏树清理/死主租约回收后重派（子因：脏树/锁占；预查拦子因=预查
 *                  主动拦下，实为 send_back 语义——类别级取 retry，两级拆分时上拆，拟稿）
 *   MERGE_CONFLICT 重试：带冲突上下文重派解冲突；反复冲突由断路器收敛开单
 *   LLM_FAIL       重试：模型面瞬时故障（超时/解析）重派；解析失败换档另议（两级拆分点）
 *   CONFIG_INVALID 退审：配置错是人的错，机器重试只会放大事故——不计连击
 *   EVOLVE_REJECT  开单：进化管线拒收候选是治理结论，自动开改进单留谱系（F3-01）
 *   EXTERNAL_REJECT退审：外部系统拒绝需人介入协调，机器不自愈
 */
export const DEFAULT_DISPOSITIONS: Readonly<Record<ErrorCategory, ErrorDisposition>> = {
  GATE_FAIL: { category: 'GATE_FAIL', disposition: 'retry', countsTowardBreaker: true, note: '验收红/超时/环境多为一过性，重派过闸；连击熔断兜底' },
  WORKER_DEAD: { category: 'WORKER_DEAD', disposition: 'retry', countsTowardBreaker: true, note: 'wall/budget/心跳/僵尸重派新命；budget 子因另走 refusal 退审（F1-09，两级拆分点）' },
  QA_BACK: { category: 'QA_BACK', disposition: 'retry', countsTowardBreaker: true, note: '复验打回=带打回理由重派续跑（summary sidecar 前情注入）' },
  STALL: { category: 'STALL', disposition: 'retry', countsTowardBreaker: true, note: '看门狗 kill 后重派；stall_alarm 先行' },
  NO_LANE: { category: 'NO_LANE', disposition: 'send_back', countsTowardBreaker: false, note: '无泳道=配置/资源问题人裁；泳道忙属正常排队不计错' },
  DISPATCH_FAIL: { category: 'DISPATCH_FAIL', disposition: 'retry', countsTowardBreaker: true, note: '脏树清理/死主回收后重派；预查拦子因实为退审（两级拆分点，拟稿）' },
  MERGE_CONFLICT: { category: 'MERGE_CONFLICT', disposition: 'retry', countsTowardBreaker: true, note: '带冲突上下文重派；反复冲突由断路器收敛' },
  LLM_FAIL: { category: 'LLM_FAIL', disposition: 'retry', countsTowardBreaker: true, note: '模型面瞬时故障（超时/解析）重派；换档另议' },
  CONFIG_INVALID: { category: 'CONFIG_INVALID', disposition: 'send_back', countsTowardBreaker: false, note: '配置错机器重试放大事故；人修配置，不计连击' },
  EVOLVE_REJECT: { category: 'EVOLVE_REJECT', disposition: 'open_ticket', countsTowardBreaker: false, note: '治理结论自动开改进单留谱系（F3-01 进化管线）' },
  EXTERNAL_REJECT: { category: 'EXTERNAL_REJECT', disposition: 'send_back', countsTowardBreaker: false, note: '外部系统拒绝需人介入协调，机器不自愈' },
}

/** 查表（类别全枚举覆盖，恒有值；独立表传入可换，公司级覆盖拟稿见汇报） */
export function dispositionFor(
  category: ErrorCategory,
  table: Readonly<Record<ErrorCategory, ErrorDisposition>> = DEFAULT_DISPOSITIONS,
): ErrorDisposition {
  return table[category]
}

/** 计连击类别集合（retry 族中 countsTowardBreaker=true 者；供断路器入账前过滤） */
export function breakerCountedCategories(
  table: Readonly<Record<ErrorCategory, ErrorDisposition>> = DEFAULT_DISPOSITIONS,
): readonly ErrorCategory[] {
  return (Object.keys(table) as ErrorCategory[]).filter((c) => table[c].countsTowardBreaker)
}
