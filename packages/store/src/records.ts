/**
 * records —— store 层记录形状与临时校验闸（v0.2 首刀三表 + 第二刀五表）
 *
 * 依据：docs/17-§3 行条目。
 *   - 首刀三表（work_records / sessions）：id/issue/工号/instance_id/executor/session_id/executor_session_id（202-P2 v12）/
 *     lane/branch/started/ended/cost/tokens/attempt/status/report_ref/summary_ref 与 session_id/issue/工号/archive_path/started/ended/turns。
 *   - 第二刀五表（people / personnel_events / departments / ticket_mirror / budgets）：列语义对齐 17-§3 表清单
 *     （people=公司目录镜像｜personnel_events=本库 append-only｜departments=公司目录镜像｜ticket_mirror=YouTrack 镜像｜budgets=本库）。
 *   - v3 jobs 调度表（17-§2 调度表列集 / 18-§三）：公司目录定时岗配置（D9）的持久化投影；cron 只做形状闸（非空 + ≤6 空白分隔段），表达式解析归 core 后续单——**不引 croner**。
 *   - v4 收口面 EndWorkRecord（work_records end 入参；daemon 切换前 closeWorkRecord 直发 UPDATE 的正式化）：status 终态值域不锁；tokens 已扩入参（kernel.TokenCounts，与建列/insertWorkRecord 同源——切换单清偿，见接口行注）。
 *   - v5 进化管线 candidates 表（17-§3 / core evolution 首刀）：CandidateRow 逐列对齐 core CandidateRecord 可序列化形态
 *     （值域**复制**自 core 冻结枚举——store src 零 core 运行时依赖，漂移由一致性测试钉死，沿 STUDIO_TOOLS 先例）+ created_at
 *     库侧列；形状差异取舍（asset_type 列名 / version TEXT / asset_path 补列）见 migrations v5 头注与接口行注。
 *   - v6 报表三表（17-§3 / docs/50 断链6 / 04-§三）：ledgers 单据派生镜像（LedgerEntryRecord——表名与库句柄 Ledger 撞名，记录名避撞）/ reports 报表快照行（ReportRecord，type 值域 daily/weekly/monthly 取 04-§三三档）/ probes_runs 探针跑分（ProbeRunRecord，append-only）。
 *
 * **拟稿待批（docs 未细化处逐条标明，contract 落地后替换为契约校验）**：
 *   - 「工号」列名 person_id；「started/ended」→ started_at/ended_at（epoch ms，ended 可空=在途）；「cost」→ cost_usd（对齐 events 列名）；
 *   - tokens 形状取 kernel.TokenCounts（executor 归一化三字段口径——work_records 来自收割 ResultStats，与 events 四桶不同源，F2-04 只冻结 events 侧）；
 *   - status 先为非空串（done/failed 具体枚举归收割域，contract 落地时收口）；
 *   - id / session_id 暂不锁 ULID（与 events 不同：17-§3 未标 id 形状，先非空）——五张新表同此口径。
 * 本文件对 v0 旧表仍是临时闸（拒明显坏行入账）；v2 记录族已接缝 contract 校验（文末，IMPL-04-06）：
 * 形状唯一源=contract `ALL_RECORD_SCHEMAS`，store 不再复制 v2 字段表。
 */
import { z } from 'zod'
import type { TokenCounts } from '@studio-next/contract'
import {
  ALL_RECORD_SCHEMAS, COMMON_RECORD_TYPES, checkEffectiveSlotConsistency, issuesFromZod,
  type AllRecordType, type EffectiveSlotCarrier, type RecordEnvelope, type RecordValidationIssue,
} from '../../contract/src/records/index.ts'

/** work_records 记录（done.json 索引化，17-§3「权威源」列） */
export interface WorkRecord {
  id: string
  issue: string
  person_id: string
  instance_id?: string
  executor: string
  session_id?: string
  /** executor 侧会话 id（dsh --session-id 续跑键，202-P2 migration v12 列；收割时从 Handle 落账） */
  executor_session_id?: string
  lane?: string
  branch?: string
  started_at: number
  ended_at?: number
  cost_usd?: number
  tokens?: TokenCounts
  attempt: number
  status: string
  report_ref?: string
  summary_ref?: string
  /** 模型归一形 `provider/model`（132-§6.1 单A·studio-dev-168，migration v8 加列）：收割
   *  ResultStats.model 落账位（单B/C 桥接键）；可空=无从可知（如实缺省）。 */
  model?: string
}

/** sessions 记录（归档文件的索引，17-§3） */
export interface SessionRecord {
  session_id: string
  issue: string
  person_id: string
  archive_path?: string
  started_at: number
  ended_at?: number
  turns?: number
}

// —— v0.2 第二刀五表（17-§3 列语义；各表拟稿点见行注） ——

/** people 记录（公司目录镜像，17-§3「工号(PK), 名称, login, level, dept, 岗位, skills[], side_effects, 能力档, executor 偏好, 状态」） */
export interface PersonRecord {
  person_id: string
  name: string
  login: string
  level: number
  dept: string
  role?: string
  skills?: string[]
  /** 副作用等级（写库/改单/对外发言）；17-§3 未标数组形，模板 front-matter 形如 [写盘]——拟稿按字符串数组 */
  side_effects?: string[]
  /** 能力档 0-3（V4-V7-§4.2/§14 拟稿口径；contract 冻结时收口） */
  capability_tier?: number
  executor_pref?: string
  /** 模板口径 active | paused | retired；v0 不锁枚举，先非空串 */
  status?: string
}

/** personnel_events 记录（本库 append-only，17-§3「id, ts, 工号, type(入/调/升/降/停/复/退), 前值, 新值, 单据号, 批准人」） */
export interface PersonnelEventRecord {
  id: string
  ts: number
  person_id: string
  /** 变动类型：入/调/升/降/停/复/退（17-§3）——值域 v0 不锁，contract 冻结时收口，先非空串 */
  type: string
  /** 前值（标量文本：等级数字 / 部门 path / 状态串等；复合变动拆多条——拟稿） */
  prev?: string
  next?: string
  /** 必挂单（F2-06/C1-06：无单号拒绝——列级 NOT NULL + 本闸双兜底） */
  ticket: string
  approver: string
}

/** departments 记录（公司目录镜像，17-§3「path(PK), company, 主管工号, 职能, 泳道, 上级 path」） */
export interface DepartmentRecord {
  path: string
  company: string
  leader: string
  functions: string[]
  lanes: string[]
  parent_path?: string
}

/** ticket_mirror 记录（YouTrack 镜像，17-§3「issue(PK), company, created, updated, state, type, dept, level, dispatcher, parent, lane」；assignee=v8 增列——129-B 按人重导 todo_queue 投影所需） */
export interface TicketMirrorRecord {
  issue: string
  company: string
  created: number
  updated: number
  state: string
  type: string
  dept: string
  /** 单据等级：拟稿取 1..9（04-§四 口径，同 events.level） */
  level: number
  dispatcher: string
  parent?: string
  /** 泳道；可空=未定泳道 */
  lane?: string
  /** 当前指派（129-§6.2-R2，v8）；可空=平台未指派——引擎解析链 assignee→defaultPersonId */
  assignee?: string
}

/** budgets 记录（本库，17-§3「id, issue/工号/公司, kind(reserve/settle/refusal), estimated, actual, ts」） */
export interface BudgetRecord {
  id: string
  /** 预算主体类别：issue（单号）/ person（工号）/ company（公司 slug）——scope_id 对应取值 */
  scope_kind: 'issue' | 'person' | 'company'
  scope_id: string
  /** F1-09 预算三节点：reserve（预留）/ settle（结算释放）/ refusal（超额拒绝落账） */
  kind: 'reserve' | 'settle' | 'refusal'
  estimated_usd?: number
  actual_usd?: number
  ts: number
}

// —— v3 jobs 调度表（17-§2 调度表列集 / 18-§三 调度设计；v0.4 定时岗地基） ——

/** jobs 记录（daemon 调度表；权威源=公司目录定时岗配置 D9，本表为持久化投影） */
export interface JobRecord {
  job_id: string
  company: string
  dept: string
  /** cron 表达式原样文本（解析归 core 后续单——18-§三 croner 只在 daemon 侧引，store 不依赖） */
  cron: string
  role: string
  level: number
  /** 模型三档（contract ports/models.ts ModelTier['tier']='high'|'mid'|'low' 冻结口径） */
  model_tier: 'high' | 'mid' | 'low'
  /** 预算上限 REAL（USD；对齐 contract Money{usd:number} 与库内 *_usd 列，见 migrations v3 头注） */
  budget_cap?: number
  /** 任务载荷（JSON 文本落列；任意 JSON 值，写入时序列化、读出时解析） */
  payload?: unknown
  /** 下次应跑时刻（epoch ms；补跑扫描 dueJobs 的判据列） */
  next_run_at: number
  /** 上次实跑时刻（epoch ms；可空=从未跑过——运行时状态，markRan 落账） */
  last_run_at?: number
  /** 岗位状态；值域 v0 不锁（active/paused 语义归 core 调度域后续单收口），可空=未定 */
  status?: string
}

// —— v4 吸收面（work_records 收口；daemon 合龙件债，migrations v4 同批） ——

/**
 * endWorkRecord 收口入参：daemon 切换前 closeWorkRecord 直发 UPDATE 的正式化。
 * tokens 已扩入参（清偿原「不在本面」拟稿）：形状取 kernel.TokenCounts——与 work_records
 * 建列口径（migrations v1 注）及 insertWorkRecord 同源；序列化=JSON.stringify 原序
 * （**非** events 四桶 canonical 序——两列不同源，F2-04 只冻结 events 侧），未给值 COALESCE 不动。
 */
export interface EndWorkRecord {
  /** 收口时刻（epoch ms；与 started_at 同口径非负整数） */
  ended_at: number
  /** 终态；值域 v0 不锁（done/failed 等枚举归收割域/contract 后续收口） */
  status: string
  cost_usd?: number
  /** tokens（收割 ResultStats；形状与闸同 WorkRecord.tokens） */
  tokens?: TokenCounts
  report_ref?: string
  summary_ref?: string
  /** 模型归一形 provider/model（132-§6.1 单A·studio-dev-168）：收割 ResultStats.model 直落；未给值 COALESCE 不动 */
  model?: string
}

/**
 * tokens 闸形状（132-§6.1 单A·studio-dev-168）：kernel.TokenCounts 四桶+兼容读别名——input/output 必填非负整数；
 * cache_read/cache_creation/cached 可选（cached=旧账键，读侧 `cache_read ?? cached` 认，写侧一律新键——daemon/适配器
 * 写路径不产该键，闸不拒旧形回写/回填的合法面）。与 events 四桶（F2-04 canonical 序）不同源，不锁键序。
 */
const TokenCountsShape = z.strictObject({
  input: z.number().int().min(0),
  output: z.number().int().min(0),
  cache_read: z.number().int().min(0).optional(),
  cache_creation: z.number().int().min(0).optional(),
  cached: z.number().int().min(0).optional(),
})

export const WorkRecordSchema = z.strictObject({
  id: z.string().min(1),
  issue: z.string().min(1),
  person_id: z.string().min(1),
  instance_id: z.string().min(1).optional(),
  executor: z.string().min(1),
  session_id: z.string().min(1).optional(),
  /** executor 侧会话 id（202-P2 v12 列；resumeWithSession 续跑键——收割落账） */
  executor_session_id: z.string().min(1).optional(),
  lane: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  started_at: z.number().int().min(0),
  ended_at: z.number().int().min(0).optional(),
  cost_usd: z.number().min(0).optional(),
  tokens: TokenCountsShape.optional(),
  attempt: z.number().int().min(1),
  status: z.string().min(1),
  report_ref: z.string().min(1).optional(),
  summary_ref: z.string().min(1).optional(),
  /** 模型归一形 provider/model（132-§6.1 单A；migration v8 列）——非空串，缺省=无从可知 */
  model: z.string().min(1).optional(),
})

export const SessionRecordSchema = z.strictObject({
  session_id: z.string().min(1),
  issue: z.string().min(1),
  person_id: z.string().min(1),
  archive_path: z.string().min(1).optional(),
  started_at: z.number().int().min(0),
  ended_at: z.number().int().min(0).optional(),
  turns: z.number().int().min(0).optional(),
})

// —— v0.2 第二刀五表临时闸（拟稿点见接口行注；strict：未知列拒收，加列走批示+SCHEMA_EVOLVE） ——

export const PersonRecordSchema = z.strictObject({
  person_id: z.string().min(1),
  name: z.string().min(1),
  login: z.string().min(1),
  /** agent 等级 1-9（04-§四；同 events.level 拟稿口径） */
  level: z.number().int().min(1).max(9),
  dept: z.string().min(1),
  role: z.string().min(1).optional(),
  skills: z.array(z.string().min(1)).optional(),
  side_effects: z.array(z.string().min(1)).optional(),
  capability_tier: z.number().int().min(0).max(3).optional(),
  executor_pref: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
})

export const PersonnelEventRecordSchema = z.strictObject({
  id: z.string().min(1),
  ts: z.number().int().min(0),
  person_id: z.string().min(1),
  type: z.string().min(1),
  prev: z.string().min(1).optional(),
  next: z.string().min(1).optional(),
  ticket: z.string().min(1),
  approver: z.string().min(1),
})

export const DepartmentRecordSchema = z.strictObject({
  path: z.string().min(1),
  company: z.string().min(1),
  leader: z.string().min(1),
  functions: z.array(z.string().min(1)),
  lanes: z.array(z.string().min(1)),
  parent_path: z.string().min(1).optional(),
})

export const TicketMirrorRecordSchema = z.strictObject({
  issue: z.string().min(1),
  company: z.string().min(1),
  created: z.number().int().min(0),
  updated: z.number().int().min(0),
  state: z.string().min(1),
  type: z.string().min(1),
  dept: z.string().min(1),
  level: z.number().int().min(1).max(9),
  dispatcher: z.string().min(1),
  parent: z.string().min(1).optional(),
  lane: z.string().min(1).optional(),
  assignee: z.string().min(1).optional(),
})

export const BudgetRecordSchema = z.strictObject({
  id: z.string().min(1),
  scope_kind: z.enum(['issue', 'person', 'company']),
  scope_id: z.string().min(1),
  kind: z.enum(['reserve', 'settle', 'refusal']),
  estimated_usd: z.number().min(0).optional(),
  actual_usd: z.number().min(0).optional(),
  ts: z.number().int().min(0),
})

// —— v3 jobs 临时闸（拟稿点见接口行注；strict：未知列拒收，加列走批示+SCHEMA_EVOLVE） ——

/**
 * cron 形状闸（**不引 croner**——解析归 core 后续单，store 只挡明显坏串）：非空且 trim 后至多 6 个空白分隔段
 * （5 段标准 cron / croner 6 段含秒变体）。段内语法（步进、范围、列表、别名等）不在本闸职责内。
 */
function cronShapeOk(expr: string): boolean {
  const trimmed = expr.trim()
  return trimmed !== '' && trimmed.split(/\s+/).length <= 6
}

export const JobRecordSchema = z.strictObject({
  job_id: z.string().min(1),
  company: z.string().min(1),
  dept: z.string().min(1),
  cron: z.string().min(1).refine(cronShapeOk, { message: 'cron 须为非空串且至多 6 个空白分隔段（段内语法解析归 core）' }),
  role: z.string().min(1),
  /** agent 等级 1-9（04-§四；同表系拟稿口径） */
  level: z.number().int().min(1).max(9),
  /** contract ModelTier['tier'] 冻结枚举（ports/models.ts） */
  model_tier: z.enum(['high', 'mid', 'low']),
  budget_cap: z.number().min(0).optional(),
  payload: z.unknown().optional(),
  next_run_at: z.number().int().min(0),
  last_run_at: z.number().int().min(0).optional(),
  status: z.string().min(1).optional(),
})

// —— v4 收口面临时闸（EndWorkRecord 形状见上；strict：未知列拒收——拟稿待批，见接口行注） ——

/** store 层临时校验（拟稿待批，见文件头注；status 终态值域不锁——归收割域后续收口；
 *  tokens 闸同 WorkRecordSchema.tokens：kernel.TokenCounts 四桶+兼容键，非负整数，未知桶拒；
 *  model=收割 ResultStats.model 直落（132-§6.1 单A）——非空串可选，未给值 COALESCE 不动；
 *  executor_session_id=Handle.executorSessionId 直落（202-P2 v12）——同 COALESCE 口径） */
export const EndWorkRecordSchema = z.strictObject({
  ended_at: z.number().int().min(0),
  status: z.string().min(1),
  cost_usd: z.number().min(0).optional(),
  tokens: TokenCountsShape.optional(),
  report_ref: z.string().min(1).optional(),
  summary_ref: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  executor_session_id: z.string().min(1).optional(),
})

// —— v5 进化管线 candidates 表（17-§3 / core evolution 首刀 / 02-F3；migration v5 同批） ——

/**
 * 候选制品三个值域（**复制**自 core evolution.ts 冻结值域，非 import——store src 零 core
 * 运行时依赖；core↔store 漂移由 test/v5-candidates.test.ts 一致性用例钉死：core 字面量数组
 * vs 本处数组 deep-equal，漂移即红，沿 STUDIO_TOOLS↔GATEWAY_ACTIONS 先例）。
 * 冻结依据与语义见 core evolution.ts 头注（AssetKind/BlastRadius/CandidateStatus 拟稿已裁）。
 */

/** 可进化资产类型（17-§3「资产类型」列；core ASSET_KINDS） */
export const CANDIDATE_ASSET_KINDS = ['prompt', 'org_config', 'report_spec', 'flow', 'criterion'] as const
export type CandidateAssetKind = (typeof CANDIDATE_ASSET_KINDS)[number]

/** blast_radius 分级（序=风险递增；core BLAST_RADII） */
export const CANDIDATE_BLAST_RADII = ['isolated', 'company', 'framework'] as const
export type CandidateBlastRadius = (typeof CANDIDATE_BLAST_RADII)[number]

/** 候选状态机全值域（core CANDIDATE_STATUSES，冻结链+拟稿边见 core 头注） */
export const CANDIDATE_STATUS_VALUES = [
  'draft', 'proposed', 'sandboxed', 'gated', 'approved', 'rejected', 'escalated', 'promoted', 'retired',
] as const
export type CandidateStatus = (typeof CANDIDATE_STATUS_VALUES)[number]

/** 终态集合（无出边，复活=fork 新子代；core TERMINAL_STATUSES）——幂等键「非终态命中」判据 */
export const TERMINAL_CANDIDATE_STATUS_VALUES = ['rejected', 'retired'] as const
export type TerminalCandidateStatus = (typeof TERMINAL_CANDIDATE_STATUS_VALUES)[number]

/**
 * candidates 行记录（migrations v5 建列逐列对齐）：
 * core CandidateRecord 的可序列化形态（id/asset_type/asset_path/version/diff_hash/blast_radius/
 * verification/parent_id/status 字段名与类型逐一相同）+ created_at（库侧列，超出 core 形状——
 * core 零 Date.now，时钟由 daemon 供）。字段级对齐由一致性测试钉死（type 级断言：core 加字段
 * 不跟即 typecheck 红）。
 * 形状取舍（与 17-§3 列集/任务草案的差异，逐项见 migrations v5 头注）：
 *   - asset_type 列名取 core 字段名（草案曾写 asset_kind）——行↔记录零改名；
 *   - version 为 string（core 冻结类型；草案曾写 INTEGER）；
 *   - asset_path：17-§3 未列、core 首刀裁定加入（判负面匹配键）；
 *   - verification：core 的 GateEvidence JSON 快照（同 jobs.payload 口径，读写面 JSON 往返，
 *     语义校验归 core 闸门）——null=draft 期未跑沙箱；unknown 形态=快照不猜结构。
 */
export interface CandidateRow {
  id: string
  asset_type: CandidateAssetKind
  /** 资产定位键（公司目录相对路径 / 框架资产键）——判负面匹配键之一 */
  asset_path: string
  version: string
  diff_hash: string
  blast_radius: CandidateBlastRadius
  /** 闸门证据快照（GateEvidence 的 JSON 往返值；null=未跑沙箱） */
  verification: unknown
  /** 谱系父 id（null=初代显式标记；不可变，fork-only） */
  parent_id: string | null
  status: CandidateStatus
  /** 登记时刻（epoch ms；库侧列，core 形状所无） */
  created_at: number
}

export const CandidateRowSchema = z.strictObject({
  id: z.string().min(1),
  asset_type: z.enum(CANDIDATE_ASSET_KINDS),
  asset_path: z.string().min(1),
  version: z.string().min(1),
  diff_hash: z.string().min(1),
  blast_radius: z.enum(CANDIDATE_BLAST_RADII),
  verification: z.unknown().optional(),
  parent_id: z.string().min(1).nullable(),
  status: z.enum(CANDIDATE_STATUS_VALUES),
  created_at: z.number().int().min(0),
})

// —— v6 报表三表（17-§3 / docs/50 断链6 / 04-§三 报表契约；migration v6 同批） ——

/** ledgers 单据派生面 kind 值域（17-§3「kind(task/progress)」——task=任务面 / progress=进展面） */
export const LEDGER_KIND_VALUES = ['task', 'progress'] as const
export type LedgerKind = (typeof LEDGER_KIND_VALUES)[number]

/** reports type 值域（04-§三 type 三档节奏档＋perf-weekly＝部长绩效周报专用值——130-P4/批示⑥，caliber 版本化 F2-08，节点=部门 path；增补注记见 docs/04-§三 2026-10-22 段） */
export const REPORT_TYPE_VALUES = ['daily', 'weekly', 'monthly', 'perf-weekly'] as const
export type ReportType = (typeof REPORT_TYPE_VALUES)[number]

/** date 列形状：YYYY-MM-DD（归属期锚日——月报=当月末日 UTC，由期键派生非生成时刻；拟稿待批） */
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * ledgers 记录（单据派生镜像，17-§3「issue, kind(task/progress), body(json), updated」）。
 * 表名 ledgers 与库句柄 Ledger 同名异义——表名 17-§3 冻结，记录名取 LedgerEntryRecord 避撞。
 * body 为任意 JSON 值（写入面序列化闸 + 读出面 JSON 往返，同 jobs.payload 口径——单据派生，
 * 形状归上游，store 不猜）。可由单据重建（覆盖写语义，见 ledger.ts upsertLedgerEntry 行注）。
 */
export interface LedgerEntryRecord {
  issue: string
  kind: LedgerKind
  /** JSON 文本落列的往返值（任意 JSON；不可序列化值在写入面拒） */
  body: unknown
  /** 派生时刻（epoch ms；last-write-wins——同 ticket_mirror.updated 口径） */
  updated: number
}

/**
 * reports 记录（报表快照行，17-§3「id, company, node, type, date, 口径版本, json_ref」）。
 * 自然键 (company, node, type, date) 唯一（04-§三 {node}/{date}-{type} 渲染约定的机制化）；
 * 重算覆盖换代（最新快照胜）。json_ref=公司目录相对路径（F2-03 结果体分离——正文留文件）。
 */
export interface ReportRecord {
  id: string
  company: string
  /** 报表节点：公司级=公司 slug｜部门级=部门 path｜人级=工号（04-§三逐级聚合方向） */
  node: string
  type: ReportType
  /** 归属期锚日 YYYY-MM-DD（月报=当月末日 UTC） */
  date: string
  /** 口径版本戳（如 monthly/v1——指标口径变更时换值，读面可辨新旧不可比；17-§3「口径版本」列） */
  caliber: string
  /** 报表 JSON 快照的公司目录相对路径 */
  json_ref: string
}

/**
 * probes_runs 记录（探针跑分，17-§3「executor, model, probe_id, pass, cost, duration, ts」）。
 * 拟稿：id 为库侧补列（append-only 幂等回填唯一键）；cost→cost_usd、duration→duration_ms
 * 列名对齐库内货币/时延口径（events 先例）。append-only（触发器机制保证，见 migrations v6）。
 */
export interface ProbeRunRecord {
  id: string
  executor: string
  model: string
  probe_id: string
  /** 跑分判定（行↔列 INTEGER 0/1 往返） */
  pass: boolean
  /** 可选列显式收 undefined（zod v4 .optional() 推断同款——assertRecord 回值可直接入本类型） */
  cost_usd?: number | undefined
  duration_ms?: number | undefined
  ts: number
}

export const LedgerEntrySchema = z.strictObject({
  issue: z.string().min(1),
  kind: z.enum(LEDGER_KIND_VALUES),
  body: z.unknown(),
  updated: z.number().int().min(0),
})

export const ReportRecordSchema = z.strictObject({
  id: z.string().min(1),
  company: z.string().min(1),
  node: z.string().min(1),
  type: z.enum(REPORT_TYPE_VALUES),
  date: z.string().regex(DATE_KEY_RE, 'date 须为 YYYY-MM-DD（归属期锚日——月报=当月末日 UTC）'),
  caliber: z.string().min(1),
  json_ref: z.string().min(1),
})

export const ProbeRunSchema = z.strictObject({
  id: z.string().min(1),
  executor: z.string().min(1),
  model: z.string().min(1),
  probe_id: z.string().min(1),
  pass: z.boolean(),
  cost_usd: z.number().min(0).optional(),
  duration_ms: z.number().int().min(0).optional(),
  ts: z.number().int().min(0),
})

// —— v7 DEV-48 人事同步任务队列（docs/52-§11；hr_sync_log=可流转任务账，非 append-only） ——

/** hr_sync_log 变动明细（payload 列 JSON 形状；幂等收敛所需的目标态快照关键字段） */
export interface HrSyncPayload {
  /** 变动字段维（level/dept/status/name/login/role；入/退汇总事件='*'——core hrsync 同形） */
  field: string
  prev: string | null
  next: string | null
  /** 目标态关键字段（执行器不回查目录——任务携带目标态，多执行不坏） */
  login?: string
  name?: string
  level?: number
  dept?: string
  role?: string
  status?: string
}

export const HrSyncPayloadSchema = z.strictObject({
  field: z.string().min(1),
  prev: z.string().min(1).nullable(),
  next: z.string().min(1).nullable(),
  login: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  level: z.number().int().min(1).max(9).optional(),
  dept: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
})

/** hr_sync_log 执行平台（52-§四.1 三面；结构面冻结三值） */
export const HR_SYNC_PLATFORM_VALUES = ['taiga', 'matrix', 'ledger'] as const
export type HrSyncPlatformName = (typeof HR_SYNC_PLATFORM_VALUES)[number]

/** hr_sync_log 任务状态机（52-§11 DDL 注释四态；流转合法——无 append-only 触发器） */
export const HR_SYNC_STATUS_VALUES = ['pending', 'applying', 'done', 'failed'] as const
export type HrSyncStatus = (typeof HR_SYNC_STATUS_VALUES)[number]

/**
 * hr_sync_log 记录（docs/52-§11；DEV-48）。与 personnel_events 分工：
 * personnel_events=人事事实账（append-only，权威）；本表=同步任务账（可流转，
 * pending→applying→done/failed；断电恢复 resetStaleHrSyncApplying）。
 */
export interface HrSyncTaskRecord {
  id: string
  ts: number
  company: string
  person_id: string
  /** 变动类型：入/调/升/降/停/复/退（personnel_events.type 同值域——v0 不锁枚举） */
  kind: string
  platform: HrSyncPlatformName
  /** 幂等键（52-§11：person+kind+字段维度；实现并 platform+目标值维，见 migrations v7 注） */
  op_key: string
  /** 挂单号（入队哨兵 @hr:<batchId>——相位尾补单后回写真单号；NOT NULL 恒成立） */
  ticket: string
  status: HrSyncStatus
  attempts: number
  last_error?: string
  payload?: HrSyncPayload
  updated: number
}

export const HrSyncTaskSchema = z.strictObject({
  id: z.string().min(1),
  ts: z.number().int().min(0),
  company: z.string().min(1),
  person_id: z.string().min(1),
  kind: z.string().min(1),
  platform: z.enum(HR_SYNC_PLATFORM_VALUES),
  op_key: z.string().min(1),
  ticket: z.string().min(1),
  status: z.enum(HR_SYNC_STATUS_VALUES),
  attempts: z.number().int().min(0),
  last_error: z.string().min(1).optional(),
  payload: HrSyncPayloadSchema.optional(),
  updated: z.number().int().min(0),
})

// —— v8 todo_queue 投影记录（129-§6.2-R2，studio-dev-167 单B）——形状与校验独立成模
//    （todo-queue-records.ts，records.ts 尺寸阈 600 清偿）；此处转发出口保持导入面不变 ——
export type { TodoQueueRecord } from './todo-queue-records.ts'
export { TodoQueueRecordSchema } from './todo-queue-records.ts'

// —— v2 记录族（v14 `records` 表）契约校验接缝（IMPL-04-06；v2/11 §〇/§一）——
// v0 各表临时闸只为旧表兜底（见文件头注）；v2 记录不另立字段表：信封/族 payload/生效槽一律走 contract 冻结形状（ALL_RECORD_SCHEMAS），写口 hist.ts 只做列映射——本处是 store 侧唯一形状出口。
export {
  ALL_RECORD_SCHEMAS, COMMON_RECORD_TYPES, checkEffectiveSlotConsistency, issuesFromZod,
  type AllRecordType, type EffectiveSlotCarrier, type RecordEnvelope, type RecordValidationIssue,
}

/** v2 记录域（v2/11 §0.9 十三 AREA）：AUTH 族通用骨架八条（contract COMMON 登记）归 AUTH，余取类型第二段 */
export function v2RecordArea(recordType: string): string {
  return (COMMON_RECORD_TYPES as readonly string[]).includes(recordType) ? 'AUTH' : (recordType.split('-')[1] ?? '')
}
