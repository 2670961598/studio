# [框架] 操作手册索引

> 状态：草稿 ｜ 采集：STUDIO-14，2026-09-17 ｜ 源：kernel/skills/*.md（9 份）
> 手册 = 唯一剧本：各岗位按手册执行，不即兴发挥。**手册更新 = 改文件即可，cron 提示词不用动**。

## 总入口

- **kernel/skills/AGENTS.md** — 编制与手册总索引：架构 v4 头注（studio-daemon 承载全部循环）、三份共享知识库、自进化入口、编制一览表、建岗指令（开新会话原样发一句）、worker 派发说明、岗位交接须知。

## 手册清单（按状态分组）

### 现行（daemon/worker 正在依据执行）

| 手册 | 岗位/场景 | 一句话 |
|---|---|---|
| worker-common.md | 程序/策划/美术 worker 通用 | 开工（分支/心跳）→ 干活（小步提交/禁越范围）→ 自检（自跑冻结验收）→ REPORT 落盘（唯一交付物，格式硬约束，只报事实不写结论） |
| dispatch.md | 派工与兜底（daemon 依据） | 路由表（什么活派什么 agent）+ 派发前置 G1 断言（8 条）+ 十类失败模式兜底 + 升级路径 + 批示词汇表（v2 唯一权威） |
| digest.md | 日报官（每日 09:30） | 只读+告警评论；一屏薄日报产出到 kernel/metrics/digest/；任何时候不动状态 |
| inspector.md | Inspector（每日 09:00） | 全项目代码体检 → 草稿技术债单 ≤3/日（量化证据：TODO 计数/空 catch/超大文件/仓库卫生） |
| scout.md | Scout（每日 10:00） | 按 intel/scout-topics.md 题材检索 → 草稿情报单 ≤5/日（链接+置信度；低置信不开） |
| version-day.md | 版本日官（每周五 18:00，财务+人事帽） | A 段兑现上周批示（approve-push-batch 批量推送+tag）→ B 段盘点（事件/周期/积压/回归抽查/预算）→ 版本日单+release notes+retro 一页纸 |

### 已退役（存档供考古，文件头有退役标注）

| 手册 | 原岗位 | 退役原因（2026-09-16） |
|---|---|---|
| sub-pm.md | 子 PM tick 十二步剧本 | v1 轨道制/23 态被 v2 五族分类取代，由 studio-daemon 确定性执行；现行事实源 = schema v2 + dispatch.md |
| qa-gate.md | 全局 QA 独立验收 | v1 独立 QA 队列并入 v2 收割链（证据就绪→复验通过内联复测） |

### 待建岗（手册就绪等 token/等建 cron）

- Inspector / Scout：手册就绪，**等 token**（账号未上岗）。
- 日报官 / 版本日官：手册就绪，待建 cron（v2 方向：吸收为 daemon job，见 ROADMAP v2-8）。

## 手册的效力机制

- cron 提示词模板指向手册文件（"严格按它执行，唯一剧本"）——文件为准，改手册即改行为。
- worker prompt 由 workers.py WORKER_TEMPLATE 机器组装，强制注入 worker-common.md 与目标仓 AGENTS.md。
- 手册属于知识库（部分在 evolve.py KB_ALLOW 白名单内），修改走 kb-propose 提案流；dispatch.md 第五节自带"预案自进化"约定（每次兜底真实触发 → PM 记事件 → 自评引擎把高频模式开成改进提案）。

## 源

- /Volumes/BigDisk/Studio/kernel/skills/（全部 9 文件 + AGENTS.md 总索引）
- /Volumes/BigDisk/Studio/studio-daemon/studio/workers.py（WORKER_TEMPLATE）
