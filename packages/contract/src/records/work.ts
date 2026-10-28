/**
 * WORK 任务族登记与形状闸（v2/11 §1.4：WORK 21 类）——MIG-03 / IMPL-03-02
 *
 * 依据：v2/11 §1.4（WORK 任务族 21 类唯一登记处行）、§五（字段与不变量）、§十四（§14.1 迁移边）；
 *       v2/09 ENU-03/07/08/09/10/11/12/13/14/15/16/17/19/20/21/22/23/24/25/26/27/28/80/107/124/126/127；
 *       plan/05 IMPL-03-02（work.ts 单书；超 600 行拆 4 件，本文件为并集闸与重导出）。
 *
 * 21 类构成（§1.4 表序）：
 *   §5.1 入口与合同 01..05：work-intent.ts
 *   §5.2 迁移与判定 06..09＋ACCEPT-MAINT：work-state.ts
 *   §5.2/§5.4 返工/重开/协作/异常/止损 10、11、13、17、18：work-exec.ts
 *   §5.2/§5.3 结清/义务/承诺/交接 12、14、15、16＋HANDOVER/COMMIT-CHANGE：work-close.ts
 *
 * 纪律：只写可擦除语法；相对 import 带 `.ts`；类型导入 `import type`。
 */
import type { z } from 'zod'
import { WORK_CLOSE_RECORD_SCHEMAS } from './work-close.ts'
import { WORK_EXEC_RECORD_SCHEMAS } from './work-exec.ts'
import { WORK_INTENT_RECORD_SCHEMAS } from './work-intent.ts'
import { WORK_STATE_RECORD_SCHEMAS } from './work-state.ts'

export * from './work-intent.ts'
export * from './work-state.ts'
export * from './work-exec.ts'
export * from './work-close.ts'

/** v2/11 §1.4 WORK 任务族 21 类（序即 §1.4 表序） */
export const WORK_RECORD_TYPES = [
  'REC-WORK-01', 'REC-WORK-02', 'REC-WORK-03', 'REC-WORK-04', 'REC-WORK-05',
  'REC-WORK-06', 'REC-WORK-07', 'REC-WORK-08', 'REC-WORK-09', 'REC-WORK-10',
  'REC-WORK-11', 'REC-WORK-12', 'REC-WORK-13', 'REC-WORK-14', 'REC-WORK-15',
  'REC-WORK-16', 'REC-WORK-17', 'REC-WORK-18',
  'REC-WORK-ACCEPT-MAINT', 'REC-WORK-HANDOVER', 'REC-WORK-COMMIT-CHANGE',
] as const

export type WorkRecordType = (typeof WORK_RECORD_TYPES)[number]

/** 形状闸：21 类 payload 形状（按 recordType 取 schema 解析） */
export const WORK_RECORD_SCHEMAS: Readonly<Record<WorkRecordType, z.ZodType>> = {
  ...WORK_INTENT_RECORD_SCHEMAS,
  ...WORK_STATE_RECORD_SCHEMAS,
  ...WORK_EXEC_RECORD_SCHEMAS,
  ...WORK_CLOSE_RECORD_SCHEMAS,
}
