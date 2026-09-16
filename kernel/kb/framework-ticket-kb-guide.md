# [框架] 单子知识库使用指南

> 状态：草稿 ｜ 采集：STUDIO-14，2026-09-17 ｜ 源：kernel/schema/ticket-types.yaml（v2，唯一事实源）
> 回答两个问题：**怎么读**（人/agent 查流转）与**怎么改**（走 evolve 提案流）。

## 1. 它是什么

`kernel/schema/ticket-types.yaml` 是全工作室"类型×流转"的唯一事实源——所有 agent 与 studio-daemon **每次读取**（TEAM.md 知识库地图）。原则（文件头注）：

1. 状态 = 机器可验证的事实（已派发=进程存在；证据就绪=REPORT+run-gate 绿），不是人的心情词。
2. 状态迁移只由 daemon 依机器事件推进；待批只由制作人评论推进。
3. 级别（字段沿用"轨道"）= 介入深度旋钮：交付族 L0-L3 管审批次数；治理族 G1-G4 管变更重量。
4. 同一状态可在一条流里出现两次（如 L3 的两个待批），语义由位置+批示指令区分。
5. 修改本文件走 evolve-schema（治理族提案单）→ 制作人 approve。

## 2. 结构导览（怎么读）

| 节 | 内容 |
|---|---|
| `states` | 状态全集（新单/待批/已派发/证据就绪/复验通过/已交付…；后两段旧态保留给历史单） |
| `levels` | 交付 L0 自动/L1 首批/L2 常规/L3 特护（各带审批位说明）；治理 G1 知识~G4 红线 |
| `families` | 五族一句话定位：交付/知识/治理/运营/事件 |
| `types` | 每类型一行：族/定位/工种/流转（需求/缺陷/技术债/疑问/情报/提案/复盘/战役/事故） |
| `flow_by_level` | 交付族按级别状态流（L3 两段派发注释在此） |
| `type_edges` | 非交付族的专属边（如 提案: 草稿→待批→实施中→观察窗→结案） |
| `rollback_edges` | 退回边：证据就绪/复验通过→已派发（attempt+1）；已派发→待批（断路专属，attempt≥3 时代码触发） |

**查一张单怎么走**：先看 `types` 定族 → 交付族查 `flow_by_level`（按级别），其余族查 `type_edges` → 合法迁移 = 流上相邻 ± `rollback_edges`。daemon 侧对应 statemachine.py（`allowed()`/`next_states()`），schema 文件损坏时回退内置等价表，循环不死。

## 3. 类型速查（types 节）

- **需求**（交付）：做东西进仓库（原核心/业务/策划/美术合并），工种 程序|策划|美术 路由 worker，按级别流转。
- **缺陷**（交付）：修坏的，须回链引入源。
- **技术债**（交付，默认 L1）：还欠的（Inspector/QA 来源），草稿→新单 promote 入口。
- **疑问**（知识）：问清楚（任何成员可开，PM 代开须署名）：新单→待答→已答→已沉淀。
- **情报**（知识）：知道了（外部发现）：草稿→发现→评估中→已归档。
- **提案**（治理，级别 G1-G4）：改框架的唯一载体（evolve-schema/kb-propose/roster-propose 三指令）。
- **复盘**（治理）：从事故与断路学习，结论转提案。
- **战役**（运营）：永驻巡逻孵化子单。
- **事故**（事件）：急事通道，关闭前必须挂复盘单。

## 4. 怎么改（evolve 流，五步）

1. 制作人在 STUDIO 内部改进单评论 `evolve-schema <需求描述>`（仅 opengames 本人有效，代码校验作者）。
2. daemon evolve 扫描（每 10 分钟错峰）→ schema 架构师岛起草新类型（JSON：type/yaml 条目/type_edges/理由）→ 校验（定位/目的/流转必填；专用流必须给边且边引用已知状态；重名拒绝）→ 贴出 SCHEMA-PROPOSED 草案 + 单据进待批。
3. 制作人回 `approve`（必须**晚于**提案评论——禁预埋批准）。
4. daemon 应用：YouTrack 枚举注册（admin token 守门操作，全留痕）→ 写 schema yaml → git commit（"evolve-schema: 新增类型…"）→ statemachine 热重载 → 全工作室即刻生效 → 进 7 日观察窗（自评盯指标，恶化回滚）。
5. 观察窗 7 天无恶化 → 自动结案。

修改**现有**类型暂不支持自动流——先人工改 yaml（evolve.py _validate 拒绝重名）。知识库其他文件（TEAM/agent 档案/战役 spec）走同形的 `kb-propose <文件> <说明>`（白名单内）。

## 5. 相关联动

- 控制台 `/api/schema` 直接渲染本文件 + TEAM.md + agents 档案摘要（web.py）。
- 迁移合法性强制的另一入口：`~/bin/yt next-state`（bash 侧矩阵校验）。

## 源

- /Volumes/BigDisk/Studio/kernel/schema/ticket-types.yaml（全 70 行，updated 2026-09-16）
- /Volumes/BigDisk/Studio/studio-daemon/studio/statemachine.py、studio/evolve.py（读取/热重载/提案应用）
- /Volumes/BigDisk/Studio/kernel/agents/pm.md（拓展权说明）
