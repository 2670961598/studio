# 87 · 验证-自检门禁类（GLM-5.3 独立验证）

> 验证人：独立验证代理（GLM-5.3）｜日期：2026-10-28｜对象：docs/v2/17-验证矩阵与追溯.md、docs/plan/00-07、仓根 package.json/tsconfig*、apps/*/tsconfig.json、packages/*/tsconfig.json。
> 方法：**只读**。命令面＝`ls`/`cat`/`grep`/`node -e`/`git log`/`git diff --stat`/`find`+`wc`。**未跑 vitest/typecheck/guard**（任务纪律）；N8 的运行结果一律引自仓内落盘的实测记录（docs/audit-DSF/*、docs/86），并核对其对当前树的有效性（git diff 证明其间零代码改动）。
> 立场声明：本报告结论全部基于一手取证（规范原文、tsconfig 实读、测试文件实针、审计运行记录）；docs/86（DSF 复查）在取证中被读到，仅作交叉引用，不作判定依据。三命题判定与取证过程相互独立完成。

---

## N7「v2/17 声称冻结门 F1-F7 全部通过，名不副实——F1/F4/F5/F7 为抽样或声明级，F2/F3/F6 为全量」

### 命题拆解

1. v2 体系存在「F1-F7 全部通过」的平级声称；
2. 其中 F1（示例值）、F4（基线复算）、F5（端口映射）、F7（三件套）实际只做了抽样或声明面检查，未达各门自身定义的全量口径；
3. F2/F3/F6 是全量。

### 我的证据

**「全部通过」的平级声称确在两处**：

- v2/00 §八（复查包说明，:103）：「**V2 状态：17 卷全齐（6,903 行）· 冻结门 F1-F7 全部通过 · F8（DSF 复查）待启动。**」——无限定语。
- v2/17 §七小结（:606）：「F1/F2/F3/F4/F5/F6/F7 通过（F2/F3/F6 由本日复扫转绿，§二.8）；F8 待外部。」——门标签直接写「通过」，未写「条件通过」。

**各门定义（v2/00 §六，:83-85）与 17 §七各行实际检查范围逐门比对**：

| 门 | 门定义要求（00 §六原文） | 17 §七/§二 实际执行（引文） | 差距 |
|---|---|---|---|
| F1 | 「10/11 卷**全部示例值**按自身规则合法」 | §二.6：VEC-01..08 复算 8/8（该族全量）；「10 §十 15 行字面自洽勾选另在本卷**抽验 1 例**：11 卷 grep `studio-next/jcs`=0 命中」；结论行自带「通过（**值集级全量待 09**：GAP-V2-13）」 | VEC 族外只抽 1 例＋1 条 grep；§十 15 行是人工勾选非机械执行；值集级全量未做（GAP-V2-13 未闭合——v2/09 ENU-88 执行器值集至今标「**待定稿**」，:242） |
| F4 | 「16 卷**每个数字**附复算命令」（可复算） | F4 行（:600）：「与 16 卷 B6/B7/B9 声明逐字一致（**抽测 3/13 项全中**）｜通过（**抽测**；全 13 项命令在 16 §一）」 | 13 项基线只复算了 3 项 |
| F5 | 「端口-文件映射单点且 16 卷零冲突」 | F5 行（:601）：「单点成立；冲突 0（**声明面＋抽验**）｜通过（**MIG-08 时机械复扫**，GAP-V2-15）」 | 机械复扫未做、推迟到 MIG-08；且声明面自身即有矛盾——本验实测：v2/14:51/§一写「**PORT- 13**」「13 个端口」「13 PORT- 各一件」（:290），而 v2/17 §三（:364）写「PORT- 运行时端口（**14**）」并列出 14 个 ID（AUTH/DEF/EVD/EXEC/GATE/HIST/HR/ID/OBS/OPS/REG/TRUST/WORK/WS）——13/14 两卷不一致，抽验未覆盖到 |
| F7 | 「B 档 10 项＋DSF 12 项**对应对象**在 05-08/11/17 三处可查」（22 对象） | F7 行（:603）：「**抽查**：OBJ-01/02＋REC-ACC＋NEG-REC-06……（**抽查 3/3 齐**；全量**以 §三/§四 表为准**）」 | 实测抽查仅 3 个对象；「全量以表为准」＝以 17 卷自产的追溯表存在为据，属声明级自证 |
| F2 | 枚举唯一主表零重述 | F2 行（:598）：码族 74 token 全库 grep＋值集级 112 条 ≥3 值 ENU 条目对 18 卷全扫（§二.8-三），重述=0 | **全量**（2026-10-28 复扫） |
| F3 | 17 卷自检全库跑过、悬空=0 | F3 行（:599）：18 卷、去重引用行 1488/1499 全扫、真悬空 0；残余仅 90 卷未成卷前向 1 处（登记维持，非悬空） | **全量**（域＝已落盘 18 卷） |
| F6 | 全库前缀式、裸字母族=0 | F6 行（:602）：1511 token 全库扫描、七类白名单（C1-C7 逐类可核）、真待修=0 | **全量** |
| F8 | DSF 复查通过 | 「未启动｜**未过**」（:604） | 如实登记，无问题 |

**断言中的四个例子逐一核对**：F1「示例值只覆盖部分卷」——准确（卷 10 得到 VEC 族全量＋15 行抽 1 例，卷 11 仅 1 条 grep）；F4「只复算部分数字」——准确（3/13）；F5「只查声明面」——准确（声明面＋抽验，机械复扫推迟）；F7「只抽查少数对象」——准确（3 个）。断言中「F2/F6/F3 是全量」——与 17 §七各行及 §二.8 复扫记录一致。

**酌情减轻情节**（不影响判定，如实记录）：17 §七每行的「检查命令/结果」两列本身对抽样/声明面是**透明的**（「抽测 3/13」「声明面＋抽验」「抽查 3/3」「值集级全量待 09」皆原文照录），并非隐瞒；问题在结论列的门标签一律写「通过」而非「条件通过/抽样通过」，以及 v2/00 §八面向 DSF 的复查包把限定语全部抹平成「F1-F7 全部通过」——下游（如 plan/03 §十二以「17 §七现余 F8 一门」作为 MIG-01 入口条件）消费的正是这个平级结论。

### 判定

**成立。**「F1-F7 全部通过」的平级声称与 F1/F4/F5/F7 的实际执行范围不符：四门是抽样或声明级，只有 F2/F3/F6 是全量；断言所列每门的具体范围描述与原文逐字吻合。F8 未过系如实登记，不在争议内。

### 修法方向

1. v2/17 §七结论列改三值：「全量通过／条件通过（抽样，附差额清单）／未过」；F1/F4/F5/F7 改「条件通过」并列出「补全量差额」（F1＝10 §十 15 行机械化＋值集级全量（先销 GAP-V2-13）；F4＝13 项逐项复算；F5＝机械复扫提前或明示依赖 MIG-08；F7＝22 对象三处可查逐项对表）。
2. v2/00 §八复查包一句话改为诚实版本（如：「F2/F6 全量通过；F3 除未成卷的 90/91 外全量；F1/F4/F5/F7 条件通过（抽样，差额见 17 §七）；F8 待启动」），下游 plan/03 §十二同步。
3. F1 的 VEC 复算脚本从 /tmp 入仓（可复跑性——现 `/tmp/v2-vec-recheck.mjs` 换机即失，17 §二虽照录思路但非可执行工件）。
4. 顺手修 F5 声明面矛盾：裁决 13/14 端口计数（v2/14 vs v2/17 §三）与 ports 终态 20 件口径的对表。

---

## N8「MIG-02 出口的『全量回归绿』在当前仓库不可达或需额外稳定性工作（非 V2 原因的红/超时：历史 flaky 家族、负载敏感用例）」

### 命题拆解

1. plan 的 MIG-02 波出口门禁要求全量回归绿；
2. 当前仓库跑全量测试存在与 V2 无关的红/超时（E-4 时序 flaky 家族、负载敏感用例）；
3. 故该波门按当前范围不可达，或需要 MIG-02 范围之外的稳定性工作。

### 我的证据

**① MIG-02 出口确含「全量回归绿」**（plan/03 §三，:63-69）：

```
mise exec -- bun run test    # 全量回归绿（现状 209 件回归面）
```

且 plan/04 §二（:96）把三件套定为「每波必跑，**全绿方可出波**」。

**② MIG-02 的范围不含任何运行时稳定性工作**（plan/03 :61、plan/05 IMPL-02-01..04）：只修 core 36/adapters 6/prompt 19 共 61 个 **TS 编译错**＋5 处 JSON import attr＋根 package.json 新增 typecheck:test 脚本。4 个单里没有「全量跑红」的承担者。

**③ 仓内已知 flaky/负载敏感登记**（本验实读＋实针）：

- plan/06 H-09（:25）：「E-4 时序 flaky 家族（**重复跑绿掩盖真缺陷**）」→ RISK-10（:52）：「flaky 误判：E-4 时序家族 flaky——重跑变绿掩盖真缺陷，**或误红阻塞波门**｜概率 M/影响 M｜影响波：全（06 重）｜缓解：flaky 单列台账不静默重跑；时序用例隔离套；**根因未明的红不得以重跑变绿过关**；flaky 清零入波门附件」。§4.2（:122）预算另计「flaky 重跑 ≈ +15%」缓冲。
- plan/04 §五（:163-173）E-4 家族两先例，本验到源文件实针确认仍在：
  - `packages/panel/test/overview-reload.test.ts:20`：`vi.setConfig({ testTimeout: 60_000 }) // E-4 前例：fs.watch 时序用例在全量并行负载下超缺省 5s——只动预算不动断言（2026-10-22 宰相亲批）`
  - `apps/daemon/test/engine/crash-injection.test.ts:47-49`：`CASE_TIMEOUT_MS = 180_000`（注释引 E-4 家族·studio-dev-246，先例=overview-reload 60s）
  - 注意其规则 1 只约束**新增** V5/V4 用例显式设 testTimeout——存量 209 面未系统化兜底。

**④ 全量跑的实测红记录（仓内落盘，非本验证代跑——本验纪律禁跑 vitest）**：

| 记录（日期） | 结果 |
|---|---|
| docs/audit-DSF/V14（2026-10-27 19:31，HEAD 868844d） | `Test Files 14 failed/196 passed (210)；Tests 35 failed/2941 passed (2976)；exit 1`；20 分钟后复跑 `18 failed files/51 failed tests/10 skipped/5 unhandled errors`；失败集中 spawn/e2e 时序面（单条 9–33s）；同环境 typecheck exit 0、guard 0 违例 |
| docs/audit-DSF/C08-P1-01 | `15 failed files/47 failed tests`，**全为 5s 超时类**；隔离复跑 usage-contract 7/7 绿、crash-injection 5/5 绿 |
| docs/audit-DSF/O3-06 | `13 failed files/29 failed tests/54 处 Test timed out`，并记「五份报告共六次复跑给出 **29–55 不等**的失败数——环境敏感」 |
| docs/audit-DSF/V12-02 | `55 failed/2913 passed/8 skipped` |
| docs/86 §B5（2026-10-28） | `Test Files 13 failed/197 passed (210)；Tests 37 failed/2939 passed (2976)；exit 1`，多为 `Test timed out in 5000ms`（CLI spawn/fs.watch 家族） |

**⑤ 记录对当前树的有效性**：`git diff --name-only 868844d..HEAD（40e5936）` 全部 123 个变更文件都在 `docs/` 下——**代码零改动**，上述红对当前 HEAD 仍然成立。

**⑥ 归因**：失败形态为超时（5s 缺省打满、spawn/fs.watch 族）、同文件隔离复跑绿、失败数随负载在 29–55 摆动——即负载/时序敏感（E-4 家族），非断言失败，且与 V2 目标件无关（V2 目标件未写，plan/04 §四 MIG-01/02 行「只读冻结/修红不加面」）。叠加 RISK-10 的「根因未明的红不得以重跑变绿过关」，这些红**不能靠重跑刷过波门**。

### 判定

**成立。**「全量回归绿」按 MIG-02 现范围（61 个 TS 错＋脚本串接）做完后波门不可过：仓内有六次全量跑记录全部 exit 1（29–55 个失败，全部超时族、环境敏感），且 MIG-02 无单承担、风险纪律禁重跑过关。措辞校准：不是数学上「不可达」——固定 worker/超时口径＋给存量时序用例补预算后可达——但那正是断言后半句「需要额外稳定性工作」，且该工作在 MIG-02 现范围之外（须另立单）。

### 修法方向

1. 新增 `IMPL-02-05 全量回归稳定性` 单：存量时序用例按 E-4 规则逐条显式设预算；固定 vitest worker 数/并发口径；把存量红逐条归类「预算/环境/真缺陷」，真缺陷另立单（不得以预算掩盖）。
2. plan/03 MIG-02 出口命令写死可绿的冻结形态（worker 数、testTimeout 口径，或串行/限并发），并钉测试计数口径（`.test.ts`=209 vs vitest=210，docs/86 §B5 已点名此差）。
3. plan/07 A 方案前置「三门禁全绿」的判据同步挂钩上述冻结命令（连续 N 次绿），否则 MIG-03 切换点同样踩空。

---

## N9「typecheck:test 覆盖不到 daemon 与 contract 的测试目录——两处 tsconfig 只 include src，且方案只对四包串该命令」

### 命题拆解

1. `apps/daemon/tsconfig.json` 与 `packages/contract/tsconfig.json` 的 include 只含 src 不含 test；
2. 施工方案（plan/02、plan/03/04/05）的 typecheck:test 只串 core/adapters/prompt/contract 四包；
3. 故 daemon 与 contract 的测试目录经 MIG-02 后仍无类型门禁。

### 我的证据

**① tsconfig 实读（node -e 剥注释后 JSON.parse，全仓 18 份权威普查）**：

| 文件 | include | test 入 program？ |
|---|---|---|
| `apps/daemon/tsconfig.json` | `["src/**/*.ts"]` | **否** |
| `packages/contract/tsconfig.json` | `["src/**/*.ts"]` | **否** |
| packages/core / adapters / prompt | `["src/**/*.ts","test/**/*.ts"]` | 是 |
| packages/dsh-bridge | `["src/**/*.ts","test/**/*.ts"]`＋`exclude:["test/smoke/**/*.ts"]` | 是（smoke 除外） |
| 其余 11 包＋apps/boot＋**根 tsconfig.json**（`apps/*/src/**`、`packages/*/src/**`） | 仅 src | 否 |

（过程注：一次 grep 转义误报曾多匹配 4 包，经 node 精确解析纠正——含 test 的恰好 4 包，与 v2/13 §1.4「仅 4 个」一致。）

**② 方案串接范围（原文）**：

- plan/04 §二 MIG-02 行（:101）：「`mise exec -- bun run typecheck:test`（本波新增脚本：**core/adapters/prompt/contract 四包** `tsc --noEmit -p` 串联）」
- plan/03 §三 MIG-02 范围（:61）：workspace＝`packages/{core,adapters,prompt}/test` 面＋contract/test 与 company/test 的 5 处 import attr＋**根 package.json（新增 typecheck:test）**——**无任何 tsconfig include 修改**。
- plan/05 IMPL-02-04（领土列）：根 package.json scripts 段＋4 个测试文件——同样无 tsconfig 改动；plan/02 §五-7 只把「根 package.json·**根** tsconfig.json」归 T。
- 根 package.json 现状（实测）：scripts 仅 typecheck/guard:boundaries/test/daemon，typecheck:test 尚未存在（「本波落位后生效」，plan/03 :67）。

**③ 机械推论（实测计数支撑）**：

- contract 虽在四包之列，但 `tsc -p packages/contract` 的 program=src——`packages/contract/test/` 的 2 个 .ts（实测计数 2）不进检查；MIG-02 对 contract/test 做的只是 import attr 运行时修复，不因此入类型门禁。
- daemon 既不在四包、tsconfig 又只含 src、根 tsconfig 也只含 src——`apps/daemon/test/` 的 **86** 个 .ts（实测：86 总数/85 个 .test.ts，全仓 test/ 目录 185 个 .ts 之最）零类型门禁。
- 净效果：MIG-02 后 test/ 目录入类型门禁的仅 core/adapters/prompt 的 **37** 件（实测计数；dsh-bridge 1 件在 program 但不在四包串联、contract 2 件被串但 program 不含）——185 件中 **148 件仍无类型门禁**，与 v2/13 §1.4「147 个不在任何 program」相比仅改善 37 件。

**④ 上位规范自证（方案自身口径打架）**：v2/13 §1.4（TOOL-06）三态表明写「test/ 目录……**147 个不在任何 program**（daemon 86/company 21/panel 18/store 16/taiga 3/contract 2＋dsh-bridge smoke 1）｜门禁调用：无」，结论段并明令「**不得写成『17 包全串』或『已切四个带 test 包』**」；v2/09 ENU-134（:298）登记 `test_dir`＝「147 件无门禁」。而 plan/03 MIG-02 目标（:60）写「……消灭 **ENU-134 的 test_dir 无门禁态**」——按四包串联的实际覆盖（37/185），该目标表述属过度声明。

### 判定

**成立。**两个机制点均实测吻合：daemon/contract 的 tsconfig 均只 include `src/**/*.ts`；typecheck:test 只串 core/adapters/prompt/contract 四包且方案不改任何 tsconfig include。daemon（86 件）因双缺口不覆盖；contract（2 件）虽被串但因 program 不含 test 同样不覆盖。断言未点名的同型缺口还有两处（如实补记）：company/test（MIG-02 触及其 2 文件，但 company 既不在四包、tsconfig 也不含 test）与 dsh-bridge（program 含 test 但不在四包串联）。

### 修法方向

1. 立根级 `tsconfig.test.json`（include 全部 `test/**/*.ts`）或逐包扩 include，typecheck:test 改为消费该 program——一次性覆盖 185 件（含 daemon 86/contract 2/company/panel/store/taiga），真正兑现「消灭 test_dir 无门禁态」。
2. 若按最小范围推进，则 plan/03 MIG-02 目标句改写为「core/adapters/prompt 三包 test 面入门禁（37/185）」，ENU-134 的关闭判据同步改为「185 件全覆盖」并排后续波（MIG-03/06）补齐，避免过度声明（v2/13 §1.4 明令不得写「四包已切」的变体）。
3. contract 需要二选一显式化：要么 tsconfig 加 test（并承担随之暴露的检查面），要么从四包串联中说明其仅 src 面——现状「被串但测不到」最易误读。

---

## 汇总

| 命题 | 判定 | 一句话 |
|---|---|---|
| N7「F1-F7 全部通过」名不副实 | **成立** | F1/F4/F5/F7 实为抽样/声明级（17 §七各行自供：抽 1 例、3/13、声明面＋抽验、抽查 3/3），仅 F2/F3/F6 全量；00 §八与 17 §七小结把抽样升格为「通过」 |
| N8「全量回归绿」波门当前不可达/需额外稳定性工作 | **成立** | 仓内六次全量跑记录全 exit 1（29–55 失败、全为 spawn/fs.watch 超时族、环境敏感），MIG-02 现范围（61 个 TS 错）无单承担且禁重跑过关；需另立稳定性单 |
| N9 typecheck:test 覆盖不到 daemon/contract 测试目录 | **成立** | 两处 tsconfig 实测只 include src；typecheck:test 只串四包且不改 include——daemon 86 件、contract 2 件经 MIG-02 后仍无类型门禁（185 件中仅 37 件入闸） |

### F1-F8 逐门真实状态表（N7 附表；本验独立判定）

| 门 | 名称 | 声称 | 真实状态 | 执行范围（实测口径） | 差额（补全量尚欠） |
|---|---|---|---|---|---|
| F1 | 无规范自反 | 通过 | **抽样（族内全量＋点抽）** | VEC-01..08 复算 8/8（该族全量）；10 §十 15 行人工勾选仅抽验 1 例；11 卷单条 grep；值集级全量未做 | §十 15 行机械化；值集级全量（前置：销 GAP-V2-13，09 ENU-88 执行器值集仍「待定稿」） |
| F2 | 枚举唯一主表零重述 | 通过 | **全量** | 码族 74 token＋值集 112 条 ENU，18 卷全扫（2026-10-28 复扫），重述=0 | — |
| F3 | 自检全库跑过悬空=0 | 通过 | **全量**（域=已落盘 18 卷） | 1488/1499 引用行全扫真悬空 0；残余＝90 卷未成卷前向 1 处（登记维持） | 90/91 成卷后补扫 |
| F4 | 迁移基线可复算 | 通过 | **抽样** | 13 项基线复算 3 项（B6/B7/B9） | 余 10 项逐项复算 |
| F5 | 端口-文件映射单点零冲突 | 通过 | **声明面＋抽验** | 无机械复扫（推迟 MIG-08，GAP-V2-15 未闭合）；且声明面自矛盾（v2/14「PORT- 13」vs v2/17 §三「14」） | 机械复扫；13/14 计数裁决 |
| F6 | 全库前缀式裸字母=0 | 通过 | **全量** | 1511 token 18 卷扫描＋七类白名单，真待修=0（2026-10-28 复扫） | — |
| F7 | 记录型三件套齐 | 通过 | **抽查＋声明级** | 22 对象实测抽查 3（OBJ-01/02、REC-ACC、NEG-REC-06）；「全量以 §三/§四表为准」＝17 卷自产表自证 | 22 对象逐项三处对表 |
| F8 | DSF 复查通过 | 未过 | **未过（如实）** | 外部流程未启动；§六.2 核验列空待填 | 制作人携卷赴 DSF |

---

*本报告为独立验证产物，只读取证，未改任何既有文件（唯一写入即本件）。验证代理与 v2/plan 各卷起草方、docs/86 复查方相互独立；引用行号以 2026-10-28 HEAD（40e5936）工作区为准。*
