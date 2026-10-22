/**
 * inbox —— :8791 收件箱读面（129-§6.2 R2/R5，studio-dev-167 单B）
 *
 * todo_queue 投影的只读呈现：制作人一眼看「谁在排什么队、排了多久」。
 *   - 行序 = 核心排序键读面镜像：pinned(∞) 恒首 → score=priority+boost_tier 降序 →
 *     first_seen_at 升序（FIFO）→ 单号升序（全序确定性）；
 *   - 与 @studio-next/core rankQueue 的语义对齐由 apps/daemon/test/panel-inbox-align.test.ts
 *     钉住（跨包对齐测试落 daemon：daemon→panel、daemon→core 均合法边；panel 包
 *     运行面依赖冻结 contract+store，panel→core 非法边不引）；
 *   - 只读纪律同本包：todo_queue 是可重建投影非事实源——本面零写。
 */
import type { Ledger, TodoQueueRecord } from '@studio-next/store'

/** 收件箱行（投影行 + 读面派生列 waitingMs） */
export interface InboxRow {
  ticket: string
  company: string
  person: string
  ready_state: 'ready' | 'awaiting_approval'
  priority: number
  pinned: boolean
  boost_tier: number
  first_seen_at: number
  last_boost_at: number | null
  why: string | null
  /** 已等待 ms（快照 now − first_seen_at——观测面现算，不落列） */
  waitingMs: number
  /** 投影刷新时刻 epoch-ms（判陈旧度用） */
  updated_at: number
}

/** 收件箱快照（/api/inbox 响应体） */
export interface InboxSnapshot {
  generatedAt: number
  company: string | null
  total: number
  ready: number
  awaitingApproval: number
  /** 队列覆盖的工号数（负载集中度观测——R1 运行面 54% 集中判据同款） */
  persons: number
  /** 最久等待 ms（饥饿观测：与 scheduleToStart 互补的排队侧口径） */
  oldestWaitMs: number
  rows: InboxRow[]
}

/** 单响应行数上限（防拉爆；快照缺省 100） */
export const INBOX_MAX_ROWS = 100

export interface InboxOptions {
  company?: string
  now?: number
  limit?: number
}

/**
 * 收件箱行序比较器（核心排序键的读面镜像）。
 * 导出面=对齐测试钉住点（apps/daemon/test/panel-inbox-align.test.ts）：本函数与
 * core compareQueueEntries 的次序必须逐例一致——漂移即红。
 */
export function compareInboxRows(a: TodoQueueRecord, b: TodoQueueRecord): number {
  const aPinned = a.pinned !== 0 ? 1 : 0
  const bPinned = b.pinned !== 0 ? 1 : 0
  if (aPinned !== bPinned) return aPinned > bPinned ? -1 : 1 // 置顶=+∞ 恒首（R4）
  const aScore = a.priority + a.boost_tier
  const bScore = b.priority + b.boost_tier
  if (aScore !== bScore) return aScore > bScore ? -1 : 1 // score 降序（R4 冻结公式）
  if (a.first_seen_at !== b.first_seen_at) return a.first_seen_at < b.first_seen_at ? -1 : 1 // 同分 FIFO
  return a.ticket < b.ticket ? -1 : a.ticket > b.ticket ? 1 : 0 // 全序兜底：单号升序
}

function toRow(r: TodoQueueRecord, now: number): InboxRow {
  return {
    ticket: r.ticket,
    company: r.company,
    person: r.person,
    ready_state: r.ready_state,
    priority: r.priority,
    pinned: r.pinned !== 0,
    boost_tier: r.boost_tier,
    first_seen_at: r.first_seen_at,
    last_boost_at: r.last_boost_at ?? null,
    why: r.why ?? null,
    waitingMs: Math.max(0, now - r.first_seen_at),
    updated_at: r.updated_at,
  }
}

/** 收件箱快照：todo_queue 投影读序化（行序=核心排序键；waitingMs 现算） */
export function buildInboxSnapshot(ledger: Ledger, options?: InboxOptions): InboxSnapshot {
  const now = options?.now ?? Date.now()
  const limit = Math.min(Math.max(options?.limit ?? INBOX_MAX_ROWS, 1), INBOX_MAX_ROWS)
  const rows = ledger.listTodoQueue(options?.company)
  const ordered = [...rows].sort(compareInboxRows)
  const mapped = ordered.map((r) => toRow(r, now))
  const readyCount = mapped.filter((r) => r.ready_state === 'ready').length
  const persons = new Set(mapped.map((r) => r.person)).size
  const oldestWaitMs = mapped.length > 0 ? Math.max(...mapped.map((r) => r.waitingMs)) : 0
  return {
    generatedAt: now,
    company: options?.company ?? null,
    total: mapped.length,
    ready: readyCount,
    awaitingApproval: mapped.length - readyCount,
    persons,
    oldestWaitMs,
    rows: mapped.slice(0, limit),
  }
}
