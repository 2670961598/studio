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
 *   [x] 演习与维护 CLI 面（F2-12 可操作化）：runLedgerDrill 删库重建演习（daemon bin 出
 *       `ledger drill/dump/rebuild` 子命令组，薄壳转调本包）
 *   [ ] cron 表达式解析（croner，daemon/core 侧）+ 补跑 coalesce / 同岗不重叠（18-§三，core 后续单）
 *   [ ] 17-§3 其余表（后续 migration 逐版本补）：ledgers / candidates / reports / probes_runs
 *   [ ] 回填工具（F2-13：done.json/REPORT/stream/events → 对账 → 幂等回填；旁路关单标注规则）
 *   [ ] rebuild --from yt,org 两源通道（F2-12 全量再生；现仅 jsonl 源）
 *   [ ] 季度删库演习挂 cron 岗留证（`ledger drill` 已可操作化，v0.4 定时岗落地后挂）
 *   [ ] 数据保留与归档（>90 天事件按月导出，热表留索引，见 docs/19-§四）
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
export type { AppendResult, BudgetScope, CompanySyncResult, DumpResult, EventQuery, Ledger, PersonnelTimelineEntry } from './ledger.ts'

// work_records / sessions + v2 五表 + v3 jobs + v4 收口面 记录形状（store 层临时闸，contract schema 落地后替换）
export {
  BudgetRecordSchema,
  DepartmentRecordSchema,
  EndWorkRecordSchema,
  JobRecordSchema,
  PersonRecordSchema,
  PersonnelEventRecordSchema,
  SessionRecordSchema,
  TicketMirrorRecordSchema,
  WorkRecordSchema,
} from './records.ts'
export type {
  BudgetRecord,
  DepartmentRecord,
  EndWorkRecord,
  JobRecord,
  PersonRecord,
  PersonnelEventRecord,
  SessionRecord,
  TicketMirrorRecord,
  WorkRecord,
} from './records.ts'

// 快照与重建
export { rebuild } from './rebuild.ts'
export type { RebuildResult } from './rebuild.ts'

// 删库重建演习（F2-12 可操作化；`studio-next ledger drill` 的库内通道）
export { renderDrillReport, runLedgerDrill } from './drill.ts'
export type { DrillCheck, DrillReport } from './drill.ts'
