/**
 * events —— events 表读写面 + 哈希链导出（自 ledger.ts 原样拆出，零行为变更；
 * BC-S2「先拆再增」同纪律：132-C 增面时按只减不增清偿 ledger.ts 尺寸）
 *
 * 表 DDL 归 migrations v1（events）/ v16（events_chain）；append-only 纪律：本面是 events
 * 唯一写口（appendEvent），链摘要＋链行/事件行 SAVEPOINT 原子（v16），无 UPDATE/DELETE 路径。
 * db 由 openLedger 唯一持有并注入——本模块不建连接、不留状态（face 共享同一句柄）。
 */
import { writeFileSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { configInvalid, validateEventRecord, type EventRecord, type ValidationIssue } from '@studio-next/contract'
import { excludedDomainRefs, type ExcludedDomainRef } from '../backup.ts'
import { GENESIS_HASH, computeEventHash, verifyEventsChain, type EventsChainReport } from '../events-chain.ts'
import { sameEvent } from '../event-compare.ts'
import { rowToEvent, type SqlRow } from '../row-helpers.ts'
import { errorMessage, type AppendResult } from './shared.ts'

/**
 * events 查询面：全部条件可选，ts 双端闭区间。行序缺省升序（ts, id 稳定序）；
 * order='desc' 时倒序（ts, id 同刻稳定序的镜像反序），与 limit 组合=「最近 N 条」。
 */
export interface EventQuery {
  company?: string
  issue?: string
  /** ts >= since（闭端，epoch ms） */
  since?: number
  /** ts <= until（闭端，epoch ms） */
  until?: number
  limit?: number
  /**
   * 行序（缺省 'asc'）。索引兼容性：company 过滤 + desc 走 idx_events_company_ts
   * (company, ts) 反向扫描（SQLite B-tree 索引双向可走，无新索引需求）；issue 过滤走
   * idx_events_issue 定位后按 (ts,id) 排序；无过滤面全表排序（与 asc 同量级，量大后
   * 再评估独立 ts 索引——拟稿，见 index.ts 疑点清单）。
   */
  order?: 'asc' | 'desc'
}

/** dumpEvents 结果：写出行数（与库内 events 计数一致）；排除域=未入导出/重放路径的域（DOM-04） */
export interface DumpResult {
  lines: number
  excludedDomains: readonly ExcludedDomainRef[]
}

/** events 读写面（Ledger extends 本面——方法名恒平，ledger.ts 摊入） */
export interface EventsFace {
  /** events 唯一写口：契约校验 → 链式摘要（v16）→ 链行+事件行 SAVEPOINT 原子插入（append-only） */
  appendEvent(record: unknown): AppendResult
  /** events 查询面（缺省升序；order='desc' 倒序——desc+limit=「最近 N 条」，见 EventQuery） */
  queryEvents(query?: EventQuery): EventRecord[]
  /**
   * 链序增量读面（studio-dev-785）：按 events_chain.seq 取链序在给定 seq 之后的事件（跨 ts 回填安全——
   * append-only 不保证 ts 单调，链 seq 是唯一权威顺序）。返回 seq+event 对，供事件索引增量累积器用。
   */
  queryEventsAfterChainSeq(seq: number): Array<{ readonly seq: number; readonly event: EventRecord }>
  /** 链尾 seq（=事件数；链无空洞自增）；用于增量游标/回退判定 */
  eventsChainTipSeq(): number
  /**
   * 事件哈希链全量重算校验（I-17／SEC-FC-04；审计/读命令面）：链断、内容不符、未覆盖事件
   * → CONFIG_INVALID（fail-closed，detail 带 seq/event id）。打开时已自动校验一次；长跑进程
   * 可按拍/按需复算（本面必读全表，非每读路径的默认前置）。
   */
  verifyEventsChain(): EventsChainReport
  /** events 全量 → JSONL（逐行含 ULID；F2-11 库→JSONL 单向派生；链列不入导出） */
  dumpEvents(path: string): DumpResult
}

/** tokens 四桶 canonical 序（F2-04 列名序）：同内容恒同字节串 */
const TOKEN_BUCKET_ORDER = ['input', 'output', 'cache_read', 'cache_creation'] as const

function canonicalTokens(tokens: EventRecord['tokens']): string {
  const parts: string[] = []
  for (const key of TOKEN_BUCKET_ORDER) {
    const v = tokens[key]
    if (v !== undefined) parts.push(`"${key}":${v}`)
  }
  return `{${parts.join(',')}}`
}


// —— 行 ↔ 记录映射（events；v16 起单一源落 row-helpers.ts，写面/链校验面共用） ——

const INSERT_EVENT_SQL = `INSERT INTO events (
  id, ts, company, issue, event, actor, attempt, level, dept,
  correlation_id, causation_id, tokens, cost_usd, duration_ms, size, payload_hash, note
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

/** 入账前契约闸：非法 record → ClassifiedError(CONFIG_INVALID)（拒非法入账，第一道闸） */
function assertValidEvent(record: unknown): asserts record is EventRecord {
  const outcome = validateEventRecord(record)
  if (!outcome.ok) {
    const first = outcome.issues[0] as ValidationIssue | undefined
    const path = first === undefined ? '(root)' : first.path
    const brief = outcome.issues
      .slice(0, 3)
      .map((i) => `${i.path}: ${i.message}`)
      .join('；')
    configInvalid(`evt/invalid:${path}`, brief)
  }
}

/** events 面工厂（openLedger 唯一组装点摊入；db=同一句柄，不复制连接/状态） */
export function createEventsFace(db: DatabaseSync): EventsFace {
  const appendEvent = (record: unknown): AppendResult => {
    assertValidEvent(record)
    // 幂等规则：同 id 已存在 → 全列一致跳过，不一致抛错（F2-13 回填幂等；拟稿待批）
    const existing = db
      .prepare('SELECT * FROM events WHERE id = ?')
      .get(record.id) as SqlRow | undefined
    if (existing !== undefined) {
      const same = rowToEvent(existing)
      if (sameEvent(same, record)) return { id: record.id, appended: false }
      configInvalid(
        'store/evt:duplicate-id',
        `事件 id=${record.id} 已存在且内容不一致（append-only，拒绝覆盖语义的重复入账）`,
      )
    }
    // v16 哈希链：先插链行（触发器校验 prev=链尾）再插 events，SAVEPOINT 原子——
    // 任一步失败整段回滚＝拒写（fail-closed）；链摘要覆盖整条记录内容 + 前驱 hash。
    const tail = db.prepare('SELECT hash FROM events_chain ORDER BY seq DESC LIMIT 1').get() as
      | { hash: unknown }
      | undefined
    const prevHash = tail === undefined ? GENESIS_HASH : String(tail.hash)
    const hash = computeEventHash(prevHash, record)
    db.exec('SAVEPOINT store_append_event')
    try {
      db.prepare('INSERT INTO events_chain (event_id, prev_hash, hash, created_at) VALUES (?, ?, ?, ?)').run(
        record.id,
        prevHash,
        hash,
        Date.now(),
      )
      db.prepare(INSERT_EVENT_SQL).run(
        record.id,
        record.ts,
        record.company,
        record.issue,
        record.event,
        record.actor,
        record.attempt,
        record.level,
        record.dept,
        record.correlation_id ?? null,
        record.causation_id ?? null,
        canonicalTokens(record.tokens),
        record.cost_usd ?? null,
        record.duration_ms ?? null,
        record.size ?? null,
        record.payload_hash ?? null,
        record.note ?? null,
      )
      db.exec('RELEASE store_append_event')
    } catch (err) {
      db.exec('ROLLBACK TO store_append_event')
      db.exec('RELEASE store_append_event')
      configInvalid(
        'store/events-chain:append-rejected',
        `事件 ${record.id} 链式入账失败（链断裂/触发器拒绝——整条回滚，拒写）：${errorMessage(err)}`,
      )
    }
    return { id: record.id, appended: true }
  }

  const queryEvents = (query: EventQuery = {}): EventRecord[] => {
    // order 白名单闸：方向内插进 SQL（无法参数化绑定），非 'asc'|'desc' 即 CONFIG_INVALID——
    // TS 字面量类型挡编译期，运行期（JS 调用方/配置驱动）仍须如实拒
    if (query.order !== undefined && query.order !== 'asc' && query.order !== 'desc') {
      configInvalid('store/evt:bad-order', `order=${String(query.order)} 须为 'asc' | 'desc'`)
    }
    const dir = query.order === 'desc' ? 'DESC' : 'ASC'
    const where: string[] = []
    const params: Array<string | number> = []
    if (query.company !== undefined) {
      where.push('company = ?')
      params.push(query.company)
    }
    if (query.issue !== undefined) {
      where.push('issue = ?')
      params.push(query.issue)
    }
    if (query.since !== undefined) {
      where.push('ts >= ?')
      params.push(query.since)
    }
    if (query.until !== undefined) {
      where.push('ts <= ?')
      params.push(query.until)
    }
    let sql = 'SELECT * FROM events'
    if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`
    // desc 是 asc 的镜像反序（ts,id 双列同向取反）——同集两序互为 reverse，desc+limit=最近 N 条
    sql += ` ORDER BY ts ${dir}, id ${dir}`
    if (query.limit !== undefined) {
      sql += ' LIMIT ?'
      params.push(query.limit)
    }
    const rows = db.prepare(sql).all(...params) as SqlRow[]
    return rows.map(rowToEvent)
  }

  const queryEventsAfterChainSeq = (seq: number): Array<{ seq: number; event: EventRecord }> => {
    const rows = db
      .prepare(
        'SELECT c.seq AS chain_seq, e.* FROM events_chain c JOIN events e ON e.id = c.event_id WHERE c.seq > ? ORDER BY c.seq',
      )
      .all(seq) as SqlRow[]
    return rows.map((row) => ({ seq: Number(row['chain_seq']), event: rowToEvent(row) }))
  }
  const eventsChainTipSeq = (): number => {
    const row = db.prepare('SELECT MAX(seq) AS seq FROM events_chain').get() as { seq?: unknown } | undefined
    return Number(row?.seq ?? 0)
  }

  const dumpEvents = (path: string): DumpResult => {
    const rows = db.prepare('SELECT * FROM events ORDER BY ts ASC, id ASC').all() as SqlRow[]
    // 同步写（daemon 单写入者，无并发写面）；行序 = ts,id 升序，行字节由 canonical 序列化保证确定
    writeFileSync(path, rows.map((row) => JSON.stringify(rowToEvent(row))).join('\n') + (rows.length > 0 ? '\n' : ''), 'utf8')
    return { lines: rows.length, excludedDomains: excludedDomainRefs() }
  }
  return {
    appendEvent,
    queryEvents,
    queryEventsAfterChainSeq,
    eventsChainTipSeq,
    verifyEventsChain: () => verifyEventsChain(db),
    dumpEvents,
  }
}
