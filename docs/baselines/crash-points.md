# MIG-01 崩溃注入五点夹具清单 · 初代

> **头注**
> - 日期：2026-10-28
> - git HEAD：`32aaf2a75e3978c00fd16f13948b16dcc7de8860`（分支 `dev`）
> - 工具链：bun **1.4.3** / node **v24.21.0**（`.mise.toml` 固定；命令统一 `mise exec --`）
> - 执行者：DeepSeek-V41-Flash（StudioNext 施工代理；IMPL-01-01 / LANE-T）
> - 性质：**MIG-01 初代基线，只读登记，不改行为**（不改 `crash-points.ts`、不改测试、不加注入点）
> - 唯一权威：`apps/daemon/src/engine/crash-points.ts` 头注「五点冻结表（本表即唯一权威；改动走批示）」；本件为其 MIG-01 快照登记
> - 依据：docs/02 F3-11（五点各 kill 一次；prepare→execute→receipt；恢复先查 receipt）、docs/17-§2 主循环七相位、docs/plan/04 §1.6、v2/16 §一（MIG-01 冻结对象含 crash 五点夹具清单）

---

## 一、机制（env 门控的受控测试缝，非生产功能）

| 项 | 事实 |
|---|---|
| 开关 | 环境变量 `SN_CRASH_POINT=<点名>`；模块加载时读一次（`ARMED`） |
| 命中行为 | `crashHook(point)` 在该点 `process.kill(process.pid, 'SIGKILL')`——**硬杀**，验证非优雅死后的恢复 |
| 未命中 | 未设环境变量或点名不符＝**零行为**（`no-op`）；五处调用点在 `engine.ts` 生产代码内，默认无影响 |
| 配置面 | `daemon.yaml` 不收此键——机制化测试缝，不是可配置生产开关 |
| 测试手法 | spawn 真 serve 进程（demo fake 栈＋tmp 库）→ 注入点 SIGKILL 自杀（child exit `signal=SIGKILL`）→ 同库同目录以干净 env 重启 → 恢复断言（不重不漏/不双派发/不丢终态/库完整） |
| 恢复判据 | 一切以台账事件（receipt）为据；重启后判重靠事件派生计数与意图键，不信任易失内存 |

---

## 二、五点冻结表（名称 / 注入位置 / 语义）

注入位置以 `apps/daemon/src/engine/engine.ts` 实测行号为准（同文件五处 `crashHook(...)` 调用点；`grep -c "crashHook(" engine.ts`＝5）。**行号为 2026-10-28 HEAD 快照**，engine.ts 拆分（MIG-06）后行号会漂移——语义锚以冻结表的「注入位置」文字描述为准，复算以 `grep -n "crashHook('"` 的点名与调用形态为准，不把行号当不变量。

| # | 点名 | 相位（docs/17-§2） | 注入位置 | 缝隙语义（F3-11 三段） | 恢复语义 / 断言 |
|---|---|---|---|---|---|
| ① | `dispatch-reserved` | 相位 3 派发 | `engine.ts:1040`（`executeDispatch`：预算 reserve 双行落账后、`adapter.launch` 前） | **prepare 完成、execute 未启**（半派发） | 无 DISPATCH 回执 → 单可重派，attempt 由事件派生不漂移；预算沿用未结预留（adopt 不双落）；同单走完终态 |
| ② | `dispatch-launched` | 相位 3 派发 | `engine.ts:1057`（`launch` 返回后、`work_records` 在途落账前） | **execute 已启动、无回执无在途账** | 孤儿产物无害；重启重派由单工位收口；不双派发；同单走完终态 |
| ③ | `harvest-verdict` | 相位 4 收割 | `engine.ts:1259`（`harvestOne`：四要件判定后、`GATE_PASS` 落账前） | **execute（收割）完成、receipt 缺失** | 意图键仍占用（seenKeys 不释放）→ 新意图重派 attempt+1；孤儿在途由 serve 启动例行接管收口 `interrupted`（R-B，docs/38-§2）；**接管≠收割**（四要件无据不判 GATE_FAIL）；预算 adopt 不双落 |
| ④ | `heartbeat-write` | 相位 7 落账/心跳 | `engine.ts:2136`（`tick`：零动作拍 `HEARTBEAT` 事件写入前） | **落账/心跳相位缝** | 重启后无害：心跳不重、拍序/游标续用、库完整。**如实降级**——v0 无「批量汇总落账」面，只证重启无害（见 §五-1） |
| ⑤ | `shutdown-drain` | 停机（生命周期） | `engine.ts:2296`（`dispose`：drain kill 循环后、在途注销前） | **SIGINT 停机 drain 中途** | 已收口账面存活；重启同单 attempt 递进、走完终态；在途处理有据 |

> 冻结纪律：新增注入点一律**先在冻结表登记新行（点名/相位/注入位置/缝隙语义四列）再加测试**（plan/04 §1.6）。本代不新增、不改名、不移动任何行。

---

## 三、`CRASH_POINTS` 实测长度

- **登记值（本代）**：**5**
- **复算命令**：

```bash
mise exec -- node --input-type=module -e "import{CRASH_POINTS}from'./apps/daemon/src/engine/crash-points.ts';console.log(CRASH_POINTS.length,CRASH_POINTS.join(','))"
```

- **本次实际输出**（exit 0）：

```text
5 dispatch-reserved,dispatch-launched,harvest-verdict,heartbeat-write,shutdown-drain
```

- **互证**：`grep -c "crashHook(" apps/daemon/src/engine/engine.ts` ＝ **5**（五处调用点）；冻结表数据行 ＝ 5；五点测试用例 ＝ 5。定义位置 `crash-points.ts:39`，成员类型 `CrashPoint`（`:48`），钩子 `crashHook`（`:57`）。
- **备注**：截至本代，仓内**未发现**对 `CRASH_POINTS.length` 的断言（`grep -rn "CRASH_POINTS"` 仅命中定义/类型消费与文档）；长度校验按 plan/04 §二 作为**波门命令**执行（MIG-04 ④ 现值 5），不在测试内硬编。MIG-04 记录面扩展时按冻结表先加行、长度随表更新（IMPL-04-07）。

---

## 四、夹具清单（落盘件）

| 文件 | 行数 | 职责 |
|---|---|---|
| `apps/daemon/src/engine/crash-points.ts` | 61 | 受控测试缝：五点冻结表＋`CRASH_POINTS`（5）＋`CrashPoint` 类型＋`ARMED`（env 读取）＋`crashHook`（SIGKILL） |
| `apps/daemon/test/engine/crash-points.ts` | 167 | spawn 侧测试基建：`BIN`（CLI 入口）、`writeServeConfig`、`seedDueJob`、`spawnServe`（READY 信号等待）、`killSurvivors`、`tickSeqs`、`newCaseRoot`、`ServeProc`；测试专用，不进 `src` |
| `apps/daemon/test/engine/crash-injection.test.ts` | 446 | 五点回归集：1 个 `describe`＋5 个 `it`（每点一测），用例级超时 `180_000ms`；每测 spawn 真 serve→硬杀→同库重启→恢复断言 |

**五点用例（标题原文）**：

| # | 用例行 | 标题 |
|---|---|---|
| ① | `crash-injection.test.ts:149` | ① dispatch-reserved：reserve 落账后 launch 前硬杀 → 重启同单重派 attempt 不漂、预算 adopt 不双落、走完终态 |
| ② | `:233` | ② dispatch-launched：launch 后在途落账前硬杀 → 孤儿产物无害、重启重派单工位收口、走完终态 |
| ③ | `:281` | ③ harvest-verdict：收割判定后 GATE_PASS 落账前硬杀 → 不双派发、孤儿在途启动例行接管收口、新 attempt 走完终态 |
| ④ | `:342` | ④ heartbeat-write：零动作拍心跳写入前硬杀 → 重启无害（心跳不重、拍序/游标续用、库完整）【如实降级面】 |
| ⑤ | `:388` | ⑤ shutdown-drain：SIGINT 停机 drain 中途硬杀 → 已收口账面存活、重启同单 attempt 递进走完终态 |

---

## 五、诚实边界

1. **④ 为降级断言**：v0 形态＝零动作拍落 `HEARTBEAT` 事件，**无批量汇总落账面**；因此该点只证「重启后无害」，不证「汇总面幂等」——与测试头注同口径，不以断言口径美化。
2. **③ 语义已转正**：孤儿在途由 serve 启动例行接管收口 `interrupted` 是**生产面行为**（R-B，docs/38-§2），不是测试特判；接管≠收割（四要件无据不判 GATE_FAIL），预算沿用 adopt 不双落。
3. **fake 失忆补偿**：demo fake 平台状态在 serve 进程内存，硬杀即失忆；重启后的等价工作由「重挂欠账岗」（`next_run_at=1`）再驱动——补偿的是 fake 平台失忆，**不绕过引擎幂等**，判重仍全以台账 receipt 为准。
4. **本件只登记，不执行**：崩溃注入套未在本单运行（测试台账归 MIG-02；崩溃套的具体波门在 MIG-06 ①，本单为只读快照）。夹具行数/用例数/调用点数为静态实测，`CRASH_POINTS.length` 为运行时实测。
5. **不改行为**：本单未改 `crash-points.ts`、未改 `engine.ts` 五处调用点、未改测试；`git status --porcelain -- apps packages scripts templates` 为空（见 registration.md §四）。

---

## 六、复算命令（可整块重跑）

```bash
# 五点名称与长度（期望 5 个点名）
mise exec -- node --input-type=module -e "import{CRASH_POINTS}from'./apps/daemon/src/engine/crash-points.ts';console.log(CRASH_POINTS.length);console.log(CRASH_POINTS.join(','))"   # expected: 5 / dispatch-reserved,dispatch-launched,harvest-verdict,heartbeat-write,shutdown-drain

# 五处注入调用点（期望 5 行，行号 1040/1057/1259/2136/2296）
grep -n "crashHook('" apps/daemon/src/engine/engine.ts

# 冻结表定义锚（期望 :39 CRASH_POINTS、:48 类型、:57 钩子）
grep -n "export const CRASH_POINTS\|export type CrashPoint\|export function crashHook" apps/daemon/src/engine/crash-points.ts

# 夹具行数与用例数（期望 61/167/446 行、5 用例）
wc -l apps/daemon/src/engine/crash-points.ts apps/daemon/test/engine/crash-points.ts apps/daemon/test/engine/crash-injection.test.ts
grep -c "^  it(" apps/daemon/test/engine/crash-injection.test.ts

# 环境变量门控（期望 6 处：缝文件 :6/:51/:54；测试基建 :117/:118 赋值；测试头注 :14）
grep -rn "SN_CRASH_POINT" apps/daemon/src apps/daemon/test
```

> 波门引用：docs/plan/04 §二 MIG-04 ④ 使用 `CRASH_POINTS.length`（本代现值 5）；MIG-06 ① 使用 `bun run test -- crash-injection.test.ts`（本单不跑）。
