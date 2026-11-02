/**
 * event-compare —— 事件记录全列比对（appendEvent 幂等判据）
 *
 * 从 ledger.ts 析出（行数基线棘轮「先拆再增」：studio-dev-504 需加 WAL checkpoint 薄面）。
 * 语义零漂移：tokens 经 contract canonical 序列化后按字节比较。
 */
import type { EventRecord } from '@studio-next/contract'

/** tokens 四桶 canonical 序（F2-04 列名序）：与 ledger appendEvent 同口径 */
const TOKEN_BUCKET_ORDER = ['input', 'output', 'cache_read', 'cache_creation'] as const

function canonicalTokens(tokens: EventRecord['tokens']): string {
  const parts: string[] = []
  for (const key of TOKEN_BUCKET_ORDER) {
    const v = tokens[key]
    if (v !== undefined) parts.push(`"${key}":${v}`)
  }
  return `{${parts.join(',')}}`
}

/** 记录级全列比对（tokens 经 canonical 序列化后比字节；支撑幂等规则判定） */
export function sameEvent(a: EventRecord, b: EventRecord): boolean {
  return (
    a.id === b.id &&
    a.ts === b.ts &&
    a.company === b.company &&
    a.issue === b.issue &&
    a.event === b.event &&
    a.actor === b.actor &&
    a.attempt === b.attempt &&
    a.level === b.level &&
    a.dept === b.dept &&
    a.correlation_id === b.correlation_id &&
    a.causation_id === b.causation_id &&
    canonicalTokens(a.tokens) === canonicalTokens(b.tokens) &&
    a.cost_usd === b.cost_usd &&
    a.duration_ms === b.duration_ms &&
    a.size === b.size &&
    a.payload_hash === b.payload_hash &&
    a.note === b.note
  )
}
