/**
 * taiga-snapshot —— task-134 真实快照（taiga-export/v1）加载与适配层（M2 单子自研切换）
 *
 * 依据（实现单引用设计文档章节号——AGENTS §五.1）：
 *   - docs/plan/06-自研单子与聊天室切换-2026-11-19.md §二 M2（真实数据迁移演练：
 *     全量快照→localplatform 文件树；dry-run/真写/对账/幂等/负对照）
 *   - docs/sentinel-logs/单子自研切换-runbook-2026-11-19.md §七（M2 阻断项口径：
 *     history 不伪造为端口事件；severity/priority 缺失如实登记；ID 保留 ref）
 *   - scripts/taiga-export.ts（快照生产者——字段口径唯一源：idDisplay/type/severity/
 *     priority/parent/comments 的 fieldNotes 与本件解析一一对应）
 *   - packages/localplatform/src/binding.ts（状态口径：平台态字符串逐字保留；
 *     未映射=Ok(unverified)+observe-unmapped，不是错误）
 *
 * 职责（纯读纯函数，零写盘零网络）：
 *   1) 解析+防御校验 taiga-export/v1 快照（坏形状=UsageError fail-closed）；
 *   2) 快照完整性自证：重算 contentSha256（=「除 manifest 外全部内容」的
 *      JSON.stringify sha256，与导出器同算法）对 manifest.contentSha256 比对；
 *   3) 自然键去重（idDisplay last-write-wins，modified 大者胜——与 M1/rehearse 同语义）；
 *   4) 行适配：真实字段（ref/idDisplay/subject/status/type/severity/priority/assignee/
 *      created/modified/description/comments/history/自定义属性）→ 迁移/对账可消费的
 *      SnapshotRow。字段缺位一律 null 如实（不伪造默认值）；
 *   5) history 只作为审计旁注材料（id/user/createdAt/type/key）——**不进平台活动流**
 *      （不伪造端口事件，runbook §七.3 口径）。
 *
 * 字段映射注记（「type 自定义属性映射」等——迁移报告 mappings 同源）：
 *   - idDisplay（studio-dev-N）→ 平台单 ID 逐字保留（plan/06 §三.2）
 *   - status.name → 平台态字符串逐字（binding.ts：observe-unmapped；对账码另走 STATE_MAP）
 *   - type=自定义属性「类型」的值 → issues.type（缺位=null，不造默认）
 *   - customAttributes「部门」→ issues.dept（逐字，含 departments/ 前缀形态）
 *   - customAttributes「等级」（数字串）→ issues.level（number；缺位=null）
 *   - customAttributes「泳道」→ issues.lane（缺位=null；平台侧经 setField 补写）
 *   - severity/priority：本实例 US 无此字段（fieldNotes 明示）→ null 并由调用方登记
 *   - parent：恒 null（Taiga US↔US 无父子模型）→ 如实；epics/childTasks 计数如实（0）
 *   - assignee/owner：fullName（本实例 username 恒 null）
 *   - comments：history 提取的评论（升序）逐条保留（id/author/createdAt/body）
 *
 * 边界：快照只读；本件不写任何文件；host 路径不入仓（路径由 CLI 参数传入）。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { UsageError, sha256Hex } from './workbench-issues-migrate.ts'

export const SNAPSHOT_SCHEMA = 'taiga-export/v1'

/* ------------------------------------------------------------------ */
/* 类型                                                                */
/* ------------------------------------------------------------------ */

export interface SnapshotComment {
  readonly id: string
  readonly author: string
  readonly createdAtIso: string
  readonly body: string
}

/** 审计旁注材料：history 条目摘要（不含 valuesDiff 大块——完整 history 留在冻结快照内） */
export interface SnapshotHistoryNote {
  readonly id: string
  readonly user: string
  readonly createdAtIso: string
  readonly type: number
  readonly key: string
}

export interface SnapshotRow {
  /** 平台单 ID=studio-dev-<ref>（idDisplay，逐字） */
  readonly id: string
  readonly ref: number
  readonly project: string
  readonly subject: string
  readonly statusName: string
  readonly statusClosed: boolean | null
  readonly type: string | null
  readonly severity: string | null
  readonly priority: string | null
  readonly dept: string | null
  readonly level: number | null
  readonly lane: string | null
  readonly assignee: string | null
  readonly owner: string | null
  readonly createdIso: string
  readonly modifiedIso: string
  readonly description: string
  readonly tags: readonly string[]
  readonly isBlocked: boolean
  readonly customAttributes: Readonly<Record<string, string>>
  readonly comments: readonly SnapshotComment[]
  readonly history: readonly SnapshotHistoryNote[]
  readonly parent: string | null
  readonly epicCount: number
  readonly childTaskCount: number
}

export interface SnapshotManifest {
  readonly projectTotalStories: number
  readonly exportedStories: number
  readonly commentTotal: number
  readonly historyTotal: number
  readonly parentChildPairs: { readonly epic: number; readonly childTask: number; readonly total: number }
  readonly contentSha256: string
}

export interface TaigaSnapshot {
  readonly schema: string
  readonly snapshotFile: string
  readonly exportedAt: string
  readonly project: { readonly id: number; readonly name: string; readonly slug: string }
  readonly manifest: SnapshotManifest
  readonly rows: readonly SnapshotRow[]
  readonly rowsDropped: number
}

/* ------------------------------------------------------------------ */
/* 防御取值（坏形状=UsageError，fail-closed 不静默）                     */
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
function asBoolean(value: unknown, where: string): boolean {
  if (typeof value !== 'boolean') throw new UsageError(`${where}：应为布尔`)
  return value
}
function asArray(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) throw new UsageError(`${where}：应为数组`)
  return value
}
function optString(value: unknown, where: string): string | null {
  return value === undefined || value === null ? null : asString(value, where)
}

/** ISO 时间戳校验（快照时间面合法性——派生 updated/游标依赖字典序可比） */
function asIso(value: unknown, where: string): string {
  const s = asString(value, where)
  if (Number.isNaN(Date.parse(s)) || !s.endsWith('Z')) throw new UsageError(`${where}：应为 UTC ISO-8601 时间戳（…Z），得到 ${JSON.stringify(s)}`)
  return s
}

/* ------------------------------------------------------------------ */
/* 解析                                                                */
/* ------------------------------------------------------------------ */

function parseComment(value: unknown, where: string): SnapshotComment {
  const rec = asRecord(value, where)
  return {
    id: asString(rec['id'], `${where}.id`),
    author: asString(rec['author'], `${where}.author`),
    createdAtIso: asIso(rec['createdAt'], `${where}.createdAt`),
    body: asString(rec['body'], `${where}.body`),
  }
}

function parseHistoryNote(value: unknown, where: string): SnapshotHistoryNote {
  const rec = asRecord(value, where)
  return {
    id: asString(rec['id'], `${where}.id`),
    user: asString(rec['user'], `${where}.user`),
    createdAtIso: asIso(rec['createdAt'], `${where}.createdAt`),
    type: asNumber(rec['type'], `${where}.type`),
    key: asString(rec['key'], `${where}.key`),
  }
}

/** 人员对象 {id, username, fullName} → fullName（本实例 username 恒 null）；null 如实 */
function personName(value: unknown, where: string): string | null {
  if (value === undefined || value === null) return null
  const rec = asRecord(value, where)
  return optString(rec['fullName'], `${where}.fullName`) ?? optString(rec['username'], `${where}.username`)
}

function parseStory(value: unknown, where: string, projectSlug: string): SnapshotRow {
  const rec = asRecord(value, where)
  const ref = asNumber(rec['ref'], `${where}.ref`)
  const project = projectSlug
  const status = asRecord(rec['status'] ?? {}, `${where}.status`)
  const attrsRaw = asRecord(rec['customAttributes'] ?? {}, `${where}.customAttributes`)
  const customAttributes: Record<string, string> = {}
  for (const [key, v] of Object.entries(attrsRaw)) {
    if (v === null || v === undefined) continue // 属性存在但值空=未填，不伪造
    customAttributes[key] = asString(v, `${where}.customAttributes["${key}"]`)
  }
  const levelRaw = customAttributes['等级'] ?? null
  const level = levelRaw === null ? null : asNumber(Number(levelRaw), `${where}.customAttributes["等级"]→number`)
  const parent = rec['parent'] === undefined || rec['parent'] === null ? null : asString(asRecord(rec['parent'], `${where}.parent`)['idDisplay'] ?? asRecord(rec['parent'], `${where}.parent`)['ref'], `${where}.parent.idDisplay`)
  return {
    id: asString(rec['idDisplay'], `${where}.idDisplay`),
    ref,
    project,
    subject: asString(rec['subject'], `${where}.subject`),
    statusName: asString(status['name'], `${where}.status.name`),
    statusClosed: status['isClosed'] === undefined ? null : asBoolean(status['isClosed'], `${where}.status.isClosed`),
    type: optString(rec['type'], `${where}.type`),
    severity: optString(rec['severity'], `${where}.severity`),
    priority: optString(rec['priority'], `${where}.priority`),
    dept: customAttributes['部门'] ?? null,
    level,
    lane: customAttributes['泳道'] ?? null,
    assignee: personName(rec['assignee'], `${where}.assignee`),
    owner: personName(rec['owner'], `${where}.owner`),
    createdIso: asIso(rec['created'], `${where}.created`),
    modifiedIso: asIso(rec['modified'], `${where}.modified`),
    description: optString(rec['description'], `${where}.description`) ?? '',
    tags: asArray(rec['tags'] ?? [], `${where}.tags`).map((t, i) => asString(t, `${where}.tags[${String(i)}]`)),
    isBlocked: rec['isBlocked'] === undefined ? false : asBoolean(rec['isBlocked'], `${where}.isBlocked`),
    customAttributes,
    comments: asArray(rec['comments'] ?? [], `${where}.comments`).map((c, i) => parseComment(c, `${where}.comments[${String(i)}]`)),
    history: asArray(rec['history'] ?? [], `${where}.history`).map((h, i) => parseHistoryNote(h, `${where}.history[${String(i)}]`)),
    parent,
    epicCount: asArray(rec['epics'] ?? [], `${where}.epics`).length,
    childTaskCount: asArray(rec['childTasks'] ?? [], `${where}.childTasks`).length,
  }
}

function parseManifest(value: unknown, where: string): SnapshotManifest {
  const rec = asRecord(value, where)
  const pairs = asRecord(rec['parentChildPairs'] ?? {}, `${where}.parentChildPairs`)
  return {
    projectTotalStories: asNumber(rec['projectTotalStories'], `${where}.projectTotalStories`),
    exportedStories: asNumber(rec['exportedStories'], `${where}.exportedStories`),
    commentTotal: asNumber(rec['commentTotal'], `${where}.commentTotal`),
    historyTotal: asNumber(rec['historyTotal'], `${where}.historyTotal`),
    parentChildPairs: {
      epic: asNumber(pairs['epic'] ?? 0, `${where}.parentChildPairs.epic`),
      childTask: asNumber(pairs['childTask'] ?? 0, `${where}.parentChildPairs.childTask`),
      total: asNumber(pairs['total'] ?? 0, `${where}.parentChildPairs.total`),
    },
    contentSha256: asString(rec['contentSha256'], `${where}.contentSha256`),
  }
}

/** 重算 contentSha256（导出器同算法：除 manifest 外全部内容的 JSON.stringify sha256） */
export function recomputeContentSha256(parsed: Record<string, unknown>): string {
  const content: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'manifest') continue
    content[key] = value
  }
  return sha256Hex(JSON.stringify(content))
}

/**
 * 解析快照（含完整性自证 + manifest 计数交叉核对 + idDisplay 唯一性 + 去重）。
 * 坏形状/哈希不符/manifest 与实体计数不符 = UsageError（结构错误，exit 2——迁移前 fail-closed）。
 */
export function parseTaigaSnapshot(raw: unknown, snapshotFile: string): TaigaSnapshot {
  const r = asRecord(raw, 'snapshot')
  const schema = asString(r['schema'] ?? SNAPSHOT_SCHEMA, 'snapshot.schema')
  if (schema !== SNAPSHOT_SCHEMA) throw new UsageError(`snapshot.schema：期望 ${SNAPSHOT_SCHEMA}，得到 ${schema}`)
  const manifest = parseManifest(r['manifest'], 'snapshot.manifest')
  const recomputed = recomputeContentSha256(r)
  if (recomputed !== manifest.contentSha256) {
    throw new UsageError(`${snapshotFile}: contentSha256 不符（manifest=${manifest.contentSha256} 重算=${recomputed}）——快照损坏或被改动，拒用`)
  }
  const project = asRecord(r['project'], 'snapshot.project')
  const projectSlug = asString(project['slug'], 'snapshot.project.slug')
  const stories = asArray(r['stories'], 'snapshot.stories')
  const rowsRaw = stories.map((s, i) => parseStory(s, `snapshot.stories[${String(i)}]`, projectSlug))

  // idDisplay 唯一性（重复 ref=结构错误：ID 保留口径下不可有二义）
  const seen = new Map<string, number>()
  for (const row of rowsRaw) {
    const count = seen.get(row.id) ?? 0
    seen.set(row.id, count + 1)
  }
  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id)
  if (duplicates.length > 0) throw new UsageError(`${snapshotFile}: idDisplay 重复（${duplicates.slice(0, 5).join('、')}${duplicates.length > 5 ? '…' : ''}）——ID 保留口径拒绝二义引用`)

  // manifest 计数交叉核对（stories 条数 vs exportedStories；评论/history 总数）
  const commentTotal = rowsRaw.reduce((sum, row) => sum + row.comments.length, 0)
  const historyTotal = rowsRaw.reduce((sum, row) => sum + row.history.length, 0)
  const mismatches: string[] = []
  if (rowsRaw.length !== manifest.exportedStories) mismatches.push(`stories=${String(rowsRaw.length)} ≠ manifest.exportedStories=${String(manifest.exportedStories)}`)
  if (rowsRaw.length !== manifest.projectTotalStories) mismatches.push(`stories=${String(rowsRaw.length)} ≠ manifest.projectTotalStories=${String(manifest.projectTotalStories)}`)
  if (commentTotal !== manifest.commentTotal) mismatches.push(`comments=${String(commentTotal)} ≠ manifest.commentTotal=${String(manifest.commentTotal)}`)
  if (historyTotal !== manifest.historyTotal) mismatches.push(`history=${String(historyTotal)} ≠ manifest.historyTotal=${String(manifest.historyTotal)}`)
  if (mismatches.length > 0) throw new UsageError(`${snapshotFile}: manifest 计数交叉核对失败（${mismatches.join('；')}）——快照内部不一致，拒用`)

  // 自然键去重（防御位：唯一性已闸，正常快照 rowsDropped=0；语义与 M1 last-write-wins 对齐）
  const kept = new Map<string, SnapshotRow>()
  let rowsDropped = 0
  rowsRaw.forEach((row) => {
    const current = kept.get(row.id)
    if (current === undefined) {
      kept.set(row.id, row)
      return
    }
    rowsDropped += 1
    if (row.modifiedIso >= current.modifiedIso) kept.set(row.id, row) // 平局取靠后者（M1 同语义）
  })

  // 行序确定性：ref 升序（游标/写入序/报告都依赖稳定序）
  const rows = [...kept.values()].sort((a, b) => a.ref - b.ref)
  return {
    schema,
    snapshotFile,
    exportedAt: asIso(r['exportedAt'], 'snapshot.exportedAt'),
    project: {
      id: asNumber(project['id'], 'snapshot.project.id'),
      name: asString(project['name'], 'snapshot.project.name'),
      slug: projectSlug,
    },
    manifest,
    rows,
    rowsDropped,
  }
}

export function loadTaigaSnapshot(snapshotPath: string): TaigaSnapshot {
  let text: string
  try {
    text = readFileSync(snapshotPath, 'utf8')
  } catch (cause) {
    throw new UsageError(`snapshot 不可读：${snapshotPath}（${String(cause)}）`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new UsageError(`${snapshotPath}: JSON 解析失败（${String(cause)}）`)
  }
  const name = snapshotPath.split('/').pop() ?? snapshotPath
  return parseTaigaSnapshot(parsed, name)
}

/* ------------------------------------------------------------------ */
/* 统计（对账/报告口径）                                                */
/* ------------------------------------------------------------------ */

/** 状态分布（源 vs 平台同口径输出；确定性键序=首见序按 ref 升序） */
export function statusDistributionOf(states: readonly string[]): Array<{ readonly state: string; readonly count: number }> {
  const order: string[] = []
  const counts = new Map<string, number>()
  for (const state of states) {
    if (!counts.has(state)) order.push(state)
    counts.set(state, (counts.get(state) ?? 0) + 1)
  }
  return order.map((state) => ({ state, count: counts.get(state) ?? 0 }))
}
