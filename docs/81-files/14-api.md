# 81-files/14 · 对外 API（`packages/api`）

> 版本：v0.6，2026-10-27。v0.5 → v0.6：**按 80 现行 3680 行本（§5.7/§6.3/§9.4）定点返修五项**——① 路由计数改为 **16 条**（**10 条读面** + 4 条触发 + `/v1/subscriptions` + `GET /`），新增 `GET /v1/requests/status`：只读 `ingress.receipt(key)` 的**本进程已提交投影快照**，键四槽 `company`/`source`/`kind`/`ticket ?? dedupKey`，命中 `200 {receipt}` + `Cache-Control: no-store`，快照 `undefined` ⇒ `503 receipt-not-in-snapshot`（**不查库、不重放、不断言权威不存在**），`404` 只给“路径拼错”；② **404 与 500 已进 80 主表**（404 = `rejected_precondition`/`EXTERNAL_REJECT`/`not-found`，500 = `unavailable`/`STALL` 且 `subcause` 透传），本卷不再“暂定”，缺口-API-05 只留非触发 `Err` 的归属残余；③ 装配类型按 80 命名落死（`ApiCompanySource`/`ServeConfig`/`IssuesView`/`FinanceSources`），同步→async **只在 HTTP handler 边界**，`ReadOnlyLedger` 的同步 `Result` 不得被包成 `Promise`；④ 三条 query subcause 的 `category` 按 80-§6.3 重定（`ledger-query-unsupported` ⇒ `EVOLVE_REJECT`、`ledger-cursor-invalid` ⇒ `EXTERNAL_REJECT`、`ledger-query-invalid` 保持 `CONFIG_INVALID`），`STATE_CONFLICT` **不是** `ErrorCategory` 成员、全卷不得出现；⑤ M4 验证项 **11 项**（第 11 项 = 回执查询端点正反用例），目标件由 33 复算为 **35**（新增 `routes/requests-status.ts` + `test/app.requests-status.test.ts`）。v0.4 → v0.5：**按 80 现行文本（§6.3/§6.6/§8.2/§9.4 与 D21/D22/S7/S9）同步“读面 `Result` + 回执快照”**——`ReadOnlyLedger.query`/`get` 是**同步 `Result`**（`Ok(undefined)` 才表示不存在；运行期读失败 `Err(unavailable/STALL/ledger-read-failed)`），`RecordReader` 是**异步 `Result`**，二者共用 `RecordPage`；**HTTP 读面不得把读失败吞成空数据**（`Err` → 500，不降级成 `[]`/0/`nextCursor:null` 假末页）；404 用统一错误体 + 稳定 `subcause:'not-found'`（本卷定，80 主表未列，回写缺口-API-05）；`IntentReceiptStore.get` 只读**本进程已提交投影的内存快照**（`ReadonlyMap` 语义，不是 SQLite 查询），`getIntentReceipt` 的 `undefined` **不等于权威记录不存在**、**禁止据此重放**；投影与记录**同事务**、commit 后同一微任务更新快照（`decided` 不可能被读成 `queued`）、`rebuild` 必须在 API 装配前完成；显式声明 `matrixSessionFactory` 与 `ServeConfig.secrets` **不是** `ApiServerOptions` 注入项（§0.7）。v0.3 → v0.4：**按 80 现行文本（§3.3/§3.6/§6.6/§9.4 与 D5/D15）定点返修**——`token`/`requestsPerMinute`/`idempotencyTtlMs` 改为配置开启时**必配、无运行期缺省**（删除“未配 `token` = 全 401”与 api 侧两个缺省常量）；`allowedSources` **显式空数组亦拒启**；`now` 明确**不是** `ApiServerOptions` 注入项；`413` 按 §9.4 状态表落 `body-too-large`（不落记录、无 `fieldPath`，缺口-API-05 相应收窄）；公司未挂载 = `rejected_precondition` → **422**；路由计数统一为 **15 = 9 读（含 501 的 `/v1/events`）+ 4 触发 + `/v1/subscriptions` + `/`**；`assembleApi` 的 `ingress` 写作 `Pick<IntentSubmissionPort,'submit'|'receipt'>`（= `Pick<IntentIngress,…>`，**不含** `replayQueued`）。v0.1 → v0.2：**装配、幂等回执、路由、认证、错误体五面按 80-§9.4（D5/D15）与 80-§6.6（`TS-PORT-API-01`）重写**；旧稿的“本地幂等表 + `emitIntent: void` + `{ok,code}` 错误体”作废。v0.2 → v0.3：**计数与 ID 复算（现有 3 / 目标 33）、`idempotency.ts` 改名并改义为 `submission.ts`、新增 `views/observation.ts`、统一接口口径落点（§0.6）、`requestedAt` 必填、`ticket ?? dedupKey` 键槽、金额 `DecimalString`、机密出口经 `contract` 复用**。（v0.2–v0.5 历史条目中的“15 条”计数、“33 件”、“404 主表未列 / 404-500 暂定”等值均已被 v0.6 顶部结论取代，以顶部为准。）
> 性质：**自然语言级逐文件设计呈审稿**，不是现行文件树、实现单或完成证明。
> 上位：75（文件契约）、76（公共语义；§1.2 时间戳/标量）、77（运行记录与行为；§1.4 幂等、§4.1 受理五值、§11.1 失败类）、78（`BIND-EDGE-API-01`；§1.2 `BIND-CORE-01`、§7.4.1 秘密清单与强制出口、§11.3）、79（工程与依赖）、80（组件与 TS 接口；本附录取其 §3.3、§3.6、§5.7、§6.3、§6.6、§8.2、§9.4、§9.6、§11.2.1、§12.5）。
> 范围：`packages/api` 的全部现有 `src`、测试与夹具、`package.json`、`tsconfig.json`；以及从 `packages/panel/src/external/` 迁入职责在 `api` 内的目标文件。
> 门禁：本文所有“目标/新增/替换/拆分/退役”都是**设计处置，尚未执行**。不得据此直接改生产代码、manifest、lock 或 guards。

---

## 〇、范围、口径与核查边界

### 0.1 本附录覆盖什么

| 类别 | 覆盖 |
|---|---|
| 生产源码 | `packages/api/src/**` 全部文件 |
| 测试与夹具 | `packages/api/test/**`（现有为空；目标新增） |
| 包配置 | `packages/api/package.json`、`packages/api/tsconfig.json` |
| 迁移源（只引用、不改） | `packages/panel/src/external/{index,server,views}.ts`、`packages/panel/test/{external,external-serve}.test.ts`、`apps/daemon/src/cli/external.ts` |
| 装配点（归属他卷） | `apps/daemon/src/assembly/api/assemble.ts`（目标，不存在；归 81-files/17-daemon-assembly-cli-control-evolve） |

### 0.2 明确不在本附录

- 不设计 `panel` 的监控面与公司概览面（归 `81-files/13-panel.md`）。
- 不设计 daemon 的 `ServeConfig.external` 键、`runServe` 停机序列与 `engine.ingest`（归 17 与 80-§3.6）。
- 不设计 `company` 的 `buildOrgTree` / `buildProgressSnapshot` / `buildFinanceSnapshot` 下沉实现（归 `81-files/04-company.md`），也不设计 `contract` 的 `dayKeyOf` / `DAY_MS` 下沉（归 `81-files/01-contract.md`）。
- 不设计 `store` 的 `openLedgerReadonly`（归 `81-files/03-store.md`）。
- 不写生产代码、可执行 schema、迁移脚本、构建脚本；不安装依赖；不启动真实服务；不做 git 操作。

### 0.3 标签

沿用 81-§四：**现有**、**库级/未接**、**目标-保留**、**目标-拆分**、**目标-新增**、**目标-替换**、**目标-退役**、**目标-取消**、**仅测试/演示**、**未证**。

- **目标-取消**在本卷指：v0.1 曾规划、v0.3 起**不落**的文件/口径（`src/idempotency.ts`、`test/idempotency.test.ts`——改名并改义为 `submission`，且不建本地判重表）。它不是“退役现存文件”，计入处置计数但不出现在目标全集里。

本附录额外使用两个文内标记（不是公共语义 ID）：

- **缺口-API-nn**：发现上位卷缺少某个对象/签名/字段，需回写 80/76/77/78；本附录**不自行补一套**。
- **冻结面**：迁移期间该文件不得再增长，只能被替换或删除。

### 0.4 核查方法与本次证据边界

已做的只读核查（v0.3 复跑，命令与结果可复算）：

- 逐文件读取 `packages/api` 全部 3 个文件；`wc -l` 实测：`src/index.ts` **43**、`package.json` **23**、`tsconfig.json` **5**；
- 逐文件读取迁移源 `panel/src/external/{index,server,views}.ts`（48 / 571 / 201 行）；
- 读取 `panel/src/server.ts` 的 `toWebRequest` / `forwardResponse` / `listenHono`（`:321`–`:433`）；
- 读取 `panel/src/overview/views.ts` 的 `buildOrgTree`（`:172`）、`buildProgressSnapshot`（`:268`）、`buildFinanceSnapshot`（`:364`）；
- 读取 `contract/src/ports/invoke.ts:17` 的 `InvokeIntent`、`core/src/decide.ts:319` 的 `intentKeyOf`、`engine/engine.ts:651`/`:2302` 的 `ingest`、`engine/intents/drain.ts:196`–`:204` 的共闸/去重；
- 读取 `engine/intents/taxonomy.ts:96`–`:115` 与 `:292`–`:330`：daemon 私有的 `WebhookIntentPayload` 是 **`InvokeIntent.payload` 的业务形状**（`{title, detail?, eventId?}`），与 80-§6.6 的**同名信封不同物**（缺口-API-12）；消费只落单、`dedupKey` 含 `;`/换行即丢弃；
- `ls packages/contract/src/ports/`：只有 company/executor/gateway/index/invoke/kernel/models/notifier/platform——**无 `intent.ts`、无 `secret.ts`、无 records 端口**；
- 全仓 `grep -rnE "IntentIngress|IntentReceiptStore|WorkIntake|openLedgerReadonly" --include=*.ts packages apps` → **0 命中**（`-E`，非 BRE 字面 `|`）；
- `contract/src/ports/kernel.ts:98`–`:102` 的 `ClassifiedError` 只有 `category/subcause/detail?`，**无 `failure`**（与 80-§5.7 目标不一致，缺口-API-13）；同文件 `:13` 仍是 `Money = { usd: number }`（80-§4.1 `TS-SCALAR-09` 要求公共金额用 `DecimalString` + 币种）；
- 读取 80 的**定稿决策**（v0.6 按现行 **3680 行**本复核行号）：§3.3 `ServeConfig.external` 键集与 `allowedSources`（`:247`–`:250`）、`ServeConfig.secrets`（`:252`–`:256`）、§3.4 第 8 条“不新增 `secretProvider` 注入项”（`:292`）与第 10 条 `matrixSessionFactory`（`:295` 起）、§3.6 启动十步与第 6 步 ingress/秘密面（`:370`–`:398`，第 6 步 `:389`）、§5.7 错误分类含“`category` 缺省 + 领域显式覆盖”与“404 例外”（`:760` 起；404 例外 `:809`、`not_found` 澄清 `:855`）、§6.3 `RecordQuery`/`RecordPage`/`RecordReader`（`:1168` 起；`RecordPage` `:1198`、三条 query subcause 与 `ledger-read-failed` `:1207`）、§6.6 `TS-PORT-API-01`（`:1893`）、“回执查询不走库”（`:1971`）、`IntentIngress`/`IntentReceiptStore` 形状与规则 1–10（`:2018`、`:2074` 起）、§8.2 `ReadOnlyLedgerOpen`/`ReadOnlyLedger`/`openLedgerReadonly`（`:2593`/`:2599`/`:2605`）与错误表、“为什么只读也返回 `Result`”（`:2610`）、§9.4 路由计数（`:2810`，**16 条**）、**回执查询端点硬约束**（`:2814`–`:2822`）、状态表（`:2828`–`:2841`，**含 `404` 行 `:2834` 与 `500` 行 `:2840`**）、`assembleApi`（`:2866`）与其代码块（`:2868`–`:2918`；`ApiCompanySource` `:2870`、`IssuesView` `:2878`、`FinanceSources` `:2888`、`AssembleApiDeps`/`ApiServerOptions` `:2897`–`:2918`）、`ApiServerOptions` 注入表（`:2944`–`:2956`；`issuesView` `:2949`、`finance` `:2950`、`config` `:2948`）、M4 **11 项**（`:2968` 起，第 11 项 `:2980` 为回执查询）、§11.2.1 `SecretKind`/`SecretUse`/`KnownSecretSet`（`:3168` 起，`SecretKind` `:3175`）、§12.5 U80 清单（`:3511` 起，U80-15 `:3529`）、D5/D15/D21/D22/D25/S7/S9（`:3626`/`:3636`/`:3642`/`:3643`/`:3646`/`:3663`/`:3665`）；与本卷冲突处一律改文档、不私补；
- 读取 78-§1.2（`BIND-CORE-01` 20 字段）、§7.4.1（秘密清单与强制出口表，明确点名“API 错误与外部响应（:8788 等）”）、§11.3（`BIND-EDGE-API-01`）；
- 读取 `scripts/guards/boundary-rules.mjs:82`/`:108`/`:123`–`:125`/`:149`/`:152`；
- 实跑两项静态检查（本次）：`./node_modules/.bin/tsc --noEmit -p packages/api/tsconfig.json` → **exit 0**；`./node_modules/.bin/vitest run --root packages/api` → `No test files found`，**exit 1**。
- v0.4/v0.5/v0.6 都只改本文档（未动任何 `src`/`test`/manifest/guards），因此**没有重跑**上面两项静态检查；它们的结论属于 v0.3 的实跑记录，不是 v0.6 的新证据。v0.6 的复核只做**只读 grep/`sed`**（80 现行行号与行数、`/v1/requests/status` 硬约束、状态表 404/500 两行、`ApiCompanySource`/`IssuesView`/`FinanceSources` 定义、三条 query subcause 的 `category`、M4 项数），未新增任何运行期证据。

**这些都不证明真实服务可用**：未启动 `:8788`，未装配 daemon，未验证引擎消费、落单、SSE、跨重启幂等，也未做安全探针。80-§12.5 的 U80 未证项对 `api` 同样成立。

### 0.5 一句话现状

`packages/api` 是**43 行占位包**：两个常量、零路由、零 import、零调用方；真实 `:8788` 实现在 `panel/src/external/`，且带两处越界写（直写 `daemon_kv`、直调 `platform.issues.create`）。80-§9.4 已定唯一迁移方向：`api` 接管 HTTP 面，但**只产意图、不碰库、不碰平台**，由 daemon 的 assembly 域同进程装配。

### 0.6 统一口径在本卷的落点

逐条写清“跨卷统一接口口径”落在哪个文件；**N/A 的也写明理由**，不得留白让人以为漏读。

| # | 统一口径 | 本卷落点 |
|---:|---|---|
| 1 | `RuleEvaluator`：`typecheck`/`evaluate` 分离；`RuleOutcome` 四值含 `refused`；`refused` 是 `Ok`；布尔 → `Err(rejected_precondition)` | **N/A**：本包不评估规则、不消费 `RULE-*` 端口，也不 import `core` |
| 2 | `ClassifiedError.failure` 必填；错误体 `{error:{failure,category,subcause},traceId}` | `src/errors.ts` 是**唯一构造点**；`fieldPath`/`retryAfter`/`reason` 只在外层。`failure` 尚未落 `contract` 代码（缺口-API-13），本卷按 80-§5.7 值域书写，**不自建本地类型** |
| 3 | `submit(intent)` 收 `WebhookIntentPayload`；`IntentIngress` 内部转 `InvokeIntent`；`payload={requestKind,body,subjectRef?,requestedAt,correlation?}`；`intentRef` 在 `reserve` 即得；无 `attempts`；不写 `REC-WORK-01/02` | `src/intent.ts` 只**构造信封**（不构造 `InvokeIntent`）；`src/submission.ts` 只**映射回执**；`REC-WORK-01/02` 归 daemon（§6.3） |
| 4 | `assembleApi(deps: AssembleApiDeps)`：`ingress: Pick<IntentSubmissionPort,'submit'\|'receipt'>`（= `Pick<IntentIngress,…>`，**都不含** `replayQueued`）+ `ledgerPath: string` + `companies: readonly ApiCompanySource[]` + `config: ServeConfig`；不收 engine、不传可写 `Ledger`；`openLedgerReadonly`；`IntentReceiptStore` 是唯一投影维护者 | **跨卷**（17-daemon-assembly）。80-§9.4 已把四类型写死（`ApiCompanySource` `:2870`、`IssuesView` `:2878`、`FinanceSources` `:2888`、`AssembleApiDeps` `:2897`–`:2904`），本卷照此引用、不再留 `unknown`/裸名。本卷只声明 `ApiServerOptions` 的字段，**不收 `Ledger`/`engine`/`Database`**，类型上也拿不到 `replayQueued`（属 `IntentIngressInternal`，由 `buildServeRuntime` 持有并在启动末调用一次）；**启动序由上游保证**：`schema 闸 → receipts.rebuild()（表 + 快照）→ replayQueued() → 装配 API`（80-§6.6 第 9 条 `:2127`，§3.6 第 6 步 `:381`），API 装配**不得**早于 `rebuild` 完成——否则开服瞬间会把“还没重建”读成“无此键” |
| 5 | `PlatformBindingPort.describe()` 返完整 `BindingProfile` 20 字段；`mapState` 未映射但合法 → `Ok(unverified)`；`StateMapping.verification`；`unmappedBehavior` 不属于 `BindingProfile` | 本包**只消费原值**：`issueView.state` 是平台原值；不可判时 `unknown` + 原值，**不得**映射到“最近态”，也**不得**把 `unverified` 当“可迁移” |
| 6 | secrets 模块迁 `contract`（`redactOutbound` 等）；`KnownSecretSet.redact` 不新造算法 | `src/errors.ts` 与日志出口经 `@studio-next/contract` 的 `redactOutbound`（目标；现状在 `core/src/secrets.ts`，迁移归 01 与 80-§11.2-3）。`token` 是装配期解析后的值，**不是** `SEC-*` 条目（缺口-API-15） |
| 7 | stdio 工具面 + helper 注册协议 | **N/A**：工具面归 `studio-tools`/daemon（78-§11.4），本包不提供 stdio |
| 8 | `Notification` 保持原形状 | **N/A**：本包不发通知（通知出口归 daemon） |
| 9 | `mapState`/`ProjectionName`/`IntentReceiptStore`/`secret.ts` 已在 80 定义；`ProjectionName` 含 `intentReceipts`/`observation`；分页 `{items,nextCursor}`；`ReadOnlyLedger.query`/`get` 是**同步 `Result`**（`Ok(undefined)` 才不存在；`RecordReader` 是**异步 `Result`**） | `ProjectionName`/`ReadOnlyLedger`/`RecordPage` 只被 `issuesView` 的**注入方**使用，本包不定义；分页一律 `{items, nextCursor}`（末页 `nextCursor` 为 `null`，其余为 opaque 字符串）；读面拿到 `Err` **不得**降级成空页/`undefined`/`nextCursor:null`（§6.1、`errors.ts` 的 500 行） |
| 10 | `repo-validate` 留 company；五门归 `core/src/work-readiness.ts`；`MergeRunHost` 真名；`Money` 全 `DecimalString`；`sha8` 仅展示不判等；UTC 日键 vs 公司本地日 | 前四项 **N/A**（本包不跑校验/五门/合并）。金额：`views/finance.ts` 只用 `{amount: DecimalString; currency: string}`，不用 `Money.usd`（`kernel.ts:13`）。日键：需“公司本地日”者**显式传偏移**，不读系统时区 |
| 11 | `ServeConfig.external` 键集 `enabled/port/lan/token/requestsPerMinute/idempotencyTtlMs/allowedSources`；开启时 `token`/`requestsPerMinute`/`idempotencyTtlMs` **必配**（缺任一/空串/非正整数 ⇒ 整机 `CONFIG_INVALID` 拒启），`allowedSources` **显式空数组亦拒启**；`now` 不是配置键、也**不是** `ApiServerOptions` 注入项 | 本包**不读 YAML**；`ApiServerOptions` 收 `token`/`requestsPerMinute`/`idempotencyTtlMs` 的**已解析值且必填**（本包不设运行期缺省）；`allowedSources` 的权威在 ingress（403 由它判，空数组已在 `coerceServeConfig` 拒启），本包不持该字段；本包不另收时钟（80-§9.4 注入表 `:2944`–`:2956` 内无 `now` 行） |
| 12 | `ReferralTarget` 真形状；`IntakeOutcome` 用 `outcome` 非 `conclusion`；`pending` 是请求态；`unknown_scope.intentRef` | `receiptView` **原样透出** `outcome`（五值标量）与 `referredTo`（`ReferralTarget`），不改名、不加 `conclusion`/`pending`；`unknown` 回执透出 `unknownRef` + `gap` |
| 13 | `IntentReceiptStore.get` 读**本进程已提交投影的内存快照**（`ReadonlyMap` 语义，非 SQLite）；`refresh`/`rebuild` 才读台账并返回 `Result`；记录与投影**同事务**、commit 后同微任务更新快照 | `submission.ts` 的 `getIntentReceipt` 只**转发** `ingress.receipt`；`undefined` 只表示“本进程快照无此键”，**不等于**权威记录不存在、**不得**据此重放或补回执；`decided` 不会被读成 `queued`（§6.3） |

### 0.7 注入面边界：Matrix 工厂与秘密供给**不进** API

80 现行文本把两件相邻能力放在 daemon/boot 侧，本卷**不得**把它们读成 `ApiServerOptions` 的注入项：

| 对象 | 归属（80） | 本卷处置 |
|---|---|---|
| `RunServeOpts.matrixSessionFactory`（登录工厂；返回 `matrixSource`/`matrixRoomFace`/`hrMatrixFace`/`notifyBroadcast` + `close()`） | `apps/daemon/src/assembly/hrsync/run-serve-opts.ts`（`RunServeOpts` 的家），由 boot 构造传入、**daemon 驱动登录**（80-§3.4 第 10 条 `:295` 起、D25 `:3646`） | **不是** `ApiServerOptions` 字段；api **不收**任何 matrix 工厂/面，也**不经** matrix 出站（通知与房间由 daemon 的 `notifyBroadcast` 承担）。api 里出现 `matrixSessionFactory`/`MatrixRoomFace` 等名字即判负 |
| `ServeConfig.secrets`（`catalog`/`fileRoot`/`brokerBinding`）与 `KnownSecretSet`/`SecretMaterial` | daemon 启动第 6 步按 catalog 装配，值只在 daemon 进程内存（80-§3.3 第 6 条 `:252`–`:256`、§11.2.1 `:3168` 起） | **不是** `ApiServerOptions` 字段；api **不读**该键、**不收** `SecretMaterial`/`KnownSecretSet`/provider（同 80-§3.4 第 8 条对 `BuildRuntimeOpts.secretProvider` 的禁令）。出站脱敏只经 `contract` 的 `redactOutbound`/`findSecretShaped`（§8.1），**不得**为取秘密新开 `api→core`/`api→matrix` 边 |

---

## 一、现有件全集与计数

可复算命令：

```bash
find packages/api -type f | sort
find packages/api/src -type f | wc -l
find packages/api/test -type f 2>/dev/null | wc -l
```

| 类别 | 计数 | 文件 |
|---|---:|---|
| 生产 `src` | **1** | `src/index.ts` |
| 测试/夹具 | **0** | —（`test/` 不存在） |
| 包配置 | **2** | `package.json`、`tsconfig.json` |
| **合计** | **3** | — |

### 1.1 现有件一览

| F-ID | 路径 | 行数 | 现有性质 |
|---|---|---:|---|
| F-api-index | `packages/api/src/index.ts` | 43 | 占位：注释 + `PACKAGE_NAME` / `PACKAGE_STATUS` |
| F-api-manifest | `packages/api/package.json` | 23 | 声明 6 个依赖，`src` 零 import（装饰性依赖） |
| F-api-tsconfig | `packages/api/tsconfig.json` | 5 | 继承仓根基线，`include` 仅 `src/**/*.ts` |

### 1.2 相邻件（不属于本附录，不得在本卷计 F-ID）

| 文件 | 行数 | 与本附录的关系 | 归属 |
|---|---:|---|---|
| `packages/panel/src/external/index.ts` | 48 | 现 `:8788` 的公开导出面；迁入后由 `F-api-index` 取代 | 13-panel |
| `packages/panel/src/external/server.ts` | 571 | 现 `:8788` 的路由/认证/配额/幂等/监听；拆分迁入 `api` | 13-panel |
| `packages/panel/src/external/views.ts` | 201 | 现 `:8788` 的纯投影；按视图迁入 `api`（财务/组织/进度三项下沉 `company`） | 13-panel |
| `packages/panel/test/external.test.ts` | 521 | 现信息/触发/认证/配额/幂等 40+ 用例；M4 的旧面基线证据 | 13-panel |
| `packages/panel/test/external-serve.test.ts` | 195 | 真端口绑定/关闭 + mock 外部 agent 冒烟 | 13-panel |
| `apps/daemon/src/cli/external.ts` | 143 | 唯一生产调用方：`:4` import `serveExternal`，`:104` 调用，`:109` `--lan` | 17-daemon-cli |

依赖与调用方核查：全仓 `grep -rn "@studio-next/api" --include=*.ts` 只有 `packages/api` 自身与 `apps/daemon/package.json:22` 的声明；**零 `src`/`test` import**。这既是 79-§10.1 第 7 项“休眠边”的证据，也是本附录可以替换 `index.ts` 而不留包根兼容期的依据。

---

## 二、目标件全集与计数

### 2.1 计数

| 类别 | 目标计数 | 组成 |
|---|---:|---|
| 生产 `src` | **21** | 直下 7 + `http/` 3 + `auth/` 2 + `routes/` 4 + `views/` 5 |
| 测试与夹具 | **12** | 8 个 `.test.ts` + 3 个 helper + 1 个 golden fixture |
| 包配置 | **2** | `package.json`（替换）、`tsconfig.json`（保留） |
| **合计** | **35** | — |

处置计数（仅本附录内文件）：

| 处置 | 数量 | 说明 |
|---|---:|---|
| 目标-替换 | 2 | `src/index.ts`、`package.json`（同路径、同 F-ID，内容更换） |
| 目标-保留 | 1 | `tsconfig.json` |
| 目标-新增（src） | 20 | 下表（直下 6 + `http/` 3 + `auth/` 2 + `routes/` 4 + `views/` 5；`index.ts` 是替换，不计新增） |
| 目标-新增（test） | 12 | 下表 |
| 目标-取消 | 2 | v0.1 规划的 `src/idempotency.ts`、`test/idempotency.test.ts`——改名并改义为 `submission`，且**不建本地判重表**（§0.3） |
| 目标-退役（本包内文件） | 0 | 无文件被删除；`PACKAGE_*` 常量随 `index.ts` 替换消失 |
| 目标-拆分（本包内） | 0 | 拆分对象是 `panel/external` 三件；其退役计数归 13-panel，本附录不重复计 |
| 未证 | 全部真实能力项 | 见 §十二 |

> 说明：本包现有文件只有 3 个，因此“拆分”在本卷表现为**迁入后按面落新文件**，而不是把一个 `api` 现有大文件拆开。80-§9.4 的 M5 要删的是 `panel/src/external/**`，不是 `api` 内文件。

### 2.2 目标文件全集

| F-ID | 目标路径 | 处置 | 上位锚 |
|---|---|---|---|
| F-api-index | `src/index.ts` | 目标-替换 | 80-§9.4（`createApiApp`/`serveApi` 出口） |
| F-api-options | `src/options.ts` | 目标-新增 | 80-§9.4 `ApiServerOptions` 表 |
| F-api-app | `src/app.ts` | 目标-新增 | 80-§9.4 M2、§9.5 只读纪律 |
| F-api-serve | `src/serve.ts` | 目标-新增 | 80-§9.4 M2、§3.6 停机序列 |
| F-api-errors | `src/errors.ts` | 目标-新增 | 80-§5.7、§11.6；77-§11.1 |
| F-api-submission | `src/submission.ts` | 目标-新增 | 80-§9.4 D15、80-§6.6 重投四态；77-§1.4 |
| F-api-intent | `src/intent.ts` | 目标-新增 | 80-§6.6 `WebhookIntentPayload`；77-§4.1.1 |
| F-api-http-listen | `src/http/listen.ts` | 目标-新增 | 80-§9.4 装配决策 2 |
| F-api-http-request | `src/http/request.ts` | 目标-新增 | 同上（`toWebRequest` 下沉） |
| F-api-http-response | `src/http/response.ts` | 目标-新增 | 同上（`forwardResponse` 下沉） |
| F-api-auth-token | `src/auth/token.ts` | 目标-新增 | 80-§9.4 M4#2；78-§11.3 认证 |
| F-api-auth-quota | `src/auth/quota.ts` | 目标-新增 | 80-§9.4 M4#2；78-§11.3 |
| F-api-routes-info | `src/routes/info.ts` | 目标-新增 | 80-§9.4 信息面 8 端点 + `GET /` 索引 |
| F-api-routes-trigger | `src/routes/trigger.ts` | 目标-新增 | 80-§9.4 触发面 4 端点 |
| F-api-routes-subscriptions | `src/routes/subscriptions.ts` | 目标-新增 | 80-§9.4 订阅面 |
| F-api-routes-requests-status | `src/routes/requests-status.ts` | 目标-新增 | 80-§9.4 回执查询端点（`:2814`–`:2822`）；80-§6.6 规则 5/8 |
| F-api-view-agent-card | `src/views/agent-card.ts` | 目标-新增 | 80-§9.4 信息面（agent-card） |
| F-api-view-company | `src/views/company.ts` | 目标-新增 | 80-§9.4 装配决策 3；80-§9.6 |
| F-api-view-issues | `src/views/issues.ts` | 目标-新增 | 80-§9.4 信息面；§9.5 只读 |
| F-api-view-finance | `src/views/finance.ts` | 目标-新增 | 80-§9.4 装配决策 3；§9.6 |
| F-api-view-observation | `src/views/observation.ts` | 目标-新增 | 80-§6.3 `ObservationState`；77-§9.2 六态；80-§9.6 |
| F-api-test-app-info | `test/app.info.test.ts` | 目标-新增（仅测试） | 80-§9.4 M4#1 |
| F-api-test-requests-status | `test/app.requests-status.test.ts` | 目标-新增（仅测试） | 80-§9.4 M4#11（回执查询正反用例） |
| F-api-test-app-trigger | `test/app.trigger.test.ts` | 目标-新增（仅测试） | 80-§9.4 M4#3/#4；77-§1.4 |
| F-api-test-app-auth-quota | `test/app.auth-quota.test.ts` | 目标-新增（仅测试） | 80-§9.4 M4#2 |
| F-api-test-app-lifecycle | `test/app.lifecycle.test.ts` | 目标-新增（仅测试） | 80-§9.4 装配决策 4 |
| F-api-test-http-adapter | `test/http.adapter.test.ts` | 目标-新增（仅测试） | 80-§9.4 装配决策 2 |
| F-api-test-views | `test/views.test.ts` | 目标-新增（仅测试） | 80-§9.4/§9.6 |
| F-api-test-submission | `test/submission.test.ts` | 目标-新增（仅测试） | 77-§1.4；80-§6.6 四态 |
| F-api-test-helper-company | `test/helpers/fake-company.ts` | 目标-新增（仅测试/演示） | 夹具，无生产语义 |
| F-api-test-helper-issues-view | `test/helpers/fake-issues-view.ts` | 目标-新增（仅测试/演示） | 夹具 |
| F-api-test-helper-intent-sink | `test/helpers/fake-intent-sink.ts` | 目标-新增（仅测试/演示） | 夹具：实现 `IntentSubmissionPort` |
| F-api-test-fixture-info-golden | `test/fixtures/info-golden.json` | 目标-新增（仅测试） | M4 逐字段一致基线 |
| F-api-manifest | `package.json` | 目标-替换 | 79-§9/§10；80-§10.6 |
| F-api-tsconfig | `tsconfig.json` | 目标-保留 | 79-§1.3/§4；80-§4 |

### 2.3 目录预算

| 目录 | 目标直属文件数 | 上限 | 结论 |
|---|---:|---:|---|
| `packages/api/src` | 7 | 25 | 余量充足 |
| `packages/api/src/http` | 3 | 25 | — |
| `packages/api/src/auth` | 2 | 25 | — |
| `packages/api/src/routes` | 4 | 25 | — |
| `packages/api/src/views` | 5 | 25 | — |
| `packages/api/test` | 8 | 25 | 余量充足 |
| `packages/api/test/helpers` | 3 | 25 | — |
| `packages/api/test/fixtures` | 1 | 25 | — |

`maxLinesPerFile=600`（`boundary-rules.mjs:152`）对 `src` 与 `test` 一并生效；`packages/api` **没有** `lineBaseline` 条目（grep 无命中），因此目标不新增基线，任何文件逼近 600 行只能拆，不得提阈值。

目标计数复算（M2 落地后才为真；现在跑会得到 1/0）：

```bash
find packages/api/src -type f | wc -l    # 目标 21（含 src/index.ts）
find packages/api/test -type f | wc -l   # 目标 12
find packages/api -maxdepth 1 -type f    # 2（package.json、tsconfig.json）
awk '/^### 2\.2/,/^### 2\.3/' docs/81-files/14-api.md | grep -c '^| F-api-'   # 35
```

---

## 三、逐文件：现有件

### F-api-index

- **路径/处置**：`packages/api/src/index.ts`；现有 → **目标-替换**（同路径、同 ID）。
- **归属**：80-§9.4（`api` 提供 `createApiApp`/`serveApi`）；75-D75-11（按真实职责归位）。
- **现有职责**：只有注释与两个常量；陈述了目标边界（外部只落单、三档凭证、视图分级、SSE），但**没有任何实现**。
- **现有非职责**：不提供路由、不监听端口、不读配置、不碰库；不代表 `:8788` 的任何真实能力。
- **内部结构（现有）**：`export const PACKAGE_NAME = "@studio-next/api"`；`export const PACKAGE_STATUS = "skeleton"`。无类型、无函数、无默认导出。
- **导出/依赖（现有）**：仅上述两个常量；零 import；被 `apps/daemon/package.json:22` 声明为依赖但无人 import。
- **IO/状态（现有）**：无。
- **测试（现有）**：无测试；包级 `tsc --noEmit` exit 0（实跑）；包级 `vitest run` exit 1（实跑，`No test files found`）。
- **目标职责**：包根 facade——只再导出 `createApiApp`、`serveApi`、以及 `ApiServerOptions` / `ApiCompanySource` / `IssuesView` / `FinanceSources` / `ServeConfig` / `ApiHandle` 等公开类型与常量；**无副作用**（import 不建 app、不开端口）。
- **目标非职责**：不装配 daemon、不读 `ServeConfig`、不构造 `emitIntent`、不 import `@studio-next/panel` 或 daemon。
- **目标内部**：纯 re-export；目标 ≤60 行。`PACKAGE_STATUS` **删除**（零消费者，无需兼容期）；如仍需包名标识，只保留 `PACKAGE_NAME` 且不得用它做能力判断。
- **目标导出/依赖**：导出面 = `./app.ts` + `./serve.ts` + `./options.ts` 的公开子集；依赖 `hono` 的 `Hono` 类型（经 `app.ts`）。
- **目标错误/观测**：无自身错误；不得在 import 期写日志。
- **测试/迁移**：由 `app.lifecycle` 与 `app.info` 经包根导入覆盖；迁移顺序 M2 替换，M3 才成为生产调用面。规模预算 ≤60 行。

### F-api-manifest

- **路径/处置**：`packages/api/package.json`；现有 → **目标-替换**（依赖分类与清单）。
- **归属**：79-§9.1（依赖总表）、79-§10.1 #2（装饰性依赖）、80-§10.6（保留到 M2）。
- **现有内容**：`name="@studio-next/api"`、`private=true`、`type="module"`、`main`/`exports["."]` 指 `./src/index.ts`；`scripts.typecheck="tsc --noEmit -p tsconfig.json"`、`scripts.test="vitest run"`；`dependencies` 6 条：`@studio-next/company`、`@studio-next/contract`、`@studio-next/store`、`@modelcontextprotocol/server ^2.0.0`、`hono ^4.6.0`、`zod ^4.0.0`；无 `devDependencies`。
- **现有事实**：`src` 对 6 条依赖**零 import**（仅常量文件），属 79-§10.1 第 2 项“装饰性依赖”；实锁版本以 79-§9.1 为准（Hono 4.13.13、Zod 4.6.7、MCP server 2.3.1）。
- **现有非职责**：manifest 声明不等于接线；不得据此声称 api 具备 HTTP/DB/MCP 能力。
- **目标职责**：只声明目标真实使用的运行时依赖。
- **目标内容（设计）**：
  - `dependencies`：`@studio-next/contract`（类型/错误/canonical）、`@studio-next/company`（`SLUG_RE` + M1 后的三个纯投影）、`@studio-next/store`（**仅类型**：`TicketMirrorRecord` 等读面行型）、`hono`（HTTP 路由/SSE）。
  - **移除** `@modelcontextprotocol/server`：80-§9.4 的目标职责“三类，不多不少”不含 MCP 出口；78-§11.4 把 MCP 归 `studio-tools`。保留它会让“api 像是有 MCP 面”的误读继续存在（79-§10.1 #2 的处置理由）。
  - **移除** `zod`（若 M2 落地后仍零 import）：目标请求体校验是窄手写校验（沿用现状 `reqString` 语义），视图白名单由显式投影函数承载；80-§5.10 只把 Zod 定为 authoring/binding 工具，不要求每个边界都用它。若制作人要求 zod 化，必须先在 80 定义哪些 schema 由 api 持有，再恢复依赖。
  - `scripts` 保留 `typecheck`/`test`；`main`/`exports["."]` 维持 `./src/index.ts`（79-§6.5：api 不在 dist 分发闭包内）。
  - 不新增 `files`、`bin`、`build` 脚本：api 不发布、不自起进程（80-§9.4 装配决策 5）。
- **非职责**：不在本附录改 manifest；删除依赖必须随 M2 的真实 import 证据一起做（79-§10.3 的一致性检查）。
- **IO/状态/错误**：N/A（声明文件）。
- **测试/迁移**：M2 完成后按 79-§10.3 做“依赖↔import”机械核对；未过不得声称清单已清。规模 ≤40 行。

### F-api-tsconfig

- **路径/处置**：`packages/api/tsconfig.json`；现有 → **目标-保留**。
- **归属**：79-§1.3（strict/NodeNext）、79-§4（`.ts` 说明符）、79-D10（测试不进 typecheck）。
- **现有内容**：`extends "../../tsconfig.base.json"`；`include: ["src/**/*.ts"]`；注释声明“包级类型门禁”。
- **目标**：内容不变。不引入 `paths`（79-§6.3 明禁以 paths 混两轨）、不引入 `project references`（79-§6.4）、不加 `DOM` lib、不改 `noEmit`。
- **非职责**：不覆盖 `test/`（79-D10：根 program 只 include `src`），因此测试文件的类型正确性不由本文件证明；也不证明 Node 可运行。
- **IO/状态/错误**：N/A。
- **测试/迁移**：实跑 `tsc --noEmit -p packages/api/tsconfig.json` → exit 0（本次基线）。若 api 将来切 dist（非目标），包级 `typecheck` 必须并入根脚本（79-§6.1）；当前 api 仍在根 program 内，无需新增串接。
- **规模**：7 行。

---

## 四、逐文件：目标生产 `src`

> 以下均为**目标设计**。所有“新增”文件在 M2 之前不存在；M2 新面零生产调用方，M3 才由 `assembly/api/assemble.ts` 接入 `runServe`。

### F-api-options

- **路径/处置**：`packages/api/src/options.ts`；**目标-新增**。
- **归属**：80-§9.4 `ApiServerOptions` 注入表（**已定稿，字段不得增删**；`:2944`–`:2956`）；80-§6.6 `TS-PORT-API-01`（`:1893`）；80-§3.5（配置不推授权）。
- **职责**：持有 `ApiServerOptions` / `ApiCompanySource` 的唯一定义、**仅可选字段**的缺省与构造期**存在性/形状**校验；不读 env、不读 `ServeConfig`、不读文件、不构造 app。
- **非职责**：不判重、不落回执、不打开台账、不转发意图（转发在装配体 `assembleApi`）；不决定 `:8788` 是否启用（归 `ServeConfig.external.enabled` 与 `runServe` 第 7 步）；**不设** `token`/`requestsPerMinute`/`idempotencyTtlMs` 的运行期缺省（80-§9.4 注入表标“必填，无运行期缺省”）。
- **内部结构**：
  - `ApiCompanySource = { slug: string; snapshotProvider(): CompanySnapshot; listReports?(): readonly ReportFile[]; contact?: string }`——**沿用 80 命名**（80-§9.4 代码块 `:2870`；= 旧 `ExternalCompanySource` 去掉 `openLedger`/`platform` 后的形状）。**无 `openLedger`**（80 明删）。
  - `ApiServerOptions`（逐项对齐 80-§9.4 代码块 `:2906`–`:2918` 与注入表，**字段不得增删**）：
    - 必填、无缺省：`emitIntent(intent: WebhookIntentPayload): Promise<Result<IntentSubmitResult, ClassifiedError>>`；`getIntentReceipt(key: IntentKey): Promise<IntentReceipt | undefined>`；`companies: readonly ApiCompanySource[]`；`config: ServeConfig`（**已解析的同一份配置，不二次解析 YAML**）；`issuesView: IssuesView`；`finance: FinanceSources`；`token: string`；`requestsPerMinute: number`；`idempotencyTtlMs: number`；`bodyLimitBytes: number`（80 代码块 `:2916` 有此字段，注入表未单列，本卷以代码块为准；缺省值仍取 `MAX_REQUEST_BODY_BYTES=100_000`，装配体须显式传同值）。
    - **`issuesView` 的方法名与读语义（v0.6 按 80-§9.4 `:2878` 落死）**：`ticketMirrors(company)` 与 `issues(company, { state?, limit })`，**均同步返回 `Result<readonly …[], ClassifiedError>`**；其底层 `ReadOnlyLedger.query`/`get` 同样同步（`Ok(undefined)` 只表示“该 `recordId` 不存在”；`RecordReader` 侧才是异步 `Promise<Result<…>>`，两者共用 `RecordPage`）。同步→async **只在 HTTP handler 边界**发生：handler 可以直接 `return` 映射，**不得** `await` 一个“假异步”包装，也**不得**把 `ReadOnlyLedger` 的同步 `Result` 包成 `Promise`（80-§9.4 装配决策 3）。
    - **三条 query subcause 的 `failure`/`category`（v0.6 按 80-§6.3 `:1207` 重定）**：`ledger-query-unsupported` ⇒ `unsupported`/**`EVOLVE_REJECT`**（请求合法但该查询形状未开放，属演进域，**不是** `CONFIG_INVALID`）；`ledger-cursor-invalid` ⇒ `conflict`/**`EXTERNAL_REJECT`**（非合并域不得写 `MERGE_CONFLICT`；`STATE_CONFLICT` **不是** `ErrorCategory` 成员，全卷不得出现）；`ledger-query-invalid` ⇒ `rejected_precondition`/`CONFIG_INVALID`；`get` 的运行期失败 ⇒ `unavailable`/`STALL`/`ledger-read-failed`。本包**不得** `try/catch` 吞成 `[]`/`undefined`/空页（“读不出来”≠“没有单”）。
    - **`finance: FinanceSources`（v0.6 新增，80-§9.4 `:2888`）**：`budgets(company)` / `eventCosts(company)` / `monthlyReports(company)`，**均同步返回 `Result`**。三源“未挂载” ⇒ 该段 `unknown` + `reason` 且 **HTTP 200**（**不补 0**、不省键、不得用 `Ok([])` 冒充“没有数据”）；任一源 `Err` ⇒ 整段 **500**（`unavailable`/`STALL`，`subcause` 透传），**不得**把读失败写成 `unknown`。
    - 可选：`eventsSource?`（未实装前 `/v1/events` 维持 501；实装后转为必填）、`listen?`（只覆盖 `hostname`/`onClose`，缺省用 `http/listen.ts`）。
    - **`now` 不是本字段**：80-§9.4 注入表的 `now` 行已裁定它**既不是 `ServeConfig.external` 的键，也不是 `ApiServerOptions` 的注入项**——时钟只来自 `BuildRuntimeOpts.clock`，经 `buildServeRuntime({ clock })` 透传给 `IntentReceiptStore`/ingress；api 侧不另收时钟。`auth/quota` 的窗口时钟因此只在本模块内部可替换（缺省墙钟 `Date.now()`），**不是** options 字段；若将来要可注入时钟，须先改 80-§9.4 注入表（残余见缺口-API-14），不得在本包私加字段。
    - `idempotencyTtlMs` 虽为必填，**本包不消费**：判重窗与 `expiresAt` 全由 ingress/`IntentReceiptStore` 持有（80-§6.6）。缺口-API-01 关闭后，本字段在 api 侧**没有任何消费者**，只为对齐 80 注入表而保留；**不得**在 api 侧据此建回收窗口或状态查询缓存。
  - `views` **不是** options 字段：`buildOrgTree`/`buildProgressSnapshot`/`buildFinanceSnapshot` 由本包**编译期 import** `@studio-next/company`（80 表“包内依赖，不是注入项”），不得改成可选回调。
  - 常量：`QUOTA_WINDOW_MS=60_000`、`MAX_REQUEST_BODY_BYTES=100_000`（= 80-§6.6 `bodyLimitBytes` 的**代码缺省**，不是 YAML 键；适配器按实际字节拦一次 413，ingress 再判一次，两侧同值）、`DEFAULT_PAGE_SIZE=20`、`MAX_PAGE_SIZE=200`、`TOKEN_HEADER='x-sn-token'`、`CLIENT_KEY_HEADER='x-sn-client-key'`、`API_INTENT_SOURCE='external-api'`、`REQUEST_LIMITS={title:500, body:20_000, dedupKey:200}`（字段名与 80-§6.6 信封一致；旧 `idempotencyKey` 作废）、`INTENT_KEY_PARAM_MAX=256` 与 `INTENT_KEY_PARAM_RE=/^[A-Za-z0-9._:-]+$/`（回执查询的参数上限，80-§9.4 `:2820` 同一取值）。**不设** `DEFAULT_REQUESTS_PER_MINUTE` / `DEFAULT_IDEMPOTENCY_TTL_MS`：开启时缺这两个值属配置错误，回落缺省只会把错误伪装成“跑起来了”。
  - `assertApiOptions(opts)`：只做**存在性/形状**校验——`emitIntent`/`getIntentReceipt` 是函数、`companies` 非空数组、`config` 是对象、`issuesView` 与 `finance` 非空且方法齐（`ticketMirrors`/`issues`；`budgets`/`eventCosts`/`monthlyReports`）、`token` 非空字符串、`requestsPerMinute`/`idempotencyTtlMs`/`bodyLimitBytes` 为正整数、slug 过 `SLUG_RE` 且不重复；不合法抛 `configInvalid`，`subcause` 固定为 `api/missing-emit-intent`、`api/missing-get-receipt`、`api/no-companies`、`api/missing-config`、`api/missing-issues-view`、`api/missing-finance`、`api/missing-token`、`api/bad-requests-per-minute`、`api/bad-idempotency-ttl`、`api/bad-body-limit`、`api/bad-slug:<slug>`、`api/duplicate-slug:<slug>`。**不调用**这些函数、不试连库，也不校验 `openLedgerReadonly` 的打开结果（那是装配体的事）。
  - `allowedSources` **不是**本包字段：来源白名单的权威在 `ServeConfig.external.allowedSources` 与 `IntentIngress`（不在表内 ⇒ `rejected_forbidden` 403，80-§3.3/§6.6）；**显式空数组在 `coerceServeConfig` 即 `CONFIG_INVALID` 拒启动**（80-§3.3 `:249`），不是“运行期全 403”，也不是“空 = 全放行”——本包不得为此私设第三种处置。本包只把固定 `source:'external-api'` 写进信封；**唯一的例外读法**是回执查询面从 `opts.config.external.allowedSources` 现读一次做 403 判定（80-§9.4 M4#11 `:2982`），**不**另开字段、不缓存、不查 `SourceRegistry`。
  - **Matrix 工厂与秘密供给不是本包字段**（v0.5 起，见 §0.7）：`RunServeOpts.matrixSessionFactory`（返回 `matrixSource`/`matrixRoomFace`/`hrMatrixFace`/`notifyBroadcast` + `close()`）归 daemon/boot（80-§3.4 第 10 条 `:295` 起），`ServeConfig.secrets` 与 `KnownSecretSet`/`SecretMaterial` 归 daemon 启动第 6 步（80-§3.3 `:252`–`:256`、§11.2.1 `:3168` 起）；两者**都不得**成为 `ApiServerOptions` 的注入项。`assertApiOptions` 不校验、不读取、不缓存它们；api 不持 matrix 面、不经 matrix 出站，出站脱敏只经 `contract` 的 `redactOutbound`/`findSecretShaped`。
- **未定项**：只剩 `eventsSource` 的**类型/游标形状**（缺口-API-04）；`IssuesView`/`FinanceSources` 的方法名与出参已由 80-§9.4 定稿（缺口-API-03 的“方法名”部分关闭），`/v1/reports` 的 `listReports` 形状仍只到“清单”级别。本文件只持有字段与存在性校验，**不得**自造方法名或第二套三源。
- **导出/依赖**：导出上述类型、常量、校验函数；import `@studio-next/contract`（`configInvalid`、`Result`、`ClassifiedError`、`WebhookIntentPayload`、`IntentSubmitResult`、`IntentReceipt`、`IntentKey`、`CompanySnapshot`）、`@studio-next/company`（`SLUG_RE`）。
- **IO 与注入**：纯内存；无时钟（`now` 不是本字段，见上）；不触网、不触盘。
- **状态/并发**：构造后 `Object.freeze` 浅拷贝；不做运行期重载。
- **错误与观测**：`configInvalid` 的消息不得含 token、绝对路径；`subcause` 是稳定检索键。
- **测试/证据**：`app.lifecycle.test.ts` 覆盖每类缺件（含缺 `token`、非正整数 `requestsPerMinute`/`idempotencyTtlMs`）与非法 slug；不证明 daemon 的启动两态（`enabled=false` 的零行为归 17）。
- **规模与迁移**：≤200 行；M2 新建。超限先抽 `src/options/constants.ts`，不得把路由逻辑塞回来。

### F-api-app

- **路径/处置**：`packages/api/src/app.ts`；**目标-新增**。
- **归属**：80-§9.4 M2（`createApiApp(opts)`）、§9.4 状态/错误表、§9.5（读投影只读）。
- **职责**：组装 Hono app：构造期校验 → 公司注册表 → 每请求 `traceId` 与兜底 → 挂信息面/触发面/订阅面；返回 `ApiApp`。
- **非职责**：不监听端口、不读配置、不开库、不写平台、不启动 worker；不构造 `emitIntent`（原样使用注入）；不决定 hostname。
- **内部结构**：
  - `createApiApp(opts: ApiServerOptions): ApiApp`；先 `assertApiOptions`，再建注册表 `Map<slug, ApiCompanySource>`。
  - `traceId`：每请求 `crypto.randomUUID()`，只进错误体与本地面板日志；**不是**台账 `recordId`，也不参与幂等。80 未定义它如何跨进程传播（缺口-API-06）；`submit` 的 payload 里**没有**该字段，不得私自塞进 `body`。
  - 公司解析 `resolveCompany(c, registry)`：显式 `?company=` 命中 → 该司；未命中 → **422** `unknown-company`；缺省且仅一家 → 自动；缺省且多家 → **422** `company-required`；两者都带 `fieldPath:'company'`。80-§6.6 `:2049` 已定“公司未挂载 ⇒ `rejected_precondition`”，故取 **422**；**404 只留给“路径拼错”**（见下），不用于公司解析。**公司是否真的挂载由 ingress 再判一次**（`deps.isCompanyMounted` 为假 ⇒ `Err(rejected_precondition)` → 422，不落记录），本文件的注册表解析只是早退，不是第二事实源。快照 `slug` 与注册键错位 → 500 `wiring-mismatch`，只记一条不含绝对路径的日志。
  - 挂载顺序固定：`onError` → `notFound` → `/` 与信息面 → **回执查询** → 触发面 → 订阅面；触发面内部再固定“鉴权 → 配额 → 公司 → 入参 → dedupKey → 提交”。
  - `onError` 分派：`ApiInputError` → 422（`fieldPath` 取自带）；`ClassifiedError`（构造期/路由抛）→ `errors.toHttp`；其他 → 500 `internal-bug`。**不得**回堆栈、`err.message`、绝对路径、token。**读面 `Err` 不在本处分流**：信息路由拿到 `IssuesView`/`FinanceSources` 的 `Err` 必须**继续上抛**给 `errors.toHttp` → **500**，**不得**就地 `catch` 成空视图/空数组（那会把“库读不出”渲染成“没有单”，违反 80-§8.2 `:2610` 与 D21）。500 的 `failure`/`category` 已由 80 主表定稿（`:2840`）：`unavailable`/`STALL`，`subcause` **原样透传**上游 `Err`（`ledger-read-failed` 等），内部接线错位用 `wiring-mismatch`/`internal-bug`；**不得**改写 `CONFIG_INVALID`，也不得渲染成空列表/`unknown` 段。
  - `notFound`：**404 + 统一错误体** `{error:{failure:'rejected_precondition',category:'EXTERNAL_REJECT',subcause:'not-found'},traceId}`——80-§9.4 状态表 `:2834` 已定稿（v0.5 的 `unsupported`/`EVOLVE_REJECT` 作废）。404 **只表示“路径拼错/未登记路由”**（Hono `notFound` 兜底），**不**用于公司解析（走 422）、**不**用于“记录不存在”（那是 `Ok(undefined)`，在回执查询上表现为 `503 receipt-not-in-snapshot`）、也**不**用于读面失败（走 500）。
- **导出/依赖**：`createApiApp`、`ApiApp`（Hono 实例类型）；import `hono`、本包 options/errors/routes/auth；不 import `panel`、`daemon`、`store` 的运行时写面。
- **IO 与注入**：除 `opts.emitIntent`、`opts.getIntentReceipt`、`opts.issuesView`/`opts.finance` 与各公司的 `snapshotProvider`/`listReports` 外无 IO；**不持时钟**（`now` 不是 options 字段，80-§9.4 注入表 `now` 行）；日志走 `console.error`（一行一事件：`{traceId, method, path, status, subcause}`），不写台账、不记 body/token、不记 `dedupKey`/`ticket` 原文之外的回执字段。
- **状态/并发**：注册表与配额表在 app 生命周期内驻留；单进程单实例；**不缓存回执**（回执的唯一事实在 daemon 投影；`GET /v1/requests/status` 每次直读 `ingress.receipt`，本包不设第二层缓存，故也不需要 `no-store` 之外的一致性机制）。
- **错误与观测**：构造期错误抛 `configInvalid`；请求期错误统一走 `errors.ts`；logs 与响应都不得含内部路径、token、客户端键原文。
- **测试/证据**：`app.info` / `app.trigger` / `app.requests-status` / `app.auth-quota` / `app.lifecycle` 五个文件经 `app.request()` 进程内驱动；不证明真端口与装配。
- **规模与迁移**：≤220 行；M2 新建。若超 220，把公司解析抽 `app/companies.ts`（子目录），不得把路由内联进 app。

### F-api-serve

- **路径/处置**：`packages/api/src/serve.ts`；**目标-新增**。
- **归属**：80-§9.4 M2（`serveApi(port, opts)`）、§3.6 停机序列。
- **职责**：`createApiApp` → `listen`（缺省本包 `http/listen.ts`）→ 返回 `ApiHandle`；提供一次且幂等的 `close()`。
- **非职责**：不打开/关闭台账（句柄归 `assembleApi`/daemon）；不注册信号、不登记停机通道（归 `runServe`）；不等待 daemon 主循环；不打印启动横幅。
- **内部结构**：
  - `serveApi(port: number, opts: ApiServerOptions): Promise<ApiHandle>`。
  - `ApiHandle = { port: number; hostname: string; close(): Promise<void> }`（名字对齐 80 的“`apiHandle.close`”语义）。
  - `hostname` 缺省 `127.0.0.1`；局域网**只能**由 `assembleApi` 经 `opts.listen` 传 `0.0.0.0`（`ServeConfig.external.lan`），本文件**不读环境变量**（80-§9.1：默认回环，显式开局域网）。
  - `close()`：`closed` 守卫；第二次直接 resolve；监听层关闭错误交给调用方记录，不吞。
  - 构造失败（`configInvalid`）发生在监听**之前**；先 `createApiApp` 再 `listen`，避免“监听成功但构造失败”的半起。
- **导出/依赖**：`serveApi`、`ApiHandle`；import `./app.ts`、`./http/listen.ts`；`node:http` 只在 `http/` 子目录出现。
- **IO 与注入**：网络监听；端口 `0` 允许（测试取真实端口）；`opts.listen` 可覆盖监听实现（80 表）。
- **状态/并发**：`closed` 布尔守卫；先 `createApiApp` 校验再监听，避免“监听成功但构造失败”的半起。
- **错误与观测**：`EADDRINUSE`/`EACCES` 原样上抛，由 `runServe` 转成启动失败；不得回落随机端口。
- **测试/证据**：`app.lifecycle`（构造失败不监听、close 幂等）、`http.adapter`（真端口）；不证明装配与停机顺序。
- **规模与迁移**：≤100 行；M2 新建。

### F-api-errors

- **路径/处置**：`packages/api/src/errors.ts`；**目标-新增**。
- **归属**：80-§9.4 状态/错误体表（**唯一形状**）、80-§5.7、§11.6；77-§11.1（失败类）。
- **职责**：把 `ClassifiedError` 与本面输入错误映射为 80 的唯一错误体；集中管理“不得外泄什么”。
- **非职责**：不决定业务是否拒绝（归路由/ingress）；不写事件、不写审计（归 daemon，缺口-API-06）。
- **内部结构**：
  - `ApiErrorBody = { error: { failure: FailureClass; category: ErrorCategory; subcause: string }; traceId: string }`——`failure` **必填**（80-§9.4：“不得漏 `failure`”），本文件是**唯一构造点**；`error.detail` **不出网**（M2 一律省略——省略只证明“不泄漏”，不证明“脱敏完备”）。
  - 外层扩展（均**不进** `error`）：422 带 `fieldPath`；429 带 `retryAfter`（秒，非负整数）；501 带 `reason`。
  - `ApiInputError { fieldPath: string; subcause: string }`：路由/入参闸唯一的抛错型别，由 `app.onError` 转 422。
  - 非 `ClassifiedError` 的两个构造器：`rateLimited(retryAfterSeconds)`（429，`unavailable`/`STALL`/`quota`）与 `unmounted(reason)`（501，`unsupported`/`EVOLVE_REJECT`/`unmounted`）；配额与未挂载**不**伪装成 `Err`。
  - **强制出口**：本文件产出的错误体与全部响应文本，是 78-§7.4.1 强制出口表里的“API 错误与外部响应（:8788 等）”，必须过 `KnownSecretSet.redact`（= `redactOutbound` + `findSecretShaped`，**不新造算法、不加第四种 `SecretShapeFinding`**）。落点走 `api→contract` 允许边（80-§11.2-3 目标：整个 `secrets` 模块迁 `contract/src/secrets.ts`，`core` 只留具名 re-export；现状仍在 `packages/core/src/secrets.ts:68`）。接线前的 fail-closed 形态：只输出白名单字段（`subcause`/`fieldPath`/`reason` 均为自造短串，不回显上游原文），**不得先出站再补扫**（缺口-API-07 已从“禁 import”收窄为“接线未落”）。
  - `toHttp(err: ClassifiedError, traceId): { status; body }`，`category` 取构造器缺省（80-§5.7 映射）：
    | 场景 | HTTP | `failure` | `category` | 外层附加 |
    |---|---:|---|---|---|
    | 请求缺令牌/空令牌（`token` 未配已在装配期拒启，不进本表） | 401 | `rejected_authority` | `EXTERNAL_REJECT` | — |
    | 坏令牌、来源不在 `allowedSources` | 403 | `rejected_forbidden` | `EXTERNAL_REJECT` | — |
    | 同键不同内容（**去重窗内**） | 409 | `rejected_idempotency` | `EXTERNAL_REJECT` | `subcause:'body-mismatch'` |
    | 缺字段/坏 JSON/时间戳不合规/`dedupKey` 空/公司未知、未指定或未挂载 | 422 | `rejected_precondition` | `CONFIG_INVALID` | `fieldPath`；**不落记录** |
    | 请求体超 `bodyLimitBytes`（缺省 `100_000`；适配器按实际字节一次、ingress 再一次） | 413 | `rejected_precondition` | `CONFIG_INVALID` | `subcause:'body-too-large'`；**不带** `fieldPath`；**不落记录**（80-§9.4 `:2836`） |
    | 配额耗尽 | 429 | `unavailable` | `STALL` | `retryAfter`；**不带** `fieldPath` |
    | 下游不明（`emitIntent` 抛错且回执查无 / 回查得 `status:'unknown'`） | 503 | `unavailable` | `STALL` | —（**只**在“这次提交的结果无法证明”时用；正常路径的 `unknown` 回执走 **200**，见 §6.3） |
    | 回执快照无此键（`GET /v1/requests/status` 的 `ingress.receipt` 返 `undefined`） | 503 | `unavailable` | `STALL` | `subcause:'receipt-not-in-snapshot'` + `Cache-Control: no-store`；**不是** 404、不是 200 空体、不得回落查库（80-§9.4 `:2814`–`:2822`/`:2839`） |
    | 面未挂载（events/subscriptions/reports） | 501 | `unsupported` | `EVOLVE_REJECT` | `reason` |
    | 未匹配路由（路径拼错） | 404 | `rejected_precondition` | `EXTERNAL_REJECT` | `subcause` 固定 **`not-found`**（80-§9.4 `:2834`：调用面走错，**不是**演进故障、也**不是**“记录不存在”） |
    | 读面 `Err`（`IssuesView`/`FinanceSources` 读失败） | 500 | `unavailable` | `STALL` | **原样透出上游 `subcause`**（`ledger-read-failed` / `ledger-query-unsupported` / `ledger-cursor-invalid` / `ledger-query-invalid`）；**不得**改写成 200 + 空 `items`/0/`nextCursor:null`/`unknown` 段（80-§9.4 `:2840`） |
    | 未预期内部错误 | 500 | `unavailable` | `STALL` | `subcause` 固定 `internal-bug`（80-§9.4 `:2840` 同格；**不新造失败类**，也不得用 `rejected_precondition` 把内部故障归咎调用方） |
  - **404 与 500 不再是“本卷暂定值”**（v0.6）：80-§9.4 状态表 `:2828`–`:2841` 已含两行，本表照抄；缺口-API-05 只剩“非触发类 `Err` 的 HTTP 归属”一段残余。
  - 其余 `failure`（`rejected_state`/`conflict`/`timeout`/`unverified`/`cancelled`/`partial`/`degraded`/`rejected_version`）本面**不主动产生**；若从 `Err` 到达：`timeout`/`unverified`/`cancelled`/`partial`/`degraded` → 503，`rejected_state`/`conflict` → 409，`rejected_version` → 503；**HTTP 归属仍待 80 列明**（缺口-API-05 残余），实现时集中在一张表，不得散落路由。**读面例外**：`IssuesView`/`FinanceSources` 的 `Err` 只有“读不出来”一类，**固定 500**（`unavailable`/`STALL`），不按上句分流到 409/503；其中 `ledger-query-unsupported`（`EVOLVE_REJECT`）与 `ledger-cursor-invalid`（`EXTERNAL_REJECT`）**只透传 `failure`/`category`/`subcause` 三键，HTTP 仍 500**——不得因为 `category` 是 `EVOLVE_REJECT` 就改回 501，也不得因为 `EXTERNAL_REJECT` 就改成 409。
  - `respondError(c, { status, body })`；`respondReceipt(c, result)`：`duplicate=false` → **202** `{ receipt }`；`duplicate=true` → **200** `{ receipt, duplicate: true }`。**202 不带 `outcome`**（80-§9.4：未判时缺省，`pending` 亦禁用）。
  - `respondReceiptLookup(c, receipt?)`（v0.6，回执查询专用）：`receipt` 有值 → **200** `{ receipt }`（**不带** `duplicate`、不包 `status` 字符串）；`undefined` → **503** `{error:{failure:'unavailable',category:'STALL',subcause:'receipt-not-in-snapshot'},traceId}`；**两条路径都设 `Cache-Control: no-store`**（80-§9.4 `:2818`/`:2821`；失败也带）。本函数**不**查库、不调 `refresh`、不重放，也不得把 `undefined` 送进 `respondError` 的通用分流（那会被误当 500/404）。
  - `respondJson(c, body, status = 200)`：信息面沿用旧面 body（M4#1），**不**引入 `{ok:true}` 包裹，也不做双形状兼容。
- **导出/依赖**：上述函数/类型；`FailureClass`/`ErrorCategory` 取自 `@studio-next/contract`；`Context` 类型取自 `hono`。
- **IO 与注入**：无；`traceId` 由 `app.ts` 生成后传入，不由本文件造第二套 ID。
- **状态/并发**：无状态。
- **错误与观测**：错误体**不得**含 `err.message`、堆栈、绝对路径、token、客户端键；`subcause` 只做检索键，不当判等键；日志与响应两处都不得泄漏。
- **测试/证据**：`app.auth-quota`、`app.trigger`、`app.info`、`app.requests-status` 断言每个状态的四键形状与外层字段，并断言响应体不含堆栈/绝对路径/token；`app.requests-status` 另断言成功与失败**都**带 `Cache-Control: no-store`。
- **规模与迁移**：≤130 行；M2 新建；超限拆 `src/errors/mapping.ts`。

### F-api-submission

- **路径/处置**：`packages/api/src/submission.ts`；**目标-新增**（v0.3 由 `src/idempotency.ts` 改名改义；旧 ID `F-api-idempotency` 作废——原名的“幂等”会误导成“api 管判重”）。
- **归属**：80-§9.4 D15（幂等与受理语义）、80-§6.6（`IntentIngress` 四态重投、`IntentKey` 公式）、77-§1.4；78-§11.3（超时后按幂等键查询）。
- **职责**：① `dedupKey` 入参闸；② 把 `emitIntent` 的 `Result` 映射为 HTTP 回执；③ **仅在 `emitIntent` 抛出**时按键回查回执，避免“记录已落却回 503”。
- **非职责**：**不判重、不存储、不落回执、无 TTL 表**——判重与回执唯一属于 daemon 的 `WorkIntake.reserve` 与 `intent_receipts` 投影；不计算 `bodyDigest`（canonicalization 在 daemon，80-§6.6）；不编造 `outcome`；不做本地单飞（并发由 ingress 事务收敛）。
- **内部结构**：
  - `requireDedupKey(raw: unknown): string`：必填、≤200、不含 `;`/`\r`/`\n`（与 `engine/intents/taxonomy.ts:306` 的可表示性闸一致）；否则 `ApiInputError('dedupKey', …)`。**服务器不替调用方生成键**（80-§6.6）。
  - `intentKeyOf(payload): IntentKey`：`{ company, source:'external-api', kind:'webhook', ticket?, dedupKey }`，与 `core/src/decide.ts:319` 的 `[source, kind, company, ticket ?? dedupKey ?? '']` **逐位一致**。键槽是 **`ticket ?? dedupKey`**：带 `ticket` 时 `dedupKey` **不进键**（80-§6.6）——因此回查回执必须把同一个 `ticket?` 一起带上，否则会查到（或造出）另一把键。
  - `submitAndClassify(deps, payload): Promise<SubmitOutcome>`：
    1. `const r = await deps.emitIntent(payload)`；
    2. `Ok(result)` → `{kind:'ok', result}`；
    3. `Err(error)` → `{kind:'err', error}`（**不重试**）；
    4. **只有 throw**（非 `Err`）→ `deps.getIntentReceipt(intentKeyOf(payload))`。该调用**原样转发 `ingress.receipt`**，读到的是**本进程已提交投影的内存快照**（`ReadonlyMap` 语义），**不是 SQLite 查询、不是权威记录**：
       - `undefined` → `{kind:'unknown-submit'}`——只表示“**本进程快照**里没有该键”，**不等于**“库里没有这条意图”，**不得**据此判定未提交、**不得**据此重放或补发；
       - `status:'unknown'` → `{kind:'indeterminate', receipt}`；
       - `queued`/`decided` → `{kind:'registered', receipt}`。
  - `httpOf(outcome)`：`ok && !duplicate` → **202** `{receipt}`；`ok && duplicate` → **200** `{receipt, duplicate:true}`；`registered` → **200** `{receipt, duplicate:true}`；`err` → `errors.toHttp`；`indeterminate`/`unknown-submit` → **503**（`subcause:'submit-outcome-unknown'`）。
  - **快照不变式（80-§6.6 规则 5/7/8，v0.5 明写）**：`receipt` 的维护只有两条路径——启动 `rebuild()`（先表、后快照，且**必须在 API 装配前**完成；失败即整机拒启）与记录事务 commit 后**同一微任务内**由 store 自持的 projection hook 同步更新；`refresh(key)` 与 `rebuild` 形状对齐（同一派生源，都读台账、都返回 `Result`）。因此 **`decided` 不可能被读成 `queued`**，“记录已提交而快照未更新”的可观测窗口不存在。api 侧**既不重算也不修快照**：`getIntentReceipt` 只读快照，**不**顺手调用 `refresh`（那会把投影当事实源，违反规则 8）。
  - `receiptView(receipt)`：按 `IntentReceipt` 字段逐项白名单序列化，**不加**本地字段；`bodyDigest` 原样转发（不现算）；`outcome` 是**五值标量**（`accepted`/`accepted_with_conditions`/`deferred`/`rejected`/`forwarded`），不改名成 `conclusion`、不用 `pending` 表示未判；`referredTo` 原样透出 `ReferralTarget`；`gap` 非空时照实输出，不据此改状态。
- **语义边界（须写进文件头）**：
  - 同键同内容由 ingress 返回 `duplicate:true` → 200；同键不同内容由 ingress 返回 `Err(rejected_idempotency)` → 409。**两者都不由 api 判**。
  - `registered` 是**异常后的最佳努力**，不是判重路径：它无法证明“同摘要”（摘要域在 daemon），只用于“`submit` 抛错但记录可能已落”；`status:'unknown'` 不得报 200/202。
  - **`undefined` 也不是“没落记录”的证明**：快照可能因本进程刚启动（`rebuild` 未完成——但启动序已保证 API 装配晚于 `rebuild`）、或该行带 `gap:'intake-link-missing'` 不可重建而为空。因此 `undefined` 只允许映射成 503（结果不明），**禁止**映射成“未提交、可安全重投”，**禁止**触发任何重放（`replayQueued` 在 daemon，且只重放 `status:'queued'` 且无 `gap` 的行）。
  - **带 `ticket` 的请求**：键槽被 `ticket` 占，`dedupKey` 不参与判等 ⇒ 同一 `ticket` 下换 `dedupKey` 不会得到 409，而同一 `dedupKey` 挂不同 `ticket` 是两把键。这是 80-§6.6 的既定后果，api 只如实映射，**不得**自行加“同 key 不同内容”的本地判重。
  - 并发同键：api 无本地锁，两次 `submit` 由 ingress 收敛；两个客户端拿到同一 `receiptId`，一个 202、一个 200。
  - TTL 语义完全归 ingress：`queued` 不因过期放行，`decided` 24h，`unknown` 未对账不过期（80-§9.4 D15）。api 侧**不得**另设回收窗口。
- **导出/依赖**：`requireDedupKey`、`intentKeyOf`、`submitAndClassify`、`httpOf`、`receiptView`、`SubmitOutcome`；import contract 的 `Result`/`ClassifiedError`/`IntentKey`/`IntentReceipt`/`IntentSubmitResult`/`WebhookIntentPayload`（后四者的落点见缺口-API-02；`failure` 见缺口-API-13）；不 import `store`/`core`/`daemon`。
- **IO 与注入**：只有注入的 `emitIntent`/`getIntentReceipt`；无时钟、无随机（`traceId` 归 `app.ts`）。
- **状态/并发**：**无状态**；不做本地缓存——缓存会制造第二事实源。
- **错误与观测**：不抛；以 tagged union 返回；`Err` 原样交 `errors.ts`；日志只记 `traceId`、`subcause` 与幂等键（78-§11.3 证据面），不记正文。
- **R/E/W/V**：引用 R12（外部请求不得改写记录）、I-6（外部请求不产生授权）、I-11（未知必须有去向）；**E/W 用例 N/A**——E1–E12/W1–W12 属员工/工作绑定档案（76-§9.4、69-§8.3），本面无对应用例，不得挂靠。验证层 V2。
- **测试/证据**：`submission.test` 覆盖四态映射、202/200/409、throw 回查三分支、键闸、`ticket` 键槽、回执白名单；`app.trigger` 覆盖 HTTP。**不证明**跨重启、跨进程、ingress 事务行为。
- **规模与迁移**：≤160 行；M2 新建；超限拆 `src/submission/mapping.ts`（**不得**重建本地判重表）。

### F-api-intent

- **路径/处置**：`packages/api/src/intent.ts`；**目标-新增**。
- **归属**：80-§9.4 装配决策 1；80-§6.6 `WebhookIntentPayload`（`TS-PORT-API-01` 参数）；77-§4.1.1。
- **职责**：把已通过认证/配额/公司/入参闸的请求构造成 `WebhookIntentPayload`（**不是** `InvokeIntent`）。
- **非职责**：不构造 `InvokeIntent`（由 daemon 的 `IntentIngress` 构造）、不落单、不派工、不写平台/台账；不校验来源白名单（ingress 用 `allowedSources` 校验并返回 403）。
- **内部结构**：
  - `REQUEST_KIND: Record<'requests'|'explore'|'tasks'|'intel', RequestKind>` → `request/explore/task/intel`；四端点**只差这一个字段**（80-§6.6 已定，原缺口-API-02 关闭）。`requestKind` **只由路由决定**：请求体里出现同名键一律 422（双源会造出“端点说 request、体里说 task”的歧义）。
  - `buildWebhookPayload({company, requestKind, dedupKey, ticket?, subjectRef?, requestedAt, body, correlation?})`：
    - `source:'external-api'`、`kind:'webhook'`（固定，端点不得改写）；
    - `requestedAt` **必填**（`WebhookIntentPayload.requestedAt: Timestamp`，80-§6.6）：语法按 76-§1.2——**必须带偏移**（`Z` 或 `±hh:mm`）、**秒必填**、小数秒 ≤9 位，无偏移的本地时间与闰秒形式拒收。**不得**在缺省时用服务器 `now()` 顶替（76-§1.2 明禁“用当前时间填缺省”）；缺失/不合规 → 422 `fieldPath:'requestedAt'`。
    - `payload.body`：**摘要域**（daemon 对 `REC-WORK-01.raw_content` 求 `bodyDigest`，80-§6.6）。本卷把它定为 `{ title: string; detail?: string }`——`detail` 取 HTTP 信封的 `body` 字段；这是 daemon 消费面的唯一形状（`engine/intents/taxonomy.ts:96`–`:115` 的 `title`/`detail?`/`eventId?`，`:226`–`:241` 只读 `title`/`detail`）。〔缺口-API-12〕80 写的是“`body: unknown` 原样载荷”，未写这次字段改名（HTTP `body` → payload `body.detail`），也未说 `correlation.externalRef` 是否等价 daemon 的 `eventId`——本卷只做这一处显式映射，**不改摘要域字段名以外的任何内容**（改形状 = 改幂等摘要，须走提案）。
    - `ticket?`/`subjectRef?`/`correlation?` 三者**原样透传**（80-§6.6 可选字段）；不做语义校验（`TicketId`/`SubjectRef` 形状归 76/80）。
  - `assertPayload(payload)`：公司 slug 形状、`dedupKey` 非空、`requestKind` 成员、`requestedAt` 可解析；失败 → `ApiInputError`。
- **导出/依赖**：`buildWebhookPayload`、`assertPayload`、`REQUEST_KIND`；import `@studio-next/contract` 的 `WebhookIntentPayload`/`RequestKind`/`CompanySlug`/`Timestamp`；**不 import daemon**（daemon 的 `taxonomy.ts` 同名类型是 `InvokeIntent.payload` 的业务形状，**不是**本信封——不得两边互借）。
- **IO 与注入**：无 IO（**无时钟**——`requestedAt` 来自调用方，`receivedAt` 由 ingress 记）；零 fetch、零 fs。
- **状态/并发**：无状态。
- **错误与观测**：形状错误抛 `ApiInputError`（422）；不得静默丢弃字段；日志不记正文。
- **R/E/W/V**：R12（外部请求不得改写记录）、I-6（外部请求不产生授权）；E/W **N/A**（属员工/工作绑定档案）。验证层 V2。
- **测试/证据**：`app.trigger` 用 fake sink 断言 `source/kind/requestKind/company/dedupKey/ticket/body/requestedAt`；golden 锁 `body` 形状；缺 `requestedAt`、无偏移、无秒 → 422。**不证明**引擎消费/落单。
- **规模与迁移**：≤110 行；M2 新建；`WebhookIntentPayload` 的公共形状须落 `contract/src/ports/intent.ts`（80-§6.6；该文件尚不存在——`ls contract/src/ports/` 无 `intent.ts`，api 不得私建类型副本）。

### F-api-http-listen

- **路径/处置**：`packages/api/src/http/listen.ts`；**目标-新增**。
- **归属**：80-§9.4 装配决策 2（`listenHono` 族下沉）。
- **职责**：`Hono` app → `node:http` 服务器；每请求 `AbortController`；错误兜底；优雅关闭。
- **非职责**：不解析业务、不做鉴权、不读库；不从 `panel` 取实现。
- **内部结构**：
  - `listenApi(app, port, opts?): Promise<ApiHttpHandle>`；`opts={hostname='127.0.0.1', onClose?, label='api'}`。
  - 每请求：`res.on('close', () => controller.abort())` → `toWebRequest` → `app.fetch` → `forwardResponse`。
  - 顶层 catch：未发头 → 413/500 JSON（按抛出的 `HttpInputError.status`）；已发头 → `res.destroy()`。**不得**回传异常消息。
  - `close()`：`server.closeAllConnections()` → `server.close(cb)` → `onClose?.()`。
- **导出/依赖**：`listenApi`、`ApiHttpHandle`、`ListenApiOptions`；`node:http`、`node:net`。
- **IO 与注入**：真实 socket；`port=0` 返回实际端口。
- **状态/并发**：一个 server 一个句柄；`close` 与在途 SSE 长连的关系由 `closeAllConnections` 保证。
- **错误与观测**：监听错误上抛；请求级错误只记状态；`traceId` 由 app 生成，适配器不造 ID。
- **测试/证据**：`http.adapter.test.ts` 用 `127.0.0.1:0` 真端口；不证明部署网络/防火墙。
- **规模与迁移**：≤120 行；M1 新建（先于路由），与 `panel/src/server.ts:397`–`:433` 行为对齐；两份实现的差异只允许 `label` 与错误文案，82 需负向用例钉住。

### F-api-http-request

- **路径/处置**：`packages/api/src/http/request.ts`；**目标-新增**。
- **归属**：80-§9.4 装配决策 2；现状锚 `panel/src/server.ts:331`–`:348`。
- **职责**：`IncomingMessage` → 标准 `Request`；逐跳头过滤；socket 客户端键覆写；收集请求体并执行真实字节上限。
- **非职责**：不解析 JSON、不校验字段、不做业务鉴权。
- **内部结构**：
  - `HOP_BY_HOP_REQUEST = {host, connection, keep-alive, proxy-connection, te, trailer, transfer-encoding, upgrade}`。
  - `toWebRequest(req, signal, opts?: {maxBodyBytes?})`：header 合并；`headers.set(CLIENT_KEY_HEADER, req.socket.remoteAddress)` **覆写**同名入站头（外部不可伪造）；非 GET/HEAD 逐块累计，累计超 `maxBodyBytes`（缺省 `MAX_REQUEST_BODY_BYTES`）抛 `HttpInputError(413)`。
  - 现行实现只看 `Content-Length` 预检（`external/server.ts:453`–`:456`），**分块传输可绕过**；目标在适配器层按实际字节再判一次。
- **导出/依赖**：`toWebRequest`、`HOP_BY_HOP_REQUEST`、`HttpInputError`；`node:http`、`node:stream`。
- **IO 与注入**：socket/stream；无时钟。
- **状态/并发**：请求级；abort 由 `listen` 的 signal 传入。
- **错误与观测**：413 由 `listen` 转 JSON；不得在错误消息里带 body 片段。
- **测试/证据**：`http.adapter` 覆盖普通 POST、无 `Content-Length` 的超限分块、客户端键伪造被覆写、断连 abort。
- **规模与迁移**：≤100 行；M1 新建。

### F-api-http-response

- **路径/处置**：`packages/api/src/http/response.ts`；**目标-新增**。
- **归属**：80-§9.4 装配决策 2；现状锚 `panel/src/server.ts:352`–`:374`。
- **职责**：`Response` → `ServerResponse` 流式回写；SSE 走同一路径；客户端断开时销毁上游流。
- **非职责**：不做压缩、不缓冲整包、不改状态码。
- **内部结构**：`HOP_BY_HOP_RESPONSE`；`forwardResponse(res, response)`：过滤逐跳头 → `writeHead` → `Readable.fromWeb` → `pipe`；`res.on('close')` 销毁 `nodeStream`；`nodeStream.error` → `res.destroy()`。
- **导出/依赖**：`forwardResponse`、`HOP_BY_HOP_RESPONSE`；`node:http`、`node:stream`、`node:stream/web`。
- **IO 与注入**：stream。
- **状态/并发**：每响应一个 Promise，结束条件二选一（流结束/连接关闭）；不得泄漏监听器。
- **错误与观测**：流错误只销毁连接，不写第二份 JSON。
- **测试/证据**：`http.adapter` 覆盖普通 JSON 与 SSE 增量（收到 `ready` 后主动断开，断言服务端停止）。
- **规模与迁移**：≤90 行；M1 新建。

### F-api-auth-token

- **路径/处置**：`packages/api/src/auth/token.ts`；**目标-新增**。
- **归属**：80-§9.4 M4#2 与状态表 401/403；78-§11.3 认证“由部署提供（token/来源限制）”。
- **职责**：触发面的单令牌校验，fail-closed；把“请求没带令牌”与“令牌不对”分开。
- **非职责**：不做授权（凭证 ≠ 授权，80-§11.1）；不校验 `allowedSources`（ingress 做，Err→403）；**不判“配置里有没有令牌”**——`token` 缺失/空串在装配期由 `assertApiOptions` 判 `CONFIG_INVALID` **整机拒启**（80-§9.4 注入表 `token` 行，`:2944`–`:2956`），本文件不保留 `expected` 可空时的降级分支；不做多档 ak/secret 或 HMAC——75–80 未定义该模型（缺口-API-08）。
- **内部结构**：
  - `TOKEN_HEADER='x-sn-token'`。
  - `tokenMatches(expected, presented): boolean`：两值先 `sha256` 等长化再 `timingSafeEqual`（长度差不泄露）。
  - `checkToken(expected: string, presented: string|undefined): 'ok' | 'unauthenticated' | 'forbidden'`：`expected` 由 options 保证非空；缺头/空头 → `unauthenticated`（401）；不匹配 → `forbidden`（403）。**没有**“未配置 ⇒ 全 401”这一分支：配置缺件走拒启，不走运行期 401（80-§3.3 `:247`）。
- **导出/依赖**：上述；`node:crypto`。
- **IO 与注入**：无；令牌只来自 `opts.token`（**必填**，由 `assembleApi` 从 `ServeConfig.external.token` 的部署秘密引用解析，不由本包读 env）。
- **状态/并发**：无状态。
- **错误与观测**：不得记录令牌、哈希、前缀；日志最多记 401/403 + `traceId`。
- **测试/证据**：`app.auth-quota` 覆盖缺头/空头/坏值/好值；装配期缺 `token` 的拒启归 `app.lifecycle`；不证明传输层 TLS 或来源限制。
- **规模与迁移**：≤60 行；M2 新建。三档凭证若将来获批，必须先在 78/80 定义，不得在本文件私增。

### F-api-auth-quota

- **路径/处置**：`packages/api/src/auth/quota.ts`；**目标-新增**。
- **归属**：80-§9.4 M4#2 与 429 行；78-§11.3。
- **职责**：按客户端键的固定窗限流；仅对通过鉴权的触发请求计数。
- **非职责**：不做全局限流、不跨进程共享、不持久化；不判 `requestsPerMinute` 是否合法（装配期已拒启）。
- **内部结构**：
  - `createQuota({perMinute, windowMs=60_000, now=Date.now})` → `take(key): {allowed:true} | {allowed:false, retryAfterSeconds:number}`；`retryAfterSeconds = max(1, ceil((windowEnd - now) / 1000))`（80 要求秒、非负整数）。`now` 是**模块内部参数**（缺省墙钟），**不是** `ApiServerOptions` 字段：80-§9.4 注入表 `:2944`–`:2956` 无 `now` 行，api 侧不另收时钟；单测用 `vi.useFakeTimers()` 或直接传假时钟，不得为此新增注入项（残余见缺口-API-14）。
  - 键：适配器用 socket 地址覆写 `CLIENT_KEY_HEADER`；缺省 `'unknown'`；表 >4096 时机会式清扫过期窗。
  - `perMinute` 必须为正整数：`assertApiOptions` 已把非法值判 `CONFIG_INVALID` 拒启，本函数**不做回落**（回落会把配置错误伪装成“跑起来了”，也把 30 这个拟稿值偷偷变成运行缺省）。
- **导出/依赖**：`createQuota`、常量（复用 `options.ts`）。
- **IO 与注入**：时钟只在本模块内部（缺省 `Date.now`）；内存 Map。
- **状态/并发**：同步；固定窗；进程重启清零（单进程部署可接受；多进程会放大配额，不得据此宣称“全局限流”）。
- **错误与观测**：429 体由 `errors.ts` 生成——`failure:'unavailable'`、`category:'STALL'`、`subcause:'quota'`、外层 `retryAfter`；**不带** `fieldPath`；不回显客户端键原文。
- **测试/证据**：`app.auth-quota` 覆盖窗口滚动、分桶、401/403 不耗配额、429 体形状；`http.adapter` 证明 socket 键覆写。
- **规模与迁移**：≤100 行；M2 新建。

### F-api-routes-info

- **路径/处置**：`packages/api/src/routes/info.ts`；**目标-新增**。
- **归属**：80-§9.4 信息面（**8 条信息 GET + `/` 索引**；**第 9 条读面 `GET /v1/requests/status` 归 `routes/requests-status.ts`**、第 10 条 `/v1/events` 归订阅面；全 API 计数见 §6.1 = **16**）；§9.6 六态；§9.4 视图分级。
- **职责**：注册只读信息端点并组装响应；数据只来自注入的 `companies`、`issuesView`、`finance` 与 `company` 纯投影。
- **非职责**：不写库、不写平台、不触发决策；不把未知显示成 0/空/绿；不做公司解析（`app.ts` 统一）；**不注册回执查询**（归 `routes/requests-status.ts`）。
- **内部结构**：
  - `mountInfoRoutes(app, ctx)`；`ctx={companies, issuesView, finance}`。
  - `GET /`：`{service, version, endpoints}`，**只列 HTTP 路由**，不列 MCP 工具目录（80-§9.4）；`version` 取 `agent-card` 的同一常量（缺口-API-09）。
  - `GET /v1/agent-card`、`/v1/company`、`/v1/org`、`/v1/people`、`/v1/projects`、`/v1/issues`、`/v1/finance`、`/v1/reports`。
  - 分页：`/v1/issues` 的 `limit` 缺省 20、上限 200；非整数/越界 → **422** `fieldPath:'limit'`（**不静默 clamp**）；响应一律 `{items, nextCursor}`（80-§6.3 `RecordPage`，末页 `nextCursor: null`、游标 opaque、调用方不得解析）；`state`/`company` 过滤沿用旧面。
  - **读面的 `Result` 纪律（v0.6 按 80-§6.3/§8.2/D21）**：`IssuesView`/`FinanceSources` 的方法**同步返回 `Result`**，其底层 `ReadOnlyLedger` 亦然；路由**先判 `Result`**再进视图函数，**只在 handler 边界**把同步结果映射成 HTTP——
    - `Ok(rows/page)` → 视图投影 → `{items, nextCursor}`（`nextCursor` 原样透出，**不得**在 `items` 为空时伪造 `null` 或反向补页）；
    - `Err(e)` → **不吞、不降级**，直接交 `errors.toHttp` → **500**（`unavailable`/`STALL`），**三键原样透出**（`ledger-read-failed`/`ledger-query-unsupported`/`ledger-cursor-invalid`/`ledger-query-invalid`）。注意 `ledger-query-unsupported` 的 `category` 是 `EVOLVE_REJECT`、`ledger-cursor-invalid` 是 `EXTERNAL_REJECT`——**HTTP 码仍由本面固定 500**，不得因 `category` 改写成 501/409。**禁止** `try/catch` 成 `[]`、`?? []`、`items: []` + `nextCursor:null` 或 `state:'unknown'` 顶替——“读不出来”不是“没有单”（77-§9.4 覆盖缺口的入口）。
    - 只有 `Ok(undefined)`（`get` 场景）才表达“该 `recordId` 不存在”，其余一律 `Err`；本面**不把 `undefined` 改写成空页**。
    - **不得**把 `ReadOnlyLedger` 的同步 `Result` 包成 `Promise` 后再 `await`（“假异步”），也不得先 `await Promise.resolve(result)` 再判——那会让“同步→async 只发生在 handler 边界”这条纪律失效（80-§9.4 装配决策 3）。
  - `/v1/people`：**public 只出聚合**（按部门/职级的计数），不出逐人明细（80-§9.4：个人详情只在 `partner`/`internal`）；`costCaps`/`skills`/联系方式永不出。逐人明细依赖未定义的分级（缺口-API-08）。
  - `/v1/finance`：数据来自注入的 `finance: FinanceSources` 三源（`budgets`/`eventCosts`/`monthlyReports`）。**源未挂载** ⇒ 该段 `Observed` `unknown` + `reason` 且 **HTTP 200**（不是 501；80-§9.4：“缺任一源 ⇒ 该段 unknown 并写原因，**不得补 0**”）；**任一源 `Err`** ⇒ 整段 **500**（`unavailable`/`STALL`，`subcause` 透传），**不得**把读失败写成 `unknown`；金额只用 `{amount: DecimalString, currency}`；**不得**回落直连台账。
  - `/v1/reports`：`listReports` 未配 → **501** `unsupported`/`EVOLVE_REJECT`/`unmounted` + `reason`；不得 200 + `[]`。
  - `/v1/projects`、`/v1/issues`：只经 `issuesView` 的 `ticketMirrors`/`issues` 取行（判 `Result`，`Err` → 500，见上）；`state` 是平台原值，不可判时 `unknown` + `rawState`（不折最近态）。
- **导出/依赖**：`mountInfoRoutes`；import `hono`、views（含 `views/observation.ts`）、errors、options。
- **IO 与注入**：`issuesView: IssuesView`（必填，方法名见 80-§9.4 `:2878`）、`finance: FinanceSources`（必填，`:2888`）、`companies[].snapshotProvider`/`listReports`；**不取本进程时钟**——六态时间只用上游给的时间戳（`lastTrustedAt`/`observedAt`），80-§9.4 注入表的 `now` 行判定 api 侧不另收时钟（若确实需要，先改 80 注入表，见缺口-API-14）。本文件按 80 的方法名调用，**不自造别名**、不假设 `Promise`。
- **状态/并发**：每请求快照；不缓存跨请求数据（缓存归装配方）。
- **错误与观测**：422（未知公司/多公司/坏 limit）、501（未挂载）、**500**（读面 `Err` 与 wiring 错位）；`subcause` 原样透出上游码，不回显路径；**不得**把 `Err` 记成“空数据”成功，也不得返回绝对路径。日志一行一事件 `{traceId, method, path, status, subcause}`。
- **测试/证据**：`app.info` + golden；覆盖 finance 分段 unknown（缺源）与**单源 `Err` → 500**、reports 501、people 聚合、limit 422、**读面 `Err` → 500 且 body 不是空 `items`**（`fake-issues-view` 的“投影不可用”变体）；不证明真实台账投影。
- **规模与迁移**：≤260 行；M2 新建。拆自 `panel/external/server.ts:286`–`:394`，不得把触发逻辑混入；超限按 info/finance 拆两个路由文件。

### F-api-routes-trigger

- **路径/处置**：`packages/api/src/routes/trigger.ts`；**目标-新增**。
- **归属**：80-§9.4 触发面（4 条 POST，只产意图）、状态表；80-§6.6；77-§1.4；78-§11.3。
- **职责**：`POST /v1/requests`、`/v1/explore`、`/v1/tasks`、`/v1/intel` 的统一入口：鉴权 → 配额 → 公司 → 入参 → dedupKey → 构造 payload → 提交 → 回执。
- **非职责**：不落单、不派工、不写台账/平台；不判断受理结论（`REC-WORK-02` 归 daemon）；不判重（ingress 判）。
- **内部结构**：
  - 信封 `{title, body, dedupKey, requestedAt, ticket?, subjectRef?, correlation?}`——字段名与 80-§6.6 的 `WebhookIntentPayload` 同名（`dedupKey` **不是**旧面的 `idempotencyKey`；`requestedAt` **必填**）。四端点**只差 `requestKind`**：`requests/explore/tasks/intel` → `request/explore/task/intel`（80-§6.6 已定，原缺口-API-02 关闭）。信封外的顶层字段**忽略**，不进 payload（避免污染摘要域）；体里带 `requestKind`（或 `source`/`kind`）一律 **422**，防止端点与正文双源。
  - 顺序冻结：`checkToken` → `quota.take` → `resolveCompany` → 解析 JSON/字段 → `requireDedupKey` → `buildWebhookPayload` → `submitAndClassify` → `httpOf`。
  - 入参：适配器已按实际字节拦 413；本文件再验 `title` 非空 ≤500、`body` 字符串 ≤20_000、`dedupKey` ≤200、`requestedAt` 形状（76-§1.2：带偏移 + 秒必填）；坏 JSON/缺字段 → 422 `fieldPath`。413 的 body 是 `body-too-large`、**不落记录**、**不带** `fieldPath`（80-§9.4 `:2836`）。
  - 状态（80-§9.4 定稿）：新收 **202** `{receipt}`；同键同摘要 **200** `{receipt, duplicate:true}`；同键不同内容 **409**；入参/公司未挂载 **422**；体超限 **413**；配额 **429**；下游不明 **503**；未预期 **500**（`unavailable`/`STALL`，`subcause:'internal-bug'`；80-§9.4 `:2840` 已定，不再是“未定义”）；路径拼错 **404**（`rejected_precondition`/`EXTERNAL_REJECT`/`not-found`，由 `app.notFound` 给，本文件不产）。
  - 回执：`receipt` 为 `IntentReceipt` 白名单投影；**不带 `outcome`**（202），**不写“已受理”**，不含平台单号；`intentRef` 是 `REC-WORK-01` 的记录 ID，可出现。
  - **回执查询不在本文件**（v0.6 定）：`GET /v1/requests/status` 已由 80-§9.4 `:2804`/`:2814`–`:2822` 定稿，落在 `routes/requests-status.ts`（`F-api-routes-requests-status`），**不是** `routes/trigger.ts` 的子路由，也**不是**旧的 `GET /v1/requests/{dedupKey}` 候选形状（那条作废）。本文件只负责 POST 四端点；查询键的拼装复用 `intent.ts` 的同一函数，**不得**在两处各写一套键格式。
- **导出/依赖**：`mountTriggerRoutes`；import `hono`、auth/*、`submission`、`intent`、errors、options。
- **IO 与注入**：`emitIntent`、`getIntentReceipt`、`token`、`requestsPerMinute`；**不取本进程时钟**（`requestedAt` 来自调用方，六态时间由上游给；api 侧不另收时钟，80-§9.4 注入表 `now` 行）；零 fetch/fs/db。
- **状态/并发**：无本地幂等表；并发同键由 ingress 事务收敛（见 `F-api-submission`）。
- **错误与观测**：状态见上；日志 `{traceId, company, requestKind, status, subcause}` 含幂等键（78-§11.3 证据），不含正文/token。
- **R/E/W/V**：R12（伪造意图/换键重投）、I-6（外部请求不产生授权）、I-11（未知有去向）；E/W **N/A**。验证层 V2（部分负向属 V4 候选）。
- **测试/证据**：`app.trigger` 覆盖四端点、顺序、202/200/409/413/422/429/503、无平台单号、零平台调用（fake sink 只收 `WebhookIntentPayload`）；断言信封键集与 `requestedAt` 必填；不证明引擎消费与落单。
- **规模与迁移**：≤260 行；M2 新建。拆自 `external/server.ts:408`–`:506`；**不得**为四个端点编造不同字段或不同 source。

### F-api-routes-subscriptions

- **路径/处置**：`packages/api/src/routes/subscriptions.ts`；**目标-新增**。
- **归属**：80-§9.4 订阅面与 501 行（`/v1/events` 在**10 条读面**里算一条，但**按订阅面计**且当前 501，`:2810`/`:2841`）；78-§11.3（SSE 未实现 = degrading）。
- **职责**：注册 `GET /v1/events`（10 条读面之一，归本面）与 `GET /v1/subscriptions`；注入缺失时**明说未挂载**——两条都 501 + `reason`。
- **非职责**：不实现投递、退避、熔断、死信、HMAC；这些在 75–80 没有端口/存储/密钥来源（缺口-API-04），不得私造。
- **内部结构**：
  - `GET /v1/events`：`eventsSource` 未注入 → **501** `{error:{failure:'unsupported',category:'EVOLVE_REJECT',subcause:'unmounted'},traceId,reason}`；注入后 → SSE：首帧 `ready`（带当前游标）、按 `event id` 去重、`Last-Event-ID` 续传、客户端断开即停。**不得**返回 200 空流冒充“无事件”。
  - `GET /v1/subscriptions`：**501** + `reason`（缺投递存储/HMAC 密钥/退避策略）；**不得**返回空列表。
  - `eventsSource` 的类型与游标形状 80 未定（缺口-API-04）：定稿前只允许 501，不允许“先写一个游标字段”。
- **导出/依赖**：`mountSubscriptionRoutes`；import `hono`、errors、options。
- **IO 与注入**：SSE 流；无库读（`eventsSource` 由装配方提供读面）。
- **状态/并发**：每连接一个游标；断开清理；不共享可变游标。
- **错误与观测**：501 带 `reason`；SSE 读面异常 → 结束流并记 `traceId`，不得重连风暴。
- **测试/证据**：`app.info` 断言 `/v1/events` 与 `/v1/subscriptions` 仍 501 且带 `reason`；`http.adapter` 只证明 SSE 管道能力，不证明订阅语义。
- **规模与迁移**：≤120 行；M2 新建；实装阻塞于缺口-API-04。

### F-api-routes-requests-status

- **路径/处置**：`packages/api/src/routes/requests-status.ts`；**目标-新增**。
- **归属**：80-§9.4 回执查询端点（路由表行 `:2804`、**硬约束 1–7 `:2814`–`:2822`**、状态表 `:2830`/`:2839`）；80-§6.6 规则 5/8（`get` 读内存快照、不参与重放判定）；77-§1.4；78-§11.3；M4#11（`:2980`）。
- **职责**：注册 `GET /v1/requests/status`：鉴权 → 配额 → 参数校验 → 用**同一个** `intentKeyOf` 拼 `IntentKey` → 调 `opts.getIntentReceipt(key)` 读**本进程已提交投影快照** → `200 {receipt}` / `503 receipt-not-in-snapshot`。这是 78-§11.3“客户端超时后按幂等键查询”的对外出口。
- **非职责**：**不查 SQLite、不调 `refresh`/`rebuild`、不触发 `replayQueued`、不物化任何记录**；**不**因为快照没有该键就断言“权威记录不存在”（那是 `Ok(undefined)` 的语义边界，不是 404）；不重投、不补发、不写 `REC-*`、不写审计（缺口-API-06）；不缓存回执（含进程内 LRU/负缓存）。
- **内部结构**：
  - 查询参数（**名字与顺序固定**）：`company`、`source`、`kind`、`dedupKey` 必填，`ticket` 可选；**第四槽位 = `ticket ?? dedupKey`**，与 `intentKeyOf`（`core/src/decide.ts:319`–`:322`）逐位一致——本文件**调用** `intent.ts` 暴露的同一函数，**不得**另写一套拼接（拼接即第二套键格式）。
  - **拒绝 `key=` 拼接串**：不得接受 `key`/`intentKey` 之类整串参数，也不得从 `body`/`correlation`/`referer` 猜缺失字段。
  - 顺序冻结：`checkToken`（缺/空头 → **401**；坏 → **403**）→ `quota.take`（**429** + `retryAfter`，与 POST 同口径）→ 参数校验（**422**）→ 来源白名单（`source` 不在 `opts.config.external.allowedSources` ⇒ **403**）→ `intentKeyOf` → `getIntentReceipt` → `respondReceiptLookup`。GET **不免令牌**（80 硬约束 7）。
  - 参数校验（全部落 **422** `rejected_precondition`/`CONFIG_INVALID` + `fieldPath`，**不落记录**）：缺任一必填；`company` 不合 slug 规则（`SLUG_RE`）；`source`/`kind` 按 80-§6.6 取值域做**字形**校验（`source` 只验来源名允许的字符集与长度、**不查 `SourceRegistry`**；`kind` 固定 `'webhook'`）；`dedupKey`/`ticket` 长度 **>256** 或超出字符集 `[A-Za-z0-9._:-]`；重复同一参数名。**`source` 还必须在 `opts.config.external.allowedSources` 内**（80-§3.3 `:248`、§6.6 `:2057`）：不在表内 ⇒ **403** `rejected_forbidden`/`EXTERNAL_REJECT`（80-§9.4 M4#11 `:2982` 的“来源不允许 ⇒ 403”），**不得**改 422、也不得当作“查无”回 503。**公司是否挂载只校验形状、不查目录（本卷定；80 硬约束 1/5 只要求参数受限）**——读目录会引入第二个事实源；形状合法但未挂载的公司自然查无 ⇒ `503`，**不得**因此改 422/404。
  - 命中：**200** `{ receipt }`——`receipt` 与 202/200 的**同形同源**（同一个 `IntentReceipt`，经 `receiptView` 白名单）：`status:'queued'` 时**不补** `outcome`；`decided` 带五值 `outcome` 与 `intakeRecordRef`；`unknown` 带 `unknownRef`（孤儿未知可缺省，但此时必须同时带 `gap`）。**不带 `duplicate`**（本端点不是重投），也不另造 `status` 字符串或包装层。
  - 未命中：`getIntentReceipt` 返 `undefined` ⇒ **503** `{error:{failure:'unavailable',category:'STALL',subcause:'receipt-not-in-snapshot'},traceId}`——快照没有只证明“本进程没投影到”，可能是 `gap:'intake-link-missing'`、重建后仍未覆盖或键拼错，**不能**据此断言权威不存在；**不得**回 404、不得回 200 空对象、不得回落查库、不得 `refresh` 一下再判。
  - **404 只由 `app.notFound` 产生**（路径拼错），本文件**永不**返回 404；两者语义不得互换（80-§9.4 `:2845` 的“三个易混边界”）。
  - 响应头：**成功与失败都带 `Cache-Control: no-store`**（回执含 `bodyDigest`/`intentRef`/`unknownRef` 等内部引用，不得进共享缓存）。
  - **零写零重放**：本文件不 import `engine`、不持 `Ledger`/`Database`、不调 `emitIntent`；连查 N 次只产生 N 次快照读，`REC-WORK-01` 行数、`intentRef`、回执内容**全部不变**。
- **导出/依赖**：`mountRequestsStatusRoutes(app, ctx)`；`ctx = { getIntentReceipt, token, requestsPerMinute, intentKeyOf }`；import `hono`、`auth/token`、`auth/quota`、`errors`、`options`、`intent`（键函数与信封类型）。**不** import `store`/`daemon`/`engine`/`panel`。
- **IO 与注入**：唯一 IO 是 `opts.getIntentReceipt`（读内存快照）；零 fs / 零 db / 零 fetch / 零时钟（TTL 由 ingress 持有，本端点不设“回执可查窗口”）；查询串不回显、不入日志原文之外的用途。
- **状态/并发**：无状态、无本地缓存；每请求直读一次快照；并发同键查询互不影响（只读）。
- **错误与观测**：401（缺/空令牌）/403（坏令牌 或 来源不在 `allowedSources`）/429/422/503；未预期 500（`unavailable`/`STALL`/`internal-bug`）。日志一行一事件 `{traceId, company, source, kind, status, subcause}`（含幂等键供 78-§11.3 证据，**不含** token、wkey、URL 原串）；`503` 的日志必须写 `receipt-not-in-snapshot`，**不得**写成“not found”或“unknown company”。
- **R/E/W/V**：R12（不伪造意图、不换键重投）、I-11（未知有去向：`503` 而非 `404`/`200` 空体）；78-§11.3；E/W **N/A**。验证层 V2（部分负向属 V4 候选）。
- **测试/证据**：`app.requests-status`（`F-api-test-requests-status`）覆盖 401/403/429/422/200/503、`no-store`、`ticket` 与 `dedupKey` 两种命法、连查零 `submit`/零 ingest、拼错路径走 404；不证明真端口、daemon 装配、快照重建。
- **规模与迁移**：≤120 行；M2 新建；**新增能力，不拆自 `panel`**（旧面没有这个端点，`panel/src/external/server.ts` 里也没有可搬的查询分支）。超限先抽参数校验到 `routes/requests-status/validate.ts` 子目录，**不得**把查询逻辑塞进 `routes/trigger.ts` 或 `routes/info.ts`。

### F-api-view-agent-card

- **路径/处置**：`packages/api/src/views/agent-card.ts`；**目标-新增**。
- **归属**：80-§9.4 信息面（agent-card）；78-§11.3 端点版本化。
- **职责**：`CompanySnapshot` → Agent Card：`framework/name/slug/version/platform/endpoints/contact`。
- **非职责**：不把未实装端点写进清单（agent-card 是广告面，不得广告 501 面）；不证明名片可被外部信任。
- **内部结构**：
  - `EXTERNAL_ENDPOINTS`：只列**已实装**端点；`auth` 为 `none`（信息面）或 `token`（触发面）。
  - `buildAgentCard(snapshot, {contact?, version?})`：`version` 缺省取本包常量；`contact` 未提供 → `null` + 状态说明，不用占位文本冒充联系位（80-§9.4 “未配=明说未挂载”）。
  - `FRAMEWORK_VERSION`：**来源未定**（缺口-API-09）。在 76/80 定稿前只允许保留一个常量；不得从 `package.json` 或环境动态推导。
- **导出/依赖**：`buildAgentCard`、`EXTERNAL_ENDPOINTS`、`AgentCard`、`EndpointSpec`；import contract 类型。
- **IO 与注入**：纯函数。
- **状态/并发**：无。
- **错误与观测**：无；缺字段以 `null`/省略如实表达。
- **测试/证据**：`views.test` 固定名片形状与端点清单；`app.info` 覆盖 HTTP。
- **规模与迁移**：≤100 行；M2 新建。拆自 `external/views.ts:35`–`:88`。

### F-api-view-company

- **路径/处置**：`packages/api/src/views/company.ts`；**目标-新增**。
- **归属**：80-§9.4 装配决策 3（纯投影归 `company`）；§9.4 信息面；§9.6。
- **职责**：公司清单、组织树、人事索引、报表清单四个快照派生视图的**白名单投影**。
- **非职责**：不重算组织/进度/财务口径（分别复用 `company` 的目标纯函数）；不读库。
- **内部结构**：
  - `companySummary(snapshot)`：`slug/name/level/charter_ref/platform/departments(数量)/people(数量)/jobs(数量)`——键名与旧面一致（`external/server.ts:306`–`:318`）。
  - `orgView(snapshot)`：`departments` 显式列 `name/path/parent/leader/level/lanes/functions/relations`；`warns` 来自 `buildOrgTree` 的 `promoted`/`cyclic`（M1 后从 `company` 取）。
  - `peopleView(snapshot)`：**public 只出聚合** `{ total, byDept, byLevel }`；逐人明细只在 `partner`/`internal`，而该分级 75–80 未定义（缺口-API-08），故 M2 **不输出任何逐人行**。**任何层级都排除** `costCaps`（人日预算）、`skills`（内部工种映射）、联系方式与 `PersonRef` 原对象。现有 `personView` 用 `{...p}` 直出（`external/views.ts:156`–`:158`），目标禁止。
  - 冲突登记：80-§9.4 的公开分级与 M4#1“信息面逐字段一致”互相矛盾；本附录取**分级优先**，M4#1 的一致性范围收窄到非个人字段（缺口-API-08 须由 80 裁决）。
  - `reportsView(listReports)`：`{file, bytes?}` 列表；正文不出（沿用 `REPORTS_BODY_NOTE` 语义，但未挂载时由路由 501，不返回空列表）。
- **导出/依赖**：上述函数/类型；import `@studio-next/company`（目标 `buildOrgTree`）、`@studio-next/contract`。
- **IO 与注入**：纯函数；无时钟（需要公司本地日时必须显式传偏移，80-§9.4 决策 3）。
- **状态/并发**：无。
- **错误与观测**：无；悬空/成环以 `warns` 如实表达，不静默修正。
- **测试/证据**：`views.test` 覆盖字段白名单（含“PersonRef 带 costCaps 时不出现”）、悬空/成环 warns、报表清单。
- **规模与迁移**：≤180 行；M2 新建。**前置 M1**：`buildOrgTree` 尚未在 `company` 导出（grep 无命中）；M1 未完成前不得用复制 `panel` 代码的方式绕过。

### F-api-view-issues

- **路径/处置**：`packages/api/src/views/issues.ts`；**目标-新增**。
- **归属**：80-§9.4 信息面（issues/projects）；§9.5 只读。
- **职责**：镜像行的分页/过滤投影与项目卡聚合。
- **非职责**：不写镜像、不聚合平台实时态；不把未知当 0。
- **内部结构**：
  - `filterIssues(rows, {company?, state?, limit})`：先公司、再状态、再截断；`limit` 缺省 20、上限 200（`MAX_PAGE_SIZE`，与 `panel/src/server.ts:85` 同值；两份实现各自持有常量，差异进 82 对齐清单）。**出参一律 `{items, nextCursor}`**（80-§6.3 `RecordPage`：`nextCursor: string | null`，末页必须 `null`，游标 opaque 且调用方不得解析）——不得“只截断不给下一页”。
  - **本文件只收已解包的 `rows`**：`Err` 在 `routes/info.ts` 判完并走 500，**不得**给本文件传 `[]` 冒充“没有行”（那会把读失败洗成空页，违反 80-§8.2 `:2610`/D21 `:3642`）；本文件也**不得**在内部 `try/catch` 或 `?? []`。`nextCursor` 由上游 `RecordPage` 原样透出，本文件**不生成**游标（生成游标=第二套分页口径）。
  - `issueView(row)`：**显式列** `issue/company/created/updated/state/type/dept/level/dispatcher/parent?/lane?/assignee?`；禁止 `{...row}`（现状 `external/views.ts:110`–`:112` 是整行直出，未来新增列会无审查外泄）。
  - `state` 是**平台原值**：平台→`STAT-D` 的映射与 `StateMapping.verification` 归绑定层（78-§1.2 `BIND-CORE-01`、§9.5/§9.6），本包只读结果。映射不可判时输出 `unknown` + **保留原值**（`{state:'unknown', rawState:'…'}`），**不得**折到“最近态”，也**不得**把 `unverified` 当“可迁移”。注意 `state:'unknown'` 是**行级**不可判，与“整页读失败”是两件事：后者是 `Err`→500，绝不能用 `state:'unknown'` 顶替。
  - `buildProjectCards(snapshots, rows)`：每司 `{company,name,platform,total,byState}`；`total/byState` 复用 `company` 的 `buildProgressSnapshot`（M1 后），不另立口径；`byState` 的键同样只取平台原值 + `unknown`。
- **导出/依赖**：上述；import `store` 的 `TicketMirrorRecord` **类型**、`company` 的目标投影、`contract`。
- **IO 与注入**：纯函数。
- **状态/并发**：无；输入数组不被修改。
- **错误与观测**：无（不抛、不吞 `Err`——`Result` 的解包在路由层）。
- **R/E/W/V**：I-11（未知必须有去向——不可判状态不得以 0/最近态顶替）、D75-06（未知不显示为 0）；E/W **N/A**（属员工/工作绑定档案）。验证层 V2。
- **测试/证据**：`views.test` 覆盖过滤/截断/字段白名单/多司隔离/`nextCursor` 语义/不可判状态保留原值；`app.info` 覆盖 HTTP，并断言“读面 `Err` → 500 而非空 `items`”；`submission.test` 不涉本文件。
- **规模与迁移**：≤150 行；M2 新建。拆自 `external/views.ts:92`–`:133`。

### F-api-view-finance

- **路径/处置**：`packages/api/src/views/finance.ts`；**目标-新增**。
- **归属**：80-§9.4 装配决策 3 与 `finance: FinanceSources` 定义（`:2888`）；§9.6。
- **职责**：把注入的预算/事件/月报行交给 `company` 的 `buildFinanceSnapshot`，输出对外财务卡。
- **非职责**：不直连台账、不重算三口径、不补零；月报快照不可读时保留行并标未知（`buildFinanceSnapshot` 的 `metrics=undefined` 语义）。
- **内部结构**：
  - `financeView({slug, budgets, mirrors, peopleIds, events, reports?, readReportFile?})` → `FinanceSnapshot`。
  - 数据来源（v0.6 已定）：`opts.finance: FinanceSources` 三源——`budgets(company)` / `eventCosts(company)` / `monthlyReports(company)`（80-§9.4 `:2888`）；镜像行来自 `issuesView`。**三源都由装配体用 `openLedgerReadonly` 现构**，本文件不碰库、不 import `store` 运行时代码。**源未挂载** ⇒ 该段 `unknown` + 原因，路由 **200**（不是 501；80-§9.4 明令），**不得**补 0；**任一源 `Err`** ⇒ 整段失败（路由 500），**不得**把读失败写成 `unknown`。
  - **金额形状**：对外只出 `{ amount: DecimalString; currency: string }`（80-§4.1 `TS-SCALAR-09`：公共金额一律字符串 + 显式币种；`Money.usd: number` 只作内存计算与旧记录兼容，**不得**进 API 响应）；边界转换不经 float、不四舍五入。
  - **分段未知**统一用 `views/observation.ts` 的 `Observed<T>` 表达，不另立“缺省 0 / 空对象”的第三套写法。
- **导出/依赖**：`financeView`；import `@studio-next/company`（目标 `buildFinanceSnapshot`）、`@studio-next/store` **类型**（`BudgetRecord`/`EventRecord`/`ReportFile`）、本包 `views/observation.ts`。
- **IO 与注入**：纯函数；三源由 `routes/info.ts` 从 `opts.finance` 取好后传入（本文件不做 IO）；`readReportFile` 若由装配方提供则是唯一文件读点（当前未定义注入，缺口-API-03 残余）。
- **状态/并发**：无。
- **错误与观测**：无；缺数据显示 `unknown` + 原因，不显示 0；**本文件不接触 `Result`**——解包在路由层（`Err` → 500）。
- **R/E/W/V**：I-11（未知有去向）、D75-06（未知不显示为 0）；E/W **N/A**。验证层 V2。
- **测试/证据**：`views.test` 用合成行覆盖三口径与月报不可读标注（含金额为 `DecimalString` 的序列化形状）；`app.info` 断言“**某源未挂载 ⇒ 200 + 该段 unknown**”与“**任一源 `Err` ⇒ 500**”两种情形。
- **规模与迁移**：≤140 行；M2 新建；三源注入由 `opts.finance` 提供（80-§9.4 已定），残余只是 `monthlyReports`/`readReportFile` 的正文读取形状（缺口-API-03），**路由不得因此改 501**。

### F-api-view-observation

- **路径/处置**：`packages/api/src/views/observation.ts`；**目标-新增**。
- **归属**：80-§6.3（`ProjectionName` 含 `observation`、`ObservationProjectionResult.state: ObservationState`）、77-§9.2（六态唯一来源）、80-§9.6（响应形状未定）。
- **职责**：一个 `Observed<T>` 信封与六个构造器，供 `views/finance.ts`、`views/issues.ts`、`routes/info.ts` 统一表达“已观察/已推导/未知/陈旧/冲突/缺口”。
- **非职责**：**不产出六态判定**——六态只由 `TS-PORT-OBS-01` 产出（80-§6.3），本文件只承载与序列化；不定义第二套状态字面量。
- **内部结构**：
  - `Observed<T> = { state: ObservationState; value?: T; reason?: string; lastTrustedAt?: Timestamp }`——`state !== 'observed'` 时 `value` 可缺省，**不得**用 `0`/`[]`/`{}` 填充；`reason` 是稳定短原因码（给人看），`lastTrustedAt` 只在值曾经可信时有意义。
  - 六个构造器：`observed(value)`、`derived(value, reason)`、`unknown(reason)`、`stale(value, lastTrustedAt, reason)`、`gap(reason)`、`conflict(reason)`；六值与 77-§9.2 一一对应，**不增不减**。
  - `serializeObserved(o)`：显式白名单；`value` 由调用方给已白名单化的视图，本文件不加字段。
- **导出/依赖**：上述类型、构造器、序列化函数；import `@studio-next/contract` 的 `ObservationState`（目标落点未定，见缺口-API-16）与 `Timestamp`。
- **IO 与注入**：纯函数；**无时钟**（`lastTrustedAt` 由上游给，本文件不取 `now()`）。
- **状态/并发**：无。
- **错误与观测**：不抛；不可判定入参按最保守态（`unknown`/`gap`）表达，不得静默 `observed`。
- **R/E/W/V**：I-11（未知有去向）；验证层 V2。
- **测试/证据**：`views.test` 断言六态构造与“未知不补 0”；`app.info` 断言 finance 分段与 issues 不可判状态走的都是本信封。
- **规模与迁移**：≤90 行；M2 新建。**类型落点未定前**只允许本文件持有 `ObservationState` 的引用，`views/*` **不得**各写一份 `'unknown' | 'stale' | …` 字面量（那会造出第二套六态）。

---

## 五、逐文件：目标测试与夹具

> 测试只对**契约与冻结验收口径**负责，不对实现细节负责。以下全部为“仅测试/演示”件，不得进入生产装配。

### F-api-test-app-info

- **路径/处置**：`packages/api/test/app.info.test.ts`；目标-新增（仅测试）。
- **职责**：进程内 `app.request()` 驱动 **8 条信息 GET + `/` 索引**（10 条读面里的 9 条；第 10 条 `GET /v1/requests/status` 归 `app.requests-status`）；`/v1/events` 与 `/v1/subscriptions` 也在本文件断言 501。
- **覆盖**：公司解析两态（自动/422 `unknown-company`/422 `company-required`，均带 `fieldPath:'company'`）；快照 slug 错位 500；`/v1/company` 计数形状；`/v1/org` 悬空/成环 warns；`/v1/people` **只出聚合**（无逐人行、无 `costCaps`/`skills`）；`/v1/projects` 他司行不混入；`/v1/issues` state/company/limit（坏 limit → 422）与 `{items,nextCursor}`（末页 `nextCursor:null`、不可判状态 `state:'unknown'` + `rawState`）；**读面 `Err` → 500**（`fake-issues-view` 注入 `Err({failure:'unavailable',category:'STALL',subcause:'ledger-read-failed'})`，断言状态 500、`subcause` 原样、body **不含** `items`/`nextCursor`）；`/v1/finance` **200 + 三段 `Observed` unknown + 原因**（不是 501、不是 0；金额为 `{amount: DecimalString, currency}`）；`/v1/reports` 未挂载 **501 + reason**；`/v1/events`、`/v1/subscriptions` 501；`/v1/agent-card` 版本常量与 `contact:null`；未匹配路径 **404 = `rejected_precondition`/`EXTERNAL_REJECT`/`not-found`**（只由末级 `notFound` 产生）；错误体四键形状（`error.failure/category/subcause` + `traceId`）。
- **夹具/断言**：`fake-company.ts`（合成 `CompanySnapshot`）+ `fake-issues-view.ts`（确定性镜像行，**且能返回 `Ok(page)`/`Err(...)` 两种**）+ 可编程的 `FinanceSources` 空实现 + `info-golden.json`（旧面逐字段基线，个人字段按分级修剪并记录差异）。断言键集合与值，不调用 LLM、不启端口；**404 与 500 的取值已由 80-§9.4 定稿**（404 = `rejected_precondition`/`EXTERNAL_REJECT`/`not-found`，`:2834`；500 = `unavailable`/`STALL` 且 `subcause` 透传，`:2840`），断言可直接锁具体值，但仍须锁住“读面 `Err` 不降级成空页”这一行为；413 形状已定（`:2836`），由 `app.trigger` 断言。
- **不证明**：真端口、daemon 装配、台账投影、六态新鲜度判定（本文件只证明构造器与序列化，不证明 `TS-PORT-OBS-01` 的判定）、网络暴露面。
- **规模**：≤440 行。

### F-api-test-requests-status

- **路径/处置**：`packages/api/test/app.requests-status.test.ts`；目标-新增（仅测试）。
- **职责**：`GET /v1/requests/status` 的正反用例——鉴权 → 配额 → 参数 → 快照命中/未命中；证明该面**只读快照**（零库查询、零重放、零写入），并把“查询不是提交”固定成断言。
- **覆盖**：**401** 缺头/空头；**403** 令牌坏值、`source` 不在 `allowedSources`（两路都回 `rejected_forbidden`/`EXTERNAL_REJECT`；后者**不得**降成 422 或“查无”503）；**429** 与触发面共用配额桶（同键连打触发面后查询面同样 429）；**422**（均带 `fieldPath`）缺 `company`/`source`/`kind`、`ticket` 与 `dedupKey` 双缺、`dedupKey` 空串、单槽超 `INTENT_KEY_PARAM_MAX=256`、含 `INTENT_KEY_PARAM_RE` 之外字符（空格/`/`/换行）、同名参数重复出现；键槽 `ticket ?? dedupKey`——**同一 `IntentKey` 用 `ticket` 命中与用 `dedupKey` 命中返回同一条**；**200** body 为 `{receipt}` 且**无** `duplicate` 字段（查询不得回重投语义）；`queued` 不带 `outcome`，`decided` 带 `outcome` + `intakeRecordRef`；`receipt()` 返 `undefined` → **503 `receipt-not-in-snapshot`**，错误体四键齐全且**不含** `receipt`；200 与 503 **两者**都带 `Cache-Control: no-store`；连查 3 次后 `fake-intent-sink.submit` 调用次数仍为 0 且 `intentRef` 不变；拼错路径 `/v1/requests/stats` → **404 `not-found`**（不是 503、不是空 200）。
- **夹具/断言**：`fake-intent-sink.ts`（`receipt` 按 `IntentKey` 返 `queued`/`decided`/`undefined`，并对 `submit` 计数）+ `fake-company.ts` + 可编程的 `IssuesView`/`FinanceSources` 空实现（仅满足 `ApiServerOptions`，本面不读它们）；配额窗口用 `vi.useFakeTimers()`。断言状态码、body 键集与 `subcause` 字面值，不启端口、不调用 LLM。
- **不证明**：真端口、daemon 装配、快照重建与“投影/记录同事务”（归 `app.lifecycle` 与 `submission` 用例）、权威记录是否存在（快照 `undefined` **不等于**不存在）、中间层缓存是否真的遵守 `no-store`。
- **规模**：≤260 行（若超限，拆 `requests-status.params.test.ts`，仍在本目录）。

### F-api-test-app-trigger

- **路径/处置**：`packages/api/test/app.trigger.test.ts`；目标-新增（仅测试）。
- **职责**：触发面四端点的鉴权/配额/入参/提交/回执联合行为。
- **覆盖**：四端点只差 `requestKind`（`request/explore/task/intel`）；顺序 401/403 → 429 → 422（鉴权先于配额、配额先于公司/入参）；坏 JSON/缺字段/超长 → 422；分块 body 实际字节 → **413**（`body-too-large`、不落记录、无 `fieldPath`）；`dedupKey` 含 `;`/换行 → 422；**`requestedAt` 缺失/无偏移/无秒 → 422 `fieldPath:'requestedAt'`**；体里带 `requestKind` → 422；新收 **202** `{receipt}` 且 body **无** `outcome`；同键同摘要重放 **200** `{receipt, duplicate:true}` 且只 `submit` 一次；同键不同内容 **409**；`Err(unavailable)` → **503**；`emitIntent` **throw** 且回执 `queued` → 200、`unknown` → 503、查无 → 503；202/200 body 不含平台单号与“已受理”措辞；全程零 `platform.issues.create`（fake sink 只收 `WebhookIntentPayload`）。
- **夹具/断言**：`fake-intent-sink.ts`（实现 `IntentSubmissionPort`：`submit` 记录 payload、可注入 `Ok`/`Err`/throw；`receipt` 可按 `IntentKey` 返 `queued`/`decided`/`unknown`/`undefined`）+ `fake-company.ts`；配额窗口用 `vi.useFakeTimers()`（api 侧不另收时钟，80-§9.4 注入表无 `now` 行）；断言信封键集 `{source:'external-api', kind:'webhook', requestKind, company, dedupKey, ticket?, body:{title, detail?}, requestedAt}`。
- **不证明**：引擎消费、落单（`REC-WORK-01`）、`PATROL` 留痕、跨重启幂等、真实平台回执、ingress 事务并发。
- **规模**：≤480 行（若超限，拆 `trigger.submission.test.ts`，仍在本目录）。

### F-api-test-app-auth-quota

- **路径/处置**：`packages/api/test/app.auth-quota.test.ts`；目标-新增（仅测试）。
- **职责**：单令牌与固定窗配额的负向矩阵。
- **覆盖**：缺头/空头 401；坏值 403；好值通过；401/403 不耗配额；429 body 为 `{error:{failure:'unavailable',category:'STALL',subcause:'quota'},traceId,retryAfter}`（`retryAfter` 为**秒**、非负整数、**无** `fieldPath`）；按客户端键分桶；窗口滚动恢复；响应体不含令牌/哈希/堆栈/绝对路径。**装配期缺 `token` 不在本文件**——那是 `app.lifecycle` 的拒启用例（80-§9.4 注入表 `token` 行）。
- **夹具/断言**：`vi.useFakeTimers()` 推进窗口；进程内测试的客户端键只能经 header 设置，**socket 覆写**归 `http.adapter` 真端口用例，避免把 header 当真。
- **不证明**：来源 IP 限制、TLS、多进程共享配额、`allowedSources`（ingress 侧）。
- **规模**：≤260 行。

### F-api-test-app-lifecycle

- **路径/处置**：`packages/api/test/app.lifecycle.test.ts`；目标-新增（仅测试）。
- **职责**：构造期校验与 `serveApi` 生命周期。
- **覆盖**：空公司数组/重复 slug/坏 slug/缺 `emitIntent`/缺 `getIntentReceipt`/缺 `issuesView` → `CONFIG_INVALID`（子因逐个断言）；构造失败时零监听；`serveApi(0)` 返回实际端口；`close()` 幂等；`EADDRINUSE` 上抛不换端口。
- **夹具/断言**：`fake-company` + `fake-issues-view` + `fake-intent-sink`；端口 0；不触碰台账。
- **不证明**：`ServeConfig.external` 关闭/开启两态与“整机拒启”——那是 `assembly/api/assemble.ts` 与 `runServe` 的行为（17），本文件只证明 api 自身“缺件必抛”。
- **规模**：≤240 行。

### F-api-test-http-adapter

- **路径/处置**：`packages/api/test/http.adapter.test.ts`；目标-新增（仅测试）。
- **职责**：`toWebRequest` / `forwardResponse` / `listenApi` 的真端口行为。
- **覆盖**：`127.0.0.1:0` 监听与关闭；POST body 转发；无 `Content-Length` 的超限分块 → 413；同跳头（`connection` 等）不进 Hono；入站伪造 `x-sn-client-key` 被 socket 值覆写；`RemoteAddress` 分桶可见；SSE 增量可读、客户端断开后服务端停止；已发头后的异常只销毁连接。
- **夹具/断言**：最小 Hono app（不回连 api 业务）；真实 `fetch` 到回环地址；超时上限固定，避免挂死。
- **不证明**：api 业务路由、装配、部署网络/防火墙、真实订阅语义。
- **规模**：≤320 行。

### F-api-test-views

- **路径/处置**：`packages/api/test/views.test.ts`；目标-新增（仅测试）。
- **职责**：纯投影单元测试。
- **覆盖**：`companySummary` 键集；`orgView` warns；`peopleView` **只出聚合且不含任何人字段**（`costCaps`/`skills`/联系方式）；`issueView` 显式字段（新增列不外泄）与不可判状态保留 `rawState`；`filterIssues` 过滤/截断/`nextCursor`；`buildProjectCards` 多司隔离与稳定排序；`buildAgentCard` 端点清单只含已实装面；`financeView` 缺源时三段 `Observed` unknown + 原因（不补 0）与 `{amount: DecimalString, currency}` 序列化；`views/observation.ts` 六态构造器各一例、`value` 缺省不用 0/`[]` 顶替。
- **夹具/断言**：合成快照/镜像行；不读 fs/db；golden 只断言键集与数值，不断言格式化文本。
- **不证明**：真实公司目录装载、`company` 目标投影未完成前的 M1 行为（前置未落地时相应用例应显式跳过并标注，不得伪造通过）。
- **规模**：≤380 行。

### F-api-test-submission

- **路径/处置**：`packages/api/test/submission.test.ts`；目标-新增（仅测试）。
- **职责**：`submitAndClassify` 的四态映射、键闸与回执白名单。
- **覆盖**：`requireDedupKey` 的空/超长/`;`/换行/非字符串 → 422 型错误；`Ok(!duplicate)` → 202；`Ok(duplicate)` → 200 + `duplicate:true`；`Err(rejected_idempotency)` → 409；`Err(unavailable)` → 503；`throw` 后回执 `queued`/`decided` → 200、`unknown` → 503、`undefined` → 503 **且断言不触发任何重放/补发**（`undefined` = 快照无此键，非“未提交”）；**带 `ticket` 时 `intentKeyOf` 的键槽是 `ticket`**（`dedupKey` 不进键）且回查必须带同一 `ticket`；`receiptView` 不含额外字段、`bodyDigest` 原样、`outcome` 是五值标量不改名；202 body 无 `outcome`、无 `pending`。
- **夹具/断言**：`fake-intent-sink`（可编程返回 `Result`/抛错/回执；回执侧模拟“**内存快照**”——不模拟 SQLite，也不给 `get` 造失败轴）；无时钟、无随机；断言 `intentKeyOf` 与 `core/src/decide.ts:319` 公式逐位一致（`[source, kind, company, ticket ?? dedupKey]`）。
- **不证明**：ingress 的 reserve 事务、`intent_receipts` 表投影、**内存快照与 commit 的同微任务关系**（那要 daemon 侧集成测试）、跨重启、引擎 `patrolKeys` 保留期。
- **规模**：≤200 行。

### F-api-test-helper-company

- **路径/处置**：`packages/api/test/helpers/fake-company.ts`；目标-新增（仅测试/演示）。
- **用途**：构造 `CompanySnapshot` 与 `ApiCompanySource`（含 `snapshotProvider`/`listReports`/`contact` 三面）；提供单司/多司、悬空部门、带 `costCaps` 的人员、报表清单等变体；同文件兼作 `IssuesView`/`FinanceSources` 的可编程桩（空实现或注入 `Err`），供信息面与 `finance` 三源用例复用。
- **边界**：纯内存、零 fs；不是公司目录校验器，不证明 `loadCompanyDirectory`。
- **规模**：≤140 行。

### F-api-test-helper-issues-view

- **路径/处置**：`packages/api/test/helpers/fake-issues-view.ts`；目标-新增（仅测试/演示）。
- **用途**：按公司/状态返回确定性 `TicketMirrorRecord[]`；**出参形状照 `ReadOnlyLedger`**——`Ok({items, nextCursor})` / `Ok(undefined)`（`get` 场景）/ `Err(ClassifiedError)` 三种，供 §6.1 的“读面 `Err` → 500”与 `app.info` 用例驱动；另支持“投影不可用”变体（构造期拒绝）。
- **边界**：不打开 SQLite，不证明 store 读面与投影重建；**不**模拟 `RecordReader` 的异步形态（本包只用同步 `ReadOnlyLedger` 读口）。
- **规模**：≤120 行。

### F-api-test-helper-intent-sink

- **路径/处置**：`packages/api/test/helpers/fake-intent-sink.ts`；目标-新增（仅测试/演示）。
- **用途**：实现 `IntentSubmissionPort` 的 fake：`submit` 记录 `WebhookIntentPayload`、可返回 `Ok`/`Err`/抛错；`receipt` 可按 `IntentKey` 返回 `queued`/`decided`/`unknown`/`undefined`；可断言调用次数。
- **边界**：不进入 `WorkIntake.reserve`/`engine.ingest`，不证明判重、落单、派工、`intent_receipts` 投影。
- **规模**：≤80 行。

### F-api-test-fixture-info-golden

- **路径/处置**：`packages/api/test/fixtures/info-golden.json`；目标-新增（仅测试）。
- **用途**：M4#1“信息面 8 条 GET 与旧面逐字段一致”的比对基线。
- **来源要求**：必须由**评审过的旧面响应**采集生成，记录采集时的旧面 commit/端口/输入；不得手写“理想响应”当基线。
- **边界**：只证明字段一致，不证明语义正确；旧面本身若违反白名单（如 `{...row}`），golden 必须显式修剪并记录差异，不得把泄露字段固化。
- **规模**：≤200 行 JSON（数据文件，不计 TS 行）。

---

## 六、端点、数据流与注入

### 6.1 端点矩阵（目标，状态码按 80-§9.4 定稿）

| 方法/路径 | 处理文件 | 认证 | 数据来源（注入） | 缺件/未知时 | 状态码 |
|---|---|---|---|---|---|
| `GET /` | `routes/info.ts` | 公开 | 端点常量 | — | 200（只列 HTTP 路由，不含 MCP） |
| `GET /v1/agent-card` | `routes/info.ts` → `views/agent-card.ts` | 公开 | `snapshotProvider`、`contact?` | `contact` 为 `null` + 说明 | 200 / 422 / 500 |
| `GET /v1/company` | 同上 → `views/company.ts` | 公开 | 同上 | — | 200 / 422 / 500 |
| `GET /v1/org` | 同上 | 公开 | snapshot + `company.buildOrgTree` | — | 200 / 422 / 500 |
| `GET /v1/people` | 同上 | 公开 | snapshot | **只出聚合**（逐人需 partner/internal，未定义） | 200 / 422 / 500 |
| `GET /v1/projects` | 同上 → `views/issues.ts` | 公开 | snapshot + `issuesView: IssuesView` | 构造期缺 `issuesView` = 拒启；读面 `Err` → **500** | 200 / 500 |
| `GET /v1/issues` | 同上 | 公开 | `issuesView: IssuesView` | 构造期缺 = 拒启；读面 `Err` → **500**（不是空页） | 200 / 422 / 500 |
| `GET /v1/finance` | 同上 → `views/finance.ts` | 公开 | `finance: FinanceSources` 三源（`budgets`/`eventCosts`/`monthlyReports`） | 源未挂载 → **200 + 该段 `unknown` + 原因**（不是 501、不补 0）；任一源 `Err` → 整段 **500** | 200 / 500 |
| `GET /v1/reports` | 同上 → `views/company.ts` | 公开 | `listReports?` | 未配 → **501** `unsupported`/`EVOLVE_REJECT`/`unmounted` + `reason` | 200 / 501 / 500 |
| `GET /v1/requests/status` | `routes/requests-status.ts` | `x-sn-token` | `getIntentReceipt`（**内存快照**，不读库） | 快照无此键 → **503** `receipt-not-in-snapshot`；参数不合法 → **422**；缺/空令牌 **401**、坏令牌或来源不在白名单 **403**、配额 **429**；成功与失败都带 `Cache-Control: no-store` | 200 / 401 / 403 / 422 / 429 / 503 / 500（500 只留给内部接线错） |
| `POST /v1/requests` | `routes/trigger.ts` | `x-sn-token` | `emitIntent` + `getIntentReceipt` | 缺注入或 `token`/`requestsPerMinute`/`idempotencyTtlMs` 缺件 = **整机拒启**（不是 401）；`allowedSources` 空数组 = 拒启 | 202 / 200 / 401 / 403 / 409 / 413 / 422 / 429 / 503 / 500 |
| `POST /v1/explore` | 同上 | 同上 | 同上 | 只差 `requestKind='explore'` | 同上 |
| `POST /v1/tasks` | 同上 | 同上 | 同上 | 只差 `requestKind='task'` | 同上 |
| `POST /v1/intel` | 同上 | 同上 | 同上 | 只差 `requestKind='intel'` | 同上 |
| `GET /v1/events` | `routes/subscriptions.ts` | 公开 | `eventsSource?` | 未注入 → **501** + `reason` | 200（SSE，未实装）/ 501 |
| `GET /v1/subscriptions` | 同上 | 公开 | 无投递端口（缺口-API-04） | **501** + `reason` | 501 |

**两条矩阵外的状态码**（v0.6 按 80 主表重写）：① **404** 不属任何一条路由——未匹配路径由 `app.notFound` 统一给 `{error:{failure:'rejected_precondition',category:'EXTERNAL_REJECT',subcause:'not-found'},traceId}`（80-§9.4 `:2834`；**不再**是 `unsupported`/`EVOLVE_REJECT`）。它只表示“路径拼错”，不表示“记录不存在”（回执查无是 `503`），也不表示“读不出来”（是 `500`）。② **500** 在本表出现两次含义：读面 `Err`（`IssuesView`/`FinanceSources` 读失败，三键原样透出 `ledger-read-failed`/`ledger-query-*`）与内部接线错位（`wiring-mismatch`/`internal-bug`）。**两者都是 `unavailable`/`STALL`**（80-§9.4 `:2840`），body 走 `errors.ts` 的统一错误体。**注意**：`ledger-query-unsupported` 的 `category` 是 `EVOLVE_REJECT`、`ledger-cursor-invalid` 是 `EXTERNAL_REJECT`，但 HTTP 码仍固定 **500**——不得因为 `category` 把读面失败改写成 501/409。

**计数（80-§9.4 `:2810`，唯一口径）**：**16 条 = 10 条读面 + 4 条触发 + `/v1/subscriptions` + `GET /`**。10 条读面是 `agent-card`/`company`/`org`/`people`/`projects`/`issues`/`finance`/`reports`/**`requests/status`**/`events`；其中 `/v1/events` **按订阅面计**且当前 501（本表列在 `routes/subscriptions.ts`）。本附录挂 8 条信息 GET + `/` 索引（`routes/info.ts`）、1 条回执查询（`routes/requests-status.ts`）、1 条订阅读面（`routes/subscriptions.ts`）。计数不得再写成 12/13/15，也不得把 MCP 工具目录算进来（另一出口，80-§11.4）。

### 6.2 触发面的唯一意图链（80-§9.4/§6.6）

```text
HTTP POST
  → auth/token.checkToken              （请求缺/空头 → 401；坏 → 403；`token` 未配已在装配期拒启，不在请求期判）
  → auth/quota.take                    （429 + retryAfter；仅计过鉴权者）
  → app.resolveCompany                 （未命中/多司 → 422 fieldPath=company；错位 → 500）
  → 入参校验（JSON/长度/requestedAt 必填） （422）
  → submission.requireDedupKey         （422）
  → intent.buildWebhookPayload         （source='external-api'、kind='webhook'、requestKind、body={title, detail?}）
  → opts.emitIntent(payload)           （装配体原样转发 ingress.submit；daemon 内：校验[来源/kind/requestKind/dedupKey/公司已挂载/body≤bodyLimitBytes] → reserve → 投影 → ingest）
      ├ Ok(!duplicate) → 202 {receipt}
      ├ Ok(duplicate)  → 200 {receipt, duplicate:true}
      ├ Err            → errors.toHttp（409/403/422/413/429/503/501）
      └ throw          → opts.getIntentReceipt(key) → 200 / 503
                          （只读本进程已提交投影的内存快照；undefined ≠ 未提交，不得据此重放）
```

硬纪律（80-§9.4/§9.5/§6.6）：

1. 链上**没有任何** `platform.*` 写、`ledger.*` 写、`launch`；api 不持 `engine`、不持可写 `Ledger`；
2. 判重与落记录**只在 daemon**（`WorkIntake.reserve` 先落 `REC-WORK-01`，再 `ingest`）；api **不得**自建幂等表、不得先占键再发、不得补回执；
3. `202` 只表示“收到、已入队待处理”，**不等于受理**；不得写 `outcome`、不得写“已受理”；
4. 同键同内容 → 200 + `duplicate:true`；同键不同内容 → 409；两者都由 ingress 判，api 只映射；
5. 超时/未知不由 api 编造：`throw` 后只能按幂等键查回执（78-§11.3）；`status:'unknown'` 回 503，不得 202；**查无（`undefined`）同样只回 503**——它是“本进程快照没有该键”，不是“没提交”，**不得**据此重投、补发或重放（80-§6.6 规则 5/8、`:2083`–`:2088`）；
6. 202/200 的 body 只有 `{receipt}` / `{receipt, duplicate:true}`，无平台单号、无 `ok` 包裹；
7. **公司已挂载由 ingress 再判一次**（`deps.isCompanyMounted` 为假 ⇒ `Err(rejected_precondition)` → 422，**不落记录**，80-§6.6 `:2049`）——api 侧的注册表解析只是早退，不是第二事实源；**`body` 上限**在适配器按实际字节拦一次（防分块传输绕过 `Content-Length` 预检，413 `body-too-large`），业务判定仍在 ingress（`:2124`），两侧**同一分类、同一上限数字**，不产生第二种结论。`body` 超限同属 `rejected_precondition`，HTTP 侧走 **413** 而不是 422。
8. **读面的失败不上触发链**（v0.5 起）：本链全程不读台账；`getIntentReceipt` 读的是内存快照（无 `Result` 轴）。信息面的 `IssuesView`/`FinanceSources` 读失败走 500，与本节无关——**不得**把“回执查无”与“台账读不出”写成同一种错误（80-§8.2 `:2610`）。
9. **回执查询是独立只读面，不在本链上**（v0.6）：`GET /v1/requests/status` 只做“鉴权 → 配额 → 参数校验 → `getIntentReceipt`”，**不**产生 `202`/`200 duplicate`、**不**入队、**不**重放、**不**调 `emitIntent`；它与 POST 的唯一共享物是 `intentKeyOf` 与 `opts.getIntentReceipt`（同一份快照、同一套键）。不得把查询“调包”成一次 POST 重投来取状态。

### 6.3 幂等与回执的层次（全部在 daemon，api 无层）

| 层 | 机制 | 归属 | 生命周期 |
|---|---|---|---|
| 记录 | `WorkIntake.reserve` 在一个写事务里查重并追加 `REC-WORK-01`，`intentRef` 立即产生 | daemon（唯一写者） | 永久 |
| 投影 | `intent_receipts`（`receiptId/intentKey/bodyDigest/status/outcome/...`） | daemon `IntentReceiptStore` | 可重建，删表重放逐字段一致 |
| 内存快照 | 本进程**已提交投影**的 `ReadonlyMap` 视图——`IntentReceiptStore.get` 只读它，**不查 SQLite**（80-§6.6 规则 5） | daemon `IntentReceiptStore` | 进程生命周期；启动 `rebuild()` 全量恢复 |
| 事务绑定 | 记录事务内由 store **自持**的 projection hook 同步写投影表；commit 返回后**同一微任务**用同一结果更新快照（无 `await` 间隔） | daemon `IntentReceiptStore` | 无“已提交未投影”窗口 ⇒ **`decided` 不会被读成 `queued`** |
| 判重四态 | 同键同摘要 + `decided` 不入队 / + `queued` 重新入队 / + `unknown` 先对账 / 不同摘要 → 409 | `IntentIngress` | 去重窗 = `idempotencyTtlMs`（80 拟稿 24h，目标配置项；api 不设缺省），仅对 `decided` 与已对账 `unknown` 生效 |
| 引擎留痕 | `PATROL` note `intent=` → `patrolKeys`（append-only） | engine | 不随 TTL 释放 |
| API | **无**——不存键、不存摘要、不存回执 | — | — |

`status` 只有 **`queued` / `decided` / `unknown`** 三值（80-§6.6）；`outcome` 只在 `decided` 后出现、是**五值标量**（77-§4.1）；`pending` 不是状态值，`submitState`/`accepted`/`conditionally_accepted` 一律不得出现。

〔v0.6〕**`get` 与 `refresh`/`rebuild` 的分工不可互换**（80-§6.6 规则 5/8）：`get(key)` 读**内存快照**（不读库、无 `Result` 轴、不修复、**不参与**入队/重放判定）；`refresh(key)` 与 `rebuild()` 才是**按记录现算**并写表 + 更新快照的两条派生路径，二者形状对齐（返回 `Result`）。启动序固定 `schema 闸 → receipts.rebuild()（表 + 快照）→ replayQueued() → 装配 API`；`rebuild` 失败即**整机拒启**，`replayQueued` 只在重建成功后跑（`:2127`）。api 的 `getIntentReceipt` **只转发 `ingress.receipt`**，不碰台账、不调 `refresh`、不补 `queued`。

结论：**api 没有任何 TTL 语义**。TTL 归 ingress：`queued` 不因过期放行，`decided` 24h，`unknown` 未对账不过期；`decided` 过期另立须 `lineage.supersedes` 链旧 `recordId`（80-§9.4 D15）。旧稿“API 内存 TTL + 淘汰后重发”作废——那会制造“API 报新受理、引擎吞掉”的假回执。

〔v0.6〕**回执查询（`GET /v1/requests/status`）只落在快照上**（80-§9.4 `:2814`–`:2822`）：`200 {receipt}` 与 `503 receipt-not-in-snapshot` 是仅有的两个业务结果（外加 401/403/422/429 的拒绝面与 500 的内部故障）。**不**因为 `undefined` 去查库、去 `refresh`、去重放；**不**把 `undefined` 说成 404；**不**复用回执查询做“提交兜底”（提交兜底仍是 `submit` 抛错后的内部回查，见 §6.2 第 5 条）。成功与失败响应都设 `Cache-Control: no-store`。

〔v0.6〕**三条 query subcause 的 `category` 按 80-§6.3 `:1207` 逐字取**：`ledger-query-unsupported` = `unsupported`/`EVOLVE_REJECT`；`ledger-cursor-invalid` = `conflict`/`EXTERNAL_REJECT`；`ledger-query-invalid` = `rejected_precondition`/`CONFIG_INVALID`；`get` 的运行期失败 = `unavailable`/`STALL`/`ledger-read-failed`。它们的**处置轴是 `failure`**，HTTP 码由 API 面固定（读面一律 500），**不得**按 `category` 二次分派；`STATE_CONFLICT`/`MERGE_CONFLICT` 都不得出现在非合并域的 query 错误里（后者只在合并域显式覆盖时使用）。

〔v0.5 起〕**两类“读不到”不得混写**：信息面的 `IssuesView`/`FinanceSources`（`ReadOnlyLedger.query`/`get`，**同步 `Result`**）读的是台账，失败一律 `Err` → **500**（透出 `ledger-read-failed`/`ledger-query-*`，**不得**渲染成空页/0）；回执面的 `receipt()` 读的是**内存快照**，**没有失败轴**，只有 `undefined`（= 快照里没有该键，**不证明**库里没有）。把两者混为一谈——例如把 `receipt()` 的 `undefined` 当“台账读失败”、或把 `query` 的 `Err` 当“没有行”——即判负（80-§8.2 `:2610`、D21 `:3642`、S9 `:3665`）。

`status:'unknown'` 的**唯一合法来源**是 `REC-EVT-03.unknown_scope.intentRef` 指向本条 `REC-WORK-01.recordId`（80-§6.6 第 4 条）；缺这条链时投影保持 `unknown` + `gap:['unknown-link-missing']`，`unknownRef` 缺省，**禁止**自动重放、**禁止**另立同键新意图。api 侧看到 `gap` 非空时**不得**替 daemon 猜一个 EVT-03 补链，也不得把 `unknown` 改写成 `queued`/`decided`；HTTP 侧分两条路——**正常路径**（ingress 返回 `Ok({receipt, duplicate:true})`，80 四态表即如此）回 **200** 并照实带 `status:'unknown'` 与 `gap`；**只有 `submit` 抛错后回查**得到 `unknown` 或查无时才回 **503**，因为那一次提交的结果无法证明。

### 6.4 视图白名单（目标）

| 视图 | 允许字段 | 明确排除 | 理由 |
|---|---|---|---|
| `companySummary` | `slug/name/level/charter_ref/platform/departments/people/jobs`（后三为计数） | 内部路径、成本段 | 旧面字段兼容 |
| `orgView.department` | `name/path/parent/leader/level/lanes/functions/relations` | 未来新增键 | 逐键白名单 |
| `peopleView` | **public 仅聚合** `total/byDept/byLevel` | 一切逐人字段（`id/name/login/…`）、`costCaps`、`skills`、联系方式、`PersonRef` 原对象 | 80-§9.4：个人详情只在 `partner`/`internal`，而分级未定义（缺口-API-08） |
| `issueView.issue` | `issue/company/created/updated/state/type/dept/level/dispatcher/parent?/lane?/assignee?`（不可判状态时 `state:'unknown'` + `rawState` 保留平台原值） | 未来新增列；把不可判状态折到“最近态” | 现状 `{...m}` 会泄露新增列；78-§9.5/§9.6 要求未知照实保留 |
| `agentCard` | `framework/name/slug/version/platform/endpoints/contact` | 内部版本/路径 | 广告面最小化 |
| `finance` | `company.buildFinanceSnapshot` 的既有形状 + 每段 `Observed<T>` 的 `state/reason`；金额 `{amount: DecimalString, currency}` | 未读快照不得补零、不得省略段、不得用 `Money.usd` | 80-§9.6；缺源 = 200 + unknown；80-§4.1 `TS-SCALAR-09` |

---

## 七、迁移：从 `panel/external` 到 `api`

### 7.1 五步（沿用 80-§9.4，顺序写死，本附录不新增步骤）

| 步 | 动作 | 本附录涉及的文件 | 门禁 |
|---|---|---|---|
| M1 | HTTP 适配下沉；`dayKeyOf`/`DAY_MS` → `contract`；三个 `build*` → `company` | 新建 `http/{request,response,listen}.ts`；`views/*` 等待 `company` 目标导出 | 纯移动不改行为；`bun run guard:boundaries` 仍绿；无 `api→panel` |
| M2 | api 接管路由 | 新建 `options/app/serve/errors/submission/intent`、`auth/*`、`routes/*`（含 `routes/requests-status.ts`）、`views/*`（含 `views/observation.ts`）；替换 `index.ts` | 新面**零生产调用方**；不得与旧面同端口双监听；路由共 **16 条**（10 读含 501 的 `/v1/events` 与 `/v1/requests/status` + 4 触发 + `/v1/subscriptions` + `GET /`）；`/v1/finance` 缺源时 **200 + 分段 unknown**（不是 501）；`/v1/reports`、`/v1/events`、`/v1/subscriptions` 未配 501 |
| M3 | 装配上线 | `apps/daemon/src/assembly/api/assemble.ts`（17）+ `ServeConfig.external`（17）+ `contract/src/ports/intent.ts`（01）；本包只被 import | **前置**：`store.openLedgerReadonly` 的“只读打开不跑 DDL”先落地（80-§8.2 D12；现状 `openLedger` 无条件 `migrate`，`store/src/ledger.ts:515`）；`buildServeRuntime` 第 6 步用 `createIntentIngress(deps)` 建 ingress 并**自持** `IntentIngressInternal`（启动末调一次 `replayQueued()`，`gap:'unknown-link-missing'` 的行不重放），交给 `assembleApi` 的只有 `Pick<IntentSubmissionPort,'submit'\|'receipt'>`；`cli/external` 退役或只打印迁移指引 |
| M4 | 验证 | 全部 target 测试 + 真端口 + 启动两态 + 只读证据 + 202/200/409/413 回执 + **16 条**路由逐条 + **回执查询正反用例** | 80-§9.4 M4 **11 项**（`:2968` 起；旧稿 10 项，第 11 项 = 回执查询端点 `:2980`）；未全绿不得进 M5 |
| M5 | 删除旧面 | `panel/src/external/**`、`panel` 的 `"./external"` 导出 | 破坏性变更，须批示 + 82 波次；必须最后 |

> M2 的“完整接管”受**三个**上游缺口阻塞（v0.6 复算）：`eventsSource` 签名（缺口-API-04）、公开视图分级（缺口-API-08）、`/v1/reports` 的 `listReports` 形状（缺口-API-03 残余）。**已不阻塞**：`IssuesView`/`FinanceSources` 方法名（80-§9.4 `:2878`/`:2888` 已定）、回执查询路由（80-§9.4 `:2804` 已定，缺口-API-01 关闭）。**财务不受阻**：缺源就 200 + `unknown`（80-§9.4 明令），不得借缺口把路由改 501。**不得**用“先把 panel 的实现复制进 api”绕过——那会同时制造 `api→panel` 的隐性知识依赖与第二份投影口径。

### 7.2 源 → 目标映射

| 旧件/旧职责 | 目标文件 | 说明 |
|---|---|---|
| `external/index.ts` 导出面 | `src/index.ts` + `options.ts` | 名字对齐：`createExternalApp` → `createApiApp`；`serveExternal` → `serveApi` |
| `external/server.ts` 常量/选项 | `options.ts` | `openLedger` 删除；`platform` 删除；换 `emitIntent` + `getIntentReceipt`（均为 `Result` 回执口） |
| `external/server.ts` 公司解析/注册表 | `app.ts` + `routes/info.ts` | 两态改为 422（缺省/多司/未命中）；错位 500 |
| `external/server.ts` 信息路由 | `routes/info.ts` | 逐端点迁；白名单化；finance 200+unknown、people 仅聚合 |
| `external/server.ts` 触发路由 | `routes/trigger.ts` + `submission.ts`（键闸/映射）+ `intent.ts`（payload） | 判重与回执归 daemon ingress；删平台写；删本地 kv |
| `external/server.ts` SSE 501 | `routes/subscriptions.ts` | 保持 501 直到 `eventsSource` 定义 |
| `external/server.ts` 监听壳 | `http/*` | 从 `panel/src/server.ts` 同源下沉，不从 panel 取 |
| `external/views.ts` 名片/公司/组织/人事/报表 | `views/agent-card.ts` + `views/company.ts` | 白名单化；人事只出聚合 |
| `external/views.ts` issues/projects | `views/issues.ts` | 白名单 + 复用 `company` 进度口径；不可判状态保留原值 |
| `external/views.ts` 财务 | `views/finance.ts` + `company`（目标） | `buildFinanceSnapshot` 下沉 `company`，api 只调用；金额 `DecimalString` |
| `external/views.ts` 幂等 kv 值 | **无对应**（删除） | 判重键与回执归 daemon；`submission.ts` 只做键闸与 `Result`→HTTP 映射，**不存任何键**，也不建 TTL 表 |
| `cli/external.ts` | 退役/迁移指引 | `apps/daemon/src/cli/external.ts:4` 是唯一 import；`:104` 调用；`:109` `--lan` 语义迁到 `ServeConfig.external.lan` |

### 7.3 启动两态与停机

- **配置关闭**（`ServeConfig.external` 缺失或 `enabled=false`）：`:8788` 不启动，daemon 正常运行；**不读该键、不校验、无 API 句柄，关闭动作是 no-op**（80-§3.3 `:249`、§3.6 第 7 步）；日志明写“对外 API 未启用”。这是“没开”，不是降级，也不算失败。
- **配置开启但缺件**：缺 `emitIntent`/`getIntentReceipt`、缺 `issuesView`、公司列表为空、`token`/`requestsPerMinute`/`idempotencyTtlMs` **缺任一 / 空串 / 非正整数**、`allowedSources` **显式空数组**（`ServeConfig.external` `:247`–`:250`、注入表 `:2944`–`:2956`）⇒ `assembleApi` 抛 `configInvalid`，`runServe` 非零退出；**不得**起“只有信息面”的半面（80-§9.4 决策 4）。**没有**“未配 `token` ⇒ 触发面全 401”的运行态。
- **ingress 归属**：`buildServeRuntime` 第 6 步 `createIntentIngress(deps)`（`deps` = `intake`/`engine:{ingest}`/`receipts`/`allowedSources`/`ttlMs`/`isCompanyMounted`/`bodyLimitBytes?`/`log`）→ 返回 `IntentIngressInternal`（`submit`/`receipt` + `replayQueued`），由 runtime 自持并在启动末调一次 `replayQueued()`；`assembleApi` 只拿 `Pick<IntentSubmissionPort,'submit'|'receipt'>`，**类型上无** `replayQueued`（不得用 `as`/`Record<string, unknown>` 绕过）。
- **启动序（v0.6 改锚，80-§6.6 第 9 条 `:2127`、§3.6 第 6 步 `:381`）**：第 6 步内固定 `秘密面/会话面装配 → receipts.rebuild()（表 + 快照）→ replayQueued()`，**API 装配（第 7 步）晚于 `rebuild` 成功**；`rebuild` 失败 ⇒ 整机拒启（不得带空投影起服，也不得“先起服再补”）。因此 api 侧可以假设“`getIntentReceipt` 一开服就有快照可读”，但**仍不得**把 `undefined` 当“库里没有”。
- **只读打开失败**：`openLedgerReadonly` 的 `Err`（`unavailable`/`db-missing`、`rejected_version`/`schema-behind|ahead`）**原样上抛**，不得改写 `CONFIG_INVALID`、不得降级成空视图（80-§9.4 注入表 `issuesView` 行）。
- **停机顺序**：`sources.stopAll()` → `apiHandle.close()` → `engine.dispose()` → `ledger.close()`（80-§3.6）；API 关闭必须先于 engine drain 与台账关闭；`close()` 幂等。
- **`traceId` 跨进程**：80 未定义它如何进 `REC-WORK-01`；M3 不得声称“API traceId = 台账 recordId”（缺口-API-06）。

### 7.4 退役条件（`panel/external` 三件）

调用方清单（实测）：

- `apps/daemon/src/cli/external.ts:4`（import）、`:104`（调用）——M3 退役或改为迁移指引；
- `packages/panel/package.json` 的 `exports["./external"]`——M5 删除；
- 无其他 `src`/`test` import（全仓 grep 已核）。

退役硬条件：M4 **11 项**全绿 + 启动两态 + 只读证据（`PRAGMA query_only=1`、启动前后 `user_version` 与表集合不变）+ 制作人批示。**M3 改线之前删旧面 = 断服**。旧面的两份测试（`external.test.ts` 521 行、`external-serve.test.ts` 195 行）在 M5 前保留，作为回归对照；删除时其覆盖必须已被 `api/test/**` 与装配层测试承接，不得留空。

---

## 八、依赖、边界与构建

### 8.1 允许边（不得新增）

| 边 | 状态 | 依据 |
|---|---|---|
| `daemon → api` | 目标**在用**（assembly 域装配） | `boundary-rules.mjs:108`；80-§2.3 |
| `api → company` | 允许（`SLUG_RE`、目标纯投影） | `boundary-rules.mjs:123` |
| `api → store` | 允许（**仅类型**读面行型） | `boundary-rules.mjs:124` |
| `api → contract` | 允许（`WebhookIntentPayload`/`IntentSubmitResult`/`IntentReceipt`/`IntentKey`/`ClassifiedError`/`configInvalid`/`CompanySnapshot`/`ObservationState`/`Timestamp`/`redactOutbound`） | `boundary-rules.mjs:125`；80-§11.2-3（`secrets` 模块迁 `contract`） |
| `api → panel` | **禁止** | 不在允许表；M5 迁移的硬约束 |
| `api → core` | **禁止** | 不在允许表。出站脱敏**不经 core**：目标形态是 `contract` 的 `redactOutbound`（80-§11.2-3，现状仍在 `core/src/secrets.ts:68`，属 01 的迁移）——因此缺口-API-07 是“迁移未落”，不是“要新开边” |
| `api → matrix` | **禁止** | 不在允许表，且**不需要**：Matrix 会话/通知面归 daemon（`RunServeOpts.matrixSessionFactory` 只进 daemon，80-§3.4 第 10 条）。api 不持 `MatrixRoomFace`/`NotifyBroadcastFace`，也不做 Matrix 出站 |
| `api → gateway` | **禁止** | 不在允许表：api 只产意图，写只由 daemon 经网关；api 不 import 网关 |
| `boot → api` | **禁止** | boot 只经 `runServe` 触发 |
| `company → panel` | **禁止** | 三个纯投影必须先落 `company` 再被 api 使用 |

层位：`api=4`（`boundary-rules.mjs:82`），`daemon=5` 引 4 合法；`api` 引 3/2/0 合法。**不得**为图方便新增 `api→prompt`、`api→gateway`、`api→core`、`api→matrix`。

**秘密与 Matrix 不是本包的输入面**（v0.5，详见 §0.7）：`ServeConfig.secrets`/`KnownSecretSet`/`SecretMaterial` 由 daemon 启动第 6 步装配（80-§3.3 `:252`–`:256`、§11.2.1），`matrixSessionFactory` 由 boot 构造、daemon 驱动（80-§3.4 第 10 条）；二者**都不进** `ApiServerOptions`。api 出站唯一允许的脱敏路径是 `api → contract` 的 `redactOutbound`/`findSecretShaped`——**不得**为了让 api 拿到秘密值或 matrix 面而新开任何边，也不得把 `KnownSecretSet` 当注入项。

### 8.2 第三方依赖

| 依赖 | 目标用途 | 版本（79） | 边界 |
|---|---|---|---|
| `hono` | 路由、`streamSSE` | `^4.6.0`，锁 4.13.13（DEP-HONO） | 只用核心；**不引** `@hono/node-server`（沿用 panel 的 node:http 手写适配器） |
| `zod` | 目标默认不用；请求体窄手写校验 | `^4.0.0`，锁 4.6.7（DEP-ZOD） | 若 M2 后零 import → 移除（79-§10.3） |
| `@modelcontextprotocol/server` | **目标不用** | `^2.0.0`（api 未用） | 移除；MCP 出口归 `studio-tools`（78-§11.4） |
| `node:http`/`node:crypto`/`node:stream` | 监听、摘要、流 | 内建 24.21.0 | 无新依赖 |

### 8.3 构建与类型门禁

- api **维持 `src` 轨**（79-§6.5 的“其余 12 个”）：`main`/`exports["."]` 指 `./src/index.ts`，不发布、不切 dist。
- 因此**不**进入“先 build → 再 typecheck → 再测试”的 dist 闭包（79-§6.1）；也不新增 `tsconfig.build.json`、`files`、`project references`、`paths`。
- 根 `bun run typecheck` 已覆盖 `packages/api/src/**`（根 `tsconfig.json` include）。包级 `typecheck` 保留作为分包门禁；若将来 api 切 dist，包级 typecheck 必须并入根脚本（79-§6.1），当前 N/A。
- 测试文件不在 typecheck（79-D10），但受 `maxFilesPerDirectory`/`maxLinesPerFile` 约束（guard 递归扫 `src` 与 `test`）。
- DSH 的“JS + `.d.ts` 分发”与“纯配置/能力包分离”不适用于本包：api 不是能力包、不分发、不在 DSH 插件链上；N/A 的理由是 79-§6.5 与 80-§12.2，不是遗漏。

---

## 九、测试与证据矩阵

| 测试文件 | 覆盖 | 对应反例/不变量 | 验证层（72/82） | 不证明 |
|---|---|---|---|---|
| `app.info.test.ts` | 8 条信息 GET + `/`、公司两态 422、聚合、finance 200+unknown、reports/events/subscriptions 501、**读面 `Err` → 500 且 body 不是空 `items`**；404/500 取值按 80 已定稿值断言 | R12（读面不回写）；I-11（未知有去向；不得以 `[]`/0 顶替）；80-§8.2/D21（读失败 ≠ 没有单）；80-§9.4 `:2834`/`:2840` | V2 行为契约 | 真端口、装配、台账投影 |
| `app.requests-status.test.ts` | `GET /v1/requests/status`：401/403/429、422 逐槽 `fieldPath`、`ticket`/`dedupKey` 两种命法同一条、200 `{receipt}` 无 `duplicate`、`undefined` → 503 `receipt-not-in-snapshot`、两态均 `no-store`、连查零 `submit`、拼错路径 404 | R12（查询不是重投）；I-11（未知有去向：503 而非 404/空 200）；80-§9.4 `:2804`/`:2814`–`:2822`/M4#11；78-§11.3 | V2 行为契约 | 真端口、装配、快照重建/同事务、权威存在性、中间层缓存 |
| `app.trigger.test.ts` | 4 条 POST、只差 `requestKind`、202/200/409/413/422/429/503、throw 回查（含 `undefined` 只映射 503、不重放） | R12（伪造意图/换键重投）；I-6（外部请求不产生授权）；80-§9.4 M4#9；80-§6.6 规则 5/8 | V2 | 引擎消费、落单、ingress 事务、平台回执 |
| `app.auth-quota.test.ts` | 401/403/429 矩阵与 429 体（`retryAfter` 秒）；缺 `token` 的拒启归 `app.lifecycle` | I-6；78-§11.3 认证；80-§9.4 状态表 | V2 + V4 负向（部分） | TLS、来源限制、多进程配额、`allowedSources` |
| `app.lifecycle.test.ts` | 构造期缺件必抛、端口 0、close 幂等 | 80-§9.4 决策 4（半面禁止） | V2 | `ServeConfig` 两态、停机顺序 |
| `http.adapter.test.ts` | 真端口、body、跳头、socket 键、SSE 管道 | 78-§11.3；80-§9.4 决策 2 | V2（真回环，不是 V5 真机） | 部署网络、防火墙、SSRF（本面无出站） |
| `views.test.ts` | 纯投影/白名单/聚合/分段 `Observed` unknown/金额 `DecimalString`/`nextCursor`；**“不吞 `Err`”的边界**（本文件不接触 `Result`，解包在路由层） | 80-§9.6；D75-06（未知不显示为 0）；80-§4.1 `TS-SCALAR-09`；80-§8.2 | V2 | 公司目录装载、M1 前的真实投影、六态判定 |
| `submission.test.ts` | `Result` 四态→HTTP 映射、键闸、`ticket` 键槽、throw 回查、**`undefined` = 快照无此键（≠ 未提交）** | 77-§1.4；80-§6.6 重投四态与规则 5/8；R12 | V2 | 跨重启、ingress 事务、`intent_receipts` 重建、内存快照 |

**E/W 用例**：E1–E12（员工册）与 W1–W12（工作册）的归属是员工/工作绑定档案（76-§9.4、69-§8.3），不是 API 边；本附录**不**把它们嫁接到 API 测试上，也不声称覆盖。API 侧只引用 R12、I-6、I-11 与 77-§1.4/§11。

**V 层声明**：以上全部只是 V2 设计（部分负向属 V4 的候选），**V3 跨实现、V4 故障/迁移/安全、V5 真机、V6 自治评估均未执行**。测试绿（若将来落地）也不证明真实 `:8788` 能力。

---

## 十、规模与拆分预算

| 文件 | 目标行数上限 | 拆分触发条件 | 拆分后落点 |
|---|---:|---|---|
| `src/index.ts` | 60 | 超出 | 只留 re-export，逻辑进 app/serve |
| `src/options.ts` | 200 | 超出 | `src/options/constants.ts` |
| `src/app.ts` | 220 | 超出 | `src/app/companies.ts` |
| `src/serve.ts` | 100 | 超出 | 逻辑进 `http/listen.ts` |
| `src/errors.ts` | 130 | 超出 | `src/errors/mapping.ts` |
| `src/submission.ts` | 160 | 超出 | `src/submission/mapping.ts`（不得重建本地判重表） |
| `src/intent.ts` | 110 | 超出 | 拆 `src/intent/payload.ts` |
| `src/http/listen.ts` | 120 | 超出 | 拆 `http/close.ts` |
| `src/http/request.ts` | 100 | 超出 | 拆 `http/headers.ts` |
| `src/http/response.ts` | 90 | 超出 | 不拆（薄） |
| `src/auth/token.ts` | 60 | 超出 | 不拆（薄） |
| `src/auth/quota.ts` | 100 | 超出 | 拆 `auth/window.ts` |
| `src/routes/info.ts` | 260 | 超出 | 按 info/finance 拆两个路由文件 |
| `src/routes/trigger.ts` | 260 | 超出 | 拆 `routes/trigger/validate.ts` |
| `src/routes/subscriptions.ts` | 120 | 超出 | 拆 `routes/events.ts` + `routes/subscriptions.ts` |
| `src/routes/requests-status.ts` | 120 | 超出 | 拆 `routes/requests-status/validate.ts`（参数/键槽校验；不得在此判重或重放） |
| `src/views/agent-card.ts` | 100 | 超出 | 拆 `views/endpoints.ts` |
| `src/views/company.ts` | 180 | 超出 | 拆 `views/org.ts` + `views/people.ts` |
| `src/views/issues.ts` | 150 | 超出 | 拆 `views/projects.ts` |
| `src/views/finance.ts` | 140 | 超出 | 不拆（薄包装） |
| `src/views/observation.ts` | 90 | 超出 | 不拆（六态信封，薄） |

- 所有子目录新增后仍 ≤25 件；**不提高** `maxLinesPerFile`、**不新增** `lineBaseline`。
- `packages/api` 当前无超限件、无基线；本包不存在“先加后拆”的豁免。
- 迁移期 `panel/src/external/server.ts`（571 行）为**冻结面**：迁移完成前不得在其上新增端点/字段，否则会在 600 行阈值边缘制造第二份实现并扩大 M5 删除风险。
- facade：`src/index.ts` 是唯一包根出口；拆分只改内部文件，不改包根导出名，保证 M2→M3 调用方稳定。

---

## 十一、需回写 80/76/77/78 的缺口（不得在本附录私补）

> 这些不是“技术空白”，而是**上位卷缺少对象/签名/字段**。本附录只给影响与建议落点；在回写完成前，相关目标面只能 501/拒启，不得自造接口。**v0.2 起增“状态”列**：`已关闭` 表示 80 已定稿、本附录照此修订；`收窄` 表示大半已定、只剩残余。

| 缺口 | 状态 | 缺什么 | 影响的本附录文件 | 建议回写位置 |
|---|---|---|---|---|
| 缺口-API-01 | **已关闭**（v0.6） | 回执查询端点已由 80-§9.4 定稿：`GET /v1/requests/status`（路由表 `:2804`、硬约束 1–7 `:2814`–`:2822`、状态表 `:2828`–`:2841`、M4#11 `:2980`）；键四槽 `company`/`source`/`kind`/`ticket ?? dedupKey`，命中 `200 {receipt}`、快照 `undefined` ⇒ `503 receipt-not-in-snapshot`，`404` 只给路径拼错。**不是**旧的 `GET /v1/requests/{dedupKey}` 形状（作废） | `routes/requests-status.ts`（v0.6 新增）、`routes/trigger.ts`、`options.ts` | 无需回写；78-§11.3 的“超时后按幂等键查询”已由该端点满足 |
| 缺口-API-02 | 收窄 | 语义已由 80-§6.6 定稿（`source`/`kind` 固定、`requestKind` 区分四端点、`IntentKey`/`IntentReceipt` 形状）；**残余**：`contract/src/ports/intent.ts` 尚不存在（`ls contract/src/ports/` 无此文件），api 与 daemon 会各建一份类型 | `intent.ts`、`submission.ts`、`routes/trigger.ts`、`options.ts` | `81-files/01-contract.md` 按 80-§6.6 落文件 |
| 缺口-API-03 | 收窄（v0.6 再收） | 只读打开签名已定（80-§8.2 `openLedgerReadonly` `:2605`）；**读语义也已定**（v0.5）：`ReadOnlyLedger.query`/`get` **同步 `Result`**、`Ok(undefined)` 才不存在、`Err` 按三条 query subcause + `ledger-read-failed`（§6.3 `:1207`、§8.2 `:2610`）；**v0.6 又关闭两项**：`IssuesView` 方法名已给（`:2878`：`ticketMirrors`/`issues`）、`/v1/finance` 三源已给（`:2888` `FinanceSources`）。**残余只剩一项**：`/v1/reports` 的 `listReports`/月报正文读取形状只到“清单”级别 | `options.ts`、`routes/info.ts`、`views/finance.ts` | 80-§9.4 补 `listReports` 正文读取形状；80-§8.2；03-store 的只读实现 |
| 缺口-API-04 | 开放 | **订阅面投递协议**：`eventsSource` 签名/游标；`/v1/subscriptions` 的 HMAC 密钥来源、退避/熔断/死信存储、出站 SSRF 策略均无端口 | `routes/subscriptions.ts`、`options.ts` | 80-§9.4 订阅面；78 的绑定损失/退出 |
| 缺口-API-05 | 收窄（v0.6 再收） | 202/200/401/403/**404**/409/**413**/422/429/**500**/501/503 与错误体四键**全部已由 80-§9.4 状态表定稿**（`:2828`–`:2841`）：413 = `rejected_precondition`/`CONFIG_INVALID`/`body-too-large`（不落记录、无 `fieldPath`，`:2836`）；**404 = `rejected_precondition`/`EXTERNAL_REJECT`/`not-found`（`:2834`）**；**500 = `unavailable`/`STALL` 且 `subcause` 透传（`:2840`）**，`internal-bug` 仍作 `subcause`。本卷不再有“暂定值”。**残余只剩一项**：非触发类 `Err`（`rejected_state`/`conflict`/`timeout`/`unverified`/`cancelled`/`partial`/`degraded`/`rejected_version`）的 HTTP 归属未列 | `routes/trigger.ts`、`routes/info.ts`、`routes/requests-status.ts`、`errors.ts` | 80-§9.4 状态表补其余 `Err` 映射；77-§11.1 |
| 缺口-API-06 | 开放 | **拒绝审计与 `traceId` 传播**：78-§11.3 要求“越权拒绝记录”，但 api 不得写台账；80 未定义 `traceId` 如何进 `REC-WORK-01`（payload 无此字段），API 的 `traceId` 与台账 `recordId` 无映射 | `errors.ts`、`routes/trigger.ts`、`auth/*` | 80-§9.4/§11.6（审计出口或 assembly 注入）；78-§11.3 |
| 缺口-API-07 | 收窄 | **出站脱敏接线未落**：80-§11.2-3 已定“`secrets` 整个模块迁 `contract`，`api` 经 `contract` 复用”，78-§7.4.1 的强制出口表也点名“API 错误与外部响应（:8788 等）”；**残余**：迁移未发生（现值仍 `core/src/secrets.ts:68`），`contract/src/ports/secret.ts`/`contract/src/secrets.ts` 均不存在，`KnownSecretSet` 也未在装配期产生 | `errors.ts`、`routes/info.ts`、`views/*` | 80-§11.2-3（迁移执行）+ 78-§7.4.1（`SecretCatalog` 落地）；不得私增 `api→core` 边 |
| 缺口-API-08 | 开放（冲突升级） | **公开视图分级与 M4#1 冲突**：80-§9.4 要 `public/partner/internal`（个人详情不外露），同卷 M4#1 又要“信息面逐字段一致”；本附录取分级，`/v1/people` 只出聚合，golden 需按分级修剪。`PersonRef.status/role/skills/costCaps` 公开性、响应字段版本化仍未定 | `views/company.ts`、`views/issues.ts`、`routes/info.ts` | 80-§9.4 与 M4#1 二者裁决；76 定义公共字段组 |
| 缺口-API-09 | 开放 | **版本来源**：agent-card 的 `FRAMEWORK_VERSION` 无唯一源；78-§11.3 要求端点版本化/下线通知，75–80 无版本策略 | `views/agent-card.ts`、`routes/info.ts` | 80-§9.4 信息面；76 的规范版本/摘要（若复用） |
| 缺口-API-10 | 收窄 | 80-§9.4 已定 `/` **只列 HTTP 路由**、MCP 归 `studio-tools`（78-§11.4）；**残余**：api manifest 仍声明 `@modelcontextprotocol/server`，需按 79-§10.3 移除 | `routes/info.ts`、`index.ts`、`package.json` | 79-§10.3 依赖清理；78-§11.4 |
| 缺口-API-11 | 收窄 | 429 已定（`unavailable`/`STALL`/`quota` + `retryAfter` 秒）、501 已定（`unsupported`/`EVOLVE_REJECT`/`unmounted` + `reason`）；**残余**：`Observed<T>` 在信息面响应里的**字段名与嵌套位置**未定（80-§9.6 只说“写原因”） | `errors.ts`、`views/observation.ts`、`routes/subscriptions.ts` | 80-§9.6（响应形状） |
| 缺口-API-12 | 开放 | **同名不同物 + 一次未登记的字段改名**：daemon 私有的 `WebhookIntentPayload`（`engine/intents/taxonomy.ts:96`，是 `InvokeIntent.payload` 的 `{title, detail?, eventId?}`）与 80-§6.6 的**信封**同名；且 80 只说信封 `body: unknown`“原样载荷”，未写 HTTP `body` → payload `body.detail` 的改名，也未说 `correlation.externalRef` 是否等价 `eventId` | `intent.ts`、`routes/trigger.ts`、`tests` | 80-§6.6（给信封内 `body` 的业务形状或明确“由消费方定义”）；daemon 的 `taxonomy.ts` 改名为 `WebhookEventPayload`（17/129 侧） |
| 缺口-API-13 | 开放 | **`contract` 代码落后 80 目标**：`ClassifiedError`（`kernel.ts:98`–`:102`）无 `failure` 字段，而 80-§5.7 与 78 的强制出口都要求四键错误体；`Money = { usd: number }`（`kernel.ts:13`）与 80-§4.1 `TS-SCALAR-09`（公共金额 `DecimalString` + 币种）不一致 | `errors.ts`、`views/finance.ts`、`tests` | `81-files/01-contract.md` + 80-§5.7/§4.1；改类型属公共面变更，须走提案 |
| 缺口-API-14 | 收窄（v0.6 再收） | **装配签名类型已定**：80-§9.4 代码块给出 `ApiCompanySource`（`:2870`）、`IssuesView`（`:2878`）、`FinanceSources`（`:2888`）、`AssembleApiDeps`（`:2897`）/`ApiServerOptions`（`:2906`），`config` 走 §3.3 `ServeConfig`（`:237`），`now` 也确认既不是配置键、也不是注入项（注入表 `:2944`–`:2956` 无此行）。**残余只剩一项**：`auth/quota` 需要可确定性推进的窗口时钟做用例，而 80 判 api 侧不另收时钟——要么接受模块内参数 + `vi.useFakeTimers()`，要么在 §9.4 表内显式给一个测试时钟位（二者只能选一，不得运行期两套） | `options.ts`、`auth/quota.ts`、`index.ts`（导出面）、§0.6 | 80-§9.4（时钟位裁定） |
| 缺口-API-15 | 开放 | **入口认证凭据无秘密条目**：`ServeConfig.external.token` 是“部署秘密引用”，但 78-§7.4.1 的 `secretId` 清单无 API 入口令牌条目，`SecretUse` 六值（`platform-auth`/`gateway-sign`/`matrix-register`/`matrix-notify`/`broker-issue`/`outbound-redaction`）里也**没有**“入口认证”用途 | `auth/token.ts`、`options.ts` | 78-§7.4.1（新增 `SEC-API-INGRESS` 之类条目 + `SecretUse` 增值须提案）；80-§11.2.1 |
| 缺口-API-16 | 开放 | **`ObservationState` 无类型落点**：80-§6.3 用六态、`ProjectionName` 含 `observation`，但 `contract` 里没有该类型的文件（`ports/` 现无 records 端口） | `views/observation.ts`、`views/*` | 80-§6.3 + `81-files/01-contract.md`（建议 `contract/src/ports/records.ts`） |

**v0.5 / v0.6 关闭的旧缺口**（原缺口表里没有独立行，但早期本卷文字把它们当开放项；此处逐条销账，避免下一轮又被当成“未实现”）：

1. **“读面缺 `Result`”** —— 关闭。80 已定 `ReadOnlyLedger.query`/`get` **同步 `Result`**、`RecordReader` **异步 `Result`**、`Ok(undefined)` 才不存在、`Err(unavailable/STALL/ledger-read-failed)`（§6.3 `:1168`/`:1207`、§8.2 `:2593`–`:2610`、D21 `:3642`、S7 `:3663`）；本卷 §0.6 第 9 行、`options.ts`、`routes/info.ts`、`views/issues.ts`、§6.1、§6.3 已按此改写。
2. **“回执 `get` 语义不清 / `undefined` 是否等于不存在”** —— 关闭。`IntentReceiptStore.get` 读**本进程已提交投影的内存快照**（`ReadonlyMap`），`refresh`/`rebuild` 才读台账并返回 `Result`；投影与记录**同事务**、commit 后同微任务更新快照；启动序 `schema 闸 → rebuild → replayQueued → 装配 API`（§6.6 `:2074`–`:2127`、D22 `:3643`）。本卷 §0.6 第 13 行、`submission.ts`、§6.3 已改。
3. **“404 完全未定义”** —— **关闭**（v0.6）：80 状态表已列 404 = `rejected_precondition`/`EXTERNAL_REJECT`/`not-found`（`:2834`），形状与取值都不再由本卷自定。
4. **“Matrix 工厂 / `secrets` 会不会被注进 API”** —— 关闭为**纪律声明**（不是缺口）：§0.7、`options.ts`、§8.1 三处明确二者**不进** `ApiServerOptions`，`api→matrix` 禁止，脱敏只经 `contract`。
5. **“回执查询端点不存在”** —— **关闭**（v0.6，原缺口-API-01 归零）：80-§9.4 已定 `GET /v1/requests/status`（路由表 `:2804`、硬约束 1–7 `:2814`–`:2822`、M4#11 `:2980`）；本卷新增 `routes/requests-status.ts` 与 `test/app.requests-status.test.ts`，旧的 `GET /v1/requests/{dedupKey}` 候选作废。
6. **“404/500 无官方取值”** —— **关闭**（v0.6）：80 状态表 `:2834`（404）与 `:2840`（500 = `unavailable`/`STALL`，`subcause` 透传，`internal-bug` 仍作 `subcause`）；本卷 §6.1、`errors.ts`、`routes/*` 已从“暂定”改为照抄。
7. **“装配签名欠类型”** —— **关闭（只余时钟位）**：`ApiCompanySource`/`IssuesView`/`FinanceSources` 与 `ServeConfig` 已定（`:2870`/`:2878`/`:2888`、§3.3 `:237`）；同步→async 只在 HTTP handler 边界，`ReadOnlyLedger` 的同步 `Result` 不得包成 `Promise`。
8. **“query subcause 的 `category` 未定”** —— **关闭**（v0.6）：80-§6.3 `:1207` 逐字给定（`ledger-query-unsupported` ⇒ `EVOLVE_REJECT`、`ledger-cursor-invalid` ⇒ `EXTERNAL_REJECT`、`ledger-query-invalid` ⇒ `CONFIG_INVALID`）；`STATE_CONFLICT` **不是** `ErrorCategory` 成员，全卷不得出现。

> 这些缺口**不阻塞**本附录成立：它们被显式标注、落到具体文件与具体回写位置，而不是用“以后再说”掩盖。**优先**：缺口-API-14（配额窗口时钟位）、12（信封内 `body` 形状 + 同名类型）、08（公开分级与 M4#1 的冲突，须 80 裁决，不能留给实现）、13/16（公共类型，改动须走提案）。

---

## 十二、未证与完成边界

### 12.1 未证清单

- **真实服务**：未启动 `:8788`，未验证监听、TLS/来源限制、局域网暴露。
- **装配**：`apps/daemon/src/assembly/api/assemble.ts` 不存在；`ServeConfig.external` 不存在；`IntentIngress`/`WorkIntake.reserve`/`IntentReceiptStore`/`intent_receipts` 表均不存在；`contract/src/ports/intent.ts` 不存在；启动两态、停机顺序、`ingress` 转发**未验证**。
- **意图链**：只读代码核对 `engine.ingest`（`engine.ts:2302` 同步入队）与共闸（`drain.ts:196`–`:204`）；**未**跑通“HTTP → `submit` → reserve → 投影 → ingest → 落单”。
- **回执**：202 `{receipt}` / 200 `{receipt, duplicate:true}` / 409 的**语义只按 80 设计**，未真实产生过回执；`throw` 后 `getIntentReceipt` 回查分支未执行；**“内存快照”这一层本身不存在**（`IntentReceiptStore` 与 projection hook 均未实现），所以“`decided` 不会被读成 `queued`”“commit 后同微任务更新快照”只是照 80 写下的目标，**未证**。
- **读面 `Err` 通道**：`ReadOnlyLedger.query`/`get` 的同步 `Result`、三条 query subcause 与 `ledger-read-failed` 全部只有文档依据（80-§6.3 `:1207`、§8.2 `:2610`）；**未**造过“库不可读”的场景，也未跑过 500 映射。
- **回执查询端点**：`GET /v1/requests/status` 是 v0.6 的设计目标（80-§9.4 `:2804`/`:2814`–`:2822`），`routes/requests-status.ts` **不存在、未跑**；`200 {receipt}` 与 `503 receipt-not-in-snapshot` 只有文档依据，“`no-store` 双路径”与“命中不重放”也未实测。
- **落单**：`consumeWebhook` 的只落单语义只读代码（`taxonomy.ts:292`–`:330`）；**未**用真实平台验证。
- **幂等**：同键四态、24h 去重窗、`queued` 不过期、`unknown` 先对账**全部未执行**；`lineage.supersedes` 只在文档里。
- **投影**：`company` 尚未导出 `buildOrgTree`/`buildProgressSnapshot`/`buildFinanceSnapshot`（grep 无命中）；`/v1/finance` 的“200 + 三段 unknown”是设计，未跑。
- **只读打开**：`store` 无 `openLedgerReadonly`（名称与签名见 80-§8.2；全仓 grep `openLedgerReadonly` **0 命中**），`openLedger` 无条件 `migrate`（`ledger.ts:515`）；M3 的“只读”在 D12 落地前是**假的**。
- **安全**：未做越权/配额/超大 body/SSRF/秘密泄露探针；`x-sn-token` 单令牌不等于三档凭证；`traceId` 与台账 `recordId` 无映射；出站脱敏函数尚未接线（缺口-API-07），`contract` 侧 `KnownSecretSet` 未产生。**§0.7 的 matrix/secrets 边界是“本卷声明”，不是实测**：无 Matrix 工厂、无 `ServeConfig.secrets`、无 `SecretCatalogEntry`，因此“api 拿不到它们”只能靠类型/代码评审证明，尚无负向探针。
- **双实现**：`api` 与 `panel` 的 HTTP 适配、分页常量、视图各有一份（允许边表的代价），差异未逐条对齐，82 的负向用例未写。
- **性能**：无并发/吞吐/内存基线；配额表上限只是设计值。
- **文档并发**：本文件 v0.2 曾在同日被另一进程并发改写（同路径、04:36–04:39）；v0.3/v0.4/v0.5/v0.6 的修订都是在其前一版之上逐块增量完成的，**最终版本须人工确认一次**，避免同一段被两次改写覆盖。

### 12.2 完成判据（本附录自身）

1. 现有 3 件与目标 35 件均可由路径复算（`find`/`wc -l`），无省略；
2. 每个文件有职责/非职责、内部结构、依赖、IO、状态/并发、错误、测试、规模与迁移；
3. 目标新增件均能回到 75–80 的语义/组件/接口，未私造公共概念；**五面（装配/回执/路由/认证/错误体）逐条对齐 80-§6.6 与 §9.4 的定稿**；
4. 16 个缺口均有状态（**已关闭 1**（01）/ 收窄 / 开放）、具体回写位置与影响文件；表后的“**v0.5 / v0.6 关闭的旧缺口**”清单逐条销账（读面 `Result`、回执快照、404 取值、matrix/secrets 边界、回执查询端点、404/500 取值、装配四类型、query `category`），不留“已解决但仍写成缺口”的残影；
5. 未把任何目标写成已实施，未宣称全卷 PASS 或真实能力已验证。

### 12.3 建议主 agent 优先处理

1. **缺口-API-14 残余**（配额窗口时钟位）——`company`/`config` 类型与 `now` 非注入都已由 80 关闭，只剩“api 侧不另收时钟”与单测需要可推进窗口这一处冲突；
2. **缺口-API-12**（信封内 `body` 的业务形状 + 同名 `WebhookIntentPayload`）——不改就会两边各建一份类型，且摘要域变更要走提案；
3. **缺口-API-08**（公开分级 vs M4#1“逐字段一致”）——同卷矛盾，golden 无法冻结，须 80 裁决；
4. **缺口-API-13/16**（`ClassifiedError.failure`、金额 `DecimalString`、`ObservationState` 仍未在 `contract` 落地）——公共类型变更，须走提案。

---

## 附录 A · 本次实际核对锚点

| 主题 | 锚点 |
|---|---|
| api 现状 | `packages/api/src/index.ts:40`、`:43`（共 43 行）；`package.json` 23 行；`tsconfig.json:1`–`:5`（5 行） |
| 现 `:8788` 注入面 | `packages/panel/src/external/server.ts:67`–`:78`、`:85`–`:87`、`:111`–`:126` |
| 现常量 | 同文件 `:92`–`:108` |
| 现公司解析/配额 | 同文件 `:165`–`:218`、`:226`–`:281` |
| 现信息路由 | 同文件 `:286`–`:394` |
| 现触发路由与两处越界写 | 同文件 `:410`–`:506`（`:487` 平台写、`:491` `kvSet`）；入参字段 `:458`–`:470`（`{title, body, idempotencyKey}`） |
| 现监听/关闭 | 同文件 `:538`–`:571` |
| 现纯投影 | `packages/panel/src/external/views.ts:44`–`:55`、`:78`–`:88`、`:102`–`:133`、`:138`–`:158`、`:180`–`:201` |
| HTTP 适配器同源 | `packages/panel/src/server.ts:321`–`:348`、`:352`–`:374`、`:377`–`:433` |
| 纯投影现状位置 | `packages/panel/src/overview/views.ts:172`、`:268`、`:364`；`packages/panel/src/views.ts:313`、`:321` |
| 意图类型 | `packages/contract/src/ports/invoke.ts:17`–`:28` |
| 契约端口目录（现状） | `packages/contract/src/ports/`：company/executor/gateway/index/invoke/kernel/models/notifier/platform——**无 `intent.ts`、无 `secret.ts`、无 records** |
| 契约错误/标量（现状） | `packages/contract/src/ports/kernel.ts:85`–`:102`（`ErrorCategory` 11 值；`ClassifiedError` **无 `failure`**）、`:13`（`Money = { usd: number }`） |
| 清单配置错误构造 | `packages/contract/src/schemas/errors.ts:54`–`:60`（`configInvalid(subcause, detail?)`，不带 `failure`） |
| 机密纯函数（现值，目标迁 `contract`） | `packages/core/src/secrets.ts:68`（`redactOutbound`） |
| 80 定稿：装配决策 D5/D15/D17 | `docs/80-技术细节-StudioNext运行时与公共接口.md:3626`（D5）、`:3636`（D15）、`:3638`（D17，`MergeRunHost` 真名） |
| 80 定稿：§9.4 路由计数 / 状态表 / 注入表 / 装配签名 | 同文件 `:2776`–`:2956`（§9.4 段首 `:2776`、路由计数 **16** `:2810`、状态表 `:2828`–`:2841`（**404 `:2834`、500 `:2840`**）、`assembleApi` `:2866` 与代码块 `:2868`–`:2918`、注入表 `:2944`–`:2956`）；M4 验证 11 项 `:2968` 起（#11 `:2980`） |
| 80 定稿：§9.4 回执查询端点 / 装配四类型 | 同文件 路由行 `:2804`、硬约束 1–7 `:2814`–`:2822`、状态表 202 `:2830`/503 `:2839`、M4#11 负向（含“来源不允许 ⇒ 403”）`:2982`；`ApiCompanySource` `:2870`、`IssuesView` `:2878`、`FinanceSources` `:2888`、`AssembleApiDeps` `:2897` 起、`ApiServerOptions` `:2906` 起 |
| 80 定稿：§3.3 配置键 / `ServeConfig.secrets` / §3.6 启动十步 | 同文件 `ServeConfig.external` `:247`–`:250`、`secrets` `:252`–`:256`、启动十步 `:370`–`:398`（第 6 步 `:381`/`:389`） |
| 80 定稿：§3.4 Matrix 会话工厂与“不新增 secretProvider” | 同文件 第 8 条 `:292`（禁 `BuildRuntimeOpts.secretProvider`）、第 10 条 `:295`（`matrixSessionFactory` 四个面 + `close()`；能力关闭不加载密码） |
| 80 定稿：§6.3 记录与投影名 | 同文件 §6.3 `:1168`–`:1210`（`RecordPage{items,nextCursor}` `:1198`、三条 query subcause 与 `ledger-read-failed` `:1207`、游标 opaque、`ProjectionName` 含 `intentReceipts`/`observation`、`ObservationState` 六态） |
| 80 定稿：§8.2 只读打开与读面失败 | 同文件 `:2545`–`:2623`（`ReadOnlyLedgerOpen` `:2593`、`ReadOnlyLedger` 同步 `Result` `:2599`、`openLedgerReadonly` 签名 `:2605`、“为什么只读查询也返回 `Result`”与错误表 `:2610` 起） |
| 80 定稿：§11.2.1 秘密（迁移决定） | 同文件 §11.2 `:3147`（`secrets` 迁 `contract`）、§11.2.1 `:3168`–`:3333`（`SecretKind` `:3175`、`SecretUse`/`KnownSecretSet`/`SecretMaterial` 装配与“值只在 daemon 内存”） |
| 80 定稿：意图端口/回执 | 同文件 `:1893`（`TS-PORT-API-01`）、`WebhookIntentPayload` 与 `receipt` 的 `undefined` 语义 `:1971`（“回执查询不走库”）、`:2012`（`submit` 校验顺序）、`:2018`（`IntentIngress`）、`:2049`（错误/状态映射表）、`:2057`（来源白名单只经 `allowedSources`，不查 `SourceRegistry`）、`:2074`–`:2127`（`IntentReceiptStore` 的 `refresh`/`get`/`rebuild`（规则 `:2086`/`:2123`）、启动序第 9 条 `:2127`、超限分类 `:2124`） |
| 80 定稿：读面统一与意图投影决策 | 同文件 D21 `:3642`（两个 `get` 都有失败通道、`Ok(undefined)` 才不存在）、D22 `:3643`（同事务 + commit 后同微任务更新快照 + 启动序）、S7 `:3663`（本卷下游同步清单）、S9 `:3665`（82 探针：`get` 负向、投影先于 API 装配、secrets/matrix 边界） |
| 契约端口文件（目标，尚不存在） | `packages/contract/src/ports/intent.ts`（80-§6.6 指定落点）；`packages/contract/src/ports/secret.ts` + `packages/contract/src/secrets.ts`（78-§7.4.1 / 80-§11.2-3） |
| 意图键 | `packages/core/src/decide.ts:319`–`:322`（`[source, kind, company, ticket ?? dedupKey]`） |
| 意图入口 | `apps/daemon/src/engine/engine.ts:651`、`:2302` |
| webhook 负载/消费 | `apps/daemon/src/engine/intents/taxonomy.ts:96`–`:115`（`{title, detail?, eventId?}`）、`:226`–`:241`（渲染只读 `title`/`detail`）、`:292`–`:330`（消费：只落单；`dedupKey` 含 `;`/换行丢弃） |
| 共闸/去重 | `apps/daemon/src/engine/intents/drain.ts:196`–`:204` |
| 崩溃/留痕索引 | `apps/daemon/src/engine/sentinel/events-index.ts:156`、`:201` |
| 清单配置错误 | `packages/contract/src/schemas/errors.ts:54`–`:60` |
| 台账打开即迁移 | `packages/store/src/ledger.ts:513`–`:515` |
| 台账读面 | `packages/store/src/ledger.ts:252`、`:275`、`:294`、`:296` |
| 目录/行数门禁 | `scripts/guards/boundary-rules.mjs:149`、`:152`；`scopeDirs` `:8` |
| 包层/允许边 | `scripts/guards/boundary-rules.mjs:82`、`:108`、`:123`–`:125` |
| 唯一生产调用方 | `apps/daemon/src/cli/external.ts:4`、`:104`、`:109` |
| 旧面测试 | `packages/panel/test/external.test.ts:167`–`:521`；`packages/panel/test/external-serve.test.ts:71`–`:195` |

> 以上锚点只证明“代码里现在是这样”，不证明目标已实现。
