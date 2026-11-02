/**
 * mirror-gc —— ticket_mirror 投影 GC 删除面（studio-dev-511；docs/17-§3 镜像=可重建投影）
 *
 * 依据：
 *   - docs/17-§3：ticket_mirror 是平台镜像（可重建投影，权威源=协作平台），不是第二事实源；
 *   - docs/17-§2：主循环七相位——本件是**相位 1 采集尾的维护步**，不增删相位；
 *   - 任务书 §3：删除「company=X 且 issue 不在该司平台活动集」的残行；先备份、后删除；
 *     不手删 sqlite、不绕 daemon writer lease、不新增事实源。
 *
 * 边界（本件**不是**什么）：
 *   - 不判断「平台活动集」从哪来：调用方（daemon 相位 1）把本拍 `issues.list` 全量集传入；
 *   - 不打开/关闭租约：调用方必须在 `openLedgerWriter` 取得的写者租约下调用；
 *   - 不写事件表：事件枚举冻结（17-§3），观测走 daemon 日志 + tick report + daemon_kv；
 *   - 不删除 events 里的历史行：events 是 append-only 账，LOCAL-* 历史事件保留（本件只清
 *     镜像投影，不动账）。
 *
 * fail-safe（防灾难性误删）：
 *   - 活动集为空 → CONFIG_INVALID 拒删（平台拉取失败/空项目时「全表都不在活动集」是
 *     最坏误删面；调用方须先确认 `issues.list` 成功且非空）；
 *   - 活动集元素非空串 → CONFIG_INVALID；
 *   - 删除按 company 维 + 单事务；跨公司行结构上不可命中。
 *
 * 备份（GC 前一致性快照）：
 *   - `backupLedgerTo` 用 `VACUUM INTO`（SQLite 官方一致性快照；含 WAL 已提交内容）；
 *   - 备份失败即抛错，调用方不得继续删除；
 *   - `pruneLedgerBackups` 只清理本前缀 `ledger-mirror-gc-*.sqlite`，不碰其它文件。
 */
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { configInvalid, type ClassifiedError } from '@studio-next/contract'
import { openSqliteReadonly } from './driver.ts'
import { str, type SqlRow } from './row-helpers.ts'

/** 单条 DELETE 的 IN 参数上限（SQLite 变量上限保守值；分块删除避免超限） */
const DELETE_CHUNK = 400

/** 备份文件名前缀（`pruneLedgerBackups` 的唯一清理范围） */
export const MIRROR_GC_BACKUP_PREFIX = 'ledger-mirror-gc-'

/** 样本条数缺省（观测留痕只带样本，不把整批单号写进日志） */
const DEFAULT_SAMPLE_LIMIT = 20

/** pruneTicketMirrors 选项 */
export interface PruneTicketMirrorsOptions {
  /** 样本上限（默认 20；0=不带样本） */
  readonly sampleLimit?: number
}

/** pruneTicketMirrors 结果（观测面：删除数/样本/保留数） */
export interface PruneTicketMirrorsResult {
  readonly company: string
  readonly deleted: number
  readonly samples: readonly string[]
  readonly kept: number
  readonly totalBefore: number
}

/** 备份结果（路径 + 字节数；字节数=0 视为备份失败） */
export interface LedgerBackupResult {
  readonly path: string
  readonly bytes: number
}

/** 构造 STALL 分类错误（删除计数与预读不一致=运行期异常，回滚并如实上报） */
function stall(subcause: string, detail: string): Error & ClassifiedError {
  const err = new Error(`STALL/${subcause}：${detail}`) as Error & ClassifiedError
  err.category = 'STALL'
  err.subcause = subcause
  err.detail = detail
  return err
}

/**
 * 删除「company 下 issue 不在 activeIssues 中」的镜像行（单事务原子）。
 *
 * @param db          台账库句柄（调用方须持 writer lease；本函数不取租约）
 * @param company     公司 slug（空串=CONFIG_INVALID）
 * @param activeIssues 本拍平台全量活动集（空集=CONFIG_INVALID——fail-safe 拒删）
 * @param opts        样本上限
 * @throws CONFIG_INVALID store/ticket-mirror:bad-company|bad-active-issue|empty-active-set|bad-sample-limit
 * @throws STALL mirror-gc-count-mismatch（预读与删除计数不一致；事务已回滚）
 */
export function pruneTicketMirrors(
  db: DatabaseSync,
  company: string,
  activeIssues: Iterable<string>,
  opts: PruneTicketMirrorsOptions = {},
): PruneTicketMirrorsResult {
  if (typeof company !== 'string' || company.trim() === '') {
    configInvalid('store/ticket-mirror:bad-company', 'company 必须是非空字符串')
  }
  const sampleLimit = opts.sampleLimit ?? DEFAULT_SAMPLE_LIMIT
  if (!Number.isInteger(sampleLimit) || sampleLimit < 0) {
    configInvalid('store/ticket-mirror:bad-sample-limit', `sampleLimit 须为非负整数（实得 ${String(sampleLimit)}）`)
  }

  const active = new Set<string>()
  for (const issue of activeIssues) {
    if (typeof issue !== 'string' || issue.trim() === '') {
      configInvalid('store/ticket-mirror:bad-active-issue', '活动集元素须为非空字符串（平台单据号）')
    }
    active.add(issue)
  }
  if (active.size === 0) {
    configInvalid(
      'store/ticket-mirror:empty-active-set',
      '平台活动集为空——拒绝 GC（平台拉取失败/空项目时「全表都不在活动集」是灾难性误删面；调用方须先确认 issues.list 成功且非空）',
    )
  }

  const rows = db.prepare('SELECT issue FROM ticket_mirror WHERE company = ? ORDER BY issue ASC').all(company) as SqlRow[]
  const all = rows.map((row) => str(row, 'issue'))
  const stale = all.filter((issue) => !active.has(issue))
  if (stale.length === 0) {
    return { company, deleted: 0, samples: [], kept: all.length, totalBefore: all.length }
  }

  let deleted = 0
  db.exec('BEGIN IMMEDIATE')
  try {
    for (let offset = 0; offset < stale.length; offset += DELETE_CHUNK) {
      const chunk = stale.slice(offset, offset + DELETE_CHUNK)
      const placeholders = chunk.map(() => '?').join(',')
      const result = db
        .prepare(`DELETE FROM ticket_mirror WHERE company = ? AND issue IN (${placeholders})`)
        .run(company, ...chunk)
      deleted += Number(result.changes)
    }
    if (deleted !== stale.length) {
      throw stall(
        'mirror-gc-count-mismatch',
        `预读残行 ${stale.length} 条、实际删除 ${deleted} 条（单写者下不应发生；事务回滚）`,
      )
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  return {
    company,
    deleted,
    samples: stale.slice(0, sampleLimit),
    kept: all.length - deleted,
    totalBefore: all.length,
  }
}

/**
 * 一致性备份：`VACUUM INTO <outPath>`（SQLite 官方快照；含 WAL 已提交内容）。
 * 目标文件必须不存在（不覆盖既有备份）；父目录自动创建。
 *
 * @throws CONFIG_INVALID store/backup:bad-path|exists|empty|unreadable|integrity
 */
export function backupLedgerTo(db: DatabaseSync, outPath: string): LedgerBackupResult {
  if (typeof outPath !== 'string' || outPath.trim() === '') {
    configInvalid('store/backup:bad-path', '备份输出路径须为非空字符串')
  }
  const target = path.resolve(outPath)
  if (existsSync(target)) {
    configInvalid('store/backup:exists', `备份目标已存在（拒绝覆盖）：${target}`)
  }
  mkdirSync(path.dirname(target), { recursive: true })
  // VACUUM INTO 的路径是 SQL 字面量（不能参数化）；单引号转义防注入/路径畸形。
  const literal = target.replace(/'/g, "''")
  db.exec(`VACUUM INTO '${literal}'`)
  const bytes = statSync(target).size
  if (bytes <= 0) {
    configInvalid('store/backup:empty', `备份文件为空（${bytes} 字节）：${target}`)
  }
  assertBackupIntegrity(target)
  return { path: target, bytes }
}

/**
 * 备份可用性校验：只读打开 + `PRAGMA integrity_check` 必须为 ok。
 * 失败=CONFIG_INVALID（调用方据此不得继续删除）；校验后关闭句柄。
 */
function assertBackupIntegrity(target: string): void {
  const check = (() => {
    try {
      return openSqliteReadonly(target)
    } catch (err) {
      configInvalid('store/backup:unreadable', `备份不可只读打开：${target}（${err instanceof Error ? err.message : String(err)}）`)
    }
  })()
  try {
    const row = check.prepare('PRAGMA integrity_check').get() as SqlRow | undefined
    const verdict = row === undefined ? undefined : String(row['integrity_check'])
    if (verdict !== 'ok') {
      configInvalid('store/backup:integrity', `备份完整性校验失败（${String(verdict)}）：${target}`)
    }
  } finally {
    check.close()
  }
}

/**
 * 备份保留清理：只删本前缀 `ledger-mirror-gc-*.sqlite` 的最旧多余件。
 *
 * @param dir  备份目录（不存在=返回空数组）
 * @param keep 保留份数（>=1；0=CONFIG_INVALID，防「保留 0 份」把刚做的备份也删掉）
 * @returns 实际删除的文件名（升序）
 * @throws CONFIG_INVALID store/backup:bad-keep
 */
export function pruneLedgerBackups(dir: string, keep: number): string[] {
  if (!Number.isInteger(keep) || keep < 1) {
    configInvalid('store/backup:bad-keep', `keep 须为 >=1 的整数（实得 ${String(keep)}）`)
  }
  if (!existsSync(dir)) return []
  const names = readdirSync(dir)
    .filter((name) => name.startsWith(MIRROR_GC_BACKUP_PREFIX) && name.endsWith('.sqlite'))
    .sort()
  const excess = names.slice(0, Math.max(0, names.length - keep))
  for (const name of excess) {
    try {
      unlinkSync(path.join(dir, name))
    } catch (err) {
      if ((err as { code?: unknown }).code !== 'ENOENT') throw err
    }
  }
  return excess
}
