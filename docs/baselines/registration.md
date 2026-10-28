# MIG-01 基线登记件 · B1–B13 初代

> **头注**
> - 日期：2026-10-28
> - git HEAD：`32aaf2a75e3978c00fd16f13948b16dcc7de8860`（分支 `dev`）
> - 工具链：bun **1.4.3** / node **v24.21.0**（仓 `.mise.toml` 固定；`mise 2026.10.11`）
> - 执行者：DeepSeek-V41-Flash（StudioNext 施工代理；IMPL-01-01 / LANE-T）
> - 性质：**MIG-01 初代基线，只读复算，不改行为**（逐波追加新代，不覆盖本代）
> - 依据：docs/v2/16-技术细节-逐文件蓝图与迁移.md §一（B1–B13 唯一登记表）、docs/plan/03-里程碑与波次.md §二（MIG-01 出口门禁）、docs/plan/05-实现单拆分清单.md IMPL-01-01、docs/plan/04-测试与验收策略.md §二 MIG-01 冻结命令
> - 口径：v2/16 §一「本次结果（2026-10-27）」＝登记值；本件为 2026-10-28 在仓内独立重跑的结果。命令均在仓根执行；本机 `bun`/`node` 仅经 `mise exec --` 可得，故统一加该前缀（v2/13 §0.2 证据口径），命令语义未改。

---

## 一、结论摘要

| 项 | 结果 |
|---|---|
| B1–B13 数值复现 | **13/13 一致**（0 项不可复算；B1 复算命令字面有缺陷，见 §二-B1） |
| 分层宪法门禁 | `mise exec -- bun run guard:boundaries` → **PASS，exit 0**（627 文件 / 范围面 499 / 0 违例） |
| 根类型门禁 | `mise exec -- bun run typecheck` → **exit 0**（仅覆盖 `src`，见 §五-3） |
| 规则源未擅改 | `git status --porcelain scripts/guards/` → **空（0 行）** |
| 生产码零改动 | `git status --porcelain -- apps packages scripts templates` → **空（0 行）** |
| 未执行项 | 全量 `bun run test` 未跑（测试台账归 MIG-02，按本单任务口径；见 §五-2） |

> 停止条件判定：**未触发**。B1–B13 全部可复算；guard 阈值/规则源零改动；无「为绿改规则」。

---

## 二、逐项复算登记（B1–B13）

### B1 · 包间允许边

- **登记值（v2/16 §一）**：38 条边、15 个源包（冻结口径＝`allowedPackageEdges` 数组条目，每条目一条 `[源,目标]` 有向边）。
- **复算命令（照录 v2/16 §一 B1）**：

```bash
mise exec -- node --input-type=module -e "import{allowedPackageEdges as E}from'./scripts/guards/boundary-rules.mjs';console.log(E.length,[...new Set(E.map(e=>e[0]))].size)"
```

- **本次实际输出**（exit 0）：

```text
38 undefined
```

- **补充复算**（同条件，仅把 Array 的 `.size` 改为 `.length`，登记口径不变）：

```bash
mise exec -- node --input-type=module -e "import{allowedPackageEdges as E}from'./scripts/guards/boundary-rules.mjs';console.log(E.length,[...new Set(E.map(e=>e[0]))].length,'flat='+E.flat().length)"
```

```text
38 15 flat=76
```

- **判定：一致（38 条边 / 15 个源包）**。
- **备注**：照录命令的第二字段打印 `undefined`——`[...new Set(...)]` 展开后是 Array，Array 无 `.size`；这是**复算命令字面缺陷，不是基线数值漂移**。改用 `.length` 后 `38 15` 与登记值完全一致。C5-P1-4 的「76」双口径亦复现：`E.flat().length = 76`＝38 条目展平后的包名元素数，不是边数。**建议 IMPL-01-02 的复算闸采用 `.length` 修正版**（见 §三；本单不改 v2/16 原文，属只读登记）。

### B2 · daemon 纵边

- **登记值**：13 条。
- **复算命令**（v2/16 §一 B2 只给属性名「同上文件 `allowedVerticalEdges.length`」，按同一文件补全为可执行命令，口径未改）：

```bash
mise exec -- node --input-type=module -e "import{allowedVerticalEdges as E}from'./scripts/guards/boundary-rules.mjs';console.log(E.length)"
```

- **本次实际输出**（exit 0）：`13`
- **判定：一致**。
- **备注**：v2/16 原文为属性名缩写；本件补全为可执行形态，属性与计数单位未变。

### B3 · 层位

- **登记值**：16 包（`daemon5 ＞ panel/api/prompt/studio-tools4 ＞ company3 ＞ store2 ＞ adapters/core/gateway/localplatform/matrix/yt/taiga/dsh-bridge1 ＞ contract0`）；daemon 包内 7 层。
- **复算命令**（v2/16 §一 B3 给属性名，补全为可执行命令）：

```bash
mise exec -- node --input-type=module -e "import{packageLayers as P,daemonLayers as D}from'./scripts/guards/boundary-rules.mjs';console.log('packages',Object.keys(P).length,'daemonLayers',Object.keys(D).length);const g={};for(const[k,v]of Object.entries(P))(g[v]??=[]).push(k);for(const k of Object.keys(g).sort((a,b)=>b-a))console.log('layer',k,g[k].length,g[k].join(','))"
```

- **本次实际输出**（exit 0）：

```text
packages 16 daemonLayers 7
layer 5 1 daemon
layer 4 4 panel,api,prompt,studio-tools
layer 3 1 company
layer 2 1 store
layer 1 8 adapters,core,gateway,localplatform,matrix,yt,taiga,dsh-bridge
layer 0 1 contract
```

- **判定：一致**。
- **备注**：16 包＝1+4+1+1+8+1；daemon 包内 7 层＝`root/cli/assembly/control/evolve/engine/engine-tools`（`daemonLayers` 7 键）。分层分布与登记括号串逐项吻合。

### B4 · 尺寸阈

- **登记值**：`maxFilesPerDirectory` 25 / `maxLinesPerFile` 600 / `lineBaseline` 22 条；最大件 `engine.ts` 2337。
- **复算命令**（v2/16 §一 B4 给属性名，补全为可执行命令）：

```bash
mise exec -- node --input-type=module -e "import{maxFilesPerDirectory as F,maxLinesPerFile as L,lineBaseline as B}from'./scripts/guards/boundary-rules.mjs';const top=Object.entries(B).sort((a,b)=>b[1]-a[1])[0];console.log('files',F,'lines',L,'baselineEntries',Object.keys(B).length,'max',top[0],top[1])"
```

- **本次实际输出**（exit 0）：

```text
files 25 lines 600 baselineEntries 22 max apps/daemon/src/engine/engine.ts 2337
```

- **判定：一致**。
- **备注**：最大基线件行数与 `wc -l apps/daemon/src/engine/engine.ts` ＝2337 互证（同 B12/engine.ts 拆分前置基线）。

### B5 · 域平面基线

- **登记值**：engine 13 / control 2 / evolve 5 / assembly 1；`toolsPromotionFileCount` 10。
- **复算命令**（v2/16 §一 B5 给属性名，补全为可执行命令）：

```bash
mise exec -- node --input-type=module -e "import{domainPlaneBaselines as D,toolsPromotionFileCount as T}from'./scripts/guards/boundary-rules.mjs';console.log(JSON.stringify(D),'toolsPromotionFileCount',T)"
```

- **本次实际输出**（exit 0）：

```text
{"engine":13,"control":2,"evolve":5,"assembly":1} toolsPromotionFileCount 10
```

- **判定：一致**。
- **备注**：四域键数与值逐项吻合；升格阈 10 未变。

### B6 · 测试文件（test/ 目录）

- **登记值**：`*.test.ts` ＝177；宽口径 `*.ts` ＝185（含 8 件夹具/冒烟）。
- **复算命令（照录 v2/16 §一 B6）**：

```bash
find apps/daemon/test packages/*/test -name '*.test.ts' | wc -l
find apps/daemon/test packages/*/test -name '*.ts' | wc -l
```

- **本次实际输出**（exit 0）：

```text
     177
     185
```

- **判定：一致（177 / 185）**。
- **备注**：宽口径差集实测 8 件，与「含 8 件夹具/冒烟」吻合：`apps/daemon/test/engine/crash-points.ts`、`packages/core/test/helpers.ts`、`packages/dsh-bridge/test/smoke/bridge-smoke.ts`、`packages/panel/test/corpus.ts`、`packages/prompt/test/helpers.ts`、`packages/store/test/ulid.ts`、`packages/taiga/test/smoke/taiga-onboard-smoke.ts`、`packages/taiga/test/smoke/taiga-smoke.ts`。分目录 `*.test.ts`：daemon 85 / adapters 14 / company 21 / contract 2 / core 16 / dsh-bridge 1 / panel 17 / prompt 5 / store 15 / taiga 1（合计 177）。

### B7 · 测试文件（src 内）

- **登记值**：32；与 B6 合计 **209**（177＋32；v1「210 文件」弃用）。
- **复算命令（照录 v2/16 §一 B7）**：

```bash
find apps/*/src packages/*/src -name '*.test.ts' | wc -l
```

- **本次实际输出**（exit 0）：`      32`
- **判定：一致（32；177＋32＝209）**。
- **备注**：合计 209 与 C5-P1-5 处置值一致；「210」不再登记。

### B8 · 生产源码

- **登记值**：310；其中 `apps/daemon` 110（engine 68 / cli 22 / assembly 12 / evolve 5 / control 2 / src 根 1）。
- **复算命令（照录 v2/16 §一 B8）＋补充分域**：

```bash
find apps/*/src packages/*/src -name '*.ts' | wc -l
find apps/daemon/src -name '*.ts' | wc -l
for d in engine cli assembly evolve control; do printf "%s=%s\n" "$d" "$(find apps/daemon/src/$d -name '*.ts' | wc -l | tr -d ' ')"; done
printf "root=%s\n" "$(find apps/daemon/src -maxdepth 1 -name '*.ts' | wc -l | tr -d ' ')"
```

- **本次实际输出**（exit 0）：

```text
     310
     110
engine=68
cli=22
assembly=12
evolve=5
control=2
root=1
```

- **判定：一致（310 / 110；68+22+12+5+2+1＝110）**。
- **备注**：逐域分项全中；src 根仅 `index.ts` 1 件，与 `daemonSrcRootFiles` 纪律一致。

### B9 · store schema 版本

- **登记值**：`1,2,3,4,5,6,7,8,9,10,11,13`（12 条；v12 条目在 `cost.ts`，跨文件拼合 v1–v13 全集）→ `LATEST_VERSION=13`。
- **复算命令（照录 v2/16 §一 B9）＋补充**：

```bash
mise exec -- node -e "const s=require('fs').readFileSync('packages/store/src/migrations.ts','utf8');console.log([...s.matchAll(/version:\s*(\d+),/g)].map(m=>+m[1]).join(','))"
grep -n "version:" packages/store/src/cost.ts
mise exec -- node --input-type=module -e "import{LATEST_VERSION}from'./packages/store/src/migrations.ts';console.log(LATEST_VERSION)"
```

- **本次实际输出**（exit 0）：

```text
1,2,3,4,5,6,7,8,9,10,11,13
41:  version: 12,
13
```

- **判定：一致**。
- **备注**：`migrations.ts` 12 条版本号＝1–11、13；v12 实锚 `packages/store/src/cost.ts:41`；运行时 `LATEST_VERSION=13`（import 实算，非文本推断）。v12 属 `costDailyMigration`（migrations.ts 内 `import { costDailyMigration } from './cost.ts'`）。

### B10 · cost_daily 定型面

- **登记值**：`cost.ts:44` 建表；`:61 trg_cost_daily_no_update` / `:62 trg_cost_daily_no_delete`（UPDATE/DELETE 均触发器拒绝）。
- **复算命令（照录 v2/16 §一 B10）＋建表锚**：

```bash
grep -n "CREATE TRIGGER" packages/store/src/cost.ts
grep -n "CREATE TABLE" packages/store/src/cost.ts
```

- **本次实际输出**（exit 0）：

```text
61:    "CREATE TRIGGER trg_cost_daily_no_update BEFORE UPDATE ON cost_daily BEGIN SELECT RAISE(ABORT, 'cost_daily 已定型 append-only：UPDATE 被拒（不回溯改史）'); END;",
62:    "CREATE TRIGGER trg_cost_daily_no_delete BEFORE DELETE ON cost_daily BEGIN SELECT RAISE(ABORT, 'cost_daily 已定型 append-only：DELETE 被拒（不回溯改史）'); END;",
44:    'CREATE TABLE cost_daily (',
```

- **判定：一致（行号 44 / 61 / 62；触发器计数 2）**。
- **备注**：触发器定义行内即含拒绝语义（RAISE ABORT），与 DOM-04「定型账、拒改删」一致。

### B11 · rebuild 重放面

- **登记值**：循环体只 `appendEvent`（`:46`），零 cost 重放。
- **复算命令（照录 v2/16 §一 B11）＋ plan/04 MIG-01 ⑥ 口径**：

```bash
grep -n "appendEvent\|cost" packages/store/src/rebuild.ts
grep -n "cost" packages/store/src/rebuild.ts
```

- **本次实际输出**（exit 0）：

```text
10: *   - 行内容与库内已有事件全列一致时走 appendEvent 幂等规则跳过（F2-13 回填幂等）。
23: * JSONL → 新库逐条 appendEvent（事务原子）。
46:      ledger.appendEvent(parsed)
```

第二条 `grep "cost"` **0 命中**（与 plan/04 §二 MIG-01 ⑥ 冻结期望一致）。

- **判定：一致（:46 appendEvent；cost 文本 0 命中）**。
- **备注**：`rebuild()` 主循环（`for` 体内）仅 `ledger.appendEvent(parsed)`；`cost_daily` 无任何重放引用——DSF P0-2 的事实锚复现。grep 命中的 :10/:23 为注释，非代码路径。

### B12 · v0.5 合并机

- **登记值**：6 件 1047 行（merge-run 582 / default-deps 151 / merge-gate 107 / merge-lease 108 / merge-fallback 59 / merge-brief 40）。
- **复算命令（照录 v2/16 §一 B12）**：

```bash
wc -l apps/daemon/src/engine/merge/*.ts
```

- **本次实际输出**（exit 0）：

```text
     151 apps/daemon/src/engine/merge/default-deps.ts
      40 apps/daemon/src/engine/merge/merge-brief.ts
      59 apps/daemon/src/engine/merge/merge-fallback.ts
     107 apps/daemon/src/engine/merge/merge-gate.ts
     108 apps/daemon/src/engine/merge/merge-lease.ts
     582 apps/daemon/src/engine/merge/merge-run.ts
    1047 total
```

- **判定：一致（6 件 / 1047 行；582+151+107+108+59+40＝1047）**。
- **备注**：逐件行数全中；与 v2/16 §六「merge/ 6 件已在附录 16/17 清单内」互证（非漏列）。

### B13 · DSH 插件例外载体

- **登记值**：6 件（company-game/dsh-asset-check 与 company-internet/dsh-web-test 各 3：`cordis.patch.yml`+`package.json`+`src/index.mjs`）。
- **复算命令（照录 v2/16 §一 B13）＋清单**：

```bash
find templates -path '*plugins*' -type f | wc -l
find templates -path '*plugins*' -type f | sort
```

- **本次实际输出**（exit 0）：

```text
       6
templates/company-game/plugins/dsh-asset-check/cordis.patch.yml
templates/company-game/plugins/dsh-asset-check/package.json
templates/company-game/plugins/dsh-asset-check/src/index.mjs
templates/company-internet/plugins/dsh-web-test/cordis.patch.yml
templates/company-internet/plugins/dsh-web-test/package.json
templates/company-internet/plugins/dsh-web-test/src/index.mjs
```

- **判定：一致（6 件；两个插件各 3 件同构）**。
- **备注**：84 裁决一「DSH 插件例外保留、不迁出」；本件只登记，不迁移。

---

## 三、复算闸命令清单（供 IMPL-01-02 直接使用）

仓根执行；`expected` 为初代冻结值。任一不符＝MIG-01 停止条件（不修数字、先报差异）。

```bash
# ── 0. 环境与规则源（先钉条件面） ───────────────────────────────
git rev-parse HEAD                      # expected: 32aaf2a75e3978c00fd16f13948b16dcc7de8860（或其他代际声明）
mise exec -- bun --version              # expected: 1.4.3
mise exec -- node --version             # expected: v24.21.0
git status --porcelain scripts/guards/  # expected: 空输出（boundary-rules.mjs 未被擅改）

# ── 1. B1–B13 逐项 ────────────────────────────────────────────
# B1（修正 .size→.length；原命令字面打印 38 undefined，见 §二-B1）
mise exec -- node --input-type=module -e "import{allowedPackageEdges as E}from'./scripts/guards/boundary-rules.mjs';console.log(E.length,[...new Set(E.map(e=>e[0]))].length,'flat='+E.flat().length)"   # expected: 38 15 flat=76
# B2
mise exec -- node --input-type=module -e "import{allowedVerticalEdges as E}from'./scripts/guards/boundary-rules.mjs';console.log(E.length)"                                                          # expected: 13
# B3
mise exec -- node --input-type=module -e "import{packageLayers as P,daemonLayers as D}from'./scripts/guards/boundary-rules.mjs';console.log(Object.keys(P).length,Object.keys(D).length)"               # expected: 16 7
# B4
mise exec -- node --input-type=module -e "import{maxFilesPerDirectory as F,maxLinesPerFile as M,lineBaseline as B}from'./scripts/guards/boundary-rules.mjs';const t=Object.entries(B).sort((a,b)=>b[1]-a[1])[0];console.log(F,M,Object.keys(B).length,t[0],t[1])"   # expected: 25 600 22 apps/daemon/src/engine/engine.ts 2337
# B5
mise exec -- node --input-type=module -e "import{domainPlaneBaselines as D,toolsPromotionFileCount as T}from'./scripts/guards/boundary-rules.mjs';console.log(JSON.stringify(D),T)"                    # expected: {"engine":13,"control":2,"evolve":5,"assembly":1} 10
# B6
find apps/daemon/test packages/*/test -name '*.test.ts' | wc -l          # expected: 177
find apps/daemon/test packages/*/test -name '*.ts' | wc -l               # expected: 185（宽口径）
# B7（与 B6 合计 209）
find apps/*/src packages/*/src -name '*.test.ts' | wc -l                 # expected: 32
# B8
find apps/*/src packages/*/src -name '*.ts' | wc -l                      # expected: 310
find apps/daemon/src -name '*.ts' | wc -l                                # expected: 110
# B9（+ 跨文件 v12 与运行时 LATEST）
mise exec -- node -e "const s=require('fs').readFileSync('packages/store/src/migrations.ts','utf8');console.log([...s.matchAll(/version:\s*(\d+),/g)].map(m=>+m[1]).join(','))"   # expected: 1,2,3,4,5,6,7,8,9,10,11,13
grep -n "version:" packages/store/src/cost.ts                            # expected: 41:  version: 12,
mise exec -- node --input-type=module -e "import{LATEST_VERSION}from'./packages/store/src/migrations.ts';console.log(LATEST_VERSION)"                                              # expected: 13
# B10
grep -c "CREATE TRIGGER" packages/store/src/cost.ts                      # expected: 2（:61/:62）
grep -n "CREATE TABLE" packages/store/src/cost.ts                        # expected: 44
# B11
grep -n "appendEvent" packages/store/src/rebuild.ts                      # expected: :46 代码行（另有 :10/:23 注释命中）
grep -c "cost" packages/store/src/rebuild.ts                             # expected: 0（plan/04 MIG-01 ⑥）
# B12
wc -l apps/daemon/src/engine/merge/*.ts | tail -1                         # expected: 1047 total（6 件）
# B13
find templates -path '*plugins*' -type f | wc -l                         # expected: 6

# ── 2. plan/04 §二 MIG-01 汇总闸（①–⑥；⑦ 含 bun run test，本单未跑） ──
mise exec -- node --input-type=module -e "import{allowedPackageEdges as E,allowedVerticalEdges as V,packageLayers as L,maxFilesPerDirectory as F,maxLinesPerFile as M}from'./scripts/guards/boundary-rules.mjs';console.log(E.length,V.length,Object.keys(L).length,F,M)"   # expected: 38 13 16 25 600
echo $(( $(find apps/daemon/test packages/*/test -name '*.test.ts' | wc -l) + $(find apps/*/src packages/*/src -name '*.test.ts' | wc -l) ))                                                          # expected: 209

# ── 3. 五点冻结表（crash-points.md 同源） ───────────────────────
mise exec -- node --input-type=module -e "import{CRASH_POINTS}from'./apps/daemon/src/engine/crash-points.ts';console.log(CRASH_POINTS.length)"                                                       # expected: 5

# ── 4. 通用门禁本单实跑项（test 项未跑，见 §五-2） ──────────────
mise exec -- bun run guard:boundaries   # expected: PASS / 0 违例 / exit 0
mise exec -- bun run typecheck          # expected: exit 0
git status --porcelain -- apps packages scripts templates   # expected: 空（生产面零改动）
```

> 备注：B6/B7 的 `find` 命令含 shell glob `packages/*/test`；若某包无 `test/` 目录会打印 `find: ... No such file or directory` 到 stderr，但计数不受影响（本代所有列出的包均有目录，无该噪声）。B11 的 `grep -c "cost"` 在零命中时退出码为 1（预期即此态），以输出 `0` 为准，不把 exit 1 当失败。

---

## 四、门禁原始记录（2026-10-28 实跑）

### 4.1 分层宪法门禁

```text
$ mise exec -- bun run guard:boundaries
$ node scripts/guards/boundaries.mjs
边界门禁 PASS：扫描 627 文件（范围面代码件 499），0 违例（分层宪法 20-§十五）
EXIT=0
```

### 4.2 根类型门禁

```text
$ mise exec -- bun run typecheck
$ tsc --noEmit
EXIT=0
```

（日志 1 行，无诊断输出。）

### 4.3 规则源与生产面 git status

```text
$ git status --porcelain scripts/guards/
（空输出）
EXIT=0 lines=0

$ git status --porcelain -- apps packages scripts templates
（空输出）
lines=0
```

### 4.4 环境实值

```text
git HEAD   = 32aaf2a75e3978c00fd16f13948b16dcc7de8860（branch dev）
bun        = 1.4.3
node       = v24.21.0
mise       = 2026.10.11 macos-arm64
复算时刻   = 2026-10-28T07:46Z（UTC）
```

---

## 五、附注与诚实边界

1. **B1 命令面缺陷（唯一差异项）**：v2/16 §一 B1 的复算命令第二位用了 `[...new Set(...)].size`，Array 无 `.size` → 原样输出 `38 undefined`；同条件改 `.length` 即 `38 15`。**基线数值无漂移**，但命令字面不可直接作为闸命令。本单按只读纪律未改 v2/16 原文；建议 IMPL-01-02 在 recompute.md 采用 §三 的修正版，并把该差异登记进复算报告。
2. **未执行项：全量 `bun run test`**。按本单任务口径不跑（测试台账归 MIG-02），故 plan/04 §二 MIG-01 ⑦「通用三件套」中的 test 项在本代**未取得绿证**；本件不据此宣称测试面通过。补充：plan/03 于 2026-10-28 修订为 v1.1-draft 后，旧全量 `bun run test` 已明确**不再作波门**（只作观察位登记）；本单连观察位也未跑，如实记「未执行」。guard 与 typecheck 已实跑并记录（§四）。
3. **typecheck 覆盖边界**：根 `tsconfig.json` 的 `include` 仅 `apps/*/src/**/*.ts`、`packages/*/src/**/*.ts`；test 面类型错与旧测试红绿不在本 program 内（plan/03 v1.1 口径：旧测试不作施工门，由 MIG-02 逐文件台账登记；`typecheck:test` 不作为本代判据）。故本代 typecheck exit 0 **只证明 src 面**。
4. **工作区状态说明**：本单新增仅 `docs/baselines/registration.md` 与 `docs/baselines/crash-points.md`（未跟踪）。施工起始时工作区已有 `docs/86-…` 修改与 `docs/88-…` 未跟踪；施工窗口内 `docs/v2/` 多卷（含 **16 卷修订为 v2.1-draft**）与 `docs/plan/00、03`（03 修订为 v1.1-draft）等出现改动——**均非本单写入**。已核对：v2/16 的 v2.1 修订 diff 未改 §一 B1–B13 任何一行（仅头注、§五 MIG 行与文末登记），故本件登记值对工作区现行 §一 仍成立；复算所依赖的 `scripts/guards/`、`apps/`、`packages/`、`templates/` 零改动（§四-4.3 生产面 0 行）。
5. **不可复算项：0**。B9 的 v12 跨文件项、B10/B11 的 DSF P0-2 事实锚、B12/B13 的合入面与插件例外，均按登记命令复现。
6. **本代编号**：MIG-01 初代（2026-10-28）。后续波次新增代际时**追加不覆盖**本件（v2/16 §五 MIG-01 回滚列：只读快照，逐代追加）。
7. **并发修订带来的范围缺口（上报，不在本单领土内）**：plan/03 v1.1-draft §二（2026-10-28 修订）把「旧测试基线清单（209 文件清单／vitest 210 口径差异／37 红逐条初归属）」列为 MIG-01 产物；而本单任务与 plan/05（未修订，IMPL-01-01 领土）只要求 `registration.md`＋`crash-points.md`。本单**未扩围**（未跑全量 test、未造 209 行清单、未做 37 红归属）；该产物在 plan/03 v1.1 §三 已落 MIG-02 的 `docs/baselines/old-tests-ledger.md`，建议由 IMPL-01-02 或 MIG-02 台账单承接并在波门登记口径归属，避免两处同名产物。**（2026-10-28 追加，已获准）**：旧测试清单/台账**归 MIG-02**，本单不扩围已获准——`docs/49`「2026-10-28 开工令」§8 已登记范围调整（MIG-01 不造 209 行旧测试清单、旧测试基线清单件不立项；出口只含 B1-B13 复算闸＋crash 五点＋复算闸命令件），plan/03 §二与 plan/05 IMPL-01-01 已同步。


