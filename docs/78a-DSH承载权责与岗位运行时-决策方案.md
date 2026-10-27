# 78a · DSH 承载权责与岗位运行时：决策方案

> 版本：v0.1，2026-10-27。
> 性质：**78 的前置决策方案/工作稿**，不是 78 正文、不是现行契约、不是实现单，也不是能力证明。
> 上位：69–72（技术抽象）、75–77（技术细节总纲/公共语义/运行记录）；78 独占 DSH/CLI/agent loop、平台、部署与工作区绑定。
> 纪律：本文件不新增核心概念，不重定义 76/77 的对象或字段，不分配 `BIND-`/`D78-` 稳定 ID；若 78 采纳，由 78 按 75-§二分配 ID、补绑定档案与失败/退出。
> 证据口径：DSH 事实来自锁定版本 `0.2.0-rc.2` 的随包 README 与公开文档；外部事实给 URL。
> **本文没有执行 DSH 真机探针**：DSH 段落是随包 README 的契约事实，不等于本机已加载、已拦截或沙箱已生效；78 的绑定必须补真实探针、负向结果和失败/退出。

---

## 〇、结论先行

**一句话：能借 DSH，而且应该借；但只能借它的“机制层”，不能把“正当性层”交出去。**

更具体地说：

1. **DSH 适合承载**：岗位运行时的工具面、文件沙箱、审批、persona、agent preset、subagent 过滤、session/证据。
2. **DSH 不适合承载**：谁是岗位、谁被任命、谁有权授予/撤回、禁配与分离、最终责任、验收与问责、公司台账、跨公司承诺、跨框架规范。
3. **外部控制不是越强越好**：对“每一步思考/每个工具调用”做外部审批，代价高且脆弱；对“不可逆/对外效果”做外部闸门，代价可控且必要。正确边界是**按效果分级**，不是按 agent 分级。
4. **系统提示词是软限制**：persona、AGENTS.md、plan mode 只能降低误用概率，不能作为安全控制；硬约束必须落在“没有这个工具 / 没有这个凭据 / 沙箱不允许 / 网关拒绝 / 外部独立检查”。
5. **岗位 ≠ agent loop**：岗位是权责与义务的组合；loop 只是实现。多数岗位共用同一 ReAct loop，用 preset + 工具白名单 + 沙箱 + persona + 模型区分；自定义 loop 只给确定性系统岗或严格工作流。
6. **推荐方案 C：宪法在外、机制在内、效果分级、证据在外。** 不推荐 A（全外部控制）、B（全 DSH 原生）、D（把 DSH 当公司 OS）。

**推荐方案的一句话架构：**

```text
Studio Next 宪法/公司目录/台账
  → 编译 Position Runtime Manifest（岗位运行时清单）
  → DSH profile/preset + 轻量 position 插件执行
  → 外部效果闸门（沙箱/凭据/网关/网络）
  → DSH 事件 + 外部台账 + 独立验收
```

DSH 是身体，Studio Next 是宪法；不要把宪法写进 persona。

---

## 一、问题、边界与判断标准

### 1.1 当前事实

- Studio Next 当前是**外部控制面**：daemon 组装 L0–L5、经网关写平台、收割台账；executor 以 DSH 为主，但主要通过 CLI/适配器调用，`dsh-bridge` 只做上下文 overlay，不是策略插件。
- 71 已把“能做/被认定/配了/有权/实际生效/做成”分开；77 已有执行计划锁、出工/出工段、能力十三态、H0a–H4。
- 76 已有 `DEF-POS-01` 岗位定义、`DEF-POS-02` 拟任、`DEF-AUTH-01/02` 四态授权、`DEF-CAP-01/02` 能力需求。
- 73 已明确 DSH 是参考绑定，不垄断；78 尚未写。

### 1.2 问题不是“要不要 DSH”，而是“控制放在哪一层”

四个必须分开的问题：

1. **正当性**：谁有权做、谁负责、谁验收、谁承接——这是公司制度，不是宿主能力。
2. **技术许可**：这次会话实际能看见/调用哪些工具、能写哪里、能拿哪些秘密——这是宿主机制。
3. **能力**：模型/工具/插件实际能不能做——这是能力供给。
4. **证据**：发生了什么、谁做的、是否被独立核验——这是记录与审计。

四者不能互相冒充。DSH 可以很好地承载 2 和 3 的一部分；1 和 4 的“公司账”必须留在 Studio Next。

### 1.3 判断标准

| 标准 | 问题 |
|---|---|
| 安全性 | 对提示注入、越权、自我修改、供应链、外泄是否真的挡得住 |
| 简洁性 | 是否减少重复的上下文/策略/进程，而不是把复杂度藏进插件 |
| 可移植性 | 换宿主/换框架后，公司定义、权责、历史是否还在 |
| 组织表达力 | 岗位、任命、禁配、验收、问责能否表达，而不只是“agent 能调什么工具” |
| 证据 | 拒绝、批准、偏离、未知是否可复核，能否进公司台账 |
| 成本 | 延迟、审批疲劳、插件维护、版本升级、故障面 |

### 1.4 四个区分

| 区分 | 含义 | 不能混为 |
|---|---|---|
| Authority / Permission / Capability | 有权 / 被允许 / 能做 | “模型说它能做”不等于有权 |
| Legitimacy / Mechanism | 正当性 / 执行机制 | DSH 插件能拒绝，不等于它有权定义公司规则 |
| Hard / Soft | 不可被模型改写 / 只能影响模型判断 | persona、AGENTS.md 不是 hard |
| Effect class | 本地可逆 / 共享写 / 对外通信 / 秘密 / 不可逆 | 不能按“agent 重不重要”分级 |

---

## 二、DSH 能做什么：按扩展点盘点

> 以下为 DSH `0.2.0-rc.2` 的随包 README 事实；版本升级必须重新探针，不把本文当稳定 API。

### 2.1 组合、岗位与 persona

| 扩展点 | 能做什么 | 对 Studio Next 的意义 |
|---|---|---|
| Profile / bundle / patch | 用 Cordis 组合插件树；profile 可锁定依赖与 patch 层 | 可作为“部署绑定”，不是公司定义 |
| `dsh-agent-preset` | 为 agent 声明子插件列表；不同 preset 可有不同工具/persona/loop 组件 | 天然适合“岗位族运行时”：executor/reviewer/coordinator 各一个 preset |
| `dsh-persona` | 为单个 agent 遮蔽/替换 system prompt 前缀与后缀；`complete` 可只保留该前缀 | 适合岗位身份与语气；**仍是软限制** |
| `dsh-agent-instructions` | 加载 `AGENTS.md`/`CLAUDE.md` 作为有界、带来源的用户消息 | 适合工作区规范；不构成授权，不覆盖直接用户/系统指令 |
| `dsh-agent-loop` | 标准 ReAct loop；`ctx.agents.create()` 可编程创建；自定义 `Agent` 仅在标准生命周期不足时 | 大多数岗位不需要自定义 loop |

**关键事实**：preset 是**子插件组合**，不是“一个 prompt 模板”。同一份 DSH 可以给不同岗位不同工具、不同沙箱、不同 persona，而不需要复制整个进程。

### 2.2 工具流水线：最接近“硬策略”的运行时点

`dsh-tools` 的流水线：

```text
tools/pre-execute（allow / deny / ask）
  → ctx.tools.guard（单调守卫，拒绝后不可被后续监听器改回允许）
  → tools/execute（超时/重试/指标包装）
  → tools/post-execute（检查/替换/附加上下文）
  → tools/result（只观测）
```

可用能力：

- `ctx.tools.restrict(filter)`：对单个 agent 的工具做允许/拒绝掩码，掩码取交集；被隐藏的工具不会出现在模型 schema 中。
- `ctx.tools.guard(guard)`：注册单调同步守卫；返回理由即拒绝。
- `tools/pre-execute` waterfall：原生插件可以做 allow/deny/ask，比 Claude/Codex 命令 hook 更完整。
- `tools/post-execute`：检查或替换结果、附加反馈、阻断结果。
- PTC 模式：模型可以写代码调用工具（`run_code`）；嵌套工具仍走策略，但代码执行本身是额外风险面。

**判断**：这是 DSH 内最值得利用的“硬-ish”层。它对**模型误用**很强；对**能执行任意代码/改配置的恶意 agent**不是绝对硬边界，仍需 OS 沙箱/独立用户/不可写配置。

### 2.3 沙箱与审批：文件强、网络/进程弱

| 机制 | 事实 | 限制 |
|---|---|---|
| `dsh-sandbox` | `read-only` / `workspace-write` / `danger-full-access`；无法强制执行则 `SANDBOX_UNAVAILABLE` 失败关闭；更宽模式需审批 | **只覆盖文件操作**；不表达网络、进程、系统调用、设备、凭据限制 |
| `dsh-sandbox-policy` | 每会话模式与 workspace root；切换写入会话日志；模型可见策略说明 | 一个会话一个主 workspace；网络/进程不在词汇中 |
| `dsh-fs-observation-policy` | 写/编辑前必须先读；读后变化拒绝（`FS_STALE_VERSION`） | 只防盲写/陈旧写，不是权限 |
| `dsh-user-approval` | `ask`/`never`；缺应答者 fail-closed；审计 `approval/asked/decided` | 审批是“一次性决定”，不是独立验收 |
| `dsh-bash-sandbox` | 受限 shell；平台后端（Seatbelt/Landlock/ACL 等） | 与 `dsh-sandbox` 同属文件策略；网络/进程需外部/容器 |

**结论**：DSH 本地沙箱适合“工作目录/文件写入”这一层；如果要挡网络外泄、进程注入、跨用户读取，必须在**容器/微VM/远程执行器/OS 用户/网络策略**上做，不能把 DSH 沙箱当完整安全边界。

### 2.4 子 agent 与团队：能表达协作，不能表达组织

| 机制 | 事实 | 不能 |
|---|---|---|
| `dsh-subagent` | 一次性/可续接子 agent；每子可设 `persona`、`toolFilter`、`agentOptions`、`maxDepth`；进程内/ACP/SDK/Codex/Claude 后端 | 外部后端保留自己的权限系统；不是统一政策 |
| `dsh-tool-subagent` | 模型可委派；可限制子级工具、模型、深度 | 委派关系不等于任命/授权 |
| `dsh-experimental-agent-team` | Lead + teammates；持久 mailbox、共享任务板；in-process；共享 workspace | 实验性；无独立工作目录；无跨进程；不是组织图 |
| `dsh-tool-workflow` | 编排/工作流 | 不是组织治理 |

**结论**：subagent/team 适合“一个岗位把工作分给下级执行体”的运行时协作；**职位、职级、任命、部门、最终责任、分离**仍然只能在 Studio Next 外部表达。不要把 DSH team 当组织架构。

### 2.5 证据、持久化与恢复

| 机制 | 事实 | 对 Studio Next 的意义 |
|---|---|---|
| `dsh-session-persistence` | 追加式会话日志；单写者（进程内）；flush 才是持久屏障 | 可作为证据来源，不是公司台账 |
| `dsh-session-checkpoint-policy` | 在模型请求前、顶层工具可能产生外部副作用前、下一步前持久化 | 支持“先证据后效果”；崩溃后 `TOOL_OUTCOME_UNKNOWN`，不自动重试 |
| `session/event` / `tool/*` / `approval/*` / `hook/*` | 可观察事件 | 可导出到 Studio Next `REC-EVT`，形成可复核链 |
| `dsh-mcp-client` | 外部 MCP 工具注册进 `ctx.tools` | 与原生工具走同一策略流水线 |

**结论**：DSH 日志是**证据材料**，不是公司账本。必须外部落账、外部哈希链、外部独立验收。

### 2.6 DSH 明确不能承载的

- 岗位定义、拟任、任命、职级、部门、最终责任、禁配与分离的**正当性**。
- 谁有权授予/撤回、谁有权验收、谁有权重开、谁承担对外最终责任。
- 公司台账/记录谱系/承诺/清算的最终事实。
- 跨框架规范与可移植公司定义。
- 网络/进程/系统调用的完整隔离（本地沙箱只做文件）。
- 跨进程单一写入/互认围栏（DSH session 单写者是进程内语义）。
- 组织图与“团队=部门”的等同。

### 2.7 DSH 的“硬/软”分级

| 层 | 强度 | 说明 |
|---|---|---|
| 工具不存在/被 restrict 隐藏 | 强（对模型） | 模型看不到 schema，调用 `UNKNOWN_TOOL`；但能改配置/代码的 agent 可能绕过 |
| `tools/pre-execute` / `guard` deny | 强（对模型） | 在进程内、执行前；对代码执行/插件篡改不是绝对 |
| 沙箱文件策略 | 强（对文件） | OS 后端 fail-closed；只覆盖文件 |
| 审批 fail-closed | 强（对人/自动应答） | 无应答者即拒绝；但审批≠验收 |
| 凭据范围/外部网关 | 很强（对外部） | 在 agent 之外；不受 prompt 影响 |
| 命令 hook deny/ask | 中 | 外部进程，但配置读取一次；`continue:false` 无运行级效果；`updatedInput` 不生效 |
| persona/AGENTS.md/plan mode | 软 | 只影响判断；不可作为控制证据 |

---

## 三、外部实践：别人怎么做，能借什么

### 3.1 Claude Code：宿主权限 + 子 agent 独立上下文

事实（官方文档）：

- 权限规则支持 allow/deny/ask，可按工具与输入参数匹配；hooks 可拦截 `PreToolUse`/`PostToolUse` 等；Bash 有 sandbox；subagent 有**独立上下文、独立 system prompt、独立工具访问、独立权限**；插件/skills 可复用。
- 托管设置（managed settings）可把组织策略放到项目之上。

启示：

- **子 agent 的“独立工具 + 独立权限 + 独立上下文”是岗位运行时的正确形态**，不是给主 agent 一段“你现在是审计员”的 prompt。
- 权限规则是宿主机制，但仍然要防止 agent 改配置/绕过 hook；配置必须在 agent 不可写的位置。
- 即使有权限/hook，prompt injection 仍可能通过允许的工具/数据外泄；需要 effect-level 边界（网络/秘密/网关）。

### 3.2 Codex：沙箱模式 + 审批 + AGENTS.md

事实（官方资料/公开说明）：

- Codex 以 sandbox mode + approval policy 组合控制命令执行；`AGENTS.md` 提供工作区指引；高风险操作需要审批/受限模式。

启示：

- **“模式 + 审批”是产品化最小集**，但组织语义仍需外部。
- `AGENTS.md` 是软指引，不是权限；不能拿它当控制证据。
- 不同宿主的安全模型不同，跨宿主统一政策不能只靠 CLI 参数。

### 3.3 OpenAI Agents SDK：guardrails 是应用层检查，不是安全边界

事实：

- input/output/tool guardrails 可以在工具执行前后做检查、替换、tripwire；blocking/parallel 执行；hosted tools 与部分 built-in tools 不走同一 guardrail 管线。
- 官方定位是“checks/validations”，不是对抗性安全边界。

启示：

- **工具级 guardrail 比 agent 级 input/output 更接近执行点**；但仍需把“不可用能力/凭据范围/外部检查”作为硬边界。
- 不能把所有工具都假设走同一 guardrail；MCP/hosted/built-in 的覆盖差异要显式记录。

### 3.4 CaMeL：能力/数据流，才是抗提示注入的方向

事实（arXiv 2503.18813）：

- CaMeL 用 Privileged LLM 生成计划、Quarantined LLM 解析不可信数据，解释器跟踪数据流与 capabilities，在工具调用前按策略允许/拒绝/要求确认；在 AgentDojo 上 67% 任务可证明安全，但 utility 有损失；不解决纯文本误导/钓鱼等非目标。
- 关键不是“更强的 system prompt”，而是**控制流/数据流隔离 + 能力标签 + 策略执行**。

启示：

- 高风险岗位应把“读不可信内容”和“有对外副作用的工具”分开：读取/解析用无工具或只读的子 agent；有副作用的执行由受限执行体做。
- Studio Next 的“复核/审计/执行分离”与 CaMeL 的双 LLM 在结构上同源：**独立上下文、独立能力、独立责任**。
- 完整 CaMeL 成本高，不必一次实现；先借“能力标签 + 子 agent 隔离 + 外部效果闸门”。

### 3.5 Microsoft Agent 365 / Entra Agent ID：身份与生命周期在运行时之外

事实：

- Entra Agent ID 为 agent 提供一等身份、sponsor/owner、生命周期工作流、条件访问、风险检测、网络控制、审计日志；Agent 365 是 agent 注册/治理面。
- 它不替代 agent runtime；它管“谁是这个 agent、谁负责、能访问什么、何时回收”。

启示：

- **身份/生命周期/访问治理是独立层**，和 Studio Next 的“岗位/任命/授权/最终责任”同层，不应塞进 DSH persona。
- Studio Next 的公司目录 + 台账可以视为“轻量 ASOR/身份治理”，但不需要复制企业 IAM 的全部能力；先把岗位/任命/授权/证据做对。

### 3.6 Workday ASOR：agent 系统记录是独立产品类别

事实：

- ASOR 把 agent 纳入组织与劳动力视图：谁拥有、角色、技能、成本、使用、合规、审计；支持 MCP/A2A/OTel 等。
- 它是**系统记录/治理面**，不是执行宿主。

启示：

- 市场已经分出“runtime harness”和“agent system of record”两类；Studio Next 的差异化应在**公司宪法 + 权责/证据**，不是再做一个 DSH。
- DSH 负责 runtime；Studio Next 负责 company system of record + accountability。

### 3.7 DSH agent team：协作，不是组织

事实：

- Lead + teammates，持久 mailbox/任务板，in-process，共享 workspace；不支持独立工作目录/跨进程/自动 owner 释放。
- 它是“一个小团队在一个工作区协作”的原语。

启示：

- 可以用来做项目组/临时协作，但不能当部门/职级/任命/分离。
- 组织图仍在 Studio Next；DSH team 只是“这个项目里的协作容器”。

### 3.8 安全讨论的三个共识

1. **系统提示词不是安全控制**：它不能对抗主动绕过；证据应是“某个模型之外的执行点拒绝了请求”，不是 prompt 文本。
2. **lethal trifecta**：私有数据 + 不可信内容 + 对外通信，三者同时存在时风险最高；至少要切断一条（通常是出站）。
3. **能力/凭据范围比“更聪明的模型”可靠**：能只读就不要写，能固定工具就不要任意命令，能项目级就不要全局。

### 3.9 外部实践综合判断

| 实践 | 可借 | 不可直接借 |
|---|---|---|
| Claude Code | 子 agent 独立上下文/工具/权限；宿主权限规则；sandbox | 把 hook 当完整策略；把 prompt 当控制 |
| Codex | sandbox mode + approval；AGENTS.md 作为软指引 | 把 AGENTS.md 当权限 |
| OpenAI Agents SDK | 工具级 guardrail；tripwire；审批 | 把 guardrail 当对抗性安全边界 |
| CaMeL | 控制/数据流隔离；capability；无工具解析器 | 全量实现成本；非目标场景 |
| Entra Agent ID | 身份、sponsor、生命周期、条件访问、审计 | 企业 IAM 全量复制 |
| Workday ASOR | 系统记录、owner/role/cost/telemetry | 把 ASOR 当 runtime |
| DSH | preset/persona/tools/sandbox/approval/subagent/session | 把 DSH 当组织/宪法 |
| Aliyun harness 安全 | 四边界（读/写/命令/外部工具）、allow/ask/deny、最小权限、日志 | 只做静态规则，不做 effect gate |
| ACC | 能力显式声明、子 agent 衰减、可审计 | 预印本，未生产验证 |

---

## 四、四种方案与取舍

### 4.1 方案 A：全外部控制（当前形态的加强版）

```text
daemon 组装全部上下文/策略 → 调 DSH 黑盒 → 解析输出 → 网关写
```

- 优点：公司规范/权限/证据完全在外部；换宿主容易；审计独立。
- 缺点：无法细粒度控制工具；prompt injection 在 DSH 内发生；外部只能看输出/日志；上下文重复、延迟高、解析脆弱；容易变成“外行指挥内行”。
- 适用：多宿主、强外部审计、低交互；不适合需要大量工具协作的岗位。
- 判断：**不作为主方案**；保留为高风险/跨框架的兜底。

### 4.2 方案 B：全 DSH 原生

```text
岗位 = agent preset；权限 = tools/sandbox；组织 = subagent/team；prompt = persona
```

- 优点：最少重复；最佳 UX；利用 DSH 的类型化工具/沙箱/审批；开发快。
- 缺点：公司被绑定到 DSH；rc API/插件供应链风险；DSH 没有岗位/任命/禁配/验收/问责；团队是实验性、共享 workspace；跨框架/可移植性丧失；仍需外部台账。
- 适用：Studio Next 放弃“框架/可移植公司”，变成 DSH 上的一个产品。
- 判断：**与当前哲学冲突**；如果选 B，应明确放弃跨框架规范，不要假装两者兼得。

### 4.3 方案 C：混合（推荐）

```text
Studio Next：宪法/公司目录/授权/台账/验收/问责
DSH：岗位 preset + 工具/沙箱/审批/persona/subagent + 事件
外部效果闸门：OS/容器/网络/凭据/网关
```

- 优点：利用 DSH 的机制，保留公司正当性与可移植性；硬边界在正确位置；可按效果分级，不必每一步外部审批。
- 缺点：两层设计；需要 manifest 编译器/position 插件/证据导出；插件供应链；DSH 版本兼容。
- 适用：当前“开源框架 + 纯配置公司 + 多宿主”的方向。
- 判断：**推荐**；复杂度集中在“窄腰”（manifest + effect gate + evidence），不是全面复制。

### 4.4 方案 D：把 DSH 当公司 OS

```text
DSH team = 部门；preset = 岗位；persona = 权责；session = 台账
```

- 优点：单系统、叙事统一。
- 缺点：DSH team 实验性/in-process/共享 workspace；没有任命/禁配/最终责任/独立验收；session 不是公司台账；跨进程/跨公司/审计不足；锁定极强。
- 判断：**现在不成立**；除非 DSH 自己演进成有身份、组织、治理的 OS，且你接受锁定。

### 4.5 方案对比

| 维度 | A 全外部 | B 全 DSH | **C 混合** | D DSH OS |
|---|---|---|---|---|
| 对抗性安全 | 高（效果边界） | 中（依赖 DSH） | 高（效果边界） | 低–中 |
| 简洁/开发成本 | 低 | 高 | 中 | 高 |
| 可移植/跨框架 | 高 | 低 | 高 | 低 |
| 组织表达力 | 中 | 低 | 高 | 中 |
| 证据/问责 | 高 | 低 | 高 | 中 |
| 延迟/体验 | 低 | 高 | 高 | 高 |
| 锁定风险 | 低 | 高 | 低–中 | 高 |
| 适合当前阶段 | 否 | 仅产品化 | **是** | 否 |

---

### 4.6 外部控制为什么贵，什么时候不贵

**贵的是“逐步骤外部控制”：**

- 外部要复制上下文、解析输出、猜测工具意图；DSH 内的工具调用/中间结果对外部不可见，只能靠日志补。
- 每个动作都要过网络/审批，延迟高；审批疲劳会让人点“同意”。
- 外部只能看到“最终说了什么”，很难判断“它是否准备偷偷做”；prompt injection 在 DSH 内已经发生。
- 不同宿主/CLI 的协议不同，外部适配器会越来越厚，最后变成另一套 runtime。

**不贵的是“效果级外部控制”：**

- 只在不可逆/对外/涉密/资金/生产/权威变更处设闸门；数量少、边界稳定、可审计。
- 闸门看的是“请求的效果”（写哪个仓库、发到哪个域、转多少钱、改谁的权），不是“agent 的每一步思考”。
- 低风险本地可逆动作留在 DSH 内，用工具白名单/沙箱/证据约束；高风险动作才外部审批。

**所以：** 不要把“外部控制”理解成“每步都管”；它是“宪法 + 效果闸门 + 证据”，不是“远程操纵 agent 的每个 token”。这也回答了“外部强行控制内部 agent 代价更大”的直觉：**逐步骤是，效果级不是。**

## 五、推荐架构：四平面 + 窄腰

### 5.0 先回到 Studio Next 的哲学：五条约束

方案不是从 DSH 的能力反推，而是从 Studio Next 的根命题反推。以下五条是硬约束，任何绑定都不能违反：

1. **公司是持续责任共同体，不是 agent 集合**（63-§1.1）。执行体可以换，责任、历史与承诺不能消失；把公司等同于 DSH profile/team，就失去了公司同一性。
2. **岗位是权责与义务的组合，不是执行器**（63-§1.4、76-DEF-POS-01）。岗位可以空编；空编不能解释实际动作由谁负责。DSH preset 只是岗位的运行时投影，不是岗位本身。
3. **授权不放大、可撤回；最终责任不可转移**（63-I-6/I-7）。DSH 插件可以拒绝工具调用，但它不能生成权、不能把“模型被允许”当成“公司已授权”。
4. **主体可替换而历史与承诺连续**（63-I-10）。如果权责/组织只存在于 DSH 插件/preset/persona 中，换宿主就换掉了公司；这违反可替换性。
5. **事实、记录、证据、验收分开**（63-I-2、72）。DSH session 日志是记录材料，不是事实本身，也不是公司验收；外部台账与独立验收不可省。

**由此推出：** DSH 可以承载“机制”，不能承载“正当性”；可以承载“岗位运行时”，不能承载“岗位本身”；可以承载“证据材料”，不能承载“公司账本”。这不是保守，而是这套哲学的直接结论。

### 5.1 四平面

```text
┌──────────────────────────────────────────────────────────┐
│ 1. 宪法面（Studio Next，外部、可移植）                    │
│ 公司定义/岗位/任命/Authority Policy/义务/禁配/承诺/最终责任│
│ 任务合同/验收/问责/公司台账/跨公司关系                     │
└───────────────────────┬──────────────────────────────────┘
                        │ 编译 Position Runtime Manifest
                        ▼
┌──────────────────────────────────────────────────────────┐
│ 2. 运行面（DSH，可替换宿主）                               │
│ profile/preset/persona/tools.restrict/tools.guard/         │
│ sandbox/approval/subagent/session-checkpoint              │
└───────────────────────┬──────────────────────────────────┘
                        │ 产生效果/事件
                        ▼
┌──────────────────────────────────────────────────────────┐
│ 3. 效果面（外部闸门，按 effect class）                     │
│ OS/容器/网络/凭据/网关/合并/发布/支付                      │
└───────────────────────┬──────────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────────┐
│ 4. 证据面（Studio Next + 独立位置）                        │
│ REC-EVT/证据包/台账/独立验收/问责/结清                     │
└──────────────────────────────────────────────────────────┘
```

### 5.2 窄腰：Position Runtime Manifest

建议 78 采纳一个**绑定级**对象（名称可改；不新增核心概念）：

**Position Runtime Manifest（PRM）**：把 76/77 已有的岗位/授权/执行计划/能力需求，编译成 DSH 可执行的运行时清单。

它不替代 76/77，只是绑定层的“执行投影”：

| PRM 段 | 来源 | 内容 |
|---|---|---|
| `identity` | `DEF-POS-01`、`REC-LIFE-05` | position_id、holder_id、appointment_ref、engagement_id、work_id |
| `authority` | `DEF-AUTH-01/02`、`REC-AUTH-02` | 可用/保留/禁止/未覆盖的**动作范围**、条件、期限、父链、禁配结论 |
| `plan` | `REC-WORK-05` | definition_revision、contract_ref、qualification_refs、capability_descriptors、binding_profile_ref |
| `tools` | `DEF-CAP-01` sideEffectRequests + `DEF-AUTH-02` | 允许/禁止的工具、MCP server、PTC 是否允许、web 域、subagent 允许的 preset |
| `sandbox` | `REC-WORK-05` + 绑定 | read-only/workspace-write、workspace root、网络策略（外部）、秘密类别 |
| `approval` | `DEF-AUTH-02` reserved + effect class | ask/never、哪些效果需要谁批 |
| `persona` | `DEF-POS-01` + 公司定义 | 岗位说明/行为准则的引用；**不是权源** |
| `evidence` | `REC-EVT` + 72 | 要导出的事件、保留、脱敏、独立验收位置 |
| `validity` | `REC-AUTH-02`、`REC-WORK-06` | 生效/失效、复审、撤回、manifest 签名 |

**规则**：

- PRM 只能**收紧**部署/公司策略，不能放宽；与 76-§3.12 的 `deploymentTighteningOnly` 一致。
- PRM 必须引用 ID+版本，不引用“当前最新”。
- PRM 过期/签名无效/引用不一致 → DSH 插件拒绝启动，不降级到宽权限。
- PRM 的“权”来自外部 Authority Policy；DSH 只执行，不生成权。

### 5.3 运行面：一个轻量 position 插件，而不是一堆 fork

建议 78 设计一个 `studio-next-position` 类插件（名称由 78 定；以下为职责）：

1. 在 `agent/created` 时读取 PRM（从 agent 不可写的受控路径），验签/验期/验引用。
2. 用 `ctx.tools.restrict` 应用工具白名单；未列工具不可见。
3. 用 `tools/pre-execute` + `ctx.tools.guard` 实现：
   - `prohibited` → deny（优先）；
   - `reserved` → ask/转外部审批，或 deny；
   - `permitted` → allow（条件/期限/父链校验）；
   - `uncovered` → deny（不是 allow）。
4. 设置 sandbox mode/workspace root；reviewer/auditor 默认 read-only；executor `workspace-write`。
5. 设置 approval policy（`ask`/`never`），高风险 effect 必须外部批准。
6. 绑定 persona/岗位说明（软），但**不把 persona 当权限**。
7. 配置 subagent：只允许 PRM 列出的子 preset、最大深度、子工具过滤；子 agent 继承**衰减**，不继承全权。
8. 发出 `position/manifest-loaded`、`position/denied`、`position/drift` 等事件；导出到外部台账。
9. 与 `dsh-session-checkpoint-policy` 配合：在工具副作用前持久化；崩溃后 `TOOL_OUTCOME_UNKNOWN` 不自动重试。

**不做什么**：

- 不在插件里定义“谁是部长/谁是宰相”；那在外部组织图。
- 不把公司台账写进 DSH；只导出事件。
- 不依赖 Claude/Codex 命令 hook 做核心策略；hooks 作为兼容/补充。
- 不允许 agent 改 PRM/插件/profile；配置在 agent 不可写的位置。

### 5.4 效果面：按 effect class 设闸门

| 类别 | 例子 | 默认执行位置 | 硬闸门 |
|---|---|---|---|
| E0 只读/本地可逆 | 读文件、搜索、分析 | DSH | 沙箱/只读；无外部 |
| E1 工作区写/可回滚 | 改代码、生成文档 | DSH | `workspace-write` + git checkpoint + 证据 |
| E2 共享写/合并 | push、merge、发布分支 | 外部网关 | 独立复核 + wkey/合并租约 |
| E3 对外通信/网络 | 邮件、Web、外部 API | 外部代理/白名单 | 出站 allowlist；敏感数据过滤 |
| E4 秘密/凭据 | token、密钥、客户数据 | 凭据代理 | 短时、按任务、按类别；不进 prompt |
| E5 不可逆/资金/生产 | 支付、合同、生产部署 | 外部人审 + 网关 | 双人/独立审批；禁止 agent 单独 |
| E6 权威变更 | 任命、授权、规则、清算 | Studio Next 治理 | 外部治理；DSH 不参与 |

**原则**：E0/E1 尽量在 DSH 内完成，减少外部审批；E2–E6 必须外部闸门。这样外部控制成本有限，且挡在真正不可逆的地方。

### 5.5 硬/软清单

| 控制 | 放在哪 | 强度 | 备注 |
|---|---|---|---|
| 工具不存在/被隐藏 | DSH `tools.restrict` | 强（对模型） | 不是对代码执行 |
| 工具调用 allow/deny/ask | DSH `pre-execute`/`guard` | 强（对模型） | 原生插件优先于 hook |
| 文件写范围 | DSH sandbox | 强（文件） | 只文件；网络/进程外置 |
| 审批 | DSH approval | 强（fail-closed） | 不是验收 |
| 凭据范围 | 外部 broker | 很强 | 不受 prompt 影响 |
| 外部写/合并/发布 | 外部网关 | 很强 | wkey/租约/回执 |
| 网络出站 | 外部代理/容器 | 很强 | DSH 本地沙箱不覆盖 |
| 组织/任命/禁配/验收 | Studio Next | 制度 | DSH 不表达 |
| persona/AGENTS.md/plan | DSH | 软 | 只降低误用概率 |

---

## 六、岗位类型 × 运行时矩阵

> 这不是新的岗位分类；只是把 66/76 的岗位族映射到 DSH preset/loop/工具/沙箱。具体岗位仍由公司定义。

| 岗位族 | 权责要点 | DSH preset/loop | 工具 | 沙箱/工作区 | persona | 子 agent | 审批 | 证据 |
|---|---|---|---|---|---|---|---|---|
| **执行岗** | 在合同内交付；无对外承诺/验收权 | 标准 ReAct；native 工具模式 | fs 读写、bash（沙箱）、搜索、测试、present；无 web 或白名单；无 subagent | workspace-write；每工作/尝试独立 worktree | 岗位说明+方法 | 禁止 | 沙箱升级/外部写需批 | 全量 session + 工具/审批事件 |
| **复核/验收岗** | 独立判断；不能写交付物 | 标准 ReAct；只读 | read/search/diff/证据查询；无 write/bash（或只读 bash）、无 web | read-only；独立 worktree/只读副本 | 复核准则 | 禁止 | 写类一律拒绝 | 复核记录+证据引用 |
| **协调/管理岗** | 分解/派工/协调；不自己验收 | 标准 ReAct + plan mode | read/search/task board/subagent/todo/present；无 write/bash | read-only 元数据区 | 协调规则 | 允许，白名单子 preset，maxDepth 1 | 超预算/越界需批 | 派工/任务板/子结果 |
| **审计/巡检岗** | 只读监督、告警、叫停；不能改业务 | 标准 ReAct 或确定性检查 | 事件流/台账查询/告警；无 write/bash/网络 | read-only；独立凭据/进程 | 审计准则 | 禁止 | never（写类直接拒） | 发现/告警/复核 |
| **专家岗** | 领域建议/受限执行；无组织权 | 标准 ReAct + skill/工具包 | 领域工具；按 PRM 白名单 | read-only 或受限 workspace-write | 专业准则 | 按 PRM | 按 effect | 领域证据 |
| **系统岗** | 调度/台账/校验；确定性 | 自定义 Agent 或普通插件/cron；可无 LLM | 内部固定工具 | 专用工作区 | 无/最小 | 禁止 | 自动/无需 | 系统事件+对账 |
| **临时项目/团队岗** | 时间-bound 协作；无长期职位 | 标准 ReAct + team（仅协作） | 项目工具；共享只读/受控写 | 项目 workspace；Dsh team 共享 | 项目说明 | 按项目 | 按 effect | 项目任务板+证据 |

### 6.1 Loop 策略

- **默认**：所有岗位用 `dsh-agent-loop` 标准 ReAct；差异靠 preset、工具、沙箱、persona、模型。
- **复杂工作**：`dsh-plan-mode` + 任务板；仍用标准 loop。
- **确定性流程**：`dsh-tool-workflow` 或自定义 `Agent`（仅当标准生命周期不足）；系统岗优先无 LLM。
- **不要**为每个岗位写一个 loop：维护成本高、证据不可比、升级困难；loop 不是岗位。
- **不要**把“更高级岗位”映射成“更复杂的 loop”：职级是权责，模型/loop 是能力。

### 6.2 模型与独立性

- 复核/审计岗使用与执行岗**不同模型/不同上下文/不同会话**；独立性不等于“换个 prompt”。
- 高风险事项的复核者不得复用执行者的 session/上下文；只读证据。
- 模型贵/大不等于有权；资格/授权另判。
- 外部模型/CLI 子 agent 保留自己的权限系统；不能假设 DSH 的 PRM 自动约束它们。

### 6.3 工作目录

- 每个工作/尝试一个 worktree；DSH `cwd` 指向它；新尝试新 session。
- 执行岗 `workspace-write`；复核/审计 `read-only`；协调岗只读元数据区；系统岗专用。
- `dsh-fs-observation-policy` 防盲写/陈旧写；外部 git 网关负责 push/merge/发布。
- 共享 workspace 只用于显式项目团队；默认不共享。
- DSH sandbox 只文件；网络/进程/秘密靠外部。

### 6.4 证据

- 所有岗位导出：session、tool call/result、approval、sandbox deny、position deny、subagent 关系。
- 复核/审计只读这些证据；验收/问责在外部。
- `REC-WORK-07` 段边界：能力/授权/交接/暂停/恢复；DSH 新 session/preset 对应新段。
- 崩溃/超时：`TOOL_OUTCOME_UNKNOWN`，外部对账，不自动重试。

---

## 七、组织架构：外部图，DSH 只做运行时投影

### 7.1 什么留在 Studio Next

- 部门、职级、岗位、拟任、任命、代理、替补、空缺、撤销。
- Authority Policy、Grant/Delegation、禁配/分离、最终责任、验收/问责/救济。
- 组织绩效、整体资源、继任/清算、跨公司关系。
- 公司定义包、台账、证据、承诺。

### 7.2 DSH 能投影什么

- 每个岗位一个 preset（或 preset family），把工具/沙箱/persona/模型固定下来。
- 协调岗的 subagent 关系：父 agent 只能 spawn PRM 允许的子 preset，深度/数量受限；子权限**衰减**。
- 团队协作：DSH team 用于一个项目内的 Lead+teammates；共享 workspace/任务板；不是部门。
- 审计岗独立进程/凭据/只读视图；不被被审计 agent 控制。

### 7.3 不能做的映射

| 错误映射 | 为什么错 |
|---|---|
| “部门 = DSH team” | team 是 in-process 协作容器；部门是持续责任边界 |
| “职级 = 模型档/loop 复杂度” | 职级是责任范围/决定幅度；模型是能力 |
| “岗位 = persona” | persona 只影响判断；岗位是权责/义务 |
| “任命 = 创建 agent” | 创建执行体不等于任命；任命有接受/生效/禁配/交接 |
| “最终责任 = 主 agent” | 最终责任是制度位置；主 agent 只是执行体 |
| “审计 = 只读 prompt” | 审计要独立位置/凭据/证据/叫停权 |

### 7.4 组织运行时的最小实现

1. 外部组织图/岗位/任命 → 生成每个岗位的 preset 与 PRM 模板。
2. 每次工作 → PRM 实例（grant/plan/effect/evidence）。
3. DSH position 插件按 PRM 收紧；子 agent 按 PRM 衰减。
4. 外部台账收事件；复核/审计独立读取。
5. 组织变更 → 新 PRM/新 preset；在途工作按旧 PRM；不热改。

---

## 八、插件与适配清单

### 8.1 直接复用（不再造）

| DSH 包 | 用途 | 备注 |
|---|---|---|
| `dsh-agent-loop` | 标准 ReAct | 大多数岗位 |
| `dsh-agent-preset` | 岗位族 preset | 静态基线 |
| `dsh-persona` | 岗位身份/语气 | 软 |
| `dsh-agent-instructions` | AGENTS.md 工作区规则 | 软 |
| `dsh-tools` | 工具注册/策略/guard | 核心 |
| `dsh-agent-tool-presentation` | 每 agent 选择 native/PTC/both | 高风控岗位固定 native，禁 PTC |
| `dsh-permission-presets` | 沙箱+审批的具名组合 | 只是两个旋钮；不表达逐工具权责 |
| `dsh-tool-fs` / `dsh-fs-observation-policy` | 文件读写/先读后写 | 工作目录 |
| `dsh-tool-bash` / `dsh-bash-sandbox` | 受限 shell | 文件沙箱 |
| `dsh-tool-web` | Web | 需出站策略 |
| `dsh-mcp-client` | MCP 工具 | 同策略流水线 |
| `dsh-sandbox` / `dsh-sandbox-policy` | 文件沙箱/模式 | 只文件 |
| `dsh-user-approval` | 审批 | fail-closed |
| `dsh-subagent` / `dsh-tool-subagent` | 委派/子 agent | 衰减 |
| `dsh-experimental-agent-team` | 项目协作 | 实验性；不作组织 |
| `dsh-session-persistence` / `dsh-session-checkpoint-policy` | 会话/检查点 | 证据来源 |
| `dsh-hooks-claude-code` / `dsh-hooks-codex` | 兼容既有 hooks | 非核心策略 |
| `dsh-authorization` | 凭据授权 flow | 不是业务授权 |

### 8.2 需要新建（薄层）

| 组件 | 职责 | 归属 |
|---|---|---|
| `studio-next-position` | PRM 加载/验签/工具/沙箱/审批/persona/subagent 收紧/事件 | 78 绑定 |
| `studio-next-evidence` | DSH 事件 → `REC-EVT`/台账；哈希链；脱敏 | 78 + 77/72 |
| `studio-next-worktree` | worktree/cwd/段边界；与 `REC-WORK-06/07` 对齐 | 78 + 77 |
| `studio-next-gateway` | 外部写/合并/发布/支付闸门；wkey | 78 + 现行网关 |
| `studio-next-org-context` | 只读组织/岗位上下文注入 | 78（只读） |
| 自定义 `Agent` | 仅系统岗/确定性检查 | 78，需单独审 |

### 8.3 与现有 `dsh-bridge` 的关系

- 现有 `packages/dsh-bridge`：生成 overlay，要求 agent 命令显式 `--patch`；是**上下文注入**，不是策略。
- 新 position 插件：在 DSH 进程内、agent scope 内执行；是**策略/能力边界**。
- 两者可以并存：bridge 继续做 L0–L5 上下文；position 插件做工具/沙箱/审批。不要用一个替代另一个。
- 现有 `packages/adapters/src/dsh.ts` 是 CLI shell-out；要使用插件，需要 profile/SDK/ACP 启动方式，不是只加 CLI 参数。

### 8.4 供应与版本

- DSH `0.2.0-rc.2` 精确锁；插件 peer 范围与宿主版本校验；升级另走变更/验证。
- 能力包可执行内容独立；定义包纯配置；插件签名/摘要/来源/许可；不可信插件不加载。
- PRM/插件/配置放在 agent 不可写的位置；profile 用只读挂载/独立用户。
- 插件退役/回滚按 H2/H3 交接，不假装热更。

---

## 九、迁移与验证

### 9.1 分期

| 阶段 | 做什么 | 验收 |
|---|---|---|
| P0 决策 | 采用 C；确认“宪法在外、机制在内”；确认不把组织搬进 DSH | 制作人签字/记录 |
| P1 spike | 3 个岗位：执行/复核/协调；3 个 preset；PRM 最小字段；工具白名单/沙箱/persona/审批 | 负向用例全过；事件可导出 |
| P2 硬边界 | OS 沙箱/容器/网络/凭据/网关；worktree；checkpoint | 越权/外泄/自改配置被挡；证据可复核 |
| P3 组织 | 组织图/任命/PRM 生成；subagent 衰减；审计独立 | 岗位/任命/分离/验收路径完整 |
| P4 跨宿主 | ACP/SDK 绑定；其他 harness；规范可移植 | 同一公司定义可换宿主；损失报告 |

### 9.2 P1 负向用例（必须）

1. prompt injection 要求调用未授权工具 → 工具不可见/被 deny，记录拒绝。
2. 复核岗尝试 write/edit → 拒绝；尝试用 bash 写 → 拒绝/只读。
3. 执行岗尝试 approve/验收/改合同 → 拒绝。
4. 子 agent 尝试超出父 grant 的工具/目录 → 拒绝/衰减。
5. PRM 过期/签名无效/引用不一致 → 拒绝启动，不降级。
6. agent 尝试改 profile/preset/hooks/PRM → 文件只读/沙箱/OS 拒绝。
7. 网络外泄（含 web/MCP）→ 出站拦截；秘密不可读。
8. 工具中途崩溃 → `TOOL_OUTCOME_UNKNOWN`；不自动重试；外部对账。
9. 审计岗被业务 agent 关闭/篡改 → 独立进程/凭据；不可被关。
10. 审批缺失/应答者失败 → fail-closed。

### 9.3 验收证据

- 拒绝事件、审批事件、沙箱拒绝、PRM 校验结果、session/checkpoint、外部网关回执。
- 独立复核者按 `REC-EVT`/证据包检查；不以“prompt 写了”作为证据。
- 指标：任务成功率、策略延迟、误拒率、审批量、证据完整率、总成本。
- V 层：P1 至少 V0–V2；真机探针 V5；跨宿主 V3/V4 另做。

---

## 十、风险与反例

| 风险 | 事实/机制 | 处置 |
|---|---|---|
| **把 prompt 当控制** | system prompt 与不可信输入同一流；不能对抗主动绕过 | 硬约束放工具/沙箱/凭据/网关；prompt 只做质量/默认拒绝 |
| **lethal trifecta** | 私有数据 + 不可信内容 + 对外通信 | 切断出站；数据分级；读取/执行分离 |
| **自改配置** | agent 可写 profile/hooks/PRM 则一切策略失效 | 配置在 agent 不可写位置；独立用户/只读挂载；禁 `danger-full-access` |
| **in-process guard 被绕过** | 插件与 agent 同进程；代码执行/插件篡改 | OS 沙箱/容器；高风控岗位禁 PTC/任意代码；插件供应链 |
| **DSH 沙箱只文件** | 网络/进程不在词汇 | 容器/网络命名空间/代理/远程执行；不夸大 DSH 沙箱 |
| **hooks 限制** | 只 command；配置一次读取；`continue:false` 无运行级效果；`updatedInput` 不生效 | 核心策略用原生插件；hooks 只兼容/补充 |
| **agent team 实验性** | in-process、共享 workspace、无独立工作目录/跨进程 | 只做项目协作；组织/部门留在外部 |
| **外部子 agent 权限不同** | ACP/Claude/Codex 保留自己的权限系统 | 统一策略用进程内 DSH 子 agent 或外部沙箱包裹；不假设 |
| **DSH rc API** | 0.2.0-rc.2，插件 API 可能变 | 精确锁、绑定层隔离、升级探针、回退 |
| **审批疲劳** | 每步审批会让人麻木 | 按 effect class；低风险自动，高风险人审 |
| **证据不足** | 只有 session 日志，没有外部验收 | 外部台账/独立验收；DSH 日志只是材料 |
| **锁定** | 把权责/组织都写进 DSH | 权责/组织/规范留在外部；DSH 可替换 |

---

## 十一、需要制作人决定的事项

| # | 决策 | 推荐 | 备选/影响 |
|---|---|---|---|
| 决策 1 | 是否采用 C（宪法在外、机制在内、效果分级） | **是** | A 全外部：安全但笨重；B 全 DSH：简单但锁死/缺治理；D 不成立 |
| 决策 2 | 首批岗位 preset | 执行/复核/协调 3 个 | 只做执行：缺独立验收；全做：过重 |
| 决策 3 | 是否新建 `studio-next-position` 插件 | **是**（薄层） | 只用 profile/preset：动态 PRM/收紧/证据不足 |
| 决策 4 | 硬边界技术 | 本地 OS 沙箱 + 容器/远程用于网络/进程 | 只 DSH 沙箱：网络/进程不挡 |
| 决策 5 | 证据导出 | DSH 事件流/ACP + JSONL 兜底 → 外部台账 | 只读日志：不能实时/独立 |
| 决策 6 | DSH team 的定位 | 仅项目协作，不作组织 | 当部门：缺任命/分离/跨进程 |
| 决策 7 | 自定义 agent loop | 仅系统岗/确定性流程；其他标准 ReAct | 每岗一 loop：维护/证据不可比 |
| 决策 8 | PRM 的归属 | 78 绑定层对象；不新增核心概念 | 写进 76/77：越权/重复 |
| 决策 9 | 插件供应链 | 精确锁/摘要/来源/许可/审核；不可信不加载 | 任意插件：等于把公司交给供应链 |
| 决策 10 | 是否公开“不完整实现” | 按 73-D6；覆盖外拒绝 | 假装完整：违反 D6 |

---

## 十二、来源

### DSH（锁定 0.2.0-rc.2，随包 README）

- `@deepseek-ai/dsh`：profile/bundle/patch、plugin 管理。
- `@deepseek-ai/dsh-agent-loop`：标准 ReAct、`ctx.agents`、自定义 Agent 边界。
- `@deepseek-ai/dsh-agent-preset`：每 agent 子插件组合。
- `@deepseek-ai/dsh-persona`：scoped persona、`complete`。
- `@deepseek-ai/dsh-agent-instructions`：AGENTS.md 作为有界用户消息。
- `@deepseek-ai/dsh-tools`：`restrict`、`guard`、`tools/pre-execute`、`tools/post-execute`、PTC。
- `@deepseek-ai/dsh-sandbox` / `dsh-sandbox-policy`：文件模式、fail-closed、升权。
- `@deepseek-ai/dsh-fs-observation-policy`：先读后写/陈旧写。
- `@deepseek-ai/dsh-user-approval`：ask/never、fail-closed、审计事件。
- `@deepseek-ai/dsh-hooks-claude-code` / `dsh-hook-protocol`：command hooks、PreToolUse deny/ask、限制。
- `@deepseek-ai/dsh-subagent` / `dsh-tool-subagent`：子 agent、toolFilter、persona、maxDepth、外部后端。
- `@deepseek-ai/dsh-experimental-agent-team`：in-process team、共享 workspace、实验性。
- `@deepseek-ai/dsh-session-persistence` / `dsh-session-checkpoint-policy`：追加日志、检查点、`TOOL_OUTCOME_UNKNOWN`。
- `@deepseek-ai/dsh-mcp-client`：MCP 工具注册进 `ctx.tools`。
- `@deepseek-ai/dsh-authorization`：凭据授权 flow，不是业务授权。

### 外部

- DeepSeek Harness 公共页：<https://www.deepseek.com/en/harness/>
- Claude Code Hooks：<https://code.claude.com/docs/en/hooks>
- Claude Code Permissions：<https://code.claude.com/docs/en/permissions>
- Claude Code Subagents：<https://code.claude.com/docs/en/sub-agents>
- Claude Code Sandboxing：<https://code.claude.com/docs/en/sandboxing>
- Codex：<https://developers.openai.com/codex/>；安全说明：<https://openai.com/index/running-codex-safely/>
- OpenAI Agents SDK Guardrails：<https://openai.github.io/openai-agents-python/guardrails/>
- CaMeL：<https://arxiv.org/abs/2503.18813>；HTML：<https://ar5iv.labs.arxiv.org/html/2503.18813>
- Microsoft Entra Agent ID：<https://learn.microsoft.com/en-us/entra/agent-id/what-is-microsoft-entra-agent-id>
- Microsoft Agent 365 / Entra：<https://learn.microsoft.com/en-us/microsoft-agent-365/admin/capabilities-entra>
- Workday ASOR：<https://blog.workday.com/en-us/managing-ai-powered-future-of-work.html>
- Lethal trifecta：<https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/>
- System prompt 不是安全控制：<https://www.kovrr.com/blog-post/a-system-prompt-is-not-an-ai-security-control>
- ACC：<https://zenodo.org/records/18704577>
- Harness 安全四边界（阿里云开发者社区）：<https://developer.aliyun.com/article/1740731>

> 外部资料只作局部作证；不证明 Studio Next 已实现，也不证明某个产品完整符合其宣传。DSH 行为以锁定版本的包 README/探针为准。
