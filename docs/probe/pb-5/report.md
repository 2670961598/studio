# PB-5 平台与台账 · 探针收口登记（PRB-13/14/23）

> **头注**
> - 日期：2026-10-29（探针采集 2026-10-29T06:59Z–07:04Z UTC / 14:59–15:04 CST）
> - git HEAD：`af0621643b39fc72ad990243df36232170d77891`（分支 `dev`；采集期间 HEAD 由 `9a43b7b` 前移到 `af06216`，本报告全部日志的 `HEAD=` 行以各日志头注为准）
> - 工具链/宿主：node **v24.21.0**（`mise exec --`）/ bun **1.4.3**｜node:sqlite **3.53.4**｜macOS **26.3** arm64
> - 执行者：DeepSeek-V41-Flash（StudioNext 施工代理；MIG-08 / IMPL-08-05）
> - 性质：**只读探针＋仓外临时目录/临时台账夹具**；不改生产码、不改旧测试、不写公司目录/宿主 profile、不启真实模型会话、不发出站请求、不 git commit
> - 依据：`docs/v2/12-技术细节-宿主平台与工作区绑定.md` §5.1/§5.3（PRB-13/14/23 **唯一主表**）、`docs/v2/12` §2.3（读侧未映射契约）、`docs/v2/17-验证矩阵与追溯.md` §五（PB-5 批次与阻断）、`docs/plan/05-实现单拆分清单.md` IMPL-08-05
> - 口径：状态三值（executed｜not-executed｜not-applicable）；**负向结论也用 executed**；未执行行不填「预期通过」；每行正向＋负向同验；原始日志逐字留存（仅脱敏本机绝对路径 → `<repo>`/`<tmp>`）

---

## 一、批次入口判定（先判门，再谈行）

| 入口要件 | 规范原文 | 实测 | 判定 |
|---|---|---|---|
| MIG-04 store 记录面 | v2/17 §五 PB-5 入口「**MIG-04**（D12 围栏/只读打开）」 | 记录面/v14-v15 迁移/备份/触发器在（`git log` 见 `3e5bed7` 等）；**D12 只读打开/围栏未实现**（下两行） | **部分不满足** |
| D12 只读打开 | v1 docs/80 §8.2：`openLedgerReadonly`＋`PRAGMA query_only=ON`；只读进程不跑 DDL | `grep -rn "openLedgerReadonly\|query_only\|WriterLease\|WriterLeasePort" packages apps --include=*.ts` **零命中**；`openLedger` 无条件 `migrate(db)`（`ledger.ts:516`）；`openSqlite` 无条件 `journal_mode=WAL`（`driver.ts:31`）；两进程实测 `query_only=0`（`log-04`） | **不满足** |
| MIG-06 API 面 | v2/17 §五 PB-5 入口「**MIG-06**（API 面）」 | `packages/api` 16 端点/`assembly/api` 注入面在（`git log` 见 `089c5a1`）；API 读面用注入的 PORT-OBS 只读子口（`reportFault` 不可达） | **满足（API 面）** |
| MIG-07 平台三件套统一签名 | v2/17 §五 PB-5 入口「**MIG-07**（平台三件套统一签名）」 | `packages/{yt,taiga,localplatform}/src/binding.ts` 同形 `bindingProfile/mapState/lossReport`（`git log` 见 `602e1d7`） | **满足** |

**结论**：PB-5 **批次入口未完全满足**（MIG-04 的 D12 只读打开/围栏缺位；MIG-06/07 在）。按 v2/17 §五与 D12 纪律，本报告：

1. **不宣布 PB-5 通过**；
2. **不宣布平台读侧契约成立**（PRB-23 未过，见 §三）；
3. **不宣布台账单写**（PRB-14 未过，见 §三）；
4. 不宣布平台写回执/未知契约（PRB-13 未执行）。

> **任务铁律**：PRB-23 未过不得宣称平台读侧契约成立；PRB-14 未过不得宣称台账单写（v2/17 §五；plan/04 §1.8 施工挂接）。

---

## 二、逐行判定表

| ID | 主表现状 | **本行状态** | 正向结果 | 负向结果 | 证据（日志） |
|---|---|---|---|---|---|
| PRB-13 | 未执行 | **not-executed** | **未取到**：无真实平台写＋停网/超时；无「未知回执记录（owner+复查期）」写口 | **未取到**：恢复后对账不产生重复单未执行 | `log-05-prb-13-write-receipt.txt` |
| PRB-14 | 未执行 | **executed（负向）** | **部分观察到**：两进程同写，B 被 SQLite 串行化（等待 1584ms 后写入） | **已取到负向判据**：无框架围栏/D12 只读打开 → 按主表「无围栏时必须报不满足」登记不满足 | `log-04-prb-14-two-process.txt` |
| PRB-23 | 未执行 | **not-executed** | **部分观察到**：三平台 `mapState` 对未映射合法值返回 `Ok(unverified)`＋原值逐字保留；LocalFile 真实读腿同形 | **部分观察到**：空/空白/非字符串返回 `Err(CONFIG_INVALID/platform-state-invalid)`；未见「映射到最近已知态」；但消费方观察缺口写口缺位 | `log-02-prb-23-mapping.txt`、`log-03-prb-23-local-read.txt` |

**统计（3 行）**：`executed` **1**（PRB-14，负向）｜`not-executed` **2**（PRB-13、PRB-23）｜`not-applicable` **0**。

> PRB-23 的 `not-executed` 是**整行判据**：主表正向是复合条件（`Ok(unverified)`＋原值逐字保留＋**消费方写观察缺口**），本报告只取到前两项和负向的 Err/不猜映射；消费方写口缺位，因此不升为整行通过（v2/12 §2.3；v2/11 REC-OBS-02）。**映射腿的行为观察不构成平台读侧契约成立。**

---

## 三、逐行详录

### PRB-13 · 平台写回执与未知（写侧）（**not-executed**）

- **主表行（v2/12 §5.3）**：目的＝平台**写**回执与未知（写侧）；形态＝停网/超时；正向＝未知回执记录（owner＋复查期）；负向＝恢复后对账不产生重复单；锚＝平台绑定。
- **本行状态：`not-executed`**。
- **已做（静态面/可探性侦察，不构成本行证据）**——`log-05-prb-13-write-receipt.txt`：
  - `grep -rn "REC-RCP-01\|REC-EVT-03" apps packages --include=*.ts | grep -v test | grep -v packages/contract/src` 只命中 `packages/api/src/routes/subscriptions.ts` 的注释/死信字面量；**没有 REC-RCP-01 回执或 REC-EVT-03 未知登记的运行期写口**。
  - `grep -rn "reportFault" ...` 只命中契约端口与 API 注释；**没有 `PORT-OBS.reportFault` 实现**（API 注入面还明确把 `reportFault` 排除在只读子口外）。
  - `packages/taiga/src/transport/http.ts:14` 自记「**无超时**、无限流退避、无 5xx 重试（上层断路器职责）」——停网/超时探针所需的超时/未知判定面不在客户端层。
  - `env` 的键名中没有 YouTrack/Taiga/platform 凭据名（只列名，未打印值）；本仓没有真实平台写测试（v2/12 §2.2 卡「零真实网络测试」）。
  - `packages/{yt,taiga}/src/binding.ts` 的探针行均登记 `PRB-13: not-executed`；`createTaigaPlatform` 虽在 `assembly/platform/wire.ts:158` 有接线，但没有真实端点和凭据。
- **原始输出摘录**（逐字见 `log-05-prb-13-write-receipt.txt`）：

```text
$ grep -rn "REC-RCP-01\|REC-EVT-03" apps packages --include=*.ts | grep -v "test/" | grep -v "packages/contract/src"
packages/api/src/routes/subscriptions.ts:4: * 依据：docs/v2/14 §四（API-16：allowlist＋SSRF 拒＋退避＋死信（REC-EVT-03）＋重放窗）；
packages/api/src/routes/subscriptions.ts:190:        // 投递策略随意图交给下游投递器（退避/死信 REC-EVT-03 归 daemon；本面不投递）
packages/api/src/routes/subscriptions.ts:191:        delivery: { mode: 'at-least-once', deadLetter: 'REC-EVT-03' },
EXIT=0
$ grep -n "无超时" packages/taiga/src/transport/http.ts
14: *   - 无超时、无限流退避、无 5xx 重试（上层断路器职责）
EXIT=0
$ env | cut -d= -f1 | grep -iE "youtrack|taiga|platform" || echo "(no youtrack/taiga/platform env names)"
(no youtrack/taiga/platform env names)
EXIT=0
```
- **正/负同验**：
  - **正向（未知回执记录 owner＋复查期）＝未取到**：没有真实平台写；也没有 REC-RCP-01/未知登记写口；
  - **负向（恢复后对账不产生重复单）＝未取到**：没有停网/恢复/对账夹具。
- **结论**：PRB-13 不能执行，**不得宣称平台写侧回执/未知契约成立**。契约形状（`ReceiptPayloadSchema`/`UnknownRegistryPayloadSchema`）存在，但「形状存在」不是运行期写口，也不是本行证据（v2/12 §0.5-4）。
- **缺什么 / target**：真实平台实例与凭据＋可注入的停网/超时夹具（发请求后断网/超时）＋REC-RCP-01 `ack_kind:'unknown'` 与 REC-EVT-03（owner＋review_by）写口＋恢复后对账（REC-EVT-02）不产生重复单的证据。注意：PRB-13 的「未知回执」≠ PRB-23 的「未映射状态」（v2/12 §2.3 明写二者不是一面）。

### PRB-14 · 跨进程单写（**executed，负向**）

- **主表行（v2/12 §5.3）**：目的＝跨进程单写；形态＝两进程同写台账；正向＝第二个被拒或串行化；负向＝无围栏时必须报「不满足」；锚＝台账写入（配合 v2/11）。
- **本行状态：`executed`（负向）**。命令与逐字输出见 `log-04-prb-14-two-process.txt`：

```text
$ REPO_ROOT=<repo> mise exec -- node <tmp>/sn-probe/pb5-prb14.mjs
--- child A exit=0 ---
A> open ledger version=15 query_only=0 busy_timeout=5000
A> BEGIN IMMEDIATE + kvSet(A) ok（持写锁）
A> COMMIT ok
A> kvGet="A"
--- child B exit=0 ---
B> open ledger version=15 query_only=0 busy_timeout=5000
B> kvSet(B) ok elapsedMs=1584
B> kvGet="B"
EXIT=0
```

- **做了什么**：两个**真实子进程**（非线程/非同进程 mock）各自 `openLedger(<tmp>/ledger.db)`；A 先 `BEGIN IMMEDIATE` 写 `daemon_kv` 并持锁 1.5s，B 在 A 持锁后尝试 `kvSet`。B 没有报错，等待约 1.584s（A 提交后）写入成功；两个进程都打印 `query_only=0`、`busy_timeout=5000`、`version=15`。
- **正向（第二个被拒或串行化）**：观察到 **SQLite 引擎级串行化**（B 等待 A 提交后写入，未被拒）。这是 WAL＋`busy_timeout=5000` 的数据库行为，不是框架级围栏。
- **负向（无围栏时必须报「不满足」）**：**已取到**——
  1. `grep -rn "openLedgerReadonly\|query_only\|WriterLease\|WriterLeasePort" packages apps --include=*.ts` **零命中**：没有 v2/11 `WriterLeasePort`/`FenceToken` 跨进程围栏实现，也没有 D12 只读打开；
  2. `openLedger` 无条件 `migrate(db)`（`ledger.ts:516`）——任何进程打开台账都会跑迁移路径，不是「只读打开不跑 DDL」；
  3. 两进程 `query_only=0`，没有 `PRAGMA query_only=ON`。
- **结论**：**PRB-14 不通过**。按主表负向列，无框架围栏时**必须报「不满足」**：本报告不把「SQLite 引擎串行化」冒充「台账跨进程单写围栏」。**不得宣称台账单写**（v2/17 §五；plan/04 §1.8）。
- **边界**：本行只证「同一 SQLite 文件、两进程、WAL/busy_timeout 下第二次写被串行化」这一引擎事实；不证 `WriterLeasePort`、不证 D12、不证 daemon 单写者部署语义、不证多机/多库。

### PRB-23 · 平台读侧未映射状态（**not-executed**；映射腿已观察，整行未过）

- **主表行（v2/12 §5.3）**：目的＝平台**读**侧未映射状态（原 P-82-01）；形态＝平台返回未映射但合法状态；正向＝`Ok(unverified)`＋原值逐字保留＋**消费方写观察缺口**；负向＝映射到最近已知态＝判负，空串/畸形＝`Err`；锚＝§2.3 读侧契约（治 V8-P1-3 悬空登记）。
- **本行状态：`not-executed`**（整行复合正向未满足；映射腿与负向腿已观察，见下）。
- **映射腿（行为观察，不构成整行通过）**——`log-02-prb-23-mapping.txt` 摘录（三平台同形）：

```text
== yt ==
bindingProfile: kind=ok bindingId=BIND-PLAT-YT-01 stateMappings=0 probes=["PRB-13:not-executed","PRB-23:not-executed"]
legal-unmapped-ascii: {"kind":"ok","platformState":"In Progress","workStates":[],"verification":"unverified","unmappedBehavior":"observe-unmapped"}
legal-unmapped-workstate-literal: {"kind":"ok","platformState":"in_progress","workStates":[],"verification":"unverified","unmappedBehavior":"observe-unmapped"}
legal-unmapped-accepted-literal: {"kind":"ok","platformState":"accepted","workStates":[],"verification":"unverified","unmappedBehavior":"observe-unmapped"}
legal-unmapped-raw-whitespace: {"kind":"ok","platformState":"  In Progress  ","workStates":[],"verification":"unverified","unmappedBehavior":"observe-unmapped"}
empty: {"kind":"err","category":"CONFIG_INVALID","subcause":"platform-state-invalid"}
whitespace-only: {"kind":"err","category":"CONFIG_INVALID","subcause":"platform-state-invalid"}
non-string-null: {"kind":"err","category":"CONFIG_INVALID","subcause":"platform-state-invalid"}
non-string-number: {"kind":"err","category":"CONFIG_INVALID","subcause":"platform-state-invalid"}
== taiga ==（同形，bindingId=BIND-PLAT-TAIGA-01，stateMappings=0）
== localplatform ==（同形，bindingId=BIND-PLAT-LOCAL-01，stateMappings=0）
```

- **LocalFile 真实读腿**——`log-03-prb-23-local-read.txt`：

```text
stateMappingTable: kind=ok rows=0
platform.issues.create: id=LOCAL-1 state="In Progress"
readIssueState: OK record.state="In Progress" mapping={"platformState":"In Progress","workStates":[],"verification":"unverified","unmappedBehavior":"observe-unmapped"}
readIssueState(missing): OK undefined
EXIT=0
```

- **正/负同验**：
  - **正向第一/二项（`Ok(unverified)`＋原值逐字保留）＝已观察**：三平台对 `In Progress`、`in_progress`、`accepted`、带前后空格的原值均返回 `verification:'unverified'`、`workStates:[]`、`platformState` 逐字保留；LocalFile 真实盘面读回同形。
  - **正向第三项（消费方写观察缺口）＝未取到**：`grep -rn "mapState\|readIssueState" packages apps --include=*.ts | grep -v test` 只命中三平台包；daemon/API/store 没有调用 `mapState`/`readIssueState` 的消费方。`REC-OBS-02` 只出现在契约端口/注释（`packages/contract/src/ports/obs.ts`、三平台 binding 头注、`store/src/obs.ts` 的「不落 REC-OBS-02」说明）；**没有 REC-OBS-02 写口**；`reportFault` 也只有契约端口与 API「不注入」注释，没有实现。
  - **负向（不猜最近已知态）＝已观察**：`stateMappings` 三平台均为 **0 行**；`in_progress`/`accepted` 等与工作十态同字面值也没有被映射成已知态（仍 `unverified`、`workStates:[]`）——没有「映射到最近已知态」的路径。
  - **负向（空串/畸形＝Err）＝已观察**：`''`、纯空白、`null`、`42` 均返回 `Err(CONFIG_INVALID/platform-state-invalid)`。
- **为什么仍 `not-executed`**：
  1. 正向是复合条件，缺「消费方写观察缺口」这一项；没有消费方写口，无法证明「报缺映射即停/写观察缺口」的运行期链；
  2. 逐平台值映射表是**部署工件**（v2/12 §2.3）；本仓三平台 `stateMappings` 均为空表，没有部署注入的 verified/unverified 行；
  3. 没有真实 YouTrack/Taiga 实例返回未映射状态；LocalFile 只是契约靶子，不能替代真实平台读侧；
  4. 批次入口缺 D12/PRB-13，且 PRB-23 的完整正向链不在本单领土内。
- **结论**：**PRB-23 未过**。映射纯函数在「未映射→`Ok(unverified)`＋原值保留」「空/畸形→Err」「不猜最近已知态」三面与 v2/12 §2.3 同形；但**消费方观察缺口写口缺位**、部署值表为空、无真实平台读侧，故**不得宣称平台读侧契约成立**（v2/17 §五铁律；本报告明确不宣称）。
- **缺什么 / target**：消费方（daemon/收割/面板读面）在收到 `Ok(unverified)` 时写 REC-OBS-02 观察缺口并停止推进/验收/结清＋逐平台部署值表（verified/unverified 逐行）＋真实 YouTrack/Taiga 实例的未映射合法状态读回＋D12 只读打开/PRB-13 前置补齐。

---

## 四、未执行原因汇总（按缺失类别）

| 缺失类别 | 影响行 | 具体缺什么 |
|---|---|---|
| D12 只读打开/围栏 | PRB-14（负向已登记）、PB-5 入口 | `openLedgerReadonly`/`query_only`/`WriterLeasePort` 均未实现；`openLedger` 无条件 `migrate`；两进程 `query_only=0` |
| 真实平台写与故障注入 | PRB-13 | 真实 YouTrack/Taiga 实例＋凭据；停网/超时夹具；REC-RCP-01 未知回执与 REC-EVT-03 写口；恢复对账 |
| 消费方观察缺口写口 | PRB-23 | `mapState`/`readIssueState` 无 daemon/API/store 消费方；`REC-OBS-02`/`reportFault` 无实现；只有契约形状与平台纯函数 |
| 逐平台部署值表 | PRB-23 | 三平台 `stateMappings` 均为 0 行（部署工件未注入）；无 verified/unverified 行 |
| 真实平台读侧 | PRB-23 | 无真实 YouTrack/Taiga 未映射状态读回；LocalFile 只是契约靶子 |

**探针脚本构造失败登记（非产品结论，失败也登记）**：PRB-23 首次局部读腿脚本 exit=1，`TypeError: stateMappingTable is not a function`——`packages/localplatform/src/index.ts` 只导出 `createLocalPlatform`，`stateMappingTable/readIssueState` 在 `platform.ts` 直出；改为从 `platform.ts` 导入后重跑 exit=0（`log-03`）。该失败是**探针脚本取错导出面**，不是产品探针结果，未计入本行结论。

---

## 五、诚实边界

1. **PB-5 未通过**：入口缺 D12 只读打开/围栏；MIG-04 的记录面/迁移/备份在，但 v2/17 PB-5 入口点名的 D12 未实现。本报告不宣布 PB-5 通过。
2. **PRB-23 未过 → 平台读侧契约不成立**：纯映射三面与 §2.3 同形，但消费方写观察缺口缺位、部署值表为空、无真实平台读侧；**不得宣称平台读侧契约成立**（任务铁律，明确登记）。
3. **PRB-14 未过 → 不得宣称台账单写**：两进程观察到的只是 SQLite WAL 引擎级串行化；没有 v2/11 `WriterLeasePort`/`FenceToken` 框架围栏，也没有 D12 只读打开。按主表负向列「无围栏时必须报不满足」登记，**不把引擎锁冒充框架围栏**。
4. **PRB-13 未执行**：契约形状（REC-RCP-01/REC-EVT-03）不是运行期写口；无真实平台写/停网/恢复对账。不得宣称平台写侧回执/未知契约。
5. **LocalFile 不是 YouTrack/Taiga**：PRB-23 的 LocalFile 读腿只证契约靶子行为；不推及真实平台、不推及部署值表。
6. **零副作用/零出站**：未改生产码/旧测试/其它包；未写公司目录、`~/.dsh`、仓内 `var/`/`tmp/`/`.AIWS`；台账夹具在仓外临时目录并已清理；未发真实网络请求（无 curl/DNS/平台调用/模型调用）；未 git commit。本单新增仅 `docs/probe/pb-5/**`。
7. **不代证**：PRB-23 不代证 PRB-13；PRB-14 不代证 D12 已落地；本报告不进入 PB-3；PRB-13/14/23 互不代证。

---

## 六、原始日志清单（`docs/probe/pb-5/`）

| 文件 | 内容 | 对应行 |
|---|---|---|
| `log-00-environment.txt` | 日期/HEAD/分支/OS/工具链/node:sqlite 版本/`git status` | 全批 |
| `log-01-entry-and-d12.txt` | MIG 提交、D12/WriterLease grep 零命中、`openLedger` 无条件 `migrate`、driver PRAGMA、PB-5 规范行 | 批次入口 |
| `log-02-prb-23-mapping.txt` | 三平台 `mapState` 八输入（合法未映射/同字面工作态/空白/空/非字符串）、探针行、消费方 `mapState` 调用点、`REC-OBS-02`/`reportFault` 静态面；附探针脚本源 | PRB-23（映射腿） |
| `log-03-prb-23-local-read.txt` | LocalFile 真实盘面建单＋`readIssueState`＋缺失单；附探针脚本源 | PRB-23（读腿） |
| `log-04-prb-14-two-process.txt` | 两真实子进程同写台账、`query_only`/`busy_timeout`/串行化耗时、D12/WriterLease 静态面；附探针脚本源 | PRB-14 |
| `log-05-prb-13-write-receipt.txt` | REC-RCP-01/REC-EVT-03 写口 grep、`reportFault`、Taiga「无超时」、PRB-13 探针状态、凭据 env 键名、平台接线点 | PRB-13（静态面） |
| `log-06-git-clean.txt` | 本单落盘后的 `git status`/`git diff --stat`（仅 probe 新件；并发在途件另注） | 全批 |

> **并发在途件说明**：`log-06-git-clean.txt` 的完整 `git status` 另见 `docs/plan/mig08-closeout.md`（IMPL-08-04 并行施工的未跟踪件，非本单）；本单自身 `git status --porcelain -- docs/probe/pb-3 docs/probe/pb-5` 只显示这两个新目录，`git ls-files --others --exclude-standard docs/probe/pb-3 docs/probe/pb-5` 恰 16 件（两报告＋十四日志），`git diff --stat` 为空，`packages/apps/scripts/templates/package.json` 零改动（日志逐字保留）。
>
> 脱敏说明：日志中的仓根与本机临时路径替换为 `<repo>`/`<tmp>`；其余字节（命令、标准输出、`EXIT=`）逐字保留。日志末尾的「附：探针脚本源」为仓外临时脚本源，不是原始命令输出，已单独标注。

---

## 附录 A（2026-10-29 后续施工）：D12 只读打开已落位

> 本附录只更新「入口要件」事实，不改上文 PRB-13/14/23 的历史判定；PB-5 **仍不宣布通过**。

- 新增 `packages/store/src/readonly.ts`：`openLedgerReadonly(path)`——SQLite `readOnly:true` ＋ `PRAGMA query_only=ON`，不 migrate/不 DDL；缺库=`STALL/db-missing`，未迁移=`rejected_version/schema-behind`，schema-ahead 明确拒。
- 证据：`packages/store/test/v2/readonly-open.test.ts` 8 tests（只读读、写拒、query_only=1、缺库/未迁移/超前拒、不建库、两真实子进程同读且写拒）。
- 对 PRB-14 的意义：D12 入口要件已从「不满足」变为「已落位」；但「台账单写」仍需要 WriterLease/围栏与多进程写侧证据，**PRB-14 仍不得宣称通过**；PRB-23 仍 not-executed，平台读侧契约仍不成立。
- 全 V2 门复跑：1275 tests 全绿（`verify:v2`）。
