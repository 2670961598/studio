/**
 * row-helpers —— 行↔记录映射小件（BC-S2 先拆再增：自 ledger.ts 拆出）
 *
 * ledger.ts（events/jobs/people 等全表面）与 hr-sync-queue.ts（v7 任务账面）共用；
 * 单一源防两处漂移。零行为变更——实现体原样搬自 ledger.ts。
 */

import { configInvalid } from '@studio-next/contract'

/** sqlite 行形状（node:sqlite .get/.all 返回；列访问经 str/optStr 收窄） */
export type SqlRow = Record<string, unknown>

export function str(row: SqlRow, key: string): string {
  return String(row[key])
}

export function optStr(row: SqlRow, key: string): string | undefined {
  const v = row[key]
  return v === null || v === undefined ? undefined : String(v)
}

export function optNum(row: SqlRow, key: string): number | undefined {
  const v = row[key]
  return v === null || v === undefined ? undefined : Number(v)
}

interface RecordParser<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues: ReadonlyArray<{ path: ReadonlyArray<string | number | symbol>; message: string }> } }
}

/** v2 五表写口的临时闸：非法 → CONFIG_INVALID（subcause=<prefix>:<首个 issue 路径>；对齐 events 闸风格） */
export function assertRecord<T>(schema: RecordParser<T>, input: unknown, prefix: string): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const path = first === undefined ? '(root)' : first.path.map(String).join('.') || '(root)'
    configInvalid(`${prefix}:${path}`, first === undefined ? undefined : `${path}: ${first.message}`)
  }
  return parsed.data
}
