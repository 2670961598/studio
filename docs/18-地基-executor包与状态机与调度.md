# 18 · 地基设计：executor 包 · 状态机 · 调度

> v1.0（呈批稿）｜ 2026-10-16 ｜ 主 PM：Kimi
> 制作人定调：CLI 部分单独做、单独测、有基类；状态流转设计清楚；定时任务优先用现成好库，
> 不重复造轮子。本文是这三块地基的设计。

---

## 一、executor 包（packages/adapters，独立库）

**独立做、独立测、可单独发布**——它是框架与外部世界的唯一接触面。

### 1.1 基类（TS 抽象类）

```typescript
abstract class ExecutorAdapter {
  abstract readonly name: string
  // 能力声明（静态描述）：预算帽/单轮cancel/续跑/AGENTS.md 通道/成本原生
  abstract readonly capabilities: ExecutorCapabilities
  // 版本+能力实测探测（launch 前必跑；不达标明报，绝不静默降级）
  abstract detect(): Promise<DetectResult>          // 例：claude≥2.1.277 才原生读 AGENTS.md
  abstract estimate(task: TaskBrief): BudgetEstimate // 预算预留估算
  abstract launch(task: TaskBrief, env: LaunchEnv): Promise<Handle>
  abstract stream(h: Handle): AsyncIterable<StreamEvent>
  abstract resultStats(h: Handle): Promise<ResultStats>  // {cost,tokens,duration,turns} 成本=价目表折算
  abstract kill(h: Handle, grace_ms: number): Promise<void>
}
```

### 1.2 实现文件（一家一个文件）

`dsh.ts`（默认主力）/ `claude.ts`（参考实现）/ `codex.ts` / `kimi.ts`。
四家的已知坑全部沉淀在各自文件注释+测试里（dsh 的 kill 后 exit 0、claude 的版本门槛、
kimi 的 usage 在 wire.jsonl、codex 无成本字段）。

### 1.3 独立测试套件（不依赖 daemon/YouTrack）

- **fake CLI harness**：shell 脚本模拟各家 CLI 的 stdout/退出行为，覆盖已知坑场景
- golden fixtures：各家的 stream 样本落库，解析器对 fixture 全绿
- 探针 runner 也在这层：适配器写完先过探针集才注册
- `npm test -w packages/adapters` 单独可跑——CLI 升级了先跑这层就知道坏没坏

## 二、状态机（外部状态流转怎么走）

**YouTrack = 状态权威；我们的引擎 = 表驱动 FSM；公司可覆盖状态流（模板化，不写死）。**

### 2.1 迁移表定义（默认模板，公司可替换）

```
flow_by_level:
  L0: [新单 → 已派发 → 证据就绪 → 复验通过 → 已交付]
  L1: [新单 → 待批 → 已派发 → 证据就绪 → 复验通过 → 已交付]
  L2: [新单 → 待批 → 已派发 → 证据就绪 → 复验通过 → 待批 → 已交付]
  ...rollback_edges / type_edges（技术债 promote 等）
```

### 2.1.1 类型流（flow_by_type，DEV-43 / docs/51 v1.1 workflows 段）

等级流之外，单据可按**类型**声明状态流（同项目内长期单/短期单/需求单/bug单/探索单等
各配完全不同的状态集与流转——公司 org-config `workflows:` 段声明，零代码注入引擎）：

- **键形**：FlowTable 键域 `L<n>`（等级）∪ `T:<type>`（类型；类型 id 禁冒号——键命名
  空间隔离，docs/51 W-1）。
- **解析序（冻结）**：`resolveTicketFlow(table, type, level)`——①`T:<type>` 命中优先
  →②回退 `L<level>`→③都未命中 NOOP_UNKNOWN_FLOW。类型流命中时不要求 level；type
  undefined/空串不查 T 键（直落 L 回退）。decide 步2 与 engine flowOf 共用同一函数。
- **终态截断**：类型流 states 可标 `final`（StateFlow.finalStates 携带）；`forwardStates`
  推导主干前向边时左态为终态即截断（终态无主干后继）。状态全集（flowStates）仍含全部
  声明态——多终态（已关闭/不予修复）并列于序表尾部，人类经声明边可达，decide 照常
  识别（成员校验不缩水）。等级流无 finalStates=不截断=行为不变。
- **声明边**：`edges` 映射 type_edges（补充流转：打回/promote/重开终态）。机器不主动走
  声明边（forwardStates 不含——与 rollback_edges 同纪律）；from=final 允许（重开已关单
  的修复路径，复活语义 DEV-42② 同源）。
- **锚点**：五锚 inbox/dispatched/evidence/verified/delivered 必填且须构成主干相邻链
  （approval 可选第六锚，只许插 inbox 后/verified 后两槽——docs/51 W-8）；approval
  缺省以空串哨兵隔离（decide 5a/5b 构造性不命中）。
- **保留词表**：`bug`（断路器自动开单——不定级、待人定级后派）与 `task`（**工单型**定时岗单
  物化 type）为系统保留，workflows 不得声明同 id（docs/51 W-9）——防止公司流静默劫持引擎
  写死行为。断路单/工单型岗单恒走等级回退。例外（127-A 丁案，studio-dev-127 §4.4
  2026-10-22 批）：patrol 巡查物化单 type=`patrol` **不在保留表**——按类型流解析序走
  `T:patrol`（org-config workflows 声明，模板自带五态链：待巡查→巡查中→巡毕纪要→
  巡毕复核→巡毕无产出）；未声明回退 `L<level>`（装载警告面 `jobContractLoadWarnings`
  提示语义退化，不阻断）。
- **合并序（冻结）**：注入表构造序=DEFAULT_FLOW_TABLE（L 键基底）→（后续刀：org-config
  `yt.flows` 覆盖 L 键）→ `T:<type>` 键**永远最上**。与查表优先级（解析序）正交。
- **平台面**：类型可声明 `entity`（userstory/issue/task）——provision 把该类状态建到
  对应实体工作流（多实体档案面）；v1 运行时 CRUD 仍单实体绑定，按类型路由建单归 v2。
  建单初态解析序（IssueCreate.initialState）：显式 > typeInbox[type]（provision 按单据
  类型查收件态）> states[0] > 平台默认。

### 2.2 流转的两个闸（顺序固定）

1. **daemon state-diff（第一道）**：只认机器事件（进程存在/REPORT 落盘/闸门 exit=0）；
   决策纯函数 `decide(state, level, type, lane_lease) → action`
2. **平台 guard（第二道）**：由状态流模板生成 JS guard 挂 YouTrack（D12：每公司自建字段），
   手工/API 越表迁移平台层直接拒

### 2.3 谁能迁

- 状态推进只由 daemon 依机器事件推进，或经网关的结构化动作词（角色×状态×动作词矩阵）
- 制作人任意介入不受限（拖单即语义，daemon 自适应）
- agent 永远拿不到"直接改状态"的通道（网关白名单无此端点）

### 2.4 同步方向

YouTrack → ticket_mirror（活动流 start 游标增量）；框架写 → 经网关 → YouTrack。
SQLite 里不存第二份可变状态，状态永远以 YouTrack 为准、镜像只做加速。

### 2.5 批示载体（D4 未冻结点定稿——studio-dev-130 提案 §6.1.2，制作人 2026-10-22 全批；实现单 studio-dev-171）

**批准信号的载体与归一**（清偿 decide「approved 输入未冻结」拟稿待批点与 C5 同源缺陷——生产 autoApprove:false 从未接线真实批示）：

- **载体＝网关既有 `comment` 动作词**（GATEWAY_ACTIONS 六动词零增删）＋结构化批示行。
  词表 v1（冻结，130-§9 批示项⑤）：`批示:批准｜批示:打回｜批示:拆单｜批示:搁置` 四词。
  行式：行首「批示:」（半角冒号）＋动词；打回理由＝同行动词后文本（**必填**——空理由=畸形拒）。
- **daemon 归一层**（相位 1 采集尾，非新相位）：采集平台活动→拉取受影响单评论→解析批示行
  →**角色校验（fail-closed）**→映射 `approved` 输入（decide 5b 既有点位）或物化动作。
- **角色校验白名单**：批示人 ∈ {ticket.dept 的 leader} ∪ {组织锚白名单（demo 公司=PRIME-0）}
  ∪ {制作人账号}。非白名单署名批示→**忽略＋ESCALATE 事件**（伪造防御：伪造批示=事故）。
  账号不在人员索引（未知 actor）→拒（宁拒不错派）。
- **派单律**（高一级方可派单，制作人 2026-10-22 组织律）：动词「批准」加验
  批示人.level > 被派单人.level（严格高；被派单=assignee，不可解析=拒）。制作人豁免
  （§2.3 任意介入不受限）。越级→拒＋ESCALATE。
- **畸形防御**：一词行多动词歧义、一评论多批示行、越界动词、全角冒号变体、打回空理由
  ——皆=畸形：忽略＋ESCALATE 可观测（fail-closed）。
- **归一语义**（动词→机器行为，v1）：
  - 批准 → `approved=true` 入 decide 5b（待批态派发/交付批放行）；
  - 打回 → **声明边**待批→新单（边须在流表声明——workflows `edges` 或公司覆盖流表；
    缺省等级流未声明该边→状态不动＋可观测，理由不丢）＋理由落事件 note；
  - 搁置 → 状态不动（待批留置即语义）；
  - 拆单 → v1 解析合格不物化（物化归 130-P2）。
- **批示站立（standing）与防回弹**：最近一次批示动词经事件派生（APPROVE=批示消费锚，
  note `verb=` 位区分动词；ESCALATE=资格拒/畸形，不站立）。打回/拆单站立期间引擎
  **不自动呈批**（5a submit_approval 抑制——部长已说 no，机器不反弹未修订件回批位）；
  批准站立=approved 输入（DISPATCH 后消费清零——L2 第二道待批不吃陈旧批准）。
- **幂等**：每条批示评论恰消费一次（事件 note `directive=<评论id>` 派生消费键，
  append-only 不重放）。
- **事件词表零增删**：APPROVE（批示消费锚，四动词通用）＋ESCALATE（拒/畸形/边未声明）
  均为 17-§3 冻结清单既有名。

**与 §2.1.1 类型流的关系**：P1 proposal 类型流声明 `edges: [{待批→新单}]` 后打回边生效；
typeInbox 直落待批（建单不经新单）不与归一层耦合。

## 三、调度（定时任务管理）

> daemon 侧落点：`apps/daemon/src/engine/scheduler.ts`（DEV-45 按域分层归 engine；jobs 表与补跑语义见下）。

### 3.1 现成库盘点（2026 实测调研）

| 库 | 持久化 | 错过补跑 | 结论 |
|---|---|---|---|
| croner | ❌ 进程内 | ❌ | **选用**：表达式解析+触发引擎（活跃维护，量级成熟） |
| node-cron | ❌ | ❌（只有晚醒容差） | 不选 |
| node-schedule | ❌ | ❌ | 不选 |
| Agenda/BullMQ | 要 Mongo/Redis | ✅ | 不选（为调度引入重型外部依赖不值） |

**结论：没有现成库同时给持久化+补跑**（[2026-07 实测综述](https://software.reibuys.com/blog/node-cron-vs-node-schedule-choosing-the-best-node-js-job-scheduler/) 亦确认）。
所以：**croner 当引擎 + 一层很薄的 SQLite 持久化壳**——不是造轮子，是补所有库都缺的那一层。

### 3.2 设计

```
公司目录定时岗配置（D9）──挂载/热更──▶ jobs 表（SQLite）
                                        {job_id, company, dept, cron, role, level,
                                         model_tier, budget_cap, payload,
                                         next_run_at, last_run_at, status}
                                              │
                    daemon 启动 ──扫 next_run_at<=now──▶ 补跑（coalesce 成一次）
                                              │
                    croner 注册 next_run_at ──触发──▶ 唤起（走主循环，不直接驱动）
```

- **错过补跑**：启动时扫 due 槽位，多槽合并跑一次（APScheduler coalescing 语义）
- **不重叠**：同岗同刻只允许一个实例（overrun 保护）
- **失败留痕**：每次跑落 events（耗时/结果/成本），失败走报错升级电路
- **热更**：公司目录改动 → 校验 → 重注册对应 job（不动其他岗）
- 状态归位：调度表只是"什么时候唤起"；唤起后的一切仍走主循环状态机——调度器不是控制面

## 四、三块地基的验收口径

1. `packages/adapters` 独立 `npm test` 全绿（fake harness+golden fixtures+探针）
2. 状态机：任一合法迁移双闸通过、任一非法迁移双闸皆拒（注入测试）
3. 调度：杀 daemon 3 小时重启， missed 槽位补跑一次且仅一次；热更一个岗不影响其他岗
