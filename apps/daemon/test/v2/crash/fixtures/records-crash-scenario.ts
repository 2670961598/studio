/**
 * records-crash-scenario —— MIG-04 / IMPL-04-07 V2 crash 腿共用场景（真进程 SIGKILL，无 mock）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - plan/05 IMPL-04-07（V2 crash 腿；kill 点重启三不变量：不丢终态/不假绿/不重复副作用）
 *   - docs/v2/17 §1.1 V5（每个 kill 点重启后三不变量成立）；§三 NEG-MIG-01/02 的邻接面
 *   - docs/v2/11 §〇（记录信封）／docs/v2/05 §三 DOM-05（records＝记录投影，非第四事实源）
 *
 * 边界：本文件是**测试夹具**（不进生产面、不新增生产调用点、不改 store 写面）：
 *   - records 列由 v14 DDL 原样写（node:sqlite INSERT）——本单验证的是「事务 COMMIT 前/后缝隙」
 *     的库语义，**不冒充** PORT-HIST 写口（形状校验/幂等归 hist.ts，不属本场景断言域）；
 *   - 种子行（event/cost_daily/record）均为确定性合成 id，崩溃前在独立事务中已提交。
 */
import type { DatabaseSync } from 'node:sqlite'
import type { EventRecord } from '@studio-next/contract'

/** 子进程库路径环境变量（与 SN_CRASH_POINT 分离：点名只控注入，路径只控场景） */
export const DB_ENV = 'SN_RECORDS_CRASH_DB'

/** 第 6 点注册名（与 crash-points.ts 冻结表逐字一致） */
export const CRASH_POINT_NAME = 'records-commit'

/** 场景基准时刻（固定，可复现） */
export const T0 = Date.UTC(2026, 9, 28, 5, 0, 0)

const COMPANY = 'studio-crash'
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function encodeBase32(value: bigint, len: number): string {
  let out = ''
  for (let i = len - 1; i >= 0; i--) out += B32[Number((value / 32n ** BigInt(i)) % 32n)] ?? '0'
  return out
}

/** 确定性合成 ULID（时间位 10 字符＋随机位 16 字符；同参数恒同 id） */
export function ulid(ts: number, seq: number): string {
  return encodeBase32(BigInt(ts), 10) + encodeBase32(BigInt(seq), 16)
}

export const SEED_RECORD_ID = ulid(T0, 1)
export const CRASHING_RECORD_ID = ulid(T0, 2)
export const SEED_EVENT_ID = ulid(T0, 10)
export const SEED_COST_ID = ulid(T0, 20)

const iso = (ms: number): string => new Date(ms).toISOString()

/** 崩溃前已提交的终态事件（不丢终态的观测锚） */
export function seedEvent(): EventRecord {
  return {
    id: SEED_EVENT_ID,
    ts: T0,
    company: COMPANY,
    issue: 'STUDIO-704',
    event: 'CLOSE',
    actor: 'AGENT-1:agent-1',
    attempt: 1,
    level: 2,
    dept: 'departments/工程部',
    tokens: { input: 10, output: 5 },
    note: 'records-crash 种子事件：崩溃前已提交的终态行',
  }
}

/** 崩溃前已提交的 cost_daily 定型行（无副作用观测锚；定型账 append-only） */
export function seedCostRow(): Record<string, unknown> {
  return {
    id: SEED_COST_ID,
    company: COMPANY,
    person_id: 'ENG-1',
    model: 'deepseek/deepseek-flash',
    cost_date: '2026-10-28',
    tokens: { tokens_in: 1000, tokens_out: 500, cache_read: 0, cache_creation: 0 },
    price_snapshot_id: 'models-yaml:deepseek/deepseek-flash',
    cost_usd: 0.25,
    closed_at: T0,
    closed_by: 'cost-close:2026-10-28',
    note: 'records-crash 种子钱账：崩溃前后恒 1 行',
  }
}

/** records 行（v14 列集；JSON 列按 hist.ts 同款编码——列值可读、可断言） */
export interface CrashRecordRow {
  record_id: string
  record_type: string
  record_area: string
  schema_ref: string
  spec_version: string
  company: string
  produced_at: number
  producer: string
  payload: string
  proof_boundary: string
  effective_state: string
  effective_time: number
  revises: string | null
  idempotency_key: string | null
  created_at: number
}

const INSERT_RECORD_SQL =
  'INSERT INTO records (record_id, record_type, record_area, schema_ref, spec_version, company, produced_at, producer, payload, proof_boundary, effective_state, effective_time, revises, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'

function eventPayload(summary: string, cursor: string): string {
  return JSON.stringify({
    event_kind: 'observation',
    actor_ref: 'ENG-1',
    occurred_at: iso(T0),
    observed_at: iso(T0),
    payload_summary: summary,
    source_kind: 'harness',
    cursor,
    event_completeness: 'unknown',
  })
}

function recordRow(recordId: string, producedAt: number, summary: string, cursor: string, createdAt: number): CrashRecordRow {
  return {
    record_id: recordId,
    record_type: 'REC-EVT-01',
    record_area: 'AUTH',
    schema_ref: JSON.stringify({ schemaId: 'rec.evt-01', schemaVersion: '1.0.0' }),
    spec_version: '2.1.0',
    company: COMPANY,
    produced_at: producedAt,
    producer: JSON.stringify({ decidedBy: 'ENG-1', writtenBy: 'daemon' }),
    payload: eventPayload(summary, cursor),
    proof_boundary: '本记录证明观察到该次采集；不证明采集完整',
    effective_state: 'effective',
    effective_time: producedAt,
    revises: null,
    idempotency_key: null,
    created_at: createdAt,
  }
}

/** 崩溃前已提交的记录（effective 终态：不丢终态的观测锚） */
export function seedRecordRow(): CrashRecordRow {
  return recordRow(SEED_RECORD_ID, T0, '崩溃前已提交的种子记录', 'cursor-seed', T0 + 1_000)
}

/** 崩溃缝隙中的记录：事务内 INSERT 后、COMMIT 前硬杀（重启后应零残留） */
export function crashRecordRow(): CrashRecordRow {
  return recordRow(CRASHING_RECORD_ID, T0 + 1_000, '提交前缝隙中的记录（应随事务回滚）', 'cursor-crash', T0 + 2_000)
}

/** 原样 INSERT（v14 列集；参数显式展开，列序与 DDL 一致） */
export function insertRecordRow(db: DatabaseSync, row: CrashRecordRow): void {
  db.prepare(INSERT_RECORD_SQL).run(
    row.record_id,
    row.record_type,
    row.record_area,
    row.schema_ref,
    row.spec_version,
    row.company,
    row.produced_at,
    row.producer,
    row.payload,
    row.proof_boundary,
    row.effective_state,
    row.effective_time,
    row.revises,
    row.idempotency_key,
    row.created_at,
  )
}
