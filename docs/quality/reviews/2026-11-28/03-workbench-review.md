# StudioNext 子公司 `workbench-dev` 独立评审

> 评审身份：Kimi k3.1-pro；对象：使用 StudioNext 框架开发插件产品的子公司。  
> 快照观察点：事件最晚至 2026-11-28 02:34:39。除特别标注 `Z` 的 JSONL 时间外，下文使用导出 CSV 的快照本地时间。  
> 总结论：**插件产品化发布 No-Go**。已有四库物理隔离、权限与较完整的测试基础，但事件可靠性有两个已证实的 P0 缺陷；框架又把模型限额、技术收割、验收与发布混成重试链，形成尝试风暴和 174 单待验收积压。

## 一、已读、未读与预算

### 1.1 已读

| 范围 | 实际读取方式与覆盖 |
|---|---|
| 五个小表 | 全读：`queue_state.csv` 5 行、`events_summary.csv` 12 行、`failures_esc_s14d.csv` 253 行、`work_records_s14d.csv` 366 行、`jobs.csv` 4 行。CSV 均无表头，按实际列序解释。 |
| 平台单据 | 对 225 份 `LOCAL-*.jsonl` 做流式统计，共 1,215 个 transition、394 次“→已派发”；取派发次数最高的 8 单。对 LOCAL-217、218、215、203、204、207 读取 title、当前状态、完整状态序列，并展开各自最近 10 条事件；未展开其他单的历史正文。 |
| 插件说明与清单 | 全读 `README.md`、`package.json`；`src/ports/` 仅见 `storage.ts`；`src/core/runtime/` 仅见 `company-runtime.ts`、`index.ts`。 |
| 插件源码抽样 | 仅按 `ingress/rejected/outbox/ack/512/recovery/GATE_PASS/transition` 等关键词 grep，并读命中点的上下文：outbox relay、dispatch cache、delivery executor、recovery、company registry、issues 单条/批量/Remote 流转及 client mock 标识。未全读仓库。 |
| 配置与首轮材料 | 全读 `daemon.yaml`、`agent.yaml`、`org-config.yaml`、`00-partial-findings-kimi.md`。 |

### 1.2 未读／未做

- 未读 `tickets.csv`、`usage_daily.csv`、`cost_daily.csv`、`people.csv`、`events_last24h.csv`，未读 issue comments、REPORT、deliverables、全量源码和原始运行日志；未解压任何日志。
- 未连接外部系统，未检查真实凭据、模型账户余额、部署 profile、数据库内容或发布产物。
- 未运行测试或并发故障注入，因此“源码可复现”不等同于本轮做了动态复现；实际生产丢事件数量、跨公司泄露事故、历史批量收口是否经过真实人工验收均标为**未核验**。
- 本评审只写本文件，未改快照或其他输出。

### 1.3 预算

核心全文输入为 185,088 bytes；225 份 issue JSONL 的流式统计输入为 189,816 bytes；再加定向源码片段与 grep，估算总读取量 **<1MB**，低于 5MB。未使用全量历史展开；token 无可用精确计数器，但按上述定向读取方式控制在 120k 预算内。

## 二、使用现状

### 2.1 口径先拆开

- `events_summary.csv` 覆盖约 2026-11-05 至 11-28；`work_records_s14d.csv` 是近 14 天、366 次工作记录。两者时间窗不同，不能直接相减做逐单对账。
- **`done` 只表示一次 work record 的技术完成，不等于 CLOSE／已交付，更不等于已发布。** 本报告把“交付量”限定为 CLOSE／当前“已交付”，把 `done` 单列为技术收割量。
- “尝试次数”统一采用 issue JSONL 中 `transitioned → 已派发` 的次数。失败 CSV 的 `attempt` 是另一编号口径：例如 LOCAL-204 有 20 次失败加最后 1 次成功，所以是 21 次派发；LOCAL-188 却出现最大失败标号 41、派发仅 40 次，属于需要专项对账的异常。

### 2.2 队列、交付量与失败率

当前队列共 225 单：

| 状态 | 数量 | 解释 |
|---|---:|---|
| 待验收 | **174** | 当前快照真值；题述“176”与本快照不一致，首轮材料也写 174。 |
| 已交付 | 26 | 与 CLOSE 总数相等。 |
| 新单 | 21 | 尚未进入或已回退到 inbox。 |
| Archived | 3 | 包含高尝试单 LOCAL-188。 |
| 已派发 | 1 | 与唯一 running 的 LOCAL-224 同量，但本轮未做逐单映射。 |

174 张待验收是已交付量的 **6.7 倍**，占当前未交付且未归档单（174+21+1=196）的 **88.8%**。最后一次 CLOSE 停在 2026-11-14，至观察点约 13 天没有新 CLOSE。

近 14 天 work record 结果：

| 结果 | 次数 | 占全部 366 次 |
|---|---:|---:|
| done | 174 | 47.5% |
| failed | 183 | **50.0%** |
| interrupted | 8 | 2.2% |
| running | 1 | 0.3% |

- 排除 1 条 running 后，尝试级 `failed` 率为 **183/365=50.1%**；把 interrupted 也视为未成功终结，则非 done 率为 **191/365=52.3%**。
- 全窗口闸门事件为 GATE_PASS 199、GATE_FAIL 193，即事件级闸门失败率 **49.2%**。它与上述 work record 失败率的时间窗、去重和终态语义不同，不应混成一个 KPI。
- CLOSE 仅 26，而 GATE_PASS／QA_PASS 各 199。汇总表不足以逐单解释差额，但足以证明“技术通过量”远大于“最终交付量”。

### 2.3 尝试风暴分布

225 单中，22 单从未派发、170 单仅派发 1 次、33 单派发至少 2 次。33 个重试单贡献 224 次派发，占全部 394 次的 56.9%。重试分布为：2 次 10 单、3 次 6 单、4 次 2 单、5 次 4 单、7 次 2 单，其余为 9/10/11/20/21/40 次。

按“→已派发”次数排序的最高 8 单：

| 排名 | 单据 | 派发次数 | 当前状态 | 主题摘要 |
|---|---|---:|---|---|
| 1 | LOCAL-188 | **40** | Archived | wiring-master R2 对抗回改 |
| 2 | LOCAL-204 | **21** | 待验收 | Batch2：恢复分页、DEFERRED、缺口、毒桶 |
| 3 | LOCAL-203 | **20** | 待验收 | 连线机制 A 片：复演、信封、防环、预算 |
| 4= | LOCAL-172 | 11 | 待验收 | 引擎与工程债修复 |
| 4= | LOCAL-174 | 11 | 待验收 | 外部全仓 review 逐条核验 |
| 4= | LOCAL-183 | 11 | 待验收 | 数据损坏阻断：事务、容量、once |
| 4= | LOCAL-207 | 11 | 待验收 | syntax-gate 超时及 spawn 审计 |
| 8 | LOCAL-185 | 10 | 待验收 | 权限、敏感信息与并发修复 |

前 8 单合计 135 次派发，占总量 **34.3%**。六个重点单合计 70 次，占 **17.8%**。

重点单核验如下；“失败构成”均能在失败导出与 work record 的最终 `done` 相互印证：

| 单据 | 派发／work records | 失败与中断构成 | 最终状态链与当前状态 |
|---|---:|---|---|
| LOCAL-203 | 20／20 | 19 failed + 1 done：6 timeout、10 次 Kimi 5h 429、2 次 1310、1 次 401 | 19 轮“已派发→新单”后，最后“已派发→证据就绪→复验通过→待验收”；**未 CLOSE** |
| LOCAL-204 | 21／21 | 20 failed + 1 done：7 timeout、10 次 Kimi 5h 429、2 次 1310、1 次 401 | 同上；**待验收** |
| LOCAL-207 | 11／11 | 10 failed + 1 done：3 timeout、7 次 Kimi 5h 429 | 同上；**待验收** |
| LOCAL-215 | 4／4 | 3 failed + 1 done：3 次 `exit=124(timeout)` | 同上；**待验收** |
| LOCAL-217 | 7／7 | 5 failed + 1 interrupted + 1 done：5 次 1308，另有 orphan recovery | 同上；**待验收** |
| LOCAL-218 | 7／7 | 5 failed + 1 interrupted + 1 done：5 次 1308，另有 orphan recovery | 同上；**待验收** |

这不是“少数健康重试”：同一环境错误被记成 GATE_FAIL、回退新单、再次派发；三连击熔断会开 bug 单，但原文明确“熔断非终局”，原单仍继续半开重试。203/204/207 与 217/218 的同步失败尤其说明缺少**供应商／模型级**暂停，而不只是单工单熔断。

### 2.4 429／GLM 限额窗口的实际影响

在 191 条近 14 天 GATE_FAIL 中，可识别 429 共 **45 条（23.6%）**：27 条 Kimi 5h、10 条 1308 5h、4 条 1310 周／月限额、4 条 OpenCode Go 5h。供应商标识按错误正文及 DSH/GLM 配置推断，并非独立账单核验。

| 窗口 | 证据 | 影响与判断 |
|---|---|---|
| 11-17 01:53:15–01:53:34 | LOCAL-80 在 19 秒内连续 4 次 OpenCode 5h 429；错误称还需 17–18 分钟重置 | 秒级重试没有尊重已知冷却窗，直接触发三连击熔断。 |
| 11-26 09:33–10:05 | LOCAL-203/204 各 2 次 1310；重置时间为 **11-27 14:24:57** | 周／月窗被当作普通 GATE_FAIL；之后仍继续其他尝试，未见全模型暂停到 `reset_at` 的证据。 |
| 11-26 11:18–14:34 | LOCAL-203/204/207 合计 27 次 `exceeded_current_quota_error`；另有 2 次 401 | 同一 5h 环境故障放大为 27 次失败，并叠加在既有 timeout 之后。401 应与 429 分类，不能共用盲目重试。 |
| 11-27 14:39–15:42 | LOCAL-217/218 各 5 次 1308；重置时间均为 **16:00:31** | 已知 reset 后仍连续重试；16:13 两单重新启动，分别于 16:41/17:03 `done`，说明恢复后可通过，也反证窗口内重试基本无效。 |

配置侧又显示 `primaryExecutor: dsh`，7 名人员的 executor 全为 dsh，注释称因 Kimi 周额度耗尽切到 DSH（GLM）。这避免了单账号完全停摆，却把并发集中到另一限额池；没有按公司、供应商、模型、岗位隔离配额与公平排队的证据。

### 2.5 验收超时、积压与“GATE_PASS≠可发布”

- 近 14 天有 **21 次 `exit=124(timeout)`**，其中 19 次集中于 203/204/207/215，占 90.5%。这是导致长重试链的第二大可识别原因。
- 当前 `acceptanceTimeoutMs: 300000`，配置注释说明全仓 194 个测试文件、通常超过 100 秒；215 在三次 timeout 后通过，203/204/207 也最终通过，说明延长／修复闸门可能有效。但本轮未读配置变更历史，**不能断言 300 秒已根治**；11-28 的 LOCAL-221/225 仍有真实 `exit=1`。
- 当前验收命令是 REPORT、plan 非空，再在**共享、可变的** `workbench-plugin` checkout 跑 `node --test`。未见把 ticket revision、commit、依赖锁、构建产物 digest 与 gateRun 绑定的配置；所以 GATE_PASS 至多证明“某时某工作区命令通过”，不是可发布制品证明。
- `org-config.yaml` 只有“待验收→已交付”的最终业务语义，没有独立的“已验收／已发布／已撤回”状态及发布授权记录。六个重点单最终都停在待验收，是最直接的反例。
- 风险不是假设：历史上 LOCAL-2 至 LOCAL-26 共 **25 单在 2026-11-14 18:11:57 同一秒**从待验收转为已交付；另 LOCAL-1 曾从新单直接到已交付。25 单的历史中均出现证据就绪、复验通过、待验收，故**批量事实成立，但“假”未核验**，也不能把该 localfile 结果归因于插件 UI。
- 因而对当前 174 单应先逐单验证 gateRun、证据、代码版本和人工授权，禁止为降低积压数字直接批量 CLOSE。**GATE_PASS、QA_PASS、work record done、已交付、可发布必须是五个不同事实。**

## 三、逐条核验首轮部分发现

| 首轮发现 | 判定 | 可复现证据 | 必须保留的边界 |
|---|---|---|---|
| ingress 明确 `rejected` 后仍 ACK outbox，静默丢事件 | **证实**（源码路径；实际事故量未核验） | `single-event.ts:174-181` 对 ingress 校验失败返回 `{kind:"rejected"}` 而不是抛出；`outbox-relay.ts:130-139` 不检查 single/joined 的 rejected，只清重试状态并无条件 `ackOutboxEvent`，随后记 `OUTBOX_RELAYED`。 | relay 层会把它计为 relayed/acked、failed=0，原 pending 行被消费；底层是否另有拒绝审计不影响 ACK 错误。“完全无日志”未证实，但“outbox 误成功且不再重试”成立。 |
| envelope 仅 512 槽内存缓存，冷恢复会耗尽重试并死信 | **证实，需修正终态措辞** | `dispatch-runtime.ts:52-55,118,309-318` 是进程内 Map + 512 LRU 淘汰；`recovery.test.ts:121-149` 用 600 事件冲掉目标并验证 `envelope_missing` 消耗 defer；`recovery.ts:180-215` 显示超过 5 次 defer 后走 EXPIRED；`delivery-executor.ts:167-174,473-484` 显示已交付行缺 envelope 会直接 dead-letter `DELIVERY_TAKEOVER`。 | READY/DEFERRED 路径是 **firing EXPIRED + 清理时 stranded delivery DEAD_LETTERED**，并非所有对象统一“死信”；`FIRING_EXPIRED` 有审计，所以不是静默。真正缺陷是 envelope 不可持久重建、缓存淘汰即可破坏恢复。 |
| GATE_PASS 与可发布必须分开，防止 174 单被批量假收口 | **未核验（作为“已发生假收口”的断言）；作为风险成立** | 当前 174 仍在待验收；六重点单均 gate 后停在待验收。历史确有 25 单同秒批量 CLOSE 和 LOCAL-1 异常直关，但 25 单均有前置复验状态，缺少人工审批／gateRun 对照，不能证明“假”。 | “当前 174 已被批量关掉”由快照**证伪**；“历史上发生过批量假收口”仍**未核验**；“若只凭 GATE_PASS 批量发布会造成假收口”是已被状态与证据缺口支持的风险。 |

### 3.1 两个源码缺陷的最小复现路径

1. **ACK**：构造一条 pending org outbox；让 ingress 正常 resolve，但 single 或 joined 返回 `rejected>0`；当前 relay 仍 ACK。现有 `outbox-relay.test.ts` 的 fake 只覆盖 `matched` 与 throw，未覆盖“resolve + rejected”，所以全绿不能挡住此缺陷。
2. **冷恢复**：让 single firing 进入 READY/DEFERRED，再重启进程或用超过 512 个新 envelope 淘汰原项；恢复无法从 store 取回原始 payload，只能 defer→EXPIRED，或在 delivery 执行面 dead-letter。joined firing 使用持久化 slot projection，反而说明 single firing 缺少同类持久化面。

## 四、子公司／插件产品场景暴露的框架缺陷 Top 5

### 1. P0：消息／事件可靠性契约不成立

- **拒绝与 ACK 解耦错误**：正常返回被拒绝被当成成功消费，造成不可重试的事件丢失语义。
- **执行所需事实只在易失缓存**：512 LRU 不是单纯性能优化，而是正确性依赖；重启或流量突发能把可恢复任务变成 EXPIRED/DEAD_LETTERED。
- relay 的 attempts/backoff/deadIds 也主要是进程内 Map/Set；冷启动后的重试预算连续性未核验。
- 框架没有给插件产品提供统一、可验收的 durable inbox/outbox/envelope、死信重放和重启故障注入基线，子公司各自实现时容易重复踩坑。

### 2. P0：验收、人工交付与发布控制面混用

- 框架以 GATE_PASS 驱动状态，却没有独立发布事实和不可变制品身份；共享 checkout 的全仓测试还可能被另一张单的并发修改污染。
- 插件 issues 引擎有正面的 reviewer 独立性、T7 gate 校验和可选 human approval，不能误写成“完全无验收”。但门户 `TransitionInput` 只含目标状态、revision、reason、幂等键，**没有 evidenceIds/gateRunId**；批量路径也未透传这两个可选引用。引擎会自行校验当前 gate，所以这不是绕过证明，却使用户无法确认“我批准的是哪一个 gate／哪组证据”。
- 批量能力、174 积压和无独立发布态叠加，容易形成“为清数而收口”。

### 3. P0：模型配额被当成单工单失败，缺少全局调度

- 45 次可识别 429、多个已知 reset 窗口内重试、19 秒四连击，以及 20/21 次派发，说明当前重试粒度错误。
- 单工单 circuit breaker 不能阻止其他工单继续打同一限额池；自动开 bug 单还制造额外记录噪声。
- executor 全局切换、全员同 dsh，没有每公司／供应商／模型的预算、并发、reset-aware `nextEligibleAt` 和公平队列。对多公司框架而言，一家公司耗尽共享额度还可能波及其他公司，实际跨公司影响未核验。

### 4. P1：多公司“存储隔离”尚未升级为完整租户与生命周期隔离

- 正面事实：README 与 runtime 结构显示每公司四库物理分离；host 有 company allowlist、路径校验和 cross-company outbox guard。本评审**没有发现跨公司数据泄露证据**。
- 但框架侧是单公司 daemon、全局 primary executor、广域 `.AIWS`／DSH 写权限和共享插件 checkout；插件侧又是单进程多公司。两套边界没有统一的 tenant-aware 身份、配额、写域和发布授权。
- host company registry 默认 LRU=4；`runtime.ts:329-338` 淘汰时异步 `close()` 且不等待，未见 inflight 引用租约。高公司 churn 下是否发生活动调用被关闭、重开撞 `RUNTIME_ALREADY_OPEN`，标为**未核验**，但必须做并发测试。

### 5. P1：记录与门户不足以支撑可审计运营

- work records 六列中没有 dispatch/attempt id、ticket revision、gateRun、源码版本、错误类别或 reset 时间；**183 条 failed 的 model 全为空**，8 条 interrupted 和 1 条 running 也为空，连 2 条 done 都缺 model。
- `done=174`、待验收=174 的数字巧合很容易被误读；LOCAL-188 的 attempt 41／dispatch 40 又说明计数需要对账器。汇总事件无法回答“哪次派发、哪个模型、哪个 commit、哪个 gate 导致哪次交付”。
- 门户有明确的 real/mock 标识，不能指控其“静默冒充真实数据”。但生产宿主不可达时仍进入 mock 产品面，且 Remote 流转缺少 gate 引用；对验收门户更合适的是显式只读故障态，而不是与演示面共用运行形态。

## 五、改进建议

### 5.1 对 StudioNext 框架

1. **建立供应商级配额调度器**：标准化 401/429/5h/周月限额，解析并持久化 `provider/model/reset_at/nextEligibleAt`；同池任务一起暂停，reset 后只放一个 half-open 探针，加 jitter；配额等待记 `blocked_quota`，不算 GATE_FAIL、不烧业务 attempt、不自动开产品 bug。
2. **定义不可变验收与发布契约**：`dispatch_id → attempt_id → ticket_revision/source_digest → gateRun → human_acceptance → release_id` 全链关联；冻结每单验收命令、环境、依赖和产物 digest。状态机至少区分 `EXECUTION_DONE`、`GATE_PASS`、`ACCEPTED`、`RELEASED`，发布可撤回且不得改写历史 gate。
3. **提供可靠事件基线**：规定只有“已持久接受且满足 ACK 条件”才能消费 outbox；所有 rejected 必须可区分永久／暂时失败。提供 durable envelope、重放、死信查询与 restart/eviction 测试套件，插件不得把进程缓存当唯一正确性来源。
4. **统一租户边界**：公司维度隔离 executor 选择、模型额度、并发、写域和门户授权；runtime 增加 inflight lease／引用计数，淘汰先 quiesce 再 await close，重开与关闭串行化。
5. **重做记录规范与对账**：导出带 schema 版本和表头；失败也记录 model/provider，补 attempt、reset、gate、source revision、错误分类。提供 DISPATCH↔work record↔GATE↔CLOSE 对账任务和 backlog age SLO，禁止用 done 充当交付。
6. **给门户加发布安全栏**：批准页展示不可变 diff、证据、gateRun、验收人与发布目标；生产 mock 仅允许独立演示 profile，宿主故障时真实公司面只读并报警；批量操作必须逐项预检、二次确认和可审计结果。

### 5.2 对 workbench-dev 子公司自身

1. **立即冻结批量收口**：先盘点 174 单并按“可验收／需重跑／无有效证据／作废”分类；优先复核六张高尝试单及 LOCAL-188 计数异常。没有逐单 gate、版本与人工授权，不得 CLOSE 或宣称发布。
2. **先修 ACK 再扩功能**：只有未 rejected 且满足明确投递持久化条件才 ACK；resolved rejection 保持 pending 或进入明确永久失败，RelayReport 不得记成功。补 single/joined rejected、ACK 抛错、crash-between-ingress-and-ack 回归。
3. **持久化 single envelope 与 chain**：从 event store 重建输入，不以 512 缓存为唯一来源；覆盖重启、LRU 淘汰、defer 耗尽、delivery takeover 和人工 redrive，使用明确的 envelope-missing 错误码。
4. **把验收改成变更相关分层测试**：快速契约／受影响测试先行，全量测试受控并保留完整输出；核对外层 300 秒与 LOCAL-207 所述内部 600 秒是否协调。增加真正语义类型检查、client/typert 构建一致性和打包 smoke test，固定 Node/DSH 兼容矩阵。
5. **消除共享工作区串单**：至少按 ticket/attempt 使用独立 worktree 或不可变 revision；不能让 A 单 GATE_PASS 实际跑到 B 单刚修改的代码上。发布候选应是带 digest 的包，而不是当前 checkout。
6. **修复门户与批量流转的意图绑定**：Remote 和 batch 输入透传并在服务端核对 evidenceIds/gateRunId；批准前展示 gate 输出与版本。保留现有清晰 mock 标识，但生产不可达时禁用写操作并显示真实故障。
7. **承担配额与记录配置责任**：不要把全员长期绑在同一 DSH/GLM 池作为唯一策略；配置公司级并发、冷却和备用池。导出失败记录时补 model、attempt、reset 和 gate，建立每日积压账龄与重试成本复盘。

## 六、后续拆分单建议（9 张）

| 建议单 | 归属 | 优先级 | 范围与验收要点 | 依赖 |
|---|---|---|---|---|
| WB-EVT-ACK | 子公司 | **P0** | 修正 resolved rejected 的 ACK 语义；single/joined、永久／暂时拒绝、crash/ACK 失败测试齐全，RelayReport 不谎报成功。 | 无，可立即开始 |
| WB-EVT-DURABLE | 子公司 | **P0** | 持久化 single envelope/chain；512 淘汰与进程重启后仍可恢复；明确 EXPIRED、DEAD_LETTERED 和 redrive。 | 与 WB-EVT-ACK 共用事件链，建议在其后合入 |
| FW-QUOTA | 框架 | **P0** | provider/model 级熔断、reset-aware 暂停、单探针恢复、quota 状态与公平队列；用本批 45 条 429 做重放验收。 | 无 |
| FW-GATE-RELEASE | 框架 | **P0** | 新增不可变 gate/evidence/release 契约与独立状态；GATE_PASS 不能直接产生发布事实。 | 无 |
| FW-OBSERVE | 框架 | P1 | 统一带表头记录 schema、attempt/dispatch/gate/source/model/reset 字段和四类事件对账；解释 LOCAL-188 的 41/40 异常。 | FW-GATE-RELEASE 提供 gate/release 外键 |
| FW-TENANT-LIFECYCLE | 框架＋子公司 | P1 | 每公司配额/写域/授权；LRU quiesce、await close、inflight lease、并发重开测试。 | 配额部分依赖 FW-QUOTA，runtime 修复可并行 |
| WB-ISSUE-PORTAL | 子公司 | **P0** | 单条与批量流转绑定 gateRun/evidenceIds；批准页展示版本与证据；生产故障只读，批量 CLOSE 默认禁用。 | FW-GATE-RELEASE |
| WB-TEST-PACKAGE | 子公司 | P1 | 分层测试、超时分层、独立 worktree/不可变 revision、语义类型检查、构建及带 digest 的插件包 smoke test。 | FW-GATE-RELEASE；测试提速可先做 |
| WB-BACKLOG-CLEAN | 子公司 | **P0** | 174 单逐单账龄、证据与版本盘点，输出可验收/需重跑/作废清单；只对合格单独立验收，形成首个可追溯 release candidate。 | 盘点无依赖；任何批量收口依赖 FW-GATE-RELEASE＋WB-ISSUE-PORTAL；涉事件链单还需两项 WB-EVT |

## 七、最终判断

workbench-dev 已证明框架能快速产出大量代码与测试，也暴露了“产出速度掩盖系统正确性与交付闭环”的风险。短期不是继续加功能或把 174 单批量关掉，而是按顺序完成：**停止无效重试 → 修 ACK 与 durable envelope → 固定验收版本和证据 → 人工清理积压 → 独立发布授权**。在这些 P0 项关闭前，GATE_PASS 数量、work record done 和历史 26 张已交付都不能作为“插件产品可发布”的依据。
