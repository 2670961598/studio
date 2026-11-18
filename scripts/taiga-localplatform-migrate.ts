/**
 * taiga-localplatform-migrate —— M1 单子自研切换·Taiga 导出→LocalFile 平台树迁移器（task-131）
 *
 * 依据（实现单引用设计文档章节号——AGENTS §五.1）：
 *   - docs/plan/06-自研单子与聊天室切换-2026-11-19.md §二 M1（迁移器：dry-run/幂等/ID 保留/
 *     评论/活动/父子）、§三 单子切换细则（映射口径/写入者/对账/回滚）
 *   - docs/plan/06 §三.2 迁移映射：Taiga 单 ID→`studio-dev-N` 保留；状态按 binding.ts 口径
 *     **平台态字符串逐字保留**（packages/localplatform/src/binding.ts：平台态≠工作十态，逐平台
 *     值映射表是部署工件，STATE_MAPPINGS 空表不猜——PRB-23 落证前不得映射）；对账用状态码
 *     （1..8）取 scripts/workbench-issues-migrate.ts STATE_MAP 冻结表（与 Phase0 工具链同源）。
 *   - docs/quality/phase0/ticket-export.json（task-64 Phase0 切片2 真实 10 单只读导出）+
 *     ticket-diff.json（Phase0 期望表——独立断言，不只用本工具链推导）。
 *
 * 链路：真实导出 → 迁移计划（canonical/planHash）→ createLocalPlatform 写入平台树：
 *   - provision/评论/lane/父子链 经 platform API（fields.provision / comments.add /
 *     issues.setField / links.link——createLocalPlatform 实例的注入时钟全部取自源数据时间戳）
 *   - `created` 事件+活动流首条：**直接按 localplatform 落盘格式写 `issues/<源ID>.jsonl`/
 *     activity.jsonl**——因为 issues.create() 只能分配 `LOCAL-N` 自增 ID（packages/localplatform/
 *     src/issues.ts ISSUE_PREFIX 硬编码），ID 保留（plan/06 §三.2）的唯一实现路径。这是 M1
 *     记录在案的端口缺口：daemon 生产读取面 issues.list() 只扫 `LOCAL-` 前缀（scanIssueIds），
 *     `studio-dev-N` 单对 list() 不可见（get/comments/links/activity 均可见）——M2 双跑前需
 *     扩前缀或加映射层（已在 runbook 登记，不在本单硬凑）。
 *
 * 幂等：时间戳全部取自源数据（零系统时钟）；已存在且内容一致的单跳过；活动流按
 * (issue,kind) 去重；重跑不重复、planHash 稳定。树内出现计划外单/内容漂移/期望表结构失败
 * =显式 gap exit 1（fail-closed，不覆盖）。
 *
 * 边界（铁律）：只读 fixture 与既有平台树；不接网络；零第三方依赖；默认根
 * /tmp/lp-migrate-sandbox（task-131 指定，保留供检查——`--cleanup` 跑完即清）。
 *
 * 用法：node scripts/taiga-localplatform-migrate.ts [--snapshot <taiga-export.json> |
 *          --export <ticket-export.json>] [--expectations <ticket-diff.json> |
 *          --skip-expectations] [--root <platform root>] [--dry-run] [--out <plan.json>] [--cleanup]
 *   --snapshot 走 M2 真实快照路径（taiga-export/v1，scripts/taiga-snapshot.ts 适配+完整性
 *     自证）：description 逐字（不嵌溯源 JSON）；severity/priority 缺失=null 登记；history
 *     只进 root/migration-audit/ 审计旁注（绝不伪造为端口事件/活动流——runbook §七.3）；
 *     type/dept/level/lane=自定义属性映射（缺位=null 不造默认）
 *   --dry-run 只打印计划摘要/planHash，不写任何文件（--out 被忽略）
 * 退出码：0=迁移成功（数据面 gap 显式记录于计划内不拦停）；1=blocking gap（树漂移/期望表失败/
 *        审计旁注漂移）；2=用法/文件结构错误（含快照 contentSha256 不符）。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLocalPlatform, nextActivityId, parseActivityId } from '../packages/localplatform/src/index.ts'
// 契约类型深引（import type 全擦除，不触发包桶的 zod 值依赖——scripts 直跑纪律）
import type { FieldProvisionMap, FlowPlatform } from '../packages/contract/src/ports/platform.ts'
import type { TicketId } from '../packages/contract/src/ports/kernel.ts'
import { DEFAULT_EXPORT, DEFAULT_EXPECTATIONS, loadExpectations, loadPhase0Export, splitIssueRef } from './workbench-issues-rehearse.ts'
import { STATE_MAP, UsageError, canonicalJson, sha256Hex, stateRowOf, type PlanGap } from './workbench-issues-migrate.ts'
import type { Expectations, Phase0Export, Phase0Row } from './workbench-issues-rehearse.ts'
import { loadTaigaSnapshot, type TaigaSnapshot } from './taiga-snapshot.ts'

export const PLAN_SCHEMA = 'taiga-localplatform-migrate/v1'
export const REPORT_SCHEMA = 'taiga-localplatform-migrate-report/v1'
/** task-131 指定的演练根（保留供检查；测试用显式临时根） */
export const DEFAULT_ROOT = '/tmp/lp-migrate-sandbox'
export const TARGET_PLATFORM = '@studio-next/localplatform（createLocalPlatform；单据=jsonl 事件流/评论=md/活动=activity.jsonl）'

/* ------------------------------------------------------------------ */
/* 计划类型                                                            */
/* ------------------------------------------------------------------ */

export interface PlannedComment {
  readonly author: string
  readonly body: string
  readonly signature: string
  readonly createdAtIso: string
  readonly sourceId: string
}

export interface PlannedTicket {
  /** 平台单 ID=源 ref 原样（plan/06 §三.2「ID 保留」；不换 LOCAL-N） */
  readonly id: string
  readonly project: string
  readonly title: string
  /** 溯源载荷：M1=源行 canonical JSON；M2 真实快照=源 description 逐字（溯源移审计旁注） */
  readonly description: string
  /** 平台态字符串逐字（binding.ts 口径：不翻译成工作十态） */
  readonly state: string
  /** 对账用状态码（STATE_MAP 冻结表；null=源态不在表内→显式 gap，仍逐字迁移） */
  readonly stateCode: number | null
  readonly stateName: string | null
  /** type=自定义属性「类型」的值（真实快照可缺位→null，不造默认——M1 fixture 恒 string） */
  readonly type: string | null
  readonly dept: string | null
  readonly level: number | null
  readonly assignee: string | null
  readonly parent: string | null
  readonly lane: string | null
  readonly createdIso: string
  readonly updatedIso: string
  readonly comments: readonly PlannedComment[]
}

export interface DriftDisclosure {
  readonly issue: string
  readonly snapshotState: string
  readonly currentState: string
  readonly snapshotDesiredCode: number
  readonly plannedCode: number | null
  readonly note: string
}

export interface MigrationPlan {
  readonly schema: typeof PLAN_SCHEMA
  readonly source: {
    readonly export: string
    readonly expectations: string | null
    readonly rows: number
    readonly rowsDropped: number
  }
  /** 建档 provision（states=STATE_MAP 冻结表 distinct 值按表序；stateFlow 空表——Phase0 导出无边数据不伪造） */
  readonly provision: FieldProvisionMap
  /** 父先子后的写入序（拓扑；同层按 created/ref 升序——确定性） */
  readonly writeOrder: readonly string[]
  readonly issues: readonly PlannedTicket[]
  readonly gaps: readonly PlanGap[]
  /** 导出晚于 Phase0 快照的漂移行（显式披露，不算 gap；真迁窗口逐项豁免签认） */
  readonly drift: readonly DriftDisclosure[]
  readonly meta: {
    readonly planHash: string
    readonly note: string
  }
}

export interface MigrateOutcome {
  readonly schema: typeof REPORT_SCHEMA
  readonly root: string
  readonly dryRun: boolean
  readonly planHash: string
  readonly issues: number
  readonly comments: number
  readonly links: number
  readonly written: number
  readonly skipped: number
  readonly gapCount: number
  readonly blocking: boolean
  readonly gaps: readonly PlanGap[]
  readonly driftDisclosed: number
  readonly provisionStates: number
  /** M2 真实快照路径：审计旁注落点（相对 root）与 history 摘要条数；M1 路径不出现 */
  readonly auditFile?: string
  readonly auditHistoryNotes?: number
}

/* ------------------------------------------------------------------ */
/* 计划构建（纯函数：同 fixture 同计划，planHash 稳定）                  */
/* ------------------------------------------------------------------ */

function isoOf(epochMs: number): string {
  return new Date(epochMs).toISOString()
}

/** provision 状态全集=STATE_MAP 冻结表 distinct 平台态（表序；首元素「新单」=流程初态） */
export function provisionOf(): FieldProvisionMap {
  const states: string[] = []
  for (const row of STATE_MAP) {
    if (!states.includes(row.from)) states.push(row.from)
  }
  return {
    fields: {
      type: 'type',
      dept: 'dept',
      level: 'level',
      lane: 'lane',
      assignee: 'assignee',
      parent: 'parent',
    },
    states,
    stateFlow: {},
  }
}

function sourceRowJson(row: Phase0Row): string {
  return canonicalJson({
    externalRef: row.issue,
    state: row.state,
    type: row.type,
    dept: row.dept,
    level: row.level,
    dispatcher: row.dispatcher,
    lane: row.lane,
    assignee: row.assignee,
    parent: row.parent,
    created: row.created,
    updated: row.updated,
    migratedBy: 'taiga-localplatform-migrate/v1（task-131 M1）',
  })
}

/** 父先子后写入序（同层按 created/ref 升序）；环=显式 gap + 按原序写（链接会因父缺失落 gap） */
function writeOrderOf(tickets: readonly PlannedTicket[], gaps: PlanGap[]): string[] {
  const byId = new Map(tickets.map((t) => [t.id, t]))
  const pending = new Set(tickets.map((t) => t.id))
  const out: string[] = []
  const rank = (id: string): { created: string; ref: number } => {
    const t = byId.get(id)
    const split = splitIssueRef(id)
    return { created: t === undefined ? '' : t.createdIso, ref: split.id }
  }
  let guard = 0
  while (pending.size > 0) {
    let advanced = false
    const ready = [...pending]
      .filter((id) => {
        const t = byId.get(id)
        const parent = t === undefined ? null : t.parent
        return parent === null || !pending.has(parent)
      })
      .sort((a, b) => {
        const ra = rank(a)
        const rb = rank(b)
        return ra.created < rb.created ? -1 : ra.created > rb.created ? 1 : ra.ref - rb.ref
      })
    for (const id of ready) {
      pending.delete(id)
      out.push(id)
      advanced = true
    }
    if (!advanced) {
      const cycle = [...pending].sort()
      gaps.push({ kind: 'parent-cycle', issue: cycle[0] ?? null, detail: `父子链成环，以下单按原序写入（链接不落）：${cycle.join('、')}` })
      for (const id of tickets.map((t) => t.id)) {
        if (pending.delete(id)) out.push(id)
      }
      break
    }
    guard += 1
    if (guard > tickets.length + 1) break
  }
  return out
}

/** 期望表核对（rehearse checkExpectations 同口径的迁移侧投影：快照重现/漂移披露） */
function checkExpectationsForPlan(
  tickets: readonly PlannedTicket[],
  exp: Expectations,
  rowsById: ReadonlyMap<string, Phase0Row>,
  gaps: PlanGap[],
): DriftDisclosure[] {
  const drifted: DriftDisclosure[] = []
  const byId = new Map(tickets.map((t) => [t.id, t]))
  for (const m of exp.mapping) {
    const planned = byId.get(m.externalRef)
    if (planned === undefined) {
      gaps.push({ kind: 'expectation:missing-plan-row', issue: m.externalRef, detail: `期望表行 ${m.externalRef} 在计划中无对应条目（ID 保留口径下 key=源 ref）` })
      continue
    }
    const snapshotRow = stateRowOf(m.originalState)
    if (snapshotRow === undefined) {
      gaps.push({ kind: 'expectation:snapshot-unmapped', issue: m.externalRef, detail: `originalState "${m.originalState}" 不在 STATE_MAP 冻结表（停手改表走提案流）` })
      continue
    }
    if (snapshotRow.to !== m.desiredStateCode) {
      gaps.push({ kind: 'expectation:state-map-drift', issue: m.externalRef, detail: `STATE_MAP["${m.originalState}"]=${String(snapshotRow.to)} ≠ Phase0 desiredStateCode=${String(m.desiredStateCode)}（冻结映射表与 Phase0 真值漂移，停手改表走提案流）` })
      continue
    }
    if (!m.stateMatched || m.importedStateCode !== m.desiredStateCode) {
      gaps.push({ kind: 'expectation:phase0-not-matched', issue: m.externalRef, detail: `Phase0 自身记录未对齐（stateMatched=${String(m.stateMatched)} imported=${String(m.importedStateCode)} desired=${String(m.desiredStateCode)}）` })
      continue
    }
    const live = rowsById.get(m.externalRef)
    if (live === undefined) {
      gaps.push({ kind: 'expectation:missing-export-row', issue: m.externalRef, detail: `期望表行 ${m.externalRef} 在当前导出中无对应记录（导出集变化，需重选样本）` })
      continue
    }
    if (live.state !== m.originalState) {
      drifted.push({
        issue: m.externalRef,
        snapshotState: m.originalState,
        currentState: live.state,
        snapshotDesiredCode: m.desiredStateCode,
        plannedCode: planned.stateCode,
        note: `导出状态 "${live.state}" 晚于 Phase0 快照 "${m.originalState}"（单据已继续流转）；按当前导出迁移（口径=活数据），快照期望=${String(m.desiredStateCode)}；真迁窗口逐项豁免签认`,
      })
    }
  }
  return drifted
}

export function buildMigrationPlan(exported: Phase0Export, expectations: Expectations | null, exportPath: string, expectationsPath: string | null): MigrationPlan {
  const gaps: PlanGap[] = []
  // 自然键去重（127-A/rehearse 同语义 last-write-wins）
  const kept = new Map<string, { row: Phase0Row; index: number }>()
  let rowsDropped = 0
  exported.rows.forEach((row, index) => {
    const current = kept.get(row.issue)
    if (current === undefined) {
      kept.set(row.issue, { row, index })
      return
    }
    if (row.updated > current.row.updated || (row.updated === current.row.updated && index > current.index)) kept.set(row.issue, { row, index })
    rowsDropped += 1
  })
  if (rowsDropped > 0) gaps.push({ kind: 'duplicate-refs-dropped', issue: null, detail: `重复 ref 记录 ${String(rowsDropped)} 条按 last-write-wins 丢弃（与 127-A dedup 同语义）` })

  const tickets: PlannedTicket[] = []
  for (const { row } of kept.values()) {
    const { project } = splitIssueRef(row.issue)
    const mapped = stateRowOf(row.state)
    if (mapped === undefined) {
      gaps.push({ kind: 'state-unmapped', issue: row.issue, detail: `状态 "${row.state}" 不在 STATE_MAP 冻结表——仍按平台态逐字迁移（binding.ts 口径：未映射=观察事实），对账码=null` })
    }
    if (row.updated > row.created) {
      gaps.push({ kind: 'updated-after-created', issue: row.issue, detail: `updated(${isoOf(row.updated)}) 晚于 created(${isoOf(row.created)})：平台 updated=末事件 ts=created（事件流不伪造中间事件），差值登记不硬凑` })
    }
    tickets.push({
      id: row.issue,
      project,
      title: `[${row.issue}] ${row.type} · ${row.state}`,
      description: sourceRowJson(row),
      state: row.state,
      stateCode: mapped?.to ?? null,
      stateName: mapped?.toName ?? null,
      type: row.type,
      dept: row.dept,
      level: row.level,
      assignee: row.assignee,
      parent: row.parent,
      lane: row.lane,
      createdIso: isoOf(row.created),
      updatedIso: isoOf(row.updated),
      comments: [...row.comments]
        .sort((a, b) => (a.createdAt !== b.createdAt ? a.createdAt - b.createdAt : a.id < b.id ? -1 : 1))
        .map((c) => ({ author: c.author, body: c.body, signature: `— ${c.author}（taiga 迁移）`, createdAtIso: isoOf(c.createdAt), sourceId: c.id })),
    })
  }

  // 父链核对：父不在导出集/跨项目 → 链接不落 + 显式 gap（不伪造）
  const ids = new Set(tickets.map((t) => t.id))
  for (const t of tickets) {
    if (t.parent === null) continue
    if (!ids.has(t.parent)) {
      gaps.push({ kind: 'parent-missing', issue: t.id, detail: `parent ${t.parent} 不在导出集内——parent 字段照写源值（溯源），parent-child 链接不落（不伪造）` })
      continue
    }
    if (splitIssueRef(t.parent).project !== t.project) {
      gaps.push({ kind: 'parent-cross-project', issue: t.id, detail: `parent ${t.parent} 跨项目（${splitIssueRef(t.parent).project} ≠ ${t.project}）——链接不落（127-A 同口径）` })
    }
  }

  const drift = expectations === null ? [] : checkExpectationsForPlan(tickets, expectations, new Map([...kept.values()].map((k) => [k.row.issue, k.row])), gaps)
  // 显式不迁项（plan/06 §三.6：显式登记，不伪装）
  gaps.push({ kind: 'attachments-not-migrated', issue: null, detail: '附件/历史版本 diff/自定义报表=显式不迁（v1；plan/06 §三.6）' })
  gaps.push({ kind: 'dispatcher-description-only', issue: null, detail: 'dispatcher 无平台字段位（IssueCreate/setField 均无）——仅在 description 溯源 JSON 保留' })
  gaps.push({ kind: 'stateflow-edges-not-declared', issue: null, detail: 'provision.stateFlow 置空表：Phase0 导出无流边数据，不伪造（guard 接线日按部署工件补）' })

  const order = writeOrderOf(tickets, gaps)
  const planBody: Omit<MigrationPlan, 'meta'> = {
    schema: PLAN_SCHEMA,
    source: {
      export: path.basename(exportPath),
      expectations: expectationsPath === null ? null : path.basename(expectationsPath),
      rows: tickets.length,
      rowsDropped,
    },
    provision: provisionOf(),
    writeOrder: order,
    issues: tickets,
    gaps,
    drift,
  }
  // planHash 只覆盖数据体（meta 自身不入哈希——哈希不得自引用）
  const planHash = `sha256:${sha256Hex(canonicalJson(planBody))}`
  return { ...planBody, meta: { planHash, note: '时间戳全部取自源数据；计划只由源数据决定（重跑/异机同 planHash）' } }
}

/* ------------------------------------------------------------------ */
/* M2 真实快照路径（taiga-export/v1 → 平台树；plan/06 §二 M2）           */
/* ------------------------------------------------------------------ */

export const REAL_PLAN_SCHEMA = 'taiga-localplatform-migrate-real/v1'
export const AUDIT_SCHEMA = 'taiga-localplatform-migration-audit/v1'
/** 审计旁注落点（平台树内非端口路径：不进活动流、不被 issues/comments 读取面消费） */
export const AUDIT_DIR = 'migration-audit'
export const AUDIT_FILE = 'taiga-localplatform-migration.json'

/** 审计旁注：history 逐条摘要（不伪造端口事件——runbook §七.3 口径） */
export interface AuditHistoryNote {
  readonly id: string
  readonly user: string
  readonly createdAtIso: string
  readonly type: number
  readonly key: string
}

export interface AuditIssue {
  readonly id: string
  readonly ref: number
  readonly statusName: string
  readonly statusClosed: boolean | null
  readonly stateCode: number | null
  readonly severity: string | null
  readonly priority: string | null
  readonly owner: string | null
  readonly tags: readonly string[]
  readonly isBlocked: boolean
  readonly createdIso: string
  readonly modifiedIso: string
  readonly customAttributes: Readonly<Record<string, string>>
  readonly epicCount: number
  readonly childTaskCount: number
  readonly historyCount: number
  readonly history: readonly AuditHistoryNote[]
}

/** 迁移审计旁注（history/owner/severity/priority/自定义属性原值的唯一仓内落点） */
export interface MigrationAuditSidecar {
  readonly schema: typeof AUDIT_SCHEMA
  readonly source: {
    readonly snapshot: string
    readonly exportedAt: string
    readonly contentSha256: string
    readonly project: string
  }
  readonly planHash: string
  readonly counts: {
    readonly issues: number
    readonly comments: number
    readonly historyNotes: number
    readonly parentChildPairs: number
  }
  readonly mappings: {
    readonly id: string
    readonly state: string
    readonly type: string
    readonly dept: string
    readonly level: string
    readonly lane: string
    readonly severity: string
    readonly priority: string
    readonly owner: string
    readonly history: string
    readonly parent: string
  }
  readonly disclosures: readonly string[]
  readonly issues: readonly AuditIssue[]
}

export interface RealMigrationPlan {
  readonly schema: typeof REAL_PLAN_SCHEMA
  readonly source: {
    readonly snapshot: string
    readonly exportedAt: string
    readonly contentSha256: string
    readonly project: string
    readonly rows: number
    readonly rowsDropped: number
  }
  readonly provision: FieldProvisionMap
  readonly writeOrder: readonly string[]
  readonly issues: readonly PlannedTicket[]
  readonly gaps: readonly PlanGap[]
  readonly drift: readonly DriftDisclosure[]
  readonly audit: MigrationAuditSidecar
  readonly meta: {
    readonly planHash: string
    readonly note: string
  }
}

/** applyPlan 可写计划（M1 Phase0 计划 ∪ M2 真实快照计划） */
export type WritablePlan = MigrationPlan | RealMigrationPlan

/** 真实快照 provision：states=STATE_MAP 表序 ∪ 源外延态（排序稳定；首元素=流程初态） */
function realProvisionOf(usedStates: ReadonlySet<string>): FieldProvisionMap {
  const states: string[] = []
  for (const row of STATE_MAP) {
    if (usedStates.has(row.from) && !states.includes(row.from)) states.push(row.from)
  }
  for (const extra of [...usedStates].filter((s) => stateRowOf(s) === undefined).sort()) states.push(extra)
  return {
    fields: {
      type: 'type',
      dept: 'dept',
      level: 'level',
      lane: 'lane',
      assignee: 'assignee',
      parent: 'parent',
    },
    states,
    stateFlow: {},
  }
}

export function buildRealSnapshotPlan(snapshot: TaigaSnapshot, snapshotPath: string): RealMigrationPlan {
  const gaps: PlanGap[] = []
  const tickets: PlannedTicket[] = []
  const auditIssues: AuditIssue[] = []
  let updatedAfterCreated = 0
  let subjectEmpty = 0

  for (const row of snapshot.rows) {
    const mapped = stateRowOf(row.statusName)
    if (mapped === undefined) {
      gaps.push({
        kind: 'state-unmapped',
        issue: row.id,
        detail: `状态 "${row.statusName}" 不在 STATE_MAP 冻结表——平台态逐字迁移（binding.ts：未映射=Ok(unverified)+observe-unmapped，观察事实不是错误），对账码=null、对账侧按披露处理`,
      })
    }
    if (row.subject.trim() === '') {
      subjectEmpty += 1
      gaps.push({ kind: 'subject-empty', issue: row.id, detail: 'subject 为空——标题回退 [<id>]（源数据如实登记，不伪造标题）' })
    }
    if (row.modifiedIso > row.createdIso) updatedAfterCreated += 1
    tickets.push({
      id: row.id,
      project: row.project,
      title: row.subject.trim() === '' ? `[${row.id}]` : row.subject,
      description: row.description,
      state: row.statusName,
      stateCode: mapped?.to ?? null,
      stateName: mapped?.toName ?? null,
      type: row.type,
      dept: row.dept,
      level: row.level,
      assignee: row.assignee,
      parent: row.parent,
      lane: row.lane,
      createdIso: row.createdIso,
      updatedIso: row.modifiedIso,
      comments: [...row.comments]
        .sort((a, b) => (a.createdAtIso !== b.createdAtIso ? (a.createdAtIso < b.createdAtIso ? -1 : 1) : a.id < b.id ? -1 : 1))
        .map((c) => ({ author: c.author, body: c.body, signature: `— ${c.author}（taiga 迁移）`, createdAtIso: c.createdAtIso, sourceId: c.id })),
    })
    auditIssues.push({
      id: row.id,
      ref: row.ref,
      statusName: row.statusName,
      statusClosed: row.statusClosed,
      stateCode: mapped?.to ?? null,
      severity: row.severity,
      priority: row.priority,
      owner: row.owner,
      tags: row.tags,
      isBlocked: row.isBlocked,
      createdIso: row.createdIso,
      modifiedIso: row.modifiedIso,
      customAttributes: row.customAttributes,
      epicCount: row.epicCount,
      childTaskCount: row.childTaskCount,
      historyCount: row.history.length,
      history: [...row.history]
        .sort((a, b) => (a.createdAtIso !== b.createdAtIso ? (a.createdAtIso < b.createdAtIso ? -1 : 1) : a.id < b.id ? -1 : 1))
        .map((h) => ({ id: h.id, user: h.user, createdAtIso: h.createdAtIso, type: h.type, key: h.key })),
    })
  }

  // severity/priority 缺失登记（本实例 US 无原生字段、亦无自定义属性——null 如实）
  const severityMissing = snapshot.rows.filter((r) => r.severity === null).length
  const priorityMissing = snapshot.rows.filter((r) => r.priority === null).length
  if (severityMissing > 0) {
    gaps.push({ kind: 'field-absent-severity', issue: null, detail: `severity 缺失 ${String(severityMissing)}/${String(snapshot.rows.length)}（Taiga US 无原生 severity、实例无该自定义属性）→ null 如实登记，不伪造` })
  }
  if (priorityMissing > 0) {
    gaps.push({ kind: 'field-absent-priority', issue: null, detail: `priority 缺失 ${String(priorityMissing)}/${String(snapshot.rows.length)}（Taiga US 无原生 priority、实例无该自定义属性）→ null 如实登记，不伪造` })
  }
  gaps.push({
    kind: 'history-audit-only',
    issue: null,
    detail: `history ${String(snapshot.manifest.historyTotal)} 条不伪造为平台端口事件/活动流——审计旁注落 ${AUDIT_DIR}/${AUDIT_FILE}（id/user/createdAt/type/key 摘要），完整 valuesDiff 留冻结快照`,
  })
  gaps.push({
    kind: 'parent-child-as-is',
    issue: null,
    detail: `父子对=${String(snapshot.manifest.parentChildPairs.total)}（epic ${String(snapshot.manifest.parentChildPairs.epic)} / childTask ${String(snapshot.manifest.parentChildPairs.childTask)}）如实——Taiga US↔US 无父子模型（快照 fieldNotes.parent），不伪造链接`,
  })
  gaps.push({ kind: 'dispatcher-audit-only', issue: null, detail: 'owner（建单人）无平台字段位——审计旁注保留，不塞 description' })
  gaps.push({ kind: 'stateflow-edges-not-declared', issue: null, detail: 'provision.stateFlow 置空表：快照无流边数据，不伪造（guard 接线日按部署工件补）' })
  if (updatedAfterCreated > 0) {
    gaps.push({
      kind: 'updated-not-forged',
      issue: null,
      detail: `modified 晚于 created 的 ${String(updatedAfterCreated)} 单：平台 updated=created 事件 ts（带 lane 的单=lane setField 的 modified ts）——事件流不伪造中间流转，差值以审计旁注 modifiedIso 可回溯`,
    })
  }
  if (subjectEmpty > 0) {
    gaps.push({ kind: 'subject-empty-total', issue: null, detail: `subject 为空共 ${String(subjectEmpty)} 单（标题回退 [<id>]）` })
  }

  const order = writeOrderOf(tickets, gaps)
  const usedStates = new Set(snapshot.rows.map((r) => r.statusName))
  const provision = realProvisionOf(usedStates)
  const commentTotal = tickets.reduce((sum, t) => sum + t.comments.length, 0)

  const audit: MigrationAuditSidecar = {
    schema: AUDIT_SCHEMA,
    source: {
      snapshot: path.basename(snapshotPath),
      exportedAt: snapshot.exportedAt,
      contentSha256: snapshot.manifest.contentSha256,
      project: snapshot.project.slug,
    },
    planHash: '', // 落盘时由 applyPlan 回填 plan.meta.planHash（哈希体自引用豁免——同 M1 meta 不入哈希口径）
    counts: {
      issues: tickets.length,
      comments: commentTotal,
      historyNotes: auditIssues.reduce((sum, a) => sum + a.history.length, 0),
      parentChildPairs: snapshot.manifest.parentChildPairs.total,
    },
    mappings: {
      id: 'idDisplay（studio-dev-<ref>）→ 平台单 ID 逐字保留（plan/06 §三.2）',
      state: 'status.name → 平台态字符串逐字（binding.ts：observe-unmapped；对账码另走 STATE_MAP 冻结表）',
      type: '自定义属性「类型」的值 → issues.type（缺位=null 不造默认；值集 task/patrol/devtask/bug/hr 逐字）',
      dept: '自定义属性「部门」的值 → issues.dept 逐字（含 departments/ 前缀形态）',
      level: '自定义属性「等级」（数字串）→ issues.level（number；缺位=null）',
      lane: '自定义属性「泳道」的值 → issues.lane（平台侧经 setField 端口补写；缺位=null）',
      severity: '缺失 → null（本实例 US 无 severity，登记于本审计与计划 gap）',
      priority: '缺失 → null（本实例 US 无 priority，登记于本审计与计划 gap）',
      owner: 'owner.fullName → 审计旁注（平台无 dispatcher 字段位）',
      history: 'history → 审计旁注摘要（id/user/createdAt/type/key）；不伪造端口事件/活动流',
      parent: '恒 null（Taiga US↔US 无父子模型）——如实，不伪造',
    },
    disclosures: gaps.filter((g) => g.issue === null).map((g) => `${g.kind}: ${g.detail}`),
    issues: auditIssues,
  }

  const planBody: Omit<RealMigrationPlan, 'meta'> = {
    schema: REAL_PLAN_SCHEMA,
    source: {
      snapshot: path.basename(snapshotPath),
      exportedAt: snapshot.exportedAt,
      contentSha256: snapshot.manifest.contentSha256,
      project: snapshot.project.slug,
      rows: tickets.length,
      rowsDropped: snapshot.rowsDropped,
    },
    provision,
    writeOrder: order,
    issues: tickets,
    gaps,
    drift: [],
    audit,
  }
  const planHash = `sha256:${sha256Hex(canonicalJson(planBody))}`
  return {
    ...planBody,
    meta: { planHash, note: '真实快照路径：时间戳全部取自源数据（created/modified/评论 createdAt）；planHash 覆盖含审计旁注的整个数据体（重跑/异机同哈希）' },
  }
}

/* ------------------------------------------------------------------ */
/* 平台树写入（幂等）                                                  */
/* ------------------------------------------------------------------ */

function issueFilePath(root: string, id: string): string {
  return path.join(root, 'issues', `${id}.jsonl`)
}

function activityFilePath(root: string): string {
  return path.join(root, 'activity.jsonl')
}

/** 读活动流已有 created 单集（文件不存在=空；坏行/坏 id 如实抛——不静默当空） */
function existingCreatedActivityIssues(root: string): Set<string> {
  const file = activityFilePath(root)
  if (!existsSync(file)) return new Set()
  const createdKeys = new Set<string>()
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const text = line.trim()
    if (text === '') continue
    const parsed = JSON.parse(text) as { id?: unknown; issue?: unknown; kind?: unknown }
    if (typeof parsed.id !== 'string') throw new UsageError(`${file}: 活动行缺 id（平台树损坏，fail-closed）`)
    parseActivityId(parsed.id) // 坏 id 如实抛（fail-closed）
    if (parsed.kind === 'created' && typeof parsed.issue === 'string') createdKeys.add(parsed.issue)
  }
  return createdKeys
}

/** 追加 created 活动（与 localplatform appendActivity 同形：{id,ts,issue,kind}，无 actor）。
 *  id 只从文件态取（nextActivityId=平台唯一计数权威——M2.5 修复：旧版迁移器自持 max 计数器
 *  与平台 API 写（comments/field-set 各自 nextActivityId）双计数器交错，1554 单实跑产生 769 个
 *  重复活动 id，违反 activity.ts 头注「单调递增 id」不变量，且游标语义=严格大于边界，同 id 后
 *  行会被增量翻页永久跳过。预演 switch-localfile 树校验抓出（单子切换预演-2026-11-19 §二）。 */
function appendCreatedActivity(root: string, ts: string, issue: string): void {
  const id = nextActivityId(root)
  appendFileSync(activityFilePath(root), `${JSON.stringify({ id, ts, issue, kind: 'created' })}\n`, 'utf8')
}

function sameTicketShape(actual: { title: string; state: string; type?: string; dept?: string; level?: number; assignee?: string; parent?: string; lane?: string }, planned: PlannedTicket): boolean {
  return (
    actual.title === planned.title &&
    actual.state === planned.state &&
    (actual.type ?? null) === planned.type && // M2：type 可缺位（null 如实）；M1 恒非空→行为不变
    (actual.dept ?? null) === planned.dept &&
    (actual.level ?? null) === planned.level &&
    (actual.assignee ?? null) === planned.assignee &&
    (actual.parent ?? null) === planned.parent
  )
}

/** 审计旁注落盘体（applyPlan 注入 planHash 后写出；确定性=同计划同文件） */
function auditFileBody(plan: RealMigrationPlan): string {
  return `${JSON.stringify({ ...plan.audit, planHash: plan.meta.planHash }, null, 2)}\n`
}

/** meta/links.jsonl 显式 parent-child 对（缺文件=空集——链接幂等判据，见 applyPlan 步骤3） */
function explicitParentChildPairs(root: string): Set<string> {
  const file = path.join(root, 'meta', 'links.jsonl')
  if (!existsSync(file)) return new Set()
  const out = new Set<string>()
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    const rec = JSON.parse(line) as { a?: unknown; b?: unknown; type?: unknown }
    if (rec.type === 'parent-child' && typeof rec.a === 'string' && typeof rec.b === 'string') out.add(parentChildKey(rec.a, rec.b))
  }
  return out
}

function parentChildKey(parent: string, child: string): string {
  return `${parent} ${child}`
}

export async function applyPlan(plan: WritablePlan, root: string): Promise<MigrateOutcome> {
  const gaps = [...plan.gaps]
  let commentsWritten = 0
  let linksWritten = 0
  let written = 0
  let skipped = 0

  // 注入时钟：写路径全部吃源数据时间戳（幂等前提；零系统时钟）
  let clockNow = plan.issues[0]?.createdIso ?? new Date(0).toISOString()
  const platform: FlowPlatform = createLocalPlatform(root, { now: () => clockNow })

  // 0) 树内计划外单=blocking（迁移窗口只写空树/本计划的树——plan/06 §三.3）
  const issuesDir = path.join(root, 'issues')
  if (existsSync(issuesDir)) {
    const plannedIds = new Set(plan.issues.map((t) => t.id))
    const extra = readdirSync(issuesDir)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => name.slice(0, -'.jsonl'.length))
      .filter((id) => !plannedIds.has(id))
    if (extra.length > 0) gaps.push({ kind: 'extra-ticket', issue: null, detail: `平台树存在计划外单 ${String(extra.length)} 张（${extra.slice(0, 5).join('、')}${extra.length > 5 ? '…' : ''}）——迁移只允许写空树/本计划树（plan/06 §三.3），拒跑` })
  }

  // 1) provision（整体替换语义天然幂等；已有异档=blocking 漂移）
  const existingProvisionFile = path.join(root, 'meta', 'fields.json')
  if (existsSync(existingProvisionFile)) {
    const existing = JSON.parse(readFileSync(existingProvisionFile, 'utf8')) as { provision?: unknown }
    if (canonicalJson(existing.provision ?? null) !== canonicalJson(plan.provision)) {
      gaps.push({ kind: 'provision-diverged', issue: null, detail: `meta/fields.json 已有异档 provision（期望=${canonicalJson(plan.provision)}）——树漂移，拒覆盖（回滚清树或改计划）` })
    }
  }
  // 树内有计划外单/provision 异档=拒写（迁移窗口只允许写空树/本计划树——plan/06 §三.3；一次写入都不做）
  const preBlocked = gaps.some((g) => g.kind === 'extra-ticket' || g.kind === 'provision-diverged')
  if (!preBlocked) {
    await platform.fields.provision(plan.provision)
  }

  // 2) 单据写入（父先子后；已存在且形状一致=幂等跳过）；预检 blocking 时全拒写
  const createdActivityIssues = existingCreatedActivityIssues(root)
  const byId = new Map(plan.issues.map((t) => [t.id, t]))
  const linkable: PlannedTicket[] = []
  for (const id of plan.writeOrder) {
    if (preBlocked) break
    const planned = byId.get(id)
    if (planned === undefined) continue
    clockNow = planned.createdIso
    const file = issueFilePath(root, id)
    if (existsSync(file)) {
      const record = await platform.issues.get(id)
      if (!sameTicketShape(record, planned)) {
        gaps.push({ kind: 'ticket-diverged', issue: id, detail: `平台树已有 ${id} 且形状不一致（平台 title/state/type/dept/level/assignee/parent vs 计划漂移）——拒覆盖；如需重迁先清树` })
        continue
      }
      skipped += 1
    } else {
      // created 事件直写（ID 保留唯一路径——issues.create() 只能分配 LOCAL-N；头注端口缺口）
      // M2：type/dept/level 可缺位（null 不写入事件——平台派生 undefined≡null 归一口径）
      const input: Record<string, unknown> = {
        title: planned.title,
        description: planned.description,
      }
      if (planned.type !== null) input.type = planned.type
      if (planned.dept !== null) input.dept = planned.dept
      if (planned.level !== null) input.level = planned.level
      input.initialState = planned.state
      if (planned.assignee !== null) input.assignee = planned.assignee
      if (planned.parent !== null) input.parent = planned.parent
      appendFileSync(file, `${JSON.stringify({ type: 'created', ts: planned.createdIso, state: planned.state, input })}\n`, 'utf8')
      if (!createdActivityIssues.has(id)) {
        appendCreatedActivity(root, planned.createdIso, id)
      }
      written += 1
      // 直写后经平台读回校验（事件流可派生=格式正确性的平台侧证明）
      const record = await platform.issues.get(id)
      if (!sameTicketShape(record, planned)) {
        gaps.push({ kind: 'created-event-rejected', issue: id, detail: `created 事件写入后平台读回形状不一致（title="${record.title}" state="${record.state}"）——事件格式与 localplatform 派生口径不符` })
        continue
      }
    }
    // 评论（缺失尾段补齐；逐字保留 body/author，created=源时间戳）
    const plannedComments = planned.comments
    if (plannedComments.length > 0) {
      const existing = await platform.comments.list(id)
      let prefix = true
      for (let i = 0; i < existing.length; i += 1) {
        const want = plannedComments[i]
        if (want === undefined || existing[i]?.author !== want.author || existing[i]?.body !== want.body) {
          prefix = false
          break
        }
      }
      if (prefix && existing.length > plannedComments.length) {
        gaps.push({ kind: 'comments-diverged', issue: id, detail: `平台评论 ${String(existing.length)} 条多于计划 ${String(plannedComments.length)} 条——树漂移，拒跑` })
      } else if (prefix) {
        // 已写前缀一致：补尾段
        for (const c of plannedComments.slice(existing.length)) {
          clockNow = c.createdAtIso
          await platform.comments.add(id, { author: c.author, body: c.body, signature: c.signature })
          commentsWritten += 1
        }
      } else {
        gaps.push({ kind: 'comments-diverged', issue: id, detail: `平台既有评论与计划前缀不一致（author/body 逐字比对失败）——树漂移，拒跑` })
      }
    }
    // lane（IssueCreate 无 lane 位——经 setField 补；平台 API 通道）
    if (planned.lane !== null) {
      const record = await platform.issues.get(id)
      if ((record.lane ?? null) !== planned.lane) {
        clockNow = planned.updatedIso
        await platform.issues.setField(id, 'lane', planned.lane)
      }
    }
    const parentTicket = planned.parent === null ? null : byId.get(planned.parent) ?? null
    if (parentTicket !== null && planned.parent !== null) {
      linkable.push(planned)
    } else if (planned.parent !== null && !byId.has(planned.parent)) {
      // parent-missing/跨项目已在计划 gap 登记（buildMigrationPlan）；此处不重复
    }
  }

  // 3) 父子链接（links.link 平台 API；幂等=meta/links.jsonl 显式链已含则跳过）
  //    幂等判据读显式链文件本身，不用 links.children()——children=显式链∪parent 字段，
  //    前缀盲区修复后 list() 可见外源 id，parent 字段派生已覆盖 children 视图，但显式链
  //    落盘是 M1 冻结口径（两视图独立维护），此处按文件判重（links.ts 头注）
  const explicitPairs = explicitParentChildPairs(root)
  for (const child of linkable) {
    const parent = child.parent
    if (parent === null) continue
    if (explicitPairs.has(parentChildKey(parent, child.id))) continue
    clockNow = child.updatedIso
    await platform.links.link(parent, child.id, 'parent-child')
    explicitPairs.add(parentChildKey(parent, child.id))
    linksWritten += 1
  }

  // 4) 审计旁注（M2 真实快照路径）：history/owner/severity/priority/自定义属性原值落
  //    root/migration-audit/——非端口路径（issues/activity/meta/kb 读面之外），不进活动流。
  //    幂等口径：文件存在且逐字节一致=跳过；存在但不同=audit-diverged（blocking，拒改）
  let auditFile: string | undefined
  let auditHistoryNotes: number | undefined
  if (plan.schema === REAL_PLAN_SCHEMA) {
    auditFile = path.join(root, AUDIT_DIR, AUDIT_FILE)
    auditHistoryNotes = plan.audit.counts.historyNotes
    if (!preBlocked) {
      const body = auditFileBody(plan)
      if (existsSync(auditFile)) {
        if (readFileSync(auditFile, 'utf8') !== body) {
          gaps.push({ kind: 'audit-diverged', issue: null, detail: `${AUDIT_DIR}/${AUDIT_FILE} 已存在且内容与计划审计体不一致——旁注树漂移，拒覆盖（对账以冻结快照为准重建或人工核）` })
        }
      } else {
        mkdirSync(path.dirname(auditFile), { recursive: true })
        writeFileSync(auditFile, body, 'utf8')
      }
    }
  }

  const blocking = gaps.some((g) =>
    g.kind === 'extra-ticket' || g.kind === 'provision-diverged' || g.kind === 'ticket-diverged' ||
    g.kind === 'created-event-rejected' || g.kind === 'comments-diverged' || g.kind === 'audit-diverged' ||
    g.kind.startsWith('expectation:'),
  )
  const commentTotal = plan.issues.reduce((sum, t) => sum + t.comments.length, 0)
  const outcome: MigrateOutcome = {
    schema: REPORT_SCHEMA,
    root,
    dryRun: false,
    planHash: plan.meta.planHash,
    issues: plan.issues.length,
    comments: commentTotal,
    links: plan.issues.filter((t) => t.parent !== null).length,
    written,
    skipped,
    gapCount: gaps.length,
    blocking,
    gaps,
    driftDisclosed: plan.drift.length,
    provisionStates: plan.provision.states.length,
    ...(auditFile !== undefined ? { auditFile } : {}),
    ...(auditHistoryNotes !== undefined ? { auditHistoryNotes } : {}),
  }
  return outcome
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

const USAGE = '用法：node scripts/taiga-localplatform-migrate.ts [--snapshot <taiga-export.json> | --export <ticket-export.json>] [--expectations <ticket-diff.json> | --skip-expectations] [--root <platform root>] [--dry-run] [--out <plan.json>] [--cleanup]'

export async function migrateCli(argv: readonly string[]): Promise<{ code: number; stdout: string }> {
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
  const snapshotArg = take('--snapshot')
  const exportArg = take('--export')
  const expectationsArg = take('--expectations')
  const rootArg = take('--root') ?? DEFAULT_ROOT
  const outPath = take('--out')
  const skipExpectations = has('--skip-expectations')
  const dryRun = has('--dry-run')
  const cleanup = has('--cleanup')
  if (args.some((a) => a === '--help' || a === '-h')) return { code: 0, stdout: `${USAGE}\n` }
  if (args.length > 0) throw new UsageError(`未知参数：${args.join(' ')}；${USAGE}`)
  if (snapshotArg !== undefined && (exportArg !== undefined || expectationsArg !== undefined || skipExpectations)) {
    throw new UsageError(`--snapshot 与 --export/--expectations/--skip-expectations 互斥；${USAGE}`)
  }

  // ---- M2 真实快照路径（taiga-export/v1 → 平台树）----
  if (snapshotArg !== undefined) {
    const t0 = performance.now()
    const snapshot = loadTaigaSnapshot(snapshotArg)
    const tLoad = performance.now()
    const plan = buildRealSnapshotPlan(snapshot, snapshotArg)
    const tPlan = performance.now()
    if (dryRun) {
      // dry-run=零写盘：计划与审计旁注只算不写（root 不得被创建——演练断言点）
      const summary = {
        schema: REPORT_SCHEMA,
        root: rootArg,
        dryRun: true,
        planHash: plan.meta.planHash,
        issues: plan.issues.length,
        comments: plan.issues.reduce((s, t) => s + t.comments.length, 0),
        links: plan.issues.filter((t) => t.parent !== null).length,
        gapCount: plan.gaps.length,
        gapKinds: plan.gaps.map((g) => g.kind),
        driftDisclosed: plan.drift.length,
        provisionStates: plan.provision.states.length,
        provisionStateList: plan.provision.states,
        unmappedStates: [...new Set(plan.issues.filter((t) => t.stateCode === null).map((t) => t.state))],
        auditHistoryNotes: plan.audit.counts.historyNotes,
        timingMs: { load: Math.round(tLoad - t0), plan: Math.round(tPlan - tLoad) },
      }
      return { code: 0, stdout: `${JSON.stringify(summary)}\n` }
    }
    const outcome = await applyPlan(plan, rootArg)
    const tApply = performance.now()
    if (outPath !== undefined) {
      writeFileSync(outPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
    }
    const summary = {
      schema: outcome.schema,
      root: outcome.root,
      dryRun: false,
      planHash: outcome.planHash,
      issues: outcome.issues,
      comments: outcome.comments,
      links: outcome.links,
      written: outcome.written,
      skipped: outcome.skipped,
      gapCount: outcome.gapCount,
      gaps: outcome.gaps,
      blocking: outcome.blocking,
      driftDisclosed: outcome.driftDisclosed,
      provisionStates: outcome.provisionStates,
      auditFile: outcome.auditFile,
      auditHistoryNotes: outcome.auditHistoryNotes,
      timingMs: { load: Math.round(tLoad - t0), plan: Math.round(tPlan - tLoad), apply: Math.round(tApply - tPlan), total: Math.round(tApply - t0) },
      ...(outPath !== undefined ? { out: outPath } : {}),
    }
    if (cleanup && !outcome.blocking) {
      const resolved = path.resolve(rootArg)
      if (statSync(resolved, { throwIfNoEntry: false })?.isDirectory() === true) rmSync(resolved, { recursive: true, force: true })
      return { code: 0, stdout: `${JSON.stringify({ ...summary, cleanup: true })}\n` }
    }
    return { code: outcome.blocking ? 1 : 0, stdout: `${JSON.stringify(summary)}\n` }
  }

  // ---- M1 Phase0 fixture 路径（原行为逐字节保持）----
  const exportPath = exportArg ?? DEFAULT_EXPORT
  const expectationsPath = expectationsArg ?? DEFAULT_EXPECTATIONS
  const exported = loadPhase0Export(exportPath)
  const expectations = skipExpectations ? null : loadExpectations(expectationsPath)
  const plan = buildMigrationPlan(exported, expectations, exportPath, skipExpectations ? null : expectationsPath)

  if (dryRun) {
    const summary = {
      schema: REPORT_SCHEMA,
      root: rootArg,
      dryRun: true,
      planHash: plan.meta.planHash,
      issues: plan.issues.length,
      comments: plan.issues.reduce((s, t) => s + t.comments.length, 0),
      links: plan.issues.filter((t) => t.parent !== null).length,
      gapCount: plan.gaps.length,
      gapKinds: plan.gaps.map((g) => g.kind),
      driftDisclosed: plan.drift.length,
      provisionStates: plan.provision.states.length,
    }
    return { code: 0, stdout: `${JSON.stringify(summary)}\n` }
  }

  const outcome = await applyPlan(plan, rootArg)
  if (outPath !== undefined) {
    writeFileSync(outPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
  }
  const summary = {
    schema: outcome.schema,
    root: outcome.root,
    dryRun: false,
    planHash: outcome.planHash,
    issues: outcome.issues,
    comments: outcome.comments,
    links: outcome.links,
    written: outcome.written,
    skipped: outcome.skipped,
    gapCount: outcome.gapCount,
    gaps: outcome.gaps,
    blocking: outcome.blocking,
    driftDisclosed: outcome.driftDisclosed,
    provisionStates: outcome.provisionStates,
    ...(outPath !== undefined ? { out: outPath } : {}),
  }
  if (cleanup && !outcome.blocking) {
    const resolved = path.resolve(rootArg)
    if (statSync(resolved, { throwIfNoEntry: false })?.isDirectory() === true) rmSync(resolved, { recursive: true, force: true })
    return { code: 0, stdout: `${JSON.stringify({ ...summary, cleanup: true })}\n` }
  }
  return { code: outcome.blocking ? 1 : 0, stdout: `${JSON.stringify(summary)}\n` }
}

if (isDirectRun()) {
  try {
    const { code, stdout } = await migrateCli(process.argv.slice(2))
    process.stdout.write(stdout)
    process.exit(code)
  } catch (cause) {
    if (cause instanceof UsageError) {
      console.error(`[taiga-localplatform-migrate] ${cause.message}`)
      process.exit(2)
    }
    throw cause
  }
}
