# 81-files/16 · daemon 引擎域逐文件契约

> 版本：v0.3.1（按最新 80-§6.3/§6.6/§6.9/§9.4 与 77-§4 小范围补漏），2026-10-27。v0.3.1：① 给 `apps/daemon/src/engine/tools/effect-gateway.ts` 分配 `F-DAEMON-ENGINE-TOOLS-EFFECT-GATEWAY`（80-§6.9 `EFF-01` 的**外层编排家**；流水线等行为契约在 `81-files/06-gateway.md` 的 `EffectGateway` 行为契约，本卷只写文件级契约、函数表与装配边界，不复制第二份行为契约、也不以 `EffectGateway` 行为契约 冒充 daemon 文件 ID），并给 `test/engine/tools/effect-gateway.test.ts` 分配 `F-DAEMON-ENGINE-TEST-TOOLS-EFFECT-GATEWAY`；目标源码件 38 → **39**（68 + 39 = 107）、目标测试 38 → **39**（60 + 39 = 99 个 `*.test.ts` + 1 夹具 = 100），域平面仍 13。② 按 80-§6.3 把 `resourceLedger`（物理表 `resource_ledger`）记为**已登记的目标投影名**（目标第 18 个，随 MIG-01 建表），U81-23 由「名字未定」改为「名字已登记、实现未做」。③ 补 API 路由 **16 条**（旧稿 15 条作废）与 M4 **11 项**（第 11 项＝回执查询端点）的引用口径。④ `SEC-MX-BOT-PASSWORD` 只作登录、`SEC-MX-HR-SHARED` 只作建号（80-§11.2.1/U80-18），两值不得互换用途。v0.3 新增 §4.12：给 38 个目标源码件（12 个职责拆分 + 26 个 80 端口落点）分配唯一 `F-DAEMON-ENGINE-*` 并各写完整逐文件契约；按 80-§6.9 把每个 PUBLIC 端口的实现家落定（类型在 `contract`、纯求值在 `core`、SQL 在 `store`、编排在 daemon）；按 80-§6.6 规则 7-9 收口 `IntentReceiptStore` 形状与启动序（§4.10.4）；按 77-§4 校准 13 字段开工判断、`judgeRole` 五门、`resource_baseline` 与计划锁的 `resource_reservations`；登记 82-GAP-01/05 的 engine 侧关闭（§11.3）。v0.1 为初稿；v0.2 按 80 的 `ClassifiedError` 两轴、`TS-PORT-WORK-01`/`API-01`（意图与回执）、`PlatformBindingPort`/`StateMapping`、`SecretProvider`/`KnownSecretSet`、`Notifier`/`NotificationEnvelope`、`RecordReader`/`ReadOnlyLedger`/`TxReceipt`/`MigrationPlan`，以及 78 的 `BIND-CORE-01` 与 §7.4.1 逐项校正；**只改本文件**，不新增公共概念、不改仓内代码。
> 性质：**自然语言级文件与实现设计呈审稿**，不是现行完成证明、不是实现单。
> 上位：75-§五 逐文件模板；76 的公共语义；77-§4.0–§4.10（意图→受理→合同→计划锁→五门→出工）；78 的 `BIND-CORE-01`/§7.4.1；79 的 TS 工程纪律；80 的运行时与公共接口（尤其 §2.2/§2.3 层位与允许边、§3 入口与配置、§5.7 错误、§6.4 十一 WORK 端口、§6.6/§6.7 其余端口与 `IntentReceiptStore` 规则 1-10、§6.9 端口实现落点表、§7.2 相位 2 顺序、§8 事务与恢复、§10.2/§10.3 结构债、§11 秘密与 stdio）。
> 范围：`apps/daemon/src/engine/**`（实测 68 件；目标 107 件，逐件见 §4.12/§2.3）、`apps/daemon/test/engine/**`（实测 60 个 `*.test.ts` + 1 夹具；目标 99 + 1，逐件见 §4.11），以及该域**直接消费**的配置键与注入面。另在 §4.10 登记五个**跨域接缝目标件**（`contract`/`core`/`assembly` 各件）：本卷只写引擎侧所依契约与调用边界，文件归属与 F-ID 归 01/02/17 卷，本卷不与其争用编号。
> 边界：本附录只把 80 已定义的组件与接口落到文件，**不新增公共概念、端口、状态、允许边、依赖版本或阈值**；发现缺口回写主卷或登记未证项（§11），不在此私补。**不新增 R/E/W/V 编号**，只引用 77/80 既有语义。
> 门禁：本卷所有「目标/拆分/新增」均为设计处置，尚未执行；不得据此直接改生产代码、manifest 或 `scripts/guards/`。
> **本卷零测试运行**：以下一切「现有/可用」均指源码与调用链存在且有测试件引用，不代表本次运行过 `bun run test`。真机与整机证据归 82。

---

## 〇、本附录口径

### 0.1 状态标签（沿用 81-§四，不混写）

| 标签 | 本卷用法 |
|---|---|
| **现有** | 文件存在、导出与调用链已核；只描述实际代码，不扩张能力 |
| **库级/未接** | 导出存在但生产链未接或没有运行证据（如 `judge` 多数址、`mergeRun` 真单刀、真 Taiga 面） |
| **目标-保留** | 现职责进入目标结构，内部可改 |
| **目标-拆分** | 现职责拆到多个目标文件，旧文件留 facade 或退役 |
| **目标-新增** | 目标文件，须给上位语义与完整契约（本卷 **39** 个目标源码件见 §4.12：12 个职责拆分 + 27 个 80 端口落点；另有 §4.10 五组跨域接缝件，以 `S-ENGINE-*` 登记） |
| **仅测试/演示** | fake、夹具、受控注入缝；**不得转生产、不得当能力证据** |
| **未证** | 无探针或无运行证据；必须给负向结果与拒绝路径 |

### 0.2 ID 与证据约定

- 文件稳定 ID：`F-DAEMON-ENGINE-<名称>`（75-§2.1 的 `F-<包>-<名称>`；路径变更不改 ID，拆分后**一新一 ID，不复用**）。与 80 的 `TS-PORT-*`、78 的 `BIND-*`、77 的 `RUN-*`/`REC-*` 不同轴，不得互相顶替。
- **跨域接缝件不用 F-ID**：§4.10 的五个件以 `S-ENGINE-<名称>` 登记（`S-` = seam，非文件 ID），只表达“引擎域依赖它到什么程度、边界在哪”；其 F-ID 由 01/02/17 卷落定，本卷不占号、不复制字段表。
- 每条断言给 `path:line` 锚。行数/计数一律标「实测」并注明口径：2026-10-27 `wc -l` / `find ... | wc -l`。**唯一例外**：§4.12 的 39 个目标件**不存在**，只给目标路径 + 上位章节号，**不编造行号**。
- 复算命令（现有计数由它得出，读者可自行复核）：

```text
find apps/daemon/src/engine -name '*.ts' | wc -l                       # 68
find apps/daemon/test/engine -name '*.test.ts' | wc -l                 # 60
find apps/daemon/test/engine -mindepth 1 -maxdepth 1 -type f | wc -l   # 25（24 测试 + 1 夹具）
find apps/daemon/src/engine -mindepth 1 -maxdepth 1 -type f | wc -l    # 13（域平面）
find apps/daemon/src/engine -mindepth 1 -maxdepth 1 -type d | wc -l    # 19 子域
find apps/daemon/test/engine -mindepth 1 -maxdepth 1 -type d | wc -l   # 16 子域
wc -l $(find apps/daemon/src/engine -name '*.ts') | tail -1            # 15476 total
find apps/daemon/src/engine apps/daemon/test/engine -type f ! -name '*.ts'   # 0
```

- **目标计数是同一条命令的算术推演，不是仓库事实**（目标文件尚不存在）：源码 `68 + 39 = 107`（39 = 12 个职责拆分 + 27 个 80 端口落点，逐件见 §4.12）；测试 `60 + 39 = 99` 个 `*.test.ts` + 1 夹具 = 100 件；域平面仍 13（新件全进子域；`tools/` 是既有子域，2 → 3 件）；子域目录 `19 + 9 = 28`（新增 `tick/`、`dispatch/`、`breaker/`、`decision/`、`work/`、`obligations/`、`lifecycle/`、`memory/`、`observe/`；`harvest/` 已存在并由 2 件长到 11 件）；测试子域目录 `16 + 12 = 28`（新增 `tick/`、`dispatch/`、`breaker/`、`harvest/`、`intents/`、`decision/`、`work/`、`obligations/`、`lifecycle/`、`memory/`、`observe/`、`tools/`——现有 16 个子域名里**没有这 12 个**（`ls -d apps/daemon/test/engine/*/` 可复核）；`harvest/`、`intents/` 两域的现有覆盖分散在直下 e2e、`wake/`、`notify/` 与 `test/assembly/inflight-takeover.test.ts`，无同名子域；直下已顶格，故新测试只能新建子域）。逐件清单见 §2.3、§4.10、§4.11、§4.12，计数可自上表复算。
- 配置键只收本域**直接消费**的（`EngineConfig`、`EngineDeps`、`MergeRunDeps`、`JudgeDeps`、`CostCloseDeps`、`HrSyncDeps` 等注入面）。`apps/daemon/package.json`、`apps/daemon/tsconfig.json`、`daemon.yaml` 全量装载归 **17** 与 **79**，本卷只在「出口/门禁」处引用。
- 不复制 76/77 的字段表。凡涉及记录字段，写「承载哪个对象 + 对应 `REC-*`/`RUN-*` + 章节号」，避免双源。

### 0.3 本卷不含

`apps/daemon/src/assembly/**`、`apps/daemon/src/{cli,control,evolve}/**`、`apps/daemon/src/index.ts`、`packages/*` 内的实现均**不属本卷**，只在「调用方/接缝」位置引用路径；§4.10 是唯一例外，且只给引擎侧边界，不接管其文件契约。`test/engine` 之外的测试同理由 17/其余附录承担。

### 0.4 本卷遵循的统一接口（与 v0.1 的差异总表）

v0.1 里与下列定稿冲突的写法一律作废；本卷其余章节按此重写，不再逐处注“旧稿”。

| # | 定稿接口 | 本卷约束 |
|---|---|---|
| 1 | `RuleEvaluator.typecheck` 与 `evaluate` 分开；`evaluate` 返回 `Result<RuleOutcome, ClassifiedError>`，`outcome` 四值 `true/false/unknown/refused` 含 `profileRef`/`inputsDigest`/`steps`/`limitsApplied`/`diagnostics` | 引擎只消费结果；`refused` 留在 `Ok`，按“拒绝路径”处理，**不得**读成 `false`；类型错误在 `typecheck` 即 `Err`，不进 `evaluate`（80-§6.1） |
| 2 | `ClassifiedError = { failure, category, subcause, detail? }`；`failure` 是 77 的 14 类处置轴，`category` 是 11 类观测轴；`Err` 可达 `category` 仅 6 个；构造期固定 `rejected_precondition` + `CONFIG_INVALID`；HTTP 错误体 `{error:{failure,category,subcause},traceId}` | 本域所有拒绝、报告错误、HTTP 邻接面按此；§7 重写；`TickReport.errors` 目标为 `ClassifiedError[]` |
| 3 | `WorkIntake.reserve` 先写 `REC-WORK-01`；`IntentIngress.submit` 再调 `engine.ingest`；ingress 不写 `REC-WORK-01/02`、不另开写口；`intent_receipts` 是可重建投影；`intentRef` 在 reserve 即得；回执 `outcome` 五值标量、`status=queued\|decided\|unknown`；`IntentKey` 第四位 `ticket ?? dedupKey` | §3.2/§4.3/§4.10/§5/§6 按此；引擎 `ingest` 只入内存队列，**不产生记录**；回执投影不归引擎写 |
| 4 | `assembleApi(deps:{ ingress: Pick<IntentIngress,'submit'\|'receipt'>; ledgerPath; company; config })`；不收 `engine`；`emitIntent`/`getIntentReceipt` 是 `IntentSubmissionPort` 的装配实现；`openLedgerReadonly(path, expectedSchemaVersion)` 跳过 WAL/synchronous，schema 不符 `rejected_version`/`EVOLVE_REJECT`，库缺 `unavailable` | 只作接缝（§4.10/§9）；引擎不得被 API 装配持有，也不得被 `assembleApi` 直调 `ingest` |
| 5 | `BindingProfile` 按 78-`BIND-CORE-01` 20 字段；`StateMapping.verification='verified'\|'unverified'`、`unmappedBehavior:'observe-unmapped'`；未映射但合法平台状态 = `Ok({verification:'unverified',workStates:[]})` + `REC-OBS-02`，原值保留；空/畸形才 `Err(rejected_precondition)`；`workStates=[]` 禁止迁移/验收/结清 | §4.3 哨兵、§4.7 判读、§9 接缝按此；**不再写**“未知状态默认 `Err(unsupported)`” |
| 6 | 秘密：`secretId=SEC-<域>-<slug>`；`SecretKind` 五值；`SecretUse` 六值；`subjectScope` 结构化；`valueProvider` 四型；`load(entry,use)`；`use ∉ allowedUses` = `rejected_forbidden`；`SecretMaterial.version` 为不透明内容代次；`KnownSecretSet.state` 三值；装配先按 `subjectScope` 过滤；per-ticket wkey 为 `local-mint` 例外且 `CLOSE` 移除；worker 不拿 `gatewaySecret`；`secrets.ts` 迁 `contract`，`core` 只具名 re-export | §4.2 `worker-key`、§8、§9、§10 按此；本域不 `load` 秘密、不持有明文 |
| 7 | stdio：daemon 侧验签；stdout 只 JSON-RPC、日志 stderr；per-ticket env 优先、`_meta` 仅 legacy；helper 先注册；socket `run/daemon.sock` 或 `STUDIO_DAEMON_SOCK`；未注册一律 `deny`；stdio 只是传输层，worker 内存 nonce 不防重放；未实现 = 未证 | §4.2、§4.9、§11 按此；**不写**“方案未定”，写“未实现、未证” |
| 8 | `Notification` 保持 contract 现有 `{kind,title,body,from?:string,links?}`；投递封装 `NotificationEnvelope`；`titleKey`/`bodyKey` 只作 matrix 静态表可选本地化键；`NotifySendReport` 与 `broadcast.ts` 一致 | §4.6 通知组按此；`from` 不得改成对象 |
| 9 | `mapState`/`BindingProfile`/`IntentReceiptStore`/`secret.ts`/`effects.ts` 已在 80 有定义；`ProjectionName` 含 `intentReceipts`、`observation` 与**已登记的目标名 `resourceLedger`**（物理表 `resource_ledger`，80-§6.3）；`RecordReader.query`/`ReadOnlyLedger.query` 返回 `{items,nextCursor}`；`TxReceipt` abort 返回回执、`unknown` 由 `receipt(txId)`/`REC-06` 对账；`MigrationPlan` 的 artifact 引用为 `string`（非 qid）、action kind 封闭联合、`planDigest` 不含 artifact 引用 | §5/§6/§9 按此；不保留“没有类型落点”的旧缺口 |
| 10 | `repo-validate` 留 `company`；五门纯求值在 `core/src/work-readiness.ts`；`decide` 只保留并发四闸 + 断路器；通用类型用真实名 `MergeRunHost`；fakes 只许 demo/test；`Money.usd:number` 只作内存/旧记录，公共金额用 `DecimalString` + 币种；`sha8` 只展示，身份用完整 `semanticDigest`；UTC 日键与公司本地日分开 | §1.3/§4.1/§4.2/§4.5/§4.8/§5 按此；**删除** `MergeHostView` 与 `U81-01` 的“命名差”说法 |
| 11 | `assembleApi` 的 `external` 配置含 `enabled/port/lan/token/requestsPerMinute/idempotencyTtlMs/allowedSources`；`now` 只作 `BuildRuntimeOpts` 测试注入；`allowedSources` 缺省恰 `['external-api']`，不读 `SourceRegistry` | §9/§4.10 按此；**显式空数组 = `CONFIG_INVALID` 拒启动**（已裁，U81-17 关闭）；`enabled=false` 不读不校验、零行为 |
| 12 | `ReferralTarget={positionRef,deadline,notifiedAt}`，`positionRef` 的 kind 只 `position`/`governance-position`；`IntakeOutcome` 统一用 `outcome`；平台状态 `unknown`（未映射）与 77 异常 `unknown` 不同轴 | §5/§7 按此；不得把两者混成同一状态 |

---

## 一、现状总览

### 1.1 规模与分布（实测）

| 维度 | 实测值 | 说明 |
|---|---|---|
| 引擎源码 | **68 件 / 15476 行** | `apps/daemon/src/engine/**` |
| 源码直下（域平面） | **13 件** | 与 `domainPlaneBaselines.engine=13` 持平（`scripts/guards/boundary-rules.mjs:62`）＝**顶格，只减不增** |
| 源码子域目录 | **19 个**（合计 55 件） | cost-close 1、cost-guard 4、directive 5、harvest 2、hrsync 3、intents 6、jobs 4、judge 6、lanes 1、merge 6、notify 4、pricing 1、rooms 1、sentinel 3、split 3、tick-report 1、tier 1、todoqueue 1、tools 2 |
| 测试件 | **60 个 `*.test.ts` + 1 个夹具** | `test/engine` 直下 25（24 测试 + `crash-points.ts`）、16 个子域目录 36 件 |
| 非 TS 文件 | **0** | 无 JSON/fixture/快照文件；夹具全部内联在测试源码 |
| 超大件 | `engine.ts` **2337** / `merge/merge-run.ts` 582 / `src/sources.ts` 479 / `src/intents/taxonomy.ts` 465 / `fakes.ts` 451 | 仅 `engine.ts` 超 600；其余 <600 |
| 测试超大件 | `scheduler.test.ts` **785** / `sources.test.ts` **768** | 均已在 `lineBaseline`（`boundary-rules.mjs:167`、`:170`），只减不增 |
| **目标源码** | **107 件**（= 68 + 39 新增，0 退役） | 39 件全进子域：职责拆分 12（`tick/` 4、`dispatch/` 2、`breaker/` 2、`harvest/` +4）+ 80 端口落点 27（`work/` 11、`harvest/` +5、`lifecycle/` 4、`decision/` 2、`obligations/` 1、`memory/` 1、`observe/` 1、`notify/` 1、`tools/` 1）；域平面仍 13。逐件见 §4.12 |
| **目标测试** | **99 个 `*.test.ts` + 1 夹具**（= 60 + 39 新增） | 新增测试与原件 1:1 对应，进 `test/engine/{tick,dispatch,breaker,harvest,intents,decision,work,obligations,lifecycle,memory,observe,tools}/`；直下 25 不动（顶格）。逐件见 §4.11 |

`lineBaseline` 中本域共 3 条：`apps/daemon/src/engine/engine.ts: 2337`（`:160`）、`apps/daemon/test/engine/scheduler.test.ts: 785`（`:167`）、`apps/daemon/test/engine/sources.test.ts: 768`（`:170`）。基线值上调或新增条目＝改宪法＝提案流（20-§三.3）。目标态 `engine.ts` 拆完后从基线**除名**（下降不需提案），不得以“新文件仍需基线”换一种方式留在表里。

### 1.2 包依赖面（实测：逐文件 import `@studio-next/*`）

| 依赖包 | 引用本域文件（示例，非全列） | 性质 |
|---|---|---|
| `contract` | 48 件（几乎所有域件） | 类型与常量唯一来源；**不得**在本域复制字段表 |
| `core` | budget-gate、directive/wire、intents、split/materialize、sentinel、tick-report、typeflows、cost-*、hrsync、judge、merge/merge-run、todoqueue、pricing、tier、jobs/freshness | 纯决策：状态机、闸序、断路、预算、定价折叠 |
| `store` | engine.ts、budget-gate、scheduler、cost-*、cost-close、hrsync、intents/drain、jobs/*、judge/*、merge/merge-run、pricing、todoqueue、split/materialize、harvest/inflight-takeover | `Ledger` 端口（唯一台账触点） |
| `adapters` | engine.ts（`ExecutorRegistry` 类型）、judge/invoke（`DshAdapter`/`judgeFamilyOf`）、tier/model-tier、merge/merge-run | executor 原语与能力声明 |
| `prompt` | prompt-assembly | L0–L5 装配（80-§2.3 已更正的 `daemon→prompt` 在用边） |
| `gateway` | worker-key、tools/gated-platform、split/materialize | 凭据签发/吊销；写收口包装器 |
| `company` | jobs-sources、jobs/freshness、jobs/harvest-recon、jobs/output-account | 公司目录/岗定义读取 |
| `taiga` | hrsync/taiga-face（唯一） | 人事执行面真实现 |

零包依赖件（只引 `node:*` 或无 import）：`crash-points.ts`、`directive/{index,parse,qualify,serve-config}.ts`、`gate.ts`、`judge/workspace.ts`、`lanes/registry.ts`、`merge/{default-deps,merge-brief,merge-gate}.ts`、`notify/dedup.ts`、`tools/id.ts`、`typeflows.ts` 之外的少数叶子件。

### 1.3 类型环（实测：全量相对导入图 SCC 扫描）

**扫描口径**：把 `apps/daemon/src/engine/**` 每个 `.ts` 的相对导入（`from './…'` / `'../…'`，`import type`、`import`、`export … from` 一并计）建成有向图，跑 Tarjan 强连通分量。实测结论：**全域只有 1 个强连通分量，含 5 个节点、11 条边，无自环**：

| # | 边（自 → 至） | 锚 | 种类 |
|---|---|---|---|
| 1 | `engine.ts` → `tick-report/types.ts` | `engine.ts:310` | `import type` |
| 2 | `engine.ts` → `tick-report/types.ts`（再出口） | `engine.ts:314` | `export type … from` |
| 3 | `engine.ts` → `merge/merge-run.ts` | `engine.ts:312` | **运行时**（`runMergeAction` 等）＋同行 `type MergeRunDeps/MergeRunHost` |
| 4 | `engine.ts` → `merge/merge-lease.ts` | `engine.ts:313` | **运行时**（`createMergeLeaseRegistry` 等） |
| 5 | `merge/merge-run.ts` → `engine.ts` | `merge-run.ts:84` | `import type { EngineConfig, Inflight }` |
| 6 | `merge/merge-run.ts` → `tick-report/types.ts` | `merge-run.ts:80` | `import type` |
| 7 | `merge/merge-run.ts` → `merge/merge-lease.ts` | `merge-run.ts:86` | **运行时**（`mergeLeaseKey`）＋`type MergeLeaseRegistry` |
| 8 | `merge/merge-run.ts` → `merge/merge-fallback.ts` | `merge-run.ts:87` | **运行时** |
| 9 | `merge/merge-lease.ts` → `engine.ts` | `merge-lease.ts:17` | `import type { Inflight }` |
| 10 | `merge/merge-fallback.ts` → `merge/merge-run.ts` | `merge-fallback.ts:11` | `import type { MergeAction, MergeActionOutcome, MergeRunHost }` |
| 11 | `tick-report/types.ts` → `merge/merge-lease.ts` | `tick-report/types.ts:16` | `import type { MergeQueueFace }` |

**关键判读（与 80-§10.2 一致）**：

1. **没有运行时环**——所有回边（5、6、9、10、11）都是 `import type`，编译后擦除；运行时边只有 3、4、7、8，方向都是 `engine.ts`/`merge-run.ts` 向下。所以这是**类型级环，不致命**，但它卡住 `engine.ts` 拆分：任何从 `engine.ts` 拆出的 `tick/*.ts` 只要 import `Inflight`，就会与 `engine.ts` 形成新环。
2. **环的枢纽是 `Inflight.mergeRun` 的内联类型引用**：`engine.ts:635` 写的是 `mergeRun?: import('./merge/merge-run.ts').MergeRunContext`——用内联 `import()` 绕开顶层 import，正好是环存在的证据与解除点（80-§10.2 的冻结验收命令就用这条）。
3. **`tick-report/types.ts` 是被卷入的第三方**：它只 import 了 `MergeQueueFace` 一个类型（`:16`），因此不是设计上的环源，但修环时必须一并处理（§8.1）。
4. **解环的唯一解是抽 `engine/tick/types.ts` 叶子模块**（目标-新增）。它必须是叶子：只许 import `packages/*` 与 `../merge/merge-gate.ts`（后者是纯端口类型，无回边），不得 import `engine.ts`、`merge-run.ts`、`merge-lease.ts`、`tick-report/types.ts` 中任何一个。80-§10.2 点名的三个类型（`EngineConfig`/`Inflight`/`MergeRunHost`）**不足以成件**：实测符号闭包还包含 `MergeRunDeps`（`merge-run.ts:100`）、`MergeRunContext`（`merge-run.ts:113`，被 `Inflight.mergeRun` 引用）、`MergeLeaseRegistry`（`merge-lease.ts:37`，被 `MergeRunHost.mergeLease` 引用）。只搬三个类型会当场制造 `tick/types ↔ merge-run`、`tick/types ↔ merge-lease` 两条新的二元环。落点口径（§8.1 已定）：
   - `tick/types.ts` 定义 **7 个类型**：`EngineConfig`、`Inflight`、`MergeRunDeps`、`MergeRunContext`、`MergeRunHost`，外加盟约面 `MergeLeaseState`、`MergeLeaseRegistry`（后两个是**纯接口搬移**，不改名，`merge-lease.ts` 从本件 import 后原样再出口）；
   - 为什么必须连租约接口一起搬：`MergeRunHost.mergeLease: MergeLeaseRegistry`，而 `MergeLeaseRegistry` 的文件 `merge-lease.ts` 又 `import type { Inflight } from '../engine.ts'`（`:17`）。只搬 `Inflight` 不搬 `MergeLeaseRegistry`，就得到 `tick/types ↔ merge-lease` 的新环。把两个租约接口放进叶子件后，边只剩单向 `merge-lease → tick/types`；
   - **命名警告**：`merge-lease.ts:80` 已有一个 `MergeLeaseHostFace`（语义是「续租/队列投影的宿主面」，字段 `config/inflight/mergeRun/mergeLease`），与「租约簿结构接口」**不是一回事**。不得复用该名、不得改名、也不得为绕环新造第二个 `*Face` 名字；本卷只做类型搬移；
   - `MergeRunHost.budgetDeps: BudgetGateDeps` 可保留对 `../budget-gate.ts` 的 `import type`——实测 `budget-gate.ts` 只 import `@studio-next/contract`/`core`/`store`，无域内回边；
   - `MergeRunContext`/`MergeRunDeps` 的定义迁到 `tick/types.ts` 后，`merge-run.ts` 改为 `import type { … } from '../tick/types.ts'` 并**原样再出口**（保持 `merge-run.ts:129` 现有外部引用路径不变）。

   **验收命令**（三条全过才算解环）：`rg "import\('\./merge/merge-run" apps/daemon/src/engine` 为空（删除 `engine.ts:635` 内联 `import()`）；`rg "from '\.\./engine\.ts'" apps/daemon/src/engine/merge` 为空；`rg "engine\.ts" apps/daemon/src/engine/tick/types.ts` 为空。设计名 `MergeHostView` **不存在**，任何地方不得再写；旧编号 `U81-01` 作废（命名纠正本身不是未证项，见 §11.1）。

---

## 二、域结构与预算

### 2.1 不可越的四条结构线

1. **域平面 13 只减不增**（20-§十五.四.1；`boundary-rules.mjs:62`）。本域任何新文件只能进既有子域或新建 `<特性>/` 子目录，不得落 `src/engine/` 直下（BC-V3）。
2. **目录 25 件上限**（20-§三.1；`maxFilesPerDirectory=25`）。`test/engine/` 直下已 25 件＝**顶格**：新测试只能进 `test/engine/<子域>/`（81-§3.3 末条同口径）。
3. **文件 600 行上限**（20-§三.2）。`engine.ts` 2337 在基线内，**只减**；目标拆到 facade <600 后从基线除名。
4. **`engine/tools/` 升格阈 10**（20-§十五.五）。现 2 件（`id.ts`、`gated-platform.ts`），累计 >10 ⇒ 升格 `packages/base`（提案流）。当前未触发。

**门禁现状（实测，2026-10-27）**：`node scripts/guards/boundaries.mjs` → `边界门禁 PASS：扫描 627 文件（范围面代码件 499），0 违例`。即上表四条与 §2.2 的方向表在当前树上全部满足；本卷的文档改动不触及该门禁（门禁只扫 `apps/`、`packages/` 代码面）。

### 2.2 层位与允许边

`scripts/guards/boundary-rules.mjs` 实测：`daemonLayers` 中 `engine: 3`、`engine/tools: 2`（`:30`、`:31`）；纵边含 `["engine","engine/tools"]`（`:48`）、`["assembly","engine"]`、`["cli","engine"]`；**无 `["root","engine"]`**（`:55` 的 `daemonSrcRootDirs` 与 root 层位规则共同保证）。故：

- `engine` 可引 `engine/tools` 与全部横轴包（层位 5 的 daemon 允许集）；**同域内互引自由**。
- `engine` **不得**引 `control`/`evolve`（同层三域互引禁止）、`cli`、`assembly`；**不得**被 `root`（`src/index.ts`）引用。
- `engine` **不得**直引 `panel`/`api`/`studio-tools`/`matrix`/`yt`/`localplatform`（虽然层位允许 daemon 引它们，但这些面的注入由 `assembly` 承担；引擎只认端口，见 §9）。

### 2.3 目标结构（80-§10.2/§10.3 落点）

**目标源码 107 件 = 现有 68 + 新增 12（职责拆分）+ 新增 27（80 端口落点）**；域平面（`src/engine/` 直下）仍 13 件（新件全部进子域目录，§2.1 第 1 条）；子域 19 → 28（新增 `tick/`、`dispatch/`、`breaker/`、`decision/`、`work/`、`obligations/`、`lifecycle/`、`memory/`、`observe/`；`harvest/` 由 2 件长到 11 件；`tools/` 由 2 件长到 3 件）。

| 目标件 | 状态 | 一件一句话职责 |
|---|---|---|
| `engine/tick/types.ts` | **目标-新增** | 叶子类型模块：`EngineConfig`/`Inflight`/`MergeRunDeps`/`MergeRunContext`/`MergeRunHost` + 租约接口 `MergeLeaseState`/`MergeLeaseRegistry`（共 7 型，纯搬移不改名）；解 §1.3 的类型环 |
| `engine/tick/state.ts` | **目标-新增** | 引擎进程内可变状态容器（在途表、泳道簿、断路口、序号、意图队列、拆单队列）与其读写小函数；不碰 IO |
| `engine/tick/phases.ts` | **目标-新增** | 七相位序列的唯一编排点（collect→pre→dispatch→harvest→merge→reclaim→account），每相位一小函数，只调各域件 |
| `engine/tick/report.ts` | **目标-新增** | `TickReport` 的组装与收口（含 `errors: readonly ClassifiedError[]` 归一），不改 `tick-report/types.ts` 的类型定义源 |
| `engine/dispatch/execute.ts` | **目标-新增** | `executeDispatch` 本体：读档位/组任务书/签 wkey/开房间/launch/登记在途；预算闸与闸门在其前后 |
| `engine/dispatch/brief.ts` | **目标-新增** | 派发任务书的拼装（任务书正文、续跑语义、`instructionsPath` 决策），不调 executor |
| `engine/harvest/one.ts` | **目标-新增** | `harvestOne`：单在途工位的一次收割判定（流收、要件折叠、终局分流） |
| `engine/harvest/stream.ts` | **目标-新增** | `pumpHarvestStream`/`foldHarvestEvent`：一次性流的跨拍增量泵与事件折叠 |
| `engine/harvest/finalize.ts` | **目标-新增** | `finalizeHarvest`：四要件全绿的收口（GATE_PASS 落账、工时结算、工位回收、注销在途） |
| `engine/harvest/stall.ts` | **目标-新增** | `failHarvest` 与停滞/看护升级面（`executeStallResponse` 的收割侧落点），对接 `core/breaker.ts` |
| `engine/breaker/trip.ts` | **目标-新增** | `strikeBreakerAndMaybeTrip`：断路口计击与跳闸（纯判定委托 `core/breaker.ts`） |
| `engine/breaker/probe.ts` | **目标-新增** | 半开试探：冷却到期后的试探派发与成功/失败回写（不新增相位） |
| `engine/harvest/park.ts`、`inflight-takeover.ts` | 现有（2 件） | 原样留在 `harvest/`，与四个新件同域；**拆分步后** `harvest/` 6 件（2 现有 + 4 拆分）；§4.12 B 组再 +5（`evidence`/`acceptance`/`value`/`rework`/`reopen`）⇒ **终态 11 件** |
| `engine/engine.ts` | **目标-拆分 → 薄 facade** | 只留 `createEngine` + `Engine` 句柄 + 相位序列调用（委托 `tick/phases.ts`）＋既有 re-export，目标 <600 行，拆完从 `lineBaseline` 除名 |

**不动的既有结构**：`merge/`（6 件）、`intents/`、`jobs/`、`hrsync/`、`cost-guard/`、`cost-close/`、`pricing/`、`judge/`、`directive/`、`notify/`、`rooms/`、`sentinel/`、`split/`、`tier/`、`todoqueue/`、`typeflows/`、`lanes/` 的位置与件数不变；`tools/` 现 2 件，B 组再 +1（`effect-gateway.ts`）⇒ 终态 3 件（升格阈 10 未触发）。

**拆分顺序硬约束**（80-§10.2，违反即返工）：先落 `tick/types.ts` 叶子解环 → 再抽 `harvest/` 四件 → 再抽 `dispatch/` 两件 → 再抽 `breaker/` 两件 → 最后抽 `tick/{state,phases,report}.ts` 并降 facade。每步单独可跑 `bun run typecheck` + `bun run guard:boundaries`，且**每步不得同时改语义**。

**每步验收命令**：

| 步 | 验收 |
|---|---|
| 1 `tick/types.ts` | `rg "from '\.\./engine\.ts'" apps/daemon/src/engine/merge` 空；`rg "import\('\./merge/merge-run" apps/daemon/src/engine` 空；`bun run typecheck` 绿 |
| 2 `harvest/` | `rg "^(export )?(async )?function (harvestOne\|pumpHarvestStream\|foldHarvestEvent\|finalizeHarvest\|failHarvest)" apps/daemon/src/engine/engine.ts` 空；`harvest/` 计 **6** 件（拆分步口径；B 组落地后为 11） |
| 3 `dispatch/` | `rg "^function executeDispatch" apps/daemon/src/engine/engine.ts` 空；`dispatch/` 计 2 件 |
| 4 `breaker/` | `rg "function (strikeBreakerAndMaybeTrip\|executeStallResponse)" apps/daemon/src/engine/engine.ts` 空；`breaker/` 计 2 件 |
| 5 facade | `wc -l engine.ts` < 600；`boundary-rules.mjs` 的 `lineBaseline` 删去 `engine.ts` 条目后门禁仍 PASS |

**27 个 80 端口落点件不在上表**（上表只列 12 个职责拆分件）：逐件契约见 **§4.12 B 组**。落点按 80-§6.9 冻结——`engine/decision/`（2：`intake.ts`、`decide-record.ts`）、`engine/work/`（11：`intake`/`contract`/`readiness`/`plan`/`lifecycle`/`exception`/`settlement`/`qualification`/`risk`/`assignment`/`attendance`）、`engine/harvest/`（+5：`evidence`/`acceptance`/`value`/`rework`/`reopen`）、`engine/obligations/`（1）、`engine/lifecycle/`（4：`identity`/`handover`/`succession`/`appointment`）、`engine/memory/`（1）、`engine/observe/`（1）、`engine/notify/`（+1：`policy.ts`）、`engine/tools/`（+1：`effect-gateway.ts`，`EFF-01` 外层编排）。**RES-01 在引擎无件**：纯算法在 `core/src/resources/`、持久投影在 `store/src/resources/`（投影名 `resourceLedger`、物理表 `resource_ledger`，80-§6.3 已登记为目标第 18 个投影名），引擎只在 `work/readiness.ts`（读 `baseline`）、`work/plan.ts`（写 `resource_reservations`）、`work/settlement.ts`（资源项）三处消费，不另造实现或写口。

**端口件与拆分件互不依赖**：拆分件（上表）是既有 `engine.ts` 职责的搬迁，端口件（§4.12 B 组）是 80 公共端口的实现落点。端口件的前置不在本卷——类型面（`contract/src/ports/*`）归 01 卷、纯求值（`core/src/work-readiness.ts`、`core/src/resources/`）归 02 卷、SQL 与投影（`store/src/{records,memory,resources}/`）归 03 卷；三者落地前，端口件只有形状与语义、没有可编译的类型，**不得**以本表的存在声称已可实现。两组的共同硬约束只有一条：先落 `tick/types.ts` 解环（§1.3），再动任何新件。

**计数的复算口径**：源码 68 件可用 `find apps/daemon/src/engine -name '*.ts' | wc -l` 复算；目标 107 = 68 + 12（上表 12 个**新增**行，`park.ts`/`inflight-takeover.ts` 行不计入新增）+ 27（§4.12 B 组，端口件；含 `tools/effect-gateway.ts`）。域平面 13 = `find … -mindepth 1 -maxdepth 1 -type f | wc -l`；子域 28 = 19 + 9（`tools/` 为既有子域，不新增目录）。

---

## 三、入口与公共面

### 3.1 包出口

`apps/daemon/package.json:10`：`"./engine": "./src/engine/engine.ts"`。全仓**唯一**外部消费者实测为 `apps/boot/src/boot.test.ts:23`（`checkMentionPayload`），走子路径而非包根。故本域的公共面＝`engine.ts` 的 `export`，其余 67 件均为**包内私有**（相对路径导入），不构成对外契约；改动它们只需域内自查。

### 3.2 `engine.ts` 公共面清单（现有）

| 符号 | 锚 | 语义 |
|---|---|---|
| `EngineConfig` | `engine.ts:319` | 引擎配置（下方 3.3 键表） |
| `ENGINE_CONFIG_DEFAULTS` | `engine.ts:501` | 缺省值（`company:'demo'`、`intentSource:'activity'`、`limits.maxActionsPerTick=4`、`maxInflight=2`、`breakerThreshold=3` 等） |
| `EngineDeps` | `engine.ts:531` | 注入面（3.4） |
| `Inflight` | `engine.ts:601` | 在途工位记录（派发登记，收割注销） |
| `Engine` | `engine.ts:644` | 句柄：`tick()`、`ingest()`、`pendingIntents()`、`ingestSplit()`、`pendingSplits()`、`applyCompanyUpdate()`、`dispose()`、`config` |
| `CompanyRuntimeUpdate` | `engine.ts:672` | 公司运行时热更（整组替换，tick 边界生效） |
| `createEngine` | `engine.ts:709` | 唯一构造入口 |
| 意图契约 re-export | `engine.ts:231`、`:246`、`:257` | `checkMentionPayload`/`checkWebhookPayload`/`checkDataChangePayload`/`dataChangeFingerprint`/`parseDataChangeRoutes`/`checkEscalatePayload`/`costThresholdKey`/`checkRelayPayload`/`checkResumePayload`/`pickResumeAdapter`/`resolveResumePlan` 及配套 payload 类型 |
| `TickReport`、`TickDecisionEntry` | `engine.ts:314` | 一拍汇报（`tick-report/types.ts` 为唯一定义源，此处纯再出口） |

**re-export 纪律**：`engine.ts` 的 `export { … } from '…'` 是「源侧产物↔契约」兼容面的登记位（`engine.ts:229` 注释明示 105-刀A 先例）。新增 re-export 等于扩公共面，须在 80-§6 端口全集里先登记。

**公共面的三处目标变更**（现都没有实现，不得写成已有）：

| 变更 | 现状 | 目标 | 依据 |
|---|---|---|---|
| `TickReport.errors` | `readonly string[]`（`tick-report/types.ts:145`，`engine.ts` 23 处 `errors.push` 全是裸串） | `readonly ClassifiedError[]`（`{failure,category,subcause,detail?}`）；定义源仍是 `tick-report/types.ts`，`engine.ts` 仍纯再出口 | 80-§7.2；§7.2 映射表 |
| `Engine.ingest` 的边界 | 注释写「物化/去重/决策全在 tick 内」，但没写「不得被 API 直调」 | **只入内存队列**：不落任何记录、不产生 `intentRef`、不推进回执投影；API/装配体拿不到 `Engine`，只拿 `Pick<IntentIngress,'submit'\|'receipt'>`（编译期拿不到 `replayQueued`/`ingest`） | 80-ingress 冻结顺序；§4.10 `S-ENGINE-ASSEMBLY-API` |
| 意图提交面 | 无（`ingest` 是唯一入口，直通） | 引擎侧只新增**可选依赖** `EngineDeps.workIntake?`（§3.4），公共面不新增 `WorkIntake`/`IntentIngress` 符号——两者的契约在 `packages/contract`，实现在 `apps/daemon/src/assembly/` | §4.10 三个接缝件 |

**不变**：`EngineConfig`/`ENGINE_CONFIG_DEFAULTS`/`EngineDeps`/`Inflight`/`Engine`/`CompanyRuntimeUpdate`/`createEngine` 与全部意图契约 re-export 的**名字与语义**维持；`Inflight` 与 `EngineConfig` 的定义位置目标迁 `tick/types.ts`，但经 `engine.ts` 再出口的路径不变（`apps/boot` 外部消费者零改动）。

### 3.3 `EngineConfig` 键（本域直接消费，按用途分组）

- **身份/路径**：`company`、`rootDir`、`aiwsRoot?`（`.AIWS` 员工树根；缺省回退 `<rootDir>/workspaces/<单号>/att<N>`）、`companyDir?`（岗产物收账锚）、`actor`、`defaultPersonId`。
- **组织/指派**：`deptFallback`、`defaultLane`、`intentSource`、`people`（在 `EngineDeps`）、`departments?`（`EngineDeps`）。
- **三闸阈值**：`limits`（`ConcurrencyLimits`）、`laneTtlMs`、`stallAfterMs`、`stallKillAfterAlarms?`、`breakerThreshold`、`breakerCooldownMs?`、`killGraceMs`。
- **采集节流**：`maxActivityPages`、`mirrorRescanEveryTicks?`、`statusSetPatrolEveryTicks?`、`harvestReconEveryTicks?`、`harvestSliceMs`。
- **哨兵/声明面**：`heartbeatIssue`、`provisionDeclaredStates?`、`knownForeignStates?`、`autoApprove`。
- **预算**：`budgetTicketCapUsd?`、`budgetPersonCapUsd?`。
- **读面/队列/档位**：`readTierByRole?`、`readBlindAcceptance?`、`queueAgeStepMs?`、`personInflightOverrides?`、`pinnedTickets?`、`queueRanker?`、`modelTierByRole?`、`modelTierTickets?`。
- **流表/路由**：`flows?`（`core FlowTable`）、`dataChangeRoutes?`。
- **成本警戒**：`costThresholdTarget?`、`costThresholdLane?`。
- **合并**：`mergeLeaseTtlMs`。

**否定约束**：`EngineConfig` 不承载秘密（wkey 经 `workerKeys` 端口签发）、不承载平台凭据（`FlowPlatform` 已在 `EngineDeps` 内封装）、不承载提示词内容（`assembler` 端口）。新增键＝改 80-§3/§6 的接口卷，不是本卷可自行扩张的对象。

### 3.4 `EngineDeps` 注入面（现有，逐条）

必需：`platform`（`FlowPlatform`）、`ledger`（`Ledger`）、`registry`（`ExecutorRegistry`）、`assembler`（`PromptAssembler`）、`gateRunner`（`GateRunner`）、`clock`、`config`、`people`。

可选（缺省＝面关、行为零变更，`engine.ts:542-593` 逐条注释）：`departments?`、`makeId?`、`catalog?`（价目表；缺省＝预算态 B 降级）、`workerKeys?`、`hrSync?`、`directives?`、`rooms?`、`costGuard?`、`notify?`、`judge?`（队列两址）、`onWorkComplete?`、`mergeRun?`（缺省＝相位 5 v0 模拟轨）。

**目标新增一个可选键（未实现）**：`workIntake?: Pick<WorkIntake, 'intake'>`（`WorkIntake` 契约见 `packages/contract`，§4.10 `S-ENGINE-CONTRACT-INTENT`）。

- **为什么不注 `reserve`**：`reserve` 属 ingress（`IntentIngress.submit` 的第一段），引擎永远看不到 reserve；引擎只在相位 2 判定完、真正受理意图时调 `intake` 写 `REC-WORK-02`。
- **缺省＝面关**：未注入时**不写 `REC-WORK-02`**，回执停在 `queued` 并明报（`TickReport` 的 note/`gap` 记 `intake-link-missing` 的来源），**不得伪造受理结论**（尤其不得用 `accepted` 表示提交成功或受理成功）。这与其它可选注入的「缺省＝面关」同纪律（下一段）。
- **不注 `IntentReceiptStore`**：回执投影的写维护者不再是 ingress，而是 **store 自有的 projection hook**——它在追加 `REC-WORK-01/02/03` 的**同一事务**写表投影，commit 后同一微任务更新内存快照，因此相位 2 判完写 `REC-WORK-02` 时投影**同步**变 `decided`（80-§6.6 规则 7；`decided` 不可能被读成 `queued`）。引擎不持 `IntentReceiptStore`、不刷投影；`refresh`/`get` 分轴见 §4.10.4。

**纪律**：可选注入的缺省分支必须**明报**而非静默（如 `notify` 未注入时 note 记「notify=未接线」，`engine.ts:575`）。这是 80-§12.6「不得把未接线写成已支持」的机制化落点。

---

## 四、逐文件契约（现有 68 件 + 目标 39 件）

> 4.1–4.9 是**现有 68 件**的逐件契约；4.10 是跨域接缝；4.11 是目标测试件；**4.12 是 39 个目标源码件**（12 拆分 + 27 端口，全部不存在）。4.12 的件不在上面的分组表里——它们的目标分组见 §4.12 的 A/B 两组。

### 4.0 分组、相位落位与组间依赖方向

引擎是**单拍幂等**的七相位机（80-§7、`engine.ts:1570` `tick()`）。下表是本卷的分组依据，也是「这个文件属于哪一拍」的唯一口径；新增文件必须能填进某一行，否则是设计缺口。

| 组 | 相位落位 | 文件数 | 组内职责 |
|---|---|---|---|
| 4.1 引擎核 | 相位机本体 + 拍边界 | 4 | 编排、汇报类型、驻留竞速、启动接管 |
| 4.2 配置与权限 | 派发前置 / 全局 | 5 | 预算闸、泳道租约、wkey、ULID、写收口包装 |
| 4.3 采集与状态 | 相位 1 / 2 前置 | 19 | 事件索引、双哨、批示归一层、六类意图、拆单、待办队列、流表 |
| 4.4 派发与装配 | 相位 3 / 4 收口 | 8 | 提示词、读面分级、指令落盘、档位、闸门、岗产物、哨兵、落位对账 |
| 4.5 合并 | 相位 5 | 6 | 合并跑、租约、闸门、任务书、降级轨、真机端口 |
| 4.6 落账与收口 | 相位 4 尾 / 6 / 7 尾 | 18 | 定价、日终收口、成本警戒、人事同步、岗源/调度/源注册表、通知、房间 |
| 4.7 判读 | 相位 2 前置④ | 6 | micro-judge 调用、预算帽、任务书、事件、两址、工作区 |
| 4.8 演示与测试缝 | 非相位 | 2 | fake 平台/执行体、崩溃注入点 |

组间依赖方向（实测相对导入，只列跨组边；同组内自由）：

```text
4.2 ◀── 4.4（prompt-assembly 不引 4.2；gate 被 read-tiers 引）
4.1 ──▶ 4.2/4.3/4.4/4.5/4.6/4.7（engine.ts 引 36 条唯一相对目标，是唯一总装点）
4.3 ──▶ 4.3（directive/wire→intents/taxonomy；intents/drain→taxonomy/escalate/relay-resume-faces）
4.4 ──▶ 4.4（read-tiers→gate；prompt-assembly→read-tiers）
4.5 ──▶ 4.1（merge-run/merge-lease 反向引 engine.ts 类型＝**唯一跨组回引**，§8 解环对象）
4.6 ──▶ 4.3（cost-guard/source→intents/escalate；notify/relay→intents/escalate）
4.6 ──▶ 4.2（cost-guard/source / jobs-sources / jobs/freshness / judge/invoke → tools/id）
4.4 ──▶ 4.6（jobs/harvest-recon→jobs/sentinel、jobs/output-account；scheduler 被 sources/jobs-sources/freshness 引）
4.1 ──▶ 4.5（engine.ts→merge-run/merge-lease 运行时函数）——与上面的回引共同构成类型环
```

**判负**：出现「4.5/4.6/4.7 → 4.1」的**运行时**导入（非 `import type`）即判负——那会把 facade 变成被依赖的实体，破坏 80-§10.2 的拆分方向。

#### 4.0.1 跨件三条纪律（适用于本节全部 68 件）

1. **金额**：`Money.usd: number` 只允许出现在**内存运算**与**历史记录回读**里；任何**公共面**（端口返回、事件 payload、跨包类型、HTTP 体）目标一律 `DecimalString`（字符串）+ 显式币种字段。理由：浮点累加在预算/结清面会漂，公共面一旦定成 `number` 就再也换不回来。现状 `budget-gate`/`judge`/`cost-close` 的内存算式可暂留 `number`，但**不得**把 `number` 加进新的导出类型。
2. **标识**：`sha8`（8 位短哈希）**只用于展示/日志**；任何**身份判定**（幂等键、去重、产物核对、合同指纹）必须用完整 `semanticDigest`。判负：拿 `sha8` 当 `RecordEnvelope` 的 `digest`、当 `dedupKey`、当比对依据。
3. **日键**：UTC 日键（`dayKeyOf`，`packages/panel/src/views.ts:321`）与**公司本地日**是两个概念，必须分开。本地日只能由**显式时区参数**（IANA 名，来自公司配置）算出；**判负**：用 `new Date(ts).getFullYear()/getMonth()/getDate()` 读宿主时区（现存反例见 §4.4 `jobs/output-account.ts` 的 `reportFileName`，已登记目标改法）。

#### 4.0.2 七相位矩阵（实测锚：`engine.ts:1582-2236`）

相位序列由 `tick()`（`engine.ts:1570`）单点编排；下表把每个相位的**相位内步骤**、承接件、写入面、幂等/恢复锚、失败面对齐到锚点。承接件一列同时给现状件与 §2.3 的目标落点（`tick/phases.ts` 等目标件尚未存在）。

| 相位 | 相位内步骤（实测锚） | 承接件（现状 → 目标） | 本相位写入 | 幂等 / 恢复锚 | 失败面 |
|---|---|---|---|---|---|
| 1 采集 | activity 增量（游标读 `:1583`／写 `:1611`）；issues 全量对账→镜像 upsert（`syncMirror:826`） | `engine.ts` → `tick/phases.ts`＋`sources.ts` | `ledger.kvSet('activity.cursor')`；`upsertTicketMirror`；事件经 `append:781` | 游标单调 + `append` 去重闸（`r.appended` 才入拍汇报）；镜像 upsert 幂等 | 采集失败只记错不炸拍（`:1613`／`:1617`），裸字符串（U81-04） |
| 1 尾·双哨 | `:1623` | `sentinel/sentinels.ts`（纯判定 `shape.ts`/`events-index.ts`） | `ESCALATE`／`FOREIGN_KNOWN` | 事件去重闸；哨位按状态集幂等复查 | `onError` 回调入 `errors`（`:1673`） |
| 1 尾·批示归一层 | `:1659` | `directive/{index,parse,qualify,wire}.ts` | 批示触发的迁移与事件（`mutations` 累加）；打回/站立 | 指令键去重（`directive/wire.ts`）；`report.rejected` 计入汇报 | `rejected` 计数入 `TickReport`，不静默吞 |
| 2 前置（五步） | 意图消费 `:1689`；拆单 `:1728`；复活对账 `:1735`；镜像重决策 `:1780`；队列精序 `:1818` | `intents/{drain,taxonomy,escalate,relay-resume*}.ts`、`split/*`、`judge/sites129.ts`、`todoqueue/queue.ts` | `RESUME`；拆单落单；`JUDGE_OK`／`JUDGE_FALLBACK`（`judge/events.ts`） | 意图消费标记由 `DISPATCH` 事件 note 派生（`seenIntentKeys`，`:1897`）；`closedSet` 派生事件索引（`:1743`） | 精序违背纯置换契约→记错后回落规则档（`:1857`）；意图畸形→`HOLD_INTENT_MALFORMED` 明报拒收（`:1692`） |
| 2 决策 | `:1680` 段声明六类动作队列；逐候选 `decide`（`:1888`）；`lanes.acquire`（`:1937`） | `core` 的 `decide`（纯体）＋`lanes/registry.ts` | **不写台账**（纯决策）；泳道租约占内存 | 单拍单动作；在途计数含本拍已排队（`:1892`）；决策即占道、失败由派发 `catch` 释放 | 平台取不到单→记错跳过本拍（`:1869`） |
| 3 派发 | `:1968`：`submit_approval` 呈批 → `executeDispatch:880`（读档位／组任务书／签 wkey／开房间／launch／登记在途） | `engine.ts` → `dispatch/execute.ts`＋`dispatch/brief.ts`；`prompt-assembly`、`read-tiers`、`worker-key`、`budget-gate`、`rooms/room-duty` | `DISPATCH`（含 intentKey／wait 锚／档位锚）、`WAIT_APPROVAL`；`appendBudget`（`budget-gate.ts:176`）；`insertWorkRecord:1061`；工位指令文件 | 预留→派发→落账（20-§六.8「不落即不派」）；`DISPATCH` note 的 `intentKey` 即消费标记 | 超帽拒派不签发（`budget-gate`）；launch 失败→`fail()` 放泳道 |
| 4 收割 | `:2001`（**本拍派发的下一拍才收**）→ collect 动作 → 四要件折叠；末段 STALL 响置 `:2055`；尾·落位对账 `:2072`；尾·usage write-through `:1333` | `engine.ts` → `harvest/{one,stream,finalize,stall}.ts`；`cost-guard/{harvest,usage}.ts`、`jobs/harvest-recon.ts` | `GATE_PASS`／`GATE_FAIL`／`QA_PASS`／`QA_BACK`／`STALL`／`ESCALATE`；`endWorkRecord:1267`；`upsertUsageDaily` | 回执先于收口；`parkRace` 驻留跨拍续等（`harvest/park.ts`）；崩溃后由 `running` 行＋`harvest/inflight-takeover.ts` 接管 | 四要件缺→`failHarvest:1361`；STALL 达阈→`executeStallResponse:1476` |
| 5 合并 | `:2092`：post-verified 验收位＝真单刀；`mergeRun` 缺省＝v0 模拟轨 | `merge/{merge-run,merge-lease,merge-gate,merge-brief,merge-fallback,default-deps}.ts` | `MERGE`；合并闸 `GATE_PASS`／`GATE_FAIL`；租约 kv | 租约 TTL＋续租＋死主回收（键 `mergeLeaseKey(company,targetBranch)`） | 冲突→三锚 `GATE_FAIL`＋`ESCALATE`＋清站立，**不重试、不触断路器**（`merge-run` S6） |
| 6 回收 | `:2106`：关单落账＋泳道释放（`:2111`／`:2112`）＋wkey 吊销（`:2117`） | `tick/phases.ts`＋`worker-key.ts`＋`lanes/registry.ts`；房间关房 | `CLOSE`（终态，无平台迁移） | 吊销按 ticket 幂等（不依赖索引，`:2111-2117` 头注） | 关房失败→`ESCALATE` 经 `makeEvent` 落账 |
| 7 落账/心跳 | `:2133`：仅 `mutations===0` 写心跳（`:2136` crashHook④）；四尾＝人事同步 `:2147`、`todo_queue` 投影重投 `:2161`、定价 stale `:2210`、日终收口 `:2236` | `hrsync/*`、`todoqueue/queue.ts`、`pricing/pricing.ts`、`cost-close/close.ts` | `HEARTBEAT`；`hr_sync_log` 队列；`replaceTodoQueue`；`appendPriceSnapshot`；`REPORT_COST_CLOSE`／`DAILY_ALARM` | 心跳只在零变更拍；投影可重建（write-through 与 rebuild 同结果，§5.3） | 各尾把 `errors` 注入体（如 `:2236` 显式传 `errors`），不阻断后续尾 |

**三条判负**（对应 80-§7 与 `engine.ts:2072-2073` 的原注）：

1. **八步都是相位内步骤，不得升格为第八相位**：`inflight-takeover`（启动例行）、`notify/relay`（派发/CLOSE 钩）、`pricing`、`cost-close`、`directive` 层同属此类；新增相位＝改 80-§7，须提案流。
2. **相位 4 只收本拍之前派发的在途**：本拍 `dispatch` 的在途要下一拍才进收割判定（`:2001` 注释），故「同拍派发同拍收割」是设计误读。
3. **相位 5 缺省轨不是合并**：`mergeRun` 未注入时走 v0 模拟轨（`engine.ts:593`），不得当作真单刀证据（U81-10）。

**两处目标落点（现在不在相位表里，因为没有对应现状件）**：

- **断路响应**（相位 4 失败面）目标落 `breaker/trip.ts`（计击跳闸）与 `breaker/probe.ts`（半开试探）；现状是 `engine.ts:1425`/`:1476` 两个函数，`core/breaker.ts` 已有纯判定体。它们**不是第八相位**，也不新增相位内步骤，只是把既有步骤搬家。
- **意图受理落账**（相位 2 意图消费段）目标经 `EngineDeps.workIntake?.intake` 写 `REC-WORK-02`（§3.4/§4.3）；`REC-WORK-01` 在 ingress 的 `submit` 里就已写，**不在相位表内**，故本表不列它。

#### 4.0.3 域件分层（判据与纪律）

68 件常被一句「engine 只留相位缝」（`engine.ts:291-292`）概括，这句不是口号，是**编排层判据**：一段逻辑若能脱离拍循环独立喂输入并断言，它就不该留在 `engine.ts`。按「有没有 IO」「语义能否复算」「是否只在组合期跑一次」分四类（逐件归属见 §4.1–§4.9 各条目，此处只给判据与代表件）：

| 类 | 判据 | 代表件 | 纪律 |
|---|---|---|---|
| **纯域件** | 零 IO、纯函数、同输入同输出 | `directive/{parse,qualify}`、`split/{directive,suggest}`、`todoqueue/queue`、`sentinel/{shape,events-index}`、`notify/{route,dedup}`、`typeflows`、`tools/id`、`harvest/park` | 单测直打（分支全覆盖）；不得引 `Ledger`／平台端口／时钟 |
| **缝件**（端口接线） | 有 IO，但语义由纯体决定；`ledger`／`makeEvent`／平台端口以注入到位 | `budget-gate`、`worker-key`、`tools/gated-platform`、`cost-guard/{fold,harvest,usage,source}`、`judge/{invoke,accounts,events,workspace,brief}`、`merge/*`、`hrsync/*`、`cost-close/close`、`pricing/pricing`、`jobs/*`、`rooms/room-duty`、`notify/relay` | 事件一律经注入的 `makeEvent`→`append:781`（§5.1）；不自建写口、不直连平台方言 |
| **装配缝** | 组合期跑一次，或提供 factory／闭包／只读表 | `directive/serve-config`、`intents/{drain,relay-resume-faces}`、`split/materialize`、`sources.ts`、`scheduler.ts`、`prompt-assembly`、`tier/model-tier`、`instructions-store`、`read-tiers`、`gate`、`judge/sites129` | 只在 `createEngine`／`serve` 装配处调用；不持跨拍状态 |
| **测试/演示缝** | 仅测试或演示可达 | `fakes.ts`、`crash-points.ts` | 不得当能力证据（§4.8、U81-05） |

**分层纪律**：

- 新特性开 `<域>/<特性>/` 子目录（20-§十五.四.1），**域平面 13 只减不增**；`engine/tools/` 现 2 件、升格阈 10 未触发（§2.1 第 4 条）。
- 「纯域件」不得为了少传参而顺手读 `deps.clock`／`ledger`——那会把它降级成缝件并失去单测可直打性。
- 「缝件」的 IO 失败必须**明报**（U81-04 目标是 `ClassifiedError`，§7.2），不得靠缺省值把失败抹成成功。

---

### 4.1 引擎核（4 件）

#### F-DAEMON-ENGINE-ENGINE · `engine/engine.ts` 〔现有 / 目标-拆分〕

- **处置**：目标-拆分。按 80-§10.3 抽 `tick/`（相位编排）、`dispatch/`（派发面）、`harvest/`（收割面）、`breaker/`（断路响应）四组，逐件表与顺序见 §2.3/§8.2；本文件降为薄 facade（`createEngine` + `Engine` + 相位序列 + 既有 re-export）。2337 → 目标 <600，拆完从 `lineBaseline` 除名。
- **归属/上位**：实现面。80-§7 七相位、§8 事务/六段写/恢复、§3 入口；77 的 `RUN-WORK-*`/`RUN-STATE-01`/`RUN-EVD-01..04`；78 的平台绑定经 `FlowPlatform` 端口，本文件不含平台方言。
- **职责 / 非职责**：职责＝七相位编排、`EventRecord` 唯一写口 `append`（`engine.ts:781`，前置 `ledger.appendEvent` 的去重闸，`r.appended` 才入拍汇报）、在途表维护、三闸与断路调用、收割四要件判定、终态收口。非职责＝不做状态决策（`core` 的 `decide`）、不渲染提示词（`prompt`）、不签凭据（`gateway` 经 `worker-key.ts`）、不建表不迁移（`store`）、不直连 YouTrack/Matrix/Taiga。
- **意图面的边界（目标，现未实现）**：`ingest()` **只把意图推进内存队列**（`engine.ts` 现有注释已写「物化/去重/决策全在 tick 内」，但未写负面约束）——不落 `REC-WORK-01`/`REC-WORK-02`、不产 `intentRef`、不刷 `intent_receipts` 投影。这三件事的唯一写手是 `WorkIntake`（`reserve`/`intake`）与 ingress 驱动的 `IntentReceiptStore`（§4.10）。引擎在相位 2 受理意图时经 `EngineDeps.workIntake?.intake` 写 `REC-WORK-02`；未注入＝面关、明报、回执停 `queued`（§3.4）。
- **内部结构**（实测锚）：`append:781`、`makeEvent:786`、`syncMirror:826`、`resolvePerson:848`、`flowOf:856`、`executeDispatch:880`、`harvestOne:1146`、`pumpHarvestStream:1183`、`foldHarvestEvent:1215`、`finalizeHarvest:1224`、`failHarvest:1361`、`strikeBreakerAndMaybeTrip:1425`、`executeStallResponse:1476`、`tick:1570`、`dispose:2284`。相位内锚：1 采集 `:1582`、双哨 `:1623`、批示层 `:1659`；2 state-diff `:1680`、意图消费 `:1689`、拆单 `:1728`、复活对账 `:1735`、镜像重决策 `:1780`、队列精序 `:1818`；3 派发 `:1968`；4 收割 `:2001`、STALL `:2055`、落位对账 `:2072`；5 合并 `:2092`；6 回收 `:2106`；7 心跳 `:2133`、人事同步 `:2147`、队列投影 `:2161`、定价守夜 `:2210`、日终收口 `:2236`。
- **导出与依赖**：导出见 §3.2。包依赖：`adapters`（`ExecutorRegistry` 类型）、`contract`、`core`、`store`；`node:crypto`/`node:fs`/`node:path`。包内相对导入 **36 条唯一目标**（4.2–4.7 全覆盖，实测 `grep -oE "from '\./" | sort -u | wc -l`）。**禁止**：引 `control`/`evolve`/`cli`/`assembly`（层位）、引 `panel`/`api`/`yt`/`matrix`/`localplatform`（注入面由 assembly 承担）、自建 DDL（`store` 唯一迁移者）。
- **IO 与注入**：台账经 `Ledger` 端口（唯一 SQLite 触点）；文件系统＝工位 `REPORT.md`/`summary.json`、`tmp/instructions`、公司目录 `reports/`；时钟＝`deps.clock`（禁 `Date.now()` 直取用于决策）；ID＝`deps.makeId`，缺省 `makeUlid`（`tools/id.ts`）；随机/哈希＝`node:crypto`。
- **状态与并发**：`CURSOR_KEY='activity.cursor'`（`:701`）、`TICK_SEQ_KEY='tick.seq'`（`:702`）；拍序播种 `:752`、落盘 `:1572`；游标读 `:1583`、写 `:1611`；`closedSet` 派生自事件索引（`:1743`，复活经 `RESUME` 释放 `:1755`）；`seenIntentKeys` 由 `DISPATCH` 事件 note 派生（`:1897`，在工单本单键不注入 `:1873`）；在途 `Map` 只在内存（崩溃后由台账 `running` 行 + `harvest/inflight-takeover.ts` 接管）。**事务边界**：一拍内不 `await` 外部 IO 于台账事务中；写序＝预留→派发→落账（20-§六.8「不落即不派」）。
- **错误与观测**：`errors.push(` 实测 **23 处**（如 `:1293`、`:1613`、`:1617`、`:1654`），当前全部是**裸字符串**，不满足 80-§7.1「错误须带 category/subcause」。目标：23 处逐条改为 `ClassifiedError`（`{failure,category,subcause,detail?}`）后 push 进 `errors`，类型面同步改 `readonly ClassifiedError[]`（§7.2 给出逐面映射）；**只改类型不逐处分类＝未出清**，`errors.push` 的 23 这个数不因拆件而变化（拆件只挪位置，不消灭分类债）。采集失败只记错不炸拍（`:1613`/`:1617`）是**有意的降级**，目标映射为 `failure:'degraded'` + `category:'STALL'`（不是 `unavailable`，因为该拍仍继续）。观测面＝`TickReport`（`tick-report/types.ts`）＋事件台账。
- **测试与证据**：被 40 个测试文件直接 import（`e2e`/`crash-injection`/`freeze-repro`/`noop-observability`/`starvation-revival`/`stall-*`/`breaker-half-open`/`budget-gate`/`worker-key-lifecycle`/`merge-*`/`wake/*`/`directive/*`…，实测 `grep -rl engine/engine test` 计数 41 含 `test/control/hot-reload`）。**不证明**：真实 adapter/DSH 真机、跨进程回放、真实 YouTrack 平台、多进程并发；见 §4.9 统一不证明清单。
- **规模与验收**：2337 行在 `lineBaseline`（`boundary-rules.mjs:160`）内＝**只减不增**；新增相位或新增写口＝提案流。拆分完成的机械判据＝该行从基线除名且 `bun run guard:boundaries` 绿。

#### F-DAEMON-ENGINE-TICKREPORT-TYPES · `engine/tick-report/types.ts` 〔现有 / 目标-保留〕

- **处置**：目标-保留（类型面）；**并让位**：`EngineConfig`/`Inflight`/`MergeRunDeps`/`MergeRunContext`/`MergeRunHost` 的目标家是 `engine/tick/types.ts`，本文件继续只放 `TickReport` 家族（宿主类型真实名只有 `MergeRunHost`，§1.3）。
- **文件内环位**：本件在 SCC 内只因 `:16` 的 `import type { MergeQueueFace } from '../merge/merge-lease.ts'`；解环时该类型随租约面一并下沉 `tick/types.ts`（§8.2 第 1 步），本件即退出强连通分量、只剩单向消费。
- **归属/上位**：80-§7「tick 返回结构化 actions」的汇报形状；不承载语义分级（那是 77 的 `RUN-*`）。
- **职责 / 非职责**：职责＝一拍汇报的类型全集（零运行时）。非职责＝不做聚合计算、不做状态判定；**错误分类的定义源在 `contract`**（`ClassifiedError`），本文件只引用不重定义。
- **内部结构**：`TickPhaseCollect:19`、`TickDecisionEntry:45`、`TickActionResult:55`、`TickPhaseHarvest:63`、`TickPhaseDispatchBudget:73`、`TickDispatchScheduleToStart:84`、`TickQueueProjection:94`、`TickQueueJudgeReport:103`、`TickReport:109`（`errors` 在 `:145`）。
- **导出与依赖**：全部为 `export interface`；包依赖 `contract`/`core`；相对导入为**类型**（`hrsync/hrsync`、`jobs/harvest-recon`、`pricing/pricing`、`cost-close/close`、`judge/sites129`、`merge/merge-lease`）——其中 `merge/merge-lease.ts` 回引 `engine.ts`，构成环（§1.3）。解环后该回引改为 `../tick/types.ts`，本文件仍是叶子方向的消费者。
- **IO 与注入**：零 IO、零时钟、零随机（纯类型）。
- **状态与并发**：无状态。版本纪律＝字段只增不改意；删改字段须同步所有 producer/consumer 与 `engine.ts:314` 的再出口。
- **错误与观测**：`errors` 现状 `readonly string[]`（`:145`）＝观测面本身，也是 §7.2 的迁移落点。目标：`errors: readonly ClassifiedError[]`；**不得**把 `ClassifiedError` 再拍平成 `string`，也不得保留第二个 `warnings: string[]` 通道来装本该分类的错误（若要保留纯提示性 note，必须另起字段名并写明「非错误」）。
- **测试与证据**：由 `merge/merge-run.test.ts` 直接 import；其余经 `engine.ts` 的 `TickReport` 断言（`noop-observability.test.ts`、`e2e.test.ts`）。**不证明**：字段类型改动的运行时行为（纯类型，无运行时证据）。
- **规模与验收**：146 行；目标结构下不再增长（新相位报告类型若必须加，进 `engine/tick/types.ts`）。

#### F-DAEMON-ENGINE-HARVEST-PARK · `engine/harvest/park.ts` 〔现有 / 目标-保留〕

- **处置**：目标-保留（可随收割面迁 `engine/tick/` 或留在 `harvest/`；迁移不改语义）。
- **归属/上位**：80-§7「拍有界」；DEV-9 冻结复现的修复件（`docs/17-§2`）。
- **职责 / 非职责**：职责＝`parkRace(next, ms)` 把「迭代器取下一事件」与计时器竞速，超时返回哨兵 `PARKED`（`:8`、`:14`），使收割流驻留不阻塞本拍。非职责＝不消费事件、不改流状态、不做错误分类（拒绝原样传播）。
- **内部结构**：`PARKED = Symbol('harvest-parked')`、`parkRace(next, ms)`。纯计时件，无引擎闭包。
- **导出与依赖**：2 个导出；依赖 `contract`（迭代结果/流事件类型）。无 `node:*` 直用（计时器由调用方语义约束）。
- **IO 与注入**：**读时钟**＝`Date.now()`（`engine.ts:1203` 传 `deadline - Date.now()`）。这是本域少数直接取时钟的叶子件；可接受理由是「计时竞速」与业务时钟无关，但若引入 `clock` 端口须同步改调用点。
- **状态与并发**：不持有状态；同一 `next` promise 被下一拍续等（驻留语义）。**不得**在中途 `return` 丢弃 promise（会丢事件）。
- **错误与观测**：无自身错误分类；上游拒绝原样抛出（`engine.ts:1195` 注释：驻留期拒绝吞并记档）。
- **测试与证据**：无直接测试 import；行为由 `freeze-repro.test.ts`（DEV-9 冻结复现）与 `e2e.test.ts` 间接钉住。
- **规模与验收**：29 行；不得在此加业务逻辑。

#### F-DAEMON-ENGINE-HARVEST-INFLIGHT-TAKEOVER · `engine/harvest/inflight-takeover.ts` 〔现有 / 目标-保留〕

- **处置**：目标-保留。**位置特殊性**：文件在引擎域，但公共面仍经 `assembly/serve.ts` re-export（`test/assembly/inflight-takeover.test.ts:23` 的导入路径即证据），属「serve 启动例行，非第八相位」。
- **归属/上位**：80-§8 恢复五点（进程重启后收口 `work_records` 的 `running` 行）；77 的工时记录状态面。
- **职责 / 非职责**：职责＝`takeOverRunningWorkRecords(ledger, now)` 把上次进程遗留的 `running` 工时行接管归零（返回 `{takenOver, items}`）。非职责＝不重派工单（重派走相位 2 的复活对账）、不判验收（走收割四要件）、不写平台状态。
- **内部结构**：`InflightTakeoverResult:31`、`takeOverRunningWorkRecords:38`。幂等实现细节由 `store` 保证。
- **导出与依赖**：2 个导出；依赖 `store`（`Ledger` 类型/查询）。**禁止**引 `engine.ts`（会成为环）；现实现无相对导入，保持。
- **IO 与注入**：台账写；时间由调用方传 `now`（不取系统时钟）。
- **状态与并发**：幂等——二次调用应 `takenOver: 0`（`test/assembly/inflight-takeover.test.ts:91-102` 断言两次调用与空台账）。
- **错误与观测**：无自有错误分类；失败即抛（启动期失败应阻止启机，不静默）。
- **测试与证据**：`apps/daemon/test/assembly/inflight-takeover.test.ts`（**本附录范围外**，归 17；此处只作证据锚）。
- **规模与验收**：47 行；维持叶子件，不得长出相位逻辑。

---

### 4.2 配置与权限（5 件）

#### F-DAEMON-ENGINE-BUDGET-GATE · `engine/budget-gate.ts` 〔现有〕

- **处置**：目标-保留（预算闸接线件；纯判定体在 `core`）。
- **归属/上位**：20-§六.8「预算预留-结算不落即不派」；80-§7 派发前置；77 预算/工时记录面。
- **职责 / 非职责**：职责＝派发前 `estimateDispatch`→`gateDispatch`→ 预留落账，收割后 `settleDispatch` 结算；`foldScopes` 折叠票级/人级预算态。非职责＝不决定是否派发（`core` 闸序）、不写事件、不判验收、不在态 B 猜价。
- **内部结构**：`ESTIMATE_CHARS_PER_TOKEN=4:74`、`ESTIMATE_OUTPUT_INPUT_RATIO=0.5:77`、`ESTIMATE_ROLE='main_worker':80`；`foldScopes:92`、`estimateDispatch:106`、`BudgetGateDeps:127`、`BudgetGateInput:134`、`BudgetGateDecision:155`（联合类型：放行/adopt/拒）、`gateDispatch:176`、`SettleDispatchInput:234`、`SettleDispatchResult:242`、`settleDispatch:258`。**两态**：态 A＝注入 `ModelCatalog`（校准估算+双帽）；态 B＝无价目表（适配器自报、仅票级帽）。
- **导出与依赖**：14 个导出；依赖 `contract`/`core`/`store`，无 `node:*`、无相对导入（叶子件）。
- **IO 与注入**：台账读写（预留行/结算行）；`catalog?` 注入；时间由参数给。
- **状态与并发**：幂等键＝(ticket, attempt)；`duplicate` 走 adopt 沿用既有未结预留（`budget-gate.test.ts` "duplicate 幂等" 面）；**失败保留**＝GATE_FAIL 不返还预留（成本按每成功交付记账，16-§三）。
- **错误与观测**：`BudgetGateDecision` 用类型区分拒绝原因（`over-ticket-cap`/`over-person-cap`/`refusal` 等，见 `cost-guard/seams.test.ts` "refusal over-person-cap"）；不得返回裸 `false`。
- **目标接口（未实现）**：`gateDispatch` 的返回从联合类型 `BudgetGateDecision` 改为 `Result<BudgetAdmit, ClassifiedError>`，让失败面与全域错误分类统一（§7.2）：
  - 超帽＝`Err({ failure:'rejected_precondition', category:'CONFIG_INVALID', subcause:'budget-over-ticket-cap' | 'budget-over-person-cap' })`——预算帽是配置面准入，**不是**外部拒绝（不得写成 `EXTERNAL_REJECT`），也**不是**可重试的 `unavailable`；
  - 无价目表（态 B）＝**不是错误**，仍是 `Ok`（`adapter` 自报 + 仅票级帽），只是估算精度降级；
  - 台账写失败＝原样传播 `store` 的 `Err`，不在此层改写 `category`。
  - `BudgetAdmit` 保留现有 `reserved`/`adopted`/`refusal` 三态语义（`refusal` 是「core 判定不派」，走 `Ok` 还是 `Err` 需按 80 的 `Result` 口径定：**建议 `Ok`**，因为「不派」是正常决策不是失败——此点在立本件返回类型实现单时按 80 口径裁定，**不占本卷 U81 号**，本卷不擅自定）。
- **金额类型**：`core`/`store` 现有行里的 `Money.usd: number` 只允许存在**内存运算与历史记录**；公共面（`BudgetAdmit`、事件 payload、跨包返回）目标用 `DecimalString` + 币种字段（78/80 的金额口径）。本件的估算/双帽比较可在内存用 `number`，但**不得**把 `number` 写进新的公共返回类型。
- **测试与证据**：`test/engine/budget-gate.test.ts`（555 行，五面：估算两态/预留先落/duplicate/结算与失败保留/无价目表降级）。**不证明**：真实价目表内容正确性、真实平台计费、跨进程并发预留（单进程台账）。
- **规模与验收**：280 行；新增档位或新帽须先落 80-§6 端口表。

#### F-DAEMON-ENGINE-LANES-REGISTRY · `engine/lanes/registry.ts` 〔现有〕

- **处置**：目标-保留（进程内 v0；已从 `engine.ts` 拆出的既有件之一）。
- **归属/上位**：20-§十五「先拆再增」；80-§7 并发四闸中的「泳道」闸；80-§6.2 `TS-PORT-AUTH-04 WriterLeasePort` 的**类比物**。
- **职责 / 非职责**：职责＝单号×泳道的进程内租约簿（`holder=单号`，TTL 到期视同无主）。非职责＝**不是写者租约**：80-§6.2 明写「泳道是派发互斥，租约是写者互斥」，两者可共用 TTL 实现但语义/记录/fence 都不同，**不得合并命名、不得互相替代**。跨进程双写由 `WriterLeasePort` 的持久 CAS（fence 每次换）承担，本件既不提供 fence 也不做跨进程互斥。也不做重试、不做持久化。
- **内部结构**：`LaneLease:12`、`LaneState:18`、`LaneRegistry:25`、`createLaneRegistry(laneTtlMs):31`（`acquire/release/state` 面）。
- **导出与依赖**：4 个导出；依赖 `contract`（单号类型）。
- **IO 与注入**：纯内存；TTL 由构造参数（来自 `EngineConfig.laneTtlMs`，缺省 30 分钟）。
- **状态与并发**：单进程单线程（Node 事件循环）；**崩溃即丢**是设计接受面——恢复靠台账在途行而非租约。
- **错误与观测**：`state()` 返回占用快照；无事件。**判负**：把泳道当跨进程互斥。
- **测试与证据**：无直接测试 import；经 `e2e.test.ts`「并发四闸」与 `stall-response` 间接覆盖。
- **规模与验收**：47 行；继续保持叶子件（<50 行量级）。

#### F-DAEMON-ENGINE-WORKER-KEY · `engine/worker-key.ts` 〔现有〕

- **处置**：目标-保留（生命周期接线件）；秘密供给面目标迁到 `contract/src/ports/secret.ts`（80-§11.2.1，§4.10 `S-ENGINE-CONTRACT-SECRET`），本件只消费 `SecretProvider`，不定义秘密类型。
- **归属/上位**：80-§6 端口、§11.2.1 秘密供给、`docs/17-§7`「wkey 按单签发、关单吊销」；78 的 `BIND-XCHG-01`（网关凭据）与 `BIND-EVD-01`。
- **职责 / 非职责**：职责＝worker 级 wkey 生命周期接线：`mintWorkerKey`（scope=`GATEWAY_ACTIONS` 全集）、`workerKeyCredentials`（env 通道）、`workerKeyGuidance`（任务书指引）、`revokeWorkerKey`（关单吊销）。非职责＝不实现签名/校验（`gateway` 包）、不决定生命周期点（相位 3/6 在 `engine.ts`）、不落盘秘密、不建 catalog。
- **秘密面纪律（80-§11.2.1，目标）**：
  - per-ticket wkey 是 `local-mint` 的**唯一例外**：不进静态 catalog、不落盘；`secretId` 按 `SEC-WKEY-<ticketId>` 派生（与 78-§7.4.1 同名同式）。
  - **活跃期才进** `KnownSecretSet`（签发即登记），`CLOSE`（关单/吊销）即**移除**；移除后不再参与脱敏，但按「轮换/吊销」条仍留一个去重窗的兜底窗口（本卷口径取 24h，具体窗长以 80 为准，不得自行放大）。
  - 用途枚举里 per-ticket wkey 只对应 `broker-issue` 面；`load(entry, use)` 的 `use` 校验在 `SecretProvider` 侧完成，本件**不得**绕过。
  - **worker 永不拿 `gatewaySecret`**：它不进 `KnownSecretSet` 之外的下发通道，也不随 `TaskBrief.credentials` 下发（80-§11.4.1）。
  - env 键现为 **`STUDIO_TOOLS_WKEY`**（`:62`），80-§11.4.1 的 per-ticket env **就是同一个键**（`serve.ts:810` 同口径），**不存在** `STUDIO_WKEY` 这个别名；`initialize._meta['studio-wkey']` 仅作 legacy 兼容；回给 daemon 的帧只允许 `wkeyRef`（逻辑引用 `SEC-WKEY-<ticketId>`，非秘密、不可转授）。
- **三条边界（80-§11.4.1 目标；现未实现，协议帧主文在 `81-files/15-studio-tools.md` 与 `81-files/06-gateway.md`，本卷不复制帧）**：
  - **内存签发登记**：daemon 侧须持 `(ticket, nonce, attempt/sessionRef)` 登记表，**保留到 attempt 结束**；现实现 `worker-key.ts:114-117` 的注释明确「daemon 侧不留副本（审计锚=DISPATCH note 携 nonce）」——即当前**没有**登记表，「同 nonce 二次使用」在 daemon 内存里查不出来。
  - **单一 `WkeyAuthority`**：签发、验签、关单吊销必须走**同一进程内实例**（`seenNonces` 与吊销集共享）；现状 `createGateway`（`packages/gateway/src/gateway.ts:65`）每次调用新建 `createWkeyAuthority`，导致各实例的 `seenNonces`/吊销集互不可见——这是缺陷，不是设计。
  - **单活跃会话**：同一 `(ticket, nonce)` 只允许**一个**活跃会话；第二个注册必须 `ok:false`。`verifySealed`/`consumeNonce:false` 亦未实现（U80-17）。
- **内部结构**：`WORKER_WKEY_ENV_KEY='STUDIO_TOOLS_WKEY':62`、`WORKER_WKEY_TTL_DEFAULT='24h':65`、`WorkerKeyDeps:70`、`MintedWorkerKey:85`、`mintWorkerKey:97`、`workerKeyCredentials:118`、`workerKeyGuidance:129`、`revokeWorkerKey:142`。
- **导出与依赖**：8 个导出；依赖 `contract`/`gateway`，`node:crypto`。
- **IO 与注入**：`WorkerKeyDeps` 端口（签发/吊销回调）；env 通过 `TaskBrief.credentials` 注入，**不**写进程 env、不写文件。
- **状态与并发**：一 attempt 一 key；GATE_FAIL/断路＝env 离场**不吊销**（非终局），CLOSE＝吊销（终局）；重派重签（`worker-key-lifecycle.test.ts` 五面）。
- **错误与观测**：吊销返回 `boolean`；无事件（凭据面不入台账，属秘密边界）。目标：签发/吊销失败经 `SecretProvider` 的 `ClassifiedError` 上报（不可用＝`unavailable`+`STALL`；`use` 越权＝`rejected_forbidden`+`EXTERNAL_REJECT`），**不得**把失败吞成 `false` 后继续派发。
- **测试与证据**：`worker-key.test.ts`（形状/env/吊销轮换）、`worker-key-lifecycle.test.ts`（dispatch 签发、拒派不签发、GATE_FAIL 重签、断路不吊销、CLOSE 吊销、未注入零变更、进程内 `InMemoryTransport` 的凭据透传）。**不证明**：真实 gateway 签名校验、stdio/跨进程、`_meta` 通道的现行有效性（`_meta` 仅 legacy）。
- **规模与验收**：146 行；**判负**：把 token 写进日志/事件/REPORT；worker 拿到 `gatewaySecret`；把 per-ticket wkey 写进静态 catalog。

#### F-DAEMON-ENGINE-TOOLS-ID · `engine/tools/id.ts` 〔现有〕

- **处置**：目标-保留（`engine/tools/` 现 2/10 件，未触升格阈）。
- **归属/上位**：`store` 的 ULID 契约（format 校验在 store；生产侧生成在 daemon）。
- **职责 / 非职责**：职责＝`makeUlid(ts)`：Crockford Base32，26 字符＝48bit 时间戳+80bit `crypto` 随机。非职责＝不做唯一性登记、不做单调保证（同毫秒可重复顺序不定）。
- **内部结构**：单函数导出（`:24`），`node:crypto`。
- **导出与依赖**：1 个导出；零包依赖、零相对导入——`engine/tools/` 的基数件。
- **IO 与注入**：随机来自 `crypto`；时间由参数（调用方传 `clock()` 的值），**不在函数内取系统时间**。
- **状态与并发**：无状态；碰撞概率由 80bit 随机承载。**判负**：用 `Math.random()` 替代 `crypto`、或把时间戳当唯一性来源。
- **错误与观测**：无错误路径。
- **测试与证据**：被 12 个测试文件直接 import（`jobs/*`、`cost-*`、`hrsync/*`、`postmortem`、`panel-judge-align` 等，实测 `grep -rl engine/tools/id`）。
- **规模与验收**：26 行；新增工具件只能落 `engine/tools/`，累计 >10 触发 `packages/base` 升格（20-§十五.五）。

#### F-DAEMON-ENGINE-TOOLS-GATED-PLATFORM · `engine/tools/gated-platform.ts` 〔现有〕

- **处置**：目标-保留并迁移职责（`engine/tools/` 第 2 件）；现有 `createGatedPlatform` 未改前仍是旧写闸，目标改造未完成。
- **归属/上位**：`docs/17-§7`「一切写入经 wkey 网关」；78 `BIND-PLAT-*` 与 §5.4 的回执绑定；80-§6.6 `EffectWriter` 内部执行面。
- **现状职责**：`createGatedPlatform(platform,gateway,opts)` 把 `FlowPlatform` 写面先过网关再调底层、读面直通。**目标职责**：提供 `EffectWriter` 的 Nine-write 分发与回执核验，接收已验签的结构化调用，不再自己 mint token、验签或生成第二份授权映射。读写二分名单保留作覆盖检查；授权编码只在 `packages/gateway/src/actions.ts`。
- **内部结构（目标）**：`createPlatformEffectWriter(platform,binding)` + 九个平台方法的穷尽 dispatch + 每动作回执核验。`committed` 必带原生外部引用/执行后版本；`void`、仅排队或不可核回应只能 `unknown`。平台绑定负责实际读回/回执方法，缺能力不得伪证成功。旧 `createGatedPlatform` 与目标 writer 不得同时写同一事实域；切换由 17 按冻结旧写者→独占交接→迟到对账执行。
- **导出与依赖**：现有 4 个导出；目标增加 `createPlatformEffectWriter`，复用 `contract` 的内部结构类型，不引入具体平台包、store 或 `node:*`。`EffectWriter` 类型归属 80/16 的 daemon 内部面，不新增公共端口。
- **IO 与注入**：副作用只经注入的 `FlowPlatform`/绑定回执面；不自建网络连接、不读 env、不直写台账。
- **状态与并发**：无事实状态；不对未知结果自动重试。`idempotencyKey` 透传给支持原生幂等的绑定；唯一 attempt 与恢复归 `EffectGateway`/REC-06，本件不声称恰好一次物理效果。
- **错误与观测**：`Err` 仅表示确定未产生效果的拒绝；已发送后结果不明回 `unknown` 供登记。不得把平台 `void` 响应当作带版本的 `committed`。
- **测试与证据**：现有 `test/engine/gated-platform.test.ts`（437 行）只证明旧包装；目标补九动作穷尽、零二次验签、回执缺字段只能 unknown、绑定读回失败、迟到结果与原生幂等键透传。真实平台证据仍归 82。
- **规模与验收**：现 208 行，目标 ≤300 行；**判负**：新增平台方法未登记、迁移期双闸双写、绕过统一编码或伪造回执。

---

### 4.3 采集与状态（19 件）

#### F-DAEMON-ENGINE-SENTINEL-EVENTS-INDEX · `engine/sentinel/events-index.ts` 〔现有〕

- **处置**：目标-保留。
- **归属/上位**：80-§7 相位 1「每拍从台账全量事件流重建」；77 的 `RUN-EVD-01`（事件即事实投影）。
- **职责 / 非职责**：职责＝`buildEventIndex(events)` 把事件流折成决策所需的**派生索引**：attempt 计数、在工键、闭集（`closed`）、STALL 连击、PATROL 物化键、未知态哨键（`ticket|state`）、巡逻核漂移状态名键。非职责＝不写台账、不判状态（`core` 判）、不缓存跨拍（**每拍重建**＝可重放）。
- **内部结构**：`EventIndex:66`、`buildEventIndex:151`；锚点常量 `STALL_KILL_CLOSE_ANCHOR='工位收口 interrupted':47`、`MERGE_RUN_ANCHOR:59`、`MERGE_MANUAL_ANCHOR:60`、`MERGE_CHAIN_ANCHOR:61`、`MERGE_CONFLICT_ANCHOR:63`（note 文本即索引键，改文本＝改索引语义）。
- **导出与依赖**：6 个导出；依赖 `contract`；相对导入 `directive/index.ts`（批示派生：APPROVE 置位、DISPATCH 清零、ESCALATE 不站立）。
- **IO 与注入**：纯函数（输入事件数组）；无时钟、无随机、无 fs。
- **状态与并发**：无内部状态；**幂等由重建保证**——同一事件流必得同一索引（重放不变）。
- **错误与观测**：不做错误分类；未知 note 形态＝不产生键（静默丢弃），这是**已知弱面**：note 文本是字符串协议，无 schema 校验（U81-06）。
- **测试与证据**：`sentinel/events-index-job-anchor.test.ts`（59 行，岗单锚 `jobAnchorOf`）、`directive/parse-qualify.test.ts`（批示派生）、`merge/merge-lease.test.ts` 与 `merge/merge-run.test.ts`（合并锚）。
- **规模与验收**：292 行；新增锚点常量须同步 note 生产者与测试三处。

#### F-DAEMON-ENGINE-SENTINEL-SENTINELS · `engine/sentinel/sentinels.ts` 〔现有〕

- **处置**：目标-保留（相位 1 尾）。
- **归属/上位**：`docs/52-§十` DEV-49 A4 双哨；77 的异常/发现协议（`RUN-EXC-*`）。
- **职责 / 非职责**：职责＝`runDev49Sentinels` 双哨（未知态哨：流外态 ESCALATE 每单每态一次；状态集巡逻核：schema 状态集 − 声明集 ≠∅ → 心跳哨兵单），`heartbeatSentinelRecord` 生成心跳观测单。非职责＝不修状态（治增量回流；存量归化归 `@studio-next/taiga` factory）。
- **内部结构**：`SentinelEmit:37`、`Dev49SentinelDeps:40`、`Dev49SentinelOut:84`、`heartbeatSentinelRecord:101`、`runDev49Sentinels:113`。
- **导出与依赖**：5 个导出；依赖 `contract`/`core`；无相对导入。
- **IO 与注入**：经 `SentinelEmit` 回调与 `deps` 注入平台/台账；时间由参数；`statusSetPatrolEveryTicks` 节流在 `engine.ts:1623` 处生效。
- **状态与并发**：幂等键＝(`ticket`,`state`) 与状态名；节流计在 `EngineConfig`。
- **错误与观测**：哨兵自身失败进 `errors`（字符串面，U81-04）；告警单走 `ESCALATE`。
- **测试与证据**：无直接 import；由 `unknown-state-sentinel.test.ts`（352 行，四面含 127-C 州表白名单）经 `engine.tick()` 断言。
- **规模与验收**：188 行。

#### F-DAEMON-ENGINE-SENTINEL-SHAPE · `engine/sentinel/shape.ts` 〔现有〕

- **处置**：目标-保留（自 `engine.ts` 抽件的纯函数组）。
- **归属/上位**：80-§4 公共端口的形状面；77 事件四要素与观察协议。
- **职责 / 非职责**：职责＝事件四要素裁剪缺省（`evtLevel`/`evtDept`）、token 四桶（`tokenBuckets`）、人闸快照（`personLimitFor`/`personGateSnapshot`）。非职责＝不做闸序判定（`core`）、不读台账。
- **内部结构**：`evtLevel:11`、`evtDept:15`、`tokenBuckets:24`、`PersonLimitInputs:34`、`personLimitFor:45`、`personGateSnapshot:54`。
- **导出与依赖**：6 个导出；依赖 `contract`。纯函数、显式参数、零引擎闭包。
- **IO 与注入**：零 IO。
- **状态与并发**：无状态。
- **错误与观测**：缺省值即语义（`level`/`dept` 缺失时的回退）；**判负**：在此处塞业务阈值。
- **测试与证据**：无直接 import；经 `e2e`/`todoqueue`/`cost-guard` 等 e2e 面断言。
- **规模与验收**：65 行。

#### F-DAEMON-ENGINE-DIRECTIVE-INDEX · `engine/directive/index.ts` 〔现有〕

- **处置**：目标-保留（特性域 barrel；20-§十五.四 contrib 模式范例）。
- **职责 / 非职责**：职责＝四处再出口（`parse`/`qualify`/`wire`/`serve-config`），使 `engine.ts` 只依赖一个入口。非职责＝不含逻辑。
- **内部结构**：4 条 `export … from`（`:10`、`:11`、`:19`、`:27`）。
- **导出与依赖**：再出口 20+ 符号；零包依赖。
- **IO/状态/错误**：全部为零（纯 barrel）。
- **测试与证据**：`directive/parse-qualify.test.ts`、`merge/merge-run.test.ts` 直接 import 本文件。
- **规模与验收**：27 行；**判负**：在 barrel 里加分支或默认导出。

#### F-DAEMON-ENGINE-DIRECTIVE-PARSE · `engine/directive/parse.ts` 〔现有〕

- **处置**：目标-保留（纯函数核，冻结面）。
- **归属/上位**：`130-§6.1.2`、`docs/18-§2.5`；批示是**载体**不是新事件类型（`GATEWAY_ACTIONS` 零增删）。
- **职责 / 非职责**：职责＝`parseDirectiveComment(body)` 解析行首「批示:」+ 四动词（`批准`/`打回`/`拆单`/`搁置`，`:14`）。非职责＝不校验权限（`qualify`）、不执行（`wire`）、不解析拆单清单（`split/directive.ts`）。
- **内部结构**：`DIRECTIVE_VERBS:14`、`DirectiveVerb:15`、`DirectiveParse:20`（判别联合）、`parseDirectiveComment:32`。
- **导出与依赖**：4 个导出；零包依赖、零相对导入——**最纯叶子件**。
- **IO 与注入**：零 IO、零时钟。
- **状态与并发**：无状态；词表 v1 冻结，增词＝改规范（130-§6.1.2）＋改测试。
- **错误与观测**：`DirectiveParse` 用联合区分「非批示/未知动词/格式错」；**fail-closed**。
- **测试与证据**：经 `directive/index.ts` 由 `parse-qualify.test.ts` 覆盖（词表四动词、行式=行首半角冒号）。
- **规模与验收**：52 行。

#### F-DAEMON-ENGINE-DIRECTIVE-QUALIFY · `engine/directive/qualify.ts` 〔现有〕

- **处置**：目标-保留。
- **归属/上位**：`130-§6.1.2`、`202-P1`（dispatcher 源+验收位别律 R3）；77 的授权/拒绝协议（`RUN-AUTH-*`）。
- **职责 / 非职责**：职责＝`buildDirectiveAuthorizer` 构造角色校验闭包：白名单={单所属部门 leader}∪{组织锚白名单}∪{制作人}∪{本单 dispatcher}；未知 actor＝拒（fail-closed）。非职责＝不解析批示文本、不改状态。
- **内部结构**：`DirectivePerson:15`、`DirectiveIssueFacts:24`、`DirectiveGateDeps:44`、`DirectiveQualify:53`（联合）、`DirectiveAuthorizer:57`、`buildDirectiveAuthorizer:72`。
- **导出与依赖**：6 个导出；相对导入 `./parse.ts`（动词类型）；零包依赖。
- **IO 与注入**：人/部门事实由入参快照给（不读公司目录）。
- **状态与并发**：闭包持有白名单快照；热重载＝整组换（`applyCompanyUpdate`）。
- **错误与观测**：拒绝原因在 `DirectiveQualify` 里可区分（非白名单/派单律不符/位别不符）。
- **测试与证据**：`directive/parse-qualify.test.ts`（白名单三源、派单律、202-P1 扩位）。
- **规模与验收**：110 行；**判负**：白名单「空即放行」。

#### F-DAEMON-ENGINE-DIRECTIVE-SERVE-CONFIG · `engine/directive/serve-config.ts` 〔现有〕

- **处置**：目标-保留（装配缝；serve 侧调用）。
- **归属/上位**：`docs/18-§2.5`；80-§3 组合根纪律（配置归一在 assembly，引擎只收构造好的 deps）。
- **职责 / 非职责**：职责＝`parseWhitelistSpec(raw)`（daemon.yaml 白名单串→数组，非法返回 `undefined`）与 `buildServeDirectiveDeps`（快照装配）。非职责＝不读 yaml（由 assembly 读）、不做权限判定。
- **内部结构**：`ServeDirectiveOptions:11`、`parseWhitelistSpec:22`、`buildServeDirectiveDeps:28`。
- **导出与依赖**：3 个导出；相对导入 `./qualify.ts`；零包依赖。
- **IO 与注入**：零 IO；输入为已解析配置。
- **状态与并发**：构造期一次；热重载整组替换。
- **错误与观测**：非法白名单＝`undefined`（缺省＝部长表），**不抛**——须在 serve 侧明报（U81-07 待核）。
- **测试与证据**：无直接 import；由 `directive/*.e2e.test.ts` 经 serve 装配间接覆盖。
- **规模与验收**：38 行。

#### F-DAEMON-ENGINE-DIRECTIVE-WIRE · `engine/directive/wire.ts` 〔现有〕

- **处置**：目标-保留（相位 1 尾的接线体，非新相位）。
- **归属/上位**：`130-§6.1.2`、`202-P1`（验收位打回→已派发+resume 物化）；80-§7 相位 1。
- **职责 / 非职责**：职责＝`runDirectiveLayer`：受影响单拉评论→解析→角色校验→站立/打回；`approvalSlotOf` 定位批准槽（pre-dispatch / post-verified）；`reboundSuppressed` 防回流；`engineDirectiveDeps` 组装闭包。非职责＝不决定流（`core`）、不物化子单（`split/`）。
- **内部结构**：`DirectiveLayerDeps:27`、`DirectiveLayerResult:56`、`EngineDirectiveClosures:72`、`engineDirectiveDeps:88`、`runDirectiveLayer:113`、`reboundSuppressed:280`、`approvalSlotOf:296`。
- **导出与依赖**：7 个导出；包依赖 `contract`/`core`；相对导入 `./parse.ts`、`./qualify.ts`、`../intents/taxonomy.ts`（`noteSafe` 同源）。
- **IO 与注入**：平台评论读（经 `FlowPlatform` 端口）、事件写（经父闭包）；时钟由父给。
- **状态与并发**：幂等＝同一评论 eventoId 只消费一次（由索引与 `seenIntentKeys` 面配合）；相位 1 内顺序处理，不并发写同一单。
- **错误与观测**：失败进 `errors`（`engine.ts:1654` 处 `errors.push(msg)`）。
- **测试与证据**：`directive/directive.e2e.test.ts`（513 行，S4 归一×防御、S5 打回闭环）、`directive/acceptance.e2e.test.ts`（345 行，S2 验收位、S3 打回重做链）。
- **规模与验收**：307 行；**判负**：把批示当成新的平台动作类型（必须复用 comment 载体）。

#### F-DAEMON-ENGINE-INTENTS-TAXONOMY · `engine/intents/taxonomy.ts` 〔现有〕

- **处置**：目标-保留（六类意图中三类：mention / webhook / data-change）。
- **归属/上位**：`129-§6.1` 意图分类学；80-§6 端口与 `InvokeIntent` 契约；78 的 `BIND-*` 输入面。
- **职责 / 非职责**：职责＝三个 payload 契约件（`checkMentionPayload`/`checkWebhookPayload`/`checkDataChangePayload`，含指纹与路由解析）＋三个消费者工厂（`createMentionConsumer`/`createWebhookConsumer`/`createDataChangeConsumer`）＋`noteSafe`（note 净化，全域共用）。非职责＝不派工（webhook 只落单）、不起源（源在 `sources.ts` 家族）、不判状态。
- **内部结构**：`MentionIntentPayload:36`、`checkMentionPayload:59`、`mentionTicketTitle:75`、`mentionTicketDescription:81`、`WebhookIntentPayload:96`、`checkWebhookPayload:110`、`DataChangeIntentPayload:124`、`checkDataChangePayload:146`、`dataChangeFingerprint:167`、`parseDataChangeRoutes:182`、`mergeDataChangeRoutes:208`、`noteSafe:221`、`IntentConsumerDeps:272`、三个消费者 `:298`/`:350`/`:410`。
- **导出与依赖**：16 个导出；依赖 `contract`/`core`；无相对导入。
- **IO 与注入**：意图 payload 校验零 IO；消费者经 `IntentConsumerDeps` 注入平台/台账；`noteSafe` 是唯一的 note 转义点（分号/换行清洗）。
- **状态与并发**：幂等＝`intentKey`（daemon 侧键）＋指纹（data-change）；重复消费由 `seenIntentKeys` 派生面拦。
- **错误与观测**：checker 返回 `payload | string`（字符串＝拒绝理由）——**形状不一致**（非结构化错误），与 80-§7.1 冲突。**目标（未实现）**：`checkXxxPayload` 返回 `Result<Payload, ClassifiedError>`；格式/必填缺失＝`Err({failure:'rejected_precondition',category:'CONFIG_INVALID',subcause:'payload-malformed'})`，来源未授权＝`Err({failure:'rejected_forbidden',category:'EXTERNAL_REJECT',subcause:'source-not-allowed'})`。**`Err` 的 category 只许落在 80 允许的 6 个内**，不得自造。
- **意图键（目标）**：`intentKey` 的第四位是 `ticket ?? dedupKey`（`core/src/decide.ts:319-322` 现式 `[source, kind, company, ticket ?? dedupKey].join('|')`）；`IntentKey` 的**唯一**构造点在 `contract`（§4.10），本件只调用不重写。
- **payload 边界**：`explore`/`task`/`intel` 是 `RequestKind`（请求种类），**只进 payload**，不得进 `IntentKind`（`IntentKind` 八值固定：`ticket|mention|schedule|relay|resume|webhook|escalate|data-change`）；`REC-WORK-01.source.kind` 对外部面恒 `'webhook'`，`channel` 恒 `'external-api'`。
- **测试与证据**：`wake/mention-intents.test.ts`（378 行）、`wake/webhook-datachange-intents.test.ts`（542 行）、`hrsync/people-change{,-source}.test.ts`（路由与指纹）。**不证明**：真实平台 webhook 签名/重放防护、跨进程去重。
- **规模与验收**：465 行；**判负**：外部事件按可信输入处理、跳过 `noteSafe`。

#### F-DAEMON-ENGINE-INTENTS-ESCALATE · `engine/intents/escalate.ts` 〔现有〕

- **处置**：目标-保留（阈值类意图；`132-§6.4` 四档接线）。
- **归属/上位**：`129-§6.1②`；77 的升级协议（`RUN-EXC-*`）；`docs/25-§3.4`。
- **职责 / 非职责**：职责＝`checkEscalatePayload` 契约、`costThresholdKey`（单源公式）、`mergeCostThresholdDefaults`、`createCostNotifyOutlet`（即时提醒出口）、`createEscalateConsumer`（四档处置：watch/notify｜warn/dispatch｜alarm/dispatch+notify｜hard/gate）。非职责＝不评估成本（`cost-guard/`）、不派工（走 dispatchQ）。
- **内部结构**：`CostThresholdFacts:34`、`EscalateIntentPayload:47`、`checkEscalatePayload:59`、`costThresholdKey:96`、`CostThresholdNotice:105`、`mergeCostThresholdDefaults:126`、`createCostNotifyOutlet:143`、`EscalateConsumerDeps:192`、`createEscalateConsumer:221`。
- **导出与依赖**：9 个导出；依赖 `contract`；相对导入 `./taxonomy.ts`（`noteSafe`）。
- **IO 与注入**：平台/台账经 deps；notify 出口注入（缺省＝log 行）。
- **状态与并发**：幂等键＝`costThresholdKey(scope,period,tier)`——**同拍多醒按 dedupKey 分立**（`cost-guard/consume.test.ts`）。
- **错误与观测**：四档处置必须**明报**；`fail-closed`＝判负全明报（同测试面）。
- **测试与证据**：`cost-guard/consume.test.ts`（445 行，P0-B 端到端）、`notify/relay.test.ts`（成本警戒出口）。
- **规模与验收**：331 行；`costThresholdKey` 公式改动＝跨面契约变更（源/消费/断言三处同改）。

#### F-DAEMON-ENGINE-INTENTS-DRAIN · `engine/intents/drain.ts` 〔现有〕

- **处置**：目标-保留（相位 2 前置）；目标新增一段「受理落账」——经 `EngineDeps.workIntake?.intake` 写 `REC-WORK-02`（§3.4）。
- **归属/上位**：80-§7 相位 2；`105-刀A A-2` 消费门（前置共闸对全 kind 一致）；80-§6.6 `WorkIntake.intake`。
- **职责 / 非职责**：职责＝`drainIntents(deps)` 取 `pendingIntents` 并按 `kind→handler` **普适分发表**逐条消费，返回 `RelayResumeFaces`。**目标**：消费受理成功后调 `workIntake.intake(invokeIntent)`，取其 `IntakeOutcome.outcome`（五值 `accepted|accepted_with_conditions|deferred|rejected|forwarded`）写进本拍汇报；`forwarded` 必带 `referredTo`（`{positionRef,deadline,notifiedAt}`，`positionRef.kind` 只 `position|governance-position`）。非职责＝不定义各 kind 语义（在各消费件）、不做状态决策、不派工、**不写 `intent_receipts`**（回执投影的写维护者是 ingress 驱动的 `IntentReceiptStore`，本件只产生 `REC-WORK-02`）。
- **内部结构**：`DrainDeps:35`、`drainIntents:75`；相对导入 `./taxonomy.ts`、`./escalate.ts`、`./relay-resume-faces.ts`。目标新增可选依赖字段 `workIntake?: Pick<WorkIntake,'intake'>`（从 `DrainDeps` 透传 `EngineDeps.workIntake`）。
- **导出与依赖**：2 个导出；依赖 `contract`/`core`/`store`。
- **IO 与注入**：经 deps 注入；消费顺序＝队列序（不可并行以免同单交错）。
- **状态与并发**：消费成功的意图从队列出队（出队/收账锚在 `engine.ts`）；重复消费由幂等键与 `seenIntentKeys` 拦；**消费半途失败不得出队**（否则丢意图）。
- **错误与观测**：单条失败不阻断其余（隔离）；失败面汇总进 `errors`——**目标**为 `ClassifiedError[]`（`failure` 处置轴 + `category` 观测轴，两轴分列，**不得**把 `category` 当 `failure` 写，§7.2）。`workIntake` 未注入＝**面关**：不写 `REC-WORK-02`，回执停 `queued` 并在汇报里明报（对应 `gap:'intake-link-missing'` 的来源），**不得**伪造 `accepted` 之类的受理结论。
- **投影同步（已定，不再是缺口）**：相位 2 判定后由本件调 `intake` 写 `REC-WORK-02`，**同一事务**内 store 的 projection hook 把 `intent_receipts` 行更新为 `decided`，commit 后同一微任务更新内存快照（80-§6.6 规则 7）。引擎侧**不**私接投影刷新，也不需要「判完信号」——投影跟随记录走。
- **测试与证据**：`sentinel/events-index-job-anchor.test.ts` 直接 import；主面由 `wake/*` 三测试与 `cost-guard/consume.test.ts` 经 `engine.tick()` 覆盖。**不证明**：`REC-WORK-02` 的真实写入（目标未实现）、跨进程重放。
- **规模与验收**：208 行；**判负**：新增 kind 时跳过本表（会出现「永不消费」的静默黑洞）。

#### F-DAEMON-ENGINE-INTENTS-RELAY-RESUME · `engine/intents/relay-resume.ts` 〔现有〕

- **处置**：目标-保留（接力/续命两 kind 的消费语义）。
- **归属/上位**：`129-§6.1⑥`、`§6.4 C6`；77 的 `RUN-WORK-06`（接力→记录）、`RUN-STATE-01`（状态推进）。
- **职责 / 非职责**：职责＝两 payload 契约（`checkRelayPayload`/`checkResumePayload`）、断点解析（`resolveResumePlan`：三不可续面 + 可续面）、适配器选择（`pickResumeAdapter`）、两消费者（`createRelayConsumer`＝零物化重估；`createResumeConsumer`＝断点续跑）。非职责＝不起源（`relay-resume-sources.ts`）、不装配派发面（`relay-resume-faces.ts`）。
- **内部结构**：`RelayIntentPayload:62`、`checkRelayPayload:70`、`ResumeIntentPayload:85`、`checkResumePayload:93`、`ResumeDispatchPlan:109`、`ResumePlanOutcome:130`、`resolveResumePlan:147`、`pickResumeAdapter:195`、`RelayResumeConsumerDeps:224`、`createRelayConsumer:242`、`createResumeConsumer:272`。
- **导出与依赖**：11 个导出；依赖 `contract`/`store`，`node:fs`（读上次 `summary.json` 前情）。无相对导入。
- **IO 与注入**：fs＝读工位上次 `summary.json`；平台/台账经 deps。
- **状态与并发**：`resolveResumePlan` 是**纯读**（只读台账 + 文件），返回可续或不可续原因；续跑幂等＝同 attempt 不重复续（由 attempt 计数与 DISPATCH 锚定）。
- **错误与观测**：不可续面必须明报（`{unavailable: string}`，`:130`），不得静默降级为新派。
- **测试与证据**：`wake/relay-resume-intents.test.ts`（549 行，九面：payload/断点三不可续/relay 源/resume 源/wire 装配/零物化重估/续跑 e2e/两降级面/onWorkComplete）。
- **规模与验收**：301 行。

#### F-DAEMON-ENGINE-INTENTS-RELAY-RESUME-FACES · `engine/intents/relay-resume-faces.ts` 〔现有〕

- **处置**：目标-保留（engine 装配缝）。
- **职责 / 非职责**：职责＝`resumeDispatchFace`（`executeDispatch` 的续跑派发面：适配器选择+观测锚+装配入参）与 `wireRelayResumeFaces`（两缝接线）。非职责＝不含消费语义、不含相位逻辑。
- **内部结构**：`ResumeDispatchFace:18`、`resumeDispatchFace:39`、`RelayResumeFaces:71`、`wireRelayResumeFaces:85`。
- **导出与依赖**：4 个导出；依赖 `contract`/`store`；相对导入 `./relay-resume.ts`。
- **IO 与注入**：全经参数（平台/台账/装配器）；零时钟。
- **状态与并发**：无状态；纯装配。
- **错误与观测**：派发失败由调用方（`engine.executeDispatch`）收口。
- **测试与证据**：无直接 import；经 `wake/relay-resume-intents.test.ts` 的「wire 装配件」与「续跑端到端」面覆盖。
- **规模与验收**：106 行。

#### F-DAEMON-ENGINE-INTENTS-RELAY-RESUME-SOURCES · `engine/intents/relay-resume-sources.ts` 〔现有〕

- **处置**：目标-保留（源侧；与消费件分工＝源只产意图）。
- **归属/上位**：`129-§6.1⑥`、`§6.4 C6`；80-§6 的 `InvokeSource` 端口；`docs/22-§一`（源是插件）。
- **职责 / 非职责**：职责＝`createRelaySource`（收割完成信号→relay 意图，誓作用域防抖）、`createResumeSource`（续命推送面）、`wireRelaySource`/`wireResumeSource` 注册件。非职责＝不消费、不改台账、不派工。
- **内部结构**：`RELAY_SOURCE_NAME='relay':33`、`RESUME_SOURCE_NAME='resume':43` 与两份 manifest；`RelayWorkSignal:57`、`RelayResumeSourceDeps:65`、`RelaySource:73`、`RelaySourceStats:84`、`createRelaySource:95`、`ResumeSource:139`、`ResumeSourceStats:151`、`createResumeSource:162`、`wireRelaySource:203`、`wireResumeSource:209`。
- **导出与依赖**：11 个导出；依赖 `contract`；相对导入 `../sources.ts`（注册表类型）。
- **IO 与注入**：经 `SourceRegistry`（`startAll(emit)` 回调）；零时钟（at 由注册表给）。
- **状态与并发**：源内可持有防抖状态；at-least-once 产出，**恰好一次**由引擎幂等键保证（`129-§6.1` 铁律 2）。
- **错误与观测**：源错误计入 `SourceRegistryStats.sourceErrors/lastSourceError`（`sources.ts`）。
- **测试与证据**：`wake/relay-resume-intents.test.ts`（relay 源、resume 源、wire 三件套）。
- **规模与验收**：213 行。

#### F-DAEMON-ENGINE-SPLIT-DIRECTIVE · `engine/split/directive.ts` 〔现有〕

- **处置**：目标-保留（纯解析件）。
- **归属/上位**：`130-§6.1.2/§6.2.2`（制作人 2026-10-22 全批）。
- **职责 / 非职责**：职责＝`parseSplitDirective(body)`：批示:拆单 评论正文 → 子单清单（`SplitParseResult` 判别联合，strict 校验 fail-closed）；`splitChildKey`/`splitFilingKey` 幂等键；`splitChildDescription` 渲染。非职责＝不建单（`materialize.ts`）、不推荐人选（`suggest.ts`）、零 IO 零时钟。
- **内部结构**：`SplitChildSpec:33`、`SplitParseResult:43`、`parseSplitDirective:87`、`splitChildKey:144`、`splitFilingKey:149`、`splitChildDescription:157`。
- **导出与依赖**：6 个导出；依赖 `contract`；无相对导入。
- **IO 与注入**：零 IO。
- **状态与并发**：键的幂等性＝同一父单同一 seq 恒同键（跨重启稳定）。
- **错误与观测**：解析失败给 `reason`，不抛。
- **测试与证据**：`split/directive.test.ts`（112 行，语法/strict/幂等键）。
- **规模与验收**：173 行；**判负**：把解析放宽成「尽力而为」（会产生半成品子单）。

#### F-DAEMON-ENGINE-SPLIT-MATERIALIZE · `engine/split/materialize.ts` 〔现有〕

- **处置**：目标-保留（相位 2 前置①b）。
- **归属/上位**：`130-§6.2.2`「意图→daemon 单点建单」；`§6.2.3-R2`；78 的 `BIND-PLAT-*`（经写收口）。
- **职责 / 非职责**：职责＝`createSplitMaterializer(deps)` 返回物化器：子单建单（经 gated 平台写）+ 父单立案收口。非职责＝不解析批示（`directive.ts`）、不决定人选（`suggest.ts` 只出建议）。
- **内部结构**：`SplitDirectiveInput:44`、`SplitMaterializerDeps:54`、`createSplitMaterializer:144`。
- **导出与依赖**：3 个导出；依赖 `contract`/`core`/`gateway`/`store`；相对导入 `./directive.ts`、`./suggest.ts`、`../intents/taxonomy.ts`。
- **IO 与注入**：平台写（经 `Gateway` 收口）、台账写；时钟与 ID 注入。
- **状态与并发**：幂等＝`splitChildKey` + `splitFilingKey`（判负线＝双建，`split/split.e2e.test.ts` S6）。
- **错误与观测**：部分成功必须明报（已建子单不回收；父单立案失败留痕）。
- **测试与证据**：无直接 import；由 `split/split.e2e.test.ts`（411 行，S6 幂等/S7 全链）经 `engine.ingestSplit` 覆盖。
- **规模与验收**：297 行。

#### F-DAEMON-ENGINE-SPLIT-SUGGEST · `engine/split/suggest.ts` 〔现有〕

- **处置**：目标-保留（建议面，**决定权在部长**）。
- **归属/上位**：`130-§6.5.2`。
- **职责 / 非职责**：职责＝`suggestAssignees(child, ctx)` 三因子打分 + `renderSuggestionComment` 评论文本。非职责＝不自动指派、不写平台（建议以评论形式给出）。
- **内部结构**：`SuggestContext:21`、`CandidateSuggestion:33`、`suggestAssignees:66`、`renderSuggestionComment:132`。
- **导出与依赖**：4 个导出；依赖 `contract`；纯函数零 IO 零随机（打分必须确定性）。
- **IO 与注入**：零 IO。
- **状态与并发**：无状态；同输入必同序（排序稳定性是契约）。
- **错误与观测**：无候选＝空数组（不静默改成「全公司」）。
- **测试与证据**：`split/suggest.test.ts`（104 行，三因子打分/评论文本）。
- **规模与验收**：146 行；**判负**：引入随机或 LLM 打分（不可复算）。

#### F-DAEMON-ENGINE-TODOQUEUE-QUEUE · `engine/todoqueue/queue.ts` 〔现有〕

- **处置**：目标-保留（域件；`engine.ts` 只留相位缝）。
- **归属/上位**：`129-§6.2`（制作人 2026-10-22 全批）；80-§7 相位 2 定序与相位 7 尾投影。
- **职责 / 非职责**：职责＝成员资格（`queueMembership`）、携带态（`seedQueueCarry`/`touchQueueCarry`/`dropQueueCarry`）、定序（`orderCandidates` + `ageBoostTier`）、投影（`projectTodoQueue`/`todoQueueDiffers`）、优先级结算（`settlePendingQueuePriority`）、配置解析（`parsePersonInflightOverrides`/`parsePinnedTickets`/`queueServeOverrides`）。非职责＝不做闸序判定（`core`）、不派工、不写平台。
- **内部结构**：`QueueCarryEntry:51`、`QueueCarry:61`、`seedQueueCarry:64`、`touchQueueCarry:80`、`dropQueueCarry:97`、`QueueMemberSource:108`、`queueMembership:124`、`QueueCandidateMeta:140`、`queueCandidateMeta:149`、`orderCandidates:168`、`ProjectTodoQueueInput:201`、`projectTodoQueue:221`、`todoQueueDiffers:256`、`PendingPriorityEntry:263`、`settlePendingQueuePriority:286`、`parsePersonInflightOverrides:321`、`parsePinnedTickets:344`、`DEFAULT_QUEUE_AGE_STEP_MS`（再出口 `:352`）、`queueServeOverrides:358`。
- **导出与依赖**：19 个导出；依赖 `contract`/`core`/`store`（记录类型）；无相对导入。
- **IO 与注入**：零 IO；台账行以值传入/传出（纯投影）。
- **状态与并发**：`QueueCarry` 是拍间内存态，**崩溃可从 `todo_queue` 行重种**（`seedQueueCarry`）；投影幂等＝`todoQueueDiffers` 判是否重写。
- **错误与观测**：解析失败＝`undefined`（走缺省），须明报（U81-07）。
- **测试与证据**：`todoqueue/person-gate-queue.test.ts`（538 行，纯函数四面 + R2/R3/R4/R5 引擎级红证）。
- **规模与验收**：370 行；四闸序（断路 > 泳道 > 人 > 每拍 > 在途）冻结，改动＝提案流。

#### F-DAEMON-ENGINE-TYPEFLOWS · `engine/typeflows.ts` 〔现有〕

- **处置**：目标-保留。
- **归属/上位**：`docs/18-§2.1.1`（DEV-43）；契约面=`contract TicketWorkflows`。
- **职责 / 非职责**：职责＝`flowsFromWorkflows(workflows)` 把 org-config `workflows.types[]` 翻成 `core FlowTable` 的 `T:<type>` 键。非职责＝不做声明校验（W-1..W-9 已在公司判定器过闸，调用序＝`loadCompanyDirectory` 先于本函数）。
- **内部结构**：单函数导出（`:40`）。
- **导出与依赖**：1 个导出；依赖 `contract`/`core`；无相对导入。
- **IO 与注入**：零 IO。
- **状态与并发**：无状态；缺省声明（无 `T:` 键）返回 `undefined`＝走既有等级流。
- **错误与观测**：不抛；非法输入由上游判定器拦。
- **测试与证据**：`typeflows.test.ts`（99 行）、`typeflows.e2e.test.ts`（384 行，含 N1 热换面）、`typeflows/proposal-typeflow.test.ts`（380 行）、`directive/flows.test.ts`（300 行）。
- **规模与验收**：49 行；**判负**：在此处补校验（会与公司判定器形成双源）。

---

### 4.4 派发与装配（8 件）

#### F-DAEMON-ENGINE-PROMPT-ASSEMBLY · `engine/prompt-assembly.ts` 〔现有〕

- **处置**：目标-保留。
- **归属/上位**：`docs/17-§5` 六层装配；80-§6 的 `PromptAssembler` 端口；`daemon→prompt` 是在用边（80-§2.3）。
- **职责 / 非职责**：职责＝`createDefaultAssembler(ctx)` 产出 `PromptAssembler`：把单据/角色/读面/哨兵段拼成 `AGENTS.md` + 任务书；`aiwsWorkspaceOf` 推导 `.AIWS` 工位路径。非职责＝不做 L0–L5 预算与指纹（`prompt` 包）、不注入身份（`company`）、不写盘（`engine.ts`/`instructions-store.ts` 各管一段）。
- **内部结构**：`AssembleDispatchInput:44`、`AssembleDispatchOutput:82`、`PromptAssembler:88`、`AssemblerContext:91`、`createDefaultAssembler:126`、`aiwsWorkspaceOf:206`。
- **导出与依赖**：6 个导出；依赖 `contract`/`prompt`，`node:path`；相对导入 `./read-tiers.ts`（两处）。
- **IO 与注入**：零 fs（只算路径）；人/部门/流事实由 `ctx` 快照注入。
- **状态与并发**：无状态工厂；`ctx` 热更＝重建成新 assembler。
- **错误与观测**：缺字段＝走缺省段（不得抛）；**判负**：把提示词当授权（提示词不授予任何权）。
- **测试与证据**：被 40 个测试文件经 `engine.ts` 的 `EngineDeps.assembler` 间接使用（实测 `grep -rl engine/prompt-assembly test`）；无专属单测。
- **规模与验收**：213 行；新增段落须先在 `docs/17-§5` 登记层位。

#### F-DAEMON-ENGINE-READ-TIERS · `engine/read-tiers.ts` 〔现有 / 未证〕

- **处置**：目标-保留（映射表标注「拟稿」——文件头注自述「三档语义拟稿（冻结候选）」，`read-tiers.ts:1` 起）。
- **归属/上位**：`docs/17-§7` 末行「读面分级：Full/Focused/Blind（验证岗 Blind，防生成者上下文污染）」的机制化。
- **职责 / 非职责**：职责＝`createView` 生成三档 `TicketReadView`（blind 结构性无 description/comments/fields）、`resolveReadTier`/`roleOfAssignee` 映射、`blindArtifactPaths`、`renderReadViewSection` 任务书段。非职责＝不做权限校验（读面不是授权）、不裁剪预算（`prompt` 包）。
- **内部结构**：`ReadTier:65`、`READ_TIERS:68`、`DEFAULT_FOCUSED_COMMENT_WINDOW=5:71`、`TicketKeyFields:76`、`CommentDigest:87`、`TicketReadView:95`、`BlindFace:115`、`CreateViewOptions:121`、`DEFAULT_ROLE_READ_TIERS:131`（`main_worker:full`/`verifier:blind`/`summarizer:focused`/`precheck:focused`）、`UNMAPPED_ROLE_READ_TIER='focused':139`、`resolveReadTier:142`、`roleOfAssignee:153`、`createView:195`、`blindArtifactPaths:254`、`renderReadViewSection:300`。
- **导出与依赖**：15 个导出；依赖 `contract`，`node:path`；相对导入 `./gate.ts`（读 `SUMMARY_FILENAME`）。
- **IO 与注入**：平台读（评论/描述）经参数端口；零时钟。
- **状态与并发**：无状态；档位映射可由 `EngineConfig.readTierByRole` 覆盖。
- **错误与观测**：未知角色＝`focused` 缺省（保守）；**未证**：`roleOfAssignee` 是「v0 无 role 元数据的拟稿口径」，真公司目录带角色元数据时的行为未取证据（U81-08）。
- **测试与证据**：`read-tiers.test.ts`（281 行，三档结构/映射/角色解析/渲染）、`read-tiers.e2e.test.ts`（236 行，验证岗 Blind 防污染）。
- **规模与验收**：348 行；映射表升正＝改 `docs/17-§7` 并在本文件去「拟稿」字样。

#### F-DAEMON-ENGINE-INSTRUCTIONS-STORE · `engine/instructions-store.ts` 〔现有〕

- **处置**：目标-保留。
- **归属/上位**：`docs/25-§3.1 v1.5` 裁决#1（制作人 2026-10-19 批）：AGENTS.md 注入走 dsh 插件；`docs/34-§3.1` overlay 装载法 B。
- **职责 / 非职责**：职责＝bridge 通道每任务指令临时文件的落点（`INSTRUCTIONS_DIR='tmp/instructions':37`）、写盘（0600）、幂等清理，以及 `provisionDshBridgeOverlay` 生成插件 overlay。非职责＝不组装内容（`prompt-assembly`）、不管理 DSH 生命周期（`adapters`）。
- **内部结构**：`instructionsTarget:40`、`writeInstructions:49`、`removeInstructions:55`、`BridgeOverlay:64`、`provisionDshBridgeOverlay:82`。
- **导出与依赖**：6 个导出；依赖 `contract`；`node:fs/path/url`。
- **IO 与注入**：**写 fs**（workspace 外的 `tmp/instructions`）；权限 0600；路径以 `rootDir` 为根。
- **状态与并发**：每任务一文件；清理幂等（重复删不抛）。清理时机有三：GATE_FAIL 收割后、预算拒派后、正常收口后（`instructions-channel.test.ts` 三面）。
- **错误与观测**：写失败即抛（派发前置）；残留文件属可观测缺陷（测试专门断言清理面）。
- **测试与证据**：`instructions-store.test.ts`（121 行）、`instructions-channel.test.ts`（240 行，bridge/native 两通道 + 两清理失败面）。
- **规模与验收**：107 行；**判负**：把指令写进 workspace 内（会被当作产物收账）。

#### F-DAEMON-ENGINE-TIER-MODEL-TIER · `engine/tier/model-tier.ts` 〔现有〕

- **处置**：目标-保留。
- **归属/上位**：80-§7 派发相位「选适配器只读能力声明」；studio-dev-196（大/中/小三档定调）。
- **职责 / 非职责**：职责＝`resolveModelTier`（单>岗>角色三级，面关=`undefined`）、`modelTierDispatchFace`（在册指名/缺位降级；`familyOf` 剥档位后缀）、`provisionModelTierOverlays`（低/高档生成；**mid 不生成**）、`parseModelTierTickets`（解析即验）、`checkTierPositionDeclarations`（三面同源，漂移启动拒）。非职责＝不决定能力（`adapters` 的 capabilities）、不签凭据、不改 `EngineConfig`。
- **内部结构**：`TierId` 再出口 `:36`、`ModelTierRoutingConfig:45`、`ResolvedModelTier:51`、`resolveModelTier:66`、`ModelTierDispatchFace:90`、`modelTierDispatchFace:101`、`provisionModelTierOverlays:128`、`parseModelTierTickets:161`、`checkTierPositionDeclarations:199`。
- **导出与依赖**：9 个导出；依赖 `adapters`（`dshModelFromPatches`/`tierExecutorName`/`tierOfExecutorName`）/`contract`/`core`，`node:fs/path`；相对导入 `../read-tiers.ts`。
- **IO 与注入**：**写 fs**（overlay 文件生成）；档位路由由配置注入。
- **状态与并发**：overlay 生成是启动期一次性；重复生成须幂等（同内容不重写）。
- **错误与观测**：解析 fail-closed（未知档位＝拒，不降级）；三面漂移＝启动拒。
- **测试与证据**：`tier/model-tier.test.ts`（368 行，五面 + 引擎接线）。
- **规模与验收**：220 行；**判负**：给 mid 生成 overlay（现役不生成，测试钉死）。

#### F-DAEMON-ENGINE-GATE · `engine/gate.ts` 〔现有 / 部分库级〕

- **处置**：目标-保留。**两实现并存**：`createDefaultGateRunner` 是 **v0 占位**（REPORT 存在即 exit 0 模拟），`createAcceptanceGateRunner` 是逐条真跑版（`engine.ts:536` 注释：「v0 默认占位实现见 src/engine/gate.ts；真验收命令版归 v0.5 真单刀」）。
- **归属/上位**：`docs/17-§6` 收割四要件的第 4 件（闸门）；80-§6 的 `GateRunner` 端口。
- **职责 / 非职责**：职责＝`GateRunner` 端口形状 + 默认实现 + 验收实现（逐条真跑、超时 124、spawn 失败 127、REPORT 空＝未落盘）；`discoverSummaryPath` 找 `summary.json`。非职责＝不判 `completed`（原语事件在 `engine.ts` 判）、不写事件、不改工位。
- **内部结构**：`GateInput:26`、`GateOutcome:34`、`GateRunner:47`、`REPORT_FILENAME='REPORT.md':52`、`SUMMARY_FILENAME='summary.json':53`、`discoverSummaryPath:65`、`createDefaultGateRunner:76`、`ACCEPTANCE_GATE_TIMEOUT_MS=60_000:98`、`createAcceptanceGateRunner:118`。
- **导出与依赖**：9 个导出；**零包依赖**；`node:fs/path`。
- **IO 与注入**：读 fs（REPORT/summary）；`createAcceptanceGateRunner` 起子进程（`spawn`）——端口边界内的外部执行。
- **状态与并发**：无状态；超时/失败以**退出码**表达（124/127），不抛。
- **错误与观测**：`GateOutcome` 必带退出码与输出摘要；**判负**：把占位实现当验收证据（U81-09）。
- **语义债（唯一允许的路线，未实现）**：80-§7.4 里 `GATE_PASS` 是**验收投影**，不是「REPORT 存在」也不是「命令 exit 0」。目标结构：`GateRunner` 被 `AcceptanceEvaluator` 包装——`GateRunner` 只提供**执行证据**（命令退出码/输出/超时），`AcceptanceEvaluator`（`core` 或 77 的验收面）依合同+验收项判定 `accepted`；`GATE_PASS` 事件写的是**判定结论 + 证据引用**。在 80-§7.4 落地前，本件**不得**被描述为「验收已独立」，也不得把 `createAcceptanceGateRunner` 的绿写成 `accepted`（它只证明「命令过了」）。
- **测试与证据**：`gate.ts` 被 41 个测试文件经 `engine.ts` 使用；无专属单测；`merge/merge-run.test.ts` 的 S2「runMergeGate 四脸」是同族断言。**不证明**：验收判定正确性（现无 `AcceptanceEvaluator`）、真实门禁命令在真仓库全绿。
- **规模与验收**：217 行；真验收命令的装配在 serve 侧（本卷范围外）。

#### F-DAEMON-ENGINE-JOBS-OUTPUT-ACCOUNT · `engine/jobs/output-account.ts` 〔现有〕

- **处置**：目标-保留（收割后置收账步）。
- **归属/上位**：DEV-50；`docs/04-§三 D9` 落点声明；`docs/17-§2` 相位 4。
- **职责 / 非职责**：职责＝`reportFileName(job,ticket,now)` 生成 `<YYYY-MM-DD>-<type>-<节点>-<单号>.md`；`accountJobOutput` 把工位 REPORT 收账进公司目录 `reports/`。非职责＝不写台账事件（收账失败只留痕）、不判验收。
- **日键缺陷（〔事实〕，目标待改）**：`reportFileName:67-77` 用 `new Date(now).getFullYear()/getMonth()/getDate()` 取日——即**宿主本地时区**，注释写「本地时区取日，与 cron 同口径」。这违反 80 的日键纪律：**UTC 日键（`dayKeyOf`，`packages/panel/src/views.ts:321`）与公司本地日必须分开**，本地日只能由**显式时区参数**算出，不得读宿主时区（否则同一台机器换 TZ 就改归档路径，跨机复现不一致）。目标签名：`reportFileName(job, ticket, now, tz: string)`（IANA 名，来自公司配置），旧三参形式只作**过渡**、需在实现单里登记删除点。
- **内部结构**：`JobOutputAccountInput:31`、`JobOutputAccountResult:50`、`reportFileName:67`、`accountJobOutput:83`。
- **导出与依赖**：4 个导出；依赖 `company`/`contract`/`store`；`node:fs/path`。
- **IO 与注入**：读工位、写公司目录；`companyDir` 缺省＝面关。
- **状态与并发**：**永不抛**（收割成败不被收账牵动，`job-output.test.ts` 三态断言）；重复收账＝覆盖同名（幂等）。
- **错误与观测**：失败以 result 字段留痕，不进 `errors` 主面（设计取舍：收账是后置）。**不证明**：跨时区归档一致性（现无 tz 参数）、真实公司目录写权限矩阵。
- **测试与证据**：`job-output.test.ts`（299 行，文件名/三态/引擎链路）、`jobs/harvest-recon-r4.test.ts`。
- **规模与验收**：127 行；**判负**：收账改名规则而不改 `04-§三`。

#### F-DAEMON-ENGINE-JOBS-SENTINEL · `engine/jobs/sentinel.ts` 〔现有〕

- **处置**：目标-保留（定时岗产出哨兵，R1）。
- **归属/上位**：`127-A §4.2` 批示③；`docs/35-§3`。
- **职责 / 非职责**：职责＝`expectedSentinel(company,job,runAt)` 三元组 nonce（`sha256(company:job:run_at)`）、`patrolJobOfNote` 复原、`ticketSentinelAnchor` dedup 槽、`sentinelDutyForTicket` 义务判定、`verifySidecarSentinel(AtPath)` 四态（ok/missing/mismatch/unreadable）、`sentinelBriefBlock` 任务书 L4 注入段。非职责＝不判产物语义（`harvest-recon`）、不写事件。
- **内部结构**：`SentinelTriple:27`、`SentinelStatus:34`、`expectedSentinel:37`、`patrolJobOfNote:42`、`sentinelDutyForTicket:60`、`ticketSentinelAnchor:74`、`verifySidecarSentinel:111`、`verifySidecarSentinelAtPath:128`、`sentinelBriefBlock:150`。
- **导出与依赖**：9 个导出；依赖 `contract`/`store`；`node:crypto/fs`。
- **IO 与注入**：读 fs（sidecar）；哈希确定性。
- **状态与并发**：nonce 确定性＝同 (company,job,runAt) 恒同值（可重放）；四态 fail-closed（读不到＝`unreadable`，不猜 `ok`）。
- **错误与观测**：状态枚举即观测；`unreadable` 必须如实暴露。
- **测试与证据**：`jobs/sentinel.test.ts`（223 行，七面）、`jobs/harvest-recon-r4.test.ts`。
- **规模与验收**：168 行；**判负**：把 `unreadable` 折叠成 `missing`。

#### F-DAEMON-ENGINE-JOBS-HARVEST-RECON · `engine/jobs/harvest-recon.ts` 〔现有〕

- **处置**：目标-保留（相位 4 尾对账步）。
- **归属/上位**：`docs/17-§2` 相位 4 尾；studio-dev-100 提案 §4.3（E9–E13）。
- **职责 / 非职责**：职责＝`runHarvestRecon`：工位产物体检（`deliverablesOf`）、悬空面（`statHarvestDenial`）、缺归档补收（`REPORT_MISSING`，内容哈希幂等）、不完整可见（`HARVEST_INCOMPLETE`，不代写）、拒绝可见（`HARVEST_DENIED`）；`reconIssueRecord` 生成对账单。非职责＝不判验收、不改工作区权限（`WORKSPACE_UMASK` 只在建目录时前移）。
- **内部结构**：`WORKSPACE_UMASK=0o022:54`、`deliverablesOf:61`、`statHarvestDenial:80`、`reconIssueRecord:106`、`HarvestReconDeps:124`、`HarvestReconResult:144`、`runHarvestRecon:207`。
- **导出与依赖**：7 个导出；依赖 `company`/`contract`/`store`；`node:crypto/fs/path`；相对导入 `./output-account.ts`、`./sentinel.ts`。
- **IO 与注入**：fs 全量（stat/read/hash）；节流 `harvestReconEveryTicks`（缺省 30）在 `engine.ts:2072`。
- **状态与并发**：补收幂等＝内容哈希（同内容不重写）；三工况单调：不补收不代写。
- **错误与观测**：三态**可见**是核心承诺（`HARVEST_INCOMPLETE`/`HARVEST_DENIED` 不静默）；`WORKSPACE_UMASK` 修的是新单产物权限（≥0644）。
- **测试与证据**：`harvest-recon.test.ts`（364 行，三工况 + E12 可达性）、`jobs/harvest-recon-r4.test.ts`（429 行，R4 读回门 内容门④+哨兵门⑤）。
- **规模与验收**：442 行；**判负**：为「看起来成功」而代写 REPORT。

---

### 4.5 合并（6 件）

#### F-DAEMON-ENGINE-MERGE-RUN · `engine/merge/merge-run.ts` 〔现有 / 库级-未接〕

- **处置**：目标-保留（v0.5 核心）。**状态双轨**：`EngineDeps.mergeRun` 注入＝真单刀面开；缺省＝相位 5 走 v0 模拟轨（`engine.ts:593`）。故库级存在，真机整链未证。
- **归属/上位**：`202-P2`（studio-dev-232）；`docs/17-§2` 相位 5「先门禁后 MERGE」；77 的 `RUN-WORK-06`/`RUN-EVD-03/04`。
- **职责 / 非职责**：职责＝`runMergeAction`（待验收位 + standing 批示 + 触发条件齐→相位 5 以 resume 唤起原工位原会话）、`closeOutMergeHarvest`（四要件收口）、`failMergeHarvest`（失败收口）。语义总纲：**合并跑＝收割链复用，非新链**。非职责＝不决定是否合并（`core`/批示）、不实现 git（`MergeGitPort`）、不实现闸门命令（`MergeGateCommandPort`）。
- **内部结构**：`MergeAction:92`、`MergeRunDeps:101`（`targetBranch`/`gateCommand`/`repoRelPath?`/`git`/`gate`）、`MergeRunContext:115`、`MergeRunHost:129`（host 面：`platform`/`ledger`/`registry`/`assemble`/`config`/`people`/`budgetDeps`/`costGuard`/`modelTiers`/`inflight`/`mergeRun`/`mergeLease`/`seq`/`now`/`makeId`/`makeEvent`/`syncMirror`/`resolvePerson`/`flowOf`）、`MergeActionOutcome:160`、`MergeRunPlan:171`、`runMergeAction:249`、`closeOutMergeHarvest:454`、`failMergeHarvest:556`。
- **导出与依赖**：9 个导出；依赖 `adapters`/`contract`/`core`/`store`，`node:crypto/fs/path`；相对导入 18 条，**含 `../engine.ts`（类型回引，环的一部分）**——目标：该行改 `from '../tick/types.ts'`，本件不再出现 `engine.ts`。
- **IO 与注入**：git 与闸门全经端口（`MergeGitPort`/`MergeGateCommandPort`）；fs 读回执；时钟与 ID 由 host 给。
- **状态与并发**：租约＝`merge/merge-lease.ts`（目标分支键，TTL+续租+死主回收）；单栈双单同拍批准＝一进一顺延（`merge-run.e2e.test.ts` S7）；收口串行。
- **错误与观测**：四要件缺＝冲突兜底（`GATE_FAIL` 三锚 + `ESCALATE` + 清站立），**不自动重试**、不触断路器（`merge-run.e2e.test.ts` S6）；降级面＝断点缺失/重启打断→手工链（S5）。
- **测试与证据**：`merge/merge-run.test.ts`（484 行，四组）、`merge/merge-run.e2e.test.ts`（499 行，四组）、`merge/merge-conflict.e2e.test.ts`（339 行，S5 双单冲突）、`merge/merge-lease.test.ts`。
- **规模与验收**：582 行（<600，无基线）；真 git 端到端未证（U81-10）。**类型环（§1.3）**：`:84` `import type { EngineConfig, Inflight } from '../engine.ts'`、`:80` 引 `TickReport` 家族、`:86` 引租约（`mergeLeaseKey` 值 + `MergeLeaseRegistry` 型）、`:87` 引降级体；反向由 `engine.ts:635` 的内联 `import('./merge/merge-run.ts').MergeRunContext` 与 `:312` 的运行时 import 构成闭合。宿主类型真实名只有 `MergeRunHost`（`:129`），`MergeRunDeps:101`／`MergeRunContext:115` 随闭包一并下沉 `engine/tick/types.ts`（§8.2 第 1 步）。

#### F-DAEMON-ENGINE-MERGE-LEASE · `engine/merge/merge-lease.ts` 〔现有〕

- **处置**：目标-保留（与 `lanes/registry.ts` 对偶，但持久化面不同）；`MergeLeaseState`/`MergeLeaseRegistry` 两个纯接口目标迁 `tick/types.ts`，本件再出口（外部引用路径不变）。
- **归属/上位**：`202-P4`（studio-dev-234）；任务书三面（TTL+续租+死主回收）；79/78 的 fencing 语义（`Lease/Fencing Token` 归 77/78）。
- **职责 / 非职责**：职责＝`createMergeLeaseRegistry(ttlMs)`（`acquire/release/state`）、`mergeLeaseKey(company,targetBranch)`、`renewMergeLeases(host,at)`（host 级两拍续租）、`mergeQueueFace(host,waiting,at)`（合并队列栏投影）。非职责＝不执行合并、不写事件；**也不是 `WriterLeasePort`**——它防的是「同一目标分支双合并」，不是「同一事实域双写者」（80-§6.2：泳道/合并租约是类比物，不是写者围栏；两者可共用 TTL 实现但语义/记录/fence 都不同，不得合并命名）。
- **内部结构**：`mergeLeaseKey:20`、`MergeLeaseEntry:24`、`MergeLeaseState:30`、`MergeLeaseRegistry:37`、`createMergeLeaseRegistry:48`、`MergeLeaseHostFace:80`（**这是续租/队列投影的宿主面**，字段 `config`/`inflight`/`mergeRun`/`mergeLease`；与「租约簿接口」不是一回事，勿混名）、`renewMergeLeases:88`、`MergeQueueFace:95`、`mergeQueueFace:104`。
- **导出与依赖**：9 个导出；依赖 `contract`；相对导入 **`../engine.ts`**（`:17` `Inflight` 类型回引）——目标改 `../tick/types.ts`。
- **IO 与注入**：台账 kv（租约行）；时间由参数。
- **状态与并发**：TTL + 死主回收；**fencing**：旧 holder 写入须被拒（LEASE 语义），实现依赖台账 CAS。
- **错误与观测**：state 快照可观测；无事件。
- **测试与证据**：`merge/merge-lease.test.ts`（234 行，R1/R2/R3 + S7 L0 无类型流 102 次 byte-identical 回放）。**不证明**：跨进程互斥、双进程并发抢约。
- **规模与验收**：108 行。

#### F-DAEMON-ENGINE-MERGE-GATE · `engine/merge/merge-gate.ts` 〔现有〕

- **处置**：目标-保留（纯端口 + 判定）。
- **归属/上位**：`202-P2`；`docs/17-§2` 相位 5、`§6` 四要件（提交核验折进要件 4）。
- **职责 / 非职责**：职责＝`MergeGitPort`/`MergeGateCommandPort` 端口定义、`runMergeGate(d)`（先门禁后 MERGE 的核验面）、`receiptNonEmpty`（回执存在且非空＝要件 3）。非职责＝不实现 git（`default-deps.ts`）、不判验收。
- **内部结构**：`MergeGitPort:20`、`MergeGateCommandPort:34`、`MergeGateResult:39`、`receiptNonEmpty:53`、`runMergeGate:61`。
- **导出与依赖**：5 个导出；**零包依赖**、零相对导入（端口层最纯）。
- **IO 与注入**：全部经端口（`exists`/`sizeOf` 也是注入的，便于测试）。
- **状态与并发**：无状态；**顺序冻结**：门禁在前、`MERGE` 事件在后。
- **错误与观测**：结果含退出码与输出；空回执＝拒。
- **测试与证据**：`merge/merge-run.test.ts`（S2「runMergeGate 四脸」）、两份 e2e。
- **规模与验收**：107 行；**判负**：把 gate 结果当验收通过（验收仍是四要件）。

#### F-DAEMON-ENGINE-MERGE-BRIEF · `engine/merge/merge-brief.ts` 〔现有〕

- **处置**：目标-保留。
- **归属/上位**：`202-P2`；`docs/17-§2` 相位 5、`§5` 任务书管线（**零 prompt 包改动**：合并指令块是引擎侧后置追加）。
- **职责 / 非职责**：职责＝`mergeDirectiveBlock(targetBranch, gateCommand)` 生成冻结原文的合并指令块；两个文件名常量。非职责＝不改 `renderTaskBrief`、不装配 L0–L5。
- **内部结构**：`MERGE_BRIEF_FILENAME='merge-brief.md':16`、`MERGE_RECEIPT_FILENAME='merge-REPORT.md':19`、`mergeDirectiveBlock:27`。
- **导出与依赖**：3 个导出；零包依赖、零相对导入。
- **IO 与注入**：零 IO；纯字符串。
- **状态与并发**：无状态；文本冻结（R5/R1/R3 原文，`merge-run.test.ts` S3 钉死）。
- **错误与观测**：无错误路径；**判负**：在本件里改 prompt 包行为。
- **测试与证据**：`merge/merge-run.test.ts`（S3）、两份 e2e。
- **规模与验收**：40 行。

#### F-DAEMON-ENGINE-MERGE-FALLBACK · `engine/merge/merge-fallback.ts` 〔现有〕

- **处置**：目标-保留（非真单刀三轨共体，202-P3 从 `merge-run.ts` 拆出以解 600 行阈）。
- **归属/上位**：`202-P3`；77 的降级/部分成功分类（`RUN-FAIL-01`）。
- **职责 / 非职责**：职责＝`noteSafe`（note 动态字段净化，防注入）、`simulatedMergeTransition`（模拟迁移收口）、`degradeToManualChain`（降级手工链）。非职责＝不判是否降级（`merge-run.ts` 决定）、不写事件（经回调）。
- **内部结构**：`noteSafe:14`、`simulatedMergeTransition:24`、`degradeToManualChain:39`。
- **导出与依赖**：3 个导出；依赖 `contract`；相对导入 `../sentinel/events-index.ts`（锚文本）、`./merge-run.ts`。
- **IO 与注入**：零 fs；平台/台账经参数。
- **状态与并发**：降级是**单向**的（不自动回真单刀）。
- **错误与观测**：降级必须留锚（`MERGE_MANUAL_ANCHOR`/`MERGE_CHAIN_ANCHOR`，`events-index.ts:60/61`）。
- **测试与证据**：无直接 import；由 `merge-run.e2e.test.ts` S5 与 `merge-conflict.e2e.test.ts` 覆盖。
- **规模与验收**：59 行。

#### F-DAEMON-ENGINE-MERGE-DEFAULT-DEPS · `engine/merge/default-deps.ts` 〔现有〕

- **处置**：目标-保留（真机端口装配；serve realGate 模式使用）。
- **归属/上位**：`202-P2`；80-§3 组合根纪律（真机端口在 assembly 侧装配，本件只是可复用的默认实现）。
- **职责 / 非职责**：职责＝`createSpawnMergeGitPort(opts)`（argv 直跑 git 四原语 + 代推）与 `createDefaultMergeRunDeps(opts)`（组装 `MergeRunDeps`）。非职责＝不决定何时合并、不解析冲突语义。
- **内部结构**：`createSpawnMergeGitPort:87`、`createDefaultMergeRunDeps:119`。
- **导出与依赖**：2 个导出；**零包依赖**；相对导入 `../gate.ts`、`./merge-run.ts`、`./merge-gate.ts`。
- **IO 与注入**：**起子进程**（git）；超时与 bin 路径可注入（`gitBin`/`timeoutMs`）。
- **状态与并发**：无状态；子进程失败＝退出码透传。
- **错误与观测**：git 输出须脱敏后入 note（禁止把整段 stderr 直接进事件）。
- **测试与证据**：无直接测试（真机面）；由 `merge/*` e2e 的注入替身覆盖逻辑面。
- **规模与验收**：151 行；真机 git 行为未证（U81-10）。

---

### 4.6 落账与收口（18 件）

#### F-DAEMON-ENGINE-PRICING-PRICING · `engine/pricing/pricing.ts` 〔现有〕

- **处置**：目标-保留（两个引擎缝的体；`engine.ts` 只留相位缝）。
- **归属/上位**：`132-§6.2`（单B·studio-dev-169，P4/P5 批示载体）；`docs/17-§2` 相位 4 后置步与相位 7 尾。
- **职责 / 非职责**：职责＝`consumePricingPublish`（GATE_PASS 后置：定价单产物→价目快照落账）、`runPricingStaleCheck`（相位 7 尾·每晨守夜，日锚 `pricing.stale_check_date`）。非职责＝不解析价目文件格式（`core`）、不派定价单（`escalate`/岗源）。
- **内部结构**：`PRICING_TICKET_TYPE='pricing':35`、`PRICING_STALE_CHECK_HOUR=10:38`、`PRICING_STALE_CHECK_DATE_KEY='pricing.stale_check_date':41`、`PricingConsumeDeps:54`、`PricingConsumeResult:74`、`consumePricingPublish:114`、`PricingStaleDeps:171`、`PricingStaleTickReport:180`、`runPricingStaleCheck:206`。
- **导出与依赖**：9 个导出；依赖 `core`/`store`；`node:fs/path`。
- **IO 与注入**：读工位产物、写快照行；时钟注入。
- **状态与并发**：日锚 kv＝当日只跑一次（幂等）；publish 消费按单幂等。
- **错误与观测**：stale 检查结果进 `TickReport`（`PricingStaleTickReport`）；失败不得静默（进 `errors`）。
- **测试与证据**：`pricing/pricing.test.ts`（360 行，消费 + 守夜两面）。
- **规模与验收**：232 行；**判负**：在引擎内解析价目格式（应进 `core`）。

#### F-DAEMON-ENGINE-COST-CLOSE-CLOSE · `engine/cost-close/close.ts` 〔现有〕

- **处置**：目标-保留（相位 7 尾·日终收口工序；`132-§6.3` 单D·studio-dev-179，体分离自 `engine.ts`）。
- **归属/上位**：`132-§6.0` 时间线（19:55 本地收 D-1；20:00 财务岗读 `cost_daily`）；`132-§6.4 R4` 对账段。
- **职责 / 非职责**：职责＝`runCostCloseTick(deps)`：时刻闸（19:55）→ 行冻结 → kv 前进 → 事件 → 报告文件；追平（崩溃落后多日一次收齐）、降级三路不静默、次日补账。非职责＝不做财务分析（报告面只汇总）、不改价目（`pricing`）。
- **内部结构**：再出口 `COST_CLOSE_KV_KEY`/`COST_CLOSE_HOUR`/`COST_CLOSE_MINUTE`（`@studio-next/core`，`:54`）；`CostCloseDeps:102`、`CostCloseTickReport:120`、`CostCloseEngineSeam:140`、`costCloseDeps:159`（引擎一行缝）、`runCostCloseTick:201`。
- **导出与依赖**：6 个导出；依赖 `contract`/`core`/`store`；`node:fs/path`；零相对导入。
- **IO 与注入**：台账行读、报告文件写、kv 写；`now`/`makeId`/`emitReport`/`emitAlarm`/`onError`/`bumpMutations` 全注入。
- **状态与并发**：kv 键 `cost_close_last_date`（单源前进）；**写序冻结**：行→kv→事件→报告（崩溃在任何一步都能重跑收敛）。
- **错误与观测**：`CostCloseTickReport` 含 `closedDates/finalRows/adjustmentRows/alarms/reportEvents/mutations`；**不前进不静默**（失败面测试专门断言）。
- **测试与证据**：`cost-close/close.test.ts`（502 行，九面：时刻闸/三路降级/追平/巡检/对账/失败/缝装配/财务分析/报告形状）。
- **规模与验收**：394 行；新增收口动作须同步 kv 与报告段。

#### F-DAEMON-ENGINE-COSTGUARD-FOLD · `engine/cost-guard/fold.ts` 〔现有〕

- **处置**：目标-保留（纯 IO 缝件；判定纯体在 `core/costguard.ts`）。
- **归属/上位**：`132-§6.4`（单C·studio-dev-177）。
- **职责 / 非职责**：职责＝`makeBasisResolver`（模型键→单价+基准，快照优先）、`foldTokensWithBasis`、`personDaySpentUsd`、`personDailyBudgetUsd`、`personDayGateInput`、`personReservedUsd`。非职责＝不做阈值判定（`core`）、不写台账。
- **内部结构**：`PriceBasis='snapshot'|'models-yaml'|'unpriced':30`、`ResolvedUnit:33`、`makeBasisResolver:48`、`foldTokensWithBasis:72`、`personDaySpentUsd:90`、`personDailyBudgetUsd:100`、`personDayGateInput:109`、`personReservedUsd:126`。
- **导出与依赖**：8 个导出；依赖 `contract`/`core`/`store`；零相对导入。
- **IO 与注入**：读台账行（值传入）；零 fs。
- **状态与并发**：无状态纯折叠；**不猜价**：无价目＝`unpriced` 基准（`foldHarvestCost` 同理）。
- **错误与观测**：`unpriced` 是显式态，不是 0 元。
- **测试与证据**：无直接 import；由 `cost-guard/seams.test.ts`（"即时折算四路：native 为尊→快照→兜底→不猜价"）与 `consume.test.ts` 覆盖。
- **规模与验收**：128 行；**判负**：把 `unpriced` 折叠成 0。

#### F-DAEMON-ENGINE-COSTGUARD-HARVEST · `engine/cost-guard/harvest.ts` 〔现有〕

- **处置**：目标-保留（收割相位成本缝）。
- **归属/上位**：`132-§6.4`（单C）。
- **职责 / 非职责**：职责＝`foldHarvestCost`（native>0 直用，否则快照/兜底）、`writeThroughHarvestUsage`（usage_daily 写通）。非职责＝不做四档处置（`intents/escalate`）、不改工时记录。
- **内部结构**：`HarvestCost:21`、`foldHarvestCost:26`、`HarvestUsageWrite:51`、`writeThroughHarvestUsage:65`。
- **导出与依赖**：4 个导出；依赖 `contract`/`core`/`store`；相对导入 `./fold.ts`、`./usage.ts`。
- **IO 与注入**：台账写（usage 行）；零 fs。
- **状态与并发**：一次收割＝一格一增量（write-through）；重复写需按键幂等（由 usage 写面保证）。
- **错误与观测**：三面同值（REPORT note / usage_daily / work_records）是断言不变量（`seams.test.ts`）。
- **测试与证据**：`cost-guard/seams.test.ts`（281 行，三面）。
- **规模与验收**：81 行。

#### F-DAEMON-ENGINE-COSTGUARD-SOURCE · `engine/cost-guard/source.ts` 〔现有〕

- **处置**：目标-保留（唤起源）。
- **归属/上位**：`132-§6.4`；`docs/22-§一/§二` 源注册表；`docs/25-§3.4 kind='escalate'`。
- **职责 / 非职责**：职责＝`createCostThresholdSource(deps)`：tick 驱动扫当日用量，按四档产生 `escalate` 意图（P0-B 预留：公司/人档、取价基准）。非职责＝不做处置（消费在 `intents/escalate`）、不写台账（只产意图）。
- **内部结构**：`COST_THRESHOLD_SOURCE_NAME='cost-threshold':46`、`COST_THRESHOLD_SOURCE_MANIFEST:48`、`CostThresholdSourceDeps:55`、`CostThresholdReport:79`、`CostThresholdSource:90`、`createCostThresholdSource:120`。
- **导出与依赖**：6 个导出；依赖 `contract`/`core`/`store`；相对导入 `../tools/id.ts`、`../intents/escalate.ts`（`costThresholdKey` 单源）、`./fold.ts`。
- **IO 与注入**：台账读；时钟与 ID 注入；`costGuard` 配置注入。
- **状态与并发**：at-least-once 产意图；恰好一次由 `costThresholdKey` 幂等键保证。
- **错误与观测**：源错误进 `SourceRegistryStats`；**fail-closed**＝判负全明报。
- **测试与证据**：`cost-guard/source.test.ts`（273 行，面关/公司档/人档/取价基准）、`consume.test.ts`（端到端）。
- **规模与验收**：267 行；`costThresholdKey` 公式单源（三面同引，禁复制）。

#### F-DAEMON-ENGINE-COSTGUARD-USAGE · `engine/cost-guard/usage.ts` 〔现有〕

- **处置**：目标-保留（`usage_daily` 投影唯一生产写面）。
- **归属/上位**：`132-§6.1`（单C·studio-dev-177）；80-§8 投影可重建。
- **职责 / 非职责**：职责＝`writeThroughUsageDaily`（收割尾 write-through）、`rebuildUsageDailyProjection`（重建）。非职责＝不做报表（`panel`）、不判阈值。
- **内部结构**：`UsageWriteThrough:19`、`writeThroughUsageDaily:30`、`UsageRebuildReport:58`、`rebuildUsageDailyProjection:66`。
- **导出与依赖**：4 个导出；依赖 `contract`/`core`/`store`；零相对导入。
- **IO 与注入**：台账写；零 fs。
- **状态与并发**：write-through 与 rebuild 必须**同结果**（可重建投影的判据）。
- **错误与观测**：rebuild 报告行数；不一致＝缺陷。
- **测试与证据**：无直接 import；由 `cost-guard/seams.test.ts`（usage_daily write-through 面）覆盖。
- **规模与验收**：79 行；**判负**：让 panel/CLI 直接写 usage 行（写口收口纪律）。

#### F-DAEMON-ENGINE-HRSYNC-HRSYNC · `engine/hrsync/hrsync.ts` 〔现有〕

- **处置**：目标-保留（相位 7 尾消化器 + 三面执行体）。
- **归属/上位**：DEV-48；`docs/52-§9.2` 队列语义、§六/§七。
- **职责 / 非职责**：职责＝`createHrSyncDigester(deps)`（每拍 drain `maxHrSyncPerTick`：补单→挂账→三面执行→complete/retry/failed）、`enqueueHrBatch`（apply 段入队，零平台 IO）、`personnelEventIdOf`。非职责＝不产生人事变动（源在 `people-change-source.ts`）、不实现 Taiga/Matrix（面在 `taiga-face.ts`/外部注入）。
- **内部结构**：`HR_TICKET_SENTINEL='@hr:':30`、`personnelEventIdOf:41`、`TaigaHrFace:48`、`MatrixHrFace:58`、`HrRoomAliases:66`、`HrSyncTickReport:74`、`HrSyncDeps:86`、`createHrSyncDigester:212`、`HrEnqueueResult:322`、`enqueueHrBatch:344`。
- **导出与依赖**：11 个导出；依赖 `contract`/`core`/`store`；`node:crypto`；零相对导入。
- **IO 与注入**：台账 `hr_sync_log` 读/写；平台 `issues`（票据）；三面经 `faces{taiga?,matrix?,rooms?,taigaRoleOf?}` 注入；`redact` 脱敏闭包注入。
- **状态与并发**：kv `hr.batch.<id>`（票据）、`hr.batch.<id>.summary`（批摘要）、`hr.matrix.pass.<username>`（`hrsync.ts:33/35/37`）；重试达限＝`failed` + `ESCALATE`（**不自动开 bug 单**）。
- **错误与观测**：`HrSyncTickReport{claimed,done,retried,failed,ticketsOpened,eventsAppended}`；失败面如实分类。
- **测试与证据**：`hrsync/hrsync.test.ts`（293 行，四面：入队/drain/失败语义/每拍上限）。
- **规模与验收**：397 行；**判负**：在 apply 段做平台 IO（会让公司目录写变慢/易失败）。

#### F-DAEMON-ENGINE-HRSYNC-PEOPLE-CHANGE-SOURCE · `engine/hrsync/people-change-source.ts` 〔现有〕

- **处置**：目标-保留（源侧）。
- **归属/上位**：`129-§6.1①`（分类学首类）/`§6.3 P0-A`（studio-dev-178 单C）。
- **职责 / 非职责**：职责＝`createPeopleChangeSource(deps)`：把 DEV-48 PeopleDiff 出口**双写意图**（publish 契约七字段+指纹）；`wirePeopleChangeSource` 注册（serve 唯一调用点）；`liveEmit ?? sink` 双出口。非职责＝不消费、不写平台。
- **内部结构**：`PEOPLE_CHANGE_SOURCE_NAME='people-change':32`、manifest `:35`、deps `:42`、source `:50`、stats `:62`、create `:72`、wire `:119`。
- **导出与依赖**：7 个导出；依赖 `contract`/`core`；相对导入 `../sources.ts`、`../intents/taxonomy.ts`。
- **IO 与注入**：零 fs；emit 经注册表/`liveEmit`。
- **状态与并发**：at-least-once；`dataChangeFingerprint` 保证幂等（"源 at-least-once × 引擎恰好一次"）。
- **错误与观测**：publish 隔离＝双写失败不炸 apply 段（数据面主产物照旧，`people-change.test.ts` 断言）。
- **测试与证据**：`hrsync/people-change-source.test.ts`（129 行，三面）、`hrsync/people-change.test.ts`（278 行，P0-A 端到端 + 幂等双层 + 路由隔离）。
- **规模与验收**：126 行。

#### F-DAEMON-ENGINE-HRSYNC-TAIGA-FACE · `engine/hrsync/taiga-face.ts` 〔现有 / 未证〕

- **处置**：目标-保留（唯一引 `@studio-next/taiga` 的引擎件）。
- **归属/上位**：DEV-48；`docs/52-§6.1/§6.2/§6.4`；78 的 `BIND-PLAT-TAIGA-01`。
- **职责 / 非职责**：职责＝`createTaigaHrFace(opts)`：`ensureMember`（发邀请，令牌不落 API 响应）→`ensureRole`→`removeMember`；`invalidateMembers()` 写通作废缓存。非职责＝不决定谁该入司（`hrsync.ts` 判）、不做凭据管理（`taiga` 包）。
- **内部结构**：`TaigaHrContext:38`、`InviteLogSource:41`、`TaigaHrFaceOptions:50`、`createTaigaHrFace:70`。
- **导出与依赖**：4 个导出；依赖 `taiga`；相对导入 `./hrsync.ts`（面类型）。
- **IO 与注入**：HTTP（经 taiga 客户端）；日志源注入（邀请令牌只能落 console/日志，不能入 API 响应）。
- **状态与并发**：幂等（`§6.4`）：重复 ensure＝不重复建。
- **错误与观测**：**未证**：真机 Taiga S0 未取证据（U81-11）；错误分类继承 taiga 包。
- **测试与证据**：`hrsync/taiga-face.test.ts`（180 行，ensureMember/ensureRole/removeMember/T5 写通作废）。
- **规模与验收**：119 行；真机行为归 82。

#### F-DAEMON-ENGINE-JOBS-FRESHNESS · `engine/jobs/freshness.ts` 〔现有〕

- **处置**：目标-保留（计时器族第三源）。
- **归属/上位**：`127-A R2`（studio-dev-127 §4.3 批示④）；`docs/35-§3`。
- **职责 / 非职责**：职责＝`createFreshnessSource`（tick 驱动、零内存态、事件派生幂等）：尖刺四态（停跑/从未跑/窗内/逃逸档）、`graceMsFor`（逐岗声明>档缺省>cron 桶）、`dstAdjustMs`（DST 豁免）、`declaredTypeIdsOf`、`jobContractLoadWarnings`。非职责＝不派岗单（产 `escalate` 意图）、不判产物。
- **内部结构**：`FRESHNESS_SOURCE_NAME='freshness-timer':37`、manifest `:39`、`GRACE_TIER_DEFAULTS_MS:46`、`graceMsFor:64`、`dstAdjustMs:91`、`FreshnessReport:96`、`stats:107`、`deps:116`、`source:133`、`create:143`、`declaredTypeIdsOf:284`、`jobContractLoadWarnings:301`、`logJobContractWarnings:328`。
- **导出与依赖**：13 个导出；依赖 `company`/`contract`/`store`；相对导入 `../tools/id.ts`、`../scheduler.ts`。
- **IO 与注入**：台账读；时钟注入；公司目录岗定义读。
- **状态与并发**：零内存态（全由台账事件派生）＝重启不丢。
- **错误与观测**：契约装载警告（缺流/组合）在启动期输出，不阻断（明报）。
- **测试与证据**：`jobs/freshness.test.ts`（232 行，五面）。
- **规模与验收**：335 行。

#### F-DAEMON-ENGINE-JOBS-SOURCES · `engine/jobs-sources.ts` 〔现有〕

- **处置**：目标-保留（两源：cadence / sla-timer）。
- **归属/上位**：`docs/35-§3`（制作人 2026-10-19 批复）；`docs/22-§一/§二`；`docs/25-§3.4`。
- **职责 / 非职责**：职责＝`createCadenceSource`（档位岗按 cron 播种岗单意图）与 `createSlaSource`（SLA 超时 escalate；推进重置）。非职责＝不派工（源零直驱：全部折成 `InvokeIntent`）、不判岗产物。
- **内部结构**：`CADENCE_SOURCE_NAME='cadence':60`、`SLA_SOURCE_NAME='sla-timer':63`、两份 manifest `:65`/`:71`、`CadenceSourceDeps:80`、`CadenceReport:93`、`CadenceSource:106`、`createCadenceSource:118`、`SlaReport:238`、`SlaSourceStats:247`、`SlaSourceDeps:256`、`SlaSource:271`、`createSlaSource:281`。
- **导出与依赖**：12 个导出；依赖 `company`/`contract`/`store`；相对导入 `./tools/id.ts`、`./scheduler.ts`。
- **IO 与注入**：台账读/写（岗单）；时钟注入。
- **状态与并发**：幂等＝按 (job, runAt) 派生；热更无状态轮询天然生效。
- **错误与观测**：源错误进注册表统计；消费门如实明报。
- **测试与证据**：`jobs-lifecycle.test.ts`（562 行，五面 + serve 接线）。
- **规模与验收**：429 行；**判负**：源里直接派工。

#### F-DAEMON-ENGINE-SCHEDULER · `engine/scheduler.ts` 〔现有〕

- **处置**：目标-保留（croner 驱动 + 错过补跑）。
- **归属/上位**：`docs/16-§四` v0.4「首个定时岗」；79 的 `DEP-croner`。
- **职责 / 非职责**：职责＝`nextRunAt(cron, after)`、`createScheduler(deps)`（due 触发、nextRun 推进、坏 cron 隔离、start/stop 生命周期）、`scheduleIntent(job, firedAt)`（岗→`schedule` 意图）。非职责＝不落岗单（消费在引擎）、不判产物。
- **内部结构**：`SchedulerDeps:46`、`SchedulerStats:61`、`SchedulerReport:69`、`Scheduler:78`、`nextRunAt:91`、`createScheduler:102`、`scheduleIntent:187`。
- **导出与依赖**：7 个导出；依赖 `store`（岗表记录）；零相对导入。
- **IO 与注入**：台账读岗；时钟注入（`nextRunAt` 是纯函数）。
- **状态与并发**：坏 cron 单岗隔离（不炸调度器）；热更＝无状态轮询；`stop()` 与 SIGINT 同收口。
- **错误与观测**：`SchedulerReport`/`SchedulerStats` 汇报；坏 cron 记入统计。
- **测试与证据**：`scheduler.test.ts`（785 行，基线件；十面含 spawn 冒烟）、`sources.test.ts`、`jobs/schedule-report-priority.test.ts`。
- **规模与验收**：203 行；测试件 785 在基线内只减。

#### F-DAEMON-ENGINE-SOURCES · `engine/sources.ts` 〔现有〕

- **处置**：目标-保留（源注册表 + 三源接入）。
- **归属/上位**：`docs/22`（唤起源与解耦）；80-§6 的 `InvokeSource`/`SourceRegistry` 端口。
- **职责 / 非职责**：职责＝`createSourceRegistry(deps?)`（`register/unregister/list/startAll(emit)/stopAll/stats`）、`SchedulerSource`（把 `onDue` 包成源）、`FileWatchSource`（watch-file：基线/去抖/行级隔离/干净停）。非职责＝不消费意图、不判重（引擎侧幂等）。
- **内部结构**：`SCHEDULER_SOURCE_NAME='scheduler':62`、`FILE_WATCH_SOURCE_NAME='watch-file':65`、两份 manifest `:68`/`:75`、`SourceRegistryStats{registered,started,sourceErrors,lastSourceError}:84`、`SourceRegistryEntry:96`、`SourceRegistry:102`、`SourceRegistryDeps:117`、`createSourceRegistry:126`、`SchedulerSourceDeps:234`、`SchedulerSource:244`、`createSchedulerSource:253`、`FileWatchIntentLine:285`、`FileWatchSourceStats:293`、`FileWatchSourceOptions:303`、`FileWatchSource:319`、`createFileWatchSource:336`。
- **导出与依赖**：16 个导出；依赖 `contract`；`node:fs`；相对导入 `./scheduler.ts`。
- **IO 与注入**：fs watch（文件源）；`log?` 注入；时钟由源内部按需。
- **状态与并发**：单源崩溃隔离（不影响他源）；`stopAll` 干净停。
- **错误与观测**：`sourceErrors`/`lastSourceError` 是唯一观测面；**判负**：源自己吞掉错误不计数。
- **测试与证据**：`sources.test.ts`（768 行，基线件；六面含验收三证）、`hrsync/people-change-source.test.ts`、`wake/relay-resume-intents.test.ts`、`jobs-lifecycle.test.ts`。
- **规模与验收**：479 行；新增源＝实现 `InvokeSource` + manifest + 注册表接线三件套。

#### F-DAEMON-ENGINE-NOTIFY-BROADCAST · `engine/notify/broadcast.ts` 〔现有〕

- **处置**：目标-保留（结构同形端口）。**目标新增**：本件或 `contract` 侧补 `NotificationEnvelope` 与 `NotifySendReceipt`（见下），并对齐 80-§6.6 的 `Notifier`。
- **归属/上位**：`105-刀B-1/-2`（studio-dev-219）；78 的 `BIND-XCHG-01`（Matrix 通知绑定在 `packages/matrix`，由 `apps/boot` 装配）；80-§6.6 通知面。
- **职责 / 非职责**：职责＝`NotifyBroadcastFace` 端口形状（目标集/失败项/发送报告）。非职责＝不实现发送（daemon 本体零 matrix）。
- **两个接口不得合并（80-§6.6）**：
  - `Notifier`（`contract/src/ports/notifier.ts:15`）＝**单发**出口，目标是 `send(channel, message): Promise<Result<NotifySendReceipt, ClassifiedError>>`（现状 `Promise<void>`，**无失败通道**）；`NotifySendReceipt = { status:'sent'|'failed'|'skipped'; attempts: number; detail?: string }`。
  - `NotifyBroadcastFace`（本件）＝**批量**广播面（目标集 + 逐项失败汇总），是 daemon 内部形状，**不是** `Notifier` 的别名；两者语义不同（单发回执 vs 批量报表），60-§6.6 要求分开，本卷照办。
- **`NotificationEnvelope`（80-§6.6 的形状，仓内**不存在**）**：`{ notificationId: string; message: Notification; targets: NotifyBroadcastTargets; dedupKey?: string }`。**冲突（必须上呈）**：用户接口清单把它写作 `{ id: … }`，80 写作 `notificationId`——两者只能取一，见 U81-16。本卷按 80 的 `notificationId` 记述，**不自行改名**。
- **`Notification.from` 保持 `string`**：`notifier.ts:11` 现为展示性发件人字符串（注释明示「非安全边界」）。**判负**：改成对象（`{positionRef,…}`）——那会把展示字段变成权威引用，越出 80-§6.6 与 21-§五的鉴权边界。
- **`titleKey`/`bodyKey`**：只允许作为 **matrix 静态表**的可选键（i18n/模板用），不得进 `Notification` 的必填面，也不得成为引擎语义。
- **内部结构**：`NotifyBroadcastTargets:17`、`NotifySendFailure:27`、`NotifySendReport:33`、`NotifyBroadcastFace:39`。
- **导出与依赖**：4 个导出；依赖 `contract`；零 IO。
- **状态与并发**：无状态（纯接口）。
- **错误与观测**：`NotifySendFailure` 逐条记录失败（不吞）；`NotifySendReport = { sent: readonly string[]; failed: readonly NotifySendFailure[] }` 与 80-§6.6 逐字段一致（实测）。
- **测试与证据**：`notify/relay.test.ts`、`test/assembly/serve-notify.test.ts`（后者在范围外）。**不证明**：真实 Matrix 发送、token 鉴权、限流。
- **规模与验收**：41 行；**判负**：在 daemon 内引 `@studio-next/matrix`；把 `Notifier` 与 `NotifyBroadcastFace` 合并成一个类型。

#### F-DAEMON-ENGINE-NOTIFY-DEDUP · `engine/notify/dedup.ts` 〔现有〕

- **处置**：目标-保留。
- **归属/上位**：`105-刀B-5/F10`（studio-dev-219）；`105 提案 §5.4-5`（防反馈环）。
- **职责 / 非职责**：职责＝`NotifyDedup` 类：同单同错误签名窗口聚合，签名＝`<事件名>:<单号>:<attempt>:<note 数字遮蔽>`。非职责＝不做路由（`route.ts`）、不做发送。
- **内部结构**：`NOTIFY_DEDUP_CAP_DEFAULT=512:17`、`export class NotifyDedup:19`（本域唯一 class 导出；仍是可擦除语法）。
- **导出与依赖**：2 个导出；零包依赖。
- **IO 与注入**：纯内存；窗口按调用时间。
- **状态与并发**：有界（cap 512，LRU 式淘汰）；**崩溃即丢**可接受（去重是降噪不是事实）。
- **错误与观测**：无错误路径；**判负**：把去重当事实过滤（台账仍须全量）。
- **测试与证据**：`notify/relay.test.ts`（"同单同错误签名恰一条"）。
- **规模与验收**：50 行。

#### F-DAEMON-ENGINE-NOTIFY-RELAY · `engine/notify/relay.ts` 〔现有〕

- **处置**：目标-保留（拍边界中继）。
- **归属/上位**：`105-刀B`（studio-dev-219）；80-§7「七相位结构不动」——中继在相位外只读 `TickReport.events`。
- **职责 / 非职责**：职责＝`createNotifyRelay(options)`：`relayEvents`（拍边界事件→频道广播）+ 成本警戒即时出口 + 惊动计量。非职责＝不写引擎状态、不产意图、不改事件、**不做跨通道重投**。
- **通道纪律（80-§11.4.1/§6.6）**：MCP 相关通知**只回 `mcp-session` 频道**，不得广播到公司频道或其他通道；`Notifier` 的 `send` 失败目标改为 `Result<NotifySendReceipt, ClassifiedError>`（§4.6 broadcast 条），本件只消费回执、不定义回执。
- **内部结构**：`NotifyMeasureBatch:25`、`NotifyRelayOptions:34`、`createNotifyRelay:114`。
- **导出与依赖**：3 个导出；依赖 `contract`；相对导入 `../intents/escalate.ts`、`./dedup.ts`、`./route.ts`、`./broadcast.ts`。
- **IO 与注入**：广播面注入；log 注入；零 fs。
- **状态与并发**：持有 `NotifyDedup`；**只读本拍事件**（不回溯、不补发）。
- **错误与观测**：发送失败进 `NotifySendReport`；中继异常不得影响主循环（拍边界隔离）。
- **测试与证据**：`notify/relay.test.ts`（175 行，三面）。**不证明**：真实 Matrix 投递、跨进程频道、MCP 会话生命周期。
- **规模与验收**：150 行。

#### F-DAEMON-ENGINE-NOTIFY-ROUTE · `engine/notify/route.ts` 〔现有〕

- **处置**：目标-保留（纯函数路由表，冻结口径）。
- **归属/上位**：`105-刀B-2`（studio-dev-219 任务书冻结）；`130 提案 §6.7.1` 总览低噪摘要。
- **职责 / 非职责**：职责＝`planEventBroadcast(event, from)`（GATE_PASS/STALL/断路/警戒→#alert 与部门频道；日报产物→部门频道；总览低噪）+ `planCostNoticeBroadcast` + `reportOutputOf`。非职责＝不发送、不去重。
- **内部结构**：`EventBroadcastPlan:30`、`reportOutputOf:40`、`planEventBroadcast:57`、`CostNoticeLike:97`、`planCostNoticeBroadcast:114`。
- **导出与依赖**：5 个导出；依赖 `contract`；纯函数零 IO。
- **状态与并发**：无状态；同事件必同路由（可复算）。
- **错误与观测**：不路由＝返回 `undefined`（静默不投递是显式决定）。
- **测试与证据**：`notify/route.test.ts`（106 行，两张冻结表）。
- **规模与验收**：133 行；**判负**：在引擎内硬编码频道名。

#### F-DAEMON-ENGINE-ROOMS-ROOM-DUTY · `engine/rooms/room-duty.ts` 〔现有〕

- **处置**：目标-保留（结构同形端口）。
- **归属/上位**：`130-P3`（频道供给扩展，`130 提案 §6.7.1`/`§6.7.3-④`）；DEV-20 P9/P10。
- **职责 / 非职责**：职责＝`dispatchRoomDuty`（派发相位挂单据房间）、`closeRoomDuty`（CLOSE 相位挂归档）；`MatrixRoomFace` 端口形状。非职责＝不 provision 房间（`@studio-next/matrix`，boot 装配）。
- **内部结构**：`RoomDutyDispatchArgs:18`、`RoomDuty:25`、`RoomFaceSnapshotInput:40`、`CompanyChannelsSupplyReport:49`、`MatrixRoomFace:57`、`MatrixRoomFaceContext:62`、`dispatchRoomDuty:72`、`closeRoomDuty:82`。
- **导出与依赖**：8 个导出；依赖 `contract`；零 `node:*`。
- **IO 与注入**：经端口；`escalate` 回调注入。
- **状态与并发**：挂房失败走 escalate（不阻断派发）；幂等由房间面实现。
- **错误与观测**：`escalate(note)` 是唯一失败出口（不静默）。
- **测试与证据**：`rooms/room-duty.test.ts`（283 行，四组含「未注入零变更」回归锚）。
- **规模与验收**：89 行；**判负**：在 daemon 内引 matrix 包。

---

### 4.7 判读（6 件）

> 域内定位：micro-judge＝「低档小模型只回一个 JSON」，**零生命周期**——不进收割契约、不写 `work_records`，`JUDGE_OK`/`JUDGE_FALLBACK` 是唯一台账锚（`judge/events.ts` 头注）。当前引擎内**唯一接线处**是队列两址（`EngineDeps.judge` ← `judge/sites129.ts`）；其余判读址属**库级/未接**。

#### F-DAEMON-ENGINE-JUDGE-INVOKE · `engine/judge/invoke.ts` 〔现有 / 库级-未接〕

- **处置**：目标-保留（一次调用全序）。
- **归属/上位**：studio-dev-160 `§6.1/§6.2/§6.3`（单 164=单A）；80-§6 的 `ExecutorAdapter` 只读能力声明。
- **职责 / 非职责**：职责＝`createJudgeRuntime` + `invokeJudge`：0) 前置闸（按址熔断 site-open → 拍闸 tick-quota → 三帽）→ 1) 估算 → 2) 预留 → 3) 一次性工作区调用 → 4) 采信/降级 → 5) 结算 + 事件。`dshJudgeAdapterFactory` 提供 v1 冻结面（dsh 家）。非职责＝不做队列语义（`sites129`）、不判业务（回调交还调用方）、不写工时记录。
- **内部结构**：`DEFAULT_JUDGE_CALL_TIMEOUT_MS=10_000:87`、`JudgeSite{siteId,vocab,fallback,caps?,timeoutMs?}:90`、`JudgeDeps{company,ledger,catalog,makeAdapter,now,makeId?,calendar?,limits?,wsParent?}:104`、`JudgeRuntime:120`、`createJudgeRuntime:127`、`JudgeInvokeResult:139`、`dshJudgeAdapterFactory:155`、`invokeJudge:242`。
- **导出与依赖**：8 个导出；依赖 `adapters`（`DshAdapter`/`judgeFamilyOf`）/`contract`/`core`/`store`；相对导入 `../tools/id.ts`、`./brief.ts`、`./accounts.ts`、`./events.ts`、`./workspace.ts`、`../budget-gate.ts`。
- **IO 与注入**：台账（预留/结算/JUDGE_* 事件）、子进程（经 adapter）、一次性工作区（`wsParent` 注入）；时钟注入；有界延迟（`DEFAULT_JUDGE_CALL_TIMEOUT_MS`）。
- **状态与并发**：三道预算闸（事前估算/按址日帽/公司日帽）+ 熔断 + 拍闸；`beginTick` 随拍清拍闸计数（`engine.ts:581` 注释）。失败**降级到 fallback**（不是抛）。
- **错误与观测**：`JUDGE_OK`（采纳）/`JUDGE_FALLBACK`（降级）两事件是唯一观测锚；错误分类须能区分「闸拒/超时/解析失败」。
- **测试与证据**：`judge/judge-invoke.test.ts`（465 行，六面：采纳/降级/三帽/事后超耗与熔断/accounts/dsh 家冻结面）、`judge/sites129.test.ts`（真链）。
- **规模与验收**：447 行；**判负**：把 judge 调用写进 `work_records`（会污染工时与成本口径）。

#### F-DAEMON-ENGINE-JUDGE-ACCOUNTS · `engine/judge/accounts.ts` 〔现有〕

- **处置**：目标-保留（预算面）。
- **归属/上位**：studio-dev-160 `§6.2` 三帽 + R3-c（单 164）；`docs/16-§三` 预算行三节点。
- **职责 / 非职责**：职责＝`reserveJudgeCall`/`settleJudgeCall`/`ensureJudgeSiteDay`/`judgeDaySpent`；`judgeCallScope`/`judgeDayScope`（**冒号分隔**的三段 scope：ULID 大写无冒号、site_id 注册闸禁冒号 ⇒ 三段无歧义）；`validJudgeSiteId`；`UTC_JUDGE_CALENDAR`。非职责＝不做闸判定（`core`）、不调模型。
- **内部结构**：`JudgeCalendar:30`、`UTC_JUDGE_CALENDAR:36`、`validJudgeSiteId:55`、`judgeCallScope:60`、`judgeDayScope:65`、`judgeDaySpent:72`、`reserveJudgeCall:114`、`settleJudgeCall:133`、`ensureJudgeSiteDay:158`。
- **导出与依赖**：9 个导出；依赖 `core`/`store`；零相对导入。
- **IO 与注入**：台账预算行；日历可注入（缺省 UTC）。
- **状态与并发**：日幂等（`ensureJudgeSiteDay`）+ 预留/结算两节点；未结算预留＝可回收（懒收口）。
- **错误与观测**：`validJudgeSiteId` 是注册闸（含冒号即拒）——scope 可解析性的前提。
- **测试与证据**：`judge/judge-invoke.test.ts`（accounts 簿记面：scope 键纪律/日幂等/懒收口）。
- **规模与验收**：210 行；**判负**：改 scope 分隔符（会使历史行不可解析）。

#### F-DAEMON-ENGINE-JUDGE-BRIEF · `engine/judge/brief.ts` 〔现有〕

- **处置**：目标-保留。
- **归属/上位**：studio-dev-160 `§6.1`（单 164）；77 的任务合同语义**不适用**（judge 无合同）。
- **职责 / 非职责**：职责＝`renderJudgePrompt`（brief.md 内容＝角色一句 + 词表声明）、`renderJudgeInstructions`（`AGENTS.md`）、`buildJudgeTaskBrief`（一次性工作区落盘）。非职责＝不做 L0–L5 装配（judge 刻意不走 `prompt` 包全链）。
- **内部结构**：`renderJudgePrompt:63`、`renderJudgeInstructions:76`、`buildJudgeTaskBrief:93`。
- **导出与依赖**：3 个导出；依赖 `contract`/`core`；`node:fs/path`。
- **IO 与注入**：写一次性工作区文件；零时钟。
- **状态与并发**：无状态；文本确定性（同输入同文本，便于回放）。
- **错误与观测**：无错误路径；**判负**：把业务事实塞成自由文本而不走 `factsJson`（会破坏「只回一个 JSON」的可校验性）。
- **测试与证据**：无直接 import；由 `judge/judge-invoke.test.ts` 经 `invokeJudge` 覆盖。
- **规模与验收**：108 行。

#### F-DAEMON-ENGINE-JUDGE-EVENTS · `engine/judge/events.ts` 〔现有〕

- **处置**：目标-保留（事件工厂）。
- **归属/上位**：studio-dev-160 `§6.5 P6`（单 164）；事件名走 contract 前缀族 `JUDGE_OK`/`JUDGE_FALLBACK`。
- **职责 / 非职责**：职责＝`judgeOkEvent` / `judgeFallbackEvent` 构造 `EventRecord`（含词表指纹、耗时、模型、降级原因）。非职责＝不写台账（由 `invoke.ts` 经 `ledger.appendEvent` 写）、不聚合。
- **内部结构**：2 个导出（`:33`、`:59`）。
- **导出与依赖**：2 个导出；依赖 `contract`/`core`；零相对导入。
- **IO 与注入**：零 IO；时间与 ID 由入参。
- **状态与并发**：无状态；**事件即事实**：judge 的零生命周期靠这两条事件记账。
- **错误与观测**：`JUDGE_FALLBACK` 必带原因（缺＝判负）。
- **测试与证据**：`test/panel-judge-align.test.ts`（范围外，面板对齐面）；`judge/*` 测试经 `invokeJudge` 断言事件。
- **规模与验收**：85 行。

#### F-DAEMON-ENGINE-JUDGE-SITES129 · `engine/judge/sites129.ts` 〔现有（两址接线）〕

- **处置**：目标-保留（`160-B·studio-dev-182`，制作人 2026-10-22 全批）。
- **归属/上位**：studio-dev-160 `§6.3` 调用点登记表首两行；`§6.7 单B`。
- **职责 / 非职责**：职责＝两址：`mj-129-pick`（队列选单 top-K）与 `mj-129-interrupt`（插队头 N）；`assemblePickFacts`/`assembleInterruptFacts`（id 升序、同构等长、**无引擎总分**去偏纪律）、`buildPickSite`/`buildInterruptSite`、`moveToFrontOfUnpinned`（纯置换，不越权）、`parseJudgeSites`（址开关 fail-closed）、`createQueueJudge`、`personViewOf`。非职责＝不调模型（`invoke.ts`）、不改队列状态（只给顺序）。
- **内部结构**：`MJ_129_PICK_SITE_ID='mj-129-pick':45`、`MJ_129_INTERRUPT_SITE_ID='mj-129-interrupt':47`、`PICK_TOP_K_MAX=5:49`、`INTERRUPT_HEAD_N=5:51`、`INTERRUPT_PRIORITY_MIN=2:53`、`assemblePickFacts:177`、`assembleInterruptFacts:207`、`buildPickSite:232`、`buildInterruptSite:243`、`moveToFrontOfUnpinned:266`、`QueueJudgeSites:287`、`parseJudgeSites:297`、`createQueueJudge:336`、`personViewOf:412`。
- **导出与依赖**：20+ 个导出；依赖 `contract`/`core`；相对导入 `./invoke.ts`。
- **IO 与注入**：零 IO（除经 `invokeJudge`）；`QueueJudgeHook` 由 `EngineDeps.judge` 注入。
- **状态与并发**：纯置换保证「顺序变更不改变成员」；点火条件不足＝`skipped` 面（零 launch、零预算行）。
- **错误与观测**：`parseJudgeSites` fail-closed；跳过原因可观测（`TickQueueJudgeReport`）。
- **测试与证据**：`judge/sites129.test.ts`（599 行，九面含引擎接线位置「队列定序后、派发决策前」）。
- **规模与验收**：422 行；**判负**：把引擎总分放进 facts（去偏纪律）。

#### F-DAEMON-ENGINE-JUDGE-WORKSPACE · `engine/judge/workspace.ts` 〔现有〕

- **处置**：目标-保留。
- **归属/上位**：studio-dev-160 `§6.1`/`§8 红队 2`（无工具只读沙箱 + 一次性空工作区）。
- **职责 / 非职责**：职责＝`createJudgeCallDirs({parent?})`：每次调用一个全新目录树（`mkdtemp` 独得），调用毕整树删除。非职责＝不做清理策略（调用方删）、不做权限隔离（沙箱在 adapter）。
- **内部结构**：`JudgeCallDirs:24`、`createJudgeCallDirs:44`。
- **导出与依赖**：2 个导出；零包依赖；`node:fs/os/path`。
- **IO 与注入**：**建目录/删目录**（临时树）；`os.tmpdir()` 缺省父目录。
- **状态与并发**：一次性（不可复用）；并发调用互不干扰（各自 mkdtemp）。
- **错误与观测**：创建失败即抛（调用前）；残留临时树＝可观测缺陷。
- **测试与证据**：`judge/judge-invoke.test.ts`（经 invoke 覆盖）。
- **规模与验收**：67 行；**判负**：复用工作区（会把上次上下文带进判断）。

---

### 4.8 演示与测试缝（2 件）

> 本组两个文件**不是能力**：`fakes.ts` 在生产装配可达（演示模式），`crash-points.ts` 只在设了环境变量时生效。二者均不得作为「已支持」的证据（80-§12.6 第 9–11 条同口径）。
>
> **允许出现的位置（实测 2026-10-27：`grep -rn 'createFake' apps/daemon/src apps/boot/src` → 3 个 import 行 + 3 个调用点）**——三处守卫强度**不同**，不能混为一谈：
>
> | 调用点 | 触发条件 | 守卫强度 |
> |---|---|---|
> | `assembly/platform/wire.ts:147` | `wirePlatform()` 的**兜底 return**：`localfile`／`taiga` 两分支之外的一切值都落到这里 | 上游已兜回：`daemon.yaml` 的 `platform` 收紧为枚举，未知值抛 `CONFIG_INVALID`（`assembly/serve.ts:463-470`，注释原话「原『未知值静默降 fake』…必须堵死」）；本处**无 log**，但启动横幅打印 `platform=fake`（`serve.ts:1541`）与 `fake 平台（demo）`（`serve.ts:1547`） |
> | `assembly/serve.ts:975` | 未配 `agent.yaml` 时的 `else` 分支：`registry.register(createFakeAdapter(), { default: true })` | 注册处**无 log**；启动横幅 `execMode` 打印 `fake executor（demo）`（`serve.ts:1548`） |
> | `cli/external.ts:94` | 触发面 CLI 恒用内存平台（先 `createGatedPlatform` 过网关再交给引擎） | 三处里**唯一带显式告警**：`:95` `console.warn('[external] 警告：触发面平台为 fake demo 骨架…')` |
>
> **fake 能证明什么**：七相位编排、四要件判定、三闸顺序、事件去重、崩溃恢复接管、投影可重建——这些是**本仓回归**（与真实平台无关的编排正确性）。
> **fake 不能证明什么**：真实平台/adapter 行为（含分页/字段/状态集差异）、跨进程真并发、SIGKILL 后平台单据存续（fake 平台是内存态，重启即失忆）、任何能力声明为真（见下 `FAKE_CAPABILITIES`）。
>
> **目标处置**：三处入口都要有**可见**「演示模式」标记——`cli/external.ts` 已有（`:95`）；`serve.ts` 两处只靠启动横幅间接可见，注册/返回点本身静默，登记 U81-15（与 U81-05 同族）。

#### F-DAEMON-ENGINE-FAKES · `engine/fakes.ts` 〔仅测试/演示（生产可达）〕

- **处置**：目标-退役候选（81-§3.3「当前 fake 只归测试/演示；不得因存在于 `src` 就进入生产装配」与现状冲突——现状已在生产装配可达，见上）。在退役前必须显式标注「演示模式」。
- **归属/上位**：`docs/23-§四`「demo 模式（localfile）零外部依赖跑通 TTHW」的 daemon 侧预演件。
- **职责 / 非职责**：职责＝`createFakePlatform(opts)`（内存 `FlowPlatform`：分页、schema 状态、ULID 前缀）与 `createFakeAdapter(opts)`（九种 `FakeAdapterMode` 注入面）。非职责＝**不证明任何真实平台/adapter 行为**；不模拟并发真实进程（`pid=0`，kill 只经 `onKill` 钩子可观测）。
- **内部结构**：`FakePlatformOptions:50`、`createFakePlatform:78`、`FakeAdapterMode:241`（`ok`/`empty_output`/`incomplete`/`no_report`/`stalled`/`external_error`/`sentinel`/`sentinel_old`/`sentinel_deliverables`）、`FakeAdapterOptions:257`（`mode` 支持函数形态＝运行期切形态）、`FAKE_REPORT_MD:303`、`FAKE_SUMMARY_JSON:318`、`createFakeAdapter:333`；模块私有 `FAKE_CAPABILITIES`（`:294`，挂载于 `createFakeAdapter` 的 `:344`）：`budget_cap:false`／`cancel_turn:false`／`session_resume:false`／`agents_md:'native'`／`cost_native:false`——**这是声明值，不是实测能力**；`agents_md:'native'` 意味着 fake 路径不会走 `agents_md≠native` 的 overlay 装载分支。
- **导出与依赖**：7 个导出；依赖 `contract`；`node:fs/path`（落 REPORT/summary）。
- **IO 与注入**：写工位文件（fake 产物）；`onLaunch`/`onKill` 是测试断言钩子；`usage`/`model` 注入账面。
- **状态与并发**：每个 adapter 实例持会话数组；`stalled` 形态驻留直到 `kill()` 放行。
- **错误与观测**：形态即观测；**凭据红名单**：fake 流文本永不含凭据值（`FakeAdapterOptions.onLaunch` 注释明示）。
- **测试与证据**：被 **44** 个测试文件 import（实测 `grep -rln "from '[^']*fakes" apps/daemon/test | wc -l` = 44；覆盖 `e2e`/`scheduler`/`sources`/`merge-*`/`jobs-*`/`directive/*`/`wake/*`…）。**生产可达性（实测调用点，非 import 行）**：`assembly/platform/wire.ts:147`、`assembly/serve.ts:975`、`cli/external.ts:94`（守卫差异见上表）。
- **规模与验收**：451 行；**判负**：用 fake 的绿当真实能力证据；把 fake 当默认注册项而不打「演示模式」标（现状：`serve.ts:975` 与 `wire.ts:147` 两处注册/返回点静默，登记 U81-15）。
- **目标契约（未实现，不得计入已实现项）**：
  - **只许 demo/测试**：`fakes.ts` 的目标是「仅演示模式与测试可达」，不得作为真实装配的回落值。
  - **装配 gating**：`assembly` 侧必须显式区分 `demo` 与 `real`；真实装配缺平台/缺执行体时返回 `Err({failure:'unavailable',category:'STALL',subcause:'platform-missing'})`（平台面）或 `Err({failure:'rejected_precondition',category:'CONFIG_INVALID',subcause:'executor-missing'})`（配置面缺执行体），并拒绝启动该能力——**不得**回落 `createFakePlatform()` / `createFakeAdapter()`。
  - **明报**：即使允许 demo，注册点本身要留结构化可见态（不只靠启动横幅），并把「演示模式」纳入启动汇报。
  - **计数纪律**：在 gating 落地前，`fakes.ts` 不计入「已实现件」的完成度（它是测试缝，不是能力）。

#### F-DAEMON-ENGINE-CRASH-POINTS · `engine/crash-points.ts` 〔仅测试〕

- **处置**：目标-保留（受控测试缝，**非生产行为**）。
- **归属/上位**：F3-11；80-§8.7 崩溃注入五点表（同表）。
- **职责 / 非职责**：职责＝`crashHook(point)`：env `SN_CRASH_POINT` 命中即 `process.exit`；未设＝**零行为**。非职责＝不做恢复（恢复在下次启动的接管与对账）。
- **内部结构**：`CRASH_POINTS = ['dispatch-reserved','dispatch-launched','harvest-verdict','heartbeat-write','shutdown-drain']:39`、`CrashPoint:48`、`crashHook:57`。
- **导出与依赖**：3 个导出；零包依赖、零相对导入（除测试夹具 `test/engine/crash-points.ts` 同源）。
- **IO 与注入**：读 `process.env.SN_CRASH_POINT`；`process.exit`。
- **状态与并发**：无状态；五点与 80-§8.7 八点表的关系＝本文件是**已实现子集**（另三点登记 U81-12）。
- **错误与观测**：`exit` 即观测；**判负**：在生产 env 里设该变量（会让 daemon 定点退出）。
- **测试与证据**：`crash-injection.test.ts`（446 行，五点各 kill 一次 + 重启恢复先查 receipt）；夹具 `test/engine/crash-points.ts`。
- **规模与验收**：61 行。

---

### 4.9 测试件（61 件：60 测试 + 1 夹具）

#### 4.9.0 测试面口径

- **目录顶格**：`test/engine/` 直下 25 件＝目录 25 上限，**新增测试只能进对应子域目录**（81-§3.3 末条；BC-S1）。
- **无外部夹具**：本域零非 TS 文件（`find … ! -name '*.ts'` = 0），夹具全部内联；唯一共享基建是 `test/engine/crash-points.ts`。
- **层级**：单测（纯函数域件）< 集成（fake 平台 + fake adapter，经 `createEngine` 真跑七相位）< 崩溃注入（真 `serve` 进程 + SIGKILL）。**没有任何测试使用 LLM 打桩**（AGENTS.md §五.4）。
- **统一不证明清单（本节每一件测试都受此约束，逐件不再重复长句）**：
  1. **不证真机平台**：任何 fake `FlowPlatform`（含 `gated-platform` 包装）的绿都不证明真实 YouTrack/Taiga/本地平台的分页、字段、状态集、限速、鉴权行为；真机归 82。
  2. **不证真实执行体**：fake adapter / 进程内 adapter 的绿不证明真实 DSH/claude/codex/kimi 的启动、流形态、`agents_md` 通道、会话续跑；真实 CLI 归 82。
  3. **不证跨进程**：凡在单进程内构造的台账、租约、wkey、通知面，都不证明跨进程互斥、`WriterLeasePort` fence、多 daemon 并发；唯一例外是 `crash-injection.test.ts` 这类**真子进程**测试，但它也只证本进程崩溃-重启，不证多实例。
  4. **不证跨实现**：适配器/平台的「同形」断言只证本仓接口形状，不证其它实现的等价性。
  5. **不证性能**：除显式的拍有界/时间片断言（`freeze-repro`）外，任何耗时结论都不成立。
  6. **fake 不产证据**：fake 的绿不得写入任何「已支持某能力」的结论；能力声明（`FAKE_CAPABILITIES`）是声明值不是实测值（§4.8）。
  7. **纯函数件只证本仓回归**：`taxonomy`/`route`/`dedup`/`tokens`/`sentinel` 一类叶子件的单测，只证输入→输出与边界，不证语义正确性来自规格（规格以契约包为准）。

#### 4.9.1 顶层 25 件

- **F-DAEMON-ENGINE-TEST-E2E** `test/engine/e2e.test.ts`（532 行）— 覆盖：demo 端到端（create→派发→收割→GATE_PASS→CLOSE）、失败链与断路器（闸红→GATE_FAIL→3 连击→ESCALATE+bug 单+停重派）、并发四闸（泳道/人/每拍/在途，闸序冻结）、store v4 切换回归（全路径无自建 DDL）、收割账目面（tokens 四桶兼容 + model 全链）。夹具/断言：`createFakePlatform`+`createFakeAdapter`+真 `createEngine`；断言事件序列与 `TickReport`。缺口：真实平台/adapter、跨进程不在本层。
- **F-DAEMON-ENGINE-TEST-FREEZE-REPRO** `test/engine/freeze-repro.test.ts`（347 行）— 覆盖：DEV-9 冻结复现——收割流驻留时主循环保持拍有界（`docs/17-§2`）。夹具/断言：驻留流 + 时间片断言（`harvestSliceMs`），`parkRace` 行为面。缺口：真实 adapter 的流驻留形态未证。
- **F-DAEMON-ENGINE-TEST-BUDGET-GATE** `test/engine/budget-gate.test.ts`（555 行）— 覆盖：估算两态（价目表接入面）、预留先落账才派发（20-§六.8）、duplicate 幂等 adopt、收割后结算与失败保留、态 B 降级与 `daemon.yaml` 装载面。夹具/断言：`ModelCatalog` 注入与否两套；断言预留行先于 dispatch。缺口：真实模型价目与真实账单对账归 82。
- **F-DAEMON-ENGINE-TEST-CRASH-INJECTION** `test/engine/crash-injection.test.ts`（446 行）— 覆盖：崩溃注入五点各 kill 一次（`dispatch-reserved`/`dispatch-launched`/`harvest-verdict`/`heartbeat-write`/`shutdown-drain`），重启恢复先查 receipt。夹具/断言：真 `serve` 子进程 + `SN_CRASH_POINT` + 日志 READY 信号（不盲等定时）。缺口：**fake 平台失忆**——SIGKILL 后单据与活动流随进程消亡，真实平台存续面未证（夹具头注自述「诚实边界」）。
- **F-DAEMON-ENGINE-TEST-CRASH-POINTS** `test/engine/crash-points.ts`（167 行，**夹具非测试**）— 覆盖：崩注入回归集基建：serve 进程拉起、READY 信号等待、欠账岗播种与重挂、存活进程清场。夹具/断言：与 `src/engine/crash-points.ts` 分工＝生产侧 env 门控点 vs 本件 spawn 侧编排。缺口：依赖 fake 平台内存态，故「重启等价工作再驱动」不能直接外推到真平台。
- **F-DAEMON-ENGINE-TEST-BREAKER-HALF-OPEN** `test/engine/breaker-half-open.test.ts`（258 行）— 覆盖：外部错误熔断→冷却→试探→GATE_PASS 复位→全链 CLOSE（死锁解除）；试探失败回全开续冷却，ESCALATE 仍恰一次。夹具/断言：`mode='external_error'`；断言断路器状态转移与 ESCALATE 计数。缺口：真实限速（429）时序未证。
- **F-DAEMON-ENGINE-TEST-GATED-PLATFORM** `test/engine/gated-platform.test.ts`（437 行）— 覆盖：`FlowPlatform` 全方法二分（结构穷尽）、写面被闸且底层真被调、坏 token fail-closed（底层零调用）、控制面 key 吊销后全拒、读面直通一致、错误两级分类、demo e2e 透明性回归。缺口：真网关/真 wkey 服务面归 82。
- **F-DAEMON-ENGINE-TEST-HARVEST-RECON** `test/engine/harvest-recon.test.ts`（364 行）— 覆盖：`statHarvestDenial`/`deliverablesOf`（E12 可达性与悬空面）、工况一缺归档→`REPORT_MISSING`+内容哈希幂等补收、工况二缺 REPORT→`HARVEST_INCOMPLETE` 可见且不补收代写、工况三 chmod 000→`HARVEST_DENIED` 不静默且 umask 前移后新单产物 ≥0644。缺口：非 POSIX 文件系统语义未证。
- **F-DAEMON-ENGINE-TEST-JOB-OUTPUT** `test/engine/job-output.test.ts`（299 行）— 覆盖：`reportFileName` 命名口径（本地时区取日与 cron 同源）、`accountJobOutput` 空收账三态与永不抛、引擎链路日报岗 GATE_PASS→REPORT 按 `jobs[].output` 收账。缺口：真实公司目录并发写未证。
- **F-DAEMON-ENGINE-TEST-JOBS-LIFECYCLE** `test/engine/jobs-lifecycle.test.ts`（562 行）— 覆盖：cadence 源播种/幂等/热更/所有权、SLA 计时器三态、两源验收三证、集成链（岗→scheduler→派发→SLA 超时 escalate）、serve 接线。缺口：真实 cron 长跑与 DST 边界仅用注入时钟。
- **F-DAEMON-ENGINE-TEST-NOOP-OBSERVABILITY** `test/engine/noop-observability.test.ts`（172 行）— 覆盖：noop 决策观测面（DEV-40 ②：静默 noop＝观察黑洞）。断言：每拍 `TickReport` 必须能解释「为什么没动」。不证明真机平台/真实 DSH/跨进程/跨实现，只证本仓纯逻辑回归（§4.9 统一清单）。
- **F-DAEMON-ENGINE-TEST-READ-TIERS** `test/engine/read-tiers.test.ts`（281 行）— 覆盖：三档结构（`createView`，blind 结构性无字段）、role→tier 映射（拟稿表）、角色解析（v0 无 role 元数据口径）、任务书读面节渲染。缺口：真实公司目录带角色元数据时未证（U81-08）。
- **F-DAEMON-ENGINE-TEST-READ-TIERS-E2E** `test/engine/read-tiers.e2e.test.ts`（236 行）— 覆盖：读面分级装配链路（Full/Focused/Blind），验证岗 Blind 防生成者上下文污染。缺口：真实验证岗行为未证。
- **F-DAEMON-ENGINE-TEST-SCHEDULER** `test/engine/scheduler.test.ts`（**785 行，基线件**）— 覆盖：`nextRunAt` 求值、due 与 nextRun 推进、坏 cron 隔离、热更、start/stop 与 SIGINT 收口、`schedule` 意图全链、幂等与重启重放、明报路径、serve 接线、`studio-next serve` spawn 冒烟。缺口：长周期 cron 与真实时钟漂移未证。**只减不增**（`boundary-rules.mjs:167`）。
- **F-DAEMON-ENGINE-TEST-SOURCES** `test/engine/sources.test.ts`（**768 行，基线件**）— 覆盖：注册表三面、startAll/stopAll 与单源崩溃隔离、scheduler 源包装、watch-file 源（基线/去抖/行级隔离/干净停）、serve 三源装配、验收三证（`docs/22-§三`）。缺口：真实 IDE 写盘风暴形态未证。**只减不增**（`boundary-rules.mjs:170`）。
- **F-DAEMON-ENGINE-TEST-STALL-RESPONSE** `test/engine/stall-response.test.ts`（304 行）— 覆盖：负对照（`stallKillAfterAlarms=0` 改动前世界如实存档）、kill 面（整树杀+interrupted 收口+rescan 重派）、消亡面（无句柄→GATE_FAIL `WORKER_DEAD`+工位收口+活动驱动重派）、断路收敛（僵死-杀-重派循环→同签名熔断→ESCALATE+bug 单）。缺口：真实 SIGKILL 语义仅经 fake `onKill` 钩子。
- **F-DAEMON-ENGINE-TEST-STALL-RESCAN-REVIVAL** `test/engine/stall-rescan-revival.test.ts`（241 行）— 覆盖：kill 面零活动世界咬合释放消费键→rescan 即刻可派（studio-dev-141）、键释放不得绕过断路器（DEV-46 半开）。不证明真机平台/真实 DSH/跨进程/跨实现，只证本仓纯逻辑回归（§4.9 统一清单）。
- **F-DAEMON-ENGINE-TEST-STARVATION-REVIVAL** `test/engine/starvation-revival.test.ts`（281 行）— 覆盖：缺陷①候选积压饿死→镜像对账重决策（DEV-42①）、缺陷②CLOSE 单复活封锁→RESUME 一等语义+closed-set 释放（DEV-42②）。缺口：大规模积压（百单级）性能未证。
- **F-DAEMON-ENGINE-TEST-TYPEFLOWS** `test/engine/typeflows.test.ts`（99 行）— 覆盖：`flowsFromWorkflows` 翻译面。缺口：非法声明由公司判定器拦，本件不重复。
- **F-DAEMON-ENGINE-TEST-TYPEFLOWS-E2E** `test/engine/typeflows.e2e.test.ts`（384 行）— 覆盖：import 面过闸并折叠三桶、零代码全链（provision→建 spike 单→拍链走新状态名）、审批环 `approval` 锚、N1 热换面（`applyCompanyUpdate` 换 flows 在 tick 边界生效）。不证明真机平台/真实 DSH/跨进程/跨实现，只证本仓纯逻辑回归（§4.9 统一清单）。
- **F-DAEMON-ENGINE-TEST-UNKNOWN-STATE-SENTINEL** `test/engine/unknown-state-sentinel.test.ts`（352 行）— 覆盖：单级哨流外态 ESCALATE（每单每态一次）、状态集巡逻核（schema−声明≠∅→心跳哨兵单）、C2 声明态漂移哨（双向比对）、127-C 州表卫生白名单（`FOREIGN_KNOWN` 观察级 + 巡逻核并集）。缺口：真实平台新增状态的回流时序未证。
- **F-DAEMON-ENGINE-TEST-WORKER-KEY** `test/engine/worker-key.test.ts`（156 行）— 覆盖：签发形状、env 通道（`workerKeyCredentials`/`workerKeyGuidance`，TaskBrief.credentials v1.4）、吊销与轮换（关单即吊销、一 attempt 一 key）。缺口：真实 studio-tools MCP 会话面在下一件覆盖。
- **F-DAEMON-ENGINE-TEST-WORKER-KEY-LIFECYCLE** `test/engine/worker-key-lifecycle.test.ts`（538 行）— 覆盖：dispatch 签发与注入（launch 前，env 通道）、预算拒派不签发、GATE_FAIL 凭据离场+重派重签、断路熔断后**不吊销**+冷却后半开重签、GATE_PASS 存续与 CLOSE 吊销、未注入零变更、进程内 `InMemoryTransport` 的凭据透传（credentials → 进程内 MCP 调用 → comment 成功 → 关单后拒调）。**不证明**：stdio/跨进程、真实 gateway 验签、`initialize._meta['studio-wkey']` 通道的有效性（该通道仅 legacy；per-ticket env 只有一个名字 `STUDIO_TOOLS_WKEY`，无别名，且 stdio 侧未实现——U81-21）。缺口：真实网关签发/吊销服务面归 82。
- **F-DAEMON-ENGINE-TEST-INSTRUCTIONS-CHANNEL** `test/engine/instructions-channel.test.ts`（240 行）— 覆盖：bridge 通道（`agents_md=user_level`）落盘/env 目标/清理、清理失败面（GATE_FAIL no_report 同删）、清理拒派面（预算拒派即删）、native 对照行为不变。缺口：真实 DSH 插件装载面未证。
- **F-DAEMON-ENGINE-TEST-INSTRUCTIONS-STORE** `test/engine/instructions-store.test.ts`（121 行）— 覆盖：`instructionsTarget` 落点（workspace 外）、0600 落盘与幂等清理、overlay 生成（`docs/34-§3.1` 装载法 B）、bridge 通道与 workspace 结构隔离。缺口：Windows ACL 未证。

#### 4.9.2 子域 36 件

- **F-DAEMON-ENGINE-TEST-COST-CLOSE-CLOSE** `test/engine/cost-close/close.test.ts`（502 行）— 覆盖：时刻闸与首冻、三路降级不静默、追平（崩溃落后多日一次收齐）、巡检（S3 迟到事实次日补账）、对账段与报告面、失败面（不前进不静默）、`costCloseDeps` 缝装配、财务分析面入报告、报告形状。缺口：真实财务岗读取口径归 82。
- **F-DAEMON-ENGINE-TEST-COSTGUARD-CONSUME** `test/engine/cost-guard/consume.test.ts`（445 行）— 覆盖：P0-B 端到端（公司预算 warn 档→收件箱队首警戒单，零手工派单）、同拍多醒幂等键按 dedupKey 分立、四档接线（watch/notify｜warn/dispatch｜alarm/dispatch+notify｜hard/gate）、fail-closed 判负全明报、`costThresholdKey` 单源公式。缺口：真实成本数据分布未证。
- **F-DAEMON-ENGINE-TEST-COSTGUARD-SEAMS** `test/engine/cost-guard/seams.test.ts`（281 行）— 覆盖：`foldHarvestCost` 即时折算四路（native 为尊→快照→兜底→不猜价）、收割缝（GATE_PASS note + 三面同值 + usage_daily write-through）、人日硬线拒派（`refusal over-person-cap`）。缺口：价目表缺失的极端组合未穷尽。
- **F-DAEMON-ENGINE-TEST-COSTGUARD-SOURCE** `test/engine/cost-guard/source.test.ts`（273 行）— 覆盖：cost-threshold 源面关与公司档、人档与取价基准。缺口：源在真实 tick 节奏下的触发频率未证。
- **F-DAEMON-ENGINE-TEST-DIRECTIVE-PARSE-QUALIFY** `test/engine/directive/parse-qualify.test.ts`（223 行）— 覆盖：`parseDirectiveComment`（词表 v1 四动词、行首「批示:」半角冒号）、`buildDirectiveAuthorizer`（白名单三源 + 派单律严格高）、202-P1 扩位（dispatcher 源 + 验收位别律 R3）、`buildEventIndex` 批示派生（APPROVE 置位/DISPATCH 清零/ESCALATE 不站立）。不证明真机平台/真实 DSH/跨进程/跨实现，只证本仓纯逻辑回归（§4.9 统一清单）。
- **F-DAEMON-ENGINE-TEST-DIRECTIVE-E2E** `test/engine/directive/directive.e2e.test.ts`（513 行）— 覆盖：S4 批示归一×防御（伪造批示不得推进状态）、S5 打回闭环（状态不动或理由丢失＝判负）。缺口：真实评论时序与并发批注未证。
- **F-DAEMON-ENGINE-TEST-DIRECTIVE-ACCEPTANCE-E2E** `test/engine/directive/acceptance.e2e.test.ts`（345 行）— 覆盖：S2 验收位资格与站立（dispatcher 批示合法；非白名单拒且状态不动）、S3 验收打回重做链（过渡已派发 + resume 派发 + attempt 续号 + 前情含理由）。不证明真机平台/真实 DSH/跨进程/跨实现，只证本仓纯逻辑回归（§4.9 统一清单）。
- **F-DAEMON-ENGINE-TEST-DIRECTIVE-FLOWS** `test/engine/directive/flows.test.ts`（300 行）— 覆盖：S1 提案类型流声明、S2 建单直落待批（落新单/平台默认＝判负）、S3 类型隔离（既有等级流被扰动＝判负）。缺口：平台侧默认态的方言差异未证。
- **F-DAEMON-ENGINE-TEST-HRSYNC-HRSYNC** `test/engine/hrsync/hrsync.test.ts`（293 行）— 覆盖：`enqueueHrBatch`（apply 段入队、零平台 IO）、`drain`（补单→挂账→三面执行→complete）、失败语义（重试→达限 failed+ESCALATE，不自动开 bug 单）、`maxPerTick` 上限。缺口：三面并发失败的交叉组合未穷尽。
- **F-DAEMON-ENGINE-TEST-HRSYNC-PEOPLE-CHANGE-SOURCE** `test/engine/hrsync/people-change-source.test.ts`（129 行）— 覆盖：publish 意图形状（payload 七字段+指纹）、`liveEmit ?? sink` 双出口、`wirePeopleChangeSource` 注册件（serve 唯一调用点）。不证明真机平台/真实 DSH/跨进程/跨实现，只证本仓纯逻辑回归（§4.9 统一清单）。
- **F-DAEMON-ENGINE-TEST-HRSYNC-PEOPLE-CHANGE** `test/engine/hrsync/people-change.test.ts`（278 行）— 覆盖：P0-A 端到端（新人入司→对账岗收件箱自动出现对账单）、幂等双层（源 at-least-once × 引擎恰好一次）、`mergeDataChangeRoutes`（org-config 规范位 + yaml 逃生位）、publish 隔离（双写失败不炸 apply 段）。缺口：真实公司目录人事变更事件源未证。
- **F-DAEMON-ENGINE-TEST-HRSYNC-TAIGA-FACE** `test/engine/hrsync/taiga-face.test.ts`（180 行）— 覆盖：`ensureMember`（入场链+幂等）、`ensureRole`/`removeMember`、T5 写通（成员集变更后 `invalidateMembers()`，缓存不过夜）。缺口：**真机 Taiga S0 未证**（U81-11），邀请令牌落 console 的真实形态未证。
- **F-DAEMON-ENGINE-TEST-JOBS-FRESHNESS** `test/engine/jobs/freshness.test.ts`（232 行）— 覆盖：`graceMsFor` 解析序（逐岗>档缺省>cron 桶）、`dstAdjustMs`、尖刺四态、`declaredTypeIdsOf`、`jobContractLoadWarnings`（缺流/组合）。缺口：真实 DST 切换日未测（现用注入时钟）。
- **F-DAEMON-ENGINE-TEST-JOBS-HARVEST-RECON-R4** `test/engine/jobs/harvest-recon-r4.test.ts`（429 行）— 覆盖：R4 读回门——工单型岗归档件内容门④ + 哨兵门⑤（`127-A §4.5`）。不证明真机平台/真实 DSH/跨进程/跨实现，只证本仓纯逻辑回归（§4.9 统一清单）。
- **F-DAEMON-ENGINE-TEST-JOBS-SCHEDULE-REPORT-PRIORITY** `test/engine/jobs/schedule-report-priority.test.ts`（298 行）— 覆盖：report 型定时岗物化后派发饥饿（活动世界）、零活动平台首个成员拍无候选（pending 直删＝峰值丢地板）。缺口：大规模并发岗未证。
- **F-DAEMON-ENGINE-TEST-JOBS-SENTINEL** `test/engine/jobs/sentinel.test.ts`（223 行）— 覆盖：nonce 机械落法、`patrolJobOfNote`、`ticketSentinelAnchor` dedup 槽、`sentinelDutyForTicket` 义务判定、`verifySidecarSentinel` 四态 fail-closed、路径面读不到＝`unreadable`、`sentinelBriefBlock` L4 注入段。不证明真机平台/真实 DSH/跨进程/跨实现，只证本仓纯逻辑回归（§4.9 统一清单）。
- **F-DAEMON-ENGINE-TEST-JUDGE-INVOKE** `test/engine/judge/judge-invoke.test.ts`（465 行）— 覆盖：采纳路径（三闸过→采纳→JUDGE_OK→三行落账）、降级路径、三帽（事前估算+按址日帽+公司日帽）、事后超耗与熔断拍闸、accounts 簿记（scope 键纪律/日幂等/懒收口）、`dshJudgeAdapterFactory` v1 冻结面。缺口：真实低档模型输出分布与解析成功率未证（U81-13）。
- **F-DAEMON-ENGINE-TEST-JUDGE-SITES129** `test/engine/judge/sites129.test.ts`（599 行）— 覆盖：`parseJudgeSites` 址开关 fail-closed、facts 装配（id 升序/同构等长/无引擎总分）、词表构建、`moveToFrontOfUnpinned` 纯置换、pick 真链（真 `invokeJudge`+真台账）、点火条件（skipped 面零 launch 零预算行）、interrupt 真链、熔断与拍闸透传、引擎接线位置（队列定序后、派发决策前）。缺口：真机模型服务稳定性未证。
- **F-DAEMON-ENGINE-TEST-MERGE-RUN** `test/engine/merge/merge-run.test.ts`（484 行）— 覆盖：S2 `runMergeGate` 四脸（先门禁后 MERGE）、S3 合并指令块冻结原文、S1 触发面（轨道分派/顺延/终局让位）、S1e 派发-租约-收口全链（host 级）。缺口：真实 git 仓库形态与冲突未证。
- **F-DAEMON-ENGINE-TEST-MERGE-RUN-E2E** `test/engine/merge/merge-run.e2e.test.ts`（499 行）— 覆盖：S4 真单刀全链（批准→派发合并跑→收割四要件→MERGE 真事件→已交付）、S5 降级手工链（断点缺 `executor_session_id`）、S6 闸门红收口（四要件缺→冲突兜底，无断路器不自动重试）、S7 合并租约（单栈双单同拍批准一进一顺延 + 队列栏 + rescan 补派 + 串行收口）。缺口：`mergeRun` 真机端口（真 git）整链未证（U81-10）。
- **F-DAEMON-ENGINE-TEST-MERGE-CONFLICT-E2E** `test/engine/merge/merge-conflict.e2e.test.ts`（339 行）— 覆盖：S5 双单冲突（第二单合并跑不齐→`MERGE_CONFLICT` 兜底→宰相批示→模拟迁移收口）。缺口：真实冲突合并面未证。
- **F-DAEMON-ENGINE-TEST-MERGE-LEASE** `test/engine/merge/merge-lease.test.ts`（234 行）— 覆盖：R1 租约簿三面、R2 TTL+死主回收、R3 host 级两拍（续租/队列栏）、S7 L0 无类型流回放（102 次面关轨 byte-identical）。缺口：多进程真并发未证。
- **F-DAEMON-ENGINE-TEST-NOTIFY-RELAY** `test/engine/notify/relay.test.ts`（175 行）— 覆盖：`NotifyDedup`（同单同错误签名恰一条）、`relayEvents`（拍边界中继）、`costNoticeOutlet`（escalate 即时出口）。缺口：真实 Matrix 发送面归 82（`packages/matrix`）。
- **F-DAEMON-ENGINE-TEST-NOTIFY-ROUTE** `test/engine/notify/route.test.ts`（106 行）— 覆盖：`planEventBroadcast` 冻结路由表、`planCostNoticeBroadcast`。缺口：新事件类型未登记路由＝静默不投递（设计如此，须评审）。
- **F-DAEMON-ENGINE-TEST-PRICING** `test/engine/pricing/pricing.test.ts`（360 行）— 覆盖：定价更新单据化消费（GATE_PASS 后置步）、stale 守夜（相位 7 尾日锚步，P5 每晨必更）。缺口：真实价目发布流程未证。
- **F-DAEMON-ENGINE-TEST-ROOMS-ROOM-DUTY** `test/engine/rooms/room-duty.test.ts`（283 行）— 覆盖：DISPATCH 相位挂单据房间（DEV-20 P9）、岗单物化路径派发同挂房（studio-dev-218 复现）、CLOSE 相位挂归档（P10）、未注入零行为变更。缺口：真实 Matrix 房间面归 82。
- **F-DAEMON-ENGINE-TEST-SENTINEL-EVENTS-INDEX-JOB-ANCHOR** `test/engine/sentinel/events-index-job-anchor.test.ts`（59 行）— 覆盖：`buildEventIndex` 岗单锚（`jobAnchorOf`）。缺口：note 文本协议无 schema（U81-06）。
- **F-DAEMON-ENGINE-TEST-SPLIT-DIRECTIVE** `test/engine/split/directive.test.ts`（112 行）— 覆盖：语法定位、strict 校验 fail-closed、幂等键与装配体。不证明真机平台/真实 DSH/跨进程/跨实现，只证本仓纯逻辑回归（§4.9 统一清单）。
- **F-DAEMON-ENGINE-TEST-SPLIT-E2E** `test/engine/split/split.e2e.test.ts`（411 行）— 覆盖：S6 幂等（判负线＝双建）、S7 全链（判负线＝停摆误报/锚点断链）。缺口：真实平台建单速率未证。
- **F-DAEMON-ENGINE-TEST-SPLIT-SUGGEST** `test/engine/split/suggest.test.ts`（104 行）— 覆盖：三因子打分、建议评论文本形态（`§6.5.2`）。不证明真机平台/真实 DSH/跨进程/跨实现，只证本仓纯逻辑回归（§4.9 统一清单）。
- **F-DAEMON-ENGINE-TEST-TIER-MODEL-TIER** `test/engine/tier/model-tier.test.ts`（368 行）— 覆盖：`resolveModelTier` 三级（面关=undefined）、`modelTierDispatchFace`（在册指名/缺位降级/familyOf 剥后缀）、`provisionModelTierOverlays`（低/高档生成，mid 不生成）、`parseModelTierTickets` fail-closed、`checkTierPositionDeclarations` 三面同源漂移即拒、引擎接线（档路由→执行位选择→DISPATCH 锚→work_records）。缺口：真实 DSH 模型名映射未证。
- **F-DAEMON-ENGINE-TEST-TODOQUEUE-PERSON-GATE-QUEUE** `test/engine/todoqueue/person-gate-queue.test.ts`（538 行）— 覆盖：域件纯函数三面（成员资格/携带态与定序/投影与配置解析）、R3 人闸（缺省 1 串行、顺延不丢、两人互不锁、覆盖面放宽）、R2/R5 投影与 wait 锚（`todo_queue` 落表 + DISPATCH note + scheduleToStart）、R4 排序键引擎级红证（ageBoost 饥饿防线/置顶/排序器注入）。缺口：真实大规模队列延迟未证。
- **F-DAEMON-ENGINE-TEST-TYPEFLOWS-PROPOSAL** `test/engine/typeflows/proposal-typeflow.test.ts`（380 行）— 覆盖：import 面（`T:proposal` + `yt.typeInbox` 过闸折叠）、S2 proposal 建单直落待批、S2-批（autoApprove→待批放行 DISPATCH）、S3 既有流零扰动。不证明真机平台/真实 DSH/跨进程/跨实现，只证本仓纯逻辑回归（§4.9 统一清单）。
- **F-DAEMON-ENGINE-TEST-WAKE-MENTION** `test/engine/wake/mention-intents.test.ts`（378 行）— 覆盖：mention 意图端到端（S1 物化溯源）、明报拒收、同 eventId 恒只物化一次、PATROL note（SLA 扫描器盲区 + 频道内容注入净化）、消费门（schedule 零回归 + escalate 槽位）。缺口：真实 YouTrack mention 事件形态未证。
- **F-DAEMON-ENGINE-TEST-WAKE-RELAY-RESUME** `test/engine/wake/relay-resume-intents.test.ts`（549 行）— 覆盖：两 payload 契约件、`resolveResumePlan` 三不可续面+可续面（F1-15）、relay 源（收割完成信号→relay 意图，誓作用域防抖）、resume 源、wire 三件套接线、relay 零物化重估、resume 断点续跑端到端、两降级面（不可解析/不支持续跑）、`onWorkComplete` 两面都报。缺口：真实 executor `session_resume` 能力仅经 fake 声明。
- **F-DAEMON-ENGINE-TEST-WAKE-WEBHOOK-DATACHANGE** `test/engine/wake/webhook-datachange-intents.test.ts`（542 行）— 覆盖：三 payload 契约件+指纹、webhook 端到端（只落单不派工）、明报拒收+注入净化（外部事件按不可信输入）、data-change 联动单+路由指派、明报拒收 fail-closed、消费门四行混排互不干扰。缺口：真实外部 webhook 重放/乱序未证。

---

### 4.10 五个跨域接缝件（`S-ENGINE-*`，不占 F-ID）

> **范围声明**：这五个件**不在** `apps/daemon/src/engine/**` 内（分别在 `contract/`、`core/`、`assembly/`），按 §0.3 本卷只给「引擎依赖它的那一面」的完整契约与边界，**不接管其归属实现单**、不复制 76/77 字段表；其 F-ID 由 01/02/17 卷落定（本卷不占号，U81-18）。五件状态一律 **目标-新增**：仓内逐个实测**均不存在**。

#### 4.10.1 S-ENGINE-CONTRACT-INTENT · `packages/contract/src/ports/intent.ts`

- **现状**：文件不存在；`packages/contract/src/ports/` 现有 `kernel.ts`/`notifier.ts`/`invoke.ts` 等，无 `intent.ts`。依据 80-§6.6（`TS-PORT-API-01 IntentSubmissionPort`、`TS-PORT-WORK-01 WorkIntake`）。
- **归属**：01 卷（意图分类学与对外契约）；80-§6.6 是唯一形状源。引擎侧**只 `import type`**，不实现、不扩字段。
- **类型全集（本文件必须定义，缺一即契约不全）**：

| 类型 | 形状/值域 | 冻结要点 |
|---|---|---|
| `IntentSource` | `string`：真实 `InvokeSource` 名 ∪ `external.allowedSources` 里的外部来源名 | 外部 HTTP 固定 `'external-api'`；它**不是** `InvokeSource`（无 `start/stop`，只收不产） |
| `IntentKind` | `InvokeIntent['kind']`，八值 `ticket\|mention\|schedule\|relay\|resume\|webhook\|escalate\|data-change` | 不得加第九值；`explore/task/intel` 不在此 |
| `RequestKind` | `'request'\|'explore'\|'task'\|'intel'` | **只进 payload**，不是 source/kind |
| `WebhookIntentPayload` | `{ source:'external-api'; kind:'webhook'; requestKind; dedupKey; company; ticket?; subjectRef?; requestedAt; body: unknown; correlation? }` | `dedupKey` 必填、服务器不代生成；`body` 原样不解释 |
| `IntentKey` | `{ company; source; kind; ticket?; dedupKey }` | 唯一键取 `(company, source, kind, ticket ?? dedupKey)`，与 `core/src/decide.ts:319-322` 逐位一致 |
| `IntentReceipt` | `{ receiptId; intentKey; intentRef; bodyDigest; receivedAt; expiresAt; status:'queued'\|'decided'\|'unknown'; outcome?; referredTo?; decidedAt?; intakeRecordRef?; unknownRef?; gap?: readonly string[] }` | `receiptId` **非 qid**；`intentRef=REC-WORK-01.recordId`；同键多条取 `receivedAt` **最大**；`gap` 两值 `unknown-link-missing`/`intake-link-missing`；**无 `attempts` 字段** |
| `IntentSubmitResult` | `{ receipt: IntentReceipt; duplicate: boolean }` | `duplicate=true` 只表示同键同摘要重投，**不代表受理结论** |
| `IntakeOutcome` | `{ outcome:'accepted'\|'accepted_with_conditions'\|'deferred'\|'rejected'\|'forwarded'; recordId; conditions?; referredTo?; decidedAt }` | 字段名统一 `outcome`；旧写法 `conclusion`/`conditionally_accepted`/`pending` 全部作废；`forwarded` 必带 `referredTo` |
| `ReferralTarget` | `{ positionRef: Qid; deadline; notifiedAt }` | `positionRef.kind` 只 `position`\|`governance-position` |
| `IntentSubmissionPort` | `submit(intent: WebhookIntentPayload): Promise<Result<IntentSubmitResult, ClassifiedError>>`；`receipt(key: IntentKey): Promise<IntentReceipt \| undefined>` | `undefined` = 未登记，**不是**拒绝 |
| `WorkIntakePort` | `reserve(intent): Promise<Result<{intentRef; bodyDigest; receivedAt; duplicate}, ClassifiedError>>`；`intake(intent): Promise<IntakeOutcome>` | 引擎只消费 `intake`（`Pick<WorkIntakePort,'intake'>`） |

- **状态推导（不得当独立事实写）**：`status` 由「有没有 `REC-WORK-01`/`REC-WORK-02`/`REC-EVT-03`」推出；`queued` **永不过期**（不退出判重）；`decided` 过期可另立新回执并 `lineage.supersedes`；`unknown` 须对账后才可过期或重放；带 `gap:'unknown-link-missing'` 的**不重放**。
- **提交结果 ≠ 受理结论（分轴）**：`IntentSubmitResult` 只描述重投（`duplicate`）；`status` 只有三态 `queued|decided|unknown`；`outcome` 只有五值 `accepted|accepted_with_conditions|deferred|rejected|forwarded`。**不存在 `submitState`**，**不得**用 `accepted` 表示「提交成功」。
- **错误面（引擎侧会遇到的四种）**：`ClassifiedError` 双轴——`failure` 是**处置轴**（77 的 14 类）、`category` 是**观测轴**（11 值）；端口/调用点只写 `failure`（+`subcause`），`category` 由构造器按缺省映射填。**不得**把 `category` 当 `failure` 写（如把 `EXTERNAL_REJECT` 填进 `failure`），也不得两轴互借。

| 场景 | `failure` | `category` | `subcause` |
|---|---|---|---|
| 来源不在 `allowedSources` | `rejected_forbidden` | `EXTERNAL_REJECT` | `source-not-allowed` |
| payload 缺字段/类型错 | `rejected_precondition` | `CONFIG_INVALID` | `payload-malformed` |
| 同键不同摘要 | `rejected_idempotency` | `EXTERNAL_REJECT` | `idempotency-key-conflict` |
| 台账不可用/写失败 | `unavailable` | `STALL` | `ledger-unavailable` |

- **事务与写权限**：`reserve` 在**一个 daemon 写事务**里「查重 + 追加 `REC-WORK-01`」；`intake` 写 `REC-WORK-02`；两者是这两条记录的唯一写口。`IntentIngress` **不得**代写、不得另开写口。
- **引擎侧用法**：引擎只 `import type`（`IntentKey`/`IntentReceipt`/`IntakeOutcome`），并只经 `EngineDeps.workIntake?.intake` 调一次；**不 load 本文件、不持 receipt 存储**。
- **测试归属**：本文件的契约测试归 01 卷（不在 `test/engine/`）；引擎侧只由 §4.11 的 `intents/intake-receipt.test.ts` 覆盖「回执投影与受理落账」这一面。
- **不证明**：类型存在不证明 `REC-WORK-*` 已落、不证明 HTTP 面已接、不证明 77 的受理语义已被实现。

#### 4.10.2 S-ENGINE-CONTRACT-SECRET · `packages/contract/src/ports/secret.ts`

- **现状**：文件不存在；现状秘密经 env 直读 + `hrKnownSecrets` 字面量（`assembly/serve.ts:913`/`:1143`、`hrsync/assemble.ts:38`），无 catalog、无 `use` 校验、无轮换路径（80-§11.2.1/U80-18）。
- **归属**：80-§11.2.1 是唯一形状源；与 78 的部署侧 `SecretCatalog` **同字段名同值域**，`secretId` 一一对应同名。
- **类型全集**：

| 类型 | 值域/字段 | 冻结要点 |
|---|---|---|
| `SecretKind` | `'password'\|'token'\|'hmac'\|'shared-secret'\|'api-key'` | 五值封闭 |
| `SecretUse` | `'platform-auth'\|'gateway-sign'\|'matrix-register'\|'matrix-notify'\|'broker-issue'\|'outbound-redaction'` | 六值封闭；`outbound-redaction` 只进 known set 脱敏，**不作调用凭据** |
| `SubjectScope` | `{ deploymentRefs: readonly string[]; positionFamilies?: readonly string[]; capabilityRefs?: readonly string[] }` | 结构化，不用字符串；族名用 78-§6.2、能力用 76-§3.18 的 `DEF-CAP-*` |
| `ValueProvider` | `env-ref{name}` \| `file-ref{secretId}` \| `broker-ref{secretId,profile?}` \| `local-mint{ticketId}` | 判别联合；**不含值、不含路径**；`local-mint` 仅 per-ticket wkey 例外 |
| `SecretCatalogEntry` | `{ secretId; kind; subjectScope; allowedUses; valueProvider; rotationRef; revocationRef }` | `secretId=SEC-<域>-<slug>`；轮换不换 ID |
| `SecretMaterial` | `{ secretId; version; value: string \| Uint8Array; fetchedAt; expiresAt? }` | **只活受控内存**；`version` 是不透明内容代次（非 SemVer、非值哈希） |
| `SecretProvider` | `load(entry, use): Promise<Result<SecretMaterial, ClassifiedError>>` | `use ∉ allowedUses` ⇒ `rejected_forbidden`（不回退到“最接近”的用途）；取不到 `unavailable`；条目撤销/版本不符 `rejected_version`；缺字段 `rejected_precondition` |
| `KnownSecretSet` | `{ secretIds; state:'complete'\|'known-set-empty'\|'known-set-partial'; missingSecretIds; redact(text); find(text) }` | 装配期由 `SecretMaterial[]` 生成，运行期只读；只暴露 id 不暴露值 |

- **派生 ID 与例外**：`SEC-YT-TOKEN`/`SEC-YT-PASSWORD`/`SEC-MX-BOT-PASSWORD`/`SEC-MX-HR-SHARED`/`SEC-GW-SIGNING`；per-ticket wkey 派生 `SEC-WKEY-<ticketId>`，是 `local-mint` 的**唯一例外**，不进 catalog、活跃期才进 known set、`CLOSE` 即移除。
- **两个 Matrix 秘密不得互换（80-§11.2.1/U80-18）**：登录只接受 `SEC-MX-BOT-PASSWORD`（`use:'platform-auth'`、`kind:'password'`）；建号只接受 `SEC-MX-HR-SHARED`（`use:'matrix-register'`、`kind:'shared-secret'`）——**不得用 bot 密码建 HR 账号**，同一 `secretId` 换 `use` 即 `rejected_forbidden`（不是“同义别名”）；仅建号能力开启时才 `load` `registration`，建号开启而该项缺失/空值 ⇒ 拒启动该能力，不降级为“只登录”。登录在 daemon（注入 `matrixSessionFactory`），boot 侧零登录、零 token 持有。
- **脱敏**：`redact`/`find` 复用迁入 `contract` 的三个纯函数（`redactOutbound`/`findSecretShaped`/已知值集合）；`<redacted:N>` 标记与现有断言**冻结**；不新增 `'known-value'` 这类第四种 finding。
- **落点纪律**：`packages/core/src/secrets.ts` 整模块迁 `packages/contract/src/secrets.ts`；`core` 只做**具名 re-export**（三个函数），保留既有 import 路径与测试断言。
- **引擎侧用法**：引擎**不 load 秘密**、不持明文；只消费 `KnownSecretSet`（脱敏）与 wkey 生命周期（§4.2 `worker-key`）。`gatewaySecret` 永不进 worker。
- **不证明**：类型与推导不证明 78 的部署 provider 已存在、不证明轮换/吊销已接、不证明脱敏覆盖全部出站九处。

#### 4.10.3 S-ENGINE-CORE-READINESS · `packages/core/src/work-readiness.ts`

- **现状**：文件不存在（`packages/core/src/` 无 `work-readiness.ts`）；80-§6.4 `TS-PORT-WORK-03` 与 §7.2（2h）要求五门纯求值放 `core`，`decide` 只保留并发四闸 + 断路器。
- **归属**：77-§4.4.1（`REC-WORK-04` 的 13 字段）；80-§6.4。F-ID 归 02 卷，本卷只作接缝。
- **职责 / 非职责**：职责＝**纯函数**求值五门并合成三值结论。非职责＝不写 `REC-WORK-04`（写口是 `engine/work/readiness.ts`）、不读时钟/网络/文件/模型、不解析引用（引用解析在端口层）、不做风险分级（风险不进五门，归 `REC-WORK-11`）、不做并发四闸（留在 `decide`）。
- **门的机器值（五个英文，不收中文别名）**：`authority`｜`capability`｜`resource`｜`information`｜`prohibition`（权/能力/资源/信息/禁止）。
- **判决三取值（中文即 payload）**：`可开工`｜`附条件开工`｜`不可开工`。`refused` **不是第四值**：门的规则求值中止只使该门 `不可开工`，按聚合第 1 条得整单 `不可开工`，并在该门保留 `RuleOutcome` 引用。
- **五门（顺序冻结，逐门都要给结论，不得短路成布尔）**：

| # | 门（机器值） | 判据（引用解析后的事实） | 缺项的合法出口 | 不得冒充 |
|---|---|---|---|---|
| 1 | `authority` | 任务落在授权目的、范围、条件、期限内，且无累计禁配 | 申请、转呈、拒绝 | 能力不能补权 |
| 2 | `capability` | 资格有效、**已锁执行计划（`REC-WORK-05`）**与当前探测一致、已知不能已声明 | 补认定、换能力、外援、缩范围、拒绝 | 权不能补能力 |
| 3 | `resource` | 计划锁后的 `resource_baseline`：预算/时间/注意力足以完成或支撑到下一复审点，**缺口已列出而非被当作充足** | 补充、协商变更、拒绝 | 承诺不能补资源 |
| 4 | `information` | 必需输入可得、时效内、知悉许可允许 | 请求、暂缓；严格例外下带假设开工（四条件） | 猜测不能补信息 |
| 5 | `prohibition` | 不落明确禁止；未覆盖按保留处理 | 停止、请示、拒绝 | 收益、紧急、能力具备均不解除禁止 |

- **`judgeRole` 是逐门列表（恰五门、每门一项）**：

| 门（机器值） | 该门判断角色（六值之一，可写中文） |
|---|---|
| `authority` | 授权者 / 承接者（按判据档定，逐门记录实际值） |
| `capability` | 认定位置 |
| `resource` | 资源责任者 |
| `information` | 信息持有者 |
| `prohibition` | 禁止清单所有者 |

  六值英→中一一映射（英文只作 TS 判别，**不得进 `REC-WORK-04`**）：`assignee`=承接者、`authorizer`=授权者、`qualifier`=认定位置、`resource_owner`=资源责任者、`info_holder`=信息持有者、`prohibition_owner`=禁止清单所有者。`GateResult.role` 是同一事实的逐门投影，两处逐门同值；不一致即记录不合格。**角色不替代 `judgedBy` 的具名主体**。

- **`resource_baseline` 子结构（77-§4.4.1；本卷只消费，不定义）**：`{ subject_ref, quota_ref, entries, as_of, gaps }`；`entries` 每项 `{ resource_ref, unit, limit, reserved?, consumed?, remaining? }`。
  - `limit` 三态：`finite{amount}`（小数用 `DecimalString` 承载）｜`unbounded`｜`unknown{reason?}`。**缺省＝未知，不是 0 也不是无限**；`unbounded` 只在资源定义明确声明无上限时允许。
  - `reserved`/`consumed`/`remaining` **三项全已知**才是完整条目，且须满足 `limit − reserved − consumed = remaining`（同单位同标度）；不成立即基线不合格，不得就近取整或只补一项。
  - `finite` 而缺 `reserved`/`consumed` ⇒ `gaps` 必给 `reservation-record-missing`／`unreconciled-actual`，该条目**无 `remaining`**，资源门**不得**判 `可开工`（缺项不得补 0、不得自行推算）。
  - `gaps` 四型：`quota-unreadable`｜`over-reserved`｜`unreconciled-actual`｜`reservation-record-missing`；**`entries` 为空或 `gaps` 非空时，资源门不得仅据此判 `可开工`**（至少 `附条件开工`）；空 `entries` **不得**读成「资源充足」。
  - 本字段是**只读派生物**：预留事实在 `REC-WORK-05.resource_reservations`（计划锁写）、实际在 `REC-EVD-01/05`、释放在 `REC-EVD-06`；本字段不得当事实源、不得反向覆盖。

- **顺序（80-§6.4/§7.2）**：合同 → 计划锁（写预留）→ 五门（读 `baseline`）→ 出工段。`planRef` 指向**已锁**计划，**不得成环**；无计划记录时 `limit/remaining=unknown` + `reservation-record-missing`，**不得**判充足。

- **纯函数签名（core 内部；引用解析在调用方）**：

```ts
type ReadinessGate = 'authority' | 'capability' | 'resource' | 'information' | 'prohibition'
type ReadinessVerdict = '可开工' | '附条件开工' | '不可开工'

interface ReadinessConditionDraft { condition: string; ownerRef: string; dueAt: Timestamp; onMiss: 'pause' | 'forward' | 'reject' }
interface GateFinding {
  gate: ReadinessGate
  verdict: ReadinessVerdict
  reasons: readonly string[]                       // 机器码 + 人读理由，按门内顺序
  conditions: readonly ReadinessConditionDraft[]
  ruleOutcomeRef?: string                          // refused 时保留 RuleOutcome 引用
}
interface WorkReadinessResult {
  verdict: ReadinessVerdict
  gates: readonly [GateFinding, GateFinding, GateFinding, GateFinding, GateFinding]   // 五门固定顺序
  conditions: readonly ReadinessConditionDraft[]    // 附条件开工时非空
  diagnostics: readonly string[]
  resourceGaps: readonly string[]                   // 透传 baseline.gaps（缺口是事实，不是错误）
}
function evaluateWorkReadiness(input: ResolvedReadinessInput): WorkReadinessResult
```

`ResolvedReadinessInput` 是**已解析的事实**（判据档 `ProfileRef`、依据记录、具名判断者与逐门权源都由端口沿引用取好后传入），**不含自报结论**；解析失败在端口层即 `Err`，不进本函数。精确形状归 02 卷，本卷只用它约束「核心只吃事实」。`ReadinessRequest`（带版本的引用）与 `RecReadinessJudgment`（13 字段）的形状见 80-§6.4 与 §4.12 `F-DAEMON-ENGINE-WORK-READINESS`。

- **聚合规则（冻结）**：① 任一 `不可开工` ⇒ 整单 `不可开工`（硬门，不得被其他门的 `可开工`/`附条件开工` 冲销；禁止清单命中时**必须**在 `diagnostics` 明示「不可豁免」）；② 否则任一 `附条件开工` ⇒ 整单 `附条件开工`，且该门条件写入 `conditions`（条件/责任者/到期处置缺一即记录不合格）；③ 全 `可开工` ⇒ `可开工`。**不得**出现「三门 `不可开工` 而整单 `可开工`」这类自相矛盾。
- **纪律**：零 IO、零时钟、零随机、零网络；`as_of`/`decidedAt` 一律由调用方传入；输入不齐由**调用方**在进入前判 `Err(rejected_precondition/CONFIG_INVALID)`，本函数不抛异常、不返 `Result`。
- **测试归属**：`packages/core` 的自测（02 卷）；`test/engine/work/readiness.test.ts` 只测引擎侧装配与记录形状（§4.11 `TEST-WORK-READINESS`）。
- **不证明**：纯函数绿不证明 77 的判决口径已被产品接受，也不证明 `REC-WORK-04` 已落；五门判据的业务调优不在本卷。

#### 4.10.4 S-ENGINE-ASSEMBLY-INGRESS · `apps/daemon/src/assembly/intent/{ingress,receipt-store}.ts`

- **现状**：两文件均不存在（`apps/daemon/src/assembly/` 无 `intent/` 目录）。
- **归属**：80-§6.6 `TS-PORT-API-01` 的 daemon 侧实现、80-§3.6 第 6 步装配顺序；F-ID 归 17 卷（`F-daemon-intent-ingress`、`F-daemon-intent-receipt-store`）。
- **`receipt-store.ts` 完整契约（按 80-§6.6 冻结；**本卷只作接缝，不实现、不另立实现单**——实现归 17 卷）**：

```ts
export interface IntentReceiptStore {
  refresh(key: IntentKey): Promise<Result<IntentReceipt | undefined, ClassifiedError>>  // 读记录现算 → 写表投影 + 更新内存快照
  get(key: IntentKey): Promise<IntentReceipt | undefined>                                // 只读本进程已提交的内存快照
  rebuild(): Promise<Result<TableProjectionResult, ClassifiedError>>                     // 启动期全量重建表 + 用同一结果重建快照
}
export function createIntentReceiptStore(deps: { ledger: Ledger; clock?: BuildRuntimeOpts['clock'] }): IntentReceiptStore

type TableProjectionResult = { kind: 'table'; name: TableProjectionName; rows: number; cursor: string | null }
```

  - **表与返回形状**：表 `intent_receipts`；唯一键 `(company, source, kind, ticket ?? dedupKey)`；`ProjectionName` 含 `intentReceipts`（§5.1）；`rebuild` 返回 `TableProjectionResult{kind:'table', name:'intentReceipts', rows, cursor:null}`（表投影无游标，`cursor` 恒 `null`）。
  - **`refresh(key)` 是唯一修复入口**：读 `REC-WORK-01`/`REC-WORK-02`/`REC-EVT-03` 与缺口记录 `REC-OBS-02`，按当前行现算回执，**写表投影并更新内存快照**；幂等、只增不改。显式用途三处：`submit` 的重投判定、去重窗过后的 `decided` 复查、对账补链后的投影修复。
  - **`get(key)` 只读已提交的内存快照**（`ReadonlyMap` 视图）：不查 SQLite、不读权威记录、不失败、不修复，**不得**用于入队/重放/任何受理决策——只服务展示与对账读面。
  - **`rebuild()` 的时机是硬约束**：启动序 `schema 闸 → receipts.rebuild() → replayQueued() → 才装配 API`（80-§6.6 规则 9）；`rebuild` 失败即**整体拒启动**（`CONFIG_INVALID`/`unavailable` 上抛），**不得**带空投影起服。
  - **`decided` 不可能被读成 `queued`（规则 7，机制而非自律）**：追加 `REC-WORK-01`/`REC-WORK-02`/`REC-EVT-03` 的**同一事务**内，由 **store 自有的 projection hook** 同步写表投影；`WorkIntake` **不写**投影；事务 commit 返回后，同一微任务、无 `await` 更新内存快照。长 IO 一律在事务外。
  - **`refresh` 与 `get` 不可互换（规则 8）**：前者可失败、可修复、读台账；后者不失败、不修复、只读快照。任何把 `get` 当判据的写法＝判负。若放弃「同事务投影 hook」方案，须给出「`decided` 不会被读成 `queued`」的同等证明 + 四点崩溃注入证据（规则 10），否则不得改。
  - **不提供** `upsert(receipt)`/`queued(company)`/`mark*` 之类自造写口（80-§6.6 明令）。
  - 判据三行写死：`queued` = 有 `REC-WORK-01`、无 `REC-WORK-02`、无 `REC-EVT-03`；`decided` = 有 `REC-WORK-02`；`unknown` = 有 `REC-EVT-03` 且其 `unknown_scope.intentRef` 指向本条 `REC-WORK-01.recordId`。**不得有第四态**；重建不完整时写 `gap`，**不**降级 `status`。
  - 字段纪律：`receiptId` 非 qid；无 `attempts`；`expiresAt` 是导出值（`receivedAt + ttlMs`，不落盘）；同键多条取 `receivedAt` 最大。
  - **不持写权**：本件不写任何 `REC-*`（只写自己的投影表）；引擎不持本接口，装配体/API 拿不到可写 `ledger`。

- **`ingress.ts` 完整契约**：

```ts
export interface IntentIngressDeps {
  intake: WorkIntakePort                                  // REC-WORK-01 唯一写口（80 记作 WorkIntake，TS-PORT-WORK-01）
  engine: { ingest(intents: readonly InvokeIntent[]): void }   // 只给入队函数，不给引擎本体
  receipts: IntentReceiptStore
  allowedSources: readonly string[]                       // 已过 §3.3 形状校验；缺省 ['external-api']
  ttlMs: number                                           // 去重窗（= external.idempotencyTtlMs）
  isCompanyMounted(company: CompanySlug): boolean         // 只回答布尔，不交挂载表
  bodyLimitBytes?: number                                 // 缺省 100_000（代码缺省，非 YAML 键）
  log: NonNullable<BuildRuntimeOpts['log']>                // 与 buildServeRuntime 同一日志面
}
export interface IntentIngressInternal extends IntentSubmissionPort {
  replayQueued(): Promise<Result<number, ClassifiedError>>   // 启动末一次；只归 buildServeRuntime 持有
}
export function createIntentIngress(deps: IntentIngressDeps): IntentIngressInternal
```

  - **不设别名**：无 `workIntake`/`ledger`/`now` 等替代键——台账只进 `receipts`，时间只从注入时钟取（`receivedAt` 由 `reserve` 给，TTL 是纯算术）。
  - **`replayQueued` 不外泄**：API 与装配体只取 `Pick<IntentIngress,'submit'|'receipt'>`（等价 `Pick<IntentSubmissionPort,'submit'|'receipt'>`），编译期拿不到 `replayQueued`/`ingest`；**不得**用 `as` 或 `Record<string, unknown>` 绕过。
  - `bodyLimitBytes` 缺省 **100_000**（**代码缺省，非 YAML 键**；沿用 `panel/src/external/server.ts:100` 的 `MAX_REQUEST_BODY_BYTES`）；超限 ⇒ `rejected_precondition`/`CONFIG_INVALID`/`body-too-large`（HTTP 413，§4.10.5）。
  - `allowedSources` 显式空数组**不得**流入本件：配置校验期即 `CONFIG_INVALID` 拒启动（**已裁**，§4.10.5）。

- **`submit` 顺序（冻结，错序即判负）**：
  1. **校验**：`source ∈ allowedSources`（否则 `Err(rejected_forbidden/EXTERNAL_REJECT/source-not-allowed)`）→ `kind === 'webhook'` → `requestKind ∈ {request,explore,task,intel}` → `dedupKey` 非空 → `company` 已挂载（`isCompanyMounted`）→ `body` 字节 ≤ `bodyLimitBytes`（超限 `rejected_precondition`/`CONFIG_INVALID`/`body-too-large`）。结构/类型错 ⇒ `Err(rejected_precondition/CONFIG_INVALID/payload-malformed)`；任一不过**不落记录**。
  2. **读现态（判据唯一来源）**：`const cur = await receipts.refresh(key)`，`key = (company, source, kind, ticket ?? dedupKey)`。`refresh` 按 `REC-WORK-01`/`REC-WORK-02`/`REC-EVT-03` 现算并回写投影与快照；返回 `undefined` ＝无行。**`receipts.get` 只读内存快照，不得用于本条决策**（§4.10.4 规则 8）。`Err` ⇒ 原样上抛，**不**按「无行」处理、不伪造态。
  3. **按四态表分支**（下表）。新建行时：`intake.reserve(intent)` 在同一写事务内查重 + 追加 `REC-WORK-01`，**store 自有的 projection hook 在同一事务**写 `queued` 投影行，commit 后同一微任务、无 `await` 更新快照；`intentRef` 在 `reserve` 返回时已定。同键不同摘要 ⇒ `Err(rejected_idempotency/EXTERNAL_REJECT/body-mismatch)`（窗内）／窗已过按表另立。
  4. **`engine.ingest([invokeIntent])`**：**仅**「新建」或「同键同摘要且现态 `queued`」才调用；`void`、仅入内存队列；不产记录、不返错误。
  5. **返回 `IntentSubmitResult`**：`duplicate` 透传。**拒绝只在一侧表达**：要么 `Err`，要么 `Ok`（`duplicate` 只描述重投）。

- **写序不可倒置**：`refresh` 读的是**已提交记录**的现算结果；`reserve` 之后的投影行由 store 的 hook 自己写。ingress **在任何路径下都不写投影**，也不靠再调一次 `refresh` 去「补写」；`refresh` 只在需要按权威记录重算时显式调用（对账补链后修复、窗过 `decided` 复查）。

- **四态重投（判据表；不得合并、不得新增第五态）**：

| 现态（同键） | 摘要 | 结果 |
|---|---|---|
| 无投影行 | — | `reserve` 追加 `REC-WORK-01`（store hook **同事务**写 `queued` 行）→ `ingest`；202，`duplicate:false` |
| `queued` | 同 | **重入队** `ingest`（不新建记录）；200，`duplicate:true` |
| `queued` | 不同 | 409 `rejected_idempotency`/`EXTERNAL_REJECT`/`body-mismatch`（窗内） |
| `decided` | 同 | **不入队**；200，`duplicate:true`（窗内；窗已过则见下一行另立） |
| `decided` | 不同（窗内） | 409 `rejected_idempotency`/`EXTERNAL_REJECT`/`body-mismatch` |
| `decided`（窗已过） | 同/不同 | 另立 `REC-WORK-01` → `lineage.supersedes` 指旧 `recordId` →（hook 写新 `queued` 行）→ `ingest`；202，`duplicate:false` |
| `unknown` | 同 | **不重放**；200 且回执 `status:'unknown'`（**不伪造 202、不回 `Err`**）；先对账 |

「现态」一列的唯一判据来源是第 2 步的 `receipts.refresh`（读权威记录现算）；`receipts.get` 只读快照，**不得**在此表任何一格充当判据。`queued` **永不因 TTL 变成另立**。

- **TTL 判据**：`queued` **永不生效**（不得过期、不得另立）；`decided` 生效（可另立 + `lineage.supersedes`）；`unknown` **只在对账完成后**才生效。`expiresAt = receivedAt + ttlMs` 是导出值，不落盘。缺链（`REC-EVT-03` 缺 `unknown_scope.intentRef`）⇒ 行**保持 `unknown`** + `gap:['unknown-link-missing']`，**不降 `queued`**、不自动重放、不另立。

- **禁止**：本件写 `REC-WORK-01`/`REC-WORK-02`；写投影（含任何 `upsert`/`queued(company)`/`mark*` 形态）；把 `receipts.get` 当判据；把 `engine` 传出去；把 `ingest` 当受理（受理结论只由 `REC-WORK-02` 决定）；返回对象多挂 `ingest`/`replay`/`reserve`。

- **启动序（冻结）**：`schema 闸 → receipts.rebuild() → replayQueued() → 才装配 API`；`rebuild` 失败即整体拒启动（`CONFIG_INVALID`/`unavailable` 上抛），**不得**带空投影起服。

- **`replayQueued`**：启动序第 3 步由 `buildServeRuntime` 调一次；扫 `status:'queued'` 的记录（等价「有 `REC-WORK-01`、无 `REC-WORK-02`」）逐条重入 `engine.ingest`，返回重放条数（`Result<number,…>`）；`gap` 含 `'unknown-link-missing'` 的**不在重放集**；`unknown` **不重放**（先对账）。重放不写新记录、不改 `receivedAt`、不增 `attempts`（该字段已删除）。

- **崩溃窗口**：`reserve` 已提交、`ingest` 未执行即崩溃 ⇒ 重启由 `replayQueued` 补入队（记录不重写）；`ingest` 后、`intake` 前崩溃 ⇒ 回执停 `queued`，靠重启重放 + 相位 2 补 `REC-WORK-02`，**不得**伪造 `decided`。

- **不证明**：进程内实现不证明跨进程幂等（两次 daemon 同时 `reserve` 同键）；不证明 HTTP 面（那是 §4.10.5）；不证明 77 的受理语义。

- **提交结果 ≠ 受理结论（判负线）**：`status` 只有三态 `queued|decided|unknown`，`outcome` 只有五值 `accepted|accepted_with_conditions|deferred|rejected|forwarded`；**不得有 `submitState`**，**不得用 `accepted` 表示「提交成功」**——`accepted` 是 77 的受理结论，只由 `REC-WORK-02` 的 `IntakeOutcome` 产生。`RefusalTarget` 等 77 侧类型不受本条影响。

#### 4.10.5 S-ENGINE-ASSEMBLY-API · `apps/daemon/src/assembly/api/assemble.ts`

- **现状**：文件不存在；80-§3.6/§9.4 已定形状。
- **归属**：17 卷（装配体，`F-daemon-api-assemble`）与 `packages/api`（Hono 服务）；本卷只给「引擎不被他持有」的接缝。
- **签名（冻结）**：

```ts
export interface AssembleApiDeps {
  ingress: Pick<IntentIngress, 'submit' | 'receipt'>   // 只这两面；不收 Engine
  ledgerPath: string
  company: string
  config: ExternalApiConfig
}
export interface ExternalApiConfig {
  enabled: boolean
  port: number
  lan: boolean
  token: string                    // 非空；缺 ⇒ configInvalid
  requestsPerMinute: number
  idempotencyTtlMs: number
  allowedSources: readonly string[]  // 缺省恰 ['external-api']
}
export function assembleApi(deps: AssembleApiDeps): ApiServerOptions
```

- **行为**：
  - `emitIntent` 原样转发 `ingress.submit`；`getIntentReceipt` 原样转发 `ingress.receipt`（**不改写** `status`/`outcome`/`gap`）。
  - 装配体自建 HTTP 适配（`packages/api`）、company 投影、只读台账：`openLedgerReadonly({ path: deps.ledgerPath, expectedSchemaVersion, readOnly: true, queryOnly: true })`。
  - `external.allowedSources` 缺省恰 `['external-api']`，**不读** `SourceRegistry`；**显式空数组 = `CONFIG_INVALID` 拒启动**（已裁，U81-17 关闭）。
  - `now` 只在 `BuildRuntimeOpts`（测试注入），本函数不收 `now`。
  - `enabled=false` ⇒ **零行为**：不监听端口（返回未启动的 options），**不读不校验** `external.*`（含 `allowedSources`/`token`/`port`），不得“起了但不接客”，也不得因未使用的键而拒启。
- **启动校验（`enabled=true` 时任一不满足即 `configInvalid` 整机拒启）**：`ingress` 缺、`submit`/`receipt` 非函数、`ledgerPath` 缺、只读台账打不开（`db-missing` ⇒ `Err(unavailable/STALL/db-missing)`）、schema 旧/新（`rejected_version/EVOLVE_REJECT/schema-behind`｜`schema-ahead`）、`token` 空、`allowedSources` 含未知来源**或为空数组**。
- **只读台账纪律**：**不跑 DDL**、**不写 PRAGMA**（`query_only` 除外）；查询结果 `RecordPage = { items, nextCursor }`；只读连接不得被复用为写连接。
- **禁止**：`assembleApi` 收 `engine`、直调 `ingest`、把 `IntentIngressInternal.replayQueued` 暴露给 HTTP 面（HTTP/装配体侧类型只有 `Pick<IntentIngress,'submit'|'receipt'>`）。
- **路由计数口径（80-§9.4，本卷只引用不复制）**：`:8788` 共 **16 条**路由——10 条读面（含 `GET /v1/requests/status` 与必须 `501` 的 `/v1/events`）+ 4 条触发 + `/v1/subscriptions` + `GET /`；**旧稿「15 条」作废**（漏了回执查询），不得再写 12/13/15，也不得把 MCP 工具目录算进这 16 条。M4 验证项按 80-§9.4 **11 项**（第 11 项＝`GET /v1/requests/status` 的正反用例）；本卷不复制清单。
- **测试归属**：17 卷（装配体测试，如 `test/assembly/api-*.test.ts`）；本卷不在 `test/engine/` 新增。
- **不证明**：装配不证明 HTTP 路由已注册（归 `packages/api`）、不证明 token 鉴权强度、不证明只读台账在真实并发写下的稳定性（V4 归 82）。

---

### 4.11 目标测试件（39 个，目标-新增）

**计数**：`test/engine/**` 现有 60 个 `*.test.ts` + 1 夹具（`crash-points.ts`）；目标 **99 个测试 + 1 夹具 = 100 件**。新增 **39 个**全部落**子域目录**（`test/engine/` 直下已 25 件顶格＝24 测试 + 夹具），与 §4.12 的 39 个目标源件 **1:1** 对应（12 个职责拆分件 + 27 个端口实现件；`tick/types.ts` 是纯类型，无独立运行时测试，由同域测试间接编译）。新增测试子域 **12 个**（`tick/`、`dispatch/`、`breaker/`、`harvest/`、`intents/`、`decision/`、`work/`、`obligations/`、`lifecycle/`、`memory/`、`observe/`、`tools/`——现有 16 个子域名里**没有这 12 个**；`harvest/`、`intents/` 两域现有覆盖分散在直下 e2e、`wake/`、`notify/` 与 `test/assembly/inflight-takeover.test.ts`）⇒ 测试子域 16 → 28。复算：`find apps/daemon/test/engine -name '*.test.ts' | wc -l`（现 60 → 目标 99）、`find apps/daemon/test/engine -mindepth 1 -maxdepth 1 -type d | wc -l`（现 16 → 目标 28）。每件目标 ≤400 行、逐目录 ≤25 件。

**R/E/W/V 缩写**（沿用 81-§四 与 68-§3.3/77-§12.4 的既有编号，不新造）：**R** = 77 的记录/运行条款；**E** = 68-§3.3 的 `E01–E12` 反例；**W** = `W01–W12` 反向要求；**V** = 77-§12.4 的验证层级 `V0`（静态）/`V2`（行为契约）/`V4`（故障/恢复）/`V5`（真机，本轮不执行）。

- **F-DAEMON-ENGINE-TEST-TICK-STATE** `test/engine/tick/state.test.ts`（目标）— 覆盖：状态容器（在途表/泳道簿/断路口/序号/意图队列）的读写小函数：登记→注销幂等、序号单调、意图队列 FIFO 与 `pendingIntents` 计数、断路口计击/复位。夹具：纯内存，无 fake、无台账。R/E/W/V：W07（动作充数——断言的是状态迁移不是调用次数）；V2。**不证明**：真实并发（单线程假设）、崩溃后状态（状态只在内存，恢复归接管件）。

- **F-DAEMON-ENGINE-TEST-TICK-PHASES** `test/engine/tick/phases.test.ts`（目标）— 覆盖：七相位序列的**顺序与短路**：每相位被调一次且顺序固定；某相位抛错时的收口（记 `errors`、继续后续相位还是中止，按现状语义钉住）；空世界每相位仍产生可解释的空结论。夹具：`createFakePlatform` + `createFakeAdapter` + 相位桩（记录调用序）。R/E/W/V：W06（静默恢复）/W10（只报有利证据）；V2。**不证明**：真实七相位的业务正确性（各域件自证）、真实平台下相位耗时。

- **F-DAEMON-ENGINE-TEST-TICK-REPORT** `test/engine/tick/report.test.ts`（目标）— 覆盖：`TickReport` 组装与 **`errors` 归一为 `ClassifiedError[]`**（目标态）：23 处来源逐类映射、`warnings`/note 不混入 `errors`、`events` 计数口径（`appended` 才计）、序列化稳定（字段顺序无关、布尔不缺省）。夹具：构造好的 `GateFinding`/`ClassifiedError` 样本 + 空拍/满拍。R/E/W/V：W04（未分类按低档）/W10；V0+V2。**不证明**：分类是否正确（映射表是目标，未实现时本测试不存在）、跨版本兼容。

- **F-DAEMON-ENGINE-TEST-DISPATCH-EXECUTE** `test/engine/dispatch/execute.test.ts`（目标）— 覆盖：`executeDispatch` 全序（读档位→组任务书→预算闸→签 wkey→开房间→launch→登记在途）；预算拒＝**不签发不 launch 不登记**；launch 失败＝在途不登记且预留在账（失败保留）；`instructionsPath` 只在 bridge 通道出现。夹具：fake adapter（`onLaunch` 断言调用序）+ fake 平台 + 真台账。R/E/W/V：R（`RUN-WORK-06`）、W02（以新任务顶失败）、W04；V2。**不证明**：真实 DSH 启动、真实 wkey 服务、真实房间。

- **F-DAEMON-ENGINE-TEST-DISPATCH-BRIEF** `test/engine/dispatch/brief.test.ts`（目标）— 覆盖：任务书拼装（正文字符量、续跑版前情、合并指令块不串入普通派发）；`instructionsPath` 决策（bridge vs native）；凭据段只放 env 键名不放值。夹具：固定 `TaskBrief` 输入 + 金样文本。R/E/W/V：W10、W12（结清不结承诺——任务书不得写“已完成”）；V0+V2。**不证明**：提示词实际效果、L0–L5 预算（归 `packages/prompt`）。

- **F-DAEMON-ENGINE-TEST-HARVEST-ONE** `test/engine/harvest/one.test.ts`（目标）— 覆盖：单在途工位一次收割判定：四要件逐项缺一即失败且 `note` 指明缺哪件；`streamDone` 才允许走判定体；同拍派发单不收割（`dispatchedAtSeq`）。夹具：fake adapter（`ok`/`empty_output`/`no_report`）+ 真台账。R/E/W/V：R（`RUN-EVD-01..04`）、W03（自检冒称验收）、W10；V2。**不证明**：真实产物形态、真实闸门命令。

- **F-DAEMON-ENGINE-TEST-HARVEST-STREAM** `test/engine/harvest/stream.test.ts`（目标）— 覆盖：跨拍增量泵（一封流只开一次、`next` 驻留不丢事件）、`foldHarvestEvent` 四要件折叠、流异常吞并记 `streamError` 并在下一拍收口。夹具：受控 `AsyncIterator`（手动 resolve/reject）+ 时钟桩。R/E/W/V：W06（静默恢复——异常必须可见）、W10；V2+V4 局部。**不证明**：真实 dsh 流的时序与背压。

- **F-DAEMON-ENGINE-TEST-HARVEST-FINALIZE** `test/engine/harvest/finalize.test.ts`（目标）— 覆盖：四要件全绿的收口：`GATE_PASS` 落账（一次）、工时结算、工位回收、在途注销；重复收口幂等；结算失败与收口失败的分支不互相掩盖。夹具：fake adapter + 真台账 + fake 平台。R/E/W/V：R（`RUN-WORK-06`/`RUN-EVD-04`）、W03、W12；V2+V4 局部。**不证明**：真实平台状态迁移、真实归档。

- **F-DAEMON-ENGINE-TEST-HARVEST-STALL** `test/engine/harvest/stall.test.ts`（目标）— 覆盖：`failHarvest` 与停滞升级：无句柄 → `GATE_FAIL`（`WORKER_DEAD`）、停滞超阈 → kill 面、升级 `ESCALATE` 恰一次、失败保留不返还预留。夹具：fake adapter `stalled` + `onKill` 钩子 + 注入时钟。R/E/W/V：W06、W10；V2+V4 局部。**不证明**：真实 SIGKILL 语义、真实限速/超时分布。

- **F-DAEMON-ENGINE-TEST-BREAKER-TRIP** `test/engine/breaker/trip.test.ts`（目标）— 覆盖：同签名连击计击、达阈跳闸、不同签名不累计、跳闸后 `ESCALATE`（note 前缀 `CIRCUIT_BREAK：`）只发一次、冷却期不重复跳。夹具：纯函数 + 注入时钟。R/E/W/V：W05（无限返工/暂停）、W06；V2。**不证明**：`CIRCUIT_BREAK` 事件缺失这一现状（U81-14 未决）。

- **F-DAEMON-ENGINE-TEST-BREAKER-PROBE** `test/engine/breaker/probe.test.ts`（目标）— 覆盖：冷却到期半开试探：试探成功→复位、试探失败→回全开续冷却、试探期间新失败不叠加、试探单数有界。夹具：注入时钟 + fake adapter（成功/失败两态）。R/E/W/V：W05、W06；V2。**不证明**：真实限流（429）时序、真实长冷却。

- **F-DAEMON-ENGINE-TEST-INTENTS-INTAKE-RECEIPT** `test/engine/intents/intake-receipt.test.ts`（目标）— 覆盖：`WorkIntake.intake` 接线后，相位 2 受理写 `REC-WORK-02` 并把 `IntakeOutcome` 的五值透传进汇报；`workIntake` 未注入＝面关（不写记录、回执停 `queued`、明报 `intake-link-missing`）；`forwarded` 必带 `referredTo`；回执投影 `status/outcome/gap` 与记录一致（不越权刷新）。夹具：fake `WorkIntakePort`（记录调用与返回）+ 真台账 + `createIntentIngress` 桩。R/E/W/V：R（`REC-WORK-01/02`）、W04、W10；V2+V4 局部（reserve 后 ingest 前崩溃的重放）。**不证明**：真实 `WorkIntake` 实现、跨进程幂等、HTTP 面。

**B 组：27 个端口实现件的测试（与 §4.12 B 组逐件 1:1；类型来自 `contract`、纯求值来自 `core`、SQL 与投影来自 `store`，本组只测 daemon 侧的编排语义）**：

- **F-DAEMON-ENGINE-TEST-DECISION-INTAKE** `test/engine/decision/command-intake.test.ts`（目标）— 覆盖 **CMD-01**：`submit(CommandDraft)` 来源未核验 ⇒ `rejected_precondition`；越权 ⇒ `rejected_authority`；幂等 `(company,source,commandKind,idempotencyKey)` 同键同摘要 `duplicate`、异摘要 `Err`；`check(commandId)` **只回读权检**（不执行、不写记录）；五条路由面（work-intake/lifecycle/settlement/authority/rejected）各一条；**不直接产生外部效果**由「fake 平台零调用」断言。夹具：fake `WorkIntake`/`FlowPlatform` + 真台账。R/W：`REC-CMD-01/02`；W04、W10。V2。**不证明**：YouTrack 侧真实命令语义、真实鉴权强度。
- **F-DAEMON-ENGINE-TEST-DECISION-DECIDE-RECORD** `test/engine/decision/decide-record.test.ts`（目标）— 覆盖 **DEC-01**：`record`/`get`；**已有专用记录类型的决定被拒收**（`rejected_precondition`，不得写成两次事实）；幂等 `(subjectRef,decisionKind,verdict,basisDigest)`；`get` 未登记返 `undefined`（不抛）。夹具：真台账。R/W：`REC-DEC-01`；W10。V2。**不证明**：裁决的业务正确性（归判读域）。
- **F-DAEMON-ENGINE-TEST-WORK-INTAKE** `test/engine/work/intake.test.ts`（目标）— 覆盖 **WORK-01**：`reserve` 在**一个写事务**内查重 + 追加不可变 `REC-WORK-01`（九字段齐）；同键同摘要 `duplicate:true` 且返回既有 `intentRef`；异摘要 `Err(rejected_idempotency)`；`intake` 写 `REC-WORK-02`，`outcome` 五值透传，**未判＝缺省**（不得塞第六值）；`forwarded` 缺 `ReferralTarget{positionRef,deadline,notifiedAt}` ⇒ 拒；`positionRef.kind` 只 `position`/`governance-position`；**本件不写投影**（spy 断言零投影写）。恢复：`reserve` 提交后进程中止，二次 `reserve` 同键不产生第二封 `REC-WORK-01`。夹具：临时真台账 + 注入时钟。R/W：`REC-WORK-01/02`；W04、W10。V2+V4 局部。**不证明**：跨进程并发同键（两 daemon 同时 `reserve`）。
- **F-DAEMON-ENGINE-TEST-WORK-CONTRACT** `test/engine/work/contract.test.ts`（目标）— 覆盖 **WORK-02**：`propose` 五要件齐；`amend(ticket,change,expectedVersion)` **CAS** 命中成立、失配 `rejected_version`；版本链**只增不改**（旧版本仍可按 ref 读）；同摘要 `propose` 幂等。恢复：CAS 冲突后重读当前版本再提交成功，**不静默改接最新**。夹具：真台账。R/W：`REC-WORK-03`；W04。V2。**不证明**：合同条文的实质公平性。
- **F-DAEMON-ENGINE-TEST-WORK-READINESS** `test/engine/work/readiness.test.ts`（目标）— 覆盖 **WORK-03**：`RecReadinessJudgment` **13 字段**逐字段断言；`gateResults` **恰五门**、`judgeRole` **恰五门**且与 `gateResults.role` 逐门同值；聚合三值（任一 `不可开工` ⇒ 整体 `不可开工`；否则任一 `附条件` ⇒ `附条件开工` 且条件入 `conditions`；全 `可开工` ⇒ `可开工`）；`refused` 只使该门/整单 `不可开工`，**不是第四值**；`resourceBaseline` 中 `finite` 而缺 `reserved`/`consumed` ⇒ `gaps` 必含 `reservation-record-missing`/`unreconciled-actual`、该 entry 无 `remaining`、**资源门不得判通过**；`limit='unknown'` 不得判充足；**风险不进五门**（传 `risk` 输入须被拒或忽略并明示）。夹具：`core/src/work-readiness.ts` 纯函数 + `baseline` 桩 + 固定 `ReadinessRequest`。R/W：`REC-WORK-04`；W04、W10。V2。**不证明**：`core` 侧求值规则的正确性（02 卷自证）。
- **F-DAEMON-ENGINE-TEST-WORK-PLAN** `test/engine/work/plan.test.ts`（目标）— 覆盖 **WORK-04**：钉六件 `VersionRef` 齐；`resource_reservations` 每项 `{resource_ref,amount,unit,period,quota_ref}` 齐；**空列表 ≠ 资源充足**（空列表必须带理由与依据，否则拒）；`lock` 幂等 `(ticket,attempt)`；变更＝新计划 + 新 attempt（旧计划不可变，`get(ticket,旧 attempt)` 仍读旧）；预留**不另起公共写口**（RES-01 无 `reserve`/`actual`/`release`）；**不静默续期**（跨 `period` 未重锁 ⇒ 明报）。恢复：`lock` 事务中断 ⇒ 计划行与预留**同现或同无**，不留半锁。夹具：真台账 + `baseline` 桩。R/W：`REC-WORK-05`；W04、W05。V2+V4 局部。**不证明**：`resource_ledger` 投影重建（归 `store`，U81-23）。
- **F-DAEMON-ENGINE-TEST-WORK-LIFECYCLE** `test/engine/work/lifecycle.test.ts`（目标）— 覆盖 **WORK-05**：`TransitionExpectation{expectedState,expectedLineageHead}` **两项皆必填**（缺一项即拒，不得只 CAS 状态）；状态由事件流**重放派生**（不信缓存）；非法边 `rejected_state`；链顶不符 `rejected_version` 且**必须重读链顶**（spy 断言再读一次；**不得**静默改接最新）。恢复：CAS 冲突后按新链顶重试成功。夹具：真台账 + 事件流构造器。R/W：`REC-WORK-09`；W05、W06。V2+V4 局部。**不证明**：真实平台状态与本地状态的一致性（归 78 的 `StateMapping`）。
- **F-DAEMON-ENGINE-TEST-WORK-EXCEPTION** `test/engine/work/exception.test.ts`（目标）— 覆盖 **WORK-06**：`raise`/`receive`/`escalate`/`close` 四段各**具名接收**且带期限；超期 ⇒ `degraded`（**不静默**、不自动关闭）；跳段（未 `receive` 直接 `close`）⇒ `rejected_state`；幂等 `(exceptionId,step)`。恢复：重启后未超期异常可续段，超期即显 `degraded`。夹具：真台账 + 注入时钟。R/W：`REC-EXC-*`；W06、W10。V2。**不证明**：真实升级通知的送达（归 matrix）。
- **F-DAEMON-ENGINE-TEST-WORK-SETTLEMENT** `test/engine/work/settlement.test.ts`（目标）— 覆盖 **WORK-07**：**八项**齐（产物/资源/证据/未决义务/承诺/相对方/责任/记忆）；异议是 `dissent` **字段**不是第九项；`settled_state` 四值；**终止路径例外**（合法终止＝`REC-WORK-09` 终态 + `REC-DEC-01` 依据，可无验收结清）；`转入清算` **未经 `REC-LIFE-02` 承接**即 `CLOSE` ⇒ `rejected_state`；产出 `REC-EVD-06`。恢复：结清写到一半中断 ⇒ 不留「半结清」态（要么全项齐、要么显式 `未结清`）。夹具：真台账 + 承接件桩。R/W：`REC-EVD-06`；W12、W06。V2+V4 局部。**不证明**：结清金额的定价正确性。
- **F-DAEMON-ENGINE-TEST-WORK-QUALIFICATION** `test/engine/work/qualification.test.ts`（目标）— 覆盖 **WORK-08**：判定者与被判者**不得同一主体**（⇒ `rejected_authority`）；**只判资格**——不解析能力、不授权、不安装（assert 无副作用）；幂等 `(subject,needRef,evidenceDigest)`；`current` 带 `term` 与 `review_and_invalidation`；过期资格不得被读成有效（⇒ `rejected_version` 或显式过期态）。夹具：真台账 + 注入时钟。R/W：`REC-WORK-08`；W10。V2。**不证明**：资格证据的真实性。
- **F-DAEMON-ENGINE-TEST-WORK-RISK** `test/engine/work/risk.test.ts`（目标）— 覆盖 **WORK-09**：分类者**不得是交付方**（⇒ `rejected_authority`）；**只增不降**（降档须独立位置 + 异议位置，缺一即拒）；幂等 `(ticket,attempt,riskInputDigest)`；产出 `REC-WORK-11`。夹具：真台账。R/W：`REC-WORK-11`；W10。V2。**不证明**：风险等级的实质判断质量。
- **F-DAEMON-ENGINE-TEST-WORK-ASSIGNMENT** `test/engine/work/assignment.test.ts`（目标）— 覆盖 **WORK-10**：`actionKind` **十一取值**穷尽（类型穷尽断言 + 非法值拒）；`carriedTerms`/`deadline`/`noResponseEffect`/`handoverChecklist` 齐；**未响应语义逐项**（不视为同意／未确认即未移交／未签不生效）；产出 `REC-WORK-10`；幂等。夹具：真台账 + 注入时钟。R/W：`REC-WORK-10`；W07、W10。V2。**不证明**：真实协作方的响应行为。
- **F-DAEMON-ENGINE-TEST-WORK-ATTENDANCE** `test/engine/work/attendance.test.ts`（目标）— 覆盖 **WORK-11**：**六面**齐（`holder`/`appointment_ref`/`rank_interface_ref`（岗位要求职级时必填，不适用须写理由）/`qualification_refs`/`plan_ref`/`authorization_ref`）+ `work_ref`/`period`/`responsibility_scope`/`consistency_check`；**六面不一致** ⇒ `rejected_precondition`；段边界＝实质能力配置变化/授权变化/交接/暂停恢复（无边界不得新开段）；**重试不重置**身份、禁配、资源累计、失败次数；幂等 `(workRef,holder,period.from)`；产出 `REC-WORK-06/07`。夹具：真台账 + 计划/资格/任命桩。R/W：`REC-WORK-06/07`；W06、W07。V2。**不证明**：真实岗位六面的组织侧正确性。
- **F-DAEMON-ENGINE-TEST-HARVEST-EVIDENCE** `test/engine/harvest/evidence.test.ts`（目标）— 覆盖 **EVD-01**：`harvest` 只**收材料不判验收**（`Ok` 只表示收口完成、材料清单已定）；四要件各缺一条目；「没找到」**不得**推断「没做」（缺材料 ⇒ `unverified`，不编造条目）；幂等 `(ticket,attempt,source)`；产出 `REC-EVD-01/02/03`；`verify(bundleId)` 只核已收口清单、不改清单。夹具：fake adapter + 真台账 + 受控工位目录。R/W：`RUN-EVD-01..03`；W03、W10。V2。**不证明**：真实产物形态与闸命令。
- **F-DAEMON-ENGINE-TEST-HARVEST-ACCEPTANCE** `test/engine/harvest/acceptance.test.ts`（目标）— 覆盖 **EVD-02**：四独立性维度（位置/风险/外部效果/价值）任一不成立 ⇒ `rejected_authority`；四结论全覆盖；**证据包只含** `REC-EVD-01/02/03`（注入 `REC-EVD-05` 必须被拒，`rejected_precondition`）；产出 `REC-EVD-04`；幂等 `(ticket,attempt,bundleId)`。夹具：真台账 + 证据包构造器。R/W：`REC-EVD-04`；W03、W10。V2。**不证明**：验收判断的实质质量。
- **F-DAEMON-ENGINE-TEST-HARVEST-VALUE** `test/engine/harvest/value.test.ts`（目标）— 覆盖 **EVD-03**：四本账（`artifactAccount`/`stateAccount`/`impactAccount`/`costAccount`）+ `externalFeedback`/`conclusion`/`uncertaintyAndDissent`；**验收之后**才可 `assess`（未验收 ⇒ `rejected_precondition`）；**不压总分**、负值单列、争议期不抵销；幂等 `(workRef,acceptanceRef,accountsDigest)`；`get` 未评返 `undefined`。夹具：真台账。R/W：`REC-EVD-05`；W03、W12。V2。**不证明**：价值口径的业务正确性。
- **F-DAEMON-ENGINE-TEST-HARVEST-REWORK** `test/engine/harvest/rework.test.ts`（目标）— 覆盖 **EVD-04**：`causeClass` 五值；**达阈值 ⇒ 强制重新受理**回 `WORK-01`（spy 断言 `reserve` 被调，**不是**原地重派）；`threshold` 只读；未达阈值不重受理；产出 `REC-EVD-07`；幂等 `(workRef,triggeredBy,causeClass,count)`。夹具：真台账 + `WorkIntake` 桩。R/W：`REC-EVD-07`；W05、W07。V2。**不证明**：返工阈值的业务标定。
- **F-DAEMON-ENGINE-TEST-HARVEST-REOPEN** `test/engine/harvest/reopen.test.ts`（目标）— 覆盖 **EVD-05**：新证据标准**事前设定**（事后改标准 ⇒ `rejected_precondition`）；申请方**不得是原当事方**（⇒ `rejected_authority`）；终态只填 `reviewAction`；**不复活终态、不改写历史**（原记录逐字节不变）；`scope` 只列受影响引用；幂等 `(reopenedRefs,newEvidenceDigest)`。夹具：真台账。R/W：`REC-EVD-08`；W05、W12。V2。**不证明**：重开裁决的实质正确性。
- **F-DAEMON-ENGINE-TEST-OBLIGATIONS-OBLIGATION** `test/engine/obligations/obligation.test.ts`（目标）— 覆盖 **OBL-01**：`instantiate`/`commit`/`link`/`overdue`；产出 `REC-OBL-01/02/03`；**逾期升级**产 `REC-EXC-01`（升一次，不重复升）；幂等 `(defRef,holder,triggerRef)`、`(commitmentRef,workRef)`；**未 `link` 的承诺不得被 `overdue` 计入**。恢复：重启后逾期判定不因重启重复升级。夹具：真台账 + 注入时钟。R/W：`REC-OBL-01/02/03`；W06、W10。V2。**不证明**：真实承诺履行的外部状态。
- **F-DAEMON-ENGINE-TEST-LIFECYCLE-IDENTITY** `test/engine/lifecycle/identity.test.ts`（目标）— 覆盖 **LIFE-01**：`transition`/`state`；**终态不得复活**（⇒ `rejected_state`）；**代次不沿用**（新代次 id 必不同）；`suspended→active` 须 **as-of 点 + 外部对账 + 缺口清单 + 时效性再验证**，缺一 ⇒ `rejected_precondition`；产出 `REC-LIFE-01`。夹具：真台账 + 对账桩。R/W：`REC-LIFE-01`；W05、W06。V2。**不证明**：外部人事系统的真实一致性。
- **F-DAEMON-ENGINE-TEST-LIFECYCLE-HANDOVER** `test/engine/lifecycle/handover.test.ts`（目标）— 覆盖 **LIFE-02**：`archive`/`verify`/`lossReport`；清算承接须「**承接范围 + 未承接项 + 接收确认**」三件齐；缺项 ⇒ `unverified`（**不判承接成立**）；产出 `REC-LIFE-02`，`lossReport` 产 `REC-LIFE-04`（移交面，**与 76 的 `REC-LOSS-01` 不同轴**）；未承接 ⇒ `WORK-07` 的 `CLOSE` 被拒（跨件断言）。夹具：真台账 + 归档目录。R/W：`REC-LIFE-02/04`；W06、W12。V2。**不证明**：归档内容的完整恢复。
- **F-DAEMON-ENGINE-TEST-LIFECYCLE-SUCCESSION** `test/engine/lifecycle/succession.test.ts`（目标）— 覆盖 **LIFE-03**：`decide`/`affected`；产出 `REC-LIFE-03` + 承继面 `REC-LIFE-04`（**与 LIFE-02 各出一份，不合并**）；**不复活终态**；`affected` 只列受承继影响的引用，不扩面。夹具：真台账。R/W：`REC-LIFE-03/04`；W06、W10。V2。**不证明**：承继裁决的实质正确性。
- **F-DAEMON-ENGINE-TEST-LIFECYCLE-APPOINTMENT** `test/engine/lifecycle/appointment.test.ts`（目标）— 覆盖 **LIFE-04**：`appoint`/`current`/`end(id,reason)`；`end` 的 `reason` **必填**、`id` 未登记 ⇒ `rejected_precondition`（**不得**静默返回空任命）；**无任命记录不得承担工作**（`WORK-11.open` 前置）；禁配 ⇒ `rejected_forbidden`；产出 `REC-LIFE-05`。夹具：真台账。R/W：`REC-LIFE-05`；W07、W10。V2。**不证明**：任命流程的组织侧合法性。
- **F-DAEMON-ENGINE-TEST-MEMORY-POLICY** `test/engine/memory/policy.test.ts`（目标）— 覆盖 **MEM-01 策略面**：四层（个人/出工/岗位/组织）**不合并**；`read(q,access)` 必带层 + **访问理由**，每次读产 `REC-MEM-02`；越层读 ⇒ `rejected_forbidden`；处置五操作（修正/清除/继承/转层/封存）产 `REC-MEM-03` 且**不删原文**；继承/转层须**接收确认 + `residue_statement`**；幂等 `(layer,subject,sourceRef)` 与 `dispositionId`。夹具：`MemoryStore` 端口桩（SQL 在 `store/src/memory/`，**本测试不测 SQL**）。R/W：`REC-MEM-01/02/03`；W06、W10。V2。**不证明**：持久化与访问控制的实际强度（归 `store`）。
- **F-DAEMON-ENGINE-TEST-OBSERVE-VIEWS** `test/engine/observe/views.test.ts`（目标）— 覆盖 **OBS-01**：`project(view,cursor?)`/`faults(since)`；**无 `Result` 通道**（不返 `Err`；来源不可用即 `state='gap'`）；六态 `observed/derived/unknown/stale/conflict/gap` 穷尽；**未知不得显示为 0/空/绿**；来源不可达 ⇒ `state='gap'` + `REC-OBS-02`；投影必带**来源游标 + 规则版本**；只读（assert 零写）；11 个观察面各一条最小断言。夹具：只读台账桩 + 六态样本。R/W：`REC-OBS-01/02`；W06、W10。V2。**不证明**：面板渲染（归 `panel`）。
- **F-DAEMON-ENGINE-TEST-NOTIFY-POLICY** `test/engine/notify/policy.test.ts`（目标）— 覆盖 **NOTI-01 策略面**：路由/去重/升级三策略；通道由 matrix 承担（端口注入，测试用 fake）；`from` **不得**为对象（`from?:string`）；**通知不是决定**（不产 `REC-DEC-*`、不产 `REC-WORK-02`）；发送失败如实进 `NotifySendReport`（**不吞成成功**）。夹具：fake `Notifier` + 真台账。R/W：80-§6.6 `Notifier`；W06、W10。V2。**不证明**：matrix 通道的真实送达。
- **F-DAEMON-ENGINE-TEST-TOOLS-EFFECT-GATEWAY** `test/engine/tools/effect-gateway.test.ts`（目标）— 覆盖 **EFF-01**（用例与 `81-files/06-gateway.md` §四 `EffectGateway` 行为契约 的 14 条**同源**；本卷不复制第二份用例表，只钉 **daemon 侧文件契约**）。**正**：`createEffectGateway(deps)` 的能力全部来自注入端口（内核用真 `createGateway`、不 fake HMAC；六个端口用内存 fake）；`applied` 先落 `REC-RCP-01` 再返 `Ok({status:'applied',receiptRef})`；`unknown` 先登记 `REC-EVT-03` 再返 `Ok({status:'unknown',unknownRef})`；意图域未知带 `unknown_scope.intentRef`。**反**：同键异内容 `Err(conflict)` 且附首次回执引用；权源解析失败 ⇒ 平台适配器 **0 次调用**、不写回执；凭据吊销 `rejected_authority`、范围不足 `rejected_forbidden`、旧 fence `rejected_version`；回执写失败 ⇒ 只能走未知路径，**不得**返回 `applied`；`registerUnknown` 失败 ⇒ `Err(unavailable, STALL, unknown-record-unwritten)`，**不得** `Ok(unknown)`；意图域缺 `intentRef` 拒 ↔ 非意图域缺 `intentRef` 放（**成对**，不得只写一侧）；类型层 `Ok({status:'applied'})`/`Ok({status:'unknown'})` 不可构造。夹具：内存六端口 fake + 真内核 + 平台调用计数。R/W：`REC-RCP-01`、`REC-EVT-02/03`；W06、W10。V2。**不证明**：真实 store 事务与 CAS、跨进程围栏、真实平台回执、真实对账、daemon 装配顺序（归 17）；流水线行为归 06。

**本节判负**：新增测试落到 `test/engine/` 直下（顶格）；用 fake 的绿声称真机能力；`intake-receipt` 在 `workIntake` 未注入时仍断言「已受理」；把 `V5` 写成已执行；用 `receipts.get` 的结果断言入队/重放行为；把 §4.12 的**目录设计**写成「能力已成立」；把端口测试写成已通过（本组全部**未实现**）；**用 `EffectGateway` 行为契约 冒充本卷的 daemon 文件 ID**（本卷 ID 是 `F-DAEMON-ENGINE-TOOLS-EFFECT-GATEWAY`，行为契约仍在 06）；在本卷复制第二份 EFF-01 流水线契约。

---

### 4.12 目标源码件契约（39 件，目标-新增）

**口径**：本节只写**目标**——39 个文件**全部不存在**（`find apps/daemon/src/engine -name '*.ts' | wc -l` = 68，本节无一件在其中）。每个条目给九个面：职责 / 非职责、内部函数与输入输出、依赖与层位、IO 与事务 / 幂等 / fence / 取消恢复、错误、测试与证据、规模、迁移、不证明。**不给 `path:line` 锚**（无行可锚）；只有在「迁移」一栏引用既有文件的真实行号。

**分组**：A 组 12 件＝`engine.ts` 既有职责的拆分（验收命令见 §2.3，迁移源是现文件）；B 组 27 件＝80 公共端口的实现落点（80-§6.9 表；类型在 `contract`、纯求值在 `core`、SQL 与投影在 `store`）。

**三条横切纪律（A/B 两组同效）**：① 端口类型只在 `contract/src/ports/<域>.ts`，本域**不定义、不复制**；② 纯求值只在 `core/src/<子域>/`，本域**只调**；③ SQL、事务、投影表只在 `store`，本域**不拼 SQL、不建投影表、不写投影**（唯一例外是 §5.1 的 `append` 事件写口）。

#### A 组：职责拆分 12 件

#### F-DAEMON-ENGINE-TICK-TYPES · `engine/tick/types.ts` 〔目标-新增，文件不存在〕

- **职责 / 非职责**：职责＝叶子类型模块，**纯搬移 7 型**：`EngineConfig`、`Inflight`、`MergeRunDeps`、`MergeRunContext`、`MergeRunHost` + 租约面 `MergeLeaseState`、`MergeLeaseRegistry`（改名即提案流）。非职责＝不新增类型、不做默认值、不承载逻辑。
- **内部函数与输入输出**：无函数，仅 `export interface`/`export type`。符号闭包必须覆盖 `merge/merge-run.ts` 的 5 型回引与 `merge/merge-lease.ts` 的 2 型，否则 §1.3 的环不断（U81-20）。
- **依赖与层位**：包依赖仅 `contract`/`core` 的**类型**；零相对运行时导入；被 `engine.ts`、`merge/*`、`tick-report/types.ts` 单向引用 ⇒ 出环。
- **IO 与事务**：零 IO、零时钟、零随机（纯类型）。
- **错误**：无错误面。类型错误只在 `bun run typecheck` 暴露。
- **测试与证据**：无独立运行时测试（由 `TEST-TICK-STATE`/`TEST-TICK-PHASES`/`TEST-TICK-REPORT` 与 `merge/*.test.ts` 间接编译）；验收命令见 §2.3 第 1 步。
- **规模**：目标 <120 行；**只搬不增**。
- **迁移**：自 `engine.ts:319/501/531/601/644` 与 `merge/merge-run.ts:92/101/115`、`merge/merge-lease.ts:17/24/30/37` 纯搬移；`engine.ts:314` 的再出口保留 re-export。
- **不证明**：搬移不证明环已全解（须「`rg "from '\.\./engine\.ts'" apps/daemon/src/engine/merge` 为空 + `bun run typecheck` 绿」）。

#### F-DAEMON-ENGINE-TICK-STATE · `engine/tick/state.ts` 〔目标-新增，文件不存在〕

- **职责 / 非职责**：职责＝引擎进程内可变状态容器（在途表、泳道簿、断路口、`tick.seq` 序号、意图队列、拆单队列）与其读写小函数。非职责＝不碰 IO/台账、不做状态决策、不持有 `Engine` 句柄。
- **内部函数与输入输出**：`createTickState()`；`trackInflight/untrackInflight`、`laneOf/laneBook`、`breakerOf`、`nextSeq/seedSeq`、`enqueueIntents/drainIntents`、`pendingIntents()`。输入输出均为纯内存结构，**无 `Promise`**。
- **依赖与层位**：`contract`（`InvokeIntent`、`Inflight` 等）、`./types.ts`；**不得**引 `store`/`adapters`（状态层不碰持久化与执行体）。
- **IO 与事务**：零 IO。状态只在内存 ⇒ 崩溃后由台账 `running` 行 + `harvest/inflight-takeover.ts` 恢复，**不由本件恢复**。
- **错误**：无 `Result`；重复登记/注销不存在按幂等处理，并以返回的 `note` 让调用方决定是否上报（**不得静默**，§7.2）。
- **测试与证据**：`TEST-TICK-STATE`（`test/engine/tick/state.test.ts`）。
- **规模**：目标 ≤300 行；`tick/` 逐目录 ≤25 件。
- **迁移**：自 `engine.ts` 的闭包变量抽出；`engine.ts:752/1572` 的拍序播种与落盘改由本件持有值、由 `tick/phases.ts` 调 `Ledger`。
- **不证明**：单进程假设（状态不跨进程）、崩溃后的状态内容。

#### F-DAEMON-ENGINE-TICK-PHASES · `engine/tick/phases.ts` 〔目标-新增，文件不存在〕

- **职责 / 非职责**：职责＝七相位序列的**唯一编排点**（collect→pre→dispatch→harvest→merge→reclaim→account），每相位一小函数，只调各域件。非职责＝不实现任何相位内业务（在域件里）、不新增第八相位（§10 第 1 条）。
- **内部函数与输入输出**：`runTick(ctx)`；`phaseCollect/phasePre/phaseDispatch/phaseHarvest/phaseMerge/phaseReclaim/phaseAccount`，各返回该相位的汇报片段（`TickReport` 的一部分）；副作用全部经注入的 deps。
- **依赖与层位**：`tick/state.ts`、`tick/report.ts`、`dispatch/*`、`harvest/*`、`breaker/*`、`merge/*`、`jobs/*`、`hrsync/*`、`pricing/*`、`cost-close/*` 与既有域件；包依赖 `core`（`decide`）、`contract`。层位同 `engine`（不得引 `assembly`/`control`/`evolve`）。
- **IO 与事务**：台账事务内**不 `await`** 外部长 IO（§6.1）；单拍重复执行由 `append` 去重 + 状态容器保证。fence：`tick.seq` 单调，同序号不二次落盘。
- **错误**：相位抛错即记 `errors` 并按现状语义决定继续/中止（现状「采集失败只记错不炸拍」＝`engine.ts:1613/1617` 的有意降级，目标映射 `degraded`/`STALL`）；分类表见 §7.2。
- **测试与证据**：`TEST-TICK-PHASES`（相位桩记录调用序）。
- **规模**：目标 ≤600（硬上限）；抽出后 `engine.ts` facade 必须 <600。
- **迁移**：`engine.ts:1582-2236` 七相位段逐段搬移，注释锚（1→7）保留。
- **不证明**：真实平台耗时、相位内业务正确性（各域件自证）。

#### F-DAEMON-ENGINE-TICK-REPORT · `engine/tick/report.ts` 〔目标-新增，文件不存在〕

- **职责 / 非职责**：职责＝`TickReport` 的组装与收口：`errors` 归一为 `ClassifiedError[]`、`warn`/note 不与 `errors` 混、`events` 只计 `appended`。非职责＝不改 `tick-report/types.ts` 的类型定义源、不做状态判定、不序列化。
- **内部函数与输入输出**：`createTickReportBuilder()`；`addPhase/mergePhaseResult`、`pushError(ClassifiedError)`、`finalize(seq, at)`；输入＝各相位片段 + 错误样本，输出＝`TickReport`。
- **依赖与层位**：`tick-report/types.ts`（类型）、`contract`（`ClassifiedError`）、`core`。
- **IO 与事务**：零 IO。
- **错误**：本件是错误**汇集点**、不是分类器。23 处裸 `errors.push` 迁来后**必须逐条带** `{failure, category, subcause}`；**只改类型不逐处分类＝未出清**（U81-04）。
- **测试与证据**：`TEST-TICK-REPORT`。
- **规模**：目标 ≤250 行。
- **迁移**：`engine.ts` 的 23 处 `errors.push` 与 `TickReport` 组装段（`errors` 计数不因拆件而变）。
- **不证明**：分类映射的正确性（映射表本身是目标态）。

#### F-DAEMON-ENGINE-DISPATCH-EXECUTE · `engine/dispatch/execute.ts` 〔目标-新增，文件不存在〕

- **职责 / 非职责**：职责＝`executeDispatch` 全序：读档位 → 组任务书 → 预算闸 → 签 wkey → 开房间 → `launch` → 登记在途。非职责＝不拼任务书正文（`brief.ts`）、不做状态决策（`core`）、不解释平台方言（adapter）。
- **内部函数与输入输出**：`executeDispatch(deps, taskRef, lane)` → `DispatchOutcome`；依赖 `budget-gate`、`worker-key`、`prompt-assembly`、`rooms/room-duty`、`adapters` 的 `ExecutorRegistry`。
- **依赖与层位**：`engine` 层；**不得**引 `assembly`/`control`/`evolve`/`panel`/`api`/`yt`/`matrix`/`localplatform`（§2.2）。
- **IO 与事务**：**不落即不派**（20-§六.8）——预算预留落账（`budget-gate.ts:176`）成功才 `launch`；`launch` 失败 ⇒ 在途不登记、**预留不返还**（失败保留）。fence：同 `(ticket,attempt)` 已有在途 ⇒ 拒绝二次派发。取消：`dispose` 按在途表撤销；撤销失败**不得静默**。
- **错误**：预算不足 `rejected_precondition`/`BUDGET`/`insufficient`；能力缺 `unsupported`/`EVOLVE_REJECT`/`capability-missing`；wkey 签发失败 `unavailable`/`STALL`/`gateway-down`；launch 失败 `unavailable`/`STALL`/`launch-failed`。
- **测试与证据**：`TEST-DISPATCH-EXECUTE`。
- **规模**：目标 ≤350 行。
- **迁移**：`engine.ts:880` 起 `executeDispatch`。
- **不证明**：真实 DSH 启动、真实 wkey 服务、真实房间。

#### F-DAEMON-ENGINE-DISPATCH-BRIEF · `engine/dispatch/brief.ts` 〔目标-新增，文件不存在〕

- **职责 / 非职责**：职责＝派发任务书拼装（正文、续跑前情、合并指令块不串入普通派发、`instructionsPath` 决策、凭据段**只放 env 键名不放值**）。非职责＝不调 executor、不拼 L0–L5（`packages/prompt`）、不生成凭据值。
- **内部函数与输入输出**：`buildTaskBrief(deps, taskRef)` → `TaskBrief`；`decideInstructionsPath(mode)` → `'bridge' | 'native'`。输入＝档位/合同/计划/凭据引用，输出＝`TaskBrief`。
- **依赖与层位**：`contract`（`TaskBrief`）、`prompt`（L0–L5 结果）、`core`。
- **IO 与事务**：只读公司目录/工位模板（经注入的读文件函数）；**禁写**。
- **错误**：模板缺 `rejected_precondition`/`PRE`/`template-missing`；凭据引用不可解析 `unavailable`/`STALL`/`secret-unavailable`。
- **测试与证据**：`TEST-DISPATCH-BRIEF`（金样文本 + 「凭据段无值」断言）。
- **规模**：目标 ≤300 行。
- **迁移**：`engine.ts` 派发段内的任务书拼装部分。
- **不证明**：提示词实际效果、L0–L5 预算。

#### F-DAEMON-ENGINE-HARVEST-ONE · `engine/harvest/one.ts` 〔目标-新增，文件不存在〕

- **职责 / 非职责**：职责＝单在途工位的一次收割判定（流收、要件折叠、终局分流）。非职责＝不收口（`finalize.ts`）、不落 `GATE_PASS`、不判验收（`EVD-02`）。
- **内部函数与输入输出**：`harvestOne(deps, inflight)` → `'done' | 'failed' | 'waiting'`；调 `stream.ts` 的泵与折叠；输入＝在途句柄 + 流 + 只读台账面。
- **依赖与层位**：`harvest/stream.ts`、`harvest/park.ts`、`contract`（流事件类型）、`core`（四要件判定）。
- **IO 与事务**：读工位文件；**不写台账**。fence：`dispatchedAtSeq` 与拍序相同 ⇒ **同拍派发不收割**（防新单被当旧单）。
- **错误**：`unverified`/`EVIDENCE`/`<缺件名>`；**不得**用「没找到」推断「没做」。
- **测试与证据**：`TEST-HARVEST-ONE`。
- **规模**：目标 ≤300 行。
- **迁移**：`engine.ts:1146`。
- **不证明**：真实产物形态、真实闸命令。

#### F-DAEMON-ENGINE-HARVEST-STREAM · `engine/harvest/stream.ts` 〔目标-新增，文件不存在〕

- **职责 / 非职责**：职责＝一次性流的跨拍增量泵（`pumpHarvestStream`）与事件折叠（`foldHarvestEvent`）。非职责＝不做终局判定、不写台账、不做计时（计时钟在 `park.ts`）。
- **内部函数与输入输出**：`pumpHarvestStream(state, iterator, deadline)`；`foldHarvestEvent(acc, evt)` → 折叠后的四要件累计。
- **依赖与层位**：`harvest/park.ts`、`contract`。
- **IO 与事务**：只读流。恢复：流异常吞并记 `streamError` 并在**下一拍**收口；**一封流只开一次**，`next` 的驻留 promise **不得中途返回**（会丢事件）。
- **错误**：`streamError` → `unavailable`/`STALL`/`stream-error`（必须可见，不静默）。
- **测试与证据**：`TEST-HARVEST-STREAM`（受控 `AsyncIterator`）。
- **规模**：目标 ≤300 行。
- **迁移**：`engine.ts:1183/1215`。
- **不证明**：真实 dsh 流的时序与背压。

#### F-DAEMON-ENGINE-HARVEST-FINALIZE · `engine/harvest/finalize.ts` 〔目标-新增，文件不存在〕

- **职责 / 非职责**：职责＝四要件全绿的收口：`GATE_PASS` 落账（一次）、工时结算、工位回收、在途注销。非职责＝不判验收、不做合并、不返预留。
- **内部函数与输入输出**：`finalizeHarvest(deps, inflight, bundle)` → `Result<void>`；按 `(ticket, attempt)` 幂等：重复收口不再落 `GATE_PASS`、不再结算工时。
- **依赖与层位**：`Ledger`、`core`、`harvest/park.ts`、文件系统（工位回收）。
- **IO 与事务**：台账写在事务内，文件清理在事务外；事务内**不 `await`** 外部 IO。
- **错误**：`conflict`/`STATE`/`already-finalized`；**结算失败与收口失败不得互相掩盖**（两条 `ClassifiedError` 都要上报）。
- **测试与证据**：`TEST-HARVEST-FINALIZE`。
- **规模**：目标 ≤350 行。
- **迁移**：`engine.ts:1224`。
- **不证明**：真实平台状态迁移、真实归档。

#### F-DAEMON-ENGINE-HARVEST-STALL · `engine/harvest/stall.ts` 〔目标-新增，文件不存在〕

- **职责 / 非职责**：职责＝`failHarvest` 与停滞/看护升级面（`executeStallResponse` 的收割侧落点）。非职责＝不做断路判定（`breaker/*`）、不重派（相位 2 复活对账）。
- **内部函数与输入输出**：`failHarvest(deps, inflight, reason)`、`executeStallResponse(deps, ticket, policy)` → `Result<void>` + 事件。
- **依赖与层位**：`core/breaker.ts`（纯判定）、`Ledger`、`notify/*`。
- **IO 与事务**：台账写事件 + kill 面（经注入的 `onKill`）。fence：同一 ticket 的 STALL 升级**恰一次**（按 `(ticket, stallN)` 幂等）。
- **错误**：无句柄 ⇒ `GATE_FAIL`/`WORKER_DEAD`；停滞升级 `degraded`/`STALL`/`worker-dead`；**失败保留不返还预留**。
- **测试与证据**：`TEST-HARVEST-STALL`。
- **规模**：目标 ≤300 行。
- **迁移**：`engine.ts:1361/1476`。
- **不证明**：真实 SIGKILL 语义、限速/超时分布。

#### F-DAEMON-ENGINE-BREAKER-TRIP · `engine/breaker/trip.ts` 〔目标-新增，文件不存在〕

- **职责 / 非职责**：职责＝`strikeBreakerAndMaybeTrip`——断路口计击与跳闸（纯判定委托 `core/breaker.ts`）。非职责＝不实现半开试探（`probe.ts`）、**不发 `CIRCUIT_BREAK`**（U81-14 未决，现只发 `ESCALATE` + note 前缀 `CIRCUIT_BREAK：`）。
- **内部函数与输入输出**：`strikeBreakerAndMaybeTrip(state, signature, now)` → `{ tripped, strikeCount }`。
- **依赖与层位**：`core/breaker.ts`、`tick/state.ts`（断路口）、`Ledger`。
- **IO 与事务**：仅事件写。幂等：同签名连击累计、异签名不累计、跳闸后冷却期内不重复跳。
- **错误**：判定本身不返 `Result`；跳闸落账失败上报 `unavailable`/`STALL`/`breaker-write`。
- **测试与证据**：`TEST-BREAKER-TRIP`（现状另有 `TEST-BREAKER-HALF-OPEN` 钉住半开行为，不是本件测试）。
- **规模**：目标 ≤180 行。
- **迁移**：`engine.ts:1425`（含 `:1448-1453` 的 ESCALATE note 前缀）。
- **不证明**：`CIRCUIT_BREAK` 事件缺失问题已解（U81-14 仍开）。

#### F-DAEMON-ENGINE-BREAKER-PROBE · `engine/breaker/probe.ts` 〔目标-新增，文件不存在〕

- **职责 / 非职责**：职责＝半开试探：冷却到期后的试探派发与成功/失败回写，**不新增相位**。非职责＝不改相位序列、不做派发本体（调 `dispatch/execute.ts`）、不做断路计数（`trip.ts`）。
- **内部函数与输入输出**：`probeBreaker(state, now, dispatch)` → `'closed' | 'open' | 'skipped'`；试探失败 ⇒ 回全开并续冷却；试探期间新失败不叠加；试探单数有界（1）。
- **依赖与层位**：`core/breaker.ts`、`tick/state.ts`、`dispatch/execute.ts`。
- **IO 与事务**：事件写 + 派发副作用（经 dispatch）；幂等：同冷却窗只试探一次。
- **错误**：试探失败 `degraded`/`STALL`/`probe-failed`；跳过（冷却未到）**不是错误**，返回 `'skipped'` 且不写事件。
- **测试与证据**：`TEST-BREAKER-PROBE`。
- **规模**：目标 ≤180 行。
- **迁移**：既有半开逻辑（`test/engine/breaker-half-open.test.ts` 钉住的现行为）迁入。
- **不证明**：真实限流（429）时序、真实长冷却。

#### B 组：80 公共端口落点 27 件

**共同前提（27 件同效）**：端口类型在 `contract/src/ports/{command,decision,work,evidence,obligation,lifecycle,memory,observation,effects}.ts`（**不存在**，归 01 卷）；纯求值在 `core/src/{work-readiness.ts, resources/}`（**不存在**，归 02 卷）；SQL、事务与投影在 `store/src/{records,memory,resources}/`（**不存在**，归 03 卷）。三者未落地前，本组**全部不可编译**——这是「未实现」的准确含义，不是排期说明。本组每个条目只描述 daemon 侧的**编排与 IO 边界**。

#### F-DAEMON-ENGINE-DECISION-INTAKE · `engine/decision/intake.ts` 〔目标-新增，CMD-01，文件不存在〕

- **职责 / 非职责**：职责＝`CommandIntake.submit(CommandDraft)` 与 `check(commandId)`；写 `REC-CMD-01/02`；按 `commandKind` 路由到 work-intake / lifecycle / settlement / authority / rejected。非职责＝**不直接执行外部效果**、不判受理（WORK-01）、不执行命令本体。
- **内部函数与输入输出**：`createCommandIntake(deps)` → `CommandIntake`；`submit`＝核验来源 → 幂等键 `(company, source, commandKind, idempotencyKey)` 查重 → 追加记录 → 路由；`check(commandId)` **只回读权检**（不写、不执行）。
- **依赖与层位**：类型 `contract/src/ports/command.ts`；查重与追加在 `store/src/records/` 的同一写事务；编排上可调 `work/intake.ts`、`lifecycle/*`、`work/settlement.ts`；**不得**引 `gateway` 直发外部效果（外部效果只经 `engine/tools/effect-gateway.ts`）。
- **IO 与事务**：单写事务内查重 + 追加；长 IO 在事务外；幂等同键同摘要 `duplicate`、异摘要 `Err(rejected_idempotency)`。取消/中断：事务不留半条。
- **错误**：来源未核验 `rejected_precondition`/`EXTERNAL_REJECT`/`source-unverified`；越权 `rejected_authority`/`EXTERNAL_REJECT`/`authority-missing`；`unsupported`/`EVOLVE_REJECT`/`command-kind-unsupported`。HTTP 邻接体按 §7.2。
- **测试与证据**：`TEST-DECISION-INTAKE`（`test/engine/decision/command-intake.test.ts`）。
- **规模**：目标 ≤300 行；`decision/` 逐目录 2 件。
- **迁移**：无（新件）。80-§6.4 标 **experimental**：形状可改，落地前须再核。
- **不证明**：真实命令语义与鉴权强度；experimental 标记本身不证明稳定。

#### F-DAEMON-ENGINE-DECISION-DECIDE-RECORD · `engine/decision/decide-record.ts` 〔目标-新增，DEC-01，文件不存在〕

- **职责 / 非职责**：职责＝`DecisionPort.record`/`get`；**只用于没有专用记录类型的决定**。非职责＝不产生任何专用 `REC-*`、不替代 `REC-WORK-02`/`REC-WORK-04`、不做裁决本身。
- **内部函数与输入输出**：`createDecisionPort(deps)`；`record(subjectRef, decisionKind, verdict, basisDigest, decidedBy)` → `Result<RecordRef>`；`get(subjectRef, decisionKind)` → `DecisionRecord | undefined`。
- **依赖与层位**：类型 `contract/src/ports/decision.ts`；存储 `store/src/records/`（`REC-DEC-01`）。
- **IO 与事务**：单事务追加；幂等 `(subjectRef, decisionKind, verdict, basisDigest)`。
- **错误**：已有专用记录类型仍走本口 ⇒ `rejected_precondition`/`PRE`/`dedicated-record-exists`；缺依据 `rejected_precondition`/`PRE`/`basis-missing`。
- **测试与证据**：`TEST-DECISION-DECIDE-RECORD`。
- **规模**：目标 ≤150 行。
- **迁移**：无。
- **不证明**：裁决的业务正确性。

#### F-DAEMON-ENGINE-WORK-INTAKE · `engine/work/intake.ts` 〔目标-新增，WORK-01，文件不存在〕

- **职责 / 非职责**：职责＝`WorkIntake.reserve`（**一个写事务内**查重 + 追加不可变 `REC-WORK-01`，九字段齐）与 `intake`（写 `REC-WORK-02`，`outcome` 五值）。非职责＝**不写投影**（由 store 自有 hook 同事务写）、不判受理结论（结论由业务方给，本件只承载）、不生成 `intentRef`（由 `reserve` 派生）。
- **内部函数与输入输出**：`createWorkIntake(deps)`；`reserve(intent)` → `{ intentRef, bodyDigest, receivedAt, duplicate }`；`intake(intentRef, outcome, …)` → `Result<void>`；`get(intentRef)` 只读。
- **依赖与层位**：类型 `contract/src/ports/work.ts`；查重/追加与 `REC-WORK-02` 写入在 `store/src/records/`；**投影写由 store 的 projection hook 占位**，本件不持写口。
- **IO 与事务**：写事务内查重 + 追加；commit 后同一微任务更新快照（由 store 做，本件不参与）；幂等 `(company, source, kind, ticket ?? dedupKey)` 与 `core/src/decide.ts:319-324` 的 `intentKeyOf` **逐位一致**；fence：同一 `intentRef` 只允许一次 `intake`（二次 ⇒ `duplicate` 或 `Err`）。取消：事务中断不留半封。
- **错误**：异摘要 `rejected_idempotency`/`EXTERNAL_REJECT`/`body-mismatch`；`outcome` 非法 `rejected_precondition`/`PRE`/`outcome-invalid`（**不得**塞第六值，未判＝缺省）；`forwarded` 缺 `ReferralTarget` `rejected_precondition`/`PRE`/`referral-target-missing`；`positionRef.kind` 越界 `rejected_precondition`/`PRE`/`referral-kind-invalid`。
- **测试与证据**：`TEST-WORK-INTAKE`。
- **规模**：目标 ≤300 行；`work/` 逐目录 11 件（≤25）。
- **迁移**：无（`intents/drain.ts:35/75` 的现状调用面保留，改为经本件）。
- **不证明**：跨进程同键并发；`REC-WORK-01` 九字段的业务内容正确性。

#### F-DAEMON-ENGINE-WORK-CONTRACT · `engine/work/contract.ts` 〔目标-新增，WORK-02，文件不存在〕

- **职责 / 非职责**：职责＝`propose`/`amend(ticket, change, expectedVersion)`/`current`；五要件齐、版本链**只增不改**。非职责＝不评估条款、不授权、不判受理。
- **内部函数与输入输出**：`createContractPort(deps)`；`propose(draft)` → `VersionRef<Qid>`；`amend(...)` **CAS**；`current(ticket)` → 最新 `VersionRef`。
- **依赖与层位**：类型 `contract/src/ports/work.ts`；存储 `store/src/records/`（`REC-WORK-03`）。
- **IO 与事务**：`amend` 必须在单事务内 CAS（`expectedVersion`）；幂等按 `(ticket, change, expectedVersion)` 摘要；旧版本记录**不可变**。
- **错误**：`rejected_version`/`EVOLVE_REJECT`/`version-mismatch`；五要件缺 `rejected_precondition`/`PRE`/`five-elements-missing`。
- **测试与证据**：`TEST-WORK-CONTRACT`。
- **规模**：目标 ≤250 行。
- **迁移**：无。
- **不证明**：条款实质公平性。

#### F-DAEMON-ENGINE-WORK-READINESS · `engine/work/readiness.ts` 〔目标-新增，WORK-03，文件不存在〕

- **职责 / 非职责**：职责＝`ReadinessGate.judge(ReadinessRequest)` → `RecReadinessJudgment`（**13 字段**）；**纯求值委托** `core/src/work-readiness.ts`，本件只装配输入（合同 / 授权 / 资格 / 计划 / 资源基线 / 信息 / 禁止清单）并写 `REC-WORK-04`。非职责＝不实现五门判据（`core`）、不预留资源（`plan.ts`）、**不把风险塞进五门**（`WORK-09` 是验收/降档材料）。
- **内部函数与输入输出**：`createReadinessGate(deps)`；`judge(req)`＝装配 → `core` 求值 → 写记录 → 返回。`req.planRef` **必须指向已锁计划**（顺序：合同 → 计划锁 → 五门，§4.12 总序），且**不得成环**——本门不得反查需要本门结果的计划字段。
- **依赖与层位**：`core/src/work-readiness.ts`（02 卷，**不存在**）、`core/src/resources/`（`baseline`）、`contract/src/ports/work.ts`、`store/src/records/`（`REC-WORK-04`）。
- **IO 与事务**：读合同/资格/计划/基线；单事务写 `REC-WORK-04`；幂等 `(contractRef, planRef, decidedAt)` 同摘要不写第二份。
- **错误**：合同版本不符 `rejected_version`/`EVOLVE_REJECT`/`contract-version-mismatch`；计划未锁 `rejected_precondition`/`PRE`/`plan-not-locked`；基线不可读 `unavailable`/`STALL`/`quota-unreadable`（**不得**返回「剩余＝全部额度」）；`gaps` 非空仍 `Ok`（缺口是事实，不是错误）。
- **测试与证据**：`TEST-WORK-READINESS`（13 字段逐项、五门对齐、基线缺项不判充足）。
- **规模**：目标 ≤400 行。
- **迁移**：无。既有 `engine.ts:1403` 结论（并发四闸 + 断路器前置）**不是**开工五门；目标态是**先五门、后四闸**，两者不可互替（80-§7.2）。
- **不证明**：五门判据的正确性（归 `core`）；`resource_ledger` 投影可重建（U81-23）。

#### F-DAEMON-ENGINE-WORK-PLAN · `engine/work/plan.ts` 〔目标-新增，WORK-04，文件不存在〕

- **职责 / 非职责**：职责＝`ExecutionPlanPort.lock(plan)`/`get(ticket, attempt)`；钉六件 `VersionRef`（定义修订 / 合同版本 / 资格认定 / 能力描述 / 执行配置 / 绑定档案）+ `rule_profile_version` + `known_incapabilities` + `substitution_plan?` + **`resource_reservations`**；**同事务写预留并更新内部资源投影**。非职责＝不判能不能开工（`readiness.ts`）、**不另起公共资源写口**（RES-01 无 `reserve`/`actual`/`release`）。
- **内部函数与输入输出**：`createExecutionPlanPort(deps)`；`lock(plan)` → `Result<VersionRef<Qid>>`；`get(ticket, attempt)` → `ExecutionPlan | undefined`。`resource_reservations` 每项 `{ resource_ref, amount, unit, period, quota_ref }`。
- **依赖与层位**：`contract/src/ports/work.ts`（`REC-WORK-05` 形状）；`store/src/records/`（写计划）+ `store/src/resources/`（**同事务**更新投影）；`core/src/resources/`（额度校验纯函数）。
- **IO 与事务**：单写事务内「追加计划 + 写预留 + 更新投影」；**空 `resource_reservations` ≠ 资源充足**——空列表必须带理由与依据，否则 `rejected_precondition`；预留**不得静默续期**（跨 `period` 未重锁 ⇒ 明报）；实际与释放**不写在这里**（`REC-EVD-01/05`、`REC-EVD-06`）。
- **错误**：空预留无理由 `rejected_precondition`/`PRE`/`reservation-reason-missing`；`(ticket, attempt)` 冲突 `rejected_version`/`EVOLVE_REJECT`/`plan-attempt-conflict`；字段不支持 `unsupported`/`EVOLVE_REJECT`/`plan-field-unsupported`。
- **测试与证据**：`TEST-WORK-PLAN`（含「计划行与预留同现或同无」的恢复用例）。
- **规模**：目标 ≤350 行。
- **迁移**：无。计划锁在 **77-§4.5.1**，`resource_reservations` 是其字段，不是本件新增概念。
- **不证明**：`resourceLedger` 投影已建表、可重建（名字已由 80-§6.3 登记，**实现未做**——U81-23）；真实额度语义。

#### F-DAEMON-ENGINE-WORK-LIFECYCLE · `engine/work/lifecycle.ts` 〔目标-新增，WORK-05，文件不存在〕

- **职责 / 非职责**：职责＝`transition(ticket, to, basis, expected)`/`state(ticket)`；状态由**事件流重放派生**；**双 CAS**（状态 + `REC-WORK-09` 链顶 recordId）。非职责＝不定义状态机（`core`）、不改写历史事件、不判验收。
- **内部函数与输入输出**：`createWorkLifecycle(deps)`；`transition(...)` → `Result<void>`；`state(ticket)` → 派生状态。`TransitionExpectation = { expectedState, expectedLineageHead }`——**两项皆必填**。
- **依赖与层位**：`core`（状态机/派生）、`contract/src/ports/work.ts`、`store/src/records/`（链顶索引）。
- **IO 与事务**：CAS 在单事务内；链顶不符 ⇒ `rejected_version` 且**必须重读链顶**（**不得**静默改接最新）；幂等：同一 `(ticket, to, basis)` 已成立 ⇒ `Ok` 无副作用。
- **错误**：非法边 `rejected_state`/`STATE`/`illegal-edge`；链顶不符 `rejected_version`/`EVOLVE_REJECT`/`lineage-head-mismatch`；期望不全 `rejected_precondition`/`PRE`/`expectation-incomplete`。
- **测试与证据**：`TEST-WORK-LIFECYCLE`。
- **规模**：目标 ≤300 行。
- **迁移**：无。
- **不证明**：平台侧状态与本地状态的一致性（78 `StateMapping`）。

#### F-DAEMON-ENGINE-WORK-EXCEPTION · `engine/work/exception.ts` 〔目标-新增，WORK-06，文件不存在〕

- **职责 / 非职责**：职责＝`raise`/`receive`/`escalate`/`close` 四段，每段**具名接收** + 期限/复审；超期 ⇒ `degraded`。非职责＝不做通知送达（`matrix`）、不代替受理、不自动关闭。
- **内部函数与输入输出**：`createExceptionPort(deps)`；四方法各返回 `Result<ExceptionRef>`；`close` 要求前段已完成。
- **依赖与层位**：`contract/src/ports/work.ts`、`store/src/records/`（`REC-EXC-*`）。
- **IO 与事务**：单事务写段；幂等 `(exceptionId, step)`；超期判定用注入时钟。
- **错误**：跳段 `rejected_state`/`STATE`/`step-out-of-order`；缺期限 `rejected_precondition`/`PRE`/`deadline-missing`。
- **测试与证据**：`TEST-WORK-EXCEPTION`。
- **规模**：目标 ≤300 行。
- **迁移**：无。
- **不证明**：真实升级通知送达。

#### F-DAEMON-ENGINE-WORK-SETTLEMENT · `engine/work/settlement.ts` 〔目标-新增，WORK-07，文件不存在〕

- **职责 / 非职责**：职责＝`settle`/`status`；**八项**齐（产物 / 资源 / 证据 / 未决义务 / 承诺 / 相对方 / 责任 / 记忆）+ `dissent` **字段**（不是第九项）；`settled_state` 四值；**终止路径例外**；`转入清算` 须 `REC-LIFE-02` 承接；产出 `REC-EVD-06`。非职责＝不做验收（EVD-02）、不做价值评估（EVD-03）。
- **内部函数与输入输出**：`createSettlementPort(deps)`；`settle(ticket, accounts)`＝校验八项 → 写 `REC-EVD-06`；`status(ticket)`。
- **依赖与层位**：`contract/src/ports/work.ts`、`store/src/records/`、`lifecycle/handover.ts`（承接校验）。
- **IO 与事务**：单事务写；幂等 `(ticket, attempt, settlementDigest)`；**`未结清` 不得被读成 `结清`**。
- **错误**：八项缺 `rejected_precondition`/`PRE`/`account-missing`；未承接 `CLOSE` `rejected_state`/`STATE`/`liquidation-not-assumed`；异议越权 `rejected_forbidden`/`EXTERNAL_REJECT`/`dissent-forbidden`。
- **测试与证据**：`TEST-WORK-SETTLEMENT`（含「未承接不得 CLOSE」跨件断言）。
- **规模**：目标 ≤400 行。
- **迁移**：无。
- **不证明**：结清金额的定价正确性。

#### F-DAEMON-ENGINE-WORK-QUALIFICATION · `engine/work/qualification.ts` 〔目标-新增，WORK-08，文件不存在〕

- **职责 / 非职责**：职责＝`determine`/`current`；判定者与被判者**不得同一主体**；**只判资格**。非职责＝不解析能力、不授权、不安装。
- **内部函数与输入输出**：`createQualificationPort(deps)`；`determine(subject, needRef, evidence)`；`current(subject, needRef)`。
- **依赖与层位**：`contract/src/ports/work.ts`、`store/src/records/`（`REC-WORK-08`）。
- **IO 与事务**：单事务写；幂等 `(subject, needRef, evidenceDigest)`；`term` 过期即无效。
- **错误**：自判 `rejected_authority`/`EXTERNAL_REJECT`/`self-qualification`；缺证据 `rejected_precondition`/`PRE`/`evidence-missing`；版本冲突 `rejected_version`/`EVOLVE_REJECT`/`version-mismatch`。
- **测试与证据**：`TEST-WORK-QUALIFICATION`。
- **规模**：目标 ≤250 行。
- **迁移**：无。
- **不证明**：证据的真实性。

#### F-DAEMON-ENGINE-WORK-RISK · `engine/work/risk.ts` 〔目标-新增，WORK-09，文件不存在〕

- **职责 / 非职责**：职责＝`classify`/`current`；分类者**不得是交付方**；**只增不降**；产出 `REC-WORK-11`。非职责＝**不进五门**（五门不含风险）、不判验收。
- **内部函数与输入输出**：`createRiskClassifier(deps)`；`classify(ticket, attempt, input)`；`current(ticket, attempt)`。
- **依赖与层位**：`contract/src/ports/work.ts`、`store/src/records/`。
- **IO 与事务**：单事务写；幂等 `(ticket, attempt, riskInputDigest)`。
- **错误**：交付方自评 `rejected_authority`/`EXTERNAL_REJECT`/`deliverer-self-classify`；降档缺独立位置或异议位置 `rejected_authority`/`EXTERNAL_REJECT`/`downgrade-unfounded`。
- **测试与证据**：`TEST-WORK-RISK`。
- **规模**：目标 ≤250 行。
- **迁移**：无。
- **不证明**：风险等级实质。

#### F-DAEMON-ENGINE-WORK-ASSIGNMENT · `engine/work/assignment.ts` 〔目标-新增，WORK-10，文件不存在〕

- **职责 / 非职责**：职责＝`request`/`respond`；`actionKind` **十一取值**（派工/领取/转派 + 请求输入/请求评审/请求授权/移交/接力/会签/异议/提请裁决）；`carriedTerms`/`deadline`/`noResponseEffect`/`handoverChecklist`；**未响应语义逐项**；产出 `REC-WORK-10`。非职责＝不承担能力/授权（只承载条款）、不判资格。
- **内部函数与输入输出**：`createAssignmentPort(deps)`；`request(req)`；`respond(assignmentRef, response)`。
- **依赖与层位**：`contract/src/ports/work.ts`、`store/src/records/`。
- **IO 与事务**：单事务写；幂等 `(assignmentRef, response)`；超期按 `noResponseEffect` 落语义（**不视为同意**）。
- **错误**：`actionKind` 非法 `rejected_precondition`/`PRE`/`action-kind-invalid`；未确认即移交 `rejected_state`/`STATE`/`handover-unconfirmed`；未签即生效 `rejected_state`/`STATE`/`signature-missing`。
- **测试与证据**：`TEST-WORK-ASSIGNMENT`（十一取值穷尽 + 未响应三类语义）。
- **规模**：目标 ≤350 行。
- **迁移**：无。
- **不证明**：协作方的真实响应行为。

#### F-DAEMON-ENGINE-WORK-ATTENDANCE · `engine/work/attendance.ts` 〔目标-新增，WORK-11，文件不存在〕

- **职责 / 非职责**：职责＝`open`/`close`；**六面** `holder`/`appointment_ref`/`rank_interface_ref`（岗位要求职级时必填，不适用须写理由）/`qualification_refs`/`plan_ref`/`authorization_ref` + `work_ref`/`period`/`responsibility_scope`/`consistency_check`；产出 `REC-WORK-06/07`。非职责＝不改资格/任命记录、不判资源、不判验收。
- **内部函数与输入输出**：`createAttendancePort(deps)`；`open(segment)`＝六面一致性校验 + 任命/计划/资格存在校验；`close(workRef, period)`。
- **依赖与层位**：`contract/src/ports/work.ts`、`store/src/records/`（`REC-WORK-06/07`）、`lifecycle/appointment.ts`（任命校验）。
- **IO 与事务**：单事务写；幂等 `(workRef, holder, period.from)`；**重试不重置**身份、禁配、资源累计、失败次数；段边界＝实质能力配置变化/授权变化/交接/暂停恢复（无边界不得新开段）。
- **错误**：六面不一致 `rejected_precondition`/`PRE`/`faces-inconsistent`；无任命 `rejected_precondition`/`PRE`/`appointment-missing`；计划不符 `rejected_version`/`EVOLVE_REJECT`/`plan-ref-mismatch`；无边界新开段 `rejected_state`/`STATE`/`segment-boundary-absent`。
- **测试与证据**：`TEST-WORK-ATTENDANCE`。
- **规模**：目标 ≤400 行。
- **迁移**：无。
- **不证明**：组织侧六面配置的正确性。

#### F-DAEMON-ENGINE-HARVEST-EVIDENCE · `engine/harvest/evidence.ts` 〔目标-新增，EVD-01，文件不存在〕

- **职责 / 非职责**：职责＝`harvest(entry)`/`verify(bundleId)`；**只收材料不判验收**（`Ok` 只表示收口完成、材料清单已定）；四要件（终态、输出非空、退出码、报告落盘）。非职责＝不判验收（`acceptance.ts`）、不判价值、不改工位。
- **内部函数与输入输出**：`createEvidenceHarvester(deps)`；`harvest(entry)` → `Result<BundleRef>`；`verify(bundleId)` → `Result<VerifyReport>`（只核已收口清单）。
- **依赖与层位**：`contract/src/ports/evidence.ts`、`store/src/records/`（`REC-EVD-01/02/03`）、文件系统（工位目录，经注入）。
- **IO 与事务**：读文件 + 单事务写；幂等 `(ticket, attempt, source)`；取消/中断 ⇒ 不留半包（清单要么整份要么无）。
- **错误**：缺件 `unverified`/`EVIDENCE`/`material-missing`；冲突 `conflict`/`EVIDENCE`/`bundle-conflict`。**不得**用「没找到」推断「没做」。
- **测试与证据**：`TEST-HARVEST-EVIDENCE`。
- **规模**：目标 ≤400 行；与 `harvest/one.ts` 分工＝one 判「本拍收不收」、evidence 定「材料清单」。
- **迁移**：无。`harvest/one.ts` 的四要件判定改为调本件，避免双份清单逻辑。
- **不证明**：真实产物形态、真机闸命令。

#### F-DAEMON-ENGINE-HARVEST-ACCEPTANCE · `engine/harvest/acceptance.ts` 〔目标-新增，EVD-02，文件不存在〕

- **职责 / 非职责**：职责＝`evaluate(req)`；四独立性维度（位置/风险/外部效果/价值）+ 四结论（接受/附条件/拒绝/依授权终止）；证据包**只含** `REC-EVD-01/02/03`；产出 `REC-EVD-04`。非职责＝不做价值（EVD-03）、不结清（WORK-07）、不收材料（EVD-01）。
- **内部函数与输入输出**：`createAcceptanceEvaluator(deps)`；`evaluate(req)` → `Result<AcceptanceRef>`；独立性检查**先于**结论。
- **依赖与层位**：`contract/src/ports/evidence.ts`、`store/src/records/`、`gate.ts`（`GateRunner` 只提供执行证据）。
- **IO 与事务**：单事务写；幂等 `(ticket, attempt, bundleId)`；已接受不重评（除 `EVD-05` 重开）。
- **错误**：独立性不成立 `rejected_authority`/`EXTERNAL_REJECT`/`independence-broken`；证据包混入 `REC-EVD-05` `rejected_precondition`/`PRE`/`bundle-out-of-scope`。**不得**把 `exit 0` 当 `accepted`。
- **测试与证据**：`TEST-HARVEST-ACCEPTANCE`。
- **规模**：目标 ≤350 行。
- **迁移**：无。
- **不证明**：验收判断的实质质量。

#### F-DAEMON-ENGINE-HARVEST-VALUE · `engine/harvest/value.ts` 〔目标-新增，EVD-03，文件不存在〕

- **职责 / 非职责**：职责＝`assess`/`get`；四本账（`artifactAccount`/`stateAccount`/`impactAccount`/`costAccount`）+ `externalFeedback`/`conclusion`/`uncertaintyAndDissent`；**验收之后**才可评估；产出 `REC-EVD-05`。非职责＝不压总分、不抵销争议、不做结清。
- **内部函数与输入输出**：`createValueAssessmentPort(deps)`；`assess(workRef, accounts)` → `Result<ValueRef>`；`get(workRef)` → `ValueAssessment | undefined`。
- **依赖与层位**：`contract/src/ports/evidence.ts`、`store/src/records/`。
- **IO 与事务**：单事务写；幂等 `(workRef, acceptanceRef, accountsDigest)`；**负值单列、争议期不抵销**。
- **错误**：未验收 `rejected_precondition`/`PRE`/`acceptance-missing`；越权 `rejected_forbidden`/`EXTERNAL_REJECT`/`value-forbidden`。
- **测试与证据**：`TEST-HARVEST-VALUE`。
- **规模**：目标 ≤300 行。
- **迁移**：无。
- **不证明**：价值口径的业务正确性。

#### F-DAEMON-ENGINE-HARVEST-REWORK · `engine/harvest/rework.ts` 〔目标-新增，EVD-04，文件不存在〕

- **职责 / 非职责**：职责＝`open`/`threshold`；`causeClass` 五值；**达阈值强制重新受理**回 `WORK-01`；产出 `REC-EVD-07`。非职责＝**不原地重派**（必须回 `reserve`）、不判验收。
- **内部函数与输入输出**：`createReworkPort(deps)`；`open(workRef, triggeredBy, causeClass)` → `Result<ReworkRef>`，达阈时调 `work/intake.reserve`；`threshold()` 只读。
- **依赖与层位**：`contract/src/ports/evidence.ts`、`store/src/records/`、`work/intake.ts`。
- **IO 与事务**：单事务写 `REC-EVD-07`；回 `reserve` 是**另一个事务**（不得把两件事塞进一个事务）；幂等 `(workRef, triggeredBy, causeClass, count)`。
- **错误**：未达阈仍开 `rejected_state`/`STATE`/`rework-below-threshold`；`causeClass` 非法 `rejected_precondition`/`PRE`/`cause-invalid`。
- **测试与证据**：`TEST-HARVEST-REWORK`（spy 断言 `reserve` 被调）。
- **规模**：目标 ≤250 行。
- **迁移**：无。
- **不证明**：返工阈值的业务标定。

#### F-DAEMON-ENGINE-HARVEST-REOPEN · `engine/harvest/reopen.ts` 〔目标-新增，EVD-05，文件不存在〕

- **职责 / 非职责**：职责＝`apply`/`scope`；新证据标准**事前设定**；申请方不得是原当事方；终态只填 `reviewAction`；**不复活终态、不改写历史**；产出 `REC-EVD-08`。非职责＝不重判验收（只开重审入口）、不重写原记录。
- **内部函数与输入输出**：`createReopenPort(deps)`；`apply(reopenedRefs, newEvidence)` → `Result<ReopenRef>`；`scope(reopenRef)` → 受影响引用清单。
- **依赖与层位**：`contract/src/ports/evidence.ts`、`store/src/records/`。
- **IO 与事务**：**只追加新记录**，不触碰原记录（append-only）；幂等 `(reopenedRefs, newEvidenceDigest)`。
- **错误**：事后改标准 `rejected_precondition`/`PRE`/`standard-changed`；原当事方申请 `rejected_authority`/`EXTERNAL_REJECT`/`party-self-apply`；越权 `rejected_forbidden`/`EXTERNAL_REJECT`/`reopen-forbidden`。
- **测试与证据**：`TEST-HARVEST-REOPEN`（原记录逐字节不变）。
- **规模**：目标 ≤250 行。
- **迁移**：无。
- **不证明**：重审裁决的实质正确性。

#### F-DAEMON-ENGINE-OBLIGATIONS-OBLIGATION · `engine/obligations/obligation.ts` 〔目标-新增，OBL-01，文件不存在〕

- **职责 / 非职责**：职责＝`instantiate`/`commit`/`link`/`overdue`；产出 `REC-OBL-01/02/03`；逾期升级产 `REC-EXC-01`。非职责＝不判例外承接（`work/exception.ts`）、不发送通知（`notify/policy.ts`）。
- **内部函数与输入输出**：`createObligationPort(deps)`；四方法各返回 `Result`；`overdue(asOf)` 只列**已 `link`** 的承诺。
- **依赖与层位**：`contract/src/ports/obligation.ts`、`store/src/records/`。
- **IO 与事务**：单事务写；幂等 `(defRef, holder, triggerRef)`、`(commitmentRef, workRef)`；升级**恰一次**（重启不重复升）。
- **错误**：未 link `rejected_state`/`STATE`/`commitment-unlinked`；重复实例化 `rejected_precondition`/`PRE`/`obligation-exists`；越权 `rejected_authority`/`EXTERNAL_REJECT`/`authority-missing`。
- **测试与证据**：`TEST-OBLIGATIONS-OBLIGATION`。
- **规模**：目标 ≤300 行。
- **迁移**：无。
- **不证明**：外部承诺履行状态。

#### F-DAEMON-ENGINE-LIFECYCLE-IDENTITY · `engine/lifecycle/identity.ts` 〔目标-新增，LIFE-01，文件不存在〕

- **职责 / 非职责**：职责＝`transition`/`state`；产出 `REC-LIFE-01`；**终态不得复活、代次不沿用**；`suspended→active` 须 as-of 点 + 外部对账 + 缺口清单 + 时效性再验证。非职责＝不判任命（LIFE-04）、不交接（LIFE-02）。
- **内部函数与输入输出**：`createIdentityLifecyclePort(deps)`；`transition(id, to, basis)` → `Result<void>`；`state(id)` → `IdentityState`。
- **依赖与层位**：`contract/src/ports/lifecycle.ts`、`store/src/records/`。
- **IO 与事务**：单事务写；幂等 `(id, to, basis)`；新代次必须新 id。
- **错误**：终态复活 `rejected_state`/`STATE`/`terminal-revive`；恢复缺项 `rejected_precondition`/`PRE`/`reactivation-incomplete`；越权 `rejected_forbidden`/`EXTERNAL_REJECT`/`lifecycle-forbidden`。
- **测试与证据**：`TEST-LIFECYCLE-IDENTITY`。
- **规模**：目标 ≤300 行。
- **迁移**：无。`evolve/` 里只有身份迁移的**局部旧实现**，不复用其语义（80-§6.9 表注）。
- **不证明**：外部人事系统一致性。

#### F-DAEMON-ENGINE-LIFECYCLE-HANDOVER · `engine/lifecycle/handover.ts` 〔目标-新增，LIFE-02，文件不存在〕

- **职责 / 非职责**：职责＝`archive`/`verify`/`lossReport`；产出 `REC-LIFE-02`，`lossReport` 产 `REC-LIFE-04`（**移交面**）；清算承接须「承接范围 + 未承接项 + 接收确认」。非职责＝不判承继（LIFE-03）、不做结清（WORK-07 只消费本件结论）。
- **内部函数与输入输出**：`createHandoverArchivePort(deps)`；`archive(scope)` → `Result<ArchiveRef>`；`verify(archiveRef)` → `Result<VerifyReport>`；`lossReport(archiveRef)` → `LossReport`。
- **依赖与层位**：`contract/src/ports/lifecycle.ts`、`store/src/records/`、文件系统（归档目录）。
- **IO 与事务**：读公司目录 + 单事务写；幂等 `(archiveRef, digest)`；缺项 ⇒ `unverified`（**不判承接成立**）。
- **错误**：承接件不全 `unverified`/`EVIDENCE`/`assumption-incomplete`；越权 `rejected_forbidden`/`EXTERNAL_REJECT`/`handover-forbidden`。
- **测试与证据**：`TEST-LIFECYCLE-HANDOVER`（含与 `WORK-07` 的「未承接不得 CLOSE」联动）。
- **规模**：目标 ≤350 行。
- **迁移**：无。**注意**：`REC-LIFE-04` 是移交面，与 76 的 `REC-LOSS-01` **不是同一条**。
- **不证明**：归档内容可完整恢复。

#### F-DAEMON-ENGINE-LIFECYCLE-SUCCESSION · `engine/lifecycle/succession.ts` 〔目标-新增，LIFE-03，文件不存在〕

- **职责 / 非职责**：职责＝`decide`/`affected`；产出 `REC-LIFE-03` + 承继面 `REC-LIFE-04`（**与 LIFE-02 各出一份，不合并**）。非职责＝不复活终态、不做交接。
- **内部函数与输入输出**：`createSuccessionPort(deps)`；`decide(succession)` → `Result<SuccessionRef>`；`affected(ref)` → 受影响引用清单（不扩面）。
- **依赖与层位**：`contract/src/ports/lifecycle.ts`、`store/src/records/`。
- **IO 与事务**：单事务写；幂等 `(ref, decision, digest)`。
- **错误**：复活终态 `rejected_forbidden`/`EXTERNAL_REJECT`/`terminal-revive`；缺依据 `rejected_precondition`/`PRE`/`basis-missing`。
- **测试与证据**：`TEST-LIFECYCLE-SUCCESSION`。
- **规模**：目标 ≤250 行。
- **迁移**：无。
- **不证明**：承继裁决的实质正确性。

#### F-DAEMON-ENGINE-LIFECYCLE-APPOINTMENT · `engine/lifecycle/appointment.ts` 〔目标-新增，LIFE-04，文件不存在〕

- **职责 / 非职责**：职责＝`appoint`/`current`/`end(id, reason)`；产出 `REC-LIFE-05`；**无任命记录不得承担工作**。非职责＝不判资格（WORK-08）、不判能力、不判职级。
- **内部函数与输入输出**：`createAppointmentPort(deps)`；`appoint(...)`；`current(positionRef)`；`end(id, reason)`。
- **依赖与层位**：`contract/src/ports/lifecycle.ts`、`store/src/records/`。
- **IO 与事务**：单事务写；幂等 `(positionRef, subject, term.from)`。
- **错误**：`end` 缺 `reason` `rejected_precondition`/`PRE`/`reason-missing`；`id` 未登记 `rejected_precondition`/`PRE`/`appointment-unknown`（**不得**静默返回空任命）；禁配 `rejected_forbidden`/`EXTERNAL_REJECT`/`appointment-incompatible`；越权 `rejected_authority`/`EXTERNAL_REJECT`/`authority-missing`。
- **测试与证据**：`TEST-LIFECYCLE-APPOINTMENT`。
- **规模**：目标 ≤300 行。
- **迁移**：无。
- **不证明**：任命流程的组织侧合法性。

#### F-DAEMON-ENGINE-MEMORY-POLICY · `engine/memory/policy.ts` 〔目标-新增，MEM-01 策略面，文件不存在〕

- **职责 / 非职责**：职责＝记忆**策略**编排：层选择、访问理由必填、处置五操作（修正 / 清除 / 继承 / 转层 / 封存）编序、继承与转层的接收确认。非职责＝不实现存储/加密/索引（`store/src/memory/`）、不定义层（`contract`）、不删原文。
- **内部函数与输入输出**：`createMemoryPolicy(deps)`；`write(layer, subject, content, sourceRef)`、`read(q, access)`（`q` **必带层**、`access` **必带理由**）、`dispose(op, dispositionId)`；`REC-MEM-02/03` 由 `store` 侧写，本件只保证前置（层合法、理由非空、确认齐、不删原文）。
- **依赖与层位**：`contract/src/ports/memory.ts`、`store/src/memory/`（实现，**不存在**）、`store/src/records/`。
- **IO 与事务**：一律经 store 端口；本件**不拼 SQL、不建表**；幂等 `(layer, subject, sourceRef)`、`dispositionId`。
- **错误**：越层 `rejected_forbidden`/`EXTERNAL_REJECT`/`layer-cross`；缺访问理由 `rejected_precondition`/`PRE`/`access-reason-missing`；缺接收确认 `rejected_precondition`/`PRE`/`receiver-ack-missing`；缺 `residue_statement` 同前。
- **测试与证据**：`TEST-MEMORY-POLICY`（`MemoryStore` 桩，不测 SQL）。
- **规模**：目标 ≤250 行。
- **迁移**：无。**四层在 `store` 不合并**由 `store` 的 schema 保证，本件只做策略，不承担机制。
- **不证明**：访问控制强度、加密与持久化。

#### F-DAEMON-ENGINE-OBSERVE-VIEWS · `engine/observe/views.ts` 〔目标-新增，OBS-01，文件不存在〕

- **职责 / 非职责**：职责＝`project(view, cursor?)`/`faults(since)`；六态 `observed/derived/unknown/stale/conflict/gap`；11 个观察面；投影带**来源游标 + 规则版本**；**无 `Result` 通道**。非职责＝不写投影表（`store` 的 `RecordProjection` 是只读视图）、不渲染面板、不写事实源。
- **内部函数与输入输出**：`createObservationProjector(deps)`；`project(view, cursor?)` → `ObservationView`（六态 + 游标 + 规则版本）；`faults(since)` → 缺口清单。
- **依赖与层位**：`contract/src/ports/observation.ts`、`store` 的只读面（`RecordReader`/`ReadOnlyLedger`）。
- **IO 与事务**：只读查询、**零写**；来源不可达 ⇒ `state='gap'` + `REC-OBS-02`（记录由 store 侧写，本件只报缺口）。
- **错误**：**无 `Result`**——不可用一律 `state='gap'`；**未知不得显示为 0/空/绿**。
- **测试与证据**：`TEST-OBSERVE-VIEWS`。
- **规模**：目标 ≤400 行（11 面）。
- **迁移**：无。
- **不证明**：面板呈现、跨来源一致性。

#### F-DAEMON-ENGINE-NOTIFY-POLICY · `engine/notify/policy.ts` 〔目标-新增，NOTI-01 策略面，文件不存在〕

- **职责 / 非职责**：职责＝通知**策略**：路由/去重/升级的编排，通道交 `matrix`（端口注入）。非职责＝不定义 `NotificationEnvelope` 字段（U81-16 待裁）、不实现通道、**不把通知当决定**。
- **内部函数与输入输出**：`createNotifyPolicy(deps)`；`route(notification)` → `NotifySendReport`；去重沿用 `notify/dedup.ts` 现有语义，**不新造键**。
- **依赖与层位**：`contract` 的 `Notifier`/`NotificationEnvelope`、`notify/{broadcast,dedup,route,relay}.ts`。
- **IO**：只经 `Notifier` 端口；失败**如实**进 `NotifySendReport`（不吞成成功）；`from` 保持 `string`。
- **错误**：通道不可用 `unavailable`/`STALL`/`channel-down`；越权 `rejected_forbidden`/`EXTERNAL_REJECT`/`notify-forbidden`。
- **测试与证据**：`TEST-NOTIFY-POLICY`。
- **规模**：目标 ≤250 行。
- **迁移**：无（`notify/` 目标 5 件：现有 4 + 本件）。
- **不证明**：真实送达。

#### F-DAEMON-ENGINE-TOOLS-EFFECT-GATEWAY · `engine/tools/effect-gateway.ts` 〔目标-新增，EFF-01，文件不存在〕

- **ID 边界（不得冒充）**：本 ID 是**文件级**ID。`81-files/06-gateway.md` §四只保留同一路径的行为契约；本卷负责文件归属、函数表、依赖层位与装配边界，不分配另一个行为 ID。
- **职责 / 非职责**：职责＝在内核 `gateway.gateWrite` 之外做权源引用解析、效果准入、fence 校验、**效果尝试先行**、回执与未知对账；导出 `createEffectGateway(deps)`。非职责＝不签发凭据/不验签（内核）、不判定授权四态、不判风险与验收、不直接做网络/文件 IO（由内部 `EffectWriter` 注入）、不直接写库（只经记录端口）、不处理六个工具动词中的读操作或本地证据写。
- **内部函数与输入输出**：
  - 导出工厂与 `apply(effect)`；`EffectGateway`/`EffectRequest`/`EffectOutcome` 只从 `contract` 再导出。`EffectDescriptor.action` 为九个 `ControlEffectAction`；`EffectAction` 并集只用于凭据 scope。`comment`/`article` 先由工具路由翻译成 `comments.add`/`kb.upsert`，其余四种工具动词不走本端口。
  - 内部（不导出）：`admitAuthority`、`checkCredentialScope`、`checkFence`、`findReceipt`、`recordAttempt`、`writeReceipt`、`registerUnknown`、`toOutcome`、`mapKernelReject`。
  - `EffectWriter` 是 daemon 内部注入面（不是公共端口）：`write({action,args,signed,target,idempotencyKey})` 返回 `Result<EffectWriteResult, ClassifiedError>`；`committed` 必带原生外部引用与执行后版本，缺失/void/仅排队只能回 `unknown`。实现归既有 `engine/tools/gated-platform.ts`，该文件不再重复验签。
  - `EffectError = ClassifiedError & { partialItems?: readonly EffectPartialItem[] }`；`failure='partial'` 时 `applied` 必带回执、`unknown` 必带未知引用、`failed` 必带分类错误。
  - `deps`：`kernel`、`credentialBroker`、`credentials`、`grants`、`lease`、`writer`（内部 `EffectWriter`）、`receipts`（REC-01）、`reader`（REC-02）、`reconcile`（REC-06）、`clock`。除内部 writer 外均与 80 已有端口一一对应；不得另造公共端口或把 token 放进请求、帧、日志、记录。
- **顺序与恢复**：回执先查 → 权源/凭据/fence 与内核 → **追加 `REC-EVT-01` 效果尝试**（`event_kind='动作'`、`source_kind='操作记录'`，同一 `idempotencyKey`）→ 只对 `deduped=false` 调 writer → committed 先写 `REC-RCP-01` 再 `applied`，unknown/回执失败先写 `REC-EVT-03` 再 `unknown`。`REC-EVT-03` 经 `lineage.parentRefs` 链 attempt；意图域仍必须有 `intentRef`。同键并发由记录唯一索引收敛；已有 attempt 无结局时只能对账，不得二次调用平台。重启由 REC-06 扫描未完成 attempt，登记未知并冻结该键；**不承诺外部物理效果恰好一次**。
- **依赖与层位**：`engine` 层子域 `tools/`（既有子域，2 → 3 件）。跨包边只有 `daemon → gateway` 与 `daemon → contract`；禁止直连 `store`、引 `panel`/`api`/具体平台包、`node:child_process`、`process.env`；`gateWrite` 保持同步，writer 的 IO 不进入 gateway 包。
- **部分效果与错误**：每个 partial 项有独立幂等键、attempt 和回执/未知；无外部事务证明不得宣称多动作原子。`Err` 只用于确定未产生效果的拒绝或记录不可用；已发送后结果不明走 `Ok(unknown)`，不得让上层直接重试。`rejected`/`partial` 不是成功 status。
- **测试与证据**：`F-DAEMON-ENGINE-TEST-TOOLS-EFFECT-GATEWAY`（与 06 §四同源）；fake writer 计数、真内核 HMAC；覆盖 attempt 先行、同键并发零第二次调用、崩溃后只登记未知、committed 证据不足不得报 applied、平台回执/迟到的对账。证据=attempt + `REC-RCP-01`/`REC-EVT-03` + 对账批次。**本件未实现、零运行证据**。
- **规模与迁移**：目标 ≤300 行；测试 ≤420 行。先落 contract 的 `Result`/`failure`/`effects.ts` 与 store 的幂等写，再实现本件与 fake 测试；17 将 `gated-platform` 迁为只负责平台调用与回执核验的内部 writer，迁移期同一事实域只能选一个写口，禁止双闸双写；这些步骤均未实施。
- **不证明**：真实 store 事务与 CAS、跨进程围栏、真实平台回执、真实对账、daemon 装配顺序（归 17）；文件级设计不证明效果面已实现（U81-24）。

#### C 组：三条横切纪律（对 A/B 两组同效，违反即判负）

1. **资源只在三处消费，不另造写口**：`work/readiness.ts` 读 `core/src/resources/` 的 `baseline(req)`；`work/plan.ts` 写 `resource_reservations` 并在**同事务**更新 `store/src/resources/` 的投影；`work/settlement.ts` 只读资源项做结清材料。RES-01 **无 `reserve`/`actual`/`release`**，也**无 Qid 回执**：预留就是 `REC-WORK-05.resource_reservations`、实际是 `REC-EVD-01/05`、释放是 `REC-EVD-06`。投影名 **`resourceLedger`**（物理表 `resource_ledger`）已由 80-§6.3 登记为**目标第 18 个投影名**，随 `MIG-01` 建表——**名字已登记、实现未做**（U81-23）。
2. **记忆的机制在 store、策略在 engine**：四层（个人 / 出工 / 岗位 / 组织）不合并由 `store/src/memory/` 的 schema 保证；`engine/memory/policy.ts` 只做层选择、理由必填、处置编序。**不得**在引擎里建记忆表或写记忆行。
3. **观察只读，不写投影**：`engine/observe/views.ts` 只调 `store` 的 `RecordProjection`/只读台账，**不建投影表、不写 `REC-OBS-01`**；来源不可达时以 `gap` 呈现，缺口记录由 store 侧写。

**本节总体判负**：把本节的 39 个路径当成「能力已成立」（全部文件不存在、零运行证据）；在 `engine` 里定义端口类型、写纯求值、拼 SQL 或建投影表；给这 39 件编造 `path:line` 锚；用通配 ID（如 `F-DAEMON-ENGINE-WORK-*`）代替逐件条目；用 `EffectGateway` 行为契约 代替 `F-DAEMON-ENGINE-TOOLS-EFFECT-GATEWAY`。

---

## 五、记录、事件与台账触点

### 5.1 唯一写口

引擎写台账走**两个**入口，均在 `engine.ts` 内闭合：

1. **事件**：`append(evt, tickEvents)`（`engine.ts:781`）——先 `ledger.appendEvent(evt)`，仅当 `r.appended` 为真才计入本拍汇报。**这是 `events` 的唯一写口**；其余 67 件的任何事件都必须经由此函数（`cost-close`/`merge-run`/`judge` 等把 `makeEvent` 作为回调注入即为此约束的机制化）。
2. **非事件行**：预算行、工时行、投影行、kv 由各域件直接调 `Ledger` 方法（见 5.3），但**写法受"唯一写入者"约束**：写者恒为 daemon 单进程，`panel`/`api`/CLI 不得直写（80-§8.1；`packages/panel/src/external/server.ts:491` 是待迁移违例，归 80-§9）。

**第三个写面不在引擎里（目标，须与上面分清）**：

| 记录 | 唯一写口 | 引擎的关系 |
|---|---|---|
| `REC-WORK-01` 意图信封 | `WorkIntake.reserve`（`engine/work/intake.ts`，`F-DAEMON-ENGINE-WORK-INTAKE`） | 引擎**不写**；`ingest` 只入内存队列、不产记录 |
| `REC-WORK-02` 受理结论 | `WorkIntake.intake`（同上） | 引擎**只调**（`EngineDeps.workIntake?.intake`），不自己写 |
| `intent_receipts` 投影 | **store 自有 projection hook**（与 `REC-WORK-01/02/03` 追加**同一事务**）+ 内存快照 | 引擎**不持、不刷**；`refresh` 是唯一修复入口（读台账、可失败）；`get` 只读已提交快照，**不作**入队/重放决策 |
| `REC-WORK-04` 开工五门 | `ReadinessGate.judge`（`engine/work/readiness.ts`）；判据纯求值在 `core/src/work-readiness.ts` | 引擎装配输入并写记录；**判据不在引擎** |
| `resource_ledger` 投影（投影名 **`resourceLedger`**） | `store/src/resources/` 的 projection hook（由 `work/plan.ts` 同事务触发）；80-§6.3 已登记为**目标第 18 个投影名**，随 `MIG-01` 建表 | 引擎**不写投影**；预留只出现在 `REC-WORK-05.resource_reservations`；本卷只引用名字，不实现表 |

**B 组端口的唯一写口（一条一行；不复制字段表）**：

| 记录族 | 唯一写口（端口 → 文件） |
|---|---|
| `REC-CMD-01/02` | CMD-01 `CommandIntake` → `engine/decision/intake.ts` |
| `REC-DEC-01` | DEC-01 `DecisionPort` → `engine/decision/decide-record.ts` |
| `REC-WORK-01/02` | WORK-01 `WorkIntake` → `engine/work/intake.ts` |
| `REC-WORK-03` | WORK-02 `ContractPort` → `engine/work/contract.ts` |
| `REC-WORK-04` | WORK-03 `ReadinessGate` → `engine/work/readiness.ts` |
| `REC-WORK-05` | WORK-04 `ExecutionPlanPort` → `engine/work/plan.ts` |
| `REC-WORK-09` | WORK-05 `WorkLifecycle` → `engine/work/lifecycle.ts` |
| `REC-EXC-*` | WORK-06 `ExceptionPort` → `engine/work/exception.ts` |
| `REC-EVD-06` | WORK-07 `SettlementPort` → `engine/work/settlement.ts` |
| `REC-WORK-08` | WORK-08 `QualificationPort` → `engine/work/qualification.ts` |
| `REC-WORK-11` | WORK-09 `RiskClassifier` → `engine/work/risk.ts` |
| `REC-WORK-10` | WORK-10 `AssignmentPort` → `engine/work/assignment.ts` |
| `REC-WORK-06/07` | WORK-11 `AttendancePort` → `engine/work/attendance.ts` |
| `REC-EVD-01/02/03` | EVD-01 `EvidenceHarvester` → `engine/harvest/evidence.ts` |
| `REC-EVD-04` | EVD-02 `AcceptanceEvaluator` → `engine/harvest/acceptance.ts` |
| `REC-EVD-05` | EVD-03 `ValueAssessmentPort` → `engine/harvest/value.ts` |
| `REC-EVD-07` | EVD-04 `ReworkPort` → `engine/harvest/rework.ts` |
| `REC-EVD-08` | EVD-05 `ReopenPort` → `engine/harvest/reopen.ts` |
| `REC-OBL-01/02/03` | OBL-01 `ObligationPort` → `engine/obligations/obligation.ts` |
| `REC-LIFE-01` | LIFE-01 `IdentityLifecyclePort` → `engine/lifecycle/identity.ts` |
| `REC-LIFE-02` + 移交面 `REC-LIFE-04` | LIFE-02 `HandoverArchivePort` → `engine/lifecycle/handover.ts` |
| `REC-LIFE-03` + 承继面 `REC-LIFE-04` | LIFE-03 `SuccessionPort` → `engine/lifecycle/succession.ts` |
| `REC-LIFE-05` | LIFE-04 `AppointmentPort` → `engine/lifecycle/appointment.ts` |
| `REC-MEM-02/03` | MEM-01 `MemoryStore`（**写口在 `store/src/memory/`**）→ 策略只在 `engine/memory/policy.ts` |
| `REC-OBS-01/02` | OBS-01（**写口在 `store` 的 `RecordProjection`**）→ 只读视图只在 `engine/observe/views.ts` |
| 通知（无自有 `REC-*`） | NOTI-01 `Notifier`（通道在 `matrix`）+ 策略 `engine/notify/policy.ts` |
| `REC-RCP-01` / `REC-EVT-03` | EFF-01 `EffectGateway` **不直接写**：`REC-01 RecordWriter.append` / `REC-06 ReconciliationPort.registerUnknown` 是写口，`engine/tools/effect-gateway.ts` 只编排（先落记录再返回） |

**判负**：把 `ingest` 当受理；由引擎写 `REC-WORK-01/02`；让 `TickReport` 的 `intents` 计数被读成「已受理」；用 `IntentReceiptStore.get` 判入队/重放；在引擎里建 `memory`/`resources`/`intent_receipts` 的投影表；把投影名 `resourceLedger` 写成物理表名 `resource_ledger` 之外的别名（两名缺一不可）。

**只读面（目标，供 panel/api 使用，引擎不碰）**：`RecordReader.query`/`ReadOnlyLedger.query` 返回 `RecordPage = { items, nextCursor }`；`openLedgerReadonly({ path, expectedSchemaVersion, readOnly:true, queryOnly:true })` 不得跑 DDL、不得写 PRAGMA（`query_only` 除外），库缺 ⇒ `Err(unavailable/STALL/db-missing)`，schema 旧 ⇒ `rejected_version/EVOLVE_REJECT/schema-behind`，schema 新 ⇒ `schema-ahead`。

**事务回执（目标）**：`TxReceipt.status` 由 `commit` 只产生 `committed|unknown`；`abort` 返回 `TxReceipt(status:'aborted')`；`unknown` 只由 `receipt(txId)` 或 `REC-06` 对账消解——**不得**把「提交超时且结果未知」改写为已知失败。**迁移计划（目标）**：`MigrationPlan.dryRun:{required:true,reportArtifactRef?}`、`rollback:{possible,snapshotArtifactRef?}`（artifact 是 `string` 非 qid）、`MigrationActionKind='map'|'rewrite'|'rekey'|'archive'|'verify'`、`planDigest` 不含 artifact 引用；干跑与实跑摘要不符 ⇒ `conflict`；不可逆且无快照 ⇒ `rejected_forbidden`。以上三者均属 `store`/装配体，**引擎不实现也不调用**（本域只消费 `Ledger`）。

### 5.2 事件名清单（实测，`grep -rhoE "'[A-Z][A-Z0-9]*(_[A-Z0-9]+)+'"`）

| 事件名 | 生产者（实测锚） | 语义（一句话） | 链路位置 |
|---|---|---|---|
| `DISPATCH` | `engine.ts`（派发相位） | 派发已落账（含 intentKey、wait 锚、档位锚） | 链首，亦作意图消费标记 |
| `GATE_PASS` | `engine.ts` 收割收口；`merge/merge-run.ts` | 四要件通过 | 链中；**不是**验收/结清 |
| `GATE_FAIL` | `engine.ts` 收割失败收口；`merge/merge-run.ts` | 四要件未过（含 `WORKER_DEAD` 等） | 失败链 |
| `QA_PASS` / `QA_BACK` | `engine.ts` | 验收位通过 / 打回 | 标准链 `DISPATCH→GATE_PASS→QA_PASS→MERGE→CLOSE`（`test/engine/starvation-revival.test.ts:141` 等四处同源） |
| `MERGE` | `merge/merge-run.ts:539`、`merge/merge-fallback.ts:34` | 合并完成（真单刀或模拟轨） | 链中 |
| `CLOSE` | `engine.ts`（回收相位） | 终态收口 | 链尾 |
| `HEARTBEAT` | `engine.ts:2133` 附近 | 零动作拍心跳（`mutations===0` 才写） | 拍边界 |
| `STALL` | `engine.ts` | 在途超时告警（达阈触发响置） | 失败链 |
| `ESCALATE` | `engine.ts:1451`（熔断/STALL 收口）、`:1638`、`hrsync/hrsync.ts:302`、`merge/merge-run.ts:508`、`merge/merge-fallback.ts:49`、`jobs-sources.ts:382` | 升级（熔断、人事失败、合并冲突…） | 失败链 |
| `WAIT_APPROVAL` | `engine.ts` | 派发前置呈批 | 链中 |
| `RESUME` | `engine.ts` | 复活一等的语义（DEV-42②） | 复活链 |
| `HARVEST_INCOMPLETE` / `HARVEST_INVALID` / `HARVEST_DENIED` / `REPORT_MISSING` | `jobs/harvest-recon.ts` | 收账对账四态 | 收账面 |
| `SENTINEL_MISSING` / `LATE_FIRST_RUN` / `JOB_STALE` | `jobs/*`、`jobs-sources.ts` | 岗哨兵/新鲜度四态 | 哨兵面 |
| `FOREIGN_KNOWN` | `sentinel/*`、`engine.ts` | 州表白名单观察级（127-C） | 哨兵面 |
| `ORG_UPGRADE` | `hrsync/hrsync.ts:255`（人事对账单首开） | 组织/任职变更留痕 | 人事面 |
| `SELF_EVAL` | **无生产者**；仅 `jobs-sources.ts:226` 的「应答应白名单」子集 | 23 冻结事件名之一 | 边界面 |
| `REPORT_COST_CLOSE` | `cost-close/close.ts` | 日终收口报告事件 | 收口面 |
| `DAILY_ALARM` | `cost-close/close.ts` | 日终告警（降级/对账差） | 收口面 |
| `JUDGE_OK` / `JUDGE_FALLBACK` | `judge/events.ts` | 判断采纳 / 降级（judge 唯一台账锚） | 判读面 |

**两处 `CIRCUIT_BREAK` / `EXTERNAL_*` 的口径更正（实测）**：

- `CIRCUIT_BREAK` **不是事件名**。熔断时引擎发的是 `ESCALATE`，note 以 `CIRCUIT_BREAK：` 开头（`engine.ts:1448-1453`，note 形状被 panel 的 `BREAKER_NOTE_PATTERN` 全锚定解析）。但 `notify/route.ts:83` 有 `case 'CIRCUIT_BREAK'`、`evolve/gray.ts:93` 把 `CIRCUIT_BREAK` 列入 `INCIDENT_EVENT_NAMES`——两处期待的事件名当前**无生产者**，属路由死支/口径漂移（U81-14）。
- `EXTERNAL_REJECT` 是 `tools/gated-platform.ts:105` 的**错误 category**（`ClassifiedError`），不是事件；`EXTERNAL_RATE_LIMIT` 是 `fakes.ts:410` 的 fake `errorCode`（GLM 429 复刻），也不是事件。二者都不入事件表。

**纪律**：新增事件名＝扩 `EventRecord['event']` 的取值域，必须先在 77 的事件族登记；本域不得自造未登记名（`EventRecord['event']` 类型即闸，`engine.ts:787`）。

### 5.3 台账触点（实测：`ledger.<method>(` 调用计数）

| 面 | 方法（实测出现） | 主要调用方 |
|---|---|---|
| 事件 | `appendEvent`(8)、`queryEvents`(6) | `engine.ts`、`sentinel/events-index.ts`、`judge`、`merge` |
| 工时 | `insertWorkRecord`(2)、`endWorkRecord`(8)、`getWorkRecord`(1)、`listWorkRecords`(4) | `engine.ts`、`harvest/inflight-takeover.ts`、`merge/merge-run.ts` |
| 预算 | `appendBudget`(8)、`queryBudgets`(5)、`listBudgets`(2) | `budget-gate.ts`、`judge/accounts.ts`、`cost-guard/fold.ts` |
| 用量/成本 | `listUsageDaily`(3)、`upsertUsageDaily`(1)、`replaceUsageDaily`(1)、`listCostDaily`(5)、`appendCostDaily`(2)、`listClosedCostDates`(1) | `cost-guard/usage.ts`、`cost-close/close.ts` |
| 价目 | `appendPriceSnapshot`(1)、`listPriceSnapshots`(3) | `pricing/pricing.ts`、`cost-guard/fold.ts` |
| 岗/岗单 | `getJob`(9)、`upsertJob`(2)、`removeJob`(2)、`listJobs`(1)、`dueJobs`(1)、`markRan`(1) | `scheduler.ts`、`jobs-sources.ts`、`jobs/freshness.ts` |
| 待办投影 | `listTodoQueue`(2)、`replaceTodoQueue`(1) | `todoqueue/queue.ts`（投影）、`engine.ts:2161` |
| 镜像 | `upsertTicketMirror`(1)、`getTicketMirror`(2)、`listTicketMirrors`(2) | `engine.ts`（`syncMirror:826`） |
| 人事 | `enqueueHrSync`、`claimHrSync`、`completeHrSync`、`failHrSync`、`listHrSyncPending`、`appendPersonnelEvent`、`setPersonStatus`（各 1） | `hrsync/hrsync.ts` |
| 报表 | `insertReport`(1) | `cost-close/close.ts` |
| 等待时延 | `recentDispatchWaitsMs`(1) | `todoqueue/queue.ts`（scheduleToStart 实测） |
| kv | `kvGet`(7)、`kvSet`(7) | 游标/拍序/收口日锚/定价日锚/人事批次 |

**投影可重建**：`usage_daily`、`todo_queue`、`ticket_mirror`、`cost_daily`、`intent_receipts` 都是投影（80-§8；77 的观察协议）。判据＝「write-through 与 rebuild 同结果」（`cost-guard/usage.ts:66` 的 `rebuildUsageDailyProjection` 即该判据的实现面）。

**`intent_receipts`（目标，仓内无此表）**：唯一键 `(company, source, kind, ticket ?? dedupKey)`；由 `REC-WORK-01`/`REC-WORK-02`/`REC-EVT-03` 导出；**不写事实**、不持 `attempts`、`gap` 非空即「投影不完整」（不得读成无异常）。重建入口 `IntentReceiptStore.rebuild`（§4.10.4）。

**`ProjectionName`（80 已定，本域只读）**：`TargetTableProjectionName | 'observation'`，其中 `TargetTableProjectionName = TableProjectionName | 'resourceLedger'`（80-§6.3：现状 17 名 + 目标第 18 名 `resourceLedger` ↔ 物理表 `resource_ledger`，随 `MIG-01` 建表）；表名集合含 `intentReceipts`；`observation` 返回 `{ kind:'observation', state }` 而**不带 rows**（观察态不是行集，勿当表查）。

**引擎不建表、不迁移**：DDL/migration 唯一归 `store`；本域只通过 `Ledger` 方法读写上面这些行。表名/列名进入本卷时只作「消费面引用」，字段以 76/77 为准。

---

## 六、事务、幂等与恢复

### 6.1 六段写协议在本域的落点

80-§8.3 定的六段＝`prepare / reserve / CAS / execute / receipt / finalize`。本域可见锚：

| 段 | 本域落点 |
|---|---|
| prepare | 相位 2 `decide` 产出动作（`engine.ts:1680` 段）＋ 预算估算（`budget-gate.ts:106`） |
| reserve | 预算预留先落账（`budget-gate.ts:176`；20-§六.8「不落即不派」） |
| CAS | 平台状态迁移与台账行版本（`FlowPlatform` + `Ledger` 各自保证；本域不自行实现） |
| execute | `executeDispatch:880` → adapter `launch` |
| receipt | `harvestOne:1146` / `finalizeHarvest:1224`（回执＝终态事件 + 非空输出 + REPORT） |
| finalize | `endWorkRecord` + 相位 6 `CLOSE`（`engine.ts:2106` 段） |

**「reserve」在本卷是两个不同的东西，必须分开写**：

| # | 名称 | 位置 | 写的记录 | 失败语义 |
|---|---|---|---|---|
| A | **意图 reserve** | `WorkIntake.reserve`，被 `IntentIngress.submit` 调（**引擎不参与**） | `REC-WORK-01`（不可变信封），一个写事务内查重 | 同键同摘要 ⇒ `duplicate:true` 且返回既有 `intentRef`；同键不同摘要 ⇒ `Err(rejected_idempotency)` |
| B | **派发 reserve** | `budget-gate.ts:176`，相位 3 前 | `budgets` 双行（issue + person）+ 可能的 refusal 行 | 不落即不派（`EngineDeps` 无价目表则态 B 降级）；GATE_FAIL 不返还（成功交付才记账） |

两者**没有**先后因果：A 发生在 HTTP 入口，B 发生在引擎拍内。把 A 写成「预算预留」或把 B 写成「意图去重」都是判负级混淆。

**判负**：在台账事务内 `await` 外部 IO（长 IO 不持写事务，80-§8.2）；跨段「补偿式回滚」（本域只有正向收敛与显式失败）。

### 6.2 幂等键一览（本域自有）

| 幂等对象 | 键 | 实现锚 |
|---|---|---|
| 意图消费 | `intentKey`（`DISPATCH` 事件 note 派生） | `engine.ts:1897`（`seenIntentKeys`） |
| 意图信封（A 面，非引擎） | `(company, source, kind, ticket ?? dedupKey)` | `WorkIntake.reserve`（§4.10.1/§4.10.4） |
| 回执投影 | 同上唯一键；同键多条取 `receivedAt` 最大 | `IntentReceiptStore`（§4.10.4） |
| 事件本身 | `(ticket, attempt, event)` 去重 | `ledger.appendEvent` 返回 `appended`（`engine.ts:781`） |
| 拍序 | `tick.seq` | `engine.ts:702`、`:752`、`:1572` |
| 活动游标 | `activity.cursor` | `engine.ts:701`、`:1583`、`:1611` |
| 日终收口 | `cost_close_last_date` | `cost-close/close.ts` |
| 定价守夜 | `pricing.stale_check_date` | `pricing/pricing.ts:41` |
| 人事批次 | `hr.batch.<id>`（票据）/`hr.batch.<id>.summary`（摘要）/`hr.matrix.pass.<username>` | `hrsync/hrsync.ts:33/35/37` |
| 拆单 | `splitChildKey` / `splitFilingKey` | `split/directive.ts:144/149` |
| 判读调用 | 按址 scope + 日 scope（冒号分隔） | `judge/accounts.ts:60/65` |
| 合并租约 | `mergeLeaseKey(company,targetBranch)` | `merge/merge-lease.ts:20` |
| 收账补收 | 内容哈希 | `jobs/harvest-recon.ts` |
| 岗哨兵 | `sha256(company:job:run_at)` | `jobs/sentinel.ts:37` |

### 6.3 恢复：五点现状与目标八点

- **现状 5 点**（`crash-points.ts:39`）：`dispatch-reserved`、`dispatch-launched`、`harvest-verdict`、`heartbeat-write`、`shutdown-drain`。窗口语义与重启后现状见 80-§8.7 表（本域只实现点位与 `crashHook`，恢复动作在相位 1/2 与 `inflight-takeover`）。
- **目标 8 点**（80-§8.7 新增表：`import-applied`、`activation-cas`、`effect-sent`、`effect-receipt`、`memory-disposition-written`、`settlement-written`、`projection-partial`、`lease-acquired`）：**当前未实现**（`crash-points.ts` 只有 5 个），登记 U81-12。新增点必须默认零行为，且与 5 点同形扩写（80-§8.7 结论）。
- **意图面的**两个**崩溃窗口（目标）**（其余靠启动序 `schema 闸 → receipts.rebuild() → replayQueued() → 装配 API` 收口；`IntentIngressInternal` 只由 `buildServeRuntime` 持有）：
  1. `reserve` 已提交、`engine.ingest` 未执行 ⇒ 重启重放 `status='queued'`；记录**不重写**（`REC-WORK-01` 已在）。
  2. `ingest` 后、相位 2 `intake` 前 ⇒ 回执停 `queued`，靠重放 + 相位 2 补 `REC-WORK-02`；**不得**伪造 `decided`。

  「`intake` 已写、投影未刷」**不再是窗口**：表投影由 store 自有 hook 在**同一事务**写入（80-§6.6 规则 7），崩溃只可能落在「记录与投影同时提交」或「同时未提交」两侧。`rebuild()` 因此是**启动期对账**（把投影表校正到记录现状），不是崩溃补救；失败即拒启动（规则 9）。
- **不重放的两种**：`status='unknown'`（须先对账）；`gap` 含 `'unknown-link-missing'`（链路缺，重放只会制造第二份事实）。
- **三条不变量**（80-§8.8）：不重复外部副作用（回执查询）、不丢终态（append-only）、不假绿（恢复期未知＝`unknown`/`gap`/`conflict`）。本域的对应闸：`append` 去重、`CLOSE` 为终态不撤、`verifySidecarSentinel` 的 `unreadable` 态、`harvest-recon` 的不代写。
- **接管**：`takeOverRunningWorkRecords`（`harvest/inflight-takeover.ts:38`）是启动例行，**不是第八相位**；它只收口 `work_records` 的 `running` 行，不补意图、不补回执。

---

## 七、失败面与分类

### 7.1 现状（〔事实〕）

- 事件层面的失败有名字（`GATE_FAIL`/`STALL`/`ESCALATE`/`HARVEST_*`/`DAILY_ALARM`…，见 5.2）；
- **聚合层面的失败只有字符串**：`engine.ts` 内 `errors.push(` 实测 **23 处**（`:1293`、`:1613`、`:1617`、`:1654`、`:1673` …），`TickReport.errors` 是 `readonly string[]`（`tick-report/types.ts:145`）。这**不满足** 80-§7.1「错误须带 category/subcause」。
- 契约件（payload checker）返回 `payload | string` 的二分形状（`intents/taxonomy.ts:59`、`:110`、`:146`；`intents/relay-resume.ts:70`、`:93`；`intents/escalate.ts:59`），拒绝理由也是裸字符串。
- **没有一处**已产出 `ClassifiedError`；`contract/src/ports/kernel.ts:85-99` 的 `ClassifiedError` 现为 `{category, subcause, detail?}`——**缺 `failure`**，是目标态要补的第一件事。

### 7.2 目标分类（两轴，全部未实现；待 82 登记探针）

`ClassifiedError = { failure: FailureClass; category: ErrorCategory; subcause: string; detail?: string }`。**两条轴不许混**：`failure` 是 77-§11.1 的 14 类**处置**轴（怎么处理），`category` 是 11 类**观测**轴（怎么记账）。**`Err` 可达的 `category` 只有 6 个**：`CONFIG_INVALID`/`EVOLVE_REJECT`/`EXTERNAL_REJECT`/`STALL`/`MERGE_CONFLICT`/`NO_LANE`；`failure` 的缺省映射见 80-§5.7（`rejected_precondition→CONFIG_INVALID`；`rejected_authority/forbidden/state/idempotency→EXTERNAL_REJECT`，仅显式 lane 上下文可 `NO_LANE`；`rejected_version/unsupported/unverified→EVOLVE_REJECT`；`unavailable/partial/timeout/cancelled/degraded→STALL`；`conflict→EXTERNAL_REJECT`，合并域用 `MERGE_CONFLICT`）。构造期固定：`configInvalid = rejected_precondition + CONFIG_INVALID`。

| 本域失败面 | `failure` | `category` | `subcause`（示例，机器可读） |
|---|---|---|---|
| 采集相位失败（activity/issues/镜像） | `unavailable` | `STALL` | `collect-unavailable` |
| 采集部分成功（有页失败、其余继续） | `degraded` | `STALL` | `collect-partial` |
| 预算拒派（票帽/人帽/硬线） | `rejected_precondition` | `CONFIG_INVALID` | `budget-over-ticket-cap` / `budget-over-person-cap` / `budget-hard-line` |
| 泳道占用 / 人闸顺延 / 每拍上限 | `degraded` | `STALL` | `lane-busy` / `person-serial` / `tick-limit`（顺延，非失败） |
| GATE_FAIL（四要件缺） | `unverified` | `EVOLVE_REJECT` | `gate-missing-<要件>`（`terminal`/`output`/`report`/`exit`） |
| `HARVEST_DENIED`（权限不可达） | `rejected_forbidden` | `EXTERNAL_REJECT` | `harvest-denied` |
| `HARVEST_INCOMPLETE`（部分产物） | `partial` | `STALL` | `harvest-incomplete` |
| `MERGE_CONFLICT` / 闸门红 | `conflict` | `MERGE_CONFLICT` | `merge-conflict` / `gate-red` |
| STALL 超时 / judge 调用超时 / 闸门 124 | `timeout` | `STALL` | `stall-timeout` / `judge-timeout` / `gate-timeout` |
| 断路器打开（拒绝派发） | `unavailable` | `STALL` | `breaker-open` |
| 流外态 / 未知流 | `rejected_state` | `NO_LANE`（仅显式 lane 上下文）否则 `EXTERNAL_REJECT` | `unknown-flow` / `unknown-state` |
| **平台状态未映射但合法**（`StateMapping.verification='unverified'`） | **不是 `Err`**：`Ok({verification:'unverified', workStates:[]})` + `REC-OBS-02` | — | — |
| 外部 payload 拒收（格式） | `rejected_precondition` | `CONFIG_INVALID` | `payload-malformed` |
| 外部来源未授权（含注入净化命中） | `rejected_forbidden` | `EXTERNAL_REJECT` | `source-not-allowed` |
| 同键不同摘要 | `rejected_idempotency` | `EXTERNAL_REJECT` | `idempotency-key-conflict` |
| 版本不符（类型流/协议/schema） | `rejected_version` | `EVOLVE_REJECT` | `type-version-mismatch` / `schema-behind` |
| 能力不支持（缺件、缺适配器能力） | `unsupported` | `EVOLVE_REJECT` | `capability-unsupported` |
| 幂等命中（同键同摘要） | **不是失败**（`Ok` + `duplicate:true`） | — | — |
| 停机中断（`dispose` 期在途） | `cancelled` | `STALL` | `shutdown-cancelled` |
| 人事/通知/房间面部分成功 | `partial` | `STALL` | `hr-partial` / `notify-partial` / `room-partial` |
| `RuleEvaluator` 墙钟护栏触发 | `timeout` | `STALL` | `rule-wallclock`（`refused` 仍留 `Ok`，不是 `Err`） |

**四条强制约束**：

1. `partial` 与 `unverified` **不得**写成 `ok`；`unavailable` **不得**写成空结果（`0`/`[]`）——77 的「不假绿」在本域的落点。
2. **`refused` 不是错误**：`RuleEvaluator` 的 `refused` 留在 `Ok`，按「拒绝路径」处理；把它压成 `Err` 会丢失「求值成功但结论是拒绝」的区别。
3. **平台未映射 ≠ 77 的异常 `unknown`**：前者是**合法的映射缺口**（`Ok` + `REC-OBS-02`，`workStates=[]`；此状态下**禁止**迁移/验收/结清），后者是**异常终局**（`unknown` 状态 + 对账）。两者不同轴，不得互相折叠。
4. **`TickReport.errors` 迁移口径**：类型改 `readonly ClassifiedError[]` 后，23 处 `errors.push` 必须**逐处**给 `failure`/`subcause`；只改类型仍 push 字符串包装（如 `{subcause: old}` 而 `failure` 缺省猜）＝未出清。**计数口径**：23 是「`errors.push(` 出现次数」，不是「错误种类数」；拆件只挪位置，不减少该数，直到逐处分类完成。

**HTTP 错误体**（API 邻接，不在引擎内）：`{ error: { failure, category, subcause }, traceId }`——不得只回 `message` 字符串；`detail` 只在内部日志，不回外。

---

## 八、结构债与迁移计划

### 8.1 债清单（〔事实〕，全部只减不增）

| 债 | 现状 | 机械判据 |
|---|---|---|
| `engine.ts` 2337 行 | `lineBaseline`（`boundary-rules.mjs:160`） | 拆分后从基线除名才算出清 |
| 类型环（§1.3） | `engine ↔ tick-report/types ↔ merge-lease`、`engine ↔ merge-run` | 环消失＝`merge-lease`/`merge-run` 不再 `import … '../engine.ts'`，且 `tick/types.ts` 不 import 任何域内件（`../merge/merge-gate.ts` 除外） |
| 相位逻辑与域件混居 | `engine.ts` 同时含编排与 15+ 段实现 | 目标：`tick/`(4)/`dispatch/`(2)/`harvest/`(6)/`breaker/`(2) 四组，见 §2.3 逐件表 |
| `errors` 字符串面 | 23 处 `errors.push`，`TickReport.errors: readonly string[]`（`tick-report/types.ts:145`） | 目标：`readonly ClassifiedError[]`（§7.2）；只改类型不改条数不算出清 |
| `test/engine` 顶格 25 | 新测试无落点 | 新测试必须进子域目录（U81-03） |
| `fakes` 生产可达 | 三处装配 import | 目标：显式「演示模式」标＋装配处 gating（U81-05） |
| `gate.ts` 的 `GATE_PASS` 语义 | 现为占位 `GateRunner` 直通 | 目标：验收投影（80-§7.4）；未改前不得声称「验收已独立」（U81-09） |

### 8.2 迁移顺序（硬约束，违反即返工）

1. **落 `engine/tick/types.ts`**（目标-新增，叶子）：定义 `EngineConfig`、`Inflight`、`MergeRunDeps`、`MergeRunContext`、`MergeRunHost`、`MergeLeaseState`、`MergeLeaseRegistry` 七型（§1.3 第 4 条）。`merge-run.ts` 从前处 import 后原样再出口；`merge-lease.ts` 只保留对 `Inflight`/两租约型的单向 import，并把两租约型原样再出口（外部引用路径不变）；`engine.ts:635` 的内联 `import('./merge/merge-run.ts')` 删除，改 `mergeRun?: MergeRunContext`。这里是**纯搬移**：不新增类型、不改字段、不改名。`engine.ts` 对七型只做再出口。
2. **抽 `engine/harvest/` 四件**：`harvest/one.ts`（`harvestOne`）、`stream.ts`（`pumpHarvestStream`/`foldHarvestEvent`）、`finalize.ts`（`finalizeHarvest`）、`stall.ts`（`failHarvest`）；与既有 `park.ts`/`inflight-takeover.ts` 同居，**该步后**目录 6 件（§4.12 B 组再 +5，终态 11 件）。
3. **抽 `engine/dispatch/` 两件**：`execute.ts`（`executeDispatch` 本体）、`brief.ts`（任务书拼装 + `instructionsPath` 决策）。
4. **抽 `engine/breaker/` 两件**：`trip.ts`（`strikeBreakerAndMaybeTrip`）、`probe.ts`（半开试探）；`core/breaker.ts` 纯体已在，此处只做接线。
5. **抽 `engine/tick/` 三件**：`state.ts`（进程内可变状态）、`phases.ts`（七相位序列）、`report.ts`（`TickReport` 组装与 `errors` 归一）；`engine.ts` 降 facade（`createEngine`+`Engine`+序列+re-export），目标 <600。
6. 每步单独可跑 `bun run typecheck` + `bun run guard:boundaries`；**不得**在同一步里既搬家又改语义（§7.2 的结构化错误、`gate.ts` 的验收投影、`WorkIntake` 接线各自另开实现单）。每步的验收命令见 §2.3 末表。

### 8.3 不许的做法

- 提高 `maxLinesPerFile` 或给新件加 `lineBaseline` 条目；
- 把新件放 `src/engine/` 直下（平面已 13 顶格）；
- 先删 export 再修调用方（`apps/boot/src/boot.test.ts:23` 是唯一外部消费者，必须最后动）；
- 用 `any` 或 `@ts-expect-error` 跨过类型环；
- 用 `as` 断言去「凑」类型搬移后的形状——搬移是定义位置变化，结构应恒等；一旦需要断言，说明搬错了字段；
- 在计数复算时排除新件（`find … -name '*.ts'` 是唯一口径，不许手写 68/80）。

---

## 九、与 78/79/80/82 的接缝

| 接缝 | 引擎承诺 | 引擎不承诺 | 对应卷/号 |
|---|---|---|---|
| `FlowPlatform` 七能力 | 只经端口调用；写面必须过 `gated-platform` 或 gateway；未映射但合法的平台状态回 `Ok({verification:'unverified',workStates:[]})` + `REC-OBS-02` | 不实现平台方言、不猜状态语义、不把 `workStates=[]` 当可迁移 | 78 `BIND-PLAT-YT-01`/`TAIGA-01`/`LOCAL-01`；80-§6 |
| `EffectGateway`（EFF-01） | 所有出站写经 `engine/tools/effect-gateway.ts` 编排（权源解析 → 凭据/范围 → fence → 内核 → 回执/未知）；`applied` 必带 `receiptRef`、`unknown` 必带 `unknownRef`；意图域未知必带 `unknown_scope.intentRef`；先落记录再返回 | 不直调平台写、不签发凭据、不写台账（只经 `RecordWriter`/`ReconciliationPort`）、不把 `gateWrite` 当效果网关；类型与流水线归 `contract`/06 卷 | 80-§6.6 `TS-PORT-EFF-01`/§8.4/§6.9；`81-files/06-gateway.md` `EffectGateway` 行为契约；§4.12 `F-DAEMON-ENGINE-TOOLS-EFFECT-GATEWAY` |
| `ExecutorAdapter`/`ExecutorRegistry` | 只读 `capabilities` 声明；缺能力 ⇒ `unsupported`/`EVOLVE_REJECT`，不试 | 不探测真实能力、不猜会话续跑 | 78 `BIND-DSH-01`/`WS-01`；79 |
| `ModelCatalog` | 预算态 A/B 的开关（`EngineDeps.catalog`，`engine.ts:550`）；无价目 ⇒ 态 B 明报 | 不维护价目、不保证价目正确 | 80-§3 |
| `Ledger` | 唯一台账触点；事件只经 `append`；不建表不迁移；事务内不 await 外部 IO | 不跑 DDL/PRAGMA、不做 migration、不做跨进程围栏 | 78 `BIND-STORE-01`；80-§8 |
| `RecordReader`/`ReadOnlyLedger` | 只读查询返回 `RecordPage={items,nextCursor}`；库缺 `unavailable`、schema 旧 `rejected_version` | 不复用写连接、不写 PRAGMA（`query_only` 除外） | 80-§8/§9 |
| `TxReceipt` | `commit` 只产 `committed`/`unknown`；`abort` 返回 `aborted`；`unknown` 等 `receipt(txId)`/`REC-06` | 不把「未知」改写成「已知失败」 | 80-§6.3；76 |
| `MigrationPlan` | 只读其报告面（`dryRun`/`rollback`），artifact 是 `string` | 引擎不规划、不执行迁移 | 80-§8；79 |
| `GateRunner` | 端口注入；只提供**执行证据**（退出码/输出/超时）；`GATE_PASS` 是验收投影的前提之一 | 不把 exit 0 当 `accepted`；占位实现不当证据（U81-09） | 80-§6/§7.4；79 |
| `RuleEvaluator` | 只在 `typecheck` 通过后 `evaluate`；`refused` 留 `Ok` 按拒绝路径处理；`Ok`/`Err` 两态不折叠 | 不实现规则求值、不解释 `steps` 语义 | 80-§6.1 |
| `WorkIntake`（`reserve`/`intake`） | 只在相位 2 调 `intake`，透传 `IntakeOutcome`；未注入＝面关明报 | 不写 `REC-WORK-01/02`、不生成 `intentRef`、不判受理 | 80-§6.6 `TS-PORT-WORK-01` |
| `IntentIngress`/`IntentReceiptStore` | 引擎只暴露 `ingest`（入队）；回执投影由 **store 自有 hook 同事务**写 + 内存快照；`replayQueued` 属内部类型 `IntentIngressInternal`，启动序 `schema 闸 → rebuild → replayQueued → 装配 API` | 不刷投影、不重放、不持 API；不新增 `upsert`/`queued(company)` 写口；不用 `get` 判入队/重放 | 80-§6.6 规则 1-10；§4.10.4 |
| `assembleApi` | 只消费 `Pick<IntentIngress,'submit'\|'receipt'>`（等价 `Pick<IntentSubmissionPort,…>`，不含 `replayQueued`） | 引擎不被 API 持有、不被直调 `ingest` | 80-§3.6/§9.4；§4.10.5 |
| `PlatformBindingPort`（`BindingProfile`） | 按 20 字段消费；`StateMapping.verification` 两值；未映射走 `Ok`+`REC-OBS-02` | 不补字段、不改 `unmappedBehavior`、不把 `unverified` 当 `verified` | 78 `BIND-CORE-01`；§0.4 第 5 条 |
| `SecretProvider`/`KnownSecretSet` | 只消费 `KnownSecretSet`（脱敏）与 wkey 生命周期；per-ticket wkey 进 known set 到 `CLOSE` | 不 `load` 秘密、不持明文、不把 `gatewaySecret` 给 worker | 80-§11.2.1；78 `BIND-XCHG-01` |
| **端口类型面**：`contract/src/ports/{command,decision,work,evidence,obligation,lifecycle,memory,observation,resources}.ts` | 只 import 类型、不复制字段表；端口方法集照 80-§6.4/§6.6/§6.7 | **本域不定义、不改写**这些类型（01 卷） | 80-§6.4/§6.6/§6.9；§4.12 |
| **纯求值面**：`core/src/work-readiness.ts` + `core/src/resources/` | 五门聚合与 `ResourceBaseline` 纯算法只在 `core`；本域只调 `judge`/`baseline` | 本域不实现判据、不算 `remaining`、不写资源 | 80-§6.4 WORK-03/RES-01；§4.12 |
| **持久面**：`store/src/{records,memory,resources}/` | 记录追加、记忆四层、资源投影与 `intent_receipts` 投影都在 `store`；本域经端口调 | 本域不拼 SQL、不建表、不写投影（`append` 事件口除外） | 80-§6.9；§5.1 |
| `Notifier`/`NotificationEnvelope` | 消费 `Result<NotifySendReceipt,ClassifiedError>`；MCP 通知只回 `mcp-session` | 不定义 `NotificationEnvelope` 字段名（`notificationId` vs `id` 冲突，U81-16）；不把通知当决定 | 80-§6.6；§4.6 |
| `PromptAssembler` | 端口注入；默认实现在 `prompt-assembly.ts` | 不拼 L0–L5、不做提示词预算 | 80-§6；`docs/17-§5`；79 |
| stdio/helper 注册协议 | 引擎侧只保证 per-ticket env `STUDIO_TOOLS_WKEY` 优先、`_meta['studio-wkey']` 仅 legacy；帧里只出现 `wkeyRef`（逻辑引用 `SEC-WKEY-<ticketId>`，非秘密、不可转授）；daemon 内**只持一个** `WkeyAuthority`（签发/验签/吊销同实例）；同一 `(ticket, nonce)` **只允许一个活跃会话**，第二个注册 `ok:false` | 不实现 socket/注册握手/`verifySealed`/`consumeNonce:false`（未实现、未证，U80-17/U81-21）；不复制协议帧（主文在 `81-files/15-studio-tools.md` 与 `81-files/06-gateway.md`）；不把 `gatewaySecret` 给 worker | 80-§11.4.1；§4.2 `WORKER-KEY` |
| `.ts` 说明符 / 可擦除语法 / `PORT_VERSION=v0` | 全域遵守（无 `enum`/`namespace`/参数属性/装饰器；测试件不进根 `typecheck`） | — | 79；`tsconfig.json` 只含 `src` |
| V2/V4 探针输入 | 本域的注入点与失败面是 82 的探针来源 | 不声称任何 V2/V4/V5 已通过 | 82 |

**范围外但常被误认**：`packages/yt`/`matrix`/`localplatform`/`panel`/`api` 的实现细节不在本卷；daemon 的 `package.json`/`tsconfig.json`/`daemon.yaml` 装载归 17/79。

---

## 十、明确不做 / 判负清单

1. **不新增相位**：七相位冻结（80-§7）；`inflight-takeover`、`notify/relay`、`pricing`/`cost-close` 都是相位内步骤或拍边界，不是第八相位。
2. **不新增包、不新增允许边、不新增域平面文件**（§2.1）。
3. **不把 `TaskBrief` 当合同**，不把 `GATE_PASS` 当验收或结清（77：completed/accepted/settled 不可互换）。
4. **不让 `fakes` 当能力证据**，不把 fake 的绿写成真机支持。
5. **不用 `any` 接平台/适配器响应**；平台方言差异留在 adapter 层。
6. **不在台账事务里 `await` 外部 IO**。
7. **不用 `Math.random()`** 生成 nonce/ID/租约（`tools/id.ts` 与 `jobs/sentinel.ts` 已是反例）。
8. **不把泳道当跨进程写者租约**（`lanes/registry.ts` 仅进程内；跨进程用合并租约/fencing）。
9. **不在 panel/CLI 跑 DDL 或写台账**（唯一写入者）。
10. **不静默**：无候选、无价目、未接线、读不到、部分成功都必须有可见态（`unpaid`/`unpriced`/`unreadable`/`partial`/未接线 note）。
11. **不另造类型名**：合并宿主类型只有一个名字 `MergeRunHost`（`merge/merge-run.ts:129`）；不存在的设计名不得写进代码、文档或实现单。拆件时不得顺手改公共类型名，改名须提案流。
12. **不在本域引 `matrix`/`panel`/`api`/`yt`/`localplatform`**（端口注入，assembly 装配）。
13. **不由 ingress 写 `REC-WORK-01`/`REC-WORK-02`**，不由引擎写这两条记录，不把 `ingest` 当受理（§5.1）。
14. **不让 API 持 `Engine` 或直调 `ingest`**；`assembleApi` 只收 `Pick<IntentIngress,'submit'|'receipt'>`（等价 `Pick<IntentSubmissionPort,'submit'|'receipt'>`，编译期拿不到 `replayQueued`；不得 `as` 绕过）（§4.10.5）。
15. **不把 `Notification.from` 改成对象**（`notifier.ts:11` 是非安全边界的展示字段）；`Notifier` 与 `NotifyBroadcastFace` 不合并（§4.6）。
16. **不让 worker 拿 `gatewaySecret`**；per-ticket wkey 不进静态 catalog（§4.2/§4.10.2）。
17. **不把平台未映射状态回 `Err`**：合法未映射＝`Ok({verification:'unverified',workStates:[]})` + `REC-OBS-02`；只有空/畸形才 `Err(rejected_precondition)`（§7.2 约束 3）。
18. **不把 `TickReport.errors` 留成裸 string 却声称「已分类」**；23 处 `errors.push` 未逐处给 `failure`/`subcause` 即未出清（§7.2 约束 4）。
19. **不在公共面用 `Money.usd: number`**（只内存/旧记录）；公共金额用 `DecimalString` + 币种（§4.0.1）。
20. **不拿 `sha8` 当身份**（幂等键/去重/产物核对/指纹一律用完整 `semanticDigest`；`sha8` 只展示，§4.0.1）。
21. **不混用日键**：UTC 日键（`dayKeyOf`）与公司本地日分开，本地日必须显式时区参数，禁读宿主时区（§4.0.1；现存反例 `jobs/output-account.ts:67-77`）。
22. **不用 `as` 断言跨类型搬移**、不用 `any`/`@ts-expect-error` 跨环（§8.3）。
23. **不新增/提高 `lineBaseline`、不越过 25/600/13 三阈**，不为新件加豁免（§2.1/§8.3）。
24. **不在本卷实现 assembly 的 `IntentIngress`/`IntentReceiptStore`**：§4.10.4 只作接缝（形状 + 规则 1-10 + 启动序），实现归 17 卷。本卷另写一套＝双轨，违反「唯一写入者」。
25. **不在 `engine` 里定义端口类型、写纯求值、拼 SQL 或建投影表**（80-§6.9）：类型在 `contract`、纯求值在 `core`、SQL 与投影在 `store`。即使能跑也算废件。
26. **不把 §4.12 的目录设计写成能力已成立**：39 件**全部不存在**、零运行证据；「路径规划好了」≠「端口实现了」，也不得以 `F-ID` 的存在代替探针；不得用 `EffectGateway` 行为契约（06 卷）替代本卷的 `F-DAEMON-ENGINE-TOOLS-EFFECT-GATEWAY`。

---

## 十一、未证项与上呈项

### 11.1 本卷新增（U81-*）

| ID | 事项 | 需要的证据/动作 |
|---|---|---|
| U81-01 | **作废**：v0.1 曾登记「80-§10.2 设计名 `MergeHostView` vs 现实现 `MergeRunHost`」的命名差 | 不成立——真实名只有 `MergeRunHost`（§1.3、§0.4 第 10 条）；编号保留不复用，避免既有引用悬空 |
| U81-02 | 80-§10.2 目标 `engine/tick/types.ts` **不存在**（现只有 `tick-report/types.ts`） | 立实现单（§8.2 第 1 步） |
| U81-03 | `test/engine/` 直下 25 件＝目录上限；新测试无平面落点 | 新测试一律进子域；如需跨域测试放 `test/assembly` |
| U81-04 | `errors` 与 payload 拒绝均为裸字符串，未分类（23 处 `errors.push`） | 立结构化错误实现单；映射表见 §7.2（目标态） |
| U81-05 | `fakes.ts` 在生产装配可达**三处调用点**（`assembly/platform/wire.ts:147`、`assembly/serve.ts:975`、`cli/external.ts:94`） | 明确「演示模式」标 + 装配 gating；与 81-§3.3「fake 不进生产装配」冲突待裁。可见性差异见 U81-15 |
| U81-06 | 事件 `note` 是字符串协议（锚文本/`job=`/`intentKey=`/`model=` 全靠约定），无 schema 校验 | 立 note 契约件或结构字段化提案 |
| U81-07 | 配置解析失败返回 `undefined` 走缺省（`directive/serve-config.ts:22`、`todoqueue/queue.ts:321/344/358`），缺省≠明报 | 核 serve 侧是否明报；未报则立单 |
| U81-08 | `read-tiers` 的 role→tier 表自述「拟稿」，且 `roleOfAssignee` 是「v0 无 role 元数据口径」 | 升正需改 `docs/17-§7` + 去拟稿标记；真公司目录角色元数据面未证 |
| U81-09 | `createDefaultGateRunner`（`gate.ts:76`）是 v0 占位（REPORT 存在即 exit 0） | 不得作为验收证据；真验收在 serve 侧装配 `createAcceptanceGateRunner` |
| U81-10 | 合并真单刀真机面（真 git + 真闸命令）未证；`mergeRun` 缺省＝v0 模拟轨 | 82 的 V2/V4 探针；`merge/default-deps.ts` 真机行为未证 |
| U81-11 | 真 Taiga 人事面 S0 未证（`hrsync/taiga-face.ts`）；邀请令牌"只落 console/日志"未取真机证据 | 82 探针；78 的 `BIND-PLAT-TAIGA-01` |
| U81-12 | 崩溃注入只实现 5 点；80-§8.7 目标新增 8 点未实现 | 立实现单（同形扩写，默认零行为） |
| U81-13 | judge 真实低档模型输出分布/解析成功率未证（只经 fake 与真台账） | 82 探针；失败率与降级比例需实测 |
| U81-14 | `CIRCUIT_BREAK` 无生产者：`notify/route.ts:83` 有 `case 'CIRCUIT_BREAK'`、`evolve/gray.ts:93` 列入 `INCIDENT_EVENT_NAMES`，但引擎熔断只发 `ESCALATE`（note 前缀 `CIRCUIT_BREAK：`，`engine.ts:1448-1453`） | 二选一：改路由/evolve 按 note 前缀识别，或补发 `CIRCUIT_BREAK` 事件；前者不动事件族，需评审 |
| U81-15 | fake 三处生产入口**守卫强度不一**（§4.8 表）：`assembly/platform/wire.ts:147` 是 `wirePlatform()` 兜底 return（上游 `daemon.yaml` 已收紧枚举、未知值抛 `CONFIG_INVALID`——`assembly/serve.ts:463-470`），本处无 log，仅启动横幅 `platform=fake` 可见（`serve.ts:1541`）；`assembly/serve.ts:975` 无 `agent.yaml` 时静默注册 fake 为 default（横幅 `fake executor（demo）`，`serve.ts:1548`）；`cli/external.ts:94-95` 有显式 `console.warn` | 前两处在**注册/返回点本身**补可见性（结构化 log 或启动期「演示模式」标记），并把「演示模式」纳入启动汇报的可见态；与 U81-05 同族 |
| U81-16 | **`NotificationEnvelope` 字段名冲突**：80-§6.6 写 `notificationId`，用户统一接口清单写 `id`；仓内该类型**完全不存在**（`grep NotificationEnvelope` 零命中） | **需主 agent 裁决并回写 80-§6.6（及引用卷）**：二选一，选定后 81/79/78 全套同改。本卷暂按 80 的 `notificationId` 记述 |
| U81-17 | **已关闭**：`allowedSources` 显式空数组 = `CONFIG_INVALID` 拒启动（原为「全 403」vs「拒启动」冲突） | §0.4 第 11 条、§4.10.4、§4.10.5 已按此写；`enabled=false` 时不读不校验、零行为。80-§3.3 的「全 403」一侧作废，本卷不再引用 |
| U81-18 | **跨域接缝件的 F-ID 归属未定**：`contract/src/ports/intent.ts`、`contract/src/ports/secret.ts`、`core/src/work-readiness.ts`、`assembly/intent/*`、`assembly/api/assemble.ts` 在 01/02/17 卷可能已有编号 | 回写 01/02/17 的 F-ID 表做去重；本卷只用 `S-ENGINE-*` 接缝号（§0.2），**不占 F-ID**，避免重号 |
| U81-19 | **已关闭**：`decided` 投影的刷新触发点已由 80-§6.6 规则 7 定死——store 自有 projection hook 在追加 `REC-WORK-01/02/03` 的**同一事务**写表投影，commit 后同一微任务、无 `await` 更新内存快照 ⇒ `decided` **不可能**被读成 `queued` | §4.10.4 已按此写；引擎侧仍**不得**私接刷新 |
| U81-20 | **`tick/types.ts` 的符号闭包比 80-§10.2 点名的三类型更宽**：还需 `MergeRunDeps`、`MergeRunContext`、`MergeLeaseState`、`MergeLeaseRegistry` 共 7 型，否则产生新环（§1.3 第 4 条） | 回写 **80-§10.2**：把「搬三个类型」改为「搬七个类型（纯搬移不改名）」并给出验收命令 |
| U81-21 | **stdio/helper 注册协议与 `assembleApi` 均未实现**（80-§11.4.1、80-§3.6）：仓内无 helper 注册 socket、无 verifier 实现、无 `assembly/api/assemble.ts` | 引用 **U80-17**（stdio 面）与本卷 §4.10 `S-ENGINE-ASSEMBLY-API`；实现前不得声称「API 只拿 ingress」已落地 |
| U81-22 | **§4.12 的 39 个目标源码件全部不存在**（`find apps/daemon/src/engine -name '*.ts' \| wc -l` = 68）。本条是 **82-GAP-01/05 的 engine 侧关闭登记**：F-ID 与逐件契约已给全，但**实现单未立、零运行证据** | 立单顺序：`tick/types.ts` 解环 → 拆分 12 → 端口 27（且须等 `contract`/`core`/`store` 三面落地）。每件验收须有**真实文件 + 一条探针**（80-§6.10：缺一即仍「未实现/未证」） |
| U81-23 | **`resourceLedger`/`resource_ledger` 已登记为 80-§6.3 的目标投影名（第 18 个），实现未做**：名字已定（`TargetTableProjectionName = TableProjectionName \| 'resourceLedger'`，物理表 `resource_ledger`），随 `MIG-01` 建表；仓内仍无 `core/src/resources/`、`store/src/resources/`、无表、无 hook | 实现前 `work/plan.ts` **不得**建表、不得以「投影已存在」自证；落地时按 80-§6.3 用 `resourceLedger` 字面量（物理表名只是物理名，不得互为别名）；本条不再是「名字未定/需另提案」 |
| U81-24 | **`engine/tools/effect-gateway.ts` 与其测试均不存在**：EFF-01 的文件级契约（§4.12）已成文；06 只保留行为契约，不再用 `EffectGateway` 行为契约 指称本路径。`EffectDescriptor`/`EffectTarget`、凭据载体、`partial` 清单、`RecordQuery.idempotencyKey` 均已在 80 定稿（G-3～G-6 设计面关闭）；仍缺 `contract/src/ports/effects.ts`、`Result`/`failure` 与全部实现 | 由 `contract` 落类型后再立实现单；`apply` 的“先落记录再返回”须由真实 `RecordWriter` 事务证；**不得**以本卷契约的存在声称效果面已实现 |

### 11.2 从 80-§12.5 继承（与引擎直接相关）

U80-04（`engine.ts` 拆分）、U80-05（类型环）、U80-06（serve 拆分接缝）、U80-07（相位内步骤边界）、U80-08（`errors` 分类）、U80-09（`TickReport` 稳定面）、U80-15（`fakes` 去留）、U80-16（`engine/tools` 升格判定）。**编号与原文以 80-§12.5 为准**，本卷只登记"引擎侧已复核为同一事项"，不复制其表述。

### 11.3 82-GAP 关闭登记（只关 engine 侧）

| GAP | 原文诉求 | 本卷的关闭动作 | 剩余（不在本卷） |
|---|---|---|---|
| **GAP-82-01**（`docs/82-技术细节-验证迁移与追溯.md:808`） | 80-§6 部分新端口在 81-files **无实现文件家**（EVD-03/04/05、WORK-06/07、OBL-01、MEM-01、LIFE-01..04 等），全 19 附录无 `MemoryStore`/`SettlementPort`/`ObligationPort`/`AppointmentPort` 条目 | engine 侧已给：27 个端口件各获唯一 `F-DAEMON-ENGINE-*` + 九面契约（§4.12 B 组）+ 1:1 测试条目（§4.11 B 组）+ 唯一写口表（§5.1）。证据＝条目本身与 §12 锚点，**不含运行证据**（U81-22） | ① `contract/src/ports/{command,decision,work,evidence,obligation,lifecycle,memory,observation,resources,effects}.ts` 归 01 卷；② `core/src/{work-readiness.ts,resources/}` 归 02 卷；③ `store/src/{records,memory,resources}/` 归 03 卷；④ 82 原文**未改**，需 82 卷侧回写「engine 侧已关、其余三面仍开」 |
| **GAP-82-05**（`docs/82-技术细节-验证迁移与追溯.md:812`） | 81-16 的 12 个目标源码件**只有路径、无 `F-*` 稳定 ID** | 12 件各获 `F-DAEMON-ENGINE-{TICK-TYPES,TICK-STATE,TICK-PHASES,TICK-REPORT,DISPATCH-EXECUTE,DISPATCH-BRIEF,HARVEST-ONE,HARVEST-STREAM,HARVEST-FINALIZE,HARVEST-STALL,BREAKER-TRIP,BREAKER-PROBE}` 与完整文件契约（§4.12 A 组） | 拆分**未执行**（`engine.ts` 仍 2337 行）；验收靠 §2.3 五步命令，须在实现单里跑 |

**口径**：本节只关 **engine 侧**的「无文件家 / 无 F-ID」两项；「端口已实现」「测试已通过」不在关闭范围——39 件全部不存在（U81-22），零运行证据。

---

## 十二、锚点核对表

本卷引用的关键锚（已逐一核对；`path:line` 均为 2026-10-27 实测）：

| 锚 | 内容 |
|---|---|
| `scripts/guards/boundary-rules.mjs:30/31/40-48/55/62` | 层位（`engine:3`、`engine/tools:2`）、纵边（含 `engine→engine/tools`、无 `root→engine`）、`daemonSrcRootDirs`、域平面 `engine:13` |
| `scripts/guards/boundary-rules.mjs:160/167/170` | 行数基线三条（`engine.ts:2337`、`scheduler.test.ts:785`、`sources.test.ts:768`） |
| `apps/daemon/package.json:10` | `"./engine": "./src/engine/engine.ts"` |
| `apps/boot/src/boot.test.ts:23` | 唯一外部消费者（`checkMentionPayload`） |
| `apps/daemon/src/engine/engine.ts:319/501/531/601/644/672/709` | `EngineConfig`/`ENGINE_CONFIG_DEFAULTS`/`EngineDeps`/`Inflight`/`Engine`/`CompanyRuntimeUpdate`/`createEngine` |
| `apps/daemon/src/engine/engine.ts:231/246/257/314` | 公共 re-export 块 |
| `apps/daemon/src/engine/engine.ts:701/702/752/1572/1583/1611` | 游标与拍序 |
| `apps/daemon/src/engine/engine.ts:781/786/826/848/856/880` | `append`/`makeEvent`/`syncMirror`/`resolvePerson`/`flowOf`/`executeDispatch` |
| `apps/daemon/src/engine/engine.ts:1146/1183/1215/1224/1361/1425/1476/1570/2284` | 收割五段/断路/STALL/`tick`/`dispose` |
| `apps/daemon/src/engine/engine.ts:1582-2236` | 七相位内各步注释锚（1→7）；矩阵见 §4.0.2 |
| `apps/daemon/src/engine/engine.ts:1743/1755/1897` | `closedSet`/复活释放/`seenIntentKeys` |
| `apps/daemon/src/engine/tick-report/types.ts:19-109/145` | `TickReport` 家族；`errors` 字段 |
| `apps/daemon/src/engine/crash-points.ts:39` | 五点冻结表 |
| `apps/daemon/src/engine/merge/merge-run.ts:129` | `MergeRunHost`（真实名；唯一宿主类型名） |
| `apps/daemon/src/engine/merge/merge-run.ts:84/80/86/87` | 类型环四边：`../engine.ts` 型回引、`../tick-report/types.ts`、`../merge-lease.ts`、`./merge-fallback.ts` |
| `apps/daemon/src/engine/merge/merge-run.ts:92/101/115/160/171` | `MergeAction`/`MergeRunDeps`/`MergeRunContext`/`MergeActionOutcome`/`MergeRunPlan`（§8.2 第 1 步闭包） |
| `apps/daemon/src/engine/merge/merge-lease.ts:17/24/30/37/95` | `Inflight` 型回引、`MergeLeaseEntry`、`MergeLeaseState`、`MergeLeaseRegistry`、`MergeQueueFace` |
| `apps/daemon/src/engine/merge/merge-fallback.ts:11` | `MergeAction`/`MergeActionOutcome`/`MergeRunHost` 型回引（擦除面，无运行时环） |
| `apps/daemon/src/engine/budget-gate.ts:127` | `BudgetGateDeps`（不迁 `tick/types.ts`，单向引用） |
| `apps/daemon/src/engine/engine.ts:310/312/313/314/635` | `tick-report` 型导入／`merge-run` 运行时导入／`merge-lease` 运行时导入／`export type` 再出口／内联 `import()` 宿主引用 |
| `apps/daemon/src/engine/gate.ts:76/98/118` | 默认占位/超时常量/验收实现 |
| `apps/daemon/src/engine/read-tiers.ts:131/139/142` | 角色档位表与缺省 |
| `apps/daemon/src/engine/jobs/harvest-recon.ts:54` | `WORKSPACE_UMASK` |
| `apps/daemon/src/engine/judge/sites129.ts:45/47` | 两址 ID |
| `apps/daemon/src/engine/fakes.ts:294/344` | 模块私有 `FAKE_CAPABILITIES` 与挂载 |
| `apps/daemon/src/assembly/platform/wire.ts:147`、`apps/daemon/src/assembly/serve.ts:975`、`apps/daemon/src/cli/external.ts:94-95` | fake 生产可达三处**调用点**（守卫差异见 §4.8 表） |
| `apps/daemon/src/assembly/serve.ts:463-470` | `daemon.yaml` 的 `platform` 枚举收紧（未知值 `CONFIG_INVALID`，堵死「静默降 fake」） |
| `apps/daemon/src/assembly/serve.ts:1541/1542-1549` | 启动横幅：`platform=…` 与栈形态块（`fake 平台（demo）`／`fake executor（demo）`） |
| `apps/daemon/test/engine/starvation-revival.test.ts:141` | 标准链 `DISPATCH→GATE_PASS→QA_PASS→MERGE→CLOSE` |
| `apps/daemon/test/assembly/inflight-takeover.test.ts:23` | 接管件经 serve re-export 的测试面 |
| `packages/contract/src/ports/kernel.ts:85-99` | `ErrorCategory` 11 值与 `ClassifiedError`（**现缺 `failure` 字段**，目标态补） |
| `packages/contract/src/ports/notifier.ts:6-16` | `Notification`（`from?: string`，`:11`）与 `Notifier.send(...): Promise<void>`（`:15`；目标改 `Result<NotifySendReceipt,…>`） |
| `packages/contract/src/ports/invoke.ts:18` | `InvokeIntent['kind']` 八值 |
| `packages/core/src/decide.ts:319-322` | `intentKeyOf` = `[source,kind,company,ticket ?? dedupKey].join('\|')` |
| `packages/panel/src/views.ts:321` | `dayKeyOf`（UTC 日键；与公司本地日不同轴） |
| `apps/daemon/src/engine/jobs/output-account.ts:67-77` | `reportFileName` 用宿主本地时区取日（现存反例，目标加显式 tz） |
| `apps/daemon/src/engine/intents/drain.ts:35/75` | `DrainDeps`/`drainIntents`（目标接 `workIntake.intake`） |
| `apps/daemon/src/engine/notify/broadcast.ts:17/27/33/39` | `NotifyBroadcastTargets`/`NotifySendFailure`/`NotifySendReport`/`NotifyBroadcastFace`（与 80-§6.6 逐字段一致） |
| `apps/daemon/src/engine/worker-key.ts:62/65` | `STUDIO_TOOLS_WKEY`（现 env 键）/TTL 缺省 `24h` |
| 目标（均不存在，勿当锚） | `packages/contract/src/ports/{intent,secret,effects,command,decision,work,evidence,obligation,lifecycle,memory,observation,resources}.ts`、`packages/core/src/work-readiness.ts`、`packages/core/src/resources/`、`packages/store/src/{records,memory,resources}/`、`apps/daemon/src/assembly/intent/{ingress,receipt-store}.ts`、`apps/daemon/src/assembly/api/assemble.ts`、`apps/daemon/src/engine/{tick,dispatch,breaker,decision,work,obligations,lifecycle,memory,observe}/**`、`engine/harvest/{one,stream,finalize,stall,evidence,acceptance,value,rework,reopen}.ts`、`engine/notify/policy.ts`、`engine/tools/effect-gateway.ts`、`test/engine/tools/effect-gateway.test.ts` |
| `docs/80-技术细节-StudioNext运行时与公共接口.md:1269-1541` | §6.4 十一 WORK 端口 + RES-01 的形状（本卷 §4.12 B 组 `WORK-*`/`RES-01` 的唯一上位）——**本表以下写作 `docs/80-…` 的行都指同一文件** |
| `docs/80-…:1605-1619` | §6.6 效果/证据/验收/记忆/观察/通知端口的定义（本卷 `EVD-*`/`MEM-01`/`OBS-01`/`NOTI-01` 上位） |
| `docs/80-…:2031-2083` | `IntentReceiptStore` 形状（`refresh(key)`/`get`/`rebuild`）与投影维护规则 1-10（含规则 7 同事务 hook、规则 8 `refresh`≠`get`、规则 9 启动序） |
| `docs/80-…:2194-2224` | §6.9 端口实现落点表（本卷 §4.12 的目录依据） |
| `docs/80-…:1229-1231` | §6.3 `TargetTableProjectionName`：`resourceLedger` ↔ 物理表 `resource_ledger`（目标第 18 个投影名，随 MIG-01 建表）——U81-23 的关闭依据 |
| `docs/80-…:1652-1664` | §6.6 `TS-PORT-EFF-01 EffectGateway`：`apply` 签名、`EffectOutcome` 两分支必带引用、先落记录再 `Ok`、内核三段与四层编排（本卷 §4.12 `F-DAEMON-ENGINE-TOOLS-EFFECT-GATEWAY` 的上位） |
| `docs/80-…:2259` | §6.9 `EFF-01` 实现落点：`gateway` 内核 + `engine/tools/effect-gateway.ts`（权源解析/effect 分类/fence 注入/未知对账） |
| `docs/80-…:2790/2810/2812` | §9.4 路由计数：现状无 `GET /v1/requests/status`，目标 **16 条**（10 读面 + 4 触发 + `/v1/subscriptions` + `GET /`）；**旧稿 15 条作废** |
| `docs/80-…:2968-2984` | §9.4 M4 验证项 **11 项**（第 11 项＝`GET /v1/requests/status` 正反用例） |
| `docs/81-files/06-gateway.md:364-413`、`:451-459` | `EffectGateway` 行为契约 / `EffectGateway` 行为测试契约 的行为契约（七步流水线、错误映射、①–⑭ 用例）；本卷只做文件级契约，不复制 |
| `docs/80-…:2318-2349` | §7.2 相位 2 顺序（2j 计划锁在 2h 五门之前） |
| `docs/80-…:3108-3141` | §11.2 秘密：`SEC-<域>-<slug>` 域段按平台（`SEC-YT-*`/`SEC-TG-*` 不可互冒充）、Taiga 用 `SEC-TG-TOKEN`/`SEC-TG-PASSWORD`、per-ticket `SEC-WKEY-<ticketId>` |
| `docs/80-…:3215-3252` | §11.4.1 stdio：`STUDIO_TOOLS_WKEY` per-ticket env、`_meta` 仅 legacy、帧里只带 `wkeyRef`、daemon 侧单一权威与未注册即拒 |
| `docs/77-技术细节-运行记录与行为契约.md:781-1210` | §4.0 总图（合同 → 计划锁 → 五门）、§4.1 `REC-WORK-01/02`、§4.3.1 `REC-WORK-03`、§4.4.1 `REC-WORK-04`（13 字段 / `judge_role` 五门 / `resource_baseline`）、§4.5.1 `REC-WORK-05`（`resource_reservations`）、§4.6 出工段、§4.7.1 `REC-WORK-08`、§4.10.1 `REC-WORK-10` |
| `docs/82-技术细节-验证迁移与追溯.md:808/812` | `GAP-82-01`（端口无实现文件家）、`GAP-82-05`（12 件无 F-ID）；本卷 §11.3 登记 engine 侧关闭 |
| `docs/80-§8.3/§8.7/§8.8`、`docs/81-files/15-studio-tools.md`、`docs/81-files/06-gateway.md`、`docs/75-§五`、`docs/20-§十五` | 六段写协议、五点+新增八点、三条不变量、stdio 协议帧主文、网关验签主文、逐文件模板、分层宪法 |
