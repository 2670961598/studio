# [框架] 团队公约与红线

> 状态：草稿 ｜ 采集：STUDIO-14，2026-09-17 ｜ 源：kernel/TEAM.md（公约）、CHARTER.md（宪章）
> 本文是总览快照，**不是**事实源——冲突时一律以源文件为准。

## 1. 我们是谁，要去哪（TEAM.md 第一节）

1. **交付**：POLY 三消游戏持续高质量交付——每张单机器可验（run-gate 证据），零人工口头验收。
2. **进化**：工作室本身是产品——流程/知识库/类型系统持续自进化，进化必须留痕（git）且经制作人批准。
3. **节奏**：制作人只做不可逆决策（审批/推送/预算/规则变更），其余循环自治；**宁可空转，不可抢跑**。

宪章三铁律（CHARTER.md §0）：**状态外置**（一切进行态在 YouTrack/文件，崩溃后下个 tick 无损接手）、**机器断言**（完成只认 run-gate 落盘证据，不认 agent 自述）、**两级承包**（功能活一单一命；更大需求拆单上板，不搞 agent 套 agent）。

## 2. 成员名册与权限边界（TEAM.md 第二节）

| 成员 | 能做 | 不能做 |
|---|---|---|
| 制作人 opengames | 批示（approve-*）、kill、预算、push 授权、规则批准 | —（唯一批准源） |
| 子PM agent-pm | 派发/收割/记账/提议新类型与知识库变更 | 自批任何提案；push；改验收 |
| 全局QA agent-qa | 独立复测、加测、退回、开遗留单 | 改需求/改代码/迁移状态 |
| worker agent-dev/designer/artist | 分支上干活、自测、REPORT 落盘 | 写板面、push、越验收范围 |
| Scout / Inspector | 草稿情报单 / 草稿技术债单 | 转正自己开的单 |
| 战役巡逻 patrol | 跟踪主题、孵化子单、贴进展 | 直接执行；跳过制作人审批孵化 |

批示只认 opengames 账号的评论（代码强制校验作者，agent 代发无效）。

## 3. 协作机制（TEAM.md 第四节）

- **派工与兜底**：一切派发前置断言与十类失败预案在 kernel/skills/dispatch.md。
- **有疑问**：开「疑问」单（任何人可开，PM 代开须署名）；回答后归档，反复被问的沉淀进公约 FAQ。
- **想加新单子类型**：提案单评论 `evolve-schema <需求>` → PM 起草案 → 制作人 approve → 自动注册（枚举+知识库+git）。
- **想改知识库**（公约/agent 档案/战役 spec）：`kb-propose <文件> <说明>` → 同上流程。
- **必须制作人批准的三张清单**：①任何 schema/知识库/公约变更 ②任何 push（approve-push*）③预算与编制调整。

## 4. 审核与完工标准（TEAM.md 第五节，基石工程铁律）

- **每次改动都必须交叉审核**：改完 → 多 agent 并行审核（不同 lens）→ P0/P1 修完 → 再跑一轮验证审 → 才算完工。**无审核的改动视为未完成**。
- **git 是唯一改动史**：每一次改动完整提交，提交信息说明改了什么与为什么；禁止未经 git 的"顺手改"。
- **审查基准（制作人裁定）**：个人本机辅助开发，不考虑对外安全（CSRF/鉴权/网络暴露降级 P3 可选）；聚焦正确性、可靠性、崩溃恢复、数据完整性、成本。

## 5. 红线汇总（全员适用）

1. 状态迁移只走矩阵（yt next-state / statemachine 校验），LLM 无权跳态串轨。
2. 完成只认 run-gate 证据，不认任何 agent 自述。
3. attempt≥3 断路，只等制作人（制作人批示=新授权，attempt 清零）。
4. **永不自动 push**（push 只凭 approve-push / approve-push-batch 评论记录）。
5. 禁自批：提案与执行之间必须隔制作人一次 approve。
6. worker 不写板面、不动验收命令；QB/验收范围外文件禁触碰（超范围=升轨）。
7. LLM 岛输出将被 bash 执行的，必须过消毒白名单；循环不因岛失败停摆。

## 6. 修改公约的途径

修改 TEAM.md = 修改团队根本规则，必须走 YouTrack 内部改进单（kb-propose → 制作人 approve）；宪章 CHARTER.md 同理（"内部改进"单 + 制作人批准）。

## 源

- /Volumes/BigDisk/Studio/kernel/TEAM.md（全 53 行）
- /Volumes/BigDisk/Studio/CHARTER.md（§0 铁律、§1 编制、§2.6 指挥协议、§6 闸门）
- /Volumes/BigDisk/Studio/kernel/skills/dispatch.md（派工与兜底）
