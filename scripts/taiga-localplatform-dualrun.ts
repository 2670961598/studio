/**
 * taiga-localplatform-dualrun —— M2 单子自研切换·双跑对账原型（task-134）
 *
 * 依据（实现单引用设计文档章节号——AGENTS §五.1）：
 *   - docs/plan/06-自研单子与聊天室切换-2026-11-19.md §二 M2：影子双跑（读双写只写
 *     localfile、对账差异=0；双跑≥24h 0 差异才允许切换）
 *   - docs/sentinel-logs/单子自研切换-runbook-2026-11-19.md §七（M2 阻断项与双跑闸门）
 *   - packages/localplatform/src/binding.ts（平台态逐字；未映射=observe-unmapped 非错误）
 *
 * 形态：**只读**——源=冻结快照（taiga-export/v1，contentSha256 自证），靶=平台树
 * （issues/ 树扫，不信 list() 单一通道；本版 localplatform list() 已修前缀盲区，但
 * 双跑器独立树扫保持与迁移器同口径的确定性）。
 *
 * 增量游标：--cursor <iso> 显式给，否则=平台树内最大 updated（上次对账水位）。游标只
 * 影响「源侧是否新动」的判定（source-ahead），存在性与内容比对始终全量（1554 单全比
 * ≈200ms，全量是双跑的语义要求：差异=0 是整树断言，不是抽样）。
 *
 * drift 分类（零静默；exit 0 iff drift==0）：
 *   - missing-ticket   源有平台无（ID 保留口径破坏/漏迁）
 *   - extra-ticket     平台有源无且非 LOCAL-N（计划外外源 id）；LOCAL-N=平台原生建单→披露不算 drift
 *   - source-ahead     源 modified>游标 且内容已漂移（Taiga 写口未冻结/快照过期——双跑期最严重项）
 *   - content-mismatch 内容漂移（title/state/description/字段/lane/评论数——负对照可检出面）
 * 披露（不算 drift）：platform-ahead（平台侧有晚于源 modified 的事件——双跑期 daemon 正常
 * 写入痕迹）、未映射态（binding.ts observe-unmapped）。
 *
 * 用法：node scripts/taiga-localplatform-dualrun.ts --snapshot <taiga-export.json> --root <platform root> [--cursor <iso>]
 * 退出码：0=0 drift；1=存在 drift；2=用法/结构错误（含快照哈希不符）。
 */
import { existsSync, readdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLocalPlatform } from '../packages/localplatform/src/index.ts'
import type { FlowPlatform } from '../packages/contract/src/ports/platform.ts'
import { loadTaigaSnapshot } from './taiga-snapshot.ts'
import { UsageError, stateRowOf } from './workbench-issues-migrate.ts'

export const DUALRUN_SCHEMA = 'taiga-localplatform-dualrun/v1'

export interface DualrunDrift {
  readonly kind: 'missing-ticket' | 'extra-ticket' | 'source-ahead' | 'content-mismatch'
  readonly issue: string
  readonly detail: string
}

export interface DualrunReport {
  readonly schema: typeof DUALRUN_SCHEMA
  readonly root: string
  readonly snapshot: string
  readonly contentSha256: string
  readonly cursor: string
  readonly cursorOrigin: 'flag' | 'platform-max-updated'
  readonly ok: boolean
  readonly counts: {
    readonly source: number
    readonly platform: number
    readonly shared: number
    readonly checkedFull: number
  }
  readonly drift: readonly DualrunDrift[]
  readonly disclosures: readonly string[]
}

/** 树扫 issues/*.jsonl（与迁移器同口径；不依赖 list() 通道） */
function scanPlatformIssueIds(root: string): string[] {
  const dir = path.join(root, 'issues')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => name.slice(0, -'.jsonl'.length))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** 同 shape 口径（title/state/description/type/dept/level/assignee/lane/评论数）；返回首个差异面或 null */
function contentDiffers(
  record: { title: string; state: string; description?: string; type?: string; dept?: string; level?: number; assignee?: string; lane?: string },
  row: { subject: string; statusName: string; description: string; type: string | null; dept: string | null; level: number | null; assignee: string | null; lane: string | null },
  rowId: string,
  platformComments: number,
  sourceComments: number,
): string | null {
  const titleWant = row.subject.trim() === '' ? `[${rowId}]` : row.subject
  if (record.title !== titleWant) return 'title'
  if (record.state !== row.statusName) return 'state'
  if ((record.description ?? '') !== row.description) return 'description'
  if ((record.type ?? null) !== row.type) return 'type'
  if ((record.dept ?? null) !== row.dept) return 'dept'
  if ((record.level ?? null) !== row.level) return 'level'
  if ((record.assignee ?? null) !== row.assignee) return 'assignee'
  if ((record.lane ?? null) !== row.lane) return 'lane'
  if (platformComments !== sourceComments) return `comments(${String(platformComments)}≠${String(sourceComments)})`
  return null
}

export async function dualrunReconcile(snapshotPath: string, root: string, cursorArg?: string): Promise<DualrunReport> {
  const snapshot = loadTaigaSnapshot(snapshotPath)
  const platform: FlowPlatform = createLocalPlatform(root, { now: () => new Date(0).toISOString() })
  const platformIds = scanPlatformIssueIds(root)
  const platformIdSet = new Set(platformIds)

  // 游标：显式 > 平台最大 updated
  let cursor: string
  let cursorOrigin: 'flag' | 'platform-max-updated' = 'flag'
  if (cursorArg !== undefined) {
    if (Number.isNaN(Date.parse(cursorArg)) || !cursorArg.endsWith('Z')) throw new UsageError(`--cursor 需为 UTC ISO-8601（…Z），得到 ${cursorArg}`)
    cursor = cursorArg
  } else {
    cursor = '1970-01-01T00:00:00.000Z'
    cursorOrigin = 'platform-max-updated'
    for (const id of platformIds) {
      try {
        const rec = await platform.issues.get(id)
        if (rec.updated > cursor) cursor = rec.updated
      } catch {
        // 坏单在逐单比对面报 drift，这里不重复计
      }
    }
  }

  const drift: DualrunDrift[] = []
  const disclosures: string[] = []
  let shared = 0
  let checkedFull = 0

  // 1) 存在性
  for (const row of snapshot.rows) {
    if (!platformIdSet.has(row.id)) drift.push({ kind: 'missing-ticket', issue: row.id, detail: `平台树缺单（源 modified=${row.modifiedIso}）——ID 保留口径破坏或漏迁` })
  }
  const sourceIdSet = new Set(snapshot.rows.map((r) => r.id))
  const platformNative: string[] = []
  for (const id of platformIds) {
    if (sourceIdSet.has(id)) continue
    if (/^LOCAL-\d+$/.test(id)) {
      platformNative.push(id)
    } else {
      drift.push({ kind: 'extra-ticket', issue: id, detail: '平台树存在快照没有的外源 id（非 LOCAL-N 平台原生建单）——计划外写入' })
    }
  }
  if (platformNative.length > 0) disclosures.push(`平台原生建单 ${String(platformNative.length)} 张（LOCAL-N，双跑期 daemon 正常写入）：${platformNative.slice(0, 5).join('、')}${platformNative.length > 5 ? '…' : ''}`)

  // 2) 共有单：内容全比 + 源侧游标判定
  let platformAhead = 0
  for (const row of snapshot.rows) {
    if (!platformIdSet.has(row.id)) continue
    shared += 1
    checkedFull += 1
    let record: Awaited<ReturnType<FlowPlatform['issues']['get']>> | undefined
    try {
      record = await platform.issues.get(row.id)
    } catch (cause) {
      drift.push({ kind: 'content-mismatch', issue: row.id, detail: `平台读失败：${String(cause)}` })
      continue
    }
    let platformComments = 0
    try {
      platformComments = (await platform.comments.list(row.id)).length
    } catch {
      drift.push({ kind: 'content-mismatch', issue: row.id, detail: '平台评论读失败' })
      continue
    }
    const differs = contentDiffers(record, row, row.id, platformComments, row.comments.length)
    if (record.updated > row.modifiedIso && record.updated > cursor) platformAhead += 1
    if (differs === null) continue
    if (row.modifiedIso > cursor) {
      drift.push({ kind: 'source-ahead', issue: row.id, detail: `源 modified=${row.modifiedIso} 晚于游标 ${cursor} 且内容漂移（${differs}）——Taiga 写口未冻结或快照过期，双跑期最严重项` })
    } else {
      drift.push({ kind: 'content-mismatch', issue: row.id, detail: `内容漂移（${differs}）：平台侧偏离冻结快照` })
    }
  }
  if (platformAhead > 0) disclosures.push(`platform-ahead ${String(platformAhead)} 单：平台事件晚于源 modified（双跑期 daemon 正常写入痕迹，当前 shape 已全比一致）`)

  const unmapped = [...new Set(snapshot.rows.filter((r) => stateRowOf(r.statusName) === undefined).map((r) => r.statusName))].sort()
  if (unmapped.length > 0) disclosures.push(`未映射态 ${unmapped.join('、')}：binding.ts=observe-unmapped（平台态逐字已核对），非 drift`)

  return {
    schema: DUALRUN_SCHEMA,
    root,
    snapshot: snapshot.snapshotFile,
    contentSha256: snapshot.manifest.contentSha256,
    cursor,
    cursorOrigin,
    ok: drift.length === 0,
    counts: { source: snapshot.rows.length, platform: platformIds.length, shared, checkedFull },
    drift,
    disclosures,
  }
}

/* ------------------------------------------------------------------ */
/* CLI                                                                */
/* ------------------------------------------------------------------ */

function isDirectRun(): boolean {
  const argv1 = process.argv[1]
  if (argv1 === undefined) return false
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

const USAGE = '用法：node scripts/taiga-localplatform-dualrun.ts --snapshot <taiga-export.json> --root <platform root> [--cursor <utc-iso>]'

export async function dualrunCli(argv: readonly string[]): Promise<{ code: number; stdout: string }> {
  const args = [...argv]
  const take = (flag: string): string | undefined => {
    const i = args.indexOf(flag)
    if (i === -1) return undefined
    const value = args[i + 1]
    if (value === undefined) throw new UsageError(`${flag} 需要一个值；${USAGE}`)
    args.splice(i, 2)
    return value
  }
  const snapshotPath = take('--snapshot')
  const rootArg = take('--root')
  const cursorArg = take('--cursor')
  if (args.some((a) => a === '--help' || a === '-h')) return { code: 0, stdout: `${USAGE}\n` }
  if (args.length > 0) throw new UsageError(`未知参数：${args.join(' ')}；${USAGE}`)
  if (snapshotPath === undefined || rootArg === undefined) throw new UsageError(`--snapshot 与 --root 必填；${USAGE}`)
  if (!existsSync(rootArg)) throw new UsageError(`平台根不存在：${rootArg}`)
  if (!existsSync(snapshotPath)) throw new UsageError(`快照不存在：${snapshotPath}`)

  const t0 = performance.now()
  const report = await dualrunReconcile(snapshotPath, rootArg, cursorArg)
  const ms = Math.round(performance.now() - t0)
  const summary = `双跑对账完成（${String(ms)}ms）：源 ${String(report.counts.source)} / 平台 ${String(report.counts.platform)} / 共有 ${String(report.counts.shared)}（全比 ${String(report.counts.checkedFull)}）/ 游标 ${report.cursor}（${report.cursorOrigin}）/ drift ${String(report.drift.length)} / 披露 ${String(report.disclosures.length)} → ${report.ok ? '0-DRIFT 通过' : '存在 drift'}\n`
  return { code: report.ok ? 0 : 1, stdout: `${JSON.stringify(report, null, 2)}\n${summary}` }
}

if (isDirectRun()) {
  try {
    const { code, stdout } = await dualrunCli(process.argv.slice(2))
    process.stdout.write(stdout)
    process.exit(code)
  } catch (cause) {
    if (cause instanceof UsageError) {
      console.error(`[taiga-localplatform-dualrun] ${cause.message}`)
      process.exit(2)
    }
    throw cause
  }
}
