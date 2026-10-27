# V08 · 协作平台链审计（DSF 纵向：YouTrack → FlowPlatform → Taiga/LocalFile → 网关 → 多公司）

> 审计员：V08（独立审计，非作者）｜审计日期：2026-10-27｜口径：`docs/audit-DSF/_scope-DSF.md`
> 纵向对象：**协作平台/网关/流程事实/多公司**。读法：指定 13 卷全文分段读（03/21/23/25/26/30/32/46/51/71/75/78/82，共 5609 行），代码只读核对；未改任何现有文档、源码、配置。
> 证据纪律：位置给 `docs/xx.md:line` 或代码 `path:line`；事实与判断分列；不确定标「未证」。

---

## 一、结论

- **计数：P0 = 4，P1 = 5，P2 = 4；关键断点 8 条（§2.2）。**
- **最严重 1（P0-01 公司包边界反转）**：51 仍把 `plugins/` 列为目录契约内"唯一允许的代码位"，并在初始化链写"依赖清单自动安装"（51:38/161/196）；而 71/75/78/82（呈审中的目标技术细节；75-§七 D1 明确"是否正式替代旧包内代码例外"仍待制作人裁，75:268）要求定义包纯配置、能力包独立提取并单独授权（71:252-253、75:150、78:920、82:623）。现行 51 与目标设计对"导入一家公司是否执行代码"给出相反答案，且 D1 未裁期间 51-§八 的"自动安装"是唯一现行规则。
- **最严重 2（P0-02 网关署名/动作回不到决定人）**：`SignedBody.author` 实际恒为 `daemon`，控制面 key 同进程自铸自验，建单/状态迁移/setField 全部以 `@action comment` 借道（25:306、03:60、71:155 vs `serve.ts:791`、`engine.ts:504`、`gated-platform.ts:94/150/155/160`）。03-N9 的 actor 四元组与 71-§2.1"签名回到实际任职"在 daemon 写面不成立。
- **最严重 3（P0-04 多公司写路径无公司维）**：外部 API 支持 `?company=` 多公司读，却只有一个注入的 `platform`；daemon 只取 daemon.yaml 的 `platform/taigaProject` 与单一 `company`，运行时不读 org-config 的 `platform`，无一致性校验（23:31、25:197、25:286 vs `serve.ts:151/156`、`wire.ts:130-150`、`validator.ts:530`、`external/server.ts:445/487`）。错绑/跨公司写不会被拒绝。
- **次严重（P0-03）**：`gateway: false` 是合法 daemon.yaml 键（`wire.ts:34`），关掉即裸 platform；加平台 UI 直改无对账、Taiga created 事件轮询不可见（78:1291、25:226），"唯一写入者"是配置+纪律，不是机制。
- **P1 面**：三平台均无平台侧"第二道闸"且 82 无探针（P1-01）；平台语义损失未逐项、绑定卡不合 78-§1.2（P1-02）；Matrix 单 bot 身份与 21-§六-1 验收不可达（P1-03）；51 workflows 无 L3 承接（P1-04）；26 回填与新记录层/MIG 脱节（P1-05）。

---

## 二、纵向链表与关键断点

### 2.1 链表（对象/承诺逐层追踪）

| # | 层 | 文档:节 | 承诺/对象 | 下一层如何承接 | 断点 / 漂移 / 新增 |
|---|---|---|---|---|---|
| 1 | L0 事实源 | `00`/`03-§一`；AGENTS.md | YouTrack = 流程事实源，写入只经网关 wkey | L1 `03-§二` 分工 → L2 `23-§一` FlowPlatform 七能力 → L3 `25-§3.2`/`78-§9` → 代码 yt/taiga/localfile | **断**：L2 把"唯一"换成"七能力可换"；"唯一写入者"未随端口下沉，78 只写"单写者（框架）"，不含 onboard/外部 API/平台 UI 三类写者。 |
| 2 | L0/L1 状态控制 | `18-§二.3`（据 `25:310` 引）、`25-§4.1`、`03-§二` | 状态推进不在工具白名单；平台侧第二道闸 | L2 `23-§一 guards` → L3 `78-§9.2-9.4` → 82 探针 | **断**：三实现均无 guard 执行（78:1266/1287/1307）；82 的 16 条探针无一条测它。 |
| 3 | L1 身份 | `03-N9` | 任一单据 actor 可还原（公司,工号,账号,署名） | `25-§3.2` actor=平台账号名+工号翻译"归后续刀"（改名：工号 → 平台账号 → daemon 控制身份）→ `78-§7.4.1/§11.2` → 代码 | **断**：author 恒 `daemon`；YT 账号 1:N、Taiga 账号 1:1；翻译机制未定义。 |
| 4 | L1 多公司 | `03-§三 N1/N8` | 公司=一个项目，承载权限域；公司级隔离 | `23-§二` 每公司 platform → `25-§3.5 snapshot.platform` → `78-§9.3` → 代码 | **断**：单实例/单项目/单凭据；org-config platform 运行时不读；外 API 单 platform。 |
| 5 | L1 公司声明流 | `51-B-1/W-1..W-9`、`18-§2.1` | 公司声明状态集/锚点/边，零代码 | `78-§9` 只映射 STAT-D，**status provision 缺失** → `82` V0/V1 输入 75–81（不含 51）→ 代码仅 localfile 派生 | **断**：W 规则无验证；Taiga statuses 来自旁挂 `FieldProvisionMap`，非 51。 |
| 6 | L2 平台替换六检 | `71-§6.1` | 身份/工作语义/写入收口/活动/关联/导出逐项检查 | `76 REC-LOSS-01` → `78-§1.2` 20 字段/§9 卡（**逐项 loss 表缺失**）→ `82` 符合性声明 | **断**：平台卡缺 losses/semanticDigest 等必填字段；`78-§9.5` 表空；webhook 无端口/接收端契约。 |
| 7 | L1 IM 身份 | `21-§四/§五/§六` | 每 agent 一个 Matrix 账号；@工号物化工单；两 agent 一问一答 | `25-§3.4` channel→company → `78-§11.2` 单 bot（**per-agent 账号/发送主体缺失**）→ 代码 `adapter.ts:101` | **断**：单 bot+self 过滤；21-§六-1 不可达；channel→company 不在 78/82。 |
| 8 | L2 绑定档案 | `78-§1.2` | 20 字段、版本+semanticDigest 引用 | `82` 符合性声明 `bindingRefs` | **断**：平台卡不符 §1.2；按 78:195 应判"无效引用"。 |
| 9 | L1 回填 | `02-F2-13`、`26` | 20401 事件/212 done 回填 events/work_records | `78-§10.1` events 仅投影、三表才是记录层 → `82 MIG-03` | **断**：目标层已变；26 的 7 拍板/6 待验证无波次；"25 类事件" vs "30 事件名"。 |
| 10 | L1 平台限制 | `03-§三`、`30-§3.1`、`32-§二` | 10 用户/角色不可 API → 账号=等级锚点"永久决策" | `25-§3.2` actor → 78/82 | **断**：Taiga 无上限、roles API 可写，前提消失但决策未复核。 |
| 11 | L2 端口面 | `25-§一/§三` | 五端口冻结；改端口先改本文 | `78-§9.1` binding.ts/`PlatformBindingPort` → `82 TS-PORT-BIND-01`/55 端口 | **断**：25 无该端口、版本史未记；82 又声明"不新增端口"。 |
| 12 | L2 路线 D | `46-§三` | LocalFile 原生 guard、双真源问题消失 | `78-§9.4`/代码 | **断**：guard 只落盘，实际是 daemon 单闸。 |

### 2.2 关键断点（8 条，及失效对象）

| # | 断点 | 直接依据 | 会让哪条根命题/权责/验收失效 |
|---|---|---|---|
| K1 | 公司包可执行代码 + 自动安装 vs 纯配置/能力包独立（D1 未裁） | 51:38/161/196；71:252-253；75:150/268；78:920；82:623 | D1 目标"定义包纯配置、能力包独立授权"；D1 未裁期间的导入安全边界与 82 停止条件的一致性 |
| K2 | 网关署名=daemon、状态迁移借道 comment | 25:306；03:60；71:155；`serve.ts:791`；`gated-platform.ts:94/150` | 03-N9 actor 四元组；71-§2.1"签名回到实际任职"；审计可回放性 |
| K3 | 唯一写入者可被配置关闭/存在直写/平台 UI 直改无对账 | 25:196；78:1449/1509/1291；`wire.ts:34`；`serve.ts:322-326` | AGENTS.md 三事实源表；25-§1"中心件=唯一写入者"；82 的写路径验收 |
| K4 | 多公司写路径无公司维、平台绑定双源 | 03:48/60；23:31；25:286；25:197；`serve.ts:151/156`；`external/server.ts:445/487` | 03-N1/N8 公司级隔离；23-§二"换平台=改一行"；跨公司数据边界 |
| K5 | 第二道闸在三实现均不存在 | 03:33；23:16；78:1266/1287/1307；82:731-750 | 03-§二"平台扛状态迁移 guard"；25-§4.1"状态推进不可得"的双层保证 |
| K6 | 语义损失未逐项、平台卡不合 78-§1.2 | 78:164-187/195/1262-1341；25:226；`taiga/kb.ts:13` | 23-§三"换平台不换语义"；25-§六-2 双实现一致性验收 |
| K7 | 51 workflows 无 L3 承接（无 status provision、无 W 规则验证） | 51:70-109/193-197；78:1237；82:136/396；`git-import.ts:452` | 公司权责是平台流程的投影；51-§七规则集测试纪律；82 V0/V1 覆盖 |
| K8 | 26 回填目标层与新记录层脱节 | 26:83-85/155-156/279-304；78:1405/1409/1410；82:597-609 | F2-13 回填可成立性；MIG-03 记录层迁移的可验收性 |

---

## 三、发现表（脚手架 §四-2；§2 为纵向特有的链表）

### 3.1 P0（4 条）

| ID | 级别 | 类型 | 位置 | 事实 / 引文 | 为什么错 | 修复路径 |
|---|---|---|---|---|---|---|
| V08-P0-01 | P0 | A/F/G | `docs/51-公司仓库规范正文.md:38`、`:161`、`:196`；`docs/71-技术抽象-执行能力与工作运行.md:252-253`；`docs/75-技术细节-总纲与工程决策.md:150`；`docs/78-技术细节-宿主平台与工作区绑定.md:920`；`docs/82-技术细节-验证迁移与追溯.md:623` | 〔事实〕51 目录契约含 `plugins/<插件名>/`（"唯一允许的代码位"，dsh 插件形态），D-4 要求其为 dsh.bundle，§八 初始化链写"依赖清单自动安装"。71：旧包内 `plugins/` "应先被提取、识别为独立能力包并单独授权，不能作为纯配置公司包的一部分继续获得导入例外"。75-D75-04：定义包只含惰性配置（75:150）；但 75-§七 D1 又把"是否正式替代旧包内代码例外"列为待制作人决定（75:268）。78：公司目录"不承载执行位"。82 MIG-04 停止条件："导入产生可执行内容/秘密/绝对路径"。 | 判断：现行规范（51，normative schema:1 的唯一标尺）与目标设计（71/75/78/82，呈审稿）对"公司包能否带代码"给出相反答案，而 D1 未裁使过渡期没有规则：按 51 导入一家外部公司时，其插件可进判定器并通过，71/78 的 H0a→H0b→H2 能力授权链被绕过；按 82 的停止条件，任何带 `plugins/` 的合法公司仓又都被判非法。"自动安装"进一步把"能安装"当"可授权"，缺激活批准/部署供给确认。若 D1 裁定为禁，则 51 现行为须立即失效；若裁定为宽，则 82 的停止条件须改。 | 二选一并版本化：①51 v1.2 把 `plugins/` 移出封闭集，改为独立能力包清单（D-4 改判）；②在 75/82 明确 schema:1 过渡豁免的审查/授权主体与到期。最小改：51 §八"自动安装"降为"仅到 H0a（落位）"，H0b/H2 另走 71-§3.4；§二 A-1/D-4 标"schema:1 legacy，待 v1.2 移除"。 |
| V08-P0-02 | P0 | A/F/D | `docs/25-端口与协议.md:306`；`docs/03-YouTrack-对接方案.md:60`；`docs/71-技术抽象-执行能力与工作运行.md:155`；代码 `apps/daemon/src/assembly/serve.ts:791`、`apps/daemon/src/engine/engine.ts:504`、`apps/daemon/src/engine/tools/gated-platform.ts:94/150/155/160` | 〔事实〕25-§3.2/§4.1：`SignedBody { author: PersonId }`，注"v1.2：author=工号一等公民"；03-N9：任一单据 actor 可还原（公司,工号,账号,署名）四元组；71-§2.1：平台签名应回到实际任职与调用关系，而不是给工具匿名归属。代码：daemon 身份 `ctx={company, dept: departments[0].path, role:'daemon', level}`，`author=ENGINE_CONFIG_DEFAULTS.actor`，而 `ENGINE_CONFIG_DEFAULTS.actor='daemon'`；`comments.add` 用 `signedBody(ctx, author, body)`（`author='daemon'`）；`issues.create/transition/setField/links.link/fields.provision/guards.*` 全部 `gate('comment',{op:'...'})`，头注自承"控制面身份，非人员工号——拟稿口径"。 | 判断：`author` 的值 `daemon` 不是工号（25-kernel：PersonId=工号=档案文件名=永不变主键），署名部门取 `departments[0]` 也与本次工作责任部门无关；平台侧评论作者=`SignedBody.author='daemon'`；评论条目的平台作者是 JWT 操作者（32:71-72 实测为 admin/worker-*），状态变更的 history actor 也是平台账号（`packages/taiga/src/activity.ts` 的 `toPlatformActivity` 取 `entry.username`）——三个面都不是工号，都回不到"谁决定的"。网关只看到并校验 `comment`，`op` 自述不参与校验；若以 `GATEWAY_ACTIONS` 作审计/授权口径，状态迁移与评论不可区分。78-§5.4"状态推进永不在工具集"只对 worker 面成立，对 daemon 自身借道 comment，与 03-N9、71-§2.1 直接冲突。 | 二选一：①25/78 增控制面动作族（gated-platform 头注已列为待批项）并把 `op` 纳入网关校验；`SignedBody.author` 扩为 `{actorKind:'person'\|'control', actorRef, onBehalfOf?}`（或新字段），明确控制面作者不是工号；②若坚持 author=PersonId，daemon 写必须携带决定人/工号+决定记录引用，不得用常量。最小修：先把 03/25 的四元组限定为"仅 worker 经 MCP 的写"，并给控制面写一个新口径；再补 `op` 校验与审计探针（transition 不得显示为 comment）。 |
| V08-P0-03 | P0 | A/D/F | `docs/25-端口与协议.md:196`；`docs/78-技术细节-宿主平台与工作区绑定.md:1570-1581`、`:1449`、`:1509`、`:1291`；代码 `apps/daemon/src/assembly/platform/wire.ts:34`、`apps/daemon/src/assembly/serve.ts:322-326/403`、`packages/panel/src/external/server.ts:445/487`、`packages/gateway/src/gateway.ts` 头注 | 〔事实〕25-§3.2："平台适配器的写方法只被 gateway 调用（17-§7），核心其他模块走只读面。"代码：`wireGatedPlatform` 在 `!config.gateway` 时**直接返回裸 platform**；`gateway` 是合法 daemon.yaml 键（缺省 true），注释自承"false=裸 platform；仅测试/对照用，生产不得关——头注警告"，无 fail-closed 校验。控制 key 由 daemon 每次 `issueControlKey()` 现铸、同进程验签。78-§11.1 自承外部 API 现状"POST /v1/requests 直写幂等键并直调 platform.issues.create"；78-§9.2 对 YT 外部直改只说"可检测但成本高"；78-§9.3 Taiga"建单事件缺席…主通道应为 webhook"，25-§3.2 注"created 以 webhook 为主通道，轮询不保证"，但 78/82 无 webhook 端口、接收端、验签、去重、事件映射与探针。78-§10.3 对 SQLite 已承认"唯一写入者是部署纪律，不是机制"。 | 判断："唯一写入者"在三种情况下不成立：①配置关闸（合法键）；②非 daemon 写路径（外部 API 的 platform 注入无强制；78:1509 自承现状直写；onboard/迁移脚本按 wire.ts:145-149 注释为独立写面，是否经网关未证）；③平台 UI 直改（Taiga 连 created 都看不到，无对账）。控制面自铸自验使"闸"退化为同进程信封；82 的 P-78-13 只测写回执，PB-6 只测"YT 写只经网关"，没有"无网关不可写"的负向。该命题是 AGENTS.md 三事实源表与 25-§1"中心件=唯一写入者"的根，按 78-§10.3 自己的标准即未达"机制"。 | ①`gateway:false` 在存在公司目录/非 demo 平台时拒启（fail-closed），或从 daemon.yaml 删除该键、只在测试装配注入；启动时把 gated/ungated 记入台账。②外部 API 只允许注入 gated platform（或在同进程装配），并把"注入裸 platform"判为装配错误。③为 Taiga 补 webhook 接收契约（或 IntentSource）+验签/去重/事件映射；若不做，明写"平台 UI 直写不支持"并由平台角色权限禁止，同时在 82 增"绕过网关直调 adapter 必须无路径/失败"的负向探针。④78-§11.5 把"外部网关"改称"同进程信封闸"，不得称独立授权。 |
| V08-P0-04 | P0 | A/F | `docs/03-YouTrack-对接方案.md:48`、`:60`；`docs/23-协作平台解耦.md:31`；`docs/25-端口与协议.md:197-198`、`:286-287`；`docs/78-技术细节-宿主平台与工作区绑定.md:1289`；代码 `apps/daemon/src/assembly/serve.ts:151/156/403`、`apps/daemon/src/assembly/platform/wire.ts:130-150`、`packages/company/src/validator.ts:530`、`packages/panel/src/external/server.ts:246/445/480/487`；旁证 `docs/50b-对账-技术设计核心链.md:97` | 〔事实〕03-N1：公司=一个 YouTrack 项目，承载权限域+编号域；N8：公司级隔离=项目团队。23-§二："换平台 = 公司配置改一行 + 适配器实现存在"。25-§3.5：`CompanySnapshot.platform = PlatformBinding`。25-§3.2："适配器实例=公司作用域…guards 的 company 键与 transition 的单号在实例内自洽"；78-§9.3："公司作用域=项目；不一致显式报错"。代码：daemon 配置只有 `platform: 'localfile'\|'taiga'\|'fake'`、`company: string`、`taigaProject`；`wirePlatform(config)` 建**单实例**；daemon 运行时不读 `snapshot.platform`（仅 `cli/validate.ts:25` 打印）；company validator 的 `platform` 缺省 `'youtrack'`，而 daemon 枚举无 youtrack（且 78-§9.2 明说 YT 未接 daemon）。外部 API 按 `?company=` 解析多公司读，但触发面 `const platform = opts.platform` 是单实例，`issues.create` 无 company/project 维，响应却写 `company: picked.slug`、幂等键也按 `picked.slug`。50b:97 的对账表已记"engine 单公司…多公司刀前必补"。 | 判断：写路径没有"公司→平台实例/项目/凭据"路由与一致性校验；`POST /v1/requests?company=B` 的票据会落到该 platform 绑定的项目（可能是 A），却以 B 的名义记账/回包。23-§二"改公司配置一行"与实现相反：改 org-config 的 platform 不改变运行时绑定，必须改 daemon.yaml，且无提示；两个事实源（org-config platform / daemon.yaml platform）无优先级与一致性规则；字段映射同样不在公司目录（`PlatformBinding.fieldOverrides`/`taigaFieldsFile`；51-B-1 只有 `platform?`、无字段声明），公司权责→平台字段的投影也没有单一源。25-§3.2 的"实例=公司作用域"只是构造方式描述，不是隔离机制；没有注册表、每公司凭据或拒绝面，82 也无多公司探针。 | ①daemon 启动时读 `snapshot.platform` 与 daemon.yaml 的 platform/project 比对，不一致即 `CONFIG_INVALID` 拒启（一行校验即可关闭静默错绑）；②明确唯一绑定源（建议 daemon.yaml 部署面），org-config `platform` 降为"声明/期望"，在 23/25/51 写清；③外部 API 触发面按 `?company=` 解析平台实例，或只允许单公司时省略 company，并对不一致返回 4xx；④82 增"跨公司/错绑必须拒绝"负向探针；⑤若决定"一 daemon 一公司"，在 23/25/78 明写该拓扑并把多公司降为多进程，否则补公司→适配器注册表。 |

### 3.2 P1（5 条）

| ID | 级别 | 类型 | 位置 | 事实 / 引文 | 为什么错 | 修复路径 |
|---|---|---|---|---|---|---|
| V08-P1-01 | P1 | A/D/E | `docs/03-YouTrack-对接方案.md:33`；`docs/23-协作平台解耦.md:16`；`docs/78-技术细节-宿主平台与工作区绑定.md:1266`、`:1287`、`:1307-1308`、`:129/130/131`；`docs/82-技术细节-验证迁移与追溯.md:731-750`；代码 `packages/localplatform/src/guards.ts:4-5`、`packages/yt/src/index.ts:10`、`packages/taiga/src/guards.ts:5-8` | 〔事实〕03-§二 分工表把"状态迁移 guard（第二道闸）"列为平台扛；23-§一 `guards` 注释"平台侧第二道闸"。78：YT `guards.install/uninstall/read` 抛 `CONFIG_INVALID/yt-guards-not-implemented`（显式不支持）；Taiga"无状态转换 guard…退化为项目角色写权限收窄"；LocalFile"guards 只落盘不执行（`guards.ts:4-5`），真正的闸=daemon state-diff；平台侧第二道未来在 `transition()`"。且"角色收窄"的角色集没有"公司权责→平台角色"映射表：03-N8 是 YT 专用（6 内置角色→9 账号、一次性 UI），30-§6-⑤ 只写"等级锚点角色集"，25-§3.2 的 `PlatformRole` 无公司/等级维。78-§0.7 索引：YT guards 不支持=blocking，Taiga 无转换 guard=degrading，LocalFile guard 只落盘=degrading。82-§12.3 的 16 条探针无一条测"非法转换被拒"。 | 判断：三实现都没有"平台侧拒绝非法转换"的可执行能力；同一缺失在 78 索引里给两种严重度（YT blocking / Taiga·LocalFile degrading），不可比，也无法据此判断"不完整实现"的范围。03/23 仍把它写成平台能力，30-§4 已承认 Taiga 回退但 03/23 未改。权限投影因此也没有承接：被收窄的是 onboard 自建角色，不是公司权威模型（等级/部门/岗位），"权限是公司权责的投影"无法判定。82 的验证矩阵没有探针或 GAP 承接，导致"P0/P1 清零"无法覆盖这条控制；若声明"第二道闸存在"，属把未证写成已证。 | ①03-§二/23-§一 加现状注记："当前三实现无平台侧转换 guard；第二道闸=daemon 单闸"；②78-§0.7 统一 severity（同一能力同一档，或逐行给差异理由）；③82 增一条平台 guard 探针（新编号；PB-6 子项亦可——78:1695 明写本卷仍为 16 条、不新增 P-78-17，勿占用），"非法转换在平台侧/daemon 侧被拒"正反俱全，并登记 GAP（若确认无平台 guard）；④30-§4 的取舍回写 03/23，而不是只留在选型卷。 |
| V08-P1-02 | P1 | D/E/G | `docs/78-技术细节-宿主平台与工作区绑定.md:164-187`、`:195`、`:1262-1315`、`:1327-1341`；`docs/25-端口与协议.md:226`；`docs/32-Taiga真机试点报告.md:71-72`；代码 `packages/taiga/src/kb.ts:13`、`packages/taiga/src/index.ts:15` | 〔事实〕78-§1.2 规定每份绑定档案必须含 20 字段，其中 `losses: list<REC-LOSS-01>`、`semanticDigest`、`probes` 等为"是"；§1.2 还规定"只写 `BIND-DSH-01` 而不带版本与摘要的引用，在 82 的符合性声明里判为无效引用"。实际 §9.2-§9.4 的平台卡是十余行散文表，无 `semanticDigest`/`losses`/`probes`/`fieldMappings`/`stateMappings`/`provisioning`/`exportMigrationExit`/`factStatus` 等 §1.2 必填字段。Taiga 的"损失"只有 3 条（无转换 guard/无基线快照/webhook 环境），未提 kb.search 退化为"列表拉全+子串匹配"（`kb.ts:13`）、created 缺席、评论 author=平台账号非工号（32:71-72）。§9.5 要求"每平台各自填，不给默认"的状态映射表，实际只有通用骨架，三平台均无表。 | 判断：78 自定的绑定档案/损失报告格式没有被最重要的平台卡满足；82 若按 78:195 引用这些卡会判"无效引用"，符合性声明无法成立。"换平台不丢语义"（23-§三）既无逐项损失表，也无等价性探针（82 V3 因 semanticDigest 未证只能同实现内比），无法验收。 | ①为 `BIND-PLAT-YT/TAIGA/LOCAL` 各补 §1.2 的 20 字段卡，至少 `losses`/`fieldMappings`/`stateMappings`/`provisioning`/`exportMigrationExit`/`probes`/`factStatus`；②把 3 条 loss 扩为逐能力（issues/comments/fields/kb/activity/links/guards）表，注明 `cannotClaim`；③补 §9.5 三张 STAT-D 表；④82 增 V0 检查"平台损失逐项对应"与一条双实现等价负向。 |
| V08-P1-03 | P1 | A/F/E | `docs/21-协作通讯-Matrix.md:46`、`:25`、`:51`；`docs/25-端口与协议.md:219-221`；`docs/78-技术细节-宿主平台与工作区绑定.md:1519`、`:1521`；`docs/03-YouTrack-对接方案.md:48`、`:60`；`docs/30-协作平台选型对比.md:50`；代码 `packages/matrix/src/adapter.ts:15/101`、`apps/daemon/src/assembly/serve.ts:1253` | 〔事实〕21-§五："每 agent 工号一个 Matrix 账号（@<工号>:localhost）；框架网关 bot 一个管理账号"；21-§三："消息由网关 bot 代发或带 `[公司·部门·岗位·级别]` 前缀"；21-§六-1 验收："两个 agent 能在部门频道一问一答"。78-§11.2：登录用 `SEC-MX-BOT-PASSWORD`，建号只认 `SEC-MX-HR-SHARED`，未定义 per-agent 登录/发送主体。代码：`createMentionSource` 以单 bot 身份轮询，`adapter.ts:101` `if (message.sender === options.selfUserId) continue`（自发消息不产意图）；serve.ts:1253 注"MATRIX_BOT_PASSWORD → login → createMentionSource"。25-§3.2：`PlatformActivity.actor`=平台账号名；"工号翻译归框架侧（公司目录账号映射表）——翻译机制本身归后续刀，端口不承载"。03-§三：10 用户已满，"账号=等级锚点、工号=人 是永久决策"；N9 四元组。30-§3.1：Taiga 自托管无用户/项目上限。 | 判断：①若 agent 消息由 bot 代发，另一 agent 收到的 sender=bot=self，被 `adapter.ts:101` 过滤 → 21-§六-1 不可达；若 agent 用自己的账号，则 78/25 缺 per-agent 凭据与发送面（只有 bot 密码），21-§五 无承接。②actor→工号在 YT 是 1:N（一个等级账号多人，03:48/60），在 Taiga 是 1:1（邀请制账号），25-§3.2 把翻译推给"后续刀"，等于把权责链关键一步留空；N9 四元组只在 Taiga 形态可能成立。③03-§三的"10 用户/账号锚点永久决策"以 YouTrack 免费版为前提，Taiga 无上限后前提消失但未复核，同一身份模型跨平台不自洽。 | ①78-§11.2 增 per-agent Matrix 凭据/登录/发送主体；若坚持 bot 代发，定义"服务端可验的发起者"（appservice/puppeting 或前缀+工号映射表）并承认其归属强度，同时改 21-§五/§六-1 为可实现的验收；②25-§3.2 落 per-platform actor→工号规则（YT 用 `派单人`/工号字段，Taiga 用 username），多对一时给明确失败，不许"后续刀"悬空；③03-§三的"永久决策"加前提与复核条件（平台切换即重审），并把 10 用户限制标为 YouTrack 事实。 |
| V08-P1-04 | P1 | B/C/E | `docs/51-公司仓库规范正文.md:70-97`、`:99-109`、`:193-197`；`docs/18-地基-executor包与状态机与调度.md:57-78`；`docs/78-技术细节-宿主平台与工作区绑定.md:1237`；`docs/82-技术细节-验证迁移与追溯.md:136`、`:396`；代码 `packages/company/src/git-import.ts:452` | 〔事实〕51 v1.1（2026-10-22）新增 `workflows.types[]`：状态集/edges/五锚/final，W-1..W-9 为判定规则，W-7 说"值域闸在平台侧 provision"。51-§八 初始化链为"克隆→剥离 .git→validate（产物面）→平台字段 provision→信任锚→建 .AIWS→依赖清单自动安装→daemon 开工"——只有"字段 provision"，无"状态集 provision"。78-§9 的平台卡按事项列，未设"statuses 从 workflows 派生"的字段/步骤。82 V0 的输入是"75–81 与 81-files/01–19"（不含 51），§3.5 的 F-ID 核验只覆盖 81。代码：`packages/company/src/git-import.ts:452` 只在 `snapshot.platform.platform === 'localfile'` 时 `fields.provision(deriveFieldProvision(..., snapshot.workflows))`；Taiga 的 statuses 来自 onboard 脚本的旁挂 `FieldProvisionMap`（30-§6-②/32-§八）。 | 判断：公司声明流（51 是 normative 唯一标尺）没有 L3 承接：无状态集 provision 步骤、无"派生自 workflows"的唯一函数、无 W 规则验证。公司改 workflows 后平台侧不会得到对应状态集；在 Taiga 上 transition 到未 provision 的状态会 `unknown-state` 失败（适配器明报），这不是"公司权责投影"，而是"部署脚本记忆"。51-§七"每条规则至少一对夹具"没有落点。 | ①51-§八 增"状态集 provision（由 `workflows.types` 派生）"一步并指向唯一派生函数；②78-§9 增"statuses 来源=公司定义 workflows（不是旁挂文件）"与缺失时的失败语义；③82 V0/V1 增 51 规则集夹具（每条 W 规则一正一反），把 51 纳入输入清单；④若 Taiga 的状态集必须由旁挂文件供给，明写"该文件是 workflows 的编译产物，禁手改"并在 CI 校验一致。 |
| V08-P1-05 | P1 | C/G/E | `docs/26-回填与对账设计.md:83-85`、`:155-156`、`:279-293`、`:297-304`；`docs/78-技术细节-宿主平台与工作区绑定.md:1405`、`:1409`、`:1410`；`docs/82-技术细节-验证迁移与追溯.md:597-609` | 〔事实〕26 的设计目标是把 20401 条旧 `events` 回填到 `events` 表与 `work_records`，目标契约 `EventRecordSchema` 为"事件名 25 类枚举∪前缀族"（26:155-156）。78-§10.1：`events`（现有 17 列）"只投影"，记录层是三表，且"整封与原始载荷才算落记录"；"投影词表是 17 列/30 事件名的本实现口径"（78:1410）。26 还有 7 项待制作人拍板（§七，含公司映射、SHADOW_DIFF、actor 哨兵）与 6 项待验证（§八）。82 MIG-03 的目标含 `records/record_payloads/record_transactions`，但旧事件只在损失行出现（"旧 events 无法还原的字段只能 reconstructed"），没有任何波次承接 26 的 A/B/C/D 对账、7 拍板、6 待验证；MIG-01–07 全文未提 26。 | 判断：按 26 实施只能得到投影层的行，不能成为 78/82 要求的记录层事实；26 的 7 项拍板（尤其公司映射 §七-1、actor 哨兵 §七-5）未决，company/actor 列可能被硬停或大量拒收，MIG-03 没有承接这些决定；"25 类 vs 30 事件名"是可直接判定的版本漂移，26 没有版本注记。 | ①82 MIG-03（或新增 MIG-03a）把回填列为独立前置/波次，明确目标层（records 三表 vs events 投影）、26 的 7 拍板作为入口条件、6 待验证作为关闭条件；②26 加版本注记"事件名以当前 contract 为准（30）"，并把 25 改 30 或给映射表加版本；③26-§4.1 增"回填只产出投影，记录层另走 `REC-MIG-01`"的层归属。 |

### 3.3 P2（4 条）

| ID | 级别 | 类型 | 位置 | 事实 / 引文 | 为什么错 | 修复路径 |
|---|---|---|---|---|---|---|
| V08-P2-01 | P2 | C/G | `docs/25-端口与协议.md:6-9`、`:3`；`docs/78-技术细节-宿主平台与工作区绑定.md:1248-1258`；`docs/82-技术细节-验证迁移与追溯.md:67`、`:89`、`:321` | 〔事实〕25 定位"五端口 + 外围面…接口冻结到类型级"，并规定"改端口先改本文，再改类型——倒序视为废件"；版本史到 v1.8，未记 binding 端口。78-§9.1 引入 `packages/contract/src/ports/binding.ts` / `PlatformBindingPort` 为"类型（唯一形状源）"。82：55 个 `TS-PORT-*`、引用 `TS-PORT-BIND-01`，同时 §1.2 声明"不在范围内：新端口"。 | 判断：端口面的新增未按 25 的冻结规则回写 25；实现者按 25 会漏掉 binding 端口，按 78 会违反 25。82 的"不新增端口"与 78 的三层落点也不一致。 | 25 增 §3.6 `PlatformBindingPort`（或把 78 三层写成 25-§3.2 的子节），更新版本史；82-§1.2 的"不新增端口"加例外，或改为"不新增语义端口，绑定端口已在 25-§3.6"。 |
| V08-P2-02 | P2 | A/D | `docs/46-协作栈路线探索.md:161-163`；`docs/78-技术细节-宿主平台与工作区绑定.md:1307-1308`；代码 `packages/localplatform/src/guards.ts:4-5` | 〔事实〕46-§三 路线 D："平台侧 guard 我们原生就有：状态机本就在框架核心，docs/23-§三「状态权威归平台侧」在 LocalFile 形态下=归框架自己，双真源问题消失。"78-§9.4：LocalFile `guards`"只落盘不执行"，"真正的闸=daemon state-diff（第一道）；平台侧第二道未来在 transition()"。 | 判断：46 把"框架核心有状态机"当成"平台侧有 guard"；实际 LocalFile 形态下只有 daemon 单闸，"双真源消失"的代价是失去独立闸。46 是决策输入（非单选结论），错误论据会影响制作人对 D 的拍板。 | 46-§三 路线 D"怎么改"段加限定："LocalFile 形态下平台侧 guard=daemon 单闸，不是第二道闸；双真源消失的代价是失去独立闸"；§四对比矩阵"技术可行性"行注明。 |
| V08-P2-03 | P2 | G | `docs/51-公司仓库规范正文.md:101-109`；`docs/75-技术细节-总纲与工程决策.md:97`；`docs/82-技术细节-验证迁移与追溯.md:345`、`:368` | 〔事实〕51 用 `W-1..W-9` 表示公司仓库 workflow 校验规则；68/75/82 用 `W1–W12`（`TR-W-01..12`）表示工作册补充反例。 | 判断：两套 W 编号都在现行文本中使用，语义不同；引用 "W-8"/"W8" 时无法从编号判断族。82 的 88 行追溯不含 51 的 W 规则，51 的规则无独立前缀，容易误读为"W 已覆盖"。 | 给 51 的规则加独立前缀（如 `WF-1..WF-9`），或在 51-§三 首行声明"本组 W-* 与 68 的 W1–W12 无关，引用须带卷号"；82-§3.1 增一行说明。 |
| V08-P2-04 | P2 | G | `docs/32-Taiga真机试点报告.md:5-6`、`:12` | 〔事实〕32 出现 `/tmp/taiga-probe/`、`/tmp/taiga-docker/.admin-credentials`、`/tmp/taiga-images/download.sh` 等本机绝对路径与凭据文件名。AGENTS.md-§五.6："仓库里不得出现本机路径 / IP / 真实凭证。" | 判断：不是设计缺陷，但违反仓纪律，且 `.admin-credentials` 路径会诱导读者去找真实凭据；探针报告自称凭据"永不入仓"，路径本身应占位化。 | 改为 `<探针根>/…`、`<凭据文件>`；§七/§十 同样处理；保留"0600/永不入仓"的纪律描述。 |

---

## 四、覆盖核对（脚手架 §四-3）

### 4.1 已覆盖（本次要求）

| 文档 | 读取 | 覆盖内容 |
|---|---|---|
| `03`（72 行） | 全文 | 能力矩阵、平台/框架分工、N1–N12、迁移纪律；重点核 N1/N8/N9/N12、10 用户/角色权限、guard 第二道闸 |
| `21`（53 行） | 全文 | 分工铁律、频道、署名、@唤醒、部署、验收三条；重点核 Matrix 账号/署名/验收 1 |
| `23`（58 行） | 全文 | FlowPlatform 七能力、映射层、纪律、plat 契约面、验收；重点核"状态权威归平台侧""换平台改一行" |
| `25`（369 行） | 全文 | 五端口类型、FlowPlatform/actor/kind/lane 裁决、网关 actions、泳道、验收；重点核 §3.2/§3.4/§4.1/§六 |
| `26`（315 行） | 全文 | S1–S15 清点、回填范围、A/B/C/D 对账、映射、工具规格、失败面、7 拍板、6 待验证；重点核 §4.1/§4.2/§七/§八 |
| `30`（247 行） | 全文 | 六硬标准、8 平台事实卡、七能力难度、onboard 九步、待实测；重点核 Taiga C1–C6、§4 guards、§6 |
| `32`（167 行） | 全文 | 部署、onboard 走查、webhook、history、适配器冒烟、links、onboard 写面、S0、S3；重点核 §二④、§四、§七、§八、§九 |
| `46`（243 行） | 全文 | 四路线六面、对比矩阵、决策点、未核实清单；重点核路线 D 与"平台侧 guard" |
| `51`（212 行） | 全文 | 五组契约 A–E、org-config、workflows/W-1..W-9、判定器、初始化、版本；重点核 §二/§三/§五/§八 |
| `71`（639 行） | 全文 | 能力状态、任职/出工、H 级、工作/验收/恢复、协作平台/工作区/CLI、闭合判据；重点核 §2.1/§3.2/§5.1/§6.1/§6.3 |
| `75`（326 行） | 全文 | 四类命题/四态、卷边界、ID 规则、D75-01..15、工件、逐文件模板、D1–D6、审查口径；重点核 D75-04/08/12/13/14 |
| `78`（1981 行） | 全文分段（5 段） | 绑定档案、DSH/PRM/POS/EFF/ROLE/WS、CLI、平台 YT/Taiga/LocalFile、STORE/XCHG、Matrix/HTTP/MCP、网关、证据、探针、E/W 归属、N1–N18；重点核 §1.2/§9/§10.3/§11.2/§11.5/§13 |
| `82`（927 行） | 全文分段（3 段） | V0–V6、TR 88 行、MIG-01–07、D1–D6、16 探针、未证、GAP、P0/P1/P2 口径；重点核 §1.2/§2/§10/§12/§14 |

### 4.2 对象/ID 核对

- 已核：`03` N1–N12；`23` 七能力/`guards`；`25` `GATEWAY_ACTIONS`/`WkeyClaims`/`SignedBody`/`InvokeIntent`/`dedupKey`/`PlatformActivity.actor`/`PLATFORM_ACTIVITY_KINDS`/`CompanySnapshot.platform`；`51` A-1..A-5、B-1..B-6、C-1..C-8、D-1..D-4、E-1..E-4、W-1..W-9；`26` A1–A4/B1–B8/C1–C3/D1–D2/§七 1–7/§八 6 项；`78` `BIND-CORE-01`/`BIND-PLAT-*`/`BIND-EDGE-*`/`BIND-STORE-01`/`BIND-WS-01`/`BIND-EFF-01`/`BIND-PRM-01`/`BIND-POS-01`/L78-*；`82` `TR-*`/`P-78-01..16`/`MIG-01..07`/`GAP-82-*`/`VEC-82-*`。
- 机械核对：`grep` 代码写路径（`issues.create/transition/setField/provision/guards.install`）确认 engine/外 API 两类调用点；onboard 写面按 wire.ts 注释登记；`grep` gateway 开关、actor、Matrix self 过滤、Taiga kb/activity、LocalFile guards；`grep` docs 中 51/workflows/binding port/10 用户/账号锚点 的引用。
- 未逐条核：`76/77/79/80/81` 全文（只按 78/82 的引用核相关行；80 仅 grep 到 `FlowTable` 一行）；`00/08/17/18/22/24/36/43/44/52/70/73/74` 未读；`21A-Synapse部署手册` 未读。

### 4.3 未覆盖清单

- 未跑 `bun run test`/`typecheck`/`guard:boundaries`；未启动 daemon/DSH/Matrix/Taiga/YouTrack；未做真机探针；未复算 210/210、2976/2976 等全量声明。
- 未核 `packages/taiga`/`packages/yt` 全部适配器行为细节（只核本次论点相关的写路径、activity、kb、guards、provision）。
- 未核平台许可证/配额/外部 API 的外部事实（30/32/46 的 URL 未重新访问）；30/32 的"实测"只按内部一致性使用。
- 未核生产部署的 daemon.yaml 实际取值（本报告未在仓内定位部署配置），因此 `gateway:false`/external platform 注入是否真的在生产发生=未证。
- 未核多公司拓扑是否有仓库外部署脚本（一 daemon 一公司 vs 多公司）；未核 21A 的 per-agent Matrix 账号是否已在部署中存在。

---

## 五、未证与无法判断

1. **生产是否关过网关**：仓库无 daemon.yaml 实例；`gateway:false` 是代码支持的键，是否被生产使用=未证。判断仅针对"存在合法关闭面"这一事实。
2. **外部 API 是否真的绕过网关**：`packages/panel/src/external/server.ts` 说"写闸归 daemon 装配（gated-platform/gateway 在 wiring 侧包好再注入）"，但该 wiring 不在本仓（无 import 方）；78-§11.1 自承现状直调 `platform.issues.create`。是"已包好"还是"裸注入"=未证。
3. **每 agent Matrix 账号是否存在**：21-§五 要求 per-agent 账号；代码只显示 bot 登录 + 建号端点；21A 部署手册未读，生产是否已建 per-agent 账号、agent 消息由谁发送=未证。
4. **Taiga webhook 接收端是否在别处实现**：78/82 无契约；代码侧未核到 webhook 接收路由（本报告未逐一核 Taiga 适配器的 webhook 管理面）。若在仓库外实现，本报告的"无端口"需降级为"未登记"。
5. **YouTrack guards 是否可通过 workflow API 实现**：03-N6 说可安装；78-§9.2 说未实现。能力真实性（平台侧 workflow 能否做转换 guard）=未证；本报告只判"当前实现不支持"与"03/23 仍写成已有"。
6. **51 的 `workflows` v1.1 是否已用于真实公司仓**：仓库内只有模板/代码；是否有公司仓已声明 workflows、Taiga 侧是否已 provision 对应 states=未证。
7. **26 的回填是否已被新方案替代**：82 MIG-03 只在损失行提旧 events；是否有未落盘的替代设计=未证。
8. **50b:97 的"engine 单公司"是否仍是最新现状**：50b 是既成对账文档；本次只读代码确认 `company: string` 与单 platform，但未核 50b 之后是否有未落盘的修改。

---

## 六、给作者的修复顺序（≤7）

1. **先定 D1 边界**：51 v1.2 移除 `plugins/` 或在 75/82 给 schema:1 过渡豁免；在此之前，任何"导入公司"不得执行仓内代码，且 51-§八"自动安装"降为 H0a。这是安全边界，先于其它。
2. **关闭多公司错绑**：daemon 启动比对 `snapshot.platform` 与 daemon.yaml 的 platform/project，不一致拒启；外部 API 触发面按 `?company=` 解析平台实例（或禁多公司写）。这是数据边界，改动小、收益大。
3. **把"唯一写入者"写成可判定面**：`gateway:false` 在生产形态拒启（或删键）；外部 API 只注入 gated platform；为 Taiga 补 webhook 接收契约或明写"UI 直写不支持"，并在 82 加"绕过网关不可写"负向。
4. **定 actor 模型**：控制面动作族（`ctl-*`）+ `SignedBody.author` 的 actorKind/onBehalfOf；或保留 author=工号但要求带决定记录。同步改 03/25/71/78，去掉"author=工号"的 unconditional 表述。
5. **补齐平台损失与 guard 验收**：按 78-§1.2 写三张平台卡（含 losses/stateMappings/probes），补 §9.5 三表，增平台 guard 与双实现等价探针；同步统一 YT/Taiga/LocalFile 的 severity。
6. **承接 51 workflows**：51-§八 增状态集 provision；78-§9 写"statuses 来源=workflows"；82 V0/V1 纳入 51 的 W 规则夹具。
7. **26 与 MIG-03 对齐**：把回填列为独立波次/前置，明确目标层是 records 三表还是 events 投影，并把 7 拍板/6 待验证写成入口/关闭条件；统一事件名计数（25→30）。

---

## 七、本报告没有做什么（范围限制）

- 未修改任何现有文档、源码、配置、schema 或测试；只写本文件。
- 未运行测试、类型检查、边界门禁、daemon、DSH、Matrix、Taiga、YouTrack 或任何真实服务；本文所有"已实现/已存在"均来自静态代码阅读，不等于运行时验证。
- 未做外部事实复核（30/32/46 的官方 URL、许可证、配额、API 端点均未重新访问）；这些内容只按文档内部一致性使用。
- 未审计 76/77/79/80/81 全文、00/08/17/18/22/24/36/43/44/52/70/73/74、`21A-Synapse部署手册`；未审计其它 DSF 子报告，也不对最终总报告的结论负责。
- 未对 D1–D6、首版范围、许可证、商业决策作判断；文中给出的"修复顺序"是审计建议，不是制作人决定。
- 未证明"网关就是不安全"或"多公司一定错绑"：本报告只证明当前规范/代码中没有可判定的拒绝面与一致性校验，具体事故是否发生取决于部署，属未证。
- 未对 32 的真实凭据/本机环境作任何访问；P2-04 只针对文档中的路径文本。
