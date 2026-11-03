/**
 * events-chain —— v16：events 哈希链（I-17 防篡改「哈希链或等价物」腿；SEC-FC-04 哈希链腿）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/01 §三 I-17：事实与证据材料的记录链可核验——修改必留痕且留痕不可由记录者单独清除；
 *     记录链防篡改（哈希链或等价物）在本刀由「目标（未证）」转为机制（GAP-V2-05 残余收口）；
 *   - docs/v2/15 §一 SEC-FC-04：v15 触发器已落「改/删 events 必被拒」这一腿；本文件补哈希链腿，
 *     与行级触发器**语义衔接不重复**——触发器管「不能改」，链管「改了必被发现且拒读」；
 *   - docs/v2/17 §一 I-17 行／§三 NEG-SEC-03；docs/v2/08 §七.4（防篡改目标）；
 *   - docs/17-§2（主循环七相位）／§6（收割四要件：终态事件＋输出＋REPORT＋闸门）——七相位与
 *     收割落账都锚在 events 账上，本链即该账「顺序＋内容一致性」的机械校验面；
 *   - plan/05 IMPL-04-02（v15 触发器腿）的后续波；GAP-V2-05 哈希链腿。
 *
 * 机制（v16）：
 *   - `events_chain` 每事件恰一行：`seq` 自增序、`event_id` 唯一、`prev_hash` 接前一行 `hash`、
 *     `hash = sha256("studio-next/events-chain/v1\n" + prev_hash + "\n" + canonical(record))`；
 *   - 写面：`ledger.appendEvent` 在 SAVEPOINT 内先插链行（触发器校验 prev=链尾）再插 events 行，
 *     任一步失败整段回滚=拒写（fail-closed）；
 *   - 读面：`openLedger` 迁移后 `anchorEventsChain`（首次锚定 ＋ 全量重算校验），校验失败关闭连接
 *     并告警=拒读；`verifyEventsChain` 供审计/读命令显式复算（错误 detail 带链 seq 与 event id，
 *     定位到行）；
 *   - 链表自身：UPDATE/DELETE 由触发器 RAISE(ABORT) 拒（与 events v15 同机制）；插入 prev 不接
 *     链尾的行同样被拒（不得私接分叉链）。
 *
 * 诚实边界（不得据此宣称「不可篡改」，docs/v2/00 §五-4 标注纪律）：
 *   - 链只证「自锚定以来库内顺序与内容一致」；**锚定前**（v15 及更早存量行）在首次打开时按库内
 *     现状补链——锚定前发生的篡改不可判（packages/store/src/records-migrations.ts v15 头注的
 *     「未证」边界自此收窄而非消失）；
 *   - 持有库文件写权限者可对整链重算（哈希链≠签名/外部锚）——外部锚/签名/透明服务归后续波；
 *   - 行级触发器不拦 `DROP TABLE`（v15 既有边界）；重建路径＝events 重放→链再生成（`dumpEvents`
 *     的 JSONL 不含链列，F2-11 字节面不变）。
 */
import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { configInvalid, type EventRecord } from '@studio-next/contract'
import { rowToEvent, type SqlRow } from './row-helpers.ts'
import type { Migration } from './migrations.ts'

/** 链首前驱（首条链行的 prev_hash；64 位 hex 常量，与 SQL 触发器内字面量同源） */
export const GENESIS_HASH = '0'.repeat(64)

/** 链摘要域分隔符（口径版本化：改摘要口径=新版本前缀，防历史链误判） */
const HASH_DOMAIN = 'studio-next/events-chain/v1'

/** 校验面返回（通过才返回；失败抛 CONFIG_INVALID，无「部分通过」形态） */
export interface EventsChainReport {
  /** 链覆盖的事件行数（=events 行数） */
  events: number
  /** 链尾 hash（外部锚/对账可比对） */
  tip: string
}

/** 表行数（表名是封闭字面量联合，无注入面） */
function countRows(db: DatabaseSync, table: 'events' | 'events_chain'): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: unknown } | undefined
  return Number(row?.c ?? 0)
}

/**
 * 记录级 canonical JSON（递归键排序、丢 undefined）：同内容恒同字节串——链摘要不随对象键序/
 * 可选字段缺省形态漂移（tokens 四桶无论输入序如何均同摘要）。
 */
function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value)
    case 'number':
      if (!Number.isFinite(value)) {
        configInvalid('store/events-chain:non-finite-number', `链摘要不接受非有限数值：${String(value)}`)
      }
      return JSON.stringify(value)
    case 'undefined':
      return 'null'
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`
      const record = value as Record<string, unknown>
      const parts: string[] = []
      for (const key of Object.keys(record).sort()) {
        const v = record[key]
        if (v === undefined) continue
        parts.push(`${JSON.stringify(key)}:${canonicalJson(v)}`)
      }
      return `{${parts.join(',')}}`
    }
    default:
      configInvalid('store/events-chain:unserializable', `链摘要不接受 ${typeof value} 类型值`)
  }
}

/** 单条链摘要：sha256(域分隔 + prev_hash + canonical(record))——与存储列无关，重建可复算 */
export function computeEventHash(prevHash: string, record: EventRecord): string {
  const payload = `${HASH_DOMAIN}\n${prevHash}\n${canonicalJson(record)}`
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

/**
 * 全量重算校验（审计/读命令面）：链断、内容不符、链行指向不存在事件、未覆盖事件——任一命中即
 * CONFIG_INVALID（fail-closed，detail 带 seq/event id 定位到行）。
 */
export function verifyEventsChain(db: DatabaseSync): EventsChainReport {
  const eventTotal = countRows(db, 'events')
  const chainTotal = countRows(db, 'events_chain')
  if (eventTotal !== chainTotal) {
    configInvalid(
      'store/events-chain:uncovered-events',
      `链覆盖缺口：events=${eventTotal} 行 / events_chain=${chainTotal} 行——未链化行不可读（fail-closed）`,
    )
  }
  const rows = db
    .prepare(
      [
        "SELECT c.seq AS seq, c.event_id AS event_id, c.prev_hash AS chain_prev, c.hash AS chain_hash,",
        '  e.id AS id, e.ts AS ts, e.company AS company, e.issue AS issue, e.event AS event,',
        '  e.actor AS actor, e.attempt AS attempt, e.level AS level, e.dept AS dept,',
        '  e.correlation_id AS correlation_id, e.causation_id AS causation_id, e.tokens AS tokens,',
        '  e.cost_usd AS cost_usd, e.duration_ms AS duration_ms, e.size AS size,',
        '  e.payload_hash AS payload_hash, e.note AS note',
        'FROM events_chain c LEFT JOIN events e ON e.id = c.event_id',
        'ORDER BY c.seq',
      ].join(' '),
    )
    .all() as SqlRow[]
  let prev = GENESIS_HASH
  for (const row of rows) {
    const seq = Number(row['seq'])
    const eventId = String(row['event_id'])
    if (row['id'] === null || row['id'] === undefined) {
      configInvalid(
        'store/events-chain:orphan-chain-row',
        `链行 seq=${seq} 指向不存在的事件 ${eventId}——链条目悬空，拒绝读取（fail-closed）`,
      )
    }
    const chainPrev = String(row['chain_prev'])
    if (chainPrev !== prev) {
      configInvalid(
        'store/events-chain:broken-link',
        `链断裂：seq=${seq} event=${eventId} 的 prev_hash 不接链尾（期望 ${prev}，实际 ${chainPrev}）——拒绝读取（fail-closed）`,
      )
    }
    const expected = computeEventHash(prev, rowToEvent(row))
    const stored = String(row['chain_hash'])
    if (stored !== expected) {
      configInvalid(
        'store/events-chain:hash-mismatch',
        `链内容不符：seq=${seq} event=${eventId} 的事件内容与链摘要不一致（疑似篡改）——拒绝读取（fail-closed）`,
      )
    }
    prev = expected
  }
  if (eventTotal > 0) {
    // 计数相等不等于覆盖（链行可指向同一/不存在事件）：反向核对每个事件都有链行
    const missing = db
      .prepare(
        'SELECT e.id AS id FROM events e LEFT JOIN events_chain c ON c.event_id = e.id WHERE c.event_id IS NULL LIMIT 3',
      )
      .all() as SqlRow[]
    if (missing.length > 0) {
      configInvalid(
        'store/events-chain:uncovered-events',
        `未覆盖事件（无链行）：${missing.map((row) => String(row['id'])).join('、')}——链不覆盖全部 events，拒绝读取（fail-closed）`,
      )
    }
  }
  return { events: eventTotal, tip: prev }
}

/**
 * 首次锚定：空链＋存量事件（v15 升级库）→ 按 (ts, id) 升序补链（单事务，任一行失败整体回滚）。
 * 语义边界：补的是「打开时刻库内现状」，锚定前的篡改不可判（见文件头注诚实边界）。
 */
export function backfillEventsChain(db: DatabaseSync): number {
  const rows = db.prepare('SELECT * FROM events ORDER BY ts ASC, id ASC').all() as SqlRow[]
  const insert = db.prepare('INSERT INTO events_chain (event_id, prev_hash, hash, created_at) VALUES (?, ?, ?, ?)')
  const now = Date.now()
  let prev = GENESIS_HASH
  db.exec('SAVEPOINT events_chain_anchor')
  try {
    for (const row of rows) {
      const record = rowToEvent(row)
      const hash = computeEventHash(prev, record)
      insert.run(record.id, prev, hash, now)
      prev = hash
    }
    db.exec('RELEASE events_chain_anchor')
  } catch (err) {
    db.exec('ROLLBACK TO events_chain_anchor')
    db.exec('RELEASE events_chain_anchor')
    throw err
  }
  return rows.length
}

/**
 * 打开时锚定＋校验（`openLedger` 调用）：空链有存量→补链；随后全量校验（含覆盖核对）。
 * 返回报告；失败抛 CONFIG_INVALID（调用方关闭连接并告警=拒读）。
 */
export function anchorEventsChain(db: DatabaseSync): EventsChainReport {
  const events = countRows(db, 'events')
  const chained = countRows(db, 'events_chain')
  if (chained === 0 && events > 0) backfillEventsChain(db)
  return verifyEventsChain(db)
}

/**
 * v16：events 哈希链表＋链表 append-only/接链触发器（I-17 哈希链腿；SEC-FC-04）
 *
 * 为什么单开表而不是给 events 加列：v1 events 建表体 sha8 已锁（改 DDL 会让存量库 CONFIG_INVALID
 * 拒开，见 records-migrations.ts v15 头注），且链行是「事件之后的派生证据」——单表可重建、可审计、
 * 不动 events 契约列。
 */
export const eventsChainMigration: Migration = {
  version: 16,
  name: 'MIG-04 events 哈希链（I-17；SEC-FC-04 哈希链腿；v16）',
  sql: [
    'CREATE TABLE events_chain (',
    '  seq INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  event_id TEXT NOT NULL UNIQUE,',
    '  prev_hash TEXT NOT NULL CHECK (length(prev_hash) = 64),',
    '  hash TEXT NOT NULL UNIQUE CHECK (length(hash) = 64),',
    '  created_at INTEGER NOT NULL',
    ');',
    'CREATE INDEX idx_events_chain_created ON events_chain (created_at);',
    'CREATE TRIGGER trg_events_chain_no_update BEFORE UPDATE ON events_chain BEGIN',
    "  SELECT RAISE(ABORT, 'events_chain is append-only');",
    'END;',
    'CREATE TRIGGER trg_events_chain_no_delete BEFORE DELETE ON events_chain BEGIN',
    "  SELECT RAISE(ABORT, 'events_chain is append-only');",
    'END;',
    'CREATE TRIGGER trg_events_chain_link BEFORE INSERT ON events_chain',
    `WHEN NEW.prev_hash <> COALESCE((SELECT hash FROM events_chain ORDER BY seq DESC LIMIT 1), '${GENESIS_HASH}')`,
    'BEGIN',
    "  SELECT RAISE(ABORT, 'events_chain link mismatch');",
    'END;',
    '',
  ].join('\n'),
}
