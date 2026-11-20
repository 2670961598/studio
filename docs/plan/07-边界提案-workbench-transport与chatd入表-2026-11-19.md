# 07 · 边界提案：workbench-transport 与 workbench-chatd 入分层宪法表（2026-11-19）

> 单号：team task-132（里程碑3 前置）；方案依据：docs/plan/06-自研单子与聊天室切换-2026-11-19.md:28（里程碑3「边界提案：workbench-transport/chatd 入 packageLayers」）、:58（风险行「里程碑3 先走提案」）、:64（task-132 只出提案不接线）。
> 状态：**待制作人批**（20-§十五：判据类资产修订=提案流+制作人批，docs/20-工程总规程.md:201）。批示前不动 boundary-rules.mjs、不写任何接线代码。
> 本文只做提案；基线 worktree 520754a 实测 `node scripts/guards/boundaries.mjs` = PASS（1299 文件 0 违例）。

## 〇、结论先行

推荐 **提案 A**：`workbench-transport` 入横轴层位 1、`workbench-chatd` 入 apps 应用层（层位 5），新增两条包间边（daemon→workbench-transport、workbench-chatd→workbench-transport）。提案 B（daemon 内镜像 DTO、零新边）可行但把协议维护面复制三份，且挡不住里程碑3 面板 UI 对同一边的必然需求——问题只是被推迟并放大。

## 一、背景与现状证据

1. 制作人 2026-11-19 令单子与聊天室自研：聊天室 Matrix→workbench-chatd（自研 sidecar，Unix socket+SQLite），daemon 的 MentionSource/Notifier 须从 Matrix 切到 chatd（docs/plan/06:8、:45）。
2. 两包已就绪但**未入宪法表**：`packageLayers`（scripts/guards/boundary-rules.mjs:79-96）与 `allowedPackageEdges`（scripts/guards/boundary-rules.mjs:102-142）均无 `workbench-transport`/`workbench-chatd`。当前门禁 PASS 仅因两包零工作区 import（workbench-transport/package.json:6 零运行时依赖；chatd 同）——daemon 一旦 `import '@studio-next/workbench-transport'` 即双违例：BC-H2「未登记的工作区包」（scripts/guards/boundaries.mjs:159-160）+ BC-H1「包间边未冻结」（scripts/guards/boundaries.mjs:165-171）。
3. 现状 mention/notify 装配形态（模块 D 的对齐靶）：
   - daemon 不强依赖 matrix：源经 `RunServeOpts.matrixSource` 工厂注入（apps/daemon/src/assembly/serve/run.ts:62-66），开而未注入=CONFIG_INVALID 拒启（apps/daemon/src/assembly/serve/runtime.ts:434-440）；组合根 apps/boot 构造 `createMentionSource` 产物（apps/boot/src/boot.ts:273-302、:471-477）。
   - Matrix 源形态：`InvokeSource { name, start(emit), stop() }`（packages/contract/src/ports/gate.ts:248-253），轮询节奏 pollIntervalMs 缺省 3000、出错指数翻倍封顶 60s、首拉只建基线、stop 清定时器不留孤儿（packages/matrix/src/adapter.ts:74-76、:103-134、:144-151）；payload=MentionPayload{target,mention,text,eventId,sender,room,channel}（packages/matrix/src/mentions.ts:64-77），daemon 侧结构闸 `checkMentionPayload` 同形校验（apps/daemon/src/engine/intents/taxonomy.ts:36-51、:59-67）。
   - 意图幂等键=(source,kind,company,dedupKey)，mention 必带 dedupKey（packages/contract/src/ports/gate.ts:244-245）；emit 统一进 engine.ingest，源零直驱（run.ts:368-370）。
   - notify 面：Notifier.send(channel,message)（packages/contract/src/ports/gate.ts:277-280）+ notifyBroadcast 注入（run.ts:70-73、:438-444）。
4. chatd 侧协议已冻结 v1：`workbench-transport/v1`，稳定错误码 WB_* 词表 11 项（packages/workbench-transport/src/types.ts:8、:12-25）；端点 health/rooms/messages/read/inbox/wakes.claim/wakes.ack（packages/workbench-transport/src/types.ts:34-43）；wake 租约 TTL、过期重投≤3、超限 dead-letter 终态（apps/workbench-chatd/src/server.ts:82-93、:279-284）；鉴权=params.token 常时比较，无/错 token 以 WB_INVALID_ARGUMENT(unauthenticated:) 承载（apps/workbench-chatd/src/server.ts:12-13、:347-348、:398-401）。
5. 既有入表判例（本提案对齐的先例口径）：
   - apps/boot 入边（boot→contract/daemon/matrix）= 宰相亲批入表 2026-10-21（boundary-rules.mjs:103 批注）——装配单元加边走批示的先例；
   - daemon→taiga/yt/gateway/localplatform 直连（boundary-rules.mjs:113-118）——实现包由应用顶直连的先例；
   - dsh-bridge **不入表**（boundary-rules.mjs:94）——外部宿主以路径引用消费、零模块边的反例（见 §2.3）；
   - daemon→api/prompt/yt「已声明休眠边一并冻结为允许」（boundary-rules.mjs:99-100）——边先入表、消费后置的灰度先例。

## 一.五、不做什么（提案边界）

- 不改 daemon 纵轴表/域平面基线/尺寸阈/行数基线（boundary-rules.mjs:24-66、:148-178 原样）；不动 matrix 包与 apps/boot 既有装配。
- 不在本提案内实现模块 D 任何代码、不接 panel UI、不做 Matrix 历史迁移（归里程碑3 实现单与里程碑4，plan/06:28-29）。
- 不引入 chatd→matrix/taiga 等横向边；chatd 保持零工作区依赖现状（除 transport 一边）。
- 不做 E2EE/附件/拓扑迁移（v1 显式 UNSUPPORTED，plan/06:46）。

## 二、提案 A（推荐）：两包入表 + 两条包间边

### 2.1 精确改动（批示后一次提交完成，含文档同步）

1. `scripts/guards/boundary-rules.mjs` `packageLayers` 加两行：`"workbench-transport": 1`（内核机制层，依赖面=零依赖现状，预留 contract）、`"workbench-chatd": 5`（apps 应用层，与 daemon 同层位）。规则 diff（示意，落仓以实际为准）：

   ```js
   export const packageLayers = {
     // …既有行不动…
     daemon: 5,
     "workbench-chatd": 5,        // apps 应用层（里程碑3 提案 task-132）
     // …
     matrix: 1,
     "workbench-transport": 1,    // 内核机制层：冻结协议客户端，零运行时依赖
     // …
   }
   ```

2. `allowedPackageEdges` 加两行：`["daemon", "workbench-transport"]`、`["workbench-chatd", "workbench-transport"]`（层位 5→1，自上而下合法，docs/20-工程总规程.md:233-242）。
3. 人文镜像回改：docs/20-§十五.二 横向表（docs/20-工程总规程.md:233-242）同步加两包（宪法 §十五.六.2：冲突以规则文件为准并回改本章，docs/20-工程总规程.md:278-280）。
4. 连带裁量项（不阻塞本提案，请制作人一并裁）：里程碑3 面板聊天室 UI 需要 `["panel", "workbench-transport"]`（panel 层位 4→1，合法自上而下）。若批面只限两行，面板边随面板 UI 实现单另行走批示。
5. 落地验证命令（三绿门）：`bun run guard:boundaries`（exit 0）、`node --test scripts/guards/boundaries.test.mjs`（红绿夹具绿）、`bun run typecheck`。

### 2.2 门禁/尺寸/平面基线影响（实测与推演）

- BC-H2/BC-H1：入表+加边后归零（执行引擎只查表，scripts/guards/boundaries.mjs:147、:159）。
- 尺寸阈：两包现状最大件 505 行（chatd server.ts）<600、目录 ≤25 文件，**不新增 lineBaseline 条目**（boundary-rules.mjs:148-152、:161-178 不动）。
- 域平面基线（BC-V3）：只作用 daemon 五域（boundary-rules.mjs:61-66），本改动不触；模块 D 新代码按 contrib 模式开 `apps/daemon/src/engine/chatd/` 子文件夹，不加域平面散文件（docs/20-工程总规程.md:256-260）。
- 守护面：`bun run guard:boundaries` + boundaries.test.mjs 红绿夹具 + `bun run typecheck` 三绿为批示落地门。

### 2.3 合宪性：为何不违反 DSH 宿主演进与「新边=提案流」

- **不违反宿主例外**：dsh-bridge 刻意**不入模块图**（boundary-rules.mjs:94「仓内零模块入边——daemon 以路径引用消费，§十五.七不扫」），因宿主是外部运行时、须独立演进——正因此它走路径引用而非 import。workbench-transport/chatd 相反：仓内自研件、协议 v1 冻结（types.ts:5「改动=version 升级，不得静默扩字段」）、零第三方依赖，是横轴「一包一域」的正常公民（docs/20-工程总规程.md:203-206）。入表不把宿主缠进模块图：executor 面仍在 packages/adapters，本提案零触碰。
- **不绕提案流，正是提案流**：通则③「表中未列的边=违例（新边=改表=提案流）」（docs/20-工程总规程.md:218-219）；层位表/允许边新增=判据类资产修订=提案流+制作人批（boundary-rules.mjs:3-4；docs/20-工程总规程.md:201）。本文档即该提案；批示前零代码（顺序铁律：抽象→文档→过审→代码）。
- **对齐既有判例**：daemon 已直连 gateway/taiga/yt/localplatform 等实现包（boundary-rules.mjs:113-118）；「daemon 零 import」例外仅 matrix 一包（外部产品 Synapse 的适配器，靠 Docker 存活、部署易变性高）。chatd 是同仓同生命周期服务（plan/06:49），不在该例外射程内。

## 三、提案 B（备选）：零新边——daemon 内镜像实现

做法：`WorkbenchMentionSource` 放 `apps/daemon/src/engine/chatd/`，daemon 内自写最小 NDJSON 客户端（node:net 直连 socket，仅 inbox/claim/ack 三方法），**镜像复制** v1 DTO 子集与 WB_* 错误码词表；不 import workbench-transport，宪法表零改动。防漂移靠契约测试：spawn 真 chatd 子进程（`node apps/workbench-chatd/src/main.ts --memory`，子进程路径引用不在静态扫描面，docs/20-工程总规程.md:295）跑全场景断言。

- 优点：宪法表不动=无需批示即可动工；daemon 自包含；回滚=删一个文件夹。
- 缺点：①同一冻结协议三处实现（transport 客户端、chatd 服务端、daemon 镜像），v1→v2 升版时镜像无编译期耦合提醒，漂移风险只被测试缓解不被结构消除；②里程碑3 面板 UI 仍需 client——B 下 panel 要再镜像第四份或另立边提案，问题后移且更贵；③违背横轴「新领域=开新包，不向既有包塞异域物」（docs/20-工程总规程.md:205-206）——聊天传输域已有包，daemon 内再造即塞异域物；④两包永久悬空表外，任何人未来一句 import 即红，等于把提案义务转嫁给无意者。

## 四、对比与推荐

| 维度 | A 入表+加边 | B 镜像 DTO |
|---|---|---|
| 宪法表改动 | 2 行层位+2 行边（本次批示） | 0 |
| 协议维护面 | 单一源（transport） | 三~四处复制 |
| panel/里程碑5 复用 | 直接 import | 逐包镜像 |
| 漂移防护 | 类型同源编译期 | 仅测试期 |
| 回滚 | mentionSource 配置切回 | 删代码 |

**推荐 A**：一次批示换结构性单源；B 的「免批示」收益是一次性的，复制成本是永续的。

## 五、模块 D 接口清单（daemon 侧；批示后立实现单）

### 5.1 类型与生命周期（`apps/daemon/src/engine/chatd/`，InvokeSource 实现，name='chatd'）

- `createChatdMentionSource(options)` → `InvokeSource`（对齐 matrix 源形态 adapter.ts:73-152）：options={company, socketPath, tokenEnv 值经 env 供给, pollMs?=3000, requestTimeoutMs?=2000, maxBackoffMs?=60000, rooms?}。
- 状态机：`idle --start()--> polling --stop()--> idle`；轮询循环（每 pollMs 一拍，对 roster 在册工号逐 actor）：`inbox(actorId)` → pendingWakeIds（server.ts:234-252）→ `wakes.claim`（批量、idempotencyKey=actor+拍号；alreadyClaimed 幂等吸收，server.ts:253-296）→ 逐 claimed wake：`messages.list` 定位 roomSeq=sourceSeq 的源消息（缺失=软失败计数+跳过）→ 组 MentionIntentPayload{target=wake.actorId, mention='@'+actorId, text=body, eventId=`wake:${wakeId}`（=dedupKey——引擎幂等契约 dedupKey=eventId 源侧设置，消费件强制两者相等，taxonomy.ts:417-424；chatd 源的 eventId=wake 身份而非 Matrix room/seq：同 wake 重投同键恰一次、一条消息 @ 多 actor 各产独立 wake 天然不同键；room/seq 溯源由 room 字段+按 sourceSeq 定位源消息承载）, sender=senderId, room=roomId, channel=roomName} → 过 `checkMentionPayload` 结构闸（taxonomy.ts:59-67）→ `emit({kind:'mention', source:'chatd', dedupKey:'wake:'+wakeId, payload})` → emit 返回后 `wakes.ack([wakeId])`（alreadyAcked 幂等吸收，server.ts:298-322）。
- 装配面（最小 diff）：run.ts 注入面零新增——A 方案下 daemon 直连 transport，`buildServeRuntime` 在 `mentionSource==='chatd'` 时注册 chatd 源（matrix 判例 runtime.ts:434-444 同款「开而缺配=CONFIG_INVALID」），装配细节收在 engine/chatd/ 特性文件夹内。
- 恰一次语义：emit 后崩溃/未 ack → 租约过期重投（attempt+1≤3）→ 引擎按 (source,kind,company,`wake:<id>`) 幂等折叠（gate.ts:244-245）；超限 dead-letter 终态不再重投（server.ts:87-93）。
- `stop()`：清 setTimeout 链 + 在途 poll 返回后不再调度/不再 emit + transport.close() 幂等（adapter.ts:144-151、client.ts:87-92 同款语义）；停机由 runtime.stop 统一收口（run.ts:512-513）。
- notifier 面（同刀范围）：`createChatdNotifier(transport, roomIdOf)` → `Notifier.send(channel,message)`（gate.ts:277-280）：Notification→messages.send（channel=room_id，idempotencyKey=notification 去重键）；失败永不抛（软失败日志+计量，对齐 matrix 判例）。

### 5.2 节奏/超时/重连退避

pollMs 缺省 3000（对齐 matrix 源 adapter.ts:74）；传输层缺省 connect 1000ms/request 2000ms、每请求一次即时重连（client.ts:36-37、:4）；源层出错（WB_TIMEOUT/WB_UNAVAILABLE/WB_NOT_CONNECTED）指数翻倍封顶 maxBackoffMs=60s、成功复位（adapter.ts:130-133 判例曲线）；emit 抛错源自身捕获不中断轮询（docs/22 源侧契约，注册表兜底 apps/daemon/src/engine/sources.ts:184-190）。

### 5.3 错误码映射（WB_* → daemon 分类，docs/17:331-335 枚举）

- WB_TIMEOUT/WB_UNAVAILABLE/WB_NOT_CONNECTED（retryable）→ 源软失败：sourceErrors 计数+退避，连续失败 ESCALATE 日志（处置语义同 EXTERNAL_REJECT 重试面，不物化单）。
- WB_INVALID_ARGUMENT（含 unauthenticated: 前缀）→ 启动期=CONFIG_INVALID 拒启（socket/token 配置面）；运行期=计数+error 日志（daemon 拼参缺陷明报）。
- WB_PROTOCOL/WB_INTERNAL → 源缺陷：计数+error 日志，不中断轮询。
- WB_IDEMPOTENCY_CONFLICT → 计数+跳过（以 chatd 审计 wake_events 为准，不重试）。
- WB_ROOM/MESSAGE/WAKE_NOT_FOUND、WB_WAKE_NOT_CLAIMABLE（含 dead-letter）→ 软失败计数+日志（dead=终态，server.ts:279-284）。

### 5.4 配置开关（默认关闭）

daemon.yaml 增 `mentionSource: 'matrix' | 'chatd' | false`（缺省=matrix 现状不动——chatd 默认关闭）；交叉校验 face 对齐 matrix 先例（apps/daemon/src/assembly/serve/config.ts:398-410、:529-541）：`mentionSource: chatd` ⇒ chatdSocket（绝对路径）必配、与 `matrix: true` 互斥（双唤起源=双写，里程碑4 双跑走影子工具不走配置双开，plan/06:47-48）；token 经 env WORKBENCH_CHATD_TOKEN 供给、永不入 yaml/日志/台账（红名单，MATRIX_BOT_PASSWORD 先例 apps/boot/src/boot.ts:50-51；chatd 侧同名 env，config.ts:46-54）。

### 5.5 mock sidecar 双跑（测试策略）

模块 D 测试双靶同场景断言：①mock sidecar（内存态，快——spawn chatd `--memory`+ALLOW_NO_AUTH=1，apps/workbench-chatd/src/main.ts:1-9）；②真 sidecar（SQLite 持久化：租约过期/重投/DLQ/重启恢复，对齐 chatd 自身 test/wake*.nt.ts 场景面）。守护测试钉「transport DTO ↔ daemon MentionIntentPayload」结构兼容（boot.test.ts 同款纪律，apps/boot/src/boot.test.ts:4-13）。

### 5.6 日志/指标字段

`[chatd]` 前缀行：poll 延迟、inbox pending 数、claim/ack/alreadyClaimed/alreadyAcked 计数、重投 attempt、dead-letter 计数、当前退避 delayMs、socket 重连次数；healthz 加法字段（不新增事件名/不改契约，loop.lagMs 同款加法判例 run.ts:288-289、:341-358）：`chatd.{connected,lastPollAt,pendingWakes,redelivered,deadLettered,sourceErrors}`。

## 六、验收与风险

验收（批示落地单的冻结口径）：①`bun run guard:boundaries` exit 0 + boundaries.test.mjs/typecheck 三绿；②模块 D 契约/E2E chat 场景（mock+真 sidecar 双靶）：mention 消息→wake→claim→intent→物化→ack 全链恰一次，幂等/租约过期/重投/DLQ 场景全绿；③里程碑4 双跑对账 0 漏/0 重复、wake 恰一次（plan/06:29）；④回滚演练：mentionSource 切回 matrix+重启 daemon ≤10 分钟（plan/06:10、:29），Matrix 只读保留期=回滚窗口。

风险与缓解：①**接线文件逼近行阈**：runtime.ts 593 行、config.ts 589 行（阈 600）——chatd 装配面必须最小 diff，超限即拆（BC-S2），**不得新增 lineBaseline 条目**（新超限件入基线=提案流，boundary-rules.mjs:156-157）；②协议 v1→v2 漂移：transport 冻结语义+守护测试双保险；③token 泄露面：env 红名单+出站闸脱敏（五出口已 wired，runtime.ts:155-157）；④双实例抢 socket：chatd 拒绝抢绑（apps/workbench-chatd/src/socket.ts:40-46），daemon 连接失败按退避重试不拒启（源软失败面）。

## 七、宪章请批点

本提案修订判据类资产：`boundary-rules.mjs` 层位表+允许边（=docs/20-§十五.二 横向表镜像）——按 20-§九/§十五 属**制作人批**事项（docs/20-工程总规程.md:201；boundary-rules.mjs:3-4）。请制作人就以下三项批示：①A 或 B（本文荐 A）；②若批 A：两行层位+两行边（+可选伴随的 panel 行）；③批复后按 2.2 三绿门落仓并开模块 D 实现单。批示前不动表、不接线。

## 附、证据索引（相对路径:行号）

| 证据 | 位置 |
|---|---|
| 宪法正文（§十五 全章） | docs/20-工程总规程.md:194-299 |
| 判据类资产=提案流+制作人批 | docs/20-工程总规程.md:201；scripts/guards/boundary-rules.mjs:3-4 |
| 通则③新边=改表=提案流 | docs/20-工程总规程.md:218-219 |
| 横向表（人文镜像，需同步回改） | docs/20-工程总规程.md:233-242 |
| BC-H2 未登记包 / BC-H1 未冻结边 | scripts/guards/boundaries.mjs:159-160、:165-171 |
| packageLayers / allowedPackageEdges 现状 | scripts/guards/boundary-rules.mjs:79-96、:102-142 |
| dsh-bridge 零入边注 / boot 入表判例 | scripts/guards/boundary-rules.mjs:94、:103 |
| 里程碑3/里程碑4 与 task-132 | docs/plan/06-自研单子与聊天室切换-2026-11-19.md:28-29、:58、:64 |
| daemon mention/notify 装配面 | apps/daemon/src/assembly/serve/run.ts:62-73、:368-370、:438-444；apps/daemon/src/assembly/serve/runtime.ts:89-94、:434-444 |
| Matrix MentionSource 形态 | packages/matrix/src/adapter.ts:45-70、:73-152；packages/matrix/src/mentions.ts:30、:64-77 |
| InvokeSource/InvokeIntent/Notifier 契约 | packages/contract/src/ports/gate.ts:236-253、:268-280 |
| daemon 消费闸 MentionIntentPayload | apps/daemon/src/engine/intents/taxonomy.ts:36-51、:59-67 |
| Transport v1 冻结协议与错误码 | packages/workbench-transport/src/types.ts:8、:12-43、:92-121；packages/workbench-transport/src/client.ts:4、:23-37、:87-92 |
| chatd 服务语义（租约/DLQ/鉴权/端点） | apps/workbench-chatd/src/server.ts:12-13、:82-93、:131、:206、:234、:253、:298、:347-348、:398-401；apps/workbench-chatd/src/config.ts:46-54；apps/workbench-chatd/src/main.ts:1-9；apps/workbench-chatd/src/socket.ts:40-46 |
| daemon 错误分类枚举 | docs/17-整体技术设计.md:331-335 |
| 依赖方向铁律（实现/核心包纪律） | docs/25-端口与协议.md:17-27 |
| 红名单 env 先例 / matrix 键组交叉校验 | apps/boot/src/boot.ts:50-51；apps/daemon/src/assembly/serve/config.ts:398-410、:529-541 |
