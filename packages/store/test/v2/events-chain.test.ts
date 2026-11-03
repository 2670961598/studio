/**
 * test/v2/events-chain —— v16：events 哈希链（I-17 防篡改"哈希链或等价物"腿；GAP-V2-05 残余）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/01 §三 I-17「事实与证据材料的记录链可核验」——修改必留痕、记录链防篡改
 *     （哈希链或等价物）由**目标（未证）**转为本刀机制的落点；
 *   - docs/v2/15 §一 SEC-FC-04（events 完整性）：触发器腿已由 v15 落；哈希链或等价物承接 I-17
 *     的哈希链腿＝本刀（v16）——追加时链式摘要、校验面可判篡改，链断/不匹配 fail-closed；
 *   - docs/v2/17 §一（I-17 行）/§三 NEG-SEC-03（改/删 events 行→拒）——本文件补哈希链负向行：
 *     改一条历史事件而不同步全链 → 校验必失败且定位到行；未链化追加 → 拒开（fail-closed）；
 *   - docs/17-§2（主循环七相位）／§6（收割四要件：终态事件＋输出＋REPORT＋闸门）——本链是
 *     七相位/收割落账所锚的 append-only 事件账的防篡改面；daemon 打开台账即校验（启动日志）。
 *
 * 隔离：临时目录真文件库（`os.tmpdir()`；篡改/拒开需真文件语义）；不碰真实台账库。
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LATEST_VERSION, migrate } from '../../src/migrations.ts'
import { openLedger, rebuild, type Ledger } from '../../src/index.ts'
import { eventsChainMigration, GENESIS_HASH, verifyEventsChain } from '../../src/events-chain.ts'
import { eventRecord, T0, ulid } from './fixtures.ts'

/** 64 位小写 hex（sha256 文本形态） */
const HASH64 = /^[0-9a-f]{64}$/

interface ChainRow {
  seq: number
  event_id: string
  prev_hash: string
  hash: string
}

function chainRows(db: DatabaseSync): ChainRow[] {
  return db
    .prepare('SELECT seq, event_id, prev_hash, hash FROM events_chain ORDER BY seq')
    .all() as unknown as ChainRow[]
}

function eventCount(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM events').get() as unknown as { c: number }
  return Number(row.c)
}

function chainCount(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM events_chain').get() as unknown as { c: number }
  return Number(row.c)
}

function chainTriggerRows(db: DatabaseSync): Array<{ name: string; sql: string }> {
  return db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'events_chain' ORDER BY name")
    .all() as unknown as Array<{ name: string; sql: string }>
}

/** 断言抛出的事件链拒开错误（fail-closed 的机械形状：含 events-chain 分类） */
function expectChainReject(fn: () => unknown): Error {
  let caught: unknown
  try {
    fn()
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(Error)
  expect((caught as Error).message).toContain('events-chain')
  return caught as Error
}

let root = ''
let ledger: Ledger

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-events-chain-'))
  ledger = openLedger(path.join(root, 'ledger.db'))
})

afterAll(async () => {
  ledger.close()
  await rm(root, { recursive: true, force: true })
})

describe('v16 迁移与链表在库（I-17 哈希链腿的机制面）', () => {
  it('LATEST_VERSION=16；events_chain 表与两枚 append-only 触发器在库', () => {
    expect(LATEST_VERSION).toBe(17)
    expect(eventsChainMigration.version).toBe(16)
    expect(ledger.version()).toBe(17)
    const table = ledger.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'events_chain'")
      .get() as unknown as { name: string } | undefined
    expect(table?.name).toBe('events_chain')
    const triggers = chainTriggerRows(ledger.db)
    expect(triggers.map((t) => String(t.name))).toEqual([
      'trg_events_chain_link',
      'trg_events_chain_no_delete',
      'trg_events_chain_no_update',
    ])
    for (const t of triggers) expect(String(t.sql)).toContain('RAISE(ABORT')
  })
})

describe('追加即链式摘要（appendEvent 唯一写口）', () => {
  it('每条事件恰一行链：prev 指向前一 hash（首条=GENESIS），hash=64 hex', () => {
    const before = chainCount(ledger.db)
    const e1 = eventRecord({ id: ulid(T0, 21), ts: T0 + 21, event: 'DISPATCH' })
    const e2 = eventRecord({ id: ulid(T0, 22), ts: T0 + 22, event: 'GATE_PASS' })
    expect(ledger.appendEvent(e1)).toEqual({ id: e1.id, appended: true })
    expect(ledger.appendEvent(e2)).toEqual({ id: e2.id, appended: true })
    expect(chainCount(ledger.db)).toBe(before + 2)
    expect(chainCount(ledger.db)).toBe(eventCount(ledger.db))

    const rows = chainRows(ledger.db)
    const tail = rows.slice(-2)
    expect(tail[0]?.event_id).toBe(e1.id)
    expect(tail[1]?.event_id).toBe(e2.id)
    for (const row of rows) {
      expect(row.hash).toMatch(HASH64)
      expect(row.prev_hash).toMatch(HASH64)
    }
    const preceding = rows.slice(0, -2)
    expect(tail[0]?.prev_hash).toBe(preceding.length === 0 ? GENESIS_HASH : preceding.at(-1)?.hash)
    expect(tail[1]?.prev_hash).toBe(tail[0]?.hash)
    expect(rows[0]?.prev_hash).toBe(GENESIS_HASH)
  })

  it('同 id 全列一致的重复＝幂等跳过：链不二次增长（不重放摘要）', () => {
    const e = eventRecord({ id: ulid(T0, 23), ts: T0 + 23, event: 'LLM' })
    expect(ledger.appendEvent(e)).toEqual({ id: e.id, appended: true })
    const after = chainCount(ledger.db)
    expect(ledger.appendEvent(e)).toEqual({ id: e.id, appended: false })
    expect(chainCount(ledger.db)).toBe(after)
  })

  it('校验面：全链重算通过，返回事件数与链尾 hash；不修改任何行', () => {
    const report = verifyEventsChain(ledger.db)
    expect(report.events).toBe(eventCount(ledger.db))
    expect(report.tip).toBe(chainRows(ledger.db).at(-1)?.hash)
    // 面方法同源（Ledger.verifyEventsChain 与自由函数同一校验体）
    expect(ledger.verifyEventsChain().tip).toBe(report.tip)
  })
})

describe('链表自身受 append-only 保护（与 events v15 触发器同机制）', () => {
  it('UPDATE / DELETE events_chain 行被 RAISE(ABORT) 拒', () => {
    const tail = chainRows(ledger.db).at(-1)
    expect(tail).toBeDefined()
    if (tail === undefined) return
    expect(() => ledger.db.prepare('UPDATE events_chain SET hash = ? WHERE seq = ?').run('f'.repeat(64), tail.seq)).toThrow(
      /events_chain is append-only/,
    )
    expect(() =>
      ledger.db.prepare('DELETE FROM events_chain WHERE seq = ?').run(tail.seq),
    ).toThrow(/events_chain is append-only/)
  })

  it('插入 prev 不接链尾的行被 RAISE(ABORT) 拒（不得私接分叉链）', () => {
    const tail = chainRows(ledger.db).at(-1)
    expect(tail).toBeDefined()
    if (tail === undefined) return
    expect(() =>
      ledger.db
        .prepare('INSERT INTO events_chain (event_id, prev_hash, hash, created_at) VALUES (?, ?, ?, ?)')
        .run(ulid(T0, 999), 'f'.repeat(64), 'e'.repeat(64), Date.now()),
    ).toThrow(/events_chain link mismatch/)
  })
})

describe('篡改必被校验面判负且拒读（fail-closed，NEG-SEC-03 哈希链负向行）', () => {
  it('改一条历史事件（绕过触发器模拟文件级篡改）→ 重新打开即校验失败并定位到该行', async () => {
    const dbPath = path.join(root, 'tampered-event.db')
    const first = eventRecord({ id: ulid(T0, 31), ts: T0 + 31, event: 'DISPATCH' })
    const second = eventRecord({ id: ulid(T0, 32), ts: T0 + 32, event: 'GATE_PASS' })
    const opened = openLedger(dbPath)
    opened.appendEvent(first)
    opened.appendEvent(second)
    opened.close()

    // 绕过：删掉防改触发器后直接改历史行内容（等价于拿到库文件直改）
    const raw = new DatabaseSync(dbPath)
    raw.exec('DROP TRIGGER trg_events_no_update')
    raw.prepare('UPDATE events SET event = ? WHERE id = ?').run('TAMPER', first.id)
    raw.close()

    // 校验失败＝拒读：openLedger 校验不通过即关闭连接并抛错（不返回句柄）
    const err = expectChainReject(() => openLedger(dbPath))
    expect(err.message).toContain(first.id)
  })

  it('篡改链行本身（改一行 hash）→ 重新打开拒读（断链点定位）', async () => {
    const dbPath = path.join(root, 'tampered-chain.db')
    const a = eventRecord({ id: ulid(T0, 41), ts: T0 + 41, event: 'DISPATCH' })
    const b = eventRecord({ id: ulid(T0, 42), ts: T0 + 42, event: 'GATE_PASS' })
    const opened = openLedger(dbPath)
    opened.appendEvent(a)
    opened.appendEvent(b)
    opened.close()

    const raw = new DatabaseSync(dbPath)
    raw.exec('DROP TRIGGER trg_events_chain_no_update')
    raw.prepare('UPDATE events_chain SET hash = ? WHERE event_id = ?').run('a'.repeat(64), a.id)
    raw.close()

    const err = expectChainReject(() => openLedger(dbPath))
    expect(err.message).toContain(a.id)
  })

  it('未链化追加（绕过 appendEvent 直插 events）→ 重新打开拒读（覆盖缺口）', async () => {
    const dbPath = path.join(root, 'unchained.db')
    const opened = openLedger(dbPath)
    const chained = eventRecord({ id: ulid(T0, 51), ts: T0 + 51, event: 'DISPATCH' })
    opened.appendEvent(chained)
    opened.close()

    const raw = new DatabaseSync(dbPath)
    raw
      .prepare(
        'INSERT INTO events (id, ts, company, issue, event, actor, attempt, level, dept, tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(ulid(T0, 52), T0 + 52, 'studio-dev', 'STUDIO-501', 'LLM', 'AGENT-1:agent-1', 1, 2, 'departments/工程部', '{}')
    raw.close()

    // 未链化事件=覆盖缺口（链不覆盖全部 events）→ 拒开；错误文案由实现给出「未链化」
    const err = expectChainReject(() => openLedger(dbPath))
    expect(err.message).toContain('未链化')
  })
})

describe('升级路径：v15 存量库首次打开时锚定存量事件（空链→补齐，锚定前历史不可证）', () => {
  it('v15 库（events 有行、无链表）→ 打开迁移到 v17 并补齐链', async () => {
    const dbPath = path.join(root, 'legacy-v15.db')
    const legacy = new DatabaseSync(dbPath)
    migrate(legacy, { upTo: 15 })
    const e = eventRecord({ id: ulid(T0, 61), ts: T0 + 61, event: 'LLM' })
    legacy
      .prepare(
        'INSERT INTO events (id, ts, company, issue, event, actor, attempt, level, dept, tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(e.id, e.ts, e.company, e.issue, e.event, e.actor, e.attempt, e.level, e.dept, '{"input":10,"output":5}')
    legacy.close()

    const upgraded = openLedger(dbPath)
    try {
      expect(upgraded.version()).toBe(17)
      expect(chainCount(upgraded.db)).toBe(eventCount(upgraded.db))
      const rows = chainRows(upgraded.db)
      expect(rows[0]?.event_id).toBe(e.id)
      expect(rows[0]?.prev_hash).toBe(GENESIS_HASH)
      expect(verifyEventsChain(upgraded.db).events).toBe(eventCount(upgraded.db))
    } finally {
      upgraded.close()
    }
  })
})

describe('rebuild 兼容：dump → 重建后链可由 events 再生（哈希与行内容同源、与时间戳无关）', () => {
  it('重建库链行数与源库一致、链 hash 序列逐条相同', async () => {
    const source = path.join(root, 'dump.jsonl')
    const target = path.join(root, 'rebuilt.db')
    const dumped = ledger.dumpEvents(source)
    const sourceHashes = chainRows(ledger.db).map((r) => r.hash)
    expect(dumped.lines).toBe(eventCount(ledger.db))

    const result = rebuild(source, target)
    expect(result.version).toBe(17)
    expect(result.events).toBe(dumped.lines)

    const rebuilt = openLedger(target)
    try {
      expect(rebuilt.queryEvents().length).toBe(dumped.lines)
      expect(chainRows(rebuilt.db).map((r) => r.hash)).toEqual(sourceHashes)
      expect(verifyEventsChain(rebuilt.db).events).toBe(dumped.lines)
    } finally {
      rebuilt.close()
    }
  })
})

describe('启动日志证据锚点：真实打开路径在打开时完成校验（daemon 同款 openLedger）', () => {
  it('正常库打开后链数为 0；追加后链数=事件数；dump JSONL 不含链列（重建可再生的前提）', async () => {
    const dbPath = path.join(root, 'fresh-open.db')
    const opened = openLedger(dbPath)
    try {
      expect(chainCount(opened.db)).toBe(0)
      opened.appendEvent(eventRecord({ id: ulid(T0, 81), ts: T0 + 81, event: 'HEARTBEAT' }))
      expect(chainCount(opened.db)).toBe(1)
    } finally {
      opened.close()
    }
    const dumpPath = path.join(root, 'fresh.jsonl')
    const reopened = openLedger(dbPath)
    try {
      reopened.dumpEvents(dumpPath)
    } finally {
      reopened.close()
    }
    const line = (await readFile(dumpPath, 'utf8')).trim()
    expect(line.length).toBeGreaterThan(0)
    expect(Object.keys(JSON.parse(line) as Record<string, unknown>).sort()).not.toContain('hash')
  })
})
