# Workbench `issues`/`collab` 替代 Taiga/Matrix 评估（task-60）

> 只读：未改 Docker/Taiga/Matrix/生产 daemon/host config，未 commit/push。依据 Workbench 仓库、StudioNext 契约/适配器、本机运行面（11-16）。
> 背景：11-14 Docker VM 盘 I/O 错误致 Taiga/Matrix 同时不可用（`docs/sentinel-logs/恢复-2026-11-14-2320.md:6,10-12`）；目标=评估能否用 Workbench 两包去掉 Docker。

## 〇、结论
1. **不能直接替代，不能“拿来即关 Docker”**：两包是可嵌入**领域内核**，不是平台。`issues` 无 HTTP/UI/Session 认证、自定义字段、KB、活动流、blocks/relates、附件；`collab` 无 HTTP/UI/账号登录/Matrix 协议/relay/历史迁移（`packages/issues/README.md:165-175`、`packages/collab/README.md:187-209`）。质量好：独立验证 **84/84**，实现套件 **80/80、133/133**（`verification/report.md:30-40`）。
2. **聊天/Matrix 面明显更接近**：collab 的 mention/reply/DM/broadcast/read/wake 与 daemon 所需重合（`packages/collab/README.md:80-133`）；缺网络层、UI、relay、账号/房间导入。
3. **推荐：生产暂不动（C），先做 Phase0 离线 PoC；PoC 过→B-1 先替 Matrix 内部聊天/通知，Taiga 保留；Issues 仅做兼容适配试验，不切 Taiga。A 全替代粗估 90–130 人日，当前不建议。**
4. **关 Docker 的答案**：只替聊天仍要 Taiga 的 Docker；只替单子仍要 Matrix 的 Docker；**两者都替换并过迁移验收后才可能关**。近期现实方案=保留 Docker、加固自启/备份（`docs/sentinel-logs/恢复-2026-11-15-1840.md:3-24`），Workbench 作为 next-gen 路径。

## 一、接口对照
图例：✅ 覆盖｜◐ 部分｜✗ 缺失。

### 1.1 Taiga `FlowPlatform`（daemon 必用）
| 能力（daemon 证据） | Workbench `issues` | 覆盖/缺口 |
|---|---|---|
| `issues.list/get/create/transition/setField`；字段 id/title/state/description/type/dept/level/assignee/parent/lane（`packages/contract/src/ports/platform.ts:179-186`） | `listTickets/getTicket/createTicket/updateTicket/transition`；字段 title/body/kind/priority/labels/parent/assignee/reviewer；**无 type/dept/level/lane/initialState/updatedSince**（`packages/issues/src/types.ts:83-112,310-390`；`service.ts:103-225`） | ◐：状态码固定 1..8、T1–T16（`README.md:89-96`），与公司自定义流程/字段需 adapter 映射或扩包 |
| `comments.add(SignedBody)/list` | flat+reply、append-only，author=principal（`service.ts:167-173`；`types.ts:141-160`） | ✅：signature 可适配生成 |
| `activity.since`（created/commented/transitioned/field-set/change/unknown） | `listEvents/listProjectEvents` 有 event/cursor/hash/actor（`service.ts:199-210`；`types.ts:150-172`） | ◐：可投影；但无平台字段/KB 活动，kind 语义需映射 |
| `fields.schema/provision` | 无（`service.ts:103-225` 无此 API） | ✗：daemon 启动就调 `fields.schema()`（`apps/daemon/src/assembly/serve/run.ts:150`） |
| `kb.upsert/search/get` | 无 | ✗：worker KB 工具面将缺失 |
| `links.link(parent-child/depends-on/relates-to)` + children | 仅 parent/children/reparent；无 blocks/relates（`README.md:167-168`；`service.ts:175-185`） | ◐：daemon breaker 需 relates-to（`apps/daemon/src/engine/harvest/breaker.ts:38`） |
| `guards.install/uninstall/read` | 有 principal/project/membership/roles + 动作权限，但无 guards API（`README.md:97-108`） | ◐：角色模型可映射，权限清单不等价 |
| TicketId=`<slug>-<ref>`（`packages/taiga/src/issues.ts:21`）；UI/搜索/附件 | `key=<keyPrefix>-<seq>` + 内部 UUID；无 HTTP/UI；附件无上传/下载 API，`artifact://` evidence deferred（`types.ts:83-112`；`README.md:165-175`） | ◐ ID 可保留 key；✗ UI/附件 |

### 1.2 Matrix 面（daemon 必用）
| 能力（daemon 证据） | Workbench `collab` | 覆盖/缺口 |
|---|---|---|
| login/密码/token/账号（`packages/matrix/src/client.ts:72-100`；`docs/52-人事同步器设计.md:59`） | 仅 host 传入 actor；无登录/session（`docs/11...:35-43`） | ✗：需 Identity/Session 层，不能直接暴露 |
| 房间/成员/space/alias/invite/join/kick/power（`matrix/src/provision.ts:302-379`；`matrix/src/index.ts:48-68`） | broadcast/group/dm/members/owner/canBroadcast（`collab/README.md:67-80`）；无 alias/space/power/invite/join/kick | ◐：权限可映射；拓扑/Element 地址不兼容 |
| 发消息/sync/长轮询/历史（`client.ts:102-142`） | `sendMessage/listMessages` + cursor；无 `/sync`/HTTP/长轮询（`README.md:82-121`） | ◐：需 adapter/server，不能接现有 Matrix 客户端 |
| mention/DM/reply/read/directed wake（`docs/21...:58-83`） | mention/reply/read；wake=mention/DM/reply/mention_all（`README.md:122-133`） | ◐：**relay 未实现**，wake 停在 pending，无 claim/lease/retry/dead-letter（`README.md:187-199`）；daemon 需 `InvokeSource`（`ports/gate.ts:249-253`） |
| notify 广播（`engine/notify/broadcast.ts:44-50`） | broadcast/group 发送/canBroadcast（`README.md:131-133`） | ◐：无 alias/角色频道映射，需 adapter |
| HR 建号/入房/PL/kick（`engine/hrsync/hrsync.ts:58-70`） | `createActor`/room/member/remove；无账号/密码/MXID/power/kick/alias | ◐：仅近似，矩阵账号≠collab actor，幂等/回滚需重写 |
| 制作人持久 DM（`docs/17:77`；`docs/21:58-83`）；Element/外部 IM | DM/消息可承载，但会话事实源是 `<companyDir>/conversations/*.jsonl`；无 UI/protocol/federation/E2EE（`docs/07...:223-246`） | ◐ DM 可映射；✗ UI/外部入口 |

## 二、迁移方案
### 2.1 单子（Taiga→issues）
- **规模**：约 1,300+ 单（任务口径；qa-report 11-12 记 1,258，`docs/sentinel-logs/宰相处置台账-2026-11-03.md:1219`）+ 评论/附件/状态/父子/字段待盘点。
- **ID**：优先保留公开 `studio-dev-N` 为 `key`（keyPrefix+重置/回填 seq）；内部 UUID 仅库内；另建 `external_ref` mapping 供 adapter；**不改历史 events/work_records/AIWS/report 引用**。不能保 key 时走全量 mapping+双读。
- **状态/字段**：Taiga 公司自定义状态→Workbench 1..8 映射表；不可映射级保留 `legacy_state` 标签/旁路，不压缩；type/dept/level/lane/fields 无原生位，需扩包或落 labels（不推荐仅 labels，daemon 读不到）。
- **评论/附件/活动**：评论导入需 author principal+时间+reply；附件不在 FlowPlatform 端口，但 Taiga UI/审计会丢——导出文件+元数据/evidence URI，或制作人明确接受不迁；Taiga history 只能列为迁移审计/评论，不能伪装原生事件。
- **台账/回滚**：`ticket_mirror` 是投影（`packages/store/src/records.ts:113-129`），切后重建；双跑期 Taiga 唯一写、Workbench 只读影子+diff；冻结→导出→切换→回归；失败回 `platform: taiga`+Taiga 备份，不双写。

### 2.2 聊天（Matrix→collab）
- **账号**：MXID→actor 映射，保留 displayName/状态；不迁密码（collab 无登录），需另建 Identity/Session 或仅 daemon 内部 actor。
- **房间/历史**：room_id/alias→collab ID；广播/群/DM、成员/owner/canBroadcast 映射 power/invite；按时间导入消息（sender/body/kind/reply/mentions），保留只读归档；新 read cursor 基线=导入末 seq，**旧历史不重放 mention**。
- **mention→wake**：collab 产 wake 行但 relay 未实现；补 claim/lease/retry/ack，适配 `InvokeSource`；DM/reply/mention_all 语义已有。
- **UI/外部 IM**：Element 不能直连；需 Web 面板（Workbench DSH 计划 `docs/07...:223-246`）或保留 Matrix bridge（仍要 Docker）；手机/外部客户端无等价物。

## 三、缺口与改动量（粗估）
| 工作块 | 改动面 | 人日 |
|---|---|---:|
| Phase0 离线 PoC | 10 单导入+字段/状态/评论比对；collab mention→wake 模拟；不碰生产 | 5–8 |
| Host/API/面板基础（共享） | 新 host/HTTP/auth/UI（DSH 或 daemon Hono）；Workbench 自估 Host+面板 3–5 周（`docs/07...:284-334`） | 15–25 |
| 聊天增量 | InvokeSource/Notifier/HR/rooms/conversation；Matrix 历史导入；双跑/回滚 | 15–20 |
| 单子增量 | FlowPlatform 七能力；state/type/dept/level/lane/fields/activity/links/KB/guards；1,300+ 单/评论/附件/父子迁移；搜索/附件 UI | 45–65 |
| 集成/总验收 | 双跑 diff、回滚演练、多公司/权限/性能 | 15–20 |
> 汇总：聊天路径 **30–45 人日**（共享基础+聊天增量）；单子路径 **60–90 人日**；两者+A 总验收 **90–130 人日**（1 名熟练工程师+AI，未含用户验收等待）。粗估非承诺。

## 四、选项与推荐
| 选项 | 内容 | 结论 |
|---|---|---|
| **A 全替代** | issues+collab 全量上线，关 Taiga/Matrix/Element | **不建议当前做**：90–130 人日+迁移/UI/认证高风险；关 Docker 是结果不是起点 |
| **B 部分替代** | B-1 先聊天/通知/wake；B-2 后单子 | **推荐路径**：B-1 可先验证；Taiga 保留，Docker 仍不能关；B-2 需 fields/activity/links/KB/附件/UI 补齐 |
| **C 不替代/只借鉴** | 保留 Docker，借 collab wake/read 与 issues 状态/权限/证据/测试 | **当前生产推荐**：不改生产；加固 Docker 自启/备份/VM 盘位；另开 Phase0 |
> 具体：生产 C；批 **Phase0（5–8 人日）**；过→B-1（30–45 人日）但保留 Matrix 只读回滚；**Issues 不切**（最多 adapter 试验），待 parity+迁移另批；A 仅在两者都过验收后成立。

## 五、风险与验证
- **功能回退**：Taiga UI/搜索/附件/自定义状态/活动、Element/外部 IM、通知/未读；两包是切片，不覆盖完整产品。
- **数据迁移**：1300+ 单/评论/附件/状态/ID/台账/AIWS 引用；丢单/改号/状态压缩不可接受；需行数/哈希/双跑 diff/回滚演练。
- **契约/装配**：FlowPlatform 缺 fields/KB/activity/links/guards；Matrix faces 缺 login/rooms/power/relay；adapter 缺位必须明报，不能静默 no-op。
- **多公司/安全/运维**：每公司独立 DB/路由/备份；两包是 in-process trusted host、无 HTTP/auth（`docs/11...:35-43`），直接暴露=伪造 actor/越权；SQLite 单写/备份/迁移、DSH 0.x pin、双源 outbox。
- **验证清单**：①重跑 80/80/133/133/84/84；②FlowPlatform fake parity（七能力+10 单字段/状态/评论）；③collab mention/DM/reply/all→wake→daemon intent、无 relay 不投；④迁移全量行数/ID/状态/comment/附件校验；⑤双跑只读 diff、回滚演练；⑥多公司/权限/无 Session 暴露负测；⑦备份恢复/性能。
- **本地 PoC（下一单，不碰生产）**：10 历史单导入 issues SQLite，比对 7 字段+状态+评论；collab 建房/成员/@→检查 wake 行；不接 daemon/Docker。

## 六、证据索引
- Workbench：`<workbenchRoot>`；`packages/issues/README.md:156-175`；`packages/collab/README.md:67-133,187-209`；`verification/report.md:30-40`；`docs/07-DSH集成与开发计划.md:196-246,284-334`；`docs/11...:35-43`。
- daemon：`packages/contract/src/ports/platform.ts:179-216`；`ports/gate.ts:249-280`；`engine/notify/broadcast.ts:44-50`；`engine/hrsync/hrsync.ts:58-70`；`engine/rooms/room-duty.ts:57-62`；`packages/matrix/src/index.ts:1-68`、`client.ts:72-142`、`provision.ts:302-379`；`packages/taiga/src/issues.ts:21`；`packages/store/src/records.ts:113-129`。
- 运行面：`<volume>/companies/studio-dev/daemon.yaml:3,47-49`；`docs/sentinel-logs/恢复-2026-11-14-2320.md:6,10-12`；`docs/sentinel-logs/恢复-2026-11-15-1840.md:3-24`；`docs/sentinel-logs/宰相处置台账-2026-11-03.md:1219`。
