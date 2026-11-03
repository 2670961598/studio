/**
 * jobs —— 调度表读写面（自 ledger.ts 原样拆出，零行为变更）
 *
 * 表 DDL 归 migrations v3（17-§2 / 18-§三）：upsertJob job_id 幂等覆盖（热更单岗不动他岗、
 * 不清 last_run_at）/ dueJobs 补跑扫描 / markRan 两列同语句原子 / removeJob 下线。
 * db 由 openLedger 唯一持有并注入，本模块不建连接、不留状态。
 */
import type { DatabaseSync } from 'node:sqlite'
import { configInvalid } from '@studio-next/contract'
import { JobRecordSchema, type JobRecord } from '../records.ts'
import { assertRecord, optNum, optStr, str, type SqlRow } from '../row-helpers.ts'
import { errorMessage, parseJsonValue } from './shared.ts'

/** jobs 调度表读写面（Ledger extends 本面——方法名恒平，ledger.ts 摊入） */
export interface JobsFace {
  // —— v3 jobs 调度表（17-§2 / 18-§三） ——
  /** 定时岗 upsert（job_id 幂等覆盖配置列；热更单岗不动他岗、不清 last_run_at——见实现注） */
  upsertJob(record: unknown): string
  getJob(jobId: string): JobRecord | undefined
  /** 全部定时岗（next_run_at 升序，同刻按 job_id 稳定序） */
  listJobs(): JobRecord[]
  /** 补跑扫描：next_run_at <= now 的槽位升序（18-§三 启动扫 due 槽位） */
  dueJobs(now: number, limit?: number): JobRecord[]
  /** 记一次实跑：last_run_at/next_run_at 两列同语句原子落库（可观测无中间态） */
  markRan(jobId: string, now: number, nextRunAt: number): boolean
  /** 定时岗下线（公司目录删岗）；返回是否真删了行 */
  removeJob(jobId: string): boolean
}

/** jobs 面工厂（openLedger 唯一组装点摊入；db=同一句柄，不复制连接/状态） */
export function createJobsFace(db: DatabaseSync): JobsFace {
  // —— v3 jobs 调度表读写面（17-§2 / 18-§三） ——

  const rowToJob = (row: SqlRow): JobRecord => {
    const rec: JobRecord = {
      job_id: str(row, 'job_id'),
      company: str(row, 'company'),
      dept: str(row, 'dept'),
      cron: str(row, 'cron'),
      role: str(row, 'role'),
      level: Number(row['level']),
      model_tier: str(row, 'model_tier') as JobRecord['model_tier'],
      next_run_at: Number(row['next_run_at']),
    }
    const budgetCap = optNum(row, 'budget_cap')
    if (budgetCap !== undefined) rec.budget_cap = budgetCap
    const payloadJson = optStr(row, 'payload')
    if (payloadJson !== undefined) rec.payload = parseJsonValue(payloadJson, 'store/jobs:payload-corrupt')
    const lastRunAt = optNum(row, 'last_run_at')
    if (lastRunAt !== undefined) rec.last_run_at = lastRunAt
    const status = optStr(row, 'status')
    if (status !== undefined) rec.status = status
    return rec
  }

  /**
   * 定时岗 upsert：job_id 幂等覆盖——同 job_id 重复 upsert 不报错不涨行，整行按本次所载覆盖。
   * 热更语义（18-§三「重注册对应 job，不动其他岗」）落点：
   *   - ON CONFLICT 更新列集 = 配置列 + next_run_at + status（公司目录所载与调度计算所得）；
   *   - **last_run_at 不在更新列**——它是调度器运行时状态（markRan 落账），公司目录重挂载/热更
   *     不应清零跑史（拟稿待批，见 index.ts 疑点清单）。
   */
  const upsertJob = (record: unknown): string => {
    const r = assertRecord(JobRecordSchema, record, 'store/jobs:invalid')
    let payloadJson: string | null = null
    if (r.payload !== undefined) {
      try {
        const serialized = JSON.stringify(r.payload)
        // undefined 返回值 = 函数/Symbol 等不可 JSON 化的值（stringify 不抛但静默丢）——拒收不静默
        if (serialized === undefined) {
          configInvalid('store/jobs:payload-unserializable', `job ${r.job_id} payload 含不可 JSON 序列化的值`)
        }
        payloadJson = serialized
      } catch (err) {
        configInvalid('store/jobs:payload-unserializable', `job ${r.job_id} payload 不是可序列化 JSON 值：${errorMessage(err)}`)
      }
    }
    db.prepare(
      `INSERT INTO jobs (
         job_id, company, dept, cron, role, level, model_tier, budget_cap, payload, next_run_at, last_run_at, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(job_id) DO UPDATE SET
         company = excluded.company, dept = excluded.dept, cron = excluded.cron, role = excluded.role,
         level = excluded.level, model_tier = excluded.model_tier, budget_cap = excluded.budget_cap,
         payload = excluded.payload, next_run_at = excluded.next_run_at, status = excluded.status`,
    ).run(
      r.job_id,
      r.company,
      r.dept,
      r.cron,
      r.role,
      r.level,
      r.model_tier,
      r.budget_cap ?? null,
      payloadJson,
      r.next_run_at,
      r.last_run_at ?? null,
      r.status ?? null,
    )
    return r.job_id
  }

  const getJob = (jobId: string): JobRecord | undefined => {
    const row = db.prepare('SELECT * FROM jobs WHERE job_id = ?').get(jobId) as SqlRow | undefined
    return row === undefined ? undefined : rowToJob(row)
  }

  const listJobs = (): JobRecord[] =>
    (db.prepare('SELECT * FROM jobs ORDER BY next_run_at ASC, job_id ASC').all() as SqlRow[]).map(rowToJob)

  const dueJobs = (now: number, limit?: number): JobRecord[] => {
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
      configInvalid('store/jobs:bad-limit', `limit=${String(limit)} 须为非负整数`)
    }
    const sql =
      'SELECT * FROM jobs WHERE next_run_at <= ? ORDER BY next_run_at ASC, job_id ASC' +
      (limit === undefined ? '' : ' LIMIT ?')
    const rows = limit === undefined
      ? (db.prepare(sql).all(now) as SqlRow[])
      : (db.prepare(sql).all(now, limit) as SqlRow[])
    return rows.map(rowToJob)
  }

  /** 单条 UPDATE 即单事务：两列同语句移动，无中间态可观测（18-§三 补跑记账的原子基础） */
  const markRan = (jobId: string, now: number, nextRunAt: number): boolean => {
    const result = db.prepare('UPDATE jobs SET last_run_at = ?, next_run_at = ? WHERE job_id = ?').run(now, nextRunAt, jobId)
    return Number(result.changes) > 0
  }

  const removeJob = (jobId: string): boolean => {
    const result = db.prepare('DELETE FROM jobs WHERE job_id = ?').run(jobId)
    return Number(result.changes) > 0
  }
  return {
    upsertJob,
    getJob,
    listJobs,
    dueJobs,
    markRan,
    removeJob,
  }
}
