# NEG 最后一组 · RING-01..05＋ENG-01/02/04/05 —— 执行与缺口登记（NEG 收口件）

> **头注**
> - 日期：2026-10-29（采集 10:02Z–10:08Z UTC / 18:02–18:08 CST）
> - git HEAD：开工 `a25324f`（分支 `dev`）；采集期间 HEAD 两次前移——并行 EMP 单 `c9e8540`（只改 `records/emp-neg.ts` 与 `test/v2/neg-emp2.test.ts`）与集成侧提交 `eaf5932`（把本波 10 件测试/报告/日志扫入版本库，**非本单提交**）；本波全部证据命令以实跑时点为序记录；本单自身**未 git add/commit**
> - 工具链：node **v24.21.0**（`mise exec --`）/ bun **1.4.3**｜Darwin arm64
> - 执行者：DeepSeek-V41-Flash（StudioNext 施工代理；NEG 最后一组）
> - 性质：**只新增** `apps/daemon/test/v2/neg/ring.test.ts` 与本目录 `docs/probe/neg-ring-eng/**`；不改生产码（仅临时变异验证，已按 sha256 还原）、不改其它包/旧测试、不写公司目录、不发出站请求、不 commit
> - 依据：`docs/v2/17-验证矩阵与追溯.md` §4.1 NEG-RING-01..05 / §4.4 NEG-ENG-01..05、§一 V0–V6；`docs/v2/05-技术抽象-总规范与框架总装.md` §五（五环强制失败列）；`docs/v2/01-根-公司自治总纲.md` §5.4（分类权/未批准不生效）与 §三 I-6/I-13；`docs/v2/07-技术抽象-执行能力与工作运行.md` §四（派生树四判据）；`docs/v2/11` §六 REC-EVD-RVK／§八 REC-CHG-01；`docs/v2/12` §5.1/§5.3（状态三值）／§六（判定件放行≠能力证明）；`docs/v2/13` §1.6／§八（ENG 面）；`docs/v2/15` §4.3／§六；`docs/plan/04-测试与验收策略.md` §三（NEG 冻结覆盖命令）
> - 口径：状态三值 **executed｜not-executed｜not-applicable**（唯一主表 v2/09 ENU-111，登记位置 v2/12 §5.1）；负向结论也用 `executed`；**未执行行不填「预期通过」**、不写假测试；每行「缺什么」逐条可核；原始日志逐字留存在本目录

---

## 一、一页结论（诚实版）

| 项 | 结论 | 数字/证据 |
|---|---|---|
| 本组 9 行 | **executed 2｜not-executed 7｜not-applicable 0** | §二表；executed＝NEG-RING-02、NEG-RING-05 |
| 全局 ID 对账 | **119 IDs accounted，其中 executed=112、not-executed=7** | §五；**不得读作「119 executed」** |
| 冻结命令（落盘前） | 110 | §五.1（10:03Z 实测，差集恰为本组 9 个 ID） |
| 冻结命令（落盘后） | **119** | §五.1（10:06Z 实测） |
| 场景测试 | `neg/ring.test.ts` **8 用例全绿**；neg 子套件 **29 用例全绿** | `log-02`／`log-03`／`log-08` |
| 变异验证 | 去守卫 2 次均变红（RING-02 红 2 用例；RING-05 红 1 用例）→ 已还原且 sha256 与基线同值 | `log-04`／`log-05`／`log-06` |
| 五道门禁 | typecheck／typecheck:v2／test:v2 neg／guard:boundaries／verify:docs 全绿（exit 0） | §六；`log-08`／`log-09` |
| 写面 | 只新增 2 处；测试文件 356 行（<600） | §八；`log-00` |

**一句话**：本组能真跑的两行（RING-02 撤回结清、RING-05 未批生效）已用生产函数真跑并做变异验证；其余 7 行因**机制/场景面未建**如实登记 `not-executed` 并逐行写明缺什么。**119 是「ID 全部登记在案、可被冻结命令数到」的对账数，不是「119 条都已执行」**。

---

## 二、9 行判定表（ID｜状态｜证据｜缺什么）

| ID | 状态 | 证据 | 缺什么 |
|---|---|---|---|
| **NEG-RING-01** | `not-executed` | 本报告 §七.1；`log-07`（`价值环|六要素` 仓内仅 2 处且均为 REC-WORK-COMMIT-CHANGE 的「申请段六要素」，与 01 §0.4 闭环六要素无关） | 缺**价值环六要素无环场景 harness**：受理→合同→执行→收割→验收→复盘的全链编排器＋「越界/无价值/不可验收/承诺不可持续仍沿原路径庆功」四类强制失败出口断言；仓内 e2e 仅公司提交/serve 生命周期/crash 三类，无价值环场景面 |
| **NEG-RING-02** | `executed` | `apps/daemon/test/v2/neg/ring.test.ts` 4 用例（`NEG-RING-02` 具名）＋`log-02`（4 passed）＋`log-04`（变异红 2 failed） | —（本行已执行；**残余**：只证目录/记录判定面，不证网关整树强制＝SEC-REV-02 仍目标（未证）；不证撤回已完成/理由充分） |
| **NEG-RING-03** | `not-executed` | 本报告 §七.2；`log-07`（「缺能力/能力缺口/外援/缩编」实现面 3 处命中均为目录扩缩编，非能力处置） | 缺**缺能力五出口处置件**（缩/换/外援/拒绝/停止，02 §五）：能力链只有声明/资格/回执形状（`records/cap.ts`），无「缺能力→逐项必答出口」的决策件与执行面，也无退化/成本失控的接单拒绝路径 |
| **NEG-RING-04** | `not-executed` | 本报告 §七.3；`log-07`（OBJ-05/REC-EVAL-01 仅记录形状与单记录判定，无场景编排） | 缺**V6·SCEN 组织环场景编排**：OBJ-05 结构评价（判据五面＋组织绩效输入＋整体资源账）→组织变更事件（REC-LIFE-08 等）→「新增层级掩盖协调失败/整体透支」的时序判负；需场景编排器与跨记录断言，现有 EVAL 判定件只判单条记录形状 |
| **NEG-RING-05** | `executed` | 同文件 4 用例（`NEG-RING-05` 具名）＋`log-03`（4 passed）＋`log-05`（变异红 1 failed） | —（本行已执行；**残余**：只证 `validateChangeSegment` 判定面；「变更生效」的运行期受控 rollout 与后验观察执行面未建，不得据此称进化环闭合） |
| **NEG-ENG-01** | `not-executed` | 本报告 §七.4；`log-07`（`packages/*/dist`、`apps/*/dist` 目录数 **0**；contract `exports` 只指 `src/index.ts`） | 缺**dist/切换 spike 面**：ESM-only 负测须先有可 `require('@studio-next/…')` 的 CJS 入口/构建产物；13 §1.6 切换集为空、波外 dist 切换 spike 单未立——无可测对象，写负测即假测试 |
| **NEG-ENG-02** | `not-executed` | 本报告 §七.5；`log-07`（`maxAliasCount` 全仓 **0** 命中；`parseDocument/parse` 调用点无别名/深度/规模上限选项） | 缺**YAML bomb 上限实现**（13 §八-5）：别名数/深度/规模上限与拒收码均未落；`yaml` 解析器在（core/company/adapters 依赖），但「上限负测拒收」无防线可测 |
| **NEG-ENG-04** | `not-executed` | 本报告 §七.6；`log-07`（`process.versions.node` 仅 3 处且全在 store 测试的环境记录，无入口拒绝） | 缺**入口版本 fail-fast**（13 §八-2/3）：daemon/contract 入口无 Node 版本校验与拒启；`package.json#engines` 只是包管理器元数据，不是启动拒绝——无拒绝动作可测 |
| **NEG-ENG-05** | `not-executed` | 本报告 §七.7；`log-07`（「证据通道」受理件 **0** 命中；eval/stdin 仅出现在 store 测试的既有用法） | 缺**证据通道受理件**：无「拒收 eval/stdin 形态、只认 `.ts` 文件或 `mise exec -- node` 等价重跑」的受理门/台账；本报告自身属被审对象，**不得自证纪律已过**（V0·纪律行） |

**统计（9 行）**：`executed` **2**（RING-02／RING-05）｜`not-executed` **7**（RING-01/03/04、ENG-01/02/04/05）｜`not-applicable` **0**。

> 本表自身属 **docs/probe 报告面**（v2/17 允许的报告域）。表中出现的 ID 会计入冻结命令的「已登记」分子，但**不因此变成 executed**——状态列逐行自证（上表 7 行明确 `not-executed`）。

---

## 三、NEG-RING-02（executed）：撤回结清——派生枚举＋凭据结清缺一即判负

**规范行（v2/17 §4.1）**：被测对象＝权责环撤回结清；构造场景＝「撤回不含派生枚举与凭据结清即宣称完成」；预期拒绝＝I-6 判负、对账差异非空即拒（08 §1.3）；验证级 V1＋V4。

**被测生产面（全部真函数，无 fake）**：
1. `packages/gateway/src/catalog.ts` → `createCredentialCatalog().revoke()`（目录侧前腿：三动作齐＋后代枚举逐项相等才落状态，拒时零状态变更）；
2. 同包 `catalog-entry.ts` → `readRevocationProof()`（四判据读法）／`reconcileRevocation()`（残留对账，`stillUsable` 非空＝判负输入）；
3. `packages/contract/src/records/evd.ts` → `validateRevocationEvidence()`（REC-EVD-RVK 记录面，I-6）。

**场景基座**：真登记三层派生树 根 `SEC-GW-SIGNING` → 子 `SEC-MX-BOT-PASSWORD` → 孙 `SEC-MX-SUBAGENT`（孙代＝派生执行体最易漏枚举的一层）。

**四判据逐条与断言**（对应 `ring.test.ts` 的 4 个 `NEG-RING-02` 用例）：

| 判据（v2/07 §四） | 负形态构造 | 实测拒绝（生产原文/subcause） | 正例对照 |
|---|---|---|---|
| 一·后代清单 | ①完全不给 `descendants`（「父撤即全撤」冒充）②只枚举子代、漏孙代 ③枚举含目录外引用 `SEC-GW-GHOST`；记录面活后代 `grandchild-1` 未入清单 | `catalog-descendants-incomplete`／`catalog-descendants-unknown`；记录面 issue `payload.descendants_inventory`「后代未全枚举」 | 逐项相等 → `revoke` 落状态、`revoked` 三元组齐 |
| 二·停用证据（三动作） | `injectionStopped=false`／`fenceRejectionRecorded=false`／`evidenceRefs=[]` 逐项打开 | `catalog-proof-missing`（三动作未齐不得记完成） | 三动作齐 → 放行 |
| 三·无后代确认 | 叶子凭据不给 `noDescendantConfirmation`；或只给 `probeMethod` 缺 `lastProbedAt` | `catalog-no-descendant-confirmation`；记录面空清单→issue `payload.no_descendant_confirmation`「不得留空视为零」 | 探测方法＋最后探测时点齐 → 放行 |
| 四·残留观察 | 父已撤而子/孙仍 `active` 的快照；记录面「有存活却 `claimedComplete`」 | `reconcileRevocation().stillUsable` **非空**；issue `recordType`「未全停不得称撤回完成」 | 完整撤回后真实目录视图对账 `stillUsable=[]`、后代 `supply` → `catalog-revoked` |

**「凭据结清未发生」的直接证据**：两次被拒（缺枚举/漏孙代）之后，`catalog.supply('SEC-MX-BOT-PASSWORD')` 与 `catalog.supply('SEC-MX-SUBAGENT')` 均返回 `kind:'ok'`——后代仍持可用凭据，且 `catalog.rows()` 全部 `revocation_state='active'`（零状态变更，不得「先撤再补枚举」）。这正是 v2/17 RING-02 的「不含凭据结清即宣称完成→判负」。

**变异验证（log-04）**：把 `readRevocationProof` 的「后代枚举缺项即拒」守卫条件改成逻辑不可达（`missing.length > knownDescendants.length`）后，RING-02 由 4 passed 变 **2 failed**（`expected undefined to be 'catalog-descendants-incomplete'`；`readRevocationProof(...).ok` 由 false 变 true）；还原后 sha256 与基线同值、复跑 8 passed（log-06）。

---

## 四、NEG-RING-05（executed）：未批生效——未批准/未验证的变更生效即判负

**规范行（v2/17 §4.1）**：被测对象＝进化环未批生效；构造场景＝「未批准/未验证的变更生效；失败后修低判据」；预期拒绝＝无验证生效为零、I-13 判负（01 §5.4）；验证级 V1＋V3。
**被测生产面**：`packages/contract/src/records/chg.ts` → `validateChangeSegment()`（REC-CHG-01；段序/三门/无验证生效为零/R-8）。

**四个负形态与正例对照**（对应 `ring.test.ts` 的 4 个 `NEG-RING-05` 用例）：

| 场景 | 构造 | 实测拒绝（issue 路径＋生产文案片段） | 正例 |
|---|---|---|---|
| 未批准生效（跳段） | `segment=controlled_effective`、`previousSegment=independent_verification`（激活批准这一门未成立就进受控生效） | `payload.segment`「段不可跳不可互替」 | 上一段＝`activation_approval` 时同记录放行（见下行正例） |
| 未验证生效（三门未成立） | `establishedSegments=[]` 或只给 `verification_authorization`＋`independent_verification`（已验证、未批准） | 逐门 3 条／缺批准门 1 条「无验证生效为零：须先有 … 段」 | 三门段全成立＋`controlled_rollout` 齐 → `{ok:true}` |
| 三门合并 | `gateDeciders` 让验证授权/独立验证/激活批准同为 `same-position` | `payload.decided_by`「三门不得由同一具名位置作出」 | 三门三个具名位置 → 放行 |
| 失败后修低判据 | `no_override=false`；或 `criteriaOverridesOriginal=true`（判据变更覆盖原结论） | `payload.no_override`「判据变更不得覆盖原结论」；`payload.criteria_version`「判据变更覆盖原结论＝R-8 判负」 | 首段 `candidate`＋`no_override=true` → 放行 |

**变异验证（log-05）**：把 `validateChangeSegment` 的「无验证生效为零」守卫改成逻辑不可达（加 `established.size < 0`）后，「未验证生效」用例由 passed 变 **1 failed**（`expect(outcome.ok).toBe(false)` 收到 true）；还原后 sha256 与基线同值、复跑 8 passed（log-06）。

> 边界：两行都只证**判定件**的拒绝/放行，不证运行期「变更真的没生效」或「撤回真的全树停用」——网关整树强制（SEC-REV-02）与受控 rollout 执行面仍是目标（未证），不得把本报告读成五环闭合或能力证明（v2/12 §0.5-3/§六）。

---

## 五、119 对账：ID 全登记 ≠ 全部执行

### 5.1 冻结命令（逐字取自 `docs/plan/04` §三，未改模式/路径域）

```bash
grep -rhoE 'NEG-[A-Z]+-[0-9]+' packages/contract/cases.json apps packages scripts docs/probe 2>/dev/null | sort -u | wc -l
```

| 时点 | 实测 | 说明 |
|---|---|---|
| 本波落盘前（10:03Z） | **110** | 与 v2/17 §四声明表（119）做 `comm` 差集，缺项**恰为**本组 9 个 ID：`NEG-RING-01..05`、`NEG-ENG-01/02/04/05`——无第 10 个缺项、无超号/拼写项 |
| 本波落盘后（10:07Z） | **119** | 新增测试（RING-02/05 具名标题）＋本报告 9 行表，把这 9 个 ID 全部带入冻结命令的登记域 |

> **机械自检抓到过的污染（如实登记）**：报告首轮落盘后冻结命令曾得 **120**——测试夹具票号把 `T-`＋`NEG-RING-`＋单位数拼在一起，让正则多识别出一个**非声明 ID**（不在 v2/17 声明表、不属本组）。已把票号改为 `T-RING02-1` 并复算 **119**；差集随之恰为 9 个真 ID（无多余/无超号）。这正是冻结命令用于自检的价值：**幻影 ID 也算污染**，不以注释/假测试充数、也不留假 ID。

**差集复算（落盘前）**：

```text
$ comm -23 <(grep -rhoE 'NEG-[A-Z]+-[0-9]+' docs/v2/17-验证矩阵与追溯.md | sort -u) <(grep -rhoE ... packages/... | sort -u)
NEG-ENG-01 / NEG-ENG-02 / NEG-ENG-04 / NEG-ENG-05
NEG-RING-01 / NEG-RING-02 / NEG-RING-03 / NEG-RING-04 / NEG-RING-05
```

### 5.2 executed=112 的口径（可复算，不用文档充数）

「executed」在本报告的定义＝**该 ID 在仓内可执行证据件中有具名用例**（V2 vitest 的 `describe/it` 标题，或 contract `cases.json` 的 case 标题由 contract runner 执行）。落盘后实测：

```text
# ① V2 vitest 标题取证的 ID 数（含本波 RING-02/05）
$ for id in $(grep -rhoE 'NEG-[A-Z]+-[0-9]+' packages/contract/cases.json apps packages scripts docs/probe | sort -u); do
    grep -rEq "^\s*(describe|it)\(.*$id" apps/*/test/v2 packages/*/test/v2 && echo "$id"
  done | sort -u | wc -l
102
# ② 仅由 contract cases.json 标题取证（无 vitest 标题）的 ID 数
$ … | comm -13 <(上面的 102 个) -
10        # NEG-SCH-01..10（契约 runner 执行的 case 标题）
# ③ executed = 102 + 10 = 112；not-executed = 119 - 112 = 7
```

- **执行项 112**＝既有 110（100 条 vitest 标题＋10 条 SCH 契约 case）＋本波 2（RING-02/05，实跑绿）。
- **未执行项 7**＝RING-01、RING-03、RING-04、ENG-01、ENG-02、ENG-04、ENG-05（§二表 7 行 `not-executed`，与本波 9 行减去 2 个 executed 完全吻合，无遗漏/无重复）。
- **禁止读法**：本报告**不写「119 executed」**；119 是「ID 全部登记进证据域」的对账数（其中 7 条明确未执行）。「ID 出现」不升为语义完备复核：本波只复跑 neg 子套件（29 用例）与全量 V2 门禁的历史结论，未逐条重跑其余 110 条的证据件。

---

## 六、五道门禁（全绿，exit 0）

| 门 | 命令（仓根） | 结果 | 日志 |
|---|---|---|---|
| 类型门（src 面） | `mise exec -- bun run typecheck` | `tsc --noEmit` exit 0 | `log-08` |
| 类型门（V2 套件面） | `mise exec -- bun run typecheck:v2` | `tsc --noEmit -p tsconfig.v2.json` exit 0 | `log-08` |
| V2 neg 子套件 | `mise exec -- bun run test:v2 -- apps/daemon/test/v2/neg` | **4 文件/29 用例 passed**（含 ring 8） | `log-08` |
| 分层宪法门 | `mise exec -- bun run guard:boundaries` | PASS：扫描 900 文件（范围面代码件 758），**0 违例** | `log-08` |
| V0 文档门 | `mise exec -- bun run verify:docs` | **PASS：V0 六项 6/6**（真悬空 0） | `log-08` |

> 采集期间 HEAD 由 `a25324f` 先后前移到 `c9e8540`（并行 EMP 单，只动 emp 两文件）与 `eaf5932`（集成侧把本波 10 件扫入版本库，非本单提交），故在末轮 HEAD `eaf5932` 复跑一遍门禁并留 `log-09`；两轮均 exit 0。

---

## 七、未执行 7 行：逐行「缺什么」

### 7.1 NEG-RING-01（价值环·闭环六要素；V1＋V6·SCEN）
- 主表行：构造场景＝越界/无价值/不可验收/承诺不可持续仍沿原路径庆功；预期拒绝＝强制失败出口触发（04 §二/§六）。
- **缺什么**：①价值环六要素（01 §0.4：显式目标/可验收判据/执行与代价/结果与证据/后验校正/失败出口）的**无环场景 harness**；②「四类失败仍庆功」的时序注入点（受理→合同→执行→收割→验收→复盘的跨记录编排）；③强制失败出口断言件。仓内 `价值环｜六要素` 仅 2 处命中且均为 REC-WORK-COMMIT-CHANGE 的「申请段六要素」，与闭环六要素同名异义（`log-07`）；e2e 只有公司提交/serve 生命周期/crash，无价值环场景面。**写单记录负测会变成假测试（RING-01 是环级场景，不是单记录形状）**。

### 7.2 NEG-RING-03（能力环·缺能力处置五出口；V1＋V3）
- 主表行：构造场景＝缺能力/退化/成本失控仍接单；预期拒绝＝缩/换/外援/拒绝/停止五出口必答（02 §五）。
- **缺什么**：能力链现有 `records/cap.ts` 的声明/资格/回执/激活四类**形状与单记录判定**，缺「缺能力→五出口逐项必答」的**决策件**与执行面（谁在受理时判定缺能力、五出口如何落记录、退化/成本失控如何触发拒绝接单）。`log-07` 的「缩编/外援/缺能力」命中均为目录扩缩编，与本行无关——无被测决策函数，硬写断言即假测试。

### 7.3 NEG-RING-04（组织环·结构评价掩盖；V6·SCEN）
- 主表行：构造场景＝新增层级掩盖协调失败、整体透支不处置；预期拒绝＝R-22 语义判负；缩编或终止（03 §八）。
- **缺什么**：**场景编排**——OBJ-05 结构评价（判据五面＋组织绩效输入＋整体资源账）→组织变更事件（REC-LIFE-08 等）→反指标（新增层级掩盖协调失败/整体透支）的跨对象时序。现有 `records/eval.ts` 与 `rec-rev-eval.test.ts` 只到「单条 EVAL 记录形状＋单记录拒绝条件」，没有组织环的执行面与整体资源账输入（`log-07`：OBJ-05/REC-EVAL-01 命中均在 contract 记录面/单测，无场景编排器）。按主表验证级 V6·SCEN，缺场景即 `not-executed`。

### 7.4 NEG-ENG-01（ESM-only 预期失败形态；V3）
- 主表行：构造场景＝`require('@studio-next/…')`；预期＝预期失败形态实测（负测）。
- **缺什么**：可 `require` 的 **CJS 入口/dist 构建产物**。实测 `packages/*/dist`、`apps/*/dist` **0 个**；contract `package.json#exports` 只指 `./src/index.ts`（ESM，`type:module`）。13 §1.6 的 dist 切换集为空，切换 spike 属 MIG-01..08 波外单、未立（`log-07`）。没有 dist/CJS 面就没有「ESM-only 失败形态」可测——用 `node -e "require('@studio-next/contract')"` 只能测到「TS 源码不可 require」，不是主表要的 dist 切换负测，故不写。

### 7.5 NEG-ENG-02（YAML bomb 防线；V1）
- 主表行：构造场景＝别名/深度/规模超限包；预期＝上限负测拒收（13 §八-5）。
- **缺什么**：**上限实现**。`yaml` 解析器在（core/company/adapters 依赖），但全仓 `maxAliasCount` **0 命中**，`parseDocument/parse` 调用点无别名数/深度/规模上限选项，也没有对应的拒收码（`log-07`）。无防线可测时写「超限包→拒」必然是假测试（实现没拒，测试只能伪造期望）。

### 7.6 NEG-ENG-04（版本 fail-fast；V4）
- 主表行：构造场景＝Node 版本不符启动；预期＝入口拒绝启动（13 §八-2/3）。
- **缺什么**：**入口版本拒绝动作**。`process.versions.node` 全仓仅 3 处、全在 store 测试的环境记录（`snapshot-drill`/`readonly-open`），daemon/contract 入口无版本校验；`package.json#engines: node>=24` 是包管理器元数据，不产生启动拒绝（`log-07`）。没有拒绝动作就没有负测对象；伪造「版本不符」需先有实现，本波不改生产码，故 `not-executed`。

### 7.7 NEG-ENG-05（证据通道纪律；V0·纪律）
- 主表行：构造场景＝用 eval/stdin 形态当验证证据；预期拒绝＝拒；一律 `.ts` 文件或 `mise exec -- node` 等价重跑（13:99）。
- **缺什么**：**证据通道受理件**——能机械拒收 eval/stdin 形态、只认 `.ts` 文件或等价重跑命令的受理门/台账。仓内「证据通道」受理件 **0 命中**（`log-07` 的 `--input-type=module -e` 命中是 store 既有测试的 runner 用法，不是受理件）。本报告自身是**被审对象**，不能反过来给自己出「纪律已过」的结论（v2/17 V0·纪律行的本义），故 `not-executed`。

---

## 八、写面、变异与还原（可复核）

1. **新增面（仅 2 处）**：`apps/daemon/test/v2/neg/ring.test.ts`（356 行，<600 上限）＋`docs/probe/neg-ring-eng/**`（本报告＋`log-00..log-09`）。未改生产码、未改其它包/旧测试、未 `git add`/`git commit`。
2. **临时变异（验证用，已还原）**：
   - RING-02：`packages/gateway/src/catalog-entry.ts` 的「后代枚举缺项即拒」条件临时改不可达 → 红 2 用例 → 还原（`log-04`）；
   - RING-05：`packages/contract/src/records/chg.ts` 的「无验证生效为零」守卫临时改不可达 → 红 1 用例 → 还原（`log-05`）。
   - 还原复核：两文件 sha256 与变异前基线**逐字节同值**（`catalog-entry.ts`＝`64590a41…`；`chg.ts`＝`c44dfbda…`），`git diff` 为空；并行提交 `c9e8540` 不含这两文件（`log-06`／`log-00`）。
3. **HEAD 前移（两次，均非本单提交）**：开工 `a25324f` → 并行 EMP 单提交 `c9e8540`（只动 `records/emp-neg.ts` 与 `test/v2/neg-emp2.test.ts`）→ 集成侧提交 `eaf5932`（`test(v2): NEG-RING-02/05 场景+119 ID 对账报告`，把本波 10 件：`ring.test.ts`＋本报告＋`log-00/02/03/04/05/06/07/08` 扫入版本库）。本波与 EMP 单无交集；`eaf5932` 是集成侧动作、不是本单提交。`log-01`／`log-09` 在 `eaf5932` 之后落盘，交接时仍为未跟踪新增（若需入库由集成侧随下次提交带上）。
4. **计数免责**：本报告正文出现的 `NEG-*` 字符串会计入冻结命令的登记域（这是任务允许的报告面），但**状态列逐行自证**；不得以报告文字冒充执行证据。

---

## 九、附：日志清单（本目录）

| 文件 | 内容 |
|---|---|
| `log-00-environment.txt` | HEAD（开工/结束）、工具链、`git status`、测试文件行数、生产面 sha256 |
| `log-02-ring02-exec.txt` | `ring.test.ts -t "NEG-RING-02"` 实跑（4 passed / 4 skipped，EXIT=0） |
| `log-03-ring05-exec.txt` | `ring.test.ts -t "NEG-RING-05"` 实跑（4 passed / 4 skipped，EXIT=0） |
| `log-04-mutation-ring02.txt` | RING-02 去守卫 diff＋实跑红（2 failed，EXIT=1） |
| `log-05-mutation-ring05.txt` | RING-05 去守卫 diff＋实跑红（1 failed，EXIT=1） |
| `log-06-restore-reverify.txt` | 还原后 sha256、`git diff` 空、复跑 8 passed（EXIT=0） |
| `log-07-not-executed-gaps.txt` | 7 行「缺什么」的仓内 grep/目录实测证据 |
| `log-08-gates.txt` | 五道门禁首轮实跑（全 exit 0） |
| `log-09-gates-final.txt` | 末轮 HEAD `eaf5932` 复跑五道门禁（全 exit 0）＋冻结命令 119 复算 |
| `log-01-neg-count.txt` | 冻结命令落盘前 110／落盘后 119、9 ID 差集、executed=112 复算 |

*本报告为施工侧收口件，不宣布五环闭合、不宣布能力证明、不代制作人裁任何缺口；未执行 7 行按 v2/17 §一 V0–V6 口径维持 `not-executed`。*
