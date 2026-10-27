# 81-files/01 · 契约包（`packages/contract`）

> 版本：v0.10，2026-10-27。**v0.10 按 80-§4.2/§6.3 补记录面载荷与写入口径（不改计数、不新增文件/端口/`REC-*`）**：① `RecordEnvelope.payloadRef` 明确为 **`ArtifactRef`**（TS-REF-05，复用；**不引用、不另造 `PayloadRef`**）——`contentDigest` = 原始载荷 `byteDigest`（非语义摘要）、`mediaType` 须与写入时一致、`storageHint` 只是**逻辑定位**（非权限、非本机路径、非可读性证明）；信封槽数按 80 更正为 **19**。② 新增 **`RecordPayload{ref, bytes, mediaType}`** 与 **`RecordWriteInput{envelope, payload}`**；`RecordWriter.append(input, opts?)`——**`append(env)` 作废**；`AppendOptions.authorityDomain?` 仅当规则注册表能唯一定域时可省，歧义必填（`authority-domain-ambiguous`），不得猜，且须等于 `TxScope.authorityDomain`。③ `RecordReader.payload(ref)`（异步）与 `ReadOnlyLedger.payload(ref)`（同步）同义四态：`Ok(undefined)` **只表示该定位无载荷**；**先按信封 `knowledge`/`scope` 授权**（`ref` 不是通行证，`payload-not-authorized` 不得回 `undefined`）；摘要/媒体不符回 `Err`；不可读回 `unavailable/STALL/payload-unreadable`；`get`/`query` **只回信封**（不内联字节，DoS 面）。④ `ProjectionSource` 补 `since`（增量起点）/`asOf`（快照时点）语义且禁互替，`factDomains` 校验**不得硬编码域→表**。⑤ **G-29 关闭**（78-§7.4.1 已改恰两用途），G-28/G-30 维持关闭，正文无过期指控。计数不变（`src` 新增 25 / 总新增 43 / 总数 64 / 端口 55 / 测试 12），**三张记录表与写读端口实现均未落地**（`U80-21`）。
> 版本：v0.9，2026-10-27。**v0.9 三处小修（不改计数、不新增文件、不新增端口）**：① `mapState` 定为**纯函数**——未映射但合法只回 `Ok({verification:'unverified', workStates:[], unmappedBehavior:'observe-unmapped'})`，**不写 `REC-OBS-02`**（记录由消费方 state-diff / `TS-PORT-OBS-01` 写，同单/同原值/同拍一条）；v0.5 版本行、§4.1 `port-binding`、§4.9 接缝表的相反现役句已删，`workStates=[]` 时不得推进迁移/验收/结清的口径**保留**（08-localplatform G19 所指的相反口径随之消除）；② 80 已回填三处，**G-28/G-29/G-30 关闭**——`TableProjectionResult.name` = `TargetTableProjectionName`（80-§6.3/D30）、`SEC-MX-BOT-PASSWORD` 恰两用途（80-§11.2.1/D23）、`classified` 与 `configInvalid` 同落 `schemas/errors.ts` 且不另造 `errors.ts`（80-§5.7/D29）；G-29 当时只剩 78-§7.4.1 一面（该面已于 v0.10 关闭）；③ BIND-01 按 80-§6.6/§6.9 的**三层归属**同步 §4.1/§4.9 正文（类型唯一在 `contract`、宿主唯一在 `assembly/platform/binding.ts`、平台包只供 `bindingProfile()`/`mapState()`/`lossReport()` 纯函数、禁第二实现）。计数不变（`src` 新增 25 / 43 总新增 / 64 总数 / 55 端口），**目标件仍未实现**。
> 版本：v0.8，2026-10-27。**v0.8 拆出绑定端口并纠正四处口径**：① 新增 **`F-contract-port-binding`**（`contract/src/ports/binding.ts`，落点由 80-§6.9 指名）承载 **`TS-PORT-BIND-01 PlatformBindingPort`** 与 `BindingProfile`(20 字段)/`StateMapping`/`ExportScope`/`ExportBundle`/`ExitPlan`/`BindingFactStatus`——这些**从 `effects.ts` 移出**，`effects.ts` 只留 EFF-01/EVD-01/EVD-02/MEM-01/OBS-01/MIG-01；实现**不在本包**（通用宿主 `apps/daemon/src/assembly/platform/binding.ts` 包装 `FlowPlatform`，平台特定档案在 `localplatform`/`taiga`/`yt`），并配 **`F-contract-test-ports-binding`**（`test/ports/binding.test.ts`）；② `TableProjectionResult.name` 用 **`TargetTableProjectionName`**（含新增的 `resourceLedger`，否则 `project('resourceLedger')` 无法回名）——现 80-§6.3/D30 已是此口径（G-28 于 v0.9 关闭）；③ `SEC-MX-BOT-PASSWORD` 的 `allowedUses` 只 **`platform-auth` + `outbound-redaction`**，**删掉 `matrix-register` 与“保留未用”**（80-§11.2.1/D23 已同此口径；78-§7.4.1 于 v0.10 亦改，G-29 关闭）；建号只认 `SEC-MX-HR-SHARED`（`use='matrix-register'`）——78-§7.4.1 于 v0.10 亦改（G-29 关闭）；④ **落点定案**：`classified` 与 `configInvalid` 同在 `contract/src/schemas/errors.ts`，`ClassifiedError`/`ErrorCategory` 留 `ports/kernel.ts`，**不建另一个 `errors.ts`**——现 80-§5.7/D29 已是此口径（G-30 于 v0.9 关闭）；⑤ 计数实算：`src` 新增 **25**、`src/ports` 新文件 **11**、测试新增 **10**、目标件 **43 新增**、文件总数 **64**（= 21 现有 + 43 新增；`src/index.ts` 的内容重组属拆分、不另计件）；端口仍 **55**（53 新，BIND-01 只换家、不增减）。以上**全部为目标未实现**。
> 版本：v0.7，2026-10-27。**v0.7 按 80 最新原文做四处同步**：① 读面错误映射纠正——`ledger-query-unsupported` 走 `failure:'unsupported'` + `category:'EVOLVE_REJECT'`（**不是** `CONFIG_INVALID`），游标不可解走 `failure:'conflict'` + `category:'EXTERNAL_REJECT'`，`STATE_CONFLICT` 不是 `ErrorCategory` 成员、全卷不得出现，形状非法仍 `rejected_precondition` + `CONFIG_INVALID`；② 投影名分两层——`TableProjectionName` 仍 **17**（含 `intentReceipts`）、`TargetTableProjectionName = TableProjectionName | 'resourceLedger'`、`ProjectionName = TargetTableProjectionName | 'observation'`；`resourceLedger` 是**已登记的目标名**（物理表 `resource_ledger`），不再写“待命名/待提案登记”；③ 秘密句柄改名——`MatrixLoginSecret` 作废，改为 `MatrixBotLoginSecret`（登录，`use='platform-auth'`，`SEC-MX-BOT-PASSWORD`）与 `MatrixHrRegisterSecret`（建号，`use='matrix-register'`，`SEC-MX-HR-SHARED`），两者仍归 80-§3.4 的 daemon、**不属本包**，registration **不得**再指 bot 密码；④ 构造器改 80 的对象入参 `classified(input: ClassifyInput)`，构造缺口（入参形态 + 唯一入口）记为已解决；另删掉“80-§5.7 正文仍写 54 个端口”的过期指控（80 已回填 55）。
> 版本：v0.6，2026-10-27。**v0.6 按 80/77 最新原文补结构、纠过期口径**：① 新增 **`F-contract-port-resources`**（`contract/src/ports/resources.ts`），承载 **`TS-PORT-RES-01 ResourceAccountant`**——只有**只读** `baseline`/`gap`，`ResourceBaseline{subjectRef, quotaRef: DefinitionRef, entries[](resourceRef/unit/limit 三态/reserved?/consumed?/remaining?), asOf, gaps}`，缺省是**未知**不是 0/无限；**无** `reserve`/`actual`/`release`、**无** `Qid` 回执、**不新增** `REC-*`（资源事实在 `REC-WORK-05.resource_reservations`/`REC-EVD-01`、`REC-EVD-05`/`REC-EVD-06`）；② 开工判断改按 80-§6.4 完整形状：`ReadinessRequest` **八字段**、引用两轴（`VersionRef<Qid>` 与 `DefinitionRef`，**禁** `VersionRef<RecordRef>` 套嵌）、判据走 `GateResult.criterionRef: ProfileRef`、`RecReadinessJudgment` **13 字段全列**、`judgeRole` 是**逐门列表**且恰五门、六个角色名**英→中一一映射**（英文只作内部承载、不入记录）、逐门结论与整单**共用**中文三值（**不得布尔化**）；计划锁写 `REC-WORK-05.resource_reservations`；③ 规则诊断改按 80-§6.1 现行判别联合：`Diagnostic` 用 `location`/`expected?`/`actual?`（顶层短文本，**不**收进 `safeDetails`）、`limitsApplied` **仅 `phase='limit'` 必填**（其余 `never`）、登记码 **18 个**（含 `W-RULE-002`，落 `policy` 相位）；`RuleLimits` 是**七项**调用侧可收紧项（生效值 = min(档内声明, 调用侧收紧)），另三项**档内固定**不入该类型；`semanticDigest` 必带 `canonicalizationId`/`version`，禁 `byteDigest` 顶替；④ 效果面 `EffectOutcome` **两态都必带回执引用**（`applied{receiptRef}`=`REC-RCP-01`、`unknown{unknownRef}`=`REC-EVT-03`）；`REC-WORK-09.dissent_position` **必填**且只能取自触发记录/权源；`policy_verdict` 只写四个英文机器值、`appointment_kind` 只写四个中文值；⑤ `KnownSecretSet` 增 `redactKnown`（内部面），值**只存工厂闭包**、不以属性/参数/返回值暴露；`MatrixLoginSecret` 属 80-§3.4 的 daemon `RunServeOpts`，**不进**本包；⑥ 读面统一 `Result`：`RecordReader.get` 回 `Promise<Result<…|undefined>>`、`query` 回 `Promise<Result<RecordPage>>`，**`Ok(undefined)` 才是不存在**（库失败一律 `Err(unavailable/STALL/ledger-read-failed)`）；`ReadOnlyLedger` 的类型在 `store`，本卷只引用并注明其 `get`/`query` **同步**回 `Result`；`intentReceipts` 仍是独立表投影，`receipt()` 只读**已提交快照**；⑦ 计数随之更新：端口 **55**（53 新 + 2 已有）、`src/ports` **10 个新文件**、`src` 新增 **24**、目标件 **40 新增 + 1 拆分**（合计 **62 件** = 21 现有 + 41 目标）。
> 版本：v0.5，2026-10-27。**v0.5 把五处口径按 80 最新原文统一**：① 开工判断一律用 80 的类型名 `ReadinessRequest`（gate 的输入）/`RecReadinessJudgment`（`REC-WORK-04` 记录类型），`verdict` 三值照 77-§4.4.1 写**中文** `可开工`/`附条件开工`/`不可开工`——`ReadinessInputs`/`ReadinessVerdict`/`ReadinessJudgment` 与 `ready`/`not_ready`/`conditionally_ready` 一律作废，也不得加第四值 `refused`；② `ReferralTarget` 三字段**全必填**且 `positionRef: Qid`（kind 限 `position`/`governance-position`，由 Qid 校验期拒其他）；`WorkIntake.reserve` 回的 `intentRef` 是 `Qid`，且**先落 `REC-WORK-01` 再 `engine.ingest`**（`ingest` 只入内存队列、不产生记录）；③ `intentReceipts` 是 `TableProjectionName` 的成员（物理表 `intent_receipts`，17 张表投影之一），**不属** `'observation'`——`'observation'` 是 ②类，只回 `ObservationProjectionResult`、不带 `rows`；④ `WorkState` 的**族登记**锚点是 **76-§7.7（`STAT-D`）**，十态全集与迁移表锚点是 **77-§五/§5.1/§5.3**（v0.4 把族登记误标成“77-§7.7”：77 的第七章只有 §7.1–§7.5，该节不存在；十态全集在 77 是 §5.1、迁移表是 §5.3），并顺带修正一处卷内错引：`exe` 域 0 case 的缺口在 §8.1 G-06、不在“§五”；⑤ 端口引用一律写**具体 `TS-PORT-*` ID**，`TS-PORT-WORK-01…11`/`TS-PORT-AUTH-01…07`/`TS-PORT-REC-01…06` 这三类通配写法已在 §2.1/§4.1 全部展开为逐 ID 枚举（本行是为了说明“旧写法长什么样”才保留通配形，正文不得再用）。
> 版本：v0.4，2026-10-27。v0.1 初稿 → v0.2 补 `ports/intent.ts`/`ports/secret.ts`/`src/secrets.ts` 并把端口数更正为 54 → v0.3 按 80 已定稿的公共接口重写类型面 → **v0.4 复核 80 原文后纠六处自造/误引**：① 删掉不存在的 `RuleDiagnostic`（80-§6.1 只有一个 `Diagnostic`，`code` 已收窄为 `RuleDiagnosticCode`、**字段名是 `location` 而非 `path`**（v0.6 更正 v0.4 的误称），不得再派生“专用诊断”别名，也不得“以 76 基形为准”）；② `SecretCatalogEntry` 字段数 8→**7**（`secretId`/`kind`/`subjectScope`/`allowedUses`/`valueProvider`/`rotationRef`/`revocationRef`）；③ `classified-error` 工件补 80-§9.4 的三个**外层**可选键 `fieldPath?`(422)/`retryAfter?`(429)/`reason?`(501)，并写明不得塞进 `error`；④ `daykey` 不再挂 `TS-SCALAR-03`（那条管记录 `Timestamp`），`companyDayKey`/`CompanyZone` 标明“本附录所拟”并登记 G-26；⑤ `TypecheckReceipt`/`IntentSubmitResult` 的 `Result` 补第二型参、补 `Err(timeout + STALL + host-clock-guard)`、把 `diagnostic` 工件的出局理由收窄为“非规则码”；⑥ 意图面按 80-§6.6 逐字对齐：`IntentReceipt` 补 `intentKey`、`gap` 改为**数组**，`WebhookIntentBody.correlation` 改为对象 `{externalRef?, parentRef?}`。
> v0.3 的十二处实质修订（保留）：
> ① `RuleEvaluator` 两阶段（`typecheck`/`evaluate`）全走 `Result<…, ClassifiedError>`，`refused` 是 `Ok` 的第四值；② `ClassifiedError` 改两轴 `{failure, category, subcause, detail?}`，`FailureClass`（14 值）落 `records/scalars.ts`，`Err` 可达 `category` 只有 6 个；③ 意图/回执链 `WorkIntake.reserve`（落 `REC-WORK-01`）→ `IntentIngress.submit` → engine `ingest`，`IntentReceipt` 用标量 `outcome` 五值 + `status` 三值，`intent_receipts` 只是可重建投影；④ `apps/daemon` 的 API 装配只收 `ingress: Pick<IntentIngress,'submit'|'receipt'>` + `ledgerPath` + `company` + `config`；⑤ `PlatformBindingPort.mapState` 对“未映射但合法”的平台态回 `Ok({verification:'unverified',…})`（**纯函数、不写记录**；v0.5 原文的“+ `REC-OBS-02`”已于 v0.9 删除，记录归消费方）；⑥ 秘密供给面落 `ports/secret.ts`，脱敏整模块迁 `src/secrets.ts`、`core` 只具名 re-export；⑦ stdio 工具面验签在 daemon、stdout 只许 JSON-RPC 帧、未实现=未证；⑧ `NotificationEnvelope{id, message, targets, dedupKey?}` 与原形 `Notification` 并存；⑨ `mapState`/`IntentReceipt`/`ProjectionName`/`TxReceipt`/`MigrationPlan` 全部有类型落点；⑩ `repo-validate` 留 company、五门纯求值先落 `core/src/work-readiness.ts`、`MergeRunHost` 用真名、UTC 日键与公司本地日分家、`Money` 只内存；⑪ `ServeConfig.external` 七键；⑫ `ReferralTarget{positionRef, deadline, notifiedAt}` 与 `IntakeOutcome.outcome` 五值。
> 性质：**逐文件技术设计附录**（自然语言级），不是现行文件树、不是实现单、不是完成证明。
> 上位：75 的文件/依赖模板与 D75-08/D75-09/D75-10；76 的公共语法、信封、诊断、共同用例形状；77 的 50 类记录、14 类失败与 `RUN-*`；78 的平台绑定损失与秘密子面；79 的导入/构建/exports 与依赖矩阵；80 的包层、`TS-` 类型、**55 个端口**（`grep -c '^#### TS-PORT-'` = 55，含 `TS-PORT-API-01`/`TS-PORT-RULE-01`/`TS-PORT-RES-01`；80-§5.7 与 §6 的端口小节数一致（各 55），无口径差）、§4 类型映射、§5.7 错误两轴、§6 端口语义、§9.4 API 装配、§11.2/§11.2.1 秘密供给与脱敏、§12.5 未证清单。
> 门禁：本文所有“目标/新增/拆分/条件新增”均为**设计处置，尚未执行**。本附录未创建任何生产文件、未改 `package.json`/`tsconfig`/`cases.json`/`CASES.md`、未安装依赖、未运行 `bun run typecheck`/`bun run test`/`guard:boundaries`、未启动任何服务。
> 结果口径：本附录**不宣称**任何测试绿、类型通过或真机可用；下文“现有”只描述本次实际读到的代码与已核调用。

---

## 〇、范围、计数法与读法

### 0.1 在范围内 / 不在范围内

| 在范围 | 不在范围 |
|---|---|
| `packages/contract` 下全部现存文件：`src/**`、`test/**`、`cases.json`、`CASES.md`、`package.json`、`tsconfig.json` | `apps/*`、其他 `packages/*` 的源码（只作调用方证据引用） |
| 该包的目标新增件：公共语义的 TS 绑定、80 §6 端口的文件家、80-§11.2.1 的供给面、脱敏与日键纯函数、冻结交换工件的数据文件、条件构建配置、目标测试 | 根 `scripts/guards/**`、根 `tsconfig*.json`、根 `package.json`（归 19；本文只登记需要它们配合的迁移点） |
| 契约语料的域归属、消费者清单、漂移登记 | 历史设计文档正文、`docs/81-files/` 其他分册 |
| **跨卷接缝的契约面**（§4.9）：本卷消费什么类型、产出什么、顺序/幂等/错误映射/不得做什么 | 接缝另一侧的实现文件本身：`core/src/work-readiness.ts`（02）、`apps/daemon/src/assembly/intent/{ingress,receipt-store}.ts` 与 `assembly/api/assemble.ts`（17）、`ReadOnlyLedger`/`openLedgerMaintenance` 实现（03）、`panel/src/views.ts` 的 `dayKeyOf` 原址退役（13）、`core/src/secrets.ts` 退役（02） |

排除类别（不逐条展开）：`.git`、`node_modules`、`dist` 与其他生成物、第三方源文件、`bun.lock`（只作版本证据）。本包**没有** guards、模板、迁移脚本与 fixture 目录。

### 0.2 计数法（可复算）

```text
find packages/contract -type f -not -path '*/node_modules/*' | wc -l   → 21
find packages/contract/src -type f | wc -l                             → 15
find packages/contract/test -type f | wc -l                            → 2
其余 4 件 = cases.json / CASES.md / package.json / tsconfig.json
find packages/contract/src -name '*.ts' -print0 | xargs -0 cat | wc -l  → 1434（src 15 件行数合计）
```

| 分类 | 现有 | 目标新增 | 目标拆分 | 目标退役 | 目标合计 |
|---|---|---|---|---|---|
| 生产 `src` | 15 | 25 | 1（`src/index.ts` 内容重组，路径保留、不另计件） | 1 个符号（`PACKAGE_NAME`） | 40 |
| 契约数据/文档性配置 | 2（`cases.json`、`CASES.md`） | 5（`exchange/index.json` + 4 个 `*.schema.json`） | 0 | 0 | 7 |
| 构建/包配置 | 2（`package.json`、`tsconfig.json`） | 3（`tsconfig.build.json`、`README.md`、`LICENSE`，全部**条件**） | 0 | 0 | 5 |
| 测试 | 2 | 10 | 0 | 0 | 12 |
| **合计** | **21** | **43** | **1** | **0（文件）/1（符号）** | **64** |

v0.3 与 v0.2 的差额逐项可复算：`src` 22 → 23 = 补 `daykey.ts`（80-§9.4 M1 指定“`dayKeyOf`/`DAY_MS` → contract”，v0.2 漏列）；**v0.6 再 +1**：`ports/resources.ts`（`TS-PORT-RES-01 ResourceAccountant`，80-§6.4 末）→ `src` 24；**v0.8 再 +1**：`ports/binding.ts`（`TS-PORT-BIND-01 PlatformBindingPort`，80-§6.9 指名）→ `src` 25；交换工件 4 → 5 = 移出 `diagnostic`（76 的 14 个**非规则**诊断码在本包无 TS 落点；通用 `DEF-DIAG-01` 基形未在 80 定稿——rules 面 80 已定 `location`/`expected`/`actual`，G-19）+ 补入 `summary-sidecar`（跨 git 边界、authoring 已在 `schemas/report.ts`）与 `classified-error`（80-§5.7/§9.4 对外 HTTP 错误体，`FailureClass` 现已落地）；测试 4 → 8 → **9** → **10** = 补 `test/ports/{errors,intent,resources,binding}.test.ts`、`test/daykey.test.ts`、`test/secrets.test.ts`（脱敏迁移的冻结验收口径）。**`src/ports` 20 个文件 ≠ 55 个端口**：11 个新文件里 10 个装 §6 端口，共 **53** 个新端口类型 = spec 4 + authority 7 + record 6 + work 13 + resources 1 + capability 6 + effects 6 + binding 1 + lifecycle 8 + intent 1；加现有 `executor.ts`（`TS-PORT-EXEC-01`）与 `notifier.ts`（`TS-PORT-NOTI-01`）= **55**；`secret.ts` 装 80-§11.2.1 的供给面（**不计入** 55）。

“条件”= 只在 79-§6.5 的 `contract` 分发形态定稿（发 `src` 或切 `dist`）后才成立；未定前不创建，也不得以占位文件冒充。

### 0.3 处置标签（沿用 81-§四）

`现有` / `库级-未接` / `目标-保留` / `目标-拆分` / `目标-新增` / `目标-替换` / `目标-退役` / `仅测试` / `未证`。本包**没有**“仅演示”件。

### 0.4 本包的不可协商约束（逐条来自上位，不在本文重定义）

1. **层 0**：`boundary-rules.mjs:95` 记 `contract: 0`，入边 **15** 条（`boot/daemon/panel/api/prompt/studio-tools/company/store/adapters/core/gateway/localplatform/matrix/yt/taiga`；除 `contract` 自身与 `dsh-bridge` 外）。因此 `contract` **不得 import 任何第一方包**；唯一运行期依赖是 `zod`（`package.json:15-17`，实锁 `zod@4.6.7`，见 `bun.lock:497`）。
2. **纯面**：零 `node:fs`/`node:http`/`child_process`/`execa`/`hono`，零时钟、零随机、零 `fetch`（79-§3.6）。本包现状 `src` 已满足；目标新增件必须继续满足。`src/secrets.ts` 迁入后仍是纯函数（`RegExp` + 字符串），**不是**例外。
3. **公共工件与 TS 端口分区**（81-§3.3）：76/77 的交换工件是**数据**，且只收“76/77 有字段表、且有 authoring 来源的公共结构”；`records/**` 的 50 类 payload 与 `ports/**` 的端口签名**不是**工件。台账行本身是投影，但 `summary-sidecar` 与 `classified-error` 跨进程/跨语言边界（公司 git 目录、对外 HTTP），其形状须外部可读，故列入工件（§4.5 逐件给理由）。
4. **两个事实源禁止**（D75-08）：冻结 JSON Schema 只能由受限 zod authoring **离线生成并冻结**；禁止 `z.fromJSONSchema()` 反推，禁止运行时重新生成权威工件，禁止引入 Ajv 作运行时第二事实源。**本轮不冻结任何工件**：冻结本身是独立提案 + 制作人终审（76-§10 第 5 条、76-§12“不冻结 schema”），本附录只登记“将来必须冻结什么、缺什么前置”。
5. **版本**：`PORT_VERSION` 维持 `v0`、全端口 `experimental`（80-§0.3/D3）；新增 **53** 个端口类型（55 − 现有 2）**在 v0 下允许**，升 `v1` 须批示（80-§12.2）。`ports/secret.ts` 的 `SecretProvider` 是供给面接口，**不计入** 55 个端口；`src/secrets.ts` 是**运行期导出**（三个纯函数），进 `PORT_VERSION` 的封版闸。
6. **尺寸**：目录直下 ≤25 件、文件 ≤600 行；本包单件设计上限更紧——`ports/**`/`records/**` ≤300 行、`schemas/**` ≤260 行、`exchange/*.schema.json` ≤400 行、测试 ≤260 行。本包无 `lineBaseline` 条目（`boundary-rules.mjs` 的基线表不含 `contract`），故**不得**新增基线。

---

## 一、现有件全集（21）

| F-ID | 路径 | 行数 | 分类 | 处置 | 一句话现状 |
|---|---|---|---|---|---|
| F-contract-index | `src/index.ts` | 30 | src | 目标-拆分（门面保留） | 包唯一公开面：常量 + 5 组 `export *`；目标改六段分区再导出 |
| F-contract-cases-schema | `src/cases-schema.ts` | 35 | src | 目标-保留 | cases.json 清单的 zod 校验（`z.object` 例外） |
| F-contract-runner | `src/runner.ts` | 126 | src | 目标-保留（内部修正） | 语言无关契约 runner：匹配语义 + 域分发 |
| F-contract-ports-index | `src/ports/index.ts` | 16 | src | 目标-保留（扩展再导出） | `PORT_VERSION`/`PortGrade` + 8 组再导出（目标 17 组） |
| F-contract-kernel | `src/ports/kernel.ts` | 102 | src | 目标-保留（增补 `Result`） | 共享标量、计量、`StreamEvent`、`TaskBrief`、`Result`、`ClassifiedError` 两轴 |
| F-contract-executor | `src/ports/executor.ts` | 60 | src | 目标-保留 | `ExecutorAdapter` 六原语与能力声明 |
| F-contract-platform | `src/ports/platform.ts` | 217 | src | 目标-保留 | `FlowPlatform` 七能力 + 活动词表 |
| F-contract-models | `src/ports/models.ts` | 53 | src | 目标-保留 | 三档模型、角色映射、计费轨词表 |
| F-contract-invoke | `src/ports/invoke.ts` | 40 | src | 目标-保留 | 唤起源端口与意图联合 |
| F-contract-company | `src/ports/company.ts` | 251 | src | 目标-保留 | 目录只读快照、工作流/成本/组群/钩子声明 |
| F-contract-gateway | `src/ports/gateway.ts` | 30 | src | 目标-保留 | 网关动作白名单 + wkey 主张 |
| F-contract-notifier | `src/ports/notifier.ts` | 32 | src | 目标-保留 | 通知出口 + 投递回执 + 对外 AI 工具名 |
| F-contract-schema-events | `src/schemas/events.ts` | 206 | src | 目标-保留 | 台账行 schema、事件名双通道、ULID、四桶 |
| F-contract-schema-report | `src/schemas/report.ts` | 147 | src | 目标-保留 | REPORT 骨架提取 + summary sidecar |
| F-contract-schema-errors | `src/schemas/errors.ts` | 89 | src | 目标-保留 | 两轴错误运行时投影（`FailureClass`/`category`）+ 唯一构造器 `classified(input)` + executor 码 |
| F-contract-cases-json | `cases.json` | 1696 | 数据 | 目标-保留（只增不删） | v1 清单：53 条、7 域 |
| F-contract-cases-md | `CASES.md` | 165 | 文档性契约 | 目标-保留（校正漂移） | 契约格式唯一规范 |
| F-contract-package | `package.json` | 18 | 构建/包配置 | 目标-保留（条件改 exports/files） | 私有 workspace 包，`main`/`exports` 指 `src` |
| F-contract-tsconfig | `tsconfig.json` | 5 | 构建/包配置 | 目标-保留 | 继承根 base，只 `include` `src/**` |
| F-contract-test-contract | `test/contract.test.ts` | 36 | 测试 | 目标-保留 | meta 域自证 + 防恒反证 |
| F-contract-test-schemas | `test/schemas.test.ts` | 353 | 测试 | 目标-保留（后续按子域分流） | evt/rpt 契约 + 6 组词表/schema 单测 |

合计 21 件；`src` 15 件行数合计 **1434** 行（复算命令见 §0.2；v0.1/v0.2 稿写 1624 是误加）；最大件 `ports/company.ts` 251 行（<600）。`boundary-rules.mjs` 的 `lineBaseline` 不含本包，故无“现基线/阈值”可对照，也不得新增基线。

---

## 二、目标件全集（43 新增 + 1 拆分）

### 2.1 生产 `src`（新增 25）

| F-ID | 目标路径 | 上位 | 承载对象 |
|---|---|---|---|
| F-contract-port-spec | `src/ports/spec.ts` | 80-§6.1 | `TS-PORT-SPEC-01`（`SpecRegistry`）/`TS-PORT-SPEC-02`（`DefinitionLoader`）/`TS-PORT-SPEC-03`（`PackageImporter`）、`TS-PORT-RULE-01`（`RuleEvaluator`）；规则诊断全套 `Diagnostic`（判别联合：`location`/`expected?`/`actual?`，`limitsApplied` 仅 `phase='limit'` 必填）/`DiagnosticPhase`(8)/`RuleDiagnosticCode`(**18**)/`RuleLimits`（七项）/`RuleLimitTightening`/`RuleOutcome`/`TypecheckReceipt`/`RuleProfileRef` |
| F-contract-port-authority | `src/ports/authority.ts` | 80-§6.2 | `TS-PORT-AUTH-01`（权威需求源）/`TS-PORT-AUTH-02`（候选端点目录）/`TS-PORT-AUTH-03`（权域激活）/`TS-PORT-AUTH-04`（写者租约）/`TS-PORT-AUTH-05`（授权签发）/`TS-PORT-AUTH-06`（凭据目录）/`TS-PORT-AUTH-07`（失能） |
| F-contract-port-record | `src/ports/record.ts` | 80-§6.3 | `TS-PORT-REC-01`（写，收 `RecordWriteInput{envelope, payload}`）/`TS-PORT-REC-02`（读，含 `payload(ref)`）/`TS-PORT-REC-03`（投影，含 `ProjectionSource.since/asOf`）/`TS-PORT-REC-04`（事务）/`TS-PORT-REC-05`（更正）/`TS-PORT-REC-06`（对账）；`RecordPayload{ref, bytes, mediaType}`/`RecordWriteInput`/`AppendOptions`/`AppendReceipt`/`RecordQuery`/`RecordPage`/`TableProjectionName`（17）/`TargetTableProjectionName`/`ProjectionName`/`TxScope`/`TxHandle`/`TxReceipt`/`CorrectionRequest`/`ReconcileBatch` |
| F-contract-port-work | `src/ports/work.ts` | 80-§6.4 | `TS-PORT-CMD-01`（命令受理）、`TS-PORT-DEC-01`（决定）、`TS-PORT-WORK-01`（意图受理）/`TS-PORT-WORK-02`（合同）/`TS-PORT-WORK-03`（开工判断）/`TS-PORT-WORK-04`（执行计划）/`TS-PORT-WORK-05`（工作状态机）/`TS-PORT-WORK-06`（异常）/`TS-PORT-WORK-07`（结清）/`TS-PORT-WORK-08`（资格）/`TS-PORT-WORK-09`（风险分类）/`TS-PORT-WORK-10`（分派）/`TS-PORT-WORK-11`（出工）；`WorkState`/`IntakeOutcome`/`ReadinessRequest`/`RecReadinessJudgment`/`TransitionExpectation` 等 |
| F-contract-port-resources | `src/ports/resources.ts` | 80-§6.4 末 `TS-PORT-RES-01`（**未实现**，见 §4.1 `port-resources`） | `TS-PORT-RES-01`（`ResourceAccountant`）：`baseline(req: ResourceBaselineRequest)`/`gap(subject)` 两个**只读**方法；`ResourceBaselineRequest`/`ResourceBaseline`/`ResourceEntry`/`ResourceLimit`（`finite`/`unbounded`/`unknown` 三态）/`ResourceGap`（四 kind）。**不承载** `reserve`/`actual`/`release`、不承载任何 `Qid` 回执、不新增 `REC-*` |
| F-contract-port-capability | `src/ports/capability.ts` | 80-§6.5 | `TS-PORT-CAP-01`（解析）/`TS-PORT-CAP-02`（安装）/`TS-PORT-CAP-03`（挂载）/`TS-PORT-CAP-04`（探测）/`TS-PORT-CAP-05`（激活）/`TS-PORT-CAP-06`（退役）（`TS-PORT-EXEC-01` 留 `executor.ts`） |
| F-contract-port-effects | `src/ports/effects.ts` | 80-§4.3.1、§6.6 | `TS-PORT-EFF-01`（效应网关）、`TS-PORT-EVD-01`（证据收割）/`TS-PORT-EVD-02`（验收判断）、`TS-PORT-MEM-01`（记忆）、`TS-PORT-OBS-01`（观察投影）、`TS-PORT-MIG-01`（迁移）；`EffectRequest`/`EffectOutcome`/`EffectError`/`EffectDescriptor`/`EffectTarget`/`EffectAction`/`ControlEffectAction`/`EffectOrigin`/`EffectPartialItem`/`EffectCredential`/`EffectCredentialBroker`/`EvidencePackage`/`AcceptanceVerdict`/`MemoryDisposition`/`ObservationState`/`MigrationPlan`/`MigrationActionKind`/`MigrationReceipt`。**不含**绑定面（BIND-01 与 `BindingProfile`/`StateMapping`/`ExportScope`/`ExportBundle`/`ExitPlan` 已移 `binding.ts`） |
| F-contract-port-binding | `src/ports/binding.ts` | 80-§6.6 `TS-PORT-BIND-01`、80-§6.9（**指名路径**） | `TS-PORT-BIND-01`（`PlatformBindingPort`）：`describe`/`mapState`/`exportBundle`/`exitPlan`；`BindingFactStatus`(4)/`BindingProfile`(20 字段)/`StateMapping`/`ExportScope`/`ExportBundle`/`ExitPlan`。**无** EFF/EVD/MEM/OBS/MIG 职责，**无**写口；实现不在本包（通用宿主 `apps/daemon/src/assembly/platform/binding.ts`） |
| F-contract-port-lifecycle | `src/ports/lifecycle.ts` | 80-§6.7 | `TS-PORT-EVD-03`（价值评估）/`TS-PORT-EVD-04`（返工）/`TS-PORT-EVD-05`（重开）、`TS-PORT-OBL-01`（义务）、`TS-PORT-LIFE-01`（身份生命周期）/`TS-PORT-LIFE-02`（移交归档）/`TS-PORT-LIFE-03`（接续）/`TS-PORT-LIFE-04`（任命） |
| F-contract-port-intent | `src/ports/intent.ts` | 80-§6.6 TS-PORT-API-01、§12.3（**指定路径，不得另起**） | `IntentSubmissionPort`、`IntentReceipt`、`IntentKey`/`IntentSubmitResult`、`WebhookIntentPayload`、`WebhookIntentBody` |
| F-contract-port-secret | `src/ports/secret.ts` | 80-§11.2.1、§12.3（**指定路径**）；78-BIND-WS-01/SEC | `SecretKind`(5)/`SecretUse`(6)/`ValueProvider`(4 判别)/`SubjectScope`/`SecretCatalogEntry`(**7 字段**：`secretId`/`kind`/`subjectScope`/`allowedUses`/`valueProvider`/`rotationRef`/`revocationRef`)/`SecretProvider`/`SecretMaterial`/`KnownSecretSet`（`secretIds`/`state` 三值/`missingSecretIds`/`redactKnown`/`redact`/`find`；**供给面接口，不属 §6 的 55 个端口**；`MatrixBotLoginSecret`/`MatrixHrRegisterSecret` 不在此文件） |
| F-contract-rec-scalars | `src/records/scalars.ts` | 80-§4.1/§4.3.1/§4.5/§5.11；76-§1.2–1.5/§1.2.1；77-§11.1 | TS-SCALAR-02…10（含 `FailureClass` 14 值）、`ScalarFamily`/`ExtensionValueShape`/`EnumRef`/`DurationString`/`RetentionRule`/`KnowledgeScope`/`DissentPosition`/`ObservationBasis`/`Signature`；`DecimalArithmetic` 的实现归 `core/src/decimal.ts`，不在本包；**不含 `Diagnostic`**（落 `ports/spec.ts`，理由见 §4.1 `port-spec` 的"`Diagnostic` 家在本文件"条） |
| F-contract-rec-refs | `src/records/refs.ts` | 80-§4.3/§4.3.1 | TS-REF-01…06、TS-PROV-01、`Signature`/`KnowledgeScope`/`DissentPosition`/`ObservationBasis`/`EffectAction`/`EffectOrigin`/`EffectCredential` |
| F-contract-rec-envelope | `src/records/envelope.ts` | 80-§4.2；76-`REC-ENV-01` | `RecordEnvelope<TPayload>` 与六条构造约束；`payloadRef: ArtifactRef`（复用 TS-REF-05，**不造 `PayloadRef`**） |
| F-contract-rec-validate | `src/records/validate.ts` | 80-§4.4（TS-REC-01） | `validateRecord`、`ValidationIssue`/`ValidationOutcome` |
| F-contract-rec-defrecords | `src/records/def-records.ts` | 80-§4.8 | `RecMigration`（76-§8.3）、`RecBindingLossReport`（76-§8.4）、`REC-CASE-01/02`（76-§9.2/9.5） |
| F-contract-rec-payload-command | `src/records/payloads/command.ts` | 77-§2 | `REC-CMD-01`/`REC-CMD-02`、`REC-DEC-01`、`REC-RCP-01`、`REC-COR-01`、`REC-EVT-01`/`REC-EVT-02`/`REC-EVT-03`（8 类） |
| F-contract-rec-payload-authority | `src/records/payloads/authority.ts` | 77-§3 | REC-AUTH-01…08（8 类） |
| F-contract-rec-payload-work | `src/records/payloads/work.ts` | 77-§4–§5 | REC-WORK-01…11（11 类） |
| F-contract-rec-payload-evidence | `src/records/payloads/evidence.ts` | 77-§6 | REC-EVD-01…08、REC-EXC-01/02（10 类） |
| F-contract-rec-payload-obligation | `src/records/payloads/obligation.ts` | 77-§7–§8 | REC-OBL-01…03、REC-MEM-01…03（6 类） |
| F-contract-rec-payload-lifecycle | `src/records/payloads/lifecycle.ts` | 77-§9–§10 | REC-OBS-01/02、REC-LIFE-01…05（7 类） |
| F-contract-canon | `src/canon.ts` | 80-§4.5；76-§1.5.1 | `Canonicalizer`（`studio-next/jcs@1`）类型面 |
| F-contract-secrets | `src/secrets.ts` | 79-§3.6、80-§11.2-3（**迁入**，语义不改） | `redactOutbound`/`redactKnownSecrets`/`findSecretShaped`、`SecretShapeFinding`、`BEARER_RE`/`ASSIGNMENT_RE`/`LONG_TOKEN_RE`、`REDACT_MARK`、`MIN_KNOWN_LENGTH` |
| F-contract-daykey | `src/daykey.ts` | 80-§9.4 M1（"`dayKeyOf`/`DAY_MS` → `contract`"，且"公司本地日必须显式传时区/偏移参数"）；TS-SCALAR-03 **只管记录 `Timestamp`，日键不是 `Timestamp`**，不套用 | `DAY_MS`/`dayKeyOf`（UTC 日键，自 `panel/src/views.ts:313/321` 迁入，行为不变）+ `companyDayKey(ms, zone)`/`CompanyZone`（**名为本附录所拟**，80 只要求"显式传时区/偏移参数"未给名，见 G-26） |

50 类 `REC-*` 的分布：8+8+11+10+6+7 = 50，与 77-§0.5 表逐条对齐（`REC-MIG-01`/`REC-LOSS-01` 不在其中，见 80-§4.8）。

端口计数（v0.8 复核）：**53 个新建 + 现有 `executor.ts`（`TS-PORT-EXEC-01`） + `notifier.ts`（`TS-PORT-NOTI-01`） = 55**，与 `grep -c '^#### TS-PORT-'` 的 55 个端口小节一致。53 = spec 4 + authority 7 + record 6 + work 13 + **resources 1**（`TS-PORT-RES-01`）+ capability 6 + effects **6**（EFF-01/EVD-01/EVD-02/MEM-01/OBS-01/MIG-01）+ **binding 1**（`TS-PORT-BIND-01`，v0.8 从 `effects.ts` 拆出）+ lifecycle 8 + **intent 1**（`TS-PORT-API-01`）。`ports/secret.ts` 的 `SecretProvider` 不在这 55 之内（它在 80-§11.2.1，不在 §6 端口表）；`ports/spec.ts` 里的规则诊断族是**类型**不是端口。所以 `src/ports` 是 **11 个新文件**而端口是 53 个新类型（BIND-01 只换文件家、端口总数不变）。

### 2.2 契约数据（新增 5）

| F-ID | 目标路径 | 上位 | 类别 |
|---|---|---|---|
| F-contract-exchange-index | `exchange/index.json` | 75-§4.1/4.2、D75-08；字段面来自 76-§4.2 | 维护元数据（**不是**工件，不进 `artifacts` 清单） |
| F-contract-exchange-record-envelope | `exchange/schema/record-envelope.schema.json` | 76-§4.2 `REC-ENV-01`、75-§4.1-2、80-§4.2 | 规范面（公共结构；缺 authoring） |
| F-contract-exchange-cases-manifest | `exchange/schema/cases-manifest.schema.json` | 25-§二、02-F2-14、75-§4.1-4；作者源 `src/cases-schema.ts` | 规范面（公共结构；authoring 已有） |
| F-contract-exchange-summary-sidecar | `exchange/schema/summary-sidecar.schema.json` | 17-§3 末行、02-F1-15；作者源 `src/schemas/report.ts` | 跨边界文件形状（公司 git 目录内的 `<单号>.summary.json`；authoring 已有） |
| F-contract-exchange-classified-error | `exchange/schema/classified-error.schema.json` | 80-§5.7 错误体 `{error:{failure,category,subcause[,detail]}, traceId}`，外层另有 `fieldPath?`/`retryAfter?`/`reason?`（三个可选键，§9.4）；失败词表 77-§11.1 | 对外线格式（`:8788` 的外部契约；`FailureClass` 已落 `records/scalars.ts`） |

v0.3 的四处取舍（v0.2 曾把 `summary-sidecar`/`classified-error` 一并移出、并纳入 `diagnostic`）：
- **`summary-sidecar` 纳入**：它不是台账投影，而是**写进公司 git 目录的文件**；读者包括非 TS 工具与人读流程（`relay-resume.ts:169` 只是其一）。跨进程/跨语言边界 + authoring 已在 `schemas/report.ts` ⇒ 符合“同一结构的机读一面”。
- **`classified-error` 纳入**：对外 API 的错误体是外部调用方按 `failure`/`category`/`subcause` 分支的线格式；`FailureClass`（14 值）与 `Err` 可达的 6 个 `category` 在 v0.3 已有 TS 落点（G-16 关闭）。
- **`diagnostic` 不纳入**：76-§1.7 的 14 个非规则诊断码（`E-SYN-*`/`E-EXT-*`/`W-EXT-*`/`E-PKG-*`/`W-PKG-*`/`E-REF-*`/`W-REF-*`）在本包**没有 TS 承载**，rules 面的诊断已由 80-§6.1 定稿（`location`/`expected`/`actual` 与 `Diagnostic` 判别联合），剩下的是通用 `DEF-DIAG-01` 基形未定稿（G-19）；此时冻结等于把未定结构钉成标准。
- **`ledger-event` 不纳入**：`EventRecord` 是投影（80-§4.6），对外 API 不暴露原始台账行，没有非 TS 读者。若将来出现外部对账工具，须先回写 75/76 立“运行时交换”一类（G-20）。

`records`（50 类 payload）与 `rule-profile` 的 schema 同属 75-§4.1-2/-3 要求的公共工件，但 77 的字段表尚未转成 authoring、体积也超出本包单文件预算，**本附录不设计**、不占目标计数，见 G-21。

### 2.3 构建/包配置（条件新增 3）与测试（新增 10）

| F-ID | 目标路径 | 处置 | 条件 |
|---|---|---|---|
| F-contract-tsconfig-build | `packages/contract/tsconfig.build.json` | 目标-新增（条件） | 仅当 79-§6.5 判定 `contract` 切 `dist` |
| F-contract-readme | `packages/contract/README.md` | 目标-新增（条件） | 同上；纳入 `files` |
| F-contract-license | `packages/contract/LICENSE` | 目标-新增（条件） | 同上；**许可文本待制作人定**（79-§6.5 事实：17 包全无 `license` 字段） |
| F-contract-test-runner-matcher | `test/runner/matcher.test.ts` | 目标-新增 | 无 |
| F-contract-test-runner-manifest | `test/runner/manifest.test.ts` | 目标-新增 | 无 |
| F-contract-test-exchange-drift | `test/exchange/drift.test.ts` | 目标-新增 | 随 `exchange/` 落地 |
| F-contract-test-records-validate | `test/records/validate.test.ts` | 目标-新增 | 随 `records/validate.ts` 落地 |
| F-contract-test-ports-errors | `test/ports/errors.test.ts` | 目标-新增 | 随 `schemas/errors.ts` 两轴改造落地 |
| F-contract-test-ports-intent | `test/ports/intent.test.ts` | 目标-新增 | 随 `ports/intent.ts` + §4.10 语义落地（纯函数级：键还原、status 判据、TTL 三态） |
| F-contract-test-ports-resources | `test/ports/resources.test.ts` | 目标-新增 | 随 `ports/resources.ts` 落地（类型面 + `gap` 缺口规则：缺省未知、有限额度缺 `reserved`/`consumed` 必给缺口、无 `remaining`） |
| F-contract-test-ports-binding | `test/ports/binding.test.ts` | 目标-新增 | 随 `ports/binding.ts` 落地（类型面 + 映射分支：`BindingProfile` 20 字段齐、`StateMapping` 无 `mapped`、未映射合法值走 `Ok(unverified)`、`ExitPlan` 九段） |
| F-contract-test-daykey | `test/daykey.test.ts` | 目标-新增 | 随 `src/daykey.ts` 落地 |
| F-contract-test-secrets | `test/secrets.test.ts` | 目标-新增 | 迁移验收：`core/test/secrets.test.ts` 断言逐条复制（见 §4.4） |

### 2.4 目标树与目录预算

```text
packages/contract/
├── cases.json                     CASES.md 同级；只增不删
├── CASES.md
├── package.json
├── tsconfig.json
├── tsconfig.build.json            [条件]
├── README.md                      [条件]
├── LICENSE                        [条件]
├── exchange/
│   ├── index.json
│   └── schema/                    4 个 *.schema.json（record-envelope / cases-manifest / summary-sidecar / classified-error）
├── src/
│   ├── index.ts                   门面（六段分区再导出）
│   ├── cases-schema.ts
│   ├── runner.ts
│   ├── canon.ts
│   ├── secrets.ts                 迁入的纯函数（脱敏/形状识别）
│   ├── daykey.ts                  UTC 日键 + 公司本地日键（自 panel 迁入）
│   ├── ports/                     20（现有 9 + 新增 11）
│   ├── schemas/                   3（现有）
│   └── records/                   5 + payloads/（6）
└── test/
    ├── contract.test.ts
    ├── schemas.test.ts
    ├── daykey.test.ts
    ├── secrets.test.ts
    ├── runner/ (2)
    ├── exchange/ (1)
    ├── records/ (1)
    └── ports/ (4)
```

| 目录 | 目标直下件数 | 上限 | 余量 |
|---|---|---|---|
| `packages/contract`（根） | 7（含 3 条件件） | 25 | 18 |
| `src` | 6（index/cases-schema/runner/canon/secrets/daykey） | 25 | 19 |
| `src/ports` | 20 | 25 | 5 |
| `src/schemas` | 3 | 25 | 22 |
| `src/records` | 5（+1 子目录） | 25 | 20 |
| `src/records/payloads` | 6 | 25 | 19 |
| `exchange` | 1（+1 子目录） | 25 | 24 |
| `exchange/schema` | 4 | 25 | 21 |
| `test` | 4（+4 子目录） | 25 | 21 |

`src` 的域平面概念只适用于 daemon，本包不涉；新增件除 `canon`/`secrets`/`daykey` 外全部落在子目录，`src` 直下从 3 增到 6。

---

## 三、现有件逐条

### F-contract-index

- 路径/处置：`src/index.ts`；**目标-拆分**（路径保留，内容重组为“分区再导出 + 门面注释”）。上位 80-§0.3/§12.2（包公开面与 `PORT_VERSION` 纪律）。
- 职责：包唯一公开面；让 **15** 个入边包只经 `@studio-next/contract` 取符号。非职责：不定义任何语义（语义在 76/77）、不做运行时装配、不读数据文件。
- 内部（现有）：`PACKAGE_NAME`（`:18`，骨架期占位）；`export *` 五组（`:21` ports、`:24` cases-schema、`:25` runner、`:28-30` schemas）。无函数、无状态。
- 目标内部：改为**六段显式分区**再导出——① 规范绑定（`records/**`：scalars/refs/envelope/validate/def-records/payloads）② 实现端口（`ports/**`，含 `intent`/`secret`）③ 实现冻结词表与 schema（`schemas/**`）④ 契约格式与 runner（`cases-schema`/`runner`）⑤ 规范化（`canon`）⑥ 安全与时间工具（`secrets`/`daykey`）；文件头写明“哪一段是 76/77 投影、哪一段是本实现实验面、哪一段是纯函数工具”。`PACKAGE_NAME` **目标-退役**（本次全仓 grep：除本文件定义外零引用）。`Result<T,E>`/`ClassifiedError` 只在 `ports/kernel.ts` 定义一次，门面只再导出。
- 导出/依赖：现状零 import（纯再导出）；目标仍零第一方 import。禁止在此处 re-export 数据文件（JSON 不进运行期 import，79-§4.2）。
- IO/注入：N/A——无 IO、无注入点（纯类型、常量与纯函数再导出）。
- 状态/并发：N/A——模块无状态；再导出顺序不影响语义，但**不得**在两处 `export *` 同名符号（否则该名字在 `import` 处报错）。需防重名三处：`ValidationIssue`（迁到 `records/validate.ts` 后门面只出一处）、`PlatformBinding`（`ports/company.ts` 的快照字段，与 `ports/binding.ts` 的 `PlatformBindingPort` 不同名）、`WebhookIntentPayload`（本包公共类型与 daemon 私有同名异义，见 G-24）。
- 错误/秘密：N/A——不抛错、不承载秘密（`secrets.ts` 的导出是脱敏工具，不含秘密值）。
- 测试/证据：无直接用例；证据=根 `tsc --noEmit` 覆盖 `src/**`（`tsconfig.json:4`）+ 15 个入边包的 typecheck。不证明任何端口已实现。
- 规模/迁移：目标 ≤60 行；迁移顺序：先补再导出（不删旧），再全仓确认 `PACKAGE_NAME` 零消费，最后删常量；删除属破坏性变更，但处 `v0` 且零消费（80-§0.3 允许破坏性改动）。

### F-contract-cases-schema

- 路径/处置：`src/cases-schema.ts`；**目标-保留**（内部抽共享期望类型）。上位 25-§二、02-F2-14、`CASES.md` v1。
- 职责：作为 `cases.json` 的**authoring 校验**——清单结构与单条用例形状先过契约。非职责：不执行用例、不解析 subject、不保证 id 全局唯一（runner 也不保证，见 F-contract-runner 缺口）。
- 内部（现有）：私有 `ExpectedSchema`（`:9-14`，`strictObject` 的 `out`|`err` 联合 + `refine` 恰一键）；`CaseEntrySchema`（`:17-26`，`z.object` 非 strict）；`CaseManifestSchema`（`:29-32`，`version: z.literal(1)`、`cases.min(1)`）；派生类型 `CaseEntry`/`CaseManifest`（`:34-35`）。
- 字段约束（现状，逐条实读）：`id` 正则 `^C-[a-z]+-\d{3}$`；`domain`/`docs`/`title` 非空；`input` 为 `unknown`；`expected` 恰含 `out` 或 `err`；`err.category` 为非空字符串、`err.subcause` 可选。
- 导出/依赖：仅依赖 `zod`。导出 4 个符号；本次全仓 grep：`CaseEntrySchema`/`CaseManifestSchema`/`CaseEntry`/`CaseManifest` **在包外零引用**，仅经 `index.ts` 暴露。
- IO/注入：N/A——纯校验；不做文件读取（数据由调用方 import）。
- 状态/并发：N/A——纯函数式 `safeParse`，无状态、无幂等键。
- 错误/秘密：返回 `ZodError`（`safeParse`），**不转** `category×subcause`；`runCases` 才把清单不合法转成抛错。schema 不承载秘密字段，但 `input` 为 `unknown` 可装任意内容——因此 schema 无法阻止语料内含秘密（靠审查，非机制）。
- 测试/证据：间接覆盖——`test/contract.test.ts`（3 条 meta 全绿）、`test/schemas.test.ts`（12 条 evt/rpt）、`company`/`core`/`yt`/`localplatform` 的域套件各自过 `runCases`。缺：**无**“清单不合法被拒”的正向反证（目标补于 F-contract-test-runner-manifest）。
- 规模/迁移：现 35 行；目标 ≤60 行。迁移：把 `ExpectedSchema` 的推断类型导出为 `Expected` 供 `runner.ts` 复用（消掉 `runner.ts` 内联的形状重复，见下条），不改字段。

### F-contract-runner

- 路径/处置：`src/runner.ts`；**目标-保留**（两处内部修正，语义不变者不动）。上位 25-§二、`CASES.md`“匹配语义（语言无关）”。
- 职责：加载已过 schema 的清单、按 `domain` 分发 subject、按冻结语义比对、汇总 `RunReport`。非职责：不注册 subject（由实现包注入）、不判“语义是否正确”、不读写文件、不测实现细节。
- 内部（现有）：`SubjectFn`（`:12`）、`RunReport`（`:14-18`）、私有 `ThrownShape`（`:21`）、`NULL_SENTINEL='__NULL__'`（`:23`）、`isPlainObject`（`:25`）、`matchValue`（`:30-72`）、`runOne`（`:74-99`）、`runCases`（`:102-126`）。
- 输入输出：`runCases(rawManifest: unknown, subjects: Record<string, SubjectFn>, opts?: {domains?: string[]}): Promise<RunReport>`；`RunReport = {total, passed, failed:[{id, reason}]}`。`opts.domains` 缺省=跑全部域；给定时**未列出的域被静默跳过**（`total` 随之下调）。
- 匹配语义（现状实读）：对象=期望键子集（实际多余键不关心）；数组=等长 + **贪心**无序匹配（`:41-53`，逐个期望在未消费实际元素中找首个匹配）；字符串 `__NULL__`=断言实际为 `null`；原语 `===`；期望数值为 `NaN` 时判红。
- 导出/依赖：`SubjectFn`/`RunReport`/`runCases`；仅依赖 `./cases-schema.ts`（连带 `zod`）。
- IO/注入：N/A——无 IO；时间/ID/随机均由 subject 自己承担，runner 不注入（因此同一语料在两次运行间的差异只能来自 subject，这是可复放的前提）。
- 状态/并发：无模块状态；`runCases` 按清单顺序**串行** await（`:113-124`），不做并发——保证失败顺序稳定，也意味着慢 subject 会线性放大耗时。
- 错误/秘密：清单不合法时 `throw new Error(...)`（`:107-110`，含 zod issues 的 JSON 串）；subject 抛错按 `category`（必比）与 `subcause`（给出才比）宽松匹配（`:89-96`）。`reason` 拼接期望/实际值（`JSON.stringify`）——若 subject 返回含秘密的对象，失败原因会进入测试输出（测试面可接受，但**不得**把该 reason 写进台账/事件）。
- 测试/证据：`test/contract.test.ts` 两条（meta 3 绿；篡改 `C-meta-001` 期望必红）；`test/schemas.test.ts` 一条（篡改 `C-evt-003` 的 category 必红）。证明：对象/数组/原语/哨兵/err 通道在**已覆盖形状**上成立，且 runner 非恒真。**不证明**：无序双射在存在歧义时成立（见下），重复 id、未知域、清单不合法路径。
- 规模/迁移：现 126 行；目标 ≤180 行。三处目标修正（均不改已冻结匹配语义，而是让它名副其实）：
  1. **数组匹配**（现状缺陷，未证于测试）：贪心配对不是“无序双射”。反例——期望 `[{a:1},{a:1,b:2}]`、实际 `[{a:1,b:2},{a:1}]`：贪心让第一个期望吞掉 `actual[0]`，第二个期望再也没有候选，判红；而完美匹配存在（期望1→actual[1]、期望2→actual[0]）。改法：以“期望元素 × 实际元素”的可行图求最大匹配（增广路），仍保持“每个期望恰配一个实际、长度相等”。**这是语义修复，不是放宽**：修后只会把假红变真绿，不会把真红变绿；须同时补 `test/runner/matcher.test.ts` 的歧义用例。
  2. **清单不合法**改用 `configInvalid('cases/manifest-invalid', …)`（`schemas/errors.ts:54`），与 80-§5.7“构造期非法 → `ClassifiedError`”一致；现抛裸 `Error` 属形态混用。
  3. **域覆盖可见性**：`opts.domains` 命中清单中不存在的域时应报错（或返回 `{unknownDomains}`），避免“拼错域名 = 零用例全绿”。此改动影响现有 7 个调用点（均传单/双域，域名均存在），拟以“新增可选结果字段 + 未知域记入 `failed`”实现，不破坏 `failed` 语义。
- 非目标：不新增匹配算子（正则/类型断言）、不支持 `file` 指针（见 F-contract-cases-md 漂移）。

### F-contract-ports-index

- 路径/处置：`src/ports/index.ts`；**目标-保留**（再导出面扩展）。上位 80-§0.3、25-§一.3。
- 职责：端口层的命名空间入口；声明端口协议版本与分级类型。非职责：不定义端口本身、不给任何端口标注等级（现状 16 行中 `PortGrade` 无使用点）。
- 内部：`PORT_VERSION='v0'`（`:6`）、`PortGrade`（`:7`）、8 组 `export *`（`:9-16`）。
- 目标内部：追加 **10** 组再导出（`spec/authority/record/work/resources/capability/effects/lifecycle/intent/secret`），并在此文件头声明“全部端口 `experimental`；按 80-§6 逐端口等级由 80 维护；`resources.ts` 只读、`secret.ts` 是供给面，两者都不计入 §6 之外的口径（`secret.ts` 不属 55 端口）”。**不加**“端口注册表常量”（那会变成第二份端口清单）。
- 导出/依赖：仅 `./*.ts` 同层；零外依赖。
- IO/注入/状态/错误：N/A（纯再导出，无运行时逻辑）。
- 测试/证据：无直接用例；证据=根 `tsc`。缺口：无机械判据保证“80 的端口清单 ⊆ 本文件导出集”（80-§12.3 只给人工对应）。**不回写 80**，因为端口全集归 80；如需机械对账，应由 82 的追溯项承担。
- 规模/迁移：现 16 行；目标 ≤40 行（10 组新增再导出）。迁移时机在 `ports/*.ts` 新增件落地后同一提交；`PORT_VERSION` 保持 `v0`。

### F-contract-kernel

- 路径/处置：`src/ports/kernel.ts`；**目标-保留（增补 `Result` 与两轴错误）**。上位 80-§4.1（TS-SCALAR-01/09/10）、§5.7（错误两轴）、§6.5（TS-PORT-EXEC-01 的输入）、25-§二。
- 职责：全端口共享的标量、计量形状、执行体归一化输入/输出、**结果通道**（`Result`）与**两轴错误**（`failure`×`category`：前者处置、后者观测）。非职责：不承载台账列（`EventRecord` 在 `schemas/events.ts`）、不承载记录信封（目标在 `records/`）、不承载 14 类失败的词表本体（在 `records/scalars.ts` 的 `FailureClass`）、不做错误处置策略（归 `core`/`schemas/errors.ts`）。
- 内部（逐项实读）：`CompanySlug`/`TicketId`/`PersonId`/`AttemptNo`（`:7-10`，裸 `string`/`number`，不做 brand，80-§5.9）；`Money{usd:number}`（`:13`，**只内存/旧记录**，见下）；`TokenCounts{input,output,cache_read?,cache_creation?,cached?}`（`:21-28`，`cached` 为**只读别名**，写侧禁用）；`DurationMs`；`ResultStats{cost,tokens,duration,turns,model?}`（`:32-44`）；`StreamEvent` 四型联合（`:47-64`，`turn_end.errorCode?: string` 的值域在 `schemas/errors.ts`）；`TaskBrief`（`:67-82`，含 `credentials?: Record<string,string>` 与 `resume?`；目标补可选 `planRef?: VersionRef<string>`，见 F-contract-executor）；`ErrorCategory` 11 值（`:85-96`）；`ClassifiedError{category,subcause,detail?}`（`:98-102`）。
- 目标形状（三处增补，全部来自 80-§5.7/§4.1）：
  - **`Result<T, E>`**：`{ ok: true; value: T } | { ok: false; error: E }`。全仓现状无定义（80 每个端口签名都用它）；放本文件与 `ClassifiedError` 同处，避免各端口私造互不兼容的 `{ok:boolean}`。
  - **`ClassifiedError = { failure: FailureClass; category: ErrorCategory; subcause: string; detail?: string }`**：两轴。`FailureClass`（14 值 snake_case）定义在 `records/scalars.ts`（TS-SCALAR-10），本文件只 `import type`——**不复制字段表、不做第二定义**。`failure` 是**处置轴**（重试、断路、对账、升级、判等一律读它），`category` 是**观测轴**（只用于事件 note 与告警分桶，**不驱动业务处置**），两者正交且都必填（80-§5.7“两轴一个载体，职责不得互换”）。
  - **`Money` 的边界**：`Money{usd:number}` 只用于**内存与旧记录**；凡是跨进程/入库/进记录的新金额一律用 `records/scalars.ts` 的 `DecimalString` 与公共金额别名 `MoneyAmount{amount: DecimalString; currency: string}`（80-§4.1 的 `Money` 语义）。台账 `EventRecord.cost_usd:number` 是历史列，不因本文件而改（G-03）。
- 关键纪律（文件内已冻结，本文不复述定义）：`TokenCounts.cached` 只读；`TaskBrief.credentials` **不得**进日志/事件/账面/prompt；`errorCode` 是 `subcause` 的受冻结值域而非第三路由键；**`Err` 可达的 `category` 只有 6 个**——`CONFIG_INVALID`/`EVOLVE_REJECT`/`EXTERNAL_REJECT`/`STALL`/`MERGE_CONFLICT`/`NO_LANE`；`GATE_FAIL`/`WORKER_DEAD`/`QA_BACK`/`DISPATCH_FAIL`/`LLM_FAIL` 是内部熔断域，构造器拒收（80-§5.7）。
- 导出/依赖：现状零 import（纯类型文件）；目标只有一处 **`import type { FailureClass } from '../records/scalars.ts'`**（同包、层内，不违层 0）。被 14 个包按需引用（本次 grep：`TicketId` 9 处、`ClassifiedError` 13 处、`TaskBrief` 8 处等）。
- IO/注入：N/A——纯类型。注入纪律（时间/ID/随机）不在此文件，由实现方端口参数承担（79-§3.5）。
- 状态/并发：N/A——类型无状态。语义上的“一次尝试序号 `AttemptNo` 从 1 起”属实现约定，本文件不校验。
- 错误/秘密：`detail` 可能被拼进 `configInvalid` 的 message，调用方须保证不含秘密与绝对路径（80-§5.8）。**`ErrorCategory` 的 11 值不删**：内部熔断域仍要用它记事件，只是不能出现在端口 `Err` 里。
- 测试/证据：无 kernel 专属用例。间接：`test/schemas.test.ts` 校验 `ClassifiedErrorSchema` 与 `ERROR_CATEGORIES` 的 11 值/穷尽护栏；目标 `test/ports/errors.test.ts` 断言“两轴必填 + 6 个可达 category + 5 个内部 category 拒收”。**不证明**：任何实现按 `failure` 处置正确（`category`/`subcause` 只作观测分桶与稳定细目）。
- 规模/迁移：现 102 行；目标 ≤130 行（`Result`/`MoneyAmount` 注释 + `ClassifiedError` 第 4 字段）。迁移分两步且都必须与消费方同批：① 加 `Result` 与 `FailureClass` 的 type import（纯增，无破坏）；② `ClassifiedError` 加 `failure` 必填——这是**破坏性**改动，需先让 13 处构造点改走 `schemas/errors.ts` 的 `classified({failure, subcause, detail?, category?})` 构造器（该构造器见 §三 `F-contract-schema-errors` 的"目标内部"），不得各处手填字符串。`Money` 不改（G-03）。若 80 后续要求 `TaskBrief` 承载合同引用，须先改 80。

### F-contract-executor

- 路径/处置：`src/ports/executor.ts`；**目标-保留**。上位 80-§6.5 TS-PORT-EXEC-01（“已有”）、25-§3.1、18-§一。
- 职责：声明执行体的六原语与能力位，使核心零 `if executor`。非职责：不实现探测/启动/流解析（归 `packages/adapters`）、不判资格与授权（80-§6.9：“能力不等于资格”）。
- 内部：`ExecutorFamily`（`:8`，四值）；`ExecutorCapabilities`（`:10-16`）；`DetectResult{name,version,ok,gaps[]}`（`:18-24`）；`Handle{executor,sessionId,pid,executorSessionId?}`（`:26-36`）；`BudgetEstimate`（`:38-41`）；`ExecutorAdapter`（`:43-52`，`detect/estimate/launch/stream/resultStats/kill`）；`ExecutorRegistration`（`:55-59`）。`TaskBrief` 本体在 `./kernel.ts`（本文件只引）。
- 目标形状（80-§6.5“已冻结 + 只补两槽”）：`TaskBrief.planRef?: VersionRef<string>`（指向 `REC-WORK-05`（执行计划锁）的版本，可选=旧调用方不填仍合法）；`Handle.fence?: FenceToken`（该执行体当前持有的写者围栏；`fence` 由 `TS-PORT-AUTH-04 WriterLeasePort` 发，**不是**治理代次 `generation`）。除此之外**不加方法、不加能力位**：`ExecutorAdapter` 六原语已冻结，`TS-PORT-CAP-01`–`TS-PORT-CAP-06` 六端口的状态机不可合并进来（80-§6.5）。
- 导出/依赖：仅 `./kernel.ts` 类型（目标另加 `./authority.ts` 的 `FenceToken` 与 `records/scalars.ts` 的 `VersionRef`，均 type-only）。消费者：`adapters` 四实现 + `daemon` 装配（本次 grep：`Handle`/`TaskBrief` 组合引用 2 处）。
- IO/注入：**端口本身零 IO**；六个方法按签名承诺 IO 由实现承担（子进程、流、kill 宽限）。`stream` 返回 `AsyncIterable`（拉取式，允许背压）；`kill(h, graceMs)` 把超时变成显式参数而非实现内部常量。
- 状态/并发：`Handle` 是唯一句柄；同一 Handle 上并发 `stream` 两次的语义**未定义**（文件未写、80 未写）→ 目标：在文件头写明“单 Handle 单 stream；重复调用为实现缺陷”，不新增字段。`fence` 只读快照：执行体不得自行改写围栏，换 fence 只能经 `WriterLeasePort`。
- 错误/秘密：`DetectResult.gaps` 明报不达标项（“绝不静默降级”）；`TaskBrief.credentials` 的无条件透传与红名单纪律写在 `kernel.ts`，本文件不重复；`turn_end.errorCode` 值域在 `schemas/errors.ts:77-89`。`engine/fakes.ts` 的假执行体只许 demo/测试/崩溃注入，**不得**作为端口实现证据（80-§6.5）。
- 测试/证据：本包**零**用例；`exe` 域在 `CASES.md` 列为“端口冒烟 case”，`cases.json` 中 **0 条**（见 §8.1 G-06）。实现证据在 `packages/adapters/test/*`（不证明端口契约，只证明实现）。
- 规模/迁移：现 60 行；目标 ≤70 行（两个可选槽 + 注释）。`planRef`/`fence` 都是**可选**字段，落盘时先加类型、后由适配器按需填；若 80 后续给 `ExecutorAdapter` 补方法（如 `attest()`），先改 80。

### F-contract-platform

- 路径/处置：`src/ports/platform.ts`；**目标-保留**（仅加命名消歧注释）。上位 78-§9.1（七能力与共同禁令）、25-§3.2、80-§6.6/§6.9。
- 职责：协作平台七能力的**能力端口**（issues/comments/fields/kb/activity/links/guards）+ 活动归一词表。非职责：**不是**绑定档案（`TS-PORT-BIND-01` 另立）、不解释游标、不做平台选择。
- 内部：`IssueRecord`（`:13-25`，`state:string`、`updated:string`）；`IssueQuery`（`:27-33`，`lane?` 映射）；`IssueCreate`（`:35-53`，`initialState` 解析序=显式 > `typeInbox[type]` > `states[0]` > 平台默认）；`Comment`/`SignedBody`（`:55-69`）；`FieldSchema`/`FieldProvisionMap`（`:71-102`，含 `typeInbox`/`typeFlows`/`entities`）；`KbHit`（`:104-108`）；`PlatformActivity`（`:110-126`，`kind:string` + `actor?`）；`PLATFORM_ACTIVITY_KINDS` 六值（`:137-144`）+ `isPlatformActivityKind`（`:150-152`）；`ActivityPage`（`:154-158`，`nextCursor:string|null`）；`LinkType`/`GuardRule`/`PlatformRole`（`:160-177`）；`FlowPlatform`（`:179-217`，`guards.read?` 可选）。
- 语义边界（本文只登记，不重写）：平台“完成/已关闭”永不映射 `STAT-E`；评论不承载结构化决定；guard 缺失 ≠ 支持（`read?` 缺位须明报，不得当空清单）；游标不是时间。
- 导出/依赖：仅 `./kernel.ts`。消费者：三平台实现（yt/taiga/localplatform）、`daemon/engine/tools/gated-platform.ts`、`assembly/platform/wire.ts`、`panel`、`studio-tools`（本次 grep：`FlowPlatform` 9 处、`FieldProvisionMap` 6 处）。
- IO/注入：端口零 IO；实现注入 `fetch`（各包自有 `FetchLike`，**不在本包**，见 G-04）。
- 状态/并发：`activity.since(cursor)` 的游标是不透明串、`null`=从头；`fields.provision` 在 104 提案后被要求收敛幂等（`C-plat-009/010`），但**幂等语义由实现承担**，本文件只在注释里指向 docs。
- 错误/秘密：`SignedBody.author` 由 gateway 组装，实现不得接受调用方自带 author/signature（80-§5.8 的 `gated-platform.ts` 纪律）。`actor` 是平台账号名，工号翻译归框架侧（不在端口）。
- 测试/证据：`plat` 域 10 条 × 2 实现（yt/localplatform）只断言 `category` 全等；`PLATFORM_ACTIVITY_KINDS` 正反例在 `test/schemas.test.ts:107-139`。**不证明**：第三实现（taiga）一致（`CASES.md:110-112` 挂账）、`subcause` 跨实现一致（明示放行）、provision 并发收敛机制（归 taiga 单测）。
- 规模/迁移：现 217 行；目标 ≤260 行。迁移：只加“`PlatformBinding` 名在本文件指快照声明、绑定端口见 `ports/binding.ts` 的 `PlatformBindingPort`”一行注释，**不重命名**现有类型（80-§6.9 明令不得改名冒充）。

### F-contract-models

- 路径/处置：`src/ports/models.ts`；**目标-保留**。上位 80-§6.8（`ModelCatalog` 保留）、25-§3.3、17-§4。
- 职责：模型三档/角色映射/价目表协议 + 计费轨词表。非职责：不做价格折算（实现在 `core/pricing.ts`）、不读 `models.yaml`。
- 内部：`PriceEntry`（`:7-11`，每百万 token 美元）；`ModelTier`（`:13-18`）；`RoleName = ... | (string & {})`（`:21`，开放集，故意不做穷尽）；`ModelCatalog{tiers,resolve,estimateCost}`（`:23-27`）；`BILLING_TRACKS=['api','coding_plan']`（`:45`）+ `BillingTrack`（`:48`）+ `isBillingTrack`（`:51-53`）。
- 导出/依赖：仅 `./kernel.ts` 类型 + 自身常量。消费者：`core/pricing.ts`（运行期引用 `BILLING_TRACKS`）、`core/test/models.test.ts`、`daemon` 选位面。
- IO/注入：端口零 IO；`estimateCost` 是纯计算签名（实现必须纯：同 token 同 tier 同价）。价目表来源（YAML/表）不在本文件。
- 状态/并发：`tiers()` 返回数组——**未标 `readonly`**（与 80-§5.6“端口返回数组一律 readonly”不一致）→ 目标：补 `readonly ModelTier[]`（纯类型收紧，零运行期影响；消费方若就地 `sort()` 会编译红，故列入迁移检查）。
- 错误/秘密：`resolve(role)` 对未知角色未定义行为（抛错 or 兜底）——文件未写、80 未写 → 目标：在文件头写明“未知角色由实现抛 `CONFIG_INVALID/model-role-unknown`”，不加新类型。价格表改动走批示（文件头已声明）。
- 测试/证据：`core/test/models.test.ts`、`core/test/pricing.test.ts` 覆盖实现；本包 `test/schemas.test.ts:174-207` 只测两条轨词表正反例。不证明任何真实价格正确。
- 规模/迁移：现 53 行；目标 ≤60 行。`readonly` 收紧属编译期变更，需与 `core/daemon` 同步提交（否则根 typecheck 红）。

### F-contract-invoke

- 路径/处置：`src/ports/invoke.ts`；**目标-保留**。上位 80-§6.8（`InvokeSource` 保留）、§6.6（外部入口的来源白名单）、25-§3.4、22。
- 职责：源的注册/启动/停止协议与意图联合；源只产意图。非职责：不做去重（主循环按 `intentKeyOf` = `[source,kind,company, ticket ?? dedupKey]` 幂等，`core/src/decide.ts:319-322`）、不派工、不判优先级。
- 内部：`InvokeIntent.kind` 8 值（`:18`，含 `escalate`/`data-change`）；`company`/`ticket?`/`payload?`/`source`/`priority?`/`dedupKey?`；`InvokeSource{name,start(emit),stop}`（`:29-33`）；`SourceManifest{name,kind,configSchema:string}`（`:35-40`）。
- 目标形状（两处，均为加类型不加端口）：① `WebhookIntentBody{requestKind: RequestKind; body: unknown; subjectRef?: SubjectRef; requestedAt: Timestamp; correlation?: { externalRef?: string; parentRef?: Qid } }` 落本文件（`InvokeIntent` 在家，避免 `invoke ↔ intent` 环；`correlation` 的**对象形状照 80-§6.6**，不是裸字符串），`InvokeIntent.payload` 在 `kind:'webhook'` 时用它；② `WebhookIntentPayload`（80-§6.6 的完整后端形状：`source/kind/requestKind/dedupKey/company/ticket?/subjectRef?/requestedAt/body/correlation?`）落 `ports/intent.ts`，**不在本文件重复**。
- 两条来源校验路（不可混）：`InvokeSource` 是**产出**意图的注册源（`start/stop`）；`'external-api'` 是**接收**意图的入口，**不是** `InvokeSource`、不进 `SourceRegistry`，校验只经 `ServeConfig.external.allowedSources`（缺省 `['external-api']`，不在表内 ⇒ `rejected_forbidden`/403）。不得为它造 stub 源（80-§6.6/§3.3）。
- 导出/依赖：仅 `./kernel.ts`（目标另加 `records/refs.ts` 的 `SubjectRef`、`records/scalars.ts` 的 `Timestamp`/`RequestKind` 的 type import；`RequestKind` 家在 `ports/intent.ts` 时改为从那里取，二者只允许一个方向）。消费者：`daemon/engine/sources.ts`、`assembly/sources/*`、`matrix`、`boot`（本次 grep：`InvokeIntent` 多处、`InvokeSource` 2 处）。
- IO/注入：`start(emit)` 是**推**模型（emit 回调），源自持游标/定时器；端口不规定注入时钟，实现必须自带可注入时钟（79-§3.5）。`stop()` 无超时参数 → 停机序列的时限由 `assembly` 承担（80-§3.6）。
- 状态/并发：`start`/`stop` 的幂等性、重复 `start` 的语义**未写**（现状依赖实现）→ 目标：文件头补“`start` 幂等；`stop` 后不得再 emit；变更为实现缺陷”，不改形状。
- 错误/秘密：`configSchema: string` 只是**引用名**，不携带可执行校验 → 无法机械保证源配置被校验（G-07）。`payload: unknown` 可含 PII/秘密，端口不做脱敏（责任在源与落账口）；webhook 的 `body` 按**不可信输入**对待（80-§11.6）。
- 测试/证据：`inv` 域在 `CASES.md` 列“端口冒烟”，`cases.json` **0 条**；实现证据在 `daemon/test/engine/wake/*`、`sources.test.ts`。不证明源隔离/崩溃恢复。
- 规模/迁移：现 40 行；目标 ≤65 行（`WebhookIntentBody` + 注释）。`configSchema` 的弱化引用属 80/25 的既成设计，本文不改，登记为 G-07。

### F-contract-company

- 路径/处置：`src/ports/company.ts`；**目标-保留**（命名消歧）。上位 80-§6.9、25-§3.5、04-§二/§九；68/70 的对象语义由 76 承载。
- 职责：公司目录的**只读快照视图**与目录装载结果类型。非职责：**不是** 76 的“公司定义包”（`DEF-PKG-*`），不含修订/信封/摘要；不做写入（唯一写入者=daemon）；不做校验（实现在 `packages/company`）。
- 内部：`PlatformBinding{platform,fieldOverrides?}`（`:9-14`，**快照字段**，与 `PlatformBindingPort` 不同物）；`DeptRelation`/`DeptNode`（`:16-31`）；`PersonRef{id,name,login,level,dept,status?,role?,skills?,costCaps?}`（`:33-66`）；`ScheduledJob`（`:69-79`）；工作流族 `WorkflowStateDecl/EdgeDecl/AnchorsDecl/TypeDecl/TicketWorkflows`（`:85-128`）；`COST_GUARD_ROUTES` 四档 + `CostGuardTier`/`CostGuardConfig`（`:133-155`）；`OrgGroupDecl`（`:163-174`）；`OrgHooksDecl`（`:183-197`）；`CompanySnapshot`（`:199-240`，含 `workflows?/hooks?/groups?/knownForeignStates?/stateMapping?/costGuard?`）；`DirectoryIssue{file,line,rule,fix}`（`:243-248`）；`MountResult`（`:251`）。
- 导出/依赖：`./kernel.ts` + `./models.ts`。消费者最广（本次 grep：`CompanySnapshot` 12 处、`PersonRef` 多处）。快照是 company→daemon→prompt 的传递体，字段扩展一律“可选 + 缺省=现状行为”。
- IO/注入：端口零 IO；`MountResult` 的 `issues.line` 要求实现侧有行号（YAML `LineCounter`），本文件只声明形状。
- 状态/并发：快照是**不可变读视图**（数组/记录字段未标 `readonly`，与 80-§5.6 有落差）→ 目标：对跨层传递的集合补 `readonly`（`departments`/`people`/`jobs`/`groups`）。无幂等键、无版本号 → 快照本身无法判断“是否同一修订”（G-08）。
- 错误/秘密：`MountResult.ok:false` 是**拒绝启动**的显式通道（不静默降级）；`DirectoryIssue.fix` 是人读修法，不得含本机绝对路径（04-§九 + 80-§5.8）。
- 测试/证据：`dir` 域 3 条（经 company 的 `dirSubject`，`strictFiles:false`）+ company 的 `multifile/workflows/reports/deps` 单测。不证明多文件全目录校验已契约化（`CASES.md:72-86` 明示留给 `dir2` 域）。
- 规模/迁移：现 251 行；目标 ≤300 行（只加 `readonly` 与命名注释）。迁移次序：先加 `readonly`（编译期，消费方同步）→ 再补命名注释；**不得**把 `CompanySnapshot` 改成信封（80-§12.6 第 5/6 条同款禁令）。

### F-contract-gateway

- 路径/处置：`src/ports/gateway.ts`；**目标-保留**。上位 25-§4.1、17-§7、24-§二、80-§6.6（`EffectGateway` 是包装，不在本文件）。
- 职责：网关动作白名单 + wkey 主张形状。非职责：不签发/不验签（`packages/gateway`）、不含状态推进（“agent 永远拿不到改状态通道”）。
- 内部：`GATEWAY_ACTIONS` 六值（`:13-20`）+ `GatewayAction`（`:22`）；`WkeyClaims{ticket,scope,ttl,nonce}`（`:25-30`，注释写明“按单签发、关单吊销、fail-closed”）。
- 导出/依赖：仅 `./kernel.ts`。消费者：`gateway` 4 文件 + `studio-tools`（工具集同表纪律，本次 grep `GATEWAY_ACTIONS` 7 处）。
- IO/注入：N/A（纯类型/常量）。`ttl` 是字符串——格式（时长 or 绝对时刻）未在端口声明，实现自定（G-09）。
- 状态/并发：`nonce` 的生成/一次性校验不在端口；wkey 生命周期（签发→吊销）由 `engine/worker-key.ts` 承担（80-§6.8 `WorkerKeyDeps`）。
- 错误/秘密：wkey 原文**永不**入库/入日志/入事件（80-§5.8）。`WkeyClaims` 是主张形状，不是凭据本体。
- 测试/证据：`gw` 域 0 条（`CASES.md` 列“各泳道冒烟”，未兑现）；实现证据=`packages/gateway/test/*`。不证明越权路径。
- 规模/迁移：现 30 行；目标不改。加动词走批示 + `studio-tools` 同批（文件头已声明）。

### F-contract-notifier

- 路径/处置：`src/ports/notifier.ts`；**目标-保留（增补信封与回执）**。上位 80-§6.6 TS-PORT-NOTI-01（“已有端口/局部实现”）、§6.6 广播面、25-§4.2、21、24-§三。
- 职责：通知出口形状 + 投递回执 + 对外 AI 工具名冻结集。非职责：不做投递（`matrix` 三面）、不做去重（订阅方按 `id`/`dedupKey` 去重）、不是安全边界（`from` 仅展示）。
- 内部：`Notification{kind,title,body,from?,links?}`（`:6-13`，**原形不动**）；`Notifier.send(channel,message)`（`:15-17`）；`EXTERNAL_AI_TOOLS` 十名（`:19-30`）+ `ExternalAiTool`。
- 目标形状（三件，80-§6.6）：① `NotificationEnvelope{ id: string; message: Notification; targets: readonly string[]; dedupKey?: string }`——`id` 是**传输/去重 ID**（非 qid）；80 原文写作 `notificationId`，定稿口径为 `id`（回写缺口 G-23，未回写前不得两处并存）；② `NotifySendReceipt{ status: 'sent'|'failed'|'skipped'; attempts: number; detail?: string }`，`Notifier.send(channel, n): Result<NotifySendReceipt>`——`failed`/`skipped` 都在 `Ok` 里（投递失败不是程序错误），只有**构造期**非法（频道不认识、targets 空）才 `Err(rejected_precondition)`；③ `NotifyBroadcastFace{ broadcast(env: NotificationEnvelope): Promise<NotifySendReport> }` 与 `Notifier` **分开**（单播/广播是两条能力，不合并成一个 `send` 重载）；`NotifySendReport{sent: string[]; failed: {target: string; reason: string}[]}`。
- 导出/依赖：零 import（`Notification`/`NotificationEnvelope` 自持）。消费者：`daemon/assembly/notify/*`、`matrix`、`api`（`panel/external` 目标迁入）、`boot`。
- IO/注入：端口零 IO；`send` 的网络重试/超时**未在签名**（无 `AbortSignal`/超时参数）→ 通知不可取消、不可限期，由实现自担（G-10，与 80-§8.4 的落差保留登记）。`attempts` 由实现计，端口不规定退避策略。
- 状态/并发：投递**不保证 exactly-once**（至少一次）；重复 `send` 由订阅方按 `NotificationEnvelope.id`（或缺省时的 `dedupKey`，二者都缺则按内容哈希）去重——这一点必须写进文件头，不能靠“通知不是事实源”免掉。`NotifySendReport` 是汇总，不是事务回执。
- 错误/秘密：`body` 可能被拼进外部推送——**必须**由调用方先消毒（80-§5.8/§11.6）；端口不挡。`detail`/`reason` 不得含秘密或绝对路径。`EXTERNAL_AI_TOOLS` 的 `request.create`/`task.create` 只落单不派工。
- 测试/证据：`mdl`/`gw` 域 0 条；实现证据=`matrix/test/*`。目标 `test/ports/notifier.test.ts` **不新增**（并入 `test/ports/errors.test.ts` 的 `Result` 形状断言），不证明外部可达性。
- 规模/迁移：现 32 行；目标 ≤80 行。`Notification` 保原形是硬约束（调用方 6 处），`NotificationEnvelope` 是**外加**包装而非替换；`EXTERNAL_AI_TOOLS` 的消费方随 `:8788` 迁到 `api`（80-§9.4），本文件位置不变。

### F-contract-schema-events

- 路径/处置：`src/schemas/events.ts`；**目标-保留**（`ValidationIssue/Outcome` 移出，见 F-contract-rec-validate）。上位 17-§3、02-F2-02/F2-04、80-§4.6（`EventRecord` 是**投影**，不是 `REC-EVT-01`）。
- 职责：台账行的记录级契约——入库前/回填（F2-13）/JSONL 再生（F2-11）逐条校验的标尺。非职责：不写库（`store/ledger.ts:appendEvent` 是唯一写口）、不裁剪业务语义、不替代 77 的 `REC-EVT-01`。
- 内部：`ValidationIssue`/`ValidationOutcome`（`:36-42`，目标迁出）；`ULID_PATTERN`（`:47`）+ `UlidSchema`（`:54-57`，26 字符 Crockford 大写 + 首字符 ≤`'7'`）；`EVENT_NAMES` 30 名（`:62-96`）；`EVENT_PREFIX_FAMILIES` 三族（`:99`）+ `EVENT_NAME_PREFIX_PATTERN`（`:105`）+ `EventNameSchema` 双通道（`:108-111`）+ `isEventName`（`:114-116`）；`TokenBucketsSchema`（`:126-135`，`strictObject` 四桶可选 + 至少一键）；`EventRecordSchema`（`:140-173`，`strictObject` 17 列）；`toIssues`（`:178-183`）；`validateEventRecord`（`:189-193`）；`evtSubject`（`:200-206`）。
- 列集（实读，与 17-§3 表逐列一致）：`id/ts/company/issue/event/actor/attempt/level/dept/correlation_id?/causation_id?/tokens/cost_usd?/duration_ms?/size?/payload_hash?/note?`。**无 `pid`**（02-F2-02 列了 `pid`，17-§3 未列；文件头已记“疑点已上报”，至今未决，G-01）。
- 导出/依赖：`. /errors.ts` + `zod`。运行期消费者：`store/ledger.ts`（`appendEvent` 前置闸，`:437`）、`daemon/evolve/gray.ts:420`、`cutover.ts:301`；校验函数 `validateEventRecord` 是写口的一部分，**不是**建议。
- IO/注入：零 IO；`id` 的时间戳与 `ts` 的一致性交叉校验**不在本文件**（注释明示“归 store 层”），故两份时间不一致时本 schema 放行。
- 状态/并发：纯函数；`evtSubject` 抛 `configInvalid('evt/invalid:<首个 issue path>')`（`:205`），因此 `subcause` 依赖 zod 的 issue 顺序（zod 版本升级可能改变顺序→`subcause` 漂移，属**可观测接口**，G-11）。
- 错误/秘密：`evtSubject` 的 `detail` 会带出字段路径+消息（不含值，`toIssues` 只取 path/message）——**不泄露字段值**，这一点必须保持；`note` 是自由字符串，可被写入秘密，靠写入方纪律（80-§11.6）。
- 测试/证据：`evt` 域 7 条（C-evt-001…007）+ `test/schemas.test.ts` 的 ULID/四桶/列集/事件名正反例。不证明：ULID 与 `ts` 一致、30 名之外的 `GW_*` 语义、`SCHEMA_EVOLVE` 与 82 追溯的对应。
- 规模/迁移：现 206 行；目标 ≤230 行。迁移：`ValidationIssue/ValidationOutcome` 定义搬到 `records/validate.ts`，本文件改为 `import type`；因包外消费者只经 `index.ts`（`store` 取 `type ValidationIssue`），在 `index.ts` 保留一处再导出即可零破坏。

### F-contract-schema-report

- 路径/处置：`src/schemas/report.ts`；**目标-保留**。上位 17-§3 末行（收割成功契约 + sidecar）、02-F1-15、复查报告 B4。
- 职责：从 markdown REPORT 抽骨架并校验必填节；校验 `<单号>.summary.json` sidecar。非职责：不判断“结论是否正确”、不读盘、不写 sidecar、不替收割判完成（四要件在 engine）。
- 内部：`REPORT_REQUIRED_SECTIONS=['结论','改动','验证']`（`:23`，**拟稿待批**）；`ReportSkeletonView`（`:26-29`）；`ReportSkeletonSchema`（`:32-43`，作用在**提取视图**上）；`extractReportSkeleton`（`:49-75`，`# ` 取标题、`## ` 开节、`###` 归上节、标题前引导文丢弃）；`SummarySidecarSchema`（`:78-100`，`schema:'summary/v1'`、`conclusion` 非空、`changed_files` 可空数组、`rejection_reason?`、`sentinel?{job,run_at,nonce:len64}`）；`validateReportDocument`（`:112-120`）、`validateSummarySidecar`（`:123-127`）、`rptSubject`（`:134-147`）。
- 导出/依赖：`./errors.ts`（`configInvalid`）+ `./events.ts`（**只取两个类型**，目标改为取 `records/validate.ts`）+ `zod`。运行期消费者：`daemon/engine/intents/relay-resume.ts:169`（`validateSummarySidecar`）。
- IO/注入：零 IO；输入是 markdown 字符串（调用方读盘后传入），保证可重放。
- 状态/并发：纯函数。**同名二级节**后写覆盖前写（`flush` 直接赋值）且无诊断——静默丢失，违反“无诊断的静默忽略即缺陷”的精神（76-§1.7 同原则；G-12）。`\r\n` 已处理（`:50`）。
- 错误/秘密：`rptSubject` 只回传首条 issue 的 path/message；REPORT 正文**不进**错误消息（不泄露）。`sentinel.nonce` 只校验长度 64，**不校验十六进制**，而 `C-rpt-005` 的标题写作“非 64 位十六进制”（标题过度声明，G-13）。
- 测试/证据：`rpt` 域 5 条（含 sentinel 正/负）+ `test/schemas.test.ts:291-336`（必填节/额外节/空节/无标题/非字符串/`###` 归属/CRLF/未知键）。不证明：sidecar 与 REPORT 内容一致、sentinel 与实际岗单一致（归 jobs 收割 R1）。
- 规模/迁移：现 147 行；目标 ≤180 行（加同名节诊断则需新 issue path，属行为变更，须走 `CASES.md` 批示 → G-12 只登记不建议擅改）。

### F-contract-schema-errors

- 路径/处置：`src/schemas/errors.ts`；**目标-保留（从“一级分类投影”扩为“两轴投影 + 构造器”）**。上位 17-§9、25-§二（`kernel.ClassifiedError`）、80-§5.7（两轴、缺省映射、6 个可达 `category`、HTTP 错误体）。
- 职责：把两个枚举投影为**运行时数组 + zod schema**（`ErrorCategory` 11 值、`FailureClass` 14 值）；提供**唯一**错误构造器 `classified(input: ClassifyInput)`（按 `failure` 填缺省 `category`、拒收 5 个内部 category、拒收不合规的显式覆盖）；保留统一抛错通道 `configInvalid`；冻结 executor 域 `errorCode` 值域。非职责：**枚举本体**在 `ports/kernel.ts`（`ErrorCategory`/`ClassifiedError`）与 `records/scalars.ts`（`FailureClass`），本文件不得重复定义；不决定处置策略（重试/断路/对账在 `core`，读 `failure` 不读 `category`）。
- 内部（现有）：`ERROR_CATEGORIES` 11 值 + `satisfies readonly ErrorCategory[]`（`:17-29`）；编译期穷尽护栏 `ErrorCategoryProjectionComplete` + `ERROR_CATEGORIES_COMPLETE`（`:35-38`）；`ErrorCategorySchema`（`:41`）；`ClassifiedErrorSchema`（`:44-48`，`strictObject`、`subcause.min(1)`）；`configInvalid(subcause, detail?)`（`:54-60`，返回 `never`、挂 `category/subcause/detail`）；`EXECUTOR_ERROR_CODES` 3 码（`:77-81`）+ 类型 + `isExecutorErrorCode`（`:87-89`）。
- 目标内部（四件新增，全部按 80-§5.7 原文）：
  - `FAILURE_CLASSES`（14 值，77 原样下划线）：`rejected_precondition`/`rejected_authority`/`rejected_forbidden`/`rejected_state`/`rejected_version`/`rejected_idempotency`/`unsupported`/`unavailable`/`unverified`/`partial`/`conflict`/`timeout`/`cancelled`/`degraded` + `FailureClassSchema` + 编译期穷尽护栏 `FAILURE_CLASSES_COMPLETE`。
  - `ClassifiedErrorSchema` 改为 4 字段（`failure` 必填、`category` 必填、`subcause` 必填、`detail?`），**不再接受 3 字段旧形态**。
  - `FAILURE_CATEGORY_DEFAULT`（缺省映射，唯一表）：`rejected_precondition→CONFIG_INVALID`；`rejected_authority`/`rejected_forbidden`/`rejected_state`/`rejected_idempotency→EXTERNAL_REJECT`；`rejected_version`/`unsupported`/`unverified→EVOLVE_REJECT`；`unavailable`/`partial`/`timeout`/`cancelled`/`degraded→STALL`；`conflict→EXTERNAL_REJECT`。
  - `classified(input: ClassifyInput): ClassifiedError`——**唯一合法构造器**（80-§5.7 的对象入参；v0.6 及以前的 `classifiedError(failure, subcause, opts?)` 三位置参数形态**作废**）。`ClassifyInput{failure: FailureClass; subcause: string; detail?: string; category?: ErrReachableCategory}`，`ErrReachableCategory` **恰 6 个**：`CONFIG_INVALID`/`EVOLVE_REJECT`/`EXTERNAL_REJECT`/`STALL`/`MERGE_CONFLICT`/`NO_LANE`。省略 `category` 是**常态**，按上表填缺省；显式覆盖**只许三处**——合并域 `MERGE_CONFLICT`、泳道域 `NO_LANE`、HTTP 路由不存在 `EXTERNAL_REJECT`，别处给值即拒。非法输入（`failure` 不在 77 词表 / `category` 不在 6 值 / 给了不允许的覆盖）⇒ **构造期抛 `configInvalid('classified-input-invalid')`**，不返 `Err`、不静默改成某个缺省继续跑；5 个内部 category 因此由类型与构造期校验双重拒收，不再有单独的 `errors/internal-category` 分支。`ClassifyInput`/`ErrReachableCategory` 是纯类型，与构造器同落本文件。
- 落点说明（v0.8 定案，v0.9 与 80 对齐）：`classified` 与 `configInvalid` **同在 `src/schemas/errors.ts`**（**同件、两个独立导出、互不包壳**——`classified()` 不转调 `configInvalid`，`configInvalid` 也不经 `classified()`）；`ClassifiedError`/`ErrorCategory` 留 `ports/kernel.ts`（`ClassifiedError:98`）；**不建 `contract/src/errors.ts`**。80-§5.7 现文与 D29 已同此口径（G-30 关闭）。本卷因此**不新增文件**——`src` 25 件的计数与 F-ID 均不受影响。
- 导出/依赖：`../ports/kernel.ts`（type `ClassifiedError`/`ErrorCategory`）+ `../records/scalars.ts`（type `FailureClass`）+ `zod`。`configInvalid` 与 `classified` 是本包**最高频运行期导出**（`configInvalid` 现状 25 个文件引用），是“错误形态统一”的实际支点。
- IO/注入：零 IO、零状态、零时钟。
- 状态/并发：N/A（纯构造）。
- 错误/秘密：`configInvalid` 的 message = `CONFIG_INVALID/<subcause>：<detail>`，固定 `failure:'rejected_precondition'`；`detail` 若含秘密或绝对路径即泄露（80-§5.8）——本文件不做扫描，责任在调用方。`Error.name` 未设置（保持默认 `'Error'`）；下游若按 `name` 分支会失败（G-14，影响面小，只登记）。`not_found` **不是** `FailureClass`：纯查询不存在回 `undefined`/`Ok([])`；库文件缺失是 `unavailable + STALL + db-missing`。schema 版本不符是 `rejected_version + EVOLVE_REJECT + schema-behind|schema-ahead`（**不再** `CONFIG_INVALID`）。
- 测试/证据：现状 `test/schemas.test.ts:270-287`（11 类 + 穷尽护栏 + 正反例）。目标 `test/ports/errors.test.ts`：14 值穷尽、缺省映射 14 行逐条、6 个可达 category 正例、5 个内部 category 负例（构造器拒收）、三处允许的显式覆盖各一正例 + 别处覆盖负例、非法输入抛 `configInvalid('classified-input-invalid')`、`configInvalid` 固定两轴、3 字段旧形态必须 parse 失败。编译期护栏保证数组与枚举同步（增删即编译红）——本包少见的**机械**一致性保证。
- 规模/迁移：现 89 行；目标 ≤170 行。迁移是**破坏性**的且必须三段走：① 先加 `FAILURE_CLASSES`/`FailureClassSchema`/`FAILURE_CATEGORY_DEFAULT`（纯增）；② 全仓 13 处 `ClassifiedError` 构造点改走 `classified({failure, subcause, detail?, category?})`，`Err` 里补 `failure`；③ 再收紧 `ClassifiedErrorSchema`。过渡期**双写**：事件 note 同时带 `failure` 与 `category`，旧读方继续读 `category`；补不出的旧 `Err` 由构造器按 `subcause` 白名单补 `rejected_precondition + unknown-failure`——这是过渡补值，**不得**写进契约正文。`EXECUTOR_ERROR_CODES` 属实现内部词表（79-§3.4），一旦进台账即可观测，加码须按迁移处理。

### F-contract-cases-json

- 路径/处置：`cases.json`；**目标-保留**（只增用例，不删不改义；`CASES.md` 规则 1）。上位 02-F2-14、25-§二、`CASES.md` v1。
- 职责：语言无关的共同语料——每条 = `{id,domain,docs,title,input,expected}`。非职责：不承载实现、不承载 R1–R31 公共共同用例（那是 76-§9 的形状 + 82 的执行）。
- 现有实况（本次用脚本统计）：`version:1`，**53 条**，7 域：`deps 17 / plat 10 / mj 8 / evt 7 / rpt 5 / meta 3 / dir 3`；文件 1696 行、2 空格缩进。
- 消费者（跨包 7 处，**均为测试**，含 2 处带 JSON attribute）：
  `packages/contract/test/contract.test.ts:7`、`packages/contract/test/schemas.test.ts:33`（相对 `../cases.json`）；
  `packages/company/test/dir-cases.test.ts:8`、`packages/company/test/deps-cases.test.ts:11`、`packages/core/test/judge.test.ts:13`（相对 `../../contract/cases.json`，**无** `with {type:'json'}`）；
  `packages/yt/src/plat-cases.test.ts:14`、`packages/localplatform/src/plat-cases.test.ts:16`（有无 attribute 正确）。
  另有 `apps/daemon/src/evolve/evolve-guard.ts:104` 把它列为 evolve 禁改路径（`cases.json` 是“契约规格标尺”）。
- IO/注入：JSON 数据文件；**不得**在 `src` 里 `import`（79-§4.2：生产代码避免运行期 import JSON）。当前仅测试 import。
- 状态/并发：文件即状态；无版本以外的并发机制。写入纪律=“单写者”（`CASES.md:80-81` 明示不为单次改动改语料）。
- 错误/秘密：若某条 case 的 `input` 含真实凭据/本机路径，会随语料入库——**无机械扫描**（G-15）。当前 53 条抽查未见秘密形态（本次逐条读了 meta/dir/evt/rpt 的 input；deps/mj/plat 只核 id/标题）。
- 测试/证据：53 条被 7 个文件断言（含 plat 双实现），断言实例 63 次 = 3+12+3+17+8+10+10；本包自身断言 15 条（meta 3 + evt/rpt 12）。不证明：任何真实外部系统行为、跨实现 `subcause` 一致、`dir2`/`exe`/`inv`/`mdl`/`gw` 域。
- 规模/迁移：现 1696 行。迁移规则：新增域/用例只追加；跨包消费改为声明式子路径（`@studio-next/contract/cases.json`，见 F-contract-package）；`file` 指针留待 v2（见 F-contract-cases-md）。

### F-contract-cases-md

- 路径/处置：`CASES.md`；**目标-保留**（校正 3 处漂移，不改变冻结语义）。上位 25-§二、02-F2-14、20-§二（验收口径冻结后禁改）。
- 职责：契约格式的**唯一规范**（清单结构、5 条冻结规则、域清单、各域语义说明）。非职责：不是 runner 文档（runner 是实现）、不定义测试命令、不定义公共共同用例（R/E/W）。
- 内部结构：`清单结构`（`:9-25`）；`冻结规则` 6 条（`:27-42`：稳定 id、恰一 `out|err`、`__NULL__` 哨兵、匹配语义、input 内联、docs 必填）；`域清单`表（`:43-53`）；五段域语义说明（`deps`/`dir`/`plat` 两批/`mj`，`:55-156`）；`运行方式`示例（`:158-165`）。
- 已核漂移（本次逐行对照 `cases.json`）：
  1. `:49` 写“evt 6 条 + rpt 3 条”，实际 **7 + 5**（P3/P6/127-A 增补后未回写表格）。
  2. **（本项已消解，留作对照）** `plat` 计数：`CASES.md` 域清单行（`:53`）现写“端口冒烟正例归 P1 批次未兑现”、不再给 8 条断言；“首批 8 case（C-plat-001..008）”改在 `:89` 的语义说明里、`:116` 声明增批 2（C-plat-009/010）。逐条对 `cases.json`：`C-plat-001..010` 共 **10** 条，8+2 自洽——**当前无计数漂移**；本文旧稿按 `:53` 记的“表未同步”已不成立。
  3. `:40` 规则 5 与 `src/cases-schema.ts:16` 均称“schema 已预留 `file` 指针扩展位”，但 `CaseEntrySchema` **没有** `file` 字段，`input` 恒必填——预留位不存在。
  4. `:163` 示例 `runCases(manifest, { dir: loadCompanyDirectory })` 与实现不符：`dir` 域 subject 是 company 的 `dirSubject`（`strictFiles:false` 包装），不是 `loadCompanyDirectory` 本体（`:82-83` 自述）。
  5. 域清单把 `exe/inv/mdl/gw` 列为“端口冒烟 case”，但 `cases.json` 中 **0 条**（表列了未兑现的承诺）。
- 导出/依赖：无（文档）。被 `evolve-guard.ts:104` 的禁改清单间接触及（同 `cases.json`）。
- IO/注入/状态/并发/错误：N/A——纯文档；无运行期。
- 测试/证据：**无**任何测试断言 `CASES.md` 与 `cases.json` 一致 → 上述漂移能长期存在正是这个缺口。目标：`test/runner/manifest.test.ts` 增加“域集合一致 + 每域计数与常量表一致”的最小机械检查（只比域集合与计数，不解析正文）。
- 规模/迁移：现 165 行；目标 ≤190 行。校正顺序：先补 5 条漂移（同批修正 `cases-schema.ts:16` 的注释与 `:40`），再新增任何域的说明；**匹配语义段落（`:31-39`）不得随手改**（改=改契约，走批示）。

### F-contract-package

- 路径/处置：`package.json`；**目标-保留**（条件改 `exports`/`files`/`types`）。上位 79-§6.5（`contract` 分发形态“待定”）、79-§4.4（两态原子切换）、80-§12.2。
- 职责：声明包身份、入口、脚本、唯一运行期依赖。非职责：不声明构建产物（现状 `noEmit`）、不声明 `license`（现状缺省）。
- 内部（实读）：`name=@studio-next/contract`、`version=0.1.0`、`private:true`、`type:module`、`main=src/index.ts`、`exports={".":"./src/index.ts"}`、`scripts.typecheck="tsc --noEmit -p tsconfig.json"`、`scripts.test="vitest run"`、`dependencies={zod:^4.0.0}`。**无** `devDependencies`（`typescript`/`vitest` 来自仓根）、**无** `license`、**无** `files`、**无** `types` 字段。
- 现状后果（事实，不是缺陷判断）：`main`/`exports` 指 `.ts`，因此在真实 `npm install` 后 Node 会 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`（79-§1.2 探针）；本包只在 workspace 内可用。
- 目标（分两种裁决，二者互斥）：
  - **A 发 `src`**（默认，若 `studio-tools` 不切 dist）：保持入口，补 `exports["./cases.json"]`（消除 7 处跨包相对深引，79-§4.1 规则 2）与 `exports["./package.json"]`；`files` 若发布需含 `src`/`cases.json`/`CASES.md`/`exchange`。
  - **B 切 `dist`**（若 `studio-tools` 切 dist，79-§6.1 硬前提）：`main=./dist/index.js`、`types=./dist/index.d.ts`、`exports["."]={types,import}`；新增 `tsconfig.build.json`；`files=["dist","cases.json","CASES.md","exchange","README.md","LICENSE"]`；同时根 `tsconfig.json` 把本包移出 program，根 `typecheck` 串接本包 `tsc -p`（79-§4.4）。
- 导出/依赖：`zod` 唯一；目标不新增依赖（D75-10）。禁止 `paths` 回指 `src`（79-§6.3）。
- IO/注入：N/A（清单）。`scripts.test` 用根 vitest，不引入本包 `devDependencies`——保持。
- 状态/并发：无。切换是**包级原子动作**：`exports`/`types`/`files`/根 `tsconfig`/根 `typecheck`/`tsconfig.build.json` 必须同一提交。
- 错误/秘密：`files` 白名单**不得**包含 `test`（79-§7.1）；不得包含 `bun.lock`、`.env`、本机路径。
- 测试/证据：无。切换后的验收=`npm pack --dry-run --json` 清单 + `node` 直接 import `dist/index.js` + 消费者 tsc 解析 `dist/index.d.ts` + `--listFiles` 拓扑断言（79-§5.6/§8.2）。**本附录未执行**。
- 规模/迁移：现 18 行；目标 ≤30 行。迁移触发条件写死在 79-§6.5，本包无权自决；条件未满足前**不得**添加 `types`/`files` 占位。

### F-contract-tsconfig

- 路径/处置：`tsconfig.json`；**目标-保留**。上位 79-§1.3、79-D10、80-§10.7。
- 职责：本包的**源码**类型门禁（继承根 base 的全部严格开关）。非职责：不覆盖 `test/**`（D10 已登记的缺口）、不产出（`noEmit` 来自 base）。
- 内部：`extends: "../../tsconfig.base.json"`、`include: ["src/**/*.ts"]`。
- 导出/依赖：N/A。继承来的关键开关：`strict`/`noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`/`erasableSyntaxOnly`/`verbatimModuleSyntax`/`isolatedModules`/`allowImportingTsExtensions`/`noEmit`。
- IO/注入/状态/错误：N/A（配置）。
- 测试/证据：`bun run --filter @studio-next/contract typecheck`（本次未运行）。注意：**`test/**` 不在本 program**，因此 `test/schemas.test.ts` 的类型错误不会被发现——已登记在 79-D10，归 82。
- 规模/迁移：现 5 行；目标不改。若切 dist：新增 `tsconfig.build.json`（不修改本文件），本文件继续只做 `--noEmit`。

### F-contract-test-contract

- 路径/处置：`test/contract.test.ts`；**目标-保留**。上位 25-§二、`CASES.md`；性质=机制自证。
- 覆盖：① 清单过 schema 且 meta 3 条全绿（`:21-26`）；② 篡改 `C-meta-001` 期望 → `passed=2` 且 `failed[0].id==='C-meta-001'`（`:28-35`，防“runner 恒真”）。
- 夹具：本地 `metaSubject`（`:9-18`）——`input.echo` 原样返回；`input.boom` 抛 `CONFIG_INVALID/meta-boom`。**fake 边界**：subject 是 5 行假实现，只证明 runner 机制，不证明任何业务域。
- 不证明：数组歧义匹配、清单不合法、重复 id、未知域、`subcause` 省略时的宽松语义。
- 规模/迁移：现 36 行；`runCases` 的语义修正（F-contract-runner）**不得**改变本文件的断言值（3 条/篡改必红）；若修正导致需要新增断言，另开文件而非改本文件含义。

### F-contract-test-schemas

- 路径/处置：`test/schemas.test.ts`；**目标-保留**（后续按子域分流，不删原断言）。上位 17-§3、02-F2-02/F2-04、25-§二、复查报告 B4。
- 覆盖（逐 `describe`）：契约语料 evt 7+rpt 5=12 绿 + 篡改 `C-evt-003` 必红（`:60-76`）；事件名 30+3 族计数/正反例（`:80-103`）；平台活动六词正反例（`:107-139`）；executor 三码正反例（`:143-172`）；计费两轨正反例（`:176-207`）；ULID 正反例（`:211-228`）；四桶 5 正 4 负（`:232-245`）；台账列集/边界（`:249-266`）；错误分类 11 值 + 穷尽（`:270-287`）；REPORT 骨架与提取器（`:291-314`）；sidecar 正反例（`:316-336`）；`evtSubject` 抛错形状（`:340-353`）。
- 夹具：`baseRecord()`（`:39-53`）固定一条合法台账行；`VALID_REPORT`/`VALID_SUMMARY`（`:55-56`）。**fake 边界**：无外部依赖、无 IO，全部纯输入输出。
- 不证明：真实台账写入（store 侧）、真实收割产物、`sentinel` 与实际岗单一致、跨实现一致、`rptSubject` 的 `report` 优先失败顺序（只间接经 C-rpt-002/003 各一条）。
- 规模/迁移：现 353 行（<600）；**不再增长**：任何新增 schema 的用例进 `test/records/*` 或 `test/runner/*`。分流触发条件=本文件 >500 行，届时按 `schemas/{events,report,errors}` 三段拆到 `test/schemas/`（仅测试可拆，源不必动）。

---

## 四、目标件逐条

> 本节全部为**设计**：无文件、无代码、无 schema 内容。每条给“上位 → 文件契约 → 为什么是它承担”。

### 4.0 公共类型分区（先定“谁住在哪”，再谈文件）

本包的公共类型按“同一符号只有一个定义处”分区；其余文件只能 `import type`，不得复制字段表：

| 层 | 符号（示例，全集见各条） | 唯一家 | 上位 | 现状 |
|---|---|---|---|---|
| 共享内核 | `ClassifiedError`（4 字段）/`ErrorCategory`/`Result<T,E>`/`Money`/`TokenCounts`/`StreamEvent`/`TaskBrief`/`CompanySlug`/`TicketId`/`PersonId`/`AttemptNo`/`DurationMs`/`ResultStats` | `src/ports/kernel.ts` | 80-§4.1 TS-SCALAR-01/09、§5.7、25-§二 | **已有 3 字段版**；`Result` 与 `failure` 槽为**目标增补** |
| 失败词表 | `FailureClass`（14 值，77 原样下划线） | `src/records/scalars.ts`（TS-SCALAR-10） | 80-§4.1、77-§11.1 | **目标**（`kernel.ts` 只 `import type`） |
| 规范标量 | `Qid`/`QidView`/`Timestamp`/`TimestampView`/`DecimalString`/`SemVer`/`VersionRef<T>`/`Extension`/`Digest`/`FailureClass` + 金额别名 `MoneyAmount` | `src/records/scalars.ts` | 80-§4.1/§4.5、76-§1.2–1.5 | 目标 |
| 规则面 | `Diagnostic`（80 的**唯一**诊断形状，判别联合：`code: RuleDiagnosticCode`/`severity:'error'\|'warning'\|'info'`/`phase: DiagnosticPhase`/`location: RuleFieldPath`/`ruleId?`/`subjectRef?`/`profileRef?`/`evidenceRef?`/`messageKey`+`messageArgs`/`expected?`+`actual?`（顶层短文本）；`limitsApplied` 仅 `phase='limit'` 必填且 `code` 收窄为 `'E-RULE-003'`，其余 `never`）/`RuleDiagnosticCode`(**18**)/`DiagnosticPhase`(8)/`RuleLimits`（**七项**）/`RuleLimitTightening`/`RuleOutcome`/`TypecheckReceipt`/`RuleProfileRef`/`RuleInput*` | `src/ports/spec.ts` | 80-§6.1、76-§1.7 | 目标（**不落 `records/`**，理由见 §4.1 `port-spec` 第二条） |
| 规范引用 | `RecordRef`/`DefinitionRef`/`ExternalRef`/`SubjectRef`/`ArtifactRef`/`ProfileRef`/`Provenance` | `src/records/refs.ts` | 80-§4.3 | 目标 |
| 记录 | `RecordEnvelope<T>`（`payloadRef: ArtifactRef`）+ 50 类 payload + 76 侧记录 + `ValidationIssue`/`ValidationOutcome`/`validateRecord` | `src/records/{envelope,validate,def-records,payloads/**}.ts` | 80-§4.2/§4.4/§4.7/§4.8、77 | 目标（`ValidationIssue` 自 `schemas/events.ts` 迁入，成为唯一定义） |
| 规范化 | `Canonicalizer`/`JsonValue` | `src/canon.ts` | 80-§4.5、76-§1.5.1 | 目标（**不实现** jcs@1，见 §4.4） |
| 端口 | 55 个端口（53 新）+ 辅助类型 | `src/ports/*.ts` | 80-§6 | 9 现有 + 10 目标文件 |
| 供给面 | `SecretKind`/`SecretUse`/`ValueProvider`/`SubjectScope`/`SecretCatalogEntry`/`SecretProvider`/`SecretMaterial`/`KnownSecretSet` | `src/ports/secret.ts` | 80-§11.2.1、78-BIND-WS-01/SEC | 目标（**不属** 55 端口） |
| 资源评估 | `TS-PORT-RES-01` + `ResourceBaselineRequest`/`ResourceBaseline`/`ResourceLimit`/`ResourceEntry`/`ResourceGap` | `src/ports/resources.ts` | 80-§6.4 末 | 目标（**只读**，无写口/回执/REC） |
| 脱敏纯函数 | `redactOutbound`/`redactKnownSecrets`/`findSecretShaped`/`SecretShapeFinding` | `src/secrets.ts` | 79-§3.6、80-§11.2-3 | 目标（自 `core` 迁入） |
| 时间工具 | `DAY_MS`/`dayKeyOf`/`companyDayKey`/`CompanyZone` | `src/daykey.ts` | 80-§9.4 M1（**只给 `dayKeyOf`/`DAY_MS` 与"显式传时区"的要求**；`companyDayKey`/`CompanyZone` 的名字是本附录所拟，G-26） | 目标（`dayKeyOf` 自 `panel` 迁入，UTC 语义不变；日键**不是** `Timestamp`，不套 TS-SCALAR-03） |
| 契约格式 | `CaseEntry` 等与 `cases.json` 的 zod schema | `src/cases-schema.ts` | 25-§二 | 已有 |

五条纪律：① 每个类型只有一个定义处；`ports/**` 不复制 `records/**` 的字段，只引用。② `src/index.ts` 按上表分区再导出；实现内部符号（如 `ValidationIssue` 的中间片段）不进公共面。③ 公共类型一旦导出即受 79-§6.5 发布形态约束：切 `dist` 时 `.d.ts` 必须覆盖全部导出。④ **不派生"专用诊断"别名**：80-§6.1 只有一个 `Diagnostic`（判别联合；`code` 已收窄为 `RuleDiagnosticCode`(18)，`location: RuleFieldPath` 就是 76 的 `location`），不得再造 `RuleDiagnostic`/`RuleDiagnosticBase` 一类并声称"扩展基形"；复用只在字段位置（如 `TypecheckReceipt.diagnostics: readonly Diagnostic[]`）。⑤ **同一语义不得两套字面量**：77 的下划线原值（`rejected_precondition`、`partially_settled`）一字不改地进 TS；`subcause` 是自由串，不许当 `failure` 用（80-§4.4/§5.7）。

`Result`/`FailureClass` 在 v0.1/v0.2 是漏项，v0.3 已定家：`Result` 进 `kernel.ts`（与 `ClassifiedError` 同文件），`FailureClass` 进 `records/scalars.ts`（与其它 TS-SCALAR 同文件，避免枚举散落）。`ports/**` 一律 `import type`，不得各自手写 `{ok:true}|{ok:false}`——否则会造出十几个互不兼容的“结果类型”。

### 4.1 端口文件（11 件，类型面）

共通契约（逐文件不再重复）：
- 归属：全部 `experimental`（80-§0.3/D3）；**签名、辅助类型、前置/后置、错误、幂等、事务与证据一律照 80-§6 对应小节**，本文件不新增端口、不改签名、不补字段；80 未写的语义，本文件只能写“80 未定”并回写。
- 依赖：`import type` 指向同包 `./kernel.ts`（`Result`/`ClassifiedError`/`CompanySlug` 等）与 `records/**`（`RecordRef`/`SubjectRef`/`Digest`/`VersionRef`/`FailureClass`）；`secret.ts` 另从 `../secrets.ts` 取 `SecretShapeFinding`。**零运行期 import**、零第一方包、零 `node:*`。
- IO/注入：N/A——纯声明。副作用由实现方承担，端口只声明形状。
- 状态/并发：N/A——类型无状态。端口级幂等/预期版本/CAS 语义**写在 80 的对应小节**，本文件只在类型上体现（如 `expectedGeneration`、`expectedLineageHead`、`Result`）。
- 错误：`Result<T, ClassifiedError>` 与 `throw` 的分工照 80-§5.7；`failure` 取 77 的 14 个字面量，`category` 由 `schemas/errors.ts` 的 `classified({failure, subcause, detail?, category?})` 按缺省映射填、不得手填、不得选 5 个内部 category；**显式覆盖只许三处**（合并域 `MERGE_CONFLICT`、泳道域 `NO_LANE`、HTTP 路由不存在 `EXTERNAL_REJECT`）。**结论类返回值不进 `Err`**：`RuleOutcome.refused`、`IntakeOutcome` 五值、`ObservationState`、`verdict` 三值都留在 `Ok` 里。
- 测试/证据：无运行期用例（类型不可运行）；证据=根 `tsc` + 消费方 typecheck。**不得**把“类型存在”说成“端口已实现”。
- 规模：单文件 ≤300 行；超 300 时按 80 的子节再拆，不进 `src` 直下。

| F-ID | 文件 | 承载（逐端口） | 规模 |
|---|---|---|---|
| F-contract-port-spec | `src/ports/spec.ts` | `TS-PORT-SPEC-01`（`SpecRegistry`）/`TS-PORT-SPEC-02`（`DefinitionLoader`）/`TS-PORT-SPEC-03`（`PackageImporter`）/`TS-PORT-RULE-01`（`RuleEvaluator`）；辅助类型 `SpecEntry`/`DefinitionSource`/`DefinitionBundle`/`ImportTarget`/`ImportPlan`/`ImportReceipt`；**规则求值公共类型（80-§6.1 全量，逐名对齐）**：`RuleProfile`（80 只给空占位 `interface`，字段表归 76-§6，本包**不复制**）/`RuleProfileRef`（其 digest **必须**是 `semanticDigest`，带 `canonicalizationId`/`version`；禁 `byteDigest` 顶替）/`RuleScalar`/`RuleFieldPath`（= 76 的 `location`，语义路径不是行号）/`RuleInputDecl`/`RuleInputRoot`/`RuleInput`/`RuleLimits`（**七项**：`maxNodes`/`maxDepth`/`maxListItems`/`maxStringCodePoints`/`maxDecimalDigits`/`maxDecimalScale`/`maxSteps`；另三项**档内固定**不入此类型）/`RuleLimitTightening`（`Partial<RuleLimits>`，生效值 = `min(档内声明, 调用侧收紧)`）/`RuleTraceStep`/`RuleOutcome`/`TypecheckReceipt`/`Diagnostic`（**判别联合**：`DiagnosticBase` + `phase='limit'` 时 `limitsApplied: RuleLimits` 必填、其余 `limitsApplied?: never`）/`RuleDiagnosticCode`(**18**)/`DiagnosticPhase`(8)。**无 `RuleDiagnostic`**：80 的 `Diagnostic` 本身就带 `ruleId?`/`subjectRef?`/`profileRef?`/`evidenceRef?`/`messageKey`/`messageArgs`/`expected?`/`actual?` | ≤300 |
| F-contract-port-authority | `src/ports/authority.ts` | `TS-PORT-AUTH-01`（需求源）/`TS-PORT-AUTH-02`（候选端点目录）/`TS-PORT-AUTH-03`（权域激活）/`TS-PORT-AUTH-04`（写者租约）/`TS-PORT-AUTH-05`（授权签发）/`TS-PORT-AUTH-06`（凭据目录）/`TS-PORT-AUTH-07`（失能）；辅助类型 `CandidateEndpoint(Profile)`/`ActivationRequest`/`ActivationReceipt`/`ActivationView`/`LeaseRequest`/`FenceObservation`/`FenceToken`/`GrantRequest`/`CredentialRef`/`IncapacityVerdict` | ≤190 |
| F-contract-port-record | `src/ports/record.ts` | `TS-PORT-REC-01`（写）/`TS-PORT-REC-02`（读，含 `payload(ref)`）/`TS-PORT-REC-03`（投影）/`TS-PORT-REC-04`（事务）/`TS-PORT-REC-05`（更正）/`TS-PORT-REC-06`（对账）；`RecordPayload`/`RecordWriteInput`/`AppendOptions`/`AppendReceipt`/`RecordQuery`/`RecordPage`/`TableProjectionName`（17）/`TargetTableProjectionName`（`TableProjectionName` + `'resourceLedger'`）/`ProjectionName`（`TargetTableProjectionName` + `'observation'`）/`ProjectionSource`（含 `since`/`asOf`）/`ProjectionResult`/`TableProjectionResult`/`ObservationProjectionResult`/`TxScope`/`TxHandle`/`TxReceipt`/`CorrectionRequest`/`ReconcileBatch`/`UnknownRegistration` | ≤260 |
| F-contract-port-work | `src/ports/work.ts` | `TS-PORT-CMD-01`、`TS-PORT-DEC-01`、`TS-PORT-WORK-01`/`TS-PORT-WORK-02`/`TS-PORT-WORK-03`/`TS-PORT-WORK-04`/`TS-PORT-WORK-05`/`TS-PORT-WORK-06`/`TS-PORT-WORK-07`/`TS-PORT-WORK-08`/`TS-PORT-WORK-09`/`TS-PORT-WORK-10`/`TS-PORT-WORK-11`；`reserve` 的返回体（**匿名**，80 未命名该类型：`{intentRef: Qid; bodyDigest: Digest; receivedAt: Timestamp; duplicate: boolean}`）/`IntakeOutcome`（`outcome` 五值）/`WorkState`/`ReadinessRequest`/`RecReadinessJudgment`（**13 字段**；`verdict` 三值，**中文** `可开工`/`附条件开工`/`不可开工`）/`ReadinessGate`（五英文机器值）/`ReadinessVerdict`/`ReadinessJudgeRole`（六英文内部名，写入记录只有中文六值）/`GateResult`（`criterionRef: ProfileRef`）/`ReadinessCondition`/`TransitionExpectation`/`SettlementStatus`（五值）/`AssignmentActionKind`（11 值）/`ReferralTarget`（三字段全必填）/`AttendanceFace` | ≤300 |
| F-contract-port-resources | `src/ports/resources.ts` | `TS-PORT-RES-01` `ResourceAccountant{baseline, gap}`（**只读两方法**）；`ResourceBaselineRequest`/`ResourceBaseline`/`ResourceEntry`/`ResourceLimit`（`finite{amount: DecimalString}`/`unbounded`/`unknown{reason?}`）/`ResourceGap`（`quota-unreadable`/`over-reserved`/`unreconciled-actual`/`reservation-record-missing` 四 kind）。**无** `reserve`/`actual`/`release` 方法、**无** `Qid` 回执类型、**无**新 `REC-*` | ≤160 |
| F-contract-port-capability | `src/ports/capability.ts` | `TS-PORT-CAP-01`（解析）/`TS-PORT-CAP-02`（安装）/`TS-PORT-CAP-03`（挂载）/`TS-PORT-CAP-04`（探测）/`TS-PORT-CAP-05`（激活）/`TS-PORT-CAP-06`（退役）；辅助类型 `CapabilityRequirement`/`InstallPlan`/`MountState`/`ProbeResult`/`ActivationState`/`RetireReceipt` | ≤170 |
| F-contract-port-effects | `src/ports/effects.ts` | `TS-PORT-EFF-01`、`TS-PORT-EVD-01`/`TS-PORT-EVD-02`、`TS-PORT-MEM-01`、`TS-PORT-OBS-01`、`TS-PORT-MIG-01`；`EffectRequest`/`EffectOutcome`/`EvidencePackage`/`AcceptanceVerdict`/`MemoryDisposition`/`ObservationState`/`MigrationPlan`/`MigrationActionKind`/`MigrationReceipt`。**不含** `BindingProfile`/`StateMapping`/`ExportScope`/`ExportBundle`/`ExitPlan`（已移 `binding.ts`） | ≤300 |
| F-contract-port-binding | `src/ports/binding.ts` | `TS-PORT-BIND-01`（`PlatformBindingPort`：`describe`/`mapState`/`exportBundle`/`exitPlan`）；`BindingFactStatus`（`'已有'`\|`'库级'`\|`'目标'`\|`'未证'`）/`BindingProfile`（**20 字段**）/`StateMapping`/`ExportScope`/`ExportBundle`/`ExitPlan`；只引用 `FlowPlatform`（`platform.ts`）与 `REC-LOSS-01` 的 `Qid[]`。**无** EFF/EVD/MEM/OBS/MIG | ≤260 |
| F-contract-port-lifecycle | `src/ports/lifecycle.ts` | `TS-PORT-EVD-03`/`TS-PORT-EVD-04`/`TS-PORT-EVD-05`、`TS-PORT-OBL-01`、`TS-PORT-LIFE-01`/`TS-PORT-LIFE-02`/`TS-PORT-LIFE-03`/`TS-PORT-LIFE-04`；辅助类型 `ValueBook`/`ReworkRequest`/`ReopenRequest`/`ObligationInstance`/`IdentityTransition`/`HandoverReceipt`/`SuccessionDecision`/`AppointmentRequest` | ≤190 |
| F-contract-port-intent | `src/ports/intent.ts` | `TS-PORT-API-01` `IntentSubmissionPort{submit, receipt}`；公共形状 `IntentSource`/`IntentKind`（八值）/`RequestKind`（四值）/`WebhookIntentPayload`/`IntentKey`/`IntentReceipt`/`IntentSubmitResult` | ≤180 |
| F-contract-port-secret | `src/ports/secret.ts` | 供给面（**非** §6 端口）：`SecretKind`（5 值）/`SecretUse`（6 值）/`ValueProvider`（四判别）/`SubjectScope`（3 字段，`deploymentRefs` 必填）/`SecretCatalogEntry`（**7 字段**）/`SecretMaterial`（5 字段，`value` 不进任何可序列化面）/`SecretProvider`/`KnownSecretSet`（6 成员：`secretIds`/`state` 三值/`missingSecretIds`/`redactKnown`/`redact`/`find`；`knownValues` 只在工厂闭包） | ≤170 |

逐文件特有约束（其余字段同“共通契约”）：
- **`port-spec` 两阶段**：`typecheck(profile, decl): Promise<Result<TypecheckReceipt, ClassifiedError>>` 与 `evaluate(profile, ref, input, tightening: RuleLimitTightening): Promise<Result<RuleOutcome, ClassifiedError>>` **不合并**；类型错误在 `typecheck` 就 `Err(rejected_precondition + CONFIG_INVALID + rule-typecheck)`，不进 `evaluate`。`RuleOutcome` **七字段**：`outcome:'true'|'false'|'unknown'|'refused'` / `profileRef: RuleProfileRef`（digest 用 `semanticDigest`）/ `inputsDigest: Digest`（同样必须 `semanticDigest`）/ `steps: number` / `limitsApplied: RuleLimits`（**必填**，回填实际生效值 = `min(档内, 收紧)`）/ `diagnostics` / `trace?{steps, truncated}`——**`refused` 是 `Ok` 的第四值**，既不是 `Err` 也不是 `throw`（80-§5.7/§6.1）。`typecheck` 通过才进 `evaluate`；`TypecheckReceipt{profileRef, inputDeclDigest, limitsApplied, diagnostics}`。**收紧只能更严**：`tightening` 比档内声明更松、或试图收放三项**档内固定**（模式输入长度、模式匹配步数、量词嵌套层数，均不入 `RuleLimits`）⇒ `Err(rejected_precondition)`，不得静默忽略。另有 `Err(timeout + STALL + host-clock-guard)`：宿主墙钟护栏触发时**不得**记 `false`（80-§6.1 错误条）。
- **`port-spec` 的 18 个诊断码按相位固定**（80-§6.1 现行登记表）：parse `E-RULE-001/002/014`；typecheck `E-RULE-004/005/006/011/013` + `W-RULE-001`/`W-RULE-005`；eval `E-RULE-007/008/009/010/012`；limit `E-RULE-003`；policy `E-RULE-020` + **`W-RULE-002`**（逐码对齐 80-§6.1 的"码 → 相位固定映射"；`W-RULE-002` 是**合法策略结论的必报项**：判定落到未覆盖面（命中显式 `uncovered` 条目，或完全无条目命中、`messageArgs` 首项写 `no-match`），与 `uncovered` 的 `E-RULE-020` 处置相同（**不得执行**、只能受理与请求决定）但**诊断必须分开**——"未覆盖"与"允许"在日志上不可分辨即为缺陷）。`E-RULE-015`–`019` 五个号**保留不分配**。`DiagnosticPhase` 八值取自 76-§1.7 的词表、由 80-§6.1 定稿；`structure`/`refResolve`/`io` 三个相位**当前无码**，80 明令不得当"其他"桶兜底、`io` 在本纯函数里不得产生——实现不得自造码或自造相位。
- **`port-spec` 的 `Diagnostic` 家在本文件**（不是 `records/scalars.ts`）：80-§6.1 的诊断在 `phase='limit'` 时带必填 `limitsApplied: RuleLimits`，若把基形放 `records/` 就会形成 `records → ports` 环；而 `records/validate.ts` 只出 `ValidationIssue`、不消费 `Diagnostic`，故唯一消费者是规则面。**字段名照 80 逐字**：`location: RuleFieldPath`——`RuleFieldPath` 就是 76 的 `location`（语义路径，**不是"第几行"**），80 沿用了这个名字，本包照抄、不得改写成 `path`、也不得把 `RuleFieldPath` 理解成行号；`expected?`/`actual?` 是**顶层短文本**（如 `expected:'signed contract v2'`），**不**收进 `safeDetails`——80 的 `DiagnosticBase` 没有 `safeDetails` 键，自造该键即违约。`rules/scalars` 侧也不得再定义同名 `DiagnosticBase`。`limitsApplied` 由 **`phase` 判别**决定：`phase='limit'` 分支必填且 `code` 收窄为字面量 `'E-RULE-003'`，其余相位 `limitsApplied?: never`（判别联合，不是"可选字段碰运气"）。`severity` 三值 `'error'|'warning'|'info'`；`code` 已收窄为 `RuleDiagnosticCode`(**18**)，**不派生 `RuleDiagnostic`/`RuleDiagnosticBase` 别名**。76-§1.7 `DEF-DIAG-01` 的通用十段码（`E-SYN-*`/`E-EXT-*`/`W-EXT-*`/`E-PKG-*`/`W-PKG-*`/`E-REF-*`/`W-REF-*` 共 14 个非规则码）**仍无 TS 承载**——G-19 的范围由此缩窄为"非规则码"，不含 rules 面。
- **`port-spec` 的实现不在本包**：`RuleEvaluator` 的纯函数实现落 `packages/core/src/rule/{evaluator,typecheck,values,operators,pattern}.ts`（80-§6.1“纯函数落 `core`，公共类型落 `contract`”；80-§6.9 与 02-core 已定单数目录与五个文件）；本包零 `node:fs`，层 0 也不可能反向依赖 `core`。规则正反样例与实现证据归 `core/test/rule/*`。
- **`port-authority`**：`TS-PORT-AUTH-03` 的 `AuthorityActivationPort.activate`，其 `generation`（治理代次）与 `FenceToken`（写者围栏）**必须两个字段**，`generation` 不得当围栏用；`TS-PORT-AUTH-04` 的 `WriterLeasePort` 每次换租约都换 fence（旧 fence 立即失效）；`TS-PORT-AUTH-06` 的 `resolve` 返回 `Result<CredentialRef | undefined>`——`undefined` = 未登记，**不是**拒绝。
- **`port-record`**：`TS-PORT-REC-01` 的 `RecordWriter.append(input: RecordWriteInput, opts?: AppendOptions)`——**只收信封的 `append(env)` 已作废**（`payloadRef` 会变成一根无从核对的指针）：`RecordWriteInput{envelope: RecordEnvelope<unknown>; payload: RecordPayload}`、`RecordPayload{ref: ArtifactRef; bytes: Uint8Array; mediaType: string}`。**信封与载荷字节分开传（两份材料）**：`payload.ref` 必须与 `envelope.payloadRef` **逐字段同值**、`payload.mediaType === ref.mediaType`；`ref.contentDigest` 是 `bytes` 的**原始载荷 `byteDigest`**（不得是语义摘要、不得带 `canonicalizationId/version`——载荷未必是 JSON，语义摘要无从计算）；`bytes` 未解析、未规范化、未压缩；`ref.storageHint` 只是**逻辑定位**（内容寻址键一类），**不是本机路径、不是可读性证明、不是权限凭证**——不得据它判“能不能读”，也不得写进日志/导出当路径。回 `Result<AppendReceipt{recordId, deduped}>`——v0.1 的 `AppendResult{appended:false}` 作废（“没追加”要么 `deduped:true`，要么 `Err`）。`AppendOptions{authorityDomain?, expectedLineageHead?, expectedTypeVersion?, idempotencyKey?, writerLease?, fence?}`（v0.10 补 `authorityDomain?`）：**仅当规则注册表能唯一定域**（恰好一条 `AuthorityRequirement` 覆盖该 `recordType`）时可省，**多域覆盖或存在歧义时必填**，缺失即 `Err({failure:'rejected_precondition', subcause:'authority-domain-ambiguous'})`；**不得**按“第一个命中/字典序最小/默认域/表名”猜一个。解析出的域落 `records` 的索引列，且必须等于 `TxScope.authorityDomain`（不一致 ⇒ `rejected_precondition`/`tx-scope-domain-mismatch`）；该域能否承载此 `recordType` 由 `TS-PORT-AUTH-01` 的需求声明 + `TS-PORT-AUTH-03` 的**当前激活**判定，不允许 ⇒ `rejected_authority`。载荷面固定四条 subcause（全部 `rejected_precondition`）：`payload-missing`（未给载荷）/`payload-digest-mismatch`（摘要不符）/`payload-media-type-mismatch`（媒体类型不符）/`payload-unreadable`（字节不可重读）——信封行与载荷行在**同一事务**落下，任一失败整体回滚，**不得**“先写信封、载荷后补”，也不得留“有封无载/有载无封”。`TS-PORT-REC-02` 的 `RecordReader` 是**异步 `Result` 面**：`get(recordId: Qid): Promise<Result<RecordEnvelope<unknown> | undefined, ClassifiedError>>`——**`Ok(undefined)` 才表示"不存在"**；库打不开/读失败一律 `Err({failure:'unavailable', category:'STALL', subcause})`，**不得**把失败降级成 `undefined`（二者的运维含义完全不同）。`query(q: RecordQuery): Promise<Result<RecordPage, ClassifiedError>>`，只接受可索引条件且 `limit`/`order` **必填**；`RecordQuery` 为 `{kinds?: readonly {name: RecTypeName; version?: SemVer}[]; company?: CompanySlug; subjectRef?: SubjectRef; timeRange?: {from: Timestamp; until: Timestamp; field: 'recordedTime'|'observedTime'|'effectiveTime'}; idempotencyKey?: string; cursor?: string; limit: number; order: 'asc'|'desc'; knowledgeScope?: KnowledgeScope}`；`idempotencyKey` 只做精确索引查重，用于效果网关的回执先查，不是模糊过滤、第二幂等键或跨公司通行证；`RecordPage<TPayload = unknown>{items: readonly RecordEnvelope<TPayload>[]; nextCursor: string | null}`——**末页必须 `null`**，有下一页才是 opaque 游标（调用方不得解析/拼接/比较）；`items.length ≤ limit`，返回记录必须带 `integrity`。**查询只回信封**：`get`/`query` 的 `items` 只带 `payloadRef`，**不得**把字节塞进分页结果（载荷大小与记录条数无关，一次 `limit` 就能把整表大包读进内存——DoS 面）；要字节的调用方逐条 `payload(ref)` 并自行负责量级。**同一形状由 `store` 的 `ReadOnlyLedger` 共用**（80-§8.2）。`RecordPage` 的读面分工：`RecordReader`（本文件，async）与 `ReadOnlyLedger`（**类型定义在 `store`**，本卷只引用不改写、不复制字段）共用同一 `RecordPage`/`RecordQuery`；`ReadOnlyLedger.get`/`query` 回**同步** `Result`（D21），语义同义：`Ok(undefined)` 才是不存在、失败回 `Err`；`ReadOnlyLedger.payload(ref)` 是**同步**版本，四态与四条 subcause 与 `RecordReader.payload` **逐字相同**（80-§8.2）。`TS-PORT-REC-02` 的 `payload(ref: ArtifactRef): Promise<Result<RecordPayload | undefined, ClassifiedError>>` 是**按需读字节的唯一入口**，四态固定：① `Ok(undefined)` **只表示“该定位没有载荷”**（查无 `record_payloads` 行）——不表示无权、不表示不可读、不表示记录不存在；② **先过信封权检、`ref` 不是通行证**：实现必须先由 `contentDigest` 反查所属信封，按该信封的 `knowledge`/`scope` 校验调用方许可，不许可 ⇒ `Err({failure:'rejected_forbidden', subcause:'payload-not-authorized'})`（`category` 走 §5.7 缺省），**不得**因为“手里有摘要”就跳过信封权检，也不得用 `storageHint` 直接取对象绕过台账；③ 读回字节重算 `byteDigest` 与 `ref.contentDigest` 不符 ⇒ `Err({failure:'rejected_precondition', subcause:'payload-digest-mismatch'})`，`mediaType` 与 `ref.mediaType` 不符 ⇒ `Err({failure:'rejected_precondition', subcause:'payload-media-type-mismatch'})`，均 `Err`，**不得**“先返回、再告警”；④ 字节读不出来（对象存储不可达/行损坏/文件缺失但索引仍在）⇒ `Err({failure:'unavailable', category:'STALL', subcause:'payload-unreadable'})`，**不得**降级成 `Ok(undefined)`——把“不能给你看/读不出”伪装成“本来就没有”判负。三条查询错误与只读面**逐字相同**（`category` 走 80-§5.7 缺省推导，**不得手填**）：`Err({failure:'unsupported', category:'EVOLVE_REJECT', subcause:'ledger-query-unsupported'})`（条件不可索引/未开放字段组合——请求合法、该查询形状未开放，属**演进域**，**不是** `CONFIG_INVALID`）/`Err({failure:'conflict', category:'EXTERNAL_REJECT', subcause:'ledger-cursor-invalid'})`（游标不可解/作废/与条件不匹配）/**`STATE_CONFLICT` 不是 `ErrorCategory` 成员、全卷不得出现**，非合并域也不得写 `MERGE_CONFLICT`/`Err({failure:'rejected_precondition', category:'CONFIG_INVALID', subcause:'ledger-query-invalid'})`（查询形状非法——三条里只有这一类是 `CONFIG_INVALID`）；`get` 读不出统一 `Err({failure:'unavailable', category:'STALL', subcause:'ledger-read-failed'})`。不得自造第四种 subcause，也不得降级成空页或 `undefined`。`TS-PORT-REC-03` 的 `RecordProjection.project/rebuild` 回 `ProjectionResult = TableProjectionResult | ObservationProjectionResult`，`ProjectionName` 是**封闭字面量联合**、**分两层**（80-§6.3）：`TableProjectionName` = **17** 张已建表投影（`events`/`work`/`sessions`/`people`/`personnelEvents`/`departments`/`tickets`/`jobs`/`todoQueue`/`candidates`/`budgets`/`ledgers`/`reports`/`usageDaily`/`prices`/`probes`/`intentReceipts`）；`TargetTableProjectionName = TableProjectionName | 'resourceLedger'`（`resourceLedger` 是**已登记的目标名**，物理表 `resource_ledger`，随 `MIG-01` 建表、**实现未落地**）；`ProjectionName = TargetTableProjectionName | 'observation'`。`ProjectionSource{cursor?: string; factDomains: readonly string[]; since?: Timestamp; asOf?: Timestamp}`：`since` 是**增量起点**（只重放该时刻之后的事实，配 `cursor` 断点）、`asOf` 是**快照时点**（重建到该时点的全量，不看游标）——**两者不得互替**，要快照必须显式给 `asOf`、不得拿 `since` 冒充；两者同时给 ⇒ 抛 `ClassifiedError`（`failure:'rejected_precondition'`、`subcause:'projection-source-invalid'`），不得择一静默。`rebuild(name)` 不带来源 = 从头**全量**重建（等价“把当前全部事实重放到此刻”，但**投影面无时钟**、不自己猜时点）；要“重建到历史某时点”必须走 `project(name, {…, asOf})`。`factDomains` 的校验**不得硬编码域→表**：① 每个域须在 `TS-PORT-AUTH-01` 已登记（未登记 ⇒ `projection-source-invalid`，不静默忽略/不跳过）；② 域→本地表族的路由由**注入的 `Projector` 在注册时声明**，本包公共面**不出现**域→表常量表，调用点也不得“先查表再拼”；③ 涉及写入的表投影还须由 `TS-PORT-AUTH-03` 的**当前激活**允许该域，不允许 ⇒ 同码拒。域字符串是 77 的域标识、**不是物理表名**，两者不得互相顶替。**`intentReceipts` 是 `TableProjectionName` 的成员**（物理表 `intent_receipts`，与 `events`/`work`/… 并列，共 17 张），**不属 `'observation'`**，也不属 `resourceLedger` 那一层：①类回 `TableProjectionResult{kind:'table'; name: TargetTableProjectionName; rows; cursor}`——`name` 取 **`TargetTableProjectionName`**（否则 `project('resourceLedger')` 无法把第 18 个目标名回填；80-§6.3/D30 已同此口径，G-28 关闭），②类只有 `'observation'`、回 `ObservationProjectionResult{kind:'observation'; state}`、**不得带 `rows`**，也不得用空集合冒充“没有数据”（80-§6.3 封闭联合，不是本附录自选）。`TS-PORT-REC-04` 的 `RecordTransaction`：`TxScope{company, authorityDomain, partition?}`（`authorityDomain` 是 77 的域标识、**不得填物理表名**；须与 `append` 解析/显式给的域一致，不一致即 `rejected_precondition`/`tx-scope-domain-mismatch`，跨域一律拒）、`TxHandle{txId, scope, writerId, fence?, expectedLineageHead?, openedAt, readOnly:false}`、`TxReceipt{txId, commitSeq?, recordIds, status:'committed'|'aborted'|'unknown', proofRef?}`——`abort` 也回回执，`unknown` 靠 `receipt(txId)`/`TS-PORT-REC-06` 对账消解。`TS-PORT-REC-05` 的 `CorrectionPort.propose` 必带 `expectedLineageHead`；`TS-PORT-REC-06` 的 `ReconciliationPort` 三方法 `reconcile`/`registerUnknown`/`resolveUnknown`。**不得**加“批量便捷方法”（绕过事务域边界）。**测试/证据**：本包只出类型面——信封与 `payloadRef` 的内联负向由 `F-contract-test-records-validate` 覆盖；载荷一致性、权检优先级、`payload(ref)` 四态与 `since`/`asOf` 互斥属 **V2 行为**，归 `store` 侧测试（03 卷），本包**不新增测试件、不新增 `REC-*`、不新增端口**。**实现未落地**：`records` / `record_payloads` / `record_transactions` 三表均不存在（80-§12.5 `U80-21`），`RecordWriter`/`RecordReader.payload` 只有类型。
- **`port-work` 的受理链**：`TS-PORT-WORK-01` 的 `WorkIntake.reserve(intent: RecIntentEnvelope): Promise<Result<{intentRef: Qid; bodyDigest: Digest; receivedAt: Timestamp; duplicate: boolean}, ClassifiedError>>` 是 `REC-WORK-01` 的**唯一写口**，必须在 daemon 写事务内执行（`txHandle` 由调用方持有），且**先落 `REC-WORK-01` 再 `engine.ingest`**：`intentRef`（= `REC-WORK-01.recordId`，类型 `Qid`）在追加时**立即产生**，不等相位 2；`engine.ingest` 只入内存队列、**不产生记录**，所以“先写回执行再补记录”的次序不成立。`intake(...)` 回 `Promise<IntakeOutcome>`；`IntakeOutcome{outcome:'accepted'|'accepted_with_conditions'|'deferred'|'rejected'|'forwarded'; recordId: Qid; conditions?: string[]; referredTo?: ReferralTarget; decidedAt: Timestamp}`——字段名统一 `outcome`（旧 `conclusion`/`conditionally_accepted`/`pending` 作废），**不得有第六值**；`referredTo` **仅** `forwarded` 时必填。`ReferralTarget{positionRef: Qid; deadline: Timestamp; notifiedAt: Timestamp}`——**三字段全必填**（80 无 `?`）：`positionRef` 的 kind 只能是 `position`/`governance-position`，由 `Qid` 校验期拒其他 kind，本包**不**写成 `Extract<SubjectRef,…>`（80 已把字段类型定为 `Qid`）。**`duplicate` 的判定按记录现算**：`reserve` 先查 `REC-WORK-01` 的幂等键（`intentKey`），命中才回 `duplicate:true` 并复用原 `intentRef`；`intentReceipts` 的 `get()` 快照**不得**用于重投判定（U80-15/S9）。`reserve` 与 `engine.ingest` 之间崩溃时，重放以**已在库的 `REC-WORK-01`**为唯一依据：记录在而队列未入 ⇒ 重新 `ingest(intentRef)`（不重写记录、不换 `intentRef`）；队列已在而记录没写 ⇒ 不可能发生（顺序铁律），此时视为缺陷而非可恢复态。
- **`port-work` 五门（`TS-PORT-WORK-03`）**：`ReadinessGate.judge(req: ReadinessRequest): Promise<Result<RecReadinessJudgment, ClassifiedError>>`——输入类型名是 `ReadinessRequest`、结论记录类型名是 `RecReadinessJudgment`（`REC-WORK-04`），**不用** `ReadinessInputs`/`ReadinessVerdict`/`ReadinessJudgment`。形状照 80-§6.4 逐字：
  - `ReadinessRequest` **八字段**：`contractRef: VersionRef<Qid>` / `authorityRef: VersionRef<Qid> | DefinitionRef` / `qualificationRefs: readonly VersionRef<Qid>[]` / `planRef: VersionRef<Qid>` / `resourceRef: DefinitionRef` / `informationRefs: readonly (VersionRef<Qid> | DefinitionRef)[]` / `prohibitionsRef: DefinitionRef` / `decidedAt: Timestamp`。引用分工：**合同/计划/资格是记录版本**（`VersionRef<Qid>`）；**权源可记录可定义**（`VersionRef<Qid> | DefinitionRef`）；**信息项可记录可定义**（`readonly (VersionRef<Qid> | DefinitionRef)[]`）；**资源额度/禁止清单是定义**（`DefinitionRef`，额度与禁止清单不是 `REC`）。**禁** `VersionRef<RecordRef>` 这类套嵌（版本引用只包 `Qid`）；**风险引用不是门输入**（不得加 `riskRef`，风险分类 `TS-PORT-WORK-09` 是验收与降档的材料）。
  - `GateResult` **七字段**：`gate: ReadinessGate`（五值英文字面量 `'authority'|'capability'|'resource'|'information'|'prohibition'`，**不收中文别名**）/ `criterionRef: ProfileRef`（判据是**规则档**，不是记录版本、也不是定义版本）/ `verdict: ReadinessVerdict` / `basisRefs: readonly RecordRef[]` / `judgedBy: SubjectRef` / `role: ReadinessJudgeRole` / `authorityRef: VersionRef<Qid> | DefinitionRef`。判据/依据/具名判断者/权源**一律从权威引用解析**，不采信请求体自报。
  - `ReadinessCondition`：`{condition: string; ownerRef: SubjectRef; dueAt: Timestamp; onMiss: 'pause'|'forward'|'reject'}`（漏期三处置是封闭集）。
  - `RecReadinessJudgment` **13 字段全列**：`contractRef: VersionRef<Qid>` / `decidedBy: SubjectRef`（**具名**任职者/各门具名判断者，不得只写"承接者"）/ `authorityRef: VersionRef<Qid> | DefinitionRef` / `gateResults: readonly GateResult[]`（**恰五门**，一门一条、不重不漏、缺一门即不合格）/ `verdict: ReadinessVerdict` / `scopeJudged: {judged: string; notJudged: string}`（须写明"不判验收、价值与后续变更"）/ `conditions?: readonly ReadinessCondition[]` / `judgeRole: readonly {gate: ReadinessGate; role: ReadinessJudgeRole}[]`（**逐门列表**、恰五门，且与 `gateResults.role` **逐门同值**）/ `decidedAt: Timestamp` / `repudiationTriggers: readonly string[]` / `resourceBaseline: ResourceBaseline`（由 `TS-PORT-RES-01` 在判门前现算，见 `ports/resources.ts` 条）/ `dissentPosition: DissentPosition`（**必填**，不得省略为"无异议"字符串）/ `decisionFacet: DecisionFacet`。字段级中文名与 77-§4.4.1 的 13 行一一对应，本包不另立 `readiness` 子对象。
  - **三值口径**：`ReadinessVerdict = '可开工'|'附条件开工'|'不可开工'`，`GateResult.verdict` 与整单 `verdict` **共用同一词表**（**中文即 payload**），不得改写成 `ready`/`not_ready`/`conditionally_ready`，不得借受理五值或验收四值，**不得有第四值 `refused`**（门的规则求值 `refused` 只导致整单判 `不可开工`）；`verdict` **不得压成 boolean**（布尔化会丢掉"附条件"这一档，禁止 `ready: true|false` 一类降维）。
  - **角色映射**：`ReadinessJudgeRole = 'assignee'|'authorizer'|'qualifier'|'resource_owner'|'info_holder'|'prohibition_owner'`（**英文只作内部承载**），写入记录的六个位置名**只有中文**：`assignee`=承接者、`authorizer`=授权者、`qualifier`=认定位置、`resource_owner`=资源责任者、`info_holder`=信息持有者、`prohibition_owner`=禁止清单所有者；一一映射、**不得另起 `roleCode`** 或再加一列英文。
  - **聚合规则**（77-§4.4.1 写死）：任一 `不可开工` ⇒ 整体 `不可开工`；否则任一 `附条件开工` ⇒ 整体 `附条件开工` 且条件全部进 `conditions`；全 `可开工` ⇒ `可开工`。`conditions` 非空只在整体 `附条件开工` 时出现，其余状态带非空 `conditions` 即违约。
  - 顺序铁律：**合同 → 计划锁（写 `REC-WORK-05.resource_reservations`）→ 五门（读 `resourceBaseline`）→ 出工段**，不得循环；**先五门、后并发四闸**；断路器前置且**不计入**闸数（80-§6.4 的 `TS-PORT-WORK-03` 与 `TS-PORT-RES-01` 两处顺序条）。
- **`port-work` 其余端口**：`TS-PORT-WORK-02 ContractPort` 版本链追加、不原地改；`TS-PORT-WORK-04 ExecutionPlanPort.lock` 除了钉六件 `VersionRef`，还**必须在计划锁里写 `REC-WORK-05.resource_reservations`**（逐项 `{resource_ref, amount, unit, period, quota_ref}`，`amount` 用 `DecimalString` 不用 `number`）——这是预留的**唯一写入点**；**空列表 ≠ "资源充足"**，只能表示"本计划不预留"，资源门仍须按 `TS-PORT-RES-01` 现算基线；锁一旦写入不得原地改，变更走新版本；`TS-PORT-WORK-05 WorkLifecycle.transition` 的 `TransitionExpectation{expectedState, expectedLineageHead}` **双必填**，且 `REC-WORK-09` 的 **`dissent_position` 必填**——只能取 `trigger_ref` 记录载明的异议位置或 `authority_ref` 规则版本指定的位置，**两者都无 ⇒ 拒写**（`rejected_precondition`），**不得虚构全局默认值**、不得写空串占位；`from_state`/`to_state` 只写 §5.1 的十个中文态名（见下 `WorkState` 条），不收英文别名；`TS-PORT-WORK-06 ExceptionPort` 四段（发现/接收/升级/终局）；`TS-PORT-WORK-07 SettlementPort` 八项 + `status()` 五值（含 `in_liquidation`）——**`TS-PORT-LIFE-01` 是公司身份生命周期，不能证明“工作终止”**；`TS-PORT-WORK-08 QualificationPort` 只判资格、不授权不安装；`TS-PORT-WORK-09 RiskClassifier` 交付方**不得自评**；`TS-PORT-WORK-10 AssignmentPort.actionKind` 11 值；`TS-PORT-WORK-11 AttendancePort` 六面。`WorkState`（十态）的**族登记**归 **76-§7.7（`STAT-D`）**，**十态全集与迁移表**归 **77-§五/§5.1/§5.3**（受理中/待开工/进行中/暂停/待验收/返工/已接受/已拒绝/已终止/已结清，只有中文名，规范位置另指 71-§5.1）；80-§4.7/§6.4 引用它却**未给英文/下划线字面量** → 本文件先声明 `WorkState` 为不透明字符串别名，**不得自造英文十态**（G-22）。
- **`port-capability`**：六个动作**六个端口**，不得合并为 `CapabilityManager`（80-§6.5；合并会把安装/挂载/生效混为一谈）。
- **`port-effects`**：`EffectGateway.apply` 回 `Result<EffectOutcome, EffectError>`。`EffectOutcome` 是**判别联合、两态都必带回执引用**（80-§6.6/§5.2）：`{status:'applied'; receiptRef: Qid}`——`receiptRef` 指向**先落库的 `REC-RCP-01`**；`{status:'unknown'; unknownRef: Qid; reason?: string}`——`unknownRef` 指向**先落库的 `REC-EVT-03`**（`origin.kind='work-intent'` 时其 `unknown_scope.intentRef` 必须指回 `REC-WORK-01.recordId`，其他来源按 `sourceRef` 关联）。**先落记录再 `Ok`**：`applied` 先取得外部回执并写 `REC-RCP-01`，`unknown` 先写 `REC-EVT-03`；**登记失败即 `Err({failure:'unavailable', category:'STALL', subcause:'unknown-record-unwritten'})`**，不得以无引用的 `Ok({status:'unknown'})` 收场——否则重放判定失去唯一支点。`rejected`/`partial` 走 `Err`（`rejected_authority`/`rejected_forbidden`/`partial`），**不**作为成功返回里的 status；`unknown` 留在 `Ok` 因为"外部做了什么不知道"不是拒绝、也不能当失败重试。`EffectDescriptor`/`EffectTarget`/`EffectOrigin` 的完整字段见 80-§4.3.1；`EffectCredentialBroker` 负责解析或现签当次凭据，token 不进请求、帧、日志或记录。`failure='partial'` 时 `EffectError.partialItems` 逐项携带 `key/status/receiptRef?/unknownRef?/error?`，`applied` 必带回执、`unknown` 必带未知引用、`failed` 必带分类错误。`EffectAction` 与映射后的实际 `gatewayAction` 的 scope 都须通过，不能只验 `comment`。`EvidenceHarvester` 只收材料、不判验收；`AcceptanceEvaluator` 的证据包**不含** `REC-EVD-05`；`MemoryStore` 四层不合并；`ObservationProjector.project/faults` **无 `Result` 通道**（返回六态视图，不是拒绝）。
- **`port-binding`（`TS-PORT-BIND-01`，新文件 `src/ports/binding.ts`）**：`PlatformBindingPort{describe, mapState, exportBundle, exitPlan}`（80-§6.6 签名逐字）。**类型在本包、实现不在本包**：
  - `describe(): Promise<Result<BindingProfile, ClassifiedError>>`；`BindingProfile` **20 字段**（逐项对应 78-§1.2，本文件只引用不改写）：`bindingId`/`version`/`semanticDigest`/`title`/`ownerPositionRef: Qid`/`scope`（companyRefs/deploymentRefs/hosts/platforms/stores）/`coreClauses`/`coveredObjects`/`uncoveredObjects`（必填、可空）/`fieldMappings`/`stateMappings`（带族名，`ours` 只许 `STAT-D`）/`provisioning`（缺 `pinnedVersion` = 不得供给）/`authorization`/`effective`/`evidence`/`losses: readonly Qid[]`（**`REC-LOSS-01` 引用、不内联**）/`exportMigrationExit`/`probes[]`（`state` 三态 `executed|not-executed|not-applicable`，未执行不得写“预期通过”）/`factStatus: BindingFactStatus`/`supersedes?`+`supersededBy?`。缺任一必填 = 档案不完整，不得用散文补。
  - `mapState(platformState: string): Result<StateMapping, ClassifiedError>`；`StateMapping{platformState, workStates: readonly WorkState[]（只许 STAT-D 值）, verification:'verified'|'unverified', unmappedBehavior:'observe-unmapped', note?}`——**无 `mapped` 字段**。三分支：① 已映射且可核验 → `Ok({verification:'verified',…})`；② **未映射但输入合法** → `Ok({verification:'unverified', workStates:[], unmappedBehavior:'observe-unmapped'})`（映射损失是可观测事实，不是调用失败）；③ 输入空/畸形 → `Err(rejected_precondition)`。**本函数是纯函数**：零 IO、不读时钟、**不写 `REC-OBS-02`、不写任何记录**——记录由**消费方**（相位 2 的 state-diff 或 `TS-PORT-OBS-01` 观察面）在读到 `unverified` 时写，同一单、同一原值、同一拍只写一条（80-§6.6 三层第 6 条）。**不得**把 ② 写成 `Err`、不得回落默认态、不得静默丢观测；`workStates=[]` 的消费方**不得**推进迁移/验收/结清（拒绝在消费方，不在端口）。
  - `exportBundle(scope: ExportScope): Promise<Result<ExportBundle, ClassifiedError>>`：`ExportScope` 带 `knowledgeScope` 与 `memories.excludeSecrets: true`（秘密默认排除且不可关）；`ExportBundle.manifest.bundleId` **不是 qid**（导出包是产物不是记录）、`manifest.shape` 是**声明**不是“全都装了”、`openObligations` 在迁移/退出中**不可省**；超出 `knowledgeScope` ⇒ `rejected_forbidden`。导出记录 opaque，不得驱动决策。
  - `exitPlan(): ExitPlan`（纯声明、无拒绝通道）：九段 `freezeWriter`/`exportVerification`/`acceptance`/`fence`/`lateReconciliation`/`activation`/`withdrawal`/`archive{mode:'read-only'; deleted:false}`/`exit{completedAt?, unresolved[]}`。**读一个 ExitPlan ≠ 退出完成**：状态迁移走 `TS-PORT-WORK-05`（`REC-WORK-09`）、移交/档案走 `TS-PORT-LIFE-02`（`REC-LIFE-02`）、承继走 `TS-PORT-LIFE-03`（`REC-LIFE-03`）；旧平台退出后**只读不删除**。
  - **三层归属与分工**（80-§6.6「BIND-01 的三层归属」/D27，施工照此）：**① 类型只有一处**——`PlatformBindingPort`/`BindingProfile`/`StateMapping`/`ExportScope`/`ExportBundle`/`ExitPlan` 的形状只在本文件，平台包与 daemon **只引用**，不得各抄一份；**② 端口宿主只有一个**——通用实现在 `apps/daemon/src/assembly/platform/binding.ts`（组装 `describe()`（执行探针、合并档案、按需写 `REC-LOSS-01` 引用）/`exportBundle()`/`exitPlan()`，并把平台包给的纯函数接到 `FlowPlatform` 上；同目录已有 `wire.ts`，子域不占域平面名额），**不在本包实现**；**③ 平台包只供平台特定数据**——`packages/localplatform/src/binding.ts`、`packages/taiga/src/binding.ts`、`packages/yt/src/binding.ts` 只导出**纯**函数/常量 `bindingProfile()`（档案骨架，不含运行期探针结果）/`mapState(platformState)`/`lossReport()`（`RecBindingLossReport` 数据或 `REC-LOSS-01` 引用清单），**不得**导出 `describe`/`exportBundle`/`exitPlan`，不得读台账、写记录、起网络、读时钟。**禁第二实现**：`PlatformBindingPort` 全仓有且仅有一处实现（上述宿主）；平台包出现完整端口实现或 `appendEvent`/`RecordWriter` 之类写口即判双实现/越界。依赖方向已够，**不新增包边**（`…→contract` 与 `daemon→{localplatform,taiga,yt}` 均在允许集内）。`FlowPlatform` 仍是**能力端口**（issues/comments/fields/kb/activity/links/guards）；`ports/company.ts:9` 的 `PlatformBinding` 是快照字段（不同物，**不改名**，G-05 关闭）。**实现与平台档案均未落地**（本包只出类型面）。
- **`port-effects` 迁移面**：`MigrationService.plan` 回 `MigrationPlan{planId, planDigest, fromAxis, toAxis, from{version, semanticDigest}, to{version, semanticDigest}, scope, phases[], dryRun{required:true, reportArtifactRef?}, actions[], lossRefs: Qid[], stopConditions[], rollback{possible, steps?, snapshotArtifactRef?}}`——`reportArtifactRef`/`snapshotArtifactRef` 是 **artifact 引用**（`ArtifactRef`）**不是 qid**，`lossRefs` 才是 `Qid[]`；`MigrationActionKind = 'map'|'rewrite'|'rekey'|'archive'|'verify'`；`MigrationReceipt{planId, migrated[], losses[], status:'applied'|'partially_applied'|'aborted'|'unknown', proofRef}`。导出记录是 **opaque**，不得驱动决策（80-§6.6）。
- **`port-effects`** 只装 EFF/EVD/MEM/OBS/MIG；绑定档案与 `PlatformBindingPort` 一律走 `ports/binding.ts`（见上条），**不得**在 `effects.ts` 留一份转发或别名。
- **`port-lifecycle`**：`TS-PORT-LIFE-02 HandoverArchivePort` 与 `TS-PORT-LIFE-03 SuccessionPort` 都要出损失报告（`REC-LIFE-04` 两处都出），不得只在一处声明。
- **`port-resources`（`TS-PORT-RES-01`，新文件 `src/ports/resources.ts`）**：职责是**只读**的资源评估，两方法、无第三方法——`baseline(req: ResourceBaselineRequest): Promise<Result<ResourceBaseline, ClassifiedError>>` 与 `gap(subject: SubjectRef): Promise<Result<readonly ResourceGap[], ClassifiedError>>`。**非职责**：不写记录、不写投影、不提供任何写口、不做准入判断（准入在五门的 `resource` 门）。**无** `reserve`/`actual`/`release`，**无** `Qid` 回执，**不新增** `REC-*`——资源事实分别落 `REC-WORK-05.resource_reservations`（预留，见 `TS-PORT-WORK-04` 条）、`REC-EVD-01`/`REC-EVD-05`（实际消耗）、`REC-EVD-06`（释放）；`resource_ledger` 是**派生投影的物理表名**，其投影名 `resourceLedger` 已在 80-§6.3 **登记为目标名**（属 `TargetTableProjectionName`；`TableProjectionName` 仍 17 张、不含它），**实现与建表未落地**（`MIG-01`，见 G-27）；删表可由记录重建，不得当第二事实源。形状逐字照 80-§6.4 末：
  - `ResourceBaselineRequest{subjectRef: SubjectRef; quotaRef: DefinitionRef; asOf: Timestamp}`；`ResourceBaseline{subjectRef; quotaRef: DefinitionRef; entries: readonly ResourceEntry[]; asOf: Timestamp; gaps: readonly ResourceGap[]}`。
  - `ResourceLimit` **三态穷尽**：`{kind:'finite'; amount: DecimalString}` / `{kind:'unbounded'}` / `{kind:'unknown'; reason?: string}`——`amount` 是 `DecimalString` **不是** `number`；`unknown` 不得退化成 `finite 0`；`unbounded` 必须有权威定义支撑，**不等于**"还没读出来"。`limit.kind` 非 `finite` 时 `remaining` 必须缺省（`unknown` 不能写"剩余=全部"，`unbounded` 也不给等式）。
  - `ResourceEntry{resourceRef: DefinitionRef; unit: string; limit: ResourceLimit; reserved?: DecimalString; consumed?: DecimalString; remaining?: DecimalString}`——**缺省即"未知"，不是 0**（无预留记录 ≠ 没预留）；有限额度下 `reserved`/`consumed` 任一缺省 ⇒ 必给 `reservation-record-missing`/`unreconciled-actual` 缺口（两者都缺就两条都给），且该 entry **不给 `remaining`**（不得用 0 或 limit 顶替），资源门不得据此判"充足"；反过来，只有三值齐备且 `remaining = limit.amount − reserved − consumed` 成立，该 entry 才是"可判充足的完整证据"——等式只在三值都有时校验，缺值先按缺口处理、不进入等式（不得"没值就跳过并当 0"）。
  - `ResourceGap` **四 kind 穷尽**：`{kind:'quota-unreadable'; resourceRef: DefinitionRef; reason?}` / `{kind:'over-reserved'; resourceRef: DefinitionRef; detailRef?: RecordRef}`（预留 > 额度）/ `{kind:'unreconciled-actual'; resourceRef: DefinitionRef; detailRef?: RecordRef}`（实际与记录对不上）/ `{kind:'reservation-record-missing'; resourceRef: DefinitionRef}`（记录里查无预留）。`detailRef` 是**记录引用**（`RecordRef`），不是 `Qid` 回执。
  - **缺口非空仍是 `Ok`**：`gaps` 携带结论，不把"账目有缺口"报成 `Err`；错误映射照 80：额度定义不可解析 → `Err(rejected_version)`，主体与计划/结清不一致 → `Err(rejected_precondition)`，记录侧不可读 → `Err(unavailable)`（**不得**返回"剩余=全部额度"冒充充足）。`gap(subject)` 与 `baseline().gaps` 必须同源同判据，不得两套算法；`baseline` 只读"定义 + 已提交记录"，不触发新的计划锁，同一 `(subjectRef, quotaRef, asOf)` 重算须逐字段一致。本文件零 IO、零 `node:fs`，实现归 `core/src/resources/`（纯求值）+ `store/src/resources/`（读投影）。
- **`port-intent`（`TS-PORT-API-01`）**：路径由 80-§12.3 **指名**，不得挪进 `work.ts`；`submit(intent: WebhookIntentPayload): Promise<Result<IntentSubmitResult, ClassifiedError>>`、`receipt(key: IntentKey): Promise<IntentReceipt | undefined>`（`IntentSubmitResult{receipt, duplicate}`）——`undefined` 是“未登记”，**不是**拒绝，不得包成 `Err`。`IntentIngress`（80-§6.6）**是 daemon 侧组件、不是本包类型**，它 `implements IntentSubmissionPort` 且只暴露 `submit`/`receipt`。`IntentReceipt` 是由 `REC-WORK-01/02`、`REC-EVT-03` 导出的**投影**，其投影名是 `'intentReceipts'`（`TableProjectionName` 成员，**不是** `'observation'`）；`intent_receipts` 是投影表、删表可重建，本包不得把它声明成记录或第二事实源。`receipt()` 只读**已提交的内存快照**（投影与记录同事务写入，`commit` 之后才可见），**不回库**；因此它**不得用于重投判定**——重投一律按 `REC-WORK-01` 的记录现算（U80-15/S9）。五值 `outcome` 与三值 `status` 是**两个轴**（§4.10），不得混用。
- **`port-secret`**：`SecretMaterial` 只活受控内存，`value` 不得进任何可序列化面（80-§11.2.1）；`load(entry, use)` 必须带 `use`，`use ∉ allowedUses ⇒ Err(rejected_forbidden)` 且**不**返回“最接近”的值；`KnownSecretSet` **六成员**照 80-§11.2.1：`secretIds`/`state`（三值）/`missingSecretIds`/`redactKnown(text)`/`redact(text)`/`find(text)`——**`redactKnown` 只替换已知值、不做形状兜底**（内部面：日志/回显/内部消息），`redact` 是**已知值 + 形状兜底**（出站面），两者不可互换、不得只留一个；`find` 只作诊断（返回 `SecretShapeFinding[]`），**不得当门禁**（形状命中 ≠ 泄露判定）。`knownValues` **只存在于工厂闭包里**：不以属性、参数或返回值暴露，`SecretMaterial` 与任何原始值都不出闭包。`redactKnown`/`redact`/`find` 直接复用 `../secrets.ts` 的纯函数，**不新造算法、不加第四种 `kind`**；`state` 三值不得混同（`known-set-empty` 合法、`known-set-partial` 必须拒启动该能力并落 `REC-LOSS-01`）；本文件**不新增 `REC-*`**、不让 worker 拿到值。`MatrixBotLoginSecret` 与 `MatrixHrRegisterSecret` **均不属本包**——两者都在 80-§3.4 的 daemon `RunServeOpts`/`MatrixSessionFactoryDeps` 里：`MatrixBotLoginSecret`（登录句柄：`secretId:'SEC-MX-BOT-PASSWORD'`、`kind:'password'`、`use:'platform-auth'`）必填；`MatrixHrRegisterSecret`（建号句柄：`secretId:'SEC-MX-HR-SHARED'`、`kind:'shared-secret'`、`use:'matrix-register'`）仅在建号能力开启时给。**两者不得互换**：建号只用 HR 共享秘密、不得用 bot 密码建 HR 账号，登录只用 bot 密码、不得拿 HR 共享秘密登录。**`SEC-MX-BOT-PASSWORD` 的 `allowedUses` 只有 `platform-auth` + `outbound-redaction`**（不含 `matrix-register`——v0.8 起不设“保留未用”的槽位，给了也判配置非法）；建号句柄 `registration` 只能取 `SEC-MX-HR-SHARED` 的 `matrix-register` 槽。80-§11.2.1 的表与 D23、78-§7.4.1（`docs/78-…:1015`/`:1022`/`:1518`/`:1877`）现均已是**恰两用途** `platform-auth` + `outbound-redaction`（G-29 已于 v0.10 关闭）。任何一份都不得复制进 `ports/secret.ts` 充数。

### 4.2 记录绑定（5 件）

| F-ID | 文件 | 内容与约束 | IO/状态 | 证据 | 规模 |
|---|---|---|---|---|---|
| F-contract-rec-scalars | `src/records/scalars.ts` | `Qid`/`QidView`（TS-SCALAR-02，交换形状仍是字符串）、`Timestamp`/`TimestampView`（03，`text` 权威、`epochMs` 只比较）、`DecimalString`（04，禁前导零/指数，≤34 有效数字）、`SemVer`（05）、`VersionRef<T>`（06，`semanticDigest` 必填）、`Extension`（07）、`Digest`（08，`semanticDigest` 带 `canonicalizationId`、`byteDigest` 必不带；`sha8` 只作展示）、`FailureClass`（10，14 值，77 原样下划线）、`MoneyAmount{amount: DecimalString; currency: string}`（09 的公共金额别名；本卷给名，字段来自 80-§4.1）。**非职责**：不做解析/校验（解析器在 `records/validate.ts`，`QidView` 只由调用方按需生成）；**不含 `Diagnostic`**（落 `ports/spec.ts`，见 §4.1） | N/A：纯类型 | 类型检查；正反样例在 `test/records/validate.test.ts`（Qid 三段缺一、decimal 前导零、digest 混用、`FailureClass` 非 77 字面量） | ≤200 |
| F-contract-rec-refs | `src/records/refs.ts` | `RecordRef`/`DefinitionRef`/`ExternalRef`/`SubjectRef`/`ArtifactRef`/`ProfileRef`（TS-REF-01…06）、`Provenance`（TS-PROV-01，`limitations` 必填）。**非职责**：不证明被引用对象真实/有效（80-§4.3） | N/A | 类型检查 + `limitations:''` 负向（80-§4.3 要求 81 登记该用例） | ≤120 |
| F-contract-rec-envelope | `src/records/envelope.ts` | `RecordEnvelope<TPayload>`：字段照 80-§4.2 逐字段 **19** 槽（v0.10 更正旧写“15 槽”）；`payloadRef: ArtifactRef`（= TS-REF-05，**不另造 `PayloadRef`**）：`contentDigest` 是**原始载荷 `byteDigest`**（非语义摘要、不带 `canonicalizationId`）、`mediaType` 须与写入时一致、`storageHint` 只是**逻辑定位**（非本机路径、非可读性证明、非权限凭证）；不内联 payload（只 `payloadRef`）；`knowledge` 必填不兜底；`integrity` 至少一摘要；`scope`/`lineage` 一致性由校验器（非类型）保证。**非职责**：不定义 payload 字段（在 `payloads/**`）、不定义 `RecordPayload`/`RecordWriteInput`（落 `ports/record.ts`）、不做 I/O | N/A | 类型检查；六条约束的负向在 `test/records/validate.test.ts` | ≤170 |
| F-contract-rec-validate | `src/records/validate.ts` | `ValidationIssue`/`ValidationOutcome`（从 `schemas/events.ts` **迁入**，成为唯一定义）、`validateRecord(env: unknown): ValidationOutcome`（两步：形状→语义）、`validatePayloadRef`、`parseQid`/`parseTimestamp`/`parseDecimal`（返回 `Result`，不外抛）、`assertEnvelope`（内部）。**非职责**：不写库、不生成 id/时间、不做授权判断 | N/A（纯）；`now` **不注入**——校验不依赖当前时间（`effectiveTime` 只做形状与相对关系） | 语义规则来自 76-§4.2 六条 + 77-§1.x；负向用例 12 条以上（见 F-contract-test-records-validate） | ≤240 |
| F-contract-rec-defrecords | `src/records/def-records.ts` | 76 侧记录（不属 77 的 50 类，80-§4.8）：`RecMigration`（76-§8.3）、`RecBindingLossReport`（76-§8.4，**不得**与 `RecLossReport` 共名/共 `recordType`）、`RecCase`/`RecCaseFixture`（76-§9.2 `REC-CASE-01`/§9.5 `REC-CASE-02`）。**非职责**：不承载 R1–R31 正文（归 82） | N/A | 类型检查；`bindingProfileRef` 的“core 必空 / binding-supplement 必填”负向各一 | ≤150 |

### 4.3 记录 payload（6 件，50 类）

共通契约：一文件对应 77 的章段，**一类一 interface**，字段名/必填/空值一律照 77 原表（本附录不复制字段）；每类以 `recordType.name` 的值（`REC-*`）作为判别键，`payloads/index.ts` **不建**（避免第 25 件与额外索引文件），由 `records/validate.ts` 按 `recordType.name` 直接分派到具体校验片段。

| F-ID | 文件 | 记录类（77 章段） | 规模 |
|---|---|---|---|
| F-contract-rec-payload-command | `src/records/payloads/command.ts` | `REC-CMD-01`/`REC-CMD-02`、`REC-DEC-01`、`REC-RCP-01`、`REC-COR-01`、`REC-EVT-01`/`REC-EVT-02`/`REC-EVT-03`（8 类，§2） | ≤220 |
| F-contract-rec-payload-authority | `src/records/payloads/authority.ts` | REC-AUTH-01…08（8 类，§3） | ≤200 |
| F-contract-rec-payload-work | `src/records/payloads/work.ts` | REC-WORK-01…11（11 类，§4–§5） | ≤300 |
| F-contract-rec-payload-evidence | `src/records/payloads/evidence.ts` | REC-EVD-01…08、REC-EXC-01/02（10 类，§6） | ≤280 |
| F-contract-rec-payload-obligation | `src/records/payloads/obligation.ts` | REC-OBL-01…03、REC-MEM-01…03（6 类，§7–§8） | ≤180 |
| F-contract-rec-payload-lifecycle | `src/records/payloads/lifecycle.ts` | REC-OBS-01/02、REC-LIFE-01…05（7 类，§9–§10） | ≤200 |

- 依赖：`import type` 到 `records/refs.ts`/`scalars.ts`；零运行期。
- IO/状态/并发：N/A（纯类型）。记录的幂等键/预期版本/并发语义在 77-§1.3–1.5，不在本层重复。
- 错误：payload 的失败分支归 77-§11.1，用 `FailureClass`（已落 `scalars.ts`，G-16 关闭）；本层不定义新枚举、不加第 15 个失败值。
- **两处字面量纪律（易错，单列）**：① `policy_verdict` **只写四个英文机器值** `permitted`/`reserved`/`prohibited`/`uncovered`（77 决定类记录），中文只作语义说明、**不入 payload**，也不得加第五值；② `appointment_kind`（主表在 `REC-LIFE-05`，77-§10.6.1）**只写四个中文值** `任命`/`兼任`/`代理`/`替补`，**不设英文别名**（`appointment`/`concurrent`/`acting`/`substitute` 非法）。二者方向相反：一个"英文字面量 + 中文说明"，一个"中文字面量 + 无英文"，不得互相套用。
- `REC-WORK-09.state_family`/`from_state`/`to_state` 只写 §5.1 的十态中文名；`dissent_position` **必填**且只能取 `trigger_ref` 记录载明的位置或 `authority_ref` 规则版本指定的位置，两者都无 ⇒ 该记录**拒写**（`rejected_precondition`），不得虚构全局默认。
- 两处字段级硬约束（v0.3 补）：① `REC-WORK-01.source` 的子键固定 `{channel, dedupKey, ticket?, kind}`——它是 `IntentKey` 的**唯一还原来源**（公式见 §4.10），不得改成自由对象；② `IntentReceipt` **不是记录类型**、不在 50 类里，它由 `REC-WORK-01/02` + `REC-EVT-03` 投影得到（`ports/intent.ts`）。
- 证据：`validateRecord` 的按类负向（缺必填、`*_id` 与 `recordId` 不同值、decision facet 槽位缺失）；本轮只要求“每章至少 2 类正反”，不追求 50 类全覆盖（覆盖判定归 82 的 U80-14）。
- 规模：每文件 ≤300 行（work 11 类最紧，约 260）。

### 4.4 规范化与秘密脱敏（2 件）

**F-contract-canon** · `src/canon.ts` · 目标-新增 · 上位 80-§4.5、76-§1.5.1。
- 职责：声明 `Canonicalizer{ id:'studio-next/jcs@1'; canonicalize(value: JsonValue): Uint8Array }` 的类型面，并把“四条禁令”（不改 decimal、不改 timestamp、不补键、不重排数组）写成文件头纪律。非职责：**不实现** jcs@1（76-§12 明示向量未执行、状态 `vectors-published`；80-§12.5 U80-01 未证）。
- 导出/依赖：`JsonValue`（本文件定义或从 `records/scalars.ts` 取，需在实现时二选一并保持单一定义）+ `Canonicalizer`。零运行期 import。
- IO/注入/状态：N/A（纯类型 + 纪律注释）。`canonicalize` 必须是纯函数：不读时钟/环境、不访问 fs。
- 错误：拒绝 `NaN`/`Infinity`/重复键/lone surrogate/超范围数值 → 实现侧抛 `configInvalid('canon/…')`；本文件只声明“必须拒”，不定义 subcause 词表（词表归实现，加词走批示）。
- 证据：**未证**——文件存在不等于 jcs@1 可用；冻结工件（`exchange/**`）的 `semanticDigest` 在本文件有实现且通过 76 向量前**不得**填。
- 规模：≤80 行。迁移：先落类型，jcs@1 实现与向量复算作为独立事项（82 的 V0/V2）。

**F-contract-secrets** · `src/secrets.ts` · 目标-新增（自 `packages/core/src/secrets.ts` **整模块迁入**，只改归属不改语义）· 上位 79-§3.6、80-§11.2-3、D75-13。
- 职责：出站脱敏的三个纯函数——`redactOutbound(text, knowns?)`、`redactKnownSecrets(text, knowns)`、`findSecretShaped(text)`（只报形状）；连同 `SecretShapeFinding{kind:'bearer'|'assignment'|'long-token'; at:number}`、标记形 `<redacted:N>`、`MIN_KNOWN_LENGTH=6` 一并落此。非职责：**不扫描需认证的入站秘密**（`Authorization`/`wkey`/`X-SN-Token` 是校验对象，先脱敏会让验签永远失败，80-§11.2-3 调用边界第 4 条）；不判定“能不能发”（正则只是形状、已知值只是下界，脱敏通过 ≠ 可安全发布）；不记录命中片段/前后文/前缀后缀/长度分布。
- 现状与迁移：现 `packages/core/src/secrets.ts` **80 行**、零 IO、零外部依赖（`RegExp` + 字符串操作）；迁入后 `core` 只留**具名 re-export**（`export { redactOutbound, redactKnownSecrets, findSecretShaped } from '@studio-next/contract'`，**不用 `export *`**），过渡期 `assembly/hrsync/assemble.ts:59` 可继续从 `@studio-next/core` 取，收尾后改直连 `contract`；`core` **不得**留第二套实现或第二份正则（80-§11.2-3）。
- 内部结构（逐字保持，禁“顺手优化”）：`REDACT_MARK(len)`、`MIN_KNOWN_LENGTH=6`、三条正则 `BEARER_RE`/`ASSIGNMENT_RE`/`LONG_TOKEN_RE`（赋值正则的 `(?!<redacted:)` 负前瞻冻结）、`redactKnownSecrets`（去重 → 过滤 `<6` → 长度降序 → 逐值 `split/join`）、`findSecretShaped`（三次 `matchAll`，`at` 只对替换前原文有效）、`redactOutbound`（顺序冻结：已知值 → `Bearer` 尾段 → 赋值对值段 → 独立长串）。
- 导出/依赖：**零外部依赖**（连 `zod` 都不用，不改 `package.json`）；`src/index.ts` 增第 6 段导出“脱敏纯函数”，`ports/secret.ts` 从本文件取 `SecretShapeFinding`。
- IO/注入/状态：纯函数，零 IO、零时钟、零随机；无状态、无并发语义。
- 证据：`packages/core/test/secrets.test.ts`（77 行）是**冻结验收口径**（80-§11.2-3）：`'密码 s3cret-value 错误' → '密码 <redacted:12> 错误'`、长值优先（`['abcdefabcdef','abcdef']` 只出一个标记）、 `<6` 不替换、重复值去重单次、`redactOutbound` 先已知值后形状兜底、中文句零命中、ULID 26 位不触发 `long-token`。迁移的证明是“`core` 原测试一行不改仍绿”（**本次未运行**）。v0.3 起契约层另建 `test/secrets.test.ts`：把同一组断言**逐条复制**（不重写语义、不替换口径），用途是 `core` 的 re-export 退役后仍能守住冻结行为；两份测试的断言文本必须一致，任一侧先红即判迁移失败。与 R/E/W：本文件不承载 R1–R31；对 V4（安全）只提供工具，不证明“九处强制点都调了它”（那归 82/装配面）。
- 规模：≤120 行（现 80 行 + 迁入头注与导出注释）；不拆。

### 4.5 冻结交换工件（1 索引 + 4 工件；本轮一律不冻结）

定位（v0.3/v0.4）：交换工件是**公共结构的机读一面**（76-§1.1 第 2 条：“schema 是同一规范的另一面”），与规范同版本发布，不是实现表的导出。入选三条判据：① 结构在 76/77/80 有字段表（不是实现细节）；② 有 authoring 来源（本包 zod）；③ 至少存在一个**非 TS 读者或跨进程/跨语言边界**。按此三条：`ledger-event` 出局（纯台账投影、无外部读者、80-§4.6 已定 `EventRecord` 是投影），`diagnostic` 出局（① 76-§1.7 的 14 个**非规则**码在本包无 TS 承载；② 80 只为 rules 面定了 `location`/`expected`/`actual` 的 TS 形，通用 `DEF-DIAG-01` 基形（非规则码那 14 个）尚无定稿 TS 形，冻结即钉死未定结构——G-19），`summary-sidecar`/`classified-error` 入选（跨 git 目录 / 跨 HTTP 边界）。76-§12 与 76:2361 明写“本阶段不冻结 schema、冻结走独立提案 + 制作人终审”，所以本节五件**全部 `status:'draft'`**，本附录不预支冻结结论。

**F-contract-exchange-index** · `exchange/index.json` · 目标-新增 · 上位 75-§4.1/4.2、D75-08、76-§4.2。
- 职责：登记“本包有哪些待冻结/已冻结工件、各自由哪段 authoring 生成、当前摘要与状态”。非职责：**不是工件**（不出现在自己的 `artifacts` 里）、不是 76-§2.3 的定义包 manifest、不被 `src` 运行期读取、不出境。
- 结构（字段逐项有上位，不新设“工件 ID”）：`{ indexVersion: 1, artifacts: [{ file, upstream, specVersion?, artifactVersion?, jsonSchemaId?, byteDigest, semanticDigest?, status: 'draft'|'frozen', authoringModule? }] }`。键 = `file`；`indexVersion` 是**索引自身格式**的版本（索引不是工件，不套 76-§4.2 的“工件自身版本”）；`specVersion`/`artifactVersion`/`jsonSchemaId` 分别对应 76-§4.2 的“规范版本 / 工件自身版本 / 稳定 `$id`”；`byteDigest` 用 `sha256:<hex>`（由 drift 测试以 `node:crypto` 对文件字节计算，不经 JCS；`src` 运行期不算）；`semanticDigest` 只在 `canon.ts` 落地且 76 向量通过后可填（U80-01）。
- 规则：`status:'frozen'` 必须同时满足 ① 文件存在且可解析 ② `authoringModule` 重新生成后**深等** ③ `byteDigest` 已填、`semanticDigest` 仅在语义摘要可用时填 ④ `specVersion`/`artifactVersion`/`jsonSchemaId` 齐备 ⑤ D75-08 的正反样本等价通过。任一不满足 → drift 测试红；当前 ④（G-17 无 `$id` 规则）与 ⑤ 都不可达，故全部 `draft`。
- IO/状态：纯数据；唯一写入者 = 维护者（随提案提交），读取者 = `test/exchange/drift.test.ts` 与打包面；`src` 不读。
- 证据：`test/exchange/drift.test.ts`。**不证明**：工件在非 TS 消费者上可读（U1/U2）、语义摘要可复算（U80-01）。

**四个公共工件的共通契约**（逐件不再重复）：
- 唯一合法来源是 `authoringModule`（受限 zod 子集），由维护者用 `z.toJSONSchema` **离线**生成后提交，**禁止手写 schema**、禁止 `z.fromJSONSchema()` 反推、禁止运行时重新生成（D75-08）；生成物必须保留 authoring 的未知键策略（`strictObject`→`additionalProperties:false`，`z.object`→`true`），漂移测试用同一调用重生成并深比较。
- `$schema` 固定 draft 2020-12 URI；`$id` 的命名空间与版本化规则 76 未定（G-17），未回写前**不得编造 `$id`**，只能留 `draft`。
- 四道验证与现状：① 自校验——需 dev-only 校验器，Ajv 只禁作**运行时**事实源，dev 侧是否允许 79/82 未定（G-18），**未覆盖**；② 生成漂移——drift 测试覆盖；③ zod↔schema 正反样本等价——`cases-manifest` 与 `summary-sidecar` 可行（authoring 已在手），`record-envelope`/`classified-error` 无 authoring，**未覆盖**；④ 非 TS runner——U1/U2 未证，**未覆盖**。四道缺三，“已冻结”在本轮不可声称。

**F-contract-exchange-record-envelope** · `exchange/schema/record-envelope.schema.json` · 目标-新增（**条件**）· 上位 76-§4.2 `REC-ENV-01`、75-§4.1-2、80-§4.2。
- 职责：冻结信封十九槽（不内联 payload，只留 `payloadRef: ArtifactRef` 与摘要槽；`contentDigest` = 原始载荷 `byteDigest`、`storageHint` 只是逻辑定位）。非职责：不冻结 50 类 payload（G-21）、不冻结 `RecordPayload`/`RecordWriteInput`（属 `ports/record.ts` 的运行时面）、不改 `strictObject` 的未知键拒绝语义、不把 `RecordEnvelope` 改名成 `EventRecord`。
- 前置：信封 authoring → 离线生成；当前无 —— **不创建**。
- 证据：六条构造约束的正反样例（`effectiveTime` 条件必填、`basis` 非双空、摘要至少一个等，与 `test/records/validate.test.ts` 共用样本）；不证明 50 类覆盖。规模 ≤220 行。

**F-contract-exchange-cases-manifest** · `exchange/schema/cases-manifest.schema.json` · 目标-新增 · 上位 25-§二、02-F2-14、75-§4.1-4；作者源 `src/cases-schema.ts`（已存在）。
- 职责：冻结 `cases.json` 的清单形状（`version:1`、`cases.min(1)`、`id` 正则、`expected` 恰一 `out|err`）。非职责：不含 53 条语料本体（数据在 `cases.json`）、不定义域语义（归 `CASES.md`）。
- 未知键策略：`z.object` 非 strict → 必须显式 `additionalProperties:true`，**不得**冻结成 `false`（否则与 authoring 不一致，drift 必红——这是设计上的自洽检查）。
- 前置：authoring 已有；仍缺 `$id`（G-17）与第 ④ 道 —— 只能 `draft`。
- 证据：drift 深等 + 正反样例；不证明非 TS 消费者可读（U1/U2）。规模 ≤300 行。

**F-contract-exchange-summary-sidecar** · `exchange/schema/summary-sidecar.schema.json` · 目标-新增（**条件**）· 上位 17-§3 末行、02-F1-15；作者源 `src/schemas/report.ts:78-100`（已存在，`schema:'summary/v1'`）。
- 职责：冻结 `<单号>.summary.json` 的形状（`schema` 常量、`conclusion` 非空、`changed_files` 可空数组、`rejection_reason?`、`sentinel?{job, run_at, nonce:len64}`）。入选理由：该文件写进**公司 git 目录**，读者可能是不带 TS 的对账工具与人读流程——这是跨边界文件，不是台账投影。
- 非职责：不冻结 REPORT 正文（markdown 归 `report.ts` 的提取器，不进工件）、不校验 sentinel 与实际岗单一致（归收割 R1）、不改 `nonce` 只查长度的现状（G-13）。
- 前置：authoring 已有；缺 `$id` 与第 ④ 道 —— `draft`。证据：drift 深等 + sidecar 正反样例。规模 ≤180 行。

**F-contract-exchange-classified-error** · `exchange/schema/classified-error.schema.json` · 目标-新增（**条件**）· 上位 80-§5.7（错误体 `{error:{failure,category,subcause,detail?}, traceId}` 与"error 内可加 detail，过脱敏"）、80-§9.4（`422` 外层 `fieldPath`、`429` 外层 `retryAfter`、`501` 外层 `reason`）、77-§11.1（14 类失败）。
- 职责：冻结对外 API 的错误体：`error.failure` ∈ 14 值、`error.category` ∈ **6 个可达值**、`error.subcause` 非空、`error.detail?`、外层 `traceId` 必填，外层另有三可选键 `fieldPath?`（仅 422）、`retryAfter?`（仅 429，秒、非负整数）、`reason?`（仅 501）。入选理由：`:8788` 的外部调用方按这两个轴分支，这是真正的对外线格式。
- 非职责：不冻结内部事件 note（那是台账投影）、不把 `category` 的 11 值全量放进 `enum`（5 个内部熔断 category 不得出现在对外体，构造器已拒收）、不定义 HTTP 状态码映射（归 80-§9.4 与 `api` 包）、**不把三个外层可选键塞进 `error`**（80 明令都在外层）。
- 前置：`FailureClass` 类型已落 `records/scalars.ts`，但仍需 zod authoring（`schemas/errors.ts` 加 `FailureClassSchema` 后可生成）；当前无 —— **不创建**。证据：14×6 组合的正反样例 + 5 个内部 category 负例 + 三个外层键的"位置不得错"负例（放进 `error` 即判红）。规模 ≤160 行。

**v0.3/v0.4 明确不创建的两件**：`diagnostic`（76-§1.7 的 14 个**非规则**诊断码无 TS 落点；rules 面的 `Diagnostic` 已由 80-§6.1 定稿、不需要另立工件，剩下的是通用 `DEF-DIAG-01` 那 14 码——见 G-19）与 `ledger-event`（`EventRecord` 是投影、无外部读者；若将来出现外部对账工具，须先回写 75/76 立“运行时交换”一类——见 G-20）。

### 4.6 条件构建/包文件（3 件）

- **F-contract-tsconfig-build**：`extends ./tsconfig.json`，**必须显式覆盖** `noEmit:false`、`declaration:true`、`declarationMap:false`、`outDir:./dist`、`rootDir:./src`、`rewriteRelativeImportExtensions:true`（79-§5.2/§5.4 三陷阱：继承 `noEmit` 会静默零产出；`noEmit+emitDeclarationOnly` 组合退出 0 但无产物；`.d.ts` 不重写 `.ts` 说明符）。非职责：不做增量（`composite`/`references` 默认不引，79-§6.4）。证据：`--listFiles` 拓扑断言 + `dist/index.js` 可被 Node 直接 import（未执行）。
- **F-contract-readme**：若切 dist 则必须存在（79-§6.5），内容限定“这是什么/如何 import/哪些是实验端口/数据工件在哪”；**不得**写“稳定/已实现”。许可与公开范围待制作人（79-§6.5）。
- **F-contract-license**：许可文本**未定**（17 包全无 `license` 字段；根 `LICENSE` 是仓级 MIT，不等于包级许可）→ 本文件在制作人裁定前**不得创建**，也不得默认复制根 MIT。

### 4.7 目标测试（10 件）

| F-ID | 文件 | 覆盖 | 不证明 | 规模 |
|---|---|---|---|---|
| F-contract-test-runner-matcher | `test/runner/matcher.test.ts` | 数组**歧义**双向匹配（贪心反例必绿、真不匹配必红）、长度不等、对象子集、`__NULL__` 与真实字符串 `"__NULL__"` 的不可表达性（钉住限制）、期望 `NaN` 必红、异步 subject | 不证明业务语义；不证明性能（O(n³) 匹配在 53 条语料上无意义） | ≤200 |
| F-contract-test-runner-manifest | `test/runner/manifest.test.ts` | 清单不合法 → `CONFIG_INVALID/cases/manifest-invalid`；重复 `id` → 拒（新增机械检查）；未知域请求 → 可见失败；`cases.json` 的域集合/每域计数与常量表一致；`CASES.md` 域清单含全部域（字符串级） | 不证明 `CASES.md` 正文与语义段落无漂移（只查域集合） | ≤150 |
| F-contract-test-exchange-drift | `test/exchange/drift.test.ts` | 索引 ↔ 文件存在性（多一个/少一个都红）；`authoringModule` 重生成后与 `draft` 文件**深等**（唯一覆盖 D75-08 第 2 道验证的测试）；`status:'frozen'` 的必备字段（`specVersion`/`artifactVersion`/`jsonSchemaId`/两个摘要）；未登记工件（`ledger-event`/`diagnostic`）出现即红；`$schema` 必须是 2020-12；未知顶层键拒 | **不证明**工件自校验（dev-only 校验器未定，G-18）、不证明正反样本等价（`record-envelope`/`classified-error` 无 authoring）、不证明语义摘要可复算（U80-01）、不证明非 TS 消费者可读（U1/U2） | ≤200 |
| F-contract-test-records-validate | `test/records/validate.test.ts` | 信封六条约束逐条负向：`effectiveTime` 条件必填/`not-applicable` 却给 `from`、`payloadRef` 内联、`basis` 双空、摘要双缺/`byteDigest` 带 `canonicalizationId`、`scope` 与 `lineage` 越界、`knowledge` 缺省；`Provenance.limitations:''`；Qid 三段缺一；decimal 前导零/指数；`*_id` 与 `recordId` 不一致；未知 `recordType` 拒（`E-REF-001`） | 不证明 50 类全覆盖（U80-14）；不证明语义规则与 77 一致（那要 V2 行为契约）；**不证明载荷面**——`payload.ref` ↔ `envelope.payloadRef` 同值、`contentDigest` 为 `bytes` 的 `byteDigest`、`payload(ref)` 四态与信封权检都属 V2（归 03 卷的 store 测试），本包不加用例 | ≤260 |
| F-contract-test-ports-errors | `test/ports/errors.test.ts` | `FAILURE_CLASSES` 恰 14 值 + 穷尽护栏；`FAILURE_CATEGORY_DEFAULT` 14 行逐条；`classified(input: ClassifyInput)` 的缺省填充、三处允许的显式覆盖与别处覆盖负例、非法输入抛 `configInvalid('classified-input-invalid')`；6 个 `Err` 可达 category 正例、5 个内部 category 负例（构造器抛）；`configInvalid` 固定 `rejected_precondition + CONFIG_INVALID`；3 字段旧 `ClassifiedError` 必须 parse 失败；`Notifier.send` 的 `Ok(failed)` 不被读成 `Err` | 不证明任何实现按 `failure` 处置正确（那归 core）；不证明 HTTP 状态映射（归 api 包） | ≤200 |
| F-contract-test-ports-intent | `test/ports/intent.test.ts` | 键还原公式四段（`company←companyRef.companyId`、`source←source.channel`、`kind←source.kind`、第四位 `←ticket ?? dedupKey`）；`IntentReceipt.status` 三值判据（有无 `REC-WORK-02`/`REC-EVT-03`）；`outcome` 五值且**无第六值**；`expiresAt = receivedAt + idempotencyTtlMs` 为导出值；重投判定表逐行（四态 + 两边界）；TTL 三态（queued 不放过 / decided 生效 / unknown 只在对账后）；`gap` 两值；`receipt` 未命中回 `undefined`（不是 `Err`） | **不证明** `IntentIngress` 已实现（daemon 侧）、不证明 HTTP 层（202/401/403/409/422/429）、不证明崩溃重放（需 kill 注入） | ≤240 |
| F-contract-test-daykey | `test/daykey.test.ts` | UTC 日界（`23:59:59.999`/`00:00:00.000`）、闰日、负 epoch、跨年；`companyDayKey` 的固定偏移（`+08:00`）与 IANA 区（含 DST 切换日两侧）；非法 zone → `CONFIG_INVALID/daykey/invalid-zone`；`DAY_MS` 与两函数一致性 | 不证明报表按公司本地日的汇总正确（归 company/panel）；不证明 tzdata 在所有宿主一致（G-25） | ≤120 |
| F-contract-test-secrets | `test/secrets.test.ts` | 从 `core/test/secrets.test.ts` **逐条复制**的冻结断言：`'密码 s3cret-value 错误'→'密码 <redacted:12> 错误'`、长值优先、`<6` 不替换、重复值去重单次、先已知值后形状、中文句零命中、ULID 不误触 `long-token`、`<redacted:N>` 幂等（不二次替换）；`redactKnown` 只换已知值（未知形状串原样保留）、`redact` 才做形状兜底；`knownValues` 不在返回对象上可枚举 | 不证明九个强制出口都调了它（归 82/装配面）；不证明入站秘密不该扫（那是调用边界纪律） | ≤120 |
| F-contract-test-ports-resources | `test/ports/resources.test.ts` | `ResourceLimit` 三态：`finite` 带 `DecimalString`（不接受 `number`）、`unbounded` 不产生 `remaining` 下限断言、`unknown` 不被读成 0；**缺省即未知**：`reserved`/`consumed` 缺省时 entry **无 `remaining`**；有限额度缺 `reserved` ⇒ 必给 `reservation-record-missing`、缺 `consumed` ⇒ 必给 `unreconciled-actual`；三值齐备时 `remaining = amount − reserved − consumed` 校验；`ResourceGap` 四 kind 逐条构造 + 穷尽护栏；`gaps` 非空仍回 `Ok`；`gap(subject)` 与 `baseline().gaps` 同源同判据；**负向**：`ResourceAccountant` 上没有 `reserve`/`actual`/`release`，返回值里没有 `Qid` 回执 | 不证明 `core/src/resources/` 与 `store/src/resources/` 已实现（U80-20）；不证明 `resourceLedger` 的建表与投影重建正确（名已登记、表未建，随 `MIG-01` 另验）；不证明五门按缺口下的判定正确（归 `core/src/work-readiness.ts`） | ≤180 |
| F-contract-test-ports-binding | `test/ports/binding.test.ts` | `BindingProfile` **20 字段逐项**（缺一即“档案不完整”：`ownerPositionRef` 必具名、`coveredObjects`/`uncoveredObjects` 成对、`losses: []` 显式而非缺省、`probes[].state` 三态、`factStatus` 四值）；`StateMapping` **无 `mapped` 字段**；`workStates` 只许 `STAT-D` 值、给 `STAT-E` 即判负；映射三分支——已映射 → `verification:'verified'`；未映射但合法 → `Ok({verification:'unverified', workStates: [], unmappedBehavior:'observe-unmapped'})`（**不写记录**：以假台账/假时钟断言零调用，`REC-OBS-02` 由消费方写）；空/畸形 → `Err(rejected_precondition)`；`ExportScope.memories.excludeSecrets` 只能 `true`；`ExportBundle.manifest.bundleId` 非 qid、`openObligations` 字段在、`shape` 是声明不是全 true；`ExitPlan` 九段齐、`archive.mode='read-only'`/`deleted:false`、`exit.unresolved` 显式；**负向**：`PlatformBindingPort` 上没有 `write`/`apply`/`migrate` 一类写口 | 不证明通用宿主 `apps/daemon/src/assembly/platform/binding.ts` 已实现（80-§6.9 只给落点，80-§12.5 未单列该端口的 U 项）；不证明 `localplatform`/`taiga`/`yt` 的档案内容正确；不证明导出包“完整性”判定与退出执行（V2 行为，归 17/03） | ≤200 |

九个文件都不含 LLM 裁判、不读取真实公司目录、不启动进程、不联网——全部纯输入/输出或本地 JSON 读。

### 4.8 `src/daykey.ts`（时间工具，1 件）

**F-contract-daykey** · `src/daykey.ts` · 目标-新增（`dayKeyOf`/`DAY_MS` 自 `panel/src/views.ts:313,321` 迁入）。上位 80-§9.4 M1（“`dayKeyOf`/`DAY_MS` → **contract**”，并要求“需要公司本地日的投影必须显式传时区/偏移参数，新增参数位”）。**不引 TS-SCALAR-03**：那一条管的是记录时间 `Timestamp`（`text` 权威 + `epochMs` 只比较），日键 `YYYY-MM-DD` 不是 `Timestamp`、也不进记录身份。
- 命名口径（v0.4 校正）：80-§9.4 M1 只给 `dayKeyOf`/`DAY_MS` 两个名字与“显式传时区”的要求，**未给**公司本地日键的函数名与参数类型名；`companyDayKey`/`CompanyZone` 是本附录为落地该要求所拟的名字，登记为 G-26。80 若后给出正式名，以 80 为准，本包改名，不留两个名字。
- 职责：给出**两个不同的日键**并让它们永不混用——① `dayKeyOf(ms: number): string`：UTC 日键（`YYYY-MM-DD`，**行为与现状逐字一致**）；② `companyDayKey(ms: number, zone: CompanyZone): string`：公司本地日键，只用于报表/展示口径。`CompanyZone{iana: string; offsetMinutes?: number}`（给了 `offsetMinutes` 用固定偏移，否则按 `iana` 解析）。
- 非职责：**不是时钟**（两者都收 `ms`，不内部取 `Date.now`）；不做台账键（台账时间用 `Timestamp` 文本，日键不是记录身份）；不做汇总（聚合归 `company`/`panel`）；不替代 `localDateKey`（宿主时区版，只作旧记录过渡，禁止用于新记录——D17）。
- 内部/导出：`DAY_MS = 86_400_000`、`dayKeyOf`、`companyDayKey`、`CompanyZone`。`dayKeyOf` 必须与 `panel` 原实现等价（`new Date(ms).toISOString().slice(0,10)` 的语义），迁移后 `panel` 改为 import，**不得**留第二份。
- 依赖：零第一方包、零 `node:*`；`companyDayKey` 用 `Intl.DateTimeFormat`（ECMA-402），把“宿主 ICU 数据版本”登记为外部事实（G-25）。
- IO/注入：纯函数；时间由调用方给（可重放）；无时钟、无随机、无环境读取（时区只经参数进来，不读 `process.env.TZ`）。
- 状态/并发：无状态；同输入同输出。
- 错误/秘密：`ms` 非有限数、`zone` 非法（`iana` 空串 / `offsetMinutes` 越界 ±14h）→ 抛 `configInvalid('daykey/invalid-*')`；两个函数都**不**静默回退到宿主时区（静默回退会造出“同一毫秒两个日键”）。
- 测试/证据：`test/daykey.test.ts`（见 §4.7）。与 R/E/W：不承载任何 R/E/W；V0/V1 层（纯函数）。
- 规模/迁移：≤80 行。迁移顺序：先落 `contract` 并补测试 → `panel` 改 import（同一提交）→ 删除 `panel/src/views.ts` 的本地定义（归 13 卷的 F-ID）。**UTC 日键的取值不变**是硬约束（旧报表与快照按它索引）；`companyDayKey` 是**新增**口径，不得回填旧数据。

### 4.9 跨卷契约接缝（只写契约面，文件条目归对应卷）

本节回应“接口已定稿、落点分散”的问题：同一接口的实现文件不在本包，但本包必须规定它**消费什么类型、产出什么、什么顺序、什么幂等、错误怎么映射、不许做什么**。文件级 9 面条目与 F-ID 归对应分卷（括号内），本卷不重复、不占本卷 F-ID。

| 接缝（卷） | 消费的 contract 类型 | 产出 | 顺序/幂等 | 错误映射 | 不得做 |
|---|---|---|---|---|---|
| `core/src/work-readiness.ts`（02） | `ReadinessRequest`/`RecReadinessJudgment`/`GateResult`/`ReadinessCondition`/`ReadinessGate`/`ReadinessVerdict`/`ReadinessJudgeRole`/`ResourceBaseline`/`WorkState`/`FailureClass` | 五门纯求值（`verdict` 三值 `可开工`/`附条件开工`/`不可开工`；逐门 `GateResult`） | **合同 → 计划锁（写 `REC-WORK-05.resource_reservations`）→ 五门（读 `resourceBaseline`）→ 出工段**，不得循环；**先五门、后并发四闸**；断路器前置不计闸数；纯函数可任意重试；签名对齐 `TS-PORT-WORK-03` | 不外抛 `Err`（verdict 是结论不是失败）；门内规则求值 `refused` 只导致整单 `不可开工`；输入畸形才 `configInvalid` | 不读公司目录、不写记录、不调端口、不把 `riskRef` 当门输入、不加第四值 `refused`、不把 `verdict` 压成 boolean、不省 `dissentPosition`、不自行计算资源（调 `TS-PORT-RES-01`） |
| `core/src/rule/*`（02） | `RuleProfile`/`RuleInput`/`RuleLimits`/`RuleLimitTightening`/`RuleOutcome`/`Diagnostic` | `Ok(RuleOutcome)` 或 `Err(ClassifiedError)` | `typecheck` 通过才进 `evaluate`；`refused` 留 `Ok`；`limitsApplied` 必填 | 18 个码按相位；无码相位不得兜底；收紧只能更严 | 不 import `node:fs`、不做 IO、不回写规则文档 |
| `core/src/resources/`（02） | `ResourceBaselineRequest`/`ResourceBaseline`/`ResourceEntry`/`ResourceLimit`/`ResourceGap` | `Ok(ResourceBaseline)` 或 `Ok(readonly ResourceGap[])` | 只读、纯求值；`gap` 与 `baseline().gaps` **同源同判据**；`asOf` 由调用方传入，不取宿主墙钟 | 读不出/超时 → `Err(unavailable/STALL)`；输入畸形 → `Err(rejected_precondition)`；**缺口非空仍 `Ok`** | 不写记录/投影、不做 `reserve`/`actual`/`release`、不判"准入"、不用 `number` 表金额、不补算缺省为 0 |
| `store/src/resources/`（03） | `ResourceEntry`/`ResourceGap`/`RecordQuery` | 只读投影行（投影名 `resourceLedger` 已在 80-§6.3 **登记为目标名**，物理表 `resource_ledger`；当前**未建表**，`MIG-01` 未做——表未建前只读既有 `REC-WORK-05`/`REC-EVD-*` 投影） | 只读事务、不跑 DDL；缺省**不补 0**；缺 `reserved`/`consumed` 必须报缺口且不给 `remaining` | 缺库 → `unavailable/STALL/db-missing`；查询形状非法 → `rejected_precondition/CONFIG_INVALID/ledger-query-invalid`；未开放字段组合 → `unsupported/EVOLVE_REJECT/ledger-query-unsupported`；游标非法 → `conflict/EXTERNAL_REJECT/ledger-cursor-invalid` | 不建第二事实源、不写 `REC-WORK-05`、不在只读连接上 `rebuild` |
| `apps/daemon/src/assembly/platform/binding.ts`（17） | `PlatformBindingPort`（`TS-PORT-BIND-01`）/`BindingProfile`/`StateMapping`/`ExportScope`/`ExportBundle`/`ExitPlan`/`FlowPlatform`（能力端口）+ `REC-LOSS-01` 的 `Qid[]` | `describe` → `BindingProfile`；`mapState` → `StateMapping`；`exportBundle` → `ExportBundle`；`exitPlan` → `ExitPlan` | `describe`/`mapState`/`exitPlan` 纯读；`exportBundle` 按 `(scopeDigest, cursor)` 幂等；**包装 `FlowPlatform`、不新建平台** | 未映射但合法 → `Ok(unverified)`（**不是 `Err`**；`mapState` 是纯函数、**不写 `REC-OBS-02`**，记录由消费方 state-diff / `TS-PORT-OBS-01` 写）；空/畸形 → `rejected_precondition`；超出 `knowledgeScope` → `rejected_forbidden`；无接收确认就宣称退出 → `rejected_precondition` | 不新建平台、不把端口实现搬进本包、不把映射损失记成失败、不在 `mapState` 里写台账、不读一个 `ExitPlan` 就宣布退出完成、不改 `FlowPlatform` 七能力 |
| `packages/localplatform` / `taiga` / `yt` 的 `src/binding.ts`（各自卷） | `BindingProfile`/`StateMapping`/`BindingFactStatus`/`WorkState` + `RecBindingLossReport` | 只导出**纯**函数/常量：`bindingProfile()`（档案骨架，不含运行期探针结果）/`mapState(platformState)`/`lossReport()` | 只供平台特定数据、不定义形状；`stateMappings.ours` 只写 `STAT-D` 中文态；一平台一份档案；`mapState` **零 IO、不写记录**（`REC-OBS-02` 由消费方写） | 档案 20 字段缺项 ⇒ 拒绝装配，不得散文补；给出 `STAT-E` 映射 ⇒ 判缺陷 | **不得**导出 `describe`/`exportBundle`/`exitPlan`（禁第二实现）、不在平台包定义第二套 `BindingProfile`、不自造英文态、不读台账/不写记录/不起网络/不读时钟、不在契约层写平台分支 |
| `apps/daemon/src/assembly/intent/ingress.ts`（17） | `IntentSubmissionPort`（`TS-PORT-API-01`）/`WebhookIntentPayload`/`IntentKey`/`IntentReceipt`/`ServeConfig.external.allowedSources` | `IntentSubmitResult`；`IntentReceipt \| undefined` | **`WorkIntake.reserve`（`TS-PORT-WORK-01`，`intentRef: Qid`）先写 `REC-WORK-01` → 再 engine `ingest`**（`ingest` 只入内存队列、不产生记录）；先校验来源/令牌/配额 | 403 `forbidden`；409 `rejected_idempotency`；422 `rejected_precondition`；429 `unavailable`；202 只带 receipt | 不暴露 `ingest`、不自己写 `REC-WORK-01`、不查 `SourceRegistry`、不把外部面做成 `InvokeSource` |
| `apps/daemon/src/assembly/intent/receipt-store.ts`（17） | `IntentReceipt`/`ProjectionName`（`'intentReceipts'`，17 张表投影之一，**不属 `'observation'`**） | `intent_receipts` 投影行 | 投影与记录**同事务**写入、`commit` 后进内存快照；可重建：删表 → 从 `REC-WORK-01/02`、`REC-EVT-03` 重放 | `get` 只读**已提交快照**、不回库；读不到即 `undefined`（未登记），不是 `Err` | 不做第二事实源、不存 `expiresAt`（导出值）、不写 `attempts`、**不拿 `get` 快照做重投判定**（须按记录现算） |
| `apps/daemon/src/assembly/api/assemble.ts`（17） | `IntentSubmissionPort`（只取 `submit`/`receipt`）、`RecordQuery`/`RecordPage`（经只读台账） | `ApiServerOptions` | 装配期一次成型；`enabled=false` 不启动面 | 开启而缺件 → 整机 `CONFIG_INVALID` | deps 只收 `{ingress: Pick<IntentIngress,'submit'\|'receipt'>; ledgerPath; company; config}`；**不收** `openLedger`/`platform`；视图是包内依赖 |
| `packages/store` 只读台账（03） | `RecordQuery`/`RecordPage`（`nextCursor: string \| null`）/`RecordPayload` | `ReadOnlyLedger{schemaVersion, query, get, payload, close}`（**类型在 store**；`get`/`query`/`payload` 回**同步** `Result`，`Ok(undefined)` 只表示“不存在/无载荷”） | 只读事务、不跑 DDL、不迁移 | 缺库 → `unavailable/STALL/db-missing`；版本不符 → `rejected_version/EVOLVE_REJECT/schema-behind\|schema-ahead`；查询三条 subcause 与 `RecordReader` 逐字相同；`payload(ref)` 四态四条 subcause 与 `RecordReader.payload` 逐字相同（先按信封 `knowledge`/`scope` 授权，`payload-not-authorized` 不得回 `undefined`） | 不在只读连接上做 `rebuild`/`drill`（走 `openLedgerMaintenance` 离线窗口）、不把读失败降级为空页、不用 `storageHint` 绕台账取字节 |
| `panel/src/views.ts` 的 `dayKeyOf`/`DAY_MS`（13） | `dayKeyOf`/`DAY_MS`/`companyDayKey` | 报表视图 | 原址删除、改 import（同一提交） | n/a | 不留第二份实现、不把 `companyDayKey` 用于台账键 |
| `core/src/secrets.ts`（02） | `redactOutbound`/`redactKnownSecrets`/`findSecretShaped`/`SecretShapeFinding` | **具名 re-export**（`export { … } from '@studio-next/contract'`，禁 `export *`） | 与 `contract/src/secrets.ts` 同批提交，避免双实现窗口 | n/a | 不留第二套正则、不新增 `api→core`/`gateway→core` 边（两端直连 contract） |
| `apps/daemon` 的 stdio 工具面（17） | `WkeyClaims`/`GATEWAY_ACTIONS`/`EXTERNAL_AI_TOOLS` | 工具调用结果 | worker 只拿 per-ticket wkey；**验签/nonce/吊销/审计/平台写全在 daemon**；helper 必须先注册（本地 socket `run/daemon.sock` 或 `STUDIO_DAEMON_SOCK`），未注册一律 deny | 未注册/无效 wkey → deny（不是 `Err` 透传） | **stdout 只许 JSON-RPC 帧**（诊断走 stderr）；socket 路径与权限不进日志；`initialize._meta['studio-wkey']` 只作 legacy 兼容；未实现的部分按 U80-17 记“未证”，**不得**写“方案未定” |

规模：本节是接缝说明，不占文件预算；上表每行对应文件的行数预算由各卷自定（本卷只约束它消费的 contract 类型不超 ≤300 行/件）。

### 4.10 意图与回执语义（`ports/intent.ts` 的运行时口径）

`IntentReceipt` 是**投影**，本节规定投影怎么算——不新增类型，只把 80-§6.6 的语义写成可测规则。

**① 键还原（唯一公式，不得从 payload 猜）**

```text
IntentKey.company  ← REC-WORK-01.companyRef.companyId
IntentKey.source   ← REC-WORK-01.source.channel
IntentKey.kind     ← REC-WORK-01.source.kind
第四位             ← REC-WORK-01.source.ticket ?? REC-WORK-01.source.dedupKey
```

`REC-WORK-01.source` 的子键固定 `{channel, dedupKey, ticket?, kind}`；键相等 = 四段全等（与 `core/src/decide.ts:319-322` 的 `intentKeyOf` 同构）。

**② `status` 三值（由记录存在性推出，不由写入方自报）**

| 判据 | `status` |
|---|---|
| 有 `REC-WORK-02`（受理决定） | `decided` |
| 无 `REC-WORK-02`，有 `REC-EVT-03`（未知/悬空） | `unknown` |
| 只有 `REC-WORK-01` | `queued` |

`IntentReceipt{receiptId, intentKey, intentRef, bodyDigest, receivedAt, expiresAt, status, outcome?, referredTo?, decidedAt?, intakeRecordRef?, unknownRef?, gap?}`（字段与 80-§6.6 的定义**逐字一致**，不得少 `intentKey`）：`receiptId` 是**投影行 ID**（非 qid）；`intentKey` = ①的还原公式结果（不是整块 `REC-WORK-01.source` 结构）；`intentRef` = `REC-WORK-01.recordId`（`reserve` 即产生）；`receivedAt` 同键多条取**最大值**；`expiresAt = receivedAt + ServeConfig.external.idempotencyTtlMs`（**导出值，不落盘**）；`outcome` 五值取自 `REC-WORK-02.outcome`，未判则缺省；`referredTo` 仅 `forwarded` 时出现；`intakeRecordRef` = `REC-WORK-02`；`unknownRef` = `REC-EVT-03`；`gap?: readonly ('unknown-link-missing'|'intake-link-missing')[]`（**数组**，非空即"投影不完整"）——`REC-EVT-03` 缺 `unknown_scope.intentRef` 时保持 `unknown` + `gap:['unknown-link-missing']`，**不得降级成 `queued`**，禁重放、禁另立同键。

**③ 重投判定（同键；四态 + 两个边界行）**

| 情形 | 行为 | HTTP |
|---|---|---|
| 同摘要 + 已 `decided` | 不再入队，回现有 receipt | 200 |
| 同摘要 + `queued` | 重新入队（`reserve` 幂等，`duplicate:true`） | 202 |
| 同摘要 + `unknown` | **先对账**（`TS-PORT-REC-06 ReconciliationPort`），不回 `Err`、不重放写 | 202 |
| 不同摘要 | `Err(rejected_idempotency + EXTERNAL_REJECT + body-mismatch)` | 409 |
| 幂等窗已过且已 `decided` | 视作新意图：另立 `REC-WORK-01` 并带 `lineage.supersedes` | 202 |
| 未命中任意记录 | 新建 | 202 |

**读快照 ≠ 做判定**：`receipt()` 只读**已提交的内存快照**（投影与记录同事务、`commit` 后才可见），不回库；因此上表每一行都必须**按记录现算**（`TS-PORT-REC-02` 读 `REC-WORK-01/02`、`REC-EVT-03`），**不得**以 `receipt()` 的快照充当重投判据——快照可能滞后于库（另一进程已提交），拿它判"未命中"就会重复入队。

**④ TTL 三态**：`queued` 的 TTL **不生效**（绝不因过期而放过同键重投）；`decided` 的 TTL 生效（窗内同键视为重复、窗外视为新意图）；`unknown` 只有**对账完成后**才可能到期。

**⑤ 崩溃语义**：`reserve` 后、`ingest` 前被 kill → 重启扫描 `status='queued'` 并重放，重放对 `REC-WORK-01` 幂等（同键同摘要）。**没有 `attempts` 字段**：重试次数不是事实，重放判据只有记录状态。

**⑥ 三个轴不得混**：`IntakeOutcome.outcome`（五值：`accepted`/`accepted_with_conditions`/`deferred`/`rejected`/`forwarded`）是**业务结论**；`IntentReceipt.status`（三值）是**投影状态**；HTTP 状态码是**传输层**。`202` 只带 receipt、不带 `outcome`；`401/403/409/422/429/503/501` 各自带明确 `failure`（80-§9.4）。

---

## 五、契约数据面的域归属、消费与漂移

### 5.1 域 → subject 所有者 → 断言实例

| 域 | 条数 | subject 所有者（非本包） | 断言文件 | 断言实例 |
|---|---|---|---|---|
| `meta` | 3 | 本包 `test/contract.test.ts` 内置 | `test/contract.test.ts` | 3 |
| `dir` | 3 | `company`（`dirSubject`，`strictFiles:false`） | `company/test/dir-cases.test.ts` | 3 |
| `evt` | 7 | 本包 `schemas/events.ts`（`evtSubject`） | `test/schemas.test.ts` | 7 |
| `rpt` | 5 | 本包 `schemas/report.ts`（`rptSubject`） | `test/schemas.test.ts` | 5 |
| `deps` | 17 | `company`（`depsSubject`） | `company/test/deps-cases.test.ts` | 17 |
| `mj` | 8 | `core`（`parseJudgeVerdict` 包装） | `core/test/judge.test.ts` | 8 |
| `plat` | 10 | `yt` + `localplatform`（同一 case 跑两实现） | `yt/src/plat-cases.test.ts`、`localplatform/src/plat-cases.test.ts` | 20 |
| 合计 | **53** | — | 7 个文件 | **63** |

本包自己承担 15 条（`meta`+`evt`+`rpt`）；其余 38 条由实现包承担——**本包不证明它们绿**。

### 5.2 域约定对契约面构成的约束（本文只登记）

- `plat` 域只断言 `category` 全等（`CASES.md:103-105`）——这对应 25-§一.4 的“错误语义统一”，**不是** 77-§11.1 的 `FailureClass` 一致（两者正交，80-§4.1）。
- `deps`/`dir`/`mj` 的 IO/位置面被明示排除在契约外，由各包单测承担（`CASES.md:66-70`、`:126-131`、`:150-154`）——因此“契约全绿”**不可能**推出“IO 面正确”。
- `plat` 的 `subcause` 跨实现差异**如实放行**，词表对齐是第二阶段——故 `plat` 域不能作为 `subcause` 冻结面的证据。
- 本包测试件目标共 **12 个**（现有 2 + 新增 10，见 §4.7）；新增 10 件里只有 `test/runner/manifest.test.ts` 读 `cases.json`，其余 9 件是纯函数/类型断言——**语料条数不增长不等于覆盖面不增长**。
- `cases.json` **不新增 `intent` 域**：意图/回执语义由 `test/ports/intent.test.ts` 以纯函数断言覆盖（§4.10 的键还原、status 判据、重投判定、TTL 三态）。理由：80-§12.5 的 U80-15（意图通道）尚未在真机验证，把未证行为写成语料会制造“已验”的错觉。

---

## 六、迁移序列（每条都要求“先证后切”）

| 步 | 内容 | 前置 | 回退 | 证据要求 |
|---|---|---|---|---|
| M0 | 基线复核：`bun run typecheck`、`bun run test`、`guard:boundaries` | — | — | 三条命令 exit=0 的输出留档（**本次未执行**） |
| M1 | 类型搬家 + runner 修正：`ValidationIssue/Outcome` → `records/validate.ts`（`schemas/events.ts` 改 `import type`）；`runCases` 清单错改 `configInvalid`；数组匹配改最大匹配；未知域可见；删 `PACKAGE_NAME` | M0 绿；`PACKAGE_NAME` 零消费已复核 | 逐项独立提交，回退=revert 单提交 | 新增 `test/runner/{matcher,manifest}.test.ts` 绿；既有 `contract.test.ts`/`schemas.test.ts` 断言值不变 |
| M2 | 端口分组文件（**11 件**：9 个 §6 组含 `resources.ts`/`binding.ts` + `intent.ts` + `secret.ts`）+ `ports/index.ts` 再导出；`kernel.ts` **增补** `Result<T,E>` 与 `ClassifiedError.failure`；`ports/spec.ts` 落规则诊断族（18 码 + 8 相位 + `Diagnostic` 判别联合）；`ports/binding.ts` 从 `effects.ts` 分出 `TS-PORT-BIND-01` 与其五个类型的家（80-§6.9 指名路径，不得留在 `effects.ts`） | M1 绿；80-§6 签名与 §11.2.1 类型已复核；80-§12.3/§6.9 的指名路径不得改 | 删新文件 + 还原 index（纯类型，无运行期影响） | 根 `tsc` 绿；`PORT_VERSION` 仍 `v0`；55 个端口类型与 80-§6 逐条对数（55 不变，BIND-01 只换家）；**不得**声称端口已实现 |
| M2b | `src/secrets.ts` 迁入 + `core/src/secrets.ts` 改**具名 re-export**（同一提交，避免双实现窗口）+ `test/secrets.test.ts` 复制冻结断言 | M0 的 `core/test/secrets.test.ts` 绿；`core→contract` 是既有允许边 | 还原 `core` 实现 + 删 `contract/src/secrets.ts` | `core/test/secrets.test.ts` **一行不改**仍绿；全仓 grep 只有一处 `BEARER_RE`/`ASSIGNMENT_RE`/`LONG_TOKEN_RE` 定义（**本次未执行**） |
| M2c | `src/daykey.ts`（`DAY_MS`/`dayKeyOf`/`companyDayKey`）+ `panel/src/views.ts` 改 import（同一提交）+ `test/daykey.test.ts` | M0 绿；`panel` 原址删除的 F-ID 归 13 卷 | 还原 `panel` 本地实现 + 删 `contract/src/daykey.ts` | UTC 日键对旧报表/快照**逐条等价**；`companyDayKey` 为新增口径，**不回填**旧数据 |
| M3 | `records/{scalars,refs,envelope,validate,def-records}` + `payloads/**` + `test/records/validate.test.ts`；`FailureClass` 落 `scalars.ts`、`kernel.ts` 改 `import type` | M2 绿；76-§4 六条与 77 字段表已确认无缺口（G-16 由 80-§4.1 关闭） | 同上 | `validateRecord` 负向 ≥12 条；`FailureClass` 恰 14 值；50 类映射表与 77-§0.5 逐条对数 |
| M3b | **错误两轴切换**：`schemas/errors.ts` 加 `FAILURE_CLASSES`/`FailureClassSchema`/`FAILURE_CATEGORY_DEFAULT`/`classified(input)`；13 处 `ClassifiedError` 构造点改走构造器；最后收紧 `ClassifiedErrorSchema` | M3 绿（`FailureClass` 类型已在） | 构造点逐文件独立提交，可单点回退 | `test/ports/errors.test.ts` 绿；双写期事件 note 同时带 `failure` 与 `category`；5 个内部 category 负例锁住 |
| M4 | `canon.ts` 类型 + jcs@1 实现（独立事项） | M3 绿；76-§1.5.1 向量可复算 | 类型可留、实现可退 | 向量逐条一致才可把任何 `semanticDigest` 标 `frozen` |
| M5 | `exchange/`：索引 + `cases-manifest`/`summary-sidecar`（authoring 齐者先落）；`record-envelope`/`classified-error` 等 authoring 到位再落 | M4 的 `byteDigest` 可用；G-17（`$id`）、G-18（dev-only 校验器）已回写；冻结提案已过审 | 整目录删除（无消费方） | `test/exchange/drift.test.ts` 绿；**全部 `draft`**，任一 `frozen` 即判负（四道验证缺三，§4.5） |
| M6 | `package.json` 加 `exports["./cases.json"]` + 7 处消费改写法（补 `with {type:'json'}`）+ `CASES.md` 5 处漂移校正 | M1 绿；7 处消费文件所在包同意同批改 | 移除 exports 项 + 还原 import | 各包 test 绿；`evolve-guard` 的禁改清单不变 |
| M7 | （仅当 79 定裁切 dist）`tsconfig.build.json` + `exports/types/files` + 根 `tsconfig` 移出 + 根 `typecheck` 串接 + README/LICENSE | 79-§6.5 裁决；许可文本已定 | 原子回退（同一提交） | 79-§5.6 五条同时成立 + `npm pack --dry-run --json` 清单 |
| M8 | **跨卷装配**（执行归 17 卷，本卷给前置）：`assembly/intent/{ingress,receipt-store}.ts` + `assembly/api/assemble.ts` 上线；`cli/external` 退役；`panel/external` 后删（M9 级，归 13/17） | M2（`intent.ts` 已导出）与 M3b（错误两轴）绿；80-§8.2 的 D12（只读打开）已落 | 关 `ServeConfig.external.enabled` 即停面，daemon 不受影响 | 80-§9.4 的 M1–M5 十项验证；`:8788` 两态（关=面不启动、日志明写；开而缺件=整机 `CONFIG_INVALID`） |

**顺序铁律**：M1 不依赖 M2；M2b/M2c 在 M2 之后、M3 之前（`records/validate.ts` 要 `Result`，`secret.ts` 要 `SecretShapeFinding`，`daykey` 独立但同批切 `panel`）；M3 依赖 M2 的类型，M3b 依赖 M3 的 `FailureClass`；M4 不阻塞 M3，但阻塞任何 `frozen` 标记；M5 依赖 M3/M4；M6 与 M2–M5 无依赖，可在 M1 后任意时刻做；M7 必须最后（切 dist 时 `contract` 先切，`gateway`/`adapters` 等消费方后切，闭包顺序不得倒）；M8 依赖 M2+M3b 且受 80-§8.2 D12 门控。跨卷铁律：**本包的任何类型未导出前，下游不得先写“按 contract 中某类型实现”的代码**（否则只能靠本地影子类型，构成第二定义）。

---

## 七、证据与证明边界

### 7.1 本包测试能证明什么（V 层）

| V 层 | 本包现状 | 说明 |
|---|---|---|
| V0 文本/结构 | 部分 | `CASES.md` 规则与 `cases.json` 的自洽靠人工；无机械门禁（目标补于 `test/runner/manifest.test.ts`） |
| V1 结构/语义 | 有 | evt/rpt/meta 15 条 + schema 单测；范围=形状与纯函数 |
| V2 行为契约 | 一小片 | `runCases`/`validateEventRecord`/`extractReportSkeleton` 的行为；端口与 `validateRecord` 的目标面**尚未实现** |
| V3 跨实现互操作 | 最弱形 | `plat` 域 2 实现 × 10 条，仅 `category` 全等；第三实现缺；`subcause` 明示放行 |
| V4 迁移/故障/安全 | 无 | 现状无秘密扫描、无归档上限、无并发用例。目标增：脱敏纯函数迁入 `contract`（`src/secrets.ts`，验收口径仍是 `core/test/secrets.test.ts`）、`test/secrets.test.ts` 复制冻结断言、drift 测试第 2 道验证、`test/ports/errors.test.ts` 的两轴负例；**仍无**：`cases.json` 语料的秘密/绝对路径扫描（G-15）、schema 自校验（G-18）、九处强制点是否都调了 `redactOutbound`、意图通道崩溃重放（U80-15） |
| V5 真机 | 无 | 本包不触外部系统 |
| V6 自治 | 无 | 不适用 |

### 7.2 R/E/W 与本包的关系（防越级引用）

`cases.json` 的 `C-*` 是**工程契约语料**（02-F2-14），**不是** 76-§9 的 R1–R31/E/W 公共共同用例（那组用例的数据形状归 76-§9.2，正文与执行归 82）。因此：
- 本包任何测试**不得**声称覆盖某个 R/E/W；
- 若需追溯，`plat` 的 10 条只在“错误分类一致性”上与 `RUN-FAIL-01` 的**错误轴**有关，不涉及 77-§11.1 的 14 类失败分类；
- 公共共同用例的语料本体**不在** `packages/contract`（目标也不放：76 只给形状，正文归 82）。

### 7.3 目标件的 R/E/W/V 归属（逐件，不越级）

| 目标件 | R/E/W | V 层 | 证明什么 | 不证明 |
|---|---|---|---|---|
| `src/secrets.ts` | 无（对 V4 只提供工具） | V1 | 三个纯函数在冻结样例上的行为 | “九处强制出口都调了它”（归 82/装配面） |
| `src/daykey.ts` | 无 | V0/V1 | UTC 日键等价、公司日键的偏移/IANA 口径 | 报表汇总正确（归 company/panel）、tzdata 跨宿主一致（G-25） |
| `src/ports/intent.ts` + §4.10 | 无（U80-15 未证，不映射到任何 R/E/W） | V1/V2（纯函数级） | 键还原、status 判据、五值/三值不混、重投判定 | `IntentIngress` 实现、HTTP 层、崩溃重放（归 17） |
| `src/schemas/errors.ts` 两轴 | 无 | V1 | 14×缺省映射×6 可达 category 的构造规则 | 各实现的处置正确性（归 core） |
| `src/records/**` | 无 | V1 | 信封六条（含 `payloadRef: ArtifactRef` 的摘要语义）与 50 类形状 | 语义规则与 77 一致（V2 行为契约，归 82）；载荷落库/权检/四态读取（V2，归 03） |
| `src/ports/resources.ts` | 无（不承载任何 R/E/W） | V1（类型面 + `gap` 缺口规则） | 三态 `ResourceLimit` 与四 kind `ResourceGap` 的穷尽、缺省即未知、有限额度缺值的缺口生成 | 实现（`core/src/resources/` + `store/src/resources/`，U80-20）；`resourceLedger` 投影的实现与建表（名已登记、表未建，MIG-01）；五门按缺口的判定（归 `core/src/work-readiness.ts`） |
| `src/ports/binding.ts` | 无（不承载任何 R/E/W） | V1（类型面 + 映射分支） | `BindingProfile` 20 字段形状、`StateMapping` 两分支（`verified`/`unverified`）、`ExitPlan` 九段、`ExportBundle` 声明位 | 实现（`assembly/platform/binding.ts`，80-§6.9 只给落点、未列 U 项）；`localplatform`/`taiga`/`yt` 的档案内容；导出完整性与退出执行（V2，归 17/03） |
| `exchange/**` | 无 | V0 | 索引/文件/authoring 的自洽 | 冻结成立的另三道验证（G-17/G-18/U1/U2） |

---

## 八、未核、缺口与需回写

### 8.1 需回写其他卷的具体对象

| 编号 | 对象 | 问题 | 建议落点 |
|---|---|---|---|
| G-01 | `02-F2-02` 的 events 列含 `pid`，`17-§3` 与 `EventRecordSchema` 无 | 两处口径不一（`schemas/events.ts:10` 已注“疑点已上报”），至今未决 | 回写 02 或 17：明确 events 是否记进程号；未决前本包按 17-§3，不擅自加列 |
| G-02 | `EVENT_NAMES` 30 名的“投影词表”身份 | 80-§4.6 已定“投影不是 77 的 REC-*”，但 76/77 无对应登记；外部读者易误当公共枚举 | 回写 80-§4.6：把「实现投影词表清单（events 30+3、executor 3 码、billing 2 轨、platform 6 动、gateway 6 动、外部工具 10 名）」集中登记，供 81 引用而不逐文件重述 |
| G-03 | `Money.usd: number` / `EventRecord.cost_usd: number` 与 80-§4.1 `TS-SCALAR-04`“金额入库用字符串”冲突 | 现状台账列是浮点；改造涉及 F2-04 冻结列与全部读写方 | 回写 80-§4.1 或 76-§1.2：明确“台账行是 `DecimalString` 的例外”或给出迁移规则；本包**不**私改 |
| G-04 | `FetchLike` 的位置 | 79-§3.5/§10 称其在 `packages/contract/src/ports/models.ts` 与 `matrix` 共用；实查 `models.ts` **无此类型**，`matrix/client.ts:20`、`yt/http.ts:17`、`taiga/transport/http.ts:22` 各自定义且**签名不同**（`matrix` 用自有 `FetchInit`/`FetchResponse`） | 回写 79：更正位置；若要统一，须先在 80 定一个 `FetchLike` 承载面，再谈迁移 |
| G-05 | **已关闭**：`PlatformBinding` 命名冲突 | 80-§6.9 已给落点 `contract/src/ports/binding.ts`，80-§6.6 已把 `BindingProfile.losses` 定为 `readonly Qid[]`（指向 `REC-LOSS-01`、不内联）；`ports/company.ts:9` 的 `PlatformBinding` 是快照字段，**不改名** | 无（80 已定稿）；本卷 v0.8 按此把 BIND-01 拆到独立文件 |
| G-06 | `exe`/`inv`/`mdl`/`gw` 四域 0 条 case，但 `CASES.md` 列为“端口冒烟” | 契约面存在被声明却无兑现的域 | 回写 25-§六 或 `CASES.md`：要么补冒烟 case（4 域各 ≥1 正 1 负），要么把“各泳道冒烟”改为“由各包单测承担” |
| G-07 | `SourceManifest.configSchema: string` | 只是引用名，无法机械校验源配置 | 回写 80-§6.8/25-§3.4：登记“源配置校验无端口承载”，或给出 schema 引用解析面 |
| G-08 | `CompanySnapshot` 无修订号/摘要 | 快照无法判断“是否同一修订”，与 75-D75-14“所有版本引用钉住身份与代次”有落差 | 回写 80-§6.8 或 76：明确目录快照是否需 `definitionRevisionRef`；本包不擅自加字段 |
| G-09 | `WkeyClaims.ttl: string` 语义未定 | 时长/绝对时刻二义 | 回写 25-§4.1：写明格式与时钟源 |
| G-10 | `Notifier.send` 无超时/取消参数 | 与 80-§8.4 的重试/超时/取消纪律不一致 | 回写 80-§6.6 TS-PORT-NOTI-01：补 `AbortSignal`/时限或明示“由实现自担” |
| G-11 | `evtSubject` 的 `subcause` 依赖 zod issue 顺序 | zod 升级可能改变 `evt/invalid:<path>` 的可观测键 | 回写 76 或 `CASES.md`：把 `evt/invalid:*` 定为稳定子因（按字段名映射，不按 issue 序号） |
| G-12 | REPORT 同名二级节静默覆盖 | 无诊断的静默丢失，与 76-§1.7 精神冲突 | 回写 `CASES.md`/17-§3：决定“重名节拒收”或“后者胜并留诊断”；改=改契约，走批示 |
| G-13 | `C-rpt-005` 标题写“非 64 位十六进制”，schema 只查长度 64 | 用例名过度声明校验能力（非十六进制的 64 字符串会通过） | 回写 `CASES.md`/17-§3：改为“长度非 64”或把 nonce 收紧为十六进制（须补正例） |
| G-14 | `configInvalid` 不设置 `Error.name` | 下游若按 `name` 分支会失配 | 回写 80-§5.7：明确 `name` 是否为契约的一部分 |
| G-15 | `cases.json` 无秘密/本机路径扫描 | 语料可携带任意 `input` | 回写 19/82：把语料纳入出站扫描清单（与 `guard` 同类） |
| G-16 | **已关闭**：`FailureClass`（14 值）的 TS 承载 | 80-§4.1 `TS-SCALAR-10` 已给全部下划线字面量，80-§5.7 已把 `ClassifiedError.failure` 定为**必填**；v0.3 落 `records/scalars.ts`，`kernel.ts` 只 `import type` | 无（80 已定稿）；建议 80 补一行“文件家 = `contract/src/records/scalars.ts`”以便机械对账 |
| G-17 | 冻结工件的 `$id` 命名空间与版本化 URI 规则 | 75-§4.2 要求 `$id` 稳定，但 76 未给规则；编造即造假 | 回写 76：给出 `$id` 方案与工件版本化 URI；未定前 `exchange/**` 只能 `draft` |
| G-18 | 冻结 schema 的“正反样本等价”验证机制 | D75-08 要求验证，但唯一合法路径（生成后深比较）只覆盖 impl 工件；公共工件中 `record-envelope`/`classified-error` 无 authoring 时无法等价验证 | 回写 79/82：明确是否允许 dev-only 校验器，或把这两件的等价验证推迟到其 authoring 落地 |
| G-19 | 通用 `DEF-DIAG-01` 基形定名 + 14 个非规则诊断码无 TS 落点 | 规则面的字段名**已由 80-§6.1 定稿**：`location: RuleFieldPath`（= 76 的 `location`）、`expected?`/`actual?` 为**顶层短文本**、`limitsApplied` 由 `phase` 判别（`'limit'` 必填）——v0.5 及以前的“`path`”“收进 `safeDetails`”两处**均为误读，已纠**。本缺口只剩通用基形：76-§1.7 的 `location`/`expected`/`actual` 位尚无 80 为**非规则码**定的映射；`E-SYN-001..004`/`E-EXT-001..003`/`W-EXT-001`/`E-PKG-001`/`W-PKG-001`/`E-REF-001..003`/`W-REF-001` 共 14 码无 TS 承载。（`structure`/`refResolve`/`io` 三相无码**不是缺口**：80-§6.1 已明令不得当兜底桶，`io` 在纯函数里不得产生） | 回写 76/80：定通用基形的字段名（与 rules 面的 `location`/`expected`/`actual` 对齐）；给 14 码一个承载面（`DiagnosticCode` 联合或 `records/def-records.ts`）；未定前 rules 面按 80、非规则面不造基形，不产出 `diagnostic.schema.json` |
| G-20 | 实现投影能否作为交换工件 | 台账行仍是投影（`ledger-event` 不纳入）；`summary-sidecar`/`classified-error` 已按“跨边界”入选，但“运行时交换（impl exchange）”一类在 75/76 尚未立 | 回写 75/76：立该类并给规范地位，或明确禁止；`ledger-event` 未立前不创建 |
| G-21 | 公共工件全集缺口：50 类 `REC-*` payload、`RuleProfile`、绑定档案/损失报告 | 75-§4.1 要求这些也有冻结 schema；本包只有类型、无 authoring，体积超单文件预算 | 回写 76/77/80：给 authoring 归属（按章分文件还是另立发布面）与体积预算；未定前不设计、不占计数 |
| G-22 | `WorkState`（十态）无 TS 字面量 | **族登记**在 76-§7.7 的 `STAT-D`（工作）行，只给中文名（受理中/待开工/进行中/暂停/待验收/返工/已接受/已拒绝/已终止/已结清），规范位置另指 71-§5.1；**十态全集与 T01–T26 迁移表**在 77-§五/§5.1/§5.3，同样只有中文名。80-§4.7/§6.4 引用 `WorkState` 却未给英文/下划线字面量 | 回写 80-§4.7/§6.4：给十态下划线字面量与顺序（口径以 77-§5.1 为准，族登记同步 76-§7.7）；未定前 `ports/work.ts` 只声明不透明 `WorkState`，**不得**自造 |
| G-23 | `NotificationEnvelope` 的 ID 字段名 | 80-§6.6 原文写 `notificationId`；定稿口径为 `id`（与 `dedupKey` 并列、与其它信封一致） | 回写 80-§6.6：统一为 `id`，连带把“按 `notificationId` 去重”改为“按 `id`”；未回写前实现只许用一个名字 |
| G-24 | daemon 侧 `WebhookIntentPayload` 同名异义 | `apps/daemon/src/engine/intents/taxonomy.ts:96` 已导出 `WebhookIntentPayload{title, detail?, eventId?}`，与 80-§6.6 的公共类型（`source/kind/requestKind/dedupKey/company/ticket?/subjectRef?/requestedAt/body/correlation?`）同名异义；同仓两名一物，导入处极易错配 | 回写 17 卷 + daemon：私有类型改名（如 `WebhookEventBody`）或明确它只是公共类型的 `body` 形态；本包**不改公共名** |
| G-25 | `companyDayKey` 的时区数据来源 | 用 `Intl.DateTimeFormat` 依赖宿主 ICU/tzdata；Node 的 `small-icu`/`full-icu` 构建会影响 IANA 区可用性，本仓未固定 | 回写 79/80：登记“日键依赖宿主 ICU”的事实与核对方法（启动自检，或固定 `offsetMinutes` 出口）；未定前 `companyDayKey` 只作展示口径，不进台账键 |
| G-26 | 公司本地日键的函数名/参数类型名未定 | 80-§9.4 M1 只要求“需要公司本地日的投影必须显式传时区/偏移参数（新增参数位）”，未给函数名与 `zone` 形状 | 回写 80-§9.4：给正式名（或明说“由 `contract` 自定”）；未回写前本文用 `companyDayKey(ms, zone)`/`CompanyZone{iana, offsetMinutes?}` 并标明“本附录所拟”，实现只许一套名字 |
| G-27 | `TS-PORT-RES-01` 的**实现与建表**均未落地（U80-20） | 投影名 `resourceLedger` 已在 80-§6.3 **登记为目标名**（`TargetTableProjectionName` = `TableProjectionName` + `'resourceLedger'`，`TableProjectionName` 仍 17 张），物理表名 `resource_ledger` 也已定——**命名不是缺口**。真实缺口是：`core/src/resources/`、`store/src/resources/` 在盘**不存在**，`resource_ledger` **未建表**，`MIG-01` 未做；80-§6.4 只给端口签名与 §6.3 的投影归属 | 回写 80：给实现落点与 M 里程碑的排期与验收（落点已定：`core` 纯求值 + `store` 只读投影；缺的是谁在哪个里程碑交付、如何验收）；未落前本包只出**类型面**，不声称“资源账目可用”，也不把表名当事实源 |
| G-28 | **已关闭（v0.9）**：`TableProjectionResult.name` 的类型口径 | 80-§6.3 现文已写 `name: TargetTableProjectionName`，与 `TargetTableProjectionName = TableProjectionName \| 'resourceLedger'`、`ProjectionName = TargetTableProjectionName \| 'observation'` 一致（D30）；`project('resourceLedger')` 可回名 | 无（80 已回填）；本卷 `port-record` 同此口径；实现仍须按 `TargetTableProjectionName` 写死，不得收窄成 `TableProjectionName` 再强转（收窄即丢 `resourceLedger`），且 `resource_ledger` **未建表**（`MIG-01`） |
| G-29 | **已关闭（v0.10）**：`SEC-MX-BOT-PASSWORD` 的 `allowedUses` | 80 与 78 两处均已改为**恰两用途** `platform-auth` + `outbound-redaction`，`matrix-register` 与“保留未用”已删：80-§11.2.1 表、同节结论、D23；**78-§7.4.1** catalog 行（`docs/78-…:1015`）、用途说明（`:1022`）、认证段（`:1518`）、秘密用途汇总（`:1877`）均写明“不含 `matrix-register`、建号只认 `SEC-MX-HR-SHARED`”。两卷与本节一致，指控消失 | 无（78/80 均已回写）；实现仍按两用途校验（给 `matrix-register` 即 `configInvalid`），注册只取 `SEC-MX-HR-SHARED` |
| G-30 | **已关闭（v0.9）**：`classified`/`configInvalid` 的构造器落点 | 80-§5.7 现文已定：`classified` 与 `configInvalid` 同落 `packages/contract/src/schemas/errors.ts`（`configInvalid` 现址 `:54`）——同件、两个独立导出、互不包壳；`ClassifiedError`/`ErrorCategory` 留 `ports/kernel.ts:98`；明写**不另造** `contract/src/errors.ts`（D29） | 无（80 已回填）；本卷落点与之一致，F-ID 与计数不变 |

### 8.2 本次无法确认的具体点（未编造）

1. **`deps`/`mj`/`plat` 三域 35 条 case 的 `input` 细节**：只核了 `id`/`title`/`expected` 形状（脚本统计），未逐条读 `input` 内容与各包 subject 的对应关系；`docs/` 中 102/104/126/127/129/130/132/160/164/166/168/173/177/178/181 等编号**不在本仓 `docs/` 目录**（实查 `ls docs` 无对应文件），因此源码注释里这些“上位章节”无法在仓内核验——只登记，不据此断言语义。
2. **`docs/25 附录 A`（errorCode→ErrorCategory 映射）**：文件自称“草案形态、不进契约、无守卫、无负测”，本次未核其内容与本包 `EXECUTOR_ERROR_CODES` 是否一致（只确认三码常量存在）。
3. **`CASES.md` 与 `docs/25-§二` 的措辞一致性**：`CASES.md` 自称“本文件是契约格式的唯一规范”，而 25-§二 也在描述 ports/kernel；两者职责边界（格式 vs 类型）本次未逐段对照，只确认无直接矛盾。
4. **`zod@4.6.7` 的 `z.toJSONSchema` 输出对同一 schema 是否**字节稳定**：未运行验证（D75-08 已声明官方不保证）。因此 drift 测试设计为“深比较”而非“字节比较”。
5. **`package.json` 切 dist 后 `cases.json` 子路径导出对非 TS 消费者是否可用**：未证（U1/U2 同域）。
6. **本包当前是否处于根 `tsc` program**：只读确认根 `tsconfig.json:4` 通配包含 `packages/*/src/**`，**未运行** `tsc --listFiles`（U13）。
7. **`core` 具名 re-export 的消费面**：实查 2 处 import（`apps/daemon/src/assembly/hrsync/assemble.ts:15`、`apps/daemon/test/engine/hrsync/hrsync.test.ts:16`）+ 1 处调用（`assemble.ts:59`）；未运行测试，不据此断言迁移后全绿。
8. **55 个端口的复算依据**：80 无“端口总数”表头，本包按 80 的 **55 个 `#### TS-PORT-*` 小节**求和（53 新 + 2 已有 `EXEC`/`NOTI`），逐个 `grep -c '^#### TS-PORT-'` 可复核；80-§5.7 与 §6 现写作同一口径（各 55），**无口径差**；`SecretProvider` 不计入（供给面，80-§11.2.1）。若 80 后续改口径，本文的 53/55 需同步改，不得两处各说一套。

---

## 九、明确不做（本附录层面）

1. 不新增包、不新增允许边、不改 `boundary-rules.mjs`、不改 `lineBaseline`、不改 `maxLinesPerFile`/`maxFilesPerDirectory`。
2. 不把 `ContractRunner` 改成“契约引擎”（不加并发、不加 watch、不加 golden trace）——F2-14 的“外部依赖转 golden trace”属另一事项，本文不设计。
3. 不给端口加实现、不给 `Canonicalizer` 加实现、不写任何 JSON Schema 内容。
4. 不把 `EventRecord` 改名/包装成 `RecordEnvelope`（80-§12.6 第 5 条），不把 `CompanySnapshot` 包装成定义包，不把 `TaskBrief` 当合同。
5. 不改 `cases.json` 的既有 53 条（含 `C-rpt-005` 的标题口径——那是 G-13 的回写项，不是本附录可擅改的）。
6. 不声称 `plat` 三实现一致、不声称 50 类记录全覆盖、不声称 jcs@1 可用、不声称 `exchange/**` 已冻结。
7. 不把 `docs/` 缺失的 127/129/130/132 等编号当已存在规范引用；源码注释里的这些引用一律标“仓内未核”。
8. **不实现规则求值**：`RuleEvaluator` 的实现落 `core/src/rule/*`（02-core §5.7），本包只给类型；不写规则档解析、不打 NFA、不做十进制算术。
9. **不把实现投影造成交换工件**：`ledger-event` 与 `diagnostic` 不创建（G-19/G-20）；`summary-sidecar`/`classified-error` 只按“跨边界”入选且一律 `draft`；`exchange/**` 全部 `draft`。
10. **不写第二套脱敏**：`src/secrets.ts` 迁入后 `core` 只具名 re-export；不改冻结的标记形 `<redacted:N>`、`MIN_KNOWN_LENGTH=6`、三条正则与 `(?!<redacted:)` 负前瞻。
11. **不声称任何新端口文件已在盘**：80-§12.5 U80-18 明确“全仓无 `ports/secret.ts`、无那四个类型”；同理 `ports/{spec,authority,record,work,resources,capability,effects,binding,lifecycle,intent}.ts` 这 **11** 个目标文件**均不存在**（现有只有 `executor.ts`/`notifier.ts`/`company.ts` 等 9 个）。本附录只登记目标与前置，不拿"设计已写"冒充"文件已建"。
12. **不自造 `WorkState` 字面量**：十态未给英文值前（族登记 76-§7.7 的 `STAT-D`、全集与迁移 77-§五/§5.1/§5.3，均只有中文名），`ports/work.ts` 只有不透明别名；任何实现若先写 `'in_progress'` 之类值即违反 G-22 的回写前置。
13. **不把 `IntentReceipt` 当记录、不建第二事实源**：`intent_receipts` 是投影（`'intentReceipts'` 是 `TableProjectionName` 的成员，**不是** `'observation'` 的子集），删表必须可从 `REC-WORK-01/02` + `REC-EVT-03` 重建；不得在 contract 里加“回执表”类型或 `attempts` 计数。
14. **不在 contract 实现任何供给侧组件**：`SecretProvider`/`KnownSecretSet` 是接口，具体 provider、`IntentIngress`、`ReceiptStore`、`RuleEvaluator`、`ReadinessGate` 的求值、`Notifier` 的投递都在下游包；本包不引 `fetch`/`node:crypto`/`Intl` 以外的运行时能力（`Intl` 只出现在 `daykey.ts` 且登记 G-25）。
15. **不给 `port-resources` 任何写口或回执**：`ResourceAccountant` 只有 `baseline`/`gap` 两个只读方法；不得加 `reserve`/`commit`/`actual`/`release`，不得回任何 `Qid` 回执，不得新增 `REC-*`。资源预留只能经 `TS-PORT-WORK-04` 写 `REC-WORK-05.resource_reservations`，实际/释放只能经 `REC-EVD-01`/`REC-EVD-05`/`REC-EVD-06`；投影名 `resourceLedger`（物理表 `resource_ledger`）已登记为目标名，但**实现与建表未落地**（G-27）——名字已登记不等于资源账目可用，仍不得当事实源。
16. **不把 `MatrixBotLoginSecret`/`MatrixHrRegisterSecret` 抄进 contract**：两者属 80-§3.4 的 daemon `RunServeOpts`/`MatrixSessionFactoryDeps`——`MatrixBotLoginSecret`（`secretId:'SEC-MX-BOT-PASSWORD'`、`kind:'password'`、`allowedUses` **只** `platform-auth` + `outbound-redaction`）与 `MatrixHrRegisterSecret`（`secretId:'SEC-MX-HR-SHARED'`、`kind:'shared-secret'`、`allowedUses` **含** `matrix-register`）；`ports/secret.ts` 只装供给面，不得因为“名字里有 Secret”就搬进来，也不得把两者合并成一个“Matrix 秘密”类型（那会重新打开“拿 bot 密码建号”的口子）。`SEC-MX-BOT-PASSWORD` **不得**再挂 `matrix-register`（78/80 现均为恰两用途，G-29 已于 v0.10 关闭；仍不得照抄任何旧三用途）。
17. **不把 `KnownSecretSet` 的已知值暴露成字段**：`knownValues` 只在工厂闭包里；公共面只有 `secretIds`/`state`/`missingSecretIds`/`redactKnown`/`redact`/`find`。`redactKnown` 与 `redact` 不得互换（前者内部面只换已知值、后者出站面含形状兜底），`find` 不得当门禁。
18. **不把 80 的缺口在附录里私设**：`notificationId`→`id` 这类命名差异一律按“本文用定稿口径 + G 编号回写 80”处理，不两个名字并存、不悄悄改 80。
