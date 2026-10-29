# MIG-08 收口报告 · 缺口表终版＋P0 施工列回写（IMPL-08-04）

> 版本：**v1**｜2026-10-29｜编写：MIG-08 施工代理（DeepSeek-V41-Flash，LANE-T）｜单号：`docs/plan/05` IMPL-08-04（MIG-08 收口步）
> 性质：**缺口表终版（施工侧）＋P0 清零判定表施工列回写＋NEG 覆盖终值**。本件是施工侧呈报件，**不是 P0 清零宣布、不是 F8、不是 V2 定稿**。
> 依据：`docs/v2/17-验证矩阵与追溯.md` §4.5（GAP-V2-01..18）/§六.1（版本效力）/§六.2（P0 清零判定表）/§七（F1-F8）/§五（PB 批次）；`docs/plan/03` §九（MIG-08 波门）；`docs/plan/04` §二（MIG-08 行/冻结命令）、§三（NEG-119 分配与冻结覆盖命令）、§1.8.6（旧测试存废门）；`docs/plan/05` IMPL-08-01..04；`docs/49` 2026-10-28 开工令 §3/§4/§10 与四项施工期制作人裁（MIG-03 裁 A、MIG-05、MIG-06 NEG 后移、包级 typecheck 源码-only）。
> 执行环境：macOS/Darwin 25.3.0 arm64｜node **v24.21.0**｜bun **1.4.3**｜mise 2026.10.11｜仓根 `<repo>`；全部证据命令带 `mise exec --` 前缀（v2/13 §0.2）。
> 边界（硬约束，逐条遵守）：①**本件是本次唯一新增文件**——未改 `docs/v2` 任何卷、未改 `docs/plan` 其它卷、未改代码/测试/脚本；②未 `git add`、未 `git commit`；③**不代填** v2/17 §六.2「DSF 复查核验」列（空待填）；④**不写「NEG 119 已覆盖」**（实测 76/119，见 §四）；⑤不写「V2 定稿」「F8 已签认」「P0 已清零」。

---

## 〇、一页结论（诚实版）

| 项 | 施工侧结论 | 数字/证据 |
|---|---|---|
| MIG-01..08 波门 | 施工侧可交收口件；**遗留项如实登记**（§十）；不宣布 P0 清零 | `verify:v2` 连续 3 次 exit 0（§七） |
| GAP-V2-01..18 | **closed 5／open 4／target-not-proven 9**（共 18 条） | §二；逐条证据与缺口 |
| P0 清零判定表 | **closed 18／partial 7／open 2**（27 行；施工列本件回写） | §三；DSF 核验列仍空 |
| NEG 覆盖终值 | **76/119（冻结命令实测）**；缺 43 条，按族列出；**不得写 119 已覆盖** | §四 |
| MIG-07 波门 | 12/12 单落位；包级源码 typecheck **7/7 exit 0**；secret 扫描 **新 0**；`verify:v2` 记录 **1225 tests**（本报告复算当前 1254＝1225＋29） | §五 |
| MIG-06 装配欠账 | API 装配未接线（**API 响应=第 5 出口 gap**）＋**OPS `appendRecord` 未接**＋prompt `redactKnown` **已接线**（07-11 腿闭）；06-10/11 有消费侧缺口 | §六 |
| F8 / 定稿 | **F8 未签认；V2 不标定稿**（v2.1-draft） | §八 |
| 旧测试 | 台账 209＋口径差 1 行；13 红文件/20 红用例（审计基线 37）；退役清单入口列 §九；**存废判定不归施工方** | §九 |

**一句话**：施工侧证据已落盘、可复算；**P0 清零的宣布权、旧测试存废判定、F8 签认均不归本报告**——本报告只交施工列与未决项。

---

## 一、口径与复算入口

### 1.1 三态定义（本件施工侧用词）

| 状态 | 含义（与 v2/17 §六.1-3 同向） |
|---|---|
| `closed` | 施工侧关闭条件已满足，且有落盘证据可机械/逐条复核（不表示 DSF/F8 签字） |
| `open` | 关闭条件未满足且**仍在我方施工范围**（未裁规则、未重写件、未执行项） |
| `target-not-proven` | 机制/程序仍为**目标态**，本波未建或只落代偿；证据面登记「目标（未证）」 |
| （P0 表附加）`partial` | 部分腿关闭、残余腿已登记（残余明确指向 §十 未决项） |

### 1.2 复算命令一览（全部本机实跑，2026-10-29）

```bash
# ① 全 V2 门（MIG-08 出口门禁；连续 3 次，见 §七）
mise exec -- bun run verify:v2
# ② V0 文档自检（MIG-08-02 落位件；plan/03/04 写作 v0-selfcheck.mjs，见 §十-16 口径差）
mise exec -- bun run verify:docs          # = node scripts/verify/v0-doc-check.mjs
# ③ F5 端口-文件映射机械复扫（MIG-08-03）
mise exec -- node scripts/verify/port-map-rescan.mjs
# ④ NEG 覆盖（plan/04 §三 冻结命令，逐字照录）
grep -rhoE 'NEG-[A-Z]+-[0-9]+' packages/contract/cases.json apps packages scripts docs/probe 2>/dev/null | sort -u | wc -l
# ⑤ MIG-07 包级源码类型门（docs/49 裁「源码-only」）
for p in gateway core adapters yt taiga localplatform matrix; do (cd packages/$p && mise exec -- bun run typecheck) || exit 1; done
# ⑥ 仓面秘密扫描（MIG-07-11 落位件）
mise exec -- node scripts/scan-repo-secrets.mjs
# ⑦ 旧测试台账机械校验（随 verify:v2 串接，亦单跑）
mise exec -- node scripts/verify/old-test-ledger.mjs
# ⑧ crash 冻结点复算
mise exec -- node --input-type=module -e "import{CRASH_POINTS}from'./apps/daemon/src/engine/crash-points.ts';console.log(CRASH_POINTS.length)"
```

**实跑结果摘要**（逐条原始输出见 §十一）：①exit 0 ×3（每轮 81 文件/1254 用例）；②`v0-doc-check PASS：V0 六项 6/6` exit 0（落盘后复跑含本件：18 卷＋plan 9 卷、真悬空 0）；③`PASS 6/6（13 PORT ↔ 20 文件；0 缺失/0 多余/0 冲突）` exit 0；④**76**；⑤7/7 exit 0；⑥`结论：通过（无新增命中）` exit 0（新 0／基线 20）；⑦`7/7` exit 0；⑧**9**。

---

## 二、GAP-V2-01..18 施工侧状态（缺口表终版）

> 口径：关闭条件一律引 `docs/v2/17` §4.5 原文摘要；「施工侧状态」只判施工面，不代替制作人裁决/DSF 复查。状态计数：**closed 5（08/09/12/15/16）｜open 4（01/05/13/18）｜target-not-proven 9（02/03/04/06/07/10/11/14/17）**。

| GAP | 关闭条件（v2/17 §4.5 摘要） | 施工侧状态 | 施工侧证据（落盘可查） | 缺口 / 未决（如实） |
|---|---|---|---|---|
| **GAP-V2-01**｜cost_daily 对账规则未决 | 制作人对账规则裁决落 05 | **open** | 机制代偿已落：`packages/store/src/rebuild.ts` 排除域段＋`backup.ts` 备份快照（sha256）；`test/v2/rebuild-exclusion.test.ts`、`backup.test.ts`；NEG-MIG-01/02 已覆盖（§四） | **规则本身未裁**（DEC-OPEN-14 仍待裁，plan/03 §十一）；本报告不代裁 |
| **GAP-V2-02**｜策略投影传输通道与验签交付通道未建（SEC-SIG-04） | 签名封套＋信任锚＋单调代次建成；PRB-08 executed | **target-not-proven** | 生成器腿已落：`packages/core/src/prm/compile-projection.ts`（九段/digest/unsupportedSegments；PRM-G1..G8 case 在 `packages/core/test/v2/prm.test.ts`）；信任锚 FC-03 已落（`packages/company/src/trust.ts`＋`test/v2/security-baseline.test.ts`） | 生成器件**自述**「验签已成立？否：SEC-SIG-04 通道未建，PRB-08 未执行」（compile-projection.ts:30-32）；`docs/probe/` 截至本件证据时点仅 pb-1（1 executed/6 not-executed） |
| **GAP-V2-03**｜公司层外部锚未建（董事会/外部审计/宪法程序） | 外部锚落宪（08＋公司层） | **target-not-proven** | 无代码面（本波不涉公司层章程资产） | 归 01/08＋制作人（计划/03 §十一：公司层治理不阻断框架波）；NEG-EVD-03 未覆盖（§四） |
| **GAP-V2-04**｜派生树登记网关＋执行器选择链未建 | 网关落位（MIG-06/07） | **target-not-proven** | 选择链**代偿校验**已落：`packages/adapters/src/bindcard/selection.ts`（:14 自述「真正的派生树登记网关未建：本件是代偿校验」）；NEG-RUN-05 已覆盖（`packages/adapters/test/v2/bindcard.test.ts`） | **派生树登记网关本体未建**；代偿只拦「经本解析器」的直连 |
| **GAP-V2-05**｜I-17 哈希链未建；events 无 no-update/no-delete 触发器 | 触发器（MIG-04）＋哈希链（后波） | **open**（触发器腿已闭，哈希链腿未建） | 触发器腿：`packages/store/src/records-migrations.ts`（v15 trg）＋`test/v2/events-trigger.test.ts`（9 用例）＋NEG-SEC-03 已覆盖 | 哈希链：`records-migrations.ts:74` 自述「哈希链或等价物承接不变量 I-17 仍属目标（未证）」 |
| **GAP-V2-06**｜任职网关闸门（非在岗态拒绝发起出工）目标态 | 闸门建成前以 REC-LIFE-02＋NEG-REC-02 审计断言代偿 | **target-not-proven** | 代偿已落：REC-LIFE-02 形状（`packages/contract/src/records/life.ts`）＋NEG-REC-02 已覆盖（`rec-life.test.ts`／`life-gates.test.ts`） | `grep 非在岗/in-service apps/daemon/src` 零命中；`packages/contract/src/ports/hr.ts:5` 自述「目标（未证）」——**闸门未建** |
| **GAP-V2-07**｜老板层缺席继承/代行程序未建（84b §六.R2） | 继承程序裁决落 01 | **target-not-proven** | 无施工面 | 归 01＋制作人；NEG-ORG-08 未覆盖（§四）；不私裁 |
| **GAP-V2-08**｜旧「多宰相协调」未决 | 已关闭（DEC-OPEN-05 承接，规则落 v2/03 §2.2/§3.4） | **closed** | v2/17 §4.5 已记关闭（2026-10-28）；NEG-ORG-13/14 已覆盖；N 参数正例面落 v2/17 §4.1 | 无（残余＝DEC-OPEN-05 已解，登记在 09 §5.3） |
| **GAP-V2-09**｜记录钩子与事务同句柄（PORT-HIST.append tx） | MIG-04/06 落地 | **closed** | `packages/store/src/hist.ts`：`begin/commit/abort`＋`append(record, tx?)`/`correct(...,tx?)`（:126-136）；`test/v2/hist-append.test.ts` §「显式 tx 句柄」（:240-262，abort 零落库／commit 原子回执）；`test/v2/hist-query.test.ts` | 无（残余：OPS 生产装配未接，属 §六-3，不属本 GAP） |
| **GAP-V2-10**｜13 卷未证项 14 条 | 各行证据形状落位（跨版本探针/48h 长跑/YAML bomb/ReDoS/EVCH-1b/CJS/spike/路径消费/上游核对/bun 兼容/input-type/README 口径） | **target-not-proven** | 部分落位：NEG-ENG-03（ReDoS）已覆盖；06-11 路径消费声明已落（`packages/dsh-bridge/src/index.ts` 头注＋`package.json#dsh.entry`） | 其余形状（跨版本探针/48h/YAML bomb 负测/CJS/spike/上游核对/bun 兼容/input-type/README）**未执行**；不写成「已落位」 |
| **GAP-V2-11**｜12 卷未证清单 15 项 | 随探针销账 | **target-not-proven** | PB-1 已执行（`docs/probe/pb-1/`：7 行中 1 executed＝PRB-05、6 not-executed、0 not-applicable） | 截至本件证据时点（2026-10-29 14:56）PB-2..6 **无落盘产物**（`docs/probe/` 仅 pb-1；PB-2 门需 MIG-07＋PRB-08）；15 项无销账证据。**注**：编写期间并行单 IMPL-08-05 已在 `docs/probe/pb-3/`、`pb-5/` 采集（非本件产物），其结论以该单报告为准——本件不预判、不引用 |
| **GAP-V2-12**｜09/17 互核未完成 | ①全库六项检查重跑②ID 族逐族对表③值集重述检查 | **closed** | v2/17 §二.8：三项均 2026-10-28 执行（悬空=0／重述=0／节号连续=0；ID 族对表见 §二.8-四） | 残余＝v2/90 未成卷前向引用 1 处（登记维持，非施工缺陷） |
| **GAP-V2-13**｜值集待登记（执行器值集/入口名集） | 09 登记后销 | **open** | 09 §二主表在卷；值集消费方已实现（四执行器/入口面） | **ENU-88（targetExecutor）正文仍标「待定稿」**（`docs/v2/09-技术细节-总纲与工程决策·主表总册.md:246`）——未登记即未销 |
| **GAP-V2-14**｜V3 跨实现互操作无第二实现 | 第二实现＋共同用例 | **target-not-proven** | 无第二实现（仓内单实现） | 归生态/后续；v2/17 §4.5 口径不变 |
| **GAP-V2-15**｜contract 新增端口类型文件落位与 F-ID 发放 | MIG-03 冻结工件发放 | **closed** | 端口落位 20 件（`ls packages/contract/src/ports` = 20）；`scripts/verify/port-map-rescan.mjs` **PASS 6/6**（13 PORT ↔ 20 文件；0 缺失/0 多余/0 冲突，2026-10-29 实测）；`packages/contract/test/v2/port-map-rescan.test.ts`（4 用例） | 无（F-ID 发放规则按 MIG-03 工件口径落位；未见发布动作，属登记口径） |
| **GAP-V2-16**｜裸字母残余与撞号族（待修 20 条） | 清偿后 F6 复扫=0 | **closed** | v2/17 §二.7 20/20 条已标注「✅已修」；§二.8-二 F6 真待修=0；`verify:docs` 检查③「真待修 0」 | 无 |
| **GAP-V2-17**｜N 一级单元在 SCH-ORG-01 无字段级承载 | MIG-05 入口前定形（字段方案或记录面方案；定形后登记 09 §二值集） | **target-not-proven**（部分定形） | 投影边界定形已落：`docs/baselines/split-plan-company.md` §六（`units.count`/`units[]`/`unitId`/`domain`/`headRef`/`vacancyState` 投影载形；16 处代码引用） | 该件明写「**部分定形（投影边界）**；不得写成『GAP-V2-17 已关闭』」；**SCH-ORG-01 字段与 units[] 值集未登记**（闭口条件未达） |
| **GAP-V2-18**｜模板生成器仍是 v1（gen-template/level-specs） | 重写为 v2 或退役；重写后逐字节等值；旧测试复绿或退役登记 | **open** | `packages/company/src/gen-template.ts`/`level-specs.ts` 仍在且由 `src/index.ts:88` 导出；旧测试 `packages/company/test/gen-template.test.ts` **7 红**（台账 §八登记，归本 GAP） | 生成器未重写、未退役；再生成仍会覆盖 MIG-05 迁移的 v2 模板——**收口时仍开放**，需重写/退役单 |

**GAP 表尾注**：
1. **closed 只表示施工侧关闭条件已满足**；GAP-V2-08/15/16 的关闭依据来自 v2/17 卷内登记与本机机械复扫，不改变 v2 卷任何文字。
2. **GAP-V2-13/17 属「规范登记未达」而非代码缺陷**：本报告按要求如实登记「目标（未证）」，不代裁字段/值集。
3. **GAP-V2-11/10 属探针面**：截至本件证据时点 `docs/probe/` 仅 PB-1，PB-2..6 未执行（并行单 IMPL-08-05 正在 `pb-3/`、`pb-5/` 采集，结论以其报告为准）；故不能把 §五 MIG-07 的 12/12 读成能力证明（v2/17 §1.3 不能互替表）。

---

## 三、P0 清零判定表 · 施工列（DSF 核验列仍空；宣布权归制作人）

> 表源＝`docs/v2/17` §六.2（27 行：GLM K1-K11＋DSF P0-1..12＋O3-01..04）。本件**只新增「施工侧状态/证据」两列**，「DSF 复查核验」列逐行**留空**（v2/17 §六.1-2：填满且全「过」＝F8 达成登记要件）。
> 状态计数：**closed 18｜partial 7｜open 2**。

| 根因 | 规范面状态（v2/17 原文） | 施工侧状态 | 施工侧证据（含缺口） | DSF 复查核验（待填） |
|---|---|---|---|---|
| GLM K1 问责/救济三层无载体 | 已解（规范面） | **closed** | REC-ACC-01/02 形状（contract `records/acc.ts`）＋NEG-REC-06 已覆盖（`rec-acc.test.ts`） | |
| GLM K2 任职六状态无状态机承载 | 已解（规范面；闸门=GAP-V2-06） | **closed** | REC-LIFE 族形状＋`v14-records` DDL＋NEG-REC-02 已覆盖（contract/daemon 双落点） | |
| GLM K3 绩效/结构评价无形状 | 已解（规范面） | **closed** | REC-PERF-01／REC-EVAL-01 形状＋NEG-REC-03/09 已覆盖 | |
| GLM K4 维持性验收无载体 | 已解（规范面） | **open** | 未见 NEG-WRK-07 落位（§四 WRK 缺项）；维持性验收 case 未接线 | |
| GLM K5 验证锚/文件落点双事实源 | 已解（F5） | **closed** | `port-map-rescan` **PASS 6/6** exit 0（13 PORT ↔ 20 文件；0 冲突）；contract 伴测 4 用例 | |
| GLM K6 元治理独立性逃生口 | 已解（规范面） | **partial** | NEG-ORG-15（自审自称独立）已覆盖；**NEG-EVD-02/03 未覆盖**（审计分离/外部锚面） | |
| GLM K7 迟到副作用观察悬空 | 已解（规范面） | **open** | NEG-WRK-14 未覆盖（§四）；观察面活性无施工证据 | |
| GLM K8 76/77 规范自反矛盾 | 已解（本卷复算证） | **closed** | `verify:docs` 检查⑥：VEC 10 条、正向 8/8、负向 2/2；`packages/core/test/v2/enc-digest.test.ts`（20 处 VEC 引用） | |
| GLM K9 枚举双字面量无唯一主表 | 已解（复扫证） | **closed** | contract artifacts 落位（`packages/contract/src/artifacts/cli.ts`）；**本报告未重跑 `contract:check`（不冒充）**；值集重述=0 由 `verify:docs` 检查④实测 | |
| GLM K10 82 自设检查未对自己执行 | 已解（本卷） | **closed** | `scripts/verify/v0-doc-check.mjs` **6/6 PASS** exit 0（落盘时 26 件、真悬空 0、裸字母真待修 0、节号 0 问题、VEC 8/8；本件落盘后复跑 27 件仍 PASS，见 §11.2） | |
| GLM K11 裸字母 ID 重号 | 已解（复扫证） | **closed** | `verify:docs` 检查③：token 2753 处、C1-C7 全分类、**真待修 0**；v2/17 §二.8-二 | |
| DSF P0-1 同一对象四层两套现行 | 已解（规范面；实现待 MIG） | **closed** | 实现腿：`apps/daemon/src/engine/engine.ts` **1988 行**（基线 2337，净降 349）＋api 端点 16＋`guard:boundaries` PASS（869 文件/0 违例）；`test/v2/api/assembly.test.ts` | |
| DSF P0-2 cost_daily 不在重建路径 | 方向已定（对账未决） | **closed**（重建限域实现） | rebuild 排除域段＋备份快照＋NEG-MIG-01/02 已覆盖（`cost-frozen`/`backup`/`rebuild-exclusion`）；**对账规则本身＝GAP-V2-01（open，不代裁）** | |
| DSF P0-3 强制位置坐在可选容器 | 已解（规范面） | **closed** | 结构负例 NEG-ORG-06/07 已覆盖（`packages/company/test/v2/org-structure.test.ts`）；表 A/A′/D 承接 v2/03/05 | |
| DSF P0-4 parent_grant 可空/冷启动无序（含根交接证明） | 部分解（内部顺序已解；外部 root 交接证明待 49·R1） | **partial** | 内部腿：`packages/gateway/src/root-delegation.ts`（指纹/期限/范围 preflight）＋NEG-ORG-09/10/11/12 已覆盖（`root-delegation.test.ts`、`org-root.test.ts`）；缺口：外部交接证明（49·R1）未落——保持 v2/17 的「部分解」 | |
| DSF P0-5 独立性无供给；审计分离规则 | 已解（规范面；公司层外部锚=GAP-V2-03） | **partial** | 审计矩阵已落卷（v2/03 §4.2/§4.3）＋NEG-ORG-15 已覆盖；缺口：NEG-EVD-02/03 未覆盖；公司层外部锚=GAP-V2-03（target） | |
| DSF P0-6 「完成」缩窄到终态、八要素自供 | 已解（规范面） | **partial** | EVD-ELM/ANC 形状＋NEG-EVD-01 已覆盖（X2/X3/X4 分级）；缺口：NEG-EVD-02/03/04/06 未覆盖（§四） | |
| DSF P0-7 D8/D10 被替换未废止 | 已解（规范面） | **closed** | 规范面关闭（01 §六硬核/软外围）；无代码面需求 | |
| DSF P0-8 T09 必被拒写/状态族拒收核心对象 | 已解（规范面；工件=MIG-03） | **closed** | REC 74 类形状落 contract 12 族；NEG-REC-01..09/11..13 **12/12 已覆盖**；`v14-records` 落表 | |
| DSF P0-9 失败分支 fail-open（gateway/坏锚/events/seatbelt） | 方向已定（机制目标；文档项已立） | **closed** | FC-01/02（gateway 无 secret 拒启）＋FC-03（坏锚拒应用/拒启）＋FC-04（events 触发器）＋FC-05（seatbelt 缺省最严）＋NEG-SEC-01/03/04 已覆盖；`packages/gateway/test/v2/fail-closed-secret.test.ts`、`test/v2/security/trust-anchor.test.ts` | |
| DSF P0-10 出站扫描无承担者/E2 同信任域/读面知悉 | 方向已定（机制目标） | **partial** | 出站闸五出口目录（`apps/daemon/src/assembly/outbound-gate/exits.ts`）：platform-write/notify/log **wired**，evidence-export/api-response **gap**；三不入（库/提示词/日志）wired；NEG-SEC-07 已覆盖；缺口：**2 个出口无生产通道**（`evidence-export:no-export-channel`、`api-response:api-assembly-not-wired`）——见 §六 | |
| DSF P0-11 现行效力与过审门禁不可判定（元阻塞） | 方向已定（表已立；生效待制作人签认＋DSF 复查填列） | **closed**（施工侧） | v2/17 §六.1 版本效力规则＋§六.2 本表；本报告回写施工列；缺口：**宣布权归制作人（本表不宣布）**；DSF 列空，生效未达 | |
| DSF P0-12 撤回不枚举后代凭据 | 已解（规范面；网关强制=目标） | **partial** | SEC-REV-01 面＋NEG-SEC-08 已覆盖（`test/v2/security/`）；缺口：NEG-RUN-03（撤回后代枚举链）未覆盖（§四 RUN 缺项） | |
| O3-01 组织对象与权威三契约互斥（v1） | 方向已定（V2 已消解；随 MIG-05 复验） | **closed** | 纯投影下沉＋只读兼容：`packages/company/src/projection/`＋`test/v2/org-projection.test.ts`；NEG-ORG-06/07 已覆盖；复验记录 `docs/baselines/split-plan-company.md` §五/§七 | |
| O3-02 台账可重建在钱维已破（v1） | 方向已定（同 P0-2） | **closed**（限域实现） | 同 P0-2 证据；缺口：对账规则＝GAP-V2-01（open） | |
| O3-03 权责主体被写成可选项（v1） | 已解（规范面） | **closed** | 03 表 D/05 表 C＋NEG-ORG-13/14/15 已覆盖（N 单元/域重叠/自审） | |
| O3-04 失败事件名不在词表/坏锚放行（v1） | 方向已定（机制目标） | **partial** | 坏锚侧：NEG-SEC-04 已覆盖（拒应用/ESCALATE/重复拒启）；缺口：**失败事件名未入冻结词表**（contract 内无 `redaction-failed`/`notify-blocked` 等码；现仅在 daemon `outbound-gate/scan.ts` 使用） | |

**表尾注（必读）**：
1. **「closed」不是 P0 清零**：本表只是施工侧对每一根因的落位判定；P0 清零的判定主体＝制作人或其明示指定 DSF（v2/17 §六.1-2），本报告**不宣布任何清零**。
2. 「规范面状态」列照引 v2/17 原文，未改一字；本件不修改 v2/17 §六.2 本体。
3. partial 的残余腿全部进 §十 未决清单，逐条有归属。

---

## 四、NEG 覆盖终值（冻结命令实测：**76/119**）

### 4.1 实测

```bash
$ grep -rhoE 'NEG-[A-Z]+-[0-9]+' packages/contract/cases.json apps packages scripts docs/probe 2>/dev/null | sort -u | wc -l
76
```

- **口径**：命令逐字取自 `docs/plan/04` §三「覆盖核对命令（冻结；仓根执行）」，未改模式、未改路径域。
- **分母**：v2/17 v2.1 §四 NEG 总数 **119**（EMP13＋ORG15＋WRK14＋RING5＋RUN5＋EVD6＋MON3＋REC12＋PKG9＋SCH10＋RULE10＋ENC2＋SEC8＋MIG2＋ENG5＝119）。
- **分子核验**：76 个 ID **全部**在 v2/17 §四声明表内（无一拼写/超号项）；与声明表做 `comm` 差集＝43。
- **不写 119**：**实测 76/119，未覆盖 43 条**。本报告正文出现的 NEG 编号**不计入分子**（冻结命令域不含 `docs/plan`，故本件不会造成覆盖数虚增）；也不以注释/文档充数（docs/49 MIG-06 裁「不伪造 ID、不用注释/文档充数」）。

### 4.2 按族终值（covered/declared；缺项逐条）

| 族 | 覆盖/声明 | 覆盖项 | 缺项（逐条） | 未覆盖项状态 |
|---|---|---|---|---|
| EMP | **1/13** | 03 | 01、02、04、05、06、07、08、09、10、11、12、13 | target（分配落点 `apps/daemon/test/v2/records/life-gates.test.ts` 仅 03 接线） |
| ORG | **9/15** | 06、07、09、10、11、12、13、14、15 | 01、02、03、04、05、08 | target（company `org-structure` 面未按 ID 接线） |
| WRK | **3/14** | 02、05、06 | 01、03、04、07、08、09、10、11、12、13、14 | target（`work-contract` 面未按 ID 接线） |
| RING | **0/5** | — | 01、02、03、04、05 | 01/02/03/05＝target；**04＝not-executed**（V6·SCEN 报告面：截至本件证据时点无落盘报告；并行单 08-05 采集中，结论以其报告为准） |
| RUN | **4/5** | 01、02、04、05 | 03 | target（撤回后代枚举链；与 SEC-08 同源） |
| EVD | **2/6** | 01、05 | 02、03、04、06 | target（02/03 审计分离/外部锚面；04 观察面活性无执行；06 未接线） |
| MON | **3/3** | 01、02、03 | — | — |
| REC | **12/12** | 01..09、11、12、13 | — | — |
| PKG | **9/9** | 01..09 | — | — |
| SCH | **10/10** | 01..10 | — | — |
| RULE | **10/10** | 01..10 | — | — |
| ENC | **2/2** | 01、02 | — | — |
| SEC | **8/8** | 01..08 | — | — |
| MIG | **2/2** | 01、02 | — | — |
| ENG | **1/5** | 03 | 01、02、04、05 | **01＝not-executed**（波外 dist spike，未做）；**05＝not-executed**（报告面纪律引证；冻结命令域不含 `docs/plan`，故本报告引证不改变分子）；02（YAML bomb）/04（Node 版本 fail-fast）＝target（无 `version-failfast` 套件、无 NEG-ENG-02 接线） |
| **合计** | **76/119** | — | **43** | — |

**未覆盖 43 条状态汇总**：`not-executed` 3 条（RING-04、ENG-01、ENG-05）＋`target` 40 条；无一条被计为「已覆盖」，也无一条被省略不提。

### 4.3 与 plan/04 波门目标的差距（必须如实呈报）

| 检查点（plan/04 §二/§三） | 目标 | 实测 | 判定 |
|---|---|---|---|
| MIG-03 形状层 | ≥43 | 43（当期记录，docs/49 裁 A） | 达 |
| MIG-05 资产/模板层 | ≥59 | 59（当期记录，docs/49） | 达 |
| MIG-06 已落地族 | 66（当期记录） | 66（当期记录） | 达（103 检查点按裁后移 MIG-08） |
| **MIG-07 分配面** | **≥112** | **76** | **未达（差 36）** |
| **MIG-08 终值** | **115 代码/契约面＋3 报告面=118；加 ENG-01=119** | **76** | **未达（差 42/43）** |

**结论（不粉饰）**：**NEG 覆盖未达 119，也未达 112/118 的波门检查点**。MIG-07 波门的 ①②③（V2 分腿：统一签名/fail-closed/root 验签/安全面）与包级源码类型门（7/7，docs/49 裁）达成（§五），**第④腿 NEG ≥112 未达**；该缺口属「行为面未实现/未按 ID 接线」，不是测试造假——本报告**不补写、不伪造、不以文档充数**，并把它列为 §十 未决项第 1 条（需制作人裁：补接线、或按 MIG-03/05/06 同口径重定检查点并落档）。

---

## 五、MIG-07 波门证据（12/12｜7/7｜scan 0｜verify:v2 1225）

| # | 证据项 | 记录/实测 | 本报告核验方式与结果 | 锚 |
|---|---|---|---|---|
| 1 | 实现单 **12/12** | MIG-07 波门 12 单（IMPL-07-01..12） | 12 个单号在 `apps`/`packages` 落位件均有引用（每单 2–11 处：见下注）；git 提交序列覆盖 01..12 | `602e1d7`（01/02/03/04/06/08）｜`97fe4fc`/`e41d18a`（07/08）｜`fcbf2f2`/`4186585`（05）｜`7b38e3c`/`8df0354`（09/10）｜`772c5e8`/`cc0655e`（11）｜`fbc3d33`/`7e59ca2`（12）｜`f3e916c`（06） |
| 2 | 包级源码 typecheck **7/7** | 2026-10-29 本机实测 **exit 0 ×7** | `gateway/core/adapters/yt/taiga/localplatform/matrix` 逐一 `mise exec -- bun run typecheck` → 全 exit 0（零输出） | `docs/49`「包级 typecheck 只判 src」（core/adapters tsconfig 去 test include） |
| 3 | 仓面秘密扫描 **0**（新命中） | 2026-10-29 本机实测 exit 0 | `mise exec -- node scripts/scan-repo-secrets.mjs` → `结论：通过（无新增命中）`；**新 0 条／已登记基线 20 条**（基线是本机路径/IP/凭据模式的既有登记，不是新命中） | `scripts/scan-repo-secrets.mjs`；台账式基线清单落脚本内 |
| 4 | `verify:v2` **1225 tests** | MIG-07 出口波门记录值 | **本报告不重跑 1225**；以 MIG-08 当前实测 **1254** 与记录值做差：1254−1225＝**29**＝MIG-08 新增三件用例（panel `mon-sixstates` 20＋contract `verify-docs` 5＋`port-map-rescan` 4）——逐件核对一致，**不把 1254 回写成 1225** | §七 3 轮日志；`packages/panel/test/v2/mon-sixstates.test.ts` 等 |
| 5 | 波门第④腿 NEG ≥112 | **未达：实测 76** | 冻结命令实测（§四）；**如实登记，不宣称达标** | §四 |

> 注：12 单落位引用计数（本机 `grep -rl`，2026-10-29）：07-01:3｜07-02:5｜07-03:3｜07-04:2｜07-05:10｜07-06:11｜07-07:3｜07-08:4｜07-09:7｜07-10:7｜07-11:9｜07-12:6。
> 说明：**12/12 只证「单落位」与波门命令通过，不证能力**（V6 探针 1/26 executed，见 §二 GAP-V2-11/§八）。

---

## 六、MIG-06 装配欠账现状（API 响应第 5 出口／OPS appendRecord／prompt runtime）＋06-10/11 消费侧缺口

> 欠账来源：`docs/plan/03` §八 MIG-07 入口条件「**MIG-06 装配欠账（本波入口即收口）**：`runServe`→`assembleApi`/`createApiApp` 的接线、API `readers/auth` 注入、OPS `appendRecord`→PORT-HIST、prompt `redactKnown` runtime 注入——单测已证、生产装配未证」。以下为 2026-10-29 收口核查结果。

### 6.1 四项欠账逐条

| 欠账项 | 现状 | 证据（文件:行） | 判定 |
|---|---|---|---|
| **① `runServe`→`assembleApi`/`createApiApp` 接线** | **未接线**：`runServe`/`buildServeRuntime` 无 `assembleApi`/`createApiApp` 调用与 import；`assembleApi` 只被自身定义与测试引用 | `apps/daemon/src/assembly/serve/run.ts`（全文无 api 装配）；`apps/daemon/src/assembly/api/index.ts:69`；`apps/daemon/src/assembly/outbound-gate/exits.ts:91-95` 自述「runServe 的 API 装配位（assembleApi）尚未接线」 | **gap（未闭）** |
| **② API `readers/auth` 注入** | **未供给**：`createApiApp` 要求 `readers: ApiReadSources` 与 `auth: ApiIntakeAuthenticator`（构造期缺槽＝`CONFIG_INVALID`）；而 `assembleApi` 的注入面只有 company/obs/gate/log（无 readers/auth 槽） | `packages/api/src/types.ts:288,290`；`apps/daemon/src/assembly/api/inject.ts:76-84`；`apps/daemon/src/assembly/api/index.ts:69-83` | **gap（未闭）** |
| **③ OPS `appendRecord`→PORT-HIST** | **未接生产写口**：`stop-channel` 定义 `appendRecord: (record: OpsStopRecord) => void` 端口并在落地路径调用 `deps.appendRecord(record)`；但 `run.ts`/`runtime.ts` 无 `appendRecord` 注入（`grep appendRecord apps/daemon/src/assembly` 零命中） | `apps/daemon/src/control/stop-channel.ts:227,401`；无装配调用方 | **gap（未闭）** |
| **④ prompt `redactKnown` runtime 注入** | **已接线**（MIG-07-11 收口）：`buildServeRuntime` 构造 `createDefaultAssembler({ ..., redactKnown: outbound.gate.promptRedactor })` | `apps/daemon/src/assembly/serve/runtime.ts:302-309`（:308 为 redactKnown 行）；`apps/daemon/src/assembly/outbound-gate/three-not-in.ts:54` 记装配点 | **closed（债闭）** |

### 6.2 五出口扫描面（MIG-07-11 落位件）

| 出口 id | 状态 | 说明/缺口码 |
|---|---|---|
| platform-write（平台写） | **wired** | `createEngine platform=wrapPlatform(gatedPlatform)` 输入端过闸（`exits.ts`） |
| notify（通知） | **wired** | `notifyBroadcast` 面注入 `wrapNotifyFace`；阻断＝软失败可判定 |
| log-egress（日志外发） | **wired** | `log=guardLog(rawLog)`；拦截行整行替换＋失败台账 |
| **evidence-export（证据导出）** | **gap** | 码 `evidence-export:no-export-channel`；wrapper 已备、生产装配点未落位（`exits.ts:74-78`） |
| **api-response（API 响应）** | **gap** | 码 `api-response:api-assembly-not-wired`；即 **API 响应＝第 5 出口无生产通道**（`exits.ts:89-95`） |

> 缺口可机械读出：`outboundExitGaps()` 返回 2 条（`exits.ts:111-118`）——「当前有几个出口没有扫描通道」是数字而非纪律。

### 6.3 06-10 / 06-11 消费侧缺口

| 单 | 已落位 | 消费侧缺口（如实） |
|---|---|---|
| **IMPL-06-10** studio-tools stdio 入口 | `packages/studio-tools/src/stdio.ts`＋`package.json#bin`/`exports["./stdio"]`＋`test/v2/stdio.test.ts`（真子进程冒烟/配置 fail-closed/库-结果面一致） | ①**仓内无 MCP 宿主消费方装配**（宿主接入未落，仅库/子进程形态被测试）；②`stdio.ts:22-26` 自述拟稿缺口：**HMAC 对称密钥经 env 投递**（目标形态 challenge-proof/非对称验签/daemon 代验未实现）、**README CLI 挂载样例仍指旧 daemon 路径**（本单领土不含 README，登记为缺口） |
| **IMPL-06-11** dsh-bridge 路径消费二选一声明 | `packages/dsh-bridge/package.json#dsh.entry`（数据面声明）＋`src/index.ts` 头注「选择①数据面、零模块入边」＋`test/v2/dsh-path.test.ts` | **daemon 消费侧未切到声明**：`apps/daemon/src/engine/instructions-store.ts:72` 仍以 `BRIDGE_SRC_REL` 四级相对路径推导（布局即接口）；声明已落但**未被消费**——切换＝后续单（不属本报告领土） |

**小结**：MIG-06 四项欠账 **1 闭 3 开**；五出口 **3 wired / 2 gap**；06-10/11 落位件在、消费侧各有 1–3 条缺口。这些是 §十 未决项第 13–15 条的来源，**不写成「装配欠账已收口」**。

---

## 七、`verify:v2` 连续 3 次（MIG-08 出口证据）

**命令（冻结，逐字）**：`mise exec -- bun run verify:v2`
＝ `guard:boundaries` → `typecheck`（源码）→ `typecheck:v2`（`test/v2`）→ `test:v2`（`vitest.v2.config.ts`）→ `v2-suite-manifest.mjs` → `old-test-ledger.mjs`。

| 轮 | 开始（CST） | 结束（CST） | 耗时 | exit | Test Files | Tests |
|---|---|---|---|---|---|---|
| 1 | 2026-10-29 14:52:33 | 14:53:49 | 76s | **0** | 81 passed | **1254 passed** |
| 2 | 2026-10-29 14:53:49 | 14:55:16 | 87s | **0** | 81 passed | **1254 passed** |
| 3 | 2026-10-29 14:55:16 | 14:56:26 | 70s | **0** | 81 passed | **1254 passed** |

**逐轮同项证据（3/3 一致）**：
- 边界门禁：`边界门禁 PASS：扫描 869 文件（范围面代码件 727），0 违例（分层宪法 20-§十五）`；
- `typecheck`／`typecheck:v2`：零输出（零 TS 错）；
- `test:v2`：`Test Files 81 passed (81)`／`Tests 1254 passed (1254)`；无 skip/only/retry（`vitest.v2.config.ts` `retry: 0`；manifest 校验）；
- `v2-suite-manifest`：5/5；`old-test-ledger`：**7/7 PASS**（§四红文件/红用例逐条有归属）。

**结论**：**连续 3 次通过（exit 0 ×3，同命令、同套件、用例数无抖动）**——满足 plan/03 §九与 plan/04 §1.9.4-9 的「连续 3 次」要求。单次绿不作数、本报告未以重跑掩盖波动（三轮全绿且无 flaky 差异）。

---

## 八、F8 未签认 / V2 不标定稿（诚实边界）

1. **F8 未过**（v2/17 §七）：F2/F3/F6「通过（复扫）」；F1/F4/F5/F7「**条件通过（抽测/声明面）**」；**F8「未过（外部待做）」**——DSF 复查未启动，§六.2 核验列空待填。
2. **开工令口径**（docs/49 §4）：**V2 在 F8 未签前不得标「定稿」**；各卷维持 `draft`；不得在报告/呈报/对外件写「V2 定稿」或宣称 F8 已签认。本件遵守。
3. **本报告的法律地位**：施工侧收口件；**替代门**（修订一致性复核＋每波 V2 新套件绿＋旧测试台账）证据之一，**不得倒推为 F8 结论**（docs/49 §10）。
4. **V2 状态词**：`v2.1-draft`（修订一致性版本），非 final。本件未修改任何 v2 卷的状态词。

---

## 九、旧测试台账 / 退役清单入口（评审材料与入口；判定不归施工方）

> 依据：plan/04 §1.8.6「旧测试存废门（V2 完成后，不得拖成永远以后）」＋plan/06 §5.2 裁决点 12（制作人/DSF 判）。本节只交**入口与材料**，**不自判存废**。

### 9.1 台账主件与机械校验

| 项 | 值/路径 |
|---|---|
| 台账主件 | `docs/baselines/old-tests-ledger.md`（v1，2026-10-28） |
| 校验命令 | `mise exec -- node scripts/verify/old-test-ledger.mjs` → **7/7 PASS**（随 `verify:v2` 每轮执行，3/3 轮均 PASS） |
| 口径 | `.test.ts` **209**＋口径差 **1** 行（vitest 210 的第 210 件＝`scripts/guards/boundaries.test.mjs`）；用例 **2976** |
| 现状 | **13 红文件／20 红用例**（实测 2026-10-28 16:28；19 timeout＋1 断言）；**审计基线 37** 只作对照保留、不写成实测；196 绿 |
| 纪律 | 只追加/更正不删行；退役须先改处置＋删除单＋替代覆盖＋理由；**无 skip、无重试刷绿、无改写冒充 V2 case** |

### 9.2 退役/重写清单入口（已有登记，待存废门裁）

| 来源节 | 内容 | 入口状态 |
|---|---|---|
| 台账 §十（MIG-06-09 退役触及面登记） | `packages/panel/test/external-serve.test.ts`＝**退役**（替代＝api 端点测试）；`packages/panel/test/external.test.ts`＝**退役**；`apps/daemon/test/cli/help-face.test.ts`＝**重写**（删 external 期望） | **已登记**，删除单/重写单「随 MIG-08 存废门立」——**本报告只登记入口，不立单不自判** |
| 台账 §八（MIG-05 触及面） | `gen-template.test.ts` 7 红 → 归 **GAP-V2-18**（重写/退役前不得再生成）；其余 4 件保留观察 | 已登记 |
| 台账 §七/§九（MIG-04/MIG-06 触及面） | store 旧 v4-v9 族 13 红文件/27 红用例；engine 2 红、cli 13 timeout 族 | 已登记（保留观察） |

### 9.3 存废门材料清单（评审包应含；本报告给出入口）

1. **已退役/待重写行**：台账 §十（3 行）＋§八（1 行归 GAP-V2-18）——评审时逐行确认替代覆盖是否成立。
2. **红行归属**：台账 §四（13 文件×20 用例）＋§七/§八/§九补充登记，逐条有处置/责任波/理由。
3. **判据**（plan/04 §1.8.6）：①覆盖（V2 是否覆盖同一行为）②维护成本③行为是否仍成立；**出口三清单＝保留/重写/退役**；不允许「全部保留」当默认、「全部删除」当清账。
4. **时点**：V2 完成后由**制作人/DSF**判（plan/03 §十二、plan/06 §5.2-12）；不得写成「永远以后」。
5. **本报告不作为**：不产出三清单（判定权不归施工方）、不删行、不改台账。

---

## 十、未决项汇总（逐条有归属；制作人/DSF 裁点）

| # | 未决项 | 现状/证据 | 归属 |
|---|---|---|---|
| 1 | **NEG 覆盖 76/119 未达波门**（MIG-07 ④≥112 差 36；MIG-08 终值 118/119 差 42/43）——缺 EMP12/ORG6/WRK11/RING5/RUN1/EVD4/ENG4 | §四 实测；不伪造、不以文档充数 | **制作人裁**（补接线 or 按 MIG-03/05/06 同口径重定检查点并落档）＋施工补接线 |
| 2 | GAP-V2-01 cost_daily 对账规则未裁（DEC-OPEN-14） | rebuild 限域/备份已落；规则未裁 | 制作人裁（plan/03 §十一） |
| 3 | GAP-V2-13 执行器值集 ENU-88 仍「待定稿」 | v2/09:246 | 09 登记（制作人/09 卷主编） |
| 4 | GAP-V2-17 SCH-ORG-01 字段/`units[]` 值集未登记 | 仅投影边界定形（split-plan-company §六） | 06/10/17 卷修订流 |
| 5 | GAP-V2-18 生成器仍 v1（gen-template 7 红） | `gen-template.ts` 在、导出在；旧测试 7 红 | 重写/退役单（05/16） |
| 6 | GAP-V2-02 SEC-SIG-04 通道未建／PRB-08 未执行 | compile-projection 自述；probe 仅 pb-1 | 后续波＋PB-2 |
| 7 | GAP-V2-06 任职网关闸门未建 | hr.ts 自述「目标（未证）」 | 后续波（02/16） |
| 8 | GAP-V2-04 派生树登记网关未建（代偿中） | selection.ts 自述 | 后续波 |
| 9 | GAP-V2-05 I-17 哈希链未建（触发器腿已闭） | records-migrations:74 | 后波 |
| 10 | GAP-V2-07 老板层继承/代行程序未裁 | v2/17 §4.5 | 01＋制作人 |
| 11 | GAP-V2-03 公司层外部锚未建 | v2/17 §4.5 | 公司层/制作人 |
| 12 | GAP-V2-10/11/14 探针/未证清单/第二实现 | PB-1 1 executed；PB-2..6 截至本件证据时点未落盘（并行单 IMPL-08-05 采集中，结论以其报告为准） | 施工/生态 |
| 13 | MIG-06 欠账：**API 装配未接线**（API 响应第 5 出口 gap）＋**API readers/auth 未供给** | run.ts 无调用；types.ts:288/290；exits.ts:89-95 | 后续 MIG（或 MIG-08 补充单）；**制作人裁归属** |
| 14 | MIG-06 欠账：**OPS appendRecord 未接** PORT-HIST | stop-channel:227,401；无装配调用方 | 同上 |
| 15 | 五出口另一 gap：**evidence-export 无生产通道**；06-10/11 消费侧缺口（README/HMAC 目标形态/宿主消费；dsh-bridge 声明未被 daemon 消费） | exits.ts:74-78；stdio.ts:22-26；instructions-store.ts:72 | 后续单 |
| 16 | **命令名口径差**：plan/03 §九、plan/04 §二 MIG-08 行写 `scripts/verify/v0-selfcheck.mjs`，落位件为 `scripts/verify/v0-doc-check.mjs`（plan/05 IMPL-08-02 同名）；`package.json` 增 `verify:docs` | 本报告 §1.2② 用落位件实跑 6/6 | **plan 修订**（03/04 卷，不属本报告领土） |
| 17 | 旧测试存废评审（三清单）未判 | §九 入口与材料已交 | 制作人/DSF（MIG-08 裁决点） |
| 18 | P0 清零宣布（DSF 列空待填） | §三 27 行；DSF 列全空 | **制作人/DSF**（宣布权） |
| 19 | F8 未签 → V2 不标定稿 | v2/17 §七；docs/49 §4 | 外部流程 |

---

## 十一、附录：本报告实跑原始输出（节选）

### 11.1 `verify:v2` 第 1 轮（exit 0）

```text
$ bun run guard:boundaries && bun run typecheck && bun run typecheck:v2 && bun run test:v2 && node scripts/verify/v2-suite-manifest.mjs && node scripts/verify/old-test-ledger.mjs
边界门禁 PASS：扫描 869 文件（范围面代码件 727），0 违例（分层宪法 20-§十五）
...
 Test Files  81 passed (81)
      Tests  1254 passed (1254)
...
manifest PASS：5/5（只含 test/v2、无旧测试路径、用例>0、无 skip/only/retry）
old-test-ledger PASS：旧测试台账自检 7/7（plan/04 §1.8.4）
# 轮次 exit=0（shell 记录；exit code 非 stdout）
```

### 11.2 V0 文档自检（`verify:docs`，exit 0；本件落盘后复跑，含本件）

```text
$ node scripts/verify/v0-doc-check.mjs
[v0-doc-check] OK ① 检查一 悬空节号引用：27 件文档、引用 2739 处（唯一行 1852）；真悬空 0、粘连解析 3、前向引用 6
[v0-doc-check] OK ② 检查二 跨卷 ID 存在性：58 个连字符族、token 5110 处；悬空 0、族段端点 719、记录族简写 4
[v0-doc-check] OK ③ 检查三 裸字母 ID 族：token 2840 处；C1-C7 全分类，真待修 0
[v0-doc-check] OK ④ 检查四 枚举字面量重述：诊断码定义 25 个全在 v2/10 §八（全库码形 token 107 处）；ENU 候选 122 条，跨卷表行重述 0
[v0-doc-check] OK ⑤ 检查五 节号连续性：27 件、章 300 个、数值子节 315 个；问题 0
[v0-doc-check] OK ⑥ 检查六 示例值自洽：VEC 10 条；正向复算 8/8、负向断言 2/2
v0-doc-check PASS：V0 六项 6/6（docs/v2 18 卷＋docs/plan 9 卷；真悬空 0）
# exit=0（shell 记录）
```

> 注：本件落盘**前**同一命令为 26 件／2699 引用／前向 5（§1.2 首跑）；落盘后为 27 件（含本件）——引用与前向计数的增量来自本件对未成卷卷次的登记性提及，与 v2/17 既有登记同族。**首跑与落盘后两跑均 PASS 6/6、真悬空 0**，本件未引入悬空引用。

### 11.3 F5 端口复扫（exit 0）

```text
$ mise exec -- node scripts/verify/port-map-rescan.mjs
[port-map-rescan] OK ① 单点表 13 行：PORT-ID 唯一 / 落点唯一 / 平铺 .ts
[port-map-rescan] OK ② 映射落点实存 13/13（0 缺失）
[port-map-rescan] OK ③ 落点自证 13/13 声明 PORT- 常量；承载件 0 处双源声明
[port-map-rescan] OK ④ 目录实况 20 件 = 映射 13 ＋ 承载 7；0 多余；≤25
[port-map-rescan] OK ⑤ 口径声明 6 处均 = 13；v2/17 §三 PORT- 名单与表同集合
[port-map-rescan] OK ⑥ 他卷端口路径 0 处（docs/v2 其余 17 卷零冲突）
port-map-rescan PASS：F5 端口-文件映射单点复扫 6/6（13 PORT ↔ 20 文件；0 缺失 / 0 多余 / 0 冲突）
# exit=0（shell 记录；`$?` 直取非管道）
```

### 11.4 秘密扫描（exit 0）

```text
$ mise exec -- node scripts/scan-repo-secrets.mjs
扫描根：<repo>
规则：host-absolute-path / private-ip / private-key / provider-token / bearer-token / credential-assign（值不回显，只报位置与指纹）
命中：新 0 条 / 已登记基线 20 条
结论：通过（无新增命中）
# exit=0（shell 记录；`$?` 直取）
```

### 11.5 NEG 覆盖（冻结命令）

```text
$ grep -rhoE 'NEG-[A-Z]+-[0-9]+' packages/contract/cases.json apps packages scripts docs/probe 2>/dev/null | sort -u | wc -l
76
```

### 11.6 包级源码类型门（7/7）

```text
$ for p in gateway core adapters yt taiga localplatform matrix; do (cd packages/$p && mise exec -- bun run typecheck) || exit 1; done
gateway exit=0
core exit=0
adapters exit=0
yt exit=0
taiga exit=0
localplatform exit=0
matrix exit=0
```

### 11.7 本轮改动面（本件足迹＝第一行；未 commit）

```text
$ git status --porcelain
?? docs/plan/mig08-closeout.md
?? docs/probe/pb-3/
?? docs/probe/pb-5/
```

- **第一行＝本件足迹**（唯一新增文件）；`docs/probe/pb-3/`、`docs/probe/pb-5/` 为**并行会话**（IMPL-08-05 PB-3/PB-5 探针收口登记，14:59–15:01 CST 新建）的产物，**非本件创建、本件未改动、不纳入本件交付**。
- `docs/v2/**`、`docs/plan/*`（其它卷）、`apps/**`、`packages/**`、`scripts/**`、`templates/**`：**零改动**。
- 未 `git add`、未 `git commit`（施工纪律；提交由主代理统一处理）。

---

## 十二、签署与效力

| 项 | 状态 |
|---|---|
| 施工侧（MIG-08 施工代理） | 本报告落盘；证据均为本机 2026-10-29 实跑（§七/§十一） |
| P0 清零宣布 | **未作出**（DSF 核验列空；宣布权归制作人/其明示指定 DSF——v2/17 §六.1-2） |
| 旧测试存废 | **未判**（入口与材料见 §九；判定归制作人/DSF） |
| F8 | **未签认**（v2/17 §七 F8「未过（外部待做）」） |
| V2 状态词 | `v2.1-draft`；**不标定稿**（docs/49 开工令 §4） |

*本件为 `docs/plan/05` IMPL-08-04 交付物（MIG-08 收口报告）；与 v2/17/plan/03/04 冲突时以 v2 卷为准（停手改卷）；本件不构成 F8、不构成 P0 清零、不构成 V2 定稿。*

---

## 十三、补记（2026-10-29，父级合入 API 第 5 出口）

- **API 响应出口已闭**：`runServe` → `wireServeApi`（`assembleApi` + `createApiApp` + `readers/auth` + `node:http` ephemeral/`apiPort`）→ `guardApiResponse`；`MIG-06` 装配欠账中的「API 装配未接线／readers/auth 未供给」两条关闭。
- **证据**：`apps/daemon/test/v2/api/live.test.ts` 12 tests（HTTP 200/403/503、触发 401、root 403、停机 close）；`test:v2 -- apps/daemon/test/v2/api` 21 tests；全 V2 **1266 tests**；`outbound-gate/exits.ts` 的 `api-response` 由 gap 翻 wired，security 78 tests 复跑绿。
- **仍未闭**：OPS `appendRecord`→PORT-HIST（REC-WORK-18 端口形状缺 `notified`/`independent_review`/`actions_taken` 等槽，需 v2/14 提案补形；不臆造记录）；evidence-export 仍 gap；NEG 76/119；PB-3/PB-5 未过；F8 未签。本节只更新装配事实，不改 §六 历史记录。

---

## 十四、复验补记（2026-10-29，API 第 5 出口＋D12 后）

- `scan-repo-secrets` 新命中 0；`verify:docs` PASS 6/6。
- `verify:v2` **连续 3 次 exit 0**（本轮实测，均 **83 files / 1275 tests**）：
  1) 68s；2) 68s；3) 67s。
- API 第 5 出口：`runServe` 同进程装配 `createApiApp`（readers/auth/node:http），`api-response` 由 gap 翻 wired；`live.test.ts` 13 tests。
- PB-5 D12：`openLedgerReadonly`（`readOnly:true`＋`query_only=ON`）落位，8 tests；**PRB-14 正面仍不成立**（无 WriterLease/围栏），PB-5 仍不通过。
- NEG 冻结命令复算仍 **76/119**；未新增伪造 ID。

---

## 十五、NEG 覆盖补强（2026-10-29，后续施工）

- 冻结命令复算由 **76/119 → 110/119**：新增 34 个 NEG-ID 的真行为测试（EMP 12、ORG 6、WRK 11、EVD 4、RUN 1；含 NEG-ORG-15/NEG-SEC-08 既有点）。
- 测试落点：`apps/daemon/test/v2/neg/{work-gates,harvest-neg,run-revocation}.test.ts`、`packages/company/test/v2/neg-org.test.ts`、`packages/contract/test/v2/{neg-emp,neg-org}.test.ts`；每个测试调用生产函数并做变异验证，未用注释/文档充数。
- 仍缺 **9**：RING-01..05（价值/权责/能力/组织/进化环，V6·SCEN/目标）＋ENG-01/02/04/05（跨版本探针/spike/纪律，波外目标）；其中 RING-04、ENG-01、ENG-05 为 `not-executed`，不得写「119 已覆盖」。
- 全 V2 门：**1328 tests** 全绿；`verify:docs` 6/6；`guard` 0 违例。
- 结论：NEG 覆盖率显著提升，但 **MIG-08 的 119 终值仍未达**；剩余 9 条缺的是机制/场景/跨版本探针，不是测试写法。
