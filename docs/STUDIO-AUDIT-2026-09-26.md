# STUDIO 框架全面审计 2026-09-26（五路并行 agent）

> 方法：5 个只读审查 agent 并行——①核心执行链代码 ②治理族与状态机代码 ③运行时证据（日志/记账） ④历史审计对照（09-20 基线 + 59 提交核验） ⑤板面与流程运转。交叉验证后由常驻监督汇总定级。
> 基线：master `3c786e9`；对照 `docs/STUDIO-AUDIT-2026-09-20.md`。
> 本文档是修复包 STUDIO-39 的事实源；处置留痕以此为准。

## 总评

骨架健全且在事故中持续进化：状态外置+机器断言+锁自愈+断路器全部有效运转（本周闸门失败率 55%→0%，GAMES-40 百分钟全链闭环）。但三条系统性弱点清晰：

1. **计量失明**：5732 条 runs 的 duration_ms 100% 为 0，events 的 tokens/cost_cny 填充率 0%——而数据一直都在（GAMES-40 的 stream result 里明躺 `total_cost_usd=16.48, duration_ms=2683795`），四条接线全断。宪章 §4.6"全程记账"是纸面承诺，成本治理盲飞。
2. **LLM 岛不稳定且失败被系统性误分类**：7 天 62+ 次超时（flash 占 89%，且 llm.py 300s 限速压低真实数字）；岛返回 None 被 patrol 折叠成"解析失败"（POLY-14/19/20 白跑）；QA 加测 36% 因超时跳过；日报异常段只匹配 "ERROR" 对此全盲。
3. **承诺与实现无核销机制**：宪章 §10 分期照写"P0 已完成"，但 worker 三约束修在已废弃的 bash 脚本上、预查闸零代码、onboard 从未实现、YouTrack 实绑 0.0.0.0 与宪章 127.0.0.1 不符。历史模式：一行可修的全部闭环带测试，需新建架构的全部没动。

---

## P0（成本/正确性致命）

| # | 问题 | 证据 | 状态 |
|---|---|---|---|
| P0-1 | 记账链四处断裂：daemon 监听器硬编码 0、_harvest 不解析 stream result、append_event 的 tokens/cost 形参无调用方、手动触发路径写 0 | `daemon.py:47-59`、`orchestrator.py:281-319`、`workers.py:183-190`、`metrics.py:8-15`；runs.jsonl 5732/5732 duration=0 | 待修（修复包） |
| P0-2 | 巡逻岛超时（600s）返回 None 被 patrol 折叠成"解析失败"，且解析失败也推进 state → every_h=168 的 POLY-19/20 一次超时烧掉整周窗口 | `patrol.py:149-158,187-188`、`llm.py:124-137`；时间线铁证：POLY-19 快照 09:10:25→事件 09:20:25 恰为 600s | **本日已止血** |
| P0-3 | Worker 三约束缺失：Python Worker wrap 无 `--max-budget-usd`、无 `--model`（违反 §6"一律显式 --model"）、无 wall-clock 看门狗（心跳制 90min≠45min，worker 持续心跳则永不封顶） | `workers.py:125-130`；三件套齐备的 `~/bin/studio-worker:62-68` 是死代码（已被 Python Worker 吸收） | 待修（修复包） |
| P0-4 | 泳道锁把 pid 编进锁名（`lane-{pid}-{lane}`）而 lane 是全局物理仓 → 跨项目对同一 checkout 零互斥；GAMES 与 POLY 错峰仅 7 分钟，worker 动辄 40+ 分钟 | `orchestrator.py:241,144,169,324`；GAMES-40 实测 44.7min 与 POLY 单同用 core 泳道物理路径 | 待修（修复包） |
| P0-5 | 日报"异常"段只匹配 `ERROR` 字样，对最大生产病灶（ask FAILED ×62）全盲；TICK 汇总行还会把同错双计 | `reports.py:83`；9/26 日志 FAILED×12 vs ERROR×3 | **本日已止血** |

## P1（应尽快修）

| # | 问题 | 证据 | 状态 |
|---|---|---|---|
| P1-1 | NO-LANE 活锁：STUDIO 项目结构性无泳道字段，STUDIO-23~32 九张单每 10 分钟刷一遍（7 天 827 行），无断路无升级 | `orchestrator.py:236-237`；lane_of 的 core 兜底只用于 merge 不用于派发 | 待板面处置+代码兜底 |
| P1-2 | 消毒器绕过面（纸面推演）：`git diff --output=绝对路径`/`find -fprint`（任意文件覆盖）、`python -m pip install`/`http.server`、裸 `$HOME` 读 token、`;` 分段放行 | `llm.py:33-78`；STUDIO-37 读外部热点源后 LLM 生成 gate_cmd，提示注入直达 `bash -c` | 待修（安全批） |
| P1-3 | 草稿转正双断链（旧审计 C1/C2 未消化）：yaml 双 `情报:` 键静默覆盖丢 `[草稿,发现]` 边；技术债族永不查 type_edges → promote 必炸"非法迁移" | `kernel/schema/ticket-types.yaml:61,63`、`statemachine.py:91-94` | 待修 |
| P1-4 | GAMES-32~39 八张战役单无 yaml spec 空转：每轮"未配置仓库"结论，every_h=24 每天烧 8 次 FULL 调用；且激活早于 M0 交付违反波次纪律 | kernel/campaigns/ 无 GAMES yaml；19:05 激活 vs 20:27 M0 交付 | **本日已止血**（空壳短路）+待补 spec |
| P1-5 | STUDIO-9 僵尸战役：10 轮 0 孵化，unity 双源被 claude CLI WebFetch 域名校验拦截（非 llm.py 层），备用 reader 持续 500 | state count=10；PATROL note 三次自证 | 待制作人决策（换源/暂停） |
| P1-6 | `_harvest` 异常路径 attempt 不增：gate 无命令/HTTP 抖动/REPORT 超长 → 下 tick ARCHIVED 分支"不罚 attempt"立即重派 → 无断路的重派风暴 | `orchestrator.py:281-319,152-156` | 待修 |
| P1-7 | kill 竞态三处不原子：kill 只发 SIGTERM 不等死即重派；kill 前不复查 REPORT（误杀丢证据且 launch 归档重命名静默覆盖）；Popen 与 reg 写盘非原子（孤儿 worker 被脏树自愈 reset --hard 摧毁） | `workers.py:168-181,121-124,132-139`、`orchestrator.py:147-150,244-253` | 待修 |
| P1-8 | 遗留 Type（业务）单每 tick ERROR：本地状态机认边、YouTrack 工作流不认（POLY-22/23）；c719eee 只堵了重派没堵报错 | 9/26 07:50 日志 ×2；`statemachine.py:91-94` | 待修（legacy 映射） |
| P1-9 | YouTrack 实绑 0.0.0.0:8080，宪章 §9 写 127.0.0.1（文档失实+暴露面） | docker 实录 | 待运维修+宪章校正 |
| P1-10 | POLY 放行死角：POLY-24/25 待批 11 小时无人处理——POLY 不在 delegated_approvers，pm-poly 只回 OK 不批 | 板面实录 | 待制作人决策（是否比照 GAMES 授权代批） |
| P1-11 | evolve 结构性风险：提案标记取第一条+apply 取最旧草案（多轮指令后批的非所用）；scan 无锁可与手动触发并发双跑；`git add -A` 踩工作树 | `evolve.py:63-64,230,132,139-141,257-259` | 待修 |
| P1-12 | 批示口语别名过宽："好，不过先别做" 首段切出"好"即 approve | `orchestrator.py:408-425` | 待修（小） |

## P2/P3 卫生债（批量清单）

- 证据空心化：141 个 .log 中 68 个 0 字节仍算有效证据；QA 加测命令/输出不入 `*-qa-*` 证据文件；"加测=生成失败"默认放行；dod_gen 提示词反而教 LLM 用恒真命令兜底（`llm.py:228`）
- web：CSRF 仅 Sec-Fetch-Site 一层（旧 Safari/非浏览器客户端放行）；/api/transcript 可泄 token（worker cat 过配置就上面板）；/api/overview 坏行 500；_workers glob 误解析
- 锁：败者可 rmtree 胜者半建成锁（mkdir 与写 ts 间隙）；liveness 绑 daemon pid 而非 worker pgid
- 心跳判据与 stream 停滞判据割裂（supervise 有 20min 判据不接 kill 决策）
- 指标死角：STALL 无埋点恒 0（无法区分"没卡单"和"没监测"）；HARVEST/VERIFY 不进 events；D4 死指标进日报
- patrol 锁 TTL 120s < 单轮最坏 25min（慢轮可双巡逻）；子单孵化异常不推进 state（每小时重跑 baseline+LLM 循环）
- KB_ALLOW 指向已删除的 kernel/TEAM.md 与 agents/*.md（kb-propose 治理流必 KB-TARGET-MISS）
- runs seed_from_logs 只认 POLY|QA；supervise 巡检不含 GAMES；`_PM_MARKERS` 缺 v2 新槽位路标
- 死代码：`orchestrator.py:481-482` cur=0 笔误、epic_split、confidence 解析后未用
- 板面：6 张 GAMES 单用弃用态"已排期"；E1-E5 与 E6 同编制不同 Type；POLY 知识库 0 篇（实际落仓内 kb，缺导航文）；STUDIO 知识库 40+ 篇"草稿："未转正
- 时区：reports 全 naive mktime（本机无实害，可移植性债）

## 历史对照结论（04 号 agent）

- 9-20 审计 N/W 系列：N1/N2/N3/W2/W1③ ✓已修牢；N4/N8/N10/N11 ✗未修；W1② **修在死代码上**；W1① ✗未修（0.0.0.0）
- 9-16 审计 C 系列：C3/C4/C6/C10/C14/C17 ✓；**C1/C2/C5/C8 ✗ 未消化**（宪章 §10 宣称"随 P1 一并消化"未兑现）；C7/C9/C11 △半修
- 宪章分期：P0 △6/7；P1 △半落地（状态机扎实，"删批示解析岛/JS guard/存量映射"未做）；P2 △1/3（预查闸/记账 ✗）；P3 △2/4（onboard 从未实现）；P4 △（名册在、Scout/Inspector 链路断）
- 共性根因：修复跟事故走、承诺清单无核销；自然语言评论解析是最大事故源（三代补丁未除根）；执行面双轨旧载体不清理；重复动作缺统一防重入惯例

## 本日已止血（随本审计提交）

1. **P0-2**：patrol 岛无响应走独立分支——记 ERROR 日志（进日报视野）、短退避 2h 重试（168h 战役不再一次超时烧一周）、不再误标"解析失败"
2. **P0-5**：日报 _err_digest 同时匹配 `ask FAILED`、过滤 TICK 回显行
3. **P1-4**：空壳战役（无 repo 无 sources）短路不烧 LLM，留言提示补 spec

## 修复路线（STUDIO-39 修复包执行序）

- **第二批（P0）**：P0-1 记账四接线（harvest 解析 stream result 入账 + job 计时 wrapper + tokens/cost 透传）→ P0-3 worker 三件套（照抄 bash 版）→ P0-4 泳道锁去 pid
- **第三批（P1 安全）**：P1-2 消毒器白名单收紧 → P1-9 YouTrack 绑定 127.0.0.1 + 宪章 §9 校正 → web CSRF token/脱敏
- **第四批（P1 正确性）**：P1-3 草稿转正断链 → P1-6/P1-7 生命周期原子性 → P1-8 legacy 映射 → P1-11 evolve 加固 → P1-12
- **卫生债批**：P2/P3 清单打包清

## 制作人决策清单（板面处置详见 05 号 agent 报告）

1. STUDIO-23~32 九张 v2 旧单：7 张建议关闭/取消（25/27/28/32 已由 git 历史证明完成；23 重复；26 方向被取代；29 并入自优化），30/31 保留（31 提级 P1）
2. STUDIO-21/22/36 三张 [自评] 草稿：指标窗口已过期、根因已修，建议关闭（日报引擎已接管持续监控）
3. STUDIO-38（自优化体系）：四支柱已全部实施留证，建议 approve 结案
4. POLY-24/25 待批 11 小时：是否给 POLY 比照 GAMES 的代批授权？
5. STUDIO-9 战役：换可本地化源（RSS 落盘）或暂停？
6. GAMES-32~39：令 PM 补 yaml spec（挂 games 仓）并按作战图开 W1 波次单
