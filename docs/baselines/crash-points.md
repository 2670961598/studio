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
> - git HEAD（施工基线）：`2bfee5e`（`feat(v2): MIG-04-01..06/08 store 记录面 + cost_daily 限域`；本单七件改动（2 改＋5 新）；本代理未自行 commit，父级合并流于 `3e5bed7` 入库（本登记件同批））
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

1. **记录面只落 1/4 注入点**：plan/04 §1.4 登记的四类记录面注入点为「records 事务提交前后／备份快照写入中／投影重建中／rebuild 排除域报告写入中」；本单只落 `records-commit`（提交前后缝隙），**其余三点未登记、未建测试**——按 2026-10-28 父级登记归 plan/03 MIG-06 补登（`64d4bdc`），本件不冒充已覆盖。
2. **⑥ 的写入是测试侧 v14 列级 INSERT**：daemon 侧不 import store 记录写面（hist.ts 未从包出口暴露），故崩溃子进程用 node:sqlite 原样写 v14 列——本腿证明的是**提交缝隙的库语义**，不证明 PORT-HIST 形状校验/幂等逻辑（后者归既有 `hist-append.test.ts`/`hist-query.test.ts`）。不因此宣称 hist 写口已被崩溃覆盖。
3. **对账规则未决（GAP-V2-01）**：NEG-MIG-02 只证「备份恢复值与事件账投影值分列、差异可判」，**不证两账一致**；任何一致性结论仍需对账规则裁决。
4. **events 哈希链（I-17/GAP-V2-05）仍目标未证**：NEG-SEC-03 只证改/删被行级触发器拒；`DROP TABLE` 不被行级触发器拦（v15 头注既有边界），本件不扩大为「append-only 已机制化」。
5. **旧五点未在本单重跑**：旧 `apps/daemon/test/engine/crash-injection.test.ts` 只登记、不扩展（plan/04 §1.4）；V2 五点腿尚未建立，本单新增的 crash 腿只覆盖第 6 点。
6. **未自行 commit**：本单七件改动（crash-points.ts、crash 测试三件、store NEG 两件、本基线追加）由父级合并流提交（`3e5bed7` 含代码＋基线；`267d381` 措辞收口，`64d4bdc` 余点归 MIG-06 登记）；本代理未执行 `git commit`。

---

## 八、2026-10-28 三点补登（MIG-06 波门欠账：⑦⑧⑨ 记录面 crash 注入点）

> **追加登记（只增不删：§一-§七 前代内容逐字保留）**
> - 日期：2026-10-28
> - git HEAD（施工基线）：`bdc8652`（`feat(v2): MIG-06-09 退役 external/invoke/notifier/旧入口`）；本单代码/测试 8 件（2 改＋6 新）＋本基线追加；**本代理未自行 commit**（父级合并流入库）
> - 工具链：bun **1.4.3** / node **v24.21.0**（`.mise.toml` 固定；命令统一 `mise exec --`）
> - 执行者：DeepSeek-V41-Flash（StudioNext 施工代理；MIG-06 波门欠账补登）
> - 性质：冻结表**新增第 7/8/9 点**（登记＋V2 crash 腿）；**①-⑥ 语义不变**、旧测试不改、**无生产调用点新增**；唯一生产件改动=冻结表注册与头注（`crash-points.ts`）
> - 唯一权威：`apps/daemon/src/engine/crash-points.ts` 头注「九点冻结表（本表即唯一权威；改动走批示）」；本件为其 MIG-06 快照追加登记
> - 依据：plan/03 MIG-06「记录面注入点补点（2026-10-28 MIG-04 交付登记）」；plan/04 §1.6（记录面四点扩展／先登记后测试）；docs/v2/17 §1.1 V5 行；docs/v2/16 §四（DOM-04 限域）／§一 B11（rebuild 单事务只重放 events）；docs/v2/05 §三 DOM-03/04/05

### 8.1 第 ⑦⑧⑨ 行（冻结表新增行；①-⑥ 行文未改，仅表头括注由「⑥ 记录面」扩为「⑥-⑨ 记录面」）

| # | 点名 | 相位（①-⑤ 17-§2；⑥-⑨ 记录面） | 注入位置（①-⑤ engine.ts；⑥-⑨ V2 crash 子进程） | 缝隙语义（F3-11 三段） |
|---|---|---|---|---|
| ⑦ | `backup-snapshot` | 记录面（DOM-04 备份快照；**非主循环七相位**） | cost_daily 备份写入：JSONL 半写＋`<out>.sha256` 侧车后、rename 完成屏障前调 `crashHook('backup-snapshot')`（**无生产调用点**——备份写面归属 store backup.ts；V2 crash 子进程 staging 半写） | **备份件已半写、完成屏障未过**：重启后 canonical 备份不成立，半 JSONL／孤儿侧车不得被当有效备份（行数不足/摘要不符可判）；重跑 backupCostDaily 产完整备份且 sha 一致 |
| ⑧ | `projection-rebuild` | 记录面（DOM-03 投影重建；**非主循环七相位**） | events 重放重建单事务：重放一半（replayed=⌊N/2⌋）后、COMMIT 前调 `crashHook('projection-rebuild')`（**无生产调用点**——重建写面归属 store rebuild.ts；V2 crash 子进程以 appendEvent 同写路径重放） | **投影重建事务已写未提交**：重启即回滚，目标库无半投影；重跑 rebuild 幂等（不重复不丢）；排除域仍零重放 |
| ⑨ | `exclusion-report` | 记录面（DOM-04 排除域报告；**非主循环七相位**） | rebuild 报告写入：报告 staging 文件半写后、rename 前调 `crashHook('exclusion-report')`（**无生产调用点**——报告渲染归属 store rebuild.ts，文件写面由调用方承载；V2 crash 子进程 staging 半写） | **排除域报告已半写、rename 未过**：重启后半报告不得被当有效（须含排除域/理由/备份声明）；重跑产完整报告含排除域，且不得称钱账已重建 |

- **完成屏障的落法**：⑦ 以 staging→rename 为完成屏障（`<out>.partial`＋全量摘要侧车在 rename 前 SIGKILL）；⑧ 以 SQLite 事务 COMMIT 为屏障（事务内 events=一半，COMMIT 前 SIGKILL）；⑨ 以报告 staging→rename 为屏障。三点均**不新增生产调用点**：注册名只由 V2 crash 子进程消费（⑦ 用生产 `backupCostDaily` 造全量 staging 后截半；⑧ 用生产 `appendEvent` 重放/`rebuild` 重跑；⑨ 用生产 `rebuild`＋`renderRebuildReport` 渲染），记录面写面归属 store，daemon 生产侧不 import。
- **⑧ 的「游标」口径如实登记**：本仓 `rebuild` 无持久化投影游标列，事务内 `replayed=⌊N/2⌋` 只是**重放进度**（不是第二事实源）；`daemon_kv` 的 `activity.cursor` 归引擎装配，不属 store 重建事务——本点不造伪游标。
- **⑦ 的完成件判据**：「canonical 存在＋侧车摘要校验通过＋行数等于源行数」三合一才算有效备份；半 JSONL 或孤儿侧车一律不当有效（不假绿）。

### 8.2 `CRASH_POINTS` 长度与生产调用点复算

```bash
mise exec -- node --input-type=module -e "import{CRASH_POINTS}from'./apps/daemon/src/engine/crash-points.ts';console.log(CRASH_POINTS.length);console.log(CRASH_POINTS.join(','))"
# 本次实际输出（exit 0）：
# 9
# dispatch-reserved,dispatch-launched,harvest-verdict,heartbeat-write,shutdown-drain,records-commit,backup-snapshot,projection-rebuild,exclusion-report

grep -c "crashHook('" apps/daemon/src/engine/engine.ts
# 本次实际输出：5（旧五点；⑦⑧⑨ 无生产调用点，未进 engine.ts）

grep -rn "backup-snapshot\|projection-rebuild\|exclusion-report" apps/daemon/src
# 本次实际命中：仅 crash-points.ts（头注冻结表 3 处＋CRASH_POINTS 成员 3 处）——engine.ts/其他生产件零命中
```

### 8.3 V2 crash 腿（三个真子进程 SIGKILL；无 mock）

| 文件 | 行数 | 职责 |
|---|---|---|
| `apps/daemon/test/v2/crash/surfaces-crash.test.ts` | 598 | 11 用例：九点登记＋生产调用点复算、⑦⑧⑨ 各「负控／命中 SIGKILL／重启重跑」三腿；断言三不变量 |
| `apps/daemon/test/v2/crash/fixtures/backup-crash-child.ts` | 90 | ⑦ 真子进程：生产 backupCostDaily staging 全量→截半＋全量摘要侧车→`PRE_COMMIT`→rename 前 `crashHook('backup-snapshot')`；未命中恒清 staging＋exit 91 |
| `apps/daemon/test/v2/crash/fixtures/rebuild-crash-child.ts` | 95 | ⑧ 真子进程：openLedger(target)→BEGIN→生产 appendEvent 重放一半→`PRE_COMMIT`→COMMIT 前 `crashHook('projection-rebuild')`；未命中恒 ROLLBACK＋exit 91；run 腿跑生产 rebuild |
| `apps/daemon/test/v2/crash/fixtures/exclusion-crash-child.ts` | 87 | ⑨ 真子进程：生产 rebuild 提交后 renderRebuildReport→前一半行写 staging→`PRE_COMMIT`→rename 前 `crashHook('exclusion-report')`；未命中恒清 staging＋exit 91 |
| `apps/daemon/test/v2/crash/fixtures/surfaces-crash-scenario.ts` | 120 | 确定性场景（4 行 cost_daily／6 行 events 的 v14 形状、ULID、证据行 writeSync、env 键）——测试夹具，不进生产面 |
| `apps/daemon/test/v2/crash/records-crash.test.ts` | 270 | 仅登记断言由「长度=6」更新为「长度=9」（①②③④⑤⑥ 名称/顺序与全部行为断言不变） |

**实测证据（2026-10-28，本机；命令照录，临时目录路径略）**：

```text
$ mise exec -- bun run test:v2 -- apps/daemon/test/v2/crash
[records-commit] signal=SIGKILL code=null 事务内records=2 重启后={"version":15,"records":1,"events":1,"costDaily":1}
[backup-snapshot] signal=SIGKILL 事务外全量=4 staging半写=2 canonical存在=false
[backup-snapshot] 重跑 sha=ab35dae52a62… 行数=4 二次sha一致=true
[projection-rebuild] signal=SIGKILL 事务内events=3 重启后events=0
[projection-rebuild] 首次events=6 二次events=6 distinct=6 costDaily=0
[exclusion-report] signal=SIGKILL 报告行=4 半写行=2 canonical存在=false
[exclusion-report] 完整报告行=4 排除域=cost_daily 半报告有效=false

Test Files  2 passed (2)
     Tests  16 passed (16)
```

- **⑦ 硬杀与半件证据**：`run.signal==='SIGKILL'`、`run.code===null`；`PRE_COMMIT` 证据行给出 `totalLines=4／partialLines=2／declaredSha256=<64 hex>／sourceRows=4`（全量身份先定、只刷出一半）。重启后 canonical `<out>` 与 `<out>.sha256` 均不存在（无「有效备份」声明）；staging 半件存在但 `verifyBackup(partial, declaredSha)` 返回 `ok=false`、`lines=2`、`actual≠expected`，`readCostDailyBackup(partial)` 只 2 行（源 4 行）——半文件不被当完整。重跑腿 `COMMITTED` 给出 `lines=4`、sha 与崩溃前 declaredSha **逐字一致**、`verifyBackup(ok=true, lines=4)`、读回 4 行；二次重跑字节/sha 不变（不重复副作用）。源库只读，4 行与 `integrity_check=ok` 跨崩溃存活。
- **⑧ 硬杀与回滚证据**：`PRE_COMMIT` 给出 `replayed=3／total=6／eventsInTx=3／version=15`（重放游标 3、事务内 3 行）；`SIGKILL` 后同库重开 `events=0`、`cost_daily=0`、`integrity_check=ok`——未 COMMIT 事务回滚，无半投影。重跑 `rebuild` 得 `events=6／version=15／excludedDomains=['cost_daily']`、库内 `dbEvents=6／distinctIds=6`；**同源二次**再跑仍 `events=6／dbEvents=6／distinctIds=6`（不是 12），事件行集与内容逐字不变（不重复不丢），`cost_daily=0`（排除域零重放）。
- **⑨ 硬杀与半报告证据**：`PRE_COMMIT` 给出 `events=6／version=15／reportLines=4／partialLines=2／excludedDomains=['cost_daily']`；`SIGKILL` 后 canonical 报告不存在、staging 只 2 行，缺「排除域理由」「排除域备份」两行（`reportComplete=false`，不假绿）；已提交重建不受影响（目标库 `events=6／cost_daily=0／integrity ok`）。重跑腿 rename 出 4 行完整报告，与生产 `renderRebuildReport` 逐行一致，含 `排除域：cost_daily`／`只备份不重放`／`未随本次操作生成`，且不含「钱账已重建」与金额。
- **负控证据**：三点各有一腿以 `SN_CRASH_POINT=dispatch-reserved` 启动——子进程**不自杀**（`signal=null`）、清 staging 后 `exit 91`＋stderr `CRASH_HOOK_NOT_ARMED`，canonical/staging 零残留（⑦⑨）；⑧ 目标库零事件。env 门控非「必死进程」，且测试不靠 exit 0 冒充崩溃。

**三不变量落点**：

| 不变量 | 断言位置 | 本轮实测 |
|---|---|---|
| 不丢终态 | ⑦ 源库 4 行只读不变；⑧ 目标库/重跑全量 6 行；⑨ 已提交重建 events=6 | 三点均通过（integrity ok） |
| 不假绿 | 三点命中必须 `signal=SIGKILL`＋`code=null`；误点名必须 `exit 91`＋清 staging；半件按「完整字节＋摘要＋行数/段齐全」判否 | 三点均通过 |
| 不重复副作用 | ⑦ 二次重跑字节/sha 不变；⑧ 二次 rebuild 仍 6 行（distinct=6）；⑨ 报告只落 canonical 一份（.partial 经 rename 消失） | 三点均通过 |

### 8.4 纯 store 断言（`packages/store/test/v2/crash-surfaces.test.ts`，3 用例）

真进程 SIGKILL 腿只归 daemon 侧（plan/04 §1.6）；store 侧只补**判据**：

1. **备份半写**：生产备份后把 JSONL 截到 2 行、保留全量摘要侧车 → `verifyBackup ok=false`、`lines=2`、`readCostDailyBackup=2 行`、完整判据 false；生产重跑 → `lines=4`、sha 与崩溃前全量身份一致、`ok=true`、侧车形如 `<hex>  <basename>`。
2. **重建事务回滚与幂等**：BEGIN→前 3 行→ROLLBACK 后目标库 0 行（无半投影）；生产 `rebuild` 全量 6 行、排除域 0 行；同源二次 `rebuild` 仍 6 行（`distinct=6`）、事件内容逐字不变。
3. **排除域报告完整性**：完整报告 4 行含排除域清单/理由/备份声明且无「钱账已重建」/金额；前 2 行半报告缺理由与备份行 → 完整判据 false。

### 8.5 门禁（2026-10-28 本机实测）

| 门 | 命令 | 本次结果 |
|---|---|---|
| typecheck | `mise exec -- bun run typecheck` | exit 0（无输出） |
| typecheck:v2 | `mise exec -- bun run typecheck:v2` | exit 0（无输出） |
| crash V2 | `mise exec -- bun run test:v2 -- apps/daemon/test/v2/crash` | 2 files / **19 tests** passed（records 5＋surfaces 14） |
| store V2 | `mise exec -- bun run test:v2 -- packages/store` | 11 files / **123 tests** passed（新增 crash-surfaces 3） |
| guard | `mise exec -- bun run guard:boundaries` | PASS：扫描 **825** 文件（范围面代码件 **683**），**0 违例** |

文件行数（阈 600）：`crash-points.ts` 92｜`surfaces-crash.test.ts` 598｜`records-crash.test.ts` 270｜backup child 90｜rebuild child 95｜exclusion child 87｜scenario 120｜store crash-surfaces 217——全部 ≤600（`surfaces-crash.test.ts` 余量仅 2，后续扩展须先拆）。

### 8.6 诚实边界（未解决缺口，不静默）

1. **⑦⑧⑨ 仍无生产调用点**：三点是**注册名＋V2 crash 腿**，不是插进生产写路径的钩子——⑦ 由测试子进程用生产 `backupCostDaily` 造 staging 后截半，⑧ 由子进程以生产 `appendEvent` 重放，⑨ 由子进程用生产 `rebuild`/`renderRebuildReport` 渲染后半写文件。故本件证明的是「完成屏障前崩溃后，store 判据/重跑语义成立」，**不证明**生产进程在备份/重建/报告写入途中必被注入；与 ⑥ 同口径，不冒充「生产调用点已布防」。
2. **备份生产的完成屏障缺口**：生产 `backupCostDaily` 是「直写 canonical（writeFileSync）→写侧车」，**没有 rename/事务**；本轮 ⑦ 的 rename 屏障由子进程 fixture 承载，store 纯断言覆盖「canonical 被截半＋侧车仍全量」的直写危险形态。但崩溃后「期望的全量 sha」若只存在于进程内存（侧车未落盘），重启侧**没有独立的完成标记/manifest API** 可判「这份半文件属于哪次完整备份」——该判据缺口未闭合，不宣称备份面已机制化。
3. **⑧ 无持久化投影游标**：仓库 `rebuild` 只有单事务重放，无投影游标列；`replayed` 只是事务内进度。daemon_kv 的 `activity.cursor` 与 store 重建事务无关，本点不覆盖「游标与投影同事务」的形态（当前仓不存在该形态）。
4. **⑨ 报告文件写面不在生产 API**：store 只 `renderRebuildReport` 返回行数组，落盘/rename 由调用方实现；本轮 rename 屏障同样是 fixture 行为。生产调用方若不采用 staging→rename，半报告风险仍在——未以生产 API 强制。
5. **fixture 深引 store 模块**：`backupCostDaily`/`renderRebuildReport` 未从 `@studio-next/store` 包根导出，测试/子进程以相对路径引 `packages/store/src/backup.ts`、`rebuild.ts`（分层门禁允许 daemon→store 边；不进生产面）。包出口补齐后应改为包根导入，届时本件行号/引用需同步。
6. **`records-crash.test.ts` 仅改登记断言**：长度 6→9、期望数组追加三项；该文件其余行为断言与头注（第 6 点语义）未改。旧五点（`apps/daemon/test/engine/crash-injection.test.ts`）本波未重跑、未改写（plan/04 §1.6：旧测试只登记）。
7. **未自行 commit**：本单 8 件代码/测试改动＋本基线追加由父级合并流提交；本代理未执行 `git commit`。
