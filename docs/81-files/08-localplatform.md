# 81-files/08 · `packages/localplatform` 逐文件技术细节

> 版本：v0.3.4，2026-10-27（v0.3.3 → v0.3.4 **按 80-§6.9 修正 BIND-01 边界**：① 通用 `PlatformBindingPort` 宿主 = daemon `apps/daemon/src/assembly/platform/binding.ts`（17 `F-daemon-platform-binding`，daemon 侧唯一实例），类型落点 = `contract/src/ports/binding.ts`；本包 `src/binding.ts` 只出 **LocalFile 特定纯函数**（`bindingProfile()`/`mapState()`/`lossReport()`，80-§6.6 三层第 3 条），**不再自称端口实现**，也**不得**导出 `describe`/`exportBundle`/`exitPlan` 或补第二份实现；`describe`/`exportBundle`（含范围闸）/`exitPlan` 归宿主；② `mapState` 保持纯函数——未映射但合法 ⇒ `Ok(unverified)` + **原值保留**，本包**不写** `REC-OBS-02`（消费方 daemon 装配/观察投影写），只有空/畸形才 `Err`；消费方在 `workStates=[]` 时不得迁移/验收/结清；③ G1 的“宿主冲突”据此**关闭**（17 已登记宿主）、G14 因 80 已明写写者而**关闭**；G15/G18 因 **01** 已把 `ports/binding.ts` 从 `effects.ts` 拆出（`F-contract-port-binding`，`01:111`）并把签名收口为 `mapState(platformState: string)` 而**关闭**（卷间冲突消；剩 contract 代码零命中、真实阻塞仍在 G15）；**G19 亦随 01 v0.9 关闭**——01 `:578` 已把 `mapState` 定为纯函数（零 IO、不写 `REC-OBS-02`、不写任何记录），记录责任留在消费方（相位 2 state-diff / `TS-PORT-OBS-01`），三卷同口径、无待回写；§八 补 `contract/src/ports/binding.ts` 一行（六个 → 七个目标件）；④ 本包文件计数不变（仍 1 生产件 + 2 测试件、`src` 17→20）；⑤ §八 接口摘录按 80-§6.3 补记录面 `payload(ref: ArtifactRef)` 与 `RecordWriteInput{envelope,payload}` 的**原始字节**（`RecordPayload{ref,bytes,mediaType}`、`contentDigest = byteDigest(bytes)`、`storageHint` 非本机路径/非权限凭证）与 **`knowledge`/`scope` 权限**（先由 `contentDigest` 反查信封、越权 `rejected_forbidden`/`payload-not-authorized`、`knowledgeScope` 在查询条件里过滤）；旧“四方法实现”“九组测试”“宿主待裁”表述与全套跨卷行号一并按 01 v0.9 / 02 v0.5 / 17 v0.4 重核。只改本卷，不动代码）。
> 版本沿革：v0.3.3，2026-10-27（v0.3.2 → v0.3.3 **四处小范围同步 80 + 一处行号重核**：① **`STATE_CONFLICT` 删除**——80 已裁定它不是 `ErrorCategory` 成员、全卷不得出现，读面三条错误改按 §5.7 缺省：`ledger-query-unsupported`→`unsupported`/**`EVOLVE_REJECT`**、`ledger-cursor-invalid`→`conflict`/**`EXTERNAL_REJECT`**（非合并域禁 `MERGE_CONFLICT`）、`ledger-query-invalid`→`rejected_precondition`/**`CONFIG_INVALID`**；② 投影名按 80-§6.3 分层——`TableProjectionName` 现状 17 个**不动**，`TargetTableProjectionName` 新增 `resourceLedger`（物理表 `resource_ledger`，随 `MIG-01`），逻辑名≠物理名；③ G16 按 80 新开的窄口重写（`rejected_precondition`→`EXTERNAL_REJECT` 只对 HTTP 404 `not-found`，本包的 `issue-not-found`/`kb-not-found` 仍不在内）；④ G1 复议：80-§6.9 现把 BIND-01 实现落点写成 `assembly/platform/`、类型落点写成 `contract/src/ports/binding.ts`，与本卷 host 冲突，登记待裁、不擅自搬；⑤ §八 行号与卷号按其**并行改版后**的现行正文重核（01 **v0.7** / 02 **v0.5** / 17 **v0.4**）；另 G15/G17/G18/G1 的 01 版本号一并更新，结论未变（G1 的 host 冲突仍待裁、G18 仍未收口）。只改本卷，不动代码）。
> 版本沿革：v0.3.2（2026-10-27）按 80 最新原文与 01 v0.5 收口三处：① 只读台账读面改 `Result`（`ReadOnlyLedger.query`/`get` 同步 `Result`，`Ok(undefined)` 才“不存在”，库失败 `Err(unavailable/STALL/ledger-read-failed)`；`RecordReader` 为异步 `Promise<Result<…>>`，两种失败都不得渲染成空页/空数据）；② G17 关闭（01 v0.5 起 `failure`=处置轴 / `category`=观测轴，v0.6 保持），G15/§八 卷号同步到 01 v0.6 / 17 v0.3，G18 仍未收口；③ `IntentReceipt`/`ProjectionName` 两处口径按 80-§6.6/§6.3 改写，§7.2 步 1 的跨卷提交清单随之改。
> 版本沿革：v0.3.1（2026-10-27）① 绑定面「不执行 `ExitPlan`」的通配端口 `TS-PORT-WORK-*`/`TS-PORT-LIFE-*` 按 80-§6.6 换成本卷实际消费的具体 ID——`TS-PORT-WORK-05`/`TS-PORT-LIFE-02`/`TS-PORT-AUTH-03`/`TS-PORT-AUTH-04`/`TS-PORT-REC-06`，不引入与本绑定职责不符的 `LIFE-03`；② `mapState` 的未知合法态口径按 80-§6.6 收紧：`Ok(unverified)` + 保留原值 + `REC-OBS-02` 由消费方落，`workStates=[]` 时**不得迁移/验收/结清**、不得以 `closed` 反推结清，只有空/畸形原值才 `Err`；③ §八 与 §6.3-G17/G18 的跨卷行号/卷号按 01 v0.4、02 v0.4、17 v0.2 实核更正，`openLedgerReadonly` 入参补全为 80-§8.2 的四字段。
> 版本沿革：v0.3（2026-10-27）按 80-§5.7/§6.6/§8.2/§9.4/§11.2.1、78-§1.2/§7.4.1/§9.4、77-§11.1 与 01/02/17 的 v0.3 定稿接口做一致性修订。
> 性质：自然语言级文件与实现设计呈审稿，**不是现行文件树、实现单或完成证明**。
> 范围：`packages/localplatform` 全部现有 `src/**`（含测试与测试基建）、`package.json`、`tsconfig.json`；外加一个**目标**生产件 `src/binding.ts`（LocalFile 档案/判决面，**不是**端口宿主）与其测试（§三）。daemon `assembly/platform/binding.ts` 的端口宿主只作跨卷登记（§八），不在本卷范围。
> 上位：75（文件/依赖模板、`F-*` ID、`D75-*`）、76（对象与状态族，§7.7 `STAT-D` 十值）、77（运行记录与失败语义，§11.1 十四类 `FailureClass`）、78（`BIND-PLAT-LOCAL-01`；§1.2 档案 20 字段、§7.4.1 秘密面、§9.4 平台绑定、§9.5/§9.6 映射与未知回执）、79（工程与依赖）、80（`FlowPlatform` 保留口径、§5.7 两轴错误、§6.6 `PlatformBindingPort`、§6.9 端口实现落点——BIND-01 宿主 `assembly/platform/`、类型 `ports/binding.ts`、§8.2 只读台账、§9.4 对外 API、§11.2.1 秘密供给）。
> 门禁：本文所有“目标/新增/拆分/替换/退役”均为**设计处置**，尚未执行；不得据此直接改生产代码、依赖清单、契约端口或 guards。**v0.3–v0.3.3 各次修订均未执行任何门禁、未改动任何代码**；计数、锚点与跨卷状态均为文档侧核对结果。

v0.3 的五处实质修订（逐项可在后文对照；v0.3.1 的三处修正见卷首版本行）：

| # | 修订 | 落点 |
|---|---|---|
| R1 | 错误面改**两轴**：`LocalPlatformError` 加 `failure: FailureClass`（77 十四类 snake_case 原值）与 `detail?`，与既有 `category`/`subcause` **同体不同轴**；本包仍是 throw 通道，`failure` 是给包装层读的义务，不是新增失败通道 | §2.5、`F-lp-errors`、§4.6 |
| R2 | 新增**一个目标生产件** `src/binding.ts`——LocalFile 特定的三个纯函数 `bindingProfile()`/`mapState()`/`lossReport()`（**不是**端口宿主，不导 `describe`/`exportBundle`/`exitPlan`）；同时新增 `src/binding.test.ts`。“未映射但合法 ⇒ `Ok(unverified)`”在此落成代码口径 | `F-lp-binding`、`F-lp-test-binding`、§1.2 |
| R3 | 关闭 v0.2 的 G1 与 v0.3.2 的“宿主冲突”：按 80-§6.9，通用 `PlatformBindingPort` 宿主归 daemon `assembly/platform/binding.ts`、类型归 `contract/src/ports/binding.ts`；本包只出 LocalFile 特定面（`F-lp-binding`），17-§四 的 W-12 据此回链 | §6.1-G1、§八 |
| R4 | 新增 §八「跨卷目标件登记」：`ports/intent.ts`、`ports/secret.ts`、`core/work-readiness.ts`、`assembly/intent/*`、`assembly/api/assemble.ts` **只登记消费面与主归属卷现状，不复制文件契约**（避免与 01/02/17 重复） | §八 |
| R5 | 写入者归属钉死：`REC-OBS-02`（未映射状态观察）与 `REC-LOSS-01`（损失引用）分别由 daemon 与 78 落；本包**只返回判决、不写记录、不自造 Qid** | `F-lp-binding`、§6.1-G14 |

---

## 〇、本卷口径

### 0.1 标记与状态

沿用 81 主索引 §四的九种标签：**现有 / 库级未接 / 目标-保留 / 目标-拆分 / 目标-新增 / 目标-替换 / 目标-退役 / 仅测试 / 未证**。另用两种限定词：

- **目标-固化**：现有行为被目标采纳为契约，但需要补证据或补边界校验；文件与导出不变。
- **目标-加固**：现有行为保留语义，内部实现按 75-`D75-13` / 80-§11.3 收紧（路径、原子写、上限）。

四种命题标记沿用 75-§0.1：〔事实〕〔结论〕〔选择〕〔假设〕。**本卷没有〔假设〕级结论被写成事实**。

### 0.2 排除物

`.git`、`node_modules`、`dist`、生成物、第三方源文件、历史设计文档本身。本包**没有** `test/` 目录、没有 fixtures、没有模板、没有 README/LICENSE、没有构建产物配置——这些“不存在”本身是核对结果，见 §1.1。

### 0.3 本卷不做什么

- 不新增公共概念、TS 端口、`REC-ID`、状态族、依赖边或依赖版本。发现缺口写入 §六「需回写」清单，由 76/77/78/80 决定。
- 不把 `FlowPlatform` 改名（80-§6.6 已把端口命名为 `PlatformBindingPort`，并明确“包装”而非“改名”；**快照字段 `PlatformBinding` 保名**，见 01 的命名裁决）。
- **登记一个目标生产件** `src/binding.ts`：它只出 LocalFile 特定的三个**纯函数**——`bindingProfile()`（档案骨架 + 声明期校验）、`mapState()`（平台态判决）、`lossReport()`（`REC-LOSS-01` 引用清单），供 daemon 的 `PlatformBindingPort` 宿主（`assembly/platform/binding.ts`，80-§6.9 / §6.6 三层）组合；**不新设端口、不新造字段、不新增目录、不实现端口、不导 `describe`/`exportBundle`/`exitPlan`**。这与“不新增公共概念”不冲突——端口与 20 字段档案都由 80/78 定义，本件只提供 LocalFile 那一份数据与判决。
- 不把本包纳入分发包（79-§6.5：`localplatform` 维持 `./src/index.ts`，不发布）。
- 不承担迁移编排（78-§9.7）与损失声明（76-§8.4 `REC-LOSS-01`）：本卷只给可导出格式与“原值保真”义务；代码/数据/权威三种迁移的边界见 §4.8。
- 不自造记录：`REC-OBS-02`（未映射状态观察）由 daemon 在读到 `verification:'unverified'` 时落；`REC-LOSS-01` 由 78 档案给。本包只返回 `StateMapping` 判决，**不写台账、不拼 Qid、不补 `REC-*`**。

---

## 一、计数与总表

### 1.1 现有件全集（可复算）

路径根：`packages/localplatform/`。共 **19** 个第一方文件 = `src` 17 个 `.ts` + 2 个配置。

| 类别 | 数量 | 文件 |
|---|---|---|
| 生产 `src` | 12 | `index.ts`、`platform.ts`、`issues.ts`、`activity.ts`、`comments.ts`、`fields.ts`、`guards.ts`、`kb.ts`、`links.ts`、`layout.ts`、`fsutil.ts`、`errors.ts` |
| 测试基建 `src` | 1 | `testutil.ts` |
| 测试 `src`（与源码同目录） | 4 | `activity.test.ts`、`facets.test.ts`、`lifecycle.test.ts`、`plat-cases.test.ts` |
| 配置 | 2 | `package.json`、`tsconfig.json` |
| 目录/夹具/模板/README/LICENSE/构建配置 | 0 | 核对结果：无 `test/`、无 `fixtures/`、无 `dist/`、无 `*.config.*`、无 README/LICENSE |

行数（`wc -l` 实测）：`issues.ts 261`、`lifecycle.test.ts 248`、`facets.test.ts 231`、`activity.test.ts 207`、`plat-cases.test.ts 171`、`platform.ts 121`、`activity.ts 109`、`kb.ts 106`、`comments.ts 103`、`fields.ts 101`、`guards.ts 71`、`fsutil.ts 71`、`links.ts 64`、`layout.ts 56`、`testutil.ts 48`、`index.ts 40`、`errors.ts 23`，合计 2031 行。

### 1.2 目标件全集与处置统计

| 处置 | 数量 | 对象 |
|---|---|---|
| 目标-保留（含目标-固化/加固，文件与导出不变） | 12 | 全部现有生产 `src` |
| 目标-保留（测试基建） | 1 | `testutil.ts` |
| 目标-保留（测试） | 4 | 现有四个测试文件 |
| 目标-新增（生产） | 1 | `src/binding.ts`（LocalFile 特定纯函数 `bindingProfile()`/`mapState()`/`lossReport()`；**不是端口宿主**，宿主在 daemon，80-§6.9；**受 contract 类型前置阻塞**，见 §6.1-G15） |
| 目标-新增（仅测试） | 2 | `src/robustness.test.ts`（缺陷与边界回归）、`src/binding.test.ts`（绑定端口） |
| 目标-保留（配置） | 2 | `package.json`、`tsconfig.json` |
| 目标-拆分 | 0 | 无超限件，见 §1.3 |
| 目标-替换 | 0 | 无 |
| 目标-退役 | 0 | 无文件退役；只有 `testutil.expectLocalError` 一个未用导出标记为“可随任意提交退役” |
| **目标合计** | **22** | **13 生产 + 1 基建 + 6 测试 + 2 配置** |

〔结论〕**本包目标新增 1 个生产件与 2 个测试件，不拆分、不退役文件。** 这看似与 80-§2.4 第 1 条（“`localplatform`… 的**实现**不动，只在端口侧补目标签名”）冲突，其实不：该条冻结的是 `FlowPlatform` 的**实现**；`PlatformBindingPort` 的**宿主**按 80-§6.9 归 daemon `assembly/platform/binding.ts`，本卷不实现端口，只在同根处补 LocalFile 特定的档案/判决/损失/退出声明，理由三条：① 档案描述的就是同一个平台根，能力面与档案面同根最不易漂；② 本包零外部依赖，`binding.ts` 只需 contract 类型即可编译；③ 它可被本卷测试直接覆盖，无需拉起 daemon；端口装配与台账导出仍由 daemon 宿主承担，不构成第二份实现。W-12 的“host 未定”据此收口（§6.1-G1）。其余目标工作仍落在既有文件的**内部边界**（校验、路径、原子写）与**测试证据**上，不做目录重排。

### 1.3 层位、边与预算（现行机械事实）

| 项 | 事实 | 对目标的约束 |
|---|---|---|
| 包层位 | `packageLayers.localplatform = 1`（`scripts/guards/boundary-rules.mjs`） | 只可依赖层位更低者；实际唯一 workspace 边见下行 |
| 允许边 | `["localplatform","contract"]` 一条；反向边 `["company","localplatform"]`、`["daemon","localplatform"]` 另表登记 | 目标不得新增任何跨包边；本包不得 import `node:child_process`、`hono`、任何平台实现 |
| 目录预算 | `src` 直下 17 个 `.ts` ≤ `maxFilesPerDirectory = 25` | 目标新增 3 个件（`binding.ts`、`robustness.test.ts`、`binding.test.ts`）后 **20 件，余 5 个名额**；不得为“整理”新增散件，也不得为腾名额建子目录（本包保持扁平） |
| 文件预算 | 最大 `issues.ts` 261 行 ≤ `maxLinesPerFile = 600` | 目标加固后仍须 ≤ 600；规划上限 300 |
| `lineBaseline` | **无本包任何条目**（已逐条核对 22 条基线） | 不存在“超限件拆分义务”；也不得把新文件塞进基线 |
| 类型门禁 | 根 `tsconfig.json` 的 `include` 含 `packages/*/src/**/*.ts`，故 `src/*.test.ts` 也在根 program；包级 `typecheck` 脚本另跑 `tsc --noEmit -p tsconfig.json`（`include: src/**/*.ts`，含测试） | 满足 79-§4.4 “包级 typecheck 并入根脚本”的前提条件；本包不切 `dist`，无需退出根 program |
| 测试发现 | 根 `vitest run` 无独立配置，默认模式覆盖 `src/*.test.ts` | 新增测试沿用同目录命名，不改测试运行器 |

〔事实〕本包**没有** `lineBaseline` 条目，且目录未顶格，因此 81 主索引 §3.2 末条“`lineBaseline` 超限件必须给目标拆分与兼容面”对本包不适用；这不是遗漏，而是核对结论。

---

## 二、包级契约

### 2.1 定位（三层身份，不得混写）

| 身份 | 内容 | 上位锚 |
|---|---|---|
| 实现层 | `FlowPlatform` 端口（七能力、17 必选方法 + 1 可选方法）的**文件驱动第二实现** | 80-§6.8 `FlowPlatform` 保留清单；`contract/src/ports/platform.ts:179` |
| 绑定层 | LocalFile 平台绑定 `BIND-PLAT-LOCAL-01` 的**LocalFile 面**（能力面 `platform.ts` + 档案/判决面 `binding.ts`）；通用 `PlatformBindingPort` 宿主在 daemon `assembly/platform/binding.ts`（80-§6.9）；损失与退出由 78 的绑定档案声明，不由本包自证 | 78-§9.4；78-§1.2；80-§6.6；80-§6.9；逐项对照见 §2.8，实现见 §三 `F-lp-binding` |
| 用途层 | ① P8 零依赖 demo；② 契约测试靶子（`plat` 域 10 case 的 localfile 侧）；③ 端口形状有效性证明 | `docs/23-§一/三.2`；`packages/contract/CASES.md` plat 域说明 |

〔结论〕三者都不能外推：**跑通 demo 不证明端口语义完整；10 条 plat case 只断言 `category` 全等，不证明跨实现语义等价；文件可读不证明真机并发安全。**

### 2.2 职责与非职责

**职责**：把七能力落到一个目录的 append-only 文件形态上；提供确定性的活动游标（不重不漏）；把非法输入与损坏数据以 `LocalPlatformError(failure, category, subcause, detail?)` **两轴**如实上报（映射与唯一例外见 §2.5；静默降级两处见 §4.2）；在同一根上支持多实例互通（实例无内状态）。

**非职责**：

1. **不执行 guard**（`guards.ts` 只落盘）。平台侧第二道闸“未来在 `transition()`”，当前不存在。
2. **不校验状态机合法性**：`transition()` 只拒空串，不查 provision 声明集；非法迁移由 daemon state-diff 承担（78-§9.4 “真正的闸”）。
3. **能力面（`FlowPlatform`）不做 STAT-D / STAT-E 映射**：`issues`/`activity` 里的 `state` 是平台态字符串，不是 `STAT-D`；不得据此判“已接受/已结清”（76-§7.7；78-§9.1 共同禁令）。**唯一例外是绑定面** `binding.ts`：它按 78 档案的 `stateMappings` 把平台态**判成** `WorkState`（只许 `STAT-D`、禁 `STAT-E`，未命中即 `unverified` + `workStates:[]`），但那是**给消费方看的判决**，不推进、不迁移、不结清。
4. **不做验收、不判价值、不结清、不落台账**：这些属 77 `RUN-EVD-*` 与 store/daemon。
5. **不保证并发安全**：只按“单 daemon（或单 CLI）写”假设；无文件锁、无 fencing token、无原子 rename。
6. **不保证秘密安全**：本包无凭据面（纯本地目录、无外部服务），因此不存在“凭据泄漏”路径，但也**没有**任何出站扫描能力——出站脱敏归 daemon 的 `KnownSecretSet.redact`（80-§11.2.1 / 01 `ports/secret.ts`），本包不实现第二份。
7. **不证明真机**：无网络、无子进程，其“真机”问题只有文件系统语义（大小写、符号链接、NFS、崩溃中途）。

### 2.3 写入者与调用链（〔事实〕，只读核对）

| 调用方 | 用法 | 锚点 |
|---|---|---|
| daemon 装配 | `createLocalPlatform(platformDir)` → `wireGatedPlatform(...)` 包成过闸写面 | `apps/daemon/src/assembly/platform/wire.ts:15,131-134` |
| daemon CLI | `company create` 惰性注入 `platformPort: () => createLocalPlatform(platformRoot)` | `apps/daemon/src/cli/company.ts:9,144` |
| company（仅测试依赖） | `create.test.ts` / `git-import.test.ts` 以真实实现验证 `fields.provision` 落盘 | `packages/company/package.json` devDependencies；`company/src/create.ts:409` |
| 契约测试 | `plat-cases.test.ts` 的 subject 路由 | `packages/localplatform/src/plat-cases.test.ts:38-76` |

〔事实〕生产链只覆盖 `fields.provision`（company create）、以及 daemon 的九写面/八读面过闸包装。**`guards.read` 在 daemon 侧被丢弃**：`createGatedPlatform` 返回的 `guards` 面只有 `install`/`uninstall`（`apps/daemon/src/engine/tools/gated-platform.ts:197-206`），而端口把 `read` 声明为可选（`contract/src/ports/platform.ts`），`createFakePlatform` 也不实现它。因此本包的 `guards.read` 是**现有但生产不可达**：`库级未接`。该缺口属 daemon 附录（81-files/17），本卷只登记邻接事实。

〔事实〕**绑定面（`binding.ts`）目前零生产调用方**：文件尚未存在（目标件），装配点也未落（17-§四 只登记了 `wireGatedPlatform`/`wirePlatform`；按 80-§6.9，目标装配点是 daemon `assembly/platform/binding.ts`，待 17 回链）。因此本表对本包是“能力面写入者”；绑定面**不写任何东西**，不构成第二写入者，也不改变本包的写入者数量。

### 2.4 导出面（包公开面 = `src/index.ts`）

| 导出 | 类型 | 仓内消费者 |
|---|---|---|
| `createLocalPlatform(root, opts?)` | 值 | daemon `wire.ts`、`cli/company.ts`、company 两个测试 |
| `LocalPlatformOptions` | 类型 | 无显式消费者（由 `createLocalPlatform` 签名隐式使用） |
| `LocalPlatformError` | 值（类） | `plat-cases.test.ts` 反证面 |
| `DEFAULT_INITIAL_STATE` | 值 | `lifecycle.test.ts` |
| `DEFAULT_PAGE_SIZE`、`formatActivityId`、`parseActivityId` | 值 | **无仓内消费者**（全仓 grep 仅命中注释）；保留但无兼容义务 |
| `PACKAGE_NAME`、`PACKAGE_STATUS = 'ready'` | 值 | 无消费者；`'ready'` 是标记，不是能力证明 |
| `bindingProfile()`、`mapState()`、`lossReport()` | 值（**目标-新增导出**） | 目标：daemon 宿主（81-files/17 的 `assembly/platform/binding.ts`）把它们组合成 `PlatformBindingPort`（80-§6.9 / §6.6 三层；本卷只供纯函数，接线归 17） |

〔结论〕导出面**只做纯增，不删不改名**：目标加三条再导出（`bindingProfile`/`mapState`/`lossReport`，与 `src/binding.ts` 同批提交，否则是不可达导出；§0.3 的“不新增公共概念”指不扩**概念**，不指不给已定 LocalFile 数据开门）。前述最后两行的事实必须记住：**没有消费者，不等于可以随意改**——外部 demo 使用者的可能性存在，且静默删除会违反 79-§4.1 第 4 条“只导出接口面”的保守取向。目标处置：既有导出全部保留。

### 2.5 错误面总则（两轴：`failure` × `category` × `subcause`）

〔事实〕本包 23 个 `subcause`（全部实枚举，与代码逐条核对；`state-via-set-field` 在 `issues.ts:134` 的多行构造里，grep 单行会漏）：

| `category`（现状） | subcause |
|---|---|
| `EXTERNAL_REJECT` | `issue-not-found`、`kb-not-found` |
| `CONFIG_INVALID` | 其余 21 个：`bad-company-slug`、`bad-create-input`、`bad-cursor`、`bad-field-value`、`bad-guard-rules`、`bad-kb-body`、`bad-link-type`、`bad-provision`、`bad-signed-body`、`bad-state`、`corrupt-activity`、`corrupt-comments`、`corrupt-issue-log`、`corrupt-json`、`corrupt-jsonl`、`corrupt-links`、`kb-path-escape`、`kb-path-invalid`、`self-link`、`state-via-set-field`、`unknown-field` |

〔结论〕目标形状是**两轴一个载体**（80-§5.7；77-§11.1 的十四类原值，下划线，不得改写）：

| 字段 | 轴 | 本包的值 |
|---|---|---|
| `failure` | **处置轴**（重试/断路器/对账/升级/判等只读它） | 见下表；现状实现只用 `rejected_precondition`（外加一个例外组合） |
| `category` | **观测轴**（告警分桶与事件 note） | 保持现状 2 + 21 不变（`EXTERNAL_REJECT` 2 / `CONFIG_INVALID` 21） |
| `subcause` | 实现细目（自由字符串、稳定命名） | 23 个，见上表 |
| `detail?` | 人读补充 | 只放可公开的补充；**绝对路径不得进 `detail`**（80-§5.8；现状 message 带 `${path}` 属已登记漂移 D4，修复须与测试断言同批改） |

`failure` 映射（本包唯一表，端口不得各自另定）：

| subcause 组 | `failure` | `category` | 依据 |
|---|---|---|---|
| 21 个 `CONFIG_INVALID` | `rejected_precondition` | `CONFIG_INVALID` | 80-§5.7 的缺省映射，**无 override**。这 21 个全是“调用方给的前置条件不成立”：坏输入、坏游标、坏 provision、结构损坏、通道误用（`state-via-set-field` / `self-link` 是**通道**用错，不是授权判定） |
| `issue-not-found`、`kb-not-found` | `rejected_precondition` | `EXTERNAL_REJECT` | **唯一的两轴例外**，见下第 2 条 |

〔结论〕七条口径：

1. **`category` 仍是 contract 的 11 值冻结枚举**（`contract/src/ports/kernel.ts:85-96`，17-§9），不因加 `failure` 而改值。本包**不产** 77 的其余 13 类：`FlowPlatform` 是**保留的内部端口**，拒绝仍以 throw 表达（80-§6.8）；`failure` 是写给**包装层**（`EffectGateway`、`PlatformBindingPort`、API 错误体）读的义务，不是本包新增的失败通道。**这条豁免关系 80 仍未明写，见 §6.1-G3。**
2. **唯一例外必须显式登记，不得扩散**：`issue-not-found`/`kb-not-found` 是“引用对象不存在”。77-§11.1 没有 `not_found` 类（80-§5.7 明写“`not_found` 不是 `FailureClass`”），而冻结验收面要求 `category=EXTERNAL_REJECT`（`C-plat-007`；`plat-cases.test.ts` 的五族键前缀），80-§5.7 又给 `rejected_precondition` 定了 `CONFIG_INVALID` 缺省且**不允许显式覆盖**。本卷取最接近的 `rejected_precondition` + 保留冻结 `category`，并把它登记为**唯一例外**：修法只能由 80 裁决（给“引用对象不存在 → `EXTERNAL_REJECT`”的显式 override，或对保留端口给豁免），**不得**造第 15 个 `failure`、不得改 case、不得新增第二个例外（§6.1-G16）。
3. **构造期固定档**：加固期新增的拒收（如计划中的 `bad-page-size`）一律 `failure:'rejected_precondition'` + `category:'CONFIG_INVALID'`（80-§5.7 末条“构造期非法固定此档”）。**不得**因为“加了 `failure`”就把配置错改报 `STALL`/`unavailable`。
4. **同错同键扩为三键**：`category × subcause` 两次必须相同（`plat-cases.test.ts:124-141`）；加 `failure` 后判等键是 `failure × category × subcause`，三者都不得抖动。
5. **结构损坏归 `rejected_precondition`，不归 `unavailable`**：`corrupt-*` 的语义是“盘上数据不满足可解析前置”，运维改文件即可恢复；`unavailable` 留给“来源不可达”（台账缺失、端点不可达），`partial` 留给部分成功。把损坏报成 `unavailable` 会把“改文件”误导成“退避重试”。
6. **台账/端点类错误不在本包**：`store` 的 `db-missing` ⇒ `unavailable/STALL`、schema 版本不符 ⇒ `rejected_version/EVOLVE_REJECT`（80-§8.2）都是 daemon 侧事实；本包不产生、也不应复述成自己的 `subcause`。
7. **静默降级仍是两处，不因两轴而扩大**：`readProvision` 形状坏降级为“未 provision”、空 `author` 改写为 `'unknown'`（§4.2、§4.7）。它们是“未知被映射成值”，修法是 D7/G7 的显式拒收，**不得**改成 `failure:'unverified'` 的 `Err`——那会把“查询某张单”变成“这次查询失败”。另：`corrupt-*` 的 fail-closed 代价（一行坏数据阻断该面全部写、无修复工具）已在 §6.5-G5 登记，不属错误面缺陷。

〔事实〕目标期新增的实现侧 `subcause`（`bad-page-size`、`bad-activity-kind`、`kb-tree-too-large`、`binding-*`）**不改变上面 23 这个现状数**，也不改 `category` 冻结面；映射规则同上第 3 条。唯一可能的第二个 `failure` 值是 `unavailable`（配 `subcause:'fs-io'`，`EACCES`/`ENOSPC` 若决定包装）：按 80-§5.7 应取 `unavailable` + `STALL`，但那属错误面扩张，须先由 G8 裁决，本卷不预置。

### 2.6 IO 与注入总则

| 依赖 | 现状 | 目标 |
|---|---|---|
| 时钟 | 构造器注入 `now?: () => string`，缺省 `new Date().toISOString()` | 保留；本包不引入 `Date.now()` 其他取值点 |
| 分页 | 构造器注入 `pageSize?: number`，缺省 100 | 保留；目标构造期校验正整数（`CONFIG_INVALID/bad-page-size`，§6.4-D8） |
| ID | **不注入**：单据号由目录扫描推导（`LOCAL-<n>`），活动号由文件末尾 `max+1`（`a-000001`），评论号由 `listComments().length+1` | 保留但登记风险：ID 非单写入者生成，且删除最高位文件会导致**复用**（§6.5-G6） |
| 随机 | 无 | N/A：本包无安全相关随机 |
| 网络/子进程 | 无 | 不得引入 |
| `fs` | 同步 API（`readFileSync`/`writeFileSync`/`appendFileSync`/`mkdirSync`/`readdirSync`/`statSync`/`existsSync`） | 保留同步（端口方法包成 `async`，见 `F-lp-platform` 条目） |
| 环境变量 | 无 | N/A |
| 绑定面（目标 `binding.ts`） | 无 fs、无时钟、无网络；档案构造期注入；**不含导出器**（`exportBundle` 在 daemon 宿主） | 保持**零 IO**：不得在包内读 `meta/`、不得读台账（台账在 store/daemon，80-§8.2） |

### 2.7 构建与分发

〔事实〕`package.json`：`private: true`、`type: module`、`main`/`exports["."]` 均指 `./src/index.ts`、`dependencies` 只有 `@studio-next/contract`、无 `license`。`tsconfig.json` 继承仓根 `tsconfig.base.json`（`strict` + 全严格开关 + `erasableSyntaxOnly` + `verbatimModuleSyntax` + `noEmit`），`include: ["src/**/*.ts"]`。

〔结论〕按 79-§6.5 本包**不切 dist、不发布**，因此：

- 不需要 `tsconfig.build.json`、不需要 `files` 白名单、不需要 `rewriteRelativeImportExtensions` 验证；
- 若**未来**要切 dist（未提案），则必须同单完成：`src` 退出根 program、包级 `typecheck` 并入根 `bun run typecheck`、`build→typecheck→测试` 顺序、`exports.types` 指向 `dist/*.d.ts`（79-§4.4/§6.1）。本卷不预置这套改造。
- 本包不是 DSH 能力包，不适用“对外提供 JS+.d.ts”的要求（75-`D75-07`）。

### 2.8 文件平台（LocalFile）身份卡（对齐 78-§9.4）

〔事实〕`BIND-PLAT-LOCAL-01`（版本 `1.0`）的档案行与代码现状逐项对照：

| 档案项 | 78 声明 | 代码现实（锚点） |
|---|---|---|
| 定位 | **契约靶子**：不依赖外部服务，验证 `FlowPlatform` 形状与行为 | 无网络、无子进程、无凭据；`node:fs` 只在 `fsutil.ts:7`、`issues.ts:21`、`kb.ts:8` 三处直引 |
| 覆盖 | 七能力；`guards` **只落盘不执行** | `platform.ts:45-120` 七面齐全；`guards.ts:1-13` 明写不执行 |
| 真正的闸 | daemon state-diff（第一道）；平台侧第二道**未来**在 `transition()` | `transitionIssue` 只拒空串，不查声明集（`issues.ts:246-247`） |
| 初态解析 | 显式 `initialState` > `typeInbox[type]` > `states[0]` > 平台默认 | `issues.ts:216-235`；默认 `open`（`DEFAULT_INITIAL_STATE`），**定格进 `created` 事件** |
| 供给/授权 | 纯本地目录，无外部服务；无凭据 | 构造器只收 `root`/`now`/`pageSize`（`platform.ts:34-51`） |
| 证据 | 文件内容 + 适配器测试 | 四个 `src/*.test.ts`；无平台侧签名、无回执 |
| 损失 | guard 不执行（degrading，已被 daemon 承接）；单机文件（degrading：无并发控制） | 另有本卷补登记的损失，见 §6.2-G10 |
| 导出/迁移/退出 | 目录可整体复制；迁移见 78-§9.7（**作为靶子不参与真迁移**） | 无导出命令；`layout.ts:1-15` 的根布局即导出格式（§4.8） |
| V5 缺口 | 与 daemon state-diff 的联合拦截、并发写 | 一致（`U-LP-01/02/10`，§5.3） |
| 现状 | 已有（`wirePlatform` 的 `localfile` 分支） | `wire.ts:129-135`：`root = resolvePath(platformDir ?? <rootDir>/platform)`；平台缺省是 `fake`（`serve.ts:373`），localfile 须显式配置 |

〔事实〕`createLocalPlatform` 构造时 `ensureDir` 三个目录（`issues/`、`kb/`、`meta/`，`platform.ts:48-50`），**但不写 provision**：`fields.provision` 是公司装载面的一次性运营动作，daemon 不代写（`wire.ts:124-127`；`issues.ts:17-18` 头注同口径）。

〔结论〕“文件平台”在本仓是**可写、可读、可复制，但不可自称合规**的实现侧，分工必须说清：

- **本包承担**：盘上格式（`layout.ts`）、七能力实现、拒绝与错误分类、初态解析、guards 落盘与角色投影、活动游标与分页；**以及 LocalFile 特定的绑定数据/纯函数**（目标件 `src/binding.ts`：`bindingProfile()` + `mapState()` + `lossReport()`，§三）；端口宿主（`describe`/`exportBundle`/`exitPlan` 与装配）归 daemon `assembly/platform/binding.ts`（80-§6.9 / §6.6 三层）。
- **本包不承担**：guard 执行、并发控制、幂等键、活动对账、授权判定、迁移编排（78-§9.7）、损失声明（76-§8.4 `REC-LOSS-01`）与未映射状态的观察记录（`REC-OBS-02` 由 daemon 落）。
- 因此“把 guard 塞进 `transition()`”“在本包补幂等键”“在本包造完整性位”三类提案，都须先改 78 档案或 80 端口，否则等于把靶子改成第二个闸（§6.1-G3/G4）。绑定面不是第二道闸：`binding.ts` 只把档案与平台态**读出来给人/给消费方**，不推进状态、不判验收（78-§9.5 禁令）。

---

## 三、生产文件条目

### F-lp-index

- **路径/处置**：`packages/localplatform/src/index.ts`（40 行）；**目标-保留**；导出集**纯增三条**（`bindingProfile` + `mapState` + `lossReport`），不删、不改名。
- **归属**：80-§2.4（包层目标语义“实现不动”）、79-§6.5（`exports` 维持 `src`）、80-§6.6/§6.9（新增再导出的唯一理由：让本包的 LocalFile 档案面可达；端口宿主在 daemon，不在本包）；语义来源是 `docs/23-§一` 的 `FlowPlatform` 七能力，不在此重定义。
- **职责**：包的唯一公开面——再导出构造器、错误类、默认初态、游标工具与两个标记常量；目标再加 LocalFile 绑定构造器一条（§2.4）；文件头注记 7 条端口疑点（写给后续实现者，不是规范）。
- **非职责**：不做装配决策（根目录、时钟、分页由调用方给）；不执行副作用；不声明能力等级（`PACKAGE_STATUS='ready'` 只表示“七能力齐”，不是 V2–V5 证据）；不在此导出 `PlatformBindingPort` 的实现。
- **内部结构**：无类型与函数体，只有 6 条 `export`/`export type` 与 2 个常量；目标再加 `export { bindingProfile, mapState, lossReport }` 三条（指向 `./binding.ts`）。
- **导出与依赖**：`export { createLocalPlatform }`、`export type { LocalPlatformOptions }`、`LocalPlatformError`、`DEFAULT_INITIAL_STATE`、`DEFAULT_PAGE_SIZE`、`formatActivityId`、`parseActivityId`、`PACKAGE_NAME`、`PACKAGE_STATUS`；目标加 `bindingProfile` / `mapState` / `lossReport`。允许依赖：无外部依赖（纯再导出，包内相对路径不算边）。禁止：不得从 daemon / store / company 反向 import。
- **IO 与注入**：N/A：无 IO。注入面完全由被再导出的构造器定义。
- **状态/并发/恢复**：N/A：模块级无状态。
- **错误与观测**：N/A（模块求值不抛）。
- **测试与证据**：被 `lifecycle.test.ts`、`activity.test.ts`、`facets.test.ts`、`plat-cases.test.ts` 以 `./index.ts` 导入。证明：公开面可加载。目标：`binding.test.ts` **经 `./index.ts`** 取 `bindingProfile`/`mapState`/`lossReport`，让“再导出可达”本身有证据。不证明：真机、跨实现。
- **规模与迁移**：≤70 行（原 ≤60 + 三条导出）。**文件头注记已漂移**（§6.4-D1/D2）：第 3 条“`SignedBody` 无独立 author”与当前 contract（`author: PersonId` 必填）及本包 `comments.ts` 实现矛盾；第 6 条“`FieldProvisionMap` 不带字段类型”与 contract 的 `types?` 矛盾；第 4 条“`PlatformActivity.issue` 必填”与 contract 的可选矛盾。目标：随加固单**只改注释**对齐事实；若改注释，须在提交说明里标“文档-代码漂移修正”，不得顺手改行为。**新导出的再导出必须与 `src/binding.ts` 同批**（前置见 §6.1-G15），否则留下不可达导出。

### F-lp-platform

- **路径/处置**：`packages/localplatform/src/platform.ts`（121 行）；**目标-保留**（组装器，七面 18 方法一一转发）。
- **归属**：80-§6.8 `FlowPlatform` 保留清单；80-§8.6（时钟/分页注入）；78-§9.4（LocalFile 绑定实现侧）；`docs/23-§一`。
- **职责**：把 `root`、`now`、`pageSize` 三个注入值闭包进七面对象；构造时确保 `issues/`、`kb/`、`meta/` 三个目录存在；把 18 个异步方法逐一映射到 `issues.ts`/`comments.ts`/`fields.ts`/`kb.ts`/`activity.ts`/`links.ts`/`guards.ts` 的同步函数。
- **非职责**：不做输入校验（下沉到各面）；不做写闸（`gated-platform.ts` 负责）；不缓存任何中间态；不解析配置。
- **内部结构**：
  - `LocalPlatformOptions { now?: () => string; pageSize?: number }`（均可选）。
  - `defaultNow(): string` → `new Date().toISOString()`（UTC、毫秒精度、字典序=时间序的前提）。
  - `createLocalPlatform(root: string, opts?: LocalPlatformOptions): FlowPlatform`。
  - 方法映射表（逐条核对）：`issues.list→listIssues`、`issues.get→getIssue`、`issues.create→createIssue`、`issues.transition→transitionIssue`、`issues.setField→setIssueField`、`comments.add→addComment`、`comments.list→listComments`、`fields.schema→fieldSchema`、`fields.provision→provisionFields`、`kb.upsert→kbUpsert`、`kb.search→kbSearch`、`kb.get→kbGet`、`activity.since→activitySince`、`links.link→addLink`、`links.children→childTickets`、`guards.install→installGuards`、`guards.uninstall→uninstallGuards`、`guards.read→readGuardRoles`。
- **导出与依赖**：导出 `createLocalPlatform`、`LocalPlatformOptions`。导入：`@studio-next/contract`（17 个类型）、本包 `activity/comments/fields/guards/fsutil/issues/kb/layout/links`。**层内方向**：`platform.ts` 是唯一聚合点，全部面文件不得 import `platform.ts`（否则成环）。
- **IO 与注入**：构造期 `ensureDir(root/issues)`、`ensureDir(root/kb)`、`ensureDir(root/meta)`——**构造即落盘**。这一事实被两个调用方显式依赖：company `--dry-run` 用惰性工厂避开它（`cli/company.ts:143` 注释；`create.ts:119-122` 注释）。目标保留该行为并**在文件头声明“构造有副作用”**（现状注释只说“实例无内状态”，未说构造写目录）。
- **状态/事务/幂等/并发/恢复**：实例无内状态；同根多实例互通（`lifecycle.test.ts:240-248` 证明读互通）。无事务、无锁、无重试、无取消、无超时。**错误形态**：每个方法都是 `async`，因此下游同步抛错会变成 **Promise rejection**，调用方不可能观察到同步 throw（这是端口实际契约，测试全部走 `await`）。
- **错误与观测**：不新增 `subcause`；错误原样透传。无日志、无事件、无指标。
- **测试与证据**：被四个测试文件间接覆盖（它们都经 `createLocalPlatform`）。`lifecycle.test.ts` 的“同根多实例”是唯一直接针对本文件的断言。**不证明**：daemon 装配后的行为（`wireGatedPlatform` 的签名注入、控制 key）、构造期并发。
- **规模与迁移**：≤150 行。目标不拆分：它是“一文件一装配”的薄层，拆开会新增散件而无收益。LocalFile 档案面已定为**独立件** `src/binding.ts`（§三），**不得**塞进本文件；本文件也不得 import 它（保持“能力面 ↔ 档案面”单向：`binding.ts → contract`，`platform.ts` 不反向依赖）。`PlatformBindingPort` 的宿主在 daemon（80-§6.9），本包不实现端口。

### F-lp-issues

- **路径/处置**：`packages/localplatform/src/issues.ts`（261 行，本包最大件）；**目标-保留 + 目标-加固**（票据号 containment、损坏事件分类、ID 复用防护）。
- **归属**：80-§6.8；78-§9.4（初态解析序、状态权威在平台侧）；`docs/18-§二`（`transition` 唯一通道）；76-§7.7（`state` 是平台态，不得当 `STAT-D/E`）。
- **职责**：单据的 append-only 事件流（`issues/<id>.jsonl`）与派生读取；建单初态解析（显式 `initialState` > `typeInbox[type]` > `states[0]` > `open`）；`setField` 的字段白名单与类型校验；`list` 的四个过滤维；每次变更追加一条活动。
- **非职责**：不校验目标状态是否在 provision 声明集内（`transition` 只拒空串）；不执行 guard；不做状态映射；不写台账；不保证并发；不提供删除/归档通道（append-only 是硬约束）。
- **内部结构**：
  - 常量：`ISSUE_PREFIX='LOCAL-'`、`DEFAULT_INITIAL_STATE='open'`、`SETTABLE_STRING_FIELDS = ['title','description','type','dept','lane','assignee','parent']`（`level` 另走整数分支）。
  - 类型：`IssueEvent = {type:'created',ts,state,input} | {type:'transitioned',ts,to} | {type:'field-set',ts,field,value}`。
  - 判定：`isIssueEvent(v: unknown): v is IssueEvent`（字段级形状；`created` 只查 `typeof input === 'object'`）。
  - 派生：`deriveIssue(id, events): IssueRecord`（首事件必为 `created`；`updated`=末事件 `ts`；`field-set` 复用 `applySetField` 以保证写读同口径）。
  - 读：`getIssue`、`listIssues`、`requireIssue`、`parseIssueEvents`、`scanIssueIds`、`matchesQuery`。
  - 写：`createIssue(root, now, input)`、`transitionIssue(root, now, id, toState)`、`setIssueField(root, now, id, field, value)`。
  - 辅助：`provisionStateSet(prov)`（`states ∪ typeInbox 值 ∪ entities[].states`）、`ticketNo(id)`、`compareTicketIds`、`validateIssueCreate`、`applySetField`。
- **导出与依赖**：导出 `DEFAULT_INITIAL_STATE`、`IssueEvent`（类型）、`isIssueEvent`、`compareTicketIds`、`deriveIssue`、`getIssue`、`listIssues`、`createIssue`、`transitionIssue`、`setIssueField`。依赖：`node:fs.readdirSync`、contract 四类型、`activity.appendActivity`、`errors`、`fields.readProvision`、`fsutil`（`appendJsonl`/`fileExists`/`readJsonl`）、`layout.issuePath`/`issuesDir`。
- **IO 与注入**：`now: () => string` 逐调用传入（不是模块级单例）；其余全同步 fs。**读取路径拼接不做 containment**：`issuePath(root, id)` 直接 `join(root,'issues', id + '.jsonl')`。
- **状态/事务/幂等/并发/恢复**：
  - 无事务：一次写 = 一次 `appendFileSync`（追加一行，POSIX 下小于 PIPE_BUF 的 append 通常原子，但**未取证据**）。
  - **写序 = 先事件、后活动**。两步之间崩溃 → 单据存在但游标永不返回该变更（丢观测，不丢事实）。反向顺序（先活动）会让游标指向不存在的单据，故现状顺序是较优选择，但**没有补偿/对账代码**。
  - 幂等：**无幂等键**。重试 `create` 会产生第二张单；重试 `transition` 会产生两条同值迁移事件（派生态相同，但活动流重复）。属 77-§11.2 未满足项（§6.1-G4）。
  - ID 分配：扫描目录取有序末位 `+1`。删除最高号文件后**会复用**该号（§6.5-G6）。
  - 并发：两个写者同时 `create` 会算出同一个 `nextNo`；`appendFileSync` 会写同一文件 → 两个 `created` 事件落进一张单，`deriveIssue` 会用后者覆盖前者（静默数据损坏）。单写者假设是硬前提。
- **错误与观测**：`corrupt-issue-log`（坏行/首事件非 created/空流）、`issue-not-found`（`EXTERNAL_REJECT`）、`bad-create-input`（4 处：空标题、字段类型、`level` 非整数、`initialState` 空串或越出声明集）、`state-via-set-field`、`bad-field-value`、`unknown-field`。**已证缺陷**：`created` 事件的 `input: null` 通过 `isIssueEvent`，随后在 `validateIssueCreate` 抛原生 `TypeError: Cannot read properties of null (reading 'title')`，**不是** `LocalPlatformError`（§6.4-D3，已用只读探针复现）。
- **测试与证据**：`lifecycle.test.ts` 覆盖全链、四段初态解析、三桶并集、`setField` 负例、`list` 四维过滤、同根多实例；`activity.test.ts` 覆盖由建单/迁移触发的活动；`plat-cases.test.ts` 覆盖 `issues.get` 的 not-found 族。**不证明**：任意平台态被接受后的映射损失、并发写、崩溃窗口、NFS/大小写文件系统行为。R/E/W 映射：W6（静默恢复）——损坏即拒、不跳过；78-§9.1“平台完成≠接受”——本包 `state` 不得被读成 `STAT-E`。
- **规模与迁移**：261 → 目标 ≤300 行（加 containment 与 `input` 收窄）。**不拆分**：按“单据/事件派生/查询”切开会产生三个互引文件，收益低。加固顺序：① `input` 收窄（不改任何既有 case）；② 票据号 containment（只能拒路径分隔符，不能拒 `NOPE-999`——否则 `C-plat-007` 期望的 `EXTERNAL_REJECT` 会变成 `CONFIG_INVALID`，属败案，见 §4.6）；③ ID 复用防护（需要新机制，列入 §6.5-G6 待决，不在本轮实现）。

### F-lp-activity

- **路径/处置**：`packages/localplatform/src/activity.ts`（109 行）；**目标-保留 + 目标-加固**（kind 词表写入校验、`issue` 可选、ID 分配成本登记）。
- **归属**：80-§6.8；78-§9.1“游标不是时间”；77-§2.7 `REC-EVT-02`（`baseline_cursor` 的来源）；77-§9（观察来源游标）。
- **职责**：全局 `activity.jsonl` 的追加与增量读取；游标是**不透明字符串**（本实现内部形态 = 最后见过的活动 id 边界）；`since(cursor)` 返回 id 严格大于边界的活动（升序），`nextCursor` 翻页。
- **非职责**：不保证“平台级变更”（kb/fields/guards/links）出现在活动流（`PlatformActivity.issue` 的实现校验要求必填，见下）；不做去重（同一动作两次调用产生两条）；不存“最后游标”（调用方持有）；不解释游标语义（核心不解析）。
- **内部结构**：
  - 常量：`ID_PREFIX='a-'`、`ID_WIDTH=6`、`DEFAULT_PAGE_SIZE=100`。
  - `formatActivityId(n): string`；`parseActivityId(id): number`（前缀+纯数字+安全整数+`n>=1`，否则 `bad-cursor`）。
  - `isPlatformActivity(v)`（内部形状判定：`id/ts/issue/kind` 均 string，`actor?` string）。
  - `loadActivities(path)`、`readActivities(root)`（读取后按解析 id 升序排序）、`nextActivityId(root)`（全量读、取 `max+1`）。
  - `ActivityInput { issue: TicketId; kind: string; actor?: string }`；`appendActivity(root, now, input): PlatformActivity`。
  - `activitySince(root, cursor: string | null, pageSize: number): ActivityPage`（`fresh.length <= pageSize` → `nextCursor=null`）。
- **导出与依赖**：导出 `DEFAULT_PAGE_SIZE`、`formatActivityId`、`parseActivityId`、`readActivities`、`nextActivityId`、`ActivityInput`、`appendActivity`、`activitySince`。依赖：contract 三类型、`errors`、`fsutil`（`appendJsonl`/`isPlainObject`/`readJsonl`）、`layout.activityPath`。
- **IO 与注入**：`now` 逐调用传入；同步 fs；无缓存（每次 `since` 全量读 + 排序 + 过滤）。
- **状态/事务/幂等/并发/恢复**：
  - 单文件 append-only；**无独立计数器**（每次 `max+1`，O(n) 读取 + 解析）。
  - 单写者假设下单调递增成立；两写者同拍会算出同一 id → 两行同 id，`since` 返回重复 id（违反“不重不漏”，NA1 教训）。
  - **坏行即全局熔断**：任意一行不合法 → `loadActivities` 抛 `corrupt-activity` → `nextActivityId` 抛 → 所有写路径（`createIssue`/`transitionIssue`/`setIssueField`/`addComment`）全部失败（已用探针复现）。这是 fail-closed 的正确方向，但**没有修复工具**（§6.5-G5）。
  - 幂等/重试：无键；重试产生新 id（重复观测）。
- **错误与观测**：`bad-cursor`（无法解释/越界，**不静默当从头**）、`corrupt-activity`（坏行）、`corrupt-jsonl`（`fsutil` 层非法 JSON）。**已证漂移**：`isPlatformActivity` 要求 `issue` 为 string，而 contract 已把 `issue` 改为可选（`issue?: TicketId`，用于 kb/fields/guards 类平台级变更）；读取这类合法记录会被判 `corrupt-activity`（§6.4-D2）。`kind` 写入侧不校验冻结词表（`PLATFORM_ACTIVITY_KINDS`），越界词能落盘（§6.4-D5）。
- **测试与证据**：`activity.test.ts` 覆盖三轮游标、穿插不串单、边界精确、坏游标、`pageSize=2` 翻页、kind 词表合规、**确定性回放逐字节一致**、两根 poll 一致。**不证明**：多写者同拍、崩溃于“事件已写/活动未写”的窗口（只间接体现在回放用例的 6 条计数）、真实长跑规模（O(n²) 成本未测）。R/E/W：W10（只报有利证据）——活动流仅 4 类成功事件，**不能**用它证明“没有发生过失败”；77-§2.7 的对账入口（`baseline_cursor`）在本包无持久化，属调用方职责。
- **规模与迁移**：≤130 行。加固项：① 写入侧校验 `isPlatformActivityKind`（拒 `CONFIG_INVALID/bad-activity-kind`，新 `subcause` 属实现侧自由字符串，不改契约）；② 读侧接受 `issue` 缺失；③ 登记 ID 分配成本（不在本轮换算法，避免引入 `meta/seq` 新落盘格式）；④ 构造期校验 `pageSize` 为正整数，消灭“配置错显示成没有更多”（§4.7、§6.4-D8）。

### F-lp-comments

- **路径/处置**：`packages/localplatform/src/comments.ts`（103 行）；**目标-保留 + 目标-固化**（空 author 的处理待决）。
- **归属**：80-§6.8；78-§9.1“评论不承载结构化决定”；77-§2.3；contract `SignedBody.author` 为归因一等公民（v1.2 裁决，`docs/25-§3.2`）。
- **职责**：把带机器头/人读体/署名行的块追加到 `issues/<id>.comments.md`；解析回 `Comment[]`；拒绝会破坏块结构的注入（伪造结束标记）；每次追加产一条 `commented` 活动，`actor`=工号。
- **非职责**：不判断评论是否构成“决定/验收/回执”（77-§2.3）；不维护全局评论号（按单局部编号）；不做 @提及、不推送、不写台账；不校验工号是否存在（归公司目录）。
- **内部结构**：
  - 常量：`HEADER_PREFIX='<!-- comment '`、`FOOTER_PREFIX='<!-- /comment '`、`ID_PREFIX='c-'`、`ID_WIDTH=6`。
  - `CommentMeta { id, created, author }`。
  - `listComments(root, id): Comment[]`：行扫描状态机；头行必须 `... -->` 结尾且 JSON 形状合法；缺结束标记 → `corrupt-comments`；`inner.pop()` 剥离署名行（署名不重复进 `body`）。
  - `addComment(root, now, id, body: SignedBody): void`：先 `getIssue`（单不存在 → `EXTERNAL_REJECT/issue-not-found`）→ 三字段 string 校验 → `author`/`signature` 单行校验 → 逐行拒 `<!-- /comment` → `nextNo = listComments().length + 1` → 追加块 → 追加活动。
- **导出与依赖**：导出 `listComments`、`addComment`。依赖：contract 三类型、`activity.appendActivity`、`errors`、`fsutil`（`appendLine`/`readTextIfExists`）、`layout.commentsPath`、`issues.getIssue`。
- **IO 与注入**：`now` 注入；同步 fs；`appendLine` 会 `ensureDir(dirname)`（父目录不存在时补建）。
- **状态/事务/幂等/并发/恢复**：无事务；块追加 + 活动追加是两步，**活动失败不回滚块**（评论可见但游标不报）。评论号由长度推导：块损坏 → `listComments` 抛 → 无法追加（fail-closed）；两写者同拍 → 同号。无幂等键：重试产生重复评论。
- **错误与观测**：`bad-signed-body`（非字符串、多行 author/signature、伪造结束标记）、`corrupt-comments`（头/尾/JSON 形状）、`issue-not-found`。**口径待决**：`author` 为空白串时被静默改写为 `'unknown'`（`comments.ts:90`），这与“作者是归因一等公民”相悖；仓内无调用方传空 author（gateway/`gated-platform` 恒注入），故可改为显式拒收，但**属行为变更**，列入 §6.5-G7 待确认。
- **测试与证据**：`facets.test.ts` 覆盖多行正文逐字保留、`c-000001/2` 递增、署名行落盘、无评论返回 `[]`、不存在单拒收、多行署名与伪造结束标记拒收。`activity.test.ts` 覆盖 `commented` 活动与 `actor=工号`。**不证明**：块级并发、超长正文、CRLF 文件、工号有效性。R/E/W：R12（外部伪造来源）只覆盖到“结构串道”，未覆盖“内容伪造身份”——后者归 gateway/gated-platform。
- **规模与迁移**：≤120 行。迁移：不改文件格式（历史块必须可读）；若加强校验，只许**加**拒收条件，不许改已有块的解析结果。

### F-lp-fields

- **路径/处置**：`packages/localplatform/src/fields.ts`（101 行）；**目标-保留 + 目标-加固**（消费 contract 的 `types?`、原子写）。
- **归属**：80-§6.8；78-§9.4（provision 与初态解析）；76-§13.2（状态映射与损失声明由绑定给）；`docs/18-§2.1.1`（DEV-43 可选段）。
- **职责**：把 `FieldProvisionMap` 整体落盘到 `meta/fields.json`（供查阅/迁移/契约测试）；`schema()` 返回 8 个基础字段 + provision 声明的平台字段名；对非法结构先形状校验再写（零半写）。
- **非职责**：不在平台侧执行字段约束（真正的闸在 daemon state-diff 与平台侧 guard）；不做字段映射翻译（适配器/caller 职责）；不校验 `stateFlow` 的语义完备性（只校验 `Record<string, string[]>` 形状）；不消费 `typeFlows`（仅校验形状）。
- **内部结构**：
  - `FieldsFile { provision?: FieldProvisionMap | null }`。
  - `BASE_SCHEMA: readonly FieldSchema[]` = title(string)/description(text)/type/dept/level(int)/assignee/parent/lane。
  - 形状判定：`isStringArray`、`isStringArrayRecord`、`isTypeFlowsRecord`、`isProvisionMap`（`fields` 必须 `string→string`；`states` string[]；`stateFlow` `string→string[]`；`typeInbox` 可选 `string→string`；`typeFlows` 可选两层；`entities` 可选 `Record<string,{states:string[]}>`）。
  - `readProvision(root): FieldProvisionMap | null`（文件缺→`null`；形状不合法→`null`，**不报错**）。
  - `provisionFields(root, map): void`（形状不合法 → `bad-provision`，校验先于写盘）。
  - `fieldSchema(root): FieldSchema[]`（基础字段副本 + provision 平台名去重并入，类型一律 `'string'`）。
- **导出与依赖**：导出 `isProvisionMap`、`readProvision`、`provisionFields`、`fieldSchema`。依赖：contract 两类型、`errors`、`fsutil`（`isPlainObject`/`readJson`/`writeJson`）、`layout.fieldsPath`。
- **IO 与注入**：同步 fs；无时钟注入（provision 不带时间戳——**落盘文件无法判断“何时 provision”**，属观测缺口）。`writeJson` 是 `writeFileSync` 直写（truncate-then-write），**非原子**。
- **状态/事务/幂等/并发/恢复**：整体替换写；同 map 重跑 → 同内容（收敛，`C-plat-009` 证明）；两写者同拍 → 后者覆盖前者（`C-plat-010` 只要求“都不抛错”，**不证明**内容一致）。崩溃于写中途 → 文件可能截断 → 下次 `readProvision` 因 JSON 非法抛 `corrupt-json`（**读路径会炸**，不是回落 `null`；`readProvision` 只把“形状不合法”降级为 `null`，不吞 JSON 语法错）。
- **错误与观测**：`bad-provision`、`corrupt-json`。**已证漂移**：`FieldProvisionMap.types?` 在 contract 中存在（`string|int|enum|date|text`），本包既不校验也不消费，`schema()` 对 provision 字段一律标 `'string'`；文件头“端口不带字段类型”的注记已过期（§6.4-D1）。仓内无生产者设置 `types`（`company/src/git-import.ts:152-176` 的 `deriveFieldProvision` 只产出 `fields/states/stateFlow/typeInbox/typeFlows/entities`），故该缺口当前不可见。
- **测试与证据**：`facets.test.ts` 覆盖基础 schema、provision 后并入、平台名不重复、落盘证据、非法结构拒收；`plat-cases.test.ts` 覆盖坏 provision 的稳定键前缀与**零落盘直证**（`meta/fields.json` 不存在）；`lifecycle.test.ts` 覆盖 provision 后新建单初态与历史单不受影响。**不证明**：`types` 语义、并发内容一致性、崩溃半写。
- **规模与迁移**：≤130 行。加固顺序：① `isProvisionMap` 增校 `types` 形状（可选段，缺省不报错）；② `fieldSchema` 按 `types` 映射类型（无 `types` 时保持 `'string'`，向后兼容）；③ `provisionFields` 走临时文件 + `rename`（80-§11.3）；④ `readProvision` 区分“缺文件 / JSON 损坏 / 形状损坏”，形状损坏不再降级 `null`（§4.7、§6.4-D7）。四项都不改端口、不改既有 case。

### F-lp-guards

- **路径/处置**：`packages/localplatform/src/guards.ts`（71 行）；**目标-保留**（语义不扩：只落盘、不执行）；`read` 标 **库级未接**（生产装配丢弃）。
- **归属**：78-§9.4（“`guards` 只落盘不执行”，`packages/localplatform/src/guards.ts:4-5` 被 78 直接引用）；78-§9.1“管理页面不绕过授权”；77-§3.7；80-§6.8。
- **职责**：按公司把 `GuardRule[]` 落盘到 `meta/guards.json`（`Record<CompanySlug, GuardRule[]>`，整公司替换）；卸载幂等；`read` 把已装规则投影成 `PlatformRole[]`（无角色真源时的如实投影）。
- **非职责**：**不执行**任何 guard（`transition()` 不查表）；不校验 `from/to` 是否为真实状态；不做平台账号/角色同步；不判断“全员放行”是否等于授权（无 `allowRoles` 只表示“不产生角色条目”）。
- **内部结构**：
  - `isGuardRule(v)`（`from`/`to` 必填 string，`allowRoles?` string[]）、`requireCompanySlug(company)`（非空，否则 `bad-company-slug`）、`loadGuardFile(root)`（缺文件 → `{}`）。
  - `installGuards`（规则数组形状不合法 → `bad-guard-rules`；`all[company]=rules` 后整文件写回）、`uninstallGuards`（键不存在直接返回）、`readGuardRoles`（遍历规则，`byRole` 首见序去重，`permissions=[\`${from}→${to}\`]`，`slug=name=角色名`）。
- **导出与依赖**：导出 `installGuards`、`uninstallGuards`、`readGuardRoles`。依赖：contract 三类型、`errors`、`fsutil`（`isPlainObject`/`readJson`/`writeJson`）、`layout.guardsPath`。
- **IO 与注入**：同步 fs；无时钟（规则不带时间）；整文件 read-modify-write。
- **状态/事务/幂等/并发/恢复**：install 是**整公司替换**（不合并）；uninstall 幂等；read 是纯投影（未装/已卸载 → `[]`）。两公司并发安装 → 后写者覆盖前者（丢更新）；写中途崩溃 → 文件截断 → 下次任何 guards 操作 `corrupt-json`。
- **错误与观测**：`bad-company-slug`、`bad-guard-rules`、`corrupt-json`。**观测缺口**：文件里没有安装时间、安装者、规则来源，无法回答“谁在何时装了哪版 guard”（77-§3.7 要求权限不因管理员操作而自动成立，本包不承担记录，但**也不得被读成“已授权”**）。
- **测试与证据**：`facets.test.ts` 覆盖按公司落盘替换、幂等卸载、非法规则/空 slug 拒收、`read` 角色投影（allowRoles 去重、无 allowRoles 不产条目、未装/卸载后空清单、空 slug 拒收）。**不证明**：guard 真的拦截（本包不执行）、生产可达性（`gated-platform` 丢弃 `read`）、多进程并发。
- **规模与迁移**：≤100 行。目标**不**给 `transition()` 加执行：那会把本包从“契约靶子”变成“第二个闸”，与 78-§9.4 的损失声明（guard 不执行，已由 daemon 承接）冲突；若未来要做，属绑定语义变更，须先改 78-§9.4 与 80，不在 81 私设。

### F-lp-kb

- **路径/处置**：`packages/localplatform/src/kb.ts`（106 行）；**目标-保留 + 目标-加固**（realpath、写原子性、树上限）。
- **归属**：80-§6.8；80-§11.3（路径三段：containment / realpath / 原子写）；`docs/23-§一`（`kb/**.md` 工作知识树）。
- **职责**：`kb/**.md` 任意深度树的 upsert/get/search；search 是标题/路径/正文的**大小写不敏感子串匹配**，结果按路径排序，快照定长截断（确定性）。
- **非职责**：不做全文索引、不做相关度排序、不做权限（知识可见性归公司目录/提示词层）；不解析 Markdown 结构（只取首个一级标题）；不保证并发写；不提供删除/重命名。
- **内部结构**：
  - 常量：`SNIPPET_WIDTH=160`、`SNIPPET_CONTEXT=32`。
  - `resolveKbPath(root, path)`：空/非 `.md` → `kb-path-invalid`；`resolve(base, path)` 后必须 `startsWith(base + sep)` 且 `!== base`，否则 `kb-path-escape`。
  - `toPosix`、`collectMdFiles`（递归）、`extractTitle`（首个 `# ` 行，否则文件名去 `.md`）、`clip`、`buildSnippet`（压平空白，命中处前 32 字符起截 160，命中在标题/路径时正文从头截）。
  - `kbUpsert`（正文非 string → `bad-kb-body`；`ensureDir(dirname)` 后 `writeFileSync`）、`kbGet`（不存在或非文件 → `EXTERNAL_REJECT/kb-not-found`）、`kbSearch`（空查询 → `[]`；根不存在 → `[]`）。
- **导出与依赖**：导出 `kbUpsert`、`kbGet`、`kbSearch`。依赖：`node:fs`（`readdirSync`/`readFileSync`/`statSync`/`writeFileSync`）、`node:path`、contract `KbHit`、`errors`、`fsutil`（`ensureDir`/`fileExists`）、`layout.kbRoot`。
- **IO 与注入**：同步 fs；无时钟；每次 search 全树读取（O(文件数 × 大小)）。
- **状态/事务/幂等/并发/恢复**：upsert 是覆盖写（同内容幂等，无版本号）；**非原子**（truncate-then-write），崩溃可留半文件；无锁；搜索无缓存。
- **错误与观测**：`kb-path-invalid`、`kb-path-escape`、`bad-kb-body`、`kb-not-found`。**未证/未实现**：(a) 符号链接逃逸——`resolve` 只做字符串前缀比较，`kb/link.md → /etc/x.md` 会被跟随写入/读取（80-§11.3 第 2 段要求 realpath，**未实现**）；(b) 深度/数量/大小上限（80-§11.3 末段“归档上限”针对归档，但同一 DoS 面在 `collectMdFiles` 同样存在，**未设限**）；(c) macOS 大小写不敏感文件系统下，前缀比较可能过严（拒掉本应合法的路径）或与 realpath 结果不一致（未探）。
- **测试与证据**：`facets.test.ts` 覆盖嵌套目录往返、覆盖写、not-found、标题/正文/路径命中、大小写不敏感、排序、空查询、快照邻域、无标题回退文件名、`../` 与绝对路径拒收、非 `.md` 拒收。**不证明**：符号链接、超大树、并发、大小写文件系统。
- **规模与迁移**：≤150 行。加固顺序：① `kbUpsert` 临时文件 + `rename`；② `resolveKbPath` 增 `realpathSync`（目标不存在时对父目录求 realpath）；③ `collectMdFiles` 增深度/数量上限并明报（新 `subcause` 如 `kb-tree-too-large`，实现侧自由字符串）。三项都不改端口。

### F-lp-links

- **路径/处置**：`packages/localplatform/src/links.ts`（64 行）；**目标-保留**。
- **归属**：80-§6.8；78-§9.4；`docs/23-§一`（父子/依赖）。
- **职责**：`meta/links.jsonl` 一行一链 `{a,b,type,ts}`（append-only）；`children(id)` 取两源并集——显式 `parent-child` 链（`a` 为父）∪ 单据 `parent` 字段——去重后按单号升序。
- **非职责**：不校验环、不校验跨公司、不校验 `depends-on` 的语义方向、不写活动（`PlatformActivity.issue` 结构上可承载，但本实现不产）、不删除链。
- **内部结构**：`LinkRecord {a,b,type,ts}`；`LINK_TYPES = ['parent-child','depends-on','relates-to']`；`isLinkRecord`、`loadLinks`（坏行 → `corrupt-links`）、`addLink`（未知类型 → `bad-link-type`；自指 → `self-link`；两端必须存在，否则 `issue-not-found`）、`childTickets`（扫链 + `listIssues(root,{})`）。
- **导出与依赖**：导出 `addLink`、`childTickets`。依赖：contract 两类型、`errors`、`fsutil`（`appendJsonl`/`isPlainObject`/`readJsonl`）、`layout.linksPath`、`issues`（`compareTicketIds`/`getIssue`/`listIssues`）。
- **IO 与注入**：`now` 注入；同步 fs。`childTickets` 的代价 = O(链数) + **O(全部单据日志)**，每次调用全量解析。
- **状态/事务/幂等/并发/恢复**：无事务；重复 `link` 会追加重复行（读取侧 `Set` 去重，故语义幂等、存储不幂等）；`link` 不回写 `parent` 字段（两视图独立维护）；崩溃只影响单行追加。
- **错误与观测**：`bad-link-type`、`self-link`、`corrupt-links`、`issue-not-found`。**观测缺口**：链接变更不进活动流，故游标增量看不到“谁把 B 挂到 A 下”。
- **测试与证据**：`facets.test.ts` 覆盖显式链 ∪ parent 字段、双来源去重、`depends-on` 不算 children、自指/不存在单拒收；`activity.test.ts` 的确定性回放覆盖 `link` 落盘逐字节一致。**不证明**：环检测、跨单号排序稳定性的边界（`LOCAL-` 前缀外 id 的字典序回退）。
- **规模与迁移**：≤90 行。无拆分需求。目标不加 `link` 的活动上报：那需要 `PlatformActivity.issue` 可选（§6.4-D2）与 contract 层确认，不在本包私改。

### F-lp-layout

- **路径/处置**：`packages/localplatform/src/layout.ts`（56 行）；**目标-保留 + 目标-加固**（票据号 containment 的落点之一）。
- **归属**：78-§9.4（纯本地目录形态）；80-§11.3（路径边界）。
- **职责**：唯一物理布局事实源——`issues/<id>.jsonl`、`issues/<id>.comments.md`、`activity.jsonl`、`kb/**`、`meta/fields.json`、`meta/guards.json`、`meta/links.jsonl`；9 个纯函数返回 `join` 结果。
- **非职责**：不做校验、不建目录、不检查存在性；不决定“根在哪”（由装配层给）。
- **内部结构**：常量 `ISSUES='issues'`、`KB='kb'`、`META='meta'`；`issuesDir`、`issuePath(root,id)`、`commentsPath(root,id)`、`activityPath`、`kbRoot`、`metaDir`、`fieldsPath`、`guardsPath`、`linksPath`。
- **导出与依赖**：全部 9 个函数导出；只依赖 `node:path.join`。**禁止**依赖 `fs`（保持纯路径函数）。
- **IO 与注入**：N/A：纯函数。
- **状态/并发/恢复**：N/A。
- **错误与观测**：N/A：不抛错。**这正是漏洞所在**：`issuePath`/`commentsPath` 把调用方给的 `id` 直接拼进路径，无 containment；`../../evil` 可读出根外 `.jsonl`（已用探针复现，见 §5.2）。
- **测试与证据**：无直接测试；由 `activity.test.ts`（回放断言 `issues/LOCAL-1.jsonl` 等相对路径）与 `facets.test.ts`（`meta/fields.json`）间接固定布局。**不证明**：布局是契约（它是实现细节，任何平台可换布局）。
- **规模与迁移**：≤70 行。加固落点选择：**不**在 `layout.ts` 加校验（它应是纯函数），而在 `issues.ts`/`comments.ts` 的入口对 `id` 做 containment（`resolve` 后必须仍在 `issuesDir` 内）。理由：`layout.ts` 若抛错，会让“路径事实源”变成“校验点”，测试布局的用例也被牵连。

### F-lp-fsutil

- **路径/处置**：`packages/localplatform/src/fsutil.ts`（71 行）；**目标-保留 + 目标-加固**（原子写）。
- **归属**：80-§11.3 第 3 段（临时文件 + rename）；75-`D75-13`；80-§5.7（错误分类）。
- **职责**：`node:fs` 的薄封装，向本包提供“不存在→缺省、损坏→分类错误、追加一行、写 2 空格 JSON”的统一语义。
- **非职责**：不做 containment（不知道根）、不做锁、不做重试、不做流式大文件、不做编码探测（一律 UTF-8）。
- **内部结构**：`ensureDir`、`fileExists`、`readTextIfExists`（不存在 → `null`）、`appendLine`（`ensureDir(dirname)` + `appendFileSync(line+'\n')`）、`appendJsonl`（紧凑 JSON 单行）、`readJsonl`（空行跳过；非法 JSON → `corrupt-jsonl`）、`readJson<T>(path, fallback)`（不存在 → fallback；非法 → `corrupt-json`）、`writeJson`（2 空格缩进 + 尾换行）、`isPlainObject`。
- **导出与依赖**：全部 8 个函数导出；依赖 `node:fs`、`node:path.dirname`、`errors`。
- **IO 与注入**：全同步；无时钟/随机；`readJsonl` 每次全量读。
- **状态/事务/幂等/并发/恢复**：无事务；`writeJson` 是 **truncate-then-write**（非原子）；`appendLine` 是单次 `appendFileSync`（原子性未取证据）。同一目录的 `ensureDir` 可重入。
- **错误与观测**：`corrupt-jsonl`、`corrupt-json`；消息含绝对路径（§2.5 `detail?` 行 + 漂移 D4）。
- **测试与证据**：无直接单测；由 `fields`/`guards`/`activity`/`issues`/`links`/`comments` 的用例间接覆盖（非法 JSON 路径**未被任何测试覆盖**，见 §4.2）。**不证明**：崩溃半写、跨文件系统 rename、权限错误（EACCES 会冒泡为原生 `Error`，**未分类**）。
- **规模与迁移**：71 → 目标 ≤120 行。加固：`writeJson`（以及 `kbUpsert` 的写）改为 `写 <target>.tmp-<pid> → renameSync`；新增 `writeTextAtomic` 一个内部函数即可，不新增导出概念。权限/空间错误（`EACCES`/`ENOSPC`）当前冒泡为原生 `Error`：目标决定是**包装为 `failure:'unavailable'` + `category:'STALL'` + `subcause:'fs-io'`**（两轴见 §2.5）还是保持裸错——属错误面扩张，列入 §6.5-G8。

### F-lp-errors

- **路径/处置**：`packages/localplatform/src/errors.ts`（23 行）；**目标-保留 + 目标-加固**（构造器改两轴、签名破坏性变更；导出集不变）。
- **归属**：80-§5.7（两轴一个载体：`failure` 处置轴 / `category` 观测轴 / `subcause` 实现细目 / `detail?`）、77-§11.1（十四类原值）、17-§9（`category` 冻结枚举经 contract）、本卷 §2.5（本包唯一映射表与唯一例外）。
- **职责**：本包唯一对外错误类型；携带 `failure`/`category`/`subcause`/`detail?`，`name='LocalPlatformError'`；让包装层的 `classifiedError()` **直接读字段**构造 `Err`，不必解析 message。
- **非职责**：不实现 `Result`（本包是保留端口、走 throw，80-§6.8）；不做处置（重试/断路/对账在 `core`，只读 `failure`）；不做脱敏（但 `detail` 不得含绝对路径）；不提供错误码枚举（`subcause` 是自由字符串）；不负责把 throw 转成 `Err`（包装层的事）。
- **内部结构**（目标）：`class LocalPlatformError extends Error { readonly failure: FailureClass; readonly category: ErrorCategory; readonly subcause: string; readonly detail?: string; constructor(failure, category, subcause, detail?) }`。三条约束：
  - **不保留旧位置参数重载**：23 处构造点一次改完；若留着 `(category, subcause, message)` 兼容重载，`failure` 必填就形同虚设（两套签名并存＝两轴名存实亡）。
  - `message` 由三键拼出（`${failure}/${category}/${subcause}：${detail}`，与 01 `configInvalid` 同形），不得各处手写第二份文案。
  - 两个轴类型都从 contract **type-only import**（`FailureClass` 在 `records/scalars.ts`、`ErrorCategory` 在 `ports/kernel.ts`），**不在本包复制 14 值/11 值表**。
- **导出与依赖**：导出类。依赖：contract 两个 `import type`（无新增边）。**不加** `LocalPlatformFailure` 之类别名——那会变成第二个词表入口。
- **IO 与注入**：N/A：无 IO。
- **状态/并发/恢复**：N/A：不可变值对象（`detail` 只读）。
- **错误与观测**：自身不抛错。`instanceof` 风险同现状：跨包判类要求同一模块实例，切 dist 会双加载失效（79-§6.3/U14；本包不切 dist，切包提案里复核）。**不得**把 `failure` 只塞进 message——包装层必须能读字段（§4.6 第 5 条）。
- **测试与证据**：`testutil.expectLocalReject` 加**可选**第 4 参 `failure?`（既有调用点只断前两参，不破坏）；`plat-cases.test.ts` 一行不改；`robustness.test.ts` 增两条：同错两次 `failure×category×subcause` 全等、`detail` 不含绝对路径。**不证明**：跨进程序列化（无此需求）。
- **规模与迁移**：23 → ≤40 行。迁移是**破坏性**的：构造器签名、23 处构造点、`testutil` 一处扩展必须**同批**；前置是 contract 的 `FailureClass` 落地（§6.1-G15）。**过渡期不得先加 `failure?` 可选字段再补值**——那会制造“有时有、有时无”的两轴，比没有更坏。

### F-lp-binding（目标-新增）

- **路径/处置**：`packages/localplatform/src/binding.ts`；**目标-新增（生产，受前置阻塞）**；建议 ≤220 行；`index.ts` 同批加三条再导出。**现状无此文件**。**本件不是 `PlatformBindingPort` 的宿主**：通用端口宿主在 daemon `apps/daemon/src/assembly/platform/binding.ts`（17 `F-daemon-platform-binding`；80-§6.9 + §6.6 BIND-01 三层第 2 条），类型落点 `contract/src/ports/binding.ts`；本件只供 LocalFile 特定数据/纯函数——`bindingProfile()`、`mapState()`、`lossReport()`（三层第 3 条）。
- **归属**：80-§6.6（`Ok(unverified)` 口径、`ours` 只许 `STAT-D`、`losses` 用 `REC-LOSS-01` 引用、BIND-01 三层归属——“平台包只供纯函数/常量，不得导出 `describe`/`exportBundle`/`exitPlan`、不得写记录/读时钟”）、80-§6.9（BIND-01 落点与“包装而非新建平台”）；78-§1.2（20 字段档案：#1–#19 必填，其中 #10 `fieldMappings`/#11 `stateMappings` 标“视对象”、本绑定必填；#20 `supersedes`/`supersededBy` 可选）、78-§9.4（`BIND-PLAT-LOCAL-01`）、78-§9.5/§9.6（映射禁令与未知回执）、76-§7.7（`STAT-D` 十值）。17-§四 的 W-12（绑定面 host 未定）据此收口：**通用宿主归 daemon，本件只供 LocalFile 数据**（§6.1-G1）。
- **职责**：产出 LocalFile 绑定所需的三样东西，供 daemon 宿主组合：① `bindingProfile()`——20 字段档案骨架（不含运行期探针结果；声明期完整性校验）；② `mapState(platformState)`——只按档案 `stateMappings` 做平台态→`WorkState` 的**纯判决**；③ `lossReport()`——原样回声明里的 `losses`（`REC-LOSS-01` 引用清单，不自造 Qid、不内联）。**本件不导出 `describe`/`exportBundle`/`exitPlan`**（80-§6.6 三层第 3/5 条，导出即判双实现）：`describe`/`exportBundle` 由宿主组装，`exitPlan` 由宿主从档案的 `exportMigrationExit.exitPlan` 取。它是“档案 + 判决”，不是第二个平台实现，也不是第二份端口实现：**不读盘、不写盘、不产生记录、不读时钟**。**不持有 `FlowPlatform` 实例**——本件不调能力面；若将来某方法需要，须先改 80-§6.6 的签名，不得在本件私加参数。
- **非职责**：① 不定义 20 字段、`StateMapping`、`WorkState` 的形状（在 contract，`ports/binding.ts` / `ports/work.ts`）；② **不落 `REC-OBS-02`**（未映射观察由消费方——daemon 装配/观察投影（state-diff 或 `TS-PORT-OBS-01`）——在读到 `verification:'unverified'` 时写，同一单/同一原值/同一拍一条）、不自造 `REC-LOSS-01` Qid（由 78 档案给）；③ **不实现 `exportBundle`、不产导出内容**（台账/记录不在本包）；其范围闸（`binding-scope-outside`）与导出委托同归 daemon 宿主；④ 不执行 `ExitPlan`（执行走具体端口并落记录：状态迁移 `TS-PORT-WORK-05 WorkLifecycle`→`REC-WORK-09`、移交/档案 `TS-PORT-LIFE-02 HandoverArchivePort`→`REC-LIFE-02`、承继 `TS-PORT-LIFE-03 SuccessionPort`→`REC-LIFE-03`、权威激活 `TS-PORT-AUTH-03`、写者围栏 `TS-PORT-AUTH-04`、迟到对账 `TS-PORT-REC-06`——对应 80-§6.6 `ExitPlan` 的 ④围栏/⑤对账/⑥激活/⑧归档 四段；不得写成任何族通配）；⑤ 不做 `STAT-E` 映射、不把平台“已关闭”读成结清（78-§9.5）；⑥ 不判五门、不判验收（02 `work-readiness` / 77）。
- **内部结构**：
  - `LocalFileBindingDeclaration`（类型 + 模块内常量）：78-§1.2 的 20 字段声明——#1–#19 必填、#20 `supersedes`/`supersededBy` 可缺省；#10 `fieldMappings`/#11 `stateMappings` 不得为空。声明是**静态数据**，不含运行期探针结果（`probes[].state` 由宿主填）。
  - `bindingProfile(): BindingProfile`（纯函数）：跑 `assertProfileComplete(declaration)` 后回档案骨架；原样返回、不裁剪、不改写成“运行时视图”，也**不重算 `semanticDigest`**（JCS 在 contract 的 `canon`，本包不引；摘要由引用方核，78-§1.2 第 3 项）。
  - `mapState(platformState: string): Result<StateMapping, ClassifiedError>`：① 空串/全空白/含控制字符/超长（>256）→ `Err({failure:'rejected_precondition', category:'CONFIG_INVALID', subcause:'bad-state'})`（**复用现有 `bad-state`**，不新造）；② 取 `direction ∈ {'in','both'}` 且 `theirs === platformState` 的行，按档案序并集去重出 `workStates`；③ 命中 → `Ok({platformState, workStates, verification:'verified', unmappedBehavior:'observe-unmapped'})`；④ **未命中 → `Ok({platformState, workStates: [], verification:'unverified', unmappedBehavior:'observe-unmapped'})`**——不 `Err`、不回落 `closed`/`open`、不取“最近已知”、不把原值 trim/归一化；⑤ **未知合法态的四条边界**（80-§6.6 `StateMapping`、BIND-01 三层第 6 条与〔结论〕）：原值原样保留、`REC-OBS-02` 由**消费方**在读到 `unverified` 时落（本件不写记录）、`workStates=[]` 时**不得迁移/验收/结清**（消费方读不到合法 `STAT-D` 即停原地）、**不得**用平台的 `closed` 反推 `已结清`；⑥ 只有 `platformState` **为空/畸形**才走 ① 的 `Err`——`unknown` 不是 `closed`，也不是调用失败。
  - `lossReport(): readonly Qid[]`：原样回声明里的 `losses`（`REC-LOSS-01` 引用清单）；不自造 Qid、不内联报告、不按运行期状态增删。
  - `assertProfileComplete(decl)`（私有）：#1–#19 全部在场（#20 可缺省，与 78-§1.2 的“否”一致）、`losses` 是数组（可空但键必须在）、`stateMappings[].ours` 全部落在 `STAT_D_WORK_STATES` 内。违者抛 `ClassifiedError`（`rejected_precondition`/`CONFIG_INVALID` + `binding-profile-incomplete` 或 `binding-stat-e-mapping`；两个 `subcause` 是实现侧自由字符串，不改契约）。**抛的是 `ClassifiedError` 不是 `LocalPlatformError`**（后者是能力面的盘读写错误类型；声明不完整属 80-§5.7 的“不可继续”）。
  - **严禁导出 `describe`/`exitPlan`/`exportBundle`**（80-§6.6 三层第 3/5 条）：`describe` 由宿主执行探针并合并档案、`exportBundle` 与范围闸归宿主（`scope.company` 不在档案 `scope.companyRefs` 内 ⇒ `Err(rejected_forbidden/EXTERNAL_REJECT/'binding-scope-outside')`，78-§1.2 第 6 项；范围内原样委托，不改写 `losses`/`openObligations`/`manifest.shape`）、`exitPlan` 由宿主从 `profile.exportMigrationExit.exitPlan` 取（读幂等；不补 `completedAt`、不改 `unresolved`、不改 `archive.deleted`）。宿主侧用例归 17。
  - 私有常量 `STAT_D_WORK_STATES`（76-§7.7 十值：受理中、待开工、进行中、暂停、待验收、返工、已接受、已拒绝、已终止、已结清）——**不导出**；contract 的 `WorkState` 落地后改为从类型值域派生，避免第二份词表。
- **导出与依赖**：导出 `bindingProfile`/`mapState`/`lossReport`（值）与 `LocalFileBindingDeclaration`（类型）；`index.ts` 同批加三条再导出（`bindingProfile`/`mapState`/`lossReport`，§2.4）。依赖**只有** `@studio-next/contract` 的类型（`BindingProfile`/`StateMapping`/`ClassifiedError`/`WorkState`）；**不** import 本包任何面文件、**不** import `node:fs`、**不**新增跨包边（`["localplatform","contract"]` 已存在）。
- **IO 与注入**：**零 IO**——无 `fs`、无时钟、无网络、无子进程，也**没有**任何外部效果：本件不读台账（80-§8.2 的 `openLedgerReadonly` 在 store/daemon 侧），导出内容由 daemon 宿主的注入实现提供。不提供“缺省档案”，也不提供“内部导出器”。
- **状态/并发/恢复**：无实例状态（模块常量 + 纯函数）；`bindingProfile`/`mapState`/`lossReport` 均无副作用、可重复调用；声明期一次性校验，运行期不读盘，故**没有**“半写/损坏”面——这是它与本卷其余文件最大的结构差别。
- **错误与观测**：本件**只有 `mapState` 有拒绝通道**，走 `Result`（80-§5.7 第 1 条：预期拒绝经 `Err`）；`bindingProfile()`/`lossReport()` 无拒绝通道（声明不完整在 `bindingProfile()` 抛 `ClassifiedError`，属构造期 fail-fast；`lossReport` 只读声明）。`describe`/`exportBundle` 的拒绝通道与 `exitPlan` 的纯声明均在 daemon 宿主（`exportBundle` 的范围闸见上）。`Err` 的 `failure` 只取 `rejected_precondition`，`category` 只取 `CONFIG_INVALID`（`exportBundle` 的 `rejected_forbidden`/`EXTERNAL_REJECT` 属宿主面）——均落在 `Err` 可达的 6 个 `category` 之内。不产事件：`REC-OBS-02` 由消费方（daemon 装配/观察投影）在读到 `verification:'unverified'` 时落（§6.1-G14）。无日志。
- **测试与证据**：`src/binding.test.ts`（`F-lp-test-binding`）。R/E/W/V：78-§9.6（未知保原值 + `unverified`，不映射近邻）、76-§7.7（禁 `STAT-E`）、77-§9.2（未知不得显示成 0/空/正常）；V2。**不证明**：导出内容完整性与范围闸（daemon 宿主责任）、真实平台的未知态分布、消费方是否真落了 `REC-OBS-02`。
- **规模与迁移**：≤220 行；`src` 直下 17 → 20（≤25）。**迁移受前置约束**：必须等 01 的 `Result`/`FailureClass`（`ports/kernel.ts`、`records/scalars.ts`）与 `PlatformBindingPort`/`BindingProfile`/`StateMapping`/`WorkState`（`ports/binding.ts`、`ports/work.ts`；01 v0.9 已登记 `ports/binding.ts` 为目标件、代码未落地，见 G15）在代码里落地后再写；否则 `bun run typecheck` 必红（import 不存在的类型），属“先写后修”倒序，判废件（§6.1-G15）。**不得**为本件私造影子类型，也不得因前置未落而在本包补一份端口实现。

---

（下接 `F-lp-testutil` 与四个既有测试、两个新增测试、两个配置文件；随后 §四 跨文件不变量、§五 证据与未证、§六 缺口回写、§七 迁移顺序、§八 跨卷目标件登记。）

### F-lp-testutil

- **路径/处置**：`packages/localplatform/src/testutil.ts`（48 行）；**仅测试 / 目标-保留**（其中一个导出未被使用）。
- **归属**：82 的 V2 行为层证据基建；80-§8.6（确定性时钟）。不是公共规范，不属生产装配。
- **职责**：提供临时根目录、确定性步进时钟、同步/异步错误断言三件，保证测试不碰生产路径、时间可比。
- **非职责**：不提供 fake 平台（本包测试直用真实实现）、不 mock `fs`、不覆盖时间之外的注入（无 ID/随机注入）。
- **内部结构**：
  - `tmpRoot(label): string` → `mkdtempSync(join(tmpdir(), \`localplatform-${label}-\`))`。
  - `fixedClock(): () => string` → 从 `2026-01-01T00:00:00.000Z` 起每次 `+1s`。
  - `expectLocalError(fn, category, subcause)`（同步版，**全仓无调用者**）。
  - `expectLocalReject(fn, category, subcause)`（异步版，四个测试文件均用）。
- **导出与依赖**：导出四个函数；依赖 `node:fs.mkdtempSync`、`node:os.tmpdir`、`node:path.join`、`vitest.expect`、contract `ErrorCategory`、`errors.LocalPlatformError`。
- **IO 与注入**：`tmpdir` + `mkdtemp` 真实落盘；**清理责任在调用方**（四个测试都在 `afterEach`/`finally` 里 `rmSync`）。若测试崩溃于清理前，会留临时目录（无自动回收）。
- **状态/并发/恢复**：`fixedClock` 的闭包状态是测试级（每测试新建，不复用）；`tmpRoot` 每测试唯一。
- **错误与观测**：断言失败时给出中文提示（`'应当抛出 LocalPlatformError'`）；不吞非预期错误（`throw err` 语义由 `toBeInstanceOf` 断言表达）。
- **测试与证据**：它**本身不被测试**；被 `activity.test.ts`、`facets.test.ts`、`lifecycle.test.ts`、`plat-cases.test.ts` 使用。**不证明**：真实时钟行为、并发。
- **规模与迁移**：≤60 行。目标处置：保留 `tmpRoot`/`fixedClock`/`expectLocalReject`；`expectLocalError` 若在新增回归测试中仍无用，可随任意提交退役（它没有消费者，退役不需兼容期）；退役时同步删 `ErrorCategory` 的 import，避免 `noUnusedLocals` 红。

### F-lp-test-activity

- **路径/处置**：`packages/localplatform/src/activity.test.ts`（207 行）；**仅测试 / 目标-保留**。
- **归属**：V2 行为契约（游标语义）；`docs/25-§3.2`（NA1 教训）；`CASES.md` plat 域之外的实现内证据。
- **职责**：固定“游标不重不漏”的实现口径，并用逐字节回放锁住确定性。
- **覆盖（逐组）**：
  1. 连续三轮 `since()`：首轮全量 → 次轮仅增量 → 无新增空且游标不动。
  2. 穿插其他单的活动不串单：边界是活动 id，不是单据；逐条断言 `issue`/`kind`/`actor`。
  3. 边界精确：`since('a-000003')` 含 4、5 不含 3。
  4. 坏游标（`garbage`、`a-0000xx`、`a-0`）→ `CONFIG_INVALID/bad-cursor`。
  5. 分页（`pageSize=2`）：`nextCursor` 翻页拼起来不重不漏，首页边界正确。
  6. kind 词表：四个产出 kind 全在 `PLATFORM_ACTIVITY_KINDS` 内。
  7. 确定性回放：同一操作序列 + 同一注入时钟，两个根目录下 `activity.jsonl`、两张单的 jsonl、两个 comments.md、`meta/links.jsonl` **逐字节一致**，并断言活动正好 6 条（证明 link/kb/guards 不进活动流）。
  8. 两根 poll 视角一致（`since(null)` 的 id 序列与 JSON 全等）。
- **fake 边界**：**无 fake**——用真实实现 + `tmpRoot` + `fixedClock`；无网络、无子进程、无 LLM。测试的“确定性”只证明**同一实现同一注入**下的可重复性，不证明跨实现一致。
- **不证明**：多写者同拍、崩溃窗口、`pageSize<=0` 或非整数（未测）、超长活动流性能。
- **R/E/W/V**：W10（只报有利证据）——用例断言“活动正好 6 条”，本身就是在记录“什么没有进活动流”；V2 层。V3（跨实现）/V4（故障）/V5（真机）未执行。
- **规模与迁移**：≤250 行。新增负例（issue 可选、kind 越界）进 `robustness.test.ts`，不塞进本文件，避免把“游标语义”与“写入校验”混成一个主题。

### F-lp-test-facets

- **路径/处置**：`packages/localplatform/src/facets.test.ts`（231 行）；**仅测试 / 目标-保留**。
- **归属**：V2；覆盖 `comments`/`links`/`kb`/`fields`/`guards` 五个面。
- **职责**：把“面件”的读写往返、落盘形态、拒收条件固定下来。
- **覆盖（逐组）**：
  1. comments：多行正文逐字保留、`c-000001/2` 递增、`author` 取自 `SignedBody.author`、署名行进块、无评论返回空、不存在单拒收、多行署名拒收、伪造结束标记拒收。
  2. links：显式链 ∪ `parent` 字段、双来源去重、`depends-on` 不算 children、自指拒收、不存在单拒收。
  3. kb：嵌套目录往返、覆盖写、not-found、标题/正文/路径三路命中、大小写不敏感、排序、空查询、快照邻域、无标题回退文件名、`../`/绝对路径/非 `.md`/空白路径拒收。
  4. fields：基础 schema（含 `level=int`）、provision 后并入、平台名不重复、落盘证据、非法结构拒收。
  5. guards：按公司落盘、整公司替换、幂等卸载、非法规则/空 slug 拒收、`read` 角色投影三态（已装/未装/卸载后）与空 slug 拒收。
- **fake 边界**：无 fake；真实 fs + `tmpRoot`。`guards.read` 用例显式 `if (read === undefined) throw`——因为端口把 `read` 定为可选，测试必须证明“本实现不缺席”。
- **不证明**：符号链接、超大树、并发、大小写文件系统、`guard` 真拦截（本包不执行）。
- **R/E/W/V**：W6（损坏不静默）、77-§3.7（角色不因 install 自动成为授权——本文件只证明“投影”，不证明“权限”）；V2。
- **规模与迁移**：≤300 行。加固后新增的 kb realpath/上限用例进 `robustness.test.ts`，不改本文件既有断言。

### F-lp-test-lifecycle

- **路径/处置**：`packages/localplatform/src/lifecycle.test.ts`（248 行）；**仅测试 / 目标-保留**。
- **归属**：V2；`docs/25-§3.2`（端口语义）、`docs/18-§二`（状态权威）、`docs/18-§2.1.1`（DEV-43 初态解析）。
- **职责**：固定建单→迁移→写字段→读/列的全链，以及初态解析的**四段优先级**与三桶合法性。
- **覆盖（逐组）**：
  1. create：`LOCAL-1/2` 单调、默认 `open`、字段落记录、`updated` 是合法 ISO、落盘首行是 `created`。
  2. transition：状态推进、`updated` 前进、事件流两条 `transitioned`。
  3. setField：七个可写维可见；`description` 只留痕不进记录。
  4. 负例：`setField('state')`、未知字段、`level='三'`、空 `title`、空目标态。
  5. `get` 不存在 → `EXTERNAL_REJECT/issue-not-found`。
  6. create 校验：空 `title`、`level=1.5`、脏 `dept`（运行时口径）。
  7. provision 后新建单取 `states[0]`，且不动历史单。
  8. DEV-40：显式 `initialState` 优先、越界拒收且**零落盘**、空白串拒收、未 provision 时可用。
  9. DEV-43：四段解析（显式 > `typeInbox[type]` > `states[0]` > `open`）、三桶并集、无 `type` 不命中 `typeInbox`。
  10. `list` 四维过滤（`stateIn` 含空数组、`assignee`、`lane`、`updatedSince` 严格大于、组合维）。
  11. 同根多实例互通。
- **fake 边界**：无 fake；`fixedClock` 只用于 `updatedSince` 用例，避免真实时钟毫秒抖动。
- **不证明**：`transition` 对**未声明状态**的接受（用例只测空串与已声明态）；并发；崩溃；历史日志在新校验规则下仍可读（见 §6.3）。
- **R/E/W/V**：78-§9.1“平台完成≠接受”——本文件只证明平台态字符串流转，不证明映射；V2。
- **规模与迁移**：≤300 行。**不得**在加固中改这些断言（它们锁的是端口语义）；新增“任意状态被接受”的**现状记录**用例应放 `robustness.test.ts` 并标 `it.fails`/显式 `expect` 现状，避免把缺陷写成契约。

### F-lp-test-plat-cases

- **路径/处置**：`packages/localplatform/src/plat-cases.test.ts`（171 行）；**仅测试 / 目标-保留**（冻结验收口径，不得改断言方向）。
- **归属**：`packages/contract/CASES.md` plat 域 v1（8 条）+ 第二批（2 条，studio-dev-126）；`docs/23-§三.2`；80-§12.3（81 只消费端口清单，不改契约）。
- **职责**：把 `cases.json` 的 10 条 plat case 接到本实现上；并证明 runner 不是恒真（反证面）、同错同键、稳定键前缀表、坏输入零落盘。
- **覆盖**：
  - subject 路由 7 个 op（含 `fields.provision.rerun`/`.concurrent` 的 `converged` 诚实计算）。
  - 10 条 case 全绿；**谎报 subject（category 取反 + `converged` 取反）→ 10 条全红**。
  - 同一坏输入两次同 `category×subcause`（8 组输入）。
  - 公共面子表：`bad-cursor`/`bad-signed-body`/`bad-provision`/`issue-not-found`/`kb-not-found` 五族稳定键前缀。
  - 坏 provision 零落盘直证（`meta/fields.json` 不存在）且重复打同键。
- **fake 边界**：**不是 fake**——真实实现 + `tmpRoot` + `fixedClock`；`BASE` 哨兵在 `beforeEach` 预建一张基准单。JSON manifest 用 `import ... with { type: 'json' }`（79-§4.2 的唯一合法形态）。
- **不证明**：跨实现**语义**等价（只断言 `category` 全等，`subcause` 差异如实放行，`CASES.md` 明文）；taiga 侧接线；端口正例冒烟（P1 批次未兑现）。
- **R/E/W/V**：V2（行为契约）+ V3 的**局部**（两实现只对 category）；V3 全量未执行。
- **规模与迁移**：≤200 行。**加固不得破坏 C-plat-007**：该 case 传入 `id:'NOPE-999'` 期望 `EXTERNAL_REJECT`；因此票据号加固只能做 containment（拒路径分隔/越界），**不能**做“必须匹配 `^LOCAL-\d+$`”的形状闸——那会把 category 改成 `CONFIG_INVALID`，直接判负（见 §4.6 的约束链）。

### F-lp-test-robustness（目标-新增）

- **路径/处置**：`packages/localplatform/src/robustness.test.ts`；**目标-新增（仅测试）**；建议 ≤300 行。
- **归属**：80-§11.3（路径）、80-§8.7/§8.8（恢复不变量）、77-§11.2（幂等与部分成功）、77-§9（未知不显示成 0/空/绿）、78-§9.6（未知回执不由本包承担但需负向证据）。**不新增任何公共语义**——只是为已登记的缺口取证。
- **职责**：把“损坏数据、路径越界、写入校验、部分写”四类边界钉成回归；其中若干条在当前代码下**必红**（红先于修），用于证明缺陷真实存在而非文档臆测。
- **分组与首跑预期**（“红”= 当前实现不满足目标，测试建成后必须先红后绿）：

| 组 | 用例 | 当前预期 | 依据 |
|---|---|---|---|
| A 损坏单据日志 | 坏行 / 首事件非 `created` / 空文件 | 绿（已抛 `corrupt-issue-log`） | 现有行为固化 |
| A | `created` 事件的 `input: null` | **红**（抛原生 `TypeError`，非 `LocalPlatformError`） | §6.4-D3，已探针复现 |
| B 活动流 | 坏行 → 读与写都 `corrupt-activity`（fail-closed） | 绿（固化“熔断而非跳过”） | W6 |
| B | 无 `issue` 的活动记录可被 `since` 读出 | **红**（当前判 `corrupt-activity`） | §6.4-D2 |
| B | 越界 `kind` 写入被拒 | **红**（当前照写） | §6.4-D5 |
| B | `pageSize=0` 构造期拒收 | **红**（当前静默空页） | §6.4-D8，探针 4.4 |
| C 票据号 containment | `get('../../evil')` / `comments.add('../../evil')` 拒收且不读出根外文件 | **红**（当前可读出并返回 `id:'../../evil'`） | 探针复现，§5.2 |
| C | `get('NOPE-999')` 仍为 `EXTERNAL_REJECT/issue-not-found` | 绿（**回归护栏**，防加固误伤 C-plat-007） | `CASES.md` |
| D 其它损坏面 | `corrupt-links` / `corrupt-comments`（缺尾、坏头） | 绿（固化） | 现有行为 |
| D | `meta/fields.json` 的 `provision` 形状坏 → `bad-provision`/`corrupt-json`（不回落 `open`） | **红**（当前回落 `open`） | §6.4-D7，探针 4.5 |
| E 字段 | `types` 参与 `schema()`；坏 `types` 形状拒收 | **红**（当前忽略） | §6.4-D1 |
| F 半写与幂等 | 两次 `create` 同标题 → 两张单（记录现实，不做“收敛”断言） | 绿（记录现状，**不**声称幂等） | 77-§11.2 缺口 |
| G 符号链接 | `kb/` 内符号链接指向根外 → upsert/get 拒收 | **红**（未实现 realpath） | 80-§11.3 |
| H 树上限 | 超深/超多 `.md` → 明报上限 | **红**（未实现上限） | 80-§11.3 末段 |
- **fake 边界**：真实 fs + `tmpRoot`；**崩溃注入**用“直接构造半状态文件”而非杀进程（本包无注入点，杀进程属 V4 的 daemon 层）。因此本文件**不能**证明“崩溃恢复”，只能证明“半状态被如何解释”。
- **不证明**：多进程并发、真实时钟、NFS/大小写文件系统、daemon 装配。
- **R/E/W/V**：W6（不静默恢复）、W10（只报有利证据）、77-§11.2（部分成功不得汇总成成功）；V2 + V4 的**局部**。V4 全量（崩溃/并发/安全）仍未执行。
- **规模与迁移**：新增文件使 `src` 直下从 17 → 20 件（含 `binding.ts`/`binding.test.ts`，≤25），无 `lineBaseline` 影响。迁移顺序：先落本文件（红），再按 §7.2 修实现（转绿）；不得先修后补测（否则无法证明缺陷存在）。

### F-lp-test-binding（目标-新增）

- **路径/处置**：`packages/localplatform/src/binding.test.ts`；**目标-新增（仅测试）**；建议 ≤200 行。与 `F-lp-binding` 同批落地（没有实现就没有可测对象）。
- **归属**：80-§6.6（`Ok(unverified)` 与 `observe-unmapped` 的唯一合法分支）、80-§6.9（本件只测 LocalFile 面，端口装配测试归 17）、78-§1.2/§9.5/§9.6、76-§7.7（`STAT-D` 十值、禁 `STAT-E`）、77-§11.1（`Err` 的两轴形状）。**不新增公共语义**，只固定已定口径。
- **职责**：把 LocalFile 档案面钉成回归：档案完整性校验、未映射不 `Err`、`workStates=[]` 不回落默认态、`STAT-E` 判缺陷、`losses` 不自造、退出声明原样。`describe`/`exportBundle` 的端口壳与范围闸**不在本件**（daemon 宿主，用例归 17）。
- **分组**（每组首跑预期：本件与实现同批，除标注外应**绿**；共**八组**）：
  1. `bindingProfile()` 的档案校验：19 必填齐 + `losses: []` 显式 → 返回的骨架逐字段原样（不是深相等即过）；缺一必填 → 抛 `ClassifiedError`（`binding-profile-incomplete`）；`ours` 里出现 `STAT-E` 值（如“验收通过”）→ 抛 `binding-stat-e-mapping`。
  2. `mapState` 命中：`theirs` 与档案一致 → `verification:'verified'`，`workStates` 按档案序、去重、多对一列全。
  3. `mapState` **未命中**：`platformState:'In Review'` 不在表内 → `Ok({workStates: [], verification:'unverified', unmappedBehavior:'observe-unmapped'})`；**断言不是 `Err`**（这是本件最重要的负向），且 `platformState` 原样回传（不 trim、不归一化）。
  4. `mapState` 空/畸形：`''`、`'   '`、含 U+0000 的串、257 字符 → `Err(rejected_precondition / CONFIG_INVALID / bad-state)`；四次同形（同错同键）。
  5. `mapState` 不回落：档案里若有 `closed → 已结清`，未映射值仍不得产出 `已结清`；档案**没有** `closed` 时也不得输出 `closed`/`open`。
  6. 档案里的退出声明：`bindingProfile().exportMigrationExit.exitPlan` 的 `archive` 恒 `{mode:'read-only', deleted:false}`；`exit.completedAt` 缺省时不被补；`lossReport()` 与声明 `losses` 逐引用相等（不新增、不删除、不造 Qid）。
  7. 零 IO：测试用 `tmpRoot` 建一个空根，断言 `bindingProfile`/`mapState`/`lossReport` 调用前后目录内容不变（`readdirSync` 前后全等）——证明“本件不写盘”。
  8. 两轴：所有 `Err` 断言 `failure`/`category`/`subcause` **三键**（直接读返回对象，不解析 message；`expectLocalReject` 的 `failure?` 扩展参数只服务 throw 面，不用于 `Err`）。
- **fake 边界**：**无 fake**——真实 `bindingProfile`/`mapState`/`lossReport` + 手写声明字面量。不拉 daemon、不连台账、不造导出器（导出器与范围闸属 17）。**不证明**：宿主是否把骨架正确包成 `describe`/`exitPlan`、导出器是否真从只读台账取数、真实平台的未知态分布。
- **R/E/W/V**：77-§9.2（未知不得显示为 0/空/正常）、78-§9.6（未知保原值 + `unverified`）、76-§7.7（禁 `STAT-E`）；V2。V3（跨实现）/V4（故障）/V5（真机）均未执行。
- **规模与迁移**：≤200 行；与 `binding.ts` 同批提交。前置：`F-lp-binding` 与 contract 类型（§6.1-G15）。**不得**先写测试再写实现导致首跑全红——本件测的是“实现是否守住口径”，不是缺陷取证（缺陷取证在 `robustness.test.ts`）。

### F-lp-pkg-manifest

- **路径/处置**：`packages/localplatform/package.json`；**目标-保留**（不改字段）。
- **归属**：79-§6.5（本包 `exports` 维持 `./src/index.ts`，不发布）；79-§10.1 第 10 条（`company` 的 devDep 引用正确）。
- **职责**：声明包名 `@studio-next/localplatform`、`private: true`、`type: module`、`main`/`exports["."] = ./src/index.ts`、`dependencies: { "@studio-next/contract": "workspace:*" }`、两个脚本（`typecheck`、`test`）。
- **非职责**：不声明 `files`/`build`/`bin`/`license`（未发布，79-§6.5 已登记 17 包均无 `license`）。
- **内部结构**：无非代码结构；`description` 自称“零依赖 demo / 契约靶子 / 端口有效性证明”，与 §2.1 三层身份一致。
- **导出与依赖**：`dependencies` 只有 contract —— 与 `allowedPackageEdges` 的 `["localplatform","contract"]` 完全一致（无休眠边、无死依赖）。**不得**新增 `zod`/`yaml`/`execa` 等：本包零外部依赖是 P8 demo 的硬前提（`docs/23-§一`）。
- **IO 与注入**：N/A：manifest 无运行时行为。
- **状态/并发/恢复**：N/A。
- **错误与观测**：N/A。
- **测试与证据**：`bun run typecheck` 的根 program 覆盖本包 `src`；`bun run guard:boundaries` 校验边与尺寸；包级 `tsc --noEmit -p tsconfig.json` 也覆盖 `src/*.test.ts`。**不证明**：Node 直接执行 `src/index.ts`（需真实 smoke，本卷未执行）。
- **规模与迁移**：不变。若未来切 dist，须同单改五处（`exports`、`files`、`tsconfig.build.json`、根 program 退出、根 typecheck 串接），并按 79-§6.1 的 `build→typecheck→测试` 顺序验证；本卷**不**预置。

### F-lp-tsconfig

- **路径/处置**：`packages/localplatform/tsconfig.json`；**目标-保留**。
- **归属**：79-§4.4（包级 typecheck 与根 program 的分工）；根 `tsconfig.base.json`（严格开关、`erasableSyntaxOnly`、`allowImportingTsExtensions`、`noEmit`）。
- **职责**：`extends "../../tsconfig.base.json"` + `include: ["src/**/*.ts"]`；实现“包级类型门禁含测试”的最小配置。
- **非职责**：不设 `paths`（79-§4.1 第 3 条：包内不得用别名）、不设 `references`（79 不默认引入 project references）、不设 `outDir`/`declaration`（不发射）。
- **内部结构**：无 `compilerOptions` 覆盖——**这是有意的**：任何逐包放松（如关 `noUncheckedIndexedAccess`）都属违规。
- **导出与依赖**：N/A。
- **IO 与注入**：N/A。
- **状态/并发/恢复**：N/A。
- **错误与观测**：类型错误在 `bun run typecheck` 与包级 `tsc --noEmit` 两处都会红（两道门禁，非冗余：根 program 保证跨包一致，包级保证切包后仍被覆盖）。
- **测试与证据**：`bun run typecheck` 通过只证明类型自洽；**不证明**运行时可加载、不证明行为。
- **规模与迁移**：不变。若新增子目录（本卷不新增），`include` 已用 `src/**/*.ts` 通配，无需改。

---

## 四、跨文件不变量（目标固化）

### 4.1 写入序列与“部分写”窗口

〔事实〕每条写路径都由两步组成，顺序固定：

| 操作 | 第 1 步（事实） | 第 2 步（观测） | 崩溃于两步之间 |
|---|---|---|---|
| `issues.create` | `appendJsonl(created)` | `appendActivity(created)` | 单据存在、游标不报 |
| `issues.transition` | `appendJsonl(transitioned)` | `appendActivity(transitioned)` | 同上 |
| `issues.setField` | `appendJsonl(field-set)` | `appendActivity(field-set)` | 同上 |
| `comments.add` | `appendLine(块)` | `appendActivity(commented)` | 评论可见、游标不报 |
| `fields.provision` / `guards.*` / `kb.upsert` / `links.link` | 写各自文件 | **无活动** | 无观测缺口（本就不产活动） |

〔结论〕目标**不改变**该顺序。理由：反向（先活动）会让游标指向尚未存在的单据/评论，把“丢观测”换成“报幻觉”，后者更坏。代价必须显式登记：**活动流不是完整事实日志**；要判定“是否有未观测变更”，只能做全量对账（`since(null)` + 逐单比对），而该对账在当前仓内**没有实现**（§6.1-G9）。

### 4.2 损坏数据的处理层级

| 层 | 行为 | 后果 |
|---|---|---|
| JSON 语法错 | `fsutil.readJsonl/readJson` → `corrupt-jsonl`/`corrupt-json` | 该文件所属面全拒 |
| 结构错（未知事件型/非对象/字段类型错） | 面文件自己抛 `corrupt-*` | 同上 |
| `readProvision` 的形状不合法 | **降级为 `null`**（不抛） | 看似“未 provision”，初态回落 `open`（§4.7 行 3、§6.4-D7） |
| `comments.add` 的 `author` 空白 | **改写为 `'unknown'`**（不抛） | 归因静默降级（§4.7 行 6、§6.5-G7） |
| `issues` 的 `created.input=null` | **原生 `TypeError`** | 未分类错误，调用方拿不到两轴（`failure`/`category`），无法按 `failure` 处置（§6.4-D3） |

〔结论〕表列五种处理**不一致**：两处 fail-closed（JSON 语法错、结构错）、两处静默降级（provision、author）、一处未分类（`TypeError`）。目标：把“静默降级”与“未分类”收敛为显式分类，且**不得**把 fail-closed 改成跳过（W6）；静默降级的修法见 §4.7 与 D7。

### 4.3 历史可读性（最容易被忽略的兼容约束）

〔事实〕`deriveIssue` **每次读取都重新跑 `validateIssueCreate(ev.input)`**（`issues.ts:164`）。因此：

- 今天合法落盘的 `created` 事件，如果未来校验收紧（例如要求 `type` 必须在某枚举内、或禁止某字段），**历史单会变成不可读**（`bad-create-input`），而不是“按当时规则解释”。
- 这违反 75-`D75-14`“历史出工段只能按当时版本解释”的同类要求（至少与本包目标冲突）。

〔结论〕目标约束：**`validateIssueCreate` 只允许对“新写入”收紧，读路径必须使用冻结的宽松判定**。实现方式（不新增公共概念）：读路径只验 `isIssueEvent` 的结构，`deriveIssue` 不再调 `validateIssueCreate`；或把校验拆成 `validateIssueCreateForWrite` 与 `isReadableIssueCreate` 两个内部函数。二者都不改端口、不改事件格式。**注意**：这会改变“损坏日志”的判定面，必须先补 `robustness.test.ts` 组 A 的现状断言，再改。

### 4.4 游标与分页

〔事实〕`since(null)` = 从**最旧**开始（升序），`nextCursor` = 本页最后一条 id；`fresh.length <= pageSize` 时 `nextCursor=null`。因此：

- “没有更多”与“恰好一页”不可区分（都返回 `nextCursor=null`）——调用方靠“本页 `< pageSize`”判结束，或再问一次拿空页。
- 游标是**实现私有**格式（`a-` + 6 位补零）；核心不得解析（78-§9.1）。跨实现迁移时，本地游标不能喂给 yt/taiga（反之亦然）。
- `pageSize<=0` 会让 `items=[]` 且 `nextCursor` 指向……实际上 `fresh.length > pageSize` 成立时会 `slice(0,0)` → `items=[]` → `last=undefined` → `nextCursor=null`，**静默返回空**。目标：构造期校验 `pageSize` 为正整数（`CONFIG_INVALID/bad-page-size`），或在 `activitySince` 入口校验。当前无测试（§5.3）。

### 4.5 幂等矩阵（现状 vs 77-§11.2）

| 操作 | 同内容重跑 | 同键不同内容 | 结论 |
|---|---|---|---|
| `fields.provision` | 收敛（整文件替换为同内容） | N/A（无键） | 满足 `C-plat-009/010` 的收敛口径 |
| `guards.uninstall` | 幂等（键不存在即返回） | N/A | 幂等 |
| `guards.install` | 整公司替换（同规则 → 同文件） | 后者覆盖 | 收敛但**无版本/审计** |
| `kb.upsert` | 覆盖为同内容 | 覆盖 | 无版本；崩溃可半写 |
| `links.link` | **追加重复行**（读取侧去重） | N/A | 存储不幂等、语义幂等 |
| `issues.create` | **新建第二张单** | N/A | **不幂等**（77-§11.2 未满足） |
| `issues.transition` | 追加第二条同值事件 | N/A | 派生态相同、观测重复 |
| `issues.setField` | 追加第二条同值事件 | N/A | 同上 |
| `comments.add` | 追加第二条评论（新 `c-` 号） | N/A | **不幂等** |

〔结论〕本包不提供幂等键，`FlowPlatform` 也没有键位。目标**不在本包私加键**（那会改端口）；幂等必须在包装层（`EffectGateway` 的 `idempotencyKey`）实现，或走 contract 端口修订批示。登记为 §6.1-G4。

### 4.6 错误分类的一致性约束（plat 域）

〔结论〕任何加固都受五条冻结约束：

1. 既有 10 条 case 的 `category` 不得变（`CASES.md` 只断 category）。
2. 同一坏输入的 `category×subcause` 两次必须相同（本包自测 `plat-cases.test.ts:124-141`）；加 `failure` 后扩为三键同错同键。
3. 新增拒收条件必须**先于**落盘（零半写），否则破坏 `plat-cases.test.ts:162-170` 的零落盘直证精神。
4. **加 `failure` 不得改 `category`**：两轴是“新增一列”，不是“换一张表”。`failure` 的缺省映射只在**新构造点**生效；既有 23 个 `subcause` 的 `category` 一个都不动（例外的处理见 §2.5 第 2 条，且必须回写 80，不在本包私定）。
5. **`failure` 不得被塞进成功返回值**：`mapState` 的“未映射”是 `Ok` 里的 `verification:'unverified'`，既不是 `Err`，也不是 `{status:'rejected'}`（80-§5.7 第 3 条的同一禁令）；`failure` 只出现在 `Err`/`throw` 的载体上，且必须是**字段**而非 message 里的字符串。

因此“票据号必须匹配 `^LOCAL-\d+$`”这种看似自然的加固**不可采纳**：它会把 `NOPE-999` 从 `EXTERNAL_REJECT` 改成 `CONFIG_INVALID`，直接判负第 1 条。可采纳的只有 containment（拒越界路径）与“不存在即 not-found”的现状组合。

### 4.7 「未知」不得被映射成值（77-§9.2 / 78-§9.6 的落点审计）

〔事实〕77-§9.2 规定“未知”必须显式显示为未知/未采集/未核验，**禁止显示为 0、空、正常**；78-§9.6 对平台侧更严：未知状态值**保留原值 + `unverified`**，禁止映射到最近已知。按此逐调用点核对（`kb.search`/`activity.since`/`guards.read`/`readProvision`/`fields.schema`/`pageSize` 六处由探针 4 实测，其余为代码核对；锚点见各行 `path:line`）：

| 调用点 | 未知/损坏来源 | 现状 | 判定 | 目标 |
|---|---|---|---|---|
| `kb.search`（`kb.ts:85-91`） | kb 根不存在 → `[]` | 空数组 | **半违规**：空树 = 真的无文档（合法）；但“根被删/未采集”同样返回 `[]`，与“无命中”不可区分 | 端口无完整性位 → 不造新字段；登记**读侧纪律**：`[]` 只证“扫描成功且无匹配”，不证“无知识” |
| `activity.since`（`activity.ts:99-109`） | `activity.jsonl` 不存在 → 空页 | `{items:[],nextCursor:null}` | **违规**：“事件未写”（含两步写窗口崩溃）与“无变更”同形 | 不能在本包修（端口无缺口位）；登记 78 损失行（G10④），对账入口归 daemon（G9） |
| `readProvision`（`fields.ts:78-81`） | `meta/fields.json` 的 `provision` 形状坏 → `null` | 建单初态回落 `open`（探针 4.5） | **违规**：损坏被读成“未 provision”，未知被映射成具体状态 | 区分三态：缺文件 = 未 provision；JSON 坏 = `corrupt-json`；形状坏 = `bad-provision`（D7） |
| `fields.schema`（`fields.ts:92-101`） | `types` 在场但被忽略 → 一律 `'string'` | `{name:'Effort',type:'string'}`（探针 4.6） | **违规**：真实类型未知被显示为具体类型（`types` 缺省 → `string` 是契约缺省，合法） | 消费 `types`（D1；§7.2 步 5） |
| `guards.read`（`guards.ts:59-72`） | 未安装/已卸载 → `[]` | 空清单 | **合法投影**（v1.6 定义为“角色投影、不造”），但消费方不得把它读成“已授权” | 视图纪律（77-§3.7）；生产包装丢该位另记 `U-LP-07` |
| `comments.add`（`comments.ts:90`） | `author` 空白 → `'unknown'` | 真实工号字符串 `unknown` | **违规**：未知归因写成具名值，与真实身份不可区分 | 拒收 `bad-signed-body`（行为变更，需确认；G7） |
| `since` 的 `pageSize<=0` | 配置错 | 静默空页、`nextCursor=null`（探针 4.4） | **违规**：配置错误显示成“没有更多” | 构造期 `CONFIG_INVALID/bad-page-size`（D8） |
| `issues.transition`（任意非空状态） | 平台外状态 | 照收，写进 `transitioned` 事件 | 本包**不映射**（符合 78-§9.6），但接受任意值使未知状态进入事实记录 | 不改（不设第二道闸）；损失登记 G10① |
| `issues.list`（目录不可读） | `EACCES` 等 | 原生 `Error`，未分类 | 不是未知映射，是分类缺口 | G8 |

〔结论〕五条规则：

1. **未知保真或拒收**：要么保留原值 + 标未核验（端口有位时），要么拒收；不得落成 0/空/正常/最近已知。
2. **端口无位则不造位**：`FlowPlatform` 没有 `completeness`/`unverified` 位，本包不能私加字段；能做的只有“拒收”与“如实报错”两件事，其余登记为损失。**绑定面是唯一“有位”的地方**：80-§6.6 的 `StateMapping.verification` 就是那个位，`binding.ts` 用它表达“未映射”，并把 `workStates` 留空——既不复用 `closed`/`open`，也不把空数组读成结论（§三 `F-lp-binding`）。
3. **空结果不是结论**：`[]` 只证“扫描成功、无匹配”；“没有知识 / 没有变更 / 未采集”是另一句话（77-§9.2）。
4. **损坏不得降级为缺省**：`corrupt-*` 必须报错；唯一允许的“缺省”是**文件不存在**（`readJsonl`/`readJson` 的 fallback），且该缺省的语义必须在损失卡里写明（G10）。
5. **`unknown` 不是 `closed`（绑定面三分法）**：`mapState` 只有两种出口——`Ok(unverified)`（原值非空且合法但未被档案映射）与 `Err(rejected_precondition)`（原值为空/畸形）；**没有**第三种“猜一个状态”的出口。落到消费方的三条禁令同源于 80-§6.6 的 `unmappedBehavior:'observe-unmapped'`：① `workStates=[]` 时**不得迁移**（不产生 `REC-WORK-09`）；② **不得判验收通过**；③ **不得判结清**，也不得用平台 `closed`/`已关闭` 反推 `已结清`。`REC-OBS-02` 由消费方在读到 `unverified` 时落，本包只回判决（G14）；`unverified` 的 `Err` 形态（80-§5.7 的失败类）在这里**不适用**——那不是调用失败。

### 4.8 三种「迁移」的边界（代码 / 数据 / 权威）

〔事实〕仓内“迁移”至少指三件不同的事，混写会直接导致“复制了目录就宣称已迁移”：

| # | 类型 | 是什么 | 本包角色 | 依据 | 禁止 |
|---|---|---|---|---|---|
| M1 | **代码/文件迁移** | 本卷 §7.2 的十步：加固既有文件、两轴错误、补测试、绑定落地、清理注释漂移；既有文件与导出**只增不改** | 执行者（尚未执行） | 80-§2.4「`FlowPlatform` 实现不动」；本卷 §7 | 以“迁移”为名重排目录、新增**第二个**生产件（本卷只许 `binding.ts` 一个） |
| M2 | **数据导出/目录搬迁** | 整个平台根目录复制到别处；`issues/`、`kb/`、`meta/`、`activity.jsonl` 无绝对路径、无外部引用，可自洽搬走 | 提供格式；不提供命令 | 78-§9.4「目录可整体复制」；`layout.ts:1-15` | 复制后宣称“换平台完成”；把 `a-000001` 游标喂给 yt/taiga（§4.4） |
| M3 | **换平台权威迁移** | 候选端点登记 → 探针 → 导出核验 → 旧写者停写 → `REC-AUTH-07` → 迟到副作用对账 → 旧平台只读归档 | **只提供两件事**：可导出格式；状态原值保真（未知不映射近邻，§4.7） | 78-§9.7 七步；76-§8.3 `REC-MIG-01`；76-§8.4 `REC-LOSS-01` | 由本包声明迁移完成、给 `unconverted` 兜底、把“目录复制”算作迁移证据 |

〔结论〕

- **M2 ≠ M3**：目录复制只产生“同实现的新副本”，权威未变、代次未变、义务未核验；78-§9.4 明确本包作为靶子**不参与真迁移**。
- **M3 的幂等不在本包**：`REC-MIG-01.idempotencyRule` 要求重复导入可判（`reject|no-op|report`），而本包写面无幂等键（§4.5、G4/G12）；迁移只能靠目标平台或包装层，且**不得**声明“可重放”。
- **M3 的未转换项必须有主**：本包能导出的是文件；`REC-MIG-01.unconverted` 的 `ownerRef`/`disposition` 由 78 的迁移编排给，不由本包自证。
- **现状缺口**：`wire.ts:84,127` 与 `serve.ts:761` 把头注指向 `deliverables/migration.md`，但仓内**没有**该文件、也没有迁移命令——迁移目前只有流程文档、没有可执行入口（G13）。

---

## 五、证据现状与未证清单

### 5.1 已核对的代码锚点

| 主题 | 路径:行 |
|---|---|
| 端口声明（17 必选 + `guards.read?`） | `packages/contract/src/ports/platform.ts:179-220` |
| `PlatformActivity.issue` 可选 | `packages/contract/src/ports/platform.ts:114` |
| `FieldProvisionMap.types?` | `packages/contract/src/ports/platform.ts:82` |
| `SignedBody.author` 必填 | `packages/contract/src/ports/platform.ts:63-69` |
| 错误类别 11 值 | `packages/contract/src/ports/kernel.ts:85-96` |
| `ClassifiedError` **现状**（`category`/`subcause`/`detail?`，**无 `failure`**） | `packages/contract/src/ports/kernel.ts:98-102` |
| 两轴目标形状（`failure` 处置轴 / `category` 观测轴；`Err` 可达 6 个 `category`） | 80-§5.7（文档，非代码） |
| `PlatformBindingPort` 四方法 + `BindingProfile` 20 字段 + `StateMapping` | 80-§6.6 `TS-PORT-BIND-01`；类型落点 80-§6.9 = `contract/src/ports/binding.ts`；01 v0.9 已登记 `F-contract-port-binding`（`01-contract.md:111`，目标-新增），代码**未落地**（G15） |
| `PLATFORM_ACTIVITY_KINDS` | `packages/contract/src/ports/platform.ts:137-147` |
| plat 域 10 case | `packages/contract/cases.json`；`packages/contract/CASES.md` plat 域说明 |
| 写面九方法 / 读面八方法 | `apps/daemon/src/engine/tools/gated-platform.ts:66-88` |
| `guards.read` 被包装层丢弃 | `apps/daemon/src/engine/tools/gated-platform.ts:197-206` |
| 装配入口 | `apps/daemon/src/assembly/platform/wire.ts:129-135`；平台缺省 `fake`（`serve.ts:373`） |
| LocalFile 构造与目录 | `packages/localplatform/src/platform.ts:45-63`（`ensureDir` 三目录） |
| `readProvision` 三态缺口 | `packages/localplatform/src/fields.ts:78-81` |
| `kb.search` 空树即空结果 | `packages/localplatform/src/kb.ts:85-91` |
| `since` 空文件即空页 | `packages/localplatform/src/activity.ts:99-109` |
| `guards.read` 角色投影（未装=空） | `packages/localplatform/src/guards.ts:59-72` |
| 迁移脚本引用（文件不存在） | `apps/daemon/src/assembly/platform/wire.ts:84,127`；`apps/daemon/src/assembly/serve.ts:761` → `deliverables/migration.md` |
| CLI 惰性工厂 | `apps/daemon/src/cli/company.ts:9,143-144` |
| company 只消费 `fields.provision` | `packages/company/src/create.ts:400-411` |
| 边界表（层位/边/阈值/基线） | `scripts/guards/boundary-rules.mjs`（`packageLayers`、`allowedPackageEdges`、`maxFilesPerDirectory=25`、`maxLinesPerFile=600`、`lineBaseline` 无本包条目） |
| 类型门禁 include | 根 `tsconfig.json`；`packages/localplatform/tsconfig.json` |

### 5.2 已用只读探针确认的四组负向事实（2026-10-27，临时目录，未改仓库）

1. `issues.get('../../evil')` **成功读出根外 `evil.jsonl`**，返回 `{id:'../../evil', title:'outside', …}` → 读路径无 containment。
2. `created` 事件 `input: null` → 抛 **`TypeError: Cannot read properties of null (reading 'title')`**，非 `LocalPlatformError`。
3. 无 `issue` 字段的活动行 → `since` 抛 `CONFIG_INVALID/corrupt-activity`（与 contract 的可选声明冲突）。
   同时确认：坏活动行会让**后续所有写**失败（`createIssue` 也抛），即 fail-closed 熔断真实存在。
4. **未知被映射成值**（`createLocalPlatform` 实跑，同一临时目录方式）：
   - 4.1 空 `kb/` → `kb.search('anything')` 返回 `[]`；
   - 4.2 无 `activity.jsonl` → `since(null)` 返回 `{items:[],nextCursor:null}`；
   - 4.3 未安装公司 → `guards.read('acme')` 返回 `[]`；
   - 4.4 `pageSize: 0` → `since(null)` 静默空页、`nextCursor=null`；
   - 4.5 `meta/fields.json` 的 `provision` 为 `{fields:'not-an-object'}` → `create()` **成功**且 `state='open'`（损坏被读成未 provision）；
   - 4.6 合法 provision 带 `types:{effort:'int'}` → `schema()` 返回 `{name:'Effort',type:'string'}`（`types` 被忽略）。

〔结论〕这四组都是**当前代码行为**，不是目标；不得因为“测试绿”而认为它们可接受。探针只证明该行为在本机 Node 24/25 + 临时目录下发生，不构成 V4 故障证据。

### 5.3 未证清单（不得写成支持）

| # | 未证 | 为什么 | 需要什么 |
|---|---|---|---|
| U-LP-01 | 多进程/多写者并发安全 | 只有单写者假设，无锁 | 双进程同根写负测试（V4） |
| U-LP-02 | 崩溃于“事件已写/活动未写”的恢复语义 | 无注入点、无对账 | 受控 kill 点 + 重启对账（V4） |
| U-LP-03 | `appendFileSync` 的原子性（跨文件系统） | 未测 | 并发 append 观测（V4） |
| U-LP-04 | 大目录性能（ID 分配 O(n²)、`since` 全量读、`children` 全量扫） | 仅在 demo 规模跑过 | 10³–10⁵ 单/活动基线（V6 前置） |
| U-LP-05 | 符号链接逃逸 | 未实现 realpath | `robustness` 组 G |
| U-LP-06 | 大小写不敏感文件系统（macOS 默认）下的路径判定 | 未探 | 真机用例 |
| U-LP-07 | `guards.read` 在生产装配可达 | 被 `gated-platform` 丢弃 | daemon 侧补齐或明示不可达（81-files/17） |
| U-LP-08 | 与 yt/taiga 的语义等价 | plat 域只断 category | V3 跨实现用例 |
| U-LP-09 | git 仓库内的历史可读性（append-only diff） | 无仓库级测试 | 真实 `git log -p` 观测 |
| U-LP-10 | daemon 端到端（`wireGatedPlatform` + control key + 真单据） | 本包测试不经过 daemon | 端到端（V5） |
| U-LP-11 | `src/binding.ts` 的 `bindingProfile`/`mapState`/`lossReport` 与 `unverified` 分支；daemon 宿主的端口包装与 `exportBundle` | **目标件未写**：前置 contract 的 `Result`/`FailureClass`/`PlatformBindingPort`（`ports/binding.ts`）/`BindingProfile`/`StateMapping`/`WorkState` 未落地（§6.1-G15）；daemon `assembly/platform/binding.ts` 未建（17） | 前置落地后建件 + `binding.test.ts` 八组；端口装配与范围闸由 17 的装配测试证 |
| U-LP-12 | 消费方按 `workStates=[]` 不推进（不迁移/不验收/不结清） | 本包只回 `observe-unmapped`；执行者在 daemon 与 02 五门，二者均未实现 | 17 的装配 + 02 `work-readiness` 联测（V2+V5） |
| U-LP-13 | 包装层把本包 throw 转成两轴 `Err` | 本包只抛 `LocalPlatformError`；`EffectGateway`/API 的转换未实现（01 的 `classifiedError()` 亦未落地） | 转换层落地后补单测：三键逐一相等、`detail` 无路径 |

---

## 六、缺口与回写清单

### 6.1 需回写 80

| 编号 | 对象 | 缺口 | 建议处置（由 80 决定） |
|---|---|---|---|
| G1 | 80-§6.6 `TS-PORT-BIND-01 PlatformBindingPort` 的落点 | **v0.3 关闭；v0.3.4 关闭“宿主冲突”**：按 80-§6.9 与 §6.6 BIND-01 三层（80:1815）——类型唯一在 `contract/src/ports/binding.ts`；宿主唯一在 daemon `apps/daemon/src/assembly/platform/binding.ts`（17 `F-daemon-platform-binding`，组装 `describe`/`exportBundle`/`exitPlan`）；平台包只供纯函数。本包 `src/binding.ts`（`F-lp-binding`）**不再是端口宿主**，只出 `bindingProfile()`/`mapState()`/`lossReport()`，供宿主组合；**不得导出 `describe`/`exportBundle`/`exitPlan`**。17-§四 的 W-12 据此回链。**保留的真实未证**：两侧均未建件（U-LP-11）、contract 类型未落地（代码零命中，G15；01 已把 `ports/binding.ts` 登记为目标件）、01 v0.9 的 `mapState` 写者口径已与 80 同（G19 关闭） | 无待裁；实现顺序见 §7.2 步 10。**不得**两处各写一份端口实现，也不得据此声称绑定面已落 |
| G2 | 80-§6.8 `FlowPlatform` 保留清单 | **v0.3 关闭**：contract 已把 `PlatformActivity.issue` 改为可选（`platform.ts:114`），故缺口只剩**实现侧读校验**放宽，归 §6.4-D2，不再需要 80 出义务句 | 无（80 无需改动）；实现侧按 D2 修 |
| G3 | 80-§5.7 拒绝通道统一 vs 80-§6.8 保留端口 | **v0.3.3 复核：仍未收口**——80 现文只在 §5.7 对 `status:'failed'` / `status:'skipped'` 用了“豁免”一词，未见保留端口 throw 的豁免句。80-§5.7 说“**55 个端口**一体适用 `Result`”（55 = §6 的 55 个 `#### TS-PORT-*`），而 80-§6.8 的保留端口（`FlowPlatform`）仍以 throw 表达拒绝，**豁免关系仍未明写**。本卷 §2.5 按“throw 合法、`failure` 必填”执行 | 明写两条：① 保留端口可继续 throw；② 保留端口抛出的错误**必须携带 `failure`/`category`/`subcause`**，由包装层转 `Err`；或给出 `Result` 适配层并说明谁写 |
| G4 | 80-§6.8 / `FlowPlatform` 签名 | 无幂等键位，77-§11.2 的“同键同内容”无法在平台写面成立 | 要么在包装层强制 `idempotencyKey`（不改端口），要么走 contract `PORT_VERSION` 批示加键；不得在 localplatform 私加 |
| G9 | 80-§12.1（与 78 的接缝）/ 77-§2.7 | 活动流对账的入口（谁调 `since(null)`、`baseline_cursor` 存哪）未落文件家 | 归 daemon/store；本卷只登记“活动流不是完整事实日志” |
| G14 | 80-§6.6 `mapState` 的后置 / 77 的 `REC-OBS-02` | **v0.3.4 关闭**：80 现文（§6.6 `mapState` 错误条）已明写“**本函数不写 `REC-OBS-02`**——记录由消费方按上文三层第 6 条写”，§6.6 BIND-01 三层第 6 条与 §7 相位说明（80:2398）把写者钉为**消费方**（相位 2 的 state-diff 或 `TS-PORT-OBS-01` 观察面，同一单/同一原值/同一拍一条），并写明 `workStates=[]` 时**不生成状态迁移、不判验收/结清**。与本卷 `mapState` 纯函数口径一致 | 无（80 已明写）；本包只回判决、不写台账。同理 `REC-LOSS-01` 只引用不内联、不由本包生成 Qid |
| G15 | `src/binding.ts` 与 `LocalPlatformError.failure` 的编译前置；BIND-01 类型落点 | **类型落点已收口（01 v0.9）、代码仍为零命中**：contract **代码**里没有 `Result`/`FailureClass`/`PlatformBindingPort`/`BindingProfile`/`StateMapping`/`WorkState`（v0.3.4 复查零命中）。80-§6.9 定的类型落点 `contract/src/ports/binding.ts` 与 **01 的 `F-contract-port-binding`（`01-contract.md:111`，目标-新增、v0.8 从 `effects.ts` 拆出、v0.9 保持）**一致，卷间冲突已消；剩**代码未落地** | 等 01 的 `ports/binding.ts`/`ports/work.ts`、`ports/kernel.ts` 的 `Result`、`records/scalars.ts` 的 `FailureClass` 在代码里落地后本包才可建件；本包的 `binding.ts` 与两轴错误排在 01 的落点之后。在此之前不得“先写后修”（会红 typecheck），也不得由本包私造影子类型或补一份端口实现 |
| G16 | 80-§5.7 `failure`→`category` 覆盖表 | **v0.3.2 复核：仍未收口**——80 现文已开一道**窄口**：`rejected_precondition` 的唯一显式覆盖是「HTTP 外部面路由不存在（404，`subcause:'not-found'`）→ `EXTERNAL_REJECT`」，理由是“调用面走错，不是配置缺件”，其余一律 `CONFIG_INVALID`。本包的组合是**平台内引用对象不存在**（`issue-not-found`/`kb-not-found`），不是调用面路由 404，**不在**该口径内。本包有**一个**无法用现表表达的组合：`issue-not-found`/`kb-not-found` 需 `failure:'rejected_precondition'` + `category:'EXTERNAL_REJECT'`（冻结 case 要求），而该表给 `rejected_precondition` 的缺省是 `CONFIG_INVALID`；同时 80 又明写“`not_found` 不是 `FailureClass`” | 二选一：① 给“引用对象不存在”开**显式 override**（`rejected_precondition → EXTERNAL_REJECT`，带条件：仅限引用解析端口，与现有 404 窄口并列）；② 对保留端口给**豁免**（允许该组合，并写清只此一处）。**不得**造第 15 个 `failure`，也不得改 10 条 case |

### 6.2 需回写 78

| 编号 | 对象 | 缺口 |
|---|---|---|
| G10 | 78-§9.4 `BIND-PLAT-LOCAL-01` 损失行 | 现只列“guard 不执行”“单机文件（无并发控制）”。应补**四条**已证损失：① `transition()` 接受**任意非空状态**（不查 provision 声明集）；② 活动流不含 kb/fields/guards/links 变更；③ 写面无幂等键（重试重复建单/评论）；④ `activity.jsonl` 缺失/两步写窗口在 `since` 上与“无变更”同形（§4.7 行 2，77-§9.2 要求未知不得显示为空） |
| G13 | 78-§9.7 迁移七步的执行落点 | 七步只有流程、没有可执行入口：`wire.ts:84,127` 与 `serve.ts:761` 头注引用的 `deliverables/migration.md` **仓内不存在**，也没有迁移命令；`REC-MIG-01` 的 `idempotencyRule` 与本包无幂等键（G4/G12）冲突。建议 78 明确“谁出迁移脚本、provision 从哪份文件读” |

### 6.3 需回写 76 / 77 / 01

| 编号 | 对象 | 缺口 |
|---|---|---|
| G11 | 76-§7.7 `STAT-D` 映射 | 78 的通用骨架表未给 localfile 的**逐值**映射（LocalFile 的 state 由 provision 提供，可为任意公司自定义名）。本包不做映射，缺口在绑定档案；76 只需确认“绑定必须逐平台给表”已足够 |
| G12 | 77-§11.2 幂等 | 需要明确“无键写操作必须有持久意图记录，否则不得声明可重试”（77 原文）在平台写面上由谁承担；本包不承担，但现状是**可重试且会重复**，必须在绑定损失里写明 |
| G17 | 01 `F-contract-kernel`（`01-contract.md:278`）的两轴文字 | **v0.5 关闭（01 v0.9 复核仍在）**：01 v0.4 曾写“`category` 是处置轴，`failure` 是分类轴”，与 80-§5.7（`failure` **处置轴** / `category` **观测轴**）方向相反；01 v0.5 已改为「`failure` 是**处置轴**（重试、断路、对账、升级、判等一律读它），`category` 是**观测轴**（只用于事件 note 与告警分桶，**不驱动业务处置**），两者正交且都必填」（v0.9 仍在 `01-contract.md:285`），与 80 一致，`F-contract-schema-errors` 的“读 `failure` 不读 `category`”（`:412`）也不再自相矛盾。本卷 `LocalPlatformError` 的两轴口径（§2.5/`F-lp-errors`）无需改动，只在原处保持 `failure` 处置轴、`category` 观测轴 |
| G18 | 01 `F-contract-port-effects` 的 `mapState` 输入形状 | **v0.3.4 关闭（01 v0.9）**：01 v0.8 已把 BIND-01 从 `effects.ts` 拆到 `ports/binding.ts`（`:111`），v0.9 保持签名 `mapState(platformState: string)`（`01-contract.md:578`），`probes` 只作为 `BindingProfile` 的档案字段；旧措辞“缺 `platformState`、`probes` 非数组”在 01 全卷无命中。与本卷 `F-lp-binding`（§三）的 `mapState(platformState: string)` 一致，本卷不改 |
| G19 | 01 `port-binding` 的 `mapState` **写者**口径（`01-contract.md:578`；版本沿革 `:3`） | **v0.3.4 关闭（01 v0.9）**：01 v0.9 已把 `mapState` 定为**纯函数**——未映射但合法只回 `Ok({verification:'unverified', workStates:[], unmappedBehavior:'observe-unmapped'})`，**零 IO、不读时钟、不写 `REC-OBS-02`、不写任何记录**，记录由**消费方**（相位 2 state-diff 或 `TS-PORT-OBS-01`）读到 `unverified` 时写，同单/同原值/同拍一条（`01:578`），`workStates=[]` 时不得推进迁移/验收/结清的口径保留；与 80-§6.6 的“本函数不写 `REC-OBS-02`”（`80:1804`/`80:2398`）一致。消费方记录责任仍归 daemon 装配/观察投影，本包只回判决、不写记录（G14 口径不变） |

### 6.4 代码-契约漂移与行为缺陷（归 82 登记，不需回写上位卷）

| 编号 | 漂移 | 证据 | 目标 |
|---|---|---|---|
| D1 | `index.ts` 头注“`FieldProvisionMap` 不带字段类型”“`SignedBody` 无独立 author”已过期 | contract 已有 `types?`、`author` 必填；`comments.ts` 已取 `body.author` | 只改注释；`fields.ts` 消费 `types` |
| D2 | `isPlatformActivity` 要求 `issue` 必填，contract 已改可选 | 探针 3 | 读侧放宽；写入侧仍产 issue 必填（本实现无平台级活动） |
| D3 | `created.input=null` 抛原生 `TypeError` | 探针 2 | `isIssueEvent` 增 `isPlainObject(input)`；分类为 `corrupt-issue-log` |
| D4 | 错误消息含绝对路径 | 全部 `corrupt-*`/`kb-*` 消息 | 与 80-§5.8 冲突；修复须同步改测试断言（`expectLocalReject` 只断 category/subcause，故可安全改消息） |
| D5 | `kind` 写入侧不校验冻结词表 | `appendActivity` 无 `isPlatformActivityKind` | 加写入校验；读侧保持宽容（前向兼容） |
| D6 | `PACKAGE_STATUS='ready'` 可能被读成能力证明 | `index.ts:40` | 不改值，但在文档与注释里明确“ready=七能力齐，非 V2–V5 证据” |
| D7 | `readProvision` 把损坏降级为 `null` → 初态回落 `open` | `fields.ts:78-81`；探针 4.5 | 三态区分：缺文件 = 未 provision；JSON 坏 = `corrupt-json`；形状坏 = `bad-provision`（不改端口） |
| D8 | `pageSize<=0` 静默空页、`nextCursor=null` | `activity.ts:99-109`；探针 4.4 | 构造期 `CONFIG_INVALID/bad-page-size`（`platform.ts:34-51`） |

### 6.5 结构性风险（不新增文件，只登记）

| 编号 | 风险 | 说明 |
|---|---|---|
| G5 | 损坏即全熔断，无修复工具 | 一行坏活动会阻断全部写；目标可接受（fail-closed），但需运维修复路径（`fsck` 类命令不在 80，未设计） |
| G6 | 单号复用 | 删除最高号文件后 `nextNo` 回退，可能复用已被活动流引用的 id（`D75-14` 的同精神：标识一经分配不复用） |
| G7 | `comments.author` 空白 → `'unknown'` | 静默归因降级；仓内无调用方依赖，可改为拒收，但属行为变更，需确认 |
| G8 | fs 权限/空间错误未分类 | `EACCES`/`ENOSPC` 冒泡为原生 `Error`；是否包装为 `unavailable` + `STALL` + `subcause:'fs-io'`（会引入本包第二个 `failure` 值）属错误面扩张，需 80 口径 |

---

## 七、目标处置汇总与迁移顺序

### 7.1 处置汇总

| 文件 | 处置 | 变更性质 | 端口/契约 | 依赖 |
|---|---|---|---|---|
| `index.ts` | 目标-保留 | 注释对齐（D1/D2/D6）+ **纯增三条再导出**（`bindingProfile`/`mapState`/`lossReport`，与 `binding.ts` 同批） | 无（再导出本包纯函数，不新增端口） | 无 |
| `platform.ts` | 目标-保留 | 注释声明构造副作用 | 无 | 无 |
| `issues.ts` | 目标-保留 + 加固 | containment（类型 C）、`input` 收窄、读路径校验冻结 | 无 | 无 |
| `activity.ts` | 目标-保留 + 加固 | `issue` 可选（读）、`kind` 写入校验、`pageSize` 构造期校验（D8） | 无（跟随 contract 已发布字段） | 无 |
| `comments.ts` | 目标-保留 + 固化 | containment、空 author 待决 | 无 | 无 |
| `fields.ts` | 目标-保留 + 加固 | 消费 `types`、原子写、`readProvision` 三态（D7） | 无 | 无 |
| `guards.ts` | 目标-保留 | 不执行、不加审计字段 | 无 | 无 |
| `kb.ts` | 目标-保留 + 加固 | realpath、原子写、树上限 | 无 | 无 |
| `links.ts` | 目标-保留 | containment（经 `getIssue`） | 无 | 无 |
| `layout.ts` | 目标-保留 | 保持纯函数，不加校验 | 无 | 无 |
| `fsutil.ts` | 目标-保留 + 加固 | 原子写；fs 错误分类待决 | 无 | 无 |
| `errors.ts` | 目标-保留 + **加固** | 构造器改两轴（`failure`/`category`/`subcause`/`detail?`）；23 处构造点同批 | 不改 `category` 值域；`failure` 取 77 原值（§2.5） | 仅 contract 两个 type-only import |
| `binding.ts` | **目标-新增（生产，受前置阻塞）** | LocalFile 特定纯函数：`bindingProfile()`（20 字段骨架 + 声明期校验）、`mapState()`、`lossReport()`；零 IO、不读时钟；**不实现端口、不导 `describe`/`exportBundle`/`exitPlan`**（宿主在 daemon，§6.1-G1） | 只消费 contract 类型，**不新增端口、不造字段** | 仅 contract 类型（既有边，不新增） |
| `testutil.ts` | 仅测试-保留 | 未用导出可退役；`expectLocalReject` 加可选 `failure?` | 无 | 无 |
| 四个既有测试 | 仅测试-保留 | 不改断言方向 | 无 | 无 |
| `robustness.test.ts` | 目标-新增（仅测试） | 红先于修 | 无 | 无 |
| `binding.test.ts` | 目标-新增（仅测试） | 与 `binding.ts` 同批，**八组**口径回归（范围闸/导出委托的用例归 17） | 无 | 无 |
| `package.json` / `tsconfig.json` | 目标-保留 | 不改 | 无 | 无 |

〔结论〕**零新增依赖、零新增跨包边、新增 1 个生产件 + 2 个测试件、零拆分、零退役**。所有既有文件的变更都是内部实现与测试；唯一新增生产件 `binding.ts` 只产出 LocalFile 特定的三个纯函数（`bindingProfile`/`mapState`/`lossReport`，**不是**端口实现），依赖的是既有 `localplatform → contract` 边，因此不与 80-§2.4“`FlowPlatform` 实现不动”冲突（理由见 §1.2 结论），也不属于“大爆炸重写”，更不构成 BIND-01 的第二份实现（宿主在 daemon `assembly/platform/`，80-§6.9）。

### 7.2 代码迁移顺序（M1；每步独立可回退，均未执行；三种迁移的边界见 §4.8）

1. **登记先行**：把 §6.4 的 D1–D8、§6.5 的 G5–G8 写入 82 的漂移登记（82 v0.1 已建 `GAP-82-*` 登记键，尚无本包条目——登记的是**待办**，不得据此声称已登记）；把 §6.1–§6.3 的 G3/G4/G9/G10–G13/G16 提交 76/77/78/80/01 作者（G1/G2/G14 已关闭；G15/G18 已由 01 v0.8 解、G19 已由 01 v0.9 解、G17 已由 01 v0.5 修正，只报“已解”）。此步不改代码。
2. **红先**：新增 `src/robustness.test.ts`，按 `F-lp-test-robustness` 条目的分组表落组 A–H；当前 **9 行应红、5 行应绿**（按表逐行计，不按组名计）。只加测试，不改实现。
3. **分类修复**：D3（`input` 收窄）→ D2（`issue` 可选）→ D7（`readProvision` 三态）→ D5（`kind` 写入校验）。每组一次提交，逐组转绿；不得一次改四处再跑一次。
4. **containment**：`issues.ts`/`comments.ts` 入口加票据号 containment（只拒越界，不拒 `NOPE-999`）；同时加 `C-plat-007` 回归护栏。**必须重跑 `plat-cases.test.ts` 10 条**。
5. **契约对齐（需 80-§6.8 口径确认后）**：`fields.ts` 消费 `types`；`tests` 组 E 转绿。
6. **安全加固**：`fsutil.writeJson`/`kb.kbUpsert` 原子写 → `kb` realpath → `kb` 树上限。每组都补负例；不改变成功路径输出（逐字节回放测试必须继续绿）。
7. **历史可读性**：`deriveIssue` 读路径与写校验分离（§4.3）；用一个“旧事件 + 新规则”的夹具证明历史仍可读。
8. **收尾（既有文件）**：清理注释漂移（D1/D6）、实施 D8（`pageSize` 构造期校验）、评估 `expectLocalError` 退役。
9. **两轴错误落地（破坏性，前置 = contract 的 `FailureClass`）**：`errors.ts` 改构造器 → 23 处构造点一次改完 → `testutil.expectLocalReject` 加可选 `failure?` → `robustness.test.ts` 补两条（三键同错同键、`detail` 无绝对路径）。**不得**分两次（先加可选字段再补值）。
10. **binding 落地（前置 = 步骤 9 + 01 的 `ports/binding.ts`/`ports/work.ts` 类型；01 v0.9 已登记 `ports/binding.ts`，代码未落地，见 G15）**：`binding.ts`（`bindingProfile`/`mapState`/`lossReport`）+ `binding.test.ts` + `index.ts` 三条再导出，**三件同批**；随后由 17 在 daemon `assembly/platform/binding.ts` 把这些纯函数与台账导出器组合成 `PlatformBindingPort`（80-§6.9 / §6.6 三层），并由消费方在读到 `verification:'unverified'` 时落 `REC-OBS-02`（G14）。本步**不得**提前到步骤 9 之前，也不得为过 typecheck 私造影子类型（G15）；本包**不得**出现端口的第二份实现。

### 7.3 每一步的验收口径（不得用“测试绿”冒充）

- 门禁：`bun run test`（含 `guard:boundaries`）+ `bun run typecheck` + 包级 `tsc --noEmit -p packages/localplatform/tsconfig.json` 全绿。
- 行为：`plat-cases.test.ts` 10 条仍绿且**不改断言**；`activity.test.ts` 的逐字节回放仍绿。
- 证据：`robustness.test.ts` 的红→绿差异留档（提交信息和 82 登记各一份）。
- 未知保真：§4.7 的每个调用点至少一条负例或现状断言；D7/D8 修复后对应组由红转绿，且损坏面**不得**再降级为缺省值。
- 两轴：23 个 `subcause` 的 `failure×category×subcause` 与 §2.5 表逐项相等；`Err` 可达 `category` 只 6 个（本包只用其中 2 个）；`detail` 不含绝对路径。**不声称**“全仓 55 端口已两轴化”——本卷只管本包。
- 绑定：`binding.test.ts` 八组全绿，其中三条为**不可退让**：① 未映射回 `Ok(unverified)` 而非 `Err`；② `workStates=[]` 时既不产 `closed`/`open`，也**不迁移/不验收/不结清**（三条各一条负例：无 `REC-WORK-09` 产出、五门不判通过、结算端口不判 `已结清`，且平台 `closed` 不得反推结清）；③ 宿主从 `bindingProfile().exportMigrationExit.exitPlan` 取退出声明时 `archive` 不被改写（`{mode:'read-only', deleted:false}`）。`exportBundle` 范围闸与端口装配**不在本包**：由 17 的 daemon 宿主测试证“范围外拒绝发生在委托之前、注入器计数为 0”。`index.ts` 的再导出可达由本包测试经 `./index.ts` 取件证明。
- 迁移边界：不得以“目录复制成功”作为任何验收；M3（换平台）只在 78 的编排与 `REC-MIG-01` 下验证，本包只交导出格式与原值保真。
- **不声称**：V3 跨实现、V4 崩溃/并发、V5 真机、V6 自治评估。这些在 82 统一执行。

---

## 八、跨卷目标件登记（只登记消费面，不复制文件契约）

〔事实〕本卷在本包之外依赖七个**目标件**。它们的路径、职责、导出、测试与迁移由主归属卷负责；本卷**不复制、不另起路径、不改它们的计数**，只记“主归属卷当前登记状态”与“本卷的消费约束”。核对时间 2026-10-27，依据 01 **v0.9** / 02 **v0.5** / 17 **v0.4** 的现行正文（**v0.3.4 已按 80-§6.9 补 BIND-01 宿主与类型两行**；行号随主卷改版漂移，以条目 ID 为准）。

〔说明〕v0.2 曾把其中三条当作“主归属卷未登记”的缺口；逐文件核对后不成立——01 v0.9 已登记 `ports/intent.ts`/`ports/secret.ts` 与 `ports/binding.ts`（`PlatformBindingPort` 的类型落点，v0.8 从 `effects.ts` 拆出、80-§6.9 指名、v0.9 保持），02 v0.5 已登记 `work-readiness.ts`，17 v0.4 已登记 `assembly/intent/*`、`assembly/api/assemble.ts` **与 `F-daemon-platform-binding`（`assembly/platform/binding.ts`，BIND-01 唯一宿主）**。v0.3.2 登记的“host 冲突”据此关闭（§6.1-G1）：通用宿主归 daemon，本卷 `src/binding.ts` 只出 LocalFile 档案/判决/损失/退出声明。

| 文件 | 主归属卷 · 条目 | 80 锚 | 主归属卷当前登记 | 本卷消费约束 |
|---|---|---|---|---|
| `packages/contract/src/ports/intent.ts` | 01 `F-contract-port-intent`（`01-contract.md:113`） | 80-§6.6 `TS-PORT-API-01`、§12.3（**指定路径，不得另起**） | **已登记**（目标-新增） | 本包**不消费**；API 装配只转发 `submit`/`receipt`，与本包无接缝 |
| `packages/contract/src/ports/secret.ts` | 01 `F-contract-port-secret`（`:114`） | 80-§11.2.1、§12.3（**指定路径**） | **已登记**（供给面接口，不属 55 端口） | 本包**无凭据面**（§2.2 第 6 条）。`ExportScope.memories.excludeSecrets` 恒 `true`（秘密默认排除、不可关）；脱敏只在 daemon 侧 `KnownSecretSet.redact`（80-§11.2.1）做，本包不读、不扫、不记秘密，也不实现第二份脱敏 |
| `packages/contract/src/ports/binding.ts` | 01 `F-contract-port-binding`（`:111`；01 v0.8 从 `effects.ts` 拆出） | 80-§6.9（**指名路径**）、§6.6 `TS-PORT-BIND-01` | **已登记**（目标-新增；代码未落地，见 G15） | 本包只**引用形状**（`BindingProfile`/`StateMapping`/`ClassifiedError`/`WorkState`）；本包**不实现端口**、不定义形状、不留第二份档案类型 |
| `packages/core/src/work-readiness.ts` | 02 `F-core-work-readiness`（`02-core.md:612`；计数见 `:24`/`:169`） | 80-§7.2 2h（**点名该路径**）、§6.4 `TS-PORT-WORK-03` | **已登记**（目标-新增，未实施）；阻塞项见 02-§六-2/§六-15 | 本包只产 `WorkState`（`STAT-D`）**值**，不判五门、不调 `work-readiness`；“`workStates=[]` 时不得迁移/验收/结清”由消费方（五门/`decide`）执行 |
| `apps/daemon/src/assembly/intent/{ingress,receipt-store}.ts` | 17 `F-daemon-intent-ingress`（`17-daemon-assembly-cli-control-evolve.md:363`）、`F-daemon-intent-receipt-store`（`:364`） | 80-§6.6、§6.3 | **已登记**（目标-新增） | 无直接接缝；本卷的绑定面不产生意图/回执 |
| `apps/daemon/src/assembly/api/assemble.ts` | 17 `F-daemon-api-assemble`（`:362`） | 80-§9.4、§3.6 第 7 步 | **已登记**（目标-新增） | 同上。对外 API 的平台写必须经网关，**不得**直调本包（80-§11.2 的“待迁移违例”，见 17） |
| `apps/daemon/src/assembly/platform/binding.ts` | 17 `F-daemon-platform-binding`（`17-daemon-assembly-cli-control-evolve.md:370`） | 80-§6.9（`TS-PORT-BIND-01` **实现落点**）、§6.6 | **已登记**（目标-新增；daemon 侧**唯一**实例） | 本包**只供料**：`bindingProfile()`/`mapState()`/`lossReport()`（§三；`exitPlan` 是档案 `exportMigrationExit` 里的**数据**，不是本包导出的方法）。宿主负责 `describe`/`exportBundle`（含范围闸）与台账导出；**不得**在宿主内重写映射表或在本包补端口壳 |

〔结论〕接口口径摘录（**只记不定义**，供本卷与调用方对齐；定义在各自主归属卷）：

- `openLedgerReadonly(o)`（80-§8.2，拼写即此 camelCase）：入参 `ReadOnlyLedgerOpen = { path, expectedSchemaVersion, readOnly:true, queryOnly:true }`（后两键恒 `true`，无 `false` 分支），出参 `ReadOnlyLedger`（只读视图，类型上不暴露 `append`/`begin`/`kvSet`）。**读面三条都是同步 `Result`**（`node:sqlite` 是同步 API）：`query<TPayload>(q: RecordQuery): Result<RecordPage<TPayload>, ClassifiedError>`、`get(recordId: Qid): Result<RecordEnvelope<unknown> | undefined, ClassifiedError>`；`Ok(undefined)` **只**表示“该 `recordId` 不存在”，**运行期库读失败一律 `Err({failure:'unavailable', category:'STALL', subcause:'ledger-read-failed'})`**，不得用 `undefined` 或空页吞掉。query 三条 `subcause` 固定、`category` 走 80-§5.7 的缺省表：`ledger-query-unsupported`（`unsupported`/**`EVOLVE_REJECT`**）、`ledger-cursor-invalid`（`conflict`/**`EXTERNAL_REJECT`**，非合并域**不得**写 `MERGE_CONFLICT`；`STATE_CONFLICT` 不是 `ErrorCategory` 的成员，全卷**不得出现**）、`ledger-query-invalid`（`rejected_precondition`/**`CONFIG_INVALID`**）；打开期失败另给 `db-missing`/`schema-behind|schema-ahead`（不建库、不迁移）。读面第三条是 **`payload(ref: ArtifactRef): Result<RecordPayload | undefined, ClassifiedError>`**（同步；与 `TS-PORT-REC-02` 的 `payload(ref)` 同义同码，四态与四条 `subcause` 逐字一致）：`RecordPayload = { ref, bytes, mediaType }` 是**原始字节**，`ref.contentDigest` 必须是 `bytes` 的 `byteDigest`；`storageHint` 只是逻辑定位，**不是本机路径、不是可读性证明、也不是权限凭证**。写入侧对称：`RecordWriteInput = { envelope, payload }`，`payload.ref` 与 `envelope.payloadRef` 逐字段同值、`payload.mediaType === envelope.payloadRef.mediaType`，否则按四条固定 `subcause` 之一拒写且**零行**：`payload-missing`/`payload-digest-mismatch`/`payload-media-type-mismatch`/`payload-unreadable`（全 `rejected_precondition`，不是 `unsupported`）。**权限**：取载荷必须先由 `contentDigest` 反查其所属信封、按该信封的 `knowledge`/`scope` 校验调用方许可，不许可 ⇒ `Err({failure:'rejected_forbidden', category:'EXTERNAL_REJECT', subcause:'payload-not-authorized'})`——**`ref` 不是通行证**；`knowledgeScope` 过滤发生在查询条件（`WHERE`）里，不是取回后在内存过滤。**对照**：`RecordReader.query`/`get`（`TS-PORT-REC-02`）是**异步** `Promise<Result<…>>`、出参与 `subcause` 同表，`payload(ref)` 亦为异步同义同码——两处都不得把失败渲染成空数据/空页（“读不出来”≠“没有单”）。本包**不读台账**——`exportBundle` 必须注入，正是为此。
- `IntentReceipt`（80-§6.6）：`status` 三值 `queued`/`decided`/`unknown`、`outcome` 是 `IntakeOutcome['outcome']` 的**标量**五值（未判时缺省）、`gap?: readonly ReceiptGap[]`（封闭两码，非空即“投影不完整”，不得据此降级状态或重放）——都是**结论**不是失败类，留在 `Ok` 里；`receipt(key)` 回 `IntentReceipt | undefined`，`undefined` = **本进程已提交投影快照**里没有该键（未登记或不可重建），不是拒绝、也不证明库里没有，不得包成 `Err`。本包不产。
- `TxReceipt`（80-§6.3）：`abort(tx, reason)` 回 `Result<TxReceipt, ClassifiedError>` 且 `status:'aborted'`；`receipt(txId)` 回 `TxReceipt | undefined`（`undefined`=未登记，不是拒绝），`status:'unknown'` 只由 `receipt(txId)` 重读或 `TS-PORT-REC-06` 对账消解。记录面语义，本包不参与。
- `MigrationPlan.dryRun.reportArtifactRef`、`rollback.snapshotArtifactRef`、`ExportBundle.manifest.bundleId` 都是 **artifact 字符串、非 Qid**（80-§6.6）；`planId` 才是 `Qid`、`planDigest` 是摘要（两者都不含上述 artifact 引用）。本包**不造 Qid**：`losses` 只从注入档案的 `profile.losses` 读，`exitPlan` 只回注入声明。
- `TableProjectionName`（80-§6.3，**现状 17 个成员、不动**）含 `intentReceipts`；**目标**另有 `TargetTableProjectionName = TableProjectionName | 'resourceLedger'`（物理表 `resource_ledger`，**目标新增、尚未建表**，随 `MIG-01` 落地），`ProjectionName = TargetTableProjectionName | 'observation'`。**逻辑名与物理名是两件事**：投影名写 `resourceLedger`、物理表名写 `resource_ledger`，不得互写或另起别名；`observation` 只回 `ObservationProjectionResult`、**不得带 `rows`**。`intent_receipts` 是**可重建投影**，不是事实源；本包不写任何投影。

〔结论〕这张表是**只读见证**：主归属卷任何一次改版，本卷须重核；但本卷不得替它们改计数、改条目或改文件契约。

---

## 九、一句话结论

`localplatform` 是一个**边界清楚、规模安全、但被“单写者 + 无幂等 + 无路径 containment”三个假设托住**的契约靶子：它值得保留到目标架构，不需要拆分；目标只新增一个 LocalFile 绑定档案件（`src/binding.ts`，**不是**端口宿主）与两个测试件，其余全在既有文件内部把“损坏必须分类、路径必须收口、写必须原子、历史必须可读”四件事补齐，并把“活动流不是事实全集”“guard 不执行”“生产不可达的 `guards.read`”如实写进绑定损失，而不是留在注释里。另有三条同等级的硬约束：**未知不得落成 0/空/正常**（`readProvision`、`types`、`pageSize` 三个已有修法，空白 `author` 改写为 `'unknown'` 待决）；**三种“迁移”必须分开声明**（代码加固、目录复制、换平台权威）；**目录可复制不等于可迁移**——权威、代次、幂等与未转换项都不在本包。v0.3 再追加两条同等级事实：**它不是纯只读靶子**——本包承担 LocalFile 特定的绑定档案、`mapState` 判决、损失引用与退出声明（`src/binding.ts`），但**不是** `PlatformBindingPort` 的宿主：端口包装在 daemon `assembly/platform/binding.ts`（80-§6.9），类型在 `contract/src/ports/binding.ts`；`mapState` 的“未映射”必须是 `Ok(unverified)` 而不是 `Err`，本包不写 `REC-OBS-02`（消费方落）、`REC-LOSS-01` 只引用不内联，且它受 contract 目标类型前置阻塞（§6.1-G15）；**错误面是两轴**——`LocalPlatformError` 带 `failure`（77 原值）与冻结的 `category` 并列，`issue-not-found`/`kb-not-found` 是唯一无法用 80 现表表达的组合，必须由 80 裁决（§6.1-G16），本卷不私定、不改 case。
