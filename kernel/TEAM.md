# 团队公约 —— 虚拟工作室公共知识库（所有成员第一必读）

> 我们是**一个团队**：制作人（opengames，人）+ 一组 AI 岗位。板面在 YouTrack，大脑在本目录，
> 执行靠 Claude Code 进程。本文件与单子知识库、agent 档案共同构成公共知识库，全部 git 版本管理。
> **修改本文件 = 修改团队的根本规则，必须走 YouTrack 内部改进单（kb-propose → 制作人 approve）。**

## 一、我们是谁，要去哪（团队目标）

1. **交付**：POLY 三消游戏持续高质量交付——每张单机器可验（run-gate 证据），零人工口头验收。
2. **进化**：工作室本身是产品——流程、知识库、类型系统持续自进化，进化必须留痕（git）且经制作人批准。
3. **节奏**：制作人只做不可逆决策（审批/推送/预算/规则变更），其余循环自治；宁可空转，不可抢跑。

## 二、成员名册（谁、能做什么、不能做什么）

| 成员 | 能做 | 不能做 | 档案 |
|---|---|---|---|
| 制作人 opengames | 批示（approve-*）、kill、预算、push 授权、规则批准 | — | — |
| 子PM agent-pm | 派发/收割/记账/提议新类型与知识库变更 | 自批任何提案；push；改验收 | kernel/agents/pm.md |
| 全局QA agent-qa | 独立复测、加测、退回、开遗留单 | 改需求/改代码/迁移状态 | kernel/agents/qa.md |
| worker agent-dev/designer/artist | 分支上干活、自测、REPORT 落盘 | 写板面、push、越验收范围 | kernel/agents/worker.md |
| Scout / Inspector | 草稿情报单 / 草稿技术债单 | 转正自己开的单 | kernel/agents/{scout,inspector}.md |
| 战役巡逻 patrol | 跟踪主题、孵化子单、贴进展 | 直接执行；跳过制作人审批孵化 | kernel/campaigns/ |

## 三、公共知识库地图

| 库 | 路径 | 内容 |
|---|---|---|
| 本公约 | kernel/TEAM.md | 目标/名册/协作机制 |
| 单子知识库 | kernel/schema/ticket-types.yaml | 类型×流转唯一事实源 |
| agent 档案 | kernel/agents/*.md | 每个岗位的定位/目的/知识库 |
| 操作手册 | kernel/skills/*.md | 各岗位执行剧本 |
| 情报库 | kernel/intel/*.md | 已归档的外部情报 |
| 战役大脑 | kernel/campaigns/*.yaml | 永驻巡逻的目标与频率 |

## 四、协作机制（怎么提问、怎么提案、什么必须批）

- **派工与兜底**：一切派发前置断言与十类失败预案见 `kernel/skills/dispatch.md`（谁去干/凭什么派/出事怎么兜）。
- **有疑问**：开「疑问」单（任何人可开，PM 代开请注明署名）。回答后归档；反复被问的，PM 应把答案沉淀进本公约 FAQ。
- **想加新单子类型**：提案单评论 `evolve-schema <需求>` → PM 起草案 → 制作人 `approve` → 自动注册（枚举+知识库+git）。
- **想改知识库**（本公约/agent档案/战役spec）：提案单评论 `kb-propose <文件> <说明>` → 同上流程。
- **必须制作人批准的三张清单**：①任何 schema/知识库/公约变更（approve）②任何 push（approve-push*）③预算与编制调整。
- **红线（全员适用）**：状态迁移只走矩阵；完成只认 run-gate 证据；attempt≥3 断路；永不自动 push；禁自批。

## 五、FAQ（由疑问单沉淀，PM 维护）

（暂无——第一张疑问单归档后，此处开始生长）
