# 87 · 独立验证——工程/资产/叙述类断言（N14–N17）

> 验证人：GLM-5.3（独立验证员，非 v2 卷作者）
> 日期：2026-10-26（实读取证日）
> 对象：docs/v2/、docs/plan/、AGENTS.md、packages/company/、packages/adapters/src/agentconfig.ts、
> apps/daemon/src/assembly/serve.ts、/Volumes/BigDisk/companies/studio-dev/company/（只读）
> 方法：全部结论以实读原文与源码行号取证；判定取值：成立／部分成立／不成立。
> 纪律：本报告只读取证，不修改任何被验对象；公司目录未做任何写操作。

---

## N14 · 台账权威升格与 AGENTS.md 三事实源表的字面冲突

### 命题

V2 把台账（事件账）从「可重建投影」升为「权威事件账」（分域权威表中事件域 DOM-03 为权威源），
但 AGENTS.md 的三事实源表仍写「SQLite 台账＝可重建投影」——新旧宪法字面冲突未处理。

### 我的证据

**冲突字面存在（实读两处原文）：**

- `AGENTS.md:12-18`：三条事实源表，末行原文——「SQLite 台账 | 事件 / 工时 / 成本 / 报表快照——**可重建投影** | daemon」。全文无任何 V2 过渡头注。
- `docs/v2/05-技术抽象-总规范与框架总装.md:124`（§三分域权威表 DOM-03 行）：「工作事件、成本事件、证据、结清（新数据）｜**唯一权威＝台账 append-only 事件**｜SQLite 索引、汇总表＝投影｜daemon｜事件可重放重建投影」。权威与投影方向与 AGENTS.md:18 正好互倒。
- `docs/v2/05:126`（DOM-05）：records「**不是第四事实源**，禁止自称权威」；`docs/v2/05:136`（通则 5）：旧 17/02/78/80 关于「三事实源/台账不是事实源」的互斥句**全部废弃**，以本表为唯一口径（DSF P0-1）——V2 明确宣告废弃 v1 互斥句族。

**但「未处理」不成立——修订义务已多处登记：**

- `docs/v2/00-总纲与文档地图.md:14`：「不替代 AGENTS.md（但 V2 定稿后 AGENTS.md **须按 V2 修订其事实源/唯一写入者条文**——DSF L0-A/L1-B 已证其自相矛盾）」；`v2/00:35`（B 现行宪法表）：「AGENTS.md 待按 V2 修订事实源条文」。
- `docs/v2/09-….md:380`：B 类（AGENTS.md/49/84/84b）中 AGENTS.md 事实源条文按 V2 修订，「登记 DEC-OPEN 与各卷审计表」。
- `docs/v2/15-技术细节-安全面.md:98`：「AGENTS.md 事实源表按 V2 修订时引本表（SEC-WD-03）」。
- `docs/plan/03-里程碑与波次.md:223`：「AGENTS.md 事实源条文修订（**V2 定稿后统一办理**——v2/13 §1.4 登记，非波内动作）」；`docs/v2/13:27` 同口径。

即：字面冲突**此刻真实存在**（AGENTS.md 物理未改），但处置已被四卷登记为「V2 定稿后统一办理」，并非无人认领的漂移。风险在「定稿后办理」悬空于波次之外（plan/03:223 明言非波内动作），若定稿门后遗忘即成断言所指状态。

### 判定

**部分成立**——「升格+字面冲突」成立；「未处理」不成立（已登记待执行，物理修订未发生）。

### 修法方向

1. 短期最小修：AGENTS.md:12-18 表加一行过渡头注「V2 双基线期：本表以 docs/v2/05 §三分域权威表为最终口径，修订已登记（v2/00 §一）」，消除新 worker 首读误判。
2. 把「AGENTS.md 事实源条文修订」从「非波内动作」改为绑定 F8 定稿门出口清单（可复算验收项），不让修订义务悬空。
3. 修订时按 v2/15:98 要求引 SEC-WD-03 写路径对照表，与「唯一写入者在机制层面成立」判据联动。

---

## N15 · 资产域「两个写入者表述」与「两个清单」问题

### 命题

V2 资产部（ASSET-）存在两个写入者表述（分域权威表写 daemon/部署，公司包卷写 daemon/网关）；
且 V2 声明 assets.yaml 为资产唯一索引，而现实公司目录用 dependencies.yaml，迁移方案未退役/别名旧文件。

### 我的证据

**写入者两说（实读三卷原文）：**

- `docs/v2/05:128`（DOM-07 行）：唯一写入者＝「**daemon/部署**（传播语义 06）」。
- `docs/v2/06-技术抽象-公司目录与公司包.md:121`（§3.6）：「资产清单与资产文件归公司目录（权威＝公司 git 目录，写入者＝**daemon/网关**，挂单 commit）」，同句自称「引用 v2/05 分域权威表，**本卷不另立权威声明**」——但其写入者用词与主表不一致（「网关」≠「部署」；「框架网关」在 DOM-02/v2 语汇里特指平台写入路径身份，DOM-06 的「部署责任者」是另一域身份）。
- `docs/v2/11-技术细节-运行记录与行为契约.md:88、218、693`（ASSET 域/REC-ASSET-01）：三处均写「daemon/**部署**」——与 v2/05 一致，反衬 v2/06:121 是孤例异写。

**清单现状（实读仓与公司目录）：**

- `docs/v2/06:93`（§3.2）：「资产清单（目标文件位 `assets.yaml`，§四.1）是资产部**唯一索引**」；`v2/06:148-149`（表 5）：`dependencies.yaml`（定义部，可选，需求候选生成器）与 `assets.yaml`（**新增（目标）**）两行并存——V2 规范层未退役旧文件，而是分工（候选生成器 vs 唯一索引）。
- 现状实现：`packages/company/src/dependencies.ts:94` `DEPENDENCIES_FILE = 'dependencies.yaml'`（B-5 逐文件 schema、热重载指纹均锚此文件）；`templates/company-game/`、`templates/company-internet/` 脚手架实带 `dependencies.yaml`（实测 `templates/company-game/dependencies.yaml` 存在，head 核实内容为属性→dsh 插件映射）。
- **现实公司目录（studio-dev）实测**：`ls /Volumes/BigDisk/companies/studio-dev/company/` 根下**既无 dependencies.yaml 也无 assets.yaml**（仅 README.md、charter.md、org-config.yaml、.studio-next.yaml、departments/、docs/、prompts/、reports/）——是零资产公司，与 v2/06:93「无 dependencies.yaml 即零插件公司」自洽。断言举例「现实公司目录用的是 dependencies.yaml」对 studio-dev 不成立；用旧清单的是 templates/（脚手架）与 packages/company（实现）。
- **迁移方案未退役/别名（成立）**：`grep dependencies.yaml|assets.yaml docs/v2/16-技术细节-逐文件蓝图与迁移.md` **零命中**；MIG-05 行（v2/16:110）只写「资产部装载面＋org-config 只读兼容声明（至 MIG-08）」，v2/16:82 只写「templates 8 公司模板随 v2/06 纯配置迁移」——无任何清单文件的退役/别名/双读迁移条目。v2/06:116 只把 dependencies.yaml 收窄为「需求候选生成器」并说「51 文本修订与迁移归 v2/16」，而 v2/16 并未接住这一句。

### 判定

**部分成立**——「两处写入者表述不一致」成立（v2/06:121 vs v2/05:128+v2/11 三处）；「assets.yaml 唯一索引、迁移未退役旧文件」成立（v2/16 零条目）；但「现实公司目录（studio-dev）在用 dependencies.yaml」不成立（该目录零清单文件；用旧清单的是模板与实现包）。

### 修法方向

1. v2/06:121 的写入者改引主表原词（daemon/部署），或如确需「网关」身份，先在 v2/05 DOM-07 行统一改词并同步 v2/11 三处——一域一写入者一名，禁止同义词漂移。
2. v2/16 MIG-05 补一行清单文件迁移条目：dependencies.yaml 的去留（退役/降级为只读候选源/别名）、packages/company schema 与 8 模板的切换时点、双读兼容窗口与验收命令——接住 v2/06:116 转卷的「迁移归 v2/16」承诺。
3. v2/17 追溯表为「DOM-07 写入者一致性」加一条机械自检行（同域写入者用词全库唯一）。

---

## N16 · 「公司脱离人运行」被写成将被狗粮验证的事实

### 命题

施工方案（plan/07）把「公司脱离人运行」表述为从某波起「成为被验证的事实」，而 V2 根卷
（v2/01）明确该主张是「目标（未证）」且施工期设有多个人工裁决点。

### 我的证据

- `docs/plan/07-执行方式选项.md:176`（§六理由摘要，实读原文）：「施工全程『公司脱离人运行』从 **MIG-04 起成为被验证的事实**而非口号，同时保留 C 作缺陷修复与停机窗的机动通道。」——把一个尚未发生的验证结果以将来完成时断言为「事实」。
- `docs/v2/01-根-公司自治总纲.md:18`（总前提，实读原文）：「后半句（脱离具体人独立运行）是**目标（未证）**——制度化与继承路线**不得写成已实现**（85c Q5；84b §六.R10）」；`v2/01:357` 缺口处置口径三值「已解／方向已定／目标未证」，无「将被验证为事实」一档。
- 施工期人工裁决点（多处实读）：plan/07:23「框架验收岗+**人闸**（宰相∪制作人∪派单策划）」；:33「人闸批示→下一单」；:145「制作人＝终审+人闸」；:168 切换判据 G3「制作人撤销停机令并批施工期预算上限」；§七（:181-190）P1–P4 全部「待制作人拍板」。施工组织本身即含人工环节，「脱离人运行」在施工期字面即不成立。
- 佐证叙述不严：plan/07:62 把该主张出处引作「AGENTS §一」——实读 `grep 脱离|独立运行 AGENTS.md` **零命中**；主张真源是 v2/01:18 所引「84b §一.1」，属错引。plan/07:121（R-C3）亦自认 C 段「零 dogfooding……目标在施工期完全未被检验」。

缓和事实：plan/07:3-4 自标「v1.0-draft｜宰相参考序，非结论」，决策人是制作人——但这不改变其文本将未证主张表述为「将被验证的事实」这一叙述缺陷。

### 判定

**成立**——plan/07:176 原文、v2/01:18 禁令、施工期人工裁决点三者全部实读核实；错引出处（AGENTS §一）为附带发现。

### 修法方向

1. plan/07:176 改写为验证口径：「从 MIG-04 起进入狗粮验证窗口，以 V2 运行时证据（台账四要件）对『公司脱离人运行』出具验证结论；出具前该主张维持目标（未证），登记 v2/17 缺口表」。
2. 修正 plan/07:62 出处：AGENTS §一 → 84b §一.1（经 v2/01 §总前提）。
3. 「被验证的事实」若要保留，须绑定可复算判据（如「N 波连续无人闸干预单占比+全部终态事件可追溯」），由 v2/17 追溯行承载，不在推荐理由段定性。

---

## N17 · v2/15「已核代码事实」锚点用短文件名不能唯一定位

### 命题

V2 安全卷现状代码锚点使用短文件名（serve.ts:NNN、agentconfig.ts:NNN 等），按仓内同名文件
定位会找错（如 engine/ 下没有 agentconfig.ts，真实在 adapters/）——「已核代码事实」的锚点
不能唯一定位。

### 我的证据

**锚点全量提取**：v2/15 §一表共 10 处 `.ts:NNN` 锚点（v2/15:40-46）。本验证抽验 9 处
（覆盖全部 8 个短名/带路径文件）。

**同名唯一性（`find apps packages -name <file>` 实测，排除 node_modules）：**

| 锚点（v2/15 行） | 仓内同名件数 | 是否可唯一定位 |
|---|---|---|
| `wire.ts:34`、`wire.ts:39`（:40-41） | **2**：apps/daemon/src/engine/directive/wire.ts、apps/daemon/src/assembly/platform/wire.ts | **否**——两份同名；实测 directive/wire.ts 第 34-39 行是 InvokeIntent 接口定义，与卷述「!config.gateway 返回裸 platform」完全无关，短名读错件即得无关内容 |
| `serve.ts:784`（:41） | **2**：apps/daemon/src/assembly/serve.ts（935 行级）、apps/daemon/src/cli/serve.ts（**仅 60 行**，784 行不存在） | 名义二义、实际可排除（另一份无该行） |
| `packages/company/src/trust.ts:86-109`（:42） | 1（带包路径） | 是 |
| `packages/store/src/migrations.ts:47`（:43） | 1（带包路径） | 是 |
| `agentconfig.ts:235-236`（:44） | **1**：仅 packages/adapters/src/agentconfig.ts（engine/ 下实测无 agentconfig*，find 为空） | **是**——断言举例此件「会找错」不成立：短名全仓唯一，文件名搜索即得唯一件 |
| `judge/invoke.ts:174`（:44） | invoke.ts 共 **2**（packages/contract/src/ports/invoke.ts、apps/daemon/src/engine/judge/invoke.ts），锚点带 judge/ 段 | 实际可区分 |
| `engine.ts:504`（:45） | 1 | 是 |
| `packages/panel/src/external/server.ts:445/487`（:46） | server.ts 共 **4**（studio-tools、panel、panel/external、panel/overview），锚点带全路径 | 是 |

**内容相符性（逐处 Read 实际行，9/9 相符）：**

- assembly/platform/wire.ts:34＝`if (!config.gateway) {`→log 警告→`return raw`（裸 platform，仅 warn）——与 SEC-FC-01 描述一致；:39＝`const usingDevSecret = config.gatewaySecret === undefined`——与 SEC-FC-02 一致。
- assembly/serve.ts:784＝`secret: new TextEncoder().encode(config.gatewaySecret ?? DEV_GATEWAY_SECRET)`——回落公开常量，与 SEC-FC-02 一致。
- trust.ts:86-109＝`readTrustAnchor`：无文件/坏 JSON/形状不符 → `return null`（无锚）——与 SEC-FC-03 一致。
- migrations.ts:47＝`'CREATE TABLE events ('`；实测触发器：migrations.ts 内 personnel_events/probes_runs/price_snapshots 各有 no_update/no_delete（:141/:144/:345/:348/:488/:492），cost_daily 的在 `packages/store/src/cost.ts:61-62`——「events 是唯一无触发器的台账表」描述属实（SEC-FC-04）。
- agentconfig.ts:235-236＝BUILTIN_FACTORIES.dsh 工厂 `return new DshAdapter(cmd, …)` 不含 seatbelt 字段（缺省 off）——与 SEC-FC-05 一致。
- judge/invoke.ts:174＝`seatbelt: {`（judge 面 DshAdapter 接线处）——与 SEC-FC-05「唯一接线在 judge 面」一致。
- engine.ts:504＝`actor: 'daemon'`（ENGINE_CONFIG_DEFAULTS 常量）——与 SEC-FC-06 一致。
- external/server.ts:445＝`if (platform === undefined || ledger === undefined)`（注入无强制）；:487＝`platform.issues.create(…)`（裸 platform 写路径）——与 SEC-FC-07 一致。

**缓解事实**：v2/15:6 头注列了三个主要参照件**全路径**（apps/daemon/src/assembly/platform/wire.ts、packages/gateway/src/gateway.ts、apps/daemon/src/engine/tools/gated-platform.ts），wire.ts 短名可借头注消歧；trust/migrations/server 三处本身带包路径。真正裸短名且同名二义的仅 wire.ts 两处（有害二义）、serve.ts 一处（可自然排除）。

### 判定

**部分成立**——「锚点短名不能唯一定位」对 wire.ts（有害二义：另一同名件同段行号内容完全无关）与 serve.ts/server.ts/invoke.ts（名义二义）成立；内容相符性 9/9 无一失实；但断言所举反例 agentconfig.ts 恰是全仓唯一件（engine/ 下确无、adapters/ 有，短名搜不会找错），该例不成立。

### 修法方向

1. v2/15 §一表锚点统一升为仓根相对路径（`apps/daemon/src/assembly/platform/wire.ts:34` 形态）；至少 wire.ts/serve.ts/server.ts/invoke.ts 四族必须带消歧段。
2. 卷末附「锚点—文件对照表」（短名→全路径→行号），并纳入 v2/17 机械自检：锚点短名在仓内 find 计数＞1 即判负。
3. 内容侧无需修正——所抽 9 处「已核代码事实」与源码全部相符，问题只在定位性不在真实性。

---

## 汇总表

| # | 断言摘要 | 判定 | 最关键证据 |
|---|---|---|---|
| N14 | 台账升权威 vs AGENTS.md「可重建投影」字面冲突未处理 | **部分成立** | 冲突实存：AGENTS.md:18 vs v2/05:124（权威/投影互倒）；但修订义务已登记四处（v2/00:14、v2/09:380、v2/15:98、plan/03:223「定稿后统一办理」），非「未处理」 |
| N15 | 资产域两个写入者表述＋两个清单、迁移未退役旧文件 | **部分成立** | 写入者两说实存：v2/05:128「daemon/部署」vs v2/06:121「daemon/网关」（v2/11 三处从主表）；v2/16 grep 零迁移条目成立；但 studio-dev 公司目录实测无任何清单文件（零资产公司），「现实公司在用 dependencies.yaml」不成立 |
| N16 | plan/07 把「公司脱离人运行」写成将成事实，v2/01 定为目标未证 | **成立** | plan/07:176「从 MIG-04 起成为被验证的事实而非口号」vs v2/01:18「目标（未证）——不得写成已实现」；施工期人闸/制作人拍板多点（plan/07:23/145/168/§七）；附带发现 plan/07:62 出处错引（AGENTS §一，实为 84b §一.1） |
| N17 | v2/15 短名锚点不能唯一定位、按同名会找错 | **部分成立** | wire.ts 有害二义实锤（engine/directive/wire.ts 与 assembly/platform/wire.ts 同名，34-39 行内容无关）；serve.ts(2)/invoke.ts(2)/server.ts(4) 名义二义；但内容 9/9 相符，且断言反例 agentconfig.ts 全仓唯一（仅 adapters/ 一份），该例不成立 |

> 总评：四条断言中一条成立（N16）、三条部分成立（N14/N15/N17）。共同病灶是 V2/PLAN 文档
> 群在「主表—引用卷」「规范—迁移」「叙述—根纲」三对关系上的用词与转卷纪律执行不严；
> 抽验的全部代码事实（N17 的 9 处锚点内容）无一失实——问题集中在定位性与口径统一，
> 不在事实造假。
