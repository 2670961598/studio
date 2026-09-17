# [全局] AGENTS 全局规范

> 状态：草稿 ｜ 采集：STUDIO-14，2026-09-17 ｜ 层：机器级

## 1. 采集结论：本机无机器级全局规范文件

以下位置在采集时点（2026-09-17）均**不存在**：

- `~/.claude/CLAUDE.md`（Claude Code 全局用户记忆/约定）
- `~/AGENTS.md`、`~/.claude/AGENTS.md`（全局开发环境规范）

即：本机没有跨仓库生效的 AGENTS/CLAUDE 全局层。所有规范都落在**仓库级**与**工作室知识库**两层。

## 2. 现行规范的实际分层

| 层 | 载体 | 谁读 |
|---|---|---|
| 工作室知识库 | `/Volumes/BigDisk/Studio/kernel/`（TEAM.md / schema / agents / skills / intel / campaigns） | 全部 agent 与 daemon，"改文件即改行为" |
| 仓库级 AGENTS.md | 各目标仓库根目录（如有） | worker 开工必读（kernel/skills/worker-common.md 第 1 条；worker prompt 模板同样注入，源：studio-daemon/studio/workers.py WORKER_TEMPLATE） |
| 仓库级 CLAUDE.md | 各仓库（如 POLY 项目仓） | 进入该仓的 Claude 会话自动加载 |

## 3. 工作室侧的"AGENTS 总索引"

`kernel/skills/AGENTS.md` 是编制与手册总索引（架构 v4 说明 + 编制一览 + 建岗指令 + 岗位交接须知）。注意它与"本机全局 AGENTS.md"不是一回事——它是工作室知识库的入口文件，详见 [framework-skills-index.md](framework-skills-index.md)。

## 4. 对新仓库/新岗位的启示（事实性记录）

- onboarding 一个新项目时，规范注入点 = 项目仓 AGENTS.md + kernel/skills 项目专属手册（CHARTER.md §3 `projects/<PID>/skills/`），**没有**机器级全局层可依赖。
- 若制作人未来设立 `~/.claude/CLAUDE.md` 或全局 AGENTS.md，本 Article 需随之刷新（走 kb-propose）。

## 源

- 采集命令：`ls ~/.claude/CLAUDE.md ~/AGENTS.md ~/.claude/AGENTS.md`（三者均 No such file，2026-09-17）
- kernel/skills/worker-common.md（开工前必读目标仓库 AGENTS.md）
- kernel/skills/AGENTS.md（工作室手册总索引）
