# studio-daemon 路线图（v1 已实现 / v2 规划）

> 研究来源：三路深度调研（YouTrack 潜能 / Claude Code 潜能 / 内核审计），原文见会话记录。
> 原则：简约但不简单——每期只加"能让循环更快/更稳/更省钱"的东西。

## v1（本次交付）
- 确定性状态机（23 态矩阵 Python 真源 + 修复 B 轨关单缺边）
- pm/qa tick 全代码化：批示解析、DoD LLM 岛、G1 派工、收割 G2、QA 认领-复测-加测、合并尾段
- claude worker：wrap.sh + stream-json 直播落盘、进程组 kill
- 自评引擎：7 日指标 → 异常模式 → STUDIO 内部改进草稿单（元循环）
- FastAPI 仪表盘 :8787（板面/工人/事件/指标/直播流）
- APScheduler（SQLite jobstore，max_instances=1）+ launchd 保活

## v2（已验证可行，按价值排序）
1. **YouTrack Commands API**：一次调用原子改多字段/多单，替换字段级 REST；发前 `/api/commands/assist` 预检防 LLM 幻觉命令。
2. **服务端状态机 workflow**（JS）：轨道×类型矩阵下沉 YouTrack，UI 手滑也拦得住；guard 用 workflow.message 回显拒绝原因。
3. **Webhook 事件驱动**：issueUpdated/commentAdded 推送 daemon → 近实时循环；无重试 → 保留低频对账轮询（updated: last 6 min）+ 幂等去重。
4. **Epic 拆解 + depends-on DAG**：llm.epic_split 已留口；POST links API 建链 + 官方 Dependencies workflow（依赖未完不许过闸）。
5. **claude 会话续命**：worker 中断用 --resume 续跑（研究报告中确认可行性后细化）。
6. **Hooks 熔断**：PreToolUse 拦截 git push（永不自动 push 的服务端强制）。
7. **成本台账**：YouTrack time tracking work items（type=LLM-tokens）+ events tokens/cost_cny 双轨记账。
8. Inspector/Scout/版本日官/日报官 吸收为 daemon job（不再依赖 ZCode 会话）。

## 长期（给自己开的"内部改进单"来源）
- 自评引擎升级：把 /api/activities 全量流水接入，算真周期时间分布，而不只是事件计数
- 多项目泛化：projects.json/roster.json 落地，PID 参数化（P5 第二项目）
- 看门狗四查并入 daemon 自检 job（心跳/锁滞留/日志 HALT/预算）
