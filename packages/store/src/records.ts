/**
 * records —— work_records / sessions 的 store 层记录形状（v0.2 首刀）
 *
 * 依据：docs/17-§3 行条目（id/issue/工号/instance_id/executor/session_id/lane/branch/
 * started/ended/cost/tokens/attempt/status/report_ref/summary_ref 与 session_id/issue/工号/
 * archive_path/started/ended/turns）。
 *
 * **拟稿待批（docs 未细化处，contract 的 work_records schema 尚在 TODO——见 contract index）**：
 *   - 「工号」列名 person_id；「started/ended」→ started_at/ended_at（epoch ms，ended 可空=在途）；
 *     「cost」→ cost_usd（对齐 events 列名）；
 *   - tokens 形状取 kernel.TokenCounts（executor 归一化三字段口径——work_records 来自收割
 *     ResultStats，与 events 四桶不同源，F2-04 只冻结 events 侧）；
 *   - status 先为非空串（done/failed 具体枚举归收割域，contract 落地时收口）；
 *   - id / session_id 暂不锁 ULID（与 events 不同：17-§3 未标 id 形状，先非空）。
 * 本文件是 store 层临时闸（拒明显坏行入账），contract schema 落地后替换为契约校验。
 */
import { z } from 'zod'
import type { TokenCounts } from '@studio-next/contract'

/** work_records 记录（done.json 索引化，17-§3「权威源」列） */
export interface WorkRecord {
  id: string
  issue: string
  person_id: string
  instance_id?: string
  executor: string
  session_id?: string
  lane?: string
  branch?: string
  started_at: number
  ended_at?: number
  cost_usd?: number
  tokens?: TokenCounts
  attempt: number
  status: string
  report_ref?: string
  summary_ref?: string
}

/** sessions 记录（归档文件的索引，17-§3） */
export interface SessionRecord {
  session_id: string
  issue: string
  person_id: string
  archive_path?: string
  started_at: number
  ended_at?: number
  turns?: number
}

/** store 层临时校验（拟稿待批，见文件头注） */
export const WorkRecordSchema = z.strictObject({
  id: z.string().min(1),
  issue: z.string().min(1),
  person_id: z.string().min(1),
  instance_id: z.string().min(1).optional(),
  executor: z.string().min(1),
  session_id: z.string().min(1).optional(),
  lane: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  started_at: z.number().int().min(0),
  ended_at: z.number().int().min(0).optional(),
  cost_usd: z.number().min(0).optional(),
  tokens: z
    .strictObject({ input: z.number().int().min(0), output: z.number().int().min(0), cached: z.number().int().min(0).optional() })
    .optional(),
  attempt: z.number().int().min(1),
  status: z.string().min(1),
  report_ref: z.string().min(1).optional(),
  summary_ref: z.string().min(1).optional(),
})

/** store 层临时校验（拟稿待批，见文件头注） */
export const SessionRecordSchema = z.strictObject({
  session_id: z.string().min(1),
  issue: z.string().min(1),
  person_id: z.string().min(1),
  archive_path: z.string().min(1).optional(),
  started_at: z.number().int().min(0),
  ended_at: z.number().int().min(0).optional(),
  turns: z.number().int().min(0).optional(),
})
