# 81-files/10 · `packages/taiga` 逐文件契约

> 版本：v0.2，2026-10-27（v0.1 同日初稿）。v0.2 改五处：①新增 §4.0 公共接口逐条对齐表（12 条定稿接口的适用/不适用及理由）；②§4.1 `errors.ts` 与 `http.ts` 的错误面改为 80-§5.7 的**两轴**（`failure` 处置轴 + `category` 观测轴），逐 subcause 重排；③§4.2 `F-taiga-binding` 按 80-§6.6 已定形的 `PlatformBindingPort` 重写（原先「形状未定／未知状态 `Err(unsupported)`」作废，改为「可施工 + 三类输入注入」）；④新增 §4.5 横切契约（未知状态观察、导出拒绝面、`exitPlan` 声明/事实分槽，非文件件）；⑤§八 D1/D2 重写（改判「落地件未建」「记录写入者」）并新增 D10–D16。计数与迁移顺序随之重算（§3.5 目标 41 件、§七 M2 三段）。
> 版本：v0.2.2，2026-10-27（按 80 最新原文重校绑定宿主与错误类别）：①**`PlatformBindingPort` 的宿主不在本包**——端口本体与档案装配落 `apps/daemon/src/assembly/platform/binding.ts`（80-§6.9：BIND-01 实现落 `assembly/platform/`、包装 `FlowPlatform`），本包 `src/binding.ts` 只提供 Taiga 特定档案内容、纯 `mapState`、损失引用与退出声明；类型落 `contract/src/ports/binding.ts`（80-§6.9；01-contract v0.8 已拆 `F-contract-port-binding` 承接到同一路径，两处一致）；②`mapState` 明写**纯函数、零 IO、不写 `REC-OBS-02`**，落记录归消费方（daemon 观察投影；80-§6.6 三层第 6 条）；③错误类别按 80-§5.7 重校：`unsupported`⇒`EVOLVE_REJECT`、`conflict`⇒`EXTERNAL_REJECT`（合并域才 `MERGE_CONFLICT`），并补 §4.0 第 9 条的 ledger 查询三类 subcause；④秘密边界写清：taiga 只认 `SEC-TG-*`；`SEC-MX-BOT-PASSWORD` 的 `allowedUses` **恰为** `platform-auth` + `outbound-redaction`（**不含** `matrix-register`，bot 密码不得用于建号/注册），员工建号只认 `SEC-MX-HR-SHARED` + `matrix-register`（80-§11.2.1/D23；78-§7.4.1 三用途旧口径待 80-S10 同步）；⑤清理已解决项与陈旧行号（D16 上稿已关闭；`issues.ts:47`→`:43`、`wire.ts:134`→`:16`/`:139`）；⑥导出面对齐 80-§6.6 三层第 3 条：包根只出 `bindingProfile()`/`mapState()`/`lossReport()` 三个纯函数（`describeTaigaBinding`、`createTaigaBindingSource` 作废），`judgeTaigaExport`/`taigaExitDeclaration`/`requireExitFacts` 降为内部件；v0.2.2 曾登记的 D17/D18 已被上游 07:52/07:53 自修，**撤回、不复用编号**。
> 版本：v0.2.1，2026-10-27（同日对齐修正稿，**只改引用与口径、不改设计**）：①`secretId` 按 78-§7.4.1 现文改 `SEC-TG-TOKEN`/`SEC-TG-PASSWORD`（`TG`＝Taiga 的平台域码，`YT` 只属 YouTrack；env 名不变），D16 随之**关闭**、编号保留；②§4.5.1 补硬口径：未映射**但合法** ⇒ 只许 `Ok({verification:'unverified', workStates:[]})` + 原值保留，`Err(unsupported)` 一律判缺陷；③§4.5.2 第 16 行写明 `losses` 的类型是 `REC-LOSS-01` 的 `Qid[]`（不是 `string[]`、不是 `RecordRef[]`）；④§5.1/§5.3 去掉本机路径，凭据改 `<secrets>/taiga-admin-token` 逻辑占位（实际路径由部署方按 provider 给）；⑤§4.2/§4.5.4 把原先的通配端口引用改为真实 ID（`TS-PORT-WORK-05 WorkLifecycle`/`TS-PORT-WORK-07 SettlementPort`/`TS-PORT-LIFE-02 HandoverArchivePort`），并修正 §4.0 对 80-§8.2/§10.2 的引用。
> 性质：**自然语言级文件与实现设计呈审稿**，不是现行文件树、实现单或完成证明。
> 上位：75-§五 的文件契约模板与本卷主索引 §二/§四；78-§0.4/§1.2（`BIND-CORE-01` 20 字段）、§7.4.1（秘密命名与 `valueProvider`）、§9.1–§9.7（`BIND-PLAT-TAIGA-01`、状态映射骨架、未知回执与对账、迁移七步）；79-§3.5/§3.6/§4.4/§7/§10/D10；80-§2.4、§5.7（`ClassifiedError` 两轴与 `Err` 可达 `category`）、§5.8（秘密安全的错误）、§6.6（`TS-PORT-BIND-01`/`TS-PORT-API-01`/`TS-PORT-NOTI-01`）、§6.8（`FlowPlatform` 保留清单）、§8.2（`openLedgerReadonly` 签名面；§9.4 是其装配面）、§10.2（`MergeRunHost` 真名）、§11.2.1（秘密供给）、§11.4.1（stdio 工具面）；77-§9.2（观察六态）/§9.4（`REC-OBS-02`）/§10.5（`REC-LOSS-01` 与 `REC-LIFE-04` 分型）/§11.1（十四类失败）；76-§7.7（`STAT-D` 工作十态）；契约锚 `contract/src/ports/platform.ts`（`FlowPlatform`）。
> 边界：本附录只把 80 的组件、78 的绑定档案与既有实现落到文件；**不新增公共概念、端口、状态、允许边或依赖版本**。`PlatformBindingPort` 的**形状已由 80-§6.6 定形**（20 字段 `BindingProfile`、`StateMapping`、`ExportScope`/`ExportBundle`/`ExitPlan`、`Result`/`ClassifiedError`），**落点已由 80-§6.9 定死**（类型 `contract/src/ports/binding.ts`、实现 `apps/daemon/src/assembly/platform/`）——本附录只提供 Taiga 特定档案内容与纯映射，**不声称是端口宿主**、不另立字段、不自造第二套。类型与宿主文件的**源码落点**属 `81-files/01-contract.md` 与 daemon 分卷（本附录只引用文件与类型名，不改 contract、不写 daemon 源码）。本包不承担的公共接口一律写 N/A + 理由（§4.0），不得用「未提」代替「不适用」。
> 门禁：本文所有「目标/拆分/新增/退役」均为设计处置，**尚未执行**；本次未运行 typecheck、测试或 `guard:boundaries`。不得据此直接改源码、manifest 或 guards。
> 标签：`现有` / `库级·未接` / `目标-保留` / `目标-拆分` / `目标-新增` / `目标-替换` / `目标-退役` / `仅测试` / `未证`（81-§四）。

---

## 〇、本附录的范围与复算口径

覆盖 `packages/taiga` 的全部第一方文件：

| 类别 | 件数 | 行数 | 复算方式 |
|---|---|---|---|
| 生产源码 `src/**/*.ts`（不含测试与夹具） | 17 | 2868 | `find packages/taiga/src -name '*.ts' ! -name '*.test.ts'` 减 `testutil.ts`、`platform-fixture.ts`、`factory/fake-faces.ts` |
| 测试基建（位于 `src`，被测试 import） | 3 | 838 | `src/testutil.ts` 693、`src/platform-fixture.ts` 57、`src/factory/fake-faces.ts` 88 |
| `src` 内测试 `src/**/*.test.ts` | 10 | 1614 | `find packages/taiga/src -name '*.test.ts'` |
| `test/` 目录 | 3 | 421 | `test/memberships.test.ts` 157、`test/smoke/taiga-smoke.ts` 105、`test/smoke/taiga-onboard-smoke.ts` 159 |
| 包配置件 | 2 | 23 | `package.json` 18、`tsconfig.json` 5 |
| **合计** | **35** | **5764** | 逐路径可复算 |

排除：`.git`、`node_modules`、`dist` 与其他生成物、`bun.lock` 与根 `package.json`（归 `81-files/19-root-guards-templates.md`）、`@studio-next/contract` 的源码（归 `81-files/01-contract.md`）、`probe-evidence/**`（证据目录，只引用不复述）、`docs/32` 真机报告正文。

行数为 2026-10-27 实测（`wc -l`），只作规模核对，不作能力证据。测试覆盖以套内 `vitest` 为准；`test/smoke/*` 是**套外手动真机脚本**，不是证据（81-§四）。

---

## 一、包身份与边界

### 1.1 身份

| 项 | 值 | 依据 |
|---|---|---|
| 包名 | `@studio-next/taiga` | `packages/taiga/package.json` |
| 版本 | `0.1.0`，`private: true` | 同上 |
| 层位 | **层位 1**（与 `yt`/`localplatform`/`matrix`/`adapters` 同层，只下行到 `contract`） | 79-§3.6、`scripts/guards/boundary-rules.mjs` `packageLayers.taiga = 1` |
| 目标语义 | 「实现不变」——80-§2.4 第 1 条明确 `taiga` 的实现不动，只补 Taiga 绑定档案**内容**（端口宿主在 daemon `assembly/platform/binding.ts`，80-§6.9） | 80-§2.4、§6.9 |
| 模块形态 | `type: "module"`，ESM，Node 24 LTS 原生 type-stripping 直跑 `.ts` | 79-§4 |
| 入口 | `main: "src/index.ts"`，`exports: { ".": "./src/index.ts" }` | 79-§4.4「源码态」 |
| 发布 | **不发布**（`private: true`，无 `files`、无 `publishConfig`、无 `dist`） | 79-§5.2 / §7.1 |
| 构建 | **不进构建**：无 build 脚本，消费方直接 import `.ts` | 79-§5.2 |
| 包级类型门禁 | `tsc --noEmit -p tsconfig.json`，`include: ["src/**/*.ts"]` | `packages/taiga/tsconfig.json` |
| 测试 | `vitest run`（无包级配置文件，用 vitest 默认 include 规则） | `package.json` scripts |

〔结论〕`taiga` 是**平台能力包**，不是定义包：它翻译公司目录声明的 `FieldProvisionMap`，但不定义字段/状态/等级的词表；词表归 `contract` 与公司纯配置。`TaigaContext` 的项目/状态/属性缓存是**实例内运行期投影**，不是公司事实源。

### 1.2 允许边与禁止边

〔事实〕`src` 的生产 import 只有三类：

1. `@studio-next/contract`（**仅 type**：`ActivityPage`/`Comment`/`CompanySlug`/`FieldProvisionMap`/`FieldSchema`/`FlowPlatform`/`GuardRule`/`IssueCreate`/`IssueQuery`/`IssueRecord`/`KbHit`/`LinkType`/`SignedBody`/`TicketId`/`ErrorCategory`）；
2. 包内相对 import（全显式 `.ts` 扩展名）；
3. 零外部 npm 依赖、零 `node:` 内建、零 `process.env`、零 `fs`、零 `console`；`fetch`/`Response`/`URL` 用 Node 24 全局，`Buffer`（活动游标 base64url）也用全局。

〔事实·目标增量〕`src/binding.ts` 落地后，contract 侧新增**只读**引用：`Result`/`ClassifiedError`（80-§5.7）、20 字段 `BindingProfile`、`StateMapping`、`ExportScope`/`ExportBundle`/`ExitPlan`（80-§6.6）、`FailureClass`（77-§11.1 十四值），**类型落点 `contract/src/ports/binding.ts`**（80-§6.9 端口落点表）。**本包不 import `PlatformBindingPort` 本身**——端口宿主是 daemon 的 `assembly/platform/binding.ts`（§4.2）；本包只消费上述类型名，不实现端口方法。仍需 `Qid`（`losses` 是 `REC-LOSS-01` 的 `Qid` 引用，不内联损失对象）与 `WorkState`（`STAT-D` 十态，76-§7.7）。以上全部来自 contract，**本包不得自造同名类型、也不得用 brand 伪造不可混淆的 ID**（80-§5.9）。`secrets.ts` 迁 contract 后本包仍不 import 它：`taiga` 不脱敏、不读秘密目录，凭据值由调用方解析后经 `TaigaPlatformOptions.auth` 传入（§4.0 第 6 条）。

〔事实·仅测试〕`src/testkit/**` 与 `src/testutil.ts` 只被 `*.test.ts` import；生产件**零 import testkit**，`src/index.ts` 不再导出任何 fake（§5.1、§4.5）。

〔结论〕允许边（不新增）：

| 边 | 状态 | 说明 |
|---|---|---|
| `taiga → contract` | 在用 | 只 type；运行期零跨包 import |
| `daemon → taiga` | 在用 | `assembly/platform/wire.ts:16`（import）/`:139`（`createTaigaPlatform` 调用）、`assembly/hrsync/assemble.ts:17`、`cli/taiga-cure.ts:15`、`engine/hrsync/taiga-face.ts:29` |
| `daemon assembly/platform/binding.ts → taiga` | **目标**（未建） | 绑定端口宿主组合本包的档案内容与 `FlowPlatform`（80-§6.9、§4.2）；跨包仍只走已登记的 `daemon → taiga` 边，不新增边 |
| `taiga → core/store/company/prompt/gateway/adapters/yt/panel/api` | **禁止** | 层位 1 不得上行；尤其禁止 `taiga → yt`（跨平台实现互引） |
| `taiga → node:*`（生产） | **禁止新增** | 现状零内建；未来若需 `node:crypto`（HMAC 校验/游标签名）须先回写 79-§3 并过提案 |
| 包内 `transport/ → fieldmap.ts` | **禁止**（BC-T1） | `scripts/guards/boundary-rules.mjs` `forbiddenImportSpecs`：传输域用 `FieldMapLike` 结构注入（`transport/context.ts:28`） |

〔结论〕包内方向：`transport/` 是底座（不依赖任何业务件）→ 业务件（issues/comments/fields/kb/activity/links/guards/memberships/factory）→ `fieldmap`（业务翻译器，实现 `FieldMapLike`）→ `platform`（组装）→ `index`（再导出）。`factory/factory.ts` 可 import `issues`/`fields`/`entities`；`issues` 不得 import `factory`（避免回环）。

### 1.3 依赖清单与 79 裁决

| 依赖 | 版本 | 类型 | 79 裁决 |
|---|---|---|---|
| `@studio-next/contract` | `workspace:*` | prod | 79-§10.1 判「正确」：层位下行、仅类型使用 |
| 无 devDependencies | — | — | 79-§10.1 判「正确」：`vitest` 由仓根提供，测试文件直接 `import { describe, it, expect } from 'vitest'` |

〔未证〕`bun.lock` 实锁与 manifest 一致性由根锁文件门禁承担（`81-files/19`）；本附录不重复取证。

---

## 二、现有件全集

### 2.1 生产源码（17 件，按域分组）

| 文件 | 行数 | 域 | 一句话 |
|---|---|---|---|
| `src/transport/http.ts` | 223 | 传输 | 薄 HTTP 客户端：URL 构造、JWT 登录/刷新/重试、状态→错误映射、分页 |
| `src/transport/context.ts` | 339 | 传输 | 公司作用域上下文：项目 id/成员/状态/属性缓存 + 单号解析 + 属性值端点 |
| `src/transport/entities.ts` | 75 | 传输 | 三实体（userstory/issue/task）路径档案与页大小 |
| `src/transport/shape.ts` | 85 | 传输 | 手写窄校验原语（`asObject`/`reqString`/`optNumber`…） |
| `src/transport/errors.ts` | 32 | 传输 | `TaigaPlatformError`（category+subcause）与 `notImplemented` |
| `src/platform.ts` | 160 | 组装 | `buildContext`/`createTaigaPlatform`：选项校验 + 七能力接线 |
| `src/fieldmap.ts` | 119 | 映射 | `TaigaFieldMap`：业务名↔平台属性名、类型编解码、建单落位序 |
| `src/issues.ts` | 268 | 单据 | 列表/详情/建单/流转/字段写；客户端过滤；乐观并发 |
| `src/comments.ts` | 95 | 评论 | history 条目解析、评论读（过滤）、评论写（署名尾行） |
| `src/fields.ts` | 227 | 字段 | `schema()` 真源反射、`provision()` GET-first 幂等建档、400 读回吸收 |
| `src/kb.ts` | 145 | 知识库 | wiki by_slug 读写、全量拉取子串搜索、slug 折平 |
| `src/activity.ts` | 183 | 活动流 | history 逐实体合并 + 不透明游标 + 边界剪枝/全量重放 |
| `src/links.ts` | 112 | 链接 | `link()` 三型显式不支持；`children()` 派生链/生成链读 |
| `src/guards.ts` | 172 | 守卫 | 角色权限读、`install` 收窄闸、`uninstall` 拆闸 |
| `src/memberships.ts` | 213 | 人事 | 成员/角色解析、邀请/调角色/移除、邀请令牌注册、日志令牌抓取 |
| `src/factory/factory.ts` | 333 | 出厂态 | A1 默认态重指 / A2 存量归化 / A3 出厂态退役三步合流 |
| `src/index.ts` | 87 | 包根 | 再导出 + 包常量 + 七能力覆盖表头注 |

### 2.2 测试基建（位于 `src`，3 件）

| 文件 | 行数 | 角色 |
|---|---|---|
| `src/testutil.ts` | 693 | `FakeTaiga` 内存平台（状态+种子+路由+序列化）、调用日志、认证面；尾部再导出 `platform-fixture` |
| `src/platform-fixture.ts` | 57 | 测试常量（`TEST_BASE_URL`/`TEST_PASSWORD_AUTH`/`TEST_FIELDS`）、`makePlatform`、`expectTaigaReject` |
| `src/factory/fake-faces.ts` | 88 | `FakeTaiga` 的出厂态根治路由面（PATCH `/projects`、DELETE `*-statuses`、默认态回显） |

### 2.3 `src` 内测试（10 件）与 `test/`（3 件）

| 测试文件 | 行数 | 覆盖对象 |
|---|---|---|
| `src/activity.test.ts` | 174 | 游标三轮连续、边界不可达全量重放、剪枝 |
| `src/comments.test.ts` | 63 | 评论读写 |
| `src/context.test.ts` | 77 | T1 bound=1 自愈、`invalidateMembers` |
| `src/fields.test.ts` | 237 | schema 反射、provision 幂等、TOCTOU 400 吸收、多实体、`initialStateFor` |
| `src/guards-links.test.ts` | 129 | guards 读/收窄/拆闸、links 写不支持 + 派生链读 |
| `src/issues.test.ts` | 296 | 建单回环/落位、列表过滤、详情流转、setField 分派、乐观并发、构造校验 |
| `src/kb.test.ts` | 90 | kb get/search/upsert 幂等 |
| `src/onboard.test.ts` | 68 | onboard 三步合流两跑同结果 |
| `src/factory/factory.test.ts` | 277 | A1/A2/A3、三步合流幂等、实体档案、入参防御 |
| `src/transport/http.test.ts` | 203 | 错误映射表、JWT 通路、请求构造、分页、构造期校验 |
| `test/memberships.test.ts` | 157 | 角色解析、成员读/写、公开注册端点、`findInviteToken` |
| `test/smoke/taiga-smoke.ts` | 105 | 套外真机只读/写面冒烟（**非证据**） |
| `test/smoke/taiga-onboard-smoke.ts` | 159 | 套外真机 onboard 两跑幂等 + 拆闸（**非证据**） |

### 2.4 包配置件（2 件）

`package.json`（18 行）、`tsconfig.json`（5 行）。

---

## 三、目标件全集与处置总表

### 3.1 生产件（18 件 = 现有 17 + 新增 1）

| 稳定 ID | 目标路径 | 处置 | 依据 |
|---|---|---|---|
| `F-taiga-transport-http` | `src/transport/http.ts` | 目标-保留（补超时/取消须提案；§八 D6） | 79-§3.5 注入纪律 |
| `F-taiga-transport-context` | `src/transport/context.ts` | 目标-保留（顶部 import 归位） | 80-§2.4 实现不动 |
| `F-taiga-transport-entities` | `src/transport/entities.ts` | 目标-保留 | 同上 |
| `F-taiga-transport-shape` | `src/transport/shape.ts` | 目标-保留 | 同上 |
| `F-taiga-transport-errors` | `src/transport/errors.ts` | 目标-保留；**补 `failure` 栏走两轴**（`failure`=77-§11.1 处置轴、`category` 只观测）；`notImplemented` **目标-退役**（零消费者，且它抛 `CONFIG_INVALID`，与 77-§11.1 的 `unsupported` 不是一类——绑定面的「未支持」走 `Err(failure:'unsupported')`） | 80-§5.7、77-§11.1 |
| `F-taiga-platform` | `src/platform.ts` | 目标-保留 + **补 `guards.read` 接线** | 契约 v1.6 可选位、78-§9.1 |
| `F-taiga-binding` | `src/binding.ts` | **目标-新增，可施工**（**只提供 Taiga 特定内容**：档案事实表 → `BindingProfile`、纯 `mapState`、`lossRefs`→`losses`、导出形状与退出声明；**不实现 `PlatformBindingPort` 端口本体**——宿主在 daemon `assembly/platform/binding.ts`，80-§6.9。前置＝`contract` 落地件（`ports/binding.ts`，D1）+ 三处事实注入：`lossRefs`、`exitFacts`、`digestOf`；`exportBundle` 只落拒绝面、另有 D10/D12；`exitPlan` 另有 D13） | 80-§6.6 `TS-PORT-BIND-01`、80-§6.9 落点表、78-§9.3/§9.5/§9.6、§4.5 |
| `F-taiga-fieldmap` | `src/fieldmap.ts` | 目标-保留 | 80-§2.4 |
| `F-taiga-issues` | `src/issues.ts` | 目标-保留 | 同上 |
| `F-taiga-comments` | `src/comments.ts` | 目标-保留 | 同上 |
| `F-taiga-fields` | `src/fields.ts` | 目标-保留 | 同上 |
| `F-taiga-kb` | `src/kb.ts` | 目标-保留 | 同上 |
| `F-taiga-activity` | `src/activity.ts` | 目标-保留 | 同上 |
| `F-taiga-links` | `src/links.ts` | 目标-保留 | 78-§9.3 实测损失 |
| `F-taiga-guards` | `src/guards.ts` | 目标-保留（读位改由 `platform.guards.read` 暴露，包级导出保留兼容） | 78-§9.3、D4 |
| `F-taiga-memberships` | `src/memberships.ts` | 目标-保留 | 78-§9.3、docs/52-§6 |
| `F-taiga-factory` | `src/factory/factory.ts` | 目标-保留 | 80-§2.4、docs/52-§八 |
| `F-taiga-index` | `src/index.ts` | 目标-保留（`PACKAGE_STATUS` 值改如实档，不退役） | 79-§4.4；与 `81-files/09-yt.md` 的常量口径对齐 |

### 3.2 测试基建（7 件 = `testutil` facade + 6 新增）

| 稳定 ID | 目标路径 | 处置 | 依据 |
|---|---|---|---|
| `F-taiga-testkit-world` | `src/testkit/fake-world.ts` | **目标-新增（拆分产物）** | 81-§3.2 拆分先解类型环 |
| `F-taiga-testkit-routes` | `src/testkit/fake-routes.ts` | **目标-新增（拆分产物）** | 同上 |
| `F-taiga-testkit-fake` | `src/testkit/fake-taiga.ts` | **目标-新增（拆分产物）** | 同上 |
| `F-taiga-testkit-factory` | `src/testkit/fake-factory.ts` | **目标-新增（`fake-faces` 迁入）** | 80-§10.6 |
| `F-taiga-testkit-platform` | `src/testkit/platform-fixture.ts` | **目标-新增（`platform-fixture` 迁入）** | 80-§10.6 |
| `F-taiga-testkit-index` | `src/testkit/index.ts` | **目标-新增（barrel）** | 81-§3.3 |
| `F-taiga-testutil` | `src/testutil.ts` | 目标-拆分（**保留纯再导出 facade**） | 10 个 `src` 测试 + 2 个夹具仍 import 它（`test/memberships.test.ts` 自带 inline fake，不经 testutil） |
| `F-taiga-platform-fixture` | `src/platform-fixture.ts` | **目标-退役** | 内容迁入 `testkit/platform-fixture.ts` |
| `F-taiga-fake-faces` | `src/factory/fake-faces.ts` | **目标-退役** | 内容迁入 `testkit/fake-factory.ts` |

> 计数说明：上表 9 行 = 7 个目标件 + 2 个退役件；退役件不计入目标全集。

### 3.3 测试件（14 件 = 现有 13 全保留 + 新增 1）

`src` 内 10 个 `*.test.ts` + `test/memberships.test.ts` 保留在原位（迁移只改 import 路径：`./testutil.ts` 保持有效，故目标态可零改动）；`test/smoke/*` 两件保留为套外脚本，**明报非证据**。唯一新增是 `src/binding.test.ts`（`F-taiga-test-binding`，随 `binding.ts` 同批，cover R/E/V 三面，见 §4.2）；其余测试件不拆分。

| 稳定 ID | 目标路径 | 处置 | 依据 |
|---|---|---|---|
| `F-taiga-test-binding` | `src/binding.test.ts` | **目标-新增**（随 M2a） | 80-§6.6 `TS-PORT-BIND-01`、§4.2 测试面、81-§四 R/E/W/V |

### 3.4 配置件（2 件）

| 稳定 ID | 目标路径 | 处置 | 依据 |
|---|---|---|---|
| `F-taiga-package-json` | `package.json` | 目标-保留（不新增 deps/scripts） | 79-§7/§10.1 |
| `F-taiga-tsconfig` | `tsconfig.json` | 目标-保留（`test/` 门禁缺口登记，§八 D3） | 79-D10 |

### 3.5 统计与目录核算

| 项 | 数 |
|---|---|
| 现有件 | 35 |
| 目标-退役 | 2（`platform-fixture.ts`、`factory/fake-faces.ts`） |
| 目标-新增 | 8（`binding.ts` + `binding.test.ts` + `testkit/` 6 件） |
| 目标-保留 | 33（其中 `testutil.ts` 保留 facade、`index.ts` 的 `PACKAGE_STATUS` 改值不退役） |
| 目标-替换 | 0 |
| **目标件总数** | **41** = 35 − 2 + 8 |

〔附〕另有**符号级退役 1 项**：`transport/errors.ts` 的 `notImplemented`（该件仍保留，不计入件数；理由见 §8.2 D8）。

〔结论〕目录规模（`maxFilesPerDirectory = 25`，`scripts/guards/boundary-rules.mjs`）：

| 目录 | 现状直属件 | 目标直属件 | 说明 |
|---|---|---|---|
| `src/` | 21（13 生产/基建 + 8 测试） | 22（12 生产/基建 + `binding.ts` + 9 测试；`platform-fixture` 移出，`binding.test.ts` 加入） | 22 ≤ 25，未顶格 |
| `src/transport/` | 6 | 6 | 不变 |
| `src/factory/` | 3 | 2 | `fake-faces` 移出 |
| `src/testkit/` | 0 | 6 | 新增子目录，6 ≤ 25 |
| `test/` | 3（`memberships.test.ts` + `smoke/` 2） | 3（不变） | — |

〔结论〕`src` 内测试与 `testkit/` 仍在根 program（`tsconfig.json` include `packages/*/src/**/*.ts`）与包级 program 内，故拆分后测试基建保留类型门禁；`test/` 目录依旧不在门禁（§八 D3）。

〔结论〕行数预算：拆分后单件全部 < 600；`src/testutil.ts` 从 693 降到 facade（约 20 行）。`boundary-rules.mjs` 的 `lineBaseline["packages/taiga/src/testutil.ts"] = 723` 在拆分后可删（基线只减不增），**删除动作属门禁表变更，须与拆分同批并走批示**，本附录不执行。

---

## 四、逐文件契约（生产件 18 件）

〔结构〕4.0 是与最新公共接口的逐条对齐（哪些适用、哪些 N/A）；4.1–4.4 是 18 件逐文件契约；**4.5 是横切契约**（绑定档案、未知状态观察、导出），它不是文件件、不计入 18，被 `context`/`issues`/`activity`/`guards`/`binding` 五处引用。

### 4.0 与最新公共接口的逐条对齐（适用 / N/A）

〔口径〕下表逐条对应 80 的定稿接口。**N/A 必须给理由**，不得以「本包没提」代替「不适用」；凡写「适用」的，落点必须在 §4.1–§4.5 有文件名或小节号。本包是**平台能力包**：只做「平台 ↔ 契约」的翻译与绑定档案，不承担规则、意图、台账、API、通知与工具面。

| # | 定稿接口（出处） | 本包适用性 | 落法与理由 |
|---|---|---|---|
| 1 | `RuleEvaluator`：`typecheck`/`evaluate` 分离，`evaluate: Result<RuleOutcome,ClassifiedError>`，`refused` 留在 `Ok`（80-§6.1 `TS-PORT-RULE-01`） | **N/A** | 本包零规则求值：`fields` 的入参闸（`validateProvisionMap`）与 `shape` 的窄校验是**形状/类型闸**，不是规则求值；`fieldmap` 只做字段名与类型编解码。若公司规则要读平台值域，求值在 `core`（80 明定 `RuleEvaluator` 归 `core`、公共类型归 `contract`），本包只提供读写面。**不得**为通过审查在 `fieldmap`/`fields` 里私造 `outcome`/`steps`/`limitsApplied` |
| 2 | `ClassifiedError = { failure, category, subcause, detail? }`；`failure` 是 77-§11.1 十四类**处置轴**，`category` 只做观测；`Err` 可达 `category` 仅 6 个（80-§5.7） | **适用** | ①`transport/errors.ts` 的 `TaigaPlatformError` 目标携带 `failure`（见 §4.1 该条；现状只有 `category`+`subcause`）；②`binding.ts` 的 `Err` 一律四字段；③能力面仍抛（`FlowPlatform` 无错误栏，D5），但**抛出的对象本身**必须是该四字段形状，调用方不需按消息猜 `failure`。类型来源：`Result`/`ClassifiedError` 在 `contract/src/ports/kernel.ts`，`FailureClass` 14 值在 `records/scalars.ts`（`F-contract-rec-scalars`）——本包只 `import type`，不复制字段表（D1） |
| 3 | 意图与回执：`WorkIntake.reserve` 先写 `REC-WORK-01`、`IntentIngress.submit` 再 `engine.ingest`；`intent_receipts` 是可重建投影（80-§6.6 `TS-PORT-API-01`） | **N/A** | 本包不产意图、不收意图、不写 `REC-WORK-01/02`/`REC-EVT-03`、不持 `IntentKey`/`IntentReceipt`。平台**写**由 daemon 侧经网关发起，本包只被调用。故本包不存在「回执 / 去重窗 / 重投四态」语义，也不得自造 `queued\|decided\|unknown` 之外的本地状态 |
| 4 | API 装配 `assembleApi(deps:{ingress,ledgerPath,company,config})`、`openLedgerReadonly`（80-§8.2 出签名面、§9.4 出装配面） | **N/A** | 本包不起 HTTP、不开库、不持路径。`TaigaContext` 的缓存是**实例内**投影，与 `ReadOnlyLedger` 无关；`openLedgerReadonly` 的 `expectedSchemaVersion` 与 `db-missing`（`failure:'unavailable'`/`category:'STALL'`）语义不进入本包错误面 |
| 5 | `BindingProfile` 20 字段 + `StateMapping{verification:'verified'\|'unverified', unmappedBehavior:'observe-unmapped'}`；未映射但合法 ⇒ `Ok(unverified)`（80-§6.6 `TS-PORT-BIND-01`） | **部分适用（只在本包落 Taiga 特定内容）** | **端口宿主不在本包**：`PlatformBindingPort` 的四方法由 daemon 的 `apps/daemon/src/assembly/platform/binding.ts` 实现（80-§6.9：BIND-01 实现落 `assembly/platform/`、包装 `FlowPlatform`）；本包 `src/binding.ts`（§4.2）只提供三个纯函数——`bindingProfile`（档案事实表→`BindingProfile`）、`mapState`、`lossReport`（`lossRefs`→`losses` 引用清单），外加导出形状与退出声明（随档案暴露、不另增导出名）。`mapState` 的未知态**只**返回 `Ok`，`Err` 仅留给空/畸形原值；`STAT-E`/`STAT-H` 在声明侧即判缺陷；`mapState` **不写 `REC-OBS-02`**（§4.5.1）。类型落点：`BindingProfile`/`StateMapping`/`ExportScope`/`ExportBundle`/`ExitPlan` 在 `contract/src/ports/binding.ts`（80-§6.9；01-contract v0.8 已拆 `F-contract-port-binding` 承接到同一路径）、`WorkState` 在 `ports/work.ts` 且**只作不透明别名**（G-22：十态无英文字面量，不得自造） |
| 6 | `SecretCatalogEntry`/`SecretProvider`/`SecretMaterial`/`KnownSecretSet`；`secretId=SEC-<域>-<slug>`、`load(entry,use)`、`use ∉ allowedUses ⇒ rejected_forbidden`（80-§11.2.1、78-§7.4.1） | **部分适用（只作消费方约定）** | 本包**不** import `contract/src/ports/secret.ts`、不读 env/文件/broker、不装配 `KnownSecretSet`、不做脱敏（脱敏纯函数在 `contract`，`core` 只具名 re-export；本包**不得**引入第二套正则或 `<redacted:N>` 之外的标记）。约定只有一条：`TaigaPlatformOptions.auth` 的值由调用方经 `SecretProvider.load(entry,'platform-auth')` 取得后传入，条目按 78-§7.4.1 定名 `SEC-TG-TOKEN`/`SEC-TG-PASSWORD`（`TG`＝Taiga 的平台域码；`YT` 只属 YouTrack，两者不混）——env 名仍是 `TAIGA_USERNAME`+`TAIGA_PASSWORD` 或 `TAIGA_TOKEN`（可选 `TAIGA_REFRESH`）——env 名与 `secretId` 是两套命名，不得混写；这两个 `secretId` 归 daemon 的 catalog 条目，本包不持 `secretId`、不写 `version`、不参与轮换/吊销。**相邻秘密不得互借**（`allowedUses` 以 80-§11.2.1 与 D23 为准；78-§7.4.1 的「三用途」旧口径已被 80-S10 判待同步，本卷按 80 执行）：`SEC-MX-BOT-PASSWORD` 的 `allowedUses` **恰为** `platform-auth` + `outbound-redaction`（**不含 `matrix-register`**）——它只用于 bot 登录与脱敏源，**不得**拿去建号/注册；员工建号只认 `SEC-MX-HR-SHARED`（`allowedUses` = `matrix-register` + `outbound-redaction`）+ `use='matrix-register'`；拿 bot 密码走 `matrix-register` 即越出 `allowedUses`（应被 `rejected_forbidden` 拦下），与 taiga 更无关；taiga 侧只认 `SEC-TG-TOKEN`/`SEC-TG-PASSWORD` + `platform-auth`（这两条的 `allowedUses` = `platform-auth` + `outbound-redaction`，与 80 表一致；本包只消费 `platform-auth` 一面） |
| 7 | stdio 工具面：daemon 侧验签、stdout 只 JSON-RPC、helper 先注册、socket `run/daemon.sock`（80-§11.4.1） | **N/A** | 本包是**库**，无 stdio、无 socket、无 helper 注册；worker 不直接 import 本包（平台写经网关→daemon）。stdio 未实现属 `81-files/15-studio-tools.md` 的缺口，本附录不登记、不借用 |
| 8 | `Notification` 保持 `{kind,title,body,from?:string,links?}`；投递用 `NotificationEnvelope`（80-§6.6 `TS-PORT-NOTI-01`） | **N/A** | 本包零通知：`factory`/`guards` 的「报告」是**返回值**（`FactoryCureReport` 等），不是通知，也不得被读成「已通知到人」。不引入 `NotificationEnvelope`/`NotifySendReport` |
| 9 | `ProjectionName`（含 `intentReceipts`/`observation`）、`RecordReader.query`/`ReadOnlyLedger.query` 返回 `Result<RecordPage<…>, ClassifiedError>`（`{items,nextCursor}`，末页 `nextCursor` 必须 `null`，游标 opaque）、`TxReceipt`、`MigrationPlan`（80-§6.3/§6.6/§8.2） | **N/A** | 本包不读台账、不建投影、不跑事务与迁移。**台账查询的 `Err` 类别按 80-§8.2 记在此备查**（本包不产生、不解释）：`ledger-query-unsupported`⇒`unsupported`/`EVOLVE_REJECT`（能力未开放，不是 `CONFIG_INVALID`）、`ledger-cursor-invalid`⇒`conflict`/`EXTERNAL_REJECT`（**合并域之外不得写 `MERGE_CONFLICT`**；`STATE_CONFLICT` 不是 `ErrorCategory` 成员，全卷不得出现）、`ledger-query-invalid`⇒`rejected_precondition`/`CONFIG_INVALID`、`ledger-read-failed`⇒`unavailable`/`STALL`。`activity.since` 的游标是**平台不透明游标**（`base64url`），与 `RecordPage.nextCursor` 同名不同物，**不得**互换或互相解释 |
| 10 | `repo-validate` 留 `company`、五门在 `core/src/work-readiness.ts`、`MergeRunHost` 真名（80-§10.2 明确该名是真实名字——现于 `engine/merge/merge-run.ts:129`，不写 `MergeHostView`）、`fakes` 只许 demo/test（80-§10.6/D17）、`Money.usd` 只作内存/旧记录、`sha8` 只展示、UTC 日键与公司本地日分开（80-§2.1/§10.2/§10.6/D17） | **部分适用（只两小条）** | ①`fakes` 一条适用：`FakeTaiga`/`testkit` **只**许测试与 demo，真实装配（`assembly/platform/wire.ts`）不得回落 fake（§5.1）；②`sha8` 一条适用：绑定身份用**全量** `semanticDigest`，本包不得引入 `sha8` 作身份、也不得用短摘要做跨实现比对；其余（五门/合并宿主/金额/日键）本包零涉 |
| 11 | `assembleApi` 的 `ServeConfig.external` 含 `enabled/port/lan/token/requestsPerMinute/idempotencyTtlMs/allowedSources`，`allowedSources` 缺省恰 `['external-api']`（80-§3.3/§9.4） | **N/A** | 本包不读 `ServeConfig`、不做来源白名单校验（那是 `IntentIngress` 的入口校验）。`taiga` 侧唯一相关配置是 `TaigaPlatformOptions`（`baseUrl`/`project`/`auth`/`entity`/`fields`/`fetch`/`pageSize`），由 daemon 装配传入 |
| 12 | `ReferralTarget`/`IntakeOutcome['outcome']` 五值；平台 `unknown` 与 77 异常 `unknown` 不同轴（80-§6.6/§9.4） | **N/A（但有一条同形纪律）** | 本包无受理面；纪律是：`mapState` 的「未映射」用 `verification:'unverified'`（观察事实）表达，**不得**借用 77-§11.1 的 `unverified` 失败类当返回值，也不得把 `workStates:[]` 读成 `accepted`/`settled`（80-§6.6 末条） |

〔结论〕12 条里 **4 条适用/部分适用**（2、5 全适用；6、10 部分适用）、**8 条 N/A**（1、3、4、7、8、9、11、12）。N/A 的判据统一是「本包没有该事实源的写口与读口」：不写 `REC-*`、不开库、不起 HTTP/stdio、不发通知、不求值规则。任何一条 N/A 若将来要变适用，必须先在该主卷立项（新端口/新写入者），**不得**在本附录内长出第二套。

这一族的共同约束：

- **错误形态统一（两轴）**：一切对外失败抛 `TaigaPlatformError`（`Error` 子类），其承载形状与 `ClassifiedError` **逐字段一致**：`{ failure: FailureClass; category: ErrorCategory; subcause: string; detail?: string }`。`failure` 是 77-§11.1 十四类**处置轴**（调用方按它决定重试/断路/对账/升级），`category` 只做事件 `note` 与告警分桶，`subcause` 是稳定实现细目。现状只带 `category`+`subcause`（`transport/errors.ts`），**目标补 `failure` 而不换类**。`Err` 侧可达的 `category` 只有 6 个（`CONFIG_INVALID`/`EVOLVE_REJECT`/`EXTERNAL_REJECT`/`STALL`/`MERGE_CONFLICT`/`NO_LANE`）；本包**不用** `MERGE_CONFLICT`（合并域专属）与 `NO_LANE`（仅显式 lane 上下文），只出现前四个。构造期非法（`bad-base-url`/`bad-project`/`bad-auth`/`bad-provision-map` 等）固定 `rejected_precondition`+`CONFIG_INVALID`。
- **能力面仍靠抛，绑定面走 `Result`**：`FlowPlatform` 七能力签名是 `Promise<T>`（80-§6.8 保留清单，无错误栏），拒绝只能抛——这是 80-§5.7 允许的「抛 `ClassifiedError`」形态，**不是**「签名裸返回却声明拒绝」。`binding.ts` 是 `Result` 面（80-§6.6 签名即契约），失败一律 `Err(ClassifiedError)`。两面的边界转换**只是字段搬运**（`new ClassifiedError(e.failure, e.category, e.subcause, e.detail)`），**不得**在绑定层按消息文本或 `category` 反猜 `failure`；同一函数**不得**既抛又回 `Err`。
- **承重判据改用 `(failure,subcause)`**：现有按 `category` 分支的调用点（如 `fields.provision` 的 TOCTOU 吸收判 `CONFIG_INVALID/bad-request`）目标改为判 `failure='rejected_precondition'` 且 `subcause='bad-request'`；`category` 不再参与业务判定（80-§5.7 第 2 条）。
- **零日志**：生产 `src` 无 `console`、无事件发射器。观测只靠**返回值**（报告对象、调用计数在测试侧）与调用方台账。
- **秘密**：`auth.password`/`token`/`refresh` 只在 `TaigaClient` 实例内存中存在，不写盘、不进错误消息、不 toString。错误消息可含 `baseUrl`（配置项，非秘密）与 `fetch` 异常文本；**不得**含 token/密码的前缀或哈希（80-§5.8）。凭据值由调用方经 `SecretProvider.load(entry,'platform-auth')` 取得后传入（§4.0 第 6 条），本包不持 `secretId`。
- **注入**：网络一律经 `FetchLike`；时间只有 `factory.retireFactoryStatuses` 的 `opts.now`；无随机、无 ``process.env``、无子进程。
- **规模纪律**：单件 < 600 行；只许下降，不新增超限件（80-§10.6）。

### 4.1 传输域（5 件）

#### F-taiga-transport-http · `packages/taiga/src/transport/http.ts`（223 行）

- **处置**：目标-保留。超时/取消/429 退避不在此刀加（加=行为变更，须提案并回写 78 V5；§八 D6）。
- **归属**：实现层；上位 78-§9.1「平台连接与认证协议归 79/实现」、80-§6.8 `FlowPlatform` 保留清单的传输机制件；79-§3.5 注入纪律。
- **职责 / 非职责**：把「一次 Taiga HTTP 调用」变成带认证、带错误分类、带分页的 `RawResponse`。不解释业务状态（归 `context`/业务件）、不重试业务失败（只做 401 一次刷新重试）、不组装 `FlowPlatform`。
- **内部结构**：
  - 类型：`FetchLike = (input: string, init?: RequestInit) => Promise<Response>`；`HttpMethod = 'GET'|'POST'|'PATCH'|'DELETE'|'PUT'`；`TaigaRequest { method; path; query?: Record<string,string>; body?: unknown }`；`TaigaAuth = { type:'password'; username; password } | { type:'token'; token; refresh? }`；`RawResponse { status; json; header(name): string|null }`；
  - 常量：`MAX_PAGES = 1000`（防御性翻页上限）；
  - 私有：`TokenPair { authToken; refreshToken: string|null }`、`mapStatusToError`、`extractErrorDetail`；
  - `class TaigaClient`：构造 `(baseUrl, auth, fetchLike?)`（`baseUrl` 尾斜杠剥除，`fetchLike` 缺省 `globalThis.fetch`）；`buildUrl`；私有 `fetchOnce`/`login`/`revalidate`/`exchange`/`ensureTokens`；公开 `request`、`paginate`。
- **导出与依赖**：模块导出 7 项（`FetchLike`/`HttpMethod`/`TaigaRequest`/`TaigaAuth`/`RawResponse`/`MAX_PAGES`/`TaigaClient`；`mapStatusToError` 不导出）；`index` 只转出 `TaigaClient`/`FetchLike`/`TaigaAuth`/`TaigaRequest`（错误类型来自 `errors.ts`）。依赖：`shape.ts`（`asObject`/`optString`）、`errors.ts`；无 contract import。
- **IO 与注入**：唯一网络出口。`fetchLike` 构造期注入（测试 fake 回放，零真实网络）。无文件、无 env、无时钟（`Date` 不取）。
- **状态与并发**：`tokens` 是实例内可变缓存。**无 single-flight**：首次并发 N 个请求可能各自 `login()`（N 次认证）；401 同时命中时也可能各自刷新（刷新风暴）。无锁、无 fencing；只做「401 → 刷新/重登 → 重试同一请求一次」，不重试 429/5xx。
- **错误 / 观测 / 秘密**：
  - 状态映射（`mapStatusToError`）目标按**两轴**逐行给（`failure` / `category` / `subcause`），同一 `failure` 不因状态码不同而混轴：

    | HTTP | `failure`（77-§11.1） | `category` | `subcause` | 处置含义 |
    |---|---|---|---|---|
    | 400 | `rejected_precondition` | `CONFIG_INVALID` | `bad-request` | 补齐/更正入参后可重试；**不得**自动重试 |
    | 401 | `rejected_authority` | `EXTERNAL_REJECT` | `auth-rejected` | 先取/换凭据，不重试 |
    | 403 | `rejected_forbidden` | `EXTERNAL_REJECT` | `auth-rejected` | 换路径或补授权，不重试 |
    | 404 | `rejected_precondition` | `CONFIG_INVALID` | `not-found` | 目标不存在；纠正单号/路径后可重试 |
    | 409 | `rejected_version` | `EVOLVE_REJECT` | `platform-version-conflict` | **重读当前版本 + CAS** 后再决定；不得盲目重试 |
    | 422/其余 4xx | `rejected_precondition` | `CONFIG_INVALID` | `client-error` | 调用方入参不合法 |
    | 429 | `unavailable` | `STALL` | `rate-limited` | 退避后串行重试（计入断路） |
    | 5xx | `unavailable` | `STALL` | `server-error` | 退避后串行重试；不得并行扇出 |
    | 网络异常 | `unavailable` | `STALL` | `network-error` | 退避重试；消息含 `baseUrl` 与异常文本，不含凭据 |
    | 2xx 非 JSON / 形状漂移 | `unsupported` | `EVOLVE_REJECT` | `unexpected-response(-shape)` | 绑定无法解释该响应：换绑定/替代路径，不重试 |
    | 认证交换失败（token 态无法重登） | `rejected_authority` | `EXTERNAL_REJECT` | `auth-rejected` | 不重试；明报「token 态无法重登」 |

  - 与现状的差异（**这次修订的实质变更**）：现状 401/403/404/409/429/5xx 全部压进 `CONFIG_INVALID` 或 `EXTERNAL_REJECT`（无 `failure`），其中 409 记作 `conflict`、404 记作 `not-found`、形状漂移记作 `CONFIG_INVALID/unexpected-response`。目标按上表改轴：**409 归 `rejected_version`（不是 `conflict`）**——实体 `version` 不符是「预期版本不符，重读后可重试」，不是「两源事实冲突待裁决」；**形状漂移归 `unsupported`/`EVOLVE_REJECT`**（绑定解释不了，不是配置错）。两处都会改调用方行为与既有测试断言，属**行为变更**，须单独提交并留前后对照（§七 M2 前置、§八 D15）。
  - **承重条件**：`fields.provision` 的 TOCTOU 吸收（`postOrAbsorbDuplicate`）判据**改为** `failure='rejected_precondition'` 且 `subcause='bad-request'`；改 `subcause` 值会同时改 provision 幂等语义（§八 D6）。
- **测试与证据**：`src/transport/http.test.ts`（错误映射表逐行、JWT 登录/刷新/401 重试、URL/查询编码、分页头与短页兜底、构造期校验）。**未证**：无超时/取消/背压下真实长连接行为；无 429/5xx 退避证据；无真实网络（所有测试走 fake fetch）；上表 `failure` 栏**未实现、未测**（现状只断言 `category`/`subcause`）。
- **规模与迁移**：223 行。目标：`transport/` 仍 6 件；不得 import `../fieldmap.ts`（BC-T1）。

#### F-taiga-transport-context · `packages/taiga/src/transport/context.ts`（339 行）

- **处置**：目标-保留（实现不动）。顺手项：把文件中部第 42 行的 `import { asArray, ... } from './shape.ts'` 提到顶部 import 区（纯风格，零行为）。
- **归属**：实现层；78-§9.3「公司作用域 = 项目」；80-§6.8 机制件。
- **职责 / 非职责**：持有「一个公司作用域实例」的项目 id、成员、状态集、属性集缓存，提供按名/按 id 解析与单号编解码；提供专用属性值端点读写。不决定业务语义（状态推进归 `issues`/`factory`）、不写台账、不持有凭据（凭据在 `TaigaClient`）。
- **内部结构**：
  - `FieldMapLike`（6 成员：`initialStateFor`/`toPlatform`/`requirePlatform`/`encode`/`decode`/`typeOf`）——**结构型依赖倒置**，`transport` 不 import `fieldmap`（BC-T1）；
  - `MemberInfo { id; username }`、`StatusInfo { id; name; slug }`、`AttributeInfo { id; name; type }`、`EntityRaw { id; ref; subject; status; version; modifiedDate; description?; assignedTo? }`（字段以 `parseEntity` 实际读取为准）；
  - 导出 `parseEntity`/`parseEntityList`、`MemberInfo`/`StatusInfo`/`AttributeInfo`/`EntityRaw`/`FieldMapLike`；
  - `class TaigaContext`：`readonly client/desc/projectSlug/fieldMap`；私有 `projectId/memberList/statusList/attrList`（全部 `null` 起）；`resolveProject`（GET `/projects/by_slug`，校验 slug 回显一致并把 `members` 一并解析）；`project()`/`members()`/`statuses()`/`attributes()`；`invalidateMeta()`（状态+属性）；`invalidateMembers()`（项目 id+成员一起作废）；`statusIdByName`/`statusNameById`/`attributeIdByName`（**bound=1 自愈**：miss → 作废 → 重读一次 → 仍缺才抛）；`attributeNameById`/`usernameById`（`undefined` 返回，**不自愈**，防读放大）；`idByUsername`（自愈一次）；`ticketId(ref)`/`parseTicketId(id)`（`<slug>-<ref>`，ref 正安全整数）；`fetchEntityByRef(ref)`、`fetchAttrValues(internalId)`、`patchAttrValues(internalId, attrs)`。
  - `patchAttrValues` 语义：GET 现值 + `version` → PATCH `{ attributes_values: {...existing, ...attrs}, version }`（**整体替换**的值对象，必须先合并；否则抹掉其他自定义维）。
- **导出与依赖**：导出上述类型 + `TaigaContext` + 两个 parse 函数。依赖：`http.ts`（type）、`entities.ts`（type）、`errors.ts`、`shape.ts`。**禁止** import `fieldmap.ts`。
- **IO 与注入**：只经 `ctx.client.request` 出网；无时钟、无文件、无 env。
- **状态与并发**：缓存按实例生命周期信任；`invalidateMeta`/`invalidateMembers` 是**调用方责任**（写面自己调或用例调）。并发首请求可能重复 `resolveProject`/`statuses`（无 single-flight），结果按后写覆盖，语义等价但浪费请求。无预期版本/锁；`patchAttrValues` 的 version 只覆盖值对象，不与实体 PATCH 同事务。
- **错误 / 观测 / 秘密**：`CONFIG_INVALID/unknown-project`（含期望/实得 slug）、`unknown-state`、`issue-missing-state`、`unknown-attribute`、`unknown-user`、`bad-ticket-id`。错误文本列出可用状态名/角色名，**不含**凭据。无日志。**注**：`statusNameById`/`statusIdByName` 各带一次有界自愈（缓存 miss → 重读真源一次）；仍缺即抛——这条抛错是「未知状态第二层」的落点，见 §4.5.1 与 §八 D11。
- **测试与证据**：`src/context.test.ts`（T1 自愈、`invalidateMembers`）、`src/issues.test.ts`（单号解析/属性读写间接）、`src/transport/http.test.ts`（构造期）。**未证**：并发首请求的登录/解析风暴；长实例缓存与平台侧手改的收敛时间。
- **规模与迁移**：339 行；实现不动，只做 import 归位。

#### F-taiga-transport-entities · `packages/taiga/src/transport/entities.ts`（75 行）

- **处置**：目标-保留。
- **归属**：实现层；Taiga 三实体路径档案（docs/32 真机形状）。
- **职责 / 非职责**：把实体名映射到路径段（`collection`/`statuses`/`attributes`/`history`）与默认页大小。不校验实体是否存在（`entityDescriptor` 对未知值抛裸 `Error`——属编程错误，不是业务拒绝）；不决定运行时绑定哪个实体（归 `platform` 选项）。
- **内部结构**：`TaigaEntity = 'userstory'|'issue'|'task'`；`LIST_PAGE_SIZE = 100`；`EntityDescriptor { entity; collection; statuses; attributes; history }`；`ENTITY_DESCRIPTORS`（userstory→`userstories`/`userstory-statuses`/`userstory-custom-attributes`/`userstory`；issue→`issues`/`issue-statuses`/`issue-custom-attributes`/`issue`；task→`tasks`/`task-statuses`/`task-custom-attributes`/`task`）；`entityDescriptor(entity)`。
- **导出与依赖**：导出 5 项；零依赖。
- **IO 与注入**：零 IO。
- **状态与并发**：常量表，只读。
- **错误 / 观测**：未知实体 → 裸 `Error`（构造期配置错误；`platform.validateOptions` 不校验 `entity`，未知值会延迟到 `buildContext` 的 `entityDescriptor` 才炸——**登记为可改进项**，§八 D7）。
- **测试与证据**：无独立测试；经 `factory.test.ts`（多实体）、`issues.test.ts`（绑定实体）间接覆盖。**未证**：三实体路径在真机的差异面（task 状态集/属性集仅 fake 与试点记录）。
- **规模与迁移**：75 行。

#### F-taiga-transport-shape · `packages/taiga/src/transport/shape.ts`（85 行）

- **处置**：目标-保留。
- **归属**：实现层；80-§5.7「响应先 `unknown` 再 parse」的 taiga 手写版（本包零 zod）。
- **职责 / 非职责**：只校验适配器消费的字段，形状漂移一律明报。不做 schema 版本协商、不透传未知字段（未建模字段丢弃）、不做业务值域校验。
- **内部结构**：`Raw = Record<string, unknown>`；私有 `fail(ctx, detail): never`（抛 `CONFIG_INVALID/unexpected-response-shape`，消息带上下文路径）；`asObject`/`asArray`/`reqString`/`optString`/`optStringNull`/`reqNumber`/`optNumber`/`optBoolean`/`optNumberNull`/`reqObject`/`optObject`/`optAttrValues`。
- **导出与依赖**：导出 `Raw` 类型 + 12 个函数（`asObject`/`asArray`/`reqString`/`optString`/`optStringNull`/`reqNumber`/`optNumber`/`optBoolean`/`optNumberNull`/`reqObject`/`optObject`/`optAttrValues`）；只依赖 `errors.ts`。
- **IO 与注入**：零 IO、零状态。
- **错误 / 观测**：单一 subcause `unexpected-response-shape`；`ctx` 字符串是唯一定位手段（如 `projects/by_slug.members`）。
- **测试与证据**：无独立测试；由各面用例反证（`http.test.ts` 的坏体、`factory.test.ts` 的入参防御）。**未证**：无属性测试/模糊测试；无超大数组的形状校验耗时证据。
- **规模与迁移**：85 行。**纪律**：新增平台字段必须新增窄校验，不得直接 `as` 断言。

#### F-taiga-transport-errors · `packages/taiga/src/transport/errors.ts`（32 行）

- **处置**：目标-保留 + **补 `failure` 栏**；`notImplemented` **目标-退役**。退役理由：它抛 `CONFIG_INVALID/taiga-<face>-not-implemented`，而 77-§11.1 的「该绑定不支持此语义」是 `unsupported`（`Err` 面）；绑定面要明报未支持应走 `Err({failure:'unsupported', category:'EVOLVE_REJECT'})`，不是抛一个 `CONFIG_INVALID`。删除**不构成对外破坏**（未进包根导出面），但属源码删除，须与 M2 同批并留 diff 证据。
- **归属**：实现层；80-§5.7（两轴 + `Err` 可达 `category` 六个）；77-§11.1（十四类 `failure`）；`contract` 的 `ErrorCategory`（现状 `contract/src/ports/kernel.ts:85-96` 11 值；`ClassifiedError` 在 `:98`）与目标 `FailureClass`。
- **职责 / 非职责**：定义本包唯一错误类型 `TaigaPlatformError`，其**可读字段**就是 `ClassifiedError` 的四项：`failure`、`category`、`subcause`、`detail?`（外加 `name`/`message`）。**不是** `Result` 承载面：`binding.ts` 的失败走 `Result.Err`，本类型在绑定内部只作为**被捕获的底层错误**，边界处按字段搬运成 `ClassifiedError`（§4.5.1 末条）。不提供重试策略、不做错误聚合、不做脱敏（脱敏是 `contract` 纯函数）。
- **内部结构**：
  - `class TaigaPlatformError extends Error`：构造 `(failure, category, subcause, message, detail?)`；公开只读四字段；`message` 只给人读，**不得**被下游解析。
  - `function notImplemented(face, reason)`（**目标-删除**）：现返 `CONFIG_INVALID`；若保留到 M2 之前，只允许出现在宿主 `exportBundle()` 的拒绝路径，其余零处调用。
  - 目标新增一个**薄转换** `toClassifiedError(e: TaigaPlatformError): ClassifiedError`（字段搬运，无查表、无猜）；它不是新端口，只是同文件内的 4 行纯函数。
- **导出与依赖**：现导出 2 项；目标 1 项（`TaigaPlatformError`）+ 同文件内部 `toClassifiedError`（是否导出随 `binding.ts` 需要，**不新增公共概念**）。只 type-import `ErrorCategory`/`FailureClass`。
- **IO 与注入**：零 IO。
- **状态与并发**：无状态。
- **错误 / 观测 / 秘密**：本文件即**全包 subcause 词表**的唯一登记处（下表）。新增 subcause 必须在此登记并给 `failure`/`category`，否则视为实现缺陷；`subcause` 不得被下游当判等键（80-§5.7）。

  | subcause（稳定串） | `failure` | `category` | 出处 |
  |---|---|---|---|
  | `bad-base-url` / `bad-project` / `bad-auth` / `bad-entity` | `rejected_precondition` | `CONFIG_INVALID` | `platform.validateOptions`（`bad-entity` 为 D7-6 的目标补位） |
  | `bad-request` / `client-error` | `rejected_precondition` | `CONFIG_INVALID` | `http.mapStatusToError`（400 / 其余 4xx） |
  | `auth-rejected` | `rejected_authority`（401）/ `rejected_forbidden`（403） | `EXTERNAL_REJECT` | `http.ts` |
  | `not-found` / `issue-not-found` / `kb-not-found` | `rejected_precondition` | `CONFIG_INVALID` | `http.ts`/`issues.requireEntity`/`kb.kbGet`（**「不存在」不是失败类**，但 `FlowPlatform` 的 `Promise<T>` 无 `undefined` 通道，只能以「前置：目标存在」拒绝；契约侧缺口见 D14）。**别与 80-§5.7 的 404 覆盖混用**：那条覆盖只指**我方对外 API 的路由不存在**（`subcause:'not-found'`，`EXTERNAL_REJECT`），不是出境平台调用的 404；本条按缺省 `CONFIG_INVALID` 记，D14 回写后应改为 `Ok(undefined)` 而非换 category |
  | `platform-version-conflict` | `rejected_version` | `EVOLVE_REJECT` | `http.ts` 409 / `comments.addComment` / `kb.kbUpsert` |
  | `rate-limited` / `server-error` / `network-error` | `unavailable` | `STALL` | `http.ts` |
  | `unexpected-response` / `unexpected-response-shape` | `unsupported` | `EVOLVE_REJECT` | `http.ts`/`shape.fail` |
  | `unknown-project` / `unknown-state` / `unknown-attribute` / `unknown-user` / `bad-ticket-id` | `rejected_precondition` | `CONFIG_INVALID` | `transport/context.ts` |
  | `issue-missing-state` | `conflict` | `EXTERNAL_REJECT` | `transport/context.ts`（平台状态集漂移=两源不一致待裁；不是「调用方输入错」，D11） |
  | `bad-provision-map` / `attribute-type-mismatch` / `bad-field-map` / `unmapped-field` / `bad-field-value` / `bad-create-input` / `unknown-field` / `state-via-set-field` / `bad-signed-body` / `bad-kb-body` / `kb-path-invalid` / `bad-cursor` / `self-link` / `bad-link-type` / `bad-guard-rules` / `bad-company-slug` / `company-scope-mismatch` / `unknown-role` / `no-roles` | `rejected_precondition` | `CONFIG_INVALID` | 各业务件（入参/配置不合法，补齐后可） |
  | `links-unsupported` / `taiga-<face>-not-implemented` | `unsupported` | `EVOLVE_REJECT` | `links.link` / `notImplemented`（后者目标-删除） |
  | `register-rejected` | `conflict` | `EXTERNAL_REJECT` | `memberships.registerWithInviteToken`（平台拒绝且语义≈已建号，须先裁决，不得重试） |
  | `binding-profile-incomplete` / `loss-refs-missing` / `exit-plan-facts-missing` / `empty-platform-state` / `digest-unavailable` / `export-assembly-outside-binding` | 前四 `rejected_precondition`；`export-assembly-outside-binding` 为 `unsupported` | 前四 `CONFIG_INVALID`；最后一个 `EVOLVE_REJECT` | `binding.ts`（§4.2/§4.5） |

  消息是唯一观测面，**不得**含凭据（token/密码及其前缀、哈希）；可含 `baseUrl`（配置项）与平台错误 `detail`（过脱敏）。
- **测试与证据**：无独立测试；由 `http.test.ts` 的错误映射表与各面 `expectTaigaReject`（`instanceof` + 两级匹配）间接覆盖。**未证**：上表 `failure` 栏与「两轴不混用」**未实现、未测**；`expectTaigaReject` 目标须扩为三参（`failure`/`category`/`subcause`），现有断言只锁后两者。
- **规模与迁移**：32 行 → 去 `notImplemented`（约 -7）+ 加 `failure`/`toClassifiedError`（约 +10）≈ 35 行，仍 <600。迁移顺序：先补四字段（向后兼容：旧调用点改传 `failure`），再删 `notImplemented`（与宿主 `exportBundle()` 的 `Err` 同批）。

### 4.2 组装与绑定档案（3 件）

#### F-taiga-platform · `packages/taiga/src/platform.ts`（160 行）

- **处置**：目标-保留 + **补 `guards.read` 接线**（把 `guards.readTaigaRoles` 投影成 `PlatformRole[]`，只在 `company === projectSlug` 时返回）。是否转必选由 `contract` 决定（§八 D4）；现状 `read?` 是可选位，缺位不得被调用方当成「无限制」。
- **归属**：实现层；78-§9.3 `BIND-PLAT-TAIGA-01` 的落地组装；80-§6.8 `FlowPlatform` 保留清单；80-§2.4「实现不动」只允许端口侧补面。
- **职责 / 非职责**：校验构造选项 → 建 `TaigaClient` + `TaigaContext` → 把七能力方法逐个接到业务件。不实现业务规则、不做 provision（明确留给 onboard/迁移脚本）、不读 env（凭据由调用方解析后传入）。
- **内部结构**：
  - `TaigaPlatformOptions { baseUrl; project; auth; entity?; fields?; fetch?; pageSize? }`（默认：`entity='userstory'`、`fields=undefined`、`fetch=globalThis.fetch`、`pageSize=DEFAULT_PAGE_SIZE=100`）；
  - `validateOptions`：`bad-base-url`（非 http(s)）、`bad-project`（空）、`bad-auth`（缺省、密码态空 username/password、token 态空 token、未知 type）；
  - `buildContext(opts): TaigaContext`（校验后组装；`daemon` 以此取上下文跑 memberships/factory，**`TaigaContext` 不从包根导出**）；
  - `createTaigaPlatform(opts): FlowPlatform`——`issues` 五方法、`comments` 两方法、`fields` 两方法、`kb` 三方法、`activity.since`、`links` 两方法、`guards.install/uninstall`（目标加 `read`）。
- **导出与依赖**：导出 3 项（`TaigaPlatformOptions`/`buildContext`/`createTaigaPlatform`）。依赖：contract 类型 + `activity`/`comments`/`context`/`entities`/`errors`/`fields`/`fieldmap`/`guards`/`http`/`issues`/`kb`/`links`。
- **IO 与注入**：构造期无 IO；运行期 IO 全在下游。`fetch` 与 `pageSize` 是唯一的测试注入点（`pageSize` 小值验证翻页）。
- **状态与并发**：每次 `createTaigaPlatform` 建一个新 `TaigaContext`（实例=公司作用域）；同实例内缓存见 `context`。无单例、无全局锁。
- **错误 / 观测 / 秘密**：构造期同步抛 `CONFIG_INVALID`；运行期错误透传下游。选项校验错误消息含 `baseUrl` 值（配置非秘密），不含 `auth` 值。目标 `guards.read` 的 `company` 作用域校验复用 `guards.requireCompanyScope`（`company-scope-mismatch`）。
- **测试与证据**：`src/issues.test.ts`「构造期校验（公司作用域绑定）」、`src/guards-links.test.ts`（经 `makePlatform`）、`src/onboard.test.ts`。**未证**：`guards.read` 接线后与 `PlatformRole`（`{slug,name,permissions}`）的投影一致性——未实现、未测。
- **规模与迁移**：160 行；加 `read` 后约 +8 行，仍 <600。

#### F-taiga-binding · `packages/taiga/src/binding.ts`（**目标-新增**）

- **处置**：**目标-新增，可施工**；本件是 **Taiga 绑定档案的提供者**，**不是 `PlatformBindingPort` 的宿主**。80-§6.9 的端口落点表把 BIND-01 的实现家定在 `apps/daemon/src/assembly/platform/binding.ts`——「把 `FlowPlatform` 包装成绑定档案」（现状 `wire.ts` 已在该目录），由它实现 `PlatformBindingPort{describe, mapState, exportBundle, exitPlan}`；本件只给三样东西：**档案内容、纯函数、拒绝面**（80-§6.6「三层归属」：类型唯一在 `contract/src/ports/binding.ts`、通用宿主唯一在 `assembly/platform/binding.ts`、平台包只出 `bindingProfile`/`mapState`/`lossReport` 三个纯函数——本卷不再有第四项导出，也不实现端口本体）。80-§6.6 的 20 字段 `BindingProfile`、`StateMapping`、`ExportScope`/`ExportBundle`/`ExitPlan` 与 `Result<_,ClassifiedError>` 语义**逐字照落，不另立字段**。剩下的不是「接口未定」，而是三类**输入从哪来**的实现前置：
  - **档案内容（宿主 `describe()` 的数据源）**——需调用方注入「档案事实」（`lossRefs`/`ownerPositionRef`/`authorization`/`effective`/`probes`/`version`）与摘要函数；缺一项即 `Err(rejected_precondition)`，不补散文（§4.5.2）。本件产出的是 `BindingProfile`（函数名 `bindingProfile()`，80-§6.6 三层第 3 条），**不是 `describe()` 方法**。
  - **导出拒绝面**——本件**不组装导出束**：`ExportBundle` 的 `receipts`/`openObligations`/`losses`/`proof.signature` 只能由台账与签名方产出（`REC-RCP-01`/`REC-EVD-*`/daemon 密钥），本包既无读口也无密钥。本件只给 `exportMigrationExit.exportShape`（随档案暴露的**声明**）＋一个**内部**纯函数 `judgeTaigaExport`（判 scope 六要素；不导出、不新增公共名）；宿主拿到 `Ok` 后仍返 `Err({failure:'unsupported', category:'EVOLVE_REJECT', subcause:'export-assembly-outside-binding'})`。**不得**返回半包、不得用 `[]` 冒充「无未决义务」、不得自签（D10）。
  - **退出声明**——`ExitPlan` 九个槽里至少五个是**运行时事实**（`frozenAt`/`verifiedBy`/`acceptedBy`/`fenceToken`/`activatedAt`…），静态绑定无法凭空填。本件只给**声明槽**（随 `exportMigrationExit.exitPlan` 骨架）与**内部** `requireExitFacts` 校验，**不产出 `ExitPlan` 本体**；`fenceToken` 在 Taiga 上无真值，故 D13 回写前宿主不开 `exitPlan`（§4.5.4、§8.1）。**不得**伪造时间戳/签名者/围栏令牌。
- **归属**：绑定层；80-§6.6 `TS-PORT-BIND-01`（语义）、80-§6.9（落点：类型 `contract/src/ports/binding.ts`、实现 `assembly/platform/`）；78-§9.3 `BIND-PLAT-TAIGA-01`、§9.5 映射骨架、§9.6 未知回执与对账、§9.7 迁移七步；76-§7.7 `STAT-D`；80-§4.5 规范化（`semanticDigest`）；79-§4.4 源码态导出。**不**把 `FlowPlatform` 改名冒充绑定（80-§6.6 末条已判负）；也**不**把本件写成第二个端口宿主——同一端口两份实现即双轨。
- **职责 / 非职责**：把 Taiga 的**静态绑定知识**（七能力覆盖/不覆盖、字段映射、状态映射、供给方式、探针矩阵、损失引用、导出形状、退出声明）表达为可被宿主装配的**档案事实**，并提供入向状态映射。**非职责**：不实现 `PlatformBindingPort` 四方法（属于宿主）、不实现能力（在 `FlowPlatform`）、不写平台、不迁移、不导出、不写任何 `REC-*`（含 `REC-LOSS-01`/`REC-OBS-02`）、不持密钥、不签名、不判授权（授权引用由部署方给）、不取时钟。
- **内部结构**（逐签名；语义表见 §4.5）：
  - 实现输入 `TaigaBindingFacts`（**不是新公共端口**，只是三个纯函数的入参结构）：`lossRefs: readonly Qid[]`（`REC-LOSS-01` 引用，由 daemon/注册流程给）、`ownerPositionRef: Qid`、`authorization: { bindingAuthorityRef; activationRef? }`、`effective`、`probes`、`version`、`factStatus`、`digestOf?: (body: unknown) => Digest`、`exitFacts?: …`（`ExitPlan` 的事实槽）。构造期校验：`lossRefs` 为空 ⇒ **拒建**（空数组是「无损失」的断言，Taiga 有已知损失，见 §4.5.2 第 16 行）；`stateMappings[].workStates` 含 `STAT-E`/`STAT-H`（或不在 `STAT-D` 十态内）⇒ 拒建；`ownerPositionRef` 的 `kind ∉ {position, governance-position}` ⇒ 拒建。
  - `bindingProfile(facts, digestOf?): Result<BindingProfile, ClassifiedError>`（80-§6.6 三层第 3 条名；旧称 `describeTaigaBinding` 已废弃——80 只认 `bindingProfile()`）——**纯组装、同步、零 IO、零网络**（宿主 `describe()` 直接转调它）：20 字段来源见 §4.5.2；`semanticDigest` 用 `digestOf`（缺省取 `contract` 的规范化器，80-§4.5 `studio-next/jcs@1`；**本件不手写 jcs**，否则就是第二套规范化）；`digestOf` 与规范化器都不可用 ⇒ `Err(rejected_precondition,'digest-unavailable')`。`probes[].state` 只许 `executed`/`not-executed`/`not-applicable`，**不得**写「预期通过」；`factStatus` 与 `uncoveredObjects` 必须同时如实（§4.5.2 末日口径）。字段不齐 ⇒ `Err('binding-profile-incomplete')`，**不得**删字段充当「运行时视图」，也**不得**用 `Pick<BindingProfile,…>`/`Partial<BindingProfile>`/展开重拼造出「字段不全的档案」——`BindingProfile` 只有 20 字段齐或 `Err` 两种形态（80-§6.6 前置；本卷不存在「用 Pick 凑一个够用的子集」这条路）。
  - `mapState(platformState: string): Result<StateMapping, ClassifiedError>`——**同步、纯函数、零 IO、零时钟、不写任何记录**；三情形见 §4.5.1：声明命中 ⇒ `Ok({platformState, workStates:[…], verification:'verified', unmappedBehavior:'observe-unmapped'})`；非空合法未声明 ⇒ `Ok({platformState, workStates:[], verification:'unverified', unmappedBehavior:'observe-unmapped'})`（**`REC-OBS-02` 不在此落**：由宿主的观察投影 `TS-PORT-OBS-01`/daemon 据 `verification:'unverified'` 落）；空串/畸形 ⇒ `Err({failure:'rejected_precondition', category:'CONFIG_INVALID', subcause:'empty-platform-state'})`。`platformState` **原样保留**，不归一化、不模糊匹配。
  - `lossReport(facts): Result<readonly Qid[], ClassifiedError>`（80-§6.6 三层第 3 条名）——把注入的 `lossRefs` 原样交出（`REC-LOSS-01` 引用清单，不内联损失内容）；空清单 ⇒ `Err(rejected_precondition,'loss-refs-missing')`；**不写记录**——落 `REC-LOSS-01` 引用是宿主 `describe()` 的事（三层第 2 条）。
  - `judgeTaigaExport(scope: ExportScope, projectSlug: string): Result<void, ClassifiedError>`（**内部件，不从包根导出**）——只判 scope 六要素（§4.5.3）：`company !== projectSlug` ⇒ `rejected_forbidden`；不支持的 `factDomains`/非空 `memories.include` ⇒ `unsupported`（配 `EVOLVE_REJECT`）；`knowledgeScope` 无法证明包含 ⇒ `rejected_forbidden`（fail-closed）。**组装导出束不在本件**（宿主据 `Ok` 仍只返 `unsupported/export-assembly-outside-binding`）。
  - `taigaExitDeclaration(facts): TaigaExitDeclaration` + `requireExitFacts(facts): Result<void, ClassifiedError>`（**内部件，不导出**）——`TaigaExitDeclaration` 是**本件内部结构类型**（不进 `contract`、不当公共概念：它只装「本平台无围栏」等声明槽，供宿主拼 `ExitPlan`）。前者给 §4.5.4 的**声明槽**（动作清单、`archive.mode='read-only'`/`deleted:false`、「无平台侧围栏」的判断、`unresolved` 必列项），后者校验事实槽齐备、缺则 `Err('exit-plan-facts-missing')`。**本件不产出 `ExitPlan` 本体**（`fenceToken` 等事实槽在 D13 回写前无真值）；**读 `ExitPlan` ≠ 退出完成**（80-§6.6 后置）：执行须经 `TS-PORT-WORK-05 WorkLifecycle`（状态迁移）/`TS-PORT-WORK-07 SettlementPort`（结清）/`TS-PORT-LIFE-02 HandoverArchivePort`（交接档案）并落记录，本包只声明不执行。
- **与宿主的分工（一句话判据）**：**凭档案与纯函数能算的在本件，需要台账/密钥/时钟/观察位的在宿主。** 宿主 `apps/daemon/src/assembly/platform/binding.ts` 的四方法映射：`describe()`→`bindingProfile` + `lossReport`（引用由宿主按需落 `REC-LOSS-01`）；`mapState()`→本件 `mapState`（并把 `unverified` 交观察投影落 `REC-OBS-02`）；`exportBundle()`→档案里的 `exportShape` 声明 + 内部 `judgeTaigaExport` + 固定 `unsupported`（category 一律 `EVOLVE_REJECT`，subcause `export-assembly-outside-binding`）；`exitPlan()`→内部 `taigaExitDeclaration` + daemon 注入的 `exitFacts` + `requireExitFacts`。宿主文件属 daemon 分卷，本附录只登记该依赖与交接语义，不改其内容。
- **导出与依赖**：从 `index.ts` 再导出**恰好 3 个纯函数**——`bindingProfile`/`mapState`/`lossReport`（80-§6.6 三层第 3 条所列的三个名字，**不增名、不改名**；旧称 `createTaigaBindingSource` 工厂方案作废，80 要的是纯函数不是工厂）；`TaigaBindingFacts` 只作 type-only 导出。`judgeTaigaExport`/`taigaExitDeclaration`/`requireExitFacts` 一律内部件，**不得**从包根导出。依赖：`contract`（`BindingProfile`/`StateMapping`/`ExportScope`/`Result`/`ClassifiedError`/`FailureClass`/`Qid`/`WorkState` + 规范化器；**只 import 类型与纯函数，不 import `PlatformBindingPort`**）＋本包 `transport/entities`（实体清单）与 `fieldmap` 的**只读**常量（`PORT_TYPES`）。**不依赖** `platform.ts`（避免组装环）、不依赖 `http.ts`/`context.ts`（零网络）、不依赖 `issues`/`kb`/`activity`/`links` 的读面（导出不在本件）、不依赖 `guards.ts` 写面。
- **IO 与注入**：**全件零 IO、零时钟、零随机、零网络**（`exportShape` 与内部 scope 判定不翻页、不读全量）。唯一注入是 `digestOf`（摘要）与 `exitFacts`（退出事实），二者都不读外部世界。
- **状态与并发**：构造后不可变（深冻结）；档案组装可 memo（同输入同输出），但**不得**缓存平台真源（状态集/单据）。无事务、无幂等键需求（全是只读或纯计算）；`mapState` 天然幂等。
- **错误 / 观测 / 秘密**：失败一律 `Result.Err(ClassifiedError)`（本件无 `exitPlan` 抛错通道：事实缺口也用 `Err('exit-plan-facts-missing')`）；`failure` 取 77-§11.1，`category` 按 80-§5.7 **缺省推导**（本件只出现 `CONFIG_INVALID`/`EVOLVE_REJECT`/`EXTERNAL_REJECT`）：`unsupported`⇒`EVOLVE_REJECT`、`conflict`⇒`EXTERNAL_REJECT`（本包不在合并域，**不写 `MERGE_CONFLICT`**；`STATE_CONFLICT` 不是 `ErrorCategory` 成员）；不产生 `STALL`/`NO_LANE`。subcause 见 §4.1 `errors.ts` 表末行。底层 `TaigaPlatformError` 不穿透（宿主在边界处用 `toClassifiedError` 搬四字段）。档案**不得**含 `auth`、token、密码、`baseUrl` 的凭据段；`baseUrl` 作为 `scope.platforms[].host` 是配置非秘密。
- **测试与证据**（`src/binding.test.ts`，**目标-新增**；R＝读面/纯函数、E＝错误面、W＝写面、V＝验证/证据）：**R** `bindingProfile` 20 字段齐、每字段有来源、`lossRefs` 经 `lossReport` 逐项进 `losses`；`mapState` 三情形各一例；包根导出面**恰好** `bindingProfile`/`mapState`/`lossReport` 三个函数（断言无 `describe`/`exportBundle`/`exitPlan`）；**E** 缺 `lossRefs`/含 `STAT-E`/空 `platformState`/缺退出事实四类拒绝各一例，且 `Err` 的 `failure`/`category` 双轴不混（`unsupported`→`EVOLVE_REJECT`、`conflict`→`EXTERNAL_REJECT` 各显式断言一次）；**W** N/A（零写面，**且零记录写入**：用例断言本件不产生 `REC-OBS-02`/`REC-LOSS-01`）；**V** 全用例断言 `FakeTaiga.calls.length === 0`（证零 HTTP）。**不证明**：真机导出、迁移、退出执行、`semanticDigest` 跨实现一致（78 `L78-CORE-02`）、`REC-LOSS-01` 记录真的存在（本件只收引用）、宿主 `assembly/platform/binding.ts` 的四方法接线（不在本卷）。
- **规模与迁移**：预估 200–300 行（静态档案表占大头），<600；`src` 直属件 +1（见 §3.5）。若超 400 行，静态表拆 `src/binding/profile.ts`，**仍算 `F-taiga-binding` 一件**（不新增 ID、不新增域平面散件）。

#### F-taiga-index · `packages/taiga/src/index.ts`（87 行）

- **处置**：目标-保留。`PACKAGE_STATUS = 'onboard-cut'` 现状与包真实覆盖度不完全一致（links 写面显式不支持、guards 无基线、binding 未落地），目标**保留常量名与仓内既有取值域**（`ready`/`partial`/`skeleton`/`onboard-cut`），改值为如实档（建议 `partial`）；不新增枚举、不新增导出，不退役常量（与 `81-files/09-yt.md` 同口径）。`PACKAGE_NAME` 保留。
- **归属**：包根；79-§4.4 源码态导出面；80-§2.4。
- **职责 / 非职责**：声明本包**对外承诺面**：七能力工厂 + 上下文构造 + 客户端/错误/游标工具 + guards 角色读 + factory 五函数 + memberships 八函数 + 实体类型。不导出 `TaigaContext`、`TaigaFieldMap`、`LIST_PAGE_SIZE`、`MAX_PAGES`、`readRoles`、`validateProvisionMap`、各业务件内部函数——这些是**实现细节**，跨包消费者只应经 `FlowPlatform` 或明确列出的函数使用。
- **内部结构**：头注含「七能力覆盖表」（issues/comments/fields/kb/activity/links/guards 逐项状态 + 已知边界 5 条 + 端口缺口 5 条）；导出分六组：平台与传输（`createTaigaPlatform`/`buildContext`/`TaigaPlatformOptions`/`TaigaClient`/`FetchLike`/`TaigaAuth`/`TaigaRequest`/`TaigaPlatformError`）、活动游标（`DEFAULT_PAGE_SIZE`/`encodeCursor`/`decodeCursor`）、守卫（`readTaigaRoles`/`TaigaRoleInfo`）、出厂态（5 函数 + 7 类型）、实体（`TaigaEntity`）、memberships（8 函数 + 2 类型）；包常量 2 个。
- **导出与依赖**：见 §二 2.1 行数表；依赖全部包内件 + contract 类型。
- **IO 与注入**：本文件零 IO。
- **状态与并发**：无状态。
- **错误 / 观测**：不新增错误通道；再导出的 `TaigaPlatformError` 是唯一错误类型。
- **测试与证据**：无独立测试；`index` 的破坏会被 `daemon` 类型门禁与各测试 import 立刻发现。**未证**：无「导出面最小性」机械门禁——`taiga-face.ts` 用 `ReturnType<typeof buildContext>` 取形即是「`TaigaContext` 未导出」的张力证据（§八 D7）。
- **规模与迁移**：87 行；`binding` 落地后 +3~5 行再导出。

### 4.3 单据与协作面（8 件）

#### F-taiga-issues · `packages/taiga/src/issues.ts`（268 行）

- **处置**：目标-保留。
- **归属**：实现层；80-§6.8 `FlowPlatform.issues`；78-§9.3 写路径；docs/25-§3.2 建单落位序。
- **职责 / 非职责**：把 `IssueQuery`/`IssueCreate`/状态推进/字段写翻译成 Taiga 的 `GET /{collection}`、`POST`、`PATCH {status|subject|description|assigned_to, version}`、`PATCH custom-attributes-values`。不决定状态机合法性（只保证「目标态存在于状态集」）、不做派发、不写评论。
- **内部结构**：
  - `CUSTOM_BUSINESS_DIMS = ['type','dept','level','lane']`（**硬编码四名**；新增业务维必须改此常量 + `fieldmap` + 契约，§八 D7）；
  - `hasCustomDims`；`toIssueRecord`（原生字段 + 可选拉属性值端点；`''` 视为已清空）；`matchesQuery`（`stateIn`/`assignee`/`lane`/`updatedSince` **全部客户端过滤**）；`listIssues`（空 `stateIn` → 直接 `[]`；`lane` 未映射 → `unmapped-field`）；`requireEntity`（404 → `issue-not-found`）；`getIssue`；`validateCreate`；`createIssue`；`patchEntity`；`transitionIssue`；`setIssueField`。
  - `createIssue` 语义：`parent` 显式 `links-unsupported`；`POST {project, subject, description?, assigned_to?, status?}`——`status` 由 `input.initialState ?? fieldMap.initialStateFor(type)` 解析（`statusIdByName` 失败在 IO 前拒）；建单成功后**再** `patchAttrValues` 写 `type/dept/level`（`lane` 不写）；落位复核不符才补一次 `transition`（幂等）。
  - `setIssueField` 分派：`state` → `state-via-set-field`；`title`/`description`/`assignee` → 实体 PATCH（`assignee=null` 清空）；`parent` → `links-unsupported`；`type/dept/level/lane` → 属性值 PATCH；未知字段 → `unknown-field`。**入参校验先于取单 IO**。
- **导出与依赖**：导出 5 个公开函数（`listIssues`/`getIssue`/`createIssue`/`transitionIssue`/`setIssueField`）+ 类型由 `index` 间接暴露。依赖：`context`/`errors`/`shape`/`entities`。
- **IO 与注入**：网络经 `ctx.client`；无时钟（`updated` 用平台 `modified_date`）、无随机。
- **状态与并发**：实体 PATCH 携 `version`（乐观并发；409 → `conflict`）；`createIssue` **不是事务**：建单与属性值是两次调用，之间崩溃会留下「单在、自定义维空」；无平台幂等键，重试可能重复建单。`listIssues` 是全量拉取后客户端过滤，O(单数 × 属性请求)。
- **错误 / 观测 / 秘密**：`bad-create-input`、`unmapped-field`、`links-unsupported`、`issue-not-found`、`unknown-field`、`bad-field-value`、`state-via-set-field`、`unknown-state`（经 context）、`conflict`（HTTP 层）。无日志；错误消息可含业务字段名/单号，不含凭据。**注**：`toIssueRecord` 的 `state` 是**平台状态名**，不是 `STAT-D`——本件不做任何状态族映射（映射只见 §4.5.1）；状态 id 不在集合内时 `statusNameById` 抛出会直接打断整单读，见 §4.5.1 第二层。
- **测试与证据**：`src/issues.test.ts`（建单回环、落位、列表过滤、详情流转、setField 分派、乐观并发、构造校验）。**未证**：建单+属性写非原子的崩溃窗口；重试导致的重复建单；大数据量客户端过滤耗时；`lane` 读写在真实映射下的往返。
- **规模与迁移**：268 行；不改公开面。

#### F-taiga-comments · `packages/taiga/src/comments.ts`（95 行）

- **处置**：目标-保留。
- **归属**：实现层；80-§6.8 `FlowPlatform.comments`；78-§9.1「评论不承载结构化决定」。
- **职责 / 非职责**：把 Taiga `history` 条目解析成活动/评论；写评论=实体 PATCH 的 `comment` 字段。不判断评论语义、不抽取决定、不做署名权威校验（署名由 gateway 组装的 `SignedBody` 提供）。
- **内部结构**：`HistoryEntry { id; createdAt; username; diffKeys; comment; hidden; snapshot }`；`parseHistoryEntry`/`parseHistoryList`（`user.username` 必填，`diff` 键集化）；`fetchHistory(ctx, internalId)`（GET `/history/{desc.history}/{id}`）；`kindOfEntry`（`comment≠''`→`commented`；`diffKeys` 含 `status`→`transitioned`；非空→`field-set`；否则 `change`）；`listComments`（`hidden`/`snapshot`/空评论过滤，按 `created`、id 升序稳定）；`addComment`（校验 `author`/`body`/`signature` 均字符串，`PATCH {comment: body+"\n\n"+signature, version}`）。
- **导出与依赖**：导出 7 项（`HistoryEntry`/`parseHistoryEntry`/`parseHistoryList`/`fetchHistory`/`kindOfEntry`/`listComments`/`addComment`）；依赖 `context`/`errors`/`shape`。
- **IO 与注入**：网络经 `ctx.client`；无时钟（时间用条目自带）。
- **状态与并发**：评论写是**追加式**（PATCH comment 不覆盖旧评论，平台行为），本层无幂等键——同文重复提交会产生重复评论；`version` 冲突按 409 暴露。
- **错误 / 观测 / 秘密**：`bad-signed-body`；只读面透传 `not-found`（评论读不做 `issue-not-found` 包装——与 `issues.get` 口径不一致，**登记为不一致项**，§八 D7）。
- **测试与证据**：`src/comments.test.ts`（写：署名尾行/形状校验；读：过滤与升序）。**未证**：真机 `history` 分页（当前 `fetchHistory` 不分页，取单实体全量）；评论作者=平台账号而非工号的口径差异（78/端口缺口已记）。
- **规模与迁移**：95 行。

#### F-taiga-fields · `packages/taiga/src/fields.ts`（227 行）

- **处置**：目标-保留。
- **归属**：实现层；80-§6.8 `FlowPlatform.fields`；docs/30 §6 ②⑥ 幂等 provision；docs/51 W-7 值域闸。
- **职责 / 非职责**：`schema()` 反射平台真源（状态集 + 自定义属性集）；`provision()` 按名幂等建档（状态、实体档案状态、自定义属性）。不决定公司该有哪些字段（公司目录声明）、不删档（值只增不删）、不迁移单据。
- **内部结构**：
  - `BASE_SCHEMA`（原生 `state`/`title`/`description`/`assignee` 形状）；`attrTypeToPort`/`portTypeToTaiga`/`canonicalType`；
  - 形状守卫：`isPlainStringRecord`/`isPortTypeRecord`/`isStringArray`/`isStringArrayRecord`/`isTypeFlowsRecord`/`isEntitiesRecord`（`entities` 键必须在 `ENTITY_DESCRIPTORS` 内）；
  - `validateProvisionMap`（**唯一入参闸**，`factory` 共用；subcause `bad-provision-map`）；
  - `fieldSchema`（状态按 id 升序进 `state.values`，属性按 id 升序追加；`attrType` 未知映射为端口类型）；
  - `postOrAbsorbDuplicate(ctx, path, body, existsAfter)`（**TOCTOU 吸收**：只吃 `CONFIG_INVALID/bad-request` 且读回在场；读回不在场则原错再抛）；
  - `provisionFields`：`invalidateMeta` → 项目 id → 状态集 GET-first → 实体档案逐实体 GET-first → 属性 GET-first（同名类型不符 → `attribute-type-mismatch`）→ 末尾 `invalidateMeta`。
- **导出与依赖**：导出 3 项（`validateProvisionMap`/`fieldSchema`/`provisionFields`，`index` 不转出）；依赖 contract 类型、`context`/`errors`/`shape`/`entities`、`fieldmap.PORT_TYPES`。
- **IO 与注入**：网络经 `ctx.client`；无时钟、无随机。
- **状态与并发**：写面无事务；并发两写者同拍判重 miss → 双 POST → 后到者 400 被吸收（读回验证）；**前提是 HTTP 层把 400 归 `bad-request`**。部分成功：中途抛错会留下已建的部分状态/属性（无回滚）。
- **错误 / 观测 / 秘密**：`bad-provision-map`、`attribute-type-mismatch`、`bad-request`（吸收失败时原样抛）。错误文本列平台类型名，不含凭据。
- **测试与证据**：`src/fields.test.ts`（schema 反射、provision 幂等、TOCTOU 400 吸收、多实体、`initialStateFor`）。**未证**：真实并发窗口（fake 只能用钩子模拟）；部分成功后的重跑收敛；属性类型漂移的迁移路径。
- **规模与迁移**：227 行。

#### F-taiga-kb · `packages/taiga/src/kb.ts`（145 行）

- **处置**：目标-保留。
- **归属**：实现层；80-§6.8 `FlowPlatform.kb`；79/78 知识面。
- **职责 / 非职责**：`get`=wiki by_slug；`search`=全量拉取 + 子串匹配；`upsert`=按 slug 幂等写（内容相同零写）。不做版本历史、不做目录树、不做权限。
- **内部结构**：`SNIPPET_WIDTH = 160`、`SNIPPET_CONTEXT = 32`；`WikiPage { slug; content }`；`parseWikiPage`；`pathToSlug`（非空、禁前导/尾随 `/`、禁 `..`、剥 `.md`、`[/.]+`→`-`、折叠重复 `-`）；`kbGet`（404 → `kb-not-found`）；`extractTitle`（首个 `# ` 行，否则 slug）；`clip`/`buildSnippet`（空白折叠、命中上下文、`…` 前后缀）；`kbSearch`（空查询 → `[]`；按 slug 排序；slug 或正文子串不区分大小写）；`kbUpsert`（GET 探测 → 404 则 POST；内容相等短路；否则 PATCH `{content, version}`）。
- **导出与依赖**：导出 3 项；依赖 `errors`/`shape`/`context` 类型。页大小硬编码 `100`（未用 `LIST_PAGE_SIZE`，**登记为一致性小债**）。
- **IO 与注入**：网络经 `ctx.client`；无时钟。
- **状态与并发**：无缓存；`upsert` 是「读-判-写」非事务，并发同 slug 可能双建（后到者 400 未吸收——与 `fields` 不同，**已知不一致**）；`version` 冲突以 409 暴露。
- **错误 / 观测 / 秘密**：`kb-path-invalid`、`kb-not-found`、`bad-kb-body`、`conflict`（透传）。搜索结果是子串匹配，**不是**全文检索，不保证相关度。
- **测试与证据**：`src/kb.test.ts`（get/search/upsert 幂等）。**未证**：slug 折平碰撞（`guide/deploy` 与 `guide-deploy` 同页，§八 D7）；大 wiki 全量拉取成本；并发双建。
- **规模与迁移**：145 行。

#### F-taiga-activity · `packages/taiga/src/activity.ts`（183 行）

- **处置**：目标-保留。
- **归属**：实现层；80-§6.8 `FlowPlatform.activity`；`PLATFORM_ACTIVITY_KINDS`（`change` 词条即本实现贡献）；78-§9.3「建单缺席」。
- **职责 / 非职责**：`since(cursor)` 返回按时间升序的一页活动与下一页游标。不做 webhook、不保证建单事件（Taiga history 不录建单）、不做跨实体去重、不做快照一致性。
- **内部结构**：`DEFAULT_PAGE_SIZE = 100`；`CursorPayload { v:1; ts; id }`、`Boundary`；`UUID_RE`；`toBase64Url`/`fromBase64Url`；`encodeCursor(ts, id)`（canonical `base64url(JSON{v:1,ts,id})`）、`decodeCursor(cursor)`（canonical 或裸 UUID；解析失败 → `bad-cursor`）；`strictlyAfter`（ts 大 或 ts 等且 id 大）、`sortAscending`；`toPlatformActivity`（`id`/`ts`/`issue`/`kind`，`actor` 仅 username 非空）；`collect`（逐实体 `fetchHistory`，过滤 `hidden`/`snapshot`）；`activitySince`（边界 null → 全量；canonical 边界按 `modified_date >= ts` 剪枝；边界条目不可达 → 全量重放；裸 id 边界 → 全量定位后切片）；`pageOf`（超过 `pageSize` 才给 `nextCursor`）。
- **导出与依赖**：模块导出 4 项（`DEFAULT_PAGE_SIZE`/`encodeCursor`/`decodeCursor`/`activitySince`）；`index` 只转出游标三件，`activitySince` 只经 `platform` 消费。依赖 `context`/`comments`/`entities`。
- **IO 与注入**：网络经 `ctx.client`；无时钟（时间全来自条目）；分页大小由 `platform` 传入。
- **状态与并发**：无状态。全量重放的代价 = 实体数 × history 请求数；`paginate` 无快照一致性，平台并发变更时可重/可漏；`MAX_PAGES=1000` 是唯一防线。
- **错误 / 观测 / 秘密**：`bad-cursor`（格式错）；游标是**不透明字符串**，调用方不得解析（本文件头注与 78-§9.1 一致）。`kind` 超出冻结词表即实现缺陷（contract 校验拒收）。
- **测试与证据**：`src/activity.test.ts`（三轮连续、不可达全量重放、剪枝）。**未证**：真实数据量下的全量重放成本；同秒并发写入的边界稳定性（只按 `ts`+`id` 全序，未处理平台时钟回拨）；建单事件缺席的补偿（webhook 面不在本包）。
- **规模与迁移**：183 行。

#### F-taiga-links · `packages/taiga/src/links.ts`（112 行）

- **处置**：目标-保留。
- **归属**：实现层；80-§6.8 `FlowPlatform.links`；78-§9.3；证据 `probe-evidence/taiga-links`（P10–P60，**未复跑**）。
- **职责 / 非职责**：`children(id)` 读派生链/生成链；`link()` 对三型一律显式拒绝。不装懂、不落半吊子链、不提供「建 task 时挂链」（那属 `tasks` 面，本包未实现）。
- **内部结构**：`compareByRef`（ref 数值序）；`UNSUPPORTED_BY_TYPE`（三型逐条实测理由）；`link(ctx,a,b,type)`（`a===b` → `self-link`；未知类型 → `bad-link-type`；其余 → `links-unsupported`）；`requireEntity`（本地重复实现，与 `issues.ts` 同逻辑——**登记重复**，§八 D7）；`children`：`userstory` → `GET /tasks?user_story=<内部id>` 分页 + 客户端兜底过滤 + 升序；`issue` → 全量 `GET /issues` 客户端过滤 `generated_from_issue`。
- **导出与依赖**：导出 2 项；依赖 contract 类型、`context`（type + `EntityRaw`）、`errors`、`entities`、`shape`。
- **IO 与注入**：网络经 `ctx.client`；无时钟。
- **状态与并发**：无缓存；`children(issue)` 是全量扫描。
- **错误 / 观测 / 秘密**：`self-link`、`bad-link-type`、`links-unsupported`、`issue-not-found`。错误消息含实测结论与证据路径，不含凭据。
- **测试与证据**：`src/guards-links.test.ts`（写不支持、派生链读）。**未证**：`children(userstory)` 在超大 task 集下的分页完整性；`children(issue)` 恒空（UI 生成链）在真机上的实际值；task 子单不可经 `issues.get` 读的消费方影响。
- **规模与迁移**：112 行。

#### F-taiga-guards · `packages/taiga/src/guards.ts`（172 行）

- **处置**：目标-保留；读位由包级 `readTaigaRoles` 改为**同时**经 `platform.guards.read` 暴露（保留包级导出兼容 daemon）。
- **归属**：实现层；80-§6.8 `FlowPlatform.guards`；78-§9.3「无状态转换 guard，退化为角色写权限收窄」；`contract` v1.6 `PlatformRole`。
- **职责 / 非职责**：读项目角色×权限；`install` 按规则**只收窄**（剥 `modify_us`/`modify_issue`/`modify_task`）；`uninstall` 全员放开。不实现状态转换矩阵（Taiga 无）、不存基线快照（`uninstall` 不能精确恢复）、不校验平台侧真实拦截效果。
- **内部结构**：`TaigaRoleInfo { id; name; slug; computable; permissions: string[] }`（比 `PlatformRole` 多 `id`/`computable`——投影时丢弃）；`TaigaRolesOptions { baseUrl; project; auth; entity?; fetch? }`；`ENTITY_GATE_PERMS`（三实体 → `modify_us`/`modify_issue`/`modify_task`）；`parseRole`；`readRoles(ctx)`（GET `/roles?project=`，按 id 升序）；`readTaigaRoles(opts)`（独立组 context，`fields=undefined`）；`requireCompanyScope`（`bad-company-slug`/`company-scope-mismatch`）；`validateRules`（非空数组、`from`/`to` 非空、`allowRoles` 字符串数组）；`installGuards`（状态名在场校验 → `allowRoles` 角色名在场 → 对**已有 modify 且不应有**的角色 PATCH 剥权）；`uninstallGuards`（缺 modify 的角色补权）。
- **导出与依赖**：导出 `TaigaRoleInfo`/`TaigaRolesOptions`/`readRoles`/`readTaigaRoles`/`installGuards`/`uninstallGuards`（`readRoles` 不出口）。依赖 contract 类型、`context`（值+类型）、`entities`、`errors`、`http`、`fieldmap`。
- **IO 与注入**：网络经 client；无时钟。
- **状态与并发**：`roles` PATCH **无 version 语义**（平台不回显并发号）→ 读-改-写会丢更新：两写者同拍读同一权限集，后写者覆盖前者。**部分应用**：逐角色 PATCH，中途失败留下部分收窄/部分放开。`install` 只认 `allowRoles` 并集，`allowRoles` 缺省=该边全员可转（不剥权）。
- **错误 / 观测 / 秘密**：`bad-company-slug`、`company-scope-mismatch`、`bad-guard-rules`、`unknown-state`、`unknown-role`。`readTaigaRoles` 是「不组平台实例」的最小访问面，错误与 `context` 同源。
- **测试与证据**：`src/guards-links.test.ts`（读面、收窄、拆闸）。**未证**：收窄后的真实拦截（平台侧生效性）；并发丢更新；拆闸恢复精确性（无基线，78-§9.3 已列损失）。
- **规模与迁移**：172 行；`read` 接线在 `platform.ts` 完成（+投影函数 `toPlatformRole`，可留在本文件）。

#### F-taiga-memberships · `packages/taiga/src/memberships.ts`（213 行）

- **处置**：目标-保留。
- **归属**：实现层；docs/52-§6 人事同步；78-§9.3 人事面；`memberships` 面在 daemon 的唯一消费者是 `engine/hrsync/taiga-face.ts`。
- **职责 / 非职责**：成员全量读、按用户名判重、角色 slug→id 解析、邀请/调角色/移除、邀请令牌公开注册、日志文本抓令牌。不决定「该不该邀请」（归 hr-sync 决策）、不读日志文件（日志读取在 daemon 注入的 `InviteLogSource`）、不保存令牌。
- **内部结构**：`TaigaMembership { id; username; roleName; roleSlug; isActive; fullName?; email? }`；`parseMembership`；`TaigaRoleRef { id; name; slug }`；`ROLES_CACHE = WeakMap<TaigaContext, Map<string, TaigaRoleRef>>`（slug 与显示名双键）；`rolesOf`（空角色集 → `no-roles`）；`roleIdOf`（未命中 → `unknown-role`，fail-closed）；`listMemberships`（`paginate` + `LIST_PAGE_SIZE`）；`findMembershipByUsername`；`inviteMember`（`POST /memberships {project, username, role}`；令牌不在响应内）；`patchMembershipRole`；`removeMembership`（DELETE，204）；`registerWithInviteToken`（**裸 fetch** 打公开端点 `/api/v1/auth/register`，`type:'private'`、`accepted_terms:true`；失败 → `register-rejected`，正文截 200 字符）；`findInviteToken`（纯函数：`/register/<token>` 与 `token=<token>` 两式，取**最后**命中）。
- **导出与依赖**：导出 8 函数 + 2 类型（`roleIdOf`/`listMemberships`/`findMembershipByUsername`/`inviteMember`/`patchMembershipRole`/`removeMembership`/`registerWithInviteToken`/`findInviteToken`）。依赖 `errors`/`shape`/`context`（type）/`http`（type）。
- **IO 与注入**：网络两路——`ctx.client` 与 `registerWithInviteToken` 的**独立 `fetch`**（可注入，缺省全局）。无时钟、无文件。
- **状态与并发**：`ROLES_CACHE` 按 context 生命周期信任；成员集变更（邀请/注册/移除）后**调用方必须** `ctx.invalidateMembers()`（本文件不自作废，避免隐藏副作用）。邀请/注册**非幂等**（重复调用吃平台错，语义收敛由 daemon 判定，`register-rejected` 注释明说「冲突≈已建号」）；重复 `removeMembership` 会吃 404（未吸收）。
- **错误 / 观测 / 秘密**：`no-roles`、`unknown-role`、`register-rejected`（正文截断）；**秘密纪律**：令牌只作为参数流转，不落日志、不进错误消息（`findInviteToken` 返回值调用方负责不外泄）。
- **测试与证据**：`test/memberships.test.ts`（角色解析、成员读/写、公开注册、令牌抓取）。**未证**：真实邀请→日志→抓取→注册的端到端链路（只有 fake 与 docs/32 试点记录）；`findInviteToken` 在无关 token 日志中的误取（取最后命中，§八 D7）；停用成员（`isActive=false`）的席位语义。
- **规模与迁移**：213 行。

### 4.4 字段映射与出厂态（2 件）

#### F-taiga-fieldmap · `packages/taiga/src/fieldmap.ts`（119 行）

- **处置**：目标-保留。
- **归属**：实现层；78-§9.3 字段映射；80-§6.8；`transport` 的 `FieldMapLike` 实现。
- **职责 / 非职责**：业务字段名 ↔ Taiga 自定义属性名；值类型编解码；建单落位序（`typeInbox[type]` > `states[0]`）。不映射 `state`（Taiga 原生 status）、不 provision、不解释值域（枚举值合法性归平台）。
- **内部结构**：`PORT_TYPES = ['string','int','enum','date','text']`；`PortFieldType`；`class TaigaFieldMap`：私有 `fields`/`types`/`states`/`typeInbox`；构造校验（`fields` 必须是对象、平台名非空；`types` ∈ `PORT_TYPES`；`typeInbox` 值非空）；`initialState()`（`states[0]`）；`initialStateFor(type)`；`toPlatform`（未映射 `undefined`）；`requirePlatform`（未映射抛 `unmapped-field`）；`encode`（`int` 必须是整数，其余必须字符串）；`decode`（`int` 且安全整数 → number，否则原串）；`typeOf`（缺省 `string`）。
- **导出与依赖**：导出 `PortFieldType`/`PORT_TYPES`/`TaigaFieldMap`；只依赖 contract 类型 + `errors`。**不 import transport**（BC-T1 的正向：`fieldmap → transport` 合法）。
- **IO 与注入**：零 IO、零状态（实例不可变，除构造）。
- **状态与并发**：不可变；可安全共享。
- **错误 / 观测 / 秘密**：`bad-field-map`、`unmapped-field`、`bad-field-value`。错误文本含业务字段名与平台名，不含凭据。
- **测试与证据**：`src/fields.test.ts`「`TaigaFieldMap.initialStateFor`（解析序·平台侧段）」；`issues.test.ts` 经写面间接。**未证**：`date`/`text`/`enum` 三类在平台侧的实际存储形状差异（`encode` 目前只分 `int` 与其他，`date` 无格式化）。
- **规模与迁移**：119 行。

#### F-taiga-factory · `packages/taiga/src/factory/factory.ts`（333 行）

- **处置**：目标-保留。
- **归属**：实现层；docs/52-§八 onboard 序列；docs/32-§九 S0 定版；78-§9.3。
- **职责 / 非职责**：三步根治出厂态：A1 把项目默认态重指到公司收件态、A2 把流外态单据归化到收件态、A3 退役出厂态（快照先行 + `?moveTo=`）。不做 provision（前置）、不删单、不判断业务状态合法性。
- **内部结构**：`DEFAULT_STATUS_FIELDS`（`userstory→default_us_status`、`task→default_task_status`、`issue→default_issue_status`）；`CURE_ENTITIES = ['userstory','issue','task']`；类型 `DefaultRepoint`/`TicketNormalized`/`StatusRetired`/`RetireSkipped`/`FactoryStatusSnapshot`/`FactoryCureReport`/`RetireOptions`；`declaredStatesFor(ctx,map,entity)`（`entities[entity].states` 优先，绑定实体回退 `map.states`）；`inboxStateFor`（声明集首态）；`statusListOf`（逐次真读，无缓存）；`projectDefaults`（`GET /projects/by_slug` 四字段）；`nameOfStatus`；`validateMap`（复用 `validateProvisionMap`）；`repointProjectDefaults`（GET-first diff，单 PATCH 携全部待改字段）；`normalizeFactoryTickets`（`listIssues({})` 全量 → 流外态 `transition` 到 `initialStateFor(type)`，失败逐条记不中断）；`RetireOptions { now?; persistSnapshot? }`；`retireFactoryStatuses`（三实体状态集 → 快照（`now()` 缺省 `Date.now`）→ `persistSnapshot`（抛错=中止全部删除）→ 逐条 `DELETE /{statuses}/{id}?moveTo=<收件态id>`，失败记 `retireSkipped` 不中断 → `invalidateMeta`）；`cureFactoryStatuses`（A1→A2→A3 合流）。
- **导出与依赖**：导出 5 函数 + 7 类型（`DefaultRepoint`/`TicketNormalized`/`StatusRetired`/`RetireSkipped`/`FactoryStatusSnapshot`/`FactoryCureReport`/`RetireOptions`）；依赖 contract 类型、`issues`（`listIssues`/`transitionIssue`）、`fields.validateProvisionMap`、`entities`、`shape`、`context`（type）。
- **IO 与注入**：网络经 `ctx.client`；**时钟**：`opts.now` 可注入（缺省 `Date.now`，本包唯一取时钟点）；**快照落盘是回调**（`persistSnapshot`），本文件不写盘。
- **状态与并发**：三步顺序即依赖（A1 先夺默认值、A2 清存量、A3 删档且 `moveTo` 与 A2 目标同值）。**无事务**：A1 成功 A2 失败会留下默认态已改、存量未清的中间态；重跑靠 GET-first diff 收敛（幂等=零写，但快照回调每次都取证）。A3 的 DELETE 逐条独立，部分成功可重跑。无锁：并发 onboard 两实例可能互相改默认态/删档。
- **错误 / 观测 / 秘密**：失败面**不抛**（除入参闸与快照回调）：`defaultsSkipped`/`normalizeFailed`/`retireSkipped` 是报告数组，逐条带 reason。这是「部分成功必须明报」的落地。错误文本可含状态名/实体名，不含凭据。
- **测试与证据**：`src/factory/factory.test.ts`（A1/A2/A3、三步合流两跑幂等、实体档案、入参防御）、`src/onboard.test.ts`（合流两跑同结果）。**未证**：真实平台 `moveTo` 对被引用单据的迁移行为（fake 建模）；并发 onboard；快照落盘失败后的运维路径（只有「中止」语义）。
- **规模与迁移**：333 行；`fake-faces.ts` 迁出后 `factory/` 只剩本件与测试。

### 4.5 横切契约：绑定档案、未知状态观察与导出（**非文件件**，不计入 18）

〔口径〕本节不是一件文件，而是 §4.1 `context`、§4.2 `binding`、§4.3 `issues`/`activity`/`guards` 五处共同遵守的横向口径。单独成节的理由：同一事实写进五件必然漂移。**形状**归 80-§6.6，**事实**归 78-§9.3/§9.5/§9.6，本节只写「Taiga 怎么落」。

#### 4.5.1 平台状态 → `STAT-D`：唯一映射点在本包 `binding.mapState`（宿主转调）

〔事实〕`FlowPlatform` 全轴只说**平台状态名**——`IssueRecord.state: string`（`contract/src/ports/platform.ts:16`）、`IssueQuery.stateIn`（`:28`）、`IssueCreate.initialState`（`:52`）、`transition(id, toState: string)`（`:184`）。taiga 侧同轴：`statusNameById`/`statusIdByName`（`transport/context.ts:207-229`）；`fieldmap` 只管自定义维、**不含状态映射**（`fieldmap.ts:4-6` 头注明说「state 是原生 status 字段，不需要映射」）。故「平台状态 → `STAT-D`」在现有代码里**零实现**；目标唯一实现点是本包 `src/binding.ts` 的纯函数（`PlatformBindingPort.mapState` 由 daemon 宿主 `assembly/platform/binding.ts` 转调，不另写第二份映射）。

〔原则〕（78-§9.5 + 80-§6.6）只许映到 `STAT-D` 十值；禁 `STAT-E`/`STAT-H`；多对一必须列全；不给默认；`platformState` 原样上报，不得先归一化再映射。

| 输入 | `mapState` 返回 | 谁落 `REC-OBS-02` | 禁止 |
|---|---|---|---|
| 命中所声明的 `stateMappings[].platformState` | `Ok({platformState, workStates:[...], verification:'verified', unmappedBehavior:'observe-unmapped'})` | 不落 | 一值跨族；把平台「待验收」读成「已接受」（78-§9.5） |
| 非空、合法、但**未声明** | `Ok({platformState, workStates:[], verification:'unverified', unmappedBehavior:'observe-unmapped'})` | **daemon**（`ObservationProjector`/监控面） | 回 `Err(unsupported)`；回落默认态；按名字模糊猜（前缀/包含/大小写折叠）；把空数组读成 `accepted`/`settled` |
| 空串、非字符串、畸形 | `Err({failure:'rejected_precondition', category:'CONFIG_INVALID', subcause:'empty-platform-state'})` | 调用方 | 先归一化再判；把「没给值」当成「未映射」 |

- **硬口径（本表不可协商）**：未映射**但合法**的来源值**只能**返回 `Ok({platformState, workStates:[], verification:'unverified', unmappedBehavior:'observe-unmapped'})`，原值保留；`Err` **只**留给空串/非字符串/畸形三类输入。把合法未知值转成 `Err(unsupported)`（或任何 `Err`）**一律判缺陷**——后果是平台正常新增一个状态就整单读成错误，且本该落的 `REC-OBS-02` 观察缺口被抹掉。`workStates:[]` 亦不得被迁移/验收/结清任一方当作输入。

- `unmappedBehavior` 只有 `'observe-unmapped'` 一个合法值：`workStates=[]` 时**不得**生成状态迁移、**不得**判验收通过、**不得**判结清（80-§6.6 结论）；消费方读到空数组必须停在原地，也不得用平台 `closed` 反推。
- **taiga 不写台账**：本包除平台 HTTP 外零写入；`mapState` 更是**同步纯函数**（零 IO、零时钟、零随机），**不写 `REC-OBS-02`、不写任何 `REC-*`、不取观察位**。落 `REC-OBS-02` 的是**消费方**：宿主 `assembly/platform/binding.ts` 把 `verification:'unverified'` 交 `TS-PORT-OBS-01`（`engine/observe/`）/daemon 的 `ObservationProjector`。适配器自己写库，等于给同一事实域开第二个写入者。
- **双层未知**（Taiga 特有，§八 D11）：状态名先要取得到——`statusNameById`（`context.ts:219`）对**不在状态集内的 status id** 直接抛 `CONFIG_INVALID/issue-missing-state`，`toIssueRecord`（`issues.ts:43`）不捕获 → 整单读失败。故「未知状态」有两层：
  1. **名字可取、映射未声明** → 上表第二行（`Ok(unverified)`）；
  2. **名字取不到**（平台侧删/改状态集）→ 读面硬错，`mapState` 根本收不到输入。

  第二层**不得**造占位名绕过（那是伪造）；正确处理是归为**观察缺口**（`REC-OBS-02`），不是工作失败。现状归类 `CONFIG_INVALID`（＝「调用方输入错」）把平台漂移报成调用方错误——这是分类缺陷（D11）。**目标分类**：`issue-missing-state` = `failure:'conflict'`（平台真源与绑定声明两源不一致，须先裁决）+ `category:'EXTERNAL_REJECT'` + 稳定 subcause，**不重试、不当成功**；同时由 daemon 落 `REC-OBS-02` 记录漂移。该改动会动 `context.test.ts`/`issues.test.ts` 的断言，须单独提交（§七）。
- **错误转换**（绑定层的边界责任，**纯字段搬运**）：`TaigaPlatformError` **目标**携带 `{failure,category,subcause,detail?}`（§4.1 `errors.ts`，M2a 同批落），`toClassifiedError()` 只复制四字段，**不查表、不按消息猜**。现状只有 `category`+`subcause`；在 `failure` 落地前，绑定层**不得**先按 `category` 编一张「临时候选表」冒充 `failure`——那是第二套词表。故 `errors.ts` 补 `failure` 是绑定件的**硬前置**（M2a 第 2 步），不是可选改进。
- **未知回执（写）与未知状态（读）是两条线**：78-§9.6 要求「写请求超时 → `REC-EVT-03`（外部未知）+ `owner`/`review_by`，**禁自动重试**」。本包**无超时、无取消**（`http.ts` 只有 `fetch` 与分页上限，§八 D6-3），故写路径**产生不了「超时」这一事实**——挂住的请求既不成功也不报错，调用方拿不到可分类的未知。顺序依赖要写明：**超时是 `REC-EVT-03` 的前提**，须先由提案流给 `http.ts` 加超时/取消（不在本附录修）；在此之前，「未知回执」只能靠人肉发现，不能靠适配器上报。平台不可达（`candidateState=unavailable`）同理归 daemon 的端点登记，不归本包。

#### 4.5.2 宿主 `describe()` 的数据源：`BindingProfile` 20 字段的 Taiga 侧来源（本件只产内容，不产方法）

| # | 字段 | Taiga 侧来源 | 现状 |
|---|---|---|---|
| 1 | `bindingId` | `BIND-PLAT-TAIGA-01` | 已有（78-§9.3） |
| 2 | `version` | `1.0` | 已有 |
| 3 | `semanticDigest` | 档案正文按 `studio-next/jcs@1` 规范化后的摘要：**用 `contract` 的规范化器**（80-§4.5，落点见 `81-files/01-contract.md`），或由构造期注入的 `digestOf` 计算 | 目标；**本件不手写 jcs**——自己实现一份规范化等于给同一身份造第二套算法，跨实现比对即失效（78 `L78-CORE-02`）；两者都不可用 ⇒ `Err('digest-unavailable')` |
| 4 | `title` | 「Taiga 项目绑定」＋项目 slug | 目标 |
| 5 | `ownerPositionRef` | 具名位置引用，由部署方注入；**无主不得引用**（80-§6.6 前置） | 目标；taiga 不自造 |
| 6 | `scope` | `companies:[projectSlug]`、`platforms:[{kind:'taiga',host:baseUrl,version:'1.0'}]`；`deploymentRefs`/`hosts`/`stores` 由部署方给 | 部分（选项已有 `baseUrl`/`project`） |
| 7 | `coreClauses` | 78-§9.1 六条共同禁令 + §9.3「只收窄不放宽」「公司作用域=项目」，逐条要 `clauseRef` | 目标；78 未给 clauseRef |
| 8 | `coveredObjects` | `issues`/`comments`/`fields`/`kb`(wiki)/`activity`(history)/`links`(children)/`guards`(角色写权限收窄) | 可从 §二/§四 导出 |
| 9 | `uncoveredObjects` | attachments、epic↔US 挂接、横向关联、`generated_from` 写、task 实体读、`parent` 写、成员与权限变更、webhook 注册（需 env） | 同上（`links.ts` 头注 + 78-§9.3） |
| 10 | `fieldMappings` | `FieldProvisionMap.fields/types` 投影 + 每项的 `lossRefs`（逐项指到已存在的 `REC-LOSS-01`） | 部分；`lossRefs` 需调用方注入（D2） |
| 11 | `stateMappings` | **只用 80-§6.6 的 `StateMapping` 字段名**：每项 `platformState`=平台状态名、`workStates`⊆`STAT-D`（76-§7.7 十态，多对一列全）、`verification:'verified'`、`unmappedBehavior:'observe-unmapped'`、`note?`。**`WorkState` 在 01-contract 里是不透明字符串别名**（G-22：十态只有中文名，80 未给英文值）——本附录因此只写 76 的中文名，**不造 `in_progress` 之类字面量**；80 给出字面量后整表替换，不改结构。78-§9.5 骨架里的「`theirs`/`ours`」只是语义别名，**不另立字段** | **零**（§4.5.1） |
| 12 | `provisioning` | `fields.provision` + `factory` 三步出厂态；`pinnedVersion` 必须是 Taiga 镜像 tag | 部分；`pinnedVersion` 无出处 → 缺则**不得**宣称可供给 |
| 13 | `authorization` | 激活/权威引用来自 daemon `REC-AUTH-*`；taiga 只声明「需要哪个引用」 | 目标；taiga 不持权威 |
| 14 | `effective` | 状态 + 起止 + `reviewBy`，由部署方给 | 目标 |
| 15 | `evidence` | `sinks`=history/台账；`eventKinds`=`PLATFORM_ACTIVITY_KINDS` 六词（created/commented/transitioned/field-set/change/unknown）；`retention`/`redaction` 由部署方给 | 部分 |
| 16 | `losses` | `REC-LOSS-01` 的 `Qid[]`（**类型就是 `Qid[]`**：每项是一条 `REC-LOSS-01` 记录的记录标识，**不是** `string[]`、不是 `RecordRef[]`、不是损失描述文本，也不与别的引用类型互换），由调用方（daemon/绑定注册流程）注入 `lossRefs`。Taiga 的损失事实仍是 78-§9.3 三条 + 本附录补的五条（无围栏原语 §4.5.4 ④、未知状态第二层不可判 §4.5.1、导出束非本件可组装 §4.5.3、`issue-missing-state` 分类缺陷 §4.5.1、`proof.signature` 无署名归属 §4.5.3/D10） | **引用可给、记录须有**：本件不写 `REC-LOSS-01`、不造 Qid；`lossRefs` 为空或缺失 ⇒ 拒建/`Err('loss-refs-missing')`——空数组等于宣称「无损失」，是假声明 |
| 17 | `exportMigrationExit` | 4.5.3 / 4.5.4 | 部分 |
| 18 | `probes` | 78-§13 探针矩阵的 Taiga 行；未跑只能写 `not-executed`（`docs/32` 试点**不是**本附录探针） | 目标 |
| 19 | `factStatus` | `'已有'`（`daemon/src/assembly/platform/wire.ts:139` 已调 `createTaigaPlatform`；`guards.read`/`binding`/基线快照仍缺） | 可填，须与第 9 行一致 |
| 20 | `supersedes`/`supersededBy` | 无（首版） | — |

〔口径〕`factStatus='已有'` 与 `uncoveredObjects` 非空**不矛盾**：前者说「能力端口已接线」，后者说「档案声明覆盖不到哪些对象」。两者必须同时出现，否则是自述漂移（同类缺陷见 D8）。

#### 4.5.3 `exportBundle`：本包**不组装导出束**，只给 scope 拒绝面与 `exportShape` 声明（方法在宿主）

〔裁决〕`ExportBundle` 的八栏里有四栏只能由**台账与签名方**产出（`receipts`=`REC-RCP-01`、`openObligations`=未决义务、`losses`=`REC-LOSS-01` 的 Qid、`proof.signature`=daemon/gateway 签名），本包既无台账读口也无密钥，**永远凑不齐**。故本包只出两件纯件（`judgeTaigaExport` 判 scope——**内部件，不从包根导出**；`exportShape` 声明随档案暴露），`PlatformBindingPort.exportBundle` 的返回由宿主 `assembly/platform/binding.ts` 固定为拒绝：

1. **先判 scope 是否在本绑定范围内**（下表六要素）——越界即拒；
2. 范围内且确需导出 ⇒ `Err({failure:'unsupported', category:'EVOLVE_REJECT', subcause:'export-assembly-outside-binding'})`，把导出执行交 daemon 侧的导出/迁移执行体（`TS-PORT-LIFE-02 HandoverArchivePort` / `TS-PORT-MIG-01`；80-§6.6）；
3. 只把 **`exportMigrationExit.exportShape`** 作为**声明**放进档案（导出必须装什么、哪些 `includes*` 恒为 `false`），供执行体遵守。

**scope 六要素的 Taiga 落法（拒绝面；先于第 2 步）**：

| `ExportScope` 字段 | Taiga 侧做法 | 拒绝面 |
|---|---|---|
| `company` | `=== ctx.projectSlug`（Taiga 公司=项目，同 `guards.requireCompanyScope`） | 不等 → `rejected_forbidden` |
| `factDomains` | 可声明支持 `issues`（含自定义维）、`comments`、`kb`、`activity`、`children-links` | 不支持的域**整包拒**（`unsupported`），不静默少装 |
| `timeRange` | 单据按 `EntityRaw.createdDate`（`context.ts:71`）、评论/活动按 history `created_at`；`IssueRecord` 只暴露 `updated`，按创建时间过滤必须在 raw 层做 | 窗口外记录不得混入；ISO 字符串按字典序比较 |
| `cursor` | 不透明游标**透传**给执行体；本件不翻页、不判 `MAX_PAGES` | 本件不得解释游标 |
| `knowledgeScope` | **无法证明包含关系**：Taiga 可见性单位=项目成员+角色，无逐记录知悉范围；`KnowledgeScope` 在 80 只有名字、无 TS 形状（D12） | 不能证明在范围内 → `rejected_forbidden`（fail-closed），不得「先导再说」 |
| `memories` | Taiga 无记忆存储：`include` 非空即 `unsupported`；`excludeSecrets` 恒 `true`（本包无秘密可导） | 不得回空数组冒充「没有」 |

**八栏的归属（执行体义务；本件只声明，不产出）**：

| 栏 | 产出者 | Taiga 侧声明 |
|---|---|---|
| `manifest.bundleId` | 执行体 | 产物 id（**非 qid**）；由 `(scopeDigest, timeRange)` 派生稳定串 |
| `manifest.scopeDigest` / `recordCount` / `createdAt` | 执行体 | 摘要用 `contract` 规范化器；`createdAt` 取**执行体**时钟（本包不取时钟） |
| `manifest.shape`（`formats` ＋ 7 个 `includes*`） | 执行体（本件给模板） | **如实**：`includesIdentity`/`includesAuthorityBasis`/`includesDualTime`/`includesCorrectionChain`/`includesOpenObligations` 恒 `false`；`includesVersion`/`includesProvenance` 为 `true`。全 true 是撒谎 |
| `records` | 执行体 | `RecordEnvelope<unknown>[]`，内容为各面读回形状；**opaque**：不得被任何端口当决策输入（80-§6.6 结论） |
| `provenance` | 执行体 | 来源=平台 + `baseUrl` + 实例版本 + 读取窗口 + 每页游标 |
| `losses` | 执行体（台账） | 只能引用**已存在**的 `REC-LOSS-01` Qid；本件只提供 `lossRefs` 的声明侧 |
| `receipts` / `openObligations` | 台账/组合层 | **空数组 ≠ 无**：`openObligations: []` 是「没有未决义务」的断言，不是「不知道」；不知道就不许出包 |
| `proof.signature` | daemon/gateway（密钥不出 daemon） | 本件只给 `semanticDigest`；署名归属未定（D10） |

〔结论〕宿主的 `exportBundle` 只有**三种**合法返回：`rejected_forbidden`（超知悉范围）、`unsupported`（域/记忆不支持）、`unsupported`+`export-assembly-outside-binding`（在范围内但须执行体组装）；本包只提供前两种的判定（内部件 `judgeTaigaExport`，不导出）与第三种的理由常量。**不得**返回空包、半包或 `notImplemented` 抛 `CONFIG_INVALID`（后者与 77-§11.1 的 `unsupported` 不是一类）；`unsupported` 的 `category` 一律 `EVOLVE_REJECT`（80-§5.7）。

#### 4.5.4 `exitPlan`：九槽里哪些是声明、哪些是运行时事实（声明在本包，组装在宿主）

〔口径〕九槽**分两类**，混淆两者就是伪造的来源：

- **声明槽**（本包静态可给）：⑧ 的 `mode:'read-only'`/`deleted:false`、「本平台无侧围栏」这一判断本身、⑦ 的动作清单、⑤ 的窗口来源、⑨ 必须列哪几项。
- **运行时事实槽**（只有执行时才存在值）：`freezeWriter.frozenAt`、`exportVerification.bundleId/verifiedBy/verifiedAt`、`acceptance.acceptedBy/acceptedAt`、`fence.fenceToken/until`、`activation.activatedAt`、`exit.completedAt`。本包**不取时钟、不持密钥、不认人**（§4.2 非职责），这些值只能由 daemon 侧以 `exitFacts` 注入，由宿主组装成 `ExitPlan`；缺一项 ⇒ `Err('exit-plan-facts-missing')`（本包 `requireExitFacts` 判，宿主不多判一遍），**不得**用 `0`/`now()`/空串/`'unknown'` 占位。

| 槽 | Taiga 事实 | 类别 |
|---|---|---|
| ① `freezeWriter` | 冻结＝停 `transition`/`setField`/`kb.upsert`/`guards.install`；**平台无围栏原语**，只能靠停写 + ④⑦ | 声明（动作清单）+ 事实（`frozenAt` 由 `exitFacts` 给） |
| ② `exportVerification` | 导出须覆盖：单据全量（含已关闭）、wiki、history（评论+流转）、children(task) 派生链；核验人须是具名主体 | 事实（三值全由 `exitFacts`） |
| ③ `acceptance` | 接收确认在新平台侧完成；**无确认不得宣称退出**（80 判 `rejected_precondition`） | 事实 |
| ④ `fence` | **没有围栏令牌**：无单写者租约、无版本围栏；只能靠凭据回收（⑦）+ 停写。此槽在 Taiga 上只能声明为「无平台侧围栏」，不得伪造 `fenceToken` | **声明**（「无围栏」是事实判断，但不是可以填出来的一格） |
| ⑤ `lateReconciliation` | 迟到副作用＝webhook 延迟投递（试点捕获 102 条）+ history 轮询窗口；窗口由部署方给 | 声明（窗口来源）+ 事实（实际对账进度） |
| ⑥ `activation` | 新绑定 id + `REC-AUTH-*` 激活引用；taiga 不持权威 | 声明（引用要求）+ 事实（`activatedAt`） |
| ⑦ `withdrawal` | 凭据撤回=`TAIGA_TOKEN` 轮换/吊销 + 适配器实例停用；**拆闸另需重建角色权限**（`guards` 无基线快照） | 声明（动作清单） |
| ⑧ `archive` | 旧项目**只读不删**（`mode:'read-only'`、`deleted:false`）；落地动作＝收回写凭据 + 项目成员降只读 | 声明（常量值） |
| ⑨ `exit` | `unresolved` 必须列：webhook 未对账条目、无基线快照的拆闸、task 实体不可经本适配器读 | 声明（必列项）+ 事实（`completedAt`） |

〔类型缺口〕80-§6.6 的 `ExitPlan` 只有**一种**形状——`fence.fenceToken` 等事实槽是必填，`ExitPlan` 里没有「本平台不做围栏」的表达位。故 ④ 在 TS 上**无法如实表达**：填 `fenceToken` 就是伪造，不填就过不了类型。本附录不私拆类型（不造 `TaigaExitPlan`、不给 `fenceToken` 加 `undefined`），只登记回写建议：80 把 `ExitPlan` 拆成「声明形状 + 执行形状」，或把事实槽改为 optional 并用 `unresolved` 记「无围栏」（§8.1 D13）。**D13 未回写前宿主 `exitPlan` 停**：类型要求 `fence.fenceToken`，Taiga 没有真值，唯一能过类型的写法就是造假——所以 M2c 的端口装配整体等 D13，不拆「先落一半」。可先落的是**声明面与事实校验**（本包 `taigaExitDeclaration`/`requireExitFacts`、`exitFacts` 的形状与校验、`exitShape` 声明文档），它们不含 `fenceToken`。

〔结论〕Taiga 的退出短板集中在 ④ 与 ⑦：无围栏令牌、无角色基线快照。故 `exitPlan` 只能如实声明，不能承诺精确回退；`exit.unresolved` 不得填空数组冒充「已清零」。**读一个 `ExitPlan` ≠ 退出完成**——执行须走 `TS-PORT-WORK-05 WorkLifecycle`（状态迁移）/`TS-PORT-WORK-07 SettlementPort`（结清）/`TS-PORT-LIFE-02 HandoverArchivePort`（交接档案）并落记录（80-§6.6 后置）。

---

## 五、测试基建与测试件

〔口径〕R/E/W/V 证据分层、用例编号与真机取证归 82；本附录只区分「套内 `vitest`（回归证据）」与「套外 smoke（非证据）」，并逐件列未证项。测试绿只证明当前项目回归，不证明真机、跨实现或平台侧生效（81-§四）。

### 5.1 测试基建（7 件：`testutil` facade + `testkit/` 6 件）

这一族的共同约束：

- **仅测试**（81-§四标签）：不得进入生产装配、不得被 `src/index.ts` 再导出、不得被 `transport`/业务件 import。
- **`fakes` 只许 demo/test**（80-§10.6）：`FakeTaiga`/`testkit/*` 的真实消费者只有两类——套内测试与**显式 demo** 装配；`apps/daemon/src/assembly/platform/wire.ts` 等真实装配路径**不得**把 fake 当回落（「taiga 没配好就用 fake」是伪造可用性）。当前无机械 guard 拦这类 import（只靠 review），且 `src/testkit/README` 未产；与上一条合并登记为 §八 D3。
- **零真实网络**：`FakeTaiga.fetch` 是 `FetchLike` 实现，全部请求在内存里路由；套内测试无端口、无 Docker、无临时目录依赖（不读写任何本机路径）。
- **零 LLM**：不做自然语言裁判。
- **保留在 `src/` 的代价与理由**：`src/**` 在根 program 与包级 program 内，故测试基建仍受类型门禁（这是优点）；代价是「测试面混在生产目录」。替代方案（移到 `test/`）会让它**退出**类型门禁（79-D10），所以本设计选择留在 `src/testkit/`。无机械 guard 阻止生产误引 testkit——登记为缺口（§八 D3）。

#### F-taiga-testkit-world · `packages/taiga/src/testkit/fake-world.ts`（**目标-新增**，预估约 280 行）

- **处置**：目标-新增（`src/testutil.ts` 的状态/种子/序列化段拆出）。
- **归属**：仅测试；服务 `80-§6.8` 七能力的 fake 回放。
- **职责 / 非职责**：持有「一个假 Taiga 项目」的全部可变状态与确定性序列（时钟、uuid、ref、id、token、状态/属性/wiki/task/issue 序号），提供种子方法与 JSON 序列化。不路由 HTTP（`fake-routes`）、不管认证（`fake-taiga`）、不实现出厂态路由（`fake-factory`）。
- **内部结构**：
  - 类型：`FakeEntity`、`FakeHistoryEntry`、`FakeWikiPage`、`FakeTask`、`FakeIssue`、`CallLog { method; path; query; body? }`、`FakeMembership`（新增，memberships 面需要）；
  - 常量：`TICK_BASE = Date.parse('2026-10-18T00:00:00.000Z')`、`USERNAME = 'svc-agent'`、`PASSWORD = 'fake-password'`；
  - `class FakeWorld`：公开状态数组 `calls`/`unmatched`/`members`/`statuses`/`issueStatuses`/`taskStatuses`/`attributes`/`roles`/`memberships`/`entities`/`history`/`wiki`/`tasks`/`issues`/`projectDefaults`；私有序列；`nextTick()`、`seedEntity`、`pushHistory`、`findEntity`、`seedTask`、`seedIssue`、`seedWikiPage`、`countHistoryFetches`、`countWriteCalls(filter?)`、`pageEntities`、`entityJson`、`historyJson`、`wikiJson`、`taskJson`、`issueJson`、`membershipJson`。
  - 模块级工具：`respond(status, body, headers?)`（构造 `Response`，带 JSON 头）、`hexPad`、`uuidOf`。
- **导出与依赖**：导出上述类型 + `FakeWorld` + 常量 + `respond`（`fake-routes`/`fake-taiga`/`fake-factory` 共用）。依赖：零（只用全局 `Response`/`Date`）。
- **IO 与注入**：零 IO、零真实时钟（`TICK_BASE` 起算）、零随机（uuid 由 tick+seq 派生）。
- **状态与并发**：纯内存、单线程假设（vitest 每用例新建实例）；无锁。
- **错误 / 观测**：不抛业务错；`unmatched` 记录未命中路由（测试可断言为空）。
- **测试与证据**：被 10 个 `src` 测试间接覆盖；无独立测试（基础设施自证靠使用即覆盖）。**未证**：与本文件无关的平台行为。
- **规模与迁移**：约 280 行；从 `testutil.ts` 机械搬移，**行为零变更**。

#### F-taiga-testkit-routes · `packages/taiga/src/testkit/fake-routes.ts`（**目标-新增**，预估约 300 行）

- **处置**：目标-新增（`FakeTaiga.route` 的业务路由段拆出）。
- **归属**：仅测试。
- **职责 / 非职责**：按 `(method, path, query, body)` 分发到项目/状态集/属性集/实体 CRUD/history/wiki/tasks/issues/roles/memberships/自定义属性值等假响应。**不做**认证路由（`fake-taiga`）、不做出厂态根治路由（`fake-factory`）。
- **内部结构**：导出 `routeWorld(world, method, path, query, body): Response | undefined`（`undefined`=未命中，交上层继续）；内部按端点分段的私有处理函数（项目 by_slug、`/{entity}` 列表与 CRUD、`by_ref`、`custom-attributes-values`、`history`、`wiki`、`tasks`、`issues`、`roles`、`memberships`、`auth/register`）；分页走 `world.pageEntities`，头部写 `x-pagination-count`。
- **导出与依赖**：导出 1 个函数（推荐）或按域拆的少量函数；依赖 `fake-world.ts`（值 + 类型）。
- **IO 与注入**：零 IO。
- **状态与并发**：只读写传入的 `world`；无模块级状态。
- **错误 / 观测**：形状错误时返回 400（与平台一致），不抛；`undefined` 表示「不归我管」而不是 404。
- **测试与证据**：经套内测试间接覆盖。**未证**：真实平台的错误体形状（fake 是简化建模）。
- **规模与迁移**：约 300 行；搬移期**逐端点对照**，不得顺手改状态码。

#### F-taiga-testkit-fake · `packages/taiga/src/testkit/fake-taiga.ts`（**目标-新增**，预估约 110 行）

- **处置**：目标-新增（`FakeTaiga` 类壳 + 认证 + fetch 拆出）。
- **归属**：仅测试。
- **职责 / 非职责**：组合 `FakeWorld`，实现 `FetchLike`：解析 URL、记录调用、校验 Bearer、处理 `POST /auth` 与 `/auth/refresh`（发新 token、旧 token 作废）、把其余请求交给 `routeWorld` 与 `factoryCureRoute`，未命中则 404 并记 `unmatched`。不做业务状态建模（在 world/routes）。
- **内部结构**：`class FakeTaiga`：`readonly world` 或**转发公开字段**（保持现有 10 个 `src` 测试的 `fake.entities`/`fake.statuses`/`fake.seedEntity` 等调用面不变）；`fetch: FetchLike`；`expireToken()`；`currentToken`/`validRefresh`/`tokenSeq`；`lastBearer`。
- **导出与依赖**：导出 `FakeTaiga`；依赖 `fake-world`、`fake-routes`、`fake-factory`。
- **IO 与注入**：零真实网络。
- **状态与并发**：token 状态单实例；`expireToken` 模拟过期（401 → 适配器刷新/重登）。
- **错误 / 观测**：401/404 走响应而非抛错；调用日志是唯一观测面。
- **测试与证据**：全部套内测试。**未证**：无。
- **规模与迁移**：约 110 行；**兼容面**：现有测试 import `FakeTaiga` 与其公开成员，拆分后名字与成员名不得变。

#### F-taiga-testkit-factory · `packages/taiga/src/testkit/fake-factory.ts`（**目标-新增**，由 `src/factory/fake-faces.ts` 88 行迁入）

- **处置**：目标-新增（迁移）；旧 `src/factory/fake-faces.ts` **目标-退役**。
- **归属**：仅测试；docs/32-§九 S0 语义的 fake 建模。
- **职责 / 非职责**：三条出厂态路由：`PATCH /projects/{id}`（写 `default_*_status`）、`DELETE /{entity}-statuses/{id}?moveTo=`（`moveTo` 必填、引用单据迁移、默认值改指、204）、`POST /userstories` 不带 `status` 落项目默认态；`projectDefaultsEcho` 供 `by_slug` 复用。不模拟平台其它校验。
- **内部结构**：`factoryCureRoute(world, method, path, body, query, respond): Response | undefined`；`projectDefaultsEcho(world): Record<string, number | null>`；内部迁移辅助（task/issue 桩实体无状态承载单）。
- **导出与依赖**：导出 2 项；依赖 `fake-world`（值 + 类型）、`respond`。
- **IO 与注入**：零 IO。
- **状态与并发**：只改 `world`。
- **错误 / 观测**：缺 `moveTo` → 400；未知 id → 404。
- **测试与证据**：`src/factory/factory.test.ts`、`src/onboard.test.ts`。**未证**：真实平台 `MoveOnDestroyMixin` 的边界（大引用集、默认值联动）。
- **规模与迁移**：88 行，机械迁移，行为零变更。

#### F-taiga-testkit-platform · `packages/taiga/src/testkit/platform-fixture.ts`（**目标-新增**，由 `src/platform-fixture.ts` 57 行迁入）

- **处置**：目标-新增（迁移）；旧 `src/platform-fixture.ts` **目标-退役**。
- **归属**：仅测试。
- **职责 / 非职责**：测试常量（`TEST_BASE_URL='http://taiga.test'`、`TEST_PASSWORD_AUTH`、`TEST_FIELDS` 四维映射）、`makePlatform(fake, opts?)`（`FakeTaiga` → `FlowPlatform`）、`expectTaigaReject(fn, category, subcause)`。不发明业务断言。
- **内部结构**：三个 `export const`；`makePlatform`（默认 `pageSize` 小值以覆盖翻页）；`expectTaigaReject`（`await expect(...).rejects` + `instanceof TaigaPlatformError` + 两级匹配）。
- **导出与依赖**：导出 5 项；依赖 `vitest`（`expect`）、contract 类型、`../index.ts`（`createTaigaPlatform`/`TaigaPlatformError`）、`./fake-taiga.ts`。
- **IO 与注入**：零 IO。
- **状态与并发**：无状态。
- **错误 / 观测**：断言失败信息带 category/subcause，便于定位。
- **测试与证据**：被 10 个 `src` 测试 import（2 个直接 import 常量、8 个经 `testutil` facade）。**未证**：无。
- **规模与迁移**：57 行；迁移后 import 路径改为 `./fake-taiga.ts`。

#### F-taiga-testkit-index · `packages/taiga/src/testkit/index.ts`（**目标-新增**，预估约 12 行）

- **处置**：目标-新增（barrel）。
- **归属**：仅测试。
- **职责 / 非职责**：把 5 个 testkit 件的公开符号再导出，供 `src/testutil.ts` facade 与（可选）测试直接 import。不做逻辑。
- **内部结构**：`export * from './fake-world.ts'` / `./fake-routes.ts`（若只导出函数则具名）/ `./fake-taiga.ts` / `./fake-factory.ts` / `./platform-fixture.ts`。**不得** `export * from '../index.ts'`（避免测试面污染包根）。
- **导出与依赖**：见上。
- **IO 与注入**：零。
- **状态与并发**：无。
- **错误 / 观测**：无。
- **测试与证据**：被 `testutil` facade 使用。
- **规模与迁移**：约 12 行。

#### F-taiga-testutil · `packages/taiga/src/testutil.ts`（693 行 → facade 约 20 行）

- **处置**：**目标-拆分**（body 拆入 `testkit/`，本文件保留纯再导出 facade）。保留原因是 10 个 `src` 测试与 2 个夹具仍 `import ... from './testutil.ts'`，facade 让拆分对测试零改动（M0 可独立回退）。
- **归属**：仅测试。
- **职责 / 非职责**：只做再导出；**不再持有**任何状态、路由或断言实现。
- **内部结构**：`export * from './testkit/index.ts'`（或逐符号具名再导出，以防 barrel 漂移）。
- **导出与依赖**：与原 `testutil.ts` 同名同形（`FakeTaiga`、`FakeEntity`、`TEST_BASE_URL`、`makePlatform`、`expectTaigaReject`…）；`vitest` 的 `expect` 只出现在 `testkit/platform-fixture.ts`，测试基建其余件不 import 测试框架。
- **IO 与注入**：零。
- **状态与并发**：无。
- **错误 / 观测**：无。
- **测试与证据**：本身无测试；10 个 `src` 测试的 import 即回归面。
- **规模与迁移**：约 20 行。基线 `lineBaseline[testutil]=723`（实测 693）在拆分后可删，删除须走门禁表批示（§八 D9）。M4 可选：测试改为直接 import `./testkit/index.ts` 后，facade 退役。

#### F-taiga-platform-fixture（退役）· `packages/taiga/src/platform-fixture.ts`（57 行）

- **处置**：**目标-退役**（内容迁入 `testkit/platform-fixture.ts`）。
- **调用方清单（全部，2026-10-27）**：直接 import 两处——`src/fields.test.ts:11`、`src/context.test.ts:13`（均取 `TEST_BASE_URL`/`TEST_PASSWORD_AUTH`）；间接经 `src/testutil.ts:693` 再导出——`src/activity.test.ts`、`src/comments.test.ts`、`src/guards-links.test.ts`、`src/issues.test.ts`、`src/kb.test.ts`、`src/onboard.test.ts`、`src/factory/factory.test.ts`、`src/transport/http.test.ts`。仓内无生产消费者。
- **替代路径**：`src/testkit/platform-fixture.ts`（同名同形导出）。
- **兼容期**：M0 建立 testkit 与 facade，两处直接 import 在 M1 改线；期间旧文件仍在但不再被 testkit 引用。
- **删除条件**：`grep -rn "platform-fixture" packages/taiga/src` 只剩 `testkit/` 内部；`vitest` 全绿；`bun run typecheck` 绿。
- **历史/数据处置**：无（纯测试常量与断言函数，无持久状态）。

#### F-taiga-fake-faces（退役）· `packages/taiga/src/factory/fake-faces.ts`（88 行）

- **处置**：**目标-退役**（内容迁入 `testkit/fake-factory.ts`）。
- **调用方清单（全部）**：唯一直接调用方 `src/testutil.ts:17`（`factoryCureRoute`、`projectDefaultsEcho`，用于 `route()` 内出厂态路由段）；无测试直接 import、无生产消费者。
- **替代路径**：`src/testkit/fake-factory.ts`（函数名与参数语义不变，首参从 `FakeTaiga` 改为 `FakeWorld`）。
- **兼容期**：M0 建立迁移件并把 `fake-taiga.ts` 的调用改到新签名；M1 删除旧文件。
- **删除条件**：`grep -rn "fake-faces" packages/taiga/src` 为空；`factory.test.ts`/`onboard.test.ts` 全绿。
- **历史/数据处置**：无。

### 5.2 `src` 内测试（现有 10 件，全部目标-保留）

〔口径〕目标态 `src` 内测试为 **11 件**：下表 10 件零改动保留，第 11 件 `F-taiga-test-binding`（`src/binding.test.ts`，目标-新增）随 `binding.ts` 同批，用例面在 §4.2 已列（§3.3），不在本表复述。

| 测试件 | 路径 | 覆盖 | 不证明什么 |
|---|---|---|---|
| `F-taiga-test-activity` | `src/activity.test.ts`（174） | 游标三轮连续、边界不可达全量重放、`modified_date` 剪枝 | 不证明 webhook 主通道、不证明同秒并发边界 |
| `F-taiga-test-comments` | `src/comments.test.ts`（63） | 评论写（署名尾行/形状）、读（hidden/snapshot 过滤、升序） | 不证明真机 history 分页与作者口径 |
| `F-taiga-test-context` | `src/context.test.ts`（77） | T1 bound=1 自愈三函数、`invalidateMembers` | 不证明并发首请求的登录风暴 |
| `F-taiga-test-fields` | `src/fields.test.ts`（237） | schema 反射、provision 幂等、TOCTOU 400 吸收、多实体、`initialStateFor` | 不证明真实并发窗口；不证明部分成功回滚 |
| `F-taiga-test-guards-links` | `src/guards-links.test.ts`（129） | guards 读/收窄/拆闸、links 写不支持、派生链读 | 不证明平台侧真实拦截与拆闸恢复精度 |
| `F-taiga-test-issues` | `src/issues.test.ts`（296） | 建单回环/落位、客户端过滤、流转、setField 分派、乐观并发、构造校验 | 不证明建单+属性写的原子性、不证明重复建单防护 |
| `F-taiga-test-kb` | `src/kb.test.ts`（90） | get/search/upsert 幂等 | 不证明 slug 折平碰撞、不证明全文检索质量 |
| `F-taiga-test-onboard` | `src/onboard.test.ts`（68） | 三步合流两跑同结果 | 不证明并发 onboard、不证明落盘失败路径 |
| `F-taiga-test-factory` | `src/factory/factory.test.ts`（277） | A1/A2/A3、合流幂等、实体档案、入参防御 | 不证明真实 `moveTo` 引用迁移 |
| `F-taiga-test-http` | `src/transport/http.test.ts`（203） | 错误映射表、JWT 通路、请求构造、分页、构造校验 | 不证明超时/取消/429 退避（未实现） |

共同约束：**零真实网络**（9 个走 `FakeTaiga`；`transport/http.test.ts` 走自带 scripted `fetch`）；断言只对**契约与冻结口径**负责（`81-§四`：测试绿不证明真机）；`src/*.test.ts` **在根 program 与包级 program 内**（类型门禁覆盖）。

### 5.3 `test/` 目录（3 件）

#### `F-taiga-test-memberships` · `packages/taiga/test/memberships.test.ts`（157 行）

- **处置**：目标-保留；**建议迁入 `src/memberships.test.ts`**（与本包其他测试同置，顺带获得类型门禁），迁移属工程选择，不是语义变更。
- **覆盖**：`rolesOf`/`roleIdOf`（slug 与显示名双键、未知角色 fail-closed）、成员读（判重）、邀请/调角色/移除写面、`registerWithInviteToken` 公开端点（不携带 Bearer）、`findInviteToken` 两式与「取最后命中」。
- **夹具/断言**：自带 inline fake `fetch`（**不依赖 `FakeTaiga`/`testutil`**，直接 `buildContext` + 注入 `fetch`）；错误断言直接 `instanceof TaigaPlatformError` + category/subcause 匹配。
- **缺口**：**不在任何 typecheck program**（根 include 只到 `packages/*/src/**`，包 tsconfig 只含 `src/**`）——文件内的类型错误不会被 `bun run typecheck` 发现（§八 D3）。运行面在 vitest 内（默认 include 匹配 `test/*.test.ts`）。

#### `F-taiga-smoke` · `packages/taiga/test/smoke/taiga-smoke.ts`（105 行）

- **处置**：目标-保留（套外手动脚本），**明报非证据**。
- **覆盖**：真机只读面（schema/roles/kb/activity）+ `WRITE_SMOKE=1` 时建 1 单/流转/评论，落 `probe-co`。
- **夹具/断言**：无；`console.log` 人读输出，进程退出码不构成验收。
- **缺口**：不进 vitest、不进 tsconfig；凭据从 `<secrets>/taiga-admin-token` 读取（逻辑占位：具体路径由部署方按 78-§7.4.1 的 provider 给，本附录不写任何本机路径），**永不入仓/打印**；本附录**未复跑**真机。

#### `F-taiga-onboard-smoke` · `packages/taiga/test/smoke/taiga-onboard-smoke.ts`（159 行）

- **处置**：目标-保留（套外手动脚本），**明报非证据**。
- **覆盖**：`children` 派生链读；`WRITE_SMOKE=1` 时 provision 建「可删」档、kb 建页、guards 收窄，第二跑断言零写调用，指纹一致，收尾拆闸。
- **夹具/断言**：fetch 包装计数 + 指纹比较；无断言库。
- **缺口**：同 `taiga-smoke`；副作用会改 `probe-co` 的角色权限（拆闸后为全员放开，**不是**原权限）。

### 5.4 测试面与类型门禁的关系（现状复核）

| 面 | vitest | 根 `tsc`（`packages/*/src/**`） | 包级 `tsc -p tsconfig.json` |
|---|---|---|---|
| `src/*.test.ts`、`src/*/*.test.ts` | 是 | 是 | 是 |
| `src/testkit/**`（目标） | 被 import | 是 | 是 |
| `test/memberships.test.ts` | 是 | **否** | **否** |
| `test/smoke/*.ts` | **否**（文件名不匹配 `*.test.ts`） | **否** | **否** |

---

## 六、包配置件

#### F-taiga-package-json · `packages/taiga/package.json`（18 行）

- **处置**：目标-保留；**不新增依赖、不新增脚本**。
- **内容逐项**：`name`（`@studio-next/taiga`）、`version`（`0.1.0`）、`private: true`、`type: "module"`、`description`（指向 docs/32 事实依据）、`main`/`exports["."]` → `./src/index.ts`（源码态，不发布）、`scripts.typecheck`（`tsc --noEmit -p tsconfig.json`）、`scripts.test`（`vitest run`）、`dependencies` 仅 `@studio-next/contract: workspace:*`。
- **边界**：不加 `files`/`publishConfig`/`build`（79-§5.2 不发布）；不加 `zod`（本包手写窄校验，79-§3.7 记录过「零新依赖」策略）；不加 `@types/*`（根提供）。
- **验证**：`bun install --frozen-lockfile` 不产生 diff；`bun run typecheck` 与 `cd packages/taiga && bun run test` 是验收命令（**本次未执行**）。

#### F-taiga-tsconfig · `packages/taiga/tsconfig.json`（5 行）

- **处置**：目标-保留（`include: ["src/**/*.ts"]` 不动）。**建议**（工程选择，非本刀必做）：若 `test/memberships.test.ts` 迁入 `src/`，缺口自动消失；否则维持 D3 登记。
- **内容逐项**：`extends: "../../tsconfig.base.json"`（`strict` 全开、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`erasableSyntaxOnly`、`verbatimModuleSyntax`、`noEmit`）；`include: ["src/**/*.ts"]`；无 `exclude`、无 `paths`、无 `references`。
- **边界**：**不得**为让 smoke 通过类型门禁而把 `test/` 加进 include——smoke 是套外脚本，进 include 会把手动脚本的 API 漂移变成门禁红/绿噪声；正确做法是 `typecheck:test` 独立脚本 + 显式 `test/` include（82 项）。
- **验证**：`tsc --noEmit -p packages/taiga/tsconfig.json` exit 0（**本次未执行**）。

---

## 七、迁移顺序（M0–M4）

每一步都是**独立可回退提交**；任一步红则回退该步，不带病前进。所有命令本次**未执行**，只作验收口径（§八 8.3）。

### M0 · testkit 机械拆分（零行为变更）

1. 新建 `src/testkit/fake-world.ts`：搬 `FakeTaiga` 的状态字段、序列、种子方法、序列化与分页辅助（逐行搬，不改逻辑）；
2. 新建 `src/testkit/fake-routes.ts`：搬 `route()` 的业务路由段（认证段留给 `fake-taiga`）；
3. 新建 `src/testkit/fake-factory.ts`：搬 `factory/fake-faces.ts`（import 改 `./fake-world.ts`）；
4. 新建 `src/testkit/platform-fixture.ts`：搬 `src/platform-fixture.ts`（import 改 `../index.ts` + `./fake-taiga.ts`）；
5. 新建 `src/testkit/fake-taiga.ts`：`FakeTaiga` 类壳 + 认证 + `fetch`，转发公开成员保持兼容；
6. 新建 `src/testkit/index.ts` barrel；
7. `src/testutil.ts` 替换为纯再导出 facade。

- **回退**：revert 该提交（纯源码，无数据迁移）。
- **验收**：`bun run guard:boundaries`（尺寸/边/BC-T1）→ `bun run typecheck`（根 program 覆盖 `src/testkit/**`）→ `cd packages/taiga && bun run test`（11 个测试文件全绿）。
- **完成判据**：`git diff --stat` 中只有搬移与 import 路径；测试文件与断言零改动；`testutil.ts` < 30 行。

### M1 · 退役旧两件

1. 改 `src/fields.test.ts:11`、`src/context.test.ts:13` 的 `./platform-fixture.ts` → `./testutil.ts`（或直接 `./testkit/index.ts`）；
2. 删除 `src/platform-fixture.ts`、`src/factory/fake-faces.ts`；
3. `grep -rn "platform-fixture\|fake-faces" packages/taiga/src` 应只剩 `testkit/` 内部合法引用。

- **回退**：M0 仍在，恢复两文件即可（内容在 testkit 内）。
- **验收**：同 M0 三条命令 + 上述 grep 为空。
- **兼容期**：无外部消费者（`private`，仓内唯一消费者是测试自身），无需兼容层。

### M2 · 绑定档案（分三段，逐段各有前置）

绑定件的**形状已定**（80-§6.6），**端口宿主在 daemon**（80-§6.9），按「依赖落地件齐不齐」切三段，**不一次性开**——混在一起会让「等 A」变成「等所有事」。本卷（`packages/taiga`）只落**提供者**三段；宿主 `apps/daemon/src/assembly/platform/binding.ts` 的四方法装配属 daemon 分卷的施工项，本附录只登记交接语义（§4.2「与宿主的分工」）。

**M2a · `errors.ts` 两轴 + 档案内容 + `mapState`**（只读，无导出、无签名、无记录）

1. 前置（**依赖前置，不是接口未定**）：`contract` 落 `Result<T,E>`/`FailureClass`/`BindingProfile`/`StateMapping`/`ExportScope`/`ExitPlan`（类型落 `src/ports/binding.ts`，80-§6.9），并给 `ClassifiedError` 补 `failure` 栏——归 `81-files/01-contract.md`（D1；01-contract v0.8 已拆 `F-contract-port-binding` 到 `src/ports/binding.ts`，落点口径一致）；
2. `transport/errors.ts` 换四字段 `(failure,category,subcause,detail?)`，全包 subcause 词表按 §4.1 落；`expectTaigaReject` 扩为三参；该步**动 88 处抛点**，须单独提交、单跑 `cd packages/taiga && bun run test`；
3. 新增 `src/binding.ts` 的 `bindingProfile`/`mapState`/`lossReport`（80-§6.6 三层第 3 条的三个导出名）+ `src/binding.test.ts`；`src/index.ts` 增再导出（**恰好这三个纯函数**，内部 `judgeTaigaExport`/`taigaExitDeclaration`/`requireExitFacts` 不导出）；
4. `lossRefs` 由**调用方注入**（daemon/绑定注册流程），记录由 daemon 写 `REC-LOSS-01`，本件不造 Qid（D2 只剩「记录写入者是谁」这一层，`manifest.shape` 八项另议）；
5. 验收断言：`bindingProfile` 20 字段齐、`losses` 每项是注入的 Qid（经 `lossReport`）、`lossRefs=[]` ⇒ 拒建；`mapState` 三情形（命中→`verified`；非空未声明→`Ok(unverified)` + `workStates:[]`；空/畸形→`Err(rejected_precondition,'empty-platform-state')`），且**断言不写 `REC-OBS-02`**；声明含 `STAT-E`/`STAT-H` ⇒ 拒建；全用例 `FakeTaiga.calls.length === 0`。

**M2b · 导出 scope 拒绝面**（只判 scope，不组装）

1. 前置：D10（`proof.signature` 归谁）与 D12（`KnowledgeScope` 形状）回写——否则 `rejected_forbidden` 无法判；
2. 实现**内部** `judgeTaigaExport`（scope 六要素，不导出）+ `exportMigrationExit.exportShape` 声明（§4.5.3）；范围内 ⇒ 宿主返 `Err(unsupported/export-assembly-outside-binding)`，**不翻页、不读全量、不自签、不出半包**；
3. 验收断言：`company` 不符 → `rejected_forbidden`；`knowledgeScope` 无法证明 → `rejected_forbidden`；`memories.include` 非空或 `factDomains` 越界 → `unsupported`（`category='EVOLVE_REJECT'`）；范围内 → 宿主 `unsupported/export-assembly-outside-binding`；`manifest.shape` 的 7 个 `includes*` 声明值如实（5 假 2 真）。

**M2c · 退出声明与事实校验**（声明在本包，组装在宿主）

1. 前置：D13（`ExitPlan` 的 `fence` 槽无「无围栏」表达位）先回写——否则类型上只能填假 `fenceToken`；另需 D2 的损失记录已由 daemon 写（「无围栏原语」「无基线快照」两条须有 Qid 可引）；
2. 实现**内部** `taigaExitDeclaration`/`requireExitFacts`（§4.5.4，不导出）：声明槽静态给（随 `exportMigrationExit.exitPlan` 骨架），事实槽缺 ⇒ `Err('exit-plan-facts-missing')`，不填占位；`ExitPlan` 本体由宿主在 D13 回写后组装；
3. 验收断言：缺 `exitFacts` 任一槽 → `Err(rejected_precondition/CONFIG_INVALID,'exit-plan-facts-missing')`；声明面含 `archive.mode='read-only'`、`deleted:false`、`exit.unresolved` 必列三项已知短板；**不伪造 `fenceToken`**、不取时钟。

- **目录规模**：`src` 直属件现 21 → M1 后 20 → M2a 后 22（`binding.ts` + `binding.test.ts`），M2b/M2c 只加行不加件，仍 ≤ 25。
- **回退**：按段回退——移除该段方法与其测试；`errors.ts` 四字段与 contract 类型回退需单独提交（类型新增向后兼容，可保留）。
- **阻塞**：M2a 缺 D1、M2b 缺 D10/D12、M2c 缺 D13 时**停**，不写占位实现、不填假值。

### M3 · `guards.read` 接线

1. `platform.ts` 的 `guards` 对象增 `read(company)`：`requireCompanyScope` → `readRoles(ctx)` → 投影 `{slug, name, permissions}`（丢 `id`/`computable`）；
2. `contract` 决定 `read?` 是否转必选（80 v1.6 说「三实现接线齐后转必选」，转必选=契约变更，须批示）；
3. 测试补 `guards.read` 正/负例（作用域不符、空角色集）。

- **回退**：删除 `read` 键；`read?` 保持可选。
- **验收**：三条命令 + `guards-links.test.ts` 新增用例绿。
- **未证**：真实平台 roles 权限词表与 `PlatformRole.permissions` 的完备性（`78-§9.3` 未列）。

### M4 · 可选：退役 `testutil` facade

1. 10 个 `src` 测试与 2 个夹具改 import `./testkit/index.ts`；
2. 删除 `src/testutil.ts`，从 `boundary-rules.mjs` 删除其 `lineBaseline` 条目（**门禁表变更，须批示**）；
3. `src` 直属件 −1。

- **回退**：恢复 facade 与基线条目。
- **验收**：三条命令 + `grep -rn "testutil" packages/taiga/src` 为空。

---

## 八、未证、缺口与回写对象

### 8.1 契约与上位缺口（不在本附录私设）

〔编号说明〕D1–D5 为原有编号；D10–D16 是 v0.2 新增，**顺延不重排**（避免已引用 ID 漂移），故本节表格按 1–5、10–16 出现。其中 **D16 已关闭**（上卷已修，见该行），编号保留、不复用、不重排——关闭件与待裁决件同表并列，靠「已关闭」标记区分，不计入未决项。v0.2.2 曾登记 D17/D18 两条，均已确认由上游同一日自修并**撤回、不复用编号**（依据：80:1804 与 80:1824 明写 `mapState` 本函数不写 `REC-OBS-02`、由消费方写；01-contract v0.8 已拆 `F-contract-port-binding` → `src/ports/binding.ts`）。本节不再列这两条，也不再复述其内容。

| ID | 缺口 | 事实 | 回写对象 |
|---|---|---|---|
| D1 | `contract` 的绑定落地件未建（形状与落点都已定，**不是接口未定**） | 80-§6.6 已定形（`BindingProfile` 20 字段、`StateMapping`、`ExportScope`、`ExportBundle`、`ExitPlan`），80-§6.9 已定落点（类型 `contract/src/ports/binding.ts`、实现 `assembly/platform/`）；缺的是**代码**：`PlatformBindingPort`/`BindingProfile` 在 `packages/contract/src` 零命中、`Result<T,E>` 无定义（`kernel.ts:32` 的 `ResultStats` 不是同一物）、`FailureClass`/`Qid`/`Digest` 无定义、`WorkState` 只在文档（G-22：十态只有中文名，不得自造英文）、`ClassifiedError` 只有 `category`（11 值，`kernel.ts:85-96`）+`subcause`+`detail` 而无 `failure` 栏、`canon.ts` 的 `Canonicalizer` 只有类型面（jcs@1 未实现，U80-01）。这是**依赖前置**（落齐才可编），不是「要不要这么设计」 | `81-files/01-contract.md`：`src/ports/binding.ts`（**80-§6.9 指定**、01-contract v0.8 已拆 `F-contract-port-binding` 承接：`BindingProfile`/`StateMapping`/`ExportScope`/`ExportBundle`/`ExitPlan`）、`src/ports/kernel.ts`（`Result` + `ClassifiedError.failure`）、`src/records/scalars.ts`（`F-contract-rec-scalars`：`FailureClass` 14 值、`Qid`、`Digest`）、`src/ports/work.ts`（`WorkState`，G-22 未清前只作不透明别名）、`src/canon.ts`（`F-contract-canon`）；本包 `binding.ts` 与 M2a 阻塞 |
| D2 | 损失记录由谁写；`manifest.shape` 八项未逐项定案 | 80-§6.6 要求 `losses`/`lossRefs` 是 `REC-LOSS-01` 的 `Qid` 引用——**引用侧本附录已解决**（`lossRefs` 由调用方注入，本件不造 Qid、不写记录）；剩下的缺口是**记录写入者**：78-§9.3 的三条损失是散文，没有对应的 `REC-LOSS-01` 行，须由 daemon 注册流程/迁移流程落盘后才能被引用（本包零写口）。另：78-§9.3/§9.7 的导出取舍是散文，`manifest.shape` 八项（`formats` ＋ 7 个 `includes*`）未逐项定案 | 78-§9.3/§9.7 给记录写入者与 `manifest.shape` 八项；**不需要**补 `L78-*` 编号法（编号法已有） |
| D3 | `test/` 不在类型门禁；`fakes` 只许 demo/test 无机械 guard | 根 `tsconfig.json` include 到 `packages/*/src/**`；包 `tsconfig.json` 只含 `src/**`；`test/memberships.test.ts` 与 smoke 均无类型覆盖。另：`src/testkit/**` 虽在门禁内，但**没有**任何规则阻止生产装配（如 `apps/daemon/src/assembly/platform/wire.ts`）import `FakeTaiga`，`src/testkit/README` 也未产——当前只靠 review（§5.1） | 79-D10；82 立「`test/` 纳入门禁」项（可先加 `typecheck:test`）；fake 误引的机械 guard 归 `scripts/guards/`（提案流，不改 `boundary-rules.mjs`） |
| D4 | `guards.read?` 仍是可选位 | `contract/src/ports/platform.ts` 注释明说「taiga 接线明确推迟；三实现齐后转必选」；taiga 尚未接 | `81-files/01-contract.md` + 80-§6.8；本附录只设计 M3，不改契约 |
| D5 | `FlowPlatform` 以抛错承载拒绝 | 80-§5.7 要求 14 类预期拒绝经 `Result`；`FlowPlatform` 七能力签名是 `Promise<T>`，生产 `src` 有 88 处 `new TaigaPlatformError`（另 1 处裸 `Error` 在 `entityDescriptor`），全部以抛异常表达。改签名=契约变更，影响三实现与 gateway | 80-§5.7/§6.8 + `contract`；**不得**在 81 私改 |
| D10 | `ExportBundle.proof.signature` 的署名者无主 | 80-§6.6 要求 `proof: { semanticDigest, signature }`，但 80 全卷无签名端口、无密钥归属说明（`Signature` 只在两处形状里出现——§4.3 的 `signatures`、§6.6 的 `proof.signature`——**无类型定义、无签名端口、无归属主体**）；daemon 侧只有 `gatewaySecret`（`assembly/serve.ts:328` 注释、`:332` 字段；`assembly/platform/wire.ts:39-43` 用开发缺省时只警告不打印）。taiga 零依赖、不持密钥，**不能**自签；`semanticDigest` 只作档案身份，不作签名替代 | 80-§6.6（补署名归属：daemon/gateway 签、绑定只交摘要）。**不阻塞** `exportBundle` 的拒绝面（本包只给 scope 判定；宿主恒返 `unsupported/export-assembly-outside-binding`，不组装、不签名）；阻塞的是 daemon 执行体能否凑齐 `proof`（§4.5.3 八栏） |
| D11 | 未知状态第二层落在读面硬错，且分类错 | `statusNameById`（`transport/context.ts:219-229`）对**不在状态集内**的 status id 抛 `CONFIG_INVALID/issue-missing-state`；`toIssueRecord`（`issues.ts:43`）不捕获 → 平台侧删/改状态集会让整单读失败。而 77-§9.2/80-§6.6 要求这类未知是**观察事实**（`gap`/`REC-OBS-02`），不是调用失败；`CONFIG_INVALID` 又把它说成「调用方输入错」 | 80-§6.6 ＋ 77-§9.2/§11.1：定「读面遇平台漂移报哪类」；taiga 侧目标改 subcause/分类（独立单，须改测试断言） |
| D12 | `KnowledgeScope` 无 TS 形状；Taiga 表达不了逐记录知悉范围 | 80 用 `KnowledgeScope` 作 `ExportScope` 必填栏，但只在 `76-§SG-07` 有**配置 schema**（`audienceRefs`/`purposeRefs`/`retentionRule`），无 TS 类型；Taiga 的可见性单位是项目成员+角色，**无逐记录受众**。故「超出 `knowledgeScope` ⇒ `rejected_forbidden`」无法判定 | 80（给 `KnowledgeScope` TS 形状）＋ 78（声明 Taiga 只能 fail-closed）；`exportBundle` 阻塞 |
| D13 | `ExitPlan` 只有一种形状，事实槽必填，「本平台不做围栏」无表达位 | 80-§6.6 的 `ExitPlan` 九槽里 `fence.fenceToken`/`until`、`freezeWriter.frozenAt`、`exportVerification.verifiedBy`、`acceptance.acceptedBy`、`exit.completedAt` 都是**运行时事实**，TS 上必填；Taiga 无围栏原语，填 `fenceToken` 就是伪造，不填就过不了类型。绑定件不取时钟、不持密钥、不认人，只能靠注入 | 80-§6.6：`ExitPlan` 拆「声明形状 + 执行形状」，或事实槽改 optional 并以 `unresolved` 记「无围栏」；未回写前宿主 `exitPlan` 装配停、本包只落声明面（§4.5.4） |
| D14 | `FlowPlatform` 的读面无「不存在」通道，与 80 的「纯读不存在返 `undefined`」冲突 | `contract/src/ports/platform.ts:182`（`issues.get`）与 `:198`（`kb.get`）：`get(id): Promise<IssueRecord>`、`kb.get(path): Promise<string>` 都不含 `undefined`；80-§5.7 第 5 条要求纯读「不存在」返 `undefined` 而不是失败。故 taiga 现在只能抛 `not-found`/`kb-not-found`（`failure=rejected_precondition`），把「不存在」说成「前置不满足」 | 80-§5.7/§6.8 ＋ `contract/src/ports/platform.ts`：读面加 `\| undefined`（契约变更，牵三实现与 gateway）；未定前 §4.1 词表按现状登记，不谎称「不存在已分流」 |
| D15 | 本轮口径变化会动现有断言，须同批改测试 | ①409 归 `rejected_version`（现状按 `CONFIG_INVALID/conflict` 系）；②401/403 拆 `rejected_authority`/`rejected_forbidden`；③形状漂移归 `unsupported`（现状 `unexpected-response` 散落 `CONFIG_INVALID`）；④`expectTaigaReject` 扩三参；⑤`issue-missing-state` 改 `conflict/EXTERNAL_REJECT`（D11）。这些是**行为变更**，不是文档重排 | `http.test.ts`/`context.test.ts`/`issues.test.ts` 等断言同批改，且单独提交；未改前 M2a 不得宣称「两轴已落」 |
| D16（**已关闭**，保留编号不重排） | taiga 凭据的 `secretId` 前缀曾与 YouTrack 同形 | 旧稿称 78-§7.4.1/80-§11.2.1 把 taiga 认证条目写成 YouTrack 的 `YT` 前缀，两者同形 ⇒ 同一 `KnownSecretSet` 下无法区分、审计里会混 | **已由上卷修好，本附录无需再提**：78-§7.4.1 现定 `SEC-TG-TOKEN`/`SEC-TG-PASSWORD`（`TG`=Taiga；`YT` 只属 YouTrack，两者不混），env 名不变（`TAIGA_USERNAME`+`TAIGA_PASSWORD`，或 `TAIGA_TOKEN`，可选 `TAIGA_REFRESH`）。本附录 §4.0 第 6 条已照此对齐，**不自造第三前缀**（`SEC-<域>-<slug>` 的「域」就是平台域码，`TG` 即 Taiga 的域码，无需另立一套）。本包仍只按调用方传入的 `auth` 消费，不持 `secretId` |


### 8.2 实现与证据缺口（归 82/V4，不在本附录修；D6-* / D7-* 为族编号）

| ID | 缺口 | 影响 |
|---|---|---|
| D6-1 | `createIssue` 建单与属性写**两次调用、无事务**；无平台幂等键 | 中途崩溃=单在、自定义维空；重试=重复建单 |
| D6-2 | `guards`/`fields`/`kb` 读-改-写无 CAS（`roles` PATCH 无 version；kb 双建未吸收） | 并发丢更新、部分成功、双建 |
| D6-3 | `TaigaClient` 无超时、无取消、无 429/5xx 退避、无 single-flight | 慢平台挂死调用方；首并发登录/刷新风暴 |
| D6-4 | 分页无快照一致性（偏移分页） | 平台并发变更时活动/列表可重可漏 |
| D6-5 | `activity` 边界不可达时全量重放；建单事件缺席 | 成本尖峰；只能靠 webhook 补 created |
| D6-6 | **认证态只在进程内存**：`TaigaClient.tokens`（`transport/http.ts:85` 的私有实例字段）不落盘、不跨进程共享、无 TTL 判定 | daemon 重启或多进程部署时各自 `login()`；`TAIGA_REFRESH` 只在单实例内有效，平台侧 refresh token 轮换策略对多实例不成立（并发登录/刷新风暴的另一面，见 D6-3）。本包**不持**凭据存储——这是本包不该修、但必须如实登记的存储缺口 |
| D7-1 | `CUSTOM_BUSINESS_DIMS` 硬编码 `type/dept/level/lane`；`create` 不写 `lane`；`create`/`setField` 的 `parent` 一律拒绝 | 新增业务维须改常量 + `fieldmap` + 契约；`lane` 只能建单后用 `setField` 补 |
| D7-2 | `kb` slug 折平会把 `guide/deploy` 与 `guide-deploy` 并页 | 知识库路径歧义（无碰撞检测） |
| D7-3 | `guards.uninstall` 无基线快照=全员放开 | 拆闸后不能回到原权限集（78-§9.3 已列损失） |
| D7-4 | `findInviteToken` 取「最后命中」；日志里其他 token 可被误取 | 多邀请并发/无关日志的错配风险 |
| D7-5 | `requireEntity` 在 `issues.ts` 与 `links.ts` 各一份；评论读不做 `issue-not-found` 包装 | 口径漂移；重复维护 |
| D7-6 | `platform.validateOptions` 不校验 `entity`；未知实体延迟到 `entityDescriptor` 抛裸 `Error` | 构造期错误分类不一致（`CONFIG_INVALID` vs `Error`） |
| D7-7 | `TaigaContext` 未从包根导出，daemon 用 `ReturnType<typeof buildContext>` 取形；`transport/context.ts:42` import 位于文件中部 | 公共面无稳定类型；风格债 |
| D7-8 | `kb` 页大小硬编码 `100`（未用 `LIST_PAGE_SIZE`） | 一致性小债 |
| D8 | `PACKAGE_STATUS='onboard-cut'` 是自述漂移（包已含 links 写不支持/guards 无基线/binding 未落地）；`notImplemented` 零消费者 | 保留常量与取值域、改值为如实档（建议 `partial`）；`notImplemented` **目标-退役**（未进包根导出面，删除不构成对外破坏；但属源码删除，须与 M2 同批留 diff） |
| D9 | `lineBaseline[testutil]=723` vs 实测 693 | 基线陈旧（方向为下降，可随拆分删条目，但删条目须批示） |

### 8.3 未证（本次明确不宣称）

- **未运行任何门禁**：本次没有执行 `bun run typecheck`、`bun run guard:boundaries`、`bun run test`、`cd packages/taiga && bun run test`。文中所有「验收命令」是口径，不是结果。
- **未跑真机**：`docs/32-Taiga真机试点报告.md` 与 `probe-evidence/taiga-links` **未复跑**；本附录只引用其中的结论性事实（JWT、history 无建单、links 五结论、`roles` 无 version 等），不把它们当本次证据。
- **未做类型审查**：80-§6.6 已把形状定形、80-§6.9 已把落点定死（`contract/src/ports/binding.ts`），但 `contract` 的**落地件未建**（`BindingProfile`/`StateMapping`/`ExportScope`/`ExportBundle`/`ExitPlan`/`Result`/`failure`/`FailureClass`/`WorkState`/`Qid`/规范化器，D1；`KnowledgeScope` 形状，D12），`REC-LOSS-01` 的记录也还没有（D2）——本附录 §4.2/§4.5 是**按 80 签名写出的落法**，不是已编译通过的实现；本包 `binding.ts` 可施工的前提是 D1 先落，不是「有类型疑问」。
- **未验证拆分可行性**：testkit 六件的行数估算是按现有 693 行分布推算，未实际拆分；M0 的「零行为变更」需以测试全绿证明，本附录不预支该结论。
- **未验证测试覆盖度**：`test/` 文件的覆盖描述依据 `describe` 标题与源码命名，未运行覆盖率工具；「不证明什么」按 81-§四口径书写，不代表已穷举。
- **未触碰任何生产代码、manifest、`boundary-rules.mjs`、contract 类型**：本附录是设计呈审稿。§4.5 的所有 Taiga 落法（含 `digestOf` 注入、`exportBundle` 只返拒绝、`exitPlan` 事实注入）**均未写成代码**，可行性是论证，不是运行结果。
- **协作编辑事实**：v0.2 曾由两个进程先后写入（`claude -p` 与另一次修订），04:35–04:41 期间交替落盘；**v0.2.2 本轮为单写**（07:53–07:58 连续落盘，其间 80 于 07:52、01-contract 于 07:53 各改过一版，本附录已按改后原文重核）。本文件内容以磁盘为准；若与别的进程内存副本冲突，以磁盘为准并重核 §3.5/§8.4 的数字（41 件 / `src` 22）。

### 8.4 结论

- **现有 35 件全部有归属与去向**：33 件保留（含 `testutil` facade；`PACKAGE_STATUS` 改值不退役）、2 件退役、8 件新增（`binding.ts`、`binding.test.ts`、`testkit/` 6 件），目标 **41 件**。
- **规模**：目标 `src/` 直属 21 → M1 后 20 → M2a 后 22（+`binding.ts` +`binding.test.ts`；≤25，M2b/M2c 只加行不加件）；`src/transport/` 6、`src/factory/` 2、`src/testkit/` 6；全部单件 <600（`testutil` 693 经拆分消失，基线条目随批示删）。
- **不动实现**：除 `platform.ts` 补 `guards.read`、`context.ts` 顶部 import 归位、`index.ts` 增再导出与 `PACKAGE_STATUS` 改值（常量值，非逻辑）、`transport/errors.ts` 补 `failure` 并退役 `notImplemented` 外，其余生产件**零行为变更**——符合 80-§2.4「taiga 实现不动，只在端口侧补签名」。
- **绑定的真实卡口是「三类输入 + 落地件 + 宿主接线」，不是「等一个类型」**：形状已由 80-§6.6 定死、落点已由 80-§6.9 定死（类型 `contract/src/ports/binding.ts`、实现 `assembly/platform/`），卡口是①`contract` 落地件（D1；01-contract v0.8 已拆 `F-contract-port-binding`，落点口径已一致）、②三处注入的事实从哪来（`lossRefs`/`exitFacts`/`digestOf`，D2/D13）、③两处外部定案（署名归属 D10、`KnowledgeScope` D12）、④daemon 侧宿主文件尚未建（本卷只登记交接语义）。故 M2 拆三段：档案内容 + `mapState` 只需 D1 + 注入，可先行；导出只落 scope 拒绝面，等 D10/D12；退出只落声明面，等 D13。
- **未知状态的可观察边界**：`mapState` 能让「未声明状态」成为**可观察事实**（`Ok(unverified)`，不猜、不判失败、不回 `Err`），但它**本身不落记录**——`REC-OBS-02` 由宿主的观察投影落（80-§6.6 三层第 6 条已明写）；平台侧把状态集删改掉时（名字都取不到），现状仍是一条硬错且分类为 `CONFIG_INVALID`（D11）——这一层**没有**被本设计修好，只被如实登记。
- **被阻塞的目标**：本包 `binding.ts` 的 M2a 等 D1、M2b 等 D10/D12、M2c 等 D13；宿主 `assembly/platform/binding.ts` 的四方法装配等 D1/D13 与 daemon 分卷排期；`guards.read` 转必选等 D4。回写完成前，相关段落是**待前置**的施工设计，不是可立即开工的单。
