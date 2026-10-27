# 81-files/04 · `packages/company` 逐文件契约

> 版本：v0.2（2026-10-27 修订），取代 v0.1。**修订依据以 80 定稿接口为准，不以 v0.1 摘要为准**；本轮改动的五处硬约束见下「本轮对齐」。
> 性质：**自然语言级文件与实现设计呈审稿**，不是现行文件树、实现单或完成证明。
> 上位：75-§五 的文件契约模板与本卷主索引 §二/§四；76 `DEF-PKG-05/07/08`、`DEF-SYN-05`、`DEF-RULE-*`、`REC-LOSS-01`、§9 用例族；77 `REC-OBS-01/02`、`REC-WORK-01/02`、`REC-EVT-03`、§11.1 失败 14 类；78 `BIND-CORE-01`（20 字段）、`BIND-WS-01`（`/SEC v1.0`）；79-§3/§4/§9/§10（含 D10）；80-§2.1/§4.1/§5.7/§6.1/§6.4/§6.6/§8.2/§9.4/§10.6/§10.7/§11.2.1。
> 边界：本附录只把 80 的组件与接口落到文件；**不新增公共概念、端口、状态、允许边或依赖版本**。发现 80 缺端口须回写 80，不在此私设。
> 门禁：本文所有「目标/拆分/新增/退役」均为设计处置，尚未执行；不得据此直接改源码、manifest 或 guards。

**本轮对齐（v0.1 → v0.2 的硬修正，逐条落在正文明处）**

1. **`repo-validate` 不下沉 `core`**：80-§2.1 第 3 行与 §10.6 已定「在包内按目录规则族拆件，`core` 只承担 `Rule Profile` 求值」。v0.1 的「语法面交 `core`」（§三、§4.2、§七 M5/M6 的 v0.1 编号、D3）作废，改为包内 `src/repo/` 子域拆分（§4.2.1）。
2. **`ClassifiedError` 两轴**：`{failure, category, subcause, detail?}`，`failure` 取 77 的 14 类并驱动处置，`category` 只做观测（80-§5.7）。本包所有 `Err`/`throw` 面按此重述（§6.1），并撤掉「文本前缀伪装分类」的写法（D4）。
3. **金额、摘要身份、日界三条口径**（80-§4.1 `TS-SCALAR-04/08/09`）：公共金额 = `DecimalString` + 币种；短哈希只作展示；UTC 日键与公司本地日分开。`reports.ts` 的三处现有形态登记为迁移项（D17），不写成已修。
4. **`mapState` / `BindingProfile` 的分工**：本包只产**声明面**（`CompanySnapshot.stateMapping`/`knownForeignStates`），不实现 `PlatformBindingPort.mapState`；未映射但合法的平台态是「观察事实」，不是 `Err`（80-§6.6、78-§1.2）。见 §6.4 第 5 条。
5. **跨卷目标件归属**：`contract/src/ports/intent.ts`、`contract/src/ports/secret.ts`、`core/src/work-readiness.ts`、`apps/daemon/src/assembly/intent/{ingress,receipt-store}.ts`、`apps/daemon/src/assembly/api/assemble.ts` 均**不属本附录**，本卷只给消费侧约束与跨卷复核记录（§九），不复制其字段表、不另起 F-ID。
> 标签：`现有` / `库级·未接` / `目标-保留` / `目标-拆分` / `目标-新增` / `目标-替换` / `目标-退役` / `仅测试` / `未证`（81-§四）。

---

## 〇、本附录的范围与复算口径

覆盖 `packages/company` 的全部第一方文件：

| 类别 | 现有件数 | 目标件数 | 复算方式 |
|---|---|---|---|
| 生产源码 `src/*.ts`（直下） | 21 | 23 | `ls packages/company/src/*.ts`；目标 = 21 + `dep-graph.ts` + `projections.ts` |
| `src/repo/` 子域 | 0 | 4 | `ls packages/company/src/repo/*.ts`（§4.2.1；`repo-validate.ts` 保留为 facade，不下沉） |
| 测试 `test/*.test.ts`（直下） | 21 | 24 | `ls packages/company/test/*.test.ts`；目标 + `trust` / `projections` / `dep-graph` 三件（D5②、D2、D3） |
| 测试夹具 `test/fixtures/**` | 3 族 / 21 文件 | 3 族 / 21 文件 | `find packages/company/test/fixtures -type f`（不动） |
| 包配置件 | 2 | 2 | `package.json`、`tsconfig.json` |

〔结论〕目标直下 23 件 ≤ `maxFilesPerDirectory=25`（不顶格，留两格）；`src/repo/` 4 件另按同一条目录阈值自检。`templates/**` 与 `test/fixtures/**` 均不新增。

**目标文件树**（`〔新〕` = 目标-新增，`〔拆〕` = 目标-拆分产物保留的 facade，其余为保留件）：

```text
packages/company/
├── package.json · tsconfig.json                     （2 配置件，保留）
├── src/                                             （23 件直下）
│   ├── index.ts                                     （PACKAGE_STATUS 目标-退役）
│   ├── validator.ts · multifile.ts · jobs.ts · cadence.ts · groups.ts
│   ├── hooks.ts · cost-guard.ts · state-hygiene.ts · type-inbox.ts
│   ├── repo-validate.ts                             〔拆〕薄 facade（≤150）
│   ├── repo/                                        〔新〕子域 4 件（§4.2.1）
│   │   ├── input.ts（≤260）· rules-file.ts（≤450）
│   │   └── rules-graph.ts（≤520）· render.ts（≤120）
│   ├── dependencies.ts                              （拆分后＝解析/安装/状态面）
│   ├── dep-graph.ts                                 〔新〕纯图分析
│   ├── init.ts · trust.ts · aiws.ts · git-import.ts · create.ts · reports.ts
│   ├── level-specs.ts · gen-template.ts · namer.ts
│   └── projections.ts                               〔新〕三个 build* 纯投影
└── test/                                            （24 件 = 21 现有 + 3 目标）
    ├── （21 件现有，见 §2.2）
    ├── trust.test.ts（≤220）· projections.test.ts（≤260）· dep-graph.test.ts（≤240）  〔新〕
    └── fixtures/{company-dist, company-src, plugins}  （3 族 21 文件，资产，不动）
```

〔复算〕`src` 直下 = 9（A 组）+ `repo-validate` + `dependencies` + `dep-graph` + 6（IO 编排：`init`/`trust`/`aiws`/`git-import`/`create`/`reports`）+ 3（模板与命名：`level-specs`/`gen-template`/`namer`）+ `projections` + `index` = 23；`src/repo/` = 4；`test/` 直下 = 24；配置件 = 2。

排除：`.git`、`node_modules`、`dist` 及其他生成物、`bun.lock` 与根 `package.json`（归 `81-files/19-root-guards-templates.md`）、第三方源文件、历史设计文档。`templates/**` 的逐文件契约归 81-files/19；本附录只描述 `company` 对模板的**消费契约**与生成器约束。

行数为 2026-10-27 实测（`wc -l`），仅作规模核对，不作能力证据。目标件行数为**预算**，不是实测。

---

## 一、包身份与边界

### 1.1 身份

| 项 | 值 | 依据 |
|---|---|---|
| 包名 | `@studio-next/company` | `packages/company/package.json` |
| 版本 | `0.1.0`，`private: true` | 同上 |
| 层位 | **层位 3**（`contract` 0 → `core` 1 / `store` 2 → `company` 3） | 80-§2.1 |
| 目标语义 | 「不变；`repo-validate`/`dependencies` 超限件**在包内拆件**，不下沉 `core`；`core` 只承担 `Rule Profile` 求值」 | 80-§2.1 第 3 行、§10.6 |
| 秘密面 | **零秘密消费**：生产 `src` 无 `process.env`、不调 `SecretProvider`、任何导出函数都没有秘密形参（无 `SecretMaterial`/`KnownSecretSet`）；秘密在 daemon 装配期取得，本包既不接收也不传递 | 80-§11.2.1、78-§7.4.1（§6.4 第 6 条） |
| 台账面 | 不持有 `Database`/`Ledger`；`@studio-next/store` 仅 type-only；报表落库由 daemon 以唯一写入者身份完成 | 77-§0.3、80-§8.1 |
| 模块形态 | `type: "module"`，ESM，Node 24 LTS 原生 type-stripping 直跑 `.ts` | 79-§4 |
| 入口 | `main: "src/index.ts"`，`exports: { ".": "./src/index.ts" }` | 79-§4.4 两态导出之「源码态」 |
| 发布 | **不发布**（`private: true`，无 `files` 白名单、无 `publishConfig`） | 79-§5.2 / §7.1 |
| 构建 | **不进构建**：无 build 脚本、无 `dist`；消费方直接 import `.ts` | 79-§5.2 |
| 包级类型门禁 | `tsc --noEmit -p tsconfig.json`，`include: ["src/**/*.ts"]` | `packages/company/tsconfig.json` |

### 1.2 允许边与禁止边

〔事实〕`company` 的实际 import 只有五类：`@studio-next/contract`、`@studio-next/store`（**仅 type-only**，见 `src/reports.ts:35`）、`yaml`、`zod`、`simple-git`，加 Node 内建 `node:fs` / `node:fs/promises` / `node:path` / `node:url` / `node:os` / `node:crypto` / `node:child_process`。

〔结论〕允许边（不新增）：

| 边 | 状态 | 说明 |
|---|---|---|
| `company → contract` | 在用 | 类型、`configInvalid`、`DirectoryIssue`/`MountResult`/`CompanySnapshot` |
| `company → store` | 在用（**type-only**） | `PersonRecord`/`ReportRecord`/`WorkRecord`；运行期零 import，不触库 |
| `panel → company` | 在用（清单待归正） | 80-§2.3：按 79-§10.1 移入 `dependencies`；目标态另由 §四 下沉纯投影 |
| `api → company` | 目标 | 80-§9.4 M1 后消费纯投影 |
| `daemon → company` | 在用 | 调度源、导入、报表材料化注入 |
| `company → panel/core/prompt/gateway/adapters/yt` | **禁止** | 尤其禁止 `company → panel`（80-§9.4 前置：日期助手必须先入 `contract`）；`company → core` 在 `allowedPackageEdges` 中**根本没有这一条**，不是"暂时不用" |

〔结论〕两条由 80 定稿新增/确认的边界（本轮补，影响拆分方向）：

1. **`company → core` 不存在且不得新增**。因此 80-§6.1 的 `RuleEvaluator`（纯函数落 `core`）**不能被 `company` 调用**。80-§10.6 据此把 `repo-validate` 判回包内：目录校验规则必须在 `company` 内拆件，`core` 只负责 `Rule Profile` 的表达式求值（`rules/evaluate`）；开工五门的同步纯核 `work-readiness` 也归 `core`（两者见 `81-files/02-core.md`，其 `ReadinessGate` 端口在 daemon）。v0.1 的"语法面交 `core`"与包边事实冲突，已撤。
2. 目标新增件需要的日期助手 `dayKeyOf`/`DAY_MS` 走**既有** `company → contract` 边（80-§9.4 M1 前置：先移入 `contract`，否则会为了一个日期函数长出一条 `company → panel` 的非法边）。

〔结论〕`company` 不是纯面（79-§3.6 明确允许 fs）。但它内部必须保持**纯面 / IO 面可切分**：校验与投影一族零 IO，IO 只出现在编排件（`init`/`git-import`/`create`/`trust`/`aiws`/`repo-validate` 与 `src/repo/` 的输入物化段/`dependencies` 的安装段）。

### 1.3 依赖清单与 79 裁决

| 依赖 | 版本 | 类型 | 79 裁决 |
|---|---|---|---|
| `@studio-next/contract` | `workspace:*` | prod | 正确；层位下行 |
| `@studio-next/store` | `workspace:*` | prod | 正确，但**仅 type-only 使用**；`reports.ts` 不得在运行期调 store |
| `simple-git` | `^3.27.0` | prod | 79-§9 保留；外部依赖系统 `git` 二进制（未证：缺 git 时的报错面） |
| `zod` | `^4.0.0` | prod | 79-§9 保留；`z.strictObject` 是未知字段拒收的机制来源 |
| `yaml` | `^2.6.0` | prod | 79-§9 保留；`LineCounter` + `parseDocument` 是「文件:行」定位的唯一来源 |
| `@studio-next/localplatform` | `workspace:*` | **dev** | 79-§10.1 判定「正确，保留」：仅 `test/create.test.ts` 注入 `createLocalPlatform()`，生产 `create.ts` 只吃 `FlowPlatform` 接口 |

〔未证〕`simple-git` 版本范围与 `bun.lock` 实锁一致性、`yaml` 2.x 别名/深度上限行为、`zod` 4.x 超大输入耗时——79-§3.7 已登记为必须由 82 验证；本附录只引用，不重复取证。

〔结论〕**本轮不新增任何依赖**（79-§10.1 的清单裁决不变）：

- `F-company-dep-graph` 只用 `node:crypto` + `yaml` + `zod` + `contract`（搬迁自 `dependencies.ts`，不引新库）；
- `F-company-projections` 只用 `contract`（类型 + `dayKeyOf`/`DAY_MS`）+ `store`（**type-only**），**不引** `panel`、不引 HTTP 库；
- `src/repo/*` 只用既有 `node:fs`/`node:path`/`node:os`/`node:child_process` + `yaml` + `simple-git`；
- 本包**不引** `@studio-next/core`（无此边），也**不引**任何秘密库：`contract/src/ports/secret.ts` 属 daemon 装配面（§6.4 第 6 条）。

### 1.4 公司目录即定义包：76 九个部件在本包的物理落位

〔事实〕76-§2.1 的定位：**公司定义包是某一修订的纯配置不可变快照**，可独立校验、传播、分叉；不承载公司历史、承诺、证据，不含可执行插件/安装钩子/秘密，不声明身份状态与权威，校验通过 ≠ 可激活（70-§1.3/§1.5）。

〔结论〕本包是**定义包语义的实现面**，但只实现 51 的简化契约；76 的完整机读面（part 索引、摘要、许可）**未实现**。下表是唯一权威映射，任何文件归属不得另起一套：

| 76 部件 | 本包的物理落位 | 校验/装载点 | 状态 |
|---|---|---|---|
| `DEF-PKG-01a` 包描述（manifest 逻辑面） | `.studio-next.yaml`（`schema`/`template`/`created_at`/`last_validated_at`/`last_validation`/`framework_version`）+ `org-config.company{name,slug,level,version?}` | `multifile` 的 `StudioNextMetaSchema`（strictObject）+ `org-config` schema；**meta 与 org 的 `schema` 必须同源**（`meta/schema-mismatch`） | **部分**：无 part 列表/摘要/来源/许可/可选性/`aggregateDigest`/`signatures`（D18） |
| `DEF-PKG-01b` 设立与宪制 | `charter.md` 或 `charter/<名>.md`（由 `company.charter_ref` 引用）+ `prompts/company.md` | B-6 非空文本；C-2 引用存在 | **人读面实现，机读面未实现**：76 的 `DEF-FOUND/MISSION/BOUNDARY/STAKE` 无对应字段（损失，非缺陷） |
| `DEF-PKG-01c` 组织与任职 | `org-config.yaml` 的 `departments[]`/`people[]` + `departments/**/config.yaml` + `people/<工号>.md` | A-2/B-2/B-3/C-1/C-3/C-4/C-6/C-8 + `multifile` 的 dangling/orphan/id-mismatch | **实现**（语义是「拟任」：定义包只声明任职关系，不证明已履职） |
| `DEF-PKG-01d` 工作规范 | `org-config.jobs[]` + `yt`（`states`/`workflows`/`state_mapping`/`typeInbox`）+ `groups`/`hooks`/`cost_guard` | B-4/C-5/C-7 + `state-hygiene`/`type-inbox`/`cost-guard`/`hooks`/`groups` 规则 | **实现**（工作类型的机读定义只在 `jobs`/`yt`，不另立语法） |
| `DEF-PKG-01e` 权威需求 | **无落位** | — | **未实现**：权威需求属部署/记录面，本包不表达（边界正确，不补做） |
| `DEF-PKG-01f` 能力需求 | `dependencies.yaml`（`bindings`）+ `plugins/`（能力资产，`partType≈capability`）+ `org-config.company.platform` | B-5/C-7/D-1..D-4 | **实现（本地口径）**：只有「插件名+版本」，无 `qid`/摘要/来源/许可（与 76 `DEF-PKG-06` 的差距记为损失，见 D18） |
| `DEF-PKG-01g` 人读资产与惰性模板 | `README.md`、`prompts/**`、`docs/**` | B-6（非空）+ A-1（位置）；**从不执行** | **实现**：资产是人所读，机器权能只来自 `org-config`/`dependencies` |
| `DEF-PKG-01h` 扩展与词表 | `org-config.schema ∈ {studio-next/org@1, org-config/v1}`；受控词表：状态名、六属性 `PERSON_ATTRS`、`COST_GUARD_ROUTES` | `z.enum`/字面量；未知键一律拒收（strictObject） | **部分**：无命名空间/扩展记录模型；未知扩展按未知键拒收（76 允许的「可选扩展惰性保留」未实现） |
| `DEF-PKG-01i` 验证与许可材料 | **无落位** | — | **未实现**：包内无许可声明、无作者提供用例。`test/fixtures/**` 是本仓测试资产，**不是**包内材料（不得混称） |

**唯一索引（76 `DEF-PKG-01.2`）**：本包用三条机制逼近「每个对象在包内恰好出现一次」——① 工号全司唯一（B-3），② 岗位 id 全司唯一（B-4），③ 引用完整性（C-1..C-6 悬空/孤儿/双清单）。**缺口**：无 part 级索引，YAML 重复键只依赖 `yaml` 库的 `uniqueKeys` 缺省行为（映射为 `org-config/yaml-syntax`），**无专门负测**（D18）。

**纯配置字节惰性（76 `DEF-PKG-04`）——本包的实现面**：

| 惰性项 | 本包做法 | 证据 |
|---|---|---|
| 不执行包内文件 | clone/解包后只做文本读取；从不 spawn 包内脚本 | `repo-validate` 无执行路径；`git-import` 只 `copyFile`/`writeFile` |
| 版本控制钩子 | 剥 `.git` 重建本地仓（`stripGit`），**不搬运钩子** | `test/git-import.test.ts` 的钩子剥离负断言 |
| 包管理生命周期 | **不跑 npm/bun install**；插件只做目录复制 + 登记 | `dependencies.installCompanyPlugins` 的 `cp` + registry |
| 编辑器/CI/任务 | 不加载包内任务定义；`docs/`/`prompts/` 只当文本 | A-1 封闭集把这类文件挡在仓外 |
| 引导文本 | 不把 README/提示词里的「运行以下命令」当步骤 | 无相关代码路径；诊断项 `W-PKG-001` **未实现** |
| 链接与归档 | 符号链接拒收（E-1）；tarball 预先消毒条目 | `repo-validate` E-1/E-4 + `extractTarball` |
| 可执行位 | 只允许插件声明入口（`package.json main` / `dsh.bundle.patch` / patch `name` 所指） | E-2 + `pluginAllowedExecutables` |

**导入流水（76 `DEF-PKG-07` 六步）与本包的覆盖**：本包只实现第 1–2 步的本地投影——「已取得」= clone/解包成功；「字节惰性与结构/来源校验」= `validateCompanyRepo` 的 A/B/C/D/E + 锚与 `.AIWS` 禁令。第 3–6 步（身份谱系、语义与权源审查、能力/部署候选核验、有权位置激活）**不属于本包**，也不得在 CLI 文案里暗示已完成（`RepoValidateResult` 只声明「结构合法」，51-§八）。

**导入 ≠ 激活（76 `DEF-PKG-08`）在本包的落点**：`git-import` 落锚 `trust=false`；`create` 建号/播种/装插件都不写激活记录；`reports` 只产快照。**本包没有任何激活接口**——这是边界，不是缺口。

**配置三类（76 `DEF-CFG-01`）**：本包不携带 `configClass` 字段；`org-config.company.platform` 实质是**部署绑定**却写在公司配置里（51-§三 允许），差异须在损失报告登记（D20）。

---

## 二、现有件全集

### 2.1 生产源码（21 件，按域分组）

| 文件 | 行数 | 域 | 一句话 |
|---|---|---|---|
| `src/validator.ts` | 612 | 目录校验 | 挂载入口 + 组织 schema + 跨规则接线 |
| `src/multifile.ts` | 397 | 目录校验 | 多文件规则 + 行号回爬 + zod→issue 转换 |
| `src/jobs.ts` | 79 | 目录校验 | `org.jobs` → `ScheduledJob[]` 映射 |
| `src/cadence.ts` | 199 | 目录校验 | 档位/锚时刻/时长/ops 解析（纯） |
| `src/groups.ts` | 97 | 目录校验 | `org.groups` schema + 跨规则 + 组快照 |
| `src/hooks.ts` | 104 | 目录校验 | `org.hooks` schema + 跨规则 + 钩子快照 |
| `src/cost-guard.ts` | 107 | 目录校验 | CG-1..CG-3 成本闸规则 + 快照段 |
| `src/state-hygiene.ts` | 109 | 目录校验 | SH-1..SH-5 状态卫生规则 + 快照卫生 |
| `src/type-inbox.ts` | 67 | 目录校验 | TI-1..TI-3 类型收件态规则 |
| `src/repo-validate.ts` | 1021 | 仓库判定 | A/B/C/D/E 五组规则 + 输入物化 + 渲染 |
| `src/dependencies.ts` | 775 | 依赖引擎 | `dependencies.yaml` 解析 + 版本求值 + 插件安装/热更 |
| `src/init.ts` | 251 | IO 编排 | 模板 → 新公司目录 + 首 commit |
| `src/trust.ts` | 223 | IO 编排 | `.studio-next/trust.json` 锚读写与指纹 |
| `src/aiws.ts` | 153 | IO 编排 | `.AIWS/` 员工工作区树建树与归档 |
| `src/git-import.ts` | 541 | IO 编排 | git-url 导入/升级全链 |
| `src/create.ts` | 529 | IO 编排 | init→provision→建号→jobs→插件→报告 |
| `src/reports.ts` | 376 | 报表 | 月报聚合/快照/渲染/材料化 |
| `src/level-specs.ts` | 314 | 模板 | L3–L9 分级规格单一事实源 |
| `src/gen-template.ts` | 382 | 模板 | 分级模板渲染 + 写盘 + 自检 |
| `src/namer.ts` | 81 | 模板 | 员工花名确定性生成（纯） |
| `src/index.ts` | 88 | 包根 | 再导出 + 包常量 |

### 2.2 测试件（21 件）

| 测试文件 | 行数 | 覆盖对象 |
|---|---|---|
| `test/aiws.test.ts` | 207 | `aiws.ts` |
| `test/company-validate-cli.test.ts` | 185 | `repo-validate` + CLI 装配（真 spawn） |
| `test/cost-guard.test.ts` | 121 | `cost-guard.ts` |
| `test/create.test.ts` | 409 | `create.ts` |
| `test/dependencies.test.ts` | 505 | `dependencies.ts`（安装/热更段） |
| `test/deps-cases.test.ts` | 39 | 契约 `deps` 域 17 case |
| `test/dir-cases.test.ts` | 71 | 契约 `dir` 域 3 case + 行号定位 |
| `test/gen-template.test.ts` | 176 | `gen-template.ts` 与 `templates/**` 逐字节一致 |
| `test/git-import.test.ts` | 469 | `git-import.ts`（真 clone） |
| `test/groups.test.ts` | 180 | `groups.ts` |
| `test/hooks.test.ts` | 190 | `hooks.ts` |
| `test/industry-templates.test.ts` | 217 | `templates/company-game`、`company-internet` |
| `test/init.test.ts` | 288 | `init.ts` |
| `test/jobs-loading.test.ts` | 420 | `jobs.ts` + `cadence.ts` |
| `test/multifile.test.ts` | 439 | `multifile.ts` |
| `test/namer.test.ts` | 70 | `namer.ts` |
| `test/repo-validate.test.ts` | 766 | `repo-validate.ts` |
| `test/reports.test.ts` | 235 | `reports.ts` |
| `test/security-baseline.test.ts` | 163 | `isSafeRelativeOutputPath`、`SLUG_RE`、jobs 路径域 |
| `test/state-hygiene.test.ts` | 175 | `state-hygiene.ts` |
| `test/workflows.test.ts` | 357 | `validator.ts` 工作流规则 |
| `test/fixtures/`（3 族 21 文件） | — | 见 §五 |

### 2.3 包配置件（2 件）

`package.json`（25 行）、`tsconfig.json`（5 行）。

---

## 三、目标件全集与处置总表

| 稳定 ID | 目标路径 | 处置 | 依据 |
|---|---|---|---|
| `F-company-validator` | `src/validator.ts` | 目标-保留（继续减规则体） | 80-§10.6 |
| `F-company-multifile` | `src/multifile.ts` | 目标-保留 | 80-§2.1 |
| `F-company-jobs` | `src/jobs.ts` | 目标-保留 | — |
| `F-company-cadence` | `src/cadence.ts` | 目标-保留（错误通道待修，§八） | 79-§3.4 |
| `F-company-groups` | `src/groups.ts` | 目标-保留 | — |
| `F-company-hooks` | `src/hooks.ts` | 目标-保留 | — |
| `F-company-cost-guard` | `src/cost-guard.ts` | 目标-保留 | — |
| `F-company-state-hygiene` | `src/state-hygiene.ts` | 目标-保留 | — |
| `F-company-type-inbox` | `src/type-inbox.ts` | 目标-保留 | — |
| `F-company-repo-validate` | `src/repo-validate.ts` | 目标-拆分（**包内**按目录规则族拆件；保留薄 facade） | 80-§2.1 第 3 行 / §10.6 |
| `F-company-repo-input` | `src/repo/input.ts` | **目标-新增**（拆分产物：输入物化/字节/路径/归档） | 80-§10.6、76 `DEF-PKG-05.P/.A` |
| `F-company-repo-rules-file` | `src/repo/rules-file.ts` | **目标-新增**（拆分产物：B 组逐文件 schema/值域/纯配置） | 80-§10.6、51-§二..§六 |
| `F-company-repo-rules-graph` | `src/repo/rules-graph.ts` | **目标-新增**（拆分产物：A 封闭集 / C 交叉引用 / D 依赖 / E 产物卫生） | 80-§10.6、51-§一/§四/§五/§六 |
| `F-company-repo-render` | `src/repo/render.ts` | **目标-新增**（拆分产物：人读/机读渲染，纯字符串） | 51-§七 |
| `F-company-dependencies` | `src/dependencies.ts` | 目标-拆分（纯图分析外移） | 80-§10.6 |
| `F-company-dep-graph` | `src/dep-graph.ts` | **目标-新增**（拆分产物） | 80-§10.6 |
| `F-company-init` | `src/init.ts` | 目标-保留 | — |
| `F-company-trust` | `src/trust.ts` | 目标-保留（补注入） | 79-§3.5 |
| `F-company-aiws` | `src/aiws.ts` | 目标-保留 | 78 `BIND-WS-01` |
| `F-company-git-import` | `src/git-import.ts` | 目标-保留 | 76 `DEF-PKG-07` |
| `F-company-create` | `src/create.ts` | 目标-保留 | 76 `DEF-PKG-08` |
| `F-company-reports` | `src/reports.ts` | 目标-保留 | 77 `REC-OBS-01` |
| `F-company-level-specs` | `src/level-specs.ts` | 目标-保留 | — |
| `F-company-gen-template` | `src/gen-template.ts` | 目标-保留 | — |
| `F-company-namer` | `src/namer.ts` | 目标-保留 | — |
| `F-company-projections` | `src/projections.ts` | **目标-新增** | 80-§9.4 M1 |
| `F-company-index` | `src/index.ts` | 目标-保留（常量退役） | — |
| `F-company-package-json` | `package.json` | 目标-保留 | 79-§7 |
| `F-company-tsconfig` | `tsconfig.json` | 目标-保留（门禁缺口登记） | 79-D10 |

〔结论〕`src` 直接层目标 23 件（21 现有 + 新增 `dep-graph.ts`、`projections.ts`），仍在 `maxFilesPerDirectory=25` 内且**不顶格**；`repo-validate` 的拆分产物落 `src/repo/` **子域**（4 件，子目录不占直下额度，`boundary-rules.mjs` 只在"超 25 才必须切子域"处提到这一手法）。本包**没有** `domainPlaneBaselines` 条目（该表只冻结 daemon 四域 `engine`/`control`/`evolve`/`assembly`），因此不涉及"新增域平面散件"，也不得为此改 guards。

〔结论〕超限件三条（`repo-validate` 1021、`dependencies` 775、`validator` 612）只许下降，**基线不动**（80-§10.6）；拆分后公司侧 `repo-validate` facade ≤150 行，`src/repo/` 每件 ≤600 行；`dependencies.ts` + `dep-graph.ts` 总行数不得增加。

〔结论〕退役件：无文件退役。`src/index.ts` 的 `PACKAGE_STATUS` 常量标 **目标-退役**（非文件），删除属破坏性变更，须批示（§八 D1）。`src/repo-validate.ts` **不退役**：保留 facade 以免同时改动 `index.ts` 与 `git-import.ts` 的调用面（§4.2）。

〔计数复算〕本表 29 行 = 23 直下源码 + 4 `src/repo/` + 2 配置件；其中「目标-新增」6 件（`dep-graph`、`projections`、`repo/*` 4 件），「目标-拆分」2 件（`repo-validate`、`dependencies`），其余 19 条源码条目为保留件（另 2 行为配置件）。

---
## 四、逐文件契约

### 4.1 目录校验与挂载面（零 IO 一族）

这一族的共同约束：

- **输入是内存文件映射** `Record<string, string>`（rel posix 路径 → 文本），不读盘、不取时钟、不生成 ID；
- **失败形状是 tagged union**：`MountResult = { ok: true; snapshot } | { ok: false; issues: DirectoryIssue[] }`，逐条 `{file, line, rule, fix}`；**不 throw**。80-§5.7 的三种返回形态表把 `MountResult` 明列为 `Result<…>` 的**既有等价物**——因此它是"结论不是失败类"的一侧，`DirectoryIssue` **不是** `ClassifiedError`、`rule` **不是** `subcause`；只有当调用方另包一层 `Result` 出口时才需要 `{failure,category,subcause}`（§6.1）。
- **定位**：`yaml.parseDocument` + `LineCounter` 取行号，`multifile.lineOfPath` 做 YAML 路径 → 行回爬；
- **未知字段**：对象形 schema 一律 `z.strictObject`，未知键即 issue，不做「忽略并继续」（76-§1.4 未知必需拒收的本地投影）。
- **与 `RuleEvaluator` 无关**：这一族校验的是公司目录的**结构与引用**，不是 76-§6 的 `Rule Profile` 表达式；本包不调 `core` 的 `rules/evaluate`（无 `company → core` 边），也不得自造第二套"规则求值"词汇。

---

#### F-company-validator · `packages/company/src/validator.ts`（612 行）

- **处置**：目标-保留；规则体继续外移（已有六件：`type-inbox`/`state-hygiene`/`groups`/`hooks`/`cost-guard`/`jobs`），基线 655 **只许降**（80-§10.6）。
- **归属**：实现层；上位 80-§6 目录挂载端口、04-§二/§九 目录契约与错误定位口径、76 `DEF-CFG-01` 三类配置。
- **职责 / 非职责**：把「公司目录的内存投影」判成**可挂载 / 不可挂载并给文件:行与修法**。不读盘（盘 → 内存由 `init.readDirectoryFiles` 承担）；不决定信任（归 `trust.ts`）；不证明审批、授权或语义正当。
- **内部结构**：
  - `ORG_CONFIG_FILE = 'org-config.yaml'`（私有常量）；
  - `OrgConfigSchema`（`z.strictObject`，私有，不导出）+ 派生 `export type OrgConfig`；
  - 组件 schema：`WorkflowsSchema`（**只有 `types` 数组**；每类型含 `id`/`entity?`/`states`(≥2)/`edges?`/`anchors`，锚为 `inbox`/`dispatched`/`evidence`/`verified`/`delivered` + 可选 `approval`）、`OrgJobSchema` + `OrgJobTriggersSchema` + `DurationSchema`（对 `parseJobDuration` 的 refine）；`yt.typeInbox` 不在本文件校验，由 `typeInboxRules` 承担；
  - `export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`——**包内 slug 单表**，`init`/`org-config`/`import` 共用（docs/43-附录A-4）；
  - `export function isSafeRelativeOutputPath(p: string): boolean`——路径域闸（禁绝对、禁 `..` 段、禁空段）；
  - `export interface MountOptions { strictFiles?: boolean }`；`export function loadCompanyDirectory(files, opts?): MountResult`；
  - `export function dirSubject(input: unknown): MountResult`——契约 `dir` 域 subject，固定 `strictFiles:false`；
  - 私有：`crossRules`、`workflowRules`、`toSnapshot`、`toWorkflows`；`jobs` 段映射不在本文件，经 `jobs.toJobs` 汇总。
- **导出与依赖**：导出如上 6 项；导入 `yaml`（`LineCounter`/`parseDocument`）、`zod`、`@studio-next/contract`（**仅 type**：`CompanySnapshot`/`DeptNode`/`DirectoryIssue`/`MountResult`/`PersonRef`/`TicketWorkflows`）、本地 `cadence`/`state-hygiene`/`type-inbox`/`groups`/`hooks`/`cost-guard`/`jobs`/`multifile`。不导出 `OrgConfigSchema`——外部无法绕过校验直接 zod 解析（有意的收口）。
- **IO 与注入**：**零 IO、零时钟、零随机**。时间/ID 全部来自传入文本；无 fetch、无子进程、无 env。
- **状态与并发**：无状态；`loadCompanyDirectory` 每次由输入独立求值，可重入、可并行（只依赖纯函数）；无缓存，故无失效问题。
- **错误与观测**：返回 `ok:false` + issues，rule 前缀 `org-config/`（`missing-file`/`yaml-syntax`/`missing-field`/`…`）与 `contract/bad-input`；`fix` 是人读修法，必须可执行（04-§九）。未知/部分：任一 issue 即整体 `ok:false`，不返回「部分快照」。
- **两态语义（关键约束）**：`strictFiles` 缺省 `true` = **全目录校验**（`multifileRules` 参与）；`strictFiles:false` = 只校验 `org-config.yaml`，供 `dir` 域 v1 契约语料使用。该两态与「M2.2-⑨ 拟稿待批」绑定，**未获批示前不得改缺省值**；多文件面契约化留给 `dir2` 域批次。
- **测试与证据**：`test/workflows.test.ts`（工作流规则正/反 + 行号）、`test/dir-cases.test.ts`（`dir` 域 3 case）、`test/security-baseline.test.ts`（`SLUG_RE` 单表 + 输出路径域）、`test/multifile.test.ts`（两态）、其余规则测试均以 `loadCompanyDirectory` 为入口间接覆盖。**未证**：79-§3.7 的 YAML 别名/深度上限、超大输入耗时、ReDoS。
- **规模与验收**：612 行 < 基线 655，但 > 600 阈值——**不得再长**；下降可随任意提交顺带办。完成证据：`bun run guard:boundaries` 绿 + `bun run test` 绿。

---

#### F-company-multifile · `packages/company/src/multifile.ts`（397 行）

- **处置**：目标-保留。
- **归属**：实现层；04-§二 目录契约全貌、80-§6 挂载端口的多文件面。
- **职责 / 非职责**：在「org-config 已过」的前提下检查**其余目录文件**与跨文件一致性；提供 YAML 路径定位助手。不解析 `org-config.yaml` 本体（归 `validator`）；不改文件、不写盘。
- **内部结构**：
  - `export const ORG_CONFIG_SCHEMA_VERSION = 'org-config/v1'`、`export const ORG_CONFIG_SCHEMA_LITERALS = ['studio-next/org@1', ORG_CONFIG_SCHEMA_VERSION] as const`——schema 字面量并集；
  - `export function lineOfPath(doc, lc, path: (string|number)[], offset = 0): number`——YAML 节点 `range` → 行号，找不到回落到最近父节点；
  - `export function zodIssuesToDirectoryIssues(doc, lc, issues, file, rulePrefix): DirectoryIssue[]`；
  - `export function multifileRules(files, org, doc, lc): DirectoryIssue[]`；
  - 规则名（冻结字面量）：`dept/dangling`、`dept/orphan`、`dept/leader-dangling`、`dept-config/yaml-syntax`、`dept-config/missing-field`、`people/dangling`、`people/orphan`、`people/file-id-mismatch`、`people/id-mismatch`、`people/bad-front-matter`、`people-fm/missing-field`、`people/missing-section:<序>`、`charter/dangling`、`meta/missing-file`、`meta/yaml-syntax`、`meta/missing-field`、`meta/schema-mismatch`。前缀参数化的转换器是 `zodIssuesToDirectoryIssues`（`org-config`/`dept-config`/`people-fm`/`meta` 共用），因此规则名的最右段是 zod 路径。
- **导出与依赖**：导出如上 4 项；导入 `yaml`（值 + 类型）、`zod`、`@studio-next/contract`（**仅 type** `DirectoryIssue`）、本地 `validator.ts`（**仅 type** `OrgConfig`）。**不导出任何 schema**。
- **IO 与注入**：零 IO；纯函数；无时钟。
- **状态与并发**：无状态。
- **错误与观测**：全量返回 issue 数组（不做「见错即停」），使一次校验能看到所有问题；`file` 用 rel posix，`line` 1 基。
- **测试与证据**：`test/multifile.test.ts`（全绿面 + 各规则正/反 + `strictFiles` 两态）、`test/dir-cases.test.ts`（行号定位 5 例）。**未证**：大型目录（数千文件）下的耗时与内存。
- **规模与验收**：397 行，预算内；规则只增不改名（规则名是测试与报告的比对键）。

---

#### F-company-jobs · `packages/company/src/jobs.ts`（79 行）

- **处置**：目标-保留。
- **归属**：实现层；04-§三 D9「一切唤起都是定时任务」、18-§三 jobs 播种。
- **职责 / 非职责**：把校验通过的 `org.jobs` 映射成契约 `ScheduledJob[]`。不校验（`OrgJobSchema` 已保证）；不调度、不写库（播种归 daemon）。
- **内部结构**：`export function toJobs(org: OrgConfig): ScheduledJob[]`。缺省：`dept` = 根部门（首个 `parent:null`，兜底 `departments[0]`）、`level` = `company.level`、`model_tier` = `'low'`；`cron` 与 `triggers.cadence` 恰给其一（schema refine），`cadence` 经 `expandCadence(tier, at)` 展开；`sla`/`escalate`/`grace` 经 `parseJobDuration` 转毫秒进 `payload`；`budget_cap.usd` 由标量包一层。
- **导出与依赖**：只导出 `toJobs`；导入契约类型、`cadence.ts`、`validator.ts`（仅 type）。
- **IO 与注入**：零 IO、零时钟。
- **状态与并发**：纯函数；同输入同输出。
- **错误与观测**：不产生错误通道——非法形状在校验面已被拒；此处用「schema refine 保证」断言，不重复校验（避免两套判定分叉）。
- **测试与证据**：`test/jobs-loading.test.ts`（逐字段映射、缺省值、9 类非法条目行号、模板 jobs 自检、cadence 五档 + at 锚、outputs/sla/escalate、形状闸）。
- **规模与验收**：79 行。映射表冻结在 `OrgJobSchema` 头注（M4-①..⑧ / M5-①..⑥，是**外部文档的里程碑编号**，与本卷 §七 的 M1–M8 无关），改映射须改头注并同批改测试。

---

#### F-company-cadence · `packages/company/src/cadence.ts`（199 行）

- **处置**：目标-保留；**错误通道目标-替换**（§八 D4）。
- **归属**：实现层；docs/35-§3 岗位运作规格、04-§三 D9。
- **职责 / 非职责**：档位语义（`hourly|daily|weekly|monthly|quarterly`）+ `at` 锚（`HH:MM` 或 `d<N> HH:MM`）+ 时长文本（`30m`/`2h`/`1d`…）+ `ops` 读视图解析。不调度、不展开为时间序列（只产出 cron 文本模板位）。
- **内部结构**：
  - `export const CADENCE_TIERS`、`export type CadenceTier`、`export function isCadenceTier(v): v is CadenceTier`；
  - `export interface CadenceAt`、`export function parseCadenceAt(at: string): CadenceAt | null`；
  - `export function expandCadence(tier: CadenceTier, at?: string): string`；
  - `export function parseJobDuration(text: string): number | null`（毫秒）；
  - `export interface JobOps` / `JobOpsCadence` / `JobOpsSla` / `JobOpsEscalateTier`、`export function parseJobOps(payload: unknown): JobOps`、`export function isCadenceJob(job: ScheduledJob): boolean`。
- **导出与依赖**：导出上述 9 项；导入 `@studio-next/contract`（**仅 type** `ScheduledJob` + 值 `configInvalid`）。运行时零外部依赖。
- **IO 与注入**：零 IO、零时钟、零随机——`at` 的「锚」是**文本**，具体下次触发时刻由调度器决定，不在本文件取 `now`。
- **状态与并发**：纯函数。
- **错误与观测**：`parseCadenceAt`/`parseJobDuration` 走「返回 `null` 表示不可解析」（查询式，不构成拒绝通道）；`expandCadence` 对非法组合是**构造期非法**，`throw` 是允许的形态，但必须是 `ClassifiedError` 而**不是**带文本前缀的裸 `Error`（80-§5.7：`configInvalid` 固定 `failure:'rejected_precondition'`、`category:'CONFIG_INVALID'`）。目标 subcause：`company/cadence:bad-at`、`company/cadence:hourly-with-at`、`company/cadence:day-anchor-unsupported`。现状（`cadence.ts:84/:87/:90` 抛裸 `Error` + 中文前缀 `CONFIG_INVALID：`）是**迁移项**：文本前缀不可机械比对，且违反"不把 category 当消息文案"。测试当前只断言前缀，迁移后改断言 `failure`/`category`/`subcause` 三元组。
- **测试与证据**：`test/jobs-loading.test.ts`（五档展开、`at` 合法/非法、时长解析边界、`ops` 视图）。迁移后追加：三处非法输入的 `failure`/`category`/`subcause` 断言（负向）。
- **规模与验收**：199 行。修改档位词表属语义变更，须同步 docs/35-§3 与契约 `jobs` 面。

---

#### F-company-groups · `packages/company/src/groups.ts`（97 行）

- **处置**：目标-保留。
- **归属**：实现层；`org.groups` 声明面。
- **职责 / 非职责**：校验 `org.groups`（键/成员/负责人引用）并产出组快照。不决定组是否「在编」（人事事实归目录文件与台账）。
- **内部结构**：`export const OrgGroupSchema`（`z.strictObject`）、`export function groupCrossRules(doc, lc, org, deptPaths: Set<string>, peopleIds: Set<string>): DirectoryIssue[]`（后两参由 `validator` 传入，避免本文件反查文件树）、`export function toGroups(groups: NonNullable<OrgConfig['groups']>): OrgGroupDecl[]`。
- **导出与依赖**：导出 3 项；导入 `yaml`（类型 + 值）、`zod`、契约类型 `DirectoryIssue`/`OrgGroupDecl`、本地 `validator.ts`（**类型 + `SLUG_RE` 值**）、`multifile.lineOfPath`。
- **IO 与注入**：零 IO。
- **状态与并发**：纯函数。**已知结构风险**：与 `validator.ts` 构成运行期循环 import（`groups → validator` 取 `SLUG_RE`，`validator → groups` 取 schema/规则）。当前安全，因为 `SLUG_RE` 只在 `refine` 回调内使用（模块求值期不触碰）；头注已声明。目标：把 `SLUG_RE` 的取用点改为「调用时读取」或由 `multifile` 转出，消除环；**不下沉 `SLUG_RE` 到 `contract`**（80-§2.3 明确不以沉淀小常量为默认路径）。
- **错误与观测**：issues 数组；规则前缀 `groups/*`。
- **测试与证据**：`test/groups.test.ts`（正/负对照 + 行号）。
- **规模与验收**：97 行。

---

#### F-company-hooks · `packages/company/src/hooks.ts`（104 行）

- **处置**：目标-保留。
- **归属**：实现层；`org.hooks` 声明面（`data_change.routes`、`cost_threshold{target?,lane?}`）。
- **职责 / 非职责**：校验钩子声明并转快照。不执行钩子、不发通知（执行归 daemon/gateway）。
- **内部结构**：`export const OrgHooksSchema`、`export function hooksCrossRules(doc, lc, org): DirectoryIssue[]`、`export function toHooks(hooks: NonNullable<OrgConfig['hooks']>): OrgHooksDecl[]`。
- **导出与依赖**：同 `groups`（不含 `SLUG_RE` 取用）；导入契约类型 `DirectoryIssue`/`OrgHooksDecl`、本地 `validator.ts`（仅 type）、`multifile.lineOfPath`。
- **IO 与注入**：零 IO。
- **状态与并发**：纯函数。
- **错误与观测**：issues 数组；规则前缀 `hooks/*`。
- **测试与证据**：`test/hooks.test.ts`（正/负 + 行号）。
- **规模与验收**：104 行。

---

#### F-company-cost-guard · `packages/company/src/cost-guard.ts`（107 行）

- **处置**：目标-保留。
- **归属**：实现层；预算闸声明面（与 core 预算逻辑的分工：本文件只**声明合法性**，求值归 core）。
- **职责 / 非职责**：校验 `org.cost_guard` 段与 `person.cost_caps`，产出 CG-1..CG-3 违规。不计算预算、不触发断路。
- **内部结构**：`export const CostGuardSectionSchema`、`export type CostGuardSection`、`export const PersonCostCapsSchema`、`export function costGuardRules(doc, lc, org): DirectoryIssue[]`（CG-1 段形状 / CG-2 路由词表 ∈ `COST_GUARD_ROUTES` / CG-3 单人 cap 与公司段一致）、`export function toCostGuard(section: CostGuardSection): CostGuardConfig`。
- **导出与依赖**：导出 4 项；导入 `yaml`、`zod`、契约值 `COST_GUARD_ROUTES` + 类型 `CostGuardConfig`/`DirectoryIssue`、`multifile.lineOfPath`。
- **IO 与注入**：零 IO。
- **状态与并发**：纯函数。
- **错误与观测**：issues 数组；规则前缀 `cost-guard/*`。
- **测试与证据**：`test/cost-guard.test.ts`（CG-1..3 + 结构闸 + `cost_caps`）。
- **规模与验收**：107 行；路由词表是契约冻结值，改词表须改 `contract`。

---

#### F-company-state-hygiene · `packages/company/src/state-hygiene.ts`（109 行）

- **处置**：目标-保留。
- **归属**：实现层；`yt.states` 卫生面（SH-1..SH-5），上游 77 状态语义与 76 未知态拒收。
- **职责 / 非职责**：校验状态词表与工作流引用的自洽（未声明态、孤儿态、保留态等），并可对快照做卫生标注。不推断平台真实状态、不改快照的业务字段。
- **内部结构**：`export function stateHygieneRules(doc, lc, yt: Record<string, unknown> | undefined): DirectoryIssue[]`（SH-1..SH-5）、`export function applyStateHygieneToSnapshot(snap: CompanySnapshot, yt: Record<string, unknown> | undefined): void`（**就地改写入参**，见下条）。
- **导出与依赖**：导出 2 项；导入 `yaml`、契约类型 `CompanySnapshot`/`DirectoryIssue`、`multifile.lineOfPath`。
- **IO 与注入**：零 IO。
- **状态与并发**：`stateHygieneRules` 是纯函数；`applyStateHygieneToSnapshot` **就地改写入参快照**（返回 `void`）——它是快照装配期的最后一道标注，调用方须自行决定是否为入参做浅拷贝。这是本包唯一「以副作用为契约」的纯面函数，须在契约测试里锁住「标注后的字段集合」，避免调用方误以为它返回新对象。
- **错误与观测**：issues 数组；规则前缀 `state-hygiene/*`。
- **测试与证据**：`test/state-hygiene.test.ts`（SH-1..5 正/负 + 快照卫生）。
- **规模与验收**：109 行。

---

#### F-company-type-inbox · `packages/company/src/type-inbox.ts`（67 行）

- **处置**：目标-保留。
- **归属**：实现层；studio-dev-130 §6.1.2「类型收件态直落」。
- **职责 / 非职责**：校验 `yt.typeInbox`（TI-1 形状 / TI-2 值域 / TI-3 保留词）。不决定建单落位（落位序归平台配置面）。
- **内部结构**：`export function typeInboxRules(doc, lc, org): DirectoryIssue[]`；私有 `TYPEINBOX_DEFAULT_STATES = ['新单','已派发','证据就绪','复验通过','已交付']`。
- **导出与依赖**：只导出 `typeInboxRules`；导入 `yaml`、契约类型 `DirectoryIssue`、本地 `validator.ts`（仅 type）、`multifile.lineOfPath`。
- **IO 与注入**：零 IO。
- **状态与并发**：纯函数。
- **错误与观测**：issues；规则前缀 `org-config/typeinbox-*`（注意：沿用 `org-config/` 前缀而非独立域前缀，是既有冻结形态）。
- **双胞胎约束**：缺省五态与 `git-import.ts` 的 `DEFAULT_STATES`（`:139`）**两处同构**，注释明说不引跨模块常量、由测试锁同构。目标：保持「值相同」的事实，不合并为跨模块常量（合并会把导入面与校验面耦合）；但**新增/修改状态词表必须同批改两处 + 测试**。
- **测试与证据**：`test/workflows.test.ts`（TI-1..3 经 `loadCompanyDirectory`）、`test/git-import.test.ts`（`deriveFieldProvision` 缺省态）。
- **规模与验收**：67 行。

---
### 4.2 仓库判定器

#### F-company-repo-validate · `packages/company/src/repo-validate.ts`（1021 行，**超限**）

- **处置**：**目标-拆分（包内）**。方向由 80-§2.1 第 3 行与 §10.6 给定：**`repo-validate` 留 `company`，按「目录规则族」在本包内拆件（字节/路径/归档/纯配置校验各一件）；不下沉 `core`**——`core` 只承担 `Rule Profile` 的表达式求值（`rules/evaluate`）；开工五门另有同步纯核 `work-readiness`（端口在 daemon）——两者与目录校验都不是同一层，且 `company → core` 无允许边。本文件保留 `F-company-repo-validate` 这个 ID 作为**薄 facade**，拆分产物另立 `F-company-repo-*` 四个 ID（§4.2.1），ID 不复用。
- **归属**：实现层；规范正文在 `docs/51-公司仓库规范正文.md` 的 §一..§六（五组契约 A/B/C/D/E），本文件是其实施面；上位 80-§2.1/§10.6、76 `DEF-PKG-05.P/.A`（路径与归档安全）、`DEF-PKG-07` 第 2 步。
- **职责 / 非职责**：判定「一个公司仓库（源面 / 产物面）是否合乎 51 的五组契约」，输出**逐条可定位**的违规与警告。不修复、不初始化、不激活（51-§八）；不证明身份、语义正当或授权（76 `DEF-PKG-07` 六步中只覆盖第 2 步的本地投影）；**不做** `Rule Profile` 求值、不做开工五门（`ReadinessGate` 端口在 daemon 引擎侧，`core/src/work-readiness.ts` 只是同步纯核，见 §九 文件表第 3 行）。
- **内部结构**：
  - **规则号（冻结字面量）**：`RepoRuleId = A-1..A-5 | B-1..B-6 | C-1..C-8 | D-1..D-4 | E-1..E-4`，对应 51 的五组：A 目录封闭集、B 逐文件 schema 与值域、C 交叉引用、D 依赖、E 克隆产物卫生。**二十七条字面量冻结**：新增/合并/改号都算破坏 51-§七 的输出契约，只能由 51 改版带动。
  - **逐规则判定表**（「判据」为 51 原文压缩；「输出定位」= `RepoViolation.file` / `location` 的取值形态）：

    | 规则 | 判据 | 输出定位 | 面与备注 |
    |---|---|---|---|
    | A-1 | 封闭集之外的顶层条目；`departments/` 子树只收 `config.yaml` 与 `people/<工号>.md`，`charter/` 只收一层 `<名>.md` | `file`=越界路径，`location`=`顶层` 或 `路径形状` | 两面；`--allow-extra` 时改记 `exempted`（含子树前缀，整棵豁免），不豁免 B/C/D/E |
    | A-2 | 必备位缺件：`org-config.yaml`、章程位（`charter.md` 或 `charter/<名>.md`）、≥1 个 `departments/<名>/config.yaml`；另含「org 声明了部门但缺 config」「`charter_ref` 不在章程位」 | `file`=缺件名或 `charter_ref` 值，`location`=`顶层` 或 `company.charter_ref` | 两面；共享核 `dept/dangling` 也映射到此条 |
    | A-3 | `.git/` 不参与合法性判定（传输层） | 无输出 | 实现形态＝`WALK_SKIP_NAMES` 静默跳过；这是「无违规可报」的豁免规则，不是检查项 |
    | A-4 | `.AIWS/` 出现在公司仓（员工工作区在仓外同级） | `file`=`.AIWS`, `location`=`顶层`, `alias='import/aiws-present'` | 两面同禁；与 E-3 双报（一事实两规则号，便于运维按组检索） |
    | A-5 | `.studio-next/` 锚目录出现在**源仓** | `file`=`.studio-next`, `location`=`顶层`, `alias='import/anchor-present'` | 仅源面；产物面在 `walkRepo` 顶层整棵跳过（R7），故不产出 A-5/E-3 |
    | B-1 | `org-config.yaml` 与 `.studio-next.yaml` 的逐文件 schema 与值域：YAML 语法、`company.slug` 语法域、`company.version`、`level_distribution` 键域、meta 段同源性 | `file`=相关件，`location`=`L<n>` 或 `company.<键路径>`，`via`=共享核内层规则号 | 两面；meta 文件缺场不违规（R2），在场则须完整 |
    | B-2 | `departments[]` 与 `departments/<名>/config.yaml` 双向双检：字段形状/值域、有声明无文件、有文件无声明 | `file`=`org-config.yaml` 或 `<dept>/config.yaml`，`location`=`L<n>` 或键路径 | 两面 |
    | B-3 | `people[]` 与档案 front-matter：必填键、`id` 唯一、`file` 锚定形状、`---` 分隔 | `file`=`org-config.yaml` 或档案路径，`location`=`L<n>` | 两面 |
    | B-4 | `jobs[]` 值域与 `id` 唯一性 | `file`=`org-config.yaml`, `location`=`L<n>` | 两面 |
    | B-5 | `dependencies.yaml` schema（`strictObject`，未知字段拒收） | `file`=`dependencies.yaml`, `location`=schema 路径 | 两面；**文件缺场零绑定面，不违规** |
    | B-6 | 章程与 `prompts/` 为非空文本（内容自由，属提示词资产面） | `file`=章程或提示词文件，`location`=`L1` | 两面 |
    | C-1 | `people[].dept` 悬空（不命中任何 `departments[].path`） | `file`=`org-config.yaml`, `location`=`L<n>` | 两面 |
    | C-2 | `company.charter_ref` 指向的文件不存在 | `file`=引用值，`location`=`L<n>` | 两面 |
    | C-3 | `departments[].leader`（org 面与部门 config 面各一处）不是 `people` 成员工号 | `file`=`org-config.yaml` 或 `<dept>/config.yaml`, `location`=`L<n>` | 两面 |
    | C-4 | `people[].file` 不存在、不在其 dept 目录下、文件名≠工号；档案文件无 org 索引条目；档案与索引 `id` 不一致 | `file`=`org-config.yaml` 或档案路径，`location`=`L<n>` 或键路径 | 两面 |
    | C-5 | 部门 config 的 `jobs` 清单与 org-config 的 `jobs[]` 双向不一致 | `file`=`<dept>/config.yaml`, `location`=`jobs` | 两面 |
    | C-6 | `departments[].parent` 悬空或成环 | `file`=`org-config.yaml`, `location`=`L<n>` | 两面 |
    | C-7 | `dependencies.bindings[].when.attr` ∉ 六属性封闭枚举（`role`/`dept`/`level`/`skills`/`executor`/`status`） | `file`=`dependencies.yaml`, `location`=schema 路径 | 两面 |
    | C-8 | `level_distribution` 总账与 `people` 逐人等级不一致 | `file`=`org-config.yaml`, `location`=`company.level_distribution.<键>` | 两面 |
    | D-1 | `version` 只收 `^x.y(.z)` 与精确 `x.y.z` 两形态；`~`/`>=`/通配 → 违规并指认到值 | `file`=`dependencies.yaml`, `location`=schema 路径 | 两面 |
    | D-2 | 多绑定命中同名插件时约束并集无解 | 不进 `violations`；进 `warnings`（`rule='D-2'`, `location`=`plugins[<名>]`）与 `summary.conflicts` | 两面；合法不阻断，安装面按「不装错版本」处理 |
    | D-3 | 绑定插件既不在仓内 `plugins/` 也无可用源 | 不进 `violations`；进 `summary.capabilityMissing` | 两面；合法但能力缺失面明示 |
    | D-4 | `plugins/<名>/` 形态：`package.json` 在场、可解析、`name` 非空、`version` 为精确 `x.y.z`、`dsh.bundle.patch` 为字符串且所指文件在仓内 | `file`=`plugins/<名>`（或所指 patch 路径），`location`=`package.json[:键]` | 两面；**入仓插件个个要成型**，不限于被绑定者 |
    | E-1 | 任意深度符号链接（`.git` 内不判） | `file`=链接路径, `location`=`符号链接`, `alias='import/symlink-entry'` | 两面 |
    | E-2 | 可执行位文件落在插件约定入口集之外；入口集=`package.json` `main` + `dsh.bundle.patch` 所指文件 + patch 内 `insert.name` 引用 | `file`=文件路径, `location`=`exec 位`, `alias='import/exec-bit'` | 两面；闸跑在物化产物上（clone 保留 exec 位） |
    | E-3 | 源仓自带 `.studio-next/` 或 `.AIWS/`（E 组对 A-5/A-4 的重申） | 与 A-5/A-4 同 `file`/`location`/`alias` | 两面；与 A 组**双报**，不是重复 bug |
    | E-4 | 单文件 >8MB 或文件总数 >5000 | `file`=文件路径或 `(仓库)`, `location`=`文件 <n>MB` 或 `文件数 <n>` | 两面；阈值是 51-§六 的实现期参数 |

  - **两面差异**（`RepoFace = 'source' | 'product'`；同一次调用只跑一面，导入流按需各调一次）：

    | 面 | `.studio-next/` 锚 | `.AIWS/` 工作区 | 走树口径 | 用途 |
    |---|---|---|---|---|
    | `source` | 出现即 A-5 + E-3 | 出现即 A-4 + E-3 | `WALK_SKIP_NAMES` 跳 `.git`/`.DS_Store`；内容面用 `readDirectoryFiles`（同口径再跳 `.AIWS`，由 A-4 专门指认） | 导入前原仓体检 |
    | `product` | 顶层整棵跳过（不参与 A/E 闸与内容面） | 仍禁，A-4 + E-3 | 同上 | 克隆产物/解包产物体检（76 `DEF-PKG-07` 第 2 步的本地投影） |

  - **结果形状**：`export interface RepoViolation { rule; file; location; problem; fix; via?; alias? }`、`RepoWarning`、`RepoValidateSummary`、`RepoValidateResult`；`location` 是 `L<n>` 或键路径（51-§七 输出契约）。`via` 保留共享核内层规则号（`org-config/missing-field:company.slug` 等），`alias` 是 DEV-27 结构闸别名（`import/unknown-entry` 等）——**新旧两套标识共存**，测试与运维各取一面。
  - **入口**（facade 保留）：`export async function validateCompanyRepo(dir: string, opts?: RepoValidateOptions): Promise<RepoValidateResult>`；`RepoValidateOptions = { face?: RepoFace; allowExtra?: boolean }`（`face` 缺省 `source`）。拆分后签名**保持不变**，内部委托 `src/repo/rules-*.ts`。
  - **输入物化**（**目标落位 `src/repo/input.ts`**）：`export class RepoInputError extends Error`（`name='RepoInputError'`）**目标-替换**为 `Err(ClassifiedError)`（§错误面）；`export type RepoInputKind = 'path' | 'git-url' | 'tarball'`、`export interface MaterializedRepoInput { kind; dir; cleanup }`、`export async function materializeCompanyRepoInput(input): Promise<Result<MaterializedRepoInput, ClassifiedError>>`。目录直用；tarball 经系统 `tar -tf` 先逐条消毒（拒绝对路径与 `..` 段）再 `tar -xf` 到 `mkdtemp`；git-url 经 `simple-git` clone 到暂存。`cleanup` 是调用方**必须**在 finally 调用的释放面。
  - **渲染**（**目标落位 `src/repo/render.ts`**，纯字符串）：`export function renderRepoValidation(result, input?)`（人读：PASS=摘要+可初始化 / FAIL=逐条违规）、`export function repoValidationJson(result, input?)`。
  - **常量**（随用法落位）：`export const REPO_SINGLE_FILE_MAX_BYTES = 8 * 1024 * 1024`、`export const REPO_FILE_COUNT_MAX = 5000`（51-§六 E-4 实现期参数，落 `rules-graph`/`input`）、`export const DOCS51_SLUG_RE`（落 `rules-file`）。
  - **私有函数**（判定顺序即调用顺序，改顺序会改首报规则号）：`walkRepo`（物理走树，产出 `topNames`/`files`/`symlinks`/`pluginEntries`）→ `closedSetGate`（A-1/A-4/A-5）→ `hygieneGate`（E-1/E-4）→ 必备位 A-2 → `mapSharedIssue`（共享核 `DirectoryIssue` → 51 规则号）→ `layerExtras`（共享核未覆盖的 B-1 值域/B-3 形状/B-6/C-4..C-8）→ `pluginAllowedExecutables` + `collectPatchNameRefs`（E-2 入口集）→ `depsFace`（D-1..D-4，含 B-5/C-7 的 schema 分流）。常量：`CLOSED_TOP_FILES`/`CLOSED_TOP_DIRS` 封闭顶层集、`WALK_SKIP_NAMES = ['.git','.DS_Store']`、`ID_SEGMENT_RE`（工号/部门段）、`SEMVER_RE`、`TARBALL_RE`、`looksLikeGitUrl`、`extractTarball`。
  - **`mapSharedIssue` 的去重约定**：`org-config/missing-file` 与 `meta/missing-file` 返回 `null` —— 前者由 A-2 物理闸指认、后者由 R2 判为「缺 meta 不违规」，在此再报就是双报。其余内层规则号按 `missing-field:<首段>` 的键名分流到 B-1/B-2/B-3/B-4，未知键一律落 B-1（保守归组，不吞违规）。
  - **R4 已知正则漂移（登记，待决）**：判定器用 `DOCS51_SLUG_RE`（3–64 字符、首尾非连字符），`init`/`create`/`validator` 用 `SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`（不限长、允许单字符）。后果：1–2 字符或超过 64 字符的 slug 能过建司通道，却过不了 `repo-validate`。代码注释已自认「R4：判定器按规范正则收，严于 init 通道」。处置见 §八 D22。
- **导出与依赖**：导出如上；导入 `node:child_process`（`spawnSync('tar',…)`）、`node:fs`、`node:fs/promises`、`node:os`、`node:path`、`yaml`（值 + 类型）、`simple-git`、契约类型 `CompanySnapshot`/`DirectoryIssue`/`MountResult`、本地 `validator.loadCompanyDirectory`、`multifile.lineOfPath`、`init.readDirectoryFiles`、`dependencies`（`extractPersonAttrs`/`parsePlainVersion`/`planPluginInstalls`/`safeParseDependencies` + 类型）。
- **IO 与注入**：**IO 面**：读目录树、`mkdtemp`、系统 `tar` 子进程、`simple-git` clone。**未注入**：无 `now`（不改文件，无需时钟）；无 fetch（git 走外部二进制）；临时目录根取 `os.tmpdir()`（受 `TMPDIR` env 影响，未作为参数注入）。
- **状态与并发**：无持久状态；`cleanup` 幂等（`rm -rf` 容忍不存在）；两遍判定（源面 + 产物面）共用同一判定器，测试以「两遍共用判定器」取证（`test/repo-validate.test.ts`）。
- **错误与观测**（按 80-§5.7 两轴重述）：
  - **判定结果不是失败类**：`RepoValidateResult`（`{ ok; face; violations; warnings; exempted; summary?; snapshot? }`）留在 `Ok`，**不 throw**；`violations[].rule` 是 51 规则号，**不是** `subcause`。
  - **输入不可物化是预期拒绝**，目标改为 `Result`：
    - 空串/非 tarball 的普通文件 → `Err({ failure:'rejected_precondition', category:'CONFIG_INVALID', subcause:'repo/invalid-input' })`；
    - tar 条目逃逸（绝对路径 / `..` 段）→ `Err({ failure:'rejected_forbidden', category:'EXTERNAL_REJECT', subcause:'repo/archive-entry-unsafe' })`；
    - 路径不存在且非 git-url → `Err({ failure:'unavailable', category:'STALL', subcause:'repo/source-missing' })`；
    - 系统 `git`/`tar` 缺失、clone 网络失败 → `Err({ failure:'unavailable', category:'STALL', subcause:'repo/tool-missing' | 'repo/fetch-failed' })`；
    - 归档超限（76 `DEF-PKG-05.A` 一旦实施）→ `rejected_forbidden` + `subcause:'repo/archive-limit'`。
    `subcause` 是**实现侧**稳定细目（可带连字符），`failure` 的 14 个值不得改写（下划线原值）。
  - **背离处置**：v0.2 之前 `RepoInputError` 只有 `name`，没有 `category`/`subcause`，CLI 只能靠类名映射 exit 2；这是**迁移项 D5①**，不是已修。CLI 的 exit 码映射在 `apps/daemon/src/cli`（17），本包只保证 `failure` 可机械判读：`rejected_precondition`/`rejected_forbidden` → 2（输入/用法），`unavailable` → 3（环境）。
  - 内部一致性破坏（判定器自身 bug）→ 抛 `ClassifiedError`，`failure:'rejected_precondition'`、`category:'CONFIG_INVALID'`、`subcause:'internal-bug'`（80-§5.7 第 754 行：不造第 15 个 failure），**不伪装成违规**。
- **测试与证据**：`test/repo-validate.test.ts`（A/B/C/D/E 每组「违法 FAIL + 孪生 PASS」配对夹具、`--allow-extra`、产物面锚豁免、`.AIWS` 两面同禁、输入物化失败通道、两遍共用判定器、E-4 5000 文件上限，30s timeout）、`test/company-validate-cli.test.ts`（真 spawn CLI、真 tar、真 clone 本地仓）。拆分后**等价性证据**：同一夹具集在 facade 与 `src/repo/*` 上逐条比对 `violations`/`warnings`/`exempted` 全字段（规则号、定位、文案），不一致即判负。**未证**：DNS/网络失败下的 clone 报错文案稳定性、超大 tarball 的解包耗时与磁盘占用、`tar` 版本差异、并发判定同一暂存根。
- **规模与验收**：1021 行 = 基线 1021，**只许降**。拆分顺序（写死，包内闭环）：① 先落 `src/repo/input.ts` 与 `src/repo/render.ts`（纯搬移，无判定语义）→ ② `repo-validate.ts` 改调，旧实现保留一个提交周期 → ③ 落 `rules-file.ts`/`rules-graph.ts`，facade 只做委托与再导出 → ④ 删本地实现并跑等价性比对 → ⑤ 收口 facade ≤150 行。**任一时刻不得存在两套生效判定**；回退：②之前可整文件回退，②之后按子域整体回退（四个新件与 facade 同批）。
- **与 `dependencies` 的先后约束**：本文件从 `dependencies.ts` 取四个符号做 D 组判定与插件形态闸。`F-company-dep-graph` 落位时，这些 import 须一并改线到 `dep-graph.ts`；**先落 dep-graph，再动 repo 拆分**，否则会制造 `dependencies → repo-validate` 的回环。

---

#### 4.2.1 拆分产物（`src/repo/` 子域，4 件）

〔结论〕四件都必须**零 `company → core`、零 `company → panel`**，只走既有边；单件硬阈是 guard 的 `maxLinesPerFile=600`，**真正的门禁是「facade + 四件合计 ≤ 现有 1021 行」**（只搬移、不顺手加功能）——条文里的 260/450/520/120 是**各件上限**而非目标值，四件实际合计必须 ≤ 1021−facade；否则说明搬迁时夹带了新逻辑。共同测试入口仍是 `test/repo-validate.test.ts`（不新增测试文件，避开 `test/` 直下配额）。

```text
F-company-repo-input · packages/company/src/repo/input.ts（单件上限 ≤260 行）
- 处置/归属：目标-新增（拆分产物）；80-§10.6、76 DEF-PKG-05.P/.A、51-§六 E-4 的输入侧。
- 职责：把「路径 / git-url / tarball」三种输入物化成可判定的本地目录，并在物化过程中做字节/路径/归档三级安全闸。
  非职责：不判 A–E 规则（归 rules-*）、不渲染（归 render）、不决定信任与激活。
- 内部：RepoInputKind、MaterializedRepoInput{kind,dir,cleanup}、materializeCompanyRepoInput(input): Promise<Result<MaterializedRepoInput, ClassifiedError>>；
  extractTarball（tar -tf 先消毒再 -xf 到 mkdtemp）、looksLikeGitUrl、TARBALL_RE、REPO_SINGLE_FILE_MAX_BYTES（8 MiB，单文件）、
  REPO_FILE_COUNT_MAX（5000）——两者是 51-§六 仓库面限额，**不是** DEF-PKG-05.A 的归档限额（10 000 条目/64 MiB/512 MiB/8 层/200:1）。
- 导出与依赖：上述符号；node:fs / node:fs/promises / node:path / node:os / node:child_process（spawnSync tar）/ simple-git / contract 的 `Result`+`ClassifiedError` 类型（**不再**用 `configInvalid` 造新类，旧类只留过渡期）。
- IO 与注入：读盘、mkdtemp、子进程、clone；临时根取 os.tmpdir()（受 TMPDIR 影响，未注入，未证）；无 now、无 fetch、无 env 读取（密钥/令牌不参与）。
- 状态/事务/幂等/并发/恢复：无状态；cleanup 幂等（rm -rf 容忍不存在）；中途失败必须由调用方 finally 清理；并发同一暂存根未证（D9）。
- 错误/秘密/观测：`Err` 的 `failure` 只有三种（`rejected_precondition`/`rejected_forbidden`/`unavailable`），`subcause` 细分五种（`repo/invalid-input`/`repo/archive-entry-unsafe`/`repo/source-missing`/`repo/tool-missing`/`repo/fetch-failed`，见上；归档限额落地后另有 `repo/archive-limit`）；`detail` 不含本机绝对路径（80-§5.8），只给相对名与条数。
- 测试/R·E·W·V：repo-validate.test.ts 的 tarball/git-url/逃逸/超限用例；R05（跨边界输入）与 R12（伪造来源）只作**输入面**证据；E/W 用例不属本件；V4（安全）/V2（跨实现）未证。
- 规模与迁移：≤260 行；从 repo-validate.ts 逐字搬迁，不改消毒判定顺序；迁移期保留旧类名一个提交周期以便 CLI 改线。
```

```text
F-company-repo-rules-file · packages/company/src/repo/rules-file.ts（单件上限 ≤450 行）
- 处置/归属：目标-新增；51-§二/§三/§六（B 组逐文件 schema/值域 + 纯配置校验）、76 DEF-PKG-04/05（纯配置字节惰性、禁可执行与秘密）。
- 职责：对已物化的目录判 B-1..B-6 与与之同源的 C-4/C-7/C-8 纯配置面，并产出 RepoViolation/RepoWarning。
  非职责：不物化输入、不判 A/C/D/E 的图与依赖（归 rules-graph）、不渲染、不修复文件。
- 内部：RepoRuleId 的 B 组子集、CLOSED_TOP_FILES/CLOSED_TOP_DIRS 的**只读引用**（定义在 rules-graph，避免两处表）、
  DOCS51_SLUG_RE、ID_SEGMENT_RE、SEMVER_RE、mapSharedIssue（共享核 DirectoryIssue → 51 规则号，去掉 A-2/R2 双报）、layerExtras。
- 导出与依赖：evaluateFileRules(ctx): {violations,warnings}；ctx 由 facade 组装（dir、face、allowExtra、文件索引、共享核快照）。
  依赖 node:fs/promises、yaml（parseDocument+LineCounter）、contract 类型（DirectoryIssue/CompanySnapshot）、本地 validator.loadCompanyDirectory（只读调用）、multifile.lineOfPath。
- IO 与注入：只读 fs；无时钟、无随机、无子进程；临时目录不归本件。
- 状态/幂等/并发：纯读；同输入同输出；无缓存。判定顺序冻结（B-1→B-2→…），改顺序会改首报规则号。
- 错误/观测：不抛业务错误；解析器自身异常 → internal-bug（见 4.2 错误面）；违规定位 location 为 L<n> 或键路径。
- 测试/R·E·W·V：repo-validate.test.ts 的 B 组正/反配对 + dir-cases 的行号口径；R24（变更降级）/R28（自锁）只作**定义侧**夹具，不证明公司治理；V1 静态、V4 未证。
- 规模与迁移：≤450 行；从 repo-validate.ts 搬 B-1..B-6 与 mapSharedIssue；**不得**在此新增规则或放宽值域。
```

```text
F-company-repo-rules-graph · packages/company/src/repo/rules-graph.ts（单件上限 ≤520 行）
- 处置/归属：目标-新增；51-§一（A 封闭集）、§四（C 交叉引用）、§五（D 依赖）、§六（E 产物卫生）。
- 职责：判 A-1..A-5、C-1..C-8 的图面、D-1..D-4、E-1..E-4（含符号链接/exec 位/限额/锚与 .AIWS）。
  非职责：不判 B 组逐文件 schema（rules-file）、不物化输入、不渲染、不决定能否初始化（51-§八）。
- 内部：RepoFace、RepoViolation/RepoWarning/RepoValidateSummary/RepoValidateResult、walkRepo、closedSetGate、hygieneGate、
  pluginAllowedExecutables、collectPatchNameRefs、depsFace、CLOSED_TOP_FILES/CLOSED_TOP_DIRS/WALK_SKIP_NAMES/REPO_FILE_COUNT_MAX。
- 导出与依赖：evaluateGraphRules(ctx) 与上述类型；依赖 node:fs/promises、node:path、yaml、contract 类型、本地 dep-graph（extractPersonAttrs/parsePlainVersion/planPluginInstalls/safeParseDependencies）、rules-file（共享只读表）。
- IO 与注入：只读 fs 走树（不 clone、不 tar）；无 now；无 env。
- 状态/幂等/并发：无状态；两遍（source/product）共用同一判定器；cleanup 不在本件。
- 错误/观测：契约违规进 violations（不抛）；E-4 超限是违规不是 Err；内部 bug → internal-bug。
- 测试/R·E·W·V：repo-validate.test.ts 的 A/C/D/E 配对 + 5000 文件 30s 用例 + 两面差异；R19（第三方损害）不属本件；V4 未证。
- 规模与迁移：≤520 行；搬移时不改规则号/定位/文案；`--allow-extra` 行为原样保留（只豁免 A-1，不豁免 B/C/D/E）。
```

```text
F-company-repo-render · packages/company/src/repo/render.ts（单件上限 ≤120 行）
- 处置/归属：目标-新增；51-§七 输出契约。
- 职责：把 RepoValidateResult 渲染成机读 JSON 与人读报告（PASS=摘要+可初始化；FAIL=逐条违规）。
  非职责：不判定、不读盘、不写盘、不做颜色/终端探测。
- 内部：renderRepoValidation(result, input?): string；repoValidationJson(result, input?): string；私有格式化助手。
- 导出与依赖：两函数；只引 contract 类型（无 fs/path/子进程）。
- IO 与注入：零 IO、零时钟、零随机；input 只作为展示用来源串。
- 状态/幂等：纯函数；同输入字节相同（确定性由测试锁）。
- 错误/观测：无错误通道；缺失字段按「未提供」显示，不补 0、不补空串（77 REC-OBS-02 的显示纪律）。
- 测试/R·E·W·V：repo-validate.test.ts 的渲染快照断言 + CLI 冒烟（company-validate-cli）；不证明终端宽度/本地化。
- 规模与迁移：≤120 行；搬移不改文案（文案是运维比对键）。
```

---

### 4.3 依赖清单与插件引擎

#### F-company-dependencies · `packages/company/src/dependencies.ts`（775 行，**超限**）

- **处置**：**目标-拆分**（80-§10.6「依赖图分析拆出纯函数」）。纯图分析外移到 `F-company-dep-graph`；本 ID 保留为**解析 + 安装执行 + 状态文件**面。
- **归属**：实现层；docs/43-§四「员工的行为面」、51-契约 D、76 `DEF-PKG-08`（导入 ≠ 激活：安装落位不等于插件已生效）。
- **职责 / 非职责**：读并校验 `dependencies.yaml`，按员工属性求启用集，规划并执行**隔离根**内的插件安装、登记与热更指纹。不决定员工属性（归 `org-config`）；不决定授权（安装 ≠ 授权）；不写 `~/.dsh` 或任何用户级目录（`pluginRoot` 必填无缺省，**结构上不可能**误写）。
- **内部结构**（保留段）：
  - `export const DEPENDENCIES_FILE = 'dependencies.yaml'`；`PERSON_ATTRS = ['role','dept','level','skills','executor','status'] as const`（**私有**）与 `export type PersonAttrName`；
  - `export const DependenciesSchema`（`z.strictObject`：`schema: 'studio-next/dependencies@1'`、`bindings` min 1）、`export type CompanyDependencies`、`BindingSchema`/`PluginRefSchema`；
  - `export function parseDependencies(src): CompanyDependencies`（非法即 `configInvalid('deps/invalid'|'deps/yaml-syntax')`）、`export interface DepsParseIssue`、`export function safeParseDependencies(src, opts?): {ok:true,deps}|{ok:false,issues}`、`export async function readDependencies(companyDir): Promise<CompanyDependencies|null>`；
  - `export interface PersonAttrs`、`export function extractPersonAttrs(orgConfigSrc): PersonAttrs[]`（读 `org-config.yaml` 文本，不读盘）；
  - 安装面：`PluginSource`、`RegistryEntry`、`PluginInstallOptions`（`companyDir`/`pluginRoot` 必填、`persons`、`deps?`、`externalSources?`、`confirm?`、`failOnMissing?`、`by?`、`now?`）、`PluginInstallReport`、`installCompanyPlugins`；
  - 状态面：`export const PLUGIN_STATE_FILE = 'plugin-state.json'`、`PluginState`、`pluginSetFingerprint(depsSrc, enabled)`、`PluginReloadResult`、`syncCompanyPlugins`、`listInstalledPlugins`、`listPluginRootEntries`；
  - 契约 subject：`export function depsSubject(input: unknown): unknown`（路由键 `parse`/`enabled`/`demanded`/`satisfies`/`plan`/`fingerprint`）。
  - 私有：`REGISTRY_FILE='registry.json'`、`INSTALL_LOG_FILE='install-log.jsonl'`、`readRegistry`、`appendInstallLog`、`resolvePackagePlugin`（公司包 `plugins/<name>/` 形态闸：须 `package.json` 有非空 `name`/`version` + `dsh.bundle` + `patch` 所指文件在位）。
- **绑定解析语义**（`dependencies.yaml` → 逐人启用集 → 全员需求集，全程零 IO）：
  - **schema 形状**：`DependenciesSchema = { schema: 'studio-next/dependencies@1', bindings: BindingSchema[] (≥1) }`；`BindingSchema = { when: { attr: PersonAttrName, is: string(非空) }, plugins: PluginRefSchema[] (≥1) }`；`PluginRefSchema = { name, version }`。三层都是 `strictObject`——未知键一律 `deps/invalid`，不做宽容合并。
  - **属性域**：`PERSON_ATTRS = ['role','dept','level','skills','executor','status']`（**私有常量**），`PersonAttrName` 是导出类型。这六个键就是 `C-7` 的封闭枚举，也是 01-C2 人事档案的索引键；扩键须先改 43/51。
  - **候选值**（`attributeCandidates`）：`dept` 给**双候选**——完整 path 与末段名（`when.is: 研发部` 能命中 `dept: departments/研发部`）；`skills` 逐元素；`level` 字符串化（YAML 数字 → `"3"`）；`role`/`executor`/`status` 单值。空属性不出候选键（不是空数组）。
  - **命中**：`bindingHits` = 该属性的候选值数组包含 `when.is`（精确字符串相等，不做大小写折叠、不做前缀匹配）。
  - **逐人启用集**（`enabledPluginsFor`）：按 `bindings` 原序扫描，同名插件**首见为代表**，结果按插件名升序。同一人命中多条绑定且版本不同，此处不合并——合并归全员需求集。
  - **全员需求集**（`demandedPlugins`）：`Map<插件名, version 原文数组>`，跨人跨绑定去重且保序；**同一插件被多人/多绑定命中即约束并集**，不是后者覆盖前者。
  - **版本两形态**：`VERSION_SPEC_RE = /^(?:\^?)(\d+)\.(\d+)(?:\.(\d+))?$/` —— 只收 `^x.y[.z]`（caret）与 `x.y[.z]`（精确，缺 patch 按 `.0`）。`parseVersionSpec` 出 `{kind:'caret'|'exact', major, minor, patch}`；`parsePlainVersion` 只接受精确形态（供插件 `package.json` 版本解析复用，非精确即 `null`）。
  - **满足判定**（`satisfiesSpec`，被判定版本必须先过 `parsePlainVersion`）：`exact`=三元组等值；`caret` 且 `major>0`=同 major、`(minor, patch)` 不低于下界；`^0.x` 锁 minor（不跨 minor）；`^0.0` 锁 patch（只认 `0.0.patch` 等值）。没有 `~`、`>=`、`*`、区间并集——51-D-1 的拒收面在 schema 层，此函数是防御性二验（`null` 即不满足）。
- **安装计划六态**（`planPluginInstalls`，纯函数；判定按下列顺序，先命中先返回）：

    | 动作 | 判定条件（按顺序） | 是否落盘 | `detail` 语义 |
    |---|---|---|---|
    | `missing` | `sources[插件名]` 无键（公司包 `plugins/` 与外部源均不可得） | 否 | 缺源；同时进 `RepoValidateSummary.capabilityMissing`（依赖清单即能力声明） |
    | `conflict` | 源在，但源版本不满足约束并集的**全部**成员（含约束原文本身不可解析的防御分支） | 否 | 「不装错版本」——**已装也报 conflict**，不退回旧版 |
    | `satisfied` | 有 `installed[插件名]` 且已装版本满足全部约束 | 否（零动作） | 幂等面：热更指纹不变时的稳态 |
    | `install` | 源版本满足全部约束，且 `installed[插件名]` 无键 | 是 | 从公司包 `plugins/` 或外部源落位 |
    | `replace` | 源版本满足全部约束，`installed` 有键但不满足约束 | 是 | 覆盖为源版本 |
    | `skipped` | **不由本函数产出**：执行面 `confirm` 返回 `false` 时把 `install`/`replace` 改写为 `skipped` | 否 | 只出计划、零落盘（拒装留痕在报告里） |

  - 输出按**插件名升序**排列（稳定序，同输入必得同序列）；`required` 保留约束原文不做归一（报告要能直读用户写了什么），`origin` 取 `'package' | 'external' | 'none'`，`sourceVersion`/`installedVersion` 仅在存在时出现。
- **安装面产物三件**（隔离根 `pluginRoot` 下，均为「框架自管」，不进公司仓）：
  - `registry.json`（`schema: 'studio-next/plugin-registry@1'`，`installed: RegistryEntry[]`）——**追加事实**：启用集收缩不卸载、不删条目；条目字段 `name`/`version`/`source('company-package'|'external')`/`installedAt`/`by`。
  - `install-log.jsonl`——一行一条 JSON 追加；**无 `dependencies.yaml` 时也写一行空报告**（审计面完整）；只记名称/版本/来源/时间/登记人，不记凭据。
  - `plugin-state.json`（`schema: 'studio-next/plugin-state@1'`，`{company, fingerprint, enabled}`）——`fingerprint = sha256(dependencies.yaml 原文 ‖ 排序后的逐人启用集投影)`；`enabled` 以**工号**为键。`syncCompanyPlugins` 比对该指纹：不变 → 零动作（不补装、不写状态、不出日志）；变了 → 重算 + 增量补装 + 落新状态。首次无状态文件时直接走安装并写状态。
- **导出与依赖**：导入 `node:crypto`（`createHash`，指纹）、`node:fs`/`node:fs/promises`、`node:path`、`yaml`、`zod`、契约 `configInvalid`。
- **IO 与注入**：**IO 面**：读写 `pluginRoot` 下 `registry.json`/`install-log.jsonl`/`plugin-state.json`、`cp` 复制插件目录、读公司包与外部源目录。**注入**：`now?(): Date`（缺省墙钟）、`confirm?`（拒装 → 只出计划零落盘）、`externalSources[].resolve`（源解析回调）、`failOnMissing`（导入侧 fail-fast 开关）、`by`（留痕）。**未注入**：`pluginRoot` 是**必填参数**不是缺省值（有意）。
- **状态与并发**：`registry.json` 是**追加事实**（启用集收缩不卸载，docs/43-§十-8）；`plugin-state.json` 存 `{fingerprint, enabled}` 作热更判定。**非事务**：安装逐插件复制 + 追加登记；中途崩溃可能留下「已复制未登记」或「已登记未复制」，由下一次 `syncCompanyPlugins` 以指纹比对重算，**不保证单次原子**（未证：并发两个 daemon 同插件根的行为——归 82 的并发用例）。
- **错误与观测**：subcause 全表：`deps/yaml-syntax`、`deps/invalid`、`deps/registry-invalid`、`deps/plugin-package-invalid`、`deps/plugin-missing`、`deps/state-invalid`、`deps/contract-bad-input`；按 80-§5.7 一律补 `failure:'rejected_precondition'` / `category:'CONFIG_INVALID'`（解析与形态类），外部源不可达类为 `failure:'unavailable'` / `category:'STALL'`（目标；现状只有 `configInvalid`）。`InstallLogEntry` 一行 JSON 追加，**无依赖清单也留一行空报告**（审计面完整）。日志只记名称/版本/来源/时间；**不记凭据、不记秘密形态串、不记本机绝对路径**——本包不 `load` 秘密（80-§11.2.1 的 `SecretProvider` 属 daemon 装配面），`pluginRoot` 只记相对名；若将来需要出站脱敏，只调 `contract` 的 `redactKnownSecrets`/`findSecretShaped`，**不得**在本包再写一套正则（80-§11.2.1 的"不留第二正则"）。
- **测试与证据**：`test/dependencies.test.ts`（`failOnMissing`、`confirm`、外部源、replace、热重载指纹、隔离根 tmp 断言不碰用户目录）、`test/deps-cases.test.ts`（契约 `deps` 域 17 case + 反证 + 纯面直证）。**未证**：真实 dsh 加载插件（安装 ≠ 生效）、并发安装、磁盘满/权限拒绝。
- **规模与验收**：775 行 = 基线 775，只许降；拆分后目标 ≤600。

#### F-company-dep-graph · `packages/company/src/dep-graph.ts`（**目标-新增**）

- **处置**：**目标-新增**（拆分产物）。上位：80-§10.6「依赖图分析拆出纯函数」；不引入新语义，只换宿主。
- **归属**：实现层；51-契约 D 的纯求值面。
- **职责 / 非职责**：**零 IO** 的依赖图分析——属性候选、绑定命中、启用集、需求集、版本区间解析与满足判定、安装计划。不读盘、不写登记、不复制文件（执行归 `F-company-dependencies`）。
- **内部结构**：从现有 `dependencies.ts` **逐字搬迁**（零行为漂移）：`PersonAttrName`、`PersonAttrs`/`extractPersonAttrs`、`attributeCandidates`、`bindingHits`、`enabledPluginsFor`、`demandedPlugins`、`VersionSpec`/`parseVersionSpec`/`parsePlainVersion`/`satisfiesSpec`（`VERSION_SPEC_RE = /^(?:\^?)(\d+)\.(\d+)(?:\.(\d+))?$/`）、`PluginPlanSource`/`PluginPlanInput`、`PluginInstallAction`（`install|replace|satisfied|conflict|missing|skipped`）、`PluginInstallItem`、`planPluginInstalls`、`pluginSetFingerprint`。若搬迁顺序需要，`DependenciesSchema`/`parseDependencies`/`safeParseDependencies` 也一并入本文件（解析是纯的），`dependencies.ts` 改为 re-export 过渡。
- **导出与依赖**：导出上述符号；导入 `node:crypto`（指纹）、`yaml`、`zod`、契约 `configInvalid` + 类型。**不得** import `node:fs`、`simple-git`、`dependencies.ts`（否则新环）。
- **IO 与注入**：零 IO、零时钟、零随机。`pluginSetFingerprint` 用 sha256，是**内容摘要**不是随机。
- **状态与并发**：纯函数；`planPluginInstalls` 对同输入必得同序列（排序键为插件名）。
- **错误与观测**：解析失败走 `configInvalid`（同现有 subcause）；计划面不抛错，用 `PluginInstallAction` 六值联合表达「缺/冲突/跳过」。
- **测试与证据**：新增 `test/dep-graph.test.ts`（≤240 行，§五.2 目标行）覆盖纯面全部分支；`test/deps-cases.test.ts` 的「纯面直证」与 `deps` 域 17 case 保持同名断言（改指向新路径，不改断言内容）；`test/dependencies.test.ts` 的纯函数部分同步改路径。
- **规模与验收**：目标 ≤ 600 行；拆分后 `dependencies.ts` + `dep-graph.ts` 总行数**不得增加**（只搬迁，不顺手加功能）。顺序：先新增本文件并让旧文件 re-export → 改调用方 → 再删旧实现。

---

### 4.4 目录 IO 编排面

这一族的共同约束：

- **它们是 `company` 里直接碰盘的主力**（`gen-template` 另有写盘段；`reports` 只经注入写面、不直接碰盘），**每个写动作都必须给出调用方能核对的返回值**（写了几件、提交哈希、指纹、归档清单），不用「静默成功」；
- **写路径安全**：目标必须落在声明的根内（`DEF-PKG-05.P`）；现有实现以「rel posix 拼接 + `mkdir -p` + 不跟随外部绝对路径」达成包含性，**未实现 realpath 消解**（§八 D9）；
- **git 身份**：repo 局部 `user.name`/`user.email` 写死为框架身份，**不读机器全局身份**，保证提交确定性；
- **幂等优先**：重复执行要么零动作，要么返回同一结果（`contentChanged=false` / `created=0` / `changed=false`），不产空提交、不重复留痕。

---

#### F-company-init · `packages/company/src/init.ts`（251 行）

- **处置**：目标-保留。
- **归属**：实现层；16-§四 v0.1 验收口径「init 出模板公司并通过自检」、04-§二 目录契约。
- **职责 / 非职责**：把仓库内模板目录复制成新公司目录，替换占位符，跑目录自检，完成 git 首提。**不**建平台账号、不装插件、不建 `.AIWS`（分别归 `create`/`dependencies`/`aiws`）；不判断公司语义是否正当。
- **内部结构**：
  - `export interface InitOptions { slug; name?; targetDir; templateDir? }`（`name` 缺省=slug；`templateDir` 缺省=仓根 `templates/company-2-level`）；
  - `export interface InitResult { dir; gitCommit }`（`dir` 为绝对路径，`gitCommit` 全长哈希）；
  - `export const AIWS_DIR = '.AIWS'`；`export const SCAN_EXCLUDED_NAMES = ['.git', '.DS_Store', AIWS_DIR]`——**扫描排除单源表**，`readDirectoryFiles`、daemon 热重载、指纹基线三处共用基表（daemon 侧只在基表上追加 `.studio-next`，不复制条目）；
  - `export async function readDirectoryFiles(root): Promise<Record<string,string>>`——递归读、按名排序、只收 `entry.isFile()` 条目（符号链接/目录/其他类型不进入映射），文件一律按 utf8 读；**二进制文件未做检测**（头注 TODO 声称「跳过符号链接与二进制」，代码只实现了前半——微漂移，登记于 §八 D9 的输入面）；
  - `export async function initCompany(opts): Promise<InitResult>`；
  - 私有：`assertSlug`（用 `validator.SLUG_RE`）、`defaultTemplateDir`、`replaceOnce`、`replaceTemplateKey`（行级 `template:` 键替换，D8 泛化）、`formatIssues`、`commit`。
- **导出与依赖**：导入 `node:fs`/`node:fs/promises`、`node:path`、`node:url`、`simple-git`、契约 `configInvalid` + 类型 `DirectoryIssue`、本地 `validator`（`loadCompanyDirectory` + `SLUG_RE`）。
- **IO 与注入**：**写盘 + 子进程（git）**。**未注入**：时钟（`:205` 的 `new Date().toISOString()` 直接墙钟写 `created_at`）、git 端口（直接 `simpleGit`）。测试通过临时目录隔离 + 固定模板达成确定性，但 `created_at` 不可确定化——已在 §八 D6 登记。
- **状态与并发**：目标目录**必须不存在或为空**（否则 `init/target-not-empty`）；失败时**整体撤除本次新建目录**（不留半成品）；`gitCommit` 是唯一提交点，无多次提交。
- **错误与观测**：subcause 全表：`init/bad-slug`、`init/bad-name`、`init/template-missing`、`init/target-not-empty`、`init/template-placeholder-drift`、`init/self-check-failed`、`init/git-first-commit-failed`。模板占位漂移一律**停手改模板**，不迁就代码（消息内明写）。
- **测试与证据**：`test/init.test.ts`（默认模板全链、坏 slug、非空目标、自检失败撤除、D8 行级 template 键替换、`init → validate` exit 0 冒烟）。
- **规模与验收**：251 行。模板根用 `fileURLToPath(new URL('../../../templates/company-2-level', import.meta.url))` 推导——**跨包相对路径**，分发/发布形态下不成立（§八 D8）。

---

#### F-company-trust · `packages/company/src/trust.ts`（223 行）

- **处置**：目标-保留（补注入）。
- **归属**：实现层；docs/44 v1 信任锚设计；76 `DEF-PKG-07` 第 1–2 步的本地证据面。
- **职责 / 非职责**：读写 `<公司目录>/.studio-next/trust.json`，提供内容指纹、批准/再批准/撤销与信任态读取。**不**判定公司是否恶意，**不**签名、不加密——威胁模型只覆盖「内容漂移」，不覆盖「制作人物理改锚」（头注已诚实标注）。
- **内部结构**：
  - `export const TRUST_DIR = '.studio-next'`、`export const TRUST_FILE = '.studio-next/trust.json'`；
  - `export interface TrustHistoryEntry { action: 'import'|'approve'|'re-approve'|'revoke'; by; at; fingerprint?; note? }`；
  - `export interface TrustAnchor { schema: 'studio-next/trust@1'; slug; trust; fingerprint; history }`；
  - `export function excludeAnchorFiles(files)`——指纹只看公司内容，隔离锚自身；
  - `export function contentFingerprint(files): string`——per-file sha256 → 排序后的 `path:hash` 行串 → sha256，带 `sha256:` 前缀；
  - `export function readTrustAnchor(companyDir): TrustAnchor | null`；`export function writeTrustAnchor(companyDir, anchor): void`（`mkdir -p` 0700 + tmp 文件 + `rename` 原子替换）；
  - `export function seedTrustAnchor(companyDir, slug, files, entry)`（`trust=false` + `action:'import'`）；`export function reseedTrustAnchorOnUpgrade(...)`（内容变 → `trust` 回 `false`，fail-closed）；`export function approveCompanyDirectory(...)`（同指纹幂等，不重复留痕）；`export function revokeTrust(...)`；`export function trustStateOf(companyDir): { trusted, anchor }`（**无锚 = init 通道，视为受信**）。
- **导出与依赖**：导入 `node:crypto`、`node:fs`（全同步）、`node:path`。无契约依赖——刻意保持「最小依赖」，使信任面不被业务类型污染。
- **IO 与注入**：**全同步 fs**（`readFileSync`/`writeFileSync`/`renameSync`）——与包内其余 IO 件的 `fs/promises` 不一致（§八 D7）。**未注入**：时钟（`writeTrustAnchor` 用 `Date.now()` 生成 tmp 名；`at` 由调用方传入，属已注入部分）。
- **状态与并发**：锚文件是**单一事实**；写入是 tmp+rename 原子替换，因此并发读者看不到半个 JSON；但**无锁**——两个并发批准可能各自读旧锚再写，后者覆盖前者（未证/未处理，归 82 并发用例）。`history` 无上限增长（头注标注，截断策略归后续单）。
- **错误与观测**：`readTrustAnchor` 对「无文件 / 坏 JSON / 形状不符」**一律返回 `null`**；而 `trustStateOf` 与消费方（`apps/daemon/src/control/hot-reload.ts:470` 的「有锚目录才闸」）都把 `null` 当「无锚 = init 通道」——于是**锚文件被损坏或改成非法形状时，信任闸被静默跳过（fail-open）**。本文件**零 `configInvalid` 调用**，即失败形态不是分类错误。这是本包最重要的安全缺口（§八 D5②），**目标形态按 80-§5.7 两轴重述**：
  - `readTrustAnchor(companyDir): Result<TrustAnchor | undefined, ClassifiedError>`——`undefined` = **真的没有锚文件**（未导入过，走 init 通道）；
  - 文件存在但不可解析/形状不符 ⇒ `Err({ failure:'rejected_precondition', category:'CONFIG_INVALID', subcause:'trust/anchor-corrupt' })`，`trustStateOf` **不得**把它读成"无锚"；消费方必须 fail-closed（拒挂载/拒激活），不是继续当受信；
  - 读取期 IO 失败（EACCES 等）⇒ `Err({ failure:'unavailable', category:'STALL', subcause:'trust/read-failed' })`；
  - 本文件仍**不**签名/不加密：`trust.json` 不是安全边界，只防"内容漂移被忽略"，**不得**在其中存任何秘密或凭据（80-§11.2.1、78-§7.4.1）。
- **测试与证据**：经 `test/git-import.test.ts` 间接覆盖（导入落锚 `trust=false`、升级重落、指纹变化）。**缺专门单测**：`approve`/`revoke`/`re-approve` 的幂等与留痕只被间接覆盖，且 fail-open 缺口**没有任何负向用例**——目标新增 `test/trust.test.ts`（§五.2 目标行；新增测试件不占行数基线，进 `test/` 直下 24 件 ≤25）。
- **规模与验收**：223 行；目标仍 ≤260（新增的错误分支不得把文件推过 600）。**验收证据**：坏锚负向用例红→绿；`git-import` 的锚落盘/升级用例全绿；**不证明**恶意改锚可防（威胁模型边界，已在头注与本文声明）。

---

#### F-company-aiws · `packages/company/src/aiws.ts`（153 行）

- **处置**：目标-保留。
- **归属**：实现层；78 `BIND-WS-01`（公司目录是数据包不是工作区、worker 只读）、docs/43-§五 + §十-9（不并树）。
- **职责 / 非职责**：在 `.AIWS/` 下按组织与人事**镜像建树**（`<部门路径>/<工号>/`），增量同步，离司目录**改名归档不删**。**不**写员工家目录内容（员工在自己文件夹里做任何事）；**不**把 `.AIWS` 放进公司 git 目录；**不**改变公司配置面（`.AIWS` 在扫描排除表内）。
- **内部结构**：`export interface AiwsEnsureOptions { slug?; now?: () => Date }`、`export interface AiwsTreeResult { root; personDirs; created; archived }`、`export function ensureAiwsTree(root, departments, people, opts?): AiwsTreeResult`；私有 `OWNER_MARKER='.studio-next.json'`（根归属标记）、`ARCHIVED_RE = /\.archived-\d+(-\d+)?$/`、`archiveTarget`（撞名追加序号）。
- **导出与依赖**：导入 `node:fs`（全同步）、`node:path`、契约 `configInvalid`。
- **IO 与注入**：同步 fs 建目录/改名/读写标记；`now` 可注入（缺省墙钟），测试注入固定时钟。`slug` 给出即启用 **per-company 根守卫**：异 slug 拒、无标记收养；缺省不读写标记（兼容旧调用面，正式链路恒给出）。
- **状态与并发**：**幂等**——重复 ensure 的 `created` 恒 0；活路径 = 部门路径 ∪ `<person.dept>/<person.id>`，结构层 = 活路径真前缀；非活且非已归档 → 整树改名归档。无锁；并发 ensure 可能重复归档（同一毫秒由序号兜底，但不防跨进程竞争）。
- **错误与观测**：`aiws/owner-marker`（标记不可解析或缺 slug，fail-closed）、`aiws/root-owned`（异 slug 拒）。返回 `created`/`archived` 作为可核对观测，不静默。
- **测试与证据**：`test/aiws.test.ts`（建树同构、幂等、根守卫、归档不删、家内部不下探、撞名序号；tmp 隔离 + 固定时钟）。
- **规模与验收**：153 行。目录深度由组织结构决定，**不加深度上限**（公司层级是业务事实，不是资源泄漏）。

---

#### F-company-git-import · `packages/company/src/git-import.ts`（541 行）

- **处置**：目标-保留。
- **归属**：实现层；docs/43-§一「git 网址即公司」+ §十 定稿增补；76 `DEF-PKG-07` 六步中的 1–2 步 + 7 步本地物化，`DEF-PKG-08`（导入 ≠ 激活）的实现约束。
- **职责 / 非职责**：把一个 git 源（或本地分发仓）**导入/升级**成本框架自管的公司目录：clone → 剥 `.git` 重建本地仓 → 写盘前结构判定 → 平台字段 provision → 落信任锚（`trust=false`）→ 建 `.AIWS` → 依赖清单安装挂点。**不**激活公司、不建平台账号（归 `create`）、不批准信任（归制作人经 `trust.approve`）。
- **内部结构**：
  - `export type RepoValidator = (dir, opts?) => Promise<RepoValidateResult>`——判定器注入位；
  - `export function deriveFieldProvision(orgYt, workflows?): FieldProvisionMap`——平台字段/状态流推导；`DEFAULT_STATES`（五态，与 `type-inbox` 双胞胎）、`DEFAULT_FIELD_MAP = { state:'State', dept:'部门', level:'等级' }`；
  - `export function deriveDirNameFromGitUrl(gitUrl): string`；
  - `export interface RepoImportOptions { sourceDir; targetDir; importedBy?; now?; platform?; pluginRoot?; aiwsRoot?; confirmInstall?; validator? }`；
  - `export interface RepoImportResult { dir; slug; gitCommit; fingerprint; upgraded; contentChanged; provisioned; aiws; install? }`；
  - `export async function importCompanyRepo(opts): Promise<RepoImportResult>`；`export function extractOrgYt(orgSrc): Record<string,unknown> | undefined`；
  - `export interface CompanyAddOptions`、`export type CompanyAddResult = RepoImportResult`、`export async function companyAddGitUrl(opts)`（clone 到暂存 → 导入核 → 撤暂存）；
  - 私有：`GIT_IDENTITY = { name:'studio-next-import', email:'import@studio-next.invalid' }`、`ANCHOR_DIR='.studio-next'`、`META_FILE='.studio-next.yaml'`、`commitAll`（干净即返回 HEAD，幂等升级不产空提交）、`stripGit`、`syncContent`（删除源已不存在的内容文件，保留 `.git/` 与 `.studio-next/`）。
- **导出与依赖**：导入 `node:fs`/`node:fs/promises`/`node:os`/`node:path`、`simple-git`、`yaml`、契约类型 + `configInvalid`、本地 `repo-validate`、`init`、`aiws`、`trust`（四件）、`dependencies`。
- **IO 与注入**：**重 IO**：clone/复制/删除/提交/建树/装插件。**注入**：`now?()`、`platform?`（`FlowPlatform` 端口）、`pluginRoot?`（**必填则不写用户目录**：不给即跳过安装）、`aiwsRoot?`、`confirmInstall?`、`validator?`（测试可换判定器）。**未注入**：git 端口（直用 `simple-git`）、临时目录根（`os.tmpdir()`）。
- **状态与并发**：升级通道「四点语义」——① 目标必须是本框架导入过的目录（无锚即拒，`import/target-not-imported`）；② slug 必须同家；③ 内容不变 → 零提交、`contentChanged=false`；④ 内容变 → 新提交 + 锚回 `trust=false`。导入是**多步非事务**：中途失败会留下部分产物；当前策略是「宁失败不半成品」——在写盘前完成结构判定，写盘后失败则依赖下一次重导修复（未证：崩在 commit 前的残留）。
- **错误与观测**：subcause 全表：`import/source-missing`、`import/target-not-imported`、`import/slug-mismatch`、`import/structure-rejected`、`import/self-check-failed`、`import/git-commit-failed`、`import/bad-git-url`。结构闸的违规逐条带文件位置（不吞）。
- **测试与证据**：`test/git-import.test.ts`（真 clone 全链、钩子剥离负断言、`.AIWS` 排除双证、结构闸六种负例、CLI 冒烟、升级四点 + 幂等 + 错家拒收）、`test/company-validate-cli.test.ts`（CLI 通道）。**未证**：真实远端网络失败、私有仓认证失败文案、超大仓耗时。
- **规模与验收**：541 行。`RepoImportResult` 的字段是 CLI 与 daemon 的对外形状，增字段须同批改消费者。

---

#### F-company-create · `packages/company/src/create.ts`（529 行）

- **处置**：目标-保留。
- **归属**：实现层；docs/36-§4 M-B 骨架刀（一条命令建司）；76 `DEF-PKG-08`（创建 ≠ 激活：建号与装插件不等于公司已激活履职）。
- **职责 / 非职责**：按固定六相位编排建司：`init → provision → accounts → jobs → plugins → report`；幂等、`--dry-run` 零落盘。**不**决定公司定义（模板给定）、**不**激活、**不**直接绑平台（经注入的 `FlowPlatform`）。
- **内部结构**：
  - `export const CREATE_PLATFORMS = ['localfile'] as const`、`CreatePlatform`；`export const CREATE_PHASES = ['init','provision','accounts','jobs','plugins','report'] as const`；`CreatePhaseName`；`CreatePhaseStatus = 'created'|'adopted'|'provisioned'|'skipped'|'planned'`；`CreatePhaseOutcome`；
  - `export interface AccountProvisioner { … }`、`AccountProvisionReport`、`export type JobsSeeder = (jobs, now) => { seeded; kept }`；
  - `export interface CompanyCreateOptions`（`slug`、`name?`、`targetDir?`、`templateDir?`、`workRoot?`、`platform?`、`platformPort?`（实例或**惰性工厂**——dry-run 从不解析工厂）、`accounts?`、`jobsSeeder?`、`pluginRoot?`、`aiwsRoot?`、`reportRoot?`、`dryRun?`、`createdBy?`、`now?`、`confirmInstall?`）；
  - `export interface CompanyCreateResult { slug; dir; gitCommit?; snapshot; phases; aiws; reportFile?; install? }`；
  - `export function createLocalAnchorAccounts(orgConfigSrc): AccountProvisioner`——本地退化建号（改 `org-config` 文本锚，`create/platform-*` 错误族）；
  - `export function renderCreateReport(input): string`；`export async function companyCreate(opts): Promise<CompanyCreateResult>`；
  - 私有：`GIT_IDENTITY = { name:'studio-next-create', … }`、`defaultTemplateDir`、`mountOrReject`、`adopt`（已存在公司走 adopt 而非重建）。
- **导出与依赖**：导入 `node:fs`/`node:fs/promises`/`node:path`/`node:url`、`simple-git`、契约 `configInvalid` + 类型（`CompanySnapshot`/`FlowPlatform`/`PersonRef`/`ScheduledJob`）、本地 `init`、`git-import`、`aiws`、`validator`、`dependencies`。**devDependency `localplatform` 只在测试侧**（`createLocalPlatform()` 注入），生产不 import——这是 79-§10.1 判定「正确」的确切含义。
- **IO 与注入**：**重 IO**：建目录、改 `org-config` 文本、git 提交、建 `.AIWS`、装插件、写报告。注入面全：`now?`、`platformPort?`（实例或工厂）、`accounts?`、`jobsSeeder?`、`pluginRoot?`、`confirmInstall?`、`dryRun`。
- **状态与并发**：幂等键是 `slug` + 目标目录：已有同名公司 → `adopt`（不重建）；`dryRun` 下所有相位标 `planned`，零落盘（`gitCommit`/`reportFile` 为 `undefined`）。相位顺序固定，任一相位失败即整条失败（不做「部分成功」）。
- **错误与观测**：subcause 全表：`create/bad-slug`、`create/bad-name`、`create/bad-platform`、`create/target-unreadable`、`create/target-not-company`、`create/template-missing`、`create/template-not-mountable`、`create/platform-anchor-missing`、`create/platform-already-bound`、`create/platform-bind-failed`、`create/platform-mismatch`、`create/slug-mismatch`、`create/accounts-inconsistent`。报告文件是人读验收面（每相位一行状态）。
- **测试与证据**：`test/create.test.ts`（tmp + `GIT_*` 注入 + `FIXED_NOW`；注入 `createLocalPlatform()`、`JobsSeeder`、`AccountProvisioner`；含 spawn 冒烟）。
- **规模与验收**：529 行。`CREATE_PLATFORMS` 只有 `localfile`——taiga/youtrack 接线归后续单，**不得**在文档或 UI 声称已支持。

---

### 4.5 报表面

#### F-company-reports · `packages/company/src/reports.ts`（376 行）

- **处置**：目标-保留；**三处口径目标-替换**（金额/身份/日界，见下"与 80-§4.1 的对齐"，D17）。
- **归属**：实现层；04-§三 报表核心契约、docs/50 断链6（人→部门→公司逐级聚合、零自评）、77 `REC-OBS-01`（快照字段含口径与来源）、80-§4.1 `TS-SCALAR-04/08/09`、§9.4（UTC 日键 vs 公司本地日）。
- **职责 / 非职责**：把台账切片（`events`/`work_records`/`people`）聚合成**月度快照**，渲染 md，并按约定路径材料化。**不**取数（台账查询归调用方/daemon）、**不**写盘（写面是注入的 `writeRelFile`）、**不**做评价（零自评指标：数字全来自台账）。
- **内部结构**：
  - 常量：`export const MONTHLY_CALIBER = 'monthly/v1'`、`export const UNKNOWN_DEPT = '(unknown)'`、`export const UNATTRIBUTED_PERSON = '(unattributed)'`；
  - 输入/输出形状：`MonthlyAggregationInput { month; events; workRecords; people }`、`PersonMonthlyMetrics`（`hours_ms`/`cost_usd`/`work_cost_usd`/`delivered`/`llm_events`）、`DeptMonthlyMetrics`、`CompanyMonthlyMetrics`、`MonthlyReportSnapshot { schema:'monthly-report/v1'; caliber; company; month; generated_at; basis:'events+work_records+people'; metrics; departments; persons }`；
  - 纯函数：`monthWindow(month)`（UTC 闭区间 `since`/`until`）、`monthlyAnchorDate(month)`（当月末日 UTC，作为 `reports.date`）、`personMonthlyMetrics`、`rollupDeptMonthly`、`rollupCompanyMonthly`、`buildMonthlySnapshot`、`monthlyReportPaths({company, month, summary})`、`renderMonthlyReportMarkdown(snapshot, {level, author})`；
  - 材料化：`MaterializeMonthlyReportDeps`（`now` + `writeRelFile(relPath, content)` 注入）、`MaterializedMonthlyReport { report; mdPath; jsonPath; snapshot; md; json }`、`materializeMonthlyReport(deps)`；
  - 接口位（**只留类型槽**）：`ReportOperationRequest`、`ReportOperationResult = {ok:true;note} | {ok:false;reason}`、`ReportOperationHandler`——docs/49 MCP 缓办令：**不实现、不接网关**；
  - 私有：`MONTH_KEY_RE = /^(\d{4})-(\d{2})$/`、`actorPersonId`（`工号:账号` → 工号）、`contentAddressedId`。
- **导出与依赖**：导入 `node:crypto`（`createHash`，内容寻址 id `monthly-<sha256前12>`——**目标见 D17②**）、契约 `configInvalid` + 类型 `EventRecord`、`@studio-next/store`（**仅 type**：`PersonRecord`/`ReportRecord`/`WorkRecord`）。**不引** `core`/`panel`/`api`。
- **IO 与注入**：**唯一 IO 触点**是 `materializeMonthlyReport` 的两个注入项：`now: number`（生成时刻）与 `writeRelFile`（由 daemon 以「唯一写入者」身份提供）。本模块**不触盘、不取时钟**——`buildMonthlySnapshot` 要求调用方传 `generatedAt`。`node:crypto` 的 sha256 是内容摘要，不是随机。
- **状态与并发**：幂等键是**内容寻址 id**：同内容同 id（库侧幂等跳过），内容变 id 变（覆盖换代）。无内部状态；可重入。**注意两个不同问题**：(a) 幂等键可用内容摘要；(b) **身份**不得用短哈希——`reports.id` 落库后是记录身份，目标必须是完整 `semanticDigest`（80-§4.1 `TS-SCALAR-08`），短形只作展示/日志关联（D17②）。
- **错误与观测**：`configInvalid('company/reports:bad-month')`（月键非法/月份越界）——按 80-§5.7 补 `failure:'rejected_precondition'`、`category:'CONFIG_INVALID'`，`subcause` 保留现值（`company/reports:bad-month` 是既有稳定细目）。归属诚实：缺失部门 → `(unknown)` 桶，归属不到人 → `(unattributed)`，镜像缺 name → `''`（**不臆造名字、不补零冒充**，对齐 77 `REC-OBS-02`）。`basis` 字段声明数字来源，使快照可回放。**未挂载的数据源不得写成 0**：缺 `events`/`work_records`/`people` 任一切片时，调用方必须以 `unknown` 段 + 原因表达（`REC-OBS-02`），本模块不替调用方补数。
- **与 80-§4.1 的对齐（D17，三条均为迁移项，不是已修）**：
  1. **金额**：`MonthlyReportSnapshot` 现在全用 `*_usd: number`（`monthly-report/v1`）。按 `TS-SCALAR-09`，`Money.usd: number` **只作内存计算与旧记录兼容**，不得进公共签名/API 响应/记录契约；公共金额一律 `{ amount: DecimalString; currency: string }`，边界转换不经 float、不四舍五入。目标：`monthly/v2` caliber 起，快照与 md 的对外金额改 `DecimalString` + 显式币种（默认 `USD`），`v1` 保持可读、不原地改义；累加仍可用 number（内存），但落快照前必须走十进制串化，且**不得**用 `toFixed(2)` 冒充精确值。
  2. **身份**：`contentAddressedId` 现在取 sha256 前 12 位（`reports.id`）。短哈希**只作展示与日志关联**（`TS-SCALAR-08`），不得作身份/去重键/缓存键；目标改为完整摘要（`Digest` 值，含 `canonicalizationId` 说明），短形只出现在人读标签。库侧幂等语义不变（同内容同 id），但 id 的取值换成全量。
  3. **日界**：`monthWindow` 是**UTC** 月窗，`monthlyAnchorDate` 是 UTC 末日——这是"跨机器可比的聚合桶"，**不是**公司本地日。按 80-§9.4/§4.1，公司本地日（含月报归属日）必须由公司目录**显式声明的时区/偏移**决定（`CompanyZone = { iana; offsetMinutes? }`，取自公司配置），不得读宿主时区。目标：`monthWindow`/`monthlyAnchorDate`/`monthlyReportPaths` 增加显式 `zone` 参数；**缺省保持 UTC 语义不变**（不悄悄改既有口径），`monthly/v1` 的 UTC 结果原样可复算；本地日历月必须用新 caliber 值并同批改消费者。
- **测试与证据**：`test/reports.test.ts`（月窗闭区间/闰年、三指标口径、归属最近 `work_record`、逐级聚合不跳级、快照形状、md 渲染、材料化幂等 id）。**未证**：真实台账查询（本模块只吃切片）、跨时区显示（口径固定 UTC，本地日未实现）、大月数据量耗时、金额十进制串化的跨实现一致（V2）、`DecimalString` 与现有 `number` 的逐值等价。
- **规模与验收**：376 行。`schema`/`caliber` 值变更属快照格式变更，须换版本值并同批改台账消费者（store/daemon），**不得**在同一提交里同时改 v1 语义与消费者。

---

### 4.6 模板与命名面

#### 模板包消费契约（`templates/**`）

> 边界声明：模板的**逐文件契约**归 `81-files/19-root-guards-templates.md`；本附录只定义 `company` 侧如何**消费**模板（复制、占位替换、自检、再生成），不在此新增模板文件 ID，也不重复 19 的逐文件设计。

- **模板包清单**（文件数按仓树实数）：

    | 模板包 | 文件数 | 结构要点 | 维护方式 | 消费方 |
    |---|---|---|---|---|
    | `company-2-level` | 9 | 单部门「工程部」+ 1 人（`AGENT-1`）；**无** `dependencies.yaml`、**无** `plugins/`；`docs/`、`reports/` 只有 `.gitkeep` | 手工维护；共享资产的**单一事实源** | `init` 缺省模板；`gen-template` 直读其 `charter.md`/`README.md`/`prompts/company.md` |
    | `company-3-level` … `company-9-level` | 16 / 19 / 26 / 32 / 31 / 35 / 25 | 逐级骨架由 `LEVEL_SPECS` 决定（部门/人员/汇报线）；L6 起出现嵌套部门（`departments/<部>/departments/<子部>/`） | **全部由 `gen-template` 生成**，与仓树逐字节一致（测试锁） | `init --template company-<n>-level` |
    | `company-game` | 16 | 内容部 + 研发部（3 人）+ `dependencies.yaml` + `plugins/dsh-asset-check/{cordis.patch.yml,package.json,src/index.mjs}` + `docs/赛季节奏.md` | 手工维护的行业样例 | 行业起点（`init` 指定模板名） |
    | `company-internet` | 16 | 增长部 + 研发部（3 人）+ `dependencies.yaml` + `plugins/dsh-web-test/{cordis.patch.yml,package.json,src/index.mjs}` + `docs/发布节奏.md` | 手工维护的行业样例 | 行业起点（`init` 指定模板名） |

- **3–9 的生成契约**：`renderLevelTemplate(level)` 只产出 `org-config.yaml`、`.studio-next.yaml`、`docs/.gitkeep`、`reports/.gitkeep`、各部门 `config.yaml` 与 `people/<工号>.md`；`charter.md`/`README.md`/`prompts/company.md` 从 2 级模板**直读复制**（不另写、不参数化）。因此改这三件共享资产 = 改 2 级模板，3–9 随重生成同步；**2 级模板不得由生成器写**（它是上游）。生成器写入用「先 `rm -rf` 目标目录再写」，重生成对陈旧文件零残留。
- **占位协议**（七处；`gen-template.selfCheck` 与 `init.replaceOnce` 双向断言「恰好一次」，任一漂移即 `init/template-placeholder-drift`——停手改模板，不改代码迁就）：

    | # | 占位 | 落点 | `init` 替换为 | 断言方 |
    |---|---|---|---|---|
    | 1 | `slug: example-corp` | `org-config.yaml` `company.slug` | `opts.slug` | 生成自检 + init |
    | 2 | `name: 示例公司` | `org-config.yaml` `company.name` | `opts.name ?? opts.slug`（非安全字符走 YAML 引号转义） | 生成自检 + init |
    | 3 | `# 示例公司（公司自述）` | `README.md` 一级标题 | `# <name>（公司自述）` | 生成自检 + init |
    | 4 | `template: <模板名>` 行 | `.studio-next.yaml` | 请求的模板名（**行级键**替换，行内注释保留；2 级路径输出不变） | 生成自检 + init |
    | 5 | `created_at: null` | `.studio-next.yaml` | init 时刻（ISO 8601 带偏移） | 生成自检 + init |
    | 6 | `last_validated_at: null` | `.studio-next.yaml` | **自检通过后**的时刻（先检后写，不先盖戳） | 生成自检 + init |
    | 7 | `last_validation: null` | `.studio-next.yaml` | `pass`（仅在自检真过后写入） | 生成自检 + init |

- **资产规则**（75-§4.3 否定约束 + 76 `DEF-PKG-04`）：模板内不得含可执行脚本、安装/激活钩子、秘密值、本机绝对路径、宿主环境插值、网络请求、任意模板求值、隐式当前时间或随机结果。`prompts/` 是人读资产（76 `DEF-PKG-01g`），**不构成机器权能**；渲染模板 ≠ 激活公司（76 `DEF-PKG-08`）。花名由模板名作种子确定性生成（不用 `Math.random`）。
- **空目录**：`docs/`、`reports/` 以 `.gitkeep` 占位（git 不跟踪空目录）；二者是运行期落点，不是配置面，`A-1` 封闭集按文件判定不受影响。
- **消费顺序**：`init` = 复制模板树 → 七处占位替换 → `loadCompanyDirectory` 自检（含 slug 回读）→ 盖校验戳 → `git init` + 首提；任一步失败撤除半成品（宁失败不半成品）。模板目录**只读消费**，`init` 不回写模板。

#### F-company-level-specs · `packages/company/src/level-specs.ts`（314 行）

- **处置**：目标-保留。
- **归属**：实现层；docs/33-§3 逐级部门表是**唯一事实源**，本文件是其在代码侧的结构化投影。
- **职责 / 非职责**：给出 L3–L9 七级的形态、编制区间、跨度、部门与人员骨架，并做结构自检。**不**渲染模板（归 `gen-template`）、**不**决定公司实际编制（模板只是脚手架）。
- **内部结构**：`export interface LevelDeptSpec`/`LevelPersonSpec`/`LevelSpec`（含 `form`/`headcount`/`span`/`note`，后三者是 docs/33 的注释口径，**不是运行时约束**）；`export const LEVEL_SPECS: LevelSpec[]`（`level: 3..9`，每级部门与人员逐条列出，人员带 `id`/`role`/`level`/`dept`/`reportsTo`）；`export function levelTemplateName(level): string`（`company-<n>-level`）；`export function levelSpec(level): LevelSpec`；`export function rootDepartments(spec): LevelDeptSpec[]`；`export function assertLevelSpec(spec): void`（结构不合法即抛）。
- **导出与依赖**：**零 import**——纯数据 + 纯函数，不依赖任何包。这是刻意的：分级规格是数据，不应被 schema 库绑死。
- **IO 与注入**：零 IO、零时钟、零随机。
- **状态与并发**：常量数组；`assertLevelSpec` 供生成器与测试调用。
- **错误与观测**：`levelSpec` 对未知等级抛普通 `Error`（编程错误面：等级 3–9 之外本不该被请求）；`assertLevelSpec` 抛普通 `Error`（不变式破坏，非业务失败）。
- **测试与证据**：`test/gen-template.test.ts`（七套模板全绿即间接证明规格可渲染）、`test/industry-templates.test.ts`（同 schema 不同资产）。**缺**：规格本身的逐级结构断言（可由 `assertLevelSpec` 直调补测）。
- **规模与验收**：314 行。改部门/人员骨架 = 改公司形态语义，须同步 docs/33-§3 并重生成全部模板（`gen-template` 的逐字节一致性测试会红）。

#### F-company-gen-template · `packages/company/src/gen-template.ts`（382 行）

- **处置**：目标-保留。
- **归属**：实现层；docs/36-§4 M-A、docs/33-§3。
- **职责 / 非职责**：把 `LEVEL_SPECS` 渲染成 `templates/company-{3..9}-level/` 七套骨架并写盘；生成后自检（init 占位恰好一次 + `loadCompanyDirectory` 全绿 + level 回读）。**不**发布模板、**不**改共享资产（共享资产以 2 级模板为单一事实源，直接复制）。
- **内部结构**：`export function baseTemplateDir(): string`（与 `init.defaultTemplateDir` 同锚）；`export interface RenderOptions { baseTemplateDir? }`；`export async function renderLevelTemplate(level: number, opts?): Promise<Record<string,string>>`（**纯内存不落盘**，但会读 2 级模板的共享资产 `charter.md`/`README.md`/`prompts/company.md`——因此是 async）；`export interface WriteResult { level; dir; fileCount; deptCount; peopleCount; jobCount }`；`export async function writeLevelTemplate(level: number, outRoot: string, opts?)`（先 `rm -rf` 目标目录再写，保证零残留）；`export async function regenerateLevelTemplates(outRoot, opts?)`（3–9 全量）；私有 `SKILLS_BY_PREFIX`（工号前缀 → 技能，骨架示意）、`skillsFor`、`namesFor`（种子=模板名，花名序列冻结）、`renderOrgConfig`/`renderDeptConfig`/`renderPersonFile`、`selfCheck`（`assertExactlyOnce` 占位断言 + `loadCompanyDirectory` + level 回读）。
- **导出与依赖**：导入 `node:fs/promises`、`node:path`、`node:url`、本地 `validator.loadCompanyDirectory`、`namer.codenames`、`level-specs`（5 值 + 3 类型）。**不 import `init`**（避免与 `init → validator` 形成更长的环；只共用同一路径锚的语义）。
- **IO 与注入**：写盘 + 读 2 级模板资产；`baseTemplateDir` 可注入（测试/隔离面）。零时钟（生成内容不含时间戳——`created_at` 留 `null` 由 `init` 填）。
- **状态与并发**：渲染纯函数；写盘前先 `rm` 目标目录再写（**破坏性**：重生成会丢弃目标目录内一切内容——只在模板目录上使用）。自检失败则不落盘（红即停）。
- **错误与观测**：自检失败抛错误并指出是哪一项（占位次数、目录校验 issue、level 回读不符）；不静默降级。
- **测试与证据**：`test/gen-template.test.ts`（仓树逐字节 == 生成器输出、七套模板全绿、确定性两遍字节全等、共享资产同文、深度 2 嵌套识别）。
- **规模与验收**：382 行。模板是**仓内资产**，改生成器必须同批重生成并提交模板文件，否则测试红。

#### F-company-namer · `packages/company/src/namer.ts`（81 行）

- **处置**：目标-保留。
- **归属**：实现层；docs/36-§4 M-A。
- **职责 / 非职责**：按种子确定性生成员工花名（两字中文，批内唯一）。**不**持久化（名字落 `org-config` 后即成事实）、**不**保证跨公司不重名。
- **内部结构**：`export function fnv1a(input: string): number`（32 位哈希）、`export function mulberry32(seed: number): () => number`（确定性 PRNG）、`export const NAME_POOLS`（32×32 中文单字，**人工冻结**）、`export function codenames(seed: string, count: number): string[]`。
- **导出与依赖**：零 import——纯函数，无 zod/yaml/契约依赖。
- **IO 与注入**：零 IO；**随机性由种子确定**（不用 `Math.random`），种子由调用方给（模板名）。
- **状态与并发**：纯函数；同种子同序列。
- **错误与观测**：`count` 非非负整数、或 `count > 1024`（32×32 词域）即抛普通 `Error`（调用方错配，非业务失败）；重拾环超限（`count*64+4096`）亦抛，用于挡死循环。无分类错误（属 79-§3.4 允许的自然异常）。
- **测试与证据**：`test/namer.test.ts`（确定性、发散、唯一、两字形态、词池尺寸、域守卫、**黄金序列锚**）。
- **规模与验收**：81 行。**改词池 = 重新冻结黄金序列**，属口味变更，须同批改测试；不得悄悄改池。

---

### 4.7 包根与配置件

#### F-company-index · `packages/company/src/index.ts`（88 行）

- **处置**：目标-保留；`PACKAGE_STATUS` 常量 **目标-退役**。
- **归属**：实现层装配面（包根再导出）。
- **职责 / 非职责**：声明包的公开面与定位（头注是「这包是什么」的权威说明），并按域 `export *` 再导出。**不**持有逻辑、不**做**初始化副作用（无顶层 IO、无 env 读取）。
- **内部结构**：现有 `export const PACKAGE_NAME = "@studio-next/company"`；`export const PACKAGE_STATUS = "skeleton"`；13 条 `export *`：`validator`、`cadence`、`reports`、`init`、`trust`、`aiws`、`git-import`、`repo-validate`、`dependencies`、`create`、`namer`、`level-specs`、`gen-template`。
- **目标内部结构（本轮定，不新增公共概念）**：`export *` 增至 15 条 = 现有 13 条 + `dep-graph` + `projections`。`src/repo/*` **不单列 export**：由 `repo-validate` facade 统一再导出（`export * from './repo/input.ts'` 等），因此 `index.ts` 不因拆分改两次。**不得**导出 `src/repo/*` 的私有表（`CLOSED_*`/`WALK_SKIP_NAMES`）。
- **未直接再导出的模块**：`multifile`、`jobs`、`groups`、`hooks`、`cost-guard`、`state-hygiene`、`type-inbox`——它们的符号经 `validator` 的 import 汇入公开面（`multifile` 的 `lineOfPath`/`zodIssuesToDirectoryIssues`/`ORG_CONFIG_SCHEMA_LITERALS`/`multifileRules` 因此事实上可被外部访问）。这是「间接公开」，不是刻意设计——目标：**显式化**（要么直接再导出，要么把不打算公开的符号收为内部），否则公开面靠 import 图推断，无法机械核对（D12）。
- **导出与依赖**：只 import 本地模块；零外部依赖。
- **IO 与注入**：零 IO；模块求值期无副作用（`export *` 只绑定，不执行）。
- **状态与并发**：常量。
- **错误与观测**：无。
- **漂移（D1）**：`PACKAGE_STATUS = "skeleton"` 与实现现状（21 个 src 模块、21 个测试文件、CLI 已在用）**不符**；它是对外导出的字符串常量，删除属破坏性变更，须批示后「改为 `ready` 或删除」。
- **测试与证据**：无直测——由全部测试的 import 路径间接证明可加载。**未证**：公开面清单的机械核对（见上）。
- **规模与验收**：88 行；新增模块必须同批在本文件登记 `export *`（否则模块成为「存在但不可达」）。

#### F-company-package-json · `packages/company/package.json`（25 行）

- **处置**：目标-保留（`panel` 侧的依赖归类属 `panel` 的清单，不在本文件）。
- **归属**：79-§7 清单规范、79-§4.4 两态导出。
- **内容**：`name`/`version`/`private:true`/`type:"module"`/`description`/`main:src/index.ts`/`exports:{".":"./src/index.ts"}`/`scripts.typecheck`/`scripts.test`/五个 prod 依赖/一个 dev 依赖（见 §1.3）。
- **边界**：`private:true` ⇒ 永不发布；无 `files` 白名单（不发布即不需要）；无 `build`（源码态直跑，79-§5.2）；`exports` 只有 `"."`——**不得**新增子路径导出（会扩大公开面且绕过包根说明）。
- **验证**：`bun run typecheck`（包级）与根 `bun run typecheck`；`bun run guard:boundaries` 校验依赖方向与尺寸。

#### F-company-tsconfig · `packages/company/tsconfig.json`（5 行）

- **处置**：目标-保留（门禁缺口登记）。
- **内容**：`extends: "../../tsconfig.base.json"`；`include: ["src/**/*.ts"]`。
- **边界**：**`test/` 不进包级 typecheck**——79-D10 已登记的门禁缺口；根 `tsconfig.json` 同样只 include `packages/*/src/**`。因此测试文件的类型错误不会被 `bun run typecheck` 捕获，只能靠 vitest 运行时暴露。
- **目标**：随 79-D10 的统一处置（把测试纳入类型门禁或明确豁免理由），**不在本附录私改**；改动须同时改根 `tsconfig` 与 guard 口径。
- **验证**：`cd packages/company && bun run typecheck`。

---
### 4.8 目标新增件

#### F-company-projections · `packages/company/src/projections.ts`（**目标-新增**）

- **处置**：**目标-新增**。上位：80-§9.4 M1「`buildOrgTree`/`buildProgressSnapshot`/`buildFinanceSnapshot` 下沉为 `company` 的纯函数（零 IO、零 Hono）」。
- **归属**：实现层；77 `REC-OBS-01`（投影快照字段与来源游标）、`REC-OBS-02`（监控故障一等）。
- **职责 / 非职责**：为 `:8789` 概览与 `:8788` 对外 API 提供**只读纯投影**：组织树、进度快照、财务快照。**不**查库（记录由调用方查好传入）、**不**做 HTTP（归 `api`/`panel` 的薄壳）、**不**补零（缺数据显示缺口）。
- **内部结构**：**逐字搬迁，签名与行为不变**——源在 `packages/panel/src/overview/views.ts`。三函数的字段级契约如下（搬迁后即本文件契约，`panel`/`api` 只消费不再定义）：
  - **`buildOrgTree(departments: DeptNode[]): OrgTree`**（源 `:172`）
    - 返回 `OrgTree = { roots: OrgTreeNode[]; promoted: DeptNode[]; cyclic: DeptNode[] }`，`OrgTreeNode = { dept: DeptNode; children: OrgTreeNode[] }`。
    - 归类规则（按输入序一次判定）：`parent === null` → 进 `roots`；`parent` 不在本次传入的部门集（悬空）→ 进 `roots` 且计入 `promoted`；`parent` 在集内 → 挂到父节点 `children`。
    - 成环处理：先从全部 `roots` 游历标记可达；**未达者全量收集后**才逐个提升为根并计入 `cyclic`——先游历会让环上后到者被误标「可达」，故顺序写死。任何部门都不会静默消失。
    - 排序：同层 `children` 保持快照原序；`roots` = 按输入序的「根 + 悬空父」节点，**其后**追加成环节点（`cyclic` 顺序）；`promoted`/`cyclic` 各自按输入序。不做字典序重排。
  - **`buildProgressSnapshot(mirrors: TicketMirrorRecord[], slug: string, stateMapping?: Readonly<Record<string,string>>): ProgressSnapshot`**（源 `:268`）
    - 返回 `{ basis: 'ticket-mirror'; note; total; byState: Array<{state, count}> }`。
    - 过滤：只计 `m.company === slug` 的行，`total` = 过滤后行数（不是全表行数）。
    - 状态名：`stateMapping?.[m.state] ?? m.state`——命中映射用公司态名，未命中保留原生态名；镜像行本身不改写（映射只是统计视图，平台状态不变）。
    - 排序：`count` 降序，同数按 `state.localeCompare` 升序（稳定序，与 `:8787` 事件分布同款输出确定性）。
    - `note`：恒为 `PROGRESS_NOTE`；`stateMapping` 非空时追加 `PROGRESS_MAPPING_NOTE`（映射口径透明可审计）。两段文案是**契约常量**，搬迁时逐字保留。
  - **`buildFinanceSnapshot(input): FinanceSnapshot`**（源 `:364`），入参字段全列：
    - `slug: string`、`budgets: BudgetRecord[]`、`mirrors: TicketMirrorRecord[]`、`peopleIds: ReadonlySet<string>`（本司花名册；镜像表无公司维，靠它判 `person` scope）、`events: EventRecord[]`（**必填**，调用方已按 `company` 维滤好；LLM 过滤在函数内做）、`reports?: readonly ReportRecord[]`（缺省=空段）、`readReportFile?: (jsonRef: string) => string | undefined`（缺省=全部「快照不可读」）。
    - scope 集：`company:<slug>` ∪ 所有 `m.company === slug` 的 `issue:<m.issue>` ∪ 所有 `person:<id>`；预算行按 `${scope_kind}:${scope_id}` 命中才计入。**不按 `company` 字段直连预算表**。
    - 三口径分列（与 `:8787` 成本卡逐字同源）：`kind='reserve'` → `reserveUsd += estimated_usd ?? 0`、`reserveCount += 1`；`kind='settle'` → `settleUsd += actual_usd ?? 0`、`settleCount += 1`；其余（refusal）→ `refusalUsd += estimated_usd ?? 0`、`refusalCount += 1`。`netUsd = reserveUsd − settleUsd`（**三口径不相加**，净额可为负）。未记金额的行计 0，不折算、不猜。
    - `llmDaily: Array<{date, costUsd, events}>`：只取 `event === 'LLM'`，按 `dayKeyOf(ts)`（UTC 日 `YYYY-MM-DD`）聚合，`costUsd += cost_usd ?? 0`、`events += 1`；按 `date` 升序，**只列有事件的日**（v0 稀疏口径，不补零）。
    - `monthly: MonthlyReportViewRow[]`：`reports` 逐行映射为 `{ id, date, caliber, jsonRef: r.json_ref }`；`metrics` 由 `readReportFile(jsonRef)` 的 JSON 正文窄面解析 `metrics.{hours_ms, cost_usd, delivered}` 三数值 → `{hoursMs, costUsd, delivered}`。坏 JSON / 坏形状 / 缺字段 / 读不到 → **整行仍在但 `metrics = undefined`**（零臆造，页面如实标注）。`report` 行顺序沿用入参。
  - **搬迁禁令**（只许改 import 来源）：不得改字段名与嵌套形状、不得改排序键、不得改口径文案（`PROGRESS_NOTE`/`PROGRESS_MAPPING_NOTE`/`FINANCE_NOTE`）、不得改 UTC 日键、不得把缺口补成 0，不得把 `metrics` 缺失折算成默认值。
- **导出与依赖**：导出上述三函数 + `OrgTreeNode`/`OrgTree`/`ProgressSnapshot`/`FinanceSnapshot`/`FinanceBudgets`/`FinanceLlmDay`/`MonthlyReportViewRow` 与三段 note 常量；依赖 `@studio-next/contract`（`DeptNode` 等 + 值 `dayKeyOf`/`DAY_MS`）、`@studio-next/store`（**仅 type**：`BudgetRecord`/`TicketMirrorRecord`/`EventRecord`/`ReportRecord`）。**前置**：`dayKeyOf`/`DAY_MS` 须先按 80-§9.4 M1 从 `panel/src/views.ts:313`/`:321` 移入 `contract`；**未移入前本文件不得开工**（否则只能反向 import `panel`，制造非法边）。
- **与 `mapState` 的分工（80-§6.6 / 78 `BIND-CORE-01`）**：本文件的 `stateMapping` 入参是**静态统计映射**（`CompanySnapshot.stateMapping`，公司声明面），只用于把平台态名换成公司态名做聚合。它**不是** `PlatformBindingPort.mapState`：
  - 不得因"未映射"返回错误或默认态——未映射就保留原值（与 `mapState` 的 `verification:'unverified'` + `workStates:[]` 同侧语义）；
  - `workStates=[]` 的消费方禁止迁移/验收/结清；本文件的输出**不得**被 `decide`/状态机/结清读取（80-§6.6 第 1577 行）；
  - 平台原值必须原样保留（不归一化、不丢弃）；未知但合法的平台态是**观察事实**，不是 77 的"异常 unknown"（两者不同轴，`REC-EVT-03` 不因此产生）。
- **与 store 的 `ProjectionName` 不同物（80-§6.3）**：`src/projections.ts` 是**内存只读视图构造器**，不注册 `ProjectionName`、不写库、不产出可重建表投影。store 的 `ProjectionName`（含 `intentReceipts` / `observation`）与 `RecordReader.query`/`ReadOnlyLedger.query` 的 `{items,nextCursor}` 归 `81-files/03-store.md`；本文件只接收调用方查好的切片，**不得**新增"projection name"字面量或游标语义。
- **装配面（80-§9.4 装配决策 1）**：`apps/daemon/src/assembly/api/assemble.ts` 的 `assembleApi(deps: { ingress: Pick<IntentSubmissionPort,'submit'|'receipt'>; ledgerPath: string; company; config })` **不把投影当注入项**——`ApiServerOptions.views: { orgTree; progress; finance }` 是 `api` 包对本包的**编译期依赖**（`api → company` 已在允许边内），不是运行时回调；因此本文件三个 `build*` 的签名一旦变更，`api` 必须同批改。`assembleApi` 的 `ingress`/`ledgerPath` 与本包无关（本包不碰意图、不碰库）：HTTP 装配**只拿 `ingress`**（原样转发 `submit`/`receipt`），**不把 `deps.engine`/`db` 带进 HTTP**；`ledgerPath` 只是路径字符串，只读打开由装配体自建（`openLedgerReadonly`）。
- **IO 与注入**：**零 IO、零 Hono、零时钟**。日期口径固定 UTC（`dayKeyOf` 语义不变）；需要「公司本地日」时**必须显式传时区/偏移参数**（新增参数位），不得读系统时区（80-§9.4 明确禁止）；该参数所需的 `CompanyZone` 配置字段尚未落地（D26）。
- **状态与并发**：纯函数；同输入同输出；无缓存。
- **错误与观测**：无错误通道；**缺口必须显式**——缺记录显示「未挂载/未知」而不是 0 或空数组（77 `REC-OBS-02`）。搬迁后若上游壳把缺口转成 0，属壳的问题，不在本文件兜底。
- **测试与证据**：搬迁时**必须**把 `panel` 侧对应视图测试（若存在）一并迁到 `packages/company/test/`，并补「同输入字节相同」的对照；在搬迁完成前，本条目状态为**未落地**。
- **规模与验收**：约 300 行（三函数合计），单文件 < 600；`src` 直接层文件数 23 < 25。验收：`bun run guard:boundaries` 绿（不得新增 `company → panel`，也不得新增 `api → panel`——`api` 的 `views` 直接取本包，不经 `panel`）+ `panel`/`api` 改为从 `@studio-next/company` 取。

---

## 五、测试件与夹具

### 5.1 纪律

- 测试**只对契约与冻结验收口径负责**，不对实现细节负责；**禁止用 LLM 打桩**（AGENTS.md 四）。
- 隔离：一切写盘测试使用 `mkdtemp` 临时目录，**不触碰仓内模板、不触碰用户目录**（插件测试尤其断言不写 `~/.dsh`）。
- 确定性：时钟以 `now: () => Date` / `FIXED_NOW` 注入；git 身份以 `GIT_*` env 或 repo 局部配置注入；花名以种子冻结。
- 真实边界：`git-import`/`company-validate-cli` 用**真 clone / 真 tar / 真 spawn**；`repo-validate` 的 5000 文件用例真建文件（30s timeout）。
- fake 只许出现在 demo 与测试里，且**不得**冒充真实实现：`@studio-next/localplatform`（`devDependency`）是**真实实现**（本地文件平台），不是 fake；但 `test/create.test.ts` 注入 `createLocalPlatform()` 只证明「注入位可用」，**不证明**真机平台绑定（真机绑定归 `BIND-CORE-01` 的 `provisioning`/`uncoveredObjects`，未证）。`test/fixtures/**` 是**测试资产**，不是模板也不是 fake。
- 测试**不进包级 typecheck**（79-D10，见 D13）。

### 5.2 逐文件

| 稳定 ID | 路径 | 行数 | 覆盖与断言 | 缺口 / 未证 |
|---|---|---|---|---|
| `F-company-test-aiws` | `test/aiws.test.ts` | 207 | 建树同构、幂等（`created=0`）、根归属守卫（异 slug 拒）、离司归档不删、员工家内部不下探、撞名序号；tmp 隔离 + `fixedNow()` | 跨进程并发 ensure |
| `F-company-test-company-validate-cli` | `test/company-validate-cli.test.ts` | 185 | `spawnSync(process.execPath, [apps/daemon/src/cli/main.ts, …])` 直跑 CLI；退出码 0/1/2 三角；tarball 真解包；git-url 真 clone 本地仓；夹具 `fixtures/company-dist` | IPv6/网络错误文案；Windows 路径 |
| `F-company-test-cost-guard` | `test/cost-guard.test.ts` | 121 | 内存 files 直调 `loadCompanyDirectory`；CG-1..3 + 结构闸 + `cost_caps` 正/反 | core 预算求值联动（不属本层） |
| `F-company-test-create` | `test/create.test.ts` | 409 | 六相位顺序、`--dry-run` 零落盘、adopt、平台绑定回读、注入 `createLocalPlatform()`/`JobsSeeder`/`AccountProvisioner`、`GIT_*` + `FIXED_NOW`、spawn 冒烟 | taiga/youtrack 平台（未实现） |
| `F-company-test-dependencies` | `test/dependencies.test.ts` | 505 | 安装/替换/满足/冲突/缺失六态、`failOnMissing`、`confirm` 拒装零落盘、外部源按序、隔离根登记与日志、热更指纹（不变=零动作）；tmp 插件根 | 真实 dsh 加载；并发安装；磁盘满 |
| `F-company-test-deps-cases` | `test/deps-cases.test.ts` | 39 | 契约 `packages/contract/cases.json` 的 `deps` 域 17 case（C-deps-001..017）+ 反证 + 纯面直证 | 契约新增 case 后须同步 |
| `F-company-test-dir-cases` | `test/dir-cases.test.ts` | 71 | 契约 `dir` 域 3 case + 行号定位 5 例（`lineOfPath` 口径） | 全目录面契约（`dir2` 域未开批） |
| `F-company-test-gen-template` | `test/gen-template.test.ts` | 176 | 仓树逐字节 == 生成器输出；七套模板全绿；确定性两遍字节全等；共享资产同文；深度 2 嵌套识别 | 生成器在 Windows 换行差异 |
| `F-company-test-git-import` | `test/git-import.test.ts` | 469 | 真 clone 全链；钩子剥离负断言；`.AIWS` 排除双证；结构闸六负例（未知顶层/自带锚/自带 `.AIWS`/exec 位/符号链接/schema 坏）；CLI 冒烟；升级四点 + 幂等 + 错家拒收 | 私有仓认证；超大仓；中断残留 |
| `F-company-test-groups` | `test/groups.test.ts` | 180 | `org.groups` schema 正/负、跨规则、行号断言 | 组与人事事实一致性（跨文件，属 `multifile`） |
| `F-company-test-hooks` | `test/hooks.test.ts` | 190 | `org.hooks` 两类钩子正/负、`cost_threshold` 目标与泳道、行号 | 钩子执行（不属于本层） |
| `F-company-test-industry-templates` | `test/industry-templates.test.ts` | 217 | `templates/company-game`、`templates/company-internet` 全树直读；jobs 装载；资产在位；包侧 E 组纪律；插件形态；依赖求值；「同 schema 不同资产」 | 行业模板的语义正当性 |
| `F-company-test-init` | `test/init.test.ts` | 288 | 默认模板 init 全链；坏 slug；非空目标；自检失败撤除；D8 行级 `template` 键替换；spawn 冒烟（init→validate exit 0） | `created_at` 非注入（D6） |
| `F-company-test-jobs-loading` | `test/jobs-loading.test.ts` | 420 | 逐字段映射与缺省值；9 类非法条目行号；模板 jobs 自检；cadence 五档 + `at` 锚；`outputs`/`sla`/`escalate`；形状闸；`parseJobDuration`/`parseJobOps` 纯函数 | 调度器实际触发时刻 |
| `F-company-test-multifile` | `test/multifile.test.ts` | 439 | 全绿面；`dept`/`people`/`charter`/`meta` 各规则正/负；`strictFiles` 两态 | 数千文件规模下的耗时 |
| `F-company-test-namer` | `test/namer.test.ts` | 70 | 确定性、发散、批内唯一、两字形态、词池尺寸、`count` 域守卫、黄金序列锚 | 跨公司唯一（不承诺） |
| `F-company-test-repo-validate` | `test/repo-validate.test.ts` | 766 | A/B/C/D/E 每组「违法 FAIL + 孪生 PASS」配对；`--allow-extra`；产物面锚豁免；`.AIWS` 两面同禁；输入物化失败通道（现为 `RepoInputError`，目标 `Err(failure/category/subcause)`）；两遍共用判定器；E-4 5000 文件（30s） | `tar` 版本差异；符号链接在解包面的处置细节；拆分后**等价性**（facade vs `src/repo/*` 全字段比对）尚无基线 |
| `F-company-test-reports` | `test/reports.test.ts` | 235 | 月窗闭区间与闰年；三指标口径；归属最近 `work_record`；逐级聚合不跳级；快照形状；md 渲染；材料化内容寻址幂等 | 真实台账查询；跨时区显示；十进制串化与逐值等价（D17①） |
| `F-company-test-security-baseline` | `test/security-baseline.test.ts` | 163 | `isSafeRelativeOutputPath` 全口径；jobs `output`/`outputs` 路径域闸；`SLUG_RE` 单表（org-config 与 init 两通道）；本包零 `process.env`/零秘密库导入的负向断言（D23） | 79-§15 要求「每条正则都有长输入负测」：本文件只覆盖 `SLUG_RE` 与路径函数；`VERSION_SPEC_RE`/`DOCS51_SLUG_RE` 目前**无专门长输入用例**（仅形状类正负例） |
| `F-company-test-state-hygiene` | `test/state-hygiene.test.ts` | 175 | SH-1..SH-5 正/负；快照卫生标注不改入参 | 平台真实状态回写 |
| `F-company-test-workflows` | `test/workflows.test.ts` | 357 | 工作流 schema、边/锚/类型桶、TI-1..TI-3 经 `loadCompanyDirectory`、行号 | `yt.typeInbox` 缺省五态与 `git-import` 的同构由测试锁定（D11） |

以上主表共 **21 件现有测试**（`test/` 直下现有件全集）。以下三件为**目标新增测试**（对应 D5②、D2、D3；不占行数基线；加上后 `test/` 直下 24 件 ≤25）：

| 稳定 ID | 目标路径 | 预算行数 | 必须覆盖 | 不证明 |
|---|---|---|---|---|
| `F-company-test-trust` | `test/trust.test.ts` | ≤220 | 无锚=init 通道；**坏 JSON/形状不符 ⇒ Err(`trust/anchor-corrupt`)**，`trustStateOf` 不得读成无锚；approve 同指纹幂等不重复留痕；re-approve/revoke 的 history 追加；tmp+rename 原子写（并发读者不见半文件）；`trust.json` 无秘密字段 | 恶意改锚、跨进程并发批准、真实 daemon 挂载闸（`hot-reload` 侧） |
| `F-company-test-projections` | `test/projections.test.ts` | ≤260 | 三个 `build*` 与 `panel` 侧旧实现的**同输入同输出**对照；成环/悬空/提升顺序；未映射态保留原值；`workStates=[]` 不被读成 accepted/settled；UTC 日键不因本地时区改变；缺口不补 0 | 真 HTTP 面（api/panel）、真实台账查询、本地日折算（未实现） |
| `F-company-test-dep-graph` | `test/dep-graph.test.ts` | ≤240 | 六属性候选、命中、逐人启用集、全员需求集约束并集、版本两形态与 `satisfiesSpec` 边界、`planPluginInstalls` 六态、指纹确定性；与 `deps` 域 17 case 的同名断言 | 真实 dsh 加载插件、并发安装、磁盘满 |

### 5.3 夹具

| 路径 | 文件 | 用途 |
|---|---|---|
| `test/fixtures/company-dist/` | `.studio-next.yaml`、`README.md`、`charter.md`、`departments/工程部/config.yaml`、`departments/工程部/people/AGENT-1.md`、`dependencies.yaml`、`docs/upgrade-marker-v1.md`、`org-config.yaml`、`plugins/dsh-web-test/{cordis.patch.yml,package.json,src/index.mjs}`、`prompts/company.md`、`reports/.gitkeep`（11 文件） | 合法分发仓：`repo-validate` 的 PASS 面、`git-import` 导入/升级、CLI 三角 |
| `test/fixtures/company-src/` | `dependencies.yaml`、`org-config.yaml`、`plugins/dsh-web-test/{cordis.patch.yml,package.json,src/index.mjs}`（5 文件） | 源面仓库：判定器源面、`deriveFieldProvision`、插件形态 |
| `test/fixtures/plugins/dsh-git-flow/` | `cordis.patch.yml`、`package.json`、`src/index.mjs`（3 文件） | 外部插件源：安装/替换/外部源按序 |

夹具**是测试资产，不是模板**：不得被 `init`/`create` 当作生产模板使用（模板归 `templates/`，见 `81-files/19`）。

---

## 六、跨文件横切

### 6.1 错误通道

本包的错误面按 80-§5.7 的两轴重述：`ClassifiedError = { failure: FailureClass; category: ErrorCategory; subcause: string; detail?: string }`。`failure` 取 77-§11.1 的十四类原值（下划线形态，如 `rejected_precondition`），**驱动处置**；`category` 取 11 值，**只做观测**，不得据它分支。本包 Err 可达的 `category` 只有三个：`CONFIG_INVALID`、`EXTERNAL_REJECT`、`STALL`——其余三值（`EVOLVE_REJECT`/`MERGE_CONFLICT`/`NO_LANE`）本包不产生。

| 面 | 现状形态 | 目标 `failure` | 目标 `category` | 依据 / 漂移 |
|---|---|---|---|---|
| 校验族（`validator`/`multifile`/`groups`/`hooks`/`cost-guard`/`state-hygiene`/`type-inbox`） | tagged union `MountResult`（`ok` + 逐条 `{file,line,rule,fix}`） | **N/A（结论侧，不进 `Err`）** | **N/A** | 80-§5.7 把 `MountResult` 明列为 `Result` 的**既有等价物**；`DirectoryIssue.rule` 是定位标签，**不是** `subcause`；调用方必须分支处理（79-§3.4 第一行） |
| 判定（`repo-validate`） | tagged `RepoValidateResult`（五组逐条）；**输入物化失败**抛 `RepoInputError` | 结论侧 N/A；输入失败按 subcause 定：`repo/invalid-input`→`rejected_precondition`、`repo/archive-entry-unsafe`/`repo/archive-limit`→`rejected_forbidden`、`repo/source-missing`/`repo/tool-missing`/`repo/fetch-failed`→`unavailable` | 依次 `CONFIG_INVALID` / `EXTERNAL_REJECT` / `STALL` | 51-§七；§4.2 的失败矩阵；D5① |
| 依赖计划（`dep-graph`） | `PluginInstallAction` 六值联合（`install`/`replace`/`satisfied`/`conflict`/`missing`/`skip`） | **N/A（计划项不是错误）** | **N/A** | 79-§3.4 明列；冲突由调用方按动作分支，不转 Err |
| IO 编排（`init`/`git-import`/`create`/`aiws`/`dependencies`/`reports`） | `configInvalid(subcause, detail)` | `rejected_precondition` | `CONFIG_INVALID` | 79-§3.4 统一通道；80-§5.7 固定 `configInvalid` 的两值 |
| `cadence` | 裸 `Error` + 文本前缀 `CONFIG_INVALID：` | `rejected_precondition` | `CONFIG_INVALID` | **偏离** D4（迁移项：三条目标 subcause 见 §4.4） |
| `trust` | 零分类；坏 JSON/形状不符返回 `null`（消费方当「无锚」→ fail-open） | 坏锚 `rejected_precondition`；读失败 `unavailable` | 坏锚 `CONFIG_INVALID`；读失败 `STALL` | **偏离** D5②（安全缺口，优先级最高；§4.4 已给目标签名） |
| `namer`/`level-specs` | 自然异常（`TypeError`/`RangeError` 等） | **N/A（不可恢复编程错误不包装）** | **N/A** | 79-§3.4 最后一行；若确需标记，按 80-§5.7 用 `subcause:'internal-bug'`，**不得**造第 15 类 |
| 秘密面 | 本包零秘密消费（无 `SecretProvider`/`SecretMaterial`/env 读取） | **N/A** | **N/A** | §6.2、§十一 §11.2.1；本包不产生 `rejected_forbidden` 的秘密用途错误 |
| 台账面 | 本包不持 `Database`/`Ledger`，无 `TxReceipt`、无 `status:'unknown'` | **N/A** | **N/A** | 80-§6.3（`TxReceipt`）、§8.2（只读打开）；台账归 `store`/`daemon` |

〔结论 1〕`subcause` 是**实现细目**，用于日志与测试断言，**不是判等键**；跨包比对只认 `failure`。本包既有 subcause 见各条目；新增值须经契约/批示，不得临时造词。
〔结论 2〕`detail` 才放人读补充；中文标点（`：`）只能出现在 `detail` 或消息体，**不得**进入 `subcause`。
〔结论 3〕77 的失败类字面量**保留下划线原值**，不转驼峰、不加前缀；本包文档里的 `CONFIG_INVALID` 是 `category`，`rejected_precondition` 是 `failure`，两者不可互替。
〔结论 4〕`MountResult`/`RepoValidateResult`/`DirectoryIssue` 属**结论侧**：它们是「判定结果」，不是 `Err`，也不是 `FailureClass`；把 violations 塞进 `Err` 会丢失逐条定位，本包不得这样改。

### 6.2 注入点

| 面 | 现状 | 缺口 |
|---|---|---|
| 时间 | `aiws`/`create`/`git-import`/`dependencies` 接受 `now?: () => Date`；`reports` 接受 `now: number`；`buildMonthlySnapshot` 要求 `generatedAt` | `init.ts:205`、`trust.ts:117` 直接取墙钟（D6） |
| ID | `reports` 用内容寻址（sha256）而非随机 id；单据/事件 id 由调用方给 | 无 |
| 随机 | `namer` 用种子 PRNG（`mulberry32`），**零 `Math.random()`** | 无 |
| fetch | 本包**零 fetch**（平台访问经注入的 `FlowPlatform`） | 无 |
| CLI/子进程 | `repo-validate` 用 `spawnSync('tar')`；`simple-git` 调系统 `git` | 两者都未抽象为注入端口（测试靠真二进制；缺二进制时的错误面未证） |
| fs | 多数文件同时用 `node:fs`（`existsSync`）与 `node:fs/promises`；`trust`/`aiws` 以同步 fs 为主 | 风格不一致（D7） |
| env | 生产 `src` **零 `process.env`**（`TMPDIR` 由 `os.tmpdir()` 间接受影响） | 无明文凭据读取 |
| 秘密 / 凭据 | **N/A**：本包无 `SecretProvider`/`SecretCatalogEntry`/`SecretMaterial`，不读 `.env`、不接 `wkey`、不落密钥 | 不适用；`contract/src/ports/secret.ts` 属 daemon 装配面（§九 文件表第 2 行）。本包**不得**为插件/平台访问自造第二套凭据通道 |
| 意图 / 回执 | **N/A**：本包不实现 `IntentIngress`/`IntentReceiptStore`，不写 `REC-WORK-01/02`，不产出 `IntakeOutcome`/`IntentReceipt` | 不适用；公司目录「已挂载」检查由 daemon 调 `loadCompanyDirectory` 后再判（§九 文件表第 1/4 行） |
| 只读台账 | **N/A**：本包不持 `Database`/`Ledger`，不调 `openLedgerReadonly`，无 `RecordPage`/`TxReceipt` | 不适用；报表只吃调用方给的切片（`MonthlyAggregationInput`），取数归 `store`/`daemon`（§九 文件表第 5 行） |

### 6.3 纯面 / IO 面

- **纯面（零 IO）**：`validator`、`multifile`、`jobs`、`cadence`、`groups`、`hooks`、`cost-guard`、`state-hygiene`、`type-inbox`、`level-specs`、`namer`、`dep-graph`（目标）、`projections`（目标）、`reports` 的聚合与渲染段（材料化前的全部函数）。
- **IO 面**：`init`、`trust`、`aiws`、`git-import`、`create`、`repo-validate`、`dependencies` 的安装/状态段、`gen-template` 的写盘段、`reports.materializeMonthlyReport`（只经注入写面）。
- 〔结论〕纯面不得新增 `node:fs`/`node:http`/`node:child_process`/`execa`/全局时钟（79-§3.6 目标）。本包**不是**纯面（允许 fs），但**纯面 / IO 面必须可由 import 图机械判定**——拆分（D3）完成后，`dep-graph`/`projections` 应零 fs import。

### 6.4 与 80 定稿接口逐项对齐

本节的用途是**逐项回答「80 的接口本包用不用」**，不是复制 80 的字段表。凡标「不涉及」的，本包只承担一条义务：**不实现第二套、不复用其词表、不假设其语义**；跨卷缺口复核见 §九。

| # | 80 定稿接口（章节） | 本包是否涉及 | 落点 / 约束 | 缺口 / 回写点 |
|---|---|---|---|---|
| 1 | `RuleEvaluator.typecheck/evaluate`（80-§6.1，纯函数落 `core`，公共类型落 `contract`） | **不涉及** | `allowedPackageEdges` **无 `company → core`**，本包无法调用 `RuleEvaluator`；目录校验规则（A–E 五组）留在包内 `src/repo/`（§4.2/§4.2.1），不做 `RuleProfile` 求值、不自造「规则求值」词汇 | 无（`01-contract.md` v0.5：`typecheck`/`evaluate` 两阶段全走 `Result<…, ClassifiedError>`、`refused` 留 `Ok`，`F-contract-port-spec` 已按此写） |
| 2 | `ClassifiedError` 两轴（80-§5.7） | **涉及全部 `Err`/`throw` 面** | 见 §6.1 表：`failure` 驱动处置、`category` 只观测；`configInvalid` 固定 `rejected_precondition`/`CONFIG_INVALID`；内部 bug 用 `subcause:'internal-bug'` | 无（本包侧）；`mount`/`repo` 结论侧不进 `Err` 已在 §6.1 结论 4 固定 |
| 3 | `IntentSubmissionPort`/`IntentReceipt`/`IntentIngress`（80-§6.4/§6.6） | **不涉及**（不实现、不调用） | 本包**不得**复用 `IntakeOutcome.outcome` 五值（`accepted\|accepted_with_conditions\|deferred\|rejected\|forwarded`）与 `IntentReceipt.status` 三值（`queued\|decided\|unknown`）作为目录/平台态词表；公司侧「是否已挂载」由 daemon 调 `loadCompanyDirectory` 后判定，本包不写 `REC-WORK-01`（`WorkIntake.reserve` 是唯一写口） | `contract/src/ports/intent.ts` 与 `apps/daemon/src/assembly/intent/*` 属他卷（§九 文件表第 1/4 行）；两处文件契约均已落卷（`01-contract.md` 的 `F-contract-port-intent`；`17-daemon-assembly-cli-control-evolve.md` 的 `F-daemon-intent-ingress`/`F-daemon-intent-receipt-store`），无缺口 |
| 4 | `assembleApi`（80-§9.4：`deps.ingress` 取 `Pick<IntentSubmissionPort,'submit' \| 'receipt'>`、`ledgerPath`） | **仅编译期依赖** | `api` 对 `company` 的 `views` 依赖是**编译期**的（`api → company` 允许边），不是注入项；本包不提供 `emitIntent`/`getIntentReceipt`/`companies`/`issuesView` 的实现，只提供 `loadCompanyDirectory`/`build*` 供其组装 | 无：`17-daemon-assembly-cli-control-evolve.md` 的 `F-daemon-api-assemble` 已按 80-§9.4 写 `deps:{ingress; ledgerPath; company; config}`、`openLedgerReadonly({path, expectedSchemaVersion, readOnly:true, queryOnly:true})`，删 `openLedger`/`platform`，转发面（`emitIntent`/`getIntentReceipt`）不触 `engine`/`db` |
| 5 | `PlatformBindingPort.mapState` / `BindingProfile` 20 字段 / `StateMapping`（80-§6.6、78 `BIND-CORE-01`） | **只产声明面** | 本包只输出 `CompanySnapshot.stateMapping`/`knownForeignStates`/`FieldProvisionMap` 作为**静态统计视图**；`mapState` 的运行时判定归 daemon。`stateMappings.ours` 只许 `STAT-D`；`provisioning` 缺 `pinnedVersion` 时 `signature:'unavailable'`（`dependencies` 安装面），**不得**凭 `verified` 假象供给；未映射但合法 ⇒ 由 daemon 返回 `Ok({workStates:[],verification:'unverified',unmappedBehavior:'observe-unmapped'})`，本包不得把未映射写成 `Err` | 见 D25（声明 vs 运行时分野） |
| 6 | `SecretCatalogEntry`/`SecretProvider`/`SecretMaterial`/`SecretUse` 六值（80-§11.2.1） | **N/A（零秘密消费）** | 不引 `contract/src/ports/secret.ts`，不读 env/`.env`，不落 `wkey`，不写正则识别秘密；spec 里的 `secretId` 名与 `SEC-*` 格式由 `contract`/78 定义 | 见 D23（零消费与断言）、D21（内容扫描未实现） |
| 7 | stdio / server 面（80 的 `studio-tools` 口径） | **N/A** | 本包无 stdio/server/长连接；CLI 入口在 `apps/daemon/src/cli`，本包只导出函数 | 无 |
| 8 | `Notification` / `NotifySendReceipt` / `NotifySendReport`（80-§6.6） | **N/A** | `contract` 的 `Notification` 是权威形状；本包不定义第二套通知类型，也不得把 `NotifySendReceipt{status,attempts,detail}` 与 `NotifySendReport{sent,failed}` 混用（两物分开） | 无 |
| 9 | `ProjectionName`/`RecordReader`/`RecordPage`/`TxReceipt`（80-§6.3）/`MigrationPlan`（80-§6.6） | **N/A 或 type-only** | 本包不持 `Database`/`Ledger`，无事务、无迁移、无 `TxReceipt.status:'unknown'`；`projections.ts` 的「投影」是**视图聚合**，不是 store 的 `ProjectionName`（后者含 `intentReceipts`，对应表族 `intent_receipts`；`daemon_kv`/`schema_version`/`hr_sync_log` 不是投影名） | 见 §4.8「与 store `ProjectionName` 不同物」 |
| 10 | 结构处置：`repo-validate` 留包内（80-§10.6）/ 开工五门：`core` 同步纯核 + daemon 侧端口 / `MergeRunHost` 真实名 / fakes 只 demo-test / `Money` / sha8 / UTC 日键 | **部分涉及（仅「留包内」与 UTC 日键）** | ① 80-§10.6 判「留 `company`，包内按规则族拆」，本附录照办（§4.2.1），**不下沉 core**；② `ReadinessGate` 端口（异步 `Result`、解析版本化引用、落 `REC-WORK-04`）在 daemon 引擎侧；`core/src/work-readiness.ts` 只提供**同步纯核**（输入已解析、输出判决 + 逐门诊断），端口包装在调用方（`02-core.md` §1.3）；两者都不属本包（见 §九 文件表第 3 行）；③ 本包不引 `MergeRunHost`（合并域归 daemon），文档若需引用只用其真实名，不自造别名（`MergeHostView` 是已废止的旧名）；④ fake 只许 demo/test，`localplatform` 是真实实现（§5.1）；⑤ 公共金额用 `DecimalString` + 币种，`Money.usd:number` 只内存/旧记录（§4.5）；⑥ 短哈希（sha8 类）只展示/日志，不作身份/去重键（§4.5）；⑦ `dayKeyOf` 是 UTC 聚合桶，公司本地日必须显式 `CompanyZone`（§4.8、D26） | 无（`02-core.md` §13 已关闭：字节/路径/归档/纯配置留 `company`，core 只做规则求值） |
| 11 | `assembleApi` 的 `external` 配置语义（80-§9.4：`enabled/port/lan/token/requestsPerMinute/idempotencyTtlMs/allowedSources`，缺省 `['external-api']`，空数组=全 403） | **不涉及** | 本包不读 `ServeConfig`，不解释 `allowedSources`、不判 `enabled`；`now` 只属 `BuildRuntimeOpts` 的测试注入，本包函数一律**显式传时刻**（`generatedAt`/`now` 参数），不读墙钟 | 关闭=不启动面、开启缺件=整机 `configInvalid` 属 daemon 装配（见 §九 文件表第 5 行） |
| 12 | `ReferralTarget`/`IntakeOutcome`/异常 `unknown`（77 `REC-EVT-03`） | **N/A** | 三者不同轴：`ReferralTarget{positionRef,deadline,notifiedAt}` 是转呈目标；`IntakeOutcome` 五值是受理结论；77 的异常 `unknown`（含 `unknown_scope.intentRef`）是**记录侧异常分类**。本包不产出任一，**未映射的平台态 ≠ 77 异常 `unknown`**（前者是观察事实，后者是异常记录） | 无 |

〔结论〕12 条里本包真正「涉及」的只有 2（`ClassifiedError`）与 10 的局部；其余是**否定式约束**（不实现、不复用词表、不自造第二套）。否定式约束同样是契约：违反它比缺功能更难发现，测试须以负向断言锁住（如「本包不 import `ports/intent`」「`IntakeOutcome` 字面量不出现在 `src/**`」）。

---

## 七、目标态与迁移顺序

顺序写死，不可倒。每一步都以「测试绿 + `guard:boundaries` 绿 + 无新增允许边」为门禁；任一步失败即停手回写 80/79，不在本包内绕行。

| 步 | 动作 | 前置 | 门禁 / 回退 |
|---|---|---|---|
| M1 | `dayKeyOf`/`DAY_MS` 从 `panel/src/views.ts:313`/`:321` 移入 `contract`（`panel` 保留 re-export 过渡），`company` 从 `contract` 取 | 80-§9.4 M1 | 纯移动，不改 UTC 语义；`company → panel` 仍不存在；`panel` 旧导出仍可用一个版本 |
| M2 | 新增 `F-company-dep-graph` + `test/dep-graph.test.ts`：纯函数逐字搬迁，`dependencies.ts` re-export 过渡，`repo-validate` 的四个符号改线到 `dep-graph` | 无（可与 M1 并行） | 两文件总行数不增；`deps` 域 17 case 全绿；**必须先于 M4**（否则制造 `dependencies → repo-validate` 回环，§4.2） |
| M3 | `F-company-trust` 错误通道替换 + `test/trust.test.ts`：`readTrustAnchor` 改 `Result<TrustAnchor \| undefined>`，坏锚 `Err(trust/anchor-corrupt)`，`trustStateOf` 不得读成无锚 | 无（可与 M1/M2 并行；D5② 属安全缺口，排最前） | 负向用例：坏 JSON/形状不符 ⇒ `Err`；原「无文件 ⇒ 无锚」路径不变；原子写（tmp+rename）语义不退化 |
| M4 | `repo-validate` 包内拆分（5 步写死，§4.2）：① `src/repo/input.ts`+`render.ts` 纯搬移 → ② facade 改调、旧实现留一周期 → ③ `rules-file.ts`/`rules-graph.ts` → ④ 删本地实现 + 等价性比对 → ⑤ facade ≤150 | M2 稳定一个提交周期 | 每步后 `bun run typecheck` + `bun run test` + `bun run guard:boundaries` 三绿；`repo-validate` 只许降；等价性比对（violations/warnings/exempted 全字段）无差异；`src/repo/` 4 件各 ≤600 |
| M5 | 新增 `F-company-projections` + `test/projections.test.ts`：三个 `build*` 逐字搬迁，`panel`/`api` 改从 `@studio-next/company` 取 | M1（`dayKeyOf`/`DAY_MS` 已在 `contract`） | 同输入同输出对照（旧 panel 实现 vs 新函数）；`company → panel` 仍不存在；`projections` 零 fs/零 Hono import |
| M6 | `reports` 三口径迁移（D17）：金额 `DecimalString`+币种、身份全量摘要、月窗显式 `zone`；换 `monthly/v2` caliber | M1（UTC 日键助手）；`CompanyZone` 字段须先在公司配置里可读（D26） | `monthly/v1` 结果原样可复算、不原地改义；`v2` 消费者同批改；十进制串化与逐值等价用例先绿 |
| M7 | 错误通道两轴收口：`cadence`（D4）、`repo` 输入面（D5①）、`reports`（§4.5）、`dependencies` 错误面统一到 `{failure,category,subcause}` | M4、M6（被改的落点已稳定） | 每个面单独提交；`failure` 只取 77 十四类；`bun run test` 全绿；不新增 `category` 值 |
| M8 | 公开面显式化（D12：`index.ts` 的 `export *` 15 条）与 `PACKAGE_STATUS` 退役（D1，需批示） | M7；D1 须制作人批示 | 破坏性变更：须先发版本说明；`export *` 逐条与 §4.7 一致 |

〔结论〕M1/M2/M3 三条互不依赖，可并行；M4 依赖 M2；M5 依赖 M1；M6 依赖 M1 与 D26 的配置字段；M7 必须等 M4/M6；M8 最后且不得与结构迁移同提交（回退半径）。任一步失败即停手回写 80/79，不在本包内绕行。

---

## 八、漂移、缺口与待决

> 本节的「待决」只写**决策主体与影响**，不把未决项当技术空白，也不由本附录代决（75-§七）。

| # | 项 | 现状证据 | 目标 / 处置 | 决策主体 |
|---|---|---|---|---|
| **D1** | `PACKAGE_STATUS = "skeleton"` 与实现现状不符 | `src/index.ts`：包内已有 21 个 src 模块、21 个测试、CLI 在消费 | 目标-退役：改 `"ready"` 或删除该导出。**破坏性变更**（对外导出字符串） | 制作人批示（M9） |
| **D2** | 三个纯投影不在本包 | `buildOrgTree`/`buildProgressSnapshot`/`buildFinanceSnapshot` 现居 `packages/panel/src/overview/views.ts:172/:268/:364` | 按 80-§9.4 M1 下沉为 `F-company-projections`（本卷 M5）；**前置是 M1**：`dayKeyOf`/`DAY_MS` 必须先移入 `contract`，否则本包只能从 `panel` 取（无此边） | 已由 80 定方向；本附录只排顺序 |
| **D3** | 三个超限件 | `repo-validate.ts` 1021（基线 1021）、`dependencies.ts` 775（基线 775）、`validator.ts` 612（基线 655） | 只许下降；`repo-validate` 走 **M4** 包内 5 步拆分（facade ≤150 + `src/repo/` 4 件各 ≤600），`dependencies` 走 **M2** 拆出 `dep-graph`（两文件总行数不增），`validator` 后续外移规则体（≤600）；**三件都不下沉 `core`**；**不得提高基线** | 已由 80-§10.6 定方向；上升须提案流 |
| **D4** | `cadence.expandCadence` 抛**裸 `Error`**，仅以文本前缀 `CONFIG_INVALID：` 伪装分类 | `src/cadence.ts:84/:87/:90` | 改为 `configInvalid('<subcause>')`（`failure:'rejected_precondition'`、`category:'CONFIG_INVALID'`），三条 subcause 见 §4.4（`company/cadence:bad-at`/`hourly-with-at`/`day-anchor-unsupported`）；**不再保留文本前缀伪装**，也不改判为「不可恢复编程错误」——它是配置输入错误 | 工程选择（M7；`configInvalid` 语义已由 80-§5.7 冻结，不需另批） |
| **D5** | 三个非 `ClassifiedError` 触点 | ① `RepoInputError`（`repo-validate.ts:880`，CLI exit 2 面）；② `trust.readTrustAnchor` 对「坏 JSON/形状不符」返回 `null`，而消费方把 `null` 当「无锚=受信」→ **信任闸 fail-open**（`apps/daemon/src/control/hot-reload.ts:470`）；③ `level-specs`/`namer` 的自然异常 | ① **替换**为 `Result<…, ClassifiedError>`，按 §4.2 的 failure/category/subcause 表（`repo/invalid-input` 等）；② 改 `Result<TrustAnchor \| undefined>`：锚不存在 ⇒ `Ok(undefined)`，锚存在但不可解析 ⇒ `Err({failure:'rejected_precondition', category:'CONFIG_INVALID', subcause:'trust/anchor-corrupt'})`，读盘失败 ⇒ `Err({failure:'unavailable', category:'STALL', subcause:'trust/read-failed'})`；**fail-closed**，`trustStateOf` 不得把 `Err` 读成无锚；③ 保持自然异常（79-§3.4 允许） | ① 工程选择（M7）；② **工程选择但优先级最高**（安全缺口：fail-open 等于信任闸失效）；③ 已裁决 |
| **D6** | 时钟未注入 | `init.ts:205` `new Date().toISOString()` 写 `created_at`；`trust.ts:117` `Date.now()` 进 tmp 名 | 加 `now?(): Date` 注入（缺省墙钟），测试可确定化 | 工程选择（提案后可随拆分顺带办，不升基线） |
| **D7** | fs 风格不一致 | `trust`/`aiws` 用 `node:fs` 同步；其余用 `node:fs/promises` | 统一到 promises（`aiws` 是同步编排、改造成本低；`trust` 的原子写需保留 tmp+rename 语义） | 工程选择 |
| **D8** | 模板根路径靠跨包相对推导 | `init.ts`/`create.ts`/`gen-template.ts` 均 `new URL('../../../templates/company-2-level', import.meta.url)` | 发布/分发形态下该路径不成立。目标：改为**显式注入模板根**（缺省仍用仓内路径），使「源码态可用、分发态可配」 | 工程选择；分发形态本身归 79-§5.2 另审 |
| **D9** | 路径与归档安全只做了子集 | tarball 物化只拒**绝对路径**与 `..` 段（`repo-validate.ts:951`）；无 realpath 消解、无逐段设备文件/套接字检查；`DEF-PKG-05.A` 的归档限额（10 000 条目 / 64 MiB 单文件 / 512 MiB 总量 / 8 层 / 200:1 / 嵌套 1 层 / 链接）**未实施**；现有 `8 MiB`/`5000` 是 51-§六 E-4 的**仓库面**限额，不能替代归档限额；`readDirectoryFiles` 无二进制检测（一律 utf8，头注与实现不符） | 按 76 `DEF-PKG-05.P/.A` 补齐；在补齐前，本包对归档/文件输入的保证只到「拒绝明显逃逸、非普通文件不收」 | 工程选择 + 安全面须 82 V4 验证 |
| **D10** | `groups ↔ validator` 运行期循环 import | `groups.ts` 取 `validator.SLUG_RE`（仅在 `refine` 回调内），`validator` 取 `groups` 的 schema/规则 | 现有环安全（头注已声明），但脆弱。目标：`SLUG_RE` 改为调用时读取或经 `multifile` 转出；**不下沉到 `contract`**（80-§2.3） | 工程选择 |
| **D11** | 缺省五态两处同构 | `type-inbox.ts` 的 `TYPEINBOX_DEFAULT_STATES` 与 `git-import.ts:139` 的 `DEFAULT_STATES` 值相同、注释声明「不引跨模块常量」 | 保持两处（有意解耦），但**任何改动必须同批改两处 + 测试**；若将来合并，须证明不会让导入面耦合校验面 | 工程选择 |
| **D12** | 公开面靠 import 图推断 | `index.ts` 未再导出 `multifile`/`jobs`/`groups`/`hooks`/`cost-guard`/`state-hygiene`/`type-inbox`，但其符号经 `validator` 的 import 事实上可达 | 显式化：要么加 `export *`，要么收为内部（`multifile.lineOfPath` 等若被外部使用须核准） | 工程选择（M9） |
| **D13** | 测试不进类型门禁 | `tsconfig.json` 只 `include: ["src/**/*.ts"]`；根 `tsconfig.json` 只含 `packages/*/src/**` | 79-D10 已登记；目标：并入类型门禁或给出豁免理由。改动须同时改根 `tsconfig` 与 guard 口径 | **待批示**（79-D10 统一处置） |
| **D14** | YAML 别名/深度上限与 ReDoS 未证 | `validator`/`multifile`/`repo-validate` 只用 `parseDocument` + `LineCounter`，无别名/深度护栏 | 79-§3.7 已列为 82 V4 必验项；在验证前不得声称「已防 YAML 炸弹」 | 82 验证项 |
| **D15** | 建司平台只支持 `localfile` | `create.ts:60` `CREATE_PLATFORMS = ['localfile']` | taiga/youtrack 接线归后续单；此前**不得**在 CLI/文档/面板声称已支持 | 已由 docs/36-§2③ 约束 |
| **D16** | `panel → company` 是运行时 import 却写在 `devDependencies` | `panel/src/external/server.ts:45`、`overview/reports.ts:29`、`overview/server.ts:59` | 按 79-§10.1 移入 `dependencies`；**属 `panel` 的清单**，本附录只登记事实 | 已裁决（80-§2.3），执行在 panel 侧 |
| **D17** | `reports` 三处口径与 80-§4.1 不对齐 | ① 快照金额全用 `*_usd: number`（`monthly-report/v1`）；② `contentAddressedId` 取 sha256 前 12 位并当 `reports.id`；③ `monthWindow`/`monthlyAnchorDate` 固定 UTC，无公司本地日 | 三条均为**迁移项**（§4.5「与 80-§4.1 的对齐」）：金额改 `DecimalString` + 币种（`monthly/v2`）；身份改完整摘要、短形只作展示；月窗加显式 `zone`，缺省保持 UTC | 工程选择（`v2` caliber 换代须同批改消费者） |
| **D18** | 定义包 manifest / part 索引未实现 | `.studio-next.yaml` 是**挂载元信息**（schema/`framework_version`/`created_at`/`last_validation` 等），**不是** 76 `DEF-PKG-02` 的 manifest：无 part 索引、无摘要、无来源/许可/可选性；§1.4 只做了 `DEF-PKG-01a..i` 的物理落位映射 | 目标：新增 manifest 面并把 part 索引做成可独立校验件；落地前，本包对定义包的保证只到「目录契约合规」，**不得**声称已支持按 part 引用/裁剪 | 提案流（新语义，须 76 侧先定字段） |
| **D19** | definition-only 子集与损失报告未实现 | 76 `DEF-PKG-03` 要求「只搬定义、不搬运行态」并出损失报告；`git-import`/`create` 现只做整树复制与路径过滤（`.git`/`.AIWS`/`.studio-next`），不产出「丢了哪些 part、为什么」的机读报告 | 目标：在导入六步的第 3 步落损失报告；在此之前，过滤清单就是全部语义，**不得**声称支持「只导入定义子集」 | 提案流（导入语义属 76） |
| **D20** | 配置类别未声明，部署绑定混入公司配置 | 76 `DEF-CFG-01` 把配置分三类；`org-config.company.platform` 是**部署绑定**（`localfile` 等），却写在公司配置里（51 允许，但属「类别混放」，损失须登记） | 目标：在 manifest 中显式声明配置类别（D18 的前置），或把平台绑定迁到 `create` 的部署面；迁移须保证既有公司目录仍可读 | 提案流 |
| **D21** | 疑似秘密值扫描未实现 | 76 `DEF-PKG-05` 首条要求拒绝疑似秘密值；`repo-validate` 只做路径/归档/形态闸（见 D9），不扫文件内容 | 目标：加内容扫描面（词表 + 熵阈，误报处置须一并定）；在此之前，本包**不**提供「仓库内无秘密」的保证 | 工程选择 + 安全面须 82 V4 验证 |
| **D22** | slug 正则两套并存（R4） | `repo-validate.ts:92` `DOCS51_SLUG_RE`（3–64 字符、首尾非连字符）vs `validator.ts:55` `SLUG_RE`（不限长、允许单字符）：1–2 字符 slug 过 `init`/`create` 却过不了 `repo-validate`；代码注释自认「判定器按规范正则收，严于 init 通道」 | 二选一：① 判定器放宽到 `SLUG_RE`，同步改 51 正文的语法域；② `init`/`create` 收紧到 `DOCS51_SLUG_RE`（破坏既有短 slug）。**不得**两套长期并存 | **待批示**（② 属破坏性变更；① 须同步 51 正文） |
| **D23** | 秘密面零消费尚未被断言锁住 | 生产 `src` 无 `process.env`、无 `.env` 读取、无秘密库导入；但没有任何测试**断言**这一点，也没有断言「本包不自造第二套凭据/秘密正则」 | 目标：`test/security-baseline.test.ts` 增加负向断言（`src/**` 不出现 `process.env`、不 import `contract/src/ports/secret`、不出现第二组 `SEC-*`/wkey 正则）；`SecretCatalogEntry`/`Provider`/`Material` 归 `contract/src/ports/secret.ts`（80-§11.2.1），本包**不得**造别名（§九 文件表第 2 行） | 工程选择（M7 后；断言随测试批） |
| **D24** | 跨卷目标件缺口（本轮复核：三条均已关闭，保留旧快照） | 旧快照曾记：① `01-contract.md` 无 `ports/intent.ts`/`ports/secret.ts` 且 `F-contract-port-spec` 写「不得返回 `Result`」；② 17 卷无 `IntentIngress`/`IntentReceiptStore`、`F-daemon-api-assemble` 仍写 `deps:{engine;db;company;config}`+`openLedgerReadOnly(db)`；③ `02-core.md` 行 952 把「语法面下沉 core」列为待定 | 现状：① 01 v0.5 已有 `F-contract-port-intent`/`F-contract-port-secret`，`typecheck`/`evaluate` 全走 `Result`；② 17 卷已有 `F-daemon-intent-ingress`/`F-daemon-intent-receipt-store`、ingress 签名与 `openLedgerReadonly`，并在 W-19 反向登记 04 的过期指控；③ 02 §13 已关闭该边界。**已关闭**，§9.1 只作关闭记录 | 无需回写（他卷已回写）；残余 `03-store` 旧名归 03 卷 owner。**本包不复制这些字段表、不分配 F-ID**（§九） |
| **D25** | `stateMapping` 声明面与 `mapState` 运行时面易混 | `state-hygiene.ts`/`contract/companies.ts` 有 `knownForeignStates`/`stateMapping`，注释明写「仅统计视图」；daemon 侧才有 `PlatformBindingPort.mapState` | 目标：文档与类型注释统一口径——本包**只产声明**（静态映射表 + 未映射态清单），运行时判定归 daemon；`stateMappings.ours` 只许 `STAT-D`；未映射但合法不是 `Err`，也不得被 `projections` 读成 `accepted`/`settled`（§4.8） | 工程选择（M5 时随 projections 落地一并写清） |
| **D26** | 公司本地日 `CompanyZone` 未实现 | `reports.monthWindow`/`monthlyAnchorDate` 固定 UTC；公司配置无 `zone` 字段（`CompanyZone = { iana; offsetMinutes? }` 尚未出现在 schema） | 目标：`monthly/v2` 起 `monthWindow`/`monthlyAnchorDate`/`monthlyReportPaths` 加显式 `zone` 参数；`zone` 由公司目录显式声明，**不得读宿主时区**（`core/src/costguard.ts:29 localDateKey` 是宿主时区版，只作旧记录过渡）；缺省仍 UTC，不悄悄改既有口径 | 工程选择（M6 前置；配置字段变更须同批改 schema + 模板） |

### 8.1 未证清单（本包视角，交给 82）

1. 真实 `git`/`tar` 二进制缺失或版本差异下的失败文案与退出码；
2. 私有仓认证失败、网络中断、clone 超时；
3. 并发两个进程对同一 `pluginRoot` / 同一 `trust.json` 的行为；
4. 安装中途崩溃后的残留（已复制未登记 / 已登记未复制）；
5. 5000 文件 / 8 MiB 上限边界之外的资源耗尽（磁盘、inode、内存）；
6. 大目录（数千文件）下 `readDirectoryFiles` + 全目录校验的耗时；
7. YAML 别名/深度炸弹与正则长输入（79-§3.7 / §15）；
8. 模板路径在分发形态下的可用性（D8）；
9. 真实 dsh 加载插件（「安装成功」≠「已生效」，76 `DEF-PKG-08`）；
10. `reports` 在真实台账数据量下的聚合耗时与精度（浮点成本累加）。
11. `DecimalString` 的跨实现串化一致性（`toFixed`/`Number` 往返、超大/超小额度、负数与零）——`monthly/v2` 迁移前必须建对照集（D17①）；
12. 摘要身份迁移（`reports.id` 从 sha256 前 12 位改为全量 `Digest`）对既有记录的影响：重算、幂等命中、下游引用与展示层（D17②）；
13. 公司本地日折算：`CompanyZone` 的 IANA 名/偏移在 DST 边界、月末 23:00/01:00 的归属日，以及「UTC 桶 ≠ 本地日」的账目对平（D26）；
14. `repo-validate` 包内拆分后的**等价性**：facade 与 `src/repo/*` 在同一夹具集上 `violations`/`warnings`/`exempted` 全字段比对尚无基线，须先建对照集再拆（D3、M4）；
15. 并发批准（两个进程同时 `approve`/`re-approve` 同一 `trust.json`）与 tmp+rename 在 NFS/容器卷上的原子性（D5②、`test/trust.test.ts` 的「不证明」项）；
16. `tar` 实现差异（BSD tar vs GNU tar）对 `-tf` 输出与条目名转义的影响——现有测试只跑宿主默认实现。

---

## 九、跨卷目标件与缺口复核

下列目标件**不属于本附录**：本卷不复制其字段表、不分配 `F-*` ID、不排它们的实现顺序。这里只写三件事：归属卷、本包如何依赖（或为何不依赖）、以及**本包不得做什么**。

| 目标件 | 归属卷 / 80 章节 | 本包如何依赖 | 本包不得做什么 |
|---|---|---|---|
| `packages/contract/src/ports/intent.ts`（`IntentSubmissionPort`/`IntentKey`/`IntentReceipt`/`IntentIngress` 公共形状） | `81-files/01-contract.md`；80-§6.4/§6.6 | **不依赖**（无 `company →` 该模块的调用；`company` 只在 `contract` 已有类型上工作） | 不复用 `IntakeOutcome.outcome` 五值或 `IntentReceipt.status` 三值作目录/平台态词表；不写 `REC-WORK-01`（`WorkIntake.reserve` 唯一写口）；不把「目录已挂载」当成受理结论 |
| `packages/contract/src/ports/secret.ts`（`SecretCatalogEntry`/`SecretProvider`/`SecretMaterial`/`KnownSecretSet`/`SecretUse` 六值） | `81-files/01-contract.md`；80-§11.2.1 | **不依赖**（本包零秘密消费） | 不读 `.env`/env 变量、不落 `wkey`、不造 `secretId` 别名、不写第二套秘密识别正则；`local-mint` 的 per-ticket 例外只属 daemon |
| `packages/core/src/work-readiness.ts`（开工五门**同步纯核**：输入已解析，输出判决 + 逐门诊断）/ `ReadinessGate` **端口实现**在 daemon 引擎侧 | `81-files/02-core.md`（纯核）、`81-files/16-daemon-engine.md`（端口实现）；80-§6.4（`TS-PORT-WORK-03`）、§7.2 2h | **不依赖**（无 `company → core` 边；本包也不调用该端口） | 不在本包实现五门、不把目录校验通过当成「可开工」、不自造 readiness 词表（§4.2 非职责）；不把 `ReadinessGate` 写成 `core` 的端口实现 |
| `apps/daemon/src/assembly/intent/{ingress,receipt-store}.ts`（`IntentIngress` 持有 `WorkIntake`+`allowedSources`+`engine`+`IntentReceiptStore`） | `81-files/17-daemon-assembly-cli-control-evolve.md`；80-§6.6 | **不依赖**（装配体只取 `Pick<IntentSubmissionPort,'submit' \| 'receipt'>`，与 `Pick<IntentIngress,…>` 等价） | 不在本包实现受理/回执/幂等、不缓存 `IntentReceipt`、不判 `idempotencyTtlMs` |
| `apps/daemon/src/assembly/api/assemble.ts`（`assembleApi(deps:{ingress; ledgerPath; company; config})`） | `81-files/17-daemon-assembly-cli-control-evolve.md`；80-§9.4 | **仅编译期**：`api` 的 `views` 从本包取 `loadCompanyDirectory`/`build*`（`api → company` 允许边） | 不提供 `emitIntent`/`getIntentReceipt`/`companies`/`issuesView` 的实现；不读 `ServeConfig` 的 `external` 键；不持有 `Database`/`Ledger`；HTTP 装配**只拿 `ingress`**（`Pick<IntentSubmissionPort,'submit' \| 'receipt'>`），**不得**把 `deps.engine`/`db` 带进 HTTP |

### 9.1 跨卷缺口复核（本轮：三条均已由他卷回写关闭）

| # | 原登记缺口（旧快照） | 复核证据（现状） | 处置 |
|---|---|---|---|
| 1 | `01-contract.md` 无 `ports/intent.ts` 与 `ports/secret.ts` 的文件契约；且 `F-contract-port-spec` 写「`RuleEvaluator` 该端口不得返回 `Result`」 | 已关闭：`01-contract.md` v0.5 有 `F-contract-port-intent`（`src/ports/intent.ts`）与 `F-contract-port-secret`（`src/ports/secret.ts`）；`typecheck`/`evaluate` 两阶段全走 `Result<…, ClassifiedError>`、`refused` 留 `Ok` | 无需回写；本附录按现状引用（§6.4 第 1/3 行已同步） |
| 2 | `17-daemon-assembly-cli-control-evolve.md` 无 `IntentIngress`/`IntentReceiptStore`；`F-daemon-api-assemble` 仍写 `assembleApi(deps:{engine;db;company;config})` + `emitIntent=(i)=>engine.ingest([i])` + `openLedgerReadOnly(db)` | 已关闭：17 卷有 `F-daemon-intent-ingress`/`F-daemon-intent-receipt-store`/`F-daemon-api-assemble`；签名为 `deps:{ ingress: Pick<IntentSubmissionPort,'submit' \| 'receipt'>; ledgerPath; company; config }`，台账走 `openLedgerReadonly({path, expectedSchemaVersion, readOnly:true, queryOnly:true})`，`openLedger`/`platform` 标删除，转发面不触 `engine`；该卷 W-19 反向登记 04 的这两处过期指控 | 撤回本附录两处过期指控（§6.4 第 4 行、§九 文件表第 5 行）；反过来，17 卷 W-19 同时点名 `03-store` 的同类旧名，属 03 卷 owner |
| 3 | `02-core.md` 行 952 仍把「`repo-validate` 的语法面下沉 `core`」列为三选一待定 | 已关闭：`02-core.md` §13 标题即「`repo-validate` 的边界（已关闭：只有规则求值在 `core`，非整个文件下沉）」，并明写字节/路径/归档/纯配置留 `company` | 无需回写；本附录 §4.2.1 的包内拆件与之同口径 |

〔结论〕复核后**无未关闭的跨卷缺口**：三条原登记均已由他卷回写关闭，本节只作关闭记录（保留旧快照以便审计，不再作为现状指控）。§九 文件表因此只写「归属 + 依赖/禁令」，不写他卷待办。本包自身的未完成项在 §八 D17–D26，不在本节。跨卷残余只有 `03-store` 的旧名（17 卷 W-19 点名），归 03 卷 owner，本附录不代改。

---

## 十、完成判据自查（对 81-§六）

| 判据 | 本附录状态 |
|---|---|
| 1 路径可枚举、可复算 | 是：§二 21 src + 21 test + 3 夹具族 / 21 文件 + 2 配置件；§三 给目标计数（src 直下 23、`src/repo/` 4、test 24），均给列目录命令 |
| 2 每文件有内部结构/依赖/IO/错误/测试/迁移 | 是：§四 29 条（21 现有 src + 2 目标新增 + 4 `src/repo/` 拆分件 + 2 配置件）+ §五 21 现有测试条 + 3 目标测试条；另有 §1.4 定义包九部件物理映射、§4.2 逐规则判定表（含两面差异与 R4 漂移）、§4.2.1 拆分产物契约、§4.6 模板包消费契约、§6.4 十二条接口对齐 |
| 3 目标新增件能回到 76/77/78/80 的 ID | 是：`F-company-repo-*`（4 件）→ 80-§10.6（包内按规则族拆）；`F-company-dep-graph` → 80-§10.6；`F-company-projections` → 80-§9.4 M1 / 77 `REC-OBS-01/02`；`trust`/`reports` 的错误与口径 → 80-§5.7/§4.1；跨卷件不分配 F-ID（§九） |
| 4 超限件有拆分清单、未提阈值 | 是：D3 + M2（`dep-graph`）/M4（`repo` 5 步）；`repo-validate` 1021 与 `dependencies` 775 明确「只许降」，600 阈值未改 |
| 5 无通配、无虚构依赖、无虚构能力 | 是：依赖全表来自 `package.json`；`localfile` 限制、未实现投影均标「未落地」；定义包机读面/子集/秘密扫描的缺口在 D18–D21 明写，跨卷缺口复核在 §9.1（三条均已关闭，只作记录），未包装成已具备能力 |
| 6 明确现有/目标/未证 | 是：§二 现有、§三 目标、§八 D/未证（8.1 十六条） |
| 7 覆盖保留/拆分/新增/替换/退役及测试/配置 | 是：无替换；退役仅常量（D1）；测试与配置各成节 |
| 8 政策项与工程选择分开 | 是：§八「决策主体」列区分「待批示」「工程选择」「提案流」；D13/D22 待批示，D4/D5 因 80-§5.7 定稿降为工程选择，D18–D20 走提案流 |

〔结论〕本附录的**未完成边界**：`F-company-projections` 尚未落地（D2）、`F-company-dep-graph` 尚未落地（D3）、`repo-validate` 包内拆分未执行（D3/M4）、`trust` 仍 fail-open（D5②）、`reports` 三口径未迁移（D17）、公司本地日 `CompanyZone` 未实现（D26）；定义包 manifest/part 索引（D18）、definition-only 子集与损失报告（D19）、配置类别声明（D20）、内容秘密扫描（D21）、slug 单一语法域（D22）均未实现；跨卷三条原登记已由他卷回写关闭（D24/§9.1，不再是待办）。这些是设计处置，不是实现证据。在 82 的验证波次完成前，本包**不得**声称已具备：YAML 炸弹防护、归档限额、并发安装安全、分发形态可用、定义包可裁剪、仓库无秘密、金额精确（`DecimalString`）、公司本地日归属。
