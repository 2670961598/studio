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

---

## 七、2026-10-28 MIG-04 记录面注入点（第 6 点 `records-commit`）

> **追加登记（只增不删：§一-§六 初代内容与旧五点逐字保留）**
> - 日期：2026-10-28
> - git HEAD（施工基线）：`2bfee5e`（`feat(v2): MIG-04-01..06/08 store 记录面 + cost_daily 限域`；本单七件改动（2 改＋5 新）在工作树，**未 commit**，遵单纪律）
> - 工具链：bun **1.4.3** / node **v24.21.0**（`.mise.toml` 固定；命令统一 `mise exec --`）
> - 执行者：DeepSeek-V41-Flash（StudioNext 施工代理；IMPL-04-07 / LANE-S）
> - 性质：冻结表**新增第 6 点**（登记＋V2 crash 腿）；**①-⑤ 旧五点语义不变**、旧测试不改、**无生产调用点新增**
> - 唯一权威：`apps/daemon/src/engine/crash-points.ts` 头注「六点冻结表（本表即唯一权威；改动走批示）」；本件为其 MIG-04 快照追加登记
> - 依据：plan/05 IMPL-04-07；plan/04 §1.4/§1.9.4-7（V5 三不变量）；docs/v2/16 §四（DOM-04 限域）；docs/v2/17 §1.1 V5 行／§三 NEG-MIG-01/02；docs/v2/05 §三 DOM-05

### 7.1 第 ⑥ 行（冻结表新增行；①-⑤ 行文未改，仅表头括注扩展）

| # | 点名 | 相位（①-⑤ 17-§2；⑥ 记录面） | 注入位置（①-⑤ engine.ts；⑥ V2 crash 子进程） | 缝隙语义（F3-11 三段） |
|---|---|---|---|---|
| ⑥ | `records-commit` | 记录面（DOM-05；**非主循环七相位**） | records 表事务：INSERT 后、COMMIT 前调 `crashHook('records-commit')`（**无生产调用点**——记录提交归属 store，daemon 侧不 import；V2 crash 子进程以 node:sqlite 直写 v14 列） | **记录事务已写未提交**（提交前/后缝隙）：重启即回滚，records 无半截行；events/cost_daily 零副作用；同 recordId 重放只落一行（不重复副作用） |

- **提交前/后缝隙的落法**：⑥ 覆盖「INSERT 已写、COMMIT 未发」的提交前缝隙（硬杀→回滚→无半截行）；同一测试的 commit 腿覆盖提交后缝隙（重启正常 COMMIT→行在且只一行→不重复副作用）。未把提交后拆成独立点名（本代只登记 1 点，避免虚增点数）。
- **⑥ 恢复语义**：以库内**已提交行**为唯一判据——未 COMMIT 的事务由 SQLite 回滚，事务内可见的 `records=2` 在重启后必须回到 `records=1`；同 `recordId` 重放不得产生第二行。

### 7.2 `CRASH_POINTS` 长度与生产调用点复算

```bash
mise exec -- node --input-type=module -e "import{CRASH_POINTS}from'./apps/daemon/src/engine/crash-points.ts';console.log(CRASH_POINTS.length);console.log(CRASH_POINTS.join(','))"
# 本次实际输出（exit 0）：
# 6
# dispatch-reserved,dispatch-launched,harvest-verdict,heartbeat-write,shutdown-drain,records-commit

grep -c "crashHook('" apps/daemon/src/engine/engine.ts
# 本次实际输出：5（旧五点；⑥ 无生产调用点，未进 engine.ts）

grep -rn "records-commit" apps/daemon/src
# 本次实际命中：crash-points.ts 头注 3 处＋CRASH_POINTS 成员 1 处（无 engine.ts/其他生产件）
```

### 7.3 V2 crash 腿（真子进程 SIGKILL；无 mock）

| 文件 | 行数 | 职责 |
|---|---|---|
| `apps/daemon/test/v2/crash/records-crash.test.ts` | 267 | 5 用例：冻结表登记、崩溃前种子基线、误点名零行为负控、真 SIGKILL 崩溃、重启正常提交；断言三不变量 |
| `apps/daemon/test/v2/crash/fixtures/records-crash-child.ts` | 101 | 真子进程入口：openLedger→BEGIN→INSERT records→同步打印 `PRE_COMMIT`→COMMIT 前 `crashHook('records-commit')`；未命中点名恒 ROLLBACK＋exit 91（绝不提交） |
| `apps/daemon/test/v2/crash/fixtures/records-crash-scenario.ts` | 165 | 确定性场景：种子 event/cost_daily/record 与缝隙 record 的 v14 列值＋原样 INSERT（测试夹具，不进生产面） |

**实测证据（2026-10-28，本机；命令照录）**：

```text
$ mise exec -- bun run test:v2 -- apps/daemon/test/v2/crash
stdout | records-crash.test.ts > records-commit 崩溃注入（提交前缝隙） > 命中 records-commit：INSERT 后 COMMIT 前 SIGKILL → 重启同库无半截行、events/cost_daily 零副作用
[records-commit] signal=SIGKILL code=null 事务内records=2 重启后={"version":15,"records":1,"events":1,"costDaily":1}

Test Files  1 passed (1)
     Tests  5 passed (5)
```

- **硬杀证据**：`run.signal === 'SIGKILL'`、`run.code === null`；子进程 stdout 同步证据行 `PRE_COMMIT {"version":15,"records":2,"events":1,"costDaily":1,"recordId":"…"}`——证明 SIGKILL 前 INSERT 已在事务内生效、COMMIT 从未发出。
- **重启证据**：同库重开 `{"version":15,"records":1,"events":1,"costDaily":1}`、`PRAGMA integrity_check='ok'`、缝隙 `recordId` 查无行、种子行仍为 `effective`——未提交事务回滚，无半截行。
- **重放证据**：再 spawn 子进程正常提交同一 `recordId` → `COMMITTED {"mode":"commit","version":15,"records":2,"events":1,"costDaily":1,"inserted":true}`；记录按 id 恰 1 行、events/cost_daily 仍各 1 行（零重复副作用）。
- **负控证据**：`SN_CRASH_POINT=dispatch-reserved` 时子进程**不自杀**（`signal=null`），回滚后 `exit 91`＋stderr `CRASH_HOOK_NOT_ARMED`，库零变化——env 门控非「必死进程」，且测试不靠 exit 0 冒充崩溃。

**三不变量落点**：

| 不变量 | 断言位置 | 本轮实测 |
|---|---|---|
| 不丢终态 | 崩溃前种子 records `effective`／events `CLOSE`／cost_daily `final` 跨崩溃与重放均存活 | 崩溃后 1/1/1、提交后仍 1/1/1；种子行在场 |
| 不假绿 | 必须 `signal=SIGKILL`＋`code=null`；误点名必须 `exit 91`＋ROLLBACK；事务内 `records=2` 与重启后 `records=1` 的差值＝未提交 | 两项均实测通过 |
| 不重复副作用 | 重启提交后 records=2（每 id 一行）、events=1、cost_daily=1；`integrity_check=ok` | 实测通过 |

### 7.4 同期 NEG 覆盖与门禁

| 项 | 落点 | 结果 |
|---|---|---|
| NEG-MIG-01（改/删 `cost_daily` 被拒） | `packages/store/test/v2/cost-frozen.test.ts`（6 用例：触发器在位／UPDATE／DELETE／append-only 仍可追加） | 绿；v12 触发器 ABORT 消息逐字断言、行零变化 |
| NEG-MIG-02（备份值与事件账投影值分列可判） | `cost-frozen.test.ts`（自定义 1.25 vs 0.05＋drill 报告复算 0.75 vs 0.015、两值分列不判等）＋`rebuild.test.ts`（4 用例：只重放 events／零钱账／排除域报告／钱账行混入 JSONL 被整批回滚） | 绿；重建库 `cost_daily=0`，报告不含金额、不称「钱账已重建」 |
| NEG-SEC-03（events 改/删被拒） | 既有 V2 件 `events-trigger.test.ts`（本单不改写）；本单 `rebuild.test.ts` 复核 v15 在库（`currentVersion=15`） | 绿（既有） |
| NEG-EVD-05（分列可判） | 其「备份值与投影值分列」腿由本单 `cost-frozen.test.ts` §NEG-MIG-02 承载；「改/删快照可判」归既有 `backup.test.ts` | 绿（本单补强复算） |

| 门 | 命令 | 本次结果 |
|---|---|---|
| typecheck | `mise exec -- bun run typecheck` | exit 0（无输出） |
| typecheck:v2 | `mise exec -- bun run typecheck:v2` | exit 0（无输出） |
| store V2 | `mise exec -- bun run test:v2 -- packages/store` | 10 files / **120 tests** passed；新件 `cost-frozen`(6)＋`rebuild`(4) |
| crash V2 | `mise exec -- bun run test:v2 -- apps/daemon/test/v2/crash` | 1 file / **5 tests** passed |
| guard | `mise exec -- bun run guard:boundaries` | PASS：扫描 737 文件（范围面代码件 595），**0 违例** |

文件行数（阈 600）：`crash-points.ts` 73｜crash 测试 267｜child 101｜scenario 165｜`cost-frozen.test.ts` 291｜`rebuild.test.ts` 170——全部 ≤600。

### 7.5 诚实边界（未解决缺口，不静默）

1. **记录面只落 1/4 注入点**：plan/04 §1.4 登记的四类记录面注入点为「records 事务提交前后／备份快照写入中／投影重建中／rebuild 排除域报告写入中」；本单只落 `records-commit`（提交前后缝隙），**其余三点未登记、未建测试**——归后续 MIG-04 余单或 MIG-06/08，本件不冒充已覆盖。
2. **⑥ 的写入是测试侧 v14 列级 INSERT**：daemon 侧不 import store 记录写面（hist.ts 未从包出口暴露），故崩溃子进程用 node:sqlite 原样写 v14 列——本腿证明的是**提交缝隙的库语义**，不证明 PORT-HIST 形状校验/幂等逻辑（后者归既有 `hist-append.test.ts`/`hist-query.test.ts`）。不因此宣称 hist 写口已被崩溃覆盖。
3. **对账规则未决（GAP-V2-01）**：NEG-MIG-02 只证「备份恢复值与事件账投影值分列、差异可判」，**不证两账一致**；任何一致性结论仍需对账规则裁决。
4. **events 哈希链（I-17/GAP-V2-05）仍目标未证**：NEG-SEC-03 只证改/删被行级触发器拒；`DROP TABLE` 不被行级触发器拦（v15 头注既有边界），本件不扩大为「append-only 已机制化」。
5. **旧五点未在本单重跑**：旧 `apps/daemon/test/engine/crash-injection.test.ts` 只登记、不扩展（plan/04 §1.4）；V2 五点腿尚未建立，本单新增的 crash 腿只覆盖第 6 点。
6. **未 commit**：本单改动（crash-points.ts、crash 测试三件、store NEG 两件、本基线追加）留在工作树，按单纪律由父级合并流处理；本件不声称已入库。
