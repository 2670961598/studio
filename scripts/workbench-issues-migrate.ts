/**
 * workbench-issues-migrate —— 单子切换准备·最小闭环（task-127-A，dry-run）
 *
 * 依据：docs/sentinel-logs/单子切换-runbook-2026-11-18.md（§七 本工具用法／§五 验收证据口径）、
 *       docs/sentinel-logs/评估-自研替代Taiga-Matrix-2026-11-16.md §二.1
 *       （ID 保留为 key／状态映射表／type・dept・level・lane 落 labels／评论保 author+reply）。
 * 状态映射口径与 scripts/qa/phase0-ticket-migration.ts:31-40（stateCodeOf）同源：
 *   新单→1 … 已收口/关闭/取消→8；vendor 状态名取自 vendor/workbench-core/issues/src/catalog.ts
 *   STATE_CATALOG（快照 v0.8，代码 1..8 冻结不重编号）。
 *
 * 边界（铁律）：只读 fixture → 生成「导入计划」JSON；**不写数据库、不接网络、不迁任何生产数据**。
 * 幂等：同一 fixture 生成内容一致的计划；meta.planHash = canonical(计划载荷) 的 sha256——
 *   载荷 = 计划去除 meta.planHash 与 dedup 审计域（重导出产生的重复记录不改变目标载荷）。
 * 目标形态：每单给出 vendor issues schema 形态（tickets 行 + labels + comments 行）；
 *   id/revision/seq 由 vendor 导入时生成，计划期以 key（<keyPrefix>-<源 ref>）与源评论 id 为句柄。
 *
 * 用法：node scripts/workbench-issues-migrate.ts [--fixture <path>] [--dry-run] [--out <path>]
 *   --dry-run  只打印 counts/planHash（sha256 of canonical plan），不写任何文件（--out 被忽略）
 *   --out      计划 JSON 落盘（pretty）；stdout 打印单行摘要
 *   默认       计划 JSON 打到 stdout（pretty）
 * 退出码：0=计划生成成功（gaps 属数据面，显式记录于计划内）；2=用法/fixture 结构错误。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PLAN_SCHEMA = 'issues-migrate-plan/v1'
export const FIXTURE_SCHEMA = 'taiga-export-fixture/v1'
export const DEFAULT_FIXTURE = path.resolve(import.meta.dirname, 'test/fixtures/issues-migrate/taiga-export.json')
export const TARGET_VENDOR = 'workbench-issues v0.8（vendor/workbench-core/issues 源码快照）'

/** 用法/结构错误：CLI 捕获后 exit 2（区别于数据面 gap——gap 显式记录、不失败） */
export class UsageError extends Error {}

/* ------------------------------------------------------------------ */
/* fixture 类型（Taiga 导出模拟）                                       */
/* ------------------------------------------------------------------ */

export interface FixtureComment {
  readonly id: string
  readonly author: string
  readonly body: string
  readonly replyTo: string | null
  readonly createdAt: number
}

export interface FixtureIssue {
  readonly id: number
  readonly project: string
  readonly subject: string
  readonly description: string
  readonly status: string
  readonly type: string
  readonly dept: string
  readonly level: number
  readonly lane: string | null
  readonly assignee: string | null
  readonly dispatcher: string | null
  readonly parent: number | null
  readonly comments: readonly FixtureComment[]
  readonly createdAt: number
  readonly updatedAt: number
  readonly closedAt: number | null
}

export interface FixtureUser {
  readonly id: number
  readonly username: string
  readonly fullName: string
  readonly kind: 'human' | 'agent'
}

export interface FixtureProject {
  readonly id: number
  readonly slug: string
  readonly name: string
  readonly keyPrefix: string
}

export interface TaigaExportFixture {
  readonly schema: string
  readonly exportedAt: number
  readonly source: string
  readonly projects: readonly FixtureProject[]
  readonly users: readonly FixtureUser[]
  readonly issues: readonly FixtureIssue[]
}

/* ------------------------------------------------------------------ */
/* 计划类型                                                            */
/* ------------------------------------------------------------------ */

export interface PlanGap {
  readonly kind: string
  readonly issue: string | null
  readonly detail: string
}

export interface StateMapRow {
  readonly from: string
  readonly to: number
  readonly toName: string
}

export interface FieldMapRow {
  readonly source: string
  readonly target: string
  readonly rule: string
  readonly note: string
}

export interface PlannedComment {
  readonly id: string
  readonly author: string
  readonly body: string
  readonly replyToCommentId: string | null
  readonly createdAt: number
}

export interface PlannedTicket {
  readonly key: string
  readonly title: string
  readonly body: string
  readonly kind: 'task' | 'bug' | 'chore'
  readonly priority: number
  readonly stateCode: number
  readonly stateName: string
  readonly requiresHuman: boolean
  readonly assignee: string | null
  readonly parentKey: string | null
  readonly labels: readonly string[]
  readonly createdAt: number
  readonly updatedAt: number
  readonly doneAt: number | null
}

export interface PlannedIssue {
  readonly naturalKey: string
  readonly sourceRef: { readonly project: string; readonly id: number; readonly status: string }
  readonly idempotencyKey: string
  readonly sourceHash: string
  readonly statusMapped: boolean
  readonly target: { readonly ticket: PlannedTicket; readonly comments: readonly PlannedComment[] }
}

export interface PlannedPrincipal {
  readonly username: string
  readonly kind: 'human' | 'agent'
  readonly displayName: string
}

export interface DroppedRecord {
  readonly naturalKey: string
  readonly id: number
  readonly project: string
  readonly droppedUpdatedAt: number
  readonly keptUpdatedAt: number
  readonly reason: string
}

export interface ImportPlan {
  readonly schema: string
  readonly meta: {
    readonly fixtureSchema: string
    readonly exportedAt: number
    readonly sourceHash: string
    readonly planHash: string
    readonly targetVendor: string
    readonly hashScope: string
  }
  readonly mapping: {
    readonly states: readonly StateMapRow[]
    readonly kinds: readonly { from: string; to: string }[]
    readonly priority: readonly { fromLevel: number; toPriority: number; requiresHuman: boolean }[]
    readonly fields: readonly FieldMapRow[]
  }
  readonly principals: readonly PlannedPrincipal[]
  readonly counts: {
    readonly plannedIssues: number
    readonly plannedComments: number
    readonly parentsLinked: number
    readonly statusMapped: number
    readonly statusUnmapped: number
  }
  readonly gaps: readonly PlanGap[]
  readonly issues: readonly PlannedIssue[]
  /** 审计域：不入 planHash（重导出的重复记录不改变目标载荷） */
  readonly dedup: {
    readonly naturalKey: readonly string[]
    readonly inputRecords: number
    readonly droppedDuplicateRecords: number
    readonly dropped: readonly DroppedRecord[]
  }
}

/* ------------------------------------------------------------------ */
/* 冻结映射表（与 phase0-ticket-migration stateCodeOf 同源；vendor 状态名见 catalog.ts） */
/* ------------------------------------------------------------------ */

export const STATE_MAP: readonly StateMapRow[] = [
  { from: '新单', to: 1, toName: 'NEW' },
  { from: '待批', to: 2, toName: 'TODO' },
  { from: '已派发', to: 3, toName: 'IN_PROGRESS' },
  { from: '证据就绪', to: 4, toName: 'TESTING' },
  { from: '复验中', to: 5, toName: 'TEST_IN_PROGRESS' },
  { from: '已交付', to: 6, toName: 'DONE' },
  { from: '打回', to: 7, toName: 'BLOCKED' },
  { from: '已收口', to: 8, toName: 'CANCELLED' },
  { from: '关闭', to: 8, toName: 'CANCELLED' },
  { from: '取消', to: 8, toName: 'CANCELLED' },
]

const KIND_MAP: readonly { from: string; to: 'task' | 'bug' | 'chore' }[] = [
  { from: 'bug', to: 'bug' },
  { from: 'chore', to: 'chore' },
  { from: 'patrol', to: 'chore' },
  { from: 'report', to: 'chore' },
  { from: 'task', to: 'task' },
]

const PRIORITY_MAP: readonly { fromLevel: number; toPriority: number; requiresHuman: boolean }[] = [
  { fromLevel: 1, toPriority: 3, requiresHuman: false },
  { fromLevel: 2, toPriority: 2, requiresHuman: false },
  { fromLevel: 3, toPriority: 1, requiresHuman: true },
]

const FIELD_MAP: readonly FieldMapRow[] = [
  { source: 'project + id', target: 'tickets.key（<keyPrefix>-<源 ref>）+ naturalKey <project>#<id>', rule: '公开 ID 保留为 key（评估 §二.1：不改历史 events/AIWS/report 引用）', note: 'vendor 内部 id/revision 导入时生成' },
  { source: 'subject', target: 'tickets.title', rule: '直传；空标题→gap + 兜底标题', note: 'vendor CHECK length 1..512' },
  { source: 'description', target: 'tickets.body', rule: '直传（可为空串）', note: 'vendor body TEXT NOT NULL DEFAULT \'\' ' },
  { source: 'status', target: 'tickets.state_code + label legacy-state-*', rule: 'STATE_MAP 冻结表；不可映射→显式 gap + 回退 NEW(1)', note: '已收口/关闭/取消 终态合并为 8，legacy-state 标签保原值可回溯' },
  { source: 'type', target: 'tickets.kind + label ext-type-*', rule: 'bug→bug；patrol/report/chore→chore；其余→task', note: 'vendor kind IN (task,bug,chore)' },
  { source: 'level', target: 'tickets.priority + label ext-level-<n>', rule: '1→3、2→2、3→1', note: 'vendor CHECK(priority>1 OR requires_human=1)：priority=1 时机械置 requiresHuman=true' },
  { source: 'dept', target: 'label ext-dept-*', rule: 'slug 化入 labels', note: 'vendor 无原生部门位（评估 §一.1）' },
  { source: 'lane', target: 'label ext-lane-*', rule: '非空时 slug 化入 labels', note: 'vendor 无泳道位' },
  { source: 'dispatcher', target: 'label ext-dispatcher-*', rule: '非空时 slug 化入 labels', note: 'vendor 无派单员位' },
  { source: 'assignee', target: 'tickets.assignee_id（经 principals 映射）', rule: 'username→计划 principals 表', note: '导入期解析为 vendor principal id' },
  { source: 'parent', target: 'tickets.parent_id（计划期以 parent_key 表示）', rule: '父在导出集内→链接；否则 gap + 置空', note: 'vendor MAX_PARENT_DEPTH=3，超深→gap' },
  { source: 'comments[].author', target: 'comments.author_id（经 principals 映射）', rule: 'username→principals；未知作者→gap', note: 'vendor comments append-only、flat+reply' },
  { source: 'comments[].replyTo', target: 'comments.reply_to_comment_id', rule: '指向同单源评论 id；锚缺失→gap + 置空', note: '计划期以源评论 id 为句柄' },
  { source: 'createdAt / updatedAt', target: 'tickets.created_at / updated_at', rule: '直传（epoch ms）', note: '导入器须支持自定义时钟' },
  { source: 'closedAt', target: 'tickets.done_at', rule: 'null 或直传', note: '终态 6/8 才有意义，导入器复核' },
  { source: 'attachments / watchers / KB', target: '（不迁）', rule: '本 fixture 不含；真迁时按评估 §二.1 另行批', note: '显式不做，不静默' },
]

/* ------------------------------------------------------------------ */
/* 基础件：canonical JSON / sha256 / slug                              */
/* ------------------------------------------------------------------ */

/** 确定性序列化：对象键递归排序、数组保序——hash 的唯一口径 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function sha256Of(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`
}

/** label 值 slug 化（phase0 labelOf 同法）；非 ASCII（如中文状态）回退 u-<hash8>，保证可回溯 */
export function slugOf(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
  return slug !== '' ? slug : `u-${sha256Hex(value).slice(0, 8)}`
}

/* ------------------------------------------------------------------ */
/* fixture 解析（结构错误→UsageError；数据问题→计划内 gap）              */
/* ------------------------------------------------------------------ */

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new UsageError(`${where}：应为对象`)
  return value as Record<string, unknown>
}
function asString(value: unknown, where: string): string {
  if (typeof value !== 'string') throw new UsageError(`${where}：应为字符串`)
  return value
}
function asNumber(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new UsageError(`${where}：应为有限数字`)
  return value
}
function asArray(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) throw new UsageError(`${where}：应为数组`)
  return value
}
function optString(value: unknown, where: string): string | null {
  return value === undefined || value === null ? null : asString(value, where)
}
function optNumber(value: unknown, where: string): number | null {
  return value === undefined || value === null ? null : asNumber(value, where)
}

function parseComment(raw: unknown, where: string): FixtureComment {
  const r = asRecord(raw, where)
  return {
    id: asString(r['id'], `${where}.id`),
    author: asString(r['author'], `${where}.author`),
    body: asString(r['body'], `${where}.body`),
    replyTo: optString(r['replyTo'], `${where}.replyTo`),
    createdAt: asNumber(r['createdAt'], `${where}.createdAt`),
  }
}

function parseIssue(raw: unknown, where: string): FixtureIssue {
  const r = asRecord(raw, where)
  const id = asNumber(r['id'], `${where}.id`)
  if (!Number.isInteger(id)) throw new UsageError(`${where}.id：应为整数`)
  return {
    id,
    project: asString(r['project'], `${where}.project`),
    subject: asString(r['subject'], `${where}.subject`),
    description: optString(r['description'], `${where}.description`) ?? '',
    status: asString(r['status'], `${where}.status`),
    type: asString(r['type'], `${where}.type`),
    dept: asString(r['dept'], `${where}.dept`),
    level: asNumber(r['level'], `${where}.level`),
    lane: optString(r['lane'], `${where}.lane`),
    assignee: optString(r['assignee'], `${where}.assignee`),
    dispatcher: optString(r['dispatcher'], `${where}.dispatcher`),
    parent: optNumber(r['parent'], `${where}.parent`),
    comments: asArray(r['comments'] ?? [], `${where}.comments`).map((c, i) => parseComment(c, `${where}.comments[${i}]`)),
    createdAt: asNumber(r['createdAt'], `${where}.createdAt`),
    updatedAt: asNumber(r['updatedAt'], `${where}.updatedAt`),
    closedAt: optNumber(r['closedAt'], `${where}.closedAt`),
  }
}

export function parseFixture(raw: unknown): TaigaExportFixture {
  const r = asRecord(raw, 'fixture')
  const schema = asString(r['schema'], 'fixture.schema')
  if (schema !== FIXTURE_SCHEMA) throw new UsageError(`fixture.schema：期望 ${FIXTURE_SCHEMA}，实为 ${schema}`)
  const projects = asArray(r['projects'], 'fixture.projects').map((p, i) => {
    const rec = asRecord(p, `fixture.projects[${i}]`)
    return {
      id: asNumber(rec['id'], `fixture.projects[${i}].id`),
      slug: asString(rec['slug'], `fixture.projects[${i}].slug`),
      name: asString(rec['name'], `fixture.projects[${i}].name`),
      keyPrefix: asString(rec['keyPrefix'], `fixture.projects[${i}].keyPrefix`),
    }
  })
  if (projects.length === 0) throw new UsageError('fixture.projects：不能为空')
  const users = asArray(r['users'], 'fixture.users').map((u, i): FixtureUser => {
    const rec = asRecord(u, `fixture.users[${i}]`)
    const kind = asString(rec['kind'], `fixture.users[${i}].kind`)
    if (kind !== 'human' && kind !== 'agent') throw new UsageError(`fixture.users[${i}].kind：应为 human|agent，实为 ${kind}`)
    return { id: asNumber(rec['id'], `fixture.users[${i}].id`), username: asString(rec['username'], `fixture.users[${i}].username`), fullName: asString(rec['fullName'], `fixture.users[${i}].fullName`), kind: kind as 'human' | 'agent' }
  })
  const issues = asArray(r['issues'], 'fixture.issues').map((issue, i) => parseIssue(issue, `fixture.issues[${i}]`))
  if (issues.length === 0) throw new UsageError('fixture.issues：不能为空')
  return {
    schema,
    exportedAt: asNumber(r['exportedAt'], 'fixture.exportedAt'),
    source: optString(r['source'], 'fixture.source') ?? '',
    projects,
    users,
    issues,
  }
}

export function loadFixtureFromPath(fixturePath: string): TaigaExportFixture {
  let text: string
  try {
    text = readFileSync(fixturePath, 'utf8')
  } catch (cause) {
    throw new UsageError(`fixture 不可读：${fixturePath}（${String(cause)}）`)
  }
  try {
    return parseFixture(JSON.parse(text))
  } catch (cause) {
    if (cause instanceof UsageError) throw new UsageError(`${fixturePath}: ${cause.message}`)
    throw new UsageError(`${fixturePath}: JSON 解析失败（${String(cause)}）`)
  }
}

/* ------------------------------------------------------------------ */
/* 共享推导件（diff 对账与计划生成同源，防两套口径漂移）                 */
/* ------------------------------------------------------------------ */

export function naturalKeyOf(issue: FixtureIssue): string {
  return `${issue.project}#${String(issue.id)}`
}

export interface KeptRecord { issue: FixtureIssue; index: number }

/** 自然键去重：last-write-wins（updatedAt 大者胜，平局取数组靠后者）——重跑/重导出幂等的基础 */
export function dedupIssues(issues: readonly FixtureIssue[]): { kept: Map<string, KeptRecord>; dropped: DroppedRecord[] } {
  const kept = new Map<string, KeptRecord>()
  const dropped: DroppedRecord[] = []
  issues.forEach((issue, index) => {
    const nk = naturalKeyOf(issue)
    const current = kept.get(nk)
    if (current === undefined) {
      kept.set(nk, { issue, index })
      return
    }
    const newer = issue.updatedAt > current.issue.updatedAt || (issue.updatedAt === current.issue.updatedAt && index > current.index)
    const winner = newer ? { issue, index } : current
    const loser = newer ? current : { issue, index }
    kept.set(nk, winner)
    dropped.push({
      naturalKey: nk,
      id: loser.issue.id,
      project: loser.issue.project,
      droppedUpdatedAt: loser.issue.updatedAt,
      keptUpdatedAt: winner.issue.updatedAt,
      reason: newer
        ? issue.updatedAt > current.issue.updatedAt ? 'older-snapshot' : 'same-timestamp-later-index-wins'
        : current.issue.updatedAt > issue.updatedAt ? 'older-snapshot' : 'same-timestamp-earlier-index-wins',
    })
  })
  return { kept, dropped }
}

export function stateRowOf(status: string): StateMapRow | undefined {
  return STATE_MAP.find((row) => row.from === status)
}

export function kindOf(type: string): 'task' | 'bug' | 'chore' {
  return KIND_MAP.find((row) => row.from === type)?.to ?? 'task'
}

export function priorityOf(level: number): { priority: number; requiresHuman: boolean } {
  const row = PRIORITY_MAP.find((entry) => entry.fromLevel === level)
  return row !== undefined ? { priority: row.toPriority, requiresHuman: row.requiresHuman } : { priority: 2, requiresHuman: false }
}

/** vendor MAX_PARENT_DEPTH=3（catalog.ts）；返回该单在导出集内的祖先深度（根=1） */
export function chainDepthOf(nk: string, kept: ReadonlyMap<string, KeptRecord>): number {
  let depth = 0
  let cursor: string | undefined = nk
  const seen = new Set<string>()
  while (cursor !== undefined && kept.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor)
    depth += 1
    const issue: FixtureIssue | undefined = kept.get(cursor)?.issue
    cursor = issue !== undefined && issue.parent !== null ? `${issue.project}#${String(issue.parent)}` : undefined
  }
  return depth
}

/** 同单评论的规范序：createdAt 升序、平局按 id——导入与对账都用这个口径 */
export function sortedCommentsOf(issue: FixtureIssue): readonly FixtureComment[] {
  return [...issue.comments].sort((a, b) => (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** 计划期标题：空 subject→兜底（gap 由调用方记录） */
export function titleOf(issue: FixtureIssue, nk: string): string {
  return issue.subject.trim() !== '' ? issue.subject : `(无标题) ${nk}`
}

/** 目标 label 集（顺序即生成序；≤16 上限） */
export function labelsForIssue(issue: FixtureIssue): string[] {
  return [
    'migrated',
    `legacy-state-${slugOf(issue.status)}`,
    `ext-type-${slugOf(issue.type)}`,
    `ext-dept-${slugOf(issue.dept)}`,
    `ext-level-${String(issue.level)}`,
    ...(issue.lane !== null ? [`ext-lane-${slugOf(issue.lane)}`] : []),
    ...(issue.dispatcher !== null ? [`ext-dispatcher-${slugOf(issue.dispatcher)}`] : []),
  ]
}

/** key 工厂：<keyPrefix>-<源 ref>（评估 §二.1：公开 ID 保留为 key） */
export function makeKeyOf(exported: TaigaExportFixture): (project: string, id: number) => string {
  const prefixes = new Map(exported.projects.map((p) => [p.slug, p.keyPrefix]))
  return (project, id) => {
    const prefix = prefixes.get(project)
    if (prefix === undefined) throw new UsageError(`未知项目 slug：${project}`)
    return `${prefix}-${String(id)}`
  }
}

/* ------------------------------------------------------------------ */
/* 计划生成                                                            */
/* ------------------------------------------------------------------ */

/** planHash 载荷：计划去除 meta.planHash 与 dedup 审计域 */
export function planHashPayload(plan: ImportPlan): unknown {
  return {
    schema: plan.schema,
    meta: {
      fixtureSchema: plan.meta.fixtureSchema,
      exportedAt: plan.meta.exportedAt,
      sourceHash: plan.meta.sourceHash,
      targetVendor: plan.meta.targetVendor,
      hashScope: plan.meta.hashScope,
    },
    mapping: plan.mapping,
    principals: plan.principals,
    counts: plan.counts,
    gaps: plan.gaps,
    issues: plan.issues,
  }
}

export function planHashOf(plan: ImportPlan): string {
  return sha256Of(planHashPayload(plan))
}

export function buildPlan(exported: TaigaExportFixture): ImportPlan {
  const keyOf = makeKeyOf(exported)
  const users = new Map(exported.users.map((u) => [u.username, u]))
  const gaps: PlanGap[] = []
  const { kept, dropped } = dedupIssues(exported.issues)

  for (const issue of exported.issues) {
    if (!exported.projects.some((p) => p.slug === issue.project)) {
      throw new UsageError(`未知项目 slug：${issue.project}（fixture.issues id=${String(issue.id)}）`)
    }
  }

  // 拓扑排序：父先于子（导入期 parent 解析依赖）；环→显式 gap 并断链
  const ordered: KeptRecord[] = []
  const mark = new Map<string, 'visiting' | 'done'>()
  const cyclic = new Set<string>()
  const visit = (nk: string, stack: readonly string[]): void => {
    const state = mark.get(nk)
    if (state === 'done') return
    if (state === 'visiting') {
      cyclic.add(nk)
      gaps.push({ kind: 'parent-cycle', issue: nk, detail: `父子环：${[...stack, nk].join(' -> ')}；断链导入（parentKey 置空）` })
      mark.set(nk, 'done')
      return
    }
    mark.set(nk, 'visiting')
    const record = kept.get(nk)
    if (record !== undefined) {
      const parentNk = record.issue.parent !== null ? `${record.issue.project}#${String(record.issue.parent)}` : null
      if (parentNk !== null && kept.has(parentNk) && !cyclic.has(parentNk)) visit(parentNk, [...stack, nk])
    }
    if (record !== undefined) ordered.push(record)
    mark.set(nk, 'done')
  }
  for (const nk of [...kept.keys()].sort()) visit(nk, [])

  const planned: PlannedIssue[] = []
  const referencedPrincipals = new Set<string>()
  let plannedComments = 0
  let parentsLinked = 0
  let statusMapped = 0
  let statusUnmapped = 0

  for (const { issue } of ordered) {
    const nk = naturalKeyOf(issue)
    const stateRow = stateRowOf(issue.status)
    if (stateRow === undefined) {
      statusUnmapped += 1
      gaps.push({ kind: 'status-unmapped', issue: nk, detail: `status="${issue.status}" 不在冻结映射表内；回退 NEW(1)；补表后重跑（不静默压缩）` })
    } else {
      statusMapped += 1
    }
    const stateCode = stateRow?.to ?? 1
    const stateName = stateRow?.toName ?? 'NEW'

    if (issue.subject.trim() === '') gaps.push({ kind: 'title-empty', issue: nk, detail: 'subject 为空；用兜底标题（vendor title CHECK 1..512）' })

    const { priority, requiresHuman } = priorityOf(issue.level)
    if (chainDepthOf(nk, kept) > 3) gaps.push({ kind: 'parent-depth-exceeded', issue: nk, detail: `祖先深度 ${String(chainDepthOf(nk, kept))} > vendor MAX_PARENT_DEPTH=3；导入将被 vendor 拒绝，需先拆层` })

    let parentKey: string | null = null
    if (issue.parent !== null) {
      const parentNk = `${issue.project}#${String(issue.parent)}`
      if (cyclic.has(nk) || cyclic.has(parentNk)) parentKey = null
      else if (kept.has(parentNk)) {
        parentKey = keyOf(issue.project, issue.parent)
        parentsLinked += 1
      } else {
        gaps.push({ kind: 'parent-outside-export', issue: nk, detail: `parent=${String(issue.parent)} 不在导出集内；置空导入（评估 §二.1：父不在选集=显式豁免）` })
      }
    }

    if (issue.assignee !== null) referencedPrincipals.add(issue.assignee)
    const comments: PlannedComment[] = []
    const commentIds = new Set(issue.comments.map((c) => c.id))
    if (new Set(commentIds).size !== issue.comments.length) throw new UsageError(`${nk}.comments：评论 id 重复`)
    for (const comment of sortedCommentsOf(issue)) {
      if (!users.has(comment.author)) gaps.push({ kind: 'comment-author-unknown', issue: nk, detail: `评论 ${comment.id} 作者 "${comment.author}" 不在 users 表；按原文导入并显式记录` })
      else referencedPrincipals.add(comment.author)
      let replyTo: string | null = comment.replyTo
      if (replyTo !== null && !commentIds.has(replyTo)) {
        gaps.push({ kind: 'comment-reply-unknown', issue: nk, detail: `评论 ${comment.id} 的 replyTo=${replyTo} 不在同单评论集内；置空导入` })
        replyTo = null
      }
      if (comment.body.length < 1) gaps.push({ kind: 'comment-body-empty', issue: nk, detail: `评论 ${comment.id} body 为空；vendor CHECK length(body) BETWEEN 1 AND 16384，空 body 不可导入（不伪造占位正文，127-B P2）` })
      if (comment.body.length > 16384) gaps.push({ kind: 'comment-body-too-long', issue: nk, detail: `评论 ${comment.id} body ${String(comment.body.length)}B > vendor 上限 16384B；导入将被拒，需先拆分` })
      comments.push({ id: comment.id, author: comment.author, body: comment.body, replyToCommentId: replyTo, createdAt: comment.createdAt })
    }
    plannedComments += comments.length

    planned.push({
      naturalKey: nk,
      sourceRef: { project: issue.project, id: issue.id, status: issue.status },
      idempotencyKey: `issue-migrate:${nk}`,
      sourceHash: sha256Of(issue),
      statusMapped: stateRow !== undefined,
      target: {
        ticket: {
          key: keyOf(issue.project, issue.id),
          title: titleOf(issue, nk),
          body: issue.description,
          kind: kindOf(issue.type),
          priority,
          stateCode,
          stateName,
          requiresHuman,
          assignee: issue.assignee,
          parentKey,
          labels: labelsForIssue(issue),
          createdAt: issue.createdAt,
          updatedAt: issue.updatedAt,
          doneAt: issue.closedAt,
        },
        comments,
      },
    })
  }

  const principals: PlannedPrincipal[] = [...referencedPrincipals].sort().flatMap((username) => {
    const user = users.get(username)
    return user !== undefined ? [{ username, kind: user.kind, displayName: user.fullName }] : []
  })

  const keptForHash = [...kept.values()].map((r) => r.issue).sort((a, b) => (naturalKeyOf(a) < naturalKeyOf(b) ? -1 : 1))
  const plan: ImportPlan = {
    schema: PLAN_SCHEMA,
    meta: {
      fixtureSchema: exported.schema,
      exportedAt: exported.exportedAt,
      sourceHash: sha256Of({ projects: exported.projects, users: exported.users, keptIssues: keptForHash }),
      planHash: '',
      targetVendor: TARGET_VENDOR,
      hashScope: 'canonical(plan) 去除 meta.planHash 与 dedup 审计域；meta.sourceHash 取去重后 kept 集',
    },
    mapping: { states: STATE_MAP, kinds: KIND_MAP, priority: PRIORITY_MAP, fields: FIELD_MAP },
    principals,
    counts: { plannedIssues: planned.length, plannedComments, parentsLinked, statusMapped, statusUnmapped },
    gaps,
    issues: planned,
    dedup: {
      naturalKey: ['project', 'id'],
      inputRecords: exported.issues.length,
      droppedDuplicateRecords: dropped.length,
      dropped,
    },
  }
  return { ...plan, meta: { ...plan.meta, planHash: planHashOf(plan) } }
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

const USAGE = '用法：node scripts/workbench-issues-migrate.ts [--fixture <taiga-export.json>] [--dry-run] [--out <plan.json>]'

function isDirectRun(): boolean {
  const argv1 = process.argv[1]
  if (argv1 === undefined) return false
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

export function migrateCli(argv: readonly string[]): { code: number; stdout: string } {
  const args = [...argv]
  const valueOf = (name: string): string | undefined => {
    const i = args.indexOf(name)
    if (i < 0) return undefined
    const value = args[i + 1]
    if (value === undefined) throw new UsageError(`${name} 缺参数；${USAGE}`)
    args.splice(i, 2)
    return value
  }
  const fixturePath = valueOf('--fixture') ?? DEFAULT_FIXTURE
  const outPath = valueOf('--out')
  const dryRunIndex = args.indexOf('--dry-run')
  const dryRun = dryRunIndex >= 0
  if (dryRun) args.splice(dryRunIndex, 1)
  if (args.some((a) => a === '--help' || a === '-h')) return { code: 0, stdout: `${USAGE}\n` }
  if (args.length > 0) throw new UsageError(`未知参数：${args.join(' ')}；${USAGE}`)

  const plan = buildPlan(loadFixtureFromPath(fixturePath))
  const summary = {
    ok: true,
    fixture: fixturePath,
    dryRun,
    counts: { ...plan.counts, inputRecords: plan.dedup.inputRecords, droppedDuplicateRecords: plan.dedup.droppedDuplicateRecords, principals: plan.principals.length },
    gapCount: plan.gaps.length,
    planHash: plan.meta.planHash,
  }
  if (dryRun) return { code: 0, stdout: `${JSON.stringify(summary)}\n` }
  if (outPath !== undefined) {
    mkdirSync(path.dirname(outPath), { recursive: true })
    writeFileSync(outPath, `${JSON.stringify(plan, null, 2)}\n`)
    return { code: 0, stdout: `${JSON.stringify({ ...summary, out: outPath })}\n` }
  }
  return { code: 0, stdout: `${JSON.stringify(plan, null, 2)}\n` }
}

if (isDirectRun()) {
  try {
    const { code, stdout } = migrateCli(process.argv.slice(2))
    process.stdout.write(stdout)
    process.exit(code)
  } catch (cause) {
    if (cause instanceof UsageError) {
      console.error(`[workbench-issues-migrate] ${cause.message}`)
      process.exit(2)
    }
    throw cause
  }
}
