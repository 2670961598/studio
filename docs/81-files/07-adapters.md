# 81-files/07 · packages/adapters 逐文件技术设计

> 版本：v0.3，2026-10-27（口径校订：① 端口引用去通配、按 80 实号分开——资格 `TS-PORT-WORK-08`、
> 开工五门 `TS-PORT-WORK-03`、授权签发 `TS-PORT-AUTH-05`、权威激活 `TS-PORT-AUTH-03`、写租约
> `TS-PORT-AUTH-04`；② DSH 侧七段（安装/挂载/加载/探测/资格/授权/生效）与「包安装 / 源码 HMR /
> agent loop 切换」三事实分开，PTC 默认 `forbidden`、H0a–H4 不预认；③ 秘密示例按平台域段改为
> `SEC-TG-*`（`YT` 专指 YouTrack）；④ 调用方判据统一为「开工五门 `WORK-03` + 资格 `WORK-08`」，
> codex/kimi 的 fail-closed 范围按 78-§8.3 收窄到实际标注项）。
> **v0.2（2026-10-27）**：一致性修订——错误两轴、秘密供给、能力端口签名、金额/摘要边界。
> 性质：**自然语言级文件与实现设计呈审稿**。本文所有“目标/新增/拆分/替换/退役”都是设计处置，
> 尚未执行；不构成实现单、能力证明或测试通过记录。
> 上位：75 的文件与依赖契约；76 的能力语义；77 的出工/资格/收割记录与失败分类；78 的 DSH/CLI/
> 工作区绑定与秘密清单；79 的 TS 工程与依赖；80 的执行面/能力面端口、错误两轴（§5.7）与秘密供给
> （§11.2.1）。
> 边界：本附录只把 80 的组件落到 `packages/adapters` 的文件；**不新增公共概念、TS 端口、REC-ID、
> 状态、依赖边或依赖版本**。80 已给的接口（`ClassifiedError` 两轴、`TS-PORT-CAP-01..06` 的
> `Result` 签名、`SecretCatalogEntry`/`SecretProvider`/`SecretMaterial`/`KnownSecretSet`）按接口实现，
> 不另造第二套；发现的真实缺口集中在 §七 回写，不在本文件私造补洞。

---

## 〇、范围、方法与计数

### 0.1 盘点方法与口径

- 范围：`packages/adapters/{src,test}/**`、`package.json`、`tsconfig.json`。排除 `node_modules`、生成物、
  仓外第三方源文件。
- 手段：`find`/`wc -l` 全量枚举；逐文件 `Read` 关键导出、内部类型、IO 与测试锚；只读，不运行真实
  CLI、不启动服务、不改 manifest/lock/guards。
- 证据标签沿用 81-§四：**现有 / 库级未接 / 目标-保留 / 目标-拆分 / 目标-新增 / 目标-替换 /
  目标-退役 / 仅测试 / 未证**。
- 行数与目录预算：`maxLinesPerFile = 600`、`maxFilesPerDirectory = 25`
  （`scripts/guards/boundary-rules.mjs:149,152`）；本包在 `lineBaseline` 内的三件是
  `src/dsh.ts`（758）、`test/dsh.test.ts`（785）、`test/kimi.test.ts`（662）
  （`boundary-rules.mjs:171-175`），只许净减。

### 0.2 现有件全集（41 件，可按路径复算）

| 类别 | 件数 | 路径 |
|---|---|---|
| 生产 src | 9 | `src/index.ts`、`streams.ts`、`dsh.ts`、`seatbelt.ts`、`claude.ts`、`codex.ts`、`kimi.ts`、`registry.ts`、`agentconfig.ts` |
| 测试源码 | 14 | `test/` 直属 14 个 `*.test.ts`（见 §3.1、§3.2） |
| 测试基建 | 2 | `test/fake-cli/fake-cli.mjs`、`test/fake-cli/README.md` |
| 夹具 | 14 | `test/fixtures/dsh/` 6、`claude/` 3、`codex/` 3、`kimi/` 2 |
| 配置 | 2 | `package.json`、`tsconfig.json` |
| **合计** | **41** | 复算：`9 + 14 + 2 + 14 + 2` |

`test/` 侧共 30 件（14 测试 + 2 基建 + 14 夹具）；`test/` 直属文件 14 件，未触 25 件上限。

### 0.3 目标件全集（68 件）与处置计数

| 处置 | 件数 | 说明 |
|---|---|---|
| 目标-保留 | 38 | src 8 件（内部可能改实现，路径与职责保留）+ 测试 12 + 测试基建 2 + 夹具 14 + 配置 2 |
| 目标-替换 | 1 | `src/dsh.ts` 内容换为 facade（对外导出面不变） |
| 目标-拆分后新增 | 29 | src 13（dsh 子域 6 + capability 7）+ 测试侧 16（dsh 6 + kimi 4 + capability 3 + 共享测试基建 2 + 错误两轴 1） |
| 目标-退役 | 2 | 拆分迁移完成后 `test/dsh.test.ts`、`test/kimi.test.ts` 两个旧路径退役（内容不丢，迁入子目录） |
| 无处置（遗漏） | 0 | 41 件逐件在 §二～§四有条目 |

目标全集：src 22 件（9 个既有路径 + 13 新增）｜测试侧 44 件（测试 26 + 测试基建 2 + 共享测试基建 2 +
夹具 14）｜配置 2 件 → **68 件**。复算：`38 保留 + 1 替换 + 29 新增 = 68`；旧路径 41 = `38 + 1 + 2`。

目录预算核对：`src/` 直属 9、`src/dsh/` 6、`src/capability/` 7、`test/` 直属 13、`test/dsh/` 6、
`test/kimi/` 4、`test/capability/` 3、`test/support/` 2，均 ≤25；单文件预算见各条目。

### 0.4 本包的“现有 ↔ 目标”总判断

- **现有真实能力**：四个 CLI shell-out 适配器（execa 子进程 + stdout 行归一 + kill 升级链）、
  `parseStream` 四种流解析、注册表与能力路由、`agent.yaml` 装载/接线、dsh 的 env 白名单与凭据键域闸、
  seatbelt 写域 profile 生成与 argv 包装。生产装配真实存在：`apps/daemon/src/assembly/serve.ts:67,962-975`
  装载 `createRegistry/loadAgentConfig/wireRegistry/judgeAwareResolver/tierAwareResolver`；
  `apps/daemon/src/engine/judge/invoke.ts:65,173` 直接构造 `DshAdapter`；
  `engine/engine.ts:219`、`engine/merge/merge-run.ts:70` 只取 `ExecutorRegistry` 类型。
- **库级但未被主循环完整调用**：`DshAdapter.resumeWithSession`（装配侧只透传 `TaskBrief.resume`，
  没有 dsh 原生 id 的续跑编排证据）；`claude.nativeSessionId`（回填但 daemon 未消费）；
  `filterWorkerEnv` 只用于 dsh，另外三家仍全量 `{...process.env}`。
- **目标但完全未实现**：能力包六段（`TS-PORT-CAP-01..06`，80 已给签名与错误类，字段集仍缺）；
  `TaskBrief.planRef` 与 `Handle.fence`（80-§6.5 已给类型 `VersionRef<string>`/`FenceToken`，
  contract 落点归 81-files/01，尚未落）；错误两轴（`ClassifiedError.failure` 契约未落，
  本包现只有 `category/subcause`）；秘密供给面（`contract/src/ports/secret.ts` 未建，
  `core/src/secrets.ts` 未迁 contract，见 §1.5）；DSH 插件 probe/position 策略面。
- **仅测试/演示**：`test/fake-cli/*`、14 个 golden 夹具。夹具回放不是真机执行证据；四家适配器的
  真机行为只在 dsh 有 docs/31 记录，claude/codex/kimi 夹具头注自述“手工构造”。fake 适配器/假平台
  只许测试与显式 `--demo`，不得用于真实公司激活（80-§6.5）。

---

## 一、跨文件契约（先定公共面，再逐件）

### 1.1 包位与允许边

- 层位 1（`packageLayers.adapters = 1`），只允许 `adapters → contract` 一条横向边
  （`boundary-rules.mjs:110-157`）。包内不得 import `daemon/core/store/company/prompt/gateway/panel/api`。
- 直接后果（必须在设计里算数）：`core/src/secrets.ts` 的 `redactOutbound`/`redactKnownSecrets`/
  `findSecretShaped` 本包**不可 import**。目标形态是整模块迁 `contract`（80-§11.2.1；core 只具名
  re-export 三个函数，不 `export *`），纯函数落点与端口类型（`contract/src/ports/secret.ts`）归
  81-files/01；迁移完成前本包**不做脱敏**，也不得声称已脱敏（§1.5）。
- 允许的第三方：`execa`（`DEP-EXECA-10`）、`yaml`、`zod`、Node 标准库。目标移除 `simple-git`
  （79-§10.1 第 3 项：`src`+`test` 零 import）。
- 对外导出面必须保持以下符号（daemon 现役调用点）：`createRegistry`、`ExecutorRegistry`（类型）、
  `loadAgentConfig`、`wireRegistry`、`judgeAwareResolver`、`tierAwareResolver`、`isJudgeExecutorName`、
  `judgeFamilyOf`、`tierOfExecutorName`、`tierExecutorName`、`dshModelFromPatches`、`DshAdapter`、
  `DSH_DEFAULT_CMD`。拆分只能改文件内部，不改包根导出名。
- 跨卷边界：`contract/src/ports/intent.ts`、`contract/src/ports/secret.ts`、`core/src/work-readiness.ts`、
  `apps/daemon/src/assembly/intent/{ingress,receipt-store}.ts`、`apps/daemon/src/assembly/api/assemble.ts`
  都是**其他卷的目标文件**（01/02/17），本卷只引用其接口、不重复给文件契约、不把它们算进本包计数。

### 1.2 四家执行链的公共形状（现有，四份重复实现）

四家都按同一顺序实现 `TS-PORT-EXEC-01` 的六方法：`detect → estimate → launch → stream → resultStats → kill`。
公共形状（在四个文件里各写一遍，目标拆 dsh 时只抽 dsh 的，不强行统一四家）：

1. `launch` 用 `execa` 起子进程：`cwd = task.workspace`、`stdin: 'ignore'`、`stdout/stderr: 'pipe'`、
   `reject: false`、`killDescendants: true`、`forceKillAfterDelay: false`；
2. 模块级 `Map<sessionId, SessionState>` 保存伴生状态，`sessionId` 为 `randomUUID()`；
3. `stream` 逐 chunk 拼行、行级解析、事件与原文同时入伴生状态；`streamConsumed` 保证一单一收；
4. `resultStats` 只读已消费事件与原生 meta；`kill` 幂等，SIGTERM → graceMs → SIGKILL；
5. 落定观察器由 `subprocess.then(ok, err)` 派生维护 `settled/settledExitCode/spawnError`。

### 1.3 能力包六段不可合并（目标，80-§6.5）

解析“需要什么→哪些候选” → 安装 → 挂载 → 探测 → 能力激活 → 退役，是六条独立记录链（80-§6.5）。
资格与权威激活**另属外部**（见本节末），不出现在下表。本包只实现**机制件**：

| 段 | 端口 | 本包落点 | 不做什么 |
|---|---|---|---|
| 解析“需要什么→哪些候选” | `TS-PORT-CAP-01` | `src/capability/resolve.ts` | 不判资格、不授权、不安装 |
| 安装（存在于目标环境） | `TS-PORT-CAP-02` | `src/capability/install.ts` | 不挂载、不加载、不激活 |
| 挂载（宿主可见） | `TS-PORT-CAP-03` | `src/capability/mount.ts` | 不等于加载成功 |
| 探测（宿主确实看见/加载） | `TS-PORT-CAP-04` | `src/capability/probe.ts` | 不可探测返回“未证”，不是 false |
| 能力激活（这版开始被使用） | `TS-PORT-CAP-05` | `src/capability/activate.ts` | 不是权威激活（`TS-PORT-AUTH-03`） |
| 退役（在途交接后退出） | `TS-PORT-CAP-06` | `src/capability/retire.ts` | 不删历史、不改记录 |

资格（`TS-PORT-WORK-08`）、授权签发（`TS-PORT-AUTH-05`）、权威激活（`TS-PORT-AUTH-03`）与写租约/围栏（`TS-PORT-AUTH-04`）**都不在本包**；能力包文件只能接收已判定的
结论作为输入，不能自己得出“有资格/已授权/已激活”。

### 1.4 四条边界：宿主 / 能力包 / 进程 / DSH（全包适用）

判据先立（78-§0.3、§2.2、§2.4）：

- 任何一句结论只能落在**四问之一**（正当性/技术许可/能力/证据），不许跨问合并；
- 凡谈 DSH，必须标明说的是哪条**事实线**：A = CLI shell-out（已有）、B = 插件承载（已有，仅上下文）、
  C = 长驻宿主/ACP/SDK（未证、本仓零实现）；
- 控制强度按**硬边界/软限制/不可表达**三分类；软限制（persona、AGENTS.md、plan mode）不得写成机制证据。

| 边界 | 拥有者 | 本包只做 | 不得宣称 / 不得做 |
|---|---|---|---|
| **宿主**（DSH/Claude/Codex/Kimi 可执行体） | 部署供给、版本钉住（DSH `0.2.0-rc.2`） | 事实线 A：拼 argv、喂 stdin、收 stdout、注 env、kill 进程组 | 不称「宿主允许 = 公司授权」（`L78-DSH-01`）；不把 `--dump-config`/配置回显当行为证据（78-§2.5）；不代改 `agent.yaml` 的 cmd（78-§4.3） |
| **宿主插件面**（DSH B 行） | `packages/dsh-bridge`（上下文桥，81-files/12）+ 目标 position 插件 | 零模块边（不 import dsh-bridge）；只经跨包冻结串 `STUDIO_NEXT_INSTRUCTIONS` 对接 | 不把上下文注入当策略（78-§4.3）；不声明 `tools.restrict`/`pre-execute`/审批/`sandbox-policy` 已生效；C 行本仓未实现 |
| **能力包**（`CapabilityPackage`） | 定义/引用归公司纯配置（76-§3.19）、资格归 `TS-PORT-WORK-08`、授权签发归 `TS-PORT-AUTH-05`、机制归属待 80 确认（§七-11） | `CAP-02..06` 机制件：安装 → 挂载 → 探测 → 能力激活 → 退役 | 不判资格、不授权、不做权威激活（`TS-PORT-AUTH-03`）；能力包不是 executor、不进 `ExecutorRegistry`；不因与定义包同归档而获信任/授权（76-§3.19） |
| **进程**（子进程） | 本包 `launch`/`stream`/`kill`；OS 提供原语 | execa 子进程、env 白名单、`cwd=workspace`、进程组 kill | 不称「进程隔离」：同用户、同会话、无独立用户/容器（78-§7.3）；`killDescendants` 只是进程组软/硬杀 |
| **DSH 进程内策略**（position 插件） | 目标插件（81-files/12 的 `src/position/`），与 agent 同进程 | 无（不实现、不打包、不加载插件代码） | 不称「进程内 guard 是安全边界」（`L78-POS-01`）；PTC 默认 `forbidden`（78-§3.2.4），适配器不解释档位、不放行 |

> 后两行是 DSH 边界的两个子面（B 插件承载 / 进程内策略），不另立第五类；能力包与二者互不替代（§1.4.2）。

#### 1.4.1 宿主边界：只有 A 行是现有能力

- 四家宿主都是 PATH 上的外部 CLI（DSH 另见 79-`DEP-DSH`）。适配器的全部权能止于 argv、stdin、
  stdout/stderr、env、退出码与信号——在此之外没有接口。
- B 行的现有实现是 dsh-bridge 的**上下文注入**（`inject:['systemPrompt']`）；C 行（长驻、`followup`/
  `steer`、ACP/SDK）只存在于探索文档，**本仓未实现任何绑定**（78-§2.2）。
- 四问的分工：本包能给「技术许可」（`detect().gaps` + 版本比对）与「能力」（探针回执）的**原料**；
  「正当性」来自公司宪制与授权记录，「证据」来自事件导出与独立复核——都不由适配器裁定。
- claude/codex/kimi 的宿主原生策略面（claude hooks/权限模式、codex sandbox/approval）不归本包；
  适配器只能经 argv/env 表达，且当前未做（能力声明冲突见 §七-6，env 收口见 W-F）。

#### 1.4.2 能力包边界：包 ≠ 执行体 ≠ 授权

- 能力包是可执行内容的独立 part，须自带类型、摘要、来源与许可；**不因与定义包同处一个归档而获得
  信任、授权或执行便利**（76-§3.19）。加载、激活、资格与授权**都不由包自己声明**。
- 各段不可合并、不得合称「热更」（75 禁止；80-§6.5）：安装只让包**存在**；挂载只让宿主**可见**；
  探测才回答「宿主是否真的看见并加载」（不可探测 = 未证，不是 false）；能力激活只回答「这版开始被
  使用」；权威激活另属 `TS-PORT-AUTH-03`；退役默认**交接**、不假定原地热更（D75-12）。
- 形态：必须是 JS + `.d.ts`（D75-07、79-§7.2）；仅含 `.ts` 入口的包在 `install` 阶段**拒收**，
  不得尝试加载（Node 不 strip `node_modules` 下的 TS）。
- 与插件本体的关系：DSH 插件本体（bridge/position）由 `packages/dsh-bridge` 分发（81-files/12），
  本包不打包、不改其 patch；第三方能力包若以 DSH 插件形态出现，本包只负责安装/挂载/探测的机制与
  回执，不为其代码正确性或策略语义背书。
- 能力包**不得**注册为 executor：executor 只来自 `agent.yaml` + 内置工厂（`agentconfig.ts`）。

#### 1.4.3 进程边界：有生命周期，无隔离

- `launch` 固定形状：`cwd=task.workspace`、`stdin:'ignore'`、`stdout/stderr:'pipe'`、`reject:false`、
  `killDescendants:true`、`forceKillAfterDelay:false`；子进程与 daemon 同用户、同会话。
- 沙箱只有 seatbelt 写域：读域规则 apply 即 `SIGABRT`（已删除）、嵌套 apply `EPERM`（应用点必须是
  未沙箱的 daemon）、网域 host 只能是 `*`/`localhost`、`sandbox-exec` 已 deprecated（78-§7.3）。
- 因此**读域、网络、进程隔离在本 OS 上不可表达**（`L78-WS-01..03`）；适配器不得宣称「已隔离」，
  也不得用「配置里写了」冒充（78-§2.4 第三类）。
- 进程内判定（position 插件）与 agent 同进程，有代码执行权即可篡改——它不是安全边界（`L78-POS-01`）；
  适配器同理：沙箱只能由**未沙箱**的 daemon 在 `launch` 前施加，已沙箱进程不能再套（嵌套 `EPERM`）。

#### 1.4.4 DSH 边界：本包只拥有 CLI shell-out

- 本包对 DSH 的唯一接口是 `['dsh','--profile','headless','--json']` + stdin 任务书 + stdout 事件流；
  这条线内的事实包括：`DSH_TELEMETRY_MODE=DISABLED`（探测与 launch 两处）、`extendEnv:false`
  （白名单生效前提）、终态只认 `turn_end.reason.kind==='completed'`、`--session-id` 续跑要求 cwd
  逐字节一致、`cost_native=false`（78-§2.5）。
- `agents_md='user_level'` 是**上下文通道**（daemon 写临时文件 + 注 `STUDIO_NEXT_INSTRUCTIONS` +
  bridge 读取），不是策略；它影响模型「想到什么」，不拒绝任何工具调用（78-§4.3）。
- 插件 overlay 的挂载靠 `agent.yaml` 的 cmd 显式 `--patch`，适配器只原样执行该 cmd，**不代改**；
  `--dump-config`、配置回显、进程重启分别不能冒充「加载成功/热更/无损切换」（78-§2.5、D75-12）。
- **DSH 侧七段必须逐段分开**（77-§4.9 明令「安装、挂载、加载、资格、授权、实际生效」六项不得
  混称，探测另据 80-§6.5 `CAP-04`；七段不是同义词）：安装（插件落到受控目录）→ 挂载
  （`agent.yaml` cmd 里的 `--patch` 指向）→ 加载（宿主在 `agent/created` 注册）→ 探测（日志/端点/
  一次性探针）→ 资格（`TS-PORT-WORK-08`）→ 授权（`TS-PORT-AUTH-05`）→ 生效（`TS-PORT-AUTH-03`
  权威激活 + 运行时暴露）。本包只参与 argv/env 与能力包机制（§2.3）；「加载了」「生效了」不由本包声明。
- **H0a–H4 是级别，不是同义词**：适配器不预认任何一级，也不把安装/挂载/加载**动作本身**当作
  H0a–H4 任何一级的证据（H0a 起就要求落位记录、安装日志与“宿主未承认”的明示）；分级证据
  归 77-§4.9 的记录与探测（默认目标是 H2/H3，H4 是可选宿主能力）。
- **包安装、源码 HMR、agent loop 切换三者分开**：`packages/*/src` 的改动不是能力包（不走 `install`，
  也不产生安装回执）；源码热更在本仓不存在；一次性 headless 子进程 → 长驻宿主（中途 `steer`/
  `followup`）属事实线 C，**未实现**——三者都不得称「热更」（77-§4.9、D75-12）。
- **PTC 默认 `forbidden`**：`dsh-agent-tool-presentation` 的 `ptc` 是代码执行面，不是「另一种工具」；
  有效边界（网络代理/容器/独立用户/远程执行）一项都未落地时只能 `forbidden`（78-§3.2.4），
  适配器不解释档位、不因 `--patch` 存在就假定放行。
- 升级即重探：rc 期插件 API 可变，换版本 = 新绑定档案 + 能力重认（`L78-DSH-07`）。

### 1.5 秘密与路径（全包适用）

- **秘密只以“已解析值的一次性透传”出现**：适配器从 `TaskBrief.credentials` 拿到的值已由 daemon 在
  launch 前解析（来源是 `SecretMaterial` 或 per-ticket `local-mint`）。本包**不读 `SecretCatalogEntry`、
  不调 `SecretProvider.load`、不持有 `KnownSecretSet`**——catalog/provider/脱敏集合都在 daemon 装配面
  （80-§11.2.1、78-§7.4.1）；适配器只负责把它原样放进子进程 env 并**永不回读**。
- **worker 永不拿 `SEC-GW-SIGNING`**：`gatewaySecret` 不进 `TaskBrief.credentials`；本包不因“适配器要用”
  而索取（80-§11.4.1）。per-ticket `wkey` 是唯一例外（`valueProvider:{type:'local-mint',ticketId}`，
  `secretId` 按 `SEC-WKEY-<ticketId>` 派生、不进静态 catalog），以固定 env 键 `STUDIO_TOOLS_WKEY` 注入。
- **env 键 ≠ `secretId`**：`CREDENTIAL_KEY_ENUM` 的 `DEEPSEEK_API_KEY`/`STUDIO_TOOLS_WKEY` 是子进程物理
  键名；`secretId` 是 `SEC-<域>-<slug>` 稳定命名（域段按平台取：`TG`=Taiga、`MX`=Matrix；
  例 `SEC-TG-TOKEN`、`SEC-MX-HR-SHARED`…；`YT` 专指 YouTrack，不得与 `TG` 互替；改名只动
  `secretId`、环境变量名不动，78-§7.4.1），轮换不改 ID、
  `version` 另记内容代次。适配器**不写死 `secretId → env 键`映射**（映射归部署/装配），也不得把
  `secretId` 当 env 键名用。
- **值不出现在任何可序列化面**：`detail`、日志、事件 `note`、`turn_end.error` 之外的调试字段都不得含
  credential 值、其前缀/哈希或本机绝对路径（80-§5.8）；只允许出现 env 键名与 `secretId`。
  `turn_end.error` 保留执行体原文（可能回显平台响应体），**本包不脱敏**（层级只到 contract，且脱敏集合
  不在本包）：出站/落账前由 daemon 按 78-§7.4.1「DSH 事件流」强制点过 `find` → `redact`；
  因此本包**不得**把原文另写 stderr/日志文件（否则绕过了那道闸）。
- **秘密值不因“适配器需要”而扩大可见面**：能力包/插件不接收秘密；`install` 不读任何 secret；
  `probe` 观测到的文本一律按“可能含凭据”处理（只回形状与位置，不回原文）。
- **脱敏函数不在本包可达面**：`redactOutbound`/`redactKnownSecrets`/`findSecretShaped` 现居
  `packages/core/src/secrets.ts`，而本包层位只允许 `adapters→contract`（`boundary-rules.mjs`），
  **不得 import core**。目标是整模块迁到 `contract/src/ports/secret.ts`（`SecretCatalogEntry/
  SecretProvider/SecretMaterial/KnownSecretSet` 已在 80 端口面），core 只具名 re-export；迁移完成前
  本包不自带一份脱敏实现（那会造第二套词表），出站强制点由 daemon 执行（§七-12）。
- 路径必须 containment + realpath + 符号链接检查；安装/挂载写入采用临时文件 + 原子替换；归档/包
  有数量、大小、深度上限（75-D75-13、76-§2.6）。

### 1.6 错误两轴：`ClassifiedError` 在本包怎么用

〔结论〕本包只按 80-§5.7 的两轴模型表达失败，**不保留 `category × subcause` 单轴旧写法**：

```ts
interface ClassifiedError {
  failure: FailureClass     // 77-§11.1 的 14 类处置轴：驱动重试/断路/对账/升级/判等
  category: ErrorCategory   // 11 类观测轴：只喂事件 note 与告警分桶，不驱动业务
  subcause: string          // 稳定实现细目（`agentconfig/parse`、`seatbelt/endpoint-unrepresentable`…）
  detail?: string           // 人读补充；过 80-§5.8，不含秘密与绝对路径
}
```

〔结论〕`ExecutorAdapter` 侧能产的 `Err` 只有两类（能力端口 CAP-01..06 走 `Result`，其 `failure` 逐件见
§2.3 各条；两者都受同一两轴约束）：

| 场景 | 形态 | `failure` | 缺省 `category` |
|---|---|---|---|
| 构造期非法：`seatbelt.mode` 非法、凭据键越域、`agent.yaml` 形状/语法错、seatbelt 端点不可表达 | `throw ClassifiedError`（80-§5.7 第 4 条：构造期/编程错） | `rejected_precondition` | `CONFIG_INVALID` |
| 运行期伴生状态丢失：daemon 重启后对旧 `Handle` 调 `stream`/`resultStats` | `throw ClassifiedError`（端口无 `Result` 通道，见下） | `unavailable`（**待 80 确认**，§七-4） | `STALL` |

〔结论〕`Err` 可达 `category` 只有 6 个：`CONFIG_INVALID`/`EVOLVE_REJECT`/`EXTERNAL_REJECT`/`STALL`/
`MERGE_CONFLICT`/`NO_LANE`。本包**不得**使用 `GATE_FAIL`/`WORKER_DEAD`/`QA_BACK`/`DISPATCH_FAIL`/
`LLM_FAIL`（内部事件与熔断域）；`NO_LANE` 只在显式 lane 上下文由 daemon 侧写，本包无 lane 标识，恒不写。

〔结论〕`ExecutorAdapter` 六方法（80-§6.5）**没有 `Result` 通道**，所以本包不得用 `rejected_*` 冒充
返回值，也不得把拒绝塞进成功值。失败事实的合规承载只有三处：

| 失败事实 | 承载 | 说明 |
|---|---|---|
| 版本不达标、CLI 缺失、沙箱后端不可用 | `DetectResult{ok,gaps[]}` | gap **不是**失败类；是否拒派由开工五门（`TS-PORT-WORK-03` `ReadinessGate`；目标件 `core/src/work-readiness.ts`，现状无此文件）与资格（`TS-PORT-WORK-08` `QualificationPort`）分别判，二者都不在适配器 |
| 执行体自述失败 | `turn_end{completed:false,errorCode}` | 码只取 `EXECUTOR_ERROR_CODES` 三值（`AUTH`/`MISSING_CREDENTIAL`/`EXTERNAL_RATE_LIMIT`），适配器不自造 |
| 构造期配置错 / 伴生状态丢失 | `throw ClassifiedError` | 上表两行；不得抛裸 `Error` 充数 |

〔结论〕`subcause` 保留现有 slash 命名（`agentconfig/parse`、`executor/dup-register`…），它是实现细目，
不是失败类；`failure` 必须是 77 的下划线原值，不得写驼峰、连字符或空格分词。迁移期双写：
`configInvalid(subcause, detail?)`（`contract/src/schemas/errors.ts:54`）现只写 `category/subcause`，
目标必须补 `failure:'rejected_precondition'`（契约变更归 81-files/01）；本包不得在本地造第二套构造器，
也不得把 `category` 当处置判据。

### 1.7 构建与分发

- `adapters` **不进入 dist 闭包**（79-§6.5）：保持 `private: true`、`exports["."] = "./src/index.ts"`、
  根 `tsconfig.json` 的 `include` 继续覆盖本包 `src`；包级 `typecheck` 已存在（`package.json:12`）且覆盖
  `test`（`tsconfig.json:4`）。不引 `tsconfig.build.json`、不引 paths、不引 project references。
- 三种分发件必须分开记：①本包（src 入口，不分发）；②DSH 插件本体（bridge/position，`dist/index.js`
  + `.d.ts`，81-files/12）；③能力包（安装进目标环境后才需 JS + `.d.ts`，75-D75-07、79-§7.2）。
  三者互不替代：本包不改 ②的 patch，②不经 ③的安装根进入宿主。

### 1.8 金额、摘要与日期在适配器面的边界

- **金额**：`Money{usd:number}`（`kernel.ts:13`）只作内存计算与旧记录兼容（80-§4.1 `TS-SCALAR-09`）；
  公共金额一律 `DecimalString` + 显式币种。本包的 `estimate`/`budgetCap`/`ResultStats.cost` 是端口
  签名的**透传位**，签名变更归 01/80（§七-13），不在本卷改；但边界处**不得做浮点运算**：claude 的
  `--max-budget-usd` 由十进制字符串精确转写（无 float 往返、不四舍五入），原生 `total_cost_usd`
  回填时按十进制字符串保留精度，`Money.usd` 只作展示；`cost_native:false` 的家仍恒 0，不折算。
- **摘要**：`sha8` 一类短哈希只作展示/日志关联，不作身份、去重键、缓存键或比对依据（`TS-SCALAR-08`）。
  本包唯一需要摘要的位置是能力包完整性校验（`install`）：必须用完整 `semanticDigest`（带
  `canonicalizationId`），不得把截断哈希当 digest；适配器不产记录摘要，也不把 `version` 当摘要。
- **日期**：N/A——本包不做日桶、账期或成本归属日聚合；UTC 日键与公司本地日之分属 core/company/store
  （80-§4.1）。适配器只回传毫秒时间值与原生 duration，不读宿主时区。

---

## 二、生产 src 逐件

### 2.1 保留与替换件

#### F-adapters-index

- **路径/处置**：`packages/adapters/src/index.ts`；**目标-保留**（导出面微调）。
- **归属/上位**：80-§2.1（adapters 层位 1）、80-§2.4；包根唯一公共入口。
- **现有职责**：`export *` 汇总 `streams/dsh/seatbelt/claude/codex/kimi/registry/agentconfig`；
  导出 `PACKAGE_NAME`、`PACKAGE_STATUS = "skeleton"`（`index.ts:59-63`）。文件头 TODO 仍写着
  “ExecutorAdapter 抽象基类 + 能力声明 schema（未做）”“探针 runner（未做）”——这是注释，不是能力。
- **非职责**：不装配 daemon、不读配置、不产生 IO；不证明任何适配器真机可用。
- **目标内部**：保留汇总导出；新增 `export * from "./capability/index.ts"`；`PACKAGE_STATUS`
  在目标实现落地后改为 `"ready"` 或删除（二者择一，不保留“skeleton”作为永久状态）。
  `dsh` 的汇总改为从 facade 导入，导出符号名不变。
- **导出与依赖**：仅相对导入；不得从本文件引 daemon/engine。
- **IO/状态**：N/A（无 IO、无状态）。
- **错误/观测**：N/A（模块求值不抛业务错）。
- **测试与证据**：由各子件测试间接覆盖；包根导出面由 daemon 现役 import 与 `test/registry.test.ts`
  的 `registerBuiltins` 锚点证明。**不证明**任何 executor 真机行为。
- **规模/迁移**：目标 ≤70 行；导出增删必须同步 `registry.test.ts` 与 daemon 调用点。

#### F-adapters-streams

- **路径/处置**：`packages/adapters/src/streams.ts`（447 行）；**目标-保留**（内部两处目标修正）。
- **归属/上位**：77-§6.1 收割（`RUN-EVD-01`）、80-§6.5 `TS-PORT-EXEC-01` 的 `stream` 归一化；
  四家流形态的绑定见 78-§2.3、§8.1。
- **现有职责**：把四家 CLI 原始文本归一为 contract `StreamEvent`：
  `parseStream(text, family, wireJsonlText?)`（全文同步）、`parseLine(line, family)`（单行增量）、
  `extractDshSessionId(line)`、`sumWireUsage(wireText)`；内部 `parseDsh/parseDshStatus/parseClaude/
  parseCodex/parseKimi` 与零依赖工具（`lines/parseJson/asRecord/...`）。
- **非职责**：不做终态决策（只产出 `turn_end.completed` 事实）、不算成本、不读文件、不起进程、
  不保留原始流（原文缓冲在适配器伴生状态）。畸形行降级 `log` 原文透传是“留证”，不是“修复”。
- **内部契约（现有，测试冻结）**：
  - dsh：顶层八类 `session/status/thinking/text/tool_call/tool_result/final/error`；`step_start|step_end|
    turn_end` 是 `status.phase`；终态只认 `reason.kind === 'completed'`；usage 仅 `step_end` 且 camelCase
    四桶；`error.code` → `turn_end.errorCode`，`error.message` → `turn_end.error`；空 `final` 不产事件。
  - claude：`result` 是唯一终态；`subtype === 'success' && is_error !== true` 才 completed；`system`
    归一为 `system:<subtype>` 的 log；assistant 只拼 text 块。
  - codex：`item.started/completed` → step 对；`agent_message` 先 log 再 step_end；`turn.completed.usage`
    挂 turn_end；`turn.failed` 无 usage，error 挂 turn_end。
  - kimi：stdout 与 claude 同构；wire 全文全部 `usage` 记录求和挂**最后一个** turn_end；缺 wire /
    无 usage / 无 turn_end 三种情况各追加一条明示 log。
  - 容错：BOM、CRLF、空行、`#` 注释行；解析失败降级 `log` 原文。
- **目标修正**（三处，不改冻结行为）：
  1. 删除本文件私有的 `ExecutorFamily` 定义（`streams.ts:39`），改为 `import type { ExecutorFamily }
     from '@studio-next/contract'`——contract 已有同名类型（`contract/src/ports/executor.ts:10`），
     现文件头“contract 尚无 family 概念”是过期注释；
  2. 文件头把“docs/25-§二 StreamEvent 无 session/duration/cost”改为指向 80-§6.5 的 `resultStats`
     责任划分，避免读者以为协议缺字段；
  3. 文件头与 `log` 出口处注明：`log` 承载的原文可能含平台响应体回显的凭据，**本文件不脱敏**；
     出站/落账前由 daemon 按 78-§7.4.1「DSH 事件流」强制点过 `find` → `redact`（80 目标把
     `secrets.ts` 迁 contract，见 §1.1/§1.5）。在迁移完成前，本包不得把原文另写 stderr/日志文件。
- **导出与依赖**：只依赖 `@studio-next/contract` 的类型；零运行时依赖、零 IO；纯函数，无状态。
- **错误/观测**：不抛业务错误；畸形输入是**数据**不是异常。`log` 原文只交给上层，是否落台账、
  是否脱敏由 daemon 决定；本文件不产 `ClassifiedError`（纯函数无拒绝通道，畸形行也不构成拒绝）。
- **测试与证据**：`test/streams.test.ts`（golden 全量）+ 四家适配器测试中的 `parseLine ≡ parseStream`
  旁证 + `test/dsh/stream-golden.test.ts`（拆分后）。V2 行为契约；**不证明**真机流会长期保持该形态，
  dsh 的形态只对 0.2.0-rc.2 的五份实录成立。
- **规模/迁移**：447 行，目标 ≤600；若新增第五家导致超限，按 `<family>` 拆到
  `src/streams/<family>.ts` + facade，不得把新解析器堆进本文件。

#### F-adapters-registry

- **路径/处置**：`packages/adapters/src/registry.ts`（153 行）；**目标-保留**。
- **归属/上位**：80-§6.5 `TS-PORT-CAP-01` 的“现状等价物”（80-§6.0 明示只覆盖“解析”）、
  80-§6.8（`Scheduler` 等机制件之外的注册机制）；77-§4.7 资格不由本文件判。
- **现有职责**：内存注册表 `createRegistry()`：`register/resolve/list/pick/pickAll/defaultName`；
  同名重注册与第二个 default 拒收（`configInvalid`）；`pick` 只读 `capabilities` 做真值
  过滤，default 也要过过滤；注册序=调用序。
- **非职责**：不装载 YAML（`agentconfig.ts`）、不探测版本（`detect`）、不判资格、不授权、不持久化。
  它**不是** `CapabilityResolver`：能力包解析需要“需求→候选实现”，本表只有“名字→实例”。
- **内部类型**：`RegisterOptions`、`PickOptions`、`RegistryEntry`、`ExecutorRegistry`、内部 `InternalEntry`、
  纯谓词 `matchesCaps`。`PickOptions.agentsMdChannel` 取 contract 的 `agents_md` 枚举。
- **导出/依赖**：只依赖 contract 的 `ExecutorAdapter/ExecutorCapabilities/configInvalid`；无 IO。
- **状态/并发**：单线程内存数组；**无锁、无并发保护**（文件头自述 v0）。目标：保持同步 API，明确
  “只在 daemon 单线程装配期写、运行期只读”，不引入异步注册。
- **错误/观测**：构造期错，一律 `throw ClassifiedError`，按 §1.6 写两轴：`failure:'rejected_precondition'`、
  `category:'CONFIG_INVALID'`，subcause 三项 `executor/dup-register`、`executor/dup-default`、
  `executor/unknown`（现 `configInvalid` 只写 category/subcause，补 failure 归 81-files/01）。
  `pick` 无解返回 `undefined`（结果，不是错）；`pick` 是**查询**，不得改写成 `Err`。
- **测试与证据**：`test/registry.test.ts`（注册/拒收/能力矩阵/default 边界/快照隔离）。
  目标新增 `test/capability/resolve.test.ts` 证明“注册表 ≠ 能力解析”，不把 `pick` 冒充 CAP-01。
- **规模/迁移**：153 行，目标 ≤200；不拆。

#### F-adapters-seatbelt

- **路径/处置**：`packages/adapters/src/seatbelt.ts`（190 行）；**目标-保留**（仅文档与导出面约束）。
- **归属/上位**：78-`BIND-WS-01`（工作区/OS/网络/秘密边界）、78-§7.3 的负向证据；75-D75-13。
- **现有职责**：纯函数 profile 生成器 `buildWorkerSeatbeltProfile`、argv 包装 `seatbeltArgv`、
  文件名 `seatbeltProfileFileName`、常量 `SEATBELT_BIN`、`DSH_HOST_RPC_DEFAULT`、类型
  `SeatbeltEndpoint/SeatbeltProfileParams`。形态：`(allow default)` 基线 + `(deny file-write*)` + 写域
  白名单 + `(deny network*)` + 回环/出口白名单；读域宽放（attempt3 删除读收口）。
- **非职责**：不 apply 沙箱（由 dsh 适配器在未沙箱的 daemon 进程内 apply）；不判断策略是否“已生效”；
  不覆盖读域、进程、资源；不保证 `sandbox-exec` 长期存在（已 deprecated）。
- **内部契约**：SBPL 字符串转义（引号/反斜杠）；endpoint host 只接受 `localhost/127.0.0.1/::1/*`，
  其他 host 生成期抛错（fail-closed，不静默放宽成 `*:port`）；`writeRoots` 空串跳过。
- **IO/状态**：纯函数，零 IO、零状态；同参同文。
- **错误/观测**：`sbEndpoint` 对不可表达 host 抛普通 `Error`（**目标**：改为
  `throw ClassifiedError{failure:'rejected_precondition', category:'CONFIG_INVALID',
  subcause:'seatbelt/endpoint-unrepresentable'}`，按 §1.6 的两轴——生成期错属构造期非法，
  不得用裸 `Error`，也不得降级为 `unsupported`）；不记录任何路径内容到日志；
  profile 文本本身可含工作区路径，只落盘不回显到事件 note。
- **测试与证据**：`test/seatbelt.test.ts`（纯函数、参数化、同参同文、读域回归网、SBPL 编译三形态、
  dsh 接线、嵌套环境 fail-closed）。V4 安全/故障；只在 darwin 且 `sandbox-exec` 可用的环境执行编译面，
  **不证明** worker 真被限制（读域/网络/进程均未证）。
- **规模/迁移**：190 行，目标 ≤300；不拆。若未来引入容器/Linux 后端，新增 `src/sandbox/<backend>.ts`，
  本文件保留为 macOS 后端之一，不把多后端塞进同一文件。

#### F-adapters-claude

- **路径/处置**：`packages/adapters/src/claude.ts`（501 行）；**目标-保留**（目标补 env 收口，待批准）。
- **归属/上位**：78-`BIND-CLI-CLAUDE-01`、78-§8.3/§8.4；80-§6.5 `TS-PORT-EXEC-01`；77-`REC-WORK-06`
  执行配置面。
- **现有职责**：`ClaudeAdapter` 六原语；`detect` 跑 `[...cmd,'--version']` 解析版本，门槛
  `CLAUDE_AGENTS_MD_MIN_VERSION = '2.1.277'`，低于门槛 `ok:true + gaps` 并在 launch 把
  `native/user_level` 降级为 `append_system_prompt`；`launch` 追加 `-p --output-format stream-json`、
  `--max-budget-usd`（`budgetCap` 存在时）、`--resume`（`task.resume` 存在时）、append 旗标；
  `stream` 逐行 `parseLine(...,'claude')` 并用 `noteResultMeta` 捕获 `total_cost_usd/duration_ms/
  num_turns/session_id`；`resultStats` 原生 cost/tokens/duration/turns；`nativeSessionId`。
- **非职责**：不判“完成=验收”（78-`L78-DSH-02` 同理）；不累计预算（预算帽是单次上限）；不提供单轮取消
  （`cancel_turn:false`）；不证明 `CLAUDE_CONFIG_DIR` 是真实 user_level 通道（文件头自述拟稿）。
- **能力声明**（静态，现有）：`budget_cap:true`、`cancel_turn:false`、`session_resume:true`、
  `agents_md:'native'`（版本门控降级）、`cost_native:true`。声明强度按 78-§8.3 核过：五项都有
  宿主文档或真机依据，但“有预算帽”只是单次上限、不是累计预算。
- **导出/依赖**：`CLAUDE_DEFAULT_CMD`、`CLAUDE_AGENTS_MD_MIN_VERSION`、`ClaudeAdapter`；
  依赖 contract、execa、node:crypto/fs；不依赖其它适配器文件。
- **IO/注入**：`detect`/`launch` 起子进程；`estimate` 读 `briefPath`；env 目前 `{...process.env}` +
  `CLAUDE_CONFIG_DIR`（user_level）+ credentials。时间 `Date.now()`；ID `randomUUID()`；无网络直连。
- **金额边界**：`--max-budget-usd` 由 `budgetCap` 转写，目标按 §1.8 用十进制字符串精确转换
  （无 float 往返、不四舍五入、币种必须 USD，否则拒收不猜测）；`total_cost_usd` 回填进
  `ResultStats.cost` 时同样保精度，`Money.usd` 只作内存/展示形态。
- **状态/并发**：模块级 `sessions` Map 永不回收；`streamConsumed/killed/settled` 守卫；`subprocess.then`
  观察器吞 reject。恢复：daemon 重启后 `requireState` 抛 `ClassifiedError`（分类见 §1.6 与 §七-4），
  不猜测、不复用旧 session。
- **错误/观测**：`detect` 四类 gap（timeout/not-installed/detect-failed/version-unparsed）；低于门槛
  gap 明报回退；launch `reject:false`，退出码不参与成功判定；`isCompleted = turn_end.completed && 非空 log`。
  **目标**：env 从全量继承改为 deny-by-default 白名单（与 dsh 同构，键集含 claude 必需键），并把
  credentials 键域闸纳入；这是行为变更，须单独实现单 + 真机探针，不得与本附录视为已做。
- **测试与证据**：`test/claude.test.ts`（能力声明、全链、kill 无终态、孙进程、detect 三态、参数注入、
  AGENTS.md 通道、credentials、estimate、parseLine 等价）。**不证明**真实 claude 的 result 形态、
  `CLAUDE_CONFIG_DIR` 语义、`--append-system-prompt-file` 版本行为；夹具为手工构造。
- **规模/迁移**：501 行，目标 ≤600；不拆。若 env 收口实现后超限，先抽 `src/hostenv.ts`（四家共享的
  env 白名单机制），但那属四家统一改造，须先回写 78-§7.4 的 per-host 键表。

#### F-adapters-codex

- **路径/处置**：`packages/adapters/src/codex.ts`（391 行）；**目标-保留**（目标补 env 收口，待批准）。
- **归属/上位**：78-`BIND-CLI-CODEX-01`、78-§8.3；80-§6.5。
- **现有职责**：`CodexAdapter` 六原语；`launch` 追加 `exec --json` 与 `--resume`（拟稿旗标形）；
  `stream` 归一 codex 流；`resultStats` tokens 取 turn_end、turns 取 step_end 计数、cost 恒 0；
  `agentsMdEnv` 映射 `CODEX_HOME`（user_level）/`CODEX_APPEND_INSTRUCTIONS_FILE`（append，自拟名）。
- **非职责**：无预算帽（`budget_cap:false`，`budgetCap` 无处落地）；成本不折算；无原生 session id 回填
  （文件头自述 fixture 无来源）；不证明续跑旗标/子命令形态。
- **能力声明**：`budget_cap:false`、`cancel_turn:false`、`session_resume:true`（拟稿）、
  `agents_md:'native'`（拟稿假设）、`cost_native:false`。
- **证据强度与目标**：按 78-§8.3，`session_resume` 与 `agents_md` 在探针前一律按“不支持”处理
  （PRM 生成 fail-closed）。本文件的目标义务是**在 `detect` 的 `gaps` 里明报**
  `codex-session-resume-unverified` / `codex-agents-md-unverified`，让调用方拿不到“已支持”的默示；
  `gaps` 不是失败类（§1.6），是否拒派由开工五门（`TS-PORT-WORK-03`）与资格（`TS-PORT-WORK-08`）判。
  静态声明是否同步降级为 `false` 属裁决项
  （§七-6），在裁决前不得把 `true` 当真，也不由本文件私改。
- **导出/依赖**：`CODEX_DEFAULT_CMD`、`CodexAdapter`；contract/execa/node。
- **IO/状态/错误**：与 claude 同构（sessions Map、streamConsumed、kill 升级链、reject:false）；
  `turn.failed` 无 usage 是冻结行为，不得用 dsh 的 step 求和口径混算；成本恒 0 不折算（§1.8）。
- **测试与证据**：`test/codex.test.ts`（能力、全链、失败面、kill、detect、参数、通道拟稿、credentials、
  estimate、parseLine）。**不证明**真 codex 的 `--resume` 形态、`CODEX_HOME` 目录语义、
  `CODEX_APPEND_INSTRUCTIONS_FILE` 是否存在（名字自拟）。
- **规模/迁移**：391 行，目标 ≤500；不拆。

#### F-adapters-kimi

- **路径/处置**：`packages/adapters/src/kimi.ts`（475 行）；**目标-保留**（目标补 env 收口，待批准）。
- **归属/上位**：78-`BIND-CLI-KIMI-01`、78-§8.3；80-§6.5；77-§4.6 执行配置面。
- **现有职责**：`KimiAdapter` 六原语；`WirePathResolver` 注入（缺省
  `<workspace>/.kimi/sessions/<sessionId>/wire.jsonl`，自拟）；`launch` 追加
  `-p --output-format stream-json` 与 `-S <id>`（拟稿）；`stream` 结束后 `mergeWireUsage` 读 wire 求和挂
  最后一个 turn_end，缺件/无 usage/无 turn_end 各追加明示 log；`resultStats` tokens 取 turn_end、turns 取
  turn_end 计数、cost 0。
- **非职责**：不构造 yolo/auto/plan 模式旗标（`-p` 与它们互斥，适配器只造 `-p` 基座）；不证明 wire 落点、
  `-S` 旗标、wire 是否在退出前写完；不回补已 yield 的 turn_end（流式固有不对称）。
- **能力声明**：`budget_cap:false`、`cancel_turn:false`、`session_resume:true`（拟稿）、
  `agents_md:'native'`（复查报告实锤，通道细节未证）、`cost_native:false`。
- **证据强度与目标**：按 78-§8.3，`session_resume` 在探针前按“不支持”处理（`-S` 旗标与 wire 路径
  均为拟稿/自拟，fail-closed）。本文件的目标义务是**在 `detect` 的 `gaps` 里明报**
  `kimi-session-resume-unverified` / `kimi-agents-md-channel-unverified`，使调用方拿不到“已支持”的默示；
  `gaps` 不是失败类（§1.6），是否拒派由开工五门（`TS-PORT-WORK-03`）与资格（`TS-PORT-WORK-08`）判。
  `agents_md:'native'` 是否为真只由实锤通道证明，
  静态声明是否同步降级为 `false` 属裁决项（§七-6），裁决前不得把 `'native'` 当已支持、也不由本文件私改。
- **导出/依赖**：`KIMI_DEFAULT_CMD`、`WirePathResolver`、`KimiAdapter`；contract/execa/streams/node。
- **IO/状态/错误**：`launch` 解析 wirePath 存入状态；`stream` 尾部读文件（唯一在流尾做文件 IO 的适配器）；
  `mergeWireUsage` 把读失败分类为 ENOENT/其他并明示，不抛给调用方；sessions Map 同构。
- **测试与证据**：`test/kimi.test.ts`（能力、全链、wire 三面、kill、detect、参数、通道、credentials、
  estimate、守卫/锚）。**不证明**真 kimi 的 wire 路径/时点/求和语义（docs/25-§3.1 裁决#4 仍称假设）。
- **规模/迁移**：475 行，目标 ≤600；不拆；测试超限见 §3.2。

#### F-adapters-agentconfig

- **路径/处置**：`packages/adapters/src/agentconfig.ts`（445 行）；**目标-保留**（职责与路径不变）。
- **归属/上位**：docs/17-§4（`agent.yaml` 的唯一职责=executor 注册与人事档案）、docs/17-§6（命令缺省）、
  docs/18-§1.2（注册序）、80-§6.5 `TS-PORT-EXEC-01` 的装配侧。
- **现有职责**：
  - 装载：`loadAgentConfig(text: string)` 把 YAML 文本解析为 `AgentConfig.executors[]`（书写序=注册序）；
    `AgentExecutorConfig` 只含 `name/default/version/cmd/capabilities/patches/plugins`；
  - 接线：`wireRegistry(registry, config, resolver)` 按配置逐条解析工厂、注入 `cmd` 与 `patches`、
    比对能力镜像后 `registry.register`；`registerBuiltins(registry, overrides)` 一行注册四家内置
    （`BUILTIN_ORDER = dsh,claude,codex,kimi`，dsh 缺省 `default`）；
  - 名解析器：`AdapterFactory`/`AdapterResolver` 两类型；`builtinResolver` 直接回内置工厂；
    `judgeAwareResolver`（后缀 `-judge`，`renameExecutor` 改名包装，禁止 judge 位标 default）；
    `tierAwareResolver`（`-high/-mid/-low`，按家族工厂出档位别名），三层可任意套接；
  - dsh 家族专属：`dshModelFromPatches` 只解释 `patches['agent-default-model']`
    （`{config:{provider,model}}` → `provider/model`），其余家不读 patches；
  - 内部校验：`checkCapabilityDrift`（配置能力字段与适配器静态声明逐字段比对）、`yamlErrDetail`（取行号）。
- **非职责**：不读文件/不做 IO（只吃文本，读盘在 daemon 装配）；不判资格、不授权、不选档位策略
  （只做名字映射）；不解释 yaml 之外的配置源；不持久化；不验证能力声明为真（`cap-drift` 只比
  “配置 vs 代码静态声明”，两者同时错仍通过）。
- **导出/依赖**：`AgentConfig`、`AgentExecutorConfig`、`loadAgentConfig`、`AdapterFactory`、
  `AdapterResolver`、`wireRegistry`、`BuiltinOverride(s)`、`registerBuiltins`、`dshModelFromPatches`、
  `builtinResolver`、`JUDGE_EXECUTOR_SUFFIX`、`isJudgeExecutorName`、`judgeFamilyOf`、`judgeAwareResolver`、
  `MODEL_TIER_SUFFIXES`、`ModelTierSuffix`、`isModelTierExecutorName`、`tierOfExecutorName`、
  `tierExecutorName`、`tierAwareResolver`。依赖：`yaml`、`zod`、`@studio-next/contract`
  （`configInvalid` + 三类型）、四家适配器、`ExecutorRegistry` 类型（`import type`）。
- **IO/状态/错误**：无 IO、无模块级可变状态（仅常量表 `BUILTIN_ORDER`/`BUILTIN_FACTORIES`）；
  构造错一律 `throw ClassifiedError{failure:'rejected_precondition', category:'CONFIG_INVALID'}`（§1.6——
  `failure` 是处置轴、`category` 只作观测），subcause 七类：`agentconfig/parse`（YAML 语法，带行号）、`/shape`
  （根节点或 zod 形状，带路径，最多 3 条）、`/missing-section`（缺 `executors`）、`/no-executors`
  （空段）、`/unknown-executor`（配置有而代码无）、`/judge-default`（judge 位标 default）、
  `/cap-drift`（能力字段与代码声明不等）。现有 `configInvalid(...)` 只写 `category/subcause`，
  补 `failure:'rejected_precondition'` 的落点在 contract（归 81-files/01，见 §1.6 末段）；七种 subcause
  与两条轴不变，只差一个字段。
- **幂等/恢复**：纯函数，重复调用同一输入结果相同；但 `registerBuiltins`/`wireRegistry` 对同一
  registry 重复注册同名会由 registry 拒收（`CONFIG_INVALID`，不后写覆盖）——调用方须每进程新建 registry。
- **测试与证据**：`test/agentconfig.test.ts`（424 行：装载四态、wire、内置、dsh model 解析）、
  `test/agentconfig-judge.test.ts`（137 行）、`test/agentconfig-tier.test.ts`（179 行）；
  daemon 装配现役调用（`apps/daemon/src/assembly/serve.ts:67,962-975`，见 §0.4）证明接线可用。
  **不证明**：任何 executor 真机可用；能力声明真值；`agent.yaml` 与公司目录人事档案的字段全集一致
  （本文件只见 executor 段）。
- **规模/迁移**：445 行，≤600，**不拆**；若未来加入档位/资格逻辑须先回写 80，不得在本文件膨胀。
  W-B 拆分 `dsh.ts` 后本文件的 `./dsh.ts` 导入（第 50 行）经 facade 继续可达，无需改路径。

#### F-adapters-dsh（旧件 → 目标-替换为 facade）

- **路径/处置**：`packages/adapters/src/dsh.ts`（758 行，`lineBaseline`）；**目标-拆分承载 + 替换为 facade**。
  旧职责拆入 §2.2 六个新文件；本路径保留薄 facade，导出名不变。
- **归属/上位**：78-`BIND-DSH-01`、78-§2.3/§2.5/§7.3；80-§6.5 `TS-PORT-EXEC-01`；77-§4.6/§4.8/§4.9。
- **现有职责**（作为整体，供迁移对照）：
  - 常量：`DSH_DEFAULT_CMD = ['dsh','--profile','headless','--json']`、`LOCKED_VERSION='0.2.0-rc.2'`、
    `DETECT_TIMEOUT_MS=5000`；类型 `DshSeatbeltOptions`、`DshAdapterOptions`；
  - env 安全：`ENV_KEY_ALLOWLIST`、`ENV_PREFIX_ALLOWLIST`、`CREDENTIAL_KEY_ENUM`、
    `INJECTION_KEY_PATTERNS`、`filterWorkerEnv`、`assertCredentialKeys`；
  - seatbelt 后端探测：`detectSeatbeltBackend`、`spawnSyncProbe`；
  - 伴生状态：`SessionState`、`sessions`、`requireState`；
  - `DshAdapter`：六原语 + `resumeWithSession` + `seatbeltEnabled` + `exitCode`；
  - 工具：`checkedCredentials`、`agentsMdEnv`、`readTaskText`、`aggregateUsage`、`isENOENT/asError/errMsg`。
- **非职责**：不写台账、不判验收、不提供单轮取消、不覆盖读域/网络/进程隔离；`capabilities` 是静态声明，
  不是实测结果。
- **目标 facade**：只做 `export { ... } from './dsh/index.ts'`（或逐文件 re-export），保持
  `DSH_DEFAULT_CMD/DshAdapter/DshSeatbeltOptions/DshAdapterOptions/filterWorkerEnv/assertCredentialKeys`
  六个对外名；**不得**在 facade 里新增逻辑、不得再长回 600 行以上。
- **迁移顺序**：先建 `src/dsh/` 子件并让 facade 转发 → 全量测试绿 → 再把测试迁入 `test/dsh/`
  （§3.2）→ 最后才允许删除 facade（若包内/仓内已无 `./dsh.ts` 引用；当前 `agentconfig.ts:50` 与
  `test/dsh-*.test.ts` 引用它，故短期必须保留）。
- **规模/迁移证据**：`wc -l` 由 758 降至 ≤60（facade），子件各自 ≤350；`lineBaseline` 条目可除名。

### 2.2 dsh 拆分子件（6 件，目标-新增；职责全部来自现有 dsh.ts）

#### F-adapters-dsh-adapter

- **路径/处置**：`packages/adapters/src/dsh/adapter.ts`；**目标-新增（拆分）**。
- **归属/上位**：80-§6.5 `TS-PORT-EXEC-01`；78-`BIND-DSH-01`；77-`REC-WORK-06`/`REC-WORK-07`。
- **职责**：`DshAdapter` 类与六原语编排：`name='dsh'`、五项能力声明（现有值：`budget_cap:false`、
  `cancel_turn:false`、`session_resume:true`、`agents_md:'user_level'`、`cost_native:false`）、
  构造期校验 `seatbelt.mode`、`detect`（版本 + `mode='auto'` 时后端探测）、`estimate`（v0 字符量模型）、
  `launch`/`resumeWithSession` 委托 launch 子件、`stream` 行消费（调用 session 子件与 streams）、
  `resultStats`（调用 accounting）、`kill`、`isCompleted`、`exitCode`。
- **非职责**：不拼 argv/env（`dsh/launch.ts`）、不持有 session 表（`dsh/session.ts`）、不做 usage 求和
  （`dsh/accounting.ts`）、不探测 sandbox 二进制（`dsh/detect.ts`）。
- **内部结构**：构造参数 `(cmd = DSH_DEFAULT_CMD, opts?: DshAdapterOptions)`；私有字段
  `cmd/seatbelt/model`；`seatbeltEnabled()`。目标新增（来自 80-§6.5）：`TaskBrief.planRef` 只读透传
  （适配器知道自己执行哪版计划），`Handle.fence` 只在执行体写共享存储时填入。两字段的**类型**已由
  80-§6.5 冻结（`planRef?: VersionRef<string>`、`fence?: FenceToken`），**contract 落点未落**（归
  81-files/01）；本文件按该类型只读透传，不另造同义字段、不改名、不给默认值。
- **导出/依赖**：只导出 `DshAdapter`；`dsh/launch.ts`、`dsh/session.ts`、`dsh/accounting.ts`、
  `dsh/detect.ts`、`../streams.ts`、contract、`../seatbelt.ts`（类型）。不得 import `../index.ts`。
- **IO/注入**：子进程经 launch 子件；`estimate` 读 `briefPath`；时间 `Date.now()`；ID 由 launch 子件生成；
  **无**网络。目标：把 `Date.now()`/`randomUUID()` 收为可注入的 `clock/id` 依赖，便于重放测试，但不新增公共端口。
- **状态/并发**：一会话一状态；`streamConsumed` 防二次消费；`killed` 防重复杀；`settled` 由观察器维护。
  无事务、无锁。恢复：进程重启即丢伴生状态，`requireState` 抛错，不推断。
- **错误/观测**：终态只认 `turn_end.completed`（`isCompleted`）；退出码只记录；失败分类码来自
  `EXECUTOR_ERROR_CODES`（`turn_end.errorCode`），适配器不自造码。秘密：不打印 credentials；日志只含
  path/ticket/attempt 等非秘密字段。
- **测试与证据**：`test/dsh/*`（§3.2）逐面覆盖；V2 行为契约 + V4 进程/信号故障。
- **规模/迁移**：目标 ≤320 行；迁移时逐段搬移，行为不变；所有现有断言必须原样通过。

#### F-adapters-dsh-launch

- **路径/处置**：`packages/adapters/src/dsh/launch.ts`；**目标-新增（拆分）**。
- **归属/上位**：78-`BIND-DSH-01`/`BIND-WS-01`；80-§6.5 前置（launch 前 daemon 已 mint 凭据）；
  76-§3.15、77-§3.4（秘密只透传）。
- **职责**：`launch(task)` 与 `resumeWithSession(task, id)` 共用的 spawn 落法：
  1. 读 `briefPath` 全文，拼 `[binary, ...baseArgs, ...extraArgs, '--', taskText]`；
  2. `seatbelt` 启用时生成写域、`DSH_HOME` 重定向、profile 落盘、`sandbox-exec -f` 包装；
  3. 组装 env：`filterWorkerEnv(process.env)` + `agentsMdEnv` + `checkedCredentials` + `dshHomeEnv` +
     `DSH_TELEMETRY_MODE='DISABLED'`（最后覆盖），`extendEnv:false`；
  4. `execa` 参数与落定观察器注册，返回 `Handle{executor,sessionId,pid}`。
- **非职责**：不猜任务内容、不校验凭据值（只校验键名）、不决定何时 kill、不写 profile 之外的文件。
- **内部结构**：`spawnHeadless(task, extraArgs)`；`readTaskText`；`checkedCredentials`；`agentsMdEnv`；
  seatbelt 分支（`writeRootsOverride` / `default` 写域 / `dshHomeRedirect` / `profileDir` / RPC 与 egress）。
- **导出/依赖**：导出 `spawnHeadless`（仅供 adapter 子件）；依赖 `execa`、node:fs、node:path、
  `../seatbelt.ts`、`./env.ts`、`./session.ts`、contract。
- **IO/注入**：fs 写 profile 与 `DSH_HOME` 目录（`mkdirSync`/`writeFileSync`）；`readFile` 任务书；子进程。
  目标：fs 操作收敛为一个可注入的 `fs` 依赖（便于测试路径逃逸/原子写），但**不新增公共端口**。
- **状态/并发**：无长驻状态；每次 launch 新 UUID 会话、新 profile 文件。幂等性：`launch` 非幂等
  （每次新进程），`resumeWithSession` 也不是幂等（会新起进程）。
- **错误/观测**：所有失败 `throw ClassifiedError`（§1.6；类别取值见下，均为
  `failure:'rejected_precondition'` / `category:'CONFIG_INVALID'`）：任务书不可读 →
  `subcause:'dsh/brief-unreadable'`（构造/前置错，不静默空串）；凭据枚举外键 →
  `dsh/credential-key-rejected`；seatbelt 非法档位 → `dsh/seatbelt-mode-invalid`。
  spawn 失败（ENOENT）不在本子件抛：`detect` 报 gap，`spawnError` 原样交给 `stream` 按 §1.6 承载。
  秘密：env 值从不进错误串与 `detail`。
- **测试与证据**：`test/dsh/launch.test.ts`（argv/env/凭据/遥测/任务串）、`test/dsh-env-whitelist.test.ts`
  （保留在 test 直属）、`test/dsh-judge.test.ts`（seatbelt 覆写）、`test/seatbelt.test.ts`（profile 落盘）。
- **规模/迁移**：目标 ≤240 行；把现有 `spawnHeadless` 整段搬入，不改逻辑。

#### F-adapters-dsh-env

- **路径/处置**：`packages/adapters/src/dsh/env.ts`；**目标-新增（拆分）**。
- **归属/上位**：78-§7.4（秘密只以逻辑引用存在）、78-`BIND-DSH-01` §2.5（遥测）；76-§2.6/§3.15。
- **职责**：现有 env 安全面：`ENV_KEY_ALLOWLIST`（PATH/HOME/LANG/TZ/TMPDIR）、
  `ENV_PREFIX_ALLOWLIST`（`LC_`、`DSH_`）、`filterWorkerEnv(base)`（deny-by-default）、
  `CREDENTIAL_KEY_ENUM`（`DEEPSEEK_API_KEY`、`STUDIO_TOOLS_WKEY`）、`INJECTION_KEY_PATTERNS`、
  `assertCredentialKeys(creds)`、`agentsMdEnv`（`STUDIO_NEXT_INSTRUCTIONS`）、`checkedCredentials`。
- **非职责**：不决定“哪些键是这个 CLI 真正需要的”（那是 78 的 per-host 表）；不读 process.env（调用方传入）；
  不记录键值。
- **内部结构**：纯函数 + 常量；`agentsMdEnv` 对 native 返回空、user_level/append 返回同一注入键
  （dsh 无 append 专道）。
- **导出/依赖**：导出上述 5 个函数/常量给 launch 与测试；零 IO；只依赖 contract 的 `TaskBrief` 类型。
- **状态/并发**：N/A（纯函数）。
- **错误/观测**：`assertCredentialKeys` 抛
  `ClassifiedError{failure:'rejected_precondition', category:'CONFIG_INVALID', subcause:'dsh/credential-key-rejected'}`，
  对高危键点名原因（PATH/NODE_OPTIONS/LD_/DYLD_/SHELL/HOME），其余枚举外键给通用拒收；错误串与 `detail`
  只含键名，不含值。**目标**：错误 detail 中的键名是否算敏感需按 76-§3.15 复核——键名可留，值绝不留。
  另：env 键 ≠ 秘密清单的 `secretId`（`SEC-<域>-<slug>`，80 端口 `secret.ts`）；本子件只校验键名是否在
  枚举内，不建立 env 键到 `SEC-*` 的映射，映射表也不写死在这里（78-§7.4 归口，见 §七-7）。
- **测试与证据**：`test/dsh-env-whitelist.test.ts`（允许集/丢弃/undefined/枚举拒收/负样本探测）。
  这是**负断言**：证明宿主专有 env 不可见，不证明 OS 层隔离。
- **规模/迁移**：目标 ≤150 行；facade 继续 re-export `filterWorkerEnv/assertCredentialKeys` 以兼容测试。

#### F-adapters-dsh-session

- **路径/处置**：`packages/adapters/src/dsh/session.ts`；**目标-新增（拆分）**。
- **归属/上位**：80-§6.5 `stream/resultStats` 的伴生状态；77-`REC-WORK-07` 段内事件材料（适配器只产材料，
  不写记录）。
- **职责**：`SessionState`（subprocess、startedAt、events、rawLines、streamConsumed、killed、
  executorSessionId、settled、settledExitCode、spawnError、endedAt、exitCode）、
  `sessions` 表、`requireState(h)`、`registerSession(state)`、`observeSettlement(subprocess,state)`；
  目标新增 `release(h)`（流收尾 + 账目读取后释放，防无界增长）。
- **非职责**：不解析事件（`streams.ts`）、不决定终态、不写台账。
- **导出/依赖**：仅供 dsh 子件；依赖 execa 的 `Subprocess` 类型、contract `Handle/StreamEvent`。
- **IO/状态**：纯内存；无事务。并发：单线程；同一 session 的 `stream` 二消费由 `streamConsumed` 拒。
  恢复：无持久化，daemon 重启即丢；目标 `release` 不改变“丢失不可恢复”的事实。
- **错误/观测**：未知 sessionId 抛
  `ClassifiedError{failure:'unavailable', category:'STALL', subcause:'executor/session-state-missing'}`
  ——`failure` 取值是**草案**，§七-4 待 80 确认；但**不得**用 `WORKER_DEAD`/`DISPATCH_FAIL`（非 `Err` 可达
  category，§1.6）。`spawnError` 原样保留供 stream 抛出。
- **测试与证据**：由 `test/dsh/lifecycle.test.ts` 与 `test/dsh/stream-golden.test.ts` 间接覆盖
  （二次消费、未知 id、kill 幂等）。**不证明**跨进程恢复。
- **规模/迁移**：目标 ≤160 行；把现有 `SessionState/sessions/requireState` 与 `subprocess.then` 观察器搬入。

#### F-adapters-dsh-accounting

- **路径/处置**：`packages/adapters/src/dsh/accounting.ts`；**目标-新增（拆分）**。
- **归属/上位**：77-`RUN-EVD-01` 收割输入、80-§6.5 `resultStats`；132-§6.1 单A 四桶口径（仓内既有冻结）。
- **职责**：`aggregateUsage(events)`：只求 `step_end.usage` 四桶（input/output/cache_read/cache_creation），
  “任一 step 携带该桶才落键”，无 usage 时返回 `{input:0,output:0}`（不编造 0 桶）；`isCompleted(events)`
  可移入此处（只认 `turn_end.completed`）。目标 `resultStats` 组装（cost 0、duration、turns=step_end 计数、
  model 透传）也落此文件，adapter 只调用。
- **非职责**：不读流、不算价目表（cost 恒 0 是 `cost_native:false` 的诚实面）、不判验收。
- **导出/依赖**：仅供 dsh 子件；contract `StreamEvent/TokenCounts/ResultStats`；零 IO。
- **状态/并发**：纯函数，N/A。
- **错误/观测**：不抛错；缺 usage 是“零账”不是失败。**不得**把 `turn_end` 当 usage 来源（真机恒无）。
- **测试与证据**：`test/dsh/accounting.test.ts`（四桶归并、判负线⑤、部分桶、model 注入、零账）。
- **规模/迁移**：目标 ≤90 行。

#### F-adapters-dsh-detect

- **路径/处置**：`packages/adapters/src/dsh/detect.ts`；**目标-新增（拆分）**。
- **归属/上位**：78-§2.5（版本锁/探针覆盖）、78-§7.3（seatbelt 后端）、80-§6.5 前置（detect 必跑）。
- **职责**：版本探测：`execa(binary,['--version'])`（5s 超时、`reject:false`、白名单 env + 禁遥测）、
  版本正则、与 `LOCKED_VERSION` 比对、gap 组装；seatbelt 后端探测：`spawnSync('/usr/bin/sandbox-exec',
  ['-p', 最小 profile, '/usr/bin/true'])`，`status===71` → `seatbelt-nested-sandbox`，其他失败 →
  `seatbelt-backend-failed:...`。
- **非职责**：不判断宿主能否真正拦文件（编译通过≠生效）、不升级锁版本（升级=新绑定档案）。
- **导出/依赖**：`probeDshVersion(cmd)`、`probeSeatbeltBackend()`、`matchVersion`（内部）；依赖 execa、
  node:child_process、`../seatbelt.ts`、`./env.ts`。
- **IO/注入**：两个子进程；`spawnSync` 的探测不可注入（测试按环境自适应断言，两种环境都证 fail-closed）。
- **状态/并发**：无状态；探测不缓存（每次 detect 重跑），避免“上次可用”冒充本次可用。
- **错误/观测**：gap 词表：`dsh-detect-timeout`、`dsh-not-installed`、`dsh-detect-failed:<msg>`、
  `dsh-version-unparsed`、`dsh-version-unlocked:expected X,got Y`、`seatbelt-*`。**不静默降级**：
  版本不符仍 `ok:true` 但必须带 gap；seatbelt 不可用则 `ok:false`。gap 是 `DetectResult` 的字段，
  **不是失败类**、不产 `ClassifiedError`（§1.6）；是否因此拒派由开工五门（`TS-PORT-WORK-03`，
  目标件 `core/src/work-readiness.ts` 纯求值）与资格（`TS-PORT-WORK-08`）判，本子件只如实报缺。
- **测试与证据**：`test/dsh/detect-resume.test.ts`、`test/seatbelt.test.ts`（嵌套/非嵌套两态）。
  **不证明**真机版本行为；`--version` 输出格式未锁。
- **规模/迁移**：目标 ≤170 行。

### 2.3 能力包机制件（7 件，目标-新增）

> 共同口径：六个端口件（CAP-01..06，另加 `index.ts` 汇总共 7 件）的**公共类型全部来自 contract**（`CapabilityNeed/CapabilityCandidate/CapabilityPackage/
> InstallTarget/InstallReceipt/MountPoint/MountReceipt/ProbeReport/ActivationBasis/ActivationReceipt/
> RetirementPlan/RetirementReceipt`）。三条共性先钉死：①**签名已冻结**——80-§6.5 `TS-PORT-CAP-01..06`
> 一律 `Promise<Result<…,ClassifiedError>>`，本组不得改成抛异常或返回 `null` 表示失败；②**字段集仍缺**——
> 上述 12 个类型的字段未在 80 定义，本附录不私造，实施前回写 80（§七-1）；③**每处 `Err` 按两轴写**——
> `failure` 是处置轴、`category` 只作观测（§1.6），`path-escape` 等只是 `subcause`，其 `failure` 归属
> （`rejected_forbidden`）待 80 确认（§七-3），确认前不得用 `category` 顶替 `failure`。七件都**未实现、
> 未接主循环**；状态列按 80-§6.0 为“新建”。
> 边界口径见 §1.4.2：本组只拥有机制与回执，不拥有资格/授权/权威激活；能力包不得注册为 executor，
> 也不得改写 bridge/position 的 patch 或 overlay。

#### F-adapters-cap-resolve

- **路径/处置**：`packages/adapters/src/capability/resolve.ts`；**目标-新增**。
- **归属/上位**：80-§6.5 `TS-PORT-CAP-01`；76-`DEF-CAP-01/02`；77-`REC-WORK-08`（资格不在此）。
- **职责**：`createCapabilityResolver(deps)` → `{ resolve(need) }`：把“中立能力需求”解析为候选实现列表。
  依赖注入：候选目录（内存表或只读加载器）、版本约束比较器（79-§9.3：不引 semver 时用仓内精确锁规则）。
- **非职责**：不判资格（`TS-PORT-WORK-08`）、不授权（`TS-PORT-AUTH-05`）、不安装（CAP-02）、
  不激活（CAP-05）；无候选是 `Ok([])`，不是错误。
- **内部结构**：需求合法性校验（非法 → `rejected_precondition`）；按 `neutralCapability` 与
  `versionConstraint` 过滤；返回顺序稳定（候选目录顺序），不按“最新”排序。
- **导出/依赖**：`createCapabilityResolver`、`CapabilityResolverDeps`（结构面）；只依赖 contract；
  **零 IO**（Promise 只为端口形状）。
- **状态/并发**：无状态；候选目录只读快照，调用方更新时重建 resolver。
- **错误/观测**：非法需求 →
  `Err{failure:'rejected_precondition', category:'CONFIG_INVALID', subcause:'capability/need-invalid'}`
  （`subcause` 串为草案，实施时可调整子目但两轴不变）；无候选是 `Ok([])`，**不是**错误。不得在
  `detail` 里输出候选包的秘密字段。
- **测试与证据**：`test/capability/resolve.test.ts`：需求→候选、未知能力空数组、版本不满足排除、
  非法需求拒收、resolver 不触碰 install/authorize。V2；**不证明**真实宿主可承载候选。
- **规模/迁移**：目标 ≤150 行。锚点：`registry.ts` 的 `resolve` 只做“名字→实例”，本文件是“需求→候选”，
  不得合并。

#### F-adapters-cap-install

- **路径/处置**：`packages/adapters/src/capability/install.ts`；**目标-新增**。
- **归属/上位**：80-§6.5 `TS-PORT-CAP-02`；75-D75-04/07/12；78-`BIND-WS-01` §7.2（能力安装根）；
  79-§7.1/§7.2（JS+.d.ts、files 白名单）。
- **职责**：`createCapabilityInstaller(deps)` → `{ install(pkg,target), uninstall(id) }`：
  1. 校验包形态（入口 JS + `.d.ts`、摘要、来源、`files` 白名单；仅 TS 入口 → 拒收）；
  2. 安装根 containment + realpath + 符号链接检查；临时目录写入 → 原子 rename；
  3. 数量/大小/深度上限；不执行包内代码、不跑安装脚本；
  4. 记录安装回执（字段待 80）。
- **非职责**：不挂载、不加载、不探测、不激活；不判“这版包是否被公司批准”。
- **导出/依赖**：`createCapabilityInstaller`、`CapabilityInstallerDeps`（fs、digest、clock、installRoot）；
  只依赖 contract 与 Node 标准库（fs/path/crypto）；**不得** import execa（安装不执行外部命令）。
- **IO/注入**：fs 读写（安装根）、摘要计算；时间/ID 注入；**无网络**（来源获取由上层负责，或显式注入的
  fetcher——目标不默认联网）。
- **状态/并发**：按 `(packageDigest, target)` 幂等；并发安装同一 key 用安装根内锁文件/独占创建仲裁；
  中断后残留临时目录可清理，正式目录只在 rename 后可见。无数据库事务。
- **错误/观测**（均为 `Err`，两轴见 §1.6）：依赖缺失 →
  `failure:'rejected_precondition', category:'CONFIG_INVALID'`；版本冲突 →
  `failure:'rejected_version', category:'EVOLVE_REJECT'`；包形态不合（仅 TS 入口、`files` 白名单外、
  摘要缺失）→ `rejected_precondition`/`CONFIG_INVALID`；路径越界 `subcause:'capability/path-escape'`，
  其 `failure` 归 `rejected_forbidden`（待 80 确认，§七-3）。安装回执是端口返回值，**不属于 80 的
  50 类 REC**（§七-2）。回执含 digest 与 target、不含秘密；完整性比对用完整 `semanticDigest`
  （带 `canonicalizationId`），不得用 `sha8` 一类截断哈希（§1.8）。
- **测试与证据**：`test/capability/install-mount.test.ts`：正常安装、幂等、并发同 key、路径逃逸
  （`..`/符号链接）、仅 TS 包拒收、安装不执行包内脚本（用一个会写标记文件的包证明未执行）。
  V4 安全/故障；**不证明**真实 DSH/宿主能加载该包。
- **规模/迁移**：目标 ≤220 行。

#### F-adapters-cap-mount

- **路径/处置**：`packages/adapters/src/capability/mount.ts`；**目标-新增**。
- **归属/上位**：80-§6.5 `TS-PORT-CAP-03`；78-`BIND-DSH-01` §2.3（插件目录）、`BIND-WS-01` §7.2。
- **职责**：`createCapabilityMounter(deps)` → `{ mount(id,mountPoint), unmount(id) }`：把已安装包
  放入宿主可见范围（如插件目录），校验挂载点属于声明的宿主目录且不越界；挂载回执待 80。
- **非职责**：不等于加载成功（加载证据归 CAP-04）；不改宿主配置里的授权/审批段，也不改写
  bridge/position 的 patch 或 overlay（那归其装配方，§1.4.2/§6.4）；不写公司目录。
- **导出/依赖**：`createCapabilityMounter`；contract + Node fs/path；不 import execa、不 import dsh。
- **IO/注入**：fs；挂载点是调用方给的结构（不是适配器自己推路径）；时间注入。
- **状态/并发**：`mount/unmount` 幂等；同一 mountPoint 重复挂载返回既有回执或 `rejected_state`（取哪一
  种需 80 明确）；卸载前检查无在途（由调用方给结论，本文件不自判）。
- **错误/观测**（`Err`，两轴见 §1.6）：宿主不认 →
  `failure:'unsupported', category:'EVOLVE_REJECT'`；路径越界 `subcause:'capability/path-escape'`
  （`failure` 归 `rejected_forbidden`，待 80 确认，§七-3）；状态不符 →
  `failure:'rejected_state', category:'EXTERNAL_REJECT'`。重复挂载返回既有回执还是 `Err` 待 80 明确
  （属 §七-1 的接口缺口），确认前不得两种都做。
- **测试与证据**：`test/capability/install-mount.test.ts` 的后半：挂载可见性、卸载、越界、重复挂载、
  不改宿主其他文件。
- **规模/迁移**：目标 ≤170 行。

#### F-adapters-cap-probe

- **路径/处置**：`packages/adapters/src/capability/probe.ts`；**目标-新增**。
- **归属/上位**：80-§6.5 `TS-PORT-CAP-04`；78-§13.2 负向探针、78-§2.5（`--dump-config` 不等于行为）。
- **职责**：`createCapabilityProbe(deps)` → `{ probe(id) }`：回答“挂载后宿主是否真的看见并加载”；
  `ProbeReport` 必须写“证明了什么/没证明什么”。deps 注入观测手段（宿主日志/运行时暴露/一次性探针命令），
  本文件不假定 DSH 有某种探针。
- **非职责**：不把配置回显当行为证据；不可探测 → `Err(unverified)`，**不是** `false`；不激活。
- **导出/依赖**：`createCapabilityProbe`；contract；不 import execa（具体探测命令由注入的 runner 执行）。
- **IO/注入**：只读观测（日志/端点/一次性子进程经注入的 runner）；无写。
- **状态/并发**：无状态；每次 probe 重新取观测，不复用上次结论。
- **错误/观测**（`Err`，两轴见 §1.6）：机制不可用/无观测者 →
  `failure:'unverified', category:'EVOLVE_REJECT'`；未挂载 →
  `failure:'rejected_state', category:'EXTERNAL_REJECT'`；宿主不提供该观测面 →
  `failure:'unsupported', category:'EVOLVE_REJECT'`。
  报告不得把“未证”写成“支持”。`ProbeReport` 目前只有“证明/未证明”的语义要求，**最小字段集未定义**
  （§七-10），实施前回写 80，本文件不私造字段名。
- **测试与证据**：`test/capability/probe-activate-retire.test.ts`：有观测→report 含 proved/not-proved；
  无观测→`unverified`；配置回显不算证明（用一个只回显配置的 runner 断言 unverified）。
  V5 探针设计；**未执行任何真机探针**。
- **规模/迁移**：目标 ≤160 行。

#### F-adapters-cap-activate

- **路径/处置**：`packages/adapters/src/capability/activate.ts`；**目标-新增**。
- **归属/上位**：80-§6.5 `TS-PORT-CAP-05`；77-§4.8 十三态、§4.9 H0a–H4（**只引用，不预认任何级**）；
  76-§3.12（授权另判）。
- **职责**：`createCapabilityActivator(deps)` → `{ activate(id,basis) }`：在“已安装+已挂载+已探测通过”
  的前提下记录“这版能力开始被使用”；产出激活回执。
- **非职责**：**不是**权威激活（`TS-PORT-AUTH-03`）；不判资格（`TS-PORT-WORK-08`）；不签发权限；
  不因“安装成功”自动激活；不把本回执当作 H0a–H4 任何一级的证据（级别判据归 77-§4.9）。
- **导出/依赖**：`createCapabilityActivator`；contract。回执是端口返回值，**不属于 80 的 50 类 REC**
  （§七-2）；原稿“经注入的 `RecordWriter` 形状”一句撤销——不改用记录写入冒充回执，也不得 import store。
- **IO/注入**：无 fs/网络；时间/ID 注入（供回执与幂等键）；回执由本端口返回，持久化由 daemon/store
  决定（不在本文件）。
- **状态/并发**：幂等键待 80（候选：`(capabilityId, packageDigest, basis.version)`）；重复激活返回同一回执
  或 `Err(rejected_state)` 需明确；不做跨进程围栏（fencing 归 `TS-PORT-AUTH-04`）。
- **错误/观测**（`Err`，两轴见 §1.6）：未挂载/未探测 →
  `failure:'rejected_state', category:'EXTERNAL_REJECT'`；未授权 →
  `failure:'rejected_authority', category:'EXTERNAL_REJECT'`。回执落盘失败 ⇒ `failure:'unverified'`
  （不得报 `Ok`，也不得回滚冒充“未激活”——事实是“可能已激活、回执未证”）。
- **测试与证据**：`test/capability/probe-activate-retire.test.ts`：前置不满足拒收、成功回执、
  回执落盘失败时按 `unverified` 报、重复激活。V2；**不证明**真实宿主生效。
- **规模/迁移**：目标 ≤180 行。

#### F-adapters-cap-retire

- **路径/处置**：`packages/adapters/src/capability/retire.ts`；**目标-新增**。
- **归属/上位**：80-§6.5 `TS-PORT-CAP-06`；75-D75-12（默认交接、不假定热更）；77 段边界/交接；
  78-§1.5（退役、替代与回退）。
- **职责**：`createCapabilityRetirer(deps)` → `{ retire(id,plan) }`：按退役计划执行“暂停→保全→冻结旧写者→
  交接→卸载/挂载移除”；在途未交接则拒收；产出退役回执（字段待 80）。
- **非职责**：不删历史/记录/承诺；不把“需求退役”当“已卸载”；不自行决定接手人（由 plan 给）。
- **导出/依赖**：`createCapabilityRetirer`；contract；可注入 `inFlightChecker`（“有无在途”的判定由
  调用方给结论，本文件不自判）。退役回执是端口返回值，**不属于 80 的 50 类 REC**（§七-2），
  不以注入的记录写入冒充回执。
- **IO/注入**：经注入端口；不直接碰 fs/进程；时间/ID 注入。
- **状态/并发**：`retire` 幂等（同 plan 重复调用返回既有回执或 `Err(rejected_state)`）；有活 worker →
  `failure:'rejected_forbidden'`；在途未交接 → `failure:'rejected_state'`。
- **错误/观测**（`Err`，两轴见 §1.6）：在途未交接 → `rejected_state`/`EXTERNAL_REJECT`；有活 worker →
  `rejected_forbidden`/`EXTERNAL_REJECT`；部分完成（卸载成功但回执未落）→ `failure:'partial'`
  （`category:'STALL'`，草案，§七-4），必须显式，不得静默“已退役”，也不得报 `Ok`。
- **测试与证据**：`test/capability/probe-activate-retire.test.ts`：在途拒收、交接后成功、重复调用、
  历史不被删除（只追加记录）。
- **规模/迁移**：目标 ≤180 行。

#### F-adapters-cap-index

- **路径/处置**：`packages/adapters/src/capability/index.ts`；**目标-新增**。
- **归属/上位**：80-§6.5 六端口的包内汇总；包根 `index.ts` 的一个导出段。
- **职责**：汇总导出六个工厂与其 deps 类型；不实现逻辑。
- **非职责**：不做装配（谁注入 fs/记录/时钟由 daemon assembly 决定）；不默认启用。
- **导出/依赖**：只相对导入六个兄弟文件；零 IO。
- **状态/错误**：N/A。
- **测试与证据**：由六个 capability 测试间接覆盖导出面；包根导出面变更需同步 daemon 装配（目标新增
  `apps/daemon/src/assembly/api` 之外的能力装配位，属 81-files/17，不在本附录展开）。
- **规模/迁移**：目标 ≤40 行。

---

## 三、测试、夹具与测试基建

### 3.1 现有测试件（14 件）逐件

> 共同边界：所有 spawn 测试都用 `node test/fake-cli/fake-cli.mjs` 作为“假 CLI”，用真实
> `execa`/真实子进程/真实临时目录；**不是**真实 dsh/claude/codex/kimi。测试绿只证明本仓在当前
> 平台上的行为契约，不证明宿主能力、跨平台或真机语义（75-D75-15、81-§四）。

#### F-adapters-test-agentconfig

- **路径/处置**：`test/agentconfig.test.ts`（424 行）；**目标-保留**。
- **覆盖**：`loadAgentConfig` 四态（parse 带行号 / missing-section / shape / no-executors）与合法全文、
  书写序、空条目、strictObject 未知键；`wireRegistry` 的 cmd 覆盖、未知 executor、cap-drift、双 default；
  `dshModelFromPatches` 合法/缺省/坏形状；C3 端到端（agent.yaml 声明 → 工厂 → `ResultStats.model`）；
  `registerBuiltins` overrides 与重复注册拒收。
- **fake 边界**：用 fake CLI 的 `FAKE_VERSION` 验证 cmd 注入到达适配器；不启动真实 CLI。
- **不证明**：真实 `agent.yaml` 与 docs/17-§4 示例的兼容性（文件头已记文档疑点：`dsh_home` 词汇、
  `session_resume` 示例值）；不证明模型声明与 dsh 实际 profile 一致。
- **证据层**：V2。迁移：不拆（<600）；若新增档位/judge 语义，进 `test/agentconfig-*.test.ts` 或子目录。

#### F-adapters-test-agentconfig-judge

- **路径/处置**：`test/agentconfig-judge.test.ts`（137 行）；**目标-保留**。
- **覆盖**：`-judge` 后缀冻结、四家族提取、非 judge/未知家族、`judgeAwareResolver` 复用家族工厂并改名、
  非 judge 透传 base、judge 路不经 base、`wireRegistry` 收 judge 位、judge 位禁 default。
- **fake 边界**：只构造适配器与注册表，不起子进程；不测真实判断调用。
- **不证明**：judge 位低档模型是否真的在 DSH profile 中生效；judge 输出质量/独立性。
- **证据层**：V2。迁移：不拆。

#### F-adapters-test-agentconfig-tier

- **路径/处置**：`test/agentconfig-tier.test.ts`（179 行）；**目标-保留**。
- **覆盖**：`-high/-mid/-low` 后缀、四家族×三档、裸名/未知家族/裸后缀/judge 名不误判、正反函数互逆、
  `tierAwareResolver` 的 cmd+patches 透传、judge 位丢 patches 的语义差、档位可标 default、与 judge 共存。
- **fake 边界**：同 judge；只测解析与工厂，不测真实模型路由。
- **不证明**：档位与实际模型价目/能力对应；`ModelTier` 三档在 DSH 的可表达性。
- **证据层**：V2。迁移：不拆。

#### F-adapters-test-claude

- **路径/处置**：`test/claude.test.ts`（568 行）；**目标-保留**（接近阈值，新增用例进子目录）。
- **覆盖**：能力五项；全链 launch→stream→resultStats（result-success）；二次消费拒；kill 无终态面
  （result 未到）；kill 幂等；孙进程整树杀冒烟；detect 三态（≥/</解析失败/未安装）；launch 参数注入
  （预算帽/续跑/append 旗标）；AGENTS.md 通道与版本降级；credentials 透传；estimate；parseLine 等价。
- **fake 边界**：fake CLI + 手工夹具；`CLAUDE_CONFIG_DIR` 是拟稿变量，测试只证明“适配器按拟稿注入”。
- **不证明**：真实 claude 的 result JSON 形态、版本门槛真实行为、append 文件语义、成本可信度。
- **证据层**：V2；V5 未执行。迁移：不拆（568<600）。

#### F-adapters-test-codex

- **路径/处置**：`test/codex.test.ts`（541 行）；**目标-保留**。
- **覆盖**：能力五项；全链；失败面 `turn.failed` 无 usage + error 挂载；kill 无终态/幂等；孙进程冒烟；
  detect；launch 参数（`exec --json`/`--resume`）；AGENTS.md env 拟稿；credentials；estimate；parseLine。
- **fake 边界**：手工夹具；`--resume` 旗标形与 `CODEX_*` 变量均为拟稿。
- **不证明**：续跑旗标/子命令真实形态、`CODEX_HOME` 目录语义、append 通道存在性、成本折算。
- **证据层**：V2；V5 未执行。迁移：不拆。

#### F-adapters-test-dsh

- **路径/处置**：`test/dsh.test.ts`（实测 732 行；`lineBaseline` 记 785）；**目标-拆分并退役旧路径**。
- **覆盖**：P01 全链、parseLine 等价、二次消费拒；四桶/model；任务串注入（`--` + briefPath 全文）与
  不可读报错；遥测红线；P08 kill 面（空 final/无 turn_end/exit 0）；kill 幂等；A4/P04 失败分类
  （errorCode 结构位）；孙进程整树杀三面；detect（未安装/空 PATH/未锁版本）；estimate（含不可读地板价）；
  `resumeWithSession`（argv/空串/未知 id）；credentials；AGENTS.md 已拆出。
- **fake 边界**：golden 来自真实 dsh 0.2.0-rc.2 实录（docs/31），但回放是 fake CLI；`DSH_FAKE_*` 折算
  是测试通道，不是生产行为。测试按环境自适应断言 seatbelt（嵌套/非嵌套）。
- **不证明**：dsh 新版本行为、真实网络/凭证有效期、真实宿主 RPC、跨平台；kill 面只证明信号链，不证明
  孙进程一定被系统回收。
- **证据层**：V2 + 部分 V4。**拆分后目标**：6 个 `test/dsh/*.test.ts` + 共享 helper（§3.2/§3.4）。
  迁移时逐个 `describe` 搬移，断言不改；旧 `test/dsh.test.ts` 在 6 文件全绿后退役。
- **基线事实**：`lineBaseline` 记录 785 而行数实测 732——基线是上界，当前不违规；按“只减不增”可在
  拆分提交里一并把该条目除名，无需提案。

#### F-adapters-test-dsh-agents-md-channel

- **路径/处置**：`test/dsh-agents-md-channel.test.ts`（163 行）；**目标-保留**。
- **覆盖**：user_level/append 都注 `STUDIO_NEXT_INSTRUCTIONS`；native 不注；宿主 env 串扰负向（native 时
  仍 `<unset>`）与正向（user_level 时注入值胜出）；旧证伪变量零注入。
- **fake 边界**：fake CLI 回显点名 env；不挂 dsh-bridge 插件，不证明插件真的消费该 env。
- **不证明**：`packages/dsh-bridge` 的注入效果（归 81-files/12）；DSH 原生 AGENTS.md 发现路径。
- **证据层**：V2。迁移：保留原位（与 dsh 拆分子域可并存）。

#### F-adapters-test-dsh-env-whitelist

- **路径/处置**：`test/dsh-env-whitelist.test.ts`（197 行）；**目标-保留**。
- **覆盖**：`filterWorkerEnv` 允许集/丢弃/undefined；credentials 键域封闭枚举的拒收（含注入高危键）；
  枚举内键真透传；负样本：宿主 `FAKE_SECRET/NODE_OPTIONS` 在子进程不可见（键名全貌断言）。
- **fake 边界**：fake CLI 的 `FAKE_ECHO_ENV_KEYS` 只打键名不打值；探测面是子进程 env，不是 OS 隔离。
- **不证明**：读域/网络/进程隔离；其他三家的 env 收口（当前未做）。
- **证据层**：V4（安全负断言）。迁移：保留原位。

#### F-adapters-test-dsh-judge

- **路径/处置**：`test/dsh-judge.test.ts`（99 行）；**目标-保留**。
- **覆盖**：`writeRootsOverride` 使 workspace 不入写域（只读档）、profile 落工作区外；缺省写域对照。
- **fake 边界**：检查生成的 profile 文本与落盘位置；**不执行** sandbox（编译/apply 面归 seatbelt 套件）。
- **不证明**：judge 派发真的只读；profile 编译/生效。
- **证据层**：V2。迁移：保留原位。

#### F-adapters-test-fake-cli

- **路径/处置**：`test/fake-cli.test.ts`（84 行）；**目标-保留**。
- **覆盖**：harness 自身（fixture 逐字节、退出码、挂起可杀、`FAKE_REQUIRE_TASK` 三种任务形态）。
- **fake 边界**：它测的是测试基建，不是生产适配器。
- **不证明**：任何真实 CLI 行为；harness 未覆盖的旋钮（`FAKE_WIRE_*`/孙进程/`FAKE_ECHO_*`）由各适配器
  套件间接覆盖。
- **证据层**：不适用（测试基建自检）。迁移：保留。

#### F-adapters-test-kimi

- **路径/处置**：`test/kimi.test.ts`（662 行，`lineBaseline`）；**目标-拆分并退役旧路径**。
- **覆盖**：能力五项；全链 + wire 合流；wire 三面明示（缺失/无 usage/无 turn_end）；kill 无终态/幂等；
  孙进程冒烟；detect；launch 参数（`-p`/`-S`）；AGENTS.md env；credentials；estimate；伴生状态守卫；
  `sumWireUsage` 与 `parseKimi` 口径一致。
- **fake 边界**：`FAKE_WIRE_DIR` 在正常退出前落 wire；真 kimi 的时点/路径未证。
- **不证明**：`-S` 旗标、wire 路径约定、“逐轮求和=turn 总账”假设、`-p` 与模式互斥（fake 无法测）。
- **证据层**：V2。**拆分后目标**：4 个 `test/kimi/*.test.ts`（§3.2）。

#### F-adapters-test-registry

- **路径/处置**：`test/registry.test.ts`（302 行）；**目标-保留**。
- **覆盖**：registerBuiltins 一行四家、list/resolve/dup-register/dup-default、第五家平等注册、空表、
  快照隔离；能力矩阵（续跑/预算/成本/取消/组合/无解）；default 语义（default 也过滤、回退首位、晚注册
  default 胜出、overrides 改写）。
- **fake 边界**：第五家用假适配器对象，只测路由，不测执行。
- **不证明**：能力声明的真实性（声明是代码常量，测试不验证宿主实测）。
- **证据层**：V2。迁移：保留；新增能力解析测试不得改本文件语义。

#### F-adapters-test-seatbelt

- **路径/处置**：`test/seatbelt.test.ts`（322 行）；**目标-保留**。
- **覆盖**：profile 骨架/参数化/同参同文/网域缺省与空集/域名拒收/读域零收口回归网/SBPL 转义；
  argv 包装/文件名唯一；SBPL 编译三形态（darwin 且有 sandbox-exec 时）；dsh 接线（缺省/off/非法 mode/
  auto 落盘/auto+detect 嵌套 fail-closed）。
- **fake 边界**：编译面在**当前会话**执行；嵌套环境预期 `status=71`，测试按环境自适应，两种环境都断言
  fail-closed，不伪造绿。
- **不证明**：写域真的挡住越界写（需要未沙箱真机 apply 面 + 负向写探针）；读域/网络/进程隔离。
- **证据层**：V4（部分）。迁移：保留。

#### F-adapters-test-streams

- **路径/处置**：`test/streams.test.ts`（378 行）；**目标-保留**。
- **覆盖**：dsh 六份 golden（P01/P04/A4/P05/P07/P08）逐行归一、四桶、空桶、kill 无 turn_end；
  `extractDshSessionId`；claude 成功/失败；codex 成功/失败；kimi wire 合并/缺 wire；畸形行容错、
  BOM/CRLF、旧 dsh 形态证伪、真机形态降级分支、五枚举 reason、未知类型、空文本。
- **fake 边界**：纯文本解析，无进程/文件。
- **不证明**：真实 CLI 输出格式稳定性；dsh 以外夹具为手工构造。
- **证据层**：V2（契约标尺）。迁移：保留。

### 3.2 拆分后的 dsh/kimi 测试（10 件，目标-新增）

| F-ID | 目标路径 | 迁入内容 | 规模预算 |
|---|---|---|---|
| F-adapters-test-dsh-stream-golden | `test/dsh/stream-golden.test.ts` | P01 全链、事件序列、resultStats 基础账、parseLine 等价、二次消费、session-id 捕获 | ≤240 |
| F-adapters-test-dsh-accounting | `test/dsh/accounting.test.ts` | 四桶归并、判负线⑤、部分桶、无桶不编造、model 注入 | ≤150 |
| F-adapters-test-dsh-launch | `test/dsh/launch.test.ts` | 任务串注入/不可读、`--` 分隔、遥测红线两向、credentials、estimate 两态 | ≤200 |
| F-adapters-test-dsh-lifecycle | `test/dsh/lifecycle.test.ts` | P08 kill 面、kill 幂等、已退出不重复杀、宽限升级、孙进程三面 | ≤220 |
| F-adapters-test-dsh-failure-classes | `test/dsh/failure-classes.test.ts` | A4/P04 errorCode、message 原文、零账、未知 session id 空流即败 | ≤130 |
| F-adapters-test-dsh-detect-resume | `test/dsh/detect-resume.test.ts` | detect 三态、空 PATH、未锁版本 gap、`resumeWithSession` argv/空串 | ≤160 |

- **拆分纪律**：只搬不改断言；每个文件独立可跑；共享 helper 进 `test/support/`（§3.4），不得复制
  `makeBrief/withFakeEnv`。旧 `test/dsh.test.ts` 在 6 文件全绿、无引用后退役。
- **fake 边界与不证明**：与 F-adapters-test-dsh 相同，逐文件继承；拆不改变证据强度。

| F-ID | 目标路径 | 迁入内容 | 规模预算 |
|---|---|---|---|
| F-adapters-test-kimi-stream-wire | `test/kimi/stream-wire.test.ts` | 全链、wire 合流、三面明示、二次消费 | ≤240 |
| F-adapters-test-kimi-kill | `test/kimi/kill.test.ts` | kill 无终态（wire 缺失）、幂等、孙进程冒烟 | ≤150 |
| F-adapters-test-kimi-launch-detect | `test/kimi/launch-detect.test.ts` | detect 三态、argv（`-p`/`-S`）、AGENTS.md、credentials、estimate | ≤200 |
| F-adapters-test-kimi-anchors | `test/kimi/anchors.test.ts` | 伴生状态守卫、parseLine 等价、`sumWireUsage` 口径锚 | ≤120 |

- 旧 `test/kimi.test.ts` 在 4 文件全绿后退役；证据强度不变。

### 3.3 新增能力包与错误两轴测试（4 件，目标-新增；当前零实现）

| F-ID | 目标路径 | 覆盖 | 不证明 |
|---|---|---|---|
| F-adapters-test-cap-resolve | `test/capability/resolve.test.ts` | 需求→候选、空结果、版本过滤、非法需求（`Err` 两轴）、不越权到资格/授权 | 候选真实可承载 |
| F-adapters-test-cap-install-mount | `test/capability/install-mount.test.ts` | 安装幂等/并发同 key/路径逃逸/符号链接/仅 TS 包拒收/不执行包内脚本；挂载/卸载/越界/重复；`path-escape` 带 `failure` 而非只有 subcause | 宿主真的看见包 |
| F-adapters-test-cap-probe-activate-retire | `test/capability/probe-activate-retire.test.ts` | 有/无观测两态、配置回显不算证明、前置不满足、回执落盘失败按 `unverified`、在途拒退、历史不删 | 真机生效与真机探针 |
| F-adapters-test-error-classification | `test/error-classification.test.ts` | 构造错两轴断言（`failure`+`category`+`subcause` 并存、`failure` 是下划线原值）；`Err` 可达 `category` 不含 5 个内部域（`GATE_FAIL`/`WORKER_DEAD`/`QA_BACK`/`DISPATCH_FAIL`/`LLM_FAIL`）；adapters 不产 `rejected_*` 返回值；gap 不是失败类 | 分类归属的真值（运行期 `unavailable`/`partial` 待 80 确认，§七-4） |

- **fake 边界**：用临时目录、内存候选表、假记录写入器；不装真实 DSH 插件、不联网、不执行能力包代码。
- **证据层**：V2（机械契约）+ V4（路径/幂等/失败）；V5（真机探针）**未执行**。
- **错误两轴测试的边界**（≤120 行）：只锁“两轴同时存在 + 可达 `category` 集合 + 不自造 failure 词表”，
  分类归属细节在 80 确认前**不锁**（否则会锁死草案，违背 §七-4）。

### 3.4 共享测试基建（2 件，目标-新增）

#### F-adapters-test-support-env

- **路径/处置**：`test/support/env.ts`；**目标-新增（测试基建）**。
- **职责**：`withFakeEnv(kvs, fn)`：临时注入进程 env、`FAKE_* → DSH_FAKE_*` 折算、`finally` 还原；
  供 dsh/kimi 拆分测试共享（现有 `dsh.test.ts:81-115` 的 helper 原样迁入）。
- **非职责**：不启动进程、不断言业务；不隐藏未还原的键（必须 finally）。
- **测试/证据**：自身不再单测（被 10 个拆分测试使用）；若还原逻辑变更，须在至少一个 dsh 测试里加
  回归断言。**不证明**生产 env 行为。

#### F-adapters-test-support-brief

- **路径/处置**：`test/support/brief.ts`；**目标-新增（测试基建）**。
- **职责**：`makeBrief(overrides)`、`makeWorkdir()`、`BRIEF_TEXT`：临时工作区、任务书落盘、`TaskBrief`
  构造（与现有 `dsh.test.ts:63-79` 同形）；供 dsh/kimi 测试共享。
- **非职责**：不构造真实装配管线产物；不写 AGENTS.md 内容（由用例自管）。
- **测试/证据**：被拆分测试使用；不单测。**不证明**真实任务书格式。

### 3.5 测试基建：fake CLI harness（2 件，保留）

#### F-adapters-test-fake-cli-harness

- **路径/处置**：`test/fake-cli/fake-cli.mjs`（196 行）；**仅测试**，目标-保留。
- **职责**：可配置假 CLI：`FAKE_FIXTURE/FAKE_EXIT/FAKE_HANG/FAKE_DELAY_MS/FAKE_SIGTERM_EXIT/
  FAKE_VERSION/FAKE_REQUIRE_TASK/FAKE_ECHO_ARGS/FAKE_ECHO_ENV/FAKE_ECHO_ENV_KEYS/FAKE_WIRE_DIR/
  FAKE_WIRE_FIXTURE/FAKE_GRANDCHILD_PID_FILE/FAKE_GRANDCHILD_IGNORE_TERM`；`DSH_FAKE_*` 入口折算。
- **非职责**：不模拟真实协议语义，只控制“输出什么、怎么退、挂不挂、写不写 wire、派不派孙进程”。
- **IO/状态**：stdout 同步写；按旋钮写 wire/pid 文件；信号处理仅 `FAKE_SIGTERM_EXIT` 与孙进程；
  EPIPE 静默退出。
- **错误/观测**：`main().catch` 写 stderr 并 exit 1；`FAKE_VERSION` 短路优先；`FAKE_REQUIRE_TASK` 次之。
- **不证明**：任何真实 CLI 行为；它是测量工具，不是被测对象。
- **规模/迁移**：196 行，目标 ≤250；新增旋钮必须同步 README。

#### F-adapters-test-fake-cli-readme

- **路径/处置**：`test/fake-cli/README.md`（83 行）；**仅测试文档**，目标-保留。
- **职责**：列出全部旋钮、场景示例、边界语义（短路顺序、wire 只在正常退出写、孙进程孤儿语义）。
- **非职责**：不是产品文档，不是能力声明。
- **测试/证据**：与 harness 行为一致性靠 `test/fake-cli.test.ts` 与各适配器套件；文档漂移不得当成能力。
- **规模/迁移**：目标 ≤120 行；旋钮增删同单更新。

### 3.6 夹具（14 件，全部仅测试、目标-保留）

| F-ID | 路径 | 来源/形态 | 服务场景 | 被谁消费 | 证明什么 | 不证明什么 |
|---|---|---|---|---|---|---|
| F-adapters-fx-dsh-p01 | `fixtures/dsh/P01-真成功流.ndjson` | dsh 0.2.0-rc.2 真机实录（docs/31 P-01），11 行 | 八类事件全成功流 | streams/dsh 测试 | 该版本该次运行的形态可被归一 | 其他版本/其他 provider 同形 |
| F-adapters-fx-dsh-p04 | `fixtures/dsh/P04-错误凭据.ndjson` | 真机实录（P-04），脱敏 cwd，9 行 | `errorCode=AUTH`、usage 全 0 | streams/dsh 测试 | 失败分类结构位 | 真实 401 的稳定性 |
| F-adapters-fx-dsh-p05 | `fixtures/dsh/P05-续跑.ndjson` | 真机实录（P-05），11 行 | `turn:2`、cache_read 命中 | streams/dsh 测试 | 续跑流可留证 | cwd 约束/长期缓存行为 |
| F-adapters-fx-dsh-p07 | `fixtures/dsh/P07-AGENTS通道.ndjson` | 真机实录（P-07），11 行 | 原生 AGENTS.md 发现 | streams 测试 | 输出标记可归一 | 插件通道（`STUDIO_NEXT_INSTRUCTIONS`）效果 |
| F-adapters-fx-dsh-a4 | `fixtures/dsh/A4-无凭证.ndjson` | 真机实录（A4），9 行 | `MISSING_CREDENTIAL`、step 无 usage | streams/dsh 测试 | 失败分类第二位 | 其他错误码 |
| F-adapters-fx-dsh-p08 | `fixtures/dsh/P08-kill面.ndjson` | 真机实录（P-08），7 行 | 空 final、无 turn_end、exit 0 | streams/dsh 测试 | “kill 面无终态”的判据 | 所有 kill 场景 |
| F-adapters-fx-claude-success | `fixtures/claude/result-success.jsonl` | **手工构造**，6 行 | result success + usage | streams/claude 测试 | 解析器对声明形态的处理 | 真实 claude 输出 |
| F-adapters-fx-claude-error | `fixtures/claude/result-error.jsonl` | **手工构造**，6 行 | `is_error=true` | streams/claude 测试 | completed=false 映射 | 真实错误形态 |
| F-adapters-fx-claude-killed | `fixtures/claude/killed-no-result.jsonl` | **手工构造**，6 行 | 无 result 终态 | claude 测试 | kill 无终态 | 真实半程被杀输出 |
| F-adapters-fx-codex-completed | `fixtures/codex/turn-completed.jsonl` | **手工构造**，8 行 | turn.completed.usage | streams/codex 测试 | tokens 归一口径 | 真实 codex 输出 |
| F-adapters-fx-codex-failed | `fixtures/codex/turn-failed.jsonl` | **手工构造**，4 行 | turn.failed 无 usage | streams/codex 测试 | 失败面无 usage | 真实失败文案 |
| F-adapters-fx-codex-killed | `fixtures/codex/killed-no-turn.jsonl` | **手工构造**，6 行 | 无 turn 终态 | codex 测试 | kill 无终态 | 真实半程输出 |
| F-adapters-fx-kimi-stdout | `fixtures/kimi/stdout-basic.jsonl` | **手工构造**，6 行 | stdout 无 usage | streams/kimi 测试 | claude 同构解析 | 真实 kimi stdout |
| F-adapters-fx-kimi-wire | `fixtures/kimi/stdout-basic.wire.jsonl` | **手工构造**，7 行 | 两条 usage 逐轮值 | streams/kimi 测试 | 求和与挂载口径 | 真实 wire 路径/时点/格式 |

- **处置**：全部目标-保留；**不新增夹具**——能力包测试用临时目录/内存假件，不引入第二个夹具体系。
- **纪律**：夹具头注释不得被当作能力声明；手工夹具不得在文档里改称“真机实录”。

---

## 四、配置与文档性配置

#### F-adapters-package-json

- **路径/处置**：`packages/adapters/package.json`（22 行）；**目标-保留 + manifest 内容修改**（不改锁）。
- **现有事实**：`name=@studio-next/adapters`、`version=0.1.0`、`private:true`、`type:module`；
  `main`/`exports["."]` 指向 `./src/index.ts`；scripts `typecheck`（包级 `tsc -p`，覆盖 src+test）与
  `test`（`vitest run`）；deps：`@studio-next/contract`、`execa ^10.0.0`、`simple-git ^3.27.0`、
  `yaml ^2.0.0`、`zod ^4.0.0`。**无** `license`、无包内 README/LICENSE（79-§6.5 已记录全仓同类事实）。
- **非职责**：不是发布清单（不切 dist）、不定义运行时权限、不承载秘密。
- **目标处置**（逐项，来源均为 79）：
  1. 删除 `simple-git`（79-§10.1 第 3 项：零 import 的死依赖）；
  2. `yaml` 下限与 company/core 对齐为 `^2.6.0`（79-§10.2 的目标 manifest 示意，非本附录自定版本）；
  3. 保留 `exports` 指向 `src`（79-§6.5：adapters 不在 dist 闭包）；
  4. 若未来某个能力包/宿主插件需要本包分发，必须先走 79-§6.1 的依赖闭包与 §7 发布面，不在本单顺手改。
- **IO/错误/状态**：N/A（清单）。
- **测试与证据**：`bun install` 后 `typecheck` + 包测试；不得把 `bun install` 通过当成行为证据。
- **规模/迁移**：目标 ≤30 行；一项依赖变更单独提交（79-§10.4）。

#### F-adapters-tsconfig

- **路径/处置**：`packages/adapters/tsconfig.json`（5 行）；**目标-保留**。
- **现有事实**：`extends ../../tsconfig.base.json`；`include: ["src/**/*.ts","test/**/*.ts"]`。
- **归属/上位**：79-§1.3/§4.4；根 `tsconfig.json` 的 `include` 只覆盖 `packages/*/src/**/*.ts`，
  测试类型由本包脚本负责。
- **非职责**：不发射产物、不定义 paths、不建 project references（79-§6.4 默认不引）。
- **目标**：保持；拆出 `src/dsh/` 与 `src/capability/` 后无需改 include。**不新增** `tsconfig.build.json`
  （adapters 不切 dist；若未来切换，按 79-§4.4 三处同步 + 根 typecheck 串接，属另一提案）。
- **IO/错误/状态**：N/A。
- **测试与证据**：`bun run typecheck`（根）覆盖本包 src；`bun run --filter @studio-next/adapters typecheck`
  覆盖 src+test。**不把 tsconfig 通过当可运行**。
- **规模/迁移**：维持 5 行。

**文档性配置缺口**：本包无 README/LICENSE。79-§6.5 明确：许可文本与公开范围须制作人决定，不得默认沿用
根 MIT；本附录只登记缺口，不新增文件。

---

## 五、迁移、超限清偿与兼容

### 5.1 迁移波次（顺序固定；波次编号归 82，本附录不造 MIG-ID）

1. **W-A 纯文档/类型对齐**：修正 `streams.ts` 的本地 `ExecutorFamily` 与过期注释；不动行为。
   **前置**：本包构造错要写两轴 `failure`，须等 contract 的 `ClassifiedError` 补上 `failure` 字段、
   `configInvalid(...)` 固定双轴（80-§5.7，归 81-files/01）；在此之前 W-A 只改文档/类型，不改构造器调用面。
2. **W-B dsh 拆分**：新增 `src/dsh/` 六件，`src/dsh.ts` 改 facade；`agentconfig.ts`/`index.ts` 的 import
   路径可继续走 facade；全量包测试 + daemon 相关测试必须绿；`lineBaseline` 的 `src/dsh.ts` 条目除名。
3. **W-C 测试拆分**：`test/dsh.test.ts` → `test/dsh/` 6 件 + `test/support/` 2 件；
   `test/kimi.test.ts` → `test/kimi/` 4 件；逐 `describe` 搬移、断言不改；旧两路径退役；
   `lineBaseline` 两条测试条目除名（净减，不需提案）。
4. **W-D manifest 清理**：删 `simple-git`；`yaml` 下限对齐；单独提交、单独验证（79-§10.4）。
5. **W-E 能力包机制件**：先回写 80 的类型与记录归属（§七），再落六个工厂 + 三个测试；在此之前
   **不得**在 daemon 装配里引用它们（未接）。
6. **W-F 四家 env 收口**：以 78-§7.4 的 per-host 键表为前提，单独实现单 + 真机探针；不得与 W-B 混提。
7. **W-G 能力端口接主循环**：归 81-files/17 的 assembly 与 80-§7 的相位；本附录只提供机制件。

每波的验收：`bun run typecheck` + `bun run --filter @studio-next/adapters test` + 受影响的 daemon 测试；
W-B/W-C 还必须跑 `bun run guard:boundaries`（目录/行数/平面）。回退：还原该波提交；facade 与旧测试路径
在 W-B/W-C 期间保持可用，确保可回退。

### 5.2 超限件清偿表

| 旧路径 | 实测行数 | 基线 | 目标 | 清偿后 |
|---|---|---|---|---|
| `src/dsh.ts` | 758 | 758 | 6 子件 + facade ≤60 | 基线条目除名 |
| `test/dsh.test.ts` | 732 | 785 | 6 文件 ≤240 各 | 基线条目除名；旧路径退役 |
| `test/kimi.test.ts` | 662 | 662 | 4 文件 ≤240 各 | 基线条目除名；旧路径退役 |

- 不提高阈值、不把新超限件塞进基线；拆分后 `src/` 直属仍 9 件（facade 占原位），新文件全部进子目录，
  不占平面散件名额（本包无域平面基线，但有 25 件/目录上限）。
- 注意：`test/dsh.test.ts` 的基线值（785）高于实测（732），是历史拆分（AGENTS.md 用例迁出）后的残留；
  按 ratchet 规则可在任一次提交中下调/除名，无需提案。

### 5.3 退役件与调用方清单

| 退役路径 | 调用方（现状） | 替代 | 删除条件 |
|---|---|---|---|
| `test/dsh.test.ts` | 仅 vitest 自动发现；无源码 import | `test/dsh/*.test.ts` | 6 文件全绿且旧文件无引用 |
| `test/kimi.test.ts` | 仅 vitest 自动发现 | `test/kimi/*.test.ts` | 4 文件全绿且旧文件无引用 |

- 生产文件**无退役**：`src/dsh.ts` 以 facade 保留（等价“兼容期”）；删除条件=包内与仓内无 `./dsh.ts`
  引用（当前 `agentconfig.ts:50` 与 `test/dsh-*.test.ts` 仍引用，故不设删除时点）。
- 历史与责任不因文件迁移消失：测试迁移不改变断言含义；若某断言在迁移中被发现错误，单独记录并走修正，
  不得顺手放宽。

### 5.4 兼容面

- 包根导出名不变；`DshAdapter` 构造签名不变；`filterWorkerEnv/assertCredentialKeys` 继续从包根与
  `./dsh.ts` 可达（现有测试依赖）。
- `test/dsh-agents-md-channel.test.ts`、`dsh-env-whitelist.test.ts`、`dsh-judge.test.ts` 保持原位，
  其 `../src/dsh.ts` import 由 facade 满足。
- daemon 侧 `serve.ts`/`judge/invoke.ts`/`tier/model-tier.ts` 零改动。
- **金额形态变化属 contract 端口变更**：`Money{usd:number}` → `DecimalString`+币种 若落定，改的是
  `estimate`/`budgetCap`/`ResultStats.cost` 的签名（01/80），adapters **跟随签名不改自己的语义**；
  本包不因该变更调整 `cost_native:false` 的家（仍恒 0）。
- **错误两轴双写期**：`ClassifiedError` 补 `failure` 后有一段双写期（事件 note 同时带 `failure` 与
  `category`，旧读方继续读 `category`，80-§5.7）；本包的构造错在双写期内两键同写，不得只写 `failure`。
- **`core/secrets` → `contract` 迁移期**：迁移完成前本包不 import `core/secrets`（层位不允许），出站脱敏
  由 daemon 强制点执行；迁移后本包也只按需 import contract 的具名导出，不复制一份实现。

---

## 六、专项回答（81-§5.2 的 adapters 面）

### 6.1 executor / agent loop / 能力包 / 安装 / 挂载 / 资格 / 授权 / 生效的分段

| 段 | 现状 | 目标文件 | 证据与缺口 |
|---|---|---|---|
| 宿主交互面 | 事实线 A（argv/stdin/stdout/env/kill）已实现；B 插件承载不在本包；C 长驻未证 | 现有四文件 + `dsh.ts` | 只有 A 属本包；B 归 `dsh-bridge`（81-files/12），C 未实现（78-§2.2） |
| 进程与沙箱 | 子进程生命周期已实现；seatbelt 写域已实现；读/网/进程隔离不可表达 | `seatbelt.ts`、`dsh.ts` 的 launch/kill | 78-§7.3、`L78-WS-01..03`；不得称「已隔离」 |
| 宿主策略面（工具限制/审批） | 无（`tools.restrict`/`pre-execute`/审批属 B 行） | N/A | 归 dsh-bridge + position 插件；`L78-POS-01` |
| executor 执行 | 四家 CLI shell-out 已实现（execa + 流归一 + kill） | 现有四文件 | V2；真机仅 dsh 有 docs/31 记录 |
| agent loop 形态 | 全部是“一次性 headless 子进程”；无 ACP/SDK/长驻、无中途 steer/followup | N/A（不是本包能力） | 78-§2.2 事实线 C 未证；不得称“热更” |
| 能力解析 | `registry.resolve` 只做名字→实例 | `capability/resolve.ts` | 新建；不能冒充 CAP-01 |
| 安装 | 无 | `capability/install.ts` | 新建；只让包存在，不加载；安装回执**不是 REC-WORK-***（80-§6.5），也不属 50 类 REC（§七-2） |
| 挂载 | 无（现有 overlay 是 dsh-bridge 的上下文注入装配，不是能力包挂载） | `capability/mount.ts` | 新建；挂载≠加载；不得借 overlay 冒充 |
| 加载（宿主注册） | 无（宿主 `agent/created` 行为，属 B 行） | N/A | 加载证据只由探针给；本包不声明「已加载」 |
| 探测 | 无（dsh-bridge 无探针，81-files/12；80-§6.5 原文） | `capability/probe.ts` | 新建；不可探测=未证 |
| 资格 | 不在本包（`TS-PORT-WORK-08` `QualificationPort`） | N/A | 适配器不得自判资格；**开工五门**是另一端口 `TS-PORT-WORK-03` `ReadinessGate`（目标件 `core/src/work-readiness.ts`，**现状无此文件**，80-§7 相位表），纯求值；并发四闸与断路器留 `decide`（core），`repo-validate` 留 `company`——三者都不得下沉到适配器 |
| 授权 | 不在本包（`TS-PORT-AUTH-05` 签发/行使/撤回） | N/A | 授权签发 ≠ 权威激活（`TS-PORT-AUTH-03`）≠ 能力激活（CAP-05）≠ 生效 |
| 生效（权威激活 + 运行时暴露） | 不在本包（`TS-PORT-AUTH-03`） | N/A | 不预认 H0a–H4 任何一级（77-§4.9）；安装/挂载/加载都推不出生效 |
| 能力激活 | 无 | `capability/activate.ts` | 新建；回执是端口返回值，**不属 80 的 50 类 REC**（§七-2），字段待 80 |
| 退役/交接 | 无 | `capability/retire.ts` | 新建；默认交接（D75-12）；回执归属同激活（§七-2） |

- **与 §1.4 的对应**：前两行（宿主交互面、进程与沙箱）是本包**拥有**的边界；“宿主策略面”“加载”
  “资格”“授权”“生效”五行加 `agent loop` 的 C 行是**明确不拥有**的段。表内不得出现「借助 overlay
  或插件注册就视为已安装/已挂载/已生效」的推断。
- **三条不同事实不得合并**（77-§4.9）：能力包安装（本包 `install`）/ 源码 HMR（本仓不存在，
  `packages/*/src` 改动不是能力包）/ agent loop 切换（一次性子进程 → 长驻宿主，事实线 C 未实现）。
  DSH 侧七段（安装/挂载/加载/探测/资格/授权/生效）见 §1.4.4，本表只覆盖其中属本包的机制件。

### 6.2 四家宿主的损失与替代（只列适配器可举证的部分）

| 项 | dsh | claude | codex | kimi |
|---|---|---|---|---|
| 预算帽 | 无（`budget_cap:false`） | 有，单次上限（`--max-budget-usd`） | 无 | 无 |
| 单轮取消 | 无（只能 kill 进程） | 无 | 无 | 无 |
| 成本 | 仅 tokens，cost 恒 0 | 原生 `total_cost_usd` | tokens，cost 恒 0 | tokens（wire 合流），cost 恒 0 |
| 续跑 | `--session-id`，要求 cwd 逐字节一致；真机复验过 | `--resume`（较硬） | `--resume` **拟稿** | `-S` **拟稿** |
| AGENTS.md 通道 | `user_level`（bridge 插件 env），另有原生发现 | `native` ≥2.1.277，低版本降级 append | `native` **拟稿**；env 名自拟 | `native`（实锤），append 变量自拟 |
| 策略面 | 目标有 position 插件；当前仅上下文注入 | 权限模式 + hooks（弱） | 沙箱/审批/AGENTS（文档面） | 模式互斥 + 配置（未证） |
| 遥测 | 已强制 `DISABLED` | 未见适配器处理 | 未见适配器处理 | 未见适配器处理 |
| 替代/损失 | 无网络/进程隔离；不能热更 | 预算不累计；成本自报 | 预算只能事后断路；续跑未证 | wire 假设；`-p` 互斥限制模式 |

- **表内「策略面」一行是宿主原生能力的描述，不是本包实现**：适配器不加载 hook、不注册 tool guard、
  不读 PRM；本包能表达的只有 argv/env（如 `--patch` 由 `agent.yaml` 给出、`STUDIO_NEXT_INSTRUCTIONS`
  由 daemon 注入）。因此四家的策略面差距属于宿主绑定（78）与插件装配（81-files/12），不属于适配器。
- **铁律**：能力声明强度不得超过证据（78-§8.3）。78 已把 **codex 的 `session_resume`/`agents_md`**
  （待探针/拟稿）与 **kimi 的 `session_resume`**（待探针）定为 fail-closed（探针前按“不支持”、PRM 按
  不支持生成）；kimi 的 `agents_md` 在 78 标“实锤（通道细节未证）”，只认这一范围、不得外推为通道已证。
  本包**义务固定为一条**——`detect` 的 `gaps` 明报 `codex-session-resume-unverified`/
  `kimi-session-resume-unverified` 等，让调用方拿不到“已支持”的
  默示；`gaps` 不是失败类，是否拒派由开工五门（`TS-PORT-WORK-03`）与资格（`TS-PORT-WORK-08`）判。
  **剩余裁决**只有“静态声明是否同步降级为 `false`/`'none'`”（§七-6），本附录不擅自改能力声明。

### 6.3 平台状态映射与不可表达项

- `StreamEvent` 只有 `step_start/step_end/turn_end/log` 四种；**没有** session_id、duration、cost 字段
  ——这些由 `resultStats`/`Handle.executorSessionId` 承载，不是协议缺字段（`streams.ts` 头注的旧说法要改）。
- `turn_end.completed` 是执行体自述完成，**不是**验收（78-`L78-DSH-02`）；适配器不判 accepted/settled。
- 宿主词汇里没有：组织/任命/禁配/验收/问责、网络出站、进程隔离、秘密保管、跨进程互斥、权威激活
  （78-§2.3）。适配器不得用 `permit`/`completed`/`session_resume` 冒充这些语义。
- dsh 的 `reason.kind` 五枚举（completed/error/blocked/aborted/max-tokens）中只有 completed 成功；
  其余一律 `completed:false`，即使退出码 0（P08 kill 面）。
- **平台状态映射（`mapState`）不属本包**：该端口是 `TS-PORT-BIND-01`，输入 `BindingProfile`（20 字段）
  与宿主原生状态，输出 `platformState` + `verification` + `workStates`。未映射状态的目标形态是
  `Ok({platformState, verification:'unverified', workStates:[], unmappedBehavior:'observe-unmapped'})`
  并记 `REC-OBS-02`；只有输入为空/畸形才 `Err(failure:'rejected_precondition')`。**`workStates=[]`
  不得用于迁移、验收或结清**（空集不是“全部未开始”）。适配器若被要求喂宿主状态，只回传原始观测，
  不得把未知宿主输出当成功或推断成某个平台态。

### 6.4 DSH 分发形态与 JS+.d.ts

三种分发件分开记，不得互相替代：

| 分发件 | 形态 | 归属 | 本包关系 |
|---|---|---|---|
| `packages/adapters` | `private`、`exports["."] = ./src/index.ts`，不切 dist | 本包 | 本件 |
| DSH 插件本体（context bridge / position） | `dist/index.js` + `.d.ts`，patch 指向 dist（79-§7.2） | `packages/dsh-bridge`（81-files/12） | 零模块边：不 import、不打包、不改 patch；只经 `STUDIO_NEXT_INSTRUCTIONS` 串对接 |
| 能力包（`CapabilityPackage`） | 安装进目标环境后才需 JS + `.d.ts`；仅 TS 入口拒收 | 定义/引用归公司（76-§3.19），机制归本包（归属待 80 确认，§七-11） | `install/mount/probe/activate/retire` 的机制与回执；不为其代码语义背书 |

- 能力包进入「宿主可见范围」≠ 替换插件本体：bridge/position 的 patch 与 overlay 只由其装配方负责
  （daemon + 81-files/12），本包的 `mount` 不得改写它们。
- 适配器不得从 `node_modules` 下 import `.ts`，也不得把「安装成功」写成「加载成功」（D75-07、79-§4.4）。
- `--dump-config`、配置回显、进程重启分别不能冒充“加载成功/插件热更/无损切换”（D75-12、78-§2.5）。

### 6.5 API 与构建影响

- **API**：N/A（本包不实现 HTTP/API）。**目标形态**（现状未落地——`assembly/api/`、`assembly/intent/`
  目录与 `intent_receipts` 投影表均不在仓内；目标形态见 80-§6.6 的 `TS-PORT-API-01`、§3.1/§3.6
  的装配与启动序列、§9.4 的迁移路径）归 81-files/17：
  `apps/daemon/src/assembly/api/assemble.ts` 导出 `assembleApi(deps:{ingress:Pick<IntentIngress,'submit'|'receipt'>; ledgerPath; company; config})`，
  同进程 `runServe`；而 `IntentIngress`/`IntentReceiptStore` 在 `assembly/intent/`，`openLedgerReadonly`
  现构 `issuesView`，落 `intent_receipts` 投影。本附录只作边界引用：适配器不接触这些文件、不新增
  `api→panel`、`boot→api`、`company→panel` 边，也不因 API 装配改变 `ExecutorAdapter` 六方法。
  意图落单链（`IntentIngress.submit` → `WorkIntake.reserve` → 投影 → `engine.ingest`）全在 17，
  不在本包；本包只被 `engine` 在派工相位调用。
- **N/A 三面（都不属本包）**：stdio 工具面（studio-tools）归 81-files/15；`Notification`/
  `NotificationEnvelope` 属通知域（不是执行体事件）；`IntentSubmission`/`ReferralTarget` 属对外 API 与
  转派域（81-files/17）。本包不导出、不依赖、不实现这些类型；`StreamEvent` 也不得被当作通知载荷。
- **构建**：不切 dist、不新增构建文件、不改根 `typecheck` 脚本；包级 `typecheck` 已覆盖 test。
  若未来能力端口需要新的 workspace 依赖（例如 `store` 的记录类型），**不得**由本包直接 import store
  （层位 1 只能到 contract）；记录写入必须经注入的结构端口。

---

## 七、需回写 80/76/77/78 的具体缺口（不在此私造）

1. **80-§6.5**：`CapabilityNeed`、`CapabilityCandidate`、`CapabilityPackage`、`InstallTarget`、
   `InstallReceipt`、`MountPoint`、`MountReceipt`、`ProbeReport`、`ActivationBasis`、`ActivationReceipt`、
   `RetirementPlan`、`RetirementReceipt` 只出现在签名里，**字段集未定义**。本附录不能落可实施契约。
   其中 `CapabilityPackage` 还缺 76-§3.19 已要求的**类型/摘要/来源/许可**四项（`DEF-DEP-02` 的
   `partRef/digest/licenseRef/trustState`），缺了它 `install` 无法按「摘要不符即拒收」落地。
2. **80-§4.4 / §6.5（能力回执的记录归属）**：安装/挂载/探测/激活/退役**五类回执属于哪类记录**未定义——
   80-§4.4 的 50 类 REC 里没有“能力回执”，§6.5 也只说安装回执“不是 REC-WORK-*”。本附录按“回执是端口
   返回值”处理，**不写台账、不冒充记录**；若要落库，需 80 先给记录类型与唯一写入者（daemon），并明确
   失败时回执与记录是否同事务。
3. **80-§5.7 / §6.5（`path-escape` 的 `failure` 归属）**：80 只把 `path-escape` 写成 subcause 词，未给
   对应 `failure`；本附录按“越界=禁做”归 `rejected_forbidden`（缺省 `EXTERNAL_REJECT`），待 80 确认。
   同时确认：`NO_LANE` 只在**显式 lane 上下文**（泳道入口/派工闸）由 daemon 写；能力端口与适配器都
   没有 lane 标识，恒不写 `NO_LANE`。
4. **80-§5.7 / 80-§6.5（无 `Result` 通道时的抛错分类）**：`ExecutorAdapter` 六方法没有 `Result`
   （`contract/src/ports/executor.ts`），本附录只能 `throw ClassifiedError`。80 只给了“构造期/编程错 ⇒
   `rejected_precondition`”一档；运行期两档——伴生状态丢失 `failure:'unavailable'`、部分完成
   `failure:'partial'`（两者缺省 `STALL`）——**仍是草案**，需 80 确认，否则实现无对齐依据。
5. **80-§6.5 / 81-files/01（`planRef`/`fence` 的 contract 落点）**：类型已冻结
   （`planRef?: VersionRef<string>`、`fence?: FenceToken`），可选性与填充时机已在 80-§6.5 说明；但
   `contract/src/ports/{executor,kernel}.ts` **尚无字段**，落点归 81-files/01 的 contract 修订。
   本附录只按该类型只读透传，不造同义字段、不改名、不给默认值。
6. **78-§8.3 与代码的冲突（codex/kimi 静态声明是否降级）**：**codex** 的 `session_resume`（待探针）与
   `agents_md`（拟稿）、**kimi** 的 `session_resume`（待探针）在 78 未给正面证据，代码却静态声明为
   `true`/`'native'`（kimi 的 `agents_md` 78 标“实锤（通道细节未证）”，不在本冲突内）。本附录已定
   fail-closed 的一半：`detect` 必须明报 `*-unverified` gap、PRM 按“不支持”生成；**剩余裁决**只有一条——
   上述静态声明是否同步降级为 `false`/`'none'`（§6.2 铁律），需 78 给结论，本附录不私改。
7. **78-§7.4（per-host 必需键表与 env↔secretId 映射）**：把 deny-by-default env 白名单扩展到
   claude/codex/kimi 需要 per-host 必需键表（claude 的 config/凭据键、codex 的 `CODEX_HOME`、kimi 的
   `KIMI_CODE_HOME` 等），现表只有 dsh；另外 **env 键 ≠ `SEC-<域>-<slug>` secretId**，两者映射表也
   未定义（§1.5），本包不写死。
8. **78-§4.5 / BIND-POS-01（挂载点生成者与唯一写入者）**：能力包安装根与 position 插件的“不可写面”
   关系已给原则，但“挂载点目录由谁生成、谁是唯一写入者”未成字段；`mount.ts` 需要这条才能实现
   containment。
9. **76-§3.18（`DEF-CAP-02.substitutionPolicy`）**：`allow-with-loss-report`/`refuse` 与适配器
   `capabilities` 的对应关系未定义——能力解析返回候选时，损失由谁出（`REC-LOSS-01`）需回写。
10. **80-§6.5（`ProbeReport` 最小字段集）**：现在只有“证明了什么/没证明什么”的语义要求，无字段；
    需给最小字段集（至少：观测手段、证据引用、proved/notProved 清单、时间与宿主版本），否则
    `probe.ts` 无法产出可审计报告。
11. **80-§6.0（CAP 六端口实现归属包）**：未写包名；本附录按“执行面”归入 `adapters`，需 80 确认，
    避免与 `company`（定义包）或 `daemon`（编排）重复归属。
12. **77 段边界 / 78-§7.4.1（事件流脱敏执行点 + secrets 落点）**：`redactOutbound`/
    `redactKnownSecrets`/`findSecretShaped` 现居 `packages/core/src/secrets.ts`，本包层位只能到 contract
    （`boundary-rules.mjs` 允许边仅 `adapters→contract`），**不可 import**；目标整模块迁
    `contract/src/ports/secret.ts`（归 81-files/01），core 只具名 re-export。另需 78 指定“谁在出站前
    强制脱敏”——本附录按 daemon 强制点、adapter 只保证日志不含秘密（§1.5），强制点位置需成文。
13. **80-§4.1 / 81-files/01（金额公共形态）**：`Money{usd:number}` 只留内存与旧记录，公共金额用
    `DecimalString` + 币种；但该改动落在**端口签名**（`estimate`/`budgetCap`/`ResultStats.cost`），
    签名变更归 01/80。本包只保证适配器边界不做浮点运算（§1.8），不改签名。

---

## 八、未核点与未证清单

- **本附录未运行任何测试/服务/真实 CLI**：只做只读源码盘点与 `find`/`wc` 计数。§三的“覆盖”来自测试
  文件的 `describe/it` 与断言阅读，不是执行结果。本轮一致性修订同样**未运行任何命令**（除 `grep`/`wc`
  这类只读静态核查），新增/改写的接口全部是**目标**，不是现状。
- **未证（本轮新增的目标面）**：`ClassifiedError` 尚无 `failure` 字段（`contract/src/schemas/errors.ts`
  现只有 `category/subcause`）；`configInvalid(...)` 未写 `failure`；`core/secrets.ts` 未迁 contract
  （本包仍不能 import）；`TaskBrief.planRef`/`Handle.fence` 字段未落；CAP-01..06 零实现零测试；
  §3.3 新增的 `test/error-classification.test.ts` 与三件能力测试**均未编写、未运行**。
- **未核**：`packages/contract` 之外是否还有其它包对 `adapters` 的隐藏结构依赖（只按 `import` 字面量
  检索了 `apps`/`packages`，未做 AST 级分析）。
- **未证（真机）**：claude/codex/kimi 的任何 CLI 行为；dsh 的真机证据来自 docs/31 的既有实录，未在本轮
  重跑；四家的版本升级行为、错误码稳定性、限流/网络失败面。
- **未证（宿主边界）**：DSH 事实线 C（长驻/ACP/SDK/中途 steer）本仓零实现；B 行的 bridge 仅证明
  源码形态（dist 形态未证，81-files/12 自述）；bridge overlay 落在 `<rootDir>/tmp/`、其与 worker
  `cwd` 的关系未证，若沙箱根覆盖 `tmp/` 则 agent 可改自己的上下文段落（78-§4.5）；position 插件
  整体未实现。四家的原生策略面（hooks/审批/权限模式）均未由本包接入。
- **未证（能力）**：CAP-01..06 零实现、零测试；`ProbeReport` 字段缺失；能力激活/退役的记录归属未定；
  能力包与插件本体的边界（本包只做安装/挂载/探测机制，不改 patch）尚未有实现可验。
- **未证（安全）**：seatbelt 只覆盖文件写域；读域/网络/进程隔离未证；`sandbox-exec` 已 deprecated；
  嵌套沙箱下探测必败（测试按环境自适应，不能据此证明生产可用）。
- **未证（并发/恢复）**：sessions Map 无回收、无跨进程恢复；daemon 重启后伴生状态丢失是已知行为；
  kill 的宽限定时器在父退出后仍可能触发（设计如此，但未做长期压力验证）。
- **未证（构建）**：adapters 未切 dist，因此没有产物级验证；本附录不声称产物可用。
- **文档漂移（已核）**：`streams.ts` 头注称 contract 无 `ExecutorFamily`（实际 `ports/executor.ts:10`
  已有）；`boundary-rules.mjs` 给 `test/dsh.test.ts` 记的基线 785 高于实测 732（基线是上界、当前不违规）；
  `dsh.ts` 头注史遗留的版本叙述需在 W-A 清理；
  `package.json` 的 `description` 写“四原语实现”，而四家适配器实际实现六原语（契约 `ExecutorAdapter`
  六成员）——W-D manifest 清理时一并改文案，不影响依赖。
- **注释不是能力**：`index.ts` 的 TODO、各文件“拟稿/待探针”标注、fake-cli README 都只作线索，未当证据。

---

## 九、对照 81-§六完成判据（不宣称 PASS）

| 判据 | 本附录情况 |
|---|---|
| 1. 现有/目标路径可枚举、可复算 | 现有 41（9+14+2+14+2）；目标 **68**（38 保留+1 替换+**29** 新增，含 §3.3 第 4 件错误两轴测试；2 旧测试路径退役） |
| 2. 每件有内部结构、依赖、IO、错误、测试、迁移 | 生产/测试/配置逐件给出；夹具用表格给来源、消费者、证明/不证明 |
| 3. 目标新增件能回到 76/77/78/80 的 ID | dsh 六件回到 80-§6.5/78-`BIND-DSH-01`；capability 七件回到 `TS-PORT-CAP-01..06`；测试件回到对应端口/文件；错误两轴测试回到 80-§5.7（两轴）与 §1.6 |
| 4. 超限件有拆分清单、未提阈值 | §5.2：`dsh.ts`、`dsh.test.ts`、`kimi.test.ts` 三件；基线只减不增 |
| 5. 无通配端口、无来源 REC、无虚构依赖/能力 | 未新增端口/REC/依赖；能力包类型缺口显式回写，不私造 |
| 6. 现有/目标/未证分清 | 全文标注；fake、夹具、静态声明均未写成真机能力 |
| 7. 覆盖保留/拆分/新增/替换/退役及测试/配置 | §0.3 处置表 + §二～§四逐件 + §5.3 调用方 |
| 8. 政策项与工程选择分开 | 许可/公开范围、codex/kimi 能力声明冲突、env 收口范围列为政策/裁决项，不由本附录代决 |

**边界自检**：§1.4 的四条边界以 78-§0.3（四问）、§2.2（三条事实线）、§2.4（硬/软/不可表达）为唯一基准；
§2.3、§6.1、§6.2、§6.4、§七、§八 均按同一口径书写，不保留第二套说法（“overlay 即挂载”“上下文注入
即策略”“安装即生效”“宿主允许即授权”四类偷换均在文中被显式否定）。

**结论**：本附录只表示“adapters 的逐文件技术设计可提交审查”，不表示实现已批准、能力已验证或全卷通过。
