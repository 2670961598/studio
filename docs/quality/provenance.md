# Airlock provenance（A+C phase1；observe-only）

> 依据：Airlock provenance 设计（A=只读派生 provenance 图；C=告警影响分析），制作人 2026-11-13 批；
> 原则：**不建第五事实源、不自动隔离/不自动动作**；三事实源不变（Taiga 流程 / 公司 git / SQLite 台账）。
> 事件台账事实源引用 `docs/17-§3`；只读指标范式同 `qa-report`/`qa-eval`。

## 1. 图模型（内存派生，不新增存储/表/事件词）

- **节点**：`ticket` / `person` / `dept` / `executor` / `attempt` / `session` / `artifact` / `commit` /
  `alert` / `audit` / `model` / `price`（price/model 只读展示）。
- **事件默认不作节点**：事件只作边的证据，边字段 `sourceEventId`/`time`/`confidence`
  （`direct`=直接数据、`inferred`=表关联/歧义、`gap`=缺失/不可判）。
- **边来源**：`DISPATCH`→ticket→person/executor/attempt/dept；`GATE_PASS/FAIL`、`QA_PASS/QA_BACK`、
  `STALL/RESUME`→attempt；`MERGE`→commit/branch；`CLOSE`→终态；`ESCALATE/DAILY_ALARM/
  COST_RECON_ESCALATE`→alert→ticket/person/dept；`REPORT_MISSING/HARVEST_*`→artifact gap；
  `ORG_UPGRADE/COMPANY_COMMIT/SCHEMA_EVOLVE/QA_BACK/HR_GATE`→audit；`work_records`→person/
  executor/session/attempt/model/report_ref；`sessions`→session/ticket/person；`ticket_mirror`→
  ticket/dept/level/state/lane；`price_snapshots`→model/price。
- 数据源全部只读：`events`/`work_records`/`sessions`/`ticket_mirror`/`price_snapshots`。

## 2. 命令

```sh
# 单票全链路（draft→attempt→artifact→merge/close + 审计/告警）
studio-next provenance trace <ticket> --db <ledger.sqlite> --company <slug> [--out-dir <目录>] [--depth N]

# 告警/单票影响面（≤2 跳；direct/inferred/gap + 缺口 + 时间窗）
studio-next provenance impact --from <ticket|eventId|alertId> --db <ledger.sqlite> --company <slug> \
  [--since YYYY-MM-DD|epochMs] [--until …] [--depth N] [--out-dir <目录>]
```

- 输出：`<companyDir>/var/reports/provenance/prov-trace-<ticket>.json|.md`、
  `prov-impact-<name>.json|.md`（不写公司 git 树）；JSON=`prov-trace/v1`/`prov-impact/v1`（可重建），
  MD 结论先行。原子写 tmp→rename、幂等同字节、失败零输出（旧报告先备份/失败还原）。
- 空图/未知 `--from` **exit 0 空形状**（observe-only）；坏参数/坏库 exit≠0。
- 只读：`node:sqlite DatabaseSync({readOnly:true})` 仅 SELECT（不 `openLedger`）；不写台账/事件/单据/
  schema、不接主循环、不触发任何动作（不隔离/不重派/不改单）、不外发。

## 3. 影响分析口径

- 输入（从台账读出）：`DAILY_ALARM` / `GATE_FAIL` / `ESCALATE` / `COST_RECON_ESCALATE` / 审计事件；
- 输出：受影响 `tickets/persons/depts/artifacts/sessions/commits/alerts`、时间窗、`confidence`
  （direct=1 跳 / inferred=2 跳 / gap=缺失边）、缺口清单；
- **只给观察结论**，不回答因果、不做处置；`coverage`/`gap` 明示数据完整度限制。

## 4. 脱敏与安全

- `note` 仅按白名单 token 解析（`src/category/model/job/report/summary/sha/branch/target/person/
  executor/alert/event/commit`），**不输出 note 原文**；
- 所有标签经 `sanitizeLabel`：去绝对路径取 basename、去凭据样式、长串替换 `<redacted>`、截 80；
- artifact 只留 basename+`payload_hash` 前 12 位；commit sha 只留 12 位；
- 不把 events 原文/路径/凭据写入 JSON/MD。

## 5. 限制（phase1）

- 派生图受数据完整度限制：`work_records` 无 company 列（按 ticket 集代理）、旧事件缺
  attempt/session、artifact 只到 ref 层 → 报告标 gap/coverage，不冒充完整因果。
- 影响面最多 2 跳；不自动扩大传播/不做时间序列推断；golden/因果推断后置。
- 事件默认不作节点（需要时查 `--from <eventId>` 的 alert 节点/边证据）；price/model 只读展示。
- 会话/时钟口径沿台账原值；本命令无 wall-clock 字段（幂等同字节）。
