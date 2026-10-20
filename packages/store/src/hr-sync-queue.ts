/**
 * hr-sync-queue —— v7 人事同步任务队列读写面（DEV-48，docs/52-§9.2/§11；BC-S2 先拆再增：
 * 自 ledger.ts 拆出——接口并入 Ledger（extends 本面，方法名恒平，调用面零改动））
 *
 * v7 扩面（migrations v7 同批）：
 *   - hr_sync_log=**可流转任务账**（pending→applying→done/failed；断电复位
 *     resetStaleHrSyncApplying）——与 personnel_events（append-only 事实账）分工：
 *     事实一次落、任务可流转。
 *   - enqueueHrSync op_key 幂等：任意既有同 op_key 行命中即跳过（重放安全=执行器目标态
 *     收敛语义，不在此面猜）；claim/complete/fail 乐观锁流转；failHrSync 达限→failed
 *     终态（不自动开单）；releaseHrSyncFailed 人工唤醒面。
 *   - setPersonStatus：people.status 写面（52-§5.2：status 归人事流，syncCompany 镜像
 *     同步不动它——本面即该预留位的 DEV-48 收口）。
 *
 * 表 DDL 归 migrations v7；形状闸（HrSyncTaskSchema/HrSyncPayloadSchema）归 records.ts。
 */

import type { DatabaseSync } from 'node:sqlite'
import { configInvalid } from '@studio-next/contract'
import {
  HrSyncPayloadSchema,
  HrSyncTaskSchema,
  type HrSyncPayload,
  type HrSyncPlatformName,
  type HrSyncStatus,
  type HrSyncTaskRecord,
} from './records.ts'
import { assertRecord, optStr, str, type SqlRow } from './row-helpers.ts'

/** v7 人事同步任务队列 + people.status 写面（Ledger extends 本面——方法名恒平） */
export interface HrSyncQueueFace {
  // —— v7 人事同步任务队列（DEV-48，docs/52-§9.2/§11；daemon 相位尾消化器消费） ——
  /**
   * 入队（op_key 幂等）：**任意既有同 op_key 行（不论状态）命中 → 跳过不新建**
   * （enqueued=false）。跨批次重放安全由执行器目标态收敛语义保证（52-§11：ensure-shape
   * 多执行不坏），不在入队面猜「该不该重跑」。形状闸 HrSyncTaskSchema；payload 列
   * JSON 序列化（不可序列化 → CONFIG_INVALID，upsertLedgerEntry 同风格）。
   */
  enqueueHrSync(record: unknown): { id: string; enqueued: boolean }
  /** 待消化任务（status='pending'，(ts, id) 升序 FIFO；limit 上限） */
  listHrSyncPending(limit: number): HrSyncTaskRecord[]
  /**
   * 认领（乐观锁 pending→applying）：UPDATE … WHERE id=? AND status='pending'，
   * 0 行=false（transitionCandidate 同风格——daemon 单写者，锁为防御深度）。
   */
  claimHrSync(id: string, now: number): boolean
  /** 完成（applying→done）；非 applying=false（状态机面不猜） */
  completeHrSync(id: string, now: number): boolean
  /**
   * 失败记账（applying→pending|failed）：attempts+1；attempts<retryLimit → pending
   * （下一拍重试）；达限 → failed 终态（断路形状借用 17-§6——ESCALATE 落账归调用方，
   * 不自动开 bug 单，§9.2；唤醒走 releaseHrSyncFailed）。last_error 原样落列
   * （出站脱敏归 daemon 调用方——store 不持有秘密名单）。
   */
  failHrSync(id: string, error: string, opts: { now: number; retryLimit: number }): HrSyncStatus
  /** failed→pending 唤醒面（人工/对账岗；返回是否真迁移了行） */
  releaseHrSyncFailed(id: string, now: number): boolean
  /**
   * 断电恢复：applying 且 updated<beforeTs → pending（§9.2 applying-stale 复位；
   * daemon 启动期扫，返回复位行数——apply 崩在平台 IO 中间的任务回队尾重试，
   * 目标态收敛语义保多执行不坏）。
   */
  resetStaleHrSyncApplying(beforeTs: number): number
  /** 队列观测面（面板/日志；按 status 计数） */
  hrSyncQueueStats(): { pending: number; applying: number; done: number; failed: number }
  /**
   * people.status 写面（52-§5.2：status 归人事流，syncCompany 镜像同步不动它——
   * 本面即该预留位的 DEV-48 收口）。无此行=false（入队前置 syncCompany 已建行，
   * false=调用方时序 bug，如实上报不建行）。level/dept/name 等镜像列不在此面。
   */
  setPersonStatus(personId: string, status: string): boolean
}

/**
 * 装配 v7 人事同步任务队列面（openLedger 内调用——db 句柄与行小件注入；
 * 读写面全走本件，ledger.ts 不留副本）。
 */
export function createHrSyncQueue(db: DatabaseSync): HrSyncQueueFace {
  function rowToHrSyncTask(row: SqlRow): HrSyncTaskRecord {
    const rec: HrSyncTaskRecord = {
      id: str(row, 'id'),
      ts: Number(row['ts']),
      company: str(row, 'company'),
      person_id: str(row, 'person_id'),
      kind: str(row, 'kind'),
      platform: str(row, 'platform') as HrSyncPlatformName,
      op_key: str(row, 'op_key'),
      ticket: str(row, 'ticket'),
      status: str(row, 'status') as HrSyncStatus,
      attempts: Number(row['attempts']),
      updated: Number(row['updated']),
    }
    const err = optStr(row, 'last_error')
    if (err !== undefined) rec.last_error = err
    const payloadJson = optStr(row, 'payload')
    // zod 输出形（可选键带 undefined）与手写接口（exactOptionalPropertyTypes）间的显式收窄
    if (payloadJson !== undefined) rec.payload = HrSyncPayloadSchema.parse(JSON.parse(payloadJson)) as HrSyncPayload
    return rec
  }

  function serializeHrPayload(payload: unknown): string | null {
    if (payload === undefined || payload === null) return null
    const json = JSON.stringify(payload)
    if (json === undefined) {
      configInvalid('store/hr-sync:payload-not-serializable', 'payload 含不可 JSON 序列化值（upsertLedgerEntry 同闸）')
    }
    return json
  }

  const enqueueHrSync = (record: unknown): { id: string; enqueued: boolean } => {
    const r = assertRecord(HrSyncTaskSchema, record, 'store/hr-sync:invalid')
    // op_key 幂等（52-§11）：任意既有同 op_key 行（pending/applying/done/failed 不论）命中即
    // 跳过不新建——重放安全由执行器目标态收敛语义保证；done 命中=目标态已执行过，
    // failed 命中=已达限终态待人工（releaseHrSyncFailed 唤醒），均不在入队面猜。
    const existing = db.prepare('SELECT id FROM hr_sync_log WHERE op_key = ?').get(r.op_key) as SqlRow | undefined
    if (existing !== undefined) return { id: str(existing, 'id'), enqueued: false }
    db.prepare(
      "INSERT INTO hr_sync_log (id, ts, company, person_id, kind, platform, op_key, ticket, status, attempts, last_error, payload, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?)",
    ).run(r.id, r.ts, r.company, r.person_id, r.kind, r.platform, r.op_key, r.ticket, serializeHrPayload(r.payload), r.ts)
    return { id: r.id, enqueued: true }
  }

  const listHrSyncPending = (limit: number): HrSyncTaskRecord[] => {
    if (!Number.isInteger(limit) || limit < 1) {
      configInvalid('store/hr-sync:bad-limit', `limit=${String(limit)} 须为正整数（maxHrSyncPerTick 语义，§9.2）`)
    }
    return (db.prepare("SELECT * FROM hr_sync_log WHERE status = 'pending' ORDER BY ts ASC, id ASC LIMIT ?").all(limit) as SqlRow[]).map(
      rowToHrSyncTask,
    )
  }

  const claimHrSync = (id: string, now: number): boolean => {
    const res = db.prepare("UPDATE hr_sync_log SET status = 'applying', updated = ? WHERE id = ? AND status = 'pending'").run(now, id)
    return res.changes > 0
  }

  const completeHrSync = (id: string, now: number): boolean => {
    const res = db.prepare("UPDATE hr_sync_log SET status = 'done', updated = ? WHERE id = ? AND status = 'applying'").run(now, id)
    return res.changes > 0
  }

  const failHrSync = (id: string, error: string, opts: { now: number; retryLimit: number }): HrSyncStatus => {
    if (!Number.isInteger(opts.retryLimit) || opts.retryLimit < 1) {
      configInvalid('store/hr-sync:bad-retry-limit', `retryLimit=${String(opts.retryLimit)} 须为正整数（3 连击语义，17-§6 形状借用）`)
    }
    const row = db.prepare('SELECT attempts FROM hr_sync_log WHERE id = ?').get(id) as SqlRow | undefined
    if (row === undefined) {
      configInvalid('store/hr-sync:no-such-task', `任务 id=${id} 不存在（failHrSync 只对既有行记账）`)
    }
    const attempts = Number(row['attempts']) + 1
    const status: HrSyncStatus = attempts < opts.retryLimit ? 'pending' : 'failed'
    const res = db
      .prepare("UPDATE hr_sync_log SET status = ?, attempts = ?, last_error = ?, updated = ? WHERE id = ? AND status = 'applying'")
      .run(status, attempts, error, opts.now, id)
    if (res.changes === 0) {
      configInvalid('store/hr-sync:not-applying', `任务 id=${id} 非 applying 态（failHrSync 只收 applying 的失败记账）`)
    }
    return status
  }

  const releaseHrSyncFailed = (id: string, now: number): boolean => {
    const res = db.prepare("UPDATE hr_sync_log SET status = 'pending', updated = ? WHERE id = ? AND status = 'failed'").run(now, id)
    return res.changes > 0
  }

  const resetStaleHrSyncApplying = (beforeTs: number): number => {
    const res = db
      .prepare("UPDATE hr_sync_log SET status = 'pending', updated = ? WHERE status = 'applying' AND updated < ?")
      .run(beforeTs, beforeTs)
    return Number(res.changes)
  }

  const hrSyncQueueStats = (): { pending: number; applying: number; done: number; failed: number } => {
    const out = { pending: 0, applying: 0, done: 0, failed: 0 }
    for (const row of db.prepare('SELECT status, COUNT(*) AS n FROM hr_sync_log GROUP BY status').all() as SqlRow[]) {
      const s = str(row, 'status') as HrSyncStatus
      out[s] = Number(row['n'])
    }
    return out
  }

  const setPersonStatus = (personId: string, status: string): boolean => {
    const res = db.prepare('UPDATE people SET status = ? WHERE person_id = ?').run(status, personId)
    return res.changes > 0
  }

  return {
    enqueueHrSync,
    listHrSyncPending,
    claimHrSync,
    completeHrSync,
    failHrSync,
    releaseHrSyncFailed,
    resetStaleHrSyncApplying,
    hrSyncQueueStats,
    setPersonStatus,
  }
}
