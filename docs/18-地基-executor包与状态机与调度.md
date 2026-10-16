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
