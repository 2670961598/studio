/**
 * todo-queue-records —— v8 todo_queue 待办队列投影记录（129-§6.2-R2，studio-dev-167 单B）。
 *
 * 从 records.ts 分出（尺寸阈 600 清偿——记录形状单一源不变，records.ts 转发出口）。
 * 口径：可重建投影非事实源——决策永不读表；first_seen_at=引擎携带态种子（jobs.last_run_at
 * 先例非事件可导）；pinned/boost_tier 为排序键列（值域冻结见 schema 行注）。
 */
import { z } from 'zod'

// —— v8 todo_queue 待办队列投影（129-§6.2-R2，studio-dev-167 单B）——

/** todo_queue 行（可重建投影非事实源：单写者=daemon 每拍末全量重投；决策永不读表） */
export interface TodoQueueRecord {
  company: string
  ticket: string
  /** 队列归属工号（引擎 resolvePerson 解析：assignee→defaultPersonId 链） */
  person: string
  /** 钳后意图优先级 0..3（排序键列一） */
  priority: number
  /** 制作人置顶 0|1（daemon.yaml pinnedTickets 现算——改配置即刻生效） */
  pinned: number
  /** ageBoost 档 0..2（排序键列二：min(floor(wait/step),2)，投影刷新时折算落列） */
  boost_tier: number
  /** 首次入队 epoch-ms（FIFO 锚；引擎携带态——jobs.last_run_at 先例非事件可导） */
  first_seen_at: number
  /** 最近升档 epoch-ms（观测面推导值 first_seen_at+tier*ageStepMs；可空=未升档） */
  last_boost_at?: number
  /** 'ready'（等前向派发）| 'awaiting_approval'（待批态：成员但等制作人批） */
  ready_state: 'ready' | 'awaiting_approval'
  /** 入队归因（意图源+kind，人读） */
  why?: string
  /** 投影刷新时刻 epoch-ms */
  updated_at: number
}

/** store 层临时校验（拟稿待批，见文件头注；v8 值域冻结：priority 0..3 / boost_tier 0..2——值域单一源=core/queue.ts，此处形状闸） */
export const TodoQueueRecordSchema = z.strictObject({
  company: z.string().min(1),
  ticket: z.string().min(1),
  person: z.string().min(1),
  priority: z.number().int().min(0).max(3),
  pinned: z.number().int().min(0).max(1),
  boost_tier: z.number().int().min(0).max(2),
  first_seen_at: z.number().int().min(0),
  last_boost_at: z.number().int().min(0).optional(),
  ready_state: z.enum(['ready', 'awaiting_approval']),
  why: z.string().min(1).optional(),
  updated_at: z.number().int().min(0),
})
