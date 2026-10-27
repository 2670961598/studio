# 81-files/03 · `packages/store` 逐文件契约

> 版本：v0.3，2026-10-27（v0.1 为同日初稿；v0.2 按 80 定稿接口做一致性修订；v0.3 按 80-§6.3「记录面存储不变量」补 `records`/`record_payloads`/`record_transactions` 的落点、写读签名与迁移损失口径，关闭 D1/D3/D6/D7/D16）。
> 性质：**自然语言级文件与实现设计呈审稿**，不是现行文件树、实现单或完成证明。
> 上位：75-§五 的文件契约模板与本卷主索引 §二/§四；76-§1.2（标量）、§4.2（信封）、§8.3/§8.4（`REC-MIG-01`/`REC-LOSS-01`）；77-§9.2（六态）、§11.1（14 类失败）；78-§10.1/§10.3/§10.4（`BIND-STORE-01`、`L78-STORE-01..04`）、§7.4.1（`SEC-*` 秘密清单）；79-§9 `DEP-NODESQLITE`/`DEP-ZOD`/`DEP-DRIZZLE`、§10.1 第 10 条、79-D10；80-§2.1（层位）、§4.1/§4.2（信封与标量）、§5.7（错误两轴）、§6.3（REC-01..04）、§6.6（`intent_receipts`、`MigrationService`）、§8.2（单写域与只读打开）、§8.3（六段写）、§9.4（API 装配）、§10.6（超限件）、§10.7（目录预算）、§11.2.1（秘密供给）、§11.3（路径与原子写）、§12.5（`U80-16`）。
> 修订要点（v0.1→v0.2，逐条对应 80 定稿）：
> 1. 错误一律改用 `ClassifiedError{failure,category,subcause,detail?}`：`failure` 取 77-§11.1 十四类下划线值并按 80-§5.7 驱动处置，`category` 只作观测；旧稿把版本/忙/终态错误统一写成 `CONFIG_INVALID` 的地方按 80 改正（§1.4 是唯一映射表，各条目只写 `failure` + subcause）。
> 2. 只读打开按 80-§8.2 落位为 `openLedgerReadonly(o: ReadOnlyLedgerOpen): Result<ReadOnlyLedger, ClassifiedError>`，另立 `openLedgerMaintenance`；旧稿自拟的 `ReadLedger` 内部类型作废，改为复用 80 的 `ReadOnlyLedger`/`RecordPage`。
> 3. `TxScope`/`TxHandle`/`TxReceipt` 按 80-§6.3 字段写实，不再标「待 80 定义、签名暂定」。
> 4. `ProjectionName` 已有定稿且含 `intentReceipts`：新增 `src/ledger/intent-receipts.ts` 与 v14 DDL；`RecordProjection` 的派生规则以注入 projector 表提供，store 不内建业务派生。
> 5. `migrations.ts` 的拆分由「条件待定」升为**必做**：v14 无处可加（600 行即阈）。
> 6. `sha8` 按 80 `TS-SCALAR-08` 只作展示；迁移漂移判定改用完整摘要（新增列，见 §4.3 与 D3）。
> 7. `records/ports` 的 `append` 由「丢字段 + 返回 lossRefs」改为 **fail-closed**（`unsupported/envelope-not-storable`）：静默降级等于 fail-open，与「无证据 = 无完成」相悖（§4.5、§10.4 第 8 条）。
> 8. `dumpEvents` 按 80-§11.3 改为「临时文件 + rename」原子写（原 D7 关闭）；事务回执与 `commitSeq` 的载体改为 `record_transactions`（v15 建表），`daemon_kv` 只留游标/拍序（D6 关闭）。
> 9. 新增 §十一「回执的四个层次」：`AppendReceipt`（不落库）/ `TxReceipt`（落 `record_transactions`）/ `REC-RCP-01`（EFF-01 写）/ `IntentReceipt`（投影行）逐层分开——投影不是回执，`proofRef` 不得拿本事务记录冒充。
> 10. 开库点口径按 80-§8.2 记 **14 处（按调用者）/16 处（按表达式）/3 处注入闭包**，三者不混用（§8.1、D14）。
> 11. 读面按 80 最新（§6.3/§8.2）统一：`RecordReader.get`/`query` 返回 `Promise<Result<…>>`；`ReadOnlyLedger.get`/`query` 返回**同步** `Result<…>`，`Ok(undefined)` 才表示不存在，运行期读失败一律 `Err(unavailable/STALL, ledger-read-failed)`；三条查询 subcause 逐字取 `ledger-query-unsupported`/`ledger-cursor-invalid`/`ledger-query-invalid`（旧稿自拟的 `query-limit-exceeded`/`cursor-broken` 作废）。
> 12. 落点按 80-§6.9：`src/records/`（REC-01..05）、`src/recon/`（REC-06）、`src/lease/`（AUTH-04 持久面）、`src/memory/`（MEM-01）、`src/resources/`（RES-01 投影）；只读打开唯一目标路径仍是 `packages/store/src/ledger/open.ts`（旧双名 `ReadLedger` 与 `open-readonly.ts` 一律作废）。
> 13. 投影与 hook：`intent_receipts` 与资源账目（投影名 `resourceLedger`、物理表 `resource_ledger`）都是同事务 projection hook 写的**可重建投影**（不是第二事实源）；store 只提供 hook 机制（`records/hooks.ts`：事务内派生写表 + commit 后同一微任务回调），派生策略与内存快照归 daemon（`IntentReceiptStore`，80-§6.6 规则 5/7/9）；进程被 kill 后由启动 `rebuild()`（先表、后快照）恢复，失败即拒启动；API 只拿只读视图，拿不到可写 `Ledger`。
> 14. 记录面**载体**按 80-§6.3 落三表：`records`（整封不可变）+ `record_payloads`（原始字节、`contentDigest` 内容寻址）+ `record_transactions`（事务账）。`events` 退为**可重建投影**（`REC-EVT-01` 的落库形态），`appendEvent` 不再是 REC-01 的实现（80 原文禁止）。三表的 SQL 唯一落点是 `src/records/persistence.ts`，v15 DDL 落 `src/migrations/records.ts`（D1 关闭）。
> 15. 写读签名按 80 `TS-PORT-REC-01/02` 改：`append(input: RecordWriteInput, opts?: AppendOptions)`（`RecordWriteInput = { envelope, payload: { ref, bytes, mediaType } }`，类型归 `contract`，本卷只落实现）；`RecordReader.payload(ref)`（异步）与 `ReadOnlyLedger.payload(ref)`（同步）按需读字节，`Ok(undefined)` **只**表示「该定位没有载荷」；查询只回信封、越权行不计数也不透出总数。
> 16. `commitSeq`/`proofRef` 落 `record_transactions`（D6 关闭）：`commitSeq` 由提交该事务的**同一单写事务**分配、唯一单调；提交证明是同事务写入的一条 `REC-RCP-01`，`proofRef` 指向它，**证明写不出即整体回滚**，不存在「已提交无证明」；`abort`/`unknown`/超时对账各写一行。
> 17. `authorityDomain` 由 `AuthorityRequirementSource` 需求 + 当前激活判定，多域歧义时缺失即拒；`ProjectionSource` 的 `since`（增量起点）与 `asOf`（快照时点）互斥；`factDomains → 本地表` 由注入的 `Projector` 在注册时声明，不硬编码常量表（D16 关闭）。
> 18. 迁移损失按 80-§4.6/§6.6：`events` 旧行缺字段**不回填**，重建为 `provenance.derivation='reconstructed'` + 实际形成时间 + `limitations` + `REC-LOSS-01`，旧摘要标 `unknown`（D3 关闭）；schema 迁移在**独占事务**里产 `REC-MIG-01`（D7 关闭），`records` 落地前的 `schema_version` 行只是实现日志、不是记录。
> 边界：本附录只把 80 的组件与端口落到文件；**不新增公共概念、端口、状态、允许边或依赖版本**。发现 80/78 缺端口、缺类型或缺存储载体须回写（清单见 §十），不在此私设。`F-contract-port-intent`（`contract/src/ports/intent.ts`）、`F-contract-port-secret`（`contract/src/ports/secret.ts`）、`F-core-work-readiness`（`core/src/work-readiness.ts`）、`F-daemon-intent-ingress`/`F-daemon-intent-receipt-store`、`F-daemon-api-assemble` 属 01/02/17 卷的**文件家**，本卷只写 store 侧交付面与依赖前置，**不重复其文件契约**（81-§六 第 5 条与「无跨卷重复」）。
> 门禁：本文所有「目标/拆分/新增/退役」均为设计处置，尚未执行；不得据此直接改源码、manifest 或 guards。
> 标签：`现有` / `库级·未接` / `目标-保留` / `目标-拆分` / `目标-新增` / `目标-替换` / `目标-退役` / `仅测试` / `未证`（81-§四）。

---

## 〇、本附录的范围、复算口径与计数

覆盖 `packages/store` 的全部第一方文件：

| 类别 | 现有件数 | 复算方式 | 目标件数 |
|---|---|---|---|
| 生产源码 `src/*.ts` | 15 | `ls packages/store/src/*.ts` | **64**（15 直下 + `ledger/` 12 + `records/` 17 + `migrations/` 14 + `recon/` 1 + `lease/` 1 + `memory/` 2 + `resources/` 2） |
| 测试 `test/*.test.ts` | 15 | `ls packages/store/test/*.test.ts` | **36** |
| 测试助手 `test/ulid.ts` | 1 | `ls packages/store/test/ulid.ts` | 1 |
| 包配置件 | 2 | `package.json`、`tsconfig.json` | 2 |
| 合计 | **33** | `find packages/store -type f -not -path '*/node_modules/*'` | **103**（64+36+1+2） |

目标侧的复算链（两向可验，任一列改动必须三处同改）：`src` 直下 15 件不变（拆分产物全进子目录）；`src/ledger` 12 = 现有 9 个表族 + `shared` + `open` + `intent-receipts`；`src/records` 17 = 7 形状 + 10 记录面（`writer`/`reader`/`projection`/`hooks`/`transaction`/`correction`/`ports`/`credentials`/`persistence`/`reconstruct`）；`src/recon` 1、`src/lease` 1、`src/memory` 2、`src/resources` 2；`src/migrations` 14 = `index` + **13 个版本族**（`events`/`work`/`company`/`budget`/`hr`/`jobs`/`candidates`/`reports`/`pricing`/`usage`/`cost`/`intent`/`records`——按 v1–v15 实际归属切的 13 个族，见 §4.3 表）。`test` 目标 36 个 `.test.ts` = 保留 14 + 新建 18（`test/` 直下 `open`/`transaction`/`intent-receipts` 3 + `test/records/` 9 + `test/recon/` 1 + `test/lease/` 1 + `test/memory/` 2 + `test/resources/` 2）+ `candidates/` 4；`test/ulid.ts` 助手另计。

现有行数合计 9061（`wc -l src/*.ts test/*.ts package.json tsconfig.json`）：`src` 4975、`test` 4059、配置 27。行数为 2026-10-27 实测，仅作规模核对，**不作能力证据**。

排除：`.git`、`node_modules`、`dist` 及生成物、根 `package.json`/`bun.lock`/`tsconfig*.json`（归 `81-files/19`）、第三方源文件、历史设计文档。本包无 `test/fixtures/`、无 README、无 `src` 内测试件。

〔事实〕本包**没有** `migrations/`、`ledger/`、`records/` 子目录；15 个 `src` 文件平铺（`ls packages/store/src/*.ts | wc -l` = 15，未超 `maxFilesPerDirectory=25`）。〔事实〕全仓 `grep -rn "intent_receipts\|IntentReceipt" packages apps --include=*.ts` 零命中——**该表与回执类型都还只是 80 的目标**，不是现状；本附录不得把它写成已有。

---

## 一、包身份与边界

### 1.1 身份

| 项 | 值 | 依据 |
|---|---|---|
| 包名 | `@studio-next/store` | `packages/store/package.json:2` |
| 版本 | `0.1.0`，`private: true` | 同上 `:3-4` |
| 层位 | **2**（`contract` 0 → `core`/`adapters`/`yt` 等 1 → **`store` 2** → `company` 3） | `scripts/guards/boundary-rules.mjs:78-95`；80-§2.1 第 2 行 |
| 目标语义 | 「不变；补 `RecordTransaction` 的事务型接口」 | 80-§2.1 `:124` |
| 模块形态 | `type: "module"`，ESM，Node 24 原生 type-stripping 直跑 `.ts` | 79-§4 |
| 入口 | `main: "src/index.ts"`、`exports["."]: "./src/index.ts"` | 79-§4.4「源码态」 |
| 发布/构建 | 不发布、不进构建闭包、无 `dist` | 79-§7.1 `:815` |
| 包级类型门禁 | `tsc --noEmit -p tsconfig.json`，`include: ["src/**/*.ts"]` | `packages/store/tsconfig.json:4`；`test/` **不在门禁内**（79-D10） |
| 运行时依赖 | `@studio-next/contract`、`zod ^4.0.0` | `package.json:15-18` |
| 测试专用依赖 | `@studio-next/core`（devDependency） | `package.json:19-21`；79-§10.1 第 10 条判「正确，保留」 |
| 引擎 | `node:sqlite`（`DatabaseSync`） | 79 `DEP-NODESQLITE`；`src/driver.ts:23` |
| 已弃选型 | `drizzle-orm`（0.44.7 稳定线无 `node:sqlite` 驱动） | 79 `DEP-DRIZZLE`；`src/driver.ts:4-13` |

〔备注·编号漂移〕79-§11 把 `store` 记作「L3」（其自有 L 编号把 `contract` 记为 L1）；与 80-§2.1、`boundary-rules.mjs` 的「层位 2」不是同一把尺子。本附录统一用**层位 2**，不改 79 的编号（回写项 D10）。

### 1.2 允许边与禁止边

〔事实〕`src` 的实际 import（`grep -rhoE "from '[^']+'" src/*.ts | sort | uniq -c`）：

| 目标 | 次数 | 性质 |
|---|---|---|
| `@studio-next/contract` | 12 | 运行期值（`configInvalid`、`validateEventRecord`、`UlidSchema`）+ 类型 |
| `node:sqlite` | 8 | 引擎句柄（`driver`/`migrations`/`ledger`/`probes`/`pricing`/`usage`/`cost`/`hr-sync-queue`） |
| `zod` | 5 | `records`/`cost`/`usage`/`pricing`/`todo-queue-records` |
| `node:fs` / `node:fs/promises` / `node:path` / `node:os` / `node:crypto` | 3 / 1 / 1 / 1 / 1 | 仅 `rebuild`/`drill`/`migrations` |
| 包内相对 | 41 | 见各条目 |

〔结论〕允许边（不新增；目标只扩 `store → contract` 的**导入面**，不开新边）：

| 边 | 状态 | 说明 |
|---|---|---|
| `store → contract` | 在用（运行期），目标扩面 | 现状 12 处（`configInvalid`、`validateEventRecord`、`UlidSchema` + 类型）。目标另需 80 已定稿的公共类型（**type-only**）：`ClassifiedError`/`FailureClass`、`RecordEnvelope`、`RecordQuery`/`RecordPage`、`AppendOptions`/`AppendReceipt`、`ProjectionName`/`ProjectionSource`/`ProjectionResult`、`TxScope`/`TxHandle`/`TxReceipt`、`IntentKey`/`IntentReceipt`、`CredentialRefDraft`/`CredentialRef`/`RevocationProof`。它们都在 `packages/contract` 内，**不新增包边**，但 `src` 侧新增 8 处 import 属可见变更，须在 M1 一并与 guard 复核 |
| `store → core` | **冻结但 src 零使用** | `boundary-rules.mjs:133` 允许；实际只有 `test/v5-candidates.test.ts`、`test/v9-pricing.test.ts` 经 devDependency 使用（79-§10.1 第 10 条）。80 把 `RuleEvaluator` 与五门纯求值放进 `core`（`core/src/work-readiness.ts`），**store 不得因此引入 `core`**：五门调用方是 daemon，不是库。**src 一旦引入即视为新边，须提案** |
| `store → zod` | 在用 | 第三方，非包边；79 `DEP-ZOD` |
| `daemon/panel/api/company → store` | 在用（入边） | `daemon`、`panel` 运行期读/写台账；`api` 为装饰性依赖（80-§10.6，M2 后由 `assembly/api/assemble.ts` 经 daemon 持只读视图，`api` **不直连 store**）；`company` 仅 `reports.ts:35` type-only（04-§1.2） |
| `store → company/panel/daemon/api/adapters/yt/gateway/prompt` | **禁止** | 反向边；`company` 的报表聚合不得下沉到 store。`openLedgerReadonly` 的 `company` 维度筛选**只收参数**，不得 import `company` |

〔结论〕层内纪律（本附录自设的实现约束，不是新公共概念）：
1. `src` 内**只有一个引擎打开点**（`driver.openSqlite`），其余文件只吃 `DatabaseSync` 句柄（`driver.ts:16` 头注）；只读/维护分支也在该函数内以参数区分，**不得**另开第二个 `new DatabaseSync`；
2. `src` 内**不得** import `@studio-next/core`（含 `work-readiness.ts`）；
3. 表族模块之间不互相 import（只向 `ledger/shared.ts`、`../row-helpers.ts`、`../records.ts` 下行）；唯一例外是 `records/ports.ts`（以及它组合的 `records/*` 记录面），它只读地引用 `ledger/events.ts`/`ledger/company.ts`/`ledger/intent-receipts.ts`（80-§6.3 的包装关系），**不得**反向被这三个表族 import；`records/hooks.ts` 也不得被表族引用（钩子只由 `records/transaction.ts` 调用）；
4. `src` 内**不得**出现第二套脱敏正则或第二套秘密读取（80-§11.2-3）：store 只写库，不做出站脱敏；若某写面需要脱敏，由调用方（daemon）在入参前用 `contract` 的纯函数处理。

### 1.3 三个事实源与唯一写入者（现状 vs 目标）

〔事实〕store 整体是**可重建投影**（`index.ts:1-9`：「每一行都要能回答权威源是谁」），但库内各表并不同质。按「能否从别处重算」分成五类（第一类是**记录事实**，v15 起才存在；第三类的第一项是它的 legacy 载体）：

| 类 | 表 | 现状机制 | 上位 |
|---|---|---|---|
| 记录事实（append-only，触发器禁改删） | `records`、`record_payloads`、`record_transactions`（**目标新增**，v15） | 现状**不存在**：`events` 17 列装不下整封、也不存载荷字节（§4.6）。目标 = 整封 JCS 字节 + 原始载荷 bytes + 事务账，各挂 `BEFORE UPDATE/DELETE … RAISE(ABORT)`；`record_transactions` 只允许一次终态转移 | 76-§4.2（信封）、80-§6.3 存储不变量 |
| 事件投影（可重建，legacy 行为有损） | `events` | 只靠「无 UPDATE/DELETE 代码路径」+ `id` 幂等闸（`ledger.ts:517-551`）；`sha8` 只锁迁移不改，不锁行。目标：由 `records` 派生、可丢弃重建；旧行缺 `basis`/`scope`/`knowledge`/`provenance`/`lineage` ⇒ 只能 `opaque` + `REC-LOSS-01` | F2-01/F2-04、80-§4.4/§4.6、§6.3 |
| 冻结事实（append-only，有触发器） | `personnel_events`、`probes_runs`、`price_snapshots`、`cost_daily` | `BEFORE UPDATE/DELETE … RAISE(ABORT)`（`migrations.ts:141-145`、`:345-349`、`:488-493`） | 77、132-§6 |
| 可重建投影（可覆盖/整表换） | `people`、`departments`、`ticket_mirror`、`todo_queue`、`usage_daily`、`ledgers`、`reports`；**目标新增** `intent_receipts` 与资源账目（投影名 `resourceLedger`、物理表 `resource_ledger`） | 覆盖写 / 整表 DELETE+INSERT / 自然键换代；`intent_receipts` 目标由 `REC-WORK-01/02/EVT-03` 派生重建，`resource_ledger` 由 `REC-WORK-05`/`REC-EVD-01`/`05`/`06` 派生重建（两者随 `MIG-01`，**未实现**） | 77 `REC-OBS-01`、80-§6.3 `RecordProjection`、80-§6.6 |
| 运行时状态（不可从事件重算） | `jobs`（`last_run_at`）、`budgets`（预算账）、`hr_sync_log`（任务队列）、`daemon_kv`（游标/拍序） | 单向覆盖 / 乐观锁流转 / 键值覆盖 | 17-§2/§3、18-§三、52-§11 |

〔结论〕**`events` 不是完整事实源**：它只装 30 种事件投影所需的列，装不下 `RecordEnvelope` 的 `basis`/`scope`/`provenance`/`integrity`/`knowledge`/`payloadRef`/`lineage`，也不存载荷字节。v15 起**记录事实的唯一源是 `records`**（+ `record_payloads` 字节 + `record_transactions` 账），`events` 是可丢弃重建的投影——「库里只有 `events` ⇒ 记录齐全」判负（80-§6.3）。反向不成立：`events` 的旧行**不能**无损升成 `records`，缺字段只能 `opaque` + `REC-LOSS-01`，旧摘要只能 `unknown`（§4.5 `reconstruct`、§10.2 D3）。

〔结论〕第五类**不是投影**：`jobs.last_run_at`、`hr_sync_log` 的 `status/attempts`、`daemon_kv` 的游标一旦丢库就无法从 `records` 重算。删库重建（`rebuild`）只重放记录（v15 前重放 `events`，v15 后重放 `records`），因此重建后第五类表为空——这是 `drill` 只比对 `events` 与 `schema_version` 的原因，**不是遗漏**。该语义未在 76/77 立条，回写项 D9。

〔结论〕`intent_receipts` 进 store 的理由只有一条：**表在这里**。派生规则（怎么从 `REC-WORK-01/02` 与 `REC-EVT-03` 算出 `status`/`outcome`/`gap`）归 daemon 的 `IntentReceiptStore`（`apps/daemon/src/assembly/intent/receipt-store.ts`，17 卷），store 只提供「按唯一键落一行 / 整表替换 / 按状态扫描」的持久化原语。**store 不写任何 `REC-*`，也不判 TTL**；`expiresAt` 是投影上的导出值（`receivedAt + idempotencyTtlMs`）。

〔结论〕「唯一写入者」现状是**部署事实**而非机制：78-§10.3 `L78-STORE-01` 明写「跨进程单写未证」；`store` 无法验证调用方身份。80-§8.2 给的机制是「迁移只在 daemon 独占窗口 + 只读面不跑 DDL」，本卷据此拆出 `openLedgerReadonly`/`openLedgerMaintenance`，但**仍不声称跨进程单写已证**。

### 1.4 错误与失败分类：store 侧唯一映射（不得各面另定）

〔结论〕80-§5.7 定了两轴一个载体；store 的实现只做**映射**，不改词表。下表是本附录全部条目「错误」行的唯一来源，条目里只写 `failure` 与 subcause，不重复 category。表中 `category` 列记的是 **`classified()` 按 80-§5.7 推导出的缺省值**——80 只允许三处显式覆盖（合并域 `MERGE_CONFLICT`、泳道域 `NO_LANE`、HTTP 404 `EXTERNAL_REJECT`），store 三处都用不上，故 store 侧**一律省略 `category`**，由构造器填缺省。

| 场景（store 内） | `failure`（77 原值） | `category`（缺省） | subcause 例 | 处置含义 |
|---|---|---|---|---|
| 记录形状/值域不过（zod 或记录闸）、字段缺、批内重复 | `rejected_precondition` | `CONFIG_INVALID` | `store/<面>:invalid`、`store/people:duplicate` | 补齐后重提同一请求；缺件时不得自动重试 |
| 配置/路径缺失或畸形（`ledgerPath` 非字符串、`upTo` 越界、非法 status 集合） | `rejected_precondition` | `CONFIG_INVALID` | `bad-path`、`store/migration:bad-up-to` | 同上 |
| 查询超出入参限额 / 请求了未开放的排序或字段组合（REC-02、只读面同码） | `unsupported` | `EVOLVE_REJECT` | `ledger-query-unsupported` | 请求形状合法、只是该查询形状尚未开放（属演进域，**不是**配置错）：收窄条件后重查；不得自动降 `limit`、不得截断后返回 |
| 游标不可解 / 已作废 / 与本次条件不匹配（REC-02、只读面同码） | `conflict` | `EXTERNAL_REJECT` | `ledger-cursor-invalid` | 非合并域冲突一律 `EXTERNAL_REJECT`（不写 `MERGE_CONFLICT`）：从首页重查；不得把游标当 offset 推算，也不得改判成 `rejected_precondition` |
| `RecordQuery` 形状非法（未知字段、类型不符、`limit`/`order` 缺失） | `rejected_precondition` | `CONFIG_INVALID` | `ledger-query-invalid` | 改调用后重提；不得把形状错当超限 |
| 单条读运行期失败（库不可读、行损坏、库被替换；`get` 与 `query` 同码） | `unavailable` | `STALL` | `ledger-read-failed` | 退避重试 + 健康观测；**不得**降级成 `Ok(undefined)` 或空页 |
| schema 版本落后/超前（只读面、写面、维护面一致对待） | `rejected_version` | `EVOLVE_REJECT` | `schema-behind`、`schema-ahead` | 重读版本 + CAS 后决定；**不得**自动迁移 |
| 迁移脚本摘要与 `schema_version` 记录不符（含拆分后字节漂移） | `rejected_version` | `EVOLVE_REJECT` | `schema-digest-mismatch` | 同上；**不再是 `CONFIG_INVALID`** |
| 同 `id` / 自然键 / 单据键重复且内容不一致 | `rejected_idempotency` | `EXTERNAL_REJECT` | `store/evt:duplicate-id`、`store/budget:duplicate-id`、`store/candidates:duplicate-id`、`store/reports:id-conflict`、`store/price-snapshot:ticket-conflict` | 换键或更正内容；不得重试 |
| CAS 基准不符（`transitionCandidate` 的 `from`、`hr_sync_log` 的 `claim/complete` 期望态） | `rejected_version` | `EVOLVE_REJECT` | `cas-from-mismatch`、`cas-row-changed` | 端口层在「必须成功」时映射；返回 `false` 的句柄方法保持布尔，不改成抛错 |
| 非法状态出口（`endWorkRecord` 已 ended、`failHrSync` 非 applying、`cost_daily` 已首冻） | `rejected_state` | `EXTERNAL_REJECT` | `store/work-record:already-ended`、`store/hr-sync:not-applying`、`store/cost-daily:final-exists` | 走合法出口后另提；不得原地重试 |
| append-only 触发器拒绝 UPDATE/DELETE | `rejected_forbidden` | `EXTERNAL_REJECT` | `store/evt:append-only`、`store/cost-daily:append-only` | 只追加；不得改写历史 |
| 库文件缺失（只读面、维护面显式要求存在时） | `unavailable` | `STALL` | `db-missing` | 退避重试（串行、计入断路）；**不建库** |
| `SQLITE_BUSY` / 锁等待超 5s / 只读文件系统 / 库损坏 | `unavailable` | `STALL` | `db-busy`、`db-readonly-fs`、`db-corrupt` | 退避重试；不得改写成 `CONFIG_INVALID` |
| 载体缺位（schema < v15，`records`/`record_payloads` 未建；整封记录无处可落） | `unsupported` | `EVOLVE_REJECT` | `envelope-not-storable` | 跑迁移或换绑定；**不得**退回 `appendEvent` 假装成功、不得静默丢字段 |
| 载荷面四态（未给载荷 / 摘要不符 / 媒体类型不符 / 字节不可重读） | `rejected_precondition` | `CONFIG_INVALID` | `payload-missing`、`payload-digest-mismatch`、`payload-media-type-mismatch`、`payload-unreadable` | 补齐重提；**不是** `unsupported`（输入不合法，不是能力未开放）；四码逐字取 80-§6.3 |
| 载荷越权（`payload(ref)` 的调用方读不到该信封） | `rejected_forbidden` | `EXTERNAL_REJECT` | `payload-not-authorized` | 换有权的调用方；**不得**回 `Ok(undefined)` 冒充「没有载荷」 |
| 单条信封 > 1 MiB / 单载荷 > 8 MiB | `rejected_precondition` | `CONFIG_INVALID` | `payload-too-large`（`detail.which` 取 `'envelope'` 或 `'payload'`） | 拆批或外置（`storageHint` 指向外部存储属未实现项）；**零行写入** |
| `authorityDomain` 多域歧义且 `opts` 未给 / 与 `TxScope` 域不一致 | `rejected_precondition` | `CONFIG_INVALID` | `authority-domain-ambiguous`、`tx-scope-domain-mismatch` | 显式给域后重提；**不得**按「第一个命中/字典序最小/默认域」猜 |
| `ProjectionSource` 的 `since` 与 `asOf` 同给 / `factDomains` 含未登记域 | `rejected_precondition` | `CONFIG_INVALID` | `projection-source-invalid` | 二选一后重提；未登记域须先登记，不静默跳过 |
| 提交证明写不出（`REC-RCP-01` 落不下去） | `unavailable` | `STALL` | `store/record:proof-unwritable` | 整个事务回滚、`status` 不得留 `committed`；退避重试 |
| 投影名未注册 / 派生器未注入 | `unsupported` | `EVOLVE_REJECT` | `projection-not-registered` | 同上（端口按 80 允许抛 `ClassifiedError`） |
| 断言失败/不可达分支 | `rejected_precondition` | `CONFIG_INVALID` | `internal-bug` | 缺陷，不得当业务分支 |

〔口径·subcause 写法〕**只读打开面（`openLedgerReadonly`）与读面的四个码一律裸写、逐字取 80**：`db-missing`、`schema-behind`/`schema-ahead`、`bad-path`、`ledger-query-unsupported`、`ledger-cursor-invalid`、`ledger-query-invalid`、`ledger-read-failed`，**不得加 `store/open:` / `store/record:` 前缀**（§4.5 条目同此口径）。其余面的 subcause 以本表所列**语义名**为准，可加面位前缀指定位点（`store/<面>:<语义名>`，如 `store/evt:duplicate-id`、`store/migration:bad-up-to`、`store/rebuild:db-busy`）；加前缀不改变 `failure`、不改变处置。两种写法都不得被下游当判等键（80-§5.7 第 3 条：`subcause` 只作实现细目与日志检索）。

〔口径·80 已统一，本卷照抄结论〕`STATE_CONFLICT` 在全卷**不存在**；80-§6.3/§8.2 的四个码逐字为：`ledger-query-unsupported` = `failure:'unsupported'` + `category:'EVOLVE_REJECT'`（80 明写「**不是** `CONFIG_INVALID`：请求合法但该查询形状未开放，属演进域」）、`ledger-cursor-invalid` = `failure:'conflict'` + `category:'EXTERNAL_REJECT'`（非合并域冲突不写 `MERGE_CONFLICT`）、`ledger-query-invalid` = `rejected_precondition` + `CONFIG_INVALID`、`get` 读失败 = `unavailable` + `STALL` + `ledger-read-failed`。`category` 由 `classified(input)` 按 80-§5.7 的缺省推导（见上条；store 不给显式覆盖）。

三条硬纪律：

1. **store 永不产出 `NO_LANE`**：那是「显式 lane 上下文」才允许的覆盖，库层没有泳道标识；也不产出 `GATE_FAIL`/`WORKER_DEAD`/`QA_BACK`/`DISPATCH_FAIL`/`LLM_FAIL`（内部事件与熔断域，80-§5.7 明列构造器拒收）。
2. **`failure` 决定处置、`category` 只作观测**：`db-busy` 不得因为 `STALL` 被读成「整体重试一切」；`sha8`/摘要不符不得因为曾是 `CONFIG_INVALID` 被读成「配置改一下就好」。
3. **构造期只走 `configInvalid(...)`**（`contract/src/schemas/errors.ts`，固定 `rejected_precondition` + `CONFIG_INVALID`；80-§5.7 明写它不是 `classified()` 的分支）。其余 13 类**目前没有公共构造器**——`contract` 只有 `configInvalid` 一个具名构造函数（§10.2 D2）。80-§5.7 已给出**目标**构造器 `classified(input: ClassifyInput)`：对象入参（`failure`、`subcause`、可选 `detail?`/`category?`），省略 `category` 是常态、按缺省推导，给了不允许的覆盖或非法值在构造期 `configInvalid('classified-input-invalid')` 抛出；**代码未落**。现状 `ClassifiedError`（`contract/src/ports/kernel.ts`）**只有** `category`/`subcause`/`detail`，没有 `failure`；`ErrorCategory` 仍是 11 值。在此之前 store 只能逐字构造 `{ failure, category, subcause, detail? }` 字面量，**不得**在 store 内私设第二个 `ClassifiedError` 形状、第二个 `ErrorCategory`，也不得使用 `STATE_CONFLICT`（该值全卷不存在，不是第 12 个 category）。

---

## 二、现有件全集

### 2.1 生产源码（15 件，按域分组）

| 文件 | 行数 | 域 | 一句话 |
|---|---|---|---|
| `src/index.ts` | 271 | 包根 | 公共 barrel + 两常量 + 约 140 行 TODO/拟稿待批注释块 |
| `src/driver.ts` | 36 | 引擎触点 | 唯一 `openSqlite`，WAL/NORMAL/FK/busy_timeout=5000 |
| `src/row-helpers.ts` | 40 | 行映射 | `SqlRow` + `str/optStr/optNum` + `assertRecord` 形状闸 |
| `src/records.ts` | **606**（基线 606） | 记录形状 | 13 张表的 interface + `z.strictObject` schema + 候选/报表/人事值域 |
| `src/todo-queue-records.ts` | 49 | 记录形状 | `todo_queue` 记录 + schema（拆分先例；文件头自述「v8」，迁移实际是 v9，见 §4.2 注记） |
| `src/migrations.ts` | **600**（顶格） | 迁移 | `MIGRATIONS` v1–v13 + `LATEST_VERSION` + `migrate`/`currentVersion` + `sha8` |
| `src/ledger.ts` | **1683**（基线 1684） | 台账立面 | `Ledger` 接口 + `openLedger` + 80-§10.6 的八表族全部读写 + `daemon_kv` + 两处 `BEGIN` + `db` 暴露 |
| `src/rebuild.ts` | 63 | 维护 | JSONL → 新库单事务重放，坏行带 1 起行号 |
| `src/drill.ts` | 216 | 维护 | 删库重建演习（26 条确定性语料 + 四检查 + 人读报告） |
| `src/perf.ts` | 218 | 聚合 | 绩效五指标纯函数（零 IO、零 `Date.now`） |
| `src/probes.ts` | 123 | 独立面 | `probes_runs` 读写面（自 `ledger.ts` 已拆出） |
| `src/hr-sync-queue.ts` | 198 | 独立面 | `hr_sync_log` 四态流转 + `setPersonStatus` |
| `src/pricing.ts` | 314 | 独立面 | `price_snapshots` append-only + `version=MAX+1` + 单据幂等 |
| `src/usage.ts` | 262 | 独立面 | `usage_daily` 并格 upsert + 整组 replace |
| `src/cost.ts` | 296 | 独立面 | v12 迁移条目 + 定型账面（final/adjustment） |

〔事实·现状缺口三条（不是设计遗漏，逐条有回写项）〕
1. **没有 `intent_receipts` 表、没有 `intent_receipts` 读写面**：80-§6.6 把它列为唯一键 `(company, source, kind, ticket ?? dedupKey)` 的可重建投影，全仓零命中（`grep` 见 §〇）。store 侧要补的是表（v14）与持久化原语（§4.4 `F-store-ledger-intent-receipts`），派生仍归 daemon。
2. **金额列全是 `REAL`**：`events.cost_usd`（`:60`）、`work_records.cost_usd`（`:80`）、`budgets.estimated_usd/actual_usd`（`:184-185`）、`jobs.budget_cap`（`:214`）、`usage_daily` 的 `cost_usd`（`:339`）、`price_snapshots.input_per_m/output_per_m/…/plan_monthly_usd`（`:472-478`）。80 `TS-SCALAR-04/09` 要求公共金额用 `DecimalString` + 显式币种、**边界转换不经 float**；现状是 float 等值比较，属**待迁移项**（§4.2 与 D4），本卷不改列，只登记。
3. **`schema_version` 只有截断摘要**：列名 `sha8`、值 `sha256[:8]`（`migrations.ts:545-548`、`:561`），且**被当作防漂移比对依据**。80 `TS-SCALAR-08` 明写短哈希只作展示、不得作比对依据；属**待迁移项**（§4.3 与 D3）。

### 2.2 测试件（15 个 `.test.ts` + 1 助手）

| 文件 | 行数 | 覆盖对象 |
|---|---|---|
| `test/ledger.test.ts` | 293 | `openLedger`/`migrate` 幂等/PRAGMA/`appendEvent` 闸/`queryEvents`/work+sessions |
| `test/perf.test.ts` | 234 | `perf.ts` 五指标 + 归属律 + `insertReport` 往返 |
| `test/rebuild.test.ts` | 220 | `dumpEvents`/`rebuild`/删库重建/坏行回滚 |
| `test/drill.test.ts` | 128 | `runLedgerDrill` + `spawnSync` CLI 冒烟 |
| `test/v2-tables.test.ts` | 534 | v2 五表、升级路径、`syncCompany`、触发器、时间线、budgets、ticket_mirror |
| `test/v3-jobs.test.ts` | 271 | v3 jobs 全读写面 + 记录闸 |
| `test/v4-debts.test.ts` | 418 | `daemon_kv` 接管（含 daemon 旧 DDL 字节存档）、`endWorkRecord`、desc 通道 |
| `test/v5-candidates.test.ts` | **602**（基线 602） | 候选登记/谱系/乐观锁/verification/core 一致性 |
| `test/v6-reports.test.ts` | 296 | `ledgers`/`reports`/`probes_runs` |
| `test/v7-hr-sync.test.ts` | 109 | `hr_sync_log` 全流转 + `setPersonStatus` |
| `test/v8-model.test.ts` | 102 | `work_records.model` 迁移与升级 |
| `test/v8-todo-queue.test.ts` | 146 | `todo_queue` 整换 + `wait=` 锚 + mirror `assignee` |
| `test/v9-pricing.test.ts` | 269 | 定价面形状/幂等/version/值域一致性 |
| `test/v11-usage.test.ts` | 151 | 用量并格/替换/过滤 |
| `test/v12-cost.test.ts` | 266 | 定型账 final/adjustment/双层拒绝/触发器 |
| `test/ulid.ts` | 20 | 测试用 ULID 生成器（`makeUlid`） |

### 2.3 配置件（2 件）

`package.json`（22 行）、`tsconfig.json`（5 行）。

---

## 三、目标件全集与处置总表

### 3.1 生产件（64 件）

| 稳定 ID | 目标路径 | 处置 | 上位依据 |
|---|---|---|---|
| `F-store-index` | `src/index.ts` | 目标-保留（导出面只增不减；值再导出冻结） | 79-§6.5；80-§2.1 |
| `F-store-driver` | `src/driver.ts` | 目标-保留（补 `opts.readonly`） | 80-§8.2；79 `DEP-NODESQLITE` |
| `F-store-row-helpers` | `src/row-helpers.ts` | 目标-保留 | 79-§6.3 `SqlRow` 收窄范例 |
| `F-store-records` | `src/records.ts` | 目标-拆分（facade 保留） | 80-§10.6「与 ledger 同批拆」 |
| `F-store-todo-queue-records` | `src/todo-queue-records.ts` | 目标-保留 | 既有拆分先例 |
| `F-store-migrations` | `src/migrations.ts` | 目标-拆分（facade 保留，**必做**） | 80-§8.2；76 `REC-MIG-01`；拆分明细见 §5.1b |
| `F-store-ledger` | `src/ledger.ts` | 目标-拆分（facade 保留） | 80-§10.6「按表族拆」 |
| `F-store-rebuild` | `src/rebuild.ts` | 目标-保留（维护写面 + 事务端口） | 80-§8.2/§8.3；F2-12 |
| `F-store-drill` | `src/drill.ts` | 目标-保留（维护写面，离线窗口） | F2-12；16-§四 |
| `F-store-perf` | `src/perf.ts` | 目标-保留 | 130-P4 批示⑥；F2-08 |
| `F-store-probes` | `src/probes.ts` | 目标-保留（改类型来源） | 77；132-C |
| `F-store-hr-sync-queue` | `src/hr-sync-queue.ts` | 目标-保留 | DEV-48、52-§9.2/§11 |
| `F-store-pricing` | `src/pricing.ts` | 目标-保留 | 132-§6.2 |
| `F-store-usage` | `src/usage.ts` | 目标-保留 | 132-§6.1 |
| `F-store-cost` | `src/cost.ts` | 目标-保留 | 132-§6.3 |
| `F-store-records-work` | `src/records/work.ts` | **目标-新增**（拆分产物） | 80-§10.6 |
| `F-store-records-company` | `src/records/company.ts` | **目标-新增** | 80-§10.6 |
| `F-store-records-hr` | `src/records/hr.ts` | **目标-新增** | 80-§10.6 |
| `F-store-records-budget` | `src/records/budget.ts` | **目标-新增** | 80-§10.6 |
| `F-store-records-jobs` | `src/records/jobs.ts` | **目标-新增** | 80-§10.6 |
| `F-store-records-candidates` | `src/records/candidates.ts` | **目标-新增** | 80-§10.6 |
| `F-store-records-reports` | `src/records/reports.ts` | **目标-新增** | 80-§10.6 |
| `F-store-ledger-shared` | `src/ledger/shared.ts` | **目标-新增**（解类型环） | 81-§3.2 |
| `F-store-ledger-events` | `src/ledger/events.ts` | **目标-新增**（拆分产物；REC-01/02 的现状载体） | 80-§10.6、`TS-PORT-REC-01/02` |
| `F-store-ledger-work` | `src/ledger/work.ts` | **目标-新增** | 80-§10.6、§8.3 finalize |
| `F-store-ledger-company` | `src/ledger/company.ts` | **目标-新增**（REC-03 的现状载体） | 80-§10.6、`TS-PORT-REC-03` |
| `F-store-ledger-budget` | `src/ledger/budget.ts` | **目标-新增** | 80-§10.6、§8.3 reserve |
| `F-store-ledger-hr` | `src/ledger/hr.ts` | **目标-新增** | 80-§10.6 |
| `F-store-ledger-jobs` | `src/ledger/jobs.ts` | **目标-新增** | 80-§10.6 |
| `F-store-ledger-kv` | `src/ledger/kv.ts` | **目标-新增** | 80-§10.6、§8.2 |
| `F-store-ledger-candidates` | `src/ledger/candidates.ts` | **目标-新增**（§8.3 CAS 现状锚） | 80-§10.6、§8.3 |
| `F-store-ledger-reports` | `src/ledger/reports.ts` | **目标-新增** | 80-§10.6 |
| `F-store-ledger-intent-receipts` | `src/ledger/intent-receipts.ts` | **目标-新增**（v14 表 + 持久化原语；派生不在此） | 80-§6.6、§6.3 `ProjectionName.intentReceipts` |
| `F-store-ledger-open` | `src/ledger/open.ts` | **目标-新增** | 80-§8.2（`openLedgerReadonly`/`openLedgerMaintenance`/`migrateIfOwner` 原名） |
| `F-store-records-writer` | `src/records/writer.ts` | **目标-新增** | 80-§6.3 `TS-PORT-REC-01`；80-§6.9 落点 |
| `F-store-records-reader` | `src/records/reader.ts` | **目标-新增** | 80-§6.3 `TS-PORT-REC-02`；80-§6.9 落点 |
| `F-store-records-projection` | `src/records/projection.ts` | **目标-新增** | 80-§6.3 `TS-PORT-REC-03`；80-§6.9 落点 |
| `F-store-records-hooks` | `src/records/hooks.ts` | **目标-新增**（同事务投影 hook + commit 后快照回调） | 80-§6.6 规则 7、§8.1 资源账目行 |
| `F-store-records-transaction` | `src/records/transaction.ts` | **目标-新增** | 80-§6.3 `TS-PORT-REC-04`；80-§6.9 落点 |
| `F-store-records-correction` | `src/records/correction.ts` | **目标-新增** | 80-§6.3 `TS-PORT-REC-05`；80-§6.9 落点 |
| `F-store-records-credentials` | `src/records/credentials.ts` | **目标-新增**（AUTH-06 持久适配：`REC-AUTH-04` 引用/版本/到期/吊销；不存值、不建第二秘密表） | 80-§6.2 `TS-PORT-AUTH-06`、77-§3.4、80-§6.9 规则 3/4 |
| `F-store-records-ports` | `src/records/ports.ts` | **目标-新增**（`createRecordPorts` 组合面） | 80-§6.3 REC-01/02/03/04/05；80-§6.9 落点 |
| `F-store-records-persistence` | `src/records/persistence.ts` | **目标-新增**（`records`/`record_payloads`/`record_transactions` 三表的**唯一 SQL 落点**；writer/reader/transaction/open 都经它） | 80-§6.3「记录面存储不变量」；76-§4.2/§4.4 |
| `F-store-records-reconstruct` | `src/records/reconstruct.ts` | **目标-新增**（legacy `events` → `records` 重建：`reconstructed` + 实际形成时间 + `REC-LOSS-01`；维护面，不自动跑） | 80-§4.6、§6.6 过渡段；76-§8.4 |
| `F-store-recon` | `src/recon/reconcile.ts` | **目标-新增** | 80-§6.3 `TS-PORT-REC-06`；80-§6.9 落点 |
| `F-store-lease` | `src/lease/lease.ts` | **目标-新增**（写者租约与围栏的持久面） | 80-§6.2 `TS-PORT-AUTH-04`；80-§6.9 落点 |
| `F-store-memory-entries` | `src/memory/entries.ts` | **目标-新增**（四层记忆的持久面） | 80-§6.6 `TS-PORT-MEM-01`；80-§6.9 落点 |
| `F-store-memory-access` | `src/memory/access.ts` | **目标-新增**（访问审计 `REC-MEM-02`） | 80-§6.6 `TS-PORT-MEM-01`；80-§6.9 落点 |
| `F-store-resources-ledger` | `src/resources/ledger.ts` | **目标-新增**（投影名 `resourceLedger`、物理表 `resource_ledger` + 重建；随 `MIG-01` 落地，**未实现**） | 80-§6.3 目标第 18 个投影名、§6.4 `TS-PORT-RES-01`；80-§6.9 落点 |
| `F-store-resources-hook` | `src/resources/hook.ts` | **目标-新增**（资源投影的同事务 hook） | 80-§6.4 末、§8.1 资源账目行 |
| `F-store-migrations-index` | `src/migrations/index.ts` | **目标-新增**（拆分产物：数组拼装 + runner + 摘要） | 80-§8.2；76 `REC-MIG-01` |
| `F-store-migrations-events` | `src/migrations/events.ts` | **目标-新增**（v1 的 events 段） | 同上 |
| `F-store-migrations-work` | `src/migrations/work.ts` | **目标-新增**（v1 的 work/sessions 段、v8 `model`、v13 `executor_session_id`） | 同上 |
| `F-store-migrations-company` | `src/migrations/company.ts` | **目标-新增**（v2 people/departments/ticket_mirror、v9 `todo_queue` + `ticket_mirror.assignee`、v4 `daemon_kv`） | 同上 |
| `F-store-migrations-budget` | `src/migrations/budget.ts` | **目标-新增**（v2 budgets 段） | 同上 |
| `F-store-migrations-hr` | `src/migrations/hr.ts` | **目标-新增**（v2 `personnel_events` 段、v7 `hr_sync_log`） | 同上 |
| `F-store-migrations-jobs` | `src/migrations/jobs.ts` | **目标-新增**（v3 jobs） | 同上 |
| `F-store-migrations-candidates` | `src/migrations/candidates.ts` | **目标-新增**（v5 candidates） | 同上 |
| `F-store-migrations-reports` | `src/migrations/reports.ts` | **目标-新增**（v6 ledgers/reports/probes_runs） | 同上 |
| `F-store-migrations-pricing` | `src/migrations/pricing.ts` | **目标-新增**（v10 `price_snapshots` + append-only 触发器） | 同上 |
| `F-store-migrations-usage` | `src/migrations/usage.ts` | **目标-新增**（v11 `usage_daily`） | 同上 |
| `F-store-migrations-cost` | `src/migrations/cost.ts` | **目标-新增**（v12：`cost.ts` 的 `costDailyMigration` 在此拼入，保持现有值引用边） | 同上 |
| `F-store-migrations-intent` | `src/migrations/intent.ts` | **目标-新增**（v14 `intent_receipts` + `schema_version.digest`） | 80-§6.6；76 `REC-MIG-01` |
| `F-store-migrations-records` | `src/migrations/records.ts` | **目标-新增**（v15：`records` + `record_payloads` + `record_transactions` + 三个 append-only 触发器 + 索引 + 大小上限） | 80-§6.3 存储不变量；76-§4.2 |

〔结论〕`src` 直下仍 15 件（拆出件全部进 `ledger/`、`records/`、`recon/`、`lease/`、`memory/`、`resources/`、`migrations/` 子目录）：`src/ledger` **12**、`src/records` **17**（7 行形状 + 10 记录面：`writer`/`reader`/`projection`/`hooks`/`transaction`/`correction`/`ports` 七件来自拆分，`credentials` 为 AUTH-06 目标新增，`persistence`/`reconstruct` 为 80-§6.3 存储不变量与 80-§4.6 重建口径的目标新增）、`src/recon` 1、`src/lease` 1、`src/memory` 2、`src/resources` 2、`src/migrations` 14（`index` + 13 版本族，含 v15 `records`），合计 **64**，各目录均 ≤25。**没有**新增域平面散件；直下平面只减不增。

〔结论〕退役件：**无文件退役**。退役的是**职责**而非路径：`F-store-ledger`、`F-store-records`、`F-store-migrations` 的旧职责分别落到 **12/14/14 个拆分件**（`records/` 的拆分产物 = 7 行形状 + 7 记录面），路径保留为 facade（§3.2）。`records/credentials.ts`（AUTH-06）、`records/persistence.ts`、`records/reconstruct.ts`、`migrations/records.ts`（v15）都是**目标新增件，不是拆分产物**，故 `records/` 的 17 件与 `migrations/` 的 14 件都不全来自拆分。`PACKAGE_STATUS='partial'`（`index.ts:145`）标 **目标-退役**（非文件），删除属破坏性变更，须批示（同 04-D1 口径）。

### 3.2 现有 15 个生产件的处置（逐项，不留空）

| 现有路径 | 处置 | 落点 |
|---|---|---|
| `src/index.ts` | 保留 | 值再导出冻结；目标**只增**新面导出（`createIntentReceiptsFace`/`openLedgerReadonly`/`openLedgerMaintenance` 与对应类型）；`PACKAGE_STATUS` 目标-退役；注释块迁出到 docs（D15） |
| `src/driver.ts` | 保留 | 加 `opts?: { readonly?: boolean }`；只读时**不设** `journal_mode`/`synchronous`（写库头），只留 `busy_timeout`；`openSqlite` 仍是唯一打开点 |
| `src/row-helpers.ts` | 保留 | 不动（错误仍是 `configInvalid` → `rejected_precondition`/`CONFIG_INVALID`） |
| `src/records.ts` | 拆分（facade） | → `records/{work,company,hr,budget,jobs,candidates,reports}.ts`，本文件只再导出 |
| `src/todo-queue-records.ts` | 保留 | 不动（由 `records.ts` 转发，`records.ts:605-606`） |
| `src/migrations.ts` | 拆分（facade） | → `migrations/` **14 件**（含 v15 `records.ts`）；本文件只再导出 `LATEST_VERSION`/`migrate`/`currentVersion`/`Migration`。**拆分已由 v14 触发，不再是条件项** |
| `src/ledger.ts` | 拆分（facade） | → `ledger/` **12 件** + `records/` **7 记录面**（`writer`/`reader`/`projection`/`hooks`/`transaction`/`correction`/`ports`；另 `credentials`/`persistence`/`reconstruct` 3 件为目标新增，不来自本文件）（§4.5、§6.9）；本文件只留 `Ledger` 类型再导出与 `openLedger`/`openLedgerReadonly`/`openLedgerMaintenance` 转调 |
| `src/rebuild.ts` | 保留 | 走 `openLedgerMaintenance` + `RecordTransaction`；禁止再取 `ledger.db`（`:30`） |
| `src/drill.ts` | 保留 | 标「维护写面，须离线窗口」；`openLedger` 两处（`:149`/`:164`）随 M4 改；版本断言改 `LATEST_VERSION` |
| `src/perf.ts` | 保留 | 不动（聚合只在内存，金额按 `number` 计算，标注「非公共金额口径」） |
| `src/probes.ts` | 保留 | `AppendResult` 改从 `./ledger/shared.ts` 取（`:13`），解类型环 |
| `src/hr-sync-queue.ts` | 保留 | `records.ts` 收窄为 facade 后 import 路径不变；流转错误改 `rejected_state` |
| `src/pricing.ts` | 保留 | 不动（`Migration` 类型环保留，见 §10.1 类型环行） |
| `src/usage.ts` | 保留 | 不动（日期键只校验形态，不折日、不读宿主时区） |
| `src/cost.ts` | 保留 | 不动（`costDailyMigration` 的**值引用**改由 `migrations/reports.ts` 取，见 §5.1b） |

### 3.3 目标测试件（37 件 = 36 测试 + 1 助手；下表另列 1 条退役作对照）

| 稳定 ID | 目标路径 | 处置 |
|---|---|---|
| `F-store-test-ledger` | `test/ledger.test.ts` | 保留（去 `ledger.db` 直查；补摘要不符/`bad-up-to` 两例） |
| `F-store-test-perf` | `test/perf.test.ts` | 保留 |
| `F-store-test-rebuild` | `test/rebuild.test.ts` | 保留（版本断言去硬编码） |
| `F-store-test-drill` | `test/drill.test.ts` | 保留（`spawnSync` 段外迁，见 §九） |
| `F-store-test-v2-tables` | `test/v2-tables.test.ts` | 保留 |
| `F-store-test-v3-jobs` | `test/v3-jobs.test.ts` | 保留 |
| `F-store-test-v4-debts` | `test/v4-debts.test.ts` | 保留 |
| `F-store-test-v6-reports` | `test/v6-reports.test.ts` | 保留 |
| `F-store-test-v7-hr-sync` | `test/v7-hr-sync.test.ts` | 保留 |
| `F-store-test-v8-model` | `test/v8-model.test.ts` | 保留 |
| `F-store-test-v8-todo-queue` | `test/v8-todo-queue.test.ts` | 保留 |
| `F-store-test-v9-pricing` | `test/v9-pricing.test.ts` | 保留 |
| `F-store-test-v11-usage` | `test/v11-usage.test.ts` | 保留 |
| `F-store-test-v12-cost` | `test/v12-cost.test.ts` | 保留 |
| `F-store-test-v5-candidates` | `test/v5-candidates.test.ts` | **目标-退役**（602 行；拆为下 4 件） |
| `F-store-test-candidates-insert` | `test/candidates/insert.test.ts` | **目标-新增**（拆分） |
| `F-store-test-candidates-lineage` | `test/candidates/lineage.test.ts` | **目标-新增**（拆分） |
| `F-store-test-candidates-core-parity` | `test/candidates/core-parity.test.ts` | **目标-新增**（拆分） |
| `F-store-test-candidates-verification` | `test/candidates/update-verification.test.ts` | **目标-新增**（拆分） |
| `F-store-test-open` | `test/open.test.ts` | **目标-新增**（80-§8.2：只读/维护/版本三态） |
| `F-store-test-transaction` | `test/transaction.test.ts` | **目标-新增**（80-§6.3 REC-04） |
| `F-store-test-records-ports` | `test/records/ports.test.ts` | **目标-新增**（80-§6.3 REC-01/02/03 装配；原 `test/record-ports.test.ts` 改名并移入 `test/records/`） |
| `F-store-test-intent-receipts` | `test/intent-receipts.test.ts` | **目标-新增**（唯一键/`receivedAt` 取最大/整表替换/`gap` 不降级/无 `upsert` 写口） |
| `F-store-test-records-writer` | `test/records/writer.test.ts` | **目标-新增**（80-§6.3 REC-01：不可存字段零行、`deduped`、CAS） |
| `F-store-test-records-reader` | `test/records/reader.test.ts` | **目标-新增**（80-§6.3 REC-02 + §8.2：两态 + 四码分列） |
| `F-store-test-records-projection` | `test/records/projection.test.ts` | **目标-新增**（80-§6.3 REC-03：增量=重建、未注册名抛错） |
| `F-store-test-records-hooks` | `test/records/hooks.test.ts` | **目标-新增**（80-§6.6 规则 7：同事务、回滚、同微任务快照） |
| `F-store-test-records-correction` | `test/records/correction.test.ts` | **目标-新增**（80-§6.3 REC-05：两个 CAS 位） |
| `F-store-test-records-credentials` | `test/records/credentials.test.ts` | **目标-新增**（AUTH-06：登记按引用摘要幂等、按 ID 解析两态、吊销幂等+预期版本、值入目录拒） |
| `F-store-test-records-persistence` | `test/records/persistence.test.ts` | **目标-新增**（80-§6.3 存储不变量：表形状/触发器/大小上限/摘要只对字节算/载荷行去重） |
| `F-store-test-records-reconstruct` | `test/records/reconstruct.test.ts` | **目标-新增**（80-§4.6：`reconstructed` + 不回填 + 旧摘要 `unknown` + `REC-LOSS-01`） |
| `F-store-test-recon` | `test/recon/reconcile.test.ts` | **目标-新增**（80-§6.3 REC-06：`intentRef` 缺拒、孤儿未知只落缺口） |
| `F-store-test-lease` | `test/lease/lease.test.ts` | **目标-新增**（80 `AUTH-04` 持久面：fence 每次换、旧 fence 拒） |
| `F-store-test-memory-entries` | `test/memory/entries.test.ts` | **目标-新增**（80 `MEM-01`：四层分离、五操作不删原文） |
| `F-store-test-memory-access` | `test/memory/access.test.ts` | **目标-新增**（80 `MEM-01`：每次读留痕、被拒读也留痕） |
| `F-store-test-resources-ledger` | `test/resources/ledger.test.ts` | **目标-新增**（80 `RES-01`：三态 limit、缺省未知、删表可重建） |
| `F-store-test-resources-hook` | `test/resources/hook.test.ts` | **目标-新增**（80 `RES-01`：三处事务各产行、重放不翻倍） |
| `F-store-test-ulid` | `test/ulid.ts` | 保留（仅测试） |

〔复算〕36 个 `.test.ts` = 保留 14（`ledger`/`perf`/`rebuild`/`drill`/`v2`/`v3`/`v4`/`v6`/`v7`/`v8-model`/`v8-todo-queue`/`v9`/`v11`/`v12`）+ `candidates/` 4 + 新建 18（`test/` 直下 `open`/`transaction`/`intent-receipts` 3 + `test/records/` 9 + `test/recon/` 1 + `test/lease/` 1 + `test/memory/` 2 + `test/resources/` 2）；加 `ulid.ts` = 37 件。`test/` 直下 18 件（14 + 3 新建 + 助手）≤25；`test/records/` 9、`test/candidates/` 4、其余各 1–2 ≤25。

### 3.4 目标-新增但不属本卷的相邻件（只列交付面，不重复契约）

下列文件是 80 定稿接口的**文件家**，分属 01/02/17 卷；本卷**不写它们的文件契约**（避免跨卷重复），只记 store 侧必须满足的前置与交付，供主 agent 归并：

| 目标路径 | 归属卷 | 与 store 的接缝（本卷只承诺这一侧） |
|---|---|---|
| `packages/contract/src/ports/intent.ts` | 01-contract（`F-contract-port-intent`） | 提供 `IntentKey`/`IntentReceipt`/`WebhookIntentPayload`/`IntentSubmitResult` 类型；store 的 `intent-receipts.ts` 只 import 类型，**不定义**同名类型，也不构造第二套回执形状 |
| `packages/contract/src/ports/secret.ts` | 01-contract（`F-contract-port-secret`） | store **不消费**该端口（库层不取秘密、不脱敏）。仅当 `outbound-redaction` 需要把秘密形状写进库时，由 daemon 在入参前用 `contract/src/secrets.ts` 的纯函数处理；store 不得 import 该端口 |
| `packages/core/src/work-readiness.ts` | 02-core（`F-core-work-readiness`） | 五门纯求值在 core；store 只提供五门输入的**读取**（`work`/`company`/`reports` 面），**不得**在 store 内复算五门或引入 `core` 边 |
| `apps/daemon/src/assembly/intent/ingress.ts` | 17-daemon（`F-daemon-intent-ingress`） | 它是 `intent_receipts` 投影的**唯一驱动者**；调用 `WorkIntake.reserve` 写 `REC-WORK-01`，再调 store 的 `IntentReceiptsFace` 落行；store 只接「行」不接「记录」 |
| `apps/daemon/src/assembly/intent/receipt-store.ts` | 17-daemon（`F-daemon-intent-receipt-store`） | 派生规则（`status` 判据、`unknown` 缺链不降级、`receivedAt` 取最大）在这里；store 不实现派生，也不判 TTL |
| `apps/daemon/src/assembly/auth/credentials.ts` | 17-daemon（`F-daemon-auth-credentials`） | 本件**只编排**：取部署侧来源声明、把 `status` 映射为 `rejected_authority`、装配端口；持久原语/幂等/CAS 全在 store 的 `records/credentials.ts`（§4.5）。**不写 SQL、不存值、不持第二份引用、不另建表**；端口签名归 `contract` |
| `apps/daemon/src/assembly/api/assemble.ts` | 17-daemon（`F-daemon-api-assemble`） | `assembleApi({ingress: Pick<IntentIngress,'submit' \| 'receipt'>, ledgerPath, company, config})`；`ledgerPath` 交给 `openLedgerReadonly`。store 交付的是该函数与只读视图类型，**不定义** `ApiServerOptions`，也不收 `engine` |

〔结论〕本卷的 F-ID 命名空间只有 `F-store-*`；上表路径不占本卷 ID，也不在本卷展开内部结构。**跨卷重复的判定以「谁拥有该文件的 types/实现」为准**，不以「谁先提到」为准。

〔已裁决·只读打开唯一路径〕`packages/store/src/ledger/open.ts`（`F-store-ledger-open`）是唯一的只读/维护打开落点，`openLedgerReadonly`/`openLedgerMaintenance`/`migrateIfOwner`/`ReadOnlyLedger`/`ReadOnlyLedgerOpen` 全在此文件导出。旧双名一律作废：`ReadLedger`（本卷旧稿自拟类型）删除，`packages/store/src/open-readonly.ts`（`81-files/17` 相邻件表的旧记法）不建。17 卷已回改并关闭 W-19，本卷不代改他卷。

### 3.5 条件待定件（不计入目标，路径与触发条件单列）

| 稳定 ID | 路径 | 触发条件 |
|---|---|---|
| `F-store-ledger-metrics` | `src/ledger/metrics.ts` 或 `src/observability.ts` | 仅当 82 产出「投影采集故障」的公共形状后再议（77 `REC-OBS-02`）；**现在不建**，避免自造端口 |

〔结论〕`migrations/` 拆分**已不在此表**：`intent_receipts` 表（v14）是 80 的既定目标，`migrations.ts` 600 行即阈、v14 无处可加 → 拆分是 M1 的必做前置（§七）。其余条件件未触发不落文件，本卷不预留空壳。

---

## 四、逐文件契约

### 4.1 包根、引擎触点与行助手（3 件）

#### F-store-index · `packages/store/src/index.ts`（271 行）

- **处置**：目标-保留；值再导出冻结、**只增不减**（80-§2.1 的「不变」指既有符号；新增面必须能从 barrel 取到，否则只读进程与 daemon 要深引私有路径）。
- **归属**：79-§6.5 包入口；80-§2.1 store 组件。非端口、非语义来源。
- **职责 / 非职责**：把包内模块的公共符号再导出一个入口，供 daemon/panel 消费（`api` 不再直连 store，见 §1.2）。不实现任何行为、不打开库、不校验、不决定读/写。**不证明**导出即可用（多个面在生产零消费者）。
- **内部结构**：两常量 `PACKAGE_NAME`（`:142`）、`PACKAGE_STATUS='partial'`（`:145`）；6 组再导出：引擎/迁移（`:148-152`）、台账立面与类型（`:155-156`）、定价（`:160-171`）、perf（`:173-184`）、usage（`:187-193`）、cost（`:196-206`）、probes（`:208`）、记录形状（`:212-263`）、重建/演习（`:266-271`）；以及约 140 行（`:1-141`）的 TODO 与「拟稿待批/疑点」注释块。目标新增 3 组再导出：只读/维护打开（`openLedgerReadonly`/`openLedgerMaintenance`/`ReadOnlyLedger`/`ReadOnlyLedgerOpen`）、记录端口（`createRecordPorts` + `AppendReceipt`/`RecordPage`/`RecordQuery` 等类型；类型从 `contract` 转出、不在 store 重定义）、回执投影（`createIntentReceiptsFace`/`IntentReceiptsFace`）。
- **导出与依赖**：只 import 包内文件；零外部依赖、零 `node:` 内建、零副作用。目标仍如此——barrel **不得**出现 `node:sqlite` 类型以外的新 import。
- **IO 与注入**：N/A（无 IO、无时钟、无 env）。
- **状态与并发**：N/A（纯再导出）。
- **错误与观测**：自身不抛错。`PACKAGE_STATUS='partial'` 是自述档，与「13 条迁移、8 个面已接生产」并列，**取值是否该升级须批示**，本卷只标目标-退役候选（非文件）。
- **测试与证据**：15 个测试全部 `import … from '../src/index.ts'`（`grep` 计 15），即入口形状被间接覆盖；无直接入口测试。**不证明**任何消费者可用。
- **规模与迁移**：271 行，预算 ≤340（新增 3 组再导出约 +20 行；下降路径：注释块外迁后 ≤160）。迁移：M0 起随拆分改 import 源，导出名一个不减；新增名只增。

#### F-store-driver · `packages/store/src/driver.ts`（36 行）

- **处置**：目标-保留；补只读参数 `opts?: { readonly?: boolean }`（80-§8.2 原文 `openSqlite(path, {readonly:true})`）。
- **归属**：79 `DEP-NODESQLITE`（唯一打开点）；78-§10 `BIND-STORE-01` 的引擎切换点。
- **职责 / 非职责**：打开（或只读打开）SQLite 文件并按模式对齐 PRAGMA。不迁移、不建表、不决定只读/读写策略（由 `ledger/open.ts` 决定并传参）、不重试、不做路径存在性判断、不分类错误。
- **内部结构**：`openSqlite(path: string): DatabaseSync`（`:29-35`）；PRAGMA 顺序固定 `journal_mode=WAL`、`synchronous=NORMAL`、`foreign_keys=ON`、`busy_timeout=5000`。目标：
  - `opts.readonly=true` ⇒ 以只读标志打开（不建库），**只设** `busy_timeout=5000` 与 `foreign_keys=ON`；**跳过** `journal_mode` 与 `synchronous`（两者都会写库头，80-§8.2 明令只读分支不得设写 PRAGMA）；`query_only=ON` 由 `open.ts` 在其后设置（打开点仍只有这一处）。
  - `opts` 缺省 ⇒ 现行为，逐字节不变。
- **导出与依赖**：只导出 `openSqlite`；仅 `node:sqlite`。
- **IO 与注入**：文件系统 + SQLite；无网络、无时钟、无随机、无 env。路径由调用方给，本文件不解析、不做 containment（containment 归调用方与 80-§11.3）。
- **状态与并发**：每次调用产生独立连接；WAL 允许多读单写。`synchronous=NORMAL` 断电可丢最后若干事务（78 `L78-STORE-03`，**如实登记，不声称不丢**）。`busy_timeout=5000` 是唯一冲突等待机制——超时后的分类在 `open.ts`/`migrate`/各写面决定，本文件不做。
- **错误与观测**：失败直接抛 `node:sqlite` 原生错误（未分类）；目标**也不在此分类**，由 `ledger/open.ts` 统一映射：只读打开不存在的文件 ⇒ `Err({failure:'unavailable', category:'STALL', subcause:'db-missing'})`（80-§8.2 第 1 条，**不是 `CONFIG_INVALID`**）；权限/只读文件系统 ⇒ `unavailable` + `db-readonly-fs`。本文件不得自造 subcause。
- **测试与证据**：`test/ledger.test.ts:114-117` 断言 `journal_mode`/`foreign_keys`；其余测试以真文件库间接覆盖。只读路径目标由 `test/open.test.ts` 覆盖（真文件 + 只读打开 + `PRAGMA query_only`）。**未证**：WAL 在 NFS/容器卷上的行为；`readonly:true` 是否创建隐式 `-shm`（U1）。
- **规模与迁移**：36 行 → 预算 ≤70。

#### F-store-row-helpers · `packages/store/src/row-helpers.ts`（40 行）

- **处置**：目标-保留（不动）。
- **归属**：79-§6.3「`unknown` + 收窄」范式；80-§5.7 错误分类的本地投影。
- **职责 / 非职责**：把 `node:sqlite` 返回的 `Record<string, unknown>` 收窄成业务字段，并把 zod 形状闸失败转成构造期错误。不定义 schema、不做业务校验、不做默认值业务推断。
- **内部结构**：`type SqlRow`；`str/optStr/optNum`（null/undefined → `undefined`，不抛）；`interface RecordParser<T>`（结构化 `safeParse`，**免 import zod 类型**）；`assertRecord<T>(schema, input, prefix)` → 失败取**首个** issue 的 path 拼 `<prefix>:<path>`，`configInvalid` 抛出（`:32-39`）。
- **导出与依赖**：上述 4 个值 + 2 个类型；仅 `@studio-next/contract` 的 `configInvalid`。
- **IO 与注入**：N/A（纯函数）。
- **状态与并发**：无状态。
- **错误与观测**：一律 `failure:'rejected_precondition'` + `category:'CONFIG_INVALID'`（由 `configInvalid` 固定），`subcause` 前缀由调用方给（`store/people:invalid` 等）；`path` 为空时回落 `(root)`。**不得**在这里选 business failure（如 `rejected_idempotency`）——那要由写面在闸后自行判定（§1.4）。**秘密边界**：错误消息含字段路径与 zod 首条消息，不含整行内容（已核）。
- **测试与证据**：无直接测试；经所有写面的 `store/*:invalid` 断言间接覆盖（`v2`/`v3`/`v6`/`v9`/`v11`/`v12`）。**不证明**多 issue 时的完整诊断（只回首个是设计选择）。
- **规模与迁移**：40 行，预算 ≤60。

### 4.2 记录形状（9 件）

这一族的共同约束（`records/*`、`todo-queue-records.ts`）：
- **零 IO、零时钟、零引擎**；只 import `zod` 与 `@studio-next/contract` 的类型；
- 全部 `z.strictObject`（未知键即拒收，76-§1.4 的本地投影）；
- 值域常量用 `as const` 元组 + 派生类型，**不 import `core`**（`index.ts:76-79` 已登记「值域复制而非 import」的纪律，漂移由测试钉死）；
- schema 是**库边界闸**，不是公司规范；contract 收口后替换（`index.ts:210-211` 自述「store 层临时闸」）；
- **金额字段（`cost_usd`/`amount_usd`/`planned_usd`/`spent_usd` 一类）目标形态是 `DecimalString` 文本列 + 显式币种列**，不是 `REAL`。80-§4.2 已定「公共金额用 `DecimalString` + 币种；`Money.usd:number` 只作内存值与旧记录」，80 `TS-SCALAR-09` 禁浮点金额。现状库内全部金额列仍是 `REAL`（§2.1 缺口清单已列行号），是**待迁移项**，不由本族自行改表：本族只负责目标 schema 的**形态闸**（十进制字符串形态 + 币种必填），旧行 `REAL` 的读路径转换由读面在库边界一次完成、**不经 float 舍入再回写**。迁移动作归 `REC-MIG-01`（§10.2 D4）。
- **日期字段（`usage_daily.usage_date`、`cost_daily.date` 等）只校验「真日历日」形态**：本族**不折日、不取宿主时区、不换算公司本地日**。UTC 日键与公司本地日是两个概念，折日归调用方（80-§4.1；`localDateKey` 宿主时区版只作旧记录过渡）。schema 拒绝 `2026-02-30` 这类假日期，但**不判断**该日属于哪个时区的哪一天。

#### F-store-records · `packages/store/src/records.ts`（606 行，基线 606）

- **处置**：目标-拆分（facade 保留，只做再导出）。基线条目可随拆完除名。
- **归属**：80-§10.6「与 `ledger.ts` 同批拆」；77 的记录形状在库侧的落位。
- **职责 / 非职责**：为 13 张表提供 TS 记录类型与写入形状闸。不定义表的权威语义（归 17-§3 与 contract）、不定义状态机、不生成 id、不取时间（`created_at`/`ts` 由调用方给）。
- **内部结构**（逐段 → 目标文件）：

| 现有行段 | 内容 | 目标文件 |
|---|---|---|
| `:34-71`、`:179-207`、`:208-231`、`:232-244`、`:346-366` | `WorkRecord`/`SessionRecord`/`EndWorkRecord` + 三 schema | `records/work.ts` |
| `:72-89`、`:105-133`、`:245-260`、`:273-299` | `PersonRecord`/`DepartmentRecord`/`TicketMirrorRecord` + 三 schema | `records/company.ts` |
| `:90-104`、`:527-604`、`:261-272`、`:542-554`、`:587-604` | `PersonnelEventRecord` + `HrSyncPayload`/`HrSyncTaskRecord` + `HR_SYNC_*` 值域 | `records/hr.ts` |
| `:134-148`、`:300-322` | `BudgetRecord` + schema | `records/budget.ts` |
| `:149-178`、`:323-345` | `JobRecord` + schema | `records/jobs.ts` |
| `:367-430` | 候选四值域 + `CandidateRow` + schema | `records/candidates.ts` |
| `:431-526` | `LedgerKind`/`ReportType` + `LedgerEntryRecord`/`ReportRecord`/`ProbeRunRecord` + 三 schema | `records/reports.ts` |
| `:605-606` | `TodoQueueRecord` 转发 | 留在 facade（指向 `todo-queue-records.ts`） |

- **导出与依赖**：导出 24 个 schema/值域 + 24 个类型（`index.ts:212-263` 全列）；仅 `zod` + `@studio-next/contract` 类型（`UlidSchema` 在 `cost`/`usage`/`pricing` 侧另用）。
- **IO 与注入**：N/A。
- **状态与并发**：N/A（schema 不可变；`z.strictObject` 实例可复用）。
- **错误与观测**：自身不抛错——`safeParse` 由 `assertRecord` 转成 `rejected_precondition` + `CONFIG_INVALID`（§1.4 第 10 行），`subcause` 形如 `store/<table>:invalid`。schema **不判** `idempotency`/`state`/`version` 一类业务失败——那是写面的闸后判定（`rejected_idempotency`/`rejected_state`/`rejected_version` 一律不出自本族；80-§5.7 的 `failure` 决定处置，`category` 只供观测）。`record` 冲突（如 `ReportRecord.type` 不在四值域）在 schema 层即按 invalid 拒，不另立 category。
- **测试与证据**：无 `test/records.test.ts`；形状经各 `v*` 测试的「坏形状拒」用例覆盖（`v3` cron 段数、`v6` kind/type、`v9` slot/track、`v11` 日历日、`v12` 负值），值域一致性由 `v5`/`v9` 的 core↔store deep-equal 覆盖（W）。**缺口**：无一处测试逐一断言 24 个 schema 的必填/可选字段全集。
- **规模与迁移**：606 行拆为 7 件，预算各 ≤160（合计 ≤700，允许净增 ≤94 行来自各文件头注）。M0 执行；`index.ts` 导出面不变。

#### F-store-records-work · `packages/store/src/records/work.ts`（目标新增，预算 ≤160）

- **处置**：目标-新增（拆分产物，无新语义）。
- **归属**：17-§3 `work_records`/`sessions` 列集；F2-04 工时口径；80-§8.3 finalize 段（`endWorkRecord`）。
- **职责**：`WorkRecord`（含 v8 `model`、v13 `executor_session_id`）、`SessionRecord`、`EndWorkRecord` 三类型与 `WorkRecordSchema`/`SessionRecordSchema`/`EndWorkRecordSchema`。**非职责**：不校验 `status` 终态值域（`index.ts:102` 头注：归收割域）、不校验 tokens 四桶来源。
- **内部**：`WorkRecordSchema` 必填 `id/issue/company/person_id/started_at/status`，可选 `ended_at/cost_usd/tokens/report_ref/summary_ref/model/executor_session_id`（据 `records.ts:208-231` 现状）；`EndWorkRecord` 必填 `ended_at/status`，其余 `COALESCE` 语义可选。
- **导出/依赖**：三 schema + 三类型；`zod`、`@studio-next/contract` 类型。
- **IO/并发/错误**：同族约束；`tokens` 序列化为 `JSON.stringify` 原序（**非** events 的四桶 canonical 序，`index.ts:98-100` 已登记）。
- **测试**：`test/ledger.test.ts`（work/sessions 往返）、`test/v4-debts.test.ts`（`endWorkRecord` 一次性/COALESCE/坏形状）、`test/v8-model.test.ts`（model 列）。
- **规模**：约 150 行（源自 `records.ts:34-71/179-244/346-366`）。

#### F-store-records-company · `packages/store/src/records/company.ts`（目标新增，预算 ≤140）

- **处置**：目标-新增（拆分产物）。
- **归属**：17-§3 `people`/`departments`/`ticket_mirror` 列集；04-§二 目录镜像。
- **职责**：`PersonRecord`/`DepartmentRecord`/`TicketMirrorRecord` 与三 schema。**非职责**：不承载 `role/skills/side_effects/capability_tier/executor_pref/status` 的写面（`index.ts:121-125` 明列「people 扩展列 v0 无写面」，`setPersonStatus` 是唯一例外）。
- **内部**：`PersonRecord` 只有 `person_id/name/login/level/dept`；`DepartmentRecord` 含 `path/company/leader/functions/lanes/parent_path?`；`TicketMirrorRecord` 含 `issue/company/created/updated/state/type/dept/level/dispatcher/parent?/lane?/assignee?`。
- **测试**：`test/v2-tables.test.ts`（`syncCompany` 往返、ticket_mirror）、`test/v8-todo-queue.test.ts`（`assignee` 可空往返）。
- **规模**：约 130 行（源自 `:72-89/105-133/245-260/273-299`）。

#### F-store-records-hr · `packages/store/src/records/hr.ts`（目标新增，预算 ≤120）

- **处置**：目标-新增（拆分产物）。
- **归属**：52-§9.2/§11 人事同步；17-§3 `personnel_events`。
- **职责**：`PersonnelEventRecord` + `HrSyncPayload`/`HrSyncTaskRecord` + `HR_SYNC_PLATFORM_VALUES`/`HR_SYNC_STATUS_VALUES` 与三 schema。**非职责**：不定义流转合法性（归 `hr-sync-queue.ts`）、不锁人事变动 type 值域（`index.ts:130-131` 明列 v0 不锁）。
- **测试**：`test/v7-hr-sync.test.ts`、`test/v2-tables.test.ts`（人事事件 id 幂等挂账）。
- **规模**：约 110 行（源自 `:90-104/527-604`）。

#### F-store-records-budget · `packages/store/src/records/budget.ts`（目标新增，预算 ≤50）

- **处置**：目标-新增（拆分产物）。
- **归属**：F1-09 预算三节点；17-§3 `budgets`。
- **职责**：`BudgetRecord` + schema。**非职责**：不计算余额、不判超限（归 `core/budget.ts`）。
- **测试**：`test/v2-tables.test.ts`（scope 查询、`kinds` 子集、形状闸）。
- **规模**：约 38 行。

#### F-store-records-jobs · `packages/store/src/records/jobs.ts`（目标新增，预算 ≤60）

- **处置**：目标-新增（拆分产物）。
- **归属**：18-§三 调度；17-§2 调度表列集。
- **职责**：`JobRecord` + schema（`cron` 只做形状闸：非空、≤6 段；`model_tier` 锁三值）。**非职责**：不解析 cron（`index.ts:46` TODO 明列归 daemon/core）。
- **测试**：`test/v3-jobs.test.ts`（cron 5/6 段、tier 枚举、payload 往返）。
- **规模**：约 53 行。

#### F-store-records-candidates · `packages/store/src/records/candidates.ts`（目标新增，预算 ≤80）

- **处置**：目标-新增（拆分产物）。
- **归属**：02-F3-01/02/03；core `evolution.ts` 形状之源（值域**复制**，漂移由测试钉）。
- **职责**：`CANDIDATE_ASSET_KINDS`/`CANDIDATE_BLAST_RADII`/`CANDIDATE_STATUS_VALUES`/`TERMINAL_CANDIDATE_STATUS_VALUES` + `CandidateRow` + schema。**非职责**：不判状态机边（`index.ts:82-84`：库层复制判定面=第二状态机漂移面）。
- **测试**：`test/candidates/core-parity.test.ts`（deep-equal 一致性）。
- **规模**：约 64 行。

#### F-store-records-reports · `packages/store/src/records/reports.ts`（目标新增，预算 ≤120）

- **处置**：目标-新增（拆分产物）。
- **归属**：17-§3 `ledgers`/`reports`/`probes_runs`；04-§三 报表快照。
- **职责**：`LEDGER_KIND_VALUES`/`REPORT_TYPE_VALUES` + `LedgerEntryRecord`/`ReportRecord`/`ProbeRunRecord` + 三 schema。**非职责**：不锁 `caliber` 值域（`index.ts:58-60`：由聚合管线自定）。
- **测试**：`test/v6-reports.test.ts`（kind/type 值域、自然键）、`test/perf.test.ts`（`perf-weekly` 往返）。
- **规模**：约 96 行。

#### F-store-todo-queue-records · `packages/store/src/todo-queue-records.ts`（49 行）

- **处置**：目标-保留（不动）。
- **归属**：129-§6.2-R2；17-§3 `todo_queue`。
- **职责**：`TodoQueueRecord` + `TodoQueueRecordSchema`。**非职责**：不做排序/重投（归 `replaceTodoQueue`）。
- **内部**：必填 `company/ticket/person/priority/pinned/boost_tier/first_seen_at/ready_state/updated_at`，可选 `last_boost_at/why`。
- **依赖/IO**：`zod`；零 IO。
- **测试**：`test/v8-todo-queue.test.ts`。
- **规模**：49 行，预算 ≤80。**这是本包「面内自持形状闸」的先例**，`pricing`/`usage`/`cost` 沿用它。
- **现状注记（命名漂移）**：本文件头与 `test/v8-todo-queue.test.ts` 都写「v8」，但 `migrations.ts` 里 `todo_queue` 的实际版本是 **9**（v8 已被 `work_records.model` 占用，见 `:404-423` 与 `:424-460` 的注释「与 132-A 撞号顺延」）。这是注释/文件名漂移，**不是**迁移错误；本卷按迁移实际版本（v9）叙述，不改代码与测试名。

### 4.3 迁移（15 件：facade 1 + 目录内 14）

#### F-store-migrations · `packages/store/src/migrations.ts`（600 行，顶格）

- **处置**：**目标-拆分（必做，不再是条件项）**。600 行是阈值也是事实上的顶格；而 v14 要加一张新表 + 一列、v15 再加三张表，必然超阈，故拆分从「下一条 DDL 触发」升为「本轮必做」（§3.1 `F-store-migrations-index` + 十三个族文件；旧稿的「下一条 DDL 才拆」条件项已撤销，不再是条件触发）。facade `migrations.ts` 保留 `Migration` 类型、`migrate`、`currentVersion`、`LATEST_VERSION` 的再导出。
- **归属**：76 `REC-MIG-01`（迁移记录）；80-§8.2 D12-1/4（独占迁移、失败整体回滚、离线窗口 + 单实例锁由 `openLedgerMaintenance` 承担）。
- **职责 / 非职责**：内置 schema 的版本表与顺序 runner——`migrate(db, {upTo})` 幂等应用、**完整摘要**防漂移、`currentVersion` 读当前版本。不决定**谁有权**迁移（80-§8.2 只给「离线窗口 + 单实例锁」的口径，锁的具体机制未定义，见 §十 U2）、不写业务数据、不做数据回填（`F2-13` 回填工具是独立未实现项）。**v15 起产 `REC-MIG-01`**：每个版本在自己的**独占事务**里，先写一条迁移记录（`plan`/`fromVersion`/`toVersion`/`beforeDigest`/`afterDigest`/`scope`/`approvalRef`/`result`），再跑该版本 DDL，最后提交；记录写不出 ⇒ 该版本回滚，**不得**「DDL 落了、记录没有」。`REC-MIG-01` 是 76-§8.3 的公共记录，落 `records`（同一事务内经 `records/persistence.ts`），**不是** `schema_version` 的替代：后者只是实现日志（80-§6.6 过渡段原文），可被读成「哪个版本跑过」，不可被读成「迁移已被记录」（D7 关闭）。
- **内部结构（拆分后）**：现行 `MIGRATIONS` 是 **13 条版本条目**（v1–v11、v12=来自 `cost.ts` 的 `costDailyMigration`、v13），其中多条**一个版本跨多张表**（v1 = events + work_records + sessions；v2 = people + personnel_events + departments + ticket_mirror + budgets；v9 = todo_queue + `ticket_mirror.assignee`）。因此拆分单位是**版本内的 SQL 段**，不是「一条版本一个文件」：
  - 族文件导出 `readonly string[]`（该段的 SQL 行，末行 `''` 保留），**不带 `version`/`name`**；
  - `migrations/index.ts` 按版本把各段 `join('\n')` 拼回**同一条**版本条目，`version`/`name` 保持原值（`MIGRATIONS` 仍是 13 条 + v14 + v15 = **15 条**，条数不因拆分而变）；
  - `LATEST_VERSION` 取末条 `version`（现行=13，v14 后=14，v15 后=15）。
  **逐字节约束（可测）**：①每个**版本**拼装后的 `sql` 与拆分前**同版本**的 `sql` `sha256` 相等（13 条版本 = 13 个对照值，存为测试夹具；v14/v15 各再加一条）；②`MIGRATIONS` 拼装整体与拆分前整体 `sha256` 相等（§十 U10/U11）。「逐条」指**逐版本**，不是逐文件——v1 拆进两个文件后单文件无独立可比值。v12 条目体原本来自 `cost.ts` 的 `costDailyMigration`（值 import）——拆分后仍从 `cost.ts` 引入，只是引用点从 `migrations.ts` 挪到 `migrations/cost.ts`。
- **schema_version 表的目标形态**：`(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, digest TEXT)`，另保留 `sha8` 列作**展示用**（`TS-SCALAR-08`：短哈希只作展示，**不得**作身份/去重/比对依据）。`digest` 在**列上不加强制 `NOT NULL`**——SQLite 给已有人表的行加 `NOT NULL` 列必须带 `DEFAULT`，而「非空」应由 `migrate` 的写入路径保证（新行必写 `digest`），不靠列约束。漂移判定改用 `digest` 列，值为内部编码 `sha256:<64 hex>`（**内部字符串，不是公共 `Digest` 类型**，不对外导出、不进契约）。旧库的 `digest` 列由 v14 补齐；**v14 之前的行写 `digest='unknown'`**（76-§1.8 的「未知」，不是可序列化摘要、不作身份、不进 `VersionRef`），**不回填占位摘要、也不拿 `sha8` 扩写成假摘要**；这些行在漂移校验时**跳过**并落一条 `REC-LOSS-01`（`dimension:'interoperability'`，写明「该版本的迁移脚本原文不在库内，无法证明未漂移」）。这是 D3 的处置（**D3 关闭**）；U14 从「待裁定」降为「已按 `unknown` 处理」，残余只是「跳过是否够用」的验收偏好。
- **v14 的内容**：①`ALTER TABLE schema_version ADD COLUMN digest TEXT`（加列后按 `LATEST_VERSION` 之前的条目对其已应用行做「不可回填」标记）；②`CREATE TABLE intent_receipts`——列：`company`/`source`/`kind`/`key_slot`/`ticket`/`dedup_key`/`receipt_id`/`intent_ref`/`body_digest_algorithm`/`body_digest_value`/`received_at`/`status`/`outcome`/`referred_position_ref`/`referred_deadline`/`referred_notified_at`/`decided_at`/`intake_record_ref`/`unknown_ref`/`gap`（JSON 文本）/`updated_at`，**唯一键 `(company, source, kind, key_slot)`**。`key_slot` 是 `ticket ?? dedupKey` 的落库位（80-§6.6 第四位），用独立列承载以免 SQLite 唯一索引里做 `COALESCE` 表达式（表达式索引的排序/比较语义未在本库验证，见 §十 U6）。该表是**可重建投影**（§1.3 第三类），重建入口在 `rebuild`，不进事实面。
- **v15 的内容（记录面三表）**：由 `migrations/records.ts` 提供，`index.ts` 拼入并排在 v14 之后。①`records`：`recordId` 主键、`company`、`typeName`+`typeVersion`、`authorityDomain`、`subjectKind`+`subjectId`、三时间（`observedTime`/`recordedTime`/`effectiveFrom`）、`idempotencyKey`（可空）、`lineageHead`（可空）、`envelopeBytes`（BLOB）、`envelopeDigest`、`storedAt`；②`record_payloads`：`contentDigest` 主键、`mediaType`、`byteLength`、`bytes`（BLOB 原始字节）、`storageHint`（可空）、`knowledgeScope`（可空）；③`record_transactions`：`txId` 主键、`company`/`authorityDomain`/`partition`、`writerId`、`fence`（可空）、`openedAt`、`status`、`commitSeq`（唯一、可空）、`proofRef`（可空）、`recordIds`。**逐项约束（字段语义、大小上限、触发器、索引）见 §4.5 `F-store-records-persistence`**，本条目只记「哪一版建它」与回退代价。v15 一旦在某个库上跑过，代码回退只会让只读面 `schema-ahead` 拒起，库须 `dump` → 重建；与 v14 同属**不可逆**版本。
- **导出与依赖**：facade 导出 `LATEST_VERSION`、`migrate`、`currentVersion`、`Migration`（类型）；`migrations/index.ts` 另导出 `MIGRATIONS`（供测试逐条比对，但**不进 `src/index.ts` 公共面**）。依赖：`node:sqlite`（类型）、`node:crypto`、`@studio-next/contract`、`./cost.ts`（v12 条目）、`../driver.ts`（仅类型）、`../records/persistence.ts`（仅 `REC-MIG-01` 的写入原语，**不**反向依赖：`persistence` 不得 import `migrations/`）。
- **IO 与注入**：SQLite + 系统时钟（`Date.now()`，80-§7 已登记为库层允许墙钟的例外）；无 env、无随机。**迁移只在写面打开时发生**（`openLedger` 内），只读面 `openLedgerReadonly` **绝不**触发迁移（80-§8.2：版本落后即 `rejected_version`）。
- **状态与并发**：每版本一个 `BEGIN IMMEDIATE`（目标：现为 `BEGIN`，升级点会撞 `SQLITE_BUSY`；`busy_timeout=5000` 是唯一缓冲）。busy ⇒ `unavailable` + `STALL` + `store/migration:db-busy`（§1.4：可用性类失败归 `STALL`，不归 `CONFIG_INVALID`——重试可能成功，配置不会自己变好）。**未证**：80 `U80-16`（多进程并发迁移的后果）、§十 U3（`BEGIN IMMEDIATE` 下 busy 的分布）。迁移的**互斥**由调用方保证（`openLedgerMaintenance` 持离线窗口与单实例锁）；本文件不自称已实现跨进程单写。
- **错误与观测**（按 §1.4 逐条落定）：

| 场景 | failure | category | subcause |
|---|---|---|---|
| `upTo` 越界（> `LATEST_VERSION`） | `rejected_precondition` | `CONFIG_INVALID` | `store/migration:bad-up-to` |
| 已应用版本摘要不符 | `rejected_version` | `EVOLVE_REJECT` | `store/migration:schema-digest-mismatch` |
| `SQLITE_BUSY` / 锁等待超时 | `unavailable` | `STALL` | `store/migration:db-busy` |
| DDL 执行失败（语法/约束/磁盘） | `rejected_precondition` | `CONFIG_INVALID` | `store/migration:ddl` |
| 库版本高于代码 `LATEST_VERSION` | `rejected_version` | `EVOLVE_REJECT` | `store/migration:schema-ahead` |

  `ddl` 当前**未包装**（原生 `node:sqlite` 错误透传），目标是包成 `ClassifiedError` 并在 `detail` 保留原 `code`/`errstr`。子类区分「语法错」与「磁盘满」不上报为不同 category——两者处置相同（停在原版本、可续跑），差异只进 `detail` 观测。失败不留半迁移库（单版本事务）；但**跨版本不留整体快照**——v3 成功、v4 失败后库停在 v3，这是设计（可续跑），不是 bug。**`REC-MIG-01` 与 DDL 同事务**：记录先写、DDL 后跑、一起提交；记录写不出（`proof-unwritable` 一类）⇒ 该版本整体回滚，`schema_version` 也不得前进——**不允许**「版本号进了、迁移记录没有」（D7 关闭）。
- **测试与证据**：`test/ledger.test.ts`（首建、`schema_version` 行数、重开幂等、PRAGMA）、各 `v*` 测试的「vN-1→vN 升级路径」、`test/v8-model.test.ts`（`upTo` 构造历史库）、`test/v12-cost.test.ts`（`migrate` 返回值）。**无测试**覆盖摘要漂移、`bad-up-to`、`schema-ahead`、`db-busy`。**不证明**并发迁移安全。拆分后需在 `test/ledger.test.ts` 补四条断言：「逐条 `sha256` 相等」「拼接字节相等」（不新开测试文件——拆分等价性是迁移机制的内证）、「每个版本恰一条 `REC-MIG-01` 且 `from/to` 带摘要」「记录写失败 ⇒ `schema_version` 不前进」。
- **规模与迁移**：600 行 → `migrations/index.ts` ≤110 + 十三个族文件（十一族各 ≤130、`company` ≤150、`cost` ≤40、`records` ≤150；逐件预算见 §5.1b，合计上限 1750；拆分后净增只来自文件头注，单件均远低于 600）。M1 执行（§七），且**必须先于 v14/v15**：不拆就加 DDL 必然超阈。

#### 迁移族十四个文件（`F-store-migrations-index` + 十三个版本族）

**`migrations/index.ts` 的单独契约**（本族唯一有行为的文件）：
- **职责**：`Migration` 类型；把各版本段拼成 `MIGRATIONS`（15 条 = 现有 13 条 + v14 + v15；条数不因拆分而变）；`LATEST_VERSION`；摘要计算（`sha8` 展示 + `digest` 比较）；`migrate(db,{upTo})`；`currentVersion(db)`；**每个版本在自己的独占事务里先写 `REC-MIG-01` 再跑 DDL**（字段见 §4.5 `persistence` 与 §10.2 D7 的处置）。**非职责**：不打开库、不决定谁有权迁移、不写业务表。
- **输入输出**：输入=`DatabaseSync` 句柄（已打开）；输出=已应用版本号 / 版本表读值。`migrate` 幂等：已应用且摘要相符的版本跳过；不相符即 `schema-digest-mismatch`。
- **导出/依赖**：`MIGRATIONS`（15 条，按版本升序）、`LATEST_VERSION`、`migrate`、`currentVersion`、`Migration`（类型）；`node:crypto`、`@studio-next/contract`（`configInvalid`）、`../records/persistence.ts`（写 `REC-MIG-01` 的信封原语）、十三个族文件（值）。
- **IO/状态/并发/恢复**：见本条上方 facade 条目的「IO」「状态与并发」「错误」三节——同一套语义，只是实现落在此文件。
- **测试/规模**：`test/ledger.test.ts` 覆盖（含「每版本恰一条 `REC-MIG-01`」）；≤110 行（比原 90 多 20 行：15 条版本的拼装 + 段序声明）。

**十三个版本族文件的统一契约**（逐文件只差内容与预算）：
- **职责**：各导出 `readonly string[]`——该族在各版本里占的 **SQL 段**（行数组，末行空串保留）。段是拆分前某条版本 `sql` 的**连续切片**，不改字、不重排、不补注释。**非职责**：不定义 `version`/`name`（在 `index.ts`）、不执行、不读库、不判断版本、不引 `node:*`。
- **内部/输入输出**：输入=无（模块常量）；输出=`readonly string[]`（可能多段，如 `company.ts` 持 v2/v9/v4 三段）。**同一版本的段可由多个文件提供**（v1 = `events` + `work`；v2 = `company` + `hr` + `budget`），拼装归属 `index.ts`。**`records.ts` 是唯一新增段**（v15），其余十二个家族文件保持逐字节等价。
- **导出与允许依赖**：只导出段常量；允许依赖 `../cost.ts`（仅 `migrations/cost.ts` 取 `costDailyMigration`）。**不得** import `index.ts`（否则 `index ↔ family` 值环）；`Migration` 类型只在 `index.ts` 内声明。
- **IO 与注入**：N/A（纯常量；零 IO、零时钟、零随机）。
- **状态/幂等/并发/恢复**：N/A（不可变常量；迁移的执行语义全在 `index.ts`）。
- **错误与观测**：N/A（不抛错；任何 `sql` 语法错误只在执行期由 `index.ts` 归 `store/migration:ddl`）。
- **测试与 R/E/W/V**：不单测每个文件；由 `test/ledger.test.ts` 的「每版本拼装 `sha256` 相等」「整体拼接字节相等」两条断言统一覆盖（V 类：证明拆分未改字节）。**不证明** SQL 语义正确（那是各 `v*` 建库测试的事）。
- **规模与迁移**：各 ≤130 行（`cost.ts` ≤40 只做再导出；`records.ts` ≤150，v15 三表 + 触发器 + 索引）；M1 一次性搬移前十二族，`records.ts` 随 M3 新增。

| 文件 | 内容（版本:表族） | 预算 |
|---|---|---|
| `migrations/index.ts` | `Migration` 类型、15 条版本条目拼装、`LATEST_VERSION`、`sha8`/`digest`、`migrate`、`currentVersion`、每版本 `REC-MIG-01` | ≤110 |
| `migrations/events.ts` | v1 的 `events` 段（建表 + 两索引） | ≤130 |
| `migrations/work.ts` | v1 的 `work_records`/`sessions` 段、v8 `model` 列、v13 `executor_session_id` 列 | ≤130 |
| `migrations/company.ts` | v2 `people`/`departments`/`ticket_mirror` 段、v9 `todo_queue` + `ticket_mirror.assignee`、v4 `daemon_kv` | ≤150 |
| `migrations/budget.ts` | v2 `budgets` 段 | ≤130 |
| `migrations/hr.ts` | v2 `personnel_events` 段、v7 `hr_sync_log` | ≤130 |
| `migrations/jobs.ts` | v3 `jobs` | ≤130 |
| `migrations/candidates.ts` | v5 `candidates` | ≤130 |
| `migrations/reports.ts` | v6 `ledgers`/`reports`/`probes_runs` | ≤130 |
| `migrations/pricing.ts` | v10 `price_snapshots` + append-only 触发器 | ≤130 |
| `migrations/usage.ts` | v11 `usage_daily` | ≤130 |
| `migrations/cost.ts` | v12：`import { costDailyMigration } from '../cost.ts'` 后原样拼入 | ≤40 |
| `migrations/intent.ts` | v14 `intent_receipts` + `schema_version.digest` | ≤130 |
| `migrations/records.ts` | v15 `records`/`record_payloads`/`record_transactions` + 三个 append-only 触发器 + 索引 + 大小上限（字段语义见 §4.5 `persistence`） | ≤150 |

### 4.3b 迁移的产物与损失（v15 起）

〔结论〕一次 schema 迁移在库里留下**两种东西**，不得互相冒充：

| 产物 | 落点 | 内容 | 可否当记录 |
|---|---|---|---|
| `REC-MIG-01`（迁移记录） | `records`（同事务写入） | `plan`（本版要做什么）、`fromVersion`/`toVersion`、`beforeDigest`/`afterDigest`（版本条目的完整摘要）、`scope`（库路径逻辑标识 + 受影响的表族）、`approvalRef`、`result`（`applied`/`failed`）；`provenance.derivation='observed'`、`observedTime = recordedTime = 本版实际执行时刻` | **是**，这是 76-§8.3 的事实 |
| `schema_version` 行（实现日志） | `schema_version` | `(version, applied_at, digest, sha8)` | **否**：只说明「这版跑过」，不说明「迁移被批准/被记录」；不得被读成 `REC-MIG-01` |
| `REC-LOSS-01`（损失报告） | `records` | `dimension:'interoperability'`、`cannotClaim`、受影响对象清单 | 是（损失事实） |

〔结论〕**v15 之前的迁移没有 `REC-MIG-01`**：那时 `schema_version` 只有实现日志。`records` 可用后按 80-§6.6 过渡段**重建**这些历史波次：`provenance.derivation='reconstructed'`、`observedTime`/`recordedTime` **都取重建时刻**、`limitations` 写明「原始迁移时刻、批准材料、脚本原文均未记录」；`beforeDigest`/`afterDigest` 不可复算 ⇒ 标 `unknown` + 一条 `REC-LOSS-01`。**不得**把时间回填成当年那一刻，也不得用 `sha8` 扩写成假摘要——那是伪装当时证据。

### 4.4 Ledger 立面与表族（12 件）

这一族的共同约定：

- **立面** `src/ledger.ts` 只保留 `Ledger` 接口组装、`openLedger` 转调、`db`/`close`/`version`；表族模块各自导出 `XxxFace` 接口 + `createXxxFace(db)` 工厂，由立面 `...createXxxFace(db)` 摊入（**与现有 `probes`/`hr-sync-queue`/`pricing`/`usage`/`cost` 完全同构**，不是新范式）；
- 每个工厂只吃**已迁移**的 `DatabaseSync`；不打开库、不迁移、不取系统时钟（`pricing` 的 `now` 由立面注入）；
- 表族之间不互相 import；共享的 `AppendResult`、canonical 序列化、错误消息文本化下沉 `ledger/shared.ts`；
- 所有写口先 `assertRecord`，再查幂等，再写；错误**不一律**是 `CONFIG_INVALID`——形状/次序/前置条件类走 `rejected_precondition` + `CONFIG_INVALID`，同 id 不同内容走 `rejected_idempotency` + `EXTERNAL_REJECT`，状态已终态走 `rejected_state` + `EXTERNAL_REJECT`，`from`/版本不符走 `rejected_version` + `EVOLVE_REJECT`（唯一映射见 §1.4，本族各条只列 subcause）。**注意**：contract 目前只有 `configInvalid(...)` 一个公共构造器，其余 13 个 failure 值要等 `classified(input: ClassifyInput)`（对象入参，`category` 可省）补齐（§10.2 D2）；在那之前这些分类只能由 store 内部构造同形对象，属临时手段，不得写成已收口。

#### F-store-ledger · `packages/store/src/ledger.ts`（1683 行，基线 1684）

- **处置**：目标-拆分（facade 保留，**只做再导出**）。基线条目在拆完且 ≤600 后除名。
- **归属**：80-§10.6「按表族拆：events / work / company / budget / hr / jobs / candidates / reports」；80-§6.3 `RecordWriter/Reader/Projection` 的**现状包装对象**；80-§2.1「补 `RecordTransaction`」。
- **职责 / 非职责**：拆分后 `ledger.ts` 只剩**路径稳定层**——把 `./ledger/open.ts` 的 `openLedger`/`openLedgerReadonly`/`openLedgerMaintenance`/`migrateIfOwner`/`Ledger` 类型与 8 个既有公共类型（`EventQuery`/`AppendResult`/`InsertCandidateResult`/`DumpResult`/`CompanySyncResult`/`BudgetScope`/`BudgetListQuery`/`PersonnelTimelineEntry`）原样再导出，供 `index.ts`/`rebuild.ts`/`drill.ts` 与 15 个测试文件继续按原路径取。**非职责**：不再自己组装面（组装归 `open.ts`）、不做授权、不做跨源事务、不做业务判定、不做重试。**不证明**唯一写入者（78 `L78-STORE-01`）。
- **内部结构（现状，供拆分定位）**：八个公共类型（`:155-226`）；`Ledger extends HrSyncQueueFace, PricingFace, UsageFace, ProbesFace, CostDailyFace`（`:227-357`，约 60 个方法）；私有 helper（`:363-511`）；`openLedger`（`:513-1657`）内含全部方法闭包，末尾 `return { db, close, version, …30 方法, ...createProbesFace(db), ...createHrSyncQueue(db), ...createPricingFace(db, () => Date.now()), ...createUsageFace(db), ...createCostDailyFace(db) }`（`:1584-1656`）；`sameEvent`（`:1660-1681`）；末行转出 `ClassifiedError` 类型（`:1683`）。目标组装表为 **15 个面工厂**——`ledger/` 内十面（`events`/`work`/`company`/`budget`/`hr`/`jobs`/`kv`/`candidates`/`reports`/`intentReceipts`）+ 既有独立五面（`probes`/`hrSyncQueue`/`pricing`（注入 `() => Date.now()`）/`usage`/`costDaily`），`open.ts` 逐个 `...createXxxFace(db)` 摊平。
- **导出与依赖**：`openLedger`、`openLedgerReadonly`、`openLedgerMaintenance`、`migrateIfOwner`、`Ledger` 及上述 8 个类型（全部是**再导出**，无本文件自持值）。依赖只有 `./ledger/open.ts`（值与类型）——**不再** import `driver`/`migrations`/`records`/`probes`/`pricing`/`usage`/`cost`/`node:fs`/`node:sqlite`。`ClassifiedError` 类型仍从此处转出以保导出面不减（80-§5.7 的类型，来源 `@studio-next/contract`）。
- **IO 与注入**：N/A（零 IO、零时钟）。组装期的 `() => Date.now()` 注入在 `open.ts`。
- **状态与并发**：N/A（无状态）。原 `db` 公开逃逸面的处置不在此条目决定（`Ledger` 形状归 `open.ts`，逃逸面清单见 §8.2）。现状事实（供迁移判断）：`db` 句柄原对外公开（`ledger.ts:1585`），调用方可绕过所有写口直发 SQL（**8 个 store 测试文件 + 4 个 daemon 测试文件**按句柄用，§8.2）；原文件两处手写事务 `syncCompany`（`:865`）/`replaceTodoQueue`（`:948`），包内另有 `usage.ts:219`、`rebuild.ts:32`、`migrations.ts:571`，五处全裸 `BEGIN/COMMIT/ROLLBACK`，**无嵌套守卫、无 savepoint、无重入保护**。
- **错误与观测**：N/A（本文件不再抛错；全部错误由 `open.ts` 与各面产出，subcause 约定见各面条目与 §1.4）。
- **测试与证据**：全部 15 个测试都经本文件（直接或经 `index.ts`）。E 类只有 `test/drill.test.ts` 的 `spawnSync` 段与 `test/rebuild.test.ts` 的真文件删库段。**不证明**并发、跨进程、断电容灾。
- **规模与迁移**：1683 行 → `ledger/` **12 件**（§5.1 表；事务与记录端口按 80-§6.9 落 `records/`，不计入本文件拆分），facade 预算 **≤70 行**（纯再导出 + 类型转出）。M0 是纯移动：方法体先落各 face，**`openLedger` 的头与组装对象暂留 facade**（约 100–150 行，仍 ≤600）；M2 再把它们移入 `open.ts`，facade 才降到 ≤70。两阶段之间 `index.ts` 导出面不变。

#### F-store-ledger-shared · `packages/store/src/ledger/shared.ts`（目标新增，预算 ≤70）

- **处置**：目标-新增（拆分产物 + 解类型环）。
- **归属**：81-§3.2「拆分先解类型环」；80-§4.4 事件投影口径。
- **职责**：事件级共享件——`AppendResult` 类型、`canonicalTokens`/`parseTokens`（四桶固定序）、`canonicalJson`、`parseJsonArray`/`parseJsonValue`、`errorMessage`、`sameEvent`。**非职责**：不做行映射（归各面 `rowToXxx`）、不定义 schema。
- **内部**：`TOKEN_BUCKET_ORDER = ['input','output','cache_read','cache_creation']`；`canonicalTokens` 用固定桶序 + `null` 占位保证字节确定；`AppendResult = { id: string; appended: boolean }`（现状形状，**不改**——80-§6.3 淘汰的是它作为**端口类型**，不是句柄类型）。
- **导出/依赖**：上述 7 项；`@studio-next/contract`（`EventRecord` 类型、`configInvalid`）。
- **IO/并发/错误**：纯函数；`parse*` 失败 → `CONFIG_INVALID`（`store/evt:tokens-corrupt` 等）。
- **测试**：经 `test/ledger.test.ts`（canonical tokens 幂等）、`test/v4-debts.test.ts`（tokens 往返）。
- **规模**：约 65 行（源自 `ledger.ts:361-512` + `:1660-1681` + `:173-181`）。

#### F-store-ledger-events · `packages/store/src/ledger/events.ts`（目标新增，预算 ≤160）

- **处置**：目标-新增（拆分产物）；80 `TS-PORT-REC-01/02` 的**现状载体**。
- **归属**：80-§4.4（`EventRecord` 是 30 事件投影）、80-§6.3 REC-01/02、F2-01/F2-04/F2-11。
- **职责**：`appendEvent`（契约闸 + 同 id 幂等）、`queryEvents`（company/issue/since/until/limit/order）、`dumpEvents`（JSONL 单向外导）。**非职责**：不判事件名合法性之外的状态机、不生成 id/ts、不决定 append-only 的文件级保证（现为纪律）。
- **内部**：`EventQuery`（`{company?,issue?,since?,until?,limit?,order?}`）；`INSERT_EVENT_SQL`（`:416-423`，17 列）；`rowToEvent`（`:386-414`，tokens 走 `parseTokens`）；`assertValidEvent`（`:436-452`，`validateEventRecord` + `evt/invalid:<path>`）；`order` 白名单运行期闸（`:553-560`，非 `asc|desc` → `store/evt:bad-order`）。
- **导出/依赖**：`EventsFace` + `createEventsFace(db)`；`./shared.ts`、`../row-helpers.ts`、`../records.ts`（无）、`@studio-next/contract`。
- **IO**：SQLite + `node:fs`（`dumpEvents` 同步写）。时钟：无（`ts` 由调用方给）。
- **状态与并发**：先 SELECT 后 INSERT；无唯一约束兜底（`id` 是主键，故并发同 id 会撞主键而非静默双写）。**`dumpEvents` 现状直写目标路径**（`:593`），中途失败留半截 JSONL——**目标改为「同目录临时文件 + `rename` 原子替换」**：先写 `<target>.tmp-<pid>-<n>`、`fsync`、再 `rename`，失败时删除临时件、目标文件保持旧内容。80-§11.3 已把「导出类落盘用临时文件 + rename」定为口径，故此项从「待裁定」升为**按 80 执行**（原 D7 关闭，残余未证仅「跨设备 rename 会失败」→ 同目录写即规避）。
- **错误/观测**（按 §1.4）：`store/evt:duplicate-id` ⇒ `rejected_idempotency` + `EXTERNAL_REJECT`（同 id 已存在即幂等命中，不是配置错）；`evt/invalid:<path>` ⇒ `rejected_precondition` + `CONFIG_INVALID`；`store/evt:bad-order` ⇒ `rejected_precondition` + `CONFIG_INVALID`（调用方给的排序值不在白名单）；`store/evt:tokens-corrupt` ⇒ `rejected_precondition` + `CONFIG_INVALID`（存量行坏了，处置是停手自查，不是重试）。`dumpEvents` 的 IO 失败 ⇒ `unavailable` + `STALL`，`subcause` 前缀 `store/evt:dump-*`。
- **测试**：`test/ledger.test.ts`、`test/v4-debts.test.ts`（desc 镜像）、`test/rebuild.test.ts`（dump）。
- **规模**：约 150 行。

#### F-store-ledger-work · `packages/store/src/ledger/work.ts`（目标新增，预算 ≤190）

- **处置**：目标-新增（拆分产物）。
- **归属**：F2-04、80-§8.3 finalize 段。
- **职责**：`insertWorkRecord`/`getWorkRecord`/`listWorkRecords`/`insertSession`/`getSession`/`listSessions`/`endWorkRecord`。**非职责**：不判 `status` 终态语义、不写 events、不计算成本。
- **内部**：`rowToWorkRecord`（`:632-667`，tokens 走 `JSON.parse` 后按 `WorkRecordSchema` 收）、`rowToSession`（`:692-707`）；`endWorkRecord`（`:1225-1252`）：不存在 → `false`；已 `ended_at` → 抛 `store/work-record:already-ended`（80-§8.3 finalize 明写「已收口再收口」是**状态冲突**）；其余 `UPDATE … COALESCE(?, col)`，**只允许一次收口**。
- **导出/依赖**：`WorkFace` + 工厂；`../records.ts`、`../row-helpers.ts`、`./shared.ts`。
- **IO/并发**：无事务（单语句）；`endWorkRecord` 靠 `ended_at IS NULL` 的读后写判定——**非原子 CAS**（两个连接可同时通过判定，第二个 UPDATE 会覆盖；当前单写者假设，78 `BIND-STORE-01` 不支持 CAS/跨进程单写）。因此本面**不产出** `cas-row-changed`：它检测不到丢更新，宁可如实承认未证（§十 U5），也不假装有版本闸。若将来引入行版本列，再按 `rejected_version` + `EXTERNAL_REJECT` 补。
- **错误**（按 §1.4）：`store/work-record:end-invalid` ⇒ `rejected_precondition` + `CONFIG_INVALID`（形状/入参错）；`store/work-record:already-ended` ⇒ **`rejected_state` + `EXTERNAL_REJECT`**（现状是 `CONFIG_INVALID`，M5 同批改断言）。
- **测试**：`test/ledger.test.ts:208-…`、`test/v4-debts.test.ts`、`test/v8-model.test.ts`。
- **规模**：约 170 行（源自 `:597-719` + `:1225-1252`）。

#### F-store-ledger-company · `packages/store/src/ledger/company.ts`（目标新增，预算 ≤320）

- **处置**：目标-新增（拆分产物）；80 `TS-PORT-REC-03` 的**现状载体**（`syncCompany`/`replaceTodoQueue`/`listTicketMirrors` 明确点名）。
- **归属**：F2-06、04-§二 目录镜像、129-§6.2-R2、17-§3。
- **职责**：`syncCompany`（people/departments 镜像 upsert，**单事务**）、`listPeople`/`getPerson`/`listDepartments`、`upsertTicketMirror`/`getTicketMirror`/`listTicketMirrors`、`replaceTodoQueue`（按公司整换，**单事务**）、`listTodoQueue`、`recentDispatchWaitsMs`（`DISPATCH` note 的 `wait=` 锚）。**非职责**：不删已消失的人/部门（`index.ts:128-129` 明列「镜像收敛未做」）、不写 `people.status`（归 `hr-sync-queue`）、不生成投影（投影生成在 daemon/company）。
- **内部**：`rowToPerson`/`rowToDepartment`/`rowToTicketMirror`/`rowToTodoQueue`；`syncCompany`（`:834-889`）：**先整批预校验 + 批内查重**（重人/重部门 → `store/people:duplicate`/`store/departments:duplicate`，不开事务）→ `BEGIN` → 逐行 `ON CONFLICT DO UPDATE` → `COMMIT/ROLLBACK`；`replaceTodoQueue`（`:940-973`）：逐行 `assertRecord` + `company` 一致性闸（`store/todo-queue:company-mismatch`）→ `BEGIN` → `DELETE WHERE company` → 逐行 INSERT → `COMMIT`；`dispatchWaitOfNote`（`:985-990`）正则 `(?:^|[; ])wait=(\d+)`。
- **导出/依赖**：`CompanyFace` + 工厂；`../records.ts`、`../row-helpers.ts`、`@studio-next/contract`（`CompanySnapshot` 类型）。
- **IO/并发**：两处事务（见上），无嵌套守卫。`syncCompany` 是 **upsert 覆盖**，语义=「快照所载字段覆盖」，不是全量 diff。
- **错误**（按 §1.4，全部落在 `rejected_precondition` + `CONFIG_INVALID`）：`store/people:invalid|duplicate`、`store/departments:invalid|duplicate`、`store/ticket-mirror:invalid`、`store/todo-queue:invalid|company-mismatch`。理由：批内重名、跨公司串行、形状不合都是**同一份快照自身不自洽**，重试不会变好，属于配置/输入错，不是幂等命中也不是状态冲突（`duplicate` 在这里指**批内**重名，不是「同 id 已存在」）。
- **测试**：`test/v2-tables.test.ts`（syncCompany 往返、批内查重、ticket_mirror）、`test/v8-todo-queue.test.ts`（整换/隔离/坏行整批拒/`wait=` 锚）。
- **规模**：约 290 行。

#### F-store-ledger-budget · `packages/store/src/ledger/budget.ts`（目标新增，预算 ≤100）

- **处置**：目标-新增（拆分产物）。
- **归属**：F1-09 预算三节点；80-§8.3 reserve 段（`appendBudget` 双行）。
- **职责**：`appendBudget`（同 id 幂等）、`queryBudgets`（`BudgetScope` 单键）、`listBudgets`（since/until + `kinds` 子集，空数组=不过滤）。**非职责**：不判余额、不判超限（`core/budget.ts`）。
- **内部**：`BudgetScope = { kind, id }`；`BudgetListQuery = { since?, until?, kinds? }`；`rowToBudget`（JSON 列 `meta` 解析）；`isBudgetKind` 运行期闸。
- **错误**（按 §1.4）：`store/budget:invalid` ⇒ `rejected_precondition` + `CONFIG_INVALID`；`store/budget:bad-kind` ⇒ `rejected_precondition` + `CONFIG_INVALID`（现状 `:1026-1057`）；`store/budget:duplicate-id`（同 id 已存在且内容不一致，`:1010`）⇒ **`rejected_idempotency` + `EXTERNAL_REJECT`**（内容一致时走幂等命中返回 `appended:false`，不报错）。
- **测试**：`test/v2-tables.test.ts`（scope、`kinds` 空集语义、坏形状）。
- **规模**：约 90 行（源自 `:812-833` + `:1004-1057`）。

#### F-store-ledger-hr · `packages/store/src/ledger/hr.ts`（目标新增，预算 ≤80）

- **处置**：目标-新增（拆分产物）。
- **归属**：F2-06（人事必挂单）、01 C1-04（三表时间线）。
- **职责**：`appendPersonnelEvent`（同 id 幂等 + 触发器兜底）、`personnelTimeline(personId)`（三表归并）。**非职责**：不写人事同步队列（归 `hr-sync-queue`）、不校验 type 值域。
- **内部**：`TIMELINE_SOURCE_RANK = { personnel_event: 0, work_record: 1, session: 2 }`；同 ts 稳定序 = 源序 → 各自 id（`session_id` 或 `id`）。
- **错误**（按 §1.4）：`store/personnel-event:invalid` ⇒ `rejected_precondition` + `CONFIG_INVALID`；`store/personnel-event:duplicate-id`（同 id 不同内容，`:1066`）⇒ `rejected_idempotency` + `EXTERNAL_REJECT`；触发器拒 UPDATE/DELETE（`index.ts` 已登记的 append-only 兜底）⇒ **`rejected_forbidden` + `EXTERNAL_REJECT`**（库侧主动禁止，不是配置错）。
- **测试**：`test/v2-tables.test.ts`（触发器拦 UPDATE/DELETE、时间线三表归并）。
- **规模**：约 70 行（源自 `:743-758` + `:1058-1102`）。

#### F-store-ledger-jobs · `packages/store/src/ledger/jobs.ts`（目标新增，预算 ≤120）

- **处置**：目标-新增（拆分产物）。
- **归属**：18-§三（补跑、热更不动他岗）、17-§2。
- **职责**：`upsertJob`（`job_id` 覆盖但**不清 `last_run_at`**）、`getJob`/`listJobs`、`dueJobs(now, limit?)`、`markRan`（两列同语句）、`removeJob`。**非职责**：不解析 cron、不判 `status` 语义（`dueJobs` 不按 status 过滤）。
- **内部**：`rowToJob`（`:1103-1131`，payload JSON 往返）；`dueJobs` 按 `next_run_at <= now` 升序（`:1180-1193`）；`markRan` 返回 `changes > 0`；`removeJob` 同。
- **错误**：`store/job:invalid`（记录闸）、`store/job:bad-cron`（形状）。
- **测试**：`test/v3-jobs.test.ts`（热更不清跑史、补跑扫描、原子两列）。
- **规模**：约 110 行（源自 `:1103-1205`）。

#### F-store-ledger-kv · `packages/store/src/ledger/kv.ts`（目标新增，预算 ≤40）

- **处置**：目标-新增（拆分产物）。
- **归属**：17-§2（游标/拍序持久化）；v4「吸收 daemon 旁路写面」。
- **职责**：`kvGet`/`kvSet`，键闸=非空字符串。**非职责**：不锁键命名空间、不判 value 形状（空串是「null 游标」的持久形态）。
- **错误**：`store/kv:bad-key`。
- **测试**：`test/v4-debts.test.ts`（往返、空键拒、存量 daemon_kv 原地接管）。
- **规模**：约 30 行（源自 `:1206-1224`）。

#### F-store-ledger-candidates · `packages/store/src/ledger/candidates.ts`（目标新增，预算 ≤220）

- **处置**：目标-新增（拆分产物）；80-§8.3 CAS 段的现状锚（`transitionCandidate` 乐观锁）。
- **归属**：02-F3-01/02/03、80-§8.3。
- **职责**：`insertCandidate`（同键非终态幂等 + 谱系三闸）、`getCandidate`、`lineageOf`（全祖先链，应用层循环）、`candidatesByStatus`（空数组拒）、`transitionCandidate`（`WHERE status = from` 真 CAS）、`updateVerification`（行中写面 + 窗口语义）。**非职责**：不判状态边合法性（core 是唯一状态机）、不生成 id/`created_at`。
- **内部**：`parentLinkOf`、`assertNoLineageCycleOnInsert`、`serializeVerification`（单一口径源，两面共用）。`insertCandidate` 顺序：形状闸 → verification 序列化闸 → 非终态同键命中 → 同 id 幂等/冲突 → 自引用/父未知/成环 → INSERT。`lineageOf` 断链/成环 → `CONFIG_INVALID`（fail-closed，不死循环）。
- **导出/依赖**：`CandidatesFace` + 工厂；`../records.ts`、`../row-helpers.ts`、`./shared.ts`。
- **错误**（按 §1.4）：`store/candidates:invalid|verification-unserializable|self-parent|parent-unknown|lineage-broken|lineage-cycle` ⇒ `rejected_precondition` + `CONFIG_INVALID`（谱系断链/成环一律 fail-closed 拒写，不死循环、不"修好"）；`store/candidates:duplicate-id`（同 id 不同内容，`:1322`）⇒ `rejected_idempotency` + `EXTERNAL_REJECT`；`store/candidates:bad-status`/`bad-statuses` ⇒ `rejected_precondition` + `CONFIG_INVALID`。**`transitionCandidate` 本身不抛错**：`from` 不符（已迁走/无此行）返回 `false`——这是现有句柄契约，不许改成抛错。**目标**：端口层（`records/ports.ts`）在调用方声明「本次迁移必须成功」时，把 `false` 映射成 `rejected_version` + `EVOLVE_REJECT` + `store/candidates:cas-from-mismatch`（`EVOLVE_REJECT` 在 `Err` 可达集合内；乐观锁失败是版本冲突，不是配置错，也不是状态机边非法）。边合法性（机器边/闸门边/人裁边）仍归 core 纯函数，本面不复制判定。
- **未证**：`(asset_path, diff_hash)` 只有**非唯一**索引（`migrations.ts:278`），库侧无法阻止两行同键非终态；「同键至多一行非终态」靠 insert 前置闸 + 单写者。
- **测试**：`test/candidates/{insert,lineage,core-parity,update-verification}.test.ts`（拆分后）。
- **规模**：约 200 行（源自 `:1253-1433`）。

#### F-store-ledger-reports · `packages/store/src/ledger/reports.ts`（目标新增，预算 ≤180）

- **处置**：目标-新增（拆分产物）。
- **归属**：04-§三 报表快照、docs/50 断链 6、77 `REC-OBS-01`。
- **职责**：`upsertLedgerEntry`/`getLedgerEntry`/`listLedgerEntries`（单据派生镜像，双键 `(issue, kind)`）、`insertReport`（自然键 `(company,node,type,date)` 覆盖换代）、`getReport`/`listReports`。**非职责**：不聚合、不渲染、不校验 `caliber` 值域、不做公司一致性闸（`reports`/`probes_runs` 无 `company` 外键）。
- **内部**：`serializeLedgerBody`（不可序列化 → `store/ledger-entry:unserializable`）；`insertReport` 顺序：同 id 一致幂等 → 同 id 不一致拒 → 同自然键 `UPDATE id/caliber/json_ref` → 否则 INSERT（返回 `appended:true` 两种路径）；`isLedgerKind`/`isReportType` 运行期闸。
- **错误**（按 §1.4）：`store/ledger-entry:invalid|unserializable` ⇒ `rejected_precondition` + `CONFIG_INVALID`；`store/report:invalid`/`store/reports:bad-type` ⇒ `rejected_precondition` + `CONFIG_INVALID`；`store/reports:id-conflict`（同 id 不同内容，`:1513`）⇒ `rejected_idempotency` + `EXTERNAL_REJECT`。**同自然键不同 id 的覆盖换代**（`UPDATE id/caliber/json_ref`）不是冲突，返回 `appended:true`；它丢掉旧行 id 这件事有观测后果，但当前无 `REC-*` 记录承载（见 D5）。
- **测试**：`test/v6-reports.test.ts`（覆盖换代、双键、幂等）。
- **规模**：约 160 行（源自 `:1434-1570`）。

#### F-store-ledger-intent-receipts · `packages/store/src/ledger/intent-receipts.ts`（目标新增，预算 ≤140）

- **处置**：**目标-新增**；`intent_receipts` 表（v14）的**落库原语 + 投影 hook 注册点**。本卷实测事实：该表与 `IntentReceipt` 类型当前**全仓零命中**（`grep -rn "intent_receipts\|IntentReceipt" packages apps` = 0），故本条目是「表 + 落库原语」一起从零起，不是把现有代码搬家。
- **归属**：80-§6.6（唯一键与字段全集、同键取 `receivedAt` 最大、`queued` 不受 TTL、EVT-03 缺链保持 unknown、规则 2/3/5/7/9）；80-§6.3 `ProjectionName.intentReceipts`；77 `REC-WORK-01/02`、`REC-EVT-03`（派生来源）、`REC-OBS-02`（只承载孤儿未知与缺口覆盖，**不提供 `outcome`**、不构成第二结论来源）。
- **职责**（只有三件事）：
  1. **表内落行**（`writeRows(rows)`）：按唯一键 `(company, source, kind, key_slot)` 写投影行；同键已存在时**仅当新 `receivedAt` 严格更大**才覆盖可变态（`status`/`outcome`/`referred_*`/`decided_at`/`intake_record_ref`/`unknown_ref`/`gap`/`updated_at`），否则原样保留。**唯一调用者是本包的 `records/hooks.ts`，在记录事务内**（`intentReceipts` 派生钩子），不是公开写口；
  2. `replaceAll(company, rows)`：重建用整表替换（单事务：`DELETE WHERE company` → 逐行 INSERT），**唯一调用者是 `records/projection.ts` 的 `intentReceipts` 投影器**（`project`/`rebuild`）；
  3. `listByStatus(status)` / `listByCompany(company)`：只读取数（后台补链、unknown 巡检、面板/概览只读视图）。
- **非职责**（越界即返工）：**不派生**回执——派生策略（`status`/`outcome`/`gap` 怎么算）归 daemon 的 `IntentReceiptStore`（80-§6.6 规则 2/7，唯一驱动者是 `IntentIngress`），本面只落它算好的行；**不持有内存快照**（80-§6.6 规则 5：`get()` 读的是 daemon 侧快照，`rebuild()` 先表后快照）；**不判 TTL**（`expiresAt` 是导出值，`queued` 不受 TTL——TTL 判定在 ingress）；**不写任何 `REC-*`**（`REC-WORK-01/02`、`REC-EVT-03` 由各自写者落，本面只存指针）；**不生成 `receiptId`**（非 qid，由调用方给）；**不解析 `outcome` 语义**（五值标量，值域闸只做形状）；**不把 `gap` 当错误**（它是状态不是失败）；**不提供** `upsert(receipt)`/`queued(company)`/`mark*` 一类写口（80-§6.6 规则 3 原文禁止——谁想写就说明它在伪造事实）。
- **内部**：`key_slot` 列 = `ticket ?? dedupKey` 的落库位（80-§6.6 第四位）；唯一索引建在四列上，**不建表达式索引**（`COALESCE` 在唯一索引里的比较语义本库未验证，§十 U6）。`gap` 存 JSON 文本（`string[]`），`NULL` = 未评估、`[]` = 评估且无缺口，读取**不得**把两者合一；词表**封闭两码** `unknown-link-missing`/`intake-link-missing`，**不得**自造第三码。`body_digest_algorithm`/`body_digest_value` 两列分开存，算法标签当前只允许 `'sha256'`（写死值域闸），**不**把 `sha8` 一类短哈希当去重依据（`TS-SCALAR-08`）。时间列（`received_at`/`decided_at`/`referred_deadline`/`referred_notified_at`/`updated_at`）全是调用方给的值，本面**不取时钟**；`expires_at` 落库仅为查询便利，权威仍是 `received_at + idempotencyTtlMs` 的导出值，改配置不回溯改旧行。
- **DDL（只用自然语言，不生成可执行 migration）**：表 `intent_receipts`，列 = 唯一键四列（`company`/`source`/`kind`/`key_slot`）+ `receipt_id`、`intent_ref`、`body_digest_algorithm`、`body_digest_value`、`received_at`、`expires_at`、`status`、`outcome`、`referred_*`、`decided_at`、`intake_record_ref`、`unknown_ref`、`gap`、`updated_at`；唯一索引 `(company, source, kind, key_slot)`；查询索引 `(status)`、`(company)`。版本 = `schema_version` 的 v14（随 `migrations/index.ts` 递增）；**迁移只由 daemon 独占窗口执行**，只读面不跑 DDL；回退 = 删表（本表属 §1.3 第三类可重建投影，删表后由 REC 重放恢复）。
- **导出/依赖**：`IntentReceiptsFace` + `createIntentReceiptsFace(db)` + 行形状 `IntentReceiptRow`（**内部行类型**，与 contract 的 `IntentReceipt` 不是同一类型——后者在 01/02 卷定义，本卷不重复）。依赖 `../row-helpers.ts`、`./shared.ts`、`@studio-next/contract`（`ClassifiedError` 类型与 `configInvalid`）。
- **IO 与注入**：SQLite 单连接；无文件 IO、无时钟、无随机。
- **状态/事务/幂等/并发/恢复**：`writeRows` 单语句 `INSERT … ON CONFLICT(company,source,kind,key_slot) DO UPDATE … WHERE excluded.received_at > intent_receipts.received_at`——**同一语句内**完成「取最大」判定，不先 SELECT 再写；由 `records/hooks.ts` 在**记录事务内**调用，故「记录已提交而表投影未更新」的窗口不存在。`replaceAll` 需事务，复用 `records/transaction.ts`。**启动顺序固定**（80-§6.6 规则 9）：schema 闸 → `receipts.rebuild()`（表 + 快照）→ `replayQueued()` → **之后才允许装配 API**；`rebuild()` 失败即**拒启动**，不得降级为空投影、不得启动后再补。整表可重建（第三类表），重建后为空是**已知缺口**而非 bug（§10.2 D9）；**崩溃 kill** 丢内存快照 ⇒ 下次启动 `rebuild()` 全量恢复，不得依赖「上一次运行留下的行」。**API 不拿可写 `Ledger`**：装配体只经 `openLedgerReadonly` 拿只读视图，回执查询走 daemon 快照（80-§6.6 规则 4）。
- **错误**（按 §1.4）：形状/键缺失/算法标签非法/`gap` 越出两码 ⇒ `rejected_precondition` + `CONFIG_INVALID` + `store/intent-receipt:invalid`；`replaceAll` 的批内重键 ⇒ 同 failure/category + `store/intent-receipt:duplicate-key`（批内不自洽）；SQLite busy ⇒ `unavailable` + `STALL` + `store/intent-receipt:db-busy`。**不产出** `rejected_idempotency`：同键覆盖/保留是**正常路径**，不是冲突。
- **测试与证据**：目标 `test/intent-receipts.test.ts`（R+W）：同键取最大 `receivedAt`、等值不覆盖、`queued` 不受 TTL 影响（本面根本不看 TTL）、`gap` `NULL` vs `[]` 区分、`replaceAll` 事务性（中途失败不留半表）、唯一键四列各自生效、`writeRows`/`replaceAll` 只在 hook / 投影器上下文可达（类型层上无 `upsert`/`mark*`）。**零现状测试**（表都还不存在）。
- **规模**：约 120 行（面 90 + 行映射 30）。迁移顺序 M3（随 v14 表一起：先建表与落库原语，再接 hook）。**跨卷**：`IntentReceipt` 的语义契约、`IntentIngress`、`IntentReceiptStore`（含内存快照与 `refresh`/`get`/`rebuild` 三方法）属 01/02/17 卷，本卷只交付「表 + 落库原语 + hook 注册点」，不重复其契约、不持快照（§3.4）。
- **歧义（须回写）**：80-§6.6 第 6 条写「投影只增不改历史」，而本面同键会覆盖 `status`（`queued→decided`）。本卷按「**不改记录历史**（REC 不动）≠ 不更新投影的可变态」解——否则 `status` 永远停在 `queued`，投影即失效。该措辞请 80 定稿时收紧（§10.2 D8）。

### 4.5 打开、记录、资源、租约与记忆（17 件）

#### F-store-ledger-open · `packages/store/src/ledger/open.ts`（目标新增，预算 ≤150）

- **处置**：**目标-新增**；把 `openLedger` 从 `ledger.ts` 移入，并把 80-§8.2 点名的**三个**开库函数落位。
- **归属**：80-§8.2（`openLedgerReadonly` / `openLedgerMaintenance` / 版本闸语义 / 第 3 条「只读面与维护写面分开」）；`TS-PORT-REC-04` 的前置（持锁者）。**不新造概念**：`openLedgerReadonly`、`openLedgerMaintenance`、`migrateIfOwner`、`ReadOnlyLedgerOpen`、`ReadOnlyLedger`、`RecordPage` 全部照 80 原文拼写——注意 80 的**函数名**是 `openLedgerReadonly`（`Only` 的 `o` 小写，80-§8.2），**类型名**是 `ReadOnlyLedgerOpen`/`ReadOnlyLedger`（`Only` 首字母大写，同节）；两者大小写不同，引用时不得互相统一：函数名中该词一律拼作 `Readonly`（`R` 大写、其后全小写），不得按类型名的 `ReadOnly` 类推。
- **职责**（三入口 + 一显式迁移）：
  1. `openLedger(path): Ledger` —— 写面：打开 → 迁移（`migrateIfOwner`）→ 逐面组装 15 个 `createXxxFace(db)` → 返回摊平句柄。现语义保留（含隐式迁移，M5 才去掉）。
  2. `openLedgerReadonly(o: ReadOnlyLedgerOpen): Result<ReadOnlyLedger, ClassifiedError>` —— `ReadOnlyLedgerOpen = { path, expectedSchemaVersion, readOnly: true, queryOnly: true }`；**库缺失 ⇒ `unavailable` + `STALL` + `db-missing`（绝不建库）**；版本落后 ⇒ `rejected_version` + `EVOLVE_REJECT` + `schema-behind`，版本过新 ⇒ 同 failure/category + `schema-ahead`（三条 subcause 照 80-§8.2/§5.7 原文**裸写**，不加 `store/open:` 前缀）；**只读分支必须跳过 `journal_mode`/`synchronous`**（这两个 PRAGMA 会写库头），只保留 `busy_timeout` + `query_only`；返回 `ReadOnlyLedger = { schemaVersion, query<TPayload>(q: RecordQuery): Result<RecordPage<TPayload>, ClassifiedError>, get(recordId): Result<RecordEnvelope<unknown> | undefined, ClassifiedError>, payload(ref: ArtifactRef): Result<RecordPayload | undefined, ClassifiedError>, close(): void }`——**不含 `db`**。**`query`/`get`/`payload` 都是同步 `Result`**（80-§8.2 最新签名）：`get` 的 `Ok(undefined)` 只表示「该 `recordId` 不存在」，运行期读失败（库不可读、行损坏、库被替换）⇒ `Err(unavailable/STALL, ledger-read-failed)`，**不得**降级成 `undefined` 或空页；`query` 的三个错误码与 REC-02 **逐字相同**（`ledger-query-unsupported`/`ledger-cursor-invalid`/`ledger-query-invalid`，§1.4）。`payload(ref)` 与 REC-02 的 `payload` **同义同码**（80-§6.3 原文「四态、四条 subcause 逐字一致」）：`Ok(undefined)` **只**表示该定位查无载荷行，**不是**无权、不是不可读、不是记录不存在；无权 ⇒ `Err(rejected_forbidden, payload-not-authorized)`，不可读 ⇒ `Err(unavailable/STALL, payload-unreadable)`，摘要/媒体类型不符 ⇒ `Err(rejected_precondition, payload-digest-mismatch|payload-media-type-mismatch)`。**先按 `contentDigest` 反查它所属的信封，再按该信封的 `knowledge`/`scope` 校验调用方许可**——`ref` 不授权，`storageHint` 不得直接取对象绕过台账。与 `RecordReader` 的差别只有**同步 vs `Promise`**（80-§8.2/§6.3）：出参形态与全部错误逐字一致，**不得**互相改写成另一套；旧稿「只读视图无错误通道」（原 U16）**已关闭**——80 已给三处 `Result`。
  3. `openLedgerMaintenance(path): Ledger` —— `rebuild`/`drill` 专用：离线窗口 + 单实例锁的语义由调用方持有，本函数只负责「确定要迁移」的打开路径并直接调用 `migrateIfOwner`。
  4. `migrateIfOwner(db): number` —— 显式迁移，签名照 80 原文：吃句柄，返回已应用版本。
  **非职责**：**不实现** owner 判定——80 只给「离线窗口 + 单实例锁」的语义要求、未给机制；本文件只能如实声明「调用方须已持锁」，**不得**自称已持锁（§十 U2）。
- **内部**：`Ledger` 类型在此**声明**＝ 各 `Face` 的交集 + `db`/`close`/`version`（`db` 保留是现状兼容决定，见 §8.2 逃逸面），并在此处组装；`ledger.ts` 只再导出、不回头 import，故依赖链是 `faces → shared`、`open → faces`、`ledger.ts → open`，单向无环。`Ledger` 不放 `shared.ts`（否则 `shared → faces → shared` 成环）。旧稿的 `ReadLedger` 类型**删除**，由 80 的 `ReadOnlyLedger` 取代——两者不是同义（后者有 `query`/`get` 但**无** `db`、且**无**写方法），不得并存。
- **导出/依赖**：四函数 + `Ledger`/`ReadOnlyLedger`/`ReadOnlyLedgerOpen`/`RecordPage`（类型）；`../driver.ts`、`../migrations/index.ts`、`../records/ports.ts`、`../records/hooks.ts`、`../resources/hook.ts`、`./shared.ts`、十面工厂、`../probes.ts`、`../hr-sync-queue.ts`、`../pricing.ts`、`../usage.ts`、`../cost.ts`、`@studio-next/contract`。
- **IO 与注入**：SQLite 单连接；`pricing` 的 `() => Date.now()` 注入点在此（现状 `ledger.ts:1650`）；只读打开**不得**创建 `-wal`/`-shm`（**未证**，§十 U1/U12，需实测带 `-wal` 的库）。**本文件是唯一的只读/维护打开路径**：除 `./open.ts` 外的任何文件都不得直接 `openSqlite` 之外再包一层打开语义，也不得再出现 `src/open-readonly.ts`（旧双名作废）。
- **状态与并发**：`openLedger` 的隐式迁移是 80 `U80-16` 的根因；M4 把生产调用点换成「读面 `openLedgerReadonly`、维护面 `openLedgerMaintenance`」，M5 才摘掉写面的隐式迁移。**DDL 只由 daemon 在独占窗口执行**（80-§8.2 目标态 1）：`migrate` 从 `openLedger` 默认路径移出，改显式 `migrateIfOwner(db)`；只读打开只读版本、不跑任何 DDL；**跨进程单写/并发迁移仍未证**（U2、80 `U80-16`），不得写成已保证。迁移失败分类见 `migrations/index.ts`。
- **错误与观测**（按 §1.4）：`db-missing` ⇒ `unavailable`+`STALL`（**不建库**；只读面与维护面同一 subcause，不另立 `readonly-missing` 一类——§1.4 是 subcause 的唯一来源）；`schema-behind`|`schema-ahead` ⇒ `rejected_version`+`EVOLVE_REJECT`（两者都**拒起**、交 daemon，**绝不**自动迁移、也不降级只读旧库）；配置类（`expectedSchemaVersion` 非整数）⇒ `rejected_precondition`+`CONFIG_INVALID`+`bad-path`；迁移脚本自身的失败（`store/migration:*`）原样上抛，不在此改写。
- **测试与证据**：目标 `test/open.test.ts`（R）：只读不建库、只读不迁移、只读不建 `-wal`（E，需真文件）、落后/过新两向版本闸（拒起而非降级）、`ReadOnlyLedger` 上写方法不可达（类型 + 运行期双证）、只读 `get` 的 `Ok(undefined)` 与 `Err(ledger-read-failed)` 两态可区分、只读 `payload(ref)` 的**四态**各一例（`Ok(undefined)` / `payload-not-authorized` / `payload-unreadable` / `payload-digest-mismatch`）、维护面入口可迁移。**现状零测试**。
- **规模**：约 145 行（组装 60 + 三入口 50 + 类型与闸 35）。迁移顺序 M2（面与入口就位、不接线），M4 接线，M5 摘隐式迁移。

#### F-store-records-persistence · `packages/store/src/records/persistence.ts`（目标新增，预算 ≤220）

- **处置**：**目标-新增**；80-§6.3「记录面存储不变量」的**唯一 SQL 落点**。`writer`/`reader`/`transaction`/`open` 都不自带建表/写表语句，一律经本件导出的 `EnvelopeStoreFace`；DDL 本身在 `../migrations/records.ts`（v15），本件只读写**已建**的三表。
- **归属**：80-§6.3 四表条与四条可测不变量（载荷可复核、写入原子、知悉范围不可被查询绕过、`commitSeq`/`proofRef` 无窗口）；76-§4.2（信封字段）、§4.4 `ARTIFACT-REF`、§1.5 `byteDigest`、§1.8「unknown」。
- **职责**（内部原语，不是公共端口）：`insertRecord(envelopeBytes, columns)`；`insertPayload(contentDigest, mediaType, byteLength, bytes, storageHint, knowledgeScope)`（同摘要已存在即复用，不重复写）；`readRecord(recordId)`/`queryRecords(q)`；`openTx(...)`/`closeTx(txId, {status, commitSeq, proofRef})`/`readTx(txId)`；`assertUsable()`（schema < v15 ⇒ 拒）。**非职责**：不判权、不判六态、不派生投影、不取时钟（`storedAt`/`recordedTime` 由调用方给）、不自己 `BEGIN`。
- **表形状（自然语言；字段/键/约束，不写 DDL）**：
  - **`records`（整封，不可变）**：`recordId`（主键）、`company`、`typeName`+`typeVersion`、`authorityDomain`、`subjectKind`+`subjectId`、`observedTime`/`recordedTime`/`effectiveFrom`、`idempotencyKey`（可空）、`lineageHead`（可空）、`envelopeBytes`（**BLOB**）、`envelopeDigest`（`sha256:<64 hex>`，内部编码）、`storedAt`。**`envelopeBytes` 是「UTF-8 编码后的 JCS 规范字节」**，读取时按 UTF-8 解码再解析；不是「JSON 文本列」，也不做二次规范化。`lineageHead` 是**逻辑链指针**（本记录所在链顶的 `recordId`），**不自引用外键**——SQLite 的自引用外键在追加式乱序补链下会互相卡死，链的完整性由 `expectedLineageHead` 的 CAS 与读取时的链校验保证。
  - **`record_payloads`（原始字节，不可变）**：`contentDigest`（主键，`sha256:<64 hex>`，内容寻址——同一载荷被多条记录引用时共用一行）、`mediaType`、`byteLength`、`bytes`（**BLOB = 原始载荷字节**；不解析、不规范化、不压缩、不转码。文本类载荷的编码由 `mediaType` 声明，本表不替它猜）、`storageHint`（可空，**逻辑定位**，不是路径、不是可读性证明、不是权限凭证）、`knowledgeScope`（可空；列名取 80 `RecordEnvelope.knowledge` 的语义，**形状归 contract**，本件不定义新公共类型）。**不存解析后的对象**——解析是可重算的派生。
  - **`record_transactions`（事务账）**：`txId`（主键）、`company`+`authorityDomain`+`partition`（三列并作 scope，不塞 JSON）、`writerId`、`fence`（可空）、`openedAt`、`status`（`open`/`committed`/`aborted`/`unknown`）、`commitSeq`（**可空、唯一**：只有 `committed` 才有）、`proofRef`（可空，`REC-RCP-01` 的 `recordId`）、`recordIds`（本事务追加的记录 id，按追加顺序；落成文本列还是子表归实现选择，**不得**因此改变 `TxReceipt.recordIds` 的形状）。
- **机制约束（不是自律）**：
  - `records`/`record_payloads` 各挂 `BEFORE UPDATE`/`BEFORE DELETE` 触发器 `RAISE(ABORT)`；`record_transactions` 只允许一次终态转移（`open` → 三终态之一），
    `committed` 行不得再改、不得删除。
  - **大小上限**：单条信封字节 **≤ 1 MiB**、单载荷字节 **≤ 8 MiB**。超限 ⇒ `rejected_precondition + payload-too-large`（`detail.which` 取 `'envelope'` 或 `'payload'`），**零行写入**。上限是工程判断（§十 U17），不是测量结论；大对象外置（`storageHint` 指向对象存储、库里只留摘要与长度）**本版不实现**，登记为未实现项。
  - **摘要一律对字节算**：`envelopeDigest` 对 `envelopeBytes` 算、`contentDigest` 对 `bytes` 算，**不得**对解码后的字符串算；`byteDigest` 语义照 76-§1.5（不带 `canonicalizationId`/`version`）。
  - **不建外键**：`record_payloads` ↔ `records` 之间无外键（同摘要多引用），引用关系由信封的 `payloadRef.contentDigest` 表达；**不因此允许“载荷可先行或后行”**——对外提交必须信封与载荷同事务，任一失败整体回滚。`recordIds` 里的 id 也不建外键（事务账要能记录「记录写失败但事务行已开」的 `unknown`）。
  - **幂等唯一键**：`(company, typeName, typeVersion, idempotencyKey)` 的部分唯一索引（`idempotencyKey` 非空时生效）；重复且整封与载荷一致 ⇒ `deduped`，不一致 ⇒ `rejected_idempotency`（判据在 `writer.ts`，索引在此兜底）。它同时约束 `REC-EVT-01` 的效果尝试：同一公司、记录类型版本与效果键至多一条已提交尝试；后到者只能读既有回执/未知，不得再调平台。该约束防止重复发起，**不冒充外部物理效果恰好一次**。
- **索引**：`(company, typeName, recordedTime)`、`(authorityDomain, recordedTime)`、`(subjectKind, subjectId)`、`(lineageHead)`、上述部分唯一键；`record_transactions` 的 `commitSeq` 唯一索引与 `(company, authorityDomain, openedAt)` 普通索引。**查询不透总数**：只回 `items + nextCursor`，不提供 `COUNT(*)` 通道——越权/scope 外的行不计数、不体现在游标长度里（80-§6.3「过滤掉之后仍回总数」判负）。
- **导出/依赖**：`createRecordPersistence(db)` + `EnvelopeStoreFace`（内部类型，不出包）；`../driver.ts`（类型）、`@studio-next/contract`（错误构造）。**不 import** `migrations/`（否则 `migrations → persistence` 与 `persistence → migrations` 成环）；`migrations/index.ts` 单向调用本件写 `REC-MIG-01`。
- **IO/注入**：吃已打开且已迁移的 `DatabaseSync`；单连接；无时钟、无随机、无文件 IO。
- **状态/事务/并发**：所有写原语**必须在调用方已开的事务内**执行；`db-busy` ⇒ `unavailable`。**表未建**（schema < v15）⇒ `assertUsable` 抛 `unsupported + envelope-not-storable`（fail-closed），**不得**回退到 `events`。
- **错误/观测**（按 §1.4）：`envelope-not-storable` ⇒ `unsupported`；`payload-too-large`/`bad-path` ⇒ `rejected_precondition`；`db-busy` ⇒ `unavailable`；触发器拒改删 ⇒ `rejected_forbidden + store/record:append-only`（正常路径不该出现，出现即缺陷）。
- **测试与证据**：目标 `test/records/persistence.test.ts`（R+W）：整封往返逐字段一致（含 `integrity`/`knowledge`/`lineage`）；`UPDATE`/`DELETE` 被触发器拒；信封 >1 MiB / 载荷 >8 MiB ⇒ `payload-too-large` 且零行；同摘要第二次写不增行；`bytes` 原样取回（非 UTF-8 的二进制载荷逐字节相等）；摘要对字节算（改一字节即不同）；`record_transactions` 的 `commitSeq` 唯一约束生效；表未建 ⇒ `envelope-not-storable`。
- **规模**：约 200 行（三条 insert + 两条 read + `assertUsable` + 大小/摘要校验）。迁移顺序 M2（建面），**M3 建 v15 后**才可用。

#### F-store-records-writer · `packages/store/src/records/writer.ts`（目标新增，预算 ≤150）

- **处置**：**目标-新增**；80-§6.3 `TS-PORT-REC-01` 的实现。**不是** `Ledger.appendEvent` 的包装：信封进 `records`、载荷字节进 `record_payloads`、30 事件投影行与事务账在同一事务里派生（80-§6.3 明写「`RecordWriter` 不得把 `appendEvent` 当实现」）。
- **归属**：80-§6.3 REC-01（签名 `append(input: RecordWriteInput, opts?: AppendOptions)`、`RecordWriteInput = { envelope, payload: { ref, bytes, mediaType } }`、六条前置、四条载荷 subcause、幂等与两个 CAS 位）、76-§1.5 `byteDigest`、§4.4 `ARTIFACT-REF`、80-§6.9 落点。
- **职责**：`append(input: RecordWriteInput, opts?: AppendOptions): Promise<Result<AppendReceipt, ClassifiedError>>`；成功回 `AppendReceipt{recordId, deduped}`。**输入不合法一律拒且零行**（不丢字段、不「先写信封后补载荷」）。**非职责**：不判六态语义、不派生业务结论、不直接写投影表（投影由 `./hooks.ts` 同事务派生）、不判权（权源归 77 按类型规则，本面只接收已判定请求）。
- **内部**：
  - **载荷四态（四条 subcause，逐字取 80）**：未给 `payload` ⇒ `payload-missing`；`payload.ref` 与 `envelope.payloadRef` 不逐字段同值 ⇒ `payload-digest-mismatch`（`contentDigest` 不同）或 `payload-media-type-mismatch`（`mediaType` 不同）；`bytes` 不是 `Uint8Array`、长度与 `ref` 不符、读取中断 ⇒ `payload-unreadable`。四者都是 `rejected_precondition`，**不是** `unsupported`。
  - **字节摘要必核**：对 `bytes` 现算 `byteDigest` 与 `ref.contentDigest` 比对，不符即拒。**只对字节算**，不对字符串算。
  - **整封字节**：信封按 80-§4.5 JCS 规范化后 UTF-8 编码，作为 `envelopeBytes`；`envelopeDigest` 是这串字节的 `sha256`，用于「同 `recordId` 是否同内容」的判等（幂等成功 ⇒ `deduped:true`；同 id 不同字节 ⇒ `rejected_idempotency`）。
  - **`authorityDomain` 不得猜**：`opts.authorityDomain` 可省**仅当** `AuthorityRequirementSource` 对 `envelope.recordType` 恰好给出一条覆盖；多域覆盖/歧义而缺失 ⇒ `rejected_precondition + authority-domain-ambiguous`；解析出的域必须等于 `TxScope.authorityDomain`（不等 ⇒ `rejected_precondition + tx-scope-domain-mismatch`），且被 `AuthorityActivationPort` 的**当前激活**允许该 `recordType`/域（不允许 ⇒ `rejected_authority`）。域写 `records.authorityDomain` 索引列。
  - **链顶 CAS**：`lineageHead` 取信封 `lineage`（`parentRefs`/`supersedes` 最新一环）写入列，供只读面与投影定位；`opts.expectedLineageHead` 不符 ⇒ `rejected_version`（先重读链顶再重判，**不得**「自动改接最新」）；`opts.expectedTypeVersion` 不符 ⇒ 同 failure、`detail.which='typeVersion'`。
  - **同事务五写**：`records` 行 + `record_payloads` 行（摘要已存在则复用）+ `record_transactions` 行（单条追加也记账，`recordIds` 一项，`committed` 且带 `commitSeq`/`proofRef`）+ `events` 投影行 + hooks 派生。任一失败整体回滚，**不留「有封无载」或「有载无封」**。
  - **`events` 降级为投影**：`appendEvent` 只在本件内作为**私有助手**（`writeEventProjection`）被调用，为「记录 → 30 事件投影」服务；**不经端口暴露**，其它文件不得再拿它写事实（80-§6.3/§4.6）。
  - **表未建**：schema < v15 ⇒ `unsupported + envelope-not-storable`（fail-closed），**不得**退回 `appendEvent` 假装成功。
  - `writerLease`/`fence`：委托 `../lease/lease.ts` 比对当前租约代次；**同进程**可校验，**跨进程仍** `unsupported`（78 `BIND-STORE-01`、U2）。
- **导出/依赖**：`createRecordWriter(db, deps)` + `RecordWriterFace`；`./persistence.ts`、`./hooks.ts`、`../lease/lease.ts`、`../ledger/events.ts`（投影私助）、`../driver.ts`（类型）、`@studio-next/contract`（`RecordWriteInput`/`ArtifactRef`/`RecordPayload`/`AppendOptions`/`AppendReceipt` **type-only**，本件不重定义）。
- **IO/注入**：单条追加 = 一个 `BEGIN IMMEDIATE` 写事务，事务内无 `await`（80-§8.2「长 IO 不持写事务」）；无时钟，`recordedTime`/`storedAt` 由调用方注入。
- **状态/事务/并发**：同 `recordId` 且字节一致 ⇒ `Ok({deduped:true})`（幂等成功，不是错误）；不一致 ⇒ `Err(rejected_idempotency)`；并发同 id 靠主键与部分唯一索引兜底，不静默双写、不静默覆盖。
- **错误/观测**（按 §1.4）：形状/语义/载荷四态 `rejected_precondition`；`authority-domain-ambiguous`/`tx-scope-domain-mismatch` 同 failure；`rejected_authority` 用于域不允许；链顶或类型版本不符 `rejected_version`；租约过期/围栏代次落后 `rejected_version`；`envelope-not-storable` ⇒ `unsupported`；`db-busy` ⇒ `unavailable`；证明写不出 ⇒ 回滚 + `unavailable + store/record:proof-unwritable`。
- **测试与证据**：目标 `test/records/writer.test.ts`（R+W）：整封往返逐字段一致；载荷四态各一例且**库里零行**；改一字节 ⇒ `payload-digest-mismatch` 且零行；同载荷二次写不增 `record_payloads` 行；`deduped` 与 `rejected_idempotency` 两向；链顶/类型版本 CAS 两向；`authorityDomain` 歧义缺失 ⇒ 拒、与 `TxScope` 不一致 ⇒ 拒；`events` 投影行与记录同事务（回滚后都不在）；`record_transactions` 恰一行 `committed` 且 `proofRef` 指向同事务 `REC-RCP-01`；表未建 ⇒ `unsupported` 且**不**调用 `appendEvent`。
- **规模**：约 140 行。迁移顺序 M2（建面不接线），M3 建 v15 后接线。

#### F-store-records-reader · `packages/store/src/records/reader.ts`（目标新增，预算 ≤160）

- **处置**：**目标-新增**；80-§6.3 `TS-PORT-REC-02`，读 `records`/`record_payloads`（经 `./persistence.ts`），取代现状 `Ledger.queryEvents`。与 `../ledger/open.ts` 的 `ReadOnlyLedger` **共用 `RecordPage`/`RecordPayload` 出参形态**，差别只有 async vs sync。
- **归属**：80-§6.3 REC-02（`RecordQuery`/`RecordPage` 形状、三条查询 subcause、`get` 的失败通道、`payload(ref)` 的四态逐字口径）、80-§8.2（只读面同码）、76-§4.4 `ARTIFACT-REF`。
- **职责**：`get(recordId: Qid): Promise<Result<RecordEnvelope<unknown> | undefined, ClassifiedError>>`；`query<TPayload>(q: RecordQuery): Promise<Result<RecordPage<TPayload>, ClassifiedError>>`；`payload(ref: ArtifactRef): Promise<Result<RecordPayload | undefined, ClassifiedError>>`。**`get` 的 `Ok(undefined)` 才表示不存在**，`payload` 的 `Ok(undefined)` **只**表示该定位没有载荷行；运行期读失败一律 `Err(unavailable + STALL + ledger-read-failed|payload-unreadable)`，**不得**用 `undefined` 或空页吞掉。**查询只回信封**：`items` 里不带 `bytes`，也不得用 join 把载荷顺带取出来（一次 `limit` 就能拉全表大包）。
- **内部**：`RecordQuery` **只允许索引化条件**（类型/公司/主体/时间窗/游标/限额/排序/知悉范围），禁止任意谓词、正则、join、聚合、「先取全量再在端口里算」；`limit`/`order` **必填**（不给默认值，避免悄悄全表）；`cursor` **opaque**（编码由本面私有，keyset 为 `(timeField, recordId)` 严格大于，调用方不得解析/拼接/比较）；`nextCursor === null` 当且仅当无下一页，`items.length <= limit`；返回项**必带 `integrity`**，不得只回 payload。
- **`payload(ref)` 的四条固定路径（80-§6.3，逐字）**：
  1. 先按 `ref.contentDigest` **反查它所属的信封**（`records.payloadRef` 指向该摘要的记录），再按该信封的 `knowledge`/`scope` 校验调用方许可；不许可 ⇒ `Err(rejected_forbidden + payload-not-authorized)`。**`ref` 不是通行证**——「我手里有摘要」不等于「我有权读」，也不得用 `storageHint` 直接取对象绕过台账。
  2. 库里查无该摘要的载荷行 ⇒ `Ok(undefined)`（只表示「没有这份载荷」，**不表示**无权、不可读、记录不存在）。
  3. 读回字节现算 `byteDigest` 与 `ref.contentDigest` 不符 ⇒ `Err(rejected_precondition + payload-digest-mismatch)`；`mediaType` 与 `ref.mediaType` 不符 ⇒ `payload-media-type-mismatch`。**不得**「先返回、再告警」。
  4. 字节不可读（行损坏、库被替换、长度与 `byteLength` 不符）⇒ `Err(unavailable + STALL + payload-unreadable)`。
  「记录不存在」与「该定位无载荷」是**两态**，必须可区分：前者由 `get` 回 `Ok(undefined)`，后者由 `payload` 回 `Ok(undefined)`，不得混成同一个返回值。
- **导出/依赖**：`createRecordReader(db)` + `RecordReaderFace`；`./persistence.ts`、`../row-helpers.ts`、`@studio-next/contract`（`RecordQuery`/`RecordPage`/`RecordEnvelope`/`RecordPayload`/`ArtifactRef` **type-only**）。**不**直接拼 SQL（SQL 归 `persistence.ts`），也不 import `./writer.ts`（读写分离，禁读写环）。
- **IO/注入**：只读 SQL；无时钟、不写库、不产记录（访问审计归 MEM-01 与 78 审计面）。
- **状态/事务/并发**：无事务、无状态；`knowledgeScope` 越界的行**不可见**，且**不得**「过滤后仍回总数」。
- **错误/观测**（按 §1.4，四码**裸写不叠前缀**）：`ledger-query-unsupported` ⇒ `unsupported`（收窄条件后重查，不自动降 `limit`）；`ledger-cursor-invalid` ⇒ `conflict`（从首页重查，不按 offset 推算）；`ledger-query-invalid` ⇒ `rejected_precondition`；`ledger-read-failed` ⇒ `unavailable`。载荷面另四态见上条。四类**分开断言**，不合并成一条「参数错」。
- **测试与证据**：目标 `test/records/reader.test.ts`（R）：`get` 两态（`Ok(undefined)` vs `Err(ledger-read-failed)`）、keyset 分页两页无缝且末页 `nextCursor===null`、`limit`/`order` 缺失 ⇒ `rejected_precondition`、超上限 ⇒ `unsupported`、篡改/过期游标 ⇒ `conflict`；`payload` 四态各一例（无载荷 / 越权 / 摘要不符 / 不可读）、「记录不存在」与「无载荷」可区分、跨权查询看不到行且**响应里没有总数**（不是「总数对了但不可见」）、返回项不含 `bytes`。
- **规模**：约 170 行。迁移顺序 M2（建面不接线），M3 建 v15 后接线。

#### F-store-records-projection · `packages/store/src/records/projection.ts`（目标新增，预算 ≤180）

- **处置**：**目标-新增**；80-§6.3 `TS-PORT-REC-03`，收编现状 `syncCompany`/`replaceTodoQueue`/`listTicketMirrors`（`src/ledger.ts:865`/`:948`）。
- **归属**：80-§6.3 REC-03（`ProjectionResult` 按类拆开、`ProjectionName` 封闭联合、表投影无 `Result` 通道）、77-§9、75-D75-06。
- **职责**：`project(name: ProjectionName, source: ProjectionSource): Promise<ProjectionResult>`；`rebuild(name: ProjectionName): Promise<ProjectionResult>`；表投影写/替换一张投影表并回 `{kind:'table', name, rows, cursor}`（`name` 取 `TargetTableProjectionName`），观察投影只回 `{kind:'observation', state}`。**非职责**：不自算六态（只回 `TS-PORT-OBS-01` 给定值）、不把投影当决策输入、不改事实记录、不做磁盘级库重建（那是 `rebuild.ts`）。
- **内部**：
  - 投影名分两级、逐字取 80-§6.3：现状 **17 个已建表**的 `TableProjectionName` = `events|work|sessions|people|personnelEvents|departments|tickets|jobs|todoQueue|candidates|budgets|ledgers|reports|usageDaily|prices|probes|intentReceipts`；**目标第 18 个** `resourceLedger`（物理表 `resource_ledger`，§6.4 RES-01，随 `MIG-01` 建表）合起来是 `TargetTableProjectionName = TableProjectionName | 'resourceLedger'`，再加观察面得 `ProjectionName = TargetTableProjectionName | 'observation'`。本面按目标联合取宽：`TableProjectionResult` 的 `name` 取 `TargetTableProjectionName`（该联合在 80-§6.3 同节已给，`resourceLedger` 已被登记为第 18 个名）；本卷据此写死，D18 已关闭，**不是**命名缺口。`daemon_kv`/`schema_version`/`hr_sync_log` **不是**投影名（内部机制面）。**物理表名与逻辑投影名是两件事**：`'resourceLedger'` 是投影名（实现侧字符串字面量写死），`resource_ledger` 是物理表名；**禁止**在调用点自造名字或「先查表再拼」。
  - **实现未落**：`resourceLedger` 名字已定，但表与派生器都要等 `MIG-01`（`store/src/migrations/` + `assembly/migrate/assemble.ts`）。在此之前该名**未注入派生器** ⇒ `project('resourceLedger')`/`rebuild(...)` 按「派生器未注入」抛 `projection-not-registered`（§1.4 既有码，不新增码）。这是**未实现**，不是「名字未定」。
  - **`ProjectionSource{cursor?, factDomains, since?, asOf?}`——`since` 与 `asOf` 是两个语义，不得互替**（80-§6.3 原文）：`since` 是**增量起点**（只重放该时刻之后的事实，配合 `cursor` 断点）；`asOf` 是**快照时点**（把投影重建到该时点的全量，不看游标）。两者**同时给** ⇒ 抛 `ClassifiedError(rejected_precondition, subcause:'projection-source-invalid')`——同时给等于「既从某点起增量、又是另一时点的全量」，自相矛盾，不得择一静默；要快照必须显式给 `asOf`，**不得**拿 `since` 冒充。两者**都不给** = 从头全量重建（`rebuild(name)` 不带来源参数即此语义，它不自己读时钟去猜时点）。
  - **`factDomains → 本地表` 由注入的 `Projector` 声明，不硬编码常量表**（D16 关闭）：`Projector = { name: TargetTableProjectionName; factDomains: readonly string[]; project(source: ProjectionSource): TableProjectionResult }`；注册时一次性登记「这个投影吃哪些 77 事实域」，装配期与本进程的 `AuthorityRequirementSource` 登记表逐项校验——**未登记的域** ⇒ `rejected_precondition + projection-source-invalid`（不静默忽略、不跳过该项）；涉及写入的表投影还须由 `AuthorityActivationPort` 的**当前激活**允许该域，不允许 ⇒ 同码拒。域字符串是 77 的域标识，**不是物理表名**，两者不得互相顶替；本卷**不出现**域→表的公共常量表，也不得在调用点「先查表再拼」。
  - `rows` = **本次处理的行数**（不是表当前总行数；0 行 ≠ 未运行），`cursor` 完成时为 `null`——与 80-§6.6 对 `intentReceipts.rebuild` 的写法同口径，本卷写死，**不再标「暂定」**。
  - 未注入派生器/未注册名 ⇒ **抛** `ClassifiedError`（`unsupported + projection-not-registered`）；表投影其余失败以 `kind`/`state` 结论表达，**不返回空表冒充「没有数据」**。
- **导出/依赖**：`createProjectionFace(db, { projectors })` + 内部 `Projector` 类型；`../ledger/` 各表面、`./persistence.ts`（读 `records` 作为派生输入）、`./transaction.ts`（rebuild 的整表替换走单事务）、`@studio-next/contract`（`TargetTableProjectionName`/`ProjectionSource` **type-only**）。
- **IO/注入**：SQLite 读写投影表；无时钟（`asOf` 由调用方给）。
- **状态/事务/并发**：`rebuild` 幂等——同 `ProjectionName` + 同游标下，重建结果必须与增量结果逐字段一致；整表替换在单事务内完成，失败整体回滚；同表并发替换靠写事务串行化（跨进程未证，U2）。
- **错误/观测**（按 §1.4）：`projection-not-registered` ⇒ `unsupported`；`projection-source-invalid`（`since`+`asOf` 同给、未登记域、激活不允许）⇒ `rejected_precondition`；库打不开/迁移失败 ⇒ 打开面错误码原样上抛；六态是结论不是错误。
- **测试与证据**：目标 `test/records/projection.test.ts`（R+W）：增量与重建逐字段一致（同一 `records` 集，`since` 增量 vs `asOf` 快照 vs 全量三路结果一致）；`since`+`asOf` 同给 ⇒ `projection-source-invalid`；`factDomains` 含未登记域 ⇒ 同码；`resourceLedger` 在 `MIG-01` 前未注入派生器 ⇒ 抛 `projection-not-registered`，非法名（如 `daemon_kv`）同码；`rows` = 本次处理行数（重建空集为 `0`，不等于「未运行」）、完成时 `cursor === null`；`observation` 不带 `rows`；空集合不冒充缺口。
- **规模**：约 180 行。迁移顺序 M2（建面不接线），M3 建 v15 后接 `records` 输入。

#### F-store-records-hooks · `packages/store/src/records/hooks.ts`（目标新增，预算 ≤150）

- **处置**：**目标-新增**；80-§6.6 规则 7「写入与投影同事务，钩子归 store」的**机制**落点。现状无钩子，`intent_receipts` 一类投影只能提交后再写，存在「记录已 `decided`、表投影仍 `queued`」窗口。钩子**机制**归本件；**具体派生**归注册方（`intent_receipts` 的派生与内存快照归 daemon `IntentReceiptStore`，80-§6.6 规则 5/7/9 原文）。
- **归属**：80-§6.6 规则 5（`get` 读快照、`rebuild` 先表后快照）、规则 7（同事务写表投影 + commit 后同一微任务更新快照）、规则 9（启动顺序）、规则 10（改方案须举证）；80-§6.3 REC-04（事务是 hook 的唯一挂载点）。
- **职责**：三件机制——`HookRegistry`（按**事实域**注册派生钩子，`createRecordPorts` 时一次性冻结）、`runInTx(tx, appended)`（在 `BEGIN…COMMIT` 之间**同步**执行，写投影表）、`afterCommit(fn)`（commit 返回后**同一微任务、无 `await`** 内执行，供持有者更新内存快照）。**非职责**：不自带业务派生规则、不写事实记录、不做长 IO（平台调用/通知一律在事务外）、不重试。
- **内部**（内部类型，不出包）：钩子签名 `(tx: TxHandle, appended: readonly RecordEnvelope<unknown>[]) => void`——只吃**本事务刚追加**的记录，**不重读全表**（保证有界、无 `await`）；注册项绑定事实域（`REC-WORK-01/02`、`REC-EVT-03` 等），事务 scope 外的域不得被顺带触发；`afterCommit` 只在 `status:'committed'` 执行，`aborted`/`unknown` 一律不执行（`unknown` 先由 `receipt(txId)`/对账消解，再由 `refresh`/`rebuild` 修复，**不猜**）。
- **导出/依赖**：`HookRegistry`、`createHookRegistry`、内部 `ProjectionHook` 类型；`./transaction.ts`（调用点）、`../driver.ts`（类型）、`@studio-next/contract`。
- **IO/注入**：无自开 IO；钩子用同一 `db` 句柄、同一事务写投影表；无时钟。
- **状态/事务/并发/恢复**：**钩子抛错 ⇒ 整事务回滚**（投影与记录同生共死，不允许半套）；**崩溃 kill**：提交后、快照更新前被 kill ⇒ 该进程已死，恢复路径只有下次启动的 `rebuild`（先表、后快照）；**不存在**「半更新快照被读到并长期留存」；注册表运行期不得新增（防装配漂移）；禁止改成提交后异步刷新（须按 80-§6.6 规则 10 举证）。
- **错误/观测**（按 §1.4）：钩子内业务校验失败按 `rejected_precondition` 上抛并回滚；未注册投影名 ⇒ `unsupported + projection-not-registered`；**不以日志充当证据**——投影行与记录同事务提交即证据。
- **测试与证据**：目标 `test/records/hooks.test.ts`（R+W）：钩子在事务内被调用、钩子抛错后投影行**不可见**、`abort` 不触发 `afterCommit`、提交后快照在同一微任务内更新（可观测断言）、注册表冻结后新增钩子被拒。`kill -9` 四态注入（提交前 / 提交后快照前 / 投影写后 / rebuild 中途）归端到端卷与 §8.7。
- **规模**：约 140 行。迁移顺序 M2（建机制），M3 由 `intent-receipts`、资源账目与 `rebuild` 接线。

#### F-store-records-transaction · `packages/store/src/records/transaction.ts`（目标新增，预算 ≤160）

- **处置**：**目标-新增**；80-§6.3 `TS-PORT-REC-04` 的唯一落点。**落点按 80-§6.9 从 `src/ledger/` 移到 `src/records/`**（原 `F-store-ledger-transaction` / `ledger/transaction.ts` 作废，不并存）。
- **归属**：80-§6.3（`TxScope`/`TxHandle`/`TxReceipt` 字段全集）、80-§8.2「长 IO 不持写事务」、80-§6.9 落点表。
- **职责**：把现状散落的裸 `db.exec('BEGIN'/'COMMIT'/'ROLLBACK')` 收成一个机制件——`begin(scope): Promise<Result<TxHandle, ClassifiedError>>`、`commit(tx): Promise<Result<TxReceipt, ClassifiedError>>`、`abort(tx, reason): Promise<Result<TxReceipt, ClassifiedError>>`、`receipt(txId): Promise<TxReceipt | undefined>`（80-§6.3 签名，store 内部实现同步、外表面按 80 包 `Promise`）。拒绝嵌套（单层）；`TxScope` 只允许同域多记录；**本事务是投影 hook 的唯一挂载点**（`hooks.ts` 在同一 `BEGIN…COMMIT` 内被调用，见该件）。**非职责**：不是命令入口（80 原文）、不核权、**不做跨事实源事务**（SQLite 事务不得包住 YouTrack 写）、不重试、不判业务状态。
- **内部**（字段照 80-§6.3，不自造）：
  - `TxScope = { company, authorityDomain, partition? }`；`TxScope.authorityDomain` 是**硬约束**：本事务内每条追加的解析域必须与它一致（不等 ⇒ `rejected_precondition + tx-scope-domain-mismatch`），**不得**按「第一个记录」回填 scope；
  - `TxHandle = { txId, scope, writerId, fence?, expectedLineageHead?, openedAt, readOnly: false }`——`fence`/`expectedLineageHead` 由 `src/lease/lease.ts` 的租约表可校验（同进程：`leaseId+fence` 当前代次比对）；**跨进程**仍不支持（78 `BIND-STORE-01`、U2），不得把「同进程可校验」写成「围栏已成」；传入但无租约行 ⇒ `unsupported + fence-unsupported`（fail-closed）；
  - `TxReceipt = { txId, commitSeq?, recordIds, status: 'committed'|'aborted'|'unknown', proofRef? }`，**落 `record_transactions`**（不再落 `daemon_kv`）；
  - **`commitSeq` 在提交该事务的同一单写事务里分配**：`begin` 只写一行 `status='open'`（无 `commitSeq`），`commit` 时在同一事务内取号（该表唯一单调列，`MAX(commitSeq)+1` 或自增列，实现选择；语义是「唯一单调、事务内分配、不得事务外先读后写、不得跨事务预留」）并随事务一起提交，故「有 `commitSeq`」等价「已提交」；
  - **提交证明 = 同事务的 `REC-RCP-01`**：`commit` 在同一事务内经 `./writer.ts` 的私有追加路径写一条 `REC-RCP-01`（`subjectRef` = 本 `txId`，`provenance.derivation='observed'`），`proofRef` 指向它的 `recordId`。**写不出 ⇒ 整个事务回滚**，`status` 不得留 `committed`、`commitSeq` 不得留号——**不存在「已提交但无证明」的窗口**（80-§6.3 原文）；
  - `abort` 写 `status='aborted'`、无 `commitSeq`、无 `proofRef`；**`unknown`**（提交超时/连接异常）保留为一行 `status='unknown'`，不加 `commitSeq`（不知道提交没提交），由 `receipt(txId)` 与 `./recon` 对账消解；
  - `receipt(txId)` **只读 `record_transactions`**，未登记 ⇒ `undefined`；**不从其它表反推**（不扫 `records`、不看 `events`），也不得在缺 `proofRef` 时返回 `committed`。
- **导出/依赖**：`TransactionFace` + `createTransactionFace(db, deps)` + 四类型；`./persistence.ts`（事务账读写）、`./writer.ts`（同事务写 `REC-RCP-01`）、`./hooks.ts`、`../lease/lease.ts`、`../driver.ts`（类型）、`@studio-next/contract`。
- **IO/注入**：SQLite；`openedAt` 由调用方给（本面不取时钟）。`abort` 也写回执（`status:'aborted'`），故 abort 不可「静默」。
- **状态/事务/幂等/并发/恢复**：`begin` 用 `BEGIN IMMEDIATE`（与 `migrations` 同口径，早拿写锁避免升级点 busy）；`busy` 在 `busy_timeout` 内重试是 SQLite 行为，超时后 ⇒ `unavailable` + `STALL` + `db-busy`（**不**归 `CONFIG_INVALID`：这是可用性失败）。**`commit` 超时/连接异常 ⇒ 回执 `status:'unknown'` + `timeout` + `STALL`**，不猜提交与否、不自动重试（重试可能双写）。进程内重入 ⇒ 直接拒（单层）：`rejected_state` + `EXTERNAL_REJECT` + `nested`。**崩溃恢复**：`status='open'` 的行说明进程死在中途——记录可能已提交也可能没有，**保留 `open`，由对账按 `recordIds` 逐条核 `records` 后改判**（全在 ⇒ `committed` 并补证明；全不在 ⇒ `aborted`；部分在 ⇒ 记缺陷并落 `REC-LOSS-01`，不得猜一个 status）。
- **错误/观测**（按 §1.4）：`nested`/`already-closed` ⇒ `rejected_state`+`EXTERNAL_REJECT`；`db-busy`/`commit-timeout` ⇒ `unavailable`（或 `timeout`）+`STALL`；`scope-foreign`/`tx-scope-domain-mismatch` ⇒ `rejected_precondition`+`CONFIG_INVALID`；`fence-unsupported` ⇒ `unsupported`+`EVOLVE_REJECT`；证明写不出 ⇒ `unavailable`+`STALL`+`store/record:proof-unwritable`（整体回滚）。**不写日志**：回执是证据，日志不是。
- **测试与证据**：目标 `test/transaction.test.ts`（R+W）：提交可见/回滚不可见/拒绝嵌套/`abort` 后连接仍可用/跨域 scope 被拒/`commitSeq` 严格单调且只在 `committed` 行出现/每条 `committed` 行的 `proofRef` 指向同事务 `REC-RCP-01`/证明写失败时 `records` 与事务账**都不前进**/`receipt` 消解 `unknown` 与未登记返回 `undefined`/hook 在事务内被调用且回滚后投影行不可见。**不证明**进程崩溃时 `unknown` 的真实分布（需 `kill -9` 注入，归端到端卷）。
- **规模**：约 160 行。迁移顺序 M2（建面不接线），M3 建 v15 后由 `intent-receipts` 的 hook、`syncCompany`、`replaceTodoQueue`、`rebuild` 改用它（行为不变，仅收口）。

#### F-store-records-ports · `packages/store/src/records/ports.ts`（目标新增，预算 ≤140）

- **处置**：**目标-新增**；80-§6.3 `TS-PORT-REC-01/02/03` 的**装配**落点（只组合，不实现）。**落点按 80-§6.9 从 `src/ledger/` 移到 `src/records/`**；原 `F-store-ledger-record-ports` / `ledger/record-ports.ts` 作废，不并存。
- **归属**：80-§6.3（三端口签名与错误三轴）、80-§8.2（只读面同码）、80-§6.9 落点表。
- **职责**：`createRecordPorts(db, deps)` 返回 `RecordPortsFace`，把 `./writer.ts`（REC-01）、`./reader.ts`（REC-02）、`./projection.ts`（REC-03）、`./transaction.ts`（REC-04）、`./correction.ts`（REC-05）合成一个面，并把 `./persistence.ts` 的句柄与 `./reconstruct.ts` 的维护入口挂在同一处。`append`/`get`/`query`/`payload`/`project`/`rebuild` 的**签名、返回形状、错误码逐字照 80**；`get` 与 `query` 均返回 `Promise<Result<…>>`，**`Ok(undefined)` 才表示不存在**；`payload(ref)` 的 `Ok(undefined)` **只**表示该定位无载荷。**非职责**：不新增表、不改 `events` 行形状、不内建业务派生（表投影的行内容由注入的 `Projector` 算）、不判六态语义、不做读写权判定（权源归 77/78 与 daemon，本面只接收已判定过的请求）。
- **内部**：
  - `createRecordPorts(db, deps: { projectors: ReadonlyMap<TargetTableProjectionName, Projector>; hooks: HookRegistry; authority: { requirements: AuthorityRequirementSource; activation: AuthorityActivationPort }; clock? })`；`Projector` 是**内部类型**（`{ name; factDomains: readonly string[]; project(source) }`），不是公共概念、不进 `index.ts` 导出面；`authority` 两项是 **contract 的端口类型（type-only）**，本件只调用、不实现。
  - **装配期校验（fail-closed）**：①每个 `Projector.name` 必须落在 `TargetTableProjectionName` 内；②每个 `Projector.factDomains` 项必须在 `requirements` 里已登记（未登记 ⇒ 装配失败，`rejected_precondition + projection-source-invalid`，**不静默跳过**）；③表投影声明的域须被 `activation` 的当前激活允许；④hook 注册表只在 `createRecordPorts` 时冻结一次。**本件不持有域→表常量表**（D16 关闭）。
  - **投影名封闭**：`ProjectionName = TargetTableProjectionName | 'observation'`，`TargetTableProjectionName = TableProjectionName | 'resourceLedger'`（80-§6.3：现状 17 + 目标第 18）。`resourceLedger` **名字已定**，但表与派生器随 `MIG-01`，未注入即 `projection-not-registered` fail-closed——这是「未实现」，**不是**「名字未定」，也**不是**允许在调用点拼字符串绕过，更不得静默返回空表。`'observation'` 分支**不自算六态**：`state` 由 `TS-PORT-OBS-01` 给定，未注入派生器即按未注册抛错。
  - **`append` 的组合关系**：单条追加自开单层事务（`BEGIN IMMEDIATE`），事务内写 `records`+`record_payloads`+`record_transactions`、调 `hooks.ts` 的派生钩子；`opts` 带 `expectedLineageHead`/`expectedTypeVersion` 时做 CAS（不符 `rejected_version`），带 `writerLease`/`fence` 时走 `../lease/lease.ts` 校验（同进程可校验、**跨进程仍** `unsupported`），`opts.authorityDomain` 的歧义规则由 `writer.ts` 按 `deps.authority` 判。
  - **不吞读失败**：`reader.ts` 的 `Err(unavailable/ledger-read-failed)`、`payload` 的 `Err(payload-not-authorized|payload-unreadable)` 在本面原样上抛，**不得**在本层改写成 `Ok(undefined)` 或空页。
- **导出/依赖**：`RecordPortsFace` + `createRecordPorts` + 内部 `Projector`/`HookRegistry` 类型（后两者不出包）；`./writer.ts`、`./reader.ts`、`./projection.ts`、`./hooks.ts`、`./transaction.ts`、`./correction.ts`、`./persistence.ts`、`./reconstruct.ts`、`../lease/lease.ts`、`@studio-next/contract`。
- **IO/注入**：无自开 IO（吃 `db` 句柄，打开归 `./../ledger/open.ts`）；`clock` 只给回执时间戳，不给业务时间（`recordedTime`/`receivedAt` 一类由调用方给）。
- **状态/事务/并发**：组合面本身无状态；`rebuild` 的整表替换走单事务；hook 注册表与 `projectors` 在 `createRecordPorts` 时一次性冻结（运行期不得新增，避免装配漂移）；schema < v15 时**装配即失败**（`unsupported + envelope-not-storable`），不留「面在、表不在」的半可用状态。
- **错误/观测**（按 §1.4）：读面四码**裸写不叠前缀**——`ledger-query-unsupported`（`unsupported`）、`ledger-cursor-invalid`（`conflict`）、`ledger-query-invalid`（`rejected_precondition`）、`ledger-read-failed`（`unavailable`）；载荷四态 `payload-missing`/`payload-digest-mismatch`/`payload-media-type-mismatch`/`payload-unreadable` 与越权 `payload-not-authorized` 原样透出；`envelope-not-storable`/`projection-not-registered` ⇒ `unsupported`；`projection-source-invalid`/`authority-domain-ambiguous`/`tx-scope-domain-mismatch` ⇒ `rejected_precondition`；同 `recordId` 内容不一致 ⇒ `rejected_idempotency`；`expectedLineageHead`/`expectedTypeVersion` 不符 ⇒ `rejected_version`。**projection 无 Result 通道**：表投影的失败以 `kind`/`state` 结论表达，只有未注册或库打不开才抛 `ClassifiedError`。
- **测试与证据**：目标 `test/records/ports.test.ts`（R+W）：合成面签名与 80 一致（类型层）、`get` 的 `Ok(undefined)` 与 `Err(ledger-read-failed)` 两态可区分、`query` 三轴分别断言（不得合并成一条「参数错」）、`payload` 五态各一例、未注入派生器的 `resourceLedger`（`MIG-01` 前）与非法名抛错、`factDomains` 含未登记域 ⇒ 装配失败、`append` CAS 不符 ⇒ `rejected_version`、hook 未注册时事务提交不写投影表、schema < v15 时装配失败。**现状零测试**。
- **规模**：约 150 行（组合 60 + 类型再导出 30 + 装配校验与冻结 60）。迁移顺序 M2（建面不接线）；生产接线不在本卷范围（归 daemon `assembly`，§3.4）。

#### F-store-records-correction · `packages/store/src/records/correction.ts`（目标新增，预算 ≤130）

- **处置**：**目标-新增**；80-§6.3 `TS-PORT-REC-05`。现状只有追加，没有「修正链」语义（旧记录仍靠 `lineage` 串，但没有 CAS 两个位）。
- **归属**：80-§6.3 REC-05（`CorrectionDraft` 字段与两个 CAS 位）、77-§2.5、77-§1.7 第 4 条。
- **职责**：`propose(c: CorrectionDraft): Promise<Result<RecCorrection, ClassifiedError>>`；`history(recordId: Qid): Promise<readonly RecCorrection[]>`；只追加 `REC-COR-01`，旧记录保留（`originalPreserved` 恒真）。**非职责**：不覆盖旧记录、不追溯授权过去的越权、不删原文、不判修正结论本身。
- **内部**：`CorrectionDraft` 含 `corrects/correctionKind/correctedFields/affectedConclusions/authorityRef/effectiveWindow` + **两个 CAS 位**：`expectedLineageHead`（必填，被修正记录所在链顶端 `recordId`，取自 76 `lineage`，不新造实例代次标量）与 `expectedTypeVersion?`（仅修正语义随类型版本变化时必填）；幂等键 `(corrects, correctionKind, correctedFieldsDigest)`。
- **导出/依赖**：`createCorrectionFace(db)` + `CorrectionFace`；`./writer.ts`（走同一追加路径，不另开写口）、`../ledger/events.ts`、`@studio-next/contract`。
- **IO/注入**：单事务追加；无时钟（`effectiveWindow` 由调用方给）。
- **状态/事务/并发**：两个 CAS 位在同一事务内读取并比较；链顶不符 ⇒ `rejected_version`（先重读链顶再重判，**不得**「改接最新」）；类型版本不符单独判 `rejected_version + type-version-mismatch`，**不得**与链顶不符混为一谈。
- **错误/观测**（按 §1.4）：试图覆盖旧记录 ⇒ `rejected_forbidden`；链顶/类型版本不符 ⇒ `rejected_version`；同幂等键不同内容 ⇒ `rejected_idempotency`；形状缺失 ⇒ `rejected_precondition`。
- **测试与证据**：目标 `test/records/correction.test.ts`（R+W）：只追加且旧记录仍在、链顶 CAS 两向、`type-version-mismatch` 与链顶不符可区分、幂等键重放不产第二行。
- **规模**：约 120 行。迁移顺序 M2（建面不接线）。

#### F-store-records-credentials · `packages/store/src/records/credentials.ts`（目标新增，预算 ≤150）

- **处置**：**目标-新增**；80-§6.2 `TS-PORT-AUTH-06 CredentialCatalogPort` 的**持久适配**。**存储载体在本卷写死**：`REC-AUTH-04` 记录落 **`records`（完整信封）+ `record_payloads`（若有引用材料字节）**，**不新增表、不建第二秘密表、不新增迁移版本**（v15 的三表即载体，见 §4.5 `persistence`）；「按引用摘要幂等登记 / 按 ID 解析两态 / 吊销幂等 + 预期版本」三件事全在本件实现，`apps/daemon/src/assembly/auth/credentials.ts` **只编排**（§3.4）。**不存秘密值**；写走 `./writer.ts`（REC-01）、读走 `./reader.ts`（REC-02）、多记录原子性走 `./transaction.ts`（REC-04），本件不自开写口、不写裸 SQL。17 卷「03 未给定原语则暂用 `Ledger.append`」的旧口径由此取代（本卷不代改他卷）。
- **归属**：80-§6.2 `TS-PORT-AUTH-06`（三方法签名、`CredentialRef` 只含引用侧、错误四态、幂等两条）、77-§3.4（逻辑引用键、按轮换出新版、类别/引用/有效期/吊销状态）、80-§6.3 `REC-AUTH-04`（`RecCredentialRef`，只存引用不存值）、80-§6.9 规则 3/4（持久化与 SQLite 事务落 `store`、编排/装配/IO 落 `daemon`）、80-§11.2.1（值由部署面供给）。
- **职责**（三条，逐条对应 AUTH-06 签名）：
  1. `register(ref: CredentialRefDraft): Promise<Result<Qid, ClassifiedError>>`——按**引用摘要**幂等登记一条 `REC-AUTH-04`，返回其 `recordId`（`Qid`）；同摘要再登记 ⇒ 复用既有行、返回同一 `Qid`（80 签名只回 `Qid`，本件不另造 `deduped` 返回值）。
  2. `resolve(id: Qid, asOf: string): Promise<Result<CredentialRef | undefined, ClassifiedError>>`——按 ID 读取；**`Ok(undefined)` = 未登记，不是拒绝**。`asOf` 由调用方注入（本件不取时钟），`status` 只取 `active | expired | revoked`。**对 `expired`/`revoked` 不返回 `Err`**：过期与吊销是引用状态，不是读失败；`rejected_authority` 的映射在调用方——80-§6.2 的「过期/已吊销 ⇒ `rejected_authority`」说的是**用**这条引用时的结果，不是 `resolve` 抛错。
  3. `revoke(id: Qid, proof: RevocationProof, opts?: { expectedLineageHead?: Qid }): Promise<Result<void, ClassifiedError>>`——追加一条 `status:'revoked'` 的 `REC-AUTH-04`，**原行不动**（append-only）。第三个参数是可选的预期版本位：省略时与 80 的两参签名等价（不新增导出类型、不改 80 的必填形状），传了就做 CAS。
  **非职责**：不取值（值永远来自部署面：env / 密钥库，80-§11.2.1）、不做权源解析与鉴权（归 77/`authority`）、不映射 `rejected_authority`、不判「这一版还能不能用」（调用方与 `assembly/auth/credentials.ts`）、不碰租约与围栏（归 `../lease/lease.ts`）、不做秘密扫描与出站脱敏（80-§11.2、78-§7.4.1）。
- **内部**：
  - **幂等键 = 引用摘要**：`refDigest = sha256(JCS({ refKey, refVersion }))`，JCS 取 `studio-next/jcs@1`（80-§4.5）。**跨实现字节确定性未证**（80 `U80-01` 明写没有仓内向量执行结果），故该摘要**只作同一实现内的幂等键**，不作跨实现可比的公共标识，也不进 `contract` 的公共类型。
  - **`recordId` 由摘要确定性派生**：`qid = <namespace>/<kind>/<local>`（76-§1.3），本件把 `refDigest` 编码进 `local` 段，于是「按摘要幂等」直接复用 `./writer.ts` 的既有 `recordId` 判据（同 id 内容一致 ⇒ `deduped`；同 id 内容不一致 ⇒ `rejected_idempotency`），**不新增幂等表，也不用 `AppendOptions.idempotencyKey`**（该字段的判等语义 80 未定义，§10.2 D19）。
  - **轮换 = 新版本、旧版保留**：`refVersion` 递增 ⇒ `refDigest` 变 ⇒ 新 `recordId` ⇒ 追加新行；旧行仍在、仍可 `resolve`（77-§3.4「按轮换出新版」）。**被新版本取代 ≠ 吊销**：`resolve` 不因存在更高 `refVersion` 就改判 `revoked`，也不扩 `CredentialRef` 形状（不新增 `superseded` 一类状态）。
  - **吊销 = 追加而非改行**：新行 `lineage.supersedes = id`、`status:'revoked'`、`revocationProofRef`（证据 = 引用 + 吊销证明，80-§6.2）；其 `recordId` 由 `(id, sha256(JCS(proof)))` 派生，故同 `(id, proof)` 重放 ⇒ 同 id 同内容 ⇒ `deduped` ⇒ `Ok(undefined)`。**同引用换证明**再吊销 ⇒ 不同 id、语义冲突 ⇒ `rejected_state + store/credential:already-revoked`（不静默追加第二条吊销）。
  - **值入目录闸（形状闸，不是秘密扫描）**：`CredentialRefDraft` 用 zod `strictObject` 解析，出现 `value`/`secret`/`token`/`password`/`privateKey`/`raw` 一类字段名即未知键拒收 ⇒ `rejected_forbidden + store/credential:value-in-catalog`（80-§6.2「检测到值入目录」）。真正的秘密检测归 80-§11.2 / 78-§7.4.1，且 80-D23 明写 `KnownSecretSet.find` **只诊断、不作门禁**，本件**不拿它当拒绝依据**。
- **DDL**：**无新表、无新 DDL、无新迁移版本**——载体是 v15 的 `records`（`REC-AUTH-04` 完整信封）+ `record_payloads`（若有引用材料字节）；不建影子引用表，也不给 `events` 加列（`events` 只是投影，§1.3 第二类）。**v15 之前**（表未建）本件写路径 `unsupported + envelope-not-storable` fail-closed，不做降级。
- **导出/依赖**：`CredentialCatalogFace` + `createCredentialCatalog(db)`（内部行映射不出包；`index.ts` 只再导出面）；`CredentialRefDraft`/`CredentialRef`/`RevocationProof` 从 `@studio-next/contract` **type-only** 引入——端口签名归 `contract`，本件**不重定义**同名类型；依赖 `./writer.ts`、`./reader.ts`、`./transaction.ts`、`@studio-next/contract`。
- **IO 与注入**：SQLite 单连接；`asOf`/`refVersion`/`expiresAt`/`proof` 全由调用方给；**无时钟、无随机、无文件 IO、无网络**；**不读 env、不读密钥库**（取值不属本件）。
- **状态/事务/幂等/并发**：单条登记/吊销 = 一次追加（`./writer.ts` 的 `BEGIN IMMEDIATE` 单层事务）；需要核对链顶时在同一事务内读 `expectedLineageHead` 再追加（`./transaction.ts`），事务内不做长 IO（80-§8.2）。并发同摘要 `register` ⇒ `recordId` 主键兜底，两个调用者拿到同一 `Qid`，不双写；并发同 `(id, proof)` `revoke` ⇒ 同上。`expectedLineageHead` 不符 ⇒ `rejected_version + cas-lineage-mismatch`，**先重读链顶再重判，不自动改接最新**。**崩溃恢复**：append-only，无半行；「已落库但调用方没看到 `Ok`」由重放同一摘要 / 同一 `(id, proof)` 消解，不靠日志。过期**不清扫**：本件不写「过期」状态、不自动吊销，`expired` 只是 `asOf` 与 `expiresAt` 的比较结论。
- **错误/观测**（按 §1.4）：形状/值域不过 ⇒ `rejected_precondition`（`CONFIG_INVALID`）+ `store/credential:invalid`；值入目录 ⇒ `rejected_forbidden`（`EXTERNAL_REJECT`）+ `store/credential:value-in-catalog`；同摘要不同内容 ⇒ `rejected_idempotency`（`EXTERNAL_REJECT`，沿用 writer 判据）；同引用换证明再吊销 ⇒ `rejected_state`（`EXTERNAL_REJECT`）+ `store/credential:already-revoked`；`expectedLineageHead` 不符 ⇒ `rejected_version`（`EVOLVE_REJECT`）+ `cas-lineage-mismatch`；`revoke` 未知引用 ⇒ `unsupported`（`EVOLVE_REJECT`）+ `store/credential:unknown-ref`（80-§6.2「未知引用 `unsupported`」）；D1 已关闭：载体就是 v15 的 `records`；**v15 之前（schema < 15）**写入 ⇒ `unsupported`（`EVOLVE_REJECT`）+ `envelope-not-storable`（fail-closed）；库不可读/不可写 ⇒ `unavailable`（`STALL`）+ `ledger-read-failed`/`db-busy`。**`resolve` 的两态严格分离**：不得把 `Err(ledger-read-failed)` 降级成 `Ok(undefined)`（那会让调用方以为可以新登记，等于放开权源）。
- **测试与证据**：目标 `test/records/credentials.test.ts`（R+W）：登记后 `resolve` 得 `active`；同 `refKey`+`refVersion` 再登记 ⇒ 库内仍一条、返回同一 `Qid`；同 key/version 改内容 ⇒ `rejected_idempotency`；`refVersion+1` ⇒ 新行且旧行仍在、旧行仍可解析；吊销后 `resolve` 得 `revoked`；同 `(id, proof)` 重放 ⇒ `Ok(undefined)` 且零新增；换证明再吊销 ⇒ `rejected_state` 且零新增；`expectedLineageHead` 不符 ⇒ `rejected_version` 且零行；`asOf` 越过 `expiresAt` ⇒ `expired` 而非读失败；草稿出现值域字段 ⇒ `rejected_forbidden` 且零行；未知引用 `revoke` ⇒ `unsupported`；`resolve` 的 `Ok(undefined)` 与 `Err(ledger-read-failed)` 两态可分；返回对象序列化后**无秘密原值**；schema < 15 时写入 ⇒ `unsupported/envelope-not-storable` 且**不退化成裸 `Ledger.append`**。**现状零测试**（本件是目标新增，`REC-AUTH-04` 在 store 内没有任何现状持久实现）。
- **规模**：约 150 行（登记 40 + 解析 30 + 吊销 40 + 摘要与 `qid` 派生 30 + 载荷面适配 10）。迁移顺序 M2（建面不接线）；M3 建 v15 后由 `assembly/auth/credentials.ts` 接线（只编排）。

#### F-store-records-reconstruct · `packages/store/src/records/reconstruct.ts`（目标新增，预算 ≤130）

- **处置**：**目标-新增**；把 v15 之前的 `events` 行**重建**为 `records` 行。这是**迁移维护面**（`openLedgerMaintenance` 窗口内显式调用），不是日常写路径、不自动跑。
- **归属**：80-§4.6（`events` → 记录：`reconstructed` + 实际形成时间 + `limitations`、缺字段不回填、旧摘要 `unknown`）、80-§6.6 MIG-01 过渡段（实现日志不是记录、落地后重建）、76-§8.4 `REC-LOSS-01`、76-§1.8「unknown」。
- **职责**：`reconstructEvents(range, opts): Promise<Result<ReconstructReport, ClassifiedError>>`——按 `events` 游标区间逐行判定并追加：
  - **字段齐全**（能拼出合法信封）⇒ 追加一条 `provenance.derivation='reconstructed'` 的 `records` 行；`observedTime` 取原行**有则取**（原行为 NULL 就不填，不得补一个「看起来合理」的值），`recordedTime`/`storedAt` 取**本次重建时刻**。
  - **缺字段**（`basis`/`scope`/`knowledge`/`provenance`/`lineage` 任一）⇒ **不回填**、不补默认值、不「从别处推断」；该行保留为 `opaque` 投影，并落一条 `REC-LOSS-01`（`dimension:'interoperability'`、`cannotClaim` 写明「不得据此宣称该事实已成记录」）。
  - **旧摘要**：`events.payload_hash` 一类**不得**冒充 `integrity.byteDigest`；原始字节不在库内 ⇒ 信封 `integrity.byteDigest` 标 `unknown` + 落 `REC-LOSS-01`（**不得**删掉 `integrity` 绕过「至少一项摘要」，也不得填占位串）。
  - **`ReconstructReport`**（内部类型）：`scanned`/`reconstructed`/`opaque`/`lossRefs`/`nextCursor`——**不是**公共概念，不进 `index.ts` 导出面。
- **内部**：`recordId` 由原 `events.id` 稳定派生（同一行重放得同一 id），故**幂等**：重建结果由 `records` 主键去重，第二次是 `deduped`，不产第二行；`opts.batch` 控制每批行数（默认给一个小值，由调用方覆盖），一批一个事务，批间不持写事务（80-§8.2「长 IO 不持写事务」）；`opts.dryRun` 只统计不写。
- **导出/依赖**：`reconstructEvents` + `ReconstructReport`（内部类型）；`./persistence.ts`、`./writer.ts`（走同一追加路径，不另开写口）、`../ledger/events.ts`（只读）、`@studio-next/contract`。
- **IO/注入**：读 `events`、写 `records`/`record_payloads`/`record_transactions`；无时钟以外的旁路（重建时刻由调用方给，便于测试钉住「不是当年那一刻」）。
- **状态/事务/并发/恢复**：**中断可续**——已提交批次保留、未提交批次回滚，`nextCursor` 供下次从断点继续；**不自动跑**、不在 `openLedger` 路径里跑；与日常写入并发时靠写事务串行化（跨进程未证，U2）。
- **错误/观测**（按 §1.4）：`range` 非法/`batch` ≤0 ⇒ `rejected_precondition + bad-range`；`records` 表未建 ⇒ `unsupported + envelope-not-storable`；`db-busy` ⇒ `unavailable`；单行形状异常**不中止整批**（记 `opaque` + `REC-LOSS-01` 后继续），但**整批写失败**必须整体回滚，不得留半批。
- **测试与证据**：目标 `test/records/reconstruct.test.ts`（R+W）：字段齐全行重建后逐字段一致（含 `provenance.derivation='reconstructed'`）；缺字段行**不回填**且落 `REC-LOSS-01`（`opaque` 计数 +1，`records` 不增）；旧摘要不在库 ⇒ `unknown` 而非占位串；`recordedTime` = 重建时刻 ≠ `observedTime`（用固定假时钟钉住）；重放两次零新增（幂等）；表未建 ⇒ `unsupported`；`dryRun` 不写任何行。
- **规模**：约 120 行。迁移顺序 M2（建面、不接线；此时调必 `unsupported`），M3 建 v15 后由维护命令显式触发。

#### F-store-recon · `packages/store/src/recon/reconcile.ts`（目标新增，预算 ≤180）

- **处置**：**目标-新增**；80-§6.3 `TS-PORT-REC-06`。落点按 80-§6.9 **单列 `src/recon/`**（不与 `records/` 混）。
- **归属**：80-§6.3 REC-06、77-§2.7/§2.8、80-§8.4 第 4 条；80-§6.6 映射表第 4 条（EVT-03 归属判据）。
- **职责**：`reconcile(scope: ReconcileScope): Promise<Result<RecReconciliationBatch, ClassifiedError>>`；`registerUnknown(u: UnknownDraft): Promise<Result<Qid, ClassifiedError>>`；`resolveUnknown(id, resolution): Promise<Result<RecReconciliationBatch, ClassifiedError>>`；产出 `REC-EVT-02`，未知按 `REC-EVT-03` 登记（含 owner 与 `review_by`）。**非职责**：不判业务结论、不结清（归 `SettlementPort`）、不重算验收（迟到副作用只消解未知）、**不猜关联**。
- **内部**：`ReconcileScope` 含事实域/对象集/时间窗/游标区间；`differenceClasses` 六值、`completenessClaim` 三值（77-§2.7）；幂等键 `(scope, baselineCursor, sourceSet)`。**`registerUnknown.unknownScope.intentRef` 在意图域必填**（指向 `REC-WORK-01.recordId`），缺失 ⇒ `rejected_precondition + unknown-scope-intent-missing`，**不落记录**（不接受「先写未知、回头补链」）；该强制**只在意图域**成立：非意图域未知（平台读侧/监控/导入）按 77 原字段登记、`intentRef` 缺省合法、不进 `intent_receipts` 派生范围、不冻结任何键。
- **导出/依赖**：`createReconciliationFace(db)` + `ReconciliationFace`；`../ledger/events.ts`、`../ledger/work.ts`（只读校验 `REC-WORK-01` 链）、`@studio-next/contract`。
- **IO/注入**：读对账来源 + 写对账/未知记录；来源不可读时**先登记未知**而不是直接抛；无时钟（时间窗由调用方给）。
- **状态/事务/并发**：批次 + 逐项处置在单事务内提交；对账未完成**不得**结清、不得宣称迁移完成；迟到副作用只消解未知、不重算验收。
- **错误/观测**（按 §1.4）：来源不可达 ⇒ `unavailable`（登记未知，不抛）；游标断裂 ⇒ `conflict`；无法判定 ⇒ `unverified`；`unknown-scope-intent-missing` ⇒ `rejected_precondition`。**孤儿未知**（历史无链）由 `REC-OBS-02` 记**覆盖缺口**：只给缺口与覆盖范围，**不提供 `outcome`**、不伪装成已归属的 EVT-03、不猜最近一条。
- **测试与证据**：目标 `test/recon/reconcile.test.ts`（R+W）：缺 `intentRef` 拒且零行、非意图域未知不被拒、孤儿未知只落 `REC-OBS-02` 覆盖缺口、批次幂等、来源不可达时登记未知而非抛错。
- **规模**：约 170 行。迁移顺序 M2（建面不接线）。

#### F-store-lease · `packages/store/src/lease/lease.ts`（目标新增，预算 ≤140）

- **处置**：**目标-新增**；80 `TS-PORT-AUTH-04` 的**持久面**（端口在 `assembly/auth/`，本件只给表的 CAS 原语）。落点按 80-§6.9：`core/src/authority/` + `store/src/lease/` + `assembly/auth/`。
- **归属**：80 `TS-PORT-AUTH-04`（三方法签名、`LeaseGrant`、fence 语义）、77-§3.5/§3.6、`RUN-AUTH-03`、80-§8.5；落账面 `REC-AUTH-05`、围栏观测 `REC-AUTH-06`。
- **职责**：持久化原语 `acquire(scope: LeaseScope, holder: WriterId, ttlMs): Promise<Result<LeaseGrant, ClassifiedError>>`、`renew(leaseId, fence): Promise<Result<LeaseGrant, ClassifiedError>>`、`release(leaseId, fence): Promise<Result<void, ClassifiedError>>`；`LeaseGrant{leaseId, fence, expiresAt}`，`fence` **单调递增、每次 acquire/renew 都换**。**非职责**：不是「泳道租约」（`engine/lanes/registry.ts` 是派发互斥；语义、记录、fence 都不同，**不得合并命名**）；不判业务、不发凭据、不做权源解析。
- **内部**（DDL 只用自然语言，不生成可执行 migration）：表 `writer_leases`，列 `lease_id`（主键）、`scope`（**写者域**：哪张表/哪个事实域，不是单号）、`holder`、`fence`（单调整数）、`expires_at`；索引 `(scope)` 唯一（同一写者域至多一条有效租约）与 `(expires_at)`（过期清扫）。版本：随 `schema_version` 递增一版，迁移由 daemon 独占窗口执行；回退=删表（租约属**运行时状态**、不可由事件重算，删库后为空——与 `jobs.last_run_at` 同类，§1.3 第四类）。
- **导出/依赖**：`createLeaseFace(db)` + `LeaseFace`；`../driver.ts`（类型）、`@studio-next/contract`。
- **IO/注入**：SQLite；**`expiresAt` 由调用方给**（本面不取时钟；`acquire` 的 `ttlMs` 与 `now` 都由 daemon 注入）。
- **状态/事务/并发**：`acquire` 用 `BEGIN IMMEDIATE` + `(scope)` 唯一键 CAS；被占 ⇒ `rejected_state`；**旧 `fence` 的 `renew`/`release`/记录写** ⇒ `rejected_version`（存储端比对当前代次后拒绝）；`release` 幂等；租约过期「视同无主」只在**同进程**可接受，**跨进程无互认围栏** ⇒ `unsupported`（78 `BIND-STORE-01`、U2）。
- **错误/观测**（按 §1.4）：被占 ⇒ `rejected_state`；fence 过期/落后 ⇒ `rejected_version`；跨进程围栏 ⇒ `unsupported`；`db-busy` ⇒ `unavailable`。
- **测试与证据**：目标 `test/lease/lease.test.ts`（R+W）：双 `acquire` 只一个成功、fence 每次换、旧 fence 的 `renew`/写被拒、`release` 幂等、过期后可再取。**不证明**跨进程互认（需双进程注入，归端到端卷）。
- **规模**：约 130 行。迁移顺序 M2（建表 + 原语），M3 由 `records/writer` 校验 fence。

#### F-store-memory-entries · `packages/store/src/memory/entries.ts`（目标新增，预算 ≤140）

- **处置**：**目标新增**；80 `TS-PORT-MEM-01 MemoryStore` 的**记录侧**（策略归 `engine/memory/`，落点按 80-§6.9）。现状无记忆存储——提示词组装只读公司目录。
- **归属**：80 `TS-PORT-MEM-01`、`REC-MEM-01`/`REC-MEM-03`（77-§8.2/§8.4.1）、`RUN-MEM-01`。
- **职责**：`write(entry: RecMemoryEntry): Promise<Result<Qid, ClassifiedError>>`（落 `REC-MEM-01`）、`dispose(d: RecMemoryDisposition): Promise<Result<void, ClassifiedError>>`（落 `REC-MEM-03`）；**四层（个人/出工/岗位/组织）不合并**，`layer` 必填、跨层读一律拒。**非职责**：不判「该不该记」（策略归 `engine/memory/`）、不删原文、不代接收方确认继承/转层。
- **内部**：写按 `(layer, subject, sourceRef)` 幂等（同键不同内容 ⇒ `rejected_idempotency`）；处置五操作 `修正/清除/继承/转层/封存`（77-§8.4.1）按 `dispositionId` 幂等；`继承`/`转层` 必须带接收确认（技术校验不替代接受），并写 `residue_statement`（原始来源与外部副本可能仍存在）。**不得**与结清的「记忆三路分流」混成一个枚举——那是结清判据的核对视角。
- **导出/依赖**：`createMemoryEntries(db)` + `MemoryEntriesFace`；`../ledger/events.ts`、`@studio-next/contract`。
- **IO/注入**：单事务追加；无时钟（`effectiveAt` 由调用方给）。
- **状态/事务/并发**：append-only（无 UPDATE/DELETE 代码路径）；处置只追加、原文保留；并发同幂等键由主键/唯一键兜底。
- **错误/观测**（按 §1.4）：越层读写 ⇒ `rejected_forbidden`；无访问理由 ⇒ `rejected_precondition`；同幂等键不同内容 ⇒ `rejected_idempotency`；继承/转层缺接收确认或缺 `residue_statement` ⇒ `rejected_precondition`。
- **测试与证据**：目标 `test/memory/entries.test.ts`（R+W）：四层分离（跨层读负向）、写幂等、五操作不删原文、继承/转层缺确认被拒、`residue_statement` 必填。
- **规模**：约 130 行。迁移顺序 M2（建面不接线）。

#### F-store-memory-access · `packages/store/src/memory/access.ts`（目标新增，预算 ≤90）

- **处置**：**目标新增**；80 `TS-PORT-MEM-01` 的**读路径留痕**（`REC-MEM-02`）。80 原文：「每次读产出 `REC-MEM-02`」。
- **归属**：80 `TS-PORT-MEM-01`（读也必须带访问理由）、77-§8.3。
- **职责**：`record(access: AccessContext & { subjectRef, layer, purpose })` 落 `REC-MEM-02`；**每次读都必须留痕**，无访问理由的读在 `entries.ts` 前置即被拒（本件不兜底放行）。**非职责**：不做读过滤（可见性在 `entries.ts`）、不做审计聚合（归 78 审计面）。
- **内部**：`AccessContext` 含「谁、为何、用到哪」三要素；`REC-MEM-02` 只追加；与读取**同一事务**提交；**被拒的越层读同样留痕**（理由记拒绝码），「批量读只记一条」即缺陷。
- **导出/依赖**：`createMemoryAccess(db)` + `MemoryAccessFace`；`../ledger/events.ts`、`@studio-next/contract`。
- **IO/注入**：只追加；无时钟（`at` 由调用方给）。
- **状态/事务/并发**：append-only；并发只追加、不冲突。
- **错误/观测**（按 §1.4）：缺理由或缺「用到哪」⇒ `rejected_precondition`；越层 ⇒ `rejected_forbidden`（**仍留痕**）。
- **测试与证据**：目标 `test/memory/access.test.ts`（R+W）：每次读恰一条、被拒读也留痕、三要素缺失被拒、只追加。
- **规模**：约 80 行。迁移顺序 M2（建面不接线）。

#### F-store-resources-ledger · `packages/store/src/resources/ledger.ts`（目标新增，预算 ≤160）

- **处置**：**目标新增**；80 `TS-PORT-RES-01` 的资源账目投影：**投影名 `resourceLedger`、物理表 `resource_ledger`**。80-§6.3 已把它登记为**目标第 18 个投影名**（`TargetTableProjectionName = TableProjectionName | 'resourceLedger'`），80-§6.4 明写由「store 拥有的资源账目同事务 projection hook」维护。**实现未落**：表与 hook 随 `MIG-01`（落点 `store/src/migrations/` + `assembly/migrate/assemble.ts`）落地；落地前 store 不声称该投影可用（§10.2 D18 已关闭，残余只是「未实现」）。
- **归属**：80 `TS-PORT-RES-01`（`ResourceBaseline`/`ResourceEntry`/`ResourceGap` 字段全集）、80-§6.3 第 18 个投影名、77-§4.4.1、77-§4.5.1（`REC-WORK-05.resource_reservations` 已存在）、77-§6.8（结清资源项）、80-§6.9 落点。
- **职责**：维护投影名 `resourceLedger`（物理表 `resource_ledger`）的**逐资源行**（同一 `subjectRef` 下按 `resourceRef` 分项），字段照 `ResourceEntry`：`subjectRef`、`quotaRef`、`resourceRef`、`unit`、`limit`（三态 `finite|unbounded|unknown`）、`reserved?`、`consumed?`、`remaining?`（**缺省 = 未知，不是 0**）。**非职责**：**不是第二事实源**——事实只在 `REC-WORK-05.resource_reservations`（预留）、`REC-EVD-01`/`05`（实际）、`REC-EVD-06`（释放）；**无公共写口**（无 `reserve`/`actual`/`release`，80 原文「不新增写入者、不新增 `REC-*`」）；不判资源门（五门读 `baseline()`，不在本件）。
- **内部**（DDL 只用自然语言）：**物理表** `resource_ledger`（对外**投影名** `resourceLedger`；两者是两件事，不得用表名冒充投影名，反之亦然），主键 `(subject_ref, quota_ref, resource_ref)`；列同上述字段 + `as_of`、`source_cursor`（重建用）；索引 `(subject_ref)`、`(as_of)`。版本随 `schema_version` 递增一版（`MIG-01` 建表），由 daemon 独占窗口迁移；回退=删表，再由 `rebuild` 从 `REC-WORK-05`/`REC-EVD-01`/`05`/`06` 全量重放（**可重建**是本表硬要求）。
- **导出/依赖**：`createResourceLedger(db)` + 只读 `rows(subjectRef)`/`gaps(subjectRef)`；`../driver.ts`、`@studio-next/contract`。
- **IO/注入**：只被 `./hook.ts` 在**记录事务内**写；对外只读，无时钟（`as_of` 取记录时间）。
- **状态/事务/并发**：整表可重建；`limit.kind='unknown'` 时 `remaining` 必须缺省（**不得**渲染成「无限」或「剩余=全部」）；`remaining` 只在三值齐备且 `limit.amount − reserved − consumed` 成立时给出；缺预留/缺实际**必须在 `gaps` 里给码**（`reservation-record-missing` / `unreconciled-actual`），不得据缺值判充足。
- **错误/观测**（按 §1.4）：`MIG-01` 前表与派生器未落，`projection.ts` 对该名抛 `projection-not-registered`（`unsupported`）——这是**未实现**，不是「名字未定」（`resourceLedger` 已登记为第 18 个）；本件对外只读方法直接返回行，读失败由调用方包 `Result`（`unavailable`）；**缺口是结论不是异常**（`gaps` 非空仍 `Ok`）。
- **测试与证据**：目标 `test/resources/ledger.test.ts`（R+W）：逐资源分项、三态 `limit`、缺省未知不渲染 0、删表重建逐字段一致、`remaining` 等式只在三值齐备时校验、无公共写口（类型层断言）。
- **规模**：约 150 行。迁移顺序 M2（建面不接线：只读查询骨架），建表随 80 `MIG-01`（不占用 03 的 v14 批），M3 接 hook。

#### F-store-resources-hook · `packages/store/src/resources/hook.ts`（目标新增，预算 ≤130）

- **处置**：**目标新增**；80 `TS-PORT-RES-01` 的**同事务投影 hook** 实现，注册到 `records/hooks.ts` 的注册表上。
- **归属**：80 `TS-PORT-RES-01`（资源事实落点、缺口四码、「失败不影响记录事实，由 `rebuild` 修复」）、77-§4.5.1（计划锁写预留）、§6.8（结清资源项）。
- **职责**：在**三处记录事务内**派生投影名 `resourceLedger`（物理表 `resource_ledger`）的行：① 计划锁写 `REC-WORK-05.resource_reservations` 时写 `reserved`；② 收割写 `REC-EVD-01`/`EVD-05` 时累计 `consumed`；③ 结清写 `REC-EVD-06` 时落释放/最终占用。**非职责**：不写记录本身、不解析额度定义（额度来自 `quotaRef` 指向的定义）、不判五门、不提供公共写口。
- **内部**：钩子吃本事务刚追加的记录信封，按 `resource_ref/amount/unit/period/quota_ref` 更新物理表 `resource_ledger` 中投影名 `resourceLedger` 对应的行；**同记录重放不翻倍**（以追加的 `recordId` 集合与 `source_cursor` 去重）；派生失败不新增事实、不留半行。
- **导出/依赖**：`createResourceHook(deps)` 返回注册项；`./ledger.ts`、`../records/hooks.ts`、`../ledger/work.ts`/`../ledger/events.ts`（只读类型）、`@studio-next/contract`。
- **IO/注入**：同事务写投影表；无时钟（`as_of` 取记录时间）。
- **状态/事务/并发/恢复**：只增/改投影行、不碰事实；**投影名不可用（`MIG-01` 前表/hook 未落）或库不可写 ⇒ 按 `hooks.ts` 规则回滚整事务**（fail-closed），**派生数值本身不可解析 ⇒ 记 `ResourceGap` 并由 `rebuild` 修复**——两者不混：前者是载体缺失（不得写半套），后者是内容缺口（记录事实不受影响）；崩溃 kill ⇒ 下次启动 `rebuild` 恢复；跨进程并发替换未证（U2）。
- **错误/观测**（按 §1.4）：`projection-not-registered` ⇒ `unsupported`（回滚）；`unreconciled-actual`/`reservation-record-missing` ⇒ 记为 `gaps`（不抛）；库故障 ⇒ `unavailable`。
- **测试与证据**：目标 `test/resources/hook.test.ts`（R+W）：三处事务各产对应行、同记录重放不翻倍、缺口路径下记录仍在且缺口可见、删表后 `rebuild` 恢复一致。
- **规模**：约 120 行。迁移顺序 M2（建 hook 形状），M3 随计划锁/收割/结清接线。

### 4.6 独立面（5 件）

#### F-store-probes · `packages/store/src/probes.ts`（123 行）

- **处置**：目标-保留；仅改 `AppendResult` 来源（`:13` → `./ledger/shared.ts`），破 `ledger↔probes` 类型环。
- **归属**：77、132-C（BC-S2 拆分件，「原样拆出零行为变更」）。
- **职责**：`appendProbeRun`（同 id 幂等 + append-only 触发器兜底）、`getProbeRun`、`listProbeRuns`（executor/probe_id/since/until）。**非职责**：不跑探针、不判 pass 语义。
- **内部**：`rowToProbeRun`（`pass` 取 `Number(...)===1`）、`sameProbeRun` 全列比。
- **导出/依赖**：`createProbesFace`、`ProbeRunQuery`、`ProbesFace`；`../records.ts`、`../row-helpers.ts`、`./ledger/shared.ts`（目标）。
- **错误**（按 §1.4）：`store/probe-run:invalid` ⇒ `rejected_precondition`+`CONFIG_INVALID`；`store/probe-run:duplicate-id`（同 id 不同内容）⇒ `rejected_idempotency`+`EXTERNAL_REJECT`；append-only 触发器拒改删 ⇒ `rejected_forbidden`+`EXTERNAL_REJECT`。
- **测试**：`test/v6-reports.test.ts`（触发器拦改删、幂等）。
- **规模**：123 行，预算 ≤160。

#### F-store-hr-sync-queue · `packages/store/src/hr-sync-queue.ts`（198 行）

- **处置**：目标-保留。
- **归属**：DEV-48、52-§9.2/§11、52-§5.2（`people.status` 归人事流）。
- **职责**：`enqueueHrSync`（**任意态**同 `op_key` 命中即跳过）、`listHrSyncPending`、`claimHrSync`/`completeHrSync`（乐观锁）、`failHrSync`（未达限回 pending、达限 failed 终态）、`releaseHrSyncFailed`、`resetStaleHrSyncApplying`（断电复位）、`hrSyncQueueStats`、`setPersonStatus`。**非职责**：不自动开单、不判「该不该重跑」（执行器目标态收敛）、不做跨平台写。
- **内部**：状态机 `pending→applying→done|failed`；`op_key` 只有**非唯一**索引（`migrations.ts:388`）；`setPersonStatus` 是 `people.status` 唯一写面（`syncCompany` 不碰该列）。
- **导出/依赖**：`createHrSyncQueue`、`HrSyncQueueFace`；`../records.ts`、`../row-helpers.ts`。
- **IO/并发**：单语句流转 + `WHERE status = ?` 乐观锁；`resetStaleHrSyncApplying(beforeTs)` 是时间窗复位，**无租约**，两个 daemon 会互相复位（跨进程未证）。
- **错误**（按 §1.4）：`store/hr-sync:invalid|bad-limit|bad-retry-limit|payload-not-serializable|no-such-task` ⇒ `rejected_precondition`+`CONFIG_INVALID`；**`store/hr-sync:not-applying`（`:156`，`failHrSync` 只收 applying 的失败记账）⇒ `rejected_state`+`EXTERNAL_REJECT`**（现状是 `configInvalid`，M5 同批改断言）；`claimHrSync`/`completeHrSync` 期望态不符**不抛错**、返回 `false`（乐观锁 0 行），语义与 `transitionCandidate` 同——端口层需要"必须成功"时再映射成 `rejected_version`。`resetStaleHrSyncApplying` 的**并发互踩**不产出错误（按时间窗复位，重复复位幂等无害）——但**这不是安全保证**，见 §十 U4。
- **测试**：`test/v7-hr-sync.test.ts`（全流转 + 复位窗 + 统计）。
- **规模**：198 行，预算 ≤260。

#### F-store-pricing · `packages/store/src/pricing.ts`（314 行）

- **处置**：目标-保留（含一个 type-only 环，见 §10.1 类型环行）。
- **归属**：132-§6.2、132-§8 S7（唯一写口）、制作人 2026-10-22 双轨令。
- **职责**：`appendPriceSnapshot`（唯一写面：形状闸、双轨互斥、单据幂等、`version=MAX+1`、`published_at` 取注入时钟）、`listPriceSnapshots`。**非职责**：不验证调用方身份（`source_ticket` 必填是唯一锚）、不算价、不做现金流对账。
- **内部**：`PRICE_BILLING_TRACK_VALUES`/`PRICE_SLOT_VALUES`（**复制**自 contract/core，漂移由 `test/v9-pricing` 钉死）；`isCalendarDate`；`PriceSnapshotAppendSchema`（`superRefine` 双轨互斥）；`createPricingFace(db, now)`。
- **导出/依赖**：2 值域 + 4 类型 + `createPricingFace`；`node:sqlite`、`zod`、`@studio-next/contract`（`UlidSchema`）、`../row-helpers.ts`、`../migrations.ts`（**type-only** `Migration`）。
- **IO/并发**：时钟经 `now` 注入（立面传 `() => Date.now()`）；`MAX(version)+1` 在单写者下无竞态，库侧双 UNIQUE 兜底（`migrations.ts:485-486`）。
- **错误**（按 §1.4，名称以代码为准）：`store/price-snapshot:invalid`（`:224`）⇒ `rejected_precondition`+`CONFIG_INVALID`；`store/price-snapshot:ticket-conflict`（`:237`，同 `source_ticket` 二次发布）⇒ `rejected_idempotency`+`EXTERNAL_REJECT`。（旧稿写的 `store/price:invalid|duplicate-ticket` 是简写，实际 subcause 是 `price-snapshot` 前缀。）
- **测试**：`test/v9-pricing.test.ts`（触发器、版本号、双轨、幂等、值域一致性）。
- **规模**：314 行，预算 ≤380。

#### F-store-usage · `packages/store/src/usage.ts`（262 行）

- **处置**：目标-保留。
- **归属**：132-§6.1、C8 投影纪律（可全量重算）。
- **职责**：`upsertUsageDaily`（并格：四桶累加、`runs_count++`、`first_ts=MIN`、`last_ts=MAX`、沿用原行 id）、`replaceUsageDaily`（按公司整组替换，单事务）、`listUsageDaily`（四过滤）。**非职责**：不折日（调用方按 `ended_at` 本地日折）、不做成本计算（归 `cost.ts`）。
- **内部**：`USAGE_DATE_RE` + 真日历日 `isCalendarDate`；`TokenDeltaSchema`（int 非负）；`UsageDailySchema`（`UlidSchema`）。
- **导出/依赖**：`createUsageFace` + 4 类型；`node:sqlite`、`zod`、`@studio-next/contract`、`../row-helpers.ts`。
- **IO/并发**：`replaceUsageDaily` 单事务 DELETE+INSERT；`upsert` 单语句 `ON CONFLICT DO UPDATE`。
- **错误**（按 §1.4）：`store/usage-daily:invalid`（`:213`/`:216`/`:231`；含**跨公司**整组替换的 `company` 不一致，现状就折在 `invalid` 里，不另立 subcause）⇒ `rejected_precondition`+`CONFIG_INVALID`。**日期列只校验真日历日形态**（`USAGE_DATE_RE` + `isCalendarDate`），**不折日、不读宿主时区**——折日归调用方（80-§4.1；`localDateKey` 宿主时区版只作旧记录过渡）。
- **测试**：`test/v11-usage.test.ts`（并格/分格/替换原子/坏形状）。
- **规模**：262 行，预算 ≤320。

#### F-store-cost · `packages/store/src/cost.ts`（296 行）

- **处置**：目标-保留。
- **归属**：132-§6.3（S2 首冻、S3 迟到补账）、C5 append-only。
- **职责**：导出 v12 迁移条目 `costDailyMigration`；`createCostDailyFace`：`appendCostDaily`（final 首冻 / adjustment 负 delta 挂同格 final）、`listCostDaily`、`listClosedCostDates`。**非职责**：不做收口工序（归 daemon cost-close）、不算真值（格真值=Σ final+adjustments 由读方算）。
- **内部**：`COST_KIND_VALUES`/`COST_BASIS_VALUES`；`CostDailyAppendSchema`；final 非负闸 + 同格重复收口前置拒（库侧 partial UNIQUE 兜底）；adjustment 的 `adjusts_id` 必填 + 同格一致闸。
- **导出/依赖**：`costDailyMigration`、2 值域 + 4 类型 + 工厂；`node:sqlite`、`zod`、`@studio-next/contract`、`../row-helpers.ts`、`../migrations.ts`（**type-only**）。
- **IO/并发**：无时钟（`closed_at` 由调用方给）；append-only 由触发器保证。
- **错误**（按 §1.4）：`store/cost-daily:invalid`（`:198`/`:201`/`:207`/`:214`/`:220`/`:228`/`:287`）⇒ `rejected_precondition`+`CONFIG_INVALID`；`store/cost-daily:final-exists`（`:208`，同格重复收口）⇒ **`rejected_state`+`EXTERNAL_REJECT`**（已首冻是状态事实，不是配置错；现状是 `configInvalid`，M5 同批改断言）。
- **测试**：`test/v12-cost.test.ts`（双层拒绝、触发器、adjustment 流、日期扫描）。
- **规模**：296 行，预算 ≤360。

### 4.7 聚合与维护（3 件）

#### F-store-perf · `packages/store/src/perf.ts`（218 行）

- **处置**：目标-保留（不动）。
- **归属**：F2-08（口径版本化 `perf/v1`）、130-P4 批示⑥。
- **职责**：五指标纯函数聚合（闸过率、打回、时延分位、证据完备度、工时/成本/tokens）+ 归属律。**非职责**：零写入、零时钟、不读库（输入由调用方查好传入）、不渲染。
- **内部**：`UNATTRIBUTED_PERSON='(unattributed)'`；`perfPersonRows(input)`；`rejectionCount`/`harvestHits`/`gateRate`/`reportRate`/`perfPercentile`（nearest-rank）；归属=单→最近 `work_record` 的人，跨窗参与判定。
- **导出/依赖**：1 常量 + 4 类型 + 6 函数；`@studio-next/contract`（`EventRecord` 类型）、`../records.ts`（`WorkRecord` 类型）。
- **IO/并发**：N/A（纯函数）。
- **错误**：不抛错；零分母回 `null`（如实），不猜 0。
- **测试**：`test/perf.test.ts`（逐指标 + 边界 + 归属 + 行序 + `perf-weekly` 往返）。
- **规模**：218 行，预算 ≤280。

#### F-store-rebuild · `packages/store/src/rebuild.ts`（63 行）

- **处置**：目标-保留；两处修正（事务端口 + 禁取 `db`）。
- **归属**：F2-12（全量再生）、80-§8.2 D12-2（维护写面，须离线窗口）。
- **职责**：JSONL → 目标库单事务重放，坏行带 1 起行号并整体回滚。**非职责**：不产出 JSONL（归 `dumpEvents`）、不删旧库、不做 `--from yt,org` 双源（`index.ts:48` TODO 明列未实现）。
- **内部**：`readFileSync` → **`openLedgerMaintenance(target)`**（目标：维护写面入口，迁移语义确定；现状是 `openLedger`）→ 取 `ledger.db`（**这是唯一仍在用 `db` 逃逸面的维护路径**，M2 后改走 `RecordTransaction`）→ `BEGIN IMMEDIATE` → 逐行 `appendEvent` → `COMMIT`；错误路径先 `ROLLBACK` 再 `ledger.close()` 再抛；返回 `{ events, version }`。
- **导出/依赖**：`rebuild`、`RebuildResult`；`node:fs`、`@studio-next/contract`、`./ledger.ts`。
- **IO/并发**：同步读整个文件（大库内存占用=文件大小，**未证**上限，§十 U7）；目标库若被 daemon 打开，`BEGIN IMMEDIATE` 会撞 `busy` ⇒ **`unavailable`+`STALL`+`store/rebuild:db-busy`**（现状是原生错透传）。重建的**版本断言**用 `LATEST_VERSION`，不用写死的数字（否则每次加 DDL 都要改测试与实现两处）。
- **错误**（按 §1.4）：`store/rebuild:bad-line`（JSON 坏 / 被 `assertRecord` 拒，消息带 1 起行号）⇒ `rejected_precondition`+`CONFIG_INVALID`+`store/rebuild:bad-line`（输入文件不自洽，fail-closed 整批回滚）；`store/rebuild:db-busy` ⇒ `unavailable`+`STALL`。**不产出** `REC-MIG-01`（D7）。
- **测试**：`test/rebuild.test.ts`（重放/坏 JSON/坏记录/原地重建）。E 类：真文件 + 删库。
- **规模**：63 行，预算 ≤90。

#### F-store-drill · `packages/store/src/drill.ts`（216 行）

- **处置**：目标-保留（维护写面）；`spawnSync` 段外迁（§九）。
- **归属**：F2-12、16-§四 v0.2 验收「删库重建演习一次通过」。
- **职责**：一次可重现演习全链——防呆（路径必须不存在）→ 26 条确定性语料 → dump → 删三件（db/-wal/-shm）→ rebuild → 四检查（删库到位/计数/逐条/schema 版本）→ 人读报告。**非职责**：不调度（季度 cron 岗未落）、不删真实库、不做性能压测。
- **内部**：`syntheticUlid(ts, seq)`（时间位=ts、随机位=序号，**无 crypto**，可重现）；`drillCorpus()` 覆盖前缀族/四桶/可选字段满配；`dropDatabase`；`firstMismatch`（JSON 深比）；`runLedgerDrill`（async，tmp 目录 finally 清理）；`renderDrillReport`（末行 `演习 PASS/FAIL` 是冻结结论行）。
- **导出/依赖**：`runLedgerDrill`、`renderDrillReport`、`DrillCheck`、`DrillReport`；`node:fs`/`node:fs/promises`/`node:os`/`node:path`、`@studio-next/contract`、`./ledger.ts`、`./rebuild.ts`。
- **IO/并发**：真删文件（**破坏性**）；两处打开（`:149`/`:164`）目标都走 **`openLedgerMaintenance`**（演习本身就是离线窗口，符合 80-§8.2 的维护面语义）；`tmpdir` 用后即删。
- **错误**（按 §1.4）：`store/drill:target-exists`（防误删）⇒ `rejected_precondition`+`CONFIG_INVALID`；rebuild 的 `bad-line` 与 `db-busy` 原样透传（分别是 `CONFIG_INVALID` 与 `STALL`）。
- **测试**：`test/drill.test.ts`（进程内 PASS、已存在拒演、CLI 冒烟）。**不证明**真实灾难恢复时延与磁盘故障语义。
- **规模**：216 行，预算 ≤260。

---

## 五、拆分落点与行数预算

### 5.1 `src/ledger.ts`（1683 → 12 件 + facade）

| 现有行段 | 内容 | 目标文件 | 预算 |
|---|---|---|---|
| `:155-226` | 8 个公共类型 | 分到 `events`/`budget`/`hr`/`candidates`/`reports` + `shared`(`AppendResult`) | — |
| `:227-357` | `Ledger` 接口（**目标：在此声明**） | `ledger/open.ts` | 计入 open ≤150 |
| `:361-512` + `:1660-1681` | canonical/JSON/错误文本/`sameEvent` | `ledger/shared.ts` | ≤70 |
| `:517-596` | events 三方法 | `ledger/events.ts` | ≤160 |
| `:597-719` + `:1225-1252` | work/sessions/endWork | `ledger/work.ts` | ≤190 |
| `:720-742`、`:759-811`、`:834-1003` | people/dept/ticket/todo 镜像 | `ledger/company.ts` | ≤320 |
| `:812-833` + `:1004-1057` | budgets | `ledger/budget.ts` | ≤100 |
| `:743-758` + `:1058-1102` | personnel_events + 时间线 | `ledger/hr.ts` | ≤80 |
| `:1103-1205` | jobs | `ledger/jobs.ts` | ≤120 |
| `:1206-1224` | kv（**兼作事务回执与 `commitSeq` 载体**） | `ledger/kv.ts` | ≤40 |
| `:1253-1433` | candidates | `ledger/candidates.ts` | ≤220 |
| `:1434-1570` | ledgers/reports | `ledger/reports.ts` | ≤180 |
| `:1584-1656` | 组装对象（**现状 15 个面工厂**摊入；新增 `records/recon/lease/memory/resources` 面工厂按 §4.5 同名工厂装配，不并入 `Ledger` 交集） | `ledger/open.ts` | 计入 open ≤150 |
| `:513-515` | `openLedger` 头（+ 三个 opener 与 `migrateIfOwner`） | `ledger/open.ts` | ≤150 |
| 新增（v14 表） | `intent_receipts` 持久化原语 | `ledger/intent-receipts.ts` | ≤140 |
| 新增（80-§6.3） | REC-04 事务 / REC-01-03 装配 | **不在本表**：落 `records/transaction.ts`、`records/ports.ts`（§4.5、§5.4） | 见 §5.4 预算 |
| — | 再导出层 | `ledger.ts`（facade） | ≤70 |

〔结论〕拆后 `src/ledger` **12 件**（9 表族 + `shared` + `open` + `intent-receipts`）≤25；单件最大 `company.ts` ≤320 ≤600；`ledger.ts` ≤70 ≤600 → **基线条目 `packages/store/src/ledger.ts: 1684` 可除名**（下降，不需提案）。**注意**：`open.ts` 之所以能吃下 150 行，是因为它只做「组装 + 三个开库闸」，不含任何表业务；一旦业务逻辑回流即触 §六 第 4 条。

### 5.1b `src/migrations.ts`（600 → 14 件 + facade，**必做**）

| 现有行段 | 内容 | 目标文件 | 预算 |
|---|---|---|---|
| `:21-42`、`:543-600` | `Migration` 类型、14 条版本条目拼装、`LATEST_VERSION`、`sha8`/`digest`、`migrate`、`currentVersion` | `migrations/index.ts` | ≤110 |
| `:44-101` 的 events 段 | v1 `events` + 两索引 | `migrations/events.ts` | ≤130 |
| `:44-101` 的 work/sessions 段、`:404-423`（v8）、`:536-540`（v13） | v1 `work_records`/`sessions`、v8 `model`、v13 `executor_session_id` | `migrations/work.ts` | ≤130 |
| v2 people/departments/ticket_mirror 段、v9 `todo_queue` + `assignee`、v4 `daemon_kv` | 组织镜像 + 待办投影 + 运行时键值 | `migrations/company.ts` | ≤150 |
| v2 `budgets` 段 | 预算表 | `migrations/budget.ts` | ≤130 |
| v2 `personnel_events` 段、v7 `hr_sync_log` | 人事 | `migrations/hr.ts` | ≤130 |
| v3 `jobs` | 调度 | `migrations/jobs.ts` | ≤130 |
| v5 `candidates` | 演化 | `migrations/candidates.ts` | ≤130 |
| v6 `ledgers`/`reports`/`probes_runs` | 报表 | `migrations/reports.ts` | ≤130 |
| v10 `price_snapshots` + 触发器 | 定价 | `migrations/pricing.ts` | ≤130 |
| v11 `usage_daily` | 用量 | `migrations/usage.ts` | ≤130 |
| v12（`cost.ts` 的 `costDailyMigration`） | 成本账面 | `migrations/cost.ts` | ≤40 |
| 新增 v14 | `intent_receipts` + `schema_version.digest` | `migrations/intent.ts` | ≤130 |
| 新增 v15 | `records` + `record_payloads` + `record_transactions` + 三个 append-only 触发器 + 索引 | `migrations/records.ts` | ≤150 |
| — | `migrations.ts`（facade 再导出） | `migrations.ts` | ≤40 |

〔结论〕14 件 + facade，单件 ≤150，`migrations/index.ts` ≤110；**逐字节约束按版本**：把拆分前 13 条版本各自的 `sql` `sha256` 存为夹具（v14、v15 各再加一条），拆分后**每版本拼装结果**与夹具相等，且 `MIGRATIONS` 整体拼接字节相等（§十 U10/U11），断言进 `test/ledger.test.ts`。行段号只是大致边界——**逐字节相等是唯一验收标准**，段号允许因文件头注微调。**同一版本跨多文件是常态**（v1 → `events`+`work`；v2 → `company`+`hr`+`budget`），拼装顺序在 `index.ts` 显式写死，不靠 import 顺序。

### 5.2 `src/records.ts`（606 → 7 件 + facade）

| 现有行段 | 目标文件 | 预算 |
|---|---|---|
| `:34-71`、`:179-244`、`:346-366` | `records/work.ts` | ≤160 |
| `:72-89`、`:105-133`、`:245-260`、`:273-299` | `records/company.ts` | ≤140 |
| `:90-104`、`:261-272`、`:527-554`、`:587-604` | `records/hr.ts` | ≤120 |
| `:134-148`、`:300-322` | `records/budget.ts` | ≤50 |
| `:149-178`、`:323-345` | `records/jobs.ts` | ≤60 |
| `:367-430` | `records/candidates.ts` | ≤80 |
| `:431-526` | `records/reports.ts` | ≤120 |
| `:605-606` | `records.ts`（facade 转发 `todo-queue-records`） | ≤40 |

〔结论〕本表拆出 `src/records` **7 个形状件** ≤25；`records.ts` ≤40 → **基线条目 `packages/store/src/records.ts: 606` 可除名**。〔注〕`records/` 目录另有 **7 个记录面**（`writer`/`reader`/`projection`/`hooks`/`transaction`/`correction`/`ports`），**不由 `records.ts` 拆出**，是按 80-§6.9 新建（§4.5）；再加 `credentials`（AUTH-06）与 `persistence`/`reconstruct`（80-§6.3/§4.6）三个目标新增件，故目录合计 **17 件**。

### 5.3 `test/v5-candidates.test.ts`（602 → 4 件）

| 现有 describe 段 | 目标文件 | 预算 |
|---|---|---|
| `:95` 迁移 + `:166` insertCandidate（幂等/形状/谱系/verification 序列化） | `test/candidates/insert.test.ts` | ≤220 |
| `:282` lineageOf + `:327` candidatesByStatus | `test/candidates/lineage.test.ts` | ≤160 |
| `:359` transitionCandidate 乐观锁 + `:421` core↔store 一致性 | `test/candidates/core-parity.test.ts` | ≤180 |
| `:477` updateVerification | `test/candidates/update-verification.test.ts` | ≤150 |

〔结论〕4 件均 ≤600；`test/candidates` 4 件 ≤25；**基线条目 `packages/store/test/v5-candidates.test.ts: 602` 可除名**。「建库即 v5」的迁移断言段（`:95-165`）只落 `insert.test.ts`；其余三件各自 `mkdtemp` + `openLedger` 建自己的库（v5 迁移在打开时自动跑，不需要复制断言）。四件**不共享连接**，避免顺序耦合。

### 5.4 目录与预算复算

| 目录 | 目标文件数 | 上限 |
|---|---|---|
| `packages/store/src/` | 15 | 25 |
| `packages/store/src/ledger/` | 12 | 25 |
| `packages/store/src/records/` | 17（7 形状 + 10 记录面） | 25 |
| `packages/store/src/migrations/` | 14 | 25 |
| `packages/store/src/recon/` | 1 | 25 |
| `packages/store/src/lease/` | 1 | 25 |
| `packages/store/src/memory/` | 2 | 25 |
| `packages/store/src/resources/` | 2 | 25 |
| `packages/store/test/` | 18（17 测试 + `ulid.ts`） | 25 |
| `packages/store/test/records/` | 9 | 25 |
| `packages/store/test/candidates/` | 4 | 25 |
| `packages/store/test/recon/`、`test/lease/` | 各 1 | 25 |
| `packages/store/test/memory/`、`test/resources/` | 各 2 | 25 |

〔复算〕`src` 直下 15 + `ledger/` 12 + `records/` 17 + `migrations/` 14 + `recon/` 1 + `lease/` 1 + `memory/` 2 + `resources/` 2 = **64 生产件**（与 §3.1 一致）；`test/` 18 + `test/records/` 9 + `test/candidates/` 4 + `test/recon/` 1 + `test/lease/` 1 + `test/memory/` 2 + `test/resources/` 2 = **37 测试件**（36 `.test.ts` + `ulid.ts`，与 §3.3 一致）；加 2 个配置件 = **103**（与 §〇 一致）。〔结论〕无一处触阈；**域平面（`src` 直下）只减不增**：拆出件全进子目录，直下保持 15。

---

## 六、加文件判断（何时允许新增）

1. **上位有名才落盘**：路径必须能回指 80 的端口名或 80-§10.6 的「表族」名单；本附录 **49 个**新增 `src` 件（`ledger/` 12 + `records/` 17 + `migrations/` 14 + `recon/` 1 + `lease/` 1 + `memory/` 2 + `resources/` 2，即 64 生产件减 15 个直下保留件）全部可回指（§3.1 末列）。`intent-receipts.ts` 的依据是 80-§6.6 的 v14 表 + 80-§6.3 的 `ProjectionName.intentReceipts`，不是自造面；`records/credentials.ts` 的依据是 80-§6.2 `TS-PORT-AUTH-06` + 80-§6.3 `REC-AUTH-04`；`records/persistence.ts`/`migrations/records.ts` 的依据是 80-§6.3「记录面存储不变量」（该节明写 DDL/索引归 81/03）；`records/reconstruct.ts` 的依据是 80-§4.6 与 §6.6 过渡段（「`records` 落地后重建历史波次」）——四者都不是拆分产物（见 §3.1 与 D19）；`migrations/pricing.ts`/`usage.ts`/`cost.ts` 依据是现有 v10/v11/v12 的实际归属，不是新族。
2. **拆分产物优先于新抽象**：只有「现有文件 > 600 行」「类型环」「单文件承载两个 80 组件」三种触发条件允许拆。新增**语义**（新端口、新状态、新六态值）不在本包落地。**本轮两个必做拆分**：`ledger.ts`（1683）与 `migrations.ts`（600 顶格且 v14 必然超阈）；`records.ts`（606）同批。
3. **同一面不拆两次**：`ledger/<family>` 与 `records/<family>` 一对一同名，禁止出现「`ledger/work-a.ts` + `ledger/work-b.ts`」式的进一步碎片化；单文件超 600 时先拆出**纯类型**或**共享 helper**，不再按方法切。
4. **facade 不许长肉**：`ledger.ts`/`records.ts`/`migrations.ts` 只允许再导出与组装；任何业务逻辑回流到 facade 即判返工。
5. **不建空壳**：§3.4 的相邻件由各自卷落盘、本卷不建；`metrics`/`observability` 类文件在 82 给出公共形状前不建。
6. **测试文件按域而非按版本号**：新迁移的测试进既有 `v*` 文件或对应域子目录；`test/` 直下目标 **18** 件（17 测试 + `ulid.ts`），余量 7（上限 25）；新增测试优先进 `test/<域>/`。本轮新增的 18 个测试件（`test/` 直下 `open`/`transaction`/`intent-receipts`；`test/records/` 9；`test/recon/` 1；`test/lease/` 1；`test/memory/` 2；`test/resources/` 2）都已在 §3.3 登记，不临时加名；拆分等价性断言并入 `test/ledger.test.ts`。

---

## 七、迁移顺序

**六个阶段**，**每阶段可独立回退**；任一阶段未过不进下一阶段。所有阶段都不改 `boundary-rules.mjs`。

| 阶段 | 动作 | 行为变更 | 测试改动 | 回退 |
|---|---|---|---|---|
| **M0 纯移动** | `probes` 的 `AppendResult` 改取 `ledger/shared.ts`；`records.ts` → `records/` 7 件；`ledger.ts` → `ledger/` 10 个表族件（含 `shared`、不含 `intent-receipts`）+ facade | **零** | 零（`index.ts` 导出面不变） | 还原文件树 |
| **M1 `migrations/` 拆分** | `migrations.ts` → `migrations/` 13 件 + facade（**必做**，先于 v14）；`sha8` 仍按原样计算，**此阶段不引入 `digest`** | **零** | `test/ledger.test.ts` 加「每版本拼装 `sha256` 相等」「整体拼接字节相等」两条断言 | 还原文件树 |
| **M2 新增面（不接线）** | 新增 `ledger/open.ts`（三 opener + `Ledger` 声明）、`records/{persistence,writer,reader,projection,hooks,transaction,correction,ports,credentials,reconstruct}.ts`、`recon/reconcile.ts`、`lease/lease.ts`、`memory/{entries,access}.ts`、`resources/{ledger,hook}.ts`；`openLedger` 行为**暂不变** | 无（新函数未接线；`persistence` 在 v15 前一律 `envelope-not-storable`） | 新增 `test/open.test.ts`、`test/transaction.test.ts`、`test/records/` 9、`test/recon/reconcile.test.ts`、`test/lease/lease.test.ts`、`test/memory/` 2、`test/resources/` 2 | 删这些文件 |
| **M3 v14 + v15 + 回执面** | `migrations/intent.ts` 加 `intent_receipts` 表与 `schema_version.digest`；**`migrations/records.ts` 加 v15 三表 + 触发器 + 索引**；`migrate` 每版本在独占事务里写 `REC-MIG-01`；新增 `ledger/intent-receipts.ts`；`BEGIN` 改 `BEGIN IMMEDIATE`；writer/reader/transaction 接线 | **有**（新表 + 新列；旧库升 v15） | 新增 `test/intent-receipts.test.ts`；`test/ledger.test.ts` 的 `schema_version` 行数与列断言同批改，并加「每版本恰一条 `REC-MIG-01`」；`test/records/{writer,reader,persistence}.test.ts` 由「表未建 ⇒ 拒」转「正常往返」 | 降回 v13（代码侧删 `migrations/{intent,records}.ts` 与面；库侧需重建，**不可逆**——见下） |
| **M4 接线** | daemon `assembly/serve.ts:1471` 改 `migrateIfOwner`；panel 三处（`external/server.ts:553`、`overview/server.ts:483`、`server.ts:454`）与 CLI 读命令改 `openLedgerReadonly`；`rebuild`/`drill` 改 `openLedgerMaintenance` + `RecordTransaction` | **有**（只读面不再自动迁移） | daemon/panel 的 12+ 处 `openLedger` 造库改走 owner 路径；跨卷（归 81-files/13、17） | 恢复 `openLedger` 调用 |
| **M5 收口** | `openLedger` 去掉隐式 `migrate`；版本不符 → `rejected_version` + `EVOLVE_REJECT`；错误分类按 §1.4 全量落定（`already-ended`/`final-exists`/`not-applying`/`duplicate-id`/`id-conflict`/`ticket-conflict` 等改 failure） | **有**（不迁移即拒起） | store 内全部测试（M0 后 18 个测试文件）要显式建库；`test/ledger.test.ts:67/109/122/124`、`v2-tables:59/85/87/122`、`v3-jobs:66/79/81/100`、`v4-debts:98/104/108/110/131/133/179`、`v9-pricing:87`、`v11-usage:58`、`v12-cost:78/84`、`rebuild.test.ts:195`、`drill.test.ts:41/42/48` 需同批改，且**所有断言 `CONFIG_INVALID` 的用例要同批改分类** | 恢复隐式迁移 |

〔顺序纪律〕
- **M1 必须先于 M3**：不拆就加 v14/v15 DDL，`migrations.ts` 必然 >600 行（600 已是顶格）。
- **M3 的不可逆性**：v14 或 v15 一旦在某个库上跑过，回退代码只会让 `schema-ahead` 拒起；库本身必须重建（`dump` → 删库 → `rebuild`）。因此 M3 只能在**有 dump 可回滚**的前提下上；「回退=还原文件树」对 M0/M1/M2 成立，对 M3 不成立，此处如实标注。**v15 另加一条**：回退前若已跑过 `reconstruct`，重建出来的 `records` 会随库一起消失，旧 `events` 行仍在——「重建过一次」不等于「库里已有事实」，两次回退的损失不得互相抵消。
- M4 必须先于 M5：若先去掉隐式迁移，panel/CLI 会在旧库上读到 0 版本表并静默返回空集（**比报错更坏**）。
- M0 与 M1 可并行（不同文件）；M2 依赖 M1（`open.ts` 要 import `migrations/index.ts`）；M3 依赖 M2（面要挂进组装）；M4 依赖 M3（新表要有读面）；M5 依赖 M4。

---

## 八、影响面

### 8.1 `openLedger` 的调用点（现状 16 处显式调用 + 3 处注入闭包）

| 位置 | 角色 | 目标 |
|---|---|---|
| `apps/daemon/src/assembly/serve.ts:1471` | 唯一常驻写者 | `migrateIfOwner` + 写面 |
| `apps/daemon/src/cli/{gray,candidates,sandbox,jobs,cutover,company,postmortem}.ts`（`:37/:44/:41/:58/:84/:49/:153/:68`） | 短命 CLI | 读命令 → 只读；写命令（cutover/gray/jobs）→ 显式 owner |
| `apps/daemon/src/cli/ledger.ts:37` | `dump`/`rebuild`/`drill` 薄壳 | 维护写面 → 离线窗口 |
| `packages/panel/src/external/server.ts:553` | 对外 HTTP | **禁止**（越界写口，80-§8.1）；迁 api 后只读 |
| `packages/panel/src/overview/server.ts:483`、`panel/src/server.ts:454` | 只读监控 | `openLedgerReadonly`（80 拼写） |
| `packages/panel/src/{external/server.ts:233,overview/server.ts:196,server.ts:161}` | `opts.openLedger()` 注入闭包 | 由注入方决定只读 |
| `packages/store/src/rebuild.ts:29`、`drill.ts:149`/`:164` | 维护 | 显式 owner + 事务端口 |

〔事实·口径差〕80-§8.2 记「14 处」，是按**调用者行**计（`jobs` 与 `drill` 各占一行）；按**表达式**计是 **16 处**（`cli/jobs.ts:58`/`:84`、`drill.ts:149`/`:164` 各两处），另有 3 处注入闭包不计入。两者不矛盾，但引用时须说清算的是哪一种。回写项 D14。

### 8.2 `Ledger.db` 的逃逸面

〔事实〕`ledger.ts:1585` 把 `DatabaseSync` 句柄放进返回值；`src` 生产代码无人用，但测试在用（**按句柄用法核过**，不是按文件名）：

- `packages/store/test/`（**8 个文件真用句柄** `ledger.db.*`）：`ledger.test.ts`、`v2-tables.test.ts`、`v3-jobs.test.ts`、`v4-debts.test.ts`、`v5-candidates.test.ts`、`v6-reports.test.ts`、`v8-todo-queue.test.ts`、`v9-pricing.test.ts`（直查 `sqlite_master`、`PRAGMA`、`schema_version`）；
- `apps/daemon/test/`（4 个文件）：`evolve/cutover.test.ts:297`、`engine/hrsync/hrsync.test.ts:253/262`、`engine/e2e.test.ts:430`、`engine/crash-injection.test.ts:97`；
- **只拼路径串、不用句柄**（不计入逃逸面）：`packages/store/test/{v7-hr-sync,v8-model,v11-usage,v12-cost}.test.ts` 的 `path.join(root,'ledger.db')`、`packages/panel/test/external.test.ts:94`。

〔计数〕**8 + 4 = 12 个测试文件**真正依赖 `db` 句柄；另有 5 个文件只出现字符串 `'ledger.db'`。旧稿的「12 个 store 文件 / 9 个文件」两种说法都不对，以本节为准。

〔结论〕删除 `db` 是**破坏性变更**，且会让「迁移 DDL 断言」失去唯一观测口。目标分两步：在 80 给出「替代 `db` 的结构内省口」名字与形状之前（**本卷不私自定名**→ D12），`db` 保留；M4 后再评估。**本卷不把 `db` 标为退役**。

### 8.3 `src/index.ts` 必须保持的导出面（一不减）

〔事实〕现导出名（`grep '^export' packages/store/src/index.ts`）：

- 常量/值：`PACKAGE_NAME`、`PACKAGE_STATUS`、`openSqlite`、`currentVersion`、`migrate`、`LATEST_VERSION`、`openLedger`、`PRICE_BILLING_TRACK_VALUES`、`PRICE_SLOT_VALUES`、`UNATTRIBUTED_PERSON`、`gateRate`、`harvestHits`、`perfPercentile`、`perfPersonRows`、`rejectionCount`、`reportRate`、`costDailyMigration`、`COST_BASIS_VALUES`、`COST_KIND_VALUES`、`createProbesFace`、`rebuild`、`renderDrillReport`、`runLedgerDrill`，以及记录族 24 个 schema/值域（`BudgetRecordSchema`、`CANDIDATE_*`、`CandidateRowSchema`、`DepartmentRecordSchema`、`EndWorkRecordSchema`、`HR_SYNC_*`、`HrSyncPayloadSchema`、`HrSyncTaskSchema`、`JobRecordSchema`、`LEDGER_KIND_VALUES`、`LedgerEntrySchema`、`PersonRecordSchema`、`PersonnelEventRecordSchema`、`ProbeRunSchema`、`REPORT_TYPE_VALUES`、`ReportRecordSchema`、`SessionRecordSchema`、`TERMINAL_CANDIDATE_STATUS_VALUES`、`TicketMirrorRecordSchema`、`TodoQueueRecordSchema`、`WorkRecordSchema`）。
- 类型：`Migration`、`AppendResult`、`BudgetListQuery`、`BudgetScope`、`CompanySyncResult`、`DumpResult`、`EventQuery`、`InsertCandidateResult`、`Ledger`、`PersonnelTimelineEntry`、`AppendPriceSnapshotResult`、`PriceBillingTrack`、`PriceSnapshotQuery`、`PriceSnapshotRecord`、`PriceSlot`、`PricingFace`、`PerfAggregationInput`、`PerfEventCounts`、`PerfPersonRow`、`ReplaceUsageDailyResult`、`UsageDailyQuery`、`UsageDailyRecord`、`UsageFace`、`CostBasis`、`CostDailyFace`、`CostDailyQuery`、`CostDailyRecord`、`CostKind`、`ProbeRunQuery`、`ProbesFace`、`RebuildResult`、`DrillCheck`、`DrillReport`，以及 24 个记录类型。

〔结论〕拆分**只改文件归属，不改导出名**。`AppendResult` 保留（80-§6.3 淘汰的是它作为端口类型；句柄方法仍返回它），`Ledger` 保留（80-§12.5 引用 `store/src/ledger.ts:229` 时该行号会漂移 → D14）。

〔目标新增导出（只增不减）〕
- 值：`openLedgerReadonly`、`openLedgerMaintenance`、`migrateIfOwner`、`createIntentReceiptsFace`、`createTransactionFace`、`createRecordPorts`、`MIGRATIONS`（**不进** barrel，仅测试经相对路径取）。
- 新增面的其余工厂（`createRecordWriter`/`createRecordReader`/`createProjectionFace`/`createHookRegistry`/`createCorrectionFace`/`createReconciliationFace`/`createLeaseFace`/`createMemoryEntries`/`createMemoryAccess`/`createResourceLedger`/`createResourceHook`，§4.5 各条目）**默认不进 barrel**：由 `open.ts` 在组装时创建并经 `createRecordPorts` 暴露，**不开第二个入口**；哪个工厂确需外露，随 daemon 装配（17 卷）一并提案，不在本卷先斩。
- 类型（本包新面）：`ReadOnlyLedger`、`ReadOnlyLedgerOpen`、`RecordPage`、`IntentReceiptRow`、`IntentReceiptsFace`、`TxScope`、`TxHandle`、`TxReceipt`、`TransactionFace`、`RecordPortsFace`、`AppendOptions`、`AppendReceipt`、`RecordQuery`、`ProjectionName`、`ProjectionResult`。其中 `ReadOnlyLedger`/`ReadOnlyLedgerOpen`/`RecordPage`/`AppendReceipt`/`RecordQuery`/`ProjectionName`/`ProjectionResult` 是 **80 的定义、本包再导出**——再导出不是新契约，但会让 `index.ts` 的导出面变宽，须在 barrel 注释里标明来源卷（§1.2 允许 `@studio-next/contract` 类型边）。
- **不得**新增：`ReadLedger`（旧稿自拟，已废）、`schemaIntrospect` 一类 80 未命名的观测口（D12）。

### 8.4 跨包读取本包私有模块

〔事实〕`test/v8-model.test.ts`、`test/v11-usage.test.ts`、`test/v12-cost.test.ts`（及第 4 处）直接 `import … from '../src/migrations.ts'`，绕过 `index.ts`。目标：`LATEST_VERSION`/`migrate` 已在 barrel 导出，迁移测试改走 barrel；`migrate(db,{upTo})` 的 `upTo` 是测试构造历史库的唯一手段，**保留在公共面**。跨包（daemon/panel）无人 import store 私有路径（已核）。

---

## 九、测试面

### 9.1 现有 16 个测试件逐条

| 文件 | 覆盖 | 测了不该测的 / fake 边界 | 不可证明 | R/E/W/V |
|---|---|---|---|---|
| `ledger.test.ts` | 建库即 v13、13 行 `schema_version`、重开幂等、PRAGMA、`appendEvent` 契约闸与同 id 幂等、`queryEvents` 过滤/排序/limit、work/sessions 往返 | **直查 `ledger.db`**（`:69/78/108/114/116`）＝内部句柄逃逸；`it` 名 `:66` 仍写「version=8」而断言 `:67` 是 13（命名漂移） | 并发、跨进程、断电容灾 | R+W |
| `perf.test.ts` | 五指标逐条、零分母 null、归属律、行序、`perf-weekly` 往返 | 用真库造语料（W）；不测 SQL 层 | 面板/报表两侧复算一致（S9）未在此证 | R+W |
| `rebuild.test.ts` | dump 行数/字节、重建 deep-equal、坏 JSON/坏记录回滚、原地重建 | 断言 `version=13`（`:195`）＝硬编码版本 | 大文件内存、磁盘满 | R+E |
| `drill.test.ts` | 进程内四检查 PASS、已存在拒演、CLI 冒烟（dump/rebuild/用法错） | **`spawnSync` 跑 `apps/daemon/src/cli/main.ts`**＝跨包黑盒，不是 store 单测；断言 `26`/`v13` 字符串（`:38/41/42/48/82/94/98/101`） | 真实灾难恢复时延、磁盘故障 | R+E |
| `v2-tables.test.ts` | v2 五表 + 升级路径 + `syncCompany` 往返/批内查重 + 触发器 + 三表时间线 + budgets + ticket_mirror | 直查 `sqlite_master`（`:61/65/78`） | 目录侧真实快照 | R+W |
| `v3-jobs.test.ts` | v3 迁移/升级、`upsertJob` 热更不动他岗、`dueJobs` 扫描、`markRan`、`removeJob`、记录闸 | 直查 `version` 与表 | cron 真实解析（不在本包） | R+W |
| `v4-debts.test.ts` | kv 接管（含 daemon 旧 DDL 字节存档常量）、`endWorkRecord` 一次性/COALESCE、desc 镜像 | 存档常量是**跨包字节复制**（daemon 已删自建语句）；直查 `sqlite_master` | daemon 侧「不再执行 DDL」的直证在 `apps/daemon/test/e2e.test.ts` | R+W |
| `v5-candidates.test.ts` | 迁移、insert 幂等/谱系闸/verification、`updateVerification` 窗口、`lineageOf` 断链/环、`candidatesByStatus`、CAS（含双连接竞态）、core↔store 一致性 | 裸 SQL 注入损坏语料（合理，模拟库侧损坏）；**602 行超阈** | 跨进程 CAS（双连接同进程） | R+W |
| `v6-reports.test.ts` | ledgers 覆盖写/双键、reports 自然键换代、probes 触发器 | 直查库结构 | 报表聚合管线 | R+W |
| `v7-hr-sync.test.ts` | `hr_sync_log` 全流转、复位窗、统计、`setPersonStatus` | 用真库（W） | 跨进程复位竞争 | R+W |
| `v8-model.test.ts` | v8 迁移/升级、旧 tokens 不改写、新列 NULL | 用 `upTo` 造历史库（正当用法） | 真实旧库样本 | R+W |
| `v8-todo-queue.test.ts` | 整换/隔离/坏行整批拒、`wait=` 锚、mirror `assignee` | — | 真实 dispatcher note 分布 | R+W |
| `v9-pricing.test.ts` | 触发器、形状、双轨互斥、`version` 赋值、单据幂等、值域一致性 | 裸 SQL 直插（正当） | core 侧定价消费 | R+W |
| `v11-usage.test.ts` | 并格累加、分格、替换原子、过滤、坏形状 | 断言 `LATEST_VERSION=13`（`:58`） | 收割相位折日 | R+W |
| `v12-cost.test.ts` | final 首冻/重复双层拒、触发器、adjustment 跨格拒、日期扫描 | 断言 `LATEST_VERSION=13`（`:78`） | 收口工序 | R+W |
| `ulid.ts`（助手） | `makeUlid()` | 仅测试：生产 ULID 归 daemon | — | — |

〔结论·测试面问题三条〕
1. **内部句柄直查**：**8 个 store 测试文件**真用 `ledger.db.*` 句柄（`ledger`/`v2`/`v3`/`v4`/`v5`/`v6`/`v8-todo-queue`/`v9`；§8.2），8 个文件里都能找到 `sqlite_master`/`PRAGMA`/`schema_version` 一类结构断言（不逐一列为句柄断言：部分走 `openSqlite` 独立连接，未逐行区分）。这是**当前唯一**能证明 DDL 落地的观测口，但它是生产逃逸面。目标：只读断言改走 `openSqlite` + 独立连接（同一文件），不再经 `Ledger.db`。
2. **硬编码版本**：至少 12 个文件断言 `13`/`26`；任何新迁移即红。目标：改用 `LATEST_VERSION`（已从 barrel 导出），仅 `drill` 保留一个「版本前后一致」的相对断言。
3. **E 类稀薄**：只有 `drill` 的 spawn 段与 `rebuild` 的真删库段是真实执行；其余是进程内真文件（W）。V 类（价值证据）**全缺**——「单源复算一致」「拆分前后字节等价」都没有留证。

〔结论·跨卷处置〕`test/drill.test.ts` 的 `spawnSync` 段（`:73-126`）是**对 daemon CLI 的黑盒验收**，不是 store 单测。目标迁到 `apps/daemon/test/cli/ledger-cli.test.ts`（归 81-files/17），store 侧只留进程内全链。迁移前两处并存属**重复覆盖**，不是错误；迁移后 store 的 `drill.test.ts` 预算从 128 行降到约 60 行。该目标文件**不计入本附录的 22 件**。

### 9.2 目标测试件与 R/E/W/V 映射

〔口径·待 82〕82 未成卷，下列四类是**本附录的暂定定义**，不得当冻结：R=黑盒验收判据（可由契约/冻结命令复算）；E=真实执行留证（真进程/真文件/真 CLI）；W=等价替代（替代物证明行为等价，有边界）；V=价值证据（证明该件不可替代，如单源复算、字节等价）。

| 目标文件 | R | E | W | V | 备注 |
|---|---|---|---|---|---|
| `ledger.test.ts` | 建库版本/PRAGMA/闸 | — | 有 | — | 去 `db` 直查 |
| `perf.test.ts` | 五指标口径 | — | 有 | **待 82**：面板/报表复算一致 | — |
| `rebuild.test.ts` | 重放原子性/行号 | 真删库+重建 | 有 | — | — |
| `drill.test.ts` | 四检查/PASS 行 | 进程内全链 | — | — | spawn 段外迁 |
| `v2-tables.test.ts` | 五表/触发器/时间线 | — | 有 | — | — |
| `v3-jobs.test.ts` | 调度表面 | — | 有 | — | — |
| `v4-debts.test.ts` | kv 往返/收口 | — | 有 | — | 字节存档保留 |
| `v6-reports.test.ts` | 三表面 | — | 有 | — | — |
| `v7-hr-sync.test.ts` | 流转 | — | 有 | — | — |
| `v8-model.test.ts` | 升级路径 | — | 有 | — | — |
| `v8-todo-queue.test.ts` | 整换 | — | 有 | — | — |
| `v9-pricing.test.ts` | 幂等/版本/触发器 | — | 有 | 值域一致性（弱 V） | — |
| `v11-usage.test.ts` | 并格/替换 | — | 有 | — | — |
| `v12-cost.test.ts` | 首冻/补账 | — | 有 | — | — |
| `test/candidates/insert.test.ts` | 幂等/谱系/序列化 | — | 有 | — | 迁移段共用 |
| `test/candidates/lineage.test.ts` | 链条/断链/环 | — | 有 | — | — |
| `test/candidates/core-parity.test.ts` | CAS 语义 | — | 双连接竞态 | **核心 V**：值域 deep-equal | — |
| `test/candidates/update-verification.test.ts` | 窗口/幂等 | — | 有 | — | — |
| `test/open.test.ts` | 只读不建库/不迁移/旧版本拒起 | 真文件 + 只读打开 | — | — | **全新** |
| `test/transaction.test.ts` | 提交/回滚/拒嵌套/跨域拒 | — | 有 | — | **全新** |
| `test/records/ports.test.ts` | 合成面签名/`get` 两态/`query` 三轴分列/未注册投影抛错 | — | 有 | — | **全新**（原 `record-ports` 改名移入 `test/records/`） |
| `test/records/writer.test.ts` | 整封往返/载荷四态零行/`deduped` 与 `rejected_idempotency` 两向/域歧义与 `TxScope` 不符拒/CAS 两向 | — | 有 | — | **全新** |
| `test/records/reader.test.ts` | `Ok(undefined)` vs `Err(ledger-read-failed)`/keyset 两页/四码分列/`payload` 四态、不回总数 | — | 有 | — | **全新** |
| `test/records/persistence.test.ts` | 触发器拒改删/大小上限零行/同摘要不增行/原始字节逐字节相等/摘要只对字节算 | — | 真文件 SQLite | — | **全新** |
| `test/records/reconstruct.test.ts` | `reconstructed`/缺字段不回填/旧摘要 `unknown`/重建时刻≠观察时刻/重放零新增 | — | 有 | — | **全新** |
| `test/records/projection.test.ts` | 增量=重建/未注入派生器抛错/`rows`=本次处理行数·完成 `cursor=null` | — | 有 | 重建逐字段一致（弱 V） | **全新** |
| `test/records/hooks.test.ts` | 钩子在事务内/抛错回滚/`abort` 不触发 `afterCommit` | — | 有 | — | **全新** |
| `test/records/correction.test.ts` | 只追加/链顶 CAS/`type-version-mismatch` 单列 | — | 有 | — | **全新** |
| `test/records/credentials.test.ts` | 登记摘要幂等/解析两态/吊销幂等+预期版本/值入目录拒 | — | 有 | — | **全新** |
| `test/recon/reconcile.test.ts` | `intentRef` 缺拒且零行/孤儿未知只落缺口 | — | 有 | — | **全新** |
| `test/lease/lease.test.ts` | 双 acquire 唯一成功/fence 每次换/旧 fence 拒 | — | 有 | — | **全新** |
| `test/memory/entries.test.ts` | 四层分离/五操作不删原文/`residue_statement` | — | 有 | — | **全新** |
| `test/memory/access.test.ts` | 每次读恰一条/被拒读也留痕 | — | 有 | — | **全新** |
| `test/resources/ledger.test.ts` | 三态 `limit`/缺省未知/删表重建一致 | — | 有 | 重建逐字段一致（弱 V） | **全新** |
| `test/resources/hook.test.ts` | 三处事务各产行/重放不翻倍/缺口可见 | — | 有 | — | **全新** |
| `test/intent-receipts.test.ts` | 同键取最大/等值不覆盖/`gap` 区分/整表替换事务 | — | 有 | 唯一键四列各自生效（弱 V） | **全新（表尚不存在）** |
| `ulid.ts` | — | — | — | — | 仅测试 |

〔结论〕目标 36 个 `.test.ts`（按 §9.2 表逐行计）：R 覆盖 36/36；**E 覆盖 3/36**（`drill`、`rebuild`、`open`——`drill` 的 CLI spawn 段外迁后不在本包计；新建面全为进程内 SQLite）；W 覆盖 34/36（仅 `drill` 与 `open` 不以替代物计）；V 覆盖 5/36（`v9-pricing` 弱、`candidates/core-parity` 核心、`intent-receipts`/`records/projection`/`resources/ledger` 弱），其中 2 项标「待 82」。**V 面与 E 面是最大缺口**，本卷不臆造 V 用例；`kill -9` 四态注入（§8.7）属端到端卷，不在本包计数。〔待 82〕四类口径未定稿，此处计数不得被当作验收结论。

### 9.2b 错误分类将红面（M5 必读）

现状所有失败都走 `configInvalid(...)`，即 `rejected_precondition` + `CONFIG_INVALID`。§4 的目标映射把其中 **7 类**改成别的 failure：`already-ended`、`final-exists`、`not-applying`（→`rejected_state`）、`duplicate-id`/`id-conflict`/`ticket-conflict`（→`rejected_idempotency`）、`schema-digest-mismatch`（→`rejected_version`），另有触发器拒改删（→`rejected_forbidden`）。这些 subcause 在 `v2`/`v4`/`v6`/`v7`/`v9`/`v12`/`ledger` 的断言里都按 `CONFIG_INVALID` 写，**M5 必须同批改**，否则"测试绿"只说明断言没跟上。反之，M0–M3 期间**不改**任何分类，避免与纯移动混在一起。

### 9.3 映射缺口表（找不到的必须有判断）

| 目标件 | 现状测试 | 缺口与判断 |
|---|---|---|
| `src/driver.ts`（只读参数） | 仅 PRAGMA 断言 | 目标 `test/open.test.ts` 覆盖；**不**为它单建测试 |
| `src/row-helpers.ts` | 无直接 | 经所有写面间接覆盖；**判定：不新建**，避免为 40 行工具再加一个测试文件 |
| `src/records/{work,company,hr,budget,jobs,candidates,reports}.ts`（7 形状） | 无 `records.test.ts` | 形状经各 `v*` 覆盖；值域一致性经 `core-parity`；**判定：不为形状件新建总表测试**，但 7 件必须各自仍被至少 1 个现有测试触及（下表核） |
| `src/records/{persistence,writer,reader,projection,hooks,transaction,correction,ports,credentials,reconstruct}.ts`（10 记录面） | **零** | 各自 `test/records/*.test.ts`（`transaction` 的测试仍在 `test/transaction.test.ts`）；`hooks` 的崩溃四态归端到端卷；`credentials`/`writer` 的 schema < 15 路径只断言 fail-closed，不冒充「已能落库」；`persistence` 的触发器与大小上限必须真文件跑（W），不得用 mock 取代 |
| `src/ledger/shared.ts` | 间接 | `appendEvent` 幂等 + tokens 往返 |
| `src/ledger/{events,work,company,budget,hr,jobs,kv,candidates,reports}` | 有（见 §9.1） | 无缺口 |
| `src/ledger/open.ts` | **零** | `test/open.test.ts` |
| `src/ledger/intent-receipts.ts` | **零**（表都不存在） | `test/intent-receipts.test.ts` |
| `src/recon/reconcile.ts` | **零** | `test/recon/reconcile.test.ts` |
| `src/lease/lease.ts` | **零** | `test/lease/lease.test.ts`；跨进程围栏**登记未证**，本包不造双进程 |
| `src/memory/{entries,access}.ts` | **零** | `test/memory/entries.test.ts`、`test/memory/access.test.ts`；跨层读负向在 `entries` 覆盖 |
| `src/resources/{ledger,hook}.ts` | **零** | `test/resources/ledger.test.ts`、`test/resources/hook.test.ts`；投影名 `resourceLedger`（物理表 `resource_ledger`）名字已定、表与派生器随 `MIG-01`，落地前按「派生器未注入」fail-closed |
| `src/migrations.ts` 的 `schema-digest-mismatch`/`bad-up-to`/`schema-ahead`/`db-busy` | **零** | **判定：补进 `test/ledger.test.ts`**（不新建文件）；`schema-ahead` 需构造「代码版本更旧」的输入，用 `upTo` 造不出，靠直接写 `schema_version` 加一行伪造高版本 |
| `src/migrations/*`（14 件） | 间接（建库路径） | **判定：不逐件建测试**；拆分等价性两条断言进 `test/ledger.test.ts`，其余由既有 `v*` 的建库路径覆盖；v15 的 `records.ts` 由 `test/records/persistence.test.ts` 与 `test/records/writer.test.ts` 的建库路径覆盖，不另建「迁移 v15」测试文件 |
| `src/rebuild.ts` 的大文件/磁盘满 | 零 | **登记未证**，不造 |
| `src/drill.ts` 的季度 cron | 零 | 属 daemon 调度（未落地） |
| `src/index.ts` 导出面完整性 | 零直接 | **判定：不新建**；由 `tsc` + 全量测试的 import 面兜底 |

〔拆分后覆盖自检（按现有测试的调用面，非运行结果）〕`records/work`←`ledger`+`v4`+`v8-model`；`records/company`←`v2`+`v8-todo`；`records/hr`←`v7`+`v2`；`records/budget`←`v2`；`records/jobs`←`v3`；`records/candidates`←`candidates/*`；`records/reports`←`v6`+`perf`。七件均 ≥1，无孤儿。

---

## 十、风险、回写与结构检查

### 10.1 静态结构检查（只做计数与 import 方向，非运行证据）

| 检查 | 命令 | 结果 |
|---|---|---|
| `src` 直下件数 | `ls packages/store/src/*.ts \| wc -l` | 15（目标 15） |
| `test` 直下件数 | `ls packages/store/test/*.ts \| wc -l` | 16（目标 18：17 测试 + `ulid.ts`） |
| 文件行数超 600 | `wc -l packages/store/src/*.ts packages/store/test/*.ts` | 仅 `ledger.ts` 1683、`records.ts` 606、`v5-candidates.test.ts` 602 三件超阈，**均在 `lineBaseline` 内**（`boundary-rules.mjs:162-163/181`） |
| `migrations.ts` 是否顶格 | 同上 | 600 = 阈值，**不超**；但 v14 必然超 → 拆分升为必做（§七 M1） |
| 引擎打开点唯一性 | `grep -rn "new DatabaseSync" packages/store/src` | 1 处（`driver.ts:30`） |
| 包外 import 面 | `grep -rhoE "from '[^']+'" src/*.ts \| sort -u` | 仅 `@studio-next/contract`、`zod`、`node:*`、包内相对 |
| `store → core` 是否落 src | `grep -rn "@studio-next/core" packages/store/src` | 0 |
| `store → company/panel/…` | 同上 grep | 0 |
| 类型环 | 人工核 | 2 处：`ledger↔probes`（type-only，M0 解）、`migrations↔cost`（type-only，保留；拆分后移到 `migrations/v12.ts`） |
| `openLedger` 调用点 | `grep -rn "openLedger(" apps/*/src packages/*/src` | **14 处按调用者行 / 16 处按表达式 / 3 处注入闭包**（§8.1、D14） |
| 迁移版本 | `grep -c "version: " src/migrations.ts` | 13（v1–v13，v12 由 `cost.ts` 摊入）；目标 v14 + v15 |
| `intent_receipts` 是否已存在 | `grep -rn "intent_receipts\|IntentReceipt" packages apps` | **0 命中**（表、类型、面全无；§4.4 新增件是零起点） |
| `openLedgerReadonly` 是否已存在 | `grep -rn "openLedgerReadonly" packages apps` | **0 命中**（80 已定名，代码未落） |

〔声明〕以上是**静态计数**。本附录作者**未运行** `bun run test`、`bun run typecheck`、`bun run guard:boundaries`，也未启动任何服务；这些数字不构成「拆分可行」「测试通过」的证据。

### 10.2 需回写上位卷的具体对象

| 编号 | 回写目标 | 缺口 |
|---|---|---|
| **D1（已关闭）** | 80-§4.4 / §6.3 | 旧记：「78 无 records DDL，整封无处可落」。80-§6.3「记录面存储不变量」已明确**语义不变量归 80、DDL 归 81/03**，并点名 `records`/`record_payloads`/`record_transactions` 三表。本卷据此落 v15（`migrations/records.ts`）与唯一 SQL 落点 `records/persistence.ts`，`RecordWriter` 的签名改为 `append(RecordWriteInput)`。**残余不是缺口，而是排期**：v15 之前写路径 fail-closed（`unsupported/envelope-not-storable`），**不得**回退 `appendEvent`。 |
| **D2** | 80-§5.7、contract | `ClassifiedError` 的 `failure` 有 14 类，但 contract 只有 `configInvalid(...)`（`contract/src/schemas/errors.ts:54`）一个公共构造器，固定 `rejected_precondition + CONFIG_INVALID`。其余 13 类（含本卷要用的 `rejected_idempotency`/`rejected_state`/`rejected_version`/`rejected_forbidden`/`unsupported`/`unavailable`/`timeout`）**没有**公共构造器。本卷 §4 的错误映射表因此只能是**目标口径**；实现前须在 contract 补 `classified(input: ClassifyInput)`（对象入参：`failure`、`subcause`、可选 `detail?`/`category?`；80-§5.7 已给目标签名，**代码未落**），否则 store 只能内部构造同形对象——那是临时手段，不得写成已收口。 |
| **D3（已关闭）** | 80-§8.2、80-§4.1 `TS-SCALAR-08` | 旧记：「`sha8` 被当漂移依据、完整摘要缺列」。本卷处置已定：加 `digest TEXT`（`sha256:<64 hex>`，内部编码、不作公共类型）、`sha8` 降为**展示列**、漂移判定改完整摘要、subcause 为 `schema-digest-mismatch` + `rejected_version/EVOLVE_REJECT`。**v14 之前的行写 `digest='unknown'`**（76-§1.8），不回填占位摘要、不拿 `sha8` 扩写，校验时跳过并落一条 `REC-LOSS-01`——「旧行无法回填」不再是待裁定项（U14 相应改口径）。 |
| **D4（设计已定，迁移未做）** | 80-§4.1 `TS-SCALAR-04/09`、76 `REC-MIG-01`、82-MIG-03 | 库内金额列**全部是 `REAL`**（`migrations.ts:60/80/184-185/214/339/472-478`）。目标为每个金额值 `DecimalString` 的 **TEXT** 列 + **同一行显式币种**（不是全库隐式一种币，也不把币种塞给面板）；`Money.usd:number` 只作旧实现兼容，新的精确计算走 `core/src/decimal.ts`。迁移归 **MIG-03**：快照与授权 → 干跑 → 旧 REAL 只读导出（不重读成 `number` 再回写）→ 按已声明换算规则转文本并逐行对账 → 单写切换 → 核验后退役旧列。旧浮点行只能保存为 `reconstructed` 的实际存储值及限制，无法证明的原十进制词法标 `unknown` + `REC-LOSS-01`；不得伪造“原金额就是精确十进制”。`_usd` 旧列的 USD 含义可显式迁移，其他币种冲突/缺失须停止该批而不是猜。含 `unconverted`/`lossRefs`/`verificationRef`/`authorizationRef`/`idempotencyRule`/`originalPreserved` 的 `REC-MIG-01` 必填；**禁止新旧双写**，不得在本卷顺手改表。 |
| **D5** | 77 `REC-OBS-01`、78 | `reports` 只有 `(id, company, node, type, date, caliber, json_ref)` 七列，承载不了 `REC-OBS-01` 的九个观测字段；且 `insertReport` 的同自然键**覆盖换代**会丢掉旧 `id`，无任何 `REC-*` 记录这次替换。需 77/78 定：观测记录落在哪张表、换代是否必须留一条 `REC-EVT-*`。 |
| **D6（已关闭）** | 80-§6.3、76 `REC-RCP-01` | 80-§6.3 已给落点与不变量：`TxReceipt` 的 `commitSeq`/`proofRef` 落 `record_transactions`；`commitSeq` 由**提交该事务的同一单写事务**分配、唯一单调；提交证明是**同事务**写入的 `REC-RCP-01`，`proofRef` 指向它，证明写不出 ⇒ 整体回滚（**无「已提交无证明」窗口**）。本卷 `daemon_kv` 的 `tx/seq`、`tx/<txId>` 两个内部键**作废**（同一语义的两个载体并存即第二事实源）。残余：`REC-RCP-01` 的记录形状归 76/contract，本卷只按 `recordId` 引用，不定义该类型。 |
| **D7（已关闭）** | 76-§8.3 `REC-MIG-01`、80-§6.6 | 80-§6.6 过渡段已定分工：`records` 可用**之前**迁移只写实现日志（`schema_version`），且必须自称「实现日志、不是记录」；`records` 可用**之后**每版本在**独占事务**里产一条 `REC-MIG-01`（`plan`/`from`/`to`/前后摘要/范围/批准/结果），并把历史波次**重建**为 `reconstructed`。本卷据此落 `migrations/index.ts` 的写入职责与 §4.3b 的产物表；**不得**把 `schema_version` 当 `REC-MIG-01` 的替代。 |
| **D8** | 80-§6.6 | 80-§6.6 第 6 条写「投影只增不改历史」，而 `intent_receipts` 的 `status` 必然随 `queued→decided` 变化。本卷按「**不改记录历史**（REC 不动）≠ 不更新投影可变态」解，否则投影永远停在 `queued`、失去意义。请 80 定稿时收紧措辞（写成「投影可覆盖可变态，但不得删除行/改写 `receivedAt`」一类）。 |
| **D9** | 76-§8、77、78-§10 | 「删库重建」的**恢复面**未定义：`rebuild` 只重放 `events`，`jobs.last_run_at`、`budgets`、`hr_sync_log`、`daemon_kv`、`todo_queue`、`usage_daily`、`ledgers`、`reports`、`intent_receipts` 重建后为空或需重新投影。`drill` 只比对 events 与 `schema_version` 是现状事实，不是契约。需在 76/77 立条（或 78 损失表新增行）说明「恢复≠全量复原」及每张表的再生来源。 |
| **D10** | 79-§11、80-§2.1 | 79 用「L3」指 `store`，与 80-§2.1 / guard 的「层位 2」不是同一把尺；本卷统一按「层位 2」，不回改 79（改了会与既有 guard 文档不一致），但引用时须注明。 |
| **D11** | 80-§6.3 | 80 原文「淘汰 `AppendResult{appended;reason}`」。实测 `AppendResult` 形状是 `{id, appended}`（**无 `reason`**），且被 8 个面用作**句柄返回类型**。目标：保留句柄形状，端口侧用 `AppendReceipt`；80 的表述需精确到「淘汰其作为端口类型」。 |
| **D12** | 80-§8.2、81 自身 | `Ledger.db` 仍是 DDL 的唯一观测口（**12 个测试文件按句柄用**：8 store + 4 daemon，§8.2）。80 没有给「替代 `db` 的结构内省口」的名字与形状；本卷**不自造** `schemaIntrospect()` 一类公共名，只记为缺口。短期处置：只读断言改走 `openSqlite` + 独立连接；长期须 80/82 给名。 |
| **D13（已关闭）** | 80-§11.3 | 旧 D7「`dumpEvents` 直写目标路径」已由 80-§11.3 关闭：导出类落盘统一「临时文件 + rename」。本卷按 80 执行，不再待裁定。 |
| **D14** | 80-§8.2 / §12.5 | 开库点口径差：80 记「**14 处**」（按调用者行），实测按**表达式**是 **16 处**，另有 **3 处注入闭包**。两者不矛盾但引用时须说清算哪一种，需 80 统一记法。另：80-§12.5 以 `store/src/ledger.ts:229` 锚 `Ledger` 接口——M0 拆后该行号迁到 `ledger/open.ts`，锚须改为「文件」而非「文件:行」。 |
| **D15** | 81 自身 / 82 | `index.ts:1-141` 的 TODO 与「拟稿待批」注释块（含 12 条待批口径：ledgers 主键、reports 自然键换代、probes 补列、people 无 company 列、镜像不收敛、`endWorkRecord` 终态值域不锁等）**没有文档落点**。目标：逐条迁入 82 的漂移登记或对应设计卷，代码只留指针；不在本卷抄写。 |
| **D16（已关闭）** | 80-§6.3 REC-03、77 域标识 | 80-§6.3 已定：域→本地表的路由**由注入的 `Projector` 在注册时声明**，公共面上不出现域→表常量表；未登记域 ⇒ `projection-source-invalid`；表投影还须当前激活允许该域。本卷据此把 `Projector` 定为 `{ name, factDomains, project(source) }`，并在 `createRecordPorts` 装配期逐项校验（§4.5）。残余只是「未实现的域尚未登记」，不是命名/映射缺口。 |
| **D19（已解决，仅剩下游同步）** | 80-§6.9、80-§6.2 | 80-§6.9 与 `S6` 行已给 `AUTH-06` 的两个落点（`store/src/records/credentials.ts` 持久面 + `assembly/auth/credentials.ts` 编排），与 80-§6.9 规则 3/4 一致。本卷按此写；**载体已随 D1 改为 `records`**（不再是「用 `events` 表」）。需 17 卷把「03 未给原语则暂用 `Ledger.append`」改为「走 `credentials.ts`（REC-01/02/04）」，本卷不代改。另：`AppendOptions.idempotencyKey` 的判等语义 80 未定义，本件不以它为判据（幂等键是引用摘要，见 §4.5）。 |

〔已关闭〕**D17（错误两轴待统一）** 随 80-§5.7/§6.3/§8.2 定稿关闭：`category` 改为「缺省 + 领域显式覆盖」，`Err` 可达只有 6 值，`STATE_CONFLICT` 在全卷不存在；`ledger-cursor-invalid` = `conflict`/`EXTERNAL_REJECT`、`ledger-query-unsupported` = `unsupported`/`EVOLVE_REJECT`、`ledger-query-invalid` = `rejected_precondition`/`CONFIG_INVALID`、`get` 读失败 = `unavailable`/`STALL`/`ledger-read-failed`，构造器为 `classified(input)`。本卷 §1.4 已按此改写；残余不是词表冲突，而是 **D2**（`classified` 代码未落、`ClassifiedError` 现状无 `failure`）。**D18（投影名待登记）** 随 80-§6.3 登记 `resourceLedger`（目标第 18 个，物理表 `resource_ledger`）关闭：名字已定、联合已给（`TableProjectionName` / `TargetTableProjectionName` / `ProjectionName`），残余只是「随 `MIG-01` 未实现」——不是命名缺口，本卷也不再需要另提登记提案。附带：17 卷 W-20 的 `rows` 口径可按上条关闭（17 卷卷首已记为关闭，正文仍留旧记，由 17 卷自查，本卷不代改）。

### 10.3 未证清单（不得在别处被写成已证）

| 编号 | 未证项 | 关联 |
|---|---|---|
| U1 | `openSqlite(path, {readonly:true})` 不创建 `-wal`/`-shm`、不修改文件 | M1/M2 |
| U2 | 多进程并发迁移的后果（写锁竞争、半提交、版本跳跃） | 80 `U80-16` |
| U3 | `BEGIN IMMEDIATE` 在高并发下的 `busy` 分布与 5s 超时是否够 | M1 |
| U4 | `resetStaleHrSyncApplying` 在两 daemon 下的互相复位 | 52-§11 |
| U5 | `endWorkRecord` 的「读后写」在双连接下会被双写（非 CAS） | 80-§8.3 finalize |
| U6 | `(asset_path,diff_hash)` 与 `hr_sync_log.op_key` 只有非唯一索引，跨进程不兜底 | §4.4 |
| U7 | `rebuild` 大文件（> 内存）行为 | F2-12 |
| U8 | WAL `synchronous=NORMAL` 的断电丢事务窗口 | 78 `L78-STORE-03` |
| U9 | 只读面下 `queryEvents` 的索引选择是否随 `order=desc` 退化 | 80-§6.3 REC-02 |
| U10 | 拆分后 `MIGRATIONS` **逐条** `sha256` 与拆前逐条相等 | M1 |
| U11 | 拆分前后 `MIGRATIONS` 拼接字节与 `join('\n')` 分布相等（整体 `sha256` 相等） | M1 |
| U12 | 只读打开一个**已带 `-wal`** 的库时，是否仍不写库头、不触发 checkpoint | M4 |
| U13 | `intent_receipts` 从 REC 重放的**确定性**（同一 REC 集重放两次得同一表） | M3 |
| U14（已按 D3 处置） | 旧库 `schema_version` 行的 `digest` **无法回填**（原文不在库内）——已定为写 `digest='unknown'` + 落 `REC-LOSS-01` + 校验时跳过；**残余未证**只是「跳过之后漂移是否可能漏报」，不是「该怎么标记」 | D3 |
| U15 | `intent_receipts` 唯一键四列在高并发下是否真的只留一行（单写者假设下未证竞争） | M3 |
| U17 | 单条信封 ≤1 MiB / 单载荷 ≤8 MiB 的上限与 SQLite `max_page_count`、WAL 增长、`busy_timeout` 的关系（阈值是工程判断，未实测；大对象外置未实现） | §4.5 `persistence` |
| U18 | `record_transactions` 每事务一行、append-only 的增长速度与归档策略未定（按「快照 + 重建」还是「冷表归档」未选） | §4.5 `transaction`、§6.3 |
〔已关闭〕**U16 关闭**：旧稿「`ReadOnlyLedger.query` 无错误通道」已被 80-§8.2 最新签名取代——`query`/`get`/`payload` 均返回**同步** `Result`（三查询 subcause + `ledger-read-failed` + 打开期 `db-missing`/`schema-behind`/`schema-ahead`），本卷照此落地（§4.5 `F-store-ledger-open`、§1.4），不再列为未证项。

### 10.4 风险清单

1. **M5 的顺序风险**：先去掉隐式迁移会让 panel/CLI 在旧库上读到 0 版本并**静默返回空集**；必须 M4 先行（§七）。
2. **`db` 的破坏性**：`Ledger.db` 被 **8 个 store 测试文件 + 4 个 daemon 测试文件**按句柄使用（另有 4 个 store 文件与 1 个 panel 文件只拼路径串）；删除或收窄会同时红 12 个测试文件，且失去 DDL 观测口（§8.2）。
3. **拆分可能掩盖回归**：M0/M1 都是纯移动，若同批改任何一行逻辑，就无法二分定位；纪律：这两阶段的 diff 只允许「删除 + 新增文件 + import 改路径」。
4. **`migrations` 拆分最容易出错**：`sha8`/`digest` 都依赖 `m.sql` 的**字节**，跨文件拼装若多/少一个换行，全部已部署库都会摘要不符拒起。执行时必须逐条打印拆前/拆后摘要对照（U10/U11），且这是**必做**（M3 的 v14 不拆就超阈），没有「条件触发」的缓冲。
5. **`probes` 的类型环**：当前能跑是因为 type-only import 被擦除；若 M0 误改成值 import，会在 ESM 求值期形成真环（`ledger.ts` 求值时 `probes.ts` 尚未初始化）。
6. **六态与投影**：`RecordProjection` 无 Result 通道，`state` 是结论；把「库打不开」也回成 `state='unknown'` 会**吞掉真实故障**（80 明写应抛 `ClassifiedError`）。测试须有负向例。
7. **`records.ts` 拆 7 件后的孤儿风险**：`CandidateRowSchema`/`ProbeRunSchema` 等被 `ledger` 与 `index` 双 import，拆分后必须逐一核 `index.ts` 的 48 个导出名仍在（§8.3）。
8. **`append` 的 fail-closed 会让部分调用方当场红**：旧稿允许「丢字段 + `lossRefs`」，目标改为整体 `unsupported`。若有调用方依赖旧行为，属于**行为收紧**，需在 M2 的测试里显式确认「无人依赖静默降级」。
9. **`intent_receipts` 是「表 + 面」同时从零起**：没有历史数据可回归、没有现状测试可对照；`receivedAt` 取最大的语义、`gap` 的 `NULL`/`[]` 区分都只能靠新测试钉，不能靠"与旧实现一致"来背书。

---

## 十一、回执的四个层次（不得互替）

〔结论〕store 同时接触四种「回执/投影」。它们的产出者、载体与可替代性都不同；把任一层当另一层用，就是把事实源与投影混为一谈（80-§4.7、§6.6、§8.3）：

| 层 | 类型 / 记录 | 产出者 | 是否落库 | store 的角色 |
|---|---|---|---|---|
| 单条追加回执 | `AppendReceipt{recordId, deduped}`（`TS-PORT-REC-01`） | `RecordWriter` | **否**（返回值，不落库） | 产出者；`deduped` = 同 `recordId` 且信封规范字节与载荷摘要都一致（§4.5） |
| 事务回执 | `TxReceipt{txId, commitSeq?, recordIds, status, proofRef?}`（`TS-PORT-REC-04`） | `RecordTransaction` | 落 **`record_transactions`**（`commitSeq` 事务内取号、`proofRef` → 同事务 `REC-RCP-01`，D6 关闭） | 产出者；`status:'unknown'`/`open` 只能由 `receipt(txId)` 重读或对账消解 |
| 外部确认回执 | `REC-RCP-01 RecReceipt` | `TS-PORT-EFF-01 EffectGateway` | 是（`records` 记录；`events` 只是它的投影） | **不是写者**，只提供追加与读取（§4.5 `records/ports`） |
| 意图受理投影 | `IntentReceipt` / 表 `intent_receipts` | daemon `IntentReceiptStore` | 是（可重建投影表，§1.3 第三类） | **表 + 同事务 hook + 落库原语**（§4.4 `intent-receipts`、§4.5 `records/hooks`）；派生策略与内存快照归 daemon，**不派生、不持快照** |

三条禁止（各有 80 原文）：

1. **回执投影不是回执**：`IntentReceipt` 只缓存受理结论、可随时重建，不得当 `REC-RCP-01` 用，也不得只在投影里改结论（80-§6.6 `IntentReceiptStore` 规则 3「没有写回执的口子」与规则 8「投影不是事实源」，另见 80-§4.7 `REC-OBS-01` 行「投影…不是事实源」）。
2. **`TxReceipt` 不是外部回执**：其 `proofRef` 指的是 `REC-RCP-01`（外部确认），不是本事务自己的记录；本包**写**这条证明（同事务、经 `records/writer.ts` 的私有追加路径），但**不定义**它的记录形状（归 76/contract），也**不得**拿 `recordIds[0]` 冒充 `proofRef`；证明写不出 ⇒ 整个事务回滚（D6 关闭）。
3. **`AppendReceipt` 不是投影结果**：它只说明「这一条追加成功/被去重」，不说明任何表投影的行数或状态；投影结论看 `ProjectionResult.kind`（`table` 带 `rows`/`cursor`，`rows`=本次处理行数、完成时 `cursor=null`），`ObservationState` 只由 `TS-PORT-OBS-01` 产出（80-§6.3 REC-03、80-§6.6 `TS-PORT-OBS-01`），本包不产出六态。

〔未证〕`intent_receipts` 重建的确定性（U13）、唯一键四列在高并发下的单行性（U15）、`record_transactions` 的长期增长与归档（U18）；`REC-RCP-01` 的记录形状仍需 76/contract 给（本卷只按 `recordId` 引用）。

---

## 附：现有 → 目标 路径对照（仅 `src`）

```text
src/index.ts                      → src/index.ts                      （保留）
src/driver.ts                     → src/driver.ts                     （保留+只读参数）
src/row-helpers.ts                → src/row-helpers.ts                （保留）
src/records.ts                    → src/records.ts                    （facade）
                                  → src/records/{work,company,hr,budget,jobs,candidates,reports}.ts
src/todo-queue-records.ts         → src/todo-queue-records.ts         （保留）
src/migrations.ts                 → src/migrations.ts                 （facade；必做拆分）
                                  → src/migrations/{index,events,work,company,budget,hr,jobs,candidates,reports,pricing,usage,cost,intent}.ts
                                  → src/migrations/records.ts        （v15：`records`/`record_payloads`/`record_transactions` + 触发器；目标新增、**非**拆分产物）
src/ledger.ts                     → src/ledger.ts                     （facade，纯再导出）
                                  → src/ledger/{shared,events,work,company,budget,hr,jobs,kv,candidates,reports,intent-receipts,open}.ts
                                  → src/records/{writer,reader,projection,hooks,transaction,correction,ports}.ts
                                  → src/records/credentials.ts        （AUTH-06 持久适配；目标新增、**非**拆分产物，不来自 ledger.ts）
                                  → src/records/{persistence,reconstruct}.ts（三表 SQL 唯一落点 + legacy 重建损失；目标新增、**非**拆分产物，不来自 ledger.ts）
                                  → src/recon/reconcile.ts
                                  → src/lease/lease.ts
                                  → src/memory/{entries,access}.ts
                                  → src/resources/{ledger,hook}.ts
src/rebuild.ts                    → src/rebuild.ts                    （保留+事务端口）
src/drill.ts                      → src/drill.ts                      （保留）
src/perf.ts                       → src/perf.ts                       （保留）
src/probes.ts                     → src/probes.ts                     （保留+改类型来源）
src/hr-sync-queue.ts              → src/hr-sync-queue.ts              （保留）
src/pricing.ts                    → src/pricing.ts                    （保留）
src/usage.ts                      → src/usage.ts                      （保留）
src/cost.ts                       → src/cost.ts                       （保留）
```
