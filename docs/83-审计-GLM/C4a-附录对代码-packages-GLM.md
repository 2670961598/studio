# C4a · 逐文件附录（81-files/01–15）对真实源码事实核对——packages 部分

> 审计人：GLM-5.3（ZCode 子代理，独立红队）
> 日期：2026-10-27
> 连接：C4-a
> 对象：`docs/81-技术细节-StudioNext逐文件蓝图.md`（主卷统一写法/处置规则）+ `docs/81-files/01-contract.md` ~ `15-studio-tools.md`（15 份附录）
> 真实源码基准：dev HEAD `868844d`（含 v0.5 真单刀：`engine/merge/` 等 daemon 新文件、`adapters/dsh.ts` `session_resume` 已翻 true）
> 纪律：只读（除本报告外零写入、零 git 写、零测试运行、零依赖安装）。分段 Read、Glob/ls 批量取清单。

---

## 一、摘要（总判）

**15 份附录的「现有件」清单与真实源码的吻合度异常高**：逐包文件清单 100% 复算通过（0 漏列、0 虚构路径），抽查的行数（`wc -l` 逐值比对约 150+ 个数值）、测试用例数（`it(`/`test(` 计数）、`cases.json` 域分布、`boundary-rules.mjs` 基线值（含 `ledger.ts` 1683 实测 vs 基线 1684 的双值标注、`dsh.test.ts` 732 实测 vs 基线 785 的双值标注）**全部精确命中**。未发现任何 P0 级「虚构现有文件 / 描述失实」。

发现 **2 条 P1**（一处路径笔误、一处已过时的现状判断——后者与 HEAD 868844d 刚合入的 v0.5 真单刀直接相关）、**2 条 P2**（81-§六判据 4 在 company 包两件超限件上的字面不符、一处表述粗略）。目标件（`目标-新增`）均明确标注「未实现」，抽查 `IntentIngress`/`IntentReceipt`/`openLedgerReadonly`/`intent_receipts` 全仓 grep 零命中，与附录「目标未落地」的声明一致——**附录没有把设计冒充现状**。

| 等级 | 计数 | 摘要 |
|---|---|---|
| P0（虚构文件 / 描述失实） | **0** | — |
| P1（漏列 / 过时 / 路径错误） | **2** | ①02-core 秘密迁移调用方路径笔误；②07-adapters 对 `resumeWithSession` 的「无编排证据」判断已被 merge-run 推翻 |
| P2（判据字面缺口 / 表述粗略） | **2** | ③04-company 两件超限件无「拆分后文件清单」；④03-store「v1–v13」表述略粗 |

---

## 二、每包核对表

核对方法说明：清单列 = 附录「现有件全集」表 vs `find <pkg>/src <pkg>/test -type f` 实测；行数列 = 附录表内行数 vs `wc -l` 实测；抽核列 = 附录逐件条目（职责/导出/行为契约/处置）vs `Read` 源码头注与导出面。

| # | 附录 | 真实文件 | 清单核对 | 行数核对 | 抽核深度与结果 | 专项（81-§五） | 完成判据（81-§六） |
|---|---|---|---|---|---|---|---|
| 01 | contract | 21（src 15 + test 2 + 根 4） | **21/21 吻合** | 全部精确（src 合计 1434 复算 ✓；cases.json 1696；最大件 company.ts 251） | **深**：`runner.ts` 逐条（贪心匹配 `:41-53`、裸 `Error` `:107-110`、NaN 禁用）逐行吻合；`kernel.ts`（`ClassifiedError:98-102` 三字段、`ErrorCategory` 11 值 `:85-96`、`Money{usd:number}:13`）吻合；cases.json 53 条 7 域分布 `meta3/dir3/evt7/rpt5/deps17/plat10/mj8` 精确 | ✓（§五 域归属/消费/漂移 + §4.9 接缝 12 面） | 1-8 基本满足（超限件无） |
| 02 | core | 45（src 18 + test 17 + golden 6 + 配置 4） | **45/45 吻合**（含 models.example.yaml 31 行、pricing.example.yaml 52 行） | 全部精确；16 个测试件 394 个 `it(` 复算一致 | **深**：`decide.ts` `intentKeyOf` `[source,kind,company,ticket??dedupKey??''].join('|')` 在 `:319-323` 逐字吻合；`secrets.ts` 80 行三函数+一类型+`MIN_KNOWN_LENGTH=6` 吻合；`breaker`/`dispositions` 条目与源码头注一致。**发现 P1-1**（`packages/prompt/src/assembly/hrsync/assemble.ts:59` 路径不存在） | ✓（§1.3 纯函数/IO 分离、状态机/预算/断路/错误） | §六自报 19 条对账，实查存在且编号齐 |
| 03 | store | 33（src 15 + test 15 + ulid 1 + 配置 2） | **33/33 吻合**（自报无 migrations/ 子目录、无 fixtures——与实测一致） | 全部精确（ledger 1683/基线 1684、records 606、migrations 600、v5-candidates 602 双值标注均对） | **深**：`driver.ts` 36 行唯一 `openSqlite`、WAL/NORMAL/FK/busy_timeout=5000 逐字吻合；`migrations.ts` `sha8`（`:546-548`）、`migrate` upTo 越界即 `configInvalid` 吻合；v12 DDL 实在 `cost.ts`（附录自己写明，见 P2-4） | ✓（§1.3 三事实源五分类/唯一写入者/只读打开） | 超限件 4 件均有拆分清单（records/migrations/ledger/v5-candidates §5.1b/§5.3） |
| 04 | company | 45（src 21 + test 21 + fixtures 3 族 21 文件 + 配置 2） | **45/45 吻合**（fixtures 计数 company-dist 13 + company-src 5 + plugins 3 = 21 精确） | 全部精确（repo-validate 1021、dependencies 775、validator 612；test 21 件行数逐值命中） | **中**：`reports.ts:35` `import type {PersonRecord,ReportRecord,WorkRecord} from '@studio-next/store'` 行号级吻合；package.json 依赖五项+localplatform dev 逐字吻合。**发现 P2-3**（validator.ts/repo-validate.test.ts 无拆分清单） | ✓（§1.1 零秘密消费、§1.2 company→core 禁边） | 判据 4 字面缺口 2 件（见问题 3） |
| 05 | prompt | 14（src 6 + test 6 + 配置 2） | **14/14 吻合** | 全部精确（layers 555/600 余量 45 的表述与实测一致） | 中：`index.ts:39` `PACKAGE_NAME` 行号吻合；测试 `it` 计数 15/9/13/7/12=56 精确；layers 14 个 throw 的现状描述与源码一致 | ✓（L0–L5 指纹、消毒、提示词不授权 9 处） | 满足 |
| 06 | gateway | 11（src 5 + src 内联测试 4 + 配置 2） | **11/11 吻合**（自报无 test/ 目录——实测确无） | 全部精确（wkey 198/gateway 94/actions 67/signature 41/index 23） | 中：`test()` 计数 20/13/13/6=52 精确；「凭据≠授权」「署名≠数字签名」「重启丢吊销」现状断言与 `wkey.ts:19` 头注一致 | ✓（凭据授权分离/写收口/§8.7 回执三情形） | 满足 |
| 07 | adapters | 41（src 9 + test 14 + fake-cli 2 + 夹具 14 + 配置 2） | **41/41 吻合**（夹具 dsh 6/claude 3/codex 3/kimi 2 精确） | 全部精确（dsh.ts 758、dsh.test 732、kimi.test 662 双值标注对） | **深**：四家 `capabilities` 块逐字核对全部命中（dsh `session_resume:true` + agents_md:'user_level'；claude budget_cap/cost_native true；codex/kimi 拟稿注释原样引用）。**发现 P1-2**（`resumeWithSession`「无编排证据」已过时） | ✓（能力包六段/四条边界/四家损失与降级） | 超限件 3 件均有清偿表（§5.2） |
| 08 | localplatform | 19（src 12 生产 + testutil 1 + 测试 4 + 配置 2） | **19/19 吻合** | 全部精确（合计 2031 行复算一致） | 中：`binding.ts` 目标件明确「contract 类型前置阻塞、代码零命中」——与实测一致 | ✓（mapState/unverified 口径、G15 前置链） | 满足 |
| 09 | yt | 25（src 12 生产 + 测试 5 + testutil 1 + fixtures 5 + 配置 2） | **25/25 吻合** | 全部精确（最大件 testutil 467 与自报一致） | 中：fixtures 5 个 JSON 文件名精确；「目录不超 25、无超限件」与实测一致 | ✓（§四 四专题：绑定档案/导出迁移退出/字段映射/守卫） | 满足 |
| 10 | taiga | 35（src 17 生产 + 基建 3 + src 测试 10 + test/ 3 + 配置 2） | **35/35 吻合** | 全部精确（testutil 693、factory 333、transport/context 339 等） | 中：`transport/http` 223、`entities` 75、`shape` 85 逐值命中；smoke 两件「非证据」标注如实 | ✓（BC-T1 反向边/绑定/损失映射） | testutil 693（基线 723）有 facade+6 件拆分清单 |
| 11 | matrix | 18（src 15 ts + package + tsconfig + README 30 行） | **18/18 吻合** | 全部精确（provision 598、client 465；生产 9 件 1946 行复算一致） | 中：provision 598<600 仍给 facade+4 子件拆分（设计选择，非误报） | ✓（§81-5.3 引用明示：boot 注入/通知不是决定，:830/:854 落实） | 满足 |
| 12 | dsh-bridge | 7（src/index 212 + 测试 3 + 配置 3 含 cordis.patch.yml） | **7/7 吻合** | 全部精确（index 212、bridge.test 321） | 中：导出符号清单（`name`/`inject`/`DEFAULT_INSTRUCTIONS_ENV` 等）与「零 contract 入边」声明吻合 | ✓（载体软硬判据/PRM/PTC 14 处/证据导出） | 满足 |
| 13 | panel | 73（src 根 7 + overview 7 + external 3 + test 18 + ui 33 + scripts 1 + 配置/vendor 4） | **73/73 吻合**（ui 33 文件逐一枚举命中；vendor 第三方产物 3 件+LICENSES 排除口径成立） | 抽核精确（views 662、overview/views 629 双超限件） | 中：三面端口表（8791/8789/8788）与「external 过渡实现+最终退役」处置成立 | ✓（六态非布尔/只读打开/错误两轴/认证最小暴露） | 超限件 2 件均有 §五.1/§五.2 拆分 |
| 14 | api | 3（src/index 43 + package 23 + tsconfig 5） | **3/3 吻合**（自报「43 行占位包、零路由零 import」——实测一致） | 全部精确 | 中：附录 1180 行几乎全部为目标设计（35 件），对现状的极简描述未越级；`panel/src/external` 行数引用（48/571/201）未逐值复核（见覆盖声明） | ✓（只产意图/禁直写/幂等/回执快照/16 路由） | 满足 |
| 15 | studio-tools | 8（src 5 + package + tsconfig + README 118） | **8/8 吻合** | 全部精确（index 20/tools 335/server 264/server.test 440/tools.test 141） | 中：外部调用锚 `worker-key-lifecycle.test.ts:30-31` 行号级命中；「生产 daemon src 零 import」声明与 grep 一致 | ✓（stdio 边界/秘密不出境/WKEY_META_KEY legacy 化） | 满足 |

---

## 三、分级问题明细

### 问题 1（P1）· 02-core 引用了不存在的 prompt 包路径

- 【定位】81-files/02-core.md `F-core-secrets` 迁移边界段：「调用方（`packages/prompt/src/assembly/hrsync/assemble.ts:59` 等）改直连 contract」
- 【真实情况】`packages/prompt/src/` 仅有 `assemble.ts / brief.ts / index.ts / layers.ts / sanitize.ts / trim.ts` 六件，无 `assembly/hrsync/`。真实消费者是 `apps/daemon/src/assembly/hrsync/assemble.ts:59-60`（`const redact = (text) => redactOutbound(text, knownSecrets)`）。同附录另外两处（§2.1 表「`assembly/hrsync/assemble.ts:15,59`」与 F-core-secrets 现状段）写的都是正确路径，仅此一处笔误为 `packages/prompt/src/...`。
- 【影响】低：包名前缀错误，行号与语义均指向真实文件；但按「路径可复算」口径（81-§六判据 1）该字符串不可复算，且 `prompt` 包确无此路径，易误导迁移执行者。
- 【建议】改为 `apps/daemon/src/assembly/hrsync/assemble.ts:59`（与其同卷另两处自洽）。

### 问题 2（P1）· 07-adapters 对 `resumeWithSession` 的「无编排证据」判断已被 HEAD 推翻（v0.5 真单刀漂移）

- 【定位】81-files/07-adapters.md §0.4：「**库级但未被主循环完整调用**：`DshAdapter.resumeWithSession`（装配侧只透传 `TaskBrief.resume`，没有 dsh 原生 id 的续跑编排证据）」
- 【真实情况】dev HEAD `868844d` 的 `apps/daemon/src/engine/merge/merge-run.ts` 已存在**生产编排证据**：`:214-215` 对 adapter 做 `resumeWithSession` 结构探测（缺面即明报降级），`:394-398` 在合并跑派发中 `resumeFn.call(adapter, taskBrief, plan.executorSessionId)`——用的正是 dsh 原生会话 id（`executor_session_id`，v13 列，`:124/:170` 注明「resumeWithSession 唤起凭据」）。且 07 附录自身在 §0.4 上一行引用了 `engine/merge/merge-run.ts:70`，说明作者读过该文件，判断与自引证据矛盾。`dsh.ts:303` 的 `session_resume: true`（studio-dev-230 P0，2026-10-23 翻转）附录 §2.1（:434）倒是如实记录了。
- 【影响】中：这是对**现状能力的低报**（把已接线判为「库级·未接」），方向与虚报相反，但违反 81-§四「现有=只描述实际代码与已核调用」的口径；若迁移规划据此把「续跑编排」当缺口排期，会重复建设。
- 【建议】§0.4 该条改为：「`resumeWithSession` 已由 `engine/merge/merge-run.ts`（合并跑相位）以 dsh 原生 id 编排（结构探测 + 缺面降级）；常规派发相位仍走 `TaskBrief.resume` 透传」。同时复核 16 卷（daemon-engine）对同一事实的说法是否同步。

### 问题 3（P2）· 04-company 两件超限件未给「拆分后文件清单」（81-§六判据 4 字面不符）

- 【定位】81-§六判据 4：「每个超限件有拆分后文件清单，未提高阈值或新增域平面散件」；81-§3.2：「store、company、adapters、panel 的 `lineBaseline` 超限件均给目标拆分与兼容面」。
- 【真实情况】`boundary-rules.mjs:177` 基线含 `packages/company/src/validator.ts: 655`（实测 612，>600 阈）；`04-company.md` 对它的处置是「目标-保留；规则体继续外移（已有六件）；基线 655 只许降；不得再长」——**没有**拆分后文件清单。同理 `test/repo-validate.test.ts`（766 行，基线 766）被明示「不新增测试文件，共同测试入口保留原位」。对照：同包 `repo-validate.ts`（1021）给了 `repo/` 4 件清单、`dependencies.ts`（775）给了 `dep-graph.ts` 外移方案，store/adapters/panel/taiga 的全部超限件均有清单。
- 【影响】低：ratchet（只许降）处置本身合规且不抬高基线，但判据 4 与 §3.2 的承诺在这两件上是字面落空；复审者无法据附录核对「拆到哪几件」。
- 【建议】要么补 validator 的预置拆分线（类似 02-core 对 evolution.ts 的「触 600 才执行」预案写法），要么在 81 主卷把判据 4 收窄为「基线值仍上升风险的超限件须给拆分清单」，二选一，不要两套口径。

### 问题 4（P2）· 03-store「`MIGRATIONS` v1–v13」表述略粗

- 【定位】81-files/03-store.md §2.1 表：`src/migrations.ts`「`MIGRATIONS` v1–v13 + `LATEST_VERSION` + `migrate`/`currentVersion` + `sha8`」
- 【真实情况】`migrations.ts` 实含 v1–v11 与 v13（`:44-536`），**v12 的 DDL 在 `src/cost.ts`**（附录自己的 cost.ts 行也写明「v12 迁移条目」）。跨文件拼合后 v1–v13 全集成立，卷内自洽，但单行表述会让人以为 13 条都在 migrations.ts。
- 【影响】极低：不构成事实错误（卷内另一行已澄清），仅表格粒度问题。
- 【建议】该行补注「（v12 条目在 `cost.ts`）」。

---

## 四、正面发现（区别于恭维的可复核事实）

1. **行数与计数的机械可复算性极高**：01/02/03/04/05/06/07/08/09/10/11/12/13/15 共约 150+ 个 `wc -l` 数值、52+56+394 个测试用例计数、`cases.json` 53 条域分布、`boundary-rules.mjs` 基线双值（1683/1684、732/785）全部精确命中——这是逐文件实读的产物，不是目录树抄写。
2. **目标/现状分离纪律执行到位**：`ports/{intent,secret,binding,record,work,...}.ts`、`IntentIngress`、`IntentReceiptStore`、`WorkIntake`、`openLedgerReadonly`、`intent_receipts` 全仓 grep 零命中（本次复算），与 01/03/14 附录「目标未落地、不得写成已有」的反复声明一致；14-api 对「43 行占位包」的自我描述与实测完全一致，未夸大。
3. **对自身缺陷的如实登记**：07 附录把 codex/kimi `session_resume:true` 静态声明与 78-§8.3 fail-closed 口径的冲突原样登记为待裁项而非掩饰；12-dsh-bridge 主动写明现状错误面无稳定码、不满足 80-§5.7/§5.8；05-prompt 公开记录 v0.2 用例 5 写错并修正。
4. **81-§五专项 15/15 有对应承载**（见上表专项列），81-§三处置标记逐文件齐全（15 份附录的现有件每件都有处置列），迁移顺序均带前置/回退/证据要求。

---

## 五、覆盖声明

- **文件清单核对**：15/15 附录 × 全量 src/test/配置/夹具，100% 覆盖（未抽样，逐包全列比对）。
- **行数核对**：01/02/03/04/05/06/07/08/09/10/11/12/13/15 全表比对；14-api 三件全比。
- **逐件深读抽核**：contract（runner/kernel/cases.json 统计）、core（decide/secrets/breaker 口径）、store（driver/migrations）、adapters（dsh/claude/codex/kimi capabilities 块 + daemon 侧 merge-run 消费面）、prompt（index/it 计数）、studio-tools（外部锚）——共 15+ 文件头注/导出面逐条；其余包为中密度（清单+关键行号+依赖面）。
- **专项与判据**：逐份以 grep+目录结构核对承载面。
- **核对所用命令均可复算**：`find`/`wc -l`/`grep -c '^\s*it('`/`node -e require('./cases.json')`/`grep -n boundary-rules.mjs`。

## 六、未能判定项（如实登记，不下结论）

1. **14-api 引用的 `panel/src/external/{index,server,views}.ts` 行数（48/571/201）**未逐值复核（本次只验证了 external 三件存在与 api 包现状）；`panel/src/server.ts:321-433` 的 `toWebRequest/forwardResponse/listenHono` 行号引用未复核。
2. **02-core §二「生产接线」列的 daemon 侧 import 行号**（如 `engine/engine.ts:205-218`、`assembly/serve.ts:69` 等）抽验了 3 处（hrsync/assemble、merge-run、prompt-assembly 间接），未全量复核——清单与行数已证其方法可靠，判断风险低。
3. **81-files/16–19 四份附录**（daemon/boot/root）不在 C4-a 范围（属 packages 外），其中与 07 相关的 merge-run 表述一致性需 C4-b/daemon 侧核对确认。
4. **各附录引用的 docs/75–80 行号锚**（如 `80:2175`、`78:1015`）属卷间一致性（C3/H 系列连接面），本连接未核。
5. `pricing.example.yaml`「全仓零读取（仅演示）」的声明未做全仓 grep 复算（仅有附录自证）。

---

## 七、结论

C4-a 连接判定：**15 份附录对 packages 真实源码的事实面总体成立**——清单 100%、行数/用例/基线数值近 100% 精确、目标与现状零混淆；仅 2 条 P1（1 处路径笔误、1 处被 v0.5 真单刀推翻的「无编排证据」判断）与 2 条 P2（判据 4 在 company 两件超限件上的字面缺口、1 处表述粗略）。修正这 4 条后，附录可作为「现有件」侧的可信施工依据；「目标件」侧的正确性归上位卷（75–80）审计与后续实现验证，不属本连接判分。
