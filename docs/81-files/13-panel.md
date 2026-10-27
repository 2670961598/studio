# 81-files/13 · `packages/panel` 逐文件蓝图

> 版本：v0.5，2026-10-27。相对 v0.1–v0.4 的修订项逐条见 §0.5。
> 性质：**文件级设计呈审稿**，不是现行文件树说明、不是实现单、不是完成证明。文中一切“目标”均为设计处置，尚未执行。
> 上位：75 的文件契约写法；76/77 的公共语义（六态、观察面）；78 的绑定；79 的工程与依赖（79-D6 端口双口径、79-D10 `test/` 未进类型门禁）；80 的运行时与公共 TS 接口（§2.1/§2.4 减职责、§5.7/§5.8 错误两轴、§8.2 与 80-D12 只读打开、§9.1 三面开库点、§9.2/§9.6 六态健康、§9.4 意图入口与迁移五步、§11.2 秘密边界）；绑定地址的部署意图见 `00-总览` D4。
> 边界：本卷只把 80 的组件与接口落到文件，不新增公共概念、端口、状态、允许边或依赖版本。发现缺口一律登记回写（§六），不在本附录私造第二套说法。文中“拆分/新增/替换/退役”不得据以改动生产代码、`package.json`、`tsconfig` 或 `scripts/guards/*`。

---

## 卷首

### 0.1 panel 的目标语义

`panel` 目标只保留**读投影**：`:8791` 框架监控（`src/server.ts` 族）、`:8789` 公司概览（`src/overview/` 族）两面只读，一个数字都不能写台账、不能调平台。`:8788` 对外 API 迁往 `packages/api`（文件契约归 `81-files/14-api.md`），本包 `src/external/` 只在迁移完成前作为过渡实现存在，最终整组退役（§五.3）。

五条总纪律（上位 80-§9.5、80-§9.6、80-§8.2、80-§9.2、80-§7）：

1. **读投影只读**：panel 的读路径不得调用 `platform.*` 写方法，不得 `ledger.append*`/`kvSet`；投影可重建，重建不改事实；读路径失败不得写事实（`REC-OBS-02` 的写入由 daemon 承担）。
2. **只读打开不跑 DDL**：三面一律 `openLedgerReadonly`（80-§8.2，80-D12），用 `ReadOnlyLedger` 而不是 `Ledger`。`ReadOnlyLedger` 只有 `schemaVersion`/`query`/`get`/`close`，类型上拿不到 `append`/`begin`/`kvSet`/`db`。上一稿曾把 `ReadLedger` 当同义名并列，已作废：`81-files/03-store.md` 已把 `ReadLedger` 判为旧稿自拟类型并删除，全卷只用 80 的 `ReadOnlyLedger`。
3. **六态而非布尔**：状态字面量与呈现要求取 80-§9.6 的六行表；`unknown`/`gap`/`stale` 必须显示为异常，不得显示绿；`partial` 是失败/结算分类，只能翻成 `gap`/`conflict` 并附范围，不得当状态字面量透出。
4. **暴露面只减不增**：监控面不提供重试/重派/关单按钮（80-§9.2）；概览面每个数字必须能点回来源游标，缺数据显缺口、不补零（80-§9.3）。
5. **金额不过 float**：公共金额形状是 `{ amount: DecimalString; currency }`（80-§7）；panel 现状 `fmtUsd`/`+=` 都是 `number` 浮点求和，属显示层临时口径，目标只在边界转换、不经浮点、不四舍五入，源标度未定前不宣称已合规（§六 G9）。

现有三面事实（已核实，与 80-§9.1 一致）：

| 面 | 端口 | 入口 | 读/写 | 开库点（符号级） |
|---|---|---|---|---|
| 监控 | `:8791` | `src/server.ts` 的 `servePanel` | 只读（现状 `openLedger` 带迁移副作用；目标 `openLedgerReadonly`，80-§8.2/80-D12） | `servePanel` 起监听前的那次 `openLedger` |
| 概览 | `:8789` | `src/overview/server.ts` 的 `serveOverview` | 只读（同上） | `serveOverview` 内的 `openLedger` |
| 对外 | `:8788` | `src/external/server.ts` 的 `serveExternal` | 读 + 两处违例写 | `serveExternal` 内的 `openLedger` |

两处违例按调用点定位（不记行号，行号随改动漂移）：`src/external/server.ts` 的触发端点直接 `await platform.issues.create(...)` 绕过网关，同一处理函数随后 `ledger.kvSet(kvKey, ...)` 写台账。处置是随 M1–M5 迁移收口（§五.3），**不得就地修补**：就地修补会把写权限固化进一个即将退役的文件。目标态这两处在类型上不可达：api 侧只拿 `ReadOnlyLedger`（用于现构 `issuesView`）与 `Pick<IntentSubmissionPort,'submit'\|'receipt'>`（由 `emitIntent`/`getIntentReceipt` 原样转发，80-§9.4 注入表已删除 `openLedger` 与 `platform`）。

### 0.2 证据标签（全文只用这套，不混写）

| 标签 | 本卷含义 |
|---|---|
| **现有** | 磁盘上存在；只描述已核实的代码与调用 |
| **库级/未接** | 文件或导出存在，但生产链未接或无真实证据 |
| **目标-保留** | 现有职责保留到目标架构，内部实现可能改 |
| **目标-拆分** | 现有职责拆到多个目标文件，旧文件留 facade 或退役 |
| **目标-新增** | 新增目标文件，须给上位语义与完整文件契约 |
| **目标-替换** | 旧职责由新文件承担，须写迁移与兼容 |
| **目标-退役** | 目标不再使用，须给调用方与历史处置 |
| **仅测试/演示** | 夹具与演示入口，不得转生产 |
| **未证** | 真实能力/性能/安全边界未取证 |

测试绿只证明项目回归，不证明真机、跨实现或安全边界。本卷写作期间**未运行任何测试或类型门禁**，凡涉及“测试通过”的表述一律指既有用例的存在，不指本次验证结果。

### 0.3 排除项

- `packages/panel/vendor/` 下三件第三方产物（`vue.esm-browser.prod.js`、`naive-ui.prod.mjs`、`echarts.esm.min.js`）与三份 `LICENSES/*` 只作证据，不展开源码。
- `node_modules`、`.git`、构建与覆盖率产物。
- `vendor/README.md` 与 `vendor/vendor.lock.json` 是第一方件，计入件数，逐条展开（§3.6）。

### 0.4 与 80 定稿接口的对应表

本卷只把 80 的接口落到文件，不重定义。凡 panel 不承载的接口，下面写 `N/A` 并给理由，**禁止**在附录里另造一套形状。

| 80 定稿接口 | 本卷适用面 | 处置 |
|---|---|---|
| `ClassifiedError`（`failure`/`category`/`subcause`/`detail?`）与 HTTP 错误体 `{ error:{ failure, category, subcause }, traceId }` | 三面全部错误出口 | 采用。处置只读 `failure`；`category` 只做观测分桶；不回 `err.message`、不输出绝对路径；`traceId` 服务端生成并经 `x-sn-trace-id` 回传；422/429/501 的外层附加字段（`fieldPath`/`retryAfter`/`reason`）在 panel 只有一个 429 面（对外配额，过渡期），其余不适用 |
| `openLedgerReadonly` / `ReadOnlyLedger` / `ReadOnlyLedgerOpen`（80-§8.2） | `server.ts`、`overview/server.ts`、`external/server.ts` 三个开库点 | 采用，唯一名。`query`/`get` **同步**返回 `Result`：`Ok(undefined)` 只表示“不存在”，运行期失败 `Err(unavailable/STALL/ledger-read-failed)`，不得降级 `undefined` 或空页；三条查询 `Err` 按 80-§8.2 固定：未开放组合 `unsupported`+`EVOLVE_REJECT`+`ledger-query-unsupported`，坏游标 `conflict`+`EXTERNAL_REJECT`+`ledger-cursor-invalid`，形状非法 `rejected_precondition`+`CONFIG_INVALID`+`ledger-query-invalid`。**`STATE_CONFLICT` 不是 `ErrorCategory` 成员**，全卷不出现。缺库 `db-missing`；版本不匹配 `rejected_version`+`EVOLVE_REJECT`+`schema-behind`/`schema-ahead`；`CONFIG_INVALID` 只给路径/配置缺失或畸形 |
| `RecordQuery`/`RecordPage`（`{ items, nextCursor }`） | 只读面的记录与投影读口 | 采用（类型家 `F-contract-port-record`，`src/ports/record.ts`，见 `81-files/01-contract.md`）。`RecordReader`（`TS-PORT-REC-02`）的 `get`/`query` 是**异步** `Promise<Result<…>>`，与 `ReadOnlyLedger` 的**同步** `Result` 同出参形态但不同时序，不得混用；判据同为 `Ok(undefined)` 才是不存在。只允许索引化条件（`kinds`/`company`/`subjectRef`/`timeRange`/`cursor`/`limit`/`order`/`knowledgeScope`）；panel 需要的投影表行读取口 80 未给（`TableProjectionResult.rows` 是计数不是行），登记 §六 G5 |
| `ProjectionName`（含 `intentReceipts`/`observation`）与 `TableProjectionResult` | 概览与监控的投影元数据 | 只读消费（`ProjectionName`/`ProjectionTarget`/`ProjectionResult` 的家同为 `F-contract-port-record`）。panel 不调 `RecordProjection` 做表维护（§7.2 第 8 条） |
| `IntentIngress` / `assembleApi` / `emitIntent` / `getIntentReceipt` / `IntentReceipt` / `ReferralTarget`（80-§9.4、80-D5/D15） | `src/external/` 的过渡接缝 | 只作出手方向。公共端口是 `TS-PORT-API-01 IntentSubmissionPort`（类型家 `F-contract-port-intent`，`src/ports/intent.ts`）；daemon 侧实现与装配分别落 `F-daemon-intent-ingress`（`assembly/intent/ingress.ts`）、`F-daemon-intent-receipt-store`（`assembly/intent/receipt-store.ts`）、`F-daemon-api-assemble`（`assembly/api/assemble.ts`），均归 `81-files/17-daemon-assembly-cli-control-evolve.md`。M3 由 daemon 装配传入 `Pick<IntentSubmissionPort,'submit'\|'receipt'>`（与 `Pick<IntentIngress,'submit'\|'receipt'>` 等价，两者都不含 `replayQueued`），panel 只交路由，不持 `engine`、不直调 `engine.ingest`；回执显示用 `status` 三值与 `outcome` 五值，`forwarded` 必带 `ReferralTarget`。**回执读取与库读分开**：`getIntentReceipt` 读 `IntentReceiptStore` 已提交的投影快照（进程内），不经 `ReadOnlyLedger.get`，也不因台账读失败而回 404 或空回执；`ReadOnlyLedger` 只服务其他只读查询。**回执查询端点 `GET /v1/requests/status`（80-§9.4，目标、未实现）**：四槽键 `company`/`source`/`kind`/（`ticket ?? dedupKey`）与 `IntentKey` 逐位对应；只读快照，不查库、不重放、不调 `refresh`、不触发 `replayQueued`；快照命中 `200 { receipt }`，快照缺 `503`+`unavailable`/`STALL`/`receipt-not-in-snapshot`（**不得** 404、不得 200 空体、不得回落查库）；参数越界 `422`；成功与失败都带 `Cache-Control: no-store` |
| `ServeConfig.external` 七键（`enabled`/`port`/`lan`/`token`/`requestsPerMinute`/`idempotencyTtlMs`/`allowedSources`） | 对外面启动闸 | 采用 80 缺省：`enabled=false`、`port=8788`、`lan=false`、`allowedSources=['external-api']`；关闭时零行为；开启缺 `token`/`rpm`/`ttl` 即整机 `CONFIG_INVALID`；空 `allowedSources` fail-closed |
| `listenHono` / `ListenHonoOptions` / `HonoShellHandle`（80-§9.4 装配决策 2） | `src/server.ts` 的监听壳，`overview/server.ts` 复用之 | **api 同源副本，panel 保留自有实现**。`api` 在 `F-api-http-listen`（`src/http/listen.ts`，归 `81-files/14-api.md`）持一份只依赖 `node:http` 的同源副本；panel 的 `:8791`/`:8789` 继续用自己的 `listenHono`，**不从 api 取、不由 api 注入**。不得 `panel→api`、不得 `api→panel`、不得 `company→panel`；两份差异进 §五.6 对齐清单与 82 负向用例 |
| `ObservationState` 六态与 `REC-OBS-01`/`REC-OBS-02`（端口 `TS-PORT-OBS-01`，类型家 `F-contract-port-effects`；记录形状 `F-contract-rec-payload-lifecycle`） | `monitor/*`、`inbox.ts`、`overview/api.ts` | 采用。文件家 80 未定（§六 G1）；`completeness` 取 77-§9.1 中文四值 |
| `Money` / `DecimalString` / `sha8` / 公司本地日显式时区 | 概览财务面、成本面 | 部分采用。公共金额 `{ amount: DecimalString; currency }`、边界转换不过 float；`sha8` 只展示，身份用完整 `semanticDigest`；本地日必须显式传时区，不读系统时区。`cost_usd:number` 的标度未定（§六 G9） |
| `RuleEvaluator`（`typecheck`→`evaluate`）、`work-readiness` 五门、`MergeRunHost`（**真实名**，不写 `MergeHostView`；80-§10.2 的别名已判不存在）、`BindingProfile`/`mapState` | 无 | `N/A`。panel 不评估规则、不判就绪、不跑合并、不做平台状态映射，只在显示层透传 daemon 已给的字段 |
| `NotificationEnvelope`、stdio 工具面、`StudioToolsDeps` | 无 | `N/A`。panel 不发通知、不提供 stdio 工具 |
| `SecretCatalogEntry` / `SecretProvider` / `KnownSecretSet`（80-§11.2） | 出站脱敏 | panel 无秘密注入位（§六 G8）。出站只做形状兜底（`findSecretShaped`/`redactOutbound` 来自 `contract`），**不得声称已完全脱敏**；认证入站头不脱敏 |
| `event` 记录投影映射（80-§4.6） | 事件流与断路面 | 采用 `RecEvent` 投影后的 `EventRecord`，映射表归属未定（§六 G6） |

〔端口写法〕本卷端口一律写具体 ID：`TS-PORT-OBS-01`（观察投影）与 `TS-PORT-API-01`（意图提交）。80 只在说明性段落里用 `TS-PORT-*` 指代端口集合，逐端口处写具体 ID；`81-files/01-contract.md` v0.5 已把 `TS-PORT-WORK-01…11`/`TS-PORT-AUTH-01…07`/`TS-PORT-REC-01…06` 展开为逐 ID，并明令正文不得再用通配。本卷不写通配，也不据通配推断端口存在。

〔允许边〕纯投影可下沉 `company`（`F-company-projections`），HTTP 归 `api`（`F-api-http-listen` 与 `packages/api` 本体），`panel` 只读、不直写台账或平台。三条边是硬禁：`panel→api`、`api→panel`、`company→panel`。

### 0.5 修订记录 v0.1 → v0.5

本版按 80 定稿接口做全局一致性修订，不是补丁。逐条：

1. **错误两轴**：全卷统一 `failure`（14 值）/`category`（11 值）两轴；`CONFIG_INVALID` 从“schema 版本不匹配”“库文件缺失”两处撤回，只留路径/配置缺失或畸形；版本不匹配改 `rejected_version`/`EVOLVE_REJECT`/`schema-behind|ahead`，缺库改 `unavailable`/`STALL`/`db-missing`。
2. **只读打开名**：`openLedgerReadOnly`/`ReadLedger` 全部改为 80 原文 `openLedgerReadonly`/`ReadOnlyLedger`；删除“双名同义”说法（`81-files/03-store.md` 已判 `ReadLedger` 作废）。
3. **件数复算**：修掉 §1.1 “终态 `test` 21”的错账（21 是过渡态）。终态 `test` 为 19，总数 75；过渡态 81。新增目标文件树，计数可逐路径复算。
4. **意图装配**：`external` 迁移段改为 80-§9.4/80-D5/D15 的 `IntentIngress`+`assembleApi`+`emitIntent`/`getIntentReceipt`，删除“api 侧自建幂等存储”的说法，改为 `REC-WORK-01` 与 `IntentReceiptStore` 投影。
5. **六态口径**：`completeness` 改回 77-§9.1 中文四值；明确 panel 是“投影的投影”，最高态为 `derived`，`observed` 与 `stale` 在无来源游标/无 freshness policy 时不可达，不得伪造。
6. **金额口径**：新增 public 金额 `DecimalString` 纪律，并把 `fmtUsd`/`+=` 浮点求和标为显示层临时口径（§六 G9）。
7. **ID 纠偏**：裸 `D12` 全改 `80-D12`；`D4` 改为 `00-总览` D4（局域网默认的决策表）；`D6` 改为 `79-D6`、`D10` 补充为 `79-D10`。凡本卷引用的 ID 都在 76/77/78/79/80 已登记，不新造。
8. **缺口表重写**：§六.1 从 8 行扩到 14 行（G1–G14），补投影表行读取口、`REC-OBS-02` 读路、记录投影映射归属、`expectedSchemaVersion` 来源、`KnownSecretSet` 注入位、金额标度、新鲜度窗；§6.2 回写对象从“79”扩为“79 与 `00-总览`”。
9. **归属与实名校正（v0.3）**：`listenHono` 一族定稿为“api 同源副本，panel 保留自有实现”，并在 §0.4/§五.3/§五.6/§7.2 补三条硬禁边（`panel→api`/`api→panel`/`company→panel`）；端口与文件 ID 改实名（`TS-PORT-API-01`、`F-contract-port-intent`/`-record`/`-effects`、`F-daemon-intent-ingress`、`F-daemon-intent-receipt-store`、`F-daemon-api-assemble`、`81-files/17-daemon-assembly-cli-control-evolve.md`）；`MergeRunHost` 只写真名；清理已关闭的跨卷指控（M4 条目数、只读打开双名），保留 `:8788` 迁移、认证、六态 `unknown` 三条真实边界。
10. **读面 `Result` 与计数口径（v0.4）**：`ReadOnlyLedger.query`/`get` 改为**同步** `Result`（`Ok(undefined)` 只表示不存在，`Err(unavailable/STALL/ledger-read-failed)` 不得降级空页或 `undefined`），`RecordReader` 明确为**异步** `Promise<Result<…>>`；四条查询 `Err` 形状照 80-§8.2 固定；回执读取改为 `IntentReceiptStore` 已提交快照，与台账库读分开；版本不匹配统一取 `conflict`，`stale` 在 v0 不可达（G10）；`listenHono` 归属与三条禁边不变。
11. **路由计数与读口分类（v0.5）**：路由唯一口径改为 **16 条**（10 读含新增 `GET /v1/requests/status` 与按订阅面计的 501 `/v1/events` + 4 触发 + `/v1/subscriptions` + `GET /`）；80-§9.4 的 M4 验证项同版改 **11 项**（第 11 项是回执查询端点的正反用例），早前把验证项数与路由数当两轴的旧解释一并作废，两处数字直接按 80 现行值写。读口 `Err` 的分类校正为 80-§8.2 现行值：未开放组合 `EVOLVE_REJECT`、坏游标 `EXTERNAL_REJECT`、形状非法 `CONFIG_INVALID`、读失败 `STALL`；`STATE_CONFLICT` 全卷删除（不是 `ErrorCategory` 成员）。`GET /v1/requests/status` 只读内存快照、快照缺回 `503` 且不重放，`panel/src/external` 的接管方是 `packages/api`。全文去掉源码行号锚点，改按符号名定位（行号随改动漂移，不作判据）；本卷所有“目标”仍未实现。

---

## 一、件数总账（可复算）

第一方件 **73** 个，口径为磁盘枚举，不含三件第三方产物与三份 LICENSES：

| 分组 | 数量 | 路径枚举 |
|---|---|---|
| `src` 根 | 7 | `index.ts` `views.ts` `server.ts` `shell.ts` `static.ts` `inbox.ts` `judge.ts` |
| `src/overview` | 7 | `index.ts` `server.ts` `views.ts` `api.ts` `reports.ts` `reload.ts` `shell.ts` |
| `src/external` | 3 | `index.ts` `server.ts` `views.ts` |
| `test` | 18 | `alerts-costs` `external` `external-serve` `inbox` `judge` `overview` `overview-json` `overview-monthly` `overview-reload` `overview-reports` `overview-serve` `overview-ui` `panel` `serve` `shell-static` `ui-feed` `ui-syntax-gate`（均 `.test.ts`）+ `corpus.ts` |
| `ui` | 33 | 见下 |
| `scripts` | 1 | `vendor-pull.mjs` |
| 配置与证据 | 4 | `package.json` `tsconfig.json` `vendor/vendor.lock.json` `vendor/README.md` |

合计：7 + 7 + 3 + 18 + 33 + 1 + 4 = **73**。件数按目录直接子项计，`ui` 的 8 个一级子目录只列子项不另计。

`ui` 33 件枚举：

```text
ui/main.js ui/app.js ui/theme.js
ui/lib/format.js ui/lib/feed.js
ui/charts/options.js
ui/composables/useSnapshot.js ui/composables/useLedgerStream.js ui/composables/useEchart.js
ui/components/StatStrip.js ui/components/ChartCard.js ui/components/JobsCard.js
ui/components/RunsCard.js ui/components/WorkersCard.js ui/components/InboxCard.js
ui/components/CostsCard.js ui/components/JudgeCard.js ui/components/BreakersCard.js
ui/components/EventsFeedCard.js
ui/overview/main.js ui/overview/app.js ui/overview/router.js
ui/overview/charts/options.js
ui/overview/composables/useOverviewJson.js
ui/overview/components/CompaniesCard.js ui/overview/components/CompanyCard.js
ui/overview/components/OrgCard.js ui/overview/components/PeopleCard.js
ui/overview/components/PersonView.js ui/overview/components/ProgressCard.js
ui/overview/components/FinanceCard.js ui/overview/components/ReportsCard.js
ui/overview/components/SnapshotBadge.js
```

### 1.1 目标件全集（相对 73 的增减）

| 处置 | 文件 | 说明 |
|---|---|---|
| 目标-新增 | `src/monitor/dashboard.ts` | 监控快照投影（自 `views.ts` 拆出） |
| 目标-新增 | `src/monitor/breakers.ts` | 断路器投影（自 `views.ts` 拆出） |
| 目标-新增 | `src/monitor/costs.ts` | 成本投影（自 `views.ts` 拆出） |
| 目标-新增 | `src/monitor/health.ts` | 六态健康投影（80-§9.2/§9.6） |
| 目标-新增 | `src/monitor/projection-state.ts` | 六态字面量与快照元数据共享叶子 |
| 目标-退役 | `src/external/index.ts` | M5 删，同时删 `"./external"` 导出 |
| 目标-退役 | `src/external/server.ts` | 路由迁 `packages/api` |
| 目标-退役 | `src/external/views.ts` | 投影迁 `packages/api` |
| 目标-退役 | `src/overview/views.ts` | builder 迁 `company`，旧 SSR 随 `/legacy` 退役 |
| 目标-新增（测试） | `test/monitor-health.test.ts` | 六态与断源显示 |
| 目标-新增（测试） | `test/readonly-ledger.test.ts` | 80-D12 只读负向 |
| 目标-新增（测试） | `test/observation-state.test.ts` | 叶子纯函数 |

**处置统计（对 73 件，穷尽可复算）**：保留 66 件，拆分 2 件（`src/views.ts` 留 facade、`src/overview/views.ts` 终态退役），退役 5 件（`src/external/` 三件加 `test/external.test.ts`、`test/external-serve.test.ts`），新增 8 件（`src/monitor/` 五件加三件测试）。66 + 2 + 5 = 73；73 + 8 = 81 为过渡态。

**过渡态（M1–M4 期间，旧面尚未删）**：`src` 17 + 5 = **22**；`test` 18 + 3 = **21**；`ui` 33；`scripts` 1；配置 4；合计 22 + 21 + 33 + 1 + 4 = **81**。

**终态（M5 删 `external` 三件与两份测试、`/legacy` 退役后）**：`src` 17 − 3（`external`）− 1（`overview/views.ts`）+ 5 = **18**（根 7 + `overview` 6 + `monitor` 5）；`test` 18 − 2 + 3 = **19**；`ui` 33；`scripts` 1；配置 4；合计 18 + 19 + 33 + 1 + 4 = **75**。

上一稿把“终态 `test` 21”写错：21 是过渡态的 `test` 数，终态退役两份 `external` 测试后为 19。这一处错账已在本版改正，§八 判据 7 同步。

目标文件树（只列增减与新增子目录，其余同 §一）：

```text
# 过渡态 src/（22）
src/index.ts  src/views.ts  src/server.ts  src/shell.ts  src/static.ts  src/inbox.ts  src/judge.ts
src/monitor/projection-state.ts  src/monitor/dashboard.ts  src/monitor/breakers.ts
src/monitor/costs.ts  src/monitor/health.ts
src/overview/{index,server,views,api,reports,reload,shell}.ts
src/external/{index,server,views}.ts          # 过渡期存在，M5 删

# 终态 src/（18）
src/index.ts  src/views.ts  src/server.ts  src/shell.ts  src/static.ts  src/inbox.ts  src/judge.ts
src/monitor/{projection-state,dashboard,breakers,costs,health}.ts
src/overview/{index,server,api,reports,reload,shell}.ts   # views.ts 已随 /legacy 退役
```

目录件数闸：`src/` 7、`src/overview/` 过渡 7 终态 6、`src/monitor/` 5、`src/external/` 过渡 3 终态 0、`test/` 过渡 21 终态 19，全部 ≤ `maxFilesPerDirectory = 25`。

---

## 二、目录与预算实测

### 2.1 目录件数（现状）

| 目录 | 件数 | 直接子项 |
|---|---|---|
| `src/` | 7 | 7 个 `.ts` |
| `src/overview/` | 7 | 7 个 `.ts` |
| `src/external/` | 3 | 3 个 `.ts` |
| `test/` | 18 | 17 个 `.test.ts` + `corpus.ts` |
| `ui/` | 3 | `main.js` `app.js` `theme.js` 加 8 个子目录 |
| `ui/lib/` | 2 | `format.js` `feed.js` |
| `ui/charts/` | 1 | `options.js` |
| `ui/composables/` | 3 | `useSnapshot.js` `useLedgerStream.js` `useEchart.js` |
| `ui/components/` | 9 | 九张卡与容器 |
| `ui/overview/` | 3 | `main.js` `app.js` `router.js` |
| `ui/overview/charts/` | 1 | `options.js` |
| `ui/overview/composables/` | 1 | `useOverviewJson.js` |
| `ui/overview/components/` | 9 | 九件概览组件 |
| `scripts/` | 1 | `vendor-pull.mjs` |
| `vendor/` | 8 | 3 产物 + 3 LICENSES + `README.md` + `vendor.lock.json` |

所有目录均在 `maxFilesPerDirectory = 25` 以内。目标新增 `src/monitor/` 后为 5 件，仍 ≤ 25；`test/` 过渡态升至 21、终态回落 19，均 ≤ 25。

### 2.2 行数基线与超限件

`scripts/guards/boundary-rules.mjs` 的 `lineBaseline` 中 panel 只有两条（按文件名核对，不记行号）：

| 文件 | 基线 | 目标 |
|---|---|---|
| `packages/panel/src/views.ts` | 662 | 拆为 facade + `src/monitor/` 三件，facade 降至 600 以下后从基线除名 |
| `packages/panel/src/overview/views.ts` | 629 | builder 与类型迁 `company`；余下旧 SSR 页约 420 行，随 `/legacy` 退役 |

`maxLinesPerFile = 600`。两件都超限，必须给拆分清单，不得提高阈值，也不得把新件塞进基线。

### 2.3 分层与允许边（现状）

`packageLayers.panel = 4`；允许边为 `panel→company`、`panel→store`、`panel→contract`。**无** `panel→api`、无 `panel→core`。

两处现实与允许边表不符，已核实：

1. `packages/panel/package.json` 把 `@studio-next/company` 放在 `devDependencies`，但 `src/overview/reports.ts` 运行时 import `parseJobOps`，`ui` 之外的生产链真的依赖它。目标移入 `dependencies`（§五.4）。
2. `src/judge.ts` 从 `src/views.ts` 取 `dayKeyOf`/`DAY_MS` 并在内部复刻 `core` 的 `compareQueueEntries` 语义（`src/inbox.ts` 的 `compareInboxRows`）。panel 不得 import `core`，对齐由 daemon 侧测试钉住（`apps/daemon/test/panel-inbox-align.test.ts`、`panel-judge-align.test.ts`）。这是允许边表的代价，不是漏洞，但必须在目标态保住钉子。

---

## 三、现有件逐条

### 3.1 `src` 根七件

#### F-panel-index

- **路径/处置**：`packages/panel/src/index.ts`；**现有**，**目标-保留**（barrel，随拆分收窄导出）。
- **归属与上位锚**：包根导出面；80-§2.1（panel 减职责）、81-§3.4（退役不得偷换责任）。
- **职责**：声明包名与状态标记；把监控纯函数、页壳、静态、收件箱、判断调用、服务器层六组符号聚合成包根入口。**非职责**：不做装配、不读配置、不建监听、不持有台账句柄。
- **内部结构**：`PACKAGE_NAME = '@studio-next/panel'`；`PACKAGE_STATUS = 'partial'`；六段 `export ... from './x.ts'`，无运行时逻辑、无副作用。
- **导出与依赖**：仅再导出。目标把首段来源从 `./views.ts` 改为 `./monitor/*` 与 `@studio-next/contract`（`dayKeyOf`/`DAY_MS`/`dayStartOf` 在 M1 后），`renderDashboardPage` 仍来自 `./views.ts` facade。禁止从 barrel 引出 `external`（它本就走独立子路径 `./external`）。
- **IO 与注入**：无。
- **状态与并发**：无。
- **错误与观测**：无自身错误路径；barrel 出错只可能来自被引文件解析失败，属启动期硬错。
- **测试与证据**：`PACKAGE_NAME`/`PACKAGE_STATUS` 全仓 grep 只见自身定义，**库级/未接**，仅声明，不主张有消费者。各再导出由子件的测试间接覆盖（`panel.test.ts`、`inbox.test.ts`、`judge.test.ts` 走工厂与函数，不走 barrel）。
- **规模与验收**：161 行；目标 <300。验收只看“拆走后包根导出符号集不减少”，不新增语义。

#### F-panel-views

- **路径/处置**：`packages/panel/src/views.ts`；**现有**；**目标-拆分**（662 行为 `lineBaseline` 条目）。
- **归属与上位锚**：监控面（`:8791`）纯投影层的读侧，零 IO 零 Hono。上位：77-§9.1（`REC-OBS-01`）、77-§9.2 六态、77-§9.3 观察十一面、80-§9.2（监控职责）、80-§9.5（读投影只读）、80-§9.6（六态呈现）、`TS-PORT-OBS-01` 的读侧实现。
- **职责**：把台账记录投影成监控 JSON 快照与聚合（jobs/runs/workers/events 分布/断路/成本），并保留旧 `/legacy` 单页内联 HTML。**非职责**：不写库、不装配、不维护投影表（`TS-PORT-OBS-01` 的“必要时调 `RecordProjection` 做表维护”只在 daemon 侧发生，panel 只读已有投影，80-§9.5）、不做健康状态（现状 `/api/health` 在 `server.ts`，目标迁 `monitor/health.ts`）、不承担对外 API。
- **内部结构（现状，已核实导出）**：
  - 快照类型 `SnapshotJobs`、`SnapshotRuns`、`ActiveWorker`、`SnapshotWorkers`、`SnapshotEvents`、`DashboardSnapshot`、`SnapshotOptions`。
  - 常量 `DEFAULT_PAGE_SIZE = 20`、`WORKERS_V0_NOTE`。
  - 纯函数 `buildDashboardSnapshot(ledger, options?)`、`recentRunSlice(records, limit)`、`aggregateActiveWorkers(runs, sessions)`、`eventDistribution(events)`、`JobView` 与 `jobViews(jobs, now)`。
  - 断路面 `isBreakerEvent`、`BREAKER_NOTE_PATTERN`、`BreakerNoteFields`、`parseBreakerNote`、`BreakerStatus`、`aggregateBreakers`、`BreakerSnapshot`、`BREAKERS_V0_NOTE`、`DEFAULT_BREAKER_DAYS = 7`、`MAX_BREAKER_DAYS = 90`。
  - 时间口径 `DAY_MS = 86_400_000`、`dayStartOf(ts)`、`dayKeyOf(ts)`。现状被 `src/judge.ts` 与 `src/overview/views.ts` 反向 import，是包内最热共享点，**M1 必须先下沉到 `contract` 再动其它拆分**，否则会制造反向依赖。
  - 成本面 `DailyCostPoint`、`CostsSnapshot`、`COSTS_NOTE`、`DEFAULT_COSTS_DAYS = 7`、`MAX_COSTS_DAYS = 90`、`COSTS_BUDGETS_BASIS_NOTE`、`buildCostsSnapshot(ledger, options?)`。
  - 旧页 `renderDashboardPage()` 与私有 `renderJobs`/`renderSnapshot`/`renderBreakers`/`renderCosts`/`refresh`/`prependEvent`，内联模板串含自有 JS。
  - **六态现状（已核实）**：本件所有快照都不带六态与来源游标，`DashboardSnapshot` 只有数据字段；80-§9.6 已把这一条标为“目标态要补的第一处”。
- **导出与依赖**：现状导出上述全部；依赖 `@studio-next/store` 的记录类型与 `Ledger`、`@studio-next/contract` 的事件名判定。**目标**：本文件只剩类型 + `renderDashboardPage()` 及旧页私有渲染，其余全部 re-export 自 `src/monitor/`；`dayKeyOf`/`DAY_MS`/`dayStartOf` 改为从 `@studio-next/contract` 再导出（M1 之后）；注入类型从 `Ledger` 收窄为只读视图（见下）。
- **IO 与注入**：现状函数接收 `Ledger` 句柄与可选 `{ now?, days?, recentRuns? }`；时间默认 `Date.now()`，测试注入 `now`。**目标**：接收 `ReadOnlyLedger`（80-§8.2 唯一名，`schemaVersion`/`query`/`get`/`close`，**不含 `db`、不含 `append`/`begin`/`kvSet`**）；`version()` 的调用点按 80-§8.2 改为 `schemaVersion` 属性。注意 `ReadOnlyLedger` 只给 `RecordQuery` 记录读口，没有投影表行读口，本件需要的 jobs/runs/sessions 行读取在缺口 G5 解决前不成立，目标态不得用 `TableProjectionResult.rows`（那是计数）顶替。无 fs、无网络、无子进程。
- **状态与并发**：纯函数，无状态。`buildDashboardSnapshot` 内多次读台账，非事务式一致快照，允许“读数时刻相邻”的轻微漂移；这是既定口径，不新增一致性承诺。投影可重建，重建不得改变事实（80-§9.5）。
- **错误与观测**：坏事件行（未知事件名、坏 note）被过滤器跳过或解析为 `null`，不抛错。`BREAKERS_V0_NOTE`/`COSTS_NOTE`/`WORKERS_V0_NOTE` 是随响应返回的口径注，属“数据来源自述”，不是错误处理。**六态纪律**：不得把“读不到”降级成空集合或 0（80-§9.5 末条、80-§9.6）；`ReadOnlyLedger.query`/`get` 的 `Err` 必须原样进 `observation`（`failure`/`subcause` 保留），`Ok` 的空页或 `Ok(undefined)` 才表示确实无数据；`partial` 只能翻成 `gap`/`conflict` 并附范围，不得作为状态字面量透出。不记录日志、不接触秘密。
- **测试与证据**：`test/panel.test.ts`（端面形状）、`test/alerts-costs.test.ts`（断路与成本全量口径）、`test/overview-monthly.test.ts` 间接受 `dayKeyOf` 影响。这些用例只证明投影与端面一致，不证明台账真实写入路径；六态与只读注入的断言分别归 `test/monitor-health.test.ts` 与 `test/readonly-ledger.test.ts`（目标新增）。拆分后前两件在 S1–S4 纯移动阶段**不改**，作为“行为零变更”证据；后续做金额与六态语义变更时须同提交改测试，届时不得再称零变更。
- **规模与验收**：662 行，超限。拆分清单与顺序见 §五.1；拆分后本文件目标 <350 行。验收：拆出件的导出与原符号同义，`ui` 与服务器层调用不动，barrel 导出集不减少；注入类型收窄后，现有调用点若传 `Ledger` 仍可编译（`ReadOnlyLedger` 是 `Ledger` 的结构子集），但不得再出现写方法调用。

#### F-panel-server

- **路径/处置**：`packages/panel/src/server.ts`；**现有**；**目标-保留**（460 行，低于阈值，不拆）。
- **归属与上位锚**：`:8791` 监控服务器层。上位：80-§2.4（panel 只留读投影）、80-§5.7/§5.8（错误两轴与不泄内部信息）、80-§8.2 与 80-D12（只读打开不跑 DDL）、80-§9.2（监控职责与六态健康）、80-§9.6（六态呈现）、80-§9.4 M4 第 8 项（只读证据）。
- **职责**：`createPanelApp` 装配监控路由（页面壳、静态、JSON 读面、SSE），提供 `servePanel` 真监听壳，并导出 `toWebRequest`/`forwardResponse`/`listenHono` 三个共用件供概览面复用（**panel 内部共用**；目标态 api 另持同源副本，panel 不从 api 取，见 §0.4 与 §五.6）。**非职责**：不做投影计算（在 `views.ts`/`monitor/`）、不决定公司数据、不提供任何重试/重派/关单按钮（77-§9.3 第 10 面与 80-§9.2：监控面只观察）、不跑 DDL、不写台账。
- **内部结构（现状，已核实）**：
  - `createPanelApp({ openLedger, pageSize?, streamIntervalMs? })`；`DEFAULT_STREAM_INTERVAL_MS = 2000`、`MAX_PAGE_SIZE = 200`。
  - 台账懒开 `getLedger()`：恰一次调用、失败不缓存、异常进 `app.onError` 回 503。
  - 路由：`/` 壳、`/legacy` 旧页、`/api/health`、`/api/jobs`、`/api/runs`、`/api/workers`、`/api/events`、`/api/breakers`、`/api/costs`、`/api/inbox`、`/api/judge`、`/api/snapshot`、`/api/events/stream`，外挂 `mountPanelStatic` 的 `/vendor/:file` 与 `/ui/*`。
  - `/api/health` 现状只返回 `{ ok: true, schema_version }`，**没有六态**；目标改为 `buildHealthSnapshot`（§四）的九面六态结构，`unknown`/`gap`/`stale` 一律显示异常（80-§9.2、80-§9.6）。
  - SSE：游标 `(ts, id)`，`CURSOR_DAWN = { ts: -1, id: '' }`，`Last-Event-ID` 定位，定位不到回落最新；`ready` 帧带 `retry:5000`；轮询用 `stream.sleep(intervalMs)`；唯一停止信号是 `stream.onAbort` 旗标。
  - 共用件 `toWebRequest(req, signal)`、`forwardResponse(res, response)`：小写头集合、逐跳头过滤、非 GET/HEAD 收 body 为 Buffer、断连挂 `AbortController`；**覆写** `x-sn-client-key = socket.remoteAddress`，外部不可伪造。
  - `listenHono(app, port, { hostname?, onClose?, label? })`：`label` 只用于错误文案；缺省绑定 `127.0.0.1`（常量缺省，旁有注释说明安全意图）。**归属**：panel 保留自有实现；api 的 `F-api-http-listen` 是同源副本，不是本件的消费者，也不得反向 import 本件（§0.4、§五.6）。
  - `servePanel`：`existsSync` 前置闸，缺库 `configInvalid('panel/db-not-found:<路径>')`；`VENDOR_FILES` 缺失只 `console.warn` 不拒启；`openLedger` 后 `listenHono` 的 `onClose` 关库。
- **导出与依赖**：导出 `createPanelApp`、`servePanel`、`toWebRequest`、`forwardResponse`、`listenHono`、`DEFAULT_STREAM_INTERVAL_MS`、`MAX_PAGE_SIZE` 与类型 `PanelApp`/`PanelAppOptions`/`PanelHandle`/`ServePanelOptions`/`HonoShellHandle`/`ListenHonoOptions`。依赖 `hono`、`node:fs`、`node:path`、`@studio-next/store`、`@studio-next/contract`、同包 `views.ts`/`shell.ts`/`static.ts`/`inbox.ts`/`judge.ts`；目标再加 `monitor/health.ts`。
- **IO 与注入（目标改写）**：
  - 现状 `servePanel` 里的 `openLedger` 无条件迁移，属 80-§8.2 的 14 个开库点之一；目标换 `openLedgerReadonly({ path, expectedSchemaVersion, readOnly: true, queryOnly: true })`，返回 `Result<ReadOnlyLedger, ClassifiedError>`，**不建库、不迁移、不写库头 PRAGMA**，只保留 `busy_timeout` 与 `query_only`（`journal_mode`/`synchronous` 会写库头，跳过）。
  - 注入位改名 `openReadOnly: () => Result<ReadOnlyLedger, ClassifiedError>`（原 `openLedger: () => Ledger`），`createPanelApp` 内懒调一次、失败不缓存、不把失败包装成空句柄；`expectedSchemaVersion` 由 wiring 注入（panel 不自查、不猜），常量来源是缺口 G7。
  - panel 自己的 `existsSync` 与 `configInvalid('panel/db-not-found:<路径>')` **删除**，改由 `openLedgerReadonly` 的 `Err` 表达：库缺失 `unavailable`/`STALL`/`db-missing`，版本落后或超前 `rejected_version`/`EVOLVE_REJECT`/`schema-behind`|`schema-ahead`（80-§8.2）。`CONFIG_INVALID` 只给路径/配置缺失或畸形。
  - 网络为 `node:http` 监听；env 不读；时钟隐式 `Date.now()`（SSE 与 `jobViews` 需要，未见注入位）。
- **状态与并发**：进程内缓存只读句柄一份；SSE 每连接一个轮询循环，生命周期由 `onAbort` 与 `onClose` 收口。无锁、无事务、无 fencing；只读是结构要求（14 个开库点任意一个先起都会改 schema，80-§8.2），不是性能优化。
- **错误与观测**：`CONFIG_INVALID` **只留给路径/配置缺失或畸形**；schema 版本不匹配一律 `rejected_version`/`EVOLVE_REJECT`（80-§8.2、80-§5.7），不得改写成 `CONFIG_INVALID`，也不得静默降级读。`app.onError` 现状把 `errText(err)` 原样回浏览器，可能外泄绝对路径与内部状态；**目标**统一 `errorResponse(c, err, traceId)` 输出 `{ error: { failure, category, subcause }, traceId }`，不回 `err.message`、不回堆栈、不输出绝对路径；`traceId` 由服务端 `crypto.randomUUID()` 生成并经 `x-sn-trace-id` 回传，**不信任客户端传入的 trace 头**；日志只记 `failure`/`category`/`subcause`/`traceId`，`detail` 若给必须过脱敏。失败分类不驱动任何重试（面板无重试，80-§9.2）。健康面必须携带 80-§9.6 规定的证据（`unknown` 带原因、`gap` 带最后可信游标与缺口、`stale` 带最后可信时间与新鲜度窗），不得沿用上一份健康快照，不得用“没有告警”暗示健康（80-§9.6）。秘密边界：不读 token、不打印头值；`x-sn-client-key` 只由 socket 覆写；panel 无 `SecretProvider` 注入位，出站只能形状兜底（`findSecretShaped`/`redactOutbound` 取自 `contract`），**不得声称已完全脱敏**（80-§11.2.1）。
- **测试与证据**：`test/panel.test.ts`（端面形状、查询参数、SSE 送达与续传）、`test/serve.test.ts`（真端口冒烟 1 例）、`test/shell-static.test.ts`（壳与静态）。缺口：无只读负向用例、无六态断言（现断言 `ok:true`）。目标三件必补：`test/monitor-health.test.ts`（六态与证据字段）、`test/readonly-ledger.test.ts`（`query_only=1`、启动前后 `user_version` 与表集合不变、版本不匹配拒起、读口 `Err` 不得降级空页或 `undefined`）、`test/panel.test.ts` 的 health 断言改写（`ok` 布尔消失，改断 `schemaVersion`/`expectedSchemaVersion`/`surfaces`/`generatedAt`，同提交完成）。
- **规模与验收**：460 行；目标仍 <600。验收点为五处改造：`/api/health` 六态结构替换、`openLedgerReadonly` 替换、`openReadOnly` 注入改名、错误体与 `traceId`、schema 版本拒起；每处都必须有对应负向用例。另：`toWebRequest`/`forwardResponse` 除 `listenHono` 与 `external` 外无其它消费者，M5 后可不再从 barrel 导出，本卷不代定导出面收窄时点。

#### F-panel-shell

- **路径/处置**：`packages/panel/src/shell.ts`；**现有**；**目标-保留**（66 行）。
- **归属与上位锚**：页壳纯函数层；上位 79-D 的“vendor 进仓零构建直引”路线与 80-§9.2 监控读面。
- **职责**：产出 importmap、`#app` 容器、`#boot-error` 兜底块与 `<noscript>` 的单页壳；声明 UI 入口与旧页路由常量。**非职责**：不做数据、不做路由分发、不做主题。
- **内部结构**：`PANEL_IMPORTMAP` 三项，含 `?v=` 版本位（vue 3.5.44、naive-ui 2.45.3、echarts 6.1.0）；`PANEL_UI_ENTRY = '/ui/main.js'`；`PANEL_LEGACY_ROUTE = '/legacy'`；`renderDashboardShell(): string`。
- **导出与依赖**：导出四符号；零 import（纯字符串）。
- **IO 与注入**：无。
- **状态与并发**：无。
- **错误与观测**：无。版本号与 `vendor.lock.json` 必须同步，漂移由 `test/shell-static.test.ts` 与 `scripts/vendor-pull.mjs` 的锁文件校验共同暴露。
- **测试与证据**：`test/shell-static.test.ts` 断言 importmap 三键与 `/ui/main.js`；`test/overview-ui.test.ts` 断言前端裸导入集合。不证明浏览器真实加载成功。
- **规模与验收**：66 行；目标不变。升级 vendor 时必须同改本文件与锁文件，属同一提交。

#### F-panel-static

- **路径/处置**：`packages/panel/src/static.ts`；**现有**；**目标-保留**（146 行）。
- **归属与上位锚**：静态资源路由；上位 79 工程口径（vendor 进仓）、80-§5.8（最小暴露）。
- **职责**：挂 `/vendor/:file` 与 `/ui/*` 两条读路由，含白名单、缓存头、弱 ETag 与 304。**非职责**：不做构建、不做压缩、不列目录。
- **内部结构（已核实）**：`VENDOR_FILES` 三件精确名单；`/vendor/:file` 只认名单内文件，`immutable` 一年缓存，进程内 `vendorCache`；`/ui/*` 扩展名白名单 `.js/.mjs/.css`，解码后拒 `..`、反斜杠、NUL，`realpathSync` 前缀闸，弱 ETag `W/"mtimeSize"`，`If-None-Match` 回 304，`nosniff`；HEAD 走同路由空体；缺失与穿越一律 `c.text('not found', 404)`。
- **导出与依赖**：`VENDOR_FILES`、`mountPanelStatic`、类型 `PanelStaticOptions`；依赖 `node:fs`、`node:path`、hono。
- **IO 与注入**：fs 读文件与 `realpathSync`；无网络出站；缓存进程内。
- **状态与并发**：`vendorCache` 无锁，只增不删，读侧幂等；文件替换后要求重启（缓存不失效），这是既定行为，目标不新增热更新。
- **错误与观测**：不区分“不存在”与“穿越”，统一 404，避免路径探测；不打印文件内容。
- **测试与证据**：`test/shell-static.test.ts` 覆盖 200/304/404/穿越/HEAD 与 vendor 完整性。不证明在真实反代下的缓存行为。
- **规模与验收**：146 行；目标不变。新增静态面必须同时进白名单与测试，不允许通配。

#### F-panel-inbox

- **路径/处置**：`packages/panel/src/inbox.ts`；**现有**；**目标-保留**（108 行）。
- **归属与上位锚**：收件箱只读投影；`TS-PORT-OBS-01 ObservationProjector` 的读侧包装点之一；上位 77-§9.1、80-§9.2（“收件箱读 `todo_queue` 投影，投影重建中显示 `gap`”）、80-§9.6。
- **职责**：`todo_queue` 的读序化投影，产出 `total/ready/awaitingApproval/persons/oldestWaitMs/byReason/rows`。**非职责**：不做派工、不改队列、不决定审批、不触发投影重建。
- **内部结构**：`INBOX_MAX_ROWS = 100`；`compareInboxRows`（与 `core` 的 `compareQueueEntries` 逐例一致，镜像实现，不 import `core`）；`buildInboxSnapshot(ledger, options?)` 现算 `waitingMs`、`pinned` 布尔化、按理由聚合与最老等待。目标增加 `observation` 摘要：读到投影为 `derived`（带规则版本与输入引用，panel 是投影的投影，**不得自称 `observed`**）；未挂载或读不到为 `unknown`（带原因）；投影重建中或读失败为 `gap`（带最后可信游标与缺口说明）。
- **导出与依赖**：三符号加类型 `InboxOptions`/`InboxRow`/`InboxSnapshot`；依赖 `@studio-next/store` 记录类型与 `@studio-next/contract` 的时间口径（目标，M1 后）、`./monitor/projection-state.ts`（目标）。
- **IO 与注入**：现状入参 `Ledger`；目标 `ReadOnlyLedger`（`schemaVersion`/`query`/`get`/`close`，不含 `db`/写方法）；时间 `now` 可注入，缺省 `Date.now()`。
- **状态与并发**：纯读；`waitingMs` 随读取时刻变化，属投影而非事实；投影重建期间本件不写任何东西，只把状态降为 `gap`。
- **错误与观测**：坏行跳过；不抛错；不打印行内容（可能含单号与人员信息，属公司内数据，不外泄）。**不得**把“读不到队列”显示成 0 条或空表（80-§9.6）；`Ok` 空页（确实读到空队列）才允许 `rows: []`；`Err`（读失败）一律 `gap` 加 `ledger-read-failed`，不得与空队列同形。
- **测试与证据**：`test/inbox.test.ts`（端面形状、排序、最老等待）、`apps/daemon/test/panel-inbox-align.test.ts`（与 `core` 排序语义对齐）。缺口：无跨包契约测试保证两边同时改会红，只有对齐用例；空队列与断源的可区分性归 `test/monitor-health.test.ts`。
- **规模与验收**：108 行；目标不变（预算 <160）。目标态加入 `REC-OBS-01` 快照元数据（见 `F-panel-monitor-projection-state`）。

#### F-panel-judge

- **路径/处置**：`packages/panel/src/judge.ts`；**现有**；**目标-保留**（327 行）。
- **归属与上位锚**：判断调用只读投影；上位 77-§9.1、80-§9.2（“判断调用只在有 judge 注册位时有数据；无数据 ≠ 0 次”）、80-§9.6。
- **职责**：按址聚合 `JUDGE_*` 事件，产出站点、合计、回退理由分布与熔断投影。**非职责**：不做判断、不改状态、不发通知、不决定站点是否存在。
- **内部结构（已核实）**：`DEFAULT_JUDGE_DAYS = 7`、`MAX_JUDGE_DAYS = 90`、`JUDGE_BREAKER_THRESHOLD_PROJECTION = 3`、`JUDGE_REASON_UNKNOWN = 'unknown'`、`JUDGE_SNAPSHOT_NOTE`；`isJudgeEvent`、`parseFallbackReason`、`replayJudgeBreakers`、`buildJudgeSnapshot`；`basis: 'events-replay-v1'`；窗口只约束统计，熔断重放吃全量史；`open` 判据为 `openSinceDay === nowDayKey`。目标增加 `observation` 摘要：有事件时 `derived`；无 judge 注册位或窗口内无事件时 `unknown`（带原因：`no-registration` / `no-events-in-window`），**不得填 0 次或空表冒充“没发生”**；`Err` 读失败为 `gap`（带 `ledger-read-failed`），与“`Ok` 空页”分开。
- **导出与依赖**：上列函数与类型 `JudgeBreakerProjection`/`JudgeOptions`/`JudgeReasonCount`/`JudgeSiteRow`/`JudgeSnapshot`/`JudgeTotals`；现状 import `./views.ts` 的 `DAY_MS`/`dayKeyOf`（M1 后改 `@studio-next/contract`）。不 import `core`。
- **IO 与注入**：现状入参 `Ledger` 与 `{ now?, days? }`；目标 `ReadOnlyLedger`；无其它 IO。
- **状态与并发**：纯读；重放全量史意味着成本随事件数线性增长，未见分页或截止游标，属**未证**性能面。
- **错误与观测**：坏 note 归 `unknown`，不丢弃计数；不打印事件原文。`JUDGE_REASON_UNKNOWN` 是**理由**取值的兜底，与本件新增的**状态** `unknown` 不是同一字段，不得混用同一字符串判断。
- **测试与证据**：`test/judge.test.ts`（形状、窗口、熔断重放）、`apps/daemon/test/panel-judge-align.test.ts`（根导出 `dayKeyOf` 加 `./judge` 子路径的对齐钉子）。目标拆分 `views.ts` 时必须保住这两处钉子，否则对齐静默失效。
- **规模与验收**：327 行；目标不变（预算 <400）。若 `dayKeyOf` 迁 `contract`，本件只改 import 行，不改语义。

### 3.2 `src/overview` 七件

#### F-panel-overview-index

- **路径/处置**：`packages/panel/src/overview/index.ts`；**现有**；**目标-保留**（82 行，barrel 收窄）。
- **归属与上位锚**：`:8789` 子路径入口 `@studio-next/panel/overview`；上位 80-§2.1、81-§3.4。
- **职责**：聚合概览面的投影、渲染、服务器与热重载导出。**非职责**：不做装配（公司目录装载在 daemon wiring）。
- **内部结构**：再导出 `views.ts` 的 builder 与渲染器、`api.ts` 的 payload 构造、`server.ts` 的 `createOverviewApp`/`serveOverview`、`reload.ts` 的 `mountHotCompanySource`、`shell.ts` 的壳。
- **导出与依赖**：纯再导出。**目标**：builder 迁 `company` 后，本件从 `company` 再导出；SSR 渲染器随 `/legacy` 退役后再删对应行。
- **IO 与注入**：无。
- **状态与并发**：无。
- **错误与观测**：无。
- **测试与证据**：由 `overview.test.ts`/`overview-json.test.ts` 间接覆盖；`apps/daemon/src/cli/overview.ts` 是真实消费方（`mountHotCompanySource`/`serveOverview`）。
- **规模与验收**：82 行；目标 <120。收窄导出后不得留下空段。

#### F-panel-overview-server

- **路径/处置**：`packages/panel/src/overview/server.ts`；**现有**；**目标-保留**（492 行）。
- **归属与上位锚**：`:8789` 服务器层；上位 80-§2.1、80-§8.2 与 80-D12、80-§9.3（概览面四条：数据源、每个数字可点回来源游标、缺数据显示缺口、`/legacy` 保留到 82 波次）、80-§9.6。
- **职责**：按 slug 挂载公司的只读路由族、旧 `/legacy` SSR 兼容面、换装壳路由与静态挂载；构造期做挂载合法性校验；每请求把六态与来源游标附到 payload。**非职责**：不做组织/财务投影（在 `api.ts`/`views.ts`）、不监听目录（在 `reload.ts`）、不读平台、不写台账。
- **内部结构（已核实）**：`OverviewCompanySource { slug, snapshotProvider, mission?, readPersonFile?, readReportFile?, openLedger?, listReportFiles?, snapshotInfo? }`；构造闸 `overview/no-companies`、`overview/bad-slug:<slug>`、保留字 `legacy`、`overview/duplicate-slug`；每请求校验 `snapshot.slug` 与挂载 slug 一致，错位抛错转 500；台账懒开缓存（`getLedger` 内的单次缓存）。**目标**：注入位 `openLedger?: () => Ledger` 收窄为 `openReadOnly?: () => Result<ReadOnlyLedger, ClassifiedError>`（保留字段名亦可，但类型必须收窄并在注释写明），`Ledger` 上的写方法在类型上不可达；错位不再回 500 明文，改 `errorResponse` 分类化。
  路由序：`/api/overview/companies`、`/api/overview/:slug/{snapshot,org,people,people/:personId,progress,finance,reports}`、`/legacy` 族、`/`、`/:slug` 族。**参数路由必须最后注册**，否则吞掉 `/legacy` 与 `/api`。
  `serveOverview(port, companies, { ledgerPath?, hostname? })` 用 `withLedger` getter 代理，防 spread 冻结热源的可选字段；`label: 'overview'`。**目标**：增加 `expectedSchemaVersion`（wiring 注入），开库改 `openLedgerReadonly({ path, expectedSchemaVersion, readOnly: true, queryOnly: true })`（现开库点在 `serveOverview` 内）。
- **导出与依赖**：`createOverviewApp`、`serveOverview` 与相关选项类型；依赖 hono、`node:fs`、`@studio-next/store`、`@studio-next/contract`、同包 `views.ts`/`api.ts`/`reports.ts`/`shell.ts`/`static.ts`，以及与 `src/server.ts` 共用 `listenHono`/`toWebRequest`。
- **IO 与注入**：SQLite 改为只读打开（现状 `serveOverview` 内的 `openLedger` 无条件迁移）；只保留 `busy_timeout` 与 `query_only`，不跑 DDL；fs 只读存在性；网络监听；目录监听不在此件。
- **状态与并发**：每公司一份 `snapshotProvider` 与只读台账缓存；热重载会换 snapshot，getter 代理保证读到新值。无锁。多实例只读同时打开是允许的，写只发生在 daemon。
- **错误与观测**：`CONFIG_INVALID` 只留给路径/配置缺失或畸形（如 `overview/no-companies`）；库缺失为 `unavailable`/`STALL`/`db-missing`，schema 版本不匹配为 `rejected_version`/`EVOLVE_REJECT`/`schema-behind`|`schema-ahead`（80-§8.2），**不得**改写成 `CONFIG_INVALID`。`onError` 现状原样回消息，目标同 `F-panel-server` 分类化。每个 payload 必须带 `observation`（六态 + 80-§9.6 规定的证据）与 `sourceCursor`；目录快照的 `snapshotInfo.lastError`/`watching=false` 必须映射为 `stale`/`gap`，不得继续显示为正常。
- **测试与证据**：`test/overview.test.ts`（端面、slug 路由、404、/legacy）、`test/overview-json.test.ts`（JSON 形状）、`test/overview-serve.test.ts`（真端口）、`test/overview-monthly.test.ts`（月报段）。目标补：只读打开与版本拒起（`test/readonly-ledger.test.ts`）、断源显示 `gap` 而非空/绿（`test/monitor-health.test.ts` 或本面独立用例）。不证明真实公司目录规模下的性能。
- **规模与验收**：492 行；目标 <600，不新增面。改造点：只读打开与版本拒起、六态与来源游标、错误分类化、`/legacy` 删除前宣告。

#### F-panel-overview-views

- **路径/处置**：`packages/panel/src/overview/views.ts`；**现有**；**目标-拆分**（629 行为 `lineBaseline` 条目）。
- **归属与上位锚**：概览面纯投影与旧 SSR；上位 80-§2.1（纯投影下沉 `company`）、80-§9.4 M1、77-§9.1、80-§9.6。
- **职责**：组织树、进度与财务三份投影构造器；旧 SSR 六页渲染（概览/组织/人事/档案/进度/财务）与公司清单。**非职责**：不做 JSON payload 与六态（在 `api.ts`）、不做路由、不做报表 join（在 `reports.ts`）。
- **内部结构（已核实）**：
  - 投影块：`escapeHtml`、`fmtUsd`/`escapePath`、`page`/`navTabs`、`renderNotFoundPage`、`OrgTreeNode`/`OrgTree`、`buildOrgTree`、`renderOrgTree`、`PROGRESS_NOTE`、`PROGRESS_MAPPING_NOTE`、`ProgressSnapshot`、`buildProgressSnapshot`、`FINANCE_NOTE`、`FinanceBudgets`、`FinanceLlmDay`、`MonthlyReportViewRow`、`parseMonthlyHeadline`、`FinanceSnapshot`、`buildFinanceSnapshot`。
  - 旧 SSR 块：`renderCompanyListPage`、`renderCompanyPage`、`renderOrgPage`、`renderPeoplePage`、`renderPersonPage`、`renderProgressPage`、`renderFinancePage`。
  - 现状 import `src/views.ts` 的 `dayKeyOf`，迁 `company` 后会变成 `company→panel` 的非法边，**必须先让 `dayKeyOf` 到 `contract`**（M1）。
- **导出与依赖**：上列全部；依赖 `@studio-next/company` 的类型（`DeptNode`/`CompanySnapshot`）、`@studio-next/store` 记录类型、hono 无关。
- **金额口径（目标，现状不合规）**：`fmtUsd(v: number, digits)` 是 `toFixed` 浮点显示，`buildFinanceSnapshot` 用 `+=` 做浮点求和（`reserveUsd`/`settleUsd`/`costUsd` 三口径）。公共金额形状是 `{ amount: DecimalString; currency }`（80-§7），目标在边界转换、不经 float、不四舍五入；源 `cost_usd:number` 的标度与舍入规则 80 未定（缺口 G9），**未解前不得宣称公共金额合规**，也不得自造汇率或舍入策略。
- **IO 与注入**：纯函数；无 fs、无库、无网络；时间口径 UTC，不读系统时区；公司本地日必须显式传时区或偏移参数，**不得读系统时区**（80-D17）。
- **状态与并发**：无。
- **错误与观测**：悬空父与成环在 `buildOrgTree` 里提升为根并给出 `promoted`/`cyclic` 列表，不抛错；缺月报 headline 解析为空指标，不臆造。**六态归属**：本件只产出结构事实，六态由 `api.ts` 判定；`cyclic` 是“投影自相矛盾”的候选信号，目标至少不得让它在页面上显示为正常树。具体取 `conflict` 还是 `derived` 加 `promoted` 列表，80 未逐项规定，登记回写（§六.1）。
- **测试与证据**：`test/overview.test.ts`（SSR 与 builder）、`test/overview-monthly.test.ts`（财务月报段）。目标拆分后 builder 用例迁 `company` 侧测试，SSR 用例随 `/legacy` 退役。
- **规模与验收**：629 行，超限。拆分清单见 §五.2；builder 迁出后本件约 420 行，低于阈值，可随之从基线除名。

#### F-panel-overview-api

- **路径/处置**：`packages/panel/src/overview/api.ts`；**现有**；**目标-保留**（267 行）。
- **归属与上位锚**：概览 JSON 投影层，零 IO 零 Hono；上位 77-§9.1（`REC-OBS-01`）、77-§9.2 六态、80-§9.3（每个数字可点回来源游标、缺数据显缺口）、80-§9.6、`REC-OBS-02`（监控故障显示）。
- **职责**：把公司快照与台账记录转成 `CompaniesPayload`/`OrgPayload`/`CompanySnapshotPayload`/`PeoplePayload`/`PersonPayload`/`ProgressPayload`/`FinancePayload`/`ReportsPayload`，并为每份 payload 给出六态与来源游标。**非职责**：不做组织/财务的原始投影（`views.ts`/`company`）、不做报表 join（`reports.ts`）、不写 `REC-OBS-02`（写者是 daemon）。
- **内部结构（已核实）**：各 payload 带 `basis` 自述（`company-directory`、`parent-chain`、`ledger-events+directory-aux`）；统一 `asOf`（ISO）与可选 `snapshotMeta{ at, atIso, version, watching, lastError }`；`promoted`/`cyclic` 是路径列表；`PersonPayload.body = null` 表示在册无正文；`ProgressPayload`/`FinancePayload` 在无台账时为 `null`（降级而非空聚合）。
  **目标**：`snapshotMeta` 保留为目录 watch 诊断面（`at`/`version`/`watching`/`lastError`），**另加** `observation`（六态 + 80-§9.6 证据）与 `sourceCursor`；`snapshotMeta` 本身**不得冒充 `REC-OBS-01`**，九字段元数据走 `F-panel-monitor-projection-state` 的 `SnapshotMeta`（`viewIdentity`/`authoritativeSource`/`sourceCursor`/`generatedAt`/`dataValidWindow`/`projectionRuleVersion`/`knowledgeScope`/`completeness`/`stateLegend`）。`null` 不再单独出现：无台账时必须给 `observation.state='unknown'` 与原因（`ledger-not-mounted`），否则“未知”会被读成“空”（80-§9.6 明令禁止）。
  **金额口径**：`FinancePayload` 目标为 `{ amount: DecimalString; currency: 'USD' }`，禁止 panel 侧 float 求和；源 `cost_usd:number` 的标度未定（缺口 G9），未解前不得宣称合规、不得自造舍入。
- **导出与依赖**：上列 builder 与 payload 类型；依赖 `@studio-next/company`、`@studio-next/store`、同包 `reports.ts`、`./monitor/projection-state.ts`（目标）。
- **IO 与注入**：纯函数，时间由调用方传入或 `Date.now()`；台账由调用方传入 `ReadOnlyLedger`；公司本地日由调用方显式传时区，不读系统时区（80-D17）。
- **状态与并发**：无。
- **错误与观测**：缺数据一律显式 `null` 加六态原因，不伪造零值；`partial` 只能翻成 `gap`/`conflict` 并附范围（80-§9.6）；不得把 `lastError` 吞掉，必须进 `observation`。六态取值规则（panel 是投影的投影，**最高态为 `derived`**）：由规则算出为 `derived`（附 `projectionRuleVersion` 与输入引用）；无台账为 `unknown`（附原因）；`snapshotInfo.watching=false` 或 `lastError` 非空为 `gap`（watch 停了是覆盖缺口，不是“陈旧”）；`stale` 需“最后可信时间 + 新鲜度窗”两个来源，80 未给窗长（缺口 G10），v0 不可达、不得伪造；`cyclic` 或来源互相矛盾为 `conflict`（并列双方原值与来源），读失败或覆盖不足为 `gap`（附最后可信游标与缺失项）。`ReadOnlyLedger.query` 的 `Ok` 空页才是真无数据，`Err` 一律 `gap` 并带 `failure`/`subcause`（`Ok(undefined)` 只对单记录读口有意义）。`observed` 只在未来由 daemon 注入来源游标与权威端点时可达，v0 不得出现。
- **测试与证据**：`test/overview-json.test.ts`（各 payload 形状与降级）、`test/overview-monthly.test.ts`。目标补：每个 payload 的六态与证据字段断言，“缺数据不得显示为正常”的负向断言。不证明真实目录下的字段完整性。
- **规模与验收**：267 行；目标 <400，只加状态与游标字段，不加新端点。

#### F-panel-overview-reports

- **路径/处置**：`packages/panel/src/overview/reports.ts`；**现有**；**目标-保留**（436 行）。
- **归属与上位锚**：报表面 join 投影；上位 77-§9.1、80-§9.2；报表规格归 82 波次（正文读取仍待批示）。
- **职责**：把目录报表落位与台账事件按 `组名+文件名` 对齐，给出新鲜度、严重度与三类异常：`missing`（有落位无件，仅 `dirAvailable` 时判）、`unanchored`（有件无落位）、受辖岗过滤（`parseJobOps(payload).output !== undefined` 且 `type !== 'patrol'`）。**非职责**：不读报表正文（v1 只出清单）、不改目录。
- **内部结构（已核实）**：`REPORT_LIGHT_TEXT { fresh, stale, debt, none }`、`LIGHT_SEVERITY`、`COMPANY_GROUP = '（公司级）'`、`OTHER_GROUP = '（其他落点）'`、`REPORTS_BODY_NOTE`、`REPORTS_V2_NOTE`；严重度序 `stale > debt > none > fresh`。
- **导出与依赖**：payload builder 与常量；运行时 import `@studio-next/company` 的 `parseJobOps`，这是 `devDependencies` 分类错误的直接来源（§五.4）。
- **IO 与注入**：纯函数；目录文件清单与事件由调用方注入，本件不访问 fs。
- **状态与并发**：无。
- **错误与观测**：分类异常以数据形态返回（`missing`/`unanchored`），不以异常抛出；不读正文故无秘密面。
- **测试与证据**：`test/overview-reports.test.ts`（三类异常、严重度序、分组）、`test/overview-monthly.test.ts` 部分覆盖。不证明真实报表目录规模。
- **规模与验收**：436 行；目标 <600。若报表正文读取获批，另立文件与实现单，不塞进本件。

#### F-panel-overview-reload

- **路径/处置**：`packages/panel/src/overview/reload.ts`；**现有**；**目标-保留**（178 行）。
- **归属与上位锚**：目录热重载 IO 层；上位 80-§9.2（快照时间与 watching 状态）、`REC-OBS-01` 快照元数据。
- **职责**：`fs.watch(recursive)` 加防抖，把公司目录变化转成新快照；失败保旧图，只记 `lastError`。**非职责**：不解析目录内容（由注入的 `reload` 做）、不做路由。
- **内部结构（已核实）**：`SnapshotInfo { at, version, watching, lastError }`；`mountHotCompanySource({ directory, initial, reload, debounceMs = 150, watchEnabled? })`；可选字段全部用 getter 活取（不得 spread，否则冻结旧值）；`close()` 清 timer 与 watcher。
- **导出与依赖**：`mountHotCompanySource` 与类型；依赖 `node:fs`、`node:path`。
- **IO 与注入**：fs watch；`reload` 与 `initial` 由 daemon wiring 注入。
- **状态与并发**：单一 watcher；防抖计时器；并发 reload 的乱序结果未做序号防护（`reload.test.ts` 覆盖基本时序）。**未证**：高变更频率下的最终一致性。
- **错误与观测**：reload 失败保留旧图并写 `lastError`，`watching` 仍为真；`watcher.on('error')` 降级 `watching = false`。这些字段直接进 `snapshotMeta`，是 UI `SnapshotBadge` 的数据源。
- **测试与证据**：`test/overview-reload.test.ts`（防抖、保旧图、错误降级、close 清理）。不证明跨平台 watch 行为（macOS 与 Linux 的 recursive 支持不同，属**未证**）。
- **规模与验收**：178 行；目标 <300。若需要跨平台保证，须另立实现单而不是在本件里加轮询兜底。

#### F-panel-overview-shell

- **路径/处置**：`packages/panel/src/overview/shell.ts`；**现有**；**目标-保留**（59 行）。
- **归属与上位锚**：概览换装壳；上位 79 的 vendor 直引路线。
- **职责**：为所有概览路径回同一单页壳，前端按路径自行切页。**非职责**：不做服务端渲染、不做路由匹配。
- **内部结构**：`renderOverviewShell(title)` 复用 `PANEL_IMPORTMAP`，入口指向 `/ui/overview/main.js`。
- **导出与依赖**：单函数与常量；依赖同包 `src/shell.ts`。
- **IO 与注入**：无。
- **状态与并发**：无。
- **错误与观测**：无。
- **测试与证据**：`test/overview-json.test.ts` 与 `test/overview-ui.test.ts` 间接覆盖壳与入口路径。
- **规模与验收**：59 行；目标不变。

### 3.3 `src/external` 三件（过渡实现）

#### F-panel-external-index

- **路径/处置**：`packages/panel/src/external/index.ts`；**现有**；**目标-退役**（M5，与 `"./external"` 导出同提交删除）。
- **归属与上位锚**：`:8788` 子路径入口；上位 80-§2.4（对外面迁出 panel）、81-§3.4（退役不得先删 export）。
- **职责**：聚合对外面的服务器与投影导出。**非职责**：不做装配。
- **内部结构**：再导出 `createExternalApp`/`serveExternal`/`ExternalHandle`/来源类型与 `views.ts` 的名片与端点表。
- **导出与依赖**：纯再导出；依赖同目录两件。
- **IO 与注入**：无。
- **状态与并发**：无。
- **错误与观测**：无。
- **测试与证据**：由 `test/external.test.ts` 与 `test/external-serve.test.ts` 经子路径消费。
- **规模与验收**：48 行。退役条件：`packages/api` 接管 **16 条路由**（10 条读面含新增 `GET /v1/requests/status` 与按订阅面计的 `501 /v1/events`、4 条触发、`/v1/subscriptions`、`GET /` 索引）、`cli/external` 改线或退役、认证/配额/幂等/只读迁移验证完成（§五.3）。删除后仍保留 `"./inbox"`/`"./judge"` 两条子路径。

#### F-panel-external-server

- **路径/处置**：`packages/panel/src/external/server.ts`；**现有**；**目标-替换**（过渡期）→ **目标-退役**（M5）。
- **归属与上位锚**：`:8788` 服务器层；上位 80-§2.4、80-§9.4（意图入口与迁移五步）、80-§9.5（读投影只读）、80-§9.6。
- **职责（过渡期）**：提供对外只读端点与唯一触发端点 `POST /v1/requests`。**非职责**：不派工、不调平台（目标）、不持有凭据、不写台账（目标）。
- **内部结构（已核实）**：`ExternalCompanySource { slug, snapshotProvider, openLedger?, listReports?, contact? }`；`ExternalPlatformWrite { issues: { create } }`（收窄写原语）；常量 `DEFAULT_REQUESTS_PER_MINUTE = 30`、`QUOTA_WINDOW_MS = 60_000`、`DEFAULT_IDEMPOTENCY_TTL_MS = 24h`、`DEFAULT_EXTERNAL_PAGE_SIZE = 20`、`MAX_REQUEST_BODY_BYTES = 100_000`、`TOKEN_HEADER = 'x-sn-token'`、`CLIENT_KEY_HEADER = 'x-sn-client-key'`、`IDEMPOTENCY_KV_PREFIX = 'external:idem:'`、`EXTERNAL_REQUEST_TYPE = '外部需求'`。
  路由（现状）：`/` 自述、`/v1/agent-card`、`/v1/company`、`/v1/org`、`/v1/people`、`/v1/projects`、`/v1/issues`、`/v1/finance`、`/v1/reports`、`/v1/events`（501 占位）、`POST /v1/requests`。**目标（迁 `packages/api` 后）**：以上 11 条再加 `GET /v1/requests/status`、`/v1/explore`、`/v1/tasks`、`/v1/intel`、`/v1/subscriptions`，合计 **16 条**；`requests/status` 与三个触发面、订阅面在 panel 侧**均未实现**。
  触发端点六步：鉴权 401/403 至配额 429 至装配就绪 501 至入参 400/413 至幂等命中至落单 201/502。令牌 `sha256` 等长化后 `timingSafeEqual`。`scoped()` 三态 404/400/成功。`collectMirrors` 按 Ledger 实例去重。
  `serveExternal`：`ledgerPath` 存在性闸 `external/db-not-found:<路径>`；随后 `openLedger`（无条件迁移）；缺省绑定 `127.0.0.1`（起监听前有注释明确这是对 `00-总览` D4“对外 API 默认局域网”的安全反转）；`label: 'external'`；`onClose` 关库。
  **两处违例**（按调用点，不记行号）：触发端点先 `platform.issues.create` 绕过网关，随后 `ledger.kvSet` 直写 `daemon_kv`（80-§9.1 已判定为“待迁移违例，不是可保留的设计”）。
- **导出与依赖**：`createExternalApp`、`serveExternal`、`ExternalAppOptions`/`ServeExternalOptions`/`ExternalHandle`/`ExternalCompanySource`/`ExternalPlatformWrite` 与十个常量；依赖 hono、`node:fs`、`node:path`、`node:crypto`、`@studio-next/store`、`@studio-next/contract`。
- **IO 与注入**：现状 SQLite 读加 kv 写、网络监听、时钟与配额存储进程内。**目标（在 `packages/api` 侧）**：台账换成 `openLedgerReadonly` 构造的 `issuesView`（必填注入，api 自己不碰库）；`openLedger` 与 `platform` 两个注入位**删除**；写路径改为 `emitIntent`/`getIntentReceipt`（转发 `IntentIngress.submit`/`receipt`），不得直引 `engine.ingest`（80-§9.4 装配决策 1）。**回执查询**：`GET /v1/requests/status` 只调注入的 `receipt(key)` 读进程内已提交快照，不新增注入位、不直查库、不触发物化；快照缺回 `503`+`receipt-not-in-snapshot`，成功与失败都带 `Cache-Control: no-store`。
- **状态与并发**：配额按客户端键固定窗计数，进程内 Map；幂等以台账 kv 为持久层（这正是那处 `ledger.kvSet` 违例）。目标幂等**不再由 api 自建存储**：键与 TTL 由 `REC-WORK-01` 的 `intentRef` 加 `IntentReceiptStore` 投影承担（`81-files/14-api.md` 的 `submission.ts` 只做请求形状与转发，不持第二套幂等表）。`requests/status` 是纯读：连查多次不产生新记录、不调 `replayQueued`、不改变回执；HTTP 层只拿 `Pick<…,'submit'|'receipt'>`，类型上没有重放入口。
- **错误与观测**：错误码已分类（`PLATFORM_ERROR` 等），但正文含 `errText(err)`，同样有外泄面；目标只回脱敏 `failure`/`category`/`subcause` 加 `traceId`（80-§9.4）。秘密边界：只比对哈希，不打印 token。
- **测试与证据**：`test/external.test.ts`（521 行，鉴权/配额/幂等/越权 fail-closed）、`test/external-serve.test.ts`（真端口）。这些用例在 M5 前保留作回归对照，其覆盖由 `api/test/**` 与装配层测试承接后方可删（80-§9.4 M4 的 11 条验证项、14-api §7.4 退役硬条件）。本卷只写退役条件，不复制其契约。
- **规模与验收**：571 行，低于阈值但整件退役，不拆。**M5 前必须保证**：api 侧等价端点与负向用例全绿、启动两态验证、只读证据（`query_only=1`、启动前后 `user_version` 与表集合不变）、制作人批示；改线（M3）之前删旧面等于断服。

#### F-panel-external-views

- **路径/处置**：`packages/panel/src/external/views.ts`；**现有**；**目标-退役**（投影迁 `packages/api`）。
- **归属与上位锚**：对外投影；上位 80-§2.4、80-§9.4 的 M2 源到目标映射。
- **职责**：名片、项目卡、部门/人员视图、组织告警、端点表、幂等值编解码。**非职责**：不做路由、不做认证、不读库。
- **内部结构**：`FRAMEWORK_VERSION = '0.9.0'`、`CONTACT_MISSING_NOTE`、`EXTERNAL_ENDPOINTS`（现 10 条，与名片同源；迁 api 后须补 `GET /v1/requests/status` 成 11 条，`explore`/`tasks`/`intel`/`subscriptions` 四条新增路由与 `/` 索引归 14-api 另表）、`AgentCard`/`buildAgentCard`、`filterIssues`、`issueView`、`buildProjectCards`、`deptView`、`personView`、`orgWarns`、`ReportFile`、`REPORTS_BODY_NOTE`、`IdempotentValue`/`buildIdempotentValue`/`parseIdempotentValue`（坏值 fail-open 为 miss）。
- **导出与依赖**：上列全部；依赖 `@studio-next/company`/`@studio-next/store` 类型。
- **IO 与注入**：纯函数。
- **状态与并发**：无。
- **错误与观测**：坏幂等值当未命中（fail-open 到“重新落单”），这是刻意的宽松策略，迁移时须原样保留或由 82 重新裁定。**视图白名单**：目标迁入 api 后按 80-§9.4 的三级白名单（`public`/`partner`/`internal`）序列化，本件现状的 `{...m}` 式展开会泄露新增列，迁移时改逐键白名单（`81-files/14-api.md` §6 已列字段表）。
- **测试与证据**：`test/external.test.ts` 覆盖名片字段与端点表一致性。
- **规模与验收**：201 行；整件随主机退役。目标文件 ID 归 `81-files/14-api.md`（`views/agent-card.ts`、`views/company.ts`、`views/issues.ts`、`views/finance.ts`、`submission.ts`），本卷不代设。

### 3.4 `test` 十八件

判定口径：测试绿只证明当前项目回归；下列每条都写明“不证明什么”。

#### F-panel-test-panel

- **路径/处置**：`packages/panel/test/panel.test.ts`；**现有**；**目标-保留并扩展**（278 行）。
- **归属与上位**：`:8791` 端面测试，对应 `F-panel-server`；上位 80-§9.2、80-§9.6。
- **覆盖**：`app.request()` 进程内驱动，ledger 工厂注入共享 tmp 库句柄；各端面形状、查询参数过滤、SSE 送达与断线续传。
- **非职责**：不开真端口、不覆盖只读打开与版本拒起（归 `readonly-ledger`）、不覆盖六态穷举（归 `monitor-health`）。
- **夹具/断言**：`test/corpus.ts` 造 due 岗、在途 run 与各类事件；断言为字段形状与事件顺序。目标最小同步：`/api/health` 的 `{ ok: true, schema_version }` 断言改为“九面（ledger/jobs/runs/workers/events/breakers/costs/inbox/judge）各有六态且状态取自合法枚举”，并断言不再存在 `ok` 布尔字段。
- **缺口/未证**：不证明六态在真实故障下的正确性；断源、版本不匹配、投影重建中的断言分别归 `monitor-health` 与 `readonly-ledger`。

#### F-panel-test-serve

- **路径/处置**：`packages/panel/test/serve.test.ts`；**现有**；**目标-保留并扩展**（48 行）。
- **归属与上位**：`servePanel` 真端口冒烟，对应 `F-panel-server`；上位 80-§8.2 与 80-D12、80-§9.4 M4 第 8 项。
- **覆盖**：随机端口起真 `node:http`，`fetch /api/health`，优雅关闭。
- **非职责**：端面形状归 `panel.test.ts`；不验证并发连接与背压；不重跑只读证据全集（归 `readonly-ledger`）。
- **夹具/断言**：只断言监听壳接线（适配器加生命周期）。目标补一条启动负向：`expectedSchemaVersion` 与库内版本不一致时 `servePanel` 抛 `rejected_version`/`EVOLVE_REJECT` 且不留监听。
- **缺口/未证**：只读证据（`query_only=1`、启动前后 `user_version` 与表集合不变）归 `test/readonly-ledger.test.ts`；跨进程并发迁移（U80-16）未证，本件不主张。

#### F-panel-test-alerts-costs

- **路径/处置**：`packages/panel/test/alerts-costs.test.ts`；**现有**；**目标-保留**（568 行，**不拆**）。
- **归属与上位**：断路与成本全量口径，对应 `F-panel-views` 的断路面与成本面。
- **覆盖**：断路 note 解析、连击聚合、成本按日聚合、预算口径注、事件流增强。
- **非职责**：不验证真实台账写入路径、不验证 UI 渲染。
- **夹具/断言**：构造事件序列，断言聚合结果与 note 原文透传。
- **缺口/未证**：新增六态与断源断言不进本件（避免触碰 568 行既有件），归 `test/monitor-health.test.ts`。

#### F-panel-test-inbox

- **路径/处置**：`packages/panel/test/inbox.test.ts`；**现有**；**目标-保留**（111 行）。
- **归属与上位**：收件箱读面，对应 `F-panel-inbox`。
- **覆盖**：`/api/inbox` 形状、排序、最老等待、人数聚合。
- **非职责**：不验证与 `core` 的跨包对齐（在 daemon 侧）。
- **夹具/断言**：`todo_queue` 行直接造，断言 `pinned` 布尔化与 `waitingMs` 计算。
- **缺口/未证**：`ID-panel-inbox` 与 `core` 的 `compareQueueEntries` 若同时改语义，本件不会红，只有 daemon 对齐用例会红。

#### F-panel-test-judge

- **路径/处置**：`packages/panel/test/judge.test.ts`；**现有**；**目标-保留**（262 行）。
- **归属与上位**：判断调用读面，对应 `F-panel-judge`。
- **覆盖**：`/api/judge` 形状、窗口统计、熔断重放、`unknown` 理由。
- **非职责**：不验证真实判断事件来源。
- **夹具/断言**：构造 `JUDGE_*` 事件，断言 `basis: 'events-replay-v1'` 与 `openSinceDay` 判定。
- **缺口/未证**：`dayKeyOf` 迁 `contract` 后须复核边界日行为不变。

#### F-panel-test-overview

- **路径/处置**：`packages/panel/test/overview.test.ts`；**现有**；**目标-保留，分区迁移**（515 行）。
- **归属与上位**：`:8789` 端面与 SSR，对应 `F-panel-overview-server` 与 `F-panel-overview-views`。
- **覆盖**：slug 路由、404、根路径清单、组织/人事/财务/进度页、`/legacy` 兼容面。
- **非职责**：JSON 读面归 `overview-json.test.ts`。
- **夹具/断言**：假 `OverviewCompanySource`，真 hono app 进程内请求。
- **缺口/未证**：builder 直测在目标拆分后迁 `company` 侧测试；SSR 用例随 `/legacy` 退役。当前不证明真实目录规模。

#### F-panel-test-overview-json

- **路径/处置**：`packages/panel/test/overview-json.test.ts`；**现有**；**目标-保留并扩展**（390 行）。
- **归属与上位**：概览 JSON 读面与换装壳，对应 `F-panel-overview-api`/`overview-shell`/`overview-server`。
- **覆盖**：八类 payload 形状、`basis` 自述、`asOf` 与 `snapshotMeta`、无台账降级为 `null`。
- **非职责**：不验证 UI 渲染（归 `overview-ui.test.ts`）。
- **夹具/断言**：注入快照与台账，断言字段与降级路径。
- **缺口/未证**：目标为每个 payload 增加六态与 `REC-OBS-02` 缺口位，本件须新增“缺数据不得显示为正常”的断言。

#### F-panel-test-overview-monthly

- **路径/处置**：`packages/panel/test/overview-monthly.test.ts`；**现有**；**目标-保留**（169 行）。
- **归属与上位**：财务页月报段，对应 `F-panel-overview-views` 的 `MonthlyReportViewRow` 与 `reports` 表读取。
- **覆盖**：`type='monthly'` 行与 `json_ref` 快照读取、headline 解析、空值处理。
- **非职责**：不验证报表正文渲染（v1 不出正文）。
- **夹具/断言**：造月报行与坏 JSON，断言不抛错且字段为空。
- **缺口/未证**：不证明真实月报数据完整性。

#### F-panel-test-overview-reload

- **路径/处置**：`packages/panel/test/overview-reload.test.ts`；**现有**；**目标-保留**（249 行）。
- **归属与上位**：`mountHotCompanySource` 单测，对应 `F-panel-overview-reload`。
- **覆盖**：防抖、失败保旧图、`lastError`、`watching` 降级、`close()` 清理。
- **非职责**：不验证跨平台 `fs.watch` 差异。
- **夹具/断言**：临时目录写文件触发 watch，注入 `reload` 桩。
- **缺口/未证**：Linux 与 macOS 的 recursive 行为差异属**未证**，不得据本件断言跨平台一致。

#### F-panel-test-overview-reports

- **路径/处置**：`packages/panel/test/overview-reports.test.ts`；**现有**；**目标-保留**（311 行）。
- **归属与上位**：报表 tab v1，对应 `F-panel-overview-reports`。
- **覆盖**：`missing`/`unanchored`、严重度序、公司级与其它落点分组、受辖岗过滤。
- **非职责**：不验证正文读取（未获批）。
- **夹具/断言**：目录清单与事件成对构造，断言 join 键为 `组名+文件名`。
- **缺口/未证**：不证明真实报表目录规模与命名分布。

#### F-panel-test-overview-serve

- **路径/处置**：`packages/panel/test/overview-serve.test.ts`；**现有**；**目标-保留并扩展**（157 行）。
- **归属与上位**：`serveOverview` 真端口冒烟，对应 `F-panel-overview-server`。
- **覆盖**：随机端口监听、fetch、优雅关闭；`withLedger` getter 语义。
- **非职责**：端面形状归 `overview.test.ts`。
- **夹具/断言**：3 例，只验监听壳与台账生命周期。
- **缺口/未证**：目标须补“台账只读打开且不迁移”的负向断言。

#### F-panel-test-overview-ui

- **路径/处置**：`packages/panel/test/overview-ui.test.ts`；**现有**；**目标-保留并扩展**（125 行）。
- **归属与上位**：`ui/overview/*` 模块门禁，对应 §3.5 的概览前端九加三件。
- **覆盖**：扫裸导入集合必须 ⊆ `{vue, naive-ui, echarts}`（含动态 `import`）；`router.js` 纯函数直测。
- **非职责**：不启动浏览器、不验证渲染效果。
- **夹具/断言**：源码文本扫描加 `parseOverviewPath` 表驱动断言。
- **缺口/未证**：不证明浏览器真实加载（归 82 波次的人工验收）。

#### F-panel-test-external

- **路径/处置**：`packages/panel/test/external.test.ts`；**现有**；**目标-退役**（521 行，随 `src/external/` 走）。
- **归属与上位**：`:8788` 端面测试；上位 80-§2.4。
- **覆盖**：现状 10 个端点（`EXTERNAL_ENDPOINTS` 全表）形状、鉴权 fail-closed、配额、入参上限、幂等命中、越权调用拒绝；**不含** `GET /v1/requests/status`（panel 侧无此路由，其正反用例归 80-§9.4 M4 第 11 项与 `api/test/**`）。
- **非职责**：不覆盖真端口（归 `external-serve.test.ts`）。
- **夹具/断言**：`app.request()` 进程内，注入 `platform` 桩与令牌。
- **缺口/未证**：退役条件是该套断言在 `packages/api` 有等价实现且已过审；本卷不代定其新文件 ID（归 `81-files/14-api.md`）。

#### F-panel-test-external-serve

- **路径/处置**：`packages/panel/test/external-serve.test.ts`；**现有**；**目标-退役**（195 行）。
- **归属与上位**：`serveExternal` 真端口，对应 `F-panel-external-server`。
- **覆盖**：随机端口监听、绑定面、mock 外部 agent 的“提需求至读进度”链路。
- **非职责**：不覆盖配额边界与多实例行为。
- **夹具/断言**：mock fetch 链，断言两步状态。
- **缺口/未证**：启动两态（关闭不启动、开启缺注入整机 `CONFIG_INVALID`）现无对应用例，目标随 `ServeConfig.external` 迁 daemon 装配后由 82 负向用例承担。

#### F-panel-test-shell-static

- **路径/处置**：`packages/panel/test/shell-static.test.ts`；**现有**；**目标-保留**（186 行）。
- **归属与上位**：页壳与静态路由加 vendor 完整性，对应 `F-panel-shell`/`F-panel-static`。
- **覆盖**：importmap 三键、`/ui/main.js`、vendor 三件存在与锁文件一致、200/304/404、路径穿越、HEAD。
- **非职责**：不验证浏览器缓存策略在反代下的行为。
- **夹具/断言**：直接请求 hono app，断言头与状态码。
- **缺口/未证**：ETag 用 `mtimeSize`，跨文件系统精度差异属**未证**。

#### F-panel-test-ui-feed

- **路径/处置**：`packages/panel/test/ui-feed.test.ts`；**现有**；**目标-保留**（60 行）。
- **归属与上位**：`ui/lib/feed.js` 的 `mergeFeed` 单测。
- **覆盖**：去重、`(ts, id)` 降序、截 50、坏行免疫。
- **非职责**：不覆盖 SSE 连接状态机（在浏览器内）。
- **夹具/断言**：纯数组输入输出。
- **缺口/未证**：不证明真实 SSE 乱序与重复投递下的行为（依赖服务端游标）。

#### F-panel-test-ui-syntax-gate

- **路径/处置**：`packages/panel/test/ui-syntax-gate.test.ts`；**现有**；**目标-保留**（51 行）。
- **归属与上位**：`ui/**` 语法门禁，源于 2026-10-23 四件模板串嵌套反引号静默合入事故。
- **覆盖**：用 `node --check` 逐件扫 `ui/**` 的 `.js`/`.mjs`。
- **非职责**：不做语义检查、不做类型检查（`ui` 不进类型门禁）。
- **夹具/断言**：枚举文件，逐件执行 `node --check`，非零即红。
- **缺口/未证**：`node --check` 不能发现运行时错误；浏览器执行仍属**未证**。

#### F-panel-test-corpus

- **路径/处置**：`packages/panel/test/corpus.ts`；**现有**；**仅测试/演示**（89 行）。
- **归属与上位**：测试语料工厂，仅被 `panel.test.ts` 等消费。
- **覆盖**：造“有 due 岗、有在途 run、有各类事件”的台账语料。
- **非职责**：不是生产数据源，不得被 `src` import。
- **夹具/断言**：无断言，只提供构造器。
- **缺口/未证**：语料不覆盖六态所需的反例（断源、冲突、陈旧），目标新增用例自造。

### 3.5 `ui` 三十三件

前端纪律（全组共用）：`ui` 不进类型门禁，只由 `ui-syntax-gate.test.ts` 与 `overview-ui.test.ts` 两道门禁把守；只允许裸导入 `vue`、`naive-ui`、`echarts`，且实际解析走 importmap 到 `/vendor/*`；不写 CSS 文件，样式全归 Naive CSS-in-JS；组件只消费 `/api/*` 已定形状，不自行拼口径。

ID 规则（可复算）：`F-panel-ui-<相对路径去扩展名>`，其中 `/` 与文件名驼峰边界转 `-`、整串小写。例：`ui/components/JobsCard.js` 对应 `F-panel-ui-components-jobs-card`，`ui/overview/composables/useOverviewJson.js` 对应 `F-panel-ui-overview-composables-use-overview-json`。

#### F-panel-ui-main

- **路径/处置**：`packages/panel/ui/main.js`；**现有**；**目标-保留**（16 行）。
- **归属与上位**：`:8791` 换装页入口。
- **职责**：`createApp(App)` 加 `app.use(naive)` 全量注册后挂载。**非职责**：不做路由、不做取数。
- **内部/依赖**：仅 import `vue`、`naive-ui`、`./app.js`、`./theme.js` 所需项。
- **IO/状态/错误**：无 IO；挂载失败由页壳 `#boot-error` 显示。
- **测试/规模**：`shell-static.test.ts` 与 `overview-ui.test.ts` 间接覆盖；16 行。

#### F-panel-ui-app

- **路径/处置**：`packages/panel/ui/app.js`；**现有**；**目标-保留**（127 行）。
- **归属与上位**：监控面根组件，12 栅格装配六卡两图加页头状态行。
- **职责**：组合 `StatStrip`、六张表卡、成本与分布图、事件流卡，接 `useSnapshot` 与 `useLedgerStream`。**非职责**：不加工数据、不做口径计算。
- **内部/依赖**：`NLayout`/`NGrid`/`NCard` 族；依赖 `components/*`、`composables/*`、`lib/format.js`。
- **IO/状态**：轮询与 SSE 状态由 composable 持有；本件只读。
- **错误与观测**：单点失败显示 error 标记，不隐藏卡片（空态与故障态可区分）。
- **测试/规模**：`ui-syntax-gate` 覆盖语法；渲染未证；127 行。

#### F-panel-ui-theme

- **路径/处置**：`packages/panel/ui/theme.js`；**现有**；**目标-保留**（51 行）。
- **归属与上位**：暗色主题调校，与概览面共用观感。
- **职责**：导出 `darkTheme` 基底、`PANEL_PALETTE`、`panelThemeOverrides`。**非职责**：不含组件样式。
- **内部/依赖**：仅 `naive-ui` 的 `darkTheme`。
- **IO/状态/错误**：纯常量，无 IO。
- **测试/规模**：语法门禁；51 行。

#### F-panel-ui-lib-format

- **路径/处置**：`packages/panel/ui/lib/format.js`；**现有**；**目标-保留**（45 行）。
- **归属与上位**：展示层格式化纯函数。
- **职责**：`fmtTime`/`fmtDateTime`/`fmtUsd`/`fmtDur`/`fmtList`；本地时区、金额四位小数、时长人话化。**非职责**：不做业务判断。
- **内部/依赖**：零依赖。
- **IO/状态/错误**：纯函数；空值返回占位符不抛错。
- **测试/规模**：无直测（属缺口）；45 行。

#### F-panel-ui-lib-feed

- **路径/处置**：`packages/panel/ui/lib/feed.js`；**现有**；**目标-保留**（38 行）。
- **归属与上位**：SSE 与 backlog 合流纯函数，钉死单 `test/ui-feed.test.ts`。
- **职责**：`mergeFeed` 去重、`(ts, id)` 降序、截 50、坏行免疫。**非职责**：不发请求。
- **内部/依赖**：零依赖。
- **IO/状态/错误**：纯函数；坏行丢弃。
- **测试/规模**：`ui-feed.test.ts` 覆盖；38 行。

#### F-panel-ui-charts-options

- **路径/处置**：`packages/panel/ui/charts/options.js`；**现有**；**目标-保留**（203 行）。
- **归属与上位**：ECharts option 纯构造器。
- **职责**：`costsTrendOption`、`budgetOption`、`eventDistributionOption`、`runCompositionOption`；LLM 成本岛与收割成本分列**不相加**。**非职责**：不碰 DOM、不碰实例。
- **内部/依赖**：零依赖；只返回 option 对象。
- **IO/状态/错误**：纯函数；空数据返回空 series 而非抛错。
- **测试/规模**：语法门禁；数值口径未直测（缺口）；203 行。

#### F-panel-ui-composables-use-snapshot

- **路径/处置**：`packages/panel/ui/composables/useSnapshot.js`；**现有**；**目标-保留并扩展**（68 行）。
- **归属与上位**：读面轮询，对应 80-§9.2 监控读面。
- **职责**：3 秒并行轮询 `/api/snapshot`、`/api/jobs`、`/api/breakers`、`/api/costs`、`/api/inbox`、`/api/judge` 六端点；单点失败置 error 不整体清空。**非职责**：不重试、不缓存到存储。
- **内部/依赖**：`vue` 的 `ref`/`onUnmounted`；`fetch`。
- **IO/状态**：定时器加响应状态；卸载清定时器。
- **错误与观测**：错误只标记端点，不弹窗、不打印响应体。
- **测试/规模**：无直测（缺口）；68 行。目标消费 `/api/health` 六态并把故障显示为 `gap`/`conflict`。

#### F-panel-ui-composables-use-ledger-stream

- **路径/处置**：`packages/panel/ui/composables/useLedgerStream.js`；**现有**；**目标-保留**（68 行）。
- **归属与上位**：SSE 状态机。
- **职责**：`EventSource('/api/events/stream')`，backlog 50 加 `FEED_LIMIT = 50` 合流；`unsupported` 时降级；卸载关闭连接。**非职责**：不解析业务语义。
- **内部/依赖**：`vue` 响应式；`EventSource`。
- **IO/状态**：连接状态 `open/connecting/unsupported`。
- **错误与观测**：断线由浏览器重连（服务端 `retry:5000`），本件只显示状态。
- **测试/规模**：`ui-feed.test.ts` 只覆盖合流函数；68 行。

#### F-panel-ui-composables-use-echart

- **路径/处置**：`packages/panel/ui/composables/useEchart.js`；**现有**；**目标-保留**（48 行）。
- **归属与上位**：ECharts 实例生命周期。
- **职责**：`init`（dark 主题、透明底）、option 变更 `setOption(..., notMerge)`、`ResizeObserver` 自适应、`dispose`。**非职责**：不构造 option。
- **内部/依赖**：`echarts`、`vue`。
- **IO/状态**：实例加 observer，卸载释放。
- **错误与观测**：容器未挂载时不 init（`ChartCard` 常挂容器的原因）。
- **测试/规模**：无直测；48 行。

#### F-panel-ui-components-stat-strip

- **路径/处置**：`packages/panel/ui/components/StatStrip.js`；**现有**；**目标-保留**（71 行）。
- **职责**：四联温度计：jobs 总数（含 due）、runs 在途/总数、workers 活跃、events 总数。**非职责**：不做趋势。
- **依赖/IO**：`naive-ui`；props 只读。
- **错误**：缺字段显示占位不抛错。
- **测试/规模**：语法门禁；71 行。

#### F-panel-ui-components-chart-card

- **路径/处置**：`packages/panel/ui/components/ChartCard.js`；**现有**；**目标-保留**（47 行）。
- **职责**：`NCard` 加 ECharts 容器；**容器 div 永远挂载**，空态用 `NEmpty` 覆盖，避免实例指向脱挂 DOM。**非职责**：不做 option。
- **依赖/IO**：`naive-ui`、`useEchart`。
- **错误**：无数据与故障都走覆盖层，不销毁容器。
- **测试/规模**：语法门禁；47 行。

#### F-panel-ui-components-jobs-card

- **路径/处置**：`packages/panel/ui/components/JobsCard.js`；**现有**；**目标-保留**（68 行）。
- **职责**：定时岗表：岗位（due 高亮）、公司、cron、下次应跑、状态；行密度 small 加最大高度。**非职责**：不提供触发按钮。
- **依赖/IO**：`/api/jobs` 形状。
- **测试/规模**：语法门禁；68 行。

#### F-panel-ui-components-runs-card

- **路径/处置**：`packages/panel/ui/components/RunsCard.js`；**现有**；**目标-保留**（75 行）。
- **职责**：`work_records` 近况，在途优先、`started_at` 降序；时长列在途算至今、已收口算全程。**非职责**：不做重派。
- **依赖/IO**：`/api/runs`。
- **测试/规模**：语法门禁；75 行。

#### F-panel-ui-components-workers-card

- **路径/处置**：`packages/panel/ui/components/WorkersCard.js`；**现有**；**目标-保留**（58 行）。
- **职责**：活跃 workers：工号、在途 runs、在途 sessions、executors、涉及单号、最早活动至今；随响应展示 `WORKERS_V0_NOTE`。**非职责**：不代表真实进程存活性。
- **依赖/IO**：`/api/workers`。
- **测试/规模**：语法门禁；58 行。

#### F-panel-ui-components-inbox-card

- **路径/处置**：`packages/panel/ui/components/InboxCard.js`；**现有**；**目标-保留**（100 行）。
- **职责**：收件箱表：总数、ready、待批、人数、最老等待、行；理由与等待时长分列。**非职责**：不提供派工按钮（监控面只观察）。
- **依赖/IO**：`/api/inbox`。
- **测试/规模**：语法门禁；100 行。

#### F-panel-ui-components-costs-card

- **路径/处置**：`packages/panel/ui/components/CostsCard.js`；**现有**；**目标-保留**（71 行）。
- **职责**：成本趋势卡，随响应展示 `COSTS_NOTE` 与 `COSTS_BUDGETS_BASIS_NOTE` 原文。**非职责**：不重算预算。
- **依赖/IO**：`/api/costs`、`charts/options.js`。
- **测试/规模**：语法门禁；71 行。

#### F-panel-ui-components-judge-card

- **路径/处置**：`packages/panel/ui/components/JudgeCard.js`；**现有**；**目标-保留**（126 行）。
- **职责**：判断调用表：站点、合计、回退理由、熔断开启数；展示 `JUDGE_SNAPSHOT_NOTE`。**非职责**：不改判断配置。
- **依赖/IO**：`/api/judge`。
- **测试/规模**：语法门禁；126 行。

#### F-panel-ui-components-breakers-card

- **路径/处置**：`packages/panel/ui/components/BreakersCard.js`；**现有**；**目标-保留**（55 行）。
- **职责**：断路告警时间线：单号、签名、trips、最近触发、连击/阈值/bug 单。**非职责**：不提供复位按钮。
- **依赖/IO**：`/api/breakers`。
- **测试/规模**：语法门禁；55 行。

#### F-panel-ui-components-events-feed-card

- **路径/处置**：`packages/panel/ui/components/EventsFeedCard.js`；**现有**；**目标-保留**（60 行）。
- **职责**：事件实时流，环形 50 条，`ts` 降序；状态点 open 绿/connecting 黄/unsupported 灰。**非职责**：不做全文检索。
- **依赖/IO**：`useLedgerStream`、`lib/feed.js`。
- **测试/规模**：合流逻辑由 `ui-feed.test.ts` 覆盖；60 行。

#### F-panel-ui-overview-main

- **路径/处置**：`packages/panel/ui/overview/main.js`；**现有**；**目标-保留**（16 行）。
- **职责**：概览面入口，与监控面同款启动法。**非职责**：不做路由。
- **依赖/IO**：`vue`、`naive-ui`、`./app.js`。
- **测试/规模**：`overview-ui.test.ts` 间接覆盖；16 行。

#### F-panel-ui-overview-app

- **路径/处置**：`packages/panel/ui/overview/app.js`；**现有**；**目标-保留**（91 行）。
- **职责**：单壳多页根组件，`NConfigProvider` 暗色加同套 overrides，按路径切页。**非职责**：不取数。
- **依赖/IO**：`components/*`、`useOverviewJson`、`router.js`。
- **测试/规模**：语法门禁；91 行。

#### F-panel-ui-overview-router

- **路径/处置**：`packages/panel/ui/overview/router.js`；**现有**；**目标-保留**（59 行）。
- **职责**：`COMPANY_TABS` 六项、`parseOverviewPath` 纯函数、`ROUTE_EVENT = 'overview-route'`、`go`/`tabPath`。浏览器内复刻 `SLUG_RE` 只做体验，服务端闸兜底。**非职责**：不做权限判断。
- **依赖/IO**：`history.pushState`、`window` 事件。
- **测试/规模**：`overview-ui.test.ts` 直测纯函数；59 行。

#### F-panel-ui-overview-charts-options

- **路径/处置**：`packages/panel/ui/overview/charts/options.js`；**现有**；**目标-保留**（123 行）。
- **职责**：`progressStatesOption`、`financeDailyOption`、`budgetsOption`。**非职责**：不碰实例。
- **依赖/IO**：零依赖，纯 option。
- **测试/规模**：语法门禁；123 行。

#### F-panel-ui-overview-composables-use-overview-json

- **路径/处置**：`packages/panel/ui/overview/composables/useOverviewJson.js`；**现有**；**目标-保留并扩展**（53 行）。
- **职责**：`/api/overview/*` 3 秒轮询，`seq` 防过期响应，失败保旧图。**非职责**：不重试、不写缓存。
- **依赖/IO**：`vue`、`fetch`。
- **状态**：`seq` 递增比较，旧响应丢弃。
- **错误与观测**：失败保留上一份数据并置 error，页面显示快照时间与 `lastError`。
- **测试/规模**：无直测（缺口）；53 行。目标增加六态字段透传。

#### F-panel-ui-overview-components-companies-card

- **路径/处置**：`packages/panel/ui/overview/components/CompaniesCard.js`；**现有**；**目标-保留**（70 行）。
- **职责**：根路径公司清单，3 秒轮询，新挂载公司下一周期可见。**非职责**：不做挂载操作。
- **依赖/IO**：`/api/overview/companies`。
- **测试/规模**：语法门禁；70 行。

#### F-panel-ui-overview-components-company-card

- **路径/处置**：`packages/panel/ui/overview/components/CompanyCard.js`；**现有**；**目标-保留**（47 行）。
- **职责**：公司概览卡，`mission = null` 显示“未提供”。**非职责**：不补造字段。
- **依赖/IO**：`/api/overview/<slug>/snapshot`、`SnapshotBadge`。
- **测试/规模**：语法门禁；47 行。

#### F-panel-ui-overview-components-org-card

- **路径/处置**：`packages/panel/ui/overview/components/OrgCard.js`；**现有**；**目标-保留**（73 行）。
- **职责**：组织树 `NTree`，悬空父与成环按 `promoted`/`cyclic` 诚实标记。**非职责**：不修补组织数据。
- **依赖/IO**：`/api/overview/<slug>/org`。
- **测试/规模**：语法门禁；73 行。

#### F-panel-ui-overview-components-people-card

- **路径/处置**：`packages/panel/ui/overview/components/PeopleCard.js`；**现有**；**目标-保留**（63 行）。
- **职责**：花名册表加档案链接，仅 `hasBody` 为真时出“看档案”。**非职责**：不读文件系统。
- **依赖/IO**：`/api/overview/<slug>/people`。
- **测试/规模**：语法门禁；63 行。

#### F-panel-ui-overview-components-person-view

- **路径/处置**：`packages/panel/ui/overview/components/PersonView.js`；**现有**；**目标-保留**（43 行）。
- **职责**：人事档案页，Markdown 原文进 `pre` 块；`body = null` 显示“在册但正文缺失”。**非职责**：不渲染富文本、不做编辑。
- **依赖/IO**：`/api/overview/<slug>/people/<工号>`。
- **测试/规模**：语法门禁；43 行。

#### F-panel-ui-overview-components-progress-card

- **路径/处置**：`packages/panel/ui/overview/components/ProgressCard.js`；**现有**；**目标-保留**（50 行）。
- **职责**：单据进度按状态聚合；`progress = null` 显示无台账降级，不臆造空聚合。**非职责**：不改单据。
- **依赖/IO**：`/api/overview/<slug>/progress`、`progressStatesOption`。
- **测试/规模**：语法门禁；50 行。

#### F-panel-ui-overview-components-finance-card

- **路径/处置**：`packages/panel/ui/overview/components/FinanceCard.js`；**现有**；**目标-保留**（52 行）。
- **职责**：财务 tab，三口径分列加 LLM 成本按日；`finance = null` 如实说明。**非职责**：不合并口径。
- **依赖/IO**：`/api/overview/<slug>/finance`、`financeDailyOption`/`budgetsOption`。
- **测试/规模**：语法门禁；52 行。

#### F-panel-ui-overview-components-reports-card

- **路径/处置**：`packages/panel/ui/overview/components/ReportsCard.js`；**现有**；**目标-保留**（161 行）。
- **职责**：报表 tab v1：清单、新鲜度灯、`missing`/`unanchored` 标记、公司级汇总；展示 `REPORTS_BODY_NOTE`/`REPORTS_V2_NOTE`。**非职责**：不展示正文（未获批）。
- **依赖/IO**：`/api/overview/<slug>/reports`。
- **测试/规模**：语法门禁；161 行，是 `ui` 最大件，仍远低于阈值。

#### F-panel-ui-overview-components-snapshot-badge

- **路径/处置**：`packages/panel/ui/overview/components/SnapshotBadge.js`；**现有**；**目标-保留**（41 行）。
- **职责**：双时间戳标注：`asOf` 为本次取数时刻，`snapshotMeta` 为目录快照；`watching=false` 与 `lastError` 显式可见。**非职责**：不决定是否刷新。
- **依赖/IO**：props 透传。
- **测试/规模**：语法门禁；41 行。目标作为六态与 `REC-OBS-02` 的显示落点。

### 3.6 脚本与配置五件

#### F-panel-vendor-pull

- **路径/处置**：`packages/panel/scripts/vendor-pull.mjs`；**现有**；**目标-保留**（55 行）。
- **归属与上位**：vendor 进仓的拉取与校验脚本；上位 79 工程口径（不引构建链）、80-§5.8。
- **职责**：读 `vendor/vendor.lock.json`，按精确版本 URL 下载，校验 `bytes` 与 `sha256`，不符时非零退出且**不覆盖**旧文件。**非职责**：不参与运行时、不做版本选择。
- **内部结构**：零第三方依赖，用 `node:https`/`node:crypto`/`node:fs`；退出码 0 成功、1 校验失败、2 参数或环境错误。
- **IO 与注入**：出站 HTTPS、写 `vendor/*`。
- **状态与并发**：先写临时文件再改名，失败保留旧件；无锁，要求单实例运行。
- **错误与观测**：打印期望与实际哈希；不打印令牌（无令牌）。
- **测试与证据**：无自动测试，由 `shell-static.test.ts` 的“锁文件与产物一致”间接兜底；**未证**：上游 URL 变更或网络半途失败的行为未测。
- **规模与验收**：55 行。升级流程四步写在 `vendor/README.md`。

#### F-panel-package-json

- **路径/处置**：`packages/panel/package.json`；**现有**；**目标-保留并修正**。
- **归属与上位**：包清单；上位 79 的 workspace 与依赖分类。
- **职责**：`private: true`、`type: module`、`main: src/index.ts`、五条 `exports`（`.`、`./overview`、`./external`、`./inbox`、`./judge`）、`typecheck` 与 `test` 脚本、三条依赖。
- **现状与问题（已核实）**：`@studio-next/company` 在 `devDependencies`，但 `src/overview/reports.ts` 运行时 import `parseJobOps`；这是分类错误，不是打包技巧。
- **目标**：`@studio-next/company` 移入 `dependencies`；M5 删除 `"./external"` 导出；其余不动。不得新增依赖或改版本。
- **验证**：`bun run typecheck` 与 `bun run test` 覆盖；包级 `bun run --filter @studio-next/panel typecheck` 存在但与根门禁重复，不冲突。

#### F-panel-tsconfig

- **路径/处置**：`packages/panel/tsconfig.json`；**现有**；**目标-保留**。
- **内容**：extends `../../tsconfig.base.json`，`include: ["src/**/*.ts"]`，**不含 test**。
- **边界**：根 `tsconfig.json` 覆盖 `packages/*/src/**`，故 `test/` 不进类型门禁；这与全仓约定一致，不是遗漏，但意味着测试文件的类型错误只能在运行期暴露。
- **验证**：根 `tsc --noEmit` 覆盖 `src`；不得为让测试过门禁而把 `test` 加入 include（会改变全仓门禁语义）。

#### F-panel-vendor-lock

- **路径/处置**：`packages/panel/vendor/vendor.lock.json`；**现有**；**目标-保留**。
- **内容（已核实）**：vue 3.5.44 `vue.esm-browser.prod.js` 175436 字节，sha256 前缀 `37d771e9`；naive-ui 2.45.3 `naive-ui.prod.mjs` 2722579 字节，`fae25dc0`；echarts 6.1.0 `echarts.esm.min.js` 1121654 字节，`28515f26`；许可 MIT/MIT/Apache-2.0。
- **职责**：作为 vendor 产物的唯一版本与完整性事实源。**非职责**：不被运行时代码读取。
- **状态**：静态文件；与 `PANEL_IMPORTMAP` 的 `?v=` 和 `shell-static.test.ts` 三方一致。
- **验证**：`shell-static.test.ts` 校验存在与一致性；升级须同提交改三处。

#### F-panel-vendor-readme

- **路径/处置**：`packages/panel/vendor/README.md`；**现有**；**目标-保留**。
- **内容**：记录升级四步（改 lock、跑 `scripts/vendor-pull.mjs`、同步 `PANEL_IMPORTMAP` 的 `?v=`、跑回归）与三件来源。
- **边界**：文档性约束，不参与运行；不得写入本机路径或真实凭证。
- **验证**：人工阅读，无自动门禁。

---

## 四、目标新增件

本节五件均为**目标-新增**，尚未创建。每件都写明上位锚；锚不在 76/77/78/80 的，一律登记回写（§六），不在本卷造公共概念。

### F-panel-monitor-projection-state

- **路径/处置**：`packages/panel/src/monitor/projection-state.ts`；**目标-新增**。
- **上位锚**：77-§9.1（`REC-OBS-01` 的九个必填字段）、77-§9.2 六态、77-§9.4（`REC-OBS-02`）、80-§4.4（`ObservationState` 的类型名与英文字面量，80 原文：“`observed|derived|unknown|stale|conflict|gap`，即已观察/已推导/未知/陈旧/冲突或受损/缺口或中断”）、80-§9.6（六态呈现表与每态必须附带的证据）、`TS-PORT-OBS-01`（类型家 `F-contract-port-effects`，`src/ports/effects.ts`）。记录形状归 `contract` 的 `F-contract-rec-payload-lifecycle`（`src/records/payloads/lifecycle.ts`，见 `81-files/01-contract.md`），本件只做**运行时投影元数据**，不重定义记录 schema。**回写项**：本件的文件家（panel 叶子还是 `contract`）80 未定；若定为 `contract`，整件迁出且本卷只留迁移说明。
- **职责**：给六态一个可判定、可穷举的类型；给每态配一份 80-§9.6 要求的证据；给投影快照一份与 `REC-OBS-01` 字段同构的运行时元数据形状。**非职责**：不计算任何业务投影、不做健康判定（归 `monitor/health.ts`）、不定义 HTTP 形状、不定义记录（归 contract）。
- **内部结构**：
  - `ObservationState` 联合类型，六字面量取 80-§9.6 原文；`OBSERVATION_STATES` 只读元组供穷举校验。
  - `ObservationEvidence` 判别联合，逐态对应 80-§9.6 的“必须附带的证据”列：
    - `observed`：`{ source: string; observedAt: number }`（来源 + 观察时间）；
    - `derived`：`{ ruleVersion: string; inputs: readonly string[] }`（规则版本 + 输入引用）；
    - `unknown`：`{ reason: string }`（未知的原因：来源不可达 / 未读）；
    - `stale`：`{ lastTrustedAt: number; freshnessWindowMs: number }`（最后可信时间 + 新鲜度窗）；
    - `conflict`：`{ a: { value: unknown; source: string }; b: { value: unknown; source: string } }`（并列双方原值 + 各自来源）；
    - `gap`：`{ lastTrustedCursor: string | null; missing: string }`（最后可信游标 + 缺什么）。
  - `Observation = { state: ObservationState; evidence: ObservationEvidence; scope?: string }`；`scope` 在由 `partial` 翻来的状态下必填（80-§9.6 末段要求“附范围”）。
  - `partialToObservation(input: { hasConflict: boolean; scope: string }): Observation`：把失败/结算分类 `partial` 翻成 `conflict`（有冲突）或 `gap`（无冲突但部分成功）并带上范围。`partial` **不是**第六态，不得出现在 `ObservationState` 里，也不得作为状态字面量透出（80-§5.7 与 §9.6 都明确两套词表不得互相代入）。
  - `SnapshotMeta`：`REC-OBS-01` 的运行时子集，字段为 `viewIdentity`、`authoritativeSource`、`sourceCursor`、`generatedAt`、`dataValidWindow`、`projectionRuleVersion`、`knowledgeScope`、`completeness`、`stateLegend`（九项齐全，缺一不可；字段名用 TS 侧 camelCase，语义与 77-§9.1 一一对应）。其中 `stateLegend: Record<ObservationState, string>` 必须六键齐全（缺键即判未实现），`completeness: Completeness`，`sourceCursor` 可为 `null`（无游标时显式 null，不省略字段）。`ObservationEvidence.derived.ruleVersion` 与 `SnapshotMeta.projectionRuleVersion` 是同一值的两种粒度：前者逐次判定用，后者落快照元数据，二者必须是同一个字符串来源，不得各算一份。
  - `Completeness = '完整' | '部分' | '有缺口' | '无法判定'`：直接取 77-§9.1 原四值中文，**不造英文映射**，避免与失败类 `partial` 撞名；若 80 要求英文映射，按 lower_snake_case 补并回写。
  - `isObservationState(value: unknown): value is ObservationState`；`withSnapshotMeta(meta: SnapshotMeta): Readonly<SnapshotMeta>` 浅冻结包装，防止下游就地改写。
- **导出与依赖**：上列符号；零依赖（不 import contract、不 import store），保证 `monitor/*`、`inbox.ts`、`overview/api.ts` 都能引而不成环。**不得**在本件复制 `REC-OBS-01`/`REC-OBS-02` 的记录字段全集（那是 contract 的职责）。
- **IO 与注入**：无。`generatedAt`、`sourceCursor` 由调用方给，本件不取时钟、不生成 ID。
- **状态与并发**：纯函数与不可变数据。
- **错误与观测**：非法状态由 `isObservationState` 返回 false，不抛错；不做日志；无秘密面。`SnapshotMeta.knowledgeScope` 是“谁能读”的声明位，本件只承载字符串，不做鉴权判定。
- **测试与证据**：`test/observation-state.test.ts`（目标新增）穷举六态与六种证据、`partial` 两种翻法（带范围）、非法值拒绝、`SnapshotMeta` 九字段齐全与冻结不可写。不证明任何真实投影正确性。
- **规模与验收**：预算 <160 行。验收：`monitor/*`、`inbox.ts`、`overview/api.ts` 三处共用同一份定义，不得各自复制字面量（复制即视为新增第二套语义）；任何 payload 的六态都必须带证据，缺证据视为未实现。

### F-panel-monitor-dashboard

- **路径/处置**：`packages/panel/src/monitor/dashboard.ts`；**目标-新增**（自 `src/views.ts` 拆出）。
- **上位锚**：77-§9.1 观察面、77-§9.3 观察十一面、80-§9.2、`TS-PORT-OBS-01`（本件是其“仪表盘投影”实现位）。
- **职责**：把台账投影成 `DashboardSnapshot`（jobs/runs/workers/events 分布），并给单条记录加展示用的 `JobView`。**非职责**：不做断路、不做成本、不做健康、不做 HTML。
- **内部结构（逐字迁移，不改语义）**：`SnapshotJobs`、`SnapshotRuns`、`ActiveWorker`、`SnapshotWorkers`、`SnapshotEvents`、`DashboardSnapshot`、`SnapshotOptions`、`JobView` 八个类型；`DEFAULT_PAGE_SIZE = 20`、`WORKERS_V0_NOTE`；`buildDashboardSnapshot`、`recentRunSlice`、`aggregateActiveWorkers`、`eventDistribution`、`jobViews` 五个函数。原址与符号清单见 `F-panel-views`，迁移时保持函数体不变。
- **导出与依赖**：上列全部；依赖 `@studio-next/store` 的记录类型、`@studio-next/contract` 的事件名判定、`./projection-state.ts`（元数据，目标）。不得 import `hono`、`node:fs`。
- **IO 与注入**：入参 `ReadOnlyLedger` 与 `{ now?, recentRuns? }`；时间可注入；无其它 IO。读投影表行的能力受缺口 G5 阻塞（`RecordQuery` 只回记录信封）。
- **状态与并发**：纯函数；多次读台账非事务一致，允许相邻读数漂移，这是既定口径。
- **错误与观测**：坏记录跳过；`WORKERS_V0_NOTE` 随响应返回，明示 workers 是台账聚合而非进程事实。不打印记录内容。
- **测试与证据**：`test/panel.test.ts`（端面形状）、`test/alerts-costs.test.ts`（事件分布）在拆分后仍须全绿，作为“行为零变更”的证据。不证明真实台账规模下的查询开销。
- **规模与验收**：预算 <260 行（原 662 行中约 190 行属本件）。验收：`views.ts` facade 的再导出集合与原导出逐名相同；`apps/daemon` 侧无人直接引 `monitor/*`，只能经包根或既有子路径。

### F-panel-monitor-breakers

- **路径/处置**：`packages/panel/src/monitor/breakers.ts`；**目标-新增**（自 `src/views.ts` 拆出）。
- **上位锚**：77-§9.1、80-§9.2；断路告警的事件 note 口径沿用现有实现，本件不新增记录 ID，也不引入新的告警分类。
- **职责**：解析 `CIRCUIT_BREAK` note，按签名聚合 trips，产出 `BreakerSnapshot`。**非职责**：不重放判断熔断（归 `judge.ts`，两者口径不同）、不复位断路。
- **内部结构**：`isBreakerEvent`、`BREAKER_NOTE_PATTERN`、`BreakerNoteFields`、`parseBreakerNote`、`BreakerStatus`、`aggregateBreakers`、`BreakerSnapshot`、`BREAKERS_V0_NOTE`、`DEFAULT_BREAKER_DAYS = 7`、`MAX_BREAKER_DAYS = 90`、`buildBreakerSnapshot`；`DAY_MS`/`dayKeyOf` 在 M1 后从 `@studio-next/contract` 取，**不得**再从 `views.ts` 取。
- **导出与依赖**：上列全部；依赖 `@studio-next/store`、`@studio-next/contract`、`./projection-state.ts`（目标）。
- **IO 与注入**：`ReadOnlyLedger` 加 `{ now?, days? }`；无其它 IO。
- **状态与并发**：纯函数；`days` 超出 `[1, 90]` 时落回缺省或上限（沿用现实现），不抛错。
- **错误与观测**：note 不匹配返回 `null` 且该行不计入；`BREAKERS_V0_NOTE` 随响应返回，说明聚合口径为 v0。
- **测试与证据**：`test/alerts-costs.test.ts` 覆盖解析与聚合；拆分后该件不得修改，作为零变更证据。
- **规模与验收**：预算 <140 行。验收同上，另加一条：`judge.ts` 与 `breakers.ts` 的阈值常量不得互相 import。

### F-panel-monitor-costs

- **路径/处置**：`packages/panel/src/monitor/costs.ts`；**目标-新增**（自 `src/views.ts` 拆出）。
- **上位锚**：77-§9.1、80-§9.2；成本口径沿用既有 note（`COSTS_NOTE`/`COSTS_BUDGETS_BASIS_NOTE`），不新增预算规则。
- **职责**：按 UTC 日聚合 `LLM` 事件成本，给出每日点与预算对照。**非职责**：不决定预算、不做结算、不与收割成本相加（LLM 岛与收割分列）。
- **内部结构**：`DailyCostPoint`、`CostsSnapshot`、`COSTS_NOTE`、`COSTS_BUDGETS_BASIS_NOTE`、`DEFAULT_COSTS_DAYS = 7`、`MAX_COSTS_DAYS = 90`、`buildCostsSnapshot`。
- **导出与依赖**：上列全部；依赖 `@studio-next/store`、`@studio-next/contract`（`dayKeyOf`，M1 后）、`./projection-state.ts`（目标）。
- **金额口径**：现状 `DailyCostPoint` 的金额是 `number` 浮点累加；目标公共形状为 `{ amount: DecimalString; currency }`，边界转换不经 float、不四舍五入。源字段 `usage_daily` 的金额承载与标度 80 未定（缺口 G9），未解前本件**不宣称合规**，也不得自造换算。
- **IO 与注入**：`ReadOnlyLedger` 加 `{ now?, days? }`。
- **状态与并发**：纯函数；日边界按 UTC，与概览财务页同口径（`overview/views.ts` 现注释亦如此）；公司本地日须显式传时区，不读系统时区（80-D17）。
- **错误与观测**：缺成本的事件按 0 计但不补造日期；note 原文随响应返回，避免“数字被当事实”。
- **测试与证据**：`test/alerts-costs.test.ts` 覆盖按日聚合与预算对照。
- **规模与验收**：预算 <150 行。验收：同一台账输入下，拆分前后 `buildCostsSnapshot` 输出逐字段相等。

### F-panel-monitor-health

- **路径/处置**：`packages/panel/src/monitor/health.ts`；**目标-新增**（取代 `createPanelApp` 里 `/api/health` 现值 `{ ok: true, schema_version }` 的布尔形态）。
- **上位锚**：80-§9.2（监控职责：健康是六态而非布尔，`unknown`/`gap`/`stale` 必须显示异常色）、80-§9.6（六态呈现与每态证据、“未知不显示为 0/空/绿”）、77-§9.2（六态）、77-§9.3 第 10 面“监控自身”、77-§9.4（`REC-OBS-02` 的 `display_effect` 必须为 `未知` 或 `受损`）、80-§8.2（版本不匹配的错误分类）。**回写项**：80 未给健康 payload 的 TS 名与字段表，本卷只给最小实现约束，正式形状待 80 定稿；不得据此宣布 `/api/health` 契约已定。
- **职责**：把“每个读面当前处于六态中的哪一个”算成一个可枚举结构，每态附 80-§9.6 要求的证据；版本不匹配与断源分别落 `stale` 与 `gap`。**非职责**：不做重试、不触发派工、不关单（80-§9.2 与 77-§9.3 明令监控面不得提供这些按钮）、不写台账、不写 `REC-OBS-02`（写者是 daemon）、不缓存上一份健康快照。
- **内部结构**：
  - `MonitoredSurface` 联合：`'ledger' | 'jobs' | 'runs' | 'workers' | 'events' | 'breakers' | 'costs' | 'inbox' | 'judge'`，与 `:8791` 的九个读端点一一对应，不新增面。
  - `SurfaceHealth = { observation: Observation; expectedVersion: number; actualVersion: number; lastTrusted?: { cursor?: string; at: number } }`，`Observation` 来自 `./projection-state.ts`（六态 + 证据 + 可选范围）；`lastTrusted` 对齐 77-§9.4 的 `last_trusted`。
  - `HealthSnapshot = { schemaVersion: number; expectedSchemaVersion: number; surfaces: Record<MonitoredSurface, SurfaceHealth>; generatedAt: number; note: string }`；**不含** `ok` 布尔，也不保留 `{ok:true}` 兼容分支（旧字段与新结构不得并存）。
  - `buildHealthSnapshot(input: { ledger: ReadOnlyLedger; expectedSchemaVersion: number; now?: number }): HealthSnapshot`。状态判定（默认 `derived`；panel 是投影的投影，**`observed` 不可达**，除非未来 daemon 注入来源游标与权威端点）：
    - schema 版本不一致：`conflict`（并列期望值与实际值），与启动期 `openLedgerReadonly` 的 `Err` 互补；
    - 由规则聚合（成本按日、判断重放、队列排序等一切 panel 计算）：`derived`，证据带 `projectionRuleVersion` 与输入引用；
    - 面未挂载或未读到：`unknown`，证据带原因（`ledger-not-mounted` / `no-registration` / `no-events-in-window`），**不得**显示 0 或空；
    - 投影重建中或读取失败：`gap`，证据带最后可信游标与缺口说明；受影响视图**整段**降级，不得只降一行而其余照常显示（77-§9.2 缺口行）；
    - `stale`：无 freshness policy 来源（缺口 G10），v0 **不可达**，不得伪造“最后可信时间 + 新鲜度窗”两个数；
    - 来源之间互相矛盾（快照与台账对同一事实给出不同值）：`conflict`，证据并列双方原值 + 各自来源。
  - `OBSERVATION_HEALTH_NOTE`：随响应返回的口径说明（六态不是“健康度评分”，`derived` 也不等于内容为真）。
- **导出与依赖**：上列符号；依赖 `@studio-next/store`（只读视图类型）、`@studio-next/contract`、`./projection-state.ts`。不得 import `hono`，保持可在测试里纯调。
- **IO 与注入**：读 `ReadOnlyLedger`（`schemaVersion` 属性 + `query`/`get`）；`expectedSchemaVersion` 由 wiring 注入（来源是 daemon 的迁移期望，不是 panel 自查；常量来源见缺口 G7）；`now` 可注入。
- **状态与并发**：无缓存，每次请求现算；代价是每请求一次 `PRAGMA user_version` 类读，属可接受读放大。不缓存是刻意的：77-§9.4 明令不得沿用最后一张健康快照、不得用“没有告警”暗示健康。
- **错误与观测**：读异常一律 `gap`，绝不显示为正常；证据里的 `reason` 只放分类短语（如 `ledger-unavailable`），不放原始异常消息，避免路径外泄（对齐 80-§5.7/§5.8）。秘密边界：不输出台账路径、不输出连接参数、不输出 token。
- **测试与证据**：`test/monitor-health.test.ts`（目标新增）覆盖六态各一例且各有证据字段、版本不匹配为 `conflict` 且带期望/实际、读失败为 `gap` 且带最后可信游标、断源不得出现 `observed`、`partial` 不出现在 `surfaces[*].observation.state`。不证明真实故障注入（kill 点归 82）。
- **规模与验收**：预算 <220 行。验收：`/api/health` 返回结构替换后，`panel.test.ts` 的旧 `ok: true` 断言必须同提交改写；九面必须全部出现，缺面视为未实现；无证据字段的状态视为未实现。

### 目标新增测试三件

#### F-panel-test-monitor-health

- **路径/处置**：`packages/panel/test/monitor-health.test.ts`；**目标-新增**。
- **覆盖**：六态穷举、版本落后 `conflict`、读失败 `gap`、`partial` 不出现、`/api/health` 端面结构与 `OBSERVATION_HEALTH_NOTE` 存在。
- **非职责**：不覆盖真实故障注入、不覆盖 UI 显示（`ui` 侧只透传字段）。
- **夹具/断言**：临时库句柄加可切换的失败桩；断言状态集合与期望/实际版本字段。
- **缺口**：`REC-OBS-02` 的写者侧（daemon 写监控故障记录）不在本件范围，归 82。

#### F-panel-test-readonly-ledger

- **路径/处置**：`packages/panel/test/readonly-ledger.test.ts`；**目标-新增**。
- **覆盖**：80-D12 只读负向：启动前记录 `PRAGMA user_version` 与表集合，起 `servePanel`/`serveOverview` 后断言两者不变；对不存在的库断言 `unavailable`（`STALL`/`db-missing`）且不建库；版本落后断言 `rejected_version`（`EVOLVE_REJECT`/`schema-behind`），版本超前断言 `schema-ahead`，两者都带期望与实际；仅路径/配置缺失或畸形才断言 `CONFIG_INVALID`；另断言只读句柄上 `PRAGMA query_only = 1`。**读口负向**：`query` 坏游标/坏形状/未开放组合分别断言 `conflict`/`EXTERNAL_REJECT`/`ledger-cursor-invalid`、`rejected_precondition`/`CONFIG_INVALID`/`ledger-query-invalid`、`unsupported`/`EVOLVE_REJECT`/`ledger-query-unsupported`（未开放组合**不得**判 `CONFIG_INVALID`）；任何断言都不得接受 `STATE_CONFLICT`（该 category 不存在）；`get` 运行期读失败断言 `unavailable`/`STALL`/`ledger-read-failed` 且**不是** `Ok(undefined)`；端面在 `Err` 时显示 `unknown` 或 `gap`，不出现空数组、0 或绿色健康。
- **非职责**：不覆盖 daemon 侧写入与迁移。
- **夹具/断言**：临时目录造库与缺库两态；断言异常 `failure` 与 `subcause` 两类，且断言 `category` 只有 `STALL`/`EVOLVE_REJECT` 两种。
- **缺口**：依赖 `openLedgerReadonly`（80-§8.2 签名，`ReadOnlyLedgerOpen → Result<ReadOnlyLedger, ClassifiedError>`；仓内尚未实现，实现归 `81-files/03-store.md` 的 `F-store-ledger-open`，该处现已按 80 原文拼写）；本件在其落地前无法通过，属计划内红。

#### F-panel-test-observation-state

- **路径/处置**：`packages/panel/test/observation-state.test.ts`；**目标-新增**。
- **覆盖**：六态字面量、`isObservationState` 拒绝非六态值、`partialToObservation` 两分支（`partial` 翻 `gap`、`conflict` 翻转 `conflict` 并附范围）、`ObservationEvidence` 逐态必备字段（observed 带来源与观察时间、derived 带规则版本与输入引用、unknown 带原因、stale 带最后可信时间与新鲜度窗、conflict 带并列双方原值及各自来源、gap 带最后可信游标与缺失项）、`SnapshotMeta` 九字段齐全且 camelCase 与 `REC-OBS-01` 一一对应、`Completeness` 只接受 77 中文四值。
- **非职责**：不覆盖任何业务投影。
- **缺口**：若 80 把该类型归入 `contract`，本件随迁，路径与 ID 由 `81-files/01-contract.md` 重新登记。

---

## 五、拆分、迁移与退役

顺序铁律：先解依赖（`dayKeyOf` 到 `contract`），再拆文件（`views.ts`），再换装配（`api` 接管 `:8788`），最后删旧面。任一步跨级即视为废件。

### 五.1 `src/views.ts`（662 行）拆分

**前置**：M1 第一步把 `DAY_MS`、`dayStartOf`、`dayKeyOf` 下沉 `@studio-next/contract`，`views.ts` 改为再导出。理由是 `src/judge.ts` 与 `src/overview/views.ts` 反向依赖这三个符号；若先把它们搬进 `monitor/*`，会形成 `judge/overview → monitor` 的新边，虽同包不违宪，但把“时间口径”藏进监控子目录，是错误的归属。

**目标文件与符号归属**：

| 符号 | 去向 |
|---|---|
| `SnapshotJobs` `SnapshotRuns` `ActiveWorker` `SnapshotWorkers` `SnapshotEvents` `DashboardSnapshot` `SnapshotOptions` `JobView` | `src/monitor/dashboard.ts` |
| `DEFAULT_PAGE_SIZE` `WORKERS_V0_NOTE` `buildDashboardSnapshot` `recentRunSlice` `aggregateActiveWorkers` `eventDistribution` `jobViews` | `src/monitor/dashboard.ts` |
| `isBreakerEvent` `BREAKER_NOTE_PATTERN` `BreakerNoteFields` `parseBreakerNote` `BreakerStatus` `aggregateBreakers` `BreakerSnapshot` `BREAKERS_V0_NOTE` `DEFAULT_BREAKER_DAYS` `MAX_BREAKER_DAYS` `buildBreakerSnapshot` | `src/monitor/breakers.ts` |
| `DailyCostPoint` `CostsSnapshot` `COSTS_NOTE` `DEFAULT_COSTS_DAYS` `MAX_COSTS_DAYS` `COSTS_BUDGETS_BASIS_NOTE` `buildCostsSnapshot` | `src/monitor/costs.ts` |
| `DAY_MS` `dayStartOf` `dayKeyOf` | M1 后由 `@studio-next/contract` 定义，`views.ts` 只再导出 |
| `renderDashboardPage` 与私有 `renderJobs`/`renderSnapshot`/`renderBreakers`/`renderCosts`/`refresh`/`prependEvent` | 留在 `src/views.ts` |

**保留 facade 的形态**：`src/views.ts` 目标只含类型再导出、五个 `monitor/*` 的 `export ... from`、三个时间符号的 contract 再导出，以及 `renderDashboardPage()` 与它的私有渲染约 183 行。预算 <350 行。**不**另建 `legacy-page.ts`，避免在根目录多一个散件（81-§三.2 的“不新增域平面散文件”）。

**迁移顺序**：

1. M1a：`contract` 增加时间口径（文件与 ID 归 `81-files/01-contract.md`）；panel 内两个消费点改 import。
2. S1：新建 `monitor/projection-state.ts`，无消费方，先落测试。
3. S2：逐个搬 `monitor/dashboard.ts`、`breakers.ts`、`costs.ts`，函数体逐字复制，`views.ts` 立即改为再导出，保持导出名不变。
4. S3：`server.ts` 与 `src/index.ts` 改为从 `monitor/*` 引，`views.ts` 的再导出保留一个发布周期。
5. S3b（与 S2 同批，类型面收口）：三个 `build*` 与 `buildInboxSnapshot`/`buildJudgeSnapshot` 的入参从 `Ledger` 收窄为 `ReadOnlyLedger`，`ledger.version()` 调用点改 `ledger.schemaVersion`（80-§8.2）。`ReadOnlyLedger` 是 `Ledger` 的结构子集，现有测试传 `Ledger` 仍可编译，但生产注入点不得再拿到写方法。此步不解决投影表行读取（缺口 G5），读面仍只能走 `query`/`get`。
6. S4：`test/panel.test.ts`、`test/alerts-costs.test.ts` 不改，作为行为零变更的证据；全绿后从 `lineBaseline` 除名 `src/views.ts`（它的实现已 <600）。
7. S5：确认无外部直接引 `monitor/*`（daemon 侧只经包根或 `./inbox`、`./judge` 子路径）后，删除 facade 的冗余再导出。

**回退**：任一 S 步失败，只回退该步；`views.ts` 的导出名始终是兼容面，故回退不需要改调用方。

### 五.2 `src/overview/views.ts`（629 行）拆分

**前置**：`buildOrgTree`/`buildProgressSnapshot`/`buildFinanceSnapshot` 要迁 `company`，而它们现依赖 `./views.ts` 的 `dayKeyOf`。若先迁，`company` 会反向 import `panel`，违反允许边表（无 `company→panel`）。故 M1 必须先行。

**去向**：

| 符号 | 去向 |
|---|---|
| `OrgTreeNode` `OrgTree` `buildOrgTree` | `packages/company` 的 `F-company-projections`（文件契约归 `81-files/04-company.md`，本卷只写迁出去向） |
| `PROGRESS_NOTE` `PROGRESS_MAPPING_NOTE` `ProgressSnapshot` `buildProgressSnapshot` | 同上 |
| `FINANCE_NOTE` `FinanceBudgets` `FinanceLlmDay` `MonthlyReportViewRow` `parseMonthlyHeadline` `FinanceSnapshot` `buildFinanceSnapshot` | 同上 |
| `escapeHtml` `fmtUsd` `escapePath` `page` `navTabs` `renderNotFoundPage` `renderOrgTree` | 留 `panel` |
| `renderCompanyListPage` `renderCompanyPage` `renderOrgPage` `renderPeoplePage` `renderPersonPage` `renderProgressPage` `renderFinancePage` | 留 `panel`，仅服务 `/legacy` |

**过渡期**：`overview/views.ts` 兼 facade，从 `company` 再导出 builder 与类型，旧 SSR 就地保留；`overview/api.ts`、`overview/server.ts` 改 import 后，`overview/index.ts` 的导出名不变。

**终态**：`/legacy` 兼容面在 82 波次完成后删除（删前须宣告，见 80-§2.1 与 81-§3.4），`overview/views.ts` 与之同批退役；`overview/index.ts` 不再导出 SSR 渲染器。届时本文件从 `lineBaseline` 除名，不是因为阈值变了，而是因为文件不存在了。

**预算**：过渡期约 420 行，低于 600；终态 0 行。

### 五.3 `src/external/` 三件：M1 至 M5

**调用方清单（已核实）**：`apps/daemon/src/cli/external.ts`（对 `@studio-next/panel/external` 的 import、调用与 `--lan` 旗标）；`packages/panel/package.json` 的 `exports["./external"]`；`test/external.test.ts` 与 `test/external-serve.test.ts`。全仓 grep 未发现其它生产者引用。

迁移五步照 80-§9.4 与 `81-files/14-api.md` §7.1，顺序写死：

| 步 | 内容 | 完成判据 |
|---|---|---|
| M1 | **下沉**：`dayKeyOf`/`DAY_MS` 到 `contract`（`panel` 保留 re-export），`buildOrgTree`/`buildProgressSnapshot`/`buildFinanceSnapshot` 到 `company` 的 `F-company-projections`；`listenHono` 一族在 `api` 落**同源副本**（`F-api-http-listen`，`packages/api/src/http/listen.ts`），**panel 保留自有实现**、不从 api 取；`panel` 只把日期助手改从 `contract` 取、三个 `build*` 改从 `company` 取，`api` 直接用 `company` | 纯移动不改行为与日期语义；`bun run guard:boundaries` 仍绿；`panel→api`、`api→panel`、`company→panel` 三条边都不存在；两份 `listenHono` 的行为差异进 §五.6 清单 |
| M2 | **api 接管路由**：`external/{server,views}.ts` 的逻辑搬为 `createApiApp(opts)` 与 `serveApi(port, opts)`；**不动** `panel` 的 `"./external"` 导出，旧面继续对外 | 新面**零生产调用方**（只有测试直调）；同一端口不得新旧两套同时监听；路由共 **16 条**（10 读含新增 `GET /v1/requests/status` 与按订阅面计的 501 `/v1/events` + 4 触发 + `/v1/subscriptions` + `GET /`），计数唯一口径见 §0.4 与 `81-files/14-api.md`；`requests/status` 只读注入的 `receipt()` 快照，不重放、不查库；M2 时若 `ingress` 尚未装配，该路由只能 501 并写明原因，**不得**用假回执或空对象顶替，M3 注入后转 200/503；台账派生面受缺口阻塞的只能 501，**不得**先把 panel 实现复制进 api |
| M3 | **装配上线**：新建 `apps/daemon/src/assembly/api/assemble.ts`（`F-daemon-api-assemble`，归 `81-files/17-daemon-assembly-cli-control-evolve.md`），由 `runServe` 调用并 `serveApi`；`assembleApi(deps: { ingress: Pick<IntentSubmissionPort,'submit'\|'receipt'>; ledgerPath: string; company; config }): ApiServerOptions`，`deps` **不收 `engine`**；`emitIntent`/`getIntentReceipt` 原样转发 `IntentIngress.submit`/`receipt`（实现归 `F-daemon-intent-ingress`，回执投影归 `F-daemon-intent-receipt-store`；不查重、不落回执、**不得**直接 `engine.ingest`；回执读已提交快照，不经台账库读）；`issuesView` 用 `openLedgerReadonly` 现构；`cli/external` 同时退役或只打印迁移指引 | **前置**：80-§8.2 与 80-D12 的“只读打开不跑 DDL”先落地，否则 daemon 内起的 API 仍会 `migrate`，M3 的“只读”是假的；`:8788` 由 daemon 同进程提供；触发面不再有平台写原语 |
| M4 | **验证**：80-§9.4 的 **11 项**逐条核对（信息面字段一致、认证 401/403/429、幂等与 409、回执只到“已受理”、未挂载面 fail-closed、`/v1/events` 仍 501、启动两态、只读证据、202 与回执语义、**16 条路由**逐条覆盖、**`requests/status` 正反用例**） | 未全绿不得进 M5；本卷不复述 11 项内容，以 80 原文为准。第 11 项在本卷的落点：正例是 `POST /v1/requests` 得 202 后按同一 `company/source/kind` 与 `dedupKey`（或 `ticket`）查回 `200`、`status:'queued'`、`intentRef` 同值且无 `outcome`，判定后为 `decided`+`outcome`+`intakeRecordRef`；反例是快照缺键 `503`+`receipt-not-in-snapshot`（不是 404、不是 200 空体、不回落查库）、参数越界 `422`、拼错路径 `404 not-found`、连查 3 次不新增记录也不重放、成功与失败都带 `Cache-Control: no-store` |
| M5 | **删除旧面**：删 `src/external/` 三件与 `"./external"` 导出；测试随之删除或随 api 迁移改名 | 破坏性变更，须批示加 82 波次；**必须最后**，早于 M3/M4 即断服 |

**源到目标映射（只列 panel 侧要交出的东西，目标文件 ID 归 `81-files/14-api.md` 与 `81-files/17-daemon-assembly-cli-control-evolve.md`）**：

| 旧件职责 | 目标 |
|---|---|
| `createExternalApp` / `serveExternal` | `createApiApp` / `serveApi` |
| `openLedger` 注入位 | 删除，换 `issuesView`（装配体用 `openLedgerReadonly` 现构，api 自己不碰库） |
| `ExternalPlatformWrite` 注入位 | 删除，换 `emitIntent`/`getIntentReceipt` |
| 意图入口（公共端口 `TS-PORT-API-01`） | `F-daemon-intent-ingress`（`assembly/intent/ingress.ts`，实现 `IntentSubmissionPort`，内部类型另含 `replayQueued()` 且不外泄） |
| `intent_receipts` 投影维护 | `F-daemon-intent-receipt-store`（`assembly/intent/receipt-store.ts`） |
| 回执读取（`getIntentReceipt`） | 读 `IntentReceiptStore` 的**已提交快照**（进程内），**不**经 `ReadOnlyLedger.get`、不回库；台账读失败不得把回执改判为 404、空 body 或 503 |
| 回执查询路由（`GET /v1/requests/status`） | `routes/requests-status.ts`（目标文件 ID 归 `81-files/14-api.md`）：只读 `ingress.receipt(key)` 快照，命中 `200 {receipt}`、缺键 `503 receipt-not-in-snapshot`、参数越界 `422`、无令牌 `401`、来源不允许 `403`；不重放、不查库、不物化；panel 侧**无对应实现**，属新增 |
| 幂等 kv（`IDEMPOTENCY_KV_PREFIX`） | 由 `REC-WORK-01` 的 `intentRef` 加 `IntentReceiptStore` 投影承担；键为 `IntentKey = (company, source, kind, ticket ?? dedupKey)`，TTL 24h 只对 `decided` 与已对账 `unknown` 生效，`queued` 不过期。**不是**“api 侧另建幂等表” |
| `EXTERNAL_ENDPOINTS`/名片/公司/组织/人事/报表投影 | `views/*`，按三级白名单逐键序列化 |
| `/v1/events` 501 | `routes/subscriptions.ts`，保持 501 直到 `eventsSource` 定义 |

**两处违例的收口方式**：`src/external/server.ts` 触发端点里的 `platform.issues.create` 在 M2 后由 `emitIntent` 承担（落点 `IntentIngress.submit`，顺序冻结：`WorkIntake.reserve` 写 `REC-WORK-01` 并立即产生 `intentRef` → `IntentReceiptStore` 刷新投影 → `engine.ingest` → 返回）；同处随后的 `ledger.kvSet` 由 `REC-WORK-01` 与回执投影取代，不再直写 `daemon_kv`。本卷**不**给 panel 侧就地修补方案，因为任何修补都会把写路径留在即将删除的文件里。回执语义：202 body 只有 `{receipt}`（不带 `outcome`）；同键同摘要回 200 且 `duplicate:true`；同键不同摘要 409；429 带 `unavailable`+`quota`+`retryAfter`；503 `unavailable`（回执查询缺键同为 503，`subcause:'receipt-not-in-snapshot'`）；501 `unsupported`+`unmounted`。

**启动两态（不得因命令消失而丢闸）**：`ServeConfig.external` 缺失或 `enabled=false` 时 `:8788` 整个面不启动，daemon 照常运行，日志明写“对外 API 未启用”（这是“没开”，不是降级）；配置开启但缺 `token`/`requestsPerMinute`/`idempotencyTtlMs` 或缺只读台账时 `configInvalid`，`runServe` 非零退出，**不得**起“只有信息面”的半面。`allowedSources` 缺省 `['external-api']`，显式空数组 fail-closed 回 403。七个键为 `enabled`/`port`/`lan`/`token`/`requestsPerMinute`/`idempotencyTtlMs`/`allowedSources`，缺省 `port=8788`、`lan=false`；`cli/external` 退役后该闸随装配迁入 `ServeConfig.external`，不在命令层丢失。

**停机顺序**：`sources.stopAll()` → `apiHandle.close()` → `engine.dispose()` → `ledger.close()`（80-§3.6）；`apiHandle.close()` 只关 HTTP，台账句柄归 daemon。

**退役硬条件**：M4 的 11 项全绿、启动两态验证、只读证据（`:8788` 句柄 `PRAGMA query_only=1`，启动前后 `user_version` 与表集合不变）、`requests/status` 正反用例与 `503` 不重放断言通过、制作人批示。旧面两份测试（521 行与 195 行）在 M5 前保留作回归对照，删除时其覆盖必须已被 `api/test/**` 与装配层测试承接。

### 五.4 依赖分类修正

`@studio-next/company` 现列 `devDependencies`，但 `src/overview/reports.ts` 运行时 import `parseJobOps`。目标移入 `dependencies`。这是分类修正，不是新增依赖，不改变版本，也不改变允许边（`panel→company` 本就在表内）。M1 之后 `panel` 对 `company` 的依赖面会扩大（三个 builder 的再导出），届时更必须归位。

### 五.5 80-D12 只读改造

**现状（已核实，与 80-§8.2 一致）**：panel 三处都用 `openLedger`，而这个函数在打开后无条件 `migrate`：`servePanel`、`serveOverview`、`serveExternal` 各一处。全仓同类开库点共 14 处，跨 daemon、panel、CLI 与维护命令，任意一个先起都会改 schema；这是多进程问题，不是“panel 一处”的问题。

**目标签名（80-§8.2 原文，不在本卷重定义）**：

```ts
interface ReadOnlyLedgerOpen {
  path: string
  expectedSchemaVersion: number
  readOnly: true
  queryOnly: true
}
interface ReadOnlyLedger {
  readonly schemaVersion: number
  query<TPayload>(q: RecordQuery): Result<RecordPage<TPayload>, ClassifiedError>     // 同步
  get(recordId: Qid): Result<RecordEnvelope<unknown> | undefined, ClassifiedError>   // 同步；Ok(undefined) 才是不存在
  close(): void
}
declare function openLedgerReadonly(o: ReadOnlyLedgerOpen): Result<ReadOnlyLedger, ClassifiedError>
```

`RecordReader`（`TS-PORT-REC-02`）的 `get`/`query` 返回 `Promise<Result<…>>`（异步），只有 `ReadOnlyLedger` 的两条读口是同步；两者共用 `RecordPage<T>`。判据只有一条：**`Ok(undefined)` 才表示“不存在”**；运行期库失败一律 `Err({ failure:'unavailable', category:'STALL', subcause:'ledger-read-failed' })`，**不得**用 `undefined`、空页或空数组吞错。

`81-files/03-store.md` 的 `F-store-ledger-open` 是实现位，返回的就是 80 的 `ReadOnlyLedger`（`schemaVersion`/`query`/`get`/`close`，不含 `db`、不含写方法）。上一稿在 03-store 里另立过 `ReadLedger` 这名，已判为旧稿自拟并作废：**全仓只用 80 的 `ReadOnlyLedger`**，本卷不再并列第二个名字。注意 `ReadOnlyLedger` 只给 `RecordQuery` 记录读口，投影表行读取口 80 未给（缺口 G5），`TableProjectionResult.rows` 是计数不是行，不得顶替。

**panel 侧五条约束**：

1. 只读打开，**不建库、不迁移、不改 schema**；只允许 `SELECT`；除 `query_only=ON` 外不得写 PRAGMA，只保留 `busy_timeout`，跳过 `journal_mode`/`synchronous` 等会写库头的设置。
2. 缺库由 `openLedgerReadonly` 返回 `Err({ failure:'unavailable', category:'STALL', subcause:'db-missing' })`；panel 现存的 `existsSync` 闸与 `configInvalid('panel/db-not-found')`、`overview/...`、`external/...` 三段前缀文案**全部删除**，不得在 panel 里二次判定。
3. `expectedSchemaVersion` 由 wiring 注入（daemon 的迁移期望，不是 panel 自查）；版本落后 `rejected_version`/`EVOLVE_REJECT`/`schema-behind`，超前同形 `schema-ahead`，两种都拒起并交 daemon，**绝不自动迁移**。`CONFIG_INVALID` 只留给路径/配置缺失或畸形。
4. 台账句柄类型收窄为 `ReadOnlyLedger`；panel 内 `ledger.kvSet`/`kvGet`（仅 `external` 用过）与 `version()` 调用点随之消失或改为 `schemaVersion`。三面的注入位是否改名 `openReadOnly` 由 §五.6 统一：`server.ts` 用 `openReadOnly`，`overview/server.ts` 保留 `openLedger` 字段名但类型收窄（减少 wiring churn），`external` 随 M5 整组删除。
5. **失败不伪装**：`query`/`get` 的 `Err` 必须进 `observation.state='unknown'`（覆盖缺口按 §四 记 `gap`）并带 `failure`/`subcause`；不得渲染成空数组、0、空页或绿色健康。四条固定形状（80-§8.2）：`unsupported`/`EVOLVE_REJECT`/`ledger-query-unsupported`（未开放能力，不是配置错）、`conflict`/`EXTERNAL_REJECT`/`ledger-cursor-invalid`（非合并域不写 `MERGE_CONFLICT`，`STATE_CONFLICT` 不是 category 成员、全卷不出现）、`rejected_precondition`/`CONFIG_INVALID`/`ledger-query-invalid`（形状非法）、`unavailable`/`STALL`/`ledger-read-failed`（`get` 读失败，**不是** `Ok(undefined)`）；打开期仍是 `db-missing`/`schema-behind`/`schema-ahead`。

**验收（80-§9.4 M4 第 8 项的 panel 侧复制）**：句柄 `PRAGMA query_only=1`；启动前后 `user_version` 与表集合不变；缺库不建文件；版本不匹配拒起且带期望/实际；读口失败返回 `Err` 且端面显示 `unknown` 或 `gap`，不出现空数组、0 或绿色健康。`test/readonly-ledger.test.ts`（§四）承担这五条，store 侧另有 `test/open.test.ts`（归 `81-files/03-store.md`）。在 store 落地前，本件必红，属计划内红，不得以跳过或特判转绿。`expectedSchemaVersion` 的常量来源见缺口 G7，本卷不代定。

**未证**：多进程并发迁移的后果（U80-16）未验证；本卷不宣称“并发安全”，也不声称 80-D12 已落地。`openLedgerReadonly` 在仓内尚不存在（`packages/store/src` 无此符号），本卷所述签名是 80-§8.2 的目标形状，不是现状。

### 五.6 目标面清单

| 面 | 端口 | 目标文件 | 状态 |
|---|---|---|---|
| 监控 | `:8791` | `src/server.ts` + `src/monitor/*` + `ui/*` | 保留，补六态健康与只读 |
| 概览 | `:8789` | `src/overview/*` + `ui/overview/*` | 保留，补六态与缺口显示 |
| 对外 | `:8788` | 迁 `packages/api` | `panel` 侧整组退役 |
| 旧兼容 | 无独立端口 | `src/views.ts` 的旧页、`src/overview/views.ts` 的 SSR | `/legacy` 两条，82 波次后删 |

**`listenHono` 一族是 api 同源副本，panel 保留自有实现**：`api` 在 `F-api-http-listen`（`src/http/listen.ts`，归 `81-files/14-api.md`）持一份只依赖 `node:http` 的同源副本；`panel` 的 `:8791`/`:8789` 继续用自己的薄壳，不从 api 取、不由 api 注入。两份实现结构同源、源码各自持有，差异必须进 81 的对齐清单与 82 的负向用例，特别是 `x-sn-client-key` 由 socket 注入、`onClose` 关库链、`label` 文案三处。三条边是硬禁：**不得 `panel→api`**（会新增允许边）、**不得 `api→panel`**（会把 api 绑回即将退役的旧面）、**不得 `company→panel`**（下沉件的日期助手须先到 `contract`，§五.3 M1）。

### 五.7 绑定地址与端口口径

三面缺省绑定都是 `127.0.0.1`（`listenHono` 的常量缺省旁有注释说明安全意图；`overview/server.ts` 的 hostname 透传；`src/external/server.ts` 起监听前同样有注释），只有显式 `--lan` 才 `0.0.0.0`（`cli/external.ts` 的旗标分支）。80-§9.1 已判定：现状回环是**合理的安全缺省**，但 `00-总览` D4 所记“对外 API 暴露默认局域网”的部署意图**未实现**；loopback 与 LAN 的选择属部署策略（80-Q1 未决，缺省回环），交 78 的绑定档案与制作人裁定，本卷只登记（§七.1）。

端口口径同样漂移：文档逻辑名 `:8787`，实值 `:8791`（`src/judge.ts` 注释记 2026-10-21 制作人令换端口）。79-D6 已登记该双口径，二选一写死是政策项，登记不代决（§七.1）。

---

## 六、未证与回写清单

### 6.1 须回写 80 的缺口

编号 G1–G14 在正文内被引用，逐条可查。**不私造**：本卷给的临时形状都标了“待定”，不得据此宣布契约已定。

| 编号 | 缺口 | 现状 | 本卷临时处置 |
|---|---|---|---|
| G1 | 六态的文件家 | 80-§4.4 已给类型名 `ObservationState` 与六个英文字面量，未给文件家 | `src/monitor/projection-state.ts`；若定为 `contract` 则整件迁出且本卷只留迁移说明 |
| G2 | `REC-OBS-01`/`REC-OBS-02` 的记录形状 | 归 `contract` 的 `F-contract-rec-payload-lifecycle`（`81-files/01-contract.md`） | 本卷只定义 payload 的运行时子集，不复制记录 schema |
| G3 | `/api/health` 的 payload 字段表 | 80-§9.2/§9.6 给语义与每态证据，未给字段名 | 本卷给 `schemaVersion`/`expectedSchemaVersion`/`surfaces`/`generatedAt`/`note`，**标注待定** |
| G4 | 六态的逐面判定规则 | 80 未逐项规定（`cyclic` 取 `conflict` 还是 `derived` 加 `promoted`；版本不匹配取 `stale` 还是 `conflict`） | 本卷暂定：版本不匹配取 `conflict`（并列期望与实际），`cyclic` 取 `conflict`；`stale` 因缺 freshness policy 在 v0 不可达（G10），不用于版本不匹配；待 80 确认 |
| G5 | 投影表行的只读读取口 | `ReadOnlyLedger` 只给 `RecordQuery`（记录信封）；panel 需要 jobs/todoQueue/events/work/sessions 行，而 `TableProjectionResult.rows` 是**计数不是行** | 建议 80 增只读投影读口，或在 `81-files/03-store.md` 给受控扩展。未解前，本卷所有“读投影表”的目标描述都不成立 |
| G6 | `RecEvent → EventRecord` 映射表 | 80-§4.6 说“放 81 文件条目”，未指定哪一卷哪个条目 | panel 事件流与断路面依赖 `EventRecord`；建议落 `81-files/01-contract.md`，本卷不代设 |
| G7 | `expectedSchemaVersion` 的常量来源 | `packages/store` 未导出 schema 版本常量（只有 `ledger.version()` 与内部 `schema_version` 表） | panel 侧只声明“由 wiring 注入”，不自查、不猜；常量出口待 store 定 |
| G8 | `KnownSecretSet` 的 panel 注入位 | 80-§11.2 只给 `SecretProvider` 注入面，未给只读进程的注入位 | panel 无注入位，出站只做形状兜底；**不得声称已完全脱敏**（80-§11.2.1） |
| G9 | `cost_usd:number` → `DecimalString` 的标度与舍入 | 80 未给源字段到 `DecimalString` 的标度（76-§1.2 只给“标度由字段声明、缺省 ≤9”） | 本卷只写“不过 float、不四舍五入”，不给标度；未解前不得宣称公共金额合规 |
| G10 | 六态 `stale` 的新鲜度窗 | 80-§9.6 要求 `stale` 附“最后可信时间 + 新鲜度窗”，未给窗长与来源 | v0 判为不可达，**不得伪造**两个数；窗长待 80 或 82 定 |
| G11 | `REC-OBS-02` 无进 panel 的读路 | `ProjectionName` 无 observationFaults 一类；`RecordProjection` 只回计数 | 77-§9.3 第 10 面“监控自身”因此无法完整显示 daemon 侧故障；建议 80 增只读读口 |
| G12 | `TS-PORT-OBS-01` 的实现文件 | 80 未指定，仅给端口名与“只读六态视图”的定位 | `src/monitor/dashboard.ts` 作仪表盘投影实现位，`inbox.ts` 与 `overview/api.ts` 为另两个读侧包装点；**表维护不在 panel** |
| G13 | `emitIntent`/`InvokeIntent` 的字段 | 80-§9.4 已给签名 `emitIntent(intent: WebhookIntentPayload): Promise<Result<IntentSubmitResult, ClassifiedError>>` 与 `getIntentReceipt`，未给 field 表 | 只引用签名，不复制字段 |
| G14（已关闭） | 路由计数与 M4 验证项数量 | 80-§9.4 现行值：路由 **16 条**（10 读含新增 `GET /v1/requests/status` 与按订阅面计的 501 `/v1/events` + 4 触发 + `/v1/subscriptions` + `GET /`），M4 验证项 **11 项**（第 11 项为回执查询端点） | 本卷按 80 现行值直接写 16 与 11；旧稿把验证项数与路由数当两轴的解释作废，编号保留不复用（避免既有引用悬空） |

**已消解**（不再作为缺口，编号保留不复用）：① `openLedgerReadonly`/`ReadOnlyLedger` 的双名分歧：`81-files/03-store.md` 已按 80 原文拼写并删除自拟的 `ReadLedger`，本卷同步，全卷单一名字；② 路由计数旧口径（漏 `GET /v1/requests/status`）：80 已补该端点并把计数改为 16，本卷同步，G14 关闭；③ 17 卷的装配与意图文件 ID：以 `F-daemon-api-assemble`、`F-daemon-intent-ingress`、`F-daemon-intent-receipt-store` 为准，文件名写全 `81-files/17-daemon-assembly-cli-control-evolve.md`；④ 读口 `Err` 的 `STATE_CONFLICT` 与 `CONFIG_INVALID` 误用：80-§8.2 现行表已把未开放组合定为 `EVOLVE_REJECT`，本卷跟改。

**保留的真实边界**（不因清理跨卷指控而删）：`:8788` 的迁移时点（M2 不动旧面，M5 才删，早删即断服）、入站认证（令牌 401/403 与配额 429）、六态 `unknown`（无数据不得显示 0 或空，也不得以“没有告警”暗示健康）、`GET /v1/requests/status` 属新增（panel 侧无实现，`packages/api` 接管后才存在）。

### 6.2 须回写 79 与 `00-总览` 的口径

- **80-D12 只读改造**与现实现的差距：panel 三处 `openLedger`（`servePanel`、`serveOverview`、`serveExternal` 各一处，均无条件迁移），且全仓同类开库点共 14 处；需在 79 侧记“panel 只读待落地”的漂移，并把 U80-16（并发迁移未证）挂到同一行。
- **`00-总览` D4「对外 API 暴露默认局域网」**与三面缺省 `127.0.0.1` 冲突：80-§9.1 已交 78 绑定档案与制作人裁定（80-Q1 未决，缺省回环），79 侧同步记“部署意图未实现”，不得写成“已统一”。
- **79-D6** 端口逻辑名与实值（§七.1）。
- **79-D10** `test/` 未进类型门禁：本卷 §3.4 的 18 件与 §四 3 件测试都不在 `tsc --noEmit` 覆盖内，它们的类型错误只能在运行期暴露。这是门禁缺口，不是本包遗漏。

### 6.3 未证事项

- 本卷写作期间**未运行** `bun run typecheck`、`bun run guard:boundaries`、`bunx vitest run packages/panel/test`；凡“用例存在”均指既有文件，不指本次验证结果。本卷不给“全卷 PASS”结论。
- `openLedgerReadonly` 在仓内不存在（`packages/store/src` 无此符号），`ReadOnlyLedger` 也只是目标类型；§五.5 所述是 80-§8.2 的目标形状。
- `PACKAGE_NAME`/`PACKAGE_STATUS` 无外部消费者，属库级未接；不主张有消费者。
- `judge.ts` 的全量事件重放的性能未证；`reload.ts` 的跨平台 `fs.watch` 行为未证；`static.ts` 的 ETag 在跨文件系统与反代下的行为未证；SSE 游标是 `(ts, id)` 复合键而非 opaque token，跨实现复用未证；`ui` 各件只有语法与导入门禁，浏览器渲染未证。
- `packages/api` 的接管能力、`packages/company` 的下沉文件、`packages/store` 的只读实现均为目标，未验收；本卷不据其存在与否调整 panel 的现有描述。
- **同源副本未建**：`F-api-http-listen`（`packages/api/src/http/listen.ts`）与 `packages/api` 的路由本体均不存在，`packages/api/src` 现只有 `index.ts`；panel 的 `toWebRequest`/`forwardResponse`/`listenHono`/`servePanel` 是唯一在跑的 HTTP 适配。两份实现的行为差异因此**无对照证据**，只登记为待验证清单（`x-sn-client-key`、`onClose` 链、`label` 文案）。
- **daemon 意图/装配件未建**：`F-daemon-api-assemble`、`F-daemon-intent-ingress`、`F-daemon-intent-receipt-store` 均不存在，`apps/daemon/src/assembly/` 下现无 `api/` 与 `intent/` 子目录。M2 至 M4 的完成判据全部未验，`:8788` 仍由 `cli/external` 加 `panel/external` 提供。
- 并发迁移的后果（U80-16）未证；本卷不宣称“并发安全”。

---

## 七、政策项与工程选择

### 7.1 须制作人裁定的政策项（本卷不代决）

1. **绑定缺省**：三面 `127.0.0.1` 与 `00-总览` D4「对外 API 暴露默认局域网」的部署意图不一致。80-§9.1 已定为“现状回环是合理安全缺省、部署意图未实现”，80-Q1 记为未决（缺省回环），并交 78 绑定档案与制作人裁定；选项为“安全缺省加显式 `--lan`”与“默认局域网”，二者影响暴露面，须裁定。
2. **端口口径（79-D6）**：`:8787` 逻辑名与 `:8791` 实值二选一写死；`src/judge.ts` 的注释记 2026-10-21 制作人令换端口，需确认是最终值还是过渡值。
3. **`external` 的公开范围（80-Q2）**：令牌、配额（SLA 拟稿值）、`/v1/*` 的可见性与三级视图白名单（`public`/`partner`/`internal`，80-§9.4）的默认级别，须在 `api` 接管前定，否则 M2 会固化一个未经批准的暴露面。
4. **`/legacy` 删除时点**：82 波次完成的标准与宣告方式须明确，否则 `overview/views.ts` 的退役无判据。
5. **六态逐面判定**：`cyclic` 取 `conflict` 还是 `derived` 加 `promoted`、版本不匹配取 `stale` 还是 `conflict`，80 未逐项规定（缺口 G4）。本卷暂定：版本不匹配取 `conflict`（并列期望与实际），`cyclic` 取 `conflict`；`stale` 因缺 freshness policy 在 v0 不可达（G10），与 §四 `monitor-health` 的用例一致。若要改判需在 80 定稿，不由本卷私改。

### 7.2 可执行的工程选择（不需裁定）

1. `views.ts` 保留 facade 而不另建 `legacy-page.ts`，理由是不在 `src` 根新增散件。
2. 健康六态现算不缓存，理由是健康状态滞后比读放大更危险。
3. 错误响应分类化后不回显 `err.message`，理由是对齐 80-§5.7/§5.8。
4. `alerts-costs.test.ts` 568 行不拆，新断言进新文件，理由是避免大范围改既有用例造成“行为变更”与“重构”混同。
5. `listenHono` 一族由 api 持同源副本、panel 保留自有实现，差异进对齐清单，理由是 `panel→api`、`api→panel`、`company→panel` 三条边都不是允许边；若要走“提取到共享归属”的另一条路，须先由 80 增允许边提案，本卷不代设。
6. `test/readonly-ledger.test.ts` 在 store 落地前保持计划内红，理由是不得用跳过或特判掩盖缺失能力。
7. `Completeness` 直接沿用 77-§9.1 的中文四值而不造英文映射，理由是避免与失败类 `partial` 撞名；若 80 要求英文映射再补。
8. panel 不调 `RecordProjection` 做表维护，即使 `TS-PORT-OBS-01` 允许“必要时维护”，理由是本包只有读路径，维护会写事实源（80-§9.5）。
9. panel 不做 `DecimalString` 换算，理由是源标度未定（缺口 G9）；在此之前只保留现有浮点显示并明写“非公共口径”，不新增半套转换。
10. `/api/health` 现算不缓存、失败不沿用上一份，理由是 77-§9.4 明令不得用最后一张健康快照冒充当前状态。
11. 错误响应只回 `{ error:{ failure, category, subcause }, traceId }`，`detail` 只在过脱敏后给，理由是 80-§5.7/§5.8 与 §11.2.1。
12. `monitor/projection-state.ts` 零依赖（不 import `store`/`hono`/`contract`），理由是让 `monitor/*`、`inbox.ts`、`overview/api.ts` 三处共用一份字面量，避免复制即第二套语义。

---

## 八、附录完成判据自检

| 判据（81-§六） | 本卷情况 |
|---|---|
| 1 现有与目标路径可枚举、可复算 | §一给出 73 件逐路径枚举与算式；§1.1 给处置统计（66 保留 / 2 拆分 / 5 退役 / 8 新增）、过渡态 81 与终态 75 两套计数与目标文件树 |
| 2 每件有内部结构、依赖、IO、错误、测试与迁移 | §三 73 条与 §四 8 条均按十面书写；短件压缩但未省略任何一面 |
| 3 目标新增件能回到 76/77/78/80 的 ID | `monitor/*` 五件均给 77-§9.x、80-§9.x、`TS-PORT-OBS-01`、`REC-OBS-01/02` 锚；`REC-OBS-01/02` 的记录形状归 `F-contract-rec-payload-lifecycle`（见 `81-files/01-contract.md`），本卷只消费字段；无锚项进 §六回写（G1–G14） |
| 4 超限件有拆分后清单，未提阈值或新增散件 | §五.1、§五.2 给逐符号去向与顺序；未新增根目录散件 |
| 5 无通配端口号、无来源记录 ID、无虚构依赖 | 只列 76/77/80 与 `01-contract` 已登记的具体 ID（`TS-PORT-OBS-01`、`TS-PORT-API-01`、`REC-OBS-01`/`REC-OBS-02`、`REC-WORK-01`、`80-D12`、`U80-16`、`80-Q1`/`80-Q2`），不写 `TS-PORT-*` 通配；文件 ID 写实名（`F-contract-port-intent`/`-record`/`-effects`、`F-daemon-intent-ingress`、`F-daemon-intent-receipt-store`、`F-daemon-api-assemble`、`F-api-http-listen`、`F-store-ledger-open`），17 卷写全 `81-files/17-daemon-assembly-cli-control-evolve.md`；依赖只列 manifest 与既有 import；`openLedgerReadonly` 仓内仍无该符号，目标签名见 80-§8.2，全卷单一名字 |
| 6 明确现有/目标/未证 | 每条带标签；§六.3 列未证；无“测试证明真机”表述 |
| 7 覆盖保留/拆分/新增/替换/退役与测试、配置 | 保留 66 件、拆分 2 件（`src/views.ts` 留 facade；`src/overview/views.ts` 终态退役）、新增 8 件（5 生产加 3 测试）、替换 1 件（`external/server.ts` 过渡期）、退役 5 件（`external` 三件加 `test/external.test.ts`、`test/external-serve.test.ts`）；66 + 2 + 5 = 73，终态 18 src + 19 test + 33 ui + 1 script + 4 配置 = 75；配置与脚本在 §3.6 |
| 8 政策项与工程选择分开 | §七.1 五项政策，§七.2 十二项工程选择 |

**本卷不自判 PASS**：上表只说明“写了什么、证据在哪”，不构成验收结论。验收需另跑 `bun run typecheck`、`bun run guard:boundaries`、`bunx vitest run packages/panel/test`，并且 §六 的 G1–G14 缺口需 80 定稿后才能关闭。本轮**未运行**任何门禁与测试。
