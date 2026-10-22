/**
 * usage —— v11 人×模型×日用量投影读写面（132-§6.1 单C·studio-dev-177；BC-S2 先拆
 * 再增：自 ledger.ts 拆出——形状闸随面落本文件，ledger.ts 仅摊入 createUsageFace）
 *
 * 表 DDL 归 migrations v11；与 price_snapshots（append-only）不同，本表是 **open 可
 * 刷新投影**（冻结语义在 cost_daily=单D）：无禁改触发器，两个写面——
 *   - upsertUsageDaily：增量并格（自然键 (company, person_id, model, usage_date)
 *     冲突即四桶累加+runs_count 计数；生产调用方=daemon 收割相位尾缝 write-through，
 *     132-§6.0「R1 落账日=ended_at 本地日」由调用方折日，本面只存串）；
 *   - replaceUsageDaily：全量替换（重建面，C8 投影纪律：随时从 work_records 全量
 *     重算——core.foldUsageDaily 纯折叠+本面原子落库；单事务 DELETE+INSERT，
 *     不留半截投影）。
 * id 归 daemon（ULID，store/test/ulid.ts 口径「生产侧 ULID 由 daemon 生成，store 只做
 * 格式校验」）；首插用入参 id，冲突沿用原行 id（并格不改主键）。
 *
 * 形状闸落本文件的申报：records.ts 已达尺寸阈（597/600，20-§十五.三），本面闸随
 * 读写面同文件（pricing.ts 同款先例）。
 */
import type { DatabaseSync } from 'node:sqlite'
import { configInvalid, UlidSchema } from '@studio-next/contract'
import { z } from 'zod'
import { assertRecord, optNum, str, type SqlRow } from './row-helpers.ts'

/** 'YYYY-MM-DD'（真日历日校验——R1 日键；pricing.isCalendarDate 同式） */
const USAGE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isCalendarDate(v: string): boolean {
  if (!USAGE_DATE_RE.test(v)) return false
  const [y, m, d] = v.split('-').map(Number) as [number, number, number]
  const ms = Date.UTC(y, m - 1, d)
  const back = new Date(ms)
  return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d
}

const UsageDateSchema = z.string().refine(isCalendarDate, { message: 'usage_date 形如 YYYY-MM-DD 且须为真日历日' })

/** 四桶增量（132-A TokenCounts 列名对齐；int 非负） */
const TokenDeltaSchema = z.strictObject({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cache_read: z.number().int().nonnegative().default(0),
  cache_creation: z.number().int().nonnegative().default(0),
})

/** upsert 入参（一次收割=一格一增量；id/updated_at 归调用方） */
const UsageDailyDeltaSchema = z.strictObject({
  id: UlidSchema,
  company: z.string().min(1),
  person_id: z.string().min(1),
  /** 'provider/model' 归一形（132-A ResultStats.model 直传） */
  model: z.string().min(1),
  usage_date: UsageDateSchema,
  tokens: TokenDeltaSchema,
  /** 本单 started_at（格内最早单锚——并格取 MIN） */
  first_ts: z.number().int().nonnegative(),
  /** 本单 ended_at（格内最晚单锚——并格取 MAX） */
  last_ts: z.number().int().nonnegative(),
  /** 投影刷新时刻（epoch ms） */
  updated_at: z.number().int().nonnegative(),
})

/** usage_daily 行记录（migrations v11 建列逐列对齐） */
export interface UsageDailyRecord {
  id: string
  company: string
  person_id: string
  model: string
  usage_date: string
  tokens_in: number
  tokens_out: number
  cache_read: number
  cache_creation: number
  runs_count: number
  first_ts?: number
  last_ts?: number
  updated_at: number
}

/** 全量替换入参（core.foldUsageDaily 产物+daemon 补 id/updated_at） */
const UsageDailyRecordSchema = z.strictObject({
  id: UlidSchema,
  company: z.string().min(1),
  person_id: z.string().min(1),
  model: z.string().min(1),
  usage_date: UsageDateSchema,
  tokens_in: z.number().int().nonnegative(),
  tokens_out: z.number().int().nonnegative(),
  cache_read: z.number().int().nonnegative(),
  cache_creation: z.number().int().nonnegative(),
  runs_count: z.number().int().positive(),
  first_ts: z.number().int().nonnegative().optional(),
  last_ts: z.number().int().nonnegative().optional(),
  updated_at: z.number().int().nonnegative(),
})

/** listUsageDaily 过滤面（全可选；cost-threshold 源/重建核对面） */
export interface UsageDailyQuery {
  company?: string
  usage_date?: string
  person_id?: string
  model?: string
}

/** replaceUsageDaily 结果 */
export interface ReplaceUsageDailyResult {
  /** 替换后该公司行数 */
  rows: number
}

function rowToUsageDaily(row: SqlRow): UsageDailyRecord {
  const rec: UsageDailyRecord = {
    id: str(row, 'id'),
    company: str(row, 'company'),
    person_id: str(row, 'person_id'),
    model: str(row, 'model'),
    usage_date: str(row, 'usage_date'),
    tokens_in: Number(row['tokens_in']),
    tokens_out: Number(row['tokens_out']),
    cache_read: Number(row['cache_read']),
    cache_creation: Number(row['cache_creation']),
    runs_count: Number(row['runs_count']),
    updated_at: Number(row['updated_at']),
  }
  const first = optNum(row, 'first_ts')
  if (first !== undefined) rec.first_ts = first
  const last = optNum(row, 'last_ts')
  if (last !== undefined) rec.last_ts = last
  return rec
}

/** v11 用量投影读写面（Ledger extends 本面——方法名恒平，ledger.ts 摊入） */
export interface UsageFace {
  /**
   * 增量并格（唯一增量写面）：自然键冲突 → 四桶累加+runs_count+1+first/last 取
   * MIN/MAX+updated_at 刷新；新键 → INSERT（id=入参）。一次调用=一格一增量
   * （收割相位尾缝 write-through：一次收割一行 work_record）。
   */
  upsertUsageDaily(delta: unknown): void
  /** 读面：(usage_date, person_id, model) 升序；条件全可选 */
  listUsageDaily(query?: UsageDailyQuery): UsageDailyRecord[]
  /**
   * 全量替换（唯一重建写面）：单事务 DELETE 该公司全部行+INSERT 入参行——
   * 重建面（C8：从 work_records 全量重算）；不留半截投影，坏行整体回滚。
   */
  replaceUsageDaily(company: string, rows: unknown): ReplaceUsageDailyResult
}

/** v11 面工厂（ledger.ts 摊入；db 为已迁移到 v11 的库句柄） */
export function createUsageFace(db: DatabaseSync): UsageFace {
  const upsertUsageDaily = (delta: unknown): void => {
    const r = assertRecord(UsageDailyDeltaSchema, delta, 'store/usage-daily:invalid')
    // NULL 感知 MIN/MAX（SQLite 标量 min/max 遇 NULL 即 NULL——CASE 显式判空）
    db.prepare(
      `INSERT INTO usage_daily (
         id, company, person_id, model, usage_date,
         tokens_in, tokens_out, cache_read, cache_creation,
         runs_count, first_ts, last_ts, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(company, person_id, model, usage_date) DO UPDATE SET
         tokens_in = tokens_in + excluded.tokens_in,
         tokens_out = tokens_out + excluded.tokens_out,
         cache_read = cache_read + excluded.cache_read,
         cache_creation = cache_creation + excluded.cache_creation,
         runs_count = runs_count + 1,
         first_ts = CASE
           WHEN usage_daily.first_ts IS NULL OR usage_daily.first_ts > excluded.first_ts
           THEN excluded.first_ts ELSE usage_daily.first_ts END,
         last_ts = CASE
           WHEN usage_daily.last_ts IS NULL OR usage_daily.last_ts < excluded.last_ts
           THEN excluded.last_ts ELSE usage_daily.last_ts END,
         updated_at = excluded.updated_at`,
    ).run(
      r.id,
      r.company,
      r.person_id,
      r.model,
      r.usage_date,
      r.tokens.input,
      r.tokens.output,
      r.tokens.cache_read,
      r.tokens.cache_creation,
      r.first_ts,
      r.last_ts,
      r.updated_at,
    )
  }

  const listUsageDaily = (query: UsageDailyQuery = {}): UsageDailyRecord[] => {
    const where: string[] = []
    const params: Array<string | number> = []
    if (query.company !== undefined) {
      where.push('company = ?')
      params.push(query.company)
    }
    if (query.usage_date !== undefined) {
      where.push('usage_date = ?')
      params.push(query.usage_date)
    }
    if (query.person_id !== undefined) {
      where.push('person_id = ?')
      params.push(query.person_id)
    }
    if (query.model !== undefined) {
      where.push('model = ?')
      params.push(query.model)
    }
    const sql = `SELECT * FROM usage_daily${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY usage_date ASC, person_id ASC, model ASC`
    return (db.prepare(sql).all(...params) as SqlRow[]).map(rowToUsageDaily)
  }

  const replaceUsageDaily = (company: string, rows: unknown): ReplaceUsageDailyResult => {
    if (typeof company !== 'string' || company === '') {
      configInvalid('store/usage-daily:invalid', 'replaceUsageDaily 的 company 须为非空字符串')
    }
    if (!Array.isArray(rows)) {
      configInvalid('store/usage-daily:invalid', 'replaceUsageDaily 的 rows 须为数组（core.foldUsageDaily 产物+daemon 补 id/updated_at）')
    }
    const checked = rows.map((row) => assertRecord(UsageDailyRecordSchema, row, 'store/usage-daily:invalid'))
    db.exec('BEGIN')
    try {
      db.prepare('DELETE FROM usage_daily WHERE company = ?').run(company)
      const ins = db.prepare(
        `INSERT INTO usage_daily (
           id, company, person_id, model, usage_date,
           tokens_in, tokens_out, cache_read, cache_creation,
           runs_count, first_ts, last_ts, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const r of checked) {
        if (r.company !== company) {
          configInvalid(
            'store/usage-daily:invalid',
            `replaceUsageDaily 行 company=${r.company} 与目标 company=${company} 不一致（重建按公司整组替换）`,
          )
        }
        ins.run(
          r.id,
          r.company,
          r.person_id,
          r.model,
          r.usage_date,
          r.tokens_in,
          r.tokens_out,
          r.cache_read,
          r.cache_creation,
          r.runs_count,
          r.first_ts ?? null,
          r.last_ts ?? null,
          r.updated_at,
        )
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    const row = db.prepare('SELECT COUNT(*) AS n FROM usage_daily WHERE company = ?').get(company) as { n: unknown }
    return { rows: Number(row.n) }
  }

  return { upsertUsageDaily, listUsageDaily, replaceUsageDaily }
}
