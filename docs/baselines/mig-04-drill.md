# MIG-04 快照/回滚演练＋环境记录（IMPL-04-05）

> **头注**
> - 日期：2026-10-28（20:38–20:44 CST；逐条时间见 §六）
> - git HEAD：`b0bb2cf3f1cba361f8dccdb742f4f692a10dc42e`（分支 `dev`；工作树含 MIG-04 前序单的未提交改动，见 §七-1）
> - 工具链：bun **1.4.3** / node **v24.21.0** / `node:sqlite` **3.53.4**（`process.versions.sqlite` 与 `SELECT sqlite_version()` 双侧一致）/ `mise 2026.10.11 macos-arm64`（仓 `.mise.toml` 钉版；一切 `bun`/`node` 命令经 `mise exec --` 前缀）
> - 执行者：DeepSeek-V41-Flash（StudioNext 施工代理；LANE-S / IMPL-04-05）
> - 性质：**演练报告＋门禁原始输出留档**——只记跑过什么、原样输出是什么、exit 多少；不为绿改规则/收缩断言
> - 领土：本单只写 `packages/store/test/v2/snapshot-drill.test.ts`[新] 与 `docs/baselines/mig-04-drill.md`[新]；**不碰 `src/**`、旧测试、其它包**；不 git commit
> - 依据：`docs/plan/05-实现单拆分清单.md` IMPL-04-05、`docs/plan/03-里程碑与波次.md` §五（MIG-04 入口条件②③）、`docs/plan/04-测试与验收策略.md` §二 MIG-04 门、`docs/v2/16-技术细节-逐文件蓝图与迁移.md` §四（DOM-04 限域）与 §五（MIG-04 回滚列）、`docs/v2/05-技术抽象-总规范与框架总装.md` §三 DOM-04
> - 演练脚本＝`packages/store/test/v2/snapshot-drill.test.ts`（572 行，<600 尺寸阈）；本文件与之逐条对应，数值为同一实现当场跑出

---

## 〇、结论摘要

| # | 项 | 结果 |
|---|---|---|
| 1 | 演练结论 | **PASS**（本件 7/7 用例绿；报告末行 `演练 PASS`） |
| 2 | 环境记录（入口条件③） | node **24.21.0**／node:sqlite **3.53.4**（`process.versions.sqlite` = `sqlite_version()` = 3.53.4）／`user_version` = **0**（事实登记：版本唯一源＝`schema_version` 表）／`schema_version` = **v15**（版本列 `1..15` 无缺号）／`journal_mode` = `wal` |
| 3 | 快照件（DOM-04 备份） | `cost_daily.jsonl` **3 行**；sha256 `e00aa2edfe15bf34845d3ece78e26b85504b0069446f8a68723bcf2ecaaa5f34`；侧车 `cost_daily.jsonl.sha256` 同值；测试侧独立 `node:crypto` 与系统 `shasum -a 256` 双复算一致 |
| 4 | 恢复（人工显式） | 新库（migrate → v15）只恢复 `cost_daily`：**3 行 / 0.7 USD** 与备份一致；恢复库按备份列序/行序重导 JSONL 与备份件**逐字节相同**；恢复库 **events = 0 条**（events 不在备份内） |
| 5 | 排除域（删库重建） | 删库三件套到位 → `rebuild` 重放 events **4 条**（schema v15，全列 deep-equal）；重建库 `cost_daily` **0 行**（只备份不重放——钱账未重建） |
| 6 | 可重跑（同输入两次） | 第二次演练：备份件字节、sha256、侧车、恢复行集、报告 8 行**全部一致** |
| 7 | 四门（`typecheck`/`typecheck:v2`/`test:v2 -- packages/store`/`guard`） | **四门全绿、EXIT 0 ×4**（收尾复跑 20:43:09–20:43:48 CST；store 腿 **8 文件／110 用例**全过，含本件 7/7；详见 §六） |
| 8 | 生产码零改动（本单） | 只落 2 个新件（测试＋本报告），`src/**`、旧测试、其它包零写（§七-1） |
| 9 | 未解决缺口 | GAP-V2-01／DEC-OPEN-14 对账规则未裁（两账分列不判等，§四-3）；生产侧无恢复 API（恢复=人工显式，§五）；演练只在 tmp 库做，未对真实台账库执行（§七-2） |

**一句话**：MIG-04 入口条件②③已闭合——快照（备份＋sha256）、人工显式恢复、删库重建零重放、同输入可重跑的演练链路在 v15 库上全绿；`node:sqlite` 版本与 `user_version`／`schema_version` 已记录在案；回滚面按 §五显式声明「不承诺自动回滚」。

---

## 一、环境记录（入口条件③：node:sqlite 版本与 user_version）

全部命令仓根执行；`$ ` 后为实际命令，紧随的 `EXIT=` 为退出码。

```text
$ mise exec -- bun --version
1.4.3
EXIT=0

$ mise exec -- node --version
v24.21.0
EXIT=0

$ mise exec -- node -e "console.log(process.versions.node, process.versions.sqlite)"
24.21.0 3.53.4
EXIT=0

$ mise --version
2026.10.11 macos-arm64 (2026-10-15)
mise WARN  mise version 2026.10.21 available
mise WARN  self-update is disabled for this install, update mise the same way you installed it
EXIT=0

$ git rev-parse HEAD
b0bb2cf3f1cba361f8dccdb742f4f692a10dc42e
EXIT=0

$ git branch --show-current
dev
EXIT=0

$ mise exec -- node --input-type=module -e "import{LATEST_VERSION}from'./packages/store/src/migrations.ts';console.log('LATEST_VERSION='+LATEST_VERSION)"
LATEST_VERSION=15
EXIT=0
```

库内实测（演练报告第 2 行，由 `snapshot-drill.test.ts` 的 `readEnvironment()` 在源库句柄上取值）：

| 项 | 值 | 取法 | 口径说明 |
|---|---|---|---|
| Node | `24.21.0` | `process.versions.node` | `.mise.toml` 钉版 24.21.0（docs/16-§二 Node 24 LTS） |
| node:sqlite（module 侧） | `3.53.4` | `process.versions.sqlite` | node:sqlite 内置 SQLite 版本 |
| node:sqlite（库连接侧） | `3.53.4` | `SELECT sqlite_version()` | **与 module 侧一致**（两侧不等即环境漂移，测试断言如实红） |
| `user_version` | **0** | `PRAGMA user_version` | 本仓**不用** `PRAGMA user_version` 作为版本源（`migrations.ts` 头注）；版本唯一源＝`schema_version` 表。恒 0 是**事实登记**，不是缺陷断言（同 `v14-records.test.ts` 口径） |
| `schema_version`（MAX） | **15** | `SELECT MAX(version) FROM schema_version` | 迁移到位：v14 records 表族＋v15 events 防改触发器（IMPL-04-01/02） |
| `schema_version`（全列） | `1,2,3,4,5,6,7,8,9,10,11,12,13,14,15` | `SELECT version … ORDER BY version` | 无缺号（版本单调 +1；B9 起点 13 → 本波 +2 至 15） |
| `journal_mode` | `wal` | `PRAGMA journal_mode` | driver.ts 对齐面（WAL／synchronous=NORMAL／foreign_keys=ON／busy_timeout=5000） |

> 记录口径：`node:sqlite` 版本**双侧都记**（`process.versions` 与 SQL 查询）——只记一侧等于把「运行时自报」当唯一证据；两侧相等是「同一二进制同一链接库」的机制化旁证。

---

## 二、演练命令与步骤

### 2.1 冻结命令（本单门）

```bash
mise exec -- bun run typecheck                    # 根类型门（src 面）
mise exec -- bun run typecheck:v2                 # V2 新套件类型门（只含 test/v2）
mise exec -- bun run test:v2 -- packages/store    # 本波 store 腿（MIG-04 出口门①）
mise exec -- bun run guard:boundaries             # 分层宪法门（尺寸/边/平面）
```

单件复跑（本单直接证据；排除并行泳道干扰）：

```bash
mise exec -- bun run test:v2 -- packages/store/test/v2/snapshot-drill.test.ts
mise exec -- node_modules/.bin/tsc --noEmit --target ES2024 --lib ES2024 --module nodenext \
  --moduleResolution nodenext --types node --strict --noUncheckedIndexedAccess \
  --exactOptionalPropertyTypes --noImplicitOverride --noFallthroughCasesInSwitch \
  --noUnusedLocals --noUnusedParameters --erasableSyntaxOnly --verbatimModuleSyntax \
  --isolatedModules --allowImportingTsExtensions --skipLibCheck --resolveJsonModule \
  --forceConsistentCasingInFileNames packages/store/test/v2/snapshot-drill.test.ts
```

### 2.2 演练六步（`snapshot-drill.test.ts` 的 `runDrill()` 逐段对应）

| 步 | 动作 | 落点／判据 |
|---|---|---|
| ① | 临时库 `openLedger(<tmp>/source.db)` → `migrate()` 到 **v15**；写 events 语料 **4 条**（LLM／GATE_PASS＋correlation_id／REPORT_DAILY＋note／CLOSE＋duration_ms）与 `cost_daily` 冻结样本 **3 行**（2 final：0.25＋0.5；1 adjustment：−0.05，挂 ENG-1 的 final 行） | 报告第 1–2 行；`versionBefore=15` |
| ② | `backupCostDaily(db, <tmp>/cost_daily.jsonl)` → JSONL 快照件＋`<out>.sha256` 侧车 | 报告第 3 行；sha256 双侧复算（§三-2） |
| ③ | **人工显式恢复**：新库 `openLedger(<tmp>/restored.db)`（migrate → v15）→ `restoreCostDailyExplicit()`（测试内显式 SQL，单事务）只把备份行插回 `cost_daily`；随后**再恢复一次**验证非幂等 | 报告第 4 行；恢复 3 行／0.7 USD；恢复库 events=0；第二次恢复被 `idx_cost_daily_final` partial UNIQUE 拒且行数不变 |
| ④ | `dumpEvents(<tmp>/events.jsonl)` → 删源库三件套（`db`/`-wal`/`-shm`）→ `rebuild(eventsJsonl, <tmp>/rebuilt.db)` | 报告第 5 行；events 重放 4 条、`cost_daily` 0 行、`excludedDomains=['cost_daily']` |
| ⑤ | 环境记录（§一表）在①的源库句柄上取值 | 报告第 2 行；`user_version`/`schema_version` 全列 |
| ⑥ | 同输入第二次 `runDrill(<tmp>/run-b)` 并与首次逐项比对 | 备份件字节／sha／侧车／恢复行集／报告行全等 |

语料为**确定性合成**（`fixtures.ts`：ULID 时间位＝ts、随机位＝序号；无 `crypto` 随机、不读环境、不依赖系统时钟）——故「同输入恒同字节」可判，两次演练不是靠重跑刷绿（`vitest.v2.config.ts` `retry: 0`）。

---

## 三、演练结果（原始输出）

### 3.1 演练报告（`renderDrillReport()` 原文，8 行；路径只出 basename 以保证可重跑）

```text
快照/回滚演练（DOM-04 限域：只备份不重放；备份＝恢复语义，非重建语义）
环境：node=24.21.0；node:sqlite=3.53.4（process.versions.sqlite）；sqlite_version()=3.53.4；user_version=0；schema_version=v15（1,2,3,4,5,6,7,8,9,10,11,12,13,14,15）；journal_mode=wal
快照：cost_daily → cost_daily.jsonl（3 行；sha256=e00aa2edfe15bf34845d3ece78e26b85504b0069446f8a68723bcf2ecaaa5f34；侧车 cost_daily.jsonl.sha256）
恢复（人工显式）：restored.db ← cost_daily.jsonl（3 行；合计 0.7 USD；events 0 条——备份不含 events，不随恢复）
重建：删库三件套 → rebuild 重放 events 4 条（schema v15）；cost_daily 0 行（排除域不重放）
排除域：cost_daily（DOM-04 只备份不重放，遗留不可重建；备份=恢复语义，非重建语义——钱账未重建）
回滚边界：快照恢复=人工显式执行（本演练在生产侧无恢复/回滚 API）；不可逆迁移显式声明，不承诺自动回滚（v2/16 §五）
演练 PASS
```

### 3.2 备份件（JSONL 全文；3 行＋尾换行）

```jsonl
{"id":"01M5K7S28000000000000000W4","company":"games","person_id":"ENG-1","model":"deepseek/deepseek-flash","cost_date":"2026-10-23","tokens_in":1000,"tokens_out":500,"cache_read":0,"cache_creation":0,"price_snapshot_id":"models-yaml:deepseek/deepseek-flash","cost_usd":0.25,"basis":"shadow","kind":"final","adjusts_id":null,"closed_at":1792720800000,"closed_by":"cost-close:2026-10-23","note":"日终首冻"}
{"id":"01M5K7S28000000000000000W6","company":"games","person_id":"ENG-1","model":"deepseek/deepseek-flash","cost_date":"2026-10-23","tokens_in":1000,"tokens_out":500,"cache_read":0,"cache_creation":0,"price_snapshot_id":"models-yaml:deepseek/deepseek-flash","cost_usd":-0.05,"basis":"shadow","kind":"adjustment","adjusts_id":"01M5K7S28000000000000000W4","closed_at":1792720800000,"closed_by":"cost-adjust:2026-10-23","note":"迟到事实"}
{"id":"01M5K7S28000000000000000W5","company":"games","person_id":"ENG-2","model":"deepseek/deepseek-flash","cost_date":"2026-10-23","tokens_in":1000,"tokens_out":500,"cache_read":0,"cache_creation":0,"price_snapshot_id":"models-yaml:deepseek/deepseek-flash","cost_usd":0.5,"basis":"shadow","kind":"final","adjusts_id":null,"closed_at":1792720800000,"closed_by":"cost-close:2026-10-23","note":null}
```

键序＝`COST_DAILY_BACKUP_COLUMNS`（17 列冻结）；行序＝`(cost_date, person_id, model, id)` 升序（ENG-1 final → ENG-1 adjustment → ENG-2 final）；`adjusts_id`/`note` 缺值写 `null`（不省键）；负 delta `-0.05` **原值保留**（不取绝对值）。侧车内容：`e00aa2…5f34  cost_daily.jsonl\n`（sha256sum 可读形）。

### 3.3 sha256 复算（第三方工具链，不依赖生产实现）

```text
$ shasum -a 256 <按 §3.2 三行字节重存的文件>
e00aa2edfe15bf34845d3ece78e26b85504b0069446f8a68723bcf2ecaaa5f34  <file>
```

与报告第 3 行／生产返回值／侧车三方一致（测试内另有 `node:crypto` 独立复算、`verifyBackup` 正向＋`sha256:` 前缀形双向断言）。

### 3.4 恢复与重建的判据（测试断言原文对应）

| 判据 | 实测 | 断言方式（`snapshot-drill.test.ts`） |
|---|---|---|
| 恢复行数＝备份行数 | 3 = 3 | `restoredRows === backupLines === SEALED_ROWS` |
| 恢复金额＝备份金额 | 0.25＋0.5−0.05 = **0.7 USD**（源库合计／备份件合计／恢复库合计**三侧同数**，同序求和后归一到 1e-9） | `backupUsd === sealedUsd`、`restoredUsd === backupUsd`、`sealedUsd === 0.7` |
| 恢复**无损** | 恢复库按备份列序/行序重导的 JSONL 与备份件**逐字节相同**；其 sha256 复算＝备份摘要 | `restoredJsonl === backupBytes`、`sha256Hex(restoredJsonl) === backupSha256` |
| events 不在备份内 | 备份行只有 17 个 `cost_daily` 列；4 个事件 id 在备份件中零命中；备份行数 3 ≠ 事件数 4 | 列集断言＋逐事件 id `not.toContain`＋`backupLines !== eventsWritten` |
| events 不随恢复 | 恢复库 `queryEvents()` = **0** | `restoredEvents === 0` |
| 恢复非幂等 | 第二次恢复被 `idx_cost_daily_final` partial UNIQUE 拒（单事务回滚、行数仍 3；错误消息断言 `/UNIQUE/i`，不静默吞任意错误） | `doubleRestoreRejected === true`、`doubleRestoreError` 匹配 `/UNIQUE/i`、`restoredRowsAfterSecond === restoredRows` |
| 重建重放 events | 4 条，全列 deep-equal（含 ULID 序、四桶 canonical 序） | `eventsRoundTrip === true`、`rebuiltEvents === eventsWritten` |
| 重建排除 cost_daily | 重建库 `listCostDaily()` = **0 行** | `replayedCostRows === 0`、`rebuiltExcluded === ['cost_daily']` |
| 可重跑 | 两次演练：备份字节／sha／侧车／恢复 JSONL／报告 8 行全等 | 第二次 `runDrill()` 逐项 `toBe` |

---

## 四、排除域声明（cost_daily 未重建）

1. **范围**：`rebuild`／`drill`／`dump` 的重放与导出范围**只有 events**；`cost_daily`（DOM-04）在排除域清单（`EXCLUDED_DOMAINS`，单点定义于 `packages/store/src/backup.ts`），**只备份不重放**。
2. **本演练的零重放证据**：删库三件套到位（`db`/`-wal`/`-shm` 全删）后 `rebuild` 重建出的库中 `cost_daily` **0 行**；排除域清单/理由/备份引用由 `RebuildResult.excludedDomains` 与报告段显式登记，报告末行结论为「演练 PASS」而非「钱账已重建」。
3. **两账不判等**：备份恢复值（`0.7 USD`）与事件账 `cost_usd` 投影值**分列**、不合并、不作一致性结论——`cost_daily` 与记录族成本账的对账规则**未决**（`docs/v2/17` GAP-V2-01；`docs/plan/03` §五入口条件④ DEC-OPEN-14 出口前须裁）。本演练**不**声称两账一致，也**不**以备份值抹平投影值。
4. **遗留不可重建**：`cost_daily` 为定型 append-only 账（v12 触发器拒 UPDATE/DELETE；本演练两次恢复均被库侧约束/触发器面拦在合法边界内），84b 抉择 7 定案为「只备份不重放，遗留不可重建」——备份术＝**恢复**语义，非重建语义。

---

## 五、恢复边界（人工显式，不自动回滚）

1. **生产侧无恢复/回滚 API**：`backup.ts` 只有备份（`backupCostDaily`）、读回（`readCostDailyBackup`）、校验（`verifyBackup`/`sha256Hex`）三面；**没有**自动恢复或自动回滚入口（测试断言 `Object.keys(backupFace)` 中无 `restore|rollback` 命名）。恢复动作只以**人工显式**形式存在于本演练（`restoreCostDailyExplicit()`，测试内显式 SQL，单事务原子）。
2. **恢复须显式给出备份件与目标库**：无「按库自动找备份」路径；不幂等——重复恢复被 `idx_cost_daily_final` 拒（不静默双写），需人工处置。恢复**只覆盖 `cost_daily`**：events 不在备份内，恢复库 events=0（事件账的恢复/重建走 `rebuild` 的 events 通道，两通道不混）。
3. **不可逆迁移显式声明**（v2/16 §五 MIG-04 回滚列原文口径）：v14/v15 迁移为纯增量（建表/索引/触发器），**不承诺自动回滚**；回退＝快照（备份件＋sha256）＋人工显式处置。本演练证明的是「快照可用、恢复可判、两侧摘要一致」，**不是**「一键回滚已实现」。
4. **备份≠重建**：报告第 6 行固定写「钱账未重建」；任何演练/导出报告不得把备份写作钱账重建完成（v2/16 §四-2）。

---

## 六、门禁证据（原始输出与归属）

### 6.1 as-run（2026-10-28 20:39–20:40 CST；仓根）

| # | 命令 | 期望 | 实测 | 归属 |
|---|---|---|---|---|
| 1 | `mise exec -- bun run typecheck` | exit 0 | **EXIT=0**（stdout 空） | 通过 |
| 2 | `mise exec -- bun run test:v2 -- packages/store/test/v2/snapshot-drill.test.ts` | 本件绿 | **7/7 用例 passed**（1 文件；多次单跑 124–275ms） | **本单通过** |
| 3 | 单件 tsc（§2.1 同参数，仅本文件） | 0 错 | **EXIT=0** | **本单通过** |
| 4 | `mise exec -- bun run guard:boundaries`（本件落位后首次） | PASS | **PASS：729 文件（范围面代码件 587），0 违例** | 本件未触线（as-run 时 551 行／终态 572 行，均<600；store/test/v2 目录 as-run 时 7 文件<25） |
| 5 | `mise exec -- bun run typecheck:v2`（as-run） | 0 错 | **EXIT=2**：`hist.test.ts(28,46) TS6133 'HistRecord' / (28,63) 'HistTx' declared but never read` | **并行泳道 IMPL-04-06 的 in-flight 件**（非本单；本件零错，见 #3） |
| 6 | `mise exec -- bun run test:v2 -- packages/store`（as-run） | 绿 | **EXIT=1**：7 文件／108 用例，`hist.test.ts` 2 例红（`succeeded 106`）；**本件 7/7 绿、其余 5 文件全绿** | 红因＝**IMPL-04-06 的 `hist.test.ts`**（`tx-foreign` 断言不符、`reconcile disorder` 断言不符），非本单 |
| 7 | `mise exec -- bun run guard:boundaries`（as-run，20:39 后） | PASS | **EXIT=1**：`[BC-S2] packages/store/test/v2/hist.test.ts —— 696 行 > 阈 600`，1 违例 | **IMPL-04-06 新件超限**（禁入基线＝提案流）；本件 551 行（as-run 时点）未触线 |

**读者须知（不隐瞒）**：上述 #5–#7 三条共享门在 20:39–20:40 的 as-run 为红，**唯一红因是并行泳道 IMPL-04-06 刚落盘的 `packages/store/test/v2/hist.test.ts`（696 行超限＋2 条断言不符＋2 个未用 import）**；该件不在本单领土，本单未改其一字。本单直接证据（#2/#3/#4 与 §三全部演练判据）为绿。该 in-flight 件在随后数分钟内被其泳道拆分为 `hist-append.test.ts`（367 行）／`hist-query.test.ts`（257 行）／`hist-fixtures.ts`（195 行）并清除了 `hist.test.ts`——as-run 行保留当时原样，最终态见 §6.2 复跑；本报告不因他件修复而回填/美化 as-run 行。

### 6.2 收尾复跑（共享门转绿证据）

> 复跑时点：**2026-10-28T20:43:09+0800 起**（`RUN_AT` 打点；命令与 §6.1 相同，仓根、`mise exec --` 前缀）。此时并行泳道 IMPL-04-06 的 in-flight 件已拆分为 `hist-append.test.ts`(28)／`hist-query.test.ts`(17)／`hist-fixtures.ts`，`hist.test.ts` 已删除；共享门恢复全绿。

| # | 命令 | 实测输出（原样） | exit |
|---|---|---|---|
| 1 | `mise exec -- bun run typecheck` | `$ tsc --noEmit`（stdout 空＝零 TS 错） | **0** |
| 2 | `mise exec -- bun run typecheck:v2` | `$ tsc --noEmit -p tsconfig.v2.json`（零错） | **0** |
| 3 | `mise exec -- bun run test:v2 -- packages/store` | 见下逐文件：`Test Files 8 passed (8)` / `Tests 110 passed (110)` | **0** |
| 4 | `mise exec -- bun run guard:boundaries` | `边界门禁 PASS：扫描 732 文件（范围面代码件 590），0 违例（分层宪法 20-§十五）` | **0** |

store 腿逐文件（20:43:48 起跑；本件为第 7 行）：

```text
✓ packages/store/test/v2/v14-records.test.ts (23 tests) 122ms
✓ packages/store/test/v2/obs-projection.test.ts (14 tests) 470ms
✓ packages/store/test/v2/events-trigger.test.ts (9 tests) 189ms
✓ packages/store/test/v2/hist-append.test.ts (28 tests) 485ms
✓ packages/store/test/v2/hist-query.test.ts (17 tests) 519ms
✓ packages/store/test/v2/backup.test.ts (7 tests) 455ms
✓ packages/store/test/v2/snapshot-drill.test.ts (7 tests) 508ms   ← 本单
✓ packages/store/test/v2/rebuild-exclusion.test.ts (5 tests) 774ms

 Test Files  8 passed (8)
      Tests  110 passed (110)
```

结论：**四门全绿**（4/4 exit 0）；本件 7 用例在共享腿中全过，且 `guard` 对本件尺寸（572 行）零违例。§6.1 的 as-run 红只作为「共享门会被并行 in-flight 件染红、故须按件归属」的过程证据保留，不回填、不美化。

### 6.3 终检（本件定稿时点）

> 20:44:37 起再跑一次四门（本件定稿态：572 行；sha256 `7b8e593f1b276c5267f85c6b59af337aaa5b6905f0768bce028453e8bc030b6f`），结果与 §6.2 一致：`typecheck` **0** / `typecheck:v2` **0** / `guard:boundaries` **0**（732 文件、范围面代码件 590、0 违例）/ `test:v2 -- packages/store` **0**（8 文件、**110 用例**全过，本件 7/7）。共享腿此后若因其它泳道继续追加文件而变化，以各自波次的门禁记录为准；本件绿证据锚定在上列时点与本件指纹。

---

## 七、缺口、未证与领土声明

1. **领土与改动面**：本单只新增 `packages/store/test/v2/snapshot-drill.test.ts`（572 行，<600）与本文件。`src/**`、旧测试、其它包**零写**；不 git commit。工作树中 `packages/store/src/*` 的未提交改动属 MIG-04 前序单（IMPL-04-01..04/06/08）与并行泳道，非本单产物。
2. **演练只在 tmp 库**：源库/恢复库/重建库全部在 `os.tmpdir()` 下新建的临时目录（`mkdtemp`），**不对真实台账库**执行删库/恢复；这符合演习纪律（`drill.ts` 头注「不拿真实台账演习」），但也意味着**未在真实数据规模/真实 WAL 状态下演练**（未证）。
3. **GAP-V2-01／DEC-OPEN-14 未决**：`cost_daily` 与新成本事件账的对账规则未裁——本演练按 §四-3 **分列不判等**，不构成对账结论；MIG-04 出口前仍须裁决（plan/03 §五入口条件④）。
4. **`user_version` 恒 0**：本仓版本唯一源是 `schema_version` 表（`migrations.ts` 头注）；`PRAGMA user_version` 不作版本口径，恒 0 是事实登记。跨实现的 `user_version` 语义差异见 `docs/audit-DSF/V11` V11-07（登记在案，本单不改口径）。
5. **无自动回滚**：§五已声明——生产侧无恢复/回滚 API；若后续波次新增自动恢复入口，须走提案流并同步改本报告与 `snapshot-drill` 的边界断言。
6. **环境记录的单机性**：node/bun/sqlite 版本取自本机钉版工具链（`.mise.toml`）；换机/换版本须重跑本演练并追加环境记录代（不覆盖本代）。

---

## 八、PASS / FAIL 判定

| 判定项 | 结论 |
|---|---|
| 快照（备份件＋sha256 侧车，可复算） | **PASS** |
| 恢复（人工显式、只恢复 cost_daily、行数/金额/字节一致） | **PASS** |
| 排除域（删库重建零重放 `cost_daily`、events 重放成功） | **PASS** |
| 环境记录（node:sqlite 双侧版本、`user_version`、`schema_version` 全列） | **PASS** |
| 可重跑（同输入两次字节一致） | **PASS** |
| 本件门（单件 7/7 绿＋单件 tsc 0 错＋`typecheck` EXIT 0＋guard 本件未触线） | **PASS** |
| 共享门（`typecheck:v2`／`test:v2 -- packages/store`／`guard`） | **PASS**（收尾复跑 20:43:09–20:43:48：exit 0 ×3；store 腿 8 文件／110 用例全过；as-run 红的唯一红因＝并行件 `hist.test.ts`，已在 §6.1 精确归属，非本单） |

> **演练结论行（冻结）**：`演练 PASS`。本报告不据此宣称「钱账已重建」「自动回滚已实现」或「对账已一致」——三者分别受 §四-3/§四-4、§五-3、§七-3 约束。
