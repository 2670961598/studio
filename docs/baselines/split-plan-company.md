# 公司包超限件拆分预案＋O3-01 复验记录（MIG-05 / IMPL-05-07）

> 版本：**v1**｜2026-10-28 21:37 CST｜编写：MIG-05 施工代理（DeepSeek-V41-Flash）
> 性质：**拆分预案＋复验记录＋门禁证据**——本轮**不拆**（`validator.ts` 612 行、`test/repo-validate.test.ts` 766 行零改动），只落「触线即拆」清单与验收口径；O3-01 三契约互斥复验记录落 §四；org-config 只读兼容登记落 §五。
> 依据：`docs/plan/05-实现单拆分清单.md` IMPL-05-03/05-07、`docs/plan/02-解耦面与施工边界.md` LANE-O、「C4a-P2-3」条、`docs/v2/16-技术细节-逐文件蓝图与迁移.md` company 行与 §三（C4a-P2-3）、`docs/v2/06-§五/§六`、`docs/v2/03-§2.2/§2.3/§2.4/§3.5/§六/§八`、`docs/v2/15-§一 SEC-FC-03`、`docs/v2/17` O3-01/NEG-ORG-06/07/GAP-V2-17 行、`docs/audit-DSF/L3-M-细节层-逐文件A-DSF.md` L3M-03b、`docs/audit-DSF/L3-L-细节层-蓝图与验证-DSF.md` L3L-09、`docs/audit-DSF/O3-可行性与证据-DSF.md` O3-01。
> 基线（本件写作时点）：HEAD `c164a232e914f61cdb5ded840fb0ff3ba6c62e8a`（分支 `dev`；工作树含并行 MIG-05 单在途件，见 §七-3）；bun **1.4.3** / node **v24.21.0**；命令一律 `mise exec --` 前缀（v2/13 §0.2）。
> 领土声明：本单只写 `packages/company/src/projection/**`[新]、`packages/company/src/trust.ts`、`packages/company/test/v2/**`[新]、本文件[新]；**不碰** `assets/`、`dependencies.ts`、`templates/`、旧测试、其它包；**不 git commit**。

---

## 〇、结论摘要

| # | 项 | 结果 |
|---|---|---|
| 1 | 本轮拆分动作 | **零**（两件零改动；本件只是预案，拆单另立） |
| 2 | 超限件 1 | `packages/company/src/validator.ts` **612 行**（`lineBaseline` 655）——>600 已触线，清偿义务随 MIG-05 登记；拆后 `validator.ts` 只作 barrel（≤40） |
| 3 | 超限件 2 | `packages/company/test/repo-validate.test.ts` **766 行**（`lineBaseline` 766，零余量）——>600 已触线；首选「夹具外提」降到 ≤600（旧测试台账零影响），不足再按 A/B/C/D/E 组拆 |
| 4 | O3-01 三契约互斥复验 | **投影侧 PASS**：同一组织对象（部门/一级单元/空编）恰一个权威面；同对象 legacy+definition = 阻断，不静默择一；legacy 索引↔逐文件镜像漂移=阻断（§四） |
| 5 | SEC-FC-03 坏锚 O 侧 | **改抛错**：坏 JSON/形状不符/不可读 → `TrustAnchorError`（不返回 null）；无锚仍 null；`trustStateOf` 不把坏锚折算成受信（§七-4） |
| 6 | 本单新增测试 | **3 文件 / 74 用例全绿**（`org-projection` 19、`org-structure` 29、`security-baseline` 26） |
| 7 | 四门 | **全绿**：`typecheck`／`typecheck:v2`／`test:v2 -- packages/company`（6 文件 130 用例，含并行单；本单 3 文件 74 用例）／`guard:boundaries`（0 违例） |
| 8 | 旧测试触及面 | 只登记不修：旧公司套 21 文件/362 用例。21:35（并行模板迁移落地前）默认 5s 预算 4 文件/9 用例红（spawn CLI timeout 族）、放宽预算 **21/362 全绿**；21:44 并行单改 `templates/**` 后旧套 5 文件/13 用例红（模板夹具类，非本单 trust/投影回归）——须待并行单收口后复跑登记（§七-3） |
| 9 | 未解决缺口 | 包根导出未接线（`src/index.ts` 不在领土）；definition schema 未落地（O3-01 仅投影侧复验）；GAP-V2-17 只定形投影边界；坏锚 ESCALATE/拒启归 IMPL-07-07（§八） |

**一句话**：两件超限件的「触线即拆」清单已可执行且本轮零拆；org 纯投影与 O3-01 互斥、SEC-FC-03 坏锚 fail-closed 均有机器可判证据，四门绿；缺口如实登记，不宣称已完成拆分或已闭合 SEC-FC-03 后半。

---

## 一、超限件台账与「触线即拆」判定

### 1.1 本轮两件（plan/02 LANE-O / v2/16 company 行指定）

| # | 文件 | 实测（`wc -l`） | `lineBaseline` | 余量 | 状态 | 本轮处置 |
|---|---|---|---|---|---|---|
| 1 | `packages/company/src/validator.ts` | **612** | 655 | +43（≤655 即合规） | **已触 600 线**（>600） | 预案（§二），不拆 |
| 2 | `packages/company/test/repo-validate.test.ts` | **766** | 766 | **0** | **已触线且零余量** | 预案（§三），不拆 |

背景（不在本预案覆盖范围，仅登记，不扩大领土）：`packages/company/src/repo-validate.ts` 1021 行、`packages/company/src/dependencies.ts`（基线 775；并行单在途，实测以拆时为准）亦在 `lineBaseline`，按既有「只减不增」纪律办理；v2/16/plan-02 指派的**两件**是上表两行。

### 1.2 触线定义（机械可判）

1. **触线**＝`wc -l <file>` > `maxLinesPerFile=600`，或 > 该件 `lineBaseline` 值（`scripts/guards/boundary-rules.mjs` §三；宪法 20-§十五.三）。
2. **两件当前均已触线**，不是「将来会触线」：
   - 任何使行数**上升**的改动＝先拆后改（不得以「只加几行」例外）；
   - 只减不增的改动可随普通单办理，但清偿义务不消失；
   - 拆完当次即从 `lineBaseline` **除名**（降至 ≤600 的除名属基线下降，按 20-§十五.三.3 随提交办理；上调/新增基线才走提案流+制作人批）。
3. **禁止的「假拆分」**：抽注释/压缩格式冒充降行；改断言、删用例、改阈值或扩 `lineBaseline`；把超限件改名留原内容；拆出件仍 >600 或目录 >25 件。
4. 拆单必须独立单、独立 review 分支、四门（§二.4/§三.4）全绿＋旧测试触及面登记；**拆前先跑 `git status --porcelain` 记录工作树，避免把并行在途件卷进拆分 diff**。
5. 拆分**不得改变行为与错误口径**：文件:行定位、规则号（`org-config/...`）、`DirectoryIssue` 形状、公共导出名、契约 `dir` 域 case 输出全部保持不变。

---

## 二、`validator.ts`（612 行）拆分预案

### 2.1 目标文件／职责／行数预算

| # | 目标文件（新） | 职责（从 validator.ts 原样迁出） | 预算（≤） |
|---|---|---|---|
| 1 | `packages/company/src/org-config/guards.ts` | `SLUG_RE`、`isSafeRelativeOutputPath`、路径域错误文案（`RELATIVE_OUTPUT_MESSAGE`） | 60 |
| 2 | `packages/company/src/org-config/schema-job.ts` | `DurationSchema`、`OrgJobTriggersSchema`、`expandCadenceOk`、`cronShapeOk`、`OrgJobSchema`（D9 定时岗形状；映射表头注随迁） | 100 |
| 3 | `packages/company/src/org-config/schema-workflow.ts` | `WorkflowStateSchema`/`EdgeSchema`/`AnchorsSchema`/`TypeSchema`/`WorkflowsSchema` | 75 |
| 4 | `packages/company/src/org-config/schema-org.ts` | `OrgConfigSchema`＋`export type OrgConfig` | 105 |
| 5 | `packages/company/src/org-config/rules-cross.ts` | `crossRules`（level_distribution 对账／leader/dept 悬空；groups/hooks/cost-guard 接线保留） | 80 |
| 6 | `packages/company/src/org-config/rules-workflow.ts` | `WorkflowTypeLoaded`、`normalizeWorkflowStates`、`mainlineFwd`、`workflowRules`（W-1..W-9）、`toWorkflows` | 190 |
| 7 | `packages/company/src/org-config/load.ts` | `toSnapshot`、`MountOptions`、`loadCompanyDirectory`、`dirSubject` | 140 |
| 8 | `packages/company/src/validator.ts`（保留） | **只作公共 barrel**：原样 re-export 上列件的公共名（`loadCompanyDirectory`/`dirSubject`/`MountOptions`/`SLUG_RE`/`isSafeRelativeOutputPath`/`OrgConfig`）＋头注保留 | 40 |

预算合计上限约 790 行（含拆件后新增头注/import 重建），**硬约束是逐件 ≤600 与 `validator.ts` ≤40**；若实际合计超过 790，必须在拆单 review 前复核是否把正文误搬两处。目录 `org-config/` 新建，8 件 <25，合规。

### 2.2 迁移顺序（每步可独立编译/测试，禁止大爆炸）

1. **guards.ts**：先搬纯常量并让 `validator.ts` re-export；消费方（`init.ts`、panel、契约 subject）导入路径不变。跑 `typecheck`＋`dir-cases` 契约。
2. **schema-org.ts**：搬 `OrgConfigSchema`/`OrgConfig`；`multifile.ts` 的 `import type { OrgConfig }` 改为从 `../validator.ts` 或新件取（type-only，零运行时环），保持原注释「零运行时环」成立。
3. **schema-job.ts / schema-workflow.ts**：搬 zod 子 schema；`validator.ts` 只剩 schema 组合与引用。
4. **rules-cross.ts / rules-workflow.ts**：搬规则体；`lineOfPath`/`zodIssuesToDirectoryIssues` 仍来自 `multifile.ts`（方向：rules → multifile 值导入，不得反向）。
5. **load.ts**：搬 `toSnapshot`/入口；`validator.ts` 变薄 barrel。
6. **收尾**：从 `scripts/guards/boundary-rules.mjs` 的 `lineBaseline` 删除 `validator.ts` 条目（基线下降）；跑 §2.4 全量验收。

### 2.3 兼容面（拆单验收前必须逐项核对）

| 面 | 要求 |
|---|---|
| 公共导出 | `packages/company/src/index.ts` `export * from './validator.ts'` 不变；导出名集合**逐项相等**（拆前/拆后 `Object.keys(await import(...))` 对拍） |
| 类型导出 | `OrgConfig` 仍可从 `validator.ts` 导入（type re-export）；`multifile.ts` 不改语义 |
| 错误口径 | 规则号/`fix` 文案/`line` 定位不变（`dir` 域契约 3 case 与模板夹具逐字比对） |
| 行为 | `strictFiles` 缺省/`false` 语义、`multifileRules` 调用位置、groups/hooks/cost-guard 接线顺序不变 |
| 契约面 | `packages/contract/cases.json`、`CASES.md`、`dirSubject` 输入输出语义零改动 |
| 旧测试 | 旧测试断言零改动；本次拆分只动生产码与 `lineBaseline` |

### 2.4 验收命令（拆后冻结口径）

```bash
# 0) 触线/尺寸（逐件 ≤600；validator 只作 barrel ≤40）
wc -l packages/company/src/validator.ts packages/company/src/org-config/*.ts

# 1) 分层宪法（validator 基线条目已删；0 违例）
mise exec -- bun run guard:boundaries

# 2) 类型门（src 面）
mise exec -- bun run typecheck

# 3) V2 新套件（本包）
mise exec -- bun run test:v2 -- packages/company

# 4) 旧测试触及面：默认预算红也登记；预算放宽后须全绿（E-4 时序家族只动预算）
mise exec -- node_modules/.bin/vitest run packages/company/test --exclude '**/v2/**'
mise exec -- node_modules/.bin/vitest run packages/company/test --exclude '**/v2/**' --testTimeout=60000

# 5) 契约 dir 域不破（拆前/拆后同命令）
mise exec -- node_modules/.bin/vitest run --config vitest.v2.config.ts packages/contract

# 6) 导出面逐项对拍（拆前保存 keys，拆后 diff）
mise exec -- node --input-type=module -e "import('./packages/company/src/validator.ts').then(m=>console.log(Object.keys(m).sort().join('\n')))"
```

**红线**：任一命令红即不得宣称拆分完成；「被修到能跑」不等于验证通过。

---

## 三、`test/repo-validate.test.ts`（766 行）拆分预案

### 3.1 阶段一（首选：夹具外提，**旧测试台账零影响**）

| # | 目标文件 | 职责 | 预算（≤） |
|---|---|---|---|
| 1 | `packages/company/test/repo/fixtures.ts`[新，非 `.test.ts`] | `canonicalBase()`、`materializeBase()`、`expectRule()`、`slugOf()`、`pluginFixture` 路径、`root` 夹具生命周期辅助 | 240 |
| 2 | `packages/company/test/repo-validate.test.ts`（保留） | 6 个 `describe` 组（良基/A/B/C/D/E/面语义）＋ import 夹具；用例数 **45 不变** | 560（766−约 210–230；预期 ~540） |

优点：old-test 文件数仍为 209（`fixtures.ts` 不计入 `.test.ts`），`docs/baselines/old-tests-ledger.md` 与 `scripts/verify/old-test-ledger.mjs` **无需改动**；guard 只需删 `repo-validate.test.ts` 的 766 基线。若夹具外提后仍 >600（或之后增长越线），进入阶段二。

### 3.2 阶段二（仅当阶段一不足）

| # | 目标文件 | 职责（按 45 用例原组切分） | 预算（≤） |
|---|---|---|---|
| 1 | `test/repo/fixtures.ts` | 同 §3.1 | 240 |
| 2 | `test/repo/a-directory-contract.test.ts` | A 组（目录契约）＋组内变异表 | 120 |
| 3 | `test/repo/b-file-contract.test.ts` | B 组（文件契约） | 110 |
| 4 | `test/repo/c-cross-ref.test.ts` | C 组（交叉引用） | 130 |
| 5 | `test/repo/d-dependency.test.ts` | D 组（依赖契约） | 100 |
| 6 | `test/repo/e-hygiene.test.ts` | E 组（卫生契约） | 100 |
| 7 | `test/repo/surface-semantics.test.ts` | 面语义与共用核（R7/判定器错误/导入流两遍） | 100 |

目录 `test/repo/` 7 件 <25；每件 ≤600；用例总数仍 **45**（逐组用例数在拆单报告列「拆前=拆后」表，不靠总数掩盖）。

### 3.3 阶段二的旧测试台账联动（跨领土，必须单列）

1. `docs/baselines/old-tests-ledger.md`：原 `test/repo-validate.test.ts`（766 行）行**替换为 6 个新 `.test.ts` 行**并注「原 766 行按 A/B/C/D/E/面语义拆分」；**只追加谱系说明，不无声删除**（旧台账纪律：无无声删除）。
2. `scripts/verify/old-test-ledger.mjs`：`EXPECT_FILES` 209 → **214**（1 拆 6，净 +5），口径说明文本 `210 files` → **215 files**（209+5＋口径差 1）；否则 `verify:v2` 的 ledger 校验必红。
3. 该脚本与根 `package.json`/CI 串接不在公司包领土：如需改，走 T 泳道单/本拆单的显式跨领土登记，**不得顺手改**。
4. 阶段一不触发以上任何一项（首选理由）。

### 3.4 验收命令（拆后冻结口径）

```bash
# 0) 尺寸（拆件逐件 ≤600；旧件 ≤600 后从 lineBaseline 除名）
wc -l packages/company/test/repo-validate.test.ts packages/company/test/repo/*.ts

# 1) 分层宪法：0 违例，repo-validate.test.ts 基线条目已删
mise exec -- bun run guard:boundaries

# 2) 用例数守恒（拆前 45；阶段二逐组表）
mise exec -- node_modules/.bin/vitest run packages/company/test/repo-validate.test.ts
# 阶段二：
mise exec -- node_modules/.bin/vitest run packages/company/test/repo

# 3) 旧测试全包（默认预算红登记；放宽预算须全绿）
mise exec -- node_modules/.bin/vitest run packages/company/test --exclude '**/v2/**' --testTimeout=60000

# 4) 旧测试台账（阶段一必绿；阶段二按 §3.3 改后必绿）
mise exec -- node scripts/verify/old-test-ledger.mjs

# 5) V2 门（公司包）
mise exec -- bun run typecheck && mise exec -- bun run typecheck:v2 && mise exec -- bun run test:v2 -- packages/company
```

---

## 四、O3-01 三契约互斥复验记录

### 4.1 三契约与冲突原文（v1 审计）

| 契约 | 部门形状（冲突点） | 出处 |
|---|---|---|
| 76 `DEF-ORG-01`（定义包语义 schema） | 字段仅 `id/existenceReason/responsibilityBoundary/memberPositionRefs/coordinationRef/costAssessmentRef/reviewAt/dissolutionPlanRef`——**无 `leader`、无 `parent`** | `76:1000-1012`（经 docs/audit-DSF/O3 引） |
| `validator.ts` 部门形状 | `leader: z.string().min(1)`、`parent: z.string().nullable()` 必填 | `packages/company/src/validator.ts:253-263`（本件写作时点） |
| `81-files/19` 逐文件契约 | 「键封闭…必填 `parent`…`leader`（工号）」 | `81-files/19:886`（经 docs/audit-DSF/O3 引） |
| 权威侧 | 04:124「组织事实源唯一：org-config.yaml」 vs 82:613/618「旧格式只读投影 + 新格式权威」——**无决定授权迁移** | docs/audit-DSF/O3 §O3-01 |

结论（v2/17 O3-01 行）：V2 已消解（旧格式只读投影＋新格式权威），**随 MIG-05 复验**。本件即该复验的投影侧记录。

### 4.2 V2 消解口径（本单执行面）

1. **旧格式只读投影**：legacy `org-config`/`departments` 只作投影输入（至 MIG-08，§五）；投影结果不构成组织权威，也不写盘。
2. **新格式权威**：definition 切片是对象权威；legacy 与 definition **不是优先级关系**，是**互斥关系**——同一对象同时出现即阻断（不静默择一、不合并、不回落）。
3. **legacy 镜像面**：`org-config` 索引与 `departments/<path>/config.yaml` 是同一 legacy 契约的两个声明面；字段漂移＝两处各自当权威→阻断。
4. **对象族**：部门（path）／一级单元（`unit:<unitId>`）／空编（`vacancy:<kind>:<ref>`）同则；`authority.conflicts` 记录带前缀的对象 id，供审计对账。

### 4.3 投影侧强制点与复验结果

| 断言 | 强制点（代码） | 复验用例 | 结果 |
|---|---|---|---|
| 同 path legacy+definition → 阻断，且冲突对象**不入树**（无两权威节点） | `src/projection/authority.ts` `reconcileDepartmentDeclarations` | `org-projection.test.ts`「O3-01…同 path…」 | PASS |
| definition 独有对象 → definition 权威；legacy 独有对象 → legacy-readonly（各归其面） | 同上 | 「definition 独有对象…」「不相交 → 各归其面」 | PASS |
| legacy 索引↔逐文件漂移 → 阻断（不静默取一） | `authority.ts` `mirrorDrift` | 「legacy 镜像漂移…」 | PASS |
| 一级单元/空编同对象两权威 → 阻断，不进投影条目 | `src/projection/units.ts` `reconcileUnits`/`reconcileVacancies` | `org-structure.test.ts` 单元/空编两权威用例 | PASS |
| O3-01 复验记录常量（表名/规则/消解/冲突处置） | `src/projection/types.ts` `O3_01` | 「O3-01 复验记录可判」 | PASS |

**复验结论**：**O3-01 投影侧 PASS**——同一组织对象在投影产物中恰一个 authority/contract 面；六类冲突路径均有阻断用例，不存在「两权威节点」或「静默择一」路径。证据命令：`mise exec -- bun run test:v2 -- packages/company`（本单 3 文件 74 用例）。

### 4.4 残留（未证/未含，不得冒称闭合）

1. **definition schema 未落地**：本单只按「已解析切片」的投影输入验互斥，未实现/冻结 `DEF-ORG-01` 的 zod/schema；真实定义包解析不在本轮。
2. **SCH-ORG-01 字段级**：N/单元/vacancy 字段仍未进 `SCH-ORG-01`（GAP-V2-17，§六）；投影边界形不等于 schema 已收口。
3. **规范侧回写**：76/81/04 的互斥形状修订与「权威迁移决定」仍归上位文档修订流；本件不做 v2 卷改写，不代制作人裁。
4. 因此本记录只宣称「**投影侧复验通过**」，不宣称「O3-01 全链闭合」；全链闭合点＝定义包权威落地＋MIG-08 收口。

---

## 五、org-config / departments 只读兼容声明（至 MIG-08）

1. **声明**：legacy `org-config.yaml`＋`departments/<部门>/config.yaml` 在 **MIG-08 结束前**仅作为**只读投影输入**保留（v2/06 §四.3；v2/16 company 行「org-config 只读兼容至 MIG-08 结束」）。本单新增 `src/projection/**` **不含任何写路径**：不写文件、不写锚、不写 git、不改配置。
2. **不是权威**：投影输出（树/N/空编/CL 判据输入/权力引用）不是组织事实的权威；「配置声明拟任、记录才是事实」（v2/06 §5.1）。消费方不得把投影当任命/在岗/层级事实。
3. **代码登记**：头注在 `packages/company/src/projection/index.ts` §一（含 MIG-08 退出点）；本文件 §五为 docs 侧登记。若需延长/提前退役，改此两处＋上位文档，不得私改语义。
4. **导出面**：本单领土不含 `packages/company/src/index.ts`，投影暂以相对路径消费（同包内 `./projection/index.ts`）；包根导出收口与旧格式退役同归 **MIG-08**（缺口 §八-1）。本轮未放宽任何对外 API。
5. **退出条件（MIG-08 前核对）**：定义包组织面权威可用＋旧格式无剩余消费方（prompt/daemon/panel/API 读面切完）＋本文件删除「至 MIG-08」限定并改登记；任一未满足则不得宣称旧格式已退役。

---

## 六、GAP-V2-17 一级单元载形登记（投影边界定形，非 schema 收口）

`docs/v2/06 §5.2/§5.3` 要求包内表达一级单元 N（N≥1，默认 1；三省=N=3 仅示例）与各单元域；`SCH-ORG-01` 无字段级承载（v2/10 §4.3、v2/17 §4.5）。本单只在**投影输入边界**定形，不新增 YAML 键、不新增记录类、不冻结 v2/09 值集：

| 规范字段（GAP 提议） | 本单投影载形 | 落位 | `SCH-ORG-01` 现状 |
|---|---|---|---|
| `unitCount`（≥1，默认 1） | `units.count`（未声明＝1；显式 `units:[]` 阻断，不猜 1） | `structure.units.count` | **无字段** |
| `units[]` | `units[]`（声明面）＋默认隐式单元（`(whole-company)`） | `structure.units.units` | **无字段** |
| `unitId` | `unitId` | `ParsedUnit.unitId` → `ProjectedUnit.unitId` | **无字段** |
| `domain` | `domain: string[]`（声明必填非空、域不重叠） | 同上 | **无字段** |
| `headRef` | `headRef: string \| null`（G8 工号；缺省在 N=1 为单人退化非空编） | 同上 | **无字段** |
| `vacancyState` | `vacancyState: 'staffed' \| 'head-vacant'`＋`reviewAt`（ISO 8601 形状） | 同上 | **无字段** |

- **字段语义**：N 不参与 CL 判据（v2/03 §2.4；用例「N 不参与 CL 判据」）；域重叠=结构违规判负（§八）；空编=登记＋复审期限，缺期限阻断。
- **闭口条件**：定义包 schema 侧登记 `SCH-ORG-01` 字段与 `units[]` 值集（v2/10/v2/09 修订流，责任 06/10/17），并由 MIG-08 收口前复核；本件不代裁字段名/值集。
- **状态**：**部分定形（投影边界）**；不得写成「GAP-V2-17 已关闭」。

---

## 七、门禁证据（本轮四门＋旧测试触及面）

### 7.1 四门（2026-10-28 21:42–21:43 CST，仓根）

| # | 命令 | 结果 | 原始输出（节选） |
|---|---|---|---|
| 1 | `mise exec -- bun run typecheck` | **exit 0** | `$ tsc --noEmit`（零输出） |
| 2 | `mise exec -- bun run typecheck:v2` | **exit 0** | `$ tsc --noEmit -p tsconfig.v2.json`（零输出） |
| 3 | `mise exec -- bun run test:v2 -- packages/company` | **exit 0**，6 文件/130 用例 | 见下 |
| 4 | `mise exec -- bun run guard:boundaries` | **exit 0**，0 违例 | `边界门禁 PASS：扫描 767 文件（范围面代码件 625），0 违例（分层宪法 20-§十五）` |

`test:v2 -- packages/company` 原始尾段：

```text
 ✓ packages/company/test/v2/security-baseline.test.ts (26 tests)
 ✓ packages/company/test/v2/org-structure.test.ts (29 tests)
 ✓ packages/company/test/v2/org-projection.test.ts (19 tests)
 ✓ packages/company/test/v2/pkg-hygiene.test.ts (15 tests)      ← 并行 MIG-05-02 在途件
 ✓ packages/company/test/v2/asset-import.test.ts (17 tests)     ← 并行 MIG-05-01 在途件
 ✓ packages/company/test/v2/defpkg-import.test.ts (24 tests)    ← 并行 MIG-05-02 在途件

 Test Files  6 passed (6)
      Tests  130 passed (130)
EXIT=0
```

补充（非本单门，观察位）：全量 `mise exec -- bun run test:v2` → **38 文件 / 694 用例全过，exit 0**（21:40）。

### 7.2 本单文件尺寸（全部 <600）

| 文件 | 行数 |
|---|---|
| `src/projection/index.ts` | 82 |
| `src/projection/types.ts` | 357 |
| `src/projection/issues.ts` | 72 |
| `src/projection/authority.ts` | 215 |
| `src/projection/org-tree.ts` | 173 |
| `src/projection/units.ts` | 214 |
| `src/projection/org-structure.ts` | 420 |
| `src/trust.ts` | 340 |
| `test/v2/org-projection.test.ts` | 394 |
| `test/v2/org-structure.test.ts` | 460 |
| `test/v2/security-baseline.test.ts` | 255 |

### 7.3 旧测试触及面登记（只登记、不修；`test/v2` 不计入旧台账）

| 时点/命令 | 文件/用例 | 红 | 说明 |
|---|---|---|---|
| 改造前基线 `vitest run packages/company` | 21 / 362 | 4 文件 / 5 用例 | 全部 spawn CLI 5s timeout 族（本机负载） |
| 改造后 `vitest run packages/company`（含新 v2） | 27 / 490 | 4 文件 / 7 用例 | 新增 v2 用例全绿；红仍 spawn CLI timeout，负载上升多 2 条 |
| 改造后旧面 `vitest run packages/company/test --exclude '**/v2/**'`（默认 5s） | 21 / 362 | 4 文件 / 9 用例 | 全部 timeout 族；单跑 `company-validate-cli.test.ts` 独绿 |
| 同上 `--testTimeout=60000`（只动预算；**21:35 并行模板迁移落地前**） | 21 / 362 | **0** | **21/362 全绿**——证明 trust 改动未破坏旧行为；红属 E-4 时序/负载家族 |
| 同上 `--testTimeout=60000`（**21:44 并行单改 `templates/**` 后**） | 21 / 362 | 5 文件 / 13 用例 | 失败集中在模板夹具面：`gen-template`（3–9 级逐字节）、`hooks`（ENOENT `.studio-next.yaml`）、`init`（默认模板/5 级）、`multifile`（2 级模板人数）、`industry-templates`（game/internet 人员集）、`create`（工位数/自检）；与 trust/投影无关，属**并行 05-04/05-05 在途模板迁移**污染，须待其收口后复跑登记 |

纪律：未修改任何旧测试、未把旧测试加入 `test:v2`、未改 `vitest.v2.config.ts`/`tsconfig.v2.json`；旧测试台账（`old-tests-ledger.md`、209 件）零改动。**旧测试触及面的最终登记以并行模板迁移收口后的复跑为准**；本单自身证据面＝`test:v2 -- packages/company` 的 3 文件/74 用例（全绿）。

### 7.4 trust 坏锚变更证据（SEC-FC-03 O 侧）

- 代码：`readTrustAnchor`（无锚 null／坏锚抛 `TrustAnchorError`）、`parseTrustAnchor`（逐项验型）、`inspectTrustAnchor`（absent/valid/invalid 三态）、`trustStateOf`（坏锚不折算受信）。
- 用例：`security-baseline.test.ts` **26 条**——无锚/坏 JSON/12 类形状/不可读/写与批准/升级/撤销通道不覆盖坏锚/合法链路兼容。
- 未证：热重载应用门「锚在场且校验过」前置＋ESCALATE＋重复出现拒启＝`IMPL-07-07`（本单不做，§八-4）。

### 7.5 领土与工作树

- 本单写入：`packages/company/src/projection/**`（7 件）[新]、`packages/company/src/trust.ts`（改）、`packages/company/test/v2/{org-projection,org-structure,security-baseline}.test.ts`（3 件）[新]、本文件[新]；**无其它写入**。
- 写作时点 `git status --porcelain` 另含并行 MIG-05 在途件（`packages/company/src/assets/**`、`packages/company/src/dependencies.ts`、`packages/company/test/v2/{asset-import,pkg-hygiene,defpkg-import}.test.ts` 及他包）——**非本单领土**，本单未触碰；四门文件计数包含这些在途件，故 §七.1 的 6 文件/130 用例不等于本单 74 用例。
- 未 git commit（按令）。

---

## 八、未解决缺口（如实登记，不冒称闭合）

1. **包根导出未接线**：`packages/company/src/index.ts` 不在本单领土，`src/projection` 只能相对路径消费；对外 `@studio-next/company` 尚无投影导出。归 **MIG-08**（与旧格式退役同收口）。
2. **definition 权威未实现**：O3-01 只验「已解析切片」的互斥投影；`DEF-ORG-01` schema、definition 包解析、记录面权威均未落地——不得宣称 O3-01 全链闭合（§4.4）。
3. **CL 判据输入仍大面积缺证**：legacy 无设立记录/root_delegation/G 职级/审计位字段，`criteria[].satisfied` 一律 `null`、`structuralLevel=null`（**设计如此，不猜不填**）；真正 CL 判定需「包＋记录」联合求值（v2/03 §2.4），本单只交输入面。
4. **SEC-FC-03 后半未做**：hot-reload 应用门前置、ESCALATE 具名接收者、重复出现拒启＝`IMPL-07-07`。过渡期风险：坏锚现在会从 `readTrustAnchor` 抛出；若调用方未捕获分类，表现为 reload 异常而非「拒自动应用＋ESCALATE」——**已知临时行为**，07-07 收口。
5. **GAP-V2-17 只部分定形**：SCH-ORG-01 字段/值集未登记；`headRef` 在定义包侧是工号还是位置引用未裁（本单投影输入按 G8 工号解释）；域划分的合法值集未定。
6. **空编逾期不判**：投影不取时钟（零 IO），`reviewAt` 只做形状闸；「逾期未补设→降级」由消费方按时钟判定，本单不代判。
7. **旧测试 timeout 族＋并行模板迁移污染**：默认 5s 预算下 spawn CLI 红，放宽预算在模板迁移落地前全绿；21:44 起并行 05-04/05-05 改 `templates/**` 使模板夹具类旧测试红（非本单回归）。属 E-4/并行单交织，登记不修，待并行单收口后复跑（§七.3）。
8. **拆分未实施**：两件超限件本轮零拆；「触线即拆」预案见 §二/§三，拆单另立（含 §3.3 阶段二的台账/校验器跨领土联动）。
9. **其它基线件**：`repo-validate.ts` 1021、`dependencies.ts`（基线 775）仍按既有基线只减不增，不在本预案两件内（§1.1 背景行）。
10. **契约/记录面未动**：本单未新增记录类、端口、YAML 键、值集；`cases.json`、`CASES.md`、旧测试、`assets/`、`dependencies.ts`、`templates/`、其它包均零改动。

---

*本件为 MIG-05 / IMPL-05-07 交付物；两件超限件拆分须另立单并过制作人/宰相审验，本文件不构成拆分授权。*
