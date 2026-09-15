# 虚拟工作室 · 编制与手册总索引（kernel/skills/AGENTS.md）

> **架构 v2（2026-09-15 起）**：ZCode 会话 = 监督验收层（子PM 派发/收割、主程=G2 核验、主策=DoD 校验、QA=独立终验）；
> **执行层 = 独立 Claude Code 进程**（`claude -p` + GLM，由 `~/bin/studio-worker` 机器派发，一单一命，REPORT 落盘交付）。
> worker 不占对话名额、上下文天然隔离、多泳道真并行；详见 kernel/intel/claude-code-worker.md。
>
> 定时任务的提示词一律写薄：**一行身份 + 一句"读哪本手册"**，细则全部以手册文件为准。
> 平台铁律（详见 kernel/intel/zcode-cron-binding.md）：①每个定时任务绑定创建它的会话，到点把提示词投回该会话执行；②一个会话只能绑一个定时任务。
> 所以：**每上一个岗，就开一个全新对话，发下面"建岗指令"里的一句话即可。**

## 编制一览（手册 = 唯一剧本）

| 角色 | 账号 | 频率 | 手册 | 状态 |
|---|---|---|---|---|
| 子PM·POLY | agent-pm | `0,10,20,30,40,50 * * * *` | sub-pm.md | ✅ 已上线 |
| 全局QA | agent-qa | `7,17,27,37,47,57 * * * *` | qa-gate.md | ✅ 已上线 |
| 日报官 | agent-pm | `30 9 * * *` | digest.md | 手册就绪，待建 cron |
| Inspector | agent-inspector | `0 9 * * *` | inspector.md | 手册就绪；**等 token** |
| Scout | agent-scout | `0 10 * * *` | scout.md | 手册就绪；**等 token** |
| 版本日官 | agent-pm | `0 18 * 5` | version-day.md | 手册就绪，待建 cron |
| 程序/策划/美术 worker | agent-dev 等 | 独立 claude 进程（`studio-worker launch` 派发） | worker-common.md | ✅ 执行层v2 |

## 建岗指令（开新对话后原样发一句）

- **日报官**：`读 /Volumes/BigDisk/Studio/kernel/skills/AGENTS.md，按其中日报官规格创建定时任务`
- **Inspector**（token 配好后）：`读 /Volumes/BigDisk/Studio/kernel/skills/AGENTS.md，按其中 Inspector 规格创建定时任务`
- **Scout**（token 配好后）：`读 /Volumes/BigDisk/Studio/kernel/skills/AGENTS.md，按其中 Scout 规格创建定时任务`
- **版本日官**：`读 /Volumes/BigDisk/Studio/kernel/skills/AGENTS.md，按其中版本日官规格创建定时任务`
- **新项目子PM**（P5 起）：`读 /Volumes/BigDisk/Studio/kernel/skills/AGENTS.md，按其中子PM规格为 <PID> 创建定时任务（错峰：<分钟位>）`

## 各岗 cron 提示词模板（创建时原文复制）

通用骨架（占位符按岗替换）：

```
你是虚拟工作室的<角色>（身份 <账号>）。执行一次<角色> tick：
读 /Volumes/BigDisk/Studio/kernel/skills/<手册> 并严格按它执行（唯一剧本，不要即兴发挥）。
前置自检失败（无 token / 拿不到锁）→ 按剧本结束，不硬来。收尾按剧本必做（锁/日志/心跳）。
```

- 子PM·POLY：手册 sub-pm.md，PID=POLY，锁 `tick-POLY`，板面 `YT_ACCT=agent-pm ~/bin/yt -P POLY`。
- 日报官：手册 digest.md，只读+告警评论，产物 kernel/metrics/digest/。
- Inspector：手册 inspector.md，锁 `inspector`，草稿债单 ≤3/日。
- Scout：手册 scout.md，锁 `scout`，草稿情报单 ≤5/日（STUDIO 项目）。
- 版本日官：手册 version-day.md，锁 `version-day`，push 只认 approve-push-batch。

## Worker（执行层：独立 Claude Code 进程，一单一命，无 cron 无对话）

- 派发：子 PM 在 G1 断言全绿后执行 `~/bin/studio-worker launch <单号> <泳道>`——脚本自动从单据字段组装自包含任务书（身份按 Type 路由、需求、冻结验收命令、仓库、分支、REPORT 路径），后台拉起 `claude -p --dangerously-skip-permissions`，登记 kernel/workers/<单号>.json。
- 监控：PM 每 tick 用 `studio-worker status` 查活（RUNNING/DONE/DEAD）；心跳超 90 分钟 kill 回收（sub-pm.md 第 2 步）。
- 收割：REPORT 落盘即 DONE；PM 读报告 → run-gate 复跑 → G2 判定（sub-pm.md 第 7 步）。
- 权限说明：worker 进程对仓库有完全读写（--dangerously-skip-permissions），与原 spawn 模式权限等同；范围红线靠"超范围=升轨+QA 加测"兜底。

## 岗位交接须知

- 手册更新 = 改 kernel/skills/ 对应文件即可，cron 提示词不用动（文件为准）。
- 停岗 = 在宿主对话里删定时任务；岗位自身有停车机制（无活零副作用）。
- 新账号上岗：YouTrack UI 建 token → 写入 ~/.config/polymatch3/youtrack.json 的 agents → 从 youtrack-ids.json 的 new_accounts_no_token_yet 里移除。
