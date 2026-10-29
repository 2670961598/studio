/**
 * Studio Next · store —— 台账存储（SQLite 可重建投影）
 *
 * 定位（docs/17-§3，需求 F2）：
 *   - **可重建投影**，不是第二事实源：每一行都要能回答"权威源是谁"（F2-01）
 *   - 引擎：`node:sqlite`（DatabaseSync，零原生依赖）+ 手写薄 migration runner
 *     （schema_version 表 + 顺序 SQL，见 migrations.ts）——drizzle 探测结论见 driver.ts 头注
 *     （稳定线无 node:sqlite 驱动，留待后续单，如实记录）
 *   - 只此一个写口：daemon 是唯一写入者；events 表 append-only（无 UPDATE/DELETE 路径）
 *   - 结果体分离：库里只存 status/size/hash/路径引用，大 payload 与 prompt 留文件（F2-03）
 *
 * TODO：
 *   [x] v0.2 首刀三表：events / work_records / sessions（migration v1，17-§3 列集）
 *   [x] 打开库封装 openLedger（WAL / synchronous / foreign_keys / busy_timeout PRAGMA 对齐）
 *   [x] appendEvent：contract validateEventRecord 前置闸（非法 CONFIG_INVALID 拒入账）+
 *       同 id 幂等规则（拟稿待批）；canonical tokens 序列化（F2-11 哈希比对前提）
 *   [x] 查询面：queryEvents（company/issue/since/until/limit，恒升序）；
 *       work_records / sessions insert/get/list
 *   [x] 快照/重建：dumpEvents（库 → JSONL 单向派生）+ rebuild（JSONL → 新库，单事务原子，
 *       坏行中止且指明行号）；删库重建演习测试落 test/rebuild.test.ts
 *   [x] v0.2 第二刀五表（migration v2，17-§3）：people / personnel_events / departments /
 *       ticket_mirror / budgets；syncCompany 镜像 upsert（只覆盖快照所载字段）+ budgets
 *       落账/查询 + appendPersonnelEvent（触发器机制兜底 append-only）+ personnelTimeline
 *       三表归并时间线（C1-04 最小面）
 *   [x] v3 jobs 调度表（migration v3，17-§2 / 18-§三）：upsertJob（job_id 幂等覆盖，热更单岗
 *       不动他岗）/ dueJobs（补跑扫描）/ markRan（两列同语句原子）/ removeJob + getJob/listJobs 读面
 *   [x] v4 吸收单（migration v4，daemon 合龙件三债）：daemon_kv 表接管（DDL/语句与 daemon
 *       现行字节级一致，存量数据原地接管；kvGet/kvSet 读写面）+ work_records 收口面
 *       endWorkRecord（一次性收口，可选列 COALESCE 不动）+ queryEvents 倒序通道
 *       （order='desc'，desc+limit=最近 N 条；panel 消费接线归后续单）
 *   [x] v5 进化管线 candidates 表（migration v5，17-§3 / core evolution 首刀 / 02-F3）：
 *       CandidateRow（逐列对齐 core CandidateRecord 可序列化形态，值域复制+一致性测试钉死）
 *       + insertCandidate（(asset_path,diff_hash)×非终态 幂等，谱系闸）/ getCandidate /
 *       lineageOf（全祖先链，应用层循环，断链/成环 fail-closed）/ candidatesByStatus
 *       （判负查 active 集）/ transitionCandidate（乐观锁，边合法性归 core）；daemon 接线
 *       （assertChangeAuthorized 消费 active 集）归后续刀
 *   [x] v6 报表三表（migration v6，17-§3 / docs/50 断链6 / 04-§三）：ledgers（单据派生镜像
 *       upsert + 双键读面）/ reports（报表快照行，自然键 (company,node,type,date) 唯一——
 *       同键新 id 覆盖换代 + listReports 读面）/ probes_runs（append-only 触发器兜底 + 同 id
 *       幂等）；消费接线=报表聚合管线（company reports.ts）与 :8789 财务页月报段
 *   [x] v7 人事同步任务队列（migration v7，DEV-48 / docs/52-§9.2/§11）：hr_sync_log 可流转
 *       任务账（op_key 幂等入队 / 乐观锁流转 / 达限 failed 终态 / 断电复位）+ setPersonStatus
 *       （people.status 归人事流写面收口）——daemon 相位尾消化器消费（apps/daemon engine/hrsync）
 *   [x] 演习与维护 CLI 面（F2-12 可操作化）：runLedgerDrill 删库重建演习（daemon bin 出
 *       `ledger drill/dump/rebuild` 子命令组，薄壳转调本包）
 *   [ ] cron 表达式解析（croner，daemon/core 侧）+ 补跑 coalesce / 同岗不重叠（18-§三，core 后续单）
 *   [ ] 回填工具（F2-13：done.json/REPORT/stream/events → 对账 → 幂等回填；旁路关单标注规则）
 *   [ ] rebuild --from yt,org 两源通道（F2-12 全量再生；现仅 jsonl 源）
 *   [ ] 季度删库演习挂 cron 岗留证（`ledger drill` 已可操作化，v0.4 定时岗落地后挂）
 *   [ ] 数据保留与归档（>90 天事件按月导出，热表留索引，见 docs/19-§四）
 *
 * v6 拟稿待批 / 疑点（只记录，不改文档）：
 *   - ledgers 复合主键 (issue, kind)：17-§3 未言明主键（issue 单列不唯一、kind 亦然），取最
 *     自然双键；覆盖写 last-write-wins（单据派生可重建——upsertTicketMirror 同口径），不加
 *     updated 单调闸（重建回填允许乱序）——待批
 *   - ledgers 表名与库句柄类型 Ledger 同名异义（17-§3 冻结表名）：记录名取 LedgerEntryRecord
 *     避撞——纯命名取舍，无语义影响
 *   - reports 口径版本列名 caliber（17-§3 中文列名英文化；值如 monthly/v1 由聚合管线自定，
 *     store 不锁值域）；date=归属期锚日 YYYY-MM-DD（月报=当月末日 UTC，由期键派生——形状闸
 *     只锁 YYYY-MM-DD，语义校验归调用方）——待批
 *   - reports 自然键覆盖换代语义（同键新 id 覆盖：最新快照胜，历史在文件与 REPORT_* 事件）；
 *     同 id 异内容一律 CONFIG_INVALID（id 全局唯一，appendEvent 口径）——换代与拒改的边界
 *     划分待批
 *   - probes_runs id 为库侧补列（17-§3 未列；append-only 幂等回填需要唯一键，events 同款
 *     非空串不锁 ULID）；cost→cost_usd、duration→duration_ms 列名对齐库内口径（events 先例）；
 *     append-only 用触发器机制兜底（personnel_events 同款）——待批
 *   - reports/probes_runs 均无 company 一致性闸（行内 company 列不做 events 级校验）：
 *     报表行公司维过滤靠查询参数，坏行走调用方责任——是否补闸待批
 *
 * v5 拟稿待批 / 疑点（只记录，不改文档）：
 *   - 列名取舍：asset_type（core 字段名，任务草案曾写 asset_kind——行↔记录零改名）；version
 *     TEXT（core CandidateRecord.version 为 string，草案曾写 INTEGER——「v0.3」类版本号可往返，
 *     core 形状闸校验非空串 INTEGER 容不下）；asset_path 补列（17-§3 未列，core 首刀裁定：
 *     判负面 (asset_path,diff_hash) 匹配机制需要）；created_at INTEGER（库侧列，超出 core
 *     形状——core 零 Date.now，时钟由 daemon 供）——差异全表见实现单汇报
 *   - 值域复制而非 import：store src 零 core 运行时依赖（core 值域冻结于 evolution.ts），
 *     漂移由 test/v5-candidates.test.ts 一致性用例钉死（core 字面量数组 vs store 数组/zod
 *     枚举 deep-equal，沿 STUDIO_TOOLS↔GATEWAY_ACTIONS 先例）；@studio-next/core 仅测试
 *     devDependency（panel↔company 同先例）
 *   - 幂等口径：同 (asset_path, diff_hash) 且**非终态**命中返回既有 id（core 拟稿裁定）；
 *     终态放行新建=换代重提。同 id 全列一致跳过 / 不一致 CONFIG_INVALID（appendEvent 口径）
 *   - transitionCandidate 不校验边合法性（状态机单一事实源=core 机器边表，库层复制判定面
 *     =第二状态机漂移面）；乐观锁 WHERE status=期望当前值，0 行=false。签名 (id, from, to)：
 *     from 是乐观锁的期望当前值，调用方（daemon）先经 core 纯函数判定再持 from 落库
 *   - lineageOf 选型=应用层循环非递归 CTE：断链/成环 fail-closed 分类错与 core lineage 逐字
 *     同语义，CTE 难给精确分类；跳数=谱系深度个位数量级，N 条主键 SELECT 可接受——待批
 *   - candidatesByStatus 空数组 CONFIG_INVALID（fail-closed，空集=调用方 bug）——与
 *     listBudgets kinds「空数组=不过滤」不同口径：本面状态集即查询本体，语义不同——待批
 *   - candidates 无 FK（parent_id 软引用）：存在性/成环闸在 insertCandidate 应用层——容忍
 *     按序重建的插入顺序；是否补 FK 约束，待批
 *
 * v4 拟稿待批 / 疑点（只记录，不改文档）：
 *   - kv 接管：DDL/读写语句与 daemon 现行 engine.ts 字节级一致（IF NOT EXISTS 双向幂等共存）；
 *     daemon 后续单删自建语句切本面，数据原地续用——接管关系见 migrations v4 头注
 *   - kv 键闸=非空串（空键=调用方 bug 拒收）；value 不闸（空串=daemon「游标 null」持久形态，
 *     回读方还原 null）。键命名空间（前缀/点分约定）不锁——daemon 现行 'activity.cursor'/
 *     'tick.seq' 直用——待批
 *   - endWorkRecord tokens 写面已扩（切换单清偿）：入参 tokens 取 kernel.TokenCounts（与
 *     work_records 建列/insertWorkRecord 同源），序列化=JSON.stringify 原序（**非** events
 *     四桶 canonical 序——两列不同源，F2-04 只冻结 events 侧）；未给值 COALESCE 不动。
 *     daemon 已切本面（自建 kv/直发 UPDATE 删除），语句列位与切换前逐列同形
 *   - endWorkRecord status 终态值域不锁（done/failed 枚举归收割域/contract 后续收口）；
 *     无此行返回 false（markRan 同风格）而非 CONFIG_INVALID——口径待批
 *   - queryEvents order 白名单闸（运行期防注入，CONFIG_INVALID）；desc 索引兼容性：company
 *     过滤+desc 走 idx_events_company_ts 反向扫描，issue 过滤走 idx_events_issue 定位后排序，
 *     无过滤面全表排序（与 asc 同量级；量大后再评估独立 ts 索引）——见 EventQuery.order 行注
 *
 * v3 拟稿待批 / 疑点（只记录，不改文档）：
 *   - budget_cap 存 REAL（USD）而非 INTEGER 微美分：对齐 contract Money{usd:number} 与库内
 *     cost_usd/estimated_usd/actual_usd 全 REAL 口径（一库一种货币单位）；jobs 不在 events
 *     JSONL 派生路径上，无 F2-11 字节确定性强约束——待批
 *   - upsertJob 冲突时 last_run_at 不随覆盖（运行时状态归 markRan，公司目录热更不清跑史）；
 *     首插允许带 last_run_at（存量回填用）——语义待批
 *   - jobs.status 可空且值域不锁（active/paused 归 core 调度域后续单）；dueJobs 不按 status
 *     过滤（v0 store 不猜暂停语义，扫描面留全量）——待批
 *   - cron 仅形状闸（非空 + ≤6 空白分隔段），段内语法不校验；解析归 core 后续单（18-§三 croner
 *     只在 daemon 侧引）——本包零新依赖
 *   - model_tier 锁 'high'|'mid'|'low'（contract ports/models.ts ModelTier 冻结口径）
 *
 * v2 拟稿待批 / 疑点（只记录，不改文档）：
 *   - people 表无 company 列（17-§3/任务口径均未列）：多公司同库时工号全局唯一是前提
 *     （04 工号制：工号=档案文件名=永不变主键）——跨公司唯一性待确认
 *   - PersonRef 只载 id/name/login/level/dept：role/skills/side_effects/capability_tier/
 *     executor_pref/status 无镜像同步来源（people 扩展列 v0 无写面）——person 快照协议是否
 *     扩列，归 contract/company 后续单
 *   - DeptNode.name/level/relations 未列于 17-§3 departments 列集：镜像不承载（部门名靠
 *     path 尾段、level 靠 people 侧），是否补列待批
 *   - 镜像收敛未做：目录已删的人/部门不随 syncCompany 剔除（退/停走 personnel_events 流程，
 *     直接删行丢状态语义）；是否加 deleted_at 或全量 diff 剔除，待批
 *   - personnel_events type 值域（入/调/升/降/停/复/退）v0 不锁；capability_tier 0-3 取
 *     V4-V7-§4.2/§14 口径；prev/next 取标量文本（复合变动拆条）——均待 contract 冻结
 *   - v1 events 表 append-only 仅纪律约束（sha8 已锁不可改）；v2 personnel_events 用
 *     UPDATE/DELETE 触发器机制兜底——events 是否于 v3 补触发器，待批
 *   - personnelTimeline 按 person_id 查三表，v0 全表扫（量级小）；work_records/sessions
 *     的 person_id 索引是否补，待量级证
 *   - listBudgets 全量读面走全表扫描后 (ts,id) 排序（idx_budgets_scope 只服务 scope 定位）：
 *     量级口径=预算行量与派发量级同阶（每单三节点各至多数行），可接受；涨量后再评估
 *     budgets ts 索引——待批。kinds 空数组=不过滤（「空子集」语义不取，免 IN () 空集陷阱）——待批
 */

/** 包名常量（占位导出） */
export const PACKAGE_NAME = '@studio-next/store'

/** 状态标记：v0.2 首刀范围（三表+查询面+快照/重建）已落地；其余表与回填工具见上方 TODO */
export const PACKAGE_STATUS = 'partial'

// 引擎边界（better-sqlite3 一行切换点，16-§六）
export { openSqlite } from './driver.ts'

// 薄 migration runner（schema_version 表）
export { currentVersion, migrate, LATEST_VERSION } from './migrations.ts'
export type { Migration } from './migrations.ts'

// 台账句柄与读写面
export { openLedger } from './ledger.ts'
export type { AppendResult, BudgetListQuery, BudgetScope, CompanySyncResult, DumpResult, EventQuery, InsertCandidateResult, Ledger, PersonnelTimelineEntry } from './ledger.ts'

// D12 只读打开/围栏（PB-5 入口；docs/80 §8.2）：readOnly:true + query_only=ON，
// 不迁移/不 DDL/不写 WAL；缺库→unavailable/STALL/db-missing，版本偏移→
// rejected_version/EVOLVE_REJECT/schema-behind|ahead（见 src/readonly.ts 头注）
export { openLedgerReadonly } from './readonly.ts'
export type {
  OpenLedgerReadonlyResult,
  ReadOnlyLedger,
  ReadOnlyLedgerError,
  ReadOnlyLedgerOpen,
} from './readonly.ts'

// v9 定价快照面（132-§6.2 单B·studio-dev-169）：唯一写面 appendPriceSnapshot（单据锚）
// + 读面 listPriceSnapshots；形状闸与冻结词表复制随面落 src/pricing.ts
export {
  PRICE_BILLING_TRACK_VALUES,
  PRICE_SLOT_VALUES,
  type AppendPriceSnapshotResult,
  type PriceBillingTrack,
  type PriceSnapshotQuery,
  type PriceSnapshotRecord,
  type PriceSlot,
  type PricingFace,
} from './pricing.ts'

// perf 五指标聚合件（130-P4·studio-dev-175：批示⑥ 口径冻结，caliber=perf/v1 版本化）——
// 面板部长视图/perf-weekly 报表/测试三方单一实现（S9 复算一致的单源保证）；纯函数零写入
export {
  UNATTRIBUTED_PERSON,
  gateRate,
  harvestHits,
  perfPercentile,
  perfPersonRows,
  rejectionCount,
  reportRate,
  type PerfAggregationInput,
  type PerfEventCounts,
  type PerfPersonRow,
} from './perf.ts'
// v11 人×模型×日用量投影面（132-§6.1 单C·studio-dev-177）：增量并格 upsert（收割
// 相位尾缝 write-through）+ 全量替换 replace（重建面）+ 读面 listUsageDaily
export {
  type ReplaceUsageDailyResult,
  type UsageDailyQuery,
  type UsageDailyRecord,
  type UsageFace,
} from './usage.ts'

// v12 定型账面（132-§6.3 单D·studio-dev-179）：append-only 定型账（final 首冻+
// adjustment 迟到事实补账）+ 读面/已收口日期扫描面；迁移条目 costDailyMigration 同源
export {
  COST_BASIS_VALUES,
  COST_KIND_VALUES,
  costDailyMigration,
  type CostBasis,
  type CostDailyFace,
  type CostDailyQuery,
  type CostDailyRecord,
  type CostKind,
} from './cost.ts'

// probes_runs 探针跑分面（BC-S2 拆分件·studio-dev-177：自 ledger.ts 原样拆出零行为变更）
export { createProbesFace, type ProbeRunQuery, type ProbesFace } from './probes.ts'

// work_records / sessions + v2 五表 + v3 jobs + v4 收口面 + v5 candidates + v6 报表三表
// + v7 hr_sync_log 记录形状（store 层临时闸，contract schema 落地后替换）
export {
  BudgetRecordSchema,
  CANDIDATE_ASSET_KINDS,
  CANDIDATE_BLAST_RADII,
  CANDIDATE_STATUS_VALUES,
  CandidateRowSchema,
  DepartmentRecordSchema,
  EndWorkRecordSchema,
  HR_SYNC_PLATFORM_VALUES,
  HR_SYNC_STATUS_VALUES,
  HrSyncPayloadSchema,
  HrSyncTaskSchema,
  JobRecordSchema,
  LEDGER_KIND_VALUES,
  LedgerEntrySchema,
  PersonRecordSchema,
  PersonnelEventRecordSchema,
  ProbeRunSchema,
  REPORT_TYPE_VALUES,
  ReportRecordSchema,
  SessionRecordSchema,
  TERMINAL_CANDIDATE_STATUS_VALUES,
  TicketMirrorRecordSchema,
  TodoQueueRecordSchema,
  WorkRecordSchema,
} from './records.ts'
export type {
  BudgetRecord,
  CandidateAssetKind,
  CandidateBlastRadius,
  CandidateRow,
  CandidateStatus,
  DepartmentRecord,
  EndWorkRecord,
  HrSyncPayload,
  HrSyncPlatformName,
  HrSyncStatus,
  HrSyncTaskRecord,
  JobRecord,
  LedgerEntryRecord,
  LedgerKind,
  PersonRecord,
  PersonnelEventRecord,
  ProbeRunRecord,
  ReportRecord,
  ReportType,
  SessionRecord,
  TerminalCandidateStatus,
  TicketMirrorRecord,
  TodoQueueRecord,
  WorkRecord,
} from './records.ts'

// 快照与重建
export { rebuild } from './rebuild.ts'
export type { RebuildResult } from './rebuild.ts'

// 删库重建演习（F2-12 可操作化；`studio-next ledger drill` 的库内通道）
export { renderDrillReport, runLedgerDrill } from './drill.ts'
export type { DrillCheck, DrillReport } from './drill.ts'
