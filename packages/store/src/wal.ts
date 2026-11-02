/**
 * wal —— 台账 WAL checkpoint 薄面（studio-dev-504 S3）
 *
 * 依据：#497 plan §4.5 检查点第 5 步（`PRAGMA wal_checkpoint(TRUNCATE)`，记录
 *   walBefore/walAfter）；docs/17-§3（台账是 daemon 唯一写入者，停机前把 WAL 收干）。
 *
 * 语义：busy≠0（仍有读者占用）时**抛错**——检查点失败必须显式 exit 1 + ALARM，
 * 不静默跳过（#497 §4.5 失败面）。walBefore=WAL 总帧、walAfter=未回写帧（应为 0）。
 */
import type { DatabaseSync } from 'node:sqlite'

export interface WalCheckpointResult {
  /** checkpoint 前 WAL 帧数（PRAGMA 返回 log） */
  walBefore: number
  /** checkpoint 后残余 WAL 帧数（PRAGMA 返回 log - checkpointed；TRUNCATE 成功=0） */
  walAfter: number
}

export function walCheckpoint(db: DatabaseSync): WalCheckpointResult {
  const row = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as
    | { busy?: number; log?: number; checkpointed?: number }
    | undefined
  if (row === undefined) throw new Error('store/wal:checkpoint-no-result：PRAGMA wal_checkpoint 未返回结果')
  const busy = typeof row.busy === 'number' ? row.busy : 0
  const log = typeof row.log === 'number' ? row.log : 0
  const checkpointed = typeof row.checkpointed === 'number' ? row.checkpointed : 0
  if (busy !== 0) throw new Error(`store/wal:checkpoint-busy：仍有 ${busy} 个读者占用 WAL（检查点失败，不静默跳过）`)
  return { walBefore: log, walAfter: Math.max(0, log - checkpointed) }
}
