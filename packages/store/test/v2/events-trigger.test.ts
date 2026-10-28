/**
 * test/v2/events-trigger —— v15：events 防改触发器（SEC-FC-04；负向行 NEG-SEC-03）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/15 §一 SEC-FC-04（events 是唯一没有 no-update/no-delete 触发器的台账表，而它恰是
 *     append-only 承诺所锚的链）：目标＝两枚行级触发器与既有四表同机制；哈希链或等价物承接 I-17
 *     仍标**目标（未证）**（GAP-V2-05）
 *   - docs/v2/17 §一（I-17 行）＋§三 NEG-SEC-03「改/删 events 行 → 触发器拒」（V5 腿）
 *   - plan/05 IMPL-04-02（v15 条目；验收：`test:v2` 绿、NEG-SEC-03、B9 复算 LATEST=15、
 *     **rebuild 兼容**——投影重建仍可行）
 *   - docs/v2/16 §一 B11（rebuild 循环体只 appendEvent，零 cost 重放）——本文件只证「触发器不阻断
 *     重放」，DOM-04 排除域归 IMPL-04-03/04 的测试面
 *
 * 隔离：临时目录真文件库（`os.tmpdir()`；删库重建演习需真文件语义）；**不碰真实台账库**。
 * 夹具**自带**（不 import 同目录 fixtures.ts）：本文件与 04-03/04 泳道并行施工，避免跨单共享件漂移。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EventRecord } from '@studio-next/contract'
import { openLedger, type Ledger } from '../../src/ledger.ts'
import { LATEST_VERSION, currentVersion, migrate } from '../../src/migrations.ts'
import { eventsTriggersMigration } from '../../src/records-migrations.ts'
import { rebuild } from '../../src/rebuild.ts'

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** 确定性合成 ULID（时间位 10 字符 + 随机位 16 字符；同参数恒同 id） */
function ulid(ts: number, seq: number): string {
  const enc = (value: bigint, len: number): string => {
    let out = ''
    for (let i = len - 1; i >= 0; i--) out += B32[Number((value / 32n ** BigInt(i)) % 32n)] ?? '0'
    return out
  }
  return enc(BigInt(ts), 10) + enc(BigInt(seq), 16)
}

const T0 = Date.UTC(2026, 9, 28, 3, 0, 0)

/** 合法事件（四桶 tokens 为新写面口径；over 可改 id/ts/event/note 等） */
function eventRecord(seq: number, over: Partial<EventRecord> = {}): EventRecord {
  return {
    id: ulid(T0, seq),
    ts: T0 + seq,
    company: 'studio-dev',
    issue: 'STUDIO-501',
    event: 'LLM',
    actor: 'AGENT-1:agent-1',
    attempt: 1,
    level: 2,
    dept: 'departments/工程部',
    tokens: { input: 10, output: 5 },
    note: `seq=${seq}`,
    ...over,
  }
}

/** 断言抛出「触发器 ABORT」：消息＝RAISE 第二参数（SEC-FC-04 的机械形状） */
function expectAppendOnlyAbort(fn: () => unknown): void {
  let caught: unknown
  try {
    fn()
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(Error)
  expect((caught as Error).message).toContain('events is append-only')
}

function triggerRows(db: DatabaseSync): Array<{ name: string; sql: string }> {
  return db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'events' ORDER BY name")
    .all() as unknown as Array<{ name: string; sql: string }>
}

function eventCount(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM events').get() as unknown as { c: number }
  return Number(row.c)
}

let root = ''
let ledger: Ledger

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-store-v15-'))
  ledger = openLedger(path.join(root, 'ledger.db'))
})

afterAll(async () => {
  ledger.close()
  await rm(root, { recursive: true, force: true })
})

describe('v15 触发器在库（SEC-FC-04 机制面）', () => {
  it('两枚触发器：trg_events_no_update / trg_events_no_delete，均以 RAISE(ABORT) 拒绝', () => {
    const rows = triggerRows(ledger.db)
    expect(rows.map((r) => String(r.name))).toEqual(['trg_events_no_delete', 'trg_events_no_update'])
    for (const row of rows) {
      expect(String(row.sql)).toContain('RAISE(ABORT')
      expect(String(row.sql)).toContain('events is append-only')
      expect(String(row.sql)).toMatch(/BEFORE (?:UPDATE|DELETE) ON events/)
    }
  })

  it('v1 建表体一字不动：events 列集仍＝v1 十七列（v15 只补触发器，不 ALTER）', () => {
    const cols = ledger.db.prepare('PRAGMA table_info(events)').all() as unknown as Array<{ name: string }>
    expect(cols.map((c) => String(c.name))).toEqual([
      'id',
      'ts',
      'company',
      'issue',
      'event',
      'actor',
      'attempt',
      'level',
      'dept',
      'correlation_id',
      'causation_id',
      'tokens',
      'cost_usd',
      'duration_ms',
      'size',
      'payload_hash',
      'note',
    ])
    expect(eventsTriggersMigration.sql).not.toMatch(/ALTER|CREATE TABLE/)
  })
})

describe('NEG-SEC-03：改/删 events 行必须被拒（放行路径不存在）', () => {
  it('UPDATE 被 ABORT，且行内容零变化（拒绝不是「先改后报错」）', () => {
    const event = eventRecord(1)
    expect(ledger.appendEvent(event)).toEqual({ id: event.id, appended: true })
    expectAppendOnlyAbort(() => ledger.db.prepare('UPDATE events SET event = ? WHERE id = ?').run('TAMPER', event.id))
    expectAppendOnlyAbort(() => ledger.db.prepare('UPDATE events SET tokens = ? WHERE id = ?').run('{}', event.id))
    const row = ledger.db.prepare('SELECT event, note, tokens FROM events WHERE id = ?').get(event.id) as unknown as Record<
      string,
      unknown
    >
    expect(row['event']).toBe('LLM')
    expect(row['note']).toBe('seq=1')
    expect(JSON.parse(String(row['tokens']))).toEqual({ input: 10, output: 5 })
  })

  it('DELETE 被 ABORT，行仍可读（append-only 链不可缩短）', () => {
    const before = eventCount(ledger.db)
    const target = ledger.queryEvents()[0]!
    expectAppendOnlyAbort(() => ledger.db.prepare('DELETE FROM events WHERE id = ?').run(target.id))
    expect(eventCount(ledger.db)).toBe(before)
    expect(ledger.queryEvents().some((e) => e.id === target.id)).toBe(true)
  })

  it('整表清空（无 WHERE 的 DELETE）同样被拒', () => {
    const before = eventCount(ledger.db)
    expectAppendOnlyAbort(() => ledger.db.exec('DELETE FROM events'))
    expect(eventCount(ledger.db)).toBe(before)
  })
})

describe('appendEvent 仍可写入（触发器只拒改/删，不拒追加）', () => {
  it('合法事件逐条追加成功；同 id 全列一致的重复＝幂等跳过（不触发 UPDATE 语句）', () => {
    const before = eventCount(ledger.db)
    const event = eventRecord(2, { event: 'DISPATCH' })
    expect(ledger.appendEvent(event)).toEqual({ id: event.id, appended: true })
    expect(ledger.appendEvent(event)).toEqual({ id: event.id, appended: false })
    expect(eventCount(ledger.db)).toBe(before + 1)
  })

  it('事务内 INSERT + ROLLBACK 不受限（触发器不影响重放事务语义）', () => {
    const before = eventCount(ledger.db)
    ledger.db.exec('BEGIN')
    ledger.appendEvent(eventRecord(3, { event: 'HEARTBEAT' }))
    expect(eventCount(ledger.db)).toBe(before + 1)
    ledger.db.exec('ROLLBACK')
    expect(eventCount(ledger.db)).toBe(before)
  })
})

describe('升级路径：v14 库无触发器（现状缺口）→ v15 补装后改/删被拒', () => {
  it('upTo:14 时 UPDATE 可成功（SEC-FC-04 原缺口）；migrate() 到 15 后同一语句被 ABORT', () => {
    const staged = new DatabaseSync(':memory:')
    try {
      expect(migrate(staged, { upTo: 14 })).toBe(14)
      expect(triggerRows(staged)).toEqual([])
      const event = eventRecord(4, { event: 'LLM' })
      staged
        .prepare(
          'INSERT INTO events (id, ts, company, issue, event, actor, attempt, level, dept, tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(event.id, event.ts, event.company, event.issue, event.event, event.actor, 1, 2, event.dept, '{}')
      // 缺口证据：v14 库上改史不被拦（正是 SEC-FC-04 现状列描述的行为）
      staged.prepare('UPDATE events SET event = ? WHERE id = ?').run('TAMPER', event.id)
      expect(migrate(staged)).toBe(15)
      expect(triggerRows(staged).map((r) => String(r.name))).toEqual(['trg_events_no_delete', 'trg_events_no_update'])
      expectAppendOnlyAbort(() => staged.prepare('UPDATE events SET event = ? WHERE id = ?').run('TAMPER2', event.id))
      expectAppendOnlyAbort(() => staged.prepare('DELETE FROM events WHERE id = ?').run(event.id))
      // v1 未重放：schema_version 仍 15 行（sha8 防漂移面未破）
      const rows = staged.prepare('SELECT COUNT(*) AS c FROM schema_version').get() as unknown as { c: number }
      expect(Number(rows.c)).toBe(15)
    } finally {
      staged.close()
    }
  })
})

describe('rebuild 兼容：投影重建仍可行（B11 只重放 events）', () => {
  it('dumpEvents → rebuild 到新库：行数与内容一致、目标库＝15、触发器随 migrate 重装', async () => {
    const source = path.join(root, 'events.jsonl')
    const target = path.join(root, 'rebuilt.db')
    const dumped = ledger.dumpEvents(source)
    const expected = ledger.queryEvents().map((e) => e.id)
    expect(dumped.lines).toBe(expected.length)

    const result = rebuild(source, target)
    expect(result.events).toBe(dumped.lines)
    expect(result.version).toBe(LATEST_VERSION)
    expect(result.version).toBe(15)

    const rebuilt = openLedger(target)
    try {
      expect(currentVersion(rebuilt.db)).toBe(15)
      expect(rebuilt.queryEvents().map((e) => e.id)).toEqual(expected)
      // 重建库同样受保护（触发器由迁移装回，不是源库专有）
      expect(triggerRows(rebuilt.db).map((r) => String(r.name))).toEqual([
        'trg_events_no_delete',
        'trg_events_no_update',
      ])
      expectAppendOnlyAbort(() => rebuilt.db.exec('DELETE FROM events'))
      expectAppendOnlyAbort(() => rebuilt.db.prepare('UPDATE events SET company = ?').run('tampered'))
      // 重放路径仍是 INSERT（appendEvent 契约闸），追加不撞触发器
      const extra = eventRecord(9, { event: 'GATE_PASS' })
      expect(rebuilt.appendEvent(extra)).toEqual({ id: extra.id, appended: true })
    } finally {
      rebuilt.close()
    }
  })
})
