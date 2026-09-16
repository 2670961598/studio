# STUDIO 工程交叉审核报告（第一单）

> 审核人：agent-dev（独立 Claude Code 进程，单据 STUDIO-11，attempt 0）
> 审核对象：studio-daemon/studio/ 全部源码（15 文件 ≈1900 行）+ kernel/schema/ticket-types.yaml + tests/（9 文件，63 例）
> 审核日期：2026-09-16 ｜ 分支：feature/STUDIO-11 ｜ 审核基线：06bea05..7c164fc（见下方"移动目标"说明）
> 基准（制作人裁定，TEAM.md §五）：个人本机工程，不评对外安全；聚焦正确性、可靠性、崩溃恢复、数据完整性、成本。
> 方法：全量人工读码 + 关键疑点逐条实证（Python/git 最小复现，非纯推断）+ 测试套件全跑 + pm_tick 路径 spy 取证。

---

## 〇、审核范围与证据

| 项 | 结果 |
|---|---|
| 测试套件 | `pytest tests/ -q` → **63 passed**（76.97s），提交信息所称 58 例已增长，全绿属实。**但见 C10：绿的部分代价是真实 LLM 调用** |
| 疑点实证 | 6 组最小复现（见 §二 各条「实证」），全部实锤 |
| 路径取证 | 对 `test_冲突残局_下轮隔离并退回` 注入 pm_tick spy：tick#1 实际返回 `ORPHAN`（非 HARVEST），证实该测试走错路径（详见 C4） |

**移动目标说明**：审计进行中（15:32/15:36），制作人向本分支连落两笔提交：ee9f75b（批示解析升级：`llm.parse_directive` LLM 岛 + 字符串兜底）、7c164fc（LLM 岛分级：Flash 小模型）。本报告已就最终代码（7c164fc）复核 `_directives`/`llm.py` 并更新全部行号引用，新增发现见 C8/C9/C10。这也说明一个流程事实：**worker 审核期间制作人在同一分支提交，审核基线会漂移**——本单靠"最终态复核"消化了它，建议以后派单时避免与在制分支并行开发。

---

## 一、架构与实现一致性

### 1.1 一致的部分（做对了）

1. **三铁律落地**：状态外置（YouTrack 字段 + kernel/ 文件，会话崩溃可无损接手）；机器断言（完成只认 `gates.run_gate` 落盘证据，REPORT 仅代发评论）；两级承包（worker 一单一命，`workers.py` wrap 脚本 + 进程组 kill）。
2. **schema 驱动状态机**：`statemachine.py` 以 `kernel/schema/ticket-types.yaml` 为唯一真源，损坏时回退 BUILTIN，`evolve._apply` 后 `recompute()` 热重载——与 TEAM.md「单子知识库唯一事实源，全员每读」一致。
3. **锁语义**：mkdir 原子获取 + owner 校验防误删 + TTL 过期接管 + beat 续期（`locks.py`），与 bash 版同目录同语义互操作；tick/lane 锁 key 均 pid 前缀防串单。
4. **权限红线**：批示只认 opengames 评论（`orchestrator._directives` author 过滤）；worker 无板面写权（prompt 明示"不写 YouTrack"）；`llm._sanitize_cmd` 白名单消毒后才 bash 执行；**全代码库无 git push**，CLOSE 事件明记"未push(无批示)"——"永不自动 push"红线守住。
5. **L0-L3 级别流**：`flow_by_level` 展开相邻即边 + 同名态位置语义（「批示已执行」计数 + 断路路标），正确实现了 schema 注释里"同一状态在一条流里出现两次"的设计。
6. **批示中文化与 LLM 岛**（06bea05 → ee9f75b → 7c164fc）：`DIRECTIVE_ALIASES` + 标点分词归一化实测正确（"批准，仔细审核"→approve、"通过率太低"→非指令、大小写不敏感）；`parse_directive` 岛延续"失败返回 None → 调用方确定性兜底"的模块纪律，方向正确——但落地引入 C9/C10/C11 三个新问题。
7. **断路防振荡**：制作人批准即清零 attempt（orchestrator.py:440-442），有测试覆盖（test_制作人批准后_attempt清零_不再振荡）。

### 1.2 不一致 / 漂移（按影响排序）

| # | 不一致点 | 位置 | 说明 |
|---|---|---|---|
| D1 | **宪章整体过时** | CHARTER.md vs daemon | 宪章自称"唯一事实源"，仍写 23 态/A-C 轨道/独立 QA cron/十二步 cron 舰队；实现已是 五族×L0-L3+G1-G4、QA 内联收割链、APScheduler 常驻（AGENTS.md 称"架构 v4"）。大面积冲突无人裁决 |
| D2 | **QA 岗"已上线"与实现矛盾** | kernel/skills/AGENTS.md 编制表 vs daemon.py:43-52 | 编制表称全局QA cron `7,17,...` ✅已上线；daemon 无 qa job——QA 实为内联（orchestrator.py:3 v2 变化）。编制表是给制作人看的驾驶舱，失真即误导 |
| D3 | **approve-push 指令无实现且语义漂移** | 宪章 §2.6 vs orchestrator.py:370-378,402-411 | 宪章：approve-push=关单时一并 push+tag。实现：无 push 代码；approve-push 无论走 LLM 解析（`startswith("approve")`）还是别名兜底都计入普通 approve，在合并批位会被当 approve-merge 消费掉（但不会 push）。红线本身守住，指令语义未对齐，制作人会误以为已推送 |
| D4 | **死指标** | metrics.py:45-49 | compute 统计 STALL/QUARANTINE，全代码库无一处 append 这两种事件；BUDGET_HELD 同死。宪章 G-断路"tick 连续失败≥2 停机"也未实现（无 HALT 计数） |
| D5 | **Epic 拆解未实现** | 宪章 §5 第 5 步 | `llm.epic_split` 留口无调用方；depends-on DAG 亦无（v2 规划内，但宪章仍写着现行为） |
| D6 | **evolve 应用时不取 lane 锁且 `git add -A` 全树提交** | evolve.py:139-141, 257-259 | evolve-scan 每 10 分钟跑；制作人 approve 恰逢 worker 在 studio 仓工作时，会把 worker 未提交产物一并 commit 进当前分支（数据完整性风险，详见 C8） |
| D7 | **admin token 被 daemon 自动使用** | evolve.py:216-225 | 宪章 §2.1"admin token 仅本机交互使用，任何 cron 提示词不引用"。daemon 常驻进程读 admin token 注册枚举——本机但已是自动化语境，与条款字面冲突（制作人裁定级） |
| D8 | **CLI 与 docstring 不符** | daemon.py:4-5 vs 73-81 | docstring 称支持 `tick pm\|selfeval\|patrol\|evolve-scan`，实际只实现 pm/selfeval |
| D9 | **Web Host 白名单硬编码 8787** | web.py:17 | `STUDIO_PORT` 环境变量改端口后所有请求 421（config.py:38 明明支持改端口） |
| D10 | **schema「默认级别: L1 首批」无代码消费** | ticket-types.yaml:42 | 技术债默认级别 daemon 不读，实际走 `yt.new` 默认 L2 常规。schema 里带机器语义的键不被消费应标注"仅知识库" |
| D11 | **`发现` 在 PM_ACTIONABLE 但永远被滤掉** | statemachine.py:108 vs orchestrator.py:14,56 | 情报属 SPECIAL，板面查询后即被过滤——`发现` 形同虚设；情报流（发现→评估中→已归档）无任何引擎推进，纯人工 |

---

## 二、正确性疑点（全部带文件:行；【实锤】=已最小复现验证）

### P1 级（4 项）

**C1【实锤】技术债草稿 promote 被状态机永久拒绝——Inspector 债单转正通道断链**
- 位置：`studio-daemon/studio/statemachine.py:81-94`（allowed 交付族只查 flow）；`kernel/schema/ticket-types.yaml:42`（技术债 族=交付）、`:60`（type_edges 技术债 [[草稿,新单]]）；`studio-daemon/studio/orchestrator.py:110-112`（草稿分支 transition "新单"）
- 机制：技术债在 DELIVERY_TYPES={需求,缺陷,技术债}（实测），`allowed()` 对交付族只走级别流判定、**永不查 type_edges**，而"草稿"不在任何级别流里 → `allowed('草稿','新单','L1 首批','技术债')==False`、`next_states('草稿',...)==[]`（均实测）。type_edges 的 [[草稿,新单]] 是死配置。
- 后果：制作人在技术债草稿上评论 `promote` → `yt.transition` 抛 ValueError → pm_tick 每轮 `ERROR <iid> 非法迁移`（orchestrator.py:71-73 捕获），草稿卡死，只能 YouTrack UI 手动搬状态绕过 daemon。TEAM.md 名册里 Inspector 的产出通道在 v2 走不通。

**C2【实锤】ticket-types.yaml `情报` 键重复，`草稿→发现` 边被 YAML 静默丢弃**
- 位置：`kernel/schema/ticket-types.yaml:61` 与 `:63`（同名键 `情报` 出现两次）；对照兜底 `studio-daemon/studio/statemachine.py:22`（BUILTIN 含 草稿→发现）
- 机制：PyYAML 后键胜 → 实测 `TYPE_EDGES['情报'] == [('发现','评估中'),('评估中','已归档')]`，`:61` 的 `[[草稿,发现]]` 丢失。**兜底 BUILTIN 反而比正常加载多一条边**——schema 正常时比损坏时更弱，自检永远发现不了。
- 后果：叠加 orchestrator.py:14 将 情报 列入 SPECIAL 从板面滤除（:56），情报草稿连 `_handle` 都进不去——`_handle` 草稿分支里 `to = "发现" if typ=="情报"`（orchestrator.py:111）对情报是死代码。Scout 情报单转正双重断链（过滤挡一道、边缺失挡一道）。
- 注：evolve `_validate` 与加载端均无重复键检测；此类问题下次 evolve 还会再犯。

**C3【实锤】收割"飞线"检查误杀健康分支——base 前进过的单必烧满 attempt 断路**
- 位置：`studio-daemon/studio/orchestrator.py:259-262`（`merge-base --is-ancestor base feature` ≠0 → ORPHAN 回收）
- 机制：检查语义是"base tip 必须是 feature 祖先"（即 feature 包含 base 全部历史）。只要 worker 在飞期间 base 前进过（另一单先合并、或制作人直提 main），feature 就不含新 base tip → 误判"飞线" → `_recycle` attempt+1 → 重派。而 `_dispatch` 重派只是 checkout 旧 feature（orchestrator.py:233-238 注释"重派复用已有分支"），**从不把新 base 合入 feature** → 下次收割同样 ORPHAN → 3 次后断路 @制作人。实测 git：base 前进后 `--is-ancestor` exit=1，而 `merge --no-ff` 本可正常成功——被拦下的 merge 恰恰是 git 最擅长处理的分叉场景。
- 触发面：当前单泳道串行 + lane 锁使 base 难以在 worker 在飞时前进，故主链低频；但 (a) 多泳道共享同一 base_branch 的配置、(b) 制作人手工提交 base、(c) 未来多单并行，任一成立即触发，且一旦触发必然烧满 attempt（无自愈路径）。
- 顺带：宪章 G2 原文是"所报 commit ∈ base..feature"（rev-list 语义，不要求祖先），实现取了更严的祖先断言，属过度执行。

**C4【实锤·测试有效性】`test_冲突残局_下轮隔离并退回` 测错了路径——merge 冲突自愈代码零覆盖**
- 位置：`studio-daemon/tests/test_orchestrator.py:180-206`
- 机制：测试在 worker 提交后、收割前，先在 main 上造 "base move" 提交（:188-192）→ 收割时恰好落入 C3 的 ORPHAN 分支。spy 实证四个 tick 依次为 `DISPATCH → ORPHAN → DISPATCH → []`——注释所写"harvest→证据就绪→复验通过→merge 尝试（冲突）"**一步都没发生**；终态断言 `st in ("已交付","已派发","复验通过")`（:206）把 ORPHAN 回收后的 已派发 也判为合法，测试恒真通过。
- 后果：`_merge` 的冲突隔离退回逻辑（orchestrator.py:305-315）与 verify-红回滚（:322-331）实际均无测试覆盖（后者本就无测试，前者被此测试假装覆盖）。

### P2 级

**C5【实锤】evolve 双指令切片错乱：desc/kb 从"最后一条指令"盲切**
- 位置：`studio-daemon/studio/evolve.py:69-72`
- 机制：`desc = directives[-1][len("evolve-schema"):].strip()` 取的是**所有指令的最后一条**（可能是 kb-propose）再按 evolve-schema 前缀长度硬切。同一内部改进单先后发过 `evolve-schema …` 和 `kb-propose TEAM.md 改名册` 时，实测 desc=`'AM.md 改名册'`（错位切片垃圾串）→ `_propose` 拿垃圾起草 schema 类型提案。TEAM.md 推荐指令都发在内部改进单评论里，单据复用是常态，此路径现实可达。
- 修法：desc/kb 应分别取各自前缀指令的最后一条。

**C6 L3 裸 `approve` 打乱两段派发并跳过复验**
- 位置：`studio-daemon/studio/orchestrator.py:162-164`（`_has(iid,"approve-design")` 首词精确匹配）与 `:370-378`（裸 approve 合法别名）/`:402-411`（LLM 解析同样放行裸 approve）相互踩踏
- 机制：L3 方案段用裸 `approve` 批（合法批示）→ `_has("approve-design")` 仍 False → 实现段交付后又回 待批(方案审)（:163）→ 制作人再批一次时 `_directives` 的 cur 已前进到合并位 → 从 待批 直接 `已交付`（:450,458），**实现段的复验被整体跳过**。名实校验（:452）只拦 approve-plan，不拦这种错位。

**C7 DIRECTIVE-MISMATCH 每 tick 刷评论 + kill/reject 响应迟滞**
- 位置：`studio-daemon/studio/orchestrator.py:452-454`（错位拒批不落「批示已执行」、无幂等标记 → approvals>applied 恒成立 → 每 10 分钟重复贴评论）；`:412-425`（kill/reject 只在无待消费 approve 时才扫——先 approve 后 kill 的单要等 approve 消费完才生效）；`:414`（只扫 `cs[-10:]`，超 10 条新评论会把 kill 淹掉）

**C8 evolve 应用与 worker 并发写同一工作树**
- 位置：`studio-daemon/studio/evolve.py:139-141, 257-259`（无 lane 锁 + `git add -A` + commit）
- 机制：evolve-scan 每 10 分钟扫提案；制作人 approve 的应用动作直接在 studio 仓当前 checkout（可能是某 worker 的 feature 分支）上全树提交，把 worker 未提交产物卷入。违反 TEAM.md"禁止未经 git 的顺手改"精神；靠"approve 稀有"兜底不是机制。

**C9【实锤·ee9f75b/7c164fc 引入】`_directives` 每 tick 对全部历史制作人评论逐条真实调 LLM**
- 位置：`studio-daemon/studio/orchestrator.py:399-411`（循环内 `parse_directive`，无解析缓存/已读水位）
- 机制：待批单每 10 分钟 tick 一次，`for c in cs` 把**全部历史**制作人评论重放给 Flash（每条最长 120s 超时）。老单评论越多越慢越贵：applied 只在实际消费后才前进，`approvals ≤ applied` 的单也照调全套。副产品：context 里的 `yt.f(iid,'State')` 是循环不变量却在循环内求值（:404），每条评论多一次 HTTP GET。
- 量级实证：见 C10（单次解析 2-4s）。

**C10【实锤】测试套件非封闭：`claude` 在 PATH 时真实烧 LLM 调用**
- 位置：`studio-daemon/studio/llm.py:45-70`（ask 直接 spawn `claude -p`）+ `tests/`（无 parse_directive 打桩；conftest 只 mock 了 HTTP）
- 实证：同一环境 `pytest tests/test_orchestrator.py`——PATH 含 claude：**7 passed in 101.40s**；`PATH=/usr/bin:/bin` 剥掉 claude：**7 passed in 3.32s**（30 倍差）。
- 后果：① 每次跑测试真实扣费（制作人审查基准含成本）；② 测试结果依赖外部 LLM 的解析输出——Flash 若把某条测试评论解析得与字符串兜底不同，消费计数即漂移，套件可能**非确定性地红**；③ 无 claude 的机器上走的是兜底路径，等于 LLM 主路径（ee9f75b 的核心功能）**零自动测试**，仅制作人在 commit message 里自述人肉验证过。
- 修法：conftest 里统一 monkeypatch `llm.parse_directive`（或 ask）为固定桩；另留一条显式 opt-in 的真实调用冒烟。

**C11【ee9f75b 引入】approve 与 kill/reject 解析语义分裂 + confidence 未使用**
- 位置：`studio-daemon/studio/orchestrator.py:402-411`（approve 走 LLM 优先）vs `:414-424`（kill/reject/track 仍是首词字符串匹配）
- 机制：① 分裂——"同意 kill"这类评论：LLM 大概率解析为 kill，但 kill 分支不消费 LLM 结果；字符串路径首词"同意"→别名表映射 approve → **计入 approvals 触发批准**，与本意相反。② LLM 把回顾性评论（"上次没批"/"这个方案批得不对"）幻觉成 approve 时，`parsed["confidence"]` 解析了但**没有任何阈值过滤**（:405 直接 startswith 判定），误计 approve 在位置语义下会跳批消费甚至直触合并。

### P3 级（低危/边缘，列出备查）

| # | 疑点 | 位置 |
|---|---|---|
| C12 | worker pid 复用误报 RUNNING（os.kill(pid,0)），长开机后可能；90min 心跳兜底可救 | workers.py:103 |
| C13 | `_directives` 批示统计基于全文评论扫描 + `批示已执行` 计数，PM 手工补评论/删评论会错位（幂等标记脆弱） | orchestrator.py:396-397 |
| C14 | DirLock：`_take` 与 mkdir 之间崩溃留无 owner 锁 → 阻塞至 TTL；owner 文件丢失时 release DENIED 泄锁至 TTL | locks.py:34-44, 87-91 |
| C15 | `/api/overview` 逐行 json.loads 无容错，events.jsonl 半行（崩溃时 append 中断）即 500 | web.py:48-49 |
| C16 | run_gate 600s / `_git` 120s 硬编码超时，大仓 merge 偏紧 | gates.py:33, orchestrator.py:30 |
| C17 | self_eval 无内容去重，同一异常模式每日重复开草稿单（≤2/日，最多 14 张排队等 kill） | metrics.py:69-77 |
| C18 | `seed_from_logs` 只认 `[POLY|QA]`，pm-studio 的 `[STUDIO]` TICK 行不导入运行历史 | runs.py:47 |
| C19 | `yt.f` 每次全量 GET 单据，`_handle` 一条流程十几次 REST 往返，放大 tick 时延与锁持有时间 | yt.py:61-62 |
| C20 | pm-studio 与 pm-poly 并行线程共享 events.jsonl/logs 追加——小写入 O_APPEND 下可接受，个人工程风险自担 | metrics.py:16 |

---

## 三、测试盲区

> 现有 63 例对**主交付链**（L0/L2 全流程、退回重派、断路与恢复、批示位置语义、锁语义、消毒白名单、证据格式兼容）覆盖扎实且设计良好（假 YouTrack 走真实 HTTP 客户端代码、真 git 沙箱）。盲区集中在**主链之外的新增模块**与**错误路径**：

| # | 盲区 | 涉及 | 后果 |
|---|---|---|---|
| B1 | **批示解析三层（DIRECTIVE_ALIASES / `_normalize_directive` / `parse_directive` LLM 岛）零受控测试**——ee9f75b/7c164fc 的核心新功能无回归网；测试里 LLM 路径要么静默失败走兜底（无 claude 时）、要么真实烧钱非确定运行（有 claude 时，见 C10） | orchestrator.py:370-411, llm.py:120-142 | 批示解析是全系统控制面；它裸奔等于方向盘没有回归网 |
| B2 | **patrol.py 整模块（154 行）零测试**：战役激活、_due 节流、子单孵化、gate_cmd 消毒拒绝、child_track 强制升 L2、情报子单入"发现" | patrol.py | 巡逻是唯一自动开单源，错了直接产坏单 |
| B3 | **metrics.py 零测试**：compute 口径、self_eval 阈值与 ≤2/日限流 | metrics.py | 自评元循环无回归 |
| B4 | **evolve 主链路零端到端测试**：提案→approve→_apply（yaml 写入+枚举注册+recompute 热重载）→观察窗→close_windows；C5 双指令 bug 正因此漏网 | evolve.py | 治理流安全网只有 `_validate`/白名单单元（test_evolve.py 8 例） |
| B5 | **workers.py 真行为零测试**（orchestrator 全程 fake）：wrap 脚本内容、REPORT/stream 归档命名（.a{n}/archived-*）、DEAD/UNKNOWN 判定、killpg | workers.py | 收割判定（DONE 的唯一依据 REPORT 落盘）无独立验证 |
| B6 | **心跳超时 kill 路径无测试**（90min → killpg → 回收 → 重派） | orchestrator.py:144-150 | 卡单巡检（十二步第 3 步）无回归 |
| B7 | **ORPHAN/飞线路径无显式测试**——C4 的测试本想测别的东西却意外撞上它，且断言恒真没起作用 | orchestrator.py:259-262 | C3 由此漏网 |
| B8 | **_merge 两条失败路径无覆盖**：冲突隔离退回（被 C4 假覆盖）与 verify-红 ORIG_HEAD 回滚 | orchestrator.py:305-331 | 合并尾段自愈逻辑裸奔 |
| B9 | **L3 两段派发无端到端测试**（仅 statemachine 4 条单元边）：方案审→approve-design→重派→实现→复验→合并批，含 C6 裸 approve 边界 | orchestrator.py:162-164 | 特护轨（最高风险级）恰是编排器测试最薄的级别 |
| B10 | **schema 兜底与热重载无测试**：BUILTIN 回退路径、`recompute()`、以及"加载结果与 BUILTIN 对账"的自检不存在——C1/C2 一致性盲区的成因 | statemachine.py:33-63 | schema 与代码漂移无人报警 |
| B11 | **gates 超时路径无测试**（600s → exit=124 证据落盘） | gates.py:34-37 | 长验收命令挂死的证据形态未验证 |
| B12 | web 的 /api/overview、/api/workers、手动 trigger 热路径无测试（现有 6 例全是空态冒烟） | web.py | 驾驶舱主接口无回归 |
| B13 | FakeBackend 与真实 YouTrack 语义对账无测试（如查询语法子集、评论 reverse 参数实现在但 yt.comments 不传） | conftest.py | 假后端漂移会让整套测试"绿着失真" |

**根因观察**：盲区分布与"测试跟着事故走"的模式吻合（注释里大量 P0-x/P1-x/P2-x 编号即历史修复）——主链被反复锤过所以厚，新模块（patrol/evolve/自评）上线即免检。建议把"新模块合入须带测试"写进 qa-gate 手册。

---

## 四、审核结论

# 审核结论：有保留通过

**理由：**

1. **核心交付链可信**：新单→DoD 冻结→派发→收割（run-gate 证据）→内联复验→合并→交付，连同退回/重派/断路/断路恢复/批示位置语义，在假 YouTrack + 真 git 沙箱里端到端闭环，63 例全绿且测试设计质量高（走真实 HTTP 客户端代码而非 mock 接口）。三铁律（状态外置/机器断言/两级承包）与"永不自动 push / 禁自批 / 只认 opengames 批示"红线均有代码对应且被测试锁定。
2. **但存在 4 项实锤 P1**（C1/C2 草稿转正通道双重断链、C3 飞线误杀无自愈、C4 无效测试），集中在"尚未高频投入的区域"（草稿池、多单交错、合并失败路径）：不阻塞当前单泳道串行的主链，但 **Inspector/Scout 上线前、多泳道/并行多单开启前必须修复**，否则断链会在那些场景里以每 tick ERROR 刷日志、或以烧满 attempt @制作人的形式爆发。
3. **P2 组 7 项**（C5 evolve 双指令、C6 L3 裸 approve 跳复验、C7 刷屏/kill 迟滞、C8 evolve 踩工作树、**C9 批示全史重放烧 LLM、C10 测试非封闭真实扣费、C11 approve/kill 解析分裂**）都是现实可达路径——其中 C9/C10/C11 由审计期间的 ee9f75b/7c164fc 新引入，直接命中"成本"审查基准，建议随 P1 一并排期；**文档漂移**（D1 宪章 v1 vs 实现 v2、D2 QA 岗编制表失真、D3 approve-push 语义）会误导制作人决策，代价低应尽快对齐。
4. 测试盲区（§三）不是"没写测试"而是"覆盖随事故生长"的结构性问题——建议：修 C1-C4 时各带回归测试（C4 重写、C6 加 L3 端到端、B1 补批示别名表），并把 BUILTIN↔schema 对账断言加进 `statemachine.recompute()`（一行 `assert` 即可防 C2 复发）。

**放行条件（建议制作人批示采纳）**：当前主链可继续跑；C1-C4 作为一张 P1 缺陷单（或并入 Inspector 上线前置单）排期；C9/C10（成本与测试封闭性）改动小、收益直接，建议先做——C10 一处 conftest 打桩即可让测试回到 3 秒级且确定；D1/D2 文档对齐可作为 C 轨轻单随手做。

---

## 附：修复建议速查（供排期参考，非交付物）

- **C1**：`allowed()` 交付族 flow 判定失败后补查 `TYPE_EDGES`；或草稿 promote 直迁（set_field + 留痕评论）绕过矩阵；任选其一，加回归测试。
- **C2**：yaml `情报` 两键合并为 `[[草稿,发现],[发现,评估中],[评估中,已归档]]`；`recompute()` 里加"BUILTIN 边 ⊆ 加载边"对账断言；evolve `_validate` 加重复键检测（`yaml.compose` 双 pass 或加载前正则）。
- **C3**：删掉 is-ancestor 断言（合并冲突自愈本就健在），或改为"feature 与 base 的 merge-base 是 feature 祖先"（恒真，仅防 history 改写）；重派时可选 `git merge base` 入 feature 促对齐。
- **C4**：重写测试——先收割成功再让 base 前进，或在 dispatch 前固定 base；去掉终态断言的 `已派发` 豁免；断言 tick actions 含 `MERGE-CONFLICT`。
- **C5**：desc/kb 分别取各自前缀指令的最后一条。
- **C6**：`_has` 改为"方案批位消费过的 approve 记录"（复用 批示已执行 第N批 路标），而非首词精确匹配。
- **C9**：解析结果缓存（评论 created 时间戳为 key 落 kernel/ 或单据字段），tick 只解析新评论；`yt.f(iid,'State')` 移出循环。
- **C10**：conftest 全局 monkeypatch `llm.parse_directive`（保留一条 `@pytest.mark.real_llm` 的 opt-in 冒烟）。
- **C11**：kill/reject/track 分支同样消费 `parse_directive` 结果（LLM 优先、字符串兜底，与 approve 对称）；`confidence < 阈值（如 0.7）` 时按未解析处理走兜底。
