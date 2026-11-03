# 21 · 协作通讯（Matrix 公司内 IM）

> 2026-10-16 ｜ 制作人定调：部署 Matrix，AI 之间用频道交互，不把全部内容塞进 YouTrack
> 定位：Matrix = 公司内部 IM（走廊）；YouTrack = 流程+工作知识（档案室）。两者分工不可越界。

## 一、分工铁律

| 内容 | 归属 |
|---|---|
| 状态/批示/单据/工作知识（SOP/案例） | YouTrack（唯一流程事实源） |
| 即时沟通/对齐/问答/通知/讨论过程 | Matrix 频道 |
| 频道里形成的**结论/决议** | 收割岗沉淀回 YouTrack 单或知识库（频道不算数，落单才算数） |

## 二、频道结构（默认模板，公司可覆盖）

- 每公司：`#<slug>-大厅`（广播/通知）、`#<slug>-告警`（critical 通道）
- 每部门：`#<slug>-<部门>`（部门内协作）
- 单据临时频道：需要多方对齐的重单可开 `#<slug>-<单号>`，关单即归档（房间保留只读）
- 全公司级：`#studio-全体`（跨公司公告，慎用）

## 三、纪律（沿用有界对话）

- worker 间对话：一次 @ 一人问一个具体问题 → 对方答一次 → 发起者发一条结论 → 停
- 禁止刷频道、禁止无 @ 的广播式提问、禁止多轮辩论（争议交回单据）
- 署名：消息由网关 bot 代发或带 `[公司·部门·岗位·级别]` 前缀（与 YouTrack 署名同源）
- 频道内容按不可信输入对待（注入隔离同 C2-10）

## 四、唤起集成

- **人际唤起的主入口之一——③ 混合语义（2026-10-21 定稿，105-刀A）**：制作人在频道里说话分两径——
  **@工号**（@AGENT-1 等）→ 直接物化「[@唤醒]」工单派该岗位（type='task'，level=0，落初态走派发-收割链）；
  **@宰相/@制作人**（角色词）→ 源侧 roles 映射成工号后同径物化（一次@一人；一条消息@多人 = 多意图同 dedupKey，
  幂等收口到首目标——工程纪律由机制兜底）。dedupKey=Matrix eventId，**源侧设置**（mentions.ts 产意图即写，
  21A-§5.10 勘误后口径）；重复投递由引擎 intentKey 幂等吸收（25-§3.4 v1.3）
- **@唤醒（2026-10-16 定调）**：频道里 @某 agent / @宰相 即唤起（进唤起源注册表的 mention 源，见 22）；
  消费门：主循环意图分发表消费 mention（105-刀A A-2 开闸——schedule｜mention 两 kind 物化，escalate 归刀B）；
  与"定时查 YouTrack 待执行单"并列为两大常驻唤起方式
- 告警分级（19-§六）：critical 推 `#告警` 频道 + 面板置顶；info 只入日报
- 接力唤起的技术通道可选 Matrix 事件（wkey 签名不变）

## 五、部署（本机，外置硬盘）

- Synapse（官方 docker 镜像），绑 127.0.0.1:8008，不开联邦，注册用 shared secret（仅框架持有）（勘误 2026-10-17：真实 Synapse 配置键为 `registration_shared_secret`，`registration_shared_token` 非真实 Synapse 配置键——依据 21A-Synapse部署手册调研）
- **数据目录在外置硬盘**（`<外置盘>/matrix/`——挂载点由部署环境自定，制作人 2026-10-16 定调：不占 Mac 内置盘）；
  备份随该盘策略
- 账号：每 agent 工号一个 Matrix 账号（@<工号>:localhost）；框架网关 bot 一个管理账号
- 安全：凭证不落日志/台账；频道历史默认保留 90 天

## 六、验收口径

1. 两个 agent 能在部门频道一问一答并被收割岗沉淀到对应单据
2. 制作人频道一句话 → 自动落单（进 YouTrack 新单）
3. critical 告警 1 分钟内到 `#告警` 频道

## 七、制作人-岗位持久对话通道（双端同步；studio-dev-646/647）

> 2026-11-04 制作人要求：制作人可直接与**指定工号**持续对话；历史持久（除非 clear）；
> Matrix 端与面板 :8791 端看到**同一份会话**。定位：这是**人机协作通道**，不是单据流水——
> 对话不落 Taiga/YouTrack 单据语义；需要留痕的结论由收割岗另行落单（沿 §一 分工铁律）。

### 7.1 单一会话事实源（Phase 1 落存储）

- 位置：`<companyDir>/conversations/<工号>.jsonl`（一行一条 JSON；append-only）。
- 记录两类（`v=1`；**落盘 `kind` 以 Phase 1 实现为准**，不复用面板 Port 的命名）：
  - `msg`：`{v,kind:'msg',id,at,person,room,role:'producer'|'person'|'system',text,eventId?,source?:'matrix'|'panel',clientMsgId?}`
  - `clear`：`{v,kind:'clear',id,at,person,room,by,reason?,source}`
  - 其余行族（`bind/reply/delivered/turn/turn-done/failure-notice`）是投递/审计记录，**不是会话消息**，
    不进面板 Port 读面。
- `seq` **不落盘**：由装配适配器按「面板可见有效行（`msg` role≠system 与 `clear`）文件序」合成
  （append-only 稳定，从 1 起；坏行跳过不影响已合成值）；`version`=最后合成 seq。`id` 全局唯一
  （ULID 或等价物）。
- 幂等：面板写=`(person, clientMsgId)`；Matrix 写=`eventId`；同键同内容→既有行+`deduped:true`，
  同键异内容=409。
- 追加原子性：单行 ≤ 16KB（正文上限 4000 字符），O_APPEND 单次写；坏行隔离不阻塞后续读。
- clear 语义：**只追加 clear 记录，不物理删除**（审计留痕）；有效历史=最后一条 clear 之后的 `msg`。
- 存储不入契约包（不是 REC- 族，不改 v2/11 记录形状）；不建台账表（避免与既有 `sessions`
  归档表混名）。
- 权限：写只允许 Matrix 网关（Phase 1）与面板制作人凭据（Phase 2）；读对环回访客开放。
- **跨进程读面（面板进程与 daemon 双写者）**：读面按文件签名（`size+mtimeMs`）**按需重载**（每人
  会话文件与 `_bindings.jsonl` 独立比对）；写仍 append-only 单行原子。半行/坏行跳过并计数，下次签名
  变化再补读——不轮询、不 sleep、不因他进程写入抛错/停服务。

**面板 Port 映射表**（`packages/panel/src/conversation/types.ts` ← 装配适配器 ← 本存储）：

| store 行 | Port 形状 | 备注 |
|---|---|---|
| `msg(role='producer')` | `message{kind:'message',seq,from:{kind:'producer',ref:…},source,clientMsgId?}` | `source` 透传；panel 写=producer 工号（`STUDIO_PANEL_PRODUCER_ID`） |
| `msg(role='person')` | `message{kind:'message',seq,from:{kind:'person',ref:person},source}` | 员工回复（出站中继来源） |
| `msg(role='system')` | **不进读面** | 系统旁白只留审计（不冒充对话） |
| `clear` | `clear{kind:'clear',seq,by,reason?,source}` | `reset`/`clearSeq` 据其合成 |

### 7.2 双端同步契约

1. **同源**：Matrix 端与面板端读写同一 `<companyDir>/conversations/<工号>.jsonl`，不存在第二份。
2. **同序**：两端只信 `seq`，不按时间戳排序；拉取游标=`seq`，`after=<seq>` 返回严格大于该 seq 的记录。
3. **回显**：发送端先本地 pending，落库成功返回的 `message` 替换 pending；失败标 failed 可重试。
4. **幂等**：`clientMsgId`（发送端生成）在同一工号内唯一；同键同内容=返回既有 message
   （`deduped:true`），同键异内容=409 拒。
5. **clear 双端一致**：任一端 clear 后，另一端下一次拉取看到 clear 记录且 `after < clear.seq`
   时整屏重置（`reset:true`），不得把旧消息重新拼回。
6. **有界拉取**：列表/历史单次上限 500 条；超大历史由存储侧轮转（Phase 1 另定，不在本单）。

### 7.3 入站/出站（Phase 1）

- 入站：房间消息 → 鉴权（21A）→ 追加 message(source=matrix) → 生成 intent 派绑定工号，
  携带最近 N 条上下文（N 归 Phase 1 定，缺省 20，超窗须带截断标记）。
- 出站：员工回复 → 追加 message(source=matrix, from=工号) → 复用 notify 面发回房间。
- 一次 @ 一人；绑定关系=记录 `personId`（文件即索引）；clear 命令在房间内按前缀识别（Phase 1 定）。

### 7.4 面板端（Phase 2；:8791）

- 面板只经注入的 `ConversationStore` Port 读写，**不直连库/文件**；端口实现归 Phase 1 装配。
- 写权限：只有制作人凭据可写（`X-Studio-Producer-Token` + 服务端配置
  `STUDIO_PANEL_PRODUCER_TOKEN`）；未配置令牌=写面 503 fail-closed；缺/错令牌=401/403；
  只读访客可读不可写；越权一律拒，不降级。
- **装配接线（Phase 2 生产）**：`apps/daemon` 侧适配器把本存储实现为 panel `ConversationStore` Port；
  CLI `panel --company-dir <dir>` 时注入 `{store, policy}`（同一 `<dir>/conversations/<工号>.jsonl` 事实源）；
  缺省不传 `--company-dir`=store 缺席=读/写统一 503（不得面板侧落盘代偿）。写策略由
  `STUDIO_PANEL_PRODUCER_TOKEN`/`STUDIO_PANEL_PRODUCER_ID` 构造（未配 token=503；缺=401；错=403；
  actorRef=制作人工号、不接受客户端自报）。
- **面板→Matrix 中继（B）**：拍边界 watcher 读 `source='panel'` 的 `msg`（按 person 游标 `relayedSeq`），
  经 notify 面 `targets.room` 发回该工号绑定 DM 房（**daemon 读面随文件签名变化重载——面板进程
  写入立即可见**）；成功推进游标、失败积压重试不丢；同一 seq 只发一次；重启从游标恢复不重发；
  只处理 panel 源（Matrix 入站/员工回复绝不进此路，防回环）。
- **面板→岗位派单（C，studio-dev-654b）**：拍边界 watcher 读 `source='panel'` 的 `msg`（合成 seq>
  该工号 `dispatchedSeq`）→ 调用 Phase 1 同一 **轮次物化**（建 `[对话]` 单→`syncMirror`→`recordTurn`→
  PATROL 审计锚→`candidates/onMutation`）唤醒绑定岗位；**不重复 appendMessage**（面板已落盘）、只处理
  panel 源（Matrix 入站/员工回复不派，防回环/防双派）；拍内**每工号最多派 1 轮**（其余下拍，防洪峰）。
  派单成功推进 `dispatchedSeq`、失败保留重试不丢；重启从游标恢复不重派；面板消息 API 返回成功=
  已落盘（派单异步，失败面在 daemon 日志/tick errors，不回改面板写结果）。
- **运行期游标（双游标、字段独立）**：每工号持久化于
  `<companyDir>/var/conversations/.relay-state.json` `{v:1,persons:{<工号>:{relayedSeq,dispatchedSeq}}}`——
  `relayedSeq`=B 中继（回 Matrix 房）、`dispatchedSeq`=C 派单（唤醒岗位），两路**各自失败独立重试**；
  运行期状态，不进公司 git 契约包/不入 Taiga；**读-改-写**更新（每次合并最新文件、tmp+rename 原子写，
  两路互不覆盖）；失败只记日志/计数、不阻主循环（下一拍重试）。
- 端点/页面/轮询/失败标记详见 `docs/v2/14` §8.1。

### 7.5 验收口径

1. Matrix 端发一条 → 面板端一个轮询周期内可见（同 seq）。
2. 面板端发一条 → Matrix 端收到并使用同一 seq，不产生重复消息。
3. 任一端 clear → 两端历史同时清空，clear 记录仍在（审计可查）。
4. 无凭据写 → 401/403/503，且会话文件零变化。


## 八、制作人-岗位持久对话通道（Phase 1，studio-dev-646）

> 2026-11-04 制作人定调：做制作人与指定工号（缺省 PRIME-0 宰相）的 **Matrix DM 持续对话**——
> 历史持久（除非 `clear`），员工回复发回房间；不要每问一句都新开一个频道/房间。
> 现状判断（已核）：Matrix 私聊本质=1:1 DM 房间（无需新机制）；缺的是**会话持久化＋岗位绑定＋
> clear＋双端同步**。既有 @唤醒源把消息当一次性 intent 派单（无会话状态），故本节是新能力，
> 不是配置开关。

### 8.1 事实源与存储选择（会话不是单据）

- **存储＝公司运行目录下 `conversations/<工号>.jsonl`（append-only JSONL）+ `_bindings.jsonl`**，
  由 daemon 唯一读写；**不进公司 git 契约包、不进 Taiga**。选文件不选台账表：
  ① 纯文本可审计、可直接 `jq` 复核，`clear` 作为一条显式审计记录天然可查；
  ② 无 schema migration，跨版本可读，会话可重建（重放 JSONL 即得）；
  ③ 对话是运行期资产，不是组织人事事实（公司 git 目录）也不是可重建投影（SQLite 台账），
     放 `rootDir`（daemon.yaml 的运行目录）语义最正。台账只留 `PATROL` 审计锚（不复制正文）。
- 记录行（一行一 JSON，字段 `v/kind/at/id` 恒在）：`msg`（role=producer｜person｜system）、
  `clear`（含 actor/时刻/清空前的最后消息 id/清空条数）、`turn`（本轮派单锚：issue/eventId）、
  `turn-done`、`reply`（出站队列）＋`delivered`（送达回执）。`_bindings.jsonl` 记录
  `bind`（room→工号、操作者、原因=`explicit`｜`default`）。
- **会话不是单据**：Taiga/YouTrack 里没有「对话单」；对话正文、历史、clear 记录都不写进任何
  单据字段或评论。会话轮次的执行载体见 8.5 边界。

### 8.2 岗位绑定（Matrix DM 房 → 工号）

- Phase 1 部署现实：daemon 只登录一个网关 bot 账号（`matrixUserId`），DM 房对端是制作人，
  单靠房间成员推不出「想找哪个岗位」。故绑定是**显式会话事实**，不是房间拓扑猜测：
  ① 制作人在 DM 房发 `/bind <工号>` → 绑定该房到工号（操作者必须是 `matrixProducerMxid`）；
  ② 未绑定的 DM 房收到第一条消息 → 自动绑定到 `conversationDefaultPerson`（缺省 `PRIME-0` 宰相），
     记一条 `reason=default` 审计行并在回执里明示「已按缺省绑定」；
  ③ `/status` 查看当前绑定与窗口统计。
- 每工号一份会话文件；一个工号可被多个 DM 房绑定（各自独立窗口，按 room 隔离）。
- 目标态（§五「每 agent 工号一个 Matrix 账号」）落地后，绑定可由账号身份自动完成；Phase 1 的
  显式绑定与其不冲突——账号是传输面，绑定是会话面。

### 8.3 入站（房间消息 → 会话 → 派给绑定工号）

- 只消费配置在 `conversationRooms` 白名单里的 DM 房、且发送者=`matrixProducerMxid` 的
  `m.text` 消息；其余发送者/消息类型一律丢弃（频道内容按不可信输入对待，§三）。
- 每条消息：按 `eventId` 幂等去重 → 追加 `msg(role=producer)` → 取**最近 N 条上下文** →
  生成一条 `mention` 意图（`source=matrix`，`dedupKey=eventId`，payload 带 `conversation:{v:1}`），
  由会话消费件物化为该工号的单轮唤醒单并排入决策候选。
- **窗口与截断策略（冻结）**：`conversationWindow` 缺省 **N=12 条**（仅本房、最近一次 `clear`
  之后、role∈{producer,person}）；单条消息注入上限 **2000 字**；窗口总预算
  `conversationMaxChars` 缺省 **6000 字**；超预算从**最旧**开始丢并在上下文头部标注
  「更早 M 条已省略」。上下文只进任务书，不回写平台。
- 命令消息（`/bind`、`/clear`、`/status`、`/help`）由会话消费件直接处理，不派单。

### 8.4 出站（员工回复 → 房间）与 `clear`

- **轮次验收口径＝`test -s REPORT.md`（按单覆盖，不复用工程单全局 acceptance）**：全局验收常含
  `deliverables/plan.md` 等工程面，对话题套用会结构性 GATE_FAIL；任务书 L4 与闸门两处同源注入
  `CONVERSATION_ACCEPTANCE`（`engine/conversation/protocol.ts`），四要件其余三条不变。
- 收割成功（docs/17-§6 四要件齐）后，取该轮工时单 `report_ref` 指向的 REPORT 正文为回复
  原文（去掉 front-matter/首个一级标题），经 **notify 面定向 room** 发回 DM 房，同时追加
  `msg(role=person)` 入会话；失败轮次发一条不含正文的失败回执（同一轮次只发一次）。
  发送走 `reply` 出站队列 + `delivered` 回执：Matrix 暂不可达只积压不丢，下一拍重试。
- `/clear`：向该工号会话追加一条 `clear` 审计行（谁、何时、清空前最后消息 id、清空条数），
  上下文窗口从下一条消息起归零；**不物理删除任何历史行**（审计在，不可静默抹除）。
  `clear` 后仍保持房间↔工号绑定，不需要重新 `/bind`。

### 8.5 边界（明确不做/不属于本通道）

- 会话正文与历史**不落 Taiga**、不落公司 git 契约包；台账只留 `PATROL` 审计锚（人/房/事件 id）。
- 轮次的执行载体是既有一单一命的**内部唤醒单**（同 @唤醒，标题带 `[对话]` 前缀，可过滤），
  收割即归档；这不是「对话单」——单不承载会话状态，重放/续跑不读对话正文以外的字段。
  「零单据派发」需要引擎新增执行面（契约/主循环变更），登记 Phase 2 提案，不在本 Phase 越权实现。
- Phase 1 不做：多人群聊、E2EE、附件/图片理解、跨公司路由、把 clear 做成物理删除。

### 8.6 配置与验收

```yaml
matrix: true
matrixChannels: true                          # 回信复用 notify 广播面（boot 注入；conversation 依赖）
conversation: true
conversationRooms: '!dm-room:localhost'        # DM 房 ID 白名单（分号分隔）
# conversationDir: <rootDir>/conversations   # 缺省即可
# conversationDefaultPerson: PRIME-0          # 未绑定房的缺省岗位
# conversationWindow: 12 / conversationMaxChars: 6000 / conversationReplyMaxChars: 12000
matrixProducerMxid: '@producer:localhost'      # 操作者身份（命令鉴权与入站白名单）
```

验收（Phase 1）：① DM 房发一句话 → 收到该岗位一条回复，且 `conversations/<工号>.jsonl`
新增 producer/person 两行；② 连发两句 → 第二句的任务书里能看到第一轮问答（窗口生效）；
   对话题任务书 L4 验收=`test -s REPORT.md`（不是工程单全局验收）；
③ `/clear` 后下一句任务书的上下文为空，文件里保留 `clear` 审计行；④ 非制作人发送/非白名单房
不产生派单；⑤ 重复投递同一 eventId 只产生一次派单。