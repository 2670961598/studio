# MIG-01 复算闸 · B1–B13 全量重跑（IMPL-01-02）

> **头注**
> - 日期：2026-10-28（落盘 2026-10-28T07:59Z / 15:59 CST；实跑与 PB-1 探针日志同一条串行会话，早于 PB-1 日志时间戳 07:57Z）
> - git HEAD：`32aaf2a75e3978c00fd16f13948b16dcc7de8860`（分支 `dev`）
> - 工具链：bun **1.4.3** / node **v24.21.0**（仓 `.mise.toml` 钉版；`mise 2026.10.11 macos-arm64`）
> - 执行者：DeepSeek-V41-Flash（StudioNext 施工代理；IMPL-01-02 / LANE-T）
> - 性质：**MIG-01 复算闸，只读**——不改 `apps/`、`packages/`、`scripts/`、`templates/`；不改 `docs/v2/16` 原文；不 git commit；不跑全量 `bun run test`
> - 依据：`docs/v2/16-技术细节-逐文件蓝图与迁移.md` §一（B1–B13 唯一登记表）、`docs/baselines/registration.md` §三（复算闸命令清单，本件采用其修正版）、`docs/plan/03-里程碑与波次.md` §二（MIG-01 出口门禁）、`docs/plan/04-测试与验收策略.md` §二（MIG-01 冻结命令）、`docs/plan/05-实现单拆分清单.md` IMPL-01-02
> - 口径：**登记值**＝v2/16 §一「本次结果（2026-10-27）」；registration 初代（2026-10-28）已逐项重跑并与之一致。本件为同日第二次重跑（同机、同 HEAD、同钉版工具链；非跨环境复核），逐项比对「v2/16 登记值」与「registration 登记值」（两处同值，下表并列一列）。全部命令**仓根**执行，统一 `mise exec --` 前缀（原因见 §六 CMD-00：本机裸 `bun` 不存在、裸 `node` 为 v25.6.1，非钉版）。
> - 证据边界：本闸**只证明基线可复算**，不证明测试面绿，不证明 V2 能力（详见 §七）。

---

## 一、结论摘要

| 项 | 结果 |
|---|---|
| B1–B13 数值复现 | **13/13 一致，0 不一致**（0 项不可复算） |
| 命令面缺陷（v2/16 原文闸命令字面问题） | **7 条登记**（CMD-00..06；只登记、不改数值，见 §六） |
| 分层宪法门禁 | `mise exec -- bun run guard:boundaries` → **PASS / 0 违例 / exit 0**（627 文件，范围面 499） |
| 规则源未擅改 | `git status --porcelain scripts/guards/` → **空（0 行，exit 0）** |
| 生产码零改动 | `git status --porcelain -- apps packages scripts templates` → **空（0 行，exit 0）** |
| 根类型门禁（附跑） | `mise exec -- bun run typecheck` → **exit 0**（stdout 空；覆盖仅 `src`，见 §七-4） |
| B6/B7 合计（plan/05 IMPL-01-02 验收口径） | **177 + 32 = 209**（§三-B7、§四-2 双处实跑） |
| 全量 `bun run test` | **未执行**（不在本单口径；见 §七-2） |
| MIG-01 停止条件 | **未触发**（无不可复算项、规则源零改动、无「为绿改规则」） |

---

## 二、环境与条件面（先钉条件，再谈数值）

全部命令仓根执行；`$ ` 后为实际命令，紧随其后的 `EXIT=` 为该命令退出码；未特别说明则 stdout+stderr 合并。

```text
$ git rev-parse HEAD
32aaf2a75e3978c00fd16f13948b16dcc7de8860
EXIT=0

$ git branch --show-current
dev
EXIT=0

$ mise exec -- bun --version
1.4.3
EXIT=0

$ mise exec -- node --version
v24.21.0
EXIT=0

$ mise --version
2026.10.11 macos-arm64 (2026-10-15)
mise WARN  mise version 2026.10.20 available
mise WARN  self-update is disabled for this install, update mise the same way you installed it
EXIT=0

$ git status --porcelain scripts/guards/
（空输出）
EXIT=0

$ git status --porcelain -- apps packages scripts templates
（空输出）
EXIT=0
```

**条件面附注（工作区并发现状，非本单写入）**：

- `docs/v2/16` 在工作区为 `M`（v2.1-draft 修订中）。已核对 `git diff`：**§一 B1–B13 表行一字未改**；diff 仅触头注（第 4 行版本行）、表后注（第 44 行「测试类基线口径」）、§五 MIG 表（第 106–107 行）与卷末新增 §九修订记录。故本闸比对对象（工作区现行 §一）与 v2/16 v2.0-draft 登记值同值，比对成立。
- `docs/86`、`docs/88`、`docs/plan/00–07` 与 `docs/v2/*` 的改动**均非本单写入**（施工窗口内还有并发修订：`docs/plan/01、02、06、07` 在窗口内转入 `M`）；本单新增仅 `docs/baselines/recompute.md` 与 `docs/probe/pb-1/`（逐文件清单见 `docs/probe/pb-1/log-07-git-clean.txt` 终态块）。

---

## 三、B1–B13 逐项复算（冻结命令 = registration §三 修正版）

**逐项对照表**（详细原始输出见各小节）：

| # | 基线项 | 登记值（v2/16＝registration） | 本闸实跑值 | 判定 | 原文命令面缺陷 |
|---|---|---|---|---|---|
| B1 | 包间允许边 | 38 条边 / 15 源包（flat=76 另计） | `38 15 flat=76` | **一致** | CMD-01（`.size`→`undefined`） |
| B2 | daemon 纵边 | 13 | `13` | **一致** | CMD-02（非可执行形态） |
| B3 | 层位 | 16 包 / daemon 7 层 | `16 7`＋分布逐层吻合 | **一致** | CMD-02 |
| B4 | 尺寸阈 | 25 / 600 / 22 条 / 最大 `engine.ts` 2337 | `25 600 22 apps/daemon/src/engine/engine.ts 2337` | **一致** | CMD-02 |
| B5 | 域平面基线 | engine 13 / control 2 / evolve 5 / assembly 1；升格阈 10 | `{"engine":13,"control":2,"evolve":5,"assembly":1} 10` | **一致** | CMD-02 |
| B6 | test/ 目录测试文件 | 177（宽口径 185） | `177` / `185` | **一致** | — |
| B7 | src 内测试文件 | 32；与 B6 合计 209 | `32`；`209` | **一致** | — |
| B8 | 生产源码 | 310；daemon 110（68/22/12/5/2/1） | `310` / `110` / 68·22·12·5·2·1 | **一致** | CMD-03（分域明细缺命令） |
| B9 | store schema 版本 | 1..11,13（12 条）；`LATEST_VERSION=13` | 同左＋运行时 `13` | **一致** | CMD-04（运行时值缺命令） |
| B10 | cost_daily 定型面 | `:44` 建表；`:61`/`:62` 触发器 | 44 / 61 / 62；触发器 2 | **一致** | CMD-05（建表锚缺命令） |
| B11 | rebuild 重放面 | 循环体只 `appendEvent`（:46）；cost 零命中 | `:46` appendEvent；cost 0 命中 | **一致** | CMD-06（零命中不可用退出码判） |
| B12 | v0.5 合并机 | 6 件 1047 行（582/151/107/108/59/40） | 6 件 1047 行，逐件吻合 | **一致** | — |
| B13 | DSH 插件例外载体 | 6 件（两插件各 3） | `6`＋清单 6 行 | **一致** | — |

### B1 · 包间允许边

- **登记值**：38 条边、15 个源包（冻结口径＝`allowedPackageEdges` 数组条目，每条目一条 `[源,目标]` 有向边）；C5-P1-4「76」＝`E.flat().length` 另计口径，不是边数。
- **v2/16 原文命令**（照录 §一 B1）：

```bash
node --input-type=module -e "import{allowedPackageEdges as E}from'./scripts/guards/boundary-rules.mjs';console.log(E.length,[...new Set(E.map(e=>e[0]))].size)"
```

- **本闸冻结命令**（registration §三 修正版：`.size`→`.length`，并附 `flat=` 口径）：

```bash
mise exec -- node --input-type=module -e "import{allowedPackageEdges as E}from'./scripts/guards/boundary-rules.mjs';console.log(E.length,[...new Set(E.map(e=>e[0]))].length,'flat='+E.flat().length)"
```

- **本次实跑**（exit 0）：

```text
38 15 flat=76
```

- **原文缺陷复现**（同一文件、同一条件，仅保留原文 `.size`，exit 0）：

```text
38 undefined
```

- **判定：一致（38 条边 / 15 个源包）**。
- **命令面缺陷：CMD-01**。`[...new Set(...)]` 是 Array，Array 无 `.size` → 第二字段恒为 `undefined`；**且退出码仍为 0**，只判退出码的闸会把缺陷当通过。修正后 `38 15` 与登记值完全一致，`E.flat().length=76` 复现 C5-P1-4 的双口径。**数值无漂移，仅命令字面缺陷**（未改 v2/16 原文，属只读登记）。

### B2 · daemon 纵边

- **登记值**：13 条。
- **v2/16 原文**：「同上文件 `allowedVerticalEdges.length`」——属性名，非可执行命令（CMD-02）。
- **本闸冻结命令**：

```bash
mise exec -- node --input-type=module -e "import{allowedVerticalEdges as E}from'./scripts/guards/boundary-rules.mjs';console.log(E.length)"
```

- **本次实跑**（exit 0）：`13`
- **判定：一致**。
- **备注**：命令面补全只把属性名变成可执行形态，属性与计数单位未变。

### B3 · 层位

- **登记值**：16 包（daemon5 ＞ panel/api/prompt/studio-tools4 ＞ company3 ＞ store2 ＞ adapters/core/gateway/localplatform/matrix/yt/taiga/dsh-bridge1 ＞ contract0）；daemon 包内 7 层。
- **v2/16 原文**：`Object.keys(packageLayers).length` / `daemonLayers`——非可执行命令，且括号内层分布串不在该表达式覆盖内（CMD-02）。
- **本闸冻结命令**（计数＋逐层分布）：

```bash
mise exec -- node --input-type=module -e "import{packageLayers as P,daemonLayers as D}from'./scripts/guards/boundary-rules.mjs';console.log('packages',Object.keys(P).length,'daemonLayers',Object.keys(D).length);const g={};for(const[k,v]of Object.entries(P))(g[v]??=[]).push(k);for(const k of Object.keys(g).sort((a,b)=>b-a))console.log('layer',k,g[k].length,g[k].join(','))"
```

- **本次实跑**（exit 0）：

```text
packages 16 daemonLayers 7
layer 5 1 daemon
layer 4 4 panel,api,prompt,studio-tools
layer 3 1 company
layer 2 1 store
layer 1 8 adapters,core,gateway,localplatform,matrix,yt,taiga,dsh-bridge
layer 0 1 contract
```

- **附跑**（registration §三 的紧凑口径）：`16 7`（exit 0）。
- **判定：一致**。16＝1+4+1+1+8+1；层分布与登记括号串逐项吻合；`daemonLayers` 7 键＝包内 7 层。

### B4 · 尺寸阈

- **登记值**：`maxFilesPerDirectory` 25 / `maxLinesPerFile` 600 / `lineBaseline` 22 条；最大件 `engine.ts` 2337。
- **v2/16 原文**：属性名并列，最大件需排序 `lineBaseline` 才能得出（原文未给该步，CMD-02）。
- **本闸冻结命令**：

```bash
mise exec -- node --input-type=module -e "import{maxFilesPerDirectory as F,maxLinesPerFile as M,lineBaseline as B}from'./scripts/guards/boundary-rules.mjs';const t=Object.entries(B).sort((a,b)=>b[1]-a[1])[0];console.log(F,M,Object.keys(B).length,t[0],t[1])"
```

- **本次实跑**（exit 0）：

```text
25 600 22 apps/daemon/src/engine/engine.ts 2337
```

- **附跑互证**（`wc -l` 实量同件，exit 0）：

```text
    2337 apps/daemon/src/engine/engine.ts
```

- **判定：一致**。`lineBaseline` 22 条与最大件 2337 双重吻合（最大件为基线内既有行数记录，非本次阈值改动）。

### B5 · 域平面基线

- **登记值**：engine 13 / control 2 / evolve 5 / assembly 1；`toolsPromotionFileCount` 10。
- **v2/16 原文**：`domainPlaneBaselines` 属性名（CMD-02）。
- **本闸冻结命令**：

```bash
mise exec -- node --input-type=module -e "import{domainPlaneBaselines as D,toolsPromotionFileCount as T}from'./scripts/guards/boundary-rules.mjs';console.log(JSON.stringify(D),T)"
```

- **本次实跑**（exit 0）：

```text
{"engine":13,"control":2,"evolve":5,"assembly":1} 10
```

- **判定：一致**。四域键值与升格阈逐项吻合。

### B6 · 测试文件（test/ 目录）

- **登记值**：`*.test.ts`＝177；宽口径 `*.ts`＝185（含 8 件夹具/冒烟）。
- **v2/16 原文命令**（照录；可直接执行）：

```bash
find apps/daemon/test packages/*/test -name '*.test.ts' | wc -l
find apps/daemon/test packages/*/test -name '*.ts' | wc -l
```

- **本次实跑**（两条均 exit 0，输出逐字保留含前导空格）：

```text
     177
     185
```

- **附跑：分目录 `*.test.ts`**（exit 0；行尾 1 空格为 `printf` 原样保留）：

```text
apps/daemon=85 packages/adapters=14 packages/company=21 packages/contract=2 packages/core=16 packages/dsh-bridge=1 packages/panel=17 packages/prompt=5 packages/store=15 packages/taiga=1 
```

- **判定：一致（177 / 185）**。逐目录合计 85+14+21+2+16+1+17+5+15+1＝177。宽口径差 8 件（夹具/冒烟）与登记备注同。
- **口径提醒**：本项是**文件计数**（现状事实），不是测试通过数；不得据此称测试面绿（§七-2）。

### B7 · 测试文件（src 内）

- **登记值**：32；与 B6 合计 **209**（v1「210 文件」弃用）。
- **v2/16 原文命令**（照录）：

```bash
find apps/*/src packages/*/src -name '*.test.ts' | wc -l
```

- **本次实跑**（exit 0）：

```text
      32
```

- **附跑：plan/05 IMPL-01-02 验收口径「B6/B7 复算=177+32=209」**（exit 0）：

```text
$ echo $(( $(find apps/daemon/test packages/*/test -name '*.test.ts' | wc -l) + $(find apps/*/src packages/*/src -name '*.test.ts' | wc -l) ))
209
```

- **判定：一致（32；177＋32＝209）**。「209」为两口径之和，非第三份清单；本闸不产出逐文件台账（测试台账归 MIG-02）。

### B8 · 生产源码

- **登记值**：310；其中 `apps/daemon` 110（engine 68 / cli 22 / assembly 12 / evolve 5 / control 2 / src 根 1）。
- **v2/16 原文命令**：总数两条可执行；**分域 68/22/12/5/2/1 无对应命令**（CMD-03）。
- **本闸冻结命令**（总数＋daemon 总数）：

```bash
find apps/*/src packages/*/src -name '*.ts' | wc -l
find apps/daemon/src -name '*.ts' | wc -l
```

- **本次实跑**（均 exit 0）：

```text
     310
     110
```

- **附跑：daemon 分域展开**（exit 0）：

```text
engine=68
cli=22
assembly=12
evolve=5
control=2
root=1
```

- **判定：一致（310 / 110；68+22+12+5+2+1＝110）**。src 根仅 1 件，与 `daemonSrcRootFiles` 纪律一致。

### B9 · store schema 版本

- **登记值**：`1,2,3,4,5,6,7,8,9,10,11,13`（12 条；v12 条目在 `cost.ts`，跨文件拼合 v1–v13 全集）→ `LATEST_VERSION=13`。
- **v2/16 原文命令**（照录，仅文本 grep）：

```bash
node -e "const s=require('fs').readFileSync('packages/store/src/migrations.ts','utf8');console.log([...s.matchAll(/version:\s*(\d+),/g)].map(m=>+m[1]).join(','))"
```

- **本闸冻结命令**（文本版本列表＋跨文件 v12 锚＋运行时值）：

```bash
mise exec -- node -e "const s=require('fs').readFileSync('packages/store/src/migrations.ts','utf8');console.log([...s.matchAll(/version:\s*(\d+),/g)].map(m=>+m[1]).join(','))"
grep -n "version:" packages/store/src/cost.ts
mise exec -- node --input-type=module -e "import{LATEST_VERSION}from'./packages/store/src/migrations.ts';console.log(LATEST_VERSION)"
```

- **本次实跑**（三条均 exit 0）：

```text
1,2,3,4,5,6,7,8,9,10,11,13
41:  version: 12,
13
```

- **判定：一致**。
- **命令面缺陷：CMD-04**。`LATEST_VERSION` 不是文本常量，而是 `MIGRATIONS[MIGRATIONS.length-1].version`（`packages/store/src/migrations.ts:543`）——**文本 grep 不能代替运行时 import**；又因 v12 在 `cost.ts`，「文本最大值＝13」只是推断（文本无法确认 `MIGRATIONS` 数组末项）。补运行时 import 后确证 13。

### B10 · cost_daily 定型面

- **登记值**：`cost.ts:44` 建表；`:61 trg_cost_daily_no_update` / `:62 trg_cost_daily_no_delete`（UPDATE/DELETE 均触发器拒绝）。
- **v2/16 原文命令**：`grep -n "CREATE TRIGGER"`——只能覆盖触发器锚，**不覆盖 `:44 建表`**（CMD-05）。
- **本闸冻结命令**：

```bash
grep -c "CREATE TRIGGER" packages/store/src/cost.ts
grep -n "CREATE TABLE" packages/store/src/cost.ts
```

- **本次实跑**（两条均 exit 0）：

```text
2
44:    'CREATE TABLE cost_daily (',
```

- **附跑：触发器行锚**（exit 0；逐字保留中文原文）：

```text
61:    "CREATE TRIGGER trg_cost_daily_no_update BEFORE UPDATE ON cost_daily BEGIN SELECT RAISE(ABORT, 'cost_daily 已定型 append-only：UPDATE 被拒（不回溯改史）'); END;",
62:    "CREATE TRIGGER trg_cost_daily_no_delete BEFORE DELETE ON cost_daily BEGIN SELECT RAISE(ABORT, 'cost_daily 已定型 append-only：DELETE 被拒（不回溯改史）'); END;",
```

- **判定：一致（44 / 61 / 62；触发器 2）**。触发器定义行内即含 `RAISE(ABORT)` 拒绝语义。

### B11 · rebuild 重放面

- **登记值**：循环体只 `appendEvent`（`:46`），零 cost 重放（plan/04 §二 MIG-01 ⑥ 口径）。
- **v2/16 原文命令**：`grep -n "appendEvent\|cost"`——本机 BSD grep 支持该 `\|` 交替，**但**由于 `appendEvent` 命中，整条命令 exit 0，**无法用退出码断言「cost 零命中」**（CMD-06）。
- **本闸冻结命令**：

```bash
grep -n "appendEvent" packages/store/src/rebuild.ts
grep -c "cost" packages/store/src/rebuild.ts
```

- **本次实跑**：

```text
$ grep -n "appendEvent" packages/store/src/rebuild.ts
10: *   - 行内容与库内已有事件全列一致时走 appendEvent 幂等规则跳过（F2-13 回填幂等）。
23: * JSONL → 新库逐条 appendEvent（事务原子）。
46:      ledger.appendEvent(parsed)
EXIT=0

$ grep -c "cost" packages/store/src/rebuild.ts
0
EXIT=1
```

- **判定：一致（`:46` appendEvent；cost 0 命中）**。
- **退出码说明**：`grep -c` 零命中时退出码为 **1**，属**预期态**，以输出 `0` 为判据（registration §三 备注同）；不得把它记成命令失败，也不得只凭 exit 0 声称「零命中」。`grep -n "appendEvent\|cost"` 附跑 exit 0、输出同上 3 行（与原文命令等值，但无零命中判据）。
- **备注**：`:10`/`:23` 为注释命中，非代码路径；`rebuild()` 主循环 `for` 体内仅 `ledger.appendEvent(parsed)`。

### B12 · v0.5 合并机

- **登记值**：6 件 1047 行（merge-run 582 / default-deps 151 / merge-gate 107 / merge-lease 108 / merge-fallback 59 / merge-brief 40）。
- **v2/16 原文命令**（照录，输出逐字保留）：

```bash
wc -l apps/daemon/src/engine/merge/*.ts
```

- **本次实跑**（exit 0）：

```text
     151 apps/daemon/src/engine/merge/default-deps.ts
      40 apps/daemon/src/engine/merge/merge-brief.ts
      59 apps/daemon/src/engine/merge/merge-fallback.ts
     107 apps/daemon/src/engine/merge/merge-gate.ts
     108 apps/daemon/src/engine/merge/merge-lease.ts
     582 apps/daemon/src/engine/merge/merge-run.ts
    1047 total
```

- **附跑：求和口径**（exit 0）：`wc -l apps/daemon/src/engine/merge/*.ts | tail -1` → `    1047 total`。
- **判定：一致（6 件 / 1047 行）**。582+151+107+108+59+40＝1047；逐件行数全中。

### B13 · DSH 插件例外载体

- **登记值**：6 件（company-game/dsh-asset-check 与 company-internet/dsh-web-test 各 3：`cordis.patch.yml`+`package.json`+`src/index.mjs`）。
- **v2/16 原文命令**（照录）：

```bash
find templates -path '*plugins*' -type f | wc -l
```

- **本次实跑**（exit 0；输出含 `wc` 前导空格）：

```text
       6
```

- **附跑：清单**（exit 0）：

```text
templates/company-game/plugins/dsh-asset-check/cordis.patch.yml
templates/company-game/plugins/dsh-asset-check/package.json
templates/company-game/plugins/dsh-asset-check/src/index.mjs
templates/company-internet/plugins/dsh-web-test/cordis.patch.yml
templates/company-internet/plugins/dsh-web-test/package.json
templates/company-internet/plugins/dsh-web-test/src/index.mjs
```

- **判定：一致（6 件；两个插件各 3 件同构）**。本件只登记，不迁移（84 裁决一：DSH 插件例外保留）。

---

## 四、附件复算（plan/04 §二 MIG-01 汇总闸的可跑部分）

### 4.1 ①–⑤ 汇总命令（plan/04 口径，exit 0）

```bash
mise exec -- node --input-type=module -e "import{allowedPackageEdges as E,allowedVerticalEdges as V,packageLayers as L,maxFilesPerDirectory as F,maxLinesPerFile as M}from'./scripts/guards/boundary-rules.mjs';console.log(E.length,V.length,Object.keys(L).length,F,M)"
```

```text
38 13 16 25 600
```

判定：**一致**（与 B1/B2/B3/B4 单点复算同值）。

### 4.2 ⑥ 测试文件合计（exit 0）

```text
209
```

判定：**一致**（177＋32；见 §三-B7）。

### 4.3 五点冻结表长度（exit 0）

```bash
mise exec -- node --input-type=module -e "import{CRASH_POINTS}from'./apps/daemon/src/engine/crash-points.ts';console.log(CRASH_POINTS.length)"
```

```text
5
```

判定：**一致**（与 `docs/baselines/crash-points.md` §三 初代登记值 5 同）。本闸不重跑崩溃注入套（测试面归 MIG-02/MIG-06）。

### 4.4 未执行项

- plan/04 §二 MIG-01 **⑦**（含全量 `bun run test`）**未执行**：不在本单任务口径内（任务书明令不跑全量 test）。故本闸对「测试面绿」**零证据**，不宣称。
- `typecheck:test` 未执行（MIG-02 领地）。

---

## 五、门禁原始记录

### 5.1 分层宪法门禁

```text
$ mise exec -- bun run guard:boundaries
边界门禁 PASS：扫描 627 文件（范围面代码件 499），0 违例（分层宪法 20-§十五）
EXIT=0
```

（stderr 另有 bun 的脚本回显 1 行：`$ node scripts/guards/boundaries.mjs`——非诊断输出。627/499 与 registration §四-4.1 初代记录同值。）

### 5.2 规则源未擅改

```text
$ git status --porcelain scripts/guards/
（空输出）
EXIT=0 lines=0
```

判定：`scripts/guards/`（规则唯一源 `boundary-rules.mjs` 所在面）**零改动**——基线阈值/方向表/域平面基线未被本次施工触碰，排除「为绿改规则」。

### 5.3 根类型门禁（附跑）

```text
$ mise exec -- bun run typecheck
（stdout 空；stderr：$ tsc --noEmit）
EXIT=0
```

判定：**exit 0**。覆盖仅 `apps/*/src/**/*.ts`、`packages/*/src/**/*.ts`（根 `tsconfig.json` include）；test 面类型错不在本闸内（见 §七-4）。

### 5.4 生产面零改动

```text
$ git status --porcelain -- apps packages scripts templates
（空输出）
EXIT=0 lines=0
```

判定：**生产码、规则源、模板零改动**。本单写入仅 `docs/`（基线件与探针日志）。

---

## 六、命令面缺陷登记（CMD-；只登记，不改数值、不改 v2/16 原文）

> 判定标准：**能算出登记值的命令面问题**一律记为「命令面缺陷」，与「数值漂移」严格分开。本代**数值漂移 0 项**。

| 编号 | 位置 | 原文 | 缺陷类别 | 本闸处置 |
|---|---|---|---|---|
| CMD-00 | v2/16 §一 全表 | 命令写裸 `node …`（无工具链前缀） | **证据口径缺口**：本机裸 `bun` 不存在（`bash: bun: command not found`，exit 127）、裸 `node` 为 **v25.6.1**（非钉版 v24.21.0）；裸跑不可复现钉版环境 | 统一加 `mise exec --`（registration §三 同；v2/13 §0.2 证据口径），命令语义未改 |
| CMD-01 | B1 | `console.log(E.length,[...new Set(...)].size)` | **字面错误**：Array 无 `.size` → 输出 `38 undefined`；**exit 仍为 0** | 改 `.length`（本闸 §三-B1）；数值 38/15 不变 |
| CMD-02 | B2/B3/B4/B5 | 只给属性名/表达式（`allowedVerticalEdges.length` 等） | **非可执行形态**：不能直接当命令跑；B3 括号分布串、B4 最大件、B5 四域键值均不在给定表达式内 | 补全为可执行一行式（§三 B2–B5）；数值不变 |
| CMD-03 | B8 | 仅两条总数 `find … \| wc -l` | **覆盖缺口**：登记值含 68/22/12/5/2/1 分项，原文无对应命令 | 补分域 `for` 循环（§三-B8）；数值不变 |
| CMD-04 | B9 | 仅文本 grep `version:` | **覆盖缺口**：`LATEST_VERSION` 是运行时派生值（`MIGRATIONS[last].version`，`migrations.ts:543`），文本 grep 不能代替；v12 在 `cost.ts`，靠文本最大值推断不可靠 | 补运行时 `import{LATEST_VERSION}` 复算（§三-B9）；数值不变 |
| CMD-05 | B10 | 仅 `grep -n "CREATE TRIGGER"` | **覆盖缺口**：登记值含 `:44 建表`，原文不覆盖 | 补 `grep -n "CREATE TABLE"`（§三-B10）；数值不变 |
| CMD-06 | B11 | `grep -n "appendEvent\|cost"` | **闸不可判**：`appendEvent` 命中使整条 exit 0，无法用退出码断言「cost 零命中」 | 补 `grep -c "cost"`（预期输出 `0` 且 exit 1，§三-B11）；数值不变 |

**登记纪律**：CMD-01..06 属「**命令面缺陷**」，不是数值漂移；**修正只作用于闸命令，不作用于登记值**。v2/16 原文未改（只读纪律），建议下一轮 v2/16 修订时按本表补正命令列（提案流），本件不代改。

---

## 七、诚实边界（本闸证明什么、不证明什么）

1. **只证明基线可复算**：B1–B13 在 HEAD `32aaf2a…` ＋钉版工具链下逐项可重跑且与登记值一致；不得把「可复算」读成「设计正确」或「实现合格」。
2. **不证明测试面绿**：全量 `bun run test` 未跑；B6/B7 只是**文件计数**；B8 是**源码文件计数**。plan/03 v1.1-draft 已明确旧测试不再作波门（只作台账），本闸连观察位也未跑，如实记「未执行」。
3. **不证明 V2 能力**：B1–B13 是**现状事实基线**（包边/层位/阈值/文件数/DDL 锚/重放面），与 V2 记录族、探针 PB-1..6、能力闭合级别（HCL）均无关；本闸不产出任何能力结论。
4. **typecheck 覆盖边界**：根 `tsconfig.json` 只 include `src`；exit 0 **只证明 src 面**，不证明 test 面类型正确（`typecheck:test` 归 MIG-02）。
5. **B1 的 76 不是边数**：`flat=76` 是 38 条目展平后的包名元素数（C5-P1-4 口径）；冻结口径仍是 38 条边。本闸并列两个口径，防他口径混用。
6. **B6/B7/B8 的计数对象**：全部为 `*.ts` / `*.test.ts` 文件计数（含夹具/冒烟按宽窄口径分列）；不是用例数、不是覆盖率、不是通过数。
7. **条件面可漂移项**：工作区 `docs/v2/16` 处 v2.1-draft 修订中（§一表行未变，已逐 hunk 核对）；`docs/plan/*` 亦有并发修订。若日后 §一数值或命令列变更，本闸按「只读登记差异、不改数值」处理，并触发 MIG-01 停止条件上报。
8. **未执行清单**：全量 `bun run test`（含 vitest 210 口径复跑）、`typecheck:test`、崩溃注入套；宿主探针不在本闸内（PB-1 的 PRB-05 executed 等结论单独落 `docs/probe/pb-1/`，与本闸互不代证）。
9. **停止条件**：**未触发**。B1–B13 全部可复算，规则源（`scripts/guards/`）0 改动，生产面 0 改动，无「为绿改规则」。

---

## 八、复跑方式（整块可重跑）

本件 §二–§五 的命令即完整闸命令集（仓根执行，逐条独立）。建议波门按下列顺序串接：

```bash
# 1) 条件面
git rev-parse HEAD
mise exec -- bun --version
mise exec -- node --version
git status --porcelain scripts/guards/            # 期望空
git status --porcelain -- apps packages scripts templates   # 期望空

# 2) B1–B13（本件 §三 逐条命令；B11 的 grep -c 期望输出 0 且 exit 1）
# 3) 附件（本件 §四）：38 13 16 25 600 / 209 / 5
# 4) 门禁
mise exec -- bun run guard:boundaries             # 期望 PASS exit 0
mise exec -- bun run typecheck                    # 期望 exit 0（仅 src 面）
```

> 落盘时间：2026-10-28T07:59Z（UTC）。本件为 MIG-01 复算闸的第二代记录（registration 初代 → 本件复算闸），**代际追加不覆盖**：后续重跑新增代际时另附差异表，不改本代数值与判定。
