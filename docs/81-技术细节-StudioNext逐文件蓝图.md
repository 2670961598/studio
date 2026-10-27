# 81 · 技术细节：Studio Next 逐文件蓝图

> 版本：v0.1，2026-10-27。
> 性质：**自然语言级文件与实现设计呈审稿**，不是现行文件树、实现单或完成证明。
> 上位：75 的文件契约；76/77 的公共语义；78 的绑定；79 的工程与依赖；80 的运行时与公共 TS 接口。
> 边界：本卷只把 80 的组件和接口落到文件，**不得新增公共概念、端口、状态、允许边或依赖版本**。发现缺口须回写其主卷，不得在附录私自补一套。
> 门禁：本文所有“目标/新增/拆分/替换/退役”均是设计处置，尚未执行。不得据此直接改生产代码、依赖清单或 guards。

---

## 一、覆盖范围与附录索引

本卷覆盖全部第一方生产源码、公共/构建配置、测试与测试基建、guards、公司模板及目标新增文件。排除 `.git`、`node_modules`、`dist` 与其他生成物、第三方源文件、历史设计文档本身；依赖包的 manifest/LICENSE 只作证据，不展开其源码。

| 附录 | 范围 |
|---|---|
| `81-files/01-contract.md` | `packages/contract` 全部现有件、规范数据、cases 与目标公共语义/TS 绑定 |
| `81-files/02-core.md` | `packages/core` 的纯决策、规则求值、状态机、预算/断路/秘密与测试 |
| `81-files/03-store.md` | `packages/store` 的 SQLite 触点、migration、记录、投影、重建与维护命令 |
| `81-files/04-company.md` | `packages/company` 的定义包/模板/校验/导入/依赖/报表与目标投影 |
| `81-files/05-prompt.md` | `packages/prompt` 的 L0–L5、指纹、裁剪、消毒与测试 |
| `81-files/06-gateway.md` | `packages/gateway` 的凭据、动作、署名与校验 |
| `81-files/07-adapters.md` | `packages/adapters` 的 DSH/Claude/Codex/Kimi、能力包、进程/沙箱与测试 |
| `81-files/08-localplatform.md` | `packages/localplatform` 的文件平台、活动流、生命周期与测试 |
| `81-files/09-yt.md` | `packages/yt` 的 YouTrack 客户端、字段映射、活动流与守卫边界 |
| `81-files/10-taiga.md` | `packages/taiga` 的 Taiga 客户端、传输/映射/测试工具 |
| `81-files/11-matrix.md` | `packages/matrix` 的 Matrix 源、通知、房间与人事面 |
| `81-files/12-dsh-bridge.md` | `packages/dsh-bridge`、上下文桥与目标 position 插件分发形态 |
| `81-files/13-panel.md` | `packages/panel` 的监控/公司概览、只读投影与既有 external 迁出 |
| `81-files/14-api.md` | `packages/api` 的对外 API、HTTP 适配、认证、幂等与意图入口 |
| `81-files/15-studio-tools.md` | `packages/studio-tools` 的内部工具、网关收口、目标 stdio 与证据面 |
| `81-files/16-daemon-engine.md` | `apps/daemon/src/engine/**` 与 `apps/daemon/test/engine/**`，含 tick/域件/测试夹具 |
| `81-files/17-daemon-assembly-cli-control-evolve.md` | `apps/daemon/src/{assembly,cli,control,evolve}/**`、`src/index.ts`、daemon manifest 与对应测试 |
| `81-files/18-boot.md` | `apps/boot` 全部现有件、组合根与注入面 |
| `81-files/19-root-guards-templates.md` | 根配置、guards、公司模板、锁文件与文档性约束；不重写历史文档 |

每个附录先列**现有件全集与目标件全集**，再逐项展开。计数必须能由文件路径复算；不得用“其他”“等等”“略”代替实际文件。

---

## 二、每个文件的统一写法

每个生产文件、测试文件、测试基建、配置与模板文件均有独立条目。字段不必逐字同形，但不得缺少任何一面。

| 字段 | 必须写清 |
|---|---|
| 稳定 ID / 路径 | `F-<包>-<名称>`；目标路径与旧路径分开；拆分后一新一 ID，不 reuse |
| 处置 | 保留 / 拆分 / 新增 / 替换 / 退役 / 仅测试或仅演示；目标迁移顺序 |
| 归属 | 规范/绑定/实现；76/77/78/80 的对应 ID，不以文件名为语义来源 |
| 职责 / 非职责 | 该文件的承诺与不证明什么；不能只写“负责某模块” |
| 内部结构 | 类型、接口、常量、函数/方法；输入输出、必填/可选、空值/默认、版本 |
| 导出与依赖 | 导出符号、允许导入、层位与禁止边；实际 import 与目标 import 分开 |
| IO 与注入 | 内存/fs/SQLite/网络/子进程/信号/env；时间、ID、随机、fetch、CLI 注入 |
| 状态与并发 | 状态、事务、幂等键、预期版本/链顶、锁/fencing、重试、取消、超时、恢复 |
| 错误与观测 | category/subcause、拒绝/未知/部分成功、事件与秘密/日志边界 |
| 测试与证据 | 对应测试、正反用例、R/E/W/V、真实与 fake 边界、未证项 |
| 规模与验收 | 目录/行数预算、兼容要求、迁移证据、回退与未完成边界 |

**允许引用接口而不复制字段**：76/77 已定义的字段与 80 已定义的签名，在文件条目中写“承载哪个对象/哪个方法及文件特有约束”，不另写一份同义 schema。只写文件名或只复制接口签名都不合格。

### 2.1 生产件条目示例（仅格式示例，不是新增实现）

```text
F-core-decide
- 路径/处置：packages/core/src/decide.ts；保留；不再加新相位。
- 归属：80-§7 的 state-diff；不得承担授权、验收或结清。
- 内部：decide、passGates、flow 解析；输入为快照，输出 Action；无 IO。
- 依赖/状态：仅 contract；纯函数；五门与并发四闸分别计算，断路器前置。
- 失败/并发：未知流/未知态/意图不匹配/重复分别返回，不猜状态。
- 测试/迁移：core/test/decide.test.ts + golden；新语义另建对应子域用例，不改旧夹具含义。
```

### 2.2 测试件条目示例

```text
F-core-test-decide
- 路径/处置：packages/core/test/decide.test.ts；保留；只读源码测试。
- 覆盖：状态机主干、未知态、断路、闸序；不证明真实 CLI/DSH/跨进程能力。
- 夹具/断言：固定输入、明确动作和拒绝；不得用 LLM 补全裁判。
- 缺口：真实适配器、真实进程回放、跨实现、真机归 82 对应层。
```

### 2.3 配置/依赖件条目示例

```text
F-root-tsconfig-base
- 路径/处置：tsconfig.base.json；保留 NodeNext/noEmit 基线，发射配置另立。
- 内容：strict 全开关、可擦除语法、ESM、显式 .ts、types=node、无 DOM。
- 边界：Node 不读取 paths；测试转换不改变 Node 行为；build 另按 79。
- 验证：tsc --noEmit + Node 原生 smoke；不把 tsconfig 通过当可运行。
```

---

## 三、处置与迁移规则

### 3.1 保留有效职责，不追齐旧文件名

- 保留 CLI 一命令一模块、core 纯逻辑、store 单引擎触点、company 校验/装载、prompt 组装、gateway 凭据、平台适配与 evolve 链。
- 目录与文件名是迁移对象，不是公司语义。任何“服务/管理器/工具类”名称都必须有明确输入输出，不能用来藏另一个域。
- 当前 fake 只归测试/演示；不得因存在于 `src` 就进入生产装配。

### 3.2 拆分先解类型环，再拆行为

- `ServeConfig` 独立到 `assembly/serveconfig/`；`RunServeOpts` 以 `assembly/hrsync/run-serve-opts.ts` 为唯一来源并补通知注入。
- `EngineConfig`/`Inflight` 等先移至 `engine/tick/types.ts`，解除 merge 与 engine 的类型回引，再拆 tick、dispatch、harvest、breaker/sentinel，保留薄 facade。
- `serve.ts` 拆为 config/runtime/run；`control/hot-reload.ts` 拆为指纹/控制通道/执行/事件，facade 不增加域平面散文件。
- store、company、adapters、panel 的 `lineBaseline` 超限件均给目标拆分与兼容面；不得提高阈值或把新超限件塞进基线。
- `src/index.ts` 先仅再导出 `assembly/serve.ts`，包根导出和脚本改为 CLI 后退役；不得从 root 引 cli 或 engine。

### 3.3 新增语义必须有具体文件家

- 公共 schema/词表/用例与 experimental TS 端口分区；TS 不反向成为公共规范。
- 义务/授权/任命/合同/证据/记忆/异常/观察/迁移/权威不得只写“以后加进 engine”。
- `api` 的真实装配在 `apps/daemon/src/assembly/api/assemble.ts`，由 `runServe` 在同进程注入 `Pick<IntentSubmissionPort,'submit'|'receipt'>`；触发面只经该入口，装配体与 API 都不得直调 `engine.ingest`，也不是独立 CLI 进程取得主循环。
- 纯投影从 panel 下沉 company；HTTP 适配归 api；`daemon→api` 保留，禁止 `api→panel`、`boot→api`、`company→panel`。
- `external` 配置开但缺注入整机拒启；`external` 关闭不启动该面；停机按 sources→API close→engine dispose→ledger close。
- 纯配置包、能力包、部署包与工作区分区；DSH 分发 JS+.d.ts，不把 node_modules 下 TS 当可移植插件。
- `test/engine` 直属已 25 件，新测试只能进对应子域；切换包的 src 退出根 program 后，包级 typecheck 必须并入根脚本。

### 3.4 退役不能偷换为删除责任

- 退役文件须有调用方清单、替代路径、兼容期、数据/历史迁移与最终删除条件。
- `panel/external` 只在 api 接管、CLI 改线、路由/认证/幂等/只读迁移验证后删除；不得先删 export 再修调用方。
- `cli/external` 最终只保留迁移指引或退役，不另起无意图通道的独立 API 进程。
- 公司终态、历史、未决义务与承诺不因文件删除而消灭；结清与记录保留优先于目录整洁。

---

## 四、统一的事实与证据口径

每个附录必须使用以下标签，不混写：

| 标签 | 含义 |
|---|---|
| **现有** | 当前文件存在；只描述实际代码与已核调用，不扩张能力 |
| **库级/未接** | 文件或导出存在，但生产链未接或没有真实证据 |
| **目标-保留** | 现有职责保留到目标架构，可能需修改内部实现 |
| **目标-拆分** | 现有职责拆到多个目标文件，旧文件保留 facade 或退役 |
| **目标-新增** | 本组新增目标文件，必须给上位语义与完整文件契约 |
| **目标-替换** | 旧职责由新文件承担，须写迁移与兼容 |
| **目标-退役** | 目标不再使用，须给调用方与历史处置 |
| **仅测试/演示** | fake/夹具/实验入口，不能转生产 |
| **未证** | 真实能力、性能、兼容性或安全边界未取证据 |

测试绿只证明当前项目回归；文档审查、fake、静态导出、`dump-config`、多 agent 一致都不证明真机或跨实现能力。

---

## 五、各附录必须回答的专项

### 5.1 contract/core/store/company

- 公共规范数据与 TS 绑定的边界、版本、扩展、未知拒收、规范化与摘要；
- 纯函数与 IO 分离、Rule Profile 封闭求值、状态机/预算/断路/错误；
- SQLite 单引擎触点、迁移与只读打开、事务/CAS/fencing、投影重建、跨进程与维护窗口；
- 公司纯配置、目录/包导入、依赖清单与能力包、秘密/路径/归档、组织/岗位/治理与投影。

### 5.2 prompt/gateway/adapters/平台/bridge

- L0–L5 预算与版本指纹、秘密消毒、提示词不成为授权；
- 凭据与授权分离、写收口、未知回执；
- executor/agent loop/能力包/安装/挂载/资格/授权/生效的分段；
- DSH/Claude/Codex/Kimi 的损失与替代，平台状态映射和不可表达项；
- dsh-bridge 与 position 插件并存、PRM 只作绑定投影、PTC 默认禁止、证据导出与不可写面。

### 5.3 panel/api/studio-tools/matrix

- 投影只读与六态、监控故障、视图来源、认证与最小暴露；
- 对外 API 只产意图，禁止直写平台/台账；幂等与未知回执；
- 内部工具与 MCP/stdio 边界、秘密不出境；
- Matrix 仅经 boot 注入，通知不是决定，平台/会话不是公司身份。

### 5.4 daemon/boot/root

- 入口、组合根、配置分类、主循环七相位、事务与恢复；
- 控制/进化/engine 三域不互引、root/CLI/assembly 的方向；
- 目标拆分与 facade、目录 25/文件 600/域平面只减不增；
- 模板每个文件与纯配置迁移、根构建与脚本、guards 的唯一规则源与机械门禁；
- 不将根 `AGENTS.md`/README 的旧事实悄悄改成目标事实，漂移只在 82 登记。

---

## 六、附录完成判据

每份附录必须同时满足：

1. 现有路径与目标路径可枚举、可复算，未隐藏省略；
2. 每个文件都有内部结构、依赖、IO、错误、测试与迁移，不是文件名清单；
3. 目标新增件能回到 76/77/78/80 的 ID，接口不悬空；
4. 每个超限件有拆分后文件清单，未提高阈值或新增域平面散件；
5. 没有 `TS-PORT-*` 通配、无来源的 `REC-*`、虚构依赖、虚构当前能力；
6. 明确现有/目标/未证，没有“目标已支持”“测试证明真机”等越级表述；
7. 覆盖保留/拆分/新增/替换/退役及测试/配置/模板，排除项只有生成物与第三方源文件；
8. 需要制作人决定的政策项与可执行的工程选择分开，不把未验证当未决技术空白。

主索引只作导航。各附录的内容若与主索引冲突，以 75–80 的上位语义与真实代码核查为准，并回写本索引，不得保留两套说法。
