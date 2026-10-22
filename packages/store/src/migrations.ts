/**
 * migrations —— 薄 migration runner（schema_version 表 + 手写顺序 SQL）
 *
 * 选型依据：docs/16-§二（node:sqlite + migration）、docs/17-§3（schema_version 表：
 * version / applied_at / sha8 三列）。drizzle 探测结论见 driver.ts 头注——稳定线无
 * node:sqlite 驱动，故 migration 走「schema_version 表 + 手写顺序 SQL」薄法（任务预案允许）。
 *
 * 语义（幂等三保证）：
 *   1. 逐版本顺序应用：MIGRATIONS 按 version 升序排列，migrate() 只补未应用的版本；
 *   2. 每版本一个事务：该版本全部 SQL 同生共死（半途失败整体回滚，不留半截 schema）；
 *   3. sha8 防漂移：应用时记 sha256(SQL) 前 8 hex；重开库时已记录版本 sha8 与内置脚本
 *      不一致 → CONFIG_INVALID（schema_version 是内置脚本的投影，漂移即篡改/降级混用）。
 */
import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { configInvalid } from '@studio-next/contract'

/** 一条迁移：version 单调 +1 起；name 仅为人读；sql 为该版本的完整顺序 SQL */
export interface Migration {
  version: number
  name: string
  sql: string
}

/**
 * v1：v0.2 首刀三表（docs/16-§四 v0.2 / 17-§3 数据模型）
 *
 *   - events：逐列对齐 contract EventRecordSchema 字段名（id/ts/company/issue/event/actor/
 *     attempt/level/dept/correlation_id/causation_id/tokens/cost_usd/duration_ms/size/
 *     payload_hash/note）；tokens 存四桶 JSON 文本（F2-04 冻结列名，写入前经契约校验，
 *     appendEvent 内做 canonical 序列化——固定桶序，JSONL 派生可哈希比对，F2-11）。
 *   - work_records / sessions：按 17-§3 行条目落列。拟稿待批（docs 未细化处）：
 *     「工号」列名 person_id；「started/ended」列名 started_at/ended_at（epoch ms，
 *     ended 可空=在途）；cost 列名 cost_usd（对齐 events）；tokens 形状取 kernel.TokenCounts
 *     （收割归一化口径，与 events 四桶不同源）。
 *   - 索引（任务口径）：events(company, ts)、events(issue)、work_records(issue)。
 *   - 17-§3 其余十表（people/personnel_events/departments/ticket_mirror/ledgers/
 *     candidates/budgets/reports/probes_runs）不落本刀，进 index.ts TODO。
 */
const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'v0.2 首刀三表：events / work_records / sessions',
    sql: [
      'CREATE TABLE events (',
      '  id TEXT PRIMARY KEY,',
      '  ts INTEGER NOT NULL,',
      '  company TEXT NOT NULL,',
      '  issue TEXT NOT NULL,',
      '  event TEXT NOT NULL,',
      '  actor TEXT NOT NULL,',
      '  attempt INTEGER NOT NULL,',
      '  level INTEGER NOT NULL,',
      '  dept TEXT NOT NULL,',
      '  correlation_id TEXT,',
      '  causation_id TEXT,',
      '  tokens TEXT NOT NULL,',
      '  cost_usd REAL,',
      '  duration_ms INTEGER,',
      '  size INTEGER,',
      '  payload_hash TEXT,',
      '  note TEXT',
      ');',
      'CREATE INDEX idx_events_company_ts ON events (company, ts);',
      'CREATE INDEX idx_events_issue ON events (issue);',
      '',
      'CREATE TABLE work_records (',
      '  id TEXT PRIMARY KEY,',
      '  issue TEXT NOT NULL,',
      '  person_id TEXT NOT NULL,',
      '  instance_id TEXT,',
      '  executor TEXT NOT NULL,',
      '  session_id TEXT,',
      '  lane TEXT,',
      '  branch TEXT,',
      '  started_at INTEGER NOT NULL,',
      '  ended_at INTEGER,',
      '  cost_usd REAL,',
      '  tokens TEXT,',
      '  attempt INTEGER NOT NULL,',
      '  status TEXT NOT NULL,',
      '  report_ref TEXT,',
      '  summary_ref TEXT',
      ');',
      'CREATE INDEX idx_work_records_issue ON work_records (issue);',
      '',
      'CREATE TABLE sessions (',
      '  session_id TEXT PRIMARY KEY,',
      '  issue TEXT NOT NULL,',
      '  person_id TEXT NOT NULL,',
      '  archive_path TEXT,',
      '  started_at INTEGER NOT NULL,',
      '  ended_at INTEGER,',
      '  turns INTEGER',
      ');',
      '',
    ].join('\n'),
  },
  {
    version: 2,
    name: 'v0.2 第二刀五表：people / personnel_events / departments / ticket_mirror / budgets',
    sql: [
      // people：公司目录镜像（权威源=公司目录，17-§3）。people/<工号>.md front-matter 的索引化：
      //   role=岗位；skills / side_effects 存 JSON 字符串数组文本；capability_tier=能力档 0-3
      //   （V4-V7-§4.2/§14，值域拟稿见 records.ts）；executor_pref=executor 偏好（缺省继承框架默认）；
      //   status=active|paused|retired（模板口径，v0 不锁枚举）。
      //   注：17-§3/任务口径均未给 people 立 company 列——工号全局唯一是前提（疑点已上报 index.ts TODO）。
      'CREATE TABLE people (',
      '  person_id TEXT PRIMARY KEY,',
      '  name TEXT NOT NULL,',
      '  login TEXT NOT NULL,',
      '  level INTEGER NOT NULL,',
      '  dept TEXT NOT NULL,',
      '  role TEXT,',
      '  skills TEXT,',
      '  side_effects TEXT,',
      '  capability_tier INTEGER,',
      '  executor_pref TEXT,',
      '  status TEXT',
      ');',
      '',
      // personnel_events：本库 append-only（17-§3「权威源」列）。type=入/调/升/降/停/复/退（值域
      //   v0 不锁，contract 冻结时收口）；prev/next=前值/新值（标量文本，复合变动拆条——拟稿）；
      //   ticket/approver NOT NULL——F2-06「必挂单」、C1-06「无单号拒绝」的机制化落点（列级约束兜底）。
      //   append-only 用 BEFORE UPDATE/DELETE 触发器机制保证（AGENTS.md 纪律 4「机制保证，不是自律」）：
      //   行级触发器拦 UPDATE/DELETE（含未来新写面与手工 sqlite3 误改）；DROP TABLE 不受行级触发器
      //   拦截——删库重建本身是合法演习路径（F2-12），无需拦。v1 events 表无触发器（sha8 已锁，
      //   只增不改），差异记录在 index.ts TODO。
      'CREATE TABLE personnel_events (',
      '  id TEXT PRIMARY KEY,',
      '  ts INTEGER NOT NULL,',
      '  person_id TEXT NOT NULL,',
      '  type TEXT NOT NULL,',
      '  prev TEXT,',
      '  next TEXT,',
      '  ticket TEXT NOT NULL,',
      '  approver TEXT NOT NULL',
      ');',
      "CREATE TRIGGER trg_personnel_events_no_update BEFORE UPDATE ON personnel_events BEGIN",
      "  SELECT RAISE(ABORT, 'personnel_events 为 append-only（17-§3）：UPDATE 被拒');",
      'END;',
      "CREATE TRIGGER trg_personnel_events_no_delete BEFORE DELETE ON personnel_events BEGIN",
      "  SELECT RAISE(ABORT, 'personnel_events 为 append-only（17-§3）：DELETE 被拒');",
      'END;',
      '',
      // departments：公司目录镜像（权威源=公司目录，17-§3）。functions/lanes 存 JSON 字符串数组文本
      //   （NOT NULL：可存空数组 []，不可缺）；parent_path=上级部门 path（根节点为 NULL）。
      //   注：DeptNode.name/level/relations 未列于 17-§3 列集，镜像不承载（疑点已上报 index.ts TODO）。
      'CREATE TABLE departments (',
      '  path TEXT PRIMARY KEY,',
      '  company TEXT NOT NULL,',
      '  leader TEXT NOT NULL,',
      '  functions TEXT NOT NULL,',
      '  lanes TEXT NOT NULL,',
      '  parent_path TEXT',
      ');',
      '',
      // ticket_mirror：YouTrack 镜像（权威源=YouTrack，17-§3）。parent=父单号（可空=无父单）；
      //   lane=泳道（可空=未定泳道）。镜像允许覆盖写（upsert），非 append-only。
      'CREATE TABLE ticket_mirror (',
      '  issue TEXT PRIMARY KEY,',
      '  company TEXT NOT NULL,',
      '  created INTEGER NOT NULL,',
      '  updated INTEGER NOT NULL,',
      '  state TEXT NOT NULL,',
      '  type TEXT NOT NULL,',
      '  dept TEXT NOT NULL,',
      '  level INTEGER NOT NULL,',
      '  dispatcher TEXT NOT NULL,',
      '  parent TEXT,',
      '  lane TEXT',
      ');',
      '',
      // budgets：本库权威（17-§3）。scope_kind=issue|person|company（scope_id 对应单号/工号/公司 slug）；
      //   kind=reserve|settle|refusal（F1-09 预算三节点：预留→结算→拒绝）；estimated/actual 可空
      //   （refusal 常只有 estimated，settle 前无 actual）。
      'CREATE TABLE budgets (',
      '  id TEXT PRIMARY KEY,',
      '  scope_kind TEXT NOT NULL,',
      '  scope_id TEXT NOT NULL,',
      '  kind TEXT NOT NULL,',
      '  estimated_usd REAL,',
      '  actual_usd REAL,',
      '  ts INTEGER NOT NULL',
      ');',
      'CREATE INDEX idx_budgets_scope ON budgets (scope_kind, scope_id);',
      '',
    ].join('\n'),
  },
  {
    version: 3,
    name: 'v0.4 地基：jobs 调度表（17-§2 调度表列集 / 18-§三 调度设计）',
    sql: [
      // jobs：daemon 调度表（17-§2 列集照落；权威源=公司目录定时岗配置 D9，本表为其持久化投影，
      //   热更时 upsert 单岗、不动他岗——18-§三）。列语义与拟稿点：
      //   - cron：表达式文本原样存，解析归 core 后续单（18-§三 croner 只在 daemon 侧引，store 不依赖）；
      //   - budget_cap 存 REAL（USD）——自选口径：对齐 contract Money{usd:number}（ports/company.ts
      //     ScheduledJob.budget_cap）与库内既有 cost_usd/estimated_usd/actual_usd 全 REAL 的货币口径，
      //     一库一种货币单位；INTEGER 微美分方案弃用（单位混用比 REAL 等值比较危害更大，且 jobs 表
      //     不在 events JSONL 派生路径上，无 F2-11 字节确定性强约束）；
      //   - payload：JSON 文本（写入前 JSON.stringify，读出 JSON.parse——坏列如实报 CONFIG_INVALID）；
      //   - next_run_at/last_run_at：epoch ms；last_run_at 可空=从未跑过（18-§三 运行时状态）；
      //   - status 可空：值域 v0 不锁（active/paused 等语义归 core 调度域后续单收口，store 不猜枚举）。
      'CREATE TABLE jobs (',
      '  job_id TEXT PRIMARY KEY,',
      '  company TEXT NOT NULL,',
      '  dept TEXT NOT NULL,',
      '  cron TEXT NOT NULL,',
      '  role TEXT NOT NULL,',
      '  level INTEGER NOT NULL,',
      '  model_tier TEXT NOT NULL,',
      '  budget_cap REAL,',
      '  payload TEXT,',
      '  next_run_at INTEGER NOT NULL,',
      '  last_run_at INTEGER,',
      '  status TEXT',
      ');',
      // 补跑扫描索引：daemon 启动/每拍扫 next_run_at <= now 的槽位（18-§三 错过补跑 coalesce）
      'CREATE INDEX idx_jobs_next_run_at ON jobs (next_run_at);',
      // 公司维度索引：按 company 拉一司全部定时岗（挂载/热更/面板 v0.3 jobs 视图）
      'CREATE INDEX idx_jobs_company ON jobs (company);',
      '',
    ].join('\n'),
  },
  {
    version: 4,
    name: 'v0.5 吸收：daemon_kv 表接管（daemon 游标/tick.seq 持久化的正式家）',
    sql: [
      // daemon_kv：daemon 进程级键值持久化（活动流游标 activity.cursor / 拍序 tick.seq——17-§2）。
      // **接管关系**：本表此前由 daemon 在台账库自建（apps/daemon/src/engine.ts 的 KV_TABLE_SQL，
      // 引擎头注拟稿已预告「store 升 kv 表后迁移」）。本 DDL 与 daemon 现行 SQL **字节级一致**
      // （同为 CREATE TABLE IF NOT EXISTS、列体同为 `key TEXT PRIMARY KEY, value TEXT NOT NULL`）：
      //   - 存量库（daemon 已自建表并落游标/拍序）升 v4：本 DDL 无操作，表与数据原样接管；
      //   - v4 新库再遇 daemon 现行自建句：同为 IF NOT EXISTS，天然幂等共存，无双建无报错。
      // 切换路径：daemon 后续单改用 Ledger.kvGet/kvSet（ledger.ts v4 读写面），删除引擎内
      // 自建 DDL 与 prepared 语句即可；本表不删不迁，数据原地续用。
      // value 允空串：daemon 以 '' 为「游标 null」的持久形态（kv 列 NOT NULL，回读须还原 null）。
      'CREATE TABLE IF NOT EXISTS daemon_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
      '',
    ].join('\n'),
  },
  {
    version: 5,
    name: 'v0.10 进化管线：candidates 候选制品表（17-§3 / core evolution 首刀 / 02-F3）',
    sql: [
      // candidates：进化管线候选制品谱系（17-§3「id, 资产类型, version, diff_hash, blast_radius,
      //   验证结果, 谱系父 id, 状态」+ asset_path / created_at，列名逐列对齐 core CandidateRecord
      //   ——core evolution.ts 头注「store 建表时以此为准」；与 17-§3/任务草案的形状差异取舍
      //   见 records.ts v5 段与 test 一致性用例）：
      //   - asset_type（列名取 core 字段名，非草案的 asset_kind——行↔记录零改名，漂移面最小）；
      //   - asset_path（17-§3 未列；core 首刀裁定加入——判负面「生产改动按 (asset_path,
      //     diff_hash) 匹配授权态」的机制需要，纯 diff 会把改动授权给任意同内容资产）；
      //   - version TEXT（core CandidateRecord.version 为 string——「v0.3」类版本号可往返；
      //     core 形状闸校验非空串，INTEGER 列既容不下语义也回读不出原串）；
      //   - verification：JSON 文本快照（core 的 GateEvidence 序列化；同 jobs.payload 口径，
      //     读写面 JSON 往返）。可空=draft 期未跑沙箱（core：进 gated 前必须非 null）；
      //   - parent_id 可空=初代（core：null 显式标记）；无 FK——软引用，存在性/成环闸在
      //     写面（insertCandidate 应用层检查，容忍按序重建的插入顺序）；
      //   - created_at INTEGER（epoch ms）：超出 core 记录形状的库侧列（台账表惯例，daemon
      //     供时钟——core 零 Date.now）；CandidateRow = core 形状 + 本列，一致性测试钉死。
      // 幂等键 = (asset_path, diff_hash) 且非终态（core 拟稿裁定）：终态（rejected/retired）
      // 命中放行新建=换代重提；谱系父不可变（fork-only）。三索引即三查询面：
      //   幂等查 (asset_path, diff_hash) / 谱系查 (parent_id) / 判负查 active 集 (status)。
      'CREATE TABLE candidates (',
      '  id TEXT PRIMARY KEY,',
      '  asset_type TEXT NOT NULL,',
      '  asset_path TEXT NOT NULL,',
      '  version TEXT NOT NULL,',
      '  diff_hash TEXT NOT NULL,',
      '  blast_radius TEXT NOT NULL,',
      '  verification TEXT,',
      '  parent_id TEXT,',
      '  status TEXT NOT NULL,',
      '  created_at INTEGER NOT NULL',
      ');',
      'CREATE INDEX idx_candidates_asset_path_diff_hash ON candidates (asset_path, diff_hash);',
      'CREATE INDEX idx_candidates_parent_id ON candidates (parent_id);',
      'CREATE INDEX idx_candidates_status ON candidates (status);',
      '',
    ].join('\n'),
  },
  {
    version: 6,
    name: 'v0.11 报表三表：ledgers / reports / probes_runs（17-§3 / docs/50 断链6 收口）',
    sql: [
      // ledgers：单据派生（17-§3「issue, kind(task/progress), body(json), updated」；权威源=单据，
      //   本表为派生镜像——可由单据重建，故 upsert 覆盖写，非 append-only）。拟稿点：
      //   - 复合主键 (issue, kind)：同单双面（task 面/progress 面）各一行——17-§3 未言明主键，
      //     此为最自然键（issue 单列不唯一，kind 亦然）；
      //   - body：JSON 文本（读写面 JSON 往返——同 jobs.payload 口径，形状不猜，归上游单据）；
      //   - updated：epoch ms（同 ticket_mirror.updated 口径）。
      // 注：表名 ledgers 与库句柄类型 Ledger 同名异义——表名 17-§3 冻结，记录名取
      //   LedgerEntryRecord 避撞（records.ts）。
      'CREATE TABLE ledgers (',
      '  issue TEXT NOT NULL,',
      '  kind TEXT NOT NULL,',
      '  body TEXT NOT NULL,',
      '  updated INTEGER NOT NULL,',
      '  PRIMARY KEY (issue, kind)',
      ');',
      // reports：报表快照（17-§3「id, company, node, type, date, 口径版本, json_ref」）。
      //   拟稿点：
      //   - 口径版本列名 caliber（17-§3 中文列名英文化；值如 monthly/v1——语义=指标口径
      //     版本戳，聚合口径变更时换值，读面可辨新旧不可比）；
      //   - json_ref：公司目录相对路径 → 报表 JSON 快照文件（F2-03 结果体分离：库行存引用，
      //     大正文留文件——文件本身由定时岗产出到公司目录 reports/ 约定，04-§三）；
      //   - 自然键 (company, node, type, date) 唯一——04-§三「网页按 {node}/{date}-{type}
      //     约定直接渲染」的机制化；重算覆盖换代（最新快照胜，历史在文件与 REPORT_* 事件）；
      //   - node：报表节点（公司级=公司 slug；部门级=部门 path；人级=工号——04-§三逐级聚合）；
      //   - type 值域 daily/weekly/monthly（04-§三 front-matter type 同源；闸在 records.ts）；
      //   - date：归属期锚日 YYYY-MM-DD（月报=当月末日 UTC——由期键派生，非生成时刻）。
      'CREATE TABLE reports (',
      '  id TEXT PRIMARY KEY,',
      '  company TEXT NOT NULL,',
      '  node TEXT NOT NULL,',
      '  type TEXT NOT NULL,',
      '  date TEXT NOT NULL,',
      '  caliber TEXT NOT NULL,',
      '  json_ref TEXT NOT NULL',
      ');',
      'CREATE UNIQUE INDEX idx_reports_natural ON reports (company, node, type, date);',
      'CREATE INDEX idx_reports_company ON reports (company);',
      // probes_runs：探针跑分（17-§3「executor, model, probe_id, pass, cost, duration, ts」）。
      //   拟稿点：
      //   - id 主键：17-§3 未列，库侧加入（append-only 幂等回填需要唯一键——events/work_records
      //     同款非空串，不锁 ULID）；
      //   - cost→cost_usd、duration→duration_ms 列名对齐库内货币/时延口径（events 先例）；
      //   - pass 存 INTEGER 0/1（行↔记录布尔往返）；
      //   - append-only 机制保证：行级触发器拦 UPDATE/DELETE（personnel_events 同款；跑分是
      //     已发生的事实记录，改写即篡改证据）。
      'CREATE TABLE probes_runs (',
      '  id TEXT PRIMARY KEY,',
      '  executor TEXT NOT NULL,',
      '  model TEXT NOT NULL,',
      '  probe_id TEXT NOT NULL,',
      '  pass INTEGER NOT NULL,',
      '  cost_usd REAL,',
      '  duration_ms INTEGER,',
      '  ts INTEGER NOT NULL',
      ');',
      'CREATE INDEX idx_probes_runs_executor ON probes_runs (executor);',
      'CREATE INDEX idx_probes_runs_probe_ts ON probes_runs (probe_id, ts);',
      "CREATE TRIGGER trg_probes_runs_no_update BEFORE UPDATE ON probes_runs BEGIN",
      "  SELECT RAISE(ABORT, 'probes_runs 为 append-only（17-§3）：UPDATE 被拒');",
      'END;',
      "CREATE TRIGGER trg_probes_runs_no_delete BEFORE DELETE ON probes_runs BEGIN",
      "  SELECT RAISE(ABORT, 'probes_runs 为 append-only（17-§3）：DELETE 被拒');",
      'END;',
      '',
    ].join('\n'),
  },
  {
    // v7：DEV-48 人事同步器任务队列（docs/52-§11 DDL 拟稿 + 实现单补强）：
    //   - hr_sync_log=同步任务账（可流转）——与 personnel_events（人事事实账，append-only）
    //     语义不同，**不加 UPDATE/DELETE 触发器**（§11 行注明示：status 机流转合法）；
    //   - id=ULID（appendEvent 同族生成口径）；op_key=幂等键（person+kind+platform+字段+
    //     prev/next 目标值维——52-§11「person+kind+字段维度」的补强，跨批次重放安全由
    //     执行器目标态收敛语义保证）；
    //   - ticket NOT NULL：挂单号（apply 段入队时可为哨兵 @hr:<batchId>——补单在相位尾
    //     消化器完成，D7 自动补开人事对账单；§5.2/§9.1 张力的实现取位，plan 留痕）；
    //   - payload：变动明细 JSON（field/prev/next+目标态关键字段——执行器不回查目录，
    //     幂等收敛所需；形状闸在 records.ts HrSyncPayloadSchema）；
    //   - 拟稿点（52-§11 未列，实现单补）：payload 列。status 值域四态照 §11 DDL 注释
    //     冻结（pending|applying|done|failed）：失败达限（重试 N 次）→ failed 终态 +
    //     ESCALATE（断路形状借用 docs/17-§6，不自动开 bug 单——§9.2）；唤醒走
    //     releaseHrSyncFailed 显式面（人工/对账岗），不发明第五态。
    version: 7,
    name: 'v0.12 DEV-48 人事同步任务队列：hr_sync_log（docs/52-§11）',
    sql: [
      'CREATE TABLE hr_sync_log (',
      '  id TEXT PRIMARY KEY,',
      '  ts INTEGER NOT NULL,',
      '  company TEXT NOT NULL,',
      '  person_id TEXT NOT NULL,',
      '  kind TEXT NOT NULL,',
      "  platform TEXT NOT NULL,             -- 'taiga' | 'matrix' | 'ledger'（52-§四.1 三面）",
      '  op_key TEXT NOT NULL,',
      '  ticket TEXT NOT NULL,',
      "  status TEXT NOT NULL DEFAULT 'pending',  -- pending|applying|done|failed（52-§11）",
      '  attempts INTEGER NOT NULL DEFAULT 0,',
      '  last_error TEXT,',
      '  payload TEXT,',
      '  updated INTEGER NOT NULL',
      ');',
      'CREATE INDEX idx_hr_sync_log_pending ON hr_sync_log (status, updated);',
      'CREATE INDEX idx_hr_sync_log_op_key ON hr_sync_log (op_key);',
      '',
    ].join('\n'),
  },
  {
    // v8：132-A 成本契约刀（studio-dev-168，132-§6.1 单A·制作人 2026-10-22 全批）：
    //   work_records 增 `model TEXT` 列——收割 ResultStats.model（归一形 `provider/model`，
    //   如 `glm/GLM-5.3`）的落账位，后续 usage_daily/price_snapshots（单B/单C）的桥接键。
    //   - 加列走批示（17-§3 纪律）：studio-dev-132 提案（§10「本提案即批示载体」）为载体；
    //   - 可空无默认：model 归一形非空串（写面闸 records.ts），无从可知（旧执行/部署未
    //     声明 profile 模型）=NULL——如实缺省，不猜；
    //   - events 列集冻结不动（F2-04）：模型留痕走本列+GATE_PASS note 后缀 `model=…`；
    //   - 拟稿偏差申报：132-§6.1/§10 写「store 迁移 v9」系提案期对 A-E 五单合计的投影
    //     序号；本仓 LATEST_VERSION=7 且本文件头注冻结「version 单调 +1」——本刀取 v8
    //     （跨号即破纪律；后续单依合入序顺取 v9+）。
    //   ALTER 加列（非重建）：SQLite 追加尾列，存量 85 行不动，读写面（ledger.ts）同步扩。
    version: 8,
    name: '132-A 成本契约刀：work_records.model 列（studio-dev-168）',
    sql: [
      'ALTER TABLE work_records ADD COLUMN model TEXT;',
      '',
    ].join('\n'),
  },
]

/** 内置迁移的最高版本（0 = 无迁移可用，仅占位防呆） */
export const LATEST_VERSION: number = MIGRATIONS.length > 0 ? MIGRATIONS[MIGRATIONS.length - 1]!.version : 0

/** sha8：迁移 SQL 的 sha256 前 8 个 hex 字符（17-§3 schema_version.sha8 口径） */
function sha8(sql: string): string {
  return createHash('sha256').update(sql).digest('hex').slice(0, 8)
}

/**
 * 迁移应用：幂等（已应用版本跳过），逐版本单事务，sha8 漂移即 CONFIG_INVALID。
 * options.upTo：只应用到该版本为止（**测试构造历史版本库用**——升级路径演习的前提；
 * 生产调用不传）。越界（<1 或 >LATEST_VERSION）即 CONFIG_INVALID。
 */
export function migrate(db: DatabaseSync, options?: { upTo?: number }): number {
  const upTo = options?.upTo
  if (upTo !== undefined && (upTo < 1 || upTo > LATEST_VERSION)) {
    configInvalid('store/migration:bad-up-to', `upTo=${String(upTo)} 越界（1..${LATEST_VERSION}）`)
  }
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, sha8 TEXT NOT NULL)',
  )
  const applied = new Map<number, string>()
  for (const row of db.prepare('SELECT version, sha8 FROM schema_version').all() as Array<{ version: unknown; sha8: unknown }>) {
    applied.set(Number(row.version), String(row.sha8))
  }
  for (const m of MIGRATIONS) {
    if (upTo !== undefined && m.version > upTo) break
    const recorded = applied.get(m.version)
    if (recorded === undefined) {
      db.exec('BEGIN')
      try {
        db.exec(m.sql)
        db.prepare('INSERT INTO schema_version (version, applied_at, sha8) VALUES (?, ?, ?)').run(
          m.version,
          Date.now(),
          sha8(m.sql),
        )
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    } else if (recorded !== sha8(m.sql)) {
      // 防漂移：库内记录与内置脚本同版本不同内容（篡改 / 新旧代码混用）
      configInvalid(
        'store/migration:sha8-mismatch',
        `schema_version 记录的 v${m.version} sha8=${recorded} 与内置脚本 sha8=${sha8(m.sql)} 不一致`,
      )
    }
  }
  return currentVersion(db)
}

/** 当前已应用版本（0 = 尚无任何迁移记录） */
export function currentVersion(db: DatabaseSync): number {
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: unknown } | undefined
  if (row === undefined || row.v === null || row.v === undefined) return 0
  return Number(row.v)
}
