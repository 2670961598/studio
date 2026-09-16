# [框架] studio-daemon 架构总览（五族×级别×AI原生状态机）

> 状态：草稿 ｜ 采集：STUDIO-14，2026-09-17 ｜ 源码：/Volumes/BigDisk/Studio/studio-daemon/studio/
> 只总结架构，不复述实现。行号以采集时点（master@ed49a28）为准。

## 1. 定位与形态

studio-daemon 是工作室的常驻大脑：**Python 单进程**承载全部循环——确定性状态机 + claude 执行层 + 自评元循环 + 战役巡逻 + schema 自进化（源：kernel/skills/AGENTS.md 架构 v4 头注）。技术栈：APScheduler（SQLite jobstore，`max_instances=1` 防重叠）+ FastAPI 控制台（:8787）+ uvicorn。由 launchd 拉起、bash 循环看护（见 [framework-deploy-ops.md](framework-deploy-ops.md)）。

模块地图（studio/ 下 16 个 .py）：

| 模块 | 职责 |
|---|---|
| config.py | 配置装载单一真源：复用 ~/.config/polymatch3/*.json 与 kernel/ 目录；常量（attempt≤3、心跳 90min、TTL） |
| daemon.py | 入口：装配调度器（5 个 cron job）+ 起 web；支持 `tick`/`board` 手动模式 |
| orchestrator.py | 核心 pm_tick：板面轮询 → 逐单推进（派发/收割/批示/断路/合并） |
| statemachine.py | 五族分类 × 级别流的迁移合法性（唯一真源 schema v2，损坏回退内置） |
| llm.py | LLM 岛：DoD 生成 / QA 加测 / 批示解析 / 输出消毒 / reviewed_ask 审查兜底 |
| gates.py | run-gate 原生版：冻结验收执行 + 证据落盘（与 bash 版字段兼容） |
| locks.py | 目录锁原生版（与 ~/bin/studio-lock 互操作：同目录同语义） |
| workers.py | Claude 工人进程管理（launch/status/kill/archive，stream-json 直播落盘） |
| patrol.py | 战役巡逻引擎（Type=战役·运行中的永驻母亲单） |
| evolve.py | 知识库自进化（evolve-schema / kb-propose → 制作人 approve → 应用） |
| metrics.py | events.jsonl 记账 + 自评引擎（每日指标 → 异常模式 → STUDIO 草稿提案单） |
| runs.py / web.py / yt.py | 调度运行历史 / 控制 API / YouTrack REST 客户端 |

调度错峰表（daemon.py:43-52）：pm-poly `0,10,…,50 * * * *`、pm-studio `4,14,…,54`、evolve-scan `3,13,…,53`、patrol `5 * * * *`、self-eval `50 8 * * *`。

## 2. 五族分类（families）

源：kernel/schema/ticket-types.yaml `families:` + statemachine.py。族决定"这张单由谁、走什么形状的流"：

| 族 | 一句话 | 流转来源 |
|---|---|---|
| 交付 | agent 干活的变动 | 按**级别流** flow_by_level 展开 |
| 知识 | 发散与沉淀，不进交付队列 | type_edges 专属边（疑问/情报） |
| 治理 | 工作室框架的变动，统一提案流 | type_edges（提案/复盘） |
| 运营 | 长期永驻巡逻 | type_edges（战役） |
| 事件 | 急事特殊通道 | type_edges（事故） |

## 3. 级别（影响深度旋钮，YouTrack 字段沿用"轨道"）

交付族 L0-L3 管审批次数（schema levels 节）：

- **L0 自动**：零审批，新单直派 → 已交付（纯文档/格式）。
- **L1 首批**：立项批一次，之后全自动。
- **L2 常规**：立项 + 合并两批。
- **L3 特护**：立项/方案/合并+终验；**两段派发**——第一段产方案文档（证据就绪→待批=方案审），批后重新派发做实现。同名态在流里可重复出现，语义由位置+批示指令区分。

治理族 G1-G4 管变更重量（知识/类型/编制/红线，G3/G4 附 24h 冷静期复核）。

## 4. AI 原生状态机

原则（schema 头注）：**状态 = 机器可验证的事实**——已派发=进程存在，证据就绪=REPORT+run-gate 绿，复验通过=QA 复验绿，已交付=merge+verify；不是人的心情词。状态迁移只由 daemon 依机器事件推进；**待批只由制作人评论推进**。退回边（证据就绪/复验通过→已派发，attempt+1）+ 断路边（attempt≥3 → 待批，仅代码触发）。旧 23 态保留给历史单，新单不用。

## 5. pm_tick 主循环（orchestrator.py）

每 tick：拿 tick 锁 → 拉板面（排除六类特殊单）→ 逐单按状态分派处理 → 每 tick 最多 3 次派发 → 释放锁 + 心跳。关键链路：

1. **草稿**：等制作人 promote/kill（Inspector/Scout/自评的产出位）。
2. **新单**：DoD 冻结（缺则 LLM 岛生成，失败请制作人补）→ L0 直派 / 其余进待批。
3. **待批**：位置感知批示——第 k 个未消费 approve 作用于流的第 k 个批位；消费留痕（"批示已执行 (第N批)"）保证幂等；断路后批位回第 1 批；制作人批示=新授权，attempt 清零。
4. **已派发**：收割（DONE→run-gate→证据就绪）/ 续锁 / 心跳超时 kill 重派 / DEAD 计 attempt 兜底。
5. **证据就绪**：QA **内联复验**（v2：独立 QA 队列退役）——冻结验收复跑 + Flash 加测岛一条加测；绿→复验通过，红→attempt+1 退回。
6. **复验通过**：L0/L1 自动合并；L2/L3 进待批（合并审）。合并 = 真实 merge --no-ff + main 上 verify 复跑，verify 红回滚退回；冲突隔离退回，不留无限重试。

十类失败模式与兜底全部代码化（源：kernel/skills/dispatch.md 第三节，含谎报拦截、脏树隔离、断路、HALT）。

## 6. LLM 岛（llm.py）

- **双模型分级**：FLASH（GLM-5.3-Flash）管批示解析/DoD 生成/加测/输出审查——快、便宜；FULL（GLM-5.3）管重推理（巡逻、知识/schema 编辑）。
- **安全纪律**：文本岛默认禁 Bash/WebFetch/WebSearch；一切将被 bash 执行的岛输出必须过 `_sanitize_cmd`（`&&`/`;` 分段白名单 + 危险特征黑名单 + 长度上限；双引号内容保护）。
- **reviewed_ask**（STUDIO-12）：主 LLM 出稿 → Flash 语义四查（一致性/自洽/格式/幻觉）→ pass 放行 / fail+corrected 用修正稿 / 无 corrected 重试一次 / 审查自身失败放行原稿——**宁可放过不可误杀**。
- **失败返回 None，调用方确定性兜底，循环永不停摆**。

## 7. 元循环：巡逻 / 自评 / 自进化

- **巡逻**（patrol.py）：战役单驱动，spec 在 kernel/campaigns/<单号>.yaml（制作人随时改）；可选基准命令快照序列化对比；LLM 带 WebFetch 巡逻源清单 → 贴进展 → 孵化子单（**安全红线：巡逻子单一律 ≥L2**，必经制作人批）。
- **自评**（metrics.self_eval）：每日算 AI 版 DORA（闸门失败率/QA 打回率/断路/STALL）→ 异常模式开 STUDIO 草稿提案单（≤2/日，量化证据）。
- **自进化**（evolve.py）：一切规则变更走 YouTrack 提案单——`evolve-schema`（新类型：枚举+schema+git+热重载）/ `kb-propose`（知识库白名单文件）；**无 approve 绝不应用**，提案与执行必须隔制作人一次 approve；应用后进 7 日观察窗，指标恶化可回滚。

## 8. 与 bash 内核的关系

locks.py / gates.py 与 ~/bin/studio-lock / run-gate 完全互操作（同一锁目录、同一证据格式）；workers.py 吸收 ~/bin/studio-worker 并升级 stream-json 直播。bash 脚本仍可独立使用（冒烟/人工救援）。
