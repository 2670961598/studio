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
- 记录两类（`v=1`）：
  - `message`：`{v,kind,seq,id,at,personId,from:{kind:'producer'|'person',ref},text,source:'matrix'|'panel',clientMsgId?}`
  - `clear`：`{v,kind,seq,id,at,personId,by,reason?,source}`
- `seq` 由存储侧单点分配（同一工号单调递增，从 1 起）；`id` 全局唯一（ULID 或等价物）。
- 追加原子性：单行 ≤ 16KB（正文上限 4000 字符），O_APPEND 单次写；坏行隔离不阻塞后续读。
- clear 语义：**只追加 clear 记录，不物理删除**（审计留痕）；有效历史=最后一条 clear 之后的 message。
- 存储不入契约包（不是 REC- 族，不改 v2/11 记录形状）；不建台账表（避免与既有 `sessions`
  归档表混名）。
- 权限：写只允许 Matrix 网关（Phase 1）与面板制作人凭据（Phase 2）；读对环回访客开放。

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
- 端点/页面/轮询/失败标记详见 `docs/v2/14` §8.1。

### 7.5 验收口径

1. Matrix 端发一条 → 面板端一个轮询周期内可见（同 seq）。
2. 面板端发一条 → Matrix 端收到并使用同一 seq，不产生重复消息。
3. 任一端 clear → 两端历史同时清空，clear 记录仍在（审计可查）。
4. 无凭据写 → 401/403/503，且会话文件零变化。
