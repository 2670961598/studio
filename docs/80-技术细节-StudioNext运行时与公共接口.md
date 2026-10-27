# 80 · 技术细节：Studio Next 运行时与公共接口

> 版本：v0.2，2026-10-27。**v0.2 收敛运行时接缝**：记录三表与原始载荷、Matrix 两用途与两类句柄、效果写 `ControlEffectAction` + 内部 `EffectWriter` + 尝试先行、规则档/五门解析、金额/日界/故障与脱敏边界。55 个公共端口不变，未新增生产实现；§12 的未证项仍需真实验证。
> 性质：**实现说明（75-§0.2 第 3 类效力）+ 接口设计呈审稿**。不是公共规范、不是绑定档案、不是实现单、不产出 PASS。
> 上位：`docs/75`（工程决策与契约模板）、`docs/76`（公共语义与纯配置）、`docs/77`（运行记录与行为契约）、`docs/78a`（DSH 承载决策）、`docs/79`（TS 工程与依赖）。
> 下游：`docs/81`（逐文件契约）以本卷 §6 端口与 §7 相位为输入，不得另设计一套接口；`docs/82` 以本卷 §12 未证边界为验证输入。
> 语言：叙述中文，类型名、字段名、路径、命令英文。

---

## 〇、本卷的口径

### 0.1 四类标记与四种状态

本卷严格沿用 75-§0.1 的四种命题标记，不另造第五种。无法确认的断言用〔假设〕标记，并在句末写明状态「未证」+ 探针与拒绝路径；「未证」是**状态**，不是标记，不得被读成支持，也不得被下游当作前提。

| 标记 | 含义 | 本卷的兑现方式 |
|---|---|---|
| 〔事实〕 | 当前源码、manifest、锁文件或本文实际核对的输出支持 | 给 `path:line` 或命令；不外推 |
| 〔结论〕 | 从 63–72 的概念与 76/77 的语义推出的必要约束 | 给反例检查口径 |
| 〔选择〕 | 本卷选定、可替换的工程方案 | 给替代、成本、失败与退出 |
| 〔假设〕 | 关于性能、易用性或现实效果的判断 | 给基线与停止条件；未证前标「未证」 |

状态词沿用 75：**已有**（源码与调用链真实存在）、**库级存在/未接运行链**、**目标**（新设计，未实现）、**未证**（给探针、负向结果与拒绝路径）。本卷不再使用「待验证」作为标记或状态。

“必须”用于目标语义时，表示实现该目标时不可省略，**不表示当前代码已满足**。本卷凡写“现状”的段落一律带〔事实〕；凡写“应当”的段落一律带〔结论〕或〔选择〕。

### 0.2 本卷写什么、不写什么

| 本卷独占 | 本卷只引用、不重定义 |
|---|---|
| Studio Next 的包层与允许边现状、组合根、公共 TS 端口（`TS-`）、主循环相位内的语义落位、事务与并发纪律、读写面与网络服务、结构债迁移约束 | 76 的对象、字段、规则语言、默认目录、版本轴；77 的 `REC-*` 字段表、`RUN-*` 协议、失败分类；78 的平台/存储/传输绑定；79 的依赖条目、构建与 exports 策略；81 的逐文件职责与 IO；82 的波次与验证矩阵 |

`TS-` 前缀按 75-§2.1 归本卷。`F-` 归 81，本卷不分配逐文件 ID，也不给 81 的逐文件清单；只给**组件边界**与**迁移约束**。

本卷**不新增概念层**：凡 76/77 已有的对象，只做 TypeScript 侧的形态映射；映射不得反向成为规范。凡本卷新造的类型名（如 `RecordEnvelope`、`EffectGateway`），只是实现选择，其他实现可以用别的名字承载同一语义。

### 0.3 公共 TS 类型的效力与分级

〔结论〕本卷给的全部 TS 类型属于**实现说明**：删除 `TypeScript`、`Node`、本仓包名后，76/77 的语义仍应成立。因此：

1. 类型名不进入公共规范，不构成跨实现义务；
2. 类型**不得**比 76/77 更严或更松——若 76 允许“不适用须显式声明”，TS 侧不得用 `?` 隐式省略来冒充；若 77 要求三态不可合并，TS 侧不得用布尔代替；
3. 类型**不是**运行时校验。运行时校验归 76-§1.7 的诊断与 79-§3 的边界规则；TS 只负责编译期形状。

〔结论〕本卷新增的公共形状——§4 的标量/记录/事务/迁移、§6 的端口类型、§8 的只读打开——一律是**目标 TS 实现映射，不重新定义 76/77/78**：字段语义、必填性、状态值域与失败分类以 76/77/78 原文为准；本卷只决定“在 TS 里长什么样、由哪个包承载”。发现与三卷冲突时停手改本卷（AGENTS.md 第五条），不得让代码漂移。

〔事实〕当前 `packages/contract/src/ports/index.ts:6` 声明 `PORT_VERSION = 'v0'`，同文件 `:7` 已存在 `PortGrade = 'experimental' | 'beta' | 'stable' | 'deprecated'`，但**没有任何端口标注等级**；`@studio-next/contract` 的 `PACKAGE_STATUS` 亦不存在该维度。

〔选择〕本卷给三级升级条件，`PORT_VERSION` 保持 `v0`，全部端口按 `experimental` 计：

| 等级 | 升级条件（必须全满足） | 当前是否满足 |
|---|---|---|
| `experimental` | 形状可变，允许破坏性改动；须在 81 的文件条目里标“实验” | 是（v0 全部） |
| `beta` | ① 形状在至少两个实现上跑通（如 `FlowPlatform` 的 yt + localplatform）；② 负向用例冻结（拒绝路径有测试）；③ 78 绑定档案登记该端口的损失与退出；④ 变更须走批示流 | 否 |
| `stable` | ① beta 全部条件；② 跨实现互操作证据（V3）；③ 至少一个发布周期无破坏性变更；④ 82 登记豁免与退役路径 | 否 |

〔结论〕`PORT_VERSION = 'v0'` **不得**在任何文档、面板、agent-card 或对外 API 中被描述为 stable/beta。`0.x` 的 `@studio-next/*` 包版本同样不构成稳定承诺（79-§6 exports 切换表也未承诺）。

### 0.4 核查基线

本文写作时实际执行的核对（可复现）：

| 核对项 | 命令 / 位置 | 结果 |
|---|---|---|
| 工作区节点数 | `ls apps packages` + 各 `package.json` | 15 个 `packages/*` + `apps/daemon` + `apps/boot` = 17 |
| daemon 源码规模 | `find apps/daemon/src -name '*.ts' \| xargs wc -l` | 23617 行 |
| 包源码规模 | 同法对 15 包 + boot | 约 44763 行 |
| 测试规模 | `find . -name '*.test.ts' -not -path '*/node_modules/*' \| wc -l` | 209 个测试文件（`apps/daemon/test` 85 个） |
| 超 600 行文件 | `wc -l` 全量过滤 + `lineBaseline` | 基线 22 条 = **12 个非测试件 + 10 个测试件**（含 `apps/boot/src/boot.test.ts`）；两者计数不得混用 |
| CLI 规模 | `find apps/daemon/src/cli -maxdepth 1 -type f` + `main.ts` 的 `switch` | 22 个模块文件、**18 个命令**（另有 `help`/`--version` 分支与 `argv/usage` 辅助文件） |
| 目录与平面 | `find <dir> -maxdepth 1 -type f` | `cli` 22 文件；`test/engine` 直属 25 文件 = **24 测试 + `crash-points.ts`**，16 个子目录（顶格）；`engine` 13 / `control` 2 / `evolve` 5 / `assembly` 1（域平面顶格）；`apps/daemon/test` 共 86 `.ts`（85 `.test.ts` + `crash-points.ts`） |
| 门禁扫描范围 | `scripts/guards/boundary-rules.mjs` 的 `scopeDirs` | guard 扫 `apps/*` 与 `packages/*` 的 **src 与 test**；根 `typecheck` 只 `include` src（79-D10），两者是不同门禁 |
| 包间允许边 | `allowedPackageEdges` | **38 条**（含 boot 三条） |
| 层位与纵向边 | `daemonLayers` / `allowedVerticalEdges` | root 6 / cli 5 / assembly 4 / control·evolve·engine 3 / engine/tools 2；13 条纵边，**无 `root→engine`、无 `root→cli`** |
| 端口版本 | `packages/contract/src/ports/index.ts:6` | `v0` |

〔事实〕本文**没有**执行 `bun run typecheck`、`bun run test`、`bun run guard:boundaries`。因此本文任何“契约测试覆盖”“类型通过”的说法都不成立；§12 逐项列为未证。

---

## 一、现状总览与差距判定

### 1.1 当前运行时的真实形状

〔事实〕现状不是“daemon 一个进程跑七相位”这么简单，而是三层装配：

1. **CLI 层**：`apps/daemon/src/cli/main.ts` 是唯一命令分发入口（目录 22 个模块文件、`switch` 实有 18 个命令，`main.ts:43`）。`package.json` 的 `bin` 指向它（v0.1-M3，落点见 `docs/25-§七`）。
2. **装配层**：`apps/daemon/src/assembly/serve.ts` 的 `runServe(configPath, opts?)` 是常驻循环；`buildServeRuntime()` 把平台、台账、适配器注册表、装配器、闸门、调度器、唤起源注册表、热重载拼成 `ServeRuntime`。
3. **组合根**：`apps/boot/src/boot.ts` 的 `bootServe()` 是仓内**唯一**同时依赖 `@studio-next/daemon` 与 `@studio-next/matrix` 的单元；**现状**是它把 Matrix 登录、mention 源、频道供给面、notify 广播面、人事面注入 `runServe`；**目标态**（§3.4 第 10 条）改为只构造 `matrixSessionFactory` 并注入，登录与 token 归 daemon。boot **没有** `bin`/启动脚本，只作为库被调用。

〔事实〕`apps/daemon/src/index.ts` 仍是 36 行横幅 + `process.exit(0)`（`:24`–`:36`），但它同时是 `@studio-next/daemon` 的 `"."` 导出，`main` 也指它。这意味着 `import '@studio-next/daemon'` 会执行 `console.log` 并**退出进程**——这是本卷要处置的第一号结构债（§3.2、§10.1）。仓内现无包根消费者：boot **运行时**只走 `@studio-next/daemon/serve`（**不走** `@studio-next/daemon/engine`）；`/engine` 只在测试面出现（`apps/boot/src/boot.test.ts:23` 的 `checkMentionPayload`）。删除包根是为防止未来误用，不是为修一个现存调用。

〔事实〕引擎主循环在 `apps/daemon/src/engine/engine.ts` 的 `createEngine().tick()`（`:1570`），七相位名称与顺序为：采集 → state-diff → 派发 → 收割 → 合并 → 回收 → 落账/心跳。相位外还有拍边界步骤（notify 中继、L1 热重载、停机通道、信号处理）。

〔事实〕`apps/daemon/src/engine/engine.ts` 2337 行、`assembly/serve.ts` 1627 行、`packages/store/src/ledger.ts` 1683 行、`packages/company/src/repo-validate.ts` 1021 行——四件均超 `maxLinesPerFile = 600`，且均在 `lineBaseline` 内。

### 1.2 差距的三种类型

〔结论〕从 76/77 的语义看，现状的缺口不是“功能少”，而是三类错位：

| 类型 | 表现 | 处置归属 |
|---|---|---|
| **语义缺口** | 76/77 有对象与协议，代码里只有等价物或没有：如 `Authority Activation`、`Writer Lease`、`Settlement`、`Memory Store`、`Observation Projection` 六态 | 本卷 §6 定义端口；81 落文件；82 定波次 |
| **形状错位** | 现有类型把目标语义压扁：如 `EventRecord` 是 30 个事件名的单表，而 77 是 50 类 `REC-*` 记录 + 信封 | 本卷 §4 给映射，不删 `EventRecord`；目标态见 §4.4 |
| **结构违规** | 包根 `main`/`exports["."]` 指向有副作用的横幅文件；`RunServeOpts` 已有唯一定义却未被 `runServe` 使用（`runServe` 另写匿名类型）；`api` 是骨架而 `:8788` 长在 `panel/external`；`panel` 运行时依赖 `company` 却登记为 devDependency；`panel/external` 直写 `daemon_kv` 并直调 `platform.issues.create`（不经 `EffectGateway`/wkey） | 本卷 §3、§9、§10 给迁移约束；改代码走实现单 |

〔结论〕不得把 `EventRecord` 直接改名为 `RecordEnvelope` 来“完成映射”。前者是**台账行**（17-§3 列集、strict、不可变），后者是**交换信封**（76-§4.2，含 `basis`/`scope`/`provenance`/`integrity`）。两者是投影关系，不是同一物。

---

## 二、包层、允许边与目标包语义

### 2.1 十七个节点的层位

〔事实〕`scripts/guards/boundary-rules.mjs` 的 `packageLayers` 登记 16 个包层位：

| 层 | 包 | 现状语义 | 目标语义（本卷） |
|---|---|---|---|
| 5 | `daemon` | 唯一常驻进程：主循环、调度、看护、CLI 命令面 | 不变；补组合根与端口实现 |
| 4 | `panel` | `:8791` 监控、`:8789` 公司概览、`:8788` 对外 API（`src/external/`） | 只保留读投影；`:8788` 迁出（§9.4） |
| 4 | `api` | 43 行骨架（`PACKAGE_STATUS = "skeleton"`） | 接管 `:8788` 信息/触发/订阅面 |
| 4 | `prompt` | L0–L5 组装、任务书、裁剪、脱敏 | 不变；补“秘密不入装配”的可证明边界 |
| 4 | `studio-tools` | 内部 MCP server（worker 面工具） | 不变；工具集与 `GATEWAY_ACTIONS` 同表纪律 |
| 3 | `company` | 公司目录校验、挂载、报表聚合、模板生成、git 导入 | 不变；`repo-validate`/`dependencies` 超限件**在本包内拆件**，不下沉 `core`（字节/路径/归档/纯配置校验留 `company`；规则求值属 `core`，两者不是同一层） |
| 2 | `store` | SQLite schema、migration、台账读写、重建、drill | 不变；补 `RecordTransaction` 的事务型接口 |
| 1 | `adapters` | dsh/claude/codex/kimi 四适配器、注册表、解析器 | 不变；补 `ExecutorAdapter` 目标接口映射（§6.5） |
| 1 | `core` | 纯逻辑：状态机、`decide`、断路器、预算、队列、成本、流表、人事同步、micro-judge、候选演进、golden 与脱敏 | 包边界不变；脱敏迁 `contract`（本包只具名再导出）；补 `decimal`、`rule/`、`work-readiness.ts`、`spec/`、`authority/`、`resources/` 的**纯函数实现**；§6.8 只列现有端口，不是文件清单，详见 §6.9 |
| 1 | `gateway` | wkey、动作词、署名、`gateWrite` | 不变；升级为 `EffectGateway` 的可信内核（§6.6 `TS-PORT-EFF-01`） |
| 1 | `localplatform` | LocalFile 平台（第二实现） | 不变 |
| 1 | `matrix` | Matrix 客户端、mention 源、供给/广播/人事面 | 不变；daemon 仍不 import 本包，边仍只经 boot——目标态 boot 只构造 `matrixSessionFactory` 交给 `runServe`，登录在 daemon（§3.4 第 10 条） |
| 1 | `yt` | YouTrack 平台实现 | 不变 |
| 1 | `taiga` | Taiga 平台实现 | 不变 |
| 1 | `dsh-bridge` | DSH 插件（systemPrompt 注入指令段） | 不变；仓内零模块入边，以路径引用被复制 |
| 0 | `contract` | 端口与 schema（唯一共享前提） | 不变；`PORT_VERSION` 升级须批示 |

〔事实〕`apps/boot` **不在** `packageLayers` 中，但在 `allowedPackageEdges` 中有三条边（`boot→contract`、`boot→daemon`、`boot→matrix`）。守护脚本只校验**被导入包**是否登记（`boundaries.mjs:159`），因此 boot 作为“只出不进”的组合根可以通过。

〔结论〕boot 的层位缺口必须在 81 的条目里显式声明，而不是“没登记就不存在”。目标口径：**boot 是组合根，不是包层**；它零入边、允许出边三条、不得被任何包 import。若将来需要第二装配单元（如 `apps/boot-taiga`），必须走提案流新增边，不得复用 boot 的名字。

〔选择〕不新设平行 `spec` / `engine` / `runtime` 包（D75-03）。76 的“规范对象”不需要独立包：它们是 `contract` 的类型 + `core` 的纯函数 + `store` 的表。新增包=横轴扩域=提案流。

### 2.2 daemon 内部五域与根

〔事实〕`daemonLayers`：`root 6`、`cli 5`、`assembly 4`、`control|evolve|engine 3`、`engine/tools 2`。允许边 13 条，**没有** `root→cli`：

```
root → assembly
cli → assembly | control | evolve | engine | engine/tools
assembly → control | evolve | engine | engine/tools
control | evolve | engine → engine/tools
```

〔结论〕这条表直接决定 §3 的组合根设计：`src/index.ts`（root）**只能** import `assembly/*`，不能 import `cli/main.ts`。任何“让 index.ts 变成 CLI 入口”的方案都是违规。

〔事实〕域平面基线：`engine 13`、`control 2`、`evolve 5`、`assembly 1`；实测正好 13 / 2 / 5 / 1——**四个域平面全部顶格**。目录文件上限 25：`apps/daemon/src/cli` 直属 22 个（未顶格），`apps/daemon/test/engine` 直属 **25** 个（顶格）；guard 的 `scopeDirs` 覆盖 `apps/*` 与 `packages/*` 的 **src 与 test**，因此测试目录受同一 25 件约束。根 `typecheck` 只 `include` src（79-D10）是**另一件事**：它管类型门禁覆盖，不管目录预算。

〔结论〕目标结构新增文件的落点只能是**子目录**，且子目录自身不得超 25 件。域平面基线“只减不增”：把 `engine.ts` 拆件时，新文件进 `engine/tick/`、`engine/dispatch/` 等子目录，不得在 `engine/` 直下新增文件；拆完腾出的平面名额也不得被新功能占用。新增测试同样只能进 `test/engine/<子域>/`，不得在 `test/engine/` 直下加第 26 个文件。

### 2.3 横向允许边与两处已登记的错位

〔事实〕**38 条** `allowedPackageEdges`（含 boot 三条）。与现状对照，四处需要说明：

| 边 | 现状 | 判定 |
|---|---|---|
| `daemon → api` | 目标态**在用**：`apps/daemon/src/assembly/api/assemble.ts`（assembly 域）导入 `@studio-next/api` 并在 `runServe` 内装配（§9.4 装配决策）。现状 `src` 零 import（骨架期） | 〔结论〕保留为**真实边**，不再是休眠边；不得“删边后再调用”。装配点在 **assembly 域**而非 `cli`，因此不新增 `assembly→cli`、也不需要 `cli` 反向被 assembly 依赖；`daemon → api` 与 `daemon → panel` 并存不冲突（前者是 :8788 的新家，后者是 :8791/:8789） |
| `daemon → prompt` | `engine/prompt-assembly.ts:39` 实际 import | 〔事实〕在用边。79-§10 把它与 api/yt 并列为“休眠”是文档漂移，应更正为“在用” |
| `daemon → yt` | 无 `src` import | 〔事实〕休眠边，同上 |
| `panel → company` | `panel/src/external/server.ts:45`、`overview/reports.ts:29`、`overview/server.ts:59` 实际 import `SLUG_RE` / `parseJobOps`；但 `company` 只在 `devDependencies` | 〔事实〕**清单与代码不一致**：运行时用 devDependency |

〔结论〕`panel → company` 按 79-§10.1 的裁决处理：**移入 `dependencies`**。理由：

1. 它是**运行时** import，生产安装缺包即崩；分类错误必须修，不能靠 dev 安装掩盖；
2. 依赖分类只改 manifest 与安装面，**不改变运行加载面**——`panel` 早已在运行时加载该模块，移到 prod 只是把事实写进清单；
3. 不以“下沉 `SLUG_RE`/`parseJobOps`”为默认方案：那会改动跨包公共标量的归属，属横向表变更语义，须另走提案。若将来确要下沉，必须先证明 `panel` 不再 import `company`，再按提案删边。

〔结论〕`daemon → api` 的**处置已定**（§9.4）：保留并在迁移中转为真实调用；不设删除条件，也不再作为“休眠边待删”登记。`daemon → yt` 仍是休眠边——`wirePlatform` 若不再选 yt 实现才可提案删。

### 2.4 包层目标语义的补充原则

〔结论〕“保留有效包层并补语义”的判定标准：

1. **不动的包**：`localplatform`、`yt`、`taiga`、`matrix`、`dsh-bridge`、`adapters` 的**实现**不动，只在端口侧补 `PlatformBinding` / `ExecutorAdapter` 的目标签名；平台包唯一新增的是 `src/binding.ts` 里**纯数据/纯函数**（`bindingProfile()`/`mapState()`/`lossReport()`）——**不实现完整端口**，宿住在 `assembly/platform/binding.ts`（§6.6 BIND-01 三层）；
2. **加职责的包**：`store` 加 `RecordTransaction`、`api` 加 `:8788` 全部端点、`gateway` 加 `EffectGateway` 的凭据/围栏/对账三段——加职责不加包；
3. **减职责的包**：`panel` 交出 `:8788`；`company` 的 `repo-validate` **不下沉**——字节/路径/归档/纯配置校验留 `company`（超限件在本包内拆件），下沉的只是“规则求值”这一层，落 `core`（`RuleEvaluator` 纯函数），两者的输入/输出边界在 §6.1 划清；
4. **零新包**：`spec`、`engine`、`runtime`、`records`、`memory` 都不建包；它们的语义落在 `contract`（类型）+ `core`（纯函数）+ `store`（表）+ `daemon`（编排）。

---

## 三、入口、组合根与配置

### 3.1 入口与装配点的职责划分

〔事实〕现状入口有三类，另有一个装配点：

| 入口 | 文件 | 现状 | 目标（75-D75-11 收敛方案，无备选） |
|---|---|---|---|
| 公共 CLI | `apps/daemon/src/cli/main.ts` | 完整（18 命令 + 别名 + typo 提示 + `process.exitCode` 收尾） | **唯一**命令分发入口；`bin` 只指它 |
| daemon 包根 | `apps/daemon/src/index.ts` | 36 行横幅 + `exit(0)`；包 `main` 与 `exports["."]` 都指它 | 过渡为**无副作用、仅再导出 `assembly/serve.ts`**；无消费者后退役 |
| 组合根 | `apps/boot/src/boot.ts` | `bootServe()` 登录 Matrix 并注入四面 | 保持组合根身份；目标态改为**只构造 `matrixSessionFactory`**（与 `notifyBroadcast` 一并经 `RunServeOpts` 传入），登录与 token 归 daemon（§3.4 第 10 条）；可注入更多“部署侧能力”，仍不改事实源 |
| 对外 API 装配（assembly 域） | `apps/daemon/src/assembly/api/assemble.ts` | 无此件；`:8788` 现由 `cli/external` 起 `panel` 的 `serveExternal` | 由 `runServe` 在**同一 daemon 进程内**调用：装配内构造 HTTP 适配（`api/src/http`）、`company` 纯投影、只读台账（`openLedgerReadonly`）、`emitIntent`/`getIntentReceipt`（**转发 `IntentIngress.submit`/`receipt`**，不直引 `engine.ingest`）；**API 不自起进程、不自立 bin**（§9.4） |

〔结论〕四者不得互相替代：

- `cli/main.ts` 不是组合根：它按命令构造参数、调用 `runServe` 或一次性命令，**不持有**运行栈；
- `boot.ts` 不是第二事实源：它只把“部署侧才有的能力”（网络客户端、频道面、**登录工厂**）注入 daemon，**不递任何秘密原值**、**不读台账、不写公司目录、不决策**；秘密解析与登录都在 daemon 进程内（§3.3 第 6 条、§3.4 第 8/10 条）；
- `index.ts` 不得 import `cli`，也**不得 import `engine`**（`root→engine` 不在 `allowedVerticalEdges` 内）；它只能 import `assembly/*`，且不得在 import 时执行 IO。
- `assembly/api/assemble.ts` 是 `:8788` 的**装配点**（assembly 域，`daemon→api` 合法）：它在 `runServe` 内被调用，构造端口/令牌/只读台账/`emitIntent` 并交给 `api`；`api` 只提供 `createApiApp`/`serveApi`，不自己读配置、不自己开库。把装配搬进 `api` 会让 `api` 反过来依赖 daemon 的引擎与台账装配面，等于再造一个组合根——不得如此。`cli/external` 不再拥有装配权：它**最终退役**，或只打印“请用 `studio-next serve`”的迁移指引，**不得独立启动触发面**。`assembly` 不得 import `cli`（会新增 `assembly→cli` 边）。

〔事实〕仓内当前**没有**包根消费者：boot **运行时**只用 `@studio-next/daemon/serve`（`runServe`），不经 `"."`，也不 import `@studio-next/daemon/engine`；`/engine` 仅出现在测试面（`boot.test.ts:23` 的 `checkMentionPayload`，同样须经 `exports` 映射而非相对路径）。因此删除 `main`/`exports["."]` 不会破坏现有调用；这一步是**防未来误用**，不是修一个已在发生的故障。

### 3.2 `src/index.ts`：唯一收敛方案（不再保留备选）

〔选择〕按 75-D75-11 收敛为**单一方案**，不留备选：

```ts
// 过渡期 index.ts（伪签名，非实现）：仅再导出装配面，无副作用
export { runServe, parseDaemonConfig, DEFAULT_SERVE_CONFIG } from './assembly/serve.ts'
export type { ServeConfig, ServeRuntime, ServeResult } from './assembly/serve.ts'
```

四条硬约束：

1. **只引 `assembly/*`**：`root→assembly` 是唯一合法纵边；**不得**从 root 导出 `engine`（`root→engine` 违例），也不得 import `cli`（`root→cli` 违例）。需要引擎类型的消费者走包内子路径 `@studio-next/daemon/engine`，不走包根。
2. **无副作用**：模块顶层不得读配置、开库、登录、`process.exit`；过渡期 `index.ts` 只是再导出。
3. **包根退场**：删除 `apps/daemon/package.json` 的 `main` 与 `exports["."]`；保留 `./engine`、`./serve` 两个子路径导出。删除理由是防未来误用（现无包根消费者，见 §3.1），不是修现存故障。
4. **入口脚本改指 CLI**：根 `package.json` 的 `"daemon"` 改为 `node apps/daemon/src/cli/main.ts serve`，`apps/daemon` 的 `scripts.start` 同步改；`bin` 保持指 `cli/main.ts`。

〔结论〕迁移顺序（不可倒）：

1. 先删 `main`/`exports["."]` 并改根 `daemon` 脚本——此时 `index.ts` 已不是任何人的入口；
2. 再把 `index.ts` 收敛为上面的纯再导出；
3. 最后在确认全仓零 import 包根后，**退役 `index.ts`**（`daemonSrcRootFiles` 只允许 `index.ts` 这一散文件，退役后根平面为空格，须同步改 guard 的基线——属提案流）。

〔结论〕顺序不可倒：先改 `index.ts` 会让过渡期同时存在“有副作用”和“被当 API”两种读法；先删包根则一步切断误用面。

### 3.3 `ServeConfig`：唯一类型

〔事实〕`ServeConfig` 定义在 `apps/daemon/src/assembly/serve.ts:147`，`extends HrServeConfig`（`assembly/hrsync/config.ts`），约 60 个键。`DEFAULT_SERVE_CONFIG`（`:371`）逐键给缺省。`parseDaemonConfig`（`:427`）是零依赖扁平 YAML 子集解析，`coerceServeConfig`（`:456`）做类型收窄与交叉校验。

〔结论〕`ServeConfig` 必须是**唯一**配置类型：

1. 不得出现 `ServeConfig` 的影子类型（如 CLI 自己再解析一遍 `daemon.yaml` 得到 `{db, company, ...}`）；
2. `boot` 不得重造解析器——`boot.ts:336` 已按此纪律调用 `parseDaemonConfig` 后透传 `runServe`，保持；
3. `HrServeConfig` 是子面而非第二类型：它的键经 `extends` 收平进 `ServeConfig`，不得在引擎侧再定义一个 `HrConfig` 并做二次映射；
4. 新增键必须同时给：缺省值（或“必配”声明）、交叉校验位置、开关关闭时的零行为证明、81 的文件归属。
5. `ServeConfig.external` 的目标键集固定为 `enabled / port / lan / token / requestsPerMinute / idempotencyTtlMs / allowedSources`：`enabled=false`、`port=8788`、`lan=false`、**`allowedSources=['external-api']`** 为缺省；开启时 `token`（部署秘密引用）、`requestsPerMinute`、`idempotencyTtlMs` **必配**：缺任一 / 空串 / 非正整数 ⇒ `CONFIG_INVALID` **整机拒启动**，**没有**“未配 `token` = 触发面全 401”的降级运行态（缺件拒启与 401 不是同一条路：401 只判“请求带来的令牌不对”）。`now` **不是** `ServeConfig.external` 的 YAML 键，只能是 `BuildRuntimeOpts` 的测试/运行时钟注入（`buildServeRuntime({ clock })`），配置面不出现该键。
   - **`allowedSources` 是外部入口的来源白名单**（不是 `SourceRegistry` 的影子、也不是秘密）：**缺省恰为 `['external-api']`**，**不得**缺省成 `['*']` 或据此放行未知来源。校验**只管形状**（`coerceServeConfig`）：值是数组、元素为非空字符串、逐项匹配 `^[a-z][a-z0-9-]{1,63}$`、无重复项；非数组 / 含非字符串 / 含非法格式 / 含重复项 ⇒ `CONFIG_INVALID` **拒启动**。**显式空数组同样 `CONFIG_INVALID` 拒启动**——不是“触发面全 403”的运行态，也不是“空 = 全放行”；必然全拒的触发面没有合法部署含义，属配置错误（与 16 卷同口径，不保留第二种读法）。启动期**不**判“来源名是否已知”（来源只与请求相关，未知格式已在形状面被拒）；**每次请求**的来源必须在表内，否则 `rejected_forbidden`（403），**不经 `SourceRegistry`**（§6.6）。
   - 关闭时（`enabled=false`）**不读该键、不校验、零行为**：非法值不影响启动，该面整体不挂载。
   - 81 归属：`ServeConfig`/`DEFAULT_SERVE_CONFIG` 在 `apps/daemon/src/assembly/serve.ts`（81-files/17）。
   - 键集、缺省、交叉校验、关闭时零行为与 81 归属必须同时登记，未登记键拒收。
6. `ServeConfig.secrets` 是**秘密供给的唯一配置面**（不是第二套 catalog）：键集固定为 `catalog / fileRoot / brokerBinding`。`catalog` 为 `SecretCatalogEntry[]`、**缺省 `[]`**（= 未声明任何秘密，`known-set-empty` 合法）；`fileRoot` 可选，是**部署相对路径根**（`file-ref` 的解析根，代码里不得写死绝对路径，§11.3）；`brokerBinding` 可选，登记外部代理的**已注册绑定名**（不是句柄、不是凭据）。
   - **拒收规则（`coerceServeConfig`，不是运行期才炸）**：出现**秘密值**（任何以 `value`/`secret`/`password`/`token` 为键的内联串）、未登记键、`catalog` 元素缺必填字段（`secretId`/`kind`/`subjectScope`/`allowedUses`/`valueProvider`/`rotationRef`/`revocationRef`）、`secretId` 重复或不合 `SEC-<域>-<slug>` ⇒ `CONFIG_INVALID` **整机拒启动**。配置面**只放引用**，值只活在 daemon 进程内存（§11.2.1）。
   - **参考实现只支持三种 `valueProvider`**：`env-ref` / `file-ref` / `local-mint`（后者仅 per-ticket wkey 的例外项）。`broker-ref` 只有在 `secrets.brokerBinding` 指向**已注册**的部署绑定、且该绑定能解析出 `secretId` 时才可用；**无绑定或绑定未注册 ⇒ 该条 `load` 一律 `unavailable`**，按“可选缺失 ⇒ 不装配该能力 + 落 `REC-LOSS-01`；必需缺失 ⇒ 拒启动”处置，**不得**假装支持 broker（不得返回空值、不得退回 env 猜一个）。
   - **能力关闭与范围外不加载**：`external.enabled=false`、Matrix/HR 面关闭、或某 `secretId` 的 `subjectScope` 不覆盖本部署时，**不调用 `load`、不构造 `KnownSecretSet` 元素**（关闭的能力不因“顺手加载”把秘密带进内存）；`enabled=false` 时该键的非法值不影响启动，但 `enabled=true` 时缺件/非法即拒启动。
   - 81 归属：`ServeConfig.secrets` 的类型与缺省随 `ServeConfig` 落 `apps/daemon/src/assembly/serve.ts`；`SecretCatalogEntry` 类型在 `contract/src/ports/secret.ts`（§11.2.1），配置面只引用、不重定义。

〔事实〕`parseDaemonConfig` 只收扁平 `key: value`。**现状确实抛裸 `Error`，不是 `ClassifiedError`**：`serve.ts:433`（非扁平行）、`:436`（value 为空）、`:439`（嵌套/列表），都在 `:434`–`:442` 这段内，消息里带行号与原行。裸 `Error` 不带 `category`/`subcause`，调用方只能靠文案判类——这是要修的目标，不是现状已满足。目标态改为经 `configInvalid(...)` 抛 `ClassifiedError`，`subcause` 取稳定名（如 `config-yaml-nested`），消息与 `subcause` 分开承载（消息给人、`subcause` 给机器）。

〔事实〕`CONFIG_INVALID` 是**类型化的 `category`**（`kernel.ts:85`–`:95` 的 11 值之一），不是消息文案。文档与日志不得把 `CONFIG_INVALID` 当成人读的错误说明。真 YAML（`yaml@2` 带行号）未接。

〔结论〕在真 YAML 装载接入前，**不得**用 `JSON.parse` 或 `process.env` 旁路补配置；也不得让 CLI 用 `--key=value` 覆盖未登记键。

### 3.4 `RunServeOpts`：已存在的唯一来源（补通知面与 Matrix 会话工厂）

〔事实〕命名类型**已经存在**：`apps/daemon/src/assembly/hrsync/run-serve-opts.ts:17` 的 `export interface RunServeOpts`，含三键：`matrixSource?`、`matrixRoomFace?`、`hrMatrixFace?`，**缺 `notifyBroadcast`**。当前只有 `apps/boot/src/boot.test.ts:26` 引用它。

〔事实〕三处使用面尚未收口到该类型：

| 位置 | 现状 | 与 `RunServeOpts` 的差 |
|---|---|---|
| `runServe` 第二参数（`serve.ts:1445`–`:1468`） | 内联匿名类型 | 是 `RunServeOpts` 现有三键的**超集**（多 `notifyBroadcast`），但类型身份重复 |
| `buildServeRuntime` 第三参数（`serve.ts:884`–`:923`） | 内联匿名类型 | 已含 `RunServeOpts` 的四键（三键 + `notifyBroadcast`），另加 `log/clock/quarantineMs/hrKnownSecrets/evolveSelfCheck`（装配件与测试注入，不是部署注入） |
| `BootOptions.serve`（`boot.ts:68`–`:75`） | 内联匿名类型 | 只有 `matrixSource/matrixRoomFace/notifyBroadcast`，**缺 `hrMatrixFace`**；而 `bootServe` 实际会传 `hrMatrixFace`（`boot.ts:370`–`:375`）——**类型与调用已漂移**（对象展开绕过多余属性检查，编译不报错），属缺陷 |

〔结论〕按 75-D75-11 收口：

1. **`RunServeOpts` 是唯一部署注入类型**，在 `run-serve-opts.ts` 内**补两个键**：`notifyBroadcast?: NotifyBroadcastFace`（既有裁决）与 `matrixSessionFactory?: MatrixSessionFactory`（本节第 10 条；工厂类型按**结构**定义，见下）。
2. `runServe(configPath, opts?: RunServeOpts)` 直接引用它，不再写匿名类型；
3. `buildServeRuntime` 的入参命名为 `BuildRuntimeOpts`，定义为 `RunServeOpts & { log?; clock?; quarantineMs?; hrKnownSecrets?; evolveSelfCheck? }`（装配/测试注入与部署注入分开命名，但**不复制** `RunServeOpts` 的键）；
4. `BootOptions.serve` 用 `Pick<RunServeOpts, 'matrixSource' | 'matrixRoomFace' | 'notifyBroadcast' | 'hrMatrixFace' | 'matrixSessionFactory'>` 或直接 `RunServeOpts`，不得另抄第三份；缺 `hrMatrixFace` 是现状缺陷，收口时一并补齐；
5. `cli serve` 当前**不传 opts**——这是“核心无注入面”模式：不接 Matrix/HR/notify，主循环与平台面照常工作。该模式必须保留为合法缺省，不得因收口类型而要求 CLI 伪造注入。
6. **再导出唯一目标：`@studio-next/daemon/serve`**。现状 `apps/boot/src/boot.test.ts:26` 用**相对路径**`../../daemon/src/assembly/hrsync/run-serve-opts.ts` 直接取 `RunServeOpts`——这绕过了 `apps/daemon/package.json` 的 `exports` 映射（`"./serve": "./src/assembly/serve.ts"`），是跨包“相对路径穿透”，一旦 `serve.ts` 拆分即断。目标：`assembly/serve.ts` **再导出** `export type { RunServeOpts } from './hrsync/run-serve-opts.ts'`（或把定义直接搬进 `serve.ts` 的公共面），boot 侧改为 `import type { RunServeOpts } from '@studio-next/daemon/serve'`。**不得**在 boot 新增第四条包边，也不得让 boot import `daemon/engine`（那是测试才有的用法；boot 运行时的 daemon 侧导入**只有** `daemon/serve`）。
7. **`configPath` 与已解析 `Config` 不得双读**：现状 `bootServe` 先 `parseDaemonConfig(readFileSync(options.configPath))`（`apps/boot/src/boot.ts:336`）再 `runServe(options.configPath, …)`，而 `runServe` 内部又 `parseDaemonConfig(readFileSync(path.resolve(configPath)))`（`apps/daemon/src/assembly/serve.ts:1470`）——同一份 YAML 被解析两次，两次之间文件可被改写，于是“boot 按 A 装配 Matrix 面、daemon 按 B 起主循环”是可发生的。目标：`runServe` 接受判别联合 `{ configPath: string } | { config: ServeConfig }`（**二选一，不得同时给**）；boot 传 `{ config }`，CLI 传 `{ configPath }`。`parseDaemonConfig` 仍是唯一解析实现，位置不变。

   **`matrixDeptMap` 的基准目录（`baseDir`）归属写死**：`matrixDeptMap` 是**部署配置里的文件路径**，消费方是 **boot**（`loadDeptSlugs` → 供给/广播面），daemon **不读**该文件，因此 `baseDir` 属于**组合根 boot 的显式入参**，不进 `RunServeOpts`、不新增第三个键：

   - **`{ configPath }` 分支（CLI）**：`baseDir = dirname(resolve(configPath))`——以**配置文件所在目录**为基准，**不是** cwd；`resolve` + `realpath` 后过 containment（§11.3 第 1、2 条），逃逸判 `rejected_forbidden` + `EXTERNAL_REJECT`。
   - **`{ config }` 分支（boot 生产路径）**：没有路径可推，`baseDir` 必须由组合根**显式解析后传入**——`BootOptions.deploymentBaseDir: string`（boot 自有类型，**不传 daemon**），由部署绑定给定并已在 boot 侧 realpath/containment 过；缺省**不得**回落到 `process.cwd()`。
   - **只读一次、派生一次**：boot 在 `bootServe` 内把 `loadDeptSlugs(matrixDeptMap, baseDir)` 的结果算**一次**，同一对象交给供给面与广播面（现状 `boot.ts:239` 与 `:285` 各读一次是缺陷）；**不得**为取 `matrixDeptMap` 再解析一次 YAML，也不得让 daemon 侧第二次读配置来补这个基准。
   - **失败语义**：`matrixDeptMap` 缺失/越界/文件不可读 ⇒ `CONFIG_INVALID` 拒启动，消息只带**键名**（`matrixDeptMap`）与 `err.code`，不带绝对路径（§11.6）。
8. **不新增 `BuildRuntimeOpts.secretProvider`，也不新增同作用的任何"值是秘密"的注入项**：秘密供给面（§11.2.1）的 provider 由 daemon 内部按 `ServeConfig.secrets` 装配（部署 provider → `SecretMaterial[]` → `KnownSecretSet`），**不是** `BootOptions`/`BuildRuntimeOpts` 的注入项。原因：注入项会变成第二条“谁能给进程喂秘密值”的通道，且 boot 一旦持有 provider 就能取任意 `secretId` 的值，违反“值只在 daemon 进程内存”（§11.2.1 末）与“boot 不代存凭据”（本卷 §0）。测试需要假 provider 时，用 daemon 内部工厂的**测试注入点**（不进公共面）。**与之对照**：`matrixSessionFactory`（第 10 条）只传**行为**（登录函数），不传值、不传 provider，因此可以注入。
9. **boot 的包导入面（事实）恰为三条**：`apps/boot/src/boot.ts` 的包导入为 `@studio-next/contract`（类型）、`@studio-next/daemon/serve`、`@studio-next/matrix`，与 §2.1 登记的三条出边一一对应；**不许**出现 `@studio-next/api`、`@studio-next/store`、`@studio-next/panel` 的导入。`matrix` 这条边的用途收窄为**构造 `matrixSessionFactory` 并把工厂交给 daemon**（第 10 条），boot 自身**不登录、不取 token、不存密码**；`daemon/serve` 是 boot 唯一的 daemon 侧运行时导入（`boot.test.ts` 额外 import `@studio-next/daemon/engine` 属**测试面**，同样必须经 `exports` 映射而非相对路径）。

10. **Matrix 会话由 `RunServeOpts.matrixSessionFactory` 注入（部署工厂，不是 `SecretProvider`）**：它和 `notifyBroadcast` 是本轮**仅有的两个新键**（分别对应第 1 条的两项），除此之外 `RunServeOpts` 不再加键。

    ```ts
    // 定义在 apps/daemon/src/assembly/hrsync/run-serve-opts.ts（RunServeOpts 的家）。
    // 返回形状**逐字段等于现有四个注入项**——不是“已构造好的面”，而是四个工厂/面本身：
    //   matrixSource    : () => InvokeSource                       （contract 的 InvokeSource）
    //   matrixRoomFace  : (ctx) => MatrixRoomFace                  （engine/rooms/room-duty.ts，含 MatrixRoomFaceContext）
    //   hrMatrixFace    : () => MatrixHrFace                       （engine/hrsync/hrsync.ts，**不是** MatrixRoomFace）
    //   notifyBroadcast : NotifyBroadcastFace                      （engine/notify/broadcast.ts）
    // 这些类型都在 daemon 内或 contract 内；**不新增 daemon→matrix 包边**。
    // 两个**逻辑秘密类型**：判别位写死，不能互换（bot 密码不得用来建 HR 账号，反之亦然）
    interface MatrixBotLoginSecret {               // 登录句柄：唯一允许驱动 bot 登录的秘密
      readonly kind: 'password'                    // 判别位：与 SecretMaterial.kind 同值
      readonly secretId: 'SEC-MX-BOT-PASSWORD'     // 字面量：只接受这一条
      readonly use: 'platform-auth'                // 登录**只**取这个槽位
      readonly material: SecretMaterial            // 值只在此字段；不进日志/快照/持久化/PRM
    }
    interface MatrixHrRegisterSecret {             // 建号句柄：HR 共享秘密，**不是** bot 密码
      readonly kind: 'shared-secret'
      readonly secretId: 'SEC-MX-HR-SHARED'        // 字面量：只接受这一条
      readonly use: 'matrix-register'              // 建号**只**取这个槽位
      readonly material: SecretMaterial
    }
    interface MatrixSessionFactoryDeps {
      homeserverUrl: string
      botUserId: string
      login: MatrixBotLoginSecret                  // 必填：bot 登录（platform-auth）
      registration?: MatrixHrRegisterSecret        // 仅“建号能力开启”时给（matrix-register）；缺失即拒启动该能力
      userAgent?: string
    }
    type MatrixSessionFactory = (deps: MatrixSessionFactoryDeps) => Promise<{
      matrixSource: () => InvokeSource
      matrixRoomFace: (ctx: MatrixRoomFaceContext) => MatrixRoomFace
      hrMatrixFace: () => MatrixHrFace
      notifyBroadcast: NotifyBroadcastFace
      close(): Promise<void>                      // 停机时由 runtime.stop 调用，先于 ledger.close
    }>
    ```
    - **主体：daemon 驱动工厂登录**。启动装配期由 daemon 按 `ServeConfig.secrets` 载入 `SEC-MX-BOT-PASSWORD`（只取 `use='platform-auth'`，构造 `MatrixBotLoginSecret`），**仅当建号能力开启时**再载入 `SEC-MX-HR-SHARED`（取 `use='matrix-register'`，构造 `MatrixHrRegisterSecret`）——两者是**两份不同秘密、两个不同句柄**，不得用 bot 密码建 HR 账号，也不得用 HR 共享秘密做登录。构造完句柄后调 `matrixSessionFactory({ homeserverUrl, botUserId, login, registration?, userAgent? })`；**登录动作由工厂实现，调用时机、超时、失败处置与 `close()` 生命周期归 daemon**。daemon 不自行拼客户端，也不把 access token 取出到 daemon 状态。
    - **建号缺失即拒该能力**：`hrMatrix`（建号）能力开启而 `registration` 句柄拿不到（未配 `SEC-MX-HR-SHARED`、`allowedUses` 不含 `matrix-register`、或 provider 返回 `Err`）⇒ 该能力 `CONFIG_INVALID` 拒启动，**不得**退回用 bot 密码建号、也不得“先不建号跑跑看”。
    - **句柄校验（不降级）**：daemon 传入前已核 `login` 的 `secretId === 'SEC-MX-BOT-PASSWORD'`、`kind === 'password'`、`use === 'platform-auth'`；`registration`（若给）的 `secretId === 'SEC-MX-HR-SHARED'`、`kind === 'shared-secret'`、`use === 'matrix-register'`；且两处 `material.secretId`/`material.kind` 与句柄判别位逐字段一致。工厂内**再复核**同一组条件。任一不符 ⇒ 该能力拒启动（`CONFIG_INVALID`，`failure` 按结构/前提归类），**不得**换用途、换条目、把 HR 秘密塞进 `login` 或退回 env 猜值。明文只出现在 `material.value` 内，**不得**写入 deps 日志、快照、任务书或任何持久面。
    - **boot 不参与登录**：boot 只构造工厂并传入（`options.serve.matrixSessionFactory`），不驱动登录、不解析秘密、不持 token、不落盘。会话 access token 仍**只在 client 实例内存**，无静态 `secretId`、不进帧/日志/PRM（§11.2.1）。
    - **兼容面（二选一，不判“矛盾”）**：现有四个面的**直接注入**保留为**测试/迁移兼容**（不删）。规则只有一条：**`matrixSessionFactory` 与任一直接面同时出现 ⇒ `CONFIG_INVALID` 拒启动**——“两者是否矛盾”不可判（工厂要登录后才产出面，启动期无法比较），所以**不做比较**、也不得择一静默；单独给面（测试/迁移）或单独给工厂（生产）都合法。工厂路径下启动日志记一条“工厂路径”（只记路径类型，不记值）。
    - **开而未注入**：Matrix 相关能力开启（`matrix.enabled`/`hrSync`/`hrMatrix`）但既没直接给面、也没给工厂 ⇒ `CONFIG_INVALID` 拒启动；能力关闭 ⇒ 不调工厂、不 `load` 密码（`secrets` 侧同样不加载，见 §3.3 第 6 条）。工厂抛错或返回形状不合 ⇒ 该能力拒启动（`CONFIG_INVALID`/`unavailable`，按失败面归类），不得降级成“没有 Matrix 面照跑”。

〔结论〕缺省语义写进类型注释（五种，不得靠读实现猜）：

| 注入 | 配置开 | 配置关 | 开而未注入 |
|---|---|---|---|
| `matrixSource` | 需要 | 不调用 | `CONFIG_INVALID` 拒启动（`serve.ts:1249`） |
| `matrixRoomFace` | 需要 | 不调用 | `CONFIG_INVALID` 拒启动 |
| `hrMatrixFace` | 需要（`hrSync`+`hrMatrix`） | 不调用 | `CONFIG_INVALID` 拒启动 |
| `matrixSessionFactory` | 生产路径**必须**（与上面四面**二选一**：要么给面、要么给工厂） | 不调用、不 `load` 密码 | `CONFIG_INVALID` 拒启动；**与任一直接面同时出现即拒**（不判“矛盾”——那不可判）。**boot 只构造并传入，不参与登录**；登录由 daemon 驱动，返回四个工厂/面本身 + `close()`（第 10 条）；`login` 只收 `SEC-MX-BOT-PASSWORD`/`platform-auth`，`registration` 只收 `SEC-MX-HR-SHARED`/`matrix-register`（缺失即拒该能力） |
| `notifyBroadcast` | 可选 | 面关零行为（v0 日志出口保留） | **面关零行为**，不拒启动 |

〔事实〕`apps/boot` **没有 `bin`、没有启动 script**（`package.json` 只有 `typecheck`/`test`）；它是被调用的库。本卷不虚构“boot 启动入口”。

### 3.5 三类配置与“禁止从路径推授权”

〔结论〕76-§2 的 `DEF-CFG-01` 三类配置在 TS 侧落为：

| 类别 | 承载 | 方向 | 示例 |
|---|---|---|---|
| 部署配置 | `ServeConfig`（`daemon.yaml`）+ env | 只收紧，不放宽 | `tickMs`、`db`、`platform`、`matrixHomeserverUrl` |
| 公司定义 | 公司 git 目录 → `CompanySnapshot` | 组织/人事/章程/流表 | `departments`、`people`、`workflows`、`hooks`、`costGuard` |
| 框架配置 | `ENGINE_CONFIG_DEFAULTS` / `DEFAULT_SERVE_CONFIG` / 包内常量 | 提供缺省，不覆盖公司定义 | 并发闸缺省、`killGraceMs` |

三条禁令：

1. **禁止从路径推授权**：`fileWatchPath: /etc/...`、`companyDir: /root/...` 不得因为“路径可读”就被当作有权读；路径只决定“读哪里”，不决定“能否读”。授权来自 `ServeConfig` 的显式开关 + 部署档案（78）。
2. **禁止从目录推断公司身份**：`company` 键是 slug，不得从 `companyDir` 末段自动推出并写台账。
3. **禁止 env 覆盖公司定义**：env 只供秘密与部署开关（`MATRIX_BOT_PASSWORD`、`TAIGA_TOKEN`），不得用来改 `people`/`workflows`。

〔事实〕当前 `coerceServeConfig` 里存在“`platformDir` 缺省 = `<rootDir>/platform`”“`aiwsRoot` 缺省 = `dirname(companyDir)/.AIWS`”这类推导（`serve.ts:156`–`:164` 注释）。这些是**路径推导的缺省值**，不是授权推导，可以保留；但一旦推导结果落在公司目录外，必须在启动日志明示实际路径（现状 `:1544` 已打印 LocalFile 根）。

### 3.6 启动与停机序列（目标态）

〔结论〕目标启动序列固定为 10 步，任一步失败即 `exit 1` 并给 `CONFIG_INVALID`/具体分类；已开的句柄必须先按停机序关闭，不得带半个 API 面退出：

| 步 | 动作 | 现状锚 | 失败面 |
|---|---|---|---|
| 1 | 读 `daemon.yaml` → `parseDaemonConfig` | `serve.ts:1470` | 行号 + 原行 |
| 2 | 开台账 + migrate | `openLedger`（`serve.ts:1471`） | 建库失败即抛；迁移须独占（§8.2 D12） |
| 3 | 在途接管（`work_records.running` → `interrupted`） | `takeOverRunningWorkRecords`（`:1476`） | 接管≠收割，无证据不判 |
| 4 | 装载公司目录（可选）→ `loadCompanyDirectory` | `:1495` | 校验不过**拒绝启动**并列 `file:line [rule] fix` |
| 5 | 平台启动探针（`platform: taiga`） | `:1508` | 只读 `fields.schema()`，四层任一不通即拒 |
| 6 | 装配运行栈 `buildServeRuntime`：engine 已创建；**同一步用 `createIntentIngress(deps)` 创建 `IntentIngress`**（`deps` = `IntentIngressDeps`：`intake`/`engine:{ingest}`/`receipts`/`allowedSources`/`ttlMs`/`isCompanyMounted`/`bodyLimitBytes?`/`log`，§6.6）。工厂返回**内部类型** `IntentIngressInternal`（`submit`/`receipt` + `replayQueued`），由 `buildServeRuntime` 自己持有；**暴露给装配体/HTTP 的只有 `Pick<IntentSubmissionPort, 'submit' \| 'receipt'>`**。本步内顺序固定：**秘密面/会话面装配 → `receipts.rebuild()` → 启动末 `replayQueued()`**；`rebuild` 失败 ⇒ **拒启动**（§6.6 第 9 条），`replayQueued` 只在重建成功后跑，带 `gap:'unknown-link-missing'` 的行不在重放集内；**`rebuild` 必须先于第 7 步的 API 装配**——重建完成前不得有 `receipt()` 可服务 | `:1521` | 注入缺失=拒；ingress 创建失败即拒启动；`rebuild` 失败=拒启动（不得带空投影起服） |
| 7 | 若 `external.enabled`：`assembly/api/assemble.ts` 装配并 `serveApi`；`apiHandle.close` 注册进 `runtime.stop` | §9.4（目标） | 缺 `ingress`/只读台账=拒启动；先停已开句柄再抛 |
| 8 | 唤起源 `sources.startAll(emit → engine.ingest)` | `:1553` | 单源异常隔离计数 |
| 9 | 循环 `engine.tick()` + 拍边界 | `:1558` | tick 抛错 → `stopReason='error'` |
| 10 | `runtime.stop()` 内依次：`sources.stopAll()` → `apiHandle.close()` → `engine.dispose()` → `ledger.close()` → 回执 | `:1399-1404`（目标插入 API 关闭） | 台账落盘；`work_records` 留 `running` 待下次接管 |

`external.enabled=false` 时第 7 步完全不启动监听、没有 API 句柄，关闭动作是无操作；engine 与 `IntentIngress` 都在第 6 步创建，因此第 7 步注入的 `emitIntent`（原样转发 `ingress.submit`）不会引用尚未装配的引擎，也**不直接持有 engine**。API 的关闭必须先于 engine drain 与台账关闭，不能在 ledger 已关后才调用。

〔结论〕第 6 步同时是**秘密面与会话面**的装配点（目标态）：先按 `ServeConfig.secrets` 的 catalog 与当前启用能力裁剪后解析 provider，得到 `KnownSecretSet`（§3.3 第 6 条、§11.2.1）；再由 **daemon 驱动工厂登录**——用 `SEC-MX-BOT-PASSWORD` 构造 `MatrixBotLoginSecret`（`secretId` + `kind:'password'` + `use:'platform-auth'` + `SecretMaterial`）后调 `RunServeOpts.matrixSessionFactory`，建号能力开启时再构造 `MatrixHrRegisterSecret`（`use:'matrix-register'`）一并传入，拿到的是**四个工厂/面本身**（`matrixSource`/`matrixRoomFace`/`hrMatrixFace`/`notifyBroadcast` + `close()`，形状见 §3.4 第 10 条），不是已构造好的 source/room 面；登录动作由工厂实现，调用时机/超时/失败处置/`close()` 归 daemon（boot 只构造并传工厂，不参与登录、不取 token、不存密码，§3.4 第 10 条）；两者完成后才创建 `IntentIngress` 并 `receipts.rebuild()`。能力关闭时不加载对应秘密；`broker-ref` 无绑定按 `unavailable` 处置；任一必需秘密缺失则**该能力拒启动**，不得带半个能力面进入第 7 步。

〔事实〕第 3 步在第 4 步之前：台账先接管，公司目录后装载。这是有意的——接管是纯台账面零平台 IO（`:1475` 注释），不依赖公司快照。

〔结论〕目标态需在第 4 步与第 6 步之间插入**授权三段**的准备（`AuthorityRequirement` → `CandidateEndpoint` 目录 → `AuthorityActivation` 读取），但**不得**把“端口活着”当激活。第 6 步只组装备选端点，激活记录从台账读；无激活记录时，效果面（`EffectGateway`）必须拒写而不是降级直写。

〔结论〕该 10 步只描述 **`serve` 路径**（`runServe`）。`apps/boot` 无 `bin`/启动脚本，它不是独立入口；`cli` 的一次性命令（`init`/`validate`/`ledger` 等）不走此序列，也不得借用 `runServe` 的启动步骤。

---

## 四、公共 TS 类型映射

### 4.1 标量承载表

〔结论〕76-§1.3–§1.5 定义的标量在 TS 侧按下表承载。**本表只给承载方式，不给语义**；语义、词表与拒绝规则一律回指 76。

| TS-ID | TS 类型（目标） | 语义来源 | 现状锚 | 纪律 |
|---|---|---|---|---|
| TS-SCALAR-01 | `CompanySlug = string`、`TicketId = string`、`PersonId = string`、`AttemptNo = number` | 76-§1.3；75-§2.1 | `contract/src/ports/kernel.ts:7`–`:10` | 现状是裸 `string` 别名，不做 brand（§5.9） |
| TS-SCALAR-02 | `Qid = string`（语法 `<namespace>/<kind>/<local>`）+ 解析视图 `QidView = { text: string; namespace: string; kind: QidKind; local: string }` | 76-§1.3：namespace 一至四段 `token`、kind 封闭表、local `[A-Za-z0-9._~-]{1,128}` 大小写敏感 | 无 | **目标**。交换形状**保持字符串**，不改成对象；解析视图只在需要分段时生成，三段缺一即拒（`E-SYN-002`）。kind 封闭表必须逐值来自 76-§1.3，不得省略 namespace 或自造 kind |
| TS-SCALAR-03 | `Timestamp = string`（76-§1.2：必须带 `Z` 或 `±hh:mm` 偏移，秒必填，小数秒 ≤9 位）+ 比较视图 `TimestampView = { text: string; epochMs: number }` | 76-§1.2 | `EventRecord.ts` 是裸 `number`（`schemas/events.ts:144`） | **目标**。`text` 是权威值（偏移是词法组成）；`epochMs` 只用于比较/排序，**不得**用 `epochMs + zone` 重建或替换原始偏移。台账 `ts: number` 保留为行形态 |
| TS-SCALAR-04 | `DecimalString = string`（76-§1.2：可选负号 + **无前导零**整数部分 + 可选 `.` 与小数部分；**禁指数**；有效数字 ≤34；标度由字段声明、缺省 ≤9） | 76-§1.2、§8.1 限额表 | 无（现状金额用 `Money.usd: number`） | **目标**。不得自造更松正则（如允许前导零/指数）；金额跨进程/入库用字符串；`Money.usd:number` 仅是现状/旧记录形态，**不是**目标精确计算载体，新算术一律走 §5.11 `DecimalArithmetic`，边界转换不四舍五入 |
| TS-SCALAR-05 | `SemVer = string`（完整 SemVer，含预发布/build） | 76-§1.4；D75-09 | 无 | **目标**。不得用 `^`/`~` 范围语法进公共声明；`0.2.0-rc.2` 必须可表达 |
| TS-SCALAR-06 | `VersionRef<T> = { id: T; version: SemVer; semanticDigest: Digest }` | 76-§1.5、`REC-REF-01` | 无（现状散见 `catalog.tiers()`、`WkeyClaims.ttl`） | **目标**。`semanticDigest` **必填**（76-§1.5：版本引用必须带语义摘要）；执行计划、合同、资格、能力描述、配置、绑定六件一律用它，不引用“最新” |
| TS-SCALAR-07 | `Extension`：完整判别形状见 §4.3.1（`namespace/name/version/required/effectFace/valueShape/value/capabilityRequest?/sourceRef/schemaRef?`） | 76-§4.2、§1.6 `DEF-EXT-01` | 无（现状 `z.strictObject` 直接拒未知键） | **目标**。未知必需扩展拒收；未知可选只保留不赋义；`opaque` 只许可选的展示/别名扩展 |
| TS-SCALAR-08 | `Digest = { algorithm: string; value: string; canonicalizationId?: string; canonicalizationVersion?: string }` | 76-§1.5 三种材料 | `EventRecord.payload_hash` 是裸 `string`（`events.ts:171`） | **目标**。`semanticDigest` 必带 `canonicalizationId` **与** `canonicalizationVersion`（两者**成对**必填，缺一或只给其一即不合格），`byteDigest` 两者**都不得出现**；两者不得互替。短哈希（`sha8` 一类前 8 位截断）**只作展示与日志关联**，不得作身份、去重键、缓存键或比对依据——身份一律用完整 `semanticDigest` |
| TS-SCALAR-09 | `Money = { usd: number }`、`TokenCounts`（四桶 + `cached` 读别名） | 76/77 计量；`F2-04` | `kernel.ts:13`–`:28` | 已有，但**形态受限**：`Money.usd: number` 只作**现状/旧记录兼容**，不得进公共签名/API 响应/记录契约，也不得用于目标精确计算；公共金额一律 `DecimalString` + 显式币种（`{ amount: DecimalString; currency: string }`），目标内部算术走 §5.11 `DecimalArithmetic`，边界转换不经 float、不四舍五入。`cached` 只读不写（`kernel.ts:17`–`:19` 已冻结） |
| TS-SCALAR-10 | `FailureClass`（14 值，按 77 原样 snake_case：`rejected_precondition`/`rejected_authority`/`rejected_forbidden`/`rejected_state`/`rejected_version`/`rejected_idempotency`/`unsupported`/`unavailable`/`unverified`/`partial`/`conflict`/`timeout`/`cancelled`/`degraded`） | 77-§11.1 | 无（现状 `ErrorCategory` 11 值是**事件/错误分类**，不是失败分类） | **目标**。两套分类**不得合并**：`ErrorCategory` 描述“哪类故障”，`FailureClass` 描述“这次调用的失败性质”。字面量一律用 77 的下划线值，不得自造连字符一套 |

〔结论〕`ErrorCategory`（11 值，`kernel.ts:85`–`:96`）与 77-§11.1 的 14 类失败是**正交两轴**：前者只属**内部事件族的熔断域**（`GATE_FAIL`/`ESCALATE` 等 note 与告警分桶；**不是**处置判据、也不是“一见到就重试/开单”的开关），后者进 `REC-*` 的失败分支与回执。任何“用 `GATE_FAIL` 表示 `timeout`”的写法都是把两轴压成一轴。两轴在 `ClassifiedError` 里**同体不同字段**（§5.7）：`failure` 取 77 值、`category` 按固定表推出——值域不合并，载体只有一个。

〔结论〕**处置与断路由 `failure` 决定，`category` 不参与**：`Err` 面**缺省只有 `unavailable` 计入断路**（退避 + 串行重试），其余 13 类**不计入断路**（除非该领域另有合法专项规则，如 `conflict` 在合并域走裁决流程）；因此不得因 `category='STALL'` 就把 `timeout`/`unverified`/`partial`/`cancelled` 一并整体重试，也不得据此开改进单（§5.7 处置表的“不得”列即判负口径）。

〔结论〕**两个“日”不得混用**。UTC 日键（`dayKeyOf`，现 `panel/src/views.ts:321`，`Math.floor(ts / DAY_MS)`）只用于跨机器可比的聚合桶；**公司本地日**（预算日、警戒日、成本落账日、月报归属日）必须由**公司目录显式声明的时区/偏移**决定，不得读宿主时区。现状 `core/src/costguard.ts:29` 的 `localDateKey` 用 `Date#getFullYear/getMonth/getDate`（宿主时区），同一批数据在不同机器/不同 `TZ` 下会得到不同日界——目标态改为显式入参：`companyDayKey(ms: number, zone: CompanyZone): string`，`CompanyZone = { iana: string; offsetMinutes?: number }` 来自公司目录配置（`offsetMinutes` 用于无 tzdata 环境，二者都给时以 `iana` 为准并记诊断）；`dayKeyOf` 保持 UTC 语义不变。两者**分开命名、分开使用**：不得把 `localDateKey` 悄悄改成 UTC（会改变既有判档口径），也不得让 UTC 日键冒充公司本地日。`localDateKey` 的宿主时区版本只允许作为过渡期的旧记录读路径，登记为待迁移项。

### 4.2 记录信封

〔结论〕`RecordEnvelope<TPayload>` 逐字段映射 76-§4.2 的 `REC-ENV-01`。**字段名用英文，语义与必填性完全由 76 决定**：

```ts
// 目标类型（伪签名；不落生产代码）
export interface RecordEnvelope<TPayload> {
  envelopeVersion: string
  recordType: { name: RecTypeName; version: SemVer }   // name = 已登记 REC-*；version = 类型版本
  recordId: Qid                       // kind = 'record'；唯一记录身份
  companyRef: { companyId: CompanySlug; definitionRevisionRef: VersionRef<string>; specVersion: SemVer }
  lineage: { parentRefs: RecordRef[]; supersedes: RecordRef[]; corrects: RecordRef[]; reopens: RecordRef[]; bundleRef?: ArtifactRef }
  actor: { subjectRef: SubjectRef; actingFor?: SubjectRef; actingCapacity: string }
  basis: { authorityRef: VersionRef<string> } | { observationBasis: ObservationBasis }
  effectiveState: 'pending' | 'effective' | 'not-applicable'
  effectiveTime?: { from: Timestamp; until?: Timestamp }
  observedTime: Timestamp
  recordedTime: Timestamp
  sequenceHint?: { sourceCursor: string | null; sourceSequence: number }
  correlation?: { intentRefs: VersionRef<string>[]; workRefs: VersionRef<string>[]; decisionRefs: VersionRef<string>[]; parentRecords: RecordRef[] }
  scope: { subjectScope: string; dataScope: string; orgScope: string }
  provenance: Provenance             // REC-PROV-01
  knowledge: KnowledgeScope          // SG-07；不得缺省全可见
  integrity: { byteDigest?: Digest; semanticDigest?: Digest; signatures: Signature[] }  // 摘要至少一项
  extensions?: Extension[]
  payloadRef: ArtifactRef            // = TS-REF-05 的 ArtifactRef（复用，不另造载荷引用类型）
}
```

六条不可省略的约束（均由构造器/`validateRecord` 保证，不靠 TS 可选性）：

1. `effectiveTime` 的条件必填：`effectiveState ∈ {pending, effective}` 时必填，`not-applicable` 时必须为空；`not-applicable` 却给 `from`，在 `validateRecord` 处拒收；
2. `payloadRef` 不是 `payload`：信封不内联业务字段，内联会让 `byteDigest` 与 `semanticDigest` 的边界失效；
3. `basis` 二选一，但**两者都空**才是错误；`authorityRef` 存在也不证明有权（76-§4.6）；
4. **`integrity` 至少一项摘要**（76-§4.2）：`byteDigest` 与 `semanticDigest` 都缺即拒；`semanticDigest` 必带 `canonicalizationId/version`，`byteDigest` 必不带；两者不得互替；
5. **`scope` 与 `lineage` 不一致即拒收**（76-§4.2）：子记录的主体/数据/组织范围超出被修正或被重开的父记录，或 `corrects`/`reopens` 指向不同主体域，均不合格；
6. **`knowledge` 必填且不得缺省为“全部可见”**（76-§4.2 `SG-07`）：未声明知悉范围即拒收；不得用空对象或 `public` 兜底。

〔结论〕**`payloadRef` 就是 `ArtifactRef`（TS-REF-05），本卷不另造载荷引用类型**——不新增 `REC-*`、不新增概念层，字段语义照抄 76-§4.4 `ARTIFACT-REF`：

- `contentDigest` 是**载荷原始字节的 `byteDigest`**（76-§1.5）：不得换成语义摘要，也不得带 `canonicalizationId/version`（载荷未必是 JSON，语义摘要无从计算）；
- `mediaType` 是载荷的媒体类型，必须与写入时给的一致（§6.3 `RecordWriter`）；
- `storageHint` 是**逻辑定位**（内容寻址键、对象存储前缀一类的提示），**不是本机路径**、不是可读性证明、也不是权限凭证——不得据它判断“能不能读”，也不得把它写进日志/导出当作路径。

因此“信封有 `payloadRef`”只说明“载荷按此摘要**应当**可定位”，**不证明**载荷在库内、可读、未变。字节与信封是两份材料：信封进 `records`、字节进 `record_payloads`（§6.3 存储不变量），读取时必须现读现核（§6.3 `RecordReader.payload`）。只存信封不存字节、或把字节塞进信封，二者都判负。

〔结论〕**`lineage.bundleRef` 是产物引用，不是记录引用**：`ArtifactRef` 指向导出包/证据包这个**产物本身**（内容摘要 + 位置），不得被改写成 `RecordRef`/`Qid`，也不得靠“record kind 猜一个”来兼容。若某字段的真实语义是“某条记录”，必须**显式写清 record kind**，本卷涉及两处固定为：导出包清单 = `REC-EVD-03`、迁移证明 = `REC-MIG-01`；`ExportBundle.manifest.bundleId`、`MigrationPlan.planDigest` 只是摘要/标识，**不冒充**记录。同理 `TaskBrief.planRef` 是计划版本锁（`VersionRef<string>`），不是 `REC-MIG-01` 记录本身；要指记录就换 `RecordRef` 并写明类型。

〔结论〕`recordType` 与身份按 76-§4.1 四条处理：`recordType.name` 必须是已登记的 `REC-*`（含 76 侧 `REC-LOSS-01`/`REC-MIG-01`），`recordType.version` 是**类型版本**（初始 `1.0.0`，77-附录 A），不是实例版本；`recordId` 是唯一身份，payload 自带 ID 只有“与 `recordId` 同值”或“显式标为投影”两种合法情形；未知类型的**驱动性路径一律拒收**（`E-REF-001`），只读导出/归档可保留为 `opaque` 但不得驱动状态、结清或授权。禁止“拒收或标不可解释”任选其一而不说明场景。

### 4.3 引用、来源与完整性

| TS-ID | 类型 | 语义来源 | 说明 |
|---|---|---|---|
| TS-REF-01 | `RecordRef = { recordId: Qid; recordType: {name, version}; recordedAt: Timestamp; integrityRef?: Digest }` | 76-§4.4 `RECORD-REF` | 指记录，不证明内容真实 |
| TS-REF-02 | `DefinitionRef = { targetId: string; targetKind: string; version: SemVer; semanticDigest: Digest; sourceRef?: string }` | 76-§4.4 `DEFINITION-REF` | 指版本，不证明已批准/已激活 |
| TS-REF-03 | `ExternalRef = { systemNamespace: string; locator: string; retrievedAt: Timestamp; integrity?: Digest; accessNote?: string }` | 76-§4.4 `EXTERNAL-REF` | 外部对象可能已变/已删 |
| TS-REF-04 | `SubjectRef = { subjectKind: SubjectKind; id: string; companyRef: CompanySlug }` | 76-§1.3 六值封闭表 | `holder`/`appointment`/`position`/`governance-position`/`org-unit`/`joint-body`，第六值之外一律拒 |
| TS-REF-05 | `ArtifactRef = { contentDigest: Digest; mediaType: string; storageHint?: string }` | 76-§4.4 `ARTIFACT-REF` | 产物不可变；不证明已验收 |
| TS-REF-06 | `ProfileRef = { profileId: string; version: SemVer; digest: Digest }` | 76-§4.4 `PROFILE-REF` | 不证明本实现支持该档 |
| TS-PROV-01 | `Provenance = { derivation: 'observed'\|'asserted'\|'received'\|'derived'\|'imported'\|'reconstructed'; inputs: RecRef[]; procedure?: {name,version,digest?}; attributedTo: SubjectRef; externalSource?: ExternalRef; limitations: string; confidenceNote?: string }` | 76-§4.3 `REC-PROV-01` | `limitations` 必填；`reconstructed` 必须给缺口 |

〔结论〕`Provenance.limitations` 不得留空串。TS 无法表达“非空且有内容”，因此校验在 `validateRecord`；81 必须为该文件登记一条负向用例（`limitations: ''` → 拒）。

### 4.3.1 共享判别形状

〔结论〕下列类型只作 76/77 的 TS 承载，不另造语义。字段若可选，缺省的含义必须与主卷一致；运行校验由 `validateRecord` 与端口边界完成，不能靠 TypeScript 的可选性默示“随便省略”。

```ts
type ScalarFamily = 'text'|'token'|'qid'|'integer'|'decimal'|'boolean'|'timestamp'|'date'|'duration'|'interval'|'enumRef'|'null'
type ExtensionValueShape =
  | { kind: 'scalar'; family: ScalarFamily }
  | { kind: 'list'; element: ScalarFamily }
  | { kind: 'record'; schemaRef: DefinitionRef }
  | { kind: 'opaque' }

interface Extension {
  namespace: string
  name: string
  version: SemVer
  required: boolean
  effectFace: 'display'|'alias'|'mission'|'boundary'|'authority'|'obligation'|'commitment'|'acceptance'|'evidence'|'work-semantics'|'identity-employment'|'secret'|'authority-domain'|'external-impact'
  valueShape: ExtensionValueShape
  value: unknown
  capabilityRequest?: { capabilityRefs: readonly DefinitionRef[] }
  sourceRef: RecordRef | DefinitionRef | ExternalRef
  schemaRef?: DefinitionRef
}
// opaque 仅允许 required=false 且 effectFace=display|alias；其余扩展一律按声明的 shape 校验。

interface EnumRef { vocab: string; vocabVersion: SemVer; code: string }
type DurationString = string  // 76-§1.2 的 ISO-8601 子集；日历单位必须显式声明参照

interface RetentionRule {
  basis: string
  duration?: DurationString
  condition?: { ruleRef: DefinitionRef; authorizedBy: SubjectRef }
  reviewAt: Timestamp | DurationString
  deletionClass: 'forbidden' | 'conditional' | 'allowed'
}
// duration 与 condition 至少一项；conditional 必须有 condition 和具名授权位置。
// allowed 也不等于可擅自删除：仍须通过 77/72 的保留义务与授权检查。

interface KnowledgeScope {
  audienceRefs: readonly Qid[]
  purposeRefs: readonly EnumRef[]
  retentionRule: RetentionRule
}

interface DissentPosition {
  positionRef: SubjectRef
  responseDeadline: Timestamp
  procedureRef?: DefinitionRef       // 申辩、复核、救济程序；不是可有可无的“联系人”
}

interface ObservationBasis {
  observerRef: SubjectRef
  evidenceRefs: readonly RecordRef[]
  coverage: 'complete' | 'partial' | 'unknown'
  limitations: string
}

interface Signature {
  scheme: string
  keyRef: string                            // 逻辑密钥/信任锚，不是秘密值或本机路径
  signerRef: SubjectRef
  signedDigestRef: { kind: 'byteDigest' | 'semanticDigest'; digest: Digest }
  scope: {
    partIds: readonly string[]
    digestRefs: readonly { partId: string; digest: Digest }[]
    coverageNote: string
  }
  createdAt: Timestamp
  verificationState: 'unverified'|'verified'|'failed'|'expired'|'revoked'
  verificationEvidenceRef?: RecordRef       // verified 必填
  revocationRef?: RecordRef                 // revoked 必填
  value: string                             // 签名值，不是密钥材料
}

type EffectClass = 'E0'|'E1'|'E2'|'E3'|'E4'|'E5'|'E6'
type ControlEffectAction =
  | 'issues.create' | 'issues.transition' | 'issues.setField'
  | 'comments.add' | 'fields.provision' | 'kb.upsert' | 'links.link'
  | 'guards.install' | 'guards.uninstall'
type EffectAction = GatewayAction | ControlEffectAction
// CONTROL_EFFECT_ACTIONS 是目标集合，不是当前 GATEWAY_ACTIONS 已扩大的事实。
// 映射只在现有 packages/gateway/src/actions.ts 中定义：comments.add→comment；kb.upsert→article；
// 其余控制效果→comment + args.op=对应 EffectAction。高层 action 与实际 gateway action 的 scope 都要校验。

type EffectOrigin =
  | { kind: 'work-intent'; intentRef: Qid }  // 对应 REC-WORK-01；unknown 必须有确定链接
  | { kind: 'other'; sourceRef: RecordRef }  // 非意图来源；不得伪造 intentRef

interface EffectCredential {
  token: string                       // 只在 daemon 内存；不得进入 EffectRequest、帧、日志或记录
  claims: { ticket: TicketId; scope: readonly EffectAction[]; exp: number; nonce: string; author: PersonId }
}
interface EffectCredentialBroker {
  forCall(req: EffectRequest): Promise<Result<EffectCredential, ClassifiedError>>
}
// credentialRef 已给时解析本进程活跃签发；未给时按 effect.action、目标、origin 现签一次性凭据。
// scope 必须包含 effect.action 与映射后的 gatewayAction；禁止调用方自行扩大。

interface EffectDescriptor {
  action: ControlEffectAction           // 本端口只执行九个平台写；六个工具动词不在这里冒充写效果
  args: Readonly<Record<string, unknown>>
  effectClass: EffectClass
  origin: EffectOrigin
  partialItems?: readonly EffectPartialItem[] // 仅声明允许部分执行时有；缺省=整体原子
}
interface EffectTarget {
  bindingRef: DefinitionRef
  objectRef?: ExternalRef
  workRef?: Qid
}
interface EffectPartialItem {
  key: string
  status: 'applied' | 'failed' | 'unknown'
  receiptRef?: Qid           // applied 必填，指向 REC-RCP-01
  unknownRef?: Qid           // unknown 必填，指向 REC-EVT-03
  error?: ClassifiedError    // failed 必填
}
type EffectError = ClassifiedError & { partialItems?: readonly EffectPartialItem[] }
// failure='partial' 时 partialItems 必填且逐项有结果；applied/unknown 的引用不可缺。

type EffectWriteResult =
  | { status: 'committed'; externalRef: ExternalRef; resultingVersion: string; proofRef?: ArtifactRef; reconcileHint?: ExternalRef }
  | { status: 'unknown'; reason: string; reconcileHint?: ExternalRef }
interface EffectWriter {
  write(input: {
    action: ControlEffectAction
    args: Readonly<Record<string, unknown>>
    signed: SignedBody
    target: EffectTarget
    idempotencyKey: string
  }): Promise<Result<EffectWriteResult, ClassifiedError>>
}
// EffectWriter 是 daemon 内部注入面，不是第 56 个公共端口；实现归既有 engine/tools/gated-platform.ts。
// committed 必须有平台可核回执与原生版本（不是 SemVer）；void/仅排队/不可核的应答只能回 unknown。
// Err 只允许表示确定未产生外部效果的拒绝；一旦已发送而结果不明，回 Ok(unknown)，不得抛错让上层盲 retry。
```

〔结论〕`Signature` 的 `verified` 必须同时有 `verificationEvidenceRef`，`revoked` 必须同时有 `revocationRef`；签名本身仍不证明有权、真实、合法或已验收。`KnowledgeScope` 不得用空 `audienceRefs`/`purposeRefs` 表示“全员/全部用途”。

### 4.4 五十类 `REC-*` 的 TS 映射

〔事实〕`docs/77` §2–§10 + 附录 A 登记 50 类记录，编号与名称见 77-§0.5 表。本表**逐类**给 TS 承载；字段一律不复制，只指向 77 的节号。

通用约定（每行都适用，不再重复）：

- **判别字段**：`RecordEnvelope.recordType.name`（值即 REC-ID）+ `recordType.version`（初始 `1.0.0`）；TS 侧用 discriminated union 的 `recordType.name` 收窄，`payload` 用 `PayloadOf<T>` 条件类型取；
- **验证**：`TS-REC-01 validateRecord(env: unknown): ValidationOutcome`——先形状（zod 参考实现，79-§3），再语义（76/77 规则），两步失败都给 `{file?, path, rule, fix}`；
- **存储**：写入只经 `TS-PORT-REC-01 RecordWriter`（收 `RecordWriteInput`：整封 + 原始载荷字节，§6.3）；落点 = §6.3 “记录面存储不变量”的 `records` / `record_payloads` / `record_transactions`（**语义不变量归本卷，绑定关系归 78-§10，DDL/索引/迁移波次归 81-files/03 与 82**；S13 已对齐，78 不被当作字段级 DDL 来源）；`REC-OBS-*` 例外（投影，非事实）；`REC-LIFE-02` 例外（含文件工件）；
- **执行归属**：每类记录“谁执行、走哪个端口”见 §4.7 的完整 record→port 表；不得只列记录不给端口，也不得留“无专用端口且不说复用谁”的空档。

| REC-ID | TS 类型名 | 判别与版本 | 字段表来源 | 验证与存储归属 |
|---|---|---|---|---|
| REC-CMD-01 | `RecCommandRequest` | `recordType.name`; `1.0.0` | 77-§2.1 | 通用；命令入口 `TS-PORT-CMD-01 CommandIntake`（**不是** `RecordTransaction`），见 §4.7 |
| REC-CMD-02 | `RecAuthorityCheck` | 同上 | 77-§2.2 | 通用；由 `TS-PORT-CMD-01 CommandIntake` 在命令受理时产出；`policy_verdict` 只写四机器字面量 `'permitted'｜'reserved'｜'prohibited'｜'uncovered'`（词表主定义 76-§3.12，“可用/保留/禁止/未覆盖”只作语义说明，不得进 payload）；结论不证明有权 |
| REC-DEC-01 | `RecDecision` | 同上 | 77-§2.3 | 通用；含异议位置 |
| REC-RCP-01 | `RecReceipt` | 同上 | 77-§2.4 | 通用；权威端确认 |
| REC-COR-01 | `RecCorrection` | 同上 | 77-§2.5 | 通用；只追加，不覆盖 |
| REC-EVT-01 | `RecEvent` | 同上 | 77-§2.6 | 通用；与台账 `EventRecord` 是投影关系（§4.6） |
| REC-EVT-02 | `RecReconciliationBatch` | 同上 | 77-§2.7 | 通用；对账差异面 |
| REC-EVT-03 | `RecExternalUnknown` | 同上 | 77-§2.8 | 通用；“未知”是一等记录 |
| REC-AUTH-01 | `RecGrantEdge` | 同上 | 77-§3.1 | 通用；授予/转授边 |
| REC-AUTH-02 | `RecAuthorityExercise` | 同上 | 77-§3.2 | 通用；一次具体行使 |
| REC-AUTH-03 | `RecAuthorityWithdrawal` | 同上 | 77-§3.3 | 通用；含在途处置 |
| REC-AUTH-04 | `RecCredentialRef` | 同上 | 77-§3.4 | 通用；只存引用，不存凭据值（§11） |
| REC-AUTH-05 | `RecLease` | 同上 | 77-§3.5 | 通用；`TS-PORT-AUTH-04` 的落账面 |
| REC-AUTH-06 | `RecFencingObservation` | 同上 | 77-§3.6 | 通用；围栏代≠治理代次 |
| REC-AUTH-07 | `RecAuthorityActivation` | 同上 + **decision facet** | 77-§3.7、§1.7 | 通用；`TS-PORT-AUTH-03` |
| REC-AUTH-08 | `RecIncapacityDetermination` | 同上 + **decision facet** | 77-§3.8、§1.7 | 通用；恢复前提 |
| REC-WORK-01 | `RecIntentEnvelope` | 同上 | 77-§4.1 | 通用；`TS-PORT-WORK-01` |
| REC-WORK-02 | `RecIntakeConclusion` | 同上 + **decision facet** | 77-§4.1、§1.7 | 通用；五取值之一 |
| REC-WORK-03 | `RecContractRevision` | 同上 | 77-§4.3 | 通用；`TS-PORT-WORK-02` |
| REC-WORK-04 | `RecReadinessJudgment` | 同上 + **decision facet** | 77-§4.4、§1.7 | 通用；五门三取值 |
| REC-WORK-05 | `RecExecutionPlanLock` | 同上 | 77-§4.5 | 通用；`TS-PORT-WORK-04` |
| REC-WORK-06 | `RecWorkAttendance` | 同上 | 77-§4.6 | 通用；出工 |
| REC-WORK-07 | `RecAttendanceSegment` | 同上 | 77-§4.6 | 通用；出工段 |
| REC-WORK-08 | `RecQualificationDetermination` | 同上 | 77-§4.7 | 通用；**独立** `TS-PORT-WORK-08 QualificationPort`；`CapabilityResolver` 不判资格 |
| REC-WORK-09 | `RecStateTransition` | 同上 + **decision facet** | 77-§5.3、§1.7 | 通用；`TS-PORT-WORK-05` |
| REC-WORK-10 | `RecAssignmentRequest` | 同上 | 77-§4.10 | 通用；带未响应语义 |
| REC-WORK-11 | `RecRiskClassification` | 同上 + **decision facet** | 77-§5.7、§1.7 | 通用；**独立** `TS-PORT-WORK-09 RiskClassifier`；交付方不得自评降档 |
| REC-EVD-01 | `RecHarvestBatch` | 同上 | 77-§6.1 | 通用；`TS-PORT-EVD-01` |
| REC-EVD-02 | `RecEvidenceItem` | 同上 | 77-§6.2 | 通用；单材料 |
| REC-EVD-03 | `RecEvidenceBundle` | 同上 | 77-§6.2 | 通用；八要素齐备 |
| REC-EVD-04 | `RecAcceptance` | 同上 + **decision facet** | 77-§6.4、§1.7 | 通用；`TS-PORT-EVD-02` |
| REC-EVD-05 | `RecValueAssessment` | 同上 | 77-§6.5 | 通用；四本账 |
| REC-EVD-06 | `RecSettlement` | 同上 + **decision facet** | 77-§6.8、§1.7 | 通用；`TS-PORT-WORK-07` |
| REC-EVD-07 | `RecRework` | 同上 | 77-§6.6 | 通用；返工次数与阈值 |
| REC-EVD-08 | `RecReopen` | 同上 | 77-§6.6 | 通用；二次终态 |
| REC-EXC-01 | `RecException` | 同上 | 77-§6.7 | 通用；`TS-PORT-WORK-06` |
| REC-EXC-02 | `RecEmergencyStop` | 同上 | 77-§6.7 | 通用；事后复核 |
| REC-OBL-01 | `RecObligationInstance` | 同上 | 77-§7.1 | 通用；定义在 76-`DEF-OBL-01` |
| REC-OBL-02 | `RecConcreteCommitment` | 同上 | 77-§7.2 | 通用；规则在 76-`DEF-COMMIT-01` |
| REC-OBL-03 | `RecFulfillmentLink` | 同上 | 77-§7.2 | 通用；承诺→工作/时点/证据 |
| REC-MEM-01 | `RecMemoryEntry` | 同上 | 77-§8.2 | `TS-PORT-MEM-01`（四层不合并） |
| REC-MEM-02 | `RecMemoryAccessAudit` | 同上 | 77-§8.3 | `TS-PORT-MEM-01` 读路径强制留痕 |
| REC-MEM-03 | `RecMemoryDisposition` | 同上 | 77-§8.4.1 | `TS-PORT-MEM-01`；操作五值：修正/清除/继承/转层/封存 |
| REC-OBS-01 | `RecProjectionSnapshot` | 同上 | 77-§9.1 | **投影**：`TS-PORT-OBS-01` 产出，可重建，不是事实源 |
| REC-OBS-02 | `RecObservationFault` | 同上 | 77-§9.4 | **投影侧故障记录**：采集中断/覆盖缺口/投影失败/来源不可达 |
| REC-LIFE-01 | `RecIdentityTransition` | 同上 | 77-§10.1 | 通用；公司身份四态 |
| REC-LIFE-02 | `RecHandoverArchive` | 同上 | 77-§10.2 | 通用 + 文件工件（移交档案本体在 78 绑定的归档面） |
| REC-LIFE-03 | `RecContinuityDecision` | 同上 + **decision facet** | 77-§10.4、§1.7 | 通用；合并/分立/联合/承继 |
| REC-LIFE-04 | `RecLossReport` | 同上 | 77-§10.5 | 通用；逐项声明无法表达/迁移/承接 |
| REC-LIFE-05 | `RecAppointment` | 同上 + **decision facet** | 77-§10.6、§1.7 | 通用；任命/兼任/代理/替补 |

〔结论〕五十行中，带 decision facet 的**恰十类**（77-§1.7 封闭清单）：`REC-AUTH-07`、`REC-AUTH-08`、`REC-WORK-02`、`REC-WORK-04`、`REC-WORK-09`、`REC-WORK-11`、`REC-EVD-04`、`REC-EVD-06`、`REC-LIFE-03`、`REC-LIFE-05`。TS 侧用**六槽位**统一承载（77-§2.3.1）：

```ts
// 目标类型（伪签名）：槽位与 77 一一对应，不增不减
export interface DecisionFacet {
  decidedBy: SubjectRef                 // decided_by：具名位置或任职者，不得“团队/公司”
  authorityRef: VersionRef<string>      // authority_ref：凭什么作出，对齐 REC-AUTH-01/02 或宪制指定
  rationale: string                     // rationale：可短但不得为空
  basisRefs: readonly RecordRef[]       // basis_refs：证据、规则版本、上级决定
  scopeJudged: { judged: string; notJudged: string }  // scope_judged：判了什么、没判什么
  dissentPosition: DissentPosition      // dissent_position：异议受理位置与答复期限
  effectiveState: 'pending' | 'effective' | 'not-applicable'  // 与信封同值
  effectiveTime?: Timestamp             // 仅 effective 时填，与信封 effectiveTime.from 同值
}
```

三条纪律：

1. **不凭空加 `decidedAt`**：决定时刻由 `effectiveTime`（实际生效）与信封 `recordedTime`（写入）承载；77 没有独立的“决定作出时刻”槽位，不得自造；
2. **facet 是权威值，顶层同名字段是只读投影**：写入时二者必须同值或可解析到同一引用；读取时冲突按 `rejected_precondition` 拒收；不得让投影反向覆盖 facet；
3. 封闭清单外的类型（如 `REC-LIFE-01`、`REC-EXC-01`）**不得强加** `decision_facet`，其决定面由本类型自有字段（`decided_by`/`basis`/`dissent`）承载。

〔结论〕77 的英文字面量到 TS 字面量一律**保留下划线**（如 `rejected_precondition`、`partially_settled`），不改成连字符；中文枚举需给英文映射时同样用 lower_snake_case，并在 §4.7 的端口表里逐项列。**例外只有一种**：77 已把中文定为 payload 值的枚举（如 `REC-WORK-04.verdict` 的 `可开工`/`附条件开工`/`不可开工`——77-§4.4.1 明写“本类型自有取值”），TS 侧就用中文字面量，**不映射**——给它们编英文才是造第二套词表。反例：`policy_verdict` 的权威值是英文 `permitted/reserved/prohibited/uncovered`，中文只是说明，**不得**把中文写进 payload。失败类（77-§11.1）与六态（77-§9.2）是两套词表，不得互相代入。

〔结论〕一个语义事件只有一个 `recordId`（77-§1.7）。因此 `RecDecision` 与其 `decision` facet **不拆成两行记录**；facet 是同一信封下的内嵌结构，不是第二张表。

### 4.5 规范化（JCS）与“不自动修正”

〔事实〕76-§8 冻结 `canonicalizationId = studio-next/jcs@1`，状态 `vectors-published`；76-§12 明确其自带样例与向量尚未执行。

〔结论〕TS 侧：

```ts
// 目标端口（§6.1 的 RuleEvaluator 与 RecordWriter 共用）
export interface Canonicalizer {
  id: 'studio-next/jcs@1'      // = Digest.canonicalizationId（76-§1.5/§8 冻结值）
  version: string              // = Digest.canonicalizationVersion；由 76-§1.5 登记，二者成对写进 semanticDigest
  canonicalize(value: JsonValue): Uint8Array   // 字节确定，供 byteDigest/semanticDigest 使用
}
```

**摘要形状与 76 一致**：`semanticDigest` 必须同时给 `canonicalizationId` 与 `canonicalizationVersion`（成对；只给其一的摘要不得当身份、不得进 `VersionRef`/`ProfileRef`）；`byteDigest` 两者**都不得出现**。两者互替即缺陷（§4.1 `TS-SCALAR-08`）；`Digest` 的规范构造只在这里给一次，其他章节引用本段，不另造第二套字段。

四条禁令：

1. **不自动改 decimal**：`"1.50"` 不得被规范成 `"1.5"`——那是语义变更，不是规范化；
2. **不自动改 timestamp**：带偏移的时间不得被转成 UTC 文本；时区是语义；
3. **不自动补键**：缺的必填键在规范化阶段报错，不得注入 `null`；
4. **不重排数组**：JCS 只排对象键；数组序是语义（证据包顺序、异议顺序）。

〔假设〕`studio-next/jcs@1` 的字节确定性目前只在文档层声明，**没有**仓内向量执行结果（状态：未证，探针见 §12.5 U80-01）。在 82 的 V0/V2 跑通前，`semanticDigest` 只能用于“同实现内比对”，不得用于跨实现交换。

### 4.6 与现有 `EventRecord` 的投影关系

〔事实〕`packages/contract/src/schemas/events.ts:140` 的 `EventRecordSchema` 是 `z.strictObject`，字段为 `id/ts/company/issue/event/actor/attempt/level/dept/correlation_id/causation_id/tokens/cost_usd/duration_ms/size/payload_hash/note`；事件名是 30 个冻结名（`EVENT_NAMES`，`:62`–`:96`）+ `GW_`/`REPORT_`/`JUDGE_` 前缀族（`EVENT_PREFIX_FAMILIES`，`:99`）。

〔结论〕目标态不是废掉 `EventRecord`，而是把它降为**投影**：

| 层 | 类型 | 角色 |
|---|---|---|
| 交换/记录层 | `RecordEnvelope<RecEvent>` | 事实；50 类之一；跨实现可交换 |
| 台账行层 | `EventRecord` | 本实现的 events 表行；由 `RecEvent` 投影而来，可重建 |
| 视图层 | `TickReport.events` / 面板行 | 只读投影，可丢弃 |

三条约束：

1. `EventRecord.event` 的 30 个名是**本实现的投影词表**，不是 77 的 `REC-*`。映射表放 81 的对应文件条目，不在本卷展开；
2. 投影必须单向：`RecEvent → EventRecord`，不允许反向“由事件名猜记录类型”；
3. 新增事件名走 `SCHEMA_EVOLVE`（现状注释 `events.ts:139` 已如此），不得因新增 `REC-*` 就自动扩事件名表。

〔结论〕**`events` 装不下整封信封，这不是“再加几列”能修的**：`EventRecord` 只有 17 列，没有 `basis`/`scope`/`provenance`/`integrity`/`knowledge`/`payloadRef`/`lineage`，也没有载荷字节。因此目标态是**另立事实面**（`records` 整封 + `record_payloads` 原始字节，§6.3 存储不变量），`events` 退回**纯投影**；`RecordWriter` 不得把 `appendEvent` 当实现（§6.3、§6.0 状态改为“新建”）。

〔结论〕**由 `events` 派生记录（或由任何投影派生成事实）时不得伪造历史**（76-§4.5 三时间、76-§1.8 未知、72-§1.1 “补录不得伪装当时证据”）：

- 派生出的记录一律 `provenance.derivation='reconstructed'`；`observedTime` 取原事件的观察时刻（原行有才取），`recordedTime` 取**实际写入/重建时刻**——两者都不得回填成“当时那一刻”；`provenance.limitations` 必填，写清“由投影重建、原信封字段缺失”。
- **缺字段不得回填**：`basis`/`scope`/`knowledge`/`provenance`/`lineage` 在原行不存在时，不得用默认值、空对象、`public`、“从别处推断”或“看起来合理”补上。补不齐合法信封的行**只能**留作 `opaque` 投影 + `REC-LOSS-01`（`dimension:'interoperability'`，`cannotClaim` 写明“不得据此宣称该事实已成记录”），**不得**为了“迁得干净”而编造。
- **旧摘要未知标 `unknown`**：原始字节已不在库内（或从未存过）时，`integrity.byteDigest` 处**显式标 `unknown`**（76-§1.8 的“未知”：不是可序列化摘要值，消费方必须当“无此材料”处理，不得当身份、不得进 `VersionRef`/`ProfileRef`），并落 `REC-LOSS-01`；**不得**拿 `payload_hash` 一类替代值冒充 `byteDigest`，也不得删掉 `integrity` 绕过“至少一项摘要”。
- 事件投影自身仍是投影：任何“库里只有 `events` ⇒ 记录齐全”的读法判负（§6.0 状态矩阵、§4.7）。

### 4.7 完整 record→port 映射：50 类无空档

〔结论〕每类记录必须有“谁执行 / 哪个端口 / 写成哪条记录”。下表逐类给出；**无专用端口的必须写明复用哪个既有端口**，不得留实现空档。

| REC-ID | 执行端口（TS-ID） | 本端口产出 | 备注 |
|---|---|---|---|
| REC-CMD-01 | `TS-PORT-CMD-01 CommandIntake` | 受理并追加命令请求 | 命令入口**不是** `RecordTransaction`；命令不直接执行 |
| REC-CMD-02 | `TS-PORT-CMD-01` | 权源检查结论 | `policy_verdict` 四值不合并 |
| REC-DEC-01 | `TS-PORT-DEC-01 DecisionPort` | 通用决定记录 | 仅用于无专用记录类型的决定 |
| REC-RCP-01 | `TS-PORT-EFF-01 EffectGateway` | 外部确认回执 | 结果不明→`TS-PORT-REC-06` 对账 |
| REC-COR-01 | `TS-PORT-REC-05 CorrectionPort` | 追加修正记录 | 不覆盖、不删旧 |
| REC-EVT-01 | `TS-PORT-REC-01 RecordWriter` | 事件记录（`EventRecord` 的事实侧） | 源 ingest 触发，单写口 |
| REC-EVT-02 | `TS-PORT-REC-06 ReconciliationPort` | 对账批次 | 差异逐项处置 |
| REC-EVT-03 | `TS-PORT-REC-06` | 外部未知登记 | 下游必须显示未知/受损 |
| REC-AUTH-01 | `TS-PORT-AUTH-05 AuthorityGrantPort` | 授予/转授边 | 父链不超范围 |
| REC-AUTH-02 | `TS-PORT-AUTH-05` | 授权行使 | 不得反向扩大授予 |
| REC-AUTH-03 | `TS-PORT-AUTH-05` | 撤回（含在途清单） | 只发通知不算完成 |
| REC-AUTH-04 | `TS-PORT-AUTH-06 CredentialCatalogPort` | 凭据引用 | 只存引用，不存值 |
| REC-AUTH-05 | `TS-PORT-AUTH-04 WriterLeasePort` | 写者租约 | fence 每次换 |
| REC-AUTH-06 | `TS-PORT-AUTH-04` | 围栏观测 | 围栏代≠治理代次 |
| REC-AUTH-07 | `TS-PORT-AUTH-03 AuthorityActivationPort` | 权威激活 | CAS 换代 |
| REC-AUTH-08 | `TS-PORT-AUTH-07 IncapacityPort` | 失能判定 | 含恢复前置 |
| REC-WORK-01 | `TS-PORT-WORK-01 WorkIntake` | 意图信封 | 去重幂等 |
| REC-WORK-02 | `TS-PORT-WORK-01` | 受理结论 | 受理≠开工 |
| REC-WORK-03 | `TS-PORT-WORK-02 ContractPort` | 合同版本 | 五要件 |
| REC-WORK-04 | `TS-PORT-WORK-03 ReadinessGate` | 开工五门判决 | 三取值 |
| REC-WORK-05 | `TS-PORT-WORK-04 ExecutionPlanPort` | 计划锁 | 六件版本 |
| REC-WORK-06 | `TS-PORT-WORK-11 AttendancePort` | 出工 | 起止可核 |
| REC-WORK-07 | `TS-PORT-WORK-11` | 出工段 | 段间替换 |
| REC-WORK-08 | `TS-PORT-WORK-08 QualificationPort` | 资格认定 | 独立于能力解析 |
| REC-WORK-09 | `TS-PORT-WORK-05 WorkLifecycle` | 状态迁移 | 十态/T01–T26 |
| REC-WORK-10 | `TS-PORT-WORK-10 AssignmentPort` | 派工/领取/转派/协作 | 未响应语义逐动作 |
| REC-WORK-11 | `TS-PORT-WORK-09 RiskClassifier` | 风险分类 | 交付方不得自评降档 |
| REC-EVD-01 | `TS-PORT-EVD-01 EvidenceHarvester` | 收割批次 | 只收材料 |
| REC-EVD-02 | `TS-PORT-EVD-01` | 证据项 | 单材料 |
| REC-EVD-03 | `TS-PORT-EVD-01` | 证据包 | 八要素 |
| REC-EVD-04 | `TS-PORT-EVD-02 AcceptanceEvaluator` | 验收结论 | 独立性 |
| REC-EVD-05 | `TS-PORT-EVD-03 ValueAssessmentPort` | 价值四本账 | 不压总分 |
| REC-EVD-06 | `TS-PORT-WORK-07 SettlementPort` | 结清 | 八项判据 |
| REC-EVD-07 | `TS-PORT-EVD-04 ReworkPort` | 返工 | 阈值强制重受理 |
| REC-EVD-08 | `TS-PORT-EVD-05 ReopenPort` | 重开 | 不复活终态 |
| REC-EXC-01 | `TS-PORT-WORK-06 ExceptionPort` | 异常四段 | 具名接收 |
| REC-EXC-02 | `TS-PORT-WORK-06` + 停机通道 | 紧急停止 | 事后复核 |
| REC-OBL-01 | `TS-PORT-OBL-01 ObligationPort` | 义务实例 | 触发/到期/承接 |
| REC-OBL-02 | `TS-PORT-OBL-01` | 具体承诺 | 规则在 76 |
| REC-OBL-03 | `TS-PORT-OBL-01` | 履行链接 | 承诺→工作/证据 |
| REC-MEM-01 | `TS-PORT-MEM-01 MemoryStore` | 记忆条目 | 四层不合并 |
| REC-MEM-02 | `TS-PORT-MEM-01` | 访问审计 | 读也留痕 |
| REC-MEM-03 | `TS-PORT-MEM-01` | 处置决定 | 五操作：修正/清除/继承/转层/封存（77-§8.4.1）；与结清时“记忆三路分流”不是同一枚举 |
| REC-OBS-01 | `TS-PORT-OBS-01 ObservationProjector` | 六态投影快照 | 调 `TS-PORT-REC-03` 维护投影表 |
| REC-OBS-02 | `TS-PORT-OBS-01` | 监控故障 | 一等记录 |
| REC-LIFE-01 | `TS-PORT-LIFE-01 IdentityLifecyclePort` | 身份四态迁移 | `dissolved` 不可复活 |
| REC-LIFE-02 | `TS-PORT-LIFE-02 HandoverArchivePort` | 移交/交接档案（含清算承接范围） | 含文件工件；`转入清算` 须由它承接后才可 `CLOSE` |
| REC-LIFE-03 | `TS-PORT-LIFE-03 SuccessionPort` | 连续性决定 | 合并/分立/联合/承继 |
| REC-LIFE-04 | `TS-PORT-LIFE-02` **+** `TS-PORT-LIFE-03` | 损失与缺口报告 | 接收前列出；移交面在 LIFE-02、承继面在 LIFE-03，两处都出，不得只在一处 |
| REC-LIFE-05 | `TS-PORT-LIFE-04 AppointmentPort` | 任命/兼任/代理/替补 | 权源落点 |

〔结论〕**`RecordProjection` 与 `ObservationProjector` 不是两个同义投影**：

- `TS-PORT-REC-03 RecordProjection` 是**投影表维护**：可重建、可整表替换、写投影表（`syncCompany`/`replaceTodoQueue` 一族），产出 `REC-OBS-01` 的落库形态；
- `TS-PORT-OBS-01 ObservationProjector` 是**只读六态视图**：不写事实源，按 77-§9.1 生成视图，必要时**调用** `RecordProjection` 做表维护，再叠加六态与来源游标。

禁止把二者合并成“一个投影端口”：前者有写（投影表）、后者必须只读（视图）。也禁止让 `ObservationProjector` 直接写投影表而不经 `RecordProjection`。

〔结论〕`TS-PORT-API-01 IntentSubmissionPort` 是**入口端口**，不对应任何 `REC-*`：它只把外部请求转成 `WebhookIntentPayload`（`source` 是**已注册来源名**且外部面固定 `'external-api'`、`kind` 固定 `'webhook'`、`requestKind` 才是业务类型）并返回由记录导出的回执 `IntentReceipt`（投影 `intent_receipts`，不是记录）。`REC-WORK-01` 由 `WorkIntake.reserve` 在入队前写（先记录、后投影），`REC-WORK-02` 由相位 2 的受理路径写。因此上表 50 行不含 `API-01`，也不得为它新增 `REC-*` 行。

〔结论〕`TS-PORT-RES-01 ResourceAccountant`（§6.4 末）同样**不占**上表任何一行：资源事实由 `REC-WORK-05.resource_reservations`（预留）/`REC-EVD-01`、`REC-EVD-05`（实际）/`REC-EVD-06`（释放）承载，本端口只有**只读评估**（`baseline`/`gap`），无 `reserve`/`actual`/`release` 写口。**不得**为它新造“资源记录”或第二套账目事实源；内部资源账目只是 `store` 拥有的同事务投影。

### 4.8 76 侧两类记录的映射（不属 77 的 50 类）

〔事实〕`REC-MIG-01`（迁移记录，76-§8.3）与 `REC-LOSS-01`（损失报告，76-§8.4）是 76 的公共记录，**不计入** 77 的 50 类，但同样需要 TS 承载与执行归属。

| REC-ID | TS 类型 | 执行端口 | 说明 |
|---|---|---|---|
| `REC-MIG-01` | `RecMigration` | `TS-PORT-MIG-01 MigrationService` | 版本迁移；不复活终态 |
| `REC-LOSS-01` | `RecBindingLossReport`（**与 `RecLossReport` 分开**） | `TS-PORT-BIND-01 PlatformBindingPort.describe()` 的 `loss` + `TS-PORT-LIFE-02 HandoverArchivePort`（迁移侧损失） | 76-§8.4 的平台/绑定特有损失；与 77 `REC-LIFE-04` 的 `RecLossReport` 是**两个 recordType、两个 TS 类型**——不共用类型名，也不共用 `recordType.name`。若将来要共用 payload 形状，只能共享字段定义、**不得**共享 `recordType` |

〔结论〕为什么要拆名：`REC-LIFE-04`（77-§10.5.1，承继/迁移的损失与缺口报告）与 `REC-LOSS-01`（76-§8.4，绑定/导出损失）字段高度相似，但**类型版本、触发时机、接收者、是否影响结清**都不同。同名会让 `recordType.name` 校验、`SemVer` 演进与拒收路径三者相互踩踏（§4.2 的 `recordType` 规则）。

〔结论〕`RecordEnvelope` 的 `recordType.name` 必须同时接受这两类；否则迁移与损失记录无法进同一信封，77 的 50 类之外会形成“无信封的第二套记录”。

---

## 五、TS 惯例的落地

### 5.1 形状选择：`interface` 优先，联合用 `type`

〔事实〕79-§2 统计：全仓 648 处 `export interface` vs 157 处 `export type`。`Action`、`StreamEvent`、`ErrorCategory`、`GateWriteResult` 等判别联合用 `type`；对象形状用 `interface`。

〔结论〕沿用：

- 可扩展的对象形状（端口、配置、payload）→ `interface`；
- 判别联合、条件类型、映射类型、字符串字面量联合 → `type`；
- 不用 `enum`（`erasableSyntaxOnly` 禁止，79-§1.2）；用 `as const` 数组 + 派生类型（现状 `GATEWAY_ACTIONS`、`EVENT_NAMES`、`COST_GUARD_ROUTES` 都是这个形）。

### 5.2 判别联合与穷尽

〔结论〕所有状态/动作/结果都用**字面量判别字段**，不用布尔组合：

```ts
// 外部副作用的结果：**两种 status 都必须带回执引用**——"做了"要能指向落笔，"不知道"也要能指向那条未知记录
type EffectOutcome =
  | { status: 'applied'; receiptRef: Qid }               // 必填：外部回执/落笔引用（先落记录再返 Ok）
  | { status: 'unknown'; unknownRef: Qid; reason?: string }  // 必填 unknownRef：REC-EVT-03 的 recordId；reason 只是诊断文本
```

**为什么 `unknownRef` 必填**：若允许 `Ok({status:'unknown', reason})` 而不带引用，调用方就无法在账上找到“这次外部效果不可知”的那条记录，重放判定失去唯一支点（§6.6 的 `unknown` 链正是按 `unknown_scope.intentRef` → `REC-WORK-01.recordId` 反查）。因此：**登记未知记录失败时返回 `Err(unavailable, category=STALL)`，不得返回无引用的 `Ok(unknown)`**；`applied` 同理，回执未落地不得报 `applied`（宁报 `Err` 或 `Ok(unknown)` + 已登记的 `unknownRef`）。

注意：判别字段只在**同一语义维度**上取值。反例是自造的 `AppendResult = { appended: false; reason: 'duplicate_identical' | 'rejected' }`——把“没写入”的实现结果和“被拒绝”的业务结论塞进一个 `reason`，`rejected` 又不带 `category`，等于宣布了拒绝却没有通道；本卷取 `AppendReceipt = { recordId, deduped }`，拒绝一律走 `Result` 的 `Err`（§6.4 REC-01、§5.7）。

穷尽检查用 `switch` + `never` 兜底（现状 `tick()` 的 `switch (action.type)` 有防御性 `open_bug` 分支，`:1963`，可保留但须注明“decide 不出”）。

〔结论〕禁止“布尔 + 可选字段”表达三态。例：`{ ok: boolean; reason?: string }` 无法表达 77 的 14 类失败；必须用 `FailureClass` 判别。

### 5.3 `import type` 与 `.ts` 说明符

〔事实〕79-§4：1257 处相对 import 全部带 `.ts`；`verbatimModuleSyntax` 开启。

〔结论〕新代码同样：类型导入一律 `import type`；运行时导入不得混入类型；跨包用 `@studio-next/*`，包内用 `./x.ts`。`dsh-bridge` 是唯一例外（零模块入边，以路径字符串被复制进 DSH 插件目录，79-§6）。

### 5.4 `unknown` + 收窄，禁 `any`

〔结论〕外部输入（HTTP body、YAML 文本、平台响应、CLI argv、env）一律 `unknown`，先校验再收窄。`any` 零容忍；`as` 只允许在两个场景：① zod `z.infer` 之后的已知形状；② 测试夹具。生产代码里的 `as SomeInterface` 一律视为缺陷。

〔事实〕现状 `cli/main.ts:22` 有 `JSON.parse(...) as { version?: string }`——这是允许的第①类（JSON 解析后立即窄化为已知形状，且字段可选）。

### 5.5 `optional` vs `null` 的分工

〔事实〕79-§2 已定：**缺席 = 字段不存在（`?`）；明确没有 = `null`；空集合 = `[]`**。现状 `cursorBefore: string | null`、`kvGet(): string | null`、`ActivityPage.nextCursor: string | null` 都是“明确没有”。

〔结论〕七条落地规则：

1. 配置键可选 → `?`（缺省值在 `DEFAULT_SERVE_CONFIG`）；
2. “查过但不存在” → `null`（如 `getTicketMirror(): TicketMirrorRecord | undefined` 现状用 `undefined`——这是“库里没有行”，可保留；但端口层应统一为 `undefined` 表示“无行”，`null` 表示“有行但值为空”）；
3. “不适用” → 不写字段 + `note` 说明，**不得**写 `null`；
4. 集合为空 → `[]`，不得 `null`；
5. 游标为“尚未消费” → `null`（现状 `kvGet` 返回 `''` 再由引擎还原 `null`，`engine.ts:1584`–`:1585`；这是**持久化形态**，端口层不得泄漏）；
6. 数字缺省 → 不写，不得写 `0`（`0` 是有效值）；
7. 布尔缺省 → 不写，不得写 `false` 冒充“已判定”。

### 5.6 不可变引用

〔结论〕`readonly` 用在**跨层传递**的集合与端口入参上（`readonly PersonRef[]`、`readonly InvokeIntent[]`）；内部可变的 `Map`/`Set` 只在单函数或单拍作用域内使用，不出现在端口签名里。端口返回的数组一律 `readonly`，避免调用方就地 `sort()` 改掉台账顺序。

〔事实〕现状 `Engine.ingest(intents: readonly InvokeIntent[])`、`CompanyRuntimeUpdate.people: readonly PersonRef[]` 已按此纪律。

### 5.7 错误：`Result<T,E>` / category / subcause

〔结论〕三种返回形态，按场景选一，不得混用：

| 形态 | 适用 | 例 |
|---|---|---|
| `Result<T, ClassifiedError>` | 预期失败（拒绝、门不过、版本不符） | `MountResult`、`GateWriteResult` |
| 抛 `ClassifiedError` | 构造期非法、编程错误、不可继续 | `configInvalid(...)`（`packages/contract/src/schemas/errors.ts:54`） |
| 抛原生 `Error` | 仅限“绝不该发生”的断言 | 测试、`throw new Error('unreachable')` |

〔事实〕`ClassifiedError` 现状是 `{ category: ErrorCategory; subcause: string; detail?: string }`，定义在 **`packages/contract/src/ports/kernel.ts:98`**——`category` 是 11 值冻结枚举（同文件 `:85`–`:96`：`GATE_FAIL`/`WORKER_DEAD`/`QA_BACK`/`STALL`/`NO_LANE`/`DISPATCH_FAIL`/`MERGE_CONFLICT`/`LLM_FAIL`/`CONFIG_INVALID`/`EVOLVE_REJECT`/`EXTERNAL_REJECT`），`subcause` 是自由字符串但**必须有稳定命名**（现状 `gw-verify-*`、`gw-action-*`、`gw-empty-ticket`、`store/candidates:verification-window` 等）。**它缺 77 的 `FailureClass`**——全卷 `Err` 无法表达“这次调用失败的性质”，只能靠 `subcause` 反推；这是要修的目标，不是现状已满足。**注意两者不同件**：`configInvalid` 在 `schemas/errors.ts`，`ClassifiedError` 在 `ports/kernel.ts`，不得互指或合并。

〔结论〕目标形状（**两轴一个载体，职责不得互换**）：

```ts
type ErrorCategory =
  | 'GATE_FAIL' | 'WORKER_DEAD' | 'QA_BACK' | 'STALL' | 'NO_LANE' | 'DISPATCH_FAIL'
  | 'MERGE_CONFLICT' | 'LLM_FAIL' | 'CONFIG_INVALID' | 'EVOLVE_REJECT' | 'EXTERNAL_REJECT'   // 故障域（现状 11 值，封闭）

interface ClassifiedError {
  failure: FailureClass     // **处置轴**：重试、断路、对账、升级、判等一律读它
  category: ErrorCategory   // **观测轴**：只用于事件 note 与告警分桶，不驱动业务处置
  subcause: string          // 稳定实现细目（config-yaml-nested、digest-mismatch…），不是失败类
  detail?: string           // 人读补充；过 §5.8，不含秘密与绝对路径
}
```

〔结论〕**处置语义按 `failure`（唯一表；端口不得各自另定）**：

| `failure`（77 原值） | 处置 | 不得 |
|---|---|---|
| `rejected_precondition` | 补齐要件后重试同一请求 | 不得自动重试（缺件时重试必然同结果） |
| `rejected_authority` / `rejected_forbidden` | 先取授权或换路径；不重试 | 不得退避重试、不得吞掉改走直写 |
| `rejected_state` | 走合法出口（77 迁移边）后另提 | 不得原地重试 |
| `rejected_idempotency` | 换键或更正内容 | 不得重试 |
| `rejected_version` | **重读当前版本 + CAS** 后再决定 | 不得盲目重试 |
| `unsupported` | 换绑定/替代路径 | 不得重试 |
| `unavailable` | 退避后重试（串行、计入断路） | 不得并行扇出重试 |
| `timeout` | **先对账**（`REC-06`），再决定 | 不得直接重试、不得改写为失败 |
| `unverified` | **只对账**，不重放 | 不得当成功、不得重放写 |
| `partial` | **只补未完部分**（逐项） | 不得整体重试 |
| `conflict` | **先裁决**（人或规则），裁决前不写 | 不得整体重试，也不得开“改进单”代替裁决 |
| `cancelled` | 不重试；需要则新请求 | 不得续跑 |
| `degraded` | 视降级条件是否消失再试 | 不得静默重试 |

〔结论〕**`category` 改为“缺省值 + 领域显式覆盖”，不再是一张按 `failure` 唯一命中的表**：

| `failure` | 缺省 `category` | 允许的显式覆盖 |
|---|---|---|
| `rejected_precondition` | `CONFIG_INVALID` | **只有**“HTTP 外部面路由不存在”（404，`subcause:'not-found'`）写 `EXTERNAL_REJECT`——那是调用面走错，不是配置缺件；配置/内部形状错误一律保持 `CONFIG_INVALID` |
| `rejected_authority` / `rejected_forbidden` / `rejected_state` / `rejected_idempotency` | `EXTERNAL_REJECT` | **只有显式 lane 上下文**（泳道入口/派工闸，手里有 lane 标识）才可写 `NO_LANE`；缺省**不是** `NO_LANE` |
| `rejected_version` | `EVOLVE_REJECT` | —（含 `schema-ahead` / `schema-behind`） |
| `unsupported` / `unverified` | `EVOLVE_REJECT` | — |
| `unavailable` / `partial` / `timeout` / `cancelled` / `degraded` | `STALL` | — |
| `conflict` | `EXTERNAL_REJECT` | **合并域**显式写 `MERGE_CONFLICT`；对账/游标冲突保持缺省 |

端口“错误”行**只写 `failure`（77 下划线字面量）**，`category` 由构造器按上表填缺省、领域代码显式覆盖；不得把 `failure` 塞进 `category`，也不得用 `category` 当业务判据（处置一律读 `failure`）。

〔结论〕**`Err` 可达的 `category` 只有 6 个**：`CONFIG_INVALID`、`EVOLVE_REJECT`、`EXTERNAL_REJECT`、`STALL`、`MERGE_CONFLICT`、`NO_LANE`。其余 5 个（`GATE_FAIL` / `WORKER_DEAD` / `QA_BACK` / `DISPATCH_FAIL` / `LLM_FAIL`）是**内部事件与熔断**的故障域，不得从普通 `Err` 里选：构造器拒收，负向测试锁住。`category` 值域不扩、`FailureClass` 词表不扩（77 冻结的 14 类）。

〔结论〕**构造入口只有一个**（目标；落 **`packages/contract/src/schemas/errors.ts`**，与 `configInvalid(...)` **同件**；`ClassifiedError` 类型仍留 `packages/contract/src/ports/kernel.ts:98`，**不另造** `contract/src/errors.ts`）：

```ts
// packages/contract/src/schemas/errors.ts（目标；与 configInvalid 同文件、两个独立导出，互不包壳）
type ErrReachableCategory =
  | 'CONFIG_INVALID' | 'EVOLVE_REJECT' | 'EXTERNAL_REJECT' | 'STALL' | 'MERGE_CONFLICT' | 'NO_LANE'   // 恰 6 个

interface ClassifyInput {
  failure: FailureClass          // 77 的 14 类之一；决定处置
  subcause: string               // 稳定实现细目（连字符；不得当判等键）
  detail?: string                // 人读补充，过 §5.8
  category?: ErrReachableCategory // **可选**：省略 = 按上表推导缺省；给值 = 显式覆盖，必须落在该 failure 允许的覆盖集内
}
declare function classified(input: ClassifyInput): ClassifiedError
// 失败语义（构造期，不是 Result）：
//   failure 不在 77 词表 / category 不在 6 值 / 给了不允许的覆盖 ⇒ configInvalid('classified-input-invalid')
//   （构造期抛，与 schemas/errors.ts 同口径；不返回 Err，也不默默改成某个缺省值继续跑）
```

1. **省略 `category` 是常态**：端口“错误”行只写 `failure` + `subcause`，构造器按上表填缺省；只有合并域（`MERGE_CONFLICT`）、泳道域（`NO_LANE`）与 HTTP 路由不存在（`EXTERNAL_REJECT`）三处允许显式覆盖，别处给值即拒。
2. **`configInvalid(...)` 不是本构造器的分支**：它固定 `failure:'rejected_precondition'`、`category:'CONFIG_INVALID'`（见下条），语义是“配置/构造期非法”，是**构造期抛出**入口；两者**同文件不同职责**（同落 `schemas/errors.ts`），彼此**不互相包壳**——`classified()` 不转调 `configInvalid`、`configInvalid` 也不经 `classified()`，否则两处缺省会漂移。本卷**不另造** `contract/src/errors.ts`。
3. **内部 bug 不造第 15 类**：断言失败/不可达分支仍用 `failure:'rejected_precondition'` + `subcause:'internal-bug'`，`category` 保持 `CONFIG_INVALID`；`FailureClass` 词表由 77 冻结，本卷不新增。

〔结论〕**旧 `category` 分支的适配规则（不得被新映射替代）**：现存按 `category` 决定“重试/断路/开改进单/顺延”的代码（如 `STALL`→退避、`MERGE_CONFLICT`→合并失败、`NO_LANE`→顺延、`GATE_FAIL`→断路）**保留为缺省档**，只在 `failure` 缺位时生效：

1. 新代码**先读 `failure`**，按上表处置；`category` 只喂事件 note 与告警分桶；
2. **不得**把 `timeout` / `unavailable` / `partial` / `cancelled` 一并映射成“整体重试”（分别是先对账/退避/只补未完/不重试）；也**不得**因为 `category='STALL'` 就给 `conflict` 开改进单；
3. 迁移期**双写**：事件 note 同时带 `failure` 与 `category`，旧读方继续读 `category`；尚未补 `failure` 的旧 `Err` 由构造器按 `subcause` 白名单补，补不出时写 `rejected_precondition` + `subcause:'unknown-failure'` 并在告警里单列——这只是过渡补值，**不得**写进契约。

〔结论〕**内部事件进入断路器前必须显式折算，不读自由串**：目标签名 = `failure + subcause`；同一工作/attempt 的同一事件只计一次，普通业务不通过不计技术断路。`GATE_FAIL`（正常质量/验收未过）与 `QA_BACK`（返工）→ `rejected_state`，走合法出口/返工、**不计断路**；`WORKER_DEAD` → `unavailable/worker-dead`，计一次；`DISPATCH_FAIL` 优先保留原始 `ClassifiedError.failure`，不能取得原失败才用 `unavailable/dispatch-unclassified`，不得双重计数；`LLM_FAIL` → `unavailable/llm-unavailable`，`judgeLlmFail` 同此默认（`category` 由缺省得 `STALL`，不得从 `Err` 选 `LLM_FAIL`）。闸门启动不了、模型/宿主不可达归 `unavailable`，超时仍走 `timeout` 的对账路径；只有已声明且验证过的降级方案才可 `degraded`，不得静默降级。内部事件 `category` 可继续用于观测，不等于合法的 `Err.category`。折算表未接入前，旧自由串只允许现状兼容，不能称为目标断路口径。

〔结论〕`configInvalid(...)`（`packages/contract/src/schemas/errors.ts:54`）与所有构造期非法/不可继续的 `throw` 固定 `failure:'rejected_precondition'`、`category:'CONFIG_INVALID'`；内部编程错误（断言失败、不可达分支）用 `subcause:'internal-bug'`，**不造第 15 个 failure**。

〔结论〕HTTP 错误体与审计字段统一为 **`{ error: { failure, category, subcause }, traceId }`**（`error` 内可加 `detail`，过脱敏；`traceId` 在外层，**不是**与 `error` 并列的第三种结构）。`failure` 与 `category` 是 `error` 内并列两键，不得折叠、**不得漏 `failure`**；§9.4 的 401/403/409/422/429/501/503 各自带明确 `failure`。

〔结论〕三个易错点的裁决：

1. **`not_found` 不是 `FailureClass`**：纯查询“不存在”返回 `undefined`（`Result` 包裹时是 `Ok(undefined)`，见下第 5 条）或 `Ok([])`，不得造 `failure:'not_found'`；数据库文件缺失属不可用 ⇒ `Err({ failure:'unavailable', category:'STALL', subcause:'db-missing' })`。**HTTP 路由不存在**是另一件事：它不读台账、也不是“记录不存在”，统一 `404` + `rejected_precondition`/`EXTERNAL_REJECT`/`subcause:'not-found'`（§9.4 状态表）——不得把 404 写成 `EVOLVE_REJECT`（那是版本/演进域），也不得拿它冒充“库里没有这张单”；
2. **schema 版本不匹配**：库更旧/更新一律 `failure:'rejected_version'`、`category:'EVOLVE_REJECT'`，`subcause` 分别 `schema-behind` / `schema-ahead`；**不再写 `CONFIG_INVALID`**（§8.2 同步改）；
3. `subcause` 只作实现细目与日志检索，**不得**被下游当判等键；同一 `failure` 的 `subcause` 可增补，`FailureClass` 词表由 77 冻结。

〔结论〕**拒绝通道统一（55 个端口一体适用，不得两套）**——55 = §6 的 55 个 `#### TS-PORT-*` 标题（SPEC 3 / RULE 1 / AUTH 7 / REC 6 / CMD 1 / DEC 1 / WORK 11 / RES 1 / EXEC 1 / CAP 6 / EFF 1 / EVD 5 / MEM 1 / OBS 1 / OBL 1 / LIFE 4 / BIND 1 / MIG 1 / NOTI 1 / API 1），旧稿的“54”漏计了 `RES-01`：

1. 任何**预期业务拒绝**——即 77-§11.1 的 14 类（`rejected_*`、`unsupported`、`unavailable`、`unverified`、`partial`、`conflict`、`timeout`、`cancelled`、`degraded`）——必须经 `Result<T, ClassifiedError>` 的 `Err` 返回，或经本仓既有等价物（本卷用 `Result`）；
2. **不得**出现“签名裸返回 `Promise<T>`，错误栏却写 `rejected_*`”——那样声明了拒绝却没有承载通道，调用方只能靠抛异常或猜；
3. **不得**把拒绝塞进成功返回值（如 `{status:'rejected'}`），除非该字段本身就是**六态/结论**语义（`ObservationState`、`IntakeOutcome` 的受理五值、`verdict` 三值）——结论不是失败类；
4. `throw ClassifiedError` 只用于**构造期非法、编程错误、不可继续**（如 `configInvalid`）；`throw` 意味着“这次调用没有返回值”；
5. 纯读的 `undefined` 表示**不存在**（未登记/未找到），不是拒绝；`Ok([])` 表示“查到但没有”，也不得与 `unavailable` 混用。

〔结论〕`subcause` 与 77 的字面量是两回事：`subcause` 是实现侧自由字符串，可以带连字符（如 `config-yaml-nested`、`digest-mismatch`）；`FailureClass`/状态枚举等 **77 字面量必须保留下划线原值**（§4.4）：正确写法是 `failure:'rejected_precondition'`，改成驼峰、连字符或空格分词（如 `rejectedPrecondition`、`rejected precondition`）都会让下游判等失败。也不得把 `subcause` 当 `failure` 使用。

〔结论〕逐端口的对应关系：`§6.1–§6.7` 每个端口的“签名”与“错误”两行必须自洽——凡“错误”行出现上述 14 类（即 `failure` 取 77 值），签名必带 `Result<…, ClassifiedError>`，且 `ClassifiedError.failure` 必填。若“错误”行只声明“结论不是失败类”（`RuleOutcome` 的四值、`IntakeOutcome` 的五值、`ObservationState`、`verdict`、`ThresholdState`），则这些**结果值**留在成功返回里，**不是**拒绝通道；端口本身仍可用 `Result` 包裹（如 `RULE-01` 的 `evaluate` 返回 `Result<RuleOutcome, ClassifiedError>`，而 `refused` 仍是 `Ok` 里的第四值）。


### 5.8 秘密安全的错误

〔结论〕错误消息、日志、事件 `note` 不得含：

- 凭据值（`gatewaySecret`、`MATRIX_BOT_PASSWORD`、`TAIGA_TOKEN`、`MATRIX_HR_SHARED_SECRET`、`wkey` 原文）；
- 完整 token/密码的哈希或前缀（“前 4 位”也不行）；
- 内部绝对路径（含用户名）。

〔事实〕现状 `boot.ts:148` 的错误消息提到 env 名但不含值；`serve.ts:329` 提到 `gatewaySecret` 但只警告不打印。这是正确形态，保持。`gated-platform.ts:31` 明确“署名工号/落款来自 daemon 侧身份入参——调用方不得自带 author/signature 伪造”，这条必须在 `EffectGateway` 端口签名里保留。

### 5.9 不滥用类型体操与 brand

〔结论〕禁止：`Brand<string, 'TicketId'>`、`Opaque<T, K>`、递归条件类型超过两层的“类型级算法”。理由：76/77 的语义不能被类型系统证明，brand 只制造“看起来安全”的假象，且在 Node 原生 strip 下没有运行时保护（79-§1.2）。

〔选择〕需要区分时用**命名清晰的 interface**（`RecordRef` vs `DefinitionRef`），不用 brand。需要“不可混淆”的 ID，用 `Qid.kind` 判别，不用品牌类型。

### 5.10 zod 的定位

〔事实〕79-§3：`z.strictObject` 77 处、`z.looseObject` 用于外部响应、`z.object` 仅 2 处（契约清单）。

〔结论〕zod 是**参考实现的 authoring/binding 工具**，不是第二事实源（D75-08）：

1. 边界分类：内部记录/配置 → `strictObject`（未知键拒）；外部系统响应 → `looseObject`（未知键忽略但保留告警）；只有两处契约清单允许 `z.object`（默认剥离未知键）；
2. zod **不能替代业务规则**：`decide` 的闸序、`RuleEvaluator` 的四种结果、77 的失败分类都不在 zod 里；
3. 不得用 `z.fromJSONSchema()` 反向生成规范（D75-08 明文禁止）；
4. 生成 JSON Schema 只是参考实现，冻结工件由 82 管理。

### 5.11 `DecimalString` 的精确算术

〔结论〕`DecimalString` 不是“把数值塞进字符串”就结束。资源、预算、成本与比较必须使用**同一个纯十进制有理数实现**（目标 `packages/core/src/decimal.ts`，零 IO、无第三方依赖），禁止 `Number()`、`parseFloat()` 或二进制浮点结果作为回退。公开语义见 76-§1.2.1；本卷只给 TS 端口形状。

```ts
interface DecimalOptions {
  scale?: number                              // 整数 0..9；缺省 9，必须按字段声明收紧
  mode?: 'half-even' | 'floor' | 'ceiling'   // 缺省 half-even；预算保守方向必须显式选
}
interface DecimalArithmetic {
  parse(value: string): Result<DecimalString, ClassifiedError>  // 只校验并保留词法，不补零/去尾零
  add(left: DecimalString, right: DecimalString, opts?: DecimalOptions): Result<DecimalString, ClassifiedError>
  sub(left: DecimalString, right: DecimalString, opts?: DecimalOptions): Result<DecimalString, ClassifiedError>
  mul(left: DecimalString, right: DecimalString, opts?: DecimalOptions): Result<DecimalString, ClassifiedError>
  div(left: DecimalString, right: DecimalString, opts?: DecimalOptions): Result<DecimalString, ClassifiedError>
  compare(left: DecimalString, right: DecimalString): Result<-1 | 0 | 1, ClassifiedError>
}
```

1. **表示与算法**：输入先按 76 的语法解析成符号、分子、分母（`bigint`），四则运算以有理数进行并约分；`scale` 只控制输出舍入。`compare` 直接比较精确有理数，不做舍入，故 `1.20` 与 `1.2` 相等，但它们的 `semanticDigest` 仍可不同。
2. **舍入**：默认 `half-even`（ ties-to-even，含负数的对称规则）；只有需要“多收不可少算”或“少配不可多配”的方向时才由调用方显式选 `floor`/`ceiling`。不得根据机器、 locale 或浮点格式改变结果。
3. **边界**：输出最多 34 位有效数字、最多 9 位标度；中间有理数最多 128 位十进制有效数字。超界、无法按声明精度表示 ⇒ `Err({failure:'unsupported', category:'EVOLVE_REJECT', subcause:'decimal-overflow'})`，不得绕回浮点或静默截断。非法词法、负数时长/计数 ⇒ `rejected_precondition`；除零 ⇒ `rejected_precondition` + `subcause:'decimal-divide-by-zero'`。
4. **单位**：调用方必须先证明单位相同；`add`/`sub` 不做隐式币种、时间、token 或注意力换算。换算只能使用带版本的换算规则与精确比率，禁止隐式汇率/时区/宿主时钟。
5. **失败与证据**：所有方法纯函数、可重放，输入与结果保留原始精度依据和 `subcause`。`Number`/`parseFloat`/`Math.*` 不得处理数值本体；数组下标、`scale` 和字符串长度可用普通整数。

最小验收向量（自然语言用例，未执行）：`0.1 + 0.2 = 0.3`；`1.20` 与 `1.2` 比较相等但摘要不强制相同；`-1.5` 在 `scale=0, half-even` 得 `-2`，`2.5` 得 `2`；`1 / 3` 在 `scale=9` 得 `0.333333333`；除零、超 34 位有效数字、超 128 位中间精度均返回上述 `Err`，不得产生近似结果。

---

## 六、公共端口全集

### 6.0 阅读约定与状态矩阵

每个端口按九项书写：**签名 / 参数与返回 / 前置 / 后置 / 错误 / 幂等与预期版本 / 事务与证据 / 版本等级 / 锚点**。签名为伪签名（只写形状，不写函数体）；`Promise` 表示可能 IO，无 `Promise` 表示纯函数。

〔结论〕本卷端口总数 **55**（= §6 的 55 个 `#### TS-PORT-*` 标题；分组见 §5.7：SPEC 3 / RULE 1 / AUTH 7 / REC 6 / CMD 1 / DEC 1 / WORK 11 / RES 1 / EXEC 1 / CAP 6 / EFF 1 / EVD 5 / MEM 1 / OBS 1 / OBL 1 / LIFE 4 / BIND 1 / MIG 1 / NOTI 1 / API 1）。旧稿写 54 是漏计 `RES-01`；别处不得再写 54/53，也不得把“读面路由 16 条”与“端口 55 个”混为一谈（前者是 HTTP 出口，后者是包内端口）。

等级一律 `experimental`（§0.3）。状态列含义：

- **已有**：端口形状与实现都在，且在主循环里被调用；
- **局部**：有等价实现，但语义只覆盖目标的一部分；
- **包装**：不新建实现，用适配层把现有件升到目标端口；
- **新建**：目标端口，当前无对应实现。

| 组 | 端口 | 状态 | 当前等价物 |
|---|---|---|---|
| 规范 | SpecRegistry / DefinitionLoader / PackageImporter | 新建 | 无（公司目录校验器只做形状） |
| 规范 | RuleEvaluator | 新建（纯函数落 `core`） | 无（闸序硬编码在 `decide`） |
| 命令 | CommandIntake / DecisionPort | 新建 | 无（命令由各 `cmd*` 直接调服务；通用决定无记录面） |
| 权威 | AuthorityRequirementSource / CandidateEndpointDirectory / AuthorityActivationPort | 新建 | 无（`WkeyClaims` 只是凭据） |
| 权威 | AuthorityGrantPort / CredentialCatalogPort / IncapacityPort | 新建 | 授予散落在公司目录与 `wkey`；失能判定无 |
| 权威 | WriterLeasePort | 新建 | 泳道租约（`engine/lanes/registry.ts`）是类比物，不是写者围栏 |
| 记录 | RecordWriter / RecordReader | **新建** | 无等价实现：`Ledger.appendEvent`/`queryEvents` 只覆盖 `events` **投影行**（17 列装不下整封信封，也不存载荷字节；§4.6/§6.3），不能当本端口的实现 |
| 记录 | RecordProjection | 包装 | `Ledger.listTicketMirrors` / `listTodoQueue` / `listPeople` |
| 记录 | RecordTransaction | 新建（机制件，**不是命令入口**） | 无（现状是单语句 + 两处 `BEGIN`） |
| 记录 | CorrectionPort / ReconciliationPort | 新建 | 无（修正靠追加约定；对账靠 `runHarvestRecon` 局部） |
| 工作 | WorkIntake / ContractPort / ReadinessGate / ExecutionPlanPort / WorkLifecycle / ExceptionPort / SettlementPort | 新建 | `decide` 的闸序 + `Action` 联合是**局部**等价物 |
| 工作 | QualificationPort / RiskClassifier / AssignmentPort / AttendancePort | 新建 | 资格散见公司目录；风险无分类记录；派工/出工由 `DISPATCH` 事件近似 |
| 资源 | ResourceAccountant | 新建 | 预算闸（`core` 的预算/成本）与 `queryBudget` 只读投影；跨环额度/预留/实际/剩余无公共只读端口（预留/实际/释放的事实记录已有 `REC-WORK-05`/`REC-EVD-01/05/06`，缺的是评估与缺口） |
| 执行 | ExecutorAdapter | 已有 | `contract/ports/executor.ts` + 四适配器 |
| 能力 | CapabilityResolver / Installer / Mounter / Probe / Activator / Retirer | 新建 | `adapters/registry.ts` 的 `detect`/`resolve` 只覆盖“解析” |
| 效果 | EffectGateway | 包装 | `gateway.gateWrite` + `engine/tools/gated-platform.ts` |
| 证据 | EvidenceHarvester | 包装 | `engine.ts` 的 `finalizeHarvest`/`failHarvest` |
| 验收 | AcceptanceEvaluator / ValueAssessmentPort / ReworkPort / ReopenPort | 包装（前）/新建（后三） | `engine/gate.ts` 的 `GateRunner` + 相位 4 `collect`；价值/返工/重开无端口 |
| 记忆 | MemoryStore | 新建 | 无 |
| 观察 | ObservationProjector | 包装 | `panel` 的 `buildDashboardSnapshot` / `inbox` |
| 义务 | ObligationPort | 新建 | 无（义务只在章程里） |
| 身份 | IdentityLifecyclePort / HandoverArchivePort / SuccessionPort / AppointmentPort | 新建 | 无（身份状态散见公司目录；任免无记录面） |
| 绑定 | PlatformBindingPort | 包装 | `FlowPlatform`（形状是“平台能力”，不是“绑定档案”） |
| 迁移 | MigrationService | 新建 | `store/migrations.ts` 只做 schema 迁移 |
| 通知 | Notifier | 已有（端口）/局部（实现） | `contract/ports/notifier.ts` + `matrix` 三面 |
| 提交 | IntentSubmissionPort | 新建 | 无（`POST /v1/requests` 直写 `daemon_kv` 幂等键 + `platform.issues.create`） |

〔结论〕上表“新建”不是“从零写”，而是“当前没有可被主循环调用的端口”。实现可以复用既有函数；但**不得**把“已有函数换个名字”当作端口已具备语义。

### 6.1 规范面：注册、装载、导入、求值

#### TS-PORT-SPEC-01 `SpecRegistry`

- **签名**：`register(entry: SpecEntry): Result<void, ClassifiedError>`；`resolve(name: string, version: SemVer): Result<SpecEntry, ClassifiedError>`；`list(): readonly SpecEntry[]`
- **参数与返回**：`SpecEntry = { name: string; version: SemVer; semanticDigest: Digest; schemaUri?: string; status: 'draft'|'published'|'deprecated' }`；返回不可变视图
- **前置**：`semanticDigest` 已按 §4.5 计算；`version` 是完整 SemVer
- **后置**：注册成功后可被 `resolve`；同一 `(name, version)` 重复注册且摘要一致 = 幂等成功，摘要不一致 = 拒
- **错误**：`E-REF-003`（未登记/版本不符）⇒ `Err({failure:'rejected_version', category:'EVOLVE_REJECT', subcause:'spec-unresolved'})`（**不是** `CONFIG_INVALID`：配置能读到，是版本不成立）；同一 `(name, version)` 摘要冲突 ⇒ `failure:'rejected_version'` + `subcause:'spec-digest-mismatch'`
- **幂等/预期版本**：按 `(name, version)` 幂等；不做“最新版本”解析，调用方必须给完整版本
- **事务与证据**：注册是内存表 + 可选持久化投影；证据=注册条目本身（含摘要）
- **等级/锚点**：experimental；76-§8 七条版本轴、D75-09

#### TS-PORT-SPEC-02 `DefinitionLoader`

- **签名**：`load(source: DefinitionSource): Promise<Result<DefinitionBundle, ClassifiedError>>`
- **参数与返回**：`DefinitionSource = { kind: 'directory'|'archive'; locator: string; expectedDigest?: Digest }`；`DefinitionBundle` 含 part 清单（每 part 带类型、摘要、来源）
- **前置**：locator 已过路径 containment（§11.2）；`expectedDigest` 给定时必须匹配
- **后置**：只读装载，**不激活**；不得写回源；不得执行任何 part
- **错误**：路径越界 `path-escape`；摘要不符 `digest-mismatch`；纯配置违规（含可执行内容/秘密/绝对路径）`definition-not-pure`
- **幂等/预期版本**：同一 locator + 同一摘要 = 幂等；源变更后摘要变 → 必须显式 reload，不自动替换
- **事务与证据**：无写事务；证据=每 part 的 `byteDigest` + `semanticDigest` + 来源
- **等级/锚点**：experimental；76-§2.8、D75-04、§4.3 纯配置否定约束

#### TS-PORT-SPEC-03 `PackageImporter`

- **签名**：`plan(bundle: DefinitionBundle, target: ImportTarget): Result<ImportPlan, ClassifiedError>`；`apply(plan: ImportPlan): Promise<Result<ImportReceipt, ClassifiedError>>`
- **参数与返回**：`ImportPlan` 是六步编排的可审清单（校验→冲突检测→映射→暂存→提交→回执）；`ImportReceipt` 是 `REC-RCP-01` 的投影
- **前置**：`bundle` 已 `DefinitionLoader.load` 且为纯配置；`target` 已存在或可创建
- **后置**：**导入 ≠ 激活**。导入只让定义可用；激活是 `TS-PORT-AUTH-03` 的事
- **错误**：冲突（同名不同摘要）`import-conflict`；六步中任一步失败必须整体回滚到暂存前，不得半导入
- **幂等/预期版本**：以 `(bundleDigest, targetId)` 为幂等键；重复导入同一 bundle = 返回既有回执（`appended:false` 语义）
- **事务与证据**：`apply` 是一个逻辑事务；证据=六步每步的开始/结束事件 + 最终回执
- **等级/锚点**：experimental；76-§2.8 六步、75-§四、D75-04

#### TS-PORT-RULE-01 `RuleEvaluator`

〔结论〕求值**分两步，不合并**：`typecheck` 判“这条规则在这组输入声明上合不合法”，`evaluate` 只在判过之后跑。类型错误在求值前拒绝（76-§6.5 第 3 条、§6.7 两条防滥用规则）；运行期错误才产生 `refused`。

- **签名**：`typecheck(profile: RuleProfile, decl: RuleInputDecl): Result<TypecheckReceipt, ClassifiedError>`；`evaluate(profile: RuleProfile, ref: RuleProfileRef, input: RuleInput, tightening: RuleLimitTightening): Result<RuleOutcome, ClassifiedError>`
- **参数与返回（目标 TS 形状；只是 76-§6 的映射，不重新定义）**：

```ts
// 档：由 DefinitionLoader 装载 + typecheck 过的只读值（深冻结、无 getter），不是 id
type RuleType =
  | 'Bool' | 'Int' | 'Str' | 'Ts' | 'Dur'
  | { kind: 'Dec'; scale: number }
  | { kind: 'Enum'; vocab: string; version: SemVer }
  | { kind: 'List'; element: RuleType }
  | { kind: 'Rec'; name: string }
type RuleLiteral =
  | { type: 'bool'; value: boolean } | { type: 'int'; value: DecimalString }
  | { type: 'dec'; value: DecimalString; scale: number }
  | { type: 'str'; value: string } | { type: 'ts'; value: Timestamp }
  | { type: 'dur'; value: DurationString }
  | { type: 'enum'; vocab: string; version: SemVer; code: string }
  | { type: 'null' }
type RuleNode =
  | { kind: 'literal'; value: RuleLiteral }
  | { kind: 'input'; rootName: string; fieldPath: RuleFieldPath }
  | { kind: 'var'; name: string }
  | { kind: 'call'; operator: string; args: readonly RuleNode[] }
  | { kind: 'if'; condition: RuleNode; then: RuleNode; else: RuleNode }
  | { kind: 'quantifier'; operator: 'all' | 'any'; variable: string; list: RuleNode; predicate: RuleNode }
  | { kind: 'presence'; operator: 'present' | 'absent' | 'isNull'; input: Extract<RuleNode, {kind:'input'}> }

interface RuleProfile {
  profileId: Qid                         // kind=rule-profile；不是绑定 ID
  version: SemVer
  status: 'published' | 'deprecated' | 'withdrawn'
  publishedAt: Timestamp
  semanticDigest: Digest                 // 与 RuleProfileRef.digest 同值
  inputDecl: RuleInputDecl
  root: RuleNode                         // 结构化树，不是待 eval 的字符串
  typeSystem: {
    types: readonly RuleType[]
    subtyping: 'none'
    conversions: readonly ('dec(Int)' | 'int(Dec)')[]
    decimalContext: { precision: 34; rounding: 'half-even' }
  }
  operators: readonly { name: string; arity: number; signature: { params: readonly RuleType[]; result: RuleType }; semanticsNote: string }[]
  limits: RuleLimits & { maxPatternInputCodePoints: number; maxPatternSteps: number; maxQuantifierDepth: number }
  patternModel: {
    matchingModel: 'linear-nfa'; anchoring: 'full-string'
    dotMatchesNewline: false; maxQuantifierBound: 1000
    syntax: readonly ('literal-char' | 'char-class' | 'dot' | 'anchors' | 'quantifier' | 'group' | 'alternation' | 'escape-class')[]
  }
  determinism: {
    hostIO: 'forbidden'; unicodeVersion: string; newline: 'LF'
    normalizedComparison: boolean
    implementationId: string; implementationVersion: string
  }
  diagnosticCodes: readonly RuleDiagnosticCode[]
  casesRef: DefinitionRef
}
type RuleProfileRef = ProfileRef           // 复用 TS-REF-06；不再另造 bindingId 别名

type RuleScalar = string | boolean | null  // Int/Dec 用 DecimalString 保留词法；仅共享算术内核转 bigint；不得把 number 当数值本体
type RuleFieldPath = readonly string[]        // 静态路径：只允许档内声明过的字段段，禁止计算/索引/通配表达式

interface RuleInputDecl {                     // = 档内 inputDecl 的扁平投影；typecheck 用它
  roots: readonly {
    name: string
    fields: readonly {
      path: RuleFieldPath
      type: RuleType
      required: boolean
      nullable: boolean
      absenceTolerant: boolean              // 逐字段显式声明；缺省 false，不得整组放行
      default?: RuleLiteral                 // defaultOf 只能使用已声明值；产生 W-RULE-005
    }[]
  }[]
}
interface RuleInputRoot {
  name: string                                // 对应 inputDecl 的根名
  values: Readonly<Record<string, RuleScalar | readonly RuleScalar[]>>   // 静态路径 → 值（纯数据）
  missing: readonly RuleFieldPath[]           // 显式“缺失”（≠ null）；未列入且无值 = 必需字段缺失
  absenceTolerant: readonly RuleFieldPath[]   // 仅这些路径缺失可得 unknown（默认不放宽）
}
interface RuleInput { roots: readonly RuleInputRoot[]; observedAt?: Timestamp }   // 观察时间由调用方给

interface RuleLimits {                        // 76-§6.9 **仅七项可收紧限额**；生效值逐项 = min(档内声明, 调用侧收紧)
  maxNodes: number                            // 表达式节点数
  maxDepth: number                            // 嵌套深度
  maxListItems: number                        // 列表元素数（输入与中间结果）
  maxStringCodePoints: number                 // 字符串长度
  maxDecimalDigits: number                    // 十进制有效数字
  maxDecimalScale: number                     // 小数标度
  maxSteps: number                            // 求值总步数
}
// 调用侧收紧参数：未给 = 不收紧（生效值取档内声明）；给了只能更严，更松即拒（76-§6.9、§8.1 跨作用域取更严者）
type RuleLimitTightening = Partial<RuleLimits>
// 76-§6.9 的另三项**档内固定**、不在 RuleLimits 内：模式输入长度、模式匹配步数、量词嵌套层数。
// 调用侧既不得放宽也不得收紧，只能随 profileRef 锁定；把这三项塞进 RuleLimits 即映射缺陷。

interface DiagnosticBase {                    // = 76 DEF-DIAG-01 的 TS 映射（§1.7，字段名以 76 为准）
  code: RuleDiagnosticCode                   // **封闭**：只取 76-§6.12 登记码，不得任意 string
  severity: 'error' | 'warning' | 'info'
  location: RuleFieldPath                    // = 76 的 location：语义路径（成员路径+下标），不得用“第几行”
  ruleId?: string                             // 档内规则条目 ID；整档级诊断可缺
  subjectRef?: SubjectRef                     // 可选主体引用（诊断指向哪条记录/哪个定义）
  profileRef?: RuleProfileRef                 // 诊断所属档（整档级必填；条目级可从外层继承）
  evidenceRef?: Qid                           // 支撑证据（如命中片段的记录/材料引用）；无则不填
  messageKey: string; messageArgs: readonly string[]   // = 76 的 message 的可本地化形态；明文 message 只由展示层渲染
  expected?: string; actual?: string          // = 76 的 expected / actual（短文本或类型名，非秘密、非绝对路径；不收集进 safeDetails 之类的容器）
}
// `limitsApplied` 的必填性由 phase 判别：76-§1.7 要求 phase='limit' 必填、其余 phase 不得出现
type Diagnostic =
  | (DiagnosticBase & { phase: 'limit'; code: 'E-RULE-003'; limitsApplied: RuleLimits })
  | (DiagnosticBase & { phase: Exclude<DiagnosticPhase, 'limit'>; limitsApplied?: never })

type RuleDiagnosticCode =                     // 76-§6.12 登记码全集：18 个
  | 'E-RULE-001' | 'E-RULE-002' | 'E-RULE-003' | 'E-RULE-004' | 'E-RULE-005' | 'E-RULE-006'
  | 'E-RULE-007' | 'E-RULE-008' | 'E-RULE-009' | 'E-RULE-010' | 'E-RULE-011' | 'E-RULE-012'
  | 'E-RULE-013' | 'E-RULE-014' | 'E-RULE-020'
  | 'W-RULE-001' | 'W-RULE-002' | 'W-RULE-005'
type DiagnosticPhase = 'parse' | 'structure' | 'refResolve' | 'typecheck' | 'eval' | 'limit' | 'policy' | 'io'

interface RuleTraceStep { seq: number; node: string; steps: number }
interface RuleOutcome {                               // 76-§6.8：恰好七个字段，不得增删或改必填性
  outcome: 'true' | 'false' | 'unknown' | 'refused'   // 76-§6.8 四值，不得合并（unknown=输入不足；refused=求值中止）
  profileRef: RuleProfileRef                          // 实际使用的档；digest **必须是 semanticDigest**（带 canonicalizationId/version），禁用 byteDigest 顶替
  inputsDigest: Digest                                // 实际参与求值的输入快照摘要；**必须是 semanticDigest**（否则键序/空白差异永远对不上）
  steps: number                                       // 实际步数（整数；用于确定性与限额核对）
  limitsApplied: RuleLimits                           // 必填：七项生效值（证明调用方没有放宽；缺此项即无法对账）
  diagnostics: readonly Diagnostic[]
  trace?: { steps: readonly RuleTraceStep[]; truncated: boolean }   // 可选；截断必须标 true，截断片段不得当完整轨迹
}
interface TypecheckReceipt {
  profileRef: RuleProfileRef        // 取自**已装载 profile 自身**的 semanticDigest/version，不由调用方另给；digest 同规则（semanticDigest）
  inputDeclDigest: Digest
  limitsApplied: RuleLimits         // 七项全量；同样只报告可收紧项，档内固定三项不出现
  diagnostics: readonly Diagnostic[]
}
```

**摘要、版本与策略诊断的唯一入口**：`createRuleEvaluator({ canonicalizer })` 注入 §4.5 的 `Canonicalizer`，不增加 `typecheck`/`evaluate` 的参数。`inputDeclDigest` 对**档内声明的原始 JSON 快照**计算，`inputsDigest` 对**实际输入的原始 JSON 快照**计算；Int/Dec 在快照里保留 `DecimalString` 词法，之后才进入纯核，不在摘要前转 `number` 或 `bigint`。两个结果都是 `semanticDigest`，`canonicalizationId/version` 由同一个 canonicalizer 成对给出，再取 SHA-256；`RuleProfile.semanticDigest` 必须与 `RuleProfileRef.digest` 相同。

档本身不可解析或版本无法成立 ⇒ `Err(rejected_version)`；档已解析但其内部引用版本不符或撤回 ⇒ `Ok(refused)` + `E-RULE-020`。相位表是诊断登记，不表示同一函数产生所有码：`W-RULE-001`（unknown 的方向处置）与 `W-RULE-002`（未覆盖）由**策略消费方**依据条目状态产生，纯 `RuleEvaluator` 只回求值四值及 `W-RULE-005`，不向 `RuleInput` 偷塞策略条目。

**码 → 相位固定映射**（76-§6.12 逐码，不得按大类猜；登记码共 **18** 个 = `E-RULE-001`–`014` + `E-RULE-020` + `W-RULE-001`/`W-RULE-002`/`W-RULE-005`，`E-RULE-015`–`019` 是保留段不分配）：

| 相位 | 码 |
|---|---|
| `parse` | `E-RULE-001`（结构不合法）、`E-RULE-002`（算子不在本档）、`E-RULE-014`（被禁止的构造） |
| `typecheck` | `E-RULE-004`、`E-RULE-005`、`E-RULE-006`、`E-RULE-011`、`E-RULE-013`；`W-RULE-001`、`W-RULE-005` |
| `eval` | `E-RULE-007`（除零）、`E-RULE-008`（溢出/标度/空聚合）、`E-RULE-009`（模式超限）、`E-RULE-010`（枚举码不在词表）、`E-RULE-012`（步数超限） |
| `limit` | `E-RULE-003`（节点数/深度/列表/字符串/量词嵌套超限） |
| `policy` | `E-RULE-020`（档版本不一致或被撤回）、`W-RULE-002`（判定落到未覆盖面，**不是错误**） |

`W-RULE-002` 是**合法策略结论的必报项**：命中显式 `uncovered` 条目时 `subjectRef` 指向该条目、`messageArgs` 首项为条目标识；无任何条目命中时 `subjectRef` 留空、首项写 `no-match`（76-§3.12、§6.12）。二者处置相同（不得执行、只能受理与请求决定）但诊断必须分开，因为“未覆盖”与“允许”在日志上不可分辨即为缺陷。`Diagnostic` 的判别联合把 `phase='limit'` 收窄到 `code='E-RULE-003'`，这是 76-§6.12 现行表的直接后果；若 76 将来登记第二个 `limit` 相位码，先改 76 再放宽此处，**不得**在本卷预留“别的 limit 码”。

实现**不得**把“规模类”一律写成 `limit`（`E-RULE-012` 是步数、归 `eval`），也不得给未登记码自造相位。`DiagnosticPhase` 里的 `'structure'`/`'refResolve'`/`'io'` 来自 76 `DEF-DIAG-01` 的完整词表，但**当前没有任何登记码落在这三个相位**：不得把它们当“其他”桶兜底；`'io'` 本纯函数**不得产生**（没有 IO）。

- **前置**：`profile` 已由 `DefinitionLoader`/`SpecRegistry` 解析且 `typecheck` 通过（没过的档不得进 `evaluate`）；`ref` 的 `profileId/version/digest` 与 `profile` 实际一致（`digest` 是 `semanticDigest`）；`input` 是纯数据（无函数、无 getter、无类实例、无 `Date`）；`tightening` 逐项**不得比档内声明更松**（更松即 `rejected_precondition`，不得静默取更松者）。`typecheck` 的 `profileRef` **取自本档自身**（`semanticDigest/version`），调用方不再另传一份“档引用”去和内容对撞。
- **后置**：纯函数——**不 fetch、不读宿主时间、不读文件/env、不用网络/随机/模型**；同 profile、同输入、同步数上限 ⇒ 同结果（76-§6.11）。
- **错误**：类型错误（`E-RULE-004/005/006/011/013`）在 `typecheck` 即 `Err({failure:'rejected_precondition', category:'CONFIG_INVALID', subcause:'rule-typecheck'})`，**不进 `evaluate`**；档不可解析或版本不符 ⇒ `Err({failure:'rejected_version', category:'EVOLVE_REJECT', …})`；输入引用无法静态解析 ⇒ `rejected_precondition`；`tightening` 试图收/放档内固定三项或比档内更松 ⇒ `rejected_precondition`；宿主墙钟护栏触发 ⇒ `Err({failure:'timeout', category:'STALL', subcause:'host-clock-guard'})`（**不进 `RuleOutcome`，更不得记 `false`**）。
- **`refused` 留在 `Ok`**：它是 76 定义的第四结果（运行期错误、步数/规模超限），调用方按拒绝路径处理，不得读成 `false`。限额超限 ⇒ `outcome='refused'` + 对应 `RuleDiagnosticCode`（相位按上表：`E-RULE-003` → `limit`，`E-RULE-008/009/012` → `eval`）；`phase='limit'` 的诊断必带 `limitsApplied`，`RuleOutcome.limitsApplied` 亦必填实际值；**限额/墙钟都不得折算布尔**。
- **幂等/预期版本**：天然幂等；档三件（id/version/digest）由调用方钉住，求值器**不得**只拿 id 去猜档内容。
- **事务与证据**：无事务；证据 = `profileRef` + `inputsDigest` + `steps` + 诊断（可重复核对）。
- **等级/锚点**：experimental；76-§6.8 结果形态、§6.9 限额、§6.5 三值与方向表、§1.7 诊断、§6.11 确定性。

〔结论〕`RuleEvaluator` 不得放在 `daemon`：纯函数落 `core`（零 `node:fs`），公共类型落 `contract`。

### 6.2 权威面：需求、候选、激活、围栏

#### TS-PORT-AUTH-01 `AuthorityRequirementSource`

- **签名**：`requirementsFor(factDomain: string): Result<readonly AuthorityRequirement[], ClassifiedError>`
- **参数与返回**：`AuthorityRequirement` 的字段归 76（`DEF-AUTHREQ-01`）；本端口只给“按事实域取需求”
- **前置**：`factDomain` 已登记；调用方有读权（读权 ≠ 授权）
- **后置**：只读；返回空数组 = “该域无需求声明”，不是“无需权威”
- **错误**：未登记域 `authority-domain-unknown`
- **幂等/预期版本**：纯读，幂等；返回项带 `VersionRef`
- **事务与证据**：无
- **等级/锚点**：experimental；76-`DEF-AUTHREQ-01`、69-§3.3、D75-05

#### TS-PORT-AUTH-02 `CandidateEndpointDirectory`

- **签名**：`candidates(factDomain: string): Promise<Result<readonly CandidateEndpoint[], ClassifiedError>>`；`describe(endpointId: string): Promise<Result<CandidateEndpointProfile, ClassifiedError>>`
- **参数与返回**：`CandidateEndpoint` 字段归 78；含“供给确认”时间与来源，**不含**“已授权”标记
- **前置**：部署已登记该端点（78 绑定档案）
- **后置**：只读；**不得**因端点可达就返回“可用”
- **错误**：端点不可达 ≠ 无候选——`Err(unavailable)`（77-§11.1 失败类，不是 §9.2 六态）与 `Ok([])`（真的没有候选）必须可区分；两者都不得被读成“可用”
- **幂等/预期版本**：读幂等；`describe` 结果带探测时间戳
- **事务与证据**：探测结果落 `REC-AUTH-04` 的引用侧（凭据引用）或 `REC-EVT-02`（对账）
- **等级/锚点**：experimental；76-`DEF-EP-01`、78-§1.4（供给/授权/生效三线）、78-§1.3（“已加载”要求部署供给确认）、D75-05

#### TS-PORT-AUTH-03 `AuthorityActivationPort`

- **签名**：`activate(req: ActivationRequest): Promise<Result<ActivationReceipt, ClassifiedError>>`；`current(factDomain: string): Result<ActivationView, ClassifiedError>`
- **参数与返回**：`ActivationRequest` 必须带 `authorityRef`（谁依何权）、`endpointId`、`generation`（**治理代次**）、`scope`、`validity`；`ActivationView` 含当前激活端点与代次
- **前置**：`authorityRef` 可解析；同一事实域的激活必须走 CAS（见 §8.3）
- **后置**：产出 `REC-AUTH-07`（含 decision facet）；**治理代次 ≠ 技术围栏**，不得把 `generation` 写进 `fenceToken`
- **错误**：无权重 `rejected_authority`；代次冲突 `rejected_version`；无互认围栏且需并发双写 `unsupported`（只能独占交接）
- **幂等/预期版本**：以 `(factDomain, generation)` 幂等；换代必须 `expectedGeneration` CAS
- **事务与证据**：激活是一次持久 CAS；证据=激活记录 + 回执
- **等级/锚点**：experimental；77-§3.7、`RUN-AUTH-01`、`RUN-AUTH-02`、D75-05

#### TS-PORT-AUTH-04 `WriterLeasePort`

- **签名**：`acquire(scope: LeaseScope, holder: WriterId, ttlMs: number): Promise<Result<LeaseGrant, ClassifiedError>>`；`renew(leaseId: string, fence: FenceToken): Promise<Result<LeaseGrant, ClassifiedError>>`；`release(leaseId: string, fence: FenceToken): Promise<void>`
- **参数与返回**：`LeaseGrant = { leaseId; fence: FenceToken; expiresAt: Timestamp }`；`FenceToken` 单调递增，**每次 acquire/renew 都换**
- **前置**：`scope` 是**写者域**（哪张表/哪个事实域），不是“单号”
- **后置**：持有者每次写都必须带 `fence`；存储端拒绝旧 fence 的写
- **错误**：租约被占 `rejected_state`；fence 过期 `rejected_version`；跨进程无互认围栏 `unsupported`
- **幂等/预期版本**：`acquire` 非幂等（每次给新 fence）；`release` 幂等
- **事务与证据**：租约表 + `REC-AUTH-05`；围栏观测 `REC-AUTH-06`
- **等级/锚点**：experimental；77-§3.5/§3.6、`RUN-AUTH-03`、§8.5

〔结论〕现有 `lanes`（泳道租约，`engine/lanes/registry.ts`）**不是** `WriterLeasePort`：泳道是“派发互斥”，租约是“写者互斥”。两者可共用 TTL 实现，但语义、记录、fence 都不同，不得合并命名。

#### TS-PORT-AUTH-05 `AuthorityGrantPort`

- **签名**：`grant(req: GrantRequest): Promise<Result<RecGrantEdge, ClassifiedError>>`；`exercise(req: ExerciseRequest): Promise<Result<RecAuthorityExercise, ClassifiedError>>`；`withdraw(req: WithdrawalRequest): Promise<Result<RecAuthorityWithdrawal, ClassifiedError>>`；`chain(grantId: Qid): Promise<readonly RecGrantEdge[]>`
- **参数与返回**：`GrantRequest` 含 `grantor/grantee/parentGrant?/purpose/object/scope/conditions/term/delegable/withdrawalTerms`；`WithdrawalRequest` 必须带 `inFlightInventory` 与 `credentialActions`（77-§3.3）
- **前置**：授予者有权授予；转授必须有父授予且 `delegable=true`；行使必须在目的/范围/条件/期限内；撤回必须已清点在途动作、未结承诺、已发凭据
- **后置**：只追加 `REC-AUTH-01/02/03`；行使**不得**反向扩大授予；撤回只发通知不算完成，运行时仍暴露即记“已生效但授权撤回”
- **错误**：父链断/过期/已撤回/禁配 → `rejected_authority`；版本不符 `rejected_version`；在途未清点 `rejected_precondition`
- **幂等/预期版本**：授予按 `(grantor, grantee, scope, term)` 幂等；行使按 `(grantRef, actionRef)` 幂等；撤回按 `(grantRef, reason, effectiveAt)` 幂等
- **事务与证据**：三条记录在同一写域追加；证据=授予边 + 行使范围 + 撤回清单
- **等级/锚点**：experimental；77-§3.1–§3.3、`RUN-AUTH-01`–`RUN-AUTH-03`

#### TS-PORT-AUTH-06 `CredentialCatalogPort`

- **签名**：`register(ref: CredentialRefDraft): Promise<Result<Qid, ClassifiedError>>`；`resolve(id: Qid): Promise<Result<CredentialRef | undefined, ClassifiedError>>`（`undefined`=未登记，不是拒绝）；`revoke(id: Qid, proof: RevocationProof): Promise<Result<void, ClassifiedError>>`
- **参数与返回**：`CredentialRef` 只含引用侧（提供方、绑定、范围、到期、吊销状态）；**不含凭据值**
- **前置**：值由部署面（env/密钥库）供给；登记时必须已有来源声明
- **后置**：`resolve` 返回引用与状态；吊销后解析为不可用；目录**不得**成为凭据值的第二存放处
- **错误**：未知引用 `unsupported`；检测到值入目录 `rejected_forbidden`；过期/已吊销 `rejected_authority`
- **幂等/预期版本**：登记按引用摘要幂等；吊销幂等
- **事务与证据**：`REC-AUTH-04`；证据=引用 + 吊销证明
- **持久面与编排（本卷已定）**：持久适配落 **`store/src/records/credentials.ts`**——只存**逻辑引用**（`secretId`/提供方/绑定/范围）、**版本**、**到期**、**吊销状态**，**不存值**；复用通用 `records` 表（`events` 面）按 `REC-AUTH-04` 追加与查询，**不新建第二张秘密表**、不新增投影名（§6.3 的 17+1 名单不变），因此**不扩 `MIG-01` 波次**（无 schema 变更）。`assembly/auth/credentials.ts` **只做端口编排**（来源声明校验、`CredentialRefDraft → REC-AUTH-04` 映射、`resolve` 状态拼装、`revoke` 证明校验），不自己拼 SQL、不做持久化决策。`register` 检测到值/`secretId` 以外可解析的材料 ⇒ `rejected_forbidden`（值不得过这一层）。
- **等级/锚点**：experimental；77-§3.4、§11.2

#### TS-PORT-AUTH-07 `IncapacityPort`

- **签名**：`determine(req: IncapacityRequest): Promise<Result<RecIncapacityDetermination, ClassifiedError>>`；`recoveryPreconditions(subject: SubjectRef): Promise<readonly RecoveryPrecondition[]>`
- **参数与返回**：`IncapacityRequest` 含 `subject/failureClass/evidence/judgedBy/scopeAndTerm/freezeEffect/recoveryPreconditions/notified/dissentPosition`（77-§3.8）
- **前置**：`judgedBy` 必须由预设继任/再指定程序指定，不得由被判主体自设；证据须有时间窗
- **后置**：产出 `REC-AUTH-08`（decision facet）；冻结清单内动作；**不**自行转移权威（转移是 `TS-PORT-AUTH-03`）
- **错误**：无宪制依据 `rejected_authority`（只能作意见记录）；范围/期限未定 `rejected_precondition`
- **幂等/预期版本**：按 `(subject, scope, effectiveWindow)` 幂等；复审到期无结论 → 升级
- **事务与证据**：判定记录 + 通知清单；证据=探测/回执/外部通知
- **等级/锚点**：experimental；77-§3.8、§11.1 `degraded`

### 6.3 记录面：写、读、载荷、投影、事务

#### TS-PORT-REC-01 `RecordWriter`

- **签名**：`append(input: RecordWriteInput, opts?: AppendOptions): Promise<Result<AppendReceipt, ClassifiedError>>`——**不再只收信封**：只收 `env` 时 `payloadRef` 就是一根无从核对的指针（现状即此缺陷：`events` 17 列既装不下整封、也不存字节，§4.6）。
- **参数与返回**：**信封与载荷字节分开传**（两份材料，不是一件事）：

```ts
interface RecordPayload {
  ref: ArtifactRef         // 必须与 envelope.payloadRef 逐字段同值
  bytes: Uint8Array        // 原始载荷字节：未解析、未规范化、未压缩
  mediaType: string        // 必须等于 ref.mediaType
}
interface RecordWriteInput {
  envelope: RecordEnvelope<unknown>   // §4.2 的整封
  payload: RecordPayload              // 与信封同一次写入的载荷
}
```

  `ref.contentDigest` 是 `bytes` 的 **`byteDigest`**（76-§1.5：不得是语义摘要、不得带 `canonicalizationId/version`）；`storageHint` 只是逻辑定位，**不是本机路径、不是可读性证明、不是权限凭证**（§4.2）。`AppendOptions = { authorityDomain?: string; expectedLineageHead?: Qid; expectedTypeVersion?: SemVer; idempotencyKey?: string; writerLease?: WriterLeaseRef; fence?: FenceToken }`；`WriterLeaseRef = { leaseId: string; fence: FenceToken }`（来自 `TS-PORT-AUTH-04`，**只在该事实域存在多写者/跨进程写时给**；daemon 单写者路径可省）；`AppendReceipt = { recordId: Qid; deduped: boolean }`（不变）。`expectedLineageHead` = 本记录要接上的**链顶记录** `recordId`（取自 76 `RecordEnvelope.lineage` 的 `parentRefs`/`supersedes` 最新一环），不是新造的实例代次标量；`expectedTypeVersion` = 该 `REC-*` 的**类型版本**（76 的 `recordType.version`）。**淘汰自造联合** `AppendResult{appended:false; reason:'duplicate_identical'|'rejected'}`——它的 `reason:'rejected'` 没有 `category`，等于宣布了拒绝却没有通道（§5.7）
- **`authorityDomain` 填法（不得猜）**：仅当**规则注册表能唯一定域**（恰好一条 `AuthorityRequirement` 覆盖该 `recordType`）时可省；多域覆盖或存在歧义时**必填**，缺失即 `Err({failure:'rejected_precondition', subcause:'authority-domain-ambiguous'})`。**不得**按“第一个命中”“字典序最小”“默认域”或表名猜一个。解析出的域写进 `records` 的索引列（§6.3 存储不变量），且必须等于 `TxScope.authorityDomain`（不一致 ⇒ `Err({failure:'rejected_precondition', subcause:'tx-scope-domain-mismatch'})`）；该域是否**允许**此 `recordType` 由 `TS-PORT-AUTH-01` 的需求声明 + `TS-PORT-AUTH-03` 的**当前激活**判定，不允许 ⇒ `rejected_authority`。
- **前置**（缺一即拒，且**零行写入**）：① `validateRecord(env)` 通过；② `payload.ref` 与 `envelope.payloadRef` 逐字段同值、`payload.mediaType === ref.mediaType`；③ **字节摘要必核**：对 `bytes` 现算 `byteDigest` 并与 `ref.contentDigest` 比对——载荷缺失、摘要不匹配、字节不可重读（长度不符/读取中断/不是 `Uint8Array`）三种情形一律拒写，**不得**“先写信封、载荷后补”，也不得把缺失载荷当“暂不提供”；④ `authorityDomain` 按上条可判定且被当前激活允许；⑤ 写入者有权（权源由 77 按类型定）；⑥ `TxScope` 的域与④一致。
- **后置**：记录**不可覆盖**；修正/撤销是追加新记录并链回（`lineage`）；信封行与载荷行在**同一事务**落下（§6.3 不变量），任一失败整体回滚——不得留“有封无载”或“有载无封”。
- **错误**：形状/语义失败 `rejected_precondition`；权源或域不允许 `rejected_authority`；**链顶或类型版本不符** `rejected_version`；同 `recordId` 内容不一致 `rejected_idempotency`；给了 `writerLease`/`fence` 但租约已过期或围栏代次落后 `rejected_version`（写者身份失效，不得继续写）。载荷面固定四条 subcause：`payload-missing`（未给载荷）、`payload-digest-mismatch`（摘要不符）、`payload-media-type-mismatch`（媒体类型不符）、`payload-unreadable`（字节不可重读），全部 `rejected_precondition`（`category` 走 §5.7 缺省）——**不是** `unsupported`：这是“这次给的输入不合法”，不是“该能力未开放”；`authority-domain-ambiguous` / `tx-scope-domain-mismatch` 同为 `rejected_precondition`
- **幂等/预期版本**：`recordId` 重复且**内容一致**（信封规范字节与载荷摘要都一致）= `Ok({deduped:true})`（幂等成功，不是错误）；同 `recordId` 下信封或载荷任一不同 = `Err(rejected_idempotency)`（不得静默覆盖，也不得“只换载荷”）。`expectedLineageHead` 用于“接在某个确定链顶之后”的 CAS：不符即 `Err(rejected_version)`，调用方必须**重读链顶**（≥ 一次 `RecordReader` 读）再重判，**不得**用缓存的顶或“自动改接最新”蒙过去
- **事务与证据**：单条追加是原子写（信封 + 载荷 + 索引 + 事务账，§6.3 不变量）；跨类型多记录必须走 `TS-PORT-REC-04`
- **等级/锚点**：experimental；**新建**——不是包装：`Ledger.appendEvent`（`store/src/ledger.ts:233`，注释已声明“唯一写口、无 UPDATE/DELETE”）只能写 `events` **投影行**，装不下整封、也不存载荷字节（§4.6、§6.0）；77-§1.2、`RUN-FAIL-01`

#### TS-PORT-REC-02 `RecordReader`

- **签名**：`get(recordId: Qid): Promise<Result<RecordEnvelope<unknown> | undefined, ClassifiedError>>`（**`Ok(undefined)` 才是不存在**；运行期库失败 ⇒ `Err({failure:'unavailable', category:'STALL', subcause})`，**不得**用 `undefined` 吞掉读失败）；`query(q: RecordQuery): Promise<Result<RecordPage, ClassifiedError>>`；`payload(ref: ArtifactRef): Promise<Result<RecordPayload | undefined, ClassifiedError>>`（**按需读载荷**，见本节末）
- **参数与返回**：`RecordQuery` **只允许索引化条件**，不支持任意表达式（类型/公司/主体/时间窗/游标/限额/排序/知悉范围）；返回**必须带出参**：

```ts
interface RecordQuery {
  kinds?: readonly { name: RecTypeName; version?: SemVer }[]     // 记录类型（封闭词表）
  company?: CompanySlug
  subjectRef?: SubjectRef
  timeRange?: { from: Timestamp; until: Timestamp; field: 'recordedTime' | 'observedTime' | 'effectiveTime' }  // 缺省 field='recordedTime'
  cursor?: string                                               // opaque（见下）；首查缺省
  idempotencyKey?: string                                       // 仅精确索引查重；不是模糊过滤或第二幂等键
  limit: number                                                 // 必填；上限由查询限额决定
  order: 'asc' | 'desc'                                         // 必填；按 timeRange.field + recordId 稳定排序
  knowledgeScope?: KnowledgeScope                               // 调用方可读知悉范围；超出即不可见，不得过滤后仍回总数
}

interface RecordPage<TPayload = unknown> {   // 读的统一出参：RecordReader（async）与 ReadOnlyLedger（sync）共用
  items: readonly RecordEnvelope<TPayload>[]
  nextCursor: string | null               // 末页必须 null；有下一页时是 opaque 游标
}
```

禁止 `where` 任意谓词、正则、join、聚合与“先取全量再在端口里算”——要复杂过滤就走投影（`TS-PORT-REC-03`）。`limit`/`order` 必填是为了“同查询同结果”可复现；**只有进参没有出参的分页是缺陷**。
- **前置**：读权（读权与写权分离）
- **后置**：只读；返回的记录必须带 `integrity`，不得只回 payload；`items.length <= limit`，`nextCursor === null` 当且仅当无下一页
- **错误**：三条 subcause 与只读面**逐字相同**（§8.2 表；`category` 走 §5.7 的缺省推导）：查询超限/未开放字段组合 ⇒ `Err({failure:'unsupported', category:'EVOLVE_REJECT', subcause:'ledger-query-unsupported'})`（**不是** `CONFIG_INVALID`：请求合法但该查询形状未开放，属演进域）；游标不可解/作废/与条件不匹配 ⇒ `Err({failure:'conflict', category:'EXTERNAL_REJECT', subcause:'ledger-cursor-invalid'})`（**不是** `MERGE_CONFLICT`：非合并域的冲突一律 `EXTERNAL_REJECT`；`STATE_CONFLICT` 这一 category 在全卷**不存在**）；查询形状非法 ⇒ `Err({failure:'rejected_precondition', category:'CONFIG_INVALID', subcause:'ledger-query-invalid'})`。**`get` 同样有失败通道**：库里读不出（库被替换/不可读/行损坏）⇒ `Err({failure:'unavailable', category:'STALL', subcause:'ledger-read-failed'})`；只有 `Ok(undefined)` 表示“不存在”。**不得**把读失败降级成空页或 `undefined`
- **幂等/预期版本**：纯读；游标是 opaque（见下）
- **事务与证据**：读不产生记录；访问审计归 `TS-PORT-MEM-01`（记忆）与 78 的审计面
- **等级/锚点**：experimental；包装 `Ledger.queryEvents`；77-§1.3

〔结论〕游标必须 **opaque**：调用方不得解析、拼接、比较游标；只有提供方解释。现状锚点是 `platform.ts:4` 的注释（“游标是不透明字符串（NA1 教训），核心不解释”）与 `platform.ts:157` 的字段 `nextCursor: string | null`；`RecordReader` 沿用同一纪律，游标类型用 `string` 而非模板字面量类型。

〔结论〕**`payload(ref)` 是“按需读字节”的唯一入口**，语义四态固定（与只读面同义，§8.2）：

- **`Ok(undefined)` 只表示“该定位没有载荷”**（库里查无 `record_payloads` 行）——**不表示**无权、不表示不可读、不表示“记录不存在”。把无权或读失败回成 `undefined`，即把“不能给你看”伪装成“本来就没有”，判负。
- **先过信封权检，`ref` 不是通行证**：实现必须先由 `contentDigest` 反查它所属的信封，按该信封的 `knowledge`/`scope` 校验调用方许可；不许可 ⇒ `Err({failure:'rejected_forbidden', subcause:'payload-not-authorized'})`（`category` 走 §5.7 缺省 `EXTERNAL_REJECT`）。**不得**因为“我手里有摘要”就跳过信封权检，也不得用 `storageHint` 直接取对象绕过台账。
- **媒体类型/摘要不符 ⇒ `Err`**：读回字节重算 `byteDigest` 与 `ref.contentDigest` 不符 ⇒ `Err({failure:'rejected_precondition', subcause:'payload-digest-mismatch'})`；`mediaType` 与 `ref.mediaType` 不符 ⇒ 同形 `payload-media-type-mismatch`。**不得**“先返回、再告警”。
- **不可读不是不存在**：字节读不出来（对象存储不可达、行损坏、文件缺失但索引仍在）⇒ `Err({failure:'unavailable', category:'STALL', subcause:'payload-unreadable'})`，不得降级成 `Ok(undefined)`。

**查询只回信封，不内联载荷**：`get`/`query` 返回的 `RecordPage.items` 只带 `payloadRef`，**不得**把字节塞进分页结果——否则一次 `limit` 就能把整表大包读进内存（载荷大小与记录条数无关，这是 DoS 面）。需要字节的调用方逐条 `payload(ref)`，并自行负责量级。

**只读面同义**：`ReadOnlyLedger.payload(ref): Result<RecordPayload | undefined, ClassifiedError>` 是**同步**版本，四态、四条 subcause 与本节逐字相同（§8.2）。

#### TS-PORT-REC-03 `RecordProjection`

- **签名**：`project(name: ProjectionName, source: ProjectionSource): Promise<ProjectionResult>`；`rebuild(name: ProjectionName): Promise<ProjectionResult>`
- **参数与返回**：`ProjectionResult` **按类拆开**（表投影有 `rows`，观察投影没有）：
  `ProjectionResult = TableProjectionResult | ObservationProjectionResult`；
  `TableProjectionResult = { kind:'table'; name: TargetTableProjectionName; rows: number; cursor: string | null }`；
  `ObservationProjectionResult = { kind:'observation'; state: ObservationState }`。
  `ObservationState` 是 77-§9.2 六态之一：`observed|derived|unknown|stale|conflict|gap`（「已观察/已推导/未知/陈旧/冲突或受损/缺口或中断」）。**六态只由 `TS-PORT-OBS-01` 产出**；本端口只为 `observation` 投影名返回它的状态摘要，不另造第二套六态语义。`ProjectionName` 是**封闭字面量联合**（不是自由 `string`），分两类：

```ts
// 现状 17 个（已建表；本卷不动这 17 个名字、不改既有表）
type TableProjectionName =
  | 'events' | 'work' | 'sessions' | 'people' | 'personnelEvents' | 'departments'
  | 'tickets' | 'jobs' | 'todoQueue' | 'candidates' | 'budgets' | 'ledgers'
  | 'reports' | 'usageDaily' | 'prices' | 'probes' | 'intentReceipts'
// **目标新增（尚未建表；MIG-01 待实现）**：'resourceLedger' ↔ 物理表 `resource_ledger`
//（§6.4 RES-01 的派生投影；由 store 的同事务 hook 写，ResourceAccountant 只读不写）
type TargetTableProjectionName = TableProjectionName | 'resourceLedger'
type ProjectionName = TargetTableProjectionName | 'observation'

interface ProjectionSource {              // 增量来源：游标 + 事实域；缺则整表重放
  cursor?: string                         // opaque；缺省 = 从头重建
  factDomains: readonly string[]          // 已登记的 77 事实域；不是物理表名
  since?: Timestamp                       // **增量起点**：只重放该时刻之后发生的事实
  asOf?: Timestamp                        // **快照时点**：重建到该时点的全量视图（目标新增，§6.3）
}
```

- ①类对应实现侧表族（现状 **17 个**：`events`/`work_records`/`sessions`/`people`/`personnel_events`/`departments`/`ticket_mirror`/`jobs`/`todo_queue`/`candidates`/`budgets`/`ledgers`/`reports`/`usage_daily`/`price_snapshots`/`probes_runs`/`intent_receipts`）；`daemon_kv`、`schema_version`、`hr_sync_log` **不是**投影名（内部机制面）。**目标第 18 个** = `resourceLedger` ↔ 物理表 `resource_ledger`（§6.4 RES-01；随 `MIG-01` 建表，**已定名**，不再是“名字未定/需另提案”）。
- ②类只有 `observation`（77-§9）：返回 `ObservationProjectionResult`，**不得**带 `rows`，也不得用空集合冒充“没有数据”。
- 新增投影名 = 提案 + 允许边检查；**禁止**在调用点自造字符串或“先查表再拼”。`resourceLedger` 是**已登记的目标名**（上条），实现侧按 `TargetTableProjectionName` 的字符串字面量写死（返回类型也用 `TargetTableProjectionName`，不得收窄成 `TableProjectionName` 后再强转），不得写成 `resource_ledger` 之外的别名（物理表名与投影名是两件事，缺一不可）。
- **`since` 与 `asOf` 是两个语义，不得互替**：`since` 是**增量起点**（只重放该时刻之后的事实，配合 `cursor` 断点）；`asOf` 是**快照时点**（把投影重建到该时点的全量，不看游标）。`asOf` 缺失而调用方要快照 ⇒ 必须显式给，**不得**拿 `since` 冒充；两者同时给 ⇒ 抛 `ClassifiedError`（`failure:'rejected_precondition'`, `subcause:'projection-source-invalid'`）——同时给等于要求“既从某点起增量、又是另一时点的全量”，自相矛盾，不得择一静默。`rebuild(name)` 不带来源参数 = 从头**全量**重建（语义等价于“把当前全部事实重放到此刻”，但它不自己读时钟去猜时点）；要“重建到某个历史时点”必须走 `project(name, { …, asOf })`，`asOf` 由调用方显式给（投影面无时钟，§6.9）。
- **`factDomains` 的校验不得靠硬编码表映射**：① 每个域必须在 `TS-PORT-AUTH-01 AuthorityRequirementSource` 里**已登记**（未登记 ⇒ 抛 `projection-source-invalid`，不静默忽略、不跳过）；② 域 → 本地表族的路由由**注入的 `Projector` 在注册时声明**（81/03 已有的做法），本卷的公共面上**不出现**域→表常量表，也不得在调用点“先查表再拼”；③ 涉及写入的投影（表投影）还须由**当前激活**（`TS-PORT-AUTH-03`）允许该域，不允许 ⇒ 同码拒。域字符串是 77 的域标识，**不是物理表名**——两者不得互相顶替。
- **前置**：投影只读事实源；不得成为决策输入
- **后置**：可重建；重建结果必须与增量结果一致（同一 `ProjectionName` + 同一游标）
- **错误**：表投影**无 `Result` 通道**——失败以 `kind` 与 `state` 结论表达；真正不可继续（投影定义未注册、库不可打开）才抛 `ClassifiedError`；观察投影的缺口一律走 `OBS-01` 的六态，不得返回空集合冒充“没有数据”
- **幂等/预期版本**：`rebuild` 幂等；增量投影以游标幂等
- **事务与证据**：投影表可整表替换（现状 `replaceTodoQueue`）；证据=`REC-OBS-01`
- **等级/锚点**：experimental；包装 `syncCompany`/`replaceTodoQueue`/`listTicketMirrors`；77-§9、75-D75-06

#### TS-PORT-REC-04 `RecordTransaction`

- **签名**：`begin(scope: TxScope): Promise<Result<TxHandle, ClassifiedError>>`；`commit(tx: TxHandle): Promise<Result<TxReceipt, ClassifiedError>>`；`abort(tx: TxHandle, reason: FailureClass): Promise<Result<TxReceipt, ClassifiedError>>`；`receipt(txId: string): Promise<TxReceipt | undefined>`（`undefined`=未登记，不是拒绝）
- **参数与返回**：三件都**不得空泛**：

```ts
interface TxScope {
  company: CompanySlug
  authorityDomain: string          // 同一事实域（77 的域标识）；跨域一律拒绝
  partition?: string               // 同域内可选分区（如单 ticket / 单 subject），用于收窄写者竞争
}
interface TxHandle {
  txId: string                     // 事务句柄 ID（**非 qid**）；进程内有效
  scope: TxScope
  writerId: string                 // 写者身份（进程/实例）
  fence?: FenceToken               // 跨进程写时必填（TS-PORT-AUTH-04）
  expectedLineageHead?: Qid        // 本事务要接上的链顶；提交时校验
  openedAt: Timestamp
  readOnly: false                  // 事务句柄永远不是只读；只读读面走 openLedgerReadonly（§8.2）
}
interface TxReceipt {
  txId: string
  commitSeq?: number               // 已提交时必填（单调）；aborted/unknown 时可缺
  recordIds: readonly Qid[]        // 本事务写入的记录（顺序 = 提交顺序）；aborted 时为空
  status: 'committed' | 'aborted' | 'unknown'   // commit 只会产 committed|unknown；abort 产 aborted
  proofRef?: Qid                   // 回执记录（REC-RCP-01）引用；committed 时必填
}
```

`TxHandle` 只在**本写者进程内**有效，不得序列化跨进程传递；跨进程协调一律用 `WriterLeasePort` 的 lease + fence。`status:'unknown'` 只能由 `receipt(txId)` 重读或 `TS-PORT-REC-06` 对账消解——**commit 超时且结果未知不得改写为已知失败**，`abort` 也返回 `TxReceipt`（`status:'aborted'`），让“已中止”可达，不再只回 `void`。
- **前置**：调用方持有对应 `WriterLeasePort` 的 fence（跨进程时）
- **后置**：要么全部可见，要么全部不可见；**长 IO 不得在事务内**（§8.2）
- **错误**：fence 失效 `rejected_version`；提交超时 `timeout`（**结果未知**，须查 `receipt(txId)`/对账，见 §8.4）；`abort` 与提交撞车 `conflict`
- **幂等/预期版本**：事务本身不幂等；调用方用 `idempotencyKey` 在提交前查回执；`abort` 对同一 `txId` 幂等
- **事务与证据**：`BEGIN/COMMIT` 包住**纯写**；证据=提交回执
- **等级/锚点**：experimental；新建（现状 `store/src/ledger.ts:865`/`:948` 两处 `BEGIN` 是内部实现，不对外）

〔结论〕`RecordTransaction` 的 `TxScope` 不得跨事实源。SQLite 台账的事务不能包住“YouTrack 写 + 台账写”；跨源一致性只能靠**补偿 + 对账**（§8.4），不能靠分布式事务假装。

〔结论〕**提交路径的不变量在 §6.3（`record_transactions`），签名不变**：`TxReceipt.commitSeq`/`proofRef` 的字段形状不动（`committed` 时两者都必填），落点与约束由"记录面存储不变量"定死——`commitSeq` 在**提交该事务的同一个单写事务里**取号（唯一单调），提交证明是**同事务**写入的 `REC-RCP-01` 且 `proofRef` 指向它，**不存在"已提交但无证明"的窗口**；证明写不出 ⇒ 不提交。`receipt(txId)` 只读这两列，不从其它表反推，也不得在缺证明时返回 `committed`。

〔结论〕`RecordTransaction` 是**机制件**，不是命令入口：它只包住“同域多记录”的原子提交。命令/权检的入口是 `TS-PORT-CMD-01 CommandIntake`（§6.4），命令不得绕过它直接 `begin/commit`，也不得用事务把“受理→外部执行”包成一段。

#### TS-PORT-REC-05 `CorrectionPort`

- **签名**：`propose(c: CorrectionDraft): Promise<Result<RecCorrection, ClassifiedError>>`；`history(recordId: Qid): Promise<readonly RecCorrection[]>`
- **参数与返回**：`CorrectionDraft` 含 `corrects/correctionKind/correctedFields/affectedConclusions/authorityRef/effectiveWindow`（77-§2.5）+ **两个 CAS 位**：`expectedLineageHead: Qid`（被修正记录**所在链的顶端 `recordId`**，必填；取自 76 `RecordEnvelope.lineage`，不新造实例代次标量）与 `expectedTypeVersion?: SemVer`（该 `REC-*` 的**类型版本**，仅在修正语义随类型版本变化时必填）；`originalPreserved` 恒为真
- **前置**：修正者有权（处置位/验收位/重开受理位）；被修正记录存在；链顶与 `expectedLineageHead` 一致；给了 `expectedTypeVersion` 时类型版本也必须一致
- **后置**：只追加 `REC-COR-01`；旧记录保留；不得追溯授权过去的越权
- **错误**：试图覆盖旧记录 `rejected_forbidden`；权源不足 `rejected_authority`；**链顶不符**（期间已有新记录）`rejected_version`——先重读链顶再重判，不得“改接最新”；**类型版本**不符单独判（`rejected_version` + `subcause:'type-version-mismatch'`），不得与链顶不符混为一谈
- **幂等/预期版本**：按 `(corrects, correctionKind, correctedFieldsDigest)` 幂等
- **事务与证据**：修正记录 + 受影响结论清单；证据=修正依据
- **等级/锚点**：experimental；77-§2.5、§1.7 第 4 条

#### TS-PORT-REC-06 `ReconciliationPort`

- **签名**：`reconcile(scope: ReconcileScope): Promise<Result<RecReconciliationBatch, ClassifiedError>>`；`registerUnknown(u: UnknownDraft): Promise<Result<Qid, ClassifiedError>>`；`resolveUnknown(id: Qid, resolution: Resolution): Promise<Result<RecReconciliationBatch, ClassifiedError>>`
- **参数与返回**：`ReconcileScope` 含事实域、对象集、时间窗、游标区间；`differenceClasses` 六值；`completenessClaim` 三值（77-§2.7）
- **前置**：基线游标存在且可信；比对来源可读（不可读要先登记 `REC-EVT-03`）；`registerUnknown` 的 `UnknownDraft.unknownScope.intentRef` **必填**（指向 `REC-WORK-01.recordId`），缺失即拒——不允许“先写未知、回头补链”（§6.6 映射表第 4 条）
- **后置**：产出 `REC-EVT-02`；未知按 `REC-EVT-03` 登记（含 owner 与 review_by）；**对账未完成不得结清、不得宣称迁移完成**
- **错误**：来源不可达 `unavailable`（登记未知，不抛）；游标断裂 `conflict`；无法判定 `unverified`；`unknownScope.intentRef` 缺失 ⇒ `rejected_precondition`（`subcause:'unknown-scope-intent-missing'`），**不落记录**；历史无链的孤儿未知按 `REC-OBS-02` 记覆盖缺口，不得伪装成已归属的 EVT-03
- **幂等/预期版本**：按 `(scope, baselineCursor, sourceSet)` 幂等；迟到副作用只消解未知，不重算验收
- **事务与证据**：对账批次 + 逐项处置；证据=双方游标与差异项
- **等级/锚点**：experimental；77-§2.7/§2.8、§8.4 第 4 条

#### 记录面存储不变量（参考绑定；DDL 归 81/03）

〔结论〕本节只定**语义不变量**，字段类型、索引名、物理表名、DDL 与迁移波次**归 81**（`docs/81-files/03-store.md`、`store/src/migrations/`）。目标是让“整封 + 原始载荷”可存、可核、可重建——**不是**把 `events` 加宽冒充，也不是给 `events` 改个名字。

**四张表（逻辑名；物理名归 81）**：

1. **`records`：完整信封，不可变**。一行一条记录，整封（76-§4.2 全部字段）存一份规范字节，另把可查询的键抽成列。只存投影列再声称“信封已存”判负；`UPDATE`/`DELETE` 一律禁止——修正/撤销/重开都是追加（76-§4.2 退出条）。
2. **`record_payloads`：原始载荷字节，不可变**。主键 = `contentDigest`（内容寻址，同一载荷被多条记录引用时共用一行）；列含 `mediaType`、字节长度、字节本体或其对象存储定位、`storageHint`。**不存解析后的对象**（解析是可重算的派生，不进事实面）。
3. **`record_transactions`：事务账**（见下“无窗口”不变量）。
4. **`events`：投影，不是权威全集**。保留为 `REC-EVT-01` 的落库形态（§4.6），由 `records` 派生、可丢弃重建；“库里只有 `events` ⇒ 记录齐全”的读法判负。

**`records` 至少能索引**（缺一即该维度查询退化成全表扫，判负）：`recordId`（主键）、`company`、`recordType.name` + `recordType.version`、`authorityDomain`、`subjectRef`（kind + id）、三时间（`observedTime`/`recordedTime`/`effectiveTime.from`）、`idempotencyKey`、`lineageHead`（本记录所在链顶，供 CAS）。

**四条可测不变量**：

- **载荷可复核**：读回字节现算 `byteDigest` 与 `payloadRef.contentDigest` 比对，不符 ⇒ `payload-digest-mismatch`（§6.3 `payload(ref)`）；字节本体与摘要**都在**，不得只存其一。
- **写入原子**：信封行 + 载荷行 + 索引 + 事务账在**同一事务**写；任一失败整体回滚，不得留“有封无载”或“有载无封”。
- **知悉范围不可被查询绕过**：`knowledgeScope` 过滤发生在**查询条件里**（`WHERE`），不是取回后在内存过滤；`payload(ref)` 也必须先过其所属信封的权检（`ref` 不是通行证）。“过滤掉之后仍回总数”判负。
- **`commitSeq` 与 `proofRef` 无窗口**：`record_transactions` 至少含 `txId`（主键）、`scope`（`company` + `authorityDomain` + `partition`）、`writerId`、`fence`、`openedAt`、`status`、`commitSeq`、`proofRef`、`recordIds`。`commitSeq` **由提交该事务的同一个单写事务分配**（事务内取号，不得事务外先读后写、不得跨事务预留）；提交证明是**同事务**写入的一条 `REC-RCP-01`，`proofRef` 指向它。**不允许“已提交但无证明”的窗口**：证明写不出 ⇒ 该事务不提交（整体回滚），`status` 不得留 `committed`；`receipt(txId)` 与 `REC-06` 对账只读这两列，不重新推断。

〔结论〕**不新增投影名、不新增 `REC-*`**：`records`/`record_payloads`/`record_transactions` 是**事实面与机制面**，不是 `ProjectionName`（§6.3 的 17+1 名单不变），也不进投影表族；`daemon_kv`/`schema_version`/`hr_sync_log` 同理。

### 6.4 工作面：命令、受理、合同、五门、计划、生命周期、异常、结清

#### TS-PORT-CMD-01 `CommandIntake`

- **签名**：`submit(cmd: CommandDraft): Promise<Result<CommandOutcome, ClassifiedError>>`；`check(commandId: Qid): Promise<RecAuthorityCheck>`（`check` 只回读已落的权检结论，无拒绝通道）
- **参数与返回**：`CommandDraft` 含 `commandKind/targetRef/requestedEffect/claimedAuthority/scope/idempotencyKey/issuedAt/sourceVerification`（77-§2.1）；`CommandOutcome = { record: RecCommandRequest; routedTo: 'work-intake'|'lifecycle'|'settlement'|'authority'|'rejected'; authorityCheck: RecAuthorityCheck }`
- **前置**：来源核验通过（`未核验` 只能暂缓/拒绝）；`requestedEffect` 可判定
- **后置**：只追加 `REC-CMD-01` + `REC-CMD-02`，并把命令**路由**给域端口（`WorkIntake`/`WorkLifecycle`/`SettlementPort`/`AuthorityGrantPort` 等）；**不直接执行**外部效果，不直接改状态
- **错误**：来源未核验 `rejected_precondition`；权检 `禁止`/`保留`/`未覆盖` → `rejected_authority`（分别走停止/转呈/请求决定）
- **幂等/预期版本**：按 `(company, source, commandKind, idempotencyKey)` 幂等；同键不同内容 `rejected_idempotency`
- **事务与证据**：命令 + 权检两条同域追加；证据=请求原文摘要 + 权检结论
- **等级/锚点**：experimental；77-§2.1/§2.2、§1.4；**不是** `RecordTransaction` 的别名

#### TS-PORT-DEC-01 `DecisionPort`

- **签名**：`record(d: DecisionDraft): Promise<Result<RecDecision, ClassifiedError>>`；`get(id: Qid): Promise<RecDecision | undefined>`
- **参数与返回**：`DecisionDraft` 含 `decidedBy/decisionKind/subjectRef/verdict/conditions?/rationale/basisRefs/scopeJudged/dissentPosition/effectiveState/effectiveTime?`（77-§2.3）
- **前置**：**只用于没有专用记录类型的决定**；若已有专用类型（77-§1.7 十类），必须拒收并指回该类型
- **后置**：追加 `REC-DEC-01`；不证明有权、不证明已生效、不证明正确
- **错误**：已有专用类型 `rejected_precondition`；缺 `scopeJudged`/`dissentPosition` `rejected_precondition`
- **幂等/预期版本**：按 `(subjectRef, decisionKind, verdict, basisDigest)` 幂等
- **事务与证据**：决定记录；证据=依据引用
- **等级/锚点**：experimental；77-§2.3、§1.7 第 2 条

#### TS-PORT-WORK-01 `WorkIntake`

- **签名**：`reserve(intent: RecIntentEnvelope): Promise<Result<{ intentRef: Qid; bodyDigest: Digest; receivedAt: Timestamp; duplicate: boolean }, ClassifiedError>>`；`intake(intent: RecIntentEnvelope): Promise<IntakeOutcome>`
- **`reserve` 的职责（`REC-WORK-01` 唯一写口）**：在一个 daemon 写事务里按 `IntentKey`（`company`/`source`/`kind`/`ticket ?? dedupKey`）查重并追加**不可变** `REC-WORK-01` 意图信封（77-§4.1.1：`raw_content`/`source`/`identity_mapping`/`authenticity_state`/`received_at`/`intake_owner`/`intake_deadline`/`known_constraints`/`requested_state`）；`intentRef` 在追加时**立即产生**，不等相位 2。命中同键同摘要 ⇒ `duplicate:true` 且返回既有 `intentRef`；同键不同摘要 ⇒ `Err(rejected_idempotency)`。**`engine.ingest` 只入内存队列、不产生记录**，所以任何“先写回执行再补记录”的次序都不成立；`IntentIngress` 只调 `reserve`，不自行写本记录。
- **参数与返回**：`IntakeOutcome = { outcome: 'accepted'|'accepted_with_conditions'|'deferred'|'rejected'|'forwarded'; recordId: Qid; conditions?: string[]; referredTo?: ReferralTarget; decidedAt: Timestamp }`（五值归 77-§4.1：`接受`/`附条件接受`/`暂缓`/`拒绝`/**`转呈`**）。**字段名统一为 `outcome`**：旧稿的 `conclusion`、以及 `conditionally_accepted`/`pending` 两种写法一律作废——回执、HTTP body、受理记录三处同名同值域。**第五值是转呈，不是“范围外”**：转呈 ≠ 拒绝，受理责任位置改变、时限与告知义务随之前移，由受转位置继续受理（77-§4.1、T04 迁移边）；`referredTo` 在 `forwarded` 时必填。
- **未判怎么写**：`outcome` 缺省（或回执行上的 `decisionState:'undecided'`）表示“daemon 还没判”；**不得**用 `pending` 兼职“暂缓”（暂缓是 `deferred`），也不得把“未判”塞进五值当第六值。

```ts
interface ReferralTarget {
  positionRef: Qid        // kind 只能是 'position' | 'governance-position'（Qid 校验期拒其他 kind）
  deadline: Timestamp     // 受转方应答时限
  notifiedAt: Timestamp   // 转呈告知发出时间（不是“已接收”）
}
```

〔说明〕77-§4.1 只规定“受转位置 + 时限”的**定性**要求，没有给字段名；上面的 `positionRef`/`deadline`/`notifiedAt` 是**本卷的 TS 实现映射**，不是伪造的上位字段。
- **前置**：意图已去重（源侧 `dedupKey` + 引擎侧 `intentKey`）
- **后置**：产出 `REC-WORK-02`（decision facet）；**受理 ≠ 开工**；`rejected` 才是终止性结论，`forwarded` 仍处“受理中”
- **错误**：重复意图返回既有结论（幂等），不抛；**不给**“范围外/超范围”这类第六值——超出范围按权检结果走转呈、拒绝或请求决定（§6.4 前置、77-§4.1）
- **事务与证据**：`reserve` 写 `REC-WORK-01`；`intake` 写 `REC-WORK-02` + 结论；证据=意图原文引用
- **幂等/预期版本**：以 `(company, source, kind, ticket ?? dedupKey)` 幂等（与 `intentKeyOf` 逐位一致，`core/src/decide.ts:319`–`:324`）；`reserve` 同键同摘要幂等、不同摘要拒
- **等级/锚点**：experimental；77-§4.1、`RUN-WORK-01`；局部等价物=`decide` 的 `HOLD_INTENT_*`/`DEDUP_NOOP`

#### TS-PORT-WORK-02 `ContractPort`

- **签名**：`propose(c: ContractDraft): Promise<Result<RecContractRevision, ClassifiedError>>`；`amend(ticket: TicketId, change: ContractChange, expectedVersion: SemVer): Promise<Result<RecContractRevision, ClassifiedError>>`；`current(ticket: TicketId): Promise<RecContractRevision | undefined>`
- **参数与返回**：五要件与版本链归 77-§4.3；本端口只给“提案/修订/读取”
- **前置**：五要件齐（缺一即 `rejected_precondition`）；修订必须有 `expectedVersion`
- **后置**：版本链追加，旧版本保留；**不得**原地改
- **错误**：版本冲突 `rejected_version`；要件缺 `rejected_precondition`
- **幂等/预期版本**：`propose` 以草稿摘要幂等；`amend` 必须 CAS
- **事务与证据**：合同记录 + 修订记录；证据=变更依据引用
- **等级/锚点**：experimental；77-§4.3、`RUN-WORK-02`；现状无等价物（`TaskBrief` 是派发材料，不是合同）

#### TS-PORT-WORK-03 `ReadinessGate`

- **签名**：`judge(req: ReadinessRequest): Promise<Result<RecReadinessJudgment, ClassifiedError>>`
- **参数与返回**：五门逐门结论 + 三取值（77-§4.4）。`verdict` 取值是**本类型自有**的 `可开工`/`附条件开工`/`不可开工`（77-§4.4.1），不得借用受理五值、验收四值，也不得新增 `refused` 这种第四值——门的规则求值 `refused` 只导致**整单判 `不可开工`**。
- **五输入（与五门一一对应，不多不少）**：`contractRef`+`authorityRef`（权）、`qualificationRefs`+`planRef`（能力）、`resourceRef`、`informationRefs`、`prohibitionsRef`（禁止清单版本）。**风险引用不是门输入**——风险分类（`TS-PORT-WORK-09`）是验收与降档判断的材料，不进开工五门；把它塞进门里会让“高风险”被误读成“不可开工”。

**请求与判决的 TS 形状**（目标类型；`REC-WORK-04` 的 13 个字段逐一对齐 77-§4.4.1，字段中文名归 77，本卷只给可写英文承载）：

```ts
type ReadinessGate = 'authority' | 'capability' | 'resource' | 'information' | 'prohibition'   // 权/能力/资源/信息/禁止
type ReadinessVerdict = '可开工' | '附条件开工' | '不可开工'   // 本类型自有取值（77-§4.4.1）：**中文即 payload 值**，不另造英文映射（§4.4 末条的例外：77 未要求映射时不映射，映射即第二套词表）；与下面 `ReadinessJudgeRole` 的英文承载名**不是一回事**（那是内部名，不是第二套可写值）

// 六值英→中**一一映射**（77-§4.4.1“角色名就是 payload”）：assignee=承接者、authorizer=授权者、
// qualifier=认定位置、resource_owner=资源责任者、info_holder=信息持有者、prohibition_owner=禁止清单所有者。
// 英文名只作内部承载（TS 判别/代码分支），**可写入值只有这六个中文词**；不得出现第二套可写入值，
// 也不得把英文名写进 `REC-WORK-04`。门标识 `ReadinessGate` 相反：五个英文是机器值，不收中文别名。
type ReadinessJudgeRole = 'assignee' | 'authorizer' | 'qualifier' | 'resource_owner' | 'info_holder' | 'prohibition_owner'

// 引用形状三分，不得套嵌：记录用 VersionRef<Qid>（记录身份 + 版本 + 语义摘要）；定义/策略用 DefinitionRef
// （`targetKind` 区分，如合同模板/禁止清单/额度）；判据（规则档）用 ProfileRef。**不得**写 VersionRef<RecordRef>
// ——RecordRef 自带 recordType/recordedAt/integrityRef，再套一层 VersionRef 会把“记录”和“记录引用的版本”
// 压成一个对象，也无法表达定义类引用（定义不是 REC）。
interface ReadinessRequest {                 // 五组输入**只带带版本的引用**，不接受“当前最新”，也不接受自报结论
  contractRef: VersionRef<Qid>               // 合同记录与版本（权门前半）
  authorityRef: VersionRef<Qid> | DefinitionRef   // 承接职责记录，或授权策略定义（权门后半；按权威解析取其一）
  qualificationRefs: readonly VersionRef<Qid>[]   // 资格认定记录（能力门前半）
  planRef: VersionRef<Qid>                   // 执行计划锁定记录（能力门后半）
  resourceRef: DefinitionRef                 // 资源额度/预算**定义**（资源门：额度是定义/策略，不是 REC）
  informationRefs: readonly (VersionRef<Qid> | DefinitionRef)[]   // 必需输入（记录）与时效/许可（定义）（信息门）
  prohibitionsRef: DefinitionRef             // 禁止清单**定义**版本（禁止门）
  decidedAt: Timestamp                       // 判断时点（调用方给，端口不读宿主时间）
}

interface GateResult {                       // 77-§4.4.1“每门：判据引用、结论、依据材料、判断者与角色”
  gate: ReadinessGate
  criterionRef: ProfileRef                   // 判据 = 规则档（ProfileRef）：不是记录，也不是定义版本引用
  verdict: ReadinessVerdict                  // 逐门结论：与整单**共用同一三取值**（见下方第 2 条）
  basisRefs: readonly RecordRef[]            // 依据材料（记录）
  judgedBy: SubjectRef                       // 该门的具名判断者（角色不替代具名）
  role: ReadinessJudgeRole                   // 该门的实际判断角色；与 `judgeRole` 的逐门投影必须一致
  authorityRef: VersionRef<Qid> | DefinitionRef   // 该门的判断权源：记录或授权策略定义
}

interface ReadinessCondition {               // 附条件时必填；未满足即自动进入暂停
  condition: string; ownerRef: SubjectRef; dueAt: Timestamp; onMiss: 'pause' | 'forward' | 'reject'
}

interface RecReadinessJudgment {             // 77-§4.4.1：13 字段全列，不增不减
  contractRef: VersionRef<Qid>                       // 1 contract_ref
  decidedBy: SubjectRef                              // 2 decided_by（具名任职者/各门具名判断者；不得只写“承接者”）
  authorityRef: VersionRef<Qid> | DefinitionRef      // 3 authority_ref（逐门权源另在 gateResults 内）
  gateResults: readonly GateResult[]                 // 4 gate_results（恰五门，缺一门即不合格）
  verdict: ReadinessVerdict                          // 5 verdict（三取值；不得压成 boolean）
  scopeJudged: { judged: string; notJudged: string }  // 6 scope_judged（须写明“不判验收、价值与后续变更”）
  conditions?: readonly ReadinessCondition[]          // 7 conditions（附条件开工时必填）
  judgeRole: readonly { gate: ReadinessGate; role: ReadinessJudgeRole }[]   // 8 judge_role：**逐门角色列表**（77 已定为列表）；恰五门、与 gateResults.role 逐门同值
  decidedAt: Timestamp                                // 9 decided_at（判断时点；≠ 生效时点）
  repudiationTriggers: readonly string[]              // 10 repudiation_triggers（触发重判条件）
  resourceBaseline: ResourceBaseline                  // 11 resource_baseline（结构见 §6.4 `TS-PORT-RES-01`，不再只是“容器”）
  dissentPosition: DissentPosition                    // 12 dissent_position（异议位置与答复期限）
  decisionFacet: DecisionFacet                        // 13 decision_facet（六槽位；顶层同名字段是其只读投影）
}
```

〔结论〕**解析层与纯核之间只有一个 `Readiness Resolved` 实现类型**，落 `core/src/work-readiness.ts`，不是新的公共概念或第 56 个端口，也不放进 `contract/src/ports/work.ts`。字段为：`decidedBy`、`gates: readonly (Omit<GateResult,'verdict'> & { ruleOutcome?: RuleOutcome; conditions?: readonly ReadinessCondition[] })[]`、`resourceBaseline`、`scopeJudged`、`repudiationTriggers`、`dissentPosition`、`effectiveState`、`effectiveTime?`。core 的包根以 `export type` 暴露该实现类型，供 daemon 的 `engine/work/readiness.ts` 做类型安全调用；这不把实现类型升格为跨框架规范。

- **单值决定者与逐门判断者不混**：`decidedBy` 是合同指定的承接者，由 daemon 从合同与当前有效任命解析，不能从五门任意挑一个，也不能由请求体自报；各门 `judgedBy` 保留实际判断者，可以不同。角色解析固定为 `authority→authorizer`、`capability→assignee`（资格由独立位置认定时→`qualifier`）、`resource→resource_owner`、`information→info_holder`、`prohibition→prohibition_owner`，不得任意换角色。
- **纯核只消费已解析结果**：`judgeReadiness(req,resolved)` 是同步纯函数，不 import `rule/*`，也不把五门重新编译成规则档。`RuleOutcome` 由端口层的 `RuleEvaluator` 先算出；若某门使用规则，端口先把该结果作为 `REC-EVT-01` 操作观察落记录，并把该事件 `RecordRef` 放入此门 `basisRefs`。因此 `GateResult` **不增加 `RuleOutcome` 槽位**：纯核消费值、记录保存可核引用，两者不互相替代；不用规则的门由原始依据记录支撑。
- **失败与非法输入不是业务判决**：`ResourceAccountant.baseline()` 返回 `Err` 时端口整体返回同类 `Err`，不得调用纯核、不得改写成资源门 `不可开工`；只有成功返回但包含 `gaps`/未知额度的基线才进入资源门判定。某门 `附条件开工` 而条件四字段不全、缺门/重门、角色越界或引用类型错误 ⇒ 端口在调用纯核前 `rejected_precondition`，**不得**伪造成业务上的 `不可开工` 记录。纯核的输入由该结构保证，不自行发明缺省责任者/期限。
- **记录装配只有一个家**：`engine/work/readiness.ts` 负责异步解析、资源与规则调用、上述证据事件、调用 core 纯核以及 `RecordWriter.append` 完整 `REC-WORK-04`。`decidedAt=req.decidedAt`；`rationale` 由门序与结论生成确定性短文本，不许模型创作；`scopeJudged` 必须含“不判验收、价值与后续变更”；`effectiveState/effectiveTime` 来自当前权威激活而非纯核猜测；facet 与顶层投影同值。core 不落记录、不读时钟、不做 IO。未实现这些接线前不得声称五门已可运行。

- **判据、依据、具名判断者与权源一律从权威引用解析**：`criterionRef`（规则档）/`basisRefs`/`judgedBy`/`role`/`authorityRef` 由端口沿引用取，**不得**从 `ReadinessRequest` 自报字段里采信（自报即等于让被判方定义判据）。请求体只承载引用与时间，不承载结论。三类引用按形状分开解析：`VersionRef<Qid>` 取记录并核 `semanticDigest`；`DefinitionRef` 取定义版本（`targetKind` 必须与门的要求一致）；`ProfileRef` 取规则档（含 `canonicalizationId/version` 的 `digest`）。类型不符即 `rejected_precondition`，不得“跨类优待”互相当替身。
- **`judge_role` 是逐门列表（已定，不再待裁）**：`RecReadinessJudgment.judgeRole` 为 `readonly { gate, role }[]`，恰五门、每门一项；`GateResult.role` 是**同一事实的逐门投影**，两处逐门同值。二者不一致即 `REC-WORK-04` 不合格（不得“以顶层为准”或“以逐门为准”择一放过）；`role` 是**角色**，不替代 `judgedBy` 的具名主体。
- **`role` 的英→中映射唯一（已定）**：`ReadinessJudgeRole` 六个英文名与 77-§4.4.1 的六个中文值一一对应（`assignee`=承接者、`authorizer`=授权者、`qualifier`=认定位置、`resource_owner`=资源责任者、`info_holder`=信息持有者、`prohibition_owner`=禁止清单所有者），映射写在 §6.4 类型旁，不在别处另立；写入 `REC-WORK-04` 的只有中文六值，英文名不出现在记录/payload/对外响应里。英文名的唯一用途是 TS 侧判别与代码分支，不得据此再起一列（如 `roleCode`）与中文值并存。
- **逐门结论与整单共用同一三取值（已定，无独立词表）**：`GateResult.verdict` 与整单 `verdict` 同用 `可开工`/`附条件开工`/`不可开工`；不存在第二套逐门词表，也不得把某门写成 `pass/fail` 或 `true/false`。整单结论由五门结论按 77-§4.4 的合成规则得出，不得与任一门结论直接矛盾（例如三门 `不可开工` 而整单 `可开工`）。
- **`refused` 不升级为第四取值**：门的规则求值返回 `refused` 只导致整单判 `不可开工`（并在 `gateResults` 保留对应 `RuleOutcome` 引用），不得新增 `refused`/`unknown` 判决值，也不得把 `refused` 读成 `可开工`。
- **前置**：五门的输入都是**带版本的引用**，不接受“当前最新”；缺任一门输入即不成立（不得默认“通过”）。资源门输入是 `ResourceBaseline`（由 `TS-PORT-RES-01` 在判门前现算，见该端口“合同→计划锁→五门”的顺序说明），不是调用方自报的剩余量。
- **后置**：产出 `REC-WORK-04`（decision facet）；判决不修改任何门、不写资源账目（预留事实在计划锁时已落 `REC-WORK-05.resource_reservations`，见 `TS-PORT-RES-01`）
- **错误**：输入缺版本或无版本 `rejected_precondition`；判据不可解析 `rejected_version`；`RuleOutcome.refused` 不是错误，是 `verdict='不可开工'` 的合法来源
- **幂等/预期版本**：同输入同版本幂等；任一输入版本变必须重判
- **事务与证据**：判决记录；证据=五门各自的引用 + `RuleOutcome`
- **等级/锚点**：experimental；77-§4.4、`RUN-WORK-03`；局部等价物=`decide` 的并发四闸序（断路前置 > 泳道 > 人 > 每拍 > 在途）

〔结论〕现有闸序是**并发四闸（泳道 / 人 / 每拍 / 在途）+ 断路器前置**，不是**开工五门**。两者都在派发前判定，但前者回答“现在能不能派”，后者回答“这项工作是否具备开工条件”。目标态**先五门、后并发四闸**；五门不过不得进入闸序（否则会出现“资源空闲所以派了一个合同不全的单”）。全卷统一用“并发四闸”这一称法，且不把断路器算作第五道并发闸。

#### TS-PORT-WORK-04 `ExecutionPlanPort`

- **签名**：`lock(plan: ExecutionPlanDraft): Promise<Result<RecExecutionPlanLock, ClassifiedError>>`；`get(ticket: TicketId, attempt: AttemptNo): Promise<RecExecutionPlanLock | undefined>`
- **参数与返回**：必须钉住六件（定义修订、合同版本、资格认定、能力描述、执行配置、绑定档案）的 `VersionRef`（D75-14）
- **前置**：六件都可解析；任一不可解析即拒
- **后置**：计划不可变；变更=新计划 + 新 attempt
- **错误**：引用不可解析 `E-REF-003` → `rejected_precondition`；“引用最新” `unsupported`
- **幂等/预期版本**：以 `(ticket, attempt)` 幂等
- **事务与证据**：计划记录；证据=六件引用
- **等级/锚点**：experimental；77-§4.5、`RUN-WORK-04`；现状无等价物（`TaskBrief` 不带六件版本）

#### TS-PORT-WORK-05 `WorkLifecycle`

- **签名**：`transition(ticket: TicketId, to: WorkState, basis: TransitionBasis, expected: TransitionExpectation): Promise<Result<RecStateTransition, ClassifiedError>>`；`state(ticket: TicketId): Promise<WorkState | undefined>`（`undefined` = 该 ticket 无迁移记录，按 §5.7 第 5 条表示“不存在”，不是拒绝）
- **参数与返回**：十态与 T01–T26 迁移表归 77-§5；`TransitionBasis` 含权源与证据引用；`TransitionExpectation = { expectedState: WorkState; expectedLineageHead: Qid }`——**两项都必填**：`expectedState` 是状态 CAS 基准，`expectedLineageHead` 是**该工作记录链顶的 `recordId`**（76 `RecordEnvelope.lineage` 最新一环；不新造实例 `Revision` 标量）
- **前置**：迁移边在表中；当前态与 `expectedState` 一致；链顶与 `expectedLineageHead` 一致（取出该 ticket 的 `REC-WORK-09` 链顶比对）
- **后置**：状态是**记录派生**，不是可变列；`state()` 由事件流重放得出
- **错误**：非法边 `rejected_state`；**链顶不符**（并发迁移/新记录已插入）`rejected_version`——调用方须**重读链顶**再重判，不得以“改接最新链顶”静默重放
- **幂等/预期版本**：同一迁移重复提交返回既有记录（链顶已是本条即幂等）；`expectedState` + `expectedLineageHead` 双 CAS
- **事务与证据**：迁移记录 + 回执；证据=依据引用
- **等级/锚点**：experimental；77-§5、`RUN-STATE-01`；局部等价物=`decide` 的 `Action` + 平台状态

#### TS-PORT-WORK-06 `ExceptionPort`

- **签名**：`raise(exc: ExceptionDraft): Promise<Result<RecException, ClassifiedError>>`；`receive(id: Qid, by: SubjectRef): Promise<Result<RecException, ClassifiedError>>`；`escalate(id: Qid, to: SubjectRef): Promise<Result<RecException, ClassifiedError>>`；`close(id: Qid, terminal: TerminalDisposition): Promise<Result<RecException, ClassifiedError>>`
- **参数与返回**：发现/接收/升级/终局四段归 77-§6.7；每段都必须有具名接收、期限或复审
- **前置**：`raise` 给偏离证据；`receive`/`escalate` 给具名主体
- **后置**：每一步都追加记录，不改旧记录
- **错误**：无接收人 `rejected_precondition`；超期未处置 → `degraded`（不是静默）
- **幂等/预期版本**：按 `exceptionId + step` 幂等
- **事务与证据**：异常记录 + 回执
- **等级/锚点**：experimental；77-§6.7、`RUN-EXC-01`；局部等价物=`ESCALATE` 事件（单事件，无四段）

#### TS-PORT-WORK-07 `SettlementPort`

- **签名**：`settle(req: SettlementRequest): Promise<Result<RecSettlement, ClassifiedError>>`；`status(ticket: TicketId): Promise<'unsettled'|'partially_settled'|'settled'|'in_liquidation'|undefined>`（`undefined` = 该 `ticket` 未登记，按 §5.7 第 5 条表示“不存在”，不是拒绝）
- **参数与返回**：**八项**逐项关闭（77-§6.8.2）：产物 / 资源 / 证据 / 未决义务 / 承诺 / 相对方 / 责任 / 记忆。**异议不是第九项**——它是 `dissent` 字段（相对方与受影响者的异议受理与状态），为空即视为无异议，但不得留空又声称已结清。`settled_state` 四值：`完全结清`/`结清但有保留事项`/`未结清`/`转入清算`；`status()` 的 `in_liquidation` 与 `settled_state='转入清算'` 是同一事实的两种视角（前者供轮询，后者入记录）
- **前置**：一般情形要求验收已成立（`REC-EVD-04`），但**完成 ≠ 接受 ≠ 结清**。**终止路径例外**：工作已合法终止（`TS-PORT-WORK-05 WorkLifecycle` 的终态迁移 `REC-WORK-09` 已成立、终止决定 `REC-DEC-01` 依据可核）时，允许在“无验收”下进入结清——终止工作不需要验收成立，只需要终止依据与八项处置；不得因“没有验收”把已终止的工作永久卡在未结清。**注意 `TS-PORT-LIFE-01` 是公司身份生命周期，不能证明“工作终止”**，两者不得互相替代
- **后置**：产出 `REC-EVD-06`（decision facet）；结清后才允许回收。`settled_state='转入清算'` 时**必须先由 `REC-LIFE-02` 承接清算范围与未承接项**，才允许 `CLOSE`；未承接前 `CLOSE` 判负（回收≠清算，77-§6.8.1）
- **错误**：任一项未关 → `partial`（不是失败，逐项给范围）；无验收且**非**合法终止即结清 `rejected_precondition`；`in_liquidation` 未承接就要求 `CLOSE` → `rejected_state`
- **幂等/预期版本**：按 `(ticket, attempt)` 幂等；部分结清可多次追加，每次只追加不覆盖
- **事务与证据**：结清记录；证据=八项关闭依据 + `dissent` + 承接确认（清算时）
- **等级/锚点**：experimental；77-§6.8、§10.5、`RUN-EVD-03`；现状无等价物（`CLOSE` 事件是回收，不是结清）

#### TS-PORT-WORK-08 `QualificationPort`

- **签名**：`determine(req: QualificationRequest): Promise<Result<RecQualificationDetermination, ClassifiedError>>`；`current(subject: SubjectRef, need: CapabilityNeed): Promise<RecQualificationDetermination | undefined>`
- **参数与返回**：`QualificationRequest` 含主体、能力需求引用、证据引用、判定者、范围与有效期（77-§4.7）
- **前置**：能力需求与证据都带版本；判定者与被判者不得同一主体
- **后置**：产出 `REC-WORK-08`；**只判资格**，不解析能力（`CapabilityResolver`）、不授权（签发/行使/撤回归 `TS-PORT-AUTH-05 AuthorityGrantPort`，事实域端点激活归 `TS-PORT-AUTH-03 AuthorityActivationPort`）、不安装（`TS-PORT-CAP-02`）
- **错误**：证据不足 `rejected_precondition`；判定者不独立 `rejected_authority`；需求不可解析 `rejected_version`
- **幂等/预期版本**：按 `(subject, needRef, evidenceDigest)` 幂等；有效期到期须重认
- **事务与证据**：资格记录；证据=逐项证据引用
- **等级/锚点**：experimental；77-§4.7、71-§1.3

#### TS-PORT-WORK-09 `RiskClassifier`

- **签名**：`classify(req: RiskRequest): Promise<Result<RecRiskClassification, ClassifiedError>>`；`current(ticket: TicketId, attempt: AttemptNo): Promise<RecRiskClassification | undefined>`
- **参数与返回**：风险档、影响面、不可逆性、外部性、依据引用（77-§5.7）；带 decision facet
- **前置**：分类者不得是交付方本人；依据必须可复核
- **后置**：产出 `REC-WORK-11`；分类只增不降；降档必须由独立位置作出并留异议位置
- **错误**：交付方自评 `rejected_authority`；依据缺失 `rejected_precondition`
- **幂等/预期版本**：按 `(ticket, attempt, riskInputDigest)` 幂等
- **事务与证据**：风险记录 + facet；证据=依据与异议位置
- **等级/锚点**：experimental；77-§5.7、§1.7

#### TS-PORT-WORK-10 `AssignmentPort`

- **签名**：`request(req: AssignmentRequest): Promise<Result<RecAssignmentRequest, ClassifiedError>>`；`respond(id: Qid, response: AssignmentResponse): Promise<Result<RecAssignmentRequest, ClassifiedError>>`
- **参数与返回**：`actionKind` 十一取值（派工/领取/转派 + 八类协作）；`carriedTerms`、`deadline`、`noResponseEffect`、`handoverChecklist`（77-§4.10）
- **前置**：派工须合同五要件齐、被派方资格/容量/禁配可判；移交/接力须有交接包
- **后置**：产出 `REC-WORK-10`；未响应语义按动作逐项执行（不视为同意/未确认即未移交/未签不生效）
- **错误**：要件缺失 `rejected_precondition`；越权转派 `rejected_authority`；资格/容量不符 `rejected_state`
- **幂等/预期版本**：按 `(workRef, actionKind, from, to, deadline)` 幂等；响应按 `(requestId, response)` 幂等
- **事务与证据**：派工/响应记录；证据=携带条款与交接单
- **等级/锚点**：experimental；77-§4.10

#### TS-PORT-WORK-11 `AttendancePort`

- **签名**：`open(segment: AttendanceDraft): Promise<Result<RecWorkAttendance, ClassifiedError>>`；`close(id: Qid, at: Timestamp): Promise<Result<RecAttendanceSegment, ClassifiedError>>`
- **参数与返回**：`AttendanceDraft` 必须齐 **REC-WORK-06 的六面**（77-§4.6.1）：`holder`、`appointment_ref`、`rank_interface_ref`（岗位要求职级时必填；**不适用必须写理由**，不得留白）、`qualification_refs`、`plan_ref`、`authorization_ref`；连同 `work_ref`、`period`、`responsibility_scope`、`consistency_check` 一并给。所有引用必须带 **ID + 版本**，且相互一致（任用范围覆盖本工作、资格覆盖本任务、计划钉住版本在授权范围内、任命已生效）
- **前置**：六面齐**且相互一致**；缺一面或任一面引用不一致即不成立（走补证/改派/拒绝，不得“先出工后补”）；出工段逐段可核（77-§4.6.2），段边界=实质能力配置变化、授权变化、交接、暂停恢复
- **后置**：产出 `REC-WORK-06`（出工）+ `REC-WORK-07`（出工段）；段间替换不合并成一段；每次重试不重置工作身份、禁配、资源累计与失败次数
- **错误**：六面缺项或任命未生效 `rejected_precondition`；引用版本互不一致 `rejected_version`；时间重叠 `rejected_state`
- **幂等/预期版本**：按 `(workRef, holder, period.from)` 幂等
- **事务与证据**：出工记录 + 段记录；证据=六面引用 + `consistency_check` 结果
- **等级/锚点**：experimental；77-§4.6.1/§4.6.2、71-§2.1/§2.2

#### TS-PORT-RES-01 `ResourceAccountant`

〔结论〕资源面目前**没有专用端口**：开工五门的“资源”输入（`ResourceBaseline`）、执行计划锁的资源边界、结清的“资源”一项，都靠散落字段承载；`queryBudget(issue)` 只是工具面的只读视图（§11.4）。本端口**只做公共只读评估**：给定主体与额度定义，算出跨环的额度/预留/实际/剩余/缺口。**不提供** `reserve`/`actual`/`release` 一类公共写口，**不新增写入者、不新增 `REC-*`**。

```ts
// 额度是定义/策略，不是 REC：用 DefinitionRef，不用 VersionRef<RecordRef>
interface ResourceBaselineRequest { subjectRef: SubjectRef; quotaRef: DefinitionRef; asOf: Timestamp }

type ResourceLimit =                      // 三个机器态，缺省是 unknown，不是 0、也不是“无限”
  | { kind: 'finite'; amount: DecimalString }
  | { kind: 'unbounded' }                 // 明确“不设上限”，必须有权威定义支撑
  | { kind: 'unknown'; reason?: string }  // 读不到额度：**不得**渲染成 0 或“剩余=全部”

interface ResourceEntry {                 // 逐资源一行：同一 subject 下按 resourceRef 分项
  resourceRef: DefinitionRef              // 该资源的定义（额度档/单位/计价口径都在定义里）
  unit: string                            // 计量单位（与定义一致；不一致即不合格）
  limit: ResourceLimit
  reserved?: DecimalString                // 缺省 = 未知（不是 0）：无预留记录 ≠ 没预留
  consumed?: DecimalString                // 缺省 = 未知（不是 0）：无实际记录 ≠ 没消耗
  remaining?: DecimalString               // 缺省 = 未知；只有 limit 与 reserved/consumed 都已知时才给
}

interface ResourceBaseline {              // 77-§4.4.1 resource_baseline 的结构（本节唯一承载）
  subjectRef: SubjectRef
  quotaRef: DefinitionRef
  entries: readonly ResourceEntry[]       // 逐资源；空数组 = 未声明任何资源，不等于“资源充足”
  asOf: Timestamp                         // 评估时点（调用方给，端口不读宿主时间）
  gaps: readonly ResourceGap[]
}

type ResourceGap =
  | { kind: 'quota-unreadable'; resourceRef: DefinitionRef; reason?: string }
  | { kind: 'over-reserved'; resourceRef: DefinitionRef; detailRef?: RecordRef }      // 预留 > 额度
  | { kind: 'unreconciled-actual'; resourceRef: DefinitionRef; detailRef?: RecordRef } // 实际与记录对不上
  | { kind: 'reservation-record-missing'; resourceRef: DefinitionRef }                // 记录里查无预留，只能按未知处置
```

- **签名（只两个方法，均只读）**：`baseline(req: ResourceBaselineRequest): Promise<Result<ResourceBaseline, ClassifiedError>>`；`gap(subject: SubjectRef): Promise<Result<readonly ResourceGap[], ClassifiedError>>`。**没有** `reserve`/`actual`/`release`，也没有任何 `Qid` 回执形状——预留、实际、释放都不是本端口的写动作（见下条）。
- **资源事实的记录落点（本端口不写）**：**预留**=`REC-WORK-05.resource_reservations`（计划锁定时由 `TS-PORT-WORK-04 ExecutionPlanPort.lock` 在同一事务写入其自己的记录）；**实际**=`REC-EVD-01`（收割的材料与计量）/`REC-EVD-05`（价值评估的口径）；**释放**=`REC-EVD-06`（结清时的资源项）。这些记录由**写入它们的三个端口**在同一事务里经 `store` 拥有的 projection hook 派生进资源账目表——投影名 `resourceLedger`、物理表 `resource_ledger`（§6.3 已登记为**目标第 18 个投影名**，随 `MIG-01` 建表；与记录同一事务提交，删表可由记录重建）。**`ResourceAccountant` 自己不写这张表**（`baseline`/`gap` 只读，见下“后置”）：它既不写记录、也不写投影，更不提供 `reserve`/`actual`/`release`——投影是**派生结果**，不是第二事实源，也不是本端口的写口。
- **顺序：合同 → 计划锁（写预留记录）→ 五门（读 baseline）→ 出工段**，不得循环：**计划锁 ≠ 五门通过**（锁只钉版本、写预留、产出基线快照；不判任何一门），而 **`planRef` 正是能力门的输入**——`ReadinessRequest.planRef` 指向**已锁定的计划记录**，用于能力门核对“按哪份计划干”；额度预留则已随该次 `lock` 落进 `REC-WORK-05`。因此顺序是“先锁、后判”，不是“锁是判的输入之一才成环”。`baseline()` 只读“定义 + 已提交记录”，不要求也不触发新的计划锁；五门重判时 `planRef` 不变即可。若某单尚无计划记录，资源门的 `entries` 一律 `limit/remaining = unknown` 并给 `reservation-record-missing` 缺口，**不得**按“还没预留所以额度全空”判成充足。
- **口径（跨环，不是单环）**：金额与数量一律 `DecimalString` + 单位（不写 `number`，§4.1 `TS-SCALAR-04`）；`reserved`/`consumed`/`remaining` 的**缺省是未知**，不是 0、也不是“等于 limit”。`remaining` 只在 `limit` 有限且已知占用都齐时给出；`limit.kind='unknown'` 时 `remaining` 必须缺省（不得写成“无限”）。
- **缺省即缺口，不得判充足（有限额度专用）**：`limit.kind === 'finite'` 而 `reserved` 或 `consumed` 任一缺省时，**必须**在 `gaps` 里给对应缺口——预留缺 ⇒ `{ kind: 'reservation-record-missing', resourceRef }`，实际缺 ⇒ `{ kind: 'unreconciled-actual', resourceRef }`（两者都缺就两条都给）。该 `ResourceEntry` 因此是**占用未知**：不给 `remaining`，资源门**不得**据它判通过（不得把未知预留当 0、也不得把未知实际当“没消耗”）。反过来，只有 `limit` 有限、`reserved`/`consumed`/`remaining` 三者齐备，且 `remaining = limit.amount − reserved − consumed` 成立时，该 entry 才算**可判充足的完整证据**；等式只在三值都有时校验，缺值先按缺口处理、不进入等式校验（不得“有值才算、没值就跳过并当 0”）。
- **前置**：`quotaRef` 可解析且带版本；`subjectRef` 与计划/结清所指主体一致；`asOf` 由调用方给。
- **后置**：`baseline`/`gap` 是**纯只读评估**——不写记录、不写投影表、不改任何表；它返回的 `ResourceBaseline` 是现算视图（可重建），投影行 `resourceLedger` 由 `store` 的 projection hook 在**别人的记录事务**里维护（见上条），与本端口的调用**无因果关系**。不产出新的 `REC-*`、不改 `REC-WORK-05`/`REC-EVD-01`/`05`/`06`。`baseline()` 是五门资源门的输入，只读、可重算，同一 `(subjectRef, quotaRef, asOf)` 重算必须逐字段一致——**不得**靠“读自己上次写的投影”来保证一致（那是自证）。
- **错误**：额度定义不可解析 `rejected_version`；主体不一致 `rejected_precondition`；记录侧不可读 `unavailable`（**不得**返回“剩余=全部额度”冒充充足）；`gaps` 非空时仍返回 `Ok`——缺口是**结论的一部分**，不是异常（否则调用方只能靠猜）。
- **幂等/预期版本**：只读方法天然幂等；同一 `asOf` 下重算结果一致，`asOf` 变即重算。
- **事务与证据**：只读；证据=被读记录的引用集合 + 逐项差额。投影行的维护由 `store` 的 projection hook 负责，失败不影响记录事实（由 `rebuild` 修复）。
- **等级/锚点**：experimental；**未实现**（仓内无 `core/src/resources/` 与 `store/src/resources/`、无资源账目表与投影；现状预算只在 `core` 的预算闸与 `queryBudget` 投影；落点目标见 §6.9）；77-§4.4.1 `resource_baseline`、§4.5.1（计划边界）、§6.8（结清“资源”项）。
- **记录落点核对（已对齐，无上位缺口）**：① 77-§4.4.1 的 `resource_baseline` 子字段已按上述结构对齐（`entries` 逐资源 + 三态 `limit`），若 77 定稿与之不同，以 77 为准并改本段；② `REC-WORK-05.resource_reservations` 在 77-§4.5.1 **已存在**（逐项 `{resource_ref, amount, unit, period, quota_ref}`，并已写明“写入口唯一/不另起公共写口/空列表≠充足/实际与释放不写在这里”四条约束），与本端口“预留随计划锁、只读派生”的口径一致——因此**不存在需要 77 补字段的缺口**；本卷要做的只是 80 侧实现（端口 + 投影 + 落点）与 `ResourceEntry` 的派生映射。若 77 日后改字段形状，本段的派生映射随之改（§13.2 S3/S4）。

### 6.5 执行面：适配器与四原语映射

#### TS-PORT-EXEC-01 `ExecutorAdapter`

- **签名**（现状已冻结于 `contract/src/ports/executor.ts:43`）：`detect(): Promise<DetectResult>`；`estimate(task: TaskBrief): Promise<BudgetEstimate>`；`launch(task: TaskBrief): Promise<Handle>`；`stream(h: Handle): AsyncIterable<StreamEvent>`；`resultStats(h: Handle): Promise<ResultStats>`；`kill(h: Handle, graceMs: number): Promise<void>`
- **参数与返回**：`TaskBrief` 现状含 `credentials`（适配器无条件透传、不得记录）；`Handle` 含 `pid`、可选 `executorSessionId`
- **前置**：`launch` 前 daemon 已 mint 凭据并注入 env；`detect` 的 `gaps` 必须非空时明报（不得静默降级）
- **后置**：`stream` 只发四种归一事件（`step_start`/`step_end`/`turn_end`/`log`）；`kill` 后必须等死（`await`）
- **错误**：`turn_end.errorCode` 取 `EXECUTOR_ERROR_CODES` 词表（`schemas/errors.ts:77`）；适配器不得自造码
- **幂等/预期版本**：`launch` 非幂等（每次新进程）；`kill` 幂等
- **事务与证据**：`resultStats` 四桶 + 模型归一形；证据=`REC-EVD-01`
- **等级/锚点**：experimental（`PORT_VERSION v0`）；77-§6.1、`RUN-EVD-01`、79-§10

〔结论〕目标接口只补两处，不改四原语：

1. `TaskBrief` 增 `planRef?: VersionRef<string>`（执行计划锁），让适配器知道自己执行的是哪版计划；
2. `Handle` 增 `fence?: FenceToken`（仅当执行体要写共享存储时），与 `TS-PORT-AUTH-04` 对齐。

#### TS-PORT-CAP-01 `CapabilityResolver`

- **签名**：`resolve(need: CapabilityNeed): Promise<Result<CapabilityCandidate[], ClassifiedError>>`
- **语义**：把“需要什么能力”解析为“哪些候选能提供”；**不判资格**（资格归 `TS-PORT-WORK-08 QualificationPort`）、不授权（签发/行使/撤回归 `TS-PORT-AUTH-05`，端点激活归 `TS-PORT-AUTH-03`）、不安装（归 `TS-PORT-CAP-02`）
- **错误**：无候选 = 空数组（正常）；需求本身非法 `rejected_precondition`
- **锚点**：71-§1、78；现状 `adapters/registry.ts` 的 `resolve` 只做“名字→工厂”

#### TS-PORT-CAP-02 `CapabilityInstaller`

- **签名**：`install(pkg: CapabilityPackage, target: InstallTarget): Promise<Result<InstallReceipt, ClassifiedError>>`；`uninstall(id: string): Promise<Result<void, ClassifiedError>>`
- **语义**：安装只让包**存在于**目标环境；不挂载、不加载、不激活（D75-12）
- **错误**：依赖缺失 `rejected_precondition`；版本冲突 `rejected_version`
- **幂等**：按 `(packageDigest, target)` 幂等
- **证据**：安装回执（不是 `REC-WORK-*`）

#### TS-PORT-CAP-03 `CapabilityMounter`

- **签名**：`mount(id: string, mountPoint: MountPoint): Promise<Result<MountReceipt, ClassifiedError>>`；`unmount(id: string): Promise<Result<void, ClassifiedError>>`
- **语义**：挂载让包**进入**宿主可见范围（如 DSH 插件目录）；仍不等于加载成功
- **错误**：宿主不认 `unsupported`；路径越界 `path-escape`

#### TS-PORT-CAP-04 `CapabilityProbe`

- **签名**：`probe(id: string): Promise<Result<ProbeReport, ClassifiedError>>`（不可探测 → `Err(unverified)`；`ProbeReport` 本身表达“证明了什么/没证明什么”）
- **语义**：探测回答“挂载后宿主是否真的看见并加载”；`ProbeReport` 必须含“证明了什么/没证明什么”
- **错误**：探测不可行 `unverified`（不是 `false`）
- **锚点**：78 的负向探针；现状 `dsh-bridge` 无探针

#### TS-PORT-CAP-05 `CapabilityActivator`

- **签名**：`activate(id: string, basis: ActivationBasis): Promise<Result<ActivationReceipt, ClassifiedError>>`
- **语义**：**能力激活**，与 `TS-PORT-AUTH-03` 的**权威激活**是两个不同记录的语义。前者回答“这版能力开始被使用”，后者回答“谁有权让某端点代表公司”
- **错误**：未挂载/未探测 `rejected_state`；未授权 `rejected_authority`

#### TS-PORT-CAP-06 `CapabilityRetirer`

- **签名**：`retire(id: string, plan: RetirementPlan): Promise<Result<RetirementReceipt, ClassifiedError>>`
- **语义**：退役必须给“在途怎么办、谁接手、何时删”；默认走交接（D75-12），不假定原地热更
- **错误**：在途未交接 `rejected_state`；有活 worker `rejected_forbidden`

〔结论〕六个端口的**状态机不可合并**。现状把“安装/挂载/加载/资格/授权/生效”常混称“热更”（75-§八第 6 条禁止），目标态必须逐段可查：安装回执 → 挂载回执 → 探测报告 → 资格认定（`REC-WORK-08`）→ 权威激活（`REC-AUTH-07`）→ 能力激活回执。

〔结论〕**`engine/fakes.ts` 只许 demo 与测试**。`createFakePlatform`（`engine/fakes.ts:78`）与 `createFakeAdapter`（`:333`）是进程内假体，只允许出现在三处：单测/契约测试、显式 `--demo` 演示模式、崩溃注入。**不得用于真实公司的运行或激活**：真实装配（`buildServeRuntime`/`runServe`）不得因缺配置而回落到 fake 平台或 fake 适配器；真实公司缺平台绑定或执行体时必须 `Err(unavailable)` / `Err(rejected_precondition)` 并显式报警，不得“先跑起来再说”。fake 不是实现——它不产生证据、不进台账、不得计入 §12 的已实现项。

### 6.6 效果、证据、验收、记忆、观察、绑定、迁移、通知与对外提交

#### TS-PORT-EFF-01 `EffectGateway`

- **签名**：`apply(effect: EffectRequest): Promise<Result<EffectOutcome, EffectError>>`
- **参数与返回**：`EffectRequest = { authorityRef: VersionRef<string>; effect: EffectDescriptor; credentialRef?: VersionRef<string>; fence?: FenceToken; idempotencyKey: string; target: EffectTarget }`。`credentialRef` 是**逻辑引用，不是 token/秘密值**。`EffectDescriptor.action` 是九个 **`ControlEffectAction`**，不是六个工具动词的任意集合：`comment`/`article` 经工具路由翻译为 `comments.add`/`kb.upsert` 后才可进入；`heartbeat`/`evidence-write`/`kb-search`/`budget-query` 各有自己的后端，不得借本端口伪称平台写。`EffectAction` 仍用于凭据 scope 的并集。`origin.kind='work-intent'` 时必须给 `intentRef`，其他来源给 `sourceRef`；`partialItems` 缺省表示整体执行。`EffectOutcome` 见 §5.2：`applied` 必带 `receiptRef`，`unknown` 必带 `unknownRef`、`reason` 可选；`rejected`/`partial` 走 `Err`，`unknown` 留在 `Ok`，不得重试直写。
- **内部执行面**：工厂另注入 `EffectCredentialBroker` 与 §4.3.1 的 **`EffectWriter`**。writer 不是新公共端口，唯一实现归现有 `engine/tools/gated-platform.ts`：它按九个动作调用注入的 `FlowPlatform`，不再自行过闸，故不得把已经过闸的平台再包一层造成双验签/双写。平台应答只有具备原生对象引用与执行后版本才可回 `committed`；`void`、仅排队或不可核的应答回 `unknown`，**不得**编造 `externalRef`/`resultingVersion`。绑定须给出每项写的回执或读回核验方法；给不出时允许执行但只能进入未知对账，不得返回 `applied`。
- **动作与编码**：现有 **`packages/gateway/src/actions.ts`** 唯一负责 `ControlEffectAction → { gatewayAction, args }` 映射和编解码（`F-gateway-actions`，不新增 `effect-actions.ts`）：`comments.add → comment`，`kb.upsert → article`，其余控制效果 → `comment + args.op=<effect.action>`。`effect.action` 与映射后的 `gatewayAction` 均须在 `claims.scope` 内；高层效果调用目标内核 `gateWrite(token, gatewayAction, payload, {effectAction: effect.action})`（§11.1）。`args.op` 是编码结果，不是授权依据；适配器不得另写映射或拼第二份 `@action`。
- **顺序（先尝试、后外部）**：① 按 `idempotencyKey` 精确查 `REC-RCP-01` 与同键 `REC-EVT-01` 效果尝试；同键同效果已有回执→返回原回执，不同效果→`rejected_idempotency`；② 解析 `authorityRef`、凭据与 fence，完成动作编码和内核验签；③ **在任何平台调用前**，以 `REC-EVT-01`（`event_kind='动作'`、`source_kind='操作记录'`）追加效果尝试，`payload_summary` 只含 `effect-attempt`、`idempotencyKey`、效果摘要、目标、主体与时刻，**不含秘密或完整参数**；`AppendOptions.idempotencyKey` 取本请求键，复用 §6.3 的幂等唯一索引。`deduped=true` 表示已有尝试：只读既有回执/未知，**不得再次调用平台**；尚无结局则登记或返回对账中的未知。④ 仅对新尝试调 `EffectWriter.write`；⑤ `committed` 先落 `REC-RCP-01`（`acknowledges=attemptRef`、`ack_kind='已执行'`、`side_effect_possible=true`、原生版本与外部引用）再返回 `applied`；`unknown`、回执写失败或已发送后的异常先落 `REC-EVT-03`，经信封 `lineage.parentRefs` 链到 attempt，意图域仍必须有 `unknown_scope.intentRef`，再返回 `unknown`。
- **并发与恢复**：同键并发由记录面的唯一索引收敛为**一个持久化尝试**，后到者不得绕过该尝试直接执行。跨进程仍须互认 fence；没有时 `unsupported`，不得并发双写。`REC-06` 重启扫描“有 attempt、无回执/未知”的记录并登记未知、冻结该键，**不得**把无回执等同于未执行。框架只承诺“一个持久化尝试最多主动发起一次平台调用”，**不承诺**外部系统物理效果恰好一次；外部重复、迟到与平台自身重试只能由原生幂等键与对账识别/消解。
- **错误与部分效果**：无权 `rejected_authority`、越权 `rejected_forbidden`；`EffectWriter` 的 `Err` 仅用于确定未产生外部效果的拒绝，已发送后的不明一律上述未知路径。登记失败 `Err(unavailable/STALL/unknown-record-unwritten)`，不得返回无引用结果。`partialItems` 中每项各自拥有独立键、attempt 与回执/未知；缺任一项即不得报告 `partial`，整体转 `unavailable` 对账。没有平台事务证明时，缺省“整体执行”只表示不得自行拆批，**不表示外部多动作原子**。
- **后置与证据**：网关不能自己授予；`applied` 必须先取得可核外部回执并写 `REC-RCP-01`，`unknown` 必须先写 `REC-EVT-03`。证据=效果尝试 + 回执/未知 + `REC-EVT-02` 对账，不能只存网关“允许”结果。
- **等级/锚点**：experimental；包装 `gateway.createGateway().gateWrite`（`gateway/src/gateway.ts:52`）+ `engine/tools/gated-platform.ts`；77-§2.4、§2.6、`RUN-AUTH-04`、17-§7。现状 `gateWrite` 的 verify → parseAction → signedBody 三段保留为内核；`GATED_WRITE_METHODS`（`gated-platform.ts:66`）的九条写面分类保留，**目标实现与回执能力均未落地**。

#### TS-PORT-EVD-01 `EvidenceHarvester`

- **签名**：`harvest(entry: HarvestEntry): Promise<Result<HarvestOutcome, ClassifiedError>>`；`verify(bundleId: Qid): Promise<Result<EvidenceVerification, ClassifiedError>>`
- **语义**：**只收材料**，不判验收。四要件（终态、输出非空、退出码、报告落盘）归 77-§6.1 与 17-§6。`Ok(HarvestOutcome)` 只表示“收口完成、材料清单已定”，不表示材料齐备；材料缺项按 `Err(unverified)` 或 `Ok` 内逐项缺口表达，二者不得混用
- **错误**：材料缺失 `unverified`；材料冲突 `conflict`；**不得**用“没找到”推断“没做”
- **幂等**：按 `(ticket, attempt, source)` 幂等
- **证据**：`REC-EVD-01/02/03`
- **锚点**：包装 `finalizeHarvest`（`engine.ts:1224`）/`failHarvest`（`:1361`）；现状四要件在 `harvestOne`（`:1146`）

#### TS-PORT-EVD-02 `AcceptanceEvaluator`

- **签名**：`evaluate(req: AcceptanceRequest): Promise<Result<RecAcceptance, ClassifiedError>>`
- **参数与返回**：四个独立性维度（位置、风险、外部效果、价值）+ 接受/附条件/拒绝/依授权终止四结论（77-§6.4）
- **前置**：证据包齐；评估者与交付方**不是同一主体**（独立性是关系，不是声明）。**证据包只含 `REC-EVD-01/02/03` 的材料，不含 `REC-EVD-05`（价值评估）**——价值在验收之后由 `TS-PORT-EVD-03` 判，验收不得读未来的价值结论
- **后置**：产出 `REC-EVD-04`（decision facet）；接受 ≠ 结清
- **错误**：独立性不成立 `rejected_authority`；证据不足 `rejected_precondition`
- **幂等**：按 `(ticket, attempt, bundleId)` 幂等
- **证据**：验收记录 + 独立性依据（评估者与交付方的主体关系）+ 证据包引用（`REC-EVD-01/02/03`）；**不含** `REC-EVD-05`（价值结论在验收之后）
- **锚点**：包装 `GateRunner`（`engine/gate.ts`）+ 相位 4 的 `collect`（`engine.ts:2032`）；现状只有“闸门 exit 0”，无独立性维度

#### TS-PORT-MEM-01 `MemoryStore`

- **签名**：`write(entry: RecMemoryEntry): Promise<Result<Qid, ClassifiedError>>`；`read(q: MemoryQuery, access: AccessContext): Promise<Result<readonly RecMemoryEntry[], ClassifiedError>>`；`dispose(d: RecMemoryDisposition): Promise<Result<void, ClassifiedError>>`
- **参数与返回**：四层（个人/出工/岗位/组织）不合并；`MemoryQuery` 必须带层；`AccessContext` 含“谁、为何、用到哪”
- **前置**：读也必须带访问理由
- **后置**：每次读产出 `REC-MEM-02`；处置五操作（修正/清除/继承/转层/封存，77-§8.4.1）产出 `REC-MEM-03`，**不得**删除原文；`继承`/`转层` 必须取得接收确认（技术校验不替代接受），并写 `residue_statement`（原始来源与外部副本可能仍存在）
- **错误**：越层读 `rejected_forbidden`；无访问理由 `rejected_precondition`
- **幂等**：写按 `(layer, subject, sourceRef)` 幂等；处置按 `dispositionId` 幂等
- **证据**：记忆记录 + 审计 + 处置
- **锚点**：新建；77-§8、`RUN-MEM-01`；现状无记忆存储（提示词组装只读公司目录）

#### TS-PORT-OBS-01 `ObservationProjector`

- **签名**：`project(view: ViewName, cursor?: string): Promise<RecProjectionSnapshot>`；`faults(since: Timestamp): Promise<readonly RecObservationFault[]>`（**无 `Result` 通道**：失败以六态与 `faults` 表达，不以异常/500 替代状态）
- **参数与返回**：六态（`observed`/`derived`/`unknown`/`stale`/`conflict`/`gap`，即 77-§9.2 的「已观察/已推导/未知/陈旧/冲突或受损/缺口或中断」）必须逐字段可判；11 个观察面归 77-§9.3
- **前置**：只读；不得写事实源
- **后置**：投影必须带来源游标与规则版本；**未知不得显示为 0/空/绿**
- **错误**：来源不可达 → `state='gap'` + `REC-OBS-02`；不得抛给 UI 变成 500。本端口**无 `Result` 通道**：失败一律以六态快照与 `faults` 表达，不以异常/500 替代状态
- **幂等**：纯读 + 可重建投影
- **证据**：`REC-OBS-01/02`
- **锚点**：包装 `panel` 的 `buildDashboardSnapshot`、`buildInboxSnapshot`（`panel/src/inbox.ts`）、`overview` 的 `buildOrgPayload`；现状无六态，`/api/health` 只给 ok

#### TS-PORT-BIND-01 `PlatformBindingPort`

- **签名**：`describe(): Promise<Result<BindingProfile, ClassifiedError>>`；`mapState(platformState: string): Result<StateMapping, ClassifiedError>`（**未映射但合法 → `Ok(unverified)`**，不回落默认态、也不回 `Err`；只有空/畸形原值才 `Err(rejected_precondition)`）；`exportBundle(scope: ExportScope): Promise<Result<ExportBundle, ClassifiedError>>`；`exitPlan(): ExitPlan`（纯声明，无拒绝通道）
- **参数与返回（目标 TS 形状；映射 78 `BIND-CORE-01`，不重新定义 78）**：

```ts
type BindingFactStatus = '已有' | '库级' | '目标' | '未证'

interface BindingProfile {                 // 20 字段，逐项对应 78-§1.2；缺项 = 不完整
  bindingId: string                        // 1  BIND-<域>-<序号>
  version: SemVer                          // 2
  semanticDigest: Digest                   // 3  正文按 jcs 规范化
  title: string                            // 4
  ownerPositionRef: Qid                    // 5  具名位置（kind ∈ {'position','governance-position'}）；无主不得引用
  scope: {                                 // 6  范围外必须拒绝，不得静默套用
    companyRefs: readonly CompanySlug[]
    deploymentRefs: readonly string[]
    hosts: readonly string[]
    platforms: readonly { kind: string; host: string; version: string }[]
    stores: readonly string[]
  }
  coreClauses: readonly { clauseRef: string; kind: 'must' | 'must-not'; statement: string; testableBy: string }[]   // 7
  coveredObjects: readonly string[]        // 8
  uncoveredObjects: readonly { objectId: string; reason: string }[]   // 9  必填（可空但字段在）
  fieldMappings: readonly { ours: string; theirs: string; transform: string; lossRefs: readonly Qid[] }[]   // 10
  stateMappings: readonly { family: string; ours: readonly WorkState[]; theirs: string; direction: 'in' | 'out' | 'both'; lossRefs: readonly Qid[] }[]   // 11  必须带族名；`ours` 只许 `STAT-D` 工作族（76-§7.7），不得声明 `STAT-E`
  provisioning: { source: string; method: string; targetLocation: string; integrity: string; license: string; pinnedVersion: string }   // 12  缺 pinnedVersion = 不得供给
  authorization: { bindingAuthorityRef: Qid; activationRef?: Qid }   // 13  权威端点激活性引用
  effective: { state: string; from: Timestamp; until?: Timestamp; reviewBy: Timestamp }   // 14
  evidence: { sinks: readonly string[]; eventKinds: readonly string[]; retention: string; redaction: string; independentVerifierRef?: SubjectRef }   // 15
  losses: readonly Qid[]                   // 16  **REC-LOSS-01 引用**（不内联对象）
  exportMigrationExit: { exportShape: string; migrationPath: string; exitPlan: ExitPlan; fallbackRef?: string }   // 17
  probes: readonly { probeId: string; purpose: string; layer: 'V0'|'V1'|'V2'|'V3'|'V4'|'V5'; state: 'executed'|'not-executed'|'not-applicable'; evidenceRef?: Qid }[]   // 18  未执行不得写“预期通过”
  factStatus: BindingFactStatus            // 19
  supersedes?: string; supersededBy?: string   // 20  版本谱系
}

interface StateMapping {                   // 运行时映射结果（**无 mapped 字段**：false 分支不可达）
  platformState: string                    // 平台原状态，原样保留
  workStates: readonly WorkState[]         // 只许 STAT-D 工作族（76-§7.7）；**禁 STAT-E**；多对一必须列全；未命中时空数组 + `verification:'unverified'`
  verification: 'verified' | 'unverified'  // unverified = 未映射但原值保留（`REC-OBS-02` 由**消费方**写，本函数不写记录）；**仍返回 Ok**
  unmappedBehavior: 'observe-unmapped'     // 唯一合法值：只观察、不推进；`workStates=[]` 时不得迁移/验收/结清
  note?: string
}

interface ExportScope {
  company: CompanySlug
  factDomains: readonly string[]
  timeRange: { from: Timestamp; until: Timestamp }
  cursor?: string                          // opaque
  knowledgeScope: KnowledgeScope           // 知悉范围；超出不导出
  memories: { include: readonly ('personal'|'work'|'position'|'org')[]; excludeSecrets: true }  // 秘密默认排除且不可关
}

interface ExportBundle {
  manifest: {
    bundleId: string                       // **非 qid**：导出包是产物，不是记录
    createdAt: Timestamp
    scopeDigest: Digest
    recordCount: number
    shape: {                               // 声明“装了什么”，不是“全都装了”
      formats: readonly string[]
      includesIdentity: boolean
      includesVersion: boolean
      includesAuthorityBasis: boolean
      includesProvenance: boolean
      includesDualTime: boolean
      includesOpenObligations: boolean
      includesCorrectionChain: boolean
    }
  }
  records: readonly RecordEnvelope<unknown>[]   // 只读、opaque（见下）
  provenance: readonly Provenance[]
  receipts: readonly Qid[]                      // REC-RCP-01
  losses: readonly Qid[]                        // REC-LOSS-01（RecBindingLossReport）
  openObligations: readonly Qid[]               // 未决义务引用；**迁移/退出时不可省**
  proof: { semanticDigest: Digest; signature: Signature }
}

interface ExitPlan {
  freezeWriter: { scope: 'binding' | 'domain'; frozenAt: Timestamp }              // ① 冻结旧写者
  exportVerification: { bundleId: string; verifiedBy: SubjectRef; verifiedAt: Timestamp }  // ② 导出核验（bundleId 非 qid）
  acceptance: { acceptedBy: SubjectRef; acceptedAt: Timestamp }                   // ③ 接收确认
  fence: { fenceToken: FenceToken; until: Timestamp }                             // ④ 围栏：旧写者不得续写
  lateReconciliation: { windowMs: number; owner: SubjectRef }                     // ⑤ 迟到对账
  activation: { newBindingId: string; authorityActivationRef: Qid; activatedAt: Timestamp }  // ⑥ 激活新绑定（权威激活性引用不可省）
  withdrawal: { credentialActions: readonly string[]; notifiedAt: Timestamp }      // ⑦ 撤回凭据/授权
  archive: { mode: 'read-only'; deleted: false }                                   // ⑧ 旧平台归档：只读、不删除
  exit: { completedAt?: Timestamp; unresolved: readonly string[] }                // ⑨ 退出（未结项显式列）
}
```

- **前置**：档案 20 字段齐（缺项即不完整，不得用散文补）；`coveredObjects`/`uncoveredObjects` 必须成对声明“覆盖/不覆盖”；`losses` 用 `REC-LOSS-01` 引用而非内联；`StateMapping` 的 `platformState` 必须原样上报，不得先归一化再映射。
- **后置**：`describe()` 必须能回答**谁负责（`ownerPositionRef`）/ 是否授权（`authorization`）/ 探针是否执行（`probes[].state`）**；不能退回一个无范围的投影，也不得删减字段充当“运行时视图”。映射无损失时 `losses: []` 必须显式；有损失必须逐项列。`ExitPlan` 是**声明 + 状态**，执行必须走具体端口并落记录——状态迁移走 `TS-PORT-WORK-05 WorkLifecycle`（`REC-WORK-09`），移交/档案走 `TS-PORT-LIFE-02 HandoverArchivePort`（`REC-LIFE-02`）、承继走 `TS-PORT-LIFE-03 SuccessionPort`（`REC-LIFE-03`）——不得写成 `TS-PORT-WORK-*`/`TS-PORT-LIFE-*` 之类的通配，也不允许“读一个 ExitPlan 就宣布退出完成”；退出后旧平台**只读不删除**（`archive.mode='read-only'`、`deleted:false`）。
- **导出完整性**：`manifest.shape` 是**声明**，不是强制全 true。`includesOpenObligations=false` 的交换**不得**称为完整；受限交换必须同时具备 `losses`（逐项损失）与拒绝面（范围外拒导）。未决义务（`openObligations`）在迁移/退出中**不可省**。
- **错误**：`mapState` 对**未映射但非空且合法**的原状态 ⇒ `Ok({ platformState, verification:'unverified', workStates: [], unmappedBehavior:'observe-unmapped' })`（原值保留、供观察；**本函数不写 `REC-OBS-02`**——记录由消费方按上文三层第 6 条写），**不丢弃、不默认 closed、也不回 `Err(unsupported)`**——未知状态是“观察事实”，不是调用失败；只有 `platformState` **为空/畸形**才 `Err({failure:'rejected_precondition', …})`。导出范围超出 `knowledgeScope` ⇒ `rejected_forbidden`；无接收确认就宣称退出 ⇒ `rejected_precondition`。
- **幂等**：`describe`/`mapState` 纯读；`exportBundle` 按 `(scopeDigest, cursor)` 幂等；`exitPlan` 读幂等。
- **证据**：`REC-LOSS-01` 的绑定特有损失（`RecBindingLossReport`，§4.8）+ 导出包摘要。
- **锚点**：包装 `FlowPlatform`（`contract/src/ports/platform.ts:179`）；现状 `FieldProvisionMap` 只覆盖字段/状态，无损失声明与退出计划

〔结论〕**未映射状态走“只读观察”，不并存 `Err` 与 `Ok`**：`mapState` 的返回只有两种——`Ok(unverified)` 或 `Err(rejected_precondition)`（空/畸形原值）。静态映射表可写“**未映射不得用于迁移**”，但那是**消费方**的拒绝（迁移/验收/结清读到 `workStates=[]` 时不推进、报缺映射），**不是** `mapState` 返回 `Err`。`workStates=[]` 时：不得生成状态迁移、不得判验收通过、不得判结清；推进路径读不到合法 `STAT-D` 就停在原地，**不得**把空数组读成 `accepted`/`settled`，也不得用 `closed` 反推。绑定方若给出 `STAT-E` 映射，一律判缺陷（78-§9.1、76-§7.7）。

〔结论〕**导出记录是 opaque 的**：`ExportBundle.records` 只用于保留/移交/审计取证，**不得**被任何端口当决策输入来驱动状态迁移或结清判定——导出物离开系统后，其语义只由交接档案（`REC-LIFE-02`）与接收确认承载。

〔结论〕`FlowPlatform` **保留**为“平台能力端口”（七能力：issues/comments/fields/kb/activity/links/guards）；`PlatformBindingPort` 是“绑定档案端口”，两者是**能力**与**档案**的关系。不得把 `FlowPlatform` 改名成 `PlatformBinding` 冒充已完成——现状 `contract/src/ports/company.ts:9` 已有一个 `PlatformBinding` 类型（公司快照里的平台声明），命名冲突须在 81 解决（建议：快照字段保留 `PlatformBinding`，端口命名 `PlatformBindingPort`）。

#### BIND-01 的三层归属（本卷已定，施工照此；不是新增端口）

〔结论〕**类型 / 宿主 / 平台数据分三层，不得混写**：

1. **类型只有一处**：`PlatformBindingPort` 与 `BindingProfile`/`StateMapping`/`ExportBundle`/`ExitPlan` 的形状落 `packages/contract/src/ports/binding.ts`（§6.9）；平台包与 daemon **只引用**，不得各抄一份形状。
2. **端口宿主只有一个**：通用实现落 `apps/daemon/src/assembly/platform/binding.ts`——由它组装 `describe()`（执行探针、合并档案、按需写 `REC-LOSS-01` 引用）、`exportBundle()`、`exitPlan()`，并在此处把平台包给的纯函数接到 `FlowPlatform` 上。现状 `assembly/platform/` 已有 `wire.ts`，新件放同目录（子域，不占域平面名额）。
3. **平台包只供平台特定数据**：`packages/localplatform/src/binding.ts`、`packages/taiga/src/binding.ts`、`packages/yt/src/binding.ts` 只导出**纯**函数/常量——`bindingProfile()`（档案骨架，不含运行期探针结果）、`mapState(platformState: string): Result<StateMapping, ClassifiedError>`、`lossReport()`（`RecBindingLossReport` 数据或 `REC-LOSS-01` 引用清单）。**不得**各自声称实现 `PlatformBindingPort` 全端口：不得导出 `describe`/`exportBundle`/`exitPlan`，不得读台账、写记录、起网络、读时钟。
4. **依赖方向已够，不新增包边**：`localplatform`/`taiga`/`yt` → `contract` 与 `daemon` → `{localplatform, taiga, yt, contract}` 均在 `allowedPackageEdges` 内（§2.3）；不把平台包并进 daemon，也不让平台包 import `store`/`gateway`。
5. **禁第二实现**：`PlatformBindingPort` 的实现全仓**有且仅有** `assembly/platform/binding.ts` 一处；平台包里出现 `describe`/`exportBundle`/`exitPlan`、第二份 `PlatformBindingPort` 实现，或 `appendEvent`/`RecordWriter` 之类写口，一律判双实现/越界（81 若已按“每平台一个完整端口实现”写，须按本条改）。
6. **未映射合法状态的 `REC-OBS-02` 由消费方写**：平台包 `mapState` 是**纯函数**（零 IO、不写记录、不读时钟），未映射但合法的原值只返回 `Ok({platformState, verification:'unverified', workStates:[], unmappedBehavior:'observe-unmapped'})`；写 `REC-OBS-02` 的是**消费方**（相位 2 的 state-diff 或 `TS-PORT-OBS-01` 观察面，§7.2/§6.6），同一单、同一原值、同一拍只写一条。映射函数自己写台账 = 纯函数偷偷 IO，判负。

#### TS-PORT-MIG-01 `MigrationService`

- **签名**：`plan(req: MigrationRequest): Result<MigrationPlan, ClassifiedError>`；`apply(plan: MigrationPlan): Promise<Result<MigrationReceipt, ClassifiedError>>`
- **语义**：定义/记录的版本迁移；`REC-MIG-01` 是记录，`REC-LOSS-01` 是损失。目标是**可审、可干跑、可停**，不是“一条命令改全库”：

```ts
interface MigrationRequest {
  fromAxis: string; toAxis: string; from: SpecVersion; to: SpecVersion
  scope: MigrationScope
  mode: 'dry-run' | 'apply'          // 本次调用是干跑还是实跑；**不再有** dryRun:boolean（避免与 plan 内字段重复）
}
interface MigrationScope { company?: CompanySlug; factDomains: readonly string[]; recordKinds: readonly string[]; timeRange?: { from: Timestamp; until: Timestamp } }
type MigrationActionKind = 'map' | 'rewrite' | 'rekey' | 'archive' | 'verify'   // 封闭联合；动作只能落这五种
interface MigrationPlan {
  planId: Qid; planDigest: Digest   // planDigest **不含** reportArtifactRef / snapshotArtifactRef（见下）
  fromAxis: string; toAxis: string                          // 版本轴（76-§8），不得省略
  from: { version: SpecVersion; semanticDigest: Digest }    // 版本 + 摘要（不是只有版本）
  to:   { version: SpecVersion; semanticDigest: Digest }
  scope: MigrationScope
  phases: readonly { id: string; kind: MigrationActionKind; reversible: boolean; actions: readonly string[] }[]
  dryRun: { required: true; reportArtifactRef?: string }    // reportArtifactRef **非 qid**（干跑报告是产物，不是记录）
  actions: readonly { actionId: string; kind: MigrationActionKind; target: Qid; reversible: boolean }[]
  lossRefs: readonly Qid[]                                  // REC-LOSS-01 引用
  stopConditions: readonly string[]                         // 停机/回退触发条件（不得空）
  rollback: { possible: boolean; steps?: readonly string[]; snapshotArtifactRef?: string }  // artifact 引用**非 qid**；possible=false 时 steps 必须为空
}
interface MigrationReceipt {
  planId: Qid
  migrated: readonly { recordId: Qid; newRecordId: Qid }[]
  losses: readonly Qid[]                                    // REC-LOSS-01
  status: 'applied' | 'partially_applied' | 'aborted' | 'unknown'   // unknown 走 REC-06 对账
  proofRef: Qid                                             // REC-MIG-01（迁移记录，不可省）
}
```

- **干跑与摘要**：`plan(req{ mode:'dry-run' })` 产出的 `planDigest` 只覆盖“语义部分”（轴/版本/摘要/范围/阶段/动作/损失引用/停机条件/回滚声明），**不含**任何 artifact 引用；干跑后按**同一 `planId`** 回填 `reportArtifactRef`，`planDigest` 不变。实跑时 `planDigest` 必须与已干跑的那份一致，否则 `Err({failure:'conflict', …})`。
- **引用纪律**：`lossRefs`/`losses`/`proofRef` 是**记录引用（Qid）**，分别对应 `REC-LOSS-01`/`REC-MIG-01`，不得泛化成“kind=record”；`reportArtifactRef`/`snapshotArtifactRef` 是**产物引用（string，非 qid）**，不得写成 `Qid`。

- **schema 迁移也产 `REC-MIG-01`（现状缺口）**：库从 vN 升到 vN+1 目前只有 `schema_version` 一行、没有任何记录（只有实现日志）。目标：DDL 波次必须在**独占事务**里写一条迁移记录，含 —— **计划**（`planId`/`planDigest`）、**前后版本**（`from`/`to` 的 schema 版本**加语义摘要**，不是只有版本号）、**转换规则**（每条波次/DDL → 一条规则，可逆性显式）、**范围**（公司/事实域/记录类型/时间窗）、**批准**（`authorizationRef`：谁依何权批准这次迁移）、**结果**（`resultDigest` + `converted`/`unconverted` + `lossRefs`）。`schema_version` 是内部机制面，**不得**当 `REC-MIG-01` 的替代；两者并存，谁也不许冒充谁。
- **`records` 落地前的过渡，以及落地后的重建**：`records` 表可用之前，迁移只写**实现日志**（`schema_version` + 迁移脚本版本行），且必须自称“实现日志、不是记录”——**不得**在文档或代码里把它读成 `REC-MIG-01`。`records` 可用后，把每条历史波次**重建**为一条 `REC-MIG-01`：`provenance.derivation='reconstructed'`，`observedTime`/`recordedTime` 均取**重建时刻**，`provenance.limitations` 写明“原始迁移时刻与批准材料未记录”。**不得**把时间回填成当年那一刻（那是伪装当时证据，§4.6 同口径）；旧行摘要不可复算时标 `unknown` + `REC-LOSS-01`，不得填占位摘要。
- **前置**：目标版本已发布；迁移只做**纯声明式映射**，不得执行任意代码；必须先以 `mode:'dry-run'` 跑过一次且 `reportArtifactRef` 已回填。
- **后置**：**不复活终态**：已 `dissolved/liquidated` 的身份、已 `settled` 的工作不得因迁移复活。**不可逆动作不得承诺自动回滚**：`rollback.possible=false` 时只能前滚或人工处置，`status` 不得写 `aborted` 冒充“已回滚干净”。
- **错误**：迁移不可逆且无快照 ⇒ `failure:'rejected_forbidden'`；未跑干跑 ⇒ `rejected_precondition`（`subcause:'dry-run-missing'`）；未知必需扩展 ⇒ `rejected_version`；干跑与实跑的计划摘要不一致 ⇒ `conflict`（合并域外按 `EXTERNAL_REJECT`）。`category` 按 §5.7 映射表推。
- **幂等**：按 `(from, to, planDigest)` 幂等；同一 `planDigest` 重放返回既有回执。
- **证据**：迁移记录 + 损失报告
- **锚点**：新建；`store/migrations.ts` 只做 SQLite schema，不是本端口

#### TS-PORT-NOTI-01 `Notifier`

- **签名**：`send(channel: string, message: Notification): Promise<Result<NotifySendReceipt, ClassifiedError>>`；`NotifySendReceipt = { status: 'sent' | 'failed' | 'skipped'; attempts: number; detail?: string }`（**单条**投递状态，不是广播报告）
- **参数与返回**：**不覆盖 `contract` 现有的 `Notification`**（`contract/src/ports/notifier.ts:6`–`:13`）：`{ kind: string; title: string; body: string; from?: string; links?: { label: string; url: string }[] }`。`from` 是**展示性字符串**（“宰相”“daemon”），不是授权主体、不证明签署——不得改成对象。需要“投递身份 + 目标”时用新的信封，而不是改 `Notification`：

```ts
interface NotificationEnvelope {
  notificationId: string           // 传输/去重 ID（**非 qid**）
  message: Notification            // contract 现有形状（原样，不改字段）
  targets: NotifyBroadcastTargets  // 广播目标（单发走 channel 参数，不用信封）
  dedupKey?: string                // 可选；缺省按 notificationId 去重
}
```

- **本地化键**：`titleKey`/`bodyKey` **只能**作为 `matrix` 静态消息表里的可选键（如告警模板），缺省必须回退 `message.title`/`message.body`；本卷**不虚构 catalog**，也不把 `from` 改成对象。
- **语义**：**告警不是决定**。通知失败不得回滚业务；通知成功不得被读成“已批准/已接收”。`status:'failed'|'skipped'` 是**投递状态**（§5.7 第 3 条豁免），不是业务拒绝；只有“通道未注册 / 消息缺稳定键”才是 `Err(rejected_precondition)`。
- **错误**：构造期非法 `rejected_precondition`；投递失败软失败（日志 + 指标 + `NotifySendReceipt`），不抛主循环
- **幂等**：至少一次；重复投递由订阅方按 `NotificationEnvelope.notificationId`（或 `dedupKey`）去重
- **证据**：`TickReport.events` 的中继事实；`REC-OBS-02` 记投递故障
- **锚点**：已有端口；目标态由 daemon 经 `RunServeOpts.matrixSessionFactory` 建会话后拿到 `matrix` 的 mention/广播/人事四面（boot 只构造工厂；四面直接注入仅测试与迁移兼容，§3.4 第 10 条）

〔结论〕**`Notifier` 与 `NotifyBroadcastFace` 不是同一个接口**，分开写、分开注入：

| | `Notifier`（本端口） | `NotifyBroadcastFace`（注入面，`RunServeOpts.notifyBroadcast`） |
|---|---|---|
| 目的 | 单条通知投递（告警/摘要/回执） | 向一组目标广播（daemon 拍末报告） |
| 签名 | `send(channel, message: Notification): Promise<Result<NotifySendReceipt, ClassifiedError>>` | `send(message: BroadcastMessage, targets: NotifyBroadcastTargets): Promise<NotifySendReport>` |
| 类型 | 本端口新增 `NotifySendReceipt` | `BroadcastMessage = Notification`、`NotifyTarget = NotifyBroadcastTargets`（**沿用现有形状**） |
| 返回 | 单条投递状态 | `NotifySendReport = { sent: readonly string[]; failed: readonly NotifySendFailure[] }`、`NotifySendFailure = { target: string; reason: string }`（与 `engine/notify/broadcast.ts:27`–`:35` **逐字段一致**） |
| 失败 | 软失败，入日志与指标 | 软失败，入日志与指标 |
| 不能证明 | 已批准/已接收 | 公司决定/验收通过/已通知到人 |

**目标映射**（不得混写）：daemon 拍末报告 → Matrix 房间（`room`）；人事变更 → 人事频道；**MCP 通知 → 只回当前 worker 会话（`mcp-session`），不经 `NotifyBroadcastFace`**。三者的 `target.kind` 取值固定，新增目标类型走提案。

#### TS-PORT-API-01 `IntentSubmissionPort`

- **签名**：`submit(intent: WebhookIntentPayload): Promise<Result<IntentSubmitResult, ClassifiedError>>`；`receipt(key: IntentKey): Promise<IntentReceipt | undefined>`（`undefined`=**本进程已提交投影快照**里没有该键——未登记或不可重建，不是拒绝；它不证明数据库里没有，运行期库故障由写面/`refresh`/健康观测报错）
- **参数与返回（公共形状落 `contract`，不得私有于 `daemon`；候选文件 `contract/src/ports/intent.ts`）**：

```ts
type IntentSource = string      // **来源名**：真实 `InvokeSource` 名 ∪ `ServeConfig.external.allowedSources` 里的外部来源名；
                                // 外部 HTTP 固定 'external-api'——它**不是** `InvokeSource`（无 start/stop，不产意图而是收意图）
type IntentKind = InvokeIntent['kind']   // 八值：ticket/mention/schedule/relay/resume/webhook/escalate/data-change
type RequestKind = 'request' | 'explore' | 'task' | 'intel'   // 业务类型：只进 payload，**不是** source/kind

interface WebhookIntentPayload {
  source: 'external-api'              // 外部触发面固定；必须是已注册来源名
  kind: 'webhook'                     // 外部触发面固定；不得塞 'explore'/'task'/'intel'
  requestKind: RequestKind            // 业务类型（需求/探索/任务/情报），进 payload
  dedupKey: string                    // 调用方给的幂等键，必填；服务器不替调用方生成
  company: CompanySlug
  ticket?: TicketId                   // 指向既有单时带；带则占**键槽**（优先于 dedupKey）
  subjectRef?: SubjectRef
  requestedAt: Timestamp              // 调用方时间；服务器另记 receivedAt
  body: unknown                       // 原样载荷；API 不解释业务
  correlation?: { externalRef?: string; parentRef?: Qid }
}

interface IntentKey {                 // 与 core 的 intentKeyOf 逐位一致：source|kind|company|(ticket ?? dedupKey)
  company: CompanySlug
  source: IntentSource
  kind: IntentKind
  ticket?: TicketId
  dedupKey: string
}

type ReceiptGap = 'unknown-link-missing' | 'intake-link-missing'   // **封闭两码**，返回处与本表同源，不得自造第三码

interface IntentReceipt {             // 由 REC-WORK-01/02、REC-EVT-03 导出（REC-OBS-02 只贡献 gap/孤儿覆盖，不贡献结论）
  receiptId: string                   // 投影行 ID（**非 qid**）
  intentKey: IntentKey
  intentRef: Qid                      // **REC-WORK-01**：reserve 时立即产生，不可缺
  bodyDigest: Digest                  // 载荷摘要：同键不同内容靠它判
  receivedAt: Timestamp               // 取自 REC-WORK-01.received_at；同键多条时**取最大者**为当前回执
  expiresAt: Timestamp                // **去重窗**（默认 24h，目标配置项）；**只对 decided 与已对账的 unknown 生效**——
                                      // queued 永不过期退出判重（见本节“TTL 与去重”）
  status: 'queued' | 'decided' | 'unknown'   // 由 REC-WORK-01/02/EVT-03（及 REC-OBS-02 的覆盖范围）推出，不是独立事实
  outcome?: IntakeOutcome['outcome']  // **标量**五值之一；未判时缺省（不是整个 IntakeOutcome 对象）；只来自 REC-WORK-02
  referredTo?: ReferralTarget         // forwarded 时必填；只有一份
  decidedAt?: Timestamp               // decided 时给
  intakeRecordRef?: Qid               // **REC-WORK-02**（受理记录）——不是 REC-RCP-01
  unknownRef?: Qid                    // **REC-EVT-03**（结果不明）；status='unknown' 时通常必填；
                                      // 孤儿未知（覆盖范围内的，见映射表第 4 条）可缺省，此时必须同时有 gap 标记
  gap?: readonly ReceiptGap[]         // 重建不完整的原因码（封闭两码）；
                                      // 非空即“投影不完整”，不得读成“无异常”，也不得据此降级状态或重放
}

interface IntentSubmitResult {
  receipt: IntentReceipt
  duplicate: boolean                  // true = 同键同摘要的重投；不代表受理结论
}
```

〔结论〕**事实模型：先持久化原始意图，再产生投影**——顺序不得倒：

1. `submit` 先调 daemon 内的 **`WorkIntake.reserve`**（`TS-PORT-WORK-01`，`REC-WORK-01` 的唯一写入者）。`reserve` 在**一个 daemon 写事务**里完成“按唯一键查重 + 追加不可变 `REC-WORK-01` 意图信封”，并立即给出 `recordId`（即 `intentRef`）、`bodyDigest`、`receivedAt`；唯一键取 `(company, source, kind, ticket ?? dedupKey)`。
2. **先落 `REC-WORK-01`，再 `engine.ingest`**：`ingest` 只把意图放进内存队列，**不能产生记录**；因此不存在“先写一个没有来源的 `queued` 行再补记录”的次序。信封用**已登记的** `recordType.name='REC-WORK-01'` 与其类型版本（77-附录 A 的 `1.0.0`），不得自造 type 版本或第二套“意向记录”。
3. `IntentIngress` **不得替 `WorkIntake` 写 `REC-WORK-01`/`REC-WORK-02`**，也不得另开写口；它只负责“调用 reserve → 入队 → 刷新投影 → 返回回执”。

〔结论〕**`intent_receipts` 是派生投影，不是第二事实源**。派生来源**只有三类事实记录**：`REC-WORK-01`（意图信封）、`REC-WORK-02`（受理结论）、`REC-EVT-03`（结果不明）；`REC-OBS-02` **只承载**“孤儿未知/投影缺口”这一覆盖标记（指向某条无法归属的 `REC-EVT-03`），**不提供** `outcome`、不提供任何决定，也不得被当成第二条结论来源：

| `status` | 判据 | 可查询字段来源 |
|---|---|---|
| `queued` | 有 `REC-WORK-01`，**无** `REC-WORK-02`，**且没有**可归到本键的 `REC-EVT-03`（既无完整链、无部分链，也无覆盖本键的孤儿未知——见下方“未知判据”） | `intentRef` + `bodyDigest`/`receivedAt`/`expiresAt` |
| `decided` | 有 `REC-WORK-02` | `outcome`/`referredTo`/`decidedAt`/`intakeRecordRef` |
| `unknown` | 有可归到本键的 `REC-EVT-03`（完整链或部分链），**或**存在覆盖本键所属范围的孤儿未知 | `unknownRef`（孤儿情形可缺省 + `gap`）；**须先对账**（`REC-06`） |

**`queued` 的排除是“排除可能影响该键的未知”，不是“全库没有任何 `REC-EVT-03`”**：只要库里存在一条**可能**属于本键的 EVT-03（完整链命中本键、部分链的 `unknown_scope` 与键的 `(company, source.channel, timeWindow)` 相交、或孤儿未知的覆盖范围含本键），本键就**不得**留在 `queued`（否则会被 `replayQueued` 当“可重放”双派）。判定只在“本键 + 其可见范围”内做，不因无关公司的孤儿未知冻结全库；范围不可界定时才按保守侧冻结（见第 4 条表）。

1. 表 `intent_receipts`，唯一键 `(company, source, kind, ticket ?? dedupKey)`；行是可重建的：删表后由 `REC-WORK-01/02`、`REC-EVT-03` 与 `REC-OBS-02`（只用于还原 `gap` 与孤儿覆盖范围）重放重建，结果必须逐字段一致（映射见下）。**部分链与孤儿未知的投影行同样必须由这些记录重建**——不得只存在于内存、也不得靠“上一次运行留下的行”解释；删表重建必须得到同一批 `unknown` 行与同一批 `gap` 集合。
2. 唯一实现是 daemon 的 **`IntentReceiptStore`**（投影维护者），由 `createIntentReceiptStore({ ledger, clock? })` 造出（§6.6 末尾的形状）；它**只**从上述记录派生，不写记录本身，也没有独立于记录的 `queued` 事实。**不提供** `upsert(receipt)` / `queued(company)` / `mark*` 一类写口——调用方（ingress、装配体、API、测试）**都不能**自行写回执或制造 `queued`：唯一写法是 `refresh(key)`（单键派生）与 `rebuild()`（全量派生），两者都读记录。入口只有 `IntentIngress.submit` 一处（旧稿的 `IntentInbox` 作废），没有第二个权威、没有 API 第二写者。
3. `IntentReceipt` **缓存受理结论供查询，不替代 `REC-WORK-02`**：权威结论仍在记录里，投影可随时重建；因此不得把投影行当 `REC-RCP-01` 回执，也不得只在投影里改结论。
4. 装配体经 `openLedgerReadonly` 打开只读台账，**只**供信息面（`issues`/`finance` 等）查询；**回执查询不走库**——`receipt()` 读 `IntentReceiptStore` 的本进程快照（规则 5/8），也不得为它另开可写连接。**不得**把可写 `Ledger` 传进 API。

〔结论〕**键的承载与回执重建（不得从 payload 猜键）**：

1. `REC-WORK-01.source` 是**结构化**字段（77-§4.1.1：“谁、经何通道、何时、以何形式提出”），本卷固定其子键为 `{ channel, dedupKey, ticket?, kind }`：`channel` 即 `InvokeIntent.source`（外部面恒 `'external-api'`）、`kind` 恒 `'webhook'`、`ticket` 仅有单时出现、`dedupKey` 必填。`company` **不写进 `source`**，取 `RecordEnvelope.companyRef.companyId`（76-§4.2）。
2. `IntentKey` 的还原只有**一条公式**：`company ← companyRef.companyId`、`source ← source.channel`、`kind ← source.kind`、`第四位 ← source.ticket ?? source.dedupKey`，按 `(company, source, kind, ticket ?? dedupKey)` 比对（与 `core/src/decide.ts:319`–`:324` 的 `intentKeyOf` 逐位一致）。**不得**从 `raw_content`/payload 里再猜一份 source / dedupKey（payload 只是业务内容），也不得把整块 `source` 结构当 `IntentKey.source`——`source` 是结构、`IntentKey.source` 是字符串，字段同名不同轴。
3. 字段映射（重建只读这三类记录，不从投影行反推）：

| `IntentReceipt` 字段 | 来源 | 缺链时 |
|---|---|---|
| `intentKey` | 第 2 条公式还原 | 任一必填子键缺失 ⇒ 该行不可重建：标 `gap:'intake-link-missing'`，**拒出回执**（不得用 payload 补） |
| `intentRef` | `REC-WORK-01.recordId` | 同上（不可重建） |
| `bodyDigest` | `REC-WORK-01.raw_content` 按固定 canonicalization 求摘要（`Digest`） | 缺 ⇒ `gap`（不得用 payload 现算冒充原摘要） |
| `receivedAt` | `REC-WORK-01.received_at` | 缺 ⇒ `gap` |
| `expiresAt` | 由 `receivedAt + idempotencyTtlMs` **导出**（不是独立落盘事实），适用面见“TTL 与去重” | — |
| `status` | 由上表判据推出 | — |
| `outcome` / `referredTo` / `decidedAt` / `intakeRecordRef` | `REC-WORK-02`：`outcome`（五值标量）、`referred_to`、受理时刻面、`recordId` | 无 WORK-02 ⇒ 全缺省，`status='queued'` |
| `unknownRef` | `REC-EVT-03.recordId` | 见第 4 条 |
| `gap` | 部分链 ⇒ `'unknown-link-missing'`；孤儿未知覆盖 ⇒ `'unknown-link-missing'`；键本身不可还原 ⇒ `'intake-link-missing'` | 词表**只有这两个码**（`ReceiptGap`），实现与返回同源，不得自造第三码 |

4. **EVT-03 的归属：意图域强制带链，非意图未知不受此限。** `REC-EVT-03.unknown_scope.intentRef`（=`REC-WORK-01.recordId`）是**唯一**允许把 EVT-03 归到某条意图上的链；但“必须带 `intentRef`”这条**只在意图域成立**：

   **写入面（新记录）**：当未知发生在**意图域**（`EffectGateway` 的 `Ok(unknown)` 对应某次意图执行，或该 EVT-03 关联/将关联某条 `REC-WORK-01`）时，`TS-PORT-REC-06.registerUnknown` **缺 `unknown_scope.intentRef` 即 `Err({failure:'rejected_precondition', category:'CONFIG_INVALID', subcause:'unknown-scope-intent-missing'})`**——不接受“先写未知、回头补链”；`EffectGateway` 的 `Ok(unknown)` 同样以“已写出带链的 EVT-03”为前提（§6.6 EFF-01）。**非意图域的未知**（平台读侧查询、监控/观测、导入与对账等，与任何意图无归属关系）**不得**被这条规则拒收：它们按 77 原有的 `unknown_scope`（`scope`/`owner`/`review_by` 等字段照旧必填）登记，`intentRef` 缺省合法，也**不进** `intent_receipts` 的派生范围（不冻结任何键）。

   **重建面（历史行）**：`intent_receipts` 只吸收**可能属于意图键**的未知；下表四类是唯一判据（要排除某条未知，必须举证它与该键**无关**，不得默认“没链就是无关”）：

   | 链/覆盖的状态 | 是否进 `intent_receipts` | 投影行与处置 |
   |---|---|---|
   | **完整链**：`unknown_scope.intentRef` 指向某 `REC-WORK-01.recordId` | 是（只进那一个键） | `status='unknown'` + `unknownRef=EVT-03.recordId`；先对账，未对账前不重放、不另立 |
   | **部分链**：`intentRef` 缺/不匹配，但 `unknown_scope` 的 `(company, source.channel)` 与键相交 | 是（进相交的键） | `status='unknown'` + **保留真实 `unknownRef`** + `gap:['unknown-link-missing']`；**冻结该键**：不重放、不重投、不另立同键新意图；补链只能由对账/补证（`REC-06`），**不得**由投影“猜一个最近的 EVT-03” |
   | **孤儿未知**：完全无链，由 `REC-OBS-02` 指向它 | 仅当 `REC-OBS-02` 的覆盖范围（同 `company` + 同 `source.channel` + `unknown_scope.timeWindow`）与键相交 | `status='unknown'` + `gap:['unknown-link-missing']`（`unknownRef` 可缺省）；禁止重投/重放/另立；覆盖范围不可界定（无 `company` 或无时间窗）时**全体 `queued` 冻结**，等人工/对账裁决 |
   | **非意图未知**：属平台读侧/监控/导入等，无 `intentRef` 且覆盖范围与键不相交 | 否 | 留在 `REC-EVT-03` 与 `REC-OBS-02`，**不**影响任何回执的 `status`/`gap`；不得为它冻结键，也不得把它塞进 `unknownRef` |

   `REC-OBS-02` 的**唯一职责**是承载“孤儿未知／投影缺口”这个覆盖标记（指向哪条 EVT-03、覆盖哪段范围）；它**不提供** `outcome`、不提供任何受理决定、也不构成第二结论来源——回执的 `outcome` 只来自 `REC-WORK-02`。

   三条不变式：① `gap` 是**投影不完整的标记**，不是第二事实源——删表重建必须得到同样的 `gap` 集合，补链后 `gap` 自动消失且**不得**改写历史记录；② 冻结的键在缺口消解前不得出现在 `replayQueued` 的重放集内；③ `intent_receipts` 必须**始终可重建**（`recordType.name`/版本/映射公式齐全）：**部分链与孤儿未知的投影行同样由记录重建**，不得只存在于内存，也不得依赖“上一次运行留下的行”——任何“只能靠投影行本身才能解释”的状态即缺陷。
5. **同键多条 `REC-WORK-01`**（TTL 到期后另立、或历史遗留）：当前回执取 **`receivedAt` 最大者**，其余记录保留为历史（由 `lineage.supersedes` 串起）；**不得**按“表里最后写入的一行”覆盖（写入顺序 ≠ `receivedAt` 顺序），也**不得**返回最早一条冒充唯一。同键不同摘要**在去重窗内**仍按 409 拒（一致性检查，不是选行规则）；窗口已过、经 `lineage.supersedes` 另立的记录**不适用** 409——那是新意图，不是重投。
6. 投影刷新**只增不改历史**：同键旧行的 `receivedAt`/`outcome` 一经落定不再改写；新记录出现只改变“当前回执指向谁”。

〔结论〕`IntentIngress.submit` 的顺序冻结（**先 reserve 落记录，再 ingest，最后返回**）：

1. **校验**（顺序固定，全在 `reserve` 之前；任一项不过即 `Err`，不落记录）：`source` 在 `allowedSources` 内（= `ServeConfig.external.allowedSources`，缺省恰 `['external-api']`；**不查 `SourceRegistry`**）、`kind==='webhook'`、`requestKind` ∈ `RequestKind`（`'request'|'explore'|'task'|'intel'`）、`dedupKey` **非空字符串**（空 ⇒ `rejected_precondition`，服务器不替调用方生成）、`company` 已挂载（`deps.isCompanyMounted(company)` 为假 ⇒ `rejected_precondition`，不落单、不建公司）、`body` 字节数 ≤ `bodyLimitBytes`（缺省 `100_000`，沿用 `panel/src/external/server.ts:100` 的 `MAX_REQUEST_BODY_BYTES`；这是**代码缺省**，不是 `ServeConfig.external` 的 YAML 键）、令牌/配额通过；
2. **`reserve`**：`WorkIntake.reserve` 按唯一键查重；未命中则追加 `REC-WORK-01`（`intentRef` 立即产生）；
3. **刷新投影**：`IntentReceiptStore` 经自持的 projection hook 在**同一条记录事务内**派生/更新表投影行（幂等），commit 返回后同一微任务内更新内存快照；**不得**改成提交后异步刷新（见本节省末的投影维护规则第 7 条）。重投判定（“同摘要 + `decided`/`queued`/`unknown`”）**一律按记录现算**——用 `refresh(key)` 或直接读 `REC-WORK-01/02`/`REC-EVT-03`，**不得**用 `get()` 的快照当判定依据（规则 8）；
4. **`enqueue`**：仅当本次是“新建”或“`queued` 重投”才 `engine.ingest([invokeIntent])`（`void`；回执不由 ingest 产生）；
5. 返回 `IntentSubmitResult`。

〔结论〕**`IntentIngress` 是 daemon 侧的组件，不是 `contract` 的新类型**：它的公共面就是 `TS-PORT-API-01 IntentSubmissionPort`（`submit`/`receipt`），**内部类型** `IntentIngressInternal` 另加 `replayQueued()`（启动末重放用，只给 `buildServeRuntime`）。构造走 `createIntentIngress(deps: IntentIngressDeps)`，`deps` 为 `intake`（`WorkIntake`，唯一写 `REC-WORK-01`）、`engine:{ingest}`（**只**接一个入队函数，不给引擎本体）、`receipts`（`IntentReceiptStore`）、`allowedSources`（= `ServeConfig.external.allowedSources`，**不**查 `SourceRegistry`）、`ttlMs`（去重窗）、`isCompanyMounted`、`bodyLimitBytes?`、`log`——**不设** `workIntake`/`ledger`/`now` 等别名或第二个时钟源（`deps` 里没有可写 `Ledger`，投影维护者自己持）。装配体与 HTTP 只取 **`Pick<IntentSubmissionPort, 'submit' \| 'receipt'>`**（`IntentIngress` 实现该端口，因此与 `Pick<IntentIngress, 'submit' \| 'receipt'>` 等价；两者都**不含** `replayQueued`），因此拿不到 `ingest`、写口与可写 `Ledger`；入口只有 `submit` 一处（旧稿的 `IntentInbox` 作废，不设第二入口）。

〔结论〕**重投规则写全（四态）**：

| 情形 | 处置 | 返回 |
|---|---|---|
| 同键 + 同摘要 + `decided` | **不再入队**，直接回既有结论 | `Ok({receipt, duplicate:true})`（200） |
| 同键 + 同摘要 + `queued` | **重新入队**（同一 `REC-WORK-01` 幂等，不重新物化） | `Ok({receipt, duplicate:true})`（200） |
| 同键 + 同摘要 + `unknown` | **不自动重放**；先对账（`REC-06`）再决定 | `Ok({receipt, duplicate:true})`，`status:'unknown'`——不伪造 202 “新收到”，也不回 `Err` 假装拒绝 |
| 同键 + **不同**摘要（**去重窗内**、尚无过期另立资格） | 拒绝；既不追加记录也不入队 | `Err({failure:'rejected_idempotency', category:'EXTERNAL_REJECT', subcause:'body-mismatch'})`（409） |
| 同键 + 任意摘要 + **窗口已过的 `decided`** | 视作**新意图**：另立 `REC-WORK-01` 并经 `lineage.supersedes` 链旧 `recordId`，再入队 | `Ok({receipt, duplicate:false})`（202）——旧记录保留为历史 |
| 未命中 | 新建 `REC-WORK-01` + 入队 | `Ok({receipt, duplicate:false})`（202） |

**崩溃语义**：`reserve` 提交后、`ingest` 之前崩溃 ⇒ 行已是 `queued`（`intentRef` 在），**重启后必须能重放**：启动末由 `buildServeRuntime` 调一次 `IntentIngressInternal.replayQueued()`（§6.6 末尾），它扫描 `status:'queued'` 的投影行（等价于“有 REC-WORK-01、无 REC-WORK-02”）重新入队，同一 `REC-WORK-01` 幂等、不重复物化；带 `gap:'unknown-link-missing'` 的行**不在**重放集内（未知不是可重试）。`replayQueued` 不是对外方法，HTTP/装配体拿不到（`Pick<IntentSubmissionPort,'submit'|'receipt'>`）。`attempts` 字段**删除**：它没有可重建的来源；重放次数若需要，只能由事件流统计，不进回执。

〔结论〕**TTL 与去重（`expiresAt` 的适用面）**：

| `status` | `expiresAt` 是否生效 | 到期后果 |
|---|---|---|
| `queued` | **不生效** | **不得**因过期退出判重，**不得**允许另一条同键新意图；未判的意图只能等判定或人工处置 |
| `decided` | 生效 | 同键可另立 `REC-WORK-01`，新记录经 `lineage.supersedes` 指向旧 `recordId`（76-§4.2 `REC-ENV-01.lineage.supersedes`；**不新造** `supersedes` 字段）；旧记录留档、不删不改 |
| `unknown` | **只在对账完成后**才生效 | 未对账前**不得**过期、**不得**重放、**不得**另立同键新意图——须先把“未知”变成“已确认未成 / 已确认已成” |

1. `expiresAt` 是**导出值**（`receivedAt + idempotencyTtlMs`），不是独立落盘事实；改配置只影响新意图，不回溯改旧行；
2. TTL 到期**不是删除事实**：记录与投影都不删，`receivedAt` 与谱系保留，旧记录仅作历史仍可读可审；
3. TTL 到期**不是重置历史**：不得把旧记录标成作废/失败，也不得改写其 `outcome`；当前回执仍按 `receivedAt` 最大者取（上块第 5 条）；
4. TTL 到期**不解除在途约束**：已受理未收口的工作仍在途时，同键新意图即使窗口已过也必须走人工裁决，**不得**自动双派；
5. `queued` 不过期的理由：它只表示“记录在、还没判”，把它读到过期放行会让同键两份同时在队；确需清理时只能人工作废并在审计里写明，不得由 TTL 自动得出“可另立”。

- **前置**：`source` 必须在 `ServeConfig.external.allowedSources` 内（缺省恰 `['external-api']`；**不经 `SourceRegistry`**——外部 API 不是 `InvokeSource`，见本节末结论）；`kind` 必须是 `InvokeIntent['kind']` 成员且外部面固定 `'webhook'`；`requestKind` 必须是 `RequestKind` 成员；`dedupKey` 必须是**非空字符串**（服务器不代生成）；`company` 必须**已挂载**（`deps.isCompanyMounted`）；`body` 字节数 ≤ `bodyLimitBytes`——五项不混轴，任一不过即拒且**不落记录**。
- **后置**：**提交 ≠ 受理**。`submit` 只保证“`REC-WORK-01` 已落、意图已入队（或按上表不重放）”；受理结论（五值）由 daemon 在相位 2 写 `REC-WORK-02`，投影随刷新出现 `outcome`/`referredTo`/`decidedAt`/`intakeRecordRef`。`status` 是**由记录推出**的存储状态，不得用 `pending` 兼职“暂缓”（暂缓是 `outcome:'deferred'`）。
- **错误**：同键不同摘要（**去重窗内**）⇒ `rejected_idempotency`（409）；令牌/来源不允许 `rejected_forbidden`（403）/`rejected_authority`（401）；结构不合法、`dedupKey` 空、公司未挂载 ⇒ `rejected_precondition`（422）；请求体超限 ⇒ `rejected_precondition` + `subcause:'body-too-large'`（413）；daemon 未就绪 `unavailable`（503，**不得**假装 202）；配额超限 `unavailable` + `subcause:'quota'`（429 + `retryAfter`）。**拒绝只在一侧表达**：要么 `Err`，要么 `Ok`（`duplicate` 只描述重投）。
- **幂等**：按 `IntentKey` 幂等，规则见上表与“TTL 与去重”；`expiresAt` 只是去重窗，**不是**删除/重置/放行开关。
- **事务与证据**：`REC-WORK-01` 由 `WorkIntake` 在一个写事务里追加；投影由 `IntentReceiptStore` 派生。**API 不写任何库**，只经装配体注入的只读视图 `receipt()` 查询。
- **锚点**：新建；现状 `POST /v1/requests` 直写 `daemon_kv` 幂等键并直调 `platform.issues.create`（`external/server.ts:487`/`:491`），迁移后一律改由 daemon 消费意图

〔结论〕**`IntentSource` 的取值域是“两种来源名”，校验分两条路，不得合并**：`type IntentSource = string`。

1. **真实 `InvokeSource`**（有 `start(emit)/stop()`，`contract/src/ports/invoke.ts:29`–`:40` 的 `InvokeSource`/`SourceManifest`）：`ticket`/`mention`/`schedule`/`relay`/`resume`/`escalate`/`data-change` 由它们产出，按 `SourceRegistry` 解析，解析不到 ⇒ `rejected_precondition`；这些源**不产** `intent_receipts` 行；
2. **外部入口来源**：`'external-api'` 固定，**它不是 `InvokeSource`**——没有 `start/stop`、不“产出”意图而是**接收**意图，因此**不得**为它造 stub 源注册进 `SourceRegistry`（那会造出永不发火的假源，并让“源在跑”与“API 开着”混成同一事实）。校验只经 `ServeConfig.external.allowedSources`（§3.3，缺省恰 `['external-api']`）：不在表内 ⇒ `rejected_forbidden`（403），不查 `SourceRegistry`。

`IntentKind` 只取引擎真实八值，**`explore`/`task`/`intel` 不是 kind**，它们是 `RequestKind`（业务类型），只进 payload；外部面 `kind` 恒 `'webhook'`。

〔结论〕**键槽优先级与引擎一致**：`IntentKey` 的第四位是 `ticket ?? dedupKey`（`core/src/decide.ts:319`–`:324` 的 `intentKeyOf`：`[source, kind, company, ticket ?? dedupKey]`）。`IntentIngress` 构造意图时**必须整份传 payload**，不得只传 source：

```ts
invokeIntent = {
  kind: 'webhook',
  source: 'external-api',
  company, ticket, dedupKey,
  payload: { requestKind, body, subjectRef, requestedAt, correlation },   // 业务内容进 payload
}
```

`source`/`kind`/`company`/`ticket`/`dedupKey` 各占一轴，不得混填或改名；`payload` 里再放一份 `requestKind` 是**业务分类**，不参与键。

〔结论〕**`IntentIngress` / `IntentReceiptStore` 的形状**（内部类型落 `apps/daemon/src/assembly/intent/`，**不进 `contract`**；公共面仍是 `TS-PORT-API-01`）：

```ts
interface IntentReceiptStore {          // 唯一实现：createIntentReceiptStore({ ledger, clock? })
  // 三个方法**一律 async**（返回 Promise）：不提供同步变体，也不提供第二个同名重载
  refresh(key: IntentKey): Promise<Result<IntentReceipt | undefined, ClassifiedError>>
  //   ↑ 读台账（REC-WORK-01/02、REC-EVT-03 及其缺口记录）现算该键的**当前行**，写投影表**并**更新内存快照；幂等；只增不改历史。
  //     **显式派生**：submit 里要“按记录最新判断”做重投判定时调它，对账补链后也调它。
  //     它不是每次读都被迫走的必经步骤，但**也不是被禁用的读路径**——要权威结论就走它（或直接读记录）。
  get(key: IntentKey): Promise<IntentReceipt | undefined>
  //   ↑ 只读**本进程已提交投影的内存快照**（ReadonlyMap 视图），**不是** SQLite 读、**不是**权威记录：
  //     快照由 projection hook 在记录事务 commit 之后同步更新（同一微任务内完成，中间无 await），
  //     并由 rebuild() 在启动时全量重建（先表、后快照）。
  //     undefined = 本进程快照里没有该键（未登记，或 gap:'intake-link-missing' 不可重建），不是拒绝，也不伪造空对象；
  //     **不得**用于入队/重放决策（决策只认记录与 §6.6 映射表），也不得被当作“权威结论”。
  rebuild(): Promise<Result<TableProjectionResult, ClassifiedError>>
  //   ↑ 启动期全量重建：先按记录重算**表**，再用同一结果重建**内存快照**（两者同源）；必须在 API 装配前完成（§3.6 第 6 步）。
  //     kind 固定 'table'、name 固定 'intentReceipts'、rows = 本次处理的行数、cursor = 重建游标（完成时 null）；
  //     结果须与增量逐字段一致；失败即**拒启动**（见下第 9 条），不得“带着半套投影起服”
}

declare function createIntentReceiptStore(deps: {
  ledger: Ledger                          // 可写台账（投影表在这里）；装配体/API 拿不到它
  clock?: BuildRuntimeOpts['clock']       // 时间只从注入时钟取；缺省墙钟（与 engine 同源）
}): IntentReceiptStore

interface IntentIngressDeps {
  intake: WorkIntake                                     // REC-WORK-01 唯一写口（TS-PORT-WORK-01）
  engine: { ingest(intents: readonly InvokeIntent[]): void }   // 只给入队函数，不给引擎本体
  receipts: IntentReceiptStore
  allowedSources: readonly string[]                      // 已通过 §3.3 形状校验；缺省 ['external-api']
  ttlMs: number                                          // 去重窗（= ServeConfig.external.idempotencyTtlMs）
  isCompanyMounted(company: CompanySlug): boolean         // 公司目录已挂载？只回答布尔，不交挂载表
  bodyLimitBytes?: number                                // 缺省 100_000（沿用 MAX_REQUEST_BODY_BYTES）；代码缺省，非 YAML 键
  log: NonNullable<BuildRuntimeOpts['log']>              // 与 buildServeRuntime 同一日志面，不另开
}

interface IntentIngressInternal extends IntentSubmissionPort {   // 内部类型：只在 daemon 内可见
  replayQueued(): Promise<Result<number, ClassifiedError>>
  //   ↑ 启动末由 buildServeRuntime 调一次；只重放 status='queued' 且无 gap 的行，同一 REC-WORK-01 幂等
}

declare function createIntentIngress(deps: IntentIngressDeps): IntentIngressInternal
```

1. **两条通道，不混**：`IntentIngressDeps` 里**没有**可写 `Ledger`、没有 `now`、没有 `workIntake` 别名——台账只进 `receipts`（由工厂自持），时间只进 `receipts`/`log` 的注入时钟；`engine` 只暴露 `ingest`，因此 ingress 不能替引擎做决定、也不能读引擎状态。
2. **`replayQueued` 不外泄**：它属于 `IntentIngressInternal`，`buildServeRuntime` 持有实例并在启动末调用；HTTP/装配体侧的类型是 `Pick<IntentSubmissionPort, 'submit' | 'receipt'>`，编译期就拿不到它（不得用 `as` 或 `Record<string, unknown>` 绕过）。
3. **`IntentReceiptStore` 没有写回执的口子**：只有 `refresh`/`rebuild` 两条派生路径，二者都从 `REC-WORK-01/02`、`REC-EVT-03` 及其缺口记录（`REC-OBS-02`）读，写投影表与内存快照；`upsert(receipt)`/`queued(company)`/`mark*` 一律不提供（谁想写就说明它在伪造事实）。
4. **`get` 不产生 `queued`**：它只读内存快照；`queued` 只由 hook/`refresh` 依“有 `REC-WORK-01`、无 `REC-WORK-02`、且无（可能影响该键的）`REC-EVT-03`”推出，`get` 不参与判定、不补齐、不修复。
5. **`get` 为什么没有 `Result`——它读的是内存快照，不是库**：`get` 的读对象是**本进程**在 `rebuild()` 之后持有、由 projection hook 维护的**已提交投影只读快照**（`ReadonlyMap` 语义）；它不发起 SQLite 查询、不读权威记录、不重算，因此没有“读台账失败”这条错误轴。快照的两条维护路径：① startup `rebuild()` 先重建表、再用**同一结果**重建快照（在 API 装配前完成，见第 9 条）；② 记录事务 commit 后，hook 在同一微任务内同步更新快照（无 `await` 间隔）。因此：**崩溃丢内存** ⇒ 下次启动 `rebuild()` 全量恢复；**commit 后、快照更新前被 kill** ⇒ 该进程已死，恢复路径同样只有启动 `rebuild()`，不存在“半更新快照被读到并长期留存”的状态。运行期 DB 故障由**写事务 / `refresh` / 健康观测**报错（`unavailable` 等），**不得**折算成 `get` 返回 `undefined`（那会把“库坏了”读成“没这个键”）。`refresh`/`rebuild` 会读台账，故都返回 `Result`；**不得**再给 `get` 加第二个 `Result` 变体（那就是两套语义）。
6. **超限的分类**：`body` 超 `bodyLimitBytes` ⇒ `rejected_precondition`（HTTP `413`，见 §9.4 状态表）；`dedupKey` 空 / `requestKind` 非法 / 公司未挂载 ⇒ 同为 `rejected_precondition`（`422`），全部**不落记录**。
7. **写入与投影同事务，钩子归 store**：追加 `REC-WORK-01/02`、`REC-EVT-03` 的那个事务里，由 `IntentReceiptStore` **自己拥有**的 projection hook 同步写表投影；`WorkIntake` **不写**投影表（它只写记录）。commit 返回后，hook 立即（同一微任务、无 `await`）用同一份派生结果更新内存快照，因此“记录已提交而表投影未更新”的窗口不存在，内存快照也不会在 yield 之后仍落后——**decided 不可能被读成 queued**。长 IO（平台调用、外部回执、通知）一律在事务**外**，不得延长写事务的持锁时间。
8. **`refresh` 与 `get` 的分工不可互换**：`refresh` = **按记录现算**（读台账、可失败），用途是显式取最新判断（submit 里的重投判定、“窗口已过的 `decided`”复查、对账补链后修复）与修复 hook 漏更新；`get` = 读**快照**（不读台账、不失败、不修复），用途只有查询展示。把 `get` 放进入队或重放决策、或让 `get` 顺手 `refresh`，都会把“投影可能落后”重新变成业务判断依据，等同把投影当事实源。
9. **启动顺序固定**：schema 闸（校验 schema 版本，`openLedger` 的 `schema-behind`/`schema-ahead` 即拒）→ `receipts.rebuild()`（表 + 内存快照）→ `replayQueued()` → **之后才允许装配 API 面**。`rebuild()` 失败 ⇒ **整体拒启动**（`CONFIG_INVALID`/`unavailable` 原样上抛），不得降级为“空投影”或“启动后再补”；`replayQueued` 只在重建成功后跑，避免在半套投影上重放；API 装配晚于重建，保证 `receipt()` 一开服就有快照可读（不会把“还没重建”读成“无此键”）。
10. **改事务方案的举证责任**：若要放弃“同事务投影钩子 + commit 后同步快照”（例如改成异步 outbox），必须提交**同等或更强的证明**：在同一键上不存在“记录已 `decided` 而表/快照仍 `queued`”的可观测状态，且崩溃点注入（提交前 / 提交后快照更新前 / 投影写后 / `rebuild` 中途）四态皆有测试证据。在给出该证明之前，本卷只承认同事务方案。

### 6.7 证据价值、义务与身份面（补齐 record→port 空档）

#### TS-PORT-EVD-03 `ValueAssessmentPort`

- **签名**：`assess(req: ValueRequest): Promise<Result<RecValueAssessment, ClassifiedError>>`；`get(workRef: Qid): Promise<RecValueAssessment | undefined>`
- **参数与返回**：`artifactAccount/stateAccount/impactAccount/costAccount` 四本账 + `externalFeedback/conclusion/uncertaintyAndDissent`（77-§6.5）
- **前置**：验收已成立（`REC-EVD-04`）；价值在验收**之后**作，不回溯改验收
- **后置**：产出 `REC-EVD-05`；四本账分别记，不压总分；负值单列；争议期不得抵销
- **错误**：无验收 `rejected_precondition`；外部反馈缺项且无理由 `rejected_precondition`；不可补偿第三方损害由单方认定 `rejected_forbidden`
- **幂等/预期版本**：按 `(workRef, acceptanceRef, accountsDigest)` 幂等
- **事务与证据**：价值记录；证据=四本账 + 外部反馈
- **等级/锚点**：experimental；77-§6.5

#### TS-PORT-EVD-04 `ReworkPort`

- **签名**：`open(req: ReworkRequest): Promise<Result<RecRework, ClassifiedError>>`；`threshold(ticket: TicketId): Promise<ThresholdState>`
- **参数与返回**：`triggeredBy/causeClass/scope/count/thresholdState/deadline`（77-§6.6.1）；`causeClass` 五值
- **前置**：验收拒绝或自检不通过；返工范围写明“不返工部分”
- **后置**：产出 `REC-EVD-07`；达阈值**强制重新受理**（回 `TS-PORT-WORK-01`），不得自行加轮次
- **错误**：causeClass 缺失 `rejected_precondition`；越阈值仍继续 `rejected_state`
- **幂等/预期版本**：按 `(workRef, triggeredBy, causeClass, count)` 幂等
- **事务与证据**：返工记录 + 阈值状态
- **等级/锚点**：experimental；77-§6.6.1

#### TS-PORT-EVD-05 `ReopenPort`

- **签名**：`apply(req: ReopenRequest): Promise<Result<RecReopen, ClassifiedError>>`；`scope(id: Qid): Promise<ReopenScope>`
- **参数与返回**：`reopenedRefs/newEvidence/standardApplied/affectedScope/returnState|reviewAction/originalAnnotation`（77-§6.6.2）
- **前置**：新证据标准事前设定；申请方不得是原当事方；终态工作只填 `reviewAction` 不改状态
- **后置**：产出 `REC-EVD-08`；不复活终态、不改写原历史、不新增状态
- **错误**：证据不足 `rejected_precondition`；原当事方申请 `rejected_authority`；试图复活 `rejected_forbidden`
- **幂等/预期版本**：按 `(reopenedRefs, newEvidenceDigest)` 幂等
- **事务与证据**：重开记录 + 原结论标注
- **等级/锚点**：experimental；77-§6.6.2

#### TS-PORT-OBL-01 `ObligationPort`

- **签名**：`instantiate(req: ObligationRequest): Promise<Result<RecObligationInstance, ClassifiedError>>`；`commit(req: CommitmentRequest): Promise<Result<RecConcreteCommitment, ClassifiedError>>`；`link(req: FulfillmentRequest): Promise<Result<RecFulfillmentLink, ClassifiedError>>`；`overdue(asOf: Timestamp): Promise<readonly RecObligationInstance[]>`
- **参数与返回**：`definition_ref/form/holder/trigger/due`（77-§7.1）；承诺规则在 76 `DEF-COMMIT-01`；履行链接指向工作/时点/证据
- **前置**：义务定义版本可解析；承担者已任命；触发条件可判定
- **后置**：产出 `REC-OBL-01/02/03`；逾期升级为异常（`REC-EXC-01`），不得静默
- **错误**：定义断链 `rejected_precondition`；无承担者 `rejected_state`；承诺超规则 `rejected_authority`
- **幂等/预期版本**：实例按 `(defRef, holder, triggerRef)` 幂等；履行按 `(commitmentRef, workRef)` 幂等
- **事务与证据**：义务/承诺/履行三条同域追加
- **等级/锚点**：experimental；77-§7.1/§7.2、76-`DEF-OBL-01`/`DEF-COMMIT-01`

#### TS-PORT-LIFE-01 `IdentityLifecyclePort`

- **签名**：`transition(req: IdentityTransitionRequest): Promise<Result<RecIdentityTransition, ClassifiedError>>`；`state(companyId: CompanySlug): Promise<IdentityState>`
- **参数与返回**：`from/to/decidedBy/basis/notice/dissentPosition/settlementState/generationEffect`（77-§10.1）
- **前置**：迁移边在合法表内；`suspended→active` 须给 as-of 点、外部对账、缺口清单与时效性再验证
- **后置**：产出 `REC-LIFE-01`；终态身份不得复活；代次不得沿用
- **错误**：非法迁移 `rejected_state`；无通知/无承接 `rejected_precondition`；复活终态 `rejected_forbidden`
- **幂等/预期版本**：按 `(company, from, to, decisionRef)` 幂等
- **事务与证据**：身份迁移记录 + 通知清单
- **等级/锚点**：experimental；77-§10.1

#### TS-PORT-LIFE-02 `HandoverArchivePort`

- **签名**：`archive(req: ArchiveRequest): Promise<Result<RecHandoverArchive, ClassifiedError>>`；`verify(id: Qid): Promise<Result<ArchiveVerification, ClassifiedError>>`；`lossReport(scope: SuccessionScope): Promise<Result<RecLossReport, ClassifiedError>>`（这里的 `RecLossReport` 是 **77 `REC-LIFE-04`**，与 76 `REC-LOSS-01` 的 `RecBindingLossReport` 是两回事，见 §4.8）
- **参数与返回**：交接包引用、接收者、交接清单、连续性检验结果、文件工件引用（77-§10.2/§10.5）；清算承接时必须给“承接范围 + 未承接项 + 接收确认”
- **前置**：原身份为 `active`（终态则由残余责任承接者）；接收者明确接受；`转入清算` 的结清只能由本端口承接后才允许 `CLOSE`
- **后置**：产出 `REC-LIFE-02`；`lossReport` 产出 `REC-LIFE-04`（移交面）。**未承接项逐项列明；未完成移交不得宣称结清**；损失报告必须在接收之前出
- **错误**：接收者缺失 `rejected_precondition`；档案不完整 `unverified`；缺失项被隐去 `rejected_forbidden`
- **幂等/预期版本**：按 `(scope, packageDigest, recipient)` 幂等
- **事务与证据**：档案记录 + 文件工件 + 损失报告
- **等级/锚点**：experimental；77-§10.2/§10.5

#### TS-PORT-LIFE-03 `SuccessionPort`

- **签名**：`decide(req: ContinuityRequest): Promise<Result<RecContinuityDecision, ClassifiedError>>`；`affected(decisionId: Qid): Promise<readonly RecordRef[]>`
- **参数与返回**：合并/分立/联合/承继、谱系主张、受影响结论、损失与承接（77-§10.4/§10.5）
- **前置**：谱系主张可解析；`continuation` 无连续记录时只能标“未核验”
- **后置**：产出 `REC-LIFE-03`（decision facet）；承继逐项列依据与接收确认；**承继面**的损失与缺口同样产出 `REC-LIFE-04`（与 LIFE-02 的移交面各出一份，不合并）；不复活终态
- **错误**：复活/复权表述 `rejected_forbidden`；谱系断链 `rejected_precondition`
- **幂等/预期版本**：按 `(scope, lineageDigest, decisionRef)` 幂等
- **事务与证据**：连续性决定 + 损失报告
- **等级/锚点**：experimental；77-§10.4/§10.5

#### TS-PORT-LIFE-04 `AppointmentPort`

- **签名**：`appoint(req: AppointmentRequest): Promise<Result<RecAppointment, ClassifiedError>>`；`current(position: Qid): Promise<RecAppointment | undefined>`；`end(id: Qid, reason: EndReason): Promise<Result<RecAppointment, ClassifiedError>>`
- **参数与返回**：位置、任职者、兼任/代理/替补、任期、权源、禁配检查、替补安排（77-§10.6）；`end` 的 `reason` 必填，终任须写明依据（届满/辞任/撤职/岗位取消）
- **前置**：位置存在；任命者有相应权源；禁配已检查；位置空缺或允许兼任
- **后置**：产出 `REC-LIFE-05`（decision facet）；任期与替补可查；无任命记录不得承担工作
- **错误**：无权任命/无权终任 `rejected_authority`；禁配命中 `rejected_forbidden`；位置已占或任命已终 `rejected_state`；`end` 的 `id` 未登记 `rejected_precondition`（**不得**静默返回一个空任命）
- **幂等/预期版本**：按 `(position, holder, term)` 幂等
- **事务与证据**：任命记录 + 权源引用 + 禁配结论
- **等级/锚点**：experimental；77-§10.6

### 6.8 现有内部端口的保留清单

〔结论〕下列端口**保留原名**，不并入 §6.1–§6.6 的目标端口；它们是被目标端口调用的“机制件”：

| 端口 | 位置 | 保留理由 |
|---|---|---|
| `FlowPlatform` | `contract/src/ports/platform.ts:179` | 七能力已冻结，三实现 |
| `InvokeSource` | `contract/src/ports/invoke.ts:29` | 源只产意图；`start(emit)/stop` 已冻结 |
| `PromptAssembler` | `engine/prompt-assembly.ts`（类型在 `prompt`） | 组装是纯函数 + 读快照 |
| `GateRunner` | `engine/gate.ts` | 闸门命令执行；`AcceptanceEvaluator` 的上游 |
| `ModelCatalog` | `contract/src/ports/models.ts:23` | 价目表；`estimateCost` 两态 |
| `Ledger` | `store/src/ledger.ts:229` | 表读写面（投影表族）；记录事实面（`records`/`record_payloads`）在它之外另建，**不是**它的包装目标（§6.3） |
| `Scheduler` | `engine/scheduler.ts` | 定时岗；`Registry`/`dueJobs` 机制 |
| `HotReload` | `control/hot-reload.ts` | L1 热重载；拍边界调用 |
| `QueueJudgeHook` | `engine/judge/sites129.ts` | 队列小模型精序 |
| `MergeGitPort`/`MergeGateCommandPort` | `engine/merge/merge-gate.ts` | 合并跑的四原语端口（`default-deps.ts` 出 spawn 版） |
| `WorkerKeyDeps` | `engine/worker-key.ts` | 按单 wkey 生命周期的注入面 |
| `SourceRegistry` | `engine/sources.ts` | 源注册与隔离启动 |

### 6.9 端口实现落点：谁住在哪个目录

〔事实〕`apps/daemon/src` 四个域平面全部顶格（`engine 13`、`control 2`、`evolve 5`、`assembly 1`，§2.2），因此**任何新实现只能进子目录**，子目录自身不得超 25 件。81 的逐文件蓝图里，多数目标端口只有“签名 + 语义”，**没有实现家**；本表给唯一的落点，避免“每个端口自选一个目录”导致同名异处或双轨实现。

〔结论〕选点规则（四条，先规则后表，遇冲突按规则判）：

1. **类型/端口形状一律 `contract`**（`contract/src/ports/<域>.ts`），不在 `core`/`store`/`daemon` 定义公共形状；
2. **纯逻辑（零 IO、可确定性重算）落 `core`**，按子域进 `core/src/<子域>/`；
3. **持久化与 SQLite 事务落 `store`**，不出现“daemon 里拼 SQL”；
4. **编排/装配/IO 落 `daemon`**：需要读文件、起进程、调平台的实现进 `engine/<子域>/`、`control/`、`evolve/`，组合与接线进 `assembly/<子域>/`。**不分配新 F-ID**（F-ID 归 81），也不在 81 里另起第二套路径——81 若与本表不一致，以本表为准并登记为 81 的改动项。

| 端口 | 类型落点 | 实现落点（目标，均未实现） | 说明 |
|---|---|---|---|
| SPEC-01/02/03 `SpecRegistry`/`DefinitionLoader`/`PackageImporter` | `contract/src/ports/spec.ts` | `core/src/spec/`（注册表、装载编排、导入六步纯逻辑）+ `assembly/spec/assemble.ts`（读盘与包扫描） | 读文件在 assembly，纯决策在 core；`company` 仍管公司目录形状校验 |
| RULE-01 `RuleEvaluator` | `contract/src/ports/rule.ts` | `core/src/rule/`（`evaluator.ts`/`typecheck.ts`/`pattern.ts`） | 纯函数；**不得**进 daemon |
| AUTH-01…07 | `contract/src/ports/authority.ts` | `core/src/authority/`（需求、候选、激活判定、授予链、失能）+ `store/src/lease/`（写者租约与围栏的持久面）+ `store/src/records/credentials.ts`（**AUTH-06 持久面**：逻辑引用/版本/到期/吊销，**不存值**，复用通用 `records` 表）+ `assembly/auth/assemble.ts` + `assembly/auth/credentials.ts`（**只做端口编排**：来源声明校验、状态映射、`REC-AUTH-04` 落点） | `wkey` 仍是凭据，不是授权；`gateway` 不承载授权判定；凭据目录**不建第二张秘密表**，也不成为值的第二存放处 |
| REC-01/02/03/04/05/06 | `contract/src/ports/record.ts` | `store/src/records/`（写/读/**载荷**/投影/事务/修正）+ `store/src/recon/`（对账） | 事实面 `records`/`record_payloads`/`record_transactions` 与投影表都在 `store`（不变量见 §6.3，**DDL 归 81/03**）；`RecordReader.get`/`query`/`payload` 都返回 `Result`，`payload` 只按需读字节（§6.3） |
| CMD-01 / DEC-01 | `contract/src/ports/command.ts` | `engine/decision/`（`intake.ts`/`decide-record.ts`） | 命令入口不复用 `RecordTransaction` |
| WORK-01…11 | `contract/src/ports/work.ts` | `engine/work/`（`intake.ts`、`contract.ts`、`readiness.ts`、`plan.ts`、`lifecycle.ts`、`exception.ts`、`settlement.ts`、`qualification.ts`、`risk.ts`、`assignment.ts`、`attendance.ts`） | 五门纯求值落 `core/src/work-readiness.ts`（§7.9 已列），其余编排在 engine 子目录 |
| RES-01 `ResourceAccountant` | `contract/src/ports/resources.ts` | `core/src/resources/`（纯只读评估：额度/占用/剩余/缺口）+ `store/src/resources/`（投影表 `resource_ledger`（投影名 `resourceLedger`，§6.3）与同事务 hook，可由记录重建） | 无 `REC-*`、无公共写口；`baseline`/`gap` **只读、不写投影**（投影由 `store` hook 在别人的记录事务里写）；预留/实际/释放的**记录**由计划锁/收割与价值/结清各自写入（§6.4 末） |
| EFF-01 `EffectGateway` | `contract/src/ports/effects.ts` | `gateway`（验签/动作/署名内核）+ `engine/tools/effect-gateway.ts`（权源解析、effect 分类、fence 注入、未知对账） | 不改 `gateway` 包层位；外层编排在 engine/tools |
| EVD-01…05 | `contract/src/ports/evidence.ts` | `engine/harvest/`（收割、验收、价值、返工、重开） | 收割只读材料目录 |
| MEM-01 | `contract/src/ports/memory.ts` | `store/src/memory/`（四层与访问审计）+ `engine/memory/`（策略） | 四层不合并 |
| OBS-01 | `contract/src/ports/observation.ts` | `engine/observe/`（六态视图）+ 调用 `store` 的 `RecordProjection` | 只读视图，不写投影表 |
| BIND-01 `PlatformBindingPort` | `contract/src/ports/binding.ts`（**唯一形状源**） | `assembly/platform/binding.ts`（**唯一宿主**：组装 `describe`/`exportBundle`/`exitPlan`，接 `FlowPlatform`；同目录已有 `wire.ts`）+ 平台包只供纯数据：`localplatform/src/binding.ts`、`taiga/src/binding.ts`、`yt/src/binding.ts`（`bindingProfile()`/`mapState()`/`lossReport()`） | 三层，**禁第二实现**：平台包不得导出 `describe`/`exportBundle`/`exitPlan`、不得写记录（`REC-OBS-02` 由消费方写）；包边 `…→contract` 与 `daemon→{localplatform,taiga,yt}` 已允许，不新增 |
| MIG-01 `MigrationService` | `contract/src/ports/migration.ts` | `store/src/migrations/`（schema 迁移）+ `assembly/migrate/assemble.ts`（维护窗口编排） | 维护写面走 `openLedgerMaintenance` |
| NOTI-01 `Notifier` | `contract/src/ports/notifier.ts`（已有） | `engine/notify/`（策略）+ `matrix`（通道） | 现状三面已有，只补策略 |
| API-01 `IntentSubmissionPort` | `contract/src/ports/intent.ts` | `assembly/api/`（`assemble.ts` 装配）+ `assembly/intent/`（单数，沿用 81 目标：`IntentIngress`/`IntentReceiptStore`；§6.6 已定内部类型落 `assembly`） | 入口唯一；`panel/external` 退役；**不写** `assembly/intents`（两套路径即双轨） |
| OBL-01 / LIFE-01…04 | `contract/src/ports/obligation.ts`、`contract/src/ports/lifecycle.ts` | `engine/obligations/`、`engine/lifecycle/`（现 `evolve` 里只有身份迁移的旧实现，属**局部**） | 义务与身份两条链不得混写 |

〔结论〕本表**只定目录，不定实现顺序**：目录存在与否不改变端口“未实现”的判定（§6.0 状态矩阵）。新增子目录不占域平面名额，但**子目录内超 25 件仍触发 guard**——因此一律按上表再分子域，不把十一个 WORK 端口平铺成一个目录。`core` 侧受 `core/src` 顶层 25 件约束（现状 18 件）：**五门纯求值只有一个路径 `packages/core/src/work-readiness.ts`**（上表 WORK 行、§7.9、§6.4 同指这一件），它是顶层文件、不设 `core/src/work/` 目录、也不得在别处再放第二份门求值（同名异处即双实现）；其余 core 新件按子域进 `core/src/<子域>/`（如 `core/src/resources/`），不往顶层堆。

### 6.10 端口实现的验证责任

〔结论〕上表每一行在 81 里必须能指到**一个真实文件**（目标态）与**一条探针**（U80 编号或 82 的 V 项）；两者缺一即该端口仍为“未实现/未证”，不得因为“目录已建、类型已写”就改状态。类型落 `contract` 只证明形状存在，**不证明**语义被执行。

### 6.11 覆盖判定：不得假装已覆盖

〔结论〕以下说法在本卷一律判负：

| 错误说法 | 事实 | 正确说法 |
|---|---|---|
| “`FlowPlatform` 已覆盖 `PlatformBinding`” | 只有七能力与字段映射，无损失声明/退出计划 | “`FlowPlatform` 是能力端口；绑定档案缺” |
| “`TaskBrief` 就是任务合同” | `TaskBrief` 是派发材料，无五要件、无版本链 | “合同端口缺；`TaskBrief` 只是合同的下游产物” |
| “`EventRecord` 就是 `REC-EVT-01`” | 30 个事件名 vs 50 类记录；列集不同 | “`EventRecord` 是投影” |
| “`decide` 已实现五门” | 它实现的是并发四闸 + 断路器前置 | “五门端口缺” |
| “`CLOSE` 就是结清” | `CLOSE` 是回收 + 吊销，八项关闭未判（产物/资源/证据/未决义务/承诺/相对方/责任/记忆） | “结清端口缺” |
| “`gateWrite` 就是效果网关” | 无权源解析、无 fence、无未知对账 | “`gateWrite` 是内核；效果网关需包装” |
| “泳道租约就是写者租约” | 泳道是派发互斥，无 fencing token | “写者租约缺” |
| “`api` 已是对外 API” | 43 行骨架；`:8788` 在 `panel/external` | “`api` 是骨架；迁移见 §9.4” |
| “命令就是 `RecordTransaction`” | 事务是机制件，不核权、不路由 | “命令入口是 `TS-PORT-CMD-01`；事务只包同域多记录” |
| “`CapabilityResolver` 能判资格” | 它只做“需求→候选”解析 | “资格归 `TS-PORT-WORK-08`” |
| “验收即价值” | 验收判口径，价值判四本账 | “价值归 `TS-PORT-EVD-03`” |
| “重试就是对账” | 重试不解释差异，也不消解未知 | “对账归 `TS-PORT-REC-06`” |

---

## 七、主循环：七相位与语义落位

### 7.0 不新增第九相位

〔结论〕主循环保持**七相位**：采集 → state-diff → 派发 → 收割 → 合并 → 回收 → 落账/心跳。76/77 的新语义全部作为**相位内步骤**或**拍边界步骤**落位，不新设“受理相位”“验收相位”“结清相位”。

理由：相位是**拍的执行顺序**（一次 tick 的固定节拍），语义是**记录与判断**。把每个新语义升成相位会让“拍有界”失效（现状 `harvestSliceMs` 与泵流驻留就是为拍有界设的，`engine.ts:1190`–`:1203`）。相位内步骤可以随开关关闭而零行为；新相位会改变拍的长度与失败面。

〔事实〕现状拍内顺序（`engine.ts:1570`–`:2282`）：

```
相位1 采集
  1a activity.since 翻页（≤ maxActivityPages）→ kvSet(cursor)
  1b issues.list({}) → syncMirror（全量对账）
  1c 双哨（未知态哨 + 状态集巡逻核）→ ESCALATE / FOREIGN_KNOWN
  1d 批示归一层（拉评论 → 词表解析 → 角色校验 → 站立/打回）
相位2 state-diff
  2a 意图队列消费（kind→handler 分发表）→ 候选
  2b 拆单指令消费（批示:拆单 → 子单物化）
  2c 复活对账（closed 单离开终态 → RESUME）
  2d 候选补齐（活动集）+ 镜像重决策（每 N 拍）
  2e 队列触钟 + 定序
  2f 队列小模型精序（judge，纯置换；违约→规则档原序）
  2g 逐候选 decide（每单至多一动作）→ 六个动作队列
相位3 派发
  3a submit_approval → platform.issues.transition
  3b dispatch → executeDispatch（预算 reserve → wkey → launch）
相位4 收割
  4a 在途检查（本拍派发的跳过）→ harvestOne → 泵流/收口
  4b collect → transition(verified) + QA_PASS
  4c STALL 响置（告警达阈 → 杀/收口/重派）
  4d 落位对账（每 N 拍，companyDir 注入时）
相位5 合并
  5a renewMergeLeases
  5b mergeQ → runMergeAction（resume 原会话 → 门禁 → MERGE）
相位6 回收
  6a recycleQ → platform.issues.get → lanes.release → revokeWorkerKey → CLOSE
  6b 房间归档（rooms 注入时）
相位7 落账/心跳
  7a 零动作 → HEARTBEAT
  7b hrSync.drain
  7c todo_queue 投影重投
  7d scheduleToStart 观测
  7e pricing stale 检查
  7f costClose 日终
拍边界（相位外）
  B1 notify 中继（本拍 events，fire-and-forget）
  B2 L1 热重载 check()
  B3 停机请求读取
  B4 拍间隔等待（信号可打断）
```

〔结论〕七个相位的**输入是上一拍的持久投影 + 本拍平台读**，**输出是记录 + 动作结果 + 下一拍的持久状态**。任何相位都不得“记住”未落账的决策；进程重启后只能靠台账重放（现状靠 `seenIntentKeys`/`closedSet`/`queueCarry` 三处派生，见 §8.7）。

### 7.1 相位 1：采集

| 维度 | 现状 | 目标补充 |
|---|---|---|
| 输入 | `activity.cursor`（kv）、`issues.list({})`、`fields.schema()`（巡逻拍）、评论（批示层） | 不变；增“来源游标断裂”检测 |
| 输出 | 受影响单集合、镜像 upsert、`ESCALATE`/`FOREIGN_KNOWN` 事件、批示站立 | 增 `REC-EVT-02`（对账批次）与 `REC-EVT-03`（外部未知） |
| IO | 平台读（网络）；台账写（cursor/镜像/事件） | 不变；未知不得写 0 |
| 记录 | 现状=`EventRecord` 投影 | 目标=`RecEvent` + 对账/未知记录 |
| 失败 | 逐段 `errors.push` 继续；不中断拍 | 失败必须分类（14 类），不得只写字符串 |
| 幂等 | 游标持久化（`kvSet(CURSOR_KEY)`）；镜像 LWW；哨兵键派生去重 | 不变；游标必须 opaque |

〔结论〕相位 1 的“采集失败”**不得**让本拍进入“无数据即健康”。若 `activity.since` 失败，`affected` 为空，但必须写 `REC-EVT-03`（外部未知）并让拍报告带观察态 `state='gap'`（缺口/中断，见 77-§9.2 六态）；现状只 `errors.push` 一行（`engine.ts:1613`），面板无法区分“真没活动”与“没读到”。

### 7.2 相位 2：state-diff

相位 2 是语义最密的一段。目标态把 76/77 的六件事放进**决策前置**：

| 顺序 | 步骤 | 目标端口 | 现状锚 | 不得做的事 |
|---|---|---|---|---|
| 2a-0 | 命令受理 + 权检 | `TS-PORT-CMD-01` → `REC-CMD-01/02` | 无（各 `cmd*` 直调服务） | 命令不得绕过权检直接执行；不得用 `RecordTransaction` 当命令入口 |
| 2a | 意图消费 | `TS-PORT-WORK-01` | `drainIntents`（`intents/drain.ts`） | 不得把意图直接当授权 |
| 2a-1 | 受理结论 | `WorkIntake.intake` → `REC-WORK-02` | 无（现状直接进候选） | 不得未受理就建合同 |
| 2a-2 | 合同订立/修订 | `TS-PORT-WORK-02` | 无（`TaskBrief` 在派发时生成） | 不得用 `TaskBrief` 冒充合同 |
| 2b | 拆单 | `createSplitMaterializer` | `split/materialize.ts` | 子单不是“自动授权”，仍走 2a |
| 2c | 复活 | `RESUME` 事件 | `engine.ts:1744`–`:1758` | 评论不动终态不算复活（已钉死） |
| 2d | 镜像重决策 | 候选补齐 | `engine.ts:1788`–`:1800` | 不得把 rescan 当“新事实” |
| 2e | 触钟/定序 | `queueCarry`/`orderCandidates` | `apps/daemon/src/engine/todoqueue/queue.ts`（导出 `QueueCarryEntry`/`seedQueueCarry`/`queueMembership`/`orderCandidates` 等；**不是** `core/queue.ts`） | 排序不得改变候选集：`orderCandidates`（`:168`）只置换顺序，不得增删候选、不得改 `QueueCarry` 的成员集合 |
| 2f | judge 精序 | `QueueJudgeHook` | `judge/sites129.ts` | 只许纯置换；违约回原序（已实现） |
| 2g | 资格认定 | `TS-PORT-WORK-08` → `REC-WORK-08` | 无（资格散见公司目录） | 能力解析不判资格；不得用安装/探测结果冒充资格 |
| 2j | 执行计划锁（**执行在 2h 之前**，见下表注） | `TS-PORT-WORK-04` | 无 | 不得引用“最新”；不得在五门之后才锁——那会让能力门无计划可核、资源门无预留可读，并形成“五门要计划、计划要五门”的循环 |
| 2h | 开工五门 | `TS-PORT-WORK-03`；五门纯求值的目标件 `packages/core/src/work-readiness.ts`（**现状无此件**，文档按目标件描述） | 无（现状散在 `decide` 前置与人读） | 五门不得被并发四闸替代；输入严格是合同+授权 / 资格+执行计划 / 资源 / 信息 / 禁止清单五组，**风险不进五门**；五门是纯函数求值（输入五组、输出逐门结论 + 诊断），不得读宿主时间/网络/模型 |
| 2i | 并发四闸 + decide | `decide` | `core/decide.ts:339` | 顺序冻结：断路器前置 → 泳道 → 人 → 每拍 → 在途；统一称“并发四闸”，断路器不计入闸数；`decide` **保留**并发四闸 + 断路器，不吸收五门 |
| 2k | 风险分类 | `TS-PORT-WORK-09` → `REC-WORK-11` | 无 | 交付方不得自评降档；独立位置判定；**不作为五门输入**，验收与降档时读用 |

〔结论〕**表注：第一列是历史编号，执行顺序以行序为准**。`2j` 执行计划锁在 `2h` 开工五门**之前**，这是 77-§4.0/§4.5.1 明定的顺序（合同 → 计划锁（含资源预留落账） → 五门 → 开工结论），与 `TS-PORT-RES-01` 的“合同→计划锁→五门→出工段”同一条。编号不重排（81 已按 `2h`=五门、`2j`=计划锁引用），但**不得**按编号大小推出“先五门后计划锁”——那正是 77 点名的循环缺陷。计划锁自身只做输入核验（六件引用可解析、额度可读、预留不超剩余、主体一致），不产生任何一门的结论。

〔结论〕**平台状态映射的消费在本相位，记录也由本相位写**：`TS-PORT-BIND-01.mapState` 是**纯函数**（平台包提供，零 IO），未映射但合法的原值只回 `Ok({platformState, verification:'unverified', workStates:[], unmappedBehavior:'observe-unmapped'})`；**写 `REC-OBS-02` 的是本相位**（同一单 + 同一原值 + 同一拍一条），映射函数不写记录、不读时钟。`workStates=[]` 时本相位**不生成状态迁移**、不推进队列，也不得据此判验收/结清（§6.6 BIND-01 三层第 6 条）。

〔结论〕相位 2 的输出必须是**六个动作队列**（dispatch / approval / collect / merge / recycle / stall），且每个候选至多进一个队列（现状 `decide` 每单至多一动作，`engine.ts:1680`）。目标态再加两类：`intake`（受理待判）与 `contract`（合同待立）——它们不进动作队列，而是**阻塞后续决策**。

〔结论〕**五门与四闸是两层，不得互相替代**。五门（目标件 `packages/core/src/work-readiness.ts`，纯函数输入五组、输出逐门结论 + 诊断）回答“这一单能不能开工”；`decide` 的并发四闸 + 断路器回答“这一拍有没有名额”。**77 的工作态与 core 的平台流是两套映射**：77 描述工作处于哪个态，core 的平台流描述平台单据走到哪一步；二者不得等同，也不得互相结清——工作态达成不等于平台单据终态，平台单据终态也不自动使工作态结清。

〔结论〕**`FlowTable` 的唯一运行时来源是已挂载公司的版本化定义，不是模块级默认表**。daemon 从 `CompanySnapshot.workflows`（经 `loadCompanyDirectory` 校验）与对应 `FieldProvisionMap` 取表：有 `typeFlows[type]` 时只用该类型表；否则用该公司显式声明的 `stateFlow`。同键不合并、不把自定义追加到内建表；两者均缺 ⇒ `rejected_precondition` + `CONFIG_INVALID`，不得拿 `core/flows.ts` 的内建 L0/L1/L2 静默兜底。内建默认只可作为迁移期**显式命名并复制进公司定义**的模板材料，之后随公司版本走；旧公司未做这一步时只能保留旧行为并登记兼容损失，不得称为目标绑定。面板与 `decide` 必须消费同一快照，平台流仍不得反推 77 的工作态。

〔结论〕**批示不是授权**。现状 `directiveVerbNow` 与 `index.directiveStandingOf` 只产出 `approved` 布尔（`engine.ts:1887`–`:1910`），用于 `decide` 的 `WAIT_APPROVAL` 抑制。目标态保留这条，但必须：

1. `approved` 只影响“是否允许呈批/派发”，不产生 `REC-AUTH-*`；
2. 批示不能绕过五门；
3. 批示不能替代 `AuthorityActivation`（端点选择与代次）。

### 7.3 相位 3：派发

| 维度 | 现状 | 目标补充 |
|---|---|---|
| 输入 | approvalQ / dispatchQ | 不变 |
| 输出 | `platform.issues.transition`、`insertWorkRecord('running')`、`work_records` 行、`Inflight` 项 | 增 `REC-WORK-06`（出工）与 `REC-WORK-10`（派工） |
| IO | 平台写（经 `gated-platform`）、`adapter.launch`、台账写 | 不变；长 IO 不持写事务 |
| 记录 | `DISPATCH` 事件 + `work_records` | 目标=派工记录 + 出工记录分离 |
| 失败 | `executeDispatch` 的 `fail()` 释放泳道；预算超帽拒派 | 失败必须分类；不得“拒派但已扣预算” |
| 幂等 | `intentKey` + 泳道占用（决策即占，执行失败释放） | 不变；reserve 必须有幂等键 |

〔事实〕派发段的崩溃注入点 ①在 reserve 双行落账后、launch 前（`engine.ts:1040`）；②在 launch 返回后、`work_records` 在途落账前（`:1057`）。现状 `reserve` 实际只做 `gateDispatch` 的预算双行（`appendBudget`，`:1019`–`:1039`）；`insertWorkRecord('running')` 发生在 `adapter.launch` 与 `platform.issues.transition` **之后**（`:1058`–`:1075`），因此窗口②是真实的“已启动、台账无在途行”。

〔结论〕目标态 `dispatch` 的六步（§8.3）必须逐段可恢复：①之后崩溃 → 重启见到“已预留未执行”，按 `REC-EVT-03` 标未知并释放；②之后崩溃 → 重启见到“已启动未落账”，必须按 `pid`/会话 id 尝试接管或标 `unverified`，**不得**直接重派（会双跑）。

〔结论〕修复项（不是现状）：**把在途登记前置到 `launch` 之前**——先写 `work_records('running')`（含 `handle` 预留位与幂等键），再 `launch`，launch 返回后补 `pid`/会话 id。这样窗口②从“台账无记录”变为“台账有在途但无 pid”，重启可按在途行接管。该项属实现单，未改前不得声称“已前置”。

### 7.4 相位 4：收割

| 维度 | 现状 | 目标补充 |
|---|---|---|
| 输入 | `Inflight`（handle、workspace、briefPath、泵流状态） | 不变 |
| 输出 | `completed`/`failed`/`streaming`；`GATE_PASS`/`GATE_FAIL`；`REC-EVD-01` | 增证据包三件（`EVD-01/02/03`）与验收（`EVD-04`）分离 |
| IO | `adapter.stream`（时间片）、`resultStats`、fs 读报告、平台写、台账写 | 不变；报告读取必须在 containment 内 |
| 记录 | 事件 + `work_records` 收口 | 目标=收割批次 + 证据项 + 证据包 |
| 失败 | 四要件不齐 → `GATE_FAIL`；`WORKER_DEAD` 分类；断路器连击 | 增 `unverified`/`partial` 的区分 |
| 幂等 | 一 attempt 一收口；泵流驻留跨拍续收 | 不变；重复收口必须被 `endWorkRecord` 的“只允许一次”挡住 |

〔结论〕相位 4 的边界必须守住：**收割只收材料，不判验收**。现状 `finalizeHarvest` 同时做“四要件判定 + GATE_PASS 落账”（`:1224`–`:1259`），目标态拆成：

1. `EvidenceHarvester.harvest` → 证据包（材料齐否）；
2. `AcceptanceEvaluator.evaluate` → 验收记录（独立位置/风险/外部效果/价值）；
3. `GATE_PASS` 成为“验收通过”的投影，不再由收割直接产出。

这一步改变语义，必须走实现单与回归；在未改之前，**不得**声称“验收已独立”。

### 7.5 相位 5：合并

〔事实〕现状双轨：`mergeRun` 注入时走真单刀（resume 原会话 → 门禁命令 → `MERGE`），否则 v0 模拟轨；每拍 `renewMergeLeases` 续租，`leaseBusy` 的单进 `mergeWaiting` 下拍重试（`engine.ts:2092`–`:2104`）。

〔结论〕合并是**唯一允许起子进程跑门禁**的相位（`MergeGateCommandPort`）。约束：

1. 门禁命令是冻结字符串数组，不得由单据内容拼接；
2. 合并失败不得回滚已通过的验收，只能开返工（`REC-EVD-07`）；
3. 合并租约与写者租约是两套（前者防双合并，后者防双写），不得合并命名。

### 7.6 相位 6：回收

〔事实〕现状回收做四件事：`platform.issues.get` → `lanes.release` → `revokeWorkerKey` → `CLOSE` 事件；房间归档失败只 `ESCALATE` 不阻回收（`engine.ts:2106`–`:2131`）。

〔结论〕目标态在回收**之前**按固定顺序插入三步：

1. **记忆处置记录**：`TS-PORT-MEM-01` 先落 `REC-MEM-03`，操作取 77-§8.4.1 的**五值**（修正/清除/继承/转层/封存），逐项给理由、影响面、不可恢复后果、通知对象、残留在外声明；`继承`/`转层` 必须有接收确认。**不要**把它和结清的“记忆三路分流”混成一个枚举：三路分流是结清判据里对记忆这条的**核对视角**（哪部分进哪一层、哪部分不沉淀），五操作是处置记录自己的动作集。
2. **结清**：`TS-PORT-WORK-07 SettlementPort.settle` 判**八项**（产物/资源/证据/未决义务/承诺/相对方/责任/记忆）；异议走 `dissent` 字段，不是第九项；未结清不得 `CLOSE`。
3. **回收/CLOSE**：`lanes.release` → `revokeWorkerKey` → `CLOSE`。

〔结论〕**终止与清算也要闭环**（不得“已终止就一直卡在未结清”，也不得“未承接就 `CLOSE`”）：

- 工作**已合法终止**（终止决定 `REC-DEC-01` 依据可核、`TS-PORT-WORK-05 WorkLifecycle` 的终态迁移 `REC-WORK-09` 已成立）时，结清**不要求**验收成立——终止工作是“不再交付”，不是“交付了但没验”；八项照判，缺项照样 `partial`/`未结清`。**不得**拿 `REC-LIFE-01`（公司身份生命周期）当工作终止依据——那是另一条生命周期，不能互证；
- 终止涉及清算时，`settled_state='转入清算'`，`status()` 报 `in_liquidation`；此时 `CLOSE` 必须等 `REC-LIFE-02`（`TS-PORT-LIFE-02`）承接清算范围与未承接项、并给出接收确认；
- `REC-LIFE-04` 的损失与缺口报告必须在**接收之前**出（`TS-PORT-LIFE-02`+`TS-PORT-LIFE-03` 两处），缺了就不算承接完成。

〔结论〕失败处置（不得写成“失败不阻回收”）：

- 记忆**内容写入**失败但处置记录已落：标 `partial`，进入修复/残余承接队列，**不得**据此宣称结清；
- 处置记录本身未落：不得进入结清，回收等待；
- 结清为“结清但有保留事项”：必须逐项列责任者与到期，**不得**对外表述“已完成”；
- `转入清算` 未承接：`CLOSE` 等待，**不得**回收后再说“清算稍后补”；
- 任何“永远 `partial` 却仍 `CLOSE`”的路径都判负：`CLOSE` 只允许在 `settled_state ∈ {完全结清, 结清但有保留事项}`（保留事项须有承接者）或 `转入清算` 且清算范围已由 `REC-LIFE-02` 承接时发生。

〔结论〕`CLOSE` 是**回收的投影**，不是结清记录。`completed/accepted/settled` 三者不可互换（75-§2.2 术语表）；现状只有 `GATE_PASS`（完成）与 `CLOSE`（回收），中间两层缺失。“先结清、后回收”是本卷冻结的顺序，不得颠倒。

### 7.7 相位 7：落账与心跳

〔事实〕现状七件事：零动作心跳、`hrSync.drain`、`todo_queue` 重投、派发等待观测、定价 stale、日终收口（`engine.ts:2133`–`:2236`）。心跳只在 `mutations === 0` 时写；崩溃注入点 ④在心跳写入前。

〔结论〕目标态保持“零动作才心跳”，但 `mutations` 的计数口径必须写死：

- **算 mutation**：任何追加事实记录（`REC-*`）、任何外部效果、任何状态迁移；
- **不算 mutation**：只读投影与投影表维护——`todo_queue` 重投是**投影写**（可重建、不改事实），`scheduleToStart` 观测、面板快照刷新同样不算；
- 心跳判据是“本拍事实 mutation = 0”，不是“本拍零 SQL 写”。否则 `todo_queue` 重投会把空拍误判成有动作，导致该心跳时不心跳；反之把投影维护算进来也会让“有记录但无心跳、有投影却有心跳”的错位重现。

〔结论〕投影写与事实写必须在台账层可区分（不同表 + 不同写口），心跳只读事实写计数。`todo_queue` 重投失败不得写心跳，也不得写成事实 mutation；按 `REC-OBS-02` 记投影故障。

〔结论〕相位 7 是**唯一允许做“日终/日级”聚合**的位置（定价、成本收口）。这些聚合必须可重放：同日重复执行结果一致，且不得覆盖已有快照（`insertReport` 的自然键语义）。

### 7.8 拍边界步骤（不是相位）

| 步骤 | 现状 | 约束 |
|---|---|---|
| notify 中继 | `notifyRelay(report.events)`，fire-and-forget（`serve.ts:1570`） | 不得阻塞/打断主循环；失败只计量 |
| L1 热重载 | `hotReload.check()`，恒不抛（`:1580`） | 只在拍边界；在途工位不动（`applyCompanyUpdate` 只换公司面） |
| 停机请求 | `readStopRequest` + kv 去重 + 原子改名（`:1588`） | 只在拍边界；先落 kv 再消费 |
| 拍间隔 | `setTimeout` 50ms 切片，信号打断（`:1604`） | 不得硬等满 `tickMs` |
| 信号停 | `SIGINT`/`SIGTERM` → `stopped=true` | 等当前拍收口 |

〔结论〕拍边界步骤**不得**写业务事实。它们只能：发通知、换公司面、置停机标志、等待。任何“顺手落一条业务记录”的写法都会把边界变成第八相位。

### 7.9 新语义的落位总表

| 语义 | 落位 | 理由 | 不得落位处 |
|---|---|---|---|
| 受理 | 相位 2 前置 2a-1 | 意图必须先有结论才能进合同 | 相位 1（采集只读）；拍边界 |
| 合同 | 相位 2 前置 2a-2 | 派发前必须成立 | 相位 3（派发只执行） |
| 资格 | 相位 2 决策前 2g | 资格是开工门的前置材料 | 相位 3（派发时才判太晚） |
| 五门 | 相位 2 决策前 2h（**在计划锁 2j 之后**，见 §7.2 表注） | 先判“能否开工”，再判“现在能否派”；五门要拿已锁计划与预留后的基线 | 相位 3（太晚，已占资源）；先五门后计划锁（能力门/资源门无输入，且成循环） |
| 执行计划 | 相位 2 决策前、五门 2h 之前 2j（执行顺序见 §7.2 表注；编号沿用） | 计划锁必须在五门与 launch 之前：钉版本、写预留、产出基线快照供两门读取 | 五门之后；相位 3 内（launch 已发生） |
| 风险 | 相位 2 决策后 2k；验收时读用 | 风险档影响验收口径与降档判断，**不是开工门输入** | 五门输入（会把高风险误读成不可开工）；交付方自评 |
| 资源账目 | 预留随计划锁（2j，五门 2h 之前，写 `REC-WORK-05.resource_reservations`）、实际随收割/价值（相位 4，`REC-EVD-01/05`）、释放随结清（相位 6，`REC-EVD-06`） | 三处各自的记录事务内写**记录**，投影行由 `store` 的同事务 hook 维护；`baseline()` 只读，在五门 2h 判定时现算（此时 2j 已落预留；`planRef` 指向已锁计划，不得为此另开计划锁） | 相位 1（采集只读）；独立第八相位；本端口自带写事务或公共 `reserve`/`actual`/`release` |
| 验收 | 相位 4 收割后、`GATE_PASS` 前 | 材料先齐，再判接受 | 相位 6（太晚，已回收） |
| 异常 | 各相位错误点即时 + 相位 7 汇总 | 异常必须带具名接收 | 只写 tick errors |
| 记忆 | 相位 6 结清前（先落处置记录，五操作：修正/清除/继承/转层/封存） | 记忆来自完成的工作；处置是结清判据之一 | 相位 2（工作未发生）；结清之后 |
| 结清 | 相位 6 记忆处置后、`CLOSE` 前 | 八项（产物/资源/证据/未决义务/承诺/相对方/责任/记忆）关闭后才能回收；异议走 `dissent` 字段 | 相位 4（验收≠结清）；回收之后 |
| 清算 | 相位 6 结清内 `转入清算` → `CLOSE` 前 | `REC-LIFE-02` 承接清算范围与未承接项后才可回收；已终止也要走完结清 | 结清之前；`CLOSE` 之后（回收≠清算） |

〔结论〕“中间指令直接变成授权”的三种典型违规：

1. 批示 `批准` → 直接调 `platform.issues.transition` 改状态（绕过五门与计划锁）；
2. 意图 `schedule` → 直接 `launch`（绕过受理与合同）；
3. 网关 `gateWrite` 成功 → 被读成“已验收”（网关只证明鉴权与署名，不证明质量）。

---

## 八、事务、并发与恢复

### 8.1 唯一写入者的范围

〔结论〕“唯一写入者”必须按**事实源**分别声明，不能笼统说“daemon 写一切”：

| 事实源 | 唯一写入者 | 现状锚 | 例外与边界 |
|---|---|---|---|
| SQLite 台账 | daemon 进程（含 schema 迁移） | `store/src/ledger.ts:233`（`appendEvent` 唯一写口，无 UPDATE/DELETE） | `personnel_events` 有 UPDATE/DELETE 触发器兜底（`ledger.ts` 注释）；**现状 `openLedger` 无条件迁移，读进程也会跑 DDL**（§8.2 事实表），这是待修项 |
| 公司 git 目录 | daemon 进程 | `runHarvestRecon` 补收（`engine/jobs/harvest-recon.ts`）、`output-account` | `studio-next init/company` 等 CLI 命令以“人代 daemon”身份写，属同一写入者的命令行面；不得有两个 daemon 同时写 |
| YouTrack / Taiga / LocalFile | daemon（控制面）与 worker（仅经网关） | `gated-platform.ts` 九写面；`studio-tools` MCP | worker 只能 `GW_*` 六动词；状态推进不在白名单 |
| Matrix | daemon（启动期经 `matrixSessionFactory` 建会话并得到四面；四面直接注入仅测试/迁移兼容） | `matrix` 包的 mention/广播/人事面 | bot 密码只在 daemon 内存、会话 token 只在 client 内存；boot 不登录、不持 token |
| 提示词/任务书 | daemon | `engine/prompt-assembly.ts`、`instructions-store.ts` | 写入临时文件（workspace 外） |
| 资源账目（**派生投影**，不是独立事实源） | daemon（三处记录事务内的同事务 projection hook，由 `store` 拥有） | 无（未实现，§6.4 `TS-PORT-RES-01`；投影名 `resourceLedger`、物理表 `resource_ledger`，§6.3 已登记为**目标第 18 个**，随 MIG-01 落地） | 事实仍在 `REC-WORK-05.resource_reservations`/`REC-EVD-01`、`05`/`REC-EVD-06`；`ResourceAccountant` 是**只读评估**（`baseline`/`gap`），不写记录、不写投影、不提供 `reserve`/`actual`/`release`；不得由 API、worker 或面板直接记账 |

〔事实〕“读面只读”**不是现状**。`packages/panel/src/external/server.ts` 有两条写：

1. `ledger.kvSet(kvKey, …)` 写 `daemon_kv` 的幂等键（`:491`，命名空间 `external:idem:<slug>:<key>`）——**内容是幂等缓存类，不是事实记录**，但它写的是**台账文件本身**，而台账文件只有 daemon 一个写者；第二个进程写同一 DB 会与 daemon 的 WAL/迁移/重建撞车，故仍属违例（判在“写者”而不在“写的是什么”）；
2. `platform.issues.create(...)` 直建平台单据（`:487`）——**绕过 `EffectGateway` 与 wkey**，是待迁移违例（`panel/src/index.ts:67` 已列为待批示）。

〔结论〕三个“不得”：

1. 面板与对外 API **不得**直写台账文件（含 `daemon_kv`），也不得直调平台写原语。现状两处写都必须消掉：平台建单回到 daemon 经 `EffectGateway`；幂等键改由 daemon 在消费意图时写（§9.4）；
2. 外部系统回写**不得**直入台账，必须经对账（`REC-EVT-02`）；
3. **只读进程不得跑 DDL**：panel/overview/external/CLI 一律只读打开，不建库、不迁移、不升级 schema；迁移只由 daemon 在独占窗口执行（§8.2）。schema 版本不兼容时拒起，不得自动升级。

### 8.2 单写域与“长 IO 不持写事务”

〔结论〕每个写者域（`TxScope`）只有一个写者。跨域写入只能靠：

- 同库不同表：一个 `BEGIN` 内可写多表（现状 `syncCompany`、`replaceTodoQueue` 两处 `BEGIN`，`ledger.ts:865`/`:948`）；
- 跨事实源：**不许**分布式事务；用“预留 → 执行 → 回执 → 对账”四段（§8.3）。

〔结论〕`node:sqlite` 是同步 API，因此“长 IO 持事务”的真实风险不是并发阻塞，而是：

1. 事务内 `await` 网络/子进程 → 事务跨越事件循环，崩溃后可能半提交；
2. 事务内做 `fs` 大文件读写 → 拍超时。

禁令：`BEGIN` 与 `COMMIT` 之间只允许同步的、有界的、已知行数的写。任何 `await` 必须移出事务。

〔事实〕现状 `engine.tick()` 在相位 3 的 `executeDispatch` 里 `await adapter.launch`，而 `insertWorkRecord` 是同步单语句——没有把 launch 包进事务。这是正确的形态，目标态保持。

〔事实〕**DDL 不是单写的**：`openLedger` 无条件调 `migrate(db)`（`store/src/ledger.ts:513`–`:515`），而 `openLedger` 的调用者有 **14 处、跨多个进程形态**：

| 调用者 | 位置 |
|---|---|
| daemon `runServe` | `assembly/serve.ts:1471` |
| 监控面 `servePanel` | `panel/src/server.ts:454` |
| 概览面 `serveOverview` | `overview/server.ts:483` |
| 对外 API `serveExternal` | `external/server.ts:553` |
| CLI `gray` | `cli/gray.ts` |
| CLI `candidates` | `cli/candidates.ts` |
| CLI `sandbox` | `cli/sandbox.ts` |
| CLI `jobs` | `cli/jobs.ts` |
| CLI `ledger` | `cli/ledger.ts` |
| CLI `cutover` | `cli/cutover.ts` |
| CLI `company` | `cli/company.ts` |
| CLI `postmortem` | `cli/postmortem.ts` |
| 重建 `rebuild` | `store/src/rebuild.ts:29` |
| 演习 `drill` | `store/src/drill.ts:149`/`:164` |

也就是说，只要这些进程中的**任意一个**先起，就会对同一个库执行 schema 迁移——**这是多进程问题，不是“四个进程”问题**；CLI 是短命进程，但它照样会在启动瞬间跑 DDL（并发窗口更短，冲突更难复现，但性质相同）。它们各自是“开了库”，不是“有权改 schema”——**现状不是“迁移只在 daemon”**，本卷不得那样写。

〔结论〕目标态：

1. **迁移只由 daemon 在独占窗口执行**（启动时、且持有写者围栏/单实例锁）；`migrate` 从 `openLedger` 的默认路径里移出，改为显式 `migrateIfOwner(db)` 或启动参数；
2. **只读打开不跑 DDL**：panel/overview/external/CLI 的**读命令**一律 `openLedgerReadonly`（§本节末签名；`PRAGMA query_only=ON` + `openSqlite(path, {readonly:true})`），**不得**建库、不得迁移、不得改 PRAGMA 之外的结构；**只读分支必须跳过 `journal_mode`/`synchronous` 等写设置**（它们会写库头），只保留 `busy_timeout` 与 `query_only`——“只读不写”不等于“完全不读库”，读、查、取 schema 版本都照常；`store/rebuild.ts`/`store/drill.ts` 属**维护写面**，走 `openLedgerMaintenance`，允许建库/建表，但必须在“daemon 未运行（或已持单实例锁）”的离线维护窗口执行，不得在 daemon 运行期与 `runServe` 并发跑；
3. 只读打开时若发现 schema 版本低于所需 ⇒ **明报不兼容并拒起**（`Err({failure:'rejected_version', category:'EVOLVE_REJECT', subcause:'schema-behind'})` + 期望/实际版本），库更新 ⇒ 同形 `subcause:'schema-ahead'`；不得自动升级、也不得静默降级读。**`CONFIG_INVALID` 只留给“路径/配置缺失或畸形”**，版本不匹配一律 `EVOLVE_REJECT`；
4. 迁移期间 daemon 必须独占（`BEGIN EXCLUSIVE` 语义 + 单实例锁），迁移失败整体回滚且**不得**留下半迁移的库；
5. 多进程并发迁移的后果（写锁竞争、半提交、版本跳跃）**未验证**，登记为 U80-16；在验证前不得声称“并发安全”。

〔结论〕只读打开的公共签名（目标；由 `store` 导出，调用方只拿只读视图）：

```ts
interface ReadOnlyLedgerOpen {
  path: string
  expectedSchemaVersion: number      // 调用方声明自己需要的 schema 版本
  readOnly: true                     // 恒 true；不提供 false 分支
  queryOnly: true                    // 打开后立即 PRAGMA query_only=ON
}
interface ReadOnlyLedger {           // 只读视图，不是 Ledger：类型上不暴露 append/begin/kvSet
  readonly schemaVersion: number
  query<TPayload>(q: RecordQuery): Result<RecordPage<TPayload>, ClassifiedError>   // 与 REC-02 同出参形态，但**同步**：{ items, nextCursor }
  get(recordId: Qid): Result<RecordEnvelope<unknown> | undefined, ClassifiedError>   // **同步**；`Ok(undefined)` 才是不存在，库失败 ⇒ `Err(unavailable/STALL)`（不得用 `undefined` 吞错）
  payload(ref: ArtifactRef): Result<RecordPayload | undefined, ClassifiedError>   // **同步**；与 REC-02 的 `payload(ref)` 同义同码（四态、四条 subcause 逐字一致，§6.3）：`Ok(undefined)` 只表示该定位无载荷
  close(): void                      // 幂等
}
declare function openLedgerReadonly(o: ReadOnlyLedgerOpen): Result<ReadOnlyLedger, ClassifiedError>
```

`RecordPage<TPayload> = { items: readonly RecordEnvelope<TPayload>[]; nextCursor: string | null }`——末页 `nextCursor` 必须 `null`，游标 opaque；只读面**不得**只给进参不给下一页。

**为什么只读查询也返回 `Result`**：`node:sqlite` 是同步 API，读也会失败（游标损坏、字段不在索引面、`limit` 越界、库被替换）。把失败塞进“空页”会让 API 把“读不出来”渲染成“没有单”——这正是 77-§9.4 要记录的覆盖缺口。**`get` 同理**：它的失败通道不是可选项，`Ok(undefined)` 只表示“该 `recordId` 不存在”，运行期读失败一律 `Err`（下表的 `ledger-read-failed`）。三条查询 subcause 固定：

| 情形 | `Err` 形状 |
|---|---|
| `limit`/`offset` 超上限或请求了未开放的排序/字段组合 | `{failure:'unsupported', category:'EVOLVE_REJECT', subcause:'ledger-query-unsupported'}`——请求形状合法、该能力尚未开放，属演进域；**不是** `CONFIG_INVALID` |
| 游标不可解、已被作废或与本次查询条件不匹配 | `{failure:'conflict', category:'EXTERNAL_REJECT', subcause:'ledger-cursor-invalid'}`——**非合并域不得写 `MERGE_CONFLICT`**；`STATE_CONFLICT` 不是 `ErrorCategory` 的成员，全卷**不得出现** |
| `RecordQuery` 形状非法（未知字段、类型不符） | `{failure:'rejected_precondition', category:'CONFIG_INVALID', subcause:'ledger-query-invalid'}` |
| `get` 运行期读失败（库不可读、行损坏、库被替换） | `{failure:'unavailable', category:'STALL', subcause:'ledger-read-failed'}`——**不是** `Ok(undefined)` |
| `payload(ref)` 面（只读同步版与 `RecordReader` 异步版**同码**，§6.3） | 该定位无载荷 ⇒ `Ok(undefined)`；无权读所属信封 ⇒ `{failure:'rejected_forbidden', subcause:'payload-not-authorized'}`；摘要/媒体类型不符 ⇒ `{failure:'rejected_precondition', subcause:'payload-digest-mismatch'\|'payload-media-type-mismatch'}`；字节读不出 ⇒ `{failure:'unavailable', category:'STALL', subcause:'payload-unreadable'}`——**不可读不得当不存在** |
| 打开期失败（库缺失/schema 偏移） | 见下 1.：`unavailable`/`db-missing`、`rejected_version`/`schema-behind`\|`schema-ahead`（不得改写成 `CONFIG_INVALID`，也不得降级空视图） |

1. 文件不存在 ⇒ `Err({failure:'unavailable', category:'STALL', subcause:'db-missing'})`（**不建库**）；`expectedSchemaVersion` 与库内 `schema_version` 不一致：库更旧 ⇒ `Err({failure:'rejected_version', category:'EVOLVE_REJECT', subcause:'schema-behind'})`，库更新 ⇒ `Err({failure:'rejected_version', category:'EVOLVE_REJECT', subcause:'schema-ahead'})`——两种都**拒起**并交 daemon，**绝不**自动迁移；
2. 打开后只允许 `SELECT`；DDL、建表、写 PRAGMA、`migrate` 一律实现缺陷（除 `query_only=ON` 外不得改结构）；
3. **只读面与维护写面分开**：`rebuild`/`drill` 走 `openLedgerMaintenance(...)`（显式写意图 + 单实例锁 + 离线窗口），不得复用只读签名，也不得在 daemon 运行期并发。

### 8.3 六段写协议：prepare / reserve / CAS / execute / receipt / finalize

〔结论〕凡是“有外部效果”的动作，一律走六段，不得跳段：

| 段 | 语义 | 必须落账 | 失败处置 | 现状锚 |
|---|---|---|---|---|
| prepare | 判定与计划锁 | 合同/五门/计划记录 | 失败=不 reserve | `decide` + 目标端口 |
| reserve | 预留资源（预算、工位、凭据、租约） | 现状=`appendBudget` 双行 + wkey 签发；目标=再加 `insertWorkRecord('running')` **前置到 launch 前** | 失败=释放并标拒 | `engine.ts` dispatch 段：现状 `insertWorkRecord` 在 launch 后（窗口②），见 §7.3 修复项 |
| CAS | 改变共享状态（激活代次、状态迁移、投影替换） | 迁移记录 + 回执 | 版本冲突=重读重判 | `transitionCandidate` 的乐观锁（`ledger.ts`） |
| execute | 外部效果（平台写、launch、合并门禁） | 不落“成功”，只落“已发起” | 超时=未知 | `gated-platform` / `adapter.launch` |
| receipt | 收到外部确认 | 回执记录 | 无回执=未知，不得重试直写 | `REC-RCP-01` |
| finalize | 收口（结束工时单、写终态、吊销） | `endWorkRecord` + `GATE_PASS/FAIL` | 只允许一次（已 ended 再收=`Err({failure:'rejected_state', …})`，走合法出口，不重试） | `ledger.endWorkRecord` |

〔结论〕六个段的**顺序不可交换**。特别是：reserve 必须在 execute 前（否则外部已动、预算未留），receipt 必须在 finalize 前（否则“收口了但外部没确认”）。

〔事实〕有一个现成的反例正好违反这条：`panel/src/external/server.ts:487` 先 `platform.issues.create`（execute），`:491` 才 `ledger.kvSet` 写幂等键（本该是 reserve 的一部分）。两步之间崩溃或 `kvSet` 抛错，外部已落单而幂等键缺失，重放时会**再落一单**——这正是“reserve 后置”的代价。该处随 §9.4 的迁移一并转到达 daemon 侧，不得就地修补成“先写 kv 再落单”（那会把越界写留在 panel 里）。

〔事实〕现状的 `insertWorkRecord` 与 `endWorkRecord` 是同步语句，`appendBudget` 是同步；`execute` 是异步。因此六段天然落在不同的事件循环轮次，崩溃窗口真实存在（§8.7 的五个注入点就是这些窗口）。

### 8.4 重试、超时、取消与迟到副作用

〔结论〕四条规则：

1. **重试先查回执**：任何重试前必须按 `idempotencyKey` 查回执；有回执=返回既有结果，不再执行。无回执且上次状态未知 → 先对账（`REC-EVT-02`），不得直接重试。
2. **超时=未知**：`timeout` 不是失败，是“不知道外部做了什么”。必须落 `REC-EVT-03` 并进对账；在未知未消解前，该单不得进入“可重派”。
3. **取消/杀进程**：`adapter.kill` 必须等死（现状 `dispose` 逐项 `await kill`，`engine.ts:2287`–`:2295`）；杀后 `work_records` 留 `running`，由下次启动接管（`takeOverRunningWorkRecords`）。
4. **迟到副作用**：外部在超时后才完成 → 由对账发现，写“迟到回执”，并把原“未知”标为“已消解”。不得把迟到结果当新事实重算验收。

〔结论〕`partial` 与 `unknown` 必须分开：`partial` 是“部分成功且已知哪部分”；`unknown` 是“不知道”。前者可补偿，后者只能对账。

### 8.5 跨进程围栏

〔结论〕无互认围栏时，只能：

1. 冻结旧写者（停止其租约续期、拒绝其 fence）；
2. 独占交接（新写者取得租约并等旧租约 TTL 过期）；
3. 核对迟到副作用（对账窗口 ≥ 旧租约 TTL + 最大外部延迟）。

不得并发双写。现状 `lanes` 的 TTL 到期“视同无主”（`lanes.ts` 注释）是**单进程内**语义；跨进程必须由 `WriterLeasePort` 的持久 CAS 承担。

〔事实〕现状 `merge-lease` 是进程内 TTL + 每拍续租 + 死主回收（`engine/merge/merge-lease.ts`）；跨进程归后续刀（`EngineConfig.mergeLeaseTtlMs` 注释）。本卷把它登记为 §12 未证项。

### 8.6 时间、ID、随机的注入

| 依赖 | 注入点 | 现状 | 约束 |
|---|---|---|---|
| 时钟 | `EngineDeps.clock`、`createGateway({clock})`、`buildServeRuntime({clock})` | 已有 | 纯逻辑包（`core`）零 `Date.now()`——〔事实〕实测 `packages/core/src` 无 `Date.now()`/`Math.random()` |
| ID | `EngineDeps.makeId`（缺省 ULID）、`makeUlid` | 已有 | ID 必须单写入者生成；测试注入确定性序列 |
| 随机 | `WkeyClaims.nonce`（调用方给）、`crypto.randomUUID`（会话 id） | 已有 | 不得用 `Math.random()` 生成安全相关值 |
| 租约时间 | 墙钟 + 租约到期 | 已有 | 租约**不得只靠 wall-clock**：时钟回拨会让租约永不过期；必须配合单调计数或持久 `expiresAt` + 启动时校准 |

〔事实〕`packages/store/src/ledger.ts:1649` 的 `createPricingFace(db, () => Date.now())` 是库内直接取墙钟；`migrations.ts:576` 亦直接 `Date.now()`。这两处是注入纪律的**例外**，应在 81 登记为“库层允许墙钟，仅用于迁移记账”，或改为注入。

〔结论〕`engine.ts:1190`/`:1203` 的 `Date.now()` 用于 `harvestSliceMs` 时间片——它是**运行时活性**，不进台账账面（`:393` 注释已声明），允许保留。

### 8.7 恢复：五个 kill 点与新增注入点

〔事实〕现状五个崩溃注入点（`engine/crash-points.ts`，`SN_CRASH_POINT=<点名>` 触发 `SIGKILL`）：

| # | 点名 | 位置 | 窗口语义 | 重启后现状 |
|---|---|---|---|---|
| ① | `dispatch-reserved` | `engine.ts:1040` | reserve 双行已落账、launch 前 | 见到“已预留未执行”，无 worker；靠重派/接管 |
| ② | `dispatch-launched` | `:1057` | launch 已返回、`work_records` 在途落账前 | 有孤儿进程，台账无记录 |
| ③ | `harvest-verdict` | `:1259` | 四要件判定后、`GATE_PASS` 落账前 | 判定丢失，下拍重判 |
| ④ | `heartbeat-write` | `:2136` | 零动作拍心跳写入前 | 无心跳，下拍补 |
| ⑤ | `shutdown-drain` | `:2296` | kill 已跑、在途注销前 | `work_records` 留 `running`，下次接管 |

〔结论〕目标态**保留这五个点不改名、不改位置**（它们对应 §8.3 的六段窗口），并**新增**下列注入点；新增必须是受控测试缝，默认零行为：

| 新点名 | 窗口 | 要证明的恢复语义 |
|---|---|---|
| `import-applied` | 导入六步完成后、回执前 | 重启不重复导入；回执可重建 |
| `activation-cas` | 激活 CAS 成功后、回执前 | 代次已换但回执缺失；读 `current()` 即恢复 |
| `effect-sent` | 外部写已发出、回执前 | 未知 → 对账；不得重写 |
| `effect-receipt` | 回执已落、finalize 前 | 重启只做 finalize，不重发 |
| `memory-disposition-written` | 记忆处置记录已写、结清前 | 重启补结清，不重复处置 |
| `settlement-written` | 结清记录已写、`CLOSE` 前 | 重启补 `CLOSE`，不重复结清 |
| `projection-partial` | 投影重建中途 | 重启后投影状态必须是 `gap`（重建未完成的缺口）或 `conflict`（与事实不一致），不得报 `observed` |
| `lease-acquired` | fence 已发、首写前 | 旧写者被拒；新写者可从头写 |

〔结论〕每个注入点必须有对应测试：杀进程 → 重启 → 断言“无重复副作用、无丢失终态、状态不假绿”。现状崩溃注入是**单个** `apps/daemon/test/engine/crash-injection.test.ts`（`test` 下共 85 个 `.test.ts`），五个点在同一文件里按序驱动；新增点进同一套并按同一形状扩写。

### 8.8 恢复的三条不变量

〔结论〕无论从哪个窗口恢复，必须满足：

1. **不重复外部副作用**：同一 `idempotencyKey` 只产生一次外部效果；靠回执查询保证。
2. **不丢终态**：已 `GATE_PASS`/`CLOSE` 的记录不因重启消失；记录是 append-only。
3. **不假绿**：恢复期的未知一律 `unknown`/`gap`/`conflict`，不得默认成 `observed`/`ok`。

〔结论〕三条不变量的验证属于 82 的 V4（迁移/故障/安全）层；本卷只给注入点与断言形状，不给通过结论。

---

## 九、读写面与网络服务

### 9.1 三个面的事实位置

〔事实〕当前三个 HTTP 面的**代码位置**与**端口**如下：

| 面 | 端口（实测） | 代码位置 | 入口命令 | 读/写 |
|---|---|---|---|---|
| 监控 | `:8791` | `packages/panel/src/server.ts` | `studio-next panel --db` | 只读 |
| 公司概览 | `:8789` | `packages/panel/src/overview/` | `studio-next overview --company … --db …` | 只读 |
| 对外 API | `:8788` | `packages/panel/src/external/` | `studio-next external` | **读 + 两处写**（见下） |

〔事实〕对外 API 面现有的两处写，都在 `packages/panel/src/external/server.ts`：

| 位置 | 写的什么 | 判定 |
|---|---|---|
| `:491` | `ledger.kvSet(kvKey, …)` 写台账 `daemon_kv`，用作 `POST /v1/requests` 的幂等键 | 台账是 daemon 的专属单写域，panel 进程直写**违反唯一写入者** |
| `:487` | `platform.issues.create(…)` | 绕过 `wkey` 网关直写平台，**违反“YouTrack 只经框架网关”** |

〔结论〕这两处都是**待迁移违例**，不是可保留的设计（处置见 §9.4 的 M1–M5 与 §8.1）。监控面与概览面**没有写**：二者的路由只读投影，`/api/judge` 也只读 `JUDGE_*` 事件统计。

〔事实〕文档逻辑名与实值有漂移：`panel/src/judge.ts:5` 明写“文档逻辑名 :8787、端口实值 :8791——制作人 2026-10-21 裁定”。因此凡文档写 `:8787` 的地方，实值都是 `:8791`。

〔事实〕绑定地址三面**缺省都是 `127.0.0.1`**（`panel/src/server.ts:415`、`overview/server.ts` 的 `hostname` 透传、`external/server.ts:534`–`:535`）；`--lan` 才显式 `0.0.0.0`（`cli/external.ts:109`）。`external/server.ts:534` 注释明确这是对“D4 默认局域网”的**安全反转**。`cli/external` 退役后，该旗标随装配迁到 `ServeConfig.external`（目标键：`enabled`/`port`/`token`/`lan`）——**不得**因为命令消失而丢掉“显式开局域网”这道闸。

〔结论〕本卷不把现状说成“已统一”：

- 文档说“对外 API 默认局域网”，代码默认回环——**现状是回环**，局域网需显式旗标；
- 三面缺省回环是**合理的安全缺省**，但“默认局域网”的部署意图未实现；
- loopback / LAN 的选择属部署策略，交 78 绑定档案与制作人裁定，本卷只登记候选，不定案。

### 9.2 监控面（`:8791`）的目标职责

〔事实〕现状路由（`panel/src/server.ts:172`–`:271`）：`/`、`/api/health`、`/api/jobs`、`/api/runs`、`/api/workers`、`/api/events`、`/api/breakers`、`/api/costs`、`/api/inbox`、`/api/judge`、`/api/snapshot`、`/api/events/stream`；另有 legacy 路由与静态资源。

〔结论〕目标职责**只增语义、不加写面**：

| 面 | 目标 | 约束 |
|---|---|---|
| 健康 | 六态而非布尔 | `unknown`/`gap`/`stale` 必须显示为异常色，不得显示绿 |
| 运行记录 | 读 `tick` 报告与事件流 | 只读；不得触发决策 |
| 在途/泳道/断路/成本 | 读投影 | 未知不得显示 0 |
| 收件箱 | 读 `todo_queue` 投影 | 投影重建中显示 `gap`（见 §9.6） |
| 判断调用 | 读 `JUDGE_*` 事件统计 | 只在有 judge 注册位时有数据；无数据 ≠ 0 次 |

〔结论〕监控面**不得**提供“重试/重派/关单”按钮。任何“运维动作”必须走 CLI 或网关，且留下记录；按钮直调会绕过唯一写入者与幂等键。

### 9.3 公司概览面（`:8789`）的目标职责

〔事实〕现状：`/api/overview/companies`、`/:slug/{snapshot,org,people,people/:personId,progress,finance,reports}`、`/legacy/*`（`overview/server.ts:207`–`:399`）。

〔结论〕概览面是**老板视角的只读聚合**：

1. 数据源=公司目录快照 + 台账投影；不得读平台实时（平台读归 daemon）；
2. 组织/人事/进度/财务/报表五个标签页的每个数字都必须能点回来源游标；
3. 缺数据必须显示缺口（`REC-OBS-02`），不得补零；
4. `legacy` 路由是兼容面，目标态保留到 82 的迁移波次结束，之后删除；删除须先宣告。

### 9.4 对外 API（`:8788`）的目标职责与迁移路径

〔事实〕`packages/api` 是 43 行骨架（`PACKAGE_STATUS = "skeleton"`），无任何路由；`:8788` 实现长在 `packages/panel/src/external/`（`server.ts` **571 行**、`views.ts` 201 行纯投影、`index.ts` 48 行）。`panel` 的 `package.json` 导出了 `"./external": "./src/external/index.ts"`。

〔事实〕`external/server.ts` 已经有一层注入面，但**同时**抓着四处外部符号、并保留一处越界写——这些就是迁移必须消掉的耦合：

| 现状 | 位置 | 迁移要求 |
|---|---|---|
| 数据源注入（已做好） | `ExternalCompanySource{slug, snapshotProvider, openLedger?, listReports?, contact?}` | 保留形状，只换包；**`openLedger` 删除**（读面改用注入的只读快照/投影，不直连库） |
| 平台写原语 | `ExternalPlatformWrite{issues.create}` + `platform?` | **删除**，换成意图提交口：`emitIntent(intent: WebhookIntentPayload): Promise<Result<IntentSubmitResult, ClassifiedError>>` + `getIntentReceipt(key: IntentKey): Promise<IntentReceipt \| undefined>`（端口 `TS-PORT-API-01`，§6.6；**不用 `void` 掩盖回执**） |
| `listenHono` / `ListenHonoOptions` / `HonoShellHandle` | `server.ts:48` 从 `../server.ts` 取 | **下沉为 `api` 自己的 HTTP 适配**（只依赖 `node:http`，零 Hono 之外的新依赖）；不从 `panel` 取，也不靠 `panel` 注入实现 |
| `buildFinanceSnapshot` | `server.ts:49` 从 `../overview/views.ts` 取 | **下沉到 `company`** 的纯投影面（与 `buildOrgTree`/`buildProgressSnapshot` 同组）；`api→company` 与 `panel→company` 都已在允许边内，不新增 `api→panel` |
| `SLUG_RE` | `server.ts:45` 从 `@studio-next/company` 取 | 按 §10.6 先把 `company` 修进 `dependencies`；`api→company` 已有允许边（`boundary-rules.mjs:123`），直接用，不借 `panel` 传递 |

〔事实〕现状端点：`GET /`（索引）、`GET /v1/agent-card`、`/v1/company`、`/v1/org`、`/v1/people`、`/v1/projects`、`/v1/issues`、`/v1/finance`、`/v1/reports`、`/v1/events`、`POST /v1/requests`；信息/触发骨架，SSE 订阅未实现（501 占位，`panel/src/index.ts:65`）。**目标新增 `GET /v1/requests/status`（回执查询），现状无此路由**——旧稿的 15 条计数因此漏一项，见下“路由计数 = 16 条”。

〔结论〕目标职责（信息 / 触发 / 订阅 **三类 HTTP 面**；MCP 是另一个出口，不在这三类里）：

| 面 | 路由 | 数据来源 | 现状 |
|---|---|---|---|
| 信息 | `GET /v1/agent-card` | 公司快照（名片） | 骨架 |
| 信息 | `GET /v1/company` | 公司快照 | 有 |
| 信息 | `GET /v1/org` | `buildOrgTree`（`company` 纯投影） | 有 |
| 信息 | `GET /v1/people` | 组织/人事投影（**默认只出聚合**） | 有 |
| 信息 | `GET /v1/projects` | ticket mirror 投影 | 有 |
| 信息 | `GET /v1/issues` | `issuesView`（装配体内只读台账现构） | 有 |
| 信息 | `GET /v1/finance` | **三源**：预算（`budgets`）+ 事件成本（`events.cost_usd`）+ 月报（`reports`）；缺任一源 ⇒ 该段 `unknown` 并写原因，**不得补 0** | 有路由，**未接预算/月报** |
| 信息 | `GET /v1/reports` | `listReports`（只出清单，不出正文） | 有 |
| 信息 | `GET /v1/requests/status?company=&source=&kind=&dedupKey=[&ticket=]` | 回执查询：调 `ingress.receipt(key)` 读**本进程已提交投影快照**；不重放、不直查库、不触发物化；`undefined` ⇒ `503`（见下方“回执查询端点”）；成功 `200` + `{ receipt }`；响应头 `Cache-Control: no-store` | **未实现**（新增端点；旧 15 条口径漏计） |
| 订阅 | `GET /v1/events` | 无（订阅面未实现） | **501 占位**（`panel/src/index.ts:65`）——不得宣称 SSE 已实现；**不隐瞒**：它按订阅面计，不按信息面计 |
| 触发 | `POST /v1/requests`、`/v1/explore`、`/v1/tasks`、`/v1/intel` | 只产意图（`TS-PORT-API-01`） | 骨架 |
| 订阅 | `/v1/subscriptions` | 无 | 未实现 |
| 索引 | `GET /` | 静态路由清单 | 有 |

〔结论〕**路由计数 = 16 条**（唯一口径，别处不得再写 12/13/**15**）：**10 条读面**（`agent-card`/`company`/`org`/`people`/`projects`/`issues`/`finance`/`reports`/**`requests/status`**/`events`，其中 `/v1/events` **归订阅面**、当前 `501`）+ 4 条触发（`requests`/`explore`/`tasks`/`intel`）+ `/v1/subscriptions` + `GET /` 索引 = 16。10 + 4 + 1 + 1 = 16，**不含** MCP 工具目录（另一出口，§11.4）。

〔修订〕**旧口径写 15 条，漏了回执查询 `GET /v1/requests/status`**（`emitIntent` 只回 202/200，没有查询口，调用方无从得知 `queued/decided/unknown` 与 `outcome`）。本次补为 **16 条**，并把“10 条读面”写死；凡本卷/81/82 仍按 15 条核对的段落一律以 16 为准（保留此修订说明，便于比对旧稿，**不隐藏旧矛盾**）。

**回执查询端点（`GET /v1/requests/status`）的硬约束**：

1. **查询参数与 `IntentKey` 逐位对应**：`company`、`source`、`kind`、`dedupKey` 必填，`ticket` 可选；第四槽位 = `ticket ?? dedupKey`（与 `intentKeyOf`、`core/src/decide.ts:319`–`:324` 逐位一致）。**不得**接受 `key=` 之类的拼接串（拼接即第二套键格式），也不得从 `body`/`correlation` 里猜缺失字段。
2. **只读快照，不重放**：服务端调 `ingress.receipt(key)`（`TS-PORT-API-01`）——它读的是**本进程已提交投影快照**，**不查 SQLite、不调 `refresh`、不触发 `replayQueued`、不物化任何记录**。HTTP 层拿不到 `replayQueued`（类型上只有 `Pick<…,'submit'|'receipt'>`）。
3. **`undefined` ⇒ `503`，不是 404**：快照里没有该键**只证明本进程没投影到它**（可能是 `gap:'intake-link-missing'`、可能是重建后仍未覆盖、也可能是键拼错），**不能据此断言权威记录不存在**。因此回 `503` + `{error:{failure:'unavailable', category:'STALL', subcause:'receipt-not-in-snapshot'}}`，带 `Cache-Control: no-store`；**不得**回 404（那会把“查不到”说成“没有”）、不得回 200 空对象、也不得回落去查库。
4. **成功 `200` + `{ receipt }`**：body 与 `202/200` 的 `receipt` **同形同源**（同一个 `IntentReceipt`）；不另造 `status` 字符串或包装层。`status:'queued'` 时**不得**补 `outcome`；`duplicate` 字段不在此端点出现（它不是重投）。
5. **参数受限且不含秘密**：`company`/`source`/`kind` 走白名单字符集与最大长度（`company` 按公司 slug 规则；`source`/`kind` 按 §6.6 的取值域前缀校验），`dedupKey`/`ticket` 上限 256 字符、只允许 `[A-Za-z0-9._:-]`；**任一参数越界 ⇒ `422`**（`rejected_precondition`/`CONFIG_INVALID`），不落记录。查询串**不得**承载令牌、wkey、秘密值或它们的片段；令牌只走 `X-SN-Token` 头（`CLIENT_KEY_HEADER` 同口径），URL 会被日志与代理记录。
6. **`Cache-Control: no-store`（成功与失败都带）**：回执含 `bodyDigest`、`intentRef`、`unknownRef` 等内部引用，不得进共享缓存。
7. **认证与限流同 `POST /v1/requests`**：`401/403/429` 的形状与 §9.4 状态表一致；**不因是 GET 就免令牌**。

〔结论〕`GET /` 只列 **HTTP 路由**；MCP 工具目录（`studio-tools`）是**另一出口**，有自己的清单与鉴权（§11.4）——不得把两者混写成“只有三面”。

〔结论〕**HTTP 接收状态 ≠ 77 受理五值**，两层分开：

| HTTP | 语义 | body |
|---|---|---|
| `202` | 只表示“服务器收到、已入队待处理” | `{ receipt: IntentReceipt }`——**不带 `outcome`**（未判时缺省） |
| `200` | 幂等命中（同键同内容）；或 `GET /v1/requests/status` 命中快照 | 原回执 + `duplicate:true`（仅 POST 重投路径带 `duplicate`；status 端点只回 `{ receipt }`） |
| `401` | 无令牌 / 令牌缺失 | `{ error:{ failure:'rejected_authority', category:'EXTERNAL_REJECT', subcause }, traceId }` |
| `403` | 令牌无效 / 来源不允许 | `{ error:{ failure:'rejected_forbidden', category:'EXTERNAL_REJECT', subcause }, traceId }` |
| `404` | **路由不存在**（未登记的路径；Hono 的 notFound 兜底） | `{ error:{ failure:'rejected_precondition', category:'EXTERNAL_REJECT', subcause:'not-found' }, traceId }`——调用面走错，**不是**演进/版本故障（不得写 `EVOLVE_REJECT`），也**不是**“记录不存在”（那是 `Ok(undefined)`，见 `get`/回执查询） |
| `409` | 同键不同内容 | `{ error:{ failure:'rejected_idempotency', category:'EXTERNAL_REJECT', subcause:'body-mismatch' }, traceId }` |
| `413` | 请求体超 `bodyLimitBytes`（缺省 `100_000`，§6.6） | `{ error:{ failure:'rejected_precondition', category:'CONFIG_INVALID', subcause:'body-too-large' }, traceId }`；**不落记录**，**不带** `fieldPath`（不是单字段错） |
| `422` | 结构或语义不合法（缺字段、未知 kind、时间戳不合规） | `{ error:{ failure:'rejected_precondition', category:'CONFIG_INVALID', subcause }, traceId, fieldPath }` |
| `429` | 配额超限 | `{ error:{ failure:'unavailable', category:'STALL', subcause:'quota' }, traceId, retryAfter }`（秒，非负整数）；**不带 `fieldPath`**——配额不是结构错误，不抄 422 的 body |
| `503` | 下游不可用（daemon 未就绪）；回执不在快照（`subcause:'receipt-not-in-snapshot'`） | `{ error:{ failure:'unavailable', category:'STALL', subcause }, traceId }`；**不得**回 202 假装收下，也不得回 404 冒充“没有这张单” |
| `500` | **读面内部错误**（只读台账读失败、行损坏、库被替换） | `{ error:{ failure:'unavailable', category:'STALL', subcause }, traceId }`——`subcause` **原样透传** `ReadOnlyLedger`/`RecordReader` 的 `Err`（如 `ledger-read-failed`），**不得**改写成 `CONFIG_INVALID`，也不得渲染成空列表/`unknown` 段冒充“没有数据” |
| `501` | 路由未挂载（如 `/v1/events`） | `{ error:{ failure:'unsupported', category:'EVOLVE_REJECT', subcause:'unmounted' }, traceId, reason }`——**不得**空 `[]` / 空串 |

〔结论〕**错误体只有一个形状**：`{ error: { failure, category, subcause }, traceId }`（`422` 额外带 `fieldPath`，`429` 额外带 `retryAfter`，`501` 额外带 `reason`，都放在**外层**、不进 `error`）。`traceId` 不是与 `error` 并列的第三种结构；响应只暴露 `failure`/`category`/`subcause` + `traceId`，**不得漏 `failure`**、也不得把 `category` 当唯一分类。`404`/`500`/`503` 都套这同一个形状（键集合不变），因此客户端只有一条解析路径。

〔结论〕**三个易混边界不得串味**：① **记录不存在** = `Ok(undefined)`（`RecordReader`/`ReadOnlyLedger` 的 `get`），对外在回执查询上表现为 `503 receipt-not-in-snapshot`（快照没有≠权威没有）；② **路由不存在** = `404 not-found`（`EXTERNAL_REJECT`，调用面错误）；③ **读不出来** = `500`（`unavailable`/`STALL`，`subcause` 透传）。不得用同一个 HTTP 码表达两种意思，也不得把 ① 写成 ② 或 ③。

〔结论〕**破坏性变更**：现状若返回 `{ok:false, code, error}`，改为上述形状**不是兼容扩展**——客户端、面板与脚本必须同批改；**不得**静默双形状兼容（“有 `ok` 就走旧分支”）留在对外面上。M5 删旧面时一并切换，并在 82 的负向用例里锁住“缺 `failure` 即判负”。

body 的 `outcome` 用 77-§4.1 五值，**字段名与取值唯一**：`accepted` / `accepted_with_conditions` / `deferred` / `rejected` / `forwarded`（`forwarded` 带 `referredTo`）。它**只在查询回执时出现**：`202` 的 body 不带 `outcome`（daemon 相位 2 判完才写 `REC-WORK-02`，投影同时出现 `intakeRecordRef`）；**不得**用 `pending` 表示“未判”，也不得用 `conditionally_accepted`。**HTTP 202 不等于已受理**：未判时只能给 `status:'queued'`，不得伪造 `outcome:'accepted'`。

〔结论〕**HTTP 拒绝与审计分开落**：`401/403/409/422/429` 是**明确拒绝**，只写拒绝审计（类别 + `failure` + `subcause` + `traceId`），**不得**写成 `REC-EVT-03`（外部未知）——拒绝不是未知；只有“下游不可达 / 超时导致结果不明”才落 `REC-EVT-03`，且其 `unknown_scope.intentRef` **必须**指向该意图的 `REC-WORK-01.recordId`（否则回执无法归链，见 §6.6 第 4 条）；观察缺口（来源断档、投影不可读）落 `REC-OBS-02`。`503` 若已确认未提交（例如 daemon 未装配）落拒绝审计；若已发出但结果不明才落未知。

〔结论〕**视图白名单**（`public` / `partner` / `internal` 三级）：

1. 默认 `public` 只出**非个人聚合**（公司/部门/项目/汇总财务与进度）；
2. 个人详情、绩效、记忆只在 `partner`/`internal` 出现，且**不直接序列化 `PersonRef`**——只给稳定 `personId` + 展示名，不带联系方式等身份证明；
3. 伙伴凭证用**随机 credential ID**（`TS-PORT-AUTH-06`）标识，**不展示 token last4**；token 哈希同样不能当公开标识；
4. 秘密、记忆原文、审计细节不出 API（只出“有无”与引用）。

〔结论〕**错误/日志/audit 由 daemon 写**：API / 订阅 / 通知的失败一律由 daemon 落 `REC-EVT-03`（未知）或 `REC-OBS-02`（观察缺口），API 只返回脱敏后的 `failure`/`category`/`subcause` + `traceId`（**不得漏 `failure`**）；**API 不得自行 `append` 台账**（§9.5、§11.6）。

〔结论〕订阅/出站若实装，必须同时具备：**allowlist**（目的域名/频道白名单）、**SSRF 拒绝**（解析后 IP 不得落回环/私网/元数据段）、**HMAC**（密钥取自凭据目录，不进 header 明文）、**退避**（指数 + 抖动）、**死信**（重试耗尽落 `REC-EVT-03`）、**重放窗口**（`event id` + 时间窗去重）。只写“支持 SSE/webhook”不算设计。

〔结论〕**装配决策（唯一，不再保留“api 自托管 / 删 `daemon→api`”的备选）**：

1. **由 daemon 的 assembly 域装配，在 `runServe` 内同进程启动**：`apps/daemon/src/assembly/api/assemble.ts` 导出 `assembleApi(deps: AssembleApiDeps): ApiServerOptions`——**`deps` 只收 `ingress` 的 `submit`/`receipt` 两个方法，不收 `engine`**（禁止把引擎、可写 `Ledger`/`Database` 传进 API 装配；`ledgerPath` 是路径字符串）。`AssembleApiDeps`/`ApiServerOptions` 的**完整字段**见本段末代码块（`company` 是 `ApiCompanySource`、`config` 是 `ServeConfig`，不留裸名/`unknown`）。`Pick<IntentSubmissionPort, …>` 与 `Pick<IntentIngress, …>` 等价（ingress 实现该端口），且**都不含** `replayQueued`——HTTP 面在类型上就到不了启动重放。`buildServeRuntime` 在**启动第 6 步**用 `createIntentIngress(deps)` 创建 `IntentIngress`（`deps` 见 §6.6 末尾：`intake`/`engine:{ingest}`/`receipts`/`allowedSources`/`ttlMs`/`isCompanyMounted`/`bodyLimitBytes?`/`log`；`IntentReceiptStore` 由 `createIntentReceiptStore({ ledger, clock })` 造、其可写 `Ledger` 不外传），并**自己持有**返回的 `IntentIngressInternal` 供启动末 `replayQueued()`；交给 `assembleApi` 的只是它的 `Pick<…,'submit'|'receipt'>` 视图。`runServe` 完成接线后调 `assembleApi`，再 `serveApi(config.external.port, apiOptions)`，句柄并入停机通道（`close()` 随 `stop` 一起收）。装配体**自己构造**四样东西：① HTTP 适配（`api/src/http`，不再从 `panel` 取）；② `company` 纯投影（包内 import，不是回调）；③ 只读台账 `openLedgerReadonly({ path: ledgerPath, expectedSchemaVersion, readOnly: true, queryOnly: true })`（签名见 §8.2）；④ `emitIntent`/`getIntentReceipt`——**原样转发 `deps.ingress.submit`/`receipt`**（不查重、不落回执、**不得**直接 `engine.ingest`）。`daemon→api`（`boundary-rules.mjs:108`）是**真实边**，保留并在 §2.3 登记为“在用”，不再以删除为目标。装配点落在 **assembly 域**，因此不需要 `cli` 参与、也不新增 `assembly→cli`；新文件放 `assembly/api/` **子目录**，只占目录预算的“子域”，不占 `domainPlaneBaselines.assembly=1` 的直下额度。包边仍是 `daemon→api`（`daemon` 层 5 → `api` 层 4，高引低，合法）；**`apps/boot` 不 import `api`**（否则新增 `boot→api` 边，违反 §2.1 的三边与提案流铁律），boot 仍只经 `daemon/serve` 的 `runServe` 触发。

```ts
// —— API 侧的真相类型（目标；随 M1 从 panel 迁入 `@studio-next/api`，不新增 api→panel）——
interface ApiCompanySource {              // = 现 ExternalCompanySource 去掉 openLedger/platform 后的形状
  slug: string                            // 与 snapshot.slug 一致；不一致 ⇒ 500（per-request 校验，现状 :69 同口径）
  snapshotProvider: () => CompanySnapshot // **同步**、每请求现取（缓存策略归 wiring，不进 API）
  listReports?: () => readonly ReportFile[]        // 缺省 = 报表面未挂载（501 + reason，不返回 []）
  contact?: string                        // 名片联系位（契约面增字段走批示）
}

// 只读台账视图：**同步**方法（ReadOnlyLedger 本身同步），Err 原样上抛，不吞成空数组
interface IssuesView {
  ticketMirrors(company: CompanySlug): Result<readonly TicketMirrorRecord[], ClassifiedError>
  issues(company: CompanySlug, q: { state?: string; limit: number }): Result<readonly IssueView[], ClassifiedError>
  // 输入：company 已在 API 侧校验为挂载公司；limit 已 clamp 到 [1, MAX_PAGE_SIZE]；state 为可选过滤
  // 输出：只含对外字段的投影行（白名单序列化）；`Err` 由 HTTP 层映射 500（不降级为空列表）
  // 同步→async 适配：HTTP handler 可以是 async，但**必须直接 return 该 Result 的映射结果**——
  //   不得 await 一个“假异步”包装，也不得把 Err 转成 `{ok:true, issues:[]}`（那是吞错）
}

// 财务三源：都返回 Result；**“未挂载”与“读失败”是两件事**
interface FinanceSources {
  budgets(company: CompanySlug): Result<readonly BudgetRecord[], ClassifiedError>        // 预算
  eventCosts(company: CompanySlug): Result<readonly EventRecord[], ClassifiedError>      // 事件成本（event=LLM 的 cost_usd）
  monthlyReports(company: CompanySlug): Result<readonly ReportFile[], ClassifiedError>   // 月报清单（type='monthly'）
  // 未挂载（对应源不可用，例如报表面未配/未注入）⇒ 该段 `unknown` + 原因，HTTP 仍 200；
  //   **不得**补 0、不得省略该键、不得用 `Ok([])` 冒充“没有数据”
  // `Err`（库不可读/行损坏）⇒ 500 unavailable/STALL（**整段失败**，不把该段写成 unknown 蒙混）
}

interface AssembleApiDeps {
  ingress: Pick<IntentSubmissionPort, 'submit' | 'receipt'>   // 恰两方法；不含 replayQueued
  ledgerPath: string                                          // 只读打开的路径（字符串，不是句柄）
  companies: readonly ApiCompanySource[]                      // 挂载公司的 API 侧视图（assemble 用 company 包构造）
  config: ServeConfig                                         // external.port/token/requestsPerMinute/idempotencyTtlMs/bodyLimitBytes...
  // 不设 `now`：时钟只来自 BuildRuntimeOpts.clock（§3.3/§6.6），API 侧不另开时间源
}
declare function assembleApi(deps: AssembleApiDeps): ApiServerOptions

interface ApiServerOptions {
  emitIntent(intent: WebhookIntentPayload): Promise<Result<IntentSubmitResult, ClassifiedError>>
  getIntentReceipt(key: IntentKey): Promise<IntentReceipt | undefined>
  companies: readonly ApiCompanySource[]
  config: ServeConfig
  issuesView: IssuesView                 // assemble 内用 openLedgerReadonly 现构（API 自己不碰库）
  finance: FinanceSources                // 同上：三源都由只读台账视图派生
  token: string
  requestsPerMinute: number
  idempotencyTtlMs: number
  bodyLimitBytes: number
}
```

2. **`company`/`config` 不留裸名**：旧稿写的 `company; config` 无法判断是数组还是单值、是 `ServeConfig` 还是任意对象，本块把两者定死（`companies: readonly ApiCompanySource[]`、`config: ServeConfig`）。`ApiCompanySource` **不含** `openLedger`/`platform`（删除项），也不含任何“打开库/写平台”的函数位。
3. **`issuesView` 的方法名与形状必须写死**：`ticketMirrors`/`issues` 两个命名方法、输入输出如上；**不得**让调用方传 `openLedger` 回调、也不得在 API 里 `import` `store`。同步→async 的适配只发生在 HTTP handler 边界（取值 + 映射状态码），**不得**改成“先 await 再判空”。
4. **`finance` 三源缺一即 `unknown`**：`/v1/finance` 的响应里预算/成本/月报三段各自可 `unknown` + `reason`（`FinanceSources` 的“未挂载”分支），**不补 0**；任一源 `Err` 整段 500（不静默降级）。`buildFinanceSnapshot` 仍是 `company` 的**纯函数**（吃三组行、吐视图），不在本块里做 IO。
5. **时钟不在这里**：`quota`/`expiresAt`/TTL 的可确定性测试只经 `BuildRuntimeOpts.clock` 注入；`ApiServerOptions` **不设 `now`**，也不读 `Date.now()` 之外的第二个源。
6. **HTTP 适配归 api 自己**：`listenHono`/`ListenHonoOptions`/`HonoShellHandle` 下沉为 `api/src/http/`，只依赖 `node:http`，**不从 `panel` 取、也不由 `panel` 注入实现**。`panel` 的 `:8791`/`:8789` 保留它自己的薄壳——`panel→api` 不是允许边，两份实现是允许边表的代价；两份的行为差异（`CLIENT_KEY_HEADER` 由 socket 注入、`onClose` 链）进 81 的对齐清单与 82 的负向用例。
7. **纯投影归 `company`**：`buildOrgTree`/`buildProgressSnapshot`/`buildFinanceSnapshot` 下沉为 `company` 的纯函数（零 IO、零 Hono）。**前置**：这三个函数依赖的 `dayKeyOf`/`DAY_MS` 现在长在 `panel/src/views.ts:313`/`:321`，必须先移到 `contract`（M1），否则 `company` 要反向 import `panel`——那会新增 `company→panel` 的非法边。移动**只换宿主，签名与行为不变**：`dayKeyOf(ts: number): string` 仍是 UTC 日键（现状 `Math.floor(ts / DAY_MS)`），`DAY_MS` 仍是 `86_400_000`；需要“公司本地日”的投影必须**显式传时区/偏移参数**（新增参数位），**不得**把既有 UTC 语义悄悄改成本地时区，也不得在 `company` 里读系统时区。`api→company`（`:123`）与 `panel→company`（`:120`）都已在允许边内，因此**不新增 `api→panel`**，也不需要“把 panel 的视图当回调塞进来”。
8. **启动失败语义分两态，不得混写**（这是“关闭”与“开启但缺件”的区别）：
   - **配置关闭**（`ServeConfig.external` 缺失或 `enabled=false`，目标键；现状无此键）：`:8788` 整个面**不启动**，daemon 照常运行，日志明写“对外 API 未启用”。这是“没开”，**不是**降级，也不算失败。
   - **配置开启**：装配体内所有必填项必须就绪才启动。缺 `emitIntent` 或只读台账 ⇒ `configInvalid(...)`，**整机拒启动**（`runServe` 抛错退出）——不得“daemon 起来、只把触发面关掉”，因为信息面与触发面共用同一装配体，半起等于把“未接线”伪装成“没数据”（§9.5/§9.6）。
   - **独立进程**（将来另审）：允许触发面 503、信息面保留；那是另立卷的部署契约，**不是**本卷默认，也不得用“缺注入就降级”来实现。
9. **独立进程只是另审部署选项**：若将来要 `api` 自起进程，必须先有 daemon 侧意图入口（回环 + 令牌 + 幂等键），且**不得**以“API 直写台账/直写平台”替代该入口。默认部署是 `runServe` 内同进程装配；`cli/external` **最终退役**（或只打印“请用 `studio-next serve`”的迁移指引），不独立启动触发面。

〔结论〕迁移顺序（五步，顺序写死，不可倒）：

| 步 | 动作 | 门禁 |
|---|---|---|
| M1 | **下沉**：`dayKeyOf`/`DAY_MS`（`panel/src/views.ts:313`/`:321`）→ `contract`，`panel` 保留 re-export 过渡；`buildOrgTree`/`buildProgressSnapshot`/`buildFinanceSnapshot` → `company`（改从 `contract` 取日期助手）；`listenHono` 一族 → `api/src/http/`。`panel` 改为从 `company`/`contract` 取，`api` 直接用 `company` | 纯移动，不改行为，不改日期语义与时区；`bun run guard:boundaries` 仍绿；`api→panel` 与 `company→panel` 都不存在 |
| M2 | `api` 接管路由：把 `external/{server,views}.ts` 的逻辑搬为 `createApiApp(opts)` + `serveApi(port, opts)`；**不动** `panel` 的 `"./external"` 导出，旧面继续对外 | 此阶段新面**零生产调用方**（只有测试直调）；同一端口不得新旧两套同时监听 |
| M3 | **装配上线**：新建 `assembly/api/assemble.ts`，由 `runServe` 调用并 `serveApi`；`emitIntent`/`getIntentReceipt` 转发 `IntentIngress.submit`/`receipt`（不直引 `engine.ingest`），`issuesView` 用 `openLedgerReadonly` 现构；`cli/external` 同时退役（或只打印迁移指引），不再起 `serveExternal` | **前置：§8.2 D12 的“只读打开不跑 DDL”先落地**——否则 daemon 内起的 API 仍会触发 `migrate`，M3 的“只读”是假的，不得宣称迁移已绿；`daemon→api` 由此成为真实调用，不得“先删边再调用” |
| M4 | **验证**：信息路由、认证（`X-SN-Token`）、配额、幂等键、触发面回执、未知来源 fail-closed、**启动两态（关闭=不启动面 / 开启缺件=整机拒启）**、**投影启动序（`rebuild` 失败即拒启，重放只在重建后跑）**、**请求体超限 `413`** 逐条核对 | 未全绿不得进入 M5；验证项见下表；`rebuild` 失败仍起服、或重放跑在重建之前，都判负 |
| M5 | **删除旧面**：删 `panel/src/external/` 与 `panel` 的 `"./external"` 导出 | 破坏性变更，须批示 + 82 波次；**必须最后**，且不得早于 M3/M4——M3 改线之前删旧面=断服 |

〔事实〕`ApiServerOptions` 的**注入项与包内依赖**（配置开启时缺必填注入项 ⇒ 整机 `CONFIG_INVALID`，见装配决策 8）：

| 字段 | 归属 | 来源 | 缺省 |
|---|---|---|---|
| `emitIntent(intent: WebhookIntentPayload): Promise<Result<IntentSubmitResult, ClassifiedError>>` + `getIntentReceipt(key: IntentKey): Promise<IntentReceipt \| undefined>` | **注入项（必填）** | 由 `assemble.ts` 从 `deps.ingress` **原样转发**（`IntentIngress.submit`/`receipt`）；`assemble.ts` 只做转发，不查重、不落回执、不持引擎 | 无缺省；缺 `ingress`（或 `submit`/`receipt` 非函数）⇒ 整机 `CONFIG_INVALID` |
| `companies: readonly ApiCompanySource[]`（`slug` + `snapshotProvider` 必填；`listReports?`、`contact?` 保留；**不含** `openLedger`/`platform`） | **注入项（必填数组）** | `assemble.ts` 用 `company` 包构造；报表走 `listReports`，名片走 `contact`。类型定义见本节 `ApiCompanySource` 代码块（不是 `unknown`、也不是 `ExternalCompanySource` 原样） | 数组与每项必填键无缺省；`listReports`/`contact` 未配 = **该面明说“未挂载”**（`unknown`/501 + 原因），不得返回 `[]`/空串冒充“没有” |
| `config: ServeConfig` | **注入项（必填）** | `assemble.ts` 收到的同一份已解析配置（**不再二次解析 YAML**，§3.4 第 7 条判别联合） | 无缺省；`external.*` 缺键 ⇒ `CONFIG_INVALID` 整机拒启（下表“token 三件”） |
| `issuesView: IssuesView` | **注入项（必填）** | `assemble.ts` 内用 `openLedgerReadonly` **现构**（**不由 `cli` 注入**；API 自己不碰库）。方法名与输入输出见上方代码块：`ticketMirrors(company)` / `issues(company, { state?, limit })`，均**同步**返回 `Result` | 无缺省。**`CONFIG_INVALID` 只给 `ledgerPath` 缺失/非字符串**；只读打开失败**原样上抛** `openLedgerReadonly` 的 `Err`（`unavailable`/`db-missing`、`rejected_version`/`schema-behind`\|`schema-ahead` 等，§8.2），**不得**改写成 `CONFIG_INVALID`、也不得降级成空视图冒充“没有单”；方法级 `Err` ⇒ HTTP `500`（`unavailable`/`STALL`，`subcause` 透传） |
| `finance: FinanceSources` | **注入项（必填）** | 同 `issuesView` 的只读台账视图派生：`budgets(company)` / `eventCosts(company)` / `monthlyReports(company)`，均返回 `Result` | 三源“未挂载” ⇒ 该段 `unknown` + 原因（HTTP 200）；任一源 `Err` ⇒ `500`（不把读失败写成 `unknown`）；**不得**补 0 |
| `token` / `requestsPerMinute` / `idempotencyTtlMs` | **注入项（必填，无运行期缺省）** | `assemble.ts` 从 `ServeConfig.external` 读（目标键，现状无） | **缺任一 / 空串 / 非正整数 ⇒ `CONFIG_INVALID` 整机拒启**（§3.3 第 5 条）。**没有**“`token` 未配 = 触发面全 401”这条运行态：`401` 只判请求带来的令牌，配置缺件走拒启 |
| `now`（时钟） | **不是 `ServeConfig.external` 的键，也不是 `ApiServerOptions` 的注入项** | 只来自 `BuildRuntimeOpts.clock`（`buildServeRuntime({ clock })`），透传给 `IntentReceiptStore`/ingress；API 侧不另收时钟 | 缺省墙钟（仅开发）；不得用 `process.env` 或第二个时钟源覆盖 |
| `eventsSource?`（SSE 的事件流 + 游标读面） | **注入项（目标）** | 订阅面实装后由 `assemble.ts` 注入（`api` 不碰库） | 未实装前 `/v1/events` **维持 501 并带“未挂载”原因**；实装后转为**必填**，缺配即 `CONFIG_INVALID`，不得返回空流冒充“无事件” |
| `listen?(app, port, opts)` | **注入项（可选覆盖）** | 缺省用 `api/src/http/` 自带实现 | 缺省=自带；注入仅用于覆盖 `hostname`/`onClose` |
| `views: { orgTree; progress; finance }` | **包内依赖，不是注入项** | `api` 直接 `import { buildOrgTree, buildProgressSnapshot, buildFinanceSnapshot } from '@studio-next/company'` | **编译期依赖**，不进 `ApiServerOptions` 的运行时校验；**不得**改成可选回调。`buildFinanceSnapshot` 吃的是 `finance` 三源给的行（纯函数，零 IO）；**不得**让它自己去开库 |
| ~~`openLedger`~~ / ~~`platform?: ExternalPlatformWrite`~~ | **删除** | — | API 不碰库、不碰平台；残留这两项就是把越界写留在类型面里 |

〔结论〕`POST /v1/requests` 的写纪律：现状是“落单 + 幂等键”，但**落单写台账**与“daemon 唯一写入者”存在冲突（`panel/src/index.ts:67` 已把它列为待批示，`external/server.ts:487/:491` 是那两处写）。

- **唯一实现**：API 只产 `WebhookIntentPayload`（`TS-PORT-API-01`），经 `ApiServerOptions.emitIntent` 交 daemon；写台账与落单都由 daemon 在相位 2 消费意图时完成；API 进程**不碰任何库**、**不碰平台**。这条同时消掉 §9.1 的两处待迁移违例。
- **`emitIntent` / `getIntentReceipt` 是装配体对 `IntentSubmissionPort.submit` / `receipt` 的实现**（不再有两套语义不同的名字）：装配体把它们**原样转给 `deps.ingress`**，自身不查重、不落回执、不碰库、**不持 `engine`**。`getIntentReceipt` 读的是**本进程已提交投影的内存快照**（启动 `rebuild` 建好、commit 后同微任务增量更新），不是查 SQLite、也不是读权威记录；因此 `undefined` 只表示“快照里没有该键”，不得当成“库里没有”用于入队或重放判定（§6.6 规则 5/8）。`IntentIngress.submit` 的顺序见 §6.6（`WorkIntake.reserve` 落 `REC-WORK-01` → 刷新投影 → `engine.ingest` → 返回），记录与回执的唯一写口都在 daemon 侧。
- **崩溃与重投**：`reserve` 之后、`ingest` 之前崩溃 ⇒ 投影行已是 `queued` 且 `intentRef` 在；重启时由 `buildServeRuntime` 在启动末调 `IntentIngressInternal.replayQueued()` **重新入队**（同一 `REC-WORK-01` 幂等，不重复物化；`replayQueued` 不对 HTTP 暴露）。同键不同摘要 ⇒ `rejected_idempotency`（409，**仅去重窗内**）；`status:'unknown'` 先对账、**不自动重放**。去重窗默认 24h（目标配置项），到期后同键可另立新意图并经 `lineage.supersedes` 链旧 `recordId`。
- **不得**直接 `launch` worker，也不得直接 `platform.issues.create`。外部请求最多到“受理结论”为止。
- 若制作人另审批准“API 拥有独立 `requests` 表”的独立进程方案（**非默认**，本卷不实现）：那仍是第二写入者与第二事实源，须单独立卷写明可重建性、对账口径与退役路径，且不得取代 daemon 的意图入口。

〔结论〕**意图通道现状（U80-15）**：`emitIntent` 的目标形态是 `Result<IntentSubmitResult, ClassifiedError>` + 可查询回执（`TS-PORT-API-01`），落点是 **`IntentIngress.submit`**：`WorkIntake.reserve`（在一个写事务里追加 `REC-WORK-01`，立即给 `intentRef`）→ `IntentReceiptStore` 刷新投影 → `engine.ingest([intent])`（`void`，只入内存队列）→ 返回回执。**先记录、后投影**；回执由 ingress 投影，不由 API、不由装配体补。但 **daemon 内这条装配本身尚未落地**——`assembly/api/assemble.ts`、`IntentIngress`/`IntentReceiptStore`、`WorkIntake.reserve`、`intent_receipts` 表均不存在、`ServeConfig.external` 也无此键。**独立进程部署**所需的回环入口（令牌 + 幂等键 + 独立进程侧的 503 降级）仍是未证项，另卷另批。配置开启而 `ingress` 缺位 ⇒ `CONFIG_INVALID` **整机拒启**（不是“只关触发面”）；**不得**退回直写 `daemon_kv` 或直写平台。

〔结论〕M4 的验证项（每项给命令或断言，未过不得删旧面；**共 11 项**——旧稿 10 项，新增第 11 项为回执查询端点）：

1. 信息面 **9 条 GET**（`agent-card`/`company`/`org`/`people`/`projects`/`issues`/`finance`/`reports`/`requests/status`；`/v1/events` 归订阅面另计）与旧面逐字段一致（白名单序列化，不泄露内部字段）；
2. 认证：无令牌 401、坏令牌 403、配额超限 429（`X-SN-Token` 与 `CLIENT_KEY_HEADER` 的注入链）；
3. 幂等：同 `idempotencyKey` 重放只产生一个意图；内容不同 ⇒ `rejected_idempotency`；
4. 触发面：回执只到“已受理待转交”，不含平台单据号（落单在 daemon 侧）；
5. 未知来源与未挂载面 fail-closed，不返回空对象；
6. `/v1/events` 仍是 501 占位，不得因迁移变成 200 空流；
7. **启动两态**：配置关闭 ⇒ `:8788` 无监听（`lsof -i :8788` 为空），daemon 正常跑；配置开启且缺 `ingress`（或 `submit`/`receipt` 非函数）或只读台账 ⇒ `runServe` 抛 `configInvalid`、进程非零退出，**不得**起一个“只有信息面”的半面；
8. **只读证据**（§8.2 D12）：`:8788` 面打开的句柄 `PRAGMA query_only=1`；启动前后 `user_version` 与表集合不变（即未跑 DDL）。D12 未落地时此项必红，不得据此宣称迁移已绿；
9. **提交回执**：`202` 的 body **只有** `{ receipt }`，**不带 `outcome`**；`getIntentReceipt(key)` 能查到 `status:'queued'` + `intentRef`；daemon 判完后查询给 `status:'decided'` + `outcome` 五值之一 + `intakeRecordRef`（`REC-WORK-02`）；同键同摘要重投 ⇒ `200` + `duplicate:true`（`queued` 情形须重新入队、`decided` 情形不入队）；同键不同摘要 ⇒ `409 rejected_idempotency`；`unknown` 先对账、不回 202 冒充新收；**不得**伪造 `outcome:'accepted'`，也不得用 `pending` 表示未判；
10. **路由覆盖**：**16 条**路由逐条核对——**10 条读面**（`agent-card`/`company`/`org`/`people`/`projects`/`issues`/`finance`/`reports`/**`requests/status`**/`events`，其中 `/v1/events` **按订阅面**计且必须 `501` 带原因）+ 4 条触发（`requests`/`explore`/`tasks`/`intel`）+ `/v1/subscriptions` + `GET /` 索引 = 16（§9.4 计数口径唯一；旧稿“15 条”漏了回执查询，**以 16 为准**）；`/v1/finance` 缺预算或月报源时该段 `unknown` 且写原因，**不得补 0**；计数不得再写成 12/13/15，也不得把 MCP 工具目录算进这 16 条。
11. **回执查询端点 `GET /v1/requests/status` 的正反用例**：
    - **正**：`POST /v1/requests` 得 202 后，用同一 `company/source/kind` 与 `dedupKey`（或 `ticket`）查 status ⇒ `200`、`receipt.status='queued'`、`intentRef` 与 202 回执**同值**、**无 `outcome`**；daemon 判定后再查 ⇒ `status:'decided'` + `outcome` 五值之一 + `intakeRecordRef`；`ticket` 与 `dedupKey` 同时给时按 `ticket ?? dedupKey` 取第四槽位（两种查法命中同一条）；
    - **反**：快照没有该键 ⇒ `503` + `subcause:'receipt-not-in-snapshot'`（**不得** 404、不得 200 空对象）；快照未含但权威记录存在（构造 gap 行）⇒ 仍是 `503`，**不得**回落查库；`dedupKey` 缺失/超 256 字符/含非法字符 ⇒ `422`；参数里出现令牌/wkey/秘密片段 ⇒ 拒绝（且日志不记原值）；无令牌 ⇒ `401`、来源不允许 ⇒ `403`；`/v1/requests/stats`（拼错路径）⇒ `404 not-found`（`EXTERNAL_REJECT`），不是 503；
    - **不重放**：连查 3 次不得产生新的 `REC-WORK-01`、不得触发 `replayQueued`（可用 `intentRef` 不变 + 记录行数不变断言）；
    - **缓存**：成功与失败响应都带 `Cache-Control: no-store`。

### 9.5 读投影与写网关的两条硬纪律

〔结论〕**读投影只读**：

1. 面板/概览/API 的读路径不得调用 `platform.*` 的写方法，也不得 `ledger.append*`；
2. 投影可重建；重建不得改变事实；
3. 读路径的失败不得写事实（只能写 `REC-OBS-02`，且该写入由 daemon 承担）。

〔结论〕**写只经网关**：

1. 任何对平台/外部系统的写，必须经 `EffectGateway`（内核 `gateWrite`）；
2. 控制面自身的写也过网关（现状 `wireWorkerKeys` 用 `CONTROL_TICKET` 实例，`serve.ts:809`）；
3. 网关拒绝即拒绝，不得“失败后直调原 platform”（现状 `gated-platform.ts` 已按此实现）；
4. 网关的 `signed.body` 不改写正文（`:89`），署名由 daemon 身份注入。

### 9.6 “未知不显示为 0 / 空 / 绿”

〔结论〕三个面的统一显示规则：

| 六态（77-§9.2） | TS 字面量 | 必须附带的证据 | 禁止 |
|---|---|---|---|
| 已观察 | `observed` | 来源 + 观察时间 | 显示 0 / “无数据” |
| 已推导 | `derived` | 规则版本 + 输入引用 | 冒称直接观察 |
| 未知 | `unknown` | 未知的原因（来源不可达 / 未读） | 显示 0 / 空 / 绿 |
| 陈旧 | `stale` | 最后可信时间 + 新鲜度窗 | 显示绿 |
| 冲突或受损 | `conflict` | 并列双方原值 + 各自来源 | 取其一静默 |
| 缺口或中断 | `gap` | 最后可信游标 + 缺什么 | 补零 / 当完整 |

注意：`partial` 是 77-§11.1 的**失败/结算分类**（“部分成功且已知哪部分”，如 §6.4 的结清部分完成、§6.6 的 `EffectOutcome` 经 `Err(partial)` 返回），不是六态之一；显示层必须把它翻成 `gap`/`conflict` 并附范围，不得直接当状态字面量透出。

〔事实〕现状 `/api/health` 返回 `ok: true`（`panel/src/server.ts:176`），无量态；`buildDashboardSnapshot` 也不带六态。这是目标态要补的第一处。

---

## 十、目标结构债与迁移约束

### 10.1 `src/index.ts`：从横幅到组合根

〔事实〕36 行横幅 + `process.exit(0)`（`apps/daemon/src/index.ts:24`–`:36`）；同时是包 `"."` 导出。

〔结论〕按 §3.2 的**唯一收敛方案**，迁移顺序（不可倒）：

1. 先删 `apps/daemon/package.json` 的 `main` 与 `exports["."]`，并把根 `"daemon"` 脚本与 `apps/daemon` 的 `scripts.start` 改指 `cli/main.ts serve`——此时 `index.ts` 已不是任何人的入口；
2. 再把 `index.ts` 收敛为**纯再导出**（只导出 `assembly/serve.ts` 的装配面，无副作用，不从 root 导出 `engine`/`cli`）；
3. 最后确认全仓零 import 包根后，**退役 `index.ts`**；`daemonSrcRootFiles` 只允许这一散文件，退役后根平面为空格，须同步改 guard 基线（属提案流）。

〔结论〕顺序不可倒：先改 `index.ts` 会让 `import '@studio-next/daemon'` 在过渡期同时“有副作用”和“被当 API”，比现状更糟；先删包根则一步切断误用面——而这正是本项的主要收益（现无包根消费者，删除是**防未来误用**，不是修现存故障，见 §3.1）。

### 10.2 `EngineConfig` / `Inflight` 的类型环

〔事实〕`engine/merge/merge-run.ts:84` `import type { EngineConfig, Inflight } from '../engine.ts'`；`engine/merge/merge-lease.ts:17` 同；而 `engine.ts:635` 的 `Inflight.mergeRun` 用内联 `import('./merge/merge-run.ts').MergeRunContext` 反向引用。

〔结论〕这是一个**类型级环**（无运行时环，因为都是 `import type`）。它不致命，但阻碍 `engine.ts` 拆分：任何拆出的 `tick/*.ts` 若 import `Inflight`，就会与 `engine.ts` 形成环。

〔结论〕唯一解法（须在拆 `engine.ts` 前完成）：抽 `engine/tick/types.ts` 为**叶子模块**（零 import 自 `engine.ts`），在其中定义 `EngineConfig`、`Inflight`，并把 `MergeRunHost`（**真实名字**，现 `export interface MergeRunHost` 于 `engine/merge/merge-run.ts:129`；文档不得另造 `MergeHostView`）一并移入；`engine.ts`、`merge-run.ts`、`merge-lease.ts`、`merge-fallback.ts` 统一从它 import，并删除 `engine.ts:635` 的内联 `import()` 类型。不采用“把 `Inflight` 换成 `MergeRunHost['inflight']` 元素类型”的替代做法——它让 `merge-*` 依赖一个为合并场景裁过的结构性视图，等于把通用类型藏进特化类型里，拆 `tick/*.ts` 时还要再改一次。

验收口径（冻结）：`rg "import\('\./merge/merge-run" apps/daemon/src/engine` 必须为空；`engine/tick/types.ts` 的文件头 import 里不得出现 `engine.ts`。

### 10.3 `engine.ts` 拆分：tick / dispatch / harvest / breaker + 薄 facade

〔事实〕2337 行，`lineBaseline` 2337；域平面 `engine/` 直下 13 个文件，基线 13（顶格）。

〔结论〕拆分目标（组件级）：

| 组件 | 内容 | 落点 | 约束 |
|---|---|---|---|
| `tick` | 七相位编排、`TickReport` 组装 | `engine/tick/` 子目录 | 只编排，不实现动作 |
| `dispatch` | `executeDispatch`、预算、wkey、launch、失败释放 | `engine/dispatch/` | 不含收割 |
| `harvest` | `harvestOne`、泵流、`finalizeHarvest`、`failHarvest`、STALL 响置 | `engine/harvest/` | 只收材料（§7.4） |
| `breaker` | 连击、熔断、半开、冷却 | `engine/breaker/` | 纯计数可测 |
| facade | `createEngine` + `Engine` 接口，转发到四组件 | `engine.ts` 保留 | 行数必须显著下降（目标 < 600，属**下降**，可随任意提交办） |

〔结论〕拆分是**纯移动 + 类型抽离**，不得顺带改语义。每一步之后 `bun run guard:boundaries` 必须仍绿；域平面基线在拆完后**下调**（只减不增）。

### 10.4 `serve.ts` 拆分：config / runtime / run

〔事实〕1627 行；`assembly/` 直下 1 个文件（基线 1，顶格）。

〔结论〕三件：

| 组件 | 内容 | 落点 |
|---|---|---|
| `config` | `ServeConfig`、`DEFAULT_SERVE_CONFIG`、`parseDaemonConfig`、`coerceServeConfig` | `assembly/serveconfig/`（已有同目录，扩为多文件） |
| `runtime` | `buildServeRuntime`、`ServeRuntime`、各 `wire*` | `assembly/runtime/` |
| `run` | `runServe`、`RunServeOpts`、循环、信号、停机、回执 | `assembly/serve.ts` 保留为入口 |

〔结论〕`RunServeOpts` **已经存在**于 `assembly/hrsync/run-serve-opts.ts`（§3.4），拆分第一步不是“给它起名”，而是**补齐并收口**：补 `notifyBroadcast`，再让 `runServe` 第二参数、`buildServeRuntime` 第三参数、`BootOptions.serve` 三处引用它（`BuildRuntimeOpts = RunServeOpts & {…装配件/测试注入…}`，`BootOptions.serve` 用 `Pick` 或直用 `RunServeOpts`）。否则三份内联匿名类型会随拆分散进三个文件，各自演化。

### 10.5 `hot-reload.ts` 拆分：指纹 / 通道 / 执行 / 事件

〔事实〕624 行，`control/` 直下 2 个文件（基线 2，顶格）。

〔结论〕拆成 `control/hot-reload/fingerprint.ts`（stat+mtime 指纹）、`channel.ts`（控制面请求/回执）、`execute.ts`（重装载）、`event.ts`（`RELOAD`/`SCHEMA_EVOLVE`/`ESCALATE` 落账）；`hot-reload.ts` 留 facade。`control/` 直下仍 2 个文件（`hot-reload.ts` + `stop-channel.ts`），平面不增。

### 10.6 超限件与错位件清单

〔事实〕实测 > 600 行的第一方 `src` 文件（含 `lineBaseline` 现值）。本表覆盖**全部 `src` 下**超限件；其中 `src` 下的测试件（`boot.test.ts`）照列但按**测试件**计入基线分类；`test/` 目录下的 10 条基线不在本表（见 §10.7 与 §0.4）：

| 文件 | 实测 | 基线 | 处置方向 |
|---|---|---|---|
| `apps/daemon/src/engine/engine.ts` | 2337 | 2337 | §10.3 拆 |
| `apps/boot/src/boot.test.ts` | **635** | 645 | **测试件**（位于 `src` 下、被根 `tsconfig` include）；两面测试叠加所致，随 217/219 波次拆分，不得再长。**实测已由 645 降到 635**（2026-10-27 复核 `wc -l`）；`scripts/guards/boundary-rules.mjs:161` 的 `lineBaseline` 仍登记 645——基线是**上限**，实测低于基线不触发红，但**不得**反向把文档写成“已合规”：600 的阈值未变，635 仍超限 |
| `packages/store/src/ledger.ts` | 1683 | 1684 | 按“表族”拆：events / work / company / budget / hr / jobs / candidates / reports |
| `apps/daemon/src/assembly/serve.ts` | 1627 | 1627 | §10.4 拆 |
| `packages/company/src/repo-validate.ts` | 1021 | 1021 | **留 `company`**：按“目录规则族”在本包内拆（字节/路径/归档/纯配置校验各一件）；不下沉 `core`——`core` 只承担 `RuleProfile` 求值，不接管目录校验 |
| `packages/company/src/dependencies.ts` | 775 | 775 | 依赖图分析拆出纯函数 |
| `packages/adapters/src/dsh.ts` | 758 | 758 | 账目面（usage 四桶）拆出 |
| `packages/taiga/src/testutil.ts` | 693 | 723 | 测试工具，可留；不得再长 |
| `packages/panel/src/views.ts` | 662 | 662 | 视图按 tab 拆 |
| `packages/panel/src/overview/views.ts` | 629 | 629 | 同上 |
| `apps/daemon/src/control/hot-reload.ts` | 624 | 624 | §10.5 拆 |
| `packages/company/src/validator.ts` | 612 | 655 | 规则体已部分拆出（`type-inbox.ts`）；继续 |
| `packages/store/src/records.ts` | 606 | 606 | 与 `ledger.ts` 同批拆 |

〔结论〕拆分只许**下降**，下降可随任意提交顺带办（不需要提案）；**上升**或新增基线必须提案流 + 制作人批。任何“先加后拆”的叠加态都会被 `guard:boundaries` 判红。

〔结论〕`panel → company` 的运行时依赖（§2.3）与 `api` 的装饰性依赖（`package.json` 有 `hono`/`mcp-server`/`company`/`store` 而 `src` 为空）属**清单债**，处置已定：

- `panel → company`：按 **79-§10.1 第 1 条裁决移入 `dependencies`**（现状 3 处 `src` import：`external/server.ts:45` 的 `SLUG_RE`、`overview/reports.ts:29`、`overview/server.ts:59`，运行期确需 company）。移入 prod **不改变运行加载面**（只是分类归正），因此不触发 §2.3 的“新增包边”判定；也不以下沉 `SLUG_RE` 为默认路径——那会把小常量放大成一次跨包重构。
- `api`：保留到迁移 **M2** 完成；在此之前 81 必须标“骨架期依赖”，不得据此声称 api 已具备服务器能力。

〔结论〕`lineBaseline` 共 **22 条 = 12 条非测试件 + 10 条测试件**（`apps/boot/src/boot.test.ts` 虽在 `src` 下，按测试件计入后者）。两条统计线索不同，不得混称：`maxLinesPerFile=600` 与 `maxFilesPerDirectory=25` 对 `src` 与 `test` 一并生效（`scopeDirs=["apps","packages"]` 递归扫两棵树）；而根 `tsconfig.json` 只 `include` `apps/*/src/**` 与 `packages/*/src/**`，**测试文件不进 typecheck**（79-D10）——那是另一道门禁，不能反过来推出“测试不受尺寸约束”。

### 10.7 目录预算

〔结论〕25 件上限在 `src` 面最紧的是 `cli`：直下 **22 个文件**，另有 `main.ts` 里 **18 个命令**分支（init / gen-templates / company / validate / ledger / candidates / jobs / sandbox / cutover / gray / postmortem / panel / overview / external / serve / taiga-cure / reload / stop，外加 help/version）。三者关系要分清：**文件数 22 未顶格（余 3），命令数 18 与文件数不同轴**。后续新增 CLI 命令必须：

1. 一命令一模块（现状已是）；
2. 达到 24 时先合并“同族薄壳”（如 `help`/`usage`），或把子命令族下沉到子目录（子目录不占直下额度）；
3. 不得把命令塞进 `main.ts` 的 `switch` 里绕过上限——`switch` 只做分派，不承载命令实现。

〔事实〕`apps/daemon/test/engine` 直下 **25 个文件 = 24 个测试 + `crash-points.ts`**（注入点定义），**16 个子目录**；与 `maxFilesPerDirectory=25` 顶格。`apps/daemon/test` 总体 **86 个 `.ts` = 85 个 `.test.ts` + `crash-points.ts`**。**测试目录同样在 `guard:boundaries` 的扫描范围内**（`scopeDirs=["apps","packages"]` 递归扫 `src` 与 `test`），因此新增测试**不得**再落到 `test/engine/` 直下，只能进既有子域（`test/engine/<子目录>/`）或新建子域。不要把“测试不进 typecheck”（79-D10，根 `tsconfig.json` 只 include `src`）误读为“测试不受目录预算约束”——那是两道独立门禁，前者管类型，后者管尺寸。

〔事实〕崩溃注入不是 85 个文件：它是**单个** `apps/daemon/test/engine/crash-injection.test.ts`，按 `SN_CRASH_POINT` 依次覆盖 §8.7 的五个现状点；85 这个数是 `test` 下 `.test.ts` 的总数，两者不得混称。

---

## 十一、安全、秘密、路径与凭据

### 11.1 凭据 ≠ 授权

〔结论〕四个层次必须分开，任何一层都不得顶替另一层：

| 层 | 回答什么 | 承载 | 不能证明 |
|---|---|---|---|
| 公司权源 | 谁有权让谁做什么 | `REC-AUTH-01/02/03`、`AuthorityActivation` | 技术可用性 |
| 凭据 | 这次调用凭什么被技术边界接受 | `WkeyClaims`、`TaskBrief.credentials`、`REC-AUTH-04` | 有权做这件事 |
| 围栏 | 谁是最新写者 | `FenceToken`、`REC-AUTH-06` | 写入内容正确 |
| 能力 | 环境能做什么 | `CapabilityProbe`、`ExecutorCapabilities` | 已获授权 |

〔结论〕类型不能证明权限：`WkeyClaims.scope` 是数组，数组里有 `comment` 不代表调用方有权评论；权限判定在网关的 `verify`（签名/吊销/过期/单号/scope/nonce）与公司权源两侧，两者都要成立。

〔结论〕**网关在构造期验，验过才消费 nonce**。目标 `createGateway(opts)` 必须把坏输入挡在构造期，而不是带进签名路径：

1. 构造期只校验 `ctx` / `author` / `gatewaySecret` 的形状与权限边界；`nonce` 是**逐次签发时的输入**，不是构造参数。签发时 `claims.nonce` 缺失或形状不合法同样 `Err(rejected_precondition)`，不得“构造成功、运行期再猜”；
2. `revoke(ticket)` 的 `ticket === ''`、纯空白、非字符串 → `Err(rejected_precondition)`。空串**不得**被解释为“撤销全部”，也不得返回 Ok 却什么也没做；
3. 顺序冻结：**先校验** origin / scope / ttl / author / nonce 形状与吊销集，**再消费** nonce。校验失败不得消耗 nonce（否则坏签名即可烧掉合法 nonce）；nonce 消费与审计写必须成对，消费失败不得落“已验证”审计；
4. `nonce` 存储与 `clock` 必须可注入（缺省内存 + 墙钟，仅单进程开发可用）；跨进程防重不得依赖进程内 `Map`（§8.5 围栏、§11.4.1 工具面同理）；
5. `author` 取自**已授权身份**（`AuthorityActivation` / `REC-AUTH-*` 的解析结果），不得取自请求体自报字段；`WkeyClaims.author` 与授权身份不一致即拒。服务身份也必须是有明确授权边界的逻辑主体：`EffectCredentialBroker` 从当前激活/授予解析 `author`，`SignatureContext.actingCapacity` 用 `service` 表示服务主体，不得把 `'daemon'` 当作无需授权的通用身份或绕过 `REC-AUTH-04.bound_grant` 的依据；
6. 秘密不进错误：`gatewaySecret`、签名材料、nonce 原值不得出现在 `Result` 的 `E`、日志或错误 `message` 中；只给类别/子因/字段名与脱敏后的键标识（§5.8）。

〔结论〕**目标凭据类型必须同时覆盖高层效果与实际网关动作**（现状 `WkeyClaims.scope` 只有六个 `GatewayAction`，是待迁移事实）：

```ts
interface WkeyClaims {
  ticket: TicketId
  scope: readonly EffectAction[]   // GatewayAction ∪ CONTROL_EFFECT_ACTIONS；签发方收窄
  ttl: string
  nonce: string
  author: PersonId                 // 必填：已授权身份；现状缺此键是迁移缺口
}
interface VerifiedWkey {
  ticket: TicketId
  scope: readonly EffectAction[]
  exp: number
  nonce: string
  author: PersonId                   // 验签后仍保留授权主体，供署名核对
}
interface WkeyVerifyCheck {
  now: number
  ticket?: TicketId
  action?: GatewayAction           // 实际 @action 动词
  effectAction?: EffectAction      // 高层效果类型；高层效果路径必须同时给
  author?: PersonId                // 与授权身份核对，不能自报
}
```

- 目标内核签名为 `gateWrite(token, action, payload, options?: { effectAction?: EffectAction }): GateWriteResult`。第四参只在高层效果路径传入；内核把它连同实际 `action` 与已授权 `author` 交给 `verify`，不得另开“只验低层 action”的旁路。stdio 每次实际写仍使用 scope 收窄的一次性 key，第四参不放宽其动作范围。
- `issue` 必须同时给 `scope`、`author` 与 `nonce`；缺 `author` 或 scope 为空即拒。`verify`/`verifySealed` 若给 `effectAction`，除原有 `action` 检查外，还要求 `claims.scope` 同时包含该 `effectAction` 与对应的 `action`；只含 `comment` 不能自动获得 `issues.transition` 等高层效果。`VerifiedWkey.author` 必须与内核构造时已授权的作者一致。验证顺序、拒绝码与 nonce 单次消费规则不变；`verifySealed` 只少写 `seenNonces`，不省略其它检查。
- `EffectCredentialBroker` 只按已经授权的 `EffectAction` 签发/解析，不能把 `scope` 的声明当作公司授权本身。公司权源仍由 `AuthorityGrantPort` 与激活记录另行验证。

### 11.2 秘密的供给与不出境

〔事实〕现状秘密经 env 注入：`MATRIX_BOT_PASSWORD`、`MATRIX_HR_SHARED_SECRET`（次选 `MATRIX_SHARED_SECRET`）、`TAIGA_USERNAME/PASSWORD`、`TAIGA_TOKEN/TAIGA_REFRESH`；`gatewaySecret` 可配但有开发缺省（`DEV_GATEWAY_SECRET`，`serve.ts:411`）。

〔结论〕五条：

1. **env 白名单**：daemon 只读取已知名单；不得把 `process.env` 整体透传给子进程，除 `launch` 的凭据通道（`TaskBrief.credentials` → 适配器无条件透传）外，其余 env 必须按需挑；
2. **秘密不进 prompt/历史/日志/台账**：`TaskBrief.credentials` 的注释已冻结（`executor.ts:76`–`:80`）；`REC-AUTH-04` 只存引用；
3. **出站脱敏**：脱敏是**纯函数**，**整个 `secrets` 模块迁 `contract`**——`redactOutbound` / `redactKnownSecrets` / `findSecretShaped` 三个函数连同 `SecretShapeFinding`、三条正则（`BEARER_RE`/`ASSIGNMENT_RE`/`LONG_TOKEN_RE`）、`REDACT_MARK`、`MIN_KNOWN_LENGTH` 一并搬家（现状 `packages/core/src/secrets.ts`，零 IO，迁移只改归属不改语义，目标 `contract/src/secrets.ts`）。`core` 只保留**具名 re-export**——`export { redactOutbound, redactKnownSecrets, findSecretShaped } from '@studio-next/contract'`（`export *` **不用**：会把 `contract` 的其余公共面误扩进 `core`），**不得**在 `core` 里留第二套实现或第二份正则；`api`/`panel`/`gateway`/`studio-tools` 一律经 `contract` 复用——**禁止**新增 `api→core`、`gateway→core` 的边。过渡期 `assembly/hrsync/assemble.ts:59` 的 `import { redactOutbound } from '@studio-next/core'` 可继续用（re-export 兜住），迁移完成后改为直接 import `contract`。约束：
   - **只处理出站**（事件 note、日志、通知、对外 API、HR 同步）；**不扫描**需要认证的入站秘密（入站秘密是校验对象，不是脱敏对象），现状只在 hr-sync 装配里用（`assembly/hrsync/assemble.ts:59`）；
   - **标记形与测试语义冻结**：替换串是 `<redacted:N>`（N=原值长度），**不是**等长掩码、星号串或哈希。`packages/core/test/secrets.test.ts` 是迁移的验收口径，须原样通过：`'密码 s3cret-value 错误' → '密码 <redacted:12> 错误'`、长值优先（`['abcdefabcdef','abcdef']` 只出一个标记）、短值（<6）不替换、重复值去重后单次替换、`redactOutbound` 先已知值后形状兜底、正常中文句子零命中、ULID 26 位不触发 `long-token`；
   - **长度是诊断元数据，不是秘密内容**：`N` 只回答“拦下了多长一段”，为排查“是否截断/是否多拦”留的唯一线索，不构成可用的秘密材料。旧稿“替换串长度不随秘密长度变化/不得用等长掩码泄露长度”的说法作废——与冻结的标记形自相矛盾。若要改标记语义，须同时改测试、§5.8 与本条，走提案流；
   - `redactKnownSecrets` 的**长值优先**排序与 `MIN_KNOWN_LENGTH = 6` 阈值是语义的一部分，迁移不得顺手调；赋值正则的 `(?!<redacted:)` 负前瞻同样冻结（已知值先换、形状兜底不得二次改写标记，否则 `<redacted:30>` 会被改写成 `<redacted:14>`，观测面失真）；
   - **日志/计数不得泄露秘密**：只记“命中 N 次 + 类别”（类别取自 `findSecretShaped` 的 `kind: 'bearer'|'assignment'|'long-token'`），不记命中片段本身、其前后文、前缀、后缀或哈希前缀；`SecretShapeFinding.at` 只对**替换前**原文有意义，替换后失效，不得当成定位线索对外发布；日志行也不得另行统计/聚合秘密长度分布（标记里的 `N` 已在正文出现，再汇总就成侧信道）；
   - **regex 不是授权**：正则/模式匹配只能减少泄露面，**不能**取代已知秘密注入，也不能替代权限与网关；
   - 脱敏结果不得被当作“已安全可发”的证明——它只管“不出现已知秘密”，不保证语义正确；
4. **凭据只留进程内存**：Matrix 会话 access token 只在 client 实例内存；会话由 **daemon 驱动 `matrixSessionFactory` 登录**（daemon 传 `MatrixBotLoginSecret`（`platform-auth`），建号能力开启时另传 `MatrixHrRegisterSecret`（`matrix-register`），工厂实现登录，§3.4 第 10 条）在启动时建立，进程重启即重登，**不写盘**。现状是 `boot.ts:20` 由 boot 登录并持有 client——那是**待迁移的旧路径**：目标态 boot 只把工厂交给 daemon（不登录、不持 token），登录与 token 归属都在 daemon 进程内；迁移期间两条路并存时以工厂路径为准（同上条“兼容面”）；
5. **生产必换开发缺省**：`DEV_GATEWAY_SECRET` 公开在仓库，缺省等于无锁；启动日志必须警告（现状 `serve.ts:409` 注释有，日志未强制）。

〔结论〕**待迁移违例（平台写）**：`packages/panel/src/external/server.ts:487` 直接调 `platform.issues.create(…)`，绕过 `wkey` 网关。它的“收窄”是**类型层的**（`ExternalPlatformWrite` 只声明 `issues.create` 一个动作，transition/comments 在类型面不可达），属结构性 fail-closed 的一环，但**不是**网关凭据链：不经网关就没有网关的票据、审计行与幂等语义。处置见 §9.4（五步迁移；API 由 daemon 装配、只产 `InvokeIntent`，平台写回到 daemon 侧经网关）。同文件 `:491` 的 `ledger.kvSet` 直写台账属同类越界（写面而非秘密面），随同一迁移消掉。

#### 11.2.1 TS 侧秘密供给：`SecretCatalogEntry` / `SecretProvider` / `KnownSecretSet`（目标，未实现）

〔事实〕78-§7.4.1 已定**部署侧** `SecretCatalog`/provider（谁提供、从哪取、轮换与吊销、以及每条的 `allowedUses`）；本节只定 **TS 侧接口与调用边界**，不复制部署语义、不另起一套 id 命名。现状无这三个接口：秘密经 env 直读（§11.2 五条），`buildServeRuntime` 的 `hrKnownSecrets?: readonly string[]` 是装配件传进来的字面量（`serve.ts:913`/`:1143`、`hrsync/assemble.ts:38`，与 `collectHrSecrets(process.env, …)` 合并；§3.4 表），**来源未定**、也没有轮换/吊销后的更新路径——这正是本节补的缺口。

〔结论〕类型与落点（`SecretCatalogEntry`/`SecretProvider`/`SecretMaterial`/`KnownSecretSet` 落 `contract/src/ports/secret.ts`；与 78 的部署侧 `SecretCatalog` **同一套字段名与值域**，`secretId` 一一对应同名，不得各起一套）：

```ts
type SecretKind = 'password' | 'token' | 'hmac' | 'shared-secret' | 'api-key'

type SecretUse =                      // 消费面白名单；use 不在 entry.allowedUses 内即拒
  | 'platform-auth' | 'gateway-sign' | 'matrix-register' | 'matrix-notify'
  | 'broker-issue' | 'outbound-redaction'   // 只进 KnownSecretSet 用于脱敏，不作调用凭据

type ValueProvider =                  // 判别联合；**全部是逻辑引用**，不含秘密本体，也不写本机路径
  | { type: 'env-ref'; name: string }                        // 环境变量**键名**，不是值
  | { type: 'file-ref'; secretId: string }                   // 秘密文件的**逻辑 ID**，由部署侧解析；不是路径（§11.3 containment 不适用）
  | { type: 'broker-ref'; secretId: string; profile?: string }  // 外部代理句柄
  | { type: 'local-mint'; ticketId: string }                 // 本地签发：仅 per-ticket wkey 的例外项

interface SubjectScope {              // **结构化**，不用字符串、也不硬套 SubjectRef
  deploymentRefs: readonly string[]        // 部署级/系统账号（如 'matrix.bot'、'taiga.automation'）
  positionFamilies?: readonly string[]     // 岗位族：用 78-§6.2 已登记的族名，不用 76 的 DEF-CAP，也不自造缩写
  capabilityRefs?: readonly string[]       // 能力：用 76-§3.18 的 `DEF-CAP-*` 的 ID；provider 可读但**不是**能力定义源
}

interface SecretCatalogEntry {
  secretId: string                    // `SEC-<域>-<slug>` 稳定命名空间（大写 slug；域段按**平台**取：`TG`=Taiga、`MX`=Matrix、`GW`=网关、`WKEY`=按单票据；如 `SEC-TG-TOKEN`、`SEC-GW-SIGNING`，与 78-§7.4.1 一致）；
                                      // **轮换不换 ID**，内容版本由 SecretMaterial.version 另记；不是秘密值、不是授权主体
  kind: SecretKind
  subjectScope: SubjectScope
  allowedUses: readonly SecretUse[]
  valueProvider: ValueProvider
  rotationRef: string                 // 轮换程序与窗口引用（部署侧持有）
  revocationRef: string               // 吊销记录与通知面引用；空 = 不可吊销，catalog 审核期即拒
}

interface SecretMaterial {            // **只活受控内存**：不进任何可序列化面
  readonly secretId: string
  readonly version: string            // provider 给出的不透明内容代次（不是 SemVer，也不是秘密值哈希）；与 secretId 分离，轮换不改 ID
  readonly value: string | Uint8Array // 只读；禁止进历史/日志/PRM/提示词/快照/REC-*/导出
  readonly fetchedAt: Timestamp
  readonly expiresAt?: Timestamp
}

interface SecretProvider {
  load(entry: SecretCatalogEntry, use: SecretUse): Promise<Result<SecretMaterial, ClassifiedError>>
  // use ∉ entry.allowedUses ⇒ Err(rejected_forbidden)：**不**返回“最接近”的那个用途的值
  // **空值不返回材料**：取到空串 / 零长度字节 ⇒ Err(rejected_precondition, subcause:'secret-empty')，
  //   **必须**是 Err，不得返回 `value:''` 让调用方自己发现（空密码与“没配”在运行期不可区分，
  //   而下游会把空值当有效凭据去登录/验签，属 fail-open）
  // provider 不可用（句柄坏、broker 未就绪、文件不可读）⇒ unavailable（不是空值、不是 rejected_*）
  // 条目已撤销 / 版本不符（catalog 的 revocationRef 命中、或 material.version 与部署侧不符）⇒ rejected_version
  // 条目缺字段（secretId/kind/allowedUses 不自洽）⇒ rejected_precondition（配置面本应已拒，此处是二道闸）
}

interface KnownSecretSet {            // 由 SecretMaterial[] 在装配期生成，运行期只读
  readonly secretIds: readonly string[]                                   // 只暴露 id，不暴露值
  readonly state: 'complete' | 'known-set-empty' | 'known-set-partial'    // complete=声明的秘密均已取得；empty=未声明；partial=有缺失，见下
  readonly missingSecretIds: readonly string[]                            // state='known-set-partial' 时非空
  redactKnown(text: string): string                        // = redactKnownSecrets(text, knownValues)：**只换已知值**，不做形状兜底
  redact(text: string): string                             // = redactOutbound(text, knownValues)：已知值 + 形状兜底（出站总闸）
  find(text: string): readonly SecretShapeFinding[]        // = findSecretShaped(text)：只报形状
}
```

〔结论〕**两个脱敏方法分工固定，不得互相替代**（`knownValues` 是工厂闭包里的私有数组，**不**以属性、参数或返回值的形态暴露；`SecretMaterial` 与原始值都不出闭包）：

| 方法 | 语义 | 用途面 | 禁止用法 |
|---|---|---|---|
| `redactKnown(text)` | 仅把**已知秘密值**替换为 `<redacted:N>`（`≥MIN_KNOWN_LENGTH=6`、长值优先、去重）；**不动**形状匹配 | 内部文本：提示词、任务书、REPORT、台账 `note`/`last_error`、内部证据正文——这些面里 `password=...` 之类的**示例文本**必须原样可见，否则会伤到教学与测试夹具 | 不得用于对外响应；不得依赖它拦未知来源的凭据 |
| `redact(text)` | 已知值 + 形状兜底（bearer / assignment / long-token），即 §11.2-3 的 `redactOutbound` | **出站面**：对外 API 响应体、通知、导出、日志行、面板公开展示 | 不得在同一文本上二次调用（`<redacted:N>` 冻结，见下） |
| `find(text)` | 只报形状命中（`kind` 仅三值、`at` 只对原文有效） | **只做诊断/测试断言** | **不得**以 `find(text).length > 0` 作为拒绝条件——`find` 的命中不等于泄漏（示例、文档、错误分类名都可能命中形状），把它当门禁会造出“合法内容被拒”的假阳性 |

"有没有东西被改过"一律用 `redact(text) !== text` 判；`redactKnown(text) !== text` 只说明"命中了已知值"。两条判定都**不得**新增 `SecretShapeFinding` 种类（那会动冻结值域与 `secrets.test.ts` 口径）。`<redacted:N>` 的 `N` 是**原值长度**，赋值正则的 `(?!<redacted:)` 负前瞻保证标记不被二次改写（`<redacted:30>` 不会变成 `<redacted:14>`）。

〔结论〕**`valueProvider` 是判别联合，不是字符串前缀**：不得写 `env:TAIGA_TOKEN` 这类拼接串（解析靠猜、无法静态校验），也不得让 `file-ref` 携带路径——它只带部署侧能解析的逻辑 ID；`secretId` 形如 `SEC-<域>-<slug>`（大写 slug，与 78-§7.4.1 一致：`SEC-TG-TOKEN`、`SEC-MX-HR-SHARED`、`SEC-GW-SIGNING`），**不得**用 `taiga.<env>.token` 这类别名（别名会随环境变化，把“同一份秘密”拆成多个 ID）。**域段按平台取，不按产品名缩写混用**：`YT` 只指 YouTrack，Taiga 一律 `TG`——`SEC-YT-*` 与 `SEC-TG-*` 不可互相冒充（两份不同平台的凭据，env 仍是 `TAIGA_TOKEN`/`TAIGA_PASSWORD`，**改名只动 `secretId`，不动环境变量名**）。

〔结论〕`redact`/`find` **不新造算法**，直接复用 §11.2-3 迁入 `contract` 的三个纯函数（现签名见 `packages/core/src/secrets.ts`）：

| 方法 | 实现 | 覆盖与边界 |
|---|---|---|
| `redact(text)` | `redactOutbound(text, knownValues)` | 已知值（`≥MIN_KNOWN_LENGTH=6`、长值优先）+ 形状兜底（bearer / assignment / long-token），标记形 `<redacted:N>` 冻结 |
| `find(text)` | `findSecretShaped(text)` | **只报形状命中**（`kind` 仅 `'bearer'\|'assignment'\|'long-token'`；`at` 只对替换前原文有效）；**不新增** `'known-value'` 类别 |

“有没有东西被改过”一律用 `redact(text) !== text` 判——不给 `SecretShapeFinding` 加第四种 kind（那会动它的冻结值域与 `secrets.test.ts` 口径）。

〔结论〕`KnownSecretSet` 由 **daemon 装配期**用 `SecretMaterial[]` 装配（`buildServeRuntime` **第 6 步内、创建 `IntentIngress` 之前**；§3.6 第 6 步已把“秘密面/会话面装配”列为该步固定顺序的第一段），来源是**按 `ServeConfig.secrets` 装配出的部署 provider**（§3.3 第 6 条：`catalog` + `fileRoot` + `brokerBinding`，唯一配置面），代码里不写死值，也**不新增** `BuildRuntimeOpts.secretProvider`：

**装配顺序**（固定，任一步失败按“必需/可选”分类处置，不得静默跳过）：

1. 读 `ServeConfig.secrets.catalog`（缺省 `[]`）→ 逐条做形状校验（配置面已拒的非法值不会到这里）；`catalog` 为空 ⇒ `known-set-empty`，合法，不构造任何 `SecretMaterial`；
2. **按能力与范围裁剪**：只对“本部署已开启的能力 × 该条 `subjectScope` 覆盖本部署”的交集调 `load`——**能力关闭的条目不加载、范围外的条目不加载**（关闭的 Matrix/HR/外部面不得因为“顺手全量加载”把秘密带进内存）。`allowedUses` 含 `outbound-redaction` 的条目**额外**以该 `use` 加载一次，专供脱敏集合（这一步只对已开启能力的秘密生效）；
3. **provider 解析**：参考实现只支持 `env-ref`（按键名读 env）/`file-ref`（在 `secrets.fileRoot` 下按逻辑 ID 解析，路径 containment 见 §11.3）/`local-mint`（仅 per-ticket wkey）。`broker-ref` **只有在 `secrets.brokerBinding` 指向已注册绑定且能解析该 `secretId` 时可用**；否则该条 `load` 返回 `unavailable`，按“可选缺失 ⇒ 不装配该能力 + `REC-LOSS-01` / 必需缺失 ⇒ 拒启动”处置——**不得**假装支持（不得回落 env 猜值、不得返回空值）；
4. `SecretMaterial[]` → `KnownSecretSet`（值只在闭包里）；活跃 per-ticket `wkey` 在签发时以 `local-mint` 登记、`CLOSE` 时移除；
5. 启动日志只记 `secretId`、数量与 `state`（`complete`/`known-set-empty`/`known-set-partial`），不记值、不记长度分布（§11.2-3）。

| 来源 | `secretId`（`SEC-<域>-<slug>`，与 78-§7.4.1 一致） | `allowedUses`（恰六值域内） | `valueProvider` | 现状 |
|---|---|---|---|---|
| taiga 认证（password / token，`daemon.yaml` 只写形态） | `SEC-TG-TOKEN` / `SEC-TG-PASSWORD`（`TG`=Taiga；YouTrack 才用 `YT`，两者不混） | `platform-auth` + `outbound-redaction` | `{type:'env-ref', name:'TAIGA_TOKEN'}`（或 `TAIGA_PASSWORD`） | env 直读 |
| Matrix bot 登录密码 | `SEC-MX-BOT-PASSWORD` | **`platform-auth` + `outbound-redaction`**（**恰两项**；`matrix-register` 已从本条目**删除**，见下条结论与 S10） | `env-ref` / `file-ref`（`broker-ref` 仅在已注册绑定下可用，否则 `unavailable`） | env 直读 |
| Matrix HR 共享秘密 / `registration_shared_secret` | `SEC-MX-HR-SHARED` | `matrix-register` + `outbound-redaction` | `env-ref` / `file-ref` / `broker-ref`（建号用后即弃优先） | env 直读 |
| `gatewaySecret` | `SEC-GW-SIGNING` | `gateway-sign` + `outbound-redaction` | `env-ref`（开发缺省另记，§11.2-5） | env + 开发缺省 |
| HR 侧已知值（`hrKnownSecrets`） | **不另立 ID**：就是上面 `SEC-MX-HR-SHARED` / `SEC-MX-BOT-PASSWORD` 两条的值（bot 密码只作脱敏源，**不承担建号**） | 随源条目（只取 `outbound-redaction` 一面） | 同源 | `hrKnownSecrets` 字面量 |
| Matrix 会话 access token | **无静态 `secretId`**：只在 `MatrixClient` 实例内存，不持久化、不进 catalog、不进 PRM/任务书/提示词/日志/帧 | 不适用（由登录换得，不是 catalog 条目） | 无（`platform-auth` 换取） | 内存持有 |
| per-ticket `wkey` | **不进 catalog**；派生 ID `SEC-WKEY-<ticketId>`（78-§7.4.1 同式） | 只以 `outbound-redaction` 进 known set；其**调用**用途由网关授权面判，不由 catalog `allowedUses` 判 | `{type:'local-mint', ticketId}` 的例外项 | 运行时签发 |

〔结论〕**一份秘密一个用途域，建号只认 HR 共享秘密**：`SEC-MX-BOT-PASSWORD` 的 `allowedUses` **只有 `platform-auth` + `outbound-redaction`**（**不得含 `matrix-register`**）。78-§7.4.1 已同步为相同两用途，S10 的设计面已关闭；**本卷的 `matrixSessionFactory` 只消费它的 `platform-auth`**（`MatrixBotLoginSecret`，`kind='password'`）。建号句柄是 `SEC-MX-HR-SHARED`（`MatrixHrRegisterSecret`，`kind='shared-secret'`，`use='matrix-register'`）——**不得用 bot 密码建 HR 账号**，也不得拿 HR 共享秘密去登录。登录失败/超时/取 token 失败一律按 `platform-auth` 归因，不得塞进 `matrix-register`。**bot 注册在本设计里没有旁路**：不设“bot 密码 + 特殊分支”，也不设第二用途位；若某部署确实要用 bot 密码建号，那是 **78 的 catalog 语义变更 + 另立设计**，本卷不实现、也不预留用途位（旧稿“`matrix-register` 保留未用”的口径作废）。会话 access token **不造静态 `secretId`**、不进任何帧——它不是 catalog 条目，也不是可授权的凭据引用。

1. `hrKnownSecrets?: readonly string[]` **降级为测试/装配兜底**（保兼容），生产来源一律走 provider；两者同时存在时以 provider 为准，并在启动日志告警（只记 `secretId` 与数量，不含值）；
2. **per-ticket `wkey` 是 `local-mint` 的唯一例外**：不进静态 catalog、不落盘；**活跃期才进** `KnownSecretSet`（签发即登记，`secretId` 按 `SEC-WKEY-<ticketId>` 派生、同名于 78-§7.4.1），`CLOSE`（关单/吊销）即**移除**；移除后该值不再参与脱敏，但按「轮换 / 吊销」第 2 条仍留一个去重窗的兜底窗口。`gatewaySecret` **绝不**进 worker（§11.4.1），也不随 `TaskBrief.credentials` 下发；
3. **空集分两种，不得混同**：
   - **`known-set-empty`（合法）**：部署里**没有任何可选秘密**时成立，出站仍跑形状检测（`find`/`redact` 的形状兜底），证据写明 `known-set-empty`；**不得**据此声称“无泄漏/已完全脱敏”；
   - **`known-set-partial`（必需缺失）**：`secret-required` 能力所需的秘密解析失败 ⇒ 标 `known-set-partial{missingSecretIds}`，且**该能力拒启动**（`CONFIG_INVALID`，§3.4 表同语义），不得“先起来跑跑看”；
   - **可选缺失**同样标 `known-set-partial`，但只**不装配该能力**，并落一条 `REC-LOSS-01`（逐项写明缺失的 `secretId` 与受影响能力）——不得静默少装；
4. **不得用 regex 兜底冒充完整**：`knownValues` 为空或部分时 `redact` 只剩形状兜底，短值（<6）与非常规形（非 bearer / 非赋值对 / 非长串）全部漏过，却仍返回“看起来已处理”的文本——这是 fail-open，判负；宁可拒起或明标 partial；
5. **每条 `load` 都要带 `use`**：装配期只在 `subjectScope` 覆盖本部署的前提下，对 `allowedUses` 含 `outbound-redaction` 的条目以该 `use` 全部 `load` 一遍；任一必需项 `Err` ⇒ 按第 3 条处置。“无法验证”包括 `SEC-GW-SIGNING` 与已签票据/已知摘要不符、`kind` 与值形状明显矛盾（如 `hmac` 取到不等长随机串）；
6. 运行期 `load` 失败只影响**需要该秘密的动作**（如 HR 同步），不得静默降级成“不脱敏继续跑”。

〔结论〕**装配期 `load` 失败 → 启动语义（映射写死，不另发明）**：

| 情形 | 处置 |
|---|---|
| **必需项**（本部署已开启能力的秘密）`load` 返回 `Err`（任何 `failure`） | **`CONFIG_INVALID`**（启动装配失败的统一归类），并把**原始 `failure`/`subcause` 保留在 `detail` 或审计行**（如 `detail:'required-secret-load-failed: unavailable/secret-file-unreadable'`）——不得只留一句“配置错误”把可用性故障吞掉。作用范围按该能力的启动语义：**daemon 启动的必需面（如 `matrixSessionFactory`、对外 API）⇒ 整机拒启动**（§9.4 决策 8 同口径）；仅该能力自身启动 ⇒ 拒启动该能力、不降级 |
| **选项**（能力未开启 / scope 之外的条目）`load` 返回 `Err` | 不装配该能力，落 **`REC-LOSS-01`**（逐项写 `secretId` 与受影响能力）；进程照常启动 |
| `load` 返回 `Ok` 但 `value` 为空串/零字节 | 按 `Err` 处理（provider 本该返回 `secret-empty`）；装配侧**再判一次**，空值不得进 `KnownSecretSet`、不得进登录/验签 |
| `known-set-empty` + 全部条目都是选项 | 合法启动；脱敏只剩形状兜底，证据写明 `known-set-empty` |

〔结论〕**轮换 / 吊销的触发与失败路径（不得只写“重启即可”）**：

1. **触发源两个，都是可观测事件**：① `file-ref` 的秘密文件 **`mtime`/大小变化**，或 provider 返回的 `SecretMaterial.version` 与当前集合不同；② **部署控制通道**（78 的轮换/吊销通知面，`rotationRef`/`revocationRef` 指向的那个）投递一条“重建”事件。**不靠“重启顺带更新”**——重启只是最粗暴的重建手段，不是触发语义。
2. **无通知时轮询有界**：允许对 `file-ref` 做**低频**有界轮询（缺省间隔 ≥ 60s、带抖动、单次只 stat 不读全文；条数上限=已装配条目数），**不得**忙轮询/对 `broker-ref` 轮询（那会把外部调用打成心跳）。轮询间隔是实现缺省，不是 `ServeConfig` 的必填键。
3. **重建是整体的**：命中触发 ⇒ 重新 `load` 全部条目并**整体替换** `KnownSecretSet`（不就地改元素）；替换成功后旧引用置空（§11.2 “受控清理”），旧值在新集合里再保留一个去重窗用于脱敏（宁可多脱敏）。
4. **重建失败的路径**：保留**旧可用集合**继续工作（旧值仍参与脱敏），把 `state` 标为 **`known-set-partial`**、`missingSecretIds` 写失败条目，落一条 `REC-LOSS-01`，并**禁止新秘密用途**——即：不再用该 `secretId` 发起新登录/新建号/新验签，已有会话不强制中断（但下次重试失败即按“必需缺失”拒该能力）。**不得**把重建失败读成“集合完整”，也**不得**清空集合（清空会把“脱敏兜底”一起丢掉）。
5. **吊销优先于轮换**：同一 `secretId` 同时收到吊销与轮换 ⇒ 先按吊销处理（该值只留脱敏窗口、不得再用于调用），再谈新版本。
6. **可观测**：每次重建只记 `secretId`/`state`/`version` 变化与条数，**不记值、不记长度分布**（§11.2-3）；重建失败额外记 `subcause`（`secret-empty`/`unavailable`/`rejected_version`）。

〔结论〕**调用边界**（九个**出站/落笔强制点**逐点指定方法，不得混用；另有内部面两点）：

| 面 | 强制点 | 方法 |
|---|---|---|
| 出站 | 日志行、API 错误体（含 `detail`）、外部响应回写、Matrix 通知、导出物 | `redact` |
| 内部落笔 | 事件 `note`/`last_error`、REPORT 正文、DSH 事件、人工复核材料 | `redactKnown` |
| 内部供给 | 提示词、任务书（`TaskBrief` 正文） | `redactKnown` |

1. **先换已知值，再视面决定是否兜底**：内部面**只**用 `redactKnown`——`password=...`、`Token: xxx` 这类示例/夹具/教训文本必须原样可见，否则会把教学材料与测试口径一起毁掉；出站面一律走 `redact`（已知值 + 形状兜底）。任一面**未跑对应方法即不得出站/落笔**（fail-closed）；不得以“内容是内部数据”为由跳过内部面的 `redactKnown`。
2. **`find` 不是门禁**：它用于出站前**自检与观测**（测试断言、报告统计、排查"哪类形状被执行体回显"），**不得**按 `find(text).length > 0` 拒绝请求或拒绝出站——形状命中不等于泄漏（示例、文档、错误分类名都会命中）。真正的闸门是"必调 `redact`/`redactKnown`"，不是"不得命中形状"。
3. **无命中 ≠ 绝对安全**（已知值只是下界、正则只是形状）；`known-set-empty` 时 `redact` 只剩形状兜底，短值与非常规形全漏，仍返回"看起来已处理"的文本即 fail-open，判负（见上第 3、4 条）。
4. **认证入站不脱敏**：`Authorization`、`wkey`、`X-SN-Token`、注册表单是**校验对象**不是脱敏对象（`packages/core/src/secrets.ts:14` 已冻结"API 请求体不扫"）；不得先脱敏再验签——那会把合法凭据改成 `<redacted:N>`，导致验签永远失败。

〔结论〕**provider 与 redactor 都不是授权或秘密事实源**：

- `SecretProvider` 只回答“这个 `secretId` 的值是什么”，**不**回答“谁有权用”；授权读 §3.5 与 `TS-PORT-AUTH-*`（岗位/权责链）。`load` 成功 ≠ 有权调用；
- **secret lease / capability 与公司授权不同轴**：`wkey` 通过只证明“持有某次签发的凭证”，不证明有权（§11.4 三行表）；不得用 wkey 存在反推授权，也不得用授权反推“可以取秘密值”；
- `KnownSecretSet` 是**脱敏用的派生集合**，不是秘密的权威副本：权威在部署侧 catalog/provider，集合可随时重建；重建结果不进 `REC-*`、不构成事实记录。

〔结论〕**轮换 / 吊销**：

1. **轮换不改 `secretId`**：`SEC-*` 是稳定命名空间，内容变化只让 `SecretMaterial.version` 递增；因此 PRM/绑定/审计里的引用不因轮换失效，也不得“轮换即换 ID”造出历史断裂；
2. `rotationRef` / `revocationRef` 变化 ⇒ **整体重建** `KnownSecretSet`（不就地改元素）；旧 `version` 的值在**受控内存**里保留到替换完成，替换窗口内两代值同时在集合里（宁可多脱敏）；
3. 被吊销的秘密**继续留在脱敏集合至少一个去重窗**（24h，与 §6.6 同口径）——吊销只停“使用”，不停“脱敏”，历史内容里的旧值仍要挡；
4. per-ticket `wkey` 的移除走 `CLOSE`（关单/吊销）：先从集合移除、再停用能力；移除后仍按上一条留一个兜底窗口；
5. 受控清理：替换/吊销后旧 `SecretMaterial` 引用置空、不留引用链；**不宣称绝对擦除**——JS 字符串不可控、GC 时机不定、可能有副本（栈、日志缓冲、下游拼接），文档只承诺“不再可达 + 不再出站”，不得写“内存已清零/已安全擦除”；
6. 秘密的已知值**不得出现在历史/快照/提示词/报告/导出**：这是 §11.2-2 的延伸，`redact` 是最后一道闸而非唯一一道（PRM/TaskBrief 只写 `secretCategories[]`/`keyLogicalRef`，78-§3.2.2）。

〔结论〕**目标未实现**：仓内无 `contract/src/ports/secret.ts`，无 `SecretCatalogEntry`/`SecretProvider`/`SecretMaterial`/`KnownSecretSet`，`ServeConfig.secrets` 与 `RunServeOpts.matrixSessionFactory` 也都不存在；部署侧 `SecretCatalog` 归 78（在建）。本节**不新增 `REC-*`**（不造“秘密记录”，不动 76/77 的类型与失败类）、不新增包边、不让 `worker` 拿到 `gatewaySecret`（§11.4.1 不变）；`SecretMaterial` 只在 daemon 进程内存与 provider 返回值之间流动，跨进程只经 §11.4.1 的受控 IPC 传**结论**，不传值。现状与目标的差：秘密仍经 env 直读、登录仍由 boot 承担（`boot.ts:20`）、`hrKnownSecrets` 仍是装配件字面量——这些在 U80-18 里按“目标”登记，不得读成已具备。

### 11.3 路径边界

〔结论〕路径处理三段，缺一不可：

1. **containment**：解析后的绝对路径必须在允许根内（`path.resolve` + `path.relative` 不以 `..` 开头）；
2. **realpath**：符号链接必须解析后再判 containment（防 `link → /etc`）；
3. **写入原子性**：临时文件 + `rename` 原子替换；不得“先 truncate 再写”。

〔结论〕路径不推授权（§3.5）：能读 `/etc/passwd` 不等于有权读；`companyDir` 之外的读一律拒。

〔结论〕归档上限：数量、单文件大小、总大小、目录深度、解压膨胀比五道上限；超限拒收并明报。现状未见归档面实现，属目标。

### 11.4 凭证、代理与沙箱各自证明边界

〔结论〕三者不可互相替代：

| 机制 | 证明 | 不证明 |
|---|---|---|
| 凭据（wkey/token） | 调用者持有某次签发的凭证 | 调用者有权、内容正确 |
| 代理（`EffectGateway`） | 所有出站写经同一处、有回执 | 目标系统真的执行了 |
| 沙箱（`adapters/seatbelt.ts`、DSH sandbox） | 进程的文件/网络限制 | 逻辑正确、验收通过 |

〔事实〕`packages/adapters/src/seatbelt.ts` 存在（macOS sandbox 配置）；`78a` 明确 DSH 沙箱“文件强、网络/进程弱”（78a-§2.3）。

〔结论〕不得用“沙箱开着”证明“安全”：沙箱只限文件面；网络与子进程仍是缺口，必须由部署层（防火墙/代理/容器）补，且 82 要有负向探针。

#### 11.4.1 `studio-tools` 的 stdio 工具：daemon 侧验签与秘密边界

〔事实〕现状只在**进程内**连接：测试用 `InMemoryTransport`（`packages/studio-tools/src/server.test.ts:15`），**没有 stdio 实现**；凭据经 `initialize` 的 `_meta['studio-wkey']` 或宿主直注（`server.ts:92`–`:97`）。

〔结论〕**worker 永不持有 `gatewaySecret`**——全局 secret 发给 worker 等于把整仓写权发出去，且无法按单吊销。目标形态是 **daemon 侧验签的工具服务 / 本地代理**：

1. **凭据注入（只到进程，不进帧）**：stdio/本地入口只收 **per-ticket capability（wkey）与其范围**（ticketId / companyId / 允许动作词 / 到期），优先经**每单 env** 交付——键名是 **`STUDIO_TOOLS_WKEY`**（`apps/daemon/src/engine/worker-key.ts:62` 的 `WORKER_WKEY_ENV_KEY`，随 `launch` 的凭据通道注入；`serve.ts:810` 同口径）；`initialize._meta['studio-wkey']` **只作 legacy 兼容**，同样只承载 per-ticket wkey、不承载任何 catalog 秘密，不宣传、不作为推荐路径，也不宣传任何 OAuth 形态；**这两条通道都止于进程内**——回给 daemon 的帧只带 `wkeyRef` 引用（第 4 条），不带 wkey 原文；
2. **验签在 daemon 侧**：HMAC 验签、nonce 单次有效、吊销集合、审计、平台写**全部集中在 daemon/网关**；worker 侧不做验签，也没有可信的 nonce 账本；
3. **stdio transport 只是传输层**：它不提供授权、不提供防重放——不得把“走 stdio 所以安全”当理由，也不得用 worker 自己的内存 nonce 表当跨进程防重（重启即失效、多 worker 不共享）。**stdout 只许输出 JSON-RPC 协议帧**，日志/诊断一律走 stderr（混写 stdout 会把帧流污染成不可解析）；
4. **helper 进程必须注册（challenge-proof，协议可执行）**：MCP client 可以 `spawn` 一个 stdio helper，但 helper 启动后**必须先向 daemon 注册**，此后每次验签/查吊销都经受控 IPC 回给工具面；**未注册一律拒服务**。“daemon 监督”指**注册、授权与生命周期监控**，不强行要求 OS 父子进程关系；**不得**把权威（secret、验签实现、吊销表）复制到 worker 侧。

   受控 IPC 用**本地 socket**，路径取部署配置的相对路径 `run/daemon.sock`（相对 daemon 工作目录）或环境变量 `STUDIO_DAEMON_SOCK`；**不得**在代码或文档里写死本机绝对路径（`/Users/...`、`/tmp/...` 同样不收）。四类帧（JSON 行；只有 `call`/`verdict` 带 `reqId` 回显——注册三帧不带 `reqId`，一条连接只注册一次，`registerAck` 天然对应该连接）：

   ```text
   helper → daemon: {"type":"register","helperId":string,"pid":number,"wkeyRef":string}          // 仅申请，不作证明
   daemon → helper: {"type":"registerChallenge","challenge":string,"alg":"hmac-sha256-v1","expiresAt":iso8601}
   helper → daemon: {"type":"registerProof","proof":string}                                      // HMAC 结果，不含原秘密
   daemon → helper: {"type":"registerAck","ok":true} | {"type":"registerAck","ok":false,"reason":string}

   helper → daemon: {"type":"call","reqId":string,"tool":string,"args":unknown}
   daemon → helper: {"type":"verdict","reqId":string,"verdict":"allow"|"deny","reason"?:string,
                     "result"?: {status:"applied",receiptRef:string} | {status:"unknown",unknownRef:string},
                     "failure"?: {failure:string,category:string,subcause?:string}}   // 脱敏后；不含平台原文
   ```

   规则（逐条可执行，不得只写“已注册即安全”）：

   - **`register` 恰三键**（`helperId`/`pid`/`wkeyRef`）：`wkeyRef` 是**逻辑引用**——票据标识，按 `SEC-WKEY-<ticketId>` 由 `ticketId` 派生（`ticketId` 已在凭据范围里，helper 不需要任何额外秘密就能算出；**不是** wkey 原文、**不是**密码/token、**不是**任何秘密值，也**不是**可转授的句柄）。`register` **只表示申请**，不构成任何证明。
   - **`registerProof` 是 challenge-proof，不是“自报 nonce”，字节规范化冻结**：proof 的 HMAC 输入**不是**字符串拼接，而是 **`studio-next/jcs@1` 序列化后的 UTF-8 字节**——对象**恰五键**（不得多键、不得省略；JCS 按键名字典序输出，所以是 `challenge`/`helperId`/`pid`/`protocol`/`wkeyRef`）：

     ```text
     JCS(studio-next/jcs@1) of
       { "protocol": "studio-next/stdio-register@1", "challenge": <b64url string>,
         "helperId": <string>, "pid": <number>, "wkeyRef": <string> }
     proof = base64url( HMAC-SHA256( key = wkey 原文, message = 上述 UTF-8 字节 ) )
     ```

     `alg` 字面量 **`'hmac-sha256-v1'`** 即“上述 JCS 规范化 + 域分隔串 `studio-next/stdio-register@1` + SHA-256 HMAC”这一整套；换规范化/换域串/换算法**必须**换 `alg` 值（`v2`/新名），不得在 `v1` 下改字节。**不得**用未定义的拼接（`a+b+c`、空格分隔、JSON.stringify 默认键序、平台换行）——那会让两端算不出同一个 HMAC，且测试无法复现。`pid` 用 JSON number（整数），`challenge`/`wkeyRef` 用原文 ASCII。proof **不含** wkey 原文；worker 侧只在本地内存算一次即丢中间值。
   - **测试向量归 82，不进本卷**：固定**假**向量（假 wkey、固定 challenge/helperId/pid）由 82 登记为探针夹具，本卷与代码里**不得**出现真实秘密或“示例即真值”的常量；向量覆盖三件：JCS 字节逐字节一致、`alg` 与域串绑定、异长/改一字节必拒。
   - **daemon 侧验签必须“完整验证但不消费 nonce”**：`wkey` 的 `nonce` 是**一调用一签发**语义（`packages/gateway/src/wkey.ts:10`–`:11`、`:170`–`:171`：完整成功才记入已见集合），拿它去烧注册会让后续真实写调用全部撞重放。因此**新增** `WkeyAuthority.verifySealed(token, check)`（或 `verify(token, check, {consumeNonce:false})`）：跑完形状/签名/吊销/过期/单号/scope 的全链检查，**不写 `seenNonces`**（该目标方法未实现，登记 U80-17 的探针项）。用 `registerProof` 的常量时间比较（`timingSafeEqual`，异长直接拒）判定“持有该 wkey”；再核对**活跃签发**：`(ticket, nonce, attempt/sessionRef)` 必须在 daemon 的内存签发表内且未吊销——**同一 `(ticket, nonce)` 只允许一个活跃会话**，第二个会话注册即 `ok:false`。
   - **challenge 一次性、短 TTL、绑定“连接 + 活跃会话”**：`challenge` 是 `randomBytes(32)` 的 base64url，`expiresAt` 缺省 ≤30s（可配置但必须有上限）；**一次性**——`registerProof` 无论成败都作废该 challenge。**绑定面两个，缺一即拒**：① 发出它的**那条 socket 连接**（daemon 侧按 peer 句柄记，不能挪到另一条连接）；② 该次 `register` 声明的**活跃会话** `(ticket, nonce, attempt/sessionRef)` 必须在内存签发表内且未吊销。**被消费的是 challenge，不是 wkey 的 nonce**：`registerAck` 丢失 ⇒ 连接断开清理后**同一 wkey 可重新走完整三步注册**（新 challenge + 新 proof 必然通过，不得永久锁死）；旧连接清理会**同时**清掉其 session、未用 challenge 与 pending 请求，因此不会留下“半个注册态”。
   - **注册状态机固定**：`expectRegister → expectProof → registered`。乱序帧、多余键、超长帧（> 上限即断连）、过期 challenge、重复 `register` ⇒ `ok:false` 并**断连**；不得“宽容续用”或部分接受。
   - **注册绑定该连接（连接鉴权）**：连接的可信度分**两层**，两层不得混写。① **部署边界（文件系统）**：socket 目录 `0700`、socket 文件 `0600`、`umask 0077`、`lstat` 拒符号链接、路径由 `STUDIO_DAEMON_SOCK` 或 `run/daemon.sock` 固定——这一层只回答“**谁有权限连上来**”，**不产生**“对端是某个 uid”的已核事实。② **对端身份核验（可选、宿主绑定）**：**Node 24 没有 `getpeereid` / `SO_PEERCRED` 的内建 API**（`net.Socket` 不暴露对端凭据），因此**不得**写成“Node 直接调用它们核 uid”。目标形态是宿主注入一个 `PeerCredentialVerifier`：
     ```text
     interface PeerCredentialVerifier {
       readonly kind: 'host-bound' | 'none';
       // handle 为该连接对应的底层 fd 句柄，由宿主/原生层给出；本接口不假设 Node 能自己取 peer 凭据
       verify(handle: PeerHandle): Result<{ uid: number; gid?: number }, ClassifiedError>;
     }
     ```
     只有宿主**确实提供了已验证适配**（原生 addon、系统调用封装，或由 supervisor 代验后把结论交给 daemon）且 `verify` 返回 `uid === daemon uid` 时，该连接的对端身份才记为 **`peer-verified`**；**没有适配、适配装不上、或验证未成功 ⇒ 该连接状态一律 `unverified`**，文档/日志/审计/上报**不得**声称“peer uid 已核”。**不把原生 addon 作为默认依赖**：默认 `kind: 'none'`（`unverified`），不装也能跑；装了只是把该连接从 `unverified` 升为 `peer-verified`，**不改变**注册协议与判定链。
   - **核心信任不靠 uid，靠三件**：一次 `call` 的合法性**只**由 ① **challenge-proof** 证明“本端持有该 `wkey` 原文”、② **活跃签发**（`(ticket, nonce, attempt/sessionRef)` 在 daemon 内存签发表内且未吊销）、③ 该 wkey 的 **`scope`** 覆盖 `tool → action` 三件共同决定；`peer-verified` 只是**额外**的部署加固，`unverified` **不降低**也不放宽这三件。**同 uid ≠ 员工身份**：同一 OS 用户下的任意进程都能连上 socket（`0700`/`0600` 只挡**别的用户**），所以“对端 uid == daemon uid”**不**等价于“这是该单的 worker”；**恶意/误连同 uid 进程只能靠 OS 用户隔离或容器/VM 隔离挡住**（daemon 与 helper 用不同用户跑，或把 worker 关进独立容器），这超出本协议能力，**不得**在文档里宣称 socket 权限已解决它。一次注册只对**发起它的那条 socket 连接**有效（daemon 按 peer 句柄记注册态）；注册被拒或**连接断开** ⇒ 该连接**不进入/退回不可服务态**，后续 `call` 一律 `deny`。
   - **重连必须重注册**：断开、daemon 重启、helper 崩溃后重连，注册态**不复用**，须走完整 `register → challenge → proof` 三步；未重注册的 `call` 一律 `deny` 且不触达平台。断连时 daemon **清掉**该连接的 session、未用 challenge 与 pending 请求；challenge 过期**不续期**（要新 challenge 就重新 `register`）。
   - **不能转授**：注册态与 `wkeyRef` 不得复制给另一进程/另一条连接，也不得落地（文件、env、日志、任务书）后转交；换连接即换主体，须按同一 `wkeyRef` 重新注册，由 daemon 重新判（`load` 成功也**不等于**有权，§11.2.1）。
   - **`call` 恰三键**（`reqId`/`tool`/`args`）：**不含** `wkey`、密码、token 或任何 secret 字段。每次 `call` 只查：会话是否 `registered` → 票据是否已吊销/过期 → `tool → action` 是否在该 wkey 的 scope 内 → `reqId` 是否重复（同连接内防重）。**daemon 代为执行**：内部按 `scope[action]` **现签**一个只含该动作的调用 wkey（一调用一签发），用它过 `gateWrite`；该 wkey **不回传** helper，也不进 `verdict`。
   - **`encodeAction`/`decodeAction` 集中在网关**：动作词的编解码只有一份实现（`packages/gateway`），stdio 面与 HTTP 面都调它；不得在工具面复制一份映射表（两份映射必然漂移，`tool→action` 授权会被绕过）。
   - **`allow` 只表示授权通过，不冒充 `applied`**：`verdict` 必须带回**脱敏后**的受限结果（`EffectOutcome` 的 `applied`/`unknown` 二态，见 §5.2）或 `ClassifiedError` 的 `failure`/`category`/`subcause`；**不得**只回 `allow` 让调用方以为写入已生效，也不得回平台原文（错误消息可能回显响应体）。
   - **catalog 秘密不进帧**：`SEC-*`（含 `SEC-GW-SIGNING`、`SEC-MX-*`、`SEC-TG-*`、`SEC-WKEY-<ticketId>` 的值）**永不随 JSON-RPC/stdio 帧**传输，也不经 `initialize._meta`、env（`STUDIO_TOOLS_WKEY` 只承载 per-ticket wkey）、任务书或任何帧字段下发；帧里允许出现的秘密相关字段**只有 `wkeyRef` 这个引用**。
   - **未注册/被拒后**任何 `call` 都不得服务：回 `deny`，不触达平台、不落单、不写台账。
   - socket 路径与权限、注册信息**不得进日志**（只记 `helperId` 与结果）；`stdout` **只许** JSON-RPC/上述帧，诊断一律 stderr（混写 stdout 即判负）。
5. **per-ticket wkey 在 daemon 侧必须可恢复地留在内存里（至 attempt 结束）**：注册验签需要 daemon 手上有该 `(ticket, nonce)` 的 wkey 原值，因此**废止**“daemon 侧不留副本”的旧口径——`mintWorkerKey` 的产物由 **engine 的签发登记表**按 `(ticket, nonce, attempt)` 保存到**该 attempt 终结**（终态/关单/超时即删），只存内存、不落盘、不写台账、不进日志；`workerKeyCredentials` 仍只把值注入子进程 env。旧口径的审计锚（DISPATCH note 只带 nonce）保留，但不再声称“daemon 无副本”。**这不是把权威外扩**：登记表仍是 daemon 私有。**worker 侧的边界是“只持本单、只持该值”**——worker 只持有本单的 per-ticket `wkey`（env `STUDIO_TOOLS_WKEY`）与其 scope，**不持有** `gatewaySecret`、不持有**他单**的任何凭据、不持有任何 `SEC-*` catalog 秘密值；“不持有副本”这句话只用于**daemon 权威**（登记表），不得拿来描述 worker（worker 本来就必须持有本单 wkey，否则无法被验签）。
6. **共享一个 `WkeyAuthority`，不每 `createGateway` 新建**：现状 `createGateway` 每次调用都 `createWkeyAuthority(...)`（`packages/gateway/src/gateway.ts:65`），导致**签发实例与验签实例的 `seenNonces`/吊销集互不可见**（`worker-key.ts` 头注已把这列为疑点）。目标：daemon 进程内只持一个 `WkeyAuthority`（可注入 clock/store），`createGateway` 接受已构造的 authority；stdio 验签、engine 签发、关单吊销都走同一实例——否则“已吊销”在 worker 面不可见，等于吊销失效。跨进程/多机时 nonce 与吊销集必须落共享 store（`worker-key.ts` 头注的后续单），进程内 `Map` 只允许单进程开发形态。
7. 现状缺口：stdio 版工具服务、challenge-proof 注册协议、`verifySealed`/`consumeNonce:false` 与共享 `WkeyAuthority` **均未实现**，登记为 U80-17（全部按目标，不得写成“已有”）。“daemon 保留 per-ticket wkey 至 attempt 结束”同样未实现（现状 `worker-key.ts:116` 注释口径为“daemon 侧不留副本”）。

〔结论〕`StudioToolsDeps` 按实际效果分流，不得绕过，也不得把所有工具调用都当成平台写：

| 现状依赖/工具 | 目标映射 |
|---|---|
| `ToolEnv.gateway`：`comment` / `article` | 先由 daemon 路由翻译成 `comments.add` / `kb.upsert`，再走 `TS-PORT-EFF-01 EffectGateway.apply`（权源、双层 scope、fence、效果尝试与幂等键）；不得只凭低层动词扩大授权 |
| `ToolEnv.gateway`：`heartbeat` | 先经共享 `WkeyAuthority` 验签，再由 daemon 经 `TS-PORT-REC-01` 追加 `REC-EVT-01` 活性观察（实际主体、单据、观察时刻；**不是**平台写、不走 EffectGateway、不证明工作完成）；失败如实返回，不能只回署名冒充活性已记录 |
| `writeEvidence(path, content)` | worker **只写材料目录**（工作区内的 `evidence/` 沙箱路径，路径 containment 强制）；**不是**任意落盘。收割归 daemon 的 `TS-PORT-EVD-01`，且它是**只读收割**（只读材料、产出证据记录），不得被写成“任意写盘工具”或反向接收 worker 的写入结果 |
| `searchKb(query)` | `TS-PORT-REC-02 RecordReader.query`（带 `knowledgeScope` 与必填 `limit`/`order`，超范围不可见；`nextCursor` 原样返回，不得丢掉） |
| `queryBudget(issue)` | 预算**只读视图**（`TS-PORT-REC-03` 投影），不可写 |

### 11.5 纯配置不能证明安全

〔结论〕公司定义包是纯配置，不含可执行内容（76-§4.3）。但：

1. 纯配置仍可**声明**危险行为（如把 `route='gate'` 指到不存在的档）；
2. 装载器必须做交叉校验（现状 `coastGuard` 档名唯一、`route='gate'` 至多一档，`CompanySnapshot.costGuard` 注释）；
3. 校验通过 ≠ 安全：规则求值的 `refused` 必须被当拒绝，不得当“通过”。

### 11.6 日志与观测的秘密边界

〔结论〕

- 日志行不得含凭据值、完整 token、内部绝对路径、MXID 密码；
- 事件 `note` 不得含秘密；`redactOutbound` 必须覆盖；
- 面板/API 的错误响应不得回传堆栈原文；只回 `subcause` + 请求 id；
- 测试夹具里的“假秘密”必须形如 `test-*`，不得用真实值。

---

## 十二、接缝、不做、反例与未证

### 12.1 与 78（绑定）的调用接缝

〔结论〕78 的绑定档案通过**四个注入面**进入本卷的运行时，不通过 import：

| 接缝 | 78 提供 | 80 消费 | 现状锚 |
|---|---|---|---|
| 平台绑定 | 端点、认证、字段/状态映射、损失 | `wirePlatform(config)` → `FlowPlatform` | `assembly/platform/wire.ts` |
| 执行绑定 | DSH/CLI 的启动、流、账目 | `ExecutorAdapter` 注册表 | `adapters/src/registry.ts` |
| 通信绑定 | Matrix 的源、频道供给、广播、人事 | `InvokeSource` / `MatrixRoomFace` / `NotifyBroadcastFace` / `MatrixHrFace`（由 `RunServeOpts.matrixSessionFactory` 返回） | `apps/boot/src/boot.ts`（构造工厂）；登录与四面归属 `runServe` |
| 存储绑定 | SQLite 台账 schema 与迁移 | `Ledger` / `RecordWriter` / `RecordReader` | `store/src/ledger/`（投影表族）+ `store/src/records/`（`records`/`record_payloads`/`record_transactions`，**未实现**） |

〔结论〕四面的共同纪律：**daemon 不 import 绑定包的实现**。现状已如此：`daemon` 不 import `@studio-next/matrix`（`serve.ts:118`–`:122` 注释），Matrix 面经 boot 注入；目标态改为**daemon 调 `matrixSessionFactory` 建会话拿面**（工厂由 boot 构造，edge 仍是 `boot→matrix`，daemon 侧仍无 import）。`daemon` 依赖 `yt/taiga/localplatform` 是通过 `wirePlatform` 的工厂选择，属装配层。

〔结论〕78 的“损失报告”必须能进 `PlatformBindingPort.describe()` 的 `loss`，否则绑定档案与运行时不连通。

〔结论〕**未知回执的接缝在 78-§9.6**：平台侧“没回执”“回执歧义”“回执迟到”三种情形由绑定层给出可判别的描述，daemon 侧只负责“未知 → 对账（`TS-PORT-REC-06`）→ 不得直写重试”（§8.4）。绑定层若把三种情形压成一个“失败”，本卷的对账路径就无从触发——这是面与面的接口约束，不是实现细节。

### 12.2 与 79（构建与 exports）的一致

〔事实〕79-§6.1 定的不是“两个包先切”，而是一条**依赖闭包**链：可切 `dist` ⇔ 该包全部 workspace 依赖已切 `dist` 或零 workspace 依赖；首条可证链为 `dsh-bridge`（零依赖，L0）→ `contract`（仅 zod，L1）→ `gateway`（contract，L2）→ `studio-tools`（contract + gateway，L3）。闭包之外的仓内私有包（`core`/`store`/`company`/`prompt`/`api`/`panel`/`adapters`/`yt`/`taiga`/`localplatform`/`matrix`/`daemon`/`boot`）一律维持 `src`；`daemon`/`boot` 不纳入分发（79-§7.7）。另需记住 79-§5 的三个陷阱（`noEmit` 继承、`noEmit`+`emitDeclarationOnly` 零产出却退出 0、`.d.ts` 不重写 `.ts` 说明符）。

〔结论〕本卷的类型设计必须与构建形态兼容：

1. 所有公开类型必须能被 `tsc` 发射为 `.d.ts`；不得依赖 `const enum`（已禁）或私有名义类型；
2. **消费方分两类，不得混成一句**：
   - **TS 消费者**（`tsc`、编辑器语言服务）：79-§5.5 的三组探针（`nodenext`/`node16`/`bundler`）全绿，且声明解析对 `.ts` 说明符有内建降级（`shouldAllowImportingTsExtension` 在声明文件里恒真，会落同级 `.d.ts`）。因此 TS 消费者**不需要 bundler，也不需要后处理**。旧稿“消费方需 bundler 或 `allowImportingTsExtensions`”是错的：`allowImportingTsExtensions` 是**本仓**的编译选项（79-§5.3，与 `rewriteRelativeImportExtensions` 同时开启），不是消费者要开的开关；
   - **非 TS 消费者**：文本/AST 型 API 提取器与文档工具、打包器（esbuild/rollup/webpack）、`checkJs`/JSDoc，均仍是 79-§5.4/§5.5 的 **U1 未证项**（只有出现具体反例才评估幂等后处理）。本卷不声称已解决，81 对应条目必须标“未证”；
3. `dsh-bridge` 的 `apply(ctx, config)` 是插件入口，**不得**引入对 `daemon`/`store` 的依赖（现状零依赖，保持）；
4. **切换顺序冻结为依赖闭包**：`dsh-bridge` → `contract` → `gateway` → `studio-tools`，每一级只在上一级 `dist` 存在且 `--listFiles` 拓扑断言通过后才开始；`contract`/`gateway` 切 `dist` 是 `studio-tools` 闭包的**连带结果**，不是各自的分发决定——`studio-tools` 若最终不对外，二者不必切；
5. 本卷的 `TS-PORT-*` 类型落 `contract`，使 `contract` 成为链上 L1；因此**先切 `contract`、再切 `gateway`**，且切 `contract` 前必须确认本卷公共面已冻结，否则会“一边切 dist、一边改公共面”。`studio-tools` 的工具集与 `GATEWAY_ACTIONS` 同表，切换前必须保证两者无漂移（它是链尾，天然在 `gateway` 之后）；
6. 闭包外维持 `src` 的包仍经 `exports` 读已切包的 `dist/*.d.ts`：改 `contract` 类型而不同步 `gateway`/`studio-tools` 的 `dist`，会在下游 `typecheck` 直接红——这是期望的失败，不是噪音。

〔结论〕本卷新增的 `TS-PORT-*` 类型若进入 `contract`，会改变 `contract` 的 `.d.ts` 体积与 `PORT_VERSION` 语义；在 `PORT_VERSION` 仍是 `v0` 时允许，但升级 `v1` 须走批示。§11.2-3 把 `redactOutbound`/`redactKnownSecrets`/`findSecretShaped` 迁入 `contract` 属**运行期导出**（不只是类型）：同样计入公共面，`PORT_VERSION` 的语义必须覆盖函数签名与行为，不能只盯类型名；此类导出的不兼容变更与类型不兼容变更同级。

### 12.3 与 81（逐文件契约）的输入

〔结论〕81 从本卷取六件：

1. §6 的端口清单与状态（新建/包装/已有）→ 决定哪些文件存在；
2. §7 的相位内步骤 → 决定 `engine/tick/` 的文件边界；
3. §10 的拆分目标 → 决定目录与文件 ID（`F-<包>-<名称>`）；
4. §4 的类型名 + §6/§11.2.1 的端口落点 → 决定 `contract` 的文件归属（**本卷已给定两个新文件落点，81 不得另起路径**：`contract/src/ports/intent.ts`——`IntentSubmissionPort` 及其公共形状/`IntentReceipt`（§6.6）；`contract/src/ports/secret.ts`——`SecretCatalogEntry`/`SecretProvider`/`SecretMaterial`/`KnownSecretSet`（§11.2.1））；
5. §8 的注入点 → 决定测试文件的覆盖；
6. §12.5 的未证项 → 决定 81 里哪些条目必须标“未证”。

〔结论〕81 **不得**自己设计接口。若 81 发现本卷缺少某端口，应回来补本卷（走编辑），不得在 81 里私设。

### 12.4 与 82（验证与迁移）的输入

〔结论〕本卷给 82 三类输入：

| 输入 | 内容 | 对应的 82 层 |
|---|---|---|
| 失败路径 | §6 每个端口的错误码 + §8.8 三条不变量 | V2 行为契约 / V4 故障 |
| 迁移约束 | §10 的拆分顺序、§9.4 的 M1–M5、§2.3 的包边更正 | 迁移波次与兼容点 |
| 未证清单 | §12.5 | V3/V5 的探针设计 |

### 12.5 未验证边界（不得当成支持）

| # | 未证项 | 为什么未证 | 需要的探针 / 负向结果 |
|---|---|---|---|
| U80-01 | `studio-next/jcs@1` 的字节确定性 | 76-§12 自认向量未执行 | 跑 76 附录向量；跨实现比对 |
| U80-02 | `.d.ts` 的 `.ts` 说明符兼容（**非 TS 消费者**） | TS 消费者已由 79-§5.5 三组探针证绿；文本/AST 工具、打包器、`checkJs`/JSDoc 仍是 79-§5.4/§5.5 的 U1，非 TS 侧无证据 | 真实 `tsc` 发射 + 三类非 TS 消费者逐一加载；出现反例才评估幂等后处理 |
| U80-03 | Bun 绿灯 = Node 可跑 | 79-§1.1 | 两者分别跑同一套 |
| U80-04 | 跨进程写者围栏 | 现状只有进程内 TTL | 双进程双写负向测试 |
| U80-05 | 六段写协议的崩溃恢复 | 五个注入点只覆盖现状语义 | 新增 §8.7 注入点 + kill 测试 |
| U80-06 | 五门与并发闸的组合语义 | 五门未实现 | 合同不全 + 资源空闲 → 必须不派 |
| U80-07 | 验收独立性 | 现状只有闸门 exit 0 | 同主体交付+验收 → 必须拒 |
| U80-08 | 六态投影 | 现状 `ok: true` | 断源/陈旧/冲突三态负向 |
| U80-09 | `:8788` 迁移后 `panel` 无外部面 | 迁移未做 | 删除 `./external` 后全仓 import 检查 |
| U80-10 | 记忆四层不合并 | 无实现 | 跨层读负向 |
| U80-11 | 迟到副作用对账 | 无实现 | 外部延迟回执 + 超时重试 |
| U80-12 | 归档上限 | 未实现 | 超量/超深/膨胀比负向 |
| U80-13 | 注入式 API 迁移不改包边 | 迁移未做 | 迁移后全仓检查 `api` 的 import 不含 `panel`；`allowedPackageEdges` 未新增 `api→panel`；`bun run guard:boundaries` 仍绿 |
| U80-14 | 50 类 `REC-*` 的 record→port 覆盖 | §4.7 是按 77 字段表人工比对，无执行校验 | 逐类走一遍“写→读→投影”三向，缺任一即补；空档类必须显式登记而非沉默 |
| U80-15 | 外部意图通道（API→daemon）与幂等回执 | 现状无通道；`engine.ingest(intents): void` 是 fire-and-forget，目标 `emitIntent: Promise<Result<IntentSubmitResult, ClassifiedError>>` + `getIntentReceipt(key: IntentKey)` **转发 `IntentIngress`**（`WorkIntake.reserve` 落 `REC-WORK-01` → 同事务表投影 + commit 后快照 → `ingest` → 回执，§6.6/§9.4） | 端到端：外部 `POST /v1/requests` → daemon 相位 2 受理 → 平台落单一单且仅一单；记录先于投影：`REC-WORK-01` 先落、`intentRef` 立即可查，且 `IntentKey` 由 `source.channel/dedupKey/ticket` + `companyRef` 还原（不从 payload 猜）；幂等四态：同键同摘要+`decided` 不入队、+`queued` 重新入队、+`unknown` 先对账、不同摘要 → 409（**判定一律按记录现算**，不得用 `get()` 快照）；TTL：`queued` 不因过期放行、`decided` 过期另立须 `lineage.supersedes`、`unknown` 未对账不得过期；未知判据四类：完整链 → `unknown`+`unknownRef`、部分链 → `unknown`+真 `unknownRef`+`gap:['unknown-link-missing']`、孤儿未知覆盖范围与键相交 → `unknown`+`gap`、**非意图未知不影响任何键**（`REC-OBS-02` 只承载孤儿/缺口，不提供 `outcome`）；`gap` 词表封闭为 `'unknown-link-missing'`/`'intake-link-missing'`；**投影与记录同事务**（`get` 永不可能读到“记录已 `decided`、快照仍 `queued`”）；`reserve` 与 `ingest` 之间 kill → 重启重放 `queued` 且不重复物化；`rebuild()` 失败 → **拒启动**；负向：`ingress` 缺失时启动即拒，不得回落直写；202 不得被写成 `accepted`；运行期库故障不得被 `receipt()` 读成 `undefined`（须由写面/`refresh`/健康观测报错）；**回执查询端点**（`GET /v1/requests/status`，未实现）：只读 `ingress.receipt(key)` 的**本进程已提交快照**，不重放、不直查库、不触发物化；键四槽 = `company`/`source`/`kind`/（`ticket ?? dedupKey`），与 `IntentKey` 逐位对应；快照 `undefined` ⇒ `503`（subcause `receipt-not-in-snapshot`；**不得**回 404、不得回 200 空体、不得回落查库），命中 ⇒ `200 { receipt }` + `Cache-Control: no-store`；连查 3 次不新增记录、不重放、不改变回执；缺 `dedupKey` 或参数超长/非法字符（长度 >256、字符集超 `[A-Za-z0-9._:-]`）⇒ `422`；路由拼错 ⇒ `404`（`rejected_precondition`/`EXTERNAL_REJECT`，不得当演进故障） |
| U80-16 | 多进程并发迁移 | `openLedger` 无条件 `migrate`，而开库点共 **14 处**（`ledger.ts:513`–`:515`；daemon 1 + panel/overview/external 3 + CLI 8 + `store/rebuild.ts`/`store/drill.ts`），任意一个先起都可能改 schema；并发后果未测 | 目标态：只读打开不跑 DDL + daemon 独占窗口（§8.2）；负向：daemon 运行中起 `studio-next ledger`/`drill`，应拒起而非各自迁移 |
| U80-17 | `studio-tools` 的 stdio 工具服务/本地代理（daemon 侧验签） | 现状只有 `InMemoryTransport`（`server.test.ts:15`）；stdio 未实现（U80 口径：全部按目标），`wkey()` 由宿主直注（`server.ts:92`–`:97`）；worker 进程无法安全持有 `gatewaySecret` 做验签。目标形态：stdio 只作传输层（stdout 仅 JSON-RPC 帧、日志走 stderr），helper 经本地 socket（`run/daemon.sock` 或 `STUDIO_DAEMON_SOCK`）走**三步注册** `register{helperId,pid,wkeyRef}` → `registerChallenge{challenge,alg,expiresAt}` → `registerProof{proof}` → `registerAck`，此后 `call{reqId,tool,args}` 收 `verdict{reqId,verdict,result?,failure?}`；验签/吊销/审计/平台写全在 daemon 侧（§11.4.1）。**未证**：`WkeyAuthority.verifySealed`（完整验签但不消费 nonce）尚不存在；共享 `WkeyAuthority`（现在每 `createGateway` 新建，`gateway.ts:65`）未改；daemon 保留 per-ticket wkey 至 attempt 结束未实现（现状 `worker-key.ts:116` 注释为"不留副本"） | 探针：worker **只持本单**的 per-ticket `wkey`（env `STUDIO_TOOLS_WKEY`）与 scope，**不持** `gatewaySecret`、不持他单凭据、不持任何 `SEC-*` catalog 秘密值；**proof 验证成功后该 wkey 的 nonce 仍可用**（后续真实写调用不得撞 `replay`）——被消费的是 challenge，不是 wkey 的 nonce；**每次 `call` 由 daemon 现签内部调用 key（一调用一签发）**，该 key 不回传 helper、不进 `verdict`（行为与现状一致，不得改成复用单个 key）；同一 `(ticket,nonce)` 第二个活跃会话注册必须 `ok:false`；challenge 过期/复用/换连接挪用必须拒并断连；`registerAck` 丢失后重连须发新 challenge（不得因 ack 丢失永久锁死）；伪造 proof / 错上下文前缀 / 异长 proof 必须常量时间拒；重放 / 已吊销 wkey 必须被 daemon 侧拒；未注册 helper 的 `call` 一律 `deny` 且不触达平台；**帧里出现任何 catalog 秘密原值（`SEC-*` 的值、密码、token 原文）即判负**——但 `wkeyRef` 是**合法引用字段**，出现它不算泄漏（不得把“帧里出现 `SEC-` 字样”当判负条件，判据是**原值**）；连接断开后未重注册的 `call` 必须 `deny`；`registerProof` 的 HMAC 输入必须恰为 `studio-next/jcs@1` 规范化的**五键**（`challenge`/`helperId`/`pid`/`protocol`/`wkeyRef`，字典序、无空白、UTF-8 字节）且 `alg='hmac-sha256-v1'`，改键序/加空白/换域串/换算法**必拒**；82 登记的固定**假**向量三件须全过（JCS 字节逐字节一致、`alg`+域串绑定、异长或改一字节必拒）；socket 目录 `0700`/文件 `0600`/`umask 0077`/拒符号链接**只作部署边界**，不得据此宣称“已核对端 uid”；宿主未注入已验证适配时连接状态为 `unverified`，日志/审计/上报不得出现 `peer-verified` 或“peer uid 已核”；`kind:'host-bound'` 且 `verify` 返回 `uid !== daemon uid` ⇒ 拒注册并断连，`verify` 返回 `Err` ⇒ 同样按 `unverified` 处置、不得放行；**同 uid ≠ 已授权**：同 uid 另一进程自报 `helperId` 直接 `call` ⇒ `deny`；stdout 混入日志即判负；socket 路径/权限/注册信息不进日志 |
| U80-18 | 秘密供给面 `contract/src/ports/secret.ts`（`SecretCatalogEntry`/`SecretProvider`/`SecretMaterial`/`KnownSecretSet`，§11.2.1）+ 配置面 `ServeConfig.secrets` + Matrix 登录工厂 `RunServeOpts.matrixSessionFactory` | 全仓无此文件与四个类型（`packages/contract/src/ports/` 无 `secret.ts`，grep 零命中）；`ServeConfig` 无 `secrets` 键、`RunServeOpts` 无 `matrixSessionFactory`；现状秘密经 env 直读 + `hrKnownSecrets` 字面量（`serve.ts:913`/`:1143`、`hrsync/assemble.ts:38`），无 catalog、无 `use` 校验、无轮换/吊销重建路径；登录仍由 boot 承担（`boot.ts:20`）；78 的部署侧 `SecretCatalog` 已定 `allowedUses` 六值域，本卷 §11.2.1 已按**两用途**写 bot 条目（78 已同步为恰两用途，S10 设计面关闭），**均无实现**；`redactKnown` 作为 `KnownSecretSet` 方法尚不存在 | 探针：`use ∉ allowedUses` 必须 `rejected_forbidden` 且不返回值；**秘密句柄分型（不许混用）**：`login` 只接受 `SEC-MX-BOT-PASSWORD` + `use:'platform-auth'` + `kind:'password'`；`registration` 只接受 `SEC-MX-HR-SHARED` + `use:'matrix-register'` + `kind:'shared-secret'`（**不得**用 bot 密码建 HR 账号——同一 `secretId` 换 `use` 即 `rejected_forbidden`，不是“同义别名”）；**bot 条目用途恰两项**：catalog 里 `SEC-MX-BOT-PASSWORD` 的 `allowedUses` 必须是 `platform-auth`+`outbound-redaction`，出现 `matrix-register` ⇒ 配置错误、拒启动该能力（不得当“空闲/备用用途”接受，也不得走旁路）；**仅建号能力开启时**才 `load` `registration`，建号开启而该项缺失/空值 ⇒ **拒启动该能力**（不得降级成“只登录”后悄悄跳建号），建号关闭时该项 `load` 次数为 0；**配置面拒收**：`secrets` 里出现任何内联值/未登记键/`catalog` 元素缺字段 ⇒ 拒启动，且拒启时不得打出该值；**能力关闭不加载**：`external.enabled=false` 或 Matrix/HR 面关闭时 `load` 调用次数为 0（不得"顺手全量加载"）；**范围外不加载**：`subjectScope` 不覆盖本部署的条目不 `load`；`broker-ref` 无已注册 `brokerBinding` ⇒ 该条 `unavailable` 并按可选/必需处置（不得回落 env 猜值）；**登录在 daemon**：给出 `matrixSessionFactory` 后，boot 侧零登录、零 token 持有，daemon 用 `SEC-MX-BOT-PASSWORD`（`MatrixBotLoginSecret.material`，`use:'platform-auth'`）调工厂驱动登录；**返回值必须是四个工厂/面本身**（`matrixSource: () => InvokeSource`、`matrixRoomFace: (ctx) => MatrixRoomFace`、`hrMatrixFace: () => MatrixHrFace`、`notifyBroadcast: NotifyBroadcastFace`）+ `close()`，不得是已构造好的 source/room 面（给了即判负）；`secretId`/`kind`/`use` 三槽任一处不符 ⇒ 拒启动该能力、不降级；**工厂与任一直接面同时出现 ⇒ `CONFIG_INVALID` 拒启动**（**不判“矛盾”**：两者是否冲突启动期不可判，故不比较、也不择一静默），单独给四面的直接注入或单独给工厂都合法（前者测试/迁移、后者生产）；句柄 `kind` 判别：`kind:'password'` 与 `'shared-secret'` 不得互认（不得按值长度/形状猜）；会话 access token 无静态 `secretId`、不进帧/日志/PRM；`load` 返回空串/零字节 ⇒ `rejected_precondition` + `subcause:'secret-empty'` 且**不返回材料**（不得当“已加载空秘密”继续用），provider 不可用 ⇒ `unavailable`，条目撤销/版本不符 ⇒ `rejected_version`；装配期必需项 `Err` ⇒ 启动失败映射 `CONFIG_INVALID` 并**保留 cause**（不得改写成“缺失”），选项失败 ⇒ `REC-LOSS-01`；`known-set-empty`（无可选秘密）可启动、`known-set-partial`（必需缺失）必须拒启动该能力并落 `REC-LOSS-01`；per-ticket `wkey` 只在活跃期入集合、`CLOSE` 即移除；**轮换/吊销**：触发源只有两个——文件 mtime/`version` 变化、部署控制通道下发；命中即**整体重建**（不逐项热替换）；无通知时轮询有界（≥60s，只 `stat` 不读值）；重建失败**保留旧可用集**但标 `known-set-partial` 并落 `REC-LOSS-01`，且**禁止新秘密用途**（已加载面不停摆、不清空），吊销项优先于新增项；轮换只递增 `version` 不改 `secretId`；负向：空集合 + 仅形状正则仍返回"已处理"文本即判负；**`find(text).length>0` 不得成为拒绝条件**（示例/夹具命中形状属正常）；出站面用 `redact`、内部面用 `redactKnown` 逐点命中；worker 与 stdout/日志/REPORT/导出不出现秘密**原值**（`wkeyRef` 等引用合法） |
| U80-19 | 投影重建与启动序（`IntentReceiptStore.rebuild` / projection hook / 内存快照） | `intent_receipts` 表、`createIntentReceiptStore`、projection hook、内存快照均不存在（§6.6）；"同事务表投影 + commit 后快照"是目标不是现状 | 探针四点注入：记录提交前 kill / 提交后快照更新前 kill / 投影写后 kill / `rebuild` 中途 kill；每种情形重启后**不得**出现“记录 `decided`、表或快照仍 `queued`”，且启动 `rebuild` 后表与快照逐字段一致；`rebuild()` 返回 `TableProjectionResult` 且 `kind='table'`/`name='intentReceipts'`/`cursor=null`；**重建先于 API 装配**：在 `rebuild` 未完成前不得有 `receipt()` 可服务（装配顺序可观测，早装配即判负）；`rebuild` 失败 → 进程拒启动（exit≠0）而非带空投影起服；增量 `refresh` 与全量 `rebuild` 结果一致；负向：`get()` 在库不可读时仍返回旧快照（不得返回 `undefined`），而写面/`refresh` 必须报 `unavailable` |
| U80-20 | 资源账目（`TS-PORT-RES-01 ResourceAccountant`） | 无 `core/src/resources/*`、无投影表/hook；该字段 77 已有（`REC-WORK-05.resource_reservations`，77-§4.5.1），缺的是 80 侧端口与派生；本端口**只有 `baseline`/`gap` 两个只读方法**，公共 `reserve`/`actual`/`release` 一律不存在 | 探针：**公共面没有写口**——类型面与运行面都取不到 `reserve`/`actual`/`release`（给了即判负）；预留随计划锁写入 `REC-WORK-05.resource_reservations`，超预留由**计划锁**拒（`rejected_state`），不是由本端口拒；`baseline()` 只读且可重算：同一 `(subjectRef, quotaRef, asOf)` 两次结果逐字段一致；`entries` 逐资源、`limit` 三态（`finite`/`unbounded`/`unknown`）、`reserved`/`consumed`/`remaining` 缺省为**未知**而非 0；负向：额度读不到或预留记录缺失时**不得**返回“剩余=全部/0/无限”，必须给 `gaps`（`quota-unreadable`/`reservation-record-missing`）且 `Ok`；**有限额度下 `reserved`/`consumed` 任一缺省 ⇒ 必给 `reservation-record-missing`/`unreconciled-actual`，该 entry 不给 `remaining`、资源门不得据此判充足**（等式 `remaining = limit.amount − reserved − consumed` 只在三值齐备时校验）；投影行与记录同事务、删表可由记录重建（重启后逐字段一致）；跨环（同一 `subjectRef` 多单）累计不重复计数 |
| U80-21 | 完整信封 + 原始载荷的持久化（`records` / `record_payloads` / `record_transactions`，§6.3 存储不变量） | 三张表**都不存在**（78 无 records DDL；`events` 17 列没有 `basis/scope/provenance/integrity/knowledge/payloadRef/lineage`，也没存字节）；`RecordWriter.append(env)` 结构性不可实现、`RecordReader` 无 `payload(...)`；`commitSeq`/`proofRef` 无落点、schema 迁移不产 `REC-MIG-01`（81/03 的 D1/D6/D7 即此缺口）。**全部未实现** | 探针：整封往返逐字段一致（含 `integrity`/`knowledge`/`lineage`）；字节读回重算 `byteDigest` 一致、改一字节 ⇒ `payload-digest-mismatch`；缺载荷/字节不可重读 ⇒ 拒写且**库内零行**；`payload(ref)` 无权读该信封 ⇒ `Err(rejected_forbidden)`（**不得** `Ok(undefined)`、不得靠 `ref` 绕过 `knowledgeScope`）；跨权查询看不到行也不透出总数；信封+载荷同事务（一处失败整体回滚）；`commitSeq` 唯一单调且由提交事务分配，`proofRef` 指向同事务的 `REC-RCP-01`，**不存在已提交无证明的行**；`authorityDomain` 多域歧义时缺失 ⇒ 拒写、与 `TxScope` 域不一致 ⇒ 拒；`since`/`asOf` 同给 ⇒ `projection-source-invalid`；重建 `records` 后增量与全量结果逐字段一致 |

〔结论〕上表任何一项都不得在 82 之前被写成“已支持”。本卷所有“目标”段落同理。U80-13～U80-21 与既有 12 项并列计入（共 21 项），§12.4 的“未证清单”随之扩为 21 行。

### 12.6 明确不做

1. **不新增概念层**：76/77 的对象不在本卷重定义。
2. **不新增包**：不建 `spec`/`engine`/`runtime`/`records`/`memory` 包。
3. **不新增允许边**：如需新边，走提案流；本卷只登记缺口。
4. **不提高阈值/基线**：`25`/`600`/域平面基线只许下降。
5. **不把 `EventRecord` 改名冒充 `RecordEnvelope`**。
6. **不把 `FlowPlatform` 改名冒充 `PlatformBinding`**。
7. **不把 `TaskBrief` 当合同、`CLOSE` 当结清、`decide` 当五门**。
8. **不把 Bun 当 daemon 运行时**，不把 `bun build --compile` 当 Node 等价分发。
9. **不声称 `:8788` 已迁移、`:8789` 已统一口径、`:8791` 已六态**。
10. **不声称 V2–V6 已执行**；本卷零测试运行。
11. **不写生产代码**：本卷的伪签名不是实现，不落 `.ts` 文件。
12. **不替制作人定**：loopback/LAN 的部署策略、对外端口的稳定承诺与许可口径、产品覆盖面（哪些公司/岗位/流程先接）、DSH 是否作为主执行体被替换、公开规范的维护责任与公开范围。

〔说明〕以下各项**本卷已定**，不再作为待决问题上呈：`index.ts` 按 §3.2 收敛（删包根 → 纯再导出 → 退役）；`RunServeOpts` 按 §3.4 补 `notifyBroadcast` 并收口三处；`PORT_VERSION` 暂维 `v0`；`panel → company` 移入 `dependencies`；API 由 daemon 的 **assembly 域**装配（`runServe` 内同进程、`emitIntent`/`getIntentReceipt` 转发 `IntentIngress`），`POST /v1/requests` 只产意图（§9.4）；派发前“先五门后并发四闸”；收尾“先结清后 `CLOSE`”（含终止/清算闭环）；§8.7 注入点命名；只读进程不跑 DDL（§8.2）。上表第 12 条**只**保留真正需要制作人裁决的五项。

### 12.7 接口反例（判负清单）

| 反例 | 为什么判负 | 正确做法 |
|---|---|---|
| `gateWrite` 失败后直调 `platform.issues.transition` | 绕过唯一写口 | 拒绝即拒绝，如实分类 |
| 用 `errors.push('采集失败')` 代替 `REC-EVT-03` | 未知被压成字符串，面板无法判态 | 写未知记录，带范围 |
| 用 `HOLD_*` 表示五门不过 | 并发闸与开工门混为一谈 | 五门单独出 `REC-WORK-04` |
| `GATE_PASS` 即结清 | 完成≠接受≠结清 | 三步分别记录 |
| 面板未知显示 0 | 假绿 | 显示 `unknown`/`gap`（见 §9.6） |
| 用 `Math.random()` 生成 nonce | 不可注入、不可复现 | 调用方给 nonce |
| 用 `Date.now()` 判租约到期且允许回拨 | 租约永不过期 | 持久 `expiresAt` + 启动校准 |
| 把 `generation` 写进 `fenceToken` | 治理代次与技术围栏混用 | 两个字段、两套记录 |
| 在事务里 `await fetch` | 事务跨事件循环 | 移出事务 |
| 重试前不查回执 | 双写 | 先查回执，再决定 |
| `import '@studio-next/daemon'` 触发横幅并退出 | 包根有副作用 | §3.2 收敛方案：先删包根 `main`/`exports["."]`，再改纯再导出，最后退役 `index.ts` |
| 新 CLI 命令塞进 `main.ts` | 绕过目录预算 | 一命令一模块 |
| 用 `any` 接平台响应 | 失去校验 | `unknown` + 收窄 |
| 用 brand 类型声称“已授权” | 类型不证明权限 | 记录 + 网关 |

### 12.8 锚点核对表

本卷写作时实际核对的锚点（“取用内容”只到本次引用粒度）：

| 锚点 | 取用内容 |
|---|---|
| 75-§0.1/§0.2/§一/§2.1/§五/§八 | 四类标记与四态、四种效力、卷间边界、ID 前缀、逐文件模板（81 用）、不做清单 |
| 75-D75-03/04/05/06/07/08/09/10/11/12/13/14/15 | 保留分层、包分型、权威三段、事实与投影分离、Node/Bun 分工、冻结工件、版本锁、依赖最小化、组件归位、交接优先、安全入契约、版本钉住、验证分层 |
| 76-§1.2 | 标量族：`timestamp`（必带 `Z` 或 `±hh:mm`、秒必填、小数秒≤9）与 `decimal`（可带负号、**禁前导零**、**禁指数**、有效数字≤34、标度缺省≤9）的语法 |
| 76-§1.3 | 标识与命名：`qid = <namespace>/<kind>/<local>`，namespace 1–4 段 `token`、local `[A-Za-z0-9._~-]{1,128}` 大小写敏感，`kind` 封闭表 |
| 76-§1.4/§1.5 | 版本与版本约束、原始字节与规范化语义摘要 |
| 76-§2.8 | 导入六步 |
| 76-§4.2/§4.3/§4.4 | 信封（`integrity` 至少一摘要、`scope` 与 `lineage` 不一致即拒收、`knowledge` 不得缺省“全部可见”、`recordType` 必须已登记、`payload` 自带 ID 须同 `recordId`）、来源、六类引用 |
| 76-§6 | 规则语言：四结果、诊断码、限额、确定性 |
| 76-§8.3/§8.4 | `REC-MIG-01`、`REC-LOSS-01`（不属 77 的 50 类，见 §4.8） |
| 76-§8/§12/§13.4 | 版本轴与规范化、未证项、与 80 的接口 |
| 77-§0.5/§0.6 | 50 类记录与 29 个协议编号 |
| 77-§1.2/§1.7/§1.8 | 身份与版本、一个语义事件一个 recordId、decision facet 十类、生效分工 |
| 77-§2.3.1 | decision facet 六槽位（`decided_by`/`authority_ref`/`rationale`+`basis_refs`/`scope_judged`/`dissent_position`/`effective_state`+`effective_time`）、facet 权威而顶层只读投影 |
| 77-§2–§10 | 各记录字段表与状态迁移（T01–T26） |
| 77-§11.1 | 14 类失败分类（下划线字面量，见 §5.7） |
| 77-附录 A | 50 类总表与初始类型版本 `1.0.0` |
| 78a-§2.3/§5 | DSH 沙箱强弱面、四平面与窄腰 |
| 78-§1.3/§1.4 | 十三态生命周期与可举证证据（“已加载”要求部署供给确认）、供给与授权与生效三条线 |
| 78-§9.6 | 未知回执与对账（迟到副作用、重试前查回执的依据） |
| 79-§1.1/§1.2/§1.3 | Node strip / Bun transform、可擦除语法、tsconfig |
| 79-§2/§3/§4 | TS 惯例、zod 边界、import 规则 |
| 79-§5/§6 | 双轨构建与三陷阱、exports 切换顺序 |
| 79-§10.1 | 依赖分类裁决：`panel → company` 移入 `dependencies` |
| 79-§10/§12 | 依赖清理目标、漂移登记 D10/D11（其中 D10 指测试不进 `typecheck`，与目录预算无关） |
| `scripts/guards/boundary-rules.mjs` | 层位、38 条允许边、域平面基线、25/600、`lineBaseline` 22 条 |
| `packages/contract/src/ports/*` | 现有端口形状（`notifier.ts`、`merge-gate.ts`、`kernel.ts`） |
| `packages/contract/src/schemas/events.ts` | `EVENT_NAMES`（`:62`–`:96`）与前缀族（`:99`） |
| `apps/daemon/src/index.ts` / `cli/main.ts` / `assembly/serve.ts` / `engine/engine.ts` / `apps/boot/src/boot.ts` | 入口与主循环现状（含 `cli` 22 文件 / 18 命令、`test/engine` 25 顶格） |
| `apps/daemon/src/assembly/hrsync/run-serve-opts.ts` | 已存在的 `RunServeOpts`（三键，缺 `notifyBroadcast`） |
| `packages/panel/src/*` | 三面路由、绑定地址、`:8788` 现状（`external/server.ts` 571 行、`:487` 平台直写、`:491` 台账直写） |
| `packages/api/src/index.ts` | 43 行骨架，零路由、零 `src` import |

---

## 十三、工程决策记录与上呈项

本节不是提问清单。凡本卷能依 75/76/77/78/79 与仓内事实定下的，一律已定并在此登记，供 81/82 直接施工；只有真正需要制作人拍板的五项留在末尾。

### 13.1 本卷已定（施工方可直接照做）

| # | 决策 | 依据 | 施工含义 |
|---|---|---|---|
| D1 | `src/index.ts` 按 §3.2 单一方案收敛 | §3.1 现无包根消费者；`root→assembly` 是唯一合法纵边 | 三步不可倒：删 `main`/`exports["."]` 并改入口脚本 → 纯再导出 → 零消费者后退役 |
| D2 | `RunServeOpts` 以 `run-serve-opts.ts` 为唯一来源，补两个键：`notifyBroadcast` 与 `matrixSessionFactory` | §3.4 三处使用面差异表、§3.4 第 10 条 | `runServe` 第二参、`buildServeRuntime` 第三参（`BuildRuntimeOpts = RunServeOpts & {…}`）、`BootOptions.serve` 全部引用它；`RunServeOpts` 经 `@studio-next/daemon/serve` 再导出 |
| D3 | `PORT_VERSION` 维持 `v0`，全端口按 `experimental` | §0.3 三级条件表，`beta` 四项当前全不满足 | 升 `v1`/`beta`/`stable` 必须在四项条件满足后由制作人批准；在那之前任何面不得写“稳定” |
| D4 | `panel → company` 移入 `dependencies` | 79-§10.1 第 1 条裁决；3 处 `src` import 运行期确需 | 只改依赖分类，不改加载面；不以下沉 `SLUG_RE` 为默认 |
| D5 | API 由 **daemon 的 assembly 域装配**：`assembly/api/assemble.ts` 在 `runServe` 内同进程调用，deps **只收 `ingress: Pick<IntentSubmissionPort,'submit'\|'receipt'>`（= `Pick<IntentIngress,…>`，不含 `replayQueued`）+ `ledgerPath` + `company` + `config`**（不收 `engine`），构造 HTTP 适配 / `company` 投影 / 只读台账 / `emitIntent`+`getIntentReceipt`（原样转发，不直引 `engine.ingest`）；`ingress` 由 `buildServeRuntime` 在启动第 6 步用 `createIntentIngress(deps)` 创建并**自己持有内部类型**（启动末调 `replayQueued()`）；`POST /v1/requests` 只产 `InvokeIntent{kind:'webhook'}` | §9.4 装配决策；唯一写入者；`daemon→api` 是真实边 | API 不碰库、不碰平台、不持引擎；配置关闭=该面不启动，配置开启缺件=**整机 `CONFIG_INVALID`**，不留空回调；`cli/external` 退役（或只打印迁移指引）；独立进程仅另审部署选项 |
| D6 | 派发前**先五门、后并发四闸**，断路器前置 | §6.4/§7.2；“能不能派”与“是否具备开工条件”是两问 | 五门不过不得进入闸序；断路器不计入闸数，全卷统一称“并发四闸” |
| D7 | 收尾**先结清、后 `CLOSE`**，记忆处置记录先于 `settle` | §7.6/§7.9；77-§6.8 结清八判据含“记忆已三路分流” | 顺序：记忆处置记录 → `settle` → `recycle`/`CLOSE`；失败不得静默 `CLOSE` |
| D8 | 恢复注入点命名与语义照 §8.7（含 `memory-disposition-written`） | 五个 kill 点 + 新增注入点表 | 名字即契约，81 的文件条目与 82 的 kill 测试按此命名 |
| D9 | API 迁移五步、顺序写死：下沉（`dayKeyOf`/`DAY_MS`→`contract`，三个 build* →`company`，HTTP 适配→`api`）→ api 接管路由（旧 export 不动）→ `assembly/api/assemble.ts` 接入 `runServe` 并接意图（`cli/external` 退役）→ 验证全部路由/认证/幂等/启动两态 → 最后删 `panel/external` | §9.4；删除旧面必须最后，改线之前删=断服 | `daemon→api` 保留为真实边；不得“先删边再调用”；**M3 依赖 D12 先落地**（否则 daemon 内起的 API 仍跑 DDL）；M4 未全绿不得进 M5 |
| D10 | 82 首批探针取 §12.5 的 **U80-05 / 06 / 07 / 08** | 四项都直接卡在“无证据即无完成”上：崩溃恢复、五门组合、验收独立、六态投影 | 首批跑不出结论，其余探针不得开跑 |
| D11 | 第二批探针取 **U80-04 / 09 / 10 / 16**；DSH / Matrix / Taiga 真机验证排最后 | 前几项可用 fake harness 与进程内注入证；真机面耗时且依赖外部可用性 | 真机不前置，避免把外部抖动记成实现缺陷；U80-16（并发迁移）排在 D12 落地之后 |
| D12 | 只读进程不跑 DDL：panel/overview/external/CLI 读命令一律只读打开；迁移只由 daemon 在独占窗口执行 | §8.2 事实（`openLedger` 无条件 `migrate`，**14 处开库点**：daemon/panel/overview/external + 8 个 CLI 命令 + `store/rebuild.ts`/`store/drill.ts`） | schema 落后/过新 ⇒ 拒起（`failure:'rejected_version'`、`category:'EVOLVE_REJECT'`、`subcause:'schema-behind'/'schema-ahead'`），不自动升级；**`CONFIG_INVALID` 只给路径/配置缺失**；`rebuild`/`drill` 只许离线维护窗口；并发迁移登记 U80-16；**D12 是 §9.4 M3 的前置** |
| D13 | 规则求值两阶段：`typecheck` → `evaluate`，纯函数只吃“已解析的 profile 值 + `profileRef` + 已声明输入 + `limits`” | §6.1（`RULE-01`）；76-§6.8/§6.9/§6.5 | 类型错误在求值前拒（`rejected_precondition`）；规则不可解析=`rejected_version`；`refused` 留 `Ok`；限额/超时不得折算 `false`；结果必带 `profileRef`/`inputsDigest`/`steps`；求值器不读宿主时间/网络/随机/模型 |
| D14 | 记录/事务/迁移/只读打开的公共形状统一到 §6.3（`ProjectionName`/`TxScope`/`TxHandle`/`TxReceipt`/`RecordQuery`/`AppendOptions`）、§6.6（`MigrationPlan`/`MigrationReceipt`）、§8.2（`openLedgerReadonly`） | 19 份逐文件附录各自造形状会导致同名异义 | 只读进程用 `ReadOnlyLedger`（禁 DDL 与 PRAGMA 结构变更）；schema 过新 `rejected_version` 拒起并交 daemon；不可逆迁移不得承诺自动回滚；`unknown` 提交走对账 |
| D15 | API 幂等与受理语义：`emitIntent: Promise<Result<IntentSubmitResult, ClassifiedError>>` + `getIntentReceipt(key: IntentKey)`，二者转发 `IntentIngress`；HTTP 状态码与 77 受理五值分开 | §9.4、§6.6；`engine.ingest(intents): void` 是 fire-and-forget，回执只在 ingress（`REC-WORK-01/02` + `REC-EVT-03` 的派生投影，映射见 §6.6） | 记录先于投影；同键同摘要+`decided` 不入队/`queued` 重新入队/`unknown` 先对账、不同摘要 → 409；202 只表示“收到”，五值进查询回执 body；未挂载 501；拒不得以空 `[]`/空串顶替；去重窗 24h **只对 `decided` 与已对账的 `unknown` 生效**（`queued` 不过期放行），`decided` 过期另立须 `lineage.supersedes` 链旧 `recordId`；同键多条按 `receivedAt` 最大者为当前回执 |
| D16 | 脱敏落 `contract`；stdio 工具面不拿全局秘密 | §11.2、§11.4.1 | `redactOutbound` 等为 `contract` 纯函数，`core` 只 re-export；禁新增 `api→core`/`gateway→core` 边；worker 只拿 per-ticket `wkey`，验签/nonce/吊销/审计/平台写集中 daemon |
| D17 | 映射纠正：`queueCarry`/`orderCandidates` 锚 `engine/todoqueue/queue.ts`；`repo-validate` 留 `company`；公共金额 `DecimalString` + 币种；公司本地日由公司时区决定；网关构造期验；`fakes.ts` 只许 demo/测试 | §7.2 2e、§2.1、§4.1 `TS-SCALAR-04/08/09`、§10.6、§11.1、§6.5 | 通用类型用真实名字 `MergeRunHost`（不写 `MergeHostView`）；`sha8` 只作展示、身份用完整 `semanticDigest`；`localDateKey` 的宿主时区版只作旧记录过渡；77 工作态与 core 平台流不得等同结清 |
| D18 | 规则面字段名与码表**以 76 为准**：诊断用 `location`/`expected`/`actual`（不写 `path`、不收进 `safeDetails`）；`limitsApplied` 由 `phase` 判别强制（`phase='limit'` 必填、其余不得出现）；`RuleLimits` 只装**七项可收紧**限额，另三项（模式输入长度/模式匹配步数/量词嵌套层数）**档内固定**、不进该类型；登记码 **18** 个（补 `W-RULE-002` → `policy`）；`RuleOutcome.profileRef.digest` 与 `inputsDigest` 均为 `semanticDigest` | 76-§1.7、§6.8、§6.9、§6.12、§13（字段名唯一性条款明确要求 80 侧改正） | 本卷不复制 76 的十向量与字段表；`phase='limit'` 的类型收窄跟随 76 现行码表，新增 limit 码须先改 76；`W-RULE-002` 与"允许"必须在诊断上可分辨 |
| D19 | 开工判断（`REC-WORK-04`）：**引用形状三分**（记录 `VersionRef<Qid>`、定义/策略 `DefinitionRef`、判据档 `ProfileRef`，**禁** `VersionRef<RecordRef>` 套嵌）；`judge_role` 为**逐门列表** `{gate,role}[]` 且与 `GateResult.role` 逐门一致；**逐门结论与整单共用同一三取值**（无独立词表）；**`role` 六值英→中一一映射唯一**（`assignee`=承接者、`authorizer`=授权者、`qualifier`=认定位置、`resource_owner`=资源责任者、`info_holder`=信息持有者、`prohibition_owner`=禁止清单所有者；英文只作内部承载，写入记录只有中文六值，不得另起 `roleCode` 之类第二套可写值）；判据/依据/具名判断者/逐门权源**从权威引用解析**，不从请求体自报；`refused` 只导致整单 `不可开工`，不新增第四取值 | 77-§4.4.1（`judge_role` 已定五门列表，并已写明“角色名就是 payload”）；§6.5 三值与方向表；§4.3 `TS-REF-02/06` | 请求体只承载引用与时间；五输入与五门一一对应、风险不进门；资源门输入是只读 `ResourceBaseline`（`TS-PORT-RES-01`）；`GateResult.criterionRef` 是规则档，不是记录 |
| D20 | `EffectOutcome` 两态**都必带回执引用**：`applied{receiptRef}` / `unknown{unknownRef, reason?}`；`applied` 先落 `REC-RCP-01`、`unknown` 先落 `REC-EVT-03` 才返 `Ok`；登记失败 ⇒ `Err(unavailable, STALL)`，"无引用的 `Ok(unknown)`"判负 | §5.2、§6.6 EFF-01；§6.6 映射表第 4 条（未知链按 `unknown_scope.intentRef` 反查） | `partial`/`rejected` 仍走 `Err`；`unknown` 不重试直写、先进对账 |
| D21 | 读面统一：`RecordReader.query` 与 `ReadOnlyLedger.query` 都返回 `Result<RecordPage<T>, ClassifiedError>`；**两个 `get` 也都有失败通道**——`RecordReader.get` 返回 `Promise<Result<RecordEnvelope<unknown> \| undefined, ClassifiedError>>`，`ReadOnlyLedger.get` 返回**同步** `Result<RecordEnvelope<unknown> \| undefined, ClassifiedError>`，`Ok(undefined)` 才表示“不存在”，运行期库失败一律 `Err({failure:'unavailable', category:'STALL', subcause:'ledger-read-failed'})`；三条查询 subcause 固定（`ledger-query-unsupported`/`ledger-cursor-invalid`/`ledger-query-invalid`），打开期失败保持 `db-missing`/`schema-behind`/`schema-ahead` | §6.3、§8.2；"读不出来"不得渲染成"没有单" | 共享 `RecordPage<TPayload = unknown>`；只读面不跑 DDL；`Err` 不得降级空页，也不得降级成 `undefined` |
| D22 | 意图投影：表投影与记录**同事务**、projection hook **归 store 所有**、`WorkIntake` 不写投影表、长 IO 在事务外；**commit 后同一微任务更新内存快照**；启动序固定 `schema 闸 → rebuild()（表 + 快照）→ replayQueued() → 装配 API`，`rebuild` 失败**拒启动**；`refresh` = 按记录现算（可在 submit 内显式用于重投判定），`get` = 读**本进程已提交投影快照**、不得用于入队/重放决策、不得被读成“库里没有”；运行期库故障由写面/`refresh`/健康观测报错，不得归成“无行”；放弃同事务方案须给“decided 不会被读成 queued”的同等证明 | §6.6 第 3–10 条；§3.6 第 6 步；§9.4 | `rebuild()` 返回 `TableProjectionResult`（`kind`/`name` 固定、`rows`=本次处理数、`cursor`=重建游标）；`get` 无 `Result` 轴（失败面被 rebuild/拒启动吸收）；未知判据四类、`gap` 封闭两码 |
| D23 | 秘密面：`KnownSecretSet` 增 `redactKnown`（只换已知值、不做形状兜底），`redact` 走全量兜底，`find` **只诊断、不得当门禁**；`SEC-MX-BOT-PASSWORD` 的 `allowedUses` = **`platform-auth`+`outbound-redaction`（恰两项，不含 `matrix-register`）**，`SEC-MX-HR-SHARED` = `matrix-register`+`outbound-redaction`（建号只认它），会话 access token 无静态 `secretId`、只在 client 内存；**bot 密码建号无旁路**（不设第二用途位；78 已同步为恰两用途，S10 设计面关闭）；stdio 注册升级为 **challenge-proof**（`registerChallenge`/`registerProof`，HMAC 覆盖 `studio-next/jcs@1` 五键规范化字节、`alg='hmac-sha256-v1'`，常量时间比较，**完整验签不消费 wkey nonce**），daemon 内存保留 per-ticket wkey 至 attempt 结束，进程内共享一个 `WkeyAuthority` | §11.2.1、§11.4.1；78-§7.4.1（`allowedUses` 六值域，**78 与本卷均已删除 bot 密码的 `matrix-register`**）；`gateway/src/wkey.ts:10`–`:11`、`gateway.ts:65` | 被消费的是 challenge 不是 nonce（ack 丢失不得永久锁死）；`allow` 只表示授权通过并带回脱敏结果；socket 目录 `0700`/文件 `0600`/`umask 0077`/拒符号链接**只作部署边界**（只挡别的 OS 用户，不产生“uid 已核”事实）；对端凭据只能由宿主注入的 `PeerCredentialVerifier` 给出——**Node 24 无 `getpeereid`/`SO_PEERCRED` 内建 API**，不得写成 Node 直接调用；无已验证适配即 `unverified`（不得声称已核、不得记 `peer-verified`），同 uid 内恶意进程靠 OS 用户隔离或容器/VM 隔离；核心信任 = challenge-proof + 活跃签发 + scope；proof 走 `studio-next/jcs@1` 五键规范化与 `alg='hmac-sha256-v1'`，固定**假**向量归 82（本卷不写真值） |
| D24 | 新增 `TS-PORT-RES-01 ResourceAccountant`：**公共只读评估**（`baseline`/`gap`；**无** `reserve`/`actual`/`release`、无 `Qid` 回执），`ResourceBaseline` 按 `subjectRef + quotaRef:DefinitionRef + entries(resourceRef/unit/limit 三态/reserved?/consumed?/remaining?) + asOf + gaps`，缺省是**未知**不是 0/无限；事实记录落在 `REC-WORK-05.resource_reservations`（预留，77-§4.5.1 已定）/`REC-EVD-01`、`05`（实际）/`REC-EVD-06`（释放），内部账目是 `store` 的同事务投影；并给 §6.9 端口落点表；boot 事实修正：`boot.test.ts` 实测 635（基线 645 不动）、boot 只经 `@studio-next/daemon/serve`、`RunServeOpts` 由该子路径再导出、`configPath` 与已解析 `Config` 不双读、**不新增** `BuildRuntimeOpts.secretProvider` | 77-§4.4.1/§4.5.1/§6.8；`apps/boot/src/boot.ts:336`、`apps/daemon/src/assembly/serve.ts:1470`、`package.json exports."./serve"`、`wc -l` 实测 | 顺序固定“合同 → 计划锁（写预留）→ 五门（读 baseline）→ 出工段”，不循环；`RES-01` 不占 `REC-*` 行、不新增写入者；`REC-WORK-05.resource_reservations` 已在 77-§4.5.1（该字段无需再向 77 提），若 77 改其逐项形状则派生映射随 §13.2 S4 同步；端口落点只定目录不定顺序，仍按“未实现”计数 |
| D25 | 秘密可装配且与 boot 登录不冲突：`ServeConfig.secrets` 是**唯一配置面**（`catalog: SecretCatalogEntry[]` 缺省 `[]`、`fileRoot?`、`brokerBinding?`；出现内联值/未登记键/缺字段即拒收）；参考实现只 `env-ref`/`file-ref`/`local-mint`，`broker-ref` 无已注册绑定即 `unavailable`（按可选/必需处置，不假装支持）；**能力关闭不加载、范围外不加载**；Matrix 会话改由 `RunServeOpts.matrixSessionFactory`（部署工厂；与 `notifyBroadcast` 并列的两个新键之一）**在 daemon 侧驱动登录**：deps 收 `homeserverUrl`/`botUserId`/`login: MatrixBotLoginSecret`/`registration?: MatrixHrRegisterSecret`/`userAgent?`，其中 `MatrixBotLoginSecret = { secretId: 'SEC-MX-BOT-PASSWORD'; kind: 'password'; use: 'platform-auth'; material: SecretMaterial }`、`MatrixHrRegisterSecret = { secretId: 'SEC-MX-HR-SHARED'; kind: 'shared-secret'; use: 'matrix-register'; material: SecretMaterial }`（**两型不可互换**：建号开启而 `registration` 缺失即拒启动建号能力，不得拿 bot 密码顶替），明文只在 `material.value` 内存活；返回值是**四个工厂/面本身**（`matrixSource: () => InvokeSource`、`matrixRoomFace: (ctx) => MatrixRoomFace`、`hrMatrixFace: () => MatrixHrFace`、`notifyBroadcast: NotifyBroadcastFace`）加 `close()`，**不是**已构造好的 source/room 面；boot 只构造并传入工厂、**不参与登录**、不持 token；四面直接注入仅测试/迁移兼容，且**与工厂同时出现即 `CONFIG_INVALID` 拒启动**（不判“矛盾”——启动期不可判、不得择一静默；单独给面或单独给工厂均合法），四面各自单独态只用于测试/迁移；工厂类型定义在 daemon 的 `run-serve-opts.ts`，**不新增 daemon→matrix 边** | §3.3 第 6 条、§3.4 第 10 条、§11.2-4、§11.2.1；78-§7.4.1；`boot.ts:20`（旧路径） | 秘密值只在 daemon 内存；会话 access token 只在 client 内存、无静态 `secretId`；daemon 传入前核 `secretId`/`kind`/`use` 三槽（`login` 必须 `kind:'password'`+`use:'platform-auth'`，`registration` 必须 `kind:'shared-secret'`+`use:'matrix-register'`），工厂再复核，不符即该能力拒启动、**不降级**；`BuildRuntimeOpts` 不新增任何“值是秘密”的注入项；boot 包导入仍恰三条（contract / daemon/serve / matrix），matrix 边只用于构造工厂 |
| D26 | `Digest` 与 76 对齐：`{ algorithm, value, canonicalizationId?, canonicalizationVersion? }`；`semanticDigest` **必须成对带** `canonicalizationId` + `canonicalizationVersion`，`byteDigest` **两者都不得出现**；只带其一的摘要不得当身份、不得进 `VersionRef`/`ProfileRef`；`Canonicalizer` 同时暴露 `id`/`version`，供两处配对写出 | §4.1 `TS-SCALAR-08`、§4.5；76-§1.5/§8 | 不得用 `byteDigest` 顶替语义身份；短哈希（`sha8`）只作展示；规范化向量仍未执行（U80-01），跨实现交换前须先证 |
| D27 | `PlatformBindingPort`（BIND-01）**三层归属**：类型唯一在 `contract/src/ports/binding.ts`；通用宿主唯一在 `assembly/platform/binding.ts`（组装 `describe`/`exportBundle`/`exitPlan`）；`localplatform`/`taiga`/`yt` 的 `src/binding.ts` 只供平台特定的 `bindingProfile()`/`mapState()`/`lossReport()` 纯函数，**不声称实现完整端口** | §6.6 `TS-PORT-BIND-01` 三层条、§6.9；§2.3（`…→contract`、`daemon→{localplatform,taiga,yt}` 均已允许）；`boundary-rules.mjs:116`–`:117`、`:138`、`:141` | 平台包不得导出 `describe`/`exportBundle`/`exitPlan`、不得持写口；**禁第二实现**；未映射合法状态的 `REC-OBS-02` 由**消费方**（state-diff／`OBS-01`）写，`mapState` 保持纯函数（不写记录、不读时钟）；不新增包边 |
| D28 | `CredentialCatalogPort`（AUTH-06）**持久面与编排分离**：持久适配落 `store/src/records/credentials.ts`（逻辑引用/版本/到期/吊销，**不存值**，复用通用 `records` 表）；`assembly/auth/credentials.ts` **只做端口编排**（来源声明校验、`REC-AUTH-04` 映射、状态拼装、吊销证明校验） | §6.2 `TS-PORT-AUTH-06` 持久面条、§6.9；§6.3（投影名 17+1 不变）；77-§3.4 | **不建第二张秘密表**、不新增投影名、不扩 `MIG-01` 波次（无 schema 变更）；目录不是值的第二存放处（检测到值 ⇒ `rejected_forbidden`）；`assembly` 不拼 SQL |
| D29 | `classified(...)` 落 **`packages/contract/src/schemas/errors.ts`**，与 `configInvalid(...)` **同件、两个独立导出、互不包壳**；`ClassifiedError` 类型仍留 `ports/kernel.ts`，**不另造** `contract/src/errors.ts` | §5.7 构造入口条与三纪律；`schemas/errors.ts:54`、`ports/kernel.ts:98` | 只有 6 个 `ErrReachableCategory`；`category` 省略即按 §5.7 表推导；`configInvalid` 仍是构造期抛出入口（固定 `rejected_precondition`+`CONFIG_INVALID`）；内部 bug 用 `subcause:'internal-bug'`，不造第 15 类 |
| D30 | `TableProjectionResult.name` 的类型是 **`TargetTableProjectionName`**（= 现状 17 个 `TableProjectionName` + `'resourceLedger'`）；`ProjectionName = TargetTableProjectionName \| 'observation'` | §6.3 投影条；§6.4 `TS-PORT-RES-01` | 现状 17 个名字不动；返回类型不得收窄成 `TableProjectionName` 后再强转（否则 `resourceLedger` 无法合法返回）；`resourceLedger` ↔ 物理表 `resource_ledger`，随 `MIG-01` 建表（**未实现**） |
| D31 | 记录面补**载荷**：`RecordEnvelope.payloadRef` = `ArtifactRef`（复用 TS-REF-05，不造新类型）；`RecordPayload = { ref, bytes, mediaType }`、`RecordWriteInput = { envelope, payload }`；`RecordWriter.append(input, opts?)` 收 input，`ref` 与 `payloadRef` 逐字段同值，**字节摘要必核**（缺失/不匹配/不可重读 ⇒ 拒写且零行）；`RecordReader.payload(ref)`（async）/ `ReadOnlyLedger.payload(ref)`（sync）按需读字节，`Ok(undefined)` **只**表示该定位无载荷 | §4.2、§6.3 REC-01/REC-02、§8.2；76-§1.5（`byteDigest`）、76-§4.4 `ARTIFACT-REF` | 不新增端口、不新增 `REC-*`、不新增投影名；查询只回信封不内联载荷（否则一次 `limit` 能拉全表大包）；无权 ⇒ `Err`、不可读 ⇒ `Err`，**不得**降级成“不存在” |
| D32 | 记录面**存储不变量**：`records`（整封、不可变）+ `record_payloads`（原始字节，按 `contentDigest` 内容寻址）+ `record_transactions`（`txId`/`scope`/`writerId`/`fence`/`openedAt`/`status`/`commitSeq`/`proofRef`/`recordIds`）；`commitSeq` 由**提交该事务的同一单写事务**分配，证明 = **同事务** `REC-RCP-01`，**无“已提交无证明”窗口**；`events` 是投影不是全集；DDL/索引/迁移波次归 81/03 | §6.3 存储不变量、§4.6；76-§4.2/§4.5 | 具体列类型与物理表名归 81；不新增投影名；`records` 未落地前 `RecordWriter`/`RecordReader` 状态是**新建**（§6.0），不得再写“包装 `appendEvent`” |
| D33 | `AppendOptions.authorityDomain`：注册表能**唯一定域**时可省，多域/歧义**必填**（缺失 ⇒ `rejected_precondition`/`authority-domain-ambiguous`），**不得猜**；写入须由 `AUTH-01` 需求 + `AUTH-03` 当前激活校验该 `recordType`/`domain` 被允许（不允许 ⇒ `rejected_authority`）；域存 `records` 索引列，且必须等于 `TxScope.authorityDomain`（不等 ⇒ `tx-scope-domain-mismatch`）；`ProjectionSource.asOf`（快照时点）与 `since`（增量起点）**分开**，`asOf` 缺失不得用 `since` 冒充、两者同给 ⇒ `projection-source-invalid`；`factDomains` 的域→表路由由注入的 `Projector` 声明，**不得**硬编码成公共常量表 | §6.3 REC-01/REC-03、§6.2 AUTH-01/03；76-`DEF-AUTHREQ-01` | 域是 77 的域标识，不是物理表名；未登记域 ⇒ 同码拒，不静默忽略；不得按“第一个命中/字典序最小/默认域”补 |
| D34 | 旧投影与 schema 迁移**不得伪造历史**：`events`→记录的派生一律 `reconstructed` + 实际形成时间 + `limitations`，缺字段**不回填**（只能 `opaque` + `REC-LOSS-01`）；schema 迁移在**独占事务**里产 `REC-MIG-01`（计划/前后版本+摘要/转换规则/范围/批准/结果），`records` 落地前的实现日志**不是记录**，落地后重建为 `reconstructed` 记录；旧摘要不可复算 ⇒ 标 `unknown` + `REC-LOSS-01` | §4.6、§6.6 MIG-01；76-§8.3/§8.4、§1.8 | `schema_version` 不是 `REC-MIG-01` 的替代；不得把重建时刻写成当年迁移时刻；不得用 `payload_hash` 一类替代值冒充 `byteDigest` |

〔结论〕D1–D34 之外，本卷其余“应当如何”的段落都是**施工约束**，不是待选项；发现与 76/77/78/79 冲突时按 AGENTS.md 第五条停手改文档，不得让代码漂移。

### 13.2 需其他卷同步的条目（本卷不私改）

〔结论〕下列条目**只限两类**：S1–S4 是**已裁决/已对齐**项的核对（不再待裁，仅登记一致性），S5–S13 是**下游口径同步**。本卷不造第二套定义，也不承认别名等价；已裁决项写进正文后不再以“待裁/映射假设”的口吻出现。

| # | 目标卷 | 位置 | 要改成什么 | 本卷对应处 |
|---|---|---|---|---|
| S1 | 77 | §4.4.1 `judge_role` | **已裁决并对齐**：77 已把 `judge_role` 定为**逐门列表**（`{gate, role}[]`，恰五门）；本卷 `RecReadinessJudgment.judgeRole` 与 `GateResult.role` 已按此写死（§6.4）。此条不再待裁，只需在 77 定稿时核对字段名一致 | §6.4 `TS-PORT-WORK-03` |
| S2 | 77 | §4.4.1 逐门结论词表 | **已裁决**：逐门结论与整单**共用同一三取值**（`可开工`/`附条件开工`/`不可开工`），不存在独立逐门词表；本卷已据此写 `GateResult.verdict`，不再有“映射假设” | §6.4 `TS-PORT-WORK-03` |
| S3 | 77 | §4.4.1 `resource_baseline` | **已对齐**：77 已给 `resource_baseline` 子字段（只读派生物）；本卷 `ResourceBaseline`（`subjectRef`/`quotaRef:DefinitionRef`/`entries`/`asOf`/`gaps`）与之对齐，`entries` 逐资源 + `limit` 三态是 80 侧承载，不另立第二套字段 | §6.4 `TS-PORT-RES-01` |
| S4 | 77 | §4.5.1 `REC-WORK-05` | **已对齐，无需改**：“计划锁定即预留”的唯一记录落点 `resource_reservations` 与逐项 `{resource_ref, amount, unit, period, quota_ref}` 及四条约束已在 77-§4.5.1，与本卷 §6.4 一致；本卷不另造第二事实源。唯一需跟的是**形状变更**：77 若改该字段或 `resource_baseline` 子字段，本卷 `ResourceEntry` 的派生映射随之同步 | §6.4 `TS-PORT-RES-01` |
| S5 | 81 | `15-studio-tools.md` | **下游同步**：旧口径“call 帧含 wkey”“ack 带 reqId”“帧缺口①②”须改为本卷 §11.4.1 的四类帧（`register`/`registerChallenge`/`registerProof`/`registerAck` + `call`/`verdict`），并补 `verifySealed`/共享 `WkeyAuthority`/daemon 保留 per-ticket wkey 三条目标；探针判据写“**任何 catalog 秘密原值**”，不得把合法 `wkeyRef` 当泄漏 | §11.4.1 |
| S6 | 81 | 逐文件蓝图（端口实现） | **下游同步**：按本卷 §6.9 的落点表给每个端口一个真实目标文件（`contract/src/ports/*` 类型 + `core/src/<子域>/`、`store/src/<子域>/`、`engine/<子域>/`、`assembly/<子域>/` 实现），不得另起路径或双轨；意图组件目录用**单数** `assembly/intent/`（不写 `assembly/intents`），资源用 `core/src/resources/` + `store/src/resources/`（只读评估 + 投影，无写口）；**BIND-01 按三层**（类型 `contract/src/ports/binding.ts` / 宿主 `assembly/platform/binding.ts` / 平台包 `localplatform`/`taiga`/`yt` 的 `src/binding.ts` 只供纯函数，**不得**写成“每平台一个完整端口实现”）；**AUTH-06** 持久面 `store/src/records/credentials.ts` + 编排 `assembly/auth/credentials.ts`（不建第二张秘密表）；**投影返回类型**用 `TargetTableProjectionName`（含 `resourceLedger`），不得收窄成 `TableProjectionName`；**错误构造入口**：`classified(...)` 与 `configInvalid(...)` **同落 `contract/src/schemas/errors.ts`**（两个独立导出、互不包壳），`ClassifiedError` 类型仍在 `ports/kernel.ts`，81 若写了 `contract/src/errors.ts` 或“另立构造器文件”须删 | §6.6 `TS-PORT-BIND-01`/`TS-PORT-AUTH-06`、§6.3、§6.9、§5.7 |
| S7 | 81 | `14-api.md` 等 | **下游同步（本卷已定，不是本卷缺陷）**：`ReadOnlyLedger.query` 改 `Result`、`ReadOnlyLedger.get` 同步改 `Result<RecordEnvelope<unknown> \| undefined, ClassifiedError>`（`Ok(undefined)` 才是不存在，失败 `ledger-read-failed`）、`RecordPage<T>` 泛型、三条 subcause；状态表补 `413`；`receipt()` 语义按“本进程已提交投影快照”写 | §6.3、§8.2、§9.4 |
| S8 | 81 | `16-daemon-engine.md` | **下游同步**：“U81-17 空数组=全 403”须与本卷 §9.4 的 `allowedSources` 语义对齐（显式空数组=配置错误拒启动，不是放行、也不是运行期全 403） | §9.4 |
| S9 | 82 | GAP-82-01/02 | **下游同步（探针项）**：意图投影“表 + 内存快照”重建与“重建先于 API 装配”；`get()` 读快照不回库、未知四类判据与 `gap` 两码；**读面 `get` 的负向探针**：`RecordReader.get`/`ReadOnlyLedger.get` 的 `Ok(undefined)` 只对应“不存在”，库不可读时必须 `Err(unavailable/STALL, ledger-read-failed)` 且不得返回 `undefined` 或空页，`IntentReceiptStore.get` 仍返回已提交快照（不得混为一谈）；**`RES-01` 有限额度下 `reserved`/`consumed` 缺省必给 `reservation-record-missing`/`unreconciled-actual` 且该 entry 无 `remaining`、不得判充足**；`RES-01` 公共面取不到写口且缺省为未知；`secrets` 配置面拒收内联值与能力关闭不加载；`matrixSessionFactory` 路径下 boot 零登录、且返回的是四个工厂/面本身（不是已构造好的 source/room 面）；`verifySealed` 不消费 nonce、challenge 过期与 ack 丢失后重连、`rebuild` 失败拒启动、投影 hook 四点崩溃注入；**BIND-01 三层**：三个平台包不得导出 `describe`/`exportBundle`/`exitPlan`、`mapState` 纯函数（调用期零台账写、零网络、零时钟读），未映射合法原值只 `Ok(unverified)` 且 `REC-OBS-02` 由消费方写（同单同原值同拍一条），第二实现负向；**AUTH-06**：库内只有引用/版本/到期/吊销、**无值**，`assembly/auth/credentials.ts` 无 SQL，不建第二张秘密表；**错误构造**：`classified` 与 `configInvalid` 同件不同导出、互不包壳，`ErrReachableCategory` 恰 6（越界 ⇒ `classified-input-invalid`）；**投影**：`rebuild('resourceLedger')` 能合法返回 `name`（类型不收窄） | §6.6、§6.3、§8.2、§6.4、§11.2.1、§3.3、§11.4.1、§5.7 |
| S10 | 78 | §7.4.1 | **已对齐（设计面）**：`SEC-MX-BOT-PASSWORD` 的 `allowedUses` 恰为 `platform-auth` + `outbound-redaction`，不再含 `matrix-register`；`SEC-MX-HR-SHARED` 为 `matrix-register` + `outbound-redaction`，建号只认它；access token 无静态 id。bot 注册无旁路；未注册的 `broker-ref` 按 `unavailable` + `REC-LOSS-01` 处置。秘密 provider、登录工厂与真实 Matrix 调用仍未实现/未验证 | §11.2.1、§3.4 第 10 条 |
| S11 | 81 | `03-store.md`（`store/src/migrations/`、`store/src/records/`） | **下游同步（语义不变量本卷已定，DDL 归本卷下游）**：按 §6.3 落三张表——`records`（整封、不可变；索引 `recordId`/`company`/`recordType.name+version`/`authorityDomain`/`subjectRef`/`observedTime`+`recordedTime`+`effectiveTime.from`/`idempotencyKey`/`lineageHead`）、`record_payloads`（`contentDigest` 主键 + `mediaType` + 原始字节 + 长度 + `storageHint`，**不存解析对象**）、`record_transactions`（`txId`/`scope`(company+authorityDomain+partition)/`writerId`/`fence`/`openedAt`/`status`/`commitSeq`（唯一单调）/`proofRef`/`recordIds`）；`RecordWriter.append(input: RecordWriteInput)`、`RecordReader.payload(ref)`、`ReadOnlyLedger.payload(ref)` 按 §6.3 改签名；**`RecordWriter`/`RecordReader` 状态由「包装」改「新建」**（`events` 只是投影，`appendEvent` 不得再当本端口实现）；schema 迁移在独占事务里产 `REC-MIG-01`，旧行 `reconstructed`、旧摘要 `unknown`。**测试要求**：整封往返逐字段一致；字节读回重算摘要一致、改一字节即 `payload-digest-mismatch`；缺载荷/不可重读 ⇒ 拒写且**库里零行**；越权 `payload(ref)` ⇒ `Err(rejected_forbidden)`；跨权查询看不到行也**不透出总数**；信封+载荷同事务（一处失败整体回滚，无“有封无载”）；`commitSeq` 唯一单调且证明与提交同事务（**不存在已提交无证明的行**）；`records` 表未建时 `append` 必须 `Err`（`unsupported`/`envelope-not-storable` 一类），**不得**退回 `appendEvent` 假装成功 | §6.3 记录面、§6.3 存储不变量、§8.2、§6.6 MIG-01 |
| S12 | 82 | 探针（GAP/新增） | **下游同步（探针项）**：载荷面三态各一条——无载荷 `Ok(undefined)`／无权 `Err(rejected_forbidden)`／不可读 `Err(unavailable/STALL, payload-unreadable)`；摘要不符与媒体类型不符各一条负向（**不得**“先返回再告警”）；`append` 缺载荷或字节不可重读 ⇒ 零行；`authorityDomain` 歧义缺失 ⇒ 拒、`TxScope` 域不一致 ⇒ 拒；`since` 与 `asOf` 同给 ⇒ `projection-source-invalid`、未登记域 ⇒ 同码；`events`→记录重建必须 `reconstructed` 且缺字段不回填（伪造回填即判负）；schema 迁移后 `REC-MIG-01` 存在、`from/to` 带摘要、`schema_version` 不被当记录；`payload(ref)` 在记录不存在与该定位无载荷两态可区分 | §6.3、§8.2、§4.6、§6.6 |
| S13 | 78 | §10（存储绑定） | **已对齐（设计面）**：78 给出三表目标绑定关系与 `events` 投影，不充当字段级 DDL 来源；字段、索引与迁移归 81-files/03，语义不变量归本卷 §6.3。载荷保留原始字节，`contentDigest` 是其 `byteDigest`，不再要求所有载荷入库前一律 JCS 规范化；`commitSeq`/`proofRef` 同事务无窗口。建表、写读端口与真实迁移仍未实现 | §4.4、§6.3 存储不变量 |

〔结论〕下列条目按“**已裁决/已对齐（S1–S4）** 与 **下游口径同步（S5–S13）**”两段列，前者**不再待裁**、只留核对，后者只由 81/82/78 改。本卷没有需要 77 先补的字段缺口；已裁决项（`judge_role` 逐门列表、逐门三值、`resource_baseline` 结构、`Digest` 成对字段）已写进 §4.1/§4.5/§6.4/§13.1 D19/D26，**不得**再以“待裁/映射假设”的口吻复活。本卷不造第二套定义，也不承认别名等价。

### 13.3 真正上呈制作人的五项

| # | 上呈项 | 为什么本卷不能定 | 不决时的缺省 |
|---|---|---|---|
| Q1 | 三面绑定策略：缺省回环还是局域网 | 属部署策略与安全取舍，`--lan` 已存在但“默认局域网”的部署意图未实现（§9.1） | 现状：全部缺省 `127.0.0.1`，局域网须显式旗标 |
| Q2 | 对外端口的稳定承诺与许可口径 | `:8788` 的可用性承诺、限流/配额缺省值（30 rpm、24h TTL）目前都是拟稿值 | 按拟稿值实现，事后面板/文档不得宣称 SLA |
| Q3 | 产品覆盖面：哪些公司/岗位/流程先接 | 属产品范围，不属技术约束 | 只按模板与现有台账能力实现，不做行业特化 |
| Q4 | DSH 是否作为主执行体被替换 | 涉及 78a 绑定面与适配器注册表演进，超出本卷范围 | 维持现状：四适配器并存，DSH 为默认 |
| Q5 | 公开规范的维护责任与公开范围 | 涉及对外发布与法务，非工程可定 | 维持内部文档库，不对外发布 |

〔结论〕Q1–Q5 未决期间，本卷所有相关段落按“不决时的缺省”施工；一旦制作人裁定，须先改本卷对应小节再改代码（顺序铁律）。
