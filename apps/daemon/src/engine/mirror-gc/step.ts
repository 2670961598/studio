/**
 * mirror-gc —— daemon 相位 1 尾·ticket_mirror 投影 GC 维护步（studio-dev-511）
 *
 * 依据：
 *   - docs/17-§2：主循环七相位（采集→state-diff→派发→收割→合并→回收→落账/心跳）——
 *     本件挂在**相位 1 采集尾**，是相位内维护步，不增删相位；
 *   - docs/17-§3：ticket_mirror=平台镜像（可重建投影，权威源=协作平台）；
 *   - 任务书 §3：删「company=X 且 issue 不在该司平台活动集」的残行（LOCAL-* 与未来同型）；
 *     GC 前一致性备份、失败可恢复；在 daemon writer lease 下执行；观测留痕。
 *
 * 为什么在 daemon tick 内做（而不是 CLI 一次性命令）：
 *   daemon serve 启动即持 `<db>.writer.lock`（store/writer-lease.ts），独立 CLI 进程在
 *   daemon 运行时拿不到租约；「不停机 + 不绕租约」的唯一正规通道=daemon 进程内执行。
 *   首拍 force 执行（部署后立即清残行），其后每 MIRROR_GC_EVERY_TICKS 拍检查一次。
 *
 * fail-safe（灾难性误删防线，三层）：
 *   1. 平台 `issues.list` 失败（本拍 listOk=false）→ 跳过，不备份不删；
 *   2. 平台活动集为空 → 跳过（空项目/拉取半截时「全表都不在活动集」是最坏误删面）；
 *   3. store.pruneTicketMirrors 内部对空活动集再次 fail-closed；删除按 company 维单事务。
 *
 * 观测留痕（不新增事件名——事件枚举冻结 17-§3）：
 *   - daemon 日志一行：`[mirror-gc] company=… deleted=… kept=… samples=… backup=…`；
 *   - tick report `phases.collect.mirrorGc`（结构化：ran/reason/deleted/samples/backup）；
 *   - daemon_kv `mirror.gc.last`（跨拍持久摘要，供面板/运维只读）。
 *
 * 边界：
 *   - 不删 events（append-only 历史账；LOCAL-* 历史事件保留）；
 *   - 不改 ticket_mirror schema/字段语义；不新增事实源；
 *   - 备份目录 `<rootDir>/backups/mirror-gc/`，只清本前缀 `ledger-mirror-gc-*.sqlite`。
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { Ledger } from '@studio-next/store'
import { pruneLedgerBackups, MIRROR_GC_BACKUP_PREFIX } from '@studio-next/store'

/** GC 检查节流（拍）：60 拍≈1 分钟（tickMs=1000）；首拍 force 不受此限 */
export const MIRROR_GC_EVERY_TICKS = 60

/** 备份保留份数（只保留最近 N 份 GC 前快照） */
export const MIRROR_GC_BACKUP_KEEP = 5

/** 观测样本条数（日志/tick report 只带样本，不刷全量单号） */
export const MIRROR_GC_SAMPLE_LIMIT = 20

/** 跨拍持久观测键（daemon_kv；只读摘要，不是事实源） */
export const MIRROR_GC_LAST_KEY = 'mirror.gc.last'

/** 备份目录推导（<rootDir>/backups/mirror-gc） */
export function mirrorGcBackupDir(rootDir: string): string {
  return path.join(rootDir, 'backups', 'mirror-gc')
}

/** GC 维护步依赖 */
export interface MirrorGcDeps {
  readonly ledger: Ledger
  /** 本司 slug（ticket_mirror.company） */
  readonly company: string
  /** daemon 工位根（备份目录落 `<rootDir>/backups/mirror-gc`） */
  readonly rootDir: string
  /** 本拍平台全量活动集（issues.list({}) 成功时的全量结果） */
  readonly activeIssues: readonly string[]
  /** 本拍 issues.list 是否成功（失败=false→跳过 GC，防把「拉取失败」当「平台没单」） */
  readonly listOk: boolean
  /** 本拍序号（节流/备份文件名） */
  readonly seq: number
  /** 本拍时钟（epoch ms；备份文件名/观测摘要） */
  readonly now: number
  /** 首拍强制（部署后立即清一次；成功评估后由引擎置 false） */
  readonly force?: boolean
  readonly everyTicks?: number
  readonly backupKeep?: number
  readonly sampleLimit?: number
  /** 日志出口（缺省 console.log；测试注入捕获） */
  readonly log?: (line: string) => void
}

/** 跳过原因（非异常面：ran=false 时如实说明为什么没删） */
export type MirrorGcSkipReason = 'platform-unavailable' | 'empty-active-set'

/** GC 维护步汇报（tick report `phases.collect.mirrorGc`） */
export interface MirrorGcTickReport {
  /** 是否真正评估了活动集（true=no-stale/deleted；false=平台不可用/空活动集） */
  readonly ran: boolean
  readonly reason: 'no-stale' | 'deleted' | MirrorGcSkipReason
  readonly deleted: number
  readonly samples: readonly string[]
  readonly totalBefore: number
  readonly kept: number
  readonly backupPath?: string
  readonly backupBytes?: number
}

/** 备份文件名：ISO 时间（替换 :/. 为 -）+ 拍序，保证唯一且字典序=时间序 */
function backupFileName(now: number, seq: number): string {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
  return `${MIRROR_GC_BACKUP_PREFIX}${stamp}-${String(seq).padStart(8, '0')}.sqlite`
}

/**
 * 执行一拍 mirror GC 维护步。
 *
 * @returns undefined=本拍未到检查窗（节流）；否则返回结构化汇报（含跳过原因）
 * @throws 备份失败/删除失败原样上抛——调用方（engine）记 tick errors 并继续本拍其它相位
 */
export function runMirrorGcTick(deps: MirrorGcDeps): MirrorGcTickReport | undefined {
  const every = deps.everyTicks ?? MIRROR_GC_EVERY_TICKS
  if (!Number.isInteger(every) || every <= 0) return undefined
  if (deps.force !== true && deps.seq % every !== 0) return undefined

  const log = deps.log ?? ((line: string) => console.log(line))
  const sampleLimit = deps.sampleLimit ?? MIRROR_GC_SAMPLE_LIMIT
  const keep = deps.backupKeep ?? MIRROR_GC_BACKUP_KEEP
  const mirrorRows = deps.ledger.listTicketMirrors().filter((row) => row.company === deps.company)
  const totalBefore = mirrorRows.length

  // —— fail-safe ①：平台全量拉取失败 → 不评估、不备份、不删 ——
  if (!deps.listOk) {
    log(`[mirror-gc] skip reason=platform-unavailable company=${deps.company} total=${String(totalBefore)}`)
    return { ran: false, reason: 'platform-unavailable', deleted: 0, samples: [], totalBefore, kept: totalBefore }
  }

  // —— fail-safe ②：活动集为空 → 跳过（空项目/半截拉取时删全表是灾难性误删） ——
  if (deps.activeIssues.length === 0) {
    log(`[mirror-gc] skip reason=empty-active-set company=${deps.company} total=${String(totalBefore)}`)
    return { ran: false, reason: 'empty-active-set', deleted: 0, samples: [], totalBefore, kept: totalBefore }
  }

  const active = new Set(deps.activeIssues)
  const stale = mirrorRows.map((row) => row.issue).filter((issue) => !active.has(issue)).sort()
  if (stale.length === 0) {
    log(`[mirror-gc] company=${deps.company} deleted=0 kept=${String(totalBefore)} reason=no-stale`)
    writeLastObservation(deps, { deleted: 0, samples: [], totalBefore, kept: totalBefore }, log)
    return { ran: true, reason: 'no-stale', deleted: 0, samples: [], totalBefore, kept: totalBefore }
  }

  // —— GC 前一致性备份：失败即抛，绝不继续删除 ——
  const backupDir = mirrorGcBackupDir(deps.rootDir)
  mkdirSync(backupDir, { recursive: true })
  const backup = deps.ledger.backupTo(path.join(backupDir, backupFileName(deps.now, deps.seq)))

  // —— 删除残行（store 单事务；空活动集二次 fail-closed） ——
  const pruned = deps.ledger.pruneTicketMirrors(deps.company, deps.activeIssues, { sampleLimit })
  if (pruned.deleted === 0) {
    // 备份后竞态（单写者下不应发生）：如实报 no-stale，保留备份供审计
    log(`[mirror-gc] company=${deps.company} deleted=0 kept=${String(pruned.kept)} reason=no-stale backup=${backup.path}`)
    writeLastObservation(deps, { deleted: 0, samples: [], totalBefore, kept: pruned.kept }, log)
    return { ran: true, reason: 'no-stale', deleted: 0, samples: [], totalBefore, kept: pruned.kept, backupPath: backup.path, backupBytes: backup.bytes }
  }

  // —— 备份保留清理（失败不反悔本次 GC：备份已落盘，日志如实报） ——
  try {
    pruneLedgerBackups(backupDir, keep)
  } catch (err) {
    log(`[mirror-gc] 备份保留清理失败（不影响本次 GC）：${err instanceof Error ? err.message : String(err)}`)
  }

  log(
    `[mirror-gc] company=${deps.company} deleted=${String(pruned.deleted)} kept=${String(pruned.kept)} ` +
      `samples=${pruned.samples.length === 0 ? '-' : pruned.samples.join(',')} backup=${backup.path} bytes=${String(backup.bytes)}`,
  )
  writeLastObservation(deps, pruned, log)

  return {
    ran: true,
    reason: 'deleted',
    deleted: pruned.deleted,
    samples: pruned.samples,
    totalBefore: pruned.totalBefore,
    kept: pruned.kept,
    backupPath: backup.path,
    backupBytes: backup.bytes,
  }
}

/** 持久观测摘要（daemon_kv；写失败不反悔 GC，只记日志） */
function writeLastObservation(
  deps: MirrorGcDeps,
  summary: { deleted: number; samples: readonly string[]; totalBefore: number; kept: number },
  log: (line: string) => void,
): void {
  try {
    deps.ledger.kvSet(
      MIRROR_GC_LAST_KEY,
      JSON.stringify({
        at: deps.now,
        company: deps.company,
        seq: deps.seq,
        deleted: summary.deleted,
        samples: summary.samples,
        totalBefore: summary.totalBefore,
        kept: summary.kept,
      }),
    )
  } catch (err) {
    log(`[mirror-gc] 观测写失败（不影响本次 GC）：${err instanceof Error ? err.message : String(err)}`)
  }
}
