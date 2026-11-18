/**
 * workbench-issues-diff —— 单子切换准备·逐单对账（task-127-A，dry-run）
 *
 * 源 fixture ⇄「导入计划」模拟目标（plan.issues[].target 即 vendor issues 形态投影）逐单对账：
 *   自然键齐全性／title／body／状态码+legacy 标签／kind・priority・requiresHuman／labels 回溯／
 *   assignee／parent 链／评论（author/body/reply 链/时间戳）／created・updated・done 时间戳／
 *   去重审计（last-write-wins）／计划完整性（planHash 重算）／计数一致。
 * 0 差异 → exit 0；有差异 → 显式 gap 清单（JSON）+ exit 1。计划内已记录的 gap 以 plan:<kind> 前缀并入。
 *
 * 依据：docs/sentinel-logs/单子切换-runbook-2026-11-18.md §五（验收证据清单：diff exit=0 才算过）。
 * 边界：只读 fixture 与计划文件；不写数据库、不接网络。
 *
 * 用法：node scripts/workbench-issues-diff.ts --plan <plan.json> [--fixture <taiga-export.json>] [--out <diff.json>]
 * 退出码：0=零差异；1=显式 gap 清单；2=用法/文件结构错误。
 */
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_FIXTURE,
  PLAN_SCHEMA,
  UsageError,
  chainDepthOf,
  dedupIssues,
  kindOf,
  labelsForIssue,
  loadFixtureFromPath,
  makeKeyOf,
  naturalKeyOf,
  planHashOf,
  priorityOf,
  sortedCommentsOf,
  stateRowOf,
  titleOf,
  type FixtureIssue,
  type ImportPlan,
  type KeptRecord,
  type PlannedIssue,
  type TaigaExportFixture,
} from './workbench-issues-migrate.ts'

export const DIFF_SCHEMA = 'issues-migrate-diff/v1'

export interface DiffGap {
  readonly kind: string
  readonly issue: string | null
  readonly detail: string
}

export interface DiffReport {
  readonly schema: string
  readonly ok: boolean
  readonly fixture: { readonly schema: string; readonly exportedAt: number }
  readonly plan: { readonly schema: string; readonly planHash: string; readonly planHashIntact: boolean }
  readonly counts: {
    readonly sourceRecords: number
    readonly sourceIssuesUnique: number
    readonly plannedIssues: number
    readonly sourceComments: number
    readonly plannedComments: number
    readonly parentsLinked: number
    readonly gaps: number
  }
  readonly perIssue: readonly { readonly naturalKey: string; readonly key: string | null; readonly ok: boolean; readonly gapKinds: readonly string[] }[]
  readonly gaps: readonly DiffGap[]
}

function loadPlanFromPath(planPath: string): ImportPlan {
  let text: string
  try {
    text = readFileSync(planPath, 'utf8')
  } catch (cause) {
    throw new UsageError(`plan 不可读：${planPath}（${String(cause)}）`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new UsageError(`${planPath}: JSON 解析失败（${String(cause)}）`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new UsageError(`${planPath}: 计划应为对象`)
  const plan = parsed as Partial<ImportPlan>
  if (plan.schema !== PLAN_SCHEMA) throw new UsageError(`${planPath}: schema 期望 ${PLAN_SCHEMA}，实为 ${String(plan.schema)}`)
  if (plan.meta === undefined || plan.issues === undefined || plan.gaps === undefined || plan.counts === undefined || plan.dedup === undefined) {
    throw new UsageError(`${planPath}: 计划缺 meta/issues/gaps/counts/dedup 域`)
  }
  for (const issue of plan.issues) {
    if (issue === null || typeof issue !== 'object' || issue.naturalKey === undefined || issue.target === undefined) {
      throw new UsageError(`${planPath}: 计划 issues[] 存在缺 naturalKey/target 的条目`)
    }
  }
  return plan as ImportPlan
}

function compareField(gaps: DiffGap[], nk: string, field: string, expected: unknown, actual: unknown): void {
  const e = JSON.stringify(expected)
  const a = JSON.stringify(actual)
  if (e !== a) gaps.push({ kind: `mismatch:${field}`, issue: nk, detail: `expected=${e} actual=${a}` })
}

function diffIssue(source: FixtureIssue, entry: PlannedIssue, keyOf: (project: string, id: number) => string, kept: ReadonlyMap<string, KeptRecord>, gaps: DiffGap[]): void {
  const nk = naturalKeyOf(source)
  const ticket = entry.target.ticket
  const stateRow = stateRowOf(source.status)

  if (stateRow === undefined) {
    gaps.push({ kind: 'status-unmapped', issue: nk, detail: `status="${source.status}" 不在冻结映射表内；期望显式回退 NEW(1)` })
    compareField(gaps, nk, 'stateCode', 1, ticket.stateCode)
  } else {
    compareField(gaps, nk, 'stateCode', stateRow.to, ticket.stateCode)
    compareField(gaps, nk, 'stateName', stateRow.toName, ticket.stateName)
  }
  compareField(gaps, nk, 'key', keyOf(source.project, source.id), ticket.key)
  compareField(gaps, nk, 'title', titleOf(source, nk), ticket.title)
  compareField(gaps, nk, 'body', source.description, ticket.body)
  compareField(gaps, nk, 'kind', kindOf(source.type), ticket.kind)
  const priority = priorityOf(source.level)
  compareField(gaps, nk, 'priority', priority.priority, ticket.priority)
  compareField(gaps, nk, 'requiresHuman', priority.requiresHuman, ticket.requiresHuman)
  compareField(gaps, nk, 'assignee', source.assignee, ticket.assignee)
  compareField(gaps, nk, 'labels', [...labelsForIssue(source)].sort(), [...ticket.labels].sort())
  compareField(gaps, nk, 'createdAt', source.createdAt, ticket.createdAt)
  compareField(gaps, nk, 'updatedAt', source.updatedAt, ticket.updatedAt)
  compareField(gaps, nk, 'doneAt', source.closedAt, ticket.doneAt)
  compareField(gaps, nk, 'idempotencyKey', `issue-migrate:${nk}`, entry.idempotencyKey)

  // 层级：父在导出集内→期望链接；否则期望置空 + 显式 gap
  const expectedParentKey = source.parent !== null && kept.has(`${source.project}#${String(source.parent)}`)
    ? keyOf(source.project, source.parent)
    : null
  if (source.parent !== null && expectedParentKey === null) {
    gaps.push({ kind: 'parent-outside-export', issue: nk, detail: `parent=${String(source.parent)} 不在导出集内` })
  }
  compareField(gaps, nk, 'parentKey', expectedParentKey, ticket.parentKey)
  if (chainDepthOf(nk, kept) > 3) {
    gaps.push({ kind: 'parent-depth-exceeded', issue: nk, detail: `祖先深度 ${String(chainDepthOf(nk, kept))} > vendor MAX_PARENT_DEPTH=3` })
  }

  // 评论：规范序（createdAt, id）逐条对账
  const expectedComments = sortedCommentsOf(source)
  const actualComments = entry.target.comments
  if (expectedComments.length !== actualComments.length) {
    gaps.push({ kind: 'mismatch:comments', issue: nk, detail: `expected=${String(expectedComments.length)} 条 actual=${String(actualComments.length)} 条` })
  }
  const bound = Math.min(expectedComments.length, actualComments.length)
  for (let i = 0; i < bound; i += 1) {
    const expected = expectedComments[i]
    const actual = actualComments[i]
    if (actual === undefined || expected === undefined) continue
    compareField(gaps, nk, 'comments:body', expected.body, actual.body)
    if (actual.id !== expected.id || actual.author !== expected.author || actual.replyToCommentId !== expected.replyTo || actual.createdAt !== expected.createdAt) {
      gaps.push({
        kind: 'mismatch:comments',
        issue: nk,
        detail: `comment#${String(i)} expected={id:${expected.id},author:${expected.author},replyTo:${String(expected.replyTo)},createdAt:${String(expected.createdAt)}} actual={id:${actual.id},author:${actual.author},replyTo:${String(actual.replyToCommentId)},createdAt:${String(actual.createdAt)}}`,
      })
    }
  }
}

export function diffPlanAgainstSource(exported: TaigaExportFixture, plan: ImportPlan): DiffReport {
  const gaps: DiffGap[] = []
  const keyOf = makeKeyOf(exported)
  const { kept, dropped } = dedupIssues(exported.issues)
  const keptKeys = new Set(kept.keys())
  const planByNk = new Map(plan.issues.map((entry) => [entry.naturalKey, entry]))
  // 计划完整性：planHash 重算（防手改/防口径漂移）
  const planHashIntact = planHashOf(plan) === plan.meta.planHash
  if (!planHashIntact) gaps.push({ kind: 'plan-hash-mismatch', issue: null, detail: `expected=${planHashOf(plan)} actual=${plan.meta.planHash}（计划被改动或生成器口径漂移）` })

  const perIssue: { naturalKey: string; key: string | null; ok: boolean; gapKinds: string[] }[] = []
  const beforeCount = () => gaps.length
  for (const nk of [...keptKeys].sort()) {
    const record = kept.get(nk)
    if (record === undefined) continue
    const entry = planByNk.get(nk)
    if (entry === undefined) {
      gaps.push({ kind: 'missing-issue', issue: nk, detail: '源记录在计划中无对应条目' })
      perIssue.push({ naturalKey: nk, key: null, ok: false, gapKinds: ['missing-issue'] })
      continue
    }
    const mark = beforeCount()
    diffIssue(record.issue, entry, keyOf, kept, gaps)
    perIssue.push({ naturalKey: nk, key: entry.target.ticket.key, ok: gaps.length === mark, gapKinds: gaps.slice(mark).map((g) => g.kind) })
  }
  for (const nk of planByNk.keys()) {
    if (!keptKeys.has(nk)) gaps.push({ kind: 'extra-plan-issue', issue: nk, detail: '计划条目在源（去重后）中无对应记录' })
  }

  // 去重审计：源侧重算 dropped；被丢弃者不得比保留者新
  if (plan.dedup.dropped.length !== dropped.length || plan.dedup.inputRecords !== exported.issues.length) {
    gaps.push({ kind: 'mismatch:dedup', issue: null, detail: `expected={inputRecords:${String(exported.issues.length)},dropped:${String(dropped.length)}} actual={inputRecords:${String(plan.dedup.inputRecords)},dropped:${String(plan.dedup.dropped.length)}}` })
  }
  for (const drop of dropped) {
    const keptRecord = kept.get(drop.naturalKey)
    if (keptRecord === undefined || keptRecord.issue.updatedAt < drop.droppedUpdatedAt) {
      gaps.push({ kind: 'dedup-newer-dropped', issue: drop.naturalKey, detail: `被丢弃记录 updatedAt=${String(drop.droppedUpdatedAt)} 不旧于保留者 ${keptRecord !== undefined ? String(keptRecord.issue.updatedAt) : '(缺失)'}` })
    }
  }

  // 计划内显式 gap 并入（前缀 plan:），保持「计划已知缺口」与「对账新发现」可区分
  for (const gap of plan.gaps) gaps.push({ kind: `plan:${gap.kind}`, issue: gap.issue, detail: gap.detail })

  const sourceComments = [...kept.values()].reduce((sum, { issue }) => sum + issue.comments.length, 0)
  const plannedComments = plan.issues.reduce((sum, entry) => sum + entry.target.comments.length, 0)
  const parentsLinked = plan.issues.filter((entry) => entry.target.ticket.parentKey !== null).length
  if (plan.issues.length !== kept.size) {
    gaps.push({ kind: 'count-mismatch', issue: null, detail: `issues expected=${String(kept.size)} actual=${String(plan.issues.length)}` })
  }
  if (plannedComments !== sourceComments) {
    gaps.push({ kind: 'count-mismatch', issue: null, detail: `comments expected=${String(sourceComments)} actual=${String(plannedComments)}` })
  }
  if (plan.counts.plannedComments !== plannedComments || plan.counts.plannedIssues !== plan.issues.length) {
    gaps.push({ kind: 'count-mismatch', issue: null, detail: `计划自带计数与载荷不符 counts=${JSON.stringify(plan.counts)}` })
  }

  return {
    schema: DIFF_SCHEMA,
    ok: gaps.length === 0,
    fixture: { schema: exported.schema, exportedAt: exported.exportedAt },
    plan: { schema: plan.schema, planHash: plan.meta.planHash, planHashIntact },
    counts: {
      sourceRecords: exported.issues.length,
      sourceIssuesUnique: kept.size,
      plannedIssues: plan.issues.length,
      sourceComments,
      plannedComments,
      parentsLinked,
      gaps: gaps.length,
    },
    perIssue,
    gaps,
  }
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

const USAGE = '用法：node scripts/workbench-issues-diff.ts --plan <plan.json> [--fixture <taiga-export.json>] [--out <diff.json>]'

function isDirectRun(): boolean {
  const argv1 = process.argv[1]
  if (argv1 === undefined) return false
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

export function diffCli(argv: readonly string[]): { code: number; stdout: string } {
  const args = [...argv]
  const valueOf = (name: string): string | undefined => {
    const i = args.indexOf(name)
    if (i < 0) return undefined
    const value = args[i + 1]
    if (value === undefined) throw new UsageError(`${name} 缺参数；${USAGE}`)
    args.splice(i, 2)
    return value
  }
  const planPath = valueOf('--plan')
  const fixturePath = valueOf('--fixture') ?? DEFAULT_FIXTURE
  const outPath = valueOf('--out')
  if (args.some((a) => a === '--help' || a === '-h')) return { code: 0, stdout: `${USAGE}\n` }
  if (args.length > 0) throw new UsageError(`未知参数：${args.join(' ')}；${USAGE}`)
  if (planPath === undefined) throw new UsageError(`--plan 必填；${USAGE}`)

  const report = diffPlanAgainstSource(loadFixtureFromPath(fixturePath), loadPlanFromPath(planPath))
  const text = `${JSON.stringify(report, null, 2)}\n`
  if (outPath !== undefined) {
    mkdirSync(path.dirname(outPath), { recursive: true })
    writeFileSync(outPath, text)
  }
  return { code: report.ok ? 0 : 1, stdout: text }
}

if (isDirectRun()) {
  try {
    const { code, stdout } = diffCli(process.argv.slice(2))
    process.stdout.write(stdout)
    process.exit(code)
  } catch (cause) {
    if (cause instanceof UsageError) {
      console.error(`[workbench-issues-diff] ${cause.message}`)
      process.exit(2)
    }
    throw cause
  }
}
