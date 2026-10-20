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
- **保留词表**：`bug`（断路器自动开单——不定级、待人定级后派）与 `task`（定时岗单物化
  type）为系统保留，workflows 不得声明同 id（docs/51 W-9）——防止公司流静默劫持引擎
  写死行为。岗单/断路单恒走等级回退。
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
