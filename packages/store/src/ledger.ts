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
 *
 * 拆件（studio-dev-556；BC-S2「先拆再增」纪律）：本文件只保留**唯一组装点** openLedger 与
 * 句柄形状（Ledger 接口）；各域读写面按 face 工厂落 src/ledger/ 子目录——events /
 * work-records / company / jobs / kv / budgets / candidates / reports + shared 共享件。
 * 全部工厂接收 openLedger 持有的**同一个 db 句柄与同一组 helper**（不复制连接、不复制行映射，
 * 无第二状态源）；导出面零漂移：openLedger / Ledger / EventQuery / AppendResult /
 * renderDumpReport 等原名原路径再出口，外部 import 路径不变。
 */
import type { DatabaseSync } from 'node:sqlite'
import type { ClassifiedError } from '@studio-next/contract'
import { openSqlite } from './driver.ts'
import { anchorEventsChain } from './events-chain.ts'
import { currentVersion, migrate } from './migrations.ts'
import { backupLedgerTo, pruneTicketMirrors } from './mirror-gc.ts'
import type { LedgerBackupResult, PruneTicketMirrorsOptions, PruneTicketMirrorsResult } from './mirror-gc.ts'
import { walCheckpoint, type WalCheckpointResult } from './wal.ts'
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
import { errorMessage, type AppendResult } from './ledger/shared.ts'
import { createEventsFace, type DumpResult, type EventQuery, type EventsFace } from './ledger/events.ts'
import { createWorkRecordsFace, type WorkRecordsFace } from './ledger/work-records.ts'
import { createCompanyFace, type CompanyFace } from './ledger/company.ts'
import type { CompanySyncResult, PersonnelTimelineEntry } from './ledger/company.ts'
import { createBudgetsFace, type BudgetsFace } from './ledger/budgets.ts'
import type { BudgetListQuery, BudgetScope } from './ledger/budgets.ts'
import { createJobsFace, type JobsFace } from './ledger/jobs.ts'
import { createKvFace, type KvFace } from './ledger/kv.ts'
import { createCandidatesFace, type CandidatesFace } from './ledger/candidates.ts'
import type { InsertCandidateResult } from './ledger/candidates.ts'
import { createReportsFace, type ReportsFace } from './ledger/reports.ts'

/** 台账句柄：daemon 持有；db 暴露 DatabaseSync 标准面（引擎切换只动 driver.ts） */
export interface Ledger
  extends EventsFace,
    WorkRecordsFace,
    CompanyFace,
    BudgetsFace,
    JobsFace,
    KvFace,
    CandidatesFace,
    ReportsFace,
    HrSyncQueueFace,
    PricingFace,
    UsageFace,
    ProbesFace,
    CostDailyFace {
  db: DatabaseSync
  close(): void
  /** WAL checkpoint(TRUNCATE)（受权重启检查点第 5 步；busy≠0 抛错不静默） */
  checkpoint(): WalCheckpointResult
  /** 当前 schema 版本（schema_version 表 MAX(version)；0=无迁移记录） */
  version(): number
  /**
   * ticket_mirror 投影 GC 删除面（studio-dev-511；docs/17-§3 镜像=可重建投影）：删除
   * 「company 下 issue 不在 activeIssues 中」的残行（单事务原子；空活动集 fail-closed 拒删）。
   * 调用方须先 `backupTo` 备份、且持 writer lease（daemon 相位 1 尾维护步）。
   */
  pruneTicketMirrors(company: string, activeIssues: Iterable<string>, opts?: PruneTicketMirrorsOptions): PruneTicketMirrorsResult
  /** 一致性备份（VACUUM INTO；目标须不存在）——GC 前调用，失败即不得删 */
  backupTo(outPath: string): LedgerBackupResult
}

// —— 导出面（零漂移）：以下类型原定义于本文件，拆件后由各 face 模块单一源定义、此处再出口 ——
export type {
  AppendResult,
  BudgetListQuery,
  BudgetScope,
  CompanySyncResult,
  DumpResult,
  EventQuery,
  InsertCandidateResult,
  PersonnelTimelineEntry,
}
export { renderDumpReport } from './backup.ts'

/** 打开（或创建）台账库：建库 → PRAGMA 对齐 → migrate()（幂等）→ 锚定/校验事件链 → 返回句柄 */
export function openLedger(path: string): Ledger {
  const db = openSqlite(path)
  try {
    migrate(db)
    // v16：空链+存量事件=首次锚定；随后全量重算校验——链断/不符/未覆盖即抛错（fail-closed）
    anchorEventsChain(db)
  } catch (err) {
    db.close()
    // 告警面（拒读）：daemon 启动即校验；失败不返回句柄，调用方只能走人工处置
    console.error(`[store] events 哈希链校验失败，拒绝打开台账（fail-closed）：${errorMessage(err)}`)
    throw err
  }

  // 唯一组装点：全部 face 工厂共享上面这一个 db 句柄（不复制连接/状态）；行映射等 helper
  // 亦单源（shared.ts / 各 face 模块导出），此处只做摊入。
  return {
    db,
    close: () => db.close(),
    checkpoint: () => walCheckpoint(db),
    version: () => currentVersion(db),
    ...createEventsFace(db),
    ...createWorkRecordsFace(db),
    ...createCompanyFace(db),
    ...createBudgetsFace(db),
    ...createJobsFace(db),
    ...createKvFace(db),
    ...createCandidatesFace(db),
    ...createReportsFace(db),
    pruneTicketMirrors: (company, activeIssues, opts) => pruneTicketMirrors(db, company, activeIssues, opts),
    backupTo: (outPath) => backupLedgerTo(db, outPath),
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

/** 类型通道：ClassifiedError 形状（kernel；供调用方 catch 判类） */
export type { ClassifiedError }
