/**
 * probes —— probes_runs 探针跑分读写面（BC-S2 先拆再增：自 ledger.ts 原样拆出
 * ——132-C 单C·studio-dev-177 增 v11 usage 面时按「基线只减不增」纪律清偿尺寸；
 * 实现体零行为变更，ledger.ts 仅摊入 createProbesFace）
 *
 * 表 DDL 归 migrations v6（append-only：触发器拦 UPDATE/DELETE 机制兜底）；幂等
 * 规则=同 id 全列一致跳过（F2-13 回填口径），不一致 CONFIG_INVALID 拒覆盖语义。
 */
import type { DatabaseSync } from 'node:sqlite'
import { configInvalid } from '@studio-next/contract'
import { ProbeRunSchema, type ProbeRunRecord } from './records.ts'
import { assertRecord, optNum, str, type SqlRow } from './row-helpers.ts'
import type { AppendResult } from './ledger.ts'

/** 跑分行列表过滤面（ts 闭区间） */
export interface ProbeRunQuery {
  executor?: string
  probe_id?: string
  since?: number
  until?: number
}

/** probes_runs 读写面（Ledger extends 本面——方法名恒平，ledger.ts 摊入） */
export interface ProbesFace {
  /**
   * 探针跑分 append（append-only——触发器拦 UPDATE/DELETE 机制兜底）：同 id 全列
   * 一致 → 幂等跳过（appended=false，F2-13 回填口径）；同 id 内容不一致 →
   * CONFIG_INVALID（appendEvent 同规则）。
   */
  appendProbeRun(record: unknown): AppendResult
  /** 按 id 取跑分行；无此行=undefined */
  getProbeRun(id: string): ProbeRunRecord | undefined
  /** 跑分行列表（ts, id 升序）；executor / probe_id / since/until（ts 闭区间）可选过滤 */
  listProbeRuns(query?: ProbeRunQuery): ProbeRunRecord[]
}

function rowToProbeRun(row: SqlRow): ProbeRunRecord {
  const rec: ProbeRunRecord = {
    id: str(row, 'id'),
    executor: str(row, 'executor'),
    model: str(row, 'model'),
    probe_id: str(row, 'probe_id'),
    pass: Number(row['pass']) === 1,
    ts: Number(row['ts']),
  }
  const costUsd = optNum(row, 'cost_usd')
  if (costUsd !== undefined) rec.cost_usd = costUsd
  const durationMs = optNum(row, 'duration_ms')
  if (durationMs !== undefined) rec.duration_ms = durationMs
  return rec
}

function sameProbeRun(a: ProbeRunRecord, b: ProbeRunRecord): boolean {
  return (
    a.id === b.id &&
    a.executor === b.executor &&
    a.model === b.model &&
    a.probe_id === b.probe_id &&
    a.pass === b.pass &&
    a.cost_usd === b.cost_usd &&
    a.duration_ms === b.duration_ms &&
    a.ts === b.ts
  )
}

/** v6 面工厂（ledger.ts 摊入；db 为已迁移到 v6 的库句柄） */
export function createProbesFace(db: DatabaseSync): ProbesFace {
  const appendProbeRun = (record: unknown): AppendResult => {
    const r = assertRecord(ProbeRunSchema, record, 'store/probe-run:invalid')
    // 幂等规则：同 id 全列一致跳过，不一致抛错（F2-13 回填幂等；append-only 拒覆盖语义）
    const existing = db.prepare('SELECT * FROM probes_runs WHERE id = ?').get(r.id) as SqlRow | undefined
    if (existing !== undefined) {
      if (sameProbeRun(rowToProbeRun(existing), r)) return { id: r.id, appended: false }
      configInvalid(
        'store/probe-run:duplicate-id',
        `跑分 id=${r.id} 已存在且内容不一致（append-only，拒绝覆盖语义的重复入账）`,
      )
    }
    db.prepare('INSERT INTO probes_runs (id, executor, model, probe_id, pass, cost_usd, duration_ms, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      r.id,
      r.executor,
      r.model,
      r.probe_id,
      r.pass ? 1 : 0,
      r.cost_usd ?? null,
      r.duration_ms ?? null,
      r.ts,
    )
    return { id: r.id, appended: true }
  }

  const getProbeRun = (id: string): ProbeRunRecord | undefined => {
    const row = db.prepare('SELECT * FROM probes_runs WHERE id = ?').get(id) as SqlRow | undefined
    return row === undefined ? undefined : rowToProbeRun(row)
  }

  const listProbeRuns = (query: ProbeRunQuery = {}): ProbeRunRecord[] => {
    const where: string[] = []
    const params: Array<string | number> = []
    if (query.executor !== undefined) {
      where.push('executor = ?')
      params.push(query.executor)
    }
    if (query.probe_id !== undefined) {
      where.push('probe_id = ?')
      params.push(query.probe_id)
    }
    if (query.since !== undefined) {
      where.push('ts >= ?')
      params.push(query.since)
    }
    if (query.until !== undefined) {
      where.push('ts <= ?')
      params.push(query.until)
    }
    let sql = 'SELECT * FROM probes_runs'
    if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`
    sql += ' ORDER BY ts ASC, id ASC'
    return (db.prepare(sql).all(...params) as SqlRow[]).map(rowToProbeRun)
  }

  return { appendProbeRun, getProbeRun, listProbeRuns }
}
