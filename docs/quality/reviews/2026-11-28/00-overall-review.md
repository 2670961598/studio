# StudioNext 综合独立总审（最终总报告）

> 评审角色：StudioNext 独立总审（Kimi k3.1-pro）  
> 汇总日期：2026-11-28  
> 证据输入：仅 `BRIEF.md`、`output/01-framework-review.md`、`output/02-studio-operations-review.md`、`output/03-workbench-review.md`、`output/00-partial-findings-kimi.md`。  
> 总结论：**主公司具备持续交付能力，但系统尚不具备“可证明正确、可审计发布、可安全扩容”的健康状态；workbench-dev 插件产品化发布 No-Go，V2 enforce、多公司扩大写入和新增执行器扩量也应暂缓。**

## 0. 证据口径与优先级

- **已证实**：相应批次已在快照源码、配置或导出记录中核实；不等于本总审直接阅读源码或动态复现，也不等于已核实生产事故数量。
- **历史事实**：日志、CSV、issue JSONL 或事故记录证明当时发生；不得外推为当前仍存在。
- **未核验**：包括文档自报实现、当前真实代码行为、线上状态、外部账户、权限、告警送达及跨公司影响。标为未核验的 P0 是必须在切权/扩容前关闭的设计风险，不冒充已复现事故。
- “当前”仅指各批快照观察点。`done`、`GATE_PASS`、`QA_PASS`、`CLOSE/已交付`、`ACCEPTED`、`RELEASED` 不是同义词。
- 本报告采用三批中最严格合理分级：**P0**＝核心事实、事件、权责、状态或恢复安全受阻，切权/发布/扩容前必须关闭；**P1**＝显著可靠性、成本、隔离或治理风险；**P2**＝局部可观测性、供应链和运维质量缺口。

---

## 1. 执行摘要

### 1.1 健康度：**4 / 10**

这是风险判断，不是三批评分的算术平均。

**加分项**：

1. studio-dev 主交付链持续运转：近两周 543 次执行、434 次 `done`；剔除 11 月 26 日风暴后，尝试级 `done` 率为 93.04%（`output/02-studio-operations-review.md:40-78`）。
2. 严格验收闸门确实阻止缺证据交付，框架已有 fail-closed、幂等、租约 epoch、负向用例和审计链设计；workbench-dev 也有四库物理隔离、权限与测试基础。
3. 两次配额事故后均有恢复记录，说明系统不是完全失去交付能力。

**扣分项**：

1. workbench-dev 有两个源码路径层面已证实的事件正确性 P0：拒绝后误 ACK、执行事实依赖 512 槽易失缓存。
2. 两家公司均出现配额—重派风暴，studio-dev 单日 70 次 failed，workbench-dev 近两周 failed 183/366；重试不是局部偶发，而是共同调度契约缺口，是否存在跨公司传播仍未核验。
3. workbench-dev 快照有 174 单待验收、26 单已交付，约 13 天无新 CLOSE；技术产出无法转化为可证明的人工验收与发布。
4. V2 权责记录、跨进程 fencing、不可变验收/发布链尚未闭环；成本/用量导出为空，告警认领、灾备和联合回滚证据不足。

因此，**4 分代表“能跑、能部分恢复，但正确性与治理证据不足以支撑扩大生产”**。不建议用交付数量抵消事件丢失和权责缺账。

### 1.2 最关键的五条结论

1. **先修事件正确性，再谈功能与吞吐。** resolved `rejected` 仍 ACK 会让 pending 事件被消费且不再重试；512 LRU 又会把冷恢复变成 EXPIRED/DEAD_LETTERED。这是 workbench 当前最直接的 P0（P0-01、P0-02）。
2. **11 月 26 日不是单纯上游额度事故，而是重试治理事故。** studio-dev 四张定时岗单贡献 69/89 次 failed；workbench-dev 的 LOCAL-203/204/207 与 LOCAL-217/218 在已知 reset 窗口内继续重试。必须把错误分类、共享池暂停、跨单预算和半开恢复合成一个调度契约（P0-03）。
3. **技术完成不等于交付，更不等于发布。** 已有 REPORT 与 exit=0 仍可能因缺终态而整单重跑；另一方面，GATE_PASS 未绑定不可变 revision、证据和人工授权，也不能直接 CLOSE/RELEASE。应同时治理“有效成果被重烧”和“无效成果被批量收口”两种相反风险（P0-04、P0-05）。
4. **框架处于 V1/V2 迁移态，不能把规范 final 当作生产准入。** 旧四要件与 V2 权责记录脱钩，唯一写入者缺少跨 SQLite、平台网关、公司 git 的已验证 fencing；这两项未关闭前，V2 enforce、双写者或多公司扩写均不安全（P0-06、P0-07）。
5. **运营经济性、恢复能力和责任链无法完整回答。** studio-dev 的 `usage_daily.csv`、`cost_daily.csv` 均为空，无法量化风暴成本；告警缺 owner/ACK/SLA，备份曾通过不等于可恢复。先建立稳定投影、恢复演练和事故所有权，再扩商业化（P0-08、P0-09、P1-04）。

---

## 2. 合并缺陷清单（P0–P2）

### 2.1 P0

#### P0-01　ingress 明确拒绝后仍 ACK outbox，形成不可重试的事件丢失语义

- **状态**：**已证实**（workbench 批次已核实静态源码路径并给出最小复现条件；未动态复现）；实际生产丢失数量、是否另有外部补偿均**未核验**。
- **证据**：`single-event.ts:174-181` 正常返回 `{kind:"rejected"}`；`outbox-relay.ts:130-139` 未检查 single/joined 的 rejected，清重试并无条件 `ackOutboxEvent`，随后记 `OUTBOX_RELAYED`。现有 fake 未覆盖“resolve + rejected”。见 `output/03-workbench-review.md:121-130,176-180`；首轮原始假设见 `output/00-partial-findings-kimi.md:4`。
- **影响**：relay 可能显示 relayed/acked、failed=0，但原 pending 行已消费；调用方拒绝却不再重试，破坏事件链事实与后续恢复。
- **修复方向**：区分暂时/永久拒绝；只有明确持久接受且满足 ACK 条件才消费 outbox。补 single/joined rejected、ACK 抛错、ingress 后 ACK 前崩溃、重放和 RelayReport 真实性测试。不得用“补一条日志”代替语义修复。

#### P0-02　single envelope 仅以 512 槽内存 LRU 保存，重启/淘汰可破坏恢复

- **状态**：**已证实**（源码与恢复测试路径）；真实事故量**未核验**。原首轮“全部静默死信”措辞需修正：`FIRING_EXPIRED` 有审计，READY/DEFERRED 与 delivery takeover 的终态并不完全相同。
- **证据**：`dispatch-runtime.ts:52-55,118,309-318` 为进程内 Map + 512 LRU；`recovery.test.ts:121-149` 用 600 事件淘汰目标；`recovery.ts:180-215` 超 5 次 defer 后 EXPIRED；`delivery-executor.ts:167-174,473-484` 缺 envelope 可 DEAD_LETTERED。见 `output/03-workbench-review.md:124,127-130,134-139`。
- **影响**：冷启动或流量突发会把本可恢复的任务变成过期、 stranded delivery 或死信；重试预算的进程内连续性也未证实。
- **修复方向**：持久化 single envelope/chain，或能从权威 event store 确定性重建；覆盖重启、600+ 淘汰、defer 耗尽、takeover、人工 redrive，明确 envelope-missing 错误码和各终态。

#### P0-03　共享配额池未一等建模，已知限额仍按单盲目重试并在两家公司分别形成风暴

- **状态**：事故为**历史事实**；共享池设计缺口有文档支持，但当前线上是否已补、实际账号池映射及跨公司波及均**未核验**。
- **证据**：
  - studio-dev：73 条 429，65 条在 11 月 26 日；`LOCAL-434/437/438/442` 合计 82 次执行、69 次 failed；`LOCAL-359` 周限额下 5 连败后 Archived。见 `output/02-studio-operations-review.md:90-102,138-146`。
  - workbench-dev：45 条可识别 429；`LOCAL-203/204` 分别派发 20/21 次，`LOCAL-217/218` 在已知 16:00:31 reset 前各失败 5 次，恢复后才 done；`LOCAL-80` 19 秒四连击。见 `output/03-workbench-review.md:84-108`。
  - 框架专题只按申报 quota/tier 管理，历史 GLM 三模型共享同一池；见 `output/01-framework-review.md:121-131`。
- **影响**：浪费泳道、宿主与模型额度；把供给等待伪记为 GATE_FAIL，自动制造重复 bug 单；同源冗余可能造成“相关性全灭”。实际金钱损失因成本账缺失无法计算。
- **修复方向**：标准化 401、429 各窗口、502/529、缺凭据/adapter 等错误；建立 provider/account/pool、reset-at/nextEligibleAt、共享熔断、跨单重试预算、公平队列和单探针 half-open。配额等待记 `blocked_quota`，不烧业务 attempt、不自动开产品 bug。

#### P0-04　执行故障、质量失败与终态修复混用，收口非完全幂等且已有证据不能安全复用

- **状态**：所列单证与重复迁移为**历史事实**；当前代码路径及是否已修**未核验**。
- **证据**：studio-dev 113 条 GATE_FAIL 中 86 条明确 REPORT 未落盘/为空；`LOCAL-442` 已有 REPORT size=9716、验收 exit=0，却因 401 缺终态 completed 回退新单，`LOCAL-434` 同型；`LOCAL-437/442` 各自同一秒重复写“新单”；另有 19 次 boot-orphan、5 次 WORKER_DEAD。见 `output/02-studio-operations-review.md:138-145`。workbench 的 `LOCAL-203/204/207/215` 也把 timeout/供给错误混入重试链（`output/03-workbench-review.md:84-95,110-117`）。
- **影响**：基础设施故障被误记为质量失败；有效 REPORT 被重跑模型，重复 recovery 路径可能重复回退、放大 attempt 和状态噪声。
- **修复方向**：建立统一 error kind 与 retryability；dispatch/attempt 使用唯一幂等键，STALL、WORKER_DEAD、boot recovery 共用同一收口键。已有证据只走“原位复验＋补终态”，不得绕过四要件，也不得默认整单重跑；Archived 应是可识别终态/停驻态。

#### P0-05　验收、人工交付与发布缺少同一条不可变证据链，174 单积压不能以批量 CLOSE 解决

- **状态**：174 单待验收、共享可变 checkout、配置和门户输入形态为**已证实的快照事实**；历史 25 单同秒 CLOSE 与 LOCAL-1 直关为**历史事实**；“历史批量假收口”及实际人工授权情况**未核验**。
- **证据**：workbench 快照 174 待验收、26 已交付，最后 CLOSE 停在 11 月 14 日；GATE_PASS/QA_PASS 各 199。验收在共享 `workbench-plugin` checkout 运行，未见证 ticket revision、commit、锁文件、产物 digest 与 gateRun 绑定；`TransitionInput` 未携带 evidenceIds/gateRunId，批量路径也未透传，但引擎会检查当前 gate，故这不是绕过证明。历史 LOCAL-2～26 同秒 CLOSE，LOCAL-1 曾直接从新单转为已交付。见 `output/03-workbench-review.md:38-63,110-125,141-145`。
- **影响**：无法证明“批准的是哪个版本、哪次 gate、哪组证据”；共享工作区可能串单。为降低积压数字批量关闭会制造不可追溯发布，而无限停在待验收又使产出无业务价值。
- **修复方向**：建立 `dispatch_id → attempt_id → revision/source_digest → gateRun → human_acceptance → release_id`；分离 EXECUTION_DONE/GATE_PASS/ACCEPTED/RELEASED；独立 worktree 或不可变 revision；门户单条/批量均绑定 gate 与证据。立即禁止仅凭 GATE_PASS 批量收口，174 单逐单分为可验收、需重跑、无有效证据、作废。

#### P0-06　V2 权责记录可不完整甚至零写，旧四要件仍可能允许完成/收口

- **状态**：规范冲突和文档自报实现为**已证实的文档事实**；真实生产 CLOSE 是否缺权源、当前生产者是否已补齐均**未核验**。
- **证据**：`framework/docs/17-整体技术设计.md:98,275-278` 明示记录失败不打断拍、记录不是四要件判据及前件未落零写；`framework/docs/v2/11-技术细节-运行记录与行为契约.md:884-887` 要求生效任命、证据包、独立性和结清引用；事件权威不等于 records 已证。见 `output/01-framework-review.md:69-80`。回退/重开/返工桥也存在空路径，见同报告 `:95-100`。
- **影响**：可能有技术 GATE_PASS/CLOSE，却没有足够任命、授权、独立收割、验收或结清材料；直接 enforce 又可能因生产者未就位全面停摆。事后无法回填当时不存在的授权与独立判断。
- **修复方向**：定义逐公司 legacy/shadow/enforce；补 CAP-02、AUTH-02、接受回执、LIFE-01/04、EVD-01 等生产者；覆盖打回、返工、重开、resume、人工介入；以同事务 outbox/句柄连接平台、事件、记录。历史欠账标“未知/待补证”，不得伪造补录。

#### P0-07　唯一写入者缺少已验证的跨进程 fencing，单写仍是拓扑假设

- **状态**：**未核验的 P0 设计风险**；文档明确部分围栏仍为目标，进程内租约为已读实现说明。历史重复“新单”是事实，但不能据此断言均由双写者造成。
- **证据**：`framework/AGENTS.md:69` 要求机制保证；`framework/docs/v2/05-技术抽象-总规范与框架总装.md:132-134` 将互认围栏列为目标；lane/merge 租约主要为进程内存；PRB-14 当前是否补跑未核验。见 `output/01-framework-review.md:82-93`。重复状态样例见 `output/02-studio-operations-review.md:144`。
- **影响**：守护重叠、灰度并行、崩溃接管或网络分区时，旧写者可能继续向 SQLite、平台或公司 git 写；单进程 epoch 无法阻止另一进程副作用。
- **修复方向**：单调 fencing token 贯穿 SQLite 事务、平台网关和公司 git；默认拒绝第二写者。接管顺序为旧写者停写/隔离、新代次激活、在途对账、新写；实测双进程、stale writer、TTL、崩溃及外部回执未知。

#### P0-08　成本/用量导出为空，重试风暴与交付经济性无法对账

- **状态**：studio-dev 两个导出文件为 0 字节是**已证实的快照事实**；底层是否完全没有遥测、仅导出失败，以及 workbench 成本情况均**未核验**。
- **证据**：`studio-dev/exports/usage_daily.csv`、`cost_daily.csv` 均空；`REPORT_COST_CLOSE=39` 只是事件数；4 条 cost-close DAILY_ALARM 有 cache-unpriced。见 `output/02-studio-operations-review.md:104-109`。框架的 `cost_daily` 只备份不重放、对账规则待裁及订阅记零边际成本问题见 `output/01-framework-review.md:121-131`。
- **影响**：不能计算每成功/交付单成本、模型单价、配额消耗或 11 月 26 日浪费金额；unknown 容易被误当零，无法做成本驱动调度。
- **修复方向**：先判明采集还是导出断链；建立版本化表头与 provider/account/pool/model/ticket/attempt 维度，分列边际成本、订阅摊销、额度消耗和置信度；unpriced/unknown 显式告警，历史只能标不可对账，不能编数补平。

#### P0-09　台账与关键环境灾备尚未形成可证明的恢复闭环

- **状态**：11 月 15 日 SQLite 损坏及恢复为**历史事实**；Taiga 副本、投影重建和当前备份状态来自事故材料转述，现况**未核验**。
- **证据**：运营批记录事故库经 `.recover` 恢复 709,214 events 且链校验通过；同时转述 P0 文档中的 Taiga 备份未见副本、投影重建无现成路径、Docker overlay I/O 等尚待决策的事项。见 `output/02-studio-operations-review.md:145,157,167-169`。框架批也指出代码回滚不等于 DB/schema/事件/配置/在途联合回滚（`output/01-framework-review.md:176-180`）。
- **影响**：备份任务 PASS 或进程拉活不能证明可恢复；平台、台账、Docker 卷或在途证据可能在灾难后无法按同一恢复点重建。
- **修复方向**：明确 ledger、Taiga、Docker 卷的备份范围、RPO/RTO、保留期与 owner；在隔离环境完成真实恢复和回滚后复验，保存 backup digest、链校验、平台对账及在途处置证据。

### 2.2 P1

| ID | 状态与缺陷 | 证据与影响 | 修复方向 |
|---|---|---|---|
| **P1-01** | **已证实的文档事实**：主表 final/draft、records 权威、已落/未落互相矛盾；真实部署状态**未核验**。 | `output/01-framework-review.md:102-119`。实现单和发布者无法判断当前效力，规范 final 可能冒用为 deployment-eligible。 | 机读 spec/implementation/deployment 三表；历史段加失效区间；发布绑定 commit、Node/CLI、契约、schema、配置及 V0–V6，open/partial 必须有批准例外和期限。 |
| **P1-02** | **历史事实＋未核验**：401、缺 KIMI_API_KEY、无 adapter、代理/env 与 token 刷新问题反复出现；agy 真机资格未证。 | `output/02-studio-operations-review.md:146`；`output/01-framework-review.md:133-138`。配置登记不等于版本、账号、宿主、代理和凭据可用。 | 派工 preflight；带版本/账号类别/宿主/时间的 binding certification；Kimi 单写刷新与可续期授权；agy 在超时、权限、沙箱、续跑负测前保持实验禁用。 |
| **P1-03** | **历史事实**：21 次 timeout、60 秒历史误杀与资源争用；当前 300 秒是否根治及 cron 实际启用**未核验**。 | `output/03-workbench-review.md:110-114`；`output/01-framework-review.md:140-152`；`output/02-studio-operations-review.md:155,185`。仅调大超时或加 worker 会放大 CPU/IO/验收积压。 | 逐命令、整验收、整 attempt 三层 deadline；区分断言红/基础设施/资源/环境；同因未变更不得自动重跑；宿主资源、重验证、评审容量统一背压；定时岗去重、jitter 和降级。 |
| **P1-04** | **未核验当前态**：healthz 偏 liveness，告警缺持久 owner、ACK、SLA 和关闭证据；历史噪音与停报疑点存在。 | `output/01-framework-review.md:154-164`；`output/02-studio-operations-review.md:156`。进程在线可掩盖无模型、记录拒写、队列积压；归档症状不等于根事故恢复。 | readiness 覆盖供给/调度/记录/验收；fingerprint 聚合一根事故多症状；owner/ack/deadline/escalation/close-evidence 全链；交接未确认不算处理。 |
| **P1-05** | **已证实部分隔离设计，完整隔离未核验**：四库分离和 cross-company guard 是正面事实，但 executor、quota、共享写域、portal 与 runtime 生命周期未统一。 | `output/03-workbench-review.md:153-163`；`output/01-framework-review.md:211`。host LRU 异步 close 未等待、inflight lease 未见；活动调用被关或重开冲突是风险，不是已发生泄露证明。 | 所有 key/query/route/job/session/artifact 带 tenant；默认跨司拒绝；runtime 先 quiesce、等待 inflight、await close，再串行重开；两公司同名单号/工号/模型源负测。 |
| **P1-06** | **已证实快照投影缺口**：CSV 无表头、时区/语义不同；Archived 被 UNKNOWN_STATE，LOCAL-188 attempt 41/派发40，失败记录 model 大量为空。 | `output/02-studio-operations-review.md:145,152-158`；`output/03-workbench-review.md:159-163`。无法稳定回答哪次派发、模型、commit、gate 导致哪次交付。 | 版本化 schema、表头与时区；补 dispatch/attempt/provider/model/reset/revision/gate/release；做 DISPATCH↔work record↔GATE↔CLOSE 对账，解释异常而非强行抹平。 |
| **P1-07** | **历史事实**：workbench 手工拉起、profit 重启复活再手停、tunnel3 反复 exit 2；当前服务状态与操作者权限**未核验**。 | `output/02-studio-operations-review.md:146,157-159`。个人经验可止血，但缺前置条件、审批、命令审计和复发防护。 | 受监督自启与停驻持久化；标准 runbook 记录操作者/审批/前置检查/结果；重启后验端口、在途单、路由与状态，不继续叠看护分支。 |
| **P1-08** | **文档/历史事实，当前兼容未核验**：Node 工具链与生产版本有差异，代码回退缺统一兼容凭证。 | `output/01-framework-review.md:176-185,199`。旧 binary 可能无法安全打开新库，回滚也可能丢在途会话。 | expand→migrate→contract；发布物携带 schema/contract 支持区间、backup digest、在途处置和回滚验证；当前生产 Node/CLI 也进 CI/canary。 |

### 2.3 P2

| ID | 状态与缺陷 | 证据、影响与修复方向 |
|---|---|---|
| **P2-01** | **文档自报、当前未核验**：路由 healthz 有字段，但专用面板与操作视图未接。 | `output/01-framework-review.md:166-169`。补只读时间线、换源原因、实际 wire model、价格/配额来源、最近成功时间；配置模型与实测模型不得混写。 |
| **P2-02** | **历史事实**：出现“457ms 超阈值 3600000ms”等矛盾文案。 | `output/01-framework-review.md:171-174`。将触发原因结构化，仅输出适用字段，并为 note 做格式契约测试，避免错误调参。 |
| **P2-03** | **风险未核验**：依赖与 CLI 供应链准入偏薄，不是已有漏洞证明。 | `output/01-framework-review.md:182-185`。增加 allowlist、锁文件审查、SBOM/来源摘要、支持窗口和升级前差分探针。 |

---

## 3. 流程与治理缺口

| 领域 | 已有有效控制 | 主要缺口及性质 | 必须形成的闭环 |
|---|---|---|---|
| **验收** | 四要件、QA、T1–T5、缺验收标准拒派；严格闸门应保留 | **流程＋代码**：供给错误混入 GATE_FAIL；gate 未绑不可变版本；174 单无逐单账龄/授权证明 | 每单可出示 revision、gateRun、独立验收人、人工接受和发布对象；先分层盘点，禁止清数式批量 CLOSE |
| **审计** | append-only、哈希链、issue 状态流、sentinel 留痕 | **流程为主，数据模型需配合**：waive、归档、人工恢复、批量 CLOSE 的操作者/审批/范围/时效未形成可核验关联 | 所有人工动作有 actor、approver、reason、evidence、时间和事后回归；历史无法证明的标未知，不追认 |
| **记录** | 事件链、幂等、对账意识 | **代码＋数据治理**：V2 前件可零写、回退边拒写；CSV 无表头、成本为空、终态语义分裂 | 同事务 outbox/投影；版本化稳定导出；差异生成有 owner 的异常；CLOSE 出记录完备性证明 |
| **权限** | wkey、root/scoped 分离、公司 allowlist、部分 reviewer 独立性 | **流程＋架构**：实际最小权限、整树撤回、agy 沙箱、跨司门户授权、手工启停审批未核验 | 权限绑定执行器认证和公司范围；撤回给后代停用证据；高危批量操作逐项预检、二次确认和审计 |
| **配额** | 断路、冷却、部分预算预检、错误正文可含 reset | **流程＋核心调度**：共享 pool、跨单预算、公司公平性、cron 降级及 reset-aware 暂停缺失 | 供给池级暂停/恢复；低优先级岗让路；配额等待不计质量失败；额度与订阅成本可解释 |
| **告警** | ESCALATE、DAILY_ALARM、自动开 bug | **主要是流程问题**：无稳定 owner/ACK/SLA/关闭证据；同因重复开单，交接可不确认 | 一指纹一根事故，多症状关联；确认接手才转移责任；超时升级，恢复必须有验证证据 |
| **回滚/灾备** | 配置备份、supervisor、事故库修复和链校验 | **流程＋架构**：RPO/RTO、Taiga/Docker 范围、在途处置、联合兼容和隔离恢复演练不足 | backup digest＋隔离恢复＋数据/平台/在途/路由四组复验；不能只看进程重新在线 |
| **升级** | 分层门禁、适配器探针、契约冻结意识 | **流程问题突出**：规范 final、测试通过与部署准入混用；生产 Node/CLI 未形成当前组合矩阵 | 准入绑定当前 commit 与真实运行时；例外有批准人/期限；旧新兼容、回滚和真实 canary 同单验收 |
| **多公司** | workbench 四库物理隔离、公司 allowlist、cross-company guard | **架构＋治理**：单公司 daemon 与多公司插件进程边界并存，全局 executor/共享写域/配额/门户授权未统一 | 每司身份、写域、路由、配额、发布授权独立；跨司只读聚合先行；负测通过后再讨论扩写 |

**应明确归为流程而非继续加代码的事项**：立即冻结无证据批量收口；为告警指定 owner/ACK/SLA；为规范例外和人工恢复指定批准人；盘点 174 单；定义备份 RPO/RTO；清理规范效力冲突。代码可以承载这些规则，但不能替组织作出授权或补造历史证据。

---

## 4. 架构风险

| 风险面 | 综合判断 | 必须验证的不变量 |
|---|---|---|
| **一致性** | 平台当前态、DOM-03 事件、DOM-05 records、work record、gate、CLOSE、release 处于多套语义；ACK 与持久接受还可能相反 | 同一语义迁移有唯一 ID、预期版本和幂等结果；外部回执未知不得假成功/盲重放；enforce 下缺必备记录不得收口 |
| **并发** | 进程内 epoch/LRU 不足以防双写者；共享 checkout 可串单；多路径 recovery 可重复迁移 | 所有外部写校验单调代次；重复事件不新增 attempt/回退；A/B 单并发验收不会读取对方 revision；runtime 关闭与重开串行 |
| **单点** | daemon、宿主、协作平台、单一 Lead 均可能瓶颈；supervisor 只解决拉活，定时扩容会转移瓶颈 | 安全接管有 fencing；平台故障有只读 SLO；宿主资源隔离；独立验收可委派且有容量上限 |
| **隔离** | 四库隔离是良好基础，但不是完整 tenant 边界；没有发现跨公司泄露证据 | key/query/route/session/artifact/write-domain 全带 tenant；同名单号、同工号、共享模型池、公司 churn 负测默认拒绝或安全降级 |
| **兼容** | V2 只增可选字段是好基础；Node、CLI、schema、契约、配置、在途工作缺统一发布矩阵 | 发布声明可读/可写最低版本；旧 binary 安全打开或明确拒绝；expand/contract 可回滚且不丢在途 |
| **成本归因** | 共享 pool、订阅制、actual wire model、空导出共同破坏单位经济；unknown 不得写零 | 成本可解释到 provider/account/pool/model/价格版本/ticket/attempt；边际、订阅摊销、额度消耗、置信度分列 |
| **可观测** | healthz/事件基础较强，但 readiness、稳定投影、告警所有权、backlog aging、失败 model 归因不足 | 任何“健康”可分解为供给、调度、记录、验收四子态；每异常有 owner/ACK/SLA；每交付可追溯到 dispatch 与 release |
| **事件可靠性** | 插件各自实现 inbox/outbox/envelope 容易重复踩坑；进程缓存不能承担唯一正确性来源 | rejected 永不误 ACK；重启/淘汰后可重建；死信可查询/重放；crash-between-persist-and-ack 不丢不重或能确定性对账 |

**架构路线判断**：近期不需要微服务化或多主写入。优先把单写 fencing、durable command/outbox/envelope、不可变证据链和稳定投影做成可替换内核；这些能力比增加 daemon 数量更能降低风险。

---

## 5. 可拓展方向（排序）

> 以下是 P0 止损后的演进顺序，不是立即扩功能许可。

| 排名 | 方向 | 理由 | 最小验证方式 |
|---:|---|---|---|
| **1** | **可靠执行与事件内核/SDK** | ACK、durable envelope、幂等收口、fencing 同时影响主公司与子公司；沉淀统一契约可避免每家公司重复实现并重复出错 | 用同一 conformance kit 跑 rejected、ACK 前崩溃、600+ envelope、重复 recovery、stale writer；证明不丢、不误成功、可重放、旧代次被拒 |
| **2** | **供给/成本/算力/验收容量统一配额代理** | 配额风暴是共同最大运营故障；单纯加泳道会把压力转移到测试和评审；统一资源接口可支撑公平调度与单位经济 | 重放两公司 11 月 26/27 日事故样本：reset 前零无效重试、恢复仅一探针；同时产出每交付成本及 unknown/unpriced 明细 |
| **3** | **证据驱动 readiness 与不可变发布控制面** | 把 spec、实现、探针、部署、gate、人工接受、release 连成证据图，可同时解决 final 冒用和 GATE_PASS 冒用 | 选一张 canary 单，从 dispatch 到带 digest 的 release 全链可追溯；错误 gate、错误 revision、无授权均被拒，撤回不改历史 |
| **4** | **签名化 Executor/Provider 插件 SDK 与认证机制** | 四原语、能力声明、binding certification 可降低新 CLI 接入成本，并将 agy 等实验能力隔离在生产之外 | 新接一个实验适配器，不改主循环；同版本真机探针、代理、权限、超时、续跑通过才发短期证书，过期/未证自动禁生产 |
| **5** | **多公司只读控制塔与可移植公司/插件包** | 有跨司运营与商业化价值，但必须以隔离、成本和发布证据为前提；只读比多主写入风险低 | 两公司使用同名单号/工号/模型源做隔离负测；跨司只读聚合、签名策略包和可复现插件包可用，宿主故障只读且禁写 |

---

## 6. 后续拆分单建议（共 18 张）

> 以下是建议单，不表示已经创建。三批原有 11＋10＋9 张建议已合并去重。依赖表示“完整验收依赖”，可在注释允许时先做无风险盘点或规范部分。

### A. 缺陷修复（6 张）

| ID／标题 | 优先级 | 范围 | 验收要点 | 依赖 | 建议执行者 |
|---|---|---|---|---|---|
| **FIX-01 outbox 拒绝与 ACK 语义修复** | **P0** | workbench single/joined relay；暂时/永久拒绝；RelayReport | resolved rejected 不 ACK、不记成功；持久接受后才消费；覆盖 ACK 失败、ingress 后崩溃、重放，无 pending 静默消失 | 无 | workbench 事件链负责人＋独立事件契约评审者 |
| **FIX-02 durable single envelope 与恢复** | **P0** | envelope/chain 持久重建、EXPIRED/DEAD_LETTERED/redrive | 重启、600+ LRU 淘汰、defer 耗尽、takeover 后仍可确定性恢复或明确可审计死信；人工 redrive 有测试 | FIX-01，共用事件链后合入 | workbench runtime 负责人＋故障注入测试者 |
| **FIX-03 错误分类与供给级配额调度** | **P0** | 401/429 各窗口/502/529/缺凭据/adapter/timeout；provider/account/pool；reset、跨单预算、half-open | 重放 LOCAL-359、434/437/438/442、80、203/204/207、217/218；reset 前不盲试，恢复仅一探针；quota 等待不算 GATE_FAIL、不刷 bug | 无 | 框架调度负责人＋两公司运营代表＋模型供给负责人 |
| **FIX-04 幂等收口与已有证据原位复验** | **P0** | dispatch/attempt 幂等键；STALL/WORKER_DEAD/orphan；补终态；Archived 语义 | 重放 LOCAL-437/442 不重复回退；REPORT＋exit=0 场景复验后补终态且不重跑模型；Archived 不再 UNKNOWN_STATE；四要件不弱化 | FIX-03 的错误分类；规范可与实现并行 | 框架状态机负责人＋studio 运营＋workbench QA |
| **FIX-05 V2 权责记录生产者与状态边闭环** | **P0** | legacy/shadow/enforce；CAP/AUTH/LIFE/EVD；打回/返工/重开/resume；outbox | shadow 期每 CLOSE 有完备性报告；enforce 缺记录必拒；所有合法平台边可回放；历史欠账只标未知，不回填授权 | GOV-01；事务与外部写衔接还须 ARCH-01 | 框架 records/DOM 负责人＋审计代表 |
| **FIX-06 执行器 preflight、凭据生命周期与真机认证** | **P1** | Kimi 刷新/续期；agy 超时、代理、权限、沙箱、续跑；binding certificate | 缺 env/adapter/凭据在派工前隔离；并发刷新单写；证书绑版本/账号/宿主/时限；agy 未证不能生产启用 | GOV-01、FIX-03 | 执行器维护者＋安全负责人＋真机测试者 |

### B. 流程治理（4 张）

| ID／标题 | 优先级 | 范围 | 验收要点 | 依赖 | 建议执行者 |
|---|---|---|---|---|---|
| **GOV-01 规范效力、迁移模式与部署准入统一** | **P0** | spec/implementation/deployment 三表；final/draft；legacy/shadow/enforce；V0–V6 例外 | CI 检出 records 权威和已落/未落矛盾；发布清单绑 commit/Node/CLI/schema/契约/配置；open/partial 无批准期限即阻断 | 无 | 框架规范 owner＋发布经理＋V2 审计者 |
| **GOV-02 冻结批量收口并盘点 174 单** | **P0** | 待验收账龄、证据、revision、人工授权；六高尝试单、LOCAL-188；历史 25 单与 LOCAL-1 单列复核 | 174 单逐项分为可验收/需重跑/无有效证据/作废；无 gate/version/授权不 CLOSE；产出首个可追溯 release candidate，历史疑点不强判“假” | 盘点无依赖；实际收口依赖 FIX-04＋ARCH-02；事件链单还依赖 FIX-01/02 | workbench 产品负责人＋独立验收池＋QA |
| **GOV-03 告警所有权、readiness 与验收背压** | **P1** | fingerprint 事故聚合、owner/ACK/SLA、交接；供给/记录/队列 readiness；评审容量 | 注入供给故障只生一根事故；未 ACK 超时升级；关闭须恢复证据；liveness 正常但无供给时 readiness 失败；最老待验收超阈背压 | 责任流程可先做；完整信号依赖 FIX-03、FIX-04、ARCH-03 | 运营值班经理＋SRE＋验收负责人 |
| **GOV-04 台账/平台/Docker 灾备与联合回滚演习** | **P0** | 备份范围、RPO/RTO、保留、digest；Taiga/ledger/卷；schema/Node/CLI/在途联合回滚 | 隔离副本完成一次恢复和一次回滚；事件链、平台、在途、路由四组核验通过；旧 binary 安全拒绝或兼容；记录真实 RPO/RTO | GOV-01；安全接管依赖 ARCH-01；在途复验依赖 FIX-04 | SRE＋框架发布负责人＋平台/存储 owner |

### C. 架构演进（5 张）

| ID／标题 | 优先级 | 范围 | 验收要点 | 依赖 | 建议执行者 |
|---|---|---|---|---|---|
| **ARCH-01 跨进程写者 fencing 与安全接管** | **P0** | 单调 token；SQLite/平台网关/公司 git；第二写者、stale writer、回执未知 | 两 daemon 负测无双写；旧代次所有写口均拒；崩溃/TTL/接管不重复副作用；PRB-14 有当前 commit 证据 | GOV-01 | 框架内核＋存储＋平台/git 适配器 owner |
| **ARCH-02 不可变 gate/evidence/release 契约与门户安全** | **P0** | 全链外键、独立 ACCEPTED/RELEASED、独立 worktree、evidenceIds/gateRunId、批量预检、mock 隔离 | A/B 并发不串 revision；批准错 gate/版本被拒；宿主不可达生产面只读禁写；批量 CLOSE 默认禁；撤回不改历史 gate | GOV-01、FIX-04 | 框架契约 owner＋workbench 门户/QA＋发布负责人 |
| **ARCH-03 稳定运营投影、全链对账与成本遥测** | **P1** | 版本化表头/时区；dispatch/attempt/model/reset/revision/gate/release；usage/cost；backlog aging | studio 空导出断链有根因与修复；可算每交付成本，unknown 不为零；解释 LOCAL-188 41/40；11 月 26 日可出重试成本报告或明确不可对账范围 | 全链依赖 FIX-03、FIX-04、ARCH-02；空导出修复可先行 | 数据/可观测负责人＋财务运营＋两公司代表 |
| **ARCH-04 多公司 tenant 边界与 runtime 生命周期** | **P1** | tenant key/query/route/session/artifact、quota、portal 授权；LRU quiesce/inflight/await close | 两公司同名 ID、共享池、churn 负测无串号；活动调用不被关闭，重开不撞 RUNTIME_ALREADY_OPEN；默认跨司拒绝 | FIX-03、ARCH-01；发布授权依赖 ARCH-02 | 框架 runtime＋安全＋workbench host owner |
| **ARCH-05 分层 deadline、宿主容量与受监督恢复** | **P1** | 三层 deadline、测试队列、CPU/IO/评审背压；cron 降级；workbench/profit/tunnel3 监督与停驻 | 同因超时未变更不自动重跑；过载先背压而非加 worker；重启后端口/在途/停驻符合声明；人工 runbook 有审计与回归 | FIX-03、FIX-04；成本信号接 ARCH-03 | 框架调度＋SRE＋验收容量 owner |

### D. 产品拓展（3 张）

| ID／标题 | 优先级 | 范围 | 验收要点 | 依赖 | 建议执行者 |
|---|---|---|---|---|---|
| **PROD-01 签名化 Executor/Provider 插件 SDK** | **P2** | 四原语契约包、能力声明、故障分类、最小权限、证书签名与到期 | 接一个实验 CLI 不改主循环；未证/过期证书只能实验；版本升级触发差分探针与重新认证 | FIX-06、ARCH-02；全部相关 P0 关闭 | 平台 SDK 负责人＋安全＋适配器贡献者 |
| **PROD-02 多公司只读控制塔与路由时间线** | **P2** | 跨司 readiness、成本、backlog、告警、路由只读聚合；明确 mock/真实故障态 | 同名单号不串司；宿主不可达只读报警；可解释换源、reset、wire model、unknown 成本；无跨司写接口 | ARCH-03、ARCH-04 | 门户产品负责人＋可观测团队＋安全评审 |
| **PROD-03 可移植签名插件包与首个可追溯候选发布** | **P2** | digest、SBOM、构建/打包 smoke、签名策略、安装/回滚、公司包迁移预检 | 从一张合格 backlog 单重现同 digest 包；在隔离公司安装、验证、回滚；证据链与人工发布授权完整 | GOV-02、GOV-04、ARCH-02；建议 PROD-01 复用签名规范 | workbench 产品＋release 工程＋独立验收人 |

### 必须先做的 3 张

1. **FIX-01：outbox 拒绝与 ACK 语义修复**——范围小、无依赖、直接关闭已证实的误成功消费路径。
2. **FIX-03：错误分类与供给级配额调度**——与 FIX-01 并行，先止住两家公司共同的无效重试和成本放大。
3. **FIX-02：durable single envelope 与恢复**——紧随 FIX-01，在拒绝/ACK 语义冻结后合入，关闭另一个已证实的恢复正确性缺口。

**即时管理护栏**：不等待三张技术单完成，workbench 应暂停无逐单证据的批量 CLOSE；这属于 GOV-02 的止损前置，不等于启动批量验收或发布。前三张完成前，不扩事件功能、不新增默认模型/执行器容量；随后以 FIX-04＋ARCH-02 建证据链，再处理 GOV-02 的实际收口。

---

## 7. 不做什么

1. **不把 174 单批量 CLOSE 当作治理**，也不把 `done`、GATE_PASS、QA_PASS 或历史 26 单已交付当作插件可发布证明。
2. **不指控历史 25 单同秒 CLOSE 必然是“假验收”**；批量事实成立，授权与证据是否合格仍需逐单补证。
3. **不通过放宽四要件、取消独立验收或单纯调大 timeout 来降低失败率/积压**；也不得对同因确定性故障继续自动重试。
4. **不在共享池与 fencing 未闭合前增加泳道、daemon 写者、默认模型或生产执行器**；agy 未通过真机认证不得启用生产。
5. **不回填历史任命、授权、独立验收或成本数字**；缺证就标未知，保留 append-only 历史并增加补偿说明。
6. **不把空成本文件解释为零成本，不把 429 记录数解释为用户数/请求数，不把 queue_state 的新单数解释为待验收数**。
7. **不继续叠加看护分支来掩盖幂等与 fencing 缺口**；先统一收口键和写者代次。
8. **不让生产宿主不可达时的 mock 产品面继续提供写操作**；演示 profile 与真实公司面必须隔离。
9. **不在此时微服务化、多主写入或直接商业化多租户**；先完成正确性、隔离、恢复、成本和审计基线。

### 未知／需补证清单

| 未知项 | 需要补的最小证据 |
|---|---|
| 快照后是否已有修复、当前线上真实状态 | 当前 commit、部署配置、服务 readiness、最近变更与对应测试；不得用快照直接断言现状 |
| P0-01/02 的实际生产损失量 | 拒绝对象、outbox pending/ACK、EXPIRED/DEAD_LETTERED、redrive 对账及故障注入结果 |
| V2 records 实际缺账范围、PRB-14 是否补跑 | 当前公司 shadow 完备性报告、PRB-14 当前 commit 结果、第二写者/stale writer 实测 |
| 真实 provider/account/pool 映射与跨公司配额影响 | 脱敏账户池拓扑、reset 时序、路由决策、两公司同窗口事件；不能仅按模型名推断独立性 |
| 11 月 26 日风暴成本与每交付成本 | 原始 token/价格/订阅摊销/缓存计价、attempt 关联；缺失范围明确标不可对账 |
| 174 单及历史 25 单/LOCAL-1 的验收合法性 | 每单 revision、gateRun、完整输出、验收人/审批人、release 目标；LOCAL-188 41/40 对账解释 |
| studio-dev 当前待验收量与 aging、11 月 25 日低量原因 | 有时区和 schema 的逐日队列投影、派发/验收日志；不得以新单 16 代替待验收 |
| 告警是否送达、ACK，DAILY_ALARM 后期停报原因 | 投递回执、认领/升级/关闭记录、告警规则运行状态；区分无异常与未告警 |
| 实际 wkey、归档/waive/人工恢复权限 | 脱敏权限矩阵、actor/approver 审计、撤回后代停用测试；people.csv 角色不等于授权证明 |
| Node/CLI/agy/Kimi 当前兼容与凭据行为 | 当前生产组合矩阵、真机 canary、代理/env、token 刷新竞态、超时与续跑负测 |
| Taiga/Docker/ledger 当前备份与恢复能力 | 最近脱敏 backup digest、隔离恢复报告、RPO/RTO 实测、平台与在途对账 |
| 多公司 runtime LRU 是否会在 inflight 时关闭 | 公司 churn＋慢调用＋并发重开故障注入；没有测试前既不称泄露，也不称安全 |

---

## 8. 附录：覆盖度、预算与未核验声明

### 8.1 三批及首轮材料覆盖度

| 材料 | 覆盖与主要贡献 | 本总审如何使用 |
|---|---|---|
| `output/01-framework-review.md` | 规范、V2、质量专题、指定 6 篇 sentinel；11 张建议单。未读源码、未跑测试 | 用于迁移语义、记录、fencing、配额设计、兼容与治理风险；文档自报不当成生产实测 |
| `output/02-studio-operations-review.md` | 近两周 CSV、2,053 份 issue 计数、Top 10 抽读、3 篇事故材料；10 张建议单 | 用于 studio 交付/风暴/恢复/成本指标；不重算原始 CSV，不将历史事故外推为当前 |
| `output/03-workbench-review.md` | 225 份 issue 统计、重点单、配置、插件定向源码；9 张建议单 | 用于两个源码 P0、174 积压、验收/发布与租户风险；静态证实不冒充动态复现 |
| `output/00-partial-findings-kimi.md` | 首轮中断前 3 条未验证假设 | ACK 与 envelope 已由第三批证实并修正措辞；“174 已被批量关掉”被第三批快照证伪，“历史假收口”仍未核验 |
| `BRIEF.md` | 背景、评审要求和重点事故线索 | 仅作任务边界；背景中的现况不单独当作验证证据 |

### 8.2 覆盖限制与预算

- 本总审**没有直接读取框架或插件源码、CSV、issue JSONL、SQLite、压缩日志，也没有运行测试、故障注入、真机探针或连接外部系统**；所有证据均为对指定报告的二次综合。
- 因此，本报告中的“已证实”表示**相应批次已在授权快照内证实**，不是总审独立复现；“未核验”不因多份报告重复出现而升级为事实。
- 三批原建议共 30 张，本报告按共同根因和交付边界合并为 **18 张**；合并不代表缩小 P0 验收范围。
- 本总审正文证据输入仅上述 **5 份 Markdown，共 674 行**，未展开其他卷宗。无独立精确 token 计数器；按实际载入规模控制在 **100k tokens 预算内**，精确消耗未核验。
- 本次仅写 `output/00-overall-review.md`；所有引用均使用相对路径或报告内源文件行号，不包含本机绝对路径。

---

## 9. 总结

StudioNext 的核心问题不是“完全没有交付”，而是**交付速度已经超过正确性、权责和发布证据的承载能力**。短期应依次止住无效重试、修复两个事件正确性缺口、统一幂等收口与不可变验收发布链，再清理 174 单和补齐成本/灾备/告警治理。完成这些之前，维持严格闸门和受限运行比增加吞吐更重要；完成后，可靠内核、统一配额代理、证据控制面、签名插件 SDK 与只读多公司控制塔才具备低风险扩展基础。
