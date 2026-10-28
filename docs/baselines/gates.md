# 门禁证据（gates）· MIG-02

> 版本：**v1**｜2026-10-28｜编写：MIG-02 施工代理（DeepSeek-V41-Flash）｜性质：**本波门禁的原始输出留档**——只记跑过什么、原样输出是什么、exit 多少；不加工、不摘要掉失败。
> 依据：plan/03 §三（MIG-02 出口门禁）、plan/04 §1.9.3/§1.9.4（命令与「V2 新套件绿」九条阈值）、plan/04 §二 MIG-02 行、plan/05 IMPL-02-01..04、docs/86 B5（「连续 3 次」过门证据）、docs/90 §三 R5（37/20 数值口径）。
> 全部命令在仓根以 `mise exec --` 前缀执行（v2/13 §0.2 证据口径；node v24.21.0 / bun 1.4.3）。

---

## 〇、验收结论（逐条）

| # | 验收项（冻结命令） | 期望 | 实测 | 证据 |
|---|---|---|---|---|
| 1 | `mise exec -- bun run typecheck:v2` | exit 0 | **exit 0**（零输出即零 TS 错） | §三.1 |
| 2 | `mise exec -- bun run test:v2` | exit 0（冒烟 2 条） | **exit 0，1 文件 / 2 用例全过** | §三.2 |
| 3 | `mise exec -- node scripts/verify/v2-suite-manifest.mjs` | exit 0 | **exit 0**（5/5 检查） | §三.3 |
| 4 | `mise exec -- node scripts/verify/old-test-ledger.mjs` | exit 0 | **exit 0**（7/7 检查） | §三.4 |
| 5 | `mise exec -- bun run verify:v2` 连续 3 次 | exit 0 ×3 | **exit 0 ×3**（16:42:08→16:42:58 CST 连跑） | §四 |
| 6 | 旧 `bun run test` | **不要求绿**，只观察 | 未在本波重跑：观察位＝16:28 全量 JSON（`20 failed / 13 failed files / exit 1`），逐条入台账 | §六 |
| 7 | 生产码零改动 | `git status --porcelain -- apps packages scripts templates` 只含新增 `test/v2` 与 `scripts/verify` | **符合**（仅 `packages/contract/test/v2/`、`scripts/verify/`；`src` 零改动） | §七 |
| 8 | 契约 case 零新增 | `cases.json` 53 条不动 | **符合**（未改 `cases.json`） | §七 |

**一句话**：V2 新套件门五条命令全绿且 `verify:v2` 连续 3 次 exit 0；旧套件按裁决留在观察位（红入台账、不作门），本波未以任何形式改旧测试或生产码。

---

## 一、四单产物与落位

| 单 | 交付物 | 落位 | 验收命令 | 结果 |
|---|---|---|---|---|
| **IMPL-02-01** V2 新套件脚手架＋清单自检＋冒烟 | `vitest.v2.config.ts`[新]、`scripts/verify/v2-suite-manifest.mjs`[新]、`packages/contract/test/v2/smoke.test.ts`[新] | 全部落位 | `node_modules/.bin/vitest run --config vitest.v2.config.ts`（用例>0）；`node scripts/verify/v2-suite-manifest.mjs` | 2 用例全过；manifest 5/5 exit 0 |
| **IMPL-02-02** 旧测试逐文件台账 | `docs/baselines/old-tests-ledger.md`[新]（209 行＋口径差 1 行＋13 红文件行＋20 红用例）、`scripts/verify/old-test-ledger.mjs`[新] | 全部落位 | `node scripts/verify/old-test-ledger.mjs` | 7/7 exit 0 |
| **IMPL-02-03** 新套件类型门 | `tsconfig.v2.json`[新]（extends `tsconfig.base.json`；include 仅 `apps/*/test/v2/**`、`packages/*/test/v2/**`；`noEmit`；不放宽 strict） | 落位 | `tsc --noEmit -p tsconfig.v2.json`；`git diff tsconfig.base.json`＝空 | exit 0；base 零改动 |
| **IMPL-02-04** 门禁/审验串接 | 根 `package.json` scripts 新增 `typecheck:v2`/`test:v2`/`verify:v2`（旧 `test` 原样保留） | 落位 | `bun run verify:v2` ×3 | exit 0 ×3 |

产物文件清单（本波全部新增/修改）：

| 文件 | 类型 | 说明 |
|---|---|---|
| `vitest.v2.config.ts` | 新 | include 仅 `test/v2`；`retry: 0`；`testTimeout: 60_000` |
| `tsconfig.v2.json` | 新 | 只覆盖 `test/v2`；类型门与根 src 门分离 |
| `scripts/verify/v2-suite-manifest.mjs` | 新 | 套件清单自检（5 项） |
| `scripts/verify/old-test-ledger.mjs` | 新 | 台账机械校验（7 项） |
| `packages/contract/test/v2/smoke.test.ts` | 新 | 2 条脚手架冒烟（**不冒充业务覆盖**） |
| `docs/baselines/old-tests-ledger.md` | 新 | 旧测试台账（209＋1 行／13 红文件／20 红用例） |
| `docs/baselines/gates.md` | 新 | 本件 |
| `package.json` | 改 | 只加 3 个 scripts，旧 `test` 语义不变 |

---

## 二、冻结命令（本波落位后生效）

```bash
mise exec -- bun run typecheck:v2    # tsc --noEmit -p tsconfig.v2.json（只含 test/v2）
mise exec -- bun run test:v2         # vitest run --config vitest.v2.config.ts（禁 --passWithNoTests）
mise exec -- bun run verify:v2       # guard:boundaries → typecheck → typecheck:v2 → test:v2 → manifest → ledger
```

**兼容口径**：旧 `bun run test`（＝`guard:boundaries && vitest run --passWithNoTests`）**原样保留**、不作波门（plan/04 §1.9.3）；根 `typecheck` 仍是 src 面。本波未改任何旧脚本语义。

---

## 三、单命令原始输出

> 归一说明：以下日志**除把仓根绝对路径写作 \<repo\> 外逐字未改**（AGENTS.md §五.6：仓库不得出现本机路径）；缩进/换行/顺序均原样。

### 3.1 `typecheck:v2`

```text
$ mise exec -- bun run typecheck:v2
$ tsc --noEmit -p tsconfig.v2.json
EXIT=0
```

### 3.2 `test:v2`

```text
$ mise exec -- bun run test:v2
$ vitest run --config vitest.v2.config.ts

 RUN  v3.2.7 <repo>

 ✓ packages/contract/test/v2/smoke.test.ts (2 tests) 5ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  16:39:21
   Duration  1.07s (transform 122ms, setup 0ms, collect 219ms, tests 5ms, environment 0ms, prepare 264ms)

EXIT=0
```

### 3.3 `v2-suite-manifest.mjs`

```text
$ mise exec -- node scripts/verify/v2-suite-manifest.mjs
[v2-suite-manifest] 注 test:v2 = vitest run --config vitest.v2.config.ts
[v2-suite-manifest] 注 typecheck:v2 = tsc --noEmit -p tsconfig.v2.json
[v2-suite-manifest] 注 verify:v2 = bun run guard:boundaries && bun run typecheck && bun run typecheck:v2 && bun run test:v2 && node scripts/verify/v2-suite-manifest.mjs && node scripts/verify/old-test-ledger.mjs
[v2-suite-manifest] OK ① include 2 个 glob，全部只含 test/v2
[v2-suite-manifest] OK ② test/v2 测试文件 1 件（test/v2 下 .ts 共 1 件），静态用例 2 条
[v2-suite-manifest] OK ③ 禁标记 skip/only/todo/retry 命中 0 处
[v2-suite-manifest] OK ④ test:v2 无 --passWithNoTests / --retry，指向 vitest.v2.config.ts
[v2-suite-manifest] OK ⑤ 配置 retry: 0
v2-suite-manifest PASS：V2 新套件清单自检 5/5（plan/04 §1.9.2/§1.9.4）
EXIT=0
```

### 3.4 `old-test-ledger.mjs`

```text
$ mise exec -- node scripts/verify/old-test-ledger.mjs
[old-test-ledger] 注 仓内旧测试件 209 件（剔除 test/v2），台账主表 209 行：绿 196 / 红 13
[old-test-ledger] OK ① 209 .test.ts 全覆盖：与仓内 walk 逐项相等（209 件，0 缺 0 多）
[old-test-ledger] OK ② 口径差 1 行：scripts/guards/boundaries.test.mjs
[old-test-ledger] OK ③ 八列齐全、处置/责任波/理由无空、理由均写「观察位/非门」
[old-test-ledger] OK ④ 红文件 13 个（§四登记 13 个），绿 196 个（合计 209）
[old-test-ledger] OK ⑤ 红用例 20 条逐条有归属，且逐文件与「败」列相等
[old-test-ledger] OK ⑥ 含「审计基线 37 / 实测 20」口径说明与数据源标注（不冒充、不互否）
[old-test-ledger] OK ⑦ 无 test/v2 路径混入、无重复、无「未登记」占位
old-test-ledger PASS：旧测试台账自检 7/7（plan/04 §1.8.4）
EXIT=0
```

---

## 四、`verify:v2` 连续 3 次 exit 0（原始输出／时间）

三次连跑在同一终端、同一工作区、无中间改动；每次完整输出如下（含 guard/typecheck 前置两段）。

```text
=================== RUN 1 ===================
start: 2026-10-28 16:42:08 CST
$ bun run guard:boundaries && bun run typecheck && bun run typecheck:v2 && bun run test:v2 && node scripts/verify/v2-suite-manifest.mjs && node scripts/verify/old-test-ledger.mjs
$ node scripts/guards/boundaries.mjs
边界门禁 PASS：扫描 628 文件（范围面代码件 500），0 违例（分层宪法 20-§十五）
$ tsc --noEmit
$ tsc --noEmit -p tsconfig.v2.json
$ vitest run --config vitest.v2.config.ts

 RUN  v3.2.7 <repo>

 ✓ packages/contract/test/v2/smoke.test.ts (2 tests) 2ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  16:42:24
   Duration  1.13s (transform 147ms, setup 0ms, collect 326ms, tests 2ms, environment 0ms, prepare 225ms)

[v2-suite-manifest] 注 test:v2 = vitest run --config vitest.v2.config.ts
[v2-suite-manifest] 注 typecheck:v2 = tsc --noEmit -p tsconfig.v2.json
[v2-suite-manifest] 注 verify:v2 = bun run guard:boundaries && bun run typecheck && bun run typecheck:v2 && bun run test:v2 && node scripts/verify/v2-suite-manifest.mjs && node scripts/verify/old-test-ledger.mjs
[v2-suite-manifest] OK ① include 2 个 glob，全部只含 test/v2
[v2-suite-manifest] OK ② test/v2 测试文件 1 件（test/v2 下 .ts 共 1 件），静态用例 2 条
[v2-suite-manifest] OK ③ 禁标记 skip/only/todo/retry 命中 0 处
[v2-suite-manifest] OK ④ test:v2 无 --passWithNoTests / --retry，指向 vitest.v2.config.ts
[v2-suite-manifest] OK ⑤ 配置 retry: 0
v2-suite-manifest PASS：V2 新套件清单自检 5/5（plan/04 §1.9.2/§1.9.4）
[old-test-ledger] 注 仓内旧测试件 209 件（剔除 test/v2），台账主表 209 行：绿 196 / 红 13
[old-test-ledger] OK ① 209 .test.ts 全覆盖：与仓内 walk 逐项相等（209 件，0 缺 0 多）
[old-test-ledger] OK ② 口径差 1 行：scripts/guards/boundaries.test.mjs
[old-test-ledger] OK ③ 八列齐全、处置/责任波/理由无空、理由均写「观察位/非门」
[old-test-ledger] OK ④ 红文件 13 个（§四登记 13 个），绿 196 个（合计 209）
[old-test-ledger] OK ⑤ 红用例 20 条逐条有归属，且逐文件与「败」列相等
[old-test-ledger] OK ⑥ 含「审计基线 37 / 实测 20」口径说明与数据源标注（不冒充、不互否）
[old-test-ledger] OK ⑦ 无 test/v2 路径混入、无重复、无「未登记」占位
old-test-ledger PASS：旧测试台账自检 7/7（plan/04 §1.8.4）
end:   2026-10-28 16:42:26 CST
EXIT CODE: 0
=================== RUN 2 ===================
start: 2026-10-28 16:42:26 CST
$ bun run guard:boundaries && bun run typecheck && bun run typecheck:v2 && bun run test:v2 && node scripts/verify/v2-suite-manifest.mjs && node scripts/verify/old-test-ledger.mjs
$ node scripts/guards/boundaries.mjs
边界门禁 PASS：扫描 628 文件（范围面代码件 500），0 违例（分层宪法 20-§十五）
$ tsc --noEmit
$ tsc --noEmit -p tsconfig.v2.json
$ vitest run --config vitest.v2.config.ts

 RUN  v3.2.7 <repo>

 ✓ packages/contract/test/v2/smoke.test.ts (2 tests) 3ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  16:42:40
   Duration  1.14s (transform 149ms, setup 0ms, collect 348ms, tests 3ms, environment 0ms, prepare 141ms)

[v2-suite-manifest] 注 test:v2 = vitest run --config vitest.v2.config.ts
[v2-suite-manifest] 注 typecheck:v2 = tsc --noEmit -p tsconfig.v2.json
[v2-suite-manifest] 注 verify:v2 = bun run guard:boundaries && bun run typecheck && bun run typecheck:v2 && bun run test:v2 && node scripts/verify/v2-suite-manifest.mjs && node scripts/verify/old-test-ledger.mjs
[v2-suite-manifest] OK ① include 2 个 glob，全部只含 test/v2
[v2-suite-manifest] OK ② test/v2 测试文件 1 件（test/v2 下 .ts 共 1 件），静态用例 2 条
[v2-suite-manifest] OK ③ 禁标记 skip/only/todo/retry 命中 0 处
[v2-suite-manifest] OK ④ test:v2 无 --passWithNoTests / --retry，指向 vitest.v2.config.ts
[v2-suite-manifest] OK ⑤ 配置 retry: 0
v2-suite-manifest PASS：V2 新套件清单自检 5/5（plan/04 §1.9.2/§1.9.4）
[old-test-ledger] 注 仓内旧测试件 209 件（剔除 test/v2），台账主表 209 行：绿 196 / 红 13
[old-test-ledger] OK ① 209 .test.ts 全覆盖：与仓内 walk 逐项相等（209 件，0 缺 0 多）
[old-test-ledger] OK ② 口径差 1 行：scripts/guards/boundaries.test.mjs
[old-test-ledger] OK ③ 八列齐全、处置/责任波/理由无空、理由均写「观察位/非门」
[old-test-ledger] OK ④ 红文件 13 个（§四登记 13 个），绿 196 个（合计 209）
[old-test-ledger] OK ⑤ 红用例 20 条逐条有归属，且逐文件与「败」列相等
[old-test-ledger] OK ⑥ 含「审计基线 37 / 实测 20」口径说明与数据源标注（不冒充、不互否）
[old-test-ledger] OK ⑦ 无 test/v2 路径混入、无重复、无「未登记」占位
old-test-ledger PASS：旧测试台账自检 7/7（plan/04 §1.8.4）
end:   2026-10-28 16:42:41 CST
EXIT CODE: 0
=================== RUN 3 ===================
start: 2026-10-28 16:42:41 CST
$ bun run guard:boundaries && bun run typecheck && bun run typecheck:v2 && bun run test:v2 && node scripts/verify/v2-suite-manifest.mjs && node scripts/verify/old-test-ledger.mjs
$ node scripts/guards/boundaries.mjs
边界门禁 PASS：扫描 628 文件（范围面代码件 500），0 违例（分层宪法 20-§十五）
$ tsc --noEmit
$ tsc --noEmit -p tsconfig.v2.json
$ vitest run --config vitest.v2.config.ts

 RUN  v3.2.7 <repo>

 ✓ packages/contract/test/v2/smoke.test.ts (2 tests) 5ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  16:42:56
   Duration  1.14s (transform 138ms, setup 0ms, collect 338ms, tests 5ms, environment 0ms, prepare 185ms)

[v2-suite-manifest] 注 test:v2 = vitest run --config vitest.v2.config.ts
[v2-suite-manifest] 注 typecheck:v2 = tsc --noEmit -p tsconfig.v2.json
[v2-suite-manifest] 注 verify:v2 = bun run guard:boundaries && bun run typecheck && bun run typecheck:v2 && bun run test:v2 && node scripts/verify/v2-suite-manifest.mjs && node scripts/verify/old-test-ledger.mjs
[v2-suite-manifest] OK ① include 2 个 glob，全部只含 test/v2
[v2-suite-manifest] OK ② test/v2 测试文件 1 件（test/v2 下 .ts 共 1 件），静态用例 2 条
[v2-suite-manifest] OK ③ 禁标记 skip/only/todo/retry 命中 0 处
[v2-suite-manifest] OK ④ test:v2 无 --passWithNoTests / --retry，指向 vitest.v2.config.ts
[v2-suite-manifest] OK ⑤ 配置 retry: 0
v2-suite-manifest PASS：V2 新套件清单自检 5/5（plan/04 §1.9.2/§1.9.4）
[old-test-ledger] 注 仓内旧测试件 209 件（剔除 test/v2），台账主表 209 行：绿 196 / 红 13
[old-test-ledger] OK ① 209 .test.ts 全覆盖：与仓内 walk 逐项相等（209 件，0 缺 0 多）
[old-test-ledger] OK ② 口径差 1 行：scripts/guards/boundaries.test.mjs
[old-test-ledger] OK ③ 八列齐全、处置/责任波/理由无空、理由均写「观察位/非门」
[old-test-ledger] OK ④ 红文件 13 个（§四登记 13 个），绿 196 个（合计 209）
[old-test-ledger] OK ⑤ 红用例 20 条逐条有归属，且逐文件与「败」列相等
[old-test-ledger] OK ⑥ 含「审计基线 37 / 实测 20」口径说明与数据源标注（不冒充、不互否）
[old-test-ledger] OK ⑦ 无 test/v2 路径混入、无重复、无「未登记」占位
old-test-ledger PASS：旧测试台账自检 7/7（plan/04 §1.8.4）
end:   2026-10-28 16:42:58 CST
EXIT CODE: 0
```

| 次 | 开始（CST） | 结束（CST） | 耗时 | exit | 关键行 |
|---|---|---|---|---|---|
| 1 | 2026-10-28 16:42:08 | 16:42:26 | 18s | **0** | 边界门禁 PASS（628 文件 / 0 违例）／Test Files 1 passed（2 tests）／manifest 5/5／ledger 7/7 |
| 2 | 2026-10-28 16:42:26 | 16:42:41 | 15s | **0** | 边界门禁 PASS（628 文件 / 0 违例）／Test Files 1 passed（2 tests）／manifest 5/5／ledger 7/7 |
| 3 | 2026-10-28 16:42:41 | 16:42:58 | 17s | **0** | 边界门禁 PASS（628 文件 / 0 违例）／Test Files 1 passed（2 tests）／manifest 5/5／ledger 7/7 |

**「连续 3 次」的意义**（docs/86 B5）：单次通过不算过门证据，防的是时序 flaky（旧套件 20 红里 19 条正是 timeout 族）。三次全绿＝V2 腿未见时序不稳定。

---

## 五、负测（反证）：校验器真的会红

「验证器永远 exit 0」是最容易被伪造的过门方式，故对两个校验器各做变异测试（在临时 `--root` 树里改受检物，不动工作区）。**11 个变异全部按预期 exit 1**，未变异基线 exit 0：

**`v2-suite-manifest.mjs`（临时树，基线 exit 0）**

| # | 变异 | 期望 | 实测 exit | 命中诊断（首行摘要） |
|---|---|---|---|---|
| 1 | include 追加旧测试 glob `packages/contract/test/**/*.test.ts` | 红 | **1** | include 非法 glob（旧测试路径禁入） |
| 2 | 配置 `retry: 0` → `retry: 1` | 红 | **1** | retry=1（必须 0） |
| 3 | test/v2 用例改 `it.skip` | 红 | **1** | 命中禁标记 skip |
| 4 | `test:v2` 追加 `--passWithNoTests` | 红 | **1** | test:v2 含 --passWithNoTests |
| 5 | `typecheck:v2` 去掉 `-p tsconfig.v2.json` | 红 | **1** | 未指向 tsconfig.v2.json（2 项） |

**`old-test-ledger.mjs`（临时树，基线 exit 0）**

| # | 变异 | 期望 | 实测 exit | 命中诊断（首行摘要） |
|---|---|---|---|---|
| 1 | 删主表 1 行（模拟无声删除） | 红 | **1** | 主表行数 208 ≠ 209 |
| 2 | 主表加 1 行仓内不存在的路径 | 红 | **1** | 主表行数 210 ≠ 209／台账多 1 件 |
| 3 | 某行「理由」列清空 | 红 | **1** | 理由为空/过短＋未写明「非门」 |
| 4 | 「审计基线 37」改成 30 | 红 | **1** | 台账缺「审计基线 37」 |
| 5 | 删 1 条红用例行 | 红 | **1** | 红用例行 19 ≠ 20＋条数 ≠「败」列 |
| 6 | 主表塞 `packages/contract/test/v2/…` 路径 | 红 | **1** | 主表混入 V2 新套件路径＋缺 1 件 |

> 说明：变异树用 `--root` 指向临时目录 ＋ 符号链接 `apps/packages/scripts`，**工作区与仓内文件零改动**；跑完即删。**两套变异均在本次最终产物（`vitest.v2.config.ts`／台账终版）上复跑过：manifest 5/5 判红、台账 6/6 判红，基线均 exit 0。**

---

## 六、旧套件：观察位（不门）

- **观察位记录（本波基准）**：2026-10-28 16:28 全量 vitest JSON（`/tmp/studio-next-vitest.json`）＝**210 files / 2976 tests / 20 failed / 13 failed files / exit 1**；逐条归属见 `docs/baselines/old-tests-ledger.md`（209 行＋口径差 1 行、13 红文件行、20 红用例）。
- **本波未重跑旧全量**：本波不改生产码、不改旧测试，重跑只会新增无归因的时序噪声；且裁决明确「旧测试不作门」，重跑无放行价值。红/绿都已在台账留档。
- **口径提示（诚实标注）**：旧 `bun run test` 没有独立 config（默认 include 全仓 `*.test.{ts,mjs}`），故它现在**会顺带收进本波新增的 `packages/contract/test/v2/` 冒烟件**——实测旧 runner 收集 **211 文件**（旧 210 ＋ V2 冒烟 1）。这不动摇「旧测试 209/210」口径：该口径由**排除 `test/v2/**`** 定义（台账与 `old-test-ledger.mjs` 均按此复算），不依赖旧 runner 的收集数。本波不为此改旧脚本（改了就等于动旧套件语义）。
  - 另注：`packages/store/test/v2-tables.test.ts` 是**旧测试**（文件名带 `v2-` 前缀，但不在 `test/v2/` 目录），仍在 209 内、台账第 227 行为绿 25/0——目录口径与命名口径不可混用。
- **触及面登记（plan/04 §1.8.5-4）**：本波触及共享文件（根 `package.json`、`tsconfig.v2.json`、新增 `vitest.v2.config.ts`；`bun run test` 也会跑到新冒烟），按路径过滤跑触及面旧测试：

```text
$ mise exec -- node_modules/.bin/vitest run <触及面 7 件>

 RUN  v3.2.7 <repo>

[studio-next-bridge] injected 33 chars from /var/folders/gz/ys8vlc1951xgg1v1_7tmnrlc0000gn/T/dsh-bridge-test-gHa0kA/instructions.md as section "studio-next:instructions" (agent=session-test-1)
[studio-next-bridge] injected 4 chars from /var/folders/gz/ys8vlc1951xgg1v1_7tmnrlc0000gn/T/dsh-bridge-test-gHa0kA/instructions-2.md as section "co:my-section" (agent=?)
[studio-next-bridge] WARN 指令未注入（status=unset）（required 默认 false，降级继续）
[studio-next-bridge] WARN agent 上下文缺 systemPrompt 服务（agent=bare），注入跳过（required 默认 false，降级继续）
 ✓ packages/dsh-bridge/test/bridge.test.ts (15 tests) 42ms
 ✓ packages/company/test/industry-templates.test.ts (14 tests) 382ms
 ✓ packages/panel/test/shell-static.test.ts (12 tests) 193ms
 ✓ scripts/guards/boundaries.test.mjs (22 tests) 1649ms
   ✓ 本仓自检（分层宪法在真仓上的终态断言——双机制之二） > runGuard 对本仓 0 违例——规则文件与真结构互证  400ms
 ✓ packages/company/test/dependencies.test.ts (27 tests) 805ms
 ✓ packages/company/test/repo-validate.test.ts (45 tests) 6827ms
   ✓ DEV-32 · E 组（卫生契约）——每规则一对夹具 > [E-4] 文件总数超 5000 资源护栏  2760ms
   ✓ DEV-32 · 面语义与共用核（docs/51-§七 判定器契约） > DEV-27 导入流两遍共用同一判定器：源仓面+产物面各一跑（validator 注入取证）  577ms
 ✓ apps/daemon/test/cli/usage-contract.test.ts (7 tests) 8446ms
   ✓ S5c 版本声明被行为兑现（--version/-V） > --version：单行 studio-next <版本>，exit 0，stderr 空  1989ms
   ✓ S5c 版本声明被行为兑现（--version/-V） > -V 短旗标同义（≡ --version）  1153ms
   ✓ S5c 退出码表被行为兑现（抽样三档） > 0：显式求助（--help）  988ms
   ✓ S5c 退出码表被行为兑现（抽样三档） > 1：用法错（顶级 typo）  1001ms
   ✓ S5c 退出码表被行为兑现（抽样三档） > 2：company validate 判定器自身错误（路径不存在）——声明中唯一的 2 面之一  907ms
   ✓ S5b 旗标同义被行为兑现（--flag=value ≡ --flag value） > 两式同效（panel --port=8799 与 --port 8799 等价收参——以可观测差异最小面验）  2399ms

 Test Files  7 passed (7)
      Tests  142 passed (142)
   Start at  16:39:34
   Duration  9.64s (transform 1.96s, setup 0ms, collect 6.11s, tests 18.34s, environment 1ms, prepare 1.46s)

EXIT=0
```

**结果**：7 文件 / 142 用例**全绿**。其中 `apps/daemon/test/cli/usage-contract.test.ts` 在 16:28 全量是红（2 条），隔离单跑 7/7 过（红过的 2 条耗时 1153ms / 2399ms）——**timeout 族 flaky 的实证对照**，已登记入台账 §4.1，不据此改台账行（台账按 16:28 实测登记、只追加）。

---

## 七、生产码零改动证据

```text
$ git status --porcelain -- apps packages scripts templates
?? packages/contract/test/v2/
?? scripts/verify/
```

- `apps/**/src`、`packages/**/src`、`templates/`：**零改动**（`git status` 无输出）。
- `scripts/guards/`：零改动（guard 规则源未动，`guard:boundaries` 同日仍 PASS：扫描 628 文件 / 0 违例）。
- `packages/contract/cases.json`：零改动（仍 version=1 / 53 条）。
- 旧测试 209 件：零改动（无 `M` 项）。
- 未 `git add`、未 `git commit`（施工纪律；提交由主代理统一处理）。

---

## 八、回滚

按 plan/03 §三「回滚」：revert 本波提交即可——根 `package.json` scripts 三行、`vitest.v2.config.ts`、`tsconfig.v2.json`、两个 `scripts/verify/*.mjs`、`docs/baselines/old-tests-ledger.md`。**旧测试与生产码零改动，回滚不触 DB/契约/模板**。

---

*本件为 MIG-02 门禁原始输出留档；旧套件不作门、旧红入台账（审计基线 37 / 实测 20）。V2 只在 F8 未过前不得标「定稿」——本件不构成 F8，也不得被引用为定稿依据。*
