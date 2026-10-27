# 19 · 根配置、guards 与公司模板

> 状态：设计呈审稿（v0.2，2026-10-27）。本修订基线：80/79/78/77/76 的接口已定稿；本卷只登记文件落位与机械边界，对它们的公共概念不复制、不另造第二套。
> 上位：75 的文件契约；76 的公共语义与纯配置规范；77 的运行记录；78 的宿主与工作区绑定；79 的 TypeScript 工程与依赖选型；80 的运行时与公共 TS 接口。
> 不宣称：本卷写成“修订完成”只表示本卷这一交付形态完成；**不代表 81 其余分卷 PASS，也不代表 75–82 全卷一致**。
> 范围：根 `package.json`、`tsconfig.json`、`tsconfig.base.json`、`.mise.toml`、`.gitignore`、`bun.lock`、`README.md`、`AGENTS.md`、`CHANGELOG.md`、`LICENSE`；`scripts/guards/**`；`templates/**`。
> 不在本卷：各 workspace 包的内部源码与包级 manifest、构建轨的包级 `tsconfig.build.json`、历史设计文档正文、`apps/daemon/src/**`、`packages/**/src/**`。
> 计数口径：以工作树文件为准，排除 `.git`、`node_modules`、`dist`、`.DS_Store`、`*.tsbuildinfo`；`templates` 下的点文件计入。

---

## 〇、读法、边界与不做什么

### 0.1 本附录回答什么

本附录只回答四件事：

1. 根配置与根文档每个文件承诺什么、不承诺什么，当前真实内容是什么，目标只改哪几处；
2. `scripts/guards` 的分层宪法门禁由哪些文件组成，规则数据与执行引擎如何分工，现有测试证明了什么、没证明什么；
3. `templates/**` 的公司目录模板由哪些文件族组成，每个文件的稳定 ID、路径、职责、结构、依赖、IO、失败面、秘密边界、证据与预算；
4. 哪些目标是 75–80 已定的语义，哪些只是本附录的文件落位，哪些缺口必须回写主卷，不能在附录私定。

### 0.2 标记与效力

| 标记 | 含义 | 本文用法 |
|---|---|---|
| 现有 | 工作树中已存在、本次已读实际内容 | 只描述现状，不把注释当能力 |
| 目标保留 | 路径与职责不变，目标不打算改内容 | 不产生新文件 |
| 目标替换 | 路径不变，目标要改文件内容 | 只写改什么与依据，不写实现 |
| 目标新增 | 目标要新建的文件 | 必须回指 75–80 的具体 ID；本文只给文件职责与机械边界 |
| 目标拆分 | 语义上要分开承载 | 物理路径未定的，只登记“需回写”，不私定路径 |
| 目标退役 | 目标要删除的文件 | 本文无退役件 |
| 库级未接 | 库内已有实现，但未接入目标链路 | 例如 `framework_version` 的 migrate 消费方 |
| 未证 | 本次没有运行或没有可复算证据 | 不写成“已实现/已通过” |
| 需回写 | 缺口属于 76/77/78/79/80/82 的主卷 | 本文只列对象与影响，不补一套同义定义 |
| 跨卷登记 | 目标件已由别的分卷登记 F-ID，本卷只写一致性约束 | 见 §2.5；**不计入本卷件数** |

### 0.3 不做什么

- 不修改任何生产代码、manifest、锁文件、guard、模板或测试；不安装依赖；不执行 git 写操作。
- 不把 `README`、`AGENTS`、`CHANGELOG`、模板注释里的“已达成/已支持”当作能力证明。
- 不新造公司语义、TS 端口、REC-ID、状态、允许依赖边或依赖版本；目标新增只落 79-§10.3 已定的机械检查。
- 不把“模板能被校验器读通”写成“公司能运行”；不把“插件文件形态正确”写成“DSH 真机加载成功”。
- 不以合并、省略或概括条目的方式凑计数；每个文件在本文都有独立 F-ID 与路径。

### 0.4 条目字段约定

每个 `#### F-…` 条目固定十二项：**路径 / 处置**、**归属**（即“上位 ID”——指 76/77/78/79/80 的条款号或资产族编号，如 `79-D2`、`80-§3.2`、`DEF-PKG-01a`）、**职责**、**非职责**、**内部结构**、**依赖 / IO**、**状态 / 并发 / 事务**、**失败与错误分类**、**秘密边界**、**证据与测试**、**尺寸预算**、**迁移 / 兼容 / 回退**。

模板 225 件用“族契约 + 表行”压缩：族契约给上述共性字段，表行给该文件的 F-ID、路径与事实值（行数、部门、工号、绑定等）。两种形态承载同一组契约，不因为表格压缩就少字段。

---

## 一、现有件全集与可复算计数

### 1.1 总量

| 类 | 文件数 | 路径口径 |
|---|---:|---|
| 根配置 | 6 | `package.json`、`tsconfig.json`、`tsconfig.base.json`、`.mise.toml`、`.gitignore`、`bun.lock` |
| 根文档 | 4 | `README.md`、`AGENTS.md`、`CHANGELOG.md`、`LICENSE` |
| guards 生产脚本 | 2 | `scripts/guards/boundary-rules.mjs`、`scripts/guards/boundaries.mjs` |
| guards 测试 | 1 | `scripts/guards/boundaries.test.mjs` |
| 公司模板 | 225 | `templates/**` 全部文件，含点文件 |
| **合计** | **238** | 上述五类之和 |

复算命令：

```bash
find scripts/guards -maxdepth 1 -type f | wc -l          # 3
find templates -type f | wc -l                            # 225
# 根 6 + 根文档 4 + guards 3 + 模板 225 = 238
```

### 1.2 模板 225 的分类

| 族 | 文件数 | 说明 |
|---|---:|---|
| `org-config.yaml` | 10 | 每套模板一份 |
| `.studio-next.yaml` | 10 | 每套模板一份 |
| `README.md` | 10 | 每套模板一份 |
| `charter.md` | 10 | 每套模板一份 |
| `prompts/company.md` | 10 | 每套模板一份 |
| `departments/**/config.yaml` | 56 | 含嵌套部门 |
| `departments/**/people/*.md` | 91 | 人事档案 |
| `dependencies.yaml` | 2 | 仅 game / internet |
| `plugins/**` | 6 | 2 个插件 ×（package.json + patch + index.mjs） |
| `.gitkeep` | 18 | 2–9 各 2 个 + game/internet 各 1 个 |
| `docs/*.md` | 2 | 仅 game / internet 有实体文档 |
| **合计** | **225** | 10+10+10+10+10+56+91+2+6+18+2 |

注意：上面的 `docs/*.md` 2 件与 `.gitkeep` 18 件不重叠；2–9 的 `docs/` 是 `.gitkeep`，game/internet 的 `docs/` 是实体 `.md`。

### 1.3 10 套模板矩阵

| 模板 | 级 | 文件数 | 部门 config | 人员档案 | jobs | org-config 行数 | 当前 schema |
|---|---:|---:|---:|---:|---:|---:|---|
| `company-2-level` | 2 | 9 | 1 | 1 | 2 | 181 | `org-config/v1` |
| `company-3-level` | 3 | 16 | 2 | 7 | 4 | 169 | `studio-next/org@1` |
| `company-4-level` | 4 | 19 | 2 | 10 | 4 | 202 | `studio-next/org@1` |
| `company-5-level` | 5 | 26 | 6 | 13 | 12 | 348 | `studio-next/org@1` |
| `company-6-level` | 6 | 32 | 10 | 15 | 16 | 442 | `studio-next/org@1` |
| `company-7-level` | 7 | 31 | 11 | 13 | 16 | 428 | `studio-next/org@1` |
| `company-8-level` | 8 | 35 | 12 | 16 | 20 | 509 | `studio-next/org@1` |
| `company-9-level` | 9 | 25 | 8 | 10 | 16 | 371 | `studio-next/org@1` |
| `company-game` | 3 | 16 | 2 | 3 | 2 | 149 | `org-config/v1` |
| `company-internet` | 3 | 16 | 2 | 3 | 2 | 198 | `org-config/v1` |
| **合计** | — | **225** | **56** | **91** | **94** | — | — |

复算要点：

- 部门 config 合计 56，人员合计 91，jobs 合计 94（jobs 内联在 `org-config.yaml`，不是独立文件）。
- 8 级模板 35 个文件，目录直属最多 6 个（`company-4-level/departments/研发部/people/` 6 份档案）；行业包根目录直属 4 个非点文件（另有 1 个点文件 `.studio-next.yaml`，按 BC-S1 的非点计数不占名额）；25 文件阈值是“目录直属”，不是“子树总数”。
- 最大单文件是 `templates/company-8-level/org-config.yaml` 的 509 行，低于 600 行阈值；模板目录不在 `boundaries.mjs` 的扫描范围内（`scopeDirs` 只含 `apps`/`packages`），因此模板尺寸由本文预算约束，不由现行 guard 机械约束。

### 1.4 本次实际核对过的代码锚点

| 锚点 | 核对内容 |
|---|---|
| `package.json` | scripts、engines、packageManager、workspaces、devDependencies；无 `trustedDependencies` |
| `tsconfig.json` / `tsconfig.base.json` | 根 include 只含 `src`；严格开关；`erasableSyntaxOnly`；`noEmit` |
| `.mise.toml` | Node `24.21.0`、Bun `1.4.3` |
| `.gitignore` | 仅 4 行：`node_modules`、`dist`、`*.log`、`.DS_Store` |
| `bun.lock` | `lockfileVersion: 2`、`configVersion: 1`、18 个 workspace 条目、157 个 packages 条目、140 个镜像 tarball、140 个 `sha512-`、55 个 `workspace:` 引用、无 `trustedDependencies` |
| `scripts/guards/*` | 规则数据 16 类导出、7 层纵轴、13 条纵边、16 个层位包、38 条包间边、22 条行数基线、1 条反向边规则；引擎 13 个导出与 5 个检查器 |
| `templates/**` | 10 套模板的全部文件树；每套 `org-config`、部门 config、人员 front-matter、jobs、可选段、插件、依赖清单 |
| `templates/**` 的 YAML 事实 | 用 bun 隔离仓里的 `yaml@2.9.1` 解析后计数：jobs 94、部门 config 56、人事档案 91；`level_distribution` 与 `people[].level` 实数 10/10 套一致；部门 config 的 jobs 集合与 org-config jobs 集合 56/56 一致。**不能**用 `grep '^  - id:'` 复算 jobs——它会混入 `people[]` 的 `- id:` 行 |
| `packages/company/src/{validator,multifile,gen-template,init,git-import,repo-validate,level-specs,dependencies}.ts` | 模板被谁读、被谁写、哪些交叉校验存在、哪些不存在 |
| `packages/contract/cases.json` | dir 域 3 条 case 仍用 `org-config/v1` 字面量（与模板 8 件同批迁移，见 §5.5.1） |
| `packages/company/test/*`、`apps/daemon/test/cli/industry-templates.e2e.test.ts`、`packages/panel/test/overview*.test.ts` | 模板与 guard 的实际测试锚点 |
| 79/80/76/78 相关章节 | 版本收紧、构建轨、manifest 一致性检查、纯配置/能力包分界、公司目录是数据包 |

本次只执行了只读命令：`node scripts/guards/boundaries.mjs` → `PASS`，扫描 627 文件（范围面代码件 499），0 违例，exit 0。该结果是**现状结构检查**，不是目标实现证据。

运行环境与证据边界：本机 `node v25.6.1`，**无 `bun`**（`bun --version` → `command not found`），因此 `bun run typecheck`、`bun run test`（vitest 全套）本次均未运行；上条 guard 也跑在**非钉死**的 24.21.0 运行时下。根 `node_modules` 只装了 `@types/node`/`typescript`/`vitest`，`yaml` 位于 bun 隔离仓 `node_modules/.bun/yaml@2.9.1/`。本文所有“PASS/一致”都限定为已列出的只读命令，不外推到目标实现。

---

## 二、目标件全集与处置计数

### 2.1 计数

| 处置 | 数量 | 说明 |
|---|---:|---|
| 现有件 | 238 | §1.1 |
| 目标新增 | 3 | `scripts/guards/manifest-rules.mjs`、`manifests.mjs`、`manifests.test.mjs` |
| 目标替换内容 | 14 | 根 6 + 模板 8（见 2.3） |
| 目标拆分 | 0（已执行口径） | 6 个插件文件登记“目标分离”，物理路径未定，见 2.4 |
| 目标退役 | 0 | 本文无退役件 |
| 目标路径变更 | 0 | 现有 F-ID 不复用、不改路径 |
| **目标件总数** | **241** | 238 + 3，路径变更不增减 |

> 另有 **6 个跨卷目标件**（`contract` 3 + `core` 1 + `daemon` 2）已由 01/02/17 分卷登记 F-ID；本卷只写它们与根件/guard 的一致性约束，**不计入 241**，见 §2.5。

### 2.2 目标新增 3 件的依据

79-§10.3 明说“现有 guard 只查层位/允许边/尺寸/平面，不查 manifest 与 import 图是否一致。目标新增三项检查（**归 81 落文件**、82 落证据）”。本文据此落三个文件：

| 目标文件 | 职责 | 不做什么 |
|---|---|---|
| `scripts/guards/manifest-rules.mjs` | 规则数据：扫描哪些 manifest、检查哪两个依赖字段、忽略哪些说明符 | 不执行、不读盘、不做包管理 |
| `scripts/guards/manifests.mjs` | 执行引擎：三项机械检查 + CLI + 退出码 | 不做 AST、不自动修、不安装依赖、不做运行时解析 |
| `scripts/guards/manifests.test.mjs` | 测试面：夹具逐规则红绿 + 清理后的真仓 0 违例断言 | 不证明运行时、安装成功或安全 |

这三件不新增公共语义，只把 79-§10.3 的三条检查落成 guard 文件；规则号 `BC-M1..M3` 只是 guard 内部诊断号，不进入 76/77 的公共记录或状态。

### 2.3 目标替换内容 14 件

| 文件 | 目标改动 | 依据 |
|---|---|---|
| `package.json` | `engines.node` 收紧为 `>=24.21 <25`；`packageManager` 改 `bun@1.4.3`；加 `trustedDependencies: []`；`daemon` 脚本改 CLI；清理死依赖；清理后接入 manifest guard | 79-D2/D3/D9/§10.1/§10.3/§11.1；80-§3.2 |
| `tsconfig.json` | 根 include 从通配改为“未切包枚举”，已切包退出根 program；不引入 `paths`/project references | 79-§5.4/§6.5 |
| `tsconfig.base.json` | 只改头注：`bun build --compile` 改为“默认独立 tsc 发射，bun compile 另审” | 79-D1 |
| `.gitignore` | 补 `.env`、`.env.*`、`!.env.example`、`*.tsbuildinfo` | AGENTS §五.6；75-D75-13 秘密边界；79-§5 构建产物 |
| `README.md` | 修 store 描述、补全包列表、Quickstart 改 Node 等价命令、`daemon` 说明改 CLI | 79-D4/D5/D14；80-§3.2 |
| `AGENTS.md` | 修 store 描述、`bun run daemon` 说明、类型门禁口径、manifest guard 接入说明 | 79-D4/D5/D10/§10.3；80-§3.2 |
| `templates/company-2-level/org-config.yaml` | `schema` 迁移到 `studio-next/org@1` | 76-DEF-PKG-01a；51 B-1；multifile 并集口径 |
| `templates/company-2-level/.studio-next.yaml` | 同上 | 同上 |
| `templates/company-game/org-config.yaml` | 同上（含头注两处旧字面量） | 同上 |
| `templates/company-game/.studio-next.yaml` | 同上 | 同上 |
| `templates/company-game/README.md` | 同上（正文旧字面量） | 同上 |
| `templates/company-internet/org-config.yaml` | 同上（含头注两处旧字面量） | 同上 |
| `templates/company-internet/.studio-next.yaml` | 同上 | 同上 |
| `templates/company-internet/README.md` | 同上（正文旧字面量） | 同上 |

`bun.lock` 不计入“目标替换内容”：它是生成物，随 manifest 变更由 `bun install` 重生成，不手改。`.mise.toml` 不计入：现有版本钉已与 79-D2/D3 的目标值一致。`CHANGELOG.md`、`LICENSE` 不计入：目标不改写。

### 2.4 目标拆分 0 的说明与 6 个待分离文件

按 76-DEF-PKG-02/03，分发型聚合体必须有 part 索引与 definition-only 子集；按 78-BIND-WS-01 的 D1，公司目录是数据包，纯配置与可执行能力必须分开，可执行内容走能力包通道。当前 `templates/company-game` 与 `templates/company-internet` 把纯配置与 DSH 插件混在同一公司目录内，这是已登记的语义冲突。

本文不把“拆分”写成已定的物理动作，因为 75–80 没有给出 part 索引的文件名、能力包的落盘路径与迁移波次。本文只登记：

| 待分离文件 | 现路径 | 目标归属 | 缺口 |
|---|---|---|---|
| `dsh-asset-check` 的 `package.json` / `cordis.patch.yml` / `src/index.mjs` | `templates/company-game/plugins/**` | 能力包 part（可执行） | 76-DEF-PKG-02/03 的 part 索引与 78 的能力安装根路径未定 |
| `dsh-web-test` 的 `package.json` / `cordis.patch.yml` / `src/index.mjs` | `templates/company-internet/plugins/**` | 能力包 part（可执行） | 同上 |

因此：目标拆分计数为 **0 个已执行拆分**；6 个插件文件在目标处置栏写“保留 + 待分离”，不计入新增/退役/路径变更。物理承载与波次需回写 76/82。

### 2.5 跨卷登记（不计入本卷件数）

下列目标件由别的 81 分卷登记 F-ID；本卷只登记“与本卷文件的一致性约束”，**不重复造 ID、不计入 §2.1 的 241**。

| 目标文件 | 归属卷 / F-ID | 80 锚点 | 与本卷的一致性约束 |
|---|---|---|---|
| `packages/contract/src/ports/intent.ts` | 01-contract `F-contract-port-intent` | 80-§6.6 `TS-PORT-API-01` / §9.2：`IntentSubmissionPort`、`IntentReceipt`、`IntentKey`/`IntentSubmitResult` | 只增文件不改根件；manifest guard 会把它计入 `contract` 的 `src` import 图，必须与 `packages/contract/package.json` 的 `dependencies` 一致 |
| `packages/contract/src/ports/secret.ts` | 01-contract `F-contract-port-secret` | 80-§11.2.1：`SecretCatalogEntry`/`SecretProvider`/`SecretMaterial`/`KnownSecretSet` | 模板不得出现 `SEC-*`/秘密（§5.1）；guard 只扫 import 图，不扫字符串，秘密扫描不因此件豁免 |
| `packages/contract/src/secrets.ts` | 01-contract `F-contract-secrets`（自 `packages/core/src/secrets.ts` 整模块迁入） | 80-§11.2-3；core 只做具名再导出 | 根 `tsconfig.json` 仍通配 `packages/*/src/**/*.ts`，不因新文件改 include；core 侧路径不变 |
| `packages/core/src/work-readiness.ts` | 02-core `F-core-work-readiness` | 80-§7.2 2h：开工五门纯函数 | 零 IO；`core/src` 直属 18→19，仍在 25 阈内；不加 `paths`/依赖 |
| `apps/daemon/src/assembly/intent/ingress.ts` | 17-daemon `F-daemon-intent-ingress` | 80-§6.6：`submit` = `WorkIntake.reserve` 落 `REC-WORK-01` → 刷投影 → `engine.ingest` → 回执 | 新文件进 `assembly/intent/` 子目录，**不占** `assembly/` 直下平面（基线 1 不变）；方向表不改 |
| `apps/daemon/src/assembly/intent/receipt-store.ts` | 17-daemon `F-daemon-intent-receipt-store` | 80-§6.6：`IntentReceipt` 是投影 `intent_receipts`（03-store v14） | 同上；不新增允许边 |

约束：这 6 件**不提高本卷任何阈值**，也不改方向表/基线；`manifests.mjs` 会把它们计入 import 图统计（`stats.srcFiles`/`dependencies`），所以 §4.2 的“现状已知违例”列表在落地后要重算一次。跨卷条目的详细契约以 01/02/17 为准，本卷不复述。

---

## 三、根配置与根文档逐件

### 3.1 根配置 6 件

#### F-ROOT-package — `package.json`

- **路径 / 处置**：`package.json`；现有；目标替换（§2.3）。
- **归属**：79-§2（工具链）、§10（依赖一致性）、§11（安装与复现）；80-§3.2（入口脚本）。
- **职责**：workspace 根 manifest；声明 Node/Bun 版本、workspace 范围、根脚本、根 devDependencies；是 `bun install`、`tsc`、`vitest`、`node` 的统一入口。
- **非职责**：不是任何包的能力声明；不承载运行时配置；不承载秘密；不定义公司语义；不替代 `apps/*`、`packages/*` 的包级 manifest。
- **内部结构**：`name`/`version`/`private`/`description`/`license`/`author`/`type`/`packageManager`/`workspaces`/`engines`/`scripts`/`devDependencies`。当前 `scripts` 四项：`typecheck=tsc --noEmit`、`guard:boundaries=node scripts/guards/boundaries.mjs`、`test=bun run guard:boundaries && vitest run --passWithNoTests`、`daemon=node apps/daemon/src/index.ts`。根 devDependencies 三项：`@types/node ^24.0.0`、`typescript ^5.9.0`、`vitest ^3.0.0`。
- **依赖 / IO**：被 Bun 与 Node 读取；脚本派生 `tsc`、`node`、`vitest` 子进程；`bun install` 访问 registry；运行期无网络。
- **状态 / 并发 / 事务**：无内存状态；`bun.lock` 是唯一安装状态；同一 workspace 并发安装不受支持，退化为锁文件竞争。
- **失败与错误分类**：脚本缺失/拼错 → 命令失败（非零退出）；Node 版本低于 `engines` → 安装或运行失败；`test` 前置 guard 失败 → 整链非零；无业务错误分类。
- **秘密边界**：无令牌、无 registry 凭据、无本机路径；仓库无 `bunfig.toml`/`.npmrc`（本次核对），registry 由 lock 的 URL 体现。
- **证据与测试**：`bun run guard:boundaries` 本次 exit 0；`bun run test` 会把 `boundaries.test.mjs` 一并跑；本次未跑 `typecheck`/`test`。目标 manifest guard 的接入见 §4.2。
- **尺寸预算**：≤ 50 行；当前 28 行。
- **迁移 / 兼容 / 回退**：按 §2.3 逐项改；每步单独提交；回退=还原 manifest + `bun install` 重生成锁；不一次性重排全部依赖（79-§10.4）。
- **目标形状（未执行）**：`engines.node = ">=24.21 <25"`；`packageManager = "bun@1.4.3"`；`trustedDependencies: []`（目前键不存在，不是空数组）；`daemon = "node apps/daemon/src/cli/main.ts serve"`；新增 `guard:manifests = "node scripts/guards/manifests.mjs"`（**先独立**，79-§10.4 清理完成后才串进 `test`）；死依赖清理面引用 79-§10.1，**不得删休眠边**（方向表/允许边不因删依赖而变）。

#### F-ROOT-tsconfig — `tsconfig.json`

- **路径 / 处置**：`tsconfig.json`；现有；目标替换（include 策略）。
- **归属**：79-§4（类型门禁）、§5.4（切换包退出根 program）、§6.5（切换顺序）；75-§4.1。
- **职责**：仓根类型门禁的 program 边界；当前只 include `apps/*/src/**/*.ts` 与 `packages/*/src/**/*.ts`，一次覆盖全部未切包源码。
- **非职责**：不覆盖 `test/`（79-D10 已登记缺口）；不覆盖 `scripts/`、`templates/`、`docs/`；不发射产物；不定义包级 include。
- **内部结构**：`extends: ./tsconfig.base.json`；`include` 两条通配。无 `files`、`exclude`、`paths`、`references`。
- **依赖 / IO**：被 `tsc --noEmit` 读取；无运行期 IO；读取整个根 program 的 `.ts` 与依赖的 `.d.ts`。
- **状态 / 并发 / 事务**：无状态；每次 `tsc` 重建 program；无缓存写入（未开 incremental）。
- **失败与错误分类**：类型错误 → `tsc` 非零；缺包/缺声明 → TS2307；切包后仍从 `src` 解析 → 由 79-§6.3 的失败模式覆盖，本文件不自行兜底。
- **秘密边界**：只读源码；不读 `.env`；错误输出可能含源码片段，属本地开发面。
- **证据与测试**：`bun run typecheck`；本次未运行（本机无 bun）。79-D10 的 `test/` 缺口需 82 立独立 `typecheck:test` 或等价项，本文不私设脚本（W82-8）。
- **尺寸预算**：≤ 30 行；当前 5 行。
- **迁移 / 兼容 / 回退**：目标是“**未切包枚举、已切包退出根 program**”：已切换的包从 `include` 移除（或加 `exclude`），并由包级 `tsc --noEmit -p packages/<pkg>/tsconfig.json` 串进根 `typecheck`；不引 `paths` 回 `src`，不引 project references（79-§6.4）。回退=恢复通配 include。当前 17 个包各有包级 `tsconfig.json`，其中 `adapters`/`core`/`dsh-bridge`/`prompt` 已含 `test/**/*.ts`。口径按 79-§4.4 收窄：根 `typecheck` 只串**已切包**（显式包列表或 `bun run --filter`，禁通配；当前切换集为空，首批候选见 79-§6.5），4 个含 test 的包当前由各自包级脚本承接（根脚本不串接；其中 `dsh-bridge` 若进入切换集，按 79-§4.4 并入根串接）；`test/` 目录缺口归 79-D10（§3.4、W79-1、W82-8）。

#### F-ROOT-tsconfig-base — `tsconfig.base.json`

- **路径 / 处置**：`tsconfig.base.json`；现有；目标替换（仅头注 D1）。
- **归属**：79-§4（严格性）、§5.3/§5.4（构建选项交互）；75-§4.1。
- **职责**：全部包共享的编译选项基类；冻结严格性、可擦除语法、NodeNext、`noEmit`。
- **非职责**：不定义 include；不发射产物；不替代包级 `tsconfig.build.json`；不承载路径别名。
- **内部结构**：`target/lib: ES2024`；`module/moduleResolution: nodenext`；`types: ["node"]`；`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitOverride`、`noFallthroughCasesInSwitch`、`noUnusedLocals`、`noUnusedParameters`；`erasableSyntaxOnly`、`verbatimModuleSyntax`、`isolatedModules`；`allowImportingTsExtensions`；`noEmit`、`skipLibCheck`、`resolveJsonModule`、`forceConsistentCasingInFileNames`。
- **依赖 / IO**：被包级 `tsconfig.json` 继承；无运行期 IO。
- **状态 / 并发 / 事务**：无状态；选项变更影响全部包，属全局门禁变更。
- **失败与错误分类**：破坏可擦除语法 → `erasableSyntaxOnly` 报错；`noEmit` 未覆盖 → 构建空跑（79-§5.4 陷阱一）；`allowImportingTsExtensions` 与 emit 的关系见 79-§5.3。
- **秘密边界**：无秘密；`skipLibCheck` 会跳过依赖 `.d.ts` 内部检查，不改变运行时。
- **证据与测试**：`bun run typecheck`；79-§5.5 的消费者探针是目标证据，本次未跑。
- **尺寸预算**：≤ 60 行；当前 33 行。
- **迁移 / 兼容 / 回退**：只改头注（D1：`tsc` 独立发射为默认，`bun build --compile` 另审）；**不在基类加 `rewriteRelativeImportExtensions`**——79-§5.2 把它定为包级 `tsconfig.build.json` 的覆盖键；构建配置在包级显式 `noEmit: false`，不改基类；回退=还原注释。

#### F-ROOT-mise — `.mise.toml`

- **路径 / 处置**：`.mise.toml`；现有；目标保留。
- **归属**：79-§2（版本钉）、§11.5（R2 可重建）；80-§0.4。
- **职责**：随仓锁定 Node `24.21.0` 与 Bun `1.4.3`，主仓与 worktree 继承同一工具链。
- **非职责**：不安装依赖；不定义 registry；不替代 `package.json` 的 `engines`/`packageManager`。
- **内部结构**：`[tools]` 两键；两行注释说明继承关系。
- **依赖 / IO**：被 mise 读取；运行期无 IO；不联网（安装由 mise 自身负责）。
- **状态 / 并发 / 事务**：无状态；版本切换是环境动作。
- **失败与错误分类**：mise 未安装 → 文件被忽略；版本不可用 → mise 安装失败；与 `package.json` 声明不一致 → 79-D2/D3 的漂移。
- **秘密边界**：无秘密；无本机路径。
- **证据与测试**：本次实测 `node --version` → `v25.6.1`（与本文件 `24.21.0` 漂移）；`bun --version` → `command not found`。这是**本机环境漂移**，不是文件错误：`.mise.toml` 仍是 79-D2/D3 的钉死基准；mise 未激活时以本机版本运行，guard 实跑即在 v25.6.1 下完成。
- **尺寸预算**：≤ 10 行；当前 5 行。
- **迁移 / 兼容 / 回退**：目标不改；`package.json` 向本文件收敛（D2/D3），不是反过来放宽本文件。

#### F-ROOT-gitignore — `.gitignore`

- **路径 / 处置**：`.gitignore`；现有；目标替换（补秘密与构建产物模式）。
- **归属**：75-D75-13（安全边界）；79-§5（构建产物）；AGENTS §五.6（密钥永不入库）。
- **职责**：排除依赖、构建产物、日志、系统杂音与本地环境文件。
- **非职责**：不是访问控制；不防止已跟踪文件泄漏；不替代 secret 扫描；不定义公司目录的 `.gitignore`（模板各自有一份）。
- **内部结构**：当前 4 行：`node_modules`、`dist`、`*.log`、`.DS_Store`。
- **依赖 / IO**：被 git 读取；无运行期 IO。
- **状态 / 并发 / 事务**：无状态；只影响未跟踪文件。
- **失败与错误分类**：模式写错 → 文件被误跟踪；`.env` 未忽略 → 秘密入库风险；无错误分类。
- **秘密边界**：目标补 `.env`、`.env.*`、`!.env.example`；不把 `.env.example` 当秘密；`.VSCodeCounter/` 是否入库由 82 定，本文不擅自加。
- **待裁候选（不私定）**：`run/daemon.sock`（80-§11.4.1 的运行时 socket 路径）与 `var/`（README Quickstart 的 `var/daemon.yaml`）是否入库，取决于部署形态与是否放样例配置；本文只列候选，交 82/部署卷裁定（W82-10）。
- **证据与测试**：`git status --short` 本次显示既有改动与未跟踪文档；无自动化测试；`scripts/guards` 不检查 `.gitignore`。`*.tsbuildinfo` 是预防项：当前未开 `incremental`，仓内 0 个该后缀文件。
- **尺寸预算**：≤ 15 行；当前 4 行。
- **迁移 / 兼容 / 回退**：加模式不改已跟踪文件；若某文件已被跟踪，需 `git rm --cached` 才生效，属实现单动作；回退=删除新增行。

#### F-ROOT-lock — `bun.lock`

- **路径 / 处置**：`bun.lock`；现有；目标保留（生成物，随 manifest 重生成）。
- **归属**：79-§11.1/§11.2（安装脚本与 registry）、§11.5（R1 可重装）；75-D75-09（版本精确锁）。
- **职责**：冻结 workspace 解析结果与第三方 tarball 完整性；是可重装的唯一安装状态。
- **非职责**：不是依赖声明（声明在 manifest）；不证明上游发布者身份；不证明构建可复现（R2/R3 未达）；不手改。
- **内部结构**：`lockfileVersion: 2`；`configVersion: 1`；`workspaces` 18 条（根 + 17 包）；`packages` 157 条；每条含解析版本、`registry.npmmirror.com` tarball URL、可选 os/cpu、`sha512-` 完整性；55 个 `workspace:` 引用；无 `trustedDependencies`。
- **依赖 / IO**：被 `bun install` 读写；网络访问镜像；无运行期 IO。
- **状态 / 并发 / 事务**：锁文件是状态；并发安装可能互相覆盖；`--frozen-lockfile` 把“锁与 manifest 不一致”变成安装失败。
- **失败与错误分类**：镜像不可达 → `--frozen-lockfile` 失败；完整性不匹配 → 安装失败；manifest 改动未重生成 → frozen 安装失败；无业务分类。
- **秘密边界**：无令牌；URL 是公共 registry 镜像；完整性哈希不是秘密；不得把镜像 URL 写进对外包文档或脚本（79-§11.2）。
- **证据与测试**：计数由 `grep -c` 复算（140/140/55/0）；`bun install --frozen-lockfile` 是目标 CI 动作，本次未运行。
- **尺寸预算**：生成物，无行数预算；当前 503 行；`lockfileVersion` 变更属工具链变更。
- **迁移 / 兼容 / 回退**：manifest 清理后重生成；每步单独提交；回退=随该步提交回退锁文件并重装（79-§10.4）。

### 3.2 根文档 4 件

#### F-ROOT-readme — `README.md`

- **路径 / 处置**：`README.md`；现有；目标替换（内容纠偏）。
- **归属**：79-D4/D5/D14；80-§3.2；75-§4.1（文档性配置只作说明，不作规范）。
- **职责**：面向使用者的项目说明：定位、目录结构、Quickstart、文档入口、许可。
- **非职责**：不是规范、不是验收口径、不是能力证明；不替代 `docs/`；不承诺未接线面可用。
- **内部结构**：标题与定位；三条事实源；目录树；Quickstart 七步；`bun run daemon` 注记；文档与许可。
- **依赖 / IO**：人读；无运行期 IO；Quickstart 命令派生 Bun/Node 子进程。
- **状态 / 并发 / 事务**：无状态。
- **失败与错误分类**：命令过时 → 使用者执行失败；当前 `bun <file.ts>` 与正式 Node 运行时不符（79-D14）；无自动校验。
- **秘密边界**：示例使用 `<slug>`、`my-company` 等占位；不得放真实凭证、本机路径、内网地址。
- **证据与测试**：无测试；本次人工核对；不能作为“Quickstart 已跑通”的证据。
- **尺寸预算**：≤ 100 行；当前 69 行。
- **迁移 / 兼容 / 回退**：目标改动六项——① `store` 去掉 `drizzle`（改为 `node:sqlite`：台账、migration、快照、重建）；② 目录树补全 **17 个 workspace**（现只列 10 个：缺 `apps/boot`、`packages/dsh-bridge`、`gateway`、`localplatform`、`matrix`、`studio-tools`、`taiga`）；③ Quickstart 给 Node 等价命令（`node apps/daemon/src/cli/main.ts …`，79-D14），不再以 `bun <file.ts>` 为唯一形态；④ 删除“`bun run daemon` 横幅即退”的骨架注记，改为 `serve`；⑤ 纠正 `packages/api` = `:8788` 对外 API 的现状错位（现外部面在 `packages/panel/src/external`，`packages/api` 是 43 行 `PACKAGE_STATUS='skeleton'`；80-§9.4 目标在 `apps/daemon/src/assembly/api`），最终归属由 14-api/17-daemon 回写；⑥ 端口约定保持 8791/8788/8789 不改。回退=还原文本。

#### F-ROOT-agents — `AGENTS.md`

- **路径 / 处置**：`AGENTS.md`；现有；目标替换（内容纠偏）。
- **归属**：79-D4/D5/D10/§10.3；80-§3.2；项目工作纪律。
- **职责**：给进入本仓的 agent 的第一份上下文：项目是什么、目录结构、开发/测试命令、纪律要点、先读文档。
- **非职责**：不是特权指令通道；不能覆盖上层指令；不是规范正文；不证明任何命令已通过。
- **内部结构**：六节：项目是什么；目录结构；怎么开发；怎么测试；纪律要点九条；先读什么。
- **依赖 / IO**：被 agent 读取；无运行期 IO；命令派生工具链。
- **状态 / 并发 / 事务**：无状态。
- **失败与错误分类**：命令/路径过时 → agent 执行失败；当前 `bun run daemon` 仍写“骨架横幅即退”，与 80-§3.2 目标不符；`store` 仍写 `node:sqlite + drizzle`，与 79-D4/D5 不符；无自动校验。
- **秘密边界**：无秘密；纪律明确“密钥永不入库”；不写本机路径/IP/真实凭证。
- **证据与测试**：无测试；本次人工核对；不能作为“命令已跑通”的证据。
- **尺寸预算**：≤ 120 行；当前 89 行。
- **迁移 / 兼容 / 回退**：目标改五项——① `store` 去 `drizzle`；② `daemon` 命令改 `node apps/daemon/src/cli/main.ts serve`，删“骨架横幅即退”；③ 类型门禁口径改为“根 program（未切包）+ 每个已切包的包级 `typecheck`（当前无已切包；4 个含 `test/` 的包由各自脚本承接）”，并说明当前根脚本不串接包级、`test/` 目录门禁归 79-D10/82；④ 新增 `guard:manifests` 的接入说明（清理完成前不串 `test`）；⑤ 目录树补全 17 个 workspace 与 `apps/daemon/src` 四域分层。**改 `AGENTS.md` 需制作人确认（79-D5）**；回退=还原文本。

#### F-ROOT-changelog — `CHANGELOG.md`

- **路径 / 处置**：`CHANGELOG.md`；现有；目标保留。
- **归属**：历史记录；不属 75–80 的规范面。
- **职责**：按版本记录已达成/待 tag/未启动的切片，供人追溯。
- **非职责**：不是当前能力证明；不是验收证据；不替代 `docs/` 与测试；不改写历史。
- **内部结构**：270 行；结构刀 + v0.1–v0.10 + 未编号切片 + 未启动；每节列达成内容、关键验收证据、待批残留。
- **依赖 / IO**：人读；无运行期 IO。
- **状态 / 并发 / 事务**：无状态；append-only 语义。
- **失败与错误分类**：无机器校验；历史条目可能滞后于当前代码，不能当现状。
- **秘密边界**：历史里含 commit 哈希，不含凭证；不得追加秘密。
- **证据与测试**：无测试；本次只核对标题与行数，不把其中“已达成”当证据。
- **尺寸预算**：无硬上限；当前 270 行；新增条目按版本追加。
- **迁移 / 兼容 / 回退**：目标不改；未来变更落地时追加，不重写旧条目。

#### F-ROOT-license — `LICENSE`

- **路径 / 处置**：`LICENSE`；现有；目标保留。
- **归属**：许可面；与 `package.json` 的 `license: MIT` 一致。
- **职责**：MIT 许可正文；明确版权人与许可条件。
- **非职责**：不定义依赖许可；不替代各包/第三方 LICENSE；不构成发布许可决定（75-D1/D3/D6 的公开范围仍待制作人）。
- **内部结构**：21 行；MIT 标准文本；版权行 `Copyright (c) 2026 Ye QingXin`。
- **依赖 / IO**：人读/法律面；无运行期 IO。
- **状态 / 并发 / 事务**：无状态。
- **失败与错误分类**：无机器校验；与 manifest 不一致属文档漂移。
- **秘密边界**：无秘密。
- **证据与测试**：无测试；与 `package.json` 的 `license` 字段人工核对一致。
- **尺寸预算**：≤ 30 行；当前 21 行。
- **迁移 / 兼容 / 回退**：目标不改；若未来换许可，属制作人决定，不在本附录。

### 3.3 构建面：现状是「无构建」，目标是双轨（未执行）

**现状（本次核对）**

| 面 | 事实 | 证据 |
|---|---|---|
| 运行方式 | Node 24 直接执行 `.ts`（type-stripping）：daemon 入口 `node apps/daemon/src/index.ts`，组合根入口 `node apps/boot/src/main.ts <daemon.yaml>` | 根 `package.json` 脚本；`apps/boot/src/main.ts` 头注 |
| 类型门禁 | `tsconfig.base.json` `noEmit: true`；根 `tsconfig.json` 只 include `apps/*/src`、`packages/*/src` | 两文件实读 |
| 包级门禁 | 17 个 `apps/*`/`packages/*` 各有 `tsconfig.json`（均 `extends ../../tsconfig.base.json`），各带 `typecheck: tsc --noEmit -p tsconfig.json`；根 `typecheck` 不编排它们 | 逐个读取（分面见 §3.4） |
| 产物 | 仓内无 `dist/`；`dist` 已在 `.gitignore` | `ls`；`.gitignore` |
| 构建配置 | **0 份** `tsconfig.build.json`；0 个 bundler 配置；根无 `build` 脚本 | 全仓 `find` |
| 分发等价物 | `bun build --compile` 只出现在注释里（`tsconfig.base.json` 头注、`packages/company/src/init.ts:27` 的 TODO），不是当前构建 | 两文件注释 |

**目标（79-§5，未执行）**

- 双轨：源码轨（仓内开发、测试、daemon 直跑 `.ts`）+ 分发轨（`tsc` 发射 `dist/*.js` 与 `*.d.ts`，供 npm/DSH 消费者）。分发轨不可省：Node 24 拒绝 strip `node_modules` 下的 `.ts`（79-§1.2）。
- 落位规则（79-§5.2 写明“实际落位与命名归 81”，本文只给规则，不列包清单）：
  - 每个**需要分发**的包在包根新增 `tsconfig.build.json`，`extends ../../tsconfig.base.json`；
  - 覆盖键固定六项：`noEmit: false`、`declaration: true`、`outDir: "dist"`、`rootDir: "src"`、`rewriteRelativeImportExtensions: true`、`sourceMap: false`；
  - `include: ["src/**/*.ts"]`；`exclude` 测试文件（测试不进产物）；
  - `apps/*` 只在进入独立 CLI 分发时才加构建文件（79-§7.7 另审），不默认加。
- 根层不变：`tsconfig.base.json` 保持 `noEmit: true`（门禁基类），根 `tsconfig.json` 不参与发射；**不在根新增** `tsconfig.build.json`。
- 根脚本：是否加 `build`、命令形态（逐包 `tsc -p` 串联或别的）79 未定 → 本文不私设，登记为需回写（§九 W79-5、W82-7）。
- 产物与 `exports`（包级面）：`dist` 与 `src` 同构；`exports` 指 `./dist/*.js`、`types` 指 `./dist/*.d.ts`；`package.json` 的 `files` 白名单只含 `dist` 与必要数据/文档/许可（79-§5.6、§7.1）。本文只登记根卷不涉及。
- 禁止项（79-§5.7）：不引 bundler 作库构建；不用 `emitDeclarationOnly` 做两步构建；不把测试编进产物；不加 `paths`/`baseUrl`。

**“构建成功”判据（79-§5.6，五条同时成立）**：退出码 0；`dist` 文件清单非空且与预期集合一致；`dist/index.js` 可被 Node 24 `import`；`dist/index.d.ts` 可被消费者 `tsc` 解析；`tsc --listFiles` 不含本包之外的 workspace 源码。只看退出码就是 79-§5.4 的陷阱一/二（`noEmit` 被继承、`noEmit` 与 `emitDeclarationOnly` 同真 → 零产出但 exit 0）。

**证据与未证**

- 当前没有可构建产物；本次未跑任何 `tsc -p`，未验证 `dist` 形态与 `--listFiles` 拓扑。
- `.gitignore` 已有 `dist`；缺 `*.tsbuildinfo`——只有开启 `incremental` 才需要，当前未开，属预防项而非现状缺口。
- 构建波次、产物指纹与五条判据的证据归 82（§九 W82-7）。

### 3.4 根配置全景：有的、没有的、缺口

| 面 | 落点 | 现状 | 目标 |
|---|---|---|---|
| 安装与锁 | `package.json` + `bun.lock` | 有；lock v2 / 18 workspace 条目 / 157 packages | 依赖清理后重生成（§2.3） |
| 工具链版本 | `.mise.toml` | Node 24.21.0 / Bun 1.4.3 | 保留 |
| 版本声明 | `package.json` `engines`/`packageManager` | `>=24` / `bun@1`（过宽） | `>=24.21 <25` / `bun@1.4.3`（D2/D3） |
| 类型门禁 | `tsconfig.json` + `tsconfig.base.json` + 17 份包级 `tsconfig.json` | 见下表 | 79-§4、§6.5 |
| 构建 | 无 `tsconfig.build.json`、无 `build` 脚本、无 `dist` | 未建 | 79-§5（§3.3） |
| 忽略规则 | `.gitignore` | 4 行（`node_modules`、`dist`、`*.log`、`.DS_Store`）；缺 `.env`、`.env.*`、`!.env.example`、`*.tsbuildinfo` | 目标替换（§2.3）；`run/daemon.sock`、`var/` 为待裁候选，不私定（W82-10） |
| 格式化 / lint | 无 `.prettierrc`、eslint、biome 配置 | 无 | 75–80 未要求；要加属另一单，本文不加 |
| CI | 无 `.github/`；仓根也无 `.gitlab-ci.yml`、`Jenkinsfile`、`.circleci/` | 无 | 82 波次（guard/typecheck/test 串接） |
| 编辑器 / 环境模板 | 无 `.editorconfig`、`.nvmrc`、`.env.example` | 无 | 版本钉由 mise 承担；`.env.example` 若加随 82 |
| 本地计数目录 | `.VSCodeCounter/`（未被 `.gitignore` 覆盖） | 存在于工作树 | 是否入库由 82 定（见 §三 `.gitignore` 条目） |
| 许可 / 历史 | `LICENSE`、`CHANGELOG.md` | 有 | 保留 |

**类型门禁的真实分面**（不是“test 完全不进门禁”）

| 门禁 | include | 覆盖 `test/`？ | 由谁触发 |
|---|---|---|---|
| 根 `tsconfig.json` | `apps/*/src/**/*.ts`、`packages/*/src/**/*.ts` | 否 | `bun run typecheck`（根脚本只跑这一条） |
| 包级 ×4：`adapters`、`core`、`dsh-bridge`、`prompt` 的 `tsconfig.json` | `src/**/*.ts` + `test/**/*.ts` | 是 | 各包自己的 `typecheck` 脚本；根脚本不编排 |
| 包级 ×13：`apps/boot`、`apps/daemon`、`api`、`company`、`contract`、`gateway`、`localplatform`、`matrix`、`panel`、`store`、`studio-tools`、`taiga`、`yt` 的 `tsconfig.json` | `src/**/*.ts` | 否 | 同上 |

含义：79-D10 的“`test/` 未进类型门禁”在**标准命令**层面成立（根 `typecheck` 只跑根 program；根 program 不含 `test/` 目录，但含 `src/**/*.test.ts`，当前 32 件）；缺口是 **`test/` 目录本身**（全仓 `test/` 目录下共 177 件 `.ts`，其中 `apps/daemon/test` 86 件），由 82 立 `typecheck:test` 或等价项承接。根串接口径按 79-§4.4 只对**已切包**（当前切换集为空；首批候选见 79-§6.5），不是“17 包全串”；4 个含 test 的包当前由各自包级脚本承接（根脚本不串接；已切包按 79-§4.4 并入，切换集为空）。口径应写成“`test/` 门禁另立 + 已切包串接”，不是“缺 17 份配置的编排”（§九 W79-1、W82-8）。

---

## 四、`scripts/guards` 逐件

### 4.1 现有 3 件

#### F-GUARD-rules — `scripts/guards/boundary-rules.mjs`

- **路径 / 处置**：`scripts/guards/boundary-rules.mjs`；现有；目标保留。
- **归属**：20-§十五（分层宪法）；79-§10.3（一致性检查的相邻面）；DEV-47 / studio-dev-90。
- **职责**：分层宪法的**规则数据唯一冻结源**：扫描范围、代码扩展名、workspace 前缀、daemon 纵轴层位与允许边、src 根平面、域平面基线、tools 升格阈、包层位与允许边、尺寸阈值、行数基线、包内反向边规则。
- **非职责**：不执行检查、不读文件、不诊断、不做运行时安全；不定义公司语义；不替代 20-§十五正文（正文是人文镜像，冲突时以本文件为准并回改文档）。
- **内部结构**（16 类导出）：
  - `scopeDirs = ["apps","packages"]`；`codeExtensions` 6 种；`workspaceScope = "@studio-next/"`；
  - `daemonLayers` 7 层（root 6 / cli 5 / assembly 4 / control 3 / evolve 3 / engine 3 / engine/tools 2）；
  - `allowedVerticalEdges` 13 条；`daemonSrcRootFiles = ["index.ts"]`；`daemonSrcRootDirs` 5 个；
  - `domainPlaneBaselines`：engine 13 / control 2 / evolve 5 / assembly 1；
  - `toolsPromotionFileCount = 10`；
  - `packageLayers` 16 个包（boot 不在层位表，只作为允许边的源；`dsh-bridge` 层位 1、注明零模块入边）；
  - `allowedPackageEdges` 38 条；
  - `maxFilesPerDirectory = 25`；`maxLinesPerFile = 600`；`lineBaseline` 22 条；
  - `forbiddenImportSpecs` 1 条（BC-T1：`packages/taiga/src/transport/` 禁 `../fieldmap.ts`）；
  - `rules` 汇总对象。
- **依赖 / IO**：零 import、零 IO、纯数据；被 `boundaries.mjs` 与 `boundaries.test.mjs` 共用。
- **状态 / 并发 / 事务**：无状态；规则变更即全局门禁变更；层位/允许边/阈值/基线**上调与新增**属判据类资产修订，走提案流 + 制作人批；基线下降与条目除名可随任意提交办理（20-§九/§十五）。
- **失败与错误分类**：本文件无运行期错误；若数据形状写错，引擎会误判或抛错；测试只覆盖基线一致性与真仓 0 违例，不覆盖每条规则的语义完备性。
- **秘密边界**：只含仓相对路径与规则说明；不含本机绝对路径、凭证、IP。
- **证据与测试**：`boundaries.test.mjs` 的“行数基线与真仓现状一致”逐条断言基线值 ≥ 实测且 >600；本次 `boundaries.mjs` 真仓 0 违例。
- **尺寸预算**：≤ 350 行；当前 219 行。
- **迁移 / 兼容 / 回退**：目标不改；新增 manifest 规则放独立文件，不塞进本文件；规则回退随提交回退，不 force push。

#### F-GUARD-boundaries — `scripts/guards/boundaries.mjs`

- **路径 / 处置**：`scripts/guards/boundaries.mjs`；现有；目标保留。
- **归属**：20-§十五；DEV-47 / studio-dev-90；79-§10.3 的相邻执行面。
- **职责**：分层宪法机械门禁的执行引擎：走查 `apps/*`、`packages/*` 的 `src/` 与 `test/`，跑五个检查器，输出违例与统计，CLI 退出码表达红绿。
- **非职责**：不做类型检查、不做测试、不做运行时/语义/安全证明；不持有仓内知识（规则全部来自 `boundary-rules.mjs`）；不自动修。
- **内部结构**（13 个导出：基础件 6 + 扫描件 1 + 检查器 5 + 总装 1）：
  - 基础件：`countLines`（`wc -l` 口径：空文件 0 行，末行无换行计 1）、`extractImportSpecs`（静态/裸/动态，type-only 计入）、`packageOf`、`inScope`、`daemonLayerOf`、`resolveSpec`（builtin/workspace/intra/cross/escape/external 六类）；
  - 扫描件：`walkRepo`（跳过 `node_modules`/`.git`；`readdir` 失败静默返回）；
  - 检查器：`checkDaemonVertical`（BC-V1）、`checkHorizontal`（BC-H1/H2）、`checkPlanes`（BC-V2/V3/V4）、`checkSizes`（BC-S1/S2）、`checkIntraReverse`（BC-T1）；
  - 总装：`runGuard(root, rules, read)` 返回 `{violations, stats}`；`stats` 含 `scannedFiles`、`scopedCodeFiles`、`byRule`。
  - CLI：`--root <dir>` 指定根；`--list-over-limit` 列 >600 行件（exit 0）；默认违例 exit 1、通过 exit 0。
- **依赖 / IO**：`node:fs`、`node:path`、`node:url`；`read` 可注入（测试用内存实现）；读源码文本；写 stdout/stderr；不写文件。
- **状态 / 并发 / 事务**：无状态；单进程确定性扫描；无锁；无缓存；并发运行只读，不互相影响。
- **失败与错误分类**：`BC-V1` 层间边未冻结/向上/引 test；`BC-V2` src 根散文件/未冻结顶层目录；`BC-V3` 域平面超基线；`BC-V4` engine/tools 超升格阈；`BC-H1` 包间边未冻结；`BC-H2` 相对引用越出包边界/未登记工作区包；`BC-S1` 目录直属 >25；`BC-S2` 新超限件或超冻结基线；`BC-T1` 包内反向静态边。违例是数据结构 `{rule,file,detail}`，不是异常；CLI 汇总后 exit 1。
- **秘密边界**：只读代码文本；违例只输出文件路径与 import 说明符，不输出文件内容；不读 `.env`；不含凭证。
- **证据与测试**：`boundaries.test.mjs` 用临时夹具逐规则红绿 + 真仓 `runGuard` 0 违例；本次真仓实跑 `PASS`，扫描 627 文件、499 范围代码件、0 违例、exit 0。
- **尺寸预算**：≤ 450 行；当前 322 行。
- **迁移 / 兼容 / 回退**：目标不改；manifest guard 单独文件，不并入本引擎；若未来退役 `apps/daemon/src/index.ts`，需同步改 `daemonSrcRootFiles` 基线（80-§3.2），属提案流。

#### F-GUARD-boundaries-test — `scripts/guards/boundaries.test.mjs`

- **路径 / 处置**：`scripts/guards/boundaries.test.mjs`；现有；目标保留。
- **归属**：20-§十五；79-§10.3 的测试面。
- **职责**：guard 的规格测试：基础件口径、五类检查器逐规则红绿、真仓终态断言、行数基线一致性。
- **非职责**：不证明运行时、安装、语义正确或安全；不替代包级测试；不覆盖 `templates`/`scripts` 的尺寸（规则只扫 `apps`/`packages`）。
- **内部结构**：`vitest` 的 `describe/it`；夹具用临时目录树 + 内存 `read` 注入；真仓断言直接调用 `runGuard` 与 `rules.lineBaseline`；覆盖：`countLines`/`extractImportSpecs`、BC-V1/V2/V3/V4、BC-H1/H2、BC-S1/S2、BC-T1、真仓 0 违例、基线一致性。
- **依赖 / IO**：`vitest`、`node:fs`、`node:os`、`node:path`；创建/删除临时夹具；真仓只读。
- **状态 / 并发 / 事务**：每个 `it` 独立夹具；临时目录隔离；无共享可变状态；测试并行时靠独立目录。
- **失败与错误分类**：断言失败即红；夹具故意违法时断言“红”，防止 guard 假绿；真仓断言红说明规则与仓结构失配。
- **秘密边界**：夹具只含假 import/假文件；不读真实 `.env`；真仓扫描只读代码文本。
- **证据与测试**：本文件自身就是证据；本次未运行 `vitest`，只运行了 `boundaries.mjs` 真仓命令。
- **尺寸预算**：≤ 450 行；当前 293 行。
- **迁移 / 兼容 / 回退**：目标不改；新增 manifest guard 的测试放 `manifests.test.mjs`，不混入本文件。

### 4.2 目标新增 3 件（`BC-M1..M3`）

> 本节三件均为**目标新增，尚未创建**。语义来自 79-§10.3；文件落位与 CLI 形态是本附录的文件设计，不新增 76/77 的公共概念。三件的规则号 `BC-M1..M3` 只用于 guard 诊断，不进入事件、记录或状态机。
>
> **guard 的身份边界**（防止与 80 的公共接口混淆）：guard 是机械文本/结构扫描，**不是** `RuleEvaluator`——不跑 `typecheck`/`evaluate` 两步，不产 `RuleOutcome`（`true|false|unknown|refused`），不调 `repo-validate`，不判开工五门，不读 `.env`，不写文件；违例是本地诊断 `{rule,file,detail}`，不是 `ClassifiedError`。规则变更（方向表/阈值/基线）仍走提案流（20-§十五）。

#### F-GUARD-manifest-rules — `scripts/guards/manifest-rules.mjs`（目标新增）

- **路径 / 处置**：`scripts/guards/manifest-rules.mjs`；目标新增；未创建。
- **归属**：79-§10.3 第 1–3 项；79-§10.1 的依赖清单事实；75-D75-10（依赖最小化）。
- **职责**：manifest 一致性检查的**规则数据**：扫描哪些 workspace manifest、检查哪些依赖字段、哪些说明符不算包依赖。
- **非职责**：不执行检查、不读盘、不安装、不做运行时解析；不检查根 manifest 的工具依赖（`typescript`/`vitest`/`@types/node` 不被 `src` import，纳入会假阳）。
- **内部结构**：
  - `manifestScope = ["apps/*/package.json", "packages/*/package.json"]`（根 manifest 排除）；
  - `dependencyFields = ["dependencies"]`（死依赖检查面）；`devDependencyField = "devDependencies"`（分类错误检查面）；
  - `builtinPrefix = "node:"`；`relativePrefixes = ["./", "../"]`；`workspaceScope` 从 `boundary-rules.mjs` 导入，不复制；
  - `rules = { manifestScope, dependencyFields, devDependencyField, builtinPrefix, relativePrefixes, workspaceScope }`。
  - `peerDependencies`/`optionalDependencies` 当前仓内零命中；若将来出现，`unknown` 处理（报“未登记字段，需回写 79/82”），不私定语义。
- **依赖 / IO**：只 import `workspaceScope`；零 IO、零状态。
- **状态 / 并发 / 事务**：无状态。
- **失败与错误分类**：本文件无运行期错误；数据形状错误由引擎暴露。
- **秘密边界**：只含包名与字段名；无凭据、无路径。
- **证据与测试**：`manifests.test.mjs` 的夹具；本次未创建、未运行。
- **尺寸预算**：≤ 200 行。
- **迁移 / 兼容 / 回退**：新增文件；回退=删除文件与对应 script 键。

#### F-GUARD-manifests — `scripts/guards/manifests.mjs`（目标新增）

- **路径 / 处置**：`scripts/guards/manifests.mjs`；目标新增；未创建。
- **归属**：79-§10.3（三项检查）；79-§10.4（清理顺序）；75-D75-10。
- **职责**：机械检查每个 workspace 包的 manifest 与 `src` import 图是否一致：
  - `BC-M1` 死依赖：`dependencies` 条目在 `src` 至少 1 处 import；
  - `BC-M2` 影子依赖：`src` 出现的包名必须在 `dependencies`；
  - `BC-M3` 分类错误：`devDependencies` 条目不得出现在 `src`。
- **非职责**：不做 AST、不自动修、不安装依赖、不做运行时模块解析、不判断依赖版本是否正确、不检查 `test/`（79-§10.3 只说 `src`）、不检查根 manifest、不判断安全。
- **内部结构**：
  - `packageNameOfSpec(spec)`：`node:`/相对/空 → `null`；`@scope/name/sub` → `@scope/name`；`name/sub` → `name`；其余按首段。
  - `readManifests(root, r)`：读 `manifestScope` 的 `package.json`，返回 `Map<pkgDir, manifest>`；JSON 解析失败 → guard 自身错误（exit 2）。
  - `collectSrcImports(files, read, r)`：复用 `boundaries.mjs` 的 `walkRepo`/`inScope`/`packageOf`/`extractImportSpecs`，只收 `src/` 的 import，返回 `Map<pkgDir, Set<packageName>>`。
  - `checkDeadDeps(manifests, imports)`：`BC-M1`；`checkShadowDeps`：`BC-M2`；`checkDevInSrc`：`BC-M3`；每条形如 `{rule,file,detail}`。
  - `runManifestGuard(root, r, read)`：返回 `{violations, stats}`；`stats` 含 `manifests`、`srcFiles`、`dependencies`、`devDependencies`、`byRule`。
  - CLI：`--root <dir>`；`0` 通过、`1` 违例、`2` guard 自身错误（manifest 不可读/非法 JSON）。这是**本仓 CLI 先例**（`apps/daemon/src/cli/company.ts:267/270/286` 的 `company validate` 已用 exit 2 表输入/自身错误），但 79-§10.3 未写退出码，登记 W79-3，本文不替 79 定标准。
- **依赖 / IO**：`node:fs`/`node:path`/`node:url`；`./manifest-rules.mjs`；`./boundaries.mjs` 的导出；读 manifest 与源码文本；写 stdout/stderr；不写文件。
- **状态 / 并发 / 事务**：无状态；确定性；单进程；并发只读。
- **失败与错误分类**：
  - `BC-M1`：manifest 声明了 `dependencies` 但 `src` 零 import；
  - `BC-M2`：`src` import 了包名但 manifest 未声明（含 workspace 包与第三方）；
  - `BC-M3`：`devDependencies` 条目出现在 `src`；
  - guard 自身错误：manifest 缺失/JSON 非法/根不可读 → exit 2，不与违例混淆。
  - 现状已知违例（不写成绿；**读 manifest 与 `src` import 的静态观察，不是 guard 输出**）：`panel` 的 `@studio-next/company` 在 `devDependencies` 但 `src` 有 3 处 import（BC-M3）；`api` 的 `company/store/contract/hono/zod/@modelcontextprotocol/server` 在 `dependencies` 但 `src` 零 import（BC-M1，该文件 43 行骨架无任何 import）；`daemon` 的 `execa`/`zod` 零 `src` import（BC-M1），`simple-git` 仅测试用（`apps/daemon/test/cli/industry-templates.e2e.test.ts:28`）→ `dependencies` 零 `src` import 仍是 BC-M1，BC-M3 不适用（它不在 `devDependencies`）；`adapters` 的 `simple-git` 零使用（BC-M1）；`prompt` 的 `company`/`zod` 零使用（BC-M1）。
- **秘密边界**：只读 manifest 的依赖字段与源码 import 说明符；不读 `.env`；不输出 token；路径只输出仓相对路径。
- **证据与测试**：目标 `manifests.test.mjs`；本次未创建、未运行。**不接入 `bun run test` 前置**，直到 79-§10.4 的清理完成；否则现状已知违例会红，属于把“未清理”伪装成“门禁失败”。
- **尺寸预算**：≤ 350 行。
- **迁移 / 兼容 / 回退**：先加独立命令 `guard:manifests`，清理完成后再串入 `test`；回退=删除文件、移除 script 键、恢复 `test` 链。

#### F-GUARD-manifests-test — `scripts/guards/manifests.test.mjs`（目标新增）

- **路径 / 处置**：`scripts/guards/manifests.test.mjs`；目标新增；未创建。
- **归属**：79-§10.3；75-§4.3（测试只对契约负责）。
- **职责**：三项检查的夹具级红绿：死依赖红/使用绿；影子依赖红/声明绿；devDependency 进 `src` 红、只在 `test/` 用绿；type-only/动态/裸 import 计入；`node:`/相对 import 不计；根 manifest 不扫。
- **非职责**：不证明运行时解析、安装成功、版本正确、安全；不把现状已知违例写成“可接受基线”。
- **内部结构**：`vitest`；临时夹具树（`package.json` + `src/*.ts`）；内存 `read` 注入；每条规则至少一对红/绿；真仓断言分两段：清理前只断言“已知违例集合存在且分类正确”，清理后改为 0 违例（由 82 证据波次触发）。
- **依赖 / IO**：`vitest`、`node:fs`、`node:os`、`node:path`；临时目录；真仓只读。
- **状态 / 并发 / 事务**：每个 `it` 独立夹具；无共享可变状态。
- **失败与错误分类**：夹具红/绿断言失败即测试红；guard 自身错误用 exit 2 夹具单独断言。
- **秘密边界**：夹具只含假包名/假 import；不读真实 `.env`。
- **证据与测试**：本文件自身；本次未创建、未运行。
- **尺寸预算**：≤ 350 行。
- **迁移 / 兼容 / 回退**：与引擎同批新增；清理完成后补真仓 0 违例断言；回退=删除测试文件。

### 4.3 基线与阈值：数据、语义、治理

#### 4.3.1 阈值与基线总表

| 项 | 值 | 约束形态 | 违反规则 |
|---|---:|---|---|
| 目录直属文件上限 | 25 | 非点文件计数（`.` 开头不占名额） | BC-S1 |
| 单文件行数上限 | 600 | `wc -l` 口径（空文件 0 行，末行无换行计 1） | BC-S2 |
| 行数基线（冻结名单） | 22 条 | 每条 > 600；只减不增 | BC-S2 |
| 域平面基线（`daemon/src` 直属代码件） | engine 13 / control 2 / evolve 5 / assembly 1 | 只减不增 | BC-V3 |
| `engine/tools/` 升格阈 | 10 | 超过即触“升格 `packages/base`” | BC-V4 |
| daemon 纵轴层位 | 7 层 | 冻结表 | BC-V1 |
| 包层位 | 16 个包（`apps/boot` 只作边源，不在层位表） | 冻结表 | BC-H1 |
| 纵边 / 包间边 | 13 / 38 | 冻结表 | BC-V1 / BC-H1 |
| 包内反向边 | 1 条（BC-T1） | spec 字面量 | BC-T1 |
| `daemon/src` 根文件白名单 | `["index.ts"]` | 冻结表 | BC-V2 |

#### 4.3.2 22 条行数基线（基线 / 实测 / 余量）

实测按 `wc -l` 口径在本次核对时点重算；余量 = 基线 − 实测。

| 文件 | 基线 | 实测 | 余量 |
|---|---:|---:|---:|
| `apps/daemon/src/engine/engine.ts` | 2337 | 2337 | 0 |
| `packages/store/src/ledger.ts` | 1684 | 1683 | 1 |
| `apps/daemon/src/assembly/serve.ts` | 1627 | 1627 | 0 |
| `packages/company/src/repo-validate.ts` | 1021 | 1021 | 0 |
| `apps/daemon/test/control/hot-reload.test.ts` | 930 | 930 | 0 |
| `apps/daemon/test/engine/scheduler.test.ts` | 785 | 785 | 0 |
| `apps/daemon/test/engine/sources.test.ts` | 768 | 768 | 0 |
| `packages/company/src/dependencies.ts` | 775 | 775 | 0 |
| `packages/company/test/repo-validate.test.ts` | 766 | 766 | 0 |
| `packages/adapters/src/dsh.ts` | 758 | 758 | 0 |
| `packages/taiga/src/testutil.ts` | 723 | 693 | 30 |
| `packages/adapters/test/dsh.test.ts` | 785 | 732 | 53 |
| `packages/panel/src/views.ts` | 662 | 662 | 0 |
| `packages/adapters/test/kimi.test.ts` | 662 | 662 | 0 |
| `apps/daemon/test/evolve/evolution-e2e.test.ts` | 652 | 652 | 0 |
| `packages/company/src/validator.ts` | 655 | 612 | 43 |
| `apps/daemon/test/evolve/gray.test.ts` | 625 | 625 | 0 |
| `apps/daemon/src/control/hot-reload.ts` | 624 | 624 | 0 |
| `packages/panel/src/overview/views.ts` | 629 | 629 | 0 |
| `packages/store/test/v5-candidates.test.ts` | 602 | 602 | 0 |
| `apps/boot/src/boot.test.ts` | 645 | 635 | 10 |
| `packages/store/src/records.ts` | 606 | 606 | 0 |

汇总：22 条中 17 条余量为 0（实测即基线，任何增长即红），5 条有余量（合计 137 行）；最小基线 602、最大 2337。分布：`apps/*` 9 条（`apps/daemon` 8 + `apps/boot` 1）、`packages/*` 13 条；按源码/测试分：`src` 12 条、`test` 10 条。

#### 4.3.3 语义（机械可查的部分）

- **判定顺序**（`checkSizes`）：先算行数；≤ 600 直接跳过；> 600 且不在基线 → BC-S2“必须拆；新超限件入基线 = 改宪法 = 提案流”；> 600 且在基线但超过 cap → BC-S2“超冻结基线，先拆再增功能”。
- **棘轮**：基线只减不增。降基线、删条目可随任意提交；**上调基线或新增条目 = 改宪法 = 提案流 + 制作人批**（20-§九/§十五，`boundary-rules.mjs` 头注同口径）。
- **域平面**（BC-V3）：`apps/daemon/src/<域>/` 的直属代码件数不得超基线；新特性必须开 `<域>/<特性>/` 子目录，不能把文件摊在域平面。
- **升格阈**（BC-V4）：`engine/tools/` 直属件 > 10 → 触发“升格 `packages/base`”，方向表加行属提案流。
- **目录阈值**（BC-S1）：任一直属目录非点文件 > 25 → 切子域，不看子域规模。

#### 4.3.4 证据与复算

- `boundaries.test.mjs` 的“行数基线与真仓现状一致”断言三条：每条基线的文件必须存在于扫描面；实测 ≤ 基线；基线 > 600。它防三类漂移——文件改了名（基线条目悬空）、代码涨了（超 cap）、基线本身被写成 ≤ 600 的假冻结。
- 本次实跑 `node scripts/guards/boundaries.mjs` → PASS，627 文件 / 499 范围代码件 / 0 违例 / exit 0；22 条基线均未被触发。
- 复算命令见附录 A（读 `lineBaseline` 逐条比对实测行数）。

#### 4.3.5 盲区（比基线数值更重要）

| 盲区 | 事实 | 影响 |
|---|---|---|
| 扫描面不含 `scripts/` | `scopeDirs = ["apps","packages"]` | 目标新增的 3 个 guard 文件不受尺寸门禁；本文的 200/350/350 行预算是文档约束，不是机械闸 |
| 扫描面不含 `templates/` | 同上 | 模板 225 件不受 600 行/25 件约束；最大 509 行、目录最大 6 件靠本文登记（§5.6） |
| 基线只管代码扩展名 | `isCodeFile` 按 `codeExtensions`（6 种） | `.mjs` 不在行数基线面——“guard 自己不受 guard 管”是现状，不是设计 |
| 新文件不自动入基线 | 基线是名单，不是推导 | 新文件 > 600 必红；入名单必须走提案 |
| 目录计数忽略点文件 | 文件名以 `.` 开头的条目不计数 | `.gitkeep` 不占名额（模板侧同理） |
| 基线不含行数下限 | 只设上限 | 文件拆小后基线不回填，余量永久保留（制度如此，不是缺陷） |
| guard 不是求值器 | 只做机械文本/结构扫描 | 不产 `RuleOutcome`、不调 `repo-validate`、不判开工五门、不读 `.env`、不写文件；规则判定归 core/daemon |
| 不查 manifest | `boundaries.mjs` 只查层位/边/尺寸/平面 | import 图与 manifest 一致性是目标 `BC-M1..M3` 的缺口（§4.2），当前无闸 |

#### 4.3.6 与本文目标的关系

- 目标新增 3 件在 `scripts/`，**不改任何基线**，不需要提案流。
- 目标替换 14 件（根 6 + 模板 8）**不改** `lineBaseline`、域平面与阈值。
- 唯一会碰基线的目标是 `apps/daemon/src/index.ts` 退役 → `daemonSrcRootFiles` 需变更，**属提案流**（80-§3.2；§九 W80-2）。
- 若依赖清理需要拆超限件，只能先拆后加功能，保持棘轮；拆完可顺手降基线（随提交即可）。

---

## 五、公司模板

### 5.1 模板是什么、不是什么

模板是**公司目录的骨架**，不是运行中的公司。它把「一家公司」的组织、人事、章程、提示词片段、定时岗与依赖声明落成可校验的文件树；`init` 复制它、替换公司身份、跑自检、盖戳、首提，之后由 daemon 作为公司目录的唯一常规写入者接管。模板本身没有进程、没有状态、没有网络、没有秘密。

三条模板事实必须分开：

1. `templates/company-2-level` 是**共享资产的单一事实源**：`README.md`、`charter.md`、`prompts/company.md` 由 3–9 级生成器直读，3–9 的对应文件与它**逐字节一致**（`byteDigest` 全量比对；`sha8` 只作展示，不作身份）。
2. `templates/company-3-level` … `company-9-level` 是**生成物**：`gen-template.ts` 以 `level-specs.ts` 为结构源、以 2 级模板为共享资产源渲染；`gen-template.test.ts` 对账“仓树逐字节 == 生成器输出”，手改即红。
3. `templates/company-game` / `company-internet` 是**行业示例包**：走 `company add <git-url>` 导入通道，不复用 2 级的共享资产；它们与 2 级共用同一张 org-config schema，行业差异全部落在资产（charter / prompts 战役 / jobs / dependencies / docs / plugins）。

两条“不承载”同样必须写明：

4. **不承载可求值规则**：`find templates -iname '*rule*'` **零命中**；而 76-§2.5 把 `rule-profile` 列为公司定义对象。模板 225 件里没有 `rule-profile` 的承载落点 → 登记 **W76-4**（落点由 76/82 定，本文不私定路径）。
5. **不承载秘密**：模板内没有任何 `SEC-*` 标识或秘密值；行业包部署所需的秘密在 78-BIND-WS-01/SEC 的部署 catalog 里，模板只写逻辑锚点（`login`、`yt.project`、`accounts[]`）。出站内容仍须过秘密扫描（75-D75-13）。

### 5.2 共同契约（适用于 §5.4 全部 225 行）

| 面 | 契约 |
|---|---|
| 归属 | 76-DEF-PKG-01a（包描述/manifest 逻辑面）、01c（组织与任职）、01f（能力需求）、DEF-CFG-01（公司配置类别）、DEF-ORG-01/02、DEF-POS-01/02、DEF-DEP-01/02；78-BIND-WS-01（公司目录是数据包）；51（公司仓库规范）；43（行业包语义） |
| 职责 | 提供可校验、可复制、可分叉的公司定义资产；让 `loadCompanyDirectory`、`multifileRules`、`initCompany`、`renderLevelTemplate`、`importCompanyRepo` 有稳定的输入 |
| 非职责 | 不执行、不安装、不联网、不持有秘密、不承载运行时状态；不证明公司可运行；不替代 76 的公共语义；不定义平台字段（`yt` 段只是映射覆盖，不是权威） |
| 结构 | YAML 用 `yaml` 解析；人事档案用 front-matter + 六节正文；插件用 ESM；所有文件 UTF-8、LF；ID/路径为仓相对 |
| 依赖 / IO | 模板文件本身零 import、零 IO；读取方是 `packages/company` 的解析/校验/生成/导入函数；写入方是 `init`（复制/占位）与 daemon（挂载后） |
| 状态 / 并发 / 事务 | 模板是只读源；`init` 复制到目标目录后，目标目录才是可变状态；同一模板可被多个 `init` 并发读取，互不影响；模板不参与运行时锁 |
| 失败 / 错误分类 | YAML 语法错误、schema 不匹配、重复 ID、悬空引用、孤儿文件、等级分布不符、六节缺失、路径逃逸、插件形态不合规。这些是**诊断**（`DirectoryIssue`/`RepoViolation`），不是 `Err`；经 `ClassifiedError` 暴露给端口时固定 `failure:'rejected_precondition'`、`category:'CONFIG_INVALID'`、稳定 `subcause`（如 `tpl-yaml-syntax`/`tpl-missing-file`），`detail` 带文件:行；不静默降级 |
| 秘密边界 | 模板内不得出现令牌、密码、私钥、连接串、真实账号、本机绝对路径、内网地址，也不得出现 `SEC-*` 秘密标识；`login`/`yt.project`/`accounts` 是锚点与短名，不是秘密；出站内容仍须过秘密扫描（75-D75-13） |
| 证据 / 测试 | §6 的测试矩阵；测试只证明“模板能被校验器读通/生成器对账/导入形态正确”，不证明真实 DSH/LLM/平台可用 |
| 尺寸预算 | 单文件 ≤ 600 行；目录直属 ≤ 25 个非点文件；当前模板最大文件 509 行、最大目录直属 6 个（`company-4-level/departments/研发部/people/`）；模板不在 `boundaries.mjs` 扫描面内，预算由本文约束 |
| 迁移 / 兼容 / 回退 | schema 迁移期收 `studio-next/org@1` 与 `org-config/v1` 并集；canonical 迁移完成后收单表；回退=git revert 模板文件；生成物回退=回退 `level-specs` 后重生成，不手改 3–9 |

### 5.3 目标处置矩阵

| 模板 | 来源 | 目标处置 | 目标 schema | 生成/导入关系 |
|---|---|---|---|---|
| `company-2-level` | 手写源 | 保留 + 2 个文件替换 schema | `studio-next/org@1` | `init` 默认模板；共享资产源 |
| `company-3-level` | 生成 | 保留 | `studio-next/org@1` | 共享资产继承 2 级；结构按 `level-specs` 生成 |
| `company-4-level` | 生成 | 保留 | `studio-next/org@1` | 同上 |
| `company-5-level` | 生成 | 保留 | `studio-next/org@1` | 同上 |
| `company-6-level` | 生成 | 保留 | `studio-next/org@1` | 同上 |
| `company-7-level` | 生成 | 保留 | `studio-next/org@1` | 同上 |
| `company-8-level` | 生成 | 保留 | `studio-next/org@1` | 同上 |
| `company-9-level` | 生成 | 保留 | `studio-next/org@1` | 同上 |
| `company-game` | 手写行业包 | 保留 + 3 个文件替换 schema；3 个插件文件待分离 | `studio-next/org@1` | `company add` 导入通道 |
| `company-internet` | 手写行业包 | 保留 + 3 个文件替换 schema；3 个插件文件待分离 | `studio-next/org@1` | `company add` 导入通道 |

替换文件明细见 §2.3；待分离插件明细见 §2.4。

### 5.4 资产族逐件

#### 5.4.1 `org-config.yaml`（10 件）

**族契约**

- **处置**：2-level / game / internet 目标替换 schema（3 件）；3–9 目标保留（生成物，不手改）。
- **归属**：76-DEF-PKG-01a/01c、DEF-CFG-01、DEF-ORG-01/02、DEF-POS-01/02；04-§二；51 B 组；43-§三。
- **职责**：公司与编制的唯一事实源；`company` 身份、`departments` 索引、`people` 索引、`jobs` 定时岗；可选 `workflows`/`hooks`/`accounts`/`yt`/`executors` 是部署面声明，不是公司定义本体。
- **非职责**：不内联部门正文（在 `departments/**/config.yaml`）；不内联人事正文（在 `people/*.md`）；不持有秘密；不执行；不替代平台字段映射（`yt` 只是覆盖）。`jobs[].budget_cap` 在本文件是 YAML 数字；公共金额的 `DecimalString` 口径归 80-§4.1（W80-3），模板不改值。
- **内部结构**：`schema`；`company{name,slug,mission,charter_ref,level,level_distribution}`；`departments[]{name,path,leader,level,parent,lanes,functions,relations}`；`people[]{id,name,login,level,dept,role,reports_to,skills,status,executor,file}`；`jobs[]{id,dept,cron|triggers,role,level,type,model_tier,budget_cap,output?,outputs?,sla?,escalate?,grace?}`；可选 `workflows.types[]`、`hooks.data_change.routes`、`accounts[]`、`yt{project,starting_number,fields,flows,typeInbox?}`、`executors{}`。
- **依赖 / IO**：只读 YAML；被 `validator.ts`（zod strictObject + 行号）、`multifile.ts`（跨文件）、`jobs-loading`（cron/cadence）、`hooks`/`workflows`/`security-baseline` 读取；无运行期 IO。
- **状态 / 并发 / 事务**：模板快照不可变；`level_distribution` 必须等于 `people[].level` 实数；ID 在包内唯一；`jobs` 的 cron 与 `triggers.cadence` 恰给其一；部门 `level` 是公司等级，不是嵌套深度。cron 注释写“本地时区（按制作人机器本地时区解析）”，而 80-§4.1 要求公司本地日/时区由**公司目录显式声明**，不得读宿主时区；模板里没有 `timezone` 字段 → W76-5（键名与 schema 由 76 定，本文不私定）。
- **失败 / 错误分类**：缺必填、未知键（strictObject）、重复 id、悬空 leader/file/dept、等级分布不符、job 双写/全缺 cron、坏 model_tier/level、`output` 路径逃逸；由 `DirectoryIssue` 带文件:行。
- **秘密边界**：`accounts[].login` 是账号锚点，不是密码；`yt.project` 是短名，不是凭据；不得出现 token/私钥/绝对路径。
- **证据 / 测试**：`multifile.test.ts`（2 级全树、双检、meta）、`gen-template.test.ts`（3–9 逐字节、等级回读 3..9）、`industry-templates.test.ts`（行业全树、jobs 档位）、`jobs-loading.test.ts`（2 级 jobs 全字段）、`security-baseline.test.ts`（output 路径域、slug 单表）、`hooks.test.ts`、`workflows.test.ts`。本次另用 `yaml` 解析核对：`level_distribution` 与 `people[].level` 10/10 套一致；部门 config 的 jobs 集合与 org-config jobs 集合 **56/56 一致**（该一致性**无闸**，见 §7.4）。
- **尺寸预算**：≤ 600 行；当前 149–509 行；3–9 由生成器产出，不手改。
- **迁移 / 兼容 / 回退**：2-level/game/internet 的 `schema` 与头注旧字面量迁到 `studio-next/org@1`；迁移期 `multifile.ts` 收并集；3–9 重生成零 diff；回退=git revert + 重生成。

**逐件**

##### org-config.yaml 逐件

| F-ID | 路径 | schema | 公司 / 级 / 分布 | 部门 / 人员 / 岗 | 可选段 | 行数 |
|---|---|---|---|---|---|---|
| F-TPL-c2-org | org-config.yaml | org-config/v1 | 示例公司 / L2 / {"2":1} | 1 / 1 / 2 | workflows、hooks、accounts、yt、executors | 181 |
| F-TPL-c3-org | org-config.yaml | studio-next/org@1 | 示例公司 / L3 / {"1":1,"2":4,"3":2} | 2 / 7 / 4 | accounts | 169 |
| F-TPL-c4-org | org-config.yaml | studio-next/org@1 | 示例公司 / L4 / {"2":5,"3":3,"4":2} | 2 / 10 / 4 | accounts | 202 |
| F-TPL-c5-org | org-config.yaml | studio-next/org@1 | 示例公司 / L5 / {"2":2,"3":5,"4":5,"5":1} | 6 / 13 / 12 | accounts | 348 |
| F-TPL-c6-org | org-config.yaml | studio-next/org@1 | 示例公司 / L6 / {"3":5,"4":2,"5":7,"6":1} | 10 / 15 / 16 | accounts | 442 |
| F-TPL-c7-org | org-config.yaml | studio-next/org@1 | 示例公司 / L7 / {"4":2,"5":3,"6":7,"7":1} | 11 / 13 / 16 | accounts | 428 |
| F-TPL-c8-org | org-config.yaml | studio-next/org@1 | 示例公司 / L8 / {"5":4,"6":3,"7":8,"8":1} | 12 / 16 / 20 | accounts | 509 |
| F-TPL-c9-org | org-config.yaml | studio-next/org@1 | 示例公司 / L9 / {"6":2,"7":3,"8":4,"9":1} | 8 / 10 / 16 | accounts | 371 |
| F-TPL-cg-org | org-config.yaml | org-config/v1 | 星火游戏工作室 / L3 / {"2":2,"3":1} | 2 / 3 / 2 | hooks、accounts、yt、executors | 149 |
| F-TPL-ci-org | org-config.yaml | org-config/v1 | 星潮互联网公司 / L3 / {"2":2,"3":1} | 2 / 3 / 2 | workflows、hooks、accounts、yt、executors | 198 |

#### 5.4.2 `.studio-next.yaml`（10 件）

**族契约**

- **处置**：2-level / game / internet 目标替换 schema（3 件）；3–9 目标保留。
- **归属**：76-DEF-PKG-01a（包描述/挂载元信息）；78-BIND-WS-01；51 A-2；04-§二/§九。
- **职责**：公司目录的挂载元信息：schema 版本、生成模板名、挂载/校验时间、最近校验结果、框架版本；供 `multifile.ts` 做 schema 同源检查，供 `init`/导入流盖戳。
- **非职责**：不是公司定义；不是权威；不承载业务字段；不证明校验通过；`framework_version=null` 不表示“已迁移”。
- **内部结构**：`schema`、`template`、`created_at`、`last_validated_at`、`last_validation`、`framework_version`；时间戳为 ISO 8601 或 `null`；`last_validation` 为 `pass|fail|null`。
- **依赖 / IO**：只读 YAML；被 `multifile.ts` 读取；被 `init.ts` 行级替换 `template` 与三个时间戳；被 daemon 在挂载后写入；无运行期 IO。
- **状态 / 并发 / 事务**：模板中全为 `null`；`init` 先自检后盖戳（pass 不先盖）；daemon 挂单 commit 写入；同一公司目录的写入由 daemon 单点串行。
- **失败 / 错误分类**：缺文件 → `meta/missing-file`；schema 与 org 不一致 → `meta/schema-mismatch`；坏 ISO → `meta/missing-field`；坏 `last_validation` → 同；`template` 行 0 或 ≥2 → `init/template-placeholder-drift`。
- **秘密边界**：无秘密；`template` 是模板名，不是路径；时间戳不是敏感信息。
- **证据 / 测试**：`multifile.test.ts`（meta 五态）、`init.test.ts`（5 级 template 行、漂移、盖戳）、`gen-template.test.ts`（七处占位恰一次）。
- **尺寸预算**：≤ 20 行；当前 11–12 行。
- **迁移 / 兼容 / 回退**：schema 随 org 迁移；`framework_version` 待 migrate 落地后回填；回退=git revert。

**逐件**

##### .studio-next.yaml 逐件

| F-ID | 路径 | schema | template | 时间戳 / 校验 / 框架版本 | 行数 |
|---|---|---|---|---|---|
| F-TPL-c2-meta | .studio-next.yaml | org-config/v1 | company-2-level | created_at=null；last_validation=null；framework_version=null | 11 |
| F-TPL-c3-meta | .studio-next.yaml | studio-next/org@1 | company-3-level | created_at=null；last_validation=null；framework_version=null | 11 |
| F-TPL-c4-meta | .studio-next.yaml | studio-next/org@1 | company-4-level | created_at=null；last_validation=null；framework_version=null | 11 |
| F-TPL-c5-meta | .studio-next.yaml | studio-next/org@1 | company-5-level | created_at=null；last_validation=null；framework_version=null | 11 |
| F-TPL-c6-meta | .studio-next.yaml | studio-next/org@1 | company-6-level | created_at=null；last_validation=null；framework_version=null | 11 |
| F-TPL-c7-meta | .studio-next.yaml | studio-next/org@1 | company-7-level | created_at=null；last_validation=null；framework_version=null | 11 |
| F-TPL-c8-meta | .studio-next.yaml | studio-next/org@1 | company-8-level | created_at=null；last_validation=null；framework_version=null | 11 |
| F-TPL-c9-meta | .studio-next.yaml | studio-next/org@1 | company-9-level | created_at=null；last_validation=null；framework_version=null | 11 |
| F-TPL-cg-meta | .studio-next.yaml | org-config/v1 | company-game | created_at=null；last_validation=null；framework_version=null | 12 |
| F-TPL-ci-meta | .studio-next.yaml | org-config/v1 | company-internet | created_at=null；last_validation=null；framework_version=null | 12 |

#### 5.4.3 `README.md`（10 件）

**族契约**

- **处置**：game/internet 目标替换旧 schema 字面量（2 件）；2–9 目标保留。
- **归属**：76-DEF-PKG-01g（人读资产与惰性模板）；80 的 L1 提示词内容源；43-§三。
- **职责**：公司自述：使命、当前方向、战役、组织入口、目录说明、单据类型流说明；面向人，也给身份包取摘要。
- **非职责**：不是章程（规则在 `charter.md`）；不是 schema；不是验收依据；不承诺未接线面可用。
- **内部结构**：标题 `# <公司名>（公司自述）`；使命/方向/战役表/组织/目录/（2 级另有）单据类型流；行业包另有“三步开公司/资产地图/改造路线/依赖示例/纪律”。
- **依赖 / IO**：人读；`init` 只替换标题一次；无运行期 IO。
- **状态 / 并发 / 事务**：无状态；`init` 的占位替换要求标题恰好一次，否则 `CONFIG_INVALID`。
- **失败 / 错误分类**：标题缺失/重复 → `init` 自检失败；内容过时 → 人读误导，无机器校验。
- **秘密边界**：无秘密；示例用占位符；不得写真实凭证、本机路径、内网地址。
- **证据 / 测试**：`init.test.ts`（标题占位）、`gen-template.test.ts`（3–9 与 2 级同文）、`industry-templates.test.ts`（行业 README 在位）。
- **尺寸预算**：≤ 100 行；当前 52–70 行。
- **迁移 / 兼容 / 回退**：只改 game/internet 的 schema 字面量；3–9 由 2 级同文派生；回退=git revert + 重生成。

**逐件**

##### README.md 逐件

| F-ID | 路径 | 内容要点 | 与 2 级同文 | 行数 |
|---|---|---|---|---|
| F-TPL-c2-readme | README.md | 公司自述：使命/方向/战役/组织/目录/单据流 | 源文件 | 52 |
| F-TPL-c3-readme | README.md | 同文继承 2 级（生成） | 是（逐字节一致） | 52 |
| F-TPL-c4-readme | README.md | 同文继承 2 级（生成） | 是（逐字节一致） | 52 |
| F-TPL-c5-readme | README.md | 同文继承 2 级（生成） | 是（逐字节一致） | 52 |
| F-TPL-c6-readme | README.md | 同文继承 2 级（生成） | 是（逐字节一致） | 52 |
| F-TPL-c7-readme | README.md | 同文继承 2 级（生成） | 是（逐字节一致） | 52 |
| F-TPL-c8-readme | README.md | 同文继承 2 级（生成） | 是（逐字节一致） | 52 |
| F-TPL-c9-readme | README.md | 同文继承 2 级（生成） | 是（逐字节一致） | 52 |
| F-TPL-cg-readme | README.md | 行业包上手说明：三步开工作室/资产地图/改造路线 | 源文件 | 69 |
| F-TPL-ci-readme | README.md | 行业包上手说明：三步开公司/资产地图/改造路线 | 源文件 | 70 |

#### 5.4.4 `charter.md`（10 件）

**族契约**

- **处置**：全部目标保留；game/internet 的行业条款保留。
- **归属**：76-DEF-PKG-01b（设立与宪制）、DEF-MISSION-01、DEF-BOUNDARY-01；51 C 组。
- **职责**：公司章程的基础规定：公司是什么、基本法、红线、权力与批示、修改程序；行业包在相同骨架上加行业红线。
- **非职责**：不是 schema；不是可求值规则（Rule Profile 在别处）；不执行；不证明治理已落地。
- **内部结构**：标题 + 五条：公司是什么、基本法（状态外置/证据断言/唯一写入/护栏外置/可重建）、红线、权力与批示、修改程序；行业包在红线/基本法内加行业条款。
- **依赖 / IO**：人读；被 `multifile.ts` 的 `charter_ref` 存在性检查；无运行期 IO。
- **状态 / 并发 / 事务**：无状态；修改程序声明“提案→批示→daemon 落盘并挂单 commit→台账”，但模板本身不执行该流程。
- **失败 / 错误分类**：`charter_ref` 悬空 → `charter/dangling`；内容冲突无机器校验（以 charter 为准的人读约定）。
- **秘密边界**：无秘密；不得写真实凭证/本机路径。
- **证据 / 测试**：`multifile.test.ts`（charter_ref 存在性）、`industry-templates.test.ts`（行业条款在位）。
- **尺寸预算**：≤ 60 行；当前 35–45 行。
- **迁移 / 兼容 / 回退**：目标不改；3–9 同文派生；回退=git revert。

**逐件**

##### charter.md 逐件

| F-ID | 路径 | 内容要点 | 与 2 级同文 | 行数 |
|---|---|---|---|---|
| F-TPL-c2-charter | charter.md | 五条章程：公司/基本法/红线/权力/修改程序 | 源文件 | 35 |
| F-TPL-c3-charter | charter.md | 同文继承 2 级（生成） | 是（逐字节一致） | 35 |
| F-TPL-c4-charter | charter.md | 同文继承 2 级（生成） | 是（逐字节一致） | 35 |
| F-TPL-c5-charter | charter.md | 同文继承 2 级（生成） | 是（逐字节一致） | 35 |
| F-TPL-c6-charter | charter.md | 同文继承 2 级（生成） | 是（逐字节一致） | 35 |
| F-TPL-c7-charter | charter.md | 同文继承 2 级（生成） | 是（逐字节一致） | 35 |
| F-TPL-c8-charter | charter.md | 同文继承 2 级（生成） | 是（逐字节一致） | 35 |
| F-TPL-c9-charter | charter.md | 同文继承 2 级（生成） | 是（逐字节一致） | 35 |
| F-TPL-cg-charter | charter.md | 行业章程：品质红线/热更纪律/档期契约 | 源文件 | 45 |
| F-TPL-ci-charter | charter.md | 行业章程：迭代纪律/灰度红线 | 源文件 | 44 |

#### 5.4.5 `prompts/company.md`（10 件）

**族契约**

- **处置**：全部目标保留；game/internet 的战役保留。
- **归属**：76-DEF-PKG-01g（人读资产/惰性模板）；80 的 L1 提示词内容源；01 C2-06/C2-09；17-§5。
- **职责**：公司层（L1）提示词片段：使命、当前方向、战役、署名规则；供组装器拼进 AGENTS.md 的 L1 段。
- **非职责**：不写具体任务（L4 在任务书）；不重复 L0 红线与证据契约；不执行；不保证模型行为。
- **内部结构**：标题 + 纪律注 + `## 使命` + `## 当前方向` + `## 战役` + `## 公司身份提示（署名规则）`；行业包替换使命/方向/战役内容。
- **依赖 / IO**：人读/组装器读取；无运行期 IO；改动走批示流（可进化资产）。
- **状态 / 并发 / 事务**：无状态；超长时组装器按“战役降一句”裁剪（05-prompt 的目标语义）。
- **失败 / 错误分类**：无机器校验；内容越界（写任务/写红线）属审查问题，不是解析错误。
- **秘密边界**：无秘密；不得写凭证/本机路径；署名由网关注入，worker 不自带前缀。
- **证据 / 测试**：`gen-template.test.ts`（3–9 与 2 级同文）、`industry-templates.test.ts`（行业 prompts 在位）；不证明组装正确（归 05-prompt）。
- **尺寸预算**：≤ 40 行；当前 28–32 行。
- **迁移 / 兼容 / 回退**：目标不改；3–9 同文派生；回退=git revert。

**逐件**

##### prompts/company.md 逐件

| F-ID | 路径 | 内容要点 | 与 2 级同文 | 行数 |
|---|---|---|---|---|
| F-TPL-c2-prompts | prompts/company.md | L1 片段：使命/方向/战役/署名规则 | 源文件 | 28 |
| F-TPL-c3-prompts | prompts/company.md | 同文继承 2 级（生成） | 是（逐字节一致） | 28 |
| F-TPL-c4-prompts | prompts/company.md | 同文继承 2 级（生成） | 是（逐字节一致） | 28 |
| F-TPL-c5-prompts | prompts/company.md | 同文继承 2 级（生成） | 是（逐字节一致） | 28 |
| F-TPL-c6-prompts | prompts/company.md | 同文继承 2 级（生成） | 是（逐字节一致） | 28 |
| F-TPL-c7-prompts | prompts/company.md | 同文继承 2 级（生成） | 是（逐字节一致） | 28 |
| F-TPL-c8-prompts | prompts/company.md | 同文继承 2 级（生成） | 是（逐字节一致） | 28 |
| F-TPL-c9-prompts | prompts/company.md | 同文继承 2 级（生成） | 是（逐字节一致） | 28 |
| F-TPL-cg-prompts | prompts/company.md | L1 片段：赛季/留存/崩溃率战役 | 源文件 | 32 |
| F-TPL-ci-prompts | prompts/company.md | L1 片段：北极星指标/首页改版/性能预算战役 | 源文件 | 32 |

#### 5.4.6 `departments/**/config.yaml`（56 件）

**族契约**

- **处置**：56 件全部目标保留，路径不变，内容不变（本族不含 schema 字面量，不在 §5.5 的 8 件迁移面内）。
- **归属**：04-§二（部门领导配置 = 本文件；leader 指向工号）；76-DEF-PKG-01 的目录资产；80 的泳道/调度读取面；校验实现 `packages/company/src/multifile.ts`。
- **职责**：一个部门的静态配置：名字、目录 path、公司等级 level、上级部门 parent、主管工号 leader、职能 functions、泳道 lanes、汇报线 reports_to、部门规定 rules、跨部门关系 relations、名下定时岗 jobs。
- **非职责**：不存人名档案（人事档案是 `.md`，另一族）；不定义岗位内容（`jobs` 只是 id 列表，定时岗的 cron/节奏在 `org-config.yaml` 的 jobs 段）；不承载运行期状态（在途单、租约、工时都在台账）；不写章程（charter.md 是顶层文件）。
- **内部结构**：YAML strictObject，键封闭。必填 `name`（非空串）、`path`（非空串，形如 `departments/<部门>`，嵌套为 `departments/A/departments/B`）、`level`（整数；模板约定=公司等级，嵌套深度只看目录）、`parent`（上级 path 或 null）、`leader`（工号）、`lanes`（非空串数组）、`functions`（非空串数组）；可选 `reports_to`（path 或 null）、`rules`（字符串数组）、`relations`（对象数组）、`jobs`（非空串数组）。注释里写明的 `relations.type ∈ 联签|下游交付|共享泳道` 只是人读约定，schema 记 `z.record`，不校验枚举。
- **导出 / 允许依赖**：无代码导出。被 `repo-validate.ts` 的顶层封闭集允许（`departments/` 子树）；被 `multifile.ts` 的 `isDeptConfigFile` 按 `departments/<X>/config.yaml` 与 `departments/A/departments/B/config.yaml` 发现。文件内不得出现对仓库代码的引用（无 import 概念）。
- **IO / 注入**：无运行期 IO；读取方（daemon 挂载、面板概览、调度源）注入目录内容，本族不自己读盘。
- **状态 / 并发 / 恢复**：静态资产。改动的唯一合法路径是批示后由 daemon 落盘并挂单 commit（AGENTS.md 第二节“公司 git 目录 = daemon 唯一写入者”）；人工手改只在模板仓内发生。无并发写保护——保护来自“唯一写入者”而非文件锁。
- **失败 / 错误分类**（全部来自 `multifileRules`，任一命中即挂载拒绝）：
  - `dept/dangling`：org-config 的 `departments[].path` 指向的 `config.yaml` 不存在（悬空索引，定位到 org-config 的索引行）。
  - `dept/orphan`：目录里有 config.yaml，但没有任何 org-config 索引条目指向它（孤儿部门）。
  - `dept-config/yaml-syntax`：YAML 解析失败。
  - `dept-config/missing-field`：形状不符（缺必填键、未知键、类型错）。
  - `dept/leader-dangling`：`leader` 工号不在 org-config `people` 索引里。
  - 现有校验**不**检查：文件内 `path` 是否等于其实际目录位置；`level` 是否等于公司等级；`parent`/`reports_to` 是否指向存在的部门；`jobs` 集合是否等于 org-config 的 jobs 集合；`relations.to` 是否存在。这些是已登记的空缺，不是“已校验”。
- **秘密边界**：无秘密；不得写真实凭证、本机绝对路径、内网 IP。
- **证据 / 测试**：`packages/company/test/multifile.test.ts`（索引↔文件双检、leader 交叉、strict 未知键、嵌套部门）、`jobs-loading.test.ts`（jobs 形状与 cadence 五档，读的是 org-config 而非本族）、`gen-template.test.ts`（3–9 逐字节生成）；不证明调度真的会按 lanes/jobs 派工（归 80/30 卷）。
- **尺寸预算**：单文件 ≤ 40 行（现 24–33 行，最大 c4 研发部 33）；目录直属文件数上限 25（现最大 12，见 §5.1）。新增部门按同样骨架，不把 rules/relations 写成散文。
- **迁移 / 兼容 / 回退**：目标不改内容。3–9 的 config.yaml 由 `level-specs.ts` + `gen-template.ts` 生成，任何手工修改都会被 `gen-template.test.ts` 的逐字节断言打红；回退 = `git revert` + 重跑生成器。

**逐件**

##### departments/**/config.yaml 逐件

| F-ID | 路径（模板根相对） | 部门 | 级 | leader | 泳道 | 职能 | jobs | 行数 |
|---|---|---|---|---|---|---|---|---|
| F-TPL-c2-dept-工程部 | departments/工程部/config.yaml | 工程部 | L2 | AGENT-1 | core | 交付 | health-patrol-工程部、daily-report-工程部 | 28 |
| F-TPL-c3-dept-研发部 | departments/研发部/config.yaml | 研发部 | L3 | ENG-0 | core、qa | 交付、策划、质量 | health-patrol-研发部、daily-report-研发部 | 32 |
| F-TPL-c3-dept-综合部 | departments/综合部/config.yaml | 综合部 | L3 | PRIME-0 | ops | 管理、人事、财务、情报 | health-patrol-综合部、daily-report-综合部 | 32 |
| F-TPL-c4-dept-研发部 | departments/研发部/config.yaml | 研发部 | L4 | ENG-0 | core、qa | 交付、策划、质量 | health-patrol-研发部、daily-report-研发部 | 33 |
| F-TPL-c4-dept-综合部 | departments/综合部/config.yaml | 综合部 | L4 | PRIME-0 | ops | 管理、人事、财务、情报 | health-patrol-综合部、daily-report-综合部 | 32 |
| F-TPL-c5-dept-产品策划部 | departments/产品策划部/config.yaml | 产品策划部 | L5 | PLN-0 | core | 策划 | health-patrol-产品策划部、daily-report-产品策划部 | 29 |
| F-TPL-c5-dept-人事部 | departments/人事部/config.yaml | 人事部 | L5 | HR-0 | ops | 人事 | health-patrol-人事部、daily-report-人事部 | 29 |
| F-TPL-c5-dept-工程部 | departments/工程部/config.yaml | 工程部 | L5 | ENG-0 | core | 交付 | health-patrol-工程部、daily-report-工程部 | 29 |
| F-TPL-c5-dept-综合部 | departments/综合部/config.yaml | 综合部 | L5 | PRIME-0 | ops | 管理、对外、情报 | health-patrol-综合部、daily-report-综合部 | 31 |
| F-TPL-c5-dept-财务部 | departments/财务部/config.yaml | 财务部 | L5 | FIN-0 | ops | 财务 | health-patrol-财务部、daily-report-财务部 | 29 |
| F-TPL-c5-dept-质量部 | departments/质量部/config.yaml | 质量部 | L5 | QA-0 | qa | 质量 | health-patrol-质量部、daily-report-质量部 | 29 |
| F-TPL-c6-dept-产品部 | departments/产品部/config.yaml | 产品部 | L6 | PLN-0 | core | 策划 | health-patrol-产品部、daily-report-产品部 | 29 |
| F-TPL-c6-dept-人事部 | departments/人事部/config.yaml | 人事部 | L6 | HR-0 | ops | 人事 | health-patrol-人事部、daily-report-人事部 | 29 |
| F-TPL-c6-dept-审计合规部 | departments/审计合规部/config.yaml | 审计合规部 | L6 | AUD-0 | audit | 审计 | health-patrol-审计合规部、daily-report-审计合规部 | 29 |
| F-TPL-c6-dept-工程部 | departments/工程部/config.yaml | 工程部 | L6 | ENG-0 | core | 交付 | health-patrol-工程部、daily-report-工程部 | 29 |
| F-TPL-c6-dept-工程部-项目群A | departments/工程部/departments/项目群A/config.yaml | 项目群A | L6 | ENG-1 | core | 交付 | 无 | 24 |
| F-TPL-c6-dept-工程部-项目群B | departments/工程部/departments/项目群B/config.yaml | 项目群B | L6 | ENG-3 | core | 交付 | 无 | 24 |
| F-TPL-c6-dept-战略情报部 | departments/战略情报部/config.yaml | 战略情报部 | L6 | INT-0 | intel | 情报 | health-patrol-战略情报部、daily-report-战略情报部 | 29 |
| F-TPL-c6-dept-综合部 | departments/综合部/config.yaml | 综合部 | L6 | PRIME-0 | ops | 管理、对外 | health-patrol-综合部、daily-report-综合部 | 30 |
| F-TPL-c6-dept-财务部 | departments/财务部/config.yaml | 财务部 | L6 | FIN-0 | ops | 财务 | health-patrol-财务部、daily-report-财务部 | 29 |
| F-TPL-c6-dept-质量部 | departments/质量部/config.yaml | 质量部 | L6 | QA-0 | qa | 质量 | health-patrol-质量部、daily-report-质量部 | 29 |
| F-TPL-c7-dept-事业部A | departments/事业部A/config.yaml | 事业部A | L7 | BU-1 | core | 经营 | health-patrol-事业部A、daily-report-事业部A | 29 |
| F-TPL-c7-dept-事业部A-研发部 | departments/事业部A/departments/研发部/config.yaml | 研发部 | L7 | ENG-1 | core | 交付 | 无 | 24 |
| F-TPL-c7-dept-事业部A-质量部 | departments/事业部A/departments/质量部/config.yaml | 质量部 | L7 | QA-1 | qa | 质量 | 无 | 24 |
| F-TPL-c7-dept-事业部B | departments/事业部B/config.yaml | 事业部B | L7 | BU-2 | core | 经营 | health-patrol-事业部B、daily-report-事业部B | 29 |
| F-TPL-c7-dept-事业部B-研发部 | departments/事业部B/departments/研发部/config.yaml | 研发部 | L7 | ENG-3 | core | 交付 | 无 | 24 |
| F-TPL-c7-dept-人事部 | departments/人事部/config.yaml | 人事部 | L7 | HR-0 | ops | 人事 | health-patrol-人事部、daily-report-人事部 | 29 |
| F-TPL-c7-dept-审计合规部 | departments/审计合规部/config.yaml | 审计合规部 | L7 | AUD-0 | audit | 审计 | health-patrol-审计合规部、daily-report-审计合规部 | 29 |
| F-TPL-c7-dept-平台工程部 | departments/平台工程部/config.yaml | 平台工程部 | L7 | PF-0 | platform | 平台工程 | health-patrol-平台工程部、daily-report-平台工程部 | 29 |
| F-TPL-c7-dept-战略部 | departments/战略部/config.yaml | 战略部 | L7 | INT-0 | intel | 战略 | health-patrol-战略部、daily-report-战略部 | 29 |
| F-TPL-c7-dept-综合部 | departments/综合部/config.yaml | 综合部 | L7 | PRIME-0 | ops | 管理、对外 | health-patrol-综合部、daily-report-综合部 | 30 |
| F-TPL-c7-dept-财务部 | departments/财务部/config.yaml | 财务部 | L7 | FIN-0 | ops | 财务 | health-patrol-财务部、daily-report-财务部 | 29 |
| F-TPL-c8-dept-事业部A | departments/事业部A/config.yaml | 事业部A | L8 | BU-1 | core | 经营 | health-patrol-事业部A、daily-report-事业部A | 29 |
| F-TPL-c8-dept-事业部A-研发部 | departments/事业部A/departments/研发部/config.yaml | 研发部 | L8 | ENG-1 | core | 交付 | 无 | 24 |
| F-TPL-c8-dept-事业部A-质量部 | departments/事业部A/departments/质量部/config.yaml | 质量部 | L8 | QA-1 | qa | 质量 | 无 | 24 |
| F-TPL-c8-dept-事业部B | departments/事业部B/config.yaml | 事业部B | L8 | BU-2 | core | 经营 | health-patrol-事业部B、daily-report-事业部B | 29 |
| F-TPL-c8-dept-事业部C | departments/事业部C/config.yaml | 事业部C | L8 | BU-3 | core | 经营 | health-patrol-事业部C、daily-report-事业部C | 29 |
| F-TPL-c8-dept-人事部 | departments/人事部/config.yaml | 人事部 | L8 | HR-0 | ops | 人事 | health-patrol-人事部、daily-report-人事部 | 29 |
| F-TPL-c8-dept-共享服务平台部 | departments/共享服务平台部/config.yaml | 共享服务平台部 | L8 | SSC-0 | ops | 共享服务 | health-patrol-共享服务平台部、daily-report-共享服务平台部 | 29 |
| F-TPL-c8-dept-审计合规部 | departments/审计合规部/config.yaml | 审计合规部 | L8 | AUD-0 | audit | 审计 | health-patrol-审计合规部、daily-report-审计合规部 | 29 |
| F-TPL-c8-dept-平台工程部 | departments/平台工程部/config.yaml | 平台工程部 | L8 | PF-0 | platform | 平台工程 | health-patrol-平台工程部、daily-report-平台工程部 | 29 |
| F-TPL-c8-dept-战略部 | departments/战略部/config.yaml | 战略部 | L8 | INT-0 | intel | 战略 | health-patrol-战略部、daily-report-战略部 | 29 |
| F-TPL-c8-dept-综合部 | departments/综合部/config.yaml | 综合部 | L8 | PRIME-0 | ops | 管理、对外 | health-patrol-综合部、daily-report-综合部 | 30 |
| F-TPL-c8-dept-财务部 | departments/财务部/config.yaml | 财务部 | L8 | FIN-0 | ops | 财务 | health-patrol-财务部、daily-report-财务部 | 29 |
| F-TPL-c9-dept-子公司A | departments/子公司A/config.yaml | 子公司A | L9 | SUB-1 | core | 经营 | health-patrol-子公司A、daily-report-子公司A | 29 |
| F-TPL-c9-dept-子公司B | departments/子公司B/config.yaml | 子公司B | L9 | SUB-2 | core | 经营 | health-patrol-子公司B、daily-report-子公司B | 29 |
| F-TPL-c9-dept-子公司C | departments/子公司C/config.yaml | 子公司C | L9 | SUB-3 | core | 经营 | health-patrol-子公司C、daily-report-子公司C | 29 |
| F-TPL-c9-dept-审计部 | departments/审计部/config.yaml | 审计部 | L9 | AUD-0 | audit | 审计 | health-patrol-审计部、daily-report-审计部 | 29 |
| F-TPL-c9-dept-战略部 | departments/战略部/config.yaml | 战略部 | L9 | INT-0 | intel | 战略 | health-patrol-战略部、daily-report-战略部 | 29 |
| F-TPL-c9-dept-法务部 | departments/法务部/config.yaml | 法务部 | L9 | LAW-0 | law | 法务 | health-patrol-法务部、daily-report-法务部 | 29 |
| F-TPL-c9-dept-综合部 | departments/综合部/config.yaml | 综合部 | L9 | PRIME-0 | ops | 管理、对外、人事、财务 | health-patrol-综合部、daily-report-综合部 | 32 |
| F-TPL-c9-dept-资本部 | departments/资本部/config.yaml | 资本部 | L9 | CAP-0 | capital | 资本 | health-patrol-资本部、daily-report-资本部 | 29 |
| F-TPL-cg-dept-内容部 | departments/内容部/config.yaml | 内容部 | L2 | GAME-2 | content | 内容创作 | game-feedback-patrol | 27 |
| F-TPL-cg-dept-研发部 | departments/研发部/config.yaml | 研发部 | L3 | GAME-1 | core | 交付 | game-build-smoke | 29 |
| F-TPL-ci-dept-增长部 | departments/增长部/config.yaml | 增长部 | L2 | GRO-1 | growth | 增长运营 | net-growth-daily | 27 |
| F-TPL-ci-dept-研发部 | departments/研发部/config.yaml | 研发部 | L3 | NET-1 | core、feature | 交付 | net-site-patrol | 29 |

表注：本文件 56 行 = 10 套模板的部门 config 总数；“部门”列取 `path` 末段名，文件内 `path` 值为完整路径（如 `departments/工程部/departments/项目群A`）；“无”表示该嵌套子部门**没有** `jobs` 键（不是空数组）。

#### 5.4.7 `departments/**/people/*.md`（91 件）

**族契约**

- **处置**：91 件全部目标保留，路径不变，内容不变（不在 §5.5 的 8 件迁移面内）。
- **归属**：01-C2-04（人事档案格式）、04-§二（档案挂部门树下）；76-DEF-PKG-01 的目录资产；提示词组装的身份注入源（17-§5）；校验实现 `multifile.ts` 的 `validatePersonFile`。
- **职责**：一个人的完整档案：工号、花名、YouTrack login、等级、所属部门、岗位、汇报线、技能本体、副作用等级、executor 偏好、在职状态，加固定六节正文。
- **非职责**：不做派工决策（`side_effects` 只是匹配输入）；不写工时/成本（台账）；不写绩效结论（“表现画像”是机械归集 + 人读，不是评分表）；不是 org-config 的替补索引（两处都要有，缺一即错）。
- **内部结构**：首行 `---` 起、首个整行 `---` 止的 front-matter（strictObject：`id`/`name`/`login`/`level`/`dept` 必填；`role`/`reports_to`/`skills`/`side_effects`/`executor`/`status` 可选）；正文固定六节：`## 一、定位`、`## 二、职责`、`## 三、做过的事`、`## 四、技能本体`、`## 五、表现画像`、`## 六、自述`。第三节内含 `<!--AUTO-->` / `<!--/AUTO-->` 受管区块，机器只写这一块。
- **导出 / 允许依赖**：无代码导出。`dept` 值必须是路径形态 `departments/<部门>[/departments/<子部门>]`；`reports_to` 是工号或 null；`skills` 是内部工种短名（`typescript`/`测试`/`情报` 这类），不是自由散文。档案不 import 任何代码。
- **IO / 注入**：无运行期 IO；读取方注入文件内容。写入面：`<!--AUTO-->` 区块由 daemon 收割侧维护，其余节由人事流程写；两者都经 daemon 挂单 commit。
- **状态 / 并发 / 恢复**：`status ∈ active|paused|retired`（schema 只收字符串，不校验枚举）。工号 `id` = 文件名 = 永不变主键：离职置 retired，不复用工号、不改文件名。无并发写保护，靠唯一写入者。
- **失败 / 错误分类**：
  - `people/bad-front-matter`：首行不是 `---`、找不到闭合 `---`、或 front-matter YAML 语法错。
  - `people-fm/missing-field`：front-matter 形状不符（缺必填键/类型错/未知键）。
  - `people/missing-section:<序>`：六节标题缺失（弱校验：只查 `## <序>、` 前缀且行内含关键词，节内内容不查）。
  - `people/dangling`：org-config `people` 索引引用的档案文件不存在（`file` 键缺省时按 `<dept>/people/<id>.md` 推导）。
  - `people/orphan`：档案存在但未被任何索引条目引用。
  - `people/file-id-mismatch`：文件名主干 ≠ front-matter `id`。
  - `people/id-mismatch`：索引条目 `id` ≠ 档案 `id`。
  - 现有校验**不**检查：`dept` 是否等于文件实际所在目录；`reports_to` 是否指向已登记工号（悬空汇报线不会被发现）；`level` 是否与部门 config 的 `level` 相容；`skills`/`side_effects` 的取值集合。
  - 档案 front-matter 与 org-config `people[]` 索引的重复字段，**只有 `id` 有闸**（`people/id-mismatch`）；`name`/`login`/`level`/`dept`/`role`/`skills`/`status`/`reports_to` 无闸。本次实测 91/91 一致——这是**数据一致**，不是“有校验”，登记 W04-2。
- **秘密边界**：无秘密；`login` 是账号锚点不是口令，档案内不得出现 token、cookie、真实邮箱口令。
- **证据 / 测试**：`multifile.test.ts`（双检、六节弱校验、`file-id-mismatch`/`id-mismatch`、strict 未知键）、`gen-template.test.ts`（91 份逐字节、花名唯一）、`jobs-loading.test.ts`（读档案做派工形状断言）、`dependencies.test.ts`（`extractPersonAttrs(orgConfigSrc)` 从 **org-config 的 `people[]`** 取绑定属性，不读人事档案）；不证明身份注入后的模型行为（归 05-prompt/80）。
- **尺寸预算**：单文件 ≤ 120 行（现约 60–90 行，六节骨架固定）；目录直属文件数 ≤ 25（现最大 6）。新增档案照抄六节骨架，不新造节。
- **迁移 / 兼容 / 回退**：目标不改内容。3–9 的 91 份里，3–9 部分由生成器产出（`gen-template.test.ts` 逐字节锁死），game/internet 的 6 份是手写源；回退 = `git revert` + 重跑生成器。

**逐件**

##### departments/**/people/*.md 逐件

| F-ID | 路径（模板根相对） | 工号 | 花名 | 级 | 部门 | 岗位 | 汇报 | 技能 | side_effects |
|---|---|---|---|---|---|---|---|---|---|
| F-TPL-c2-person-AGENT-1 | departments/工程部/people/AGENT-1.md | AGENT-1 | 示例工程师 | L2 | 工程部 | 工程负责人 | — | typescript | 写盘 |
| F-TPL-c3-person-ENG-0 | departments/研发部/people/ENG-0.md | ENG-0 | 屹笛 | L3 | 研发部 | 研发部长 | PRIME-0 | typescript | 写盘 |
| F-TPL-c3-person-ENG-1 | departments/研发部/people/ENG-1.md | ENG-1 | 望樵 | L1 | 研发部 | 程序工程师 | ENG-0 | typescript | 写盘 |
| F-TPL-c3-person-PLN-1 | departments/研发部/people/PLN-1.md | PLN-1 | 素塔 | L2 | 研发部 | 策划 | ENG-0 | 策划 | 写盘 |
| F-TPL-c3-person-QA-1 | departments/研发部/people/QA-1.md | QA-1 | 静樵 | L2 | 研发部 | 质量工程师 | ENG-0 | 测试 | 写盘 |
| F-TPL-c3-person-HF-1 | departments/综合部/people/HF-1.md | HF-1 | 昭径 | L2 | 综合部 | 人事财务（单岗） | PRIME-0 | 人事+财务 | 写盘 |
| F-TPL-c3-person-INT-1 | departments/综合部/people/INT-1.md | INT-1 | 直钟 | L2 | 综合部 | 情报（单岗） | PRIME-0 | 情报 | 写盘 |
| F-TPL-c3-person-PRIME-0 | departments/综合部/people/PRIME-0.md | PRIME-0 | 朗窗 | L3 | 综合部 | 总经理（负责人） | — | 管理 | 写盘 |
| F-TPL-c4-person-ENG-0 | departments/研发部/people/ENG-0.md | ENG-0 | 湛潮 | L4 | 研发部 | 研发部长 | PRIME-0 | typescript | 写盘 |
| F-TPL-c4-person-ENG-1 | departments/研发部/people/ENG-1.md | ENG-1 | 川樵 | L3 | 研发部 | 程序组长 | ENG-0 | typescript | 写盘 |
| F-TPL-c4-person-ENG-2 | departments/研发部/people/ENG-2.md | ENG-2 | 屿井 | L2 | 研发部 | 程序工程师 | ENG-1 | typescript | 写盘 |
| F-TPL-c4-person-PLN-1 | departments/研发部/people/PLN-1.md | PLN-1 | 煦杉 | L3 | 研发部 | 策划组长 | ENG-0 | 策划 | 写盘 |
| F-TPL-c4-person-QA-1 | departments/研发部/people/QA-1.md | QA-1 | 拾檐 | L3 | 研发部 | 质量组长 | ENG-0 | 测试 | 写盘 |
| F-TPL-c4-person-QA-2 | departments/研发部/people/QA-2.md | QA-2 | 叙杉 | L2 | 研发部 | 质量工程师 | QA-1 | 测试 | 写盘 |
| F-TPL-c4-person-FIN-1 | departments/综合部/people/FIN-1.md | FIN-1 | 屹林 | L2 | 综合部 | 财务（单岗） | PRIME-0 | 财务 | 写盘 |
| F-TPL-c4-person-HR-1 | departments/综合部/people/HR-1.md | HR-1 | 云隼 | L2 | 综合部 | 人事（单岗） | PRIME-0 | 人事 | 写盘 |
| F-TPL-c4-person-INT-1 | departments/综合部/people/INT-1.md | INT-1 | 昭石 | L2 | 综合部 | 情报（单岗） | PRIME-0 | 情报 | 写盘 |
| F-TPL-c4-person-PRIME-0 | departments/综合部/people/PRIME-0.md | PRIME-0 | 白原 | L4 | 综合部 | 总经理 | — | 管理 | 写盘 |
| F-TPL-c5-person-PLN-0 | departments/产品策划部/people/PLN-0.md | PLN-0 | 煦鲸 | L4 | 产品策划部 | 产品策划部长 | PRIME-0 | 策划 | 写盘 |
| F-TPL-c5-person-PLN-1 | departments/产品策划部/people/PLN-1.md | PLN-1 | 叙樵 | L3 | 产品策划部 | 策划 | PLN-0 | 策划 | 写盘 |
| F-TPL-c5-person-HR-0 | departments/人事部/people/HR-0.md | HR-0 | 直帆 | L4 | 人事部 | 人事部长 | PRIME-0 | 人事 | 写盘 |
| F-TPL-c5-person-HR-1 | departments/人事部/people/HR-1.md | HR-1 | 直灯 | L2 | 人事部 | 人事专员 | HR-0 | 人事 | 写盘 |
| F-TPL-c5-person-ENG-0 | departments/工程部/people/ENG-0.md | ENG-0 | 望河 | L4 | 工程部 | 工程部长 | PRIME-0 | typescript | 写盘 |
| F-TPL-c5-person-ENG-1 | departments/工程部/people/ENG-1.md | ENG-1 | 松峰 | L3 | 工程部 | 工程师 | ENG-0 | typescript | 写盘 |
| F-TPL-c5-person-EXT-1 | departments/综合部/people/EXT-1.md | EXT-1 | 叙檐 | L3 | 综合部 | 对外（单岗） | PRIME-0 | 对外 | 写盘 |
| F-TPL-c5-person-INT-1 | departments/综合部/people/INT-1.md | INT-1 | 知井 | L3 | 综合部 | 战略情报（单岗） | PRIME-0 | 情报 | 写盘 |
| F-TPL-c5-person-PRIME-0 | departments/综合部/people/PRIME-0.md | PRIME-0 | 溪笛 | L5 | 综合部 | 总经理 | — | 管理 | 写盘 |
| F-TPL-c5-person-FIN-0 | departments/财务部/people/FIN-0.md | FIN-0 | 疏笛 | L4 | 财务部 | 财务部长 | PRIME-0 | 财务 | 写盘 |
| F-TPL-c5-person-FIN-1 | departments/财务部/people/FIN-1.md | FIN-1 | 川舟 | L2 | 财务部 | 财务专员 | FIN-0 | 财务 | 写盘 |
| F-TPL-c5-person-QA-0 | departments/质量部/people/QA-0.md | QA-0 | 澈禾 | L4 | 质量部 | 质量部长 | PRIME-0 | 测试 | 写盘 |
| F-TPL-c5-person-QA-1 | departments/质量部/people/QA-1.md | QA-1 | 叙潮 | L3 | 质量部 | 质量工程师 | QA-0 | 测试 | 写盘 |
| F-TPL-c6-person-PLN-0 | departments/产品部/people/PLN-0.md | PLN-0 | 青隼 | L5 | 产品部 | 产品部长 | PRIME-0 | 策划 | 写盘 |
| F-TPL-c6-person-HR-0 | departments/人事部/people/HR-0.md | HR-0 | 朗鲲 | L5 | 人事部 | 人事部长 | PRIME-0 | 人事 | 写盘 |
| F-TPL-c6-person-HR-1 | departments/人事部/people/HR-1.md | HR-1 | 直鹿 | L3 | 人事部 | 招聘专员 | HR-0 | 人事 | 写盘 |
| F-TPL-c6-person-AUD-0 | departments/审计合规部/people/AUD-0.md | AUD-0 | 松鹿 | L5 | 审计合规部 | 审计合规部长 | PRIME-0 | 审计 | 写盘 |
| F-TPL-c6-person-ENG-1 | departments/工程部/departments/项目群A/people/ENG-1.md | ENG-1 | 星舟 | L4 | 工程部/项目群A | 项目群A 主管 | ENG-0 | typescript | 写盘 |
| F-TPL-c6-person-ENG-2 | departments/工程部/departments/项目群A/people/ENG-2.md | ENG-2 | 朗樵 | L3 | 工程部/项目群A | 程序工程师 | ENG-1 | typescript | 写盘 |
| F-TPL-c6-person-ENG-3 | departments/工程部/departments/项目群B/people/ENG-3.md | ENG-3 | 素钟 | L4 | 工程部/项目群B | 项目群B 主管 | ENG-0 | typescript | 写盘 |
| F-TPL-c6-person-ENG-4 | departments/工程部/departments/项目群B/people/ENG-4.md | ENG-4 | 疏峰 | L3 | 工程部/项目群B | 程序工程师 | ENG-3 | typescript | 写盘 |
| F-TPL-c6-person-ENG-0 | departments/工程部/people/ENG-0.md | ENG-0 | 缓河 | L5 | 工程部 | 工程部长 | PRIME-0 | typescript | 写盘 |
| F-TPL-c6-person-INT-0 | departments/战略情报部/people/INT-0.md | INT-0 | 素篁 | L5 | 战略情报部 | 战略情报部长 | PRIME-0 | 情报 | 写盘 |
| F-TPL-c6-person-EXT-1 | departments/综合部/people/EXT-1.md | EXT-1 | 沐潮 | L3 | 综合部 | 对外（单岗） | PRIME-0 | 对外 | 写盘 |
| F-TPL-c6-person-PRIME-0 | departments/综合部/people/PRIME-0.md | PRIME-0 | 青笛 | L6 | 综合部 | 总经理 | — | 管理 | 写盘 |
| F-TPL-c6-person-FIN-0 | departments/财务部/people/FIN-0.md | FIN-0 | 澄帆 | L5 | 财务部 | 财务部长 | PRIME-0 | 财务 | 写盘 |
| F-TPL-c6-person-FIN-1 | departments/财务部/people/FIN-1.md | FIN-1 | 静檐 | L3 | 财务部 | FP&A 专员 | FIN-0 | 财务 | 写盘 |
| F-TPL-c6-person-QA-0 | departments/质量部/people/QA-0.md | QA-0 | 远隼 | L5 | 质量部 | 质量部长 | PRIME-0 | 测试 | 写盘 |
| F-TPL-c7-person-ENG-1 | departments/事业部A/departments/研发部/people/ENG-1.md | ENG-1 | 野檐 | L5 | 事业部A/研发部 | 研发部长（A） | BU-1 | typescript | 写盘 |
| F-TPL-c7-person-ENG-2 | departments/事业部A/departments/研发部/people/ENG-2.md | ENG-2 | 屿径 | L4 | 事业部A/研发部 | 程序工程师 | ENG-1 | typescript | 写盘 |
| F-TPL-c7-person-QA-1 | departments/事业部A/departments/质量部/people/QA-1.md | QA-1 | 直檐 | L5 | 事业部A/质量部 | 质量部长（A） | BU-1 | 测试 | 写盘 |
| F-TPL-c7-person-BU-1 | departments/事业部A/people/BU-1.md | BU-1 | 溪径 | L6 | 事业部A | 事业部A 总经理 | PRIME-0 | 经营 | 写盘 |
| F-TPL-c7-person-ENG-3 | departments/事业部B/departments/研发部/people/ENG-3.md | ENG-3 | 星隼 | L5 | 事业部B/研发部 | 研发部长（B） | BU-2 | typescript | 写盘 |
| F-TPL-c7-person-BU-2 | departments/事业部B/people/BU-2.md | BU-2 | 松钟 | L6 | 事业部B | 事业部B 总经理 | PRIME-0 | 经营 | 写盘 |
| F-TPL-c7-person-HR-0 | departments/人事部/people/HR-0.md | HR-0 | 听杉 | L6 | 人事部 | 人事部长 | PRIME-0 | 人事 | 写盘 |
| F-TPL-c7-person-AUD-0 | departments/审计合规部/people/AUD-0.md | AUD-0 | 澄桥 | L6 | 审计合规部 | 审计合规部长 | PRIME-0 | 审计 | 写盘 |
| F-TPL-c7-person-PF-0 | departments/平台工程部/people/PF-0.md | PF-0 | 岚亭 | L6 | 平台工程部 | 平台工程部长 | PRIME-0 | 平台工程 | 写盘 |
| F-TPL-c7-person-INT-0 | departments/战略部/people/INT-0.md | INT-0 | 岚隼 | L6 | 战略部 | 战略部长 | PRIME-0 | 情报 | 写盘 |
| F-TPL-c7-person-EXT-1 | departments/综合部/people/EXT-1.md | EXT-1 | 缓篁 | L4 | 综合部 | 对外（单岗） | PRIME-0 | 对外 | 写盘 |
| F-TPL-c7-person-PRIME-0 | departments/综合部/people/PRIME-0.md | PRIME-0 | 松窗 | L7 | 综合部 | 总裁 | — | 管理 | 写盘 |
| F-TPL-c7-person-FIN-0 | departments/财务部/people/FIN-0.md | FIN-0 | 澈亭 | L6 | 财务部 | 财务部长 | PRIME-0 | 财务 | 写盘 |
| F-TPL-c8-person-ENG-1 | departments/事业部A/departments/研发部/people/ENG-1.md | ENG-1 | 拾桥 | L6 | 事业部A/研发部 | 研发部长（A） | BU-1 | typescript | 写盘 |
| F-TPL-c8-person-QA-1 | departments/事业部A/departments/质量部/people/QA-1.md | QA-1 | 野雀 | L6 | 事业部A/质量部 | 质量部长（A） | BU-1 | 测试 | 写盘 |
| F-TPL-c8-person-BU-1 | departments/事业部A/people/BU-1.md | BU-1 | 松窗 | L7 | 事业部A | 事业部A 总经理 | PRIME-0 | 经营 | 写盘 |
| F-TPL-c8-person-BU-2 | departments/事业部B/people/BU-2.md | BU-2 | 屿窗 | L7 | 事业部B | 事业部B 总经理 | PRIME-0 | 经营 | 写盘 |
| F-TPL-c8-person-BU-3 | departments/事业部C/people/BU-3.md | BU-3 | 星峰 | L7 | 事业部C | 事业部C 总经理 | PRIME-0 | 经营 | 写盘 |
| F-TPL-c8-person-HR-0 | departments/人事部/people/HR-0.md | HR-0 | 屹亭 | L7 | 人事部 | 人事总监 | PRIME-0 | 人事 | 写盘 |
| F-TPL-c8-person-SSC-0 | departments/共享服务平台部/people/SSC-0.md | SSC-0 | 岚帆 | L6 | 共享服务平台部 | 共享服务平台部长 | PRIME-0 | 共享服务 | 写盘 |
| F-TPL-c8-person-SSC-1 | departments/共享服务平台部/people/SSC-1.md | SSC-1 | 明隼 | L5 | 共享服务平台部 | 财务共享专员 | SSC-0 | 共享服务 | 写盘 |
| F-TPL-c8-person-SSC-2 | departments/共享服务平台部/people/SSC-2.md | SSC-2 | 沐禾 | L5 | 共享服务平台部 | 人事共享专员 | SSC-0 | 共享服务 | 写盘 |
| F-TPL-c8-person-SSC-3 | departments/共享服务平台部/people/SSC-3.md | SSC-3 | 慕鲸 | L5 | 共享服务平台部 | 计算平台工程师 | SSC-0 | 共享服务 | 写盘 |
| F-TPL-c8-person-AUD-0 | departments/审计合规部/people/AUD-0.md | AUD-0 | 明砚 | L7 | 审计合规部 | 审计合规总监 | PRIME-0 | 审计 | 写盘 |
| F-TPL-c8-person-PF-0 | departments/平台工程部/people/PF-0.md | PF-0 | 听桐 | L7 | 平台工程部 | 平台工程总监 | PRIME-0 | 平台工程 | 写盘 |
| F-TPL-c8-person-INT-0 | departments/战略部/people/INT-0.md | INT-0 | 沐塔 | L7 | 战略部 | 战略总监 | PRIME-0 | 情报 | 写盘 |
| F-TPL-c8-person-EXT-1 | departments/综合部/people/EXT-1.md | EXT-1 | 松笛 | L5 | 综合部 | 对外（单岗） | PRIME-0 | 对外 | 写盘 |
| F-TPL-c8-person-PRIME-0 | departments/综合部/people/PRIME-0.md | PRIME-0 | 朗汀 | L8 | 综合部 | 总裁 | — | 管理 | 写盘 |
| F-TPL-c8-person-FIN-0 | departments/财务部/people/FIN-0.md | FIN-0 | 慕汀 | L7 | 财务部 | 财务总监 | PRIME-0 | 财务 | 写盘 |
| F-TPL-c9-person-SUB-1 | departments/子公司A/people/SUB-1.md | SUB-1 | 煦笛 | L7 | 子公司A | 子公司A 负责人 | PRIME-0 | 经营 | 写盘 |
| F-TPL-c9-person-SUB-2 | departments/子公司B/people/SUB-2.md | SUB-2 | 缓雀 | L7 | 子公司B | 子公司B 负责人 | PRIME-0 | 经营 | 写盘 |
| F-TPL-c9-person-SUB-3 | departments/子公司C/people/SUB-3.md | SUB-3 | 白桐 | L7 | 子公司C | 子公司C 负责人 | PRIME-0 | 经营 | 写盘 |
| F-TPL-c9-person-AUD-0 | departments/审计部/people/AUD-0.md | AUD-0 | 川峰 | L8 | 审计部 | 审计部长 | PRIME-0 | 审计 | 写盘 |
| F-TPL-c9-person-INT-0 | departments/战略部/people/INT-0.md | INT-0 | 青浦 | L8 | 战略部 | 首席战略 | PRIME-0 | 情报 | 写盘 |
| F-TPL-c9-person-LAW-0 | departments/法务部/people/LAW-0.md | LAW-0 | 知桥 | L8 | 法务部 | 法务部长 | PRIME-0 | 法务 | 写盘 |
| F-TPL-c9-person-EXT-1 | departments/综合部/people/EXT-1.md | EXT-1 | 川檐 | L6 | 综合部 | 对外（单岗） | PRIME-0 | 对外 | 写盘 |
| F-TPL-c9-person-HF-1 | departments/综合部/people/HF-1.md | HF-1 | 昭檐 | L6 | 综合部 | 人事财务（控股面单岗） | PRIME-0 | 人事+财务 | 写盘 |
| F-TPL-c9-person-PRIME-0 | departments/综合部/people/PRIME-0.md | PRIME-0 | 望樵 | L9 | 综合部 | 董事长 | — | 管理 | 写盘 |
| F-TPL-c9-person-CAP-0 | departments/资本部/people/CAP-0.md | CAP-0 | 星桐 | L8 | 资本部 | 资本部长 | PRIME-0 | 资本 | 写盘 |
| F-TPL-cg-person-GAME-2 | departments/内容部/people/GAME-2.md | GAME-2 | 关卡设计师 | L2 | 内容部 | 关卡设计师 | — | leveldesign | 写盘、对外发言 |
| F-TPL-cg-person-GAME-1 | departments/研发部/people/GAME-1.md | GAME-1 | 主程 | L3 | 研发部 | 主程 | — | unity+csharp | 写盘 |
| F-TPL-cg-person-GAME-3 | departments/研发部/people/GAME-3.md | GAME-3 | 测试工程师 | L2 | 研发部 | 测试工程师 | GAME-1 | qa | 写盘 |
| F-TPL-ci-person-GRO-1 | departments/增长部/people/GRO-1.md | GRO-1 | 增长运营 | L2 | 增长部 | 增长运营 | — | analytics | 写盘、对外发言 |
| F-TPL-ci-person-NET-1 | departments/研发部/people/NET-1.md | NET-1 | 全栈工程师 | L3 | 研发部 | 研发负责人 | — | typescript+nodejs | 写盘 |
| F-TPL-ci-person-NET-2 | departments/研发部/people/NET-2.md | NET-2 | 前端工程师 | L2 | 研发部 | 前端工程师 | NET-1 | typescript+react | 写盘 |

表注：本文件 91 行 = 10 套模板的人事档案总数；“部门”列同样取 `dept` 路径的末段（嵌套显示为 `事业部A/研发部`），文件内 `dept` 是完整路径；“—”表示 `reports_to: null`（根节点/无上级）。`side_effects` 列只列取值，YAML 中是数组（如 `[写盘, 对外发言]`）。

#### 5.4.8 `dependencies.yaml`（2 件）

**族契约**

- **处置**：2 件（game、internet）目标保留，路径与内容不变；2–9 级模板**没有**该文件，这是刻意的：依赖清单只在行业包出现。
- **归属**：43-§四（依赖清单与插件绑定）、51-C-7/D-1..D-4；实现 `packages/company/src/dependencies.ts`；目标归属 76-DEF-PKG-02/03 的 definition part（part 切分未执行，见 §5.5.5）。
- **职责**：声明“什么属性的员工需要什么 dsh 插件能力”，并作为公司包内插件源的安装索引；`when:{attr,is}` → `plugins[{name,version}]`。
- **非职责**：不是可执行依赖（不是 npm `dependencies`，不由 bun/npm 解析）；不写安装结果（registry.json / install-log.jsonl 落在注入的插件根，不进公司包）；不保证版本可获取（缺源=missing，如实上报）；不定义插件行为；也**不是 `BindingProfile`**——本文件是“属性→插件”的静态绑定，80-§6.6/BIND-01 的 20 字段 `BindingProfile` 是运行期画像，两者不得互相替代。
- **内部结构**：`schema: studio-next/dependencies@1` + `bindings` 数组，每条 `when:{attr,is}` → `plugins:[{name,version}]`（至少一个）。strictObject 全层，未知键拒收。`attr` 封闭枚举 `role|dept|level|skills|executor|status`；`version` 只收 `^x.y[.z]` 或 `x.y[.z]` 两形态，缺 patch 归 `.0`；`^0.x` 锁 minor、`^0.0` 锁 patch。game 28 行、internet 36 行。
- **导出 / 允许依赖**：无代码导出；被 `parseDependencies`/`safeParseDependencies` 读取，被 `planPluginInstalls` 纯函数消费，被 `repo-validate.ts` 的顶层封闭集允许。`dept` 匹配对 `path` 全量与末段名双候选；`skills` 逐元素匹配；`level` 字符串化比较。
- **IO / 注入**：文件本身无 IO；安装器注入隔离插件根（无缺省值，结构上不可能写用户 `~/.dsh`）、插件源快照、确认回调。
- **状态 / 并发 / 恢复**：无状态。安装是“计划→确认→落位→登记”四段，拒确认=零落盘；配置指纹 = sha256(原文 ‖ 排序后启用集)，变则增量补装、不变则零动作；启用集收缩**不卸载**（registry 是追加事实）。失败时已落位文件保留并登记，不静默回滚。
- **失败 / 错误分类**：`deps/yaml-syntax`、`deps/invalid`（形状/绑定域/版本形态）、`deps/contract-bad-input`（调用方输入不符）、`deps/plugin-missing`（源里找不到）、`deps/plugin-package-invalid`（包内源插件形态闸不过）、`deps/registry-invalid`、`deps/state-invalid`。多点命中同一插件的版本约束无解 → `conflict` 如实上报，**不装错版本**。missing 默认不阻断导入；`failOnMissing=true` 才是 fail-fast 严格面。
- **秘密边界**：无秘密；插件名/版本是公开标识；安装日志不得写本机绝对路径之外的敏感信息（日志本身在注入根，不入库）。
- **证据 / 测试**：`dependencies.test.ts`（505 行：schema、绑定域、版本求交、安装/缺源/冲突、指纹幂等、确认拒）、`deps-cases.test.ts`（契约域用例）、`industry-templates.test.ts`（两份清单与档案的绑定可达性）；不证明 npm/registry 外部源可用（v1 只留 `PluginSource` 接口）。
- **尺寸预算**：≤ 60 行；现 28/36。新增绑定按一条一行，不写注释长文。
- **迁移 / 兼容 / 回退**：schema 字面量 `studio-next/dependencies@1` 目标不变；part 分离（若做）只移动文件位置，不改内容；回退 = `git revert`。

**逐件**

##### dependencies.yaml 逐件

| F-ID | 路径 | schema | 绑定 | 安装面 | 行数 |
|---|---|---|---|---|---|
| F-TPL-cg-deps | dependencies.yaml | studio-next/dependencies@1 | role=主程→dsh-asset-check@^1.0；dept=内容部→dsh-loc-lint@0.9.0 | 包内源命中 install / 无源命中 missing | 28 |
| F-TPL-ci-deps | dependencies.yaml | studio-next/dependencies@1 | role=前端工程师→dsh-web-test@^1.2；dept=研发部→dsh-web-test@1.2.0；skills=analytics→dsh-metrics-board@^0.4 | 包内源命中 install / 无源命中 missing | 36 |

表注：game 的 `dsh-loc-lint@0.9.0` 与 internet 的 `dsh-metrics-board@^0.4` 在包内没有源 → 导入时进 missing 报告，这是“能力声明面”的预期行为，不是缺陷。

#### 5.4.9 `plugins/**`（6 件）

**族契约**

- **处置**：6 件（game 3 + internet 3）目标保留，路径与内容不变；**登记**为待分离资产（见 §5.3 与 §5.5.5）：`plugins/` 是公司包里唯一的可执行代码位，schema 迁移后应与纯配置分属不同 part。分离未执行，物理路径未定。
- **归属**：34-§3.1（dsh.bundle 是 profile 层入场券）、34-§3.2（插件模块约定）、43-§四（公司包内唯一代码位）；加载方是 dsh，不是本仓 daemon。
- **职责**：给行业包一个“安装=落位+登记”可跑通的最小插件样本：`package.json` 声明包身份与 bundle 补丁，`cordis.patch.yml` 用 insert 语法把插件挂进 profile，`src/index.mjs` 提供 ESM 具名导出 `name`/`apply`。
- **非职责**：不实现真实业务（`apply` 只注册 `session/event` 并自增闭包计数器，是占位行为）；不 import 框架代码、不读公司目录、不写台账、不联网；不被本仓 workspace 解析（`plugins/*/package.json` 不在 bun workspaces 里，由导入流安装到隔离插件根）；不保证被加载（未证真机）。
- **内部结构**：三件一组。`package.json`：`name`、`version`、`type: module`、`description`、`main: src/index.mjs`、`dsh.bundle.patch: ./cordis.patch.yml`。`cordis.patch.yml`：`- insert:` 下一条完整条目 `{id, name: ./src/index.mjs, config: {}}`。`src/index.mjs`：`export const name`、`export function apply(ctx, _config)`。
- **导出 / 允许依赖**：导出 `name`（字符串）与 `apply`（函数）。允许依赖=零第三方依赖；不得 import `@studio-next/*`、不得 import `node:fs` 之外的宿主能力（现样本连 `node:*` 都不用）。
- **IO / 注入**：无文件/网络 IO。`ctx` 由宿主注入，`ctx.on('session/event', …)` 是唯一交互面；`_config` 当前不使用。
- **状态 / 并发 / 恢复**：状态只有闭包内 `checked` 计数器，进程内有效、无持久化、无恢复语义；并发由宿主事件循环串行投递，样本自身无锁。
- **失败 / 错误分类**：文件层无自校验；失败面在安装期——`deps/plugin-package-invalid`（缺 `name`/`version`/`dsh.bundle` 或 patch 文件不在位）、`deps/plugin-missing`（源里没有）、`install` 阶段 IO 错（复制失败、目标不可写）。运行期加载失败归 dsh，本附录不定义错误码。
- **秘密边界**：无秘密；`description` 是说明文字，不得写 token 或内网地址。
- **证据 / 测试**：`industry-templates.test.ts`（插件形态闸：三件在位、`main`/`dsh.bundle.patch` 指向存在的文件、无符号链接、无 exec 位）；`dependencies.test.ts`（包内源命中 → install 计划）；`gen-template` 不覆盖这两个行业包；**未证**：真实 dsh 是否能加载 `apply`。
- **尺寸预算**：单文件 ≤ 40 行（现 5/12/13）；一个插件目录 3 文件，目录直属文件数 ≤ 25。
- **迁移 / 兼容 / 回退**：目标不改内容；若做 part 分离，移动路径需同步 76/82 的 part 索引与导入流安装根；`.d.ts` 伴生是否随插件分发归 79/12 决定，本附录不私定。回退 = `git revert`。

**与构建轨的关系**：这 6 件是 `.mjs`（已是 JS），随包分发无需编译，`cordis.patch.yml` 的 `name` 直接指 `./src/index.mjs` 成立。若将来把插件源码改成 `.ts`，79-§7.2 的规则接管：补丁 `name` 必须指 `./dist/index.js`、插件需自带构建轨、`dsh.bundle.patch` 仍指 `./cordis.patch.yml`；这是形态切换，不是本文的现有目标。当前没有任何模板参与 `tsc` 构建，模板 225 件全部以源码/文本形态分发。

**逐件**

##### plugins/** 逐件

| F-ID | 路径 | 形态 | 导出 / 入口 | IO | 行数 |
|---|---|---|---|---|---|
| F-TPL-cg-plugin-dsh-asset-check-pkg | plugins/dsh-asset-check/package.json | dsh-asset-check@1.0.0；main=src/index.mjs；dsh.bundle.patch=./cordis.patch.yml | — | 无 | 12 |
| F-TPL-cg-plugin-dsh-asset-check-patch | plugins/dsh-asset-check/cordis.patch.yml | insert 一条：id=dsh-asset-check；name=./src/index.mjs；config={} | — | 无 | 5 |
| F-TPL-cg-plugin-dsh-asset-check-index | plugins/dsh-asset-check/src/index.mjs | ESM 具名导出 name/apply | apply(ctx,_config) 注册 session/event | 闭包计数器，无持久化 | 13 |
| F-TPL-ci-plugin-dsh-web-test-pkg | plugins/dsh-web-test/package.json | dsh-web-test@1.2.0；main=src/index.mjs；dsh.bundle.patch=./cordis.patch.yml | — | 无 | 12 |
| F-TPL-ci-plugin-dsh-web-test-patch | plugins/dsh-web-test/cordis.patch.yml | insert 一条：id=dsh-web-test；name=./src/index.mjs；config={} | — | 无 | 5 |
| F-TPL-ci-plugin-dsh-web-test-index | plugins/dsh-web-test/src/index.mjs | ESM 具名导出 name/apply | apply(ctx,_config) 注册 session/event | 闭包计数器，无持久化 | 13 |

表注：6 件全部位于 `templates/company-game/plugins/` 与 `templates/company-internet/plugins/`；其中两份 `src/index.mjs` 是 225 件模板里仅有的可执行 JS，其余 223 件为 YAML/Markdown/JSON 与占位声明件（`.gitkeep`：16 件空 + 2 件 3 行注释）。

#### 5.4.10 `.gitkeep`（18 件）

**族契约**

- **处置**：18 件全部目标保留，路径不变。**尺寸不是“全部 0 字节”**：2–9 的 16 件为 0 字节；game/internet 的 2 件 `reports/.gitkeep` 为 **263 字节 / 3 行**（三行 `#` 注释：报表落点、命名约定、`.gitkeep` 仅占位可删）。
- **归属**：04-§二 目录契约的附属占位；76-DEF-PKG-01 的目录资产；`repo-validate.ts` 的顶层封闭集允许 `docs/`、`reports/` 两个目录。
- **职责**：让 git 跟踪目录，使 `docs/` 与 `reports/` 在 clone 后就存在，导入流/校验器按“目录在场”判断时不需要额外创建；行业包的两件兼作 `reports/` 的落点说明。
- **非职责**：不参与 schema、不被任何解析器读取、不代表“目录可用”（可用与否由写权限与校验决定）；2–9 的件不含内容，行业包的件只是注释，不承载报表数据。
- **内部结构**：2–9 为 0 字节空文件；game/internet 为 3 行 `#` 注释（263 字节，末尾有换行）。命名固定 `.gitkeep`（不是 `.keep`、不是 `README.md`）。
- **导出 / 允许依赖**：无。
- **IO / 注入**：无。
- **状态 / 并发 / 恢复**：无状态。注意：`.gitkeep` 被删且目录内仍无文件时，目录本身会从工作树消失；恢复=重新建目录 + 放占位。
- **失败 / 错误分类**：无专属错误码。目录缺失时表现为依赖它的流程失败（如报表落盘目标不存在、`repo-validate` 顶层封闭集不命中），不是本文件报错。
- **秘密边界**：无。
- **证据 / 测试**：`gen-template.test.ts` 对 3–9 做“仓树键集全等 + 逐字节相等”对账（含 `docs/.gitkeep`、`reports/.gitkeep`），因此 3–9 的 14 件与生成器输出（当前 `''`）逐字节锁定，且七套全过 `loadCompanyDirectory` 真实校验器；`industry-templates.test.ts`（行业包全树）与 `multifile.test.ts`（2 级全树）不读 `.gitkeep` 内容。**2 级 2 件与行业包 2 件没有内容断言**——263 字节的两件能通过，靠的是没有这条闸，不是设计允许（登记 W82-9）。
- **尺寸预算**：2–9 的 16 件 0 字节；行业包 2 件 ≤ 4 行注释（当前 3 行）。0 字节是 2–9 的设计约束，不是全族约束；其中 3–9 由逐字节对账锁定，2 级无内容闸。
- **迁移 / 兼容 / 回退**：目标不改。行业包只有 `reports/.gitkeep`：它们的 `docs/` 里有真实制度文本（赛季节奏/发布节奏），不需要占位。

**逐件**

##### .gitkeep 逐件

| F-ID | 路径 | 用途 |
|---|---|---|
| F-TPL-c2-docs-gitkeep | docs/.gitkeep | 保留空目录占位；0 字节 |
| F-TPL-c2-reports-gitkeep | reports/.gitkeep | 保留空目录占位；0 字节 |
| F-TPL-c3-docs-gitkeep | docs/.gitkeep | 保留空目录占位；0 字节 |
| F-TPL-c3-reports-gitkeep | reports/.gitkeep | 保留空目录占位；0 字节 |
| F-TPL-c4-docs-gitkeep | docs/.gitkeep | 保留空目录占位；0 字节 |
| F-TPL-c4-reports-gitkeep | reports/.gitkeep | 保留空目录占位；0 字节 |
| F-TPL-c5-docs-gitkeep | docs/.gitkeep | 保留空目录占位；0 字节 |
| F-TPL-c5-reports-gitkeep | reports/.gitkeep | 保留空目录占位；0 字节 |
| F-TPL-c6-docs-gitkeep | docs/.gitkeep | 保留空目录占位；0 字节 |
| F-TPL-c6-reports-gitkeep | reports/.gitkeep | 保留空目录占位；0 字节 |
| F-TPL-c7-docs-gitkeep | docs/.gitkeep | 保留空目录占位；0 字节 |
| F-TPL-c7-reports-gitkeep | reports/.gitkeep | 保留空目录占位；0 字节 |
| F-TPL-c8-docs-gitkeep | docs/.gitkeep | 保留空目录占位；0 字节 |
| F-TPL-c8-reports-gitkeep | reports/.gitkeep | 保留空目录占位；0 字节 |
| F-TPL-c9-docs-gitkeep | docs/.gitkeep | 保留空目录占位；0 字节 |
| F-TPL-c9-reports-gitkeep | reports/.gitkeep | 保留空目录占位；0 字节 |
| F-TPL-cg-reports-gitkeep | reports/.gitkeep | 保留目录占位 + 3 行报表落点/命名说明；263 字节 |
| F-TPL-ci-reports-gitkeep | reports/.gitkeep | 保留目录占位 + 3 行报表落点/命名说明；263 字节 |

表注：18 = 2–9 级各 2 件（16，均 0 字节）+ 两个行业包各 1 件（2，均 263 字节 / 3 行）。

#### 5.4.11 `docs/*.md`（2 件）

**族契约**

- **处置**：2 件目标保留，路径与内容不变。
- **归属**：04-§二 目录契约的 `docs/` 子树；行业包行业制度示例；`repo-validate.ts` 允许。
- **职责**：给行业包一份“非章程的运营制度”示例文本，示范 `docs/` 该放什么：赛季节奏（game）、发布节奏（internet）。
- **非职责**：不是 schema、不是可求值规则、不被校验器解析、不参与提示词组装（组装器只读 prompts/ 与 org-config）；与 charter 冲突时**以 charter 为准**，本类文件不能覆盖红线。
- **内部结构**：标题 + 分节散文（赛季周期、档期、灰度比例这类）。26 行。
- **导出 / 允许依赖**：无。
- **IO / 注入**：无；人读。
- **状态 / 并发 / 恢复**：无状态；增删走批示流（公司资产）。
- **失败 / 错误分类**：无机器校验；冲突靠人读裁定。
- **秘密边界**：无秘密；不得写真实运营数据/凭证。
- **证据 / 测试**：`industry-templates.test.ts`（文件在位、非空）；不证明内容被任何流程消费。
- **尺寸预算**：≤ 60 行；现 26。
- **迁移 / 兼容 / 回退**：目标不改；回退 = `git revert`。

**逐件**

##### docs/*.md 逐件

| F-ID | 路径 | 用途 | 行数 |
|---|---|---|---|
| F-TPL-cg-docs-赛季节奏 | docs/赛季节奏.md | 行业制度示例文本；与 charter 冲突以 charter 为准 | 26 |
| F-TPL-ci-docs-发布节奏 | docs/发布节奏.md | 行业制度示例文本；与 charter 冲突以 charter 为准 | 26 |

### 5.5 模板目标变更（全部未执行）

本节把 §5.3 矩阵里“目标替换内容”的 8 件与两条结构性缺口展开成可执行的变更描述。**以下没有一条已经发生**：当前 `templates/` 仍是 225 件原样，`org-config/v1` 字面量仍在 8 件里。

#### 5.5.1 schema 字面量迁移：8 件

现状：`packages/company/src/multifile.ts` 用 `ORG_CONFIG_SCHEMA_LITERALS = ['studio-next/org@1', 'org-config/v1']` 做**迁移期并集**校验，canonical 是 `studio-next/org@1`。3–9 级模板由生成器产出，已全部是 canonical；残留旧字面量的恰好 8 件：

| 模板 | 文件 | 现字面量 | 目标字面量 | 处置 |
|---|---|---|---|---|
| company-2-level | `org-config.yaml` | `org-config/v1` | `studio-next/org@1` | 替换内容 |
| company-2-level | `.studio-next.yaml` | `org-config/v1` | `studio-next/org@1` | 替换内容 |
| company-game | `org-config.yaml` | `org-config/v1` | `studio-next/org@1` | 替换内容 |
| company-game | `.studio-next.yaml` | `org-config/v1` | `studio-next/org@1` | 替换内容 |
| company-game | `README.md` | `org-config/v1` | `studio-next/org@1` | 替换内容 |
| company-internet | `org-config.yaml` | `org-config/v1` | `studio-next/org@1` | 替换内容 |
| company-internet | `.studio-next.yaml` | `org-config/v1` | `studio-next/org@1` | 替换内容 |
| company-internet | `README.md` | `org-config/v1` | `studio-next/org@1` | 替换内容 |

变更边界：

- 只改 `schema:` 行的值（README 只改正文里的字面量引用），**不改**任何结构、键名、部门/人员、jobs。
- 顺序：先 2 级 → 重生成 3–9（README 是共享资产，2 级改了必须传导，见 5.5.3）→ 再改 game/internet（行业包不经生成器，手改）。
- 收单：8 件都改完后，`ORG_CONFIG_SCHEMA_LITERALS` 才能收成单元素 `['studio-next/org@1']`。这是**代码改动**，归 82 波次；在收单前，并集校验仍接受旧字面量，旧公司目录不会被打破。
- **契约语料同批**：`packages/contract/cases.json` 的 dir 域 3 条 case 仍用 `org-config/v1`（第 66/86/108 行）；收单前必须同批迁移或保留并集，否则 `dir-cases.test.ts` 的 3 case 会红。契约改动归 01-contract 的实现单，本文只登记（W82-2）。
- 影响：`init` 用 2 级模板生成新公司，`init.ts` 的七处占位替换不含 schema 行，所以 2 级改 schema 不改变 init 行为；但 `multifile.test.ts` 对 2 级全树有断言，改后必须同批复核。
- 回退：`git revert` 8 件 + 重生成；并集校验保证回退期两侧都能通过。

#### 5.5.2 `framework_version` 仍留 null

10 份 `.studio-next.yaml` 的 `framework_version: null`，`init.ts` 明确不填。目标：**保持 null**，直到 migrate 单落地（框架版本写入 = 迁移动作，不是 init 动作）。本附录不把“已迁移”写成事实：现在没有任何代码在写这个字段。

#### 5.5.3 3–9 重生成铁律

- 3–9 级 7 套模板是 `packages/company/src/gen-template.ts` + `level-specs.ts` 的**生成物**；`gen-template.test.ts` 断言仓树逐字节等于 `renderLevelTemplate()` 输出，并锁死：目录契约、七处 init 占位恰一次、确定性、3–9 与 2 级共享资产（README/charter/prompts）同文、花名唯一、嵌套部门受检。
- 因此：**任何**对 `templates/company-2-level/README.md`、`charter.md`、`prompts/company.md` 的修改，都必须跟一次重生成，否则测试立刻红。org-config/部门/人员不共享，2 级改动不自动传导（生成器按 `level-specs` 自己产出）。
- 重生成入口**已存在**：`studio-next gen-templates`（`apps/daemon/src/cli/gen-templates.ts`；`apps/daemon/src/cli/main.ts:48 case 'gen-templates'`）与库函数 `regenerateLevelTemplates(outRoot)`（`gen-template.ts` 导出）。旧稿“缺 CLI、建议加 `gen:template`”的判断已过时，**W82-6 撤回**。根 `package.json` 是否再加一条 `gen:templates` 便捷脚本是可选优化，不是缺口。
- 顺序：改源 → 重生成 → `bun run test`（`gen-template.test.ts` 逐字节）→ 再跑 `guard:boundaries`（尺寸/平面不变，预期 0 违例）。

#### 5.5.4 行业包 `init` 通道：实测是**硬失败**，不是“可能不替换”

- `init.ts` 的七处占位分两类：**六处是 2 级字面量**——`slug: example-corp`、`name: 示例公司`、`# 示例公司（公司自述）`、`created_at: null`、`last_validated_at: null`、`last_validation: null`；**第 7 处是行级键**——`template: <值>`（`replaceTemplateKey`，值域不限模板名；这正是 3–9 级 init 能跑通的原因，D8 泛化）。`replaceOnce` 在“0 次或 ≥2 次”命中时抛 `configInvalid('init/template-placeholder-drift')`（`packages/company/src/init.ts:91-96`；行级键版本 `init.ts:105-117`），不产出半替换公司。
- 行业包的 slug/name 分别是 `game-corp`/`星火游戏工作室`、`internet-corp`/`星潮互联网公司`，README 标题也不是 `# 示例公司（公司自述）` → **第一条替换（`slug: example-corp`，`init.ts:197`）就 0 命中**，`init` 直接失败。行业包的 `template` 行值虽不同（`company-game`/`company-internet`），但那处是行级键，**不是**失败点。
- CLI 侧 `--template` 存在（`apps/daemon/src/cli/init.ts:12` 的 flag 白名单、`:24` 组装 `templateDir`），所以“能指定模板目录”与“能用行业包 init”是两件事。
- 证据：`init.test.ts` 只覆盖 2 级夹具与 5 级 `template` 行；行业包 e2e（`apps/daemon/test/cli/industry-templates.e2e.test.ts`）走 `company add <git-url>` 导入，**不覆盖 init**；行业 README 第 26 行自述“占位替换当前锚定 `company-2-level`，行业包走 init 对齐归后续单”。
- 处置：本文不改 `init.ts`；缺口登记 W04-1（04/43/51 定行业包 init 的占位契约），波次归 82。

#### 5.5.5 `plugins/` 与 `dependencies.yaml` 的 part 归属

§5.3 已登记：6 个插件文件是模板里唯一的可执行位，目标“待分离”；`dependencies.yaml` 留 definition part。未执行的部分：

- 分离后的物理路径未定（`plugins/` 是留在公司包内、还是变成独立能力包目录），需 76 的 part 索引与 82 的波次共同定。
- 导入流的安装根、`repo-validate` 的顶层封闭集、`gen-template` 的生成面都受此影响；在定案前**不动**这 8 件。
- `.d.ts` 伴生素材是否随插件分发，归 79/12；本附录不私定。
- 影响与回滚：不动的代价是“公司包含代码”这一事实继续存在；将来分离若做，回滚 = 路径回迁 + 同步 part 索引。

#### 5.5.6 变更汇总（与 §2 对齐）

| 类别 | 件数 | 对象 | 状态 |
|---|---:|---|---|
| 目标新增 | 3 | `scripts/guards/manifest-rules.mjs`、`manifests.mjs`、`manifests.test.mjs` | 未创建 |
| 目标替换内容 | 14 | 根 6（§2.3 前六行）+ 模板 8（5.5.1） | 未执行 |
| 目标拆分 | 0 已执行 / 6 登记 | 6 个 `plugins/**` 文件 | 未执行 |
| 目标退役 | 0 | — | — |
| 目标路径变更 | 0 | — | — |
| 内容保持 | 224 | 238 − 14 | 现状 |

复算：模板面 225 件中 8 件改字面量、217 件不动；根面 10 件中 6 件替换、4 件不动（`bun.lock` 为生成物，随 `bun install` 重写，不计替换；`CHANGELOG.md`、`LICENSE`、`.mise.toml` 不动）；guards 面现有 3 件不动。217 + 4 + 3 = 224 = 238 − 14。根件逐条理由见 §三，模板逐族理由见 §5.4。

### 5.6 模板矩阵总表（10 套）

| 模板 | 件数 | 部门 config | 人事档案 | 定时岗 | org 行数 | 最大路径深度 | schema | 来源 |
|---|---:|---:|---:|---:|---:|---:|---|---|
| `company-2-level` | 9 | 1 | 1 | 2 | 181 | 4 | `org-config/v1` | 手写（共享资产源） |
| `company-3-level` | 16 | 2 | 7 | 4 | 169 | 4 | `studio-next/org@1` | 生成 |
| `company-4-level` | 19 | 2 | 10 | 4 | 202 | 4 | `studio-next/org@1` | 生成 |
| `company-5-level` | 26 | 6 | 13 | 12 | 348 | 4 | `studio-next/org@1` | 生成 |
| `company-6-level` | 32 | 10 | 15 | 16 | 442 | 6 | `studio-next/org@1` | 生成 |
| `company-7-level` | 31 | 11 | 13 | 16 | 428 | 6 | `studio-next/org@1` | 生成 |
| `company-8-level` | 35 | 12 | 16 | 20 | 509 | 6 | `studio-next/org@1` | 生成 |
| `company-9-level` | 25 | 8 | 10 | 16 | 371 | 4 | `studio-next/org@1` | 生成 |
| `company-game` | 16 | 2 | 3 | 2 | 149 | 4 | `org-config/v1` | 手写行业包 |
| `company-internet` | 16 | 2 | 3 | 2 | 198 | 4 | `org-config/v1` | 手写行业包 |
| **合计** | **225** | **56** | **91** | **94** | — | — | — | — |

**件数算术（每套可复算）**

- 2–9 级：`5（org + meta + README + charter + prompts）+ 2（docs/reports 的 .gitkeep）+ 部门 config 数 + 人事档案数`。例：c2 = 5 + 2 + 1 + 1 = 9；c8 = 5 + 2 + 12 + 16 = 35。
- 行业包：`5 + 1（只有 reports/.gitkeep）+ 部门 config 数 + 人事档案数 + 1（dependencies.yaml）+ 3（插件三件）+ 1（docs 制度文本）`。例：game = 5 + 1 + 2 + 3 + 1 + 3 + 1 = 16。
- 10 套相加 = 9 + 16 + 19 + 26 + 32 + 31 + 35 + 25 + 16 + 16 = 225。

**跨套不变量与差异**

- 部门：2–9 级每个**根部门** 2 个定时岗（`health-patrol-*` + `daily-report-*`），嵌套子部门无 `jobs` 键；行业包每个部门 1 个岗（game：`game-feedback-patrol`/`game-build-smoke`；internet：`net-growth-daily`/`net-site-patrol`）。合计 94 岗。
- 嵌套：只有 c6、c7、c8 有第二层部门（c6 工程部下 项目群A/项目群B；c7、c8 事业部A/B 下的研发部/质量部），最大路径深度 6（`departments/A/departments/B/people/<工号>.md`）。
- 人数：1（c2）到 16（c8）；花名由命名器确定性生成，跨套不重复（`gen-template.test.ts` 断言）。
- 共享资产：README / charter / prompts 在 2–9 级之间**逐字节一致**（2 级为源；本次对 7×3 份做全量 `byteDigest` 比对，`sha8` 只作展示）。org-config / 部门 / 人员每套独立。
- schema：8 件仍是旧字面量（§5.5.1），且这 8 件都落在上表的 4 套手写模板里；7 套生成模板已全为 canonical。

**尺寸与预算（模板不在 guard 扫描面，靠本文约束）**

- 单文件最大 509 行（`company-8-level/org-config.yaml`），低于 600 阈；没有模板文件超 600。
- 目录直属最多 6 个非点文件（`company-4-level/departments/研发部/people/`），低于 25 阈。
- 两个行业包的 `plugins/` 各 3 文件，目录结构最深到 `plugins/<插件>/src/`（3 段）。
- 模板 225 件不受 BC-S1/S2 机械约束（`scopeDirs` 只含 `apps`、`packages`），这条预算属文档口径（§4.3.5）。

**这套矩阵不承诺什么**

- 不承诺 10 套结构互相可迁移：只有共享资产同文，org/部门/人员是各自独立的事实。
- 不承诺部门数=等级数：c9 是 9 级但只有 8 个部门；等级是公司等级，部门数是组织设计。
- 不承诺 jobs 与部门一一对应：行业包 1 部门 1 岗，2–9 级 1 部门 2 岗，数量关系不同。

## 六、测试与证据矩阵

### 6.1 证据分层与本文覆盖范围

AGENTS.md 第三节把测试分五层：契约（`packages/contract`）> 单测（core 纯函数）> 集成（fake YouTrack + fake CLI）> 端到端（真实单据）> 崩溃注入（5 个 kill 点）。本文的三类对象分别落在：

- **guards**：纯文件扫描，单测层（`boundaries.test.mjs` 自带夹具 + 真仓断言）。
- **模板**：`packages/company` 单测/集成层（解析、生成、导入、校验），加一条 daemon e2e（真实 clone + CLI + 一单 DISPATCH）。
- **根件**：几乎无专属测试——`package.json` 的脚本由人跑，`tsconfig` 由 `typecheck` 覆盖，README/AGENTS/CHANGELOG/LICENSE 无测试。

因此本节的证据强度是：模板结构 > guards 规则 > 根配置；**根文档没有任何机器证据**，任何“README 已纠偏”的说法只能靠 diff 审阅。

### 6.2 直接锚定本文对象的测试

| 测试文件 | 行数 | 覆盖 | fake / 真实边界 | 不证明什么 |
|---|---:|---|---|---|
| `scripts/guards/boundaries.test.mjs` | 293 | 基础件（`countLines`/`extractImportSpecs`/`packageOf`/`inScope`/`daemonLayerOf`/`resolveSpec`/`walkRepo`）；BC-V1..V4、BC-H1/H2、BC-S1/S2、BC-T1 逐规则红绿；真仓 0 违例；基线表与实仓一致 | 全 fake：临时目录造文件，不碰真仓（最后一条真仓扫描除外） | 不证明 import 图与 manifest 一致（那是目标 `BC-M1..M3` 的缺口，见 §四 4.2） |
| `packages/company/test/gen-template.test.ts` | 176 | 3–9 级全树逐字节等于 `renderLevelTemplate`；目录契约；七处 init 占位恰一次；确定性（两次渲染相同）；花名唯一；结构锚；3–9 与 2 级共享资产同文；嵌套部门受检 | 真实读取 `templates/`（只读），生成在内存 | 不证明 2 级模板本身合规（2 级走 `multifile`）；不证明行业包 |
| `packages/company/test/multifile.test.ts` | 439 | 2 级全树；`dept/dangling`/`dept/orphan`/`dept/leader-dangling`；`people/dangling`/`people/orphan`/`file-id-mismatch`/`id-mismatch`；六节弱校验；`charter/dangling`；meta 必备与形状；`strictObject` 未知键 | 真实读取 2 级模板 + 注入变异副本 | 不证明 3–9 的每个部门/人员都过同一套规则（它们只有生成器断言与 e2e 冒烟） |
| `packages/company/test/industry-templates.test.ts` | 217 | 行业包全树；jobs 的 cron/节奏；行业资产（charter/prompts/docs）；顶层封闭集；无 exec 位、无符号链接；插件三件形态；依赖求值可达 | 真实读取 `templates/company-{game,internet}` | 不证明 dsh 能加载插件；不证明 `dsh-loc-lint`/`dsh-metrics-board` 可获取（包内无源） |
| `packages/company/test/init.test.ts` | 288 | init 全链；5 级模板；`template` 行漂移（`init/template-placeholder-drift`）；spawn 冒烟 | fake：临时目录 + 假 git | 不证明行业包 init 的占位替换（已知缺口，见 5.5.4） |
| `packages/company/test/jobs-loading.test.ts` | 420 | 2 级 jobs 装载；cadence 五档；sla/escalate/outputs；形状闸 | 真实读取 2 级模板 | 不证明 3–9 的 jobs 集合与 org-config 一致（无此校验） |
| `packages/company/test/repo-validate.test.ts` | 766 | A–E 组：顶层封闭集、`.AIWS` 两面禁、`.studio-next` 源面禁/产物面豁免、面语义、共用核 | 注入目录内容（不落盘） | 不证明导入流真的拒绝（那是 `git-import` 的面） |
| `packages/company/test/git-import.test.ts` | 469 | `company add` 全链；剥离钩子；`.AIWS`；升级/幂等 | fake git + 临时目录 | 不证明真实远端仓库的边界（e2e 才碰真 clone） |
| `packages/company/test/company-validate-cli.test.ts` | 185 | CLI exit 0/1/2；`--json`；`--allow-extra`；tarball；git-url | fake：临时目录 | 不证明大目录性能 |
| `packages/company/test/dependencies.test.ts` | 505 | schema、绑定域、版本两形态与求交、install/missing/conflict、指纹幂等、确认拒=零落盘 | 注入插件根 + 假源 | 不证明 npm/registry 外部源（v1 未落位） |
| `packages/company/test/deps-cases.test.ts` | 39 | 契约 deps 域的用例表驱动 | 纯数据 | 同上层 |
| `packages/company/test/dir-cases.test.ts` | 71 | 契约 dir 域 3 条 case 全绿 + 校验器定位（文件:行：`org-config/missing-field`→第 3 行、`level-count-mismatch`→第 8 行、`dangling-ref`→第 12 行、`yaml-syntax`、`missing-file`） | 真实 `runCases` + 内存目录 | 不证明 3–9 每套模板都过同一组规则 |
| `packages/company/test/namer.test.ts` | 70 | 花名确定性（`fnv1a` + `mulberry32`） | 纯函数 | 不证明花名“好听”或唯一性跨模板（唯一性在 gen-template） |
| `apps/daemon/test/cli/industry-templates.e2e.test.ts` | 231 | 真实 clone 行业包 + CLI + 一单 DISPATCH | 真实：clone 模板树、调 CLI | 不证明插件在 dsh 中被加载；不证明多单并发 |

旁证（不是本文对象的契约）：`packages/panel/test/overview*.test.ts`（7 个文件共 1916 行，最大 `overview.test.ts` 515 行）把 2 级模板当 fixture 渲染公司概览。它们红了说明面板读目录的形状变了，不说明模板错了——方向不能反推。

### 6.3 校验/生成 helper 清单

| 函数 | 位置 | 用途 | 主要使用方 |
|---|---|---|---|
| `loadCompanyDirectory` | `packages/company/src/validator.ts` | 读目录树 → 文件表 + 解析结果 | `multifile`、`repo-validate`、daemon 挂载 |
| `readDirectoryFiles` | `packages/company/src/init.ts`（导出，async） | 递归读文件为 `Record<path, string>`（跳过符号链接与二进制，一律 utf8） | `init`、挂载壳、内容指纹 |
| `lineOfPath` | `packages/company/src/multifile.ts` | YAML 节点 → 文件行号（issue 定位） | 全部目录类 issue |
| `zodIssuesToDirectoryIssues` | `packages/company/src/multifile.ts` | zod 错误 → `DirectoryIssue`（带行号/规则号） | 各 schema 校验 |
| `multifileRules` | `multifile.ts` | 跨文件规则总入口（部门双检、人员双检、charter、meta） | `multifile.test`、`init`、`git-import` |
| `validateCompanyRepo` | `repo-validate.ts` | 顶层封闭集 + 面语义 | CLI、导入流 |
| `renderOrgConfig` / `renderMeta` / `renderDeptConfig` / `renderPersonFile` | `gen-template.ts`（内部，不导出） | 3–9 各件文本渲染 | `renderLevelTemplate` |
| `renderLevelTemplate` / `writeLevelTemplate` / `regenerateLevelTemplates` | `gen-template.ts`（导出） | 渲染/落盘/批量重生成 | `gen-template.test`、维护脚本 |
| `selfCheck` | `gen-template.ts`（内部） | 生成结果结构自洽断言 | `renderLevelTemplate` 末尾 |
| `assertLevelSpec` | `level-specs.ts` | 级别规格合法性（部门/人数/岗位自洽） | 生成器入口 |
| `baseTemplateDir` | `gen-template.ts` | 定位 `templates/` 根 | 渲染 + 测试 |
| `codenames` / `fnv1a` / `mulberry32` | `namer.ts` | 确定性花名 | 生成器、`namer.test` |
| `rootDepartments` | `packages/company/src/level-specs.ts` | 从级别规格取根部门（parent=null） | 模板断言、生成器 |
| `parseDependencies` / `safeParseDependencies` | `dependencies.ts` | 依赖清单解析（严格/安全） | 导入流、`dependencies.test` |
| `extractPersonAttrs` | `dependencies.ts` | 从 **org-config 的 `people[]`** 取绑定属性（role/dept/level/skills/executor/status）；入参是 `orgConfigSrc: string`，不读人事档案 | `planPluginInstalls` |
| `planPluginInstalls` | `dependencies.ts` | 零 IO 纯决策：依赖 × 人员 × 已装 × 源 → 安装计划 | daemon、契约 deps 域 |
| `satisfiesSpec` | `dependencies.ts` | 版本约束满足（caret/精确、`^0.x` 锁 minor） | 计划合并 |
| `materializeCompanyRepoInput` | `git-import.ts` | 输入源（目录/tarball/git-url）→ 统一目录 | `company add`、CLI |
| `importCompanyRepo` / `companyAddGitUrl` / `deriveDirNameFromGitUrl` | `git-import.ts` | 导入主流程/远端/目录名推导 | CLI、e2e |
| `initCompany` | `init.ts` | 模板 → 新公司（复制、七处占位、首 commit） | CLI、`init.test` |

### 6.4 本次实跑与未跑

已跑（本附录核对期间）：

```
$ node scripts/guards/boundaries.mjs
边界门禁 PASS：扫描 627 文件（范围面代码件 499），0 违例
exit 0
```

运行环境：`node v25.6.1`（非 `.mise.toml` 钉死的 24.21.0）；`bun` 不存在（`command not found`）。

未跑，且不得据此宣称：`bun run typecheck`、`bun run test`（vitest 全套）、任何包级 `typecheck`、任何 daemon/面板/API 服务、任何真实 YouTrack 交互、任何 dsh 插件安装或加载、任何 schema 迁移或 part 分离。原因之一是本机无 bun；即使有，本文也未把这些命令列为本次核对动作。

### 6.5 证据强度的诚实结论

- 模板 3–9 的结构有**逐字节**证据（强）；2 级有**逐规则**证据（强）；行业包有**形态 + 可达性**证据（中）。
- 模板的**语义**（部门 jobs 是否该这样排、汇报线是否合理）没有机器证据，属审查面。
- guards 的现有 4 类规则有红绿夹具（强），但**不覆盖 manifest**——这正是 §四 目标新增三件的理由。
- 根文档（README/AGENTS）无证据，任何“已纠偏”都需要人读 diff。

## 七、跨文件与跨卷边界

### 7.1 谁写谁读

| 对象 | 写入者 | 读取者 | 禁止 |
|---|---|---|---|
| 根 `package.json` / `tsconfig*` | 框架维护者（人） | bun/tsc/vitest、开发者 | daemon 运行期改写 |
| `scripts/guards/**` | 框架维护者（人） | `bun run test` 前置、CI | daemon 运行期改写 |
| `templates/**` | 框架维护者（人）；3–9 由生成器写 | `init`（复制）、测试、文档 | daemon 运行期写模板；公司运行期回写模板 |
| 公司目录（模板的产物） | daemon（唯一写入者） | daemon、面板、组装器 | worker 直写；模板与实例混用同一路径 |

模板是**只读脚手架**：`initCompany` 复制后，实例与模板再无连接（没有 symlink、没有 include）。因此改模板不会影响已存在的公司；已存在的公司要迁移只能走 migrate（未落地，见 5.5.2）。

### 7.2 卷间引用关系

- **76**：本文的模板 F-ID 与 76 的 `DEF-PKG-01` 资产族对齐；`DEF-PKG-02/03`（part 索引、definition-only 子集）的**物理落盘**在 76 未定，本文只登记缺口。
- **77**：模板字段（org-config 的 people/departments/jobs、档案 front-matter）与 77 的数据模型条目对应；本文不重复数据模型定义，只写文件形态。
- **78**：`BIND-WS-01` 的 D1（公司目录是数据包、可执行走能力包）是 6 个插件文件待分离的上位依据；`BIND-WS` 的能力安装根路径未定。
- **79**：根配置的每条替换都能追到 79 的 D 号（D1/D2/D3/D4/D5/D9/D10/D14）与 §10.1/§10.3/§11.1；manifest guard 三件的**规则语义**在 79-§10.3，**文件落盘**在本文。
- **80**：`daemon` 脚本目标形态（`node apps/daemon/src/cli/main.ts serve`）来自 80-§3.2；模板的泳道/jobs 被 80 的调度读取；`ServeConfig.external` 的键集（`enabled/port/lan/token/requestsPerMinute/idempotencyTtlMs/allowedSources`，`allowedSources` 缺省 `['external-api']`）由 80-§3.3 定义，本卷根件不承载该配置。跨卷目标件（§2.5）的接口一律以 80 的端口名/资产号为准，本卷不复述、不另造第二套。
- **82**：所有替换动作的**波次与证据**归 82；本文只给顺序与回滚（§八）。
- **引用约定**：80 的 §6.6 是一节跨多端口（效果/证据/验收/记忆/观察/绑定/迁移/通知/对外提交）的合并节，77 也有 §6.6（证据记录族）。指向具体对象时**同时写端口名或资产号**（如 `TS-PORT-API-01`、`TS-PORT-RULE-01`、`BIND-01`），不只写“§6.6”。

### 7.3 本文不覆盖的面

- `apps/daemon`、`packages/*` 的内部文件（各自的 81 分卷）。
- `.github/`、CI 配置（本仓当前无）。
- `node_modules/`、`.VSCodeCounter/`（非源件）。
- `docs/` 下除本卷外的文档（其余 75–82 分卷）。

### 7.4 已知的“文档与代码不一致”，本文按代码为准记录

| 位置 | 说法 | 实际 | 处理 |
|---|---|---|---|
| `packages/company/src/multifile.ts` 头注 ⑤ | 称模板 jobs 清单与 org-config 不一致 | 10 套模板逐一核对，部门 config 的 jobs 集合与 org-config jobs 集合 **56/56 完全一致**；但**无闸**（`multifile.ts` 不校验集合相等） | 陈旧注释；数据一致≠有校验（W04-2）；本文不改代码，登记为需回写（§九） |
| 根 `README.md` 包列表 | 只列 10 个目录（9 个 `packages/*` + `apps/daemon`） | 实际 17 个 workspace 目录；缺 `apps/boot`、`packages/dsh-bridge`、`gateway`、`localplatform`、`matrix`、`studio-tools`、`taiga` 七个 | 79-D4/D5；目标替换内容 |
| 根 `README.md` / `AGENTS.md` | `store` = `node:sqlite + drizzle` | drizzle 已移除（79-D4/D5） | 同上 |
| 根 `README.md` / `AGENTS.md` | `packages/api` = `:8788` 对外 API | 外部面现落 `packages/panel/src/external`；`packages/api` 是 43 行骨架（`PACKAGE_STATUS='skeleton'`）；80-§9.4 目标在 `apps/daemon/src/assembly/api` | 目标替换内容；最终归属由 14-api/17-daemon 回写 |
| 根 `package.json` `daemon` 脚本 | `node apps/daemon/src/index.ts` | 80-§3.2 目标 `node apps/daemon/src/cli/main.ts serve` | 目标替换内容 |
| `CHANGELOG.md` v0.1–v0.10 | 历史条目 | 不能当现状证据 | 只读；本文不引用为“已实现”证明 |

## 八、迁移顺序与回滚

以下顺序是**建议的执行序**，全部未执行。每一步都假设前一步绿；任一步红则停手，不带病进入下一步。

### 8.1 第一批：根依赖清理（对应 §三 根件替换）

1. 分类 `packages/panel` → `packages/company` 的依赖（是运行时还是仅类型）。
2. `apps/daemon` 的 `simple-git` 移入 devDependencies；删 `packages/adapters` 的 `simple-git`（若确认无引用）。
3. 处理 `apps/daemon` 的 `execa`/`zod` 与 `packages/api` 的装饰性依赖（79-§10.1 的死依赖清单）。
4. 每次改完跑 `bun install` 重生成 `bun.lock` + `bun run typecheck`。
5. 清理全部完成后，才把 manifest guard 串进 `bun run test`。

回滚：`git revert` 对应 commit + `bun install`。`bun.lock` 必须与 `package.json` 同 commit 变化，不手工合并。

### 8.2 第二批：manifest guard 三件（对应 §四 4.2）

1. 先写 `manifest-rules.mjs`（纯数据：扫描面、检查字段、忽略说明符）。
2. 写 `manifests.mjs`（执行 + CLI 0/1/2），用夹具跑红绿。
3. 写 `manifests.test.mjs`：夹具逐规则红绿 + 清理后的真仓 0 违例。
4. **不**在 8.1 完成前接入 `test` 脚本——否则真仓死依赖会让测试常年红，重演“测试绿但没人在看”。

回滚：三件是新增文件，删除即回退；不触碰现有 `boundaries.mjs`。

### 8.3 第三批：模板 schema 迁移（对应 5.5.1）

1. 改 `templates/company-2-level/org-config.yaml` + `.studio-next.yaml` 的 `schema` 值。
2. 重生成 3–9（`studio-next gen-templates` 或 `regenerateLevelTemplates`），确认零 diff 之外只有预期变化。
3. 跑 `gen-template.test.ts` + `multifile.test.ts` + `init.test.ts`。
4. 改 `company-game` 与 `company-internet` 的 org/meta/README 共 6 件。
5. 跑 `industry-templates.test.ts`。
6. 同批迁移 `packages/contract/cases.json` 的 dir 域 3 例（否则收单后 `dir-cases.test.ts` 红；契约改动归 01-contract）。
7. 8 件 + 契约语料全绿后，才把 `ORG_CONFIG_SCHEMA_LITERALS` 收成单元素（代码改动，归 82）。

回滚：并集校验允许新旧并存，所以任一步都可以 `git revert` 而不打破已存在的公司目录；收单那一步回滚 = 恢复并集。

### 8.4 第四批：行业包 part 分离（阻塞）

阻塞条件：76 的 part 索引文件名、78 的能力安装根路径、82 的波次三者未定。在定案前**不动** 6 个插件文件与 2 份 `dependencies.yaml`。本文不假设分离形态，也不建议“先拆了再说”。

### 8.5 第五批：根文档纠偏（README/AGENTS）

排在代码与模板之后：文档描述的是最终形态，先改文档会让中间状态自相矛盾。改完用 diff 审阅 + 人读核对，无自动证据。

### 8.6 全局回滚原则

- 一律 `git revert`，不 `reset --hard`、不 force push（AGENTS §五.7）。
- 模板回滚后必须重生成 3–9，否则逐字节断言红。
- 依赖回滚后必须 `bun install`，否则 lock 与 manifest 不一致。

## 九、需回写清单（本文不私造公共概念）

以下每条都是“本文发现、但归属别的卷”的缺口。本文只登记，不改写 75–82 其余分卷，也不替它们做决定。

### 9.1 需回写 76（资产族与 part）

| 编号 | 缺口 | 建议落点 |
|---|---|---|
| W76-1 | 76 的 `DEF-PKG-01` 只到“资产族”粒度，未列 10 套模板的 225 件承载；本文的 `F-TPL-*` 是文件级下钻，需 76 承认这一层 | 76 的资产族表加“文件级承载见 81-files/19” |
| W76-2 | `DEF-PKG-02/03` 的 part 索引**文件名与物理路径**未定，导致 6 个插件文件与 2 份 `dependencies.yaml` 的归属悬空 | 76 给出 part 索引清单与目录约定 |
| W76-3 | 2 级模板的 README/charter/prompts 是 3–9 的共享源（生成器同文派生），76 未登记这一“源—派生”关系 | 76 的资产族注明共享源与生成物 |
| W76-4 | 76-§2.5 把 `rule-profile` 列为公司定义对象，但模板 225 件里没有任何承载（`find templates -iname '*rule*'` 零命中） | 76 定 `rule-profile` 的承载文件/目录；82 排波次。本文不私定路径 |
| W76-5 | 模板 `org-config.yaml` 没有公司时区/偏移字段，jobs 的 cron 注释写“制作人机器本地时区”；80-§4.1 要求公司本地日由公司目录显式声明的时区决定（`CompanyZone`），不得读宿主时区 | 76 定时区字段名与 schema；77/80 定 `cron` 与 `companyDayKey` 的接法；82 排迁移波次 |

### 9.2 需回写 79（类型门禁与 guard 口径）

| 编号 | 缺口 | 建议落点 |
|---|---|---|
| W79-1 | “`test/` 未进类型门禁”的口径要改：根 `tsconfig.json` 不含 `test/` 目录，但含 `src/**/*.test.ts`（当前 32 件）；`adapters`/`core`/`dsh-bridge`/`prompt` 四个包的包级 `tsconfig.json` 已含 `test/**/*.ts`，由各自脚本承接。真正缺口是 `test/` **目录**（全仓 177 件 `.ts`，其中 `apps/daemon/test` 86 件，79-D10），不是“17 包全串”；根串接按 79-§4.4 只对已切包（切换集当前为空，首批候选见 79-§6.5，用显式包列表或 `--filter`，禁通配）（§3.4） | 79-D10 保留“`test/` 门禁”原义（§4.4 的已切包串接形态已定，不在 D10 重定）；两件事不合并 |
| W79-2 | `execa` 版本口径（D9）与根 `package.json` 现状的差异需要一条明确目标值 | 79-D9 补具体版本或“移除”结论 |
| W79-3 | manifest guard 的 CLI 退出码语义（0 通过 / 1 违例 / 2 输入错）未在 79 定义 | 79-§10.3 补退出码约定 |
| W79-4 | 插件 `.d.ts` 伴生是否随插件分发（影响 6 个插件件的目标形态） | 79 或 12 定口径 |
| W79-5 | 构建轨只有目标配置与判据（79-§5.2/§5.6），**没有根层 `build` 脚本形态**、也没有“首批切换哪些包”的清单；而 79-§5.2 又说落位命名归 81——本文只能给规则（`packages/<pkg>/tsconfig.build.json`），不能给包清单 | 79 补根脚本形态与首批包清单；81 各包分卷补各自构建件 |

### 9.3 需回写 80（脚本与基线）

| 编号 | 缺口 | 建议落点 |
|---|---|---|
| W80-1 | `daemon` 脚本目标已定 `node apps/daemon/src/cli/main.ts serve`，但根 `package.json` 仍是 `src/index.ts`；需 80 与实现单对齐 | 80-§3.2 保持，82 落改动 |
| W80-2 | `daemonSrcRootFiles=["index.ts"]` 是边界基线的一部分；`index.ts` 退役后基线要变，**改基线属提案流**（20-§十五） | 80 记录提案，guards 基线随提案改 |
| W80-3 | 模板 `jobs[].budget_cap` 是 YAML 数字（USD/次）；80-§4.1 `TS-SCALAR-04/09` 规定公共金额用 `DecimalString` + 显式币种，`Money.usd:number` 只作内存计算。模板值进入 `REC-*`/API 的换算点未在 76/77 写明 | 80 补“配置数字→DecimalString”的边界规则；77 补记录字段类型；本文不改模板值 |

### 9.4 需回写 82（波次与证据）

| 编号 | 缺口 | 建议落点 |
|---|---|---|
| W82-1 | 根依赖清理的四步（panel→company 分类、daemon simple-git→dev、adapters 去 simple-git、execa/zod/装饰依赖）需要波次与证据 | 82 逐波次列命令与 exit 码 |
| W82-2 | 模板 schema 迁移 8 件的 diff 证据 + `ORG_CONFIG_SCHEMA_LITERALS` 收单时点；**契约语料** `packages/contract/cases.json` 的 dir 域 3 例仍用 `org-config/v1`，收单前须同批迁移或保留并集 | 82 迁移波次（契约改动归 01-contract） |
| W82-3 | manifest guard 三件的创建、夹具、接入 `test` 的时点（必须晚于依赖清理） | 82 guard 波次 |
| W82-4 | part 分离波次（阻塞于 76/78） | 82 占位，不排期 |
| W82-5 | README/AGENTS 纠偏无自动证据，需要“人读 diff + 记录”的验收方式 | 82 文档波次 |
| ~~W82-6~~ | **撤回**：原判断“重生成入口缺 CLI”已被实测推翻——`studio-next gen-templates` 已存在（`apps/daemon/src/cli/gen-templates.ts`，`main.ts:48`） | 不成立；根脚本 `gen:templates` 仅为可选优化 |
| W82-7 | 构建轨（79-§5）没有任何仓内证据：`tsconfig.build.json` 0 份、`dist` 不存在、五条判据未跑；需要波次与命令（含 `--listFiles` 拓扑断言与产物指纹） | 82 构建波次（在 79 定根脚本后） |
| W82-8 | 类型门禁分两件事：① 已切包的根串接（切换集当前 0 个；首批候选 4 个，以 79-§6.5 为准；显式列表或 `--filter`，禁通配）；② `test/` 目录门禁（79-D10）。两者分开立项，不合成“17 包全串” | 82 门禁波次（①依 79-§4.4；②依 79-D10） |
| W82-9 | 行业包 2 份 `reports/.gitkeep` 是 263 字节 / 3 行，不是空文件；行业包测试与 2 级全树测试不读 `.gitkeep` 内容（3–9 的 14 件由逐字节对账锁定为生成器输出 `''`） | 82 决定是否收窄为 0 字节或补“仅注释”断言；模板改动归 04/43 |
| W82-10 | `.gitignore` 是否纳入 `run/daemon.sock`（80-§11.4.1）与 `var/`（README Quickstart 的 `var/daemon.yaml`）取决于部署形态 | 82/部署卷裁定；本文只列候选 |

### 9.5 需回写 04 / 43 / 51

| 编号 | 缺口 | 建议落点 |
|---|---|---|
| W04-1 | 行业包 `init` 通道未对齐：`init.ts` 的七处占位锚定 `company-2-level`；行业包传入后**第一条占位就 0 命中**，`init` 抛 `init/template-placeholder-drift` 硬失败（§5.5.4） | 04-§二 或 43 行业包章节 |
| W04-2 | 人事档案 front-matter 与 org-config `people[]` 索引的重复字段只有 `id` 有闸（`people/id-mismatch`）；`name/login/level/dept/role/skills/status/reports_to` 无校验。本次实测 91/91 一致，但漂移不会被发现 | 04-§二 补“哪些字段是索引权威、哪些是档案权威”，或明确允许双写并加闸 |
| W43-1 | `dependencies.yaml` 的 part 归属需与 76 同口径（本文按 5.5.5 留 definition part） | 43-§四 补一句归属 |
| W51-1 | 若 part 分离改变插件形态（如加 `exports`/`files`），51-D-4 的形态闸需复核 | 51-D-4 |

### 9.6 已核对一致、不需回写

- 04-§二 的部门配置键与人事档案六节，与 10 套模板实形一致。
- 34-§3.1/3.2 的 DSH 插件形态（ESM 具名导出 + `dsh.bundle` + patch insert）与 6 件样本一致。
- 43-§四 与 51-C-7/D-1..D-4 的版本两形态、`^0.x` 锁 minor、缺源 missing 不阻断，与 `dependencies.ts` 实现一致。
- `packages/company/src/multifile.ts` 头注 ⑤ 的“jobs 清单不一致”是**陈旧注释**：10 套模板逐一核对后，部门 config 的 jobs 集合与 org-config **56/56 完全一致**。建议随下次改动顺手删注（属代码改动，不在本附录范围）。注意：一致是数据事实，**没有闸**（W04-2 同类缺口）。

## 十、未证与不能宣称

本文的证据边界必须明说，避免下游把“文档写完”误读为“能力已验证”。

1. **未跑类型门禁与测试**：`bun run typecheck`、`bun run test`（vitest 全套）在本附录编写期间均未执行；本机为 `node v25.6.1` 且**无 bun**。唯一实跑是 `node scripts/guards/boundaries.mjs`（PASS，627 文件/499 范围代码件/0 违例/exit 0），且它跑在非钉死的 24.21.0 运行时下。
2. **未验证 DSH 真机**：6 个插件样本的 `apply` 是否被真实 dsh 加载、`cordis.patch.yml` 的 insert 是否被接受，均未证。
3. **行业包 init 是已知硬失败，不是“未证”**：`init.ts` 的占位锚定 2 级字面量，game/internet 第一条替换即 0 命中 → `init/template-placeholder-drift`（§5.5.4）。没有任何运行证明它能成功，因为代码路径上就不会成功。
4. **manifest guard 不存在**：`BC-M1..M3` 三件是目标设计，未创建、未跑红绿；§4.2 的五包“已知违例”是**读 manifest 与 import 的静态观察**，不是 guard 输出。
5. **schema 迁移未执行**：8 件模板仍是 `org-config/v1`；契约 `cases.json` 的 dir 域 3 例也是；`ORG_CONFIG_SCHEMA_LITERALS` 仍是并集。
6. **part 索引未定**：6 个插件文件与 2 份 `dependencies.yaml` 的最终归属未定；本文的“待分离”不是计划，是登记。
7. **部门 jobs 一致性无闸**：现状 56/56 完全一致（本次 `yaml` 解析核对），但 `multifile.ts` 不校验这一点；将来漂移不会被发现。
8. **`status` 枚举未校验**：档案 `status` 是自由字符串，`active|paused|retired` 只是注释约定。
9. **汇报线悬空未校验**：`reports_to` 指向不存在工号时不会报错；本次核对 91 份无悬空，但这是数据事实。
10. **根文档无证据**：README/AGENTS 的纠偏只能人读 diff。
11. **构建未验证**：仓内没有 `tsconfig.build.json`、没有 `dist`、没有 `build` 脚本；79-§5.6 的五条判据（含 `--listFiles` 拓扑与产物指纹）一条都没跑。本文只登记规则与落位，不能读作“可构建/可分发”。
12. **包级门禁未执行**：根 `typecheck` 只跑根 program；17 个包级 `typecheck`（其中 4 个含 `test/`）本次一条都没运行。
13. **不宣称全卷 PASS**：本文只完成“逐文件技术设计”这一交付形态；不代表 81 其余分卷完成，也不代表 75–82 一致。
14. **`.gitkeep` 内容在 2 级与行业包无闸**：行业包 2 件是 263 字节 / 3 行，2 级 2 件也无内容断言，相关测试不读其内容；3–9 的 14 件由全树逐字节对账锁定为生成器输出（当前空）（W82-9）。

## 附录 A：复算命令

以下命令只读，可在仓库根直接跑，用于核对本文数字。

```bash
# 现有件总数（本文范围）：根 10 + guards 3 + 模板 225 = 238
find . -maxdepth 1 -type f \( -name 'package.json' -o -name 'tsconfig*.json' -o -name '.mise.toml' \
  -o -name '.gitignore' -o -name 'bun.lock' -o -name 'README.md' -o -name 'AGENTS.md' \
  -o -name 'CHANGELOG.md' -o -name 'LICENSE' \) | wc -l        # 10
find scripts/guards -type f -name '*.mjs' | wc -l               # 3
find templates -type f | wc -l                                  # 225

# 模板 225 的分类
find templates -type f -name 'config.yaml' -path '*/departments/*' | wc -l   # 56（部门配置，含嵌套）
find templates -type f -path '*/people/*.md' | wc -l                        # 91
find templates -type f -name '.gitkeep' | wc -l                             # 18
find templates -type f -name 'org-config.yaml' | wc -l                      # 10
find templates -type f -name '.studio-next.yaml' | wc -l                    # 10
find templates -type f -name 'README.md' | wc -l                            # 10
find templates -type f -name 'charter.md' | wc -l                           # 10
find templates -type f -name 'company.md' | wc -l                           # 10
find templates -type f -name 'dependencies.yaml' | wc -l                    # 2
find templates -type f -path '*/plugins/*' | wc -l                          # 6
find templates -type f -path '*/docs/*.md' | wc -l                          # 2

# 旧 schema 字面量残留（应为 8 件）
grep -rl "org-config/v1" templates | wc -l                                  # 8
grep -rl "org-config/v1" packages/contract/cases.json | wc -l              # 1（dir 域 3 例同批迁移）

# jobs 94：不能用 grep '^  - id:'（会混入 people[]）
grep -h '^    cron:\|^    triggers:' templates/*/org-config.yaml | wc -l     # 94

# .gitkeep：16×0 字节 + 2×263 字节 / 3 行
find templates -name .gitkeep -size 0c | wc -l                             # 16
find templates -name .gitkeep -size +0c | wc -l                            # 2
wc -c templates/company-{game,internet}/reports/.gitkeep                   # 263 263
wc -l templates/company-{game,internet}/reports/.gitkeep                   # 3 3（末行有换行）

# 共享资产逐字节一致：每个文件跨 2–9 级应只有 1 个哈希
for f in README.md charter.md prompts/company.md; do
  shasum -a 256 templates/company-2-level/$f templates/company-{3,4,5,6,7,8,9}-level/$f | awk '{print $1}' | sort -u | wc -l
done                                                                      # 1 / 1 / 1

# rule-profile 承载：0
find templates -iname '*rule*' | wc -l                                    # 0

# 模板目录直属最大件数（应 6，company-4-level/departments/研发部/people/）
find templates -type f | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn | head -3

# 迁移期并集校验
grep -n "ORG_CONFIG_SCHEMA_LITERALS" packages/company/src/multifile.ts

# 构建面现状：0 份构建配置、无 dist、无 build 脚本
find . -name 'tsconfig.build.json' -not -path './node_modules/*' | wc -l   # 0
ls -d dist 2>/dev/null || echo "no dist"
grep -c '"build"' package.json                                            # 0
grep -c '^dist$' .gitignore                                               # 1（已有）

# 类型门禁分面：含 test 的包级 tsconfig 应 4 份
for f in apps/*/tsconfig.json packages/*/tsconfig.json; do
  grep -q 'test/\*\*/\*.ts' "$f" && echo "$f"
done | wc -l                                                              # 4

# 基线复算：逐条比对基线与实测（输出 cap / actual / 余量 / 文件）
node -e "const fs=require('node:fs');import('./scripts/guards/boundary-rules.mjs').then(m=>{for(const [f,c] of Object.entries(m.lineBaseline)){const n=fs.readFileSync(f,'utf8').split('\n').length-1;console.log(c,n,c-n,f)}})"

# 每套模板件数（应 9/16/19/26/32/31/35/25/16/16）
for d in templates/*/; do printf '%s %s\n' "$(find "$d" -type f | wc -l)" "$d"; done

# 边界门禁（本文唯一实跑）
node scripts/guards/boundaries.mjs
```

分类相加：56 + 91 + 18 + 10 + 10 + 10 + 10 + 10 + 2 + 6 + 2 = 225。

## 附录 B：F-ID 索引与检索约定

- 命名：`F-ROOT-*`（根件）、`F-GUARD-*`（guards）、`F-TPL-<tag>-*`（模板）。`<tag>` ∈ `c2|c3|c4|c5|c6|c7|c8|c9|cg|ci`。
- 模板 F-ID 后缀按族：`-org`、`-meta`、`-readme`、`-charter`、`-prompts`、`-dept-<部门>`、`-person-<工号>`、`-deps`、`-plugin-<插件>-pkg|patch|index`、`-docs-gitkeep`、`-reports-gitkeep`、`-docs-<文档名>`。
- 稳定性：F-ID 一经发布不复用；文件退役后 ID 作废不回收（与 §2.1“路径变更 0”一致）。
- 检索：`grep -n '^| F-' docs/81-files/19-root-guards-templates.md` 可列出全部模板表行；根件与 guards 是 `####` 条目而非表行，用 `grep -n '^#### F-'` 检索。
- 本文的 F-ID 只在本分卷与 81 总卷索引中有意义；不进入 76/77 的公共记录，也不作为契约编号。
- **本卷不新造跨卷 F-ID**：`contract/src/ports/intent.ts`、`contract/src/ports/secret.ts`、`contract/src/secrets.ts`、`core/src/work-readiness.ts`、`daemon/src/assembly/intent/{ingress,receipt-store}.ts` 的 F-ID 归 01/02/17，本卷只在 §2.5 写一致性约束。
- 跨卷引用一律带端口名/资产号（如 `TS-PORT-API-01`、`TS-PORT-RULE-01`、`BIND-01`），不只写 `§6.6`（80 与 77 都有 §6.6）。

## 附录 C：238 件分解对照

| 组 | 件数 | 明细 | 本文位置 |
|---|---:|---|---|
| 根配置 | 6 | `package.json`、`tsconfig.json`、`tsconfig.base.json`、`.mise.toml`、`.gitignore`、`bun.lock` | §三 |
| 根文档 | 4 | `README.md`、`AGENTS.md`、`CHANGELOG.md`、`LICENSE` | §三 |
| guards 生产 | 2 | `boundary-rules.mjs`、`boundaries.mjs` | §四 4.1 |
| guards 测试 | 1 | `boundaries.test.mjs` | §四 4.1 |
| 模板 | 225 | 见附录 A 分类 | §五 |
| **合计** | **238** | | |

目标：238 + 新增 3 = 241；替换内容 14 不增减总数；拆分/退役/路径变更均为 0。

跨卷登记 6 件（§2.5）**不计入** 238/241：它们的 F-ID 与件数归 01/02/17。

---

*本分卷状态：修订完成（v0.2）。本版基线为 80/79/78/77/76 已定稿接口；新增 §2.5 跨卷登记（6 件、不计件），修正 `.gitkeep` 尺寸（16×0 + 2×263）、`extractPersonAttrs` 的输入（org-config `people[]`）、共享资产的比对口径（`byteDigest`，`sha8` 只展示）、行业包 `init` 的失败形态（硬失败）与重生成入口（`studio-next gen-templates` 已存在）。所有“目标/新增/替换/拆分/退役”均为未执行设计；构建轨（79-§5）、包级门禁与 vitest 均未运行。证据强度与未证事项见 §六、§十。*
