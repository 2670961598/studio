# 知识库 Article 库（kernel/kb/）

> 本目录是工作室知识库的 **Article 层**：对"全局环境"与"框架本身"的结构化说明文，
> 供新会话/新岗位/制作人快速建立全局图景。与既有知识库的分工：
> `kernel/schema/`（类型×流转事实源）、`kernel/agents/`（岗位档案）、`kernel/skills/`（执行剧本）、
> `kernel/intel/`（外部情报）、`kernel/kb/`（本目录，环境与框架总览）。
>
> Article 状态为**草稿**（采集时点快照，源文件演进后需人工/提案刷新）。
> 修改走治理族提案（kb-propose → 制作人 approve）。

## 索引

| 层 | Article | 文件 | 主要源 |
|---|---|---|---|
| 全局 | 本机开发环境与工具链 | [global-dev-env-toolchain.md](global-dev-env-toolchain.md) | ~/bin/、~/.config/polymatch3/ |
| 全局 | AGENTS 全局规范 | [global-agents-spec.md](global-agents-spec.md) | ~/.claude/、各仓 AGENTS.md |
| 框架 | studio-daemon 架构总览（五族×级别×AI原生状态机） | [framework-daemon-architecture.md](framework-daemon-architecture.md) | studio-daemon/studio/*.py |
| 框架 | 团队公约与红线 | [framework-team-redlines.md](framework-team-redlines.md) | kernel/TEAM.md、CHARTER.md |
| 框架 | 单子知识库使用指南 | [framework-ticket-kb-guide.md](framework-ticket-kb-guide.md) | kernel/schema/ticket-types.yaml |
| 框架 | 各角色档案索引（定位/权限/反馈） | [framework-agent-profiles.md](framework-agent-profiles.md) | kernel/agents/*.md |
| 框架 | 操作手册索引 | [framework-skills-index.md](framework-skills-index.md) | kernel/skills/*.md |
| 框架 | 路线图与决策记录 | [framework-roadmap-decisions.md](framework-roadmap-decisions.md) | studio-daemon/ROADMAP.md、git 史、kernel/intel/ |
| 框架 | 部署与运维（launchd/看护/控制台） | [framework-deploy-ops.md](framework-deploy-ops.md) | launchd plist、~/bin/studio-daemon-launch.sh |

采集批次：STUDIO-14（2026-09-17；同日 attempt2 做了三路并行交叉核验，修正 8 处：模块表补 runtime.py、部署篇引用出处与术语、红线出处口径、配置遗留目录等。制作人修正冻结验收命令后重派复核，基线增补至 15cf624：部署篇 plist PATH/launchctl 语法、架构篇补 LLM 岛可执行解析/失败限速日志/DoD 纪律与口语批准兜底、路线图篇补 P0 决策记录）。敏感值（token/password/URL）一律脱敏，只记结构。
