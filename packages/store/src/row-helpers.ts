/**
 * row-helpers —— 行↔记录映射小件（BC-S2 先拆再增：自 ledger.ts 拆出）
 *
 * ledger.ts（events/jobs/people 等全表面）与 hr-sync-queue.ts（v7 任务账面）共用；
 * 单一源防两处漂移。零行为变更——实现体原样搬自 ledger.ts。
 *
 * v16 起 `rowToEvent` / `parseTokens` 也落本件：events 哈希链（events-chain.ts）校验面必须
 * 与写面**同一行→记录口径**，复制到第二处=摘要漂移面（链校验会把正常行判成篡改）。
 */

import { configInvalid, type EventRecord } from '@studio-next/contract'

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

/** events.tokens 列 → 四桶对象（非 JSON 对象=库内损坏，CONFIG_INVALID 拒读） */
export function parseTokens(json: string): EventRecord['tokens'] {
  const parsed: unknown = JSON.parse(json)
  if (typeof parsed !== 'object' || parsed === null) {
    configInvalid('store/evt:tokens-corrupt', `tokens 列不是 JSON 对象：${json}`)
  }
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === 'number') out[k] = v
  }
  return out as EventRecord['tokens']
}

/**
 * events 行 ↔ EventRecord（列集逐列对齐 contract EventRecordSchema 字段名）。
 * 写面（ledger.appendEvent 幂等比对）与链校验面（events-chain.verifyEventsChain 摘要复算）
 * 共用本函数——同内容恒同记录形态，链摘要才可跨写/读/重建三面复算一致。
 */
export function rowToEvent(row: SqlRow): EventRecord {
  const rec: EventRecord = {
    id: str(row, 'id'),
    ts: Number(row['ts']),
    company: str(row, 'company'),
    issue: str(row, 'issue'),
    event: str(row, 'event'),
    actor: str(row, 'actor'),
    attempt: Number(row['attempt']),
    level: Number(row['level']),
    dept: str(row, 'dept'),
    tokens: parseTokens(str(row, 'tokens')),
  }
  const correlationId = optStr(row, 'correlation_id')
  if (correlationId !== undefined) rec.correlation_id = correlationId
  const causationId = optStr(row, 'causation_id')
  if (causationId !== undefined) rec.causation_id = causationId
  const costUsd = optNum(row, 'cost_usd')
  if (costUsd !== undefined) rec.cost_usd = costUsd
  const durationMs = optNum(row, 'duration_ms')
  if (durationMs !== undefined) rec.duration_ms = durationMs
  const size = optNum(row, 'size')
  if (size !== undefined) rec.size = size
  const payloadHash = optStr(row, 'payload_hash')
  if (payloadHash !== undefined) rec.payload_hash = payloadHash
  const note = optStr(row, 'note')
  if (note !== undefined) rec.note = note
  return rec
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
