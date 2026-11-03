/**
 * reports —— v6 报表三表读写面（ledgers 单据派生镜像 / reports 报表快照行；自 ledger.ts
 * 原样拆出，零行为变更）
 *
 * 表 DDL 归 migrations v6（17-§3 / docs/50 断链6 / 04-§三）：ledgers 复合主键 (issue, kind)
 * last-write-wins 覆盖（权威源在单据，本表可重建）；reports 自然键 (company,node,type,date)
 * 唯一——同键新 id 覆盖换代、同 id 异内容拒（appendEvent 口径）。
 * db 由 openLedger 唯一持有并注入，本模块不建连接、不留状态。
 */
import type { DatabaseSync } from 'node:sqlite'
import { configInvalid } from '@studio-next/contract'
import {
  LEDGER_KIND_VALUES,
  LedgerEntrySchema,
  REPORT_TYPE_VALUES,
  ReportRecordSchema,
  type LedgerEntryRecord,
  type LedgerKind,
  type ReportRecord,
  type ReportType,
} from '../records.ts'
import { assertRecord, str, type SqlRow } from '../row-helpers.ts'
import { errorMessage, type AppendResult } from './shared.ts'

/** 报表三表读写面（Ledger extends 本面——方法名恒平，ledger.ts 摊入） */
export interface ReportsFace {
  // —— v6 报表三表读写面（17-§3 / docs/50 断链6 / 04-§三；daemon/报表聚合管线消费） ——
  /**
   * ledgers 单据派生镜像 upsert（复合主键 (issue, kind)，last-write-wins——权威源在单据，
   * 本表可重建，同 upsertTicketMirror 口径）。body 序列化闸：不可 JSON 序列化 →
   * CONFIG_INVALID（同 serializeVerification 风格）。返回落库后的记录形状。
   */
  upsertLedgerEntry(record: unknown): LedgerEntryRecord
  /** 按 (issue, kind) 双键取单据派生行；无此行=undefined */
  getLedgerEntry(issue: string, kind: LedgerKind): LedgerEntryRecord | undefined
  /** 单据派生行列表（updated 升序，同刻按 issue/kind 稳定序）；issue / kind 可选过滤（kind 枚举外值拒） */
  listLedgerEntries(query?: { issue?: string; kind?: LedgerKind }): LedgerEntryRecord[]
  /**
   * reports 报表快照行落库（自然键 (company, node, type, date) 唯一——04-§三渲染约定的
   * 机制化）：同自然键同 id 全列一致 → 幂等跳过（appended=false）；同自然键**新 id** →
   * 覆盖换代（id/caliber/json_ref 随新值，最新快照胜——历史在文件与 REPORT_* 事件）；
   * 同 id 异自然键或同 id 内容不一致 → CONFIG_INVALID（id 全局唯一语义，拒改口供）。
   */
  insertReport(record: unknown): AppendResult
  /** 按 id 取报表行；无此行=undefined */
  getReport(id: string): ReportRecord | undefined
  /** 报表行列表（date, id 升序）；company / node / type 可选过滤（type 枚举外值拒） */
  listReports(query?: { company?: string; node?: string; type?: ReportType }): ReportRecord[]
}

/** reports 面工厂（openLedger 唯一组装点摊入；db=同一句柄，不复制连接/状态） */
export function createReportsFace(db: DatabaseSync): ReportsFace {
  // —— v6 报表三表读写面（17-§3 / docs/50 断链6 / 04-§三） ——

  /** ledgers.body 序列化（serializeVerification 同风格：不可序列化 → CONFIG_INVALID，不入账） */
  const serializeLedgerBody = (body: unknown, issue: string, kind: string): string => {
    try {
      const serialized = JSON.stringify(body)
      if (serialized === undefined) {
        configInvalid('store/ledger-entry:body-unserializable', `单据 ${issue}/${kind} body 含不可 JSON 序列化的值`)
      }
      return serialized
    } catch (err) {
      configInvalid('store/ledger-entry:body-unserializable', `单据 ${issue}/${kind} body 不可序列化：${errorMessage(err)}`)
    }
  }

  const rowToLedgerEntry = (row: SqlRow): LedgerEntryRecord => ({
    issue: str(row, 'issue'),
    kind: str(row, 'kind') as LedgerKind,
    body: JSON.parse(str(row, 'body')) as unknown,
    updated: Number(row['updated']),
  })

  const rowToReport = (row: SqlRow): ReportRecord => ({
    id: str(row, 'id'),
    company: str(row, 'company'),
    node: str(row, 'node'),
    type: str(row, 'type') as ReportType,
    date: str(row, 'date'),
    caliber: str(row, 'caliber'),
    json_ref: str(row, 'json_ref'),
  })

  const upsertLedgerEntry = (record: unknown): LedgerEntryRecord => {
    const r = assertRecord(LedgerEntrySchema, record, 'store/ledger-entry:invalid')
    const bodyJson = serializeLedgerBody(r.body, r.issue, r.kind)
    // last-write-wins 覆盖（单据派生镜像可重建——同 upsertTicketMirror 口径；单写者=daemon，
    // 无并发面）。幂等同写自然落 UPDATE 同值，调用方可比对返回值。
    db.prepare(
      `INSERT INTO ledgers (issue, kind, body, updated) VALUES (?, ?, ?, ?)
       ON CONFLICT (issue, kind) DO UPDATE SET body = excluded.body, updated = excluded.updated`,
    ).run(r.issue, r.kind, bodyJson, r.updated)
    const row = db.prepare('SELECT * FROM ledgers WHERE issue = ? AND kind = ?').get(r.issue, r.kind) as SqlRow
    return rowToLedgerEntry(row)
  }

  /** kind 运行期值域闸（TS 字面量挡编译期，JS 调用方如实拒——listBudgets kinds 闸同风格） */
  const isLedgerKind = (v: unknown): v is LedgerKind => (LEDGER_KIND_VALUES as readonly string[]).includes(v as string)

  const getLedgerEntry = (issue: string, kind: LedgerKind): LedgerEntryRecord | undefined => {
    const row = db.prepare('SELECT * FROM ledgers WHERE issue = ? AND kind = ?').get(issue, kind) as SqlRow | undefined
    return row === undefined ? undefined : rowToLedgerEntry(row)
  }

  const listLedgerEntries = (query: { issue?: string; kind?: LedgerKind } = {}): LedgerEntryRecord[] => {
    if (query.kind !== undefined && !isLedgerKind(query.kind)) {
      configInvalid('store/ledgers:bad-kind', `kind=${String(query.kind)} 枚举外（值域 ${LEDGER_KIND_VALUES.join('/')}）`)
    }
    const where: string[] = []
    const params: Array<string | number> = []
    if (query.issue !== undefined) {
      where.push('issue = ?')
      params.push(query.issue)
    }
    if (query.kind !== undefined) {
      where.push('kind = ?')
      params.push(query.kind)
    }
    let sql = 'SELECT * FROM ledgers'
    if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`
    sql += ' ORDER BY updated ASC, issue ASC, kind ASC'
    return (db.prepare(sql).all(...params) as SqlRow[]).map(rowToLedgerEntry)
  }

  const insertReport = (record: unknown): AppendResult => {
    const r = assertRecord(ReportRecordSchema, record, 'store/report:invalid')
    // 同 id 全列一致幂等跳过 / 内容不一致拒（id 全局唯一语义——appendEvent 口径）；
    // 同自然键 (company,node,type,date) 异 id → 覆盖换代（快照最新胜，04-§三渲染键稳定）。
    const byId = db.prepare('SELECT * FROM reports WHERE id = ?').get(r.id) as SqlRow | undefined
    if (byId !== undefined) {
      const same = rowToReport(byId)
      if (sameReport(same, r)) return { id: r.id, appended: false }
      configInvalid(
        'store/reports:id-conflict',
        `报表 id=${r.id} 已存在且内容不一致（同 id 异自然键/异内容均拒——换内容用新 id 落，自然键覆盖走新 id 路径）`,
      )
    }
    const byNatural = db
      .prepare('SELECT * FROM reports WHERE company = ? AND node = ? AND type = ? AND date = ?')
      .get(r.company, r.node, r.type, r.date) as SqlRow | undefined
    if (byNatural !== undefined) {
      db.prepare('UPDATE reports SET id = ?, caliber = ?, json_ref = ? WHERE company = ? AND node = ? AND type = ? AND date = ?').run(
        r.id,
        r.caliber,
        r.json_ref,
        r.company,
        r.node,
        r.type,
        r.date,
      )
      return { id: r.id, appended: true }
    }
    db.prepare('INSERT INTO reports (id, company, node, type, date, caliber, json_ref) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      r.id,
      r.company,
      r.node,
      r.type,
      r.date,
      r.caliber,
      r.json_ref,
    )
    return { id: r.id, appended: true }
  }

  /** 记录级全列比对（reports 幂等判据） */
  function sameReport(a: ReportRecord, b: ReportRecord): boolean {
    return (
      a.id === b.id &&
      a.company === b.company &&
      a.node === b.node &&
      a.type === b.type &&
      a.date === b.date &&
      a.caliber === b.caliber &&
      a.json_ref === b.json_ref
    )
  }

  /** type 运行期值域闸（listReports 查询参数；字面量类型挡编译期，JS 调用方如实拒） */
  const isReportType = (v: unknown): v is ReportType => (REPORT_TYPE_VALUES as readonly string[]).includes(v as string)

  const listReports = (query: { company?: string; node?: string; type?: ReportType } = {}): ReportRecord[] => {
    if (query.type !== undefined && !isReportType(query.type)) {
      configInvalid('store/reports:bad-type', `type=${String(query.type)} 枚举外（值域 ${REPORT_TYPE_VALUES.join('/')}——04-§三三档）`)
    }
    const where: string[] = []
    const params: Array<string | number> = []
    if (query.company !== undefined) {
      where.push('company = ?')
      params.push(query.company)
    }
    if (query.node !== undefined) {
      where.push('node = ?')
      params.push(query.node)
    }
    if (query.type !== undefined) {
      where.push('type = ?')
      params.push(query.type)
    }
    let sql = 'SELECT * FROM reports'
    if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`
    sql += ' ORDER BY date ASC, id ASC'
    return (db.prepare(sql).all(...params) as SqlRow[]).map(rowToReport)
  }
  return {
    upsertLedgerEntry,
    getLedgerEntry,
    listLedgerEntries,
    insertReport,
    getReport: (id: string) => {
      const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(id) as SqlRow | undefined
      return row === undefined ? undefined : rowToReport(row)
    },
    listReports,
  }
}
