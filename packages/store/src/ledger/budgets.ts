/**
 * budgets —— 预算三节点账读写面（reserve / settle / refusal；自 ledger.ts 原样拆出，
 * 零行为变更）
 *
 * 表 DDL 归 migrations v2；append-only 写口（appendBudget 同 id 幂等规则对齐 appendEvent），
 * 读面 queryBudgets（scope 二维定位）+ listBudgets（无 scope 维全量面）。db 由 openLedger
 * 唯一持有并注入，本模块不建连接、不留状态。
 */
import type { DatabaseSync } from 'node:sqlite'
import { configInvalid } from '@studio-next/contract'
import { BudgetRecordSchema, type BudgetRecord } from '../records.ts'
import { assertRecord, optNum, str, type SqlRow } from '../row-helpers.ts'
import { canonicalJson, type AppendResult } from './shared.ts'

/** budgets 查询面：scope 二元组（scope_kind + scope_id 联合定位一个预算主体） */
export interface BudgetScope {
  scope_kind: BudgetRecord['scope_kind']
  scope_id: string
}

/**
 * budgets 全量读面参数（无 scope 维；panel 成本卡「列全部 budgets」缺口的库侧落点）：
 * 全部可选；since/until 对 ts 双端闭区间（对齐 queryEvents 语义）；kinds 为
 * 'reserve'|'settle'|'refusal' 子集过滤（省略或空数组=不过滤；枚举外值 → CONFIG_INVALID）。
 */
export interface BudgetListQuery {
  /** ts >= since（闭端，epoch ms） */
  since?: number
  /** ts <= until（闭端，epoch ms） */
  until?: number
  kinds?: BudgetRecord['kind'][]
}

/** 预算账读写面（Ledger extends 本面——方法名恒平，ledger.ts 摊入） */
export interface BudgetsFace {
  /** 预算三节点落账（append-only，同 id 幂等规则对齐 appendEvent） */
  appendBudget(record: unknown): AppendResult
  queryBudgets(scope: BudgetScope): BudgetRecord[]
  /**
   * budgets 全量读面（无 scope 维）：全部行 (ts, id) 升序；since/until 双端闭区间；
   * kinds 子集过滤（枚举外值 CONFIG_INVALID）。索引说明：现索引 idx_budgets_scope
   * (scope_kind, scope_id) 只服务 scope 定位，本面全表扫描后排序——量级口径：预算行量=
   * 派发量级（每单 reserve/settle/refusal 各至多数行），可接受；涨量后再评估 ts 索引
   * （拟稿，见 index.ts 疑点清单）。
   */
  listBudgets(query?: BudgetListQuery): BudgetRecord[]
}

const rowToBudget = (row: SqlRow): BudgetRecord => {
  const rec: BudgetRecord = {
    id: str(row, 'id'),
    scope_kind: str(row, 'scope_kind') as BudgetRecord['scope_kind'],
    scope_id: str(row, 'scope_id'),
    kind: str(row, 'kind') as BudgetRecord['kind'],
    ts: Number(row['ts']),
  }
  const estimated = optNum(row, 'estimated_usd')
  if (estimated !== undefined) rec.estimated_usd = estimated
  const actual = optNum(row, 'actual_usd')
  if (actual !== undefined) rec.actual_usd = actual
  return rec
}

/** budgets 面工厂（openLedger 唯一组装点摊入；db=同一句柄，不复制连接/状态） */
export function createBudgetsFace(db: DatabaseSync): BudgetsFace {
  const appendBudget = (record: unknown): AppendResult => {
    const r = assertRecord(BudgetRecordSchema, record, 'store/budget:invalid')
    // 幂等规则对齐 appendEvent：同 id 全列一致跳过，不一致抛错（F2-13 回填幂等）
    const existing = db.prepare('SELECT * FROM budgets WHERE id = ?').get(r.id) as SqlRow | undefined
    if (existing !== undefined) {
      if (canonicalJson(rowToBudget(existing)) === canonicalJson(r)) return { id: r.id, appended: false }
      configInvalid('store/budget:duplicate-id', `预算账 id=${r.id} 已存在且内容不一致（拒绝覆盖语义的重复入账）`)
    }
    db.prepare(
      'INSERT INTO budgets (id, scope_kind, scope_id, kind, estimated_usd, actual_usd, ts) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(r.id, r.scope_kind, r.scope_id, r.kind, r.estimated_usd ?? null, r.actual_usd ?? null, r.ts)
    return { id: r.id, appended: true }
  }

  const queryBudgets = (scope: BudgetScope): BudgetRecord[] =>
    (
      db
        .prepare('SELECT * FROM budgets WHERE scope_kind = ? AND scope_id = ? ORDER BY ts ASC, id ASC')
        .all(scope.scope_kind, scope.scope_id) as SqlRow[]
    ).map(rowToBudget)

  /** kinds 白名单（运行期闸：TS 字面量类型挡编译期，JS 调用方/配置驱动仍须如实拒——对齐 queryEvents order 闸） */
  const isBudgetKind = (v: unknown): v is BudgetRecord['kind'] =>
    v === 'reserve' || v === 'settle' || v === 'refusal'

  const listBudgets = (query: BudgetListQuery = {}): BudgetRecord[] => {
    if (query.kinds !== undefined) {
      const bad = query.kinds.find((k) => !isBudgetKind(k))
      if (bad !== undefined) {
        configInvalid('store/budget:bad-kind', `kinds 含枚举外值：${String(bad)}（须为 'reserve'|'settle'|'refusal' 子集）`)
      }
    }
    const where: string[] = []
    const params: Array<string | number> = []
    if (query.since !== undefined) {
      where.push('ts >= ?')
      params.push(query.since)
    }
    if (query.until !== undefined) {
      where.push('ts <= ?')
      params.push(query.until)
    }
    if (query.kinds !== undefined && query.kinds.length > 0) {
      // kinds 占位符逐个参数化绑定（无内插面）；空数组=不过滤（见 BudgetListQuery 行注）
      where.push(`kind IN (${query.kinds.map(() => '?').join(', ')})`)
      params.push(...query.kinds)
    }
    let sql = 'SELECT * FROM budgets'
    if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`
    sql += ' ORDER BY ts ASC, id ASC'
    const rows = db.prepare(sql).all(...params) as SqlRow[]
    return rows.map(rowToBudget)
  }
  return {
    appendBudget,
    queryBudgets,
    listBudgets,
  }
}
