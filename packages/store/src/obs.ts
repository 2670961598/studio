/**
 * obs —— MIG-04 / IMPL-04-08：REC-OBS-01 投影快照的**只读投影**（六态／dataValidWindow／sourceCursor／
 * generatedAt／stale 出口）
 *
 * 依据：plan/05 IMPL-04-08（投影只读断言＝NEG-MON-03 前腿；stale 字段为 MIG-08 出口预留）；v2/11 §十二
 * REC-OBS-01（字段与不变量：只读投影不得反向改写历史、不得成为第二事实源或隐蔽写路径；多公司隔离）；
 * v2/08 §4.1 投影六态（observed/derived/unknown/stale/conflicted/gapped；未知不得显示为零/无风险/已完成；
 * 陈旧＝超事前新鲜度要求须重核；冲突不得静默选边；缺口整段降级并标最后可信游标）、§4.2（观察面/视图
 * 元数据）、§4.4（监控故障是一等观察；不得留空/显示为零/沿用最后一张健康快照）；v2/17 NEG-MON-01（未知
 * 显示为 0/空/绿、全绿冒充健康、stale 出口）／NEG-MON-03（监控不改事实）；v2/09 ENU-52/59/60 值集唯一
 * 主表（本文件零新增值集，运行时集合一律 import contract 根出口）。
 *
 * 读侧口径（本文件只读；写面归 IMPL-04-06 hist.ts 与 IMPL-06 PORT-OBS.reportFault，均不在本单领土）：
 *   ① 只发 SELECT：无 INSERT/UPDATE/DELETE、无事务写、不落记录——NEG-MON-03 前腿；返回值深冻结。
 *   ② 视图定位＝(company, view_identity.view_id)；公司维是隔离第①元。
 *   ③ 版本＝最新 produced_at；同刻多条最新＝版本链歧义 → 整段 conflicted（不得静默选边）。
 *   ④ 最新快照 JSON 可解但形状不符 → 整段 gapped（投影失败），不回退旧快照（§4.4）；JSON 不可解的行无法
 *      归属任何视图，由 json_valid 前置排除（不猜归属/内容；该口径登记为读侧缺口，不冒充已闭合）。
 *   ⑤ 请求面逐面给答案：快照无该面状态槽 → unknown（材料不足），不补 0/空串/绿。
 *   ⑥ 新鲜度（可选，读侧局部声明）：generated_at 与 data_valid_window.to 取较旧者计龄，超 maxAgeMs →
 *      observed/derived 降 stale 并给显式出口 staleExits（须取更新快照＋最后可信游标/截止时刻），供
 *      MIG-08 panel 六态出口消费；未声明＝不凭空造 stale；状态槽内自标的 stale 原样承载。
 *   ⑦ 完整性非 complete 却全槽 observed＝全绿冒充健康 → 逐面 conflicted（不显示为健康）。
 *   ⑧ 投影失败/陈旧/冲突以 fault 复述（类别复用 ENU-59），是一等观察的只读呈现；不写 REC-OBS-02。
 *
 * 登记缺口：contract 记录族形状（records/obs.ts）未从包根导出（contract/src/index.ts 只导出 ports/schemas），
 * 本文件只做窄字段守卫（消费字段以 v2/11 §十二为唯一口径），导出面补齐后改消费契约 schema；
 * state_assignments 的「面/指标」键无封闭清单（v2/11 §十二 登记缺口 2），故 faces 必须显式点名（空集
 * 可能被误读为「无异常」——NEG-MON-01）。
 *
 * 纪律：只写可擦除语法；相对 import 带 `.ts`；类型导入 `import type`；不新增记录类/端口/枚举。
 */
import type { DatabaseSync } from 'node:sqlite'
import { PROJECTION_STATES, configInvalid } from '@studio-next/contract'
import type { ProjectionFaultKind, ProjectionState, ViewCompleteness } from '@studio-next/contract'

/** REC-OBS-01 在 records 表族的登记位（v2/11 §一/§十二） */
export const OBS_PROJECTION_RECORD_TYPE = 'REC-OBS-01' as const
/** OBS 观察族 AREA（v2/11 §0.9 十三 AREA 封闭登记） */
export const OBS_PROJECTION_RECORD_AREA = 'OBS' as const

// —— 一、查询与投影形状（读面；全部 readonly） ——

/** 新鲜度要求（读侧局部策略；时钟由调用方注入——store 不读系统时钟判陈旧） */
export interface ObservationFreshnessRequirement {
  /** 评估时点（ISO 带偏移；与记录时间同形，如 `2026-10-28T02:00:00.000Z`） */
  readonly now: string
  /** 允许的最大生成/数据窗距评估时点的跨度（毫秒，≥0） */
  readonly maxAgeMs: number
}

// 投影查询：**必须显式点名面/指标**（faces 非空）——空集可能被误读为「无异常」（NEG-MON-01），构造期拒。
export interface ObservationSnapshotQuery {
  /** 公司标识（隔离第①元；不跨公司取快照） */
  readonly company: string
  /** 视图标识（REC-OBS-01 `view_identity.view_id`；MON-xx 观察面或端点视图名） */
  readonly viewName: string
  /** 请求的观察面/指标键（未知即 unknown，不补 0/空/绿；重复项去重保序） */
  readonly faces: readonly string[]
  /** 新鲜度要求；缺省＝不判 stale（不得凭空造陈旧） */
  readonly freshness?: ObservationFreshnessRequirement
}

/** 权威来源（端点＋代次；激活引用须解析到 REC-AUTH-07——v2/11 §十二） */
export interface ObservationAuthoritativeSource {
  readonly endpoint: { readonly refId: string; readonly refVersion: string }
  readonly generation: number
  readonly activation: { readonly refType: string; readonly refId: string; readonly refVersion: string }
}

/** 业务有效时间窗（v2/11 REC-OBS-01.data_valid_window；不是生成时间） */
export interface ObservationDataValidWindow {
  readonly from: string
  readonly to: string
}

// 逐面状态槽：state 走 ENU-52 六态；lastTrustedCursor 缺面时为 null（不是空串——「未知不补空」）。
export interface ProjectionFaceState {
  readonly face: string
  readonly state: ProjectionState
  readonly basis: string
  readonly lastTrustedCursor: string | null
}

// stale 显式出口（MIG-08 预留）：唯一出口＝取得 generated_at 更新且来源游标/代次前进的新快照。
// freshnessDeadline/overdueMs 仅在本投影按声明新鲜度判出 stale 时非 null（生产者自标 stale 时判据归生产者）。
export interface ProjectionStaleExit {
  readonly face: string
  /** 出口条件（字面量 true）：须取更新快照；不得沿用旧快照冒充新鲜（§4.4） */
  readonly requiresNewerSnapshot: true
  readonly lastTrustedCursor: string | null
  readonly generatedAt: string | null
  /** 生成距今（ms；未声明新鲜度=null） */
  readonly generatedAgeMs: number | null
  /** 数据窗终点距今（ms；未声明新鲜度=null） */
  readonly dataWindowEndAgeMs: number | null
  /** 新鲜度截止时刻（较旧锚＋maxAgeMs；未声明新鲜度=null） */
  readonly freshnessDeadline: string | null
  /** 超期毫秒（>0 才判 stale；未声明新鲜度=null） */
  readonly overdueMs: number | null
}

/** 投影侧故障观察（类别复用 ENU-59；**不落 REC-OBS-02**——写入面归 PORT-OBS.reportFault） */
export interface ObservationProjectionFault {
  readonly kind: ProjectionFaultKind
  readonly detail: string
}

// 只读投影结果（REC-OBS-01 读面形态；非 DOM-05 事实源）：元数据无可用快照时显式 null（非 0/空串），
// 逐面状态恒按请求面给答案（不省略未知面）。
export interface ObservationProjection {
  readonly view: { readonly viewName: string; readonly company: string }
  /** 是否找到该视图的 REC-OBS-01 行（false＝无快照；true 不代表可用） */
  readonly snapshotFound: boolean
  /** 所据/涉事快照行（缺失=[]；同刻歧义=全部同刻最新行——可复核） */
  readonly recordIds: readonly string[]
  readonly projectionRuleVersion: string | null
  readonly authoritativeSource: ObservationAuthoritativeSource | null
  readonly sourceCursor: string | null
  readonly generatedAt: string | null
  readonly dataValidWindow: ObservationDataValidWindow | null
  readonly knowledgeScope: readonly string[] | null
  readonly viewCompleteness: ViewCompleteness | null
  readonly stateAssignments: readonly ProjectionFaceState[]
  /** 陈旧面的显式出口（逐面一份；无陈旧面=[]） */
  readonly staleExits: readonly ProjectionStaleExit[]
  /** 投影失败/陈旧/冲突的一等观察（无=null；逐面状态本身不因此改写） */
  readonly fault: ObservationProjectionFault | null
  readonly stateLegend: string | null
  /** 「监控不改事实」的公共类型承载：只读、不改事实 */
  readonly readOnly: true
  readonly mutatesFacts: false
}

// —— 二、读面唯一入口（只读；写路径不存在） ——

// 从 records 表读 REC-OBS-01 快照并投影为只读视图（v2/08 §4.1/4.2；v2/11 §十二）。
// 只读保证：只发 SELECT、不写记录/不开写事务、返回深冻结；参数非法/库未迁移 → CONFIG_INVALID（调用方
// bug）；数据面缺失/破损/歧义 → 降级投影（unknown/gapped/conflicted），不以抛错冒充「无数据」。
export function projectObservationSnapshot(
  db: DatabaseSync,
  query: ObservationSnapshotQuery,
): ObservationProjection {
  const q = normalizeQuery(query)
  const rows = readSnapshotRows(db, q)
  if (rows.length === 0) {
    return degradedProjection(q, 'unknown', [], 'coverage_gap', [
      `公司 ${q.company} 的视图 ${q.viewName} 无 REC-OBS-01 投影快照（材料不足——未知不补 0/空/绿）`,
    ])
  }
  // 最新 produced_at 胜出；同刻多条最新＝版本链歧义（不得静默选边，v2/08 §4.1）
  const latestProducedAt = rows[0]!.producedAt
  const newest = rows.filter((row) => row.producedAt === latestProducedAt)
  if (newest.length > 1) {
    return degradedProjection(q, 'conflicted', newest.map((row) => row.recordId), 'conflict_unresolved', [
      `视图 ${q.viewName} 存在 ${newest.length} 条同刻最新 REC-OBS-01（produced_at=${latestProducedAt}）：` +
        '版本链歧义＝未解决差异，不得静默选边（v2/08 §4.1）',
    ])
  }
  const chosen = newest[0]!
  let raw: unknown
  try {
    raw = JSON.parse(chosen.payloadText)
  } catch (err) {
    return degradedProjection(q, 'gapped', [chosen.recordId], 'projection_failed', [
      `REC-OBS-01 ${chosen.recordId} payload 非合法 JSON：${errorMessage(err)}（投影失败——整段降级，不回退旧快照）`,
    ])
  }
  let snapshot: NormalizedSnapshot
  try {
    snapshot = parseSnapshotPayload(raw, q.viewName)
  } catch (err) {
    if (!(err instanceof ObsShapeError)) throw err
    return degradedProjection(q, 'gapped', [chosen.recordId], 'projection_failed', [
      `REC-OBS-01 ${chosen.recordId} payload 形状不符契约：${err.message}` +
        '（投影失败——整段降级，不回退旧快照）',
    ])
  }
  return projectUsableSnapshot(q, snapshot, [chosen.recordId])
}

// —— 三、查询归一（空面/坏时钟=CONFIG_INVALID；fail-closed） ——

interface NormalizedQuery {
  readonly company: string
  readonly viewName: string
  readonly faces: readonly string[]
  readonly freshness: { readonly nowMs: number; readonly maxAgeMs: number } | null
}

function normalizeQuery(query: ObservationSnapshotQuery): NormalizedQuery {
  const company = requireQueryString(query.company, 'company')
  const viewName = requireQueryString(query.viewName, 'viewName')
  if (!Array.isArray(query.faces) || query.faces.length === 0) {
    configInvalid(
      'store/obs:empty-faces',
      'faces 须显式点名至少一个观察面/指标（空集可能被下游误读为「无异常」——NEG-MON-01）',
    )
  }
  const faces: string[] = []
  for (const [index, face] of query.faces.entries()) {
    const value = requireQueryString(face, `faces[${index}]`)
    if (!faces.includes(value)) faces.push(value)
  }
  let freshness: NormalizedQuery['freshness'] = null
  if (query.freshness !== undefined) {
    const nowMs = Date.parse(String(query.freshness.now))
    if (!Number.isFinite(nowMs)) {
      configInvalid('store/obs:bad-freshness', `freshness.now 须为可解析的 ISO 时刻（实际 ${String(query.freshness.now)}）`)
    }
    const maxAgeMs = query.freshness.maxAgeMs
    if (typeof maxAgeMs !== 'number' || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
      configInvalid('store/obs:bad-freshness', `freshness.maxAgeMs 须为 ≥0 的有限毫秒数（实际 ${String(maxAgeMs)}）`)
    }
    freshness = { nowMs, maxAgeMs }
  }
  return { company, viewName, faces, freshness }
}

function requireQueryString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    configInvalid('store/obs:bad-query', `${field} 须为非空字符串`)
  }
  return value
}

// —— 四、records 读面（唯一 SQL；只有 SELECT） ——

interface SnapshotRow {
  readonly recordId: string
  readonly producedAt: number
  readonly payloadText: string
}

// 按 (company, REC-OBS-01, view_id) 取快照行，最新在前。json_valid 前置：JSON 坏行无法归属视图，不参与
// 投影（不猜归属）；同视图的形状坏行会被取到并在上层降级（最新坏行不得被旧快照顶替——§4.4）。
function readSnapshotRows(db: DatabaseSync, query: NormalizedQuery): SnapshotRow[] {
  const sql = [
    'SELECT record_id, produced_at, payload',
    'FROM records',
    'WHERE company = ? AND record_type = ? AND record_area = ?',
    '  AND json_valid(payload)',
    "  AND json_extract(payload, '$.view_identity.view_id') = ?",
    'ORDER BY produced_at DESC, created_at DESC, record_id DESC',
  ].join('\n')
  let rows: unknown[]
  try {
    rows = db.prepare(sql).all(query.company, OBS_PROJECTION_RECORD_TYPE, OBS_PROJECTION_RECORD_AREA, query.viewName) as unknown[]
  } catch (err) {
    const message = errorMessage(err)
    if (message.includes('no such table')) {
      configInvalid('store/obs:no-table', `records 表不可读（库是否已迁移到 v14？）：${message}`)
    }
    throw err
  }
  return rows.map((row) => {
    const record = row as Record<string, unknown>
    return {
      recordId: String(record['record_id']),
      producedAt: Number(record['produced_at']),
      payloadText: String(record['payload']),
    }
  })
}

// —— 五、REC-OBS-01 payload 窄字段守卫（只消费 v2/11 §十二 字段；非第二形状源） ——

interface NormalizedAssignment {
  readonly state: ProjectionState
  readonly basis: string
  readonly lastTrustedCursor: string
}

interface NormalizedSnapshot {
  readonly projectionRuleVersion: string
  readonly authoritativeSource: ObservationAuthoritativeSource
  readonly sourceCursor: string
  readonly generatedAt: string
  readonly generatedAtMs: number
  readonly dataValidWindow: ObservationDataValidWindow
  readonly dataWindowEndMs: number
  readonly knowledgeScope: readonly string[]
  readonly viewCompleteness: ViewCompleteness
  readonly stateAssignments: ReadonlyMap<string, NormalizedAssignment>
  readonly stateLegend: string | null
}

/** payload 形状不符的内部信号（上层转 gapped 投影，不向调用方抛错） */
class ObsShapeError extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'ObsShapeError'
  }
}

function shapeFail(detail: string): never {
  throw new ObsShapeError(detail)
}

function parseSnapshotPayload(raw: unknown, viewName: string): NormalizedSnapshot {
  const payload = expectObject(raw, 'payload')
  const identity = expectObject(payload['view_identity'], 'payload.view_identity')
  const viewId = expectString(identity['view_id'], 'payload.view_identity.view_id')
  if (viewId !== viewName) {
    shapeFail(`payload.view_identity.view_id=${viewId} 与查询视图 ${viewName} 不一致`)
  }
  const projectionRuleVersion = expectString(
    identity['projection_rule_version'],
    'payload.view_identity.projection_rule_version',
  )

  const source = expectObject(payload['authoritative_source'], 'payload.authoritative_source')
  const endpoint = expectObject(source['endpoint'], 'payload.authoritative_source.endpoint')
  const endpointRef = {
    refId: expectString(endpoint['refId'], 'payload.authoritative_source.endpoint.refId'),
    refVersion: expectString(endpoint['refVersion'], 'payload.authoritative_source.endpoint.refVersion'),
  }
  const generation = source['generation']
  if (typeof generation !== 'number' || !Number.isInteger(generation) || generation < 0) {
    shapeFail('payload.authoritative_source.generation 须为 ≥0 整数（端点代次）')
  }
  const activation = expectObject(source['activation_ref'], 'payload.authoritative_source.activation_ref')
  const activationRef = {
    refType: expectString(activation['refType'], 'payload.authoritative_source.activation_ref.refType'),
    refId: expectString(activation['refId'], 'payload.authoritative_source.activation_ref.refId'),
    refVersion: expectString(activation['refVersion'], 'payload.authoritative_source.activation_ref.refVersion'),
  }
  if (activationRef.refType !== 'REC-AUTH-07') {
    shapeFail('payload.authoritative_source.activation_ref.refType 须为 REC-AUTH-07（权威来源须可解析到激活记录）')
  }

  const sourceCursor = expectString(payload['source_cursor'], 'payload.source_cursor')
  const generated = expectTimestamp(payload['generated_at'], 'payload.generated_at')
  const window = expectObject(payload['data_valid_window'], 'payload.data_valid_window')
  const windowFrom = expectTimestamp(window['from'], 'payload.data_valid_window.from')
  const windowTo = expectTimestamp(window['to'], 'payload.data_valid_window.to')
  if (windowFrom.ms > windowTo.ms) {
    shapeFail('payload.data_valid_window.from 晚于 to（业务有效时间窗倒置）')
  }
  const knowledgeScope = expectNonEmptyStringArray(payload['knowledge_scope'], 'payload.knowledge_scope')
  const viewCompleteness = expectCompleteness(payload['view_completeness'])
  const stateLegendRaw = payload['state_legend']
  const stateLegend = stateLegendRaw === undefined || stateLegendRaw === null
    ? null
    : expectString(stateLegendRaw, 'payload.state_legend')

  const assignmentsRaw = expectObject(payload['state_assignments'], 'payload.state_assignments')
  const assignmentEntries = Object.entries(assignmentsRaw)
  if (assignmentEntries.length === 0) {
    shapeFail('payload.state_assignments 不得为空（逐面状态槽缺失＝留白/全绿冒充健康风险——§十二）')
  }
  const stateAssignments = new Map<string, NormalizedAssignment>()
  for (const [face, value] of assignmentEntries) {
    if (face.trim() === '') shapeFail('payload.state_assignments 含空面键')
    const path = `payload.state_assignments.${face}`
    const assignment = expectObject(value, path)
    const state = assignment['state']
    if (!isProjectionState(state)) {
      shapeFail(`${path}.state 须为 ENU-52 投影六态之一（实际 ${String(state)}）`)
    }
    stateAssignments.set(face, {
      state,
      basis: expectString(assignment['basis'], `${path}.basis`),
      lastTrustedCursor: expectString(assignment['last_trusted_cursor'], `${path}.last_trusted_cursor`),
    })
  }

  return {
    projectionRuleVersion,
    authoritativeSource: { endpoint: endpointRef, generation, activation: activationRef },
    sourceCursor,
    generatedAt: generated.text,
    generatedAtMs: generated.ms,
    dataValidWindow: { from: windowFrom.text, to: windowTo.text },
    dataWindowEndMs: windowTo.ms,
    knowledgeScope,
    viewCompleteness,
    stateAssignments,
    stateLegend,
  }
}

function expectObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    shapeFail(`${path} 须为对象（实际 ${describeValue(value)}）`)
  }
  return value as Record<string, unknown>
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    shapeFail(`${path} 须为非空字符串（实际 ${describeValue(value)}）`)
  }
  return value
}

function expectTimestamp(value: unknown, path: string): { readonly text: string; readonly ms: number } {
  const text = expectString(value, path)
  const ms = Date.parse(text)
  if (!Number.isFinite(ms)) shapeFail(`${path} 须为可解析的时刻（实际 ${text}）`)
  return { text, ms }
}

function expectNonEmptyStringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    shapeFail(`${path} 须为非空字符串数组`)
  }
  return value.map((item, index) => expectString(item, `${path}[${index}]`))
}

/**
 * 完整性三值（ENU-60）：contract 包根只导出 `ViewCompleteness` 类型、运行时集合在
 * `records/common.ts`（未从包根导出）；此处只做收窄守卫，不新增值集。
 */
function expectCompleteness(value: unknown): ViewCompleteness {
  if (value === 'complete' || value === 'incomplete' || value === 'unknown') return value
  shapeFail(`payload.view_completeness 须为 complete/incomplete/unknown 之一（实际 ${String(value)}）`)
}

function isProjectionState(value: unknown): value is ProjectionState {
  return typeof value === 'string' && (PROJECTION_STATES as readonly string[]).includes(value)
}

function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

// —— 六、投影装配（六态降级/冲突/陈旧；元数据全回显） ——

interface FreshnessAssessment {
  readonly stale: boolean
  readonly generatedAgeMs: number
  readonly dataWindowEndAgeMs: number
  readonly deadlineIso: string
  readonly overdueMs: number
}

function projectUsableSnapshot(
  query: NormalizedQuery,
  snapshot: NormalizedSnapshot,
  recordIds: readonly string[],
): ObservationProjection {
  const assignmentValues = [...snapshot.stateAssignments.values()]
  // 全绿冒充健康：完整性非 complete 却把全部状态槽标 observed（v2/11 §十二/§8.1）
  const allGreenClaim =
    snapshot.viewCompleteness !== 'complete' && assignmentValues.every((a) => a.state === 'observed')
  const assessment = query.freshness === null ? null : assessFreshness(snapshot, query.freshness)

  const stateAssignments: ProjectionFaceState[] = query.faces.map((face) => {
    const assignment = snapshot.stateAssignments.get(face)
    if (assignment === undefined) {
      return {
        face,
        state: 'unknown',
        basis: 'REC-OBS-01 快照无该面状态槽（材料不足——未知不补 0/空/绿）',
        lastTrustedCursor: null,
      }
    }
    let state = assignment.state
    let basis = assignment.basis
    if (allGreenClaim && state === 'observed') {
      state = 'conflicted'
      basis =
        `${basis}；快照完整性=${snapshot.viewCompleteness} 却把全部状态槽标为 observed` +
        '（全绿不得冒充健康——未解决差异，v2/11 §十二）'
    } else if (assessment !== null && assessment.stale && (state === 'observed' || state === 'derived')) {
      state = 'stale'
      basis =
        `${basis}；超新鲜度要求（maxAgeMs=${query.freshness?.maxAgeMs ?? 0}；` +
        `生成距今 ${assessment.generatedAgeMs}ms、数据窗终点距今 ${assessment.dataWindowEndAgeMs}ms——须重核）`
    }
    return { face, state, basis, lastTrustedCursor: assignment.lastTrustedCursor }
  })

  const staleExits: ProjectionStaleExit[] = []
  for (const entry of stateAssignments) {
    if (entry.state !== 'stale') continue
    const assignment = snapshot.stateAssignments.get(entry.face)
    const recordedStale = assignment?.state === 'stale'
    const useAssessment = assessment !== null && (!recordedStale || assessment.stale)
    staleExits.push({
      face: entry.face,
      requiresNewerSnapshot: true,
      lastTrustedCursor: entry.lastTrustedCursor,
      generatedAt: snapshot.generatedAt,
      generatedAgeMs: useAssessment ? assessment.generatedAgeMs : null,
      dataWindowEndAgeMs: useAssessment ? assessment.dataWindowEndAgeMs : null,
      freshnessDeadline: useAssessment ? assessment.deadlineIso : null,
      overdueMs: useAssessment ? assessment.overdueMs : null,
    })
  }

  let fault: ObservationProjectionFault | null = null
  if (allGreenClaim) {
    fault = {
      kind: 'conflict_unresolved',
      detail: `快照完整性=${snapshot.viewCompleteness} 却声明全部状态槽 observed（全绿不得冒充健康——须重核/重投影）`,
    }
  } else if (assessment !== null && assessment.stale && staleExits.length > 0) {
    fault = {
      kind: 'stale_view',
      detail: `${staleExits.length} 个面超新鲜度要求（maxAgeMs=${query.freshness?.maxAgeMs ?? 0}）——陈旧有显式出口，须取更新快照`,
    }
  }

  return deepFreeze({
    view: { viewName: query.viewName, company: query.company },
    snapshotFound: true,
    recordIds: [...recordIds],
    projectionRuleVersion: snapshot.projectionRuleVersion,
    authoritativeSource: snapshot.authoritativeSource,
    sourceCursor: snapshot.sourceCursor,
    generatedAt: snapshot.generatedAt,
    dataValidWindow: snapshot.dataValidWindow,
    knowledgeScope: [...snapshot.knowledgeScope],
    viewCompleteness: snapshot.viewCompleteness,
    stateAssignments,
    staleExits,
    fault,
    stateLegend: snapshot.stateLegend,
    readOnly: true,
    mutatesFacts: false,
  })
}

// 陈旧判定：两个锚取较旧者——generated_at 与 data_valid_window.to；任一超期即 stale（业务时间过期同样
// 不得冒充新鲜）；截止时刻＝较旧锚＋maxAge。
function assessFreshness(
  snapshot: NormalizedSnapshot,
  requirement: NonNullable<NormalizedQuery['freshness']>,
): FreshnessAssessment {
  const generatedAgeMs = requirement.nowMs - snapshot.generatedAtMs
  const dataWindowEndAgeMs = requirement.nowMs - snapshot.dataWindowEndMs
  const olderAgeMs = Math.max(generatedAgeMs, dataWindowEndAgeMs)
  const overdueMs = olderAgeMs - requirement.maxAgeMs
  const deadlineIso = new Date(Math.min(snapshot.generatedAtMs, snapshot.dataWindowEndMs) + requirement.maxAgeMs).toISOString()
  return {
    stale: overdueMs > 0,
    generatedAgeMs,
    dataWindowEndAgeMs,
    deadlineIso,
    overdueMs,
  }
}

/** 降级投影（无快照=unknown／破损=gapped／同刻歧义=conflicted）：元数据一律 null，逐面显式给状态 */
function degradedProjection(
  query: NormalizedQuery,
  state: 'unknown' | 'gapped' | 'conflicted',
  recordIds: readonly string[],
  faultKind: ProjectionFaultKind,
  details: readonly string[],
): ObservationProjection {
  const basis = details.join('；')
  return deepFreeze({
    view: { viewName: query.viewName, company: query.company },
    snapshotFound: recordIds.length > 0,
    recordIds: [...recordIds],
    projectionRuleVersion: null,
    authoritativeSource: null,
    sourceCursor: null,
    generatedAt: null,
    dataValidWindow: null,
    knowledgeScope: null,
    viewCompleteness: null,
    stateAssignments: query.faces.map((face) => ({ face, state, basis, lastTrustedCursor: null })),
    staleExits: [],
    fault: { kind: faultKind, detail: basis },
    stateLegend: null,
    readOnly: true,
    mutatesFacts: false,
  })
}

// —— 七、冻结（只读投影的运行期承载：调用方改属性即 TypeError） ——

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
