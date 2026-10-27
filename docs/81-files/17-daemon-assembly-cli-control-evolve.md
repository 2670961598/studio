# 81-files/17 · daemon 的 assembly / cli / control / evolve 与包清单逐文件契约

> 版本：v0.6（对照 80 最新改口径做小修），2026-10-27。v0.6 四处：
> ① **关闭 W-21 / W-22 / W-12**：80 已把 `SEC-MX-BOT-PASSWORD.allowedUses` 改为恰两用途（`platform-auth` +
> `outbound-redaction`，D23/§11.2.1）、把 `TableProjectionResult.name` 改为 `TargetTableProjectionName`（§6.3），
> 并定死 BIND-01 三层（类型 `contract/src/ports/binding.ts` / 宿主 `assembly/platform/binding.ts` / 平台包
> `src/binding.ts` 只供纯函数）；本卷不再保留「80 待回写」的现役矛盾（剩余同步只有 78，见 80-S10）；
> ② **AUTH-06**：03-store 已登记 `F-store-records-credentials`（`src/records/credentials.ts`），删除
> 「03 尚未登记 / 倾向 store」的过期指控，保留「文件未实现」；③ **`mapState` 是纯函数**（零 IO、不写记录、
> 不读时钟）：未映射合法值的 `REC-OBS-02` 由 daemon 侧消费方写（state-diff / `OBS-01`，同一单同一原值同一拍一条），
> 其余三方法（`describe`/`exportBundle`/`exitPlan`）口径不变；④ 复扫 API **16** 条 / M4 **11** 项 / Matrix 两型秘密 /
> `resourceLedger` 均与 80 现状一致，计数不变（61 / 59 / 27 / 42 / 19 步）。v0.5 五处：
> ① 新增 `F-daemon-platform-binding`（`src/assembly/platform/binding.ts`）：`PlatformBindingPort` 在 daemon 侧的
> **唯一宿主**，与 `wire.ts` 的「平台能力」分工，`REC-OBS-02` 由消费方写、`unverified` 不由本件当失败；
> ② `AUTH-06` 的持久适配定死 **`store/src/records/credentials.ts`**（本件只编排，不直写表）；
> ③ `SEC-MX-BOT-PASSWORD.allowedUses` = `platform-auth` + `outbound-redaction`（**不含** `matrix-register`，
> 删除「保留未用」口径；建号只认 `SEC-MX-HR-SHARED`）；④ `TableProjectionResult.name` 的类型是
> **`TargetTableProjectionName`**（`resourceLedger` ↔ 物理表 `resource_ledger`，目标未建）；⑤ 计数同步：
> 目标件 **61**（42 + 19）、终态 **59**、assembly **27**、测试目标 **42**、迁移 **19** 步（M-s）。
> v0.4 校正五处：
> ① 路由 **16 条**（新增回执查询 `GET /v1/requests/status`，快照缺 ⇒ `503 receipt-not-in-snapshot`，不重放不查库）、
> **M4 11 项**，`assembleApi` 的 `company`/`config`/`issuesView`/`finance` 类型按 80 写死（`ApiCompanySource`/
> `ServeConfig`/`IssuesView`/`FinanceSources`），HTTP `404`=`rejected_precondition`/`EXTERNAL_REJECT`/`not-found`，
> 只读面查询错误 `unsupported`⇒`EVOLVE_REJECT`、`conflict`⇒`EXTERNAL_REJECT`（`STATE_CONFLICT` 不是 category，
> 全文删除）；② Matrix 会话**两个不同秘密类型** `MatrixBotLoginSecret`（`platform-auth`）与
> `MatrixHrRegisterSecret`（`matrix-register`，`SEC-MX-HR-SHARED`），工厂与任一直接面同时给**一律**
> `CONFIG_INVALID`（不比较“矛盾”），`{config}` 分支的 `baseDir` 归 `BootOptions.deploymentBaseDir`；
> ③ 关闭 W-20（80 已定 `rows`=本次处理数、完成 `cursor:null`），投影名写「现状 17 + 目标 `resourceLedger`」；
> ④ 新增 `F-daemon-auth-credentials`（`AUTH-06` 编排件，持久面归 03-store，只存引用不存值）；
> ⑤ stdio 注册按 80 现文改为 **JCS 五键 proof**（`studio-next/jcs@1`、`alg='hmac-sha256-v1'`）+ 宿主注入
> `PeerCredentialVerifier`（Node 24 无内建 peercred，无适配即 `unverified`）。v0.2 按 `ClassifiedError` 两轴、
> `IntentSubmissionPort`/`IntentReceipt`、`assembleApi` 只收 ingress、`openLedgerReadonly`、`SecretCatalogEntry`/
> `SecretProvider`/`KnownSecretSet` 的现场定义重写本卷条目。v0.3 再按 80 现文校正：意图投影改为「同事务 hook +
> commit 后内存快照 + `refresh(key)`/`get`/`rebuild(): TableProjectionResult`」；只读打开唯一路径
> `packages/store/src/ledger/open.ts`（`ReadOnlyLedger.query/get` 同步 `Result`、`Ok(undefined)` 才是不存在）；
> `RunServeOpts` 补 `notifyBroadcast` + `matrixSessionFactory`（daemon 驱动登录、boot 只传工厂）；
> `ServeConfig.secrets`（`catalog`/`fileRoot`/`brokerBinding`）与 `runtime/secrets` 装配链；
> 按 80-§6.9 补 `assembly/spec|auth|migrate` 与 stdio 本地 broker 四个目标件；停机序并回 session close。
> 性质：**自然语言级文件与实现设计呈审稿**，不是现行文件树、实现单或完成证明。
> 上位：75-§五 的文件契约模板、本卷 §一/§二/§四/§六；78-§1.2（`BIND-CORE-01` 20 字段）、§7.4.1（秘密清单）；
> 79-§3.4/§3.5/§3.6、§6.2、§10.1；80-§3.1–§3.6、§5.7（错误两轴）、§6.1（`RuleEvaluator`）、§6.3（`RecordReader`/
> `RecordProjection`/`RecordTransaction`）、§6.4（`WorkIntake`）、§6.6（`PlatformBindingPort`/`MigrationService`/
> `Notifier`/`IntentSubmissionPort`）、§6.8（保留端口）、§8.2（只读打开）、§9.4（`:8788` 装配）、
> §11.2.1（秘密供给）、§11.4.1（stdio 验签）、§12.5（U80-09/13/15/16/17/18）；
> `docs/20-§十五`（层位宪法，机械源 `scripts/guards/boundary-rules.mjs`）。
> 边界：本附录只把 80 的组件与接口落到文件；**不新增公共概念、端口、状态、允许边或依赖版本**。发现 80 缺端口须回写 80（81-§六.3），不在此私设。
> 本 v0.2 **不重定义** 80 已给的签名与 76/77/78 的字段表：条目只写「承载哪个对象 + 文件特有约束」。凡与上位冲突，一律以上位现场文本为准并登记回写（§8.1）。
> 门禁：本文所有「目标/拆分/新增/退役」均为设计处置，尚未执行；不得据此直接改源码、manifest、guards 或依赖清单。
> 标签：`现有` / `库级·未接` / `目标-保留` / `目标-拆分` / `目标-新增` / `目标-替换` / `目标-退役` / `仅测试·演示` / `未证`（81-§四）。

---

## 〇、本附录的范围与复算口径

| 类别 | 件数 | 复算方式 |
|---|---|---|
| 生产源码 | **42** | `find apps/daemon/src/{assembly,cli,control,evolve} -type f \| wc -l` = 41，加 `apps/daemon/src/index.ts` |
| ├ `src/index.ts` | 1 | 根平面唯一散文件（`daemonSrcRootFiles`） |
| ├ `src/assembly/**` | 12 | 含 `serve.ts` 与 11 个其余文件（分布在 6 个子目录） |
| ├ `src/cli/**` | 22 | 直下 22 件，无子目录 |
| ├ `src/control/**` | 2 | `hot-reload.ts`、`stop-channel.ts` |
| └ `src/evolve/**` | 5 | 直下 5 件 |
| 域内测试 | **23** | `find apps/daemon/test/{assembly,cli,control,evolve} -type f \| wc -l` |
| 根级测试（跨包对齐） | **2** | `test/panel-inbox-align.test.ts`、`test/panel-judge-align.test.ts` |
| 包清单 | **1** | `apps/daemon/package.json` |
| 包类型门禁 | **1** | `apps/daemon/tsconfig.json`（只登记与源面的关系；逐文件契约归 19） |

行数为 2026-10-27 复核（`wc -l`）：四个域目录 **8105** 行 + `src/index.ts` **36** 行 = 生产源码 **8141** 行；域内测试 **6798** 行；根级测试 **271** 行。行数只作规模核对，不作能力证据。

〔目标件复算〕本附录**目标件全集 61** = 现有 42 + 目标-新增 19；其中**目标-退役 2**（`src/index.ts`、`cli/external.ts`），
终态在册 **59**。19 个新增件的落点与计数：`assembly/serveconfig/` 2、`assembly/runtime/` 4（含 `secrets.ts`）、
`assembly/platform/` **1**（`binding.ts`，与现有 `wire.ts` 同目录）、`assembly/api/` 1、
`assembly/intent/` 2（**单数目录**，不建 `assembly/intents/`；两套路径即双轨）、
`assembly/spec/` 1、`assembly/auth/` **2**（`assemble.ts` + 新增 `credentials.ts`）、`assembly/migrate/` 1、
`assembly/stdio/` 1、`control/hot-reload/` 4；**域平面直下件数不变**
（assembly 直下仍 1、control 仍 2、evolve 仍 5、cli 22→21）。61 = 1（root）+ 27（assembly 12+15）+ 6（control 2+4）+
5（evolve）+ 22（cli），可逐目录复算。

〔跨卷目标件的登记方式〕下列目标件**归其他附录**，本附录只登记「谁消费、消费什么、受什么约束」，不复制其完整契约（防跨卷重复；81-§六.2「允许引用接口而不复制字段」）：

| 跨卷目标件 | 归属卷 | 本附录的消费点 | 本附录必须遵守的约束 |
|---|---|---|---|
| `packages/contract/src/ports/intent.ts`（`IntentSubmissionPort`、`IntentKey`、`IntentReceipt`、`WebhookIntentPayload`、`IntentSubmitResult`、`ReferralTarget`） | 01-contract | `assembly/intent/ingress.ts` 实现它；`assembly/api/assemble.ts` 只转发 `submit`/`receipt` | 不得在 daemon 内私设第二套回执/键类型；`IntentKey` 第四位恒 `ticket ?? dedupKey` |
| `packages/contract/src/ports/secret.ts`（`SecretCatalogEntry`/`SecretProvider`/`SecretMaterial`/`KnownSecretSet`/`SecretKind`/`SecretUse`/`ValueProvider`/`SubjectScope`） | 01-contract | `assembly/runtime/secrets.ts` 装配 `KnownSecretSet`；`hrsync/assemble.ts` 取脱敏值 | 不得在 daemon 内自造 secret id 或第二套 provider |
| `packages/contract/src/secrets.ts`（`redactOutbound`/`redactKnownSecrets`/`findSecretShaped` 整模块迁入） | 01-contract | `core` 只具名 re-export；本卷 `hrsync/assemble.ts` 过渡期仍从 `@studio-next/core` 取 | 标记形 `<redacted:N>` 与 `MIN_KNOWN_LENGTH=6` 冻结；`core` 不留第二正则 |
| `packages/core/src/work-readiness.ts`（五门纯求值） | 02-core | 本附录**无直接消费点**（五门在相位 2 决策前，归 engine；`assembly` 只装配不判定） | `assembly/**` 不得实现五门或第二套判据；`repo-validate` 不下沉 `core`（80-§10.6） |
| `packages/store/src/ledger/open.ts`（`openLedgerReadonly`/`openLedgerMaintenance`/`migrateIfOwner`/`ReadOnlyLedger`/`ReadOnlyLedgerOpen`；旧双名 `ReadLedger`、`open-readonly.ts` 一律作废） | 03-store（`F-store-ledger-open`） | `assembly/api/assemble.ts` 用只读视图构 `issuesView`；`assembly/migrate/assemble.ts` 用维护写面 | 装配体不得传可写 `Ledger` 进 API；`ReadOnlyLedger.query`/`get` 均**同步** `Result`（`Ok(undefined)` 才是不存在，运行期读失败 `Err(unavailable/STALL, ledger-read-failed)`）；版本不符时原样上抛 `rejected_version/EVOLVE_REJECT` |
| `packages/store` 的 `intent_receipts` 投影（`ProjectionName='intentReceipts'`，表在 `src/migrations/intent.ts`、持久化原语在 `src/ledger/intent-receipts.ts`） | 03-store | `assembly/intent/receipt-store.ts` 经同事务 projection hook 维护它 | 投影只从 `REC-WORK-01/02`、`REC-EVT-03` 派生；删表可重建、逐字段一致；**daemon 不拼 SQL**（只调 store 面的 `upsert`/`replaceAll`/扫描） |
| `packages/store` 的 `resource_ledger` 投影（`TargetTableProjectionName` 第 18 个 = `resourceLedger`，80-§6.3/§6.4 RES-01） | 03-store | `assembly/migrate/assemble.ts` 只登记 MIG-01 建表/版本门槛；本附录**无写入点**（同事务 hook 由 `store` 拥有） | 现状 17 个投影名不动；`resourceLedger` 是**已登记目标名**（类型面按 `TargetTableProjectionName` 可携带），表未建前**运行期**不得返回该 `name`；`ResourceAccountant` 只读、不写投影；`daemon_kv`/`schema_version`/`hr_sync_log` 不是投影名 |
| `packages/contract/src/ports/spec.ts`（`SpecRegistry`/`DefinitionLoader`/`PackageImporter`）+ `packages/core/src/spec/` | 01-contract / 02-core | `assembly/spec/assemble.ts` 提供读盘与包扫描，纯决策在 core | 不得在 daemon 内实现注册/装载/导入六步；`company` 仍管公司目录形状校验（80-§6.9） |
| `packages/contract/src/ports/authority.ts`（AUTH-01…07）+ `packages/core/src/authority/` + `packages/store/src/lease/` | 01-contract / 02-core / 03-store | `assembly/auth/assemble.ts` 组装备选端点、从台账读激活记录；`assembly/auth/credentials.ts` 实现 `TS-PORT-AUTH-06 CredentialCatalogPort`（**只编排**；`REC-AUTH-04` 的写读原语在 store 的 `records/credentials.ts`，目录只存引用侧，**不存值**） | `wkey` 是凭据不是授权；`gateway` 不承载授权判定；无激活记录时 `EffectGateway` 拒写（80-§3.6、§6.9）；凭据目录**不得**成为秘密值的第二存放处（80-§6.9、§11.2.1） |
| `packages/contract/src/ports/migration.ts`（`MigrationService`/`MigrationPlan`/`MigrationReceipt`）+ `packages/store/src/migrations/` | 01-contract / 03-store | `assembly/migrate/assemble.ts` 维护窗口编排 | 维护写面走 `openLedgerMaintenance`；不得在 daemon 运行期并发；schema 迁移（`store/migrations.ts`）不是本端口 |
| `packages/gateway`（`WkeyAuthority` + `encodeAction`/`decodeAction` + `gateWrite` 内核） | 网关包（80-§6.9 `EFF-01` 内核） | `assembly/stdio/broker.ts` 验签、`engine/tools/effect-gateway.ts` 编排 | 动作词编解码只有一份实现（stdio 面与 HTTP 面都调它）；daemon 进程内只持**一个** `WkeyAuthority` |
| `packages/contract/src/ports/binding.ts`（`PlatformBindingPort`/`BindingProfile`/`StateMapping`/`ExportScope`/`ExportBundle`/`ExitPlan` 的**唯一形状源**，80-§6.6 三层第 1 条） | 01-contract | `assembly/platform/binding.ts` 实现它（daemon 侧**唯一宿主**）；平台包 `src/binding.ts` 只供纯函数 | 本卷不复制 20 字段、不自造类型文件；`FlowPlatform` 保持「平台能力」语义，不得改名冒充（80-§6.9 结论） |
| `packages/store/src/records/credentials.ts`（`REC-AUTH-04` 读写原语：登记/解析/吊销 + 引用摘要幂等；复用通用 `records` 表） | 03-store（`F-store-records-credentials`；80-§6.2 `TS-PORT-AUTH-06`、§6.9、D28） | `assembly/auth/credentials.ts` 只编排（校验 draft → 调 store 原语 → 返回 `Qid`/引用） | daemon **不直写表、不拼 SQL、不建第二张秘密表、不新增投影名**；目录只存引用侧，值一律走 `SecretProvider`（80-§6.9、§11.2.1） |

〔事实〕daemon 测试面共 86 个 `.ts`（85 个 `.test.ts` + `test/engine/crash-points.ts`，80-§10.7 同口径）。本附录覆盖其中 **25** 件；其余 **61** 件全在 `test/engine/**`，归 `81-files/16-daemon-engine.md`。

〔排除〕`src/engine/**` 与 `test/engine/**`（16）；`apps/boot`（18）；`packages/**`（01–15）；根 `package.json`/`tsconfig*.json`/`scripts/guards/**`/`templates/**`/`bun.lock`/`docs/**`（19）；`.git`、`node_modules`、生成物、第三方源文件。

〔跨附录边界〕`apps/daemon/src/assembly/api/assemble.ts`（目标-新增，§四.2）落在本附录；`packages/api` 本体归 14，`:8788` 的 panel 旧面与其删除归 13。`cli/external.ts`（目标-退役）与 `panel/external` 的退役**同一波次**，见 §8.1 W-6。

〔口径〕`现有` 行文只描述实测代码与已核调用；「目标」一律是设计处置；「未证」不入能力声明。全文不含 PASS 结论。

---

## 一、层位、允许边与三域纪律

### 1.1 daemon 纵轴（机械源 `boundary-rules.mjs:24-59`）

| 层 | 位 | 成员 |
|---|---|---|
| root | 6 | `src/index.ts`（唯一散文件） |
| cli | 5 | `src/cli/*` |
| assembly | 4 | `src/assembly/**` |
| control / evolve / engine | 3 | 三域同层 |
| engine/tools | 2 | `src/engine/tools/**` |

〔事实〕冻结的纵边共 13 条：`root→assembly`；`cli→{assembly,control,evolve,engine,engine/tools}`；`assembly→{control,evolve,engine,engine/tools}`；`control→engine/tools`；`evolve→engine/tools`；`engine→engine/tools`。

〔结论〕未列出的边一律违例，尤其：`root→cli`、`root→engine`（80-§3.2）、`assembly→cli`（80-§9.4）、`control|evolve→cli`、`control↔evolve`（见 1.3）。本附录所有目标件按此写。

### 1.2 平面、目录与行数预算

| 规则 | 现额 | 上限 | 本附录落点 |
|---|---|---|---|
| `domainPlaneBaselines` | engine 13 / control 2 / evolve 5 / assembly 1 | 只减不增 | assembly 直下仅 `serve.ts`；control 直下仅 `hot-reload.ts`+`stop-channel.ts`；evolve 5 顶格 |
| `daemonSrcRootFiles` | `["index.ts"]` | 1 | 退役 `index.ts` 须同步改基线（提案流） |
| `maxFilesPerDirectory` | cli 22；test/cli 9；test/assembly 6；test/evolve 6；test/control 2 | 25 | cli 余 3；新增命令只能一命令一模块 |
| `maxLinesPerFile` | — | 600 | 见 §六 |

〔事实〕`lineBaseline` 中与本附录相关的 5 条：`src/assembly/serve.ts` 1627、`src/control/hot-reload.ts` 624、`test/control/hot-reload.test.ts` 930、`test/evolve/evolution-e2e.test.ts` 652、`test/evolve/gray.test.ts` 625。基线只许下降（80-§10.6）。

### 1.3 「三域不互引」是文档纪律，不是机械门禁

〔事实〕`control`/`evolve`/`engine` 同为层位 3；`allowedVerticalEdges` 不含同层边，规则注释写明「同层=同域，域内互引自由」。因此 `control→evolve`、`evolve→engine` 这类**同层互引当前不会被 `guard:boundaries` 拦下**。

〔事实〕实测仍合规：`control/*` 只 import `@studio-next/{company,contract,store}`；`evolve/*` 只 import `@studio-next/{contract,core,store}`；`assembly/*` 对 engine 的引用是合法纵边（`assembly→engine`）。当前零互引。

〔结论〕81-§5.4「控制/进化/engine 三域不互引」需落成机制才有约束力：在 `boundary-rules.mjs` 增「同层反向静态边」规则属判据类资产修订（提案流 + 制作人批）。本附录按该纪律书写，并把机制缺口登记为 §8.1 W-5。

### 1.4 IO 与注入纪律（引 79-§3.5，不改写）

〔事实〕79-§3.5 目标六条中与本附录强相关的两条：**⑤ CLI/子进程只在适配器与 assembly 层出现**（`core/prompt/gateway` 不得 import `node:child_process`、`execa`）；**⑥ fs 只在 `company/store/panel/assembly/evolve` 出现**。

〔事实〕现状偏差（本附录范围内，实测 import 图）：

| 偏差 | 实测 | 与 79-§3.5 的关系 |
|---|---|---|
| CLI 直接 fs | **12 件** import `node:fs`：`cli/{candidates,company,cutover,gray,jobs,main,overview,postmortem,reload,sandbox,stop,taiga-cure}.ts` | ⑥ 的白名单**不含 cli** |
| 子进程 | `assembly/**` 零 spawn；`evolve/sandbox.ts` 有 `node:child_process.spawn` | ⑤ 只列「适配器与 assembly」，未列 evolve |

〔结论〕这两处不是「已合规」，而是 79-§3.5 未覆盖的现状面。本附录**不自行放宽**（81-§六.3）：登记为回写项 §8.1 W-2/W-3，给出两条候选路径但不选定（选哪条改变依赖清单与包边，属判据决策）。

〔事实〕时间注入：`evolve/{sandbox,cutover,gray,postmortem}.ts`、`control/hot-reload.ts` 均接 `clock?`（`evolve-guard` 的 `clock` 必填）；`control/stop-channel.ts` 的 `awaitStopResult` 与 `cli/reload.ts`/`cli/stop.ts` 的轮询用裸 `Date.now()`；`serve.ts:1476` 的在途接管亦用裸 `Date.now()`（`runServe` 无 clock 参数）。测试靠短超时而非假时钟 → 登记 §8.1 W-4。

〔结论〕ID：事件 id 由 `makeId`/`idFactory` 注入（缺省 `engine/tools/id.ts` 的 ULID）；`evolve/*` 与 `hot-reload` 已按此形。随机：本附录范围零 `Math.random()`。

### 1.5 错误、结果与观测口径（按 80-§5.7 现场）

〔结论〕**两轴一个载体**。本附录所有目标件、所有新增端口实现一律用 80-§5.7 的 `ClassifiedError`：

```ts
interface ClassifiedError { failure: FailureClass; category: ErrorCategory; subcause: string; detail?: string }
```

- `failure` 取 **77-§11.1 的 14 类**（`rejected_precondition`/`rejected_authority`/`rejected_forbidden`/
  `rejected_state`/`rejected_version`/`rejected_idempotency`/`unsupported`/`unavailable`/`unverified`/
  `partial`/`conflict`/`timeout`/`cancelled`/`degraded`，字面量保留下划线）；**处置（重试/断路/对账/升级）只读它**。
- `category` 是 11 值观测轴，**只喂事件 note 与告警分桶**。`Err` 可达的 `category` 只有 6 个：
  `CONFIG_INVALID`（缺省对应 `rejected_precondition`）、`EVOLVE_REJECT`（`rejected_version`/`unsupported`/`unverified`）、
  `EXTERNAL_REJECT`（`rejected_authority`/`rejected_forbidden`/`rejected_state`/`rejected_idempotency`/`conflict` 缺省）、
  `STALL`（`unavailable`/`partial`/`timeout`/`cancelled`/`degraded`）、`MERGE_CONFLICT`（合并域显式覆盖）、
  `NO_LANE`（**只在显式 lane 上下文**：泳道入口/派工闸手里有 lane 标识时）。其余 5 个
  （`GATE_FAIL`/`WORKER_DEAD`/`QA_BACK`/`DISPATCH_FAIL`/`LLM_FAIL`）是内部事件与熔断域，**不得从普通 `Err` 里选**。
- 构造期非法/不可继续（`configInvalid(...)`、装配期缺件、`parseDaemonConfig` 的畸形行）固定
  `failure:'rejected_precondition'` + `category:'CONFIG_INVALID'`，抛 `ClassifiedError`；`subcause` 取稳定名
  （`config-yaml-nested`、`config-yaml-empty`、`config-yaml-flat`、`external-ingress-missing` …），`detail` 只给人读且过脱敏。
- **HTTP 错误体只有一种形状**：`{ error: { failure, category, subcause }, traceId }`（`422` 外层加 `fieldPath`、
  `413`（`body-too-large`）**不带** `fieldPath`、`429` 加 `retryAfter`、`501` 加 `reason`）。`:8788` 的
  401/403/409/413/422/429/501/503 逐项见 80-§9.4；本卷
  `assembly/api/assemble.ts` 只搬运，不改写形状、不得漏 `failure`。
- **纯读的判据不是拒绝**：`RecordReader.get`/`ReadOnlyLedger.get` 返回 `undefined` = 不存在；表投影失败以
  `kind`/`state` 结论表达（80-§6.3）；`RuleOutcome.outcome` 四值（`true|false|unknown|refused`）与
  `IntakeOutcome.outcome` 五值都**留在 `Ok` 里**，不塞 `Err`——`refused` 是 76 的第四结果，`forwarded` 是转呈不是拒绝。
- **CLI 退码**唯一声明源是 `cli/usage.ts` 的 `USAGE_TAIL`（对账闸 `test/cli/help-face.test.ts`）：`0` 成功/显式求助/判定红是档案面；`1` 用法错/判定不通过/库不存在/超时无回执/分类错误被捕获；`2` 仅两处——`company validate` 判定器自身错误、`serve` 运行中断（tick 异常）。CLI **不抛裸字符串错误码**：命令体内捕获 `ClassifiedError` 后按 `failure` 决定文案与退码，`subcause` 原样打印（不含值、不含绝对路径）。
- **事件**：`SCHEMA_EVOLVE`（热重载 `RELOAD;` 前缀 / 切权 / 灰度回滚）、`ESCALATE`（`RELOAD_CONFIG_INVALID`/`RELOAD_APPLY_FAILED`/`RELOAD_TRUST_DRIFT`/判负自检）、`EVOLVE_REJECT`（状态机非法边，core 原报文）、`POSTMORTEM`。`issue` 哨兵 `'-'`；`tokens` 显式零桶。迁移期事件 note **双写** `failure` 与 `category`（80-§5.7 第 3 条），旧读方继续读 `category`。

〔事实〕分类错误覆盖现状（不是合规声明，§8.1 W-1）：`evolve/**` 45 处 `configInvalid`；`assembly/**` 仅 2 处（`serve.ts:1040/:1054`），其余拒启动面抛**裸 `Error`** 但文案带 `CONFIG_INVALID：` 前缀；`control/**` 0 处（`hot-reload.ts:385` 构造期裸 `Error`）；`cli/**` 0 处。**这些裸 `Error` 不带 `failure`/`category`，调用方只能靠文案判类**——是本卷条目逐件给出的待修项。

〔结论〕`Result<T, ClassifiedError>` 的适用面在本附录内固定为：`assembleApi` 的 `issuesView` 打开、`IntentIngress.submit/receipt`、
`IntentReceiptStore` 的派生失败、`runtime/secrets` 的 `load`、`openLedgerReadonly` 的调用点。其余（`runServe` 启动、
`buildServeRuntime` 装配）**抛** `ClassifiedError`，因为「半装」不存在可继续的返回值。

### 1.6 秘密供给与脱敏（按 80-§11.2.1 / §11.4.1）

〔结论〕本附录范围内的秘密面只有三件事，**不得**自造第四件：

1. **装配期取秘密**：`assembly/runtime/secrets.ts` 按 `ServeConfig.secrets.catalog` 逐条装配（provider **由该配置面产生**，
   **不是** `BuildRuntimeOpts` 的注入键，80-§3.4 第 8 条），取数走 `SecretProvider.load(entry, use)`，`use` 必须 ∈ `entry.allowedUses`，
   否则 `Err(rejected_forbidden)`（不得返回“最接近”的用途值）。`secretId` 恒 `SEC-<域>-<slug>`（**域段按平台取**：
   Taiga=`TG`、Matrix=`MX`、网关=`GW`、按单=`WKEY`；如 `SEC-TG-TOKEN`、`SEC-MX-BOT-PASSWORD`、`SEC-MX-HR-SHARED`、
   `SEC-GW-SIGNING`、按单 `SEC-WKEY-<ticketId>`），**不用** `taiga.<env>` 式别名。**`YT` 只指 YouTrack、`TG` 只指 Taiga，
   两串不可互相冒充**（同一份秘密被拆成两个 ID 就会双份取值、双份脱敏）；
   轮换只递增 `SecretMaterial.version`（provider 的不透明内容代次），**不改 ID**。
   **Matrix 两条秘密的 `allowedUses` 定死（80-§11.2.1 / D23 现行口径）**：`SEC-MX-BOT-PASSWORD` =
   **`platform-auth` + `outbound-redaction`**（**不含** `matrix-register`：请求该 use 即 `rejected_forbidden`，
   不存在「保留未用」的第三用途）；`SEC-MX-HR-SHARED` = `matrix-register` + `outbound-redaction`。
   登录**只**按 `platform-auth` 取 bot 密码，建号**只**认 `SEC-MX-HR-SHARED`——同一 `secretId` 换 use **不是**
   「同义别名」（W-21 已关闭；剩余的 catalog 上限同步只归 78，见 80-S10/§13.2）。
2. **装配前先过滤 `subjectScope`**：只对 `deploymentRefs`/`positionFamilies`/`capabilityRefs` 覆盖本部署的条目 `load`；
   **不得**全量取秘密再筛；**能力关闭 ⇒ 该能力所需条目完全不 `load`**。`KnownSecretSet.state` 三值：`complete` /
   `known-set-empty`（无可选秘密，合法，仍跑形状检测）/ `known-set-partial`（有缺失）。
   **必需缺失 = 该能力拒启动（`CONFIG_INVALID`）；可选缺失 = 不装该能力 + 上报 `missingSecretIds`（`REC-LOSS-01` 由
   `buildServeRuntime` 落）**，不得静默少装。`hrKnownSecrets?: readonly string[]` 降级为测试/装配兜底，与 catalog 并存时
   以 catalog 为准并告警（只记 id 与数量）。
3. **出站脱敏**：`secrets.ts` 整模块迁 `contract`（`redactOutbound`/`redactKnownSecrets`/`findSecretShaped` 三函数 + 正则 +
   `REDACT_MARK` + `MIN_KNOWN_LENGTH`），`core` 只**具名** re-export（`export *` 不用），不留第二套实现或第二正则；
   标记形 `<redacted:N>` 与 `packages/core/test/secrets.test.ts` 的断言冻结。`assembly/hrsync/assemble.ts` 过渡期仍从
   `@studio-next/core` 取（re-export 兜住），迁移完成后改直取 `contract`。**认证入站不脱敏**（`wkey`/`X-SN-Token`/注册表单是校验对象）。

〔结论〕**worker 永不持有 `gatewaySecret`（`SEC-GW-SIGNING`）**；按单 `wkey` 是 `local-mint` 的唯一例外（不进静态 catalog、
不落盘、活跃期才进 `KnownSecretSet`、`CLOSE` 即移除并留一个去重窗兜底）。`assembly/runtime/keys.ts` 只注入 `WorkerKeyDeps`，
`assembly/api/assemble.ts` 与 `IntentIngress` 都不接触任何秘密值。

〔事实〕stdio 工具面（80-§11.4.1）的**传输/注册协议归 `studio-tools`（15 卷）**，daemon 侧只承担「在 daemon 内验签、吊销、审计」
与本地 socket（`run/daemon.sock` 或 `STUDIO_DAEMON_SOCK`，目录 `0700`/文件 `0600`）的
`register → registerChallenge → registerProof → registerAck` / `call → verdict`。
**现状未实现（U80-17）**；本附录 v0.3 已定 daemon 侧落点 `assembly/stdio/broker.ts`（`F-daemon-stdio-broker`，
§8.1 W-13 由「无落点」收窄为「80 未登记该路径」），协议仍以 80-§11.4.1 为唯一主文，**不得**在本卷另造一套。
v0.4 按 80 现文补齐两件：① `registerProof` 的 HMAC **输入是 `studio-next/jcs@1` 规范化后的 UTF-8 字节**，
对象**恰五键** `protocol`/`challenge`/`helperId`/`pid`/`wkeyRef`（字典序、无空白），`alg='hmac-sha256-v1'`，
**不是**字符串拼接；② 对端身份只来自宿主注入的 `PeerCredentialVerifier`——**Node 24 无 `getpeereid`/`SO_PEERCRED`
内建 API**，无已验证适配即 `unverified`（日志/审计/上报不得写 `peer-verified` 或「peer uid 已核」），
核心信任仍是 challenge-proof + 活跃签发 + scope 三件。凭据目录（`CredentialCatalogPort`/`REC-AUTH-04`）
是**逻辑引用目录，不是第二秘密源**：stdio 与 `core/auth` 都不得从它取值。

### 1.7 入口与装配点（80-§3.1/§3.2）

〔事实〕本附录范围内有**四个**「进程从哪进、栈从哪装」的落点；80-§3.1 划定职责后**不得互相替代**：

| 落点 | 文件 | 现状职责 | 目标职责 | 禁止 |
|---|---|---|---|---|
| CLI 命令面 | `src/cli/main.ts` + 21 件 | 18 命令 `switch`；`serve` 子命令调 `runServe` 并定退码 | 不变；`external` 退役后余 17 命令 | 不得在 `main.ts` 里装配运行栈（装配归 `assembly/`） |
| 包入口 | `src/index.ts`（36 行） | `BANNER` + 3 行 `console` + `process.exit(0)`，**零 export** | 收敛为纯再导出（`runServe`/`parseDaemonConfig`/`DEFAULT_SERVE_CONFIG` + types） | 不得承载任何逻辑（M-b）；不得被新代码 import（M-i 后退役） |
| 组合根 | `apps/boot/**`（**域外**，本附录只涉边界） | 构造 matrix 源/房间面/notify 广播面/hr 执行面，经 `RunServeOpts` 注入 | 构造 `matrixSessionFactory` 并传入（**只构造，不登录、不解析秘密、不持 token**，80-§3.4 第 10 条）；直接四面保留为测试/迁移兼容，**与工厂同时给 ⇒ 一律 `CONFIG_INVALID`**；`{config}` 分支的 `matrixDeptMap` 基准由 `BootOptions.deploymentBaseDir` 显式给 | 不得被 daemon import（`boot→daemon` 单向；反引由 `guard:boundaries` 冻结）；不得持秘密值 |
| API 装配点 | `src/assembly/api/assemble.ts`（**目标-新增**） | 不存在；`:8788` 现由 `cli/external` + `panel/external` 提供 | `assembleApi(deps: AssembleApiDeps)` → `ApiServerOptions`（`deps = { ingress: Pick<IntentSubmissionPort,'submit'\|'receipt'>, ledgerPath, companies: readonly ApiCompanySource[], config: ServeConfig }`，**无 `now`**），同进程 `serveApi`，**晚于 `rebuild`/`replayQueued`** | 不得自起进程、自立 `bin`、**不收 `engine`**、不持可写 `Ledger` |

〔结论〕第 6 步（`buildServeRuntime`）是**唯一**创建 `IntentIngress` 的地方：**先**完成秘密面/会话面装配与
`receipts.rebuild()`（失败即拒启），**再**建 ingress——它关联 `WorkIntake`（`REC-WORK-01` 唯一写者）、
`engine`（**只**用于 `ingest` 入队）、可写 `Ledger`（投影维护者 `IntentReceiptStore` 用，**投影 hook 与 `reserve` 同事务**、
commit 后同微任务刷快照）与入口白名单 `config.external.allowedSources`，对外只暴露 `submit`/`receipt`
（工厂返回的**内部类型** `IntentIngressInternal` 另含 `replayQueued()`，**只由 `buildServeRuntime` 持有**并在启动末调用一次，
且必须在 `rebuild()` 成功之后，不给装配体/HTTP）。第 7 步的装配体只拿 `Pick<IntentSubmissionPort,'submit'|'receipt'>`，
因此类型上**拿不到** `ingest`、写口与可写台账；`emitIntent`/`getIntentReceipt` 就是这两个方法的原样转发（80-§9.4 决策 1）。
`cli/external` 不得再拥有装配权：它**最终退役**，其间最多打印「请用 `studio-next serve`」。

〔事实〕入口契约矩阵（`apps/daemon/package.json` 与仓根 `package.json`，实测原值）：

| 键 | 现状值 | 目标值 | 迁移步 |
|---|---|---|---|
| `main` | `src/index.ts` | **删** | M-a |
| `exports["."]` | `./src/index.ts` | **删** | M-a |
| `exports["./engine"]` | `./src/engine/engine.ts` | 保留 | — |
| `exports["./serve"]` | `./src/assembly/serve.ts` | 保留（拆分后仍由 `serve.ts` 转出，导入路径不变） | M-c/M-d 不得破 |
| `bin["studio-next"]` | `./src/cli/main.ts` | 保留 | — |
| `scripts.start` | `node src/index.ts` | `node apps/daemon/src/cli/main.ts serve` | M-a |
| 仓根 `scripts.daemon` | `node apps/daemon/src/index.ts` | `node apps/daemon/src/cli/main.ts serve` | M-a |

〔事实〕`bin` 之所以可用：`cli/main.ts` 首行 `#!/usr/bin/env node` 且有可执行位（实测 `-rwxrwxrwx`），Node 24 直接执行 `.ts`（原生 type-stripping）；`index.ts` 既无 shebang 也无导出，作为包入口只能被 `import` 出空面。

〔纪律〕三步**不可倒**：① 先删 `main`/`exports["."]` 并改两处脚本（M-a）→ ② 再把 `index.ts` 收敛为纯再导出（M-b）→ ③ 最后全仓零 import 后退役 `index.ts`（M-i，改 `daemonSrcRootFiles` 基线属**提案流**）。倒序会让包根入口先指向已删文件。

---

## 二、现有件全集（42 件）

### 2.1 `src/index.ts`（1 件，36 行）

36 行：头注 + `TODO` 里程碑清单 + 横幅常量 + 三行 `console.log` + `process.exit(0)`。**有副作用**，且是包 `main` 与 `exports["."]` 的指向。

### 2.2 `src/assembly/**`（12 件，2651 行）

| 文件 | 行数 | 一句话 |
|---|---|---|
| `assembly/serve.ts` | 1627 | 配置类型/缺省/解析 + `buildServeRuntime` + `runServe` 主循环与停机（行数基线 1627） |
| `assembly/serveconfig/coerce.ts` | 23 | 标量强制件 `str`/`num`/`bool` |
| `assembly/hrsync/config.ts` | 215 | `HrServeConfig` 十键 + 缺省 + 逐键收窄 + 交叉校验 + 秘密收集 + 房间表解析 |
| `assembly/hrsync/assemble.ts` | 159 | HR 同步装配（源/执行面/秘密面）与 apply 段 |
| `assembly/hrsync/run-serve-opts.ts` | 35 | `RunServeOpts`（部署注入唯一源，现三键） |
| `assembly/platform/wire.ts` | 148 | 平台网关装配：gated platform、taiga 凭据/字段映射/状态 provision |
| `assembly/notify/notify.ts` | 91 | 通知中继装配（`relayEvents` + `costNoticeOutlet` + PATROL 计量） |
| `assembly/channels/channels.ts` | 93 | Matrix 频道供给面：校验、装配、启动、重保 |
| `assembly/sources/jobs.ts` | 95 | 四类定时源注册（cadence/sla/freshness/costGuard） |
| `assembly/jobs-seed/jobs-seed.ts` | 82 | 公司 `jobs` → 台账播种/移除 |
| `assembly/render/tick.ts` | 36 | 拍日志渲染（纯） |
| `assembly/demo/demo-snapshot.ts` | 47 | demo 公司快照常量（仅演示） |

### 2.3 `src/cli/**`（22 件，2282 行）

| 文件 | 行数 | 一句话 |
|---|---|---|
| `cli/main.ts` | 114 | 18 命令 `switch` 分发 + help/version 面 + `process.exitCode` 收尾 |
| `cli/usage.ts` | 296 | 命令文档单一源：`SECTION`/`CONCISE`/`USAGE_HEADER`/`USAGE_TAIL`/`USAGE` |
| `cli/help.ts` | 84 | `wantsHelp`/`suggestNear`/`usageFail`/`helpOk`/`missingSub`/`unknownSub` |
| `cli/argv.ts` | 61 | 零依赖 argv 解析（`--k v` 与 `--k=v` 两式）+ `errText` |
| `cli/init.ts` | 54 | `init`：模板 → 公司目录 |
| `cli/gen-templates.ts` | 37 | `gen-templates`：分级模板再生成 |
| `cli/company.ts` | 291 | `company add\|create\|validate` + 组分发 |
| `cli/validate.ts` | 74 | `company check` 正位面 + `validate` 兼容别名 |
| `cli/ledger.ts` | 81 | `ledger drill\|dump\|rebuild` |
| `cli/candidates.ts` | 73 | `candidates list`（只读） |
| `cli/jobs.ts` | 102 | `jobs list\|catchup` |
| `cli/sandbox.ts` | 73 | `sandbox`：进化链沙箱 |
| `cli/cutover.ts` | 85 | `cutover`：进化链切权 |
| `cli/gray.ts` | 91 | `gray`：灰度窗查/检/关 |
| `cli/postmortem.ts` | 93 | `postmortem`：复盘归档 |
| `cli/panel.ts` | 47 | `panel`：`:8791` 只读监控 |
| `cli/overview.ts` | 195 | `overview`：`:8789` 公司概览 + 报表目录扫描 |
| `cli/external.ts` | 143 | `external`：`:8788` 对外 API（现由 panel 旧面提供） |
| `cli/serve.ts` | 60 | `serve`：`runServe` 薄壳 + daemon.yaml 骨架渲染 |
| `cli/taiga-cure.ts` | 79 | `taiga-cure`：Taiga 出厂态根治三步 |
| `cli/reload.ts` | 77 | `reload`：控制面热重载手动触发 |
| `cli/stop.ts` | 72 | `stop`：控制面优雅停机 |

### 2.4 `src/control/**`（2 件，759 行）

| 文件 | 行数 | 一句话 |
|---|---|---|
| `control/hot-reload.ts` | 624 | L1 热重载：stat 指纹 + 控制面通道 + 重装载执行 + 事件落账（行数基线 624） |
| `control/stop-channel.ts` | 135 | 停机文件通道：请求/回执/消费/去重位 |

### 2.5 `src/evolve/**`（5 件，2413 行）

| 文件 | 行数 | 一句话 |
|---|---|---|
| `evolve/cutover.ts` | 459 | 切权：状态闸 + 判负闸 + 备份 + 原子写 + 复核 + 迁移 + 事件 |
| `evolve/evolve-guard.ts` | 244 | 判负闸 `authorize` + serve 启动自检（观察模式） |
| `evolve/gray.ts` | 550 | 灰度观察窗：开窗/检查/自动回滚/关窗 |
| `evolve/postmortem.ts` | 590 | 复盘 → 案例库条目 → `POSTMORTEM` 事件 |
| `evolve/sandbox.ts` | 570 | 沙箱执行器：tmp 隔离 + 最小集 + 补丁 + 命令 + 证据 |

### 2.6 包清单与门禁（2 件）

`package.json`（1253 字节）：`name "@studio-next/daemon"`、`version 0.1.0`、`private true`、`type module`、`main src/index.ts`、`exports { ".": ./src/index.ts, "./engine": ./src/engine/engine.ts, "./serve": ./src/assembly/serve.ts }`、`bin { studio-next: ./src/cli/main.ts }`、`scripts { start: node src/index.ts, typecheck: tsc --noEmit -p tsconfig.json }`。
`tsconfig.json`（161 字节）：`extends ../../tsconfig.base.json`，`include ["src/**/*.ts"]`。

---

## 三、处置总表（现有 → 目标）

| 稳定 ID | 路径 | 处置 | 依据 |
|---|---|---|---|
| `F-daemon-index` | `src/index.ts` | **目标-退役**（三步，第三步） | 80-§3.2 / §10.1 |
| `F-daemon-serve` | `src/assembly/serve.ts` | **目标-拆分**（留 run 入口） | 80-§10.4 / 81-§3.2 |
| `F-daemon-serveconfig` | `src/assembly/serveconfig/serve-config.ts` | **目标-新增**（从 serve.ts 拆出） | 80-§10.4 |
| `F-daemon-parse` | `src/assembly/serveconfig/parse.ts` | **目标-新增**（从 serve.ts 拆出） | 80-§10.4 / 79-§3.3 |
| `F-daemon-coerce` | `src/assembly/serveconfig/coerce.ts` | 目标-保留 + 扩为收窄/交叉校验家 | 80-§10.4 |
| `F-daemon-runtime` | `src/assembly/runtime/build.ts` | **目标-新增**（从 serve.ts 拆出） | 80-§10.4 |
| `F-daemon-runtime-keys` | `src/assembly/runtime/keys.ts` | **目标-新增**（从 serve.ts 拆出） | 80-§10.4 |
| `F-daemon-runtime-demo` | `src/assembly/runtime/demo.ts` | **目标-新增**（从 serve.ts 拆出） | 80-§10.4 |
| `F-daemon-api-assemble` | `src/assembly/api/assemble.ts` | **目标-新增** | 80-§9.4 / §3.6 第 7 步 |
| `F-daemon-intent-ingress` | `src/assembly/intent/ingress.ts` | **目标-新增**（daemon 侧意图入口，实现 `IntentSubmissionPort`） | 80-§6.6 / §3.6 第 6 步 |
| `F-daemon-intent-receipt-store` | `src/assembly/intent/receipt-store.ts` | **目标-新增**（`intent_receipts` 投影维护者） | 80-§6.6 / §6.3 |
| `F-daemon-runtime-secrets` | `src/assembly/runtime/secrets.ts` | **目标-新增**（`KnownSecretSet` 装配） | 80-§11.2.1 |
| `F-daemon-hrsync-config` | `src/assembly/hrsync/config.ts` | 目标-保留 | 80-§3.3 |
| `F-daemon-hrsync-assemble` | `src/assembly/hrsync/assemble.ts` | 目标-保留 | 80-§3.4 |
| `F-daemon-run-serve-opts` | `src/assembly/hrsync/run-serve-opts.ts` | 目标-保留 + **补 `notifyBroadcast` 与 `matrixSessionFactory`** | 80-§3.4 / 81-§3.2 |
| `F-daemon-platform-wire` | `src/assembly/platform/wire.ts` | 目标-保留 | 80-§9.5 |
| `F-daemon-platform-binding` | `src/assembly/platform/binding.ts` | **目标-新增**（`PlatformBindingPort` 唯一宿主：绑定档案，非平台能力） | 80-§6.9（`TS-PORT-BIND-01`）/ §4.8 |
| `F-daemon-spec-assemble` | `src/assembly/spec/assemble.ts` | **目标-新增**（读盘与包扫描） | 80-§6.9（SPEC-01/02/03） |
| `F-daemon-auth-assemble` | `src/assembly/auth/assemble.ts` | **目标-新增**（授权三段准备） | 80-§3.6 / §6.9（AUTH-01…07） |
| `F-daemon-auth-credentials` | `src/assembly/auth/credentials.ts` | **目标-新增**（`AUTH-06` 凭据目录：只存引用，不存值） | 80-§6.9（`TS-PORT-AUTH-06`）/ §11.2.1 |
| `F-daemon-migrate-assemble` | `src/assembly/migrate/assemble.ts` | **目标-新增**（维护窗口编排） | 80-§6.9（MIG-01） |
| `F-daemon-stdio-broker` | `src/assembly/stdio/broker.ts` | **目标-新增**（本地 socket 工具面：注册/验签/代办） | 80-§11.4.1 |
| `F-daemon-notify` | `src/assembly/notify/notify.ts` | 目标-保留 | 80-§9.1 |
| `F-daemon-channels` | `src/assembly/channels/channels.ts` | 目标-保留 | 80-§3.4 |
| `F-daemon-sources-jobs` | `src/assembly/sources/jobs.ts` | 目标-保留 | 80-§7.1 |
| `F-daemon-jobs-seed` | `src/assembly/jobs-seed/jobs-seed.ts` | 目标-保留 | 80-§7.9 |
| `F-daemon-render-tick` | `src/assembly/render/tick.ts` | 目标-保留（纯） | — |
| `F-daemon-demo-snapshot` | `src/assembly/demo/demo-snapshot.ts` | 目标-保留（**仅演示**） | 81-§3.1 |
| `F-daemon-hot-reload` | `src/control/hot-reload.ts` | **目标-拆分**（留 facade） | 80-§10.5 |
| `F-daemon-hot-reload-fingerprint` | `src/control/hot-reload/fingerprint.ts` | **目标-新增** | 80-§10.5 |
| `F-daemon-hot-reload-channel` | `src/control/hot-reload/channel.ts` | **目标-新增** | 80-§10.5 |
| `F-daemon-hot-reload-execute` | `src/control/hot-reload/execute.ts` | **目标-新增** | 80-§10.5 |
| `F-daemon-hot-reload-event` | `src/control/hot-reload/event.ts` | **目标-新增** | 80-§10.5 |
| `F-daemon-stop-channel` | `src/control/stop-channel.ts` | 目标-保留 | 80-§3.6 第 10 步 |
| `F-daemon-cutover` | `src/evolve/cutover.ts` | 目标-保留 | 20-§九 |
| `F-daemon-evolve-guard` | `src/evolve/evolve-guard.ts` | 目标-保留 | 80-§6.8 |
| `F-daemon-gray` | `src/evolve/gray.ts` | 目标-保留 | 20-§四 |
| `F-daemon-postmortem` | `src/evolve/postmortem.ts` | 目标-保留 | 20-§十一 |
| `F-daemon-sandbox` | `src/evolve/sandbox.ts` | 目标-保留 | 20-§九 |
| `F-daemon-cli-main` | `src/cli/main.ts` | 目标-保留（分派表随命令增） | 80-§3.1 |
| `F-daemon-cli-usage` | `src/cli/usage.ts` | 目标-保留（单一文档源） | docs/17-§2 |
| `F-daemon-cli-help` | `src/cli/help.ts` | 目标-保留（24 件时与 usage 合并预案） | 80-§10.7 |
| `F-daemon-cli-argv` | `src/cli/argv.ts` | 目标-保留 | 79-§3.1 |
| `F-daemon-cli-init` | `src/cli/init.ts` | 目标-保留 | 80-§10.7 |
| `F-daemon-cli-gen-templates` | `src/cli/gen-templates.ts` | 目标-保留 | 80-§10.7 |
| `F-daemon-cli-company` | `src/cli/company.ts` | 目标-保留 | 80-§10.7 |
| `F-daemon-cli-validate` | `src/cli/validate.ts` | 目标-保留（别名退役须批示） | 80-§10.7 |
| `F-daemon-cli-ledger` | `src/cli/ledger.ts` | 目标-保留 | 80-§10.7 |
| `F-daemon-cli-candidates` | `src/cli/candidates.ts` | 目标-保留 | 80-§10.7 |
| `F-daemon-cli-jobs` | `src/cli/jobs.ts` | 目标-保留 | 80-§10.7 |
| `F-daemon-cli-sandbox` | `src/cli/sandbox.ts` | 目标-保留 | 20-§九 |
| `F-daemon-cli-cutover` | `src/cli/cutover.ts` | 目标-保留 | 20-§九 |
| `F-daemon-cli-gray` | `src/cli/gray.ts` | 目标-保留 | 20-§四 |
| `F-daemon-cli-postmortem` | `src/cli/postmortem.ts` | 目标-保留 | 20-§十一 |
| `F-daemon-cli-panel` | `src/cli/panel.ts` | 目标-保留 | 80-§9.2 |
| `F-daemon-cli-overview` | `src/cli/overview.ts` | 目标-保留 | 80-§9.3 |
| `F-daemon-cli-external` | `src/cli/external.ts` | **目标-退役**（M3 后） | 80-§9.4 |
| `F-daemon-cli-serve` | `src/cli/serve.ts` | 目标-保留（目标唯一 daemon 启动入口） | 80-§3.2 |
| `F-daemon-cli-taiga-cure` | `src/cli/taiga-cure.ts` | 目标-保留 | docs/52-§十 |
| `F-daemon-cli-reload` | `src/cli/reload.ts` | 目标-保留 | docs/38-§2 |
| `F-daemon-cli-stop` | `src/cli/stop.ts` | 目标-保留 | DEV-9/DEV-41 |
| `F-daemon-package-json` | `package.json` | 目标-保留 + **删 `main`/`exports["."]`**、`start` 改指 CLI、依赖分类归正 | 80-§3.2 / 79-§10.1 |
| `F-daemon-tsconfig` | `tsconfig.json` | 目标-保留（测试入门的缺口登记） | 79-D10 |

〔结论〕**src 目标件全集 61 件** = 现有 42 + 目标-新增 19（另包清单/门禁 2 件，见 §4.5）；其中 **目标-退役 2** 件（`index.ts`、`cli/external.ts`），终态在册 **59** 件。19 个新增件全部落在既有子目录或新建子目录（`serveconfig/` 2、`runtime/` 4、`platform/` 1、`api/` 1、`intent/` 2、`spec/` 1、`auth/` 2、`migrate/` 1、`stdio/` 1、`hot-reload/` 4），**不增域平面直下件数**：assembly 直下仍 1、control 直下仍 2、evolve 仍 5、cli 仍 22（退役后 21）。复算：42 + 19 − 2 = 59；目录侧 1 + (12+15) + (2+4) + 5 + 22 = 61。

〔结论〕无「目标-替换」件：切权/灰度/复盘/沙箱四刀的职责在 `evolve/` 内保留，不迁往他包；`panel/external → assembly/api` 的替换只发生在 panel 侧文件（归 13）。`F-daemon-intent-ingress`/`F-daemon-intent-receipt-store` 不是替换：`IntentInbox` 的旧提法在 80-§6.6 已作废，本卷不设第二入口。

---

## 四、逐文件契约：根 / assembly / control / evolve / 包清单

条目字段对齐 75-§五。层位/允许边/尺寸/IO 口径在 §一 与各域前言统一声明，条目只写**文件特有约束**（75-§五 允许「承载哪个对象」，不复制 80 已定义的签名与 76 的字段表）。

〔事实〕分类错误覆盖现状见 §1.5（`evolve/**` 45 处 `configInvalid`；`assembly/**` 2 处；`control/**`、`cli/**` 0 处）。**目标口径**：本卷每件的「错误与观测」行只写该件特有的 `failure` + 缺省 `category` + `subcause`，不重复 §1.5 的通用表；凡现状是裸 `Error` 的，条目写「现状/目标」两段，**不得**把目标写成现状。

### 4.1 根平面（1 条）

```text
F-daemon-index
- 路径/处置：apps/daemon/src/index.ts；36 行；现有副作用横幅；目标-退役（80-§3.2 三步，第三步）。
- 归属：80-§3.1/§3.2/§10.1（D75-11 收敛方案）；根平面唯一散文件（boundary-rules daemonSrcRootFiles）。
- 职责：过渡期「无副作用、只再导出 assembly/serve.ts 装配面」。非职责：不是组合根、不读配置、不开库、
  不 exit、不 import cli/engine（root→cli、root→engine 均不在允许边内）。
- 内部（现状）：BANNER 常量 + 3 行 console.log + process.exit(0)；零 export、零 import。
  目标（过渡期）：export { runServe, parseDaemonConfig, DEFAULT_SERVE_CONFIG } 与
  export type { ServeConfig, ServeRuntime, ServeResult }，全部来自 './assembly/serve.ts'。
- 导出与依赖：现状无导入；目标仅 './assembly/serve.ts'。包级 `exports["."]` 目标删除（80-§3.2 第 3 条）。
- IO/状态：现状模块顶层即 IO（console + exit）；目标零 IO、零模块级状态。
- 错误/观测：现状不产生错误面（恒 exit 0）；目标无错误面。
- 测试与证据：仓内零包根消费者（boot 走 ./serve 与 ./engine，80-§3.1 已核）；迁移证据=全仓
  `rg "from '@studio-next/daemon'"` 为空 + `bun run guard:boundaries` 绿。
- 规模/迁移序（不可倒）：① 删 package.json 的 main/exports["."]、根 "daemon" 脚本与 scripts.start
  改指 `node apps/daemon/src/cli/main.ts serve`；② index.ts 收敛为纯再导出；③ 确认零 import 后退役
  （须同步改 daemonSrcRootFiles 基线，提案流）。
```

### 4.2 `src/assembly/**`（27 条 = 现有 12 + 目标新增 15）

〔域前言〕层位 **assembly(4)**；允许 import `control`/`evolve`/`engine`/`engine/tools` 与本域内件；**不得 import cli**（80-§9.4）；跨包允许边见 §1.1 与 daemon manifest（§4.6）。本域无 `node:child_process`；`node:net` **只许**出现在 `assembly/stdio/broker.ts`（单点，§8.1 W-13 收窄为「已定落点」）。新子目录为 `serveconfig/`、`runtime/`、`api/`、`intent/`（**单数**，不建 `intents/`）、`spec/`、`auth/`、`migrate/`、`stdio/`；`platform/` 是既有子目录（`wire.ts`），新增件 `binding.ts` 与它同目录且**只此一件**（绑定宿主唯一）。拒启动错误现状以裸 `Error` 为主（§1.5），目标一律 `ClassifiedError`。

〔域前言·装配顺序硬约束〕本域有**四条不可倒的序**：① `WorkIntake.reserve`（落 `REC-WORK-01`）→ 同事务投影 hook → commit 后同微任务刷快照 → `engine.ingest`（80-§6.6）；② 只读台账打开须在 daemon 已迁移之后（版本不符即拒，不得自动迁移，80-§8.2）；③ **schema 闸 → `receipts.rebuild()` → `replayQueued()` → API 装配**（80-§6.6 第 9 条；`rebuild` 失败即拒启动，重建完成前没有可服务的 `receipt()`）；④ API 句柄关闭先于 `engine.dispose()` 与 `ledger.close()`（80-§3.6 第 10 步）。

```text
F-daemon-serve
- 路径/处置：src/assembly/serve.ts；1627 行（lineBaseline 1627）；目标-拆分（80-§10.4），本文件留 run 入口。
- 归属：80-§3.3（ServeConfig 唯一类型）、§3.4（RunServeOpts 收口）、§3.6（十步启停）、§10.4（拆分）；
  81-§3.2（拆分先解类型环）、§3.3（新增语义须有文件家）。
- 职责：serve 路径的装配总入口——解析 daemon.yaml（或收已解析 `config`，二选一）→ 开台账与迁移 → 在途接管
  → 装载公司目录（可选）→ 平台探针 → 建运行栈（**秘密面/会话面 → `receipts.rebuild()` → `IntentIngress` →
  启动末 `replayQueued()`**）→ 起唤起源 →（可选）对外 API → 七相位循环 → 停机收口与回执。
  非职责：不做决策（归 engine.tick）、不写公司目录（只读快照）、**不实现意图受理**（`WorkIntake` 归 core/engine，
  本文件只把它接进 `IntentIngress`）、不实现 `:8788` 路由（归 `packages/api`，装配在 §四.2 `assemble.ts`）、
  **不实现 Matrix 登录**（登录由 `matrixSessionFactory` 实现；本文件只按秘密面构造 `MatrixBotLoginSecret`
  与建号用的 `MatrixHrRegisterSecret` 并**驱动**调用；两型不得互换）。
- 内部结构（现状实测锚）：
  · 类型 ServeConfig(:147, extends HrServeConfig)、DEFAULT_SERVE_CONFIG(:371)、ServeRuntime(:822)、
    ServeResult{ticks; stopReason:'signal'|'stop-request'|'error'; lastError?}(:1434)
  · 函数 parseDaemonConfig(text)(:427) → coerceServeConfig(raw)(:456, 私有) → parseScalar(:413, 私有)；
    buildServeRuntime(config, ledger, snapshot, opts?)(:880)；**目标**
    `runServe(input: { configPath: string } | { config: ServeConfig }, opts?: RunServeOpts): Promise<ServeResult>`
    ——判别联合、**二选一不得同时给**；现状 `runServe(configPath, opts?)`(:1445) 与 boot 的预解析会对同一份 YAML
    **解析两次**（两次之间文件可被改写），80-§3.4 第 7 条明令禁止；CLI 传 `{ configPath }`，boot 传 `{ config }`
  · 私有装配件 realGateMode(:746)、daemonIdentity(:778)、wireWorkerKeys(:806)；常量 MATRIX_MANIFEST(:860)、
    ACCEPTANCE(:870)；导出常量 DEV_GATEWAY_SECRET(:411)
  · re-export 面（拆件后须保持导入路径不变或按目标迁走）：:127 taiga 三件、:129 MatrixRoomFace*、
    :131 NotifyBroadcastFace*、:743 DEMO_SNAPSHOT、:819 seedJobs/removeMissingJobs、:1424
    takeOverRunningWorkRecords、:1431 renderNoopDecision/noopLinesOf
- 配置键归属：全部 `ServeConfig` 键在本文件（目标迁 serveconfig/）；`HrServeConfig` 十键在 hrsync/config.ts；
  `external` 的七个目标键是 `enabled/port/lan/token/requestsPerMinute/idempotencyTtlMs/allowedSources`，
  现状**一个都不存在**（80-§3.3 第 5 条）。缺省：`enabled=false`、`port=8788`、`lan=false`、
  `allowedSources` **恰为 `['external-api']`**（不是 `['*']`，也不是“空=全放行”）；开启时 `token`/`requestsPerMinute`/
  `idempotencyTtlMs` 必配且后两者为正整数（缺任一 / 空串 / 非正整数 ⇒ `CONFIG_INVALID` 整机拒启，**没有**
  「未配 token = 触发面全 401」的降级态）。`allowedSources` 形状校验只管形状：非数组 / 含非字符串 / 非法格式 /
  重复项 / **显式空数组** ⇒ `CONFIG_INVALID` **拒启动**（空数组不是「触发面全 403」的运行态，也不是「全放行」）。
  `external.enabled: false` ⇒ **不读、不校验、零行为**：不读 token 文件/provider、不校验开启态必配项、
  不装配面、无句柄，关闭动作是无操作（YAML 形状解析与其它键同，不额外多做）。`now` **不是** YAML 键，
  只属 `BuildRuntimeOpts` 的测试注入。
  `secrets` 是**秘密供给的唯一配置面**（不是第二套 catalog，80-§3.3 第 6 条）：键集固定
  `catalog`/`fileRoot`/`brokerBinding`；`catalog: SecretCatalogEntry[]` 缺省 `[]`（`known-set-empty` 合法）、
  `fileRoot?` 是部署相对路径根（`file-ref` 解析根，不得写死绝对路径）、`brokerBinding?` 只是**已注册绑定名**
  （不是句柄、不是凭据）。配置面**只放引用**：出现内联秘密值（键名含 `value`/`secret`/`password`/`token` 的串）、
  未登记键、`catalog` 元素缺 `secretId`/`kind`/`subjectScope`/`allowedUses`/`valueProvider`/`rotationRef`/
  `revocationRef`、`secretId` 重复或不合 `SEC-<域>-<slug>` ⇒ `CONFIG_INVALID` **整机拒启**（`coerce` 段判，不是运行期才炸）。
  能力关闭（`external.enabled=false`、Matrix/HR 面关）⇒ **不调 `load`、不构造 `KnownSecretSet` 元素**。
- 导出与依赖：包 import=adapters/company/core/contract/gateway/store（§2.2 实测）；对 engine 的引用为合法纵边
  （`assembly→engine`）；对 `@studio-next/company` 另有一处**动态 import**（:1495，79-§4.3 白名单内）。
  目标另新增 `@studio-next/api`（M3 起为真实调用，见 §4.5 依赖裁决）与 `@studio-next/store` 的只读打开件。
- IO 与注入：fs=`readFileSync(path.resolve(configPath))`(:1470)；信号=`process.once('SIGINT'/'SIGTERM')`(:1487)，
  停机时 `process.off` 两处(:1624-1625)；console 日志；`Date.now()` 三处（:1476 接管、:1604 拍 deadline、
  :1605 轮询比较）；env 只经 platform/hrsync 子件（凭据 `TAIGA_*`）。`opts` 四键为面工厂注入，
  **不含 log/clock**；clock 只在 `buildServeRuntime` 内部生成并下传——**runServe 无法注入假时钟**（§8.1 W-4）。
  **目标**：`runServe` 的 clock/now 经 `BuildRuntimeOpts` 注入（缺省墙钟），接管步改用注入时钟；`Date.now()` 不得留在判定路径。
- 状态与并发：单进程单循环；`stopped` 布尔 + 双信号 `once`；停机序见下表（`stop()` 在 :1399-1404）。
  在途接管在**开库后、装公司目录前**（纯台账面，零平台 IO）；`ledger.close()` 在 `stop()` 内单点调用。
- 错误与观测：解析/收窄段裸 Error（:435/:440/:443 行级、:468 platform 值域、:498/:506/:520/:524 预算与队列、
  :543 alarm、:680/:688 taiga 值域、:703 未知键、:715 taiga 缺键、:729 交叉校验、:1248 matrix 注入、:1261
  fileWatchPath）；`configInvalid` 仅 :1040/:1054（judge 面）；tick 异常 → `stopReason='error'` + `lastError`，
  **不 rethrow、不 exit**（退码由 `cli/serve.ts` 按 `ServeResult` 定 0/1/2）；启动/停机日志 6 行固定文案。
  **目标**：所有拒启动面改抛 `ClassifiedError`，`failure='rejected_precondition'` + `category='CONFIG_INVALID'` +
  稳定 `subcause`（`config-file-missing`/`config-yaml-nested`/`config-unknown-key`/`config-platform-value`/
  `config-taiga-missing-auth`/`matrix-face-missing`/`external-ingress-missing`/`external-ledger-open`…）；
  DB 缺失走 `unavailable`+`STALL`+`db-missing`，schema 版本不符走 `rejected_version`+`EVOLVE_REJECT`
  （`schema-behind`/`schema-ahead`）——**不得**把这两类改写成 `CONFIG_INVALID`（80-§8.2 第 3 条）。
- 启动序列（现状 **9 步生效 + 第 6 步缺 ingress、第 7 步缺失**，对 80-§3.6 十步；锚=`serve.ts` 行号）：

  | # | 动作 | 现状锚 | 目标补充与失败面 |
  |---|---|---|---|
  | 1 | `readFileSync(configPath)` → `parseDaemonConfig`（内部 `coerceServeConfig`）；**只在 `runServe({configPath})` 时走本步**，`{config}` 分支跳过解析（boot 已解析），两者**二选一、不得同时给**（同时给或都不给 ⇒ `CONFIG_INVALID`/`run-serve-arg-invalid`） | :1470 | 文件不存在=`ENOENT` 裸抛；YAML 三处裸 Error（:435 非扁平 / :440 空值 / :443 嵌套列表）；未知键(:703)、值域(:468)、交叉校验(:729) 亦裸 Error。目标：全部 `ClassifiedError`（见上行）；`parseDaemonConfig` 仍是**唯一**解析实现，`{config}` 分支不得再解析一遍 |
  | 2 | **仅 daemon**：`openLedger(path.resolve(config.db))` + 迁移（独占窗口） | :1471 | 打不开/迁移失败=store 抛（未分类）。目标：DAEMON 独占迁移；其他进程不得复用此路径（80-§8.2 D12 / U80-16；写命令面见 §8.1 W-11） |
  | 3 | 在途接管 `takeOverRunningWorkRecords(ledger, Date.now())` | :1476 | 台账写失败上抛；**本步无 try/catch → 已开 ledger 不 close**（进程退出由 OS 回收）。目标：改注入时钟；沿失败路径先 `ledger.close()` |
  | 4 | `companyDir` 给定 → 动态 `import('@studio-next/company')` → `readDirectoryFiles` → `loadCompanyDirectory` | :1495-1500 | 校验不通过：**先 `ledger.close()` 再抛** `公司目录校验不通过（拒绝启动）`＋逐条 `file:line [rule] fix`；目标 `subcause='company-invalid'` |
  | 5 | `platform==='taiga'` → `wirePlatform(config).fields.schema()` 只读探针（网络→auth→项目→状态集四层） | :1508 | **先 `ledger.close()` 再抛** `CONFIG_INVALID：Taiga 启动探针失败（…）`——**是文案前缀不是 `configInvalid` 对象**（§8.1 W-1） |
  | 6 | `buildServeRuntime(config, ledger, snapshot, opts)`；**本步内部顺序固定**：① 秘密面/会话面装配（`ServeConfig.secrets` → `KnownSecretSet`；`matrixSessionFactory` 登录 ⇒ 四个工厂/面 + `close()`）→ ② `receipts.rebuild()`（表投影 + 内存快照，返回 `TableProjectionResult`）→ ③ 创建 `IntentIngress`（`WorkIntake` + `ingest` + `IntentReceiptStore` + `allowedSources`）→ ④ 启动末 `replayQueued()` | :1521 | 注入缺失(:1248 matrix)/`fileWatchPath`(:1261)/交叉校验上抛；**本步无 try/catch → ledger 不 close**。目标：ingress 创建失败即拒启动（`external-ingress-missing`）；工厂返回**内部类型 `IntentIngressInternal`**（含 `replayQueued()`），**由 `buildServeRuntime` 自己持有**，启动末调一次 `replayQueued()`，带 `gap:'unknown-link-missing'` 的行不重放。**`rebuild` 失败 ⇒ 拒启动**（`CONFIG_INVALID`/`unavailable` 原样上抛，不折写 subcause），**不得带空投影起服**；`replayQueued()` 只在重建成功后跑（80-§6.6 第 9 条）；② 失败时 ① 已构造的 session 句柄须 `close()` 后再抛 |
  | 7 | **缺失**：`external.enabled` 时 `assembleApi(deps: AssembleApiDeps)` → `serveApi(port, options)` | — | 目标态：`serveApi(port, opts)` 的 `opts` 只由 `assembleApi` 产（`AssembleApiDeps = { ingress, ledgerPath, companies: readonly ApiCompanySource[], config: ServeConfig }`，**无 `now`**），其 `ingress` 参数是 `Pick<IntentSubmissionPort,'submit'\|'receipt'>`（**不含 `replayQueued`/`engine`**，API 只能经 `ingress`）；**本步必须晚于第 6 步的 `rebuild` 与 `replayQueued`**——重建完成前不得存在能应答 `receipt()` 的 HTTP 面（80-§6.6 第 9 条）；开而缺 `ingress`/只读台账 = `configInvalid` **整机拒启**；关闭（`external` 缺省或 `enabled:false`）= **不读 token/provider、不校验启用态必配项、不监听、无句柄、零行为**（关闭动作是无操作）；`apiHandle.close` 注册进 `runtime.stop` |
  | 8 | `sources.startAll(intent => engine.ingest([intent]))` | :1553 | 单源 start 异常由注册表隔离（捕获+计数+继续），**不拒启动**。注：**源产意图**走 `ingest`，不经 `IntentIngress`；`intent_receipts` 只由外部入口产生 |
  | 9 | `while(!stopped)`：`engine.tick()` → `renderTick` → `noopLinesOf` → `report.errors`→stderr | :1558-1566 | tick 抛 → `stopReason='error'`、`lastError=message`、`break`（:1573-1577） |
  | 10 | 停机收口：`sources.stopAll()` → `apiHandle.close()` → `matrixSession.close()` → `engine.dispose()` → `ledger.close()` → 回执 | :1608-1626 | `stop()` 内部抛则**不落回执、不 off 信号**（未证；无 finally）。目标：五步**顺序写死**；80-§3.6 第 10 步的四步相对序（sources → api → engine → ledger）不变，§3.4 第 10 条只额外要求 session `close()` **先于 `ledger.close()`**，故插在 `engine.dispose()` 之前；`engine.dispose()` 只释放本地资源，**不得回调已关闭的 session**，session 关闭后的 notify 一律软失败（不抛、不重连）。API 只能经 `ingress.submit`/`receipt`，装配体不持 `engine`、不持可写 `Ledger`；`close()` 后的在途请求按 api 包语义拒绝，**不再入队**（不得在 drain 期补投）；未开 Matrix 会话面时 session close 是**无操作**，不是缺步 |

- 拍边界（tick 收口后、下一拍未开；**四步顺序固定，不得互换**）：
  ① **notify 事件中继**（在 tick 的 try 内，:1570-1572）：`notifyRelay !== undefined && report.events.length > 0`
     才发，`void notifyRelay(events).catch(()=>{})`——fire-and-forget，**永不 await、永不阻塞、恒不抛**
     （IM 是沟通面非执行前置；矩阵挂=软失败+计量 failed，面板仍第一落点）。
  ② **L1 热重载**（try 外，:1580-1584）：`await hotReload.check()`（指纹自动+控制面手动两触发面汇合，check 恒不抛）；
     无公司目录时改走 `answerReloadNoCompanyDir` 回执拒绝——不悬空 CLI 轮询。
  ③ **控制面停机通道**（:1588-1602）：`readStopRequest` → 与 `stopLastSeenId` 比 id → 去重双保险＝**先**
     `ledger.kvSet(STOP_LAST_SEEN_KV_KEY, id)`（改名前崩由重启读回）**再** `consumeStopRequest`（原子改名 `.consume`，
     失败不阻断）→ `stopped=true`、`stopReason='stop-request'`。
  ④ **拍间隔等待**（:1604-1607）：`deadline = Date.now() + config.tickMs`，每 ≤50ms 轮询一次，信号可提前打断。
  顺序后果（现状，非缺陷但需写死）：①在 try 内 ⇒ **tick 抛错时本拍不中继**；②③在 try 外 ⇒ tick 抛错 `break`
  后直接进停机，**不做热重载、不读停机请求**。
- 停机收口（现状 vs 目标）：
  · `stop()`(:1399-1404，可重入)：`sources.stopAll()` → `await engine.dispose()`（在途 drain）→ `ledger.close()`。
    顺序依据 22-§三.3「先停源=不再进新意图 → 引擎 drain → 关台账」。
  · 收尾(:1608-1626)：日志「停机（reason[:err]）」→ `await stop()` → 日志「已优雅关闭」→ `honoredStopId` 非空则
    `writeStopResult(...)` 落回执（**在 stop 之后**，故 CLI 见回执即台账已落盘、worker 已整树杀）→ `process.off` 双信号 →
    `return { ticks, stopReason, lastError? }`。
  · 目标插入点：按上表第 10 行写死为五步
    **sources → api → session → engine → ledger**（HTTP 面先不再收新单，再 drain；session `close()` 先于
    `ledger.close()`，`engine.dispose()` 不得回调已关闭 session）；现状**无 api close、无 session close**。
- 目标拆分（80-§10.4 + 81-§3.2；只移动语义、不改行为）：
  · serveconfig/serve-config.ts：ServeConfig + DEFAULT_SERVE_CONFIG + DEV_GATEWAY_SECRET（约 270 行）
  · serveconfig/parse.ts：parseDaemonConfig + parseScalar（约 45 行）
  · serveconfig/coerce.ts：coerceServeConfig 并入（现有件扩写，约 290 行；含 `external.allowedSources` 与 `secrets` 校验）
  · runtime/build.ts：buildServeRuntime + ServeRuntime + 装配序 + `IntentIngress` 创建位 + `rebuild`/`replayQueued` 顺序（约 450 行）
  · runtime/keys.ts：daemonIdentity + wireWorkerKeys（约 85 行）
  · runtime/demo.ts：realGateMode + MATRIX_MANIFEST + ACCEPTANCE（约 45 行）
  · runtime/secrets.ts：**秘密面 + 会话面**装配（`KnownSecretSet` + `matrixSessionFactory` 登录句柄，约 200 行，§四.2 新件）
  · intent/{ingress,receipt-store}.ts：意图入口与投影维护者（约 260 + 240 行，§四.2 新件）
  · api/assemble.ts：`:8788` 装配（约 200 行，§四.2 新件）
  · 本文件保留 runServe + `RunServeOpts`/`BuildRuntimeOpts` 的**消费**（类型仍在 hrsync/run-serve-opts.ts，见 F-daemon-run-serve-opts）
  目标行数：serve.ts ≤ 250；上列拆分件各 ≤ 600（**10 个文件**：serveconfig 3 + runtime 4 + intent 2 + api 1，其中
  `coerce.ts` 是现有件扩写）。`assembly/` 直下仍 1 件（新件全在子目录）。注：全卷目标-新增共 **19** 件，除这 10 件外
  还有 `assembly/spec|auth|migrate`（`auth/` 两件：`assemble.ts` + `credentials.ts`）、`assembly/stdio/broker.ts`
  与 `assembly/platform/binding.ts`（绑定档案，`PlatformBindingPort` 唯一宿主）**六个独立目标件**
  （不属 serve 拆分，见各自 F-ID）。
- 测试与证据：test/assembly/{serve-config,serve-channels,serve-hrmatrix,serve-notify,serve-tier}.test.ts 直测
  parseDaemonConfig/buildServeRuntime；test/assembly/inflight-takeover.test.ts 经 re-export 测接管；
  test/assembly/{intent-ingress,intent-receipts,api-assemble,serve-secrets}.test.ts 测新件（§六）；
  test/control/hot-reload.test.ts 与 test/evolve/evolve-guard.test.ts 经它装配运行栈。
- 未证/未做：第 6 步 ingress 与第 7 步 API 装配均未落地（U80-15）；`RunServeOpts` 三处内联类型未收口、
  `{configPath}|{config}` 判别联合未收口（§8.1 W-8）；`matrixSessionFactory` 与 session `close()` 未落地
  （§8.3 U80-17 相邻）；`receipts.rebuild()`/`replayQueued()` 未落地（§8.3 U80-19/U80-15）；
  配置错误未分类（W-1）；`external` 键族不存在（W-6）；`buildServeRuntime` 第三参 9 键匿名类型（log/clock/quarantineMs/
  matrixSource/hrMatrixFace/matrixRoomFace/notifyBroadcast/hrKnownSecrets/evolveSelfCheck）——目标为
  `BuildRuntimeOpts = RunServeOpts & { log?; clock?; quarantineMs?; hrKnownSecrets?; evolveSelfCheck? }`（80-§3.4 原文清单）；
  **不新增 `secretProvider`**（80-§3.4 第 8 条）：秘密由 `ServeConfig.secrets` 在 `runtime/secrets` 内装配，
  `assembleKnownSecrets` 的 provider 来源即该配置面（§8.1 W-18 收窄为「缺省/校验细节待 80 定」）；
  `platform:'fake'`/缺 `agentYaml` 的 fake 执行体现在可从生产配置选中（§8.1 W-10，81-§3.1 判负面）。
```

```text
F-daemon-serveconfig
- 路径/处置：src/assembly/serveconfig/serve-config.ts；**目标-新增**（从 serve.ts :147-:411 拆出）。
- 归属：80-§3.3 第 1 条（唯一配置类型）、81-§3.2（拆分先解类型环）。
- 职责：`ServeConfig` 类型、`DEFAULT_SERVE_CONFIG` 逐键缺省、`DEV_GATEWAY_SECRET` 开发秘密常量。
  `ServeConfig.secrets` 的**键形状**在此声明（80-§3.3 第 6 条）：`{ catalog?: SecretCatalogEntry[];
  fileRoot?: string; brokerBinding?: string }`；缺省 `catalog: []`（其余两键 `undefined`）。
  元素类型**只引** `packages/contract/src/ports/secret.ts` 的 `SecretCatalogEntry`（§〇 跨卷表），**不重定义**
  `SecretKind`/`SecretUse`/`ValueProvider`/`SubjectScope`。
  非职责：不解析（parse.ts）、不收窄/不交叉校验（coerce.ts）、不读文件、**不解析 provider**（归 `runtime/secrets`）。
- 内部：interface ServeConfig extends HrServeConfig；`secrets?: { catalog?: SecretCatalogEntry[]; fileRoot?: string;
  brokerBinding?: string }`（三个新键，属目标键族，不进 §4.2.1 的 73 键现状计数）；const DEFAULT_SERVE_CONFIG: ServeConfig；
  const DEV_GATEWAY_SECRET: string（开发占位，生产不得使用——`realGateMode` 据此识假）。
- 秘密面：`secrets` 只放**引用**（`secretId` + `valueProvider`），不放内联值；`fileRoot` 是部署相对路径根
  （不得写死绝对路径），`brokerBinding` 只是已注册绑定名（不是句柄、不是凭据）；三者语义归 80-§3.3 第 6 条。
- 导出与依赖：仅 type/const；import type HrServeConfig（hrsync/config.ts）+ hr* 缺省展开。
- IO/注入：零 IO。秘密面：DEV_GATEWAY_SECRET 是**公开可见的开发常量**，不是密钥；不得在此放真凭证。
- 错误/观测：无行为，无错误面。
- 测试与证据：经 serve-config.test.ts（缺省断言）与 create-serve-face.test.ts（骨架键集 ⊆ 收的面）。
- 规模：≤ 300 行；新增键必须同时给缺省/必配声明 + 交叉校验位置 + 关闭时零行为 + 81 归属（80-§3.3 第 4 条）。
```

```text
F-daemon-parse
- 路径/处置：src/assembly/serveconfig/parse.ts；**目标-新增**（从 serve.ts :413-:455 拆出）。
- 归属：80-§3.3（parseDaemonConfig）、79-§3.3（YAML 边界：真 yaml@2 未接）。
- 职责：零依赖扁平 `key: value` 解析 + 标量强制（string/number/boolean），行号入错误文案。
  非职责：不做类型收窄与交叉校验（delegate coerce）、不读文件、不认嵌套/列表/空值。
- 内部：parseDaemonConfig(text: string): ServeConfig；parseScalar(raw)（私有）。
- 导出与依赖：仅 parseDaemonConfig；依赖 ./coerce.ts 与 ./serve-config.ts。
- IO/注入：零 IO（纯文本进、对象出）。不得读 env、不得读时钟。
- 错误与观测：三处裸 `Error`（非扁平行/空值/嵌套列表），消息带行号与原行；目标态改
  `configInvalid('config-yaml-nested'|'config-yaml-empty'|'config-yaml-flat', detail)`（80-§3.3）。
- 测试与证据：serve-config.test.ts 覆盖合法/非法/未知键；create-serve-face.test.ts 验「骨架键集 ⊆ 收的面」。
- 规模：≤ 120 行（含注释）。真 YAML 接入（yaml@2 + 行号）是 82 项，不在本文件偷做。
```

```text
F-daemon-coerce
- 路径/处置：src/assembly/serveconfig/coerce.ts；23 行；现有；目标-保留并扩为「收窄 + 交叉校验」家。
- 归属：80-§3.3（coerceServeConfig 收窄与交叉校验）。
- 职责：逐键类型收窄（str/num/bool）、值域枚举（platform/taigaEntity/taigaAuth/judgeSites/模型档）、
  未登记键拒收、开关组合交叉校验（matrixChannels/hrSync/hrPeopleWatch/taiga 必配键）、
  `secrets` 三键的**形状 + 引用**校验（80-§3.3 第 6 条）：`catalog` 必须是非空元素数组（缺省 `[]` 合法）、
  每个元素须有 `secretId`/`kind`/`subjectScope`/`allowedUses`/`valueProvider`/`rotationRef`/`revocationRef`，
  `secretId` 须合 `SEC-<域>-<slug>` 且**全局唯一**；出现内联秘密值（键名含 `value`/`secret`/`password`/`token`
  的串、或 `valueProvider` 之外的值字段）、未登记键、`fileRoot` 绝对路径、`brokerBinding` 非字符串 ⇒ `CONFIG_INVALID`。
  能力关闭（`external.enabled=false`、Matrix/HR 面关）⇒ **不校验该能力所需条目、不调 `load`**，但 YAML 形状照解析。
- 内部（现状）：str/num/bool 三个强制件（裸 `Error`，`daemon.yaml：…` 文案）；目标在此承载
  coerceServeConfig 与 validateServeCross（现均在 serve.ts :456-:740）。
- 导出与依赖：强制件被 parse/coerce 共用；无跨包依赖、零 IO。
- 错误与观测：现状裸 Error，文案含键名与实得值；目标 `configInvalid('config-invalid-<key>', detail)`，
  分类与文案分离（机器读 subcause、人读 message）。秘密面：只报键名/`secretId`，永不打印值；
  `secrets` 专用 subcause=`secrets-inline-value`/`secrets-unknown-key`/`secrets-entry-shape`/
  `secrets-id-format`/`secrets-id-duplicate`/`secrets-file-root-absolute`（均 `rejected_precondition`+`CONFIG_INVALID`）。
- 测试与证据：serve-config.test.ts（platform/taiga/hrSync/队列/judgeSites/模型档六组正反用例；
  `secrets` 七类拒收各一反例 + `catalog: []` 与缺省合法）、serve-channels.test.ts（matrixChannels 交叉）、
  serve-tier.test.ts（模型档）、serve-hrmatrix.test.ts。
- 规模：≤ 600 行；新增键的收窄必须同处交叉校验，禁止「只在 parse 收、不在 coerce 校」。
```

#### 4.2.1 配置键面全表（73 键 = `ServeConfig` 63 + `HrServeConfig` 10）

〔事实·已复核〕**73 个类型键 = 73 个受理 `case`**：`coerceServeConfig` 的 `switch`(`serve.ts:456-704`) 与 `ServeConfig`(:147，extends `HrServeConfig`) 的键集**完全相等**——脚本比对结果：`声明未受理` 与 `受理未声明` 两个差集皆空。未登记键**拒收而非忽略**：`:703` 裸 Error「daemon.yaml：未知配置键 X（v0 最小面，见 serve.ts 头注）」。

〔事实〕缺省值**单一源** `DEFAULT_SERVE_CONFIG`(:371)：**37 键有缺省**＝字面量 19 键 + `ENGINE_CONFIG_DEFAULTS` 10 键 + `HR_SERVE_DEFAULTS` 展开 8 键；其余 **36 键**（`ServeConfig` 34 + HR 2：`hrMatrixRooms`/`hrTaigaInviteLog`）**无缺省**＝可选（`undefined`），其「关闭时零行为」由消费者按 `!== undefined` 判（脚本复核：73−37=36，逐键差集见下）。

〔边界〕`external` **七键**（`enabled`/`port`/`lan`/`token`/`requestsPerMinute`/`idempotencyTtlMs`/`allowedSources`）是
**80-§3.3 第 5 条的目标键，现状不存在**，故**不入本表**。目标缺省：`enabled=false`、`port=8788`、`lan=false`、
`allowedSources=['external-api']`；`enabled: true` 时 `token`（部署秘密引用）/`requestsPerMinute`/`idempotencyTtlMs`
**必配**、后两者须为正整数（80 原文口径）。`allowedSources` **显式空数组 ⇒ `CONFIG_INVALID` 拒启动**
（与非法形状同口径，不存在「空 = 触发面全 403」的运行态）；`enabled: false` ⇒ **不读、不校验、零行为**
（不读 token/provider、不校验开启态必配项、不装配、无句柄）。`now` **不是 YAML 键**，只属运行时注入（见 §4.2 `F-daemon-api-assemble`）。
入表时须同时给缺省 + 交叉校验位置 + 「关闭时零行为」+ 81 归属（80-§3.3 第 4 条），迁移步 M-g。

〔边界·`secrets` 键族〕`secrets` **三键**（`catalog`/`fileRoot`/`brokerBinding`）与 `external` 同属**目标键族，现状不存在**，
故同样**不入本表**（73 计数是现状实测，改动会与代码差集断言冲突；差集断言的目标态数值待 M-g 落地时重算）。
缺省：`catalog=[]`（空目录合法，`KnownSecretSet.state='known-set-empty'`）、`fileRoot`/`brokerBinding` 为 `undefined`。
`catalog` 元素形状与 `SecretCatalogEntry` 逐字段一致（引 `contract/src/ports/secret.ts`，本卷不复制字段）；
拒收规则与 subcause 见 `F-daemon-coerce`；装配点见 `F-daemon-runtime-secrets`；能力关闭 ⇒ 该能力所需条目**不校验、不 load**。
`external.token` 若写成内联值而非 `secretId` 引用，属 `secrets-inline-value`（同一把尺）。

| 组 | 键 | 类型 | 缺省（来源） | 收窄 / 交叉校验锚 |
|---|---|---|---|---|
| 进程与目录 | `db` | string | `./var/ledger.sqlite` | 无值域；`path.resolve` 后开库(:1471) |
| 〃 | `platform` | `'localfile'\|'taiga'\|'fake'` | `fake` | **值域硬校验** `:468` |
| 〃 | `company` | string | `demo` | 无值域（slug 面校验归公司目录装载） |
| 〃 | `rootDir` | string | `./var` | 无值域；控制面文件家（`control/`） |
| 〃 | `companyDir` | string? | 无 → 用 `DEMO_SNAPSHOT` | 给定即装载校验，不过则拒启(:1495-1500) |
| 〃 | `aiwsRoot` | string? | 无 | 无值域；localfile 平台用 |
| 〃 | `tickMs` | number | `1000` | `num`；兼作拍 deadline 与拍内轮询粒度上限（≤50ms） |
| 〃 | `reloadWatch` | boolean | `true` | 关=只剩手动 reload 通道(:1371 日志) |
| 执行与闸门 | `agentYaml` | string? | 无 → fake executor | 存在即真 executor（启动日志栈形态） |
| 〃 | `acceptance` | string? | 无 → 占位闸门（exit0） | `realGateMode = acceptance !== undefined`(:746) |
| 〃 | `models` | string? | 无 | 无值域；模型档表（测试面 `serve-tier.test.ts`） |
| 引擎限额（`ENGINE_CONFIG_DEFAULTS`） | `maxActionsPerTick` | number | 引擎缺省 | `num` |
| 〃 | `maxInflight` | number | 引擎缺省 | `num` |
| 〃 | `stallAfterMs` | number | 引擎缺省 | `num` |
| 〃 | `stallKillAfterAlarms` | number | 引擎缺省 `?? 2` | **非负整数** `:543` |
| 〃 | `harvestSliceMs` | number | 引擎缺省 | `num` |
| 〃 | `laneTtlMs` | number | 引擎缺省 | `num` |
| 〃 | `mergeLeaseTtlMs` | number | 引擎缺省 | `num` |
| 〃 | `breakerThreshold` | number | 引擎缺省 | `num` |
| 〃 | `breakerCooldownMs` | number | 引擎缺省 `?? 30min` | `num` |
| 〃 | `mirrorRescanEveryTicks` | number | 引擎缺省 `?? 30` | `num` |
| 队列与预算 | `autoApprove` | boolean | `false` | `bool` |
| 〃 | `maxInflightPerPerson` | number? | 无 | **正整数** `:498` |
| 〃 | `queueAgeStepMs` | number? | 无 | **正整数毫秒** `:506` |
| 〃 | `personInflightOverrides` | string? | 无 | 解析即验 `:510`（坏段拒启） |
| 〃 | `pinnedTickets` | string? | 无 | 解析即验 `:517`（票号清单） |
| 〃 | `budgetTicketCapUsd` | number? | 无 | `num`（单票上限） |
| 〃 | `budgetPersonCapUsd` | number? | 无 | `num`（单人上限） |
| 批示与路由 | `directiveProducer` | string? | 无 | 无值域；`buildServeDirectiveDeps` **恒注入**，leader 表随快照整组换 |
| 〃 | `directiveWhitelist` | string? | 无 | 同上（白名单清单） |
| 〃 | `dataChangeRoutes` | string? | 无 | 无值域；缺省取 org-config `hooks.data_change.routes` 规范位 |
| 〃 | `costThresholdTarget` | string? | 无 | 129-D 缺省指派逃生位（规范位 `hooks.cost_threshold.target`） |
| 〃 | `costThresholdLane` | string? | 无 | 129-D 泳道逃生位 |
| 定时岗与源 | `jobs` | boolean | `false` | 开=seedJobs 播种 + scheduler 注册(:1232+) |
| 〃 | `jobPollMs` | number | `15000` | `num` |
| 〃 | `cadence` | boolean | `false` | 开=`registerJobSources` 挂 cadence 源 |
| 〃 | `sla` | boolean | `false` | 同上 sla 源 |
| 〃 | `costGuard` | boolean | `false` | 同上成本警戒源 |
| 〃 | `freshness` | boolean | `false` | 同上新鲜度源 |
| 〃 | `fileWatch` | boolean | `false` | 开而未配 `fileWatchPath` ⇒ **拒启** `:1261` |
| 〃 | `fileWatchPath` | string? | 无 | 同上（文件须先存在） |
| 判据资产 | `judgeSites` | string? | 无 | **解析即验**：未知址名拒启 `:520`（fail-closed） |
| 〃 | `modelTierTickets` | string? | 无 | **解析即验**：坏段/未知档拒启 `:524` |
| 接力/续命 | `relay` | boolean | `false` | 开=`wireRelaySource` 挂收割完成钩转发面 |
| 〃 | `resume` | boolean | `false` | 开=`wireResumeSource` + `runtime.resumePublish` 露口 |
| 矩阵 | `matrix` | boolean | `false` | 开而缺 `matrixHomeserverUrl`/`matrixUserId` ⇒ **拒启** `:723-731` |
| 〃 | `matrixHomeserverUrl` | string? | 无 | 同上必配 |
| 〃 | `matrixUserId` | string? | 无 | 同上必配（密码只经 env `MATRIX_BOT_PASSWORD`，永不入 yaml） |
| 〃 | `matrixRooms` | string? | 无 | 交 boot 组合根消费（daemon 不解析） |
| 〃 | `matrixRoles` | string? | 无 | 同上 |
| 〃 | `matrixPollMs` | number? | 无 | `num?`；同上 |
| 〃 | `matrixSyncTimeoutMs` | number? | 无 | `num?`；同上 |
| 〃 | `matrixChannels` | boolean | `false` | 开=需注入 `matrixRoomFace`（交叉校验 `:735` → `crossValidateMatrixChannels`） |
| 〃 | `matrixDeptMap` | string? | 无 | 部门↔频道映射 |
| 〃 | `matrixProducerMxid` | string? | 无 | 生产方 mxid |
| 网关 | `gateway` | boolean | `true` | 关=只测试/对照用（`wireWorkerKeys` 返 undefined + 警告） |
| 〃 | `gatewaySecret` | string? | 无 → `DEV_GATEWAY_SECRET` | **秘密**：env 供给、≥32B、只进 HMAC 不落日志/台账 |
| 平台执行 | `platformDir` | string? | 无（消费侧推导） | 无值域 |
| 〃 | `taigaUrl` | string? | 无 | `platform: taiga` 时**必配** `:715` |
| 〃 | `taigaProject` | string? | 无 | 同上必配 |
| 〃 | `taigaEntity` | `'userstory'\|'issue'\|'task'`? | 无（消费侧 `?? 'userstory'`） | **值域硬校验** `:680` |
| 〃 | `taigaAuth` | `'password'\|'token'`? | 无 | **值域硬校验** `:688` |
| 〃 | `taigaFieldsFile` | string? | 无 | 无值域（字段映射文件） |
| HR（`HR_SERVE_DEFAULTS`） | `hrSync` | boolean | `false` | 开+`platform: taiga` ⇒ 必配 `hrTaigaInviteLog`(`config.ts:152-160`) |
| 〃 | `hrMaxPerTick` | number | `2` | **正整数**（`coerceHrServeKey`） |
| 〃 | `hrRetryLimit` | number | `3` | **正整数**（同上） |
| 〃 | `hrApplyingTimeoutMs` | number | `0` → 装配期按 `10×tickMs` 推导 | `num` |
| 〃 | `hrMatrix` | boolean | `false` | 开（且 `hrSync`）⇒ 必配 `hrMatrixRooms` 含 `company=` |
| 〃 | `hrMatrixRooms` | string? | 无 | 同上必配；`parseHrRooms` 解析 |
| 〃 | `hrTaigaInviteLog` | string? | 无 | `hrSync + taiga` 必配（邀请令牌只落 console/邮件日志） |
| 〃 | `hrTaigaInvitePolls` | number | `10` | `num` |
| 〃 | `hrTaigaInvitePollMs` | number | `500` | `num` |
| 〃 | `hrPeopleWatch` | boolean | `false` | 开而 `hrSync` 关 ⇒ **拒启**（结构性空转，`config.ts:176-178`） |

〔纪律〕三处交叉校验**在 `coerceServeConfig` 尾部统一收口**（不在各 `case` 里零散做）：`platform: taiga` 必配(:708-718) → `validateHrServeCross`(:719) → `matrix` 必配(:723-731) → `crossValidateMatrixChannels`(:735)。新增键的收窄必须落同处，禁止「parse 收、coerce 不校」（`F-daemon-coerce` 规模条同款纪律）。

〔事实〕解析错误**分类现状**：73 键的收窄/交叉全部走裸 `Error`，文案统一前缀 `daemon.yaml：`；`configInvalid` 在本段**零命中**（仅 :1040/:1054 judge 面）。目标态（`F-daemon-coerce`）：`configInvalid('config-invalid-<key>', detail)`，机器读 subcause、人读 message，**秘密只报键名不打印值**。

```text
F-daemon-runtime
- 路径/处置：src/assembly/runtime/build.ts；**目标-新增**（从 serve.ts :746-:1444 拆出主体）。
- 归属：80-§10.4（runtime 组件）、§3.6 第 6 步（装配运行栈的顺序）、§6.6 第 9 条（投影启动序）、
  §6.8（HotReload 端口保留）、§3.4 第 3/10 条（`BuildRuntimeOpts` 与 `matrixSessionFactory`）。
- 职责：把 config + ledger + 快照装配成 `ServeRuntime`（engine/scheduler/sources/hotReload?/evolveSelfCheck/
  resumePublish?/notifyRelay?/stop），并做注入面开/关一致性校验；**本文件也是启动序的持有者**：
  秘密面/会话面 → `receipts.rebuild()` → `IntentIngress` → `replayQueued()`。
  非职责：不跑循环（runServe）、不解析配置、不写公司目录、不实现 Matrix 登录（只调工厂）。
- 内部：`ServeRuntime` 接口（现 :822-856，**8 字段**）与 `buildServeRuntime(config, ledger, snapshot, opts?)`(:880)。

  | 字段 | 类型 | 何时存在 | 语义与归属 |
  |---|---|---|---|
  | `engine` | `Engine` | 恒 | 七相位引擎；**唯一 tick 驱动者是 runServe**（runtime 不跑循环） |
  | `scheduler` | `Scheduler \| null` | `jobs: true` 时非空 | `seedJobs` 播种产物；`null`＝未开定时岗 |
  | `sources` | `SourceRegistry` | 恒 | 唤起源注册表；`startAll` 由 runServe 调（emit→`engine.ingest`），`stopAll` 由 `stop()` 调 |
  | `hotReload?` | `HotReload` | 仅 `companyDir` 给定 | 拍边界 `await check()`；缺省时 runServe 走 `answerReloadNoCompanyDir` 回执拒绝 |
  | `evolveSelfCheck` | `EvolveSelfCheckReport` | 恒 | 启动自检汇报面（**观察模式，不阻断启动**；unauthorized 已落 ESCALATE） |
  | `resumePublish?` | `(ticket, cause?) => boolean` | 仅 `resume: true` | 续命意图推送露口；v0 **无生产调用方**（CLI `resume` 归 B4，另批） |
  | `notifyRelay?` | `(events) => Promise<void>` | 仅注入 `notifyBroadcast` | **只露口**——调用点在 runServe 拍边界①（fire-and-forget，永不抛）；runtime 内不自驱 |
  | `stop()` | `() => Promise<void>` | 恒 | **目标五步**：`sources.stopAll()` → `apiHandle.close()` → `matrixSession.close()` → `await engine.dispose()` → `ledger.close()`（现状缺 api/session，只有三步）；**可重入**；队列未消费意图停机即弃（at-most-once） |

  `opts` **目标 10 键**（`BuildRuntimeOpts = RunServeOpts & { log?; clock?; quarantineMs?; hrKnownSecrets?; evolveSelfCheck? }`，
  五部署键 = `matrixSource?`/`matrixRoomFace?`/`hrMatrixFace?`/`notifyBroadcast?`/`matrixSessionFactory?`；现状为 9 键**匿名内联**，
  §8.1 W-8 的收口对象）：`log?`（缺省 `console.log`）、`clock?`（缺省 `Date.now`，本层**唯一**时钟注入点）、`quarantineMs?`、
  `matrixSource?`（`matrix:true` 必注入，或由工厂给）、`hrMatrixFace?`（`hrSync+hrMatrix` 必注入，或由工厂给）、
  `matrixRoomFace?`（`matrixChannels:true` 必注入，或由工厂给）、`notifyBroadcast?`（注入＝面开，不注入＝面关零行为，
  **不拒启动**）、`matrixSessionFactory?`（生产路径必给；与直接四面二选一且不得矛盾）、`hrKnownSecrets?`（出站脱敏兜底）、
  `evolveSelfCheck?{manifest?,hashFile?,fileExists?}`（测试确定性逐项覆盖）。**没有** `secretProvider` 键（80-§3.4 第 8 条）。
- 装配序（**目标前置段顺序固定**：秘密面/会话面（`runtime/secrets.ts`，含 `matrixSessionFactory` 登录与 `close()` 句柄）
  → `receipts.rebuild()`（失败即拒启动）→ `IntentIngress` 创建 →（回到 runServe）第 7 步 API 前调一次 `replayQueued()`。
  其后为现状序，自上而下，顺序有依赖、不得重排）：`log`/`clock` 解析 → `companyState` 活持有者 →
  类型流表(`flowsFromWorkflows`) → 网关平台(`wireGatedPlatform`/`wirePlatform`) → worker key(`wireWorkerKeys`) →
  引擎依赖（registry/catalog/prompt/assembler + `directives` 恒注入）→ 引擎（`onWorkComplete` 闭包晚绑）→
  源注册表 → 源（people-change / relay / resume / 调度器 / matrix / fileWatch / 岗位域源群）→ 热重载
  （`createHotReload`，仅 `companyDir`）→ 启动自检（`runEvolveStartupSelfCheck`）→ 面接线（matrix/channels/notify/hr）→
  `return { engine, scheduler, sources, … }`。**热重载晚于源**：源闭包读 `companyState.snapshot`，先建持有者再建源。
- 导出与依赖：buildServeRuntime、ServeRuntime；依赖 assembly/*（无环）、engine、control、evolve 与包面
  adapters/company/contract/core/gateway/store。
- IO 与注入：不读配置文件；接受 log/clock/quarantineMs 注入（测试确定性），其余面工厂由组合根注入；
  开/关语义（80-§3.4 表）：配置开而未注入 ⇒ `CONFIG_INVALID` 拒启动，配置关 ⇒ 零装配零调用，
  `notifyBroadcast` 属「面关零行为」不拒启动。
- 状态与并发：不持有可变全局；`companyState.snapshot` 由本文件构造并交热重载/源闭包共读（整组替换）。
- 错误与观测：注入缺失与交叉校验失败抛错（现状多为裸 Error，目标 `configInvalid` + 稳定 subcause：
  `matrix-face-missing`/`matrix-session-missing`/`hr-matrix-face-missing`/`secret-missing`）；`receipts.rebuild()` 失败
  原样上抛并**拒启动**（`CONFIG_INVALID`/`unavailable`，不折成空投影）；构造期自检失败 fail-fast 不半装。
- 测试与证据：serve-channels/serve-hrmatrix/serve-notify/serve-tier/inflight-takeover 五件直测；
  serve-secrets 测秘密面/会话面装配与「boot 零登录」；evolve-guard.test.ts 的「serve 启动自检接线」三态。
- 规模：≤ 600 行；拆分后不得新增顶层导出面（re-export 仍经 serve.ts）。
```

```text
F-daemon-runtime-keys
- 路径/处置：src/assembly/runtime/keys.ts；**目标-新增**（从 serve.ts :778-:858 拆出）。
- 归属：80-§6.8 保留端口 `WorkerKeyDeps`、§9.5 第 2 条（控制面自身写也过网关）。
- 职责：daemon 署名身份（daemonIdentity）与 worker key 生命周期注入（wireWorkerKeys）。
  非职责：不决定 wkey 生命周期语义（归 engine/worker-key.ts）、不直接写平台（须过网关）。
- 内部：daemonIdentity(config, snapshot) → {secret, ctx, author}；wireWorkerKeys(config, identity, clock, log)
  → WorkerKeyDeps | undefined（关面返回 undefined）。
- 导出与依赖：两函数；依赖 gateway（CONTROL_TICKET/createGateway）与 contract 类型。
- IO/注入：clock + log 注入；秘密=DEV_GATEWAY_SECRET 或 config.gatewaySecret（env 供给，不入日志）。
- 状态与并发：无状态；wkey 状态在台账。
- 错误与观测：config.gateway=false 时由 wireGatedPlatform 打警告（仅测试/对照用，生产不得关）。
- 测试与证据：test/engine/worker-key*.test.ts（engine 面）+ serve-tier/serve-channels 经装配间接覆盖。
- 规模：≤ 150 行。
```

```text
F-daemon-runtime-demo
- 路径/处置：src/assembly/runtime/demo.ts；**目标-新增**（从 serve.ts :746-:875 常量族拆出）。
- 归属：80-§3.6（demo 模式）、81-§3.1（fake 只归测试/演示）。
- 职责：demo 判定与演示常量——`realGateMode(config)`、`MATRIX_MANIFEST`、`ACCEPTANCE`（v0 占位闸门文案）。
  非职责：不装配运行栈、不被生产分支当作真能力。
- 内部：realGateMode(config): boolean；MATRIX_MANIFEST: SourceManifest；ACCEPTANCE: string[]
  （现值为 `['echo demo-ok（v0 占位闸门不执行验收命令）']`）。
- 导出与依赖：三件；依赖 contract 的来源清单类型。
- IO/注入：零 IO。
- 错误与观测：无；但 ACCEPTANCE 的 v0 占位必须在日志/文档中标注「不执行真验收命令」。
- 测试与证据：test/cli/industry-templates.e2e.test.ts（demo 全家桶端到端）；不证明真闸门。
- 规模：≤ 100 行。**未证**：demo 与真实模式的行为差未做对账表。
```

```text
F-daemon-api-assemble
- 路径/处置：src/assembly/api/assemble.ts；**目标-新增**（80-§9.4 装配决策 1）。
- 归属：80-§9.4（对外 API 装配决策 + M1–M5）、§3.6 第 6/7 步、§3.3 第 5 条（`external` 键集）；
  81-§3.3（api 真实装配在 `assembly/api/assemble.ts`，由 `runServe` 同进程接入）。
- 职责：在 `runServe` 内构造 `ApiServerOptions` 并交 `serveApi(config.external.port, opts)`；自构四样：
  ① HTTP 适配（`api/src/http`，**不从 panel 取**）② `company` 纯投影（包内 import，**不是回调**）③ 只读台账
  `openLedgerReadonly({path, expectedSchemaVersion, readOnly:true, queryOnly:true})` ④ `emitIntent`/`getIntentReceipt`
  ——**原样转发 `deps.ingress.submit`/`receipt`**（不查重、不落回执、不碰库、**不持 `engine`**）。
  非职责：不自起进程、不自立 `bin`、不直写台账/平台、不读配置文件、**不直接 `engine.ingest`**（不得绕 ingress）。
- 内部（目标签名，逐字取 80-§9.4 装配决策 1；类型**不留未证**）：

  ```ts
  interface ApiCompanySource {              // 现 ExternalCompanySource 去掉 openLedger/platform
    slug: string                            // 与 snapshot.slug 不一致 ⇒ 500（per-request 校验）
    snapshotProvider: () => CompanySnapshot // 同步、每请求现取（缓存归 wiring，不进 API）
    listReports?: () => readonly ReportFile[]   // 缺省＝报表面未挂载（501 + reason，不返回 []）
    contact?: string
  }
  interface IssuesView {                    // 方法**同步**返回 Result；Err ⇒ 500，不吞成空数组
    ticketMirrors(company: CompanySlug): Result<readonly TicketMirrorRecord[], ClassifiedError>
    issues(company: CompanySlug, q: { state?: string; limit: number }): Result<readonly IssueView[], ClassifiedError>
  }
  interface FinanceSources {                // 三源都返回 Result；"未挂载"与"读失败"两件事
    budgets(company: CompanySlug): Result<readonly BudgetRecord[], ClassifiedError>
    eventCosts(company: CompanySlug): Result<readonly EventRecord[], ClassifiedError>
    monthlyReports(company: CompanySlug): Result<readonly ReportFile[], ClassifiedError>
  }
  interface AssembleApiDeps {
    ingress: Pick<IntentSubmissionPort, 'submit' | 'receipt'>   // 恰两方法，不含 replayQueued
    ledgerPath: string                                          // 路径字符串，不是句柄
    companies: readonly ApiCompanySource[]
    config: ServeConfig                                         // 不设 now：时钟只来自 BuildRuntimeOpts.clock
  }
  declare function assembleApi(deps: AssembleApiDeps): ApiServerOptions
  interface ApiServerOptions {
    emitIntent(intent: WebhookIntentPayload): Promise<Result<IntentSubmitResult, ClassifiedError>>
    getIntentReceipt(key: IntentKey): Promise<IntentReceipt | undefined>
    companies: readonly ApiCompanySource[]
    config: ServeConfig
    issuesView: IssuesView                  // assemble 内用 openLedgerReadonly 现构
    finance: FinanceSources                 // 同上：三源都由只读台账视图派生
    token: string; requestsPerMinute: number; idempotencyTtlMs: number; bodyLimitBytes: number
  }
  ```

  `deps` **不收 `engine`、不收可写 `Ledger`/`Database`**，`ledgerPath` 只是路径字符串；`companies` 是**数组**
  （旧稿的裸 `company` 作废）。`Pick<IntentSubmissionPort,…>` 与 `Pick<IntentIngress,…>` 等价，两者都**不含**
  `replayQueued`——API 侧在**类型上**就拿不到启动重放口（不得用 `as` / `Record<string, unknown>` 绕过）。
- `ApiServerOptions` 字段表（**目标形状**；`packages/api` 现仅 `src/index.ts` 43 行骨架、`PACKAGE_STATUS='skeleton'`，
  类型名与字段按 80-§9.4 写死，**不再有「未证/待定稿」行**）：

  | 字段 | 必填? | 装配体怎么给 | 语义 / 缺省 | 来源 |
  |---|---|---|---|---|
  | `emitIntent(intent)` | **必填** | `(intent) => deps.ingress.submit(intent)` | 外部意图唯一入口；返回 `Result<IntentSubmitResult, ClassifiedError>`；**不得**直引 `engine.ingest` | 80-§9.4 |
  | `getIntentReceipt(key)` | **必填** | `(key) => deps.ingress.receipt(key)` | 回执查询；**三态齐全** `queued`\|`decided`\|`unknown`（**不得漏 `unknown`**，也不得回 `pending`）；`unknown` 只表示「未对账」，**不是**失败、也**不**触发重放。**读的是本进程已提交的内存快照**（`IntentReceiptStore.get`），`undefined` 仅表示「快照里没有该键」；HTTP 层据此回 **503**（`receipt-not-in-snapshot`），**不是 404**、**不回落查库**；`undefined` **不得**用于入队判定、重投判定或重放筛选（那两类一律按记录现算 `refresh(key)`） | 80-§6.6 / §9.4 |
  | `issuesView` | **必填** | `openLedgerReadonly({ path: deps.ledgerPath, expectedSchemaVersion, readOnly: true, queryOnly: true })` 现构（`packages/store/src/ledger/open.ts`） | 只读台账视图；缺只读能力＝拒启（不许退回可写句柄）。**打开失败原样上抛**：`db-missing`（`unavailable/STALL`）、`schema-behind`/`schema-ahead`（`rejected_version/EVOLVE_REJECT`），**不得**改写成 `CONFIG_INVALID`。两方法（`ticketMirrors`/`issues`）**同步 `Result`**；`Err` ⇒ HTTP **500**（原样透传 `subcause`），**不得**降级为空数组 | 80-§8.2 / §9.4 |
  | `finance` | **必填** | 同上，由只读台账视图派生三源 | **未挂载**（某源不可用）⇒ 该段 `unknown` + reason，HTTP 仍 **200**，不补 0；**`Err`**（库不可读/行损坏）⇒ **500** 整段失败（不写成 `unknown` 蒙混） | 80-§9.4 |
  | `companies` | **必填** | `readonly ApiCompanySource[]`（`<slug>` 路由） | 空数组合法（无挂载公司 ⇒ 受管路由 422）；`snapshot.slug` 与 `slug` 不一致 ⇒ 500；**不含** `openLedger`/`platform` | 80-§9.4 |
  | `config` | **必填** | `ServeConfig`（同 `deps.config`） | API 侧只读自己那一小段（`external.*`）；**不**另造配置类型 | 80-§3.3 第 5 条 |
  | `token` | 开启时**必配** | `config.external.token`（部署秘密引用） | 缺＝`configInvalid` 拒启；`X-SN-Token` 链 | 80-§3.3 第 5 条 |
  | `requestsPerMinute` | 开启时**必配** | `config.external.requestsPerMinute` | **正整数**；超限 429 | 同上 |
  | `idempotencyTtlMs` | 开启时**必配** | `config.external.idempotencyTtlMs` | **正整数**；去重窗（拟稿 24h，非 SLA 承诺） | 同上 |
  | `bodyLimitBytes` | 有缺省 | `assembleApi` 给缺省 `100_000`（**不是** `external` 的 YAML 键；需要改动走批示） | 超限 **413**（不是 400/422），不落 `REC-WORK-01` | 80-§6.6 / §9.4 |
  | ~~`now`~~ | **删除** | — | 时钟只来自 `BuildRuntimeOpts.clock`；API 侧不另开时间源 | 80-§9.4 第 5 条 |
  | `eventsSource?` / `listen?` | 可选 | 未实装＝不传 | `/v1/events` 维持 **501**（不是 200 空流）；`listen` 仅测试覆盖 | 80-§9.4 M4-6 |
  | `views:{orgTree,progress,finance}` | — | **包内编译期依赖**（M1 后由 `company` 供） | 不进运行时校验 | 80-§9.4 |
  | ~~`openLedger`~~ / ~~`platform`~~ | **删除** | — | 前者＝第二写者入口；后者＝绕 engine 写平台 | 80-§9.1/§9.4 |

- 路由面（**16 条**，计数唯一口径；旧稿 12/13/15 一律作废）：**10 条读面**
  （`agent-card`/`company`/`org`/`people`/`projects`/`issues`/`finance`/`reports`/**`requests/status`**/`events`，
  `events` 归订阅面且当前 `501`）+ 4 条触发（`requests`/`explore`/`tasks`/`intel`）+ `/v1/subscriptions` + `GET /` = 16。
  **新增端点 `GET /v1/requests/status`**：参数 `company&source&kind&dedupKey[&ticket]`，第四槽 = `ticket ?? dedupKey`；
  调 `ingress.receipt(key)` 读**本进程已提交快照**，命中 ⇒ `200 {receipt}`，`undefined` ⇒ **`503`**
  `{failure:'unavailable', category:'STALL', subcause:'receipt-not-in-snapshot'}`——**不重放、不查库、不触发物化**，
  **不得** 404、不得 200 空体；成功/失败都带 `Cache-Control: no-store`；status 端点**不出现 `duplicate`**；
  参数缺失/超 256 字符/非 `[A-Za-z0-9._:-]` ⇒ **422**；认证同 `POST`（GET 不免令牌）。
- HTTP 状态与错误形状（以 80-§9.4 为准，本卷不另立码表）：`202/200/401/403/404/409/413/422/429/500/501/503`。
  错误体**唯一形状** `{ error: { failure, category, subcause }, traceId }`（`422` 外层加 `fieldPath`、
  `429` 加 `retryAfter`、`501` 加 `reason`）；`404` = **路由不存在** ⇒ `rejected_precondition`/
  `EXTERNAL_REJECT`/`not-found`（**不得** `EVOLVE_REJECT`、不得当「记录不存在」）；`500` = 读面内部错误
  ⇒ `unavailable`/`STALL` + 原样透传 `subcause`（如 `ledger-read-failed`），不得改写成 `CONFIG_INVALID`。
  只读面查询错误按 80-§8.2：`unsupported`（未开放字段组合）⇒ `EVOLVE_REJECT`；`conflict`（游标不可解）
  ⇒ `EXTERNAL_REJECT`；**`STATE_CONFLICT` 不是 `ErrorCategory` 成员，本卷全文不得出现**。

  两种 reader **不得混用**（同名不同轴，是本卷最容易写错的一处）：
  · `ReadOnlyLedger`（`packages/store/src/ledger/open.ts`，API 信息面用）：`query<TPayload>(q)` / `get(recordId)`
    都**同步**返回 `Result<RecordPage<TPayload>, ClassifiedError>` / `Result<RecordEnvelope<unknown> | undefined, ClassifiedError>`；
    `Ok(undefined)` 才是「不存在」，读失败是 `unavailable/STALL/ledger-read-failed`。
  · `RecordReader`（80-§6.3，engine 面）：`get`/`query` 均返回 `Promise<Result<…>>`（**异步**），两者共用 `RecordPage<TPayload = unknown>`。
  API 装配体**只**用前者；后者只在 engine 内消费，不得被 `assembleApi` 接收（`deps` 类型上就没有它）。

- 前置组件（**目标-新增，同在 assembly 域**）：`createIntentIngress` 由 `buildServeRuntime` 在**启动第 6 步**创建
  （80-§3.6），**前置条件＝`receipts.rebuild()` 已成功**（重建失败则根本不到这一步；重建完成前不建 API 面），关联 `WorkIntake`（`REC-WORK-01` 唯一写者）、`engine`（**只**用于 `ingest` 入队）、可写 `Ledger`
  （`IntentReceiptStore` 投影）与入口来源白名单 `config.external.allowedSources`。工厂返回**内部类型
  `IntentIngressInternal`**（`submit`/`receipt` + `replayQueued()`），**由 `buildServeRuntime` 自己持有**并在启动末
  调一次 `replayQueued()`（`gap:'unknown-link-missing'` 的行不重放）；交给 `assembleApi` 的只是
  `Pick<IntentSubmissionPort,'submit'|'receipt'>` 视图——**`replayQueued` 与 `engine` 在类型上都到不了 API**。
  **现状四件全不存在**：`assembly/api/assemble.ts`、`IntentIngress`/`IntentReceiptStore`、`WorkIntake.reserve`、
  `intent_receipts` 表。
- 启停顺序（目标，写死）：第 6 步建 engine + 秘密面/会话面 + `receipts.rebuild()` + `IntentIngress` + `replayQueued()`
  → 第 7 步 `assembleApi(...)` → `serveApi(port, opts)`（**API 装配必须晚于 `rebuild` 与 `replayQueued`**，
  重建完成前不得有能应答 `receipt()` 的 HTTP 面）→ `apiHandle.close` **并入 `runtime.stop`**，位置＝
  `sources.stopAll()` 之后、`matrixSession.close()` 与 `engine.dispose()` 之前
  （HTTP 面先停收新单 → 再 drain 在途 → 关 session → 最后关台账）；**不得**在 ledger 已关后才调 close，
  也不得在 `apiHandle.close()` 之后再把请求补投进 `ingress`。
- 启动两态（**互斥，不得混写**）：
  · `external` 缺省或 `enabled: false` ⇒ 第 7 步**完全不启动**：无监听、**无 API 句柄**、关闭动作是无操作；
    daemon 照常跑，日志**明写**「对外 API 未启用」（这是「没开」，不是降级、不算失败）；
  · `enabled: true` 而缺 `ingress`（或 `submit`/`receipt` 非函数）/缺只读台账/缺 `token`/`requestsPerMinute`/
    `idempotencyTtlMs` ⇒ `configInvalid` **整机拒启**，进程非零退出，**不得**起「只有信息面」的半面；
    第 7 步中途失败**先停已开句柄再抛**（不留悬挂监听）。
- 导出与依赖：`assembleApi`；依赖 `@studio-next/api`（`daemon→api` 已是**真实边**，`boundary-rules.mjs:108`
  登记、manifest 声明）、`company`（M1 后含三个 `build*` 纯投影）、`store`（只读打开）。**零 `engine` 依赖**
  （engine 只经 `ingress` 间接到达）。
- IO 与注入：fs 无；SQLite＝只读打开（`PRAGMA query_only=1`，**前置 80-§8.2 D12「只读打开不跑 DDL」**——
  D12 未落地前 M3 的「只读」是假的）；网络＝交 `api` 包；时钟经注入。
- 状态与并发：无模块状态；句柄生命周期＝（`serveApi` 返回）→（`runtime.stop` 关闭）；关闭先于 engine drain 与台账关闭。
- 错误与观测：缺件 ⇒ `configInvalid(...)` 整机拒启；关闭 ⇒ 不监听 + 日志明写；两态不得混写。
- 测试与证据：迁移 **M4 十一项**（80-§9.4，每项给命令或断言，未全绿不得进 M5）：
  ① 信息面 **9 条 GET**（`agent-card`/`company`/`org`/`people`/`projects`/`issues`/`finance`/`reports`/`requests/status`）
  与旧面逐字段一致（白名单序列化） ② 认证 401/403/429 ③ 幂等重放只产一意图 ④ 回执只到「已受理待转交」
  ⑤ 未知来源/未挂载 fail-closed ⑥ `/v1/events` 仍 501 ⑦ 启动两态（`lsof -i :8788` 为空 / 缺件非零退出）
  ⑧ `PRAGMA query_only=1` 且启动前后 `user_version` 与表集合不变 ⑨ 提交回执九条（202 只带 `receipt`、
  409 `rejected_idempotency`、200 `duplicate:true`…） ⑩ **16 条路由**逐条核对（10 读面 + 4 触发 +
  `/v1/subscriptions` + `GET /`） ⑪ **status 端点正反用例**（见下）。**另加三条硬断言**（M4 原文口径，不另立判据）：
  · **投影启动序**：`receipts.rebuild()` 失败 ⇒ 进程拒启（非零退出、无监听）；`replayQueued()` 只在重建成功后跑；
    重建完成前 `GET` 回执面不可服务；
  · **请求体超限 413**：`bodyLimitBytes = 100_000`，超限回 413（不是 400/422），且不落 `REC-WORK-01`；
  · **公司未挂载 422**：公司目录未装载时受管路由回 422（不是 404/503），failure=`rejected_precondition`。
  · **status 端点三组**：正（202 后同键查询 ⇒ `200`、`receipt.status='queued'`、`intentRef` 同值、
    **无 `outcome`**；判定后 ⇒ `decided` + `outcome` + `intakeRecordRef`；`ticket ?? dedupKey` 两查法命中同一条）；
    反（快照无键 ⇒ `503 receipt-not-in-snapshot`、**不得 404/200 空体**；权威有记录但快照缺 ⇒ 仍 503、
    **不回落查库**；参数缺/超 256/非法字符 ⇒ `422`；无令牌 `401`、来源不允许 `403`；拼错路径
    `/v1/requests/stats` ⇒ `404 not-found`）；不重放（连查 3 次不新增 `REC-WORK-01`、不触发 `replayQueued`）。
  状态码全集以 80-§9.4 为定：`202/200/401/403/404/409/413/422/429/500/501/503`。**本附录不宣称任何一项已过**。
- 迁移顺序（80-§9.4，写死不可倒）：M1 下沉（`dayKeyOf`/`DAY_MS`→`contract`、三个 `build*`→`company`、
  `listenHono` 一族→`api/src/http/`）→ M2 api 接管路由（**零生产调用方**，旧面继续对外，同端口不得双监听）
  → M3 装配上线 + `cli/external` 退役（**前置 D12**）→ **M4 十一项**验证 → M5 删 `panel/src/external/` 与
  `panel` 的 `"./external"` 导出（**必须最后**，破坏性，须批示 + 82 波次）。M2 完成前 81 对 `api` 一律标
  「**骨架期依赖**」，不得据此声称 api 已具备服务器能力（80-§10.6 口径）。
- 未证：U80-09（迁移后 panel 无外部面）、U80-13（迁移不改包边）、U80-15（外部意图通道端到端：
  `IntentIngress` 全链未落地）、U80-16（多进程并发迁移）、U80-19（投影重建与启动序四注入点：
  提交前/提交后快照前/投影写后/`rebuild` 中途）。本文件不宣称任何一项已满足。
- 规模：≤ 300 行；新增 `assembly/api/` 子目录不占 assembly 直下平面（80-§9.4）。
```

```text
F-daemon-intent-ingress
- 路径/处置：src/assembly/intent/ingress.ts；**目标-新增**（daemon 侧意图入口，`implements` contract 的
  `IntentSubmissionPort`）；行为已由 80-§6.6 冻结，本卷只定文件契约。
- 归属：80-§6.6（submit 顺序 / 四态重投 / TTL / 崩溃重放）、§3.6 第 6 步（由 `buildServeRuntime` 创建）、
  §9.4 装配决策 1（装配体只取 `Pick<IntentIngress,'submit'|'receipt'>`）；81-§3.3。
- 职责：把外部 `WebhookIntentPayload` 转成 `REC-WORK-01` 意图信封，按「落记录（**同事务**由 projection hook 写
  `intent_receipts`）→ commit 后同微任务刷内存快照 → `engine.ingest` → 返回回执」完成一次受理请求；
  另提供 `replayQueued()` 供 `buildServeRuntime` 在启动末重放 `status:'queued'`。非职责：不写 `REC-WORK-01`/`REC-WORK-02`（唯一写口是
  `WorkIntake.reserve`）、不产 `REC-RCP-01`、不查 `SourceRegistry`（外部 API 不是 `InvokeSource`）、
  不判受理（受理归相位 2 的 `WorkIntake.intake`）、不做 HTTP（归 packages/api）、不持平台写口。
- 内部（目标签名，全字段名取自 80-§6.6，不自造）：
  `createIntentIngress(deps: {`
    `intake: WorkIntake;`（`TS-PORT-WORK-01`，`reserve` 见 80-§6.3；跨卷目标件见 §〇）
    `engine: { ingest(intents: readonly InvokeIntent[]): void };`（**只取 `ingest`**，不持整个 engine）
    `receipts: IntentReceiptStore;`（见下一条 `F-daemon-intent-receipt-store`）
    `allowedSources: readonly string[];`（`config.external.allowedSources`，缺省恰 `['external-api']`）
    `ttlMs: number;`（`config.external.idempotencyTtlMs`，正整数）
    `isCompanyMounted(slug: CompanySlug): boolean;`（注入谓词；**不直读公司目录**，79-§3.5）
    `bodyLimitBytes?: number;`（缺省 **`100_000` 字节**，沿用 `panel/src/external/server.ts:100` 的
      `MAX_REQUEST_BODY_BYTES`；这是**代码缺省**，不是 `ServeConfig.external` 的 YAML 键；超限 ⇒ 413
      `rejected_precondition`/`CONFIG_INVALID`/`subcause:'body-too-large'`，**不落记录**、**不带** `fieldPath`）
    `log: DaemonLog;`
  `}): IntentIngressInternal`（内部类型，80-§6.6：`IntentSubmissionPort & { replayQueued(): Promise<Result<number, ClassifiedError>> }`）
- 导出面：工厂返回**内部类型 `IntentIngressInternal`**（`submit`/`receipt` + `replayQueued`），**只由 `buildServeRuntime` 持有**；
  交给装配体/HTTP 的只有 `Pick<IntentSubmissionPort,'submit'|'receipt'>`（= `Pick<IntentIngress,…>`，**不含 `replayQueued`**），
  编译期就拿不到 `replayQueued`/`engine`（不得用 `as` 或 `Record<string, unknown>` 绕过）。`ingest` 是工厂闭包里的入队函数，
  **不出现在返回对象上**；`reserve` 同理不外露——多挂任一即等于给出绕过口（80-§6.6 末段）。
- `submit` 顺序（80-§6.6 冻结，不得倒）：
  ① 校验 `source ∈ allowedSources` → `kind === 'webhook'` → `requestKind ∈ RequestKind`（四值）→ `dedupKey` 非空
  → `body` 过限额 → `isCompanyMounted(company)`；
  ② `intake.reserve(envelope)`——**同一写事务**内查重 + 追加 `REC-WORK-01`，立即给 `intentRef`/`bodyDigest`/
  `receivedAt`/`duplicate`；**`intent_receipts` 的表投影由 `IntentReceiptStore` 自持的 projection hook 在同一事务内
  写入**（hook 由 store 注册，ingress 只把事务交出去，**不拼 SQL、不显式调 `upsert`**）；commit 后**同一微任务**
  （其间无 `await`）由 store 更新内存快照——重投判定**按记录现算**（`receipts.refresh(key)` 或直读记录），
  **不得**用 `get()`（快照是展示面，可能落后于刚提交的事务）；
  ③ 取本次记录的投影状态：`receipts.refresh(key)`（`key: IntentKey`，**按记录现算**，返回
  `Result<IntentReceipt|undefined, ClassifiedError>`）——**不用** `get()`；`refresh` 失败 ⇒ 原样 `Err` 上抛，
  **不得**降级成「当作新单」或「当作 `unknown`」；
  ④ **仅**「新建」或「同键同摘要 + `queued`」才 `engine.ingest([invokeIntent])`——**`decided` 永不重投**
  （无论窗内窗外都不重新入队旧意图）；`unknown` 未对账前亦不入队；
  ⑤ 返回 `Ok({receipt, duplicate})`。
  `duplicate === true` 且 `status` 为 `decided`/`unknown` ⇒ **不入队**（未知不是可重试）。
- 四态重投（80-§6.6 表逐行实现，不得合并且不得新增第五态）：
  `queued`+同摘要 → 重入队、200 `duplicate:true`；`decided`+同摘要（**窗内**）→ 不入队、200 `duplicate:true`；
  `unknown`+同摘要 → **不重放**、200 `duplicate:true` 且 `status:'unknown'`（**不伪造 202、也不回 `Err`**）；
  去重窗内不同摘要 → 409 `rejected_idempotency`；窗口已过的 `decided` → **另立新单**（新 `REC-WORK-01`，经
  `lineage.supersedes` 指旧 `recordId`），**只对新单入队**、202 `duplicate:false`（旧单不动、不重投）；未命中 → 新建、202。
- TTL：`expiresAt = receivedAt + ttlMs`（**导出值**，不落盘）；`queued` 永不过期、`decided` 过期可另立、
  `unknown` **未对账不得**过期/重放/另立（80-§6.6「TTL 与去重」五条全适用，本件不得自行放宽）。
- 启动重放：**由 `buildServeRuntime` 在启动末调一次 `replayQueued()`**（本件只提供方法，自己不触发）；扫投影
  `status:'queued'` 行（等价「有 `REC-WORK-01`、无 `REC-WORK-02`」）重新 `ingest`，返回重放条数
  `Result<number, ClassifiedError>`；同一 `intentRef` 幂等、不重复物化；带 `gap:['unknown-link-missing']` 的行
  **不在**重放集内。重放**不**写新记录、**不**改 `receivedAt`、**不**增 `attempts`（该字段在 80 已删除）。
- 错误与观测（本件只产 `ClassifiedError`，HTTP 状态由 packages/api 映射，80-§9.4 表）：
  409 `rejected_idempotency/EXTERNAL_REJECT`；403 `rejected_forbidden/EXTERNAL_REJECT`（来源不在白名单）；
  401 `rejected_authority/EXTERNAL_REJECT`；422 `rejected_precondition/CONFIG_INVALID`（kind/requestKind/`dedupKey` 空/
  公司未挂载/结构）；413 `rejected_precondition/CONFIG_INVALID` + `subcause:'body-too-large'`
  （`body` 超 `bodyLimitBytes`，**不带** `fieldPath`，不落记录）；
  429 `unavailable/STALL` + `subcause:'quota'`（`retryAfter` 由 api 侧出）；503 `unavailable/STALL`（daemon 未就绪，
  **不得**假装 202）。**拒绝只在一侧表达**：要么 `Err`，要么 `Ok`（`duplicate` 只描述重投）。
- IO 与注入：零 fs、零网络；SQLite 只经 `intake`（写 `REC-WORK-01`）与 `receipts`（写投影），
  **本件不持 `Ledger`**；不裸读时钟（`receivedAt` 由 `reserve` 给，TTL 是纯算术）。
- 状态与并发：无模块状态；实例生命周期＝第 6 步创建 → `runtime.stop` 弃引用。同键并发 `submit` 靠
  `reserve` 的写事务串行化，**不得**用进程内锁替代事务。
- 测试与证据：test/assembly/intent-ingress.test.ts（目标新件，契约见 §6.7）；不证明相位 2 受理结论与平台落单
  （U80-15 端到端另证）。
- 规模：≤ 260 行。**未证**：`WorkIntake` 与 `InvokeIntent` 全链未落地（U80-15）。
```

```text
F-daemon-intent-receipt-store
- 路径/处置：src/assembly/intent/receipt-store.ts；**目标-新增**（`intent_receipts` 投影的唯一维护者）。
- 归属：80-§6.6（投影判据 / 键还原公式 / 同键多条 / 只增不改 / 规则 5–10）、§6.3（`TableProjectionResult`/
  `RecordProjection`/`RecordTransaction`）、§3.6 第 6 步（启动序）、§7（`REC-EVT-03.unknown_scope.intentRef`）；
  03-store `F-store-ledger-intent-receipts`（表在 `src/migrations/intent.ts`、持久化原语在
  `src/ledger/intent-receipts.ts`）；81-§3.3。
- 职责：从 `REC-WORK-01/02` 与 `REC-EVT-03` **派生**回执行并落 `intent_receipts`；维护 commit 后的**内存快照**；
  提供 `refresh`/`get`/`rebuild`。维护路径**仅三条**：启动 `rebuild()`、写事务内 projection hook（commit 后同微任务刷
  快照）、崩溃后再次启动的 `rebuild()`。除这三条外**没有**第四条写投影的路。
  非职责：不写记录本体（`REC-WORK-01/02` 归 `WorkIntake`）、不产 `REC-RCP-01`、不做 HTTP、不判受理、
  不新增「独立于记录的 queued 事实」（80-§6.6 第 2 条）、**不拼 SQL**（只调 03 的 `upsert`/`replaceAll`/扫描原语）、
  不提供 `upsert(receipt)`/`queued(company)`/`mark*` 之类旁路写口、不判 TTL（TTL 只由 ingress 的纯算术表达）。
- 内部（目标签名，逐字取 80-§6.6，不改形）：
  `createIntentReceiptStore(deps: { ledger: Ledger; clock?: BuildRuntimeOpts['clock'] }): IntentReceiptStore`
  · `refresh(key: IntentKey): Promise<Result<IntentReceipt | undefined, ClassifiedError>>`（**按记录现算**，可失败）
  · `get(key: IntentKey): Promise<IntentReceipt | undefined>`（读**内存快照**，**无** `Result` 轴）
  · `rebuild(): Promise<Result<TableProjectionResult, ClassifiedError>>`
  `TableProjectionResult`（80-§6.3）：`kind:'table'`、`name: TargetTableProjectionName`（本件恒 `'intentReceipts'`；
  该类型 = 现状 17 个 `TableProjectionName` | `'resourceLedger'`，**不是**仅 `TableProjectionName`——表投影结果
  可以携带尚未建表的目标名）、`rows`=**本次处理行数**、`cursor`=**完成时 `null`**（有下一页才是 opaque 游标）。
  三方法返回形状不得自造。**W-20 已关闭（v0.4）**：
  80 已写死口径——`rows` 是本次扫描/处理的行数（不是表总行数），完成必须 `cursor:null`；
  0 行合法且**不等于**「未运行」。投影名口径见 §〇：现状 **17** 个 `TableProjectionName`，
  `resourceLedger` 是**目标第 18 个**（物理表 `resource_ledger`，随 MIG-01 建表，表未建前**运行期**不得返回该 `name`）；
  `daemon_kv`/`schema_version`/`hr_sync_log` **不是**投影名。80-§6.3 现已写 `name: TargetTableProjectionName`
  （W-22 已关闭（v0.6），`80:1220`），本件照写、无待回写。
- `get` 语义（80-§6.6 规则 8）：只读**本进程已提交**的快照（内部 `ReadonlyMap<IntentKey, IntentReceipt>`），
  **不读 SQLite、不重算、不透出 `Result`**；`undefined` 只有两种含义——「该键从未登记」或
  「该行 `gap:'intake-link-missing'` 不可重建」。运行期库故障**不得**折算成 `undefined`（那会把故障伪装成
  「不存在」），一律由写面/`refresh`/健康观测报 `Err`。`get` **不得**用于入队判定、重投判定、重放筛选——
  这三处一律 `refresh(key)` 或直读记录（80-§6.6 submit 顺序）。
- `rebuild` 语义：先按记录重算整张表（删表重建，`replaceAll` 语义；**长 IO 在事务外**、批内事务），再用**同一份
  结果**重建内存快照（不二次读库、不二次派生）；必须**先于 API 装配**（80-§6.6 规则 9）；失败 ⇒ **拒启动**
  （原样上抛，不折成空投影）；重建结果为 0 行合法（`rows: 0`、`cursor: null`），空投影与「重建失败」是两件事。
- `IntentReceipt.status` 的三值恰为 `queued`/`decided`/`unknown`——**不得回 `pending`、不得回 `rejected`**
  （80-§6.6 端口签名；HTTP 面拿到的 `queued` 只表示「已受理待转交」，不是受理结论）。
- status 判据（三行写死，不得加第四态）：`queued` = 有 `REC-WORK-01`、无 `REC-WORK-02`、无 `REC-EVT-03`；
  `decided` = 有 `REC-WORK-02`；`unknown` = 有 `REC-EVT-03` **且**其 `unknown_scope.intentRef` 指向本条
  `REC-WORK-01.recordId`。
- 键还原（唯一公式，**不得从 payload 猜**）：`company ← RecordEnvelope.companyRef.companyId`、
  `source ← source.channel`、`kind ← source.kind`、第四位 ← `source.ticket ?? source.dedupKey`；
  与 `core/src/decide.ts:319`–`:324` 的 `intentKeyOf` 逐位一致。`source` 是结构、`IntentKey.source` 是字符串——
  同名不同轴，不得整块塞入。任一必填子键缺失 ⇒ 该行不可重建：标 `gap:'intake-link-missing'` 并**拒出回执**。
- 字段映射：`intentRef`←`REC-WORK-01.recordId`；`bodyDigest`←`raw_content` 按固定 canonicalization 求摘要
  （**不得**用 payload 现算冒充）；`receivedAt`←`REC-WORK-01.received_at`；`expiresAt` 导出（不落盘）；
  `outcome`/`referredTo`/`decidedAt`/`intakeRecordRef`←`REC-WORK-02`；`unknownRef`←`REC-EVT-03.recordId`。
- 同键多条：当前回执取 `receivedAt` **最大**者，其余留档（`lineage.supersedes` 串起）；
  **不得**按「表里最后写入的行」覆盖，也**不得**返回最早一条。03 的 `upsert` 已带
  `WHERE excluded.received_at > …` 守卫，投影侧**不得**再写一套比较逻辑。
- 只增不改：旧行 `receivedAt`/`outcome` 一经落定不再改写；新记录只改变「当前回执指向谁」。
  `rebuild()` 删表重建必须**逐字段一致**（80-§6.6 第 1 条）。
- `#4 unknown-link-missing`：`REC-EVT-03` 缺 `unknown_scope.intentRef` 时行**保持 `unknown`**
  （**不得降级为 `queued`**）、`unknownRef` 缺省、`gap:['unknown-link-missing']`；**禁止**自动重放、
  禁止另立同键新意图、**不得**由投影「猜最近一条 EVT-03」补链（补链只归 `REC-06` 对账）。
- 事务/取消/恢复：projection hook **必须挂在 `WorkIntake.reserve` 的同一写事务**上（80-§6.6 规则 7），
  与 `REC-WORK-01` 同生共死；commit 后**同一微任务**（其间无 `await`）刷快照；事务回滚时快照不动。
  取消：调用方 abort ⇒ 事务回滚、无半行；`rebuild` 被取消 ⇒ 旧表不被清空（先写临时表再换，或整事务回滚）。
  崩溃恢复**只**靠下次启动 `rebuild()`；四个注入点（提交前 / 提交后刷快照前 / 投影写后 / `rebuild` 中途）
  由 U80-19 证，本卷不宣称已验。
- 导出与依赖：`createIntentReceiptStore` + `IntentReceiptStore` 类型；依赖 contract（`IntentReceipt`/`IntentKey`/
  `Qid`/`ClassifiedError`/`TableProjectionResult`）、store（`Ledger` 写口与 `intent_receipts` 原语）。
  **不 import api、不 import engine、不 import gateway**。
- IO 与注入：唯一 IO＝经 `Ledger` 与 03 原语的 SQLite 读写；`clock` 可选，仅用于诊断时间戳，
  **不得**替代记录里的 `received_at`；零 fs、零网络、不读 env。
- 错误与观测：库读/事务失败 ⇒ `unavailable/STALL`（`subcause:'ledger-read-failed'|'ledger-write-failed'`）；
  表缺失/版本不符 ⇒ `rejected_version/EVOLVE_REJECT`（`schema-behind`/`schema-ahead`，原样上抛）；
  store 未注册该投影名 ⇒ `unsupported` + `CONFIG_INVALID`（`projection-unknown`）。本件**不产**
  `rejected_forbidden`（无授权面）；命中同键不同摘要的**一致性检查**只在窗口内由 ingress 表达（409），
  本件**不**自行拒绝。不落 `REC-*`：投影刷新是派生动作，不是事实事件。
- 测试与证据：test/assembly/intent-receipts.test.ts（目标新件，契约见 §6.7）：三态判据逐行、键还原与
  `intentKeyOf` 逐位比对、同键多条取最大 `receivedAt`、`rebuild` 删表重建逐字段一致（含 0 行）、
  `get` 在库不可读时仍返快照、`refresh` 在同场景返 `Err`、hook 与 `reserve` 同事务（回滚后表无行）。
  不证明 runServe 全链（U80-15）、不证明崩溃四点（U80-19）。
- 规模：≤ 240 行。
```

```text
F-daemon-runtime-secrets
- 路径/处置：src/assembly/runtime/secrets.ts；**目标-新增**（秘密面 + 会话面的唯一装配者：`KnownSecretSet` 与
  `MatrixSessionFactory` 登录句柄都从这里出）。
- 归属：80-§11.2.1（装配五步 + 三态 + `broker-ref`）、§3.3 第 6 条（`ServeConfig.secrets` 三键）、
  §3.4 第 8 条（**不新增** `BuildRuntimeOpts.secretProvider`）与第 10 条（`MatrixSessionFactory`）、
  §3.6 第 6 步（秘密面/会话面先于 `rebuild` 与 API）、§11.4.1（worker 不持 `gatewaySecret`）；
  78-§7.4.1（`secretId` 命名）；81-§1.6。
- 职责：按 `ServeConfig.secrets` 与当前启用能力装配 `KnownSecretSet`；**用两种互不通用的秘密句柄**驱动
  `matrixSessionFactory`：登录用 `SEC-MX-BOT-PASSWORD` 构造 `MatrixBotLoginSecret`（`use:'platform-auth'`），
  建号能力开启时再取 `SEC-MX-HR-SHARED` 构造 `MatrixHrRegisterSecret`（`use:'matrix-register'`），返回四个面 + `close()`。
  非职责：不定义秘密类型（在 `contract/src/ports/secret.ts`，跨卷目标件）、不做授权判断（归 `TS-PORT-AUTH-*`）、
  不落盘、不写 `REC-*`（可选缺失只上报 `missingSecretIds`，记录由 `buildServeRuntime` 落 `REC-LOSS-01`）、
  不把值交给 worker、**不实现 Matrix 协议**（只调工厂）。
- 输入与签名（目标；80 明写的逐字取，其余标「本卷拟」）：
  `assembleSecretSurface(args: {`
    `secrets: ServeConfig['secrets'];`（`catalog` 缺省 `[]`；`fileRoot`/`brokerBinding` 可缺）
    `capabilities: { external: boolean; matrix: boolean; hrSync: boolean; hrPeopleWatch: boolean };`（本卷拟：只用于裁剪）
    `matrix?: { homeserverUrl: string; botUserId: string; userAgent?: string };`（本卷拟：`MatrixSessionFactoryDeps` 的非秘密键）
    `matrixSessionFactory?: MatrixSessionFactory;`（来自 `RunServeOpts`；boot 只构造、不登录）
    `log: DaemonLog; clock?: BuildRuntimeOpts['clock'];`
  `}): Promise<Result<SecretSurface, ClassifiedError>>`
  `SecretSurface = { knownSecrets: KnownSecretSet; missingSecretIds: readonly string[];
    matrixSession?: { matrixSource: () => InvokeSource; matrixRoomFace: (ctx: MatrixRoomFaceContext) => MatrixRoomFace;
    hrMatrixFace: () => MatrixHrFace; notifyBroadcast: NotifyBroadcastFace; close(): Promise<void> } }`（本卷拟包装，
  五个成员**逐字段等于** 80-§3.4 第 10 条的工厂返回形状，不新增成员）。
  调用点：`buildServeRuntime` 第 6 步的第 ① 段（80-§3.6），早于 `receipts.rebuild()` 与 API 装配。
- 装配五步（80-§11.2.1，顺序固定）：
  ① **catalog**：取 `secrets.catalog`（缺省 `[]`）；空目录 ⇒ `known-set-empty`，**合法**，不拒启；
  ② **能力 × 范围裁剪**：关闭的能力（`capabilities.* === false`）所需条目**不 load**；`entry.subjectScope`
     不覆盖本部署的条目**不装配**（不算缺失）；`broker-ref` 而 `brokerBinding` 未注册 ⇒ 该条 `unavailable`；
  ③ **provider 解析**：按 `entry.valueProvider` 取 `env-ref`/`file-ref`/`local-mint` 三种（`file-ref` 以
     `secrets.fileRoot` 为根，**不得**接受绝对路径）；`provider.load(entry, use)` 是唯一外部调用；
  ④ 汇总 `SecretMaterial[]`（值只在闭包，不进返回对象以外的任何结构）；
  ⑤ 装配只读 `KnownSecretSet`（`secretIds`/`state`/`missingSecretIds`/`redact`/`find`）。
  对 `use:'outbound-redaction'` 要把**全部** `allowedUses` 含该值的条目 load 一遍（脱敏集合必须完整），
  再按各能力所需 `use` 分别 load。
- 会话面（80-§3.4 第 10 条，**两个不同秘密类型，不得互换**）：
  · 登录槽：从 `KnownSecretSet` 取 `SEC-MX-BOT-PASSWORD` 的 `SecretMaterial`，构造
    `MatrixBotLoginSecret = { kind:'password', secretId:'SEC-MX-BOT-PASSWORD', use:'platform-auth', material }`
    填入 `MatrixSessionFactoryDeps.login`；
  · 建号槽：**仅建号能力开启时**取 `SEC-MX-HR-SHARED`，构造
    `MatrixHrRegisterSecret = { kind:'shared-secret', secretId:'SEC-MX-HR-SHARED', use:'matrix-register', material }`
    填入 `registration?`；**不得**用 bot 密码（`SEC-MX-BOT-PASSWORD`）建 HR 账号——它的 `allowedUses` 只有
    `platform-auth` + `outbound-redaction`，请求 `matrix-register` 即 `rejected_forbidden`（不是「同义别名」，
    也**没有**「保留未用」的第三用途）。建号关闭 ⇒ `registration` 不构造、不 `load`（次数 0）。
  连同 `homeserverUrl`/`botUserId`/`userAgent?` 交 `matrixSessionFactory(deps)`；daemon **驱动登录**、
  boot **不登录、不取 token、不存密码**。
  句柄校验（按两型**分别**判）：login 必 `secretId==='SEC-MX-BOT-PASSWORD'` 且 `kind==='password'` 且
  `use==='platform-auth'`；registration 必 `secretId==='SEC-MX-HR-SHARED'` 且 `kind==='shared-secret'` 且
  `use==='matrix-register'`；`kind` 判别**不得按值长度/形状猜**。任一项不符 ⇒ 按能力拒启
  （`rejected_forbidden`/`rejected_precondition`），**不得**降级成「不登录继续跑」或「只登录不建号」。
  未注入 `matrixSessionFactory` 而 `capabilities.matrix` 为真 ⇒ `CONFIG_INVALID`（`matrix-session-missing`）；
  **工厂与任一直接面同时给 ⇒ 一律 `CONFIG_INVALID`**，**不比较是否「矛盾」**（启动期不可判，也不得择一静默）；
  单独给工厂或单独给四面都合法。`matrixDeptMap` 的 `baseDir` **不属本件**：`{configPath}` 分支由
  `dirname(resolve(configPath))` 定、`{config}` 分支由 `BootOptions.deploymentBaseDir` 显式给（boot 自有类型，
  不传 daemon，缺省不得回落 `process.cwd()`）。
- 三态（80-§11.2.1 第 3 条，不得混同）：`known-set-empty`＝部署无任何可选秘密（合法，出站仍跑形状检测，
  证据须写 `known-set-empty`，**不得**声称「无泄漏」）；`known-set-partial`/`missingSecretIds`：必需要素缺失 ⇒
  `rejected_precondition`+`CONFIG_INVALID` **拒启该能力**（关键能力缺失即整机拒启）；可选缺失 ⇒ **只**不装配
  该能力，并把 `secretId` + 受影响能力交 `buildServeRuntime` 落一条 `REC-LOSS-01`，**不得静默少装**；
  `known-set-complete` 只是「应有尽有」，**不**是「无泄漏」的证明。
- 降级与兜底：`hrKnownSecrets?: readonly string[]`（`RunServeOpts` 旧键）降级为测试/装配兜底；与 catalog 同时
  存在时**以 catalog 为准**并启动日志告警（只记 `secretId` 与数量，**不含值**）。
- per-ticket `wkey`：不进静态 catalog、不落盘；活跃期签发即登记（`SEC-WKEY-<ticketId>`），`CLOSE` 即移除并留
  一个去重窗兜底。轮换/吊销 ⇒ **整体重建**集合（不就地改元素），替换窗口内两代并存（宁可多脱敏）。
- 密码学边界：`redact`/`find` 直接复用 80-§11.2-3 迁入 `contract` 的纯函数，**不新造算法**；顺序固定
  `find` 判 → `redact` 改 → 才允许出站；不得用正则兜底冒充完整（短值与非常规形会漏，fail-open 判负）。
- IO 与注入：唯一 IO＝`provider.load`（`env-ref` 在 provider 实现内读 `process.env`，**本件不直读 env**；
  `file-ref` 由 provider 按 `fileRoot` 解析，**本件零 fs**）；网络只经 `matrixSessionFactory`（登录），
  本件不持 HTTP client；`clock` 只用于会话超时与日志，不参与秘密判定。
- 状态与并发：返回的 `SecretSurface` 运行期只读；装配体无模块状态；同一进程**一个** `WkeyAuthority`（stdio 共用）。
  值只在受控内存，**不**进日志/事件/REPORT/导出；`gatewaySecret` 绝不进 worker（§11.4.1）。
- 错误与观测：`use ∉ entry.allowedUses` ⇒ `rejected_forbidden`；必需缺失/会话面缺失 ⇒
  `rejected_precondition`+`CONFIG_INVALID`（`secret-missing`/`matrix-session-missing`）**整机拒启**；
  provider 调用失败 ⇒ `unavailable`+`STALL`（`secret-provider-failed`）；`broker-ref` 无绑定 ⇒ `unavailable`。
  日志只出 `secretId`、数量、`state`；**永不打印值**（含错误文案）。
- 测试与证据：test/assembly/serve-secrets.test.ts（目标新件）：三态各一例、`use` 不允许、
  `subjectScope` 范围外不 load、关闭能力零 `load` 调用（用 spy 断言次数）、`secretIds` 不含值、
  `matrixSessionFactory` 路径下 boot 零登录（工厂收到 `login.material` 才登录）、**两型句柄不可互换**
  （拿 bot 密码填 `registration` ⇒ 拒启）、**建号关闭时 `SEC-MX-HR-SHARED` load 次数 0**、
  **工厂与任一直接面同给 ⇒ `CONFIG_INVALID`**、必需缺失拒启。不证明真实 homeserver 登录与轮换（U80-17）。
- 规模：≤ 200 行。**未证**：U80-17（`MatrixSessionFactory` 未实现）、U80-18（`contract/src/ports/secret.ts` 全仓无此文件）。
```

```text
F-daemon-hrsync-config
- 路径/处置：src/assembly/hrsync/config.ts；215 行；现有；目标-保留。
- 归属：80-§3.3 第 3 条（HrServeConfig 是子面而非第二类型，经 extends 收平进 ServeConfig）。
- 职责：HR 同步配置面的十键类型、缺省、逐键收窄、交叉校验、秘密键收集、房间别名表解析。
  非职责：不装配执行面（hrsync/assemble.ts）、不读文件/env（秘密收集只接受 env 值入参）。
- 内部：HrServeConfig 十键=hrSync/hrMaxPerTick/hrRetryLimit/hrApplyingTimeoutMs/hrMatrix/hrMatrixRooms?/
  hrTaigaInviteLog?/hrTaigaInvitePolls/hrTaigaInvitePollMs/hrPeopleWatch；HR_SERVE_DEFAULTS；
  HR_SERVE_KEYS；coerceHrServeKey；validateHrServeCross；collectHrSecrets(env, extra?)；parseHrRooms(spec)
  → {company, byDept, aliasForDept(dept)}。
- 导出与依赖：八导出（两类型 + 两常量 + 四函数）；零跨包依赖（纯）。
- IO 与注入：**零 IO**——env 以参数注入（`collectHrSecrets(process.env, …)` 的读点在调用方
  hrsync/assemble.ts:58）。时钟/随机不用。
- 状态与并发：无状态；缺省对象只读展开（HR_SERVE_DEFAULTS 冻结用法）。
- 错误与观测：收窄/交叉失败以裸 Error 上抛（由 coerce 段统一处置口径）；秘密只报键名不打印值。
- 测试与证据：test/assembly/serve-config.test.ts「daemon.yaml hrSync 配置面」九条；serve-hrmatrix.test.ts。
- 规模：≤ 300 行；新增 hr* 键必须同时给缺省、交叉校验与 81 归属（80-§3.3 第 4 条）。
```

```text
F-daemon-hrsync-assemble
- 路径/处置：src/assembly/hrsync/assemble.ts；159 行；现有；目标-保留。
- 归属：80-§3.4 注入表（hrMatrixFace 开而未注入 ⇒ CONFIG_INVALID）、§3.4 第 10 条（`matrixSessionFactory` 返回的
  `hrMatrixFace` 与直接注入同形，二者取一）；docs/52-§九。
- 职责：HR 同步器装配——按配置拼 Taiga/Matrix/房间三面，返回 `{ drain() }` 注入引擎相位 7 尾；
  `hrSync=false` 返回 undefined（零注入零行为）；另导出 apply 段 `hrApplySegment`。
- 内部：AssembleHrSyncArgs{config, hrMatrixFace?, knownSecrets?, hrKnownSecrets?, ledger, snapshot, clock, log,
  engineDeptFallback, platformIssues, makeId}；assembleHrSync(args) → {drain}|undefined；hrApplySegment(args)。
  **目标**：`knownSecrets?: KnownSecretSet`（来自 `F-daemon-runtime-secrets`）为首选秘密源；`hrKnownSecrets`
  降级为兜底（80-§11.2.1 第 1 条），两者并存时以 `knownSecrets` 为准。
- 导出与依赖：两函数 + 一类型；依赖 contract/core/store/taiga 与 engine 的 MatrixHrFace/TaigaHrFace 类型。
- IO 与注入：process.env（:58 `collectHrSecrets(process.env, args.hrKnownSecrets)`）、fs（taiga 邀请令牌日志轮询）、
  path；clock/makeId/log 注入。秘密面：现状从 `@studio-next/core` 取 `redactOutbound`（:26）包住所有出站文本；
  **目标**改为 `KnownSecretSet.redact`（实现仍复用 80-§11.2-3 迁入 `contract` 的同一纯函数，
  `core → contract` 是纯移动，不改算法）；本文件**不**新造脱敏算法、**不**直读 env 取值。
- 状态与并发：批次状态在台账（hr_sync_log）；drain 每拍限量（hrMaxPerTick）。
- 错误与观测：`hrSync+hrMatrix: true` 而未注入 ⇒ 现状裸 Error 带 `CONFIG_INVALID：` 前缀（:84）——
  **目标**改 `ClassifiedError{ failure:'rejected_precondition', category:'CONFIG_INVALID', subcause:'hr-matrix-face-missing' }`
  （与 `F-daemon-serve` 的启动序同口径，80-§3.4）；达重试上限 → failed 终态 + ESCALATE（不自动开单）；
  可选秘密缺失由装配期落 `REC-LOSS-01`，本文件只消费 `KnownSecretSet`，不自行判定缺失。
- 测试与证据：test/engine/hrsync/*（引擎面）；serve-hrmatrix.test.ts（装配面开/关/未注入三态）。
- 规模：≤ 300 行。
```

```text
F-daemon-run-serve-opts
- 路径/处置：src/assembly/hrsync/run-serve-opts.ts；35 行；现有；目标-保留 + **补两键**
  （`notifyBroadcast`、`matrixSessionFactory`，80-§3.4 第 1/10 条：本轮**仅此两个**新键）。
- 归属：80-§3.4 第 1 条（唯一部署注入类型）、第 2 条（`BuildRuntimeOpts`）、第 3 条（不改家）、
  第 7 条（判别联合）、第 8 条（**不新增 `secretProvider`**）、第 10 条（`MatrixSessionFactory`）；
  81-§3.2 第 2 条。
- 职责：`runServe` 的公共注入面类型（组合根 `apps/boot` 是唯一生产调用方）+ 工厂类型 `MatrixSessionFactory`
  的类型家。非职责：不含装配/测试注入（`log`/`clock`/`quarantineMs`/`hrKnownSecrets`/`evolveSelfCheck`）——
  那是 `BuildRuntimeOpts = RunServeOpts & { log?; clock?; quarantineMs?; hrKnownSecrets?; evolveSelfCheck? }`
  （80-§3.4 第 3 条，字段逐字取该句；**没有** `secretProvider`）；也不做运行期校验、不实现登录。
- 内部（目标五键，逐字取 80-§3.4 第 10 条）：
  `matrixSource?: () => InvokeSource`；`matrixRoomFace?: (ctx: MatrixRoomFaceContext) => MatrixRoomFace`；
  `hrMatrixFace?: () => MatrixHrFace`（**不是** `MatrixRoomFace`——这是旧稿最常见的笔误）；
  `notifyBroadcast?: NotifyBroadcastFace`；`matrixSessionFactory?: MatrixSessionFactory`。

  ```ts
  // 与 80-§3.4 第 10 条逐字一致；本文件是这四个类型的家。
  // 两个**逻辑秘密类型**：判别位写死，不能互换（bot 密码不得用来建 HR 账号，反之亦然）
  interface MatrixBotLoginSecret {                  // 登录句柄：唯一允许驱动 bot 登录的秘密
    readonly kind: 'password'                       // 判别位：与 SecretMaterial.kind 同值
    readonly secretId: 'SEC-MX-BOT-PASSWORD'        // 字面量：只接受这一条
    readonly use: 'platform-auth'                   // 登录**只**取这个槽位
    readonly material: SecretMaterial               // 值只在此字段；不进日志/快照/持久化/PRM
  }
  interface MatrixHrRegisterSecret {                // 建号句柄：HR 共享秘密，**不是** bot 密码
    readonly kind: 'shared-secret'
    readonly secretId: 'SEC-MX-HR-SHARED'           // 字面量：只接受这一条
    readonly use: 'matrix-register'                 // 建号**只**取这个槽位
    readonly material: SecretMaterial
  }
  interface MatrixSessionFactoryDeps {
    homeserverUrl: string
    botUserId: string
    login: MatrixBotLoginSecret                     // 必填：bot 登录（platform-auth）
    registration?: MatrixHrRegisterSecret           // 仅建号能力开启时给；缺失即拒启动该能力
    userAgent?: string
  }
  type MatrixSessionFactory = (deps: MatrixSessionFactoryDeps) => Promise<{
    matrixSource: () => InvokeSource
    matrixRoomFace: (ctx: MatrixRoomFaceContext) => MatrixRoomFace
    hrMatrixFace: () => MatrixHrFace
    notifyBroadcast: NotifyBroadcastFace
    close(): Promise<void>                          // runtime.stop 调用，先于 ledger.close()
  }>
  ```

  返回形状**逐字段等于现有四个注入项**（四个工厂/面本身，**不是已构造好的面**）；`close()` 由 daemon 持有，
  停机时在 `apiHandle.close()` 之后、`engine.dispose()`/`ledger.close()` 之前调（`F-daemon-serve` 第 10 步）。
- 缺省语义（写进类型注释，逐行对齐 80-§3.4 表，不得合并）：

  | 键 | 配置开 | 配置关 | 开而未注入 |
  |---|---|---|---|
  | `matrixSource` | 需要 | 不调用 | `CONFIG_INVALID` 拒启动 |
  | `matrixRoomFace` | 需要 | 不调用 | `CONFIG_INVALID` 拒启动 |
  | `hrMatrixFace` | 需要（`hrSync`+`hrMatrix`） | 不调用 | `CONFIG_INVALID` 拒启动 |
  | `matrixSessionFactory` | 生产路径**必须**（与直接四面**二选一**） | 不调用、不 `load` 密码 | `CONFIG_INVALID` 拒启动；**与任一直接面同时存在即拒**（一律 `CONFIG_INVALID`，**不比较是否「矛盾」**、不得择一静默） |
  | `notifyBroadcast` | 可选 | 面关零行为 | **面关零行为**，不拒启动（只少一条广播通道） |

- boot 侧（80-§3.4 第 9/10 条）：boot 只 `createMatrixSessionFactory(...)` 并传入本键，**不驱动登录、不解析秘密、
  不持 token、不落盘**；`daemon/serve` 是 boot 唯一的 daemon 侧运行时导入。daemon 侧由
  `F-daemon-runtime-secrets` 构造 `MatrixBotLoginSecret`（+ 建号时的 `MatrixHrRegisterSecret`）并调工厂。
  **`matrixDeptMap` 的 `baseDir` 不属本类型**：`{configPath}` 分支 = `dirname(resolve(configPath))`；
  `{config}` 分支由 `BootOptions.deploymentBaseDir: string` **显式**给（boot 自有类型、**不传 daemon**、
  缺省不得回落 `process.cwd()`）；boot 只读一次配置并派生一次 `matrixDeptMap`。
- 兼容面：现有四个面的**直接注入保留**为测试/迁移兼容（不删）；有工厂时生产路径以工厂结果为准并在启动日志记
  一条「工厂路径」；**工厂与任一直接面同时出现 ⇒ 一律 `CONFIG_INVALID`**（80-§3.4 第 10 条：启动期不判两者
  是否冲突，故不比较、不择一）。
- `runServe` 入参（80-§3.4 第 7 条，覆盖第 2 条的旧写法）：`runServe(input: { configPath: string } | { config: ServeConfig },
  opts?: RunServeOpts)`，**二选一、不得同时给**；CLI 传 `{ configPath }`、boot 传 `{ config }`；`parseDaemonConfig`
  仍是唯一解析实现，不得双读同一份 YAML。
- 导出与依赖：五键 interface + `BuildRuntimeOpts` + **四个** Matrix 会话类型（`MatrixBotLoginSecret`/
  `MatrixHrRegisterSecret`/`MatrixSessionFactoryDeps`/`MatrixSessionFactory`，**同文件**，80-§3.4 第 3 条只改名不改家）；
  type-only import：contract `InvokeSource`/`SecretMaterial`、engine `MatrixHrFace`/`MatrixRoomFace`/`MatrixRoomFaceContext`/
  `NotifyBroadcastFace`。层位 assembly→engine 合法；**不新增 `daemon→matrix` 包边**（matrix 侧按结构同形返回，见 81-11）。
- IO/注入/状态/错误：纯类型；无运行时代码、无 IO、无状态。
- 目标收口（§8.1 W-8）：`runServe` 第二参、`buildServeRuntime` 第三参、`BootOptions.serve` 三处改引用本类型或
  `Pick<RunServeOpts, 'matrixSource'|'matrixRoomFace'|'notifyBroadcast'|'hrMatrixFace'|'matrixSessionFactory'>`，
  删除三份内联匿名类型（`:1445-:1468`、`:884-:923`、`boot.ts:68-:75`；后者**缺 `hrMatrixFace`** 是现状缺陷，
  一并补齐）。收口后**只允许**本文件定义注入键；新增键必须先改 80-§3.4 表。
- 测试与证据：boot.test.ts:26 现唯一引用点（应改走 `@studio-next/daemon/serve` 再导出）；收口后由
  `bun run typecheck` 与 serve-*、serve-secrets 测试保证不漂。**未做**：补两键与三处收口（W-8）。
- 规模：≤ 120 行（含三个会话类型的注释）。
```

```text
F-daemon-platform-wire
- 路径/处置：src/assembly/platform/wire.ts；148 行；现有；目标-保留。
- 归属：80-§9.5 第 1-3 条（写只经网关；网关拒绝即拒绝；署名由 daemon 身份注入）、§6.8 `FlowPlatform`。
- 职责：把 `FlowPlatform` 原件包成网关代理（`wireGatedPlatform`）、解析 taiga 凭据、装载字段映射、
  计算待 provision 的声明状态集、按 config 构造平台（`wirePlatform`）。
- 内部：wireGatedPlatform(raw, config, identity, clock, log): FlowPlatform；resolveTaigaAuth(mode):
  TaigaAuth；loadTaigaFieldMap(file): FieldProvisionMap；provisionDeclaredStates(map, entity): string[]；
  wirePlatform(config): FlowPlatform。
- 导出与依赖：五函数；依赖 contract/gateway/localplatform/taiga。
- IO 与注入：fs=读字段映射文件（表头注释禁入「运行时 overlay」面）；env=TAIGA_USERNAME/TAIGA_PASSWORD
  (:59-60)、TAIGA_TOKEN(:69)、TAIGA_REFRESH(:76)；clock/log 注入；零网络（懒连接）。
  **目标**：凭据取值改由 `KnownSecretSet`/`SecretProvider` 供给（`SEC-TG-TOKEN`/`SEC-TG-PASSWORD`——`TG`=Taiga；
  **env 键名不变**仍是 `TAIGA_TOKEN`/`TAIGA_PASSWORD`，改名只动 `secretId`；`SEC-YT-*` 属 YouTrack，不可混用），
  env 直读降为测试兜底（80-§11.2.1 来源表）。
- 状态与并发：无模块状态；平台实例由装配方持有。
- 平台能力与绑定档案的分工（80-§6.9 结论）：本件**只造平台能力面** `FlowPlatform`（七能力
  issues/comments/fields/kb/activity/links/guards；写只经网关）；`PlatformBindingPort`（`describe`/`mapState`/
  `exportBundle`/`exitPlan` + 78-§1.2 的 `BindingProfile` 20 字段）由**同目录 `binding.ts`** 承载
  （`F-daemon-platform-binding`，daemon 侧唯一实例）。本件**不得**内联/再实现该端口，也不得持有绑定实例
  ——`platform/` 下只允许**一个**绑定宿主；`FlowPlatform` 也不得改名冒充绑定端口。
- `mapState` 的语义（消费方必守，80-§6.9）：未映射但合法的平台态 ⇒ `Ok({ platformState, workStates: [],
  verification:'unverified', unmappedBehavior:'observe-unmapped' })` + 由 daemon 侧消费方落 `REC-OBS-02`
  （`mapState` 是纯函数，不写记录）；**只有**空值/畸形才 `Err(rejected_precondition)`。消费方不得把「`workStates` 为空」读成「无进行中工作」，
  也不得回落到本地默认态；`STAT-E` 一律判缺陷（不静默吞）。本文件是**能力面的消费者**，不重定义该端口。
- 错误与观测：凭据缺失/形状不合 ⇒ 现状裸 Error（:62/:71/:91/:97/:137，文案带 `CONFIG_INVALID：`）；
  **目标** `ClassifiedError{ failure:'rejected_precondition', category:'CONFIG_INVALID', subcause }`，
  只报键名/`secretId`，不含值。`config.gateway=false` ⇒ 返回原件 + 警告日志（仅测试/对照，生产不得关，17-§7）。
  **缺陷（现状实测，§8.1 W-10）**：`wirePlatform`（:129-:146）对 `platform: 'fake'` 直接返回
  `createFakePlatform()`，且 `agentYaml` 缺省时走 fake executor ⇒ **fake 可从生产配置选中**，
  违反 81-§3.1「fake 只归测试/演示」。目标：`platform: 'fake'` 只在 `realGateMode(config)===false`
  （demo/测试）时可选中，生产配置出现即 `CONFIG_INVALID` 拒启；本卷不擅自改判据，须先回写 80-§3.3/§10。
- 测试与证据：test/assembly/serve-config.test.ts「platform: taiga 配置面」十二条（含凭据 fail-closed
  只报键名）；test/engine/gated-platform.test.ts（网关面）。**不证明** `mapState` 的
  `observe-unmapped` 路径（该端口未实现）。
- 规模：≤ 300 行。
```

```text
F-daemon-platform-binding
- 路径/处置：src/assembly/platform/binding.ts；**目标-新增**（`PlatformBindingPort` 在 daemon 侧的**唯一宿主**：
  绑定档案的唯一装配点，与同目录 `wire.ts` 的「平台能力」分工）。
- 归属：80-§6.9 `TS-PORT-BIND-01`（四方法签名与全部前置/后置/错误/幂等/证据）、§6.6 **BIND-01 三层归属**第 2/5/6 条
  与 D27（宿主唯一、禁第二实现、`mapState` 纯函数）、§4.8 `REC-LOSS-01`（`RecBindingLossReport`，与 77
  `REC-LIFE-04` 是**两个 recordType**）、§6.4 `REC-OBS-02`（未映射观察故障，**由消费方写**）、78-§1.2
  （`BIND-CORE-01` 20 字段）、78-§9.1 与 76-§7.7（`STAT-E` 缺陷判据）；81-§1.5、§1.6。
- 职责：持有并暴露**一份**绑定档案——`describe()` 返回 `BindingProfile`（20 字段齐；执行探针、合并档案、
  `losses` 用 `Qid` 引用、无损失写显式 `[]`）、`mapState(platformState)` 调平台包纯函数得 `StateMapping`、
  `exportBundle(scope)` 按 `ExportScope` 组包（`manifest.shape` 只作**声明**）、`exitPlan()` 返回**纯声明** `ExitPlan`。
  纯映射 + 纯读：不改平台、不推进状态、不判验收、不判结清。
  非职责：不实现 `FlowPlatform` 七能力（归 `wire.ts` 与 `platform` 包）、**不写 `REC-OBS-02`**（消费方写）、
  不做迁移/验收/结清判定、不执行 `ExitPlan`（执行走 `TS-PORT-WORK-05`/`TS-PORT-LIFE-02`/`TS-PORT-LIFE-03`）、
  不构造第二个绑定实例；写面**仅限** `describe()` 按需落 `REC-LOSS-01` 引用，不写其它 `REC-*`。
- 端口与类型来源：形状**唯一源**是 `packages/contract/src/ports/binding.ts`（80-§6.6 三层第 1 条、S6；W-12 已关闭）
  ——本卷**不复制 20 字段**、不自造类型文件。本件只写**实现**：`createPlatformBinding(deps): PlatformBindingPort`；
  `deps` 收 `profile`（`bindingProfile()` 骨架 + 探针结果）、`map`（平台包 `mapState` 纯函数，`theirs → WorkState[]`，
  只许 `STAT-D`）、`losses`（`lossReport()` 的 `REC-LOSS-01` 引用集）、`clock?`、`log`。
- `mapState` 语义（80-§6.9 定死，本件照做）：命中 ⇒ `Ok({ platformState, workStates, verification:'verified',
  unmappedBehavior:'observe-unmapped' })`；**未映射但非空且合法** ⇒ `Ok({ …, workStates: [],
  verification:'unverified', unmappedBehavior:'observe-unmapped' })`——**纯函数**：零 IO、不写记录、不读时钟
  （原值原样保留、不归一化、不丢弃）；**只有空/畸形原值** ⇒ `Err(rejected_precondition)`。
  **不得** `Err(unsupported)`、**不得**回落本地默认态、**不得**把空 `workStates` 读成 `accepted`/`settled`/`closed`。
  `STAT-E` 映射一律**判缺陷**（78-§9.1、76-§7.7），不得静默改写成 `STAT-D`。
- `unverified` 的消费纪律（本件只给判定，拒绝在消费方）：迁移/验收/结清读到 `verification:'unverified'` 或
  `workStates=[]` ⇒ **停在原地**、不生成状态迁移、不判验收通过、不判结清；**不得**把 `unverified` 当失败重试，
  也不得把它改写成 `Err` 让调用方「按错误重试」——那是**消费方拒绝**，不是 `mapState` 失败。
- `REC-OBS-02` 由谁写：**daemon 侧消费方**写（相位 2 state-diff 或 `TS-PORT-OBS-01`；同一单、同一原值、
  同一拍一条），`mapState` 与平台包都不写；`REC-LOSS-01` 引用由 `describe()` 按需落（`RecordWriter`），
  记录本体归 build/迁移侧。IO 面仅此两处 + `clock`（`describe` 时间戳）；零 `fs`、零网络、零 `env`；
  `mapState` 零 IO。
- 三层归属（80-§6.6 BIND-01 第 1/2/3/5/6 条、D27，**禁第二实现**）：类型只在
  `packages/contract/src/ports/binding.ts`；**唯一宿主**是本件；平台包（`localplatform`/`taiga`/`yt` 的
  `src/binding.ts`）只供 `bindingProfile()`/`mapState()`/`lossReport()` 三个纯函数——不得导出
  `describe`/`exportBundle`/`exitPlan`、不读台账、不写记录、不读时钟。本件把这三个纯函数接到 `wire.ts`
  造好的 `FlowPlatform`；`wire.ts` 不得内联三方法；`platform/` 下只允许**一个**
  `createPlatformBinding` 调用点，由 `buildServeRuntime` 装配。
- 错误与观测：空/畸形原值 ⇒ `rejected_precondition`；`ExportScope` 超出 `knowledgeScope` ⇒ `rejected_forbidden`；
  `includesOpenObligations=false` 却宣称完整 ⇒ `rejected_precondition`；无接收确认就宣称退出 ⇒ `rejected_precondition`
  （`ExitPlan` 只是声明，**无拒绝通道**）。受限交换**必须**同时给 `losses` 与拒绝面；未决义务在迁移/退出中不可省。
  日志只记 `bindingId`/`platformState` 原值/计数，不含秘密。
- 幂等：`describe`/`mapState` 纯读；`exportBundle` 按 `(scopeDigest, cursor)` 幂等；`exitPlan` 读幂等。
  退出后旧平台**只读不删**（`archive.mode='read-only'`、`deleted:false`）——本件只声明，不执行。
- 测试与证据：test/assembly/platform-binding.test.ts（目标新件，§6.7）：20 字段齐且缺项即不完整、无损失
  `losses:[]` 显式、已映射态 `verified`；**未映射合法值 ⇒ `Ok(unverified)` + `workStates:[]`，`Ok` 本身不写记录**
  （**不是** `Err`）、空/畸形 ⇒ `Err(rejected_precondition)`、`STAT-E` 映射 ⇒ 缺陷、范围外导出 ⇒ `rejected_forbidden`、
  `includesOpenObligations=false` 不得称完整、`describe`/`exitPlan` 幂等、**消费侧断言**：`unverified` 不被
  迁移/验收/结清采用，且 `REC-OBS-02` 由消费方写一条（同一单/原值/拍不重复）。不证明真平台状态族、
  不证明 78 的 catalog/部署面。
- 规模：≤ 220 行。**未证**：`packages/contract/src/ports/binding.ts` 未建（W-12 已关闭，落点已定）、
  78 的 20 字段表无实现；本件未落盘。
- 迁移步：**M-s**（前置：contract 的绑定端口类型可引、78-§1.2 字段表与 `REC-LOSS-01` 字段表可引；门禁同 M-n）。
```

```text
F-daemon-notify
- 路径/处置：src/assembly/notify/notify.ts；91 行；现有；目标-保留。
- 归属：80-§9.1（三个面的事实位置）、§6.6 `TS-PORT-NOTI-01 Notifier`（本件是装配件，不是端口本体）。
- 职责：把广播面装配成「拍边界事件中继 + cost 警戒出口」，并把 PATROL 计量行落台账。
  非职责：不做通知决策（路由表冻结在引擎侧）、不改事件内容、不重试业务。
- 内部：WireNotifyOptions{face, company, heartbeatIssue, actor, deptFallback, ledger, clock, people, log}；
  WiredNotify{relayEvents(events), costNoticeOutlet(notice)}；wireNotifyAssembly(opts)。
- 导出与依赖：两类型 + 一函数；依赖 contract 类型与 engine 的 NotifyBroadcastFace/路由。
- IO 与注入：ledger.appendEvent（唯一写口）；clock/people/log 注入；零 fs/网络（面由注入提供）。
- 状态与并发：无状态；中继按批；计量行 PATROL 只在有发送时落（零发送零噪音）。
- 形状（逐字对齐 80-§6.6，不得自造字段）：
  · `Notification` **保持 contract 现形** `{ kind; title; body; from?; links? }`（`contract/src/ports/notifier.ts:6`–`:13`）；
    `from` 是展示性字符串（「宰相」「daemon」），**不是**授权主体，不得改成对象——需要「投递身份+目标」时
    用新信封，不改 `Notification`。
  · 信封 `NotificationEnvelope` 的字段名是 **`notificationId`**（80-§6.6 现场，`notificationId` 非 qid；
    可选 `dedupKey` 缺省按 `notificationId` 去重）；本卷不写 `id`（主 agent 口述为 `id` 与 80 现场冲突，
    按 80 判，见 §8.1 W-15）。
  · 广播返回 `NotifySendReport = { sent: readonly string[]; failed: readonly NotifySendFailure[] }`、
    `NotifySendFailure = { target: string; reason: string }`，与 `engine/notify/broadcast.ts:27`–`:35` **逐字段一致**；
    本件只消费该返回，不重定义。
- 两个接口**分开写、分开注入，不得混用**（80-§6.6 表）：
  · `Notifier.send(channel, message: Notification): Promise<Result<NotifySendReceipt, ClassifiedError>>`（单条投递，
    `NotifySendReceipt = { status:'sent'|'failed'|'skipped'; attempts: number; detail?: string }`）；
  · `NotifyBroadcastFace.send(message: BroadcastMessage, targets: NotifyBroadcastTargets): Promise<NotifySendReport>`
    （注入面，`RunServeOpts.notifyBroadcast`——或由 `matrixSessionFactory` 的返回对象提供；两者同一形状，
    工厂路径优先并在启动日志记一条「工厂路径」）。
  本文件装配的是**广播面**（`WireNotifyOptions.face`），不得把单发语义塞进广播面或反之。
- 目标映射（80-§6.6，不得混写）：拍末报告 → Matrix 房间（`target.kind='room'`）；人事变更 → 人事频道；
  **MCP 通知只回当前 worker 会话（`mcp-session`），不经 `NotifyBroadcastFace`**。`target.kind` 三值固定，
  新增类型走提案。
- 错误与观测：中继异常不得打断拍边界（由调用方捕获）；计量失败不吞——按调用方口径上报。
  **投递失败是软失败**：`status:'failed'|'skipped'` 只是投递状态（80-§5.7 第 3 条豁免），
  **不**入业务拒绝、**不**回滚业务、**不**写成 `REC-EVT-03`；只有「通道未注册 / 消息缺稳定键」才
  `Err(rejected_precondition)`。通知成功**不得**被读成「已批准/已接收/验收通过」。
- 测试与证据：test/assembly/serve-notify.test.ts 三条（不注入零装配 / 注入中继与计量 / 零事件零计量）。
  **不证明**：`Notifier` 端口本体（`mcp-session` 单发路径）与 `NotifySendReport` 的逐字段一致性（面未实现）。
- 规模：≤ 200 行。
```

```text
F-daemon-channels
- 路径/处置：src/assembly/channels/channels.ts；93 行；现有；目标-保留。
- 归属：80-§3.4（matrixRoomFace 开而未注入 ⇒ CONFIG_INVALID）；130-P3 §6.7.3。
- 职责：Matrix 频道配置交叉校验、频道供给面装配、启动期八类地图 ensure、热重载后重保。
  非职责：不持网络面（面由注入工厂产）、不阻主循环（供给是沟通面非执行前置）。
- 内部：crossValidateMatrixChannels(cfg)；wireRoomFace(factory, snapshot); startChannelSupply(face, log)
  （fire-and-forget）；reEnsureChannels(face, log)。
- 导出与依赖：四函数；依赖 contract 的 MatrixRoomFaceContext 与 engine 的 MatrixRoomFace 类型。
- IO 与注入：零 fs；log 注入；网络在 face 实现内（daemon 不 import matrix 包）。
- 状态与并发：并行 ensure 可重入；失败逐条落日志（problems=配置软失败，failures=网络/权限）。
- 错误与观测：开而未注入 ⇒ 裸 Error（`CONFIG_INVALID：` 前缀，:42-50）；ensure 整体 reject 只记日志。
- 测试与证据：test/assembly/serve-channels.test.ts 九条（缺省/缺键 fail-fast/工厂注入/零调用回归锚）。
- 规模：≤ 200 行。
```

```text
F-daemon-sources-jobs
- 路径/处置：src/assembly/sources/jobs.ts；95 行；现有；目标-保留。
- 归属：80-§7.1（相位 1 采集）、§6.8 `SourceRegistry`（保留端口）、§6.8 `InvokeSource`（源只产意图）。
- 职责：按四开关把 cadence/sla/freshness/costGuard 四类源注册进 `SourceRegistry`，各自带 manifest。
  非职责：不启动源（startAll 在 runServe）、不做源内决策、不写台账（源自身写）。
- 内部：JobSourceRegistration{sources, flags{cadence,sla,freshness,costGuard,company,jobPollMs}, ledger,
  clock, heartbeatIssue, deptFallback, jobs(), people(), guard(), declared?, log}；registerJobSources(d)。
- 导出与依赖：一类型 + 一函数；依赖 engine/jobs/* 的四个 create*Source 与其 manifest。
- IO 与注入：clock/log/快照 getter 全注入；零 fs/网络。
- 状态与并发：注册期同步；源生命周期归 registry。
- 错误与观测：单源启动异常由 registry 隔离计数（80-§3.6 第 8 步）；本件不捕获。
- 测试与证据：test/engine/sources.test.ts（768 行基线，engine 面）；serve 侧由 serve-* 间接覆盖。
- 规模：≤ 200 行。
```

```text
F-daemon-jobs-seed
- 路径/处置：src/assembly/jobs-seed/jobs-seed.ts；82 行；现有；目标-保留。
- 归属：80-§7.9（新语义落位总表的 jobs 面）、18-§三（调度表 + 启动补跑）。
- 职责：把公司快照 `jobs` 播种进台账 jobs 表（新岗取 cron 下一槽）、移除快照中已消失的岗。
  非职责：不派工（只挪槽与增删行）、不覆盖跑史（last_run_at 不在 upsert 列）。
- 内部：SeedJobsResult{seeded, kept}；seedJobs(ledger, jobs, now)；removeMissingJobs(ledger, snapshot): number；
  常量 SEED_QUARANTINE_MS = 60*60_000（坏 cron 隔离窗）。
- 导出与依赖：两函数 + 一类型；依赖 contract（ScheduledJob/CompanySnapshot）与 store（Ledger）。
- IO 与注入：now 入参（不读时钟）；写台账（seed/remove）；零 fs/网络。
- 状态与并发：upsert 幂等；既有行 next_run_at 原样保留（欠账首拍补跑）。
- 错误与观测：坏 cron 不抛——落 now+隔离窗；移除计数由调用方入日志/事件。
- 测试与证据：serve 装配间接；engine/jobs-lifecycle、scheduler 测试覆盖台账语义。
- 规模：≤ 150 行。
```

```text
F-daemon-render-tick
- 路径/处置：src/assembly/render/tick.ts；36 行；现有；目标-保留（纯）。
- 归属：80-§7.8（拍边界步骤）、81-§3.1（纯面）。
- 职责：把 TickReport 渲染成日志行（拍摘要 + NOOP 决策明细）。非职责：不做判定、不写台账。
- 内部：renderTick(report): string；renderNoopDecision(seq, entry): string；noopLinesOf(report): string[]。
- 导出与依赖：三函数；依赖 engine 的 TickReport/TickDecisionEntry 类型。
- IO：零（纯函数，幂等）。
- 错误：无；未知枚举按既有穷尽分支。
- 测试与证据：test/engine/noop-observability.test.ts（经 serve re-export）。
- 规模：≤ 100 行。
```

```text
F-daemon-demo-snapshot
- 路径/处置：src/assembly/demo/demo-snapshot.ts；47 行；现有；**仅演示**。
- 归属：81-§3.1（fake 只归测试/演示，不得因在 src 就进生产装配）。
- 职责：demo 模式的公司快照常量（`DEMO_SNAPSHOT: CompanySnapshot`）。非职责：不冒充真实公司快照。
- 事实：`runServe` 在 `companyDir` 缺省时以它作初始快照（demo 模式），因此它**实际进入生产装配路径**，
  但只在 demo 档。日志必须能区分 demo 档（现状经 realGateMode 判定，未见显式「demo 模式」横幅——未证）。
- 导出与依赖：一常量；依赖 contract 类型。
- IO：零。
- 测试与证据：test/e2e 与 industry-templates.e2e 使用；不证明真公司面。
- 规模：≤ 100 行；不得长出新 fixture（fixture 归 test/）。
```

```text
F-daemon-spec-assemble
- 路径/处置：src/assembly/spec/assemble.ts；**目标-新增**（80-§6.9 `SPEC-01/02/03` 的 IO 侧）。
- 归属：80-§6.9（读文件在 assembly、纯决策在 core）、§6.10（每个端口实现须指到真实文件 + 一条探针）、
  §6.0（目录存在不改变「未实现」判定）；81-§3.3。
- 职责：为公司目录与包内 `spec/` 提供**读盘与包扫描**，把「文件原文 + 来源路径 + 包清单」交给
  `core/src/spec/` 的注册/装载/导入纯逻辑，产出一份装配报告（每条的来源、版本、被接受/被跳过）。
  非职责：不实现导入六步、不定义 `SpecRegistry`/`DefinitionLoader`/`PackageImporter`（在
  `contract/src/ports/spec.ts`）、不做公司目录形状/语义校验（归 `company`）、不执行 spec 规则
  （`RuleEvaluator` 在 `core/src/rule/`）、不写 `REC-*`。
- 内部（目标签名；字段名以 80-§6.9 为界，其余本卷拟）：
  `assembleSpecs(deps: { companyDir: string; files: readonly string[]; importer: PackageImporter;
  loader: DefinitionLoader; registry: SpecRegistry; log: DaemonLog }): Promise<Result<SpecAssemblyReport, ClassifiedError>>`
  `SpecAssemblyReport = { accepted: number; skipped: readonly { path: string; reason: string }[] }`（本卷拟）。
- 导出与依赖：`assembleSpecs`；依赖 contract（三个端口类型）、core（`core/src/spec/`）、company（只读快照类型）；
  **不 import api/engine/gateway**。
- IO 与注入：fs＝`readFile`（只读）、path；**零网络、零 env、零时钟**；包扫描顺序按清单序（稳定，不按目录序）。
- 事务/取消/恢复：不写台账（无事务）；取消＝在文件间检查 abort，已读结果整体丢弃、不留半注册表；
  重跑幂等（同一输入产出同一报告）。
- 错误与观测：缺文件/不可读/路径穿越（`..`、绝对路径、符号链接逃逸）⇒
  `rejected_precondition`+`CONFIG_INVALID`（`spec-file-missing`/`spec-path-escape`）；未知包格式/未知 spec 版本 ⇒
  `unsupported`；spec 版本超出支持范围 ⇒ `rejected_version`+`EVOLVE_REJECT`。**形状/语义错误不在此件判**
  （交 `company` 的校验结果，本件只透传其结论）。日志只记路径与计数。
- 测试与证据：test/assembly/spec-assemble.test.ts（目标新件）：路径穿越拒收、缺文件、包清单与实际不符、
  导入顺序稳定、空目录合法。不证明六步纯逻辑（归 `core` 单测）与端口已实现（80-§6.0）。
- 规模：≤ 200 行。
- 迁移步：**M-n**（前置：`contract/src/ports/spec.ts` 与 `core/src/spec/` 存在；门禁：`bun run typecheck` +
  `guard:boundaries` + 本件测试绿）。
```

```text
F-daemon-auth-assemble
- 路径/处置：src/assembly/auth/assemble.ts；**目标-新增**（80-§6.9 `AUTH-01…07` 的装配侧）。
- 归属：80-§6.9（`core/src/authority/` 纯判定 + `store/src/lease/` 持久面 + 本件装配）、§3.6（启动期授权准备）、
  §6.10；77-§3.1–§3.3（`REC-AUTH-01/02/03` 语义）；81-§3.3。
- 职责：把 `AuthorityRequirement` 的需求集合与台账里的 `AuthorityActivation`/`REC-AUTH-01/02` 组装成
  只读 `AuthoritySnapshot`（含 `CandidateEndpoint[]`），供 `EffectGateway` 解析权源、注入 fence。
  非职责：不判「有权」（判定在 `core/src/authority/`）、不写 `REC-AUTH-*`（写者归授予/撤回命令面）、
  **不把「端口活着」当激活**、不持 `wkey`、不做平台调用。
- 内部（目标签名；本卷拟，字段名以 80 端口为准）：
  `assembleAuthority(deps: { ledger: ReadOnlyLedger; requirements: readonly AuthorityRequirement[];
  company: CompanySnapshot; clock?: BuildRuntimeOpts['clock']; log: DaemonLog }):
  Promise<Result<AuthoritySnapshot, ClassifiedError>>`。
  输入只用**只读**台账视图（`openLedgerReadonly` 由调用方打开；本件拿不到可写 `Ledger`）。
- 导出与依赖：`assembleAuthority` + `AuthoritySnapshot` 类型；依赖 contract（`AuthorityRequirement` 等）、
  core（判定函数）、store（只读视图类型）。**不 import gateway**（`gateway` 不承载授权判定）。
- IO 与注入：只读台账（同步 `Result` 轴，见 80-§8.2）；**零网络、零 fs、零 env**；时钟只用于快照时间戳。
- 状态/并发/恢复：快照一次构造、运行期只读；授权撤回只发通知 + 重建快照（**不就地改**元素）；
  台账不可读时整次装配失败，**不**产出「空授权 = 全允许」或「空授权 = 全拒」的隐式语义。
- 错误与观测：无激活记录/授予链断点 ⇒ `rejected_authority`（`activation-missing`/`grant-chain-broken`）；
  schema 不符 ⇒ `rejected_version`+`EVOLVE_REJECT`；未知端口版本/未知需求形态 ⇒ `unsupported`。
  日志只记端点 id 与计数，不记凭据。
- 测试与证据：test/assembly/auth-assemble.test.ts（目标新件）：无激活 ⇒ 该端点不可写；端口活着但无激活
  **不产生候选**；授予链断点；撤回后快照不含该端点；只读台账路径下不发写语句。
- 规模：≤ 220 行。
- 迁移步：**M-o**（前置：`contract/src/ports/authority.ts` 与 `core/src/authority/`、`store/src/lease/` 存在；
  门禁同 M-n）。
- 与 `F-daemon-auth-credentials` 的分工：本件**不实现** `AUTH-06` 凭据目录，也不把目录当授权快照的替代；
  需要"该引用是否仍有效"时只调目录端口，不自行缓存秘密或推断有效期。
```

```text
F-daemon-auth-credentials
- 路径/处置：src/assembly/auth/credentials.ts；**目标-新增**（80-§6.9 `TS-PORT-AUTH-06 CredentialCatalogPort`
  的**编排实现件**：端口实现在本件，`REC-AUTH-04` 的持久原语在 03-store 的 `records/credentials.ts`，
  见 80-§6.9/§6.2、D28）。
- 归属：80-§6.9（`AUTH-06` 签名/前置/后置/错误/幂等/事务逐条）、§11.2.1（目录**不得**成为凭据值的第二存放处）；
  76 `REC-AUTH-04 RecCredentialRef`（只存引用，不存值）；78-§7.4.1（`secretId` 命名与 `allowedUses`）；
  77-§3.4；81-§1.6、§3.3。
- 职责：维护**凭据逻辑目录**——`register`/`resolve`/`revoke` 三个动作，证据落 `REC-AUTH-04`。目录只持有引用侧：
  提供方、绑定、范围、到期、版本、吊销状态；**不含任何凭据值**（token/密码/私钥/wkey 原文一律不入）。
  非职责：**不代替** `assembly/auth/assemble.ts`（那是授权快照装配，本件不是它的内部实现）、不判「有权」
  （`AUTH-05`/`core/src/authority/`）、不解析 provider（`runtime/secrets.ts`）、不写 `REC-AUTH-01/02/03`、
  **不当第二秘密源**（stdio 与 `core/auth` 都不得从此处取值）、不做 HTTP/平台调用。
- 内部（目标签名，逐字取 80-§6.9 `TS-PORT-AUTH-06`，不改形）：
  `register(ref: CredentialRefDraft): Promise<Result<Qid, ClassifiedError>>`；
  `resolve(id: Qid): Promise<Result<CredentialRef | undefined, ClassifiedError>>`（`undefined`=**未登记**，不是拒绝）；
  `revoke(id: Qid, proof: RevocationProof): Promise<Result<void, ClassifiedError>>`。
  `CredentialRef` **只含引用侧**（提供方/绑定/范围/到期/吊销状态）；`CredentialRefDraft` 必须带来源声明
  （值由部署面 env/密钥库供给，本件只记"来源属哪类 provider"的引用，不记值本身）。
  实现形态：`createCredentialCatalog(deps): CredentialCatalogPort`；**持久适配归 03-store 的
  `store/src/records/credentials.ts`**（`REC-AUTH-04` 的登记/解析/吊销写读原语与引用摘要幂等，`F-store-records-credentials`）。
  本件**只编排**：校验 draft（形状/来源声明/值扫描）→ 调 store 原语 → 返回 `Qid`/引用；**不直写表、不拼 SQL、
  不新建第二存储**，也**不**在 daemon 内落自己的持久层。03-store 已定 `F-store-records-credentials`
  （`store/src/records/credentials.ts`：复用通用 `records` 表、不建第二张秘密表、不新增投影名、不扩 MIG-01 波次；
  80-§6.2/§6.9、D28），**该文件未建**。
- 前置/后置（80-§6.9 原样）：登记时必须已有来源声明；`resolve` 返回引用与状态；吊销后解析为不可用；
  目录**不得**成为凭据值的第二存放处。取值一律走 `SecretProvider`（§11.2.1），本件只回答"该引用是否有效"。
- 错误：未知引用 ⇒ `unsupported`；**检测到值入目录**（任意字段出现疑似凭据原值）⇒ `rejected_forbidden`；
  过期/已吊销 ⇒ `rejected_authority`；形状/来源声明缺失 ⇒ `rejected_precondition`+`CONFIG_INVALID`；
  版本不符 ⇒ `rejected_version`。**不得**用 `STATE_CONFLICT`（不是 `ErrorCategory` 成员）。
- 幂等/事务：登记按**引用摘要**幂等（同摘要再登记 ⇒ 返回同一 `Qid`，不追加第二条）；吊销幂等
  （同 `(id, reason, effectiveAt)` 重复 ⇒ `Ok(void)`）；`register`/`revoke` 各自**单事务**，证据＝引用 + 吊销证明
  （`REC-AUTH-04`）；`resolve` 只读、可与其他读并发。日志只记 `Qid`/`secretId`，**永不打印值**。
- 测试与证据：test/assembly/auth-credentials.test.ts（目标新件）：登记→解析→吊销→解析不可用；同摘要再登记
  只产一条记录；吊销幂等；**值入目录即 `rejected_forbidden`**（正反各一）；未知引用 `unsupported`（不是 `undefined`）；
  过期引用 `rejected_authority`；目录查询结果**不含**任何秘密原值。不证明真实授权生效（`RUN-AUTH-*` 另证）。
- 规模：≤ 180 行。迁移步：**M-r**（前置：76 `REC-AUTH-04` 字段表、`ports/authority.ts` 的 `AUTH-06` 类型、
  03-store 的 **`store/src/records/credentials.ts`** 持久原语可引；门禁同 M-n）。
```

```text
F-daemon-migrate-assemble
- 路径/处置：src/assembly/migrate/assemble.ts；**目标-新增**（80-§6.9 `MIG-01` 的维护窗口编排）。
- 归属：80-§6.9（维护写面走 `openLedgerMaintenance`）、§6.8 `TS-PORT-MIG-01`（可审/可干跑/可停）、
  §8.2（只读打开不跑 DDL）；76-§8.3（`REC-MIG-01`）、76-§8.4（`REC-LOSS-01`）；81-§3.3。
- 职责：编排一次维护窗口——取单实例锁（`store/src/lease/`）→ 判定离线（无活跃 worker、无在途单）→
  `openLedgerMaintenance` 打开维护写面 → 调 `MigrationService.plan`/`apply` → 收取 `proofRef`（`REC-MIG-01`）→
  释放锁并回到停机/只读。**不在 serve 主循环里执行**。
  非职责：不写 SQL、不定义 `MigrationPlan`/`MigrationService`（contract）、不实现 schema 迁移
  （`store/src/migrations/`）、不自动迁移（只读打开绝不跑 DDL）、不复活终态记录。
- 内部（目标签名；本卷拟）：`runMigrationWindow(deps: { ledgerPath: string; expectedSchemaVersion: number;
  service: MigrationService; plan?: MigrationPlan; dryRun: boolean; clock: BuildRuntimeOpts['clock'];
  log: DaemonLog }): Promise<Result<MigrationWindowResult, ClassifiedError>>`。
- 导出与依赖：`runMigrationWindow`；依赖 contract（`MigrationService`/`MigrationPlan`）、store（`openLedgerMaintenance`
  与租约）、fs（快照/报告文件）。**不 import api/engine/gateway**。
- IO 与注入：台账维护写面、fs（快照与报告）、时钟；**零网络、零 env**。
- 事务/取消/恢复：单实例锁（第二实例 ⇒ 失败，不排队）；每步一个事务；**不可逆步执行前必须有快照**；
  取消 ⇒ 停在下个步边界、写 `REC-MIG-01` 记录已完成的步；崩溃 ⇒ 锁按 TTL 回收，重启从 `MigrationService`
  的版本判定续做（不做隐式回滚）。
- 错误与观测：不可逆且无快照 ⇒ `rejected_forbidden`；`dryRun` 缺失而要求真跑 ⇒ `rejected_precondition`
  （`dry-run-missing`）；锁被占 ⇒ `conflict`+**`EXTERNAL_REJECT`**（非合并域冲突一律 `EXTERNAL_REJECT`；
  `STATE_CONFLICT` 不是 `ErrorCategory` 成员，**全文不得出现**）；版本不符 ⇒ `rejected_version`+`EVOLVE_REJECT`。
  日志逐步记 `planDigest` 与步号，不记行内容。
- 投影面（跨卷登记）：MIG-01 建表时一并落**目标第 18 个投影名** `resourceLedger` ↔ 物理表 `resource_ledger`
  （80-§6.3/§6.4 RES-01；表与同事务 hook 归 03-store，本卷只登记消费/版本门槛，**不在此建表**）；
  现状 17 个投影名不动，`daemon_kv`/`schema_version`/`hr_sync_log` **不是**投影名。
  表投影结果的 `name` 类型是 **`TargetTableProjectionName`**（`TableProjectionName | 'resourceLedger'`）——
  建表前**类型可携带**该名，**运行期**仍不得返回（§8.1 W-22，已关闭）。
- 测试与证据：test/assembly/migrate-assemble.test.ts（目标新件）：双进程抢锁只有一胜、`dryRun` 不改库、
  不可逆无快照拒、崩溃后重启可续、`proofRef` 落 `REC-MIG-01`。
- 规模：≤ 180 行。
- 迁移步：**M-p**（前置：`contract/src/ports/migration.ts`、`store/src/migrations/`、`openLedgerMaintenance`
  可用；门禁同 M-n）。
```

```text
F-daemon-stdio-broker
- 路径/处置：src/assembly/stdio/broker.ts；**目标-新增**（本地 socket 工具面）。80-§11.4.1 **未指定文件路径**，
  本卷定落点 `assembly/stdio/`（§8.1 W-13 收窄为「已定落点，待 80-§6.9/§12.3 登记」）；**不改 80 协议**。
- 归属：80-§11.4.1（协议与规则的**唯一主文**；本件只落文件契约）、§11.4（三者不可互替）、§11.2.1（catalog
  秘密不进帧）、§5.2（`EffectOutcome` 二态）；15/06 的 stdio 章为同步主文；81-§1.6、§3.3。
- 职责：本地 socket 服务端，跑 `register → registerChallenge → registerProof → registerAck` 三帧状态机
  （`expectRegister → expectProof → registered`）与 `call`/`verdict` 两类往返；验签、吊销、审计、平台写
  **全部在 daemon 侧**；`call` 由 daemon **代为执行**，wkey 不回传、不进 `verdict`。
  **按真实效果分流**：`comment`/`article` 先翻译成 `comments.add`/`kb.upsert`，按双层 scope 现签一次性
  调用 key 后过 `EffectGateway`；`heartbeat` 验签后经 `RecordWriter` 追加 `REC-EVT-01` 活性观察，
  不是平台写；`evidence-write` 只经本单工作区材料目录的 containment 写口，收割由 EVD-01 只读进行；
  `kb-search` 走带知悉范围与 `limit`/`order` 的 `RecordReader.query`，`budget-query` 走只读投影。
  后四种不得借 `EffectGateway` 冒充平台写，也不得把署名或 `allow` 当成活性/查询/写入已成功。
  非职责：**不定义协议**（帧型与规则以 80-§11.4.1 为准，本卷不另造第二套）、**不复制 `@action` 解析**
  （只调 `packages/gateway` 的 `encodeAction`/`decodeAction`）、不新建第二个 `WkeyAuthority`
  （进程内**一个**，与 engine 签发、关单吊销共用）、不下发/回传任何 `SEC-*` 值、不做业务授权判定
  （归 `core/src/authority/` 与 `EffectGateway`）、不直写台账。
- 内部（目标签名；本卷拟）：`createStdioBroker(deps: { socketPath?: string; authority: WkeyAuthority;
  effects: EffectGateway; records: RecordWriter; reader: RecordReader; projections: RecordProjection;
  evidence: { writeWithinAttempt(path: string, content: string): Promise<Result<{bytes: number}, ClassifiedError>> };
  peers?: PeerCredentialVerifier; issuance: { find(ticketId: string, nonce: string): boolean;
  revoked(ticketId: string): boolean }; log: DaemonLog; clock?: BuildRuntimeOpts['clock'] }):
  { listen(): Promise<Result<StdioBrokerHandle, ClassifiedError>> }`。
  `records` 只用于 heartbeat 活性观察；`reader`/`projections` 只读且继承会话的知悉范围；
  `evidence.writeWithinAttempt` 由 78 的工作区绑定实现 realpath + containment + 原子写，不是任意路径写。
  这些依赖均由 daemon 装配，**不由 helper 注入**；缺任一启用工具的必需后端即 `CONFIG_INVALID`，不得返回伪成功。
  socket 路径＝部署相对路径 `run/daemon.sock` 或 env `STUDIO_DAEMON_SOCK`（**不得**写死绝对路径）。
  `PeerCredentialVerifier`（80-§11.4.1 原样）：
  `{ readonly kind: 'host-bound' | 'none'; verify(handle: PeerHandle): Result<{ uid: number; gid?: number }, ClassifiedError> }`
  ——**默认 `kind:'none'`**；`PeerHandle` 由宿主/原生层给出，**Node 24 没有 `getpeereid`/`SO_PEERCRED` 内建 API**，
  本件**不得**写成 Node 直接调它们。
- 协议要点（逐条执行，细则见 80-§11.4.1，不在此复述全文）：`register` 恰三键 `helperId`/`pid`/`wkeyRef`
  （`wkeyRef` 是逻辑引用 `SEC-WKEY-<ticketId>`，**只表示申请**）；`challenge = randomBytes(32)` base64url、
  **一次性、≤30s、绑定「发起它的连接 + 活跃会话」两件**；
  **`proof = base64url(HMAC-SHA256(wkey, JCS(studio-next/jcs@1) 的 UTF-8 字节))`**——对象**恰五键**
  `protocol`(='studio-next/stdio-register@1')/`challenge`/`helperId`/`pid`(JSON number)/`wkeyRef`，
  JCS 按键名字典序、无空白；`alg='hmac-sha256-v1'` 即这一整套（换规范化/换域串/换算法必须换 `alg`），
  **不得**用字符串拼接或 `JSON.stringify` 默认键序。验签用 `WkeyAuthority.verifySealed(token, check)`
  （或 `verify(token, check, {consumeNonce:false})`）——跑完整检查**但不写 `seenNonces`**，再用
  `timingSafeEqual` 常量时间比较判「持有该 wkey」，并核对 `(ticket, nonce, attempt/sessionRef)` 在活跃签发表内
  且未吊销；同一 `(ticket, nonce)` **只允许一个活跃会话**。`call` 恰三键 `reqId`/`tool`/`args`，**不含** `wkey`/秘密。
  测试向量（JCS 逐字节、`alg` 绑定、异长/改一字节必拒）归 82，**本卷不写真值**。
- 对端身份（两档，不得混写）：① **部署边界**＝socket 目录 `0700`、文件 `0600`、`umask 0077`、`lstat` 拒符号链接
  ——只回答「谁有权限连」，**不产生** uid 已核事实；② **对端核验**＝仅当 `peers.kind==='host-bound'` 且
  `verify` 返回 `uid === daemon uid` 时记 **`peer-verified`**，否则该连接一律 **`unverified`**。
  `unverified` **不降低也不放宽**核心信任三件（challenge-proof + 活跃签发 + scope），同 uid ≠ 员工身份；
  只有完成上述 host-bound + 同 uid 核验才可记 `peer-verified`；**未经核验不得**在日志/审计/上报/测试断言中写 `peer-verified` 或「peer uid 已核」（无适配时只准写 `unverified`）。
- 导出与依赖：`createStdioBroker` + `StdioBrokerHandle`；依赖 `node:net`（**全卷唯一**）、gateway
  （`WkeyAuthority`/`encodeAction`/`decodeAction`）、engine/tools（`EffectGateway`）、contract（`PeerCredentialVerifier`
  类型若归 contract 则从那里引，**不新增包边**）。`daemon` 不 import `studio-tools`。
- IO 与注入：`node:net`（本地 socket）、fs 仅 `lstat`/权限与 `unlink`；**零出站网络、零 env（除 socket 路径）**；
  `stdout` **只许**帧，诊断一律 `stderr`。
- 事务/取消/恢复：重连**必须**重注册（注册态不复用）；断连清 session / 未用 challenge / pending 请求；
  challenge 过期不续期；daemon 关闭时停监听 + `unlink` socket。注册失败或未注册 ⇒ 后续 `call` 一律 `deny`
  且**不触达平台、不落单、不写台账**。
- 错误与观测：未注册/验签失败/吊销/challenge 过期 ⇒ `rejected_authority`（`unregistered`/`proof-invalid`/`revoked`/
  `challenge-expired`，category 缺省 `EXTERNAL_REJECT`）；`tool → action` 不在 scope ⇒ `rejected_forbidden`；
  乱序帧/多余键/超长帧/重复 `register` ⇒ `rejected_state`+`subcause:'frame-order-invalid'`
  （category 缺省 `EXTERNAL_REJECT`）并**断连**（不宽容续用）；**`STATE_CONFLICT` 不是 `ErrorCategory` 成员，
  全文不得出现**；`EffectGateway` 失败 ⇒ `failure`/`category`/`subcause` 原样脱敏回 `verdict`。
  socket 路径与注册信息**不进日志**（只记 `helperId` 与结果）。
- 测试与证据：test/assembly/stdio-broker.test.ts（目标新件）：注册三帧正/反例、challenge 重用/过期/跨连接挪用、
  proof 错、未注册 `call` 拒、吊销后拒、目录 `0700`/文件 `0600`/`lstat` 拒符号链接、
  **`PeerCredentialVerifier` 缺省 `none` ⇒ 状态 `unverified`；假 verifier 返回他 uid ⇒ 仍 `unverified`；
  只有 `host-bound` 且 uid 相等才 `peer-verified`**、`stdout` 无日志、`verdict` 只含脱敏结果。
  **不证**真实 worker 端到端（U80-17）。
- 规模：≤ 300 行。**未证**：U80-17（stdio 服务、challenge-proof、`verifySealed`、共享 `WkeyAuthority`、
  `PeerCredentialVerifier` 宿主适配全未实现）。
- 迁移步：**M-q**（前置：`packages/gateway` 的 `verifySealed`/`encodeAction`/`decodeAction` 与共享 authority
  可用；门禁同 M-n + 一条 socket 权限负向探针）。
```

### 4.3 `src/control/**`（6 条 = 现有 2 + 目标新增 4）

〔域前言〕层位 **control(3)**；允许 import `engine/tools`；不得 import `cli`；同层 control↔evolve/engine 依 §1.3 纪律**不互引**（机械门禁缺，W-5）。直下平面基线 2（`hot-reload.ts` + `stop-channel.ts`），新件全进 `control/hot-reload/` 子目录。

```text
F-daemon-hot-reload
- 路径/处置：src/control/hot-reload.ts；624 行（lineBaseline 624）；目标-拆分（80-§10.5），本文件留 facade。
- 归属：80-§6.8 保留端口 `HotReload`、§10.5（拆指纹/通道/执行/事件）；docs/38-§2 L1。
- 职责：L1 配置热重载的对外句柄——拍边界调 `check()`：stat 指纹比对 → 读目录 → 校验 → 应用 →
  事件落账/手动回执。非职责：不做公司目录校验规则（归 company）、不写公司目录（只读）、不决定主循环节奏。
- 内部（现状全集）：
  · 指纹面：WATCH_EXCLUDED_NAMES(= company SCAN_EXCLUDED_NAMES + TRUST_DIR)、AssetStat、StatIndex、
    DirectoryFingerprint、StatDiff、statDirectory、diffStatIndex、statDiffEmpty、fingerprintDirectory、renderStatDiff
  · 控制通道：CONTROL_DIR='control'、RELOAD_REQUEST_FILE='reload.request.json'、RELOAD_RESULT_FILE、
    ReloadRequest、ReloadResult、controlDirOf、writeReloadRequest、readReloadRequest、writeReloadResult、
    awaitReloadResult(rootDir,id,timeoutMs,pollMs=100)、answerReloadNoCompanyDir
  · 执行面：HotReloadApplyReport{jobsSeeded,jobsKept,jobsRemoved,hr?}、HotReloadDeps（companyDir/rootDir/
    ledger/company/clock/makeId/log/apply/deptFallback/watch/minStableMs?/readFiles?/scanStats?）、
    HotReloadReport{kind 六态, changes, fingerprint?, event, detail?}、HotReload{check(), stats}
  · 入口：createHotReload(deps)（构造期建指纹基线，失败抛错）
- 导出与依赖：上述全部；依赖 company（SCAN_EXCLUDED_NAMES/TRUST_DIR/loadCompanyDirectory/readDirectoryFiles/
  readTrustAnchor/revokeTrust）、contract（CompanySnapshot/DirectoryIssue/EventRecord）、store（Ledger）。
- IO 与注入：fs=readFileSync/readdirSync/statSync/renameSync/writeFileSync；crypto=createHash('sha256')；
  时钟注入 `clock`；`readFiles`/`scanStats` 可替身（测试）；`minStableMs` 缺省 500（半写防护）。
- 状态与并发：stats{checks,reloads,invalids,manualRequests,lastFingerprint}；手动请求按 id 幂等
  （同 id 不重放）；`check()` **恒不抛**（内部全捕获，如实落账/回执）——serve 拍边界直调。
- 错误与观测：kind 六态=`reloaded|invalid|apply-failed|unchanged|company-mismatch|trust-drift`；
  事件=reloaded→`SCHEMA_EVOLVE`（note 前缀 `RELOAD;`）、invalid/apply-failed/trust-drift→`ESCALATE`
  （note `RELOAD_CONFIG_INVALID`/`RELOAD_APPLY_FAILED`/`RELOAD_TRUST_DRIFT`）；issue 哨兵 `'-'`；tokens 零桶；
  构造期失败=裸 Error（`CONFIG_INVALID：` 前缀，:385）。
- 目标拆分（80-§10.5）：`hot-reload/fingerprint.ts`（stat/指纹/diff）、`hot-reload/channel.ts`（控制面请求/回执）、
  `hot-reload/execute.ts`（重装载与 apply）、`hot-reload/event.ts`（RELOAD/SCHEMA_EVOLVE/ESCALATE 落账）；
  本文件保留 `HotReload`/`HotReloadReport`/`createHotReload` facade 与全部 re-export（导入路径零变）。
  目标行数：facade ≤ 150；四件各 ≤ 350。
- 测试与证据：test/control/hot-reload.test.ts（930 行基线，六组：指纹/自动重载/增员增岗/坏配置/手动通道/
  serve 接线）；serve 侧由 buildServeRuntime 注入。
- 未证：自动指纹在真网络文件系统（mtime 精度）下的抖动行为未见证据。
```

```text
F-daemon-hot-reload-fingerprint
- 路径/处置：src/control/hot-reload/fingerprint.ts；**目标-新增**（拆分产物）。
- 归属：80-§10.5「指纹」件。
- 职责：stat 扫描、三桶 diff（增/删/改）、内容指纹（sha256 形）、diff 渲染。非职责：不读公司语义、
  不判校验、不落事件。
- 内部：从 F-daemon-hot-reload 迁入 WATCH_EXCLUDED_NAMES、AssetStat/StatIndex/DirectoryFingerprint/StatDiff
  与五个纯函数（statDirectory 除外——它读 fs，仍属本件）。
- 导出与依赖：上述符号；fs/path/crypto + company 的排除表基表（只读常量）。
- IO 与注入：statDirectory 触 fs（廉价 stat，不读内容）；fingerprintDirectory 纯。
- 状态/并发：纯函数；无共享可变状态。
- 错误与观测：fs 异常按调用方口径（statDirectory 现状不吞）。
- 测试与证据：hot-reload.test.ts「指纹面：stat 扫描 / 三桶 diff / 内容指纹」三条。
- 规模：≤ 350 行。
```

```text
F-daemon-hot-reload-channel
- 路径/处置：src/control/hot-reload/channel.ts；**目标-新增**（拆分产物）。
- 归属：80-§10.5「通道」件；80-§3.6 控制面文件通道。
- 职责：`<rootDir>/control/` 下的 reload 请求/回执协议（写、读、等、无人挂目录时的固定回执）。
  非职责：不执行重装载（execute.ts）、不决定是否应用。
- 内部：CONTROL_DIR、RELOAD_REQUEST_FILE、RELOAD_RESULT_FILE、ReloadRequest、ReloadResult、controlDirOf、
  writeReloadRequest（tmp+rename 原子写）、readReloadRequest、writeReloadResult、awaitReloadResult、
  answerReloadNoCompanyDir。
- 导出与依赖：上述符号；fs/path。
- IO 与注入：fs 读写（mode 0700 目录）；轮询用裸 `Date.now()`（无 clock 注入——W-4）。
- 状态与并发：按 id 匹配；坏 JSON 当不存在（不炸不误停）；超时返回 undefined。
- 错误与观测：幂等（同 id 不重放）；回执 reason 取值：`applied|unchanged|company-mismatch|no-company-dir|
  invalid|apply-failed|trust-drift`。
- 测试与证据：hot-reload.test.ts「手动 reload：控制面文件通道 / 幂等 / company 比对」五条 + 「serve 接线」四条。
- 规模：≤ 250 行。
```

```text
F-daemon-hot-reload-execute
- 路径/处置：src/control/hot-reload/execute.ts；**目标-新增**（拆分产物）。
- 归属：80-§10.5「执行」件。
- 职责：一次 check 的编排——稳定窗判定、stat diff → 读目录 → 校验 → `deps.apply(snapshot)` →
  产出 HotReloadReport 与统计。非职责：不落事件（event.ts）、不做校验规则（company）、不写公司目录。
- 内部：HotReloadDeps（上列 13 键）、HotReloadApplyReport、HotReload/HotReloadReport 的产出逻辑；
  createHotReload 的编排体（facade 仍由此件实现，hot-reload.ts 再导出）。
- 导出与依赖：createHotReload 与相关类型；依赖 fingerprint/channel/event 三件 + company/store。
- IO 与注入：readFiles/scanStats/clock/log 全注入（测试替身）；minStableMs 半写防护。
- 状态与并发：stats 计数在本件；`check()` 串行（serve 单拍调用）；应用失败不半装（保持旧快照）。
- 错误与观测：apply 抛错 ⇒ kind='apply-failed' + ESCALATE；校验不过 ⇒ kind='invalid' + ESCALATE；
  信任漂移 ⇒ kind='trust-drift' + 撤销受信位 + ESCALATE；三者均保持旧配置继续跑。
- 测试与证据：hot-reload.test.ts 六组中四组（自动/增员增岗/坏配置/手动）。
- 规模：≤ 400 行。
```

```text
F-daemon-hot-reload-event
- 路径/处置：src/control/hot-reload/event.ts；**目标-新增**（拆分产物）。
- 归属：80-§10.5「事件」件；77 的 `REC-*` 事件信封（本件只构造，不改语义）。
- 职责：重载相关事件构造与落账口径（`SCHEMA_EVOLVE` / `ESCALATE` 三类 note 前缀、issue 哨兵、tokens 零桶）。
  非职责：不判定 kind、不写公司目录。
- 内部：makeEvent 族（迁移现状内联构造）+ note 常量（`RELOAD;`/`RELOAD_CONFIG_INVALID`/
  `RELOAD_APPLY_FAILED`/`RELOAD_TRUST_DRIFT`）。
- 导出与依赖：事件构造器与常量；依赖 contract（EventRecord/validateEventRecord）与 store（appendEvent）。
- IO：写台账（唯一写口）；makeId/clock 注入。
- 错误与观测：事件 id 由 `makeId` 生成；company 路由键取自 deps.company；dept 兜底 deps.deptFallback。
- 测试与证据：hot-reload.test.ts 断言事件 name/note/issue/tokens 形状。
- 规模：≤ 200 行。
```

```text
F-daemon-stop-channel
- 路径/处置：src/control/stop-channel.ts；135 行；现有；目标-保留。
- 归属：80-§3.6 第 10 步（停机回执）；DEV-9/DEV-41（孤儿进程与重启失忆两事故的机制修）。
- 职责：daemon 与 CLI 之间的停机文件协议——请求/回执原子落盘、请求消费（rename .consume）、
  去重位（`daemon_kv` `stop.lastSeenId`）。非职责：不执行停机动作（serve 循环看 stopped 标志）、不杀进程。
- 内部：STOP_REQUEST_FILE='stop.request.json'、STOP_RESULT_FILE='stop.result.json'、
  STOP_REQUEST_CONSUMED_FILE=`${STOP_REQUEST_FILE}.consume`、STOP_LAST_SEEN_KV_KEY='stop.lastSeenId'；
  StopRequest{id, requestedAt, reason?}、StopResult；writeStopRequest、readStopRequest、writeStopResult、
  consumeStopRequest(rootDir): boolean、awaitStopResult(rootDir,id,timeoutMs,pollMs=100)。
- 导出与依赖：四常量 + 两类型 + 五函数；依赖 fs/path（无 cross-package import）。
- IO 与注入：fs=writeFileSync+renameSync（原子，目录 mode 0700）；轮询裸 `Date.now()`（W-4）。
- 状态与并发：幂等位在台账 kv（跨重启）；`consumeStopRequest` 用 POSIX rename 语义（留档恒为最近一次，有界）；
  调用序：先落 kv 去重位再 consume（改名前崩溃由 kv 兜底）。
- 错误与观测：坏 JSON ⇒ 当不存在（不当停机）；consume 失败不阻断停机（去重已在 kv）；
  回执 detail 承载优雅停收口证据。
- 测试与证据：test/control/stop-channel.test.ts（389 行，四组：协议/幂等/坏 JSON/spawn 冒烟 + DEV-41 重启失忆）。
- 规模：≤ 250 行。
```

### 4.4 `src/evolve/**`（5 条，全部目标-保留）

〔域前言〕层位 **evolve(3)**；允许 import `engine/tools`；不得 import `cli`；与 control/engine 依 §1.3 不互引（现状满足）。直下平面基线 5（顶格）——**新增进化面一律开子目录**。本域 fs/child_process 的使用与 79-§3.5 的缺口见 §1.4/W-3。状态迁移一律只走 `core.transitionCandidate` + store 乐观锁，本域不复制判定面。

```text
F-daemon-cutover
- 路径/处置：src/evolve/cutover.ts；459 行；现有；目标-保留。
- 归属：20-§九（切权环节，进化链四刀之三）；80-§6.8（判负闸 `EvolveGuard` 的调用方）。
- 职责：approved|promoted 候选受控上产——双闸（状态闸 + 判负闸写前复跑）→ 备份 `.bak-<候选id>` →
  tmp+rename 原子写 → 读回复核 → 状态迁移 promoted → `SCHEMA_EVOLVE` 落账；成功默认开灰度窗。
  非职责：不做判负判定（evolve-guard）、不做沙箱（sandbox）、不重启 daemon（v0 恒不重启，只打提示）。
- 内部：CutoverOptions{newFilePath, assetRoot, company, actor?, dept?, level?, issue?, restart?, gray?,
  clock?, idFactory?, guard?, probes?}；CutoverProbes{afterWrite?, afterMigrate?}；CutoverResult；
  runCutover(ledger, candidateId, opts)；renderCutoverLines(result, row)。
- 导出与依赖：两类型（+探针）+ 两函数；依赖 contract（configInvalid/validateEventRecord）、core
  （transitionCandidate 与 CandidateRecord）、store（CandidateRow/Ledger）、gray（默认开窗）。
- IO 与注入：fs=读新文件/写目标/备份/rename；crypto=sha256；clock/idFactory/guard 注入；probes 只测试用。
- 状态与并发：写域 containment（asset_path resolve 出根即拒）；迁移走乐观锁；失败面先回滚再报，
  不留半改态；promoted 重切权=幂等（备份重写为当下旧内容）。
- 错误与观测：失败面 `backup-failed|write-failed|verify-mismatch|transition-lost|event-append-failed`；
  事件 note 携候选+资产+旧新 hash+锚点，issue 哨兵 `'-'`，tokens 零桶；`event-append-failed` 追记
  promoted→retired 收口迁移（不留孤悬 promoted）。
- 测试与证据：test/evolve/cutover.test.ts（561 行，四组：双闸/全链/失败回滚/CLI 面）；test/evolve/gray.test.ts
  的 cutover 接线组。
- 规模：≤ 600 行；不得把重试/自动回滚加进本文件（回滚归 gray）。
```

```text
F-daemon-evolve-guard
- 路径/处置：src/evolve/evolve-guard.ts；244 行；现有；目标-保留。
- 归属：80-§6.8（判负闸）、§12.5 U80-07（验收独立性未证）；20-§九（判据类冻结面）。
- 职责：`createEvolveGuard(ledger).authorize(change)` —— 台账候选全集 ∘ core 判负核，返回授权候选或抛
  `evolve/unauthorized`；`runEvolveStartupSelfCheck(deps)` —— serve 启动对冻结资产清单做观察式自检。
  非职责：不执行写（cutover 写）、不决定候选人裁（escalate 归 core/制作人）、不阻断启动（v0 观察模式）。
- 内部：EvolveGuard{authorize}；FrozenAsset；FROZEN_FRAMEWORK_ASSETS（3 件：`AGENTS.md`、
  `packages/contract/cases.json`、`docs/20-工程总规程.md`）；UnauthorizedFinding{asset_path,diff_hash,message,
  nearMisses}；EvolveSelfCheckReport{checked,authorized,unauthorized,skipped:'empty-ledger'|null,errors,events}；
  EvolveSelfCheckDeps{ledger,clock,makeId,company,actor,dept,…}。
- 导出与依赖：上述；依赖 core（assertChangeAuthorized、ChangeRejectedError、NearMiss、ProposedChange）、
  contract、store（CANDIDATE_STATUS_VALUES/CandidateRow/Ledger）。
- IO 与注入：crypto+fs 读资产字节算 `sha256:<hex>`；clock/makeId 注入；`fileHash` 缺省实现可替身。
- 状态与并发：无状态；空库 ⇒ skipped='empty-ledger'（零检查如实）；文件缺失 ⇒ 进 errors、不阻断、不计 checked。
- 错误与观测：判负 ⇒ `ESCALATE`（note 携 nearMisses 摘要）；判负以外异常直通上抛（fail-fast，不静默吞）；
  观察模式不阻断启动。
- 测试与证据：test/evolve/evolve-guard.test.ts（413 行，三组：authorize/core 透传/启动自检 + serve 接线三态）。
- 规模：≤ 400 行。**未证**：U80-07（同主体交付+验收仍无机制拦截）。
```

```text
F-daemon-gray
- 路径/处置：src/evolve/gray.ts；550 行；现有；目标-保留。
- 归属：20-§四（灰度零事故）；切权后的守夜面。
- 职责：开窗登记（kv `gray:<候选id>`）、窗内事故计数判定、阈值触发自动回滚（备份逐字节恢复 + promoted→
  retired + `SCHEMA_EVOLVE` note=gray-rollback）、到期关窗、手动关窗、状态渲染。
  非职责：不做切权（cutover）、不定义事故（INCIDENT_EVENT_NAMES 冻结）、不驱动 tick（观察窗驱动归后续刀）。
- 内部：GRAY_KV_PREFIX='gray:'、INCIDENT_EVENT_NAMES=['ESCALATE','CIRCUIT_BREAK']、
  DEFAULT_GRAY_WINDOW_MS=24h、DEFAULT_GRAY_MAX_INCIDENTS=1、grayKvKey、GrayWindowState、GrayOpenOptions、
  openGrayWindow、readGrayWindow、countIncidents、GrayVerdict、judgeGrayWindow、GrayCheckOptions、
  GrayCheckResult、splitBackupPath、checkGrayWindow、GrayCloseOperation、closeGrayWindow、
  renderGrayStatusLines、renderGrayCheckLines。
- 导出与依赖：上述全部；依赖 contract/core/store（迁移只走 core.transitionCandidate）。
- IO 与注入：fs（备份恢复/复核）、crypto（hash）、clock/idFactory 注入；台账写=kv upsert + 事件 append。
- 状态与并发：窗状态在 kv（跨进程可读）；重切权重开窗=覆盖旧记录；回滚后再 check 幂等（{rolled:false,
  done:true}）；关窗不回滚（回滚只由阈值触发）。
- 错误与观测：`configInvalid('daemon/gray:bad-window-ms'|'daemon/gray:bad-max-incidents', …)`；
  拒面 `candidate-unknown|status-not-promoted|no-window|backup-missing`；回滚=合法判定（CLI exit 0）。
- 测试与证据：test/evolve/gray.test.ts（625 行基线，六组：纯逻辑/开窗/切权接线/检查三态/手动关窗/CLI）。
- 规模：≤ 600 行（现 550，余量 50）；再长须拆 `gray/{window,judge,rollback,render}.ts`（本附录不预先拆）。
```

```text
F-daemon-postmortem
- 路径/处置：src/evolve/postmortem.ts；590 行；现有；目标-保留。
- 归属：20-§十一（复盘 → 案例库）；不追责原则的机制化。
- 职责：断路器关联（该单 CIRCUIT_BREAK/ESCALATE 历史自动进时间线）→ 渲染七节复盘模板 → 写案例库条目 →
  落 `POSTMORTEM` 事件（note=约定相对路径、size、payload_hash）。
  非职责：不判定根因（人填）、不追责、不改断路器状态。
- 内部：ROOT_CAUSE_KINDS=['process-gap','environment','criteria-miss']；PREVENTION_OUTLETS=
  ['casebook','criteria','protocol']；PostmortemTimelineEntry、PostmortemRootCause、PostmortemPrevention、
  PostmortemInput；POSTMORTEM_BLAME_MARKERS；assertNoBlameHeading；parsePostmortemInput；
  ROOT_CAUSE_LABELS、PREVENTION_OUTLET_LABELS、POSTMORTEM_TEMPLATE_SECTIONS、renderPostmortemTemplate；
  CASEBOOK_ENTRY_SECTIONS=['现象','根因','解法','预防']、renderCasebookEntry、CASEBOOK_DIR_NAME='docs/casebook'、
  CASEBOOK_FILE_RE、casebookDate、casebookEntryFileName、casebookEntryRelPath；BREAKER_EVENT_NAMES、
  collectBreakerTimeline、mergeTimeline；PostmortemChainOptions、PostmortemChainResult、
  runPostmortemChain、renderPostmortemLines。
- 导出与依赖：上述；依赖 contract（configInvalid/EventRecord）、store（Ledger）。
- IO 与注入：fs=mkdir/writeFile 案例库条目；crypto=sha256；clock/idFactory 注入；台账读=断路器历史。
- 状态与并发：同日重跑覆盖条目文件 + 新落一条事件（append-only 不改旧账）；链内形状闸先于写盘。
- 错误与观测：追责哨兵双保险（parse 入口 + 渲染出口）⇒ `configInvalid`；坏 slug/坏 date ⇒ CONFIG_INVALID
  （不落半成品事件）；事件 tokens 显式零桶。
- 测试与证据：test/evolve/postmortem.test.ts（516 行，七组：模板/哨兵/形状闸/条目/目录约定/断路器关联/全链/CLI）。
- 规模：≤ 600 行（现 590，余量 10）；再长须拆 `postmortem/{template,casebook,chain}.ts`（本附录不预先拆）。
```

```text
F-daemon-sandbox
- 路径/处置：src/evolve/sandbox.ts；570 行；现有；目标-保留。
- 归属：20-§九（沙箱环节，进化链四刀之二）；80-§6.8（`GateRunner` 上游）。
- 职责：临时目录最小集拷贝 → 应用变更（v0 单文件整文件替换）→ 跑冻结验收命令（超时杀进程组）→
  产出报告；链级 `runCandidateSandbox` 落 `verification` 并迁移 proposed→sandboxed。
  非职责：不做切权、不判业务价值、判定红不是链错误（档案面）。
- 内部：SandboxCandidate、PatchPair、SandboxPlan、SandboxFailReason、SandboxReport、SandboxRunner、
  SandboxDeps、createSandboxRunner、SandboxVerificationSnapshot、SandboxChainOptions、SandboxChainResult、
  runCandidateSandbox(ledger, opts)、renderSandboxLines(result, row)；常量 SIBLING_TEST_FILE_RE、
  SUMMARY_HEAD/TAIL_CHARS、RAW_CAPTURE_CAP_CHARS=1_000_000、POST_KILL_GRACE_MS=2_000、超时缺省 60_000ms。
- 导出与依赖：上述；依赖 contract/core/store + node:child_process/node:os/node:fs(promises)。
- IO 与注入：**唯一 spawn 点**（进程组 SIGKILL）；tmp 法唯一写口（生产树结构性零触碰）；clock/runner 注入。
- 状态与并发：tmp 用后清理；同一候选重跑=verification 覆盖（最新一次为准）；迁移经 core 判边 + 乐观锁。
- 错误与观测：failReason 分类 `timeout|command-failed|asset-missing|command-missing|path-escape`；
  形状闸（timeoutMs 非正整数）⇒ CONFIG_INVALID 上抛（调用方 bug 不进证据面）；输出摘要保头尾、限长。
- 测试与证据：test/evolve/sandbox.test.ts（589 行，五组：tmp 隔离/补丁/分类/报告形状/CLI 链）。
- 规模：≤ 600 行（现 570，余量 30）。**未证**：真机资源隔离（cgroup/网络）未做——tmp 隔离只是文件面。
```

### 4.5 包清单与类型门禁（2 条）

```text
F-daemon-package-json
- 路径/处置：apps/daemon/package.json；1253 字节；现有；目标-保留 + 四处归正（80-§3.2 / 79-§10.1）。
- 归属：79-§4.4（源码态导出）、§6.2（exports 形状）、§7（发布面：daemon 不发布）、§10.1（依赖裁决）。
- 职责：daemon 包身份、导出子路径、bin、脚本与依赖清单。非职责：不承载运行逻辑。
- 内部（现状）：name "@studio-next/daemon"、version 0.1.0、private true、type module；
  exports { ".": ./src/index.ts, "./engine": ./src/engine/engine.ts, "./serve": ./src/assembly/serve.ts }；
  bin { studio-next: ./src/cli/main.ts }；scripts { start: node src/index.ts, typecheck: tsc --noEmit -p tsconfig.json }。
- 依赖裁决（实测 import 文件数，`grep -rl "from '@studio-next/<p>" src test`）：
  · 在用：adapters 47 / company 27 / contract 135 / core 57 / gateway 9 / localplatform 2 / panel 5 /
    prompt 1（`engine/prompt-assembly.ts:39`）/ store 105 / taiga 5
  · **零 import**：`@studio-next/api`、`@studio-next/yt`（休眠边，保留；删除须同步改 `allowedPackageEdges`，提案流）
  · `execa ^9.4.0`：`src`+`test` 零 import ⇒ **死依赖，目标移除**（79-DEP-EXECA-09）
  · `zod ^4.0.0`：`src`+`test` 零 import ⇒ **死依赖，目标移除**（79-§10.1 第 5 项）
  · `simple-git ^3.27.0`：仅 `test/cli/industry-templates.e2e.test.ts:28` ⇒ **移 devDependencies**
  · devDeps `@modelcontextprotocol/server`、`@studio-next/studio-tools`：仅测试用，正确保留
- 目标改动：① 删 `main` 与 `exports["."]`（保留 `./engine`、`./serve`）；② `scripts.start` 改
  `node src/cli/main.ts serve`（根 `"daemon"` 脚本同步，归 19）；③ 依赖分类归正（上表）；④ `bin` 保持指 `cli/main.ts`。
- IO/状态/错误：无运行时代码；无 IO、无状态、无错误面。
- 测试与证据：`bun run typecheck`（`exports` 解析）、各包测试经 `@studio-next/daemon/{engine,serve}` 解析；
  迁移证据=全仓包根 import 为零 + `guard:boundaries` 绿。
- 规模：清单文件，无行数预算；迁移序 M-a（§7.3）。**未证**：删 `./engine`/`./serve` 任一条都会断 boot（79-§6.2 第 3 条）。
- 回写：79-§10.1 第 7 项把 `prompt` 与 `api`/`yt` 并称休眠边，与实测（prompt 在用）不符——见 §8.1 W-9。
```

```text
F-daemon-tsconfig
- 路径/处置：apps/daemon/tsconfig.json；161 字节；现有；目标-保留（内容逐文件契约归 19）。
- 归属：79-D10（测试目录未进类型门禁）、79-§1.3（NodeNext/严格开关）。
- 职责：daemon 包级类型门禁——`extends ../../tsconfig.base.json`，`include ["src/**/*.ts"]`。
- 非职责：不含 `test/**`（现状），因此 25 件测试的类型错误不会被 `bun run typecheck` 发现。
- 内部：两键（extends + include）+ 一行注释；无 compilerOptions 覆盖。
- 导出/IO/状态/错误：无代码面。
- 测试与证据：`bun run typecheck` 覆盖 `src` 42 件；`test` 面靠 vitest 转译（不做类型检查）。
- 规模：无行数预算。**未做**：`typecheck:test` 脚本或把 `test/**` 纳入包 program（82 立「test 目录纳入门禁」项）；
  纳入后 `hot-reload.test.ts`（930）等大件的类型错误会首次暴露——属预期，不是回归。
```


---

## 五、逐文件契约：`src/cli/**`（22 条）

〔域前言〕层位 **cli(5)**；可 import `assembly`/`control`/`evolve`/`engine`/`engine/tools` 与各包面；**不得被 root 或 assembly import**（`root→cli`、`assembly→cli` 违例）；直下 22 件（余 3 件到 25 上限）。本域**零 `node:child_process`**（79-§3.5 ⑤ 满足），但 12 件直接 import `node:fs`（§8.1 W-2）。CLI 不持有运行栈（80-§3.1）：`serve` 之外的命令都是「一次性、进→做→退码」。

〔域前言·开库面〕CLI 共 **9 处** `openLedger` 调用点（`candidates:44`、`company:153`、`cutover:49`、`gray:37`、`jobs:58`、`jobs:84`、`ledger:37`、`postmortem:68`、`sandbox:41`），另有 2 处维护写面经 store 函数间接开库（`ledger drill` → `runLedgerDrill`；`ledger rebuild` → `rebuild`）。`openLedger` 无条件 `migrate`，因此 daemon 运行期执行这些命令=并发迁移/写者冲突面（80-§12.5 U80-16）。80 卷记「CLI 8」与本实测 9 有 1 处差（`jobs` 有 list/catchup 两个调用点），见 §8.1 W-7。

〔域前言·开库面目标分级（80-§8.2 D12，逐命令写死）〕

| 命令 | 开库点 | 目标打开方式 | 依据 |
|---|---|---|---|
| `candidates list` | `candidates:44` | `openLedgerReadonly`（只读；库不存在 ⇒ `unavailable/db-missing`） | 80-§8.2 第 2 条 |
| `jobs list` | `jobs:58` | `openLedgerReadonly` | 同上 |
| `ledger dump` | `ledger:37` | `openLedgerReadonly`（写的是 `outPath` 文件，不是库） | 同上 |
| `ledger drill` | `runLedgerDrill`（无直接 `openLedger`） | `openLedgerMaintenance`（维护写面；离线窗口、库必须不存在） | 80-§8.2 第 3 条 |
| `ledger rebuild` | `rebuild()` | `openLedgerMaintenance` | 同上 |
| `company add/create` | `company:153` | **未定义** ⇒ W-11 | 80 未给写命令的开库口径 |
| `jobs catchup` | `jobs:84` | **未定义** ⇒ W-11 | 同上 |
| `cutover` | `cutover:49` | **未定义** ⇒ W-11 | 同上 |
| `gray` | `gray:37` | **未定义** ⇒ W-11 | 同上 |
| `postmortem` | `postmortem:68` | **未定义** ⇒ W-11 | 同上 |
| `sandbox` | `sandbox:41` | **未定义** ⇒ W-11 | 同上 |

〔纪律〕本卷**不**替写命令发明「可写打开」的第三种签名：`openLedger` 的无条件迁移在 80-§8.2 已判待修，写命令要用的「写意图 + 单实例锁 + 离线窗口」口径须由 80/03/82 裁决（W-11）。在裁决前，写命令现状不变、**不得**被当成「已合规」。

〔域前言·退出码与错误口径〕见 §1.5：成功 `0`；用法/前置失败 `1`；`ClassifiedError` 的 `failure` 只进 stderr 文案（带 `subcause`），**不得**把 `category` 当退码。

```text
F-daemon-cli-main
- 路径/处置：src/cli/main.ts；114 行；现有；目标-保留。
- 归属：80-§3.1（唯一命令分发入口，bin 只指它）；docs/17-§2；usage.ts 头注（单一文档源）。
- 职责：18 命令 `switch` 分派 + help/version 面 + typo 建议 + `process.exitCode` 收尾（不用 process.exit，
  让管道先冲刷）。非职责：不实现命令（一命令一模块）、不持有运行栈、不解析业务旗标。
- 内部：main()（私有）；cliVersion()（读 `../../package.json` 的 version，`new URL(import.meta.url)` 定位）；
  无 export（bin 入口）。分派表键序 = usage.ts `SECTION` 键序（对账闸 help-face.test.ts）。
- 导出与依赖：零导出；import usage/argv/help + 18 个 cmd*。
- IO 与注入：fs=readFileSync(version)；env=零（版本不引 process.env）；console；`process.argv`。
- 状态与并发：无；`process.exitCode` 单一收尾；未捕获异常 ⇒ `errText` 打印 + 1。
- 错误与观测：未知子命令 ⇒ stderr 错误行（含 did-you-mean）+ stdout 已知命令一行 + 1；`-h/--help/help/空`
  ⇒ 全文 + 0；`--version/-V` ⇒ 单行 + 0。
- 测试与证据：help-face.test.ts（七态矩阵、spawn 面）、usage-contract.test.ts（版本/退码抽样）。
- 规模：≤ 200 行；新增命令只加一行 case，不得把命令体写进 switch（80-§10.7 第 3 条）。
```

```text
F-daemon-cli-usage
- 路径/处置：src/cli/usage.ts；296 行；现有；目标-保留（单一文档源）。
- 归属：docs/17-§2（CLI 人机面约定）；80-§10.7（24 件时与 help 合并预案）。
- 职责：全部命令文档——`SECTION`（全文段，键序=装配序=分派序）、`CONCISE`（简段）、`USAGE_HEADER`、
  `USAGE_TAIL`（默认值/语法位/旗标同义/退码表/版本/文档指针）、`USAGE = HEADER + ΣSECTION + TAIL`。
  非职责：不解析、不执行、不读文件。
- 内部：五个 export 常量（`as const` 对象 + 拼装字符串）；零函数。
- 导出与依赖：五常量；零 import。
- IO：零（纯字符串）。
- 错误与观测：键集漂移由 help-face.test.ts 判红（SECTION 与 CONCISE 键集全等、18 命令齐全、
  每条简段带看全文指引、全文段命令行以 `studio-next` 开头）。
- 测试与证据：help-face.test.ts（五条单源装配）、usage-contract.test.ts（USAGE_TAIL 四声明被行为兑现）、
  create-serve-face.test.ts（SECTION.serve 含最小样例）。
- 规模：≤ 400 行；到 24 个命令模块时先合并 help/usage（80-§10.7）。
```

```text
F-daemon-cli-help
- 路径/处置：src/cli/help.ts；84 行；现有；目标-保留（合并预案同上）。
- 归属：80-§10.7；usage.ts 头注的七态矩阵。
- 职责：求助预检（`wantsHelp`）、拼写建议（`suggestNear`，Levenshtein ≤2 或 ≥3 字符前缀）、
  统一错误/帮助出口（`usageFail`/`helpOk`/`missingSub`/`unknownSub`）。非职责：不打印全文（由 usage 提供）。
- 内部：wantsHelp(argv): boolean；suggestNear(input, known): string|undefined；usageFail(prefix, message,
  concise): number（stderr 错误行 + stdout 简段 + 1）；helpOk(section): number（0）；
  missingSub(group, subcommands, concise): number；unknownSub(group, sub, subcommands, concise): number。
- 导出与依赖：六函数；零 import（零依赖手写）。
- IO：console；无 fs；零副作用（helpOk 先于一切解析）。
- 错误与观测：退码语义固化（求助=0、用法=1）；不猜无近邻项。
- 测试与证据：help-face.test.ts（suggestNear 三组、wantsHelp 两位、七态矩阵）。
- 规模：≤ 200 行。
```

```text
F-daemon-cli-argv
- 路径/处置：src/cli/argv.ts；61 行；现有；目标-保留。
- 归属：79-§3.1（CLI argv 手写解析 + 显式数值夹取）；16-§二（不引库）。
- 职责：零依赖 token 解析——位置参数、`--flag value` 与 `--flag=value` 两式、可重复旗标、布尔旗标；
  错误以 `{error}` 返回而非抛。非职责：不做值域校验（各命令自校）、不认短旗标（仅 `-h`/`-V` 由 main 处理）。
- 内部：Argv{positionals,flags,booleans,multi}；parseArgv(argv, valueFlags, repeatableFlags?, booleanFlags?)
  → Argv | {error}；errText(err): string。
- 导出与依赖：一类型 + 两函数；零 import。
- IO：零（纯）；不读 env。
- 错误与观测：未知旗标/缺值/位置参数过多 ⇒ `{error}` 文案（各命令转 usageFail）。
- 测试与证据：help-face.test.ts（内联式 `--flag=value` 与空格式同效）、usage-contract.test.ts（同义抽样）。
- 规模：≤ 150 行。
```

```text
F-daemon-cli-init
- 路径/处置：src/cli/init.ts；54 行；现有；目标-保留。
- 归属：docs/04-§二；`company create` 的前置件（initCompany 由 company 包提供）。
- 职责：`studio-next init <slug> [--name] [--dir] [--template]` —— 调 `initCompany` 生成公司目录，
  成功后打印「下一步」三步（validate→company create→serve）。非职责：不做校验规则、不建库。
- 内部：cmdInit(argv): Promise<number>；flag 面 name/dir/template；退码 0/1。
- 导出与依赖：一函数；依赖 company（initCompany）与 help/argv/usage。
- IO 与注入：path；公司目录写由 company 包执行（唯一写入者纪律：命令是触发方，写者仍是 company 的编排件）。
- 状态/并发：无；幂等性归 initCompany。
- 错误与观测：用法错=1 简段；执行失败=1 错误行（不吞）。
- 测试与证据：test/cli/next-steps.test.ts（下一步三步全真实可跑）；help-face.test.ts 态 2。
- 规模：≤ 120 行。
```

```text
F-daemon-cli-gen-templates
- 路径/处置：src/cli/gen-templates.ts；37 行；现有；目标-保留。
- 归属：DEV-14；docs/36-§4 M-A（结构源 docs/33-§3）。
- 职责：`gen-templates [--out]` —— 调 company 的分级模板生成器，渲染 company-3..9 七套 + 自检 + 写盘。
  非职责：不定义模板结构（`packages/company/src/level-specs.ts` 是唯一结构源）。
- 内部：cmdGenTemplates(argv)；flag=out；退码 0/1。
- 导出与依赖：一函数；依赖 company（regenerateLevelTemplates）。
- IO：写盘归 company 生成器；本件只取参/打印。
- 错误与观测：生成器自检红即不落盘（由被调方保证）；本件把失败如实退出 1。
- 测试与证据：test/cli/industry-templates.e2e.test.ts（间接）；company 的 gen-template.test.ts（逐字节）。
- 规模：≤ 100 行。
```

```text
F-daemon-cli-company
- 路径/处置：src/cli/company.ts；291 行；现有；目标-保留。
- 归属：76 `DEF-PKG-05/07/08`（公司定义包导入/创建）；docs/43-§一、docs/51（仓库判定器）。
- 职责：`company add|create|validate` 三子命令 + 组分发（`cmdCompany`）：
  add=git clone→剥离活性 .git→重建本地仓→校验→初始化（信任锚 trust=false、.AIWS 树、依赖安装到隔离插件根）；
  create=init→provision→全员建号→jobs 装载→插件 provisioning→验收报告（幂等 adopt；`--dry-run` 零落盘）；
  validate=仓库五契约判定（A 目录封闭/B schema/C 交叉/D 依赖/E 卫生），`--json` 机器面、
  `--allow-extra` 豁免 A-1 留痕、`--product` 按导入产物面判。
  非职责：不实现校验规则（company 包）、不写平台（信任锚是文件面）。
- 内部：cmdCompanyAdd/cmdCompanyCreate/cmdCompany/cmdCompanyValidate 四导出；flag 面见 usage SECTION.company；
  退码：add/create 0/1；validate **0=PASS / 1=不合法 / 2=判定器自身错**。
- 导出与依赖：四函数；依赖 company 九件 + localplatform + contract + store（`openLedger` :153）。层位 cli→各包合法。
- IO 与注入：fs/path；网络（git clone）经 company；台账开库点 1 处（:153）。**写面**（`company create` 建库、`add`
  写公司目录）⇒ 开库方式 80 未定义（§8.1 W-11）；现状 `openLedger` 的无条件迁移不得被当成合规。
- 状态/并发：幂等（同 url 再跑=镜像同步+adopt）；`--dry-run` 全相位零落盘。
- 错误与观测：`RepoInputError` 分类；违规逐条 `{规则号,文件,位置,违规描述,修复建议}`；`--json` 单行 JSON 人机不混流。
- 测试与证据：test/cli/next-steps.test.ts（create/add 的 next 与 --json）、help-face.test.ts（组内求助/typo）、
  company 包 test/company-validate-cli.test.ts（真 spawn）。
- 规模：≤ 350 行（现 291）；再长须按子命令拆 `cli/company/{add,create,validate}.ts` 子目录（不占直下额度）。
```

```text
F-daemon-cli-validate
- 路径/处置：src/cli/validate.ts；74 行；现有；目标-保留（`validate` 别名长期看可退役，但需批示）。
- 归属：docs/04-§九（挂载闸）；studio-dev-103 S2（正位面=company check）。
- 职责：`company check <目录>` 正位面 + 顶级 `validate` 兼容别名（同语义同退码 + stderr 一行弃用告警）。
  非职责：不实现校验规则（company 包）、不代建库。
- 内部：runStructureCheck(dir)；cmdCompanyCheck(argv)；cmdValidate(argv)；退码 0/1；本命令无旗标。
- 导出与依赖：三函数；依赖 company（loadCompanyDirectory/readDirectoryFiles）+ path。
- IO：path + company 读目录；stdout 摘要「文件:行 [规则] 修法」。
- 状态/并发：只读。
- 错误与观测：不合法 ⇒ stderr 逐条 + 1；旗标形令牌拒收（E12 治理）；别名在 `-h` 面不触发弃用告警。
- 测试与证据：test/cli/structure-check.test.ts（正位面/不合法/旗标拒收/别名弃用）、next-steps.test.ts。
- 规模：≤ 150 行。
```

```text
F-daemon-cli-ledger
- 路径/处置：src/cli/ledger.ts；81 行；现有；目标-保留。
- 归属：docs/02-F2-11/F2-12（导出/重建/演习）；80-§8.2（库维护窗口 / 只读打开 / 维护写面）。
- 职责：`ledger drill <库> | dump <库> <out.jsonl> | rebuild <源.jsonl> <目标库>` —— 删库重建演习、
  events 全量导出、JSONL 重放建新库。非职责：不改 schema、不做迁移（migrate 归 store）。
- 内部：cmdLedger(argv)；三子命令；退码 0/1（drill 结论 PASS=0 / FAIL=1）。
- 导出与依赖：一函数；依赖 store（openLedger/rebuild/renderDrillReport/runLedgerDrill）+ path。
- IO 与注入：fs/path；**开库点按子命令分级**（80-§8.2）：
  · `dump`（:37）→ 目标 `openLedgerReadonly`（写的是 `outPath` 文件，不是库；库不存在 ⇒ `unavailable/db-missing`）；
  · `drill`（`runLedgerDrill`）与 `rebuild`（`rebuild()`）→ 目标 `openLedgerMaintenance`（维护写面：允许建库建表，
    但**只许**在 daemon 未运行或已持单实例锁的离线窗口执行）；drill 要求库路径**不存在**（防误删真实台账）。
- 状态与并发：rebuild 单事务原子；drill 三件套（写入→dump→删库重建→比对）可重定向留证。
  维护写面**不得**与 `runServe` 并发（80-§8.2 第 3 条、U80-16）。
- 错误与观测：`dump` 的 existsSync 闸（:80 注释：openLedger 会建库迁移，代建=副作用，违只读语义）保留；目标改为读
  `openLedgerReadonly` 的 `Err` 并原样报 `subcause`（`db-missing`/`schema-behind`/`schema-ahead`），**不**改写成 `CONFIG_INVALID`。
- 测试与证据：store 包测试为主；CLI 面由 usage-contract/help-face 间接覆盖。
- 规模：≤ 150 行。**未证**：daemon 运行期执行 drill/rebuild 无并发保护（U80-16）。
```

```text
F-daemon-cli-candidates
- 路径/处置：src/cli/candidates.ts；73 行；现有；目标-保留。
- 归属：docs/16-§四（v0.10 进化管线）；只读面；80-§8.2 第 2 条（读命令只读打开）。
- 职责：`candidates list --db` —— 汇总行（总数+状态分布）+ 逐行（id/状态/资产类型/blast_radius/version/
  谱系父/资产路径/diff 哈希，`(created_at,id)` 升序）。非职责：不写库、不代建库。
- 内部：cmdCandidates(argv)；flag=db；退码 0/1（库不存在=1 + 指路 `company create`）。
- 导出与依赖：一函数；依赖 store（CANDIDATE_STATUS_VALUES/openLedger）。
- IO：fs/path；开库点 1 处（:44）。**目标**：`openLedgerReadonly({path, expectedSchemaVersion, readOnly:true, queryOnly:true})`
  ——现「先 existsSync 再 openLedger」的二段式改为读 `Result`（后者仍在 openLedger 里跑迁移）。
- 状态/并发：现状只读**但** `openLedger` 含迁移（§五前言）；目标为真只读（`query_only=ON`，不跑 DDL、不建库）。
- 错误与观测：库不存在 ⇒ `Err(unavailable/db-missing)` → stderr 指路 + 1；schema 落后/过新 ⇒
  `rejected_version/EVOLVE_REJECT/schema-behind|schema-ahead` → 1（**不**自动升级）；裸组命令 ⇒ 1。
- 测试与证据：test/cli/next-steps.test.ts（库不存在报文）、help-face.test.ts（态 2c）、evolution-e2e（CLI 面）。
- 规模：≤ 150 行。
```

```text
F-daemon-cli-jobs
- 路径/处置：src/cli/jobs.ts；102 行；现有；目标-保留。
- 归属：docs/17-§2（调度表）；127-A R2/R4（分诊/补跑）；80-§8.2 第 2 条（读）/ §8.1 W-11（写）。
- 职责：`jobs list --db`（只读分诊：job_id/cron/dept/status/型/下跑槽/末跑槽，next_run_at 升序）与
  `jobs catchup --db --job`（把 next_run_at 推到当下——只挪槽不派工）。非职责：不派工、不清欠账、不覆盖跑史。
- 内部：cmdJobs(argv)；两子命令；退码 0/1（缺 --job/库不存在=1）。
- 导出与依赖：一函数；依赖 store（openLedger）+ fs/path。
- IO：开库点 **2 处**（:58 list、:84 catchup），**两处口径不同**：
  · `list` → 目标 `openLedgerReadonly`（读面；库不存在 `unavailable/db-missing`）；
  · `catchup` → 写面（`ledger.upsertJob`），**80 未定义写命令的开库方式** ⇒ §8.1 W-11；不得用只读口顶上
    （`query_only` 下写必失败），也不得私造第三种签名。
- 状态/并发：catchup 是写面（`ledger.upsertJob` 只改 `next_run_at`），与 daemon 并发时无 fencing（U80-16）；
  目标须在离线窗口或持单实例锁后执行。
- 错误与观测：岗不在台账 ⇒ 如实拒 + `jobs list` 指路；last_run_at 不被覆盖（现注释已固化，保留）。
- 测试与证据：test/cli/jobs-cli.test.ts（list/catchup 六条）。**不证明**并发 fencing。
- 规模：≤ 200 行。
```

```text
F-daemon-cli-sandbox
- 路径/处置：src/cli/sandbox.ts；73 行；现有；目标-保留。
- 归属：20-§九沙箱环节；docs/17-§6（验收四要件）；80-§8.2 / §8.1 W-11（写命令开库）。
- 职责：`sandbox --db --candidate [--command] [--file] [--timeout] [--root]` —— 调 evolve 链跑沙箱并落证据。
  非职责：不实现沙箱（evolve/sandbox.ts）、不判业务价值。
- 内部：cmdSandbox(argv)；flag 面见 usage；退码：**判定红=0**（档案面），用法/库/链错误=1。
- 导出与依赖：一函数；依赖 store（openLedger）+ evolve（runCandidateSandbox/renderSandboxLines）+ fs/path。
- IO：开库点 1 处（:41）；沙箱本身不写生产树（evolve 保证）。**写面**（落证据/改 candidate 版本）⇒
  开库方式 80 未定义（§8.1 W-11），现状 `openLedger` 不变、不得被当成「已合规」。
- 状态/并发：verification 覆盖=最新一次；状态迁移只走 core；与 daemon 并发无 fencing（U80-16）。
- 错误与观测：CONFIG_INVALID/EVOLVE_REJECT 被捕获后 exit 1（分类文案直出）；目标保留 `failure`+`subcause`。
- 测试与证据：test/evolve/sandbox.test.ts CLI 组、test/cli/next-steps.test.ts（spawn 面库不存在指路）。
- 规模：≤ 150 行。
```

```text
F-daemon-cli-cutover
- 路径/处置：src/cli/cutover.ts；85 行；现有；目标-保留。
- 归属：20-§九切权环节；80-§8.2 / §8.1 W-11（写命令开库）。
- 职责：`cutover --db --candidate --file --company [--no-restart] [--no-gray] [--root] [--actor] [--dept]
  [--level]` —— 调 runCutover 并打印明细。非职责：不做判负/备份逻辑（evolve/cutover.ts）。
- 内部：cmdCutover(argv)；退码：成功 0；判负红 1（如 hash 不匹配）；用法错 1；库不存在 1（写面不代建库）。
- 导出与依赖：一函数；依赖 store（openLedger）+ evolve（runCutover/renderCutoverLines）+ fs/path。
- IO：开库点 1 处（:49）；写生产文件在 evolve 层（本件不写）。**写面** ⇒ 开库方式未定义（§8.1 W-11）。
- 状态/并发：串行；`--no-restart` 只抑制提示（v0 恒不实重启）。
- 错误与观测：判负报文原样上抛（不裹）；`--level` 非法 ⇒ 用法错。
- 测试与证据：test/evolve/cutover.test.ts CLI 组四条（成功/抑制提示/判负/用法）。
- 规模：≤ 150 行。
```

```text
F-daemon-cli-gray
- 路径/处置：src/cli/gray.ts；91 行；现有；目标-保留。
- 归属：20-§四灰度零事故；80-§8.2 / §8.1 W-11（写命令开库）。
- 职责：`gray --db --candidate [--check|--close] [--root]` —— 缺省查窗（只读）、`--check` 检查（可能自动回滚）、
  `--close` 手动关窗。非职责：不定义事故阈值口径（evolve/gray.ts 常量）。
- 内部：cmdGray(argv)；退码：0=查窗/检查完成（含回滚）/关窗；1=无窗/用法/库不存在/备份缺失等拒面。
- 导出与依赖：一函数；依赖 store + evolve（checkGrayWindow/closeGrayWindow/render*）+ fs/path。
- IO：开库点 1 处（:37）；文件恢复在 evolve 层。**三态口径不同**：缺省查窗是纯读（目标 `openLedgerReadonly`）；
  `--check`/`--close` 是写面（可能回滚/关窗写台账）⇒ 开库方式 80 未定义（§8.1 W-11）。
- 状态/并发：回滚后再 check 幂等；关窗不回滚；与 daemon 并发无 fencing（U80-16）。
- 错误与观测：回滚=合法判定（exit 0）而非命令错误——退码语义写在 usage 退码表。
- 测试与证据：test/evolve/gray.test.ts CLI 组三条。
- 规模：≤ 150 行。
```

```text
F-daemon-cli-postmortem
- 路径/处置：src/cli/postmortem.ts；93 行；现有；目标-保留。
- 归属：20-§十一（复盘→案例库）；80-§8.2 / §8.1 W-11（写命令开库）。
- 职责：`postmortem --db --company --issue --input [--casebook] [--slug] [--date] [--dept] [--level] [--actor]`
  —— 读复盘 JSON → parse → 调 runPostmortemChain。非职责：不生成复盘正文（`--input` 必给，
  「复盘正文不可虚构」）、不判根因。
- 内部：cmdPostmortem(argv)；退码 0/1（形状闸 CONFIG_INVALID ⇒ 1；库不存在 ⇒ 1）。
- 导出与依赖：一函数；依赖 store + evolve（parsePostmortemInput/runPostmortemChain/renderPostmortemLines）+ fs/path。
- IO：开库点 1 处（:68）；案例库写盘在 evolve 层。写面 ⇒ 只读口不适用（W-11）。
- 状态/并发：同日重跑覆盖条目 + 追加事件。
- 错误与观测：追责哨兵/坏 slug/坏 date ⇒ 分类错误文案 + 1，不落半成品事件。**写面** ⇒ 开库方式 80 未定义
  （§8.1 W-11）；`--input` 缺失即用法错，不得以空正文续跑。
- 测试与证据：test/evolve/postmortem.test.ts CLI 组。
- 规模：≤ 150 行。
```

```text
F-daemon-cli-panel
- 路径/处置：src/cli/panel.ts；47 行；现有；目标-保留。
- 归属：80-§9.2（`:8791` 监控面；逻辑名 `:8787` 的双口径见 79-D6）。
- 职责：`panel --db [--port 8791]` —— 起 panel 的只读监控服务，Ctrl-C 优雅关闭。非职责：不实现视图（panel 包）。
- 内部：cmdPanel(argv)；退码 0（关闭）/1（库不存在/用法）；`let port = 8791`（:21）。
- 导出与依赖：一函数；依赖 panel（servePanel）+ path。
- IO：网络监听在 panel 包；本件只传参；零 fs。
- 状态/并发：长驻；`process.on` 收信号。
- 错误与观测：库不存在拒启（不代建）；Ctrl-C 收口。
- 测试与证据：help-face.test.ts（态 1：坏库路径也不碰）、usage-contract.test.ts（--port=8799 同效）。
- 规模：≤ 100 行。
```

```text
F-daemon-cli-overview
- 路径/处置：src/cli/overview.ts；195 行；现有；目标-保留。
- 归属：80-§9.3（`:8789` 公司概览；五读面全 GET 只读）。
- 职责：`overview --company <目录> [--company …] [--db] [--port 8789]` —— 挂载公司目录（可多家，校验不过拒绝挂载）
  并起概览面；另导出 `scanReportFiles`（报表目录元数据扫描，供辅助列）。非职责：不实现视图（panel/overview）、
  不在读路径写事实。
- 内部：scanReportFiles(companyDir): ReportFileMeta[]；cmdOverview(argv)；退码 0（关闭）/1（用法/挂载失败/
  库不存在）。
- 导出与依赖：两函数；依赖 company（loadCompanyDirectory/readDirectoryFiles）、panel/overview
  （mountHotCompanySource/serveOverview）、contract、fs/path。
- IO：读公司目录；`--db` 可选且必须已存在（只读不代建）；网络在 panel 包。
- 状态与并发：`HotCompanyHandle` 生命周期由本件持有；`process.on` 收信号。
- 错误与观测：报表目录不存在=空清单（如实降级，不抛——归档缺失判定归台账事件对账）。
- 测试与证据：test/cli/overview-reports-scan.test.ts（两条）。
- 规模：≤ 250 行。
```

```text
F-daemon-cli-external
- 路径/处置：src/cli/external.ts；143 行；现有；**目标-退役**（80-§9.4 装配决策 5 / 81-§3.4）。
- 归属：80-§9.4（`:8788` 目标职责与迁移路径）、U80-09/U80-13/U80-15；79-D11（入口语义债）。
- 职责（现状）：起 panel 的 `serveExternal`，注入公司源与网关，提供信息面 + `POST /v1/requests`（落单+幂等键）。
  目标：只保留迁移指引（打印「请用 `studio-next serve`」）或整体退役；**不得**独立启动触发面。
  **不持装配权**：不得 import `assembly/api/assemble.ts`、不得在此产 `ApiServerOptions`、不得自起 `serveApi`
  ——`:8788` 的唯一合法起法在 `runServe` 第 7 步（80-§9.4 决策 1/5）。
- 内部（现状）：cmdExternal(argv)；flag 面 company/db/port/token/requests-per-minute/lan；退码 0（关闭）/1；
  `process.on` 收信号；Date.now（幂等 TTL/配额）。
- 导出与依赖：一函数；依赖 `@studio-next/panel/external`（serveExternal/ExternalCompanySource）、company、
  contract、gateway（CONTROL_TICKET/createGateway）。
- IO：fs/path；网络监听在 panel/external；**落单写台账**（`panel/external/server.ts:487/:491` 两处越界写，
  80-§9.4 判为待迁移违例）。
- 状态与并发：`POST /v1/requests` 的幂等键在 panel 侧实现；本件无状态。
- 错误与观测：越权 fail-closed；**现状**是 token 缺省时触发请求回 401，**目标**是 external 开启而 token 缺配即 `CONFIG_INVALID` 整机拒启动，401 只表示请求凭据不合法；`--lan` 才绑 0.0.0.0。
- 测试与证据：无专属测试（不证明任何迁移结论）。
- 退役条件（81-§3.4）：api 接管 + CLI 改线 + 路由/认证/幂等/只读迁移验证后同步删；调用方清单=`cli/main.ts` 的
  `case 'external'` 与 usage 的 SECTION/CONCISE 两处；历史与未决义务不因删除消灭。
- 退役前置（80-§9.4）：M3 装配上线 + M4 **十项**验证全绿；D12（只读打开不跑 DDL）未落地则 M3 不得宣称绿。
- 规模：退役前 ≤ 200 行；不得新增命令面。
```

```text
F-daemon-cli-serve
- 路径/处置：src/cli/serve.ts；60 行；现有；目标-保留（`bin` 与根脚本的目标入口）。
- 归属：80-§3.1（`cli/main.ts serve` 成为唯一 daemon 启动入口）、§3.2 第 4 条。
- 职责：`serve --config <daemon.yaml>` —— `runServe` 薄壳（**传 `{ configPath }`**，80-§3.4 第 7 条判别联合的
  CLI 半边；`{ config }` 半边由 boot 用）+ `renderDaemonYamlSkeleton`（company create 顺产骨架）。
  非职责：不装配运行栈（assembly/serve.ts）、不注入 opts（「核心无注入面」模式必须保留为合法缺省，80-§3.4 第 5 条）、
  不预解析 YAML（解析只发生一次）。
- 内部：renderDaemonYamlSkeleton({dbPath,slug,companyDir,rootDir}): string（键集 ⊆ parseDaemonConfig 收的面、
  路径走 JSON.stringify 引号壳）；cmdServe(argv)；退码 0/1/**2**（2=运行中断 tick 异常，:50）。
- 导出与依赖：两函数；依赖 assembly（runServe）+ usage/help/argv + path。**唯一 daemon 启动入口**：
  不得在本件内开台账/建运行栈/起 API（那三件都在 `runServe` 里），也不得绕开 `runServe` 直调 `buildServeRuntime`。
- IO：不读文件（runServe 读）；console；信号由 runServe 处理。
- 状态/并发：caller 负责骨架幂等（在场即 kept，绝不覆盖手改）。
- 错误与观测：启动失败 ⇒ `serve 启动失败：<errText>` + 1；运行中断 ⇒ 明细 + 2。
- 测试与证据：test/cli/create-serve-face.test.ts（骨架往返/真 bin 端到端/kept/dry-run）、stop-channel spawn 冒烟。
- 规模：≤ 150 行。
```

```text
F-daemon-cli-taiga-cure
- 路径/处置：src/cli/taiga-cure.ts；79 行；现有；目标-保留。
- 归属：docs/52-§十 A1→A2→A3；一次性运营命令（不进主循环）。
- 职责：`taiga-cure --config` —— Taiga 出厂态根治三步（默认态重指声明集收件态 / 存量单归化 / 出厂状态退役），
  任何 DELETE 前先落状态集快照到 `<rootDir>/var/`。非职责：不代 daemon 写 provision（A4 未知态哨在引擎采集相位）。
- 内部：cmdTaigaCure(argv)；退码 0（完成，含零写幂等）/1（用法/配置/执行失败）/**2**（A2 失败条数 > 0）。
- 导出与依赖：一函数；依赖 taiga（buildContext/cureFactoryStatuses/FactoryStatusSnapshot）+ assembly（parseDaemonConfig）
  + platform/wire 的 loadTaigaFieldMap/resolveTaigaAuth + fs/path。
- IO：读 daemon.yaml；写 var/ 快照；网络在 taiga 包。
- 状态/并发：幂等重跑零写零删；删除不可逆 ⇒ 先入档后行。
- 错误与观测：platform 非 taiga / 缺 taigaFieldsFile / 非法 JSON ⇒ 明报不猜（1）；逐项打印 A1/A2/A3 明细。
- 测试与证据：test/cli/taiga-cure.test.ts（四条配置守门）。
- 规模：≤ 150 行。
```

```text
F-daemon-cli-reload
- 路径/处置：src/cli/reload.ts；77 行；现有；目标-保留。
- 归属：docs/38-§2 L1 / §4 R-A；控制面文件通道的 CLI 侧。
- 职责：`reload [--company] [--root] [--config] [--timeout]` —— 写 reload 请求 → 轮询回执 → 按回执退出。
  非职责：不执行重载（daemon 拍边界做）、不读公司目录。
- 内部：cmdReload(argv)；退码 0（applied/unchanged）/1（company 错家、no-company-dir、超时无回执、用法）。
- 导出与依赖：一函数；依赖 control（hot-reload 的通道函数）+ assembly（parseDaemonConfig，用于 --config 的 rootDir 发现）
  + usage/help/argv + fs/path。
- IO：fs 写请求/读回执；轮询裸 `Date.now()`（W-4）。
- 状态/并发：按 id 匹配（旧回执不误读）；工位根发现序：--root > --config 的 rootDir > 缺省 ./var。
- 错误与观测：超时 ⇒ 提示「daemon 未运行/拍太慢/控制面目录不符」+ 1。
- 测试与证据：test/control/stop-channel.test.ts 的协议组（同为文件通道族）+ hot-reload.test.ts 手动通道组。
- 规模：≤ 150 行。
```

```text
F-daemon-cli-stop
- 路径/处置：src/cli/stop.ts；72 行；现有；目标-保留。
- 归属：DEV-9/DEV-41；控制面停机通道的 CLI 侧。
- 职责：`stop [--reason] [--root] [--config] [--timeout]` —— 写停机请求 → 轮询回执（回执=优雅停收口证据）。
  非职责：不杀进程、不判断停机是否完成（回执即证据）。
- 内部：cmdStop(argv)；退码 0（有回执）/1（超时/用法）。
- 导出与依赖：一函数；依赖 control（stop-channel 五函数）+ assembly（parseDaemonConfig）+ usage/help/argv + fs/path。
- IO：fs 写请求/读回执；轮询裸 `Date.now()`（W-4）。
- 状态/并发：按 id 匹配；daemon 侧消费请求后改名 `.consume`（残留请求不使重启进程自停）。
- 错误与观测：无回执 ⇒ 明报三种可能 + 1；detail 透传回执内容。
- 测试与证据：test/control/stop-channel.test.ts（spawn 冒烟：serve 真进程 → stop → 优雅停 → 回执 → exit 0）。
- 规模：≤ 150 行。
```

---

## 六、测试件（现有 25 件 / 目标 42 件）

〔复算〕现有 25 = `test/assembly` 6 + `test/cli` 9 + `test/control` 2 + `test/evolve` 6 + 根级 2；目标 42 = 16 + 10 + 4 + 10 + 2，即**净增 17 件**（新增 11 件 = assembly 10 + cli 1；拆分净增 6 件 = control +2、evolve +4；拆到子目录后仍按「件」计，明细见 §6.7）。assembly 10 件新增 = `api-assemble`/`intent-ingress`/`intent-receipts`/`serve-secrets`/`spec-assemble`/`auth-assemble`/`auth-credentials`/`migrate-assemble`/`stdio-broker`/`platform-binding`。**现有件数为实测，目标件数为规划，不得混写成「已有 42 件」。**

〔总口径〕测试绿只证明当前项目回归；**不证明**真机、跨实现、并发或安全边界（81-§四）。夹具与 fake 一律不得转生产。`test/` 不进根 `typecheck`（79-D10）——这是门禁缺口，不是「测试不受尺寸约束」。

### 6.1 `test/assembly`（6 件，1085 行）

| 文件（行） | 覆盖与正反 | 不证明 |
|---|---|---|
| `inflight-takeover.test.ts`（123） | 在途接管：孤儿收口、多孤儿、二次接管幂等、零孤儿 no-op、预算面零接触（正：收口计数；反：已收口行不动） | 不证明真平台回执或跨进程接管 |
| `serve-channels.test.ts`（216） | matrixChannels 配置面（缺省/缺键 fail-fast/工厂注入/坏值）+ 供给面工厂注入（开而未注入=CONFIG_INVALID、ensure 拒绝不阻循环、关=零调用） | 不证明真 Matrix 网络 ensure |
| `serve-config.test.ts`（279） | platform: taiga 十二条（含凭据 fail-closed 只报键名）+ hrSync 九条 + 队列键 + judgeSites + 模型档 | 不证明真 Taiga 连接 |
| `serve-hrmatrix.test.ts`（129） | hrMatrix 装配三态（注入通过/开而未注入拒/关时注入被忽略） | 不证明 HR 真执行面 |
| `serve-notify.test.ts`（150） | notifyBroadcast：不注入零装配、注入中继+计量、零事件零计量 | 不证明真 IM 送达 |
| `serve-tier.test.ts`（188） | modelTierTickets 解析正反 + 三档位注册与镜像漂移拒启动 | 不证明模型真实价目 |

### 6.2 `test/cli`（9 件，1038 行）

| 文件（行） | 覆盖与正反 | 不证明 |
|---|---|---|
| `create-serve-face.test.ts`（106） | 骨架往返解析、真 bin 落盘/kept/dry-run、SECTION.serve 样例 | 不证明 daemon 可长期运行 |
| `help-face.test.ts`（229） | 单一文档源对账、suggestNear、wantsHelp、七态矩阵、内联旗标 | 不证明终端渲染或 i18n |
| `industry-templates.e2e.test.ts`（231） | 模板可装可跑（一单 DISPATCH→GATE_PASS 四要件），真 spawn + simple-git | 不证明真 dsh/真平台/真闸门 |
| `jobs-cli.test.ts`（108） | jobs list 全字段、catchup 只挪槽、库不存在拒收、缺参退码 | 不证明调度器长期行为 |
| `next-steps.test.ts`（119） | 四命令下一步指引全真实可跑、`--json` 机读面、库不存在指路 | 不证明指引步骤在用户环境全可行 |
| `overview-reports-scan.test.ts`（54） | 报表目录递归扫描、占位件过滤、目录缺失降级 | 不证明概览 HTTP 面 |
| `structure-check.test.ts`（77） | company check 正/负/旗标拒收/别名弃用告警 | 不证明全规则集 |
| `taiga-cure.test.ts`（48） | 四条配置守门（非 taiga/缺事实源/非法 JSON/缺参） | 不证明真根治执行 |
| `usage-contract.test.ts`（66） | USAGE_TAIL 四声明被行为兑现；退码 0/1/2 抽样；旗标两式同效 | 不证明所有命令的退码 |

### 6.3 `test/control`（2 件，1319 行）

| 文件（行） | 覆盖与正反 | 不证明 |
|---|---|---|
| `hot-reload.test.ts`（930，基线） | 指纹面、自动重载（在途单不受扰）、增员增岗、坏配置拒载与修复自愈、手动通道幂等、serve 接线 | 不证明真网络文件系统 mtime 抖动、跨进程通道 |
| `stop-channel.test.ts`（389） | 协议原子性/幂等/回执按 id 匹配/坏 JSON/消费改名/spawn 冒烟/重启失忆 | 不证明多 daemon 并发停机 |

### 6.4 `test/evolve`（6 件，3356 行）

| 文件（行） | 覆盖与正反 | 不证明 |
|---|---|---|
| `cutover.test.ts`（561） | 双闸（状态/判负）、全链、五种失败回滚、CLI 面 | 不证明重启后加载（v0 不重启） |
| `evolution-e2e.test.ts`（652，基线） | 四场景（批准链/判据类 escalate/谱系换代/判负负面）+ 只读列表 | 不证明真平台与真闸门 |
| `evolve-guard.test.ts`（413） | authorize 透传 nearMisses、retired 仍拒、启动自检三态 + serve 接线 | 不证明验收独立性（U80-07） |
| `gray.test.ts`（625，基线） | 纯逻辑判定边界、开窗前置、cutover 接线、检查三态与自动回滚、手动关窗、CLI | 不证明 tick 驱动的自动观察 |
| `postmortem.test.ts`（516） | 模板七节、追责哨兵双保险、形状闸、案例库命名、断路器关联、全链、CLI | 不证明复盘质量 |
| `sandbox.test.ts`（589） | tmp 隔离零触碰、最小集、路径逃逸拒、超时杀、分类、报告形状、CLI 链 | 不证明真机资源隔离（cgroup/网络） |

### 6.5 `test/` 根级跨包对齐（2 件，271 行）

| 文件（行） | 覆盖与正反 | 归属与不证明 |
|---|---|---|
| `panel-inbox-align.test.ts`（73） | panel `compareInboxRows` 与 core `compareQueueEntries` 的全序逐对一致（129-§6.2 R2/R5） | 落点登记在此，读面契约细则归 13-panel；不证明 HTTP 输出 |
| `panel-judge-align.test.ts`（198） | 事件构造器 ↔ panel 解析器 round-trip、panel 重放 ≡ core 熔断折叠（160-§6.5） | 同上；不证明 SSE 真流 |

〔结论〕两件根级测试**不是** assembly/cli/control/evolve 的对应测试，落点只因 `daemon→panel`/`daemon→core` 是合法边且 panel 运行面禁止 `panel→core`。若 16/13 附录另立条目，以一处展开、另一处只写落点，避免双份契约。

### 6.6 测试基建与排除

- `apps/daemon/test/` 无共享 fixture 目录；各测试自建 tmp（`node:os.tmpdir()` + 清理）。
- `test/engine/crash-points.ts` 是崩溃注入点定义（非测试），归 16。
- 全仓测试运行器 `vitest`（`bun run test`）；本附录未执行全量测试，证据边界见 §八.3。

### 6.7 目标新增与拆分测试（**未落盘**，只给契约）

〔口径〕本节全部是**目标**，不得计入现有 25 件；每件给「覆盖与正反 / 不证明」两格。落库时必须先有实现（§四对应 F-ID），不得先写测试再倒推实现。表内共 20 行：11 件新增（assembly 10 + cli 1）+ 3 组拆分（`hot-reload` 1→3、`gray` 1→2、`evolution-e2e` 1→4），净增 17 件。

| 目标文件 | 归属实现件 | 覆盖与正反 | 不证明 |
|---|---|---|---|
| `test/assembly/api-assemble.test.ts` | `F-daemon-api-assemble` | 两态互斥（关=不监听且日志明写；开=缺 ingress/只读台账/token/配额/TTL 任一 ⇒ 整机 `CONFIG_INVALID` 非零退出）；**投影启动序**（`receipts.rebuild()` 失败 ⇒ 非零退出且无监听；重建完成前无 `receipt()` 可服务；`replayQueued()` 只在重建后跑）；转发面（`emitIntent`/`getIntentReceipt` 原样转 ingress，不触 engine；`getIntentReceipt` 读已提交快照、`undefined` 只表示快照无该键）；**`GET /v1/requests/status` 三组**（正：202 后同键查询 `200` + 同 `intentRef` + 无 `outcome`，判定后 `decided` + `outcome` + `intakeRecordRef`；反：快照无键 ⇒ `503 receipt-not-in-snapshot`、**不 404/不 200 空体/不查库**，参数越界 `422`，拼错路径 `404 not-found`；不重放：连查 3 次无新 `REC-WORK-01`）；只读打开（`query_only=1`、启动前后 `user_version` 与表集合不变；打开失败原样上抛 `db-missing`/`schema-behind`/`schema-ahead`，不改写 `CONFIG_INVALID`；`issuesView`/`finance` 的 `Err` ⇒ `500` 且原样透传，不吞成空数组/`unknown`）；**请求体超限 413**（`bodyLimitBytes=100_000`，不落 `REC-WORK-01`）；未挂载公司 422 | 不证明 16 条路由逐条（80-§9.4 **M4 十一项**另证）、不证明真实浏览器缓存行为 |
| `test/assembly/intent-ingress.test.ts` | `F-daemon-intent-ingress` | 顺序（`reserve` 的**同一写事务**内 projection hook 写表 → commit 后同微任务刷快照 → `engine.ingest`：断言 `REC-WORK-01` 先于入队、hook 回滚时表无行）；**重投判定按记录现算**（`refresh(key)` 或直读记录，断言**不**调用 `get()`）；四态重投（decided 不入队 / queued 重投入队 / unknown 不重放且 `duplicate:true` / 窗内异摘要 409）；TTL 三行；`replayQueued()` 只由 `buildServeRuntime` 调、扫 `status:'queued'` 且 `unknown-link-missing` 不在集合、返回重放条数；负向：来源不在白名单 403、未挂载公司/`dedupKey` 空/结构错 422、`body` 超限 413 `body-too-large` | 不证明相位 2 受理结论、平台落单（U80-15） |
| `test/assembly/intent-receipts.test.ts` | `F-daemon-intent-receipt-store` | 三态判据逐条；键还原公式四位（与 `intentKeyOf` 逐位比对）；同键多条取 `receivedAt` 最大；`rebuild()` 返回 `TableProjectionResult`（`kind:'table'`、`name:'intentReceipts'`、`rows`=本次处理行数、`cursor=null`）且删表重建逐字段一致（含 0 行）；`get()` 读**内存快照**（库不可读时仍返快照，不变成 `undefined`）、`refresh()` 同场景返 `Err(unavailable/STALL)`；`#4` 缺链保持 `unknown` 且不重放；负向：必填子键缺失 ⇒ `gap:'intake-link-missing'` 且拒出回执 | 不证明多进程并发重建、崩溃四注入点（U80-19） |
| `test/assembly/serve-secrets.test.ts` | `F-daemon-runtime-secrets` | 三态（`empty` 合法 / `partial` 必需缺失拒启 / `partial` 可选缺失上报 `missingSecretIds` 并由 `buildServeRuntime` 落 `REC-LOSS-01`）；`use ∉ allowedUses` ⇒ `rejected_forbidden` 且不返回值；**关闭能力零 `load` 调用**（spy 计次）；`hrKnownSecrets` 与 catalog 并存时以 catalog 为准并告警；`secretIds` 不含值；`matrixSessionFactory` 路径下 **boot 零登录**、句柄校验不符即拒启 | 不证明 78 部署侧 catalog、真 homeserver 登录与轮换（U80-17/U80-18） |
| `test/assembly/spec-assemble.test.ts` | `F-daemon-spec-assemble` | 读盘正例（多文件、稳定顺序、报告计数）；负向：缺文件、不可读、路径穿越（`..`/绝对路径/符号链接逃逸）⇒ `spec-path-escape`/`spec-file-missing`；包清单与实际文件不符 ⇒ 拒；空目录 ⇒ 合法空报告；重跑幂等（同输入同报告） | 不证明导入六步纯逻辑（归 `core/src/spec/` 单测）、不证明端口已实现（80-§6.0） |
| `test/assembly/auth-assemble.test.ts` | `F-daemon-auth-assemble` | 无激活记录 ⇒ 该端点不可写；**端口活着但无激活不产生候选**；授予链断点 ⇒ `grant-chain-broken`；撤回后快照不含该端点；只读台账路径下不发写语句；schema 不符原样上抛 | 不证明真实授权生效（`RUN-AUTH-*` 另证）、不证明 gateway 行为 |
| `test/assembly/auth-credentials.test.ts` | `F-daemon-auth-credentials` | 登记→解析→吊销→解析不可用；同引用摘要再登记只产一条记录（幂等）；吊销幂等；**值入目录即 `rejected_forbidden`**（正反各一）；未知引用 `unsupported`（不是 `undefined`）；过期/已吊销 ⇒ `rejected_authority`；**返回的 `CredentialRef` 不含任何秘密原值**（结构断言 + 序列化扫描）；`register`/`revoke` 单事务（失败无半行） | 不证明真实授权生效（`RUN-AUTH-*`）、不证明部署侧 `secretId` 轮换 |
| `test/assembly/migrate-assemble.test.ts` | `F-daemon-migrate-assemble` | 双实例抢锁只有一胜（`conflict`+`EXTERNAL_REJECT`）；`dryRun` 不改库（启动前后 `user_version`/表集合一致）；不可逆且无快照 ⇒ `rejected_forbidden`；崩溃后重启可续（按 `REC-MIG-01` 已完成步）；`proofRef` 落记录；投影面只登记 `resourceLedger`（表未建前不出现运行期 `name`） | 不证明真实数据迁移正确性（归 `store` 迁移测试）、不证明多机并发 |
| `test/assembly/platform-binding.test.ts` | `F-daemon-platform-binding` | 20 字段齐（缺项即不完整）、无损失 `losses:[]` 显式、已映射态 `verified`；**未映射合法值 ⇒ `Ok(unverified)` + `workStates:[]`，`mapState` 本身不写记录**（**不是** `Err`，也不是本地默认态）；空/畸形原值 ⇒ `Err(rejected_precondition)`；`STAT-E` 映射 ⇒ 缺陷；`exportBundle` 范围外 ⇒ `rejected_forbidden`、`includesOpenObligations=false` 不得称完整；`describe`/`exitPlan` 幂等；**消费侧断言**：`unverified`/空 `workStates` 不被迁移、验收、结清采用（停在原地），且 `REC-OBS-02` 由消费方写一条（同一单/原值/拍不重复） | 不证明真平台状态族与 78 部署面；不证明 `wire.ts` 的能力面（另一件） |
| `test/assembly/stdio-broker.test.ts` | `F-daemon-stdio-broker` | 注册三帧正例与乱序/多余键/超长帧反例；challenge 重用、过期、跨连接挪用皆拒；proof 错（含 JCS 五键改一字节/异长）⇒ `ok:false` 并断连；未注册 `call` 一律 `deny` 且不触达 `EffectGateway`；吊销后拒；socket 目录 `0700`/文件 `0600`/`lstat` 拒符号链接；**`PeerCredentialVerifier` 缺省 `none` ⇒ `unverified`、他 uid ⇒ 仍 `unverified`、仅 `host-bound` + 同 uid 才 `peer-verified`**；`stdout` 只含帧、日志走 stderr；`verdict` 不含平台原文 | 不证明真实 worker 端到端、`verifySealed` 与共享 `WkeyAuthority`、宿主 peer 适配（U80-17） |
| `test/cli/readonly-open.test.ts` | `F-daemon-cli-candidates`/`-jobs`/`-ledger` | 三个读命令改只读后：库不存在 ⇒ `db-missing` 退 1、schema 过新 ⇒ `schema-ahead` 退 1、启动前后库文件 mtime/表集合不变；打开路径一律 `packages/store/src/ledger/open.ts` | 不证明写命令（W-11 未裁决） |
| `test/control/hot-reload/hot-reload-fingerprint.test.ts`（拆自 `hot-reload.test.ts`） | `F-daemon-hot-reload-fingerprint` | 指纹面：字段集、稳定序、敏感面变更必变 | 不证明真 fs mtime 抖动 |
| `test/control/hot-reload/hot-reload-auto.test.ts`（拆） | `F-daemon-hot-reload-execute` | 增员增岗、坏配置拒载与修复自愈、在途单不受扰 | 不证明跨进程通道 |
| `test/control/hot-reload/hot-reload-manual.test.ts`（拆） | `F-daemon-hot-reload-channel` | 手动通道幂等、按 id 匹配、坏 JSON 拒 | 不证明 CLI 侧 |
| `test/evolve/gray-logic.test.ts`（拆自 `gray.test.ts`） | `F-daemon-gray` | 纯逻辑判定边界、开窗前置、关窗不回滚 | 不证明 tick 驱动自动观察 |
| `test/evolve/gray.io.test.ts`（拆） | `F-daemon-gray` | 三态检查与自动回滚、回滚后幂等、备份缺失拒面、CLI | 不证明真文件系统崩溃恢复 |
| `test/evolve/evolution-approve.e2e.test.ts`（拆自 `evolution-e2e.test.ts`） | `F-daemon-cutover` | 批准链四要件与判负负面 | 不证明真平台与真闸门 |
| `test/evolve/evolution-escalate.e2e.test.ts`（拆） | `F-daemon-cutover` | 判据类 escalate 分支 | 同上 |
| `test/evolve/evolution-lineage.e2e.test.ts`（拆） | `F-daemon-cutover` | 谱系换代、只读列表一致 | 同上 |
| `test/evolve/evolution-negative.e2e.test.ts`（拆） | `F-daemon-cutover` | 失败/回滚/拒绝面 | 同上 |

〔计数〕上表 20 行 **不**等于 20 件新增：新增 11 件（assembly 10：`api-assemble`/`intent-ingress`/`intent-receipts`/`serve-secrets`/`spec-assemble`/`auth-assemble`/`auth-credentials`/`migrate-assemble`/`stdio-broker`/`platform-binding`；cli 1：`readonly-open`），拆分行只改件数不改能力（`hot-reload` 1→3 净 +2、`gray` 1→2 净 +1、`evolution-e2e` 1→4 净 +3）；25 + 11 + 6 = 42。拆分后的文件名与 §7.1 的超限拆分表**逐字一致**，不得两处各起一套名。

---

## 七、规模、拆分与迁移清单

### 7.1 超限件（本附录范围，全部**只许下降**）

| 文件 | 实测 | 基线 | 目标 | 拆分后文件与预算 |
|---|---|---|---|---|
| `src/assembly/serve.ts` | 1627 | 1627 | ≤ 250 | `serveconfig/serve-config.ts` ≤300、`serveconfig/parse.ts` ≤120、`serveconfig/coerce.ts` ≤600、`runtime/build.ts` ≤600、`runtime/keys.ts` ≤150、`runtime/demo.ts` ≤100 |
| `src/control/hot-reload.ts` | 624 | 624 | ≤ 150 | `hot-reload/fingerprint.ts` ≤350、`channel.ts` ≤250、`execute.ts` ≤400、`event.ts` ≤200 |
| `test/control/hot-reload.test.ts` | 930 | 930 | ≤ 600 | 按域拆三件：`hot-reload-fingerprint.test.ts`、`hot-reload-auto.test.ts`、`hot-reload-manual.test.ts`（均在 `test/control/` 直下→会撞 25 上限，故目标落 `test/control/hot-reload/` 子目录） |
| `test/evolve/evolution-e2e.test.ts` | 652 | 652 | ≤ 600 | 按场景拆 `evolution-approve.e2e.test.ts` / `evolution-escalate.e2e.test.ts` / `evolution-lineage.e2e.test.ts` / `evolution-negative.e2e.test.ts` |
| `test/evolve/gray.test.ts` | 625 | 625 | ≤ 600 | 拆 `gray-logic.test.ts`（纯判定）与 `gray.io.test.ts`（开窗/检查/CLI） |

〔结论〕`src/evolve` 三件已在 550/570/590 的高位（余量 50/30/10）：**不得再长**；触线时拆 `gray/{window,judge,rollback,render}.ts` 或 `postmortem/{template,casebook,chain}.ts`，新增件进子目录（不占 evolve 直下 5 的平面）。

〔目标新增件的行预算（同受 600 硬阈，给出设计上限以便拆前自查）〕

| 目标文件 | 预算 | 依据 |
|---|---|---|
| `assembly/api/assemble.ts` | ≤ 300 | §四.2 `F-daemon-api-assemble` |
| `assembly/intent/ingress.ts` | ≤ 260 | `F-daemon-intent-ingress`（四态重投 + 重放，行数最紧） |
| `assembly/intent/receipt-store.ts` | ≤ 220 | `F-daemon-intent-receipt-store` |
| `assembly/runtime/secrets.ts` | ≤ 120 | `F-daemon-runtime-secrets` |
| `assembly/platform/binding.ts` | ≤ 220 | `F-daemon-platform-binding`（四方法纯映射，无 IO） |
| `assembly/serveconfig/*` 四件 | ≤ 120/300/600/150 | 见上表 serve 行 |
| `assembly/runtime/build.ts` / `keys.ts` / `demo.ts` | ≤ 600 / 150 / 100 | 同上 |
| `control/hot-reload/*` 四件 | ≤ 350 / 250 / 400 / 200 | 见上表 hot-reload 行 |

〔纪律〕预算值只在**拆分落地后**写入 `boundary-rules.mjs` 的基线；本文的预算是设计约束，不是既成基线，不得据此声称「已达标」。

〔结论〕上表所有目标值**只降不升**；任何上调或新增基线须提案流 + 制作人批（`boundary-rules.mjs` 注释）。

### 7.2 目录预算结论

| 目录 | 现有直下件 | 上限 | 目标后 | 说明 |
|---|---|---|---|---|
| `src/assembly/` | 1 | 1（基线） | 1 | 新件全进 `serveconfig/`、`runtime/`、`api/`、`intent/`、`spec/`、`auth/`、`migrate/`、`stdio/` 子目录；`platform/` 为既有子目录（`wire.ts` + 新增 `binding.ts`）（子域不计直下） |
| `src/control/` | 2 | 2（基线） | 2 | 新件进 `hot-reload/` 子目录 |
| `src/evolve/` | 5 | 5（基线） | 5 | 顶格，新增面必须开子目录 |
| `src/cli/` | 22 | 25 | 22→21（`external` 退役） | 余 3；到 24 时先合并 `help`/`usage`（80-§10.7） |
| `src/` 根 | 1（`index.ts`） | 1 | 0（退役后，须改基线） | 提案流 |
| `test/assembly` `test/cli` `test/control` `test/evolve` | 6 / 9 / 2 / 6 | 25 | 16 / 10 / 4 / 10 | 目标值含新增 11 件与拆分；**直下计数**：`test/assembly` 16（原 6 + assembly 新件 10）、`test/cli` 10（+`readonly-open`）、`test/control` 1 直下（`stop-channel`）+ `hot-reload/` 3、`test/evolve` 10 — 全部 ≤ 25 |

〔结论〕新增 CLI 命令的三条硬约束（80-§10.7）：一命令一模块；到 24 先合并同族薄壳；不得把命令实现塞进 `main.ts` 的 `switch`。

### 7.3 迁移顺序总表（跨文件，不可倒）

| 序 | 动作 | 前置 | 门禁 |
|---|---|---|---|
| M-a | `package.json` 删 `main`/`exports["."]`；根 `"daemon"` 与 `scripts.start` 改指 `cli/main.ts serve`；依赖分类归正（execa/zod 删、simple-git→dev） | 无 | `bun run typecheck`、`bun run guard:boundaries` |
| M-b | `index.ts` 收敛为纯再导出 | M-a | 同上 |
| M-c | `serve.ts` 拆 config（`serveconfig/`） | 无（可先于 M-a） | 拆分后行数只降；测试全绿 |
| M-d | `serve.ts` 拆 runtime（`runtime/`） | M-c | 同上 |
| M-e | `hot-reload.ts` 拆四件 + facade | 无 | 同上 |
| M-f | `RunServeOpts` 补 `notifyBroadcast` + `matrixSessionFactory`（仅此两键）+ 三处收口 + `runServe` 收判别联合 `{configPath}\|{config}` | M-c/M-d | `typecheck`；boot 改走 `@studio-next/daemon/serve` |
| M-g | `external` 键族入 `ServeConfig`；`assembly/api/assemble.ts` 装配（80-§9.4 M3） | M-d + D12 只读打开 | M4 **十项**验证 |
| M-h | `cli/external.ts` 退役；`panel/src/external/` 删除（M5） | M-g + M4 全绿 | 破坏性，须批示 + 82 波次 |
| M-i | `index.ts` 退役（根平面清空） | 全仓零包根 import | 改 `daemonSrcRootFiles` 基线（提案流） |
| M-j | `assembly/intent/`（`ingress.ts` + `receipt-store.ts`）落地，`buildServeRuntime` 第 6 步创建；**projection hook 与 `WorkIntake.reserve` 同事务、commit 后同微任务刷快照**；**`receipts.rebuild()` → `replayQueued()` → API 装配**顺序写死 | 01-contract 的 `ports/intent.ts`、03-store 的投影（`src/migrations/intent.ts` + `src/ledger/intent-receipts.ts`）与 `REC-WORK-01` 写口 | 四态/TTL/重放测试（§6.7）；`rebuild` 失败拒启的负向用例 |
| M-k | `assembly/runtime/secrets.ts` 落地（秘密面 + 会话面），`KnownSecretSet` 与 `matrixSessionFactory` 登录句柄进 `buildServeRuntime`；`hrsync/assemble.ts` 改消费它；`ServeConfig.secrets` 三键入 `coerce`（**不加** `secretProvider` 注入键） | M-d + 01-contract 的 `ports/secret.ts` + 80-§3.4 第 10 条工厂 | `known-set-*` 三态测试；boot 零登录断言 |
| M-l | 读面改只读：`assembly/api/assemble.ts` 的 `issuesView` 用 `openLedgerReadonly`（`packages/store/src/ledger/open.ts`）；三处 CLI 读命令切只读 | D12（只读打开不跑 DDL）+ 03-store 的 `ledger/open.ts`（旧 `open-readonly.ts` 名作废） | `query_only=1`、启动前后 schema 不变 |
| M-m | CLI 读面切换完成后，写命令开库口径按 W-11 裁决落地（**未裁决前不执行**） | W-11 由 80/03/82 裁决 | 裁决后补 `guard:boundaries` 与 CLI 测试 |
| M-n | `assembly/spec/assemble.ts` 落地（`SPEC-01/02/03` 读盘与包扫描） | 01-contract `ports/spec.ts`、02-core `core/src/spec/` | spec-assemble 测试 + `typecheck`/`guard` 绿 |
| M-o | `assembly/auth/assemble.ts` 落地（`AUTH-01…07` 备选端点与激活快照） | 01-contract `ports/authority.ts`、02-core `core/src/authority/`、03-store `lease/` | auth-assemble 测试；只读台账不发写语句 |
| M-p | `assembly/migrate/assemble.ts` 落地（维护窗口编排） | 01-contract `ports/migration.ts`、`store/src/migrations/`、`openLedgerMaintenance` | migrate-assemble 测试（抢锁/干跑/不可逆） |
| M-q | `assembly/stdio/broker.ts` 落地（challenge-proof 注册 + `call`/`verdict`） | `packages/gateway` 的 `verifySealed`/`encodeAction`/`decodeAction`、进程内共享 `WkeyAuthority` | stdio-broker 测试 + socket 权限负向探针（U80-17） |
| M-r | `assembly/auth/credentials.ts` 落地（`AUTH-06` 凭据目录：`register`/`resolve`/`revoke`，**只编排**；持久面调 store 原语，只存 `REC-AUTH-04` 引用） | 76 `REC-AUTH-04` 字段表、`contract/src/ports/authority.ts` 的 `AUTH-06` 类型、**03-store `store/src/records/credentials.ts`**（`F-store-records-credentials` 已登记，**文件未建**，故该项须先落） | auth-credentials 测试（值入目录即拒、幂等）+ `typecheck`/`guard` 绿 |
| M-s | `assembly/platform/binding.ts` 落地（`PlatformBindingPort` 唯一宿主：`describe`/`mapState`/`exportBundle`/`exitPlan`，纯映射零 IO） | `contract/src/ports/binding.ts` 的端口类型可引（W-12 已关闭，**文件未建**）、78-§1.2 二十字段表、`REC-LOSS-01` 字段表（`REC-OBS-02` 归消费方） | platform-binding 测试（`unverified` 仍 `Ok`、`STAT-E` 判缺陷、消费侧不采用）+ `typecheck`/`guard` 绿 |

〔结论〕M-c/M-d/M-e 是**纯移动**：不得顺带改语义、不得改导出面、不得新增顶层端口（81-§3.2）。每一步之后 `guard:boundaries` 必须仍绿。

〔结论〕M-g（API 装配）**依赖 M-j/M-k/M-l 的产物**，但**次序不可倒**：ingress 先于 api（第 6 步先于第 7 步），只读打开先于 api 的 `issuesView`。M-l 未完成就上 M-g ⇒ M3 的「只读」是假的（80-§9.4 已判）。M-n…M-s 与 serve 拆分**无强序**（可各自独立开工），但三条硬前置：M-q 依赖 `packages/gateway` 的 `verifySealed` 与共享 `WkeyAuthority`；M-o/M-p 依赖 03-store 的 `lease/` 与 `openLedgerMaintenance`；M-r 依赖 03-store 的 `store/src/records/credentials.ts`（`REC-AUTH-04` 持久原语，03 已登记 **`F-store-records-credentials`、文件未建**）；M-s 依赖 `contract/src/ports/binding.ts` 的端口类型（W-12 已关闭，**文件未建**）。各步都**不得**塞进 serve 主循环。

---

## 八、未证、未做与回写清单

### 8.1 需回写上级卷的事实差（本附录实测）

| 编号 | 事实 | 冲突对象 | 建议回写 |
|---|---|---|---|
| W-1 | 分类错误覆盖不均：`evolve/**` 45 处 `configInvalid`；`assembly/**` 仅 2 处（`serve.ts:1040/:1054`），其余裸 `Error` + `CONFIG_INVALID：` 文案前缀；`control/**` 0 处；`cli/**` 0 处 | 79-§3.4（错误模型）、80-§3.3（parseDaemonConfig 待修） | 80 增一张「各域分类错误覆盖表」，逐件给目标 `subcause` |
| W-2 | CLI **12 件**直接 import `node:fs` | 79-§3.5 ⑥（fs 白名单不含 cli） | 79 二选一写死：把 cli 纳入白名单，或给「CLI IO 下沉到包」的迁移路径 |
| W-3 | `evolve/sandbox.ts` 是 `src` 内唯一 `node:child_process`（spawn） | 79-§3.5 ⑤（只列适配器与 assembly） | 79 明确「沙箱执行面是合法例外」，否则 82 判负口径不一致 |
| W-4 | 时间注入缺口：`stop-channel.awaitStopResult`、`cli/reload`/`cli/stop` 轮询、`serve.ts:1476` 在途接管均用裸 `Date.now()` | 79-§3.5 ①（业务判定只接受注入时钟） | 79/80 登记为待收口项（接管行的时钟影响重派时序语义） |
| W-5 | 「control/evolve/engine 三域不互引」无机械门禁（三域同为层位 3，同层互引不被拦） | 81-§5.4、20-§十五 | 20/`boundary-rules.mjs` 增同层反向静态边规则（判据类资产修订） |
| W-6 | `ServeConfig` 无 `external` 键族；`:8788` 仍由 `cli/external` + `panel/external` 提供；`panel/external/server.ts:487/:491` 两处落单写台账越界 | 80-§3.3 第 5 条、§9.4 | 80 已定，无需改；本附录只登记「未做」与迁移序 M-g/M-h |
| W-7 | CLI `openLedger` 调用点实测 **9 处**（`jobs` 有 list/catchup 两处），80-§12.5 记「CLI 8」 | 80-§12.5 U80-16 | 回写 80 的计数（14 处开库点的分解随之 +1） |
| W-8 | `RunServeOpts` **现状**仅三键（缺 `notifyBroadcast`/`matrixSessionFactory`，§8.1 旧记仍成立）；`runServe` 第二参（4 键内联）与 `buildServeRuntime` 第三参（9 键内联）类型身份重复；boot 预解析 + `runServe` 再解析同一 YAML | 80-§3.4 | **部分收窄（v0.3）**：80 已给五键、判别联合与 `BuildRuntimeOpts` 原文清单，本卷已按之写全 `F-daemon-run-serve-opts`，并把三处收口点与 M-f 写死；**代码未改**，W-8 只剩「未落码」 |
| W-9 | 79-§10.1 **第 7 项只列 `api`/`yt`**（`79:1349`），把 `@studio-next/prompt` 一并称作「休眠边」的是 `scripts/guards/boundary-rules.mjs:100` 的注释与 `79:1355` 的〔事实〕；但 `engine/prompt-assembly.ts:35-39` 实际 import prompt（`allowedPackageEdges` 已有 `["daemon","prompt"]`，`:109`） | 79-§10.1、`boundary-rules.mjs:100` | 回写：`api`/`yt` 为零 import（休眠），**`daemon→prompt` 是在用边**；注释与 79:1355 的口径同步改（否则与 §2.3 的「在用」登记矛盾） |
| W-10 | 本附录范围内的 `assembly/**` 无 `configInvalid` 之外的分类出口（`wireRoomFace`、`wirePlatform`、`hrsync/assemble` 均裸 `Error`） | 79-§3.4 | 与 W-1 合并处理 |
| W-10a | **fake 可从生产配置选中**：`wirePlatform`（`assembly/platform/wire.ts:129-:146`）对 `platform: 'fake'` 直接返回 `createFakePlatform()`，且 `agentYaml` 缺省时走 fake executor | 81-§3.1（fake 只归测试/演示）、80-§3.3 | 80 明确 `platform:'fake'` 的判据（建议：仅 `realGateMode=false` 可选，生产出现即 `CONFIG_INVALID`） |
| W-11 | **CLI 写命令的开库口径未定义**：`company add/create`、`jobs catchup`、`cutover`、`gray --check/--close`、`postmortem`、`sandbox` 七处写面仍用 `openLedger`（无条件 migrate）；80-§8.2 只给了读面 `openLedgerReadonly` 与维护面 `openLedgerMaintenance` | 80-§8.2 D12、03-store | 80/03/82 裁决「写命令 = 写意图 + 单实例锁 + 离线窗口」的具体签名；**裁决前不得由 81 自行发明第三种打开方式** |
| W-12 | `PlatformBindingPort` 的**类型文件落点**：80-§6.9 已给端口全文，但 §12.3 的新文件清单仍只有 `intent.ts`/`secret.ts` | 80-§6.6、§12.3、78-§1.2 | **已关闭（v0.6）**：80-§6.6 BIND-01 三层归属与 D27 已定——类型唯一源 `packages/contract/src/ports/binding.ts`（01-contract）、宿主唯一 `apps/daemon/src/assembly/platform/binding.ts`（`F-daemon-platform-binding`）、平台包 `src/binding.ts` 只供三个纯函数，**禁第二实现**。旧「建议 `contract/src/ports/platform-binding.ts`」作废；类型文件**未建** |
| W-13 | **stdio 服务端的 daemon 侧落点**：80-§11.4.1 定了 socket 路径与协议，但**未给文件落点**（U80-17 未实现） | 80-§11.4.1、§6.9、§12.3 | **部分收窄（v0.3）**：本卷已定落点 `apps/daemon/src/assembly/stdio/broker.ts`（`F-daemon-stdio-broker`），并声明 `node:net` 全卷仅此一处；80-§6.9 端口表/§12.3 仍可登记该路径。**不改 80 协议**；实现未落 |
| W-14 | `intent_receipts` 的 **`expectedSchemaVersion` 常量来源**：`openLedgerReadonly` 要求版本，但常量归谁一度未定 | 03-store、80-§8.2 | **收窄（v0.3）**：03-store 已定 `src/ledger/open.ts` 为唯一打开落点、`intent_receipts` 为 v14，并保留 `migrations.ts` facade 再导出 `LATEST_VERSION`。装配体**只引用**该导出，不得硬编码数字。残余未定：`openLedgerReadonly` 是自己取常量还是要求调用方传——03 未写死，登记给 03 |
| W-15 | `NotificationEnvelope` 字段名：80 现场为 **`notificationId`**（`80-§6.6` 代码块） | 80-§6.6 | **已关闭**：80 已定名，本卷照写（`notificationId`）——无回写、无待办 |
| W-16 | 79-§10.1 第 7 项把 `api` 记为「休眠边」，但 M3 后 `daemon→api` 是**真实调用** | 79-§10.1、80-§9.4 | M3 落地时同步改 79 的口径（休眠 → 在用），否则依赖裁决表自相矛盾 |
| W-17 | `Money.usd: number` 不进公共签名：本卷 `notify`/`cost` 路径若把金额塞进通知/事件，会重现精度债 | 80-§4.1 `TS-SCALAR-09`、§8.2 D17、76 的 `Money` | **已关闭**：80 已裁「`Money.usd` 只作内存计算与旧记录兼容，不得进公共签名/API 响应/记录契约；公共金额一律 `DecimalString` + 显式币种」；本卷通知/事件照此只传格式化字符串或 `{ amount: DecimalString; currency }` |
| W-18 | `SecretProvider` 注入点 | 80-§3.4、§11.2.1 | **已关闭（v0.3）**：80-§3.4 第 8 条已裁「**不新增** `BuildRuntimeOpts.secretProvider`，也不新增任何『值是秘密』的注入项」，秘密由 daemon 内部按 `ServeConfig.secrets` 装配（provider → `SecretMaterial[]` → `KnownSecretSet`）。本卷照此写 `F-daemon-runtime-secrets`，不再留「调用点留空」 |
| W-19 | **跨卷命名与过期指控**（旧记：他卷用 `F-contract-ports-*`/`F-daemon-assembly-*`、称 17 仍写 `deps:{engine;db;…}` + `openLedgerReadOnly(db)`） | 03-store、04-company | **已关闭（v0.3）**：03-store 现已统一为 `F-contract-port-intent`/`F-contract-port-secret`/`F-daemon-intent-*`/`F-daemon-api-assemble`，并在 `:352` 明言 `src/ledger/open.ts` 是唯一打开落点、旧双名作废且「17 侧该行须回改」；04-company 的 D24/§九 已把两处过期指控撤回。本卷不再持有该口径，旧记仅作关闭记录 |
| W-20 | `TableProjectionResult.rows` 口径 | 80-§6.3/§6.6、03-store（D16） | **已关闭（v0.4）**：80 已写死——`rows`=**本次处理/扫描行数**（不是表总行数），完成态 `cursor` 必须 `null`（有下一页才是 opaque 游标）；0 行合法且**不等于**未运行。投影名口径同步定死：现状 **17** 个 `TableProjectionName`，`TargetTableProjectionName = TableProjectionName \| 'resourceLedger'`（物理表 `resource_ledger`，目标第 18 个，随 MIG-01 建表）；`daemon_kv`/`schema_version`/`hr_sync_log` 不是投影名。本卷不再留「名字未定/口径未定」 |
| W-21 | `SEC-MX-BOT-PASSWORD` 的 `allowedUses` 口径：旧记 80-§11.2.1 表与 §13.1 D23 写三用途并把 `matrix-register` 标「**保留未用**」 | 80-§11.2.1（`80:3288`）、§13.1 D23（`80:3658`）、78-§7.4.1 | **已关闭（v0.6）**：80 现行口径已改**恰两项**——`platform-auth` + `outbound-redaction`，**不得含 `matrix-register`**（请求即 `rejected_forbidden`），「保留未用」作废；`SEC-MX-HR-SHARED` 仍 `matrix-register`+`outbound-redaction`。剩余同步只在 **78**（80-S10，`80:3684`），不属 80 回写 |
| W-22 | `TableProjectionResult.name` 的类型：旧记 80-§6.3 写 `name: TableProjectionName`（17 名），与同节 `TargetTableProjectionName = TableProjectionName \| 'resourceLedger'` 不一致 | 80-§6.3（`80:1220`） | **已关闭（v0.6）**：80 已写 **`name: TargetTableProjectionName`**，本卷照写（目标名**类型上可携带**；表未建前**运行期**仍不得返回 `resourceLedger`）。无回写、无待办 |

### 8.2 需制作人决定（政策项，与工程选择分开）

1. **`index.ts` 退役与根平面清空**：退役后 `daemonSrcRootFiles` 基线需改（判据类资产修订）。
2. **`cli/external` 与 `panel/src/external` 的退役时点**：80-§9.4 已定「M5 最后」，但删除是破坏性变更，须批示 + 82 波次。
3. **CLI 的 fs 面归属**（W-2 二选一）与**沙箱 spawn 例外**（W-3）：两者都改变依赖清单/判负口径。
4. **同层反向边机械门禁**（W-5）：判据类资产新增。
5. **evolve 高位件是否预先拆分**：`gray` 550 / `postmortem` 590 / `sandbox` 570 均未触线；本附录不预先拆（无超限证据时拆分=无收益的移动），触线时按 §7.1 执行。
6. **`platform: 'fake'` 能否在生产配置里被选中**（W-10a）：81-§3.1 判「fake 只归测试/演示」，但现状可从生产 `daemon.yaml` 选中。收窄判据会改变现有配置的合法性面（可能让已有部署拒启），须制作人定「直接拒」还是「告警放行 + 迁移期」。
7. **CLI 写命令开库口径**（W-11）：是「统一 `openLedgerMaintenance` + 离线窗口」还是「写命令也要单实例锁协商」，会改变运维方式（daemon 运行期能否执行 `jobs catchup`），须制作人定。
8. **`test/` 是否进根 `typecheck`**（79-D10 缺口）：纳入会立刻暴露 25 件的类型错误（需一次清理），不纳入则测试面继续不受门禁保护。

### 8.3 未证（技术，不得写成「已支持」）

| 编号 | 未证项 | 本附录范围内的表现 |
|---|---|---|
| U80-09 | `:8788` 迁移后 `panel` 无外部面 | 迁移未做；`cli/external` 与 `panel/external` 仍在 |
| U80-13 | 注入式 API 迁移不改包边 | `assembly/api/assemble.ts` 不存在；80-§2.3 已判 `daemon→api` 为**真实边**（`boundary-rules.mjs:108` 登记、manifest 声明），迁移**不得新增其它包边**；现状 `src`+`test` 仍零 import（事实未变），迁移未做 |
| U80-15 | 外部意图通道（API→daemon） | `emitIntent` 装配未落地；`engine.ingest` 形已存在（`serve.ts:1216/:1554`） |
| U80-16 | 多进程并发迁移 | CLI 9 处 `openLedger` 无条件 migrate；daemon 运行期执行 CLI 写面命令的并发后果未测 |
| U80-17 | stdio 服务端（daemon 侧 `register`/`call` 与验签） | **落点已定**（`assembly/stdio/broker.ts`，W-13 收窄），**未实现**；`src` 无 `node:net`；09 的 worker 侧也未接；JCS 五键 proof、`verifySealed`、共享 `WkeyAuthority`、`PeerCredentialVerifier` 宿主适配与「无适配即 `unverified`」**全部未落码** |
| U80-18 | 秘密供给面 `contract/src/ports/secret.ts` | 全仓无此文件（`packages/contract/src/ports/` 无 `secret.ts`）；现状 env 直读 + `hrKnownSecrets` 字面量；`F-daemon-runtime-secrets` **无**可装配对象 |
| U80-19 | 意图投影重建与启动序（四个崩溃注入点：提交前 / 提交后刷快照前 / 投影写后 / `rebuild` 中途） | `intent_receipts` 表与 `IntentReceiptStore` 均不存在，四注入点无从注入；「`rebuild` 失败即拒启」「重放只在重建后跑」两序均未落码 |
| — | **`AUTH-06` 凭据目录** | `assembly/auth/credentials.ts` 不存在；持久适配归 **`store/src/records/credentials.ts`**（03-store `F-store-records-credentials`，`REC-AUTH-04` 读写原语；复用通用 `records` 表、不建第二张秘密表、不新增投影名）——**两文件均未建**；`register`/`resolve`/`revoke` 未实现、值入目录的负向探针未跑 |
| — | **`PlatformBindingPort` 的实现**（`assembly/platform/binding.ts`） | 文件不存在；类型落点已定 `packages/contract/src/ports/binding.ts`（W-12 已关闭），**该文件未建**；`wire.ts` 现有 `FieldProvisionMap` 只覆盖字段/状态，**无** `losses`/`ExitPlan`/`exportBundle`；`mapState` 的 `observe-unmapped` 路径**未实现**，`REC-OBS-02` 由消费方写（本件只回 `Ok(unverified)`）；20 字段档案无任何实例 |
| — | **`resourceLedger` 投影与 `resource_ledger` 表** | 80 已定名（目标第 18 个投影名，`TableProjectionResult.name: TargetTableProjectionName` 类型上可携带，W-22 已关闭），但表随 MIG-01 尚未建、同事务 hook 未实现；本卷只登记消费点与版本门槛，**不宣称存在** |
| — | 三域互引无机械门禁 | 见 W-5（现状合规，但无强制） |
| — | `test/` 不进 `typecheck` | 25 件测试的类型错误不会被根门禁发现（79-D10） |
| — | demo 档的显式标识 | `realGateMode` 存在，但未见「demo 模式」启动横幅证据；未证 |
| — | `intent_receipts` 投影可重建 | 同 U80-19：表与维护者均不存在；「删表重建逐字段一致」无从验证 |
| — | 真机/跨实现 | 本附录零真机探针；所有「真」字面均未取证据 |

### 8.4 本次未做的事（诚实边界）

- **未执行任何迁移**：所有「目标/拆分/新增/退役」都是设计处置，代码一行未改、manifest 未动、guards 未动。
- **未跑全量测试**：本附录写作期间未执行 `bun run test`；校验只做静态核对（文件数、行数、导出面、import 图、`configInvalid` 计数、开库点计数）。
- **evolve 五件只核了导出面、选项字段与测试断言名**，未逐行核函数体；条目里的行为描述以头注、导出签名与测试标题为据，逐行语义待实现单阶段复核。
- **package 依赖裁决引用 79-§10.1**，未重新验证版本解析与 lock 一致性。
- **v0.2 修订（按 80 定稿接口）未跑全量 `bun run test`**：`bun run typecheck` 与 `bun run guard:boundaries`
  已执行——**exit 0**（门禁输出「边界门禁 PASS：扫描 627 文件（范围面代码件 499），0 违例」）。本轮只改 `docs/`、
  未动一行源码，故两道门禁证明的是**文档改动零副作用**，**不**证明任何目标件已实现。
  静态复核另含：`find`/`wc -l` 复算件数与行数；`ServeConfig` **73 个类型键 = `coerceServeConfig` 的 73 个 `case`**
  （`cases-not-typed` 与 `typed-not-cases` 两差集皆空）；§4.2.1 表 **73 行键集与代码键集互不缺失、互不多余**；
  `grep` 核 `openLedger` 9 处；`work-readiness.ts`/`secret.ts`/`intent.ts` 均不存在。新增条目里的签名与字段
  **全部引自 80 现场**，未做编译期验证。
- **v0.3 修订（按 80-§3 / §6.6 / §6.9 / §8.2 / §9.4 / §11 再校）只改 `docs/`**：本轮跑过 `bun run typecheck`
  与 `bun run guard:boundaries`（结果见 §8.4 末行），**未**跑全量 `bun run test`，**未**建任何目标文件。
  静态复核含：`grep -c '^```'` 偶数（代码块闭合）、`grep -c '^F-daemon-'` = **61**（57 在册 + 4 新增）、
  表格列数用转义感知脚本核对；四件新增条目里的签名与错误码全部引自 80 现场，未做编译期验证。
- **v0.4 修订（按 80-§3.4 / §6.3 / §6.6 / §6.9 / §8.2 / §9.4 / §11 再校）只改 `docs/`**：本轮跑过
  `bun run typecheck` 与 `bun run guard:boundaries`（**exit 0**，输出见下），**未**跑全量 `bun run test`，
  **未**建任何目标文件、**未**改一行源码。静态复核含：`grep -c '^```'` 偶数、`grep -c '^F-daemon-'` = **62**
  （= 60 个 src 目标件 + 2 个包清单/门禁件；与 §三 表逐行相等）、表格列数与转义感知脚本核对、`STATE_CONFLICT`/`MatrixLoginSecret`/「M4 十项」/「15 条」/
  「名字未定」**已无现役用法**（仅余禁止性说明与关闭记录）。五处新增/改写的签名（`AssembleApiDeps`/`ApiServerOptions`/
  `IssuesView`/`FinanceSources`、`MatrixBotLoginSecret`/`MatrixHrRegisterSecret`、`CredentialCatalogPort`、JCS 五键 proof、
  `PeerCredentialVerifier`）**全部逐字引自 80 现场**，未做编译期验证。
- **v0.5 修订（按 80-§6.9 `TS-PORT-BIND-01`/§4.8/§6.3 定点补全）只改 `docs/`**：本轮跑过 `bun run typecheck` 与
  `bun run guard:boundaries`（exit 0，输出见下），**未**跑全量 `bun run test`，**未**建任何目标文件、**未**改一行源码。
  静态复核含：`grep -c '^```'` 偶数、`grep -c '^F-daemon-'` = **63**（= 61 个 src 目标件 + 2 个包清单/门禁件；
  与 §三 表逐行相等）、表格列数与转义感知脚本核对。四处新增/改写的口径（`PlatformBindingPort` 四方法、
  `store/src/records/credentials.ts` 持久适配、`SEC-MX-BOT-PASSWORD` 两用途、`TableProjectionResult.name =
  TargetTableProjectionName`）**全部按 80-§6.9/§4.8/§6.3 与最新裁决书写**；其中两用途与 `name` 类型与 80 现场不一致，
  当时（v0.5）据此登记 W-21/W-22 待 80 回写，**未**自行改 80；两项已于 v0.6 关闭（80 现场已改）。
- **v0.6 修订（关闭 W-12/W-21/W-22、AUTH-06 口径同步）只改 `docs/`**：本轮跑过 `bun run typecheck` 与
  `bun run guard:boundaries`（exit 0，输出见下），**未**跑全量 `bun run test`，**未**建任何目标文件、**未**改一行源码。
  静态复核含：`grep -c '^```'` 偶数、`grep -c '^F-daemon-'` = **63**（与 §三 表逐行相等）、表格列数与转义感知脚本核对。
  「80 待回写」/「03 尚未登记」/「倾向 store」/`Ledger.append` 已无现役用法（只余关闭记录与头部说明）。
  关闭依据全部引自 80 现场（`80:1220` `name: TargetTableProjectionName`、`80:3288`/`80:3658` D23 两用途、
  `80:1819-1823` §6.6 BIND-01 三层、`80:1155`/`80:2266`/`80:3663` D28 持久面），**未做编译期验证**。
- **未新建任何目标文件**：`assembly/api/assemble.ts`、`assembly/intent/*`、`assembly/runtime/secrets.ts`、
  `assembly/spec/assemble.ts`、`assembly/auth/assemble.ts`、`assembly/auth/credentials.ts`、
  `assembly/platform/binding.ts`、`assembly/migrate/assemble.ts`、`assembly/stdio/broker.ts`、
  `contract/src/ports/{binding,intent,secret,spec,authority,migration}.ts`、`store/src/records/credentials.ts`、
  `store/src/ledger/open.ts` 的消费侧均不存在；本文只给契约。

---

## 九、对照 81-§六 完成判据的自查

| 判据 | 落点 | 状态 |
|---|---|---|
| 1 现有/目标路径可枚举可复算 | §〇、§二、§三 | 42 现有 + 19 目标新增 − 2 退役 = **61** 件全集、终态在册 **59**，含逐目录复算命令 |
| 2 每件有内部结构/依赖/IO/错误/测试/迁移 | §四（41 条 = 根 1 + assembly 27 + control 6 + evolve 5 + 包清单 2）、§五（22 条）、§六（现有 25 / 目标 42） | 逐条齐；evolve 函数体逐行语义标 §8.4 待核 |
| 3 目标新增件能回到 76/77/78/80 的 ID | §四各条「归属」 | 均引 80-§3/§6.6/§6.9/§9/§10/§11 或 20-§x；无悬空 |
| 4 超限件有拆分清单、未提阈值、未新增平面散件 | §七.1、§七.2 | 5 条超限件全给目标；新件全在子目录 |
| 5 无 `TS-PORT-*` 通配、无来源 `REC-*`、无虚构依赖/能力 | 全文 | 只引 80 既有端口 ID 与实测依赖 |
| 6 现有/目标/未证分清 | 全文标签 + §八 | 无「目标已支持」「测试证明真机」表述 |
| 7 覆盖保留/拆分/新增/替换/退役 + 测试/配置/模板 | §三、§四、§五、§六、§七 | 「模板」不在本附录范围（归 19）；无替换件（§三结论） |
| 8 政策项与工程选择分开 | §8.2 vs §7.3 | 政策 **8** 项、工程选择 **19** 步迁移表（M-a…M-s） |
| 9 跨卷目标件只登记不复制 | §〇〔跨卷目标件的登记方式〕表 | **13 行**跨卷目标件（按表行计；含 3 行 contract+core/store 联合件）；本卷不复制字段、不另起路径 |
| 10 回写清单可执行 | §8.1 W-1…W-22（另 W-10a） | 23 行；v0.3 关闭 W-18/W-19，收窄 W-8/W-13/W-14，新增 W-20；v0.4 **关闭 W-20**；v0.5 收窄 W-12、新增 W-21/W-22；v0.6 **关闭 W-12/W-21/W-22**（依据 80-§6.6 BIND-01/D27、80-§11.2.1/D23、80-§6.3），三者均无剩余 80 回写 |

〔v0.6 自查的边界〕本表只描述**文档一致性与可复算性**，不构成任何实现完成的证据。本轮未执行 `bun run test`；
`bun run typecheck` 与 `bun run guard:boundaries` 已执行且 **exit 0**（仅证明文档改动零副作用）；未创建任何目标文件、
未改一行源码；所有「目标」标签仍是设计处置，所有「未证」项（`PlatformBindingPort` 及其类型文件
`contract/src/ports/binding.ts`、`AUTH-06` 的 `store/src/records/credentials.ts`、`resource_ledger` 建表）
仍未经技术验证。
