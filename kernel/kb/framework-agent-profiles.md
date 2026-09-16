# [框架] 各角色档案索引（定位/权限/反馈）

> 状态：草稿 ｜ 采集：STUDIO-14，2026-09-17 ｜ 源：kernel/agents/*.md（5 份档案）+ kernel/TEAM.md 名 roster 节
> 每个岗位一个 md 档案——定位/目的/知识库三段式；**改文件即改行为**（每次 tick/派发重读）。

## 档案一览

| 档案 | 角色 | 定位（一句话） | 目的 | 权限边界（不能做） |
|---|---|---|---|---|
| kernel/agents/pm.md | 子PM agent-pm | 项目第一责任人：拆解/派发/收割/记账/推状态机；不写代码 | 每张单以最短合法路径走向已关闭，每步有机器证据 | 不审批自己的活；无 push 权 |
| kernel/agents/qa.md | 全局QA agent-qa | 与作者物理隔离上下文的验证者 | 每张待测试单获一次独立复测（冻结验收复跑+一条加测），证据落盘 | 不改需求/不改代码/不迁移状态；只信自己跑出来的输出 |
| kernel/agents/worker.md | worker agent-dev/designer/artist | 一单一命的手艺人（Claude Code 独立进程，任务书机器组装） | 在 feature/<单号> 分支完成需求、自测、REPORT 落盘 | 不写板面、永不 push；身份按 Type 路由 |
| kernel/agents/scout.md | Scout agent-scout | 广域无主题的外部雷达（有主题归"战役"单） | 每日把值得知道的外部变动变成带链接+置信度的草稿情报单 | 只开草稿；promote 只由制作人触发；低置信不开单 |
| kernel/agents/inspector.md | Inspector agent-inspector | 全项目代码体检医生，只诊断不动刀 | 每日把量化债务变成草稿技术债单（≤3/日） | 只开草稿；偿还决策归制作人 |

另有无档案岗：制作人 opengames（人，唯一批准源，见 TEAM.md 名册）；战役巡逻 patrol（档案在 kernel/campaigns/*.yaml，非 agents/）。

## 各档案的知识库指向（反馈回路）

档案的"知识库"节列出该岗每次工作必读的文件——这是工作室"改文件即改行为"的机制：

- **pm**：kernel/schema/ticket-types.yaml（类型真源）+ kernel/skills/sub-pm.md（已退役，现行 dispatch.md）+ kernel/skills/AGENTS.md + kernel/intel/ + CHARTER.md
- **qa**：schema（类型怎么流转/判定）+ kernel/skills/qa-gate.md（已退役，现行=v2 收割链内联复测）
- **worker**：kernel/skills/worker-common.md（REPORT 格式硬约束）+ schema（类型语义/边界）+ 目标仓库 AGENTS.md（开工必读）
- **scout**：kernel/intel/scout-topics.md（题材清单）+ kernel/skills/scout.md + schema 情报条目
- **inspector**：kernel/skills/inspector.md + schema 技术债条目

## 拓展权（自进化入口，pm.md 专有节）

PM 发现现有类型覆盖不了的重复需求时：开提案单 + 提请制作人评论 `evolve-schema <需求>`；指令必须 opengames 本人发出（代码强制校验）。禁自批：提案与执行之间必须隔制作人一次 approve。编制变更（增删岗位）暂以 kb-propose TEAM.md（G3 重量）实现。

## 修改档案的途径

档案属于团队知识库白名单（evolve.py KB_ALLOW = TEAM.md + agents/*.md + campaigns/*.yaml）：提案单 `kb-propose <文件名> <说明>` → 制作人 approve → 知识库编辑岛起草 → approve 后写文件 + git commit，即刻生效。

## 与 YouTrack 账号的对应

档案角色 ↔ ~/.config/polymatch3/youtrack.json 的 agents 节（token 分文件 600；采集时点在册：agent-core/agent-game/agent-qa/agent-pm）。新账号上岗流程见 kernel/skills/AGENTS.md 末节。

## 源

- /Volumes/BigDisk/Studio/kernel/agents/{pm,qa,worker,scout,inspector}.md（全文）
- /Volumes/BigDisk/Studio/kernel/TEAM.md §二（名册）
- /Volumes/BigDisk/Studio/studio-daemon/studio/evolve.py（KB_ALLOW 白名单）
