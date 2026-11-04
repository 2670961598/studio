/**
 * 785：事件索引增量累积器与全量重建逐字段等价；collect eventIndexOf 游标增量/重启 bootstrap/
 * 游标缺口回退全量（fail-safe）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { EventRecord } from '@studio-next/contract'
import { openLedger } from '@studio-next/store'
import { buildEventIndex, createEventIndexAccumulator } from '../../../src/engine/sentinel/events-index.ts'
import { eventIndexOf } from '../../../src/engine/tick/collect.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const COMPANY = 'demo'

function ev(seq: number, issue: string, event: EventRecord['event'], note?: string): { record: EventRecord; id: string; ts: number } {
  const ts = 1_700_000_000_000 + seq
  const id = `01J${String(seq).padStart(23, '0')}`
  return { record: { id, ts, company: COMPANY, issue, event, actor: 'daemon', attempt: 1, level: 1, dept: 'departments/工程部', tokens: { input: 0 }, ...(note !== undefined ? { note } : {}) }, id, ts }
}

const SAMPLE = [
  ev(1, 'T-1', 'DISPATCH', 'intent=k1'),
  ev(2, 'T-1', 'STALL', '看门狗告警第 1/2 次'),
  ev(3, 'T-1', 'STALL', '工位收口 interrupted'),
  ev(4, 'T-1', 'DISPATCH', 'intent=k2'),
  ev(5, 'T-2', 'PATROL', 'job=job-1;intent=p1'),
  ev(6, 'T-2', 'ESCALATE', 'UNKNOWN_STATE;state=weird'),
  ev(7, 'T-2', 'ESCALATE', 'UNKNOWN_STATUS;status=ghost'),
  ev(8, 'T-1', 'GATE_PASS', 'ok'),
  ev(9, 'T-1', 'CLOSE', 'done'),
  ev(10, 'T-3', 'APPROVE', 'DIRECTIVE;directive=d1;verb=approve'),
  ev(11, 'T-3', 'DISPATCH', 'intent=k3'),
]

interface IndexSnapshot {
  attempts: number[]; seenKeys: string[]; closed: string[]; stall: number[]; seenKey: Array<string | null>
  patrol: string[]; unknown: string[]; foreign: string[]; drift: string[]; declared: string[]; extra: string[]
  directives: string[]; standing: Array<string | null>; job: Array<string | undefined>; manual: boolean[]; chain: boolean[]
}
function snapshotOf(index: ReturnType<typeof buildEventIndex>): IndexSnapshot {
  const tickets = ['T-1', 'T-2', 'T-3', 'T-9']
  return {
    attempts: tickets.map((t) => index.attemptOf(t)),
    seenKeys: [...index.seenKeys].sort(),
    closed: [...index.closed].sort(),
    stall: tickets.map((t) => index.stallStrikesOf(t)),
    seenKey: tickets.map((t) => index.seenKeyOf(t)),
    patrol: [...index.patrolKeys].sort(),
    unknown: [...index.unknownStateAlarmed].sort(),
    foreign: [...index.foreignKnownAlarmed].sort(),
    drift: [...index.statusSetDriftAlarmed].sort(),
    declared: [...index.declaredStatusMissingAlarmed].sort(),
    extra: [...index.platformStatusExtraAlarmed].sort(),
    directives: [...index.directiveKeys].sort(),
    standing: tickets.map((t) => index.directiveStandingOf(t)),
    job: tickets.map((t) => index.jobAnchorOf(t)),
    manual: tickets.map((t) => index.mergeManualOf(t)),
    chain: tickets.map((t) => index.manualChainNotedOf(t)),
  }
}

describe('createEventIndexAccumulator：增量与全量逐字段等价', () => {
  it('分批 applyEvents（含重复批边界）≡ buildEventIndex 全量', () => {
    const records = SAMPLE.map((x) => x.record)
    const full = snapshotOf(buildEventIndex(records))
    const acc = createEventIndexAccumulator()
    acc.applyEvents(records.slice(0, 4))
    acc.applyEvents(records.slice(4, 7))
    acc.applyEvents(records.slice(7))
    expect(snapshotOf(acc.index())).toEqual(full)
  })
})

describe('collect.eventIndexOf：F1 重启全量重建 / F2 乱序 ts 回填', () => {
  it('F1：新 ledger 对象（模拟重启）+ 既有持久游标 → 无条件全量重建，index ≡ 全量', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'event-index-restart-'))
    dirs.push(dir)
    const dbPath = path.join(dir, 'l.sqlite')
    const first = openLedger(dbPath)
    try {
      for (const item of SAMPLE.slice(0, 7)) first.appendEvent(item.record)
      // 首进程：建索引（写游标）
      const before = snapshotOf(eventIndexOf(first, COMPANY))
      expect(ledger_kvHasCursor(first)).toBe(true)
      expect(before).toEqual(snapshotOf(buildEventIndex(SAMPLE.slice(0, 7).map((x) => x.record))))
    } finally {
      first.close()
    }
    // 关库重开＝新进程/新 ledger 对象（进程内缓存为空；kv 游标仍在）
    const second = openLedger(dbPath)
    try {
      expect(ledger_kvHasCursor(second)).toBe(true)
      const restarted = snapshotOf(eventIndexOf(second, COMPANY))
      const full = snapshotOf(buildEventIndex(SAMPLE.slice(0, 7).map((x) => x.record)))
      expect(restarted).toEqual(full) // F1 阻断项：不得为空索引
      expect(restarted.seenKeys).toEqual(full.seenKeys)
      expect(restarted.attempts).toEqual(full.attempts)
    } finally {
      second.close()
    }
  })

  it('F2：进程内缓存存在时追加 ts 小于 cursor.ts 的事件 → 检测回填并全量重建（不丢事件）', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'event-index-backfill-'))
    dirs.push(dir)
    const ledger = openLedger(path.join(dir, 'l.sqlite'))
    try {
      const base = SAMPLE.slice(0, 6)
      for (const item of base) ledger.appendEvent(item.record)
      const first = snapshotOf(eventIndexOf(ledger, COMPANY))
      expect(first).toEqual(snapshotOf(buildEventIndex(base.map((x) => x.record))))
      // 追加一个 ts 比 cursor.ts 更早的“迟到回填”事件（append-only 允许，链 seq 更大）
      const late = ev(0, 'T-7', 'DISPATCH', 'intent=late')
      const lateRecord = { ...late.record, ts: 1_700_000_000_000 - 10 }
      ledger.appendEvent(lateRecord)
      const after = snapshotOf(eventIndexOf(ledger, COMPANY))
      // T-1 两条 DISPATCH → attempt=3；其余单 attempt=1（DISPATCH 计数+1）
      expect(after.attempts).toEqual([3, 1, 1, 1])
      expect(after.seenKeys).toEqual([...buildEventIndex([...base.map((x) => x.record), lateRecord]).seenKeys].sort())
      // 等价全量（ts,id 序）
      expect(after).toEqual(snapshotOf(buildEventIndex([...base.map((x) => x.record), lateRecord])))
    } finally {
      ledger.close()
    }
  })

  it('同 ts 多 id：链序增量不重不漏（seq 权威顺序）', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'event-index-samets-'))
    dirs.push(dir)
    const ledger = openLedger(path.join(dir, 'l.sqlite'))
    try {
      const ts = 1_700_000_000_000
      const a = { id: `${'0'.repeat(25)}A`, ts, company: COMPANY, issue: 'T-A', event: 'DISPATCH' as const, actor: 'daemon', attempt: 1, level: 1, dept: 'departments/工程部', tokens: { input: 0 }, note: 'intent=ka' }
      const b = { id: `${'0'.repeat(25)}B`, ts, company: COMPANY, issue: 'T-B', event: 'DISPATCH' as const, actor: 'daemon', attempt: 1, level: 1, dept: 'departments/工程部', tokens: { input: 0 }, note: 'intent=kb' }
      ledger.appendEvent(a)
      ledger.appendEvent(b)
      const index = eventIndexOf(ledger, COMPANY)
      expect(index.attemptOf('T-A' as never)).toBe(2)
      expect(index.attemptOf('T-B' as never)).toBe(2)
      expect([...index.seenKeys].sort()).toEqual(['ka', 'kb'])
    } finally {
      ledger.close()
    }
  })
})

function ledger_kvHasCursor(ledger: ReturnType<typeof openLedger>): boolean {
  const raw = ledger.kvGet('sentinel.eventIndex.cursor')
  return raw !== null && raw !== ''
}
