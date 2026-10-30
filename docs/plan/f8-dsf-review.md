# F8 · DSF 独立复查报告（DSF-REVIEW-01）

> 日期：2026-10-30｜复查人：**DSF 侧（DeepSeek Flash）**｜性质：**DSF 独立复查结论**——不是 F8 签认、不是 P0 清零宣布、不是 V2 定稿令
> 复查对象：[f8-package.md](f8-package.md)（F8/P0/DSF 完整验收包 v1）、[f8-signoff.md](f8-signoff.md)、[mig08-closeout.md](mig08-closeout.md)
> 判定基准：`docs/v2/17-验证矩阵与追溯.md` §六.1-2（宣布权）／§六.2（P0 清零判定表·核验列）／§七（F1-F8）／§4.5（GAP）／§四（NEG）；`docs/plan/04-测试与验收策略.md` §1.9.4（V2 套件九条阈值）、§1.8.6（旧测试存废门）
> 执行环境：macOS arm64｜node **v24.21.0**（`mise exec --` 锁定，.mise.toml:4）｜bun **1.4.3**｜仓根 `<repo>`
> 证据基线：**commit `8ca3005972b544a87f0da39c8516d2f64f7ac3a5`**（复查开始钉定）；复查期间工作树由并行会话继续改动（`packages/store/test/v2/writer-lease-cli.test.ts`、`docs/probe/pb-5/report.md` 为未提交修改）
> 边界：①**不动 v2 卷任何文字**（§六.2 核验列本体不代填，逐行结论以本件呈报，写入须制作人授权）；②**不改施工侧呈报件**；③不裁旧测试存废（判定权归制作人）；④只对「可机械复算项」下硬结论，对「需裁决项」只登记。

---

## 〇、一页结论（DSF 判定）

**判定：F8 本次不予通过（不可签）。**

三条硬阻断，两条硬伤，均非文风问题，逐条可复算：

| # | 阻断项 | 事实（本机实测） | 后果 |
|---|---|---|---|
| **B1** | **冻门在现基线不可复算** | `verify:v2` 在 `8ca3005` 连续 2 次 **exit 1**：105 files / 1567 tests，**1–2 failed、5 skipped**；失败均为超时族（`verify-docs` beforeAll 10s hook 超时；`writer-lease-cli` 持锁子进程超时）。类型门/边界门在链上均通过 | 验收包的核心证据「连续 3 次 exit 0」不可复算；且 F8 件**未钉 commit**，HEAD 前移即失效 |
| **B2** | **P0 施工列有 3 行理由已被现树证伪** | GLM K4 / GLM K7 / DSF P0-6 的残余理由写「NEG-WRK-07 / NEG-WRK-14 / NEG-EVD-02/03/04/06 未覆盖」，而这些 NEG **现均已有可执行测试**（`apps/daemon/test/v2/neg/work-gates.test.ts:246`、`harvest-neg.test.ts:308/358`）；K4 的载体 `REC-WORK-ACCEPT-MAINT` 已是**冻结记录类**（`packages/contract/artifacts/records/work.schema.json`） | 27 行表是 P0 清零的判定底表，其中 3 行状态不可采信；另 5 行理由/证据须换（K6/P0-5/P0-12 理由过期，P0-1/P0-10 证据不对位或过期）；P0-9 的层级问题见 B3。**施工列须重算** |
| **B3** | **NEG「119/119 executed-pass」超出证据层级** | 冻结命令实测确为 **119**，且 119 条 ID 与 v2/17 §四声明集**同集合**（0 幻影/0 缺号）；但 **20 行声明验证级含 V4/V5/V6**：其中 8 行声明 V5（崩溃注入），而 crash 套件仅 2 文件/16 tests、9 个 kill 点，**套件内仅出现 1 个 NEG-ID 且为「邻接面」**；6 个 ID 被测试自标「**前腿**」（NEG-RUN-01/SEC-08/MON-01/MON-03/REC-05/MIG-02）；RING-01/02/04 施工方探针自述「未接全链编排器/执行面」 | 「executed-pass」只能按**判定件层**成立；按声明验证级的「全行通过」不成立。不得以 119 读作 F8 的行为面覆盖 |

| # | 硬伤（不改不阻断计数，但破坏可审计性） |
|---|---|
| **D1** | 同一验收件内自相矛盾：f8-package §一 记「已实现 112 executed；7 not-executed」（:12），§四 记「119/119 executed-pass；not-executed 0」（:40） |
| **D2** | 两件硬数字互斥：f8-package「**103** files / 1561 tests」（:19）vs f8-signoff「**104** files / 1561 tests」（:10）；`git ls-tree 213b10c` 实测 test/v2 下 `.test.ts` **104 件** → 103 为笔误 |

**正面的部分必须同样记明**（不因上列阻断而抹去）：GAP 18 条计数、P0 27 行计数、旧测试 209/13/20、§二 的 crash(16)/api(22)/ops+control(31)、F5 端口 6/6、文档 6/6、秘密扫描新 0、7 包类型门 7/7 —— **本机独立复算全部与声称一致**，逐条见 §一。施工侧的诚实度是可核的：`GAP-V2-18`、`O3-04`、`PB-3/PB-5 未通过` 均为如实登记，未发现伪造证据。

---

## 一、可复算项逐门复算（本机 2026-10-30 实跑）

命令一律带 `mise exec --`（v2/13 §0.2），与施工侧同口径。

| # | 门 | 声称 | 本机实测 | 判定 |
|---|---|---|---|---|
| 1 | 全 V2 `verify:v2` | 103 files / 1561 tests，**连续 3 次 exit 0**（114s/168s/100s） | 第 1 跑：105 files / 1567 tests，**1 failed / 1561 passed / 5 skipped，exit 1**；第 2 跑（JSON）：**2 failed / 1560 passed / 5 skipped，3 套件红，exit 1**。链上 `guard`＋`typecheck`＋`typecheck:v2` 通过（链在 `test:v2` 处断） | **不成立（B1）** |
| 1a | 其中 `writer-lease-cli.test.ts` | — | 单文件独跑 **6/6 绿，但耗时 105.95s**（单测 7.7–30.8s）；全跑时因持锁子进程超时而红 | 结论：**负载脆弱**，非逻辑错 |
| 1b | 其中 `verify-docs.test.ts` | — | 第 2 跑 `Hook timed out in 10000ms`，其 **5 个用例全 skip** | 钩子超时未随 `testTimeout:60s` 放宽 → 结构性脆弱 |
| 2 | `verify:docs` | PASS 6/6，真悬空 0 | **PASS 6/6**：29 件（v2 18 卷＋plan 11 卷）、引用 2751 处、真悬空 0、VEC 8/8 | **成立** |
| 3 | `guard:boundaries` | PASS，**900 文件**，0 违例 | **PASS：929 文件**（范围面 772），0 违例 | 成立；**文件数 900→929 已漂移**（D3） |
| 4 | 秘密扫描 | exit 0，新命中 0，基线 20 | **exit 0，新 0／基线 20 显式登记** | **成立** |
| 5 | 7 包源码类型门 | 7/7 exit 0 | **7/7 exit 0**（gateway/core/adapters/yt/taiga/localplatform/matrix 逐一实跑） | **成立** |
| 6 | F5 端口映射 | PASS 6/6（13 PORT ↔ 20 文件） | **PASS 6/6**，0 缺失/0 多余/0 冲突 | **成立** |
| 7 | crash 套件 | 2 files / 16 tests，CRASH_POINTS=9 | **2 files / 16 tests**（16 passed）；`CRASH_POINTS.length=9` | **成立** |
| 8 | API 第 5 出口 | 2 files / 22 tests | **2 files / 22 tests**（22 passed） | **成立** |
| 9 | OPS 补形 | 4 files / 31 tests | **4 files / 31 tests**（ops 3 files/16 tests ＋ control 1 file/15 tests） | **成立** |
| 10 | `contract:check` | 施工侧**未跑**（GLM K9 行明示「不冒充」） | 本机补跑：**PASS**（14 件工件、记录类 74/74、AREA 13/13、零漂移、id 关键字 0） | 补足施工侧缺口 |
| 11 | CJS 拒绝面 | 15 包／19 条 exports | 实测 **15 个 `require-reject.cjs`**；`exports.require` 条目 **13 根＋panel 4＋studio-tools 2＝19**；v2/13 §1.6-6 已登记边界（绕过 exports 不承诺） | **成立** |
| 12 | 旧测试台账 | 209 件；13 红文件/20 红用例；7/7 | `old-test-ledger.mjs` **PASS 7/7**；仓内旧 `.test.ts` 实测 **209**；绿 196/红 13；红用例 20 逐条有归属 | **成立** |

**复算小结**：8 门中 **7 门逐字成立**、1 门（`verify:v2`）**不成立**；另有 1 项（`contract:check`）施工侧空缺，本机补跑通过。子套件计数（crash/api/ops/neg）无一虚报。

> 关于 B1 的定性（不含推测）：两次失败均落在**超时类**，单文件独跑全绿，故**不判为功能缺陷**；但按 v2/17 §1.3「不能互替的绿色」与 plan/04 §1.9.4-3「不许靠重跑刷绿」，**红就是红**，不能以「本机负载高」为由改判绿。F8 所需的「连续 3 次 exit 0」在本基线**未取到**。
>
> 公平性说明：施工侧采集证据的时点早于本次基线（`8ca3005` 在 `213b10c` 之后新增 `writer-lease-cli.test.ts`，并改 `cli/*`＋`store/rebuild|drill`）。**但验收件未钉 SHA**，制作人签认指向的是「当前证据」，因此复查只能以现树为准——这正是 D6 要求补 commit 锚的原因。若施工侧在旧提交上重跑并钉 SHA，B1 可按新锚点重新判定。

---

## 二、P0 27 行 · DSF 核验列（逐行结论，可直接回填 v2/17 §六.2）

口径：`过`＝施工侧状态与理由均可采信；`有条件过`＝状态成立但理由/证据须更新；`不过`＝理由已被现树证伪，须重判；`元阻塞`＝本条判定依赖核验列本身。

| 根因 | 施工侧 | **DSF 核验** | 依据 / 采信理由 |
|---|---|---|---|
| GLM K1 | closed | **过** | `REC-ACC-01/02` 形状＋NEG-REC-06 在 cases.json（V1 契约 case，层级相符） |
| GLM K2 | closed | **过** | REC-LIFE 形状＋v14 DDL＋NEG-REC-02（cases.json） |
| GLM K3 | closed | **过** | REC-PERF/EVAL＋NEG-REC-03/09（cases.json） |
| GLM K4 | open | **不过** | 理由「未见 NEG-WRK-07 落位」被证伪：`work-gates.test.ts:246` 有具名 describe，调用生产函数 `validateMaintenanceAcceptance`，记录类 `REC-WORK-ACCEPT-MAINT` 已冻结 → **「无载体」不再成立，须重判** |
| GLM K5 | closed | **过** | `port-map-rescan` 本机 PASS 6/6（13↔20，0 冲突） |
| GLM K6 | partial | **有条件过** | NEG-ORG-15 在；但理由中「NEG-EVD-02/03 未覆盖」已过期（`harvest-neg.test.ts:220` 起）。实质残余（外部锚 GAP-V2-03）仍成立 → 改理由后可过 |
| GLM K7 | open | **不过** | 理由「NEG-WRK-14 未覆盖」被证伪：`harvest-neg.test.ts:358` 具名 describe。**「观察面活性无施工证据」不成立** |
| GLM K8 | closed | **过** | `verify:docs` 检查⑥ VEC 10 条、正 8/8、负 2/2 |
| GLM K9 | closed | **过** | 施工侧留白项（未跑 `contract:check`）本机补跑 **PASS**，零漂移 → 无障碍 |
| GLM K10 | closed | **过** | `v0-doc-check` 6/6 exit 0 |
| GLM K11 | closed | **过** | 检查③ 真待修 0（C1-C7 全分类） |
| DSF P0-1 | closed | **有条件过** | 规范面锚（v2/05 §三 DOM-01..07）实存；但施工侧证据（engine.ts 1988 行／api 端点 16／guard PASS）与根因「同一对象四层两套现行」**不对位**——行数下降不证明单一权威。须换为分域权威表的实现对位证据 |
| DSF P0-2 | closed（限域） | **过** | 重建限域实现可采信；对账规则本体＝GAP-V2-01 仍 open（DEC-OPEN-14 待裁，v2/09:440 实测仍「待裁」）——与行内「限域实现」声明一致，不算漏报 |
| DSF P0-3 | closed | **过** | 结构负例 NEG-ORG-06/07 在 `org-structure.test.ts` |
| DSF P0-4 | partial | **过** | 状态判对：规范面本身即「部分解」，施工侧 partial 与之一致（外部 root 交接证明待 49·R1）；内部腿 `root-delegation.ts`＋NEG-ORG-09..12 在 |
| DSF P0-5 | partial | **有条件过** | 审计矩阵落卷；但理由「NEG-EVD-02/03 未覆盖」过期。实质残余（公司层外部锚）=GAP-V2-03 → 改理由后可过 |
| DSF P0-6 | partial | **不过** | 理由「NEG-EVD-02/03/04/06 未覆盖」**四条全部过期**（均在 `harvest-neg.test.ts`）；残余面须重新论证，不许沿用旧文 |
| DSF P0-7 | closed | **过** | 规范面关闭（01 §六硬核/软外围）；无代码面需求，属规范病 |
| DSF P0-8 | closed | **过** | `contract:check` 74/74 记录类、AREA 13/13；NEG-REC 12/12 在 cases.json |
| DSF P0-9 | closed | **有条件过** | FC-01..05 机制在；但 NEG-SEC-03 的 V5 声明（崩溃注入）与其实测层级（SQLite 触发器）不符（见 §三）→ 补层级说明后可过 |
| DSF P0-10 | partial | **有条件过** | **证据文本已过期**：现 `exits.ts` 为 **4 wired＋1 gap**（platform-write/notify/log-egress/api-response wired；evidence-export `no-export-channel` 仍 gap），而表中仍写「2 个出口无生产通道」。状态 partial 仍成立，理由须改 |
| DSF P0-11 | closed（施工侧） | **元阻塞** | 本条根因即「现行效力与过审门禁不可判定」，解法是**核验列填满且全过**。现列 0/27 填（实测 v2/17 §六.2 DSF 列为空 27/27），且本次复查给出 3 行「不过」→ **不得标 closed**；须待整改后回填 |
| DSF P0-12 | partial | **有条件过** | 理由「NEG-RUN-03 未覆盖」过期（`run-revocation.test.ts:162/189/213/244`）。实质残余（网关强制＝目标）仍成立 |
| O3-01 | closed | **过** | 纯投影下沉＋只读兼容；NEG-ORG-06/07 在 |
| O3-02 | closed（限域） | **过** | 同 P0-2；对账规则 open 已在行内声明 |
| O3-03 | closed | **过** | 03 表 D／05 表 C＋NEG-ORG-13/14/15 |
| O3-04 | partial | **过** | 理由经本机复核**成立**：`redaction-failed`/`notify-blocked`/`env-print-blocked` 在 `packages/contract` 内 **0 命中**，仅 daemon 使用 → 「失败事件名未入冻结词表」为真 |

**计数（DSF 侧）**：过 **17**｜有条件过 **6**（K6/P0-1/P0-5/P0-9/P0-10/P0-12，皆须换理由或换证据）｜**不过 3**（K4/K7/P0-6）｜元阻塞 **1**（P0-11）＝ 27。
→ **不满足 v2/17 §六.1-2「填满且全『过』＝F8 达成的登记要件」**：现有 3 行不过、6 行须改。

---

## 三、NEG 119 复核（计数通过，层级未达）

### 3.1 计数：通过（三项机械核验全中）

| 核验 | 方法 | 结果 |
|---|---|---|
| 冻结命令 | `grep -rhoE 'NEG-[A-Z]+-[0-9]+' packages/contract/cases.json apps packages scripts docs/probe \| sort -u \| wc -l` | **119** |
| 声明集一致 | v2/17 §四表行抽取 vs 冻结集 `comm` | **同集合，0 差异**（13+15+14+5+5+6+3+12+9+10+10+2+8+2+5＝119） |
| 非注释充数 | 逐行判定 64 个测试文件中的 ID 行是否为注释行 | 测试内 **109** 个 ID **全部落在代码行**，注释-only **0**；`skip/todo/fails` **0** |
| 剩余 10 条 | NEG-SCH-01..10 | 落在 `packages/contract/cases.json`（真契约 case，带 title/input/expected）→ **不是文档充数** |

**结论**：施工侧「119/119 IDs accounted」**成立**；且此前自认过的「注释充数」问题**确已修复**（本次独立复验）。

### 3.2 层级：未达（20 行声明 V4/V5/V6）

v2/17 §四的「验证级」是判据，不是装饰。按声明级逐层对照：

| 观察 | 数字 | 说明 |
|---|---|---|
| 声明 V4/V5/V6 的行 | **20 / 119** | 见下表明细 |
| 声明 **V5**（崩溃注入）的行 | **8** | RUN-01/04、EVD-05、SEC-01/03/04、MIG-01/02 |
| crash 套件容量 | **2 files / 16 tests / 9 kill 点** | 套件内出现的 NEG-ID 仅 **NEG-MIG-01** 一处，且为「邻接面」注记 |
| 测试**自标「前腿」** 的 ID | **6** | RUN-01、SEC-08、MON-01、MON-03、REC-05、MIG-02 |
| 施工方探针自述残余 | **RING-01/02/04** | 「纯判定件未接全链编排器/执行面」「未接 V6 编排器」——即声明的 V6·SCEN/V4 未取到 |
| 证据形态 | 多为纯函数/记录校验 | 例：NEG-SEC-03 声明 V5，实测为 SQLite 触发器测试；NEG-MIG-01/02 同 |

**判定**：`119/119 IDs accounted` 可采信；**`119/119 executed-pass` 不可采信为「按声明验证级全行通过」**，应改记为「119 条均有可执行件，其中 N 条为判定件层/前腿，声明级未达」。这是**层级问题，不是造假问题**——施工侧探针报告已自留残余，但验收包把它压缩成了单一数字。

### 3.3 另需登记的两处措辞

1. f8-package §四 末句「不得读作 119 executed」与其首句「119/119 IDs executed-pass」在同一节内互卡（D1 的同族问题）。
2. `NEG-ENG-01` 的通过面是 **exports 条件拒绝**（v2/13 §1.6-6 已登记「绕过 exports 的绝对/相对路径不承诺」）——**有条件成立**，须在 F8 件里带这半句边界，不能只写「已收口」。

---

## 四、GAP-V2-01..18 复核（计数通过；抽验一致，1 处须持续盯）

- 计数逐条复核：**closed 5（08/09/12/15/16）｜open 4（01/05/13/18）｜target-not-proven 9（02/03/04/06/07/10/11/14/17）**，与 f8-package §五 **完全一致**。
- 逐条抽验（本机）：
  - **GAP-V2-13**：ENU-88 在 `docs/v2/09:246` 仍标「待定稿」→ open **成立**。
  - **GAP-V2-18**：`gen-template.ts`／`level-specs.ts` 仍在且由 `src/index.ts:87-88` 导出；台账 §八 登记 7 红（断言类，非超时）→ open **成立**。生成器未重写、未退役，再生成仍会覆盖 v2 模板，**这条是真实未闭项**。
  - **GAP-V2-01**：`DEC-OPEN-14` 在 `docs/v2/09:440` 仍「待裁」→ open **成立**。
  - **GAP-V2-05**：触发器腿在（`events-trigger.test.ts`），I-17 哈希链自述未建 → open **成立**（口径已写明是「触发器腿已闭」）。
- **须盯**：GAP-V2-11 的处置证据现在依赖 `docs/probe/pb-3`/`pb-5`，而这两批**均为未通过**（§五），故 GAP-V2-11 不得因「已有报告」而向 closed 移动——当前仍 target-not-proven，正确。

---

## 五、PB-3 / PB-5 复核（未通过，与报告一致）

| 批 | 施工侧 | **DSF 核验** | 依据 |
|---|---|---|---|
| PB-3 | 未通过 | **一致（不通过）** | 入口要件缺 PB-2/PRB-08（`docs/probe/pb-2/` 不存在；`compile-projection.ts:30` 自述通道未建）；PRB-17 仅负向；18/19/20/21 not-executed。HCL-2 双差分未做 → 不得称任何替换级闭合 |
| PB-5 | 未通过 | **一致（不通过）** | PRB-23 not-executed（消费方观察缺口写口缺位）→ 平台读侧契约不成立；PRB-13 not-executed；PRB-14 仅负向。WriterLease 已落（附录 B/B.6）但**施工方自己拒绝改判主表**，该拒绝是正确处置 |

**一处过期声明（D4）**：f8-signoff §二 写「PB-5 未通过（PRB-23/PRB-13 not-executed；**WriterLease 仅 runServe**）」——现 HEAD 的附录 B.6 已把围栏扩到 CLI 写命令（`gray`/`cutover`/`postmortem`/`company`/`jobs`/`sandbox`/`rebuild`/`drill`），「仅 runServe」已不成立。结论（PB-5 未过）不变，理由须更新。

---

## 六、旧测试存废面（只核数，不裁）

- 台账 `old-test-ledger.mjs` **PASS 7/7**；209 件全覆盖、红 13/绿 196、红用例 20 逐条有归属、口径差 1 行（`scripts/guards/boundaries.test.mjs`）登记在案。
- 台账 §二（`gen-template.test.ts` 绿 18/0，2026-10-28 16:28 实测）与 §八（MIG-05 复跑后 红 7）**不是矛盾**：前者是冻结主表，后者是「触及面复跑补充登记」且明写「不参与 209/13/20 计数」——此设计合规，**不记缺陷**。
- 存废三清单未出，判定权在制作人/DSF 会审——本次**不裁**，但提示：`gen-template` 7 红与 GAP-V2-18 同源，**应先定 GAP-V2-18 处置再判其存废**，否则两处会互相等。

---

## 七、交叉一致性缺陷清单（逐条带锚点，供施工侧一次改净）

| # | 缺陷 | 锚点 | 修法 |
|---|---|---|---|
| D1 | §一「112 executed / 7 not-executed」与 §四「119/119、not-executed 0」并存 | `f8-package.md:12` vs `:40` | §一 改为「决定时点状态（112/7）→ 终态见 §四」或直接写终态 |
| D2 | 文件数 103 vs 104；实测 213b10c 为 104、现 HEAD 为 **105** | `f8-package.md:19`、`f8-signoff.md:10` | 统一并**附 commit SHA** |
| D3 | 边界扫描 900 → 现 929；验收件写死旧值 | `f8-package.md:21` | 改为「≥900 或当日实测值＋日期」 |
| D4 | PB-5「WriterLease 仅 runServe」已过期 | `f8-signoff.md:25`（`mig08-closeout.md:504` 为同一状态行，无该措辞） | 改「runServe＋CLI 写命令；读面未迁」 |
| D5 | P0 表 **8 行须改**：证伪 3（K4/K7/P0-6）＋理由过期 3（K6/P0-5/P0-12）＋证据过期或不对位 2（P0-1/P0-10） | `mig08-closeout.md:106,109,118,119,123,125` | 按 §二 重写「施工侧证据（含缺口）」列 |
| D6 | 验收件**无 commit 锚**：`verify:v2` 记录值无法定位到树 | `f8-package.md` 全文、`f8-signoff.md` 全文 | 头注加基线 SHA＋工作树状态；探针报告已有此做法（pb-3/pb-5 均钉 HEAD），验收件应同规 |
| D7 | `verify-docs.test.ts` 的 `beforeAll`（:78，子进程跑 `v0-doc-check.mjs`）沿用 vitest 默认 10s 钩子上限，未随 `testTimeout:60s` 放宽 | `packages/contract/test/v2/verify-docs.test.ts:78` | 钩子显式设 `hookTimeout: 60_000`（或把文档检查移出钩子） |
| D8 | `writer-lease-cli.test.ts` 单测 7.7–30.8s（整文件 106s），持锁子进程超时窗过紧 | `packages/store/test/v2/writer-lease-cli.test.ts:150-160` | 放宽持锁子进程等待窗＋失败时非零退出与 EPIPE 分开判；或将其移入串行分组 |
| D9 | §四末句与首句互卡（「不得读作 119 executed」vs「119/119 executed-pass」） | `f8-package.md:40,42` | 统一为「119 accounted；层级见附表」 |

---

## 八、F8 结论与放行条件

### 8.1 结论

- **F8：不予通过**。依 v2/17 §六.1-2，F8 达成要件＝核验列填满且**全「过」**；本次复查给出 **3 行不过＋6 行有条件过**，且 `verify:v2` 在现基线不可复算。**制作人 2026-10-29 的签认事实成立**（`f8-signoff.md` 如实写明「不代填 DSF 列」），但按 F8 自身定义，**DSF 列未填即 F8 未完成**——不因签认而变成已过。
- **P0 清零：不可宣布**。27 行施工列需按 §二 重算；`P0-11`（元阻塞）在核验列填满前保持未解。
- **V2 版本轴：维持 `draft`**（`docs/v2` 18 卷实测状态词均为 `draft`，无卷标 `final`／已定稿——正文中的「定稿」字样只出现在「未过 DSF 复查不得标定稿」的禁令句中）。

### 8.2 最小放行集（五项，缺一不可）

| # | 条件 | 验收方式 |
|---|---|---|
| C1 | 在**钉死的 commit** 上 `verify:v2` 连续 3 次 exit 0 | 每次留存完整输出＋`git rev-parse HEAD`；0 skip/0 only/0 retry |
| C2 | P0 27 行施工列按现树重写：K4/K7/P0-6 重判；K6/P0-5/P0-12 换理由；P0-1/P0-10 换证据；P0-9 补层级说明 | 重交 §六.2 表，DSF 逐行复核；K4 须回应 `REC-WORK-ACCEPT-MAINT` 载体是否即「载体」 |
| C3 | NEG 表增「证据层级」列，或把 20 行 V4/V5/V6 声明逐行降级/补证 | 8 行 V5 须给出 kill 点证据或改判层级；6 行「前腿」须改判 |
| C4 | 验收件补 commit 锚＋统一 D1/D2/D3/D4 数字 | 逐条对照 §七 |
| C5 | 核验列正式回填 v2/17 §六.2 | 本件 §二 可直接转写，需制作人授权后由 DSF 落笔 |

### 8.3 不作判定的事项（超出本次授权）

1. 旧测试存废三清单（制作人裁）。
2. GAP-V2-01/05/13/18 是否允许以 open 进入 V2（制作人裁）。
3. PB-3/PB-5 未过是否阻断 F8（制作人裁）——DSF 侧意见：**按 v2/17 §五，PRB-23 未过不得宣称平台读侧契约成立**；它不阻断 F8 的「文档门」，但必须在 F8 件里以「目标（未证）」显式登记，不得在对外件里消隐。

---

## 九、签署

| 角色 | 结论 | 签名/日期 |
|---|---|---|
| DSF 侧（DeepSeek Flash） | **复查完成；F8 本次不予通过**；3 行不过、6 行有条件过、17 行过；B1/B2/B3 三条硬阻断待整改 | DSF-REVIEW-01｜2026-10-30 |
| 制作人 | 待阅：是否授权将 §二 逐行回填 v2/17 §六.2、是否接受 §8.2 五项放行条件 | |
| 施工侧 | 待整改：§七 D1-D9＋§8.2 C1-C4 | |

---

*本件为 DSF 独立复查记录，不修改任何 v2 卷、不修改施工侧呈报件、不宣称 P0 清零、不宣称 V2 定稿。与 v2/17 冲突时以 v2/17 为准（停手改卷，走批示流）。*
