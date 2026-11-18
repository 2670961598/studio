/**
 * taiga-localplatform-diff —— M1 单子自研切换·源导出 vs LocalFile 平台树逐单对账（task-131）
 *
 * 依据：docs/plan/06-自研单子与聊天室切换-2026-11-19.md §二 M1（对账器：逐单核对数量/ID/
 * 状态/评论/父子）＋ §三.4 对账口径（0-diff 才允许切换；显式 gap 落盘）。
 *
 * 对账三方：
 *   - 源=docs/quality/phase0/ticket-export.json（真实 10 单只读导出，逐字真值）
 *   - 平台树=createLocalPlatform(root) 读回 + `issues/` 目录树扫（**必须树扫**：
 *     localplatform list() 只扫 `LOCAL-` 前缀（issues.ts scanIssueIds），迁移保留的
 *     `studio-dev-N` ID 对 list() 不可见——M1 记录在案的端口缺口，对账不得被它蒙蔽）
 *   - 期望表=ticket-diff.json（Phase0 独立真值：idRoundtrip/快照态冻结表重现/漂移披露）
 *
 * gap 分类（全部显式，零静默）：
 *   count/ID：count-mismatch / missing-ticket / extra-ticket
 *   逐单：title-mismatch / state-mismatch / state-unmapped / field-mismatch / parent-mismatch /
 *         lane-mismatch / updated-mismatch / comments-count / comments-content / link-missing /
 *         issue-unreadable
 *   平台面：provision-missing-state
 *   期望表：expectation:*（冻结表漂移=停手级）
 *   漂移（导出晚于 Phase0 快照）：**不算 gap**，显式披露（drift[]），真迁窗口逐项豁免签认
 *
 * 用法：node scripts/taiga-localplatform-diff.ts [--export <ticket-export.json>]
 *        [--expectations <ticket-diff.json> | --skip-expectations] [--root <platform root>]
 * 退出码：0=0 gap（可切换口径）；1=存在显式 gap；2=用法/文件结构错误。
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLocalPlatform } from '../packages/localplatform/src/index.ts'
import type { FieldProvisionMap, FlowPlatform, IssueRecord } from '../packages/contract/src/ports/platform.ts'
import { DEFAULT_EXPORT, DEFAULT_EXPECTATIONS, loadExpectations, loadPhase0Export } from './workbench-issues-rehearse.ts'
import { DEFAULT_ROOT } from './taiga-localplatform-migrate.ts'
import { UsageError, stateRowOf, type PlanGap } from './workbench-issues-migrate.ts'
import type { Expectations, Phase0Export, Phase0Row } from './workbench-issues-rehearse.ts'

export const DIFF_SCHEMA = 'taiga-localplatform-diff/v1'

/* ------------------------------------------------------------------ */
/* 报告类型                                                            */
/* ------------------------------------------------------------------ */

export interface DiffCounts {
  readonly source: number
  readonly platform: number
  readonly matched: number
  readonly commentsSource: number
  readonly commentsPlatform: number
  readonly linksSource: number
  readonly linksPlatform: number
}

export interface DriftDisclosure {
  readonly issue: string
  readonly snapshotState: string
  readonly currentState: string
  readonly snapshotDesiredCode: number
  readonly platformCode: number | null
  readonly note: string
}

export interface DiffReport {
  readonly schema: typeof DIFF_SCHEMA
  readonly root: string
  readonly ok: boolean
  readonly counts: DiffCounts
  readonly drift: readonly DriftDisclosure[]
  readonly gaps: readonly DiffGap[]
  /** 源 fixture 自身的已知不迁项披露（comments/附件/标题合成——期望表登记，非平台 gap） */
  readonly sourceDisclosures: readonly string[]
}

export interface DiffGap extends PlanGap {}

function isoOf(epochMs: number): string {
  return new Date(epochMs).toISOString()
}

/** 树扫 issues/*.jsonl（对账入口；坏目录=结构错误 fail-closed） */
function scanPlatformIssueIds(root: string): string[] {
  const dir = path.join(root, 'issues')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => name.slice(0, -'.jsonl'.length))
    .sort((a, b) => splitIssueRefSafe(a) - splitIssueRefSafe(b))
}

function splitIssueRefSafe(ref: string): number {
  const m = /-(\d+)$/.exec(ref)
  return m === null ? Number.MAX_SAFE_INTEGER : Number(m[1])
}

/* ------------------------------------------------------------------ */
/* 对账核心                                                            */
/* ------------------------------------------------------------------ */

export async function diffExportAgainstPlatform(
  exported: Phase0Export,
  root: string,
  expectations: Expectations | null,
): Promise<DiffReport> {
  const gaps: DiffGap[] = []
  const drift: DriftDisclosure[] = []
  const disclosures: string[] = []

  // 源行去重与迁移器同语义（last-write-wins）；对账用同口径
  const kept = new Map<string, { row: Phase0Row; index: number }>()
  exported.rows.forEach((row, index) => {
    const current = kept.get(row.issue)
    if (current === undefined) {
      kept.set(row.issue, { row, index })
      return
    }
    if (row.updated > current.row.updated || (row.updated === current.row.updated && index > current.index)) kept.set(row.issue, { row, index })
  })
  const rows = [...kept.values()].map((k) => k.row)

  const platform: FlowPlatform = createLocalPlatform(root, { now: () => new Date(0).toISOString() })
  const platformIds = scanPlatformIssueIds(root)

  // 1) 数量与 ID（树扫口径）
  const sourceIds = rows.map((r) => r.issue)
  if (platformIds.length !== sourceIds.length) {
    gaps.push({ kind: 'count-mismatch', issue: null, detail: `源 ${String(sourceIds.length)} 单 vs 平台树 ${String(platformIds.length)} 单` })
  }
  for (const id of sourceIds) {
    if (!platformIds.includes(id)) gaps.push({ kind: 'missing-ticket', issue: id, detail: `平台树缺单 ${id}（ID 保留口径：源 ref 必须原样在树内）` })
  }
  const sourceIdSet = new Set(sourceIds)
  for (const id of platformIds) {
    if (!sourceIdSet.has(id)) gaps.push({ kind: 'extra-ticket', issue: id, detail: `平台树存在源导出没有的单 ${id}` })
  }

  // 2) 逐单核对（get() 对任意 ID 均可读——树扫出的都查）
  let matched = 0
  let commentsSource = 0
  let commentsPlatform = 0
  let linksSource = 0
  let linksPlatform = 0
  const byIssue = new Map(rows.map((r) => [r.issue, r]))
  for (const row of rows) {
    const record = await wrap(() => platform.issues.get(row.issue), row.issue, gaps)
    if (record === undefined) continue
    commentsSource += row.comments.length
    const titleWant = `[${row.issue}] ${row.type} · ${row.state}`
    if (record.title !== titleWant) gaps.push({ kind: 'title-mismatch', issue: row.issue, detail: `title 平台="${record.title}" 期望="${titleWant}"（口径=externalRef/type/state 合成）` })
    if (record.state !== row.state) gaps.push({ kind: 'state-mismatch', issue: row.issue, detail: `state 平台="${record.state}" 源="${row.state}"（binding.ts 口径：平台态字符串逐字保留）` })
    const mapped = stateRowOf(row.state)
    if (mapped === undefined) gaps.push({ kind: 'state-unmapped', issue: row.issue, detail: `源态 "${row.state}" 不在 STATE_MAP 冻结表——对账码不可得（迁移器已按平台态逐字迁移）` })
    if (record.type !== row.type || record.dept !== row.dept || record.level !== row.level || (record.assignee ?? null) !== row.assignee) {
      gaps.push({ kind: 'field-mismatch', issue: row.issue, detail: `字段漂移 平台 type="${String(record.type)}" dept="${String(record.dept)}" level=${String(record.level)} assignee="${String(record.assignee ?? null)}" vs 源 type="${row.type}" dept="${row.dept}" level=${String(row.level)} assignee="${String(row.assignee)}"` })
    }
    if ((record.parent ?? null) !== row.parent) gaps.push({ kind: 'parent-mismatch', issue: row.issue, detail: `parent 平台="${String(record.parent ?? null)}" 源="${String(row.parent)}"` })
    if ((record.lane ?? null) !== row.lane) gaps.push({ kind: 'lane-mismatch', issue: row.issue, detail: `lane 平台="${String(record.lane ?? null)}" 源="${String(row.lane)}"` })
    const updatedWant = isoOf(Math.min(row.created, row.updated))
    if (record.updated !== updatedWant) gaps.push({ kind: 'updated-mismatch', issue: row.issue, detail: `updated 平台="${record.updated}" 期望="${updatedWant}"（平台 updated=末事件 ts；本迁移事件时间戳全取源数据）` })

    // 评论：数量+逐字内容+作者+时间戳
    const pComments = (await wrap(() => platform.comments.list(row.issue), row.issue, gaps)) ?? []
    commentsPlatform += pComments.length
    if (pComments.length !== row.comments.length) {
      gaps.push({ kind: 'comments-count', issue: row.issue, detail: `评论数 平台=${String(pComments.length)} 源=${String(row.comments.length)}` })
    }
    const sortedSource = [...row.comments].sort((a, b) => (a.createdAt !== b.createdAt ? a.createdAt - b.createdAt : a.id < b.id ? -1 : 1))
    for (let i = 0; i < Math.min(pComments.length, sortedSource.length); i += 1) {
      const got = pComments[i]
      const want = sortedSource[i]
      if (got !== undefined && want !== undefined && (got.author !== want.author || got.body !== want.body || got.created !== isoOf(want.createdAt))) {
        gaps.push({ kind: 'comments-content', issue: row.issue, detail: `评论[${String(i)}] 内容漂移 平台 author="${got.author}" created="${got.created}" vs 源 author="${want.author}" createdAt="${isoOf(want.createdAt)}"（body 逐字比对省略）` })
      }
    }

    // 父子：parent 字段已在上面核对；此处核对链接面（links.children=显式链接∪parent 字段）
    if (row.parent !== null) {
      linksSource += 1
      if (sourceIdSet.has(row.parent)) {
        const children = (await wrap(() => platform.links.children(row.parent), row.parent, gaps)) ?? []
        if (!children.includes(row.issue)) gaps.push({ kind: 'link-missing', issue: row.issue, detail: `parent-child 链接缺失：children(${row.parent})=${JSON.stringify(children)} 不含 ${row.issue}` })
        else linksPlatform += 1
      }
    }

    if (!gaps.some((g) => g.issue === row.issue)) matched += 1
  }

  // 3) provision 覆盖：源态全集必须在 provision.states 内（create/setField 合法性前提；直读 meta/fields.json——schema() 只有字段面）
  const distinctStates = [...new Set(rows.map((r) => r.state))]
  const fieldsFile = path.join(root, 'meta', 'fields.json')
  if (existsSync(fieldsFile)) {
    const provision = (JSON.parse(readFileSync(fieldsFile, 'utf8')) as { provision?: FieldProvisionMap }).provision
    const declared = new Set(provision?.states ?? [])
    for (const state of distinctStates) {
      if (!declared.has(state)) gaps.push({ kind: 'provision-missing-state', issue: null, detail: `平台态 "${state}" 不在 provision.states 内（该态单据在平台 create/transition 合法性无声明——补 provision 后重迁）` })
    }
  } else {
    gaps.push({ kind: 'provision-missing-state', issue: null, detail: `meta/fields.json 不存在（provision 未建档；迁移器应先落 provision）` })
  }

  // 4) 期望表（独立真值）：idRoundtrip / 快照冻结表重现 / 漂移披露
  if (expectations !== null) {
    if (!expectations.idRoundtrip) gaps.push({ kind: 'expectation:id-roundtrip', issue: null, detail: '期望表 idRoundtrip=false（Phase0 自身未过——不可作为切换依据）' })
    for (const m of expectations.mapping) {
      const snapshotRow = stateRowOf(m.originalState)
      if (snapshotRow === undefined) {
        gaps.push({ kind: 'expectation:snapshot-unmapped', issue: m.externalRef, detail: `originalState "${m.originalState}" 不在 STATE_MAP 冻结表` })
        continue
      }
      if (snapshotRow.to !== m.desiredStateCode) {
        gaps.push({ kind: 'expectation:state-map-drift', issue: m.externalRef, detail: `STATE_MAP["${m.originalState}"]=${String(snapshotRow.to)} ≠ Phase0 desiredStateCode=${String(m.desiredStateCode)}（冻结映射表漂移，停手走提案流）` })
        continue
      }
      if (!m.stateMatched || m.importedStateCode !== m.desiredStateCode) {
        gaps.push({ kind: 'expectation:phase0-not-matched', issue: m.externalRef, detail: `Phase0 自身记录未对齐（stateMatched=${String(m.stateMatched)}）` })
        continue
      }
      const live = byIssue.get(m.externalRef)
      if (live === undefined) {
        gaps.push({ kind: 'expectation:missing-export-row', issue: m.externalRef, detail: '期望表行在当前导出无对应记录（导出集变化）' })
        continue
      }
      if (live.state !== m.originalState) {
        const platformState = platformIds.includes(m.externalRef)
        drift.push({
          issue: m.externalRef,
          snapshotState: m.originalState,
          currentState: live.state,
          snapshotDesiredCode: m.desiredStateCode,
          platformCode: stateRowOf(live.state)?.to ?? null,
          note: `导出状态 "${live.state}" 晚于 Phase0 快照 "${m.originalState}"（单据已继续流转）；平台按活数据迁移=${live.state}（码 ${String(stateRowOf(live.state)?.to ?? null)}），快照期望码=${String(m.desiredStateCode)}；真迁窗口逐项豁免签认${platformState ? '' : '（且该单在平台树缺失）'}`,
        })
      }
    }
    // 源侧已知不迁项披露（期望表登记——非平台 gap，不拦切换，但必须随报告落盘）
    disclosures.push('commentsImported=0：台账镜像无评论表（期望表 commentsGap 显式登记；评论面真迁时按 Phase0 评估 §二.1 另行批）')
    disclosures.push('附件=不迁（期望表 attachments=not-migrated (explicit)；v1 显式不做）')
    disclosures.push('标题合成：台账镜像无 title/description（期望表 titleGap；title=[ref] type · state 合成，源行 JSON 在 description 溯源）')
  }

  return {
    schema: DIFF_SCHEMA,
    root,
    ok: gaps.length === 0,
    counts: {
      source: rows.length,
      platform: platformIds.length,
      matched,
      commentsSource,
      commentsPlatform,
      linksSource,
      linksPlatform,
    },
    drift,
    gaps,
    sourceDisclosures: disclosures,
  }
}

/** 平台读异常→显式 gap（不静默吞）；返回 undefined 表示该面不可比 */
async function wrap<T>(fn: () => Promise<T>, issue: string | null, gaps: DiffGap[]): Promise<T | undefined> {
  try {
    return await fn()
  } catch (cause) {
    gaps.push({ kind: 'issue-unreadable', issue, detail: `平台读失败：${String(cause)}` })
    return undefined
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

const USAGE = '用法：node scripts/taiga-localplatform-diff.ts [--export <ticket-export.json>] [--expectations <ticket-diff.json> | --skip-expectations] [--root <platform root>]'

export async function diffCli(argv: readonly string[]): Promise<{ code: number; stdout: string }> {
  const args = [...argv]
  const take = (flag: string): string | undefined => {
    const i = args.indexOf(flag)
    if (i === -1) return undefined
    const value = args[i + 1]
    if (value === undefined) throw new UsageError(`${flag} 需要一个值；${USAGE}`)
    args.splice(i, 2)
    return value
  }
  const has = (flag: string): boolean => {
    const i = args.indexOf(flag)
    if (i === -1) return false
    args.splice(i, 1)
    return true
  }
  const exportPath = take('--export') ?? DEFAULT_EXPORT
  const expectationsPath = take('--expectations') ?? DEFAULT_EXPECTATIONS
  const rootArg = take('--root') ?? DEFAULT_ROOT
  const skipExpectations = has('--skip-expectations')
  if (args.some((a) => a === '--help' || a === '-h')) return { code: 0, stdout: `${USAGE}\n` }
  if (args.length > 0) throw new UsageError(`未知参数：${args.join(' ')}；${USAGE}`)
  if (!existsSync(rootArg)) throw new UsageError(`平台根不存在：${rootArg}（先跑 scripts/taiga-localplatform-migrate.ts）`)

  const exported = loadPhase0Export(exportPath)
  const expectations = skipExpectations ? null : loadExpectations(expectationsPath)
  const report = await diffExportAgainstPlatform(exported, rootArg, expectations)
  const summary = `对账完成：源 ${String(report.counts.source)} 单 / 平台 ${String(report.counts.platform)} 单 / 逐单全对 ${String(report.counts.matched)} / gap ${String(report.gaps.length)} / 漂移披露 ${String(report.drift.length)} → ${report.ok ? '0-GAP 通过' : '存在显式 gap'}\n`
  return { code: report.ok ? 0 : 1, stdout: `${JSON.stringify(report, null, 2)}\n${summary}` }
}

if (isDirectRun()) {
  try {
    const { code, stdout } = await diffCli(process.argv.slice(2))
    process.stdout.write(stdout)
    process.exit(code)
  } catch (cause) {
    if (cause instanceof UsageError) {
      console.error(`[taiga-localplatform-diff] ${cause.message}`)
      process.exit(2)
    }
    throw cause
  }
}
