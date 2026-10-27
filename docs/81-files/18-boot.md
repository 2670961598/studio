# 81-files/18 · boot：组合根与 Matrix 注入

> 版本：v0.5（两型秘密句柄、工厂与直接面并存一律拒启、`deploymentBaseDir` 显式基准、秘密空值与轮换语义；在 v0.4 之上），2026-10-27。
> 性质：**逐文件自然语言设计呈审稿**，不是现行文件树、实现单、完成证明或能力声明。
> 上位（本版逐节重读，不以上一稿摘要为准）：75 的文件/依赖契约与 D75-11/D75-13；76 的 `DEF-CFG-01`（§5.2）与 `DEF-PKG-05`（§2.6）；77 的 `RUN-WORK-01`（§4.1 受理五值）与 §1.8（外部效果类须回执或观察，"通知不是决定"）；78 的 `BIND-EDGE-MX-01`（§11.2）与 `BIND-WS-01/SEC`（§7.4.1）；79 的 §1.3/§4.1/§4.4/§6.5；80 的 §2.1、§3.1、§3.3（第 6 条 `ServeConfig.secrets`）、§3.4（第 6–10 条：再导出、判别联合与 `deploymentBaseDir`、无 provider 注入、会话工厂与两型句柄）、§3.6、§5.7、§5.8、§6.6、§8.2、§9.4、§10.6、§11.2/§11.2.1（登录 `platform-auth`、建号 `matrix-register`、`secret-empty`、轮换/吊销整体重建）、§11.3、§12.1。
> 门禁：本文所有“目标/新增/拆分/替换/退役”均为设计处置，**尚未执行**。不得据此直接改生产代码、manifest、lock、guards 或测试。

**本版修订（相对 v0.1，逐项对应 80 现行接口）**

| # | 修订 | 影响本附录的条目 |
|---|---|---|
| R1 | 错误统一为 `ClassifiedError = { failure, category, subcause, detail? }`：`failure` 取 77 十四类并驱动处置，`category` 只做观测；构造期固定 `rejected_precondition` + `CONFIG_INVALID` | §4.5、F-boot-boot 错误面、§8.1 |
| R2 | 秘密形状统一到 `SecretCatalogEntry`/`SecretProvider`/`SecretMaterial`/`KnownSecretSet`（`contract/src/ports/secret.ts`，80-§11.2.1）：`load(entry, use)`、`use ∉ allowedUses ⇒ rejected_forbidden`、先按 `subjectScope` 过滤。**本版更正归属**：这些键由 daemon 按 `ServeConfig.secrets` 装配与调用，boot 不读、不传、不存 | §4.2/§4.3/§4.5、F-boot-boot 注入面、F-boot-test |
| R3 | `RunServeOpts` 由 80-§3.4 定为唯一部署注入类型（5 键，见 V7），且 80-§3.4 第 6 条已明写“由 `@studio-next/daemon/serve` 再导出、禁止相对路径穿透”——v0.1 误记为已定、v0.3 又误记为未写，本版按 80 现行文本改回“已定（设计层）” | §4.2、§8.3 第 2 项 |
| R4 | `assembleApi` 只收 `ingress` 的 `submit`/`receipt`，落 `apps/daemon/src/assembly/api/assemble.ts`；boot 不 import `api`、不装配 `:8788` | §4.4、F-boot-boot 非职责 |
| R5 | `Notification` 保持 contract 现有形状（`from` 为 string）；投递封装用 `NotificationEnvelope`；`NotifySendReport` 与 `broadcast.ts` 的 `sent`/`failed` 逐字段一致 | §4.4、F-boot-boot 广播面 |
| R6 | 意图与回执（`WorkIntake`/`IntentIngress`/`IntentReceipt`）在 daemon 内闭合；boot 不写 `REC-*`、不持 ingress、不产回执 | §4.4、§8.1 |
| R7 | `repo-validate` 留 company、开工五门落 `core/src/work-readiness.ts`、通用类型用 `MergeRunHost`、`Money.usd` 只作内存/旧记录、`sha8` 只作展示、UTC 日键与公司本地日分开——均不在 boot 面，逐条标 N/A + 理由 | §4.4 |
| R8 | `BIND-CORE-01` 的 20 字段 `BindingProfile`、`mapState` 的 `unverified` 语义属 78/80 绑定面；boot 只注入 Matrix 边（`BIND-EDGE-MX-01`），不实现 `BindingProfile` | §4.4 |

**v0.3 修订**

| # | 修订 | 落点 |
|---|---|---|
| V1 | §四 重构为 4.1 层位 / 4.2 注入面 / 4.3 共享源 / 4.4 矩阵边界 / 4.5 秘密路径日志 / 4.6 启停 / 4.7 构建 / 4.8 上位接口对照 | §4.1–§4.8 |
| V2 | 注入面清单化：入向为 `configPath`/`config`（判别联合，二者取一）、`fetch`、`log`、`serve`，出向为 `RunServeOpts` 的五个可选键；另列排除项。v0.3 曾把 `secrets` 列为“待批提案键”，v0.4 已撤销该提案（见 V8） | §4.2 |
| V3 | 共享源清单化：8 个源的所有者、允许动作、现状分歧、目标规则；三种合法共享形态 + 禁止项 | §4.3 |
| V4 | 矩阵边界：10 行归属表 + 5 个相邻装配点 + 8 条越界判负（第 8 条为 v0.5 新增：工厂与直接面并存） | §4.4 |
| V5 | R1/R2 落到正文：错误两轴与 subcause 表、秘密链路现状/目标（4.5.1–4.5.4） | §4.5、F-boot-boot 错误面 |
| V6 | 目标补测扩到 A1–A12 / S1–S7 / C1–C3；缺口扩到 G1–G18；回写扩到 1–18；迁移顺序见 §9.1 | §8.1–§8.4、§9.1 |

**v0.4 修订（上一版；以 80 2026-10-27 06:40 版为准）**

| # | 修订 | 落点 |
|---|---|---|
| V7 | `RunServeOpts` 由 3 键扩为 5 键：新增 `notifyBroadcast` 与 `matrixSessionFactory`；原 `matrixSource`/`matrixRoomFace`/`hrMatrixFace` 保留但降为**测试/迁移兼容**路径 | §4.2、§4.8、§8.1 |
| V8 | **秘密归 daemon**：撤销 v0.3 的 `BootOptions.secrets` 提案，也**不新增** `BuildRuntimeOpts.secretProvider`（80-§3.4 第 8 条）。`ServeConfig.secrets` 由 daemon 内部加载；boot 不读 env 秘密、不建 `KnownSecretSet`、不写 `REC-LOSS-01` | §4.2/§4.3/§4.5、F-boot-boot、F-boot-main |
| V9 | **Matrix 会话由工厂注入**：boot 只构造 `matrixSessionFactory`（返回 `matrixSource`/`matrixRoomFace`/`hrMatrixFace`/`notifyBroadcast` 四个工厂 + `close()`），由 daemon 驱动登录；access token 只在 client 内存、boot 不持 | §4.1/§4.2/§4.4/§4.6、F-boot-boot |
| V10 | `runServe` 入参改判别联合 `{ configPath } \| { config }`（80-§3.4 第 7 条），boot 传 `{ config }` 避免双读；`RunServeOpts` 从 `@studio-next/daemon/serve` 再导出，测试不得相对路径穿透，测试用 `engine` 也走 exports（80-§3.4 第 6/9 条） | §4.2/§4.6/§4.8、F-boot-test、F-boot-package |

**v0.5 修订（本次；以 80 最新版 §3.4 第 7/10 条与 §11.2.1 为准）**

| # | 修订 | 落点 |
|---|---|---|
| V11 | **两型秘密句柄**：`MatrixBotLoginSecret`（`SEC-MX-BOT-PASSWORD` + `use:'platform-auth'` + `kind:'password'`）与 `MatrixHrRegisterSecret`（`SEC-MX-HR-SHARED` + `use:'matrix-register'` + `kind:'shared-secret'`）分开；建号只认后者，**不得**用 bot 密码建号、也不得改走未定义的 bot 管理 API。v0.4 登记的“HR 秘密无槽位”缺口**关闭** | §4.5.1、§4.4、F-boot-boot、F-boot-testkit、§8.3 第 6 项 |
| V12 | **工厂与任一直接面同时给 ⇒ `CONFIG_INVALID`**，不判“是否矛盾”（启动期不可判，也不择一静默）；单独给面或单独给工厂都合法（前者测试/迁移、后者生产） | §4.2、§4.4、§4.5.4、§7、§8.2 |
| V13 | `{ config }` 分支的 `matrixDeptMap` 基准由 **`BootOptions.deploymentBaseDir`** 显式提供（boot 自有类型、不进 `RunServeOpts`），缺省**不得**回落 `process.cwd()`；`{ configPath }` 分支仍用 `dirname(resolve(configPath))`；配置只读一次、`runServe` 判别联合不双读 | §4.2/§4.5.2、F-boot-boot、§8.2 A7、§8.3 第 10 项 |
| V14 | **秘密失败语义**：provider `load` 取到空串/零字节 ⇒ `rejected_precondition` + `subcause:'secret-empty'` 且**不返回材料**；必需项装配失败 ⇒ `CONFIG_INVALID`（保留原始 `failure`/`subcause`）；选项失败 ⇒ 不装配该能力 + `REC-LOSS-01`；provider 不可用 ⇒ `unavailable`。**轮换/吊销**由文件 `mtime`/`version` 变化或部署控制通道触发**整体重建**，不是“只能重启” | §4.3、§4.5.1、§8.1 G5/G16、§8.3 第 5 项、§8.4 |
| V15 | 测试与夹具同步：`fakeLoginSecret` 拆为 `fakeBotLoginSecret`/`fakeHrRegisterSecret`；用例断言改“任一面与工厂并存即拒”；版本行与计数按本节更新（总数仍 **58**：guards 9 + assembly 31 + serve 18） | §7 全部、§8.2、§3.2 |

---

## 一、范围、证据与口径

### 1.1 覆盖范围

本附录只覆盖 `apps/boot` 下的第一方常规文件：

- 生产源码：`src/boot.ts`、`src/main.ts`；
- 测试：`src/boot.test.ts`；
- 配置：`apps/boot/package.json`、`apps/boot/tsconfig.json`。

不展开 `packages/matrix` 的实现（归 11）、`apps/daemon` 的 `serve.ts`/`RunServeOpts` 实现（归 17）、`packages/contract` 的端口定义（归 01）。这些只作为被调用的接口与证据锚点引用。80-§11.2.1 定的 `contract/src/ports/secret.ts` 与 `ServeConfig.secrets` 是 **daemon 侧的目标件**：boot 既不实现也不消费，本文只登记“boot 不接触秘密”这一边界与它导致的可测后果（归 01/17）。

### 1.2 排除项

- `apps/boot/node_modules/**`：workspace 安装产物与符号链接，不是第一方源码；
- 生成物、构建产物、lock 文件：`apps/boot` 内无 `dist`、无构建脚本、无 lock；
- 文档性配置：`apps/boot` 内无 README、LICENSE、模板或示例配置；包级许可字段缺失是 79-§6.5 的仓级政策项，不在本附录补写。

### 1.3 本次证据方法与边界

本次为返修，先逐节重读上位：80-§2.1（boot 不在 `packageLayers`、三条出边）、§3.1（四类入口与装配点）、§3.3（`ServeConfig`，第 6 条 `ServeConfig.secrets`）、§3.4（`RunServeOpts` 五键、第 6–10 条：再导出/判别联合与 `deploymentBaseDir`/无 provider 注入/会话工厂与 `MatrixBotLoginSecret`+`MatrixHrRegisterSecret` 两型句柄/导入面）、§3.6（启动十步，第 6 步先建秘密再建会话）、§5.7（`ClassifiedError` 两轴与 `Err` 可达 category）、§6.6（`Notification`/`NotificationEnvelope`/`IntentSubmissionPort`/`IntentReceipt`）、§8.2（`openLedgerReadonly`）、§9.4（`assembleApi` 与 `IntentIngress`）、§11.2/§11.2.1（脱敏、秘密供给、`secret-empty`、装配失败的启动语义、轮换/吊销整体重建）、§11.3（路径三段）、§12.1（四注入面）；78-§7.4.1（`BIND-WS-01/SEC` 字段与缺失处置）、§11.2（`BIND-EDGE-MX-01` 与 V5 缺口）；77-§4.1/§1.8；79-§1.3/§4.1/§4.4/§6.5/§10.2；76-§2.6/§5.2。

仓内只读证据：`find apps/boot -type f`（5 个常规文件）、逐文件 `Read`（`boot.ts` 376 行、`main.ts` 12 行、`boot.test.ts` 635 行、`package.json` 20 行、`tsconfig.json` 5 行）、`grep -c` 复核 14 个 `describe`/35 个 `it`、`scripts/guards/boundary-rules.mjs`（`:104`–`:106` 三条 boot 边、`:161` 基线 645）、`apps/daemon/src/assembly/hrsync/run-serve-opts.ts`（现状仅 `matrixSource`/`matrixRoomFace`/`hrMatrixFace` 三键，2026-10-23 14:42）、`apps/daemon/src/assembly/serve.ts`（`runServe` 仍为 `(configPath, opts?)`）、`apps/daemon/package.json`（exports 仅 `.`/`./engine`/`./serve`）。80-§3.1 说 boot 用 `@studio-next/daemon/engine`，实测 `boot.ts` 只用 `daemon/serve`，`engine` 只出现在测试导入——本版按实测写，并把该句列为回写项（§8.3 第 1 项）。

**没有执行** `bun run typecheck`、`bun run test`、`bun run guard:boundaries`，**没有启动** daemon/boot，**没有连接**真实 Matrix homeserver，**没有实现**本节任何目标件。因此本文不证明类型通过、测试通过、边界守护通过、真实登录、真实频道供给、秘密供给或真实 `runServe` 行为；`matrixSessionFactory`、`ServeConfig.secrets`、`contract/src/ports/secret.ts` 三者当前在仓内均不存在。

### 1.4 标记口径

- **现有**：当前文件存在，只描述实际导出、调用和测试锚；
- **库级/未接**：代码存在但生产链未接、或只有测试/exports 证据；
- **目标**：设计处置，尚未实现；
- **仅测试**：fake、夹具、测试基建，不得进入生产装配；
- **未证**：真实网络、跨进程、真机、性能、安全边界未取证据。

---

## 二、现有件全集与计数

### 2.1 现有文件（5 个常规文件）

| F-ID | 现有路径 | 类别 | 行数 | 现状处置 |
|---|---|---|---:|---|
| `F-boot-boot` | `apps/boot/src/boot.ts` | 生产源码 | 376 | 现有；目标保留并内部收口 |
| `F-boot-main` | `apps/boot/src/main.ts` | 生产源码/手动启动器 | 12 | 现有但未注册、未接；目标受限保留 |
| `F-boot-test` | `apps/boot/src/boot.test.ts` | 测试 | 635 | 现有；目标拆分后退役旧路径 |
| `F-boot-package` | `apps/boot/package.json` | 配置/manifest | 20 | 现有；目标保留并校正口径 |
| `F-boot-tsconfig` | `apps/boot/tsconfig.json` | 配置/类型门禁 | 5 | 现有；目标保留 |

计数：生产源码 2 个；测试 1 个；配置 2 个；合计 **5 个常规文件**。不计 `node_modules` 下的符号链接与安装产物。

### 2.2 现有文件之间的关系

```text
main.ts ──import──> boot.ts
boot.ts ──import──> @studio-next/contract（仅类型）
        ──import──> @studio-next/daemon/serve（parseDaemonConfig/runServe/RunServeOpts 及四个面类型）
        ──import──> @studio-next/matrix（MatrixClient/createMentionSource/createMatrixProvisionFace/
                                      createMatrixBroadcastFace/createMatrixHrFace 及类型）
        ──构造────> matrixSessionFactory（目标态：只把上述 matrix 能力封进工厂交给 daemon）
boot.test.ts ──import──> boot.ts
             ──import──> @studio-next/daemon/engine（checkMentionPayload，测试专用，须经 exports）
             ──import──> @studio-next/daemon/serve（RunServeOpts 等；目标态经 exports，不留相对路径穿透）
```

`apps/boot` 是仓内**唯一**同时依赖 `@studio-next/daemon` 与 `@studio-next/matrix` 的单元；`daemon` 本体零 `@studio-next/matrix` import。**目标态不改这条边**：工厂类型按结构定义在 daemon 的 `run-serve-opts.ts`（80-§3.4 第 10 条、§12.4 D25），daemon 只依赖工厂**形状**、不 import `@studio-next/matrix`，因此“`boot→matrix` 是唯一 matrix 边”仍成立。该事实由 `boot.test.ts` 的静态扫描用例守护，不是由 guards 的层位表守护。

现状与目标的差（同一张图上的两处）：**现状** boot 自己调 `MatrixClient` 登录并持 client；**目标** boot 只构造工厂闭包，登录调用方是 daemon（§4.6）。测试里那条 `../../daemon/src/assembly/hrsync/run-serve-opts.ts` 相对跨包导入是**待消除的现状**（80-§3.4 第 6 条），不是设计。

---

## 三、目标件全集与处置计数

### 3.1 目标路径与处置

| F-ID | 目标路径 | 处置 | 上位 | 说明 |
|---|---|---|---|---|
| `F-boot-boot` | `apps/boot/src/boot.ts` | 目标-保留（内部收口） | 80-§3.1/§3.4/§3.6；78 `BIND-EDGE-MX-01` | 仍是组合根；不新增公共语义 |
| `F-boot-main` | `apps/boot/src/main.ts` | 目标-保留（受限） | 80-§3.1/§3.6；79-§1.3 | 仓内手动启动器；不注册 `bin`/启动脚本；不是发布入口 |
| `F-boot-package` | `apps/boot/package.json` | 目标-保留（校正） | 79-§6.5/§10.2；80-§2.1 | 不加依赖、不加 `bin`；修正文档口径 |
| `F-boot-tsconfig` | `apps/boot/tsconfig.json` | 目标-保留 | 79-§4.4/§5.2 | 维持 `src/**/*.ts`；不引 `paths`/references |
| `F-boot-testkit` | `apps/boot/src/test/testkit.ts` | 目标-新增（仅测试基建） | 80-§10.6；80-§11.2/§11.6 | 共享 fake 与 YAML 构造器 |
| `F-boot-test-guards` | `apps/boot/src/test/guards.test.ts` | 目标-新增（拆分产物） | 80-§2.1；79-§4.1 | 依赖方向、payload 形状、组合根零入边、共享源单点、矩阵与秘密边界、工厂导出（§4.3/§4.4/§4.5.1） |
| `F-boot-test-assembly` | `apps/boot/src/test/assembly.test.ts` | 目标-新增（拆分产物） | 80-§3.4；78 `BIND-EDGE-MX-01` | 登录、源、供给、广播、人事装配 |
| `F-boot-test-serve` | `apps/boot/src/test/serve.test.ts` | 目标-新增（拆分产物） | 80-§3.1/§3.6；78 `BIND-EDGE-MX-01` | `bootServe` 接线、开关形态、注入边界 |

### 3.2 计数

| 口径 | 数量 | 明细 |
|---|---:|---|
| 现有常规文件 | 5 | 生产 2、测试 1、配置 2 |
| 目标常规文件 | 8 | 生产 2、测试 3、测试基建 1、配置 2 |
| 路径级新增 | 4 | `testkit.ts`、`guards.test.ts`、`assembly.test.ts`、`serve.test.ts` |
| 路径级退役 | 1 | 旧 `apps/boot/src/boot.test.ts`（拆分完成后删除） |
| 路径级保留 | 4 | `boot.ts`、`main.ts`、`package.json`、`tsconfig.json` |
| 语义拆分 | 1 | `F-boot-test` → `F-boot-test-guards` + `F-boot-test-assembly` + `F-boot-test-serve` + `F-boot-testkit` |
| 目标替换 | 0 | 无生产职责替换；`main.ts` 保留 |
| 目标生产新增 | 0 | 80 未授权 boot 新生产文件；不私设 `index.ts` |

`F-boot-test` 的旧 ID 在拆分后退役，不复用；新文件各有独立 ID。旧路径删除前必须完成 35 个现有用例的迁移与逐一通过，不能先删后补。目标用例总数 **58**（guards 9 = 迁移 5 + 新增 4；assembly 31 = 迁移 19 + A1–A12；serve 18 = 迁移 11 + S1–S7）：迁移 35 例，目标新增 23 例（guards +4、assembly +12、serve +7）。新增例中 **A1–A2**（工号语法待 76）、**A10**（供给/广播 slug 权威待 76/80）、**S4**（单实例待 80-§3.6）仍带上位待定；**A7 与 S7 已由 80-§3.4 第 7/10 条关闭**（`deploymentBaseDir`、并存即拒），不再是待定项；C1 依赖 deptMap 单读收口先落地（C2/C3 可先落）。落地前按 §8.2 的“阻塞”列处理。

### 3.3 规模预算

| 目录/文件 | 现状 | 目标 | 阈值 | 说明 |
|---|---:|---:|---:|---|
| `apps/boot/src` 直属文件 | 3 | 2 | 25 | 测试移入 `src/test/` 后直属只剩 `boot.ts`、`main.ts` |
| `apps/boot/src/test` 直属文件 | 0 | 4 | 25 | 新子目录；不占 `src` 直属额度 |
| `apps/boot/src/boot.ts` | 376 | ≤600 | 600 | 不拆分；只做内部收口 |
| 旧 `boot.test.ts` | 635 | 删除 | 600（基线 645） | 目标拆为 4 件，均 ≤600 |
| `testkit.ts` | — | ≤180 | 600 | 仅测试基建 |
| `guards.test.ts` | — | ≤220 | 600 | 9 个用例（5 搬 + 4 增：testkit 隔离、共享源单点、矩阵/秘密边界、工厂导出） |
| `assembly.test.ts` | — | ≤600 | 600 | 31 个用例（19 搬 + 12 增：A1–A12） |
| `serve.test.ts` | — | ≤560 | 600 | 18 个用例（11 搬 + 7 增：S1–S7） |

`apps/boot` 不在 daemon 的域平面基线内；25/600 仍适用于其 `src` 与 `test` 递归扫描。拆分只降低单件尺寸，不以提高阈值换空间。

---

## 四、组合根、注入与共享源（跨文件约束）

### 4.1 层位与允许边

**现有事实**：

- `scripts/guards/boundary-rules.mjs` 的 `packageLayers` 没有 `boot` 行；`allowedPackageEdges` 有且只有三条：`boot→contract`、`boot→daemon`、`boot→matrix`（`:104`–`:106`）。
- 因此 boot 是**组合根，不是包层**：零入边、三条出边、不得被任何包 import。任何别的包 import `@studio-next/boot` 会被 guards 以“未登记的工作区包”判红；`boot.test.ts` 另有一条字符串扫描，用于给出更明确的“组合根不被反向依赖”断言。
- `daemon` 本体零 `@studio-next/matrix` import；**现状**是 Matrix 的源/频道/广播/人事四面由 boot 装配后直接注入，**目标**是 boot 只构造 `matrixSessionFactory`（把上述 matrix 能力封进闭包），由 daemon 驱动登录并拿到四面（80-§3.4 第 10 条）。两种形态都不新增 `daemon→matrix` 边：工厂类型按结构定义在 daemon 的 `run-serve-opts.ts`。该方向由 80-§2.1/§12.1 与 78 `BIND-EDGE-MX-01` 冻结。

**目标约束**：

- 不新增 `boot→api`、`boot→panel`、`boot→company`、`boot→store`、`boot→core` 等边；boot 不装配 API、不读台账、不写公司目录。
- 第二装配单元（如未来的 `apps/boot-taiga`）必须走提案流新增边，不得复用 `boot` 的名字或偷偷扩 boot 的依赖。
- `boot.ts` 只经 `@studio-next/daemon/serve` 使用 `runServe`/`parseDaemonConfig`/注入面类型；不得 import daemon 包根 `@studio-next/daemon`，也不得 import `daemon/engine`（测试文件的 `checkMentionPayload` 是测试专用例外，生产源码不得沿用）。

### 4.2 注入面：两条通道，方向相反

`BootOptions` 是**入向**注入（调用方 → boot）；`RunServeOpts` 是**出向**注入（boot → daemon）。两者不得混用，也不得互相抄键。

| 注入项 | 方向 | 类型来源 | 缺省 | 缺省语义 | boot 的义务 |
|---|---|---|---|---|---|
| `configPath`（判别联合分支） | 调用方 → boot | `{ configPath: string }`（80-§3.4 第 7 条判别联合） | 必填（与 `config` 二选一） | 无 | 只做 `path.resolve` 与读取，不把路径当授权 |
| `config`（判别联合分支） | 调用方 → boot | `{ config: ServeConfig }`（同上；`ServeConfig` 是 80-§3.3 的配置类型） | 必填（与 `configPath` 二选一） | 无 | 直接用已解析对象；**生产走这一支**，不再二次读盘（§4.6） |
| `deploymentBaseDir`（**目标新增**） | 调用方 → boot | `string`（boot 自有类型，**不进 `RunServeOpts`**，80-§3.4 第 7 条） | 无（`{ config }` 分支且配了 `matrixDeptMap` 时必填） | 无 | `{ configPath }` 分支用 `dirname(resolve(configPath))`；`{ config }` 分支必须由部署绑定显式给，**不得**回落 `process.cwd()`；解析后过 realpath + containment（§4.5.2），缺失即 `CONFIG_INVALID`（`boot-deployment-base-missing`） |
| `env`（现状，**目标退役**） | 部署 → boot | `NodeJS.ProcessEnv`（`BootOptions.env?`） | `process.env` | 现状只用于取两条 Matrix 密码 env | 现状载体；目标删除该键——boot 无秘密可读，`process.env` 在 `apps/boot/src` 生产代码内零命中（§4.5.1） |
| `fetch` | 部署/测试 → boot | `FetchLike`（matrix 导出） | `globalThis.fetch` | 直连 homeserver | 只封进工厂交给 `MatrixClient`，boot 自身不发请求（§4.4） |
| `log` | 调用方 → boot | `(line: string) => void` | `console.log`（`bootServe`）/ 无操作（各 `assemble*`） | 无观测 | 只打 §4.5 允许的字段；不转交 daemon |
| `serve` | 测试接缝 → boot | `(input: { configPath } \| { config }, opts?: RunServeOpts) => Promise<ServeResult>`（目标；判别联合的类型名由 daemon 命名，现状是 `(configPath, opts?)` 且 opts 为内联三键子集） | `runServe` | 真实启动 | 生产不替换，仅测试注入 |
| `matrixSessionFactory`（**目标新增**） | boot → daemon | `RunServeOpts.matrixSessionFactory?`（`MatrixSessionFactory`，80-§3.4 第 10 条） | 不注入（现状无此键） | Matrix 开关全关：不调用、不 `load` 秘密；任一开关开而既未给面也未给工厂：`CONFIG_INVALID` 拒启 | **生产路径**：boot 构造工厂并注入，不驱动登录；**与任一直接面同时给即 `CONFIG_INVALID`**（不判“矛盾”、不择一静默，80-§3.4 第 10 条）；单独给面或单独给工厂均合法（§4.4） |
| `notifyBroadcast`（**目标新增**） | boot → daemon | `RunServeOpts.notifyBroadcast?`（`NotifyBroadcastFace`） | 不注入 | 面关零行为，不拒启 | 与 `matrixRoomFace` 同开关同批装配；生产走工厂时由工厂返回值提供，**不得与工厂同时给**（同时给即 `CONFIG_INVALID`） |
| `matrixSource` | boot → daemon | `RunServeOpts.matrixSource?`（`() => InvokeSource`） | 不注入 | `matrix:false` 不调用 | 现状生产路径；**目标仅测试/迁移兼容**：与工厂同时出现即 `CONFIG_INVALID`，不再写“以工厂为准” |
| `matrixRoomFace` | boot → daemon | `RunServeOpts.matrixRoomFace?` | 不注入 | `matrixChannels:false` 不调用 | 同上（测试/迁移兼容；与工厂同时给即拒） |
| `hrMatrixFace` | boot → daemon | `RunServeOpts.hrMatrixFace?`（`() => MatrixHrFace`，**不是** `MatrixRoomFace`） | 不注入 | `hrSync+hrMatrix` 未开不调用 | 同上（测试/迁移兼容；与工厂同时给即拒）；工厂返回值里这一项形状相同 |
| `hrKnownSecrets`（排除项） | —（不属 boot 注入面） | `BuildRuntimeOpts.hrKnownSecrets?`（80-§3.4） | daemon 自建 | 测试/装配兜底（生产来源走 provider） | boot 不递、不另存秘密值、不构造 `KnownSecretSet` |

**秘密通道的边界（目标）：boot 不接触秘密值。** 80-§3.3 第 6 条把秘密配置面定为 `ServeConfig.secrets`，80-§3.6 第 6 步把“载 provider → `KnownSecretSet` → 取 `SEC-MX-BOT-PASSWORD` 与（建号开启时）`SEC-MX-HR-SHARED`”放在 daemon 装配期；80-§3.4 第 8 条明确**不新增** `BuildRuntimeOpts.secretProvider`，测试假 provider 走 daemon 内部测试注入点。因此：

- boot 不出现 `SecretCatalogEntry`/`SecretProvider`/`SecretMaterial`/`KnownSecretSet` 任何一处，不调 `load(entry, use)`、不判空值、不写 `REC-LOSS-01`、不做轮换重建；
- 用途与句柄已定（80-§3.4 第 10 条、§11.2.1）：登录句柄 `MatrixBotLoginSecret`（`SEC-MX-BOT-PASSWORD` + `use:'platform-auth'` + `kind:'password'`）、建号句柄 `MatrixHrRegisterSecret`（`SEC-MX-HR-SHARED` + `use:'matrix-register'` + `kind:'shared-secret'`），**两型不可互换**，由 daemon 构造后作为 `MatrixSessionFactoryDeps.login`/`.registration` 传入，boot 不填、不改、不复制；
- boot 只保证“矩阵开关与工厂形状一致”：开关开就注入工厂，开关全关就不注入；工厂内部的登录失败、缺建号句柄、句柄判别位不符，都由工厂/daemon 归因，不属 boot 的本地错误表（§4.5.4）。

注入面与 80-§12.1 的对应：出向的 `matrixSessionFactory` 一个键覆盖 80-§12.1“通信绑定”那面的四种形态（工厂返回值逐字段等于四个面）；四个面的直接注入是它的**测试/迁移兼容**替身。`fetch`/`log` 是测试与观测接缝，不是绑定面。`secrets` **不是** boot 的注入键（v0.3 的提案已撤销，见 V8）：它只在 `ServeConfig` 里、只由 daemon 读。除这些外不得新增注入键，也不得为某一面新开一条包边。

三条禁令：

- **不伸手**：boot 只经 `@studio-next/daemon/serve` 的导出面（`parseDaemonConfig`/`runServe`/`RunServeOpts` 及面类型）。不 import daemon 包根、`daemon/engine`、`daemon/cli`，不读 daemon 内部相对路径。`RunServeOpts` 必须由 `@studio-next/daemon/serve` **再导出**（80-§3.4 第 6 条）；测试里的 `../../daemon/src/assembly/hrsync/run-serve-opts.ts` 与测试用 `@studio-next/daemon/engine` 都必须走 `exports` 映射，不得相对路径穿透。
- **不下沉**：`fetch`/`log` 是 boot 的输入，不是 `RunServeOpts` 的键；`secrets` 既不是 boot 输入也不是 opts 键，它是 `ServeConfig` 的字段。daemon 的装配件注入（`log`/`clock`/`quarantineMs`/`hrKnownSecrets`/`evolveSelfCheck`）属 `BuildRuntimeOpts`（80-§3.4），boot 不递。**不新增** `BuildRuntimeOpts.secretProvider` 或任何“值是秘密”的注入项（80-§3.4 第 8 条）。
- **不复制**：注入类型一律引用上位（`RunServeOpts`、`MatrixSessionFactory`、`MatrixSessionFactoryDeps`、`MatrixBotLoginSecret`、`MatrixHrRegisterSecret`、`MatrixRoomFace`、`NotifyBroadcastFace`、`MatrixHrFace`），不写第二/第三份内联形状；结构同形的 matrix 侧类型（`MatrixHrTarget`、`createMatrixProvisionFace` 返回值）不另立接口。`deploymentBaseDir` 是**唯一** boot 自有注入键（不来自 80 类型）。

`ServeConfig` 的唯一解析器与秘密供给仍在 daemon（80-§3.3）：boot 只调用 `parseDaemonConfig`（或收调用方已解析的 `config`），不另写解析器、不另定键。开关开而未注入的判负归 daemon：`matrixSource`、`matrixRoomFace`、`hrMatrixFace`、`matrixSessionFactory` 缺失是 `CONFIG_INVALID` 拒启动；`notifyBroadcast` 缺失是面关零行为（80-§3.4 缺省语义表）。**工厂与任一直接面同时给也判 `CONFIG_INVALID`**（daemon 侧判据；boot 侧在生产路径上根本不同时给，见 §4.4）。boot 只负责“开关开就装配并注入”，不替 daemon 决定哪一项必需。

`matrix`、`matrixChannels`、`hrSync+hrMatrix` 三个开关独立：只开供给不开唤醒源是合法灰度；只开人事面（两个 matrix 面都关）也是合法灰度；全关时 boot 透传 `runServe`，不登录、不注入、不读 deptMap、不调工厂、不 `load` 密码。`hrSync:false + hrMatrix:true` 不是合法形态（现状被静默忽略，见 G7；目标拒启 `matrix-hr-matrix-without-hrsync`）。

### 4.3 共享源：一次读、一处派生

“共享源”指同一次 `bootServe` 调用内被多个面共用的只读输入。共享的目的是**一致性**，不是省 IO；判据是“两个消费者看到同一个值”，不是“少读一次文件”。

| 共享源 | 唯一所有者 | boot 允许的动作 | 现状重复/分歧点 | 目标规则 |
|---|---|---|---|---|
| `daemon.yaml` 文本与开关 | daemon `parseDaemonConfig`（80-§3.3） | 调用一次解析器，取开关、`matrixDeptMap`、`company` | `boot.ts:336` 与 `serve.ts:1470` 各读一次（G1） | 80-§3.4 第 7 条已定 `runServe` 收判别联合 `{ configPath } \| { config }`：boot 生产传 `{ config }`，双读在设计上关闭（代码未改，G1 只剩实现）；boot 不擅自缓存或二次解析 |
| `matrixDeptMap` → `deptSlugs` | 部署文件；派生物归 boot | 读一次、派生一次，作为参数交给两个面 | `boot.ts:239` 与 `:285` 各读一次（G6） | 在 `bootServe` 内读一次；供给面与广播面共用同一对象；`loadDeptSlugs` 保持纯同步函数 |
| 秘密（bot 密码、hr shared secret） | daemon（`ServeConfig.secrets` → provider → `SecretMaterial` → `MatrixBotLoginSecret`/`MatrixHrRegisterSecret`，80-§3.3 第 6 条、§3.4 第 10 条） | **不读、不传、不存**；只构造工厂，工厂内不改写句柄、不解析值 | boot 从 env 直读两条密码（`boot.ts:144`/`:322`）；daemon 另读 `process.env` 做脱敏（G5） | boot 零接触；`KnownSecretSet`、`load`、空值判定（`secret-empty`）与轮换重建全在 daemon 装配期（§4.5.1） |
| 登录结果（`client`/`botMxid`/token） | daemon（工厂内部） | 只构造工厂；不登录、不持 client、不持 token | boot 登录一次并持 client（`boot.ts:347`），经 `AssembleOptions.login` 在四个 `assemble*` 间共享 | daemon 调工厂一次拿四个面 + `close()`；token 只在 client 内存（§4.4） |
| `deptMap` 解析基准（`baseDir`） | boot（`BootOptions.deploymentBaseDir`） | 取一次、不缓存到跨调用、不传 daemon | 现状以 cwd 为基准（`boot.ts:197`） | `{ configPath }` 用 `dirname(resolve(configPath))`；`{ config }` 用显式 `deploymentBaseDir`；不回落 cwd（§4.5.2） |
| 供给与广播的 `slug` | 公司目录 `snapshot.slug` 为公司面权威；`config.company` 是部署声明 | 启动时交叉校验，或统一取一处 | 供给用 `snap.slug`（`boot.ts:249`）、广播用 `config.company`（`:292`），无校验（G6） | 由 76/80 确认 `config.company` 的地位；不一致时拒启或明报，不得静默双源 |
| `RunServeOpts` 类型身份 | daemon `run-serve-opts.ts`（80-§3.4） | 引用、`Pick`、不复制 | 三处内联类型、`RunServeOpts` 未再导出（G2） | 单点定义并经 `@studio-next/daemon/serve` 再导出（80-§3.4 第 6 条）；boot 侧只 `Pick`/引用，测试不得相对路径穿透 |
| `alias`→`room_id` 缓存 | `packages/matrix/src/broadcast.ts:83` 的面内闭包 | 不持有、不清空 | 无 | 缓存生命周期归 matrix；boot 不得为“复用”在外层再建缓存 |
| mention 首拉基线 | `packages/matrix/src/adapter.ts:79`–`:98` 的源内状态 | 不重置、不预置 | 无 | 基线归 matrix；boot 只构造源，不 start |

允许的共享只有三种形态：①调用内传引用（`deptSlugs`、`snapshot` 值；工厂闭包内的 `client` 只活一次 `runServe`）；②类型身份（`RunServeOpts`/`MatrixSessionFactory`）；③只读派生值（`deptSlugs`、`producerMxid`）。以下不算共享，也不得做：boot 缓存 `snapshot`（供给面必须每次 `ctx.snapshot()` 现取）、跨 `bootServe` 复用 `client`/token、在 boot 里复制 face 内部状态（alias 缓存、基线、ensure 结果）、用 boot 侧布尔标志模拟“已装配/已 ensure”幂等。

### 4.4 矩阵边界：四面归属

boot 与 `packages/matrix` 的边界是“装配 vs 实现”，不是“高层 vs 低层”。判据：**去掉 boot，matrix 包仍能独立被测；去掉 matrix，boot 只剩开关与参数翻译**。

| 能力 | 归属 | 现状锚 | boot 的角色 |
|---|---|---|---|
| HTTP/TLS、429 礼让重试、token 使用 | `packages/matrix/src/client.ts` | 78 `BIND-EDGE-MX-01` | 只把 `fetch` 封进工厂；不自行发请求、不判状态码 |
| 登录与 token 生命周期 | matrix client（工厂内实现）；调用归 daemon | `boot.ts:129`–`:158`（现状 boot 调） | **现状**校验必配键并登录一次；**目标**只构造工厂闭包，daemon 驱动登录，boot 不持 client/token、不刷新、不 logout（G8） |
| mention 轮询、首拉基线、自发消息抑制 | `adapter.ts:64`、`:79`–`:98`；`mentions.ts:228` | 78-§11.2 语义事实 | 工厂内只 `createMentionSource`；不 start/stop、不去重 |
| 接单去重、受理、状态迁移 | daemon/engine | 77 `RUN-WORK-01`、78-§11.2 幂等 | 不做 |
| 频道命名、ensure 幂等、PL | `provision.ts:186`/`:301`/`:404` | 130-P3 §6.7 | 工厂内只提供 `snapshot` 与 `deptSlugs`；不拼 alias、不算 PL |
| 广播 alias 解析、软失败与缓存 | `broadcast.ts:78`–`:83` | 105-刀B | 工厂内给 `client`/`slug`/`deptSlugs`/`botMxid`；不缓存、不重试 |
| 人事建号/入房/PL/踢出、ensure-shape | `hr-face.ts:77` | docs/52-§七 | 工厂内给 `client` + 建号凭据（`MatrixHrRegisterSecret`，来自 `deps.registration`）；不重造业务幂等 |
| “通知不是决定” | 77 §1.8、78-§11.2 | 78-§11.2 末段 | 不据通知做授权/验收/结清判断 |
| 授权、资格、验收、结清 | 引擎/网关/公司面 | 76/77 | 不推断、不预判 |
| E2EE | 未做（78 损失项） | 78-§11.2 | 不承诺、不补偿 |

相邻但**不在 boot** 的装配点（80 现行接口；本附录只标边界，不展开）：

| 对象 | 归属 | 与 boot 的边界 |
|---|---|---|
| `assembleApi`（`:8788`） | daemon `assembly/api/assemble.ts`（80-§9.4） | boot 不 import `api`、不装配、不开端口 |
| `IntentIngress`/`IntentReceipt` | daemon 内闭合（80-§6.6） | boot 不持 ingress、不产回执、不写 `REC-*` |
| `NotificationEnvelope` 投递封装 | daemon/contract（80-§6.6） | boot 只在工厂返回值里产 `NotifyBroadcastFace`；不封装投递、不计量 |
| `BindingProfile`/`mapState` | 78/80 绑定面（`BIND-CORE-01`） | boot 只构造 Matrix 边（`BIND-EDGE-MX-01`）的工厂，不实现绑定档案 |
| `openLedgerReadonly` | daemon assembly（80-§8.2） | boot 不读台账，不持只读句柄 |
| `ServeConfig.secrets` 与 `KnownSecretSet` | daemon（80-§3.3 第 6 条、§3.6 第 6 步） | boot 不读该键、不建集合、不 `load`、不判空值、不做轮换重建（§4.5） |
| 会话 `close()` | daemon（`runtime.stop`，先于 `ledger.close`） | boot 无句柄可关；工厂把 `close` 交给 daemon 调用 |

越界判负（任一条出现即设计失败，不是“待优化”）：

1. `boot.ts` 出现 Matrix 协议常量的判定分支（`sync` 超时、`retry_after_ms`、`M_FORBIDDEN`、`registration_shared_secret` 的错误码分支）——协议归 client/hr-face；注释除外。**例外**：工厂复核 `deps.login`/`deps.registration` 的判别位（`secretId`/`kind`/`use` 三槽逐字段比对，80-§3.4 第 10 条）是**句柄形状校验**，不是协议分支，允许且必须做。
2. `boot.ts` 自行拼房间 alias、计算 PL、维护“已 ensure”集合——命名与幂等归 provision。
3. `boot.ts` 跨 `snapshot` 变更缓存部门/人员数据——供给面必须活取。
4. `boot.ts` 维护 alias→room 缓存或发送重试——归 broadcast。
5. `boot.ts` 直连 homeserver（不经 `MatrixClient`）、读写台账、写公司目录、import `@studio-next/company`/`store`/`core`。
6. `boot.ts` **登录**、持 token/client 句柄、解析秘密值、出现 `process.env` 直读、把 `secrets`/`fetch`/`log` 透传给 `runServe`、或新增任何“值是秘密”的注入项（含 `BuildRuntimeOpts.secretProvider`）；也不得用 boot 侧状态替代 daemon 的开关校验。
7. `boot.ts` 构造 `KnownSecretSet`、写 `REC-LOSS-01`、做轮换/吊销重建、或把 `SecretMaterial` 放进任何可序列化结构（日志/错误/返回值/台账）。
8. `boot.ts` 在 `runServe` 的 opts 里**同时**给 `matrixSessionFactory` 与任一直接面（`matrixSource`/`matrixRoomFace`/`hrMatrixFace`/`notifyBroadcast`）——生产路径只能走工厂，兼容面只用于测试/迁移；boot 自己也不得靠“比较工厂返回值与面是否一致”决定取舍（启动期不可判，80-§3.4 第 10 条）。

边界不是“boot 什么都不做”：boot 必须做**工厂构造**（把 `MatrixClient`/mention 源/供给/广播/人事面的创建封进 `matrixSessionFactory`，登录时机交给 daemon）、**开关解释**（哪个面该装配、工厂还是直接给面）、**一次调用内的共享**（`deptSlugs`、`snapshot` 值）、**fail-fast**（开关与注入不匹配立即 reject）。这四件事在 matrix 包内做不了；在 daemon 内做会破坏“daemon 零 matrix import”。

### 4.5 秘密、路径、日志与失败分类

#### 4.5.1 秘密：boot 不接触

**现状**（env 直读，G5/G16）：

- bot 密码只从 env `MATRIX_BOT_PASSWORD` 读取（`boot.ts:144`）；hr 建号 shared secret 只从 `MATRIX_HR_SHARED_SECRET`（次选 `MATRIX_SHARED_SECRET`）读取（`boot.ts:322`）。两者**永不入** `daemon.yaml`、日志、台账、提示词、错误消息。
- 无 catalog、无 `use` 校验、无版本/轮换：值取到即用，boot 不记录来源（G5/G16）。
- boot 把密码直接交给 `MatrixClient.login`（`boot.ts:347`）、自己持 client；token 只留 client 内存，重启重登，不写盘。

**目标**（80-§3.3 第 6 条、§3.4 第 8/10 条、§3.6 第 6 步、§11.2.1）：

- 秘密配置面只有一个：`ServeConfig.secrets = { catalog: SecretCatalogEntry[]; fileRoot?; brokerBinding? }`，`catalog` 缺省 `[]`；出现内联值/未登记键/坏 `secretId` 即拒收。**boot 不读这个键**：它既不在 `BootOptions`，也不被 boot 从 `ServeConfig` 里取用。
- 装配期顺序归 daemon：按 catalog 与当前启用能力裁剪 → 解析 provider → `KnownSecretSet` → 取两型句柄（登录取 `SEC-MX-BOT-PASSWORD`/`platform-auth`，建号开启时另取 `SEC-MX-HR-SHARED`/`matrix-register`）→ 调 `matrixSessionFactory` 完成登录 → 之后才建 `IntentIngress`。boot 只提供工厂，不参与其中任何一步。
- **两型句柄，不可互换**（80-§3.4 第 10 条；`MatrixSessionFactoryDeps` 恰好有两个秘密槽位）：
  - `deps.login: MatrixBotLoginSecret` = `{ secretId: 'SEC-MX-BOT-PASSWORD'; kind: 'password'; use: 'platform-auth'; material }`——**只**用于 bot 登录；
  - `deps.registration?: MatrixHrRegisterSecret` = `{ secretId: 'SEC-MX-HR-SHARED'; kind: 'shared-secret'; use: 'matrix-register'; material }`——**只**用于人事建号，`hrMatrix` 开启时缺失即 `CONFIG_INVALID` 拒该能力，不得拿 bot 密码顶替，也不得改走 bot 管理 API（80 未定义该通道）。
  - 建号关闭时 `registration` 不给、该条 `load` 次数为 0；工厂收到判别位不符的句柄（`secretId`/`kind`/`use` 任一不符，或与 `material.secretId`/`material.kind` 不一致）⇒ `CONFIG_INVALID` 拒该能力，不降级、不换用途。
- **空值即失败**（80-§11.2.1）：`load` 取到空串/零字节 ⇒ `rejected_precondition` + `subcause:'secret-empty'` 且**不返回材料**；装配侧再判一次，空值不得进 `KnownSecretSet`、不得进登录/建号。boot 不判这一层（它拿不到 `load` 结果，只拿句柄）。
- **装配失败的启动语义**（80-§11.2.1 表，写死）：必需项 `Err` ⇒ `CONFIG_INVALID`（启动失败的统一归类），原始 `failure`/`subcause` 保留在 `detail`/审计行，不得改写成“缺失”；`matrixSessionFactory` 属 daemon 启动的必需面 ⇒ 整机拒启动。选项（能力未开/scope 外）`Err` ⇒ 不装配该能力 + 落 `REC-LOSS-01`（逐项写 `secretId` 与受影响能力），进程照常起。provider 不可用（句柄坏、broker 未就绪、文件不可读）⇒ `unavailable`（不是空值）；条目撤销/版本不符 ⇒ `rejected_version`。
- **轮换/吊销不只是重启**（80-§11.2.1）：触发源两个——① `file-ref` 文件 `mtime`/大小变化或 `SecretMaterial.version` 与当前集合不同；② 部署控制通道（`rotationRef`/`revocationRef` 指向的通知面）投递“重建”事件。命中即**整体重建** `KnownSecretSet`（不就地改元素），无通知时允许 ≥60s 的有界低频轮询（只 `stat`）。重建失败 ⇒ 保留旧可用集合继续脱敏、标 `known-set-partial`、落 `REC-LOSS-01`、**禁止该 `secretId` 的新用途**（已建会话不强制中断）；吊销优先于轮换；轮换只递增 `version`、不改 `secretId`。
- **能力关闭不加载**：矩阵/人事面关闭时 daemon 不 `load` 对应秘密、不调工厂；`broker-ref` 无已注册绑定按 `unavailable` 处置（80-§3.3 第 6 条）。
- access token **没有静态 `secretId`**、只在 client 实例内存、不进帧/日志/PRM/台账；进程重启即重登。
- boot 侧因此**没有**：`SecretCatalogEntry`/`SecretProvider`/`SecretMaterial`/`KnownSecretSet` 的类型引用，`load(entry, use)` 调用，provider 构造，`REC-LOSS-01` 写入，轮换重建，`process.env` 直读。boot **会**读句柄上的 `secretId`/`kind`/`use` 三个判别位做形状复核（80 要求“工厂内再复核”），但只比对字面量、不打印、不存、不派生。

**v0.3 的 `BootOptions.secrets` 提案已撤销**：80-§3.4 第 8 条明确**不新增**“值是秘密”的注入项（含 `BuildRuntimeOpts.secretProvider`），理由是注入项会变成第二条给进程喂秘密的通道，且 boot 一旦持有 provider 就能取任意 `secretId` 的值。测试需要假 provider 时用 daemon 内部测试注入点，不进 boot 公共面（§7）。

**v0.4 登记的缺口在 v0.5 关闭**（逐条，不再挂未决）：

- ~~`SEC-MX-HR-SHARED` 在 `MatrixSessionFactoryDeps` 里没有槽位~~ → 80 现行 §3.4 第 10 条已给 `registration?: MatrixHrRegisterSecret`，锁 `SEC-MX-HR-SHARED` + `matrix-register` + `kind:'shared-secret'`；建号缺失即拒该能力。**不走** bot 管理 API（80 未定义该通道）。
- ~~`load` 成功但空串算不算取到~~ → 80-§11.2.1 定为 `rejected_precondition` + `secret-empty`，不返回材料。
- ~~必需缺失是 `unavailable` 还是 `CONFIG_INVALID`~~ → 80 定为“启动语义 `CONFIG_INVALID`、原始 `failure` 保留”，provider 不可用才是 `unavailable`。
- 剩余只属**回写/对齐**：78-§7.4.1 的 catalog 条目与 80 的口径需一致（`SEC-MX-HR-SHARED` 的 `allowedUses` 含 `matrix-register`、`SEC-MX-BOT-PASSWORD` 的 `matrix-register` 保留未用），见 §8.3 第 5/6 项。

#### 4.5.2 路径

- `matrixDeptMap` 是部署配置里的文件路径，**消费方是 boot**（daemon 不读该文件）；基准目录 `baseDir` 属组合根显式入参，不进 `RunServeOpts`、不新增第三个键（80-§3.4 第 7 条）：
  - **`{ configPath }` 分支**：`baseDir = dirname(resolve(configPath))`——配置文件所在目录，**不是** cwd；
  - **`{ config }` 分支（生产）**：没有路径可推，`baseDir` 取 `BootOptions.deploymentBaseDir`（boot 自有类型，部署绑定给定，boot 侧再过 realpath/containment）；**缺省不得回落 `process.cwd()`**；配了 `matrixDeptMap` 而 `deploymentBaseDir` 缺失 ⇒ `CONFIG_INVALID`（本地 subcause `boot-deployment-base-missing`，§4.5.4）。
  - 现状 `path.resolve(jsonPath)` 以进程 cwd 为基准、无 containment/realpath/符号链接检查、错误带原样路径（G4）。
- 按 80-§11.3 第 1、2 条补 containment（`resolve` + `relative` 不以 `..` 开头）与 realpath（先解符号链接再判 containment）；逃逸判 `rejected_forbidden` + `EXTERNAL_REJECT`。第 3 条（写入原子性）boot 不适用——它只读不写。
- 路径不推授权（80-§11.3）：`configPath`/`deploymentBaseDir` 只做 resolve + 读取；能读到不等于有权读，boot 不据路径放行任何能力。
- `deptMap` 单读一次、供给面与广播面共用同一派生结果（§4.3）。`matrixDeptMap` 缺失/越界/不可读 ⇒ `CONFIG_INVALID` 拒启；错误只留 `err.code` 与键名（`matrixDeptMap`），不得带绝对路径（80-§3.4 第 7 条末、§11.6）。

#### 4.5.3 日志

只允许出现：房间白名单、部门映射条数、制作人 MXID、装配面名称、路径选择（“工厂路径”/“直接面路径”）与开关值。**不得**出现：密码、shared secret、access token、`SecretMaterial.value`、完整请求体、内部绝对路径、堆栈原文（80-§11.6）。`secretId`、加载数量、`KnownSecretSet.state`、轮换触发与 `version` 变化由 **daemon** 在装配期/重建时打印（80-§3.6 第 6 步、§11.2.1）；boot 只在工厂内**比对**句柄判别位，不打印 `secretId`、不打印句柄内容。`log` 由调用方注入，boot 不写文件、不写台账；daemon 的日志面不归 boot。

#### 4.5.4 失败分类（boot 本地 subcause）

boot 的构造期失败一律抛 `ClassifiedError`（80-§5.7 允许“构造期非法”抛），字段两轴分开：`failure` 决定处置，`category` 只喂聚合。`Err` 可达的 6 个 `category` 之外一个都不用；内部编程错误（断言失败、不可达分支）**不包装成业务失败**：按 80-§5.7 用原生 `Error`（仅“绝不该发生”的断言），需要机器可读细目时用 `subcause:'internal-bug'`，**不造第 15 个 `failure`**。

| 触发 | `failure`（77） | `category` | `subcause`（boot 自定，稳定命名） |
|---|---|---|---|
| 配置不可读/YAML 形状错/开关组合非法（`hrMatrix && !hrSync`）/角色键空或重复/slug 不一致 | `rejected_precondition` | `CONFIG_INVALID` | `boot-config-unreadable`、`boot-config-invalid`、`matrix-hr-matrix-without-hrsync`、`matrix-roles-empty`、`matrix-roles-duplicate`、`matrix-company-slug-mismatch` |
| 矩阵面开但既未给面也未给工厂 | `rejected_precondition` | `CONFIG_INVALID` | `matrix-session-factory-missing` |
| 工厂与任一直接面（`matrixSource`/`matrixRoomFace`/`hrMatrixFace`/`notifyBroadcast`）**同时给** | `rejected_precondition` | `CONFIG_INVALID` | `matrix-session-factory-coinjected`（不再叫 `-conflict`：不判“矛盾”，只判“并存”） |
| 工厂返回形状不合（缺四个面之一/缺 `close`/判别位不符） | `rejected_precondition` | `CONFIG_INVALID` | `matrix-session-factory-shape` |
| `{ config }` 分支配了 `matrixDeptMap` 却未给 `deploymentBaseDir` | `rejected_precondition` | `CONFIG_INVALID` | `boot-deployment-base-missing` |
| `deptMap` containment 失败/符号链接逃逸 | `rejected_forbidden` | `EXTERNAL_REJECT` | `boot-path-escape` |

**不属 boot 本地表**（列在这里只为了避免误挂）：登录被拒/429 耗尽/超时/`use ∉ allowedUses`/`secret-empty`/`unavailable`/`rejected_version`/必需秘密缺失/配置在装配期被改——这些发生在 daemon 的装配期与工厂内部，归 80-§3.6 与 `runServe` 的失败面；boot 不包装、不改写、不重试，也不把 daemon 的 `CONFIG_INVALID` 再包一层。boot 也不再有“配置在装配期被改”这一行：生产走 `{ config }` 单读之后不存在双读窗口（§4.6）。

`detail` 只写配置键名、面名称、路径键名，不写值、不写绝对路径。boot 不落 `REC-*`、不开单、不重试（重试归 matrix client 的礼让；装配期失败直接 reject）。

### 4.6 启动与停机

- boot 不是启动序列的所有者。启动 10 步（80-§3.6）属于 `runServe`；boot 只在其前面完成“部署侧能力装配”，把工厂交给 `runServe`。
- **顺序判据**：boot 先拿到配置（生产由调用方给 `{ config }`，不再自己读盘），再调 `runServe({ config }, opts)`；80-§3.4 第 7 条的判别联合使“boot 读一次、daemon 再读一次”在设计上消失（G1 只剩代码未改）。第 2–5 步（开台账+迁移、在途接管、公司目录装载、平台探针）与第 6–7 步（秘密+会话装配、`IntentIngress`、`assembleApi`）**都不是 boot 的动作**；boot 若替 daemon 做其中任何一步，属于越界（§4.4），不是“帮忙”。
- 第 6 步内部的次序由 daemon 决定：先按 `ServeConfig.secrets` 载 provider → `KnownSecretSet` → 构造 `MatrixBotLoginSecret`（建号开启时再构造 `MatrixHrRegisterSecret`）→ 调 `matrixSessionFactory` 登录拿到四个面 + `close()`，然后才建 `IntentIngress`。**boot 不在这个序列里**：它构造工厂时既不知道密码、也不知道 catalog，只在工厂被调用时复核两个句柄的判别位。
- boot 自己不读配置的次数固定为**一次**：`{ configPath }` 分支读一次 YAML 交给解析器，同一次结果既供开关判断也供 `matrixDeptMap` 键取用；`{ config }` 分支零次读盘。`deptMap` 的基准 `{ configPath }` 用 `dirname(resolve(configPath))`、`{ config }` 用 `BootOptions.deploymentBaseDir`（§4.5.2），不因取基准再解析一次 YAML。
- boot 不注册信号处理、不 `process.exit`、不关闭台账、不停止 source、不持有会话句柄。source 的 `start/stop` 由 daemon 的源注册表管理；boot 只构造 source 工厂。会话 `close()` 由 daemon 的 `runtime.stop` 调用，**先于 `ledger.close`**（80-§3.4 第 10 条）——boot 无句柄可关。
- 任一步装配失败，boot（或 daemon）直接 reject，不进入下一步。boot 侧失败只会发生在“开关与注入不匹配/工厂形状不合/配置与 deptMap 校验”，此时没有任何会话被建立，也没有 token 需要清理。

### 4.7 构建与分发

- `apps/boot` 是 `private: true` 的仓内应用，79-§6.1 明确 **daemon/boot 不纳入 dist 分发集合**，维持 `src`。因此 boot 不需要 `tsconfig.build.json`，也不需要 JS + `.d.ts`；DSH 能力包的“JS + `.d.ts`”要求不适用于 boot。
- 根 `tsconfig.json` 的 `include` 覆盖 `apps/*/src/**/*.ts`，因此 boot 的 `src/**`（包括目标 `src/test/**`）在根 `tsc --noEmit` 内；这与 79-D10 所说“包根 `test/` 目录不进 typecheck”不是同一类：boot 的目标测试在 `src/test/` 下，仍被 `src/**` 覆盖。
- 若未来把 boot 纳入分发（79-§6.1 当前结论是不纳入），必须先完成 L0–L6 的 dist 闭包，boot 只能在 L7；同时把 boot 包级 `tsc --noEmit -p` 显式并入根 `typecheck`。本文不预建该构建面。

### 4.8 上位接口与 boot 的对照

逐个核对 80 现行接口里“会落到装配层”的那些，写明 boot 是消费、产出，还是不承载。判据只有一条：**boot 是组合根，不是端口实现方**——它可以让端口拿到实现，自己不能变成端口。

| 上位接口/类型 | 出处 | boot 的角色 | 边界 |
|---|---|---|---|
| `ServeConfig` / `parseDaemonConfig` | 80-§3.3 | 调用 | 唯一解析器在 daemon；boot 不另写解析器、不另定键。生产由调用方给已解析 `config`，boot 不读 yaml |
| `ServeConfig.secrets` | 80-§3.3 第 6 条 | **不承载** | 秘密配置面只在 daemon；boot 不读该键、不校验 catalog |
| `runServe` 的入参判别联合（`{ configPath } \| { config }`，类型名由 17 定） | 80-§3.4 第 7 条 | 产出 | boot 传 `{ config }`；不传两键、不做双读 |
| `matrixDeptMap` 的 `baseDir` 归属 | 80-§3.4 第 7 条 | **承载（boot 自有 `BootOptions.deploymentBaseDir`）** | 不进 `RunServeOpts`、不新增第三个键；`{ configPath }` 用 `dirname(resolve(configPath))`、`{ config }` 用显式入参；不回落 cwd |
| `RunServeOpts`（5 键） | 80-§3.4 | 引用（`Pick` 或直用为 `serve` 签名） | 单点定义在 `run-serve-opts.ts` 并经 `@studio-next/daemon/serve` 再导出；boot 不扩键、不抄第三份；**工厂与任一直接面不同时给** |
| `MatrixSessionFactory` / `MatrixSessionFactoryDeps` / `MatrixBotLoginSecret` / `MatrixHrRegisterSecret` | 80-§3.4 第 10 条 | **产出**工厂、消费类型、复核句柄判别位 | 只构造并注入；不驱动登录、不造句柄、不持 token；两型句柄不可互换（§4.5.1） |
| `BuildRuntimeOpts`（`log`/`clock`/`quarantineMs`/`hrKnownSecrets`/`evolveSelfCheck`） | 80-§3.4 | **不承载** | 装配件注入归 daemon；boot 不递、不覆盖，也不新增 `secretProvider` |
| `ClassifiedError`（`failure`×`category`×`subcause`×`detail?`） | 80-§5.7 | 抛 | 不定义类型、不新增 `failure` 值；映射见 §4.5.4 |
| `RuleEvaluator`（`TS-PORT-RULE-01`） | 80-§6.1 | **不承载** | 规则求值归 `core` 纯函数；boot 不判规则、不读公司定义 |
| `WorkIntake` / `IntentIngress` / `IntentReceipt` | 80-§6.6（`TS-PORT-WORK-01`/`TS-PORT-API-01`） | **不承载** | boot 不持 ingress、不产回执、不写 `REC-*` |
| `assembleApi` / `openLedgerReadonly` | 80-§9.4 / §8.2 | **不承载** | 不开 `:8788`、不读台账、不 import `api`（§4.4） |
| `NotificationEnvelope` | 80-§6.6 | **不承载** | 只在工厂返回值里产 `NotifyBroadcastFace`；投递封装与计量归 daemon |
| `ProjectionName` / `TxReceipt` / `MigrationPlan` | 80-§6.3 / §6.6 | **不承载** | 台账与迁移面全部在 daemon/store |
| `BindingProfile` / `mapState` | 78（`BIND-CORE-01`） | **不承载** | boot 只构造 `BIND-EDGE-MX-01` 的四个 Matrix 面（经工厂返回） |
| `SecretCatalogEntry` / `SecretProvider` / `SecretMaterial` | 80-§11.2.1 | **不承载** | 全在 daemon 装配期；boot 不 `load`、不建 catalog、不解析 `valueProvider`、不判 `secret-empty`（§4.5.1） |
| `KnownSecretSet`（`state`/`missingSecretIds`/脱敏方法） | 80-§11.2.1 | **不承载** | 归 daemon 装配期；boot 不写 `REC-LOSS-01`、不做轮换/吊销整体重建（§4.5.1） |
| `InvokeSource` / `MatrixRoomFace` / `NotifyBroadcastFace` / `MatrixHrFace` | 80-§3.4 / 78 | **产出（作为工厂返回值的一部分）** | 开关开就必须给（面或工厂）；开关关就不给；`hrMatrixFace` 是 `() => MatrixHrFace` |
| `Digest`/`semanticDigest`（`TS-SCALAR-08`）、`dayKeyOf`/`DAY_MS` | 80-§4.1 | **不承载** | boot 不摘要、不算日键 |

这张表的用处是排除，不是罗列：凡本表写“不承载”的，§5 的条目里出现对应调用即为设计失败，不需要再讨论“顺手也能做”。

---

## 五、生产文件条目

### F-boot-boot

**路径/处置**：`apps/boot/src/boot.ts`；现有；目标-保留（内部收口，不新增公共概念、不新增依赖边）。

**上位锚**：80-§1.1（三层装配）、§2.1（boot 不是包层）、§3.1（入口/组合根分工）、§3.3（`ServeConfig` 唯一）、§3.4（`RunServeOpts`、第 7 条 `deploymentBaseDir`、第 10 条两型句柄）、§3.6（启动/停机）、§5.7（错误形态）、§11.2（秘密）、§11.2.1（`secret-empty`/装配失败语义/轮换）、§11.3（路径）、§11.6（日志）、§12.1（通信绑定接缝）；78 `BIND-EDGE-MX-01`；77 `RUN-WORK-01` 与 §1.8（意图入口、通知不是决定）；76 `DEF-CFG-01`、`DEF-PKG-05`；75 D75-11、D75-13。

**职责**：

- 接收调用方给的配置：生产路径是已解析的 `{ config }`（并带 `deploymentBaseDir`），手动/测试路径是 `{ configPath }`；boot 不重复读盘（§4.6）；
- 按开关**构造 `matrixSessionFactory`**：把 `MatrixClient` 的创建与 login、mention 源、频道供给面、notify 广播面、人事面的创建封进一个闭包；**登录由 daemon 调工厂时触发**，boot 不调；
- 把工厂（以及兼容路径下的四个面）注入 `runServe(input, opts)`（`input` 由收到的 `config` 或 `configPath` 原样组装，`{ config }` 分支不二次读盘、`{ configPath }` 分支只读一次）；工厂路径下生产只传 `matrixSessionFactory`；
- 在全部开关关闭时透传 `runServe`，不构造工厂、不注入、不读 deptMap；
- 保持“部署侧能力装配”这一身份：只把 matrix 能力组织成 daemon 可调用的形状，不参与任何事实源写入。

**非职责**：

- 不解析 YAML（除调用 daemon 解析器）、不定义 `ServeConfig` 的第二份影子类型；
- **不接触秘密值**：不读 `ServeConfig.secrets`、不出现 `SecretCatalogEntry`/`SecretProvider`/`SecretMaterial`/`KnownSecretSet`、不 `load`、不建集合、不判 `secret-empty`、不写 `REC-LOSS-01`、不做轮换/吊销重建、不读 `process.env`（§4.5.1）。**例外且必须做**：工厂内复核 `deps.login`/`deps.registration` 的 `secretId`/`kind`/`use` 三个判别位（80-§3.4 第 10 条），只比对字面量、不打印、不存；
- **不驱动登录、不持 token**：装配期不发 login 请求；登录动作被封装在 `matrixSessionFactory` 内，**只由 daemon 调用时执行**（80-§3.4 第 10 条）；boot 不保存 client/token、不做“装配期登录一次换共享 client”那套，会话生命周期归 daemon（§4.4）；
- 不读台账、不写公司目录、不写 SQLite、不派工、不做路由/去重/计量；
- 不判断授权、资格、验收、结清；不把 Matrix 通知当决定；
- 不启动/停止 source，不处理信号，不决定进程退出码；
- 不装配 API、panel、company、store；不 import `@studio-next/api`；
- 不实现 Matrix 协议细节（轮询、首拉基线、去重、ensure 幂等、alias 解析、PL、建号收敛）——归 `packages/matrix`（§4.4）；
- 不缓存公司快照、不跨调用复用 `client`、不复制 face 内部状态（§4.3）；
- 不把 `fetch`/`log` 下沉给 `runServe`，不构造 daemon 的装配件注入，不新增任何“值是秘密”的注入项（§4.2）。

**内部结构与输入输出**：

| 符号 | 形态 | 输入 | 输出/默认 | 关键约束 |
|---|---|---|---|---|
| `MATRIX_BOT_PASSWORD_ENV` / `MATRIX_HR_SHARED_SECRET_ENV` | 导出常量（现状，`boot.ts:47`/`:55`） | — | `'MATRIX_BOT_PASSWORD'` / `'MATRIX_HR_SHARED_SECRET'` | **目标删除**：boot 不读 env，两条 env 名常量随 `env` 一起退役；boot 只在工厂里比对 daemon 传入句柄的 `secretId`/`kind`/`use` 判别位，不持有自己的 `secretId` 常量 |
| `DEFAULT_PRODUCER_MXID` | 导出常量 | — | `'@opengames:localhost'` | 制作人缺省 MXID；是部署缺省，不是授权 |
| `BootOptions` | 导出类型（现状为 interface；目标为判别联合交叉类型） | 调用方传入 | 无默认对象 | `= ({ configPath: string } \| { config: ServeConfig }) & { deploymentBaseDir?: string; fetch?; log?; serve? }`——判别联合必填其一（80-§3.4 第 7 条；`ServeConfig` 由 `@studio-next/daemon/serve` 导出），`main.ts` 的 `bootServe({ configPath })` 调用形状不变；`{ config }` 分支且配了 `matrixDeptMap` 时 `deploymentBaseDir` 必填（缺失 `CONFIG_INVALID`）；`fetch` 缺省 `globalThis.fetch`；`serve` 缺省 `runServe`；`log` 缺省 `console.log`；**目标无 `env`、无 `secrets`** |
| `BootOptions.serve` | 内联函数类型 | `input` + opts | `Promise<ServeResult>` | 直用已再导出的 `RunServeOpts`：`(input: { configPath } \| { config }, opts?: RunServeOpts) => Promise<ServeResult>`；不得再抄子集 |
| `createMatrixSessionFactory`（**命名由实现单定**） | 导出函数（**目标新增**） | `ServeConfig` + 部署侧 `{ deploymentBaseDir, fetch, log }` | `MatrixSessionFactory`（deps 收 `homeserverUrl`/`botUserId`/`login: MatrixBotLoginSecret`/`registration?: MatrixHrRegisterSecret`/`userAgent?`） | 只构造闭包，不登录；返回 `{ matrixSource, matrixRoomFace, hrMatrixFace, notifyBroadcast, close }`，逐字段等于四个现有工厂/面；开关全关时不构造；被调用时复核两个句柄判别位 |
| `MatrixAssembly` | 导出 interface（现状） | — | `{ client, source }` | 工厂内部用；目标是否继续导出由实现单定（无跨包下游） |
| `AssembleOptions` | 非导出 interface | — | 可选 `fetch`/`log`/`login` | `login` 在目标态是**工厂内一次登录的结果**（`MatrixBotLoginSecret.material`），不是 env 派生；不带 `env` |
| `splitSemicolonList` | 非导出纯函数 | `string ｜ undefined` | `string[] ｜ undefined` | 按 `;` 切、trim、剔空段；全空返回 `undefined`；不支持转义 |
| `parseMatrixRoles` | 导出函数 | `string ｜ undefined` | `Record<string, PersonId> ｜ undefined` | `角色词=工号`；第一个 `=` 分隔；空键/空值/重复键一律抛（`matrix-roles-empty`/`matrix-roles-duplicate`），不再后者覆盖前者 |
| `assembleMatrixLogin` | 导出 async 函数 | `ServeConfig`、`MatrixBotLoginSecret`、`switchName` | `{ client: MatrixClient; botMxid: string }` | **只在工厂闭包内被调用**；先复核 `secretId==='SEC-MX-BOT-PASSWORD'`/`kind==='password'`/`use==='platform-auth'`；密码只作为 `MatrixClient.login` 的实参；不写日志、不缓存 |
| `assembleMatrixSource` | 导出 async 函数 | `ServeConfig`、可选 `AssembleOptions` | `MatrixAssembly` | `matrix:false` 调用即抛；构造 mention 源；不启动源 |
| `loadDeptSlugs` | 导出同步函数 | `string ｜ undefined` + `baseDir: string`（目标，必填形参） | `Record<string, string>` | 同步读文件；扁平 `path→slug`；空对象/坏 slug/读失败/非 JSON 均抛；目标按 `baseDir` 解析（`{ configPath }` 用 `dirname(resolve(configPath))`、`{ config }` 用 `deploymentBaseDir`）+ realpath + containment，错误只留 `err.code` |
| `assembleMatrixProvisionFace` | 导出 async 函数 | `ServeConfig`、`deptSlugs`、可选 `AssembleOptions` | `(ctx: MatrixRoomFaceContext) => MatrixRoomFace` | `matrixChannels:false` 调用即抛；每次 `ctx.snapshot()` 活取公司快照；不再自读 deptMap |
| `assembleMatrixBroadcastFace` | 导出同步函数 | `ServeConfig`、`deptSlugs`、`AssembleOptions & { login }` | `NotifyBroadcastFace` | `matrixChannels:false` 调用即抛；不再自读 deptMap；`slug` 与供给面单一源或交叉校验 |
| `assembleMatrixHrFace` | 导出 async 函数 | `ServeConfig`、`MatrixHrRegisterSecret`（`deps.registration`，§4.5.1）、可选 `AssembleOptions` | `MatrixHrTarget` | `hrSync+hrMatrix` 未开即抛；复核 `secretId==='SEC-MX-HR-SHARED'`/`kind==='shared-secret'`/`use==='matrix-register'`；凭据只进闭包；env 的“次选名回退 + 空串短路”分支随 env 一起消失 |
| `bootServe` | 导出 async 函数 | `BootOptions` | `Promise<ServeResult>` | 取 `input`（由 `config` 或 `configPath` 组装成判别联合）→ 定 `baseDir` → 读一次 deptMap → 按开关构造工厂 → `runServe(input, opts)`；不登录、不读秘密值、不捕获、不清理 |

**导出与允许依赖**：

- 现状导出 13 个符号（含两个 `MATRIX_*_ENV` 常量）；目标约 12 个：**去掉两个 env 常量、新增一个构造工厂的导出**（命名由实现单定），`MatrixAssembly` 是否保留由实现单定。实测引用点只有 `boot.ts` 自身与 `boot.test.ts`，无跨包下游。
- 实际 import：`node:fs` 的 `readFileSync`、`node:path`、`@studio-next/contract` 的 `InvokeSource`/`PersonId` 类型、`@studio-next/daemon/serve` 的 `parseDaemonConfig`/`runServe`/`RunServeOpts`/`MatrixSessionFactory`/`MatrixSessionFactoryDeps`/`MatrixBotLoginSecret`/`MatrixHrRegisterSecret`/`MatrixRoomFace`/`MatrixRoomFaceContext`/`NotifyBroadcastFace`/`ServeConfig`/`ServeResult`、`@studio-next/matrix` 的 `MatrixClient`/`createMentionSource`/`createMatrixProvisionFace`/`createMatrixBroadcastFace`/`createMatrixHrFace`/`ChannelMapInput`/`FetchLike`/`MatrixHrTarget`。**两型句柄与 `SecretMaterial` 只作为 daemon 侧类型出现在工厂签名里**（由 `daemon/serve` 导出），boot 不 import `contract` 的秘密端口、不 import `SecretProvider`/`SecretCatalogEntry`/`KnownSecretSet`。
- 目标 import 不新增包：仍只有三条出边。不得 import `@studio-next/daemon` 包根、`daemon/engine`、`api`、`panel`、`company`、`store`、`core`、`gateway`。
- 类型身份：`MatrixHrTarget`（matrix）与 daemon 的 `MatrixHrFace` 是结构同形；`NotifyBroadcastFace`（daemon）与 `createMatrixBroadcastFace` 返回值是结构同形；`MatrixRoomFace`（daemon）与 `createMatrixProvisionFace` 返回值是结构同形。boot 不复制这些接口，只做结构匹配。

**IO 与注入**：

- 文件：`configPath` 分支下 `readFileSync(path.resolve(configPath))` 读 daemon.yaml（**全流程仅此一次**，同一次结果供开关判断与 `matrixDeptMap` 键）；`config` 分支不读；`loadDeptSlugs(matrixDeptMap, baseDir)` 同步读 JSON，`baseDir` 在 `{ configPath }` 分支取 `dirname(resolve(configPath))`、`{ config }` 分支取 `deploymentBaseDir`；均无 fs 注入，测试用真实临时文件。
- 注入面清单以 §4.2 为准：入向 `config`/`configPath`（判别联合，二选一）+ `deploymentBaseDir`（`{ config }` 分支必填）/`fetch`/`log`/`serve`；出向 `matrixSessionFactory`（生产）+ 四键（测试/迁移兼容，与工厂**互斥**）。boot 不把 `fetch`/`log` 写进 `RunServeOpts`。
- 网络：仅经 `MatrixClient`（login、sync、send、房间管理），且全部发生在工厂被 daemon 调用之后；fetch 可注入，缺省 `globalThis.fetch`；boot 不直接调用 fetch，也不拼 URL。
- 秘密：**无值**。boot 不读环境变量、不读 `ServeConfig.secrets`、不 `load`、不判空、不做轮换重建。登录取 `deps.login.material`、建号取 `deps.registration.material`，都只在工厂调用期内可达，用完即随闭包结束不可达（§4.5.1）。现状 `options.env ?? process.env` 直读两个 env 名——**待退役**形态，不在目标形状里。
- 日志：`options.log`；`bootServe` 缺省 `console.log`，各装配函数缺省无操作；只打面名称与路径选择（工厂/直接面），不打 `secretId`、不打值。
- 时间/ID/随机：N/A（无自造时间、ID、nonce；login device id 由 homeserver 返回）。
- CLI：N/A（`main.ts` 负责 argv；`boot.ts` 不读 argv）。
- 子进程：N/A（不 spawn）。
- 信号：N/A（不注册；由 `runServe` 处理）。

**状态、并发、恢复**：

- 无事务、无台账、无幂等键；boot 不写任何事实源。
- 会话：boot 只构造闭包；daemon 在启动第 6 步调工厂**一次**，拿到四个面 + `close()`（80-§3.6）。boot 不登录、不持 client/token、不持 `close` 句柄。
- token：只存在于工厂闭包里的 `MatrixClient` 实例；`close()` 由 daemon 的 `runtime.stop` 调用、**先于 `ledger.close`**；进程重启即重登。boot 不缓存 token，也不跨 `bootServe` 复用实例。
- 供给面：闭包持有 `client`/`botMxid`/`deptSlugs`/`producerMxid`；`ctx.snapshot()` 每次现取，所以公司目录热重载后下拍供给可新鲜；boot 不缓存 `snapshot`。daemon.yaml 的 matrix 键不热重载，改键须重启。
- 广播面：闭包持有 `client`/`slug`/`deptSlugs`/`botMxid`；`alias`→`room_id` 缓存与失败重解析在 `packages/matrix/src/broadcast.ts:83` 的面内闭包（无上限、无 TTL），boot 不持有、不清空、不复用（§4.4）。
- 人事面：闭包持有 `client` 与建号凭据（`MatrixHrRegisterSecret`，来自 `deps.registration`）；ensure-shape 幂等由 `packages/matrix` 的 `hr-face.ts` 承担，boot 不重造。
- 秘密：`deps.login.material` 与 `deps.registration?.material` 只在**工厂调用期内**可达；不写盘、不进日志、不进闭包之外的结构、不跨调用缓存（§4.5.1）。boot 不持 `KnownSecretSet`，因此不存在“集合何时重建”的问题；轮换/吊销（文件 `mtime`/`version` 变化或部署控制通道 → daemon 整体重建）boot 无感，绝不据此重启或重建自己的状态。
- 共享源：`deptSlugs` 现状由供给面与广播面**各读一次**（G6）；目标是在 `bootServe` 内读一次后传参共享。`slug` 现状同样双源（`config.company` 与 `snapshot.slug`，G6）。
- 并发：JS 单线程；无锁、无队列、无 fencing。两个 `bootServe` 并发/先后调用会各自 `runServe`、各自调工厂登录；boot 没有“单实例”保护，库调用方负责（G8）。
- 取消/超时：boot 无取消令牌；工厂登录的超时/取消归 daemon（80-§3.6）；Matrix client 只对 429 做一次礼让重试，其余错误直接抛。
- 恢复：进程重启 → 重新取配置 → 重新构造工厂 → daemon 重新登录；没有断点续传或 token 刷新，也没有“接着上次 client 用”的路径。

**错误、秘密与观测**：

- 现状所有配置错误都是**裸 `Error`**，消息以 `CONFIG_INVALID：` 开头；既没有 typed `category`，也没有 `failure`/`subcause`（80-§5.7 的两轴目标）。
- 目标按 80-§5.7 抛 `ClassifiedError`，映射**不再逐条等 80 注册 subcause**：§4.5.4 已给出 boot 本地 subcause 表（`boot-config-invalid`、`matrix-hr-matrix-without-hrsync`、`matrix-session-factory-missing`/`-coinjected`/`-shape`、`boot-deployment-base-missing`、`boot-path-escape`），`failure`×`category` 按 80 缺省表取值。**唯一仍待上位的是构造入口**：现状 `configInvalid(subcause, detail)` 只给 `category`+`subcause`，缺 `failure` 轴（80-§5.7 要 `failure` 必填）；boot 不自造两轴构造器（§8.3 第 18 项）。
- 工厂与 daemon 侧返回的错误**原样上抛**：boot 不把 `rejected_forbidden` 改写成 `rejected_precondition`、不吞 `unavailable`、不重试、不落台账；登录失败、缺建号句柄、`secret-empty`、`unavailable`、`rejected_version` 与必需秘密缺失都归 daemon/工厂的失败面（§4.5.4 末）。daemon 已把必需项失败归为 `CONFIG_INVALID` 并把原始 `failure`/`subcause` 放进 `detail`，boot 不再包一层。
- 错误消息包含：开关名（`matrix`/`matrixChannels`/`hrMatrix`）、缺的配置键（含 `deploymentBaseDir`）、`matrixDeptMap` 的**键名**（不是路径）、`err.code`。**不出现** `secretId` 值、密码/secret/token、绝对路径（80-§11.6）；工厂复核判别位失败时只报“句柄判别位不符 + 槽位名（`login`/`registration`）”，不回显 `secretId`。
- 观测只有日志行：房间白名单、部门映射条数、制作人 MXID、各面已装配、路径选择（工厂/直接面）。登录成功、`secretId`、加载数量、`KnownSecretSet.state` 与轮换/重建事件由 daemon 打（80-§3.6、§11.2.1）。没有事件、指标、健康检查、请求 id。
- 不把日志里的“已装配”当成“频道已确保”或“登录已被授权”；供给面的真实 ensure 结果只在 daemon 启动期/热重载的报告里。

**测试与证据**：

- 现有覆盖（**现状**）：`F-boot-test` 的 35 个用例，覆盖登录请求体、缺密码/缺 homeserver/缺 userId、开关面不一致、roles 解析、deptMap 装载、供给面三方法存在、广播面 `send` 存在、人事面四方法存在、`bootServe` 的单开/双开/三开/仅频道/仅人事/全关注入形状，以及 daemon 零 matrix import 与 payload 形状。
- **目标态这些用例要改口径**：登录请求体/缺密码/缺 homeserver 三类转成“工厂契约”断言（deps 形状、返回值四工厂+`close`、boot 侧零 login 调用），不再断言 boot 自己登录；新增“boot 源码零 `process.env`、零 `SecretProvider` 引用”的静态断言。
- fake 边界：`fakeFetchWithLogin` 回放固定 JSON，不真实联网；`serveStub` 只捕获 opts，不跑 `runServe`；`demoSnapshot` 是静态对象，不经过公司目录校验。假 provider（若需要）只在 daemon 侧测试注入点，不进 boot 公共面。测试绿只证明装配形状，不证明真实 Matrix、真实 daemon 启停、真实频道幂等或秘密脱敏。
- R/E/W：**82 已落地**（`docs/82-技术细节-验证迁移与追溯.md`），但未给 boot 的 R/E/W 映射（全文无 `boot` 命中）；本文不私设编号，待 82 补。V 层：V0/V1 可由静态扫描与 `tsc` 承担（本次未跑）；V2 由 fake harness 承担；V5 真机未做（78 `BIND-EDGE-MX-01` 的 V5 缺口）。
- 目标补测：见 §8.2。重点包括 roles 空白键/值、deptMap 路径基准/containment（含 `deploymentBaseDir`）、snapshot 可选字段与活取、单次 deptMap 装载、工厂形状与开关匹配、错误不含秘密/路径、双重 `bootServe` 行为、注入边界（工厂与四键互斥，并存即拒）、矩阵/秘密边界与工厂导出静态断言（§8.2 C1/C2/C3）。

**规模与迁移**：

- 现状 376 行，13 个导出，8 个函数；在 600 行内，不拆分。目标约 12 个导出（去掉两个 env 常量、新增一个工厂构造导出）、行数预计 +40～+80（删登录/秘密分支、加工厂与形状校验、加 `deploymentBaseDir` 与两型句柄复核），仍 ≤500（阈值 600）。
- 目标内部收口顺序（不可倒；前一步不绿不做后一步；前两步在 daemon 侧）：
  1. **daemon 侧接口**：`runServe` 收 `{ config }`/`{ configPath }` 判别联合、`RunServeOpts` 补 `notifyBroadcast` 与 `matrixSessionFactory`、类型经 `@studio-next/daemon/serve` 再导出（80-§3.4 第 6/7/10 条已定，代码未做）；
  2. **daemon 侧秘密与会话**：`ServeConfig.secrets` + provider + `KnownSecretSet` + 两型句柄（`MatrixBotLoginSecret`/`MatrixHrRegisterSecret`）+ 工厂登录 + 空值/轮换语义（80-§3.3 第 6 条、§11.2.1）；
  3. **boot 切工厂**：构造 `matrixSessionFactory` 并注入（被调时复核两型句柄判别位），删 `env` 直读、删装配期登录与共享 client、四键直接注入降为测试/迁移兼容且**与工厂互斥**；
  4. `parseMatrixRoles` 空键/空值/重复键拒启（不依赖外部）；
  5. `deptMap` 单读一次、供给/广播共享；`slug` 交叉校验或单源；`hrMatrix && !hrSync` 拒启；
  6. 路径基准（`deploymentBaseDir`）/containment/realpath（依赖 80-§3.4 第 7 条与 §11.3）；
  7. 错误改 `ClassifiedError`（依赖 80-§5.7 的两轴构造入口；subcause 用 §4.5.4 表）；
  8. 测试拆分与用例改工厂契约（§8.2 的 A/S/C 组 + §7 目标件）。
  每一步单独提交、单独跑 typecheck/test/guard；不改变 Matrix 面的运行时语义。
- 回退：任一步失败，回退该步。第 3 步失败可回到**纯直接面路径**（四键一起用、不给工厂；兼容面本就保留），但**不得**把“boot 读 env 取密码”当作回退路径——秘密只有 daemon 一条来源（§4.5.1）；也**不得**回到“工厂与面并存、让 daemon 择一”的形态（80-§3.4 第 10 条判 `CONFIG_INVALID`）。

**本文件已核出的现状缺陷/风险（均为设计输入，不是已修）**：

1. `bootServe` 先读一次配置（`:336`），`runServe` 内部再读同一文件（`serve.ts:1470`），两次读取之间文件可变，存在 TOCTOU：可能按旧配置装配，却让 `runServe` 按新配置决定“开而未注入”或忽略已装配面。80-§3.4 第 7 条已定判别联合（boot 传 `{ config }`），**代码仍双读**（G1）。
2. 类型身份三份未收口：`BootOptions.serve` 现状内联三键（缺 `hrMatrixFace`）、`RunServeOpts` 现状只有三键（无 `notifyBroadcast`/`matrixSessionFactory`）、测试用相对路径 import `run-serve-opts.ts`。80-§3.4 第 6/10 条已定目标（5 键 + 再导出 + 禁止穿透），**代码未改**（G2）。
3. `parseMatrixRoles` 只检查原始字符串的 `=` 位置：`' =X'` 会得到空角色键，`'A= '` 会得到空工号；重复角色键后者覆盖前者；`PersonId` 未做任何格式校验。现有测试未覆盖这些输入。
4. `assembleMatrixHrFace` 用 `env[A] ?? env[B]`：若 `A` 存在但为空串，不会回退到 `B`，而是直接报缺 secret；与“次选名”注释不一致。目标随 env 一起消失。**旧记录的“80 侧无槽位”已在 v0.5 关闭**：80-§3.4 第 10 条给了 `registration?: MatrixHrRegisterSecret`（`SEC-MX-HR-SHARED` + `matrix-register` + `kind:'shared-secret'`），空串问题由 `secret-empty` 归 `Err`（§4.5.1、§8.3 第 5/6 项）。
5. `loadDeptSlugs` 以 cwd 解析相对路径，不按 daemon.yaml 所在目录；没有 containment/realpath；错误消息带原样路径；无文件大小/条目数上限。目标：`{ configPath }` 用 `dirname(resolve(configPath))`、`{ config }` 用 `deploymentBaseDir`（§4.5.2）。
6. `assembleMatrixProvisionFace` 与 `assembleMatrixBroadcastFace` 各自读一次 deptMap；若两次读之间文件变化，供给频道与通知目标可能使用不同的 deptSlugs。广播面用 `config.company` 作 slug，供给面用 `snapshot.slug`；两者没有交叉校验。
7. `bootServe` 在 `hrSync:false + hrMatrix:true` 时既不走 hr 面（`hrFaceNeeded` 为 false），也不报错；daemon 的 `validateHrServeCross` 只在 `hrSync:true` 时检查 `hrMatrix`，该组合可能被静默忽略。
8. 秘密来源双轨（现状）：boot 读 `options.env ?? process.env`，daemon 的 `collectHrSecrets(process.env, extra)` 与出站脱敏也读 `process.env`，且 `runServe` 的 opts 没有 `hrKnownSecrets`；自定义 env 时 boot 取到的值可能不在 daemon 的脱敏名单里（G5）。目标改为**单源**：`ServeConfig.secrets` 由 daemon 载入，boot 零接触（80-§3.3 第 6 条）；缺口在 daemon 未实现，不是“provider 通道未定”。
9. 登录成功后若后续装配失败，或 `runServe` 返回后进程继续存活，boot 不 logout、不释放 client（现状）。目标：boot 没有会话可清理，`close()` 归 daemon 的 `runtime.stop`（先于 `ledger.close`）；风险转移到 daemon 未实现。
10. `boot.ts:299`–`:305` 的 `bootServe` 文档注释被放在 `assembleMatrixHrFace` 注释之前，`bootServe` 本身没有紧邻注释；这是注释归属错误，不是运行时缺陷。
11. 测试里的假密码与假 shared secret 用固定短字面量（非 `test-*` 形），不符合 80-§11.6 的测试夹具建议；虽非真实值，仍可能被误抄成部署配置，目标统一改名为 `test-*` 形（本文不复写其字面值）。

### F-boot-main

**路径/处置**：`apps/boot/src/main.ts`；现有；目标-保留（受限：仓内手动启动器，不注册 `bin`/启动脚本，不作为发布入口）。

**上位锚**：80-§3.1（boot 不是独立入口）、§3.6（10 步属于 `runServe`）；79-§1.3（生产入口只用 Node）；78 `BIND-EDGE-MX-01`（部署侧供给）；75 D75-11（入口收敛，不适用于 boot 的发布面）。

**职责**：

- 读取 `process.argv[2]` 作为 `daemon.yaml` 路径；
- 缺参时打印用法并以 `process.exit(1)` 退出；
- 有参时 `await bootServe({ configPath })`，把 fs/network/serve 交给 `bootServe` 的缺省面。

**秘密与会话（目标形态）**：`main.ts` 不是秘密入口，也不是登录入口。

- 它不构造 `SecretProvider`、不读 `ServeConfig.secrets`、不读 `process.env`；秘密由 daemon 按 `ServeConfig.secrets` 自己载入（80-§3.3 第 6 条、§3.6 第 6 步）。
- 全关配置（`matrix:false`、`matrixChannels:false`、`hrSync:false`）可经 `main.ts` 直接跑；
- 任一 Matrix 开关打开时，是否可启动取决于部署配置里的 `secrets.catalog` 是否给出 `SEC-MX-BOT-PASSWORD`（`use` 含 `platform-auth`）；**`hrMatrix` 开启还须给出 `SEC-MX-HR-SHARED`**（`use` 含 `matrix-register`）。缺则 daemon 拒启（`CONFIG_INVALID`，原始 `failure`/`subcause` 保留在 `detail`），`main.ts` 以非零退出；boot 不参与这个判定。空值（空串/零字节）按 `secret-empty` 同样拒启。
- 手动启动需要真实 Matrix 时，做法是在 `daemon.yaml` 的 `secrets` 段写 `env-ref`/`file-ref`，由 daemon 解析；`main.ts` 不做任何秘密适配、不加 env 回退。轮换/吊销不靠重启：`file-ref` 文件 `mtime`/`version` 变化或部署控制通道通知即触发 daemon 整体重建，`main.ts` 无感。

**非职责**：

- 不解析配置、不装配 Matrix 面、不构造工厂、不决定开关、不读 env、不构造 `SecretProvider`；
- 不注册信号、不拥有 `runServe` 的生命周期、不关闭台账/source；
- 不是 `bin`，不被 `package.json` 的 `scripts`/`exports` 引用；不发布到 npm/DSH；
- 不打印任何配置值或秘密（除用法行）。

**内部结构**：

- 无导出；顶层 ESM 脚本；一个 `configPath` 常量；一个 `if` 分支；一个 `await bootServe(...)`。
- 输入：`process.argv[2]: string | undefined`；输出：进程退出码（0 由 `runServe` 正常返回，1 由缺参，异常由 Node 未捕获拒绝处理）。
- 无类型定义、无常量表、无函数封装。

**导出与依赖**：

- 导出：无。
- import：`./boot.ts` 的 `bootServe`（intra）。
- 不得 import daemon/matrix 直接面；不得成为第二个组合根。

**IO 与注入**：

- `process.argv`、`console.error`、`process.exit(1)`；间接经 `bootServe` 使用 fs、fetch、log；**不接触 env**；秘密由 daemon 从 `ServeConfig.secrets` 载入，`main.ts`/boot 都不碰。
- 无时间/ID/随机/CLI 解析库注入；没有 `try/catch`，没有显式 `process.exitCode`。

**状态/并发/恢复**：

- 进程级单次调用；顶层 `await`；无状态机、无事务、无幂等。
- 并发：同一进程内不会自我并发；外部重复启动是多个进程，各自 `runServe`、各自调工厂登录，没有单实例锁。
- 恢复：进程退出即结束；`runServe` 的优雅停机由 daemon 的信号处理负责（含会话 `close()` 先于 `ledger.close`），`main.ts` 不转发信号。

**错误、秘密与观测**：

- 缺参：固定用法文本，退出码 1。
- `bootServe` 失败：未捕获的 Promise rejection；Node 默认以非零退出并打印堆栈。堆栈可能包含 `daemon.yaml` 路径（文件不存在时由 Node 的 fs 错误带出）；boot 自身的 `ClassifiedError.detail` 已按 §4.5 收口为键名/面名称，不含秘密与绝对路径。**`main.ts` 不加 `try/catch`**：加 catch 就等于在第二处决定错误分类与退出码，归 80-§3.6。
- 无日志出口注入；`bootServe` 缺省 `console.log` 输出装配日志（不含值、不含 `secretId`）。
- 没有错误分类、没有事件、没有指标。

**测试与证据**：

- 无专属测试；`boot.test.ts` 不 import `main.ts`，也不 spawn 它。
- 未证：缺参用法、非零退出、真实 `runServe` 启动、信号中断、错误堆栈是否含路径。
- 目标若保留：只允许加“显式 catch + 退出码 + 不打印秘密”的最小收口；是否加 `bin`/`scripts.start` 必须走 79/80 提案，不在本附录私定。

**规模与迁移**：

- 现状 12 行；目标 ≤60 行；不得承载配置解析、路由、信号处理。
- 迁移：保留路径；在 78 部署绑定中写明“手动启动命令”与“正式部署启动器归部署侧”。目标形态下 `main.ts` 的可用范围收窄为全关配置（见上“秘密供给的当前限制”）；若部署侧提供了受监督启动器且全仓无调用方，可在 80/78 确认后退役本文件；退役前不得删除，因为当前它是仓内唯一可直接调用 `bootServe` 的入口。

### F-boot-package

**路径/处置**：`apps/boot/package.json`；现有；目标-保留并校正文档口径。

**上位锚**：79-§4.4（源码态/构建态）、§6.1（boot 不纳入分发）、§6.5（exports 口径表）、§10.2（manifest 形状）；80-§2.1（boot 三条边）、§3.4（注入类型）。

**职责**：

- 声明包名 `@studio-next/boot`、版本 `0.1.0`、`private: true`、`type: module`；
- 公开面 `main` 与 `exports["."]` 都指向 `./src/boot.ts`；
- 声明三条 workspace 依赖：`@studio-next/contract`、`@studio-next/daemon`、`@studio-next/matrix`；
- 提供 `typecheck`（`tsc --noEmit -p tsconfig.json`）与 `test`（`vitest run`）脚本。

**非职责**：

- 不声明 `bin`、不声明启动脚本、不声明 `files`、不发布；
- 不声明构建脚本/`tsconfig.build.json`；
- 不引入第三方 npm 依赖；不引入 `paths` 或 project references；
- 不把测试专用依赖写成生产依赖。

**现有字段与目标处置**：

| 字段 | 现状 | 目标 |
|---|---|---|
| `name`/`version`/`private`/`type` | `@studio-next/boot`/`0.1.0`/`true`/`module` | 保留 |
| `description` | 组合根、105-刀A、唯一同时依赖两包、daemon 零 matrix | 保留；不改写为“统一 supervisor/API 入口” |
| `main` | `src/boot.ts` | 保留；不得改为 `src/index.ts`（当前无此文件） |
| `exports["."]` | `./src/boot.ts` | 保留；不加通配、不加 `./main`、不加 `./test/*` |
| `scripts.typecheck` | `tsc --noEmit -p tsconfig.json` | 保留；根 `typecheck` 已通过 `include` 覆盖 boot，包脚本不是根门禁的必需项 |
| `scripts.test` | `vitest run` | 保留；根 `test` 会跑全仓 vitest |
| `dependencies` | contract/daemon/matrix `workspace:*` | 保留；不增不减 |
| `devDependencies` | 无 | 保留为空；测试用 daemon/engine 属 `daemon` 包，不是 boot 的 devDependency |
| `bin`/`files`/`license` | 无 | 目标不新增；若未来发布，许可与白名单归 79-§7/制作人，不在本附录定 |

**导出与允许依赖**：

- manifest 的三条依赖与 `allowedPackageEdges` 的三条 boot 边一致；没有第四条。
- `@studio-next/contract` 只被 `import type` 使用（`InvokeSource`/`PersonId`），但仍作为直接依赖声明；按 79-§10.3 的“有 import 即非死依赖”口径保留。
- 测试文件 import `@studio-next/daemon/engine` 与相对路径 `../../daemon/src/assembly/hrsync/run-serve-opts.ts`；前者仍在 `boot→daemon` 边内（`exports["./engine"]` 已存在），后者绕过包 `exports`，是 79-§4.1“内部文件不得被跨包直接引用”的例外缺口。80-§3.4 第 6 条已明写：`RunServeOpts` 由 `@studio-next/daemon/serve` **再导出**，测试用 `engine` 也必须经 `exports` 映射、不得相对路径穿透。因此目标是两处都走 exports，实现单按此执行；这不是“等 daemon 动手就行”的未决项。

**IO/状态/事务/错误**：N/A（manifest 无运行时行为；不读 env、不联网、不写文件）。

**测试与证据**：

- 无 manifest 专属测试；`boot.test.ts` 只扫描源码里的包名反向引用，不检查 manifest 的 `dependencies`/`bin`/`exports`。
- 79-§10.3 的“manifest 与 import 图一致”检查是目标新增能力，尚未落地；本文件不能声称已被该检查覆盖。
- 未证：`bun install` 后 boot 的三条 workspace 解析、`pnpm link:` 场景、发布面缺失 `license` 的政策影响。

**规模与迁移**：

- 20 行；目标不增长（除必要的字段口径修正）。
- 迁移：不改依赖、不加 `bin`；若 daemon/serve 再导出 `RunServeOpts`，boot 不需要改 manifest。若未来纳入分发，按 79-§6.1 L7 与 §4.4 的包级 typecheck 串接执行，当前不做。

**文档漂移（需回写 79，不在本附录改 79）**：

- 79-§6.5 把 boot 归入“其余 12 个 … `./src/index.ts`”一行；实际 boot 的 `main`/`exports["."]` 是 `./src/boot.ts`，且 `apps/boot/src/index.ts` 不存在。需 79 校正为 boot 的公开面是 `boot.ts`，或者由 80/79 明确是否新增 `src/index.ts` façade；本文不私造 `index.ts`。

### F-boot-tsconfig

**路径/处置**：`apps/boot/tsconfig.json`；现有；目标-保留。

**上位锚**：79-§1.3（NodeNext/ESM/严格开关）、§4.4（源码态/包级 typecheck）、§5.2（构建配置另立，boot 不适用）、79-D10（测试目录门禁缺口）。

**职责**：

- `extends: "../../tsconfig.base.json"`，继承 target ES2024、module/moduleResolution NodeNext、`types: ["node"]`、全部严格开关、`erasableSyntaxOnly`、`verbatimModuleSyntax`、`isolatedModules`、`allowImportingTsExtensions`、`noEmit`、`skipLibCheck`、`resolveJsonModule`；
- `include: ["src/**/*.ts"]`，覆盖生产源码与目标 `src/test/**`；
- 作为包级 `tsc --noEmit -p tsconfig.json` 的配置。

**非职责**：

- 不设置 `rootDir`/`outDir`/`declaration`/`composite`/`references`/`paths`；
- 不做发射、不做构建、不做测试转换；
- 不把 `test/` 目录（包根）拉进来；目标测试放 `src/test/`，仍由 `src/**` 覆盖；
- 不通过 `paths` 把运行期解析引回 `src`（79-§6.3 禁止）。

**内容与边界**：

| 键 | 现状 | 目标 |
|---|---|---|
| `extends` | `../../tsconfig.base.json` | 保留 |
| `include` | `["src/**/*.ts"]` | 保留；新增 `src/test/**` 自动被覆盖 |
| `compilerOptions` | 无本地覆盖 | 保留；不本地放宽 strict/erasable |
| `rootDir`/`outDir` | 无 | 不添加；boot 不构建 |
| `paths`/`references` | 无 | 不添加 |
| `noEmit` | 继承 `true` | 保留；包级检查只做类型 |

**导出与依赖**：N/A（配置文件不导出符号）。它影响的是 TypeScript program 的包含面：`boot.ts` 会通过 workspace 解析把 `packages/matrix`/`apps/daemon` 的源码拉进 boot 包级 program；因为未设 `rootDir`，不会触发 TS6059。目标不改变这一形态。

**IO/状态/事务/错误**：N/A（tsconfig 无运行时 IO；错误只表现为 `tsc` 诊断）。

**测试与证据**：

- 本次**未运行** `tsc --noEmit -p apps/boot/tsconfig.json`，也未运行根 `bun run typecheck`；因此不证明 boot 源码/测试类型通过。
- 现有测试文件在 `src/` 下，根 `tsconfig` 的 `apps/*/src/**/*.ts` 会把它纳入类型检查。80-§10.6 末段写的是“根 `tsconfig.json` 只 `include` `apps/*/src/**` 与 `packages/*/src/**`，**测试文件不进 typecheck**（79-D10）”——该句对 `apps/daemon/test/` 与包根 `test/` 成立，但对**位于 `src/` 下的测试件**（`apps/boot/src/boot.test.ts`）不成立：它按 `apps/*/src/**` 被纳入。这是 80 的措辞需校正处（§8.3 第 14 项），本文按实测写、不改 80。目标把测试移到 `src/test/` 后仍在 `src/**` 内，类型门禁不丢。
- 未证：`tsc` 解析 workspace 符号链接、`boot.test` 的跨包相对 import 在包级 program 中的行为、`skipLibCheck` 对 matrix/daemon 声明的掩盖。

**规模与迁移**：

- 5 行；目标不增长。
- 迁移：若测试拆分，不改 `include`；若未来纳入分发（79 当前不允许），新增 `tsconfig.build.json` 并按 79-§5.2 关 `noEmit`、设 `declaration`/`outDir`/`rootDir`，同时把包级 typecheck 并入根脚本；当前不做。

---

## 六、现有测试文件条目与逐项盘点

### F-boot-test

**路径/处置**：`apps/boot/src/boot.test.ts`；现有 635 行；目标-拆分后退役旧路径。

**上位锚**：80-§10.6（`boot.test.ts` 超限、随 217/219 波次拆分、不得再长）；78 `BIND-EDGE-MX-01` 的 V5 缺口；80-§3.4（`RunServeOpts` 收口）；80-§11.2/§11.6（秘密与日志边界）。

**职责**：

- 用 fake fetch 与 serve stub 证明 boot 的装配形状、fail-fast、开关独立、依赖方向、payload 形状；
- 不证明真实 Matrix、真实 `runServe`、真实频道幂等、真实登录授权、秘密脱敏或性能。

**规模事实**：

- 实测 635 行；`lineBaseline` 当前是 645（`scripts/guards/boundary-rules.mjs:161`）。80-§10.6 表两列（实测/基线）均写 645，与本次实测 635 不一致；645 是 guard 基线。635 > 600，仍在基线内，但不得再长；目标拆分后删除该基线条目（只减不增）。
- 14 个 `describe`，35 个 `it`，12 个 helper/状态变量。

#### 现有 helper 与状态变量

| 名称 | 位置 | 用途 | fake 边界/不证明 |
|---|---|---|---|
| `root` | `:43` | 临时目录根；`beforeAll` 创建、`afterAll` 删除 | 真实 fs；不证明权限/符号链接/containment |
| `matrixYaml(overrides)` | `:46` | 构造 matrix 键组扁平 YAML；`db`/`rootDir` 落临时目录；可追加覆盖行 | 只是扁平 YAML 子集；不是完整 `daemon.yaml`，不证明真 YAML 解析 |
| `fakeFetchWithLogin(calls)` | `:58` | 预置 login 响应，返回 `enqueue`/`fetch`；记录 url/body；队列空则 reject | 内存回放；无 TLS、无 429、无真实 Matrix 状态；不证明网络错误/超时 |
| `ENV` | `:82` | 现状：对象只含 `MATRIX_BOT_PASSWORD` 一个键，值是固定短假串（不在此复写） | 假密码；未按 `test-*` 命名；不是部署示例、不得照抄；**目标退役**——boot 不再取密码，假 provider 只放在 daemon 的测试注入点，不进 boot 公共面 |
| `ENV_HR` | `:85` | 现状：在 `ENV` 上追加 `MATRIX_HR_SHARED_SECRET`，值同为固定短假串 | 假 secret；**目标退役**（同上）；不证明真 shared-secret 建号 |
| `ServeSpy` | `:91` | serve 注入面的函数类型，只声明 `matrixSource`/`matrixRoomFace` | 类型不含 `notifyBroadcast`/`hrMatrixFace`/`matrixSessionFactory`；目标直接改用 `RunServeOpts`（经 `daemon/serve` 再导出），不再自建子集 |
| `serveStub(seen)` | `:96` | 捕获 `configPath`/`opts`，返回 `{ticks:0, stopReason:'stop-request'}` | 不跑引擎/台账/调度/信号/停机；不证明 `runServe` 真实行为 |
| `beforeAll`/`afterAll` | `:105`/`:109` | 建/删临时目录 | 真实 fs；失败会污染测试 |
| `channelsYaml(overrides)` | `:313` | 构造 `matrix:false + matrixChannels:true` 键组；引用 `deptMapPath` | 依赖第二个 `beforeAll` 的写入顺序；不是真实 deptMap |
| `deptMapPath` + 第二个 `beforeAll` | `:326`/`:328` | 写 `{"departments/工程部":"eng"}` 到临时 JSON | 只有一个部门；不证明多部门/重复/坏 slug 的全集 |
| `demoSnapshot()` | `:387` | 供给面 `ctx.snapshot()` 的静态公司快照；含 department/person/group | 静态对象；不经过 `CompanySnapshot` 校验；不证明热重载活取 |
| `hrYaml(overrides)` | `:526` | 构造 `hrSync:true + hrMatrix:true`、matrix 两面关闭、`hrMatrixRooms` 的 YAML | 只覆盖 hr-only 形态；不证明 daemon 的 hr 房间解析 |

#### 现有 14 个 describe / 35 个用例

| # | describe | 用例数 | 用例标题（原文） | 覆盖/不证明 |
|---:|---|---:|---|---|
| 1 | 依赖方向守护（25-§一.2；105-刀A 判负线⑦） | 3 | `daemon src 零 @studio-next/matrix import（静态扫描全目录树）`；`组合根本体同时 import 两包（受准例外只落在 boot——boot.ts import 即证明面）`；`boot 测试文件所在目录外无他人 import boot 包（组合根不被反向依赖）` | 只做文本正则扫描；不是 AST；只扫 `.ts`；不证明运行时无动态 import/构造说明符 |
| 2 | MentionPayload ↔ MentionIntentPayload 形状契约（S5） | 2 | `matrix 源侧 payload 过 daemon checkMentionPayload（字段全兼容，无丢失）`；`畸形 payload（eventId 非字符串）被 daemon 校验面拒收——组合根不救形` | 一个正例一个反例；不证明所有字段组合/版本兼容 |
| 3 | parseMatrixRoles（③混合语义源侧配置面） | 3 | `宰相=PRIME-0;制作人=PRODUCER-0 → 映射表`；`缺省/空白 → undefined；空段剔除`；`坏形态（无 = / 空=值）→ CONFIG_INVALID 明报` | 未覆盖 trim 后空键/空值、重复键、非 PersonId 值 |
| 4 | assembleMatrixSource（登录 + 源构造） | 4 | `login 请求带 bot 账号+env 密码；源 name=matrix（键组全量进 source 配置）`；`matrix: false 调装配 → CONFIG_INVALID`；`缺 env 密码 → CONFIG_INVALID`；`直接构造面缺 homeserver/userId → CONFIG_INVALID` | 只断言 login URL/body 与 source.name；未证明 rooms/roles/poll/sync 真的进入 source；未覆盖 401/429/超时 |
| 5 | bootServe（组合根接线：config → 装配 → runServe opts） | 3 | `matrix: true → login 一次 + runServe 收到可用的 matrixSource 工厂`；`matrix: false → 透传 runServe 且不带 matrixSource`；`daemon.yaml 缺 matrix 必配键 → parse 面先炸（boot 未到登录步）` | 用 stub 捕获；不证明真实 `runServe`、启动/停机、双读 TOCTOU |
| 6 | loadDeptSlugs（DEV-20 D6 部门映射装载） | 3 | `合法 JSON：扁平面 path→slug 全量装载`；`路径缺席/空串 → CONFIG_INVALID`；`文件读不到 / 非 JSON / 非对象 / 坏 slug / 空对象 → CONFIG_INVALID 逐面明报` | 用真实临时文件；未覆盖相对 cwd、符号链接、超大文件、重复键、路径泄漏 |
| 7 | assembleMatrixProvisionFace（登录 + 供给面工厂） | 3 | `matrixChannels: false 调装配 → CONFIG_INVALID`；`缺 env 密码 → CONFIG_INVALID 且点名 matrixChannels 开关`；`合法：login 一次 → 工厂(ctx) 产三面` | 只断言三方法存在与日志；未调用方法、未验证 snapshot 映射、未验证 live snapshot |
| 8 | bootServe：channels-only 形态 | 2 | `runServe 收 matrixRoomFace、无 matrixSource；login 恰一次；制作人缺省神号`；`daemon.yaml 缺 matrixDeptMap → parse 面先炸` | stub 捕获；未验证 daemon 启动期 ensure、热重载 re-ensure |
| 9 | bootServe：双开形态 | 1 | `两面齐注入且 login 恰一次（同一 bot 账号共用登录——双设备面不成立）` | 只证明注入存在与 login 次数；不证明两面使用同一 client 的运行时一致性 |
| 10 | assembleMatrixBroadcastFace（登录 + 广播面） | 2 | `matrixChannels: false 调装配 → CONFIG_INVALID`；`合法：send 可调；日志点名广播面` | 未调用 `send`；未验证 alias 解析、软失败、缓存失效 |
| 11 | bootServe：notifyBroadcast 注入面 | 2 | `matrixChannels 开 → runServe 收 notifyBroadcast；login 仍恰一次`；`只开 matrix 不开 matrixChannels → 无 notifyBroadcast` | 用 `Record<string, unknown>` 绕过类型；不证明 daemon 中继/计量 |
| 12 | assembleMatrixHrFace（登录 + 人事执行面） | 4 | `hrSync/hrMatrix 未开下调用 → CONFIG_INVALID`；`缺 shared secret env（两名俱缺）→ CONFIG_INVALID 且点名 env 键`；`合法：login 一次 → 四面齐`；`次选名 MATRIX_SHARED_SECRET 同样可注入` | 只断言四方法存在；未调用建号/入房/PL/踢出；未覆盖空首选值、短 secret、权限失败 |
| 13 | bootServe：hr-only 形态 | 2 | `runServe 收 hrMatrixFace、无 matrixSource/matrixRoomFace；login 恰一次`；`缺 bot 密码 env → CONFIG_INVALID 且点名 hrMatrix 开关` | stub 捕获；不证明 daemon hr 房间解析/建号链 |
| 14 | bootServe：三开形态 | 1 | `三面齐注入且 login 恰一次（同一 bot 账号——多面共用登录）` | 只证明注入存在与 login 次数；不证明三面并发/顺序/失败隔离 |

**IO / 状态 / 错误 / 恢复（现状）**：

- IO：真实临时目录（`mkdtemp`）里写扁平 YAML 与 deptMap JSON；所有网络经 `fakeFetchWithLogin` 的内存队列；`serveStub` 只捕获参数、不起进程、不开库、不发信号。
- 状态：`root` 与 `deptMapPath` 依赖两次 `beforeAll` 的写入顺序（`:105`/`:109` 与 `:326`/`:328`），拆分后由 testkit 的 `makeHarness()` 统一；用例间不共享可变夹具。
- 错误：断言的是 boot 抛出的错误文案/形状——现状是裸 `Error`（消息以 `CONFIG_INVALID：` 开头），目标改为 `ClassifiedError` 的两轴后本文件同步改断言；测试自身失败即 `expect` 抛错，不做恢复。
- 恢复：N/A（一次性进程内测试）；`afterAll` 删除临时目录，失败路径也执行。

**目标口径（v0.5）**：以上 35 例是**现状**盘点，不是目标验收口径。目标态这些用例要分流：

- 登录请求体（describe 4/7/10/12）→ 改成**工厂契约**用例：断言 `matrixSessionFactory` 收到的 deps 形状（`login`/`registration?` 两型句柄）、返回值是四个工厂/面 + `close()`、boot 侧零 login 调用；
- 缺 env 密码（4/7/12/13）→ 退役；改断言“boot 源码零 `process.env`、零 provider/`KnownSecretSet` 引用”的静态扫描（句柄判别位比对是允许的，见 §7 C2）；
- 注入形状（5/8/9/11/13/14）→ 保留，但断言对象从“四键 + login 次数”改为“工厂存在/不存在 + 开关匹配 + **与任一直接面不同时给**”；
- 其余（roles、deptMap、payload、依赖方向）保留。

**fake 边界总结**：

- 所有网络面都是 `fakeFetchWithLogin` 的内存队列；没有真实 TCP/TLS、没有 homeserver、没有真实 access token 生命周期。目标态这些 fake 只服务于**工厂内部**的片段测试，不再证明“boot 登录”。
- 所有 daemon 面都是 `serveStub`；没有引擎、台账、调度器、源注册、信号、停机序列，也没有 `matrixSessionFactory` 的调用方行为（谁调、何时调、`close()` 顺序）。
- 所有公司面都是 `demoSnapshot()`；没有 `loadCompanyDirectory`、没有热重载、没有真实 `CompanySnapshot` 校验。
- 依赖方向用例是文本正则扫描，不是编译器/打包器级 import 图；不覆盖动态 `import()` 的变量形式、`require` 变量形式、`package.json` 的 `exports` 别名。
- payload 形状用例只覆盖一个正例/一个反例；不覆盖 `channel` 缺省、`sender` 可选、`m.mentions` 等 Matrix 侧变化。

**不证明什么**：

- 不证明真实 Matrix 登录、mention 轮询、频道 ensure、广播发送、人事建号/入房/PL/踢出可用；
- 不证明 `runServe` 的真实启动 10 步、停机顺序、信号处理、台账接管；
- 不证明秘密不会出现在日志/错误/台账（只断言密码进了 login 请求体）；
- 不证明 `bootServe` 的配置单读一致性、双重启动、并发安全；
- 不证明 `main.ts` 可用；
- 不证明类型通过或边界守护通过（本次未跑）。

**R/E/W/V**：

- R/E/W：**82 已落地**（`docs/82-技术细节-验证迁移与追溯.md`），但未给 boot 测试的 R/E/W 映射；不私设编号，待 82 补。
- V：V0/V1 可由静态扫描/`tsc` 承担（未跑）；V2 由 fake harness 承担（现有 35 例）；V5 真机未做（78 `BIND-EDGE-MX-01` 的 V5 缺口）。

---

## 七、目标测试件条目

### F-boot-testkit

**路径/处置**：`apps/boot/src/test/testkit.ts`；目标-新增；仅测试基建。

**上位锚**：80-§10.6（拆分超限测试）；80-§11.2/§11.6（假秘密与日志边界）；78 `BIND-EDGE-MX-01`（fake 只作回放）。

**职责**：

- 集中提供三份测试文件共用的 YAML 构造器、fake fetch、fake login secret、serve stub、临时目录生命周期、静态公司快照；
- 统一假秘密命名与 fake 行为，避免三份测试各自演化。

**非职责**：

- 不是生产模块；不被 `boot.ts`/`main.ts` import；不从 `package.json` 的 `exports` 暴露；
- 不模拟真实 Matrix 服务器、不模拟 daemon 引擎/台账/信号；
- **不提供 `SecretProvider` 替身**：provider 是 daemon 侧测试注入点，boot 的测试只造两个受控句柄 `MatrixBotLoginSecret`/`MatrixHrRegisterSecret`（daemon 交给工厂的那两个）；
- 不提供断言；不替代各测试文件的覆盖声明。

**内部结构（目标）**：

- `makeHarness()`：创建临时目录，返回 `{ root, cleanup, matrixYaml, channelsYaml, hrYaml, fakeFetchWithLogin, fakeBotLoginSecret, fakeHrRegisterSecret, serveStub, demoSnapshot }`；`cleanup` 负责 `rm -rf`。
- `matrixYaml(overrides)`/`channelsYaml(overrides)`/`hrYaml(overrides)`：扁平 YAML 字符串；`db`/`rootDir`/`deptMap` 路径落 `root`。
- `fakeFetchWithLogin(calls)`：预置 login 响应，支持 `enqueue(status, body)`；队列空 reject；记录 url/body；不记录 headers。
- `fakeBotLoginSecret()`：构造 `MatrixBotLoginSecret` 测试替身——`secretId:'SEC-MX-BOT-PASSWORD'`、`kind:'password'`、`use:'platform-auth'`、`material` 为 `test-*` 假值；可选负向变体（`secretId`/`kind`/`use` 任一不符、或与 `material.secretId`/`material.kind` 不一致）。
- `fakeHrRegisterSecret()`：构造 `MatrixHrRegisterSecret` 测试替身——`secretId:'SEC-MX-HR-SHARED'`、`kind:'shared-secret'`、`use:'matrix-register'`、`material` 为 `test-*` 假值；同样带负向变体。**两型不可互换**：拿 `fakeBotLoginSecret()` 填 `registration` 槽位是负向用例。
- 两个 fake **都不是** provider，不实现取值来源，也不证明 `allowedUses`/`secret-empty` 校验（那归 daemon 侧测试）。
- `serveStub(seen)`：捕获 `input`/`opts`，返回固定 `ServeResult`；opts 类型直用 `RunServeOpts`，不再自写第三份。
- `demoSnapshot()`：静态 `RoomFaceSnapshotInput` 形状，含可选 `role`/`status`/`groups`。
- 假秘密一律 `test-*` 形；需要“缺凭据/坏句柄”的用例显式覆盖，不用共享可变状态。

**导出与依赖**：

- 导出上述 helper；不导出生产类型。
- import：`node:fs/promises`、`node:os`、`node:path`、`vitest`（如需类型）、`@studio-next/daemon/serve`（`RunServeOpts`/`MatrixSessionFactoryDeps`/`MatrixBotLoginSecret`/`MatrixHrRegisterSecret` 等类型）、`@studio-next/matrix` 的类型；不得 import `boot.ts` 的生产函数（helper 只造输入，不测实现），也不得 import `@studio-next/contract` 的秘密端口。

**IO 与注入**：

- 真实 fs：`mkdtemp`/`writeFile`/`rm`；不模拟 fs 错误。
- 内存 fake fetch；无真实网络。
- 内存假两型句柄；不读真实 env、不读秘密文件、不连 broker、不构造 provider、不模拟轮换/吊销。
- 无时间/随机/ID 注入；固定字符串。

**状态/并发/恢复**：

- 每个测试文件调用一次 `makeHarness()`，`afterAll` 调 `cleanup`；不跨文件共享可变状态。
- 队列是单消费者，测试串行使用；不支持并发 fetch 调用。
- 假凭据按用例新建；不跨用例复用。
- 失败时 `cleanup` 仍需执行；测试文件用 `afterAll` 保证。

**错误/秘密/观测**：

- fake fetch 队列空时 reject `fake fetch: 队列空`；两型 fake 的负向变体只返回形状不符的句柄，由被测代码（`assembleMatrixLogin`/`assembleMatrixHrFace`/工厂入口）抛错；两者都是测试错误，不是生产错误语义。
- 假秘密必须 `test-*` 形；不得使用真实值；不得把假 secret 写进快照/日志断言以外的位置；不得伪造 `secret-empty`（空值路径归 daemon 测试）。
- testkit 不产生日志。

**测试与证据**：

- 本身不是测试；不被 vitest 默认 `*.test.ts` 收集（文件名 `testkit.ts`）。
- 由 `guards.test.ts` 增加一条静态断言：`boot.ts`/`main.ts` 不得 import `./test/testkit.ts`；防止测试基建进入生产装配。
- 不证明任何生产行为。

**规模与迁移**：

- 目标 ≤180 行；单件 ≤600。
- 迁移：先建 testkit，再从旧 `boot.test.ts` 搬迁 helper；三份新测试全部通过后删除旧文件。回退：恢复旧文件、删除 testkit。

### F-boot-test-guards

**路径/处置**：`apps/boot/src/test/guards.test.ts`；目标-新增（拆分产物）。

**上位锚**：80-§2.1（boot 不是包层、零入边、三条出边）；79-§4.1（只导出接口面、内部文件不得跨包直接引用）；75 D75-03（保留分层）。

**职责**：

- 证明 `daemon/src` 零 `@studio-next/matrix` import；
- 证明 `boot.ts` 同时 import `@studio-next/daemon/serve` 与 `@studio-next/matrix`；
- 证明 `apps/boot` 外没有 `@studio-next/boot` 的 import；
- 证明 Matrix `MentionPayload` 能被 daemon 的 `checkMentionPayload` 接受，畸形 payload 被拒；
- 证明生产文件不 import 测试基建；
- 证明共享源是单点：`boot.ts` 内 `loadDeptSlugs(` 调用点恰 1 处（§4.3）；
- 证明矩阵边界未被越界实现：`boot.ts`/`main.ts` 的 import 在白名单内，且非注释代码不含协议常量的判定分支（§4.4）。

**非职责**：

- 不做 AST 级依赖分析；不替代 `guard:boundaries`；
- 不证明运行时无动态 import/构造说明符；
- 不证明 payload 的所有字段组合/版本兼容；
- 不证明 boot 的真实装配；
- 注释剥离是启发式（行注释/块注释/字符串里的字样），"协议常量"断言只作越界提醒，不作能力证明。

**内部结构（目标）**：

- 复刻现有 5 个用例（依赖方向 3 + payload 2），`readFileSync` 的读取路径从 `import.meta.dirname` 下的 `boot.ts` 改为 `../boot.ts`；payload 用例自包含，不依赖 testkit 的 `demoSnapshot`。
- 新增 1 个静态断言：读 `boot.ts`/`main.ts` 源码，断言不含 `test/testkit` 或 `testkit.ts`。
- 新增 1 个静态断言（C1，§8.2）：扫描 `boot.ts`，断言 `loadDeptSlugs(` 恰 1 处；若未来改成注入 loader，则改为断言"loader 只在 `bootServe` 调用一次"。
- 新增 1 个静态断言（C2，§8.2）：`boot.ts` 的 import 源集合 ⊆ `{node:fs, node:path, @studio-next/contract, @studio-next/daemon/serve, @studio-next/matrix}`；非注释代码不含 `retry_after_ms`/`M_FORBIDDEN`/`registration_shared_secret`/`sync timeout` 的**协议判定分支**；不含 `process.env` 直读；不含 `SecretProvider`/`SecretCatalogEntry`/`KnownSecretSet` 类型引用，也不含 `SecretMaterial` 的类型名。**允许并必须存在**：`SEC-MX-BOT-PASSWORD`/`SEC-MX-HR-SHARED` 与 `'password'`/`'shared-secret'`/`platform-auth`/`matrix-register` 的**字面量比对**（工厂复核句柄判别位，80-§3.4 第 10 条）；断言改为“这些字面量只出现在比对表达式里，不出现在日志/错误构造函数实参里”。
- 新增 1 个静态断言（C3）：`boot.ts` 导出里存在一个返回 `MatrixSessionFactory` 的构造导出（名字由实现单定），且 `bootServe` 不把四个面与工厂同时注入（同时给即 `CONFIG_INVALID`，不是“择一”）。
- 新增 1 个 manifest 静态断言（可选，若 79-§10.3 落地）：`package.json` 无 `bin`，`exports` 只有 `"."`。
- 使用 `node:fs` 的 `readdirSync`/`readFileSync`；不联网、不建临时目录。

**导出与依赖**：

- 不导出；仅 vitest 用例。
- import：`node:fs`、`node:path`、`vitest`、`@studio-next/daemon/engine`（`checkMentionPayload`，经 exports）、`@studio-next/contract`/`@studio-next/daemon/serve`/`@studio-next/matrix` 类型。
- 不得 import `boot.ts` 的生产函数（本文件只做静态文本检查与 payload 形状）。

**IO/状态/并发/恢复**：

- 只读 fs；无写入、无网络、无临时目录；无状态。
- 并发：无共享可变状态；扫描是同步的。
- 恢复：N/A。

**错误/秘密/观测**：

- 失败由 `expect` 报错；不产生生产日志。
- 不读取秘密；不打印文件内容（只给违规路径）。

**测试与证据**：

- 覆盖：现有 5 例 + 目标 4 例（testkit 隔离、C1 共享源单点、C2 矩阵/秘密边界、C3 工厂导出）= 9 例。
- 不证明：正则之外的 import 形式、跨包相对 import、`package.json` 的间接依赖、运行时模块图；C1/C2/C3 不证明运行时行为，只证明源码文本的当前形状。
- R/E/W：82 已落地但未给 boot 映射，不私设编号；V：V0/V1 静态层。

**规模与迁移**：

- 目标 ≤220 行；单件 ≤600。
- 迁移：从旧文件搬 5 例；补充 testkit 隔离断言；C1/C2 在 `boot.ts` 内部收口（deptMap 单读）完成后落地，避免先写断言后改代码；旧文件删除后本文件独立运行。

### F-boot-test-assembly

**路径/处置**：`apps/boot/src/test/assembly.test.ts`；目标-新增（拆分产物）。

**上位锚**：80-§3.4（注入面、第 7 条 `deploymentBaseDir`、第 10 条两型句柄）、§5.7（错误形态）、§11.2/§11.2.1/§11.3/§11.6（秘密/路径/日志）；78 `BIND-EDGE-MX-01`（Matrix 登录与损失）。

**职责**：

- 覆盖 `parseMatrixRoles`、`loadDeptSlugs`、`assembleMatrixLogin`、`assembleMatrixSource`、`assembleMatrixProvisionFace`、`assembleMatrixBroadcastFace`、`assembleMatrixHrFace` 的正常与 fail-fast 路径；
- 用 fake fetch 断言 login 请求体（`MatrixBotLoginSecret.material` 作为密码；建号用 `MatrixHrRegisterSecret.material`）、开关面不一致、缺键、缺凭据、deptMap 装载；
- **新增工厂契约用例**：`matrixSessionFactory` 的 deps 形状（`login` 必填 / `registration?` 仅建号开启）、返回的四个工厂/面 + `close()`、`hrMatrixFace` 是 `() => MatrixHrFace`（不是 `MatrixRoomFace`、不是已构造面）、两型句柄判别位不符或互换即拒；
- 断言各面返回的方法形状与日志锚点。

**非职责**：

- 不调用供给面的 `ensureCompanyChannels`/`onDispatched`/`onClosed`；不调用广播 `send`；不调用人事四面；
- 不证明真实 Matrix 幂等、权限、限流、超时；
- 不证明 daemon 的消费面；不证明 `runServe` 启停；不证明 daemon 侧 provider/`KnownSecretSet`/`secret-empty`/轮换重建（那在 daemon 的测试里）。

**内部结构（目标）**：

- 19 个现有用例：roles 3、deptMap 3、source 4、provision 3、broadcast 2、hr 4。**其中 login/缺 env 两组随 env 退役改写**为“工厂内登录 + 两型句柄校验”。
- 从 testkit 取 `matrixYaml`/`channelsYaml`/`hrYaml`/`fakeFetchWithLogin`/`fakeBotLoginSecret`/`fakeHrRegisterSecret`/`demoSnapshot`。
- 目标补测（同一文件内，不新增文件）：见 §8.2 的 A1–A12（A3/A4/A7/A11/A12 按 v0.5 口径改写，合计 31 例）。
- 类型：serve 注入面使用 `RunServeOpts`（经 `@studio-next/daemon/serve` 再导出），不再自写 `ServeSpy` 影子类型。

**导出与依赖**：

- 不导出；仅测试。
- import：`vitest`、`../boot.ts`、testkit、`@studio-next/daemon/serve`（`parseDaemonConfig`/`RunServeOpts`/`MatrixSessionFactory`/`MatrixSessionFactoryDeps`/两型句柄）、`@studio-next/matrix` 类型。
- 不得 import daemon 内部相对路径（目标消除旧 `../../daemon/src/...`），也不得 import `@studio-next/contract` 的秘密端口。

**IO/状态/并发/恢复**：

- 真实 fs 读写临时 YAML/JSON（经 testkit）；fake fetch 内存队列；无网络。
- 每个 describe 独立构造 config；不共享可变夹具；队列按用例串行消费。
- 失败时 `cleanup` 删除临时目录。

**错误/秘密/观测**：

- 断言错误消息包含开关名与键名，**不出现 `secretId` 值**、密码/secret 值/绝对路径（工厂会读判别位但**不回显**；§4.5.3）；
- 目标补测：捕获所有 `log` 行，断言不含密码/secret/token/`secretId`；
- 目标补测：坏 deptMap 的错误消息按 80-§11.6 不含绝对路径；`{ config }` 分支缺 `deploymentBaseDir` 时报键名（`boot-deployment-base-missing`）。

**测试与证据**：

- 覆盖：现有 19 例；目标 A1–A12，合计 31 例（A1–A2 阻塞于 76 的工号语法，A10 阻塞于 slug 权威关系，A3/A4 待 daemon 侧工厂与句柄装配落地；A7/A11 已按 80-§3.4 第 7/10 条定稿）。
- 不证明：真实 Matrix、真实 `MatrixClient` 重试/超时、真实 deptMap 文件权限、真实 `CompanySnapshot` 热重载、真实 provider、`secret-empty`/轮换重建（均归 daemon 侧）。
- R/E/W：82 已落地但未给 boot 映射；V：V2（fake）；V5 未做。

**规模与迁移**：

- 目标 ≤600 行；单件 ≤600。
- 迁移：从旧文件搬 19 例；先把 `RunServeOpts` import 改为包级再导出；再补 A1–A12；旧文件删除前逐例对比标题与断言。

### F-boot-test-serve

**路径/处置**：`apps/boot/src/test/serve.test.ts`；目标-新增（拆分产物）。

**上位锚**：80-§3.1/§3.4/§3.6（组合根、注入、启动/停机）；78 `BIND-EDGE-MX-01`（库级接线与 V5 缺口）。

**职责**：

- 覆盖 `bootServe` 的开关形态：全关透传、仅 matrix、仅 channels、双开、notify 开/关、仅 hr、三开；
- 断言 `runServe` 收到的 opts 键：**工厂路径只传 `matrixSessionFactory`**（四键不出现），**兼容路径传四键**（工厂不出现）；两侧**互斥**——并存不是“择一”而是 `CONFIG_INVALID` 拒启动（§4.4 判负第 8 条、§4.5.4 `matrix-session-factory-coinjected`），故捕获结构必须同时收工厂与四键，才能断言“并存恒为 0”；
- 断言 `bootServe` 传的是 `{ config }`（不是 `configPath`），且 `{ config }` 形态下 `deploymentBaseDir` 已由 boot 解析出并作为 deptMap 基准（§4.5.2）；入参判别联合命名由 17 定；
- 断言装配失败时 `runServe` 不被调用（现有部分覆盖）；
- 断言注入边界：opts 不含 `env`/`fetch`/`log`/`secrets`/`deploymentBaseDir`（S3，§4.2——`deploymentBaseDir` 是 boot 自有键，落在 `BootOptions` 上，不进 `RunServeOpts`）；
- 断言注入最小化：全关时不 login、不读 deptMap、不调工厂、不 `load`（S6）。

**非职责**：

- 不跑真实 `runServe`；不跑引擎/台账/调度/信号/停机；
- 不证明真实 Matrix 网络；
- 不证明配置单读一致性、双重启动、并发安全；也不证明 daemon 是否真的调了工厂、`close()` 是否先于 `ledger.close`（那归 daemon 侧测试）。

**内部结构（目标）**：

- 11 个现有用例：bootServe 基础 3、channels-only 2、dual 1、notify 2、hr-only 2、triple 1。**登录次数断言退役**；改为“工厂被/未被注入”与“deps 未被 boot 填”。
- 从 testkit 取 `matrixYaml`/`channelsYaml`/`hrYaml`/`fakeFetchWithLogin`/`fakeBotLoginSecret`/`fakeHrRegisterSecret`/`serveStub`；两个 fake 分别造 bot 登录与 hr 建号**两型句柄**，不可互换（互换即 `CONFIG_INVALID`，见 §7 F-boot-testkit）。
- `serveStub` 的 opts 类型直用 `RunServeOpts`；捕获结构含 `matrixSessionFactory` 与四键，两侧都要判——只判一侧会让“并存”被静默漏过。
- 目标补测（同一文件内，不新增文件）：见 §8.2 的 S1–S7（合计 18 例）。

**导出与依赖**：

- 不导出；仅测试。
- import：`vitest`、`node:fs/promises`、`node:path`、`../boot.ts`、testkit、`@studio-next/daemon/serve` 的 `RunServeOpts`/`ServeResult`、`@studio-next/matrix` 类型。
- 不得 import daemon 内部相对路径，也不得 import `@studio-next/contract` 的秘密端口。

**IO/状态/并发/恢复**：

- 真实临时 YAML 文件；fake fetch；serve stub 同步捕获。
- 每个用例独立临时文件；`beforeAll`/`afterAll` 由 testkit 管理。
- 无并发；无真实进程信号。

**错误/秘密/观测**：

- 断言 `bootServe` 在装配失败时 reject 且 `serve` 未被调用；
- 断言日志不含密码/secret/`secretId`（目标补测）；
- 不把 `ServeResult.stopReason` 当作真实停机证明（stub 固定返回）。

**测试与证据**：

- 覆盖：现有 11 例；目标 S1–S7，合计 18 例。
- 不证明：真实启动 10 步、停机顺序、信号、台账接管、API 关闭、配置单读；S3/S6 只证明 opts 的键集合与最小化，不证明 daemon 侧如何使用；S5/S7 只证明“工厂 XOR 四键、并存即拒”的注入形态（不是择一），不证明 daemon 的登录与 `close()` 行为；`deploymentBaseDir` 只证明它进了 boot 而不进 opts，不证明 deptMap 实际读盘结果。
- R/E/W：82 已落地但未给 boot 映射；V：V2（stub）；V5 未做。

**规模与迁移**：

- 目标 ≤560 行；单件 ≤600。
- 迁移：从旧文件搬 11 例；先完成 `RunServeOpts` 收口与再导出，再改 stub 类型；补 S1–S7；旧文件删除前确认 35 例总数不变，新文件合计 58 例（9 + 31 + 18）。

---

## 八、现状缺口、目标补测与回写

### 8.1 现状缺口（按影响排序）

| # | 缺口 | 证据锚 | 影响 | 处置归属 |
|---:|---|---|---|---|
| G1 | `bootServe` 与 `runServe` 各自读同一 `daemon.yaml`（**现状**） | `boot.ts:336`、`:341`、`:370`；`serve.ts:1470` | 双读 TOCTOU：按旧配置装配、按新配置运行，可能“开而未注入” | **80-§3.4 第 7 条已定**判别联合（boot 传 `{ config }`）；缺口是代码未改，随 boot 切工厂一并收口 |
| G2 | 类型身份三份 + 再导出缺位（**现状**）：代码仍三键、`runServe` 仍 `(configPath, opts?)`、`BootOptions.serve` 内联三键、测试相对路径穿透 | `run-serve-opts.ts:17`；`serve.ts`（`runServe` 签名）；`boot.ts:68`–`:75`；`boot.test.ts:26` | 三份注入类型随拆分漂移；跨包内部引用违反 79-§4.1 | **80-§3.4 第 6/10 条已定**：5 键、经 `@studio-next/daemon/serve` 再导出、禁止相对路径穿透、测试 `engine` 也走 exports；daemon 实现单执行，boot 收口 `BootOptions.serve` |
| G3 | boot 配置错误用裸 `Error` + 文案 `CONFIG_INVALID` | `boot.ts:109`、`:139`、`:147`、`:169`、`:193`、`:200`、`:207`、`:210`、`:215`、`:220`、`:236`、`:283`、`:320`、`:325` | 无 `failure`（处置轴）、无 `category`（观测轴）、`subcause` 只是文案；调用方只能猜是否重试 | boot 改 `ClassifiedError`（§4.5.4 表）；`subcause` 是 boot 本地稳定细目，不需 80 注册；登录/429/超时不再属 boot（归 daemon/工厂） |
| G4 | `matrixDeptMap` 以 cwd 解析；无 containment/realpath；错误带原样路径 | `boot.ts:197`、`:200`、`:207`、`:210`、`:215`、`:220` | 换 cwd 即读错文件；符号链接可越界；日志/错误泄漏绝对路径 | boot 本地改为“配置目录为基准 + realpath + containment”；部署根由 78 确认 |
| G5 | 秘密无单源（**现状**）：boot env 直读、双名回退写在 boot；daemon 另读 `process.env` 做脱敏与 `hrKnownSecrets` | `boot.ts:144`–`:149`、`:322`–`:327`；`hrsync/config.ts:183`–`:194`；`hrsync/assemble.ts:58`；`serve.ts:913` | 同一个秘密在两个进程里各读一份；无法按 `subjectScope`/`allowedUses` 取用；短值不进脱敏 | **80-§3.3 第 6 条 + §3.4 第 8/10 条 + §11.2.1 已定**：`ServeConfig.secrets` 唯一配置面、daemon 内部载 provider、不新增注入项；boot 侧目标改为**只经两型句柄**（`MatrixBotLoginSecret`/`MatrixHrRegisterSecret`）拿引用、零接触秘密值，空值/轮换/吊销全归 daemon（§4.5.1）；缺口是仍未删 env 直读 |
| G6 | deptMap 两次装载；广播 slug 与供给 snapshot slug 无交叉校验 | `boot.ts:239`、`:285`；`:292` 用 `config.company`；`:249` 用 `snap.slug` | 两次读之间文件变化会导致供给/通知目标不一致；slug 不一致会发到不存在的别名 | boot 内部收口（只读一次、共享 deptSlugs、校验 slug）；不需新公共概念 |
| G7 | `hrMatrix:true` + `hrSync:false` 被静默忽略 | `boot.ts:338`、`:366`；`hrsync/config.ts:160`–`:169` | 配置误写不自报，人事面不装配 | boot 目标拒启（`matrix-hr-matrix-without-hrsync`）；同时回写 80-§3.3 让 daemon 交叉校验同判，避免 `cli serve` 另一条路径仍静默 |
| G8 | 登录后装配失败/`runServe` 返回后不 logout；无双重 `bootServe` 保护（**现状**） | `boot.ts:347`、`:370`；`main.ts:11` | token 留内存；重复调用可能双主循环 | **会话生命周期已定**：登录由工厂内部完成、会话由 `close()` 关闭，`close()` 由 daemon 的 `runtime.stop` 调、先于 `ledger.close`（80-§3.4 第 10 条）；boot 不持句柄也不再自行 logout（现状的 logout 缺失因此不再是 boot 缺陷）。**单实例约束仍待 80-§3.6** |
| G9 | `parseMatrixRoles` 空白键/值、重复键未拒；`PersonId` 未校验 | `boot.ts:106`–`:113` | 坏配置被接受，角色映射到空工号/后写覆盖 | 80/76 明确角色映射的唯一性与工号格式；boot 补校验 |
| G10 | 测试基线 645 与实测 635 不一致；旧文件超 600 | `boundary-rules.mjs:161`；80-§10.6 | 文档数字与实测不同；文件仍在基线内但不得再长 | 80-§10.6/§0.4 校正；拆分后由 19/guards 删基线条目 |
| G11 | 79-§6.5 把 boot 归入 `./src/index.ts`，实际是 `./src/boot.ts` 且无 `index.ts` | `apps/boot/package.json:7`–`:10`；79-§6.5 | 分发/入口口径不一致 | 79 校正，或 80/79 明确是否新增 `src/index.ts` façade |
| G12 | 测试假秘密未用 `test-*` 形 | `boot.test.ts:82`、`:87` | 违反 80-§11.6 的测试夹具建议，增加误读风险 | 81 测试拆分时改名（随 env 路径退役） |
| G13 | `main.ts` 存在但未注册，80 又说 boot 无启动脚本 | `main.ts:1`–`:12`；`package.json` 无 `bin`/`scripts.start`；80-§3.1/§3.6 | 读者可能把 main.ts 当正式入口；部署侧没有明确启动命令 | 78 部署绑定写明手动/正式启动器；80 明确 main.ts 定位 |
| G14 | 无真实 Matrix V5 证据 | 78 `BIND-EDGE-MX-01` V5 缺口 | 入站→意图→受理、真实登录、频道 ensure 未证 | 82 已落地并定义 V5 口径（§2.6），但未给 boot 文件的映射；V5 未执行，不前置 |
| G15 | 组合根边界无静态守护：`boot.ts` 可悄悄新增 daemon 内部 import、协议实现或秘密端口 | `boundary-rules.mjs:104`–`:106`（只查包边）；`boot.test.ts:115`–`:159`（只查三处 import 文本） | 越界无门禁：注入“伸手”、协议“重造”、秘密“私读”都不会红 | 81 目标测试 C1/C2/C3（§8.2）；guards 规则变更须提案/制作人批 |
| G16 | 秘密取用无“最小化”约束（**现状**）：boot 按 env 名直读，没有 scope/use 概念 | `boot.ts:144`、`:322`；80-§11.2.1 | 任意进程拿到 env 即可取全部秘密；无法证明“只取本部署该取的” | 随 G5 一并关闭：scope/use 校验归 daemon 的 provider；boot 侧目标是**零接触秘密值**（§4.5.1），只比对句柄的 `kind`/`secretId`/`use` 三个判别位 |
| G17 | 可选/必需缺失的处置只在 daemon（`REC-LOSS-01` 无写者） | `boot.ts:145`–`:149`、`:323`–`:328`；80-§11.2.1 第 3 条 | 或缺就拒启、或无记录地少装 | **80-§11.2.1 已定**：空串/零字节 ⇒ `rejected_precondition` + `subcause:'secret-empty'`、provider 不可用 ⇒ `unavailable`；装配期必需项失败 ⇒ `CONFIG_INVALID` 但保留原始 failure/subcause，可选项失败 ⇒ 不装配 + `REC-LOSS-01`。boot 侧只剩“句柄缺失/形状不符 ⇒ `CONFIG_INVALID`”，不再有“缺秘密”分支；残留是 78 catalog 与 provider 归属的措辞对齐（§8.3-5/7） |
| G18 | 配置双读只能窄化 | `boot.ts:336`、`:370`；`serve.ts:1470` | 即使加摘要比对，检查与 `runServe` 读取之间仍有窗口 | **已由 80-§3.4 第 7 条解决（设计）**：`runServe` 收 `{ config }`；代码未改，与 G1 同批落地 |

### 8.2 目标补测（均为设计，未实现、未运行）

以下用例放在现有拆分文件内，不新增文件。标“阻塞”的项在对应上位决定前不得写成已支持。

**A. `assembly.test.ts`**

| ID | 用例 | 证明目标 | 阻塞/说明 |
|---|---|---|---|
| A1 | `parseMatrixRoles(' =X')` / `'A= '` 被拒 | 空白键/值不被接受 | boot 目标拒绝（subcause `matrix-roles-empty`）；工号语法是否还要校验取决于 76 是否给 `PersonId` 语法（当前只是裸 string） |
| A2 | 重复角色键（`A=X;A=Y`）被拒 | 映射唯一性 | boot 目标 fail-closed 拒绝（`matrix-roles-duplicate`），不保留“后者覆盖”；若 76/80 另定首个生效则改断言 |
| A3 | 工厂契约：`matrixSessionFactory` 返回 `{ matrixSource, matrixRoomFace, hrMatrixFace, notifyBroadcast, close }`；`hrMatrixFace` 是 `() => MatrixHrFace`（**不是** `MatrixRoomFace`、不是已构造面）；缺任一项或 `close` 非函数 → 拒启 | 工厂形状与 80-§3.4 第 10 条一致 | 用假工厂；不测 daemon 调用方 |
| A4 | 坏句柄：`MatrixBotLoginSecret` 的 `secretId` 不是 `'SEC-MX-BOT-PASSWORD'`/`use` 不是 `'platform-auth'`/`material.kind` 不是 `'password'`，或 `MatrixHrRegisterSecret` 的 `secretId` 不是 `'SEC-MX-HR-SHARED'`/`use` 不是 `'matrix-register'`/`material.kind` 不是 `'shared-secret'`，或两型**互换槽位** → 拒启、不降级、不换用途 | 两型句柄的判别位校验不被绕过 | 用 `fakeBotLoginSecret`/`fakeHrRegisterSecret` 的负向变体（§7 F-boot-testkit）；建号开启而 `registration` 缺失 ⇒ `CONFIG_INVALID`；daemon 侧 provider 校验不在此测 |
| A5 | 所有装配日志/错误不含密码、secret、token、绝对路径；**也不含 `secretId`** | 秘密与路径不出境 | 80-§5.8/§11.2；输出只含 `err.code`、配置键名、面名称 |
| A6 | 坏 deptMap 的错误不含绝对路径 | 路径不泄漏 | 目标行为；现状含原样路径 |
| A7 | deptMap 相对路径基准：`{ configPath }` ⇒ `dirname(resolve(configPath))`；`{ config }` ⇒ `BootOptions.deploymentBaseDir`；越界/符号链接逃逸/不可读被拒 | 路径基准与 containment | 基准由 80-§3.4 第 7 条归 boot；`{ config }` 缺 `deploymentBaseDir` ⇒ `CONFIG_INVALID` + `boot-deployment-base-missing`（**不回落 `process.cwd()`**）；不得用 `homedir()`/cwd 兜底；部署侧键名对齐待 78（§8.3-10） |
| A8 | `ctx.snapshot()` 第二次返回变化后，供给面使用新快照 | 活取新鲜面 | 可直接用 fake ctx 证明 |
| A9 | 供给/广播共享同一次 deptMap 读取 | 一致性 | 需 boot 内部收口；不改公共接口 |
| A10 | 广播 `slug` 与供给 `snapshot.slug` 不一致时拒启/明报 | 共享源单一 | 目标 fail-closed（`matrix-company-slug-mismatch`）；权威关系仍待 76/80（G6） |
| A11 | 工厂与任一直接面**同时出现即 `CONFIG_INVALID` 拒启动**，无论两者内容是否一致；单独给面（测试/迁移）与单独给工厂（生产）都合法 | 兼容面不比较、不择一 | 80-§3.4 第 10 条原话：“两者是否矛盾不可判，所以不做比较、也不得择一静默”；boot 本地 subcause `matrix-session-factory-coinjected` |
| A12 | 开关全关时：不构造工厂、不调工厂、不读 deptMap、不读任何秘密 | 注入最小化 | 用 fake fetch 与调用计数断言零调用；boot 侧无 provider 可计数，故只锁“不构造/不调用” |

**B. `serve.test.ts`**

| ID | 用例 | 证明目标 | 阻塞/说明 |
|---|---|---|---|
| S1 | 装配失败（坏 deptMap/工厂形状不合/开关与注入不匹配）时 `serve` 未被调用 | fail-fast 不半启动 | 现有部分覆盖；补齐三类；不再有“缺秘密/缺 provider”这类 boot 侧失败 |
| S2 | 多面组合时 opts 形状正确：工厂路径只传 `matrixSessionFactory`；兼容路径传四键；**并存即拒，不是择一** | 工厂 XOR 面 | 现有三开覆盖；补 hr+channels+matrix 全组合 |
| S3 | `runServe` 收到的 opts **不含** `env`/`fetch`/`log`/`secrets`/`deploymentBaseDir`，且不含 `BuildRuntimeOpts` 的注入键 | 秘密与工具不下沉、不新增 provider | 用 stub 捕获键名；80-§3.4 第 8 条已定不加 provider，本用例锁“boot 不私塞”；`deploymentBaseDir` 是 boot 自有键，只在 `BootOptions` 上 |
| S4 | 两次 `bootServe` 同进程调用的行为被明确（拒绝/串行/各自注入） | 单实例约束 | 仍待 80-§3.6；当前无保护 |
| S5 | `bootServe` 传的是 `{ config }` 而非 `configPath`；两个分支都接受；`{ config }` 分支的 `deploymentBaseDir` 已由 boot 解析并用于 deptMap | 判别联合口径 | 80-§3.4 第 7 条已定；用 stub 捕获 `input` 形状；夹具直接给 `BootOptions.deploymentBaseDir` |
| S6 | 全关形态（三开关皆假）：不构造工厂、不读 deptMap、不读任何秘密、`serve` 收到空 opts | 注入最小化（不伸手） | 用 fake fetch 的调用计数断言零调用；S3 已锁键集合，本用例锁“没做的事” |
| S7 | 工厂与任一直接面**并存** → boot 在 `serve` 前拒启（`matrix-session-factory-coinjected`），一致与否同判 | 兼容面不比较、不择一 | 80-§3.4 第 10 条；属 boot 本地判负，无需工厂返回值 |

**C. `guards.test.ts`**

| ID | 用例 | 证明目标 | 阻塞/说明 |
|---|---|---|---|
| C1 | `boot.ts` 内 `loadDeptSlugs(` 调用点恰 1 处 | 共享源单点派生（§4.3） | 需 deptMap 单读收口先落地；文本计数，不是 AST |
| C2 | `boot.ts` import 源 ⊆ 白名单，非注释代码不含协议常量、不含 `process.env`、不含秘密端口类型，也不含 `provider`/`KnownSecretSet` 引用；`secretId` 只允许出现在与句柄的**字面量比对表达式**里（`'SEC-MX-BOT-PASSWORD'`/`'SEC-MX-HR-SHARED'`），不得进入日志/错误实参（§7 F-boot-test-guards） | 矩阵边界、注入不伸手、秘密零接触（只比判别位） | 注释剥离是启发式；只作越界提醒，不作能力证明 |
| C3 | `boot.ts` 存在一个返回 `MatrixSessionFactory` 的构造导出；`bootServe` 不无条件同时注入面与工厂——并存时**必然拒启动**（不是“择一”） | 工厂路径是生产路径 | 只证明源码导出形状，不证明运行时行为；并存判负的运行时行为由 A11/S7 覆盖 |

### 8.3 需回写 80/76/77/78/79 的具体对象

1. **80-§3.4 `RunServeOpts`**：~~包级出口未定~~ → **已由 80-§3.4 第 6 条关闭（设计）**：`RunServeOpts` 由 `@studio-next/daemon/serve` 再导出、禁止相对路径穿透、测试 `engine` 也走 `exports`。剩余是实现（daemon 侧未改），不是文档缺口。
2. **80-§5.7 boot 错误映射**：**已移出 boot 面**——登录 401/403、429 重试耗尽、超时都发生在 daemon 装配期与工厂内部，归 80-§3.6 的失败面。仍需 80/78 给 daemon 侧绑定级映射（本附录不再提案）。
3. **80-§3.3/§3.6 配置双读**：~~决定入口~~ → **已由 80-§3.4 第 7 条关闭（设计）**：`runServe` 收 `{ configPath } | { config }` 判别联合，boot 生产传 `{ config }`。剩余是代码未改（G1/G18）。
4. **80-§11.2.1 秘密供给的注入通道**：**已由 80-§3.3 第 6 条 + §3.4 第 8 条关闭（设计）**：`ServeConfig.secrets` 是唯一配置面，provider 由 daemon 内部按 catalog 装配；**不新增** `BuildRuntimeOpts.secretProvider` 或任何“值是秘密”的注入项，测试假 provider 走 daemon 内部测试注入点。本文 v0.3 的 `BootOptions.secrets` 提案**撤销**，不再需要批准。
5. **80-§11.2.1 + 78-§7.4.1 缺失秘密的失败类冲突**：**已由 80-§11.2.1 关闭（设计）**——空串/零字节 ⇒ `rejected_precondition` + `subcause:'secret-empty'` 且不返回材料（歧义就此定案）；provider 不可达 ⇒ `unavailable`；撤销/版本不符 ⇒ `rejected_version`；装配期必需项取到 Err ⇒ `CONFIG_INVALID` 但**保留原始 failure/subcause**（不压成裸配置错）；可选项取到 Err ⇒ 不装配 + `REC-LOSS-01`。故 78-§7.4.1 的“缺失→拒启动”只在“必需项”上成立，措辞需按上述四分类对齐（残留：78 文案，不改设计）。轮换/吊销（文件 mtime/大小或 `SecretMaterial.version` 变化、部署控制通道通知）⇒ 整体重建 `KnownSecretSet`，失败保留旧集 + `known-set-partial` + `REC-LOSS-01` + 禁该 ID 新用途，吊销优先、轮换不改 `secretId`——全部归 daemon，boot 侧无此分支。
6. **78-§7.4.1 `SecretUse` 覆盖 bot 登录**：~~`platform-auth` 未列入~~ → **已由 80-§11.2.1 关闭（设计）**：`SEC-MX-BOT-PASSWORD` 的 `allowedUses` 含 `platform-auth`（登录）与 `matrix-register`（建号），登录失败按 `platform-auth` 归因。~~槽位缺口~~ → **已由 80-§3.4 第 10 条关闭（设计）**：`MatrixSessionFactoryDeps.registration?: MatrixHrRegisterSecret` 收 `SEC-MX-HR-SHARED`，login 与 registration 分属两型句柄；建号开启而 `registration` 缺失 ⇒ 该能力 `CONFIG_INVALID`，**不得**用 bot 密码建号、也**不得**改走 bot 管理 API。残留只剩 78 catalog 把两条 `allowedUses` 与两个 `secretId` 的措辞对齐。
7. **80-§11.2.1 可选缺失的 `REC-LOSS-01` 写者**：~~boot 写~~ → **已由 80 关闭（设计）**：损失登记归 daemon 装配期（provider 与 `KnownSecretSet` 都在 daemon），boot 无台账写口、也不该有。
8. **80-§12.1 通信绑定接缝**：接缝表需按目标态更新——四种形态由 `matrixSessionFactory` 的返回值提供（不是 boot 直接注入），boot 不共享 `client`；供给与广播仍共享同一 `deptSlugs`；`env`/`secrets` 不随 `RunServeOpts` 下沉。
9. **80-§3.1 事实句**：写“boot 用 `@studio-next/daemon/engine`（`createEngine` 等）”，实测 `boot.ts` 只 import `daemon/serve`；`engine` 只出现在 `boot.test.ts`。需校正，否则会诱导 boot 新增 `daemon/engine` 生产 import。
10. **78 `BIND-EDGE-MX-01`**：补 boot 进程的部署绑定：启动命令、cwd、配置路径、`ServeConfig.secrets` 的 catalog 落点（env-ref/file-ref，含 `SEC-MX-BOT-PASSWORD` 与 `SEC-MX-HR-SHARED` 两条）、token 不持久化、V5 探针；明确 `main.ts` 是手动启动器还是正式入口。deptMap 基准**已由 80-§3.4 第 7 条关闭（设计）**：`{ config }` 形态须由部署侧提供 `BootOptions.deploymentBaseDir`——78 需写明该键的部署来源（残留：78 文案）。
11. **76 `DEF-CFG-01` / 78-§7.4.1**：确认 `matrixDeptMap` 属部署配置而非公司定义；`DEF-PKG-05` 只要求秘密的逻辑引用，`ServeConfig.secrets` 是部署绑定，不是定义包内容。
12. **77 `RUN-WORK-01`/§1.8**：确认 boot 只产意图/通知，不写 `REC-*`；外部效果类须回执/观察，通知不是决定；boot 不需要幂等键（去重归 source/engine）。
13. **79-§6.5**：校正 boot 的公开面为 `./src/boot.ts`（当前无 `src/index.ts`），或明确新增 `index.ts` façade 的目标；不要把 boot 与 12 个包的 `src/index.ts` 口径混写。
14. **80-§10.6/§0.4 + 19/guards**：两处需校正。①表的实测/基线两列均写 `645`，与本次实测 635 不一致——把实测列校正为 635 并注明基线 645。②同节末段“根 `tsconfig.json` 只 `include` src，**测试文件不进 typecheck**”对位于 `src/` 下的测试件不成立（`apps/boot/src/boot.test.ts` 按 `apps/*/src/**` 被纳入，本文 §F-boot-tsconfig 已按实测写），应改为“`test/` 目录（包根）不进 typecheck；`src/` 下的测试件仍被纳入”。拆分完成后删除 `boundary-rules.mjs:161` 的该基线条目（只减不增），不新增超限件。
15. **80-§2.1 / 19/guards**：boot 不在 `packageLayers`，零入边目前靠“未登记包”报错与 `boot.test.ts` 字符串扫描双重守护；若要让判负信息更明确，可在 guards 增加“boot 是组合根、禁止入边”的规则，但这是 guards 变更，须提案/制作人批。
16. **81 测试命名**：假密码/假 secret 改为 `test-*` 形，且按两型句柄分开造（`fakeBotLoginSecret()` 的 `material.kind:'password'`、`fakeHrRegisterSecret()` 的 `material.kind:'shared-secret'`，不可互换、不伪造 `secret-empty` 材料）；**fake provider 的条目属 daemon 侧测试**，不在 boot testkit；在测试契约里写明 fake fetch/fake 句柄不证明真机。
17. **76-§5.2（`DEF-CFG-01` 三类配置）+ §3.15（`injectionBoundary`）**：确认 boot 的注入面是**部署配置**那一类，不是公司定义（`CompanySnapshot`）——`config.company`/`matrixDeptMap` 不进公司定义（`secrets` 更不在 boot 面）；并确认 `config.company` 与公司目录 `slug` 的权威关系（G6/A10）。不得用 boot 的注入面去改公司定义。
18. **80-§5.7 两轴构造入口**：现状 `configInvalid(subcause, detail)` 只产出 `category`+`subcause`，缺 `failure` 轴；需 80 给出两轴构造入口（或明确“boot 可直接构造 `ClassifiedError`”并给字段校验规则），否则 §4.5.4 的表无法落成代码。另：实测落点是 **`packages/contract/src/schemas/errors.ts:54`**，80-§5.7 只写“`errors.ts:54`”，路径需补全（`apps/daemon/src/assembly/errors.ts` 不存在）；`ClassifiedError` 本体在 `packages/contract/src/ports/kernel.ts:98`，`FailureClass` 尚未进 `contract`（全仓 grep 零命中）。

### 8.4 未证清单

| ID | 未证项 | 现有证据 | 需要的证据 |
|---|---|---|---|
| U-BOOT-01 | boot 类型通过 | 本次只读；未跑 `tsc` | `tsc --noEmit -p apps/boot/tsconfig.json` + 根 `bun run typecheck` |
| U-BOOT-02 | 现有 35 例测试通过 | 未跑 `vitest` | `bun run test`（或 boot 包 `vitest run`） |
| U-BOOT-03 | 边界守护通过 | 未跑 `guard:boundaries` | `bun run guard:boundaries` |
| U-BOOT-04 | 真实 Matrix 登录（**目标态由 daemon 经工厂驱动**） | 只有 fake fetch | 78/82 的 V5 真机探针（homeserver、bot 账号、token 生命周期），在 daemon 侧跑 |
| U-BOOT-05 | 真实 mention 源轮询/首拉基线/自发消息抑制 | 只有 matrix 包单测（不在本附录范围） | 真机 + 日志/事件证据 |
| U-BOOT-06 | 频道供给 ensure 幂等 | 只有方法存在断言 | 真实房间重跑收敛、PL 同值不写、邀请幂等 |
| U-BOOT-07 | 广播软失败/别名缓存失效 | 只有 `send` 存在断言 | 真实别名解析失败/重建、逐频道报告 |
| U-BOOT-08 | 人事建号/入房/PL/踢出 | 只有方法存在断言 | 真实 shared-secret 建号、权限边界；**前置已关闭**：80-§3.4 第 10 条给出 `registration?: MatrixHrRegisterSecret`（`SEC-MX-HR-SHARED`），由 daemon 装配并注入工厂 deps |
| U-BOOT-09 | `bootServe` 与真实 `runServe` 的启动/停机 | 只有 stub | 进程级集成：启动 10 步、信号、会话 `close()` 先于 `ledger.close`、台账关闭 |
| U-BOOT-10 | 秘密不出现在日志/错误/台账 | 代码阅读 | 捕获全部日志/错误/台账行的负向测试；boot 侧应**零秘密可泄漏**，daemon 侧验原值不出现 |
| U-BOOT-11 | deptMap 路径 containment/realpath | 代码阅读 | 符号链接/越界/相对 cwd 负向探针 |
| U-BOOT-12 | 双重 `bootServe`/双进程并发 | 无 | 双调用/双进程负向测试 |
| U-BOOT-13 | `main.ts` 用法/退出码 | 无测试 | spawn 级测试或部署 smoke |
| U-BOOT-14 | 分发/构建 | 79 结论为不纳入 | 若未来纳入，L7 构建 + `--listFiles` + `.d.ts` 消费 |
| U-BOOT-15 | 共享源单点与矩阵/秘密边界静态断言 | 只有设计（C1/C2/C3）；未写、未跑 | `guards.test.ts` 的 C1/C2/C3 落地并红绿验证 |
| U-BOOT-16 | 供给/广播使用同一 `deptSlugs`、工厂内同一会话 | 只有代码阅读（现状两次读、boot 共享 client） | 单读收口后的行为测试或 C1 静态断言；会话归属由 daemon 侧集成证明 |
| U-BOOT-17 | 秘密装配（`ServeConfig.secrets` → provider → `KnownSecretSet` → `MatrixBotLoginSecret` / `MatrixHrRegisterSecret`） | 无实现：仓内无 `contract/src/ports/secret.ts`，`ServeConfig` 无 `secrets`，boot 仍 env 直读 | **daemon 侧**的装配探针：能力关闭不加载、scope 过滤、use 校验、空值 ⇒ `secret-empty`、provider 不可用 ⇒ `unavailable`、轮换/吊销 ⇒ 整体重建且失败保留旧集 + `known-set-partial`；boot 侧只验 A3/A4 的工厂契约与三判别位比对 |
| U-BOOT-18 | `ClassifiedError` 的 boot 侧映射（failure/category/subcause） | 现状裸 `Error`；本文只给映射表 | 逐 subcause 的正反用例；负向锁定“构造期不得出现 5 个内部故障域 category” |
| U-BOOT-19 | `bootServe` 传 `{ config }` 的单读行为与 deptMap 基准 | 无实现（现状双读、deptMap 按 cwd） | stub 捕获 `input` 形状（S5）；`{ config }` 分支验 `deploymentBaseDir` 生效、缺失报 `boot-deployment-base-missing`；`{configPath}` 分支另测 |
| U-BOOT-20 | 工厂路径与四工厂形状一致、`close()` 顺序；工厂与直接面并存即拒 | 无实现 | daemon 侧集成：工厂返回四工厂 + `close`，`runtime.stop` 调用且先于 `ledger.close`（80-§3.4 第 10 条）；并存拒启由 A11/S7 证明 |

---

## 九、迁移顺序、回退与完成边界

### 9.1 迁移顺序（不可倒）

1. **上位先行（daemon 侧，代码未做）**：`RunServeOpts` 补 `notifyBroadcast` 与 `matrixSessionFactory`（5 键）、`runServe` 收 `{ configPath } | { config }`、`RunServeOpts` 经 `@studio-next/daemon/serve` 再导出、测试 `engine` 走 `exports`（80-§3.4 第 6/7/10 条）。boot 不自行复制类型（G2）。
2. **daemon 秘密与会话**：`ServeConfig.secrets` + provider + `KnownSecretSet` + 两型句柄（`MatrixBotLoginSecret`/`MatrixHrRegisterSecret`）+ 调工厂登录（80-§3.3 第 6 条、§3.4 第 10 条、§11.2.1）；`close()` 由 `runtime.stop` 调、先于 `ledger.close`。boot 不参与。
3. **boot 切工厂**：构造 `matrixSessionFactory` 并把两型句柄装进 `MatrixSessionFactoryDeps`；删 `env` 直读、删装配期登录与共享 client；四个面的直接注入降为测试/迁移兼容（与工厂**互斥**，并存即判负）；判负由“矛盾”改为“并存”（G5/G8/G16/G17）。
4. **共享源收口**：`bootServe` 内 deptMap 只读一次，供给面与广播面共用同一 `deptSlugs`；`slug` 选定单源或加交叉校验（取决于 76/80 结论）；不改公共接口（G6）。
5. **测试拆分**：建 `src/test/testkit.ts`（含 `fakeBotLoginSecret`/`fakeHrRegisterSecret` 两型，不含 provider）；把旧 `boot.test.ts` 的 35 例按 5/19/11 搬到 `guards.test.ts`/`assembly.test.ts`/`serve.test.ts`；逐例对比标题与断言；每件 ≤600 行。
6. **删除旧测试路径**：三份新文件全绿后，删除 `apps/boot/src/boot.test.ts`；由 19/guards 删除/下调 `lineBaseline` 条目（只减不增）。
7. **边界与注入断言**：补 C1（`loadDeptSlugs` 单调用点）、C2（import 白名单 + 无协议常量 + 无 `process.env` + 无秘密端口 + `secretId` 仅限比对表达式）、C3（工厂导出）、S3（opts 无秘密/工具键/`deploymentBaseDir`）、S5（传 `{ config }` 且 `deploymentBaseDir` 生效）、S6（全关零调用）、S7（工厂与直接面并存即拒，不比较不择一）；先红后绿，不跳断言。
8. **错误与路径收口**：按 80-§5.7 的 `failure`/`category` 表与本地 subcause 表（§4.5.4）把裸 `Error` 换为 `ClassifiedError`；按 80-§11.3 补 containment/realpath，错误只留 `err.code` 与配置键名，不留路径（G3/G4）。
9. **单实例**：在 80-§3.6 明确双重 `bootServe` 约束前不加行为；若 80 给约束，按约束实现并补 S4。
10. **部署绑定**：78 写明 boot 的启动命令/cwd/`BootOptions.deploymentBaseDir` 的部署来源/`ServeConfig.secrets` 的 catalog 落点（两条 `secretId`）、`main.ts` 的受限定位；不擅自加 `bin`。

### 9.2 回退

- 工厂切换：回退到**直接四键路径**（兼容面本就保留），运行时不变；**不得**把“boot 读 env 取密码”当回退路径——秘密只有 daemon 一条来源（§4.5.1）；也**不得**回退到“工厂与直接面并存时择一”（80-§3.4 第 10 条：并存即拒）。
- 测试拆分：恢复旧 `boot.test.ts`、删除 `src/test/` 新件；无生产影响。
- 类型收口：回退 `BootOptions.serve` 与测试类型；运行时不变（`BootOptions.deploymentBaseDir` 属 boot 自有键，随判别联合一起回退）。
- 错误/路径改动：逐项回退到裸 `Error`/原路径解析；不得回退测试覆盖。
- 任何回退都不得提高 `lineBaseline`、不得新增包边、不得改 guards 阈值、不得新增 provider 注入键。

### 9.3 完成边界

本文只完成 `apps/boot` 的逐文件设计呈审：

- 现有 5 个常规文件已逐一盘点（生产 2、测试 1、配置 2）；
- 目标 8 个路径（保留 4、新增 4；生产新增 0、测试新增 3 + 测试基建 1）与拆分/退役映射已给出；跨卷目标件（`contract/src/ports/secret.ts`、daemon 的 `RunServeOpts` 再导出等）只引用不计数；
- 组合根层位、两条注入通道、共享源单点、矩阵四面边界与上位接口对照已给出判据与判负清单（§4.1–§4.5、§4.8）；
- 每个文件的生产职责、测试职责、IO、状态、错误、规模与迁移已写；秘密按“boot 零接触、daemon 单源”改写，错误按 80 现行接口改写，未实现部分明确标“目标/阻塞”；
- 所有“目标”均未实施；未运行 typecheck/test/guard，未连接真实 Matrix，未启动服务。仓内 `matrixSessionFactory`、`ServeConfig.secrets`、`contract/src/ports/secret.ts` 均不存在；`runServe` 仍是单 `configPath` 入参、`RunServeOpts` 仍是三键。
- v0.5 相对 v0.4 的三条口径已随 80 定稿落定（两型秘密句柄 + 建号槽位、工厂与直接面并存即拒、`deploymentBaseDir` 归属）；这三条只是**设计已定**，boot 与 daemon 两侧代码都未实现。

因此本文**不构成** boot 全卷 PASS、真实能力已验证、类型/测试/边界门禁已通过或可以据此直接改代码的证明。缺口与回写对象见 §8.3；未证项见 §8.4。§4.3/§4.4 是**待上位确认的设计口径**，不是现状描述：现状恰是共享源分裂（G1/G6）与边界无门禁（G15）。§4.5 的秘密边界是**目标设计**：现状是 boot env 直读 + 裸 `Error`，daemon 侧秘密面与会话工厂尚未实现。
