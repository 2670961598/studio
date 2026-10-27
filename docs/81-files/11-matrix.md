# 81-files/11 · packages/matrix 逐文件技术设计附录

> 版本：v0.5，2026-10-27（v0.1 首稿；v0.2 按 78-§7.4.1/§11.2、80-§3.4/§6.6/§11.2/§11.2.1/§12.1 对齐通知、房间、秘密与广播接口；v0.3 把同一批接口落成**目标件契约**：错误分类与 `Result` 纪律、`SecretMaterial` 供给、出站脱敏注入、广播不重发、`provision.ts` 拆分与新增目标件；v0.3.1 只校订引用与渲染；v0.4 加会话工厂目标件、按 78/80 定案收窄登录与秘密口径；v0.5 按最新 80 把建号改为独立 HR 秘密句柄，并收口工厂/直接面互斥、空值与重建语义，见下）。
> 性质：**自然语言级文件与实现设计呈审稿**，不是现行文件树、实现单、完成证明或能力证明。
> 上位：75 的文件/依赖契约；76/77 的公共语义；78 的 Matrix 绑定（`BIND-EDGE-MX-01`）；79 的 TS 工程与依赖；80 的运行时、组合根与公共端口。
> 边界：本附录只覆盖 `packages/matrix`。所有“目标/新增/拆分/替换/退役”均是设计处置，**尚未执行**；不得据此直接改生产代码、依赖清单、lock、guards 或其他卷。
> 事实口径：本附录的“现有”只描述本次实际读到的源码导出、调用与测试锚；“库级/未接”表示符号存在但生产链没有消费者；“未证”表示没有运行证据，不能写成支持。
> **行号口径（v0.3 起）**：所有 `path:line` 锚点都按**当前工作树文件的实际行号**（原文行号，含 `//`、`/** */` 注释行，不做“去注释后行号”换算）逐一核对；行数不足时标区间而非单点。`apps/boot/src/boot.ts` 现为 376 行，105-files 证据报告只覆盖到 `:296`，超出部分以本卷实测为准。旧稿里的 `boot.ts:270`、`boot.ts:345` 两处引用在当前文件中不成立于所述内容，已在本版替换为实测区间 `boot.ts:290`–`:296`（`log` 直通广播面）与 `boot.ts:343`–`:348`（一次登录、多面共用）。若后续文件变动导致锚点漂移，以“重新核对后的区间”更新，不保留旧号。
>
> **v0.2 修订说明（只改文档，不改代码）**：本次重写与“通知 / 房间 / 秘密 / 广播接口”直接相关的段落——§1.3 内部修候选、§2.3 导出身份、F-matrix-client 错误面、F-matrix-adapter（`Notifier`）、F-matrix-broadcast（`NotifyBroadcastFace`）、F-matrix-hr-face（秘密）、F-matrix-provision（房间）、§6.2–§6.4、§7.2–§7.4、§8.3、§9.1–§9.2、§十。依据是 78 v0.1 的 §7.4.1（秘密清单与提供方）与 §11.2（Matrix 绑定卡），以及 80 v0.1 的 §3.4（注入面与缺省语义）、§6.6（`Notifier`/`NotifyBroadcastFace`）、§11.2/§11.2.1（秘密供给、`KnownSecretSet`、强制脱敏出口）、§12.1（通信绑定四接缝）。v0.1 里“待 80/76/77 明确”的若干项现已由上位文档定案，本版按定案改写，并把仍开的口子缩到最小。**件数与处置不变**；§9.1 未证清单只补不减，已证的结论不改；仍未运行测试、未改生产代码。
>
> **v0.3 修订说明（只改文档，不改代码）**：本版把 v0.2 停在“与接口对齐”的半程推到**目标件契约**——每个受影响的现有件给出目标签名与落点，新增件给出完整文件契约，并让计数可复算。修改面：头部、§1.3（目标件 18 → **24**）、§2.2/§2.3、F-matrix-index/client/format/adapter/broadcast/hr-face/provision、新增 `F-matrix-errors` 与 `provision/{plan,ensure,ticket,face}.ts`、新增 `F-matrix-test-errors`、F-matrix-package/readme、§4、§6–§10。依据：80-§5.7（`ClassifiedError`/`Err` 的 category 可达集）、§6.1（`RuleEvaluator`，本包 N/A 并给理由）、§6.6（`Notifier`/`NotifyBroadcastFace`/`NotifySendReceipt`/`NotifySendReport`）、§11.2/§11.2.1（`SecretCatalogEntry`/`SecretMaterial`/`KnownSecretSet`/强制脱敏出口）、§12.1（通信绑定四注入面）；77-§11.1（十四类失败）；78-§7.4.1（秘密表与轮换）、§11.2（`BIND-EDGE-MX-01`）。**仍不含任何运行证据**：未跑测试、未启动 daemon/boot/Synapse、未改生产代码/依赖/lock/guards。
>
> **v0.3.1 校订说明（只改文档，不改断言）**：修三处引用与一处渲染问题——① 20 卷节号 `§二` → `§十五.二`（§2.1、§9.3-2），并改引 `boundary-rules.mjs:106` 的 `["boot","matrix"]` 与“无 `daemon→matrix`”，不再用 `:139`（那是 matrix 自身的边）；② 三处以“前缀+星号”通配方式声明“不新增端口”的写法（F-matrix-client、F-matrix-broadcast、§9.2 已定案条）改为具体说法“不申请端口 ID”；③ 17 卷的简写文件名改为全名 `81-files/17-daemon-assembly-cli-control-evolve.md`，并**撤回** §9.2-3 的过期指控（该卷 W-19 已回写 `assembleApi` 不收 `engine`）；④ 修正 §3 F-matrix-mentions 正文里破坏渲染的裸三反引号。另新增 §7.5 四条身份/决定边界，§7.2/§3 F-matrix-hr-face 把“boot 从 env 读”明确标为现状而非目标。**未运行任何测试、未连接 Matrix、未改生产代码。**
>
> **v0.4 修订说明（只改文档，不改代码）**：本版按 78-§7.4.1（第 1010/1011/1017–1019 行）与 80-§3.4 第 10 条、§11.2.1 的最新定案收口，六项改动——① 新增 **`F-matrix-session`**（`src/session.ts`≤140）与 **`F-matrix-test-session`**（`session.test.ts`≤200）两个完整文件契约，目标件 24 → **26**（生产 15 / 测试 8 / 配置 3），`src` 直下 19/25；② 秘密用途分离：登录 `load(SEC-MX-BOT-PASSWORD,'platform-auth')`、建号 `use='matrix-register'`（v0.5 更正：建号秘密是 `SEC-MX-HR-SHARED`），HR 仍 `matrix-register`+`outbound-redaction`；③ 会话 access token 只在 client 实例内存、**无静态 `secretId`**、不进帧/日志/PRM/任务书/快照；④ 装配面改为“boot 只构造工厂、daemon 驱动登录”，工厂返回四个工厂/面本身 + `close()`（`hrMatrixFace:()=>MatrixHrFace`，不是 `MatrixRoomFace`），四面直连降为测试/迁移兼容，**不新增 `daemon→matrix` 边**；⑤ 关闭 `matrix-notify` 无静态条目认领的旧缺口（§7.2、§9.2-7 墓碑保留）；⑥ 校正 `taxonomy.ts` 锚点 `:49`–`:60` → `:59`–`:67`，并清掉 §8.1/§9/§十 里过期的目标计数与旧行号。**仍无任何运行证据**：未跑测试/typecheck、未连 Matrix、未启动 daemon/boot/Synapse、未改生产代码/依赖/lock/guards。
>
> **v0.5 修订说明（只改文档，不改代码）**：本版按**最新 80**（§3.4 第 10 条的两个逻辑秘密句柄、§11.2.1 的空值/轮换语义）纠正 v0.4 的三处口径，并同步契约与版本头——① **建号不再用 bot 密码**：`registration` 改为 `MatrixHrRegisterSecret`（`SEC-MX-HR-SHARED` + `kind:'shared-secret'` + `use:'matrix-register'`），`login` 仍是 `MatrixBotLoginSecret`（`SEC-MX-BOT-PASSWORD` + `kind:'password'` + `use:'platform-auth'`）；两柄不互换，**仅建号能力开启才 `load` `registration`**，缺失 ⇒ 拒该能力（`CONFIG_INVALID`），bot 密码的 `matrix-register` 为保留未用位。② **工厂与任一直接面同时出现一律 `CONFIG_INVALID`**，不再写“比较是否矛盾”（启动期不可判）；各自单独存在仍合法（测试/迁移）。③ 补 **`SecretProvider` 失败映射**：空串/零字节 ⇒ `Err(rejected_precondition, subcause:'secret-empty')` 且不返回材料；provider 不可用 ⇒ `unavailable`；撤销/版本不符 ⇒ `rejected_version`；装配期必需项 `Err` ⇒ `CONFIG_INVALID` 并保留 cause、选项 `Err` ⇒ `REC-LOSS-01`；轮换/吊销由文件 `mtime`/`version` 变化或部署控制通道触发**整体重建**（不是只能重启）。同步面：`F-matrix-session`（Deps/构造校验/错误面）、`F-matrix-test-session`（覆盖与 fake）、§1.3、§2.1/§2.3、§6.1/§6.4/§6.5、§7.2/§7.5、§9.1/§9.2-4、§9.3（新增 78 与最新 80 的分歧）、§十。计数不变（**26** 件）；**仍未跑测试/typecheck、未连 Matrix、未改代码**。

---

## 一、范围、排除与计数

### 1.1 覆盖范围

覆盖 `packages/matrix` 下全部第一方生产源码、与源码同目录的测试文件、`package.json`、`tsconfig.json`、`README.md`。

排除：

- `packages/matrix/node_modules/**`（workspace 链接与依赖安装产物，生成物）；
- `.git`、`.DS_Store`、编辑器/统计工具产物；
- 第三方包源码与 lock 文件正文；
- `docs/` 下其他卷、历史设计文档、施工单正文。

源码注释中出现的 `105-刀A/刀B`、`130-P3`、`DEV-20`、`DEV-48`、`studio-dev-*` 等施工号，是源码作者留下的施工引用；其中 `105`、`130`、`DEV-*` 的正文不在本仓 `docs/` 可核范围。本附录只按 `21`、`21A`、`25`、`52`、`78`、`80` 复核；施工号只作为“注释声明”，不作为规范或能力证据。

### 1.2 现有件全集

`packages/matrix/src` 共 15 个 `.ts` 文件：9 个生产文件、6 个测试文件；包根 3 个配置文件/文档。合计 **18 个现有件**。

| F-ID | 现有路径 | 类别 | 行数 | 现有处置 |
|---|---|---|---:|---|
| F-matrix-index | `packages/matrix/src/index.ts` | 生产/桶导出 | 76 | 现有；目标-保留 |
| F-matrix-client | `packages/matrix/src/client.ts` | 生产/网络层 | 465 | 现有；目标-保留（目标修订） |
| F-matrix-mentions | `packages/matrix/src/mentions.ts` | 生产/纯核心 | 240 | 现有；目标-保留 |
| F-matrix-format | `packages/matrix/src/format.ts` | 生产/纯核心 | 36 | 现有；目标-保留 |
| F-matrix-adapter | `packages/matrix/src/adapter.ts` | 生产/适配 | 130 | 现有；目标-保留（Notifier 出口库级未接） |
| F-matrix-broadcast | `packages/matrix/src/broadcast.ts` | 生产/适配 | 139 | 现有；目标-保留（目标修订） |
| F-matrix-hr-face | `packages/matrix/src/hr-face.ts` | 生产/适配 | 135 | 现有；目标-保留（目标修订） |
| F-matrix-power-levels | `packages/matrix/src/power-levels.ts` | 生产/纯核心 | 127 | 现有；目标-保留 |
| F-matrix-provision | `packages/matrix/src/provision.ts` | 生产/供给 | 598 | 现有；**目标-拆分**（facade ≤80 + 4 子件） |
| F-matrix-test-mentions | `packages/matrix/src/mentions.test.ts` | 测试 | 316 | 仅测试；目标-保留 |
| F-matrix-test-format | `packages/matrix/src/format.test.ts` | 测试 | 77 | 仅测试；目标-保留 |
| F-matrix-test-adapter | `packages/matrix/src/adapter.test.ts` | 测试 | 376 | 仅测试；目标-保留 |
| F-matrix-test-broadcast | `packages/matrix/src/broadcast.test.ts` | 测试 | 130 | 仅测试；目标-保留 |
| F-matrix-test-hr-face | `packages/matrix/src/hr-face.test.ts` | 测试 | 169 | 仅测试；目标-保留 |
| F-matrix-test-provision | `packages/matrix/src/provision.test.ts` | 测试 | 480 | 仅测试；目标-保留 |
| F-matrix-package | `packages/matrix/package.json` | 配置 | 18 | 现有；目标-保留（元数据文字待修正） |
| F-matrix-tsconfig | `packages/matrix/tsconfig.json` | 配置 | 5 | 现有；目标-保留 |
| F-matrix-readme | `packages/matrix/README.md` | 文档性配置 | 30 | 现有；目标-替换（同路径重写内容） |

静态合计：生产源码 **9 件 / 1946 行**；测试 **6 件 / 1548 行**；配置与文档 **3 件 / 53 行**；合计 **18 件 / 3547 行**。这些数可由 `packages/matrix/src/*.ts`、`packages/matrix/package.json`、`packages/matrix/tsconfig.json`、`packages/matrix/README.md` 逐路径复算；不代表测试运行结果。

### 1.3 目标件全集与计数

| 处置 | 生产 | 测试 | 配置/文档 | 合计 |
|---|---:|---:|---:|---:|
| 目标-保留 | 8 | 6 | 2 | 16 |
| 目标-替换 | 0 | 0 | 1（README） | 1 |
| 目标-新增 | 6 | 2 | 0 | 8 |
| 目标-拆分 | 1（`provision.ts` → facade） | 0 | 0 | 1 |
| 目标-退役 | 0 | 0 | 0 | 0 |
| 目标合计 | 15 | 8 | 3 | **26** |

复算：生产 8 + 6 + 1 = 15；测试 6 + 2 = 8；配置/文档 2 + 1 = 3；行合计 16 + 1 + 8 + 1 = 26。相对现有 18 件净增 **8**（生产 +6、测试 +2）。v0.4 相对 v0.3 只增两件：`src/session.ts`（工厂，生产 +1）与其测试 `src/session.test.ts`（测试 +1），均由 80-§3.4 第 10 条的 `matrixSessionFactory` 目标态带入。

**目标树（`packages/matrix`）**：

```
src/
  index.ts                  F-matrix-index              保留
  session.ts                F-matrix-session            新增  ≤140
  errors.ts                 F-matrix-errors             新增  ≤120
  client.ts                 F-matrix-client             保留（目标修订）
  mentions.ts               F-matrix-mentions           保留
  format.ts                 F-matrix-format             保留（N/A 项显式化）
  adapter.ts                F-matrix-adapter            保留（目标修订）
  broadcast.ts              F-matrix-broadcast          保留（目标修订）
  hr-face.ts                F-matrix-hr-face            保留（目标修订）
  power-levels.ts           F-matrix-power-levels       保留
  provision.ts              F-matrix-provision          目标-拆分：薄 facade ≤80
  provision/plan.ts         F-matrix-provision-plan     新增  ≤220
  provision/ensure.ts       F-matrix-provision-ensure   新增  ≤260
  provision/ticket.ts       F-matrix-provision-ticket   新增  ≤220
  provision/face.ts         F-matrix-provision-face     新增  ≤120
  session.test.ts           F-matrix-test-session       新增  ≤200
  errors.test.ts            F-matrix-test-errors        新增  ≤180
  mentions.test.ts          F-matrix-test-mentions      保留
  format.test.ts            F-matrix-test-format        保留
  adapter.test.ts           F-matrix-test-adapter       保留
  broadcast.test.ts         F-matrix-test-broadcast     保留
  hr-face.test.ts           F-matrix-test-hr-face       保留
  provision.test.ts         F-matrix-test-provision     保留
package.json                F-matrix-package            保留（仅 description 文字）
tsconfig.json               F-matrix-tsconfig           保留
README.md                   F-matrix-readme             目标-替换
```

- 目录预算：`src` 直下 = 11 生产 + 8 测试 = **19**（阈值 25，余量 6）；`src/provision` = 4（阈值 25）。
- 文件预算：拆分后最大预算是 `client.ts` ≤520（余量 ≥80）与 `provision/ensure.ts` ≤260；没有件接近 600。
- `src/provision/*` 是**包内子目录**，不是域平面；`domainPlaneBaselines` 只覆盖 daemon 的 engine/control/evolve/assembly，本附录不新增平面基线，也不新增 `lineBaseline`（`boundary-rules.mjs:159`–`:182` 无 matrix 条目）。
- 每个新增件与每个受影响的现有件都在 §三/§四给出完整契约；不适用项写 `N/A` + 理由。

**为什么 v0.3 改判为“拆分”，与 v0.2 的“不拆”不同**：

1. **不新增公共概念**：拆分不改 `@studio-next/matrix` 的桶导出名、不改四个注入面（`InvokeSource`/`MatrixRoomFace`/`NotifyBroadcastFace`/`MatrixHrFace`）的结构签名、不改 `matrix→contract` 允许边（80-§2/§12.1）。81 禁止的是附录新增公共概念/端口/状态/允许边，不是禁止包内按子域拆文件。
2. **600 行门禁已顶死**：`provision.ts` 598 行、余量 2。目标语义（`Result`、错误分类、`note` 观测、空间身份校验）都是净增行；不先拆就只能把新逻辑塞进测试或声称“零行改动”，两者都违反 81 与 80。
3. **兼容面确定**：`provision.ts` 保留为 facade 并逐字 re-export 现有符号，`index.ts` 与现有 6 个测试文件的 import 不变；新 F-ID 按 81“拆分后新 ID 不复用”分配。
4. **新增 `errors.ts` 是去重不是扩面**：现状 `isNotFoundError`/`isForbiddenError`/`isUserExistsError`/`isAlreadyInRoomError` 分散在 `provision.ts` 与 `hr-face.ts`，判据是文本子串（`'404'`、`M_FORBIDDEN`），与 77-§11.1/80-§5.7 的分类要求冲突；集中为唯一映射表，避免两套判据漂移。
5. **不新增运行时依赖**：`errors.ts` 对 `contract` 的引用是类型 + `configInvalid` 构造器（`contract/src/schemas/errors.ts` 的运行时导出）；`matrix→contract` 边已允许、manifest 已声明；不引 `core`（层位 2，禁止）。

**v0.4：会话工厂是装配面变化，不是新公共端口**：

- 80-§3.4 第 10 条把生产装配改为 `RunServeOpts.matrixSessionFactory`：**boot 构造工厂、daemon 驱动登录**。matrix 侧对应交付一个工厂构造器（`src/session.ts`，F-matrix-session），返回 80 定义的**四个工厂/面本身 + `close()`**；`matrixSource`/`matrixRoomFace`/`hrMatrixFace` 是 thunk，`notifyBroadcast` 是面实例——**不是**已构造好的 source/room 面。
- `MatrixSessionFactory` 的类型家是 daemon 的 `apps/daemon/src/assembly/hrsync/run-serve-opts.ts`（80-§3.4 第 10 条）；matrix 只按结构同形返回，**不 import daemon**，也**不新增 `daemon→matrix` 边**（边仍只有 `["boot","matrix"]`）。
- 兼容面：现有四面直接注入保留为**测试/迁移兼容**（各自单独出现合法）；**`matrixSessionFactory` 与任一直接面同时出现 ⇒ `CONFIG_INVALID` 拒启动**——不做“是否矛盾”的比较（工厂要登录后才产出面，启动期不可判），也不得择一静默（80-§3.4 第 10 条）。

**库级未接点（不是独立文件）**：

- `createMatrixNotifier`：`adapter.ts:36` 导出，只有 `adapter.test.ts:78` 使用；`apps/boot` 不装配它，生产 notify 走 `createMatrixBroadcastFace`。目标把它升级为 `Result<NotifySendReceipt, ClassifiedError>` + 必填 `redact`，但仍**生产未接**；接线属 boot/daemon 装配，见 §9.2。
- `MatrixClient.whoami`：`client.ts:184` 导出方法；仓内无生产调用、无测试调用。目标保留（纯网络原子操作），不因未接而删除。

**目标化条目（v0.3 起是目标契约，不再是“候选”；实施顺序见 §8.3）**：

| # | 现状诊断 | 目标落点 |
|---|---|---|
| 1 | `client.setPowerLevel` 只读 `users`、只写 `users`，会抹掉 `m.room.power_levels` 的其它键 | `client.getPowerLevels` 改返全量内容（保留 number/object/null）；`setPowerLevel` 读全量→合并 `users[userId]`→整份写；`hr-face` 两处调用自动受益 |
| 2 | `adapter.poll` 的 `emit` 抛错并入退避且 `since` 已推进，可能丢整批 | `emit` 逐条 `try/catch`；`since` 只在整批 `emit` 成功后推进；失败经必填 `report`（`REC-OBS-02` 写者）上报；重放靠引擎 `intentKey` 去重 |
| 3 | `adapter.stop()` 不取消在途 `sync`，`emit` 循环不查 `running` | `AbortController` + `client.sync(..., signal)`（`FetchInit` 增 `signal?`）；循环每轮查 `running`；`stop()` abort 并清定时器 |
| 4 | `createMatrixProvisionFace` 丢弃 `note`，软退化不可观测 | `provision/face.ts` 增加注入 `report?`，把 `note`/`failures` 作为结构化观测上报；daemon 结构面仍 `Promise<void>`，缺口留在 §9.2 |
| 5 | `ensureSpace` 不校验既有房间是否真是 space | `provision/ensure` 目标：resolve 命中后读 `m.room.create` 的 `content.type === 'm.space'`，不是 space 则记 `note` 且不当空间用；**空间 PL 基线仍不自己发明**，等 78 定（§9.2-5） |
| 6 | `hr-face` 用 `M_FORBIDDEN` 文本判“已在房”，吞真权限拒绝 | 结构化判据走 `errors.ts`（`MatrixApiError.status/errcode`）；`ensureMembership` 先读 `m.room.member` 判定是否已 join，只对“已 join”跳过 invite；其它 403 一律上报 |
| 7 | `agentIdPattern` 带 `g`/`y` 会因 `lastIndex` 间歇漏判；`token.includes(':')` 不可达 | `adapter` 构造期校验 `flags` 含 `g`/`y` → `configInvalid`；删除不可达分支（行为不变） |
| 8 | `broadcast` 发送失败后自动重解析并**重发一次** | 至多一次发送：失败只入 `failed`，缓存失效留待下次调用；不自动重发（78-§11.2） |
| 9 | 通知链无出站脱敏、无 `notify-blocked` 观测 | `createMatrixNotifier`/`createMatrixBroadcastFace` 增必填 `redact: KnownSecretSet['redact']`，出站前对文本与失败 `reason` 调用；`notify-blocked` 记录归 daemon（本包不写台账） |
| 10 | `createMatrixNotifier` 仍是 `Promise<void>` | 目标 `send(channel, message): Promise<Result<NotifySendReceipt, ClassifiedError>>`；`NotificationEnvelope` 不在包内造（80-§6.6 定义在 `Notifier` 端口族；广播面 `send(message, targets)` 无 id 轴，见 §2.5/§9.2） |

以上是**设计处置**，不是已修复项；未改任何代码。

---

## 二、包级位置、依赖与导出

### 2.1 层位与允许边

事实锚：

- `scripts/guards/boundary-rules.mjs:91`：`matrix: 1`（层位 1）。
- `scripts/guards/boundary-rules.mjs:139`：`["matrix", "contract"]`。
- `scripts/guards/boundary-rules.mjs:106`：`["boot", "matrix"]`。
- `apps/boot/src/boot.ts:35`–`:44`：boot 是仓内唯一同时 import `@studio-next/daemon/serve` 与 `@studio-next/matrix` 的单元。
- `packages/matrix/package.json:15`–`:17`：只声明 `@studio-next/contract` workspace 依赖。
- `bun.lock:124`–`:130`：matrix 的 workspace 依赖只有 contract。

结论：

- `matrix` 是层位 1 的绑定/实现包，只允许依赖 `contract`；不得 import `daemon`、`boot`、`company`、`store`、`panel`、`api`、`core`、`gateway`、`localplatform`、`yt`、`taiga`、`adapters`。
- `boot → matrix` 是受准装配边；**目标态用途收窄为“构造 `matrixSessionFactory` 并交给 daemon”**——boot 自身不登录、不取 token、不存密码（80-§3.4 第 9/10 条）。`daemon` 不得 import matrix；daemon 只持有结构同形接口：`apps/daemon/src/engine/rooms/room-duty.ts:57`–`:64`（`MatrixRoomFace` + `MatrixRoomFaceContext`）、`apps/daemon/src/engine/notify/broadcast.ts:39`–`:41`（`NotifyBroadcastFace`）、`apps/daemon/src/engine/hrsync/hrsync.ts:58`–`:63`（`MatrixHrFace`），以及会话工厂形状 `MatrixSessionFactory` 与两个逻辑秘密句柄 `MatrixBotLoginSecret`/`MatrixHrRegisterSecret`（`apps/daemon/src/assembly/hrsync/run-serve-opts.ts`，80-§3.4 第 10 条；**不是** `MatrixRoomFace`）。
- 工厂返回的 `hrMatrixFace` 是 **`() => MatrixHrFace`**（daemon 侧 `MatrixHrFace` 与 matrix 包 `MatrixHrTarget` 结构同形），不是已构造面、不是 `MatrixRoomFace`；`matrixRoomFace` 才是 `(ctx) => MatrixRoomFace`。
- 20-§十五.二横向表把 `matrix` 列进了 `apps/daemon` 的允许依赖；但 `boundary-rules.mjs` 的冻结边里 Matrix 只有 `["boot", "matrix"]`（`:106`），没有 `daemon→matrix`，与 25-§一.2、80-§12.1 一致而与 20 该行不一致。按“规则文件为准”应回写 20-§十五.二，不属于本附录可改范围。

### 2.2 外部依赖与运行时

- 运行时只有 Node 24 内置能力：`node:crypto` 的 `createHmac`（`client.ts:18`）、`globalThis.fetch`、`globalThis.crypto.randomUUID`、`setTimeout`。
- 无 npm 依赖、无 Matrix SDK、无 Hono、无 SQLite、无 fs、无子进程。
- 网络出口全部经注入的 `FetchLike`（`client.ts:20`–`:30`）；`ProvisionClient` 是 `MatrixClient` 的结构子集（`provision.ts:257`–`:274`），测试可注入状态机 fake。
- 时间没有注入面：`adapter` 与 `provision` 直接用全局 `setTimeout`；测试用 vitest fake timers 或 `invitePaceMs: 0` 规避。这是 79-§3.5“时间注入”纪律的例外；目标不新增 clock 选项，只在 `stop()` 路径补 `AbortController`（取消是资源释放，不是时间注入）。
- **目标新增的仓内引用**：`errors.ts` 运行期从 `@studio-next/contract` 取 `configInvalid`（`contract/src/schemas/errors.ts` 现有运行时导出）与 `ClassifiedError` 类型；`Result` 构造器按 contract 实际导出使用，本附录不虚构导出名。这是 `matrix→contract` 既有边的运行期使用，不是新依赖；**不**从 `core` 引实现（层位 2，禁止）。`FailureClass` 的 TS 承载若 contract 未提供，按 §9.2-2（G-16）等 contract 补，本包不自定义同名类型。
- 目标依赖清单仍只有 `@studio-next/contract`；不新增 npm 依赖、不加 `node:fs`、不加 Matrix SDK、不引 `apps/*`。

### 2.3 导出与构建形态

- `package.json:7`–`:9`：`main` 与 `exports["."]` 都指向 `./src/index.ts`；没有子路径、没有 `files`、没有 `bin`、没有 `license`、没有 `engines`。
- 79-§6.5 把 `matrix` 列在“闭包之外，维持仓内，`./src/index.ts`，不发布”。因此当前不切 `dist`，不引 `paths`，不引 project references。
- 根 `tsconfig.json` 的 `include` 覆盖 `packages/*/src/**/*.ts`，matrix 的 `src` 仍在根 program 内；`tsconfig.json` 没有 `noEmit: false` 覆盖，继承 `tsconfig.base.json` 的 `noEmit: true`。
- 目标不改变上述形态。若未来把 matrix 作为对外能力包发布，按 79-§7 必须提供 JS + `.d.ts`、`files` 白名单、README/LICENSE 与许可决定；当前不写“已具备分发能力”。
- **两种接口身份必须分开写**：`createMatrixNotifier` 实现 `contract/src/ports/notifier.ts` 的 `Notifier`（`send(channel, message): Promise<void>`，单通道单条）；`createMatrixBroadcastFace` **不是** `Notifier`，它与 `apps/daemon/src/engine/notify/broadcast.ts:16`–`:41` 的 `NotifyBroadcastFace` 结构同形（`send(message, targets) → Promise<NotifySendReport>`，目标是一组逻辑频道角色）。80-§6.6 已明确“`Notifier` 与 `NotifyBroadcastFace` 不是同一个接口”：前者经 `boot` 注入但库级未接，后者是生产出站面。不得互相冒充，也不得为对齐在单侧加字段。
- **目标签名（v0.3）**：`Notifier.send(channel, message): Promise<Result<NotifySendReceipt, ClassifiedError>>`，`NotifySendReceipt = { status: 'sent'|'failed'|'skipped'; attempts: number; detail?: string }`（80-§6.6）；`NotifyBroadcastFace.send(message, targets): Promise<NotifySendReport>`，`NotifySendReport = { sent: readonly string[]; failed: readonly { target: string; reason: string }[] }`（80-§6.6，与 `apps/daemon/src/engine/notify/broadcast.ts:33`–`:36` 逐字段一致）。`Notifier` 的升级**不是本包单方面能完成**：`contract/src/ports/notifier.ts` 现仍是 `Promise<void>` 且无 `NotifySendReceipt`，属跨卷缺口（§9.2-2，G-16）；本包只写目标契约，不改 contract。
- **目标注入项（matrix 侧构造参数，全部由 boot 提供，matrix 不读 env）**：`redact: KnownSecretSet['redact']`（通知面必填）、`report: (failure: ClassifiedError) => void`（源必填，boot 接 `REC-OBS-02` 写者）、`toChannelMap: (snap: RoomFaceSnapshotLike) => ChannelMapInput`（工厂按 `ctx.snapshot` 现取）、公司/频道参数。**秘密材料不由 boot 传**：只有 daemon 在启动期传两个不同句柄——`MatrixBotLoginSecret`（`SEC-MX-BOT-PASSWORD` + `kind:'password'` + `use:'platform-auth'`）与**仅建号能力开启时**的 `MatrixHrRegisterSecret`（`SEC-MX-HR-SHARED` + `kind:'shared-secret'` + `use:'matrix-register'`）。缺 `redact`/`report`，或 `secretId`/`kind`/`use` 不符 ⇒ 构造/装配期 `configInvalid`（fail-closed）。
- **目标装配面（v0.4/v0.5）**：boot 不再注入“已构造好的四面”，而是构造 `createMatrixSessionFactory({...})` 并把工厂交给 `RunServeOpts.matrixSessionFactory`；daemon 用 `SEC-MX-BOT-PASSWORD`（`use:'platform-auth'`）构造 `MatrixBotLoginSecret`，**仅当建号能力开启**时再构造 `MatrixHrRegisterSecret`（`SEC-MX-HR-SHARED`，`use:'matrix-register'`），一并传给工厂；**登录由工厂执行，调用时机/超时/失败处置/`close()` 生命周期归 daemon**（80-§3.4 第 10 条）。建号能力开启而 `registration` 拿不到 ⇒ **拒该能力**（`CONFIG_INVALID`），不得用 bot 密码顶替。四个现有面的直接注入只保留为**测试/迁移兼容**（各自单独出现合法）；**工厂与任一直接面同时出现 ⇒ `CONFIG_INVALID`**（不比较“是否矛盾”）。

### 2.4 不做什么

- 不产 HTTP API、不装配 `api`、不写台账、不派工、不判定验收、不判定授权。
- 不读公司 git 目录，不 import `company`；供给面输入是 `ChannelMapInput` 结构快照，由 `apps/boot` 从 daemon 的 `ctx.snapshot()` 映射。
- 不把 Matrix 频道内容当授权、承诺、验收或事实源；频道内容按不可信输入处理。
- 不在本包做通知级别→频道路由、去重、惊动计量；这些在 daemon 的 `engine/notify/*` 与 `assembly/notify/*`。

### 2.5 本包显式 N/A（逐项理由）

以下是上位卷中与 matrix 相邻、但**本包不承载**的项；逐项写 `N/A` + 理由，不虚构占位，也不以笼统归并带过：

| 对象 | 出处 | 本包处置与理由 |
|---|---|---|
| `RuleEvaluator`/`RuleOutcome` | 80-§6.1、02-core | N/A：类型落 `contract`、实现落 `core/src/rule/*`（单数）；matrix 不参与规则求值，也不持有 `RuleOutcome` 四值。 |
| `FailureClass` 的 TS 定义 | 80-§5.7、01-contract | N/A：本包只**引用** contract 的类型；不自定义同名类型（G-16）。 |
| `IntakeOutcome`/`IntentKey`/`ReferralTarget`/`WorkIntake` | 76/77、02-core | N/A：matrix 只产 `InvokeIntent`，不派工、不受理、不产回执。 |
| `assembleApi`/`ProjectionName`/`RecordReader`/`TxReceipt`/`MigrationPlan`/`openLedgerReadonly` | 80-§9.4、`packages/store` | N/A：matrix 不装配 API、不写台账、不读投影；台账唯一写入者是 daemon。 |
| `PlatformBindingPort`/`BindingProfile`/`mapState`/`STAT-D` 工作族 | 80-§12.2 | N/A：matrix 是通信绑定 `BIND-EDGE-MX-01`，不是平台绑定；没有工作族状态可映射。 |
| `NotificationEnvelope`/`id`/`dedupKey` | 80-§6.6 | 部分 N/A：`NotificationEnvelope` 在 80-§6.6 定义于 `TS-PORT-NOTI-01 Notifier` 名下（“需要投递身份 + 目标时用信封”），**不出现在 `send(channel, message)` 的参数里**；广播面签名是 `send(message, targets)`，同样没有 id 轴。本包既不构造也不解析信封、不建去重表；去重归订阅方（80-§6.6 幂等条）。 |
| `titleKey`/`bodyKey` 静态消息表 | 80-§6.6 | 现状 N/A：包内没有静态消息表，`formatNotification` 直接渲染 `title`/`body`。80-§6.6 允许它**只能**作为 matrix 静态消息表的可选键且缺省必须回退 `title`/`body`；本卷不新增该表（不属目标件），将来若加须保留回退且不改 `Notification` 形状。 |
| stdio/MCP 工具面 | studio-tools 卷 | N/A：不在 matrix 包，任何工具注册都不经此包。 |
| `CONFIG_INVALID` 构造器细节 | 80-§5.7 | N/A：本包只调用 `configInvalid`，不复制字段表、不改其 `failure/category` 固定值。 |

---

## 三、生产文件逐项

### 3.0 逐件 R/E/W/V 口径（生产件；逐行对照，不用归并隐藏）

本附录不新造 R/E/W 编号（追溯归 82 与实现单）。R = 回归用例；E = 证据形态；W = 工单/实现单；V = 验证级别（V2=编译/单测级，V5=真机级）。所有 E 都是**静态读取或既有 fake 用例**，本轮没有运行证据。

| 文件 | R | E | W | V |
|---|---|---|---|---|
| `index.ts` | `apps/boot` import 与各实现测试间接覆盖 | 静态导出清单 | N/A（无独立实现） | V2 局部；V5 未证 |
| `session.ts` | `session.test.ts`（目标）；`apps/boot` 构造/形状守护 | fake fetch + fake 四面 | 本附录不立单（装配目标见 §9.2-4） | V2 目标；V5 未证（真实登录） |
| `errors.ts` | `errors.test.ts`（目标） | 静态映射表 + 目标用例 | 本附录不立单 | V2 目标；V5 N/A（纯函数） |
| `client.ts` | `adapter.test.ts`/`hr-face.test.ts`；目标 `errors.test.ts` | fake fetch 请求录像 | 本附录不立单 | V2 局部；V5 未证 |
| `mentions.ts` | `mentions.test.ts` 31 例 | 纯函数直测 | 本附录不立单 | V2；V5 未证（真实事件形状） |
| `format.ts` | `format.test.ts` 7 例 | 纯函数直测 | 本附录不立单 | V2；V5 N/A（渲染不在本包） |
| `adapter.ts` | `adapter.test.ts` 15 例；目标 emit/report/abort 用例 | fake fetch + fake timers | 本附录不立单 | V2 局部；V5 未证（长轮询） |
| `broadcast.ts` | `broadcast.test.ts` 8 例；目标不重发/脱敏用例 | 路由表 fake | 本附录不立单 | V2 局部；V5 未证（真实 alias/权限） |
| `hr-face.ts` | `hr-face.test.ts` 10 例；目标成员先读后邀用例 | 路由表 fake | 本附录不立单 | V2 局部；V5 未证（真实 Synapse） |
| `power-levels.ts` | `provision.test.ts` 间接覆盖 | 纯函数 | 本附录不立单 | V2 局部；V5 N/A（纯函数） |
| `provision.ts`（facade） | `provision.test.ts` 25 例（拆分后零断言改动） | 静态 re-export | 拆分实现单 | V2 局部；V5 未证 |
| `provision/plan.ts` | `provision.test.ts` 规划/成员用例 | 纯函数 | 拆分实现单 | V2；V5 N/A（纯函数） |
| `provision/ensure.ts` | `provision.test.ts` ensure 用例；目标非 space 识别 | `FakeSynapse` 状态机 | 拆分实现单 | V2 局部；V5 未证（空间/权限） |
| `provision/ticket.ts` | `provision.test.ts` 开单/归档用例 | `FakeSynapse` | 拆分实现单 | V2 局部；V5 未证 |
| `provision/face.ts` | `provision.test.ts` 委托用例；目标 `report` 用例 | `FakeSynapse` | 拆分实现单 | V2 局部；V5 未证 |

配置/文档：`package.json`/`tsconfig.json` 的 R 由 guards 与根 `tsc` 承担、E 为静态读取、W/V N/A（不运行）；`README.md` 的 R/E/W/V 全部 N/A（README 不是证据，79-§7.4）。

### F-matrix-index

- **路径/处置**：`packages/matrix/src/index.ts`，76 行；现有；目标-保留。
- **上位锚**：80-§2（包层语义）、79-§6.5（exports 形态）、78-§11.2（Matrix 绑定事实面）。本文件不承载新的公共概念。
- **职责**：包的唯一桶导出，固定 `@studio-next/matrix` 的 import 面；把纯核心、网络层、适配面、广播面、人事面、供给面按组再导出。
- **非职责**：不做校验、不做默认配置、不做装配、不做能力声明；不把内部 helper 一律公开；不替调用方选择 Matrix 实例或公司。
- **内部结构**：无本地类型、无常量、无函数；只有注释与 `export ... from`。分组为：
  - 纯核心：`MENTION_SOURCE_NAME`、`DEFAULT_AGENT_ID_PATTERN`、`parseMentions`、`extractRoomMessages`、`stripNonConversational`，以及 `MentionParserConfig`、`MatrixRoomMessage`、`MentionPayload`、`SyncLike` 类型；
  - 格式化：`formatNotification`；
  - 网络：`MatrixClient`，以及 `FetchLike`、`FetchInit`、`FetchResponse`、`MatrixClientOptions`、`LoginResult`、`SyncResponse`、`JoinedRoomSnapshot`；
  - 适配：`createMatrixNotifier`、`createMentionSource`，以及 `MentionSourceOptions`；
  - 广播：`createMatrixBroadcastFace`、`targetAlias`，以及 `BroadcastTargets`、`BroadcastFailure`、`BroadcastReport`、`BroadcastFaceOptions`；
  - 人事：`createMatrixHrFace`、`matrixLevelFor`，以及 `MatrixHrFaceOptions`、`MatrixHrTarget`；
  - 供给：`powerLevelTarget`、`planChannelMap`、`ensureSpace`、`ensureChannel`、`ensureCompanyChannels`、`ensureTicketRoom`、`archiveTicketRoom`、`createMatrixProvisionFace`、`mxidOf`、`serverNameOf`、`aliasLocalpart`、`ticketAliasLocalpart`、`ticketRoomName`、`resolveTicketMembers`、`ARCHIVED_PREFIX`，以及 `ProvisionPerson`、`ProvisionDept`、`ProvisionGroup`、`ChannelMapInput`、`ChannelKind`、`PowerLevelColumn`、`PowerLevelsContent`、`ChannelSpec`、`ChannelMapPlan`、`ProvisionClient`、`EnsureRoomResult`、`CompanyChannelsReport`、`ProvisionObservation`（新增，来自 `provision/face.ts`）；
  - 错误：`MatrixApiError`、`matrixApiError`、`classifyMatrixError`、`isMatrixApiError`、`isNotFound`、`isForbidden`、`isUserInUse`、`isRateLimited`（新增，来自 `errors.ts`）；
  - 装配（v0.4）：`createMatrixSessionFactory`，以及 `MatrixSessionFactoryOptions`、`MatrixSessionDeps`、`MatrixSessionHandles`（新增，来自 `session.ts`）。
- **公开面缺口（现有事实）**：`ticketRoomAliases`、`powerLevelsMatch`、`jsonEqual` 在模块内导出，但**不在**包桶里；`ticketRoomAliases` 只有 `provision.test.ts` 直接 import。`powerLevelTarget` 与相关类型经 `provision.ts` 再导出（`provision.ts:40`–`:41`），而 `provision.ts` 又从 `power-levels.ts` 再导出，形成两条同源路径；目标保留这两条路径（拆分后 facade 逐字 re-export），不收敛。
- **导出/依赖**：只从本地模块再导出；无直接 `contract` import（运行期引用集中在 `errors.ts`）。允许依赖仅本地实现文件；不得从 index 引 `node:*`、`fs`、`http` 或任何仓内其他包。
- **IO/注入**：无。
- **状态/并发**：无。
- **错误/观测**：无；模块加载失败会以 import 错误暴露。
- **测试/证据**：没有 `index.test.ts`；每个测试文件直接 import 实现文件，`apps/boot/src/boot.ts:35`–`:44` 证明 boot 实际使用的导出子集可解析。现有测试不证明“导出面完整”，也不证明未导出符号不可达。V2 级（编译/导入）局部；V5 未证。目标新增导出由 `errors.test.ts` 与 boot 的 import 面间接证明可达，仍不构成“导出面完整”证明。
- **规模/迁移**：76 行 → 目标 ≤130 行（新增三组 export 语句：错误、装配、`ProvisionObservation`），硬门禁 600 行；目录 19/25（目标）。保留所有现有导出名；新增导出限于 `errors.ts` 的 **8** 个符号（`MatrixApiError`、`matrixApiError`、`classifyMatrixError`、`isMatrixApiError`、`isNotFound`、`isForbidden`、`isUserInUse`、`isRateLimited`）、`ProvisionObservation` 与 `session.ts` 的 4 个符号（`createMatrixSessionFactory`、`MatrixSessionFactoryOptions`、`MatrixSessionDeps`、`MatrixSessionHandles`），且必须有实际消费者（boot 或测试）；删除/改名须先给调用方清单。`provision.ts` 拆分后桶导出逐行不变，`powerLevelTarget` 的两条同源路径也保留。

### F-matrix-session

- **路径/处置**：`packages/matrix/src/session.ts`，**新增**，目标 ≤140 行；目标-新增（F-ID 新分配）。v0.4 由 80-§3.4 第 10 条的 `RunServeOpts.matrixSessionFactory` 带入；**本附录只给契约，未实现**。
- **上位锚**：80-§3.4 第 10 条（`MatrixSessionFactory` 的形状、两个逻辑秘密句柄与“boot 构造、daemon 驱动登录”）、§3.3 第 6 步（装配顺序：先秘密面再会话面）、§11.2.1（`SecretProvider`/`SecretMaterial`/`KnownSecretSet`、空值与轮换重建语义）、§12.1（四个注入面）；78-§7.4.1（`SEC-MX-BOT-PASSWORD` 的 `allowedUses` 上限；`SEC-MX-HR-SHARED` 只 `matrix-register`+`outbound-redaction`）、§11.2（`BIND-EDGE-MX-01`）；79-§3.4（边界错误分类）。
- **职责**：导出 `createMatrixSessionFactory(options)`，返回一个**部署工厂**：`(deps) => Promise<MatrixSessionHandles>`。工厂内部完成 **login**（用 daemon 传入的 `MatrixBotLoginSecret`，`use==='platform-auth'`），用同一 `MatrixClient` 组装 80 要求的四项——`matrixSource: () => InvokeSource`、`matrixRoomFace: (ctx: MatrixRoomFaceContext) => MatrixRoomFace`、`hrMatrixFace: () => MatrixHrFace`、`notifyBroadcast: NotifyBroadcastFace`——外加 `close()`。**四项是工厂/thunk 或面实例本身，不是已构造好的 source/room 面**。
- **非职责**：不读 env、不建 `SecretProvider`、不选 catalog、不落盘、不把 token 取到工厂外；不装配 daemon、不改四个结构面签名、不新增 `daemon→matrix` 边；不决定登录时机/超时/失败处置策略（归 daemon）；不决定“建号能力是否开启”（归配置面）；不做通知路由、去重、计量；不决定公司/岗位事实。
- **内部结构**：
  - `MatrixSessionFactoryOptions`（boot 侧构造参数，v0.4 目标；**不含任何秘密值**）：`company`、`rooms?`、`roles?`、`pollIntervalMs?`、`syncTimeoutMs?`、`maxBackoffMs?`、`agentIdPattern?`、`deptSlugs`、`toChannelMap: (snap: RoomFaceSnapshotLike) => ChannelMapInput`（boot 现成的快照→频道地图映射，照搬 `assembleMatrixProvisionFace` 内的那段，不新建第二套）、`memberPowerLevel?`、`redact: KnownSecretSet['redact']`、`report: (failure: ClassifiedError) => void`、`log?`。`RoomFaceSnapshotLike` 是本地结构类型（`slug`/`name`/`departments`/`people`/`groups?`），与 daemon 的 `RoomFaceSnapshotInput` 结构同形，**不 import daemon**。
  - `MatrixSessionDeps`（daemon 侧入参，与 80-§3.4 第 10 条**逐字段同形**，本包不 import daemon）：`homeserverUrl`、`botUserId`、`login: { kind: 'password'; secretId: 'SEC-MX-BOT-PASSWORD'; use: 'platform-auth'; material: SecretMaterial }`、`registration?: { kind: 'shared-secret'; secretId: 'SEC-MX-HR-SHARED'; use: 'matrix-register'; material: SecretMaterial }`、`userAgent?`。两个句柄判别位写死、**不可互换**：bot 密码不得用于建号，HR 共享秘密不得用于登录。
  - `MatrixSessionHandles`（返回值）：`matrixSource: () => InvokeSource`；`matrixRoomFace: (ctx: MatrixRoomFaceContext) => MatrixRoomFace`；`hrMatrixFace: () => MatrixHrFace`；`notifyBroadcast: NotifyBroadcastFace`；`close(): Promise<void>`。`MatrixRoomFaceContext`/`MatrixRoomFace`/`MatrixHrFace`/`InvokeSource`/`NotifyBroadcastFace` 全按本地结构类型声明（与 daemon 侧同名接口结构同形），**不是** `import type` 自 `apps/daemon`。
  - 构造流程：① 校验 `login.kind === 'password'`、`login.secretId === 'SEC-MX-BOT-PASSWORD'`、`login.use === 'platform-auth'`、`login.material.kind === 'password'`、`login.material.secretId === 'SEC-MX-BOT-PASSWORD'`；② `registration` 存在时同样逐槽校验 `kind === 'shared-secret'`、`secretId === 'SEC-MX-HR-SHARED'`、`use === 'matrix-register'`、`material.kind`/`material.secretId` 同值；③ `new MatrixClient({ baseUrl: deps.homeserverUrl })` → `client.login(deps.botUserId, deps.login.material)`（token 只落实例）→ 依次构造 `createMentionSource`/`createMatrixProvisionFace`/`createMatrixHrFace`/`createMatrixBroadcastFace`。**建号能力开启而 `registration` 缺失** ⇒ 构造期 `configInvalid('matrix-session-registration-missing')`，拒该能力、不构造“半个面”；建号能力关闭时不得要求 `registration`，也不得因它存在而启用建号。
  - thunk 语义：`matrixSource()` 首次调用才建源并缓存同一实例（避免重复轮询）；`matrixRoomFace(ctx)` 每次调用用 `ctx.snapshot` 经 `options.toChannelMap` 现取 `ChannelMapInput` 再建面（**不是**缓存快照，热重载后下一拍即新鲜）；`hrMatrixFace()` 返回同一面实例；`notifyBroadcast` 是面实例（80 形状如此，不是 thunk）。
  - `close()`：`stop()` 已启动的 source、`client.logout()`（尽力而为，失败只经 `report` 上报不抛）、置 `closed` 幂等。调用顺序由 daemon 保证（先于 `ledger.close`，80-§3.4 第 10 条）。
- **导出/依赖**：导出 `createMatrixSessionFactory`、`MatrixSessionFactoryOptions`、`MatrixSessionDeps`、`MatrixSessionHandles`。**不导出与 daemon 同名的 `MatrixSessionFactory` 类型**（避免同名异义）。依赖本包 `client`/`mentions`/`adapter`/`provision`/`hr-face`/`broadcast`/`errors` 与 `contract` 的类型/`configInvalid`；不 import `apps/*`。
- **IO/注入**：网络经 `MatrixClient`（内部 `FetchLike`）；无 fs/SQLite/子进程；无 env；时间用全局 `setTimeout`（沿用 `invitePaceMs`/轮询节奏）；`redact`/`report`/`toChannelMap`/`log` 全注入。
- **状态/并发**：每次工厂调用建立独立会话；生产路径只调一次（daemon 负责），本层不防重入但 `close()` 幂等；`closed` 后 thunk 调用抛 `configInvalid('matrix-session-closed')`，不再发请求。
- **错误/秘密**：`kind`/`secretId`/`use` 或 `material.kind`/`material.secretId` 不符 → `configInvalid`（`CONFIG_INVALID`，不降级、不换条目、不猜 env，**不允许把一个句柄的值塞进另一个槽位**）；建号开启而 `registration` 缺失 → `configInvalid` 且只拒该能力。空值（空串/零字节）**不应到达工厂**——`SecretProvider` 已返回 `Err(rejected_precondition, subcause:'secret-empty')` 且不返回材料（80-§11.2.1）；若仍到达，工厂按 `configInvalid` 拒绝（装配侧二道闸）。登录失败按 `errors.ts` 归一（`matrix-auth`/`matrix-network` 等），由 daemon 按 **`platform-auth`** 归因；明文只出现在 `material.value`，不写入日志/快照/返回对象/`Error.message`/任务书/PRM；**会话 access token 只在 `MatrixClient` 实例内存**，无静态 `secretId`、不进 stdio/JSON-RPC 帧。
- **测试/证据**：目标 `session.test.ts`（见 §4）。本附录未写、未跑；不允许用真实 homeserver 冒充 V2。
- **规模/迁移**：≤140 行；`src` 直下 11 生产 + 8 测试 = 19/25。迁移顺序：先落 `session.ts` 与结构类型（无消费者）→ boot 改为构造工厂 → daemon 补 `RunServeOpts.matrixSessionFactory`、两个秘密句柄与登录驱动 → 最后才切换生产路径；四面直接注入在此期间保留（80-§3.4 第 10 条兼容面，与工厂同时出现即拒启动）。

### F-matrix-client

- **路径/处置**：`packages/matrix/src/client.ts`，465 行；现有；目标-保留（目标修订：结构化错误、`SecretMaterial`、`signal`、PL 全量合并）。
- **上位锚**：78-§11.2 `BIND-EDGE-MX-01` 的“实现事实”、78-§7.4.1（Matrix 两条秘密的 `secretId`/`allowedUses`/取值通道）；80-§11.2/§11.2.1（秘密供给、`KnownSecretSet`、强制脱敏出口）；21A-§2.3（shared-secret 注册）、§2.4（空间/别名）、§5.7（E2EE 不开）、§5.9（localpart 小写）、§5.10（dedupKey 源侧）；25-§3.4/§4.2（端口语义）。本文件是实现件，不是公共端口，不申请新的端口 ID。
- **职责**：Matrix Client-Server API 的最小薄网络层；用注入 `FetchLike` 发请求；只建模消费到的响应字段；把非 2xx 统一成带状态/errcode 的 `Error`；429 时按 `retry_after_ms` 礼让重试一次；token 只留实例内存。
- **非职责**：不做 E2EE、不做 token 持久化、不做 alias→room 的语义选择、不做业务幂等（ensure-shape 在 `hr-face`/`provision`）、不做路由/去重/计量、不做通知级别判断、不做权限模型、不做请求超时/取消、不做重试预算、不做 secret 扫描。
- **内部结构**：
  - 类型：`FetchLike(url, init) → Promise<FetchResponse>`；`FetchInit` 只有 `method/headers/body`（无 `signal`）；`FetchResponse` 只有 `ok/status/json()`；`MatrixClientOptions { baseUrl, fetch?, accessToken? }`；`LoginResult { userId, accessToken, deviceId? }`；`SyncResponse { next_batch, rooms?.join? }`；`JoinedRoomSnapshot { timeline?.events?, limited? }`。
  - 类字段：`baseUrl`（去掉尾部 `/`）、`fetchLike`（缺省包装 `globalThis.fetch`）、`accessToken`、`loggedInUserId`；只读 getter `userId`。
  - 方法及输入输出：
    - `login(userId, password)`：`POST /_matrix/client/v3/login`，体为 `m.login.password` + `m.id.user`；响应必须有字符串 `user_id`、`access_token`；`device_id` 可选；成功后写实例 token 与 userId；返回 `LoginResult`。
    - `sendMessage(roomId, text, { mentionedUserIds? })`：`PUT /rooms/{roomId}/send/m.room.message/{txnId}`；`txnId = sn-${randomUUID}`；体固定 `msgtype: m.text`、`body: text`、`m.mentions` 恒存在（有非空 `mentionedUserIds` 时 `{user_ids:[...]}`，否则 `{}`）；响应必须有 `event_id`；返回 `{eventId}`。
    - `sync(since?, timeoutMs = 0)`：`GET /_matrix/client/v3/sync`；query 恒有 `timeout`，`since` 存在才加；响应必须有字符串 `next_batch`；其余字段原样返回但类型只声明消费字段。
    - `registerWithSharedSecret({ username, password, sharedSecret, admin? })`：先 `GET /_synapse/admin/v1/register` 取一次性 `nonce`，本地 `HMAC-SHA1(sharedSecret, nonce\0username\0password\0{admin|notadmin})` 取小写 hex，再 `POST` `{nonce, username, password, mac}`；`admin === true` 才加 `admin: true`；响应必须有 `user_id`、`access_token`。
    - `whoami()`：`GET /account/whoami`；响应必须有 `user_id`；返回 `{userId}`。
    - `setDisplayName(userId, name, token?)`：`PUT /profile/{userId}/displayname`；可传一次性 token 覆写实例 token；体 `{displayname:name}`；无返回。
    - `getDisplayName(userId)`：`GET /profile/{userId}/displayname`；不要求登录；`displayname` 不是字符串时返回 `null`。
    - `logout(token?)`：`POST /logout`；可覆写 token；体 `{}`；无返回。
    - `createRoom({ name, aliasName?, visibility?, preset?, initialState?, creationContent? })`：`POST /createRoom`；`initial_state` 每项映射为 `{type, state_key: stateKey ?? '', content}`；`creation_content` 浅拷贝；响应必须有 `room_id`。
    - `resolveAlias(alias)`：`GET /directory/room/{encodeURIComponent(alias)}`；响应必须有 `room_id`；404 以普通 `Error` 抛出，由调用方按 `M_NOT_FOUND/404` 文本识别。
    - `invite(roomId, userId)`、`joinRoom(roomIdOrAlias)`、`kick(roomId, userId, reason?)`：对应 `invite`/`join`/`kick` 端点；`reason` 可选；无返回。
    - `getPowerLevels(roomId)`：`GET /rooms/{roomId}/state/m.room.power_levels`；只投影 `users` 中的数值项，返回 `{users: Record<string, number>}`；**不保留** `events_default/state_default/invite/kick/ban/redact/events` 等字段。
    - `setPowerLevel(roomId, userId, level)`：先 `getPowerLevels`，改 `users[userId]`，再 `PUT m.room.power_levels`，请求体就是 `{users}`。Matrix 的 state PUT 是整份内容替换，因此该写法会**抹掉**房间原有 PL 的其它键。注释说“全量 state”，但读面只拿到 users；这是一个实现缺口。
    - `sendStateEvent(roomId, type, stateKey, content)`：`PUT /rooms/{roomId}/state/{type}/{stateKey}`；同值重写无害，幂等收敛归调用方。
    - `getStateEvent(roomId, type, stateKey)`：`GET` 同一路径；返回 `Record<string, unknown>`；无此 state 时抛错，调用方按缺省即写处理。
    - `listMembers(roomId, membership)`：`GET /rooms/{roomId}/members?membership=...`；只收集 `type === m.room.member` 且 `state_key` 为字符串的项；不处理分页（无 `at`/`from`/`limit`）。
    - `getFullPowerLevels(roomId)`：`GET m.room.power_levels` 全内容；只保留 number/object/null 值，字符串/布尔等被丢弃；用于供给器的“同值零写”比较。
  - 私有 `request(method, path, {body?, auth?, query?, token?})`：用 `new URL(baseUrl + path)` 拼 URL；query 逐项 set；`auth: true` 时取 `init.token ?? accessToken`，缺失直接抛“未登录”；有 body 时设 `Content-Type: application/json` 并 `JSON.stringify`；循环最多两轮：成功返回 `res.json()`；非 2xx 先读一次错误体，429 且首轮则按 `clampRetryAfterMs` 等待后重试，其它情况抛 `apiErrorFrom`。
  - 辅助函数：`readErrorBody`（防御性读 JSON，失败返回空对象）；`clampRetryAfterMs`（缺省 2000ms、负数按 0、上限 30000ms）；`sleep`（定时器 `unref`，等待期不阻止进程退出）；`apiErrorFrom`（拼 `matrix api <status> <method> <path> <errcode>: <error>`）；`defaultFetch`（调用时读 `globalThis.fetch`）。
- **导出/依赖**：导出上述类型、`MatrixClient`；不导出辅助函数。依赖 `node:crypto` 的 `createHmac`；使用全局 `fetch`、`crypto.randomUUID`、`setTimeout`；不 import `contract`。允许边：本文件无仓内依赖；不得引其它包。
- **IO/注入**：网络经 `FetchLike`；无 fs/SQLite/子进程/信号；时间只有 429 的 `setTimeout`；ID 只有 `sendMessage` 的随机 txnId；token 经构造参数或 `login` 注入；测试注入 fake fetch。
- **状态/事务/幂等/并发**：
  - 状态：实例内 `accessToken`、`loggedInUserId`；无持久化，重启重登；无 token 刷新、无设备管理。
  - 事务：无；每个 HTTP 请求独立；不保证跨请求原子。
  - 幂等：`sendMessage` 的 `txnId` 只在**单次调用**内固定；429 的内部重试复用同一 txnId；调用方再次调用会生成新 txnId，因此 Matrix 侧可能收到重复消息。`invite`/`join`/`setState` 的幂等性依赖服务端与调用方。
  - 并发：同一实例可并发请求，共享 token；无请求队列/限流器；429 礼让是每请求一次，不构成全局速率限制。
  - 超时/取消：没有 `AbortSignal`、没有客户端超时；`sync` 的 25s 是服务端长轮询参数，不是客户端超时；`stop()` 不能取消在途 `sync`。
  - 恢复：网络失败直接抛出；无自动重试（429 除外）；无断点；`sync` 的 `since` 由调用方保存。
- **错误/观测**：
  - 返回形状：成功返回投影对象；失败抛 `Error`。
  - 错误分类：只有 HTTP status + errcode/error 文本；没有 79-§3.4 目标的 `category/subcause`；调用方（daemon）只能按文本或异常面处理。
  - 未知/部分成功：无“未知回执”类型；响应缺字段时抛“响应缺 …”；不理解 2xx 但缺字段的服务端变体。
  - 秘密/日志：本文件不日志。`password` 只进 login/register 请求体，`sharedSecret` 只在 HMAC 计算里用，`accessToken` 只出现在 `Authorization: Bearer` 与构造函数/`login` 结果；三者都不被拼进任何错误消息。`apiErrorFrom` 会把服务端 `errcode`/`error` 文本与请求 path 原样带出（Path 不含凭据；`sync` 的 `since` 不是秘密），因此 `Error.message` **属于出站面**：下游落日志/报告/通知前必须过 `KnownSecretSet.redact`（80-§11.2.1：`find` 判 → `redact` 改 → 才出站），本文件不内置扫描器，也不得被当作脱敏点。token 不落盘（78-§11.2 的既定损失：重启重登）。
- **测试/证据**：
  - `adapter.test.ts` 覆盖 `login`、`sendMessage`（含 `m.mentions`）、`sync`、429 的四条路径（有/无 `retry_after_ms`、上限封顶、二次 429）、非 429 直抛、未登录直抛、响应缺 `next_batch`。
  - `hr-face.test.ts` 覆盖 `registerWithSharedSecret` 的 mac 独立复算、`setDisplayName` 的 token 覆写、`getDisplayName`、`logout`、`getPowerLevels`/`setPowerLevel` 的调用路径。
  - `provision.test.ts` **不经过** `MatrixClient`，而是注入 `FakeSynapse` 实现 `ProvisionClient`；因此 `createRoom`/`resolveAlias`/`joinRoom`/`invite`/`listMembers`/`getFullPowerLevels`/`sendStateEvent`/`getStateEvent` 的 HTTP 编码、状态码与错误体解析只被间接覆盖，真实请求形状未证。
  - `whoami` 无测试；非 JSON 错误体、连接中断、超时、分页、并发、真实 Synapse 均未证。
- **目标修订（v0.3：覆盖上文与之冲突的“现有”描述；未实施）**：
  - **错误模型**：`request` 失败统一抛 `MatrixApiError extends Error`（字段与 `ClassifiedError` 同形：`{ status: number; errcode?: string; retryAfterMs?: number; failure: FailureClass; category: ErrorCategory; subcause: string; detail?: string }`；`implements` 依赖 contract 先补类型，见 §9.2-2）。本文件**继续 throw**（四个注入面的结构签名跨包，不在本包私改），由 `errors.ts` 的 `classifyMatrixError` 与调用方收敛成 `Result`。`category` 只取 80-§5.7 的 11 值；`failure` 取 77-§11.1 十四类。
  - **判据结构化（删除文本匹配）**：`404 → status === 404`；`M_FORBIDDEN → errcode === 'M_FORBIDDEN'`；`M_USER_IN_USE → errcode`；`M_LIMIT_EXCEEDED → status === 429 || errcode`；`M_NOT_FOUND → status === 404 || errcode`。`resolveAlias` 仍抛，但错误带 `status/errcode`，调用方用 `isNotFound`，不再 `includes('404')`。
  - **取消**：`FetchInit` 增 `signal?: AbortSignal`；`sync(since?, timeoutMs?, signal?)` 透传；`AbortError` 归一为 `{ failure: 'cancelled', category: 'STALL', subcause: 'aborted' }`，不重试、不吞。不加客户端超时（25s 仍是服务端长轮询参数）。
  - **秘密供给**：`login(userId, password: SecretMaterial)`（`password.secretId` 必须是 `SEC-MX-BOT-PASSWORD`、`kind` 必须是 `password`）、`registerWithSharedSecret({ username, password: string, registrationSecret: SecretMaterial, admin? })`（`registrationSecret.secretId` 必须是 `SEC-MX-HR-SHARED`、`kind` 必须是 `shared-secret`；`password` 是逐人员工密码，不在 catalog，仍为普通字符串、一次性透传）。两个 `SecretMaterial` 都校验 `typeof value === 'string'` 且非空（空串/零字节按 `secret-empty` 拒，80-§11.2.1），不符 `configInvalid`；`value` 只进请求体/HMAC，不落实例字段、不进错误/日志。`SecretMaterial` 类型按 80-§11.2.1 落 `contract/src/ports/secret.ts`（**目标路径**：仓内当前无此文件，`secret.ts` 与 `SecretProvider`/`KnownSecretSet` 都还是 80 的目标态，见 §9.2-2/§9.2-10）。
  - **PL 保留**：`getPowerLevels(roomId)` 改返全量 `Record<string, unknown>`（只保留 number/object/null，与 `getFullPowerLevels` 同口径，可委托后者）；`setPowerLevel(roomId, userId, level)` 读全量 → `{ ...current, users: { ...current.users, [userId]: level } }` → 整份写。方法名与参数不变，调用的 `hr-face` 自动受益。
  - **txnId**：保持 `sn-<uuid>`，429 内部重试复用同一 txnId（现状已如此）；明确“调用方重放不得复用 txnId，去重由引擎 `intentKey`/`notificationId` 负责”，本文件不造去重键。
  - **响应缺字段**：2xx 但形状不符属 `failure:'unverified'` + `category:'EXTERNAL_REJECT'` + `subcause:'response-shape'`（`Err` 的 6 个可达 category 里，外部面只剩 `EXTERNAL_REJECT`；若 80-§5.7 后续给出更贴切映射，以 80 为准）；`detail` 只写缺失字段名，不写字段值。
  - **不变量**：不引第二套秘密扫描、不写 fs、不读 env、不 import `apps/*`；`whoami` 保留（纯原子操作，未接不是删除理由）。
- **规模/迁移**：465 行 → 目标 ≤520 行（余量 ≥80），600 行硬门禁；不得为提高覆盖率把大段端点测试塞进本文件。保留全部公开方法名与参数形状。若未来新增端点再次逼近 600，按端点族拆为 `src/client/transport.ts`、`src/client/core.ts`、`src/client/admin.ts`、`src/client/room.ts`，以薄 facade 保留 `MatrixClient` 导出；该拆分仍是**条件方案、不计入目标件**（本附录只把 `provision.ts` 拆分为目标）。

### F-matrix-errors

- **路径/处置**：`packages/matrix/src/errors.ts`，**新增**，目标 ≤120 行；目标-新增（F-ID 新分配，不复用）。
- **上位锚**：80-§5.7（`ClassifiedError = { failure, category, subcause, detail? }`；`Err` 可达 6 个 category；`failure→category` 缺省表；构造期非法抛 `ClassifiedError`）；77-§11.1（十四类失败语义：是否可重试/副作用/必须附）；79-§3.4（边界错误分类）；78-§11.2（未知回执记录、不自动重发）；81-§二（每件必须给完整契约）。
- **职责**：Matrix 外部故障 → `ClassifiedError` 的**唯一映射表**与 `MatrixApiError` 载体；把 `client.ts` 抛出的异常归一成 `{ failure, category, subcause, detail? }`，让 `client`/`hr-face`/`adapter`/`broadcast` 共用一套结构化判据（`isNotFound`/`isForbidden`/`isUserInUse`/`isRateLimited`），彻底删除 `includes('404')`/`includes('M_FORBIDDEN')` 文本匹配。
- **非职责**：不决定业务处置（重试/升级/回滚/是否派工）、不写日志/台账/事件、不做脱敏（归 `KnownSecretSet.redact`）、不定义 `FailureClass`/`ErrorCategory`/`Result`（contract 承载，80-§5.7）、不复制 80 的整张 `failure→category` 缺省表、不抛未分类普通 `Error`、不读 env/时间/随机。
- **内部类型与函数**：
  - `class MatrixApiError extends Error`：字段与 80-§5.7 的 `ClassifiedError` **同形**——`status: number`、`errcode?: string`、`retryAfterMs?: number`、`failure: FailureClass`、`category: ErrorCategory`、`subcause: string`、`detail?: string`；`name = 'MatrixApiError'`；不携带响应体、不携带请求体。是否写 `implements ClassifiedError` 取决于 contract 是否导出该类型；当前 contract 缺 `failure`/`FailureClass`（§9.2-2），所以在 contract 升级前只声明字段，不引用不存在的类型名。
  - `matrixApiError(args: { method, path, status, errcode?, retryAfterMs?, kind? }) → MatrixApiError`：单一构造入口；`kind` 只用于覆盖缺省映射（如调用方已知是 2xx 形状错误）。
  - `classifyMatrixError(e: unknown) → ClassifiedError`：`MatrixApiError` 原样取字段；`AbortError` → `cancelled/STALL/aborted`；`TypeError`/fetch reject → `unavailable/STALL/matrix-network`；其它 → `unavailable/STALL/matrix-unknown`。**永不抛**。
  - 判据（全部结构化，只读 `status`/`errcode`）：`isMatrixApiError(e)`；`isNotFound(e)`（`status===404 || errcode==='M_NOT_FOUND'`）；`isForbidden(e)`（`status===403 || errcode==='M_FORBIDDEN'`）；`isUserInUse(e)`（`errcode==='M_USER_IN_USE'`，兼 `status===409`）；`isRateLimited(e)`（`status===429 || errcode==='M_LIMIT_EXCEEDED'`）。**不提供** `isAlreadyInRoom`：Matrix 无独立 errcode，判“已在房”必须读 `m.room.member`（见 `hr-face`）。
  - 映射表（本包唯一来源；404 不构造 `Err`，因为“不存在”是对账输入，不是拒绝）：

    | 条件 | `failure` | `category` | `subcause` |
    |---|---|---|---|
    | 401 / `M_UNKNOWN_TOKEN` / `M_MISSING_TOKEN` | `rejected_authority` | `EXTERNAL_REJECT` | `matrix-auth` |
    | 403 / `M_FORBIDDEN` | `rejected_forbidden` | `EXTERNAL_REJECT` | `matrix-forbidden` |
    | 404 / `M_NOT_FOUND` | **不分类**（调用方走 `isNotFound` 分支） | — | — |
    | 409 / `M_USER_IN_USE` | `rejected_state` | `EXTERNAL_REJECT` | `matrix-user-exists` |
    | 429 且礼让重试耗尽 | `unavailable` | `STALL` | `matrix-rate-limited` |
    | 5xx | `unavailable` | `STALL` | `matrix-server` |
    | 网络失败（fetch reject / `TypeError`） | `unavailable` | `STALL` | `matrix-network` |
    | `AbortError` | `cancelled` | `STALL` | `aborted` |
    | 2xx 但响应缺必需字段 | `unverified` | `EXTERNAL_REJECT` | `response-shape` |
    | 其它 4xx（`M_BAD_JSON` 等） | `rejected_precondition` | `EXTERNAL_REJECT` | `matrix-bad-request` |

- **导出/依赖**：导出上列 8 个符号（`MatrixApiError`、`matrixApiError`、`classifyMatrixError`、`isMatrixApiError`、`isNotFound`、`isForbidden`、`isUserInUse`、`isRateLimited`）。类型从 `@studio-next/contract` 引 `ClassifiedError`/`FailureClass`/`ErrorCategory`；值只引 `configInvalid`（构造期注入缺失用，固定 `rejected_precondition` + `CONFIG_INVALID`）；不引 `core`/`apps/*`。
- **IO/注入**：纯函数与错误类，零 IO；不读时间/随机/env/网络。
- **状态/并发**：无状态；`MatrixApiError` 不可变字段，可跨异步边界传递。
- **错误/秘密**：本文件是错误构造点，自身只抛 `MatrixApiError` 或 `configInvalid`；`detail` 白名单 = `method`、`path`（不含 `Authorization`）、`status`、`errcode`、缺失字段名；**不**写服务端 `error` 文本、不写请求体、不写 password/nonce/mac/token/secretId 的值。脱敏不在本文件：出站前仍由 `KnownSecretSet.redact` 处理（80-§11.2.1）。
- **测试/证据**：新增 `errors.test.ts`（见 §四）。本附录未运行；映射表每行至少一正一反例，`detail` 不含敏感值的断言是目标。
- **规模/迁移**：≤120 行；目标 `src` 直下 **19/25**（11 生产 + 8 测试，本文件是其中一件）。迁移顺序：先建本文件（无消费者）→ `client.ts` 改用 `matrixApiError` → `provision.ts`/`hr-face.ts` 删除本地判据 → 最后才允许新语义（`Result`/脱敏）落地。

### F-matrix-mentions

- **路径/处置**：`packages/matrix/src/mentions.ts`，240 行；现有；目标-保留。
- **上位锚**：21-§四（@唤醒与 ③ 混合语义）、22-§一（源只产意图）、25-§3.4（invoke 端口与 dedupKey）、78-§11.2（入站语义）、80-§6.8（`InvokeSource` 保留）。`InvokeIntent`/`InvokeSource` 由 `contract/src/ports/invoke.ts` 定义，不在本文件重定义。
- **职责**：把一条归一化的 Matrix 房间消息投影为零或多条 `InvokeIntent(kind='mention')`；两路互补识别（正文 @词元、`m.mentions.user_ids`）；防误报清洗；同消息同目标去重；源侧设置 `dedupKey = eventId`。
- **非职责**：不轮询、不选房间、不解析 alias、不判断发送者身份、不做引擎级幂等、不决定是否派工、不处理 E2EE/编辑/线程/富文本、不验证角色词映射的公司归属。
- **内部结构**：
  - 常量：`MENTION_SOURCE_NAME = 'matrix'`；`DEFAULT_AGENT_ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/`（要求至少一个连字符段，排除 `@TODO`/`@NOTE` 类普通大写词）。
  - 类型：`MentionParserConfig { company, roles?, agentIdPattern?, selfUserId? }`；`MatrixRoomMessage { eventId, roomId, sender, roomAlias?, msgtype?, body, mentions?: { userIds?: string[] } }`；`MentionPayload { target, mention, text, eventId, sender, room, channel }`；`SyncLike { next_batch?, rooms?.join? }`（纯层不 import 网络层）。
  - 正则：`MENTION_TOKEN = /@([A-Za-z\u4e00-\u9fff][0-9A-Za-z_\-\u4e00-\u9fff]*)/gu`（`@` 后首字符为 ASCII 字母或 CJK 基本区，后续可含数字/下划线/连字符/CJK）；`WORD_INFIX = /[0-9A-Za-z_-]/`（`@` 前紧贴这些字符则不算唤起，用于排除邮箱）。
  - `stripNonConversational(body) → string`：逐行扫描；`trimStart()` 后以三反引号或 `~~~` 开头则切换围栏并丢弃该行；围栏内丢弃；引用行（`trimStart()` 后以 `>` 开头）丢弃；其余保留原行；最后再删除跨行的三反引号段和单反引号行内代码段，替换为空格。方向保守：宁可漏报，不可误报。
  - `localpartOf(mxid) → string | undefined`（私有）：匹配 `^@([^:]+):`，返回 localpart 原文，不改变大小写。
  - `extractRoomMessages(sync) → MatrixRoomMessage[]`：只遍历 `sync.rooms.join`；每个房间只取 `timeline.events`；事件必须是对象、`type === 'm.room.message'`、`event_id` 与 `sender` 为字符串、`content.body` 为字符串；`content.msgtype` 为字符串才带上；`content['m.mentions']` 是对象且 `user_ids` 是字符串数组时投影为 `{userIds}`，形状不符整段丢弃；**不产出 `roomAlias`**，不保留 `origin_server_ts`，不处理 `m.room.encrypted`、编辑（`m.replace`）、线程关系或 redaction。
  - `parseMentions(message, config) → InvokeIntent[]`：
    1. 若 `msgtype` 存在且不是 `m.text`，直接返回空（`m.notice`/`m.image` 等不唤起；未标 msgtype 视为文本）。
    2. 取 `agentIdPattern`（缺省默认）与 `roles`；清洗正文；`channel = roomAlias ?? roomId`。
    3. 建 `seen` 集合与 `intents` 数组；`resolveToken(token)` 先查 `roles[token]`，再 `pattern.test(token)`，命中返回 token 本身。
    4. `push(target, mention)` 按 target 去重；构造 `MentionPayload`，其中 `text` 是原始 `body`（未清洗），`room` 是 roomId，`channel` 是 `roomAlias ?? roomId`；意图固定 `kind:'mention'`、`company`、`source:'matrix'`、`dedupKey: message.eventId`。
    5. 路 1：对清洗后的正文 `matchAll(MENTION_TOKEN)`；若 `@` 前一个字符匹配 `WORD_INFIX` 则跳过；`token.includes(':')` 时截取 `:` 前段，但由于 `MENTION_TOKEN` 的字符类不含 `:`，该分支在现有正则下不可达；完整 MXID 仍因 token 已停在 `:` 前而按 localpart 解析。命中后 `push(target, '@' + bareToken)`。
    6. 路 2：遍历 `message.mentions.userIds`；跳过 `selfUserId`（bot 被提及=对网关说话）与 `message.sender`（自提不算）；取 localpart；先按原文 `resolveToken`，再按 `toUpperCase()` 试一次（覆盖 localpart 小写、工号大写的默认约定）；命中后 `push(target, '@' + target)`（用规范化 target，不用原 MXID）。
  - 输出顺序：正文词元按首次出现顺序；结构化提及补在其后；两路同一目标由 `seen` 去重。
- **导出/依赖**：导出 `MENTION_SOURCE_NAME`、`DEFAULT_AGENT_ID_PATTERN`、`parseMentions`、`extractRoomMessages`、`stripNonConversational`，以及 `MentionParserConfig`、`MatrixRoomMessage`、`MentionPayload`、`SyncLike`。依赖 `contract` 的 `CompanySlug`、`PersonId`、`InvokeIntent` 类型（`mentions.ts:27`）；零运行时依赖。
- **IO/注入**：纯函数，零 IO；`company`/`roles`/`agentIdPattern`/`selfUserId` 全由参数注入；不读时间、不生成随机、不读 env。
- **状态/事务/幂等/并发**：无状态。`dedupKey` 是源侧幂等材料；同一消息多目标会得到多条同 `dedupKey` 意图，矩阵包不做“一次@一人”的折叠，折叠归引擎（测试 `mentions.test.ts:218`–`:222` 只断言同 key，不证明引擎行为）。无并发共享状态；`agentIdPattern` 若带 `g`/`y`，`RegExp.test` 的 `lastIndex` 会在调用之间残留，导致间歇性漏判，这是调用方输入约束，当前未校验。
- **错误/观测**：正常路径不抛错；自定义正则可抛 `SyntaxError`（构造时）；超长正文没有上限；不记录日志。`channel` 在生产路径上实际等于 roomId，因为 `extractRoomMessages` 不填 `roomAlias`；`roomAlias` 只可由测试直接构造。`MentionPayload.channel` 在 daemon 的 `checkMentionPayload` 中是可选字符串（`apps/daemon/src/engine/intents/taxonomy.ts:59`–`:67`），两侧结构兼容。
- **测试/证据**：
  - `mentions.test.ts` 31 例：基本识别（工号、角色词、顺序、完整 MXID、roomAlias→channel、同目标去重）、防误报（围栏、未闭合围栏、引用、纯引用、行内代码、邮箱、小写工号、未知角色、非 `m.text`、未标 msgtype）、空消息、中英混合、自定义 `agentIdPattern`、默认样式不含普通大写词、`stripNonConversational`、`extractRoomMessages` 形状过滤与空 join、`dedupKey`、`m.mentions` 互补路、结构化提及去重/大写化/自定义样式/非文本关闭、`m.mentions` 投影形状不符丢弃。
  - 不证明：真实 Synapse 的 `m.mentions` 形状变体、`formatted_body`/pill、编辑事件、线程、加密事件、redaction、超长/恶意输入、ReDoS、扩展 CJK 区、`agentIdPattern` 带 `g` 的行为、真实多公司房间隔离。
- **规模/迁移**：240 行，600 行硬门禁；目录 15/25。保留导出与纯函数性质。若目标要补 `roomAlias` 投影或编辑事件支持，先改 `extractRoomMessages` 的输入契约并回写 80/78 的 channel 语义；不得在本文件直接引入网络或公司目录读取。

### F-matrix-format

- **路径/处置**：`packages/matrix/src/format.ts`，36 行；现有；目标-保留。
- **上位锚**：25-§4.2（`Notifier`/`Notification`）、21-§三（bot 代发/署名）、80-§6.6 `TS-PORT-NOTI-01`。`Notification` 的字段定义在 `contract/src/ports/notifier.ts:6`–`:13`，本文件不重定义。
- **职责**：把一条 `Notification` 确定性地渲染为 Matrix `m.text` 的文本体：`[kind] **title**`、正文、逐条链接、可选 `—— from` 尾行。
- **非职责**：不发送、不解析 MXID、不组装 `m.mentions`、不做 HTML/富文本、不做转义/消毒、不做长度上限、不做本地化、不做秘密脱敏、不判断通知是否构成决定。
- **内部结构**：单一函数 `formatNotification(n) → string`。
  - `kind.trim()`；`title.trim()`；`head = kind 非空 ? '[kind] ' : ''` 加 `title 非空 ? '**title**' : ''`，最后整体 `trim()`；非空才入行。
  - `body = n.body.replace(/\s+$/, '')`（只裁尾部空白）；非空才入行。
  - `n.links ?? []` 逐条：`url.trim()` 为空跳过；`label.trim()` 为空时用 url 作 label；输出 `- [label](url)`。
  - `n.from?.trim()` 非空时追加 `—— from`，恒为最后一行。
  - 所有字段为空时返回空串。
- **导出/依赖**：导出 `formatNotification`；依赖 `contract` 的 `Notification` 类型；零运行时依赖。
- **IO/注入**：纯函数，零 IO；无时间/随机/env。
- **状态/事务/幂等/并发**：无状态；同输入同输出。
- **错误/观测**：对合法 `Notification` 不抛错；若运行时 `body` 不是字符串会抛 `TypeError`（类型层应已阻止）；不记录日志；不标注内容来源。Markdown 特殊字符不转义，标题/正文中的 `**`、链接语法、mention 词会原样进入消息体；超长内容可能触发 Matrix 事件大小限制，本文件不处理。`from` 是展示性署名，不是鉴权；65 字节/字符边界未处理。
- **测试/证据**：`format.test.ts` 7 例：全字段、无 links、多 links + 空 url 跳过、body 尾部空白、空 body、空 title、全空、`from` 尾行与空白 from 省略、`from` 在 links 之后。不证明真实 Matrix 客户端渲染、Markdown 注入、长度上限、Unicode 宽度、`m.mentions` 高亮、出站脱敏。
- **显式 N/A（目标）**：
  - **不做脱敏**：N/A + 理由 —— 脱敏是**出站闸**（`createMatrixNotifier`/`createMatrixBroadcastFace` 的必填 `redact`）职责；本文件是纯渲染，若在此脱敏会形成第二处调用点，且同一文本被两处渲染时行为不一致（80-§11.2.1 要求单一实现、不得第二套）。
  - **不做 `titleKey`/`bodyKey` 静态消息表**：N/A + 理由 —— 80-§6.6 允许 matrix 维护静态消息表并提供回退到 `title`/`body`，但**本包当前没有 catalog**，也没有多语言/多客户端需求；虚构一张表会新增公共概念。若将来需要，必须先有真实消费者并保证缺省回退 `title/body`（`Notification` 形状不变）。
  - **不做长度上限/转义/URL 校验**：N/A + 理由 —— 属内容面策略，未在任何上位文档定值；本文件只保证确定性渲染，长度/转义归后续实现单，且不得把它写成“已净化”。
- **规模/迁移**：36 行 → 目标 ≤50 行（仅补注释级说明），余量充足。保留签名与纯函数性质；脱敏/长度上限永不加在本文件。

### F-matrix-adapter

- **路径/处置**：`packages/matrix/src/adapter.ts`，130 行；现有；目标-保留。
- **上位锚**：25-§3.4（`InvokeSource`）、25-§4.2（`Notifier`）、22（源只产意图）、21-§四（@唤醒）、78-§11.2、78-§7.4.1（通知出口的脱敏闸）、80-§6.6（`Notifier` 的目标签名、`NotificationEnvelope`、`from` 仅展示）、80-§6.8（`InvokeSource` 保留）。
- **职责**：
  - `createMatrixNotifier(client)`：实现 contract 现签名 `Notifier.send(channel, message): Promise<void>`——“`formatNotification` → `client.sendMessage(channel, text)`”；`channel` 语义=room_id（25-§3.4 裁决 4：通道标识不透明，alias 解析归实现自由，本面不做）。这是**单条单通道**的通知端口，不是广播面。
  - `createMentionSource(options)`：实现 `InvokeSource`；轮询 `sync`、首拉建基线、增量提取消息、过滤自发/白名单、`parseMentions` 产意图、`emit` 推送；失败指数退避；`stop()` 清定时器。
- **非职责**：不做通知级别→频道路由（`broadcast.ts` + daemon 负责）、不做 alias→room 解析（notifier 的 channel 直接是 roomId）、不生成 `KnownSecretSet`（只消费注入的 `redact`）、不记录 `notify-blocked`（归 daemon 台账/事件）、不做 `NotificationEnvelope.notificationId/dedupKey` 去重（调用方负责）、不做供给/人事、不做引擎幂等、不做公司归属判定（只按调用方给的 company 和 rooms）。
- **内部结构**：
  - `MentionSourceOptions { client, company, selfUserId, rooms?, roles?, pollIntervalMs?, syncTimeoutMs?, maxBackoffMs?, agentIdPattern? }`；缺省 3000 / 25000 / 60000；`selfUserId` 必填（防回声）；`rooms` 缺省=账号可见全部已加入房间。
  - `createMatrixNotifier(client)` 返回 `{ send(channel, message) }`；每次 `formatNotification` 后 `sendMessage`；不传 `mentionedUserIds`。
  - `createMentionSource(options)` 闭包状态：`pollIntervalMs/syncTimeoutMs/maxBackoffMs`、`parserConfig`、`allowedRooms`（`Set` 或 undefined）、`running`、`timer`、`since`、`baselineReady`、`delayMs`。
  - `schedule(emit)`：`running` 为真才 `setTimeout` 调 `poll`，延迟 `delayMs`。
  - `poll(emit)`：`running` 为假立即返回；`client.sync(since, since === undefined ? 0 : syncTimeoutMs)`；await 后再次检查 `running`；`since = sync.next_batch`；首拉只把 `baselineReady` 置真；后续 `extractRoomMessages` → 跳过 `sender === selfUserId` → `allowedRooms` 外跳过 → `parseMentions` → 逐条 `emit`；成功后 `delayMs = pollIntervalMs` 并 `schedule`；任何异常 `delayMs = min(delayMs * 2, maxBackoffMs)` 并 `schedule`，不记录日志、不区分错误。
  - `start(emit)`：已 running 则 no-op；置 running、复位 `delayMs`、立即 `poll`（首拉建基线）。
  - `stop()`：置 running 假；清 `timer`；不 abort 在途 `sync`。
- **导出/依赖**：导出 `createMatrixNotifier`、`createMentionSource`、`MentionSourceOptions`；依赖 `contract` 的 `CompanySlug`、`InvokeIntent`、`InvokeSource`、`Notification`、`Notifier`、`PersonId` 类型；依赖本地 `client.ts`、`format.ts`、`mentions.ts`。
- **IO/注入**：网络经 `client`；定时器用全局 `setTimeout`；`emit` 回调由调用方注入；无 fs/SQLite/子进程；无时钟注入；测试用 vitest fake timers。
- **状态/事务/幂等/并发**：
  - `since` 只在内存；重启重新建基线，停机期间消息不产意图（78-§11.2 已声明损失）。
  - 单实例串行：`schedule` 只在上一次 `poll` 完成后排下一次，不会重叠；但 `start` 后立即 `poll` 与调用方并发无锁，靠 `running` 防重入。
  - `stop()` 不能取消在途 fetch；若 `stop` 发生在 `await sync` 之后、`since` 赋值之前，代码会在赋值前因 `running` 为假返回；若发生在 `emit` 循环中，循环不检查 `running`，剩余意图仍可能被 emit。
  - `emit` 抛错：被外层 `catch` 吞掉并进入退避；`since` 已在循环前推进，当前批未处理的消息在下一次 `since` 之后不会重放——这是数据丢失与契约不符点（25-§3.4 v1.3 裁决 5）。
  - 退避状态只有 `delayMs`；成功复位；没有抖动、没有错误分类、没有重试上限；`maxBackoffMs` 小于 `pollIntervalMs` 时会把基础节奏也压低，未校验。
  - 长轮询：增量 `sync` 带 `timeout=syncTimeoutMs`，首拉 `timeout=0`；实际周期≈服务端返回时间 + `pollIntervalMs`。
- **错误/观测**：`createMatrixNotifier` 的发送失败直接抛给调用方（广播面不经过它；该实现库级未接，生产通知走 `NotifyBroadcastFace`）。与 80-§6.6 的目标相比，现状是“抛错 + `Promise<void>`”，目标是“软失败 + `NotifySendReceipt{status:'sent'|'failed'|'skipped', attempts, detail?}`”；`status:'failed'|'skipped'` 是**投递状态**，不是业务拒绝，通知失败不得回滚业务，通知成功也不得读成“已批准/已接收”。`createMentionSource` 的同步失败全部静默退避，没有日志出口、没有错误事件；`emit` 失败也被静默。无 category/subcause、无 metrics、无 last error；daemon 侧只能从“没有意图”间接观察。`selfUserId` 与 `rooms` 的过滤在提取后，跨公司白名单缺省为“全部房间”，与 25-§3.4 v1.3 裁决 2“一频道一公司”存在配置风险。
- **测试/证据**：`adapter.test.ts` 15 例（与 client 合并测）：
  - notifier：login 后 send 的 URL/方法/Authorization/Content-Type/body（含 `m.mentions` 空对象）；
  - mention source：login→首拉空基线→第二拉一条唤醒意图；请求带 `since` 与 `timeout=25000`；历史消息不 emit；自发消息与白名单外不 emit；`stop()` 后不再发请求、重新 `start` 以既有基线续跑；指数退避翻倍/封顶/复位；缺 `next_batch` 走退避；
  - 429 礼让：`retry_after_ms=100`、缺省 2000、上限 30000、二次 429 抛出、非 429 不重试；
  - `m.mentions`：`mentionedUserIds` 数组、空列表。
  - 不证明：真实长轮询、真实网络中断、`emit` 抛错、stop 期间迟到 emit、多公司隔离、真实 Synapse 的 timeline `limited` 语义、消息分页/补拉、时钟注入。
- **目标修订（v0.3：覆盖上文与之冲突的“现有”描述；未实施）**：
  - **`Notifier` 目标签名**：`createMatrixNotifier(client, { redact })` 返回 `{ send(channel, message): Promise<Result<NotifySendReceipt, ClassifiedError>> }`。流程：`formatNotification` → `redact(text)` → `client.sendMessage` → `Ok({ status:'sent', attempts:1 })`；空渲染或 `channel` 空 → `Ok({ status:'skipped', attempts:0, detail })`；发送失败 → `Err(classifyMatrixError(e))`，**不重试、不抛**（结构面要求）。`redact` 抛错 → `Err(configInvalid)` 且**绝不无脱敏出站**（fail-closed，78-§11.2/80-§11.2.1）。`NotificationEnvelope`/`dedupKey` 不在本面消费（调用方按 `notificationId` 负责）；`titleKey`/`bodyKey` 静态表 N/A（理由同 `format.ts`）。
  - **源注入项**：`MentionSourceOptions` 增**必填** `report: (failure: ClassifiedError) => void`（boot 接 `REC-OBS-02` 写者）；缺则 `configInvalid`。`rooms` 在多公司场景必须显式白名单，装配期校验归 boot（§9.2）；本包只在 `rooms` 被显式给出时按白名单过滤。`agentIdPattern.flags` 含 `g`/`y` → `configInvalid`（`RegExp.test` 的 `lastIndex` 会漏判）。
  - **批处理与重放**：`poll` 调 `client.sync(since, timeoutMs, signal)`；`extractRoomMessages` → 过滤 → `parseMentions` → **逐条 `emit` 各自 `try/catch`**；任一条失败即 `report(classifyMatrixError(e))` 并终止本批，**不推进 `since`**；整批成功后才 `since = next_batch`。重放靠引擎 `intentKey` 去重（78-§11.2），本层不造去重键。
  - **停止**：`stop()` 置 `running=false`、`AbortController.abort()`、清 `timer`；`emit` 循环每轮检查 `running`；`AbortError` 不上报为故障（正常停机）。
  - **退避**：按 `failure` 分类——`unavailable`/`STALL` 才退避（带抖动、封顶 `maxBackoffMs`）；`rejected_*` 不退避，`report` 后复位节奏并继续（避免权限错误无限重试）。`maxBackoffMs < pollIntervalMs` → `configInvalid`。
  - **规模预算**：目标 ≤200 行（现 130），仍受 600 门禁。
- **规模/迁移**：130 行 → 目标 ≤200；余量充足，不拆文件。保留工厂名与选项名。`createMatrixNotifier` 的接线与 `Notifier` 签名升级依赖 `contract/src/ports/notifier.ts` 先升级（§9.2-2，G-16），并需 boot 注入 `redact`；本附录不改 contract/boot，也不得把广播面冒充 `Notifier`。

### F-matrix-broadcast

- **路径/处置**：`packages/matrix/src/broadcast.ts`，139 行；现有；目标-保留。
- **上位锚**：19-§六（通知/告警通道优先级：面板置顶、群聊 bot、邮件默认关；critical 即时通知）、21-§三（bot 代发/署名）、78-§11.2（出站通知；未知回执**不自动重发**；证据=消息事件 ID + 去重记录 + 通知回执）、78-§7.4.1（Matrix/通知是强制脱敏出口；未通过不发送、记 `notify-blocked`）、80-§6.6（`NotifyBroadcastFace` 与 `Notifier` 分离；目标映射；`NotifySendReport`/`NotifySendFailure` 逐字段）、80-§12.1（通信绑定接缝；未知回执须可判别）。本文件不是公共 TS 端口，不申请端口 ID；其身份是 daemon 结构面 `NotifyBroadcastFace` 的 Matrix 实现。
- **职责**：把 daemon 的**逻辑频道角色**（alert/overview/dept）解析为 Matrix 房间 alias → room_id → `MatrixClient.sendMessage`；逐频道隔离失败，返回 `{sent, failed}`；alias 解析缓存。**只承载 80-§6.6 目标映射里的 room 类目标**：`alert`/`overview`/`dept:<path>` 都是房间；`人事频道` 与 `mcp-session` 不是本面目标（前者本包没有角色映射，后者明确不经 `NotifyBroadcastFace`）。
- **非职责**：不做事件→频道的路由规划（daemon `engine/notify/route.ts`）、不做去重（daemon `NotifyDedup`）、不做惊动计量（daemon `assembly/notify/notify.ts` 写 PATROL）、不做通知内容/级别判断、不做 `Notifier` 的单条单通道投递、不做 `NotificationEnvelope.notificationId/dedupKey` 去重、不做 `notify-blocked` 记录（脱敏闸不在本包）、不做未知回执分类（`reason` 是自由文本）、不做人事/供给、不做权限管理、不做 E2EE。
- **内部结构**：
  - 接口身份（结构同形、零 import）：`BroadcastTargets` ≡ `NotifyBroadcastTargets`；`BroadcastReport` ≡ `NotifySendReport`；`BroadcastFailure` ≡ `NotifySendFailure`；`send(message, targets)` 返回 Promise 且**永不抛**——与 `apps/daemon/src/engine/notify/broadcast.ts:16`–`:41` 逐字段一致。新增 target 取值（如人事频道）走提案，不得单侧加字段。
  - 类型：`BroadcastTargets { alert?: boolean, overview?: boolean, dept?: string }`；`BroadcastFailure { target, reason }`；`BroadcastReport { sent: readonly string[], failed: readonly BroadcastFailure[] }`；`BroadcastFaceOptions { client, slug, deptSlugs, botMxid, log? }`。
  - `targetAlias(target, { slug, deptSlugs, serverName }) → string | undefined`：`alert → #<slug>-alert:<server>`；`overview → #<slug>-overview:<server>`；其它按部门处理：若 target 以 `dept:` 开头则去掉前缀，查 `deptSlugs[dept]`，缺失返回 `undefined`，命中返回 `#<slug>-<deptSlug>:<server>`。
  - `createMatrixBroadcastFace(opts)`：`log` 缺省 noop；`serverName = serverNameOf(botMxid)`；`aliasCache: Map<alias, roomId>`；`resolve(alias)` 先读缓存，未命中 `client.resolveAlias` 后写缓存；`sendToOne(target, message)` 先 `targetAlias`，失败返回软失败；解析失败返回软失败；发送失败则删缓存、重解析、再发一次，二次失败返回软失败；`send(message, targets)` 按 alert、overview、dept 顺序收集 roles，逐个 `sendToOne`，成功入 `sent`，失败入 `failed` 并 `log` 一行；返回报告。
- **导出/依赖**：导出 `createMatrixBroadcastFace`、`targetAlias`、`BroadcastTargets`、`BroadcastFailure`、`BroadcastReport`、`BroadcastFaceOptions`。依赖 `contract` 的 `Notification` 类型；依赖本地 `client.ts`、`format.ts`、`provision.ts` 的 `serverNameOf`。
- **IO/注入**：网络经 `client`；`log` 可注入；无 fs/SQLite/子进程；无时间/随机；alias 缓存只在内存。
- **状态/事务/幂等/并发**：
  - 缓存无 TTL、无上限；键是完整 alias，数量受公司/部门数约束。
  - 逐频道串行发送；一个频道失败不影响后续；报告顺序稳定。
  - **现状与 78 冲突**：发送失败后自动失效缓存、重解析并**重发一次**（新 txnId）。78-§11.2 的未知回执口径是「发送失败/超时 → 记录未知；**不自动重发**（会重复打扰）」；若服务端已接收而响应丢失，第二次发送会产生重复消息，本层又没有 `notificationId`/`dedupKey` 可在接收侧去重。目标语义：**至多一次发送**，失败只入 `failed`，缓存失效留待下一次调用；不得用重发冒充“自愈”。
  - 幂等：入站按消息事件 ID 去重是 mention 源的事（78-§11.2），本面无去重；同一 `send` 重放会再发一遍，调用方必须自己保证不重放。
  - 并发 `send` 共用缓存，但没有 in-flight 去重；同一 alias 的两次并发解析可能各发一次 `resolveAlias`；结果仍收敛。
  - 无重试预算/退避；现状只重试一次（目标为 0 次自动重发）。
- **错误/观测**：`send` 设计为不抛（逐频道软失败）；但若 `targetAlias`/`serverNameOf` 等纯函数抛错（当前不会），异常会外溢。失败原因字符串含 alias/roomId/底层错误文本；`log` 可能落日志。没有结构化错误分类、没有事件/台账；daemon 的 relay 负责把 `failed` 计入 PATROL note、通知回执归 `REC-EVT-01` 的中继事实与 `REC-OBS-02`（80-§6.6），本包不产记录。`dept` 输入约定是部门 path（如 `departments/研发部`），若调用方已带 `dept:` 前缀，会形成 `dept:dept:...` 并查表失败；这是调用约定，不是本层校验。
- **未知回执与脱敏（接缝缺口）**：
  - 80-§12.1 要求绑定层对“没回执 / 回执歧义 / 回执迟到”给出**可判别**的描述；本面只有 `reason` 自由文本，没有类别位，daemon 无法机械区分“确定未发出”和“未知”。补类别位要动 `NotifySendFailure`（daemon 结构面），必须先回写 80，不得在本包单侧加字段。
  - 78-§7.4.1 把 Matrix/通知列为强制出口：`find` 判 → `redact` 改 → 才允许出站；未通过不发送、记 `notify-blocked`。本面不持有 `KnownSecretSet`（80-§11.2.1：由 daemon 装配期用 `SecretMaterial[]` 生成，运行期只读），**不得**在本包私加秘密扫描；目标是由 daemon relay 或 boot 装配的包装面在调用 `send` 前完成闸门。现状 `boot.ts:290`–`:296` 把 `log` 直接传给本面，失败 reason 未经脱敏就进日志——登记为缺口，不在本附录改代码。
  - 内容面：`formatNotification` 不转义 Markdown、不限长、不校验 URL scheme；通知正文可能含外部文本（平台错误、工单标题）。这与秘密脱敏是两件事，均未证。
- **测试/证据**：`broadcast.test.ts` 8 例：`targetAlias` 三种角色与无映射、resolve+send 的 body（含 `from` 署名）、alias 缓存只解析一次、部门映射缺失软失败、单频道发送失败不阻其它、发送失败→缓存失效→重解析成功、三种角色各投各房、botMxid 推 serverName。假网是路由表 + 调用记录；不证明真实 Synapse 的 alias 目录、权限、限流、并发、重复投递、真实房间重建。注意“发送失败→重解析成功”这一例钉的是**现状的重发语义**；若按 78 改为不自动重发，该例必须同步改写（属实现单范围，不在本附录执行）。
- **目标修订（v0.3：覆盖上文与之冲突的“现有”描述；未实施）**：
  - **注入**：`BroadcastFaceOptions` 增**必填** `redact: KnownSecretSet['redact']`（80-§11.2.1）；缺则 `configInvalid`。`log` 保留可选，但日志行必须在调用前由本面用 `redact` 处理后才能落。
  - **至多一次发送**：`sendToOne` 顺序 = `targetAlias` → `resolve`（缓存优先）→ `formatNotification` → `redact(text)` → `client.sendMessage`。**删除“失败→删缓存→重解析→重发一次”**：任一步失败即入 `failed`；仅把 alias 缓存删掉供**下次调用**重解析（不重发）。`send` 仍**永不抛**，`BroadcastReport` 与 `NotifySendReport` 逐字段一致（`sent: string[]`、`failed: { target, reason }[]`）。
  - **脱敏与 fail-closed**：`redact` 抛错或返回非字符串 → 该频道**不发**，`failed` 记 `{ target, reason: 'notify-blocked' }`；daemon 据此记 `notify-blocked`（本包不写记录）。失败 `reason` 固定前缀 `matrix:<failure>/<subcause>`，后接 `redact` 处理过的 `detail`；**不得**把服务端原始 `error` 文本、请求体或凭据写进 `reason`。
  - **未知回执**：本面只报“投递状态 + 失败分类”，不承诺“确定未发出/确定已发出”；回执确定性仍是跨卷开口（§9.2），**不在本包**给 `NotifySendFailure` 加字段。
  - **N/A（显式）**：
    - `NotificationEnvelope`/`notificationId`/`dedupKey`：N/A + 理由 —— 80-§6.6 把信封定义在 `Notifier` 端口族（投递身份 + 目标），本面签名是 `send(message, targets)`，**没有 id 轴**，信封不在参数里；去重归调用方/订阅方。本包不造信封、不造去重表。
    - 人事频道角色：N/A + 理由 —— `BroadcastTargets` 只有 `alert`/`overview`/`dept:<path>`；新增 target 取值走提案（80-§6.6），本附录不私加。
    - `titleKey`/`bodyKey` 静态消息表：N/A + 理由 —— 本面只渲染 `title`/`body`；80-§6.6 允许的静态消息表（可选键、缺省回退）本卷不建，将来若建也不改 `Notification` 形状。
  - **规模预算**：目标 ≤180 行（现 139）。
- **规模/迁移**：139 行 → 目标 ≤180；不拆文件。保留工厂名、选项名、报告形状；daemon 的 `NotifyBroadcastFace` 是结构同形，不可在本包私改字段。若未来要统一到 `Notifier`，必须保留 `send(message, targets)` 并另立适配，不得直接改 daemon 结构面。

### F-matrix-hr-face

- **路径/处置**：`packages/matrix/src/hr-face.ts`，135 行；现有；目标-保留（目标修订：`SecretMaterial`、结构化判据、成员先读后邀）。
- **上位锚**：52-§7.1（建号）、§7.2（房间权限）、§7.4（client 薄层、ensure-shape 业务幂等归本面）、§12（密钥与凭据）、§13 风险 8（Synapse 未部署）；21A-§2.3（shared-secret）；21A-§5.9（localpart 小写/displayname 工号原文）；78-§11.2；80-§12.1（daemon 侧 `MatrixHrFace`）。
- **职责**：实现 daemon 人事同步器需要的 Matrix 执行面：建号/收敛账号、邀请入房并确保成员档、调整 power_level、踢出；所有操作按“目标态”收敛，重跑不坏。
- **非职责**：不生成/保存员工密码（调用方 daemon 负责）、不做人事事件分类、不决定房间集合/别名（调用方传全限定 alias）、不做组织/岗位授权、不写台账、不做审计、不管理 token 生命周期（除一次性注册会话的 logout）、不保证改名（bot 无权代改他人 profile，属能力边界）。
- **内部结构**：
  - `MatrixHrTarget`：四个方法的结构契约（与 daemon `MatrixHrFace` 字段同名）：
    - `ensureAccount({ username, displayName, password }) → { userId, created }`；
    - `ensureMembership({ userId, roomAlias }) → void`；
    - `ensurePowerLevel({ userId, roomAlias, level }) → void`；
    - `kickFromRoom({ userId, roomAlias, reason? }) → void`。
  - 错误文本判定：`isUserExistsError` 匹配 `M_USER_IN_USE` 或 `User ID already taken`；`isAlreadyInRoomError` 直接复用 `isForbiddenError`（匹配 `M_FORBIDDEN`）；`isForbiddenError` 匹配文本。
  - `fullAlias(alias)`：已以 `#` 开头原样，否则补 `#`；不补 server 后缀，调用方必须给全限定别名。
  - `userIdOf(username, serverUserId)`：username 已以 `@` 开头原样；否则从 `serverUserId` 第一个 `:` 后取 server，取不到用 `localhost`，拼 `@username:server`。
  - `MatrixHrFaceOptions { client, sharedSecret, memberPowerLevel? }`；`memberPowerLevel` 缺省 0。
  - `createMatrixHrFace(opts)` 实现四个方法：
    - `ensureAccount`：先 `registerWithSharedSecret`；成功则 `created = true`，用返回的一次性 `accessToken` 调 `setDisplayName`，再 `logout(accessToken)`；任一步失败进入 catch：若错误不是“用户已存在”则原样抛；若是，则按 `userIdOf` 推 userId，读当前 displayname，若不同则用 bot 会话 `setDisplayName`，只吞 `M_FORBIDDEN`，其它错误抛；返回 `created:false`。
    - `ensureMembership`：`resolveAlias(fullAlias(roomAlias))`；`invite`，只吞 `M_FORBIDDEN`；再 `setPowerLevel(roomId, userId, memberLevel)`。
    - `ensurePowerLevel`：`resolveAlias`；`getPowerLevels`；若 `users[userId] === level` 直接返回；否则 `setPowerLevel`。
    - `kickFromRoom`：`resolveAlias`；`kick`；不吞“不在房”错误。
  - `matrixLevelFor(status, memberLevel = 0, mutedLevel = -1)`：`paused` 返回 `mutedLevel`，否则 `memberLevel`；只接受 `active|paused` 两个字面量。
- **导出/依赖**：导出 `createMatrixHrFace`、`matrixLevelFor`、`MatrixHrTarget`、`MatrixHrFaceOptions`。依赖本地 `client.ts` 的 `MatrixClient` 类型；不 import daemon/company/store。
- **IO/注入**：网络经 `client`；**现状**：`sharedSecret: string` 由 boot 从 env（`MATRIX_HR_SHARED_SECRET`，次选 `MATRIX_SHARED_SECRET`）读出后注入——这是待改的取值通道，不是目标口径；**目标**：`registrationSecret: SecretMaterial` 由**调用方**（v0.4/v0.5 目标路径：daemon 经 `matrixSessionFactory` 装配，仅建号能力开启时）用 80-§11.2.1 的 `SecretProvider.load(SEC-MX-HR-SHARED, 'matrix-register')` 取得（条目 `kind:'shared-secret'`、`allowedUses:['matrix-register','outbound-redaction']`，80 最新口径），本包不读 env、不持有 catalog 本体，只做 `secretId`/`kind` 校验（见目标修订）；员工密码由调用方 daemon 传入（不是 catalog 条目，也不是本面持有物）；无 fs/SQLite/子进程；无时间/随机。
- **状态/事务/幂等/并发**：
  - 无本地状态；收敛依赖服务端现状。
  - `ensureAccount` 的“注册→设名→logout”不是事务：注册成功后设名或 logout 失败会抛错，但账号已存在；重试走“已存在”路径，可能收敛 displayname，但一次性 token 可能未注销（直到服务端过期/进程结束）。这是部分成功未上报。
  - 并发 `ensureAccount` 同一 username：两个注册请求一个成功、一个收到 `M_USER_IN_USE`，后者走已存在路径；可能两个都设名；幂等但会产生额外请求。
  - `ensureMembership` 的 invite 后 `setPowerLevel` 是读-改-写；并发/重跑可能交错。`setPowerLevel` 只写 `users`，会抹掉其它 PL 键（见 F-matrix-client）。
  - `ensurePowerLevel` 的“同值不写”只比较 `users[userId]`，不比较其它 PL 字段；若房间 PL 被外部改动但该用户值相同，本面不会修复。
  - `kickFromRoom` 不幂等：目标已不在房时服务端报错，调用方会看到失败；是否应视为“目标态已达成”未定义。
- **错误/观测**：普通 `Error` 文本分类；没有 category/subcause；`M_FORBIDDEN` 过宽——真正的“bot 无权限邀请/改 PL”也会被 `ensureMembership` 当“已在房”吞掉，随后 `setPowerLevel` 可能再失败；若 `setPowerLevel` 也 403，则最终抛错，但如果 PL 写成功而 invite 被误吞，会产生“未入房但改了 PL”的假收敛。没有日志/事件/台账。秘密面：`sharedSecret`/员工密码/一次性 token 都不得进错误文本；服务端 `error` 文本会经 `client` 的 `Error.message` 上抛，落日志/报告前须过 `KnownSecretSet.redact`（80-§11.2.1）。`ensureAccount` 的 `created` 是唯一观测位；部分成功没有位。
- **测试/证据**：`hr-face.test.ts` 10 例：shared-secret 的 GET nonce + POST mac 独立复算（`notadmin` 段）、新号注册+一次性 token 设名+logout、已存在+异值 displayname 的 403 能力边界收敛、已存在+同值零写、非冲突错误上抛、ensureMembership 的 invite+PL、invite M_FORBIDDEN 吸收、ensurePowerLevel 同值不写/异值写、kick 路径、`matrixLevelFor` 四组。假网是路由表 fake fetch；不证明真实 Synapse 的注册/权限/错误文本、并发、部分成功、PL 保留、改名能力、跨 server、真实限流。
- **目标修订（v0.3：覆盖上文与之冲突的“现有”描述；未实施）**：
  - **秘密注入**：`MatrixHrFaceOptions { client, registrationSecret: SecretMaterial, memberPowerLevel? }`，`sharedSecret: string` 取消。构造期校验 `secretId === 'SEC-MX-HR-SHARED'`、`kind === 'shared-secret'`、`typeof value === 'string'` 且非空（空串/零字节按 `secret-empty` 拒，80-§11.2.1），不符 `configInvalid`；`value` 只进 HMAC，不落实例字段、不日志、不回显。员工密码仍是 `ensureAccount({ password: string })` 的**逐人一次性**入参（不在 78-§7.4.1 catalog，本包不生成/不保存/不记录）。
  - **结构化判据**：删除 `isUserExistsError`/`isAlreadyInRoomError`/`isForbiddenError` 文本匹配，改用 `errors.ts`：`isUserInUse`、`isForbidden`、`isNotFound`、`isRateLimited`。
  - **真假收敛分离**：`ensureMembership` 先 `resolveAlias` → 读 `m.room.member`（`getStateEvent(roomId,'m.room.member',userId)`）；`membership === 'join'` 才跳过 invite；否则 `invite`，**只把 `isForbidden` 当失败上报**（不再吞）。`ensurePowerLevel` 因 `client.setPowerLevel` 改全量合并，自动保留其它 PL 键。
  - **kick 幂等**：`kickFromRoom` 先读 membership；已不在房 → no-op（目标态已达成，返回 `void`），不再让服务端 403 冒充失败。
  - **部分成功**：注册成功但设名/logout 失败时抛 `ClassifiedError{ failure:'partial', category:'EXTERNAL_REJECT', subcause:'account-partial' }`（仍是 throw；`MatrixHrTarget` 返回形状跨包，不改），由 daemon 落 ESCALATE；结构化观测位仍是缺口（§9.2-1）。
  - **规模预算**：目标 ≤190 行（现 135），不拆文件。
- **规模/迁移**：135 行 → 目标 ≤190。保留 `MatrixHrTarget` 字段名与方法名（daemon 结构同形）。部分成功若要变成**返回字段**，必须改 `MatrixHrTarget`（跨包），先回写 80/52，不能在本附录私改。

### F-matrix-power-levels

- **路径/处置**：`packages/matrix/src/power-levels.ts`，127 行；现有；目标-保留。
- **上位锚**：21A-§2.4（空间/频道与只读落法）、52-§7.3（等级→PL 与停/复/退）、21-§三（有界对话/撤回）；是 `provision.ts` 的内部纯核心，不新增公共端口。
- **职责**：定义频道类别、PL 三列基线、`m.room.power_levels` 目标快照、`ChannelSpec`/`ChannelMapPlan` 类型，以及 JSON 深比较与“现状 vs 目标”判据。
- **非职责**：不发网络请求、不建房、不邀请、不写 state、不决定成员、不做权限策略、不读公司目录。
- **内部结构**：
  - `ChannelKind = 'overview' | 'hall' | 'alert' | 'dept' | 'group' | 'xfunc' | 'ticket'`（七类，注释称“八类地图”是把父空间另算）。
  - `PowerLevelColumn = 'hall' | 'dept' | 'ticket'`。
  - `PowerLevelsContent { users_default, users, events_default, state_default, invite, kick, ban, redact, events }`。
  - `STRUCTURAL_EVENTS`：`m.room.name`、`m.room.canonical_alias`、`m.room.power_levels`、`m.room.history_visibility`、`m.room.tombstone`、`m.room.encryption`、`m.room.server_acl`、`m.space.child`，均置 100；`m.room.encryption` 置 100 是“E2EE 恒不启用”的挡板。
  - `powerLevelTarget(column, ids: { botMxid, producerMxid, moderatorMxid? }) → PowerLevelsContent`：`users` 只放 `producerMxid: 100`；`dept` 列且有 moderator 时加 `moderatorMxid: 50`；`users_default=0`、`events_default=0`、`state_default=100`、`invite/kick/ban=100`、`redact = dept ? 50 : 100`；events 全部 100。**`botMxid` 入参未被使用**（creator 不列进 users，避免 Synapse “Creator must not appear in content.users”）；保留参数是为调用面稳定，属于死输入。
  - `ChannelSpec { kind, alias, name, members, moderatorMxid?, power, order }`。
  - `ChannelMapPlan { space: { alias, name }, channels, problems }`。
  - `jsonEqual(a,b) → boolean`：递归比较普通对象/数组/原始值；不处理 Date/Map/Set/NaN。
  - `powerLevelsMatch(current, target) → boolean`：逐项比较 `users_default/events_default/state_default/invite/kick/ban/redact`；`users` 做完整深比较（目标之外的额外用户也算漂移，用于收回手工提权）；`events` 只比较目标键集（前向兼容，服务器/客户端注入的其它事件门槛不参与）。
- **导出/依赖**：导出上述类型、`powerLevelTarget`、`jsonEqual`、`powerLevelsMatch`；`provision.ts` 再导出 `powerLevelTarget` 与类型。零运行时依赖。
- **IO/注入**：纯函数，零 IO；无时间/随机/env。
- **状态/事务/幂等/并发**：无状态；判据是纯比较，重跑零写依赖调用方先读现状再调用本函数。
- **错误/观测**：不抛错；不记录日志；对畸形 `current` 做有限防御（`users/events` 非对象时按空对象比较），其余字段用 `!==` 比较，类型不符即判不等。
- **测试/证据**：`provision.test.ts` 覆盖三列基线（hall 的 redact=100/仅 producer、dept 的 redact=50/主管 50、ticket 的 redact=100/仅 producer）；`powerLevelsMatch` 通过 ensure/archive 的“重跑零写”“手工提权收回”间接覆盖。`jsonEqual` 没有直接单测；畸形现状、额外 events、非普通对象未证。
- **规模/迁移**：127 行，余量充足。保留导出与列语义。若清理 `botMxid` 死参数，需同时改 `provision.ts` 调用与测试；不得在未改调用前单方面删参。若新增 `ChannelKind`，必须同步 `planChannelMap`、`ensureChannel`、测试与 README 的八类地图说明。

### F-matrix-provision

- **路径/处置**：`packages/matrix/src/provision.ts`，598 行；现有；**目标-拆分**——保留为薄 facade（≤80 行），实现迁到 `src/provision/{plan,ensure,ticket,face}.ts`（四个新目标件，见本节末）。拆分原因、顺序与兼容面见 §1.3/§8.2。
- **上位锚**：21-§二（频道结构）、21-§五（部署）、21A-§2.2（账号=等级锚点、localpart 小写）、§2.4（空间/频道/别名/只读）、52-§7.3（房间与权限）、78-§11.2、80-§12.1（daemon 侧 `MatrixRoomFace`）。源码注释引用的 `130-P3`/`DEV-20` 正文不在本仓 docs，不能作为本附录的规范证据；本附录只按 21/21A/52/78/80 复核。
- **职责**：
  - 纯规划：从 `ChannelMapInput` 快照生成父空间 + 总览/大厅/告警/部门/小组/跨部门频道清单，成员按在册状态推导，缺 `deptSlugs` 落 `problems` 不中断。
  - 幂等 ensure：`resolveAlias → join → 补邀缺员 → PL 全量目标覆盖 → 名称/历史可见性同值零写`；未命中则 `createRoom` 后同后置步。
  - 单据房间：按单号生成 canonical/legacy 别名候选，解析 D7 成员，`ensureChannel`，挂父空间；关单归档为 `events_default=50` + `[已归档] ` 名称前缀。
  - 组合根面：`createMatrixProvisionFace(client, { snapshot })` 给 daemon 提供 `ensureCompanyChannels/onDispatched/onClosed`。
- **房间身份**：房间以 **room_id** 为准；alias 只是解析入口与命名面（25-§3.4 裁决 4：通道标识不透明，alias/id 归实现自由）。`ticketRoomAliases` 的 canonical/legacy 双候选是“同一房间的两种入口”，不是两个房间；`channel=room_id` 的对外语义因此与 25/78 一致，README 不得写成“channel=alias”。
- **非职责**：不做通知/广播、不做人事账号、不决定组织事实、不写台账、不做授权、不删除房间、不在缩编时踢人、不启用 E2EE、不做跨 homeserver 迁移、不做真实限流预算。
- **内部结构**：
  - 输入类型：`ProvisionPerson { id, login, dept, role?, status? }`；`ProvisionDept { path, name, leader }`；`ProvisionGroup { id, dept, name, leader?, members }`；`ChannelMapInput { slug, companyName, departments, people, groups?, deptSlugs, botMxid, invitePaceMs?, producerMxid }`。
  - Matrix 结构面：`ProvisionClient` 要求 `createRoom/resolveAlias/joinRoom/invite/listMembers/getFullPowerLevels/sendStateEvent/getStateEvent`；`MatrixClient` 天然满足；测试注入 `FakeSynapse`。
  - 结果类型：`EnsureRoomResult { roomId, created }`；`CompanyChannelsReport { ensured, created, problems, failures }`。
  - 小工具：`mxidOf({login}, server) → @login:server`；`serverNameOf(mxid) → ':' 后段，缺省 'localhost'`；`aliasLocalpart(alias) → 去 #、取 : 前段`；`ticketAliasLocalpart(slug,ticket)`：清洗单号（小写、保留 `a-z0-9._=/+-`、去首尾 `.=_/-`），若已以 `<slug>-` 开头则不再叠前缀，否则拼 `<slug>-<cleaned>`；`cleanTicketId` 私有；`ticketRoomAliases(slug,ticket,server)`：canonical 在前，旧照录 `<slug>-<cleaned>` 若不同则作为第二候选；`ticketRoomName(ticket,title)`：`<单号> ｜ <标题>`，标题空白折叠，超 48 字截断加 `…`；`isActive(p)`：`status` 缺省/`active`/`paused` 为真，`retired` 为假；`dedupSorted` 去重排序；`isNotFoundError` 匹配 `M_NOT_FOUND` 或 `404`；`isAlreadyInRoomError` 匹配 `M_FORBIDDEN`。
  - `planChannelMap(input) → ChannelMapPlan`：
    - server 从 `botMxid` 取；`alias(local) = #local:server`；
    - `peopleById`；`activePeople`；`leaderIds` 去重排序后过滤到人员索引，映射为 MXID；
    - 依次 push：`overview`（成员=部门主管 MXID + producer，名称“总览”，hall 列）、`hall`（在册全员 + producer）、`alert`（同 hall）、每个部门（缺 deptSlugs 落 problems 并跳过；成员=该部门在册人员 + producer；moderator=部门主管若在人员索引；dept 列）、每个声明 group（缺 deptSlugs 落 problems；成员=声明成员中在册且在索引者 + producer；moderator=组长若在索引；dept 列）、`xfunc`（主管 + producer，hall 列）；`order` 从 1 递增；`space = { alias: #slug:server, name: companyName }`。
  - `ensureSpace(client, spec)`：resolve 命中则 join + 名称同值零写；未命中则 `createRoom({ name, aliasName: aliasLocalpart, visibility:'private', creationContent:{type:'m.space'} })`；返回 `{roomId, created}`。**不设置空间 PL、不邀请 producer、不确认现有房间确实是 space**。
  - `putStateIfChanged(client, roomId, type, stateKey, target)`：先 `getStateEvent`；`jsonEqual` 为真返回 false；404/M_NOT_FOUND 视为“缺省即写”；其它错误抛；然后 `sendStateEvent`，返回 true。
  - `ensureChannel(client, spec, ids)`：
    - resolve 命中则 join；未命中则 `createRoom({ name, aliasName, visibility:'private', preset:'private_chat', initialState:[{type:'m.room.history_visibility', content:{history_visibility:'shared'}}] })`；
    - `Promise.all` 读 join 与 invite 名单；合并为 `present`；
    - 对 `spec.members` 中不在 `present` 的成员：先 `sleep(invitePaceMs ?? 350)`；最多 3 次 invite；`M_FORBIDDEN` 视为已达成并 break；`M_LIMIT_EXCEEDED` 且 attempt<2 时 `sleep(5000)` 重试；其余抛；
    - `powerLevelTarget(spec.power, ids + moderatorMxid?)`；读 `getFullPowerLevels`；`powerLevelsMatch` 为假则 `sendStateEvent('m.room.power_levels','',target)`；
    - 名称与 history_visibility 各做一次同值零写；返回 `{roomId, created}`。
  - `ensureSpaceChild(client, spaceRoomId, childRoomId, order, serverName)`：`putStateIfChanged('m.space.child', childRoomId, { via:[serverName], order })`。
  - `ensureCompanyChannels(client, input)`：先 plan；`ensureSpace`；space 失败只入 failures；逐 channel `ensureChannel`，成功计数 `ensured`/`created`，若 space 存在则挂子；单房失败入 failures；返回报告。space 本身不计数。
  - `resolveTicketMembers(input, { dept?, assignee })`：
    - assignee 不在索引 → 仅 `[producerMxid]`，note 明报；
    - `deptPath = args.dept ?? assignee.dept`；找 dept；若找到则加入 leader（若在索引）并给 moderatorMxid；否则 note“部门未登记”；
    - `lowestByRole(role)`：同 dept、同 role、在册者按 id 字典序取最小；分别加 `策划`、`QA`；
    - 最终成员=去重排序的 MXID + producer；note 只保留部门缺失提示。
  - `ensureTicketRoom(client, input, { ticket,title,dept?,assignee })`：先按 `ticketRoomAliases` 逐候选 resolve，首中即用；全缺用 canonical；构造 `ChannelSpec(kind:'ticket', members, moderator?, power:'ticket', order:0)`；`ensureChannel`；再 `ensureSpace(#slug:server)` 并挂子 order=1000，失败只把错误追加到 note；返回 `{...res, alias, note}`。
  - `archiveTicketRoom(client, input, { ticket })`：逐候选 resolve；全缺返回 `{archived:false, found:false, note:'…不存在…'}`；目标 PL 用 `ticket` 列并把 `events_default` 改为 50；`powerLevelsMatch` 为假则整份写；读当前名称，未带 `ARCHIVED_PREFIX` 时写 `[已归档] <当前名或 aliasLocalpart>`；返回 `{archived:true, found:true, note}`。
  - `createMatrixProvisionFace(client, { snapshot })`：每次调用现取 snapshot；`ensureCompanyChannels()` 返回报告；`onDispatched(args)` 调 `ensureTicketRoom` 但**丢弃返回的 alias/note**；`onClosed(args)` 调 `archiveTicketRoom` 但**丢弃 archived/found/note**。接口签名是 `Promise<void>`，所以软失败没有出口。
- **导出/依赖**：导出上述类型与函数，含 `ticketRoomAliases`（模块级导出，但不在包桶）、`ARCHIVED_PREFIX`。依赖 `power-levels.ts`（`jsonEqual/powerLevelTarget/powerLevelsMatch` 与类型）；不 import contract、daemon、company；`ProvisionClient` 是结构类型；`sleep` 用全局 `setTimeout`。
- **IO/注入**：网络经 `ProvisionClient`；时间用全局 `setTimeout`；`snapshot` 回调注入；无 fs/SQLite/子进程；无随机；无 clock。
- **状态/事务/幂等/并发**：
  - 无本地状态；收敛靠服务端现状；所有 ensure 可重入。
  - `resolveAlias` 404 是“未建”，不是错误；“已存在”是对账输入。
  - 邀请节奏：`invitePaceMs` 缺省 350ms；每次 invite 前都 sleep；重试 3 次；限流退避 5s；这些是时间副作用，不是事务。
  - PL 写入是“读全量 → 比较 → 整份写”；并发 ensure 同一房可能交错，最后写入者覆盖；没有 fencing/CAS。`powerLevelsMatch` 对额外 users 判漂移，可收回手工提权。
  - 缩编/成员移出：只补邀缺员，不踢出不在名单的成员；房间保留（与 52-§7.2“旧房不退”一致）。
  - 崩溃恢复：下一次 ensure 从服务端现状继续；部分建房/部分邀请/部分 PL 写会收敛，但可能产生一次额外 invite 事件或一次整份 PL 重写。
  - 归档：重复归档在 PL 与名称都匹配时零写；若 PL 被外部改动，会重写。
- **错误/观测**：
  - 硬错误（网络/权限/别名解析非 404）抛出；`ensureCompanyChannels` 把单房错误收进 `failures`，不阻断其它房；`ensureTicketRoom` 的硬错误上抛给 daemon 的 `dispatchRoomDuty`，由 daemon 落 ESCALATE；`archiveTicketRoom` 的硬错误上抛给 `closeRoomDuty`。
  - 软问题（`deptSlugs` 缺失、部门未登记、派工对象不在索引、空间挂接失败）只写 `problems`/`note`；`ensureCompanyChannels` 的报告会被 boot/channels 落日志；**单据房间的 note 在 face 被丢弃**，daemon 看不到“席位缺供/空间挂接失败”。
  - 错误分类：文本匹配 `M_NOT_FOUND`/`404`/`M_FORBIDDEN`/`M_LIMIT_EXCEEDED`；没有 category/subcause；`isNotFoundError` 的 `'404'` 子串可能误判包含 404 的任意错误文本。
  - 秘密：本文件不接触 token/password/sharedSecret；日志只应出现 slug/alias/roomId/MXID。MXID/房间名不是秘密，但属个人信息面：78-§7.4.1 的脱敏出口只管秘密值，不承诺匿名化，不得据此声称“日志可公开”。
  - 空间与房间权限：`ensureSpace` 不写空间 PL、不邀请 producer、也不校验既有房间的 `m.room.create.content.type === 'm.space'`（`resolveAlias` 命中即 join）。52-§7.3 只给房间权限表，78 未给空间权限基线；现状把空间当“纯索引房”，子房可见性靠各房 `history_visibility=shared`。这是待定项（§9.2-5），不得写成“空间权限已设计”。
- **测试/证据**：`provision.test.ts` 25 例，`FakeSynapse` 是状态机（rooms/alias/memberships/state + op log）：
  - PL 三列基线；
  - 八类地图（总览/大厅/告警/部门/3 小组/跨部门）别名、显示名、成员、moderator、order；
  - 部门缺映射 → problems；groups 未声明 → 无小组；
  - 首拍建齐 8 房 + 空间挂 8 子；重拍零写（`ops=[]`）；手工提权被下拍收回；invite M_FORBIDDEN 吸收；invite 硬失败落 failures；
  - 单号别名清洗、slug 恰一次、legacy 候选、显示名截断；D7 成员（派工对象+主管+策划+QA+producer）、部门未登记、派工对象不在索引；
  - 派发开房 + 重拍零写；归档 events_default=50 + 前缀 + 重复归档零写；无房归档 no-op；studio-dev-218 的 canonical/legacy 骑缝两场景；
  - `createMatrixProvisionFace` 三面委托；`mxidOf`。
  - 不证明：真实 Synapse 的 alias 目录、权限、限流、空间可见性、成员分页、真实并发、真实崩溃、PL 全量写对其它字段的影响、空间 PL/邀请、note 可观测性。
- **facade 目标契约（拆分后本文件只剩这一层）**：
  - **职责**：逐字 re-export 现有全部导出名（类型 + 函数 + `ARCHIVED_PREFIX` + `ticketRoomAliases`），并保留从 `power-levels.ts` 再导出的 `powerLevelTarget`/类型两条同源路径；`index.ts` 与 6 个测试文件的 import 不变。
  - **非职责**：不实现任何规划/网络/状态逻辑；不新增导出名；不改任何签名；不做默认参数填充。
  - **内部结构**：`export * from './provision/plan.js'`、`'./provision/ensure.js'`、`'./provision/ticket.js'`、`'./provision/face.js'`；`export { powerLevelTarget } from './power-levels.js'` + 类型再导出。无本地类型/常量/函数。
  - **导出/依赖**：依赖四个子件与 `power-levels.ts`；不 import `contract`/`apps/*`。
  - **IO/注入**：N/A（纯转发）。
  - **状态/并发**：N/A。
  - **错误/秘密**：N/A（不构造错误、不接触秘密）。
  - **测试/证据**：现有 `provision.test.ts` 直接 import 本文件；拆分后必须**零断言改动**通过（目标，未执行）。`index.ts` 的供给组导出同样不变。
  - **规模/迁移**：598 → **≤80 行**；迁移顺序见 §8.2：先 `plan` → 再 `ensure` → 再 `ticket`/`face`，每步独立可编译、测试 import 不变、不做“大爆炸”替换。

### F-matrix-provision-plan

- **路径/处置**：`packages/matrix/src/provision/plan.ts`，**新增**，目标 ≤220 行；目标-新增（F-ID 新分配）。
- **上位锚**：21-§二（频道结构）、21A-§2.2/§2.4（账号锚点、空间/频道/别名）、52-§7.3（房间与权限）、81-§二（完整文件契约）。
- **职责**：`provision` 子域的**纯规划层**——输入类型、频道类别映射、成员推导、别名/显示名规则、父空间规格、`problems` 收集；全部无 IO、无时间、无随机、无网络。
- **非职责**：不发请求、不建房、不邀请、不写 state、不读公司目录、不判断组织事实、不做错误分类（纯层不抛业务错误）。
- **内部类型与函数**：
  - 输入：`ProvisionPerson { id, login, dept, role?, status? }`；`ProvisionDept { path, name, leader }`；`ProvisionGroup { id, dept, name, leader?, members }`；`ChannelMapInput { slug, companyName, departments, people, groups?, deptSlugs, botMxid, invitePaceMs?, producerMxid }`。
  - 输出：`ChannelSpec { kind, alias, name, members, moderatorMxid?, power, order }`；`ChannelMapPlan { space: { alias, name }, channels, problems }`；`EnsureRoomResult { roomId, created }`（ensure 使用，类型放本层避免循环）。
  - 纯函数：`planChannelMap(input) → ChannelMapPlan`（现有语义不变：overview/hall/alert/dept/group/xfunc、`order` 递增、缺 `deptSlugs` 落 `problems` 不中断）；`mxidOf`、`serverNameOf`、`aliasLocalpart`、`dedupSorted`、`isActive`；`aliasOf(local, server)` 私有。
  - 目标增量：`space` 规格增加 `kind: 'space'` 与 `visibility: 'private'` 字段（供 `ensure` 校验/建房，不改变 `ChannelMapPlan` 现有字段名）。
- **导出/依赖**：导出上述类型与 `planChannelMap`/`mxidOf`/`serverNameOf`/`aliasLocalpart`/`dedupSorted`/`isActive`；`ChannelKind`/`PowerLevelColumn`/`PowerLevelsContent` 从 `../power-levels.js` 再导出。零 IO 依赖。
- **IO/注入**：N/A（纯函数）。
- **状态/并发**：无状态；同输入同输出。
- **错误/秘密**：不抛错、不日志；输入快照可能含工号/姓名（个人信息面），本层只透传到 `ChannelSpec`，不写日志、不持久化。
- **测试/R/E/W/V**：由 `provision.test.ts` 的规划/成员/别名用例覆盖；R/E/W 编号不在本附录新造；V2（纯函数）候选，V5 未执行。
- **规模/迁移**：≤220 行；从 `provision.ts` **原样搬移**，只允许改 import 路径与 `space` 规格新增字段；不重命名现有导出。

### F-matrix-provision-ensure

- **路径/处置**：`packages/matrix/src/provision/ensure.ts`，**新增**，目标 ≤260 行；目标-新增。
- **上位锚**：21A-§2.4（空间/频道/只读落法）、52-§7.3（房间权限）、78-§11.2（房间身份以 room_id 为准）、80-§12.1（`MatrixRoomFace` 结构面）。
- **职责**：幂等 ensure 层——`ProvisionClient` 结构类型、`putStateIfChanged`、`ensureSpace`、`ensureChannel`、`ensureSpaceChild`、`ensureCompanyChannels`；读现状→比较→必要时写；软问题进 `problems`/`failures`。
- **非职责**：不生成计划（`plan` 负责）、不做单号命名与成员推导（`ticket` 负责）、不组装面（`face` 负责）、不做通知/人事、不删除房间、不踢人。
- **内部类型与函数**：`ProvisionClient`（`createRoom/resolveAlias/joinRoom/invite/listMembers/getFullPowerLevels/sendStateEvent/getStateEvent`）；`putStateIfChanged(client, roomId, type, stateKey, target)`（`isNotFound` 视为缺省即写，其它错误抛 `MatrixApiError`）；`ensureSpace`（resolve → join → 名称零写；未命中 createRoom；**新增**：命中后校验 `getStateEvent('m.room.create')` 的 `content.type === 'm.space'`，不是 space 则返回 `note` 并不当空间用）；`ensureChannel`（resolve/join/createRoom；`Promise.all` 读名单；补邀缺员，`isForbidden` 不再当“已达成”，`isRateLimited` 才 5s 重试；PL 全量比较与写；名称/history 零写）；`ensureSpaceChild`；`ensureCompanyChannels`（space 失败只入 failures，逐房 ensured/created）。
- **导出/依赖**：导出上述类型与函数；依赖 `../power-levels.js`（`jsonEqual/powerLevelTarget/powerLevelsMatch`）、`./plan.js`、`../errors.js`。时间仍用全局 `setTimeout`（`invitePaceMs` 缺口保留）。
- **IO/注入**：网络经 `ProvisionClient`；无 fs/SQLite/子进程；无 clock；测试用 `FakeSynapse` + `invitePaceMs: 0`。
- **状态/并发**：无本地状态；无锁/fencing；并发 ensure 最后写入者覆盖（现状不变，问题登记 §9.1）。
- **错误/秘密**：硬错误抛 `MatrixApiError`（带 `failure/category/subcause`）；软问题只入 `note`/`problems`/`failures`；不接触 token/password/secret；日志只允许 slug/alias/roomId/MXID。
- **测试/R/E/W/V**：现有 provision 用例覆盖；新增“非 space 房间被识别”用例属目标（未写）。V2 候选，V5 未执行。
- **规模/迁移**：≤260 行；从 `provision.ts` 搬移 `ensure*` 与 `putStateIfChanged`；`isNotFoundError` 改调 `errors.isNotFound`；`sleep` 随迁并在 import 之后定义（顺带修风格项 §9.3-4，不改语义）。

### F-matrix-provision-ticket

- **路径/处置**：`packages/matrix/src/provision/ticket.ts`，**新增**，目标 ≤220 行；目标-新增。
- **上位锚**：21A-§2.4（别名）、52-§7.3（单据房间与归档）、78-§11.2（room_id 为准）、80-§12.1（`MatrixRoomFace.onDispatched/onClosed`）。
- **职责**：单据房间子域——单号清洗/别名候选/显示名、D7 成员解析、`ensureTicketRoom`、`archiveTicketRoom`、`ARCHIVED_PREFIX`。
- **非职责**：不做公司频道规划、不做通用 ensure（复用 `ensure` 的 `ensureChannel`/`ensureSpace`）、不决定派工、不写台账、不删除房间。
- **内部类型与函数**：`cleanTicketId`（小写、保留 `a-z0-9._=/+-`、去首尾 `.=_/-`）；`ticketAliasLocalpart(slug, ticket)`；`ticketRoomAliases(slug, ticket, server)`（canonical 在前，legacy 不同才作第二候选）；`ticketRoomName(ticket, title)`（`<单号> ｜ <标题>`，空白折叠，超 48 字截断加 `…`）；`resolveTicketMembers(input, { dept?, assignee }) → { members, moderatorMxid?, note? }`（D7：派工对象+部门主管+同部门策划/QA 字典序最小+producer）；`ensureTicketRoom`（逐候选 resolve→`ensureChannel`→挂父空间 order=1000）；`archiveTicketRoom`（PL `events_default=50` + `[已归档] ` 前缀；无房 `found:false`）。
- **导出/依赖**：导出上列函数与 `ARCHIVED_PREFIX`；依赖 `./plan.js`、`./ensure.js`、`../power-levels.js`、`../errors.js`。
- **IO/注入**：网络经 `ProvisionClient`；时间经 `ensure` 的 invite 节奏；无 fs/随机。
- **状态/并发**：无本地状态；归档/开房可重入；并发由 `ensure` 的读改写语义决定。
- **错误/秘密**：硬错误抛 `MatrixApiError`；软问题（部门未登记/派工对象不在索引/空间挂接失败）只入 `note`；不接触秘密。
- **测试/R/E/W/V**：现有 provision 用例覆盖单号/legacy/成员/归档/骑缝场景；V2 候选，V5 未执行。
- **规模/迁移**：≤220 行；搬移后 `ticketRoomAliases` 仍在模块导出（不在桶），兼容 `provision.test.ts` 的 import。

### F-matrix-provision-face

- **路径/处置**：`packages/matrix/src/provision/face.ts`，**新增**，目标 ≤120 行；目标-新增。
- **上位锚**：80-§12.1（`MatrixRoomFace` 结构面）、78-§11.2（软失败可观测）、81-§二。
- **职责**：组合根面 `createMatrixProvisionFace(client, { snapshot, report? })`，给 daemon 提供 `ensureCompanyChannels/onDispatched/onClosed`；把 `note`/`failures`/`problems` 经注入 `report` 上报（**新增观测位**），不改 daemon 结构面签名。
- **非职责**：不做规划/ensure/ticket 实现；不记录台账（`report` 由 boot 接线到 `REC-OBS-02`/日志）；不抛业务错误（daemon 结构面 `Promise<void>`，硬错误仍抛给 daemon 落 ESCALATE）。
- **内部类型与函数**：`ProvisionObservation = { scope: 'channels' | 'dispatch' | 'close'; kind: 'note' | 'failure' | 'problem'; detail: string }`；`createMatrixProvisionFace(client, opts)`：`ensureCompanyChannels()` 返回 `CompanyChannelsReport` 并把 `problems/failures` 逐条 `report`；`onDispatched(args)` 调 `ensureTicketRoom`，`note` 非空则 `report`，`alias` 丢弃（结构面不返回）；`onClosed(args)` 调 `archiveTicketRoom`，`note` 非空或 `found:false` 时 `report`；`report` 缺省 noop（但 boot 应注入，§9.2）。
- **导出/依赖**：导出 `createMatrixProvisionFace`、`ProvisionObservation`；依赖 `./plan.js`、`./ensure.js`、`./ticket.js`。
- **IO/注入**：网络经 `client`；`snapshot` 与 `report` 注入；无 fs/时间/随机。
- **状态/并发**：无状态；每次调用现取 snapshot。
- **错误/秘密**：硬错误原样抛（daemon 落 ESCALATE）；`detail` 只写 slug/alias/roomId/ticketId/固定短语，不写成员个人信息、不写服务端原始错误体。
- **测试/R/E/W/V**：现有 `createMatrixProvisionFace` 三面委托用例覆盖主路径；`report` 调用属目标新增用例（未写）。V2 候选，V5 未执行。
- **规模/迁移**：≤120 行；搬移后把“丢 note”改为“上报 note”，这是目标语义变化，必须有对应测试与实现单；daemon 结构面仍 `Promise<void>`，观测位缺口登记 §9.2-1。

---

## 四、测试与夹具逐项

### 4.1 测试总览

- 测试与源码同目录，位于 `packages/matrix/src`；没有 `test/` 子目录、没有共享 `testutil.ts`、没有 fixture 文件。
- 现有静态 `it(` 计数：`adapter.test.ts` 15、`broadcast.test.ts` 8、`format.test.ts` 7、`hr-face.test.ts` 10、`mentions.test.ts` 31、`provision.test.ts` 25，合计 **96 例**；`describe` 合计 25 组。README 写的“51 例（mentions 31 / format 5 / adapter+client 15）”已过期（format 实际 7，且未计 broadcast/hr-face/provision）。
- **目标**：8 个测试文件（新增 `errors.test.ts` 与 `session.test.ts`）；现有 96 例为基线，目标增量至少覆盖：错误映射表每行正反例、`detail` 不含敏感值、`redact` fail-closed、`emit` 逐条隔离与 `since` 不推进、`stop` abort、广播不重发/失败 reason 脱敏、PL 保留、`ensureMembership` 不吞真 403、`ensureSpace` 非 space 识别、会话工厂返回**四项工厂/面本身 + `close()`**（不是已构造面）、`kind`/`secretId`/`use` 三槽不符拒启、**两柄不互换**（bot 密码不得进 `registration`、HR 共享秘密不得进 `login`）、建号开启而 `registration` 缺失拒该能力、token 不出工厂/不进日志。新增用例数**不在本附录预填**（避免虚构），以实现单登记为准。
- 所有网络测试都注入 fake fetch 或 `FakeSynapse`，**零真实联网**；这是 fake 边界，不是真机证据。
- 没有 `client.test.ts`、没有 `power-levels.test.ts`；client 与 power-levels 由其它测试间接覆盖，覆盖缺口见各文件。
- 目标仍**不拆**独立 `client.test.ts`：401/403/404/409/429/5xx/网络失败/`AbortError`/2xx 缺字段等映射用例放 `errors.test.ts`（纯构造，不需要网络），避免 `adapter.test.ts`（376 行）继续膨胀。
- `apps/boot/src/boot.test.ts` 是跨包装配/形状守护（依赖方向、login→source、`MentionPayload` 与 daemon `checkMentionPayload` 兼容），**不属于**本包测试计数；它也不证明真实 Matrix。

### F-matrix-test-mentions

- **路径/处置**：`packages/matrix/src/mentions.test.ts`，316 行；仅测试；目标-保留。
- **覆盖**：`parseMentions` 的基本识别、角色词、顺序、完整 MXID、`roomAlias`→`channel`、同目标去重；围栏/未闭合围栏/引用/纯引用/行内代码/邮箱/小写工号/未知角色/非 `m.text`/未标 msgtype 的防误报；空消息；中英混合；自定义 `agentIdPattern`；默认样式至少一个连字符段；`stripNonConversational`；`extractRoomMessages` 的字段过滤、空 join、`m.mentions` 投影与形状不符丢弃；`dedupKey=eventId`；`m.mentions` 互补路（无正文词元、self/sender 过滤、两路去重、大写化、自定义样式、非文本关闭）。
- **夹具**：`msg(overrides)` 构造合法 `MatrixRoomMessage`；`targets(intents)` 读 payload.target；无网络、无时钟；纯函数直测。
- **不证明**：真实 Synapse 的事件形状、`formatted_body`/pill、编辑/线程/加密/redaction、超长输入/ReDoS、扩展 CJK、`agentIdPattern` 带 `g`/`y` 的状态、引擎对同 `dedupKey` 的折叠、真实多公司房间隔离。
- **R/E/W/V**：本附录不新造 R/E/W 编号；候选 V2（纯函数行为契约）；V5 真机未执行。82 卷当前**没有** matrix 条目，本卷也不预填追溯号；是否登记由主 agent 决定（不写成“待补”）。规模 316 行，测试文件也受 600 行门禁。

### F-matrix-test-format

- **路径/处置**：`packages/matrix/src/format.test.ts`，77 行；仅测试；目标-保留。
- **覆盖**：全字段、无 links、多 links 保序、空 url 跳过、body 尾部空白、空 body、空 title、全空、`from` 尾行、空白 `from` 省略、`from` 在 links 之后。
- **夹具**：直接构造 `Notification`；零 IO。
- **不证明**：真实客户端 Markdown 渲染、注入/转义、Matrix 事件大小、Unicode 宽度、`m.mentions` 高亮、脱敏。
- **R/E/W/V**：V2 候选；V5 未执行。规模 77 行。

### F-matrix-test-adapter

- **路径/处置**：`packages/matrix/src/adapter.test.ts`，376 行；仅测试；目标-保留。
- **覆盖**：client 的 login 请求体与 Bearer；notifier 的 send 请求形状（URL/方法/头/body/`m.mentions`）；非 2xx 抛错与未登录；mention source 的 login→空基线→唤醒消息、`since`/`timeout=25000`、历史不 emit、自发过滤、房间白名单、stop 后不再请求/可重启、指数退避翻倍/封顶/复位、缺 `next_batch` 走退避；429 四种路径；`mentionedUserIds` 两态。
- **夹具**：`FakeFetch` 类（预造响应队列 + 请求录像，队列空即拒绝）、`makeClient`、`syncBody`、`WAKE_EVENT`；`vi.useFakeTimers()`；`afterEach` 恢复真实计时器。
- **不证明**：真实 long poll/网络、emit 抛错、stop 期间迟到 emit、多公司隔离、真实 Synapse 的 `limited`/timeline 分页、真实 429 服务端行为、时钟注入。
- **R/E/W/V**：V2 候选；V5 未执行。规模 376 行。

### F-matrix-test-broadcast

- **路径/处置**：`packages/matrix/src/broadcast.test.ts`，130 行；仅测试；目标-保留。
- **覆盖**：`targetAlias` 的 alert/overview/dept/缺失映射；resolve→send 的 body（含 `from`）；alias 缓存只解析一次；部门映射缺失软失败；单频道失败不阻其它；发送失败→缓存失效→重解析成功；三频道各投各房；`botMxid` 推 serverName。
- **夹具**：`fakeFetch(routes)` 路由表 + 调用记录，`__throw` 表示网络错误，未规划路由返回 `M_UNRECOGNIZED`；`loggedInClient` 先走 login；`N`/`OPTS` 常量。
- **不证明**：真实 alias 目录、权限、限流、并发、重复投递、真实房间重建、`dept` 前缀误用。
- **R/E/W/V**：V2 候选；V5 未执行。规模 130 行。

### F-matrix-test-hr-face

- **路径/处置**：`packages/matrix/src/hr-face.test.ts`，169 行；仅测试；目标-保留。
- **覆盖**：`registerWithSharedSecret` 的 nonce→mac 独立复算（`notadmin` 段）；新号注册+一次性 token 设名+logout；已存在+异值 displayname 的 403 收敛；已存在+同值零写；非冲突错误上抛；`ensureMembership` 的 invite+PL；invite `M_FORBIDDEN` 吸收；`ensurePowerLevel` 同值不写/异值写；`kickFromRoom` 的 body；`matrixLevelFor` 四组。
- **夹具**：`makeFetch(routes, log)` 按 `METHOD decodedPath` 路由；`Error` 实例按 `IN_USE` 映射 `M_USER_IN_USE/400`，否则 `M_FORBIDDEN/403`；未匹配 404；`clientOf`/`loggedInFace` 走真 login；`SECRET = 'unit-shared-secret-0001'`。
- **测试卫生缺口**：80-§11.6 要求测试夹具的假秘密形如 `test-*`；本文件的 `SECRET` 不是该形状。目标应改为 `test-shared-secret-0001`（仅测试改动，不涉及生产），但本次不执行。
- **不证明**：真实 Synapse 注册/权限/错误文本、并发、部分成功（注册成功但设名/logout 失败）、PL 保留、改名能力、真实限流、跨 server。
- **R/E/W/V**：V2 候选；V5 未执行。规模 169 行。

### F-matrix-test-provision

- **路径/处置**：`packages/matrix/src/provision.test.ts`，480 行；仅测试；目标-保留。
- **覆盖**：`powerLevelTarget` 三列；`planChannelMap` 八类地图/成员/order/problems/groups 未声明；`ensureCompanyChannels` 首拍建齐/重拍零写/手工提权收回/invite M_FORBIDDEN 吸收/invite 硬失败；`ticketAliasLocalpart` 清洗与 slug 恰一次；`ticketRoomAliases` canonical/legacy；`ticketRoomName` 截断；`resolveTicketMembers` D7/部门未登记/对象不在索引；`ensureTicketRoom` 开房/重拍零写/studio-dev-218 两场景；`archiveTicketRoom` 归档/重复归档零写/无房 no-op；`createMatrixProvisionFace` 三面委托；`mxidOf`。
- **夹具**：`FakeSynapse` 状态机（`FakeRoom { roomId, alias?, name?, state: Map, memberships: Map }`；`ops` 记录 createRoom/invite/sendState；`inviteAlwaysForbidden`/`inviteHardFail` 钩子；`resetOps`）；`PEOPLE` 五人（含 retired）、`inputOf` 构造 studio-dev 实例形；`BOT/PRODUCER` 固定。`invitePaceMs: 0` 免等。
- **不证明**：真实 Synapse（alias/权限/限流/空间可见性/成员分页）、真实并发、真实崩溃、PL 全量写对其它字段的影响、空间 PL/邀请、face 的 note 可观测性、真实 rate limit 时序。
- **R/E/W/V**：V2 候选；V5 未执行。规模 480 行，测试文件也在 600 行门禁内。

### F-matrix-test-errors

- **路径/处置**：`packages/matrix/src/errors.test.ts`，**新增**，目标 ≤180 行；目标-新增（F-ID 新分配）。
- **覆盖（目标）**：`matrixApiError` 的 10 行映射表各至少一正一反例（401/403/404/409/429 耗尽/5xx/网络/Abort/2xx 形状/其它 4xx）；`classifyMatrixError` 对非 `MatrixApiError` 的归一（`AbortError`/`TypeError`/未知对象）；四个判据（`isNotFound`/`isForbidden`/`isUserInUse`/`isRateLimited`）的真假；404 **不**产 `Err`；`detail` 只含 method/path/status/errcode，不含服务端 `error` 文本、password/nonce/mac/token；`configInvalid` 注入缺失路径；`MatrixApiError instanceof Error` 与字段可枚举性。
- **夹具**：直接构造错误对象与 args，不联网、不用时钟；假秘密用 `test-*` 形状（80-§11.6）。
- **不证明**：真实 Synapse 的 errcode 分布（`M_UNKNOWN_TOKEN` 之外的变体）、限流礼让时序、真实网络中断、`Result` 的构造（归 contract 测试）。
- **R/E/W/V**：本附录不新造 R/E/W 编号；V2（纯函数）候选；V5 未执行。规模 ≤180 行。

### F-matrix-test-session

- **路径/处置**：`packages/matrix/src/session.test.ts`，**新增**，目标 ≤200 行；目标-新增（F-ID 新分配）。v0.4 随 `session.ts` 带入。
- **覆盖（目标）**：`createMatrixSessionFactory` 的返回形状——`matrixSource`/`matrixRoomFace`/`hrMatrixFace` 是**函数/thunk**、`notifyBroadcast` 是面实例、`close` 是函数（**不是**已构造的 source/room 面）；`deps.login` 的 `kind`/`secretId`/`use`/`material.kind`/`material.secretId` 逐槽校验（错一个即 `configInvalid`，不换条目、不猜 env）；`deps.registration` 的 `kind==='shared-secret'`、`secretId==='SEC-MX-HR-SHARED'`、`use==='matrix-register'` 逐槽校验，**把 bot 密码形状塞进 `registration`（或 HR 共享秘密塞进 `login`）必须 `configInvalid`**；建号能力开启而 `registration` 缺失 ⇒ 构造期 `configInvalid`，建号关闭而 `registration` 存在 ⇒ 不启用建号（`hrMatrixFace()` 仍按关闭语义）；空值材料（`value:''`/零字节）到达工厂 ⇒ `configInvalid`（provider 本应已 `Err(secret-empty)`）；登录只调一次，token 不出现于返回对象/日志/`report`；`matrixSource()` 重复调用返回同一实例；`matrixRoomFace(ctx)` 每调用现取 `ctx.snapshot`（换快照后不返回旧面）；`close()` 停源 + `logout` 且幂等；登录失败按 `errors.ts` 归一（`matrix-auth`/`matrix-network`）。
- **夹具**：fake `FetchLike` 或注入假 `MatrixClient`（登录响应预造）；假秘密用 `test-*` 形状（80-§11.6）并分别带 `kind:'password'`/`'shared-secret'` 与对应 `secretId`；fake provider 桩**不产出空值**（空值按 `Err(secret-empty)` 在 provider 层返回，见 §7.2），另有“空值直达工厂”的负向桩；`redact`/`report`/`toChannelMap`/`log` 用可断言桩；零真实联网、零 env。
- **不证明**：真实 Synapse 登录/注销语义、token 过期与 401 重登、真实网络超时、daemon 侧 `RunServeOpts` 接线（属 17 卷）、boot“不登录”的端到端断言（属 `apps/boot`）。
- **R/E/W/V**：本附录不新造 R/E/W 编号；V2 候选；V5 未执行。规模 ≤200 行，受 600 行门禁。

### 4.2 测试基建的边界

- 没有共享 helper；每个测试自带 fake，避免跨测试隐式耦合，但也造成 fake 行为不一致（例如 `broadcast.test.ts` 未规划路由返回 200 的 `M_UNRECOGNIZED`，`hr-face.test.ts` 未匹配返回 404）。
- fake 都只回放预造 JSON 或内存状态机；不能证明真实 homeserver 的协议边角、错误文本、限流、分页、并发和权限。
- 测试绿只证明当前回归；本附录未运行测试，不能称为“96 例全绿”。

---

## 五、配置与文档逐项

### F-matrix-package

- **路径/处置**：`packages/matrix/package.json`，18 行；现有；目标-保留（`description` 文字待修正，不改导出/依赖）。
- **上位锚**：79-§6.5（exports/分发）、79-§7（能力包发布面）、75-§五（配置件契约）、80-§2（包层）。
- **职责**：声明包名 `@studio-next/matrix`、版本 `0.1.0`、`private: true`、`type: module`、`main`/`exports["."] = ./src/index.ts`、`typecheck`/`test` 脚本、唯一 workspace 依赖 `@studio-next/contract`。
- **非职责**：不声明 `bin`、不声明 `files`、不声明 `license`、不声明 `engines`、不声明子路径 exports、不声明外部 npm 依赖。
- **内部结构**：JSON 字段；无 types/函数。
- **导出/依赖**：`exports` 只有 `.`；`dependencies` 只有 contract。目标不新增依赖、不改层位。
- **IO/注入**：N/A（manifest 不运行）。
- **状态/并发**：N/A。
- **错误/观测**：N/A；`private: true` 防止误发布。
- **测试/证据**：`scripts/guards/boundaries.mjs` 读 manifest 校验包间边；根 `bun.lock` 记录 workspace；没有测试直接断言本 manifest 的 exports。
- **规模/迁移**：18 行，目标仍 18 行（只改文字）。`description` 现在写“@唤醒 InvokeSource + Notifier 通知出口（薄网络层，零 npm 依赖）”，未覆盖广播/人事/供给三面，且把库级未接的 `Notifier` 写成了对外能力，属于文档漂移；目标文字改为“@唤醒 InvokeSource + 广播/人事/供给注入面（薄网络层，零 npm 依赖；`Notifier` 库级未接）”。**不改** `exports`/`dependencies`/`private`/`type`/脚本；`main` 仍是 `./src/index.ts`，不切 `dist`。若未来发布，按 79-§7 增加 `files`/`LICENSE` 与许可决定，不能默认沿用根 MIT。

### F-matrix-tsconfig

- **路径/处置**：`packages/matrix/tsconfig.json`，5 行；现有；目标-保留。
- **上位锚**：79-§5（noEmit 继承/显式 .ts/NodeNext）、79-§6（构建切换）、75-§五（配置件）。
- **职责**：包级类型门禁配置；`extends ../../tsconfig.base.json`；`include: ["src/**/*.ts"]`。
- **非职责**：不产出 JS/.d.ts；不配置 project references；不配置 paths；不覆盖 strict/erasable；不排除测试（测试在 src 内，一并类型检查）。
- **内部结构**：两个键。
- **导出/依赖**：继承根 base；无额外依赖。
- **IO/注入**：N/A。
- **状态/并发**：N/A。
- **错误/观测**：类型错误由 `tsc --noEmit -p tsconfig.json` 暴露；根 `tsc --noEmit` 也覆盖 `packages/*/src/**/*.ts`，存在双入口但都只读。
- **测试/证据**：本附录未运行 `tsc`；`package.json:12` 的 `typecheck` 脚本存在；根 `package.json:19` 的 `typecheck` 是 `tsc --noEmit`，没有逐包串接；matrix 仍在根 program 内，因此不触发 79 的“包 src 退出根 program 后包级 typecheck 必须并入根脚本”条件。
- **规模/迁移**：5 行；不改。若未来切 dist，必须另立发射配置、处理 `noEmit` 继承、`.d.ts` 说明符与 `exports`，不能只改本文件。

### F-matrix-readme

- **路径/处置**：`packages/matrix/README.md`，30 行；现有；目标-替换（同路径、内容重写）。
- **上位锚**：79-§7.1（README 是能力包交付物之一）、79-§7.4（README 不得冒充能力证据）、81-§5.3（Matrix 仅经 boot 注入、通知不是决定、平台/会话不是公司身份）。
- **现有内容事实**：
  - 声明协议依据 `docs/21`、`docs/22`、`docs/25-§3.4/§4.2`；
  - 文件表列 `mentions.ts`、`format.ts`、`client.ts`、`adapter.ts`；
  - 说“测试 51 例全绿（mentions 31 / format 5 / adapter+client 15）”；
  - 未做事项列“真实 homeserver 集成、Synapse 部署、token 持久化、E2EE、alias→room_id 解析、v3 filter、m.mentions 富标签、Notifier 级别→频道路由、契约 cases”；
  - 纪律备注说源只产意图、频道内容不可信、channel=room_id、每公司一个 source/广播面、boot 装配、daemon 不 import。
- **现有漂移**：
  - 测试计数过期：实际静态 96 例、6 个测试文件；format 是 7 例；broadcast/hr-face/provision 未列；
  - “alias→room_id 解析”已由 `client.resolveAlias`、`broadcast`、`provision` 实现；README 仍列为未做；
  - “Notifier 级别→频道路由”已由 daemon `engine/notify/route.ts` + `broadcast.ts` 承担；README 仍说归后续刀；
  - 未列 HR 面、供给面、广播面、429 礼让、`m.mentions` 发送侧；
  - 未说明 `createMatrixNotifier` 与 `whoami` 库级未接；
  - 未说明 `setPowerLevel` 抹其它 PL 字段的风险；
  - 未说明多公司房间白名单缺省为“全部房间”的风险；
  - 未说明契约 cases 仍未回填（`packages/contract/cases.json` 无 mention/notifier 匹配）。
- **目标内容**：重写为“四类面 + 一个薄网络层”的准确范围：
  1. 包层与依赖方向：层位 1、只依赖 contract、boot 唯一装配（**只构造会话工厂**）、daemon 零 import、边只有 `["boot","matrix"]`；
  2. 生产文件表：**目标 15 个文件**（`index`/`session`/`errors`/`client`/`mentions`/`format`/`adapter`/`broadcast`/`hr-face`/`power-levels`/`provision` facade + `provision/{plan,ensure,ticket,face}`），逐文件一句话职责；标明 `createMatrixNotifier`/`whoami` 库级未接、`session` 是会话工厂（boot 构造、daemon 驱动登录）；
  3. 纯核心：mentions/format/power-levels 的输入输出与防误报边界；`format` 不做脱敏、无静态消息表（N/A 理由）；
  4. 网络层：端点清单、429 礼让、token 内存、无 E2EE、`signal` 取消、`MatrixApiError` 结构化错误、`setPowerLevel` 全量合并；
  5. 适配面：mention source 的基线/退避/`report`/批成功后才推进 `since`/abort；broadcast 是 `NotifyBroadcastFace`（不是 `Notifier`）的 Matrix 实现——角色→alias→room、逐频道软失败、**至多一次发送**、失败 reason 脱敏；hr-face 的 `SecretMaterial` 注册、成员先读后邀、部分成功上抛；provision 的 ensure/开单/归档与 `report` 观测；
  6. 测试：**目标 8 个文件**、现有 96 例为基线、全部 fake 网络、真机未证；不得写“全绿”作为运行证据；
  7. 未做/未证：真实 Synapse、E2EE、token 持久化、契约 cases、真实限流/分页/并发、空间权限、多公司隔离、通知回执确定性、`Notifier` 生产接线（库级未接）；
  8. 纪律：通知不是决定、频道不是公司身份、源只产意图、频道内容不可信；秘密以 `SecretMaterial` 注入、不读 env、不落盘、不进日志；出站必须过注入的 `redact`，未通过不发。
- **非职责**：不新增架构、不定义公共端口、不把 README 变成规范、不承诺真机能力。
- **内部结构/导出/依赖**：N/A（Markdown 文档，无类型、无导出、无依赖）。
- **IO/注入**：N/A。
- **状态/并发**：N/A。
- **错误/观测**：N/A。
- **测试/证据**：README 本身不是证据；目标重写后仍不是证据。规模 30 行→目标建议 ≤120 行，避免变成第二份设计文档。R/E/W/V 全部 N/A（79-§7.4）。
- **迁移**：同路径替换；保留“协议依据/包定位/测试纪律/未做事项”结构；删除过期计数与过期“未做”项；新增“库级未接/未证/风险”小节。不得在 README 中写“已实现”超过实际代码锚。

---

## 六、跨文件流程

### 6.1 入站：Matrix 消息 → mention 意图

1. 现状：`apps/boot/src/boot.ts:131`–`:157` 用 `matrixHomeserverUrl` + `matrixUserId` + env `MATRIX_BOT_PASSWORD` 建 `MatrixClient` 并 `login`；token 只留实例；`bootServe` 把四面直接注入 `runServe`（`:347` 登录、`:349`–`:375` 装配/注入）。**目标（80-§3.4 第 10 条）**：boot **不再登录**，只构造 `matrixSessionFactory` 并交给 `RunServeOpts`；daemon 在启动装配期用 `SecretProvider.load(SEC-MX-BOT-PASSWORD, 'platform-auth')` 取 `SecretMaterial`、构造 `MatrixBotLoginSecret` 后调工厂，登录与 token 都在 daemon 进程内（`F-matrix-session`）。**建号**另取 `SEC-MX-HR-SHARED` + `use='matrix-register'` 构造 `MatrixHrRegisterSecret`，**只在建号能力开启时传**；bot 密码不用于建号，HR 共享秘密不用于登录（80-§11.2.1；78-§7.4.1 第 1017 行仍写旧口径，见 §9.3）。
2. `boot.ts:164`–`:184` 用 `matrixRooms`/`matrixRoles`/`matrixPollMs`/`matrixSyncTimeoutMs` 装配 `createMentionSource`；`selfUserId` 用登录返回的规范 MXID。**目标**：源由工厂的 `matrixSource()` 惰性创建；增必填 `report`（接 `REC-OBS-02` 写者）；多公司必须显式 `matrixRooms` 白名单，缺省“全部房间”不再被接受（§9.2）。
3. `adapter.poll` 首拉 `sync(undefined, 0, signal)` 只拿 `next_batch` 建基线；后续 `sync(since, 25000, signal)` 长轮询；`extractRoomMessages` 只取 `rooms.join.timeline` 的 `m.room.message`。
4. `parseMentions` 产 `InvokeIntent(kind='mention', source='matrix', dedupKey=eventId)`；同一消息多目标会产多条同 `dedupKey` 意图。
5. `emit` 由 daemon 注入，最终进 `engine.ingest`；矩阵包不知道引擎是否接受、是否折叠、是否派工。`apps/daemon/src/engine/intents/taxonomy.ts:59`–`:67` 的 `checkMentionPayload` 是消费面结构校验；`apps/boot/src/boot.test.ts` 有跨包形状守护。
6. 失败/恢复：首拉前历史不产意图；停机期间消息丢失（78-§11.2 已声明）。**目标**：同步失败经 `report(classifyMatrixError(e))` 后按 `failure` 分类退避；`emit` 逐条 `try/catch`，任一条失败即 `report` 并终止本批、**不推进 `since`**，整批成功才推进；重放靠引擎 `intentKey` 去重；`stop()` abort 在途 `sync`，不再有 stop 后迟到 emit。

### 6.2 出站：事件 → 通知广播

1. daemon `assembly/notify/notify.ts` 在拍边界调 `relayEvents`；`engine/notify/route.ts` 把 `EventRecord` 规划成 `Notification` 与**逻辑频道角色**（`alert`/`overview`/`dept:<path>`）。
2. `engine/notify/relay.ts` 调 `NotifyBroadcastFace.send(message, targets)`；**现状**：该面由 boot 注入 `createMatrixBroadcastFace` 产物（`RunServeOpts.notifyBroadcast?`，80-§3.4；缺省为面关零行为，不是 `CONFIG_INVALID`）；**目标**：由 `matrixSessionFactory` 返回的 `notifyBroadcast` 面经 `RunServeOpts` 交给 daemon，直接注入仅作兼容。
3. `broadcast.send` 把角色转 alias：`#<slug>-alert:server`、`#<slug>-overview:server`、`#<slug>-<deptSlug>:server`；`resolveAlias` 得到 roomId；`formatNotification` 生成文本；**`redact(text)` 后** `client.sendMessage` 发送。三个角色都属于 80-§6.6 目标映射里的 **room 类**目标。
4. 失败：逐频道软失败入 `report.failed`，`reason` 已脱敏；daemon 记日志与 PATROL 计量；面板（:8789，读 events 台账）仍是 critical 第一落点（19-§六）；矩阵挂只意味着 IM 副本缺失。**目标**：至多一次发送，失败不自动重发（78-§11.2），缓存失效只供下次调用；未知回执按 78“记录未知”。
5. 本流程**不经过** `createMatrixNotifier`：`Notifier` 是单条单通道端口，在本包只有库级实现、生产未接线；生产出站是 `NotifyBroadcastFace`。80-§6.6 的另外两个目标（人事频道、`mcp-session`）不由本面承载：`mcp-session` 明确不经广播面，人事频道当前没有角色映射（§9.2）。
6. 出站脱敏（目标）：`createMatrixBroadcastFace` 必填注入 `redact: KnownSecretSet['redact']`（由 boot 从 daemon 装配期生成的集合取，80-§11.2.1）；每个频道在 `sendMessage` 前对格式化文本调用 `redact`，失败 `reason` 也过 `redact`。`redact` 抛错/返回非字符串 → 该频道**不发送**、`failed` 记 `notify-blocked`，daemon 落记录。`formatNotification` 与 `client.sendMessage` 永不做脱敏（单一实现点）。现状 `boot.ts:290`–`:296` 把未脱敏 reason 交给 `log` 的行为必须随注入一起改掉。

### 6.3 供给：公司频道与单据房间

1. 启动/热重载：daemon `assembly/channels/channels.ts:startChannelSupply/reEnsureChannels` 调 `MatrixRoomFace.ensureCompanyChannels()`；boot 的 `createMatrixProvisionFace` 每次 `snapshot()` 现取公司快照，映射为 `ChannelMapInput`。
2. `planChannelMap` 生成父空间 + 总览/大厅/告警/部门/小组/跨部门；`ensureSpace` 建/加入空间；`ensureChannel` 逐房 resolve/join/补邀/PL 全量覆盖/名称与 history_visibility 同值零写；`ensureSpaceChild` 挂子。
3. 派发：daemon `dispatchRoomDuty` 调 `onDispatched` → `ensureTicketRoom`；按 canonical/legacy 别名找房，按 D7 成员邀请，挂父空间；硬失败由 daemon 落 ESCALATE。**目标**：`face.ts` 把 `note` 经注入 `report` 上报（`ProvisionObservation`），不再静默丢弃；daemon 结构面仍 `Promise<void>`（§9.2-1）。
4. 关单：`closeRoomDuty` 调 `onClosed` → `archiveTicketRoom`；PL `events_default=50` + 名称前缀；无房 no-op；硬失败由 daemon 落 ESCALATE。**目标**：`note`/`found:false` 经 `report` 上报。
5. 恢复：所有 ensure 可重入；部分失败靠下一次启动/热重载/重派收敛；没有本地事务与锁；并发 ensure 可能交错，最后写入者覆盖。
6. 房间身份：一切对外引用以 **room_id** 为准，alias（canonical/legacy 双候选）只是解析入口。**目标**：`ensureSpace` 命中既有房间时校验 `m.room.create.content.type === 'm.space'`，不是 space 则记 `note` 且不当空间用；空间 PL/邀请 producer 的基线仍未定（78），本附录不发明（§9.2-5）。

### 6.4 人事：账号与房间权限

1. daemon `hrSync` 产生人事动作，经 `MatrixHrFace` 调本包 `MatrixHrTarget`（**现状**：boot 注入 `createMatrixHrFace` 产物；**目标**：由工厂的 `hrMatrixFace()` 给出）。
2. `ensureAccount` 用 `registrationSecret: SecretMaterial`（`SEC-MX-HR-SHARED`）注册；新号用一次性 token 设 displayname 并 logout；已存在号读 displayname，异值尝试 bot 代改，403 视为能力边界；`created` 只表示本次是否真建。**目标**：注册成功但设名/logout 失败抛 `partial/account-partial`，不再静默。
3. `ensureMembership` resolve alias → **读 `m.room.member`** → 已 join 才跳过 invite，否则 invite（403 不再吞）→ `setPowerLevel(memberLevel)`；`ensurePowerLevel` 读全量 PL → 同值不写 → 异值合并写；`kickFromRoom` 先读 membership，已不在房 no-op。
4. 风险（现状；目标已在上条与 F-matrix-client/hr-face 处理）：`setPowerLevel` 只写 users 会抹其它 PL 键；`M_FORBIDDEN` 过宽；`kick` 不幂等；注册后设名/logout 失败是部分成功未上报。
5. 秘密面：`registrationSecret` = `SEC-MX-HR-SHARED`（`kind:'shared-secret'`、`use:'matrix-register'`、`allowedUses:['matrix-register','outbound-redaction']`，由 `SecretProvider.load` 供给，**只在建号能力开启时加载**；缺失 ⇒ 拒该能力，不得退回 bot 密码）；员工密码由 daemon 逐人生成/持有，不属于 78-§7.4.1 的静态 catalog 条目；一次性注册 token 设名后 logout。三者都不得进错误文本或日志；出站前仍须过 `KnownSecretSet.redact`（§7.2）。`matrix` 不读 env、不持有 gatewaySecret、不持久化 secret。

### 6.5 传输：登录、限流、重启

- 登录一次，token 在 `MatrixClient` 实例内存；**现状** boot 多面共用一次登录（`boot.ts:343`–`:348`），这是待迁移的旧路径。**目标（80-§3.4 第 10 条）**：boot 不登录、不持 token，只构造 `matrixSessionFactory`；daemon 在装配期调工厂，由工厂内部完成一次登录并让四 thunk 共享同一 client 实例；`MatrixSessionHandles.close()` 释放 client，顺序在 `ledger.close` 之前。
- 429（现状）：`client.request` 读 `retry_after_ms`，等待后重试一次；缺省 2000ms、上限 30000ms；再 429 抛出，交给调用方（mention source 退避 / broadcast 软失败记一条 `failed` / hr 上抛）。**目标**：`client` 的“单次礼让重试”不变；`broadcast` 不整条重发（§8.3 第 3 步），`hr-face`/`provision` 由调用方决定是否整体重跑。
- 重启：无 token 持久化，重新 login（目标路径下由 daemon 经工厂重新登录，boot 侧无残留状态）；mention source 重新建基线；供给/人事靠服务端 ensure 收敛；未完成的通知/消息不重放。
- 重新装配不只靠重启（目标，80-§11.2.1）：秘密侧触发源只有两个——`file-ref` 文件 `mtime`/大小变化或 `SecretMaterial.version` 变化、部署控制通道（78 轮换/吊销通知面）投递“重建”事件；命中即**整体重建** `KnownSecretSet` 与秘密句柄，再按新版本重建会话（不是逐项热替换、也不是“等下次重启”）。重建失败保留旧可用集、标 `known-set-partial` 并落 `REC-LOSS-01`，禁止新秘密用途（本包只消费注入值，不感知集合状态）。

---

## 七、安全、秘密与出站

### 7.1 入站不可信

- `mentions` 把频道正文当不可信输入：围栏/引用/行内代码/邮箱/非文本过滤，宁可漏报；角色词映射由调用方配置，未知词不猜。
- `extractRoomMessages` 只接受形状合法的事件；`m.mentions` 形状不符整段丢弃，不猜。
- 但 `m.mentions.user_ids` 是客户端可伪造的结构化字段；本包只按 localpart 解析，不做发送者身份/授权校验。唤醒意图不是授权，是否派工归引擎。
- 没有 E2EE；21A-§5.7 要求建房不开加密，本包的 PL 基线用 `m.room.encryption: 100` 挡加密事件；这只在供给面生效，不能证明所有房间都未加密。

### 7.2 凭据与密钥

**本包涉及的秘密面**（`secretId` 与用途取 78-§7.4.1、80-§11.2.1 的同一套字段；本附录不另起命名）：

| 用途 | `secretId` | `kind` | `allowedUses` | 现状通道 | 目标 `valueProvider` | 缺失处置 |
|---|---|---|---|---|---|---|
| bot 密码（**仅登录**；`matrix-register` 保留未用） | `SEC-MX-BOT-PASSWORD` | `password` | `platform-auth` + `matrix-register` + `outbound-redaction`（本卷只消费 `platform-auth`） | env `MATRIX_BOT_PASSWORD`（boot 读取） | `env-ref` / `file-ref` / `broker-ref` | **拒启动**（`CONFIG_INVALID`） |
| HR shared secret / `registration_shared_secret`（**仅建号**） | `SEC-MX-HR-SHARED` | `shared-secret` | `matrix-register` + `outbound-redaction` | env `MATRIX_HR_SHARED_SECRET`，次选 `MATRIX_SHARED_SECRET` | 同上（建号用后即弃优先） | **拒该能力**（建号开启而缺失 ⇒ `CONFIG_INVALID`；未开启则不加载） |
| bot 访问令牌 | **不在 catalog** | —（登录派生） | — | `MatrixClient.login` 返回，只活实例内存 | 无 provider；重建即重登 | 登录失败=装配失败 |
| 员工密码 | **不在 catalog** | —（逐人生成） | — | daemon 生成后经参数传入 `ensureAccount` | 78/80 未列；由 daemon 侧持有 | 建号失败如实上报 |
| 按单 `wkey` | `SEC-WKEY-<ticketId>`（派生，非本包） | — | 只以 `outbound-redaction` 进 known set | 本包不接触 | `local-mint`（唯一例外） | 不派工 |

- **两柄不可互换（80-§3.4 第 10 条、§11.2.1）**：登录句柄 `MatrixBotLoginSecret` = `SEC-MX-BOT-PASSWORD` + `kind:'password'` + `use:'platform-auth'`；建号句柄 `MatrixHrRegisterSecret` = `SEC-MX-HR-SHARED` + `kind:'shared-secret'` + `use:'matrix-register'`。**bot 密码不得用于建号**（它的 `matrix-register` 是 catalog 上限里的保留位，不消费）；**HR 共享秘密不得用于登录**。建号能力开启而 `registration` 拿不到 ⇒ 拒该能力，不得降级为“只登录”。
- **`matrix-notify` 已关闭（编号保留）**：该 `SecretUse` 值**没有、也不需要**静态条目认领——78-§7.4.1 已把通知发送定为“用登录派生的访问令牌”，不另造 catalog 条目。本卷不为它造行、不加用途；缺口关闭，依据见 §9.2-7。
- **访问令牌不是 catalog 秘密**：会话 access token 只活在 `MatrixClient` 实例内存（目标：工厂返回的 client，由 daemon 持有至 `close()`），**没有静态 `secretId`**，不进 stdio 帧、不进日志、不进任务书/提示词/PRM/快照；重建或重启即丢弃重登。
- **不读 env、不落盘、不进上下文（目标）**：matrix 不调用 `process.env`；两个 catalog 秘密以 `SecretMaterial` 由调用方注入——登录取 `SecretProvider.load(SEC-MX-BOT-PASSWORD, 'platform-auth')`、建号取 `SecretProvider.load(SEC-MX-HR-SHARED, 'matrix-register')`（仅建号能力开启时）；`(value, version)` 只在调用栈/HMAC 内活，`login`/`registerWithSharedSecret` 用后不保留。token 只在 `MatrixClient` 实例内存；员工密码只逐人透传。本包不写 fs/台账/快照，也不日志这些值。
- **`KnownSecretSet` 不由本包生成**：由 daemon 装配期用 `SecretMaterial[]` 生成（80-§11.2.1）；matrix 只接收它的 `redact` 方法引用（`createMatrixNotifier`/`createMatrixBroadcastFace` 必填注入），**不接收集合本体、不遍历、不保存、不复制正则**。`hrKnownSecrets` 的字面量通道仅测试/装配兜底；生产来源走 provider。
- **空值/不可用/缺项的映射（80-§11.2.1，写死）**：`load` 取到**空串或零字节** ⇒ `Err(rejected_precondition, subcause:'secret-empty')`，**不返回材料**（不得返回 `value:''` 让调用方自己发现——空密码与“没配”运行期不可区分，下游会当有效凭据，属 fail-open）；provider 不可用（句柄坏、`broker-ref` 未就绪、文件不可读）⇒ `unavailable`（不是空值）；条目撤销/版本不符 ⇒ `rejected_version`。装配期**必需项** `Err` ⇒ 启动失败统一映射 `CONFIG_INVALID`（`detail` 保留原始 `failure`/`subcause`，不得改写成“缺失”）；**选项**（能力未开启/范围外）`Err` ⇒ 不装配该能力 + 落 `REC-LOSS-01`（逐项写 `secretId` 与受影响能力）。`known-set-empty` 合法但仍跑形状检测；`known-set-partial{missingSecretIds}` 中必需缺失**拒启动该能力**、可选缺失记 `REC-LOSS-01`。boot/daemon 未注入 `SecretMaterial`/`redact` 时 matrix 构造期 `configInvalid`，与“必需缺失拒启动”一致。
- **轮换/吊销的触发与路径（不只靠重启）**：触发源只有两个——① `file-ref` 秘密文件 `mtime`/大小变化，或 provider 返回的 `SecretMaterial.version` 与当前集合不同；② 部署控制通道（78 的轮换/吊销通知面，`rotationRef`/`revocationRef`）投递“重建”事件。命中即**整体重建**（重新 `load` 全部条目并整体替换集合与秘密句柄，不就地改元素、不逐项热替换）；无通知时允许对 `file-ref` 低频有界轮询（≥60s、只 `stat` 不读值）。重建失败保留旧可用集、标 `known-set-partial` 并落 `REC-LOSS-01`，**禁止新秘密用途**；吊销优先于轮换。本包不感知集合状态，只按注入值/`redact` 行事。
- **重启语义**：token 丢弃、重新 login；`SecretMaterial` 由调用方（目标：daemon）在新一轮装配/重建里重新 load；没有“上次凭据”的恢复路径。
- **测试夹具**：`hr-face.test.ts:52` 的 `SECRET = 'unit-shared-secret-0001'` 不符合 80-§11.6 的假秘密形状；目标改名 `test-*`（仅测试，不改语义）。

### 7.3 出站内容

- **强制出口清单里有 Matrix/通知**（78-§7.4.1「强制出口」一节）：顺序固定 `find` 判 → `redact` 改 → 才允许出站；闸自身异常/无法 import/超时都算未通过（fail-closed）；**未通过不发送**，记 `notify-blocked`。脱敏结果不等于“可安全发送”，它只保证不出现已知秘密。
- **现状**：`formatNotification`、`broadcast.send`、`createMatrixNotifier` 都不脱敏；`boot.ts:290`–`:296` 把 `log` 直接传给广播面，失败 reason（含服务端 `error` 文本、alias、roomId）未脱敏即落日志。
- **目标接线点（已定，写入 §1.3/§2.3）**：`createMatrixNotifier(client, { redact })` 与 `createMatrixBroadcastFace({ ..., redact })` 的 `redact: KnownSecretSet['redact']` **必填**；每个出站文本（`formatNotification` 结果）与每条失败 `reason` 在离开本包前调用 `redact`。`redact` 抛错/返回非字符串 → **不发送**，按 `notify-blocked` 记入 `failed`，由 daemon 落记录。`format.ts` 与 `client.ts` 永不做脱敏（单一调用点，避免第二套实现）。
- **脱敏函数的唯一来源**：`contract/src/secrets.ts` 的 `redactOutbound`/`findSecretShaped`（79-§3.6 迁入、80-§11.2.1 冻结），标记形 `<redacted:N>`；`matrix` 只持有注入的函数引用，**不得**私加正则/扫描器，也不得还原 `<redacted:N>`。
- **仍开的部分**：`notify-blocked` 的**记录**归 daemon（台账/事件），不在本包；boot 若忘记注入 `redact`，matrix 构造期 `configInvalid`，属装配前置（§9.2-4）。
- **可能带秘密的位置**：`Notification.title/body/links.url`、`Notification.from`（展示性，不得塞凭据）、广播失败 `reason`、`Error.message`（`client` 原样带服务端 `error`）、注入 `log` 的每一行。`from` 只是署名，不是授权主体，也不证明签署（80-§6.6）。
- **本包自身的义务**（不依赖闸门）：不把 token/password/sharedSecret 拼进错误文本；不日志消息正文；不自动重发（78-§11.2）；不把 `<redacted:N>` 当原值回填或还原。
- **未证的内容面**：Markdown 不转义（`**`、链接语法、`@` 词元原样进 body）、无长度上限（可能触发 Matrix 事件大小限制）、不校验 URL scheme；通知正文可能含外部文本（平台错误、工单标题）。这些与秘密脱敏是两件事，均未证，不得写成“已净化”。
- **入站不是脱敏对象**：`Authorization`、`wkey`、注册表单是校验对象；先脱敏再验签会让合法凭据变成 `<redacted:N>` 而永远失败（78-§7.4.1、80-§11.2.1 同口径）。

### 7.4 多公司与房间边界

- `createMentionSource` 的 `rooms` 现状可选，缺省监听账号可见的全部已加入房间。25-§3.4 v1.3 裁决 2 要求“一频道一公司”。**目标**：装配期必须显式给出白名单，缺省“全部房间”不再被接受（boot 校验并拒启；matrix 只按传入集合过滤）。理由：一个 bot 加入多公司房间时，缺省会把别家消息按当前 `company` 产意图。
- `broadcast` 的 `slug`/`deptSlugs` 是单公司参数；每公司一个 face 实例。`provision` 的 `ChannelMapInput` 也是单公司快照。没有跨公司聚合。

### 7.5 四条不许混的边界

- **秘密只经 catalog/provider 供给**：Matrix 两条秘密（`SEC-MX-BOT-PASSWORD`、`SEC-MX-HR-SHARED`）的权威在部署侧 catalog，TS 侧由 80-§11.2.1 的 `SecretCatalogEntry`/`SecretProvider` 取 `SecretMaterial`，脱敏集合 `KnownSecretSet` 由 **daemon 装配期**生成。两个用途各有专属条目：登录只取 `SEC-MX-BOT-PASSWORD` + `use='platform-auth'`（`kind='password'`），建号只取 `SEC-MX-HR-SHARED` + `use='matrix-register'`（`kind='shared-secret'`）；bot 密码的 `matrix-register` 是保留未用位，**不得**拿来建号，反之亦然（80-§11.2.1）。matrix 只接收注入值与 `redact` 引用：不读 env（目标）、不自建 catalog、不派生新条目，**也不改其他平台的 `secretId`**。
- **Matrix 只经 boot 构造工厂注入 daemon**：`matrix` 不 import `daemon`，`daemon` 不 import `matrix`；boot 只构造 `matrixSessionFactory` 并交给 daemon，**由 daemon 驱动登录**；四个结构面由工厂按需给出（`matrixSource()`/`matrixRoomFace(ctx)`/`hrMatrixFace()`/`notifyBroadcast`）——注意人事面是 `MatrixHrFace`，不是 `MatrixRoomFace`。边只有 `["boot","matrix"]`，**不新增 `daemon→matrix`**（80-§3.4 第 10 条、§12.1）。四面直连只是测试/迁移兼容形态，不是目标生产装配。
- **通知不是决定**：发送成功只表示 IM 副本已投递，不构成授权、承诺、验收或状态判断（78-§11.2「通知不是决定」）；发送失败也不回滚业务（§3 F-matrix-adapter）。
- **房间不是公司身份，会话不是岗位资格**：`room_id`/alias 是通信通道标识，不能替代 `company` slug，也不构成组织归属证明（25-§3.4 裁决 4）；`mcp-session` 或房间里的会话存在不证明有人在岗、有权或岗位资格成立——岗位资格只归 `REC-WORK-08`/`TS-PORT-WORK-08 QualificationPort`（80 记录表），不能从本包的房间、消息或通知回执推导。

---

## 八、规模、拆分与迁移

### 8.1 硬门禁与现状

- 目录（现有）：`packages/matrix/src` 15 个文件，阈值 25；余量 10。测试与源码同目录，也计入。
- 目录（目标）：`src` 直下 19（11 生产 + 8 测试）、`src/provision` 4；分别 19/25、4/25。
- 文件（现有）：最大 `provision.ts` 598 行（余量 2），`client.ts` 465（余量 135），`provision.test.ts` 480（余量 120），`adapter.test.ts` 376，其余更小。硬门禁 600。
- 文件（目标预算）：`client` ≤520、`provision/ensure` ≤260、`plan`/`ticket` ≤220、`adapter` ≤200、`session.test` ≤200、`hr-face` ≤190、`broadcast` ≤180、`session` ≤140、`errors`/`face` ≤120、`provision` facade ≤80；全部 <600，无一件需要 `lineBaseline`。
- `scripts/guards/boundary-rules.mjs:159`–`:182` 的 `lineBaseline` **没有** `packages/matrix` 条目；本包没有可继承的超限基线，也不得新增基线。
- `domainPlaneBaselines` 只覆盖 daemon 的 engine/control/evolve/assembly，不覆盖 matrix；本包没有冻结的域平面，也不新增。`src/provision` 是普通子目录，不是“域平面”。
- `test/engine` 直属 25 件的限制不适用于本包（本包没有 `test/engine`）；本包测试在 `src`，受同一 25 件目录阈值。

### 8.2 拆分已定：`provision.ts` → facade + 四个子件（目标件）

`provision.ts` 598 行、零余量；目标语义（`Result`/错误分类/`note` 观测/空间身份校验）都是净增行。因此拆分是**目标件**，不是条件方案（理由见 §1.3）。顺序：

1. **`src/provision/plan.ts`**：类型 + 纯规划 + 小工具（`planChannelMap`/`mxidOf`/`serverNameOf`/`aliasLocalpart`/`dedupSorted`/`isActive`）。无 IO、无循环。
2. **`src/provision/ensure.ts`**：`ProvisionClient`/`EnsureRoomResult`/`putStateIfChanged`/`ensureSpace`/`ensureChannel`/`ensureSpaceChild`/`ensureCompanyChannels`；`isNotFound` 改调 `errors.ts`。
3. **`src/provision/ticket.ts`**：单号命名/成员/开房/归档/`ARCHIVED_PREFIX`。
4. **`src/provision/face.ts`**：`createMatrixProvisionFace` + `ProvisionObservation` + `report` 注入。
5. **`src/provision.ts`**：只剩逐字 re-export 的 facade（≤80 行），`index.ts` 与 `provision.test.ts` 的 import 不变。

约束：每步独立可编译；不得改测试断言语义来适配拆分；不得新增公共导出概念；不得为拆分新增 `lineBaseline`。`errors.ts` 必须**先于**第 2 步落地（`ensure`/`hr-face` 共用判据）。

`client.ts` 若未来超过 520 行/逼近 600，按端点族拆为 `src/client/transport.ts`（request/429/错误体）、`src/client/core.ts`（login/send/sync）、`src/client/admin.ts`（register/whoami/profile/logout）、`src/client/room.ts`（createRoom/alias/invite/join/kick/state/members/power），以 `MatrixClient` facade 保持构造与方法名。**该拆分仍是条件方案，不计入目标件。**

### 8.3 迁移顺序（目标，未实施）

1. 先落 `errors.ts`（无消费者），再让 `client.ts` 用它构造错误；此步不改任何公开签名，只改错误对象形状（`MatrixApiError` 仍 `Error` 子类）。
2. 拆 `provision.ts` 四步（plan → ensure → ticket/face），每步包级 typecheck + 现有 `provision.test.ts` 零断言改动通过；`note` 上报（`report`）在 facade 完成后单独一步。
3. 改读写语义：`client.setPowerLevel` 全量合并；`hr-face.ensureMembership` 先读成员再邀、`kick` 先读成员；`ensureSpace` 校验 `m.space`；`adapter` 逐条 `emit`/`since` 后推进/abort；`broadcast` 去自动重发。
4. 接注入项：`createMatrixNotifier`/`createMatrixBroadcastFace` 必填 `redact`；`createMentionSource` 必填 `report`；`createMatrixHrFace` 收 `SecretMaterial`。此步依赖 boot 装配同步改（§9.2-4），本包不能单方面完成。
5. 装配面切换（v0.4/v0.5）：先落 `session.ts`（无消费者，只有 `session.test.ts` 用假 client 验形状与两个秘密句柄的校验），再改 boot 为“只构造工厂、不登录、不持 token”，最后在 daemon 补 `RunServeOpts.matrixSessionFactory`、`MatrixBotLoginSecret`（`load(..., 'platform-auth')`）与**仅建号开启时**的 `MatrixHrRegisterSecret`（`load(..., 'matrix-register')`），并切到生产路径。**这一步跨三包，必须三包同批验证；本卷只给出 matrix 侧目标件。**
6. 补测试（`errors.test.ts`、`session.test.ts` 与 §4.1 列出的目标用例）→ 更新 README 的“已验证/未证”与计数。不得把 fake 测试称为真机。

### 8.4 构建/分发迁移

- 当前 `exports` 指向 `src/index.ts`，不切 `dist`；根 program 覆盖；包级 typecheck 存在但根脚本没有逐包串接（matrix 不需要，因为仍在根 program）。
- 若未来纳入分发：按 79-§6.5 先确认不在闭包内；按 79-§7 提供 `dist/index.js` + `.d.ts`、`files`、README/LICENSE、许可决定；切换后 matrix 的 `src` 退出根 program，包级 typecheck 必须并入根脚本；不得用 `paths` 回引 `src`，不得默认引 project references。当前不做。

---

## 九、未证、缺口与需回写

### 9.1 本包未证清单

以下均无运行证据，不能写成“支持”：

1. 真实 Synapse 的 login/register/sync/send/createRoom/alias/invite/join/kick/state/members/power_levels 行为；所有网络测试都是 fake。
2. 真实 `m.mentions` 的客户端 pill/`formatted_body` 渲染与收端高亮；本包只写 `m.mentions`，不证明渲染。
3. 真实 long poll 的 25s 行为、网络超时、连接中断、服务端 429 的 `retry_after_ms` 分布。
4. 真实 timeline `limited`/分页/补拉；`sync` 没有 filter/limit，首拉可能很大。
5. E2EE；明确不支持。
6. token 持久化；明确不做，重启重登。
7. 真实并发：多进程/多实例同时 ensure、同一房间 PL 读改写、alias 缓存失效竞态。
8. 真实权限：bot 是否有权邀请/改 PL/踢人；`M_FORBIDDEN` 的真实语义分布。
9. 空间可见性/父空间权限：`ensureSpace` 不写 PL、不邀请 producer；子房是否对制作人可见未证。
10. PL 保留：`setPowerLevel` 只写 users，真实房间其它字段是否被抹除未在测试中覆盖（按 Matrix state 语义应为整份替换）。
11. 多公司隔离：`rooms` 缺省为全部已加入房间；跨公司消息是否会被错误归属未证。
12. 通知出站脱敏、长度上限、Markdown 注入、URL scheme 安全未证。
13. 契约 cases：`packages/contract/cases.json` 没有 mention/notifier 匹配；本包没有契约 runner 覆盖。
14. 真实限流节奏：`invitePaceMs` 缺省 350ms、限流退避 5s 只是工程经验，未在真实 Synapse 上证明。
15. 通知幂等/回执：广播面无 `id` 轴（`NotificationEnvelope` 为 N/A），单条去重归调用方；没有“确定未发出 / 回执歧义 / 回执迟到”的可判别类别；重复投递与漏投都未测。
16. 脱敏闸未接线：`KnownSecretSet` 与 Matrix 通知面之间没有调用点；`notify-blocked` 没有落点；形状命中/已知值命中对通知正文的效果未测。
17. `Notifier` 目标形状未实现：`NotifySendReceipt`、构造期 `rejected_precondition`/`configInvalid` 都未落到本包或 contract（`NotificationEnvelope` 为 N/A，见 §2.5）。
18. 空间权限：空间 PL/邀请 producer/既有房间是否真是 space 均未测；子房可见性只在 fake 状态机里推演。
19. 会话工厂（`session.ts`）**不存在**：目标形状、`close()` 语义、thunk 是否惰性/幂等，全部只有文档推演，无实现、无测试、无真机。
20. “boot 不登录、daemon 驱动登录”的切换未执行：boot 现在仍登录并持 token（`boot.ts:131`–`:157`、`:343`–`:348`）；daemon 侧 `RunServeOpts.matrixSessionFactory` 的接线与登录驱动都没有代码，`close()` 是否真在 `ledger.close` 之前也未验。
21. `use='platform-auth'`/`use='matrix-register'` 两条取秘密链无运行证据：`SecretProvider` 在仓内尚不存在（§9.2-2），登录/建号分属两个条目（`SEC-MX-BOT-PASSWORD` 与 `SEC-MX-HR-SHARED`）只有 80-§3.4 第 10 条/§11.2.1 的条款，没有端到端证据。
22. `matrix-notify` 缺口按 78-§7.4.1 关闭后，通知链路仍是“登录派生 token”；该链路本身（token 注入广播面、重启后重登再发）无运行证据，不能把“文档已闭口”当成“链路已验”。
23. 空值/不可用/缺项的装配映射无运行证据：`secret-empty` 不返回材料、必需 `Err` ⇒ `CONFIG_INVALID` 且保留 cause、选项 `Err` ⇒ `REC-LOSS-01`、provider 不可用 ⇒ `unavailable`，都只有 80-§11.2.1 的条款；本包与 daemon 两侧都没有测试或真机。
24. 轮换/吊销的“整体重建”未实现也未验：触发源（`file-ref` mtime/`version` 变化、部署控制通道重建事件）、重建失败保留旧集并标 `known-set-partial`、吊销优先，均无代码与运行证据；现状仍是“改 env 后重启才生效”。
25. 两个秘密句柄的互斥负向无证据：`bot 密码进 registration` / `HR 共享秘密进 login` 必须 `configInvalid`，只有目标断言（`session.test.ts` 未写）。

### 9.2 跨卷对象：已定案、已关闭与仍开缺口（80/78/77/52/17/01/boot）

**已由 78/80 定案、本附录按定案执行的部分（不再作为回写项）**：

- **`Notifier` 与 `NotifyBroadcastFace` 是两件事**（80-§6.6）：前者是单条单通道端口（`send(channel, message)`，目标带 `NotifySendReceipt`），后者是向一组逻辑目标广播的注入面（`send(message, targets)`，返回 `{sent, failed}`）。`createMatrixNotifier` 是前者但**生产未接**；生产出站是后者。剩余差是实现（`NotifySendReceipt` 与 `Result`），不是文档；信封不在本包（§2.5）。
- **四个注入面没有对应的端口 ID**（80-§12.1）：通信绑定通过 `InvokeSource` / `MatrixRoomFace` / `NotifyBroadcastFace` / `MatrixHrFace` 四个结构面进入运行时，`daemon` 不 import 实现；本附录不另造 ID，也不要求 80 补 ID。
- **`Notification.from` 是展示性字符串**（80-§6.6）：不是授权主体、不证明签署，不得改成对象；本包只做尾行渲染。
- **`channel=room_id` 合法**（25-§3.4 裁决 4：通道标识不透明、alias/id 归实现自由；78-§11.2 未要求 alias）：alias 只用于出站路由与房间解析，README/注释不得写成“channel=alias”。

**仍开的跨卷缺口（每条点名卷/节/文件与 matrix 侧的临时处置）**：

1. **daemon 四个注入面没有 `Result`/观测位（80-§12.1、`docs/81-files/17-daemon-assembly-cli-control-evolve.md`）**：`MatrixRoomFace.onDispatched/onClosed`、`MatrixHrFace.ensureMembership/ensurePowerLevel/kickFromRoom` 返回 `void`，`NotifyBroadcastFace.send` 的 `NotifySendFailure` 只有 `reason`。matrix 目标只在**自己这侧**加 `report`/`ProvisionObservation`，不改跨包签名；若 daemon 要机械分流“未发出/未知”，需 80 扩结构面（另立实现单）。
2. **contract 的 `Notifier`、错误类型与秘密端口未升级（01-contract、80-§5.7/§6.6/§11.2.1）**：`contract/src/ports/notifier.ts` 仍是 `send(...): Promise<void>`，无 `NotifySendReceipt`；`contract/src/schemas/errors.ts` 的 `ClassifiedErrorSchema` 缺 `failure`，且无 `FailureClass` TS 承载（G-16）；`contract/src/ports/secret.ts` **尚不存在**（`SecretCatalogEntry`/`SecretProvider`/`SecretMaterial`/`KnownSecretSet` 只在 80-§11.2.1 的目标态，`packages/contract/src/ports/` 现只有 company/executor/gateway/index/invoke/kernel/models/notifier/platform），`secret-empty`/`unavailable`/`rejected_version` 与“整体重建”也都没有实现落点。matrix 只能按 80 写目标签名，**不能**自造同名类型、自建秘密供给、或私自扩展 contract。
3. **（已撤回，编号保留）** ~~daemon 的 `assembleApi` 仍收 `engine`~~：v0.3.1 复核时确认这是**过期指控**——`docs/81-files/17-daemon-assembly-cli-control-evolve.md` 的 W-19 已把该项列为已回写，该卷现写 `assembleApi(deps: { ingress; ledgerPath; company; config })`、不收 `engine`，与 80-§9.4 一致。本条不再成立，不再计入“仍开缺口”；保留编号只为避免 §9.2 其余条目（-1/-2/-4/-5/-7 均被正文引用）整体位移。
4. **boot 装配前置未落（apps/boot）**：`redact`（`KnownSecretSet['redact']`）、源 `report`、多公司 `matrixRooms` 白名单都必须由 boot 注入（**现状口径**；v0.4 目标里前三项随工厂参数走，秘密值由 daemon 传）；缺任一项 matrix 构造期 `configInvalid`（fail-closed）。**目标（80-§3.4 第 10 条）改为**：boot 只构造 `matrixSessionFactory`（**不登录、不持 token、不读秘密值**），登录与 `SecretProvider.load(..., 'platform-auth')`、建号 `load(..., 'matrix-register')` 都在 daemon 侧；**工厂与任一直接面同时出现 ⇒ `CONFIG_INVALID` 拒启动**（不比较“是否矛盾”，也不择一静默）；四面各自单独出现仍合法（测试/迁移）。boot 当前仍读 env、仍登录、仍把裸 `log` 传给广播面（`boot.ts:131`–`:157`、`:290`–`:296`、`:343`–`:348`），需随 §8.3 第 4/5 步同步改。
5. **78 未给空间权限基线（78-§11.2/§7.4.1）**：`ensureSpace` 是否要写空间 PL、是否邀请 producer、子房可见性靠 `history_visibility=shared` 是否足够，均无定论。matrix 目标只做“校验既有房间确为 `m.space` + 记 `note`”，**不发明**空间 PL 基线。
6. **人事频道的 target 归属（80-§6.6）**：目标映射写“人事变更 → 人事频道”，但 `NotifyBroadcastTargets` 只有 `alert`/`overview`/`dept:<path>`；matrix 不私加 role/alias。需 80/78 给角色名或明确走 `dept`/单发 `Notifier`；新增 target 走提案。
7. **（已关闭，编号保留）** ~~`matrix-notify` 的 `SecretUse` 没有条目认领~~：78-§7.4.1（第 1017–1019 行）已答——通知发送用登录派生的访问令牌，**`matrix-notify` 不认领任何静态条目**；`SEC-MX-BOT-PASSWORD` 的 `allowedUses` 为 `platform-auth` + `matrix-register` + `outbound-redaction`，`SEC-MX-HR-SHARED` 仍只有 `matrix-register` + `outbound-redaction`。80-§11.2.1 的 `SecretCatalogEntry.allowedUses` 语义与此一致。本卷据此不再为 `matrix-notify` 造条目、不加用途；缺口关闭。保留编号是为避免 -8/-9/-10 与正文引用（§7.2、§9.3）整体位移。
8. **通知回执是否一等记录（77、78-§11.2、80-§6.6）**：78 要“消息事件 ID + 去重记录 + 通知回执”，80 说证据是 `TickReport.events` 的中继事实 + `REC-OBS-02`。matrix 只回 `{sent, failed}`，不产记录、不造 `REC-NOTIFY-*`；口径需 77 定。
9. **PL 并发写边界（52-§7.3）**：目标 `setPowerLevel` 已改全量合并，但两次读-改-写并发仍会最后写入者覆盖；供给面与人事面同时 ensure 同一房时的优先级/重试策略需 52/80 明确。matrix 不引入 fencing（没有服务端 CAS 可用）。
10. **`Result`/`Ok`/`Err` 载体在仓内尚不存在（80-§5.7、01-contract）**：`grep -rnE --include=*.ts "export (const|function|type|interface) (Ok|Err|Result)\b" apps packages` 零命中——`Result` 只在 80 的目标态出现，没有 TS 定义或构造器。因此本卷第 2.3/3 节写的 `Promise<Result<NotifySendReceipt, ClassifiedError>>` 属**目标签名**，在 contract 落地载体前不可实现；matrix 不自定义 `Result`，也不用 `{ ok: boolean; reason?: string }` 之类的布尔+可选字段冒充三态（80-§5.7 明文禁止）。落地顺序：contract 先给载体 → matrix 再改 `adapter`/`hr-face` 返回形状。

### 9.3 其他文档/实现冲突（25/52/20/78 自身回写；交主 agent）

1. **52-§7.2 的 mac 公式**写成 `nonce\0user\0password\0(not admin)\0(0|1)` 五段；`client.ts:162`–`:164` 与 `hr-face.test.ts:67`–`:68` 按官方四段 `nonce\0username\0password\0notadmin` 实现。21A-§2.3 只描述“nonce+HMAC-SHA1+POST”，未给五段。应以官方 register API 字节口径为准，回写 52-§7.2；本附录不改代码。
2. **20-§十五.二横向表**把 `matrix` 列进 `apps/daemon` 的允许依赖；`boundary-rules.mjs` 的冻结边里 Matrix 只有 `["boot", "matrix"]`（`:106`），没有 `daemon→matrix`，与 25-§一.2、80-§12.1 一致。按“规则文件为准”回写 20-§十五.二表格。
3. **README 测试计数**与 **test fixture secret 形状**属于本包文档/测试卫生，目标替换/改名；本次不执行。
4. **`provision.ts:35` 的 `sleep` 定义在 import 之前**：ESM import 提升，行为无问题，但不符合常见风格；不影响语义，登记为风格项，不单独立单。
5. **78-§11.2 的“语义事实”一行仍写 `adapter.ts: createMatrixNotifier（发送通知）`**，与 80-§6.6 的“`Notifier` 与 `NotifyBroadcastFace` 分离、生产出站是广播面”不一致；按 80 为准，78 该行应改为“`createMatrixNotifier` 是库级未接的 `Notifier` 实现”。属 78 自身回写，不改本包。
6. **25-§4.2 的 `Notification` 片段仍无 `from?`**，而 contract 已有、80-§6.6 已定其为展示性字符串；属 25 文档滞后，按 contract/80 为准。
7. **25-§3.4 的“通知实现”与 80-§6.6 的出口分层**：25 只写 `Notifier`，没有 `NotifyBroadcastFace`；两卷不冲突但粒度不同，建议 25 补一行“生产出站是注入面，不是 `Notifier`”，避免读者把两者混成同一端口。
8. **78-§7.4.1 仍写“bot 密码同时服务建号与登录”，与最新 80 冲突**：78 第 1010 行把 `SEC-MX-BOT-PASSWORD` 标为“建号/登录密码”，第 1017 行明写“同时服务建号（`matrix-register`）与 boot 登录（`platform-auth`）”；80-§3.4 第 10 条与 §11.2.1（第 3274、D23 行）已改为**建号只认 `SEC-MX-HR-SHARED` + `use='matrix-register'`**，bot 密码的 `matrix-register` 是**保留未用**位。本卷按最新 80 执行；78 该两行属自身回写（交主 agent），本附录不改。
9. **78 的行号漂移**：v0.4 引用的“78 第 1010/1011/1017–1019 行”经复核仍成立（78 现 1933 行），但 78 一旦回写第 8 条，需重核该区间。

---

## 十、复核边界

- 本次只做只读源码盘点、文档阅读与静态计数；**没有运行测试、没有启动 daemon/boot、没有启动真实 Synapse、没有改任何生产代码/依赖/lock/guards**。
- v0.2/v0.3/v0.4/v0.5 都是**文档修订**：只改本附录，未新增任何运行证据；§9.2 的“已定案/已关闭”来自 78/80 的条款，不是本包的验证结果。
- 静态 `it(` 计数 96 不是测试运行结果；不能据此声明“全绿”。v0.3 新增的“目标签名/拆分/N/A/缺口”、v0.4 新增的“会话工厂/装配切换”与 v0.5 新增的“两柄分离/空值映射/重建语义”均为**设计与文档对齐**，没有对应测试或真机证据。
- 真实 Matrix/Synapse、E2EE、限流、分页、并发、权限、出站脱敏、多公司隔离、provision 拆分后行为均未证；本附录不构成 V2–V6 证据。
- 所有“目标-保留/替换/新增/拆分”都是设计处置；`README` 替换、`errors.ts`/`session.ts` 创建、`provision.ts` 拆分、注入项接线与现有代码修订**均未实施**，未改 `package.json`/`bun.lock`/`tsconfig`/guards。
- 本版计数可复算：现有 18 件（生产 9 / 测试 6 / 配置 3）；目标 26 件（生产 15 / 测试 8 / 配置 3）= 保留 16 + 替换 1 + 新增 8 + 拆分 1。
- **行号复核（2026-10-27，v0.3 收尾）**：本卷全部 `apps/boot/src/boot.ts` 锚点（`:35`–`:44`、`:131`–`:157`、`:164`–`:184`、`:290`–`:296`、`:343`–`:348`）已逐段对照 376 行的实际文件，内容与所述一致；另核 `provision.ts:35`（`sleep` 在 import 前）、`provision.ts:40`–`:41`（`powerLevelTarget` 同源 re-export）、`client.ts:162`–`:164`（四段 mac）、`hr-face.test.ts:52`、`hr-face.test.ts:67`–`:68`、`boundary-rules.mjs:139`（`["matrix","contract"]`）、`boundary-rules.mjs:159`–`:182`（`lineBaseline` 无 matrix 条目）。这是**静态行号核对**，不是行为验证。
- **静态计数复核（同批）**：6 个测试文件的 `it(` 逐文件计数 15/8/7/10/31/25 = **96**，`describe(` 4/2/1/4/8/6 = **25**，与 §4.1 一致；`packages/contract/cases.json` 对 `matrix`/`mention` 零命中（§9.1-13）。同样只是静态核对。
- **v0.3.1 校订复核（2026-10-27）**：只做引用、表述与渲染修正，未增删任何事实断言、未改任何计数（仍 18/24 件）。复检项：全文件代码围栏只有 §1.3 目标树一处成对（无裸围栏）；所有表格逐块 `|` 计数与表头一致；`TS-PORT` 不再以通配形式出现（仅保留真实的 `TS-PORT-NOTI-01` 与 `TS-PORT-WORK-08`）；`F-contract-ports-*`、`F-daemon-assembly-*`、`MergeHostView`、`openLedgerReadOnly` 在本卷**本就不出现**，按“实际存在才改”不补造、不改写；`openLedgerReadonly` 按 80-§8.2 的小写拼写保留。这是**静态文本核对**，不是运行验证。
- **v0.4 校订复核（2026-10-27）**：本版只改本文件——新增 `F-matrix-session`/`F-matrix-test-session` 两个目标件契约（计数 24 → **26**，生产 14 → 15 / 测试 7 → 8），把 §6.5/§7.2/§7.5/§8.3/§9.2 的登录与秘密口径收到 78-§7.4.1、80-§3.4 第 10 条（登录 `platform-auth`、建号 `matrix-register`；**建号秘密在 v0.5 更正为 `SEC-MX-HR-SHARED`**；boot 只构造工厂、daemon 驱动登录；不新增 `daemon→matrix` 边），关闭 `matrix-notify` 缺口，并把 `taxonomy.ts` 锚点从旧 `:49`–`:60` 校正为实测 `:59`–`:67`。复检：围栏 **2 条**（只有 §1.3 目标树一处成对，正则扫描无第三条）；表格逐块 `|` 计数与表头一致（零 mismatch）；残留旧值扫描（`27`–`:35`、`taxonomy.ts:49`、目标 14/测试 7、17/25）零命中。**未跑测试、未跑 typecheck、未连 Matrix、未改代码。**
- **v0.4 行号复核（同批）**：新增/受影响锚点已逐条对照当前工作树——`room-duty.ts:57`–`:64`（`MatrixRoomFace` 与 `MatrixRoomFaceContext`）、`broadcast.ts:33`–`:36`（`NotifySendReport`）与 `:39`–`:41`（`NotifyBroadcastFace`）、`hrsync.ts:58`–`:63`（`MatrixHrFace`）、`taxonomy.ts:59`–`:67`（`checkMentionPayload`）、`boundary-rules.mjs:91`（`matrix: 1`）、`:106`（`["boot","matrix"]`）、`:139`（`["matrix","contract"]`）、`boot.ts:131`–`:157`/`:164`–`:184`/`:290`–`:296`/`:343`–`:348`/`:347`/`:349`–`:375`（376 行文件）。`apps/daemon/src/assembly/hrsync/run-serve-opts.ts` 存在但**仍无** `matrixSessionFactory` 键（目标态）。静态核对，不是行为验证。
- **v0.5 校订复核（2026-10-27）**：只改本文件，按最新 80-§3.4 第 10 条/§11.2.1 收口四项——① 建号句柄改为 `MatrixHrRegisterSecret`（`SEC-MX-HR-SHARED` + `kind:'shared-secret'` + `use:'matrix-register'`），登录仍是 `MatrixBotLoginSecret`（`SEC-MX-BOT-PASSWORD` + `kind:'password'` + `use:'platform-auth'`），两柄不互换、仅建号能力开启才加载 `registration`、缺失拒该能力；② 工厂与任一直接面同时出现一律 `CONFIG_INVALID`（不判“矛盾”，各自单独存在合法）；③ 补 `secret-empty`/`unavailable`/`rejected_version` 与“必需 ⇒ `CONFIG_INVALID` 保留 cause、选项 ⇒ `REC-LOSS-01`”的装配映射，并把轮换/吊销改为“文件版本或部署控制通道触发整体重建”（不是只能重启）；④ 同步 `session.ts` 契约、`session.test.ts` 契约与 fake、§6.1/§6.4/§6.5/§7.2/§7.5/§9.1/§9.2/§9.3 与版本头。计数不变（仍 **26** 件 = 生产 15 / 测试 8 / 配置 3）；表格零 mismatch、围栏仍 2 条。**未跑测试、未跑 typecheck、未连 Matrix、未改代码。**
- **并发写者披露**：本文件 v0.2 由另一个进程（`claude -p`，PID 22529）在 2026-10-27 04:35–04:38 期间写入（728 → 776 行）；该进程于 04:41 前退出，本版基于 776 行快照做增量修订并新增 v0.3 段。若该进程再次覆盖同一文件，可能出现两套说法，需主 agent 决定保留哪版。
