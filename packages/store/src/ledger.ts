/**
 * ledger —— 台账句柄：打开/迁移/事件入账/查询面/公司镜像同步（v0.2 首刀 + 第二刀 + v3 jobs + v4 吸收）
 *
 * 依据：docs/16-§四 v0.2（三表建库 + 快照/重建）、docs/17-§3（数据模型）、
 * docs/02 F2-01（可重建投影，daemon 唯一写入者）、F2-11（JSONL 单向派生）。
 *
 * 纪律落点：
 *   - appendEvent 是 events 的唯一写口：先过 contract validateEventRecord
 *     （台账纯净度第一道闸，非法即 CONFIG_INVALID，不入账）；合法插入，无 UPDATE/DELETE 路径。
 *   - 重复 ULID 的幂等规则（拟稿待批，服务 F2-13 回填幂等）：同 id 且全列一致 → 幂等跳过
 *     （appended:false）；同 id 内容不一致 → 抛错（拒绝静默覆盖语义的重复）。
 *   - tokens 存四桶 JSON 文本，写入前 canonical 序列化（固定桶序）——JSONL 派生逐行字节确定，
 *     支撑 F2-11「每日比对行数+哈希」。
 *
 * 第二刀扩面（v2 五表，17-§3）：
 *   - syncCompany：CompanySnapshot → people / departments 镜像 upsert。镜像=可重建投影，
 *     允许覆盖写——但**只覆盖快照所载字段**（PersonRef 仅 id/name/login/level/dept，
 *     DeptNode 全列所载）：people 的 role/skills/side_effects/capability_tier/executor_pref/
 *     status 归人事流与后续扩展写面，镜像同步不动它们（不清空、不覆盖）。单事务原子：
 *     预校验全部行后整体落库，任一行非法/重复整批拒。personnel_events 不在此写面
 *     （镜像同步≠人事变动：变动必挂单走 appendPersonnelEvent，F2-06）。
 *   - upsertTicketMirror：YouTrack 镜像，last-write-wins（权威源在 YouTrack，本表随时可重建；
 *     v8 起 carry assignee——129-B 按人重导投影所需）。
 *   - replaceTodoQueue / listTodoQueue / recentDispatchWaitsMs（v8，129-§6.2-R2 单B）：
 *     todo_queue 投影全量重投/读面/派发等待观测——可重建投影非事实源，决策永不读表。
 *   - appendBudget / queryBudgets：预算三节点（reserve/settle/refusal）落账与 scope 查询；
 *     listBudgets 全量读面（无 scope 维，since/until 闭区间 + kinds 子集过滤——panel 成本卡
 *     「scope 枚举近似」缺口的库侧清偿，panel 消费接线归后续微单）。
 *   - appendPersonnelEvent：append-only 写口（v2 迁移挂 UPDATE/DELETE 触发器，机制兜底），
 *     同 id 幂等规则对齐 appendEvent（F2-13）。
 *   - personnelTimeline：personnel_events × work_records × sessions 三表按 person_id 归并的
 *     生命周期时间线最小面（C1-04：一页回放「何时入职/干过哪些单/哪次升迁」）。
 *
 * v3 扩面（jobs 调度表，17-§2 / 18-§三）：
 *   - upsertJob / getJob / listJobs / dueJobs / markRan / removeJob：定时岗持久化投影的读写面。
 *   - 热更语义：upsert 按 job_id 覆盖配置列（next_run_at/status 随入参），**不动其他岗、
 *     不清 last_run_at**（运行时状态归 markRan）；cron 只做形状闸，解析归 core 后续单。
 *   - dueJobs：next_run_at <= now 升序（补跑扫描）；markRan：last_run_at/next_run_at 单语句
 *     原子落库。
 *
 * v4 吸收面（daemon 合龙件三债，migrations v4 同批）：
 *   - kvGet / kvSet：daemon_kv 表正式读写面（活动流游标 / tick.seq 的家）。接管关系与切换
 *     路径见 migrations v4 头注——DDL 与读写语句均与 daemon 现行 engine.ts **字节级一致**
 *     （daemon 后续单删自建语句切本面，数据原地续用）；value 允空串（daemon「游标 null」的
 *     持久形态，回读方负责还原 null）。
 *   - endWorkRecord：work_records 收口面（daemon 现行直发 UPDATE 的正式化）——只允许一次
 *     （已 ended 再收=CONFIG_INVALID）；cost_usd/tokens/report_ref/summary_ref 未给值的列
 *     不动（COALESCE 语义，对齐 daemon 现行语句）。tokens 形状取 kernel.TokenCounts，
 *     序列化=JSON.stringify 原序（与 insertWorkRecord 同口径；work_records.tokens 非
 *     events 四桶 canonical 序——两列不同源，F2-04 只冻结 events 侧）。无此行=false
 *     （markRan 同风格，如实上报）。
 *   - queryEvents 增 order:'asc'|'desc'：desc+limit=「最近 N 条」（panel 倒序通道的库侧
 *     落点；panel 消费接线归后续单）。
 *
 * v5 扩面（进化管线 candidates 表，17-§3 / core evolution 首刀 / 02-F3；migrations v5 同批）：
 *   - insertCandidate：幂等登记——同 (asset_path, diff_hash) 且**非终态**命中返回既有 id
 *     不新建（core proposeCandidate 语义的持久层镜像；终态命中放行新建=换代重提）；谱系闸
 *     （父必须在库、挂接不得成环——core 同名闸镜像）；同 id 全列一致幂等跳过 / 不一致拒
 *     （appendEvent 口径，PK 裸错前置分类）。
 *   - getCandidate / candidatesByStatus（判负查 active 集的消费面，枚举外值/空数组拒）/
 *     lineageOf（全祖先链，新→旧，core lineage 同序；断链/成环 fail-closed 如实报——
 *     应用层循环选型见实现注）/ transitionCandidate（乐观锁：WHERE status=期望当前值，
 *     0 行=false——并发同迁恰一次成功；**边合法性归 core 状态机**，库层不复制判定面）。
 *   - daemon 接线（assertChangeAuthorized 消费 active 集、判负面挂主循环/网关写径、闸门
 *     verification 快照落盘一致性校验）归后续刀——本刀只到库面。
 *
 * v5 增补面（进化管线 daemon 侧接线单——e2e 裸 SQL 模拟的正式化）：
 *   - updateVerification：verification 快照行中写面（沙箱完成点落列）。窗口闸 fail-closed
 *     分类：只允许 sandboxed 态写入——证据只进沙箱阶段（F3-02 四元组时序：draft/proposed
 *     未跑沙箱，gated 之后闸门已消费快照，再写=改口供），其他态 → CONFIG_INVALID
 *     （store/candidates:verification-window）；无此行=false（markRan 同风格如实上报）。
 *     序列化与 insertCandidate 同源（serializeVerification 单一口径源，两写面字节一致）；
 *     乐观锁不需要（daemon 单写者），语句级 WHERE status='sandboxed' 防越阶段。
 *
 * v6 扩面（报表三表，17-§3 / docs/50 断链6 / 04-§三；migrations v6 同批）：
 *   - ledgers（单据派生镜像）：upsertLedgerEntry 覆盖写（last-write-wins，可由单据重建——
 *     upsertTicketMirror 同口径；body JSON 序列化闸）+ 双键读面（getLedgerEntry /
 *     listLedgerEntries，kind 枚举闸）。
 *   - reports（报表快照行）：insertReport 自然键 (company,node,type,date) 语义——同键同 id
 *     全列一致幂等跳过 / 同键新 id 覆盖换代（最新快照胜，04-§三 {node}/{date}-{type}
 *     渲染键稳定）/ 同 id 异内容拒（id 全局唯一，appendEvent 口径）+ listReports 读面
 *     （date,id 升序；type 枚举闸）。json_ref=公司目录相对路径（F2-03 结果体分离）。
 *   - probes_runs（探针跑分）：appendProbeRun append-only（触发器拦 UPDATE/DELETE 机制
 *     兜底 + 同 id 幂等规则对齐 appendEvent）+ listProbeRuns 读面（executor/probe_id/
 *     ts 闭区间过滤）。
 *   - 消费接线：报表聚合管线（company 包 reports.ts 月报最小闭环）与 :8789 财务页月报段
 *     读 listReports；daemon 侧定时岗产报落 insertReport 归后续刀接线。
 *
 * v7 扩面（DEV-48，docs/52-§9.2/§11）：hr_sync_log 任务账 + setPersonStatus——读写面与
 * 接口文档收口在 hr-sync-queue.ts（Ledger extends HrSyncQueueFace，方法名恒平）。
 */
import { writeFileSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import {
  configInvalid,
  validateEventRecord,
  type ClassifiedError,
  type CompanySnapshot,
  type EventRecord,
  type ValidationIssue,
} from '@studio-next/contract'
import { openSqlite } from './driver.ts'
import { createHrSyncQueue } from './hr-sync-queue.ts'
import type { HrSyncQueueFace } from './hr-sync-queue.ts'
import { createProbesFace } from './probes.ts'
import type { ProbesFace } from './probes.ts'
import { createPricingFace } from './pricing.ts'
import type { PricingFace } from './pricing.ts'
import { createUsageFace } from './usage.ts'
import type { UsageFace } from './usage.ts'
import { createCostDailyFace } from './cost.ts'
import type { CostDailyFace } from './cost.ts'
import { assertRecord, optNum, optStr, str, type SqlRow } from './row-helpers.ts'
import { currentVersion, migrate } from './migrations.ts'
import {
  BudgetRecordSchema,
  CANDIDATE_STATUS_VALUES,
  CandidateRowSchema,
  DepartmentRecordSchema,
  EndWorkRecordSchema,
  JobRecordSchema,
  LEDGER_KIND_VALUES,
  LedgerEntrySchema,
  PersonRecordSchema,
  PersonnelEventRecordSchema,
  REPORT_TYPE_VALUES,
  ReportRecordSchema,
  SessionRecordSchema,
  TERMINAL_CANDIDATE_STATUS_VALUES,
  TicketMirrorRecordSchema,
  TodoQueueRecordSchema,
  WorkRecordSchema,
  type BudgetRecord,
  type CandidateRow,
  type CandidateStatus,
  type DepartmentRecord,
  type EndWorkRecord,
  type JobRecord,
  type LedgerEntryRecord,
  type LedgerKind,
  type PersonRecord,
  type PersonnelEventRecord,
  type ReportRecord,
  type ReportType,
  type SessionRecord,
  type TicketMirrorRecord,
  type TodoQueueRecord,
  type WorkRecord,
} from './records.ts'

/**
 * events 查询面：全部条件可选，ts 双端闭区间。行序缺省升序（ts, id 稳定序）；
 * order='desc' 时倒序（ts, id 同刻稳定序的镜像反序），与 limit 组合=「最近 N 条」。
 */
export interface EventQuery {
  company?: string
  issue?: string
  /** ts >= since（闭端，epoch ms） */
  since?: number
  /** ts <= until（闭端，epoch ms） */
  until?: number
  limit?: number
  /**
   * 行序（缺省 'asc'）。索引兼容性：company 过滤 + desc 走 idx_events_company_ts
   * (company, ts) 反向扫描（SQLite B-tree 索引双向可走，无新索引需求）；issue 过滤走
   * idx_events_issue 定位后按 (ts,id) 排序；无过滤面全表排序（与 asc 同量级，量大后
   * 再评估独立 ts 索引——拟稿，见 index.ts 疑点清单）。
   */
  order?: 'asc' | 'desc'
}

/** appendEvent 结果：appended=false 表示命中幂等规则（同 id 全列一致的重复入账被跳过） */
export interface AppendResult {
  id: string
  appended: boolean
}

/**
 * insertCandidate 结果：inserted=false 即幂等命中（同 (asset_path,diff_hash) 非终态既有候选
 * ——输入 id 被忽略，返回既有 id；或同 id 全列一致的重复登记），不新建行。
 */
export interface InsertCandidateResult {
  id: string
  inserted: boolean
}

/** dumpEvents 结果：写出行数（与库内 events 计数一致） */
export interface DumpResult {
  lines: number
}

/** syncCompany 结果：本次镜像落库的 people / departments 行数（入参快照的行数，非库内总行数） */
export interface CompanySyncResult {
  people: number
  departments: number
}

/** budgets 查询面：scope 二元组（scope_kind + scope_id 联合定位一个预算主体） */
export interface BudgetScope {
  scope_kind: BudgetRecord['scope_kind']
  scope_id: string
}

/**
 * budgets 全量读面参数（无 scope 维；panel 成本卡「列全部 budgets」缺口的库侧落点）：
 * 全部可选；since/until 对 ts 双端闭区间（对齐 queryEvents 语义）；kinds 为
 * 'reserve'|'settle'|'refusal' 子集过滤（省略或空数组=不过滤；枚举外值 → CONFIG_INVALID）。
 */
export interface BudgetListQuery {
  /** ts >= since（闭端，epoch ms） */
  since?: number
  /** ts <= until（闭端，epoch ms） */
  until?: number
  kinds?: BudgetRecord['kind'][]
}

/**
 * 生命周期时间线条目（C1-04 最小面）：personnel_events 变动 × work_records 工时 × sessions
 * 会话三源按 ts 归并；ts 取各自的自然时间（personnel_events.ts / started_at）。
 */
export type PersonnelTimelineEntry =
  | { source: 'personnel_event'; ts: number; record: PersonnelEventRecord }
  | { source: 'work_record'; ts: number; record: WorkRecord }
  | { source: 'session'; ts: number; record: SessionRecord }

/** 台账句柄：daemon 持有；db 暴露 DatabaseSync 标准面（引擎切换只动 driver.ts） */
export interface Ledger extends HrSyncQueueFace, PricingFace, UsageFace, ProbesFace, CostDailyFace {
  db: DatabaseSync
  close(): void
  /** 当前 schema 版本（schema_version 表 MAX(version)；0=无迁移记录） */
  version(): number
  /** events 唯一写口：先契约校验后插入（append-only） */
  appendEvent(record: unknown): AppendResult
  /** events 查询面（缺省升序；order='desc' 倒序——desc+limit=「最近 N 条」，见 EventQuery） */
  queryEvents(query?: EventQuery): EventRecord[]
  /** events 全量 → JSONL（逐行含 ULID；F2-11 库→JSONL 单向派生） */
  dumpEvents(path: string): DumpResult
  insertWorkRecord(record: unknown): string
  getWorkRecord(id: string): WorkRecord | undefined
  listWorkRecords(query?: { issue?: string }): WorkRecord[]
  insertSession(record: unknown): string
  getSession(sessionId: string): SessionRecord | undefined
  listSessions(query?: { issue?: string }): SessionRecord[]
  /** 公司目录快照 → people / departments 镜像 upsert（单事务原子；只覆盖快照所载字段） */
  syncCompany(snapshot: CompanySnapshot): CompanySyncResult
  listPeople(): PersonRecord[]
  getPerson(personId: string): PersonRecord | undefined
  listDepartments(): DepartmentRecord[]
  /** YouTrack 单据镜像 upsert（last-write-wins，权威源在 YouTrack） */
  upsertTicketMirror(record: unknown): string
  getTicketMirror(issue: string): TicketMirrorRecord | undefined
  listTicketMirrors(): TicketMirrorRecord[]
  /**
   * todo_queue 投影全量重投（129-§6.2-R2，v8）：单事务 DELETE+INSERT 整公司换——
   * 可重建投影非事实源（单写者=daemon 每拍末调，diff 判定归引擎侧）；决策永不读表。
   */
  replaceTodoQueue(company: string, rows: readonly unknown[]): number
  /** todo_queue 读面（company 维；行序 person→first_seen_at→ticket——面板/测试用） */
  listTodoQueue(company?: string): TodoQueueRecord[]
  /**
   * 最近派发等待序列（schedule-to-start 观测面，129-B）：近 N 条 DISPATCH 事件 note
   * `wait=<ms>` 解析（17-§3 note 结构化先例：fp=/budget= 同款）；无 wait 锚的旧事件跳过。
   */
  recentDispatchWaitsMs(company: string, limit: number): number[]
  /** 预算三节点落账（append-only，同 id 幂等规则对齐 appendEvent） */
  appendBudget(record: unknown): AppendResult
  queryBudgets(scope: BudgetScope): BudgetRecord[]
  /**
   * budgets 全量读面（无 scope 维）：全部行 (ts, id) 升序；since/until 双端闭区间；
   * kinds 子集过滤（枚举外值 CONFIG_INVALID）。索引说明：现索引 idx_budgets_scope
   * (scope_kind, scope_id) 只服务 scope 定位，本面全表扫描后排序——量级口径：预算行量=
   * 派发量级（每单 reserve/settle/refusal 各至多数行），可接受；涨量后再评估 ts 索引
   * （拟稿，见 index.ts 疑点清单）。
   */
  listBudgets(query?: BudgetListQuery): BudgetRecord[]
  /** 人事变动事件写口（append-only：触发器机制兜底 + 同 id 幂等规则；必挂单） */
  appendPersonnelEvent(record: unknown): AppendResult
  /** 生命周期时间线：personnel_events × work_records × sessions 三表按 person_id 归并（ts 升序） */
  personnelTimeline(personId: string): PersonnelTimelineEntry[]
  // —— v3 jobs 调度表（17-§2 / 18-§三） ——
  /** 定时岗 upsert（job_id 幂等覆盖配置列；热更单岗不动他岗、不清 last_run_at——见实现注） */
  upsertJob(record: unknown): string
  getJob(jobId: string): JobRecord | undefined
  /** 全部定时岗（next_run_at 升序，同刻按 job_id 稳定序） */
  listJobs(): JobRecord[]
  /** 补跑扫描：next_run_at <= now 的槽位升序（18-§三 启动扫 due 槽位） */
  dueJobs(now: number, limit?: number): JobRecord[]
  /** 记一次实跑：last_run_at/next_run_at 两列同语句原子落库（可观测无中间态） */
  markRan(jobId: string, now: number, nextRunAt: number): boolean
  /** 定时岗下线（公司目录删岗）；返回是否真删了行 */
  removeJob(jobId: string): boolean
  // —— v4 吸收面（daemon 合龙件三债；见文件头注 v4 段） ——
  /** daemon_kv 读：缺键=null；键闸=非空串（拟稿）。接管关系见 migrations v4 头注 */
  kvGet(key: string): string | null
  /** daemon_kv 写（upsert 语义；语句与 daemon 现行 kvSet 字节级一致；value 允空串） */
  kvSet(key: string, value: string): void
  /**
   * work_records 收口面（在途→终态，一次性）：已 ended 再收=CONFIG_INVALID；
   * cost_usd/tokens/report_ref/summary_ref 未给值的列不动（COALESCE 语义）；无此行=false。
   */
  endWorkRecord(id: string, end: EndWorkRecord): boolean
  // —— v5 进化管线 candidates 读写面（17-§3 / core evolution 首刀；daemon 接线归后续刀） ——
  /**
   * 候选登记（幂等，core proposeCandidate 语义的持久层镜像）：同 (asset_path, diff_hash)
   * 且非终态命中 → 返回既有 id 不新建（inserted=false）；终态命中放行新建=换代重提。
   * 形状闸（CandidateRowSchema）/ 谱系闸（父在库 evolve/parent-unknown 同义、挂接不成环
   * lineage-cycle 同义、自引用 self-parent 同义）/ 同 id 全列一致跳过·不一致拒。
   */
  insertCandidate(record: unknown): InsertCandidateResult
  /** 按 id 取候选；无此行=undefined */
  getCandidate(id: string): CandidateRow | undefined
  /**
   * 全祖先链 [自身, 父, 祖父, …, 根]（新→旧，core lineage 同序）；初代=仅 [自身]；
   * 无此行=undefined。fail-closed：断链 → lineage-broken（台账丢数据不静默截断——core
   * 同语义）；链成环 → lineage-cycle（seen 集防死循环）。选型=应用层循环，见实现注。
   */
  lineageOf(id: string): CandidateRow[] | undefined
  /**
   * 按状态集取候选（(created_at, id) 升序）——判负查 active 集的库侧消费面（授权态
   * approved|promoted）。枚举外值 / 空数组 → CONFIG_INVALID（fail-closed，空集=调用方 bug）。
   */
  candidatesByStatus(statuses: readonly CandidateStatus[]): CandidateRow[]
  /**
   * 状态迁移（乐观锁）：UPDATE … WHERE id=? AND status=<期望当前值 from>，0 行=false——
   * 两次并发同迁恰一次成功。**不校验边合法性**：状态机单一事实源在 core transitionCandidate
   * （机器边表 + 闸门/人裁边收口），daemon 先经 core 纯函数判定再落库；store 只保并发安全，
   * 不在库层复制判定面（复制=第二状态机，漂移面）。枚举外 from/to → CONFIG_INVALID。
   */
  transitionCandidate(id: string, from: CandidateStatus, to: CandidateStatus): boolean
  /**
   * verification 快照行中写面（沙箱完成点落列——e2e 裸 SQL 模拟的正式化）：
   * 只允许 sandboxed 态——其他态 → CONFIG_INVALID（store/candidates:verification-window，
   * 证据只进沙箱阶段，F3-02 四元组时序）；序列化与 insertCandidate 同源
   * （serializeVerification 单一口径源）；无此行=false（markRan 同风格如实上报）。
   * 乐观锁不需要（单写者）；语句级 WHERE status='sandboxed' 防越阶段。
   */
  updateVerification(id: string, verification: unknown): boolean
  // —— v6 报表三表读写面（17-§3 / docs/50 断链6 / 04-§三；daemon/报表聚合管线消费） ——
  /**
   * ledgers 单据派生镜像 upsert（复合主键 (issue, kind)，last-write-wins——权威源在单据，
   * 本表可重建，同 upsertTicketMirror 口径）。body 序列化闸：不可 JSON 序列化 →
   * CONFIG_INVALID（同 serializeVerification 风格）。返回落库后的记录形状。
   */
  upsertLedgerEntry(record: unknown): LedgerEntryRecord
  /** 按 (issue, kind) 双键取单据派生行；无此行=undefined */
  getLedgerEntry(issue: string, kind: LedgerKind): LedgerEntryRecord | undefined
  /** 单据派生行列表（updated 升序，同刻按 issue/kind 稳定序）；issue / kind 可选过滤（kind 枚举外值拒） */
  listLedgerEntries(query?: { issue?: string; kind?: LedgerKind }): LedgerEntryRecord[]
  /**
   * reports 报表快照行落库（自然键 (company, node, type, date) 唯一——04-§三渲染约定的
   * 机制化）：同自然键同 id 全列一致 → 幂等跳过（appended=false）；同自然键**新 id** →
   * 覆盖换代（id/caliber/json_ref 随新值，最新快照胜——历史在文件与 REPORT_* 事件）；
   * 同 id 异自然键或同 id 内容不一致 → CONFIG_INVALID（id 全局唯一语义，拒改口供）。
   */
  insertReport(record: unknown): AppendResult
  /** 按 id 取报表行；无此行=undefined */
  getReport(id: string): ReportRecord | undefined
  /** 报表行列表（date, id 升序）；company / node / type 可选过滤（type 枚举外值拒） */
  listReports(query?: { company?: string; node?: string; type?: ReportType }): ReportRecord[]
}

/** tokens 四桶 canonical 序（F2-04 列名序）：同内容恒同字节串 */
const TOKEN_BUCKET_ORDER = ['input', 'output', 'cache_read', 'cache_creation'] as const

function canonicalTokens(tokens: EventRecord['tokens']): string {
  const parts: string[] = []
  for (const key of TOKEN_BUCKET_ORDER) {
    const v = tokens[key]
    if (v !== undefined) parts.push(`"${key}":${v}`)
  }
  return `{${parts.join(',')}}`
}

function parseTokens(json: string): EventRecord['tokens'] {
  const parsed: unknown = JSON.parse(json)
  if (typeof parsed !== 'object' || parsed === null) {
    configInvalid('store/evt:tokens-corrupt', `tokens 列不是 JSON 对象：${json}`)
  }
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === 'number') out[k] = v
  }
  return out as EventRecord['tokens']
}

// —— 行 ↔ 记录映射（events；列集逐列对齐 contract EventRecordSchema 字段名） ——

function rowToEvent(row: SqlRow): EventRecord {
  const rec: EventRecord = {
    id: str(row, 'id'),
    ts: Number(row['ts']),
    company: str(row, 'company'),
    issue: str(row, 'issue'),
    event: str(row, 'event'),
    actor: str(row, 'actor'),
    attempt: Number(row['attempt']),
    level: Number(row['level']),
    dept: str(row, 'dept'),
    tokens: parseTokens(str(row, 'tokens')),
  }
  const correlationId = optStr(row, 'correlation_id')
  if (correlationId !== undefined) rec.correlation_id = correlationId
  const causationId = optStr(row, 'causation_id')
  if (causationId !== undefined) rec.causation_id = causationId
  const costUsd = optNum(row, 'cost_usd')
  if (costUsd !== undefined) rec.cost_usd = costUsd
  const durationMs = optNum(row, 'duration_ms')
  if (durationMs !== undefined) rec.duration_ms = durationMs
  const size = optNum(row, 'size')
  if (size !== undefined) rec.size = size
  const payloadHash = optStr(row, 'payload_hash')
  if (payloadHash !== undefined) rec.payload_hash = payloadHash
  const note = optStr(row, 'note')
  if (note !== undefined) rec.note = note
  return rec
}

const INSERT_EVENT_SQL = `INSERT INTO events (
  id, ts, company, issue, event, actor, attempt, level, dept,
  correlation_id, causation_id, tokens, cost_usd, duration_ms, size, payload_hash, note
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

// —— v4 daemon_kv 读写语句（与 daemon 现行 engine.ts 的 kvGetStmt/kvSetStmt 逐字一致——字节级兼容；
//     DDL 见 migrations v4：接管期间 daemon 自建语句与本面共存，同表同语义） ——

const KV_GET_SQL = 'SELECT value FROM daemon_kv WHERE key = ?'
const KV_SET_SQL =
  'INSERT INTO daemon_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'

/** kv 键闸（拟稿）：非空字符串——空键=调用方 bug，拒收；value 不设闸（空串=daemon「游标 null」持久形态） */
function assertKvKey(key: string): void {
  if (typeof key !== 'string' || key === '') {
    configInvalid('store/kv:bad-key', 'kv 键须为非空字符串')
  }
}

/** 入账前契约闸：非法 record → ClassifiedError(CONFIG_INVALID)（拒非法入账，第一道闸） */
function assertValidEvent(record: unknown): asserts record is EventRecord {
  const outcome = validateEventRecord(record)
  if (!outcome.ok) {
    const first = outcome.issues[0] as ValidationIssue | undefined
    const path = first === undefined ? '(root)' : first.path
    const brief = outcome.issues
      .slice(0, 3)
      .map((i) => `${i.path}: ${i.message}`)
      .join('；')
    configInvalid(`evt/invalid:${path}`, brief)
  }
}

/**
 * canonical JSON（递归按键排序，丢弃 undefined 值）：记录级内容比对用——键序无关，
 * 同内容恒同字节串。events 走 sameEvent 手工全列比对（v1 既有面），五张新表的
 * 同 id 幂等规则走本比对（canonicalJson(rowToX(existing)) === canonicalJson(parsed)）。
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>
    const parts: string[] = []
    for (const key of Object.keys(obj).sort()) {
      if (obj[key] === undefined) continue
      parts.push(`${JSON.stringify(key)}:${canonicalJson(obj[key])}`)
    }
    return `{${parts.join(',')}}`
  }
  return JSON.stringify(value)
}

/** JSON 字符串数组列（skills / functions / lanes）解析：坏列 → CONFIG_INVALID（库已坏，如实报） */
function parseJsonArray(raw: string, subcause: string): string[] {
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === 'string')) {
    configInvalid(subcause, `列不是 JSON 字符串数组：${raw}`)
  }
  return parsed as string[]
}

/** 任意 JSON 值列（jobs.payload）解析：坏列 → CONFIG_INVALID（库已坏，如实报） */
function parseJsonValue(raw: string, subcause: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch (err) {
    configInvalid(subcause, `payload 列不是合法 JSON：${raw}（${errorMessage(err)}）`)
  }
}

/**
 * verification 列序列化（**单一口径源**：insertCandidate 与 updateVerification 共用——
 * 两写面落列字节同源，读面 deep-equal 往返的机制保证）。归一：undefined≡null
 * （core 形状是 GateEvidence|null；zod unknown 收 JS 缺键形态）；不可 JSON 化的值
 * 拒收不静默（同 jobs.payload 口径：stringify 抛错或返 undefined 均拒）。
 * 返回列值（null=未跑沙箱）。
 */
function serializeVerification(verification: unknown, candidateId: string): string | null {
  if (verification === undefined || verification === null) return null
  try {
    const serialized = JSON.stringify(verification)
    if (serialized === undefined) {
      configInvalid('store/candidates:verification-unserializable', `候选 ${candidateId} verification 含不可 JSON 序列化的值`)
    }
    return serialized
  } catch (err) {
    configInvalid('store/candidates:verification-unserializable', `候选 ${candidateId} verification 不是可序列化 JSON 值：${errorMessage(err)}`)
  }
}

/** 错误消息文本化（内联用；与 rebuild.ts 同风格） */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** zod schema 的结构面（免 import zod 类型；safeParse 结果形状即可） */
/** 打开（或创建）台账库：建库 → PRAGMA 对齐 → migrate()（幂等）→ 返回句柄 */
export function openLedger(path: string): Ledger {
  const db = openSqlite(path)
  migrate(db)

  const appendEvent = (record: unknown): AppendResult => {
    assertValidEvent(record)
    // 幂等规则：同 id 已存在 → 全列一致跳过，不一致抛错（F2-13 回填幂等；拟稿待批）
    const existing = db
      .prepare('SELECT * FROM events WHERE id = ?')
      .get(record.id) as SqlRow | undefined
    if (existing !== undefined) {
      const same = rowToEvent(existing)
      if (sameEvent(same, record)) return { id: record.id, appended: false }
      configInvalid(
        'store/evt:duplicate-id',
        `事件 id=${record.id} 已存在且内容不一致（append-only，拒绝覆盖语义的重复入账）`,
      )
    }
    db.prepare(INSERT_EVENT_SQL).run(
      record.id,
      record.ts,
      record.company,
      record.issue,
      record.event,
      record.actor,
      record.attempt,
      record.level,
      record.dept,
      record.correlation_id ?? null,
      record.causation_id ?? null,
      canonicalTokens(record.tokens),
      record.cost_usd ?? null,
      record.duration_ms ?? null,
      record.size ?? null,
      record.payload_hash ?? null,
      record.note ?? null,
    )
    return { id: record.id, appended: true }
  }

  const queryEvents = (query: EventQuery = {}): EventRecord[] => {
    // order 白名单闸：方向内插进 SQL（无法参数化绑定），非 'asc'|'desc' 即 CONFIG_INVALID——
    // TS 字面量类型挡编译期，运行期（JS 调用方/配置驱动）仍须如实拒
    if (query.order !== undefined && query.order !== 'asc' && query.order !== 'desc') {
      configInvalid('store/evt:bad-order', `order=${String(query.order)} 须为 'asc' | 'desc'`)
    }
    const dir = query.order === 'desc' ? 'DESC' : 'ASC'
    const where: string[] = []
    const params: Array<string | number> = []
    if (query.company !== undefined) {
      where.push('company = ?')
      params.push(query.company)
    }
    if (query.issue !== undefined) {
      where.push('issue = ?')
      params.push(query.issue)
    }
    if (query.since !== undefined) {
      where.push('ts >= ?')
      params.push(query.since)
    }
    if (query.until !== undefined) {
      where.push('ts <= ?')
      params.push(query.until)
    }
    let sql = 'SELECT * FROM events'
    if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`
    // desc 是 asc 的镜像反序（ts,id 双列同向取反）——同集两序互为 reverse，desc+limit=最近 N 条
    sql += ` ORDER BY ts ${dir}, id ${dir}`
    if (query.limit !== undefined) {
      sql += ' LIMIT ?'
      params.push(query.limit)
    }
    const rows = db.prepare(sql).all(...params) as SqlRow[]
    return rows.map(rowToEvent)
  }

  const dumpEvents = (path: string): DumpResult => {
    const rows = db.prepare('SELECT * FROM events ORDER BY ts ASC, id ASC').all() as SqlRow[]
    // 同步写（daemon 单写入者，无并发写面）；行序 = ts,id 升序，行字节由 canonical 序列化保证确定
    writeFileSync(path, rows.map((row) => JSON.stringify(rowToEvent(row))).join('\n') + (rows.length > 0 ? '\n' : ''), 'utf8')
    return { lines: rows.length }
  }

  const insertWorkRecord = (record: unknown): string => {
    const parsed = WorkRecordSchema.safeParse(record)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      const path = first === undefined ? '(root)' : first.path.map(String).join('.')
      configInvalid(`store/work-record:invalid:${path}`, first === undefined ? undefined : `${path}: ${first.message}`)
    }
    const r = parsed.data
    db.prepare(
      `INSERT INTO work_records (
        id, issue, person_id, instance_id, executor, session_id, lane, branch,
        started_at, ended_at, cost_usd, tokens, attempt, status, report_ref, summary_ref, model
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      r.id,
      r.issue,
      r.person_id,
      r.instance_id ?? null,
      r.executor,
      r.session_id ?? null,
      r.lane ?? null,
      r.branch ?? null,
      r.started_at,
      r.ended_at ?? null,
      r.cost_usd ?? null,
      r.tokens === undefined ? null : JSON.stringify(r.tokens),
      r.attempt,
      r.status,
      r.report_ref ?? null,
      r.summary_ref ?? null,
      r.model ?? null,
    )
    return r.id
  }

  const rowToWorkRecord = (row: SqlRow): WorkRecord => {
    const rec: WorkRecord = {
      id: str(row, 'id'),
      issue: str(row, 'issue'),
      person_id: str(row, 'person_id'),
      executor: str(row, 'executor'),
      started_at: Number(row['started_at']),
      attempt: Number(row['attempt']),
      status: str(row, 'status'),
    }
    const instanceId = optStr(row, 'instance_id')
    if (instanceId !== undefined) rec.instance_id = instanceId
    const sessionId = optStr(row, 'session_id')
    if (sessionId !== undefined) rec.session_id = sessionId
    const lane = optStr(row, 'lane')
    if (lane !== undefined) rec.lane = lane
    const branch = optStr(row, 'branch')
    if (branch !== undefined) rec.branch = branch
    const endedAt = optNum(row, 'ended_at')
    if (endedAt !== undefined) rec.ended_at = endedAt
    const costUsd = optNum(row, 'cost_usd')
    if (costUsd !== undefined) rec.cost_usd = costUsd
    const tokensJson = optStr(row, 'tokens')
    if (tokensJson !== undefined) rec.tokens = JSON.parse(tokensJson) as NonNullable<WorkRecord['tokens']>
    const reportRef = optStr(row, 'report_ref')
    if (reportRef !== undefined) rec.report_ref = reportRef
    const summaryRef = optStr(row, 'summary_ref')
    if (summaryRef !== undefined) rec.summary_ref = summaryRef
    // model（132-§6.1 单A·migration v8 尾列）：NULL=无从可知（旧执行），tokens 旧形
    // `cached` 键原样往返——读侧兼容（cache_read ?? cached）归消费方，本层不改写键
    const model = optStr(row, 'model')
    if (model !== undefined) rec.model = model
    return rec
  }

  const listWorkRecords = (query: { issue?: string } = {}): WorkRecord[] => {
    const rows =
      query.issue === undefined
        ? (db.prepare('SELECT * FROM work_records ORDER BY started_at ASC, id ASC').all() as SqlRow[])
        : (db
            .prepare('SELECT * FROM work_records WHERE issue = ? ORDER BY started_at ASC, id ASC')
            .all(query.issue) as SqlRow[])
    return rows.map(rowToWorkRecord)
  }

  const insertSession = (record: unknown): string => {
    const parsed = SessionRecordSchema.safeParse(record)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      const path = first === undefined ? '(root)' : first.path.map(String).join('.')
      configInvalid(`store/session:invalid:${path}`, first === undefined ? undefined : `${path}: ${first.message}`)
    }
    const r = parsed.data
    db.prepare(
      'INSERT INTO sessions (session_id, issue, person_id, archive_path, started_at, ended_at, turns) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(r.session_id, r.issue, r.person_id, r.archive_path ?? null, r.started_at, r.ended_at ?? null, r.turns ?? null)
    return r.session_id
  }

  const rowToSession = (row: SqlRow): SessionRecord => {
    const rec: SessionRecord = {
      session_id: str(row, 'session_id'),
      issue: str(row, 'issue'),
      person_id: str(row, 'person_id'),
      started_at: Number(row['started_at']),
    }
    const archivePath = optStr(row, 'archive_path')
    if (archivePath !== undefined) rec.archive_path = archivePath
    const endedAt = optNum(row, 'ended_at')
    if (endedAt !== undefined) rec.ended_at = endedAt
    const turns = optNum(row, 'turns')
    if (turns !== undefined) rec.turns = turns
    return rec
  }

  const listSessions = (query: { issue?: string } = {}): SessionRecord[] => {
    const rows =
      query.issue === undefined
        ? (db.prepare('SELECT * FROM sessions ORDER BY started_at ASC, session_id ASC').all() as SqlRow[])
        : (db
            .prepare('SELECT * FROM sessions WHERE issue = ? ORDER BY started_at ASC, session_id ASC')
            .all(query.issue) as SqlRow[])
    return rows.map(rowToSession)
  }

  // —— v2 五表读写面（17-§3） ——

  const rowToPerson = (row: SqlRow): PersonRecord => {
    const rec: PersonRecord = {
      person_id: str(row, 'person_id'),
      name: str(row, 'name'),
      login: str(row, 'login'),
      level: Number(row['level']),
      dept: str(row, 'dept'),
    }
    const role = optStr(row, 'role')
    if (role !== undefined) rec.role = role
    const skills = optStr(row, 'skills')
    if (skills !== undefined) rec.skills = parseJsonArray(skills, 'store/people:skills-corrupt')
    const sideEffects = optStr(row, 'side_effects')
    if (sideEffects !== undefined) rec.side_effects = parseJsonArray(sideEffects, 'store/people:side-effects-corrupt')
    const tier = optNum(row, 'capability_tier')
    if (tier !== undefined) rec.capability_tier = tier
    const executorPref = optStr(row, 'executor_pref')
    if (executorPref !== undefined) rec.executor_pref = executorPref
    const status = optStr(row, 'status')
    if (status !== undefined) rec.status = status
    return rec
  }

  const rowToPersonnelEvent = (row: SqlRow): PersonnelEventRecord => {
    const rec: PersonnelEventRecord = {
      id: str(row, 'id'),
      ts: Number(row['ts']),
      person_id: str(row, 'person_id'),
      type: str(row, 'type'),
      ticket: str(row, 'ticket'),
      approver: str(row, 'approver'),
    }
    const prev = optStr(row, 'prev')
    if (prev !== undefined) rec.prev = prev
    const next = optStr(row, 'next')
    if (next !== undefined) rec.next = next
    return rec
  }

  const rowToDepartment = (row: SqlRow): DepartmentRecord => {
    const rec: DepartmentRecord = {
      path: str(row, 'path'),
      company: str(row, 'company'),
      leader: str(row, 'leader'),
      functions: parseJsonArray(str(row, 'functions'), 'store/departments:functions-corrupt'),
      lanes: parseJsonArray(str(row, 'lanes'), 'store/departments:lanes-corrupt'),
    }
    const parentPath = optStr(row, 'parent_path')
    if (parentPath !== undefined) rec.parent_path = parentPath
    return rec
  }

  const rowToTicketMirror = (row: SqlRow): TicketMirrorRecord => {
    const rec: TicketMirrorRecord = {
      issue: str(row, 'issue'),
      company: str(row, 'company'),
      created: Number(row['created']),
      updated: Number(row['updated']),
      state: str(row, 'state'),
      type: str(row, 'type'),
      dept: str(row, 'dept'),
      level: Number(row['level']),
      dispatcher: str(row, 'dispatcher'),
    }
    const parent = optStr(row, 'parent')
    if (parent !== undefined) rec.parent = parent
    const lane = optStr(row, 'lane')
    if (lane !== undefined) rec.lane = lane
    const assignee = optStr(row, 'assignee')
    if (assignee !== undefined) rec.assignee = assignee
    return rec
  }

  const rowToTodoQueue = (row: SqlRow): TodoQueueRecord => {
    const rec: TodoQueueRecord = {
      company: str(row, 'company'),
      ticket: str(row, 'ticket'),
      person: str(row, 'person'),
      priority: Number(row['priority']),
      pinned: Number(row['pinned']),
      boost_tier: Number(row['boost_tier']),
      first_seen_at: Number(row['first_seen_at']),
      ready_state: str(row, 'ready_state') === 'awaiting_approval' ? 'awaiting_approval' : 'ready',
      updated_at: Number(row['updated_at']),
    }
    const lastBoost = optNum(row, 'last_boost_at')
    if (lastBoost !== undefined) rec.last_boost_at = lastBoost
    const why = optStr(row, 'why')
    if (why !== undefined) rec.why = why
    return rec
  }

  const rowToBudget = (row: SqlRow): BudgetRecord => {
    const rec: BudgetRecord = {
      id: str(row, 'id'),
      scope_kind: str(row, 'scope_kind') as BudgetRecord['scope_kind'],
      scope_id: str(row, 'scope_id'),
      kind: str(row, 'kind') as BudgetRecord['kind'],
      ts: Number(row['ts']),
    }
    const estimated = optNum(row, 'estimated_usd')
    if (estimated !== undefined) rec.estimated_usd = estimated
    const actual = optNum(row, 'actual_usd')
    if (actual !== undefined) rec.actual_usd = actual
    return rec
  }

  /**
   * 公司目录快照 → people / departments 镜像 upsert（单事务原子）。
   * 只覆盖快照所载字段（PersonRef 五字段 / DeptNode 全列）；people 扩展列（role/skills/
   * side_effects/capability_tier/executor_pref/status）归人事流与后续写面，此处不清空不覆盖。
   * 镜像收敛（目录已删的人/部门是否剔除）v0 不做——退/停走 personnel_events 流程，直接删行
   * 丢状态语义（拟稿待批，见 index.ts TODO）。
   */
  const syncCompany = (snapshot: CompanySnapshot): CompanySyncResult => {
    // 预校验 + 快照内查重（任一行非法/重复 → 整批拒，不开写事务）
    const peopleRows: PersonRecord[] = []
    const seenPeople = new Set<string>()
    for (const p of snapshot.people) {
      const row: PersonRecord = { person_id: p.id, name: p.name, login: p.login, level: p.level, dept: p.dept }
      assertRecord(PersonRecordSchema, row, 'store/people:invalid')
      if (seenPeople.has(row.person_id)) {
        configInvalid('store/people:duplicate', `快照内 person_id 重复：${row.person_id}`)
      }
      seenPeople.add(row.person_id)
      peopleRows.push(row)
    }
    const deptRows: DepartmentRecord[] = []
    const seenDepts = new Set<string>()
    for (const d of snapshot.departments) {
      const row: DepartmentRecord = {
        path: d.path,
        company: snapshot.slug,
        leader: d.leader,
        functions: [...d.functions],
        lanes: [...d.lanes],
      }
      if (d.parent !== null) row.parent_path = d.parent
      assertRecord(DepartmentRecordSchema, row, 'store/departments:invalid')
      if (seenDepts.has(row.path)) {
        configInvalid('store/departments:duplicate', `快照内部门 path 重复：${row.path}`)
      }
      seenDepts.add(row.path)
      deptRows.push(row)
    }
    db.exec('BEGIN')
    try {
      const upsertPerson = db.prepare(
        `INSERT INTO people (person_id, name, login, level, dept) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(person_id) DO UPDATE SET
           name = excluded.name, login = excluded.login, level = excluded.level, dept = excluded.dept`,
      )
      for (const r of peopleRows) upsertPerson.run(r.person_id, r.name, r.login, r.level, r.dept)
      const upsertDept = db.prepare(
        `INSERT INTO departments (path, company, leader, functions, lanes, parent_path) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           company = excluded.company, leader = excluded.leader,
           functions = excluded.functions, lanes = excluded.lanes, parent_path = excluded.parent_path`,
      )
      for (const r of deptRows) {
        upsertDept.run(r.path, r.company, r.leader, JSON.stringify(r.functions), JSON.stringify(r.lanes), r.parent_path ?? null)
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    return { people: peopleRows.length, departments: deptRows.length }
  }

  const listPeople = (): PersonRecord[] =>
    (db.prepare('SELECT * FROM people ORDER BY person_id ASC').all() as SqlRow[]).map(rowToPerson)

  const listDepartments = (): DepartmentRecord[] =>
    (db.prepare('SELECT * FROM departments ORDER BY path ASC').all() as SqlRow[]).map(rowToDepartment)

  const upsertTicketMirror = (record: unknown): string => {
    const r = assertRecord(TicketMirrorRecordSchema, record, 'store/ticket-mirror:invalid')
    db.prepare(
      `INSERT INTO ticket_mirror (
         issue, company, created, updated, state, type, dept, level, dispatcher, parent, lane, assignee
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(issue) DO UPDATE SET
         company = excluded.company, created = excluded.created, updated = excluded.updated,
         state = excluded.state, type = excluded.type, dept = excluded.dept, level = excluded.level,
         dispatcher = excluded.dispatcher, parent = excluded.parent, lane = excluded.lane,
         assignee = excluded.assignee`,
    ).run(
      r.issue,
      r.company,
      r.created,
      r.updated,
      r.state,
      r.type,
      r.dept,
      r.level,
      r.dispatcher,
      r.parent ?? null,
      r.lane ?? null,
      r.assignee ?? null,
    )
    return r.issue
  }

  const getTicketMirror = (issue: string): TicketMirrorRecord | undefined => {
    const row = db.prepare('SELECT * FROM ticket_mirror WHERE issue = ?').get(issue) as SqlRow | undefined
    return row === undefined ? undefined : rowToTicketMirror(row)
  }

  const listTicketMirrors = (): TicketMirrorRecord[] =>
    (db.prepare('SELECT * FROM ticket_mirror ORDER BY updated ASC, issue ASC').all() as SqlRow[]).map(rowToTicketMirror)

  // —— v8 todo_queue 投影读写面（129-§6.2-R2，studio-dev-167 单B） ——

  const insertTodoQueue = db.prepare(
    `INSERT INTO todo_queue (
       company, ticket, person, priority, pinned, boost_tier, first_seen_at, last_boost_at, ready_state, why, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  const replaceTodoQueue = (company: string, rows: readonly unknown[]): number => {
    const parsed = rows.map((row) => {
      const r = assertRecord(TodoQueueRecordSchema, row, 'store/todo-queue:invalid')
      if (r.company !== company) {
        configInvalid('store/todo-queue:company-mismatch', `行 company=${r.company} 与重投目标 company=${company} 不一致（整换按公司维，拒跨维写入）`)
      }
      return r
    })
    db.exec('BEGIN')
    try {
      db.prepare('DELETE FROM todo_queue WHERE company = ?').run(company)
      for (const r of parsed) {
        insertTodoQueue.run(
          r.company,
          r.ticket,
          r.person,
          r.priority,
          r.pinned,
          r.boost_tier,
          r.first_seen_at,
          r.last_boost_at ?? null,
          r.ready_state,
          r.why ?? null,
          r.updated_at,
        )
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    return parsed.length
  }

  const listTodoQueue = (company?: string): TodoQueueRecord[] => {
    const rows =
      company === undefined
        ? (db.prepare('SELECT * FROM todo_queue ORDER BY company ASC, person ASC, first_seen_at ASC, ticket ASC').all() as SqlRow[])
        : (db
            .prepare('SELECT * FROM todo_queue WHERE company = ? ORDER BY person ASC, first_seen_at ASC, ticket ASC')
            .all(company) as SqlRow[])
    return rows.map(rowToTodoQueue)
  }

  /** DISPATCH note wait 锚解析（`;wait=123` 尾缀段——17-§3 note 结构化先例；无锚跳过） */
  const dispatchWaitOfNote = (note: string | undefined): number | undefined => {
    if (note === undefined) return undefined
    const m = /(?:^|[; ])wait=(\d+)/.exec(note)
    return m === null ? undefined : Number(m[1])
  }

  const recentDispatchWaitsMs = (company: string, limit: number): number[] => {
    const rows = db
      .prepare('SELECT note FROM events WHERE company = ? AND event = ? ORDER BY ts DESC, id DESC LIMIT ?')
      .all(company, 'DISPATCH', limit) as Array<{ note: unknown }>
    const waits: number[] = []
    for (const row of rows) {
      const note = typeof row['note'] === 'string' ? row['note'] : undefined
      const wait = dispatchWaitOfNote(note)
      if (wait !== undefined) waits.push(wait)
    }
    return waits
  }

  const appendBudget = (record: unknown): AppendResult => {
    const r = assertRecord(BudgetRecordSchema, record, 'store/budget:invalid')
    // 幂等规则对齐 appendEvent：同 id 全列一致跳过，不一致抛错（F2-13 回填幂等）
    const existing = db.prepare('SELECT * FROM budgets WHERE id = ?').get(r.id) as SqlRow | undefined
    if (existing !== undefined) {
      if (canonicalJson(rowToBudget(existing)) === canonicalJson(r)) return { id: r.id, appended: false }
      configInvalid('store/budget:duplicate-id', `预算账 id=${r.id} 已存在且内容不一致（拒绝覆盖语义的重复入账）`)
    }
    db.prepare(
      'INSERT INTO budgets (id, scope_kind, scope_id, kind, estimated_usd, actual_usd, ts) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(r.id, r.scope_kind, r.scope_id, r.kind, r.estimated_usd ?? null, r.actual_usd ?? null, r.ts)
    return { id: r.id, appended: true }
  }

  const queryBudgets = (scope: BudgetScope): BudgetRecord[] =>
    (
      db
        .prepare('SELECT * FROM budgets WHERE scope_kind = ? AND scope_id = ? ORDER BY ts ASC, id ASC')
        .all(scope.scope_kind, scope.scope_id) as SqlRow[]
    ).map(rowToBudget)

  /** kinds 白名单（运行期闸：TS 字面量类型挡编译期，JS 调用方/配置驱动仍须如实拒——对齐 queryEvents order 闸） */
  const isBudgetKind = (v: unknown): v is BudgetRecord['kind'] =>
    v === 'reserve' || v === 'settle' || v === 'refusal'

  const listBudgets = (query: BudgetListQuery = {}): BudgetRecord[] => {
    if (query.kinds !== undefined) {
      const bad = query.kinds.find((k) => !isBudgetKind(k))
      if (bad !== undefined) {
        configInvalid('store/budget:bad-kind', `kinds 含枚举外值：${String(bad)}（须为 'reserve'|'settle'|'refusal' 子集）`)
      }
    }
    const where: string[] = []
    const params: Array<string | number> = []
    if (query.since !== undefined) {
      where.push('ts >= ?')
      params.push(query.since)
    }
    if (query.until !== undefined) {
      where.push('ts <= ?')
      params.push(query.until)
    }
    if (query.kinds !== undefined && query.kinds.length > 0) {
      // kinds 占位符逐个参数化绑定（无内插面）；空数组=不过滤（见 BudgetListQuery 行注）
      where.push(`kind IN (${query.kinds.map(() => '?').join(', ')})`)
      params.push(...query.kinds)
    }
    let sql = 'SELECT * FROM budgets'
    if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`
    sql += ' ORDER BY ts ASC, id ASC'
    const rows = db.prepare(sql).all(...params) as SqlRow[]
    return rows.map(rowToBudget)
  }

  const appendPersonnelEvent = (record: unknown): AppendResult => {
    const r = assertRecord(PersonnelEventRecordSchema, record, 'store/personnel-event:invalid')
    // 幂等规则对齐 appendEvent：同 id 全列一致跳过，不一致抛错（append-only + F2-13 回填幂等；
    // UPDATE/DELETE 另有 v2 迁移触发器机制兜底）
    const existing = db.prepare('SELECT * FROM personnel_events WHERE id = ?').get(r.id) as SqlRow | undefined
    if (existing !== undefined) {
      if (canonicalJson(rowToPersonnelEvent(existing)) === canonicalJson(r)) return { id: r.id, appended: false }
      configInvalid(
        'store/personnel-event:duplicate-id',
        `人事事件 id=${r.id} 已存在且内容不一致（append-only，拒绝覆盖语义的重复入账）`,
      )
    }
    db.prepare(
      'INSERT INTO personnel_events (id, ts, person_id, type, prev, next, ticket, approver) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(r.id, r.ts, r.person_id, r.type, r.prev ?? null, r.next ?? null, r.ticket, r.approver)
    return { id: r.id, appended: true }
  }

  /** 同 ts 稳定序：personnel_event → work_record → session，再按各自 id */
  const TIMELINE_SOURCE_RANK = { personnel_event: 0, work_record: 1, session: 2 } as const

  function timelineTieId(entry: PersonnelTimelineEntry): string {
    if (entry.source === 'session') return entry.record.session_id
    return entry.record.id
  }

  const personnelTimeline = (personId: string): PersonnelTimelineEntry[] => {
    const entries: PersonnelTimelineEntry[] = []
    for (const r of (db.prepare('SELECT * FROM personnel_events WHERE person_id = ?').all(personId) as SqlRow[]).map(rowToPersonnelEvent)) {
      entries.push({ source: 'personnel_event', ts: r.ts, record: r })
    }
    for (const r of (db.prepare('SELECT * FROM work_records WHERE person_id = ?').all(personId) as SqlRow[]).map(rowToWorkRecord)) {
      entries.push({ source: 'work_record', ts: r.started_at, record: r })
    }
    for (const r of (db.prepare('SELECT * FROM sessions WHERE person_id = ?').all(personId) as SqlRow[]).map(rowToSession)) {
      entries.push({ source: 'session', ts: r.started_at, record: r })
    }
    entries.sort(
      (a, b) => a.ts - b.ts || TIMELINE_SOURCE_RANK[a.source] - TIMELINE_SOURCE_RANK[b.source] || timelineTieId(a).localeCompare(timelineTieId(b)),
    )
    return entries
  }

  // —— v3 jobs 调度表读写面（17-§2 / 18-§三） ——

  const rowToJob = (row: SqlRow): JobRecord => {
    const rec: JobRecord = {
      job_id: str(row, 'job_id'),
      company: str(row, 'company'),
      dept: str(row, 'dept'),
      cron: str(row, 'cron'),
      role: str(row, 'role'),
      level: Number(row['level']),
      model_tier: str(row, 'model_tier') as JobRecord['model_tier'],
      next_run_at: Number(row['next_run_at']),
    }
    const budgetCap = optNum(row, 'budget_cap')
    if (budgetCap !== undefined) rec.budget_cap = budgetCap
    const payloadJson = optStr(row, 'payload')
    if (payloadJson !== undefined) rec.payload = parseJsonValue(payloadJson, 'store/jobs:payload-corrupt')
    const lastRunAt = optNum(row, 'last_run_at')
    if (lastRunAt !== undefined) rec.last_run_at = lastRunAt
    const status = optStr(row, 'status')
    if (status !== undefined) rec.status = status
    return rec
  }

  /**
   * 定时岗 upsert：job_id 幂等覆盖——同 job_id 重复 upsert 不报错不涨行，整行按本次所载覆盖。
   * 热更语义（18-§三「重注册对应 job，不动其他岗」）落点：
   *   - ON CONFLICT 更新列集 = 配置列 + next_run_at + status（公司目录所载与调度计算所得）；
   *   - **last_run_at 不在更新列**——它是调度器运行时状态（markRan 落账），公司目录重挂载/热更
   *     不应清零跑史（拟稿待批，见 index.ts 疑点清单）。
   */
  const upsertJob = (record: unknown): string => {
    const r = assertRecord(JobRecordSchema, record, 'store/jobs:invalid')
    let payloadJson: string | null = null
    if (r.payload !== undefined) {
      try {
        const serialized = JSON.stringify(r.payload)
        // undefined 返回值 = 函数/Symbol 等不可 JSON 化的值（stringify 不抛但静默丢）——拒收不静默
        if (serialized === undefined) {
          configInvalid('store/jobs:payload-unserializable', `job ${r.job_id} payload 含不可 JSON 序列化的值`)
        }
        payloadJson = serialized
      } catch (err) {
        configInvalid('store/jobs:payload-unserializable', `job ${r.job_id} payload 不是可序列化 JSON 值：${errorMessage(err)}`)
      }
    }
    db.prepare(
      `INSERT INTO jobs (
         job_id, company, dept, cron, role, level, model_tier, budget_cap, payload, next_run_at, last_run_at, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(job_id) DO UPDATE SET
         company = excluded.company, dept = excluded.dept, cron = excluded.cron, role = excluded.role,
         level = excluded.level, model_tier = excluded.model_tier, budget_cap = excluded.budget_cap,
         payload = excluded.payload, next_run_at = excluded.next_run_at, status = excluded.status`,
    ).run(
      r.job_id,
      r.company,
      r.dept,
      r.cron,
      r.role,
      r.level,
      r.model_tier,
      r.budget_cap ?? null,
      payloadJson,
      r.next_run_at,
      r.last_run_at ?? null,
      r.status ?? null,
    )
    return r.job_id
  }

  const getJob = (jobId: string): JobRecord | undefined => {
    const row = db.prepare('SELECT * FROM jobs WHERE job_id = ?').get(jobId) as SqlRow | undefined
    return row === undefined ? undefined : rowToJob(row)
  }

  const listJobs = (): JobRecord[] =>
    (db.prepare('SELECT * FROM jobs ORDER BY next_run_at ASC, job_id ASC').all() as SqlRow[]).map(rowToJob)

  const dueJobs = (now: number, limit?: number): JobRecord[] => {
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
      configInvalid('store/jobs:bad-limit', `limit=${String(limit)} 须为非负整数`)
    }
    const sql =
      'SELECT * FROM jobs WHERE next_run_at <= ? ORDER BY next_run_at ASC, job_id ASC' +
      (limit === undefined ? '' : ' LIMIT ?')
    const rows = limit === undefined
      ? (db.prepare(sql).all(now) as SqlRow[])
      : (db.prepare(sql).all(now, limit) as SqlRow[])
    return rows.map(rowToJob)
  }

  /** 单条 UPDATE 即单事务：两列同语句移动，无中间态可观测（18-§三 补跑记账的原子基础） */
  const markRan = (jobId: string, now: number, nextRunAt: number): boolean => {
    const result = db.prepare('UPDATE jobs SET last_run_at = ?, next_run_at = ? WHERE job_id = ?').run(now, nextRunAt, jobId)
    return Number(result.changes) > 0
  }

  const removeJob = (jobId: string): boolean => {
    const result = db.prepare('DELETE FROM jobs WHERE job_id = ?').run(jobId)
    return Number(result.changes) > 0
  }

  // —— v4 吸收面实现（daemon 合龙件三债；接口行注与文件头注 v4 段为语义依据） ——

  const kvGet = (key: string): string | null => {
    assertKvKey(key)
    const row = db.prepare(KV_GET_SQL).get(key) as { value: string } | undefined
    return row === undefined ? null : row.value
  }

  const kvSet = (key: string, value: string): void => {
    assertKvKey(key)
    db.prepare(KV_SET_SQL).run(key, value)
  }

  /**
   * work_records 收口面（一次性）：先读后写防重——已 ended（ended_at 非空）再收=CONFIG_INVALID
   * （收口=终态迁移，重复收口意味着调用方状态机错乱，如实拒）；可选列未给值走 COALESCE 不动
   * 既有值（对齐 daemon 切换前 closeWorkRecord 语句——tokens 列位亦同，居 cost_usd 与
   * report_ref 之间）。tokens 序列化=JSON.stringify 原序（与 insertWorkRecord 同口径——
   * work_records.tokens 非 events 四桶 canonical 序，两列不同源，F2-04 只冻结 events 侧）。
   * model（132-§6.1 单A·studio-dev-168）：收割 ResultStats.model 直落，同 COALESCE 口径。
   * 单条 UPDATE 即单事务，无中间态可观测。无此行=false（markRan 同风格）。
   */
  const endWorkRecord = (id: string, end: EndWorkRecord): boolean => {
    const r = assertRecord(EndWorkRecordSchema, end, 'store/work-record:end-invalid')
    const existing = db.prepare('SELECT ended_at FROM work_records WHERE id = ?').get(id) as { ended_at: unknown } | undefined
    if (existing === undefined) return false
    if (existing.ended_at !== null && existing.ended_at !== undefined) {
      configInvalid('store/work-record:already-ended', `工时单 ${id} 已收口（ended_at=${String(existing.ended_at)}）——收口只允许一次`)
    }
    db.prepare(
      `UPDATE work_records SET ended_at = ?, status = ?,
         cost_usd = COALESCE(?, cost_usd), tokens = COALESCE(?, tokens), report_ref = COALESCE(?, report_ref), summary_ref = COALESCE(?, summary_ref),
         model = COALESCE(?, model)
       WHERE id = ?`,
    ).run(
      r.ended_at,
      r.status,
      r.cost_usd ?? null,
      r.tokens === undefined ? null : JSON.stringify(r.tokens),
      r.report_ref ?? null,
      r.summary_ref ?? null,
      r.model ?? null,
      id,
    )
    return true
  }

  // —— v5 进化管线 candidates 读写面实现（接口行注与文件头注 v5 段为语义依据） ——

  const rowToCandidate = (row: SqlRow): CandidateRow => {
    const verificationJson = optStr(row, 'verification')
    return {
      id: str(row, 'id'),
      asset_type: str(row, 'asset_type') as CandidateRow['asset_type'],
      asset_path: str(row, 'asset_path'),
      version: str(row, 'version'),
      diff_hash: str(row, 'diff_hash'),
      blast_radius: str(row, 'blast_radius') as CandidateRow['blast_radius'],
      // 快照不猜结构（同 jobs.payload 口径）：JSON 往返，坏列如实报；null=未跑沙箱
      verification: verificationJson === undefined ? null : parseJsonValue(verificationJson, 'store/candidates:verification-corrupt'),
      parent_id: row['parent_id'] === null || row['parent_id'] === undefined ? null : String(row['parent_id']),
      status: str(row, 'status') as CandidateRow['status'],
      created_at: Number(row['created_at']),
    }
  }

  const getCandidate = (id: string): CandidateRow | undefined => {
    const row = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) as SqlRow | undefined
    return row === undefined ? undefined : rowToCandidate(row)
  }

  /** 单跳谱系查询（id → parent_id），主键定位；缺行=undefined */
  const parentLinkOf = (id: string): { id: string; parent_id: string | null } | undefined => {
    const row = db.prepare('SELECT id, parent_id FROM candidates WHERE id = ?').get(id) as SqlRow | undefined
    if (row === undefined) return undefined
    return {
      id: str(row, 'id'),
      parent_id: row['parent_id'] === null || row['parent_id'] === undefined ? null : String(row['parent_id']),
    }
  }

  /**
   * insert 谱系环闸（core ancestorIds 同语义）：沿 parent_id 上爬，遇链内已见 id 即环。
   * 既有环（库已坏）也在此如实抛（无此闸则悬挂链静默入库）；断链容忍（爬到缺失行自然停
   * ——core 同口径：环检不要求全链在库，lineage 读面才 fail-closed）。
   */
  const assertNoLineageCycleOnInsert = (newId: string, parentId: string): void => {
    const seen = new Set<string>([newId, parentId])
    let cur = parentLinkOf(parentId) // 存在性已由 parent-unknown 闸保证
    while (cur !== undefined && cur.parent_id !== null) {
      if (seen.has(cur.parent_id)) {
        configInvalid(
          'store/candidates:lineage-cycle',
          `候选 ${newId} 挂接父 ${parentId} 将构成谱系环（${cur.parent_id} 处闭环——若非新挂边所致即库内既有环）`,
        )
      }
      seen.add(cur.parent_id)
      cur = parentLinkOf(cur.parent_id)
    }
  }

  const insertCandidate = (record: unknown): InsertCandidateResult => {
    const r = assertRecord(CandidateRowSchema, record, 'store/candidates:invalid')
    // verification 序列化闸：serializeVerification 单一口径源（与 updateVerification 同源）
    const verificationJson = serializeVerification(r.verification, r.id)
    // 幂等闸（core proposeCandidate 语义）：同 (asset_path, diff_hash) 且非终态 → 既有 id 不新建；
    // 终态命中放行新建=换代重提（rejected/retired 后同键再提案是新谱系代）。同键多行时取
    // (created_at, id) 首行——不变量下同键至多一行非终态（insert 前置闸保证），多行为防御面
    const keyHits = db
      .prepare('SELECT * FROM candidates WHERE asset_path = ? AND diff_hash = ? ORDER BY created_at ASC, id ASC')
      .all(r.asset_path, r.diff_hash) as SqlRow[]
    const activeHit = keyHits.find((row) => !(TERMINAL_CANDIDATE_STATUS_VALUES as readonly string[]).includes(String(row['status'])))
    if (activeHit !== undefined) return { id: str(activeHit, 'id'), inserted: false }
    // id 冲突前置分类（PK 裸 UNIQUE 错误不是 ClassifiedError）：同 id 全列一致=幂等跳过，不一致=拒
    const byId = db.prepare('SELECT * FROM candidates WHERE id = ?').get(r.id) as SqlRow | undefined
    if (byId !== undefined) {
      const normalized = { ...r, verification: r.verification ?? null }
      if (canonicalJson(rowToCandidate(byId)) === canonicalJson(normalized)) return { id: r.id, inserted: false }
      configInvalid('store/candidates:duplicate-id', `候选 id=${r.id} 已存在且内容不一致（拒绝覆盖语义的重复登记）`)
    }
    // 谱系闸（core 同名闸镜像）：自引用 / 父不在库 / 挂接成环
    if (r.parent_id === r.id) {
      configInvalid('store/candidates:self-parent', `候选 ${r.id} 谱系父指向自身（自引用环）`)
    }
    if (r.parent_id !== null) {
      if (parentLinkOf(r.parent_id) === undefined) {
        configInvalid('store/candidates:parent-unknown', `候选 ${r.id} 谱系父 ${r.parent_id} 不在候选集（F3-02 谱系可反追）`)
      }
      assertNoLineageCycleOnInsert(r.id, r.parent_id)
    }
    db.prepare(
      `INSERT INTO candidates (
         id, asset_type, asset_path, version, diff_hash, blast_radius, verification, parent_id, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(r.id, r.asset_type, r.asset_path, r.version, r.diff_hash, r.blast_radius, verificationJson, r.parent_id, r.status, r.created_at)
    return { id: r.id, inserted: true }
  }

  /**
   * 全祖先链（应用层循环，非递归 CTE——选型说明）：
   *   - 断链/成环的 fail-closed 分类错（lineage-broken / lineage-cycle，与 core lineage 逐字
   *     同语义）在应用层自然表达；递归 CTE 里断链静默截断、环需 UNION 防重手法且难指认环点；
   *   - 每跳一条主键 SELECT，跳数=谱系深度（F3-02「反追 ≥3 跳」口径即个位数量级，N 条 SQL
   *     换语义精确性，量级可接受——涨量后再评估 CTE，拟稿）。
   */
  const lineageOf = (id: string): CandidateRow[] | undefined => {
    const self = getCandidate(id)
    if (self === undefined) return undefined
    const out: CandidateRow[] = [self]
    const seen = new Set<string>([self.id])
    let parent = self.parent_id
    while (parent !== null) {
      // seen 集：既有环如实抛 + 防死循环（环内候选反追不出根——库侧数据损坏防御面）
      if (seen.has(parent)) {
        configInvalid('store/candidates:lineage-cycle', `候选 ${id} 谱系链在 ${parent} 处成环（环内候选反追不出根）`)
      }
      const row = getCandidate(parent)
      if (row === undefined) {
        configInvalid('store/candidates:lineage-broken', `候选 ${id} 谱系断链：祖先 ${parent} 不在候选集（F3-02 反追 ≥3 跳不可满足）`)
      }
      seen.add(parent)
      out.push(row)
      parent = row.parent_id
    }
    return out
  }

  /** 状态值域运行期闸（TS 字面量类型挡编译期，JS 调用方/配置驱动仍须如实拒——对齐 listBudgets kinds 闸） */
  const isCandidateStatus = (v: unknown): v is CandidateStatus =>
    (CANDIDATE_STATUS_VALUES as readonly string[]).includes(v as string)

  const candidatesByStatus = (statuses: readonly CandidateStatus[]): CandidateRow[] => {
    if (!Array.isArray(statuses) || statuses.length === 0) {
      configInvalid('store/candidates:bad-statuses', 'statuses 须为非空数组（按状态集查询——空集=调用方 bug，fail-closed 拒）')
    }
    const bad = (statuses as readonly unknown[]).find((s) => !isCandidateStatus(s))
    if (bad !== undefined) {
      configInvalid('store/candidates:bad-statuses', `statuses 含枚举外值：${String(bad)}（值域 ${CANDIDATE_STATUS_VALUES.join('/')}）`)
    }
    // 占位符逐个参数化绑定（无内插面）；值域闸已过，长度安全
    const placeholders = statuses.map(() => '?').join(', ')
    const rows = db
      .prepare(`SELECT * FROM candidates WHERE status IN (${placeholders}) ORDER BY created_at ASC, id ASC`)
      .all(...statuses) as SqlRow[]
    return rows.map(rowToCandidate)
  }

  const transitionCandidate = (id: string, from: CandidateStatus, to: CandidateStatus): boolean => {
    if (!isCandidateStatus(from) || !isCandidateStatus(to)) {
      configInvalid(
        'store/candidates:bad-status',
        `状态值域外：from=${String(from)} to=${String(to)}（值域 ${CANDIDATE_STATUS_VALUES.join('/')}）`,
      )
    }
    // 乐观锁：期望当前值不匹配（已迁走/无此行）即 0 行=false——两次并发同迁恰一次成功。
    // 边合法性（机器边 / 闸门边 / 人裁边）归 core transitionCandidate 纯函数，本面不复制判定
    //（复制=第二状态机，漂移面；见接口行注）。
    const result = db.prepare('UPDATE candidates SET status = ? WHERE id = ? AND status = ?').run(to, id, from)
    return Number(result.changes) > 0
  }

  /**
   * verification 快照行中写面（沙箱完成点落列；接口行注为语义依据）：
   *   - 序列化闸先行（serializeVerification 与 insertCandidate 同源——输入面校验先于状态窗，
   *     对齐 insert「形状闸→幂等闸→写」的顺序）；
   *   - 窗口闸 fail-closed 分类：无此行=false（markRan 同风格，不猜不抛）；非 sandboxed 态
   *     → CONFIG_INVALID（store/candidates:verification-window——证据只进沙箱阶段，F3-02
   *     四元组时序：gated 之后闸门已消费快照，再写=改口供）；
   *   - 语句级 WHERE status='sandboxed' 防越阶段：乐观锁不需要（daemon 单写者），此处是
   *     「读到 status」与「写入」两步间的兜底（正常流不触发，触发即并发违规面如实 false）。
   */
  const updateVerification = (id: string, verification: unknown): boolean => {
    const verificationJson = serializeVerification(verification, id)
    const row = db.prepare('SELECT status FROM candidates WHERE id = ?').get(id) as { status: unknown } | undefined
    if (row === undefined) return false
    if (row.status !== 'sandboxed') {
      configInvalid(
        'store/candidates:verification-window',
        `候选 ${id} 状态 ${String(row.status)} 不在 verification 写入窗口（仅 sandboxed——证据只进沙箱阶段，F3-02 四元组时序）`,
      )
    }
    const result = db
      .prepare("UPDATE candidates SET verification = ? WHERE id = ? AND status = 'sandboxed'")
      .run(verificationJson, id)
    return Number(result.changes) > 0
  }

  // —— v6 报表三表读写面（17-§3 / docs/50 断链6 / 04-§三） ——

  /** ledgers.body 序列化（serializeVerification 同风格：不可序列化 → CONFIG_INVALID，不入账） */
  const serializeLedgerBody = (body: unknown, issue: string, kind: string): string => {
    try {
      const serialized = JSON.stringify(body)
      if (serialized === undefined) {
        configInvalid('store/ledger-entry:body-unserializable', `单据 ${issue}/${kind} body 含不可 JSON 序列化的值`)
      }
      return serialized
    } catch (err) {
      configInvalid('store/ledger-entry:body-unserializable', `单据 ${issue}/${kind} body 不可序列化：${errorMessage(err)}`)
    }
  }

  const rowToLedgerEntry = (row: SqlRow): LedgerEntryRecord => ({
    issue: str(row, 'issue'),
    kind: str(row, 'kind') as LedgerKind,
    body: JSON.parse(str(row, 'body')) as unknown,
    updated: Number(row['updated']),
  })

  const rowToReport = (row: SqlRow): ReportRecord => ({
    id: str(row, 'id'),
    company: str(row, 'company'),
    node: str(row, 'node'),
    type: str(row, 'type') as ReportType,
    date: str(row, 'date'),
    caliber: str(row, 'caliber'),
    json_ref: str(row, 'json_ref'),
  })

  const upsertLedgerEntry = (record: unknown): LedgerEntryRecord => {
    const r = assertRecord(LedgerEntrySchema, record, 'store/ledger-entry:invalid')
    const bodyJson = serializeLedgerBody(r.body, r.issue, r.kind)
    // last-write-wins 覆盖（单据派生镜像可重建——同 upsertTicketMirror 口径；单写者=daemon，
    // 无并发面）。幂等同写自然落 UPDATE 同值，调用方可比对返回值。
    db.prepare(
      `INSERT INTO ledgers (issue, kind, body, updated) VALUES (?, ?, ?, ?)
       ON CONFLICT (issue, kind) DO UPDATE SET body = excluded.body, updated = excluded.updated`,
    ).run(r.issue, r.kind, bodyJson, r.updated)
    const row = db.prepare('SELECT * FROM ledgers WHERE issue = ? AND kind = ?').get(r.issue, r.kind) as SqlRow
    return rowToLedgerEntry(row)
  }

  /** kind 运行期值域闸（TS 字面量挡编译期，JS 调用方如实拒——listBudgets kinds 闸同风格） */
  const isLedgerKind = (v: unknown): v is LedgerKind => (LEDGER_KIND_VALUES as readonly string[]).includes(v as string)

  const getLedgerEntry = (issue: string, kind: LedgerKind): LedgerEntryRecord | undefined => {
    const row = db.prepare('SELECT * FROM ledgers WHERE issue = ? AND kind = ?').get(issue, kind) as SqlRow | undefined
    return row === undefined ? undefined : rowToLedgerEntry(row)
  }

  const listLedgerEntries = (query: { issue?: string; kind?: LedgerKind } = {}): LedgerEntryRecord[] => {
    if (query.kind !== undefined && !isLedgerKind(query.kind)) {
      configInvalid('store/ledgers:bad-kind', `kind=${String(query.kind)} 枚举外（值域 ${LEDGER_KIND_VALUES.join('/')}）`)
    }
    const where: string[] = []
    const params: Array<string | number> = []
    if (query.issue !== undefined) {
      where.push('issue = ?')
      params.push(query.issue)
    }
    if (query.kind !== undefined) {
      where.push('kind = ?')
      params.push(query.kind)
    }
    let sql = 'SELECT * FROM ledgers'
    if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`
    sql += ' ORDER BY updated ASC, issue ASC, kind ASC'
    return (db.prepare(sql).all(...params) as SqlRow[]).map(rowToLedgerEntry)
  }

  const insertReport = (record: unknown): AppendResult => {
    const r = assertRecord(ReportRecordSchema, record, 'store/report:invalid')
    // 同 id 全列一致幂等跳过 / 内容不一致拒（id 全局唯一语义——appendEvent 口径）；
    // 同自然键 (company,node,type,date) 异 id → 覆盖换代（快照最新胜，04-§三渲染键稳定）。
    const byId = db.prepare('SELECT * FROM reports WHERE id = ?').get(r.id) as SqlRow | undefined
    if (byId !== undefined) {
      const same = rowToReport(byId)
      if (sameReport(same, r)) return { id: r.id, appended: false }
      configInvalid(
        'store/reports:id-conflict',
        `报表 id=${r.id} 已存在且内容不一致（同 id 异自然键/异内容均拒——换内容用新 id 落，自然键覆盖走新 id 路径）`,
      )
    }
    const byNatural = db
      .prepare('SELECT * FROM reports WHERE company = ? AND node = ? AND type = ? AND date = ?')
      .get(r.company, r.node, r.type, r.date) as SqlRow | undefined
    if (byNatural !== undefined) {
      db.prepare('UPDATE reports SET id = ?, caliber = ?, json_ref = ? WHERE company = ? AND node = ? AND type = ? AND date = ?').run(
        r.id,
        r.caliber,
        r.json_ref,
        r.company,
        r.node,
        r.type,
        r.date,
      )
      return { id: r.id, appended: true }
    }
    db.prepare('INSERT INTO reports (id, company, node, type, date, caliber, json_ref) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      r.id,
      r.company,
      r.node,
      r.type,
      r.date,
      r.caliber,
      r.json_ref,
    )
    return { id: r.id, appended: true }
  }

  /** 记录级全列比对（reports 幂等判据） */
  function sameReport(a: ReportRecord, b: ReportRecord): boolean {
    return (
      a.id === b.id &&
      a.company === b.company &&
      a.node === b.node &&
      a.type === b.type &&
      a.date === b.date &&
      a.caliber === b.caliber &&
      a.json_ref === b.json_ref
    )
  }

  /** type 运行期值域闸（listReports 查询参数；字面量类型挡编译期，JS 调用方如实拒） */
  const isReportType = (v: unknown): v is ReportType => (REPORT_TYPE_VALUES as readonly string[]).includes(v as string)

  const listReports = (query: { company?: string; node?: string; type?: ReportType } = {}): ReportRecord[] => {
    if (query.type !== undefined && !isReportType(query.type)) {
      configInvalid('store/reports:bad-type', `type=${String(query.type)} 枚举外（值域 ${REPORT_TYPE_VALUES.join('/')}——04-§三三档）`)
    }
    const where: string[] = []
    const params: Array<string | number> = []
    if (query.company !== undefined) {
      where.push('company = ?')
      params.push(query.company)
    }
    if (query.node !== undefined) {
      where.push('node = ?')
      params.push(query.node)
    }
    if (query.type !== undefined) {
      where.push('type = ?')
      params.push(query.type)
    }
    let sql = 'SELECT * FROM reports'
    if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`
    sql += ' ORDER BY date ASC, id ASC'
    return (db.prepare(sql).all(...params) as SqlRow[]).map(rowToReport)
  }

  return {
    db,
    close: () => db.close(),
    version: () => currentVersion(db),
    appendEvent,
    queryEvents,
    dumpEvents,
    insertWorkRecord,
    getWorkRecord: (id: string) => {
      const row = db.prepare('SELECT * FROM work_records WHERE id = ?').get(id) as SqlRow | undefined
      return row === undefined ? undefined : rowToWorkRecord(row)
    },
    listWorkRecords,
    insertSession,
    getSession: (sessionId: string) => {
      const row = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as SqlRow | undefined
      return row === undefined ? undefined : rowToSession(row)
    },
    listSessions,
    syncCompany,
    listPeople,
    getPerson: (personId: string) => {
      const row = db.prepare('SELECT * FROM people WHERE person_id = ?').get(personId) as SqlRow | undefined
      return row === undefined ? undefined : rowToPerson(row)
    },
    listDepartments,
    upsertTicketMirror,
    getTicketMirror,
    listTicketMirrors,
    replaceTodoQueue,
    listTodoQueue,
    recentDispatchWaitsMs,
    appendBudget,
    queryBudgets,
    listBudgets,
    appendPersonnelEvent,
    personnelTimeline,
    upsertJob,
    getJob,
    listJobs,
    dueJobs,
    markRan,
    removeJob,
    kvGet,
    kvSet,
    endWorkRecord,
    insertCandidate,
    getCandidate,
    lineageOf,
    candidatesByStatus,
    transitionCandidate,
    updateVerification,
    upsertLedgerEntry,
    getLedgerEntry,
    listLedgerEntries,
    insertReport,
    getReport: (id: string) => {
      const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(id) as SqlRow | undefined
      return row === undefined ? undefined : rowToReport(row)
    },
    listReports,
    // probes_runs 面（BC-S2 拆分：probes.ts——studio-dev-177 增 v11 usage 面时清偿）
    ...createProbesFace(db),
    ...createHrSyncQueue(db),
    // v9 定价快照面（132-§6.2 单B：published_at 取库侧时钟——append 时刻的事实）
    ...createPricingFace(db, () => Date.now()),
    // v11 用量投影面（132-§6.1 单C：id/updated_at 归 daemon——投影刷新时刻由
    // 调用方（收割相位尾缝）供，与 append 面事实时刻口径不同）
    ...createUsageFace(db),
    // v12 定型账面（132-§6.3 单D：append-only 定型账——id/closed_at/closed_by 归
    // daemon 收口工序供）
    ...createCostDailyFace(db),
  }
}

/** 记录级全列比对（tokens 经 canonical 序列化后比字节；支撑幂等规则判定） */
function sameEvent(a: EventRecord, b: EventRecord): boolean {
  return (
    a.id === b.id &&
    a.ts === b.ts &&
    a.company === b.company &&
    a.issue === b.issue &&
    a.event === b.event &&
    a.actor === b.actor &&
    a.attempt === b.attempt &&
    a.level === b.level &&
    a.dept === b.dept &&
    a.correlation_id === b.correlation_id &&
    a.causation_id === b.causation_id &&
    canonicalTokens(a.tokens) === canonicalTokens(b.tokens) &&
    a.cost_usd === b.cost_usd &&
    a.duration_ms === b.duration_ms &&
    a.size === b.size &&
    a.payload_hash === b.payload_hash &&
    a.note === b.note
  )
}

/** 类型通道：ClassifiedError 形状（kernel；供调用方 catch 判类） */
export type { ClassifiedError }
