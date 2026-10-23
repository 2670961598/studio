# 53 · todos.dev 全景对比与 Studio Next 改进建议

> 性质：竞品 / 前沿对比分析（探索件，不是实现单；不构成任何实现承诺）。
> 方法：todos.dev 官方文档实读（2026-10-23）＋ 本仓 docs/代码实读 ＋ 前沿产品公开资料。
> 外部事实给链接，仓内事实给文件/行号；营销话术不作为事实，查不到的标「未核实」。
> 结论先行：**todos.dev 是一个成熟的单意志工位产品，Studio Next 是一个尚未证明的多意志
> 组织框架。** 前者优化一个人的产出，后者试图让一个组织在负责人离开后仍能运转。
> 两者不是同一层产品，不能逐 feature 对标；但 todos 的「工位工程学」是 Studio 必须补齐的
> table stakes，Studio 的「制度层」则是 todos 当前产品模型不做的潜在空位。

---

## 〇、三句话结论

1. **品类不同**：todos 卖的是「一个人 + 一群 agent 的指挥台」，成功标准是「我更快拿到可验收的
   变更」；Studio 卖的是「一家公司的运行制度」，成功标准是「负责人不在场，组织仍按章程产出
   有证据的交付」。
2. **各有真优势**：todos 领先在工位工程（worktree / checkpoint / 运行时广度 / 记忆 / 技能 /
   计划与变更评审 / 桌面与移动 / 接入生态）；Studio 领先在制度抽象（公司＝git 目录、岗位/工号/
   层级、L0-L5 装配、wkey 写闸、证据四要件、台账、多公司、自托管）。
3. **Studio 当前最大的风险不是 todos 抢市场，而是「组织」停留在配置和工单路由**：agent 没有
   被授予可行使的权限、没有可积累的记忆与技能、没有可恢复的工位，负责人仍是唯一意志源。
   因此下一步不是把组织画得更大，而是先补「神经」与「记忆」，再谈「更大组织」。

---

## 一、先校准：两个不同的 job

### 1.1 一句话定位

| | todos.dev | Studio Next |
|---|---|---|
| 一句话 | The task-driven workspace for humans and agents | AI 公司框架：把一家公司建模成代码外部的一个 git 目录 |
| 服务的 job | 「我一个人，如何同时推进很多 agent 任务，并在关键点做决策」 | 「我如何把意志、权限、预算、人事交给一个组织，让它离开我也能运转」 |
| 成功定义 | 任务完成、变更可验收、我少花注意力 | 组织持续产出、证据可审计、我只需在例外上出手 |
| 意志源 | 单点：你（owner） | 设计上网状（实现上仍集中在 daemon） |
| 组织模型 | Team + 角色（admin/member）+ agent 角色描述 | 公司 2-9 级 + 部门树 + 工号 + 汇报线 + 岗位 + 编制 |
| 工作单位 | Todo → Build → Turn | Work（单据）→ 派发 → Attempt → Session |
| 事实源 | 平台库 + Git + 对象存储 | 协作平台 + 公司 git 目录 + SQLite 台账 |
| 运行位置 | 本机 / 多机 / 平台云沙箱 | 本地 daemon；可挂多公司；不做托管 |
| 商业形态 | SaaS，Free / Pro $19 per team | MIT 开源，暂无定价，不做托管 |

### 1.2 doctrine 验证：代理权判断对了一半

制作人 2026-10-23 的 doctrine（[49-制作人决策包.md](49-制作人决策包.md) §「竞争定位 doctrine」）：
「todos.dev 本质和 zcode/claude/codex desktop 没区别——你和其中一个 agent 对话，他派子 agent，
本质不是团队，还是辅佐人来工作。区别在代理权在谁手里。」

**对的一半**：判定标准抓得很准。todos 的 agent 是「delegate tools」——有名字、有角色、有记忆、
有技能，但没有独立于 owner 的意志；Chief 可以建议、可以派活，但最终授权与验收仍在人手里。
它没有部门、层级、编制、预算权、人事权，也没有「部长批策划 / QA 打回工程 / 财务唤醒人事」
这种**制度化的对手方**。这是结构性的，不是 feature 缺口。

**需要修正的一半**：todos 并不是「一个 agent 派子 agent」那么简单。它已经有：
Chief（常驻编排 agent）、多个 agent、独立 AI review、topic/watch/digest、agent 私有记忆、
团队技能库、per-agent 权限开关、machine 级双边同意、MCP 进出。它是一个**单主多代理协作系统**，
不是单 agent。把它说成「只是外骨骼」会低估对手，也会让 Studio 错过可借的东西。

**更准确的分界**：不是「多 agent vs 单 agent」，而是——
- **principal（委托人/意志源）的数量与权威结构**：todos 只有一个 principal（owner），
  agent 是受托工具；Studio 试图让多个岗位成为「准 principal」，但目前权威仍集中在 daemon。
- **权威能否被制度化地分配、行使、追责**：todos 有「人给 agent 开工具开关」，没有「组织把
  审批权、预算权、人事权按岗位授予，并可按额度/条件/任期行使」。
- **离开 principal 后是否继续运转**：todos 可以在被授权的 gate/计划内自动跑（例如把
  Confirm/Review 委托给 Chief），但它没有独立于 owner 的预算、人事、授权结构，长期自治
  不是它的设计目标；Studio 的目标是会，但目前尚未被实证。

所以 doctrine 应升级为一句更可操作的话：

> **代理权不在「有没有组织架构图」，而在「权威是否可被制度化地授予、按范围行使、留下证据、
> 可被撤回与追责」。** 组织架构图只是骨架；授权图才是神经。

### 1.3 四层身体模型：骨架 / 肌肉 / 神经 / 记忆

用身体做比喻，可以一眼看出两家的位置：

| 层 | 是什么 | todos.dev | Studio Next 现状 |
|---|---|---|---|
| **骨架** | 组织、岗位、层级、编制、汇报线 | 很薄：Team + 角色；无部门/层级/编制 | **强**：公司目录、2-9 级、部门树、工号、人事档案、报表 |
| **肌肉** | 执行、工位、队列、并发、预算、断路 | **很强**：worktree/checkpoint/多机/云沙箱/近 20 运行时 | 中：daemon/预算/断路/收割强；工位隔离与可恢复执行弱 |
| **神经** | 授权、审批、联签、升级、对手方、追责 | 中：人给工具开关 + 两个 gate；无制度授权图 | **弱**：wkey 只有六动作；状态推进 daemon 独占；无授权图/quorum |
| **记忆** | 技能、教训、个人记忆、组织知识 | **强**：记忆/技能/话题/压缩/增量读 | 弱：L0-L5 强，但 lessons 空、无 per-agent 记忆、无技能库 |

一句话：**todos 是「肌肉 + 记忆」很强、「骨架 + 神经」很薄；Studio 是「骨架」很强、
「肌肉」中、「神经 + 记忆」还没长出来。** 下一阶段的重点不是继续加骨架，而是补神经与记忆。

### 1.4 2×2 定位

```
                     制度深度（组织/治理/审计）
                              高
                              │
          MetaGPT/ChatDev     │        ★ Studio Next 目标位
          （组织模拟，缺执行） │        （制度 × 工位）
                              │
          ────────────────────┼──────────────────── 执行深度（工位/运行时）
                              │
          Studio 现状 ●       │        ● todos.dev
          （制度设计强，       │        （工位极强，
            工位/记忆弱）      │          制度薄）
                              低
```

- **左下**：有制度设计、缺工位与记忆——当前 Studio 的真实位置。
- **右下**：工位极强、制度薄——todos / Conductor / Claude Code / Codex 一类。
- **左上**：组织模拟，缺真实执行与问责——MetaGPT / ChatDev 一类。
- **右上**：制度 × 工位都强——目前没有明显占位者。Studio 的设计指向这里，
  但实现尚未到达；这是「潜在差异化位置」，不是「已占据的位置」。

---

## 二、八层对比

### 2.0 一页纸：谁领先什么

| 维度 | 领先方 | 一句话判断 |
|---|---|---|
| 工位工程 | **todos** | worktree/checkpoint/清理/多机/运行时广度，已产品化 |
| 组织抽象 | **Studio** | 公司=目录、2-9 级、部门/工号/人事/报表，todos 结构上没有 |
| 执行可靠性 | **Studio** | 确定性 FSM、预算 reserve/settle、断路、收割四要件、证据 |
| 交互产品 | **todos** | 一个指挥台、桌面/移动、计划/变更/评审/回退 |
| 记忆/技能 | **todos** | 有界记忆 + 技能库 + 话题/压缩；Studio 尚未接线 |
| 治理写闸 | **Studio** | wkey、署名、唯一写入者、append-only 台账；todos 是平台级权限 |
| 授权机制 | **都不完整** | todos 有工具开关无制度授权；Studio 有 FSM 无授权图/quorum |
| 生态广度 | **todos** | 近 20 运行时、MCP 进出、OAuth 连接、桌面/移动/SaaS |
| 分发/商业 | **todos** | Free/Pro、云 credits、公开 docs；Studio 是开源框架，未定价 |
| 自主性 | **都未证明** | todos 单 principal；Studio 目标多 principal，但 v1.0 尚未跑出 7 天 |

这张表决定了策略：**不要在 todos 领先的列上打正面战；要在它结构上不会做的列上建立不可替代性，
同时把工位/记忆这两列补到「不拖后腿」。**

### 2.1 本体论：产品对象 vs 制度对象

| 维度 | todos.dev | Studio Next |
|---|---|---|
| 核心名词 | Team、Project、Todo、Build、Agent、Chief、Topic、Machine、Skill、Memory、Connection、Secret、Document、Schedule | Company、Org、Work、Executor、Ledger、Contract |
| 核心动词 | 建单、派发、计划、确认、构建、评审、合并、重跑、回退 | 派、批、变 |
| 名词性质 | 用户可操作的产品对象 | 制度可治理的原语 |
| 扩展方式 | 加对象/加字段/加集成 | 概念准入闸：必须映射成某名词的实例/字段/模板/动词配置 |
| 优点 | 直观、可卖、上手快 | 自洽、可治理、可跨公司复用 |
| 风险 | 对象会膨胀，组织语义薄 | 过度自洽会把新能力压扁，实现时找不到位置 |

**关键判断：不要 import todos 的名词，要把它映射进 Studio 的名词。**

| todos 的对象 | 应映射到 Studio 的什么 | 不要做什么 |
|---|---|---|
| Todo | `Work`（单据） | 不要新增 Todo 名词 |
| Build / Turn | `Work` 的执行面：`WorkAttempt`（子实体/字段） | 不要把 Build 升成新名词 |
| Plan / Changes / Verification | `Work` 的 artifact（带版本/哈希/评审状态） | 不要做通用文档系统 |
| Agent | `Org` 的岗位/工号 + `Executor` 的运行时 | 不要把 Agent 当独立名词 |
| Chief | `Org` 的协调岗（宰相/调度岗）+ 指挥台视图 | 不要造「CEO agent」新角色 |
| Topic / Watch | `Ledger`/`Work` 的派生视图（事项、摘要、关注） | 不要新增 Topic 事实源 |
| Machine | `Executor` 的 placement（本地/远程/云） | 不要新增 Machine 名词 |
| Skill | `Contract` 的知识资产（SKILL.md + 版本 + 来源 + 证据） | 不要做成私有格式 |
| Memory | `Org` 的岗位记忆（有界、可审计、可过期） | 不要让 agent 直接写文件 |
| Connection / Secret | `Contract`/`Executor` 的凭据与外部工具授权 | 不要自研 OAuth 生态 |
| Document | `Work` 的 artifact / `Contract` 的模板 | 不要做通用编辑器 |

**对概念准入闸的建议**：六名词是对的，但要为每个名词显式定义「扩展面」——
`Company` 的 schema/迁移、`Org` 的授权图/岗位记忆、`Work` 的 attempt/artifact、
`Executor` 的 placement/能力声明、`Ledger` 的投影/审计、`Contract` 的 skill/acceptance/版本。
否则实现时会把「记忆/技能/工位」硬塞进现有字段，最后变成四不像。

### 2.2 工作单元：Todo/Build/Turn vs 单据/Attempt/Session

| | todos.dev | Studio Next |
|---|---|---|
| 持久工作单元 | Todo（可重跑，多个 Build） | Work（单据，可多次 attempt） |
| 执行单元 | Build：独立分支 + worktree + turns + 制品 + run history | Attempt：目前主要是计数；Session 是归档 |
| 人工决策点 | Confirm（计划）/ Review（变更） | 状态机 + 三态闸门 + 验收闸门 |
| 制品 | Plan / Changes / Verification，版本化、可 diff、可恢复 | REPORT + summary.json + gate log + 证据文件 |
| 恢复 | rewind 到任意 checkpoint；Continue / Start over | resume（设计）/ 重派；无 checkpoint/rewind |
| 历史 | 每个 Build 的完整 run history | work_records/events；无统一时间线 UI |
| 合并 | 真 merge，冲突由 agent 解 | **v0 模拟合并，无真 git 操作**（[engine.ts:118](../apps/daemon/src/engine/engine.ts)、[:2087](../apps/daemon/src/engine/engine.ts)） |

**差距的本质**：todos 的 `Build` 是**可恢复的执行实体**；Studio 的 `Attempt` 目前只是
「第几次派发」的计数。没有执行实体，就没有「计划评审 → 变更 → 回退 → 再评审」，
也没有「同一单多方案」作为资产。

**建议**：把 `WorkAttempt` 升为 `Work` 的执行面（不是新名词）：
`{attempt, executor, workspace, branch, base, head, checkpoint, artifacts[], parentAttempt, status}`。
配套 `WorkspaceProvider` 端口（prepare/checkpoint/restore/merge/cleanup/status）。
这把「工位」从 daemon 内核解耦出来，本地/远程/云执行器都能实现。

### 2.3 执行与隔离：控制面强，工位面弱

| 能力 | todos.dev | Studio Next |
|---|---|---|
| 队列/领取 | machine claim + 并发槽（1-10） | daemon tick + 泳道租约 + 并发四闸 |
| 隔离 | 每个 Build 独立 worktree + 分支 `tds/conv-*` | 每个 attempt 一个 `.AIWS` 工作目录；**无分支/worktree** |
| 每轮落盘 | 每 turn checkpoint commit + push | 收割 REPORT/summary；无 git checkpoint |
| 中断/插话 | 部分运行时支持 turn 中 steer | 探针已证 dsh 可 steer（[34](34-dsh插件面与中途插话探针报告.md)），**未接线** |
| 断点恢复 | checkpoint/restore + 跨机 cold start | resume 设计（F1-15），无 checkpoint/rewind |
| 清理 | 7 天 TTL + 进程回收 | 无工位 TTL 清理；进程组可杀，无 stray 进程回收 |
| 凭据 | 每命令注入 Git 凭据；agent shell 无凭据 | env 全量透传（[42-§剧本 C](42-公司规范红队审视.md)）；wkey 六动作全集 |
| 只读计划 | Planning 强制只读，结束丢弃改动 | Blind 读面 + 验收闸门；无 plan 阶段 |
| 多机/云 | 多机集群 + 平台云沙箱 | 单 daemon；本地 execa |
| OS 沙箱 | 外部 runtime 明示「无沙箱、无审批」（平台文档原话） | **seatbelt 写域圈定原型 + wkey 写闸**（这一维 Studio 更前沿） |
| 数据主权 | 平台托管 + 云沙箱 | 本地/自托管，公司目录可移植（这一维 Studio 更强） |
| 控制面 | LLM Chief + 平台状态 | **确定性 FSM + 预算 + 断路 + 收割四要件 + 哨兵 + micro-judge** |

**结论**：Studio 的「控制面」比 todos 更强（确定性、可审计、预算/断路/证据），
但「工位面」弱一个代际。控制面是差异化，工位面是 table stakes——没有工位面，
控制面再强也只能跑「评论/报告型」工作，跑不了真正的代码交付。

**注意区分「隔离」与「沙箱」**：todos 的 worktree 是**文件系统/分支隔离**，不是 OS 沙箱；
它的外部 runtime 明确「无沙箱、无审批」。Studio 的 seatbelt/wkey 在「防越权/防泄漏」上更强，
但缺工位隔离。两者不是替代关系——**工位隔离 + OS 沙箱 + 写闸**要同时有，才既能并行又不越权。

**建议**：
1. `WorkspaceProvider` 端口：`prepare / checkpoint / restore / merge / cleanup / status`。
2. `Executor` 端口增三条可选能力：`interrupt(handle, msg, mode)`、`usage(handle)`、
   `resume(handle)`；dsh 用长驻 web profile 实现 turn 中 steer、SDK profile 实现 turn 间
   followup（todos 对 dsh 明确不支持 turn 中消息，这是一个可验证的差异化点）。
3. 先做 P0：per-attempt worktree + branch + checkpoint + merge + cleanup；边缘情况
   （跨机、冲突、断网、进程逃逸）随后补，不一次抄完 todos 的全部复杂度。

### 2.4 上下文、记忆、技能：制度知识 vs 工作知识

| 层 | todos.dev | Studio Next |
|---|---|---|
| 制度/章程 | Charter：人写，Chief 只读，每轮注入 | L0 框架 / L1 公司 / L2 组织 / 章程 / 部门 config |
| 角色 | Agent role（≤800 字），每轮注入 | 人事档案六节 + 岗位 + 汇报线 |
| 方法/技能 | **Skill 库**：SKILL.md、团队共享、版本、GitHub 导入、agent 可提案、默认技能 | **无技能库**；`skills` 只是人事标签（prompt L5 预留了 skills 层位，但无本体库） |
| 个人记忆 | **有界记忆**：100 条 / 10k 字符、团队/项目 scope、版本、过期、密钥扫描、管理员审计 | **无 per-agent 记忆**；只有人事档案「做过的事/自述」 |
| 教训 | 记忆 + 技能 + 话题摘要 | L4 `lessons` 字段存在，但 **v0 传空**（[prompt-assembly.ts:21](../apps/daemon/src/engine/prompt-assembly.ts)） |
| 话题/注意力 | Topic：独立上下文、brief、watch、digest、定时 check-in | 工单 + Matrix 房间 + 通知；无 topic/digest |
| 压缩 | 80% 自动压缩、prefix caching、增量读 | 依赖 executor 的 auto-compact；AGENTS.md 抗压缩；无压缩管理 |
| 隔离 | 评审 read-only；记忆私有 | **Blind 读面**（验证岗不看叙事）+ untrusted 消毒 + 分层指纹 |
| 知识检索 | 全局搜索、`/` 技能、记忆按需取 | `kb-search` 工具；L4 教训检索未接线 |

**结论**：todos 有「工作知识」（记忆/技能/教训/话题），Studio 有「制度知识」
（章程/岗位/人事/L0-L5）。两者缺一不可。

**隐私模型也相反**：todos 的记忆是 agent 私有、技能团队共享；Studio 的人事档案是
全公开（D5）、但没有私有工作记忆。理想态不是二选一，而是三层分开——
**人事/绩效公开、工作记忆私有、技能/方法团队共享**。公开人事是为了协作与问责，
私有记忆是为了让 agent 敢记错、敢试错，团队技能是为了不重复造轮子。

**建议**：
1. **Skill 作为 Contract 资产**：公司 git 目录 `skills/<name>/SKILL.md`，带版本、来源、
   适用范围、验收/测试、作者与批准人；agent 可提案（`skill-propose`），daemon 写回，
   部长/制作人批；默认技能按岗位挂载；采用 Agent Skills 开放标准，避免私有格式。
2. **Memory 作为 Org 资产**：按工号/岗位的有界记忆（建议先 100 条 / 10k 字符），
   scope=团队/项目/岗位，带 provenance、expiresAt、密钥扫描；agent 只能提案，
   daemon 落账/落盘；管理员可审计/删除，但不能手写。
3. **Lessons 闭环**：从 REPORT/summary/postmortem 机械抽取「结论/改动/打回理由」，
   按同单相似度取 top-k 注入 L4；带哈希 provenance；不允许 agent 自报未经证据的教训。
4. **事项/摘要视图**：不新增 Topic 名词，用 `Ledger`+`Work` 派生「事项页 + 每日摘要 +
   关注规则」；这是制作人指挥台的数据基础。
5. **上下文预算**：按层记 bytes/chars、压缩事件、被裁内容；保护层超预算要告警，
   不能静默丢红线/验收口径。

### 2.5 治理与权限：写闸强，授权弱

| 维度 | todos.dev | Studio Next |
|---|---|---|
| 写路径 | 平台工具 + Git 凭据 + per-agent 开关 | wkey 网关 + 署名 + daemon 唯一写入者 |
| 状态推进 | 人点按钮 / 聊天 / Chief 代办 | daemon FSM 独占；agent 拿不到 transition |
| 工具权限 | push/merge/tag/skill/remote shell/secrets/connections，逐 agent 开关 | 六动作：comment/heartbeat/article/kb-search/evidence-write/budget-query（[gateway.ts:13](../packages/contract/src/ports/gateway.ts)） |
| 机器同意 | 双边同意：agent grant + machine switch | 无 machine 级同意；seatbelt 原型 |
| 审批 | 两个 gate + AI review + Chief 确认卡 | 三态闸门 + 状态机 + 验收命令；无统一审批 UI |
| 独立评审 | AI review：人触发、异 agent/异模型、只读、自动修订；**评审是建议，不代替人** | 复验岗 Blind 读面 + 验收闸门（**硬门**）；缺 plan/diff 制品与评审请求工作流 |
| 联签/quorum | 无 | **无机制**；自审承认「会签三人全是同一 daemon 定时岗，同进程替三个身份签字」([复查报告](复查报告-2026-10-16.md) B10) |
| 成本治理 | 透明用量：按模型/订阅配额/credits/任务 | **预算 reserve→settle→refusal + 断路 + 每成功交付成本**（组织级更强） |
| 审计 | 两条轨道（人/agent） | append-only events + evidence + 收割四要件 |
| 密钥 | 加密存储、按 agent 注入、two-sided consent | config/env；红队实测 env 全量透传（[42](42-公司规范红队审视.md)） |

**关键洞察**：Studio 的「组织」目前是 **FSM + 定时岗 + 工单路由**，不是 **代理权网络**。
所谓「部长批策划 / QA 打回工程」，实际是 daemon 按状态机在走；agent 只能 comment/evidence。
这不是 bug，而是刻意的安全设计（状态推进永不在工具表，[24-§二](24-AI接入面.md)）。
但它意味着：**岗位目前是 persona，不是有权威的 agent**。要成为组织，必须补两层：

1. **授权图（Authority Graph）**：`Org` 的扩展面。
   - 节点：岗位/工号；边：`{action, object scope, limit, conditions, quorum, expiry, delegable}`。
   - 根：制作人；可转授、可撤回、可设额度/任期/条件。
   - 动作：transition / assign / create / approve / reject / budget-adjust / merge / close……
   - 每次行使落 `Ledger`，携带授权链（谁授的、依据哪条章程、额度剩多少）。
   - 越界 fail-closed + 升级；超时只升级，绝不自动放行。
2. **动作意图（Action Intent）**：agent 不直接写状态，而是提交「意图 + 理由 + 证据 +
   授权声明」；daemon 校验授权图/额度/quorum，通过则执行，否则拒绝/升级。
   - 这样既保住「daemon 唯一写入者」，又让 agent 真正行使被授予的权力。
   - 「部长批策划」= 部长 agent 提交 approve 意图，daemon 校验其对该部门/该单/该额度
     的权限后执行；「QA 打回工程」同理。
   - 身份隔离：每个角色的意图必须来自独立 session；quorum 排除同一 executor/同一进程；
     防止「一个 daemon 替三个身份签字」。
3. **配套**：wkey scope 按岗位/动作细分（不要每个 worker 都是六动作全集）；
   env 白名单；Keychain；审批收件箱；授权图 UI；审计链可视化。

### 2.6 产品与交互：拼装界面 vs 产品界面

| 维度 | todos.dev | Studio Next |
|---|---|---|
| 入口 | 桌面 App / Web / 手机 PWA | CLI + :8787 + :8789 + :8788 + Taiga + Matrix |
| 首页 | Workspace：Chief 对话 + 四列看板 | :8787 监控（只读）、:8789 概览（只读） |
| 工作详情 | 对话 + Plan/Changes/Verification + run history | 单据 + 事件 + REPORT；无 plan/diff |
| 决策 | 按钮 / 聊天 / Chief 代办 | Taiga 状态流转 / Matrix / CLI；无统一审批 |
| 通知 | Inbox + digest + watch | Matrix + 面板事件 |
| 移动端 | 完整工作区 | 无 |
| 上手 | 下载 → 登录 → 连 repo → 建单 | init → provision → YouTrack/Matrix → dsh → agent.yaml |
| 视觉 | 产品级打磨 | 极简暗色 SSR；Vue 选型已定但未全面施工 |
| 制作人注意力 | 收件箱 + 「Needs you」列 | 分散在多个面，无「今天需要你出手什么」 |

**结论**：todos 的界面是产品，Studio 的界面是拼装。制作人的注意力是最终稀缺资源
（[08](08-十视角统一抽象.md) 共性 6），当前实现却把注意力分散在四个面。

**建议：制作人指挥台（不是新事实源）**
- **收件箱**：待批 / 待验收 / 异常 / 预算 / 人事，按「需要你出手」排序；每个条目带
  原始证据、成本、等待时长、建议动作。
- **事项页**：一屏看 Work + 最近事件 + 证据 + 成本 + 组织上下文 + 相关 agent。
- **动作**：批准 / 打回 / 派发 / 暂停 / 追加预算 / 授权，全部经 daemon 单点写入。
- **时间线**：attempt / plan / changes / review / rewind。
- **形态**：PWA 先行（手机可用），桌面壳后置（[48](48-桌面平台形态探索.md) 的 D 案不变，
  但先做「管家」不做「IDE」）。

### 2.7 生态、分发、商业：广度 vs 深度

| 维度 | todos.dev | Studio Next |
|---|---|---|
| 执行体 | 内置 pi + 近 20 家外部 CLI（Claude Code/Codex/Cursor/Devin/dsh…） | dsh 默认 + claude/codex/kimi 四家 |
| 协议 | ACP/SDK/headless 多形态；MCP 进/出 | 四原语；studio-tools（内部 MCP）；对外 MCP 已拍板待排 |
| 外部连接 | 最多 20 个 MCP/OAuth 连接（Linear/Notion/Sentry/Expo…） | Taiga/YouTrack/LocalFile + Matrix |
| 代码托管 | GitHub/GitLab/Gitea/Bitbucket/Azure/Todos-hosted | 公司 git 目录 + 平台单据；无内建代码托管 |
| 机器 | 本机 / 多机集群 / 平台云沙箱 | 单 daemon / 本地 |
| 桌面/移动 | macOS/Windows/Linux + 手机 PWA | 无 |
| 定价 | Free / Pro $19 per team；credits 付云机器与内置模型 | MIT 开源；无定价；不做托管 |
| 文档 | 公开、任务导向、troubleshooting、changelog | 内部设计文档库（50+ 篇）；无公开 docs site |
| 社区 | 产品驱动 | 内部工程驱动 |

**Studio 的周边依赖比 todos 重**：YouTrack 免费版 10 用户硬上限、Taiga 上游主力转向
Tenzu、Matrix/Synapse 的运维成本——这些是「企业集成」的代价。todos 把这些能力内化
（git 托管、队列、worktree、云沙箱），所以冷启动更轻；Studio 把它们外化，所以更可控、
更可替换，但必须保证「没有外部平台也能跑」。对策是 FlowPlatform 端口化（已有）+
LocalFile 最小实现（已有）+ 一条命令的本地 demo，把「依赖」变成「可选」。

**结论**：todos 是「广度 + 低摩擦」，Studio 是「深度 + 高控制」。广度不能靠自研追赶，
要靠协议外包；深度不能靠 feature 堆，要靠制度与证据。

**Studio 还有一个 todos 结构上没有的周边资产：公司包规范**——「git 网址即公司」、
依赖清单、插件 allowlist、信任锚、可复现导入（[43](43-公司规范-v1-方案定稿.md)、
[44](44-规范spike验证报告.md)、[51](51-公司仓库规范正文.md)）。这可能是「AI 公司的 npm」：
别人可以发布/下载/审计一家公司，而不只是使用一个 workspace。但它同时是最大的供应链攻击面，
必须先有批准指纹、依赖锁定、可复现构建、导入剥离；否则「公司包」会变成「恶意 prompt 的
分发器」。这是比 worktree 更值得长期投入的差异化资产。

**建议**：
1. **Executor 端口用 ACP/MCP 统一**，不再为每家写定制适配器；保留 dsh 深度优化
   （用量、steer、插件、session resume）。todos 文档明确 dsh 不报 token、且不支持
   turn 中消息；Studio 的 dsh 适配器解析 step_end usage，可以把 dsh 做成「最深的宿主」，
   这是通用 ACP 适配器给不了的。
2. **对外 MCP + A2A Agent Card**：让外部 agent 能「查公司 / 提需求 / 接任务 / 读回执」，
   把公司变成 agent 生态里可雇佣、可审计的节点（[45-§二](45-对外产品面三考量.md)）。
3. **对内开放工位**：允许 Todos / Claude Code / Codex / Cursor 通过 MCP 连 Studio 的
   org/work/ledger，Studio 不必自己造所有前端。这是「制度层」的协议化，不是产品依赖。
4. **分发**：Docker Compose 一键起（daemon + panel + Taiga + Matrix 可选），再桌面壳；
   不做托管（Q2 已定）。
5. **商业**：开源核心 + 企业版（多公司 / SSO / 审计 / 支持）；定价后置，但不要永远没有。

### 2.8 工程与组织：生产级 vs 预 1.0

| 维度 | todos.dev | Studio Next |
|---|---|---|
| 代码规模 | 未核实（生产产品） | ~67k LOC TS（src）+ ~51k 测试代码；205 个测试文件，2934 个测试 |
| 门禁 | 生产 CI / 版本化 CLI / changelog | typecheck ✅、边界 guard ✅、**无 CI**（[50b:93](50b-对账-技术设计核心链.md)） |
| 发布 | 持续发版、桌面/移动 | 无 release 分支/无发布节奏（[50b:93](50b-对账-技术设计核心链.md)） |
| 文档 | 公开 docs、troubleshooting | 50+ 内部设计文档；无公开 docs site |
| 边缘情况 | worktree/断网/进程逃逸/凭据轮换等大量实战 | 单元/契约测试强；运行时边缘情况少 |
| 可观测 | 用量/成本/diff/audit | 台账/面板/成本/断路；缺统一 timeline |
| 安全 | 权限/密钥/隔离；外部 runtime 明确「无沙箱无审批」 | wkey/seatbelt/红队；env 透传与 quorum 缺口 |
| 速度 | 产品驱动、快 | 文档先行、六步提案、稳但慢 |
| 文档-代码一致性 | 产品文档跟实现 | **文档领先代码**：lessons 空、merge 模拟、api skeleton、17 有合并冲突标记 |

**诚实评价**：Studio 的工程**测试纪律**很强（typecheck/边界门禁/契约测试/崩溃注入），
但**产品完成度**低：没有 CI、没有 release、没有工位、没有记忆/技能、没有统一指挥台。
这不是能力问题，是阶段问题；但如果不补，v1.0 的「7 天零批示」只能证明 daemon 能跑，
不能证明产品有人用。

**建议**：
1. **CI 第一优先**：push 触发 typecheck + test + guard + 密钥扫描；这是所有质量声明的底座。
2. **发布节奏**：release tag + changelog + 版本兼容（契约分级/废弃窗口）。
3. **公开 docs site**：quickstart / concepts / operations / API/MCP；不要只靠内部文档库。
4. **文档-代码对账**：每个设计文档必须有「实现状态/证据/缺口」三列；禁止文档跑在代码前面
   太远（[50b](50b-对账-技术设计核心链.md) 已是好榜样）。
5. **工具链机械化**：`.mise.toml` 锁 Node 24 + bun，但本机实际 Node 25、无 bun；
   测试在 Node 25 下 2890/2934（失败集中在 sqlite ExperimentalWarning 与并发 spawn 超时），
   说明「锁版本」还停留在文件，不在执行面。CI/容器化要解决这个。

---

## 三、前沿坐标系：todos 之外

### 3.1 工位层：正在商品化

| 产品 | 形态 | 关键能力 | 对 Studio 的启示 |
|---|---|---|---|
| **todos.dev** | 桌面/Web/移动 + 本机/云 | Chief、看板、worktree、plan/review、memory/skills、近 20 运行时、MCP | 工位层的功能基线已被定义 |
| **Conductor** | macOS/iOS/云 microVM | 多 agent 并行、云沙箱、multiplayer、API | 「workspace + cloud + 协作」可以是一个产品 |
| **Claude Code** | CLI/桌面/Web | agent teams、agent view、cross-session messaging、worktrees、scheduled tasks、skills | CLI 本身正在变成编排平台 |
| **Codex app** | 桌面 command center | 多 agent 会话、并行工作流、本地进程编排 | 「command center」是桌面形态的正解 |
| **GitHub Agent HQ** | 平台 mission control | any agent, any way you work；统一编排 | 平台会占住「mission control」，agent 被商品化 |
| **Linear coding sessions** | issue tracker | 从 issue 直接起 coding session | 协作平台正在变成 agent 控制面 |
| **Cursor / Devin / Factory** | IDE / 自主工程师 / droids | 后台 agent、并行任务、企业集成 | 单点执行能力持续商品化 |

**结论**：工位层（worktree、队列、多机、diff、review、memory、skills）正在快速商品化。
Studio 不应该在这里追求「人无我有」，而应该追求「人有我接」——用协议接进来，
把精力留给制度层。

### 3.2 编排层：正在框架化

| 代表 | 解决什么 | Studio 应借什么 | 不应借什么 |
|---|---|---|---|
| LangGraph | 有状态 agent 图、human-in-the-loop | 状态图/中断/恢复的表达 | 不要把 FSM 换成通用图框架 |
| CrewAI | 角色化多 agent 协作 | 角色/任务/流程的易用抽象 | 不要用它替代公司目录 |
| AutoGen / AG2 | 多 agent 对话与工具 | 对话式协作模式 | 不要引入无审计的对话黑盒 |
| OpenAI Agents SDK / Google ADK | agent 运行时/工具/追踪 | tracing/handoff 的工程化 | 不要绑定单一模型厂商 |

**结论**：编排框架会解决「多 agent 怎么对话」，但不会解决「谁有权、谁负责、钱从哪来、
证据在哪」。后者是 Studio 的空间。

### 3.3 耐久执行：Studio 已经对了一半

| 代表 | 核心 | Studio 对应 | 差距 |
|---|---|---|---|
| Temporal | 事件历史 + 幂等 activity + 重试/超时 | append-only events + tick 幂等 + 预算/断路 | 缺正式的 workflow/activity 语义、超时/重试策略未统一 |
| Restate / DBOS | 持久执行、虚拟对象 / 事务 | 状态外置 + 台账投影 | 缺 checkpoint/恢复的执行实体 |
| Inngest | 事件驱动 step functions | 六源意图 + 主循环 | 缺 step 级可观测/回放 |

**结论**：Studio 的「状态外置 + 事件日志 + tick 幂等」方向是对的，甚至比很多 agent 框架更
接近耐久执行。但缺「执行实体/checkpoint」，所以只能做到「重派」，做不到「续跑/回退」。
把 `WorkAttempt` 和 `WorkspaceProvider` 补上，这一块会变成强项。

### 3.4 记忆与技能：正在标准化

| 代表 | 核心 | Studio 应借什么 |
|---|---|---|
| Agent Skills（SKILL.md，开放标准） | 渐进披露、可组合、可移植 | 直接采用格式；公司技能库放 git；按岗位挂载 |
| Letta / Mem0 / Zep | 有界记忆、检索、过期、版本 | 记忆的容量/作用域/审计模型 |
| Anthropic 的 Skills 工程文章 | 评估驱动、渐进披露、代码即工具 | 技能要带 eval/验收，不要只写 prompt |

**结论**：技能格式已经标准化，记忆产品已经成熟。Studio 不需要发明格式，需要发明
**治理**：谁可以写、谁批准、怎么版本、怎么证明有效、怎么防止污染。

### 3.5 组织模拟：有想法，缺执行与问责

| 代表 | 核心 | 局限 | Studio 的机会 |
|---|---|---|---|
| MetaGPT | 角色化软件公司、SOP 编排 | 多为离线/模拟；无真实预算/人事/审计 | 把「模拟公司」变成「可运行的公司」 |
| ChatDev | 多角色对话完成软件任务 | 同上；缺耐久执行与证据 | 用真实工单/台账/证据替代对话剧本 |

**结论**：AI 公司不是新想法，但「可运行、可审计、可追责」的 AI 公司是空位。
Studio 的差异化不是「也有角色」，而是「角色有工号、有授权、有预算、有证据、有绩效」。

### 3.6 前沿总结：中间层商品化，两端值钱

```
模型/运行时（商品化） ←→ 工位/编排（正在商品化） ←→ 制度/治理（空白）
```

- 左端：模型和 CLI 会越来越便宜、越来越标准化。
- 中间：worktree、队列、diff、memory、skills 会被产品/框架吃掉。
- 右端：身份、授权、预算、审计、人事、跨组织协议——**还没有标准**。

Studio 应该占右端，用左端和中间的能力，而不是在中间和 todos 打消耗战。

---

## 四、差距清单（按优先级）

> 优先级：P0=不做就无法兑现「组织运行」；P1=不做就无法规模化/可信；P2=生态/商业。

| ID | 差距 | 前沿基准 | 本仓现状（证据） | 影响 | 优先级 |
|---|---|---|---|---|---|
| G1 | 工位隔离与可恢复执行 | todos worktree/checkpoint/restore | `.AIWS` 每 attempt 目录；无分支；merge 模拟（[engine.ts:118](../apps/daemon/src/engine/engine.ts)） | 并行代码工作不安全；无法回退 | P0 |
| G2 | 计划/变更/验收制品 | todos Plan/Changes/Verification | 只有 REPORT/summary/gate log；面板只读 | 制作人无法在合并前评审 | P0 |
| G3 | 制作人指挥台 | todos Workspace/Inbox | 三端口 + Taiga + Matrix；无统一收件箱/动作 | 注意力碎片化；≤3 次/日不可达 | P0 |
| G4 | 冷启动 | 下载→登录→repo→任务 | init/provision/YouTrack/Matrix/dsh/agent.yaml；向导缓办 | time-to-first-value 过高 | P0 |
| G5 | 记忆/技能/教训 | 有界记忆 + 技能库 | lessons 空（[prompt-assembly.ts:21](../apps/daemon/src/engine/prompt-assembly.ts)）；无记忆/技能库 | agent 重复学习；能力不积累 | P1 |
| G6 | 运行时深度/广度 | 近 20 运行时 + steer | dsh headless 一次性；steer 探针完成未接线（[34](34-dsh插件面与中途插话探针报告.md)） | 交互性弱；但 dsh 深度可作差异化 | P1 |
| G7 | 授权/凭据/quorum | per-agent + machine 双边同意 | wkey 六动作全集；无授权图；同进程多签（[复查 B10](复查报告-2026-10-16.md)）；env 透传（[42](42-公司规范红队审视.md)） | 组织可信度/安全性 | P1 |
| G8 | 上下文/话题/摘要 | topic/brief/watch/digest/压缩 | 无 topic/digest；依赖 executor 压缩 | 长任务上下文丢失；制作人过载 | P1 |
| G9 | 多机/云执行 | 多机集群 + 云沙箱 | 单 daemon + 本地 execa | 规模/可用性 | P2 |
| G10 | CI/发布/文档站 | 生产 CI + 公开 docs | 无 CI/无 release/无 docs site（[50b:93](50b-对账-技术设计核心链.md)） | 质量声明脆弱；上手难 | P1 |
| G11 | 外部生态/协议 | MCP 进/出 + A2A | api 包 skeleton；MCP 已拍板待排；Agent Card 部分 | 无法被外部 agent 雇佣/审计 | P2 |
| G12 | 商业/分发 | Free/Pro/云 credits | MIT；无定价；不做托管 | 可持续性/ adoption | P2 |
| G13 | 组织自主性未实证 | 无先例 | v1.0 目标「7 天零批示」；当前制作人仍是唯一意志源 | 核心主张未被证明 | P0（研究） |

**关于 G13**：这不是 feature，是**实验**。建议在扩组织之前，先做一次受控的
「7 天自治演习」：固定公司、固定预算、固定指标，制作人只在 P0 事故时介入；
记录每次介入的原因、授权链、证据。跑不通，就说明「组织」还只是叙事，不要继续加层级。

---

## 五、改进方案：三层 + 三不做

### 5.1 工位层（0-30 天，P0）

**目标**：让一次代码交付「可隔离、可恢复、可评审、可合并」。

1. **`WorkspaceProvider` 端口**（`packages/contract`）：
   ```ts
   interface WorkspaceProvider {
     prepare(work, attempt): Promise<Workspace>
     checkpoint(ws, message): Promise<Checkpoint>
     restore(ws, checkpoint): Promise<void>
     merge(ws, target): Promise<MergeResult>
     cleanup(ws): Promise<void>
     status(ws): Promise<WorkspaceStatus>
   }
   ```
   - 首个实现：`GitWorktreeProvider`（本地）。
   - 后续：`RemoteProvider` / `CloudProvider`（Daytona/E2B/Modal 或自建）。
2. **`WorkAttempt`**：`Work` 的执行面，存 branch/base/head/checkpoint/artifacts。
3. **`Executor` 可选能力**：`interrupt` / `usage` / `resume`；dsh 用长驻 web profile
   实现 turn 中 steer、SDK profile 实现 turn 间 followup，并接 session resume / per-turn usage。
4. **P0 验收**：
   - 同 repo 两个 attempt 并行，文件系统/分支不冲突。
   - kill 后重启，能从 checkpoint 恢复（不是重派）。
   - merge 冲突有明确归属与处理路径。
   - worker 环境无全量 env；Git 凭据只注入 git 子进程。

### 5.2 认知层（30-90 天，P1）

**目标**：让 agent 的经验可积累、可检索、可审计。

1. **Skill 库**：`skills/<name>/SKILL.md` + 版本 + 来源 + 适用范围 + 验收/测试；
   agent 可提案，daemon 写入，部长/制作人批；默认技能按岗位挂载。
2. **Memory**：按工号/岗位有界记忆；scope=团队/项目/岗位；provenance/expiresAt/密钥扫描；
   agent 提案，daemon 落账；管理员可审计/删除，不能手写。
3. **Lessons**：从 REPORT/summary/postmortem 抽取，按相似度 top-k 注入 L4；
   带哈希 provenance；用「同类单是否减少返工」做 A/B，而不是自评。
4. **事项/摘要**：`Ledger`+`Work` 派生事项页 + 每日摘要 + 关注规则；
   不新增 Topic 名词，避免概念膨胀。
5. **上下文预算**：按层记 bytes、压缩事件、被裁内容；保护层超预算告警。

### 5.3 神经层（90-180 天，P1）

**目标**：让岗位真正拥有「被授予的权威」，而不是 persona。

1. **Authority Graph**（`Org` 扩展面）：
   - 节点=岗位/工号；边=`{action, scope, limit, conditions, quorum, expiry, delegable}`。
   - 根=制作人；可转授/撤回/限额/限期。
   - 动作：transition / assign / create / approve / reject / budget-adjust / merge / close。
2. **Action Intent**：agent 提交「意图 + 理由 + 证据 + 授权声明」；daemon 校验后执行；
   越界 fail-closed + 升级；超时只升级不放行。
3. **身份隔离**：每个角色的意图来自独立 session；quorum 排除同一 executor/进程；
   利益冲突检查（不能自己审自己、不能自己批自己的预算）。
4. **审批收件箱**：授权图 + 待批/待验收/异常，全部经 daemon 单点写入。
5. **验收**：
   - 部长能在额度内批准本部门提案；超额度自动升级。
   - 同一进程不能替两个角色签字；quorum 有效。
   - 每次行使可追溯到「哪条授权、谁授的、剩多少」。

### 5.4 产品层（贯穿，P0/P1）

1. **制作人指挥台 v0**（PWA 先行）：收件箱、事项页、时间线、动作、证据、成本。
2. **冷启动 v0**：`docker compose up` 或 `studio-next demo`，用 LocalFile + fake/dsh
   跑通「建单 → 派发 → 证据 → 验收」，不依赖 YouTrack/Matrix。
3. **公开 docs site**：quickstart / concepts / operations / API/MCP / troubleshooting。
4. **桌面壳后置**：先做 daemon 生命周期/通知/Keychain 的「管家」，不做 IDE。

**黄金路径（一条 vertical slice，先跑通再谈扩展）**：
`studio-next demo` 生成一家 demo 公司 → 指挥台建单 → dsh 在 per-attempt worktree 写计划 →
指挥台确认 → 构建/测试 → diff 评审 → merge → 证据/成本入账 → 收件箱归零。
这一条路径同时检验指挥台、工位、授权、证据、成本五件事；跑不通，不要加多公司/多机/更多运行时。

### 5.5 生态层（90-180 天，P2）

1. **MCP 对外**：信息面 + 触发面 + 订阅；API key scope；审计。
2. **A2A Agent Card**：公司名片、任务协议四环（create→回执→状态流→终态产物）。
3. **外部工位接入**：Todos/Claude Code/Codex/Cursor 通过 MCP 连 Studio 的
   org/work/ledger；Studio 不必自己造所有前端。
4. **Executor 协议化**：ACP 统一多 runtime；dsh 保留深度适配。
5. **打包**：Docker Compose（daemon + panel + Taiga + Matrix 可选）；企业版再谈。
6. **公司包**：把 company 目录 + 依赖清单 + 插件 allowlist 做成可发布/可审计的包；
   先做安全基线（批准指纹/依赖锁定/可复现构建/导入剥离），**不做 registry 运营**
   （[43-§三](43-公司规范-v1-方案定稿.md) 已定），让生态自己长。

### 5.6 三不做 + 三不学

1. **不做通用 IDE / 编辑器 / diff 浏览器**：接 Git 平台、接现有 review 工具；
   Studio 的核心是制度，不是编辑器。
2. **不做运行时适配竞赛**：用 ACP/MCP 外包广度；dsh 做深（usage/steer/插件/
   session resume），这是 todos 对 dsh 的浅支持所没有的。
3. **不做「无治理的全自动 CEO」**：授权可以下放，但最终仲裁、宪法、判据类资产
   必须在制作人手里；没有授权图/quorum/证据的「全自动」是事故制造机。

另外，**不要从 todos 学这三件事**：
- **把编排完全交给一个 LLM**（Chief）：Studio 的确定性 daemon 是优势，LLM 判断应放在
  「提案/建议」层，不应绕过状态机与预算闸。
- **对 dsh 的浅支持**：todos 走通用 ACP，dsh 不报 token、不支持 turn 中消息；
  Studio 既然 dsh-first，就应该做深，而不是为了「统一」把 dsh 削平。
- **让记忆完全自治、无组织审计**：todos 的记忆是 agent 私有、管理员可审计；
  Studio 的组织记忆必须更强——有来源、有版本、有批准、有冲突处理，否则会变成
  「一群 agent 互相引用错误经验」。

### 5.7 与现有里程碑的衔接

现有 v1.0 的验收是「连续 7 天制作人零批示正常运转」（[16-§四](16-技术实现与里程碑.md)）。
建议把它拆成两个门槛：

- **v1.0-A（可运行）**：指挥台 v0 + 工位 v0 + 冷启动 v0 + CI。
- **v1.0-B（可自治）**：记忆/技能/教训 + 评审/回退 + 授权图 v0 + 7 天自治演习。

否则 v1.0 可能只是「daemon 里程碑」，不是「公司上线」。

---

## 六、路线图与验收指标

### 6.1 三阶段

| 阶段 | 交付 | 验收（可测） | 依赖 |
|---|---|---|---|
| **0-30 天** | 指挥台 v0；WorkspaceProvider + dsh worktree；冷启动 demo；CI | 黄金路径端到端；time-to-first-task < 30min（demo <10min）；并行 attempt 零冲突；kill/restart 可恢复；CI 全绿 | 无 |
| **30-90 天** | 计划/变更/验收制品；独立评审；skills/memory/lessons；docs site | 评审覆盖率 ≥80%；同类返工率下降；记忆命中率可测；技能复用率可测 | 工位层 |
| **90-180 天** | Authority Graph v0；MCP/A2A；多机/云工位；企业打包 | 部长额度内批准率；越权 100% fail-closed；quorum 有效；7 天自治演习 | 认知层 + 工位层 |

### 6.2 指标（建议进台账/面板）

| 指标 | 定义 | 目标 |
|---|---|---|
| TTFT | 从安装到第一单被验收 | <30min（demo <10min） |
| 制作人介入/日 | 需要人出手的次数 | ≤3/日（08 共性 6） |
| 一次通过率 | 首次验收通过 / 总派发 | 逐月上升 |
| 返工率 | 打回/重派占比 | 逐月下降 |
| 单件交付成本 | 成功交付的总成本 / 成功单数 | 可解释、可优化 |
| 工位事故 | 并行冲突/丢改动/无法恢复 | 0 |
| 证据完备率 | 四要件齐全的交付占比 | 100% |
| 记忆命中率 | 被注入且被使用的记忆 / 注入总数 | 可测，不追求高 |
| 技能复用率 | 使用技能的派发 / 总派发 | 可测 |
| 自治时长 | 无制作人介入的连续运行时长 | v1.0-B ≥7 天 |
| 越权拦截 | 越权动作被 fail-closed 的比例 | 100% |
| 审批时延 | 待批 → 决定的中位时长 | 逐月下降 |

### 6.3 反指标（防止自欺）

- 不要用「提交数/事件数/消息数」当绩效（[02-F3-07](02-需求-框架面.md)）。
- 不要用「agent 自评/互评」当质量（[04-§二](04-公司目录与等级体系.md)）。
- 不要用「跑通一个 demo」当验证通过（[20-§十三](20-工程总规程.md)）。
- 不要用「文档写了」当已实现（[50b](50b-对账-技术设计核心链.md) 的对账精神）。

### 6.4 如果只能做三件事

1. **指挥台**：让制作人愿意每天打开——收件箱 + 事项页 + 动作 + 时间线。
2. **工位**：让代码交付真实可恢复——worktree + branch + checkpoint + merge。
3. **授权图**：让组织不是木偶戏——可授予、可限额、可撤回、可追责、quorum 有效。

这三件分别对应「注意力」「执行力」「制度可信度」；缺任何一件，另外两件的价值都会被腰斩。

---

## 七、给制作人的拍板项

| # | 问题 | 建议 | 理由 |
|---|---|---|---|
| D-A | 工位层放 daemon 内核还是 Executor 端口？ | **端口** | 本地/远程/云可替换；不把 git 细节塞进主循环 |
| D-B | 是否采用 Agent Skills 开放标准？ | **是** | 格式已标准化；降低自研/迁移成本 |
| D-C | 授权图放 `Org` 扩展面还是新名词？ | **Org 扩展面** | 不破坏六名词；权限本来就是组织属性 |
| D-D | 先做 PWA 指挥台还是 Electron 壳？ | **PWA 先行** | 零体积、手机可用；壳后置做管家 |
| D-E | 是否开放外部工位（Todos/Claude Code）通过 MCP 接入？ | **是，但只走协议** | 用生态补广度，不把产品命脉交给竞品 |
| D-F | 是否冻结新的组织层级/模板，直到 P0 完成？ | **是** | 骨架已够大；先补神经与记忆，避免「更大的空壳」 |

---

## 八、证据与方法

### 8.1 外部来源

- todos.dev 首页/功能/定价：<https://todos.dev/>、<https://todos.dev/features>、<https://todos.dev/pricing>
- 概念与对象模型：<https://todos.dev/docs/concepts>
- Chief / topics / watches / digest：<https://todos.dev/docs/chief>
- 工作树与清理（worktree/checkpoint/offline resume）：<https://todos.dev/docs/worktrees>
- 计划与变更：<https://todos.dev/docs/plans-and-diffs>
- AI review：<https://todos.dev/docs/ai-review>
- 记忆：<https://todos.dev/docs/memory>
- 权限：<https://todos.dev/docs/permissions>
- 运行时（含 dsh/ACP）：<https://todos.dev/docs/runtimes>
- MCP：<https://todos.dev/docs/mcp>
- Conductor：<https://www.conductor.build/>
- Claude Code 并行 agent：<https://code.claude.com/docs/en/agents>
- GitHub Agent HQ：<https://github.blog/news-insights/company-news/welcome-home-agents/>
- Agent Skills（Anthropic）：<https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills>
- Agent Skills 开放标准：<https://agentskills.io/>
- MetaGPT：<https://github.com/FoundationAgents/MetaGPT>
- ChatDev：<https://github.com/OpenBMB/ChatDev>
- Temporal（耐久执行）：<https://temporal.io/>

### 8.2 仓内证据

- 竞争定位 doctrine：[49-制作人决策包.md](49-制作人决策包.md) §「竞争定位 doctrine」
- 六名词三动词五不变律：[08-十视角统一抽象.md](08-十视角统一抽象.md)
- 主循环/预算/收割/网关：[17-整体技术设计.md](17-整体技术设计.md)
- 工位/合并现状：[engine.ts:118](../apps/daemon/src/engine/engine.ts)、[engine.ts:2087](../apps/daemon/src/engine/engine.ts)
- lessons 空：[prompt-assembly.ts:21](../apps/daemon/src/engine/prompt-assembly.ts)
- 网关六动作：[gateway.ts:13](../packages/contract/src/ports/gateway.ts)
- API skeleton：[packages/api/src/index.ts](../packages/api/src/index.ts)
- 中途插话探针：[34-dsh插件面与中途插话探针报告.md](34-dsh插件面与中途插话探针报告.md)
- 红队 env/wkey：[42-公司规范红队审视.md](42-公司规范红队审视.md)
- quorum 同进程问题：[复查报告-2026-10-16.md](复查报告-2026-10-16.md) B10
- CI/分支/发布缺口：[50b-对账-技术设计核心链.md](50b-对账-技术设计核心链.md) §二
- 文档合并冲突标记：[17-整体技术设计.md](17-整体技术设计.md) L76-L80

### 8.3 本机核验

- `node_modules/.bin/tsc --noEmit`：exit 0。
- `node scripts/guards/boundaries.mjs`：PASS，616 文件，0 违例。
- `vitest run`：本机 Node 25 下 2890/2934 通过；两次运行失败数 34–44（随并发波动），
  集中在 `node:sqlite` 的 ExperimentalWarning 与并发 spawn 超时；仓内记录 Node 24 下
  2933/2933。结论：测试基线可信，但工具链锁定未机械化（`.mise.toml` 未实际生效、
  本机无 bun、无 CI）。

### 8.4 局限

- todos.dev 的内部架构来自公开文档，未做源码审计；其「Unconfirmed」项不当作事实。
- Conductor/Claude Code/Agent HQ 等只做定位对照，未做深度采购评估。
- 没有客户/市场数据，不对 todos 的规模、留存、收入做判断。
- 本机测试在 Node 25 下运行，失败项不能直接归因为产品缺陷；但暴露了 CI/工具链问题。

---

## 九、冷眼评估：事实、判断与置信度

> 这一节把前文的战略叙事放下，只问三个问题：哪些是事实？哪些是判断？判断的置信度有多高？
> 如果事实不足以支持判断，就明确说「不知道」或「未证明」。

### 9.1 事实（可核验）

| # | 事实 | 证据 | 置信度 |
|---|---|---|---|
| 1 | todos 已交付 per-build worktree/branch、每 turn checkpoint+push、restore/rewind、7 天清理、跨机 cold start | [worktrees 文档](https://todos.dev/docs/worktrees) | 高（官方文档，细节到 TTL/命令级） |
| 2 | todos 支持近 20 个运行时（内置 pi + 十余家 CLI）、MCP 进出、桌面/移动、Free/Pro 定价 | [runtimes](https://todos.dev/docs/runtimes)、[pricing](https://todos.dev/pricing) | 高 |
| 3 | todos 是单 principal 模型：owner + Chief + agents，两个人工 gate；无部门/层级/人事/预算体系 | [concepts](https://todos.dev/docs/concepts)、[chief](https://todos.dev/docs/chief) | 高 |
| 4 | todos 的外部 runtime 明示「无沙箱、无审批」 | [runtimes](https://todos.dev/docs/runtimes) | 高（平台文档原话） |
| 5 | Studio 有 ~67k 行 src、~51k 行测试、2934 个测试；`tsc` 与边界门禁绿 | 本机核验（见 8.3） | 高 |
| 6 | Studio 运行面没有 per-attempt worktree/branch/checkpoint；merge 是模拟 | [engine.ts:118](../apps/daemon/src/engine/engine.ts)、[engine.ts:2087](../apps/daemon/src/engine/engine.ts) | 高（代码实读） |
| 7 | Studio 的 L4 lessons 传空；无 per-agent 记忆、无技能库 | [prompt-assembly.ts:21](../apps/daemon/src/engine/prompt-assembly.ts) | 高（代码实读） |
| 8 | Studio 的 worker 只有六个网关动作；状态推进不在工具表；quorum 无机制；env 全量透传 | [gateway.ts:13](../packages/contract/src/ports/gateway.ts)、[复查 B10](复查报告-2026-10-16.md)、[42](42-公司规范红队审视.md) | 高（代码+自审文档） |
| 9 | Studio 无 CI、无 release 流程；api 包 skeleton；panel 只读；无桌面/移动 | [50b:93](50b-对账-技术设计核心链.md)、[api/index.ts](../packages/api/src/index.ts) | 高 |
| 10 | Studio 的 v1.0「7 天零批示」目标尚未被跑过 | [16-§四](16-技术实现与里程碑.md) 只有目标；[50b:249](50b-对账-技术设计核心链.md) 自审「无记录可核」 | 高 |
| 11 | Studio 文档领先代码：lessons 空、merge 模拟、api skeleton、17 有合并冲突标记 | 本机实读 | 高 |
| 12 | todos 的内部架构来自公开文档，未做源码审计；文档可能省略实现细节 | 方法限制 | 中 |

### 9.2 判断（不是事实）

| # | 判断 | 依据 | 置信度 |
|---|---|---|---|
| 1 | todos 是成熟产品，Studio 是预 1.0 框架 | 事实 1-4 vs 5-11 | 高 |
| 2 | Studio 当前的「组织」是 FSM + 定时岗 + 工单路由，不是代理权网络 | 事实 8、10 | 高 |
| 3 | Studio 的「组织操作系统」主张尚未被证明；当前证据只支持「制度设计 + 部分实现」 | 事实 6-11 | 高 |
| 4 | Studio 的潜在差异化资产（授权/证据/公司包）真实存在，但成立条件未满足 | 事实 5、8、9 + 设计文档 | 中 |
| 5 | todos 的组织层缺口是结构性的，但可以通过产品扩张补；其工位领先是实质性的 | 事实 1-4 | 中高 |
| 6 | 若只赌未来 12 个月的产品成功概率，todos 高于 Studio | 成熟度/分发/产品面差距；无市场数据 | 中 |
| 7 | 若赌「AI 公司 OS」这个品类，Studio 的概念设计最完整，但实现是最弱一环 | 本仓文档 + 代码 | 中 |

### 9.3 对 Studio 最不利的 8 个事实

1. **工位不是工位**：没有 per-attempt worktree/branch/checkpoint，merge 是模拟。
   这意味着「代码交付」这条主线目前没有真正闭合。
2. **组织没有授权**：worker 只能 comment/evidence 等六动作，拿不到 transition；
   「部长批策划 / QA 打回工程」是 daemon 在走状态机，不是 agent 在行使权力。
3. **联签不可信**：会签三人可以是同一 daemon 定时岗，同进程替三个身份签字；
   没有 quorum、没有独立 session、没有利益冲突检查。
4. **经验不积累**：lessons 空、无 per-agent 记忆、无技能库；同样的错误会重复犯，
   能力不会随单量增长。
5. **工程未闭环**：无 CI、无 release、测试依赖本机 Node 24 假设；文档跑在代码前面，
   17 甚至还有合并冲突标记。
6. **产品面未成形**：没有统一指挥台、没有桌面/移动；制作人的注意力分散在
   CLI、8787、8789、Taiga、Matrix 五个面。
7. **冷启动太重**：YouTrack/Taiga/Matrix/dsh/agent.yaml 多个前置；没有 demo 模式，
   新用户无法在十分钟内看到第一单。
8. **外部协议未落地**：api 包是 skeleton，MCP 已拍板但未排期；公司还不能被外部
   agent 雇佣/审计。

### 9.4 对 Studio 最有利的 6 个事实

1. **控制面是确定性**：FSM、预算 reserve→settle、断路、收割四要件、证据、哨兵，
   比「LLM 当调度器」更可审计、更可复现。
2. **组织模型是独有**：公司=git 目录、2-9 级、部门树、工号、人事档案、报表；
   todos 没有这套。
3. **写闸与台账是硬机制**：wkey、署名、唯一写入者、append-only events；
   这是制度可信度的底座。
4. **上下文工程更深**：L0-L5、分层指纹、Blind 读面、untrusted 消毒；
   比 todos 的 charter/role/skill 三层更细。
5. **公司包是潜在分发资产**：git 网址即公司、依赖清单、插件 allowlist、信任锚；
   如果安全基线做扎实，可能是「AI 公司的 npm」。
6. **dsh 深度 + 本地主权**：todos 对 dsh 是通用 ACP 浅支持；Studio 可以做到
   usage/steer/session/插件的深宿主，且公司数据在本地。

### 9.5 强/中/弱评级（按当前证据，不按愿景）

| 维度 | todos | Studio | 主要依据 |
|---|---|---|---|
| 工位执行 | **强** | **弱** | worktree/checkpoint vs AIWS/no merge |
| 组织抽象 | **弱** | **强（设计）/中（实现）** | no org vs company/levels/personnel |
| 治理/证据 | 中 | **强（机制）/中（执行）** | permissions/audit vs wkey/evidence/ledger；但 env/quorum 有缺口 |
| 授权机制 | 中（工具开关） | **弱（无授权图/quorum）** | 两者都没有制度授权，Studio 更弱 |
| 记忆/技能 | **强** | **弱** | memory/skills vs empty lessons |
| 产品/交互 | **强** | **弱** | desktop/mobile vs CLI/read-only panel |
| 生态/分发 | **强** | **弱** | 20 runtimes/MCP vs 4/partial |
| 工程/发布 | **强** | **弱** | CI/release vs no CI |
| 自主性 | **未证明** | **未证明** | todos 单 principal；Studio 目标多 principal |
| 数据主权 | 中（BYOC 但平台元数据） | **强**（本地/自托管） | 部署形态 |

### 9.6 会改变判断的测试

以下任何一项跑不通，本文的乐观部分应作废：

1. **7 天自治演习**：固定公司、预算、指标，制作人只在 P0 事故介入；
   记录每次介入、授权链、证据。
2. **黄金路径 <30 分钟**：安装 → demo 公司 → 建单 → dsh 计划 → 确认 → 构建 →
   diff 评审 → merge → 证据/成本入账。
3. **工位恢复**：kill 后从 checkpoint 恢复；两个 attempt 并行不冲突。
4. **授权图**：部长在额度内批准；超额升级；同一进程不能替两个角色签字；
   quorum 有效。
5. **记忆/技能**：同类单返工率下降；技能复用率可测；记忆不引入新的错误。
6. **CI/发布**：push 触发全绿；release tag 可复现；Node 24 锁定生效。

### 9.7 结论边界

- 未对 todos 做源码审计，只依据公开文档；其「Unconfirmed」项不当作事实。
- 没有市场/客户数据，不对 todos 的规模、留存、收入做判断。
- 本机测试在 Node 25 下运行，失败项不能直接归因为产品缺陷，但暴露了 CI/工具链问题。
- Studio 处于预 1.0，本文的负面结论是「当前证据不足」，不是「永远不行」。

---

## 十、结论

1. **以当前证据，todos 是一个成熟的单主人工位产品；Studio 是一个设计文档更系统、实现滞后、
   产品面未成形的预 1.0 框架。** 两者不是同一层，但成熟度差距是真实的，不能用
   「品类不同」把它一笔带过。
2. **Studio 的组织主张目前未被证明。** 它有的是骨架（公司目录/层级/岗位）和肌肉
   （daemon/预算/证据），缺神经（授权图/quorum/对手方）和记忆（技能/记忆/教训）。
   在没有 7 天自治演习之前，「组织」应被视为设计目标，不是既成事实。
3. **这不意味着方向错。** 制度层是 todos 当前产品模型不做的空位；但空位不等于机会，
   只有把工位/记忆/授权补到可用，机会才成立。
4. **优先级：指挥台、工位、授权图。** 先跑通一条 vertical slice（demo 公司 → 建单 →
   计划 → 构建 → 评审 → merge → 证据/成本），再谈多公司/多机/更多运行时。
5. **一句话：todos 的空是产品边界，Studio 的空是核心承诺尚未兑现。**
   前者可以用产品扩张解决，后者必须用机制和证据解决；本文的乐观部分，取决于
   9.6 的测试是否跑通。

> 如果只能记一句：**先把「组织」跑成事实，再谈「组织」有多大。**
