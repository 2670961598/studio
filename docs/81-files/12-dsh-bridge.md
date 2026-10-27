# 81-files/12 · `packages/dsh-bridge` 逐文件契约

> 版本：v0.3，2026-10-27（v0.2 → v0.3：按 78-§3.2.1/§3.2.2/§3.2.4/§3.3/§4.6、80-§5.7/§6.1/§11.2.1 复核；改正 PRM 段必填口径、补 `unsupportedSegments[]` 与 `generatedFrom` 校验、把插件拒绝改为「本地码 + failure/category/subcause」映射、删去「加载失败发 drift」的错误处置、明确插件不读任何秘密；把 v0.2 头部曾声明但正文缺失的 G13–G15 补齐，并新增 G16–G19，同步 U12-12…21；§6.5 把安装/挂载/加载/探测/资格/授权/生效拆成七段、单列三条「切换」，H 级不预认（H0b 及以上无证据）；新增 §十一逐条对齐 12 项统一接口。件数不变：现有 7、目标 24）。
> 性质：**自然语言级文件与实现设计呈审稿**，不是现行文件树、实现单或完成证明。
> 上位：75-§五 的文件契约模板与 81-§二/§四；78-§2（`BIND-DSH-01`）、§3（`BIND-PRM-01`，含 §3.2.1 头部、§3.2.2 九段、§3.2.4 PTC、§3.3 G1–G8、§3.4 双重校验）、§4（`BIND-POS-01`，含 §4.2 九职责、§4.6 事件）；79-§4/§5/§6/§7/§8.1–§8.2（双轨构建、切换顺序、补丁指向 dist、E1–E6 证据层级）；80-§2.1/§2.4/§5.7（`ClassifiedError` 两轴）/§6.1（`RuleEvaluator`）/§6.6（`BindingProfile`/`Notifier`）/§11.2.1（秘密四型）/§12.2；76-§1.5.1（`studio-next/jcs@1`）/§3.12（四态）/§3.15；77-§2.6/§2.8/§4.6/§4.8/§4.9/§11.1。
> 边界：本附录只把 78/79/80 已出现的组件与约束落到文件；**不新增公共概念、TS 端口、REC-ID、状态、允许边或依赖版本**。80 已定义的公共类型（`RuleOutcome`、`ClassifiedError`、`BindingProfile`、`StateMapping`、`SecretCatalogEntry`/`Provider`/`Material`/`KnownSecretSet`、`Notification`、`IntentReceipt` 等）在本包**不复制、不改名、不另立第二套**；凡本包不适用的，在 §十一逐项写理由，而不是沉默。
> 门禁：所有「目标/拆分/新增/替换」均为设计处置，尚未执行；不得据此改源码、manifest、patch 或 guards。
> 核查方式：2026-10-27 只读盘点（`Glob`/`Read`/`Grep` + `wc -l`）。**未运行**任何测试、构建或守卫；文中出现的测试用例数与行数只作规模核对，不作能力证据。

标签（81-§四）：**现有** / **库级·未接** / **目标-保留** / **目标-拆分** / **目标-新增** / **目标-替换** / **目标-退役** / **仅测试** / **未证**。

---

## 〇、范围与复算口径

覆盖 `packages/dsh-bridge` 的全部第一方文件，共 **7 件**：

| 类别 | 件数 | 文件 | 复算方式 |
|---|---|---|---|
| 生产源码 | 1 | `src/index.ts`（212 行） | `ls packages/dsh-bridge/src` |
| 测试与测试基建 | 3 | `test/bridge.test.ts`（321 行 / 15 例）、`test/smoke/bridge-smoke.ts`（217 行）、`test/smoke/cordis.overlay.yml`（8 行） | `find packages/dsh-bridge/test -type f` |
| 包配置与分发件 | 3 | `package.json`（20 行）、`tsconfig.json`（6 行）、`cordis.patch.yml`（12 行） | `ls packages/dsh-bridge` |

目标件共 **24 件**（7 现有 + 17 新增，0 退役），见 §三。复算：现有 7 = 生产 1 + 测试/基建 3 + 配置 3；目标 24 = 生产 7 + 测试/基建 10 + 配置/分发 7。处置复算：保留 4 + 拆分 1 + 替换 2 + 新增 17 + 退役 0 = 24。目录与文件预算复算：根 7、`src/` 直属 3、`src/position/` 4、`test/` 直属 2、`test/position/` 3、`test/smoke/` 5——全部 ≤ 25（`scripts/guards/boundary-rules.mjs` 的 `maxFilesPerDirectory`）。本轮修订**不增件、不减件**：没有为目标文件新建「验签器/摘要器」件（理由见 G3/G17），也没有把测试拆成更多文件（拆分见 §3.2）。

排除：`.git`、`node_modules`、`dist` 与任何生成物、`bun.lock`（归 81-files/19）、根 `package.json`/`tsconfig*.json`（归 81-files/19）、`apps/daemon/**`（归 81-files/16/17）、第三方源文件与历史设计文档。历史探针报告（docs/31、docs/34）只作外部证据引用，不展开其源码。

〔事实〕本包**当前不在任何构建轨**：无 `dist`、无 `files`、无构建配置；`private: true`；无 `license` 字段；无任何 `dependencies`/`devDependencies`/`peerDependencies`。

〔口径〕**政策项与工程选择分开记**：需要上位决定、本附录无权自定的，全部登记在 §九（G1–G19，逐条写影响与应回写处）；本附录自己拍板、可以随实现单改而不影响验收口径的，共六处（其中①③④在条目内已标「**实现选择**」，②⑤⑥见对应条目正文）：① position 插件名 `studio-next-position`（78a 只写「名称由 78 定」，78 正文未定名）；② 环境变量名 `STUDIO_NEXT_POSITION_MANIFEST`；③ `MAX_MANIFEST_BYTES` 默认 1 MiB；④ `unsupportedSegments` 含 `authority`/`tools` 时拒载、其余段允许不承载；⑤ `allow`/`deny` 冲突取 `deny` 并继续；⑥ 各件行预算数值（§8.1）。工程选择不写进验收判据：验收只认 §七 的 E1 用例与 78/80 的硬规则；实现单若改上述取值，只需同单改本附录对应句，不得借「实现选择」改硬规则。

---

## 一、包身份、调用方与边界

### 1.1 身份

| 项 | 值 | 依据 |
|---|---|---|
| 包名 | `@studio-next/dsh-bridge` | `packages/dsh-bridge/package.json:2` |
| 版本 | `0.1.0`，`private: true` | 同上 `:3-4` |
| 层位 | **层位 1**；`packageLayers["dsh-bridge"] = 1` | `scripts/guards/boundary-rules.mjs:94` |
| 目标语义（80） | 「不变；仓内零模块入边，以路径引用被复制」 | 80-§2.1（`dsh-bridge` 行） |
| 模块形态 | ESM（`type: module`）；源码态可被 Node 24 原生 type-stripping 直跑 | 79-§4.4 |
| 对外面 | DSH 宿主插件（上下文注入桥），**不是**库、不是公司定义包 | 78-§4.3；80-§12.2 第 3 条 |
| 分发面 | 目标为「JS + `.d.ts`」产物包（`dist/index.js`），不依赖宿主加载 `node_modules` 下 `.ts` | 75-D75-07；79-§5.1、§7.2 |

〔结论〕`dsh-bridge` 属**可执行能力包**，与公司纯配置定义包严格分开（D75-04）：公司目录与 PRM 只能以「能力引用 + 版本」提及它（76-§3.19 `DEF-DEP-02`），不得把插件文件、激活钩子或路径写进定义包。本包也**不得**被当作公司身份、任职或授权的载体。

### 1.2 调用方清单：零模块入边，四条路径消费

〔事实〕`allowedPackageEdges` 中**没有任何指向 `dsh-bridge` 的边，也没有从它出发的边**（`boundary-rules.mjs:80-142`）。它靠路径与 env 被消费：

| # | 消费方 | 消费方式 | 锚点 | 现状 |
|---|---|---|---|---|
| 1 | 部署（DSH profile / overlay） | `dsh.bundle.patch` 或 `--patch <yml>` 装载 `src/index.ts` | `cordis.patch.yml:8-12`、`test/smoke/cordis.overlay.yml:4-8` | **现有** |
| 2 | daemon 引擎 | `provisionDshBridgeOverlay` 以 4 级相对路径推导插件源并生成 `<rootDir>/tmp/dsh-bridge-overlay.yml` | `apps/daemon/src/engine/instructions-store.ts:72`、`:82-107`、`:87` | **现有**（布局即接口，79-§12 D13 记为漂移） |
| 3 | daemon 引擎 | 写每任务指令临时文件，删除与生命周期管理 | 同文件 `:37-57` | **现有** |
| 4 | dsh 适配器 | `agents_md='user_level'` 时注 `STUDIO_NEXT_INSTRUCTIONS=<target>` | `packages/adapters/src/dsh.ts:304`、`:481`、`:684-690` | **现有** |

〔事实〕第 3、4 条共用的文件面与第 2 条生成的 overlay，是本包**全部落点**（包内不落任何运行期文件）：

| 落点 | 权限位（实测写法） | 生命周期 | 可达性口径 | 依据 |
|---|---|---|---|---|
| `tmp/instructions/<ticket>.md`（指令临时区） | 目录 0700 / 文件 0600 | 收割后删 | **不在 workspace 内**是目录事实；**读域收口在本 OS 不可表达**（`L78-WS-01`）——同用户进程按路径仍可能读到，不得称「agent 看不到」 | 78-§2.5「AGENTS.md 通道」行、78-§7.2 |
| `<rootDir>/tmp/dsh-bridge-overlay.yml`（运行时 overlay） | `mkdirSync(..., 0o700)` + `writeFileSync(..., 0o600)` | 每次 serve 启动覆盖刷新，内容确定性 | 同上；**worker 沙箱根是否覆盖 `<rootDir>/tmp/` 未证**。若覆盖，则 agent 可改写自己的上下文段落（不直接改策略，但可伪造「规则已被批准」的文本）——78-§4.5 第 2 行把这条列为「本卷最需要探针的一条」，登记为 G13 | `instructions-store.ts:82-107`、78-§4.5 |

〔结论〕这两条都落在 78-§2.4 的**软限制**格：把模型换成恶意模型，注入段仍在，但约束不在。因此本附录不写「已隔离」「agent 不可读」，只写「不在 workspace 内 + 部署最小化」。

〔结论〕第 4 条使 `STUDIO_NEXT_INSTRUCTIONS` 成为**跨包冻结串**：`packages/adapters/test/dsh-agents-md-channel.test.ts`（`:90` 起）与 `test/dsh-env-whitelist.test.ts:183` 都断言它。改这个串或 `DEFAULT_INSTRUCTIONS_ENV` 必须与适配器同单改，不得只改本包。

〔结论〕第 2 条是 79-§7.2 判负的形态：`path.join('..','..','..','..','packages','dsh-bridge','src','index.ts')` 把 monorepo 目录形状变成隐式接口，且切 dist 后必然失效。目标由本包的**产物解析器**（§四 F-dsh-bridge-artifact）替代，daemon 只消费解析结果。

〔结论〕切 dist 后 overlay 的 `name` 由 `path.relative(dirname(overlayPath), bridgeSrc)` 现算，只要 `bridgeSrc` 改为解析器给出的产物路径，overlay 与包内 `cordis.patch.yml` 仍同形——这条相对锚定规则（`docs/34-§3.1`）不因切换而改。

### 1.3 允许边、禁止边与零依赖

| 项 | 目标口径 | 依据 |
|---|---|---|
| 出边 | **零**。不得 `import '@studio-next/contract'`，不得引入 zod/yaml/任何第三方运行时包 | `allowedPackageEdges` 无该包边；80-§12.2 第 3 条；79-§6.1 把 dsh-bridge 定为 L0「零依赖」 |
| 入边 | **零模块入边**。daemon/adapters 不得 `import '@studio-next/dsh-bridge'` | 同上；新增入边 = 允许边表变更 = 提案流 |
| 内建模块 | 现状 `node:fs/promises`、`node:process`；目标**仍只这两项 + `node:path`**（仅用于拒绝相对 `manifestPath`）。`node:url`/`node:crypto` **不是目标必需**：产物解析器不用 path，验签实现不在包内（G3/G17），不得为了让包「看起来能验签」而引 crypto | 现状 `src/index.ts:35`；78-§3.4；80-§5.8 |
| 宿主 API | 只以**本包本地结构化投影**表达（`SystemPromptLike` 等），不 import cordis/dsh | 现状 `src/index.ts:52-88` 的既有做法 |

〔结论〕上表否掉了一条诱人的捷径：PRM 的规范化摘要（`studio-next/jcs@1`，76-§1.5.1）**不能**在本包实现成第二份实现，也不能靠 import `contract` 取得。因此 position 侧只做「注入式 `digestOf`/`verifySignature`」这一条路；而 `apply(ctx, config)` 的 config 只来自 overlay 的**数据**，没有函数注入通道——两条合起来意味着**生产形态下没有可用的验签器**，这是 G3/G17 的阻断项，不是可以在包内绕过的实现细节。包内**不得**为此引 `node:crypto` 或读密钥文件来「先跑起来」。

### 1.4 两个插件面：上下文桥与策略面

| 维度 | 上下文桥（现有 `studio-next-bridge`） | 策略面（目标 `studio-next-position`） |
|---|---|---|
| 上位 | 78-§2.3「工作区规则 / AGENTS.md」行；78-§4.3 左列 | 78-§4.2 九职责；`BIND-POS-01` |
| 做的事 | 读指令文件 → 注册系统提示段 | 加载并校验 PRM → 收紧工具/沙箱/审批/子 agent → 发事件 |
| 载体 | `inject:['systemPrompt']` + `ctx.systemPrompt.section(...)` + `DEPLOYMENT_PERSONA_PREFIX`；等价于 `dsh-agent-instructions`（AGENTS.md 作为有界用户消息） | `ctx.tools.restrict`、`tools/pre-execute` + `ctx.tools.guard`、`dsh-agent-tool-presentation`（PTC）、`sandbox-policy`、`user-approval`、`persona`/`instructions`（软）、`subagent` preset、`session-checkpoint-policy` |
| 强度 | **软**：影响模型「想到什么」 | **硬（对模型）**：影响「能不能做」；对同进程代码执行权无效（`L78-POS-01`） |
| 失败默认 | 降级（`required=false`，stderr 警告） | **fail-closed**：校验失败即拒绝 agent 创建 |
| 位置 | DSH 进程内，`agent/created` | DSH 进程内，agent scope |
| 承载的损失 | `L78-DSH-01`（宿主不承载授权）、`L78-DSH-02`（不承载验收）；注入成功 ≠ 模型遵守 | `L78-POS-01`（同进程可篡改）、`L78-POS-02`（只约束 `ctx.tools`，shell 内命令不在内）、`L78-POS-03`（事件可能缺失）、`L78-POS-04`（rc 期 API 可变） |

〔结论〕两者**并存不互替**（78-§4.3）。78-§4.3 要求执行顺序为「先校验清单、再注入上下文」，但 78 未规定两个插件在同一 `agent/created` 钩子上的**排序机制**——这是 G2，本附录不自行发明。

〔结论〕PRM 在本附录只作**绑定层执行投影**（78-§3.2 开篇：字段可用但必须带来源引用，无来源字段不得出现），不是 76 的对象、不是授权源（`L78-PRM-01`：清单合法 ≠ 授权成立）。上下文桥读的指令文件同理：它是 daemon 生成的部署产物，不是公司定义，也不证明任何授权。

〔结论〕78-§3.4 的双重校验在本附录按**两段**落：
1. **启动器侧（框架、归 81-files/17）**：spawn 前校验摘要/签名/期限/引用可解析/与部署交集非空，失败即不 spawn。这是无插件形态下**唯一**防线（78-§0.5 修正 1）。
2. **插件侧（本包）**：进程内再校验，只能覆盖**它拿得到的东西**——文件字节、结构、期限、宿主版本；**拿不到**台账引用、部署配置交集、JCS 规范化实现（G3）与验签材料/算法（G17）。拿不到就 fail-closed，不得把「没查」写成「通过」。

〔结论〕所以本附录**不**把插件侧的加载失败记成 `position/drift`：78-§3.4 把第 13 态限定为「插件确实加载过、且只对该插件承载的段」，加载失败时没有可比对的暴露面。78-§3.4 同一句里「仅插件侧失败而启动器侧通过 → 记 drift」与该限定自相矛盾，登记为 G19，不在本附录内二选一。

---

## 二、现有件全集（7）

### 2.1 生产源码（1）

| F-ID | 路径 | 行数 | 实际导出 | 状态 |
|---|---|---|---|---|
| `F-dsh-bridge-index` | `src/index.ts` | 212 | `name`、`inject`、`DEFAULT_INSTRUCTIONS_ENV`、`SECTION_NAME`、`SECTION_PLACEMENT`、`apply`；类型 `BridgeConfig`/`SystemPromptLike`/`AgentLike`/`AgentContextLike`/`PluginContextLike`/`ResolvedInstructions`；函数 `resolveBridgeConfig`/`readInstructions` | **现有**（源码形态有真机记录；dist 形态**未证**） |

内部实际形状（已逐行核对）：

- 常量：`name='studio-next-bridge'`；`inject=['systemPrompt']`；`DEFAULT_INSTRUCTIONS_ENV='STUDIO_NEXT_INSTRUCTIONS'`；`SECTION_NAME='studio-next:instructions'`；`SECTION_PLACEMENT='DEPLOYMENT_PERSONA_PREFIX'`。
- `BridgeConfig = { instructionsEnv?: string; sectionName?: string; required?: boolean }`；`resolveBridgeConfig(raw: unknown)` 对非对象返回 `{}`、对空串/非字符串丢弃、`required` 只认 `true`。
- `readInstructions(env, config, readTextFile?) → Promise<ResolvedInstructions>`：四态 `unset|unreadable|empty|injected`；`injected` 时 `text` 为文件全文（不裁不拼），并带 `source`；`unreadable` 带 `detail`。
- `apply(ctx, config) → unknown`：注册 `agent/created` 监听，逐 agent 读 env → 文件 → `target.effect(() => systemPrompt.section({name, order: getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'), text}))`；返回 `ctx.on` 的销毁器。
- 诊断：`note()` 只写 stderr（stdout 是 headless `--json` 的 NDJSON 通道）；`fail()` 在 `required=true` 时抛错拦截 agent 创建；`required=false` 时降级为 stderr 警告。

〔事实〕现状错误面**没有**稳定码：`fail` 抛的是原生 `Error`（`index.ts:199-204`），消息里直接拼状态、`source` 与 `detail`；成功路径也把完整 `source` 写进 stderr（`:183-184`）。这不满足 80-§5.7 的「subcause 必须稳定命名」与 80-§5.8 的「不含内部绝对路径」，是**目标要修的现状缺陷**，不是目标设计（见 §4.1 的错误表与 G8）。

〔事实〕现状导出面里没有 `ClassifiedError`、没有 `Result`，也没有任何公共端口类型——这是刻意的（零依赖、无 `contract` 入边）。因此**不得**为了让桥「符合统一错误形状」而 import `@studio-next/contract`；它只需要在**错误码字符串**层面与 77/80 对齐，由消费方（daemon/收据读取方）映射。

〔事实〕载体定位（78-§2.3 两行）：本插件注册的段落在 `DEPLOYMENT_PERSONA_PREFIX`，与 `dsh-agent-instructions`（把 AGENTS.md 当**有界用户消息**）同属「工作区规则」这一**软**载体；`dsh-persona`（scoped persona）是另一条软载体，本仓未启用。三条都只能表达「行为默认值」，**不能表达强制**——78-§2.4 的判据是「把模型换成恶意模型，这条控制还在吗」，本插件过不了这一问。

〔事实〕段的注册点只有一个：监听器体内 `target.effect(() => systemPrompt.section({...}))`。`getSectionOrder` 来自宿主（伪件里返回 `42`），说明「段序」是宿主概念，本包不定义段的先后，只声明放置位——这也是 G2 无法在包内解决的原因。

〔结论〕现状**已具备**的只有「上下文注入」这一件事。它不拒绝任何工具调用、不读 PRM、不发 `position/*` 事件——不得据存在推断策略能力（78-§2.2 B 行）。

### 2.2 测试与测试基建（3）

| F-ID | 路径 | 行/例 | 用途 | 状态 |
|---|---|---|---|---|
| `F-dsh-bridge-test-bridge` | `test/bridge.test.ts` | 321 行 / 15 例 | 装载形状、config 归一、四态解析、apply 接线、分发件形状 | **现有** |
| `F-dsh-bridge-test-smoke` | `test/smoke/bridge-smoke.ts` | 217 行 | 真机端到端手动冒烟（套外） | **仅测试/演示** |
| `F-dsh-bridge-test-smoke-overlay` | `test/smoke/cordis.overlay.yml` | 8 行 | 冒烟用运行时 overlay，`name: ../../src/index.ts` | **仅测试/演示** |

〔事实〕`bridge.test.ts` 的 15 例分五组：装载形状 1、`resolveBridgeConfig` 2、`readInstructions` 5、`apply` 接线 5、分发件形状 2。它用两个伪件——`fakePluginCtx()`（捕获监听器、返回 `'on-token'`）与 `fakeAgentContext()`（录制 `section`/`effect`/`getSectionOrder` 调用、返回 `42`）——并直接改写 `process.env`（保存/恢复）。**它不证明**宿主真会注册段、不证明监听顺序、不证明 dist 形态可加载。

〔事实〕其中 2 例把**源码形态**钉死：`pkg.exports['.'] === './src/index.ts'`、`pkg.dsh.bundle.patch === './cordis.patch.yml'`、补丁文本含 `name: ./src/index.ts`（79-§6.5 的 D12）。切 dist 时这两例必须与新断言同单改，且**不能**用「跳过」变绿。

〔事实〕`bridge-smoke.ts` 起真实 `dsh --profile web --patch <overlay> --port <smoke-port>`，注入含随机标记串的指令文件，断言 `assistant/message` 终答含标记串；收口用 SIGTERM→SIGKILL、删临时目录、清 `<home>/.dsh/sessions` 中含 `dsh-bridge-smoke` 的目录。它含机器相关默认值 `DSH_BIN=<dsh-binary>`（可由 env 覆盖；`<dsh-binary>` 是逻辑占位，实现取 `process.env.DSH_BIN ?? <由部署给定的 dsh 可执行路径>`，仓内不写任何本机绝对路径）——与 75-D75-13「仓内不得出现本机路径」一致的做法是保留占位而非写死路径，见 G8。

### 2.3 包配置与分发件（3）

| F-ID | 路径 | 行数 | 关键内容 | 状态 |
|---|---|---|---|---|
| `F-dsh-bridge-pkg` | `package.json` | 20 | `main`/`exports["."]` → `./src/index.ts`；`dsh.bundle.patch` → `./cordis.patch.yml`；`typecheck`/`test` 脚本；零依赖 | **现有**（不可发布：`private`、无 `files`、无 `license`） |
| `F-dsh-bridge-tsconfig` | `tsconfig.json` | 6 | 继承仓根；`include: ["src/**/*.ts","test/**/*.ts"]`；`exclude: ["test/smoke/**/*.ts"]` | **现有** |
| `F-dsh-bridge-patch` | `cordis.patch.yml` | 12 | `insert` 单条目：`id: studio-next-bridge`、`name: ./src/index.ts`、`config.instructionsEnv` | **现有**（冻结工件，注释即装载说明） |

〔结论〕`tsconfig.json` 的 `exclude` 使冒烟脚本落在类型门禁之外，这与 79-§8.2 E6 的记录一致：**冒烟脚本自身从未被 `tsc` 检查过**。目标**保持**这一处置（不把它拉进包门禁：它会拉入 `node:child_process` 与真实宿主假设）；其可信度只来自真实执行，不来自静态检查。若将来要补静态检查，须单独立 `tsconfig.smoke.json`——本附录**不**把它列入目标件（避免无证据的配置增殖）。

---

## 三、目标件全集与处置总表（24）

### 3.0 目标文件树（可复算）

```text
packages/dsh-bridge/                        根 7 件
├── package.json                            F-dsh-bridge-pkg           目标-替换
├── tsconfig.json                           F-dsh-bridge-tsconfig      目标-保留
├── tsconfig.build.json                     F-dsh-bridge-tsconfig-build 目标-新增
├── cordis.patch.yml                        F-dsh-bridge-patch         目标-替换
├── cordis.position.patch.yml               F-dsh-bridge-position-patch 目标-新增
├── README.md                               F-dsh-bridge-readme        目标-新增
├── LICENSE                                 F-dsh-bridge-license       目标-新增（D3 门）
├── src/                                    3 件
│   ├── index.ts                            F-dsh-bridge-index         目标-保留
│   ├── host.ts                             F-dsh-bridge-host          目标-新增
│   ├── artifact.ts                         F-dsh-bridge-artifact      目标-新增
│   └── position/                           4 件
│       ├── index.ts                        F-dsh-bridge-position-index
│       ├── manifest.ts                     F-dsh-bridge-position-manifest
│       ├── policy.ts                       F-dsh-bridge-position-policy
│       └── events.ts                       F-dsh-bridge-position-events
└── test/                                   2 件（直属）
    ├── bridge.test.ts                      F-dsh-bridge-test-bridge   目标-拆分
    ├── artifact.test.ts                    F-dsh-bridge-test-artifact 目标-新增
    ├── position/                           3 件
    │   ├── manifest.test.ts                F-dsh-bridge-test-position-manifest
    │   ├── policy.test.ts                  F-dsh-bridge-test-position-policy
    │   └── plugin.test.ts                  F-dsh-bridge-test-position-plugin
    └── smoke/                              5 件
        ├── bridge-smoke.ts                 F-dsh-bridge-test-smoke    目标-保留
        ├── cordis.overlay.yml              F-dsh-bridge-test-smoke-overlay 目标-保留
        ├── cordis.dist.overlay.yml         F-dsh-bridge-test-smoke-dist-overlay 目标-新增
        ├── position-smoke.ts               F-dsh-bridge-test-smoke-position 目标-新增
        └── cordis.position.overlay.yml     F-dsh-bridge-test-smoke-position-overlay 目标-新增
```

〔结论〕树里**没有**「验签器」「摘要器」「错误码表」「宿主任工厂」等新件：前两者会变成第二套规范化/秘密实现（G3/G17），后两者没有上位定义（80-§12.3 禁止 81 自设端口）。因此目标件数仍然是 24，阈值与域平面不因本轮修订变化。

### 3.1 生产源码（7：1 现有 + 6 新增）

| F-ID | 目标路径 | 处置 | 上位 |
|---|---|---|---|
| `F-dsh-bridge-index` | `src/index.ts` | 目标-保留（内部重构：宿主投影出移） | 78-§2.3、80-§12.2#3 |
| `F-dsh-bridge-host` | `src/host.ts` | 目标-新增 | 78-§2.3/§4.2 载体表；80-§5.1/§5.5 |
| `F-dsh-bridge-artifact` | `src/artifact.ts` | 目标-新增 | 79-§7.2；80-§12.2 |
| `F-dsh-bridge-position-index` | `src/position/index.ts` | 目标-新增 | 78-§4.2/§4.3/§4.5 |
| `F-dsh-bridge-position-manifest` | `src/position/manifest.ts` | 目标-新增 | 78-§3.2/§3.4；77-§4.8 |
| `F-dsh-bridge-position-policy` | `src/position/policy.ts` | 目标-新增 | 76-§3.12；78-§4.2 #2/#3/#7、§4.4 |
| `F-dsh-bridge-position-events` | `src/position/events.ts` | 目标-新增 | 78-§4.6；77-§2.6 |

### 3.2 测试与测试基建（10：3 现有 + 7 新增）

| F-ID | 目标路径 | 处置 | 上位 |
|---|---|---|---|
| `F-dsh-bridge-test-bridge` | `test/bridge.test.ts` | 目标-拆分（分发件形状 2 例迁出；其余保留） | 78-§4.3；79-§8.1 E1 |
| `F-dsh-bridge-test-artifact` | `test/artifact.test.ts` | 目标-新增 | 79-§7.2；E2/E4 的解析面 |
| `F-dsh-bridge-test-position-manifest` | `test/position/manifest.test.ts` | 目标-新增 | 78-§3.2/§3.4 |
| `F-dsh-bridge-test-position-policy` | `test/position/policy.test.ts` | 目标-新增 | 76-§3.12 |
| `F-dsh-bridge-test-position-plugin` | `test/position/plugin.test.ts` | 目标-新增 | 78-§4.2/§4.5 |
| `F-dsh-bridge-test-smoke` | `test/smoke/bridge-smoke.ts` | 目标-保留（仅测试） | 79-§8.2 E6；docs/31-§5 记录 |
| `F-dsh-bridge-test-smoke-overlay` | `test/smoke/cordis.overlay.yml` | 目标-保留（仅测试，源码形态） | 79-§6.1 第 2 步 |
| `F-dsh-bridge-test-smoke-dist-overlay` | `test/smoke/cordis.dist.overlay.yml` | 目标-新增（仅测试，dist 形态） | 79-§8.2 E6 |
| `F-dsh-bridge-test-smoke-position` | `test/smoke/position-smoke.ts` | 目标-新增（仅测试，受门） | 78-§4.2 #1/#3、§13 探针 |
| `F-dsh-bridge-test-smoke-position-overlay` | `test/smoke/cordis.position.overlay.yml` | 目标-新增（仅测试，受门） | 78-§4.3 挂载 |

〔跨卷归属〕上表 10 件中，`test/smoke/*`（5 件）与 `test/artifact.test.ts` 属**易被别卷重复登记**的类型（冒烟与产物契约在 79/82 的验证登记里也会被提到）。规则：**F-ID 与逐文件契约以本卷为唯一主键**，别卷只允许引用 F-ID 或路径并注明「见 81-files/12」，不得各自再写一份字段契约；若别卷先改了语义，按该卷回写本卷（与本卷「冲突以最新卷为准」同源）。截至 2026-10-27 的只读盘点，其余 81 卷与 docs 内**没有**任何一处登记这 6 件的文件名（`grep -rn "artifact.test.ts\|bridge-smoke\|cordis.*overlay" docs/` 仅命中本卷），因此当前不存在实际重复，本条是**预防性**约束。

### 3.3 包配置与分发件（7：3 现有 + 4 新增）

| F-ID | 目标路径 | 处置 | 上位 |
|---|---|---|---|
| `F-dsh-bridge-pkg` | `package.json` | 目标-替换（exports/types/files 指 dist） | 79-§6.2/§6.5/§7.1 |
| `F-dsh-bridge-tsconfig` | `tsconfig.json` | 目标-保留 | 79-§4.4 |
| `F-dsh-bridge-tsconfig-build` | `tsconfig.build.json` | 目标-新增 | 79-§5.2 |
| `F-dsh-bridge-patch` | `cordis.patch.yml` | 目标-替换（`name` → `./dist/index.js`） | 79-§7.2 |
| `F-dsh-bridge-position-patch` | `cordis.position.patch.yml` | 目标-新增 | 78-§4.3 挂载 |
| `F-dsh-bridge-readme` | `README.md` | 目标-新增 | 79-§7.1 |
| `F-dsh-bridge-license` | `LICENSE` | 目标-新增（受 D3 决策门，文本未定） | 75-§七 D3；79-§6.5 |

### 3.4 计数复核

| 处置 | 件数 | F-ID |
|---|---|---|
| 目标-保留 | 4 | index、tsconfig、test-smoke、test-smoke-overlay |
| 目标-拆分 | 1 | test-bridge |
| 目标-替换 | 2 | pkg、patch |
| 目标-新增 | 17 | host、artifact、position×4、test-artifact、test-position×3、smoke-dist-overlay、smoke-position、smoke-position-overlay、tsconfig-build、position-patch、readme、license |
| 目标-退役 | 0 | — |
| 合计 | **24** | — |

| 目标类别 | 件数 | 复算 |
|---|---|---|
| 生产源码 | 7 | `src/index.ts`、`src/host.ts`、`src/artifact.ts`、`src/position/{index,manifest,policy,events}.ts` |
| 测试与测试基建 | 10 | `test/{bridge,artifact}.test.ts`、`test/position/{manifest,policy,plugin}.test.ts`、`test/smoke/` 5 件 |
| 配置与分发 | 7 | 根 7 件（含 LICENSE，受 D3 门） |
| 合计 | **24** | 7 + 10 + 7 |

〔结论〕本附录**不退役任何现有件**。上下文桥的职责、测试与冒烟脚本都保留；新增面全部是「产物契约」与「策略插件」两件事，不改桥的注入语义。**计数不因本轮修订变化**：没有未列名的隐藏件——24 件在 §3.0 的文件树里逐条可数。

---

## 四、逐文件条目

### 4.1 生产源码

#### F-dsh-bridge-index

- **路径/处置**：`packages/dsh-bridge/src/index.ts`；目标-保留（内部重构，公开行为不变）。旧路径不变，ID 不重用。
- **归属/上位**：78-§2.3「工作区规则 / AGENTS.md」载体行、78-§4.3 左列（上下文桥）；80-§2.1（`dsh-bridge` 行）、§12.2 第 3 条（零依赖、不得依赖 daemon/store）。
- **职责**：作为 DSH 插件入口，在 `agent/created` 时把「一个已存在、由部署提供的指令文件」注册为该 agent 的系统提示 persona 前缀段。**非职责**：不生成指令文本（归 daemon 的组装与落盘，见 `instructions-store.ts`）；不判断指令内容是否合规；不授予任何权限；不证明模型确实遵守；不写台账。
- **内部结构（目标）**：
  - 常量五个原样保留（`name`/`inject`/`DEFAULT_INSTRUCTIONS_ENV`/`SECTION_NAME`/`SECTION_PLACEMENT`）；`name` 与 patch 的 `id` 仍是两个独立字符串，不得合并成一个。
  - `apply(ctx, config)` 保留现签名与现语义：解析 config → 注册 `agent/created` → 逐 agent 解析指令 → `effect` 包裹 `section` → 返回销毁器。
  - `resolveBridgeConfig`/`readInstructions` 的实现保留在本文件（它们是**桥的纯逻辑**，不是宿主投影）；`BridgeConfig`/`ResolvedInstructions` 亦留在本文件。
  - 宿主投影类型（`SystemPromptLike`/`AgentLike`/`AgentContextLike`/`PluginContextLike`）**移入** `src/host.ts` 并以 `export type` 再导出，保证现有测试的 `import type { ... } from '../src/index.ts'` 不改。
  - 目标新增：`redactPath(path)` 内部工具，只输出 basename 或 `<path:hash>`，用于诊断（现输出完整 `source`，见错误/观测）。
  - 载体约束（不新增能力，只钉现状）：只注册 `DEPLOYMENT_PERSONA_PREFIX` 一个放置位；不注册第二段、不改段序（`getSectionOrder` 归宿主）、不接管 `dsh-agent-instructions` 通道。78-§2.3 把两者都列为「工作区规则」的软载体，本包只走插件这一条。
- **导出与依赖**：导出集不变（含类型再导出）。允许依赖：`node:fs/promises`、`node:process`、`./host.ts`；**不 import** `./artifact.ts`（产物解析属消费方，不属插件运行时）与 `./position/**`（桥不得因策略插件而加载失败）。禁止：`@studio-next/*`、任何第三方包。
- **IO 与注入**：读 env（默认 `STUDIO_NEXT_INSTRUCTIONS`）与一个文件全文；`readInstructions` 的 `env` 与 `readTextFile` 已是注入参数（现状），保持——这是本包唯一可纯测的 IO 边界。时间/随机/ID 均不使用。
- **状态与并发**：每次 `agent/created` 独立解析，**不缓存**（同一进程内不同 agent 指向不同 ticket 文件是正常形态）。同一 agent 只注入一次；重复 `agent/created` 由宿主语义决定，本插件不做去重。段名在同一 agent 内重复注册会由宿主报错（现状注释所述），本插件不吞。
- **错误与观测**：四态原样保留。`required=true` 时抛错拦截 agent 创建；`required=false` 时 stderr 警告并继续。**目标修正**：诊断只写「稳定码 + 状态 + 文件 basename + 字节长度」，不写完整绝对路径（80-§5.8 禁内部绝对路径）。现状锚点：成功路径 `index.ts:183-184` 打印 `injected <n> chars from <source>`、失败路径 `:166-168` 打印 `source=<完整路径>`——两处都泄漏 78-§7.2 的指令临时区位置。stdout 永不写。

  桥的本地码只有两个（封闭，不新增 77 的 failure 值；抛的是原生 `Error`，不 import `ClassifiedError`）：

  | 本地码（`subcause`） | 触发 | 77 `failure` | 80 缺省 `category` | 说明 |
  |---|---|---|---|---|
  | `bridge-required-unmet` | `required=true` 且四态非 `injected` | `rejected_precondition` | `CONFIG_INVALID` | 部署没给指令文件；补齐后重试同一 agent 创建 |
  | `bridge-host-face-missing` | `agent.ctx` 缺 `systemPrompt` | `unsupported` | `EVOLVE_REJECT` | 宿主形态不提供该软段；换绑定/换宿主，不重试 |

  〔不得〕把 `required=false` 的降级写成 `degraded` 事件或 `Ok`：桥不写记录、不发事件，降级只体现为 stderr 警告与「段不存在」。`degraded` 若要用，必须由拥有记录的端口写，且写清失去哪项履职条件（77-§11.2）。
- **测试与证据**：`F-dsh-bridge-test-bridge`（E1）覆盖四态、config 归一、接线、两档 `required`。历史真机证据为**源码/patch 形态**（docs/31-§5 追记、docs/34-§3.1），本附录未复跑；dist 形态属 E6 未证。
- **规模与迁移**：现状 212 行 → 目标 ≤ 200 行（类型外移）。迁移只做「类型搬家 + 路径脱敏」，不改 encode 后的行为；`F-dsh-bridge-test-bridge` 在搬家后必须仍全绿（E1）。回退：单文件回退，无数据迁移。

#### F-dsh-bridge-host

- **路径/处置**：`packages/dsh-bridge/src/host.ts`；目标-新增。
- **归属/上位**：78-§2.3 载体映射表（宿主实际提供的面）与 78-§4.2 九职责（策略面要用的面）；80-§5.1（interface 优先）、§5.4（unknown 收窄）、§5.5（optional vs null）。
- **职责**：一个**零运行期依赖的结构化投影层**：把本插件用到的宿主面写成最小 `interface`，并提供把 `unknown` 收窄为这些面的纯函数。**非职责**：不声明宿主真实 API 形状（78-§4.1 V5 明确「插件 API 未探」）；不做能力探测；不缓存宿主对象。
- **内部结构**：
  - 类型：`PromptFace`（`section(spec)`、`getSectionOrder(placement)`）；`ToolFace`（`restrict(policy)`、`guard(spec)`——具体形参结构**未证**，目标以 `readonly unknown[]`/结构化占位表达，调用点集中一处便于探针后修正）；`SandboxFace`（`setPolicy`）；`ApprovalFace`（`setPolicy`）；`PresentationFace`（`setPresentation(mode, presentation)`——对应 78-§3.2.4 的 `dsh-agent-tool-presentation` 三档；**三档行为与默认值未证**）；`CheckpointFace`（`setPolicy(spec)`——对应 78-§4.2 #9 `session-checkpoint-policy`）；`EventFace`（`emit(name, payload)`）；`AgentLike`（`id?`、`source?`、`ctx?`——`source` 取自 78-§2.3/`agent/created` 载荷的 `{agent, source}`，本包只透传不解释）；`AgentContextLike`（可选 `systemPrompt`/`tools`/`sandbox`/`approval`/`presentation`/`checkpoint`/`events` + `effect(fn,label?)`）；`PluginContextLike`（`on('agent/created', listener)`）。
  - 面的来源与强度必须写在类型注释里，不得只写方法名：`tools`/`sandbox`/`approval` = 硬边界（拒绝可观测）；`presentation` = 中（不足以挡任意代码）；`checkpoint` = 中；`systemPrompt`/persona = 软（78-§2.4 三分法）。这条注释是 78-§2.4 判据在文件级的落点。
  - **类型不等同于契约**：`ToolFace.restrict(policy)`/`guard(spec)` 的形参在本文件用结构化占位（`readonly unknown[]` 或 `{ readonly [k: string]: unknown }`），并集中在一个注释块里标 `unverified`；探针（78-§13 `P-78-02`/`P-78-03`/`P-78-16`）回来前，任何调用点都不得假定参数形状、默认值或返回语义（G7）。
  - 纯函数：`isRecord(v)`、`readString(v)`、`readStringArray(v)`、`readBool(v)`（返回 `undefined` 而非抛错，交由调用方决定 fail-closed 或降级）。
  - 常量：无（不设第二套段名/事件名词表；事件名词表在 `position/events.ts`）。
- **导出与依赖**：仅类型 + 上述四个收窄函数。依赖：无（`import type` 也只有本文件内部）。禁止：`node:*`、宿主包、`./position/**`（避免桥因策略面类型而耦合）。
- **IO 与注入**：零 IO。宿主对象只由 `apply` 的 `ctx` 与监听载荷传入，本文件不持有引用。
- **状态与并发**：无状态。所有类型字段可选，是刻意的：**「面缺失」必须可判**，不能靠 `as` 断言掩盖。
- **错误与观测**：不产生错误；收窄失败只返回 `undefined`。这是「不猜宿主」的实现手段（80-§5.4）。
- **测试与证据**：无独立测试件（N/A：类型在运行期消失；四个收窄函数由 `test/bridge.test.ts` 的 config 用例与 `test/position/*` 的伪宿主用例间接覆盖）。真实宿主形状归 E6/78-§13 探针（未证）。
- **规模与迁移**：≤ 120 行。迁移：先建本文件、`index.ts` 改为 re-export，再动 position；测试无需改。

#### F-dsh-bridge-artifact

- **路径/处置**：`packages/dsh-bridge/src/artifact.ts`；目标-新增。
- **归属/上位**：79-§7.2「由 dsh-bridge 暴露「插件入口路径」的解析器（读自身 `exports` 或 `dsh.bundle`），daemon 只消费解析结果」；80-§12.2#3（零依赖）；78-§4.3（挂载需 `--patch`）。
- **职责**：把「本包声明了什么产物」解析成**入口说明符**（entry specifier）与**补丁说明符**，使消费方不再推导目录形状。**非职责**：不读文件系统、不判断产物是否存在、不校验版本/摘要、不解析 YAML、不发起装载。存在性检查与版本比对留消费方（79-§7.2 原文「存在性 + 版本检查」由 daemon 做）。
- **内部结构**：
  - `ArtifactTarget = 'bridge' | 'position'`（封闭两值；不设通配目标）。
  - `EntrySpec = { target: ArtifactTarget; specifier: string; typesSpecifier?: string }`。
  - `PackageFacts = { name?: string; version?: string; enginesNode?: string; files: readonly string[]; privateField: boolean; licenseField?: string }`——只作**声明事实**透传，不做判定（`private`/`license` 是否合规归发布面 D3/E5）。
  - `ArtifactState = 'resolved' | 'missing' | 'invalid'`，配 `detail?: string`（`missing` = 声明的键不存在；`invalid` = 键存在但形状不合规，如指向 `src/`、缺 `types`、含 `*` 通配）。
  - `parseArtifacts(manifestJson: unknown) → Artifacts`：只读 `name`/`version`/`engines.node`/`exports`/`main`/`types`/`files`/`dsh.bundle.patch`；未知键忽略（manifest 是外部数据）；`files` 不是字符串数组即记 `invalid`（不猜）。
  - `resolveEntry(artifacts, target) → EntrySpec | {state:'missing'|'invalid', detail}`：`bridge` 读 `exports["."]`，`position` 读 `exports["./position"]`；命中 `{types, import}` 形状时分别取两值，字符串形状时 `typesSpecifier` 缺省并记 `invalid`（79-§6.2 要求 `types` 在前、同目录同名）。
  - `resolveBundlePatch(artifacts) → string | missing`：只认 `dsh.bundle.patch`。
  - **不解析** `cordis.position.patch.yml`：`dsh.bundle.patch` 只能有一个值，position 补丁的发现方式未定（G6），解析器**不得**按文件名约定去猜；调用方要 position 补丁必须自己声明来源（部署配置），这是缺口而不是本文件的默认行为。
  - 拒绝规则：`specifier` 含 `src` 段 → `invalid`（79-§6.2 第 5 条）；含 `*` → `invalid`（第 4 条）；含 `..` 或绝对路径 → `invalid`（说明符必须包内相对）；`position` 未声明 → `missing`（不回落 `main`，避免把桥入口当策略入口）。
  - 一致性检查（只报不改）：`main` 与 `exports["."]` 指向不同 → `invalid`；`types` 不在同一目录同名 → `invalid`（79-§6.2 规则 2）；`files` 未含 `dist` → `invalid`（切 dist 后）。
- **导出与依赖**：上述五个类型/函数。依赖：无（纯函数，连 `node:path` 都不需要）。禁止 fs——这是与 79-§7.2「读自身」的实现差异：**语义一致、可测性更强**；如需「自带文件读取」，由消费方传入已解析 JSON。
- **IO 与注入**：零 IO。manifest 数据由调用方读入（注入）。
- **状态与并发**：纯函数，无状态、无缓存。幂等：同输入恒同输出。
- **错误与观测**：不抛错；三态结果 + `detail` 供消费方分类。`detail` 只含键路径与规则名，不含绝对路径、不含文件内容。
- **测试与证据**：`F-dsh-bridge-test-artifact`（E1）。可证明：声明解析与拒收规则。不证明：Node/TS 真能解析该说明符（E3/E4）、宿主能装载（E6）。
- **规模与迁移**：≤ 150 行。迁移：M1 先落（源码形态，零行为变化）；M3 由 daemon 改消费（跨范围，见 §九 G5）。回退：无人引用即可删，无数据影响。

#### F-dsh-bridge-position-index

- **路径/处置**：`packages/dsh-bridge/src/position/index.ts`；目标-新增。这是 position 插件的**装载入口**（区别于桥的 `src/index.ts`）。
- **归属/上位**：78-§4.1 档案卡（`BIND-POS-01`）、§4.2 九职责、§4.3 与桥并存、§4.5 不可写面；76-§3.12 四态；77-§4.8 十三态、§4.9 H0a–H4。
- **职责**：在 `agent/created` 时**先**加载并校验 PRM，**再**把 PRM 的九个语义段落到宿主可执行面（工具收紧、逐调用判定、沙箱、审批、子 agent、软 persona/instructions），并发出 `position/*` 事件；任一步不成立即**拒绝该 agent 创建**。**非职责**：不生成 PRM（78-§3.3 归 daemon）；不产生授权（`L78-POS-01`/`L78-DSH-01`）；不写台账；不定义组织关系；不保证抗绕过；不表达网络/进程/秘密边界（宿主无此词汇，78-§2.4）。
- **内部结构**：
  - 常量：`name = 'studio-next-position'`（**实现选择**：78 未定名，78a-§5.3 只说「名称由 78 定」；改名必须与 patch/测试同单 → G1）；`inject = []`（不依赖宿主服务；若后续采用服务依赖排序，见 G2）；`DEFAULT_MANIFEST_ENV = 'STUDIO_NEXT_POSITION_MANIFEST'`。
  - `PositionConfig = { manifestPath?: string; manifestEnv?: string }`。**没有** `required`（策略面不存在可选降级，78-§4.2 #1）；**没有** `digest`/`key` 之类的「调用方传函数或密钥」字段——overlay 的 config 是 YAML 数据，传不了函数，也**不得**让配置携带秘密或本机路径（78-§3.2.3 规则 5、78-§7.4.1）。
  - `resolvePositionConfig(raw: unknown) → { config: PositionConfig; rejected?: 'config-relative-path' | 'config-unknown-key' }`：同桥的防御性归一；`manifestPath` 为相对路径 → 拒（cwd 由 launch 决定，不得猜）；出现未知键 → 拒（本包不为「多配了也不报错」背书）。这是构造期错误：抛 `Error`（不 import `ClassifiedError`），语义按 80-§5.7 记 `rejected_precondition` + `CONFIG_INVALID` + `subcause='config-invalid'`。
  - `apply(ctx, config) → unknown`：宿主入口，等价于 `listen(ctx, config)`（无 deps）。`listen(ctx, config, deps?)` 是**测试接缝**：`deps = { readFile?, now?, hostVersion?, digestOf?, verifySignature?, resolveRef? }`，逐项对应 `manifest.ts` 的注入点；生产 `apply` 不传 deps，因此生产里这六项**全部缺失**。
  - 监听体内（`listen`）：
    1. 取 `agent.ctx`；缺 `tools`/`sandbox`/`approval` 中任一 **必需面** → 抛 `host-face-missing`（不得先收紧一半再发现缺面）；
    2. 解析 manifest 路径（显式 `manifestPath` 优先于 env；相对路径拒）；
    3. `readFile` → 字节上限 → `parseManifest` → `validateShape` → `validateReferences` → `validateTime` → `validateHost` → `verifyManifest`；
    4. **注入缺失 → 直接拒绝**：`deps.resolveRef` 缺 → `manifest-refs-unresolved`；`deps.digestOf`/`deps.verifySignature` 缺 → `manifest-verifier-unavailable`。不得把「没验」当成「验过」；这就是生产形态的当前事实（G3/G17），也是 M5 可落码但 M6 不可激活的原因；
    5. 用 `policy.ts` 计算 `toolPolicy`/`subagentPolicy`/`approvalPolicy`；
    6. 按 `unsupportedSegments[]` 逐段决定「执行 / 不执行并标 `not-applicable`」：未承载段**不得**调用对应宿主面，也**不得**计入已加载；
    7. 依序调用 `tools.restrict` → `presentation.setPresentation`（清单声明 `ptc` 时；`forbidden` 也显式调用，表达「关」而不是「没说」）→ `sandbox.setPolicy` → `approval.setPolicy` → 注册 `guard`/`pre-execute` → `checkpoint.setPolicy` → （若有且承载）`persona`/`instructions` 软绑定；**顺序错即抛错**，不得「部分成功也算」；
    8. `events.ts` 发 `position/manifest-loaded`（逐段结果）；全部宿主调用包在 `ctx.effect` 内，随 agent 生命周期回收；
    9. **任一步失败**：抛错阻止 agent 创建；**不发 `position/drift`**（78-§3.4 的 drift 只在确实加载过时成立，见 §1.4 与 G19）；stderr 只写稳定码 + 基名 + 段名；**绝不以默认宽权限继续**。
  - 九职责 → 落点（78-§4.2 逐条，不得漏项）：

    | # | 职责 | 本文件落点 | 失败处置 |
    |---|---|---|---|
    | 1 | 读取并校验 PRM | 步骤 2–4（落 `manifest.ts`） | 抛错，不 spawn |
    | 2 | 应用工具白名单 | `tools.restrict(toolPolicy)` | 面缺失或调用抛错 → 抛错 |
    | 3 | 逐调用判定 | 注册 `guard` + `tools/pre-execute`（判定来自 `policy.decideToolCall`） | 注册失败 → 抛错（不得以「没有 hook 也能跑」继续） |
    | 3b | PTC / `run_code` 面 | `presentation.setPresentation(mode, presentation)` | 档位不支持 → 抛错；岗位族固定 `forbidden` 无法在本包判定 → G14 |
    | 4 | 沙箱模式与工作区根 | `sandbox.setPolicy({mode, workspaceRoot, writableSubpaths})` | 无法设置 → 不启动 |
    | 5 | 审批策略 | `approval.setPolicy({default, byEffectClass, approvers})` | 面缺失 → 抛错（无人应答即拒绝） |
    | 6 | persona / 岗位说明 | `persona`/`instructions` 软绑定 | 缺失只降质量、不阻塞；**不得**因软段缺失而放行硬段 |
    | 7 | 子 agent | 把 `subagentPolicy`（preset/toolFilter/maxDepth）交给宿主 | 越界 → 拒绝 spawn |
    | 8 | 发事件 | `events.ts` | 发不出 → `gap`，标证据缺口，不假装成功 |
    | 9 | 配合检查点 | `checkpoint.setPolicy(...)` | 无法设置 → 抛错（未持久化即崩溃 → `TOOL_OUTCOME_UNKNOWN`） |

  - 必需面与可选面：`tools`、`sandbox`、`approval` 必需（78-§4.2 #2/#4/#5）；`presentation`/`checkpoint` **按清单是否声明且该段未列入 `unsupportedSegments[]` 而定**——声明了而宿主拿不到面 = 抛错（不得静默跳过）；`events` 可选但缺失即「证据缺口」，须在 `manifest-loaded` 里标 `evidence: 'absent'`；`prompt` 可选（persona 为软段）。
  - **逐段状态**：本文件只对「实际调用过宿主面且未抛错」的段记「已加载（第 6 态候选）」；`unsupportedSegments[]` 里的段记「不适用」，不得由其他段的成功代证。第 11 态与 drift 需要运行时暴露观测，不在本文件产生（77-§4.8/§4.9）。
- **导出与依赖**：`name`、`apply`、`listen`（测试接缝，生产不传 deps）、`PositionConfig`、`resolvePositionConfig`。依赖：`node:fs/promises`、`node:process`、`node:path`（仅 `isAbsolute`）、`../host.ts`、`./manifest.ts`、`./policy.ts`、`./events.ts`。禁止：`../index.ts`（不得把桥拖进来）、`@studio-next/*`、`node:crypto`（验签不在包内）。
- **IO 与注入**：读 PRM 文件（只读、一次）；读 env；`now`/`hostVersion`/`readFile`/`digestOf`/`verifySignature`/`resolveRef` 只由 `listen` 的 deps 注入（测试），**生产 `apply` 无注入通道**（G3/G17）。不写任何文件；不连网；不读台账；不读秘密。
- **状态与并发**：`agent/created` 为串行事件（桥注释称 dsh-agent 源码 `await serial`，**本附录未核该源码**）。每 agent 一份绑定，互不共享可变状态；不做跨 agent 缓存（PRM 换段即换清单，78-§3.3 G4）。同一 agent 重复创建 → 宿主语义决定；本插件不缓存已加载清单，重放即重校验。
- **错误与观测**：本地错误码封闭集见 `manifest.ts` 的映射表；本文件额外两个：`host-face-missing`、`apply-failed`。每个错误带「停在十三态哪一态」的判定（多数停在 4 之前，见 §5.2）。stderr 只写稳定码 + 基名，不写清单内容、不写密钥、不写绝对路径。**不产生**任何 `REC-EVT-01` 信封、不写台账、不发 `position/drift`。
- **测试与证据**：`F-dsh-bridge-test-position-plugin`（E1，伪宿主 + 注入 deps）。真实宿主行为 = V5/E6 **未证**（78-§4.1「插件 API 未探」）。本文件**不声称** H0b 及 H1–H4；最高只到 H0a（已落位，且明确记录宿主未承认），插件物本身最多到第 4 态。
- **规模与迁移**：≤ 280 行。迁移：M5 可落码并用伪宿主证明「失败时零副作用」；**生产激活（M6）被 G3/G17 阻断**——没有验签/引用解析的交付通道，`apply` 只会一律拒绝。回退：卸载 patch 即回到「有 profile 无策略」，同时必须降级岗位（78-§4.1 导出/退出）。

#### F-dsh-bridge-position-manifest

- **路径/处置**：`packages/dsh-bridge/src/position/manifest.ts`；目标-新增。
- **归属/上位**：78-§3.2（PRM 字段与硬规则）、§3.4（校验顺序与双重校验）、§4.5（PRM 只读）；77-§4.8（加载/探测/偏离的举证要求）；76-§3.12（四态字面量）。
- **职责**：PRM 的**结构读取与准入校验**：字节 → 对象 → 形状/字段/取值/期限/宿主匹配 → `PositionManifest` 或具名拒绝。**非职责**：不生成清单；不做与部署配置的交集运算（78-§3.3 G3 归生成器/启动器）；不判授权；不判工具是否真的被宿主收紧。
- **内部结构**：
  - 常量：`UNCOVERED_POLICY = 'deny'`；`PTC_DEFAULT = 'forbidden'`；`PERSONA_WEIGHT = 'soft'`；`MAX_MANIFEST_BYTES`（实现选择，默认 1 MiB，超限即 `manifest-too-large`）。
  - 类型（只投影**本插件要执行**的段，不复制 78 全表）：`ManifestHeader`（`manifestRef{id,version,digest}`、`generatedFrom`（78-§3.2.1 的十项子引用，全部必填且带版本）、`generatedAt`/`generatedBy`、`hostTarget{kind,versionRange}`、`effective{from,until?,reviewBy}`、`signature{signerRef,algorithm,keyLogicalRef,signedAt}`）；`AuthoritySegment`（`permitted[]`/`reserved[]`/`prohibited[]`/`uncoveredPolicy`/`conditions[]`/`expiry`/`parentChain[]`）；`ToolsSegment`（`allow[]`/`deny[]`/`mcpServers[]`/`ptc`/`webDomains[]`/`subagent`）；`SandboxSegment`（`mode`/`workspaceRoot`/`writableSubpaths[]`/`network`/`secretCategories[]`）、`ApprovalSegment`、`PersonaSegment`、`EvidenceSegment`、`IdentitySegment`、`PlanSegment`、`ValiditySegment`；`PositionManifest` = 上述段 + 原字节（供验签）。
  - `parseManifest(bytes: Uint8Array, opts) → Result`：UTF-8 解码失败 → `manifest-parse`；JSON 解析失败 → `manifest-parse`；顶层非对象 → `manifest-shape`。
  - `validateShape(obj)`：
    - **头部**必填键齐全（`manifestRef`/`generatedFrom`/`generatedAt`/`generatedBy`/`hostTarget`/`effective`/`signature`，缺即 `manifest-shape`——78-§3.2.1 逐字段标「必填」）。
    - **段级必填：八段必填、`persona` 可选**（78-§3.2.2 分段表：`persona` 行「必填=否」，其余八段必填）。缺 `persona` **不拒、不计损失、不写 `REC-LOSS-01`**；出现则 `persona.weight` 必须为 `soft`（非 `soft` → 拒），`personaRefs[]`/`instructionsRef` 按引用形状校验。
    - 段内字段：`identity` 五键（`position_id`/`holder_id`/`engagement_id`/`work_id`/`segment_id`）齐全；`authority` 的 `permitted[]`/`reserved[]`/`prohibited[]`/`uncoveredPolicy`/`conditions[]`/`expiry`/`parentChain[]` 齐全；`plan` 的 `definitionRevision`/`contractRef`/`qualificationRefs[]`/`capabilityDescriptors[]`/`knownInabilities[]` 齐全（`knownInabilities` 允许空数组，**缺键即拒**）；`tools` 的 `allow[]`/`deny[]`/`mcpServers[]`/`ptc`/`webDomains[]`/`subagent{allowedPresets[],maxDepth,toolFilter[]}` 齐全；`sandbox` 的 `mode`/`workspaceRoot`/`writableSubpaths[]`/`network`/`secretCategories[]` 齐全；`approval` 的 `default`/`byEffectClass`/`approvers[]` 齐全；`evidence` 的 `exportKinds[]`/`retention`/`redaction`/`sinkRef` 齐全（`independentVerifierRef` 可选）；`validity` 的 `effectiveFrom`/`effectiveUntil`/`reviewBy`/`revocationWatchRef` 齐全。缺任一必填键 → `manifest-shape`。
    - `unsupportedSegments[]`（78-§3.2 G8）：可选数组，缺省等于空；元素必须取自九个段名（`identity`/`authority`/`plan`/`tools`/`sandbox`/`approval`/`persona`/`evidence`/`validity`），出现其他字符串 → 拒（`manifest-shape`）；同一段既列入 `unsupportedSegments` 又给出该段内容 → 拒（同段两种解释，插件无从选择；`persona` 除外——它本就允许缺省，列与不列都按「不注入」处理）；空数组合法。**这是本包唯一合法的「段不承载」通道**：未列入该数组且属必填段的缺失，一律 `manifest-shape`，不得当成「不支持」少校验。**实现选择（策略段不可缺）**：若 `authority` 或 `tools` 被列入 `unsupportedSegments`，本包拒载（`manifest-unsupported-segment`）——这两段是策略面的全部输入，缺任一段就没有可执行的收紧面，fail-closed 只能表现为拒绝；其余段（`identity`/`plan`/`sandbox`/`approval`/`evidence`/`validity`，以及本就可选的 `persona`）允许不承载，逐段记损失。契约后果见 78-§3.2 的 G8：逐段 `REC-LOSS-01`、未承载段停第 4/5 态，不记第 6/11 态、不报 drift（由消费侧执行，本包只把 `unsupportedSegments[]` 原样交给调用方）。
    - 硬规则：`uncoveredPolicy` 非 `deny` → 拒（**不可配**，78-§3.2.2 `authority` 行）；`sandbox.network` 非 `external-only` → 拒（它是**声明外置**，不是策略，也不参与 G3 交集）；`evidence.sinkRef` 缺失或指向宿主本地日志 → 拒（78-§3.2.2 `evidence` 行：本地日志不算 sink）；`ptc.mode` 缺省按 `forbidden` 补齐（**唯一允许的默认值**），`mode='allowed'` 时 `presentation`/`codeExecutionCapabilityRef`/`reachableTools`/`fileBoundary`/`networkBoundary`/`processBoundary`/`osExecutionBoundary`/`extraApprovalRef` 缺任一 → 拒，且 `networkBoundary`/`processBoundary`/`osExecutionBoundary` 未取证时只允许 `forbidden`（78-§3.2.4）；`mode='forbidden'` 与 `presentation='native'` 以外的呈现档同现 → 拒（`native` 是 `forbidden` 的唯一对应）；`reachableTools ⊄ tools.allow` → 拒；`fileBoundary` 宽于 `sandbox` → 拒；`tools.subagent.maxDepth` 未给按 0、`toolFilter[]` 必须 ⊆ `tools.allow`（78-§4.4）；任何引用出现字面量 `latest` → 拒；顶层或被投影段出现未知键 → 拒（78-§3.2「无来源的字段 = 不得出现」）。
  - `validateReferences(manifest, opts)`：`generatedFrom` 的十项子引用（`definitionRevision`、`appointmentRef`、`workRef`+`contractRef`、`planLockRef`、`grantRefs`、`withdrawalRefs`、`qualificationRefs`、`capabilityDemandRef`、`conflictConclusions`、`bindingProfileRef`——按 78-§3.2.1 原文计十项，`workRef` 与 `contractRef` 同在一项内但都是独立引用，须各自可解析）必须**全部可解析到带版本的对象**（78-§3.2.1「任一引用不可解析 = 拒绝加载」）。可解析性由调用方注入的 `resolveRef(ref) → {found, version?}` 判定（本文件零 IO，不查台账）；注入缺失 → `manifest-refs-unresolved`（拒绝），不得跳过、不得当作「无引用」放行。**注意**：`appointmentRef` 指向的任职若本身无效（`REC-LIFE-05`，76-§3.11），本文件**不判、也判不了**——它只核「引用存在且带版本」；任职有效性归台账与启动器。
  - **岗位族固定值：不设函数**。78-§3.2.4 规定「复核/验收、审计/巡检、协调/管理岗的 `ptc.mode` 固定 `forbidden`，PRM 不得覆盖（覆盖即拒收）」，但**本包拿不到岗位族**——PRM 的 `identity` 只有 `position_id`/`holder_id`/`engagement_id`/`work_id`/`segment_id`，没有族字段；族在公司定义里，本包零出边无法查。因此该规则只能在生成器/启动器侧执行；插件侧不得自造 `family` 字段来「补上」（那会新增概念）。登记为 G14。
  - `validateTime(manifest, now)`：`effective.from > now` 或 `until < now` 或 `reviewBy < now` → `manifest-expired`（`from` 未到也算不可用，fail-closed）。
  - `validateHost(manifest, hostVersion)`：`hostTarget.kind` 非 `dsh` → `manifest-host-mismatch`；`versionRange` 的**区间求值不在本文件实现**（75-D75-09 的结构化 SemVer 归 79 的公共声明；本包零依赖不得自带第二套 range 语义）——本文件只接受**与宿主版本精确相等**的 `versionRange` 串（78-BIND-DSH-01 的 `LOCKED_VERSION = 0.2.0-rc.2`，逐字相等，不做前缀/区间/通配解释）；不相等 → `manifest-host-mismatch`。生成器必须据此产出精确串。**不得**把「无法判定区间」写成 `unverified` 放行——那是放行，不是拒绝；本文件对 `versionRange` 只有「逐字相等」与「不相等」两种结论。
  - `verifyManifest(manifest, deps)`：`deps = { digestOf(bytes, algorithm): string; verifySignature(algorithm, keyRef, bytes, sig): boolean }`。先摘要后签名（78-§3.4 顺序）。**无默认实现**：本文件不带摘要器/验签器（不 import `node:crypto`，见 §1.3），`deps` 缺 `digestOf` 或 `verifySignature` → `manifest-verifier-unavailable`（拒绝）；摘要串与 `manifestRef.digest` 不等 → `manifest-digest-mismatch`；签名不通过 → `manifest-signature-invalid`。任一步不可用即拒绝，不得跳过、不得降级为「未验签但放行」。
- **本地封闭码与映射（唯一错误面）**：下列码是**本包本地封闭集**（`ManifestErrorCode`），不是 `FailureClass`，不改名、不外扩、不 import `@studio-next/contract` 的 `ClassifiedError`；由 daemon 侧 1:1 映射（本包零出边，映射表在调用方）。`detail` 只给键路径与取值类别，不回显清单原文。

  | 本地码 | 77-§11.1 处置类（`failure`） | 80-§5.7 `category` | 备注 |
  |---|---|---|---|
  | `manifest-path-relative` | `rejected_precondition` | `CONFIG_INVALID` | 配置给的路径不是绝对路径/含 `..` |
  | `manifest-missing` | `rejected_precondition` | `CONFIG_INVALID` | 文件不存在 |
  | `manifest-unreadable` | `rejected_precondition` | `CONFIG_INVALID` | 权限/IO 失败 |
  | `manifest-too-large` | `rejected_precondition` | `CONFIG_INVALID` | 超 `MAX_MANIFEST_BYTES` |
  | `manifest-parse` | `rejected_precondition` | `CONFIG_INVALID` | UTF-8 或 JSON 解析失败 |
  | `manifest-shape` | `rejected_precondition` | `CONFIG_INVALID` | 形状/取值/未知键/`unsupportedSegments` 非法 |
  | `manifest-verifier-unavailable` | `rejected_precondition` | `CONFIG_INVALID` | 注入通道缺口（G3/G17） |
  | `manifest-refs-unresolved` | `rejected_precondition` | `CONFIG_INVALID` | 引用解析通道缺口（G3） |
  | `manifest-expired` | `rejected_precondition` | `CONFIG_INVALID` | `from` 未到/`until` 已过/`reviewBy` 已过 |
  | `manifest-digest-mismatch` | `unverified` | `EVOLVE_REJECT` | **近似映射**：77 无「完整性校验失败」类（G10），不得当判等 |
  | `manifest-signature-invalid` | `unverified` | `EVOLVE_REJECT` | 同上 |
  | `manifest-host-mismatch` | `unsupported` | `EVOLVE_REJECT` | 宿主版本/`kind` 不符 |
  | `manifest-unsupported-segment` | `unsupported` | `EVOLVE_REJECT` | `authority` 或 `tools` 被列入 `unsupportedSegments`（策略段不可缺） |
  | `host-face-missing` | `unsupported` | `EVOLVE_REJECT` | 宿主事件面/工具面缺失（由 `position/index.ts` 产生） |
  | `apply-failed` | `unavailable` | `STALL` | `apply` 内未归类的抛出（由 `position/index.ts` 兜底） |
- **导出与依赖**：类型 + `parseManifest`/`validateShape`/`validateReferences`/`validateTime`/`validateHost`/`verifyManifest`，以及 `ManifestErrorCode`。依赖：无（不 import `node:crypto`；`digestOf`/`verifySignature`/`resolveRef`/`now`/`hostVersion`/`bytes` 全部注入）。禁止：zod（零依赖）、`@studio-next/contract`（无出边；也不为「统一错误形状」而引入——映射在调用方）、台账查询（引用可解析性靠注入）。
- **IO 与注入**：零 IO。字节、`now`、宿主版本、摘要/验签/引用解析函数全部由 `position/index.ts` 传入；本文件不读文件、不读 env、不碰网络。
- **状态与并发**：纯函数；不缓存；同输入同输出。拒绝时不含部分结果（要么整份清单可用，要么整份不用）。
- **错误与观测**：只返回上表之内的本地码；返回形状用本地 `Result<T, ManifestErrorCode>` 二分（`Ok`/`Err`，结构上与 80-§5.7 的 `Result` 同形，但**不 import**、不导出为公共契约类型——本包零出边）；`detail` 只给键路径与取值类别（如 `tools.ptc.mode=allowed 缺 osExecutionBoundary`），不回显清单原文（可能含岗位与组织信息），不写 stderr（stderr 归 `position/index.ts`）。
- **测试与证据**：`F-dsh-bridge-test-position-manifest`（E1）。**不证明**：JCS 摘要实现的正确性（测试用 stub `digestOf`，与 76-§1.5.1 `studio-next/jcs@1` 的实现无关）；真实签名的密钥管理与算法（G17）；宿主是否照清单执行。
- **规模与迁移**：≤ 440 行（v0.3 起：八段必填/persona 可选 + `unsupportedSegments` 校验 + 本地码映射表 + 宿主逐字比对；本包最大件，仍远低于 600）。若逼近 600，拆分顺序为「`manifest/parse.ts`（形状）+ `manifest/verify.ts`（时间/宿主/签名/引用）」，ID 各新立，不重用本 ID。迁移：M4（只落码）；生产生效随 M6，被 G3/G17 阻断。

#### F-dsh-bridge-position-policy

- **路径/处置**：`packages/dsh-bridge/src/position/policy.ts`；目标-新增。
- **归属/上位**：76-§3.12（四态与判定顺序）；78-§4.2 #2/#3/#7、§4.4（子 agent 衰减）；77-§11.1（失败类别，仅供映射，不 import）。
- **职责**：把 PRM 的 `authority`/`tools`/`subagent` 段编译成三个可直接交给宿主的策略对象（工具集、子 agent、审批），并对**单次工具调用**给出四态判定。**非职责**：不执行调用、不记录事件（归 `events.ts`/调用点）、不审批、不判授权真实性。
- **内部结构**：
  - `ToolCall = { tool: string; argsDigest?: string; effectClass?: 'E0'|'E1'|'E2'|'E3'|'E4'|'E5'|'E6' }`（`effectClass` 只作审批模板选择，不是风险分类判定——`REC-WORK-11` 归 daemon）。
  - `Verdict = { kind: 'deny'|'ask'|'allow'; state: 'prohibited'|'reserved'|'permitted'|'uncovered'; reason: VerdictReason; basisRef?: string }`；`VerdictReason = 'in-prohibited'|'in-reserved-approved'|'in-reserved-unapproved'|'in-permitted'|'not-covered'|'condition-unknown'`。必须带 `reason`：`prohibited` 与 `uncovered` 的 `kind` 都是 `deny`，只靠 `state` 在事件载荷里区分不够稳，且二者的追责不同（76-§3.12 第 4 点）。
  - `decideToolCall(manifest, call) → Verdict`：严格顺序 `prohibited → reserved → permitted → uncovered(deny)`（78-§4.2）。命中 `reserved`：有与本次调用绑定的具名批准（`approval.approvers[]` 内存在该批准）→ `allow` + `reason='in-reserved-approved'`；无具名批准 → `ask` + `reason='in-reserved-unapproved'`，审批超时由宿主 fail-closed，本文件**不设超时也不猜结果**——**不得**把「本文件没看到批准」直接判 `deny`。`uncovered` → `deny` + `state='uncovered'` + `reason='not-covered'`（**不得写成 `prohibited`**）。`conditions[]`/`expiry`/`parentChain[]` 的包含关系无法判定 → `deny` + `reason='condition-unknown'`（76-§3.12 第 5 点）；这个「无法判定」属于 76 的授权语义，**不是** 77 的异常类 `unknown`，也不是平台 `mapState` 的 `unverified`（三者在不同轴，互不代用）。
  - `deriveToolRestrict(manifest) → { allow: readonly string[]; deny: readonly string[]; conflicts: readonly { tool: string; in: 'allow'|'deny' }[] }`：`allow=[]` 是**空集**——「无工具」，**不得**解释为「全部」（78-§3.2.3 规则 2）。同一工具同现于 `allow` 与 `deny` → `deny` 优先、不静默取一边，逐条记 `conflicts[]`；`conflicts[]` 非空时由 `position/index.ts` 记入 `position/manifest-loaded` 的逐项结果并继续（策略取严），不整份拒绝——拒收会让一张自相矛盾的清单换掉一张可用的旧清单，反而放宽。
  - `deriveSubagentPolicy(manifest) → { allowedPresets: readonly string[]; maxDepth: number; toolFilter: readonly string[]; rejections: readonly string[] }`：`maxDepth` 未给 = 0（78-§4.4）；`toolFilter ⊄ tools.allow` → 整条子策略拒（`rejections[]` 记 `subagent.toolFilter-not-subset`），**不裁剪**成可用的较宽子集。**不返回 `ptc`**：78 的 `tools.subagent` 段没有 PTC 子字段，而 §4.4 又要求「子不得宽于父、父 `allowed` 时子须显式重列」——重列无落点（G16），本文件不得自造字段；父 `ptc.mode='forbidden'` 时子必然是 `forbidden`；父 `allowed` 时本文件一律按 `forbidden`（取最严），不改写清单、不假装校验过。
  - `deriveApprovalPolicy(manifest) → { default: ApprovalMode; byEffectClass: Readonly<Record<EffectClass, ApprovalMode>>; approvers: readonly string[]; tightened: readonly string[] }`：`never` 只允许在 E0/E1 且 `authority.reserved` 为空时（78-§3.2.2 `approval` 行）；否则收紧为 `ask` 并逐条记 `tightened[]`。`byEffectClass` 是**默认模板**（按效果类查表的初值），不是单次调用的最终判定——单次判定归 `decideToolCall`。`approvers[]` 原样透出，供 `decideToolCall` 判「有无具名批准」。
- **导出与依赖**：上述类型与四个纯函数。依赖：无（唯 `manifest.ts` 的类型）。禁止：IO、宿主对象、`@studio-next/contract`。
- **不实现 `RuleEvaluator`**：本文件没有 `RuleProfile`/`RuleOutcome`；`decideToolCall` 返回的是 76-§3.12 的四态判定对象，**不是** 80-§6.1 的 `RuleOutcome`。不得为「对齐接口」把它包成 `Result<RuleOutcome>`，也不得把四态塞进 `RuleOutcome` 的取值域——四态不合并、`refused` 语义也不借用（§十一 第 1 条）。
- **状态与并发**：纯函数；无状态。同一清单重复求值结果一致（G2 幂等的前提之一）。
- **错误与观测**：不抛错；不可判定与自相矛盾的输入通过 `rejections[]`/`tightened[]`/`conflicts[]` 回给调用方，由 `position/index.ts` 决定记录方式。**不静默降级、不静默取严也不静默放宽**。
- **测试与证据**：`F-dsh-bridge-test-position-policy`（E1）。覆盖面见 §七；不证明宿主真的执行了 allow/deny。
- **规模与迁移**：≤ 220 行。迁移：M4。回退：无状态，删文件即回退（调用点同单改）。

#### F-dsh-bridge-position-events

- **路径/处置**：`packages/dsh-bridge/src/position/events.ts`；目标-新增。
- **归属/上位**：78-§4.6（事件表与硬规则）；77-§2.6 `REC-EVT-01`、§2.8 `REC-EVT-03`（**只引用，不产生 REC-ID**）。
- **职责**：定义并发出五个 `position/*` 事件的**最小载荷**，并明确「发不出时如何标证据缺口」。**非职责**：不落台账、不写文件、不完成 `REC-EVT-01` 的完整信封（那由 daemon 收割时组装）；不判事件真假。
- **内部结构**：
  - `PositionEventName = 'position/manifest-loaded'|'position/denied'|'position/approval'|'position/drift'|'position/segment-end'`（封闭五值，与 78-§4.6 一一对应；**不新增、不改名**——事件名即契约，82 卷按名写测试）。命名不一致登记为 G18：78-§4.1 的档案卡证据行把拒绝事件写作 `position/deny`（单数），§4.6 的事件表写作 `position/denied`；本附录按 §4.6 落码，待 78 统一后再同步。
  - 载荷（只列最小必需；字段名取自 78-§4.6，不自造）：
    - `manifest-loaded`：`manifestRef{id,version,digest}`（完整摘要，不截断、不做 `sha8`）、宿主 `kind`/`version`、逐项校验结果（每项一码，取自 `manifest.ts` 的本地封闭集）、逐段暴露比对（九段各自 `loaded`/`unsupported`/`absent`；`persona` 缺省记 `absent` 且不算失败）、`evidence: 'present'|'absent'`（`absent` 即本次 `emit` 的 `gap`）、`unsupportedSegments[]` 的实际生效结果。
    - `denied`：工具名、**四态之一**（`state`）、`reason`（取自 `VerdictReason`）、`basisRef`、`argsDigest`（**只记摘要不记参数原文**，防任务内容泄露）。
    - `approval`：审批者标识、问题（`effectClass` 与被问到的 `reserved` 项）、结果（`allow`/`deny`/超时）、是否超时。
    - `drift`：差异项（哪一项、声明值 vs 观测值）+ 影响面（哪些段、哪些工具）。**只在插件确认已加载之后才发**；加载失败不发 drift（G19）。
    - `segment-end`：段标识（九段名之一）+ 结束原因（`unsupported`/`done`/`error`，取自 78-§4.6；本文不扩值域）。
  - `emitPositionEvent(face, name, payload) → { emitted: true } | { emitted: false; gap: 'no-bus'|'rejected'; detail?: string }`：宿主 `EventFace` 缺失（`no-bus`）或调用抛错（`rejected`）时返回 `gap`，由调用方写进 `manifest-loaded` 的 `evidence` 字段或 stderr；**不得假装已发**（78-§4.6「发不出 = 证据缺口，须标 unknown」）。这个 `unknown` 只是证据缺口标记，与 `Verdict.reason='condition-unknown'`（76 授权语义）、77-§11.1 的异常类 `unknown` 都不同轴，不得互相代用。
  - **不产生**：不生成 `REC-EVT-01` 信封（由 daemon 收割时组装）、不写台账、不发 `Notification`（`position/*` 是宿主总线事件，不是 `Notifier` 消息）、不补写丢失的事件（78-§4.7 `L78-POS-03`）。
- **导出与依赖**：事件名常量、载荷类型、`emitPositionEvent`。依赖：`../host.ts` 的类型。禁止：`node:fs`（不落盘）、任何 sink 写入（sink 归外部）。
- **IO 与注入**：只经宿主事件面；无时间/随机（时间由调用方放入载荷，便于测试）。秘密边界：载荷内不出现清单原文、密钥、绝对路径。
- **状态与并发**：无状态。事件可丢（78-§4.7 `L78-POS-03`），丢失必须显式化，不能补写。
- **错误与观测**：返回三态结果；不抛错（抛错会掩盖「事件丢失」与「策略拒绝」的区别）。
- **测试与证据**：由 `F-dsh-bridge-test-position-plugin` 覆盖（伪事件面：正常发、无总线、总线抛错三例）。不证明真实宿主总线存在（未证）。
- **规模与迁移**：≤ 120 行。迁移：M4。

### 4.2 测试与测试基建

〔字段约定〕本节 10 个测试件的「内部结构」= `describe`/`it` 分组 + 夹具函数，由各条的「覆盖」「夹具与 fake 边界」承担；「导出与依赖」= **N/A**（测试件不导出生产符号；依赖仅 `vitest` + Node 内建 + 被测源码，无第三方）；「错误与观测」= **N/A**（测试件不产生生产错误面），由「正反用例」「证据层级」承担。凡某测试件确有额外结构（如伪宿主录制器），在该条内单列。

#### F-dsh-bridge-test-bridge

- **路径/处置**：`packages/dsh-bridge/test/bridge.test.ts`；目标-拆分：把「可分发件形状」2 例迁到 `test/artifact.test.ts`，其余 13 例保留并补 dist 断言于新文件（避免同一文件同时钉两种形态）。
- **覆盖**：装载形状（`name`/`inject`/`apply`）；`resolveBridgeConfig` 的全部分支；`readInstructions` 四态与自定义 env；`apply` 接线（section 的 name/order/text、effect 包裹、返回销毁器）；`required` 两档与宿主面缺失两档。
- **夹具与 fake 边界**：`fakePluginCtx` 只捕获监听器并返回假 token；`fakeAgentContext` 录制调用；`process.env` 直改后恢复；临时目录 `mkdtemp` 用完删除。**fake 不证明**：宿主真会注册段、`agent/created` 真为串行、段名冲突真会报错、`getSectionOrder` 真返回数值。
- **正反用例**：四态各一正向 + `unreadable` 负向；`required=true` 抛 `required=true`；宿主缺 `systemPrompt` 抛 `缺 systemPrompt`。目标新增：诊断脱敏用例（stderr 不含完整绝对路径）——用捕获 `process.stderr.write` 的伪件，不引入新依赖。
- **证据层级**：E1。R/E/W 映射：不直接承载 R 用例；对应 78-§4.3 的「上下文软段」行为面。V：V1（结构）+ V2（行为）。
- **规模与迁移**：321 行 → 目标 ≤ 320 行（迁出 2 例后净减）。迁移顺序：先迁出（`artifact.test.ts` 建好）再改断言，保证任一提交点测试可运行。

#### F-dsh-bridge-test-artifact

- **路径/处置**：`packages/dsh-bridge/test/artifact.test.ts`；目标-新增。
- **覆盖**：`parseArtifacts` 对真实 `package.json` 与目标形态 `package.json` 的解析；`resolveEntry('bridge')` 与 `resolveEntry('position')`；`types` 优先；`missing`（无 `./position`）；`invalid`（指向 `src/`、缺 `types`、含 `*`）；`resolveBundlePatch`；迁入的两例：`dsh.bundle.patch` 指向真实文件、patch 文本的 `insert` 形状与 env 指名。
- **夹具与 fake 边界**：以**内存对象**为主（不起 fs），只对真实 `package.json`/`cordis.patch.yml` 做一次文本读取。**不证明**：Node 能否解析说明符（E3）、消费者 `tsc` 能否解析（E4）、宿主能否装载（E6）。
- **正反用例**：每个拒绝规则至少一例负向；`position` 未声明必须 `missing` 而非回落 `main`。
- **证据层级**：E1；为 E2/E4 的解析面提供前置断言。V1 + V2。
- **规模与迁移**：≤ 180 行。迁移：M1 建立；M2 改断言为 dist 形态（与 `package.json`、patch 同单）。

#### F-dsh-bridge-test-position-manifest

- **路径/处置**：`packages/dsh-bridge/test/position/manifest.test.ts`；目标-新增。
- **覆盖**：段级（八段必填、`persona` 可选——缺 `persona` 不拒且不记损失，`persona.weight` 非 `soft` 拒）；`unsupportedSegments[]` 三例（非法段名拒、与已给出段冲突拒、空数组合法）；段内必填（`identity` 五键、`approval.approvers[]`、`tools.subagent{allowedPresets,maxDepth,toolFilter}`、`plan.knownInabilities[]` 空数组合法但缺键拒、`sandbox.network='external-only'`）；未知顶层键拒；`latest` 拒；`uncoveredPolicy` 非 `deny` 拒；`ptc.mode` 缺省 = `forbidden`；`mode='allowed'` 缺任一 PTC 字段拒；`reachableTools ⊄ allow` 拒；`allow=[]` 表达「无工具」；`effective` 未到/已过/`reviewBy` 已过三例；`hostTarget.versionRange` 与 `LOCKED_VERSION`（`0.2.0-rc.2`）**逐字相等**才通过——`^0.2.0` 与 `0.2.0` 各一例证明不做区间/前缀解释；`generatedFrom` 十项任一缺失或不可解析 → `manifest-refs-unresolved`；`resolveRef` 未注入 → `manifest-refs-unresolved`、`digestOf`/`verifySignature` 未注入 → `manifest-verifier-unavailable`（拒绝而非放行）；摘要不符 → `manifest-digest-mismatch`；签名无效 → `manifest-signature-invalid`；本地码→77 `failure`/80 `category` 映射表**逐行**断言（表驱动，表本身即断言源）。
- **夹具与 fake 边界**：内置最小合法清单（手写 JSON 字符串，非生成器产物）；`digestOf` 用确定性 stub（如长度 + 固定盐，**不是 JCS**）；`verifySignature` 用注入 stub 判「通过/不通过」，需要真实签名形态时用 `node:crypto` 临时密钥对（**仅测试件**可用 Node 内建，生产件不引入）。**不证明**：真实 JCS 摘要一致、真实 PRM 生成器输出、宿主行为。
- **正反用例**：每条硬规则一正一反；「部分字段合法但整体不可用」必须无部分结果。
- **证据层级**：E1；V1 + V2。真实 PRM 兼容性归 V3/V5（未证）。
- **规模与迁移**：≤ 360 行（v0.3 上调：段级必填/`unsupportedSegments`/宿主逐字比对/映射表逐行断言）。迁移：M4 先于 M5。

#### F-dsh-bridge-test-position-policy

- **路径/处置**：`packages/dsh-bridge/test/position/policy.test.ts`；目标-新增。
- **覆盖**：真值表四态 × 四态（16 格）以最小清单覆盖，每格断言 `kind`+`state`+`reason` 三元组；顺序反例（同一动作同时命中 `prohibited` 与 `permitted` → `deny` 且 `state='prohibited'`）；`uncovered` 不得被写成 `prohibited`（`reason='not-covered'`）；`reserved` 无具名批准 → `ask`+`in-reserved-unapproved`（不是 `allow`），有具名批准 → `allow`+`in-reserved-approved`；`conditions`/`expiry`/`parentChain` 无法判定 → `deny`+`condition-unknown`（且**不得**记成 77 的 `unknown`）；`allow=[]` → 空集；`deny`/`allow` 冲突 → `deny` 优先且逐条回 `conflicts[]`；子 agent `toolFilter` 越界 → 整条子策略拒（`rejections[]`），不裁剪；`maxDepth` 缺省 0；父 `ptc.mode='forbidden'`/`'allowed'` 两例均得子 `forbidden`（后者只断言「本文件不产子 PTC」）；`approval.never` 在 E2–E6 或 `reserved` 非空时被收紧为 `ask` 并回 `tightened[]`；`approvers[]` 原样透出。
- **夹具与 fake 边界**：清单对象直接构造；无 IO、无宿主。**不证明**宿主真的按 verdict 执行。
- **正反用例**：每格至少一条；反例优先于正例（顺序错误的回归最容易发生）。
- **证据层级**：E1；直接对应 R27（清单外事项）与 R6（出工中换能力）的**判定面**，不承载其记录面。V2。
- **规模与迁移**：≤ 220 行。迁移：M4。

#### F-dsh-bridge-test-position-plugin

- **路径/处置**：`packages/dsh-bridge/test/position/plugin.test.ts`；目标-新增。
- **覆盖**：成功路径经**测试接缝** `listen(ctx, config, deps)` 注入 `readFile`/`now`/`hostVersion`/`digestOf`/`verifySignature`/`resolveRef`（清单合法 → `restrict` 收到 allow 集、`guard`/`pre-execute` 注册、sandbox/approval 设定、`manifest-loaded` 发出、`effect` 包裹）；失败路径（文件缺失/不可读/超限/解析失败/形状不合法/摘要不符/签名无效/引用不可解析/过期/宿主版本不符/宿主面缺失 → 抛错且**未调用**任何收紧面）；**无 deps 的 `apply` 必须拒绝**（断言 `manifest-verifier-unavailable`，且同样零收紧面调用）——生产没有注入通道，这条是当前唯一可能的真实行为（G3/G17）；证据缺口（无事件面 → `gap:'no-bus'` 且不抛）；**加载失败不发 `position/drift`** 的负向断言（G19）；配置归一（相对路径拒、显式路径优先于 env）；`tools.guard` 的判定来源带 `basisRef` 与 `reason`。
- **夹具与 fake 边界**：伪 `agent.ctx` 提供 `tools`/`sandbox`/`approval`/`events` 录制器与 `effect`；伪 `plugin.ctx` 捕获监听器；`deps` 全部为 stub。**不证明**：真实 DSH 的 `restrict`/`guard` 形参与语义（未证，78-§4.1/§13）、真机是否让 agent 创建失败、同进程篡改能否绕过。
- **正反用例**：失败矩阵逐项；「失败时零副作用」必须有断言（否则 fail-closed 无法证）。
- **证据层级**：E1；V2。真机 = E6 未证。
- **规模与迁移**：≤ 300 行。迁移：M5。

#### F-dsh-bridge-test-smoke

- **路径/处置**：`packages/dsh-bridge/test/smoke/bridge-smoke.ts`；目标-保留（仅测试/演示），套外手动执行，不进 `vitest`。
- **职责**：源码形态的端到端真机判据：起临时 web 宿主 + `--patch` overlay + 含随机标记串的指令文件，断言模型终答含标记串（标记串只存在于注入文件，判据独立）。
- **非职责**：不是 CI 门禁；不证明 dist 形态；不证明策略面；不证明其他 DSH 版本。
- **IO 与边界**：spawn `dsh`（`DSH_BIN` 可覆盖；未设时取部署给定的 `<dsh-binary>` 逻辑占位，仓内**不写**默认绝对路径 → G8）；固定 `<smoke-port>`（与常驻 daemon 端口隔离）；`DSH_TELEMETRY_MODE=DISABLED`；只验 `<home>/.dsh/.env` 中存在密钥**条目名**（不读值、不打印、不入仓）；240s 轮询；`SIGTERM→SIGKILL` 收口；清理临时目录与 `<home>/.dsh/sessions` 中含 `dsh-bridge-smoke` 的目录。
- **状态与并发**：单进程串行；失败即抛并由顶层 `catch` 置 `exitCode=1`；`finally` 保证收口。
- **错误与观测**：`[OK]`/`[FAIL]` 行；stderr 只回传 dsh 自身尾部 2 KB；token 捕获后不打印。
- **测试与证据**：E6 的**源码形态**证据来源；仓内已有 docs/31-§5 的追记（2026-10-19 真机通过），本附录**未复跑**，也不把它当 dist 证据（79-§8.2 E6 明确）。
- **规模与迁移**：217 行 → 目标 ≤ 240 行（新增：把 overlay 路径与形态参数化，供 dist smoke 复用判据逻辑；不复制第二份脚本逻辑）。迁移：M2 前保持源码形态；M2 后与 dist overlay 并存，两者分别执行。

#### F-dsh-bridge-test-smoke-overlay

- **路径/处置**：`packages/dsh-bridge/test/smoke/cordis.overlay.yml`；目标-保留（仅测试，源码形态）。
- **内容**：`insert` 单条目，`id: studio-next-bridge`、`name: ../../src/index.ts`、`config.instructionsEnv`。
- **非职责**：不代表分发形态；不得被部署引用。
- **依赖/状态**：纯静态 YAML；由 `bridge-smoke.ts` 以 `--patch` 指向。
- **测试与证据**：其形状由 `test/artifact.test.ts` 的文本断言间接覆盖（不引入 YAML 解析依赖）。**不证明** YAML 合法（由宿主在冒烟时证明）。
- **规模与迁移**：8 行，保持。切 dist 时**不修改本文件**（它服务源码 smoke）。

#### F-dsh-bridge-test-smoke-dist-overlay

- **路径/处置**：`packages/dsh-bridge/test/smoke/cordis.dist.overlay.yml`；目标-新增（仅测试，dist 形态）。
- **内容**：同形，`name: ../../dist/index.js`。
- **前置**：必须先 `tsc -p tsconfig.build.json` 产出 `dist`（E2）；dist 缺失时冒烟应**快速失败**并明说「未构建」，不得回落源码（79-§6.3 失败模式 1）。
- **测试与证据**：E6 的 dist 形态判据（79-§8.2 E6 的未证项）。当前**未证**：无产物、未跑。
- **规模与迁移**：8 行。迁移：M2 之后建立。

#### F-dsh-bridge-test-smoke-position

- **路径/处置**：`packages/dsh-bridge/test/smoke/position-smoke.ts`；目标-新增（仅测试/演示，**受门**）。
- **职责（目标）**：真机验证三件事——(a) 无 PRM 时 agent 创建被拦（不 spawn）；(b) PRM 声明 `prohibited` 的工具调用被拒且事件带四态；(c) `uncovered` 工具被拒（不是 allow）。标记串判据同桥：拒绝理由只出现在清单里，不出现在任务文本。
- **前置（当前不满足，四项全部未解）**：① 合法 PRM——**PRM 生成器归 78-§3.3，尚未实现**（78-§3.1 现状「无任何实现」）；② 摘要/签名——本包无验签器，生产 `apply` 无注入通道（G3/G17）；③ 引用解析通道（`generatedFrom` 十项）同样无交付路径（G3）；④ `tools.restrict`/`guard` 真实形参未探（78-§4.1 V5、§13 `P-78-16`）。因此本文件在 M6 **不可执行**；M5 只能让单元件（E1）通过。
- **非职责**：不定义验证判据（归 82 的 V5 设计）；不替代 `test/position/*` 的单元证据。
- **IO 与边界**：同桥冒烟（临时宿主、独立端口、遥测关闭、进程杀净、目录清理）；PRM 与密钥放在临时目录，不落仓。
- **测试与证据**：E6/V5，**未证**。在 82 给出判据、且 G3/G17 有结论前，本文件只登记位置与不可执行前置。
- **规模与迁移**：≤ 260 行。迁移：M6，且必须先满足 82 的探针设计、解开 G3/G17。

#### F-dsh-bridge-test-smoke-position-overlay

- **路径/处置**：`packages/dsh-bridge/test/smoke/cordis.position.overlay.yml`；目标-新增（仅测试，受门）。
- **内容**：`insert` 单条目，`id: studio-next-position`、`name: ../../dist/position/index.js`、`config.manifestEnv`（不写路径）。
- **非职责**：不是分发包内的正式补丁（那份是 `cordis.position.patch.yml`）。
- **测试与证据**：随 `position-smoke.ts` 一起生效，未证。
- **规模与迁移**：8 行。迁移：M6。

### 4.3 包配置与分发件

〔字段约定〕本节 7 个配置/分发件的「内部结构」= 声明的字段/键清单（各条以「目标字段」「内容」列出）；「导出与依赖」对配置文件与文档为 **N/A**（不导出运行时符号），其唯一消费者已在各条写明（宿主 loader、`dsh.bundle.patch`、`tsc`、`npm pack`）；「IO 与状态」按件给出；不设运行期错误面，「错误与观测」指配置错误如何被 E2/E3/E5 暴露。

#### F-dsh-bridge-pkg

- **路径/处置**：`packages/dsh-bridge/package.json`；目标-替换（字段级）。
- **归属/上位**：79-§6.2（exports 形状）、§6.5（目标口径表）、§7.1（`files` 白名单）、§7.5（`engines`）；75-§七 D3（许可待决）。
- **职责**：声明包身份、入口两态（源码态→构建态）、`dsh.bundle` 装载面与 `files` 白名单。**非职责**：不声明宿主兼容承诺（DSH 是外部 CLI，不是 npm 依赖——`DEP-DSH`）；不承载公司定义。
- **内部结构（目标字段）**：
  - `main` → `./dist/index.js`；`types` → `./dist/index.d.ts`；`exports["."] = {types, import}`；
  - `exports["./position"] = {types: "./dist/position/index.d.ts", import: "./dist/position/index.js"}`（**79-§6.5 的子路径列写的是「—」，本项需回写 79**，见 G4）；
  - `exports["./package.json"] = "./package.json"`（供产物解析器与消费者读取声明）；
  - `files: ["dist", "cordis.patch.yml", "cordis.position.patch.yml", "README.md", "LICENSE"]`。**与 79-§6.5 白名单不一致**：该表白名单只有 `dist`、`cordis.patch.yml`、`README.md`、`LICENSE`，没有 position 补丁——因为写那张表时 position 面还不存在。并入 G4 一并回写（79-§6.5 与 §7.1 第 2 类「数据文件」需增列）。
  - `dsh.bundle.patch` 保持 `./cordis.patch.yml`（**只指向桥**，见 G6）；
  - `engines.node: ">=24"`（与根一致；79-§7.5）；
  - `private: true` 保留到 D3 定案；`license` 字段等 LICENSE 文本定案后再加；
  - `peerDependencies`：按 79-§7.5 目标口径应为「对宿主精确锁」，但宿主包名未定（G15）。在定名前**不落该字段**（宁可缺声明，不可声明错包），并在 README 写明「宿主版本 `0.2.0-rc.2`，以 `DEP-DSH`/`LOCKED_VERSION` 为准」。
  - 脚本：保留 `typecheck`（`tsc --noEmit -p tsconfig.json`）与 `test`；新增 `build` 的**语义**为「`tsc -p tsconfig.build.json` + `--listFiles` 拓扑断言」，具体命令文本归实现单。
- **导出与依赖**：`dependencies`/`devDependencies` 保持**不存在**（零依赖是切 dist 的硬前提，79-§6.1 首链起点）。`peerDependencies` 见上（声明面，待 G15）。**不得**为「让 typecheck 过」而加 `@types/node` 之类的 devDependency——`types` 由根配置统一提供（79-§4）。
- **IO 与状态**：静态声明；切换是**包级原子动作**，不得让 `main` 指源码而 `exports` 指 dist（79-§6.2 规则 2）。
- **错误与观测**：无运行期行为；配置错误的后果是 `TS2307`/`ERR_MODULE_NOT_FOUND`，由 E2/E3 暴露。**失败模式 1（陈旧 dist）** 的判据不在本文件，而在构建侧的「指纹 + 陈旧检测」（79-§6.3）：`files` 写成白名单只能保证「多发的不发」，不能保证「发的不是旧的」。
- **测试与证据**：`test/artifact.test.ts` 断言 exports/patch/files 的目标形状（E1）；E4 验证消费者解析；E5 核对 `files` 实际产出。
- **规模与迁移**：20 行 → 目标 ≤ 45 行（v0.2 起：多一条 `./position` 与 `./package.json` 子路径、peer 声明位）。迁移：M2 同单完成 exports/main/types/files/patch/测试断言，缺一不可（79-§6.5 末段）。

#### F-dsh-bridge-tsconfig

- **路径/处置**：`packages/dsh-bridge/tsconfig.json`；目标-保留。
- **归属/上位**：79-§4.4（切换包的 `src` 退出根 program，但包级 typecheck 必须保留）；81-§3.3。
- **职责**：包级类型门禁配置：继承仓根（`strict` 全开、`erasableSyntaxOnly`、`verbatimModuleSyntax`、`noEmit`），覆盖 `src` 与 `test`。
- **非职责**：不发射产物（`noEmit` 继承）；不覆盖 `exclude` 冒烟脚本的既有决定。
- **目标变化**：无强制变化。可选硬化：把 `test/smoke/**` 从一个「排除」改为独立 `tsconfig.smoke.json`（**目标-暂不新增**，避免无证据的配置增殖；见 G8 的替代处置）。
- **依赖**：只 `extends` 根配置；不引 `paths`、不引 `references`（79-§6.3/§6.4）。
- **测试与证据**：`tsc --noEmit -p packages/dsh-bridge/tsconfig.json` 必须并入根 `typecheck` 的已切包清单（79-§4.4）。**本附录未运行**。
- **规模与迁移**：6 行，保持。

#### F-dsh-bridge-tsconfig-build

- **路径/处置**：`packages/dsh-bridge/tsconfig.build.json`；目标-新增。
- **归属/上位**：79-§5.2（逐键说明）、§5.4（三个陷阱）、§6.1（L0 起点）。
- **职责**：唯一发射配置：`noEmit:false`、`declaration:true`、`declarationMap:false`、`outDir:"dist"`、`rootDir:"src"`、`rewriteRelativeImportExtensions:true`、`sourceMap:false`；`include:["src/**/*.ts"]`；`exclude` 测试与 smoke。
- **非职责**：不做增量构建（不设 `composite`/`references`）；不产 `.d.ts.map`；不打包（不替代 `npm pack`）。
- **依赖与前置**：零 workspace 依赖 → 无「依赖先切 dist」的前置（这正是它排 L0 的原因）。**必须显式覆盖 `noEmit`**，否则 tsc 以 0 退出且零产物（79-§5.4 第 1 个陷阱）。
- **IO 与状态**：写 `dist/**`；幂等（同源码同产物）；陈旧检测由「构建后指纹 + `--listFiles`」承担。
- **错误与观测**：失败模式三种——零产出退出 0、`TS6059`（依赖未切）、`.d.ts` 未改写 `.ts` 说明符。判据：exit 0 **且** 文件集合符合 **且** `dist/*.d.ts` 非空 **且** `--listFiles` 不含本包外 `packages/*/src`（79-§8.2 E2）。
- **测试与证据**：E2（**未证**：配置尚未创建）。`src/host.ts`/`artifact.ts`/`position/*` 必须全部可发射（无 `const enum`、无私有名义类型，80-§12.2#1）。
- **规模与迁移**：配置件（行数不适用）。迁移：M2 第一步。

#### F-dsh-bridge-patch

- **路径/处置**：`packages/dsh-bridge/cordis.patch.yml`；目标-替换（`name` 值）。
- **归属/上位**：79-§7.2（补丁指向 dist）；78-§4.3（挂载）。
- **职责**：`dsh.bundle` 的装载补丁：单 `insert` 条目（`id: studio-next-bridge`、`name`、`config.instructionsEnv`）。
- **非职责**：不声明策略面（策略面用独立补丁，见 G6）；不写绝对路径；不写公司/岗位特定配置。
- **目标变化**：`name: ./dist/index.js`。`id` **不变**（测试与诊断前缀依赖它）。注释同步更新为「相对路径锚定本文件所在目录；切 dist 后锚定产物」。
- **依赖与状态**：静态工件；内容确定性（同仓同路径恒同 bytes）。
- **错误与观测**：YAML 形状错误由宿主在装载时报错；本包只在测试里做**文本断言**（不引 YAML 依赖 → 不是结构校验，须如实标注）。
- **测试与证据**：`test/artifact.test.ts` 的文本断言（E1）；真实装载 = E6。E6 的现有证据是**源码形态**，dist 形态未证。
- **规模与迁移**：12 行。迁移：M2 与 `package.json`/测试同单。

#### F-dsh-bridge-position-patch

- **路径/处置**：`packages/dsh-bridge/cordis.position.patch.yml`；目标-新增。
- **归属/上位**：78-§4.3（position 插件需 `--patch` 挂载）、§4.5（PRM 只读）；79-§7.2（补丁指向 dist 的同则）。
- **职责**：策略面的**分发与挂载声明**：单 `insert` 条目（`id: studio-next-position`、`name: ./dist/position/index.js`、`config.manifestEnv`）。
- **非职责**：不进入 `dsh.bundle`（`dsh.bundle.patch` 只能指一个文件；把策略面并入 bundle 会让每个 profile 自动获得会 fail-closed 的插件——G6）；不写 PRM 路径（路径是部署事实，78-§7.2）。
- **挂载方式必须写明**：78-§4.3 右列——需 `agent.yaml` 的 cmd 显式 `--patch <本文件>`，**daemon 不代改 executor 命令**。这与桥的运行时 overlay（daemon 自动生成）是两条不同的路径：桥可以「daemon 帮你挂」，position 不行。
- **依赖与状态**：静态工件；`config` 只允许 env 名与阈值类参数，**不得**出现绝对路径、密钥、公司标识。
- **错误与观测**：若被误挂在没有 PRM 的 profile 上 → 每次 agent 创建被拒（这是预期 fail-closed，不是缺陷；README 必须写明）。这是**配置错误**而非插件缺陷，诊断只能落在宿主抛出的错误里，本包无法在装载期自检。
- **测试与证据**：`test/artifact.test.ts` 断言其存在与 `name` 指向；真实装载未证（M6）。
- **规模与迁移**：≤ 14 行。迁移：M5 之后、M6 之前。

#### F-dsh-bridge-readme

- **路径/处置**：`packages/dsh-bridge/README.md`；目标-新增（79-§7.1 的 `files` 白名单要求）。
- **归属/上位**：79-§6.5/§7.1；78-§4.3；80-§12.5（未证边界）。
- **职责**：人读说明：两个入口分别是什么、三种挂载方式（bundle / 运行时 overlay / 部署生成的 overlay）、env 契约、失败默认值、证据层级、**明确的不证明项**。
- **非职责**：不写能力承诺（不得出现「已支持按岗位收紧」「已隔离网络」）；不替代 78 的损失报告；不写本机路径或许可文本。
- **内容结构（目标）**：包身份与层位；上下文桥用法（env、段名、放置位、`required` 语义）；策略面用法（PRM 来源、fail-closed、需 `--patch`、与桥的顺序要求见 78-§4.3）；构建与分发（`dist` 由 `tsc` 发射，宿主不加载 `node_modules` 下 `.ts`）；宿主兼容（已验版本 `0.2.0-rc.2`，**以 `DEP-DSH`/`LOCKED_VERSION` 为准**；`peerDependencies` 待定见 G15）；证据（源码形态与 dist 形态分开，链接到 82 的验证登记）；许可（待 D3，未定前写「许可未定，随发布决定」）。
- **必须写明的「不证明」段**（对应 80-§12.5 与 78-§4.7）：不证明策略段已生效（插件物最多到第 4 态，`BIND-POS-01` 生效需「宿主承认 + 实际拒绝过」的负向证据）；不证明同进程抗篡改（`L78-POS-01`）；不证明工具白名单等于全命令白名单（`L78-POS-02`）；不证明事件流完整（`L78-POS-03`）；不证明跨 DSH 版本稳定（`L78-POS-04`）；不证明安装/挂载/探测/激活已完成（80 的 CAP-02..05 各有自己的回执）。
- **IO/状态**：静态文档；随包发布。
- **测试与证据**：E5（`npm pack --dry-run` 清单）证明它被包含；**文档存在不证明能力**（81-§四）。README 里每一句能力陈述都必须能在 82 的验证登记里找到对应条目，否则删句。
- **规模与迁移**：≤ 150 行（v0.2 起：新增「不证明」段与宿主兼容段，原 120 上调）。迁移：M2 可先建骨架（不含能力面），M6 补齐策略面段落。

#### F-dsh-bridge-license

- **路径/处置**：`packages/dsh-bridge/LICENSE`；目标-新增，**受制作人许可决定（D3）门**。
- **归属/上位**：75-§七 D3；79-§6.5 末段（README/LICENSE 属新增交付物，许可文本与公开范围须先定，不得默认沿用根 MIT）；79-§7.1 第 4 类。
- **职责**：包级许可与第三方声明。**非职责**：不改变根仓许可；不替代 DSH 自身的 MIT 声明（它是外部 CLI，不是本包依赖）。
- **内容**：文本未定——本附录**不写**许可内容，也不假设沿用根 MIT（79 明示）。
- **状态**：在 D3 定案前，`files` 白名单里的 `LICENSE` 项与 `license` 字段**不得**先落（否则发布面缺声明）；`private: true` 在此期间保持。
- **测试与证据**：E5 清单核对；许可决定本身属政策项，不属技术验证。
- **规模与迁移**：文件（行数不适用）。迁移：随首次发布候选。

---

## 五、状态、并发与恢复（跨文件）

### 5.1 桥的注入状态

| 状态 | 触发 | 行为 | 证据面 |
|---|---|---|---|
| `unset` | env 未设/空白 | 不注册段；`required=false` 警告 | stderr（脱敏后） |
| `unreadable` | 文件读失败 | 同上，带 `detail` | 同上 |
| `empty` | 文件全空白 | 同上（注入空串无意义） | 同上 |
| `injected` | 读到非空全文 | `effect` 包裹 `section` | 段名/order/长度 |

〔结论〕四态里**只有 `injected` 改变宿主状态**；其余三态在 `required=false` 下是「无操作 + 警告」，在 `required=true` 下是「拒绝 agent 创建」。这是「上下文软段」的语义边界：不能因为注入成功就宣称模型会遵守（`L78-DSH-02`）。

### 5.2 策略面的判定与加载状态

判定顺序固定（76-§3.12）：`prohibited → reserved → permitted → uncovered(=deny)`。加载侧状态按 77-§4.8 逐段计：

| 结果 | 停在哪一态 | 可否报 drift |
|---|---|---|
| 清单未落位/不可读/超限/解析失败 | 3 之前 | 否 |
| 落位但形状/期限/宿主版本不符 | 4（已落位）→ 5 失败 | 否（未加载） |
| 落位但摘要/签名不可验或不可信 | 4 → 5 失败（`unverified`） | 否（未加载；且本地码与 77 类是近似映射，见 G10） |
| 加载成功且宿主面齐全 | 6（已加载） | 已承载段可报 |
| 段被列入 `unsupportedSegments[]` | 该段记 `not-applicable`，**不参与**第 6/11 态计数 | 否（无观测面，逐段 `REC-LOSS-01` 由消费侧记） |
| 逐项暴露与清单不一致 | 13（运行时偏离） | 可报（有观测者时） |
| 宿主缺必需面 | 不加载（拒绝） | 否（该段无观测者） |

〔结论〕本附录**不**声明任何段到达 77 第 11 态（已按计划生效）或 H0b/H1–H4：那需要「运行时暴露观测 + 逐项比对」的证据（77-§4.8/§4.9），当前不存在。**加载失败一律不发 `position/drift`**（G19）：drift 是「声明与观测不一致」，加载失败是「没有观测面」，混用会把配置错误记成漂移。

### 5.3 并发、幂等与恢复

| 主题 | 规则 |
|---|---|
| 事件串行 | 两个插件都挂 `agent/created`；桥的注释称该事件 `await serial`，**未核 dsh-agent 源码**。目标只依赖「监听器返回的 Promise 被 await」这一最小假设，并在 `position` 失败时以抛错阻断。 |
| 多 agent | 每 agent 独立解析/加载，不共享可变状态；策略对象不可变。 |
| 幂等 | `readInstructions` 与 `parseManifest` 都是纯读；同输入同输出。插件不写任何持久状态 → 无幂等键，也无「重启复活」问题。 |
| 段变更 | PRM 换段必须换清单（78-§3.3 G4）；插件不缓存跨 agent 清单，因此不会把旧段用到新段。 |
| 崩溃 | 插件无持久状态；崩溃后由宿主重启。未 flush 的事件属证据缺口（`L78-POS-03`），不得补写。 |
| 恢复 | 不在本包内做恢复；重试与接管归 daemon/启动器（78-§3.4 双重校验的启动器侧）。 |
| 指令文件生命周期 | daemon 在收割后删除；若此时仍有 subagent 创建 → `unreadable`。`required=false` 下只警告（可接受），`required=true` 会阻断该 subagent（须在部署口径中说明，不得当作缺陷静默处理）。 |

### 5.4 秘密与日志边界

- PRM 内**不含**秘密（78-§3.2.3 规则 5：只允许 `secretCategories[]` 与 `keyLogicalRef`）；**不出现路径、env 名、密钥前缀**——「逻辑引用」不是「路径引用」，本包不得把 `keyLogicalRef` 解析成文件位置。
- **插件不读任何秘密**：不 `load`、不读 env 秘密、不读 `.env`、不读密钥文件。依据是 80-§11.2.1 的 `SecretUse` 六值（`outbound-redaction`/`gateway-auth`/`sandbox-inject`/`local-tool`/`broker-lease`/`test-fixture`）里**没有「验签/校验」用途**；对应地 `secretId` 命名空间（`SEC-<域>-<slug>`）里也**没有 `SEC-DSH-*`**。因此 G17 不是「忘了接线」，而是「接线的槽位不存在」——不得为了先跑起来而自造用途值或 `SEC-DSH-*` 类目。
- `SEC-GW-SIGNING`（`kind:'hmac'`，78-§7.4.1）**不得下发给 worker 或本插件**：它只服务网关出站签名；把它当「PRM 验签材料」是类别错误（用途不同、主体不同）。
- 诊断只允许：状态码、文件基名、字节长度、段名、工具名、四态、`reason`、键路径。**禁止**：清单原文、指令原文、调用参数原文、完整绝对路径、密钥哈希或前缀（80-§5.8）。
- 事件载荷只带摘要（`argsDigest`），不带参数原文；`manifestRef.digest` 用**完整摘要**，不做 `sha8` 之类展示截断（截断只允许出现在人读面板，不进入事件与台账）。
- stdout 永不写（headless `--json` 的 NDJSON 通道）。

### 5.5 不可写面（只读承诺的落位）

78-§4.5 列了六个「改一处即全盘失效」的对象。本附录只对**与本包文件直接相关**的四行给落位；hooks 配置与台账库文件分别归 81-files/17 与 81-files/03，不在此重复：

| 对象 | 必须只读 | 本附录的落点与处置 | 现状 |
|---|---|---|---|
| PRM 文件 | agent 不可写 | `cordis.position.patch.yml` 只给 env 名、不写路径；插件以只读方式读（`readFile`，从不写回）；路径是**部署事实**（78-§7.2 硬规则 2） | 目标（生成器未实现） |
| profile / overlay / `agent.yaml` | agent 不可写 | 包内两个补丁是**静态工件**；运行时 overlay 由 daemon 生成到 `<rootDir>/tmp/dsh-bridge-overlay.yml`（0600/0700）。**worker 沙箱根是否覆盖 `<rootDir>/tmp/` 未证** → G13 | 目标 |
| 插件自身与其依赖 | agent 不可写 + 摘要校验 | 本包的贡献是「确定性产物」：`files` 白名单 + `npm pack` 清单（E5）。**装载期摘要与许可核验不在包内做**——78-§4.1 供给行把它放在安装/挂载侧（79-§8.3 口径） | 目标 |
| 指令临时文件 | 0600、workspace 外、用后删 | daemon 写、桥读、收割后删（`instructions-store.ts`）。**不可写 ≠ 不可读**：读域收口在本 OS 不可表达（`L78-WS-01`） | **已有**（权限位已落，隔离强度未证） |

〔结论〕第三行是最容易被写成越级承诺的一条：把 `files` 干净、产物确定说成「插件能自证完整」是假的。插件最多能在**调用方传入 `digestOf`** 时比对读到的字节；没有传入就只能报 `manifest-verifier-unavailable` 并拒绝（fail-closed，不是「未验签但放行」）。凡 README 出现「插件自校验」即判负。

〔结论〕第一、二行合起来是一条因果链：PRM 只读 + overlay 不可写 ⇒ 策略不可被 agent 改；缺任一条，`L78-POS-01`（同进程可篡改）就从「已知损失」变成「可被利用的缺口」。因此 G13 不是卫生问题，而是这条链的**未证环节**。

---

## 六、构建、依赖与分发

### 6.1 双轨与切换顺序

〔结论〕沿用 79-§6.1 的首条可证链，`dsh-bridge` 是 **L0 起点**（零 workspace 依赖）。切换是包级原子动作，需同单完成六项：

1. 新增 `tsconfig.build.json` 并发射（E2，含 `--listFiles` 拓扑断言）；
2. `package.json` 的 `main`/`types`/`exports` 指 dist，补 `files`；
3. `cordis.patch.yml` 的 `name` 改 `./dist/index.js`；
4. `test/bridge.test.ts` 迁出的形状断言的**目标值**改为 dist；
5. 根 `typecheck` 的已切包清单加入本包（`tsc --noEmit -p packages/dsh-bridge/tsconfig.json`）；
6. 根 `tsconfig.json` 把本包从 `include` 移出（归 81-files/19；未移出即「双类型身份」，79-§4.4 禁止）。

〔结论〕顺序不可省：**build → typecheck → 测试**。切 dist 后未构建时，根 `tsc` 读 `exports.types` 会 `TS2307`，`vitest` 解析包名会失败（79-§6.1 末）。不得用 `paths` 把运行期解析引回 `src`（79-§6.3 失败模式 3），不得引入 project references（79-§6.4）。

### 6.2 依赖与版本

| 项 | 口径 |
|---|---|
| workspace 依赖 | 零（保持） |
| 第三方运行时依赖 | 零（保持） |
| Node 内建 | `fs/promises`、`path`、`url`、`crypto`、`process` |
| Node 版本声明 | `engines.node: ">=24"`（与根一致，79-§7.5） |
| DSH 宿主 | 外部 CLI，版本 `0.2.0-rc.2`（`DEP-DSH`）；**不是**本包的运行期 import |
| 宿主版本声明 | 79-§7.5 的目标口径是「对宿主用 `peerDependencies` + 精确锁」。**本附录 v0.1 写成「不设 `peerDependencies`」是错的**，v0.2 修正：应按 79-§7.5 声明精确锁；但**宿主 npm 包名未在 75–80 任一处写明**（`@deepseek-ai/dsh` 只在 79-§10 的证据链接里作为 registry 地址出现，不等于插件应声明的 peer 名）→ G15 |
| 插件 API 兼容 | rc 期可变；升级即新绑定版本（`BIND-DSH-01` 版本随宿主钉住，`L78-DSH-07`） |

〔结论〕本包不新增任何 `DEP-*`。若未来 position 侧需要 SemVer 区间求值或规范化 JSON，必须先走 79 的依赖/边决策，不得在包内自建第二套语义（见 G3）。

〔结论〕`peerDependencies` 在本包是**声明面**而非解析面：插件不 `import` 宿主包（宿主经 `ctx` 注入能力），所以加 peer 不会产生运行时解析，也不会破坏零依赖。正因为它是纯声明，缺少确切包名就成了**阻塞项**（G15），而不是可以随手填个名字的细节——填错等于向消费者承诺一个不存在的宿主。

### 6.3 分发形态的硬约束

- 对外只发 JS + `.d.ts`（75-D75-07）；`src/` 默认不发（79-§7.1）。
- 补丁文件与 README 随包发；`LICENSE` 待 D3。
- `exports` 不加通配 `./*`（79-§6.2 第 4 条）；`./position` 是**显式**子路径。
- 消费者（DSH 宿主）按 `exports.import` 装载；daemon 只用产物解析器拿说明符，不推导目录。
- `declarationMap: false`（79-§5.2）⇒ 不产 `.map`/`.d.ts.map`，因此 79-§7.4 第 3 项（map `sources` 不得是绝对路径）在本包**不适用**；若将来开启，必须同单加 `src/` 到 `files` 并重跑该扫描。
- 锁文件三分法（79-§7.5）：`npm-shrinkwrap.json` 存在即随包发布 → 本包**不引入**；`package-lock.json`/`pnpm-lock.yaml`/`yarn.lock`/`bun.lockb` 不进包；仓内 `bun.lock` 靠 `files` 白名单排除（不能指望 npm 默认排除表）。

### 6.4 发布前四项扫描（79-§7.4）

缺任一项不得发布；本附录**未执行**，只登记口径与被扫对象：

| # | 扫描 | 本包的对象 | 判据 |
|---|---|---|---|
| 1 | 秘密 | `README.md`、两个补丁 YAML、`dist/*.d.ts` 注释 | 过 `redactOutbound` 形状规则；替换串 `<redacted:N>`（模块现 `packages/core/src/secrets.ts`，迁移后从 `contract` 公共面取用——跨包引用是扫描脚本的事，不是本包的事） |
| 2 | 本机路径 | 同上 + 产物 | 不得出现 `<home>/…`、`<mount>/…`、盘符、内网 IP、主机名（75-D75-13；示例一律写逻辑占位，不写真实路径）。**现状仍有一处写死本机路径**：`bridge-smoke.ts` 的默认 `DSH_BIN`（G8）——它不进包（`test/` 不在 `files`），但仍在仓内；目标改为 `<dsh-binary>` 占位 + 必须由 env/部署给值 |
| 3 | map sources | `dist/**/*.map` | 本包不开 map ⇒ 跳过 |
| 4 | 锁文件 | 包根 | 见 §6.3 三分法 |

〔结论〕第 2 项对本包有特殊意义：诊断里打印的 `source` 就是本机绝对路径（`index.ts:183-184`、`:166-168`）。它不进产物，但会进**运行日志**；日志会不会出仓由 daemon 的收口决定（归 81-files/16），本包只负责不打。这是「包内脱敏」与「出站脱敏」两层，不能只做一层。

### 6.5 安装 / 挂载 / 加载 / 探测 / 资格 / 授权 / 生效：七段不可合并

〔结论〕80 的 `TS-PORT-CAP-02`（安装）、`TS-PORT-CAP-03`（挂载）、`TS-PORT-CAP-04`（探测）、`TS-PORT-CAP-05`（能力激活）与 77 的加载（第 6 态）、资格认定（第 8 态）、授权行使（第 10 态）、生效（第 11 态）各自独立（逐条列出端口号，不写范围通配）。本表把「加载」单列为第 3 段，`CAP-05` 的激活回执落在第 7 段。本包的 `dist` 切换只落在第 1 段，其余六段各有自己的回执与观测面：

| # | 段 | 定义与锚点 | 本包提供的证据 | 本包**不能**提供 |
|---|---|---|---|---|
| 1 | 安装 | 包存在于目标环境（`TS-PORT-CAP-02`） | 可被 `npm pack` 的确定性包（E5） | 安装回执 |
| 2 | 挂载 | 进入宿主可见范围（`TS-PORT-CAP-03`） | 两个补丁文件 + `files` 白名单 | 挂载回执；宿主可见性 |
| 3 | 加载 | 宿主承认并初始化该能力（77-§4.8 第 6 态） | 无（E6 的 dist 形态未跑） | 加载证据 |
| 4 | 探测 | 挂载后宿主是否真的看见并加载（`TS-PORT-CAP-04`；77-§4.8 第 7 态） | 无（`dsh-bridge` 无探针，80-§6.5 锚点原文） | `ProbeReport` |
| 5 | 资格 | `TS-PORT-WORK-08` → `REC-WORK-08` 的独立认定（77-§4.8 第 8 态） | 无 | 资格认定 |
| 6 | 授权 | `REC-AUTH-02` 行使（77-§4.8 第 10 态）；端点/权威激活归 `TS-PORT-AUTH-03` → `REC-AUTH-07` | 无 | 授权记录；权威激活回执 |
| 7 | 生效 | `TS-PORT-CAP-05` 的能力激活回执 + 77-§4.8 第 11 态「按计划生效」+ 运行时暴露逐项比对 | 无 | 生效证据 |

〔结论〕第 6、7 段内部还要再分：**权威激活**（`TS-PORT-AUTH-03`，回答「谁有权让某端点代表公司」）≠ **能力激活**（`TS-PORT-CAP-05`，回答「这版能力何时开始被使用」）≠ **第 11 态观测**（宿主暴露逐项与清单一致）。三者互不代证，也别拿「换了个包」冒充其中任何一项。

〔结论〕PRM 只在第 3–4 段（加载/探测）参与，且只作**绑定投影**，不是权源：清单合法 ≠ 授权成立（`L78-PRM-01`），清单被加载 ≠ 已生效（第 6 态不是第 11 态）。第 5–7 段（资格/授权/生效）的判定不由 PRM 作出——把清单当权源，就是把声明当授权。PTC 侧同理：`ptc.mode` 默认 `forbidden`（78-§3.2.4），清单里写 `allowed` 本身不构成边界证明——`osExecutionBoundary`/`networkBoundary` 要有实测拒绝为证。

〔结论〕三条「切换」必须分开说，不得互借证据：

| 说法 | 实际含义 | 本包的位置 |
|---|---|---|
| 包安装 / 换版 | 换产物（`TS-PORT-CAP-02`）；不改变 agent 行为，除非随后挂载并被加载 | 只提供确定性产物（E5） |
| 源码 HMR | DSH profile 指向源码时的热替换 | **不用**：分发形态以 `dist` 为准；源码形态只是仓内开发态（79-§4.4） |
| agent loop 切换 | 换执行体或换会话（77 段边界） | **不触发**：由 daemon/部署决定，本包无此能力 |

〔结论〕H 级不预认：本包现状与目标都**不声明**任何段达到 H0b 及以上。H0a 只表示「已安装/已落位，且明确记录宿主未承认」；H0b（宿主已挂载并承认）与 H1–H4 需要本附录没有的证据。同理，「切了 dist」既不是「已挂载」，也不是「已加载」。79-§8.1 的 E2/E3/E5 都停在「包是对的」；E6 才碰宿主，而 E6 的 dist 形态**未跑**。本附录不把 M2 的完成写成可发布。

---

## 七、测试矩阵与证据

| 测试件 | 覆盖 | 层级 | 证明 | **不证明** |
|---|---|---|---|---|
| `test/bridge.test.ts` | 四态、config 归一、接线、required 两档、脱敏 | E1 | 桥的纯逻辑与接线符合契约 | 宿主真注册、串行、dist 形态 |
| `test/artifact.test.ts` | 产物声明解析、拒绝规则、补丁形状（含 position 补丁入 `files`） | E1 | 声明可解析且拒收明确 | Node/TS 真解析（E3/E4）、宿主装载 |
| `test/position/manifest.test.ts` | 段级必填（八段 + `persona` 可选）、`unsupportedSegments[]`、头部与 `generatedFrom` 十项、硬规则、期限、宿主**逐字**匹配、引用可解析、摘要/签名、本地码映射表 | E1 | 准入判定符合 78-§3.2 | 真实 JCS、真实 PRM、岗位族规则（G14，不可判）、验签材料（G17）、宿主行为 |
| `test/position/policy.test.ts` | 四态真值表（含 `reason`）、顺序、子 agent 衰减（**不产子 PTC**，G16）、审批收紧与 `approvers[]` | E1 | 判定与编译符合 76-§3.12/78-§4.4 | 工具真的被收紧 |
| `test/position/plugin.test.ts` | 成功/失败矩阵（含 `presentation`/`checkpoint` 两面）、**无 deps 的 `apply` 必须拒绝**、零副作用、证据缺口、**加载失败不发 drift** | E1 | fail-closed 的接线面 | 真实宿主形参、抗绕过、agent 真被拦 |
| `test/smoke/bridge-smoke.ts` | 真机端到端（源码形态） | E6 | 该版本 DSH 下注入被遵循（有历史记录） | dist 形态、其他版本、策略面 |
| `test/smoke/position-smoke.ts` | 真机端到端（策略面） | E6/V5 | — | **当前不可执行**（无 PRM 生成器、无验签交付通道 G3/G17、宿主面未探） |

证据层级口径（79-§8.1）：E1 全绿 + E2 成功 ≠ 可发布；E5 清单干净 ≠ 装载成功。本附录**未执行**任何一类。

R/E/W/V 映射：R27（清单外事项）与 R6（出工中换能力）落在 `policy` 的判定面与「换段换清单」规则上；其**记录面**归 77/daemon，不在本包。E/W 的归属规则见 76-§9.1/§9.4：每个 E/W 由**恰好一个绑定档案**声明并承载。与本插件语义相邻的候选是 `E03`（换能力避重认）、`E04`（能力退化降标）、`E10`（进化自扩权）、`W04`（未分类按低档）、`W06`（静默恢复）、`W10`（只报有利证据），但 **78-§4.1 的 `BIND-POS-01` 档案卡未声明任何 E/W**，故本附录不声称已覆盖；在 78 补齐声明前，任何「W04 已由 uncovered→deny 覆盖」的说法都不成立（见 G12）。`BIND-DSH-01`（上下文桥）同样未声明 E/W，故桥侧也不承载任何 E/W 用例。V 层：V1（结构）+ V2（行为）为现有；V3（跨实现）/V4（故障与安全）/V5（真机）/V6（自治）均为**未证**。

〔结论〕脱敏与最小暴露是**两件不同的事**，都只有单测证据：`bridge.test.ts` 的 stderr 脱敏用例证明「本包不主动打印绝对路径」，不证明宿主/daemon 不打印；`manifest`/`events` 的「只记摘要」用例证明本包不写参数原文，不证明接收方不落原文。两者都归 V4，当前**未证**。

---

## 八、规模预算与迁移顺序

### 8.1 规模预算

| 目录 | 目标直属文件数 | 上限 |
|---|---|---|
| `src/` | 3（index、host、artifact） | 25 |
| `src/position/` | 4 | 25 |
| `test/` | 2 | 25 |
| `test/position/` | 3 | 25 |
| `test/smoke/` | 5 | 25 |

| 文件 | 目标行预算 | 现状 |
|---|---|---|
| `src/index.ts` | ≤ 200 | 212 |
| `src/host.ts` | ≤ 140（v0.2：多 `PresentationFace`/`CheckpointFace` 两面与强度注释） | — |
| `src/artifact.ts` | ≤ 150 | — |
| `src/position/index.ts` | ≤ 280（v0.2：九职责落点表 + 两面接线） | — |
| `src/position/manifest.ts` | ≤ 440（v0.3：段级必填 + `unsupportedSegments` + 本地码映射表 + 宿主逐字比对） | — |
| `src/position/policy.ts` | ≤ 220（v0.3：`reason`/`conflicts`/`approvers`/`tightened`） | — |
| `src/position/events.ts` | ≤ 120 | — |
| `test/bridge.test.ts` | ≤ 320 | 321 |
| `package.json` | ≤ 45 | 20 |
| `README.md` | ≤ 150 | — |
| 其余测试 | 见各条目 | — |

〔结论〕上调只发生在**新增职责**上（PTC 面、检查点面、头部与段级校验、`unsupportedSegments`、本地码映射表、引用校验），不是为容纳实现膨胀；`src/` 七个文件合计 ≤ 200+140+150+280+440+220+120 = **1550 行**，单件全在 600 以内，不触发拆分义务。

〔结论〕本包**不在** `lineBaseline` 中（无超限件，`boundary-rules.mjs:159-182` 未列本包），因此不触发「拆后路径 + facade + 迁移顺序」的清偿义务。唯一需要拆分的是 `manifest.ts` 若逼近 600 行时的预案（见该条目），且拆分新增文件不得新增域平面散件。

### 8.2 迁移顺序

| 波次 | 内容 | 前置 | 回退 |
|---|---|---|---|
| **M1** | `host.ts` + `artifact.ts` + `test/artifact.test.ts`（源码形态，零行为变化） | 无 | 删三件；`index.ts` 回到内联类型 |
| **M2** | dist 切换六项（§6.1）一次性同单；随后 E2→E3→E5→（可选 E4）→E6(dist) | M1 | 整单回退（exports/patch/测试/根清单同时回） |
| **M3** | daemon 由 `BRIDGE_SRC_REL` 改为消费产物解析结果 | M2；G5 的接缝决定 | 回退到路径推导（保留旧路径作为兼容期） |
| **M4** | `position/manifest.ts` + `policy.ts` + `events.ts` + 三个单测（纯逻辑，不接宿主） | 无（可与 M1/M2 并行） | 删文件；无外部影响 |
| **M5** | `position/index.ts` + `cordis.position.patch.yml` + `test/position/plugin.test.ts`（伪宿主）。**只落码、不激活**：生产 `apply` 无注入通道，装上即一律拒绝 | M4；宿主面探针（78-§13 `P-78-16`）给出形参 | 卸载 patch；岗位降级（78-§4.1 退出） |
| **M6** | `position-smoke.ts` + 两个 overlay + README 能力面 + 证据登记。**被 G3/G17 阻断**：无摘要规范化实现、无验签材料/算法/通道，本波次不可执行 | M5；82 的 V5 判据；PRM 生成器（78-§3.3）；G3 与 G17 有结论 | 撤回冒烟与 README 段落；保留单测 |

〔结论〕M2 之前的任何提交都不得改 patch 的 `name`；M2 之后不得让 `src` 与 `dist` 同时作为 `exports` 目标。M5 不得早于宿主面探针，否则「按清单收紧」只是纸面声明；M5 完成 ≠ 策略生效——它只证明「失败时零副作用」，成功路径在生产里走不通。

---

## 九、缺口与需回写（本附录不自行补洞）

| # | 缺口 | 影响 | 应回写 |
|---|---|---|---|
| **G1** | position 插件的**包归属**未被 78/80 指定：78-§4.1「供给=框架发布」只说发布，80-§2.4 又说「零新包」「dsh-bridge 实现不动」 | 本附录按「同一包内第二入口」设计（唯一零新包路径），但这改变了 dsh-bridge 的公开面 | 80-§2.1/§2.4 明确 position 入口的归属；若改为独立包则必须走提案流（新增层位与边） |
| **G2** | 78-§4.3 要求「先校验清单、再注入上下文」，但未给**排序机制**；两个插件共用 `agent/created`，宿主不保证监听器顺序 | 存在「模型被告知规则、工具未收紧」的窗口 | 78-§4.3 增补机制（同一入口内组合 / 服务依赖 `inject` / 明示的装载顺序）并配负向探针；在定案前本附录只保证「同一 overlay 内 position 条目在前」这一**配置顺序**，不声称执行顺序 |
| **G3** | 78-§3.4 的「插件侧再校验一次」含摘要重算，但 PRM 摘要按 `studio-next/jcs@1`（76-§1.5.1），本包零依赖且无出边，无法复用规范化实现 | 若在包内自实现 = 第二事实源；若不实现 = 双重校验缩水 | 78-§3.4 明确插件侧校验范围（建议：启动器算摘要、插件验签 + 验期 + 验引用），并为缩水部分登记 `lossId`；或由 80 决定注入规范化函数的方式 |
| **G4** | 79-§6.5 的 dsh-bridge 行有两处与目标不符：子路径列是「—」（目标需 `exports["./position"]`）；`files` 白名单只有 `dist`/`cordis.patch.yml`/`README.md`/`LICENSE`（目标还需 `cordis.position.patch.yml`） | 产物解析器无法从 `exports` 取策略入口；position 补丁会被 `files` 挡在包外 | 79-§6.5 增补子路径行与 position 补丁，并同步 §6.2 的子路径完整枚举、§7.1 第 2 类「数据文件」 |
| **G5** | 79-§7.2 要求 daemon 消费本包解析器的结果，但 `allowedPackageEdges` 无 `daemon→dsh-bridge` 边 | 解析器无法被 daemon import | 80-§12.1/79-§7.2 明确传递方式（新增边走提案 / 子进程调用 / 部署配置注入解析结果）；本附录只保证解析器零副作用、可被任一方式调用 |
| **G6** | `dsh.bundle.patch` 只能指一个文件；position 不能进 bundle（会让所有 profile 获得 fail-closed 插件） | 策略面的挂载发现没有声明字段 | 78-§4.3 与 79-§7.2 明确「position 补丁由部署显式引用」；本附录不新增 `dsh.*` 键 |
| **G7** | 78-§4.1 V5、§13 `P-78-16`：`tools.restrict`/`guard`/`sandbox`/`approval`/`presentation`（`dsh-agent-tool-presentation`）/`checkpoint`（`session-checkpoint-policy`）/事件总线的真实形参与默认值**未探** | `host.ts` 的投影与 `position/index.ts` 的调用点都建立在未证形状上；`presentation`/`checkpoint` 两面尤其未测 | 82 的 V5 探针；探针结果回来前，`position/*` 全部标「未证」 |
| **G8** | 仓库内存在的本机路径/弱证据：`bridge-smoke.ts:31` 默认 `<dsh-binary>`（当前源码写死本机绝对路径）；诊断输出完整 `source` 绝对路径（违反 80-§5.8）；YAML 靠文本断言 | 与 75-D75-13/80-§5.8 冲突；补丁形状无结构校验 | 81-files/19 或 82 的漂移登记；本附录已在目标条目里给出脱敏与「快速失败不回落」的处置，但不改现状 |
| **G9** | `private: true` + 无 `license`/`files` 与 79-§6.5「可分发」口径不一致 | 切换后仍不可发布 | 75-§七 D3 的许可与公开范围决定；定案前 README 只写「许可未定」 |
| **G10** | 77-§11.1 的 14 类失败**没有「完整性校验失败」类**；摘要/签名不符只能近似映射——本次取 `unverified`（+`EVOLVE_REJECT`），但 `unverified` 在 77-§11.1 要求附「对账入口与期限」且重试语义是「视对账结果」，而清单摘要不符**没有可对账的对象**；映射到 `rejected_version`（预期版本不符）同样失真（`manifestRef.version` 本身没变） | 拒绝原因在台账里会被误读为「结果待核」或「版本不符」，两种读法都指向错误的处置（去对账 / 重读版本） | 77-§11.1 增补「完整性/签名校验失败」类，或给出一条权威映射表；本包只发本地错误码，映射归 daemon；在定案前台账里出现 `unverified` 时**不得**理解为「可对账恢复」 |
| **G11** | 79-§8.2 E6 写「`required:false` 的降级路径只允许出现在显式配置里，默认行为必须可解释」，而桥的**默认值就是 `false`** | 默认降级是否合规存在两种读法 | 78-§4.3 或 82 明确：上下文软段默认降级是否可接受；否则需由 PRM/部署显式设置 |
| **G12** | 78-§4.1 的 `BIND-POS-01` 档案卡未声明 E/W 用例集（76-§9.1：每个 E/W 必须由恰好一个绑定档案承载） | `E03`/`E04`/`E10`/`W04`/`W06`/`W10` 与本插件语义直接相邻，却无归属；本附录无法据此写验收 | 78 在 `BIND-POS-01` 补声明并给出用例正文；82 再登记证据 |
| **G13** | 78-§4.5 第 2 行「本卷最需要探针的一条」在本包落成具体问题：daemon 把 bridge overlay 写到 `<rootDir>/tmp/dsh-bridge-overlay.yml`，而 `<rootDir>` 与 worker `cwd`/沙箱根的关系**未证** | 若 worker 沙箱根覆盖 `tmp/`，agent 可改写自己的上下文段落（不直接改策略，但可伪造「规则已被批准」的文本）；这是 `L78-POS-01` 从「已知损失」变成「可被利用缺口」的一个入口 | 82 增加一条探针：以 worker 身份对 `<rootDir>/tmp/` 做写测试，并把结果写进 78-§4.5 的「现状」列；在探针回来前，本附录不声称 overlay 只读 |
| **G14** | 78-§3.2.4「复核/验收、审计/巡检、协调/管理岗的 `ptc.mode` 固定 `forbidden`，PRM 不得覆盖」**在插件侧不可执行**：PRM 的 `identity` 段没有岗位族字段，族只在公司定义里，本包零出边查不到 | 该硬规则实际只由生成器/启动器执行；若生成器漏检，插件无法补 | 78 明确该规则的执行位置（建议：生成器拒绝 + 启动器复核），并为「插件侧查不到族」登记一条 `L78-PRM-*` 级的损失；本附录**不新增** `family` 字段 |
| **G15** | 79-§7.5 要求「对宿主用 `peerDependencies` + 精确锁」，但 75–80 任一处都**没写宿主 npm 包名**（`@deepseek-ai/dsh` 只是 registry 证据地址） | 不声明 = 与 79 目标口径不符；声明错包 = 向消费者承诺不存在的宿主（比不声明更坏） | 79-§7.5 或 78-§2.5 给出确切包名与是否真的需要 peer；定名前本包不落该字段，README 只写 `DEP-DSH`/`LOCKED_VERSION` |
| **G16** | 78-§4.4 要求「子 agent 的 PTC 不得宽于父、父 `allowed` 时子须**显式重列**」，但 78-§3.2.2 的 `tools.subagent` 段只有 `allowedPresets[]`/`maxDepth`/`toolFilter[]`，**没有 PTC 子字段** | 每条子授权在结构上都「没有重列」，两种读法相反：一律 `forbidden`（最严，可能把合法子任务全砍）或一律继承（最宽，违反「不宽于父」）。本附录取最严并明说，不静默继承 | 78-§3.2.2 给 `tools.subagent` 增补 PTC 字段（或在 §4.4 撤回「显式重列」要求）；定案前本包不产出子 PTC，`deriveSubagentPolicy` 不返回该字段 |
| **G17** | 插件侧验签**缺三样**：① `signature.algorithm` 78 未固定取值（只要求「`signerRef`/`algorithm`/`keyLogicalRef`/`signedAt` 四键在」）；② 验签材料从哪来未定——80-§11.2.1 的 `SecretUse` 六值（`outbound-redaction`/`gateway-auth`/`sandbox-inject`/`local-tool`/`broker-lease`/`test-fixture`）**没有「验签/校验」用途**，也就没有可用的 `load(entry, use)` 调用点；③ `apply(ctx, config)` 的 config 来自 overlay 的 YAML 数据，**没有函数注入通道**，注入式 `digestOf`/`verifySignature` 只能在测试里存在 | 生产形态下插件拿不到验签能力 → 一律 `manifest-verifier-unavailable` → agent 创建永远被拒。这不是「实现没写」，而是**通道不存在**：G3（摘要规范化）+ 本条合起来是 position 生产激活的阻断项 | 78-§3.2.1 固定 `algorithm` 取值；80-§11.2.1 增补校验用途的 `SecretUse` 与 `SEC-DSH-*` 类目，或明确「验签由启动器完成、插件只验期与引用并登记对应 `lossId`」；通道定案前 M6 不可执行 |
| **G18** | 78-§4.1 的档案卡证据行写 `position/deny`（单数），78-§4.6 的事件表写 `position/denied`；事件名即契约，82 按名写测试 | 按错名写测试会造成「测试通过但事件从未发出」的假绿；两种写法同时存在时无法判断哪个是权威 | 78 统一一处（建议以 §4.6 表为准并在 §4.1 更正）；统一前本附录按 `position/denied` 落码并在载荷类型处标注 |
| **G19** | 78-§3.4 同时写「仅插件侧失败而启动器侧通过 → 记 `position/drift`」与「第 13 态只在插件确实加载过、且只对该插件承载的段成立」——加载失败正是**没有加载过**的情形，两句对同一次失败给出相反处置 | drift 是「声明与观测不一致」，加载失败是「没有观测面」；混用会把配置错误记成漂移，污染 `L78-POS-03` 之外的证据链 | 78-§3.4 增补一句判定顺序（加载失败 → 停在第 4 态并记本地码；drift 只对已加载段）；定案前本附录取「加载失败不发 drift」并在 §1.4/§5.2 明写 |

---

## 十、未证清单

| # | 未证项 | 现状 | 需要的证据 |
|---|---|---|---|
| U12-01 | dist 形态可被 DSH 装载 | 无 `dist`、无构建配置 | E2 + E6（dist overlay） |
| U12-02 | `exports`/`types` 在独立消费者中可解析 | 未打包 | E4（临时安装 + `tsc`/`node` 双跑） |
| U12-03 | `npm pack` 清单符合白名单 | 无 `files` | E5（`npm pack --dry-run --json`） |
| U12-04 | 两个插件在 `agent/created` 的执行顺序可控 | 无机制（G2） | 宿主探针 + 负向用例（只开 bridge 时策略缺失可观测） |
| U12-05 | `tools.restrict`/`guard`/`sandbox`/`approval`/`presentation`/`checkpoint` 的真实形参与语义 | 未探（G7） | 78-§13 `P-78-16` 等探针 |
| U12-06 | 插件侧摘要/验签能否与启动器一致 | 无规范化实现（G3） | 注入式 `digestOf` 的对拍向量 |
| U12-07 | `uncovered` 在真实宿主上确实被拒 | 只有单测 | 真机负向：未声明工具调用被拒 |
| U12-08 | 子 agent 的衰减在真实宿主生效 | 只有单测 | 真机：越界 preset/工具被拒 |
| U12-09 | 同进程代码能否篡改判定 | 78 已登记 `L78-POS-01` | 负向探针（不指望能防，只求如实登记） |
| U12-10 | 事件能否完整落到外部 sink | 无总线证据 | 真机事件 + daemon 收割对照 |
| U12-11 | 跨 DSH 版本兼容 | rc 期 API 可变 | 每个宿主版本重跑 E6 + 新绑定版本 |
| U12-12 | `<rootDir>/tmp/` 对 worker 是否可写 | 只有 0600/0700 权限位，沙箱根关系未证（G13） | 以 worker 身份写测试，结果写进 78-§4.5 |
| U12-13 | 岗位族固定 `ptc.mode=forbidden` 是否被执行 | 插件侧不可判（G14）；生成器不存在 | 生成器落地后核其拒收；启动器复核 |
| U12-14 | 宿主 `peerDependencies` 声明是否成立 | 包名未定（G15），字段未落 | 定名后 E4/E5 + 与 `LOCKED_VERSION` 对拍 |
| U12-15 | `dist` 产物与源码行为一致 | 无 `dist`，无对拍 | E2 后同输入双跑（源码 smoke vs dist smoke）的差分 |
| U12-16 | PRM 文件字节是否符合 `studio-next/jcs@1`，摘要能否与生成器对拍 | 该规范状态 `vectors-published`，**无实现跑过**，跨实现未证（76-§1.5.1、U80-01；G3） | 生成器实现后：同一 PRM 双方各算一次摘要并逐字节比对 |
| U12-17 | 插件侧验签在生产形态能否取得算法与材料 | 三样全缺（G17）：`algorithm` 未固定、`SecretUse` 无校验用途、`apply` 无函数注入通道 | 78/80 定案 + 一条真机负向（篡改签名的 PRM 必须被拒） |
| U12-18 | `position/deny` 与 `position/denied` 哪个是权威事件名 | 78-§4.1 与 §4.6 不一致（G18） | 78 统一后按 82 的测试名核对；统一前不得声称事件已覆盖 |
| U12-19 | 加载失败到底该不该记 `position/drift` | 78-§3.4 两句相反（G19） | 78 增补判定顺序；在定案前本附录取「不发 drift」，此取法本身未获上位确认 |
| U12-20 | 子 agent 的 PTC 衰减在真实宿主能否执行 | `tools.subagent` 无 PTC 字段（G16），本包只能一律 `forbidden` | 78 补字段后真机验证「父 `allowed` + 子合规重列」能通过、越界被拒 |
| U12-21 | 目标件 `src/position/*`、`src/host.ts`、`src/artifact.ts` 是否存在 | 全部**未创建**（本附录只写契约） | 实现单落地后按 §七 的 E1 用例逐件验收 |

〔结论〕本附录的完成只表示「文件级技术细节可呈审」，**不表示** `packages/dsh-bridge` 的目标能力已验证，也不表示任何目标件已实施。

---

## 十一、统一接口对齐（12 项）

口径：76/77/78/79/80 的最新定稿接口在本包**要么被引用、要么明确不适用并给理由**；本附录不自设公共接口（80-§12.3），冲突以最新卷为准并在 §九 回写。下表逐条回答，不适用项也写明理由而不是沉默。

| # | 接口 | 适用性 | 落点与处置 |
|---|---|---|---|
| 1 | `RuleEvaluator`（`typecheck`→`evaluate`，`Result<RuleOutcome>`，`refused` 留在 `Ok`，四值不合并） | **不适用** | 本包没有 `RuleProfile`/`RuleOutcome`。`policy.ts` 的 `decideToolCall` 是 76-§3.12 的四态判定，不是规则求值：不包 `Result`、不把 `prohibited`/`reserved`/`permitted`/`uncovered` 塞进 `RuleOutcome` 的取值域、不借用 `refused` 语义；也不得为对齐把 `state` 折成布尔。判定的处置由调用方按 `kind` 执行（`deny` 抛错阻断、`ask` 交宿主审批）。 |
| 2 | `ClassifiedError`（`{failure, category, subcause, detail?}`；处置读 `failure`，`category` 只喂事件/告警） | **适用（字符串层）** | 插件不 import、不复制该类型，只产出本地封闭码（`manifest.ts` 13 码 + `position/index.ts` 2 码 = 15 码）。映射表已逐行给出 77 `failure` 与 80 `category` 两轴；`digest`/`signature` 不符按 `unverified`+`EVOLVE_REJECT` **近似**映射（G10）。本包无 HTTP，故 `{error:{failure,category,subcause}, traceId}` 响应体不适用。`detail` 只给键路径与取值类别。 |
| 3 | 意图接入（`IntentKey`/`Receipt` 四态/`reserve`+`ingest` 原子/TTL） | **不适用** | 插件不调 `WorkIntake`/`IntentIngress`，不产 `IntentReceipt`；`position/*` 是宿主的岗位策略事件，不是意图。插件无任何写入口，也无 TTL/去重需求（每 agent 重校验，见 §5.3）。 |
| 4 | 对外 API 装配（`assembly/api/assemble.ts`、`assembleApi`+`http` 同进程 `:8788`） | **不适用** | 本包不装配 HTTP、不 `openLedgerReadonly`、不读部署配置；`assembleApi` 不在本包，`IntentIngress` 也不在此。插件只经宿主 `ctx` 拿能力，`position/index.ts` 的 config 只有 `manifestEnv`/`manifestPath` 两个数据键。 |
| 5 | `BindingProfile`（78-BIND-CORE-01 的 20 字段；`stateMappings` 带 `family`；`probes[].state` 三值；`mapState` 未知合法 → `Ok(unverified)`+`REC-OBS-02`） | **按引用适用** | 本包不写档案、不调 `mapState`：`BIND-DSH-01`/`BIND-PRM-01`/`BIND-POS-01` 是**上游**档案，本包的证据只喂 `probes[].state`（只取 `executed`/`not-executed`/`not-applicable`，不新增第四值）与 `losses`（只引用 `REC-LOSS-01` 的既有 ID）。`StateMapping`/`mapState`/`workStates` 不适用——岗位策略不映射平台工作态，也不产生 `REC-OBS-02`。`uncovered` 是 76 的四态之一，**不是** `unverified`，更不是 77 的异常 `unknown`（三者不同轴）。 |
| 6 | 秘密（`SecretCatalogEntry`/`Provider`/`Material`/`KnownSecretSet` 落 `contract`；`SecretUse` 六值；`load(entry,use)`；`SEC-<域>-<slug>`） | **适用为负向约束** | 插件**不读任何秘密**：不 `load`、不读 env 秘密、不读 `.env` 或密钥文件；PRM 只出现 `secretCategories[]` 与 `keyLogicalRef`（逻辑引用，不是路径）。`SecretUse` 六值里没有「验签/校验」用途，`secretId` 命名空间里也没有 `SEC-DSH-*`——所以 G17 是槽位缺失，不得自造用途值或类目。`SEC-GW-SIGNING`（`kind:'hmac'`）只服务网关出站签名，不下发给 worker 或本插件。 |
| 7 | stdio（`studio-tools` 只经 socket 与 daemon 交换；`serve/daemon.ts` 统一发 `StartupReport`） | **不适用** | 本包不提供 stdio 工具、不持 `wkey`、不注册 helper；DSH 插件在宿主进程内运行。`stdout` 永不写（headless `--json` 的 NDJSON 通道），也不产 `StartupReport`。 |
| 8 | 通知（`try/catch`+`Promise.allSettled`；`Notification` 含 `subject`/`severity`/`channels`） | **不适用** | `position/*` 是宿主总线事件，不是 `Notifier` 消息；本包不构造 `Notification`、不写标题/正文、不做发送重试。事件发不出时只回 `gap` 三态（`emitted`/`no-bus`/`rejected`），由调用方标证据缺口。 |
| 9 | 投影与台账（`ProjectionName` 含 `intentReceipts`/`observation`；`{items,nextCursor}`；`RecordEnvelope`；`CommitReceipt.committedAt`） | **不适用** | 插件不读台账、不写 `RecordEnvelope`、不持 `RecordReader`/`RecordWriter`/`IntentReceiptStore`；无游标、无 `committedAt`、无 `abort` 回执。证据沉淀归 daemon。 |
| 10 | 校验/门（`repo-validate` 留 `company`；五门在 `core`；`MergeRunHost`；`Money`；`sha8` 只在展示层；时间一律 `string`） | **不适用** | 本包不做仓库校验、不过五门、不跑合并、不涉金额。`sha8` 不出现：`manifestRef.digest` 与 `keyLogicalRef` 在诊断与事件里都用**完整值**。时间一律 `string`（PRM 的 `generatedAt`/`effective.*`/`validity.*` 原样保留为字符串比较），`now` 由调用方注入，本包不 `new Date()`。 |
| 11 | 装配（`assembleApi` 扩展、`serve()` 调 `runServe` 返 `CommandExit`、`external` 缺 `api` 即拒启、`IndexEntry` 只 `name/path`） | **不适用** | 本包不参与 serve/daemon 装配，不读 `external`，不产 `IndexEntry`。`artifact.ts` 的产物解析只产出「入口路径 + 形态」两事实，不解析包内容——这一点与 `loadIndex`/`checksumIndex` 的分工同构（本包属「声明面」，不属「内容面」）。 |
| 12 | 提交与转呈（`ReferralTarget` 四值；`IntakeOutcome` 五值；`auditHost` 只记 `sawAt`；`L5` 不写事实） | **不适用** | 本包无提交、无转呈、无受理结论；`uncovered` 不是 `IntakeOutcome`，也不是 77 的异常 `unknown`。插件不写任何事实，`L5` 上下文由桥注入，其内容归 daemon 组装。 |

〔结论〕12 项里 **2 项适用**（#2 在字符串层、#6 为负向约束）、**1 项按引用适用**（#5）、**9 项不适用**并各给理由。不适用的共同原因只有一条：本包零出边、零 IO 写、只在宿主进程内读一份清单并收紧策略；把 daemon/api 的装配与记账接口搬进来会立刻产生第二事实源。
