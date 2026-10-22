/**
 * queue —— 员工待办队列排序键纯函数（129-§6.2-R1/R4，studio-dev-167 单B；docs/17-§2 并发四闸行）
 *
 * 规格依据（studio-dev-129 提案 §6.2 四裁决，制作人 2026-10-22 全批）：
 *   - R1 混合定序·规则缺省档：score = intentPriority(0..3) + ageBoost；ageBoost =
 *     min(floor(waitMs / ageStepMs), 2)（离散两档：每等一个步长 +1、封顶 +2——饥饿防线：
 *     低优老单两档反超高优新单的并列位再由 FIFO 消解）；小模型升级档=预留注入位
 *     （QueueRanker，160-B 接线——本单只落规则档）。
 *   - R4 立即唤醒·不抢占：置顶（pinned）=恒队首；高优意图只改**下一拍**派发顺序，
 *     在工单不杀不抢（无 preempt 动作词，17-§2/§3 冻结面零增）。
 *   - 并列 FIFO：score 同分比 first_seen_at 升序，再同比单号升序——全序、确定性、
 *     可重放（纯函数纪律：时间全入参）。
 *
 * 消费面：daemon 引擎相位 2 候选定序（实时算，决策永不读 todo_queue 表——表=投影
 * 非事实源，129-§6.2-R2）；panel inbox 读侧比较器与**本函数对齐测试**钉死零漂移
 * （panel 不依赖 core——依赖方向冻结，guard:boundaries）。
 *
 * 纯函数纪律：零 IO；同输入恒同输出；禁 Date.now/random。
 */

import type { TicketId } from '@studio-next/contract'

// ————————————————————————— 冻结常量 —————————————————————————

/** 意图优先级下钳边（0..3；越界钳边不拒——外部输入面防御，源侧已定缺省档） */
export const QUEUE_PRIORITY_MIN = 0
/** 意图优先级上钳边（3=最高常规档——「立即唤醒」源侧以 3 表达） */
export const QUEUE_PRIORITY_MAX = 3
/** ageBoost 档数封顶（R1「封顶 2 档」字面：tier ∈ {0,1,2}） */
export const AGE_BOOST_MAX_TIERS = 2
/** ageBoost 步长缺省（60min：每等一小时 +1 档；daemon.yaml queueAgeStepMs 可调） */
export const DEFAULT_QUEUE_AGE_STEP_MS = 60 * 60 * 1000

// ————————————————————————— 纯函数件 —————————————————————————

/** 意图优先级钳边：非数/NaN→0（缺省档），越界钳 0..3 */
export function clampPriority(priority: number | undefined): number {
  if (priority === undefined || !Number.isFinite(priority)) return QUEUE_PRIORITY_MIN
  const p = Math.trunc(priority)
  if (p < QUEUE_PRIORITY_MIN) return QUEUE_PRIORITY_MIN
  if (p > QUEUE_PRIORITY_MAX) return QUEUE_PRIORITY_MAX
  return p
}

/**
 * ageBoost 档（离散）：min(floor(waitMs / ageStepMs), 2)。
 * ageStepMs ≤ 0 或非数=0 档（防御：配置坏值不放大成恒满档——fail-closed 到无 boost）。
 * 负等待（时钟回拨）=0 档。
 */
export function ageBoostTier(waitMs: number, ageStepMs: number): number {
  if (!Number.isFinite(ageStepMs) || ageStepMs <= 0) return 0
  if (!Number.isFinite(waitMs) || waitMs <= 0) return 0
  const tier = Math.floor(waitMs / ageStepMs)
  return tier > AGE_BOOST_MAX_TIERS ? AGE_BOOST_MAX_TIERS : tier
}

/** 排序键条目（携带态快照——引擎内存携带 + todo_queue 投影行同形字段） */
export interface QueueEntryRank {
  ticket: TicketId
  /** 钳后意图优先级 0..3 */
  priority: number
  /** 制作人置顶（daemon.yaml pinnedTickets 现算——改配置即刻生效，不入携带态） */
  pinned: boolean
  /** 首次入队时刻 epoch-ms（FIFO 锚） */
  firstSeenAt: number
  /** 当前 boost 档 0..2（waitMs 已折算——快照面，投影/入参同源算） */
  boostTier: number
}

/**
 * 排序分（冻结公式）：pinned=∞ 恒首；否则 priority + boostTier（值域 0..5）。
 * ∞ 用 Number.POSITIVE_INFINITY——比较语义稳定，序列化侧（投影行）不落分值
 * 只落 priority/boost_tier 两列（可重建，panel 免时间运算）。
 */
export function queueScore(entry: Pick<QueueEntryRank, 'priority' | 'pinned' | 'boostTier'>): number {
  if (entry.pinned) return Number.POSITIVE_INFINITY
  return clampPriority(entry.priority) + entry.boostTier
}

/**
 * 全序比较器（冻结）：score 降序 → first_seen_at 升序（FIFO）→ ticket 升序（稳定尾锚）。
 * 同条目集恒同序——golden/测试锁定；panel 读侧对齐实现与此逐分对齐。
 */
export function compareQueueEntries(a: QueueEntryRank, b: QueueEntryRank): number {
  const scoreA = queueScore(a)
  const scoreB = queueScore(b)
  if (scoreA !== scoreB) return scoreA > scoreB ? -1 : 1
  if (a.firstSeenAt !== b.firstSeenAt) return a.firstSeenAt < b.firstSeenAt ? -1 : 1
  if (a.ticket !== b.ticket) return a.ticket < b.ticket ? -1 : 1
  return 0
}

/**
 * 规则缺省档排程序：返回新数组按冻结比较器降序排（不 mutate 入参）。
 * 升级位（160-B 小模型档）：QueueRanker 注入替换本缺省——调用面（引擎候选定序）零改。
 */
export function rankQueue(entries: readonly QueueEntryRank[]): QueueEntryRank[] {
  return [...entries].sort(compareQueueEntries)
}

/** 排程序注入类型（R1 升级位：规则档=rankQueue 缺省；小模型档=160-B 换注入） */
export type QueueRanker = (entries: readonly QueueEntryRank[]) => readonly QueueEntryRank[]
