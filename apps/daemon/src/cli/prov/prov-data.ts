/**
 * prov-data —— Airlock provenance 只读取数面（node:sqlite readOnly；零写）
 *
 * 只读 SELECT（不 openLedger——migrate/链锚定会写库）；不写台账/事件/schema；输出由
 * provenance 图派生。表：events / work_records / sessions / ticket_mirror / price_snapshots。
 */
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

export interface ProvEventRow {
  readonly id: string
  readonly ts: number
  readonly issue: string
  readonly event: string
  readonly actor: string
  readonly attempt: number
  readonly dept: string
  readonly note: string | null
  readonly payloadHash: string | null
}
export interface ProvWorkRow {
  readonly issue: string
  readonly personId: string
  readonly executor: string
  readonly sessionId: string | null
  readonly attempt: number
  readonly startedAt: number
  readonly endedAt: number | null
  readonly status: string
  readonly model: string | null
  readonly reportRef: string | null
  readonly summaryRef: string | null
}
export interface ProvSessionRow {
  readonly sessionId: string
  readonly issue: string
  readonly personId: string
  readonly startedAt: number
  readonly endedAt: number | null
  readonly turns: number | null
}
export interface ProvMirrorRow {
  readonly issue: string
  readonly state: string
  readonly type: string
  readonly dept: string
  readonly level: number
  readonly lane: string | null
}
export interface ProvPriceRow {
  readonly provider: string
  readonly model: string
  readonly priceDate: string
  readonly slot: string
  readonly inputPerM: number
  readonly outputPerM: number
}

export interface ProvData {
  readonly events: ProvEventRow[]
  readonly work: ProvWorkRow[]
  readonly sessions: ProvSessionRow[]
  readonly mirror: ProvMirrorRow[]
  readonly prices: ProvPriceRow[]
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0)
}
function str(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}
function optStr(value: unknown): string | null {
  return value === null || value === undefined ? null : str(value)
}

export interface ProvReadOptions {
  /** 事件窗口闭开 [since, until)；缺省全量（trace 用 all-time 保链） */
  readonly since?: number
  readonly until?: number
  /** 单票过滤（trace：只取该 ticket 事件以减载） */
  readonly issue?: string
}

/** 只读取数（readOnly；缺失库显式抛错，不代建） */
export function readProvData(dbPath: string, company: string, options: ProvReadOptions = {}): ProvData {
  if (!existsSync(dbPath)) throw new Error(`台账不存在：${dbPath}（只读面不代建库）`)
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const eventSql = ['SELECT id, ts, issue, event, actor, attempt, dept, note, payload_hash FROM events WHERE company = ?']
    const params: Array<string | number> = [company]
    if (options.since !== undefined) {
      eventSql.push('AND ts >= ?')
      params.push(options.since)
    }
    if (options.until !== undefined) {
      eventSql.push('AND ts < ?')
      params.push(options.until)
    }
    if (options.issue !== undefined) {
      eventSql.push('AND issue = ?')
      params.push(options.issue)
    }
    eventSql.push('ORDER BY issue, ts, id')
    const rawEvents = db.prepare(eventSql.join(' ')).all(...params) as Array<Record<string, unknown>>
    const events = rawEvents.map((r) => ({
      id: str(r['id']),
      ts: num(r['ts']),
      issue: str(r['issue']),
      event: str(r['event']),
      actor: str(r['actor']),
      attempt: num(r['attempt']),
      dept: str(r['dept']),
      note: optStr(r['note']),
      payloadHash: optStr(r['payload_hash']),
    }))
    const issues = [...new Set(events.map((e) => e.issue).filter((i) => i !== '-' && i !== ''))].sort()
    const mirrorRaw = db.prepare('SELECT issue, state, type, dept, level, lane FROM ticket_mirror WHERE company = ? ORDER BY issue').all(company) as Array<Record<string, unknown>>
    const mirror = mirrorRaw.map((r) => ({
      issue: str(r['issue']),
      state: str(r['state']),
      type: str(r['type']),
      dept: str(r['dept']),
      level: num(r['level']),
      lane: optStr(r['lane']),
    }))
    const issueSet = new Set(issues)
    for (const m of mirror) issueSet.add(m.issue)
    const issueList = [...issueSet].sort()
    let work: ProvWorkRow[] = []
    let sessions: ProvSessionRow[] = []
    if (issueList.length > 0) {
      const ph = issueList.map(() => '?').join(',')
      const workWhere = ['issue IN (' + ph + ')']
      const workParams: Array<string | number> = [...issueList]
      if (options.since !== undefined) {
        workWhere.push('started_at >= ?')
        workParams.push(options.since)
      }
      if (options.until !== undefined) {
        workWhere.push('started_at < ?')
        workParams.push(options.until)
      }
      const workRaw = db
        .prepare(`SELECT issue, person_id, executor, session_id, attempt, started_at, ended_at, status, model, report_ref, summary_ref FROM work_records WHERE ${workWhere.join(' AND ')} ORDER BY issue, started_at`)
        .all(...workParams) as Array<Record<string, unknown>>
      work = workRaw.map((r) => ({
        issue: str(r['issue']),
        personId: str(r['person_id']),
        executor: str(r['executor']),
        sessionId: optStr(r['session_id']),
        attempt: num(r['attempt']),
        startedAt: num(r['started_at']),
        endedAt: r['ended_at'] === null || r['ended_at'] === undefined ? null : num(r['ended_at']),
        status: str(r['status']),
        model: optStr(r['model']),
        reportRef: optStr(r['report_ref']),
        summaryRef: optStr(r['summary_ref']),
      }))
      const sessionWhere = ['issue IN (' + ph + ')']
      const sessionParams: Array<string | number> = [...issueList]
      if (options.since !== undefined) {
        sessionWhere.push('started_at >= ?')
        sessionParams.push(options.since)
      }
      if (options.until !== undefined) {
        sessionWhere.push('started_at < ?')
        sessionParams.push(options.until)
      }
      const sessionRaw = db
        .prepare(`SELECT session_id, issue, person_id, started_at, ended_at, turns FROM sessions WHERE ${sessionWhere.join(' AND ')} ORDER BY started_at`)
        .all(...sessionParams) as Array<Record<string, unknown>>
      sessions = sessionRaw.map((r) => ({
        sessionId: str(r['session_id']),
        issue: str(r['issue']),
        personId: str(r['person_id']),
        startedAt: num(r['started_at']),
        endedAt: r['ended_at'] === null || r['ended_at'] === undefined ? null : num(r['ended_at']),
        turns: r['turns'] === null || r['turns'] === undefined ? null : num(r['turns']),
      }))
    }
    const priceRaw = db
      .prepare('SELECT provider, model, price_date, slot, input_per_m, output_per_m FROM price_snapshots WHERE company = ? ORDER BY price_date, provider, model')
      .all(company) as Array<Record<string, unknown>>
    const prices = priceRaw.map((r) => ({
      provider: str(r['provider']),
      model: str(r['model']),
      priceDate: str(r['price_date']),
      slot: str(r['slot']),
      inputPerM: num(r['input_per_m']),
      outputPerM: num(r['output_per_m']),
    }))
    return { events, work, sessions, mirror, prices }
  } finally {
    db.close()
  }
}


/**
 * `--from` 锚点时间（impact 默认窗口 [anchor−24h, anchor+24h]）：
 * 支持 alert:/ticket: 前缀、裸 ticket、裸事件 id（ULID）；未知=null。只读 SELECT。
 */
export function findProvAnchorTime(dbPath: string, company: string, from: string): number | null {
  if (!existsSync(dbPath)) throw new Error(`台账不存在：${dbPath}（只读面不代建库）`)
  const rawFrom = from.startsWith('ticket:') ? from.slice('ticket:'.length) : from.startsWith('alert:') ? from.slice('alert:'.length) : from
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const byId = db.prepare('SELECT ts FROM events WHERE company = ? AND id = ? LIMIT 1').get(company, rawFrom) as Record<string, unknown> | undefined
    if (byId !== undefined) return num(byId['ts'])
    const byIssue = db.prepare('SELECT MIN(ts) AS min_ts, MAX(ts) AS max_ts FROM events WHERE company = ? AND issue = ?').get(company, rawFrom) as Record<string, unknown> | undefined
    const maxTs = byIssue === undefined || byIssue['max_ts'] === null ? null : num(byIssue['max_ts'])
    if (maxTs !== null) return maxTs
    const mirror = db.prepare('SELECT updated FROM ticket_mirror WHERE company = ? AND issue = ? LIMIT 1').get(company, rawFrom) as Record<string, unknown> | undefined
    return mirror === undefined ? null : num(mirror['updated'])
  } finally {
    db.close()
  }
}
