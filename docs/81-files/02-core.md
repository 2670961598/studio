# 81-files/02 · `packages/core` 逐文件契约

> 版本：v0.7，2026-10-27。**v0.7 完成计数与 19 条审查对账**：目标新增 **28**、目标合计 **73**（45 现有 = 44 保留 + 1 替换；67 个具名文件条目 + 6 夹具）；直属 `src` 20/25、直属 `test` 19/25。补齐 `decimal`、完整 `RuleProfile`、`ReadinessResolved`、五门装配、金额/日界/脱敏/内部故障与包级类型门禁。§六 1–19 均有明确设计处置；所有目标文件与验证仍未实现，v0.5 的「53 → 71」只作历史计数。
> 性质：**自然语言级文件与实现设计呈审稿**，不是现行文件树、实现单或完成证明。
> 上位：75-§五 的文件契约模板与本卷主索引 §一/§二/§四；76-§1.5/§1.7/§1.8/§6（`DEF-RULE-01`…`DEF-RULE-10`、`DEF-DIAG-01`；§1.7 的字段名唯一性条款要求诊断用 `location`/`expected`/`actual`，不写 `path`、不收进 `safeDetails`）；77-§4.4.1（`REC-WORK-04` 13 字段与逐门 `judge_role` 列表）/§4.5.1（`REC-WORK-05.resource_reservations`）/§11.1（`FailureClass` 14 值）；78-§2/§4（工作区与时钟绑定）；79-§3.5/§3.6/§6.5（不发布包）/§9-D10；80-§2.1（core 节点）、§5.7（错误两轴、处置表、`Err` 可达 6 类 `category`）、§6.0/§6.1（`TS-PORT-RULE-01`：两段不合并、`RuleLimits` 七项全必填 + `RuleLimitTightening`、18 个登记码与码→相位映射、`Diagnostic` 判别联合）、§6.2（`TS-PORT-AUTH-01`…`AUTH-07`）、§6.4（`TS-PORT-WORK-03` 的 13 字段判决与五门角色列表；末节 `TS-PORT-RES-01 ResourceAccountant`）、§6.6（`TS-PORT-API-01`）、**§6.9（端口实现落点表）**、§9.4（`assembly/api/assemble.ts`）、§7.2（2e/2h/2i 与「两套映射」结论）/§7.3、§8.2（`openLedgerReadonly`）/§8.3/§8.6、§10.6、§11.2.1（秘密供给面）/§11.2-3（脱敏迁 `contract`）/§11.6、§12.3（`contract/src/ports/intent.ts`、`contract/src/ports/secret.ts` 两个指定落点）、§13.1 D13/D16/D17/D18/D24、§13.2 S6（82 的下游同步要求）；82-§10.3（MIG-03）/§14.3（`GAP-82-02`）。他卷落点：01-contract 的 `F-contract-port-intent`/`F-contract-port-secret`/`F-contract-schema-errors`/`F-contract-exchange-classified-error`；17-daemon 的 `F-daemon-intent-ingress`/`F-daemon-intent-receipt-store`/`F-daemon-api-assemble`。
> 边界：本附录只把 80 的组件与接口落到文件，**不新增公共概念、端口、状态、允许边或依赖版本**。发现 80 的缺口逐条登记在 §六，不在本附录私自补一套。**80-§6.9 明写「81 若与本表不一致，以本表为准并登记为 81 的改动项」**——本版据此把目录改单数 `rule/`，并新增 `spec/`、`authority/`、`resources/` 三个纯逻辑子域的全部文件条目。
> 门禁：本文所有「目标/新增/拆分/退役」均为设计处置，**尚未实施**；不得据此改源码、manifest、guards 或测试。
> 标签（81-§四）：`现有` / `库级·未接` / `目标-保留` / `目标-拆分` / `目标-新增` / `目标-替换` / `目标-退役` / `仅测试` / `仅演示` / `未证`。

---

## 〇、本附录的范围与复算口径

覆盖 `packages/core` 的全部第一方文件：

| 类别 | 件数 | 复算方式 |
|---|---|---|
| 生产源码 `src/*.ts` | 18 | `ls packages/core/src/*.ts`（无子目录） |
| 测试代码 `test/*.ts` | 17（含 1 件测试构件 `helpers.ts`） | `ls packages/core/test/*.ts` |
| 测试夹具 `test/golden/*.json` | 6 | `ls packages/core/test/golden/*.json` |
| 包配置与示例 | 4 | `package.json`、`tsconfig.json`、`models.example.yaml`、`pricing.example.yaml` |
| **现有合计** | **45** | 18 + 17 + 6 + 4 |
| **目标替换** | **1** | `src/secrets.ts`：实现迁 `contract`，本件转具名再导出（80-§11.2-3） |
| **目标新增** | **28** | src 17 件（`decimal.ts` 1 + `work-readiness.ts` 1 + `rule/` 5 + `spec/` 3 + `authority/` 5 + `resources/` 2）+ test 11 件（`decimal.test.ts` 1 + `work-readiness.test.ts` 1 + `test/rule/` 3 + `test/spec/` 2 + `test/authority/` 2 + `test/resources/` 2）（§三） |
| **目标合计** | **73** | 35 生产源码（18 + 17）+ 28 测试（17 + 11）+ 6 夹具 + 4 配置 = 73 = 44 保留 + 1 替换 + 28 新增 + **0 拆分** + **0 文件退役** |

以 2026-10-27 实测行数（`wc -l`）为规模基线，只作核对，不作能力证据。16 个含用例的测试文件共 **394** 个 `it(` 用例（`grep -c '^\s*it('` 求和）；`helpers.ts` 零用例。新增 11 个测试件的用例数**未定**（§5.11 只给覆盖面与行数上限），不得预先计入该 394。

排除：`.git`、`node_modules`、`dist` 与生成物；根 `package.json`/`bun.lock`/根 `tsconfig`/guards 归 `81-files/19-root-guards-templates.md`；`packages/contract` 的类型归 `81-files/01-contract.md`；`@studio-next/core` 在 daemon 的装配与消费归 `81-files/16`/`17`；`store/src/resources/`、`store/src/lease/` 与 `assembly/spec/`、`assembly/auth/` 归 03/17（本卷只在 §5.12 登记接缝）。

---

## 一、包身份与边界

### 1.1 身份

| 项 | 值 | 依据 |
|---|---|---|
| 包名 | `@studio-next/core` | `packages/core/package.json` |
| 版本 | `0.1.0`，`private: true` | 同上 |
| 层位 | **1**（`contract` 0 → `core` 1 → `store` 2 → `company` 3） | `scripts/guards/boundary-rules.mjs` 的 `packageLayers`；80-§2.1 |
| 目标语义 | 「不变；补五组纯逻辑落点——规则求值 `rule/`、开工五门 `work-readiness.ts`、定义规格 `spec/`、权威判定 `authority/`、资源只读评估 `resources/`」；脱敏实现迁 `contract` | 80-§2.1 core 行；**80-§6.9 落点表**；80-§7.2 2h；80-§11.2-3 |
| 模块形态 | `type: "module"`，ESM，Node 24 LTS 原生 type-stripping 直跑 `.ts` | 79-§4 |
| 入口 | `main: "src/index.ts"`；`exports: { ".": "./src/index.ts" }` | 79-§6.5「其余 12 个不发布包」的源码态导出 |
| 发布 | **不发布**：无 `files` 白名单、无 `publishConfig`、无 build 脚本 | 79-§5.2/§6.5 |
| 构建 | **不进构建**：不产 `dist`、不产 `.d.ts`；消费方直接 import `.ts` | 79-§6.5 |
| 包级类型门禁 | `tsc --noEmit -p tsconfig.json`，`include: ["src/**/*.ts","test/**/*.ts"]` | `packages/core/tsconfig.json` |
| 目录额度 | `src` 直属 18/25 → **20/25**（只加 `decimal.ts` 与 `work-readiness.ts`，其余新增全部进子目录；80-§6.9 明确五门唯一落点）；`test` 直属 17/25 → **19/25**（加 `decimal.test.ts` 与 `work-readiness.test.ts`）；目标新增 `src/rule` 5/25、`src/spec` 3/25、`src/authority` 5/25、`src/resources` 2/25、`test/rule` 3/25、`test/spec` 2/25、`test/authority` 2/25、`test/resources` 2/25；`test/golden` 6/25 | `maxFilesPerDirectory = 25`（按目录直属文件计） |
| 行数额度 | 最大件 575 行（`evolution.ts`）< 600；**`lineBaseline` 中无任何 core 条目** | `boundary-rules.mjs` 的 `lineBaseline` |

### 1.2 允许边与禁止边

〔事实〕`allowedPackageEdges` 中与 core 相关的只有 **`["core","contract"]`**；`["store","core"]` 存在，方向是 store 读 core，core 不得反向读 store。core 的实际 import 面（实测全部 18 个 src 文件）为五类：`@studio-next/contract`、`node:crypto`（仅 `models.ts` 与 `judge.ts` 的 `createHash`）、`yaml`（`models.ts`、`pricing.ts`）、`zod`（同两件）、包内相对路径。

〔结论〕允许依赖（**不新增外部依赖**）：

- `@studio-next/contract`：值导出 `configInvalid`、`BILLING_TRACKS`；其余全部为 `import type`。目标态另加脱敏三函数（`redactOutbound`/`redactKnownSecrets`/`findSecretShaped`）：`secrets.ts` 的实现按 80-§11.2-3 迁入 `contract`，`core` 只做具名再导出。**四个新子域不引入新的值导出**：`rule/`、`spec/`、`authority/`、`resources/` 只 `import type`（`RuleProfile`/`RuleProfileRef`/`RuleInputDecl`/`RuleInput`/`RuleLimits`/`RuleLimitTightening`/`RuleOutcome`/`TypecheckReceipt`/`Diagnostic`/`SpecEntry`/`DefinitionBundle`/`AuthorityRequirement`/`CandidateEndpoint`/`ResourceLimit`/`ResourceEntry`/`ResourceBaseline`/`ResourceGap`/`RecReadinessJudgment`/`ReadinessRequest`/`GateResult`/`ReadinessCondition`/`DecisionFacet`/`DissentPosition`/`DecimalString` 等）。
- `yaml`、`zod`：只用于**把外部文本解析成输入**（`models.yaml`、`pricing.yaml`），不参与求值语义；新子域一律不 import 二者（档/定义的解析归装载层与 contract）。
- `node:crypto`：只用于内容指纹（`createHash('sha256')`），不产生秘密、不读密钥。目标态新增两处用途：`rule/evaluator.ts` 算 `inputsDigest`、`spec/loader.ts` 算各 part 的 `byteDigest`（**都只做摘要，不做键派生/加解密**）。
- 包内相对导入（现有）：`decide → breaker/flows`、`golden → decide`、`costclose → pricing/cost-insights`、`cost-insights → costclose`（**纯类型环**，仅 `import type`，运行期无环）、`costguard → pricing`、`judge-gates → models`。
- 包内相对导入（目标新增，**唯一许可的十一条**，其余新子域互不 import）：`rule/operators → rule/values`、`rule/operators → rule/pattern`、`rule/pattern → rule/values`（码点工具）、`rule/typecheck → rule/operators`、`rule/typecheck → rule/values`（类型/标度检查）、`rule/evaluator → rule/operators`、`rule/evaluator → rule/values`（限额/标度检查）、`rule/values → decimal`（共享有理数）、`resources/quota → decimal`（同一实现）、`spec/importer → spec/registry`（冲突检测读注册表）、`resources/baseline → resources/quota`。`work-readiness` 只吃 contract 类型，**不** import `rule/*` 与 `resources/*`；`authority/` 五件**互不 import**（组合在端口层）；`resources/*` **不** import `rule/*`（两套值语义不同，见 §3.4 与 §六-17）。

〔禁止〕`node:fs`、`node:fs/promises`、`node:path`、`node:child_process`、`node:net`、`node:http`、`process.env`、`fetch`、`Date.now`、无参 `new Date()`、`Math.random`、`crypto.randomUUID`、任何 `@studio-next/*` 包（`contract` 除外）。唯一例外是 `costguard.localDateKey(ms)` 的 `new Date(ms)`：它是显式入参毫秒，但会取宿主本地年月日，因此仍与 `76-§6.11` 有张力（登记 §六-8）。其余 src 无一处违反（`grep` 实测：上述符号只出现在注释文本里）；目标新增的四个子目录必须保持同一禁令——**读盘、扫包、路径 containment、租约持久化、记录追加一律不在 core**（80-§6.9 选点规则 4）。

〔说明〕`store` 的测试（`test/v9-pricing.test.ts`、`test/v5-candidates.test.ts`）import core，这是允许边 `store→core` 的测试用法；core 侧不得因此假设 store 存在。

### 1.3 core 是什么、不是什么

- **是**：可被单测直接覆盖的纯决策与纯折算面对——状态流表、`decide`、断路器、错误处置表、预算折叠/预留/结算、价目与成本折算、成本警戒与日终收口、员工队列排序、人事变动分类、micro-judge 原语、候选谱系与判负；目标是再加**五组纯求值/纯判定**：封闭 `Rule Profile` 求值（`src/rule/` 五件）、开工五门（`src/work-readiness.ts`）、定义规格的注册/装载/导入**纯决策**（`src/spec/` 三件）、权威的需求/候选/激活判定/授予链/失能（`src/authority/` 五件）、资源额度与缺口**只读派生**（`src/resources/` 两件）。
- **不是**：不是状态机的**唯一事实源**（77 的 WorkLifecycle 十态与 T01–T26 在 77，`flows.ts` 只是平台侧流表镜像）；不是事务与落账层（store 唯一）；不是装配层（时钟、ID、随机、目录、凭据一律由调用方注入）；不是公司目录的一份副本。
- **纯求值不是端口**：`RuleEvaluator`、`ReadinessGate`、`SpecRegistry`/`DefinitionLoader`/`PackageImporter`、`TS-PORT-AUTH-01`…`07`、`TS-PORT-RES-01` 的端口形状都是异步 `Result`（解析版本化引用、读盘、落记录）；core 只提供其中**同步纯核**：输入已解析、输出判决/派生值 + 诊断。端口包装、引用解析、读盘、记录装配与持久化都在调用方（80-§6.1/§6.4/§6.9、§7.2 2h）。
- **资源面只读，不是账目事实源**：`core/src/resources/` 只派生「额度 / 占用 / 剩余 / 缺口」，**没有** `reserve`/`actual`/`release` 公共写口、不新增 `REC-*`、不新增写入者。预留写 `REC-WORK-05.resource_reservations`（计划锁同事务）、实际写 `REC-EVD-01`/`REC-EVD-05`、释放写 `REC-EVD-06`，投影表 `resource_ledger` 归 store（80-§6.4 末、77-§4.4.1/§4.5.1）。
- **契约公共形状不在 core**：`IntentKey`/`IntentReceipt`/`IntentSubmissionPort`（`contract/src/ports/intent.ts`）、`SecretCatalogEntry`/`SecretProvider`/`SecretMaterial`/`KnownSecretSet`（`contract/src/ports/secret.ts`）、`RuleOutcome`/`Diagnostic`/`FailureClass`/`ClassifiedError` 二轴（`contract`）、`ReadinessRequest`/`GateResult`/`RecReadinessJudgment`（`contract/src/ports/work.ts`，80-§6.9）、`ResourceBaseline` 族（`contract/src/ports/resources.ts`）、`SpecEntry`/`DefinitionBundle`（`contract/src/ports/spec.ts`）、`AuthorityRequirement`/`CandidateEndpoint`（`contract/src/ports/authority.ts`）与 `PlatformBinding`/`mapState`（contract/company）都不是 core 的家；core 只 `import type`，**不复制字段表、不另立同名类型**（80-§12.3 已指定两个文件落点，81 不得另起路径）。
- **错误面只经 `ClassifiedError`，且 core 侧 `Err` 面窄**：`failure` 是处置轴、`category` 是观测轴（80-§5.7）；core 不产生 `NO_LANE`（本包没有「显式泳道错误」通道——泳道闸只回 `Action`，不回错），也不产生 `GATE_FAIL`/`WORKER_DEAD`/`QA_BACK`/`DISPATCH_FAIL`/`LLM_FAIL` 五个只属内部事件域的 `category`。core 现有构造器在 80-§5.7 生效后必须补 `failure`（见 §四.5 与各件条目）。
- **脱敏不是 core 的实现责任**：脱敏算法归 `contract`（80-§11.2-3），core 只保留具名再导出；「出站前必调」的强制点在 daemon/gateway/api/panel 的出站路径，core 不提供转发包装、也不声明「已覆盖」。
- **公司纯配置与可执行能力包分开**：公司是数据与定义（76/78 绑定、`81-files/04`），core 只接收**已解析**的入参（`CompanySnapshot`、`ModelsConfig`、`PricingTable`、`RuleInput`、五组带版本引用），不读目录、不做目录结构校验、不持有公司标识的默认值。
- **DSH 对外只提供 JS + `.d.ts`**：对 core 为 **N/A**。理由：core 不发布、无构建、无 `dist`，消费方是同仓 TS workspace，经 `exports["."] = ./src/index.ts` 走源码态；能力包的 `.d.ts` 交付面归 `81-files/07`/`12`，与 core 无关。
- **API 说明**：**N/A**。core 无 HTTP/网络面、无端口、无路由、无认证；`:8791`/`:8789` 归 `panel`，`:8788` 归 `api`（80-§9.4）。core 只在进程内被函数调用。
- **可观测面**：core 不写事件、不写日志、不建指标；它返回**结构化结果**（诊断、refusal 原因、资源缺口、报告体）由 daemon 决定是否入账。

### 1.4 门禁现状与已知缺口

1. 根 `tsconfig.json` 只 `include` `apps/*/src/**/*.ts` 与 `packages/*/src/**/*.ts`；根 `bun run typecheck` 只跑 `tsc --noEmit`，**不串联包级脚本**。因此 `packages/core/src/**` 在根门禁内，`packages/core/test/**` **不在**（79-D10）。包级 `tsc -p packages/core/tsconfig.json` 覆盖 test，但它不是主门禁的一环。
2. `bun run guard:boundaries` 扫描 `apps/*`、`packages/*` 的 `src` 与 `test`：依赖方向、25/600、`lineBaseline` 三者对 core 均已成立；core 无域平面基线（域平面是 daemon 的内部约束），因此新增 `src/rule/`、`src/spec/`、`src/authority/`、`src/resources/` 与对应 `test/` 子目录**不触发平面冻结**；但每个子目录自身仍受 25 件上限约束（目标最大者为 5 件）。
3. **拆分计数为 0** 的理由：`lineBaseline` 无 core 条目，且 18 个 src 件的最大值为 575（`evolution.ts`），新增件的规模上限均 ≤420（`src` 件 ≤400、`evaluator.test.ts` 420）。本卷不设强制拆分；同时**不得**把任何新超限件塞进基线（基线只减不增，`20-§十五.三.3`）。
4. 目标新增 `test/rule/`、`test/spec/`、`test/authority/`、`test/resources/` 与 `test/work-readiness.test.ts` 继承缺口 1：在 82 立「core 测试目录纳入根门禁」项之前，新测试的类型正确性只有包级 `tsc` 能证明，**不得**声称已被根 typecheck 覆盖。受影响的测试件从 3 件增至 **10 件**（27 个测试文件全部不在根门禁内）。

---

## 二、现有件全集（45）

### 2.1 生产源码 18 件

「生产接线」列是 2026-10-27 实测的 `apps/daemon/src` import 落点；无落点者按实际标 `库级·未接` 或 `仅测试`，不把「存在于 src」当成已具备能力。

| 稳定 ID | 路径 | 行数 | 生产接线（实测） | 状态 |
|---|---|---|---|---|
| `F-core-index` | `src/index.ts` | 109 | 包根 barrel：59 个第一方文件经 `@studio-next/core` 导入（daemon src 31、daemon test 26、store test 2） | 现有 |
| `F-core-flows` | `src/flows.ts` | 257 | `engine/typeflows.ts:14`、`engine/split/materialize.ts:37`、`engine/merge/merge-run.ts:69`、`engine/sentinel/sentinels.ts:34`、`engine/intents/drain.ts:24`、`assembly/serve.ts:69` | 现有 |
| `F-core-decide` | `src/decide.ts` | 511 | `engine/engine.ts:205-218`（`decide`/`Action`/`ConcurrencyLimits`）、`engine/intents/drain.ts:27`（`intentKeyOf`）、`engine/tick-report/types.ts:10`（类型） | 现有 |
| `F-core-breaker` | `src/breaker.ts` | 147 | `engine/engine.ts:205-218`（5 个函数 + `BreakerState`） | 现有 |
| `F-core-dispositions` | `src/dispositions.ts` | 77 | 无代码 import；`engine/engine.ts:72,386,1467,1530`、`engine/sentinel/events-index.ts:34` 只在注释里引用其语义 | 现有（库级·未接） |
| `F-core-golden` | `src/golden.ts` | 76 | 无生产 import；仅 `test/golden.test.ts` | 现有（仅测试） |
| `F-core-models` | `src/models.ts` | 314 | `assembly/serve.ts:69`（`parseModelsYaml`/`createModelCatalog`/`fingerprint`） | 现有 |
| `F-core-budget` | `src/budget.ts` | 494 | `engine/budget-gate.ts:62-68`（`budgetView`/`foldBudgets`/`reserve`/`settle`）、`engine/cost-guard/fold.ts:19-23` | 现有 |
| `F-core-evolution` | `src/evolution.ts` | 575 | `evolve/gray.ts:82`、`evolve/sandbox.ts:85`、`evolve/cutover.ts:93`（三处只 `transitionCandidate`）、`evolve/evolve-guard.ts:47`（`assertChangeAuthorized`） | 现有（局部接线） |
| `F-core-hrsync` | `src/hrsync.ts` | 193 | `engine/hrsync/hrsync.ts:27`、`engine/hrsync/people-change-source.ts:27`、`assembly/hrsync/assemble.ts:15` | 现有 |
| `F-core-secrets` | `src/secrets.ts` | 80 | 仅 `assembly/hrsync/assemble.ts:15,59`（`redactOutbound`）；`redactKnownSecrets`/`findSecretShaped` 无生产消费者 | 现有（局部接线）→ 目标-替换（实现迁 `contract`，本件转具名再导出） |
| `F-core-judge` | `src/judge.ts` | 279 | `engine/judge/invoke.ts:39-55`（`parseJudgeVerdict`、`judgeVocabFingerprint`）；`assertJudgeVocab` 只在 core 测试与 `invoke.ts:93` 注释里出现，生产未调用 | 现有（局部接线） |
| `F-core-judge-gates` | `src/judge-gates.ts` | 288 | `engine/judge/invoke.ts:39-55`（帽子/降级/按址熔断/拍闸共 13 个符号）、`engine/judge/sites129.ts:39`（类型）、`assembly/serve.ts:69`（`assertJudgeRoleLow`） | 现有 |
| `F-core-queue` | `src/queue.ts` | 102 | `engine/todoqueue/queue.ts:37-45`（`ageBoostTier`/`clampPriority`/`DEFAULT_QUEUE_AGE_STEP_MS`/`rankQueue`/`QueueRanker`）、`engine/engine.ts:307` | 现有 |
| `F-core-pricing` | `src/pricing.ts` | 450 | `engine/pricing/pricing.ts:26-31`、`engine/cost-guard/fold.ts:19-23`（`bridgePriceFor`/`foldCostUsd`/`parseModelKey`）、`engine/cost-close/close.ts:24` | 现有（局部接线） |
| `F-core-costguard` | `src/costguard.ts` | 179 | `engine/cost-guard/usage.ts:14`、`engine/cost-guard/source.ts:37`、`engine/cost-guard/harvest.ts:15`、`engine/cost-guard/fold.ts:21` | 现有 |
| `F-core-costclose` | `src/costclose.ts` | 455 | `engine/cost-close/close.ts:43-54`（常量再出口 + 4 函数 + 3 类型） | 现有 |
| `F-core-cost-insights` | `src/cost-insights.ts` | 175 | 经 `engine/cost-close/close.ts:43`（`costInsights`）间接触达 | 现有 |

### 2.2 测试代码 17 件

| 稳定 ID | 路径 | 行数 | 用例数 | 被测件 | 状态 |
|---|---|---|---|---|---|
| `F-core-test-helpers` | `test/helpers.ts` | 67 | 0（构件） | `decide`/`flows` 的输入构造器 | 现有（仅测试） |
| `F-core-test-breaker` | `test/breaker.test.ts` | 140 | 13 | `breaker` | 现有（仅测试） |
| `F-core-test-budget` | `test/budget.test.ts` | 576 | 50 | `budget` | 现有（仅测试） |
| `F-core-test-costclose` | `test/costclose.test.ts` | 291 | 19 | `costclose` | 现有（仅测试） |
| `F-core-test-costguard` | `test/costguard.test.ts` | 140 | 13 | `costguard` | 现有（仅测试） |
| `F-core-test-decide` | `test/decide.test.ts` | 508 | 60 | `decide` + `flows` | 现有（仅测试） |
| `F-core-test-dispositions` | `test/dispositions.test.ts` | 80 | 8 | `dispositions` | 现有（仅测试） |
| `F-core-test-evolution` | `test/evolution.test.ts` | 576 | 54 | `evolution` | 现有（仅测试） |
| `F-core-test-flows` | `test/flows.test.ts` | 233 | 27 | `flows` | 现有（仅测试） |
| `F-core-test-golden` | `test/golden.test.ts` | 80 | 6 | `golden` + 6 个夹具 | 现有（仅测试） |
| `F-core-test-hrsync` | `test/hrsync.test.ts` | 143 | 13 | `hrsync` | 现有（仅测试） |
| `F-core-test-judge-gates` | `test/judge-gates.test.ts` | 214 | 23 | `judge-gates` | 现有（仅测试） |
| `F-core-test-judge` | `test/judge.test.ts` | 192 | 20 | `judge` | 现有（仅测试） |
| `F-core-test-models` | `test/models.test.ts` | 396 | 40 | `models` + `models.example.yaml` | 现有（仅测试） |
| `F-core-test-pricing` | `test/pricing.test.ts` | 255 | 18 | `pricing` | 现有（仅测试） |
| `F-core-test-queue` | `test/queue.test.ts` | 115 | 17 | `queue` | 现有（仅测试） |
| `F-core-test-secrets` | `test/secrets.test.ts` | 77 | 13 | `secrets` | 现有（仅测试） |

### 2.3 测试夹具 6 件（`test/golden/*.json`）

| 稳定 ID | 文件 | 内容 | 消费者 |
|---|---|---|---|
| `F-core-golden-normal-dispatch-chain` | `normal-dispatch-chain.json` | 正常派发链的 decision trace（L0 新单 → 派发） | `golden.test.ts` |
| `F-core-golden-breaker-trip-chain` | `breaker-trip-chain.json` | 断路器连击触发熔断链 | `golden.test.ts` |
| `F-core-golden-breaker-half-open-chain` | `breaker-half-open-chain.json` | 冷却后半开/复位链 | `golden.test.ts` |
| `F-core-golden-dedup-chain` | `dedup-chain.json` | 同意图重复投递的去重链 | `golden.test.ts` |
| `F-core-golden-gates-approval-chain` | `gates-approval-chain.json` | 审批闸命中链 | `golden.test.ts` |
| `F-core-golden-person-gate-chain` | `person-gate-chain.json` | 人闸（`personGate`）阻塞链 | `golden.test.ts` |

### 2.4 包配置与示例 4 件

| 稳定 ID | 文件 | 行数 | 作用 | 状态 |
|---|---|---|---|---|
| `F-core-package-json` | `package.json` | — | 包身份、源码态导出、依赖三项、两个私有脚本 | 现有 |
| `F-core-tsconfig` | `tsconfig.json` | — | 包级 `tsc`（src + test 一并纳入） | 现有 |
| `F-core-models-example` | `models.example.yaml` | 31 | **测试语料**：`models.test.ts:20` 用 `readFileSync` 读取，断言五角色映射全命中 | 现有（仅测试） |
| `F-core-pricing-example` | `pricing.example.yaml` | 52 | **仅演示**：全仓零代码、零测试读取 | 现有（仅演示） |

---

## 三、目标件全集与计数

### 3.1 处置汇总

| 处置 | 件数 | 明细 |
|---|---|---|
| 目标-保留 | 44 | §二 中除 `secrets.ts` 外的全部现有件（其中 `index.ts` 有导出面变更，见 `F-core-index`） |
| 目标-拆分 | **0** | 无超 600 行件、无 `lineBaseline` 条目；且**不得**为此新增基线 |
| 目标-新增 | 28 | **src 17**：`decimal.ts`、`work-readiness.ts`；`rule/typecheck.ts`、`rule/evaluator.ts`、`rule/values.ts`、`rule/operators.ts`、`rule/pattern.ts`；`spec/registry.ts`、`spec/loader.ts`、`spec/importer.ts`；`authority/requirement.ts`、`authority/candidates.ts`、`authority/activation.ts`、`authority/grant.ts`、`authority/incapacity.ts`；`resources/quota.ts`、`resources/baseline.ts`。**test 11**：`decimal.test.ts`、`work-readiness.test.ts`；`test/rule/{typecheck,evaluator,pattern}.test.ts`；`test/spec/{registry,importer}.test.ts`；`test/authority/{activation,grant}.test.ts`；`test/resources/{quota,baseline}.test.ts` |
| 目标-替换 | 1 | `src/secrets.ts`：实现迁 `contract/src/secrets.ts`（80-§11.2-3），本件保留三条具名再导出；不得留第二套实现或第二份正则 |
| 目标-退役 | **0 件文件** | 仅 `src/index.ts` 的 `PACKAGE_STATUS` **常量**标目标-退役（见该条，删除须批示） |
| **合计** | **73** | 44 + 1 + 28 |

〔口径〕`rule/` 五件与 `spec/` 三件、`authority/` 五件、`resources/` 两件**都只做同步纯函数**；同名端口的 `Promise<Result<…>>` 形状与持久化分别在 contract 与 daemon/store（80-§6.9 选点规则 1/2/3/4）。目录名以 80-§6.9 为准（`rule` 单数），本卷此前写作 `rules/` 属与上位不一致，按「以本表为准」登记为 81 的改动项（§六-18 一并记入 82 的未同步项）。

### 3.2 目标目录预算

| 目录 | 现有 | 目标 | 上限 | 结论 |
|---|---|---|---|---|
| `packages/core/src/` | 18 | **20** | 25 | 宽裕 5（新增 `decimal.ts` 与 `work-readiness.ts`） |
| `packages/core/src/rule/` | — | 5 | 25 | 新目录；80-§6.9 落点 |
| `packages/core/src/spec/` | — | 3 | 25 | 新目录；80-§6.9 落点 |
| `packages/core/src/authority/` | — | 5 | 25 | 新目录；80-§6.9 落点 |
| `packages/core/src/resources/` | — | 2 | 25 | 新目录；80-§6.9 落点 |
| `packages/core/test/` | 17 | **19** | 25 | 宽裕 6（新增 `decimal.test.ts` 与 `work-readiness.test.ts`） |
| `packages/core/test/rule/` | — | 3 | 25 | 新目录 |
| `packages/core/test/spec/` | — | 2 | 25 | 新目录 |
| `packages/core/test/authority/` | — | 2 | 25 | 新目录 |
| `packages/core/test/resources/` | — | 2 | 25 | 新目录 |
| `packages/core/test/golden/` | 6 | 6 | 25 | 不变 |
| 单文件最大行数 | 575 | 575 | 600 | 不变（新增件上限最大 420，仅测试件） |

### 3.3 拆分与阈值立场

- 无强制拆分。`decide.ts`（511）与 `evolution.ts`（575）虽接近 600，但**本轮不拆**：拆分会动 import 面与测试路径，属于「只搬到新文件」的重构，收益不足以抵消验证成本。
- `evolution.ts` 的**预置拆分线**（仅在触 600 时执行，当前未实施）：`src/evolution/lineage.ts`（`CandidateRecord`/`proposeCandidate`/`lineage`/`candidatesById`）、`src/evolution/gate.ts`（`gate`/`GATE_*`/`transitionCandidate`/`decisionToStatus`/`applyGateDecision`/`makerRuling`）、`src/evolution/authorize.ts`（`assertChangeAuthorized`/`NearMiss`/`ChangeRejectedError`），`evolution.ts` 降为再导出 facade。执行前必须先征得批示，并按 `81-§3.2`「先解类型环，再拆行为」。若届时 `src/` 直属因 `work-readiness.ts` 升到 19 件，该拆分需落在 `src/evolution/` 子目录，不得再加直属文件。
- `decide.ts` 触 560 时的第一处置是**压缩头注与注释**，不是拆文件；若要拆，`breakerTripped`/`breakerCooled` 可并入 `breaker.ts`（两者只被 `decide` 内部使用），但会改变导出宿主，须单独立单。
- `rule/typecheck.ts` 与 `rule/evaluator.ts` **不得再合并**为一个文件（80-§6.1「两段不合并」的文件级落实）；也不得把 `typecheckNode` 从 `operators.ts` 挪回任一入口文件——那会形成「同一棵树两个遍历实现」。
- **不得**把任何新超限件写入 `lineBaseline`；该表只减不增。

### 3.4 不新增依赖

新增的 16 个 src 件合起来的依赖面只有：`@studio-next/contract`（类型）、包内相对导入（九条，见 §1.2）、`node:crypto`（`rule/evaluator.ts` 的 `inputsDigest`、`spec/loader.ts` 的 part 摘要）。**不引入**十进制库、正则库、解析器库、Zod 之外的校验器、路径库、文件系统库。

两套十进制值语义分开，但**精确算术只有一个实现**：

- `rule/values.ts` 的 `Dec` 是 76-§6.4 的**封闭值类型**（值 + 标度、34 位有效数字 / 9 位标度、加减乘除取模、转换白名单、错误码 `E-RULE-004`/`E-RULE-008`）。
- `resources/quota.ts` 的 `DecimalString` 是 80-§4.1 `TS-SCALAR-04` 的**规范化字符串标量**（可选负号、无前导零、禁指数），资源面使用加减与比较。
- 两者的类型、取值范围和规则专用转换不得混用；`resources/*` 不 import `rule/values.ts`，`rule/*` 也不把资源字段当 `Dec`。共同的十进制有理数、舍入与溢出算法只在 **`core/src/decimal.ts`**（76-§1.2.1、80-§5.11），两边分别调用，不保留第二份浮点或 BigInt 算术。`DecimalString` 的算术与舍入已有上位定义，§六-17 由“缺定义”改为“定义已定、实现未做”。

`rule/pattern.ts` 按 `76-§6.10` 的模式子集用自制线性 NFA 实现，**禁调用宿主 `RegExp`**（宿主正则的语义与线性时间承诺都不满足「与线性 NFA 接受/拒绝完全一致」）。`work-readiness` 不新增任何依赖：它只吃带版本引用与已解析判据，不读目录、不调 `RuleEvaluator`（是否复用见 §六-15）。

---

## 四、跨文件纪律（逐条适用于本附录全部 73 件）

1. **依赖方向**：只允许 `core → contract` 与包内相对导入；禁止 `core → store/company/daemon/panel/api/gateway/adapters`。`store→core` 是别人的边，core 不据此假设任何 store 形状。
2. **零 IO**：src 内不读文件、不读 env、不开网络、不起子进程、不读时钟、不扫目录、不开库。时间的唯一来源是调用方传入的 `now` 毫秒或已声明的日历参数；ID 由调用方给；随机不存在。四个新子域同样如此：读盘在 `assembly/spec/`、租约与围栏持久化在 `store/src/lease/`、记录追加在 store 的写域。
3. **`node:crypto` 的白名单用途**：只做内容指纹（`createHash('sha256')`）。禁止用它生成随机、做密钥派生、做加密。
4. **解析与语义分离**：`yaml`/`zod` 只出现在把文本变输入的边界（`models.ts`、`pricing.ts`）；它们产出的对象必须再经本包的形状检查，不得把 Zod 的报错文本当诊断码。定义档案的解析归装载层（`assembly/spec/`）与 contract，不在 `spec/` 纯逻辑里。
5. **错误口径（两轴一个载体，80-§5.7）**：`ClassifiedError = { failure: FailureClass; category: ErrorCategory; subcause: string; detail?: string }`。`failure` 取 77-§11.1 的 14 个**下划线原值**（`rejected_precondition`…`degraded`），是**处置轴**——重试、断路、对账、升级、判等一律读它；`category` 取 `ErrorCategory` 11 值，是**观测轴**——只喂事件 note 与告警分桶，不驱动业务处置。三条硬约束：
   - **`Err` 可达的 `category` 只有 6 个**：`CONFIG_INVALID`/`EVOLVE_REJECT`/`EXTERNAL_REJECT`/`STALL`/`MERGE_CONFLICT`/`NO_LANE`。`GATE_FAIL`/`WORKER_DEAD`/`QA_BACK`/`DISPATCH_FAIL`/`LLM_FAIL` 属内部事件与熔断域，**不得**从 `Err` 选（构造器拒收、负向测试锁住）。
   - **缺省 `category` 由 `failure` 推出**：`rejected_precondition`→`CONFIG_INVALID`；`rejected_authority`/`rejected_forbidden`/`rejected_state`/`rejected_idempotency`→`EXTERNAL_REJECT`；`rejected_version`/`unsupported`/`unverified`→`EVOLVE_REJECT`；`unavailable`/`partial`/`timeout`/`cancelled`/`degraded`→`STALL`；`conflict`→`EXTERNAL_REJECT`（仅合并域显式写 `MERGE_CONFLICT`）。`NO_LANE` 只有**显式泳道上下文**（泳道入口/派工闸）才可写——core 没有这个上下文，故 core 侧永不产生它。
   - **语义判定不是失败**：`RuleOutcome` 四值（`refused` 留 `Ok`）、`ReserveResult` 的 refusal、`GateDecision` 的 `escalate`、五门的三值 `verdict`、`ResourceBaseline.gaps` 非空都留在成功返回里，既不得改写成 `Err`，也不得把 `Err` 折成 `false`/「通过」。
   core 侧的迁移项（现状只设 `category`，目标态必须补 `failure`）：`budget.budgetInvalid`、`judge.configInvalidJudge`、`judge-gates.assertJudgeRoleLow`、`evolution.ChangeRejectedError`、`pricing` 经 `configInvalid` 的解析/校验失败 → 一律 `failure:'rejected_precondition'`；`judge.judgeLlmFail` 现设 `category='LLM_FAIL'`，该值在新口径下**不得从 `Err` 选**，须改判为具体 `failure`（`unavailable` 或 `degraded`，见 §六-16），裁决前登记为缺陷、**不得**复制到新代码。旧按 `category` 分支的处置（`dispositions.ts`）保留为**缺省档**，只在 `failure` 缺位时生效。**断路器的「同错」判等键**现状是调用方自拼的自由串（`harvest:--rg`/`stall:watchdog-kill`，见 §5.2 `breaker`），不在 `Err` 载体里，也须一并迁到 `failure`+`subcause`（§六-16）。
6. **秘密纪律**：秘密只作为参数进入（`knownSecrets`、凭据值），不落返回值、不落诊断、不落报告体；诊断只放码、字段路径（`location`）、限额数值与 `expected`/`actual` 短文本。
7. **不可变**：所有状态入参 `readonly`，函数返回新对象；不修改入参、不使用模块级可变缓存（现有 `DEFAULT_*` 常量是冻结值，只读）。`spec/registry.ts` 的注册表是**值**（返回新集合），不是模块级单例。
8. **确定性**：同输入必同输出。禁止依赖 `Map`/对象键的插入顺序做判定；需要排序时显式按稳定键排序（`76-§6.11`）。资源基线的同一 `(subjectRef, quotaRef, asOf)` 重算必须逐字段一致（80-§6.4 末）。
9. **复用而非复制规范**：76/77/80 已定义的字段与签名，条目里只写「承载哪个对象 + 本文件特有约束」，不复制同义 schema；一旦两边不一致，改上位卷，不在文件里兼容两种说法。
10. **两类纯求值同形**：`rule/`（`Rule Profile`）与 `work-readiness`（开工五门）都是**同步纯函数**——输入是已解析值与带版本引用，输出「判决 + 逐门/逐步诊断」，不读宿主时间、网络、模型、文件，不落任何记录。异步解析、记录装配与副作用不在 core：端口的 `Promise<Result<…>>` 形状由调用方实现。`refused`（求值中止）与 `unknown`（输入不足）**不得合并**，二者都留在 `Ok`。
11. **脱敏单一实现**：脱敏算法只在 `contract`（80-§11.2-3）。core 只保留**具名再导出**，不得留第二份正则、第二套标记语义或第二个 `find` 值域；「出站必调」是调用方与网关的纪律，core 不提供转发包装，也不声明覆盖。禁止在 `index.ts` 写 `export * from '@studio-next/contract'`（会把契约其余公共面误扩进 core）。
12. **子域互不越界**：`spec/`、`authority/`、`resources/` 只做纯决策，**不实现端口**、不持连接、不读公司目录、不写记录、不新增诊断码空间（resources 只用 `ResourceGap` 四型，不新造 `E-RES-*`）。`authority/` 五件互不 import；`work-readiness` 不 import `rule/*` 与 `resources/*`；`resources/*` 不 import `rule/*`。
13. **端口名与纯核名分开**：contract 的端口方法名（`typecheck`/`evaluate`/`register`/`resolve`/`load`/`plan`/`baseline`/`gap`/`candidates` 等）不在 core 重名导出；core 的导出名带子域前缀（`typecheckRule`/`evaluateRule`/`registerSpec`/`assembleDefinitionBundle`/`planImport`/`deriveResourceBaseline`…）。端口包装层按端口方法名转发，**不做语义改写**。

---

## 五、逐文件契约

条目顺序：入口与配置 → 决策与状态 → 预算与成本 → 模型与判官 → 队列/人事/秘密 → 进化 → 纯求值（新增）→ 资源/规格/权威纯逻辑（新增）→ 测试 → 夹具 → 新增测试。每个条目都写「现有职责」与「目标职责」两段，二者不合并；「非职责」只写该文件**不**承诺的事。

### 5.1 入口与包配置

#### `F-core-index` · `packages/core/src/index.ts`

- **路径/处置**：`packages/core/src/index.ts`；现有 → 目标-保留（导出面有四处变更：新增五组纯逻辑的 13 条再导出、`secrets` 转具名再导出、`PACKAGE_STATUS` 目标-退役、头注改写）。
- **上位**：79-§4.4 源码态入口与 §6.5 不发布包；80-§2.1 core 节点；80-§11.2-3（core 对脱敏只保留具名再导出，**不用** `export *`）；80-§6.9（新子域落点）；81-§3.3「新增语义必须有具体文件家」。
- **现有职责**：包根 barrel——17 条 `export *` 覆盖全部 src 件，外加 `PACKAGE_NAME` 与 `PACKAGE_STATUS = 'partial'`；文件头注是 v0.5–v0.10 的逐刀 changelog 与 TODO 清单，含多个「[x] 已落地」标记。
- **目标职责**：barrel 继续只做再导出。新增**十四条**（各自可编译后才加）：`./decimal.ts`；`./work-readiness.ts`；`./rule/typecheck.ts`、`./rule/evaluator.ts`；`./spec/registry.ts`、`./spec/loader.ts`、`./spec/importer.ts`；`./authority/{requirement,candidates,activation,grant,incapacity}.ts`；`./resources/{quota,baseline}.ts`。`rule/values.ts`、`rule/operators.ts`、`rule/pattern.ts` 是**包内实现细节，不做包根再导出**（它们的导出面是子域内部约定，见各条「导出面」）。`secrets.ts` 转具名再导出后，本件仍写 `export * from './secrets.ts'`（转发的是本包内那三函数，不是契约整包）；**禁止** `export * from '@studio-next/contract'`——那会把契约其余公共面一并扩进 core，与 80-§11.2-3 的「具名」要求直接冲突。`PACKAGE_NAME` 保留；`PACKAGE_STATUS` 标目标-退役，**删除须批示**（破坏性导出变更），删除前置=全仓零消费者复算（2026-10-27 已核：`apps/`、`packages/` 内除本件外零引用）；头注改为「文档锚 + 当前边界」，不再维护逐刀清单，也不再写「已落地」。
- **非职责**：不做装配、不读 env、不做版本协商、不做副作用初始化；不承担「包已就绪」的声明；不在这里挑拣契约符号（挑拣发生在 `secrets.ts`）；**不新增子域 barrel**（`rule/index.ts` 一类会多出四个文件与四个 F-ID，收益不足；14 条直连再导出已可编译验证）。
- **内部结构**：无类型、无函数；两条字符串常量。`export *` 的顺序不构成语义；新导出按子域分组、组内按文件名排序，便于复算。
- **导出面/依赖**：目标导出 = **31 条 `export *`**（现有 17 + 新增 14）+ `PACKAGE_NAME`；依赖面为包内相对路径，零外部依赖（`secrets.ts` 对 `@studio-next/contract` 的依赖记在那一件）。
- **IO 与注入**：无。
- **状态/并发/恢复**：无状态；模块求值只声明常量与再导出，可被任意次数 import。
- **错误/秘密/可观测**：不抛错、不接触秘密值、不产事件。
- **测试与证据**：无专属测试；各模块测试都用相对路径 import `../src/xxx.ts`，**不经 barrel**——因此「任一 `export *` 名称冲突」只在根 `tsc` 时暴露，属于静态证据，不是行为证据。`PACKAGE_STATUS` 零测试引用。V 级：静态（类型门禁）。**新增 13 条后名称冲突风险上升**：落每条再导出前先跑包级 `tsc`；`typecheckRule`/`evaluateRule` 等前缀化命名即为避免与未来同名符号相撞（§四.13）。
- **规模**：109 → ≤170 行（新增 13 条再导出、删 2 行常量与逐刀注释）。
- **迁移与删除边界**：按子域分批——某子域全部件与其测试通过包级 `tsc` + vitest 后，才加该子域的再导出；`secrets` 迁移按 `F-core-secrets` 的五步执行，本件全程不改 `./secrets.ts` 路径；`PACKAGE_STATUS` 单独一步，批示后才删；不得在删除前改调用方（现状无调用方）。

#### `F-core-package-json` · `packages/core/package.json`

- **路径/处置**：`packages/core/package.json`；现有 → 目标-保留（零字段变更）。
- **上位**：79-§5.2/§6.5（不发布、源码态导出）；80-§2.1；81-§3.4（不新增依赖）。
- **现有职责**：包身份（`@studio-next/core`、`0.1.0`、`private: true`、`type: module`）、入口（`main` + `exports["."]`）、两个私有脚本（`typecheck`、`test`）、三项依赖（`@studio-next/contract`、`yaml`、`zod`）。
- **目标职责**：保持逐字不变。依赖三项与实测 import 面一致（`contract` 值/类型、`yaml` 与 `zod` 只在两个解析件）。`exports` 只保留 `.`——**禁止**新增 `./rules` 之类子路径，那会制造第二个包入口，破坏「一个包一个源码入口」。
- **非职责**：不声明发布、不声明 `files`、不声明 `publishConfig`、不引构建链；不承担版本升级决策。
- **内部结构**：清单字段即契约；无代码。
- **导出面/依赖**：见上；依赖版本与 `bun.lock` 一致由 `bun install` 保证。
- **IO 与注入/状态/错误/秘密/可观测**：N/A（清单文件，不在运行期被读取；包管理器在安装期消费）。
- **测试与证据**：无专属测试；证据=guard 的依赖方向检查（`core→contract` 在允许边内）+ `bun install` 可解析。V 级：静态。
- **规模**：N/A（清单，不计行数额度）。
- **迁移与删除边界**：零迁移。若未来主张发布，须先改 79-§6.5 并走提案流；本卷不主张。

#### `F-core-tsconfig` · `packages/core/tsconfig.json`

- **路径/处置**：`packages/core/tsconfig.json`；现有 → 目标-保留。
- **上位**：79-§3（类型门禁与可擦除语法）、79-§9-D10；80-§2.1；81-§3.3 末条。
- **现有职责**：`extends ../../tsconfig.base.json`；`include: ["src/**/*.ts","test/**/*.ts"]`，把测试也纳入包级 `tsc`（注释称「同 adapters 先例」）。
- **目标职责**：保持。**不得**为了绕开 79-D10 把 `test/**` 从 `include` 移除——那只会让包级门禁也失明，缺口从「根门禁缺」变成「全部门禁缺」。缺口正确修法是 82 的「包级 typecheck 并入根脚本」。
- **非职责**：不发射产物、不配置路径别名、不覆盖 `base` 的严格开关。
- **内部结构**：两条配置键（`extends`、`include`）；无 `compilerOptions` 覆盖。
- **导出面/依赖**：依赖 `tsconfig.base.json`（根卷管辖）。
- **IO 与注入/状态/错误/秘密/可观测**：N/A。
- **测试与证据**：证据=`tsc --noEmit -p packages/core/tsconfig.json` 通过；它覆盖 src 与 test 的**类型**，不覆盖行为。
- **规模**：N/A。
- **迁移与删除边界**：零迁移；根脚本改造时本文件不动。

#### `F-core-models-example` · `packages/core/models.example.yaml`

- **路径/处置**：`packages/core/models.example.yaml`；现有 → 目标-保留（**仅测试**语料）。
- **上位**：`docs/17-§4` 的 `models.yaml` 冻结形状；`models.ts` 的解析契约。
- **现有职责**：31 行示例配置；`test/models.test.ts:20` 用 `readFileSync` 读取，作为「示例配置本体即测试语料」的防漂移断言（五角色映射全命中）。
- **目标职责**：继续只作语料。**不得**被部署读取、不得被当作默认价目；部署侧的真实档位配置由公司目录经 78 绑定提供，core 只解析文本。
- **非职责**：不是 schema、不是默认值、不是模板。
- **内部结构**：YAML 键=角色名 → 档位/模型/单价；合法形状由 `models.ts` 的 zod strict 闸定义。
- **导出面/依赖**：N/A（数据文件）。
- **IO 与注入**：文件读取只发生在测试层（`node:fs`），src 不读它。
- **状态/错误**：无状态；解析失败即测试红（这是它作为语料的全部价值）。
- **秘密**：示例中的价格是虚构值，不得替换成真实合同价。
- **测试与证据**：`models.test.ts` 的「示例合法」用例；坏形用例用内联字符串，不读本文件。V 级：V2（局部回归）。
- **规模**：31 → ≤40 行。
- **迁移与删除边界**：零迁移；删除等于删语料，须同步改测试，**不得**删测试留文件。

#### `F-core-pricing-example` · `packages/core/pricing.example.yaml`

- **路径/处置**：`packages/core/pricing.example.yaml`；现有 → 目标-保留（**仅演示**）。
- **上位**：`pricing.ts` 的 `parsePricingTable`/`validatePricingTable` 形状；80-§7 相位 7e 的价目面。
- **现有职责**：52 行价目表示例，展示 `pricing.yaml` 的交付形态（模型、槽位、单位价、生效日）。
- **目标职责**：保持为演示件。事实：全仓**零代码、零测试**读取（`grep` 实测）。若后续卷（04/13/17）把它当语料，应在 82 登记并把标签改为「仅测试」；在登记前不得声称它被验证过。
- **非职责**：不是默认真实价目；**不得**拷入部署目录充当 `pricing.yaml`；不参与取价回退（回退链是快照 → `models.yaml` 桥 → `unpriced`）。
- **内部结构**：YAML 列表，每项含模型键、槽位、单价、日期；合法性由 `pricing.ts` 的解析与覆盖校验决定。
- **导出面/依赖**：N/A（数据文件）。
- **IO 与注入/状态/错误**：无人读取，因此无 IO 路径、无状态、无错误面；这本身是它的未证项。
- **测试与证据**：无。V 级：无（不得声称已演示验证）。
- **规模**：52 → ≤60 行。
- **迁移与删除边界**：零迁移；若确认无用，可另立退役单（需给调用方清单=空、替代=无、删除条件=演示价值消失），本轮不动。

### 5.2 决策与状态

#### `F-core-flows` · `packages/core/src/flows.ts`

- **路径/处置**：`src/flows.ts`；现有 → 目标-保留。
- **上位**：80-§7.2 2i 的「流解析」前置；**80-§7.2 结论**——77 工作态与 core 平台流是**两套映射**，不得等同、不得互相结清；80-§2.1 core 节点；77-§11.1（状态机规范在 77，本件不是它的实现）。
- **现有职责**：平台状态流的表驱动镜像——`DEFAULT_STATES`、`FlowAnchors`/`DEFAULT_FLOW_ANCHORS`/`NO_APPROVAL_ANCHOR`、`FlowEdge`/`StateFlow`/`FlowTable`、`DEFAULT_ROLLBACK_EDGES`/`DEFAULT_TYPE_EDGES`、`L0_MAINLINE`/`L1_MAINLINE`/`L2_MAINLINE`、`DEFAULT_FLOW_TABLE`，以及解析与查询函数 `flowLevelKey`/`typeFlowKey`/`resolveTicketFlow`/`flowStates`/`flowAnchors`/`nextStates`/`forwardStates`/`canTransition`/`resolveFlow`。
- **目标职责**：只做**平台单据侧流表 + 解析**——回答「这张平台单据按表能走到哪一步、有哪些边」。**不**建立「平台态 → 77 工作态」的判定映射，**不**承担两边互相结清（80-§7.2 结论），**不**吸收 WorkLifecycle 十态与 T01–T26。若面板要并列展示两套状态，只能是**只读投影**（平台态与其文字/序号并排呈现），投影不得反哺判定、不得作为迁移输入。默认表按层级（L0/L1/L2）给出主线与回滚边，是现行公司模板的事实镜像，语义冻结。
- **非职责**：不判授权、不判验收、不写平台、不持有公司覆盖表；不做状态迁移合法性之外的业务判断（`canTransition` 只回答「表里有没有这条边」）；不判工作态、不做两套映射的对账、不产出任何「等价于某工作态」的结论。
- **内部结构**：输入 `level`/`type`/`FlowTable`/`state`；输出 `StateFlow | undefined`、字符串数组或布尔。`resolveTicketFlow` 的优先级=类型流 → 层级流 → 默认流；`nextStates` 只回主线后继，`forwardStates` 回主线后继与回滚边可达的并集。
- **导出面/依赖**：上述 20 个值导出；**零 import**（本件不依赖 contract，实测）——这是它可被任意公司复用的原因，也是它不能承载公司标识的原因。
- **IO 与注入**：零 IO；公司覆盖表由调用方以 `FlowTable` 注入。
- **状态/并发/恢复**：纯函数 + 冻结常量；`DEFAULT_FLOW_TABLE` 视为只读，调用方覆盖须构造新表，不改默认值。
- **错误/秘密/可观测**：不抛错——未知 level/type/state 返回 `undefined` 或空数组。调用方必须把 `undefined` 读成「无流可用」而非「放行」；本件不产事件、不含秘密、不产工作态推断。
- **测试与证据**：`test/flows.test.ts` 27 例（默认表、锚点、解析优先级、前后向、非法边）；`decide.test.ts` 另有跨件用例。fake 边界：无外部依赖，全部输入为内存对象；不证明平台真实状态名与 77 对齐（对齐不是本件的命题——两套映射本就分立），也不证明默认表来自真实公司目录：**平台流表的公司来源未绑定，见 §六-6**。V 级：V2（局部行为回归）。
- **规模**：257 → ≤300 行。
- **迁移与删除边界**：零行为迁移。若上位卷要跨两套映射做对照或对账，另立新件承接（只读投影件或对账件），不在本件加分支、不把投影塞进解析函数。

#### `F-core-decide` · `packages/core/src/decide.ts`

- **路径/处置**：`src/decide.ts`；现有 → 目标-保留（不加新相位）。
- **上位**：80-§7.2 2i「顺序冻结：断路器前置 → 泳道 → 人 → 每拍 → 在途（并发四闸）」；80-§6.0 表把 `decide` 的闸序+Action 记为**局部**等价物，不是完整端口；80-§7.3 的「reserve 必须在 execute 前」不在本件。
- **现有职责**：`DecisionCode` 联合、10 个 Action 接口（派发/提审/挂起/等证据/采集/合并/回收/开单/停摆告警/空操作）与 `Action`/`ActionType`、并发四闸的输入类型（`LaneLeaseState`/`ConcurrencyLimits`/`PersonGateState`/`BreakerSnapshot`）、`DecisionInput`/`DecisionOutput`、`intentKeyOf`、`decide`、两个内部用的断路器判定 `breakerTripped`/`breakerCooled`。
- **目标职责**：只承担 2i——按固定顺序算闸并产出一个结构化 `Action` 与幂等键；**不吸收** 2a–2h 与 2j/2k。开工五门在 `packages/core/src/work-readiness.ts`（80-§7.2 2h），由调用方**先判**，判不过就不进入本件；本件不重复五门的输入（权/能力/资源/信息/禁止五组），只消费「已判可进入调度」这一外部事实。
- **非职责**：不做预算预留/结算（调用方先跑 `budget.reserve`）、不判授权、不判开工条件、不写平台、不排 tick 内多个 action 的顺序（本件一次只出一个 action）、不持有去重集合。
- **内部结构**：输入是快照（单据、层级、类型、流表、泳道租约、在途数、本拍已出动作数、意图、已见幂等键、断路快照、审批/证据/人闸状态、`now`、停摆阈值）；输出 `{ action, intentKey, code }`。
- **`intentKeyOf` 与契约 `IntentKey` 的对应（逐位，不得互比顺序）**：实现是 `[source, kind, company, ticket ?? dedupKey ?? '']` 以 `'|'` 连接成**一个字符串**（`decide.ts:319`–`:324`）；契约的 `IntentKey` 是**四字段结构** `{ company, source, kind, ticket?, dedupKey }`，按 `(company, source, kind, ticket ?? dedupKey)` 比对（80-§6.6、§6.4 `WorkIntake.reserve` 幂等行均写「与 `intentKeyOf` 逐位一致」）。两处是**同一公式的两种序列化**：字段集合与第四位语义相同，但**串序是 `source|kind|company|…`、字段序是 `company, source, kind, …`**——任何跨层断言（golden 夹具、`intent_receipts` 投影、事件 note）必须先在同类表示内比较，**不得**把串按 `|` 拆开后按字段序对撞位置，也不得据串序反推字段序。目标态不新增「结构化 intentKey」字段：串仍是 `decide` 的输出，结构仍由 contract 持有，转换只在 daemon 的入口/回执层发生。
- **导出面/依赖**：导出上述类型与 4 个函数；依赖 `breaker`（冷却常量）、`flows`（锚点解析）、contract 的 `IssueRecord`/`InvokeIntent`/`TicketId`。
- **IO 与注入**：零 IO；`now` 由 `DecisionInput.now` 注入，停摆阈值由 `stallAfterMs` 注入。
- **状态/并发/恢复**：同一输入必同输出（`decide` 无内部状态）；幂等由 `seenIntentKeys` 入参 + `intentKey` 共同表达；无锁、无恢复。
- **错误/秘密/可观测**：不抛错——未知流、未知态、意图不匹配、重复意图分别以 `DecisionCode` + `noop`/`hold`/`wait` 表达，不猜状态、不放行。决策不含秘密；调用方负责把 `code` 落成事件。
- **测试与证据**：`test/decide.test.ts` 60 例（闸序、各 Action 分支、未知态、去重、停摆、人闸）+ `golden.test.ts` 的 6 个夹具回放。fake 边界：`helpers.ts` 构造的内存单据/意图，无真实平台；不证明五门已实现（五门在 `work-readiness.ts`，判据见 §六-15）、不证明真实 CLI 行为、不证明 daemon 先判五门再调本件（编排顺序属 daemon，见 §六-2）。V 级：V2（局部行为回归）。
- **规模**：511 → ≤560 行（先压头注与分段注释；触 560 仍不拆，见 §3.3）。
- **迁移与删除边界**：零行为迁移。五门不在本件落地——目标是新增 `src/work-readiness.ts`（80-§7.2 2h）；本件不加相位、不吸收五门输入。

#### `F-core-breaker` · `packages/core/src/breaker.ts`

- **路径/处置**：`src/breaker.ts`；现有 → 目标-保留。
- **上位**：80-§7.2 2i「断路器前置」；80-§7.3 的崩溃恢复不改变本件语义；**80-§5.7**（处置与断路只读 `failure`；`Err` 面缺省只有 `unavailable` 计入断路，退避 + 串行重试）；77-§11.1 的错误分类（本件消费 `subcause`，不新造分类）。
- **现有职责**：同单同错误签名连续 N 次即熔断的纯状态转移——`DEFAULT_BREAKER_COOLDOWN_MS`（30 分钟）、`BreakerConfig`/`DEFAULT_BREAKER_CONFIG`、`StrikeEntry`、`BreakerState`（只读 Map）、`emptyBreakerState`、`breakerStrikes`、`breakerSignature`、`breakerTrippedAt`、`BreakerResult`、`onWorkerError`、`onSuccess`。
- **目标职责**：保持。输入=旧状态 + 本次错误签名（**现状**签名是调用方拼的**自由字符串**，不是枚举：`harvest:--rg`（`apps/daemon/src/engine/engine.ts:1380`，四要件位图）、`stall:watchdog-kill`/`stall:worker-dead`（同文件 `:1535`/`:1564`））或一次成功；输出=新状态 + 是否触发 + 是否应开单（`OpenBugAction`）。**不**持久化、不跨进程加锁、不决定重派。
- **「同错」的判等键（目标态，迁移项）**：`category` 是观测轴，**不得**充当熔断判等键；**现状连 `category` 都不是**——是调用方自拼的自由串，没有稳定词表、无法跨实现复算。目标态须以 `failure`+`subcause` 组成签名（`failure` 是处置轴，`subcause` 是实现细目，仍不得含正文）。这是签名变更（`onWorkerError`/`breakerSignature` 的入参类型与全部调用点），本轮**不做**，单独立单（§六-16）；在改动前，现有自由串只能作为旧状态与旧事件的读取口径，**不得**在新代码里再以它或 `category` 归类「同错」。
- **非职责**：不做熔断后的重试编排、不判「同单同错」之外的相关性、不读时钟（冷却判定用调用方给的 `now` 与之比较的是 `breakerTrippedAt`）、不决定哪些 `failure` 计入断路（那是 80-§5.7 的唯一表，本件只消费）。
- **内部结构**：`StrikeEntry` 记签名与连击数；`onWorkerError` 在签名变化时重置计数（同签名才累加）；`onSuccess` 清空该单。
- **导出面/依赖**：上述 10 个符号；依赖 contract `TicketId`、`decide.OpenBugAction`（type-only）。
- **IO 与注入**：零；`now` 由调用方传。
- **状态/并发/恢复**：不可变 Map，每次返回新实例；并发下由调用方以「一拍一算」串行化；重启后状态丢失——重建责任在 daemon（本件不假装持久）。
- **错误/秘密/可观测**：不抛错；签名不含错误正文，因此天然不泄漏秘密；触发与否由调用方落事件。**计数口径的分歧**：80-§5.7 只定 `Err` 面缺省（只有 `unavailable` 计入断路），而本件同时承接内部事件域（`GATE_FAIL`/`WORKER_DEAD`/`QA_BACK`/`STALL`/`DISPATCH_FAIL`/`MERGE_CONFLICT`/`LLM_FAIL`）——这些**不是 `Err`**，如何折算到 `failure` 未写，登记 §六-16；不得据此宣称「断路器已按 `failure` 计数」。
- **测试与证据**：`test/breaker.test.ts` 13 例（连击、异签名重置、N 参数化、冷却、复位）。fake 边界：纯内存状态；不证明 daemon 的接入顺序、不证明崩溃后计数连续。V 级：V2。
- **规模**：147 → ≤170 行。
- **迁移与删除边界**：零迁移；`breakerTripped`/`breakerCooled` 若移出 `decide`，须单独立单（会改导出宿主）。

#### `F-core-dispositions` · `packages/core/src/dispositions.ts`

- **路径/处置**：`src/dispositions.ts`；现有 → 目标-保留（标签 `库级·未接`）。
- **上位**：`docs/17-§9` 的错误处置语义表；77-§11.1（`FailureClass` 14 值与本表**不得合并**）。
- **现有职责**：四处置枚举 `retry`/`send_back`/`open_ticket`/`circuit_break`、`ErrorDisposition`、`DEFAULT_DISPOSITIONS`（`ErrorCategory` 11 类全表）、`dispositionFor`、`breakerCountedCategories`。
- **目标职责（降级为旧 `category` 缺省档）**：80-§5.7 生效后，**处置的唯一表在 80**，按 `failure`（77 的 14 值）给「处置 + 不得」；本件**不再自称语义表单一源**，而是「旧 `category` 分支的缺省档」——只在 `failure` 缺位时生效（迁移期读旧 `Err`/旧事件 note 用），新代码先读 `failure`、`category` 只喂事件 note 与告警分桶。本件**不复制** 80-§5.7 的 14 行处置表（复制即第二事实源）；也不得把 11 类 `category` 词表扩成 14 类 `failure` 词表（77 冻结、值域不合并）。标签必须如实：生产代码**零 import**，daemon 只在注释里声明「按表实施」；不得写成「daemon 已按表执行」。
- **非职责**：不执行处置（重试/退审/开单/熔断的动作在 gateway 与 engine）、不做 `FailureClass → ErrorCategory` 的**映射算法**（80-§5.7 已给缺省表与领域覆盖，本件不实现第二份；缺省档只查 category，不反推 failure）、不判重试次数、不决定哪些 `failure` 计入断路（80-§5.7）。
- **内部结构**：`dispositionFor(category)` 查表；`breakerCountedCategories()` 返回计入断路器的类别集合（稳定顺序）。**这两张表的角色已变**：前者是缺省档查表，后者是旧读方的兼容入口；80-§5.7 的 `failure` 处置表由 contract/构造器侧承载，**不在本件**。
- **导出面/依赖**：四类导出；依赖 contract `ErrorCategory`（type-only）。
- **IO 与注入/状态/并发**：零 IO、无状态、纯查表。
- **错误/秘密/可观测**：不抛错（未知类别被类型排除）；不含秘密、不产事件。
- **测试与证据**：`test/dispositions.test.ts` 8 例（全表逐类断言 + 计数类集合）。fake 边界：纯查表；不证明任何执行点真的按表动作，也不证明 `failure` 处置已生效（本件不承载 `failure` 表）。V 级：V2。
- **规模**：77 → ≤90 行。
- **迁移与删除边界**：保留不动、降级标注不删（删了就断旧读方）。接线前先在 80 登记执行点；`failure` 处置的落地在调用方与构造器，**不在本件**。若将来要求本件承载 `failure` 表，须先撤掉 80-§5.7 的唯一表地位——本卷不主张。

#### `F-core-golden` · `packages/core/src/golden.ts`

- **路径/处置**：`src/golden.ts`；现有 → 目标-保留（标签 `仅测试`）。
- **上位**：`F1-03`/`F2-14` 的可回放要求（历史需求编号，见文件头注）；80-§6/77 未给端口，故仍是库内格式。
- **现有职责**：trace 格式与回放器——`GoldenExpectation`、`GoldenTrace`、`GoldenFailure`、`replayTrace`（逐拍调 `decide`，比较 `ActionType`+`intentKey`+`code`）。
- **目标职责**：保留为**契约雏形**：零生产 import，6 个夹具只被 `test/golden.test.ts` 消费。不称「回放能力已上线」，不称「契约已冻结」。
- **非职责**：不采集、不落盘、不做时间旅行、不做跨版本迁移；不是 store 的重放面。
- **内部结构**：输入 trace（初始快照 + 期望序列）→ 输出 `GoldenFailure[]`（空=通过）；不做模糊匹配，字段逐一比对。
- **导出面/依赖**：三型一函数；依赖 `decide`（值 + 类型）。
- **IO 与注入/状态/并发**：零 IO、无状态、纯函数。
- **错误/秘密/可观测**：格式不合法由调用方/测试保证；回放失败以 `GoldenFailure` 表达，不抛；trace 只含动作与码，不含正文。
- **测试与证据**：`test/golden.test.ts` 6 例（每个夹具一例）。fake 边界：手写 trace；不证明裁决正确性（它只证明「决策与记录一致」）。V 级：V2。
- **规模**：76 → ≤90 行。
- **迁移与删除边界**：升 contract 需 contract 卷与 80 同时承接（§六-10），否则保持库内；本轮不动。

### 5.3 预算与成本

#### `F-core-budget` · `packages/core/src/budget.ts`

- **路径/处置**：`src/budget.ts`；现有 → 目标-保留。
- **上位**：80-§7.3（reserve 在 execute 前、崩溃点①）；80-§8.3 六段顺序中的 reserve 段；`docs/16-§三` 预算行与 `20-§六.8`。
- **现有职责**：预算行模型 `BudgetRow`（对齐 store `budgets` 列）、`BudgetScopeKind`/`BudgetKind`、两个后缀常量、`BudgetView`/`BudgetViews`/`BudgetLedgerState`、`emptyBudgetLedger`、`budgetView`、`foldBudgets`（行流 → 每票/每人净预留视图 + ticket→person 桥）、`ReserveInput`/`ReserveResult`、`reserve`（重复预留拒、票级帽/岗级帽超帽落 refusal）、`SettleInput`/`SettleResult`、`settle`（冲销该票未结预留，无预留可结=配置错误）。
- **目标职责**：只做**纯折叠 + 预留判定 + 结算判定**，返回「新状态 + 结果」；是否 append 行、是否开事务、崩溃后如何恢复是 store/daemon 的事。`reserve` 的语义必须是「不落预留即不派发」的纯判定面。
- **非职责**：不写库、不开事务、不做扇出（父单→子单的额度分摊由 daemon 组装 `ReserveInput`）、不做货币换算。
- **内部结构**：`foldBudgets` 按 scope 键聚合 reserve/settle/refusal 三类行；`budgetView` 给单 scope 的净可用；`reserve` 依次检查重复键、票级帽、岗级帽；`settle` 按票冲销。
- **导出面/依赖**：上述 20 个符号；依赖 contract `ClassifiedError`/`Money`/`PersonId`/`TicketId`。
- **IO 与注入**：零 IO；时间与日期由行字段带入，函数不取 `now`。
- **状态/并发/恢复**：状态由 `foldBudgets` 从行流重建（无隐藏状态），`reserve`/`settle` 返回新状态；幂等=重复预留被拒（refusal 分支），重复结算无预留可冲即配置错误。并发一致性依赖 store 的单写者与事务（不在本件）。
- **错误/秘密/可观测**：超帽→`ReserveResult` 的 refusal（**语义判定，不抛**）；无预留可结→抛 `ClassifiedError`，目标态 `failure:'rejected_precondition'` + `category:'CONFIG_INVALID'`（现状只设 category，迁移项见 §四.5）。金额是 `Money`（当前 number USD）：按 80-§13.1 **D17**，`Money` 只作**内存形态与旧记录读取**，**公共金额（跨进程/入库/对外）一律 `DecimalString` + 币种**；`BudgetRow` 是 store 行的镜像，其列形态迁移到 `DecimalString` 时本件同步改，顺序见 §六-5。无秘密。
- **测试与证据**：`test/budget.test.ts` 50 例（折叠、帽、重复、refusal、桥重建、结算边界）。fake 边界：内存行流；不证明事务、不证明并发下的双花防护、不证明崩溃恢复、不证明 `DecimalString` 精度。V 级：V2。
- **规模**：494 → ≤520 行。
- **迁移与删除边界**：零行为迁移（补 `failure` 字段除外，那是 §四.5 的全局迁移）。`DecimalString` 迁移须先定 store 列与双写顺序（§六-5），单独立项；本件不得单方面把 `Money` 改成字符串而不同步 store/migration。

#### `F-core-pricing` · `packages/core/src/pricing.ts`

- **路径/处置**：`src/pricing.ts`；现有 → 目标-保留。
- **上位**：80-§7 相位 7e（pricing stale）；80-§7 末（日终聚合可重放）；`docs/132-§6.2` 的取价规则（历史设计，见文件头注）。
- **现有职责**：价目表解析与校验（`parsePricingTable`/`validatePricingTable` + `PricingIssue`）、槽位与模型条目类型、`priceDateDiff`、`resolveSnapshotPrice`（exact/carry）、四桶折算 `foldCostUsd` + `UnpricedBucket`、stale 报告 `pricingStaleReport` + `PRICING_STALE_ALARM_DAYS`、`bridgePriceFor`（快照 → `models.yaml` → `unpriced`）、模型归一键 `normalizeModelKey`/`parseModelKey`。
- **目标职责**：保留解析、校验、取价、stale 报告、桥与折算；**不**写 `price_snapshots`（store 是事实源），**不**投递告警（daemon 决定），**不**决定「用哪个价」以外的策略。
- **非职责**：不读文件（文本进）、不取时钟（日期由参数给）、不做币种转换、不做快照版本裁决。
- **内部结构**：解析层用 `yaml` + `zod` 产出 `PricingTable`；`validatePricingTable` 对照 `DeclaredModel` 报覆盖问题；`resolveSnapshotPrice` 只被 `bridgePriceFor` 内部调用；`foldCostUsd` 把 token 四桶 × 单价折成 `FoldCostResult`（含 unpriced 桶标记）；`normalizeModelKey` 当前**零消费者**（内部与生产都无），只被测试引用——登记为库级未接，不删。
- **导出面/依赖**：上述 20 个符号；依赖 `yaml`、`zod`、contract 的 `configInvalid`/`BILLING_TRACKS`/`ModelTier`/`TokenCounts`。
- **IO 与注入**：零 IO；日期字符串由调用方给。
- **状态/并发/恢复**：无状态、纯函数；同一输入同输出（可重放）。
- **错误/秘密/可观测**：解析/校验失败抛 `CONFIG_INVALID` + `PricingIssue[]`（含位置，不含整行原文）；未定价按 `unpriced` 计 0 并如实标记（不猜价）。价格是商业信息，错误消息不得回显单价。
- **测试与证据**：`test/pricing.test.ts` 18 例（解析坏形、覆盖校验、exact/carry、四桶、stale、桥、归一键）。fake 边界：内联 YAML 文本 + 内存快照行；不证明真实快照表结构、不证明 stale 告警真的发出。V 级：V2。
- **规模**：450 → ≤470 行。
- **迁移与删除边界**：零迁移；`normalizeModelKey` 保留（删除会改导出面），若确认无用另立退役单。

#### `F-core-costguard` · `packages/core/src/costguard.ts`

- **路径/处置**：`src/costguard.ts`；现有 → 目标-保留。
- **上位**：80-§7 相位 7f 的前置（成本警戒）；80-§8.6（时钟注入）；**80-§13.1 D17**（「公司本地日由公司时区决定；`localDateKey` 的宿主时区版只作旧记录过渡」）；`docs/132-§6.4` 的档位判定（历史设计，见文件头注）。
- **现有职责**：`localDateKey`（本地日串）、`CostGuardEval`/`highestReachedTier`（按 `atPct` 升序取最高达标档）、`UsageDailyCell`/`UsageRecordLike`/`foldUsageDaily`（work_records → 人×模型×日格全量折叠）、`UsageCellsCost`/`usageCellsCostUsd`（格 × 单价 → USD）。
- **目标职责**：保留日键、档位、折叠、折算四个纯面；**不**写 `usage_daily`（daemon 的 write-through 与重建面）、**不**算在途预留分量（调用方从 `budgets` 台账另加）。
- **日键：两个概念必须分开**（D17）：**UTC 日键**（`DAY_MS`/`dayKeyOf`，已按 80-§9.4 M1 指定落 `contract/src/daykey.ts`，见 01 的 `F-contract-daykey`）与**公司本地日**（`companyDayKey(ms, zone)`，同一文件；`CompanyZone` 由调用方从 78 的绑定取）。本件的 `localDateKey(ms)` 是**宿主时区版**，按 D17 **只作旧记录过渡**：读旧 `usage_daily` 行时可用，**不得**用于新写入、不得作为档位判定的唯一口径，也不得再被新代码当作「公司业务日」。目标态本件只消费调用方传入的日键（字符串），**不自行折日**；若需在 core 内折日，只能调 contract 的 `companyDayKey`（显式 `zone` 入参），不得读宿主时区。`foldUsageDaily` 的日格键因此由入参给，不由本件算——这是签名变更，须单独立项（§六-8）。
- **非职责**：不读时区配置、不做唤醒去重（`dedupKey` 含 tier 段由调用方保证）、不做告警。
- **内部结构**：`localDateKey(ms)` 用 `new Date(ms)` 取本地年月日——**宿主时区耦合**，按 D17 降级为过渡件（§六-8/§八-3）；`highestReachedTier` 自行按 `atPct` 排序，不假设配置有序；预算 0 且有消耗 → `Infinity`。
- **导出面/依赖**：上述 8 个符号；依赖 contract `CostGuardTier`、`pricing.UnitPrice`；目标态若改用 `companyDayKey`，依赖面加 `contract/daykey.ts`（同在 `core→contract` 允许边内，不新增边）。
- **IO 与注入**：零 IO；毫秒由调用方给；目标态 `zone` 亦由调用方给。
- **状态/并发/恢复**：无状态；折叠是全量重建（不增量）。
- **错误/秘密/可观测**：不抛错；空档位返回 `undefined`（调用方读成「无档」不是「零档」）；不含金额以外的敏感数据。
- **测试与证据**：`test/costguard.test.ts` 13 例（日键跨时区边界、档位、折叠、折算）。fake 边界：内存记录；不证明宿主时区一致、不证明投影落库、不证明与 `companyDayKey` 等价（两者概念已分家，不是同一个断言）。V 级：V2。
- **规模**：179 → ≤195 行。
- **迁移与删除边界**：零迁移；`localDateKey` 的退役条件=旧 `usage_daily` 行全部按新日键重算完毕（属 store/daemon 的重建面），退役前不得删。时区来源改为 `companyDayKey(ms, zone)` 属签名变更，须单独立项（§六-8）。

#### `F-core-costclose` · `packages/core/src/costclose.ts`

- **路径/处置**：`src/costclose.ts`；现有 → 目标-保留。
- **上位**：80-§7 相位 7f（costClose 日终）；80-§7 末「日终聚合必须可重放、不得覆盖已有快照」；`docs/132-§6.3`（历史设计，见文件头注）。
- **现有职责**：常量（收口时刻 19:55、kv 键、补账合并阈 0.01、对账容差、补账容差）、`UsageCellLike`/`CostPriceBasis`/`CostCellPlan`/`planCostCell`/`planCostCells`（每格首冻的三路取价）、`CostRowLike`/`AdjustmentPlan`/`AdjustmentSweep`/`sweepClosedDate`（补账巡检）、`ReconModelLine`/`ReconSegment`/`parseModelFromNote`/`reconcileDate`（对账段）、`AdjustmentDisplayLine`/`AdjustmentDisplay`/`mergeTinyAdjustments`（展示层合并）、`CostCloseReportBody`/`buildCostCloseReport`（日报装配）。
- **目标职责**：产出**计划与报告体**，可重放、幂等；不写快照、不覆盖已有快照。
- **非职责**：不执行补账（daemon 的 `cost-close/close.ts`）、不决定收口时刻是否已到（`COST_CLOSE_HOUR` 是默认名，调度在 daemon）、不做财务口径裁决。
- **内部结构**：`planCostCells` 对每格走「快照 exact/carry → `models.yaml` 桥 → unpriced」三路；`sweepClosedDate` 只对已关闭日扫补账；`reconcileDate` 按模型行汇总对账段；`mergeTinyAdjustments` 只用于报告展示（|usd| < 0.01 合并），不改变账面；`buildCostCloseReport` 组装报表体。
- **导出面/依赖**：上述 22 个符号；依赖 contract `TokenCounts`/`ModelTier`、`pricing` 的 4 个符号、`cost-insights.CostInsight`（type-only）。与 `cost-insights` 构成**纯类型环**，运行期无环——若将来任一侧改成值导入，必须同时拆件，否则会形成运行期环。
- **IO 与注入**：零 IO；日期、快照行、usage 格全由入参给。
- **状态/并发/恢复**：无状态；同一输入同计划（可重放）；重复执行产生同计划，不产生重复账（落账幂等在 store/daemon）。
- **错误/秘密/可观测**：缺价按 `unpriced` 计 0 并留痕（`DEV-19` 不猜价），不抛；报告体不含凭据、不含宿主路径。
- **测试与证据**：`test/costclose.test.ts` 19 例（三路取价、补账、对账、合并展示、日报）。fake 边界：内存 usage/快照/记录；不证明落库、不证明并发下的重放安全。V 级：V2。
- **规模**：455 → ≤480 行。
- **迁移与删除边界**：零迁移；`mergeTinyAdjustments`/`parseModelFromNote` 只在本件内部使用，若拆件须同步改测试路径。

#### `F-core-cost-insights` · `packages/core/src/cost-insights.ts`

- **路径/处置**：`src/cost-insights.ts`；现有 → 目标-保留。
- **上位**：80-§7 相位 7f 的报表面；`docs/132-§6.3` 的财务分析四规则（历史设计，见文件头注）；本件是 `costclose.ts` 触 600 行时的拆分产物（`index.ts` 注释记为「BC-S2 600 行阈」）。
- **现有职责**：四规则常量（异常阈 5 USD、尖峰倍数 3、缓存命中低线 0.5、缓存最小 token 1,000,000、订阅/API 倍数 1.2、窗口 7 天）、`CostInsightKind`（四值）、`CostInsight`、`CostInsightInput`、`costInsights`。
- **目标职责**：保留四规则的纯判定与稳定排序；不排版、不投递。
- **非职责**：不读历史库（窗口切片由入参给）、不判断建议是否可执行、不做优先级仲裁。
- **内部结构**：输入=窗口内的格计划 + 价格 + 计划价；输出=按 `kind` 稳定排序的数组（显式排序键，不依赖 Map 顺序）。
- **导出面/依赖**：八个符号；依赖 `costclose.CostCellPlan`（type-only）——纯类型环的另一侧。
- **IO 与注入/状态/并发**：零 IO、无状态、纯函数。
- **错误/秘密/可观测**：不抛错；金额阈值是常量，不读配置；不含秘密。
- **测试与证据**：**无专属测试文件**，经 `costclose.test.ts` 的分析段间接覆盖。fake 边界：内存格计划；**未证**：四条规则的边界值（恰等于阈值、窗口端点）是否都有用例，见 §八-5。V 级：V2（仅间接）。
- **规模**：175 → ≤190 行。
- **迁移与删除边界**：零迁移；若补专属测试，放 `test/` 直属还是新子目录，须先看 25 件额度（本批后直属 **19/25**，仍可容 **6** 件）。

### 5.4 模型与判官

#### `F-core-models` · `packages/core/src/models.ts`

- **路径/处置**：`src/models.ts`；现有 → 目标-保留。
- **上位**：`docs/17-§4` 的 `models.yaml` 冻结形状与 `docs/25-§3.3` 的 `ModelCatalog` 端口；80-§2.1 core 节点。
- **现有职责**：`TIER_IDS`/`TierId`（high/mid/low）、`TierSpec`、`ModelsConfig`、`ModelsIssue`、`parseModelsYaml`（zod strict + yaml 行号定位）、`createModelCatalog`（`tiers`/`resolve`/`estimateCost`）、`fingerprint`（价目内容指纹）。
- **目标职责**：保留装载与目录；`fingerprint` 保持稳定（同内容同指纹）。**不**热加载、不监听文件、不决定档位（daemon 的 tier 面）。
- **非职责**：不读文件（文本进）、不访问网络、不缓存跨调用结果（目录是返回值，不是模块级单例）。
- **内部结构**：`parseModelsYaml` 用 `LineCounter` + `parseDocument` 取行号，Zod `.strict()` 拒未知键，失败抛 `CONFIG_INVALID` 并带 `ModelsIssue[]`；`createModelCatalog` 返回不可变目录；`fingerprint` 取 sha256 前 8 位。
- **导出面/依赖**：七个符号；依赖 `node:crypto`、`yaml`、`zod`、contract 的 `ClassifiedError`/`ModelCatalog`/`ModelTier`/`Money`/`PriceEntry`/`RoleName`/`TokenCounts`。
- **IO 与注入**：零 IO（文本传入）。
- **状态/并发/恢复**：无模块级状态；目录对象可安全共享；解析失败无部分结果。
- **错误/秘密/可观测**：错误只回行号 + 键名 + 码，不回显整行（价目是商业信息）；失败按 §四.5 固定 `failure:'rejected_precondition'` + `category:'CONFIG_INVALID'`。**`fingerprint` 是 sha8（sha256 前 8 位），按 80-§13.1 D17 只作展示/可读锚点**——不得作身份、不得作跨实例判等键、不得写进需要「同一摘要即同一内容」的断言；身份一律用完整 `semanticDigest`（`TS-SCALAR-08`，必带 `canonicalizationId`）。本件暂不产完整摘要，因此「价目内容身份」在目标态由 contract 的摘要入口给（§六-5）。
- **测试与证据**：`test/models.test.ts` 40 例（全形、各坏形含行号、目录命中/未登记、折算边界、指纹稳定）。fake 边界：内联 YAML + 示例文件；不证明真实部署配置、不证明档位选择策略、不证明 sha8 可替代 `semanticDigest`。V 级：V2。
- **规模**：314 → ≤340 行。
- **迁移与删除边界**：零迁移；若要把 `fingerprint` 从展示锚升级为身份摘要，须改用 `TS-SCALAR-08` 的完整摘要并带规范化标识，同时改 store 列，单独立项（§六-5）；**不得**只把位数改长。

#### `F-core-judge` · `packages/core/src/judge.ts`

- **路径/处置**：`src/judge.ts`；现有 → 目标-保留（`assertJudgeVocab` 标 `库级·未接`）。
- **上位**：`docs/17-§6` 的 micro-judge 段；80-§6.0 未登记 judge 端口（§六-12）；本件是 `studio-dev-160 §6.1` 的实现（见文件头注）。
- **现有职责**：词表形状 `JudgeOpSpec`/`JudgeVocab`/`JudgeParamDomain`、判决形状 `JudgeOpVerdict`、语义白名单与近黑名单常量、`assertJudgeVocab`（注册期三闸：非空/无重/算子已批/枚举非空且无重）、`judgeVocabFingerprint`（排序无关的稳定指纹）、`parseJudgeVerdict`（JSON 可解析 + 算子在白名单 + 参数域合法）。
- **目标职责**：保留三件套；**如实标注**：`assertJudgeVocab` 生产零调用（`invoke.ts:93` 注释称「由装配面收口」，但装配面没有调用），`parseJudgeVerdict`/`judgeVocabFingerprint` 已接线（`invoke.ts:402` 等）。
- **非职责**：不调用模型、不写事件、不做重试、不扩白名单（白名单是语义面，改它等于改规范）。
- **内部结构**：白名单是算子名数组，近黑名单用于诊断提示；指纹对词表做规范化排序后取哈希；`parseJudgeVerdict` 失败经私有构造器 `configInvalidJudge` 抛 `ClassifiedError`（judge 输出非法按配置级失败处理）。
- **错误两轴的迁移项（本件两处，按 80-§5.7）**：`configInvalidJudge(subcause, detail)`（`judge.ts:264`）现只设 `category='CONFIG_INVALID'` → 补 `failure:'rejected_precondition'`；`judgeLlmFail(subcause, detail)`（`judge.ts:273`）现设 `category='LLM_FAIL'`，而 `LLM_FAIL` 是**内部事件与熔断域**、**不得从 `Err` 选**——这是现存**缺陷**（§六-16），须改判为具体 `failure`（候选 `unavailable`：模型面瞬时故障、退避后重试；或 `degraded`：降级可继续），裁决前**不得**新增调用点、不得把该构造器复制进新代码、也不得在文档里称「judge 失败分类已合规」。
- **导出面/依赖**：九个符号；依赖 `node:crypto`、contract `ClassifiedError`。
- **IO 与注入**：零 IO。
- **状态/并发/恢复**：无状态；指纹是纯函数。
- **错误/秘密/可观测**：错误只回码与位置（`judge/vocab-*`、`judge/verdict-*`），不回模型原文，避免把提示词带进日志；`detail` 过 §11.6 脱敏与路径禁令。
- **测试与证据**：`test/judge.test.ts` 20 例（词表 7 个坏形、指纹稳定性与顺序无关、判决解析）。fake 边界：手写词表与判决文本；不证明真实模型输出、不证明注册期被强制。V 级：V2。
- **规模**：279 → ≤300 行。
- **迁移与删除边界**：保留；若要让注册闸真正生效，先在 80/装配卷登记调用点，本卷不预支。

#### `F-core-judge-gates` · `packages/core/src/judge-gates.ts`

- **路径/处置**：`src/judge-gates.ts`；现有 → 目标-保留。
- **上位**：`docs/17-§6` 与 `studio-dev-160 §6.2/§6.4`（见文件头注）；80-§6.0 未登记该面（§六-12）。
- **现有职责**：三帽（`JudgeCaps`/`DEFAULT_JUDGE_CAPS`/`judgePreCallGate`/`judgeOverSpend`）、降级枚举（`JudgeFallbackReason`/`JUDGE_FALLBACK_REASONS`）、按址熔断（`JudgeSiteBreakerState`/`JUDGE_BREAKER_THRESHOLD=3`/`initialJudgeBreaker`/`onJudgeFallback`/`onJudgeSuccess`/`isJudgeSiteOpen`）、拍闸（`JudgeTickLimits`/`DEFAULT_JUDGE_TICK_LIMITS`/`JudgeTickState`/`initialJudgeTick`/`JudgeTickDecision`/`judgeTickGate`/`onJudgeTickCall`）、角色闸（`JUDGE_ROLE='micro_judge'`/`assertJudgeRoleLow`）。
- **目标职责**：保留阈值与判定；阈值是冻结值，调参属规范变更。**不**做模型调用编排（`invoke.ts`）、不写事件。
- **非职责**：不判「判决对不对」、不做降级后的替代路径选择（调用方决定）、不做跨站点聚合。
- **内部结构**：帽=调用数/花费/每拍次数；`judgeOverSpend` 用 `actualUsd` 与帽比较；按址熔断按「同址连续降级 N 次」开断，`isJudgeSiteOpen` 按日键判定当日是否仍开；`assertJudgeRoleLow` 对高帽角色抛 `CONFIG_INVALID`（角色错配是配置错误）。
- **导出面/依赖**：上述 20 个符号；依赖 contract `configInvalid`、`models.TIER_IDS`。
- **IO 与注入**：零 IO；日键由调用方给。
- **状态/并发/恢复**：状态由调用方持有并传入（本件返回新状态）；重启后熔断状态丢失——重建在 daemon。
- **错误/秘密/可观测**：配置错配抛 `CONFIG_INVALID`；判定结果只含布尔/枚举，不含秘密；降级原因枚举不含模型原文。
- **测试与证据**：`test/judge-gates.test.ts` 23 例（三帽边界、降级计数、按址开断/复位、拍闸、角色）。fake 边界：手写状态；不证明真实调用序列、不证明跨重启连续。V 级：V2。
- **规模**：288 → ≤310 行。
- **迁移与删除边界**：零迁移；若三帽/按址熔断被认定为规范项，回写 80（§六-12），否则只能算实现件。

### 5.5 队列、人事与秘密

#### `F-core-queue` · `packages/core/src/queue.ts`

- **路径/处置**：`src/queue.ts`；现有 → 目标-保留。
- **上位**：80-§7.2 2e 的「定序」在本包只到**比较器与排序器**这一层；`queueCarry`/`orderCandidates` 已由 80-§7.2 2e 明置在 `apps/daemon/src/engine/todoqueue/queue.ts`，并注明「**不是** `core/queue.ts`」。本件的上位是 `docs/129-§6.2-R1/R4`（见文件头注）+ 80-§7.2 2e 的比较器段。
- **现有职责**：优先级域（0–3）与 `clampPriority`、年龄加成 `ageBoostTier`（两档封顶，`DEFAULT_QUEUE_AGE_STEP_MS`=1 小时）、`QueueEntryRank`、`queueScore`（优先级 + 加成，置顶恒首）、`compareQueueEntries`、`rankQueue`（稳定排序）、`QueueRanker` 类型。
- **目标职责**：只做**排序键与排序**。**不**吸收 daemon 的携带态（`QueueCarryEntry`）、成员资格排除、不抢占语义。
- **非职责**：不持有队列、不做去重、不做跨拍续租、不读时钟（等待时长由入参给）。
- **内部结构**：`queueScore` 输出可比数值；`compareQueueEntries` 先置顶、再分数、最后 FIFO 序号；`rankQueue` 返回新数组，不改入参。
- **导出面/依赖**：十个符号；依赖 contract `TicketId`。
- **IO 与注入**：零 IO；`waitMs` 与 `ageStepMs` 由调用方给。
- **状态/并发/恢复**：无状态；排序稳定，因此同分不漂移。
- **错误/秘密/可观测**：越界优先级被 clamp（不抛）；不含秘密。
- **测试与证据**：`test/queue.test.ts` 17 例（clamp、加成档、置顶、同分 FIFO、稳定排序）。fake 边界：内存条目；不证明 daemon 的携带态重建、不证明真实队列顺序。V 级：V2。
- **规模**：102 → ≤115 行。
- **迁移与删除边界**：零迁移；携带态与 `orderCandidates` 的落点由 80-§7.2 2e 定在 daemon，本件不回收、不复制（daemon 侧的排队实现归 81-files/17，不在本卷新增）。

#### `F-core-hrsync` · `packages/core/src/hrsync.ts`

- **路径/处置**：`src/hrsync.ts`；现有 → 目标-保留。
- **上位**：`docs/52-§5.1` 的七值域（见文件头注）；80-§7 相位 6 的人事段；78 的公司快照绑定（`CompanySnapshot` 由调用方给）。
- **现有职责**：`HR_EVENT_KINDS`（入/调/升/降/停/复/退，七值单一源）、`HrEventKind`、`HrSyncPlatform`（taiga/matrix/ledger）、`PeopleChange`、`PeopleDiffResult`、`LedgerStatusIndex`、`diffPeople`（前后快照比对 + 台账状态索引）、`hrOpKey`（跨平台幂等键）、`renderChange`/`renderPeopleDiff`（人读渲染）、`platformsFor`（该变更需要发往哪些平台）。
- **目标职责**：保留七值域与 diff；不写台账、不发平台、不开单（daemon 的 `engine/hrsync` 负责）。
- **非职责**：不判授权、不做身份合并、不读公司目录、不决定幂等键的持久化位置。
- **内部结构**：`diffPeople(prev, next, ledgerStatus?)` 产出变更列表；`ledgerStatus` 缺省即不比台账（面关，零行为变化）；`hrOpKey` 把变更 + 平台折成稳定串；`renderChange` 只产人读文本，不含凭据。
- **导出面/依赖**：十个符号；依赖 contract `CompanySnapshot`。
- **IO 与注入**：零 IO；时间不参与（快照自带版本/时刻）。
- **状态/并发/恢复**：无状态；同一对快照同结果。
- **错误/秘密/可观测**：不抛错；未知状态按「无变化」处理；渲染文本会进出站面，必须再过 `secrets.redactOutbound`（调用方责任，本件不自行脱敏）。
- **测试与证据**：`test/hrsync.test.ts` 13 例（七值域、增删改、幂等键稳定性、渲染、平台集合）。fake 边界：手写快照；不证明真实平台同步、不证明台账状态索引来自真实库。V 级：V2。
- **规模**：193 → ≤210 行。
- **迁移与删除边界**：零迁移；新增值域属规范变更，须改 `docs/52-§5.1` 与 76。

#### `F-core-secrets` · `packages/core/src/secrets.ts`

- **路径/处置**：`packages/core/src/secrets.ts`；现有（本包自有实现）→ 目标-**替换**（实现迁 `@studio-next/contract`，本件转具名再导出）。
- **上位**：80-§11.2-3（三函数连同 `SecretShapeFinding`、三条正则、`REDACT_MARK`、`MIN_KNOWN_LENGTH` **一并迁** `contract/src/secrets.ts`；core 只保留具名再导出、**不用** `export *`；`packages/core/test/secrets.test.ts` 是迁移验收口径，须原样通过）；80-§11.2.1（`KnownSecretSet` 的 `redact`/`find` 复用 contract 三函数，不再各写一份）；80-§11.6（日志/事件 note 不得含秘密）；`docs/52-§十二`、AGENTS 纪律 6。
- **现有职责**：`redactKnownSecrets`（已知值替换为 `<redacted:N>`，长度降序、最短 6、去重）、`SecretShapeFinding`/`findSecretShaped`（bearer/assignment/long-token 三类形状检测）、`redactOutbound`（先已知值、后形状兜底；赋值对只换值段保留键名；已替换标记不被二次改写）。
- **现状必须如实写**：本件**当前仍是 core 自有实现**（三函数 + 一类型 + 三条正则 + 两个常量），全仓唯一消费者是 `assembly/hrsync/assemble.ts:59`（经 `@studio-next/core` 的 `export *` 取得）；`packages/core/src/index.ts:82` 的 `export * from './secrets.ts'` 是**待迁移事实**，不是目标态。`test/secrets.test.ts` 的 13 例断言当前打在本实现上。**不得**据此声称「脱敏已是单一实现」（§八-14）。
- **目标职责**：只做**三条具名再导出 + 一个类型**——`export { redactOutbound, redactKnownSecrets, findSecretShaped } from '@studio-next/contract'` 与 `export type { SecretShapeFinding }`。语义在契约侧**冻结**：标记形 `<redacted:N>`、长值优先（长度降序）、`MIN_KNOWN_LENGTH=6`、赋值正则的 `(?!<redacted:)` 负前瞻；迁移只搬位置，不改判定。**不加**第四种 `kind`，不改标记文案。
- **非职责**：不收集秘密、不读凭据、不加密、不判断何谓秘密（`knowns` 由调用方给）、不扫 API 请求体（合法携带凭据）；**不承担「出站必调」**——强制点在 daemon/gateway/api/panel 的出口（§六-7），本件不提供转发包装、不声明覆盖范围；不保留第二套正则或第二份标记语义；**不在本件实现或转发 `KnownSecretSet.redactKnown`**——该成员属 `contract/src/ports/secret.ts` 的 `KnownSecretSet`（80-§11.2.1 记作 `redact`/`find`；命名差异由 01 与 80 对齐，core 只做上游三函数的 shim，不新增同名成员、不建第二套集合语义）。
- **内部结构**：目标态本件**无算法**，只有 import 与具名 export；文件内**不得**出现 `export *`（本件自己不做星号转发，星号只出现在 `index.ts` 对 `./secrets.ts` 的那一行）。
- **秘密供给面不在本件，但接缝必须写清**：`SecretCatalogEntry`/`SecretProvider`/`SecretMaterial`/`KnownSecretSet` 落 **`contract/src/ports/secret.ts`**（80-§11.2.1、§12.3 指定路径；01 的 `F-contract-port-secret`，本卷不复制字段表）。四条硬约束：① `KnownSecretSet.redact`/`find`（代码侧命名 `redactKnown`/`findSecretShaped` 之一，须与 80 对齐）必须**复用**本件迁出的三函数，不得各写一份正则或第二套标记语义；② `SecretMaterial` 只活在 daemon 的受控内存，`core` 既不接收也不返回秘密值（本件只收 `knowns: readonly string[]`）；③ per-ticket `wkey` 是 `local-mint` 的唯一例外、不进静态 catalog、`CLOSE` 即移出集合，`worker` 永不得 `gatewaySecret`（80-§11.4.1）；④ 集合的**实现**在 contract，core 不持有集合实例、不缓存已知值表。
- **导出面/依赖**：三函数 + 一类型；依赖 `@studio-next/contract`（在允许边 `core→contract` 内）；本地零正则、零常量。
- **IO 与注入**：零 IO；`knowns` 由调用方注入，形状不变。
- **状态/并发/恢复**：无状态；同一输入同输出（由 contract 实现保证；本件不含可变状态）。
- **错误/秘密/可观测**：不抛错；替换标记只回长度、不回内容；`findSecretShaped` 只回类型与偏移（偏移只对原文有意义）。
- **测试与证据**：`packages/core/test/secrets.test.ts` 13 例（已知值、长度降序、短值不换、去重、三类形状、总闸、二次替换保护）——80-§11.2-3 把它定为**迁移验收口径**，断言逐字不动，只允许改 import 来源。fake 边界：内联文本与假秘密；**未证**：迁移尚未实施（§八-14/15）；正则最坏时间（长文本、嵌套引号）未测，见 §八-4。V 级：V2。
- **规模**：80 → **≤40 行**（目标态只剩 import/export 与短头注）。
- **迁移与删除边界**：五步且顺序不可换——（1）contract 落实现（含 `SecretShapeFinding`、三正则、`REDACT_MARK`、`MIN_KNOWN_LENGTH`）并补契约侧测试；（2）本件改具名再导出；（3）`test/secrets.test.ts` 的 import 改指 contract，**断言不动**；（4）调用方（`packages/prompt/src/assembly/hrsync/assemble.ts:59` 等）改直连 contract，过渡期允许继续经 core 再导出；（5）shim 保留，退役须另行批示。**禁止**先删实现再加 re-export（中间态会出现「无单一实现」或两套正则并存）。

### 5.6 进化

#### `F-core-evolution` · `packages/core/src/evolution.ts`

- **路径/处置**：`src/evolution.ts`；现有 → 目标-保留（局部接线；575 行为全包最大件，触 600 时走 §3.3 预置拆分线）。
- **上位**：80-§2.1 core 节点；`docs/16-§四 v0.10`、`02-F3`、`20-§九`（见文件头注）；`docs/17-§3` 的 `candidates` 列对齐。
- **现有职责**：资产与影响面枚举（`ASSET_KINDS`/`AssetKind`/`CRITERION_ASSET_KIND`/`BLAST_RADII`/`BlastRadius`/`blastRadiusRank`）、候选状态机（`CANDIDATE_STATUSES`/`CandidateStatus`/`TERMINAL_STATUSES`/`AUTHORIZING_STATUSES`/`legalNextStatuses`/`canTransitionStatus`）、记录与提案（`CandidateRecord`/`ProposedChange`/`ProposalInput`/`ProposalOutcome`/`candidatesById`/`proposeCandidate`）、谱系（`lineage`）、迁移（`transitionCandidate`/`decisionToStatus`/`applyGateDecision`/`makerRuling`）、三态闸门（`GateVerdict`/`GateReason`/`GateDecision`/`GatePolicy`/`DEFAULT_GATE_POLICY`/`gate`）、判负（`NearMiss`/`ChangeRejectedError`/`assertChangeAuthorized`）。
- **目标职责**：保留候选谱系与判负的**纯判定**。**接线事实必须如实**：生产只接 `transitionCandidate`（`evolve/gray.ts:82`、`sandbox.ts:85`、`cutover.ts:93`）与 `assertChangeAuthorized`（`evolve/evolve-guard.ts:47`）；`proposeCandidate`/`lineage`/`gate`/`applyGateDecision`/`makerRuling`/`decisionToStatus` **只出现在 daemon 的 evolution e2e 测试**，生产 src 零 import——不得称「进化管线已上线」。
- **非职责**：不连库、不跑沙箱、不做灰度/切权/复盘（daemon `evolve/`）、不做资产的自动批准（`criterion` 类恒 `escalate` 是 fail-closed 语义）。
- **内部结构**：`CandidateRecord` 对齐 `candidates` 列；`parent_id` 链 fork-only，环/断链 fail-closed；同 `asset_path×diff_hash` 幂等提案；`gate` 依据 `blastRadius` 与判据类资产给三态；`assertChangeAuthorized` 在「无 candidate id 的生产改动」时抛 `ChangeRejectedError` 并带 `nearMisses`。
- **导出面/依赖**：上述 30 个符号；依赖 contract `ClassifiedError`。
- **IO 与注入**：零 IO；`now`/ID 由入参；沙箱执行与库读取全在调用方。
- **状态/并发/恢复**：纯函数；状态机非法迁移显式拒（抛 `ClassifiedError`，目标态 `failure:'rejected_precondition'` + `category:'CONFIG_INVALID'`）；`gate` 返回三态不抛；无锁、无恢复。
- **错误/秘密/可观测**：`ChangeRejectedError`（`Error & ClassifiedError & { change, nearMisses }`，`evolution.ts:529`）现只设 `category='CONFIG_INVALID'`、`subcause='evolve/unauthorized'` → 目标态补 `failure:'rejected_precondition'`（「缺授权证据」是前置不成立，不是权源不足：`rejected_authority` 留给真正的权威面端口）；`nearMisses` 只含 id/路径/状态，不含文件内容片段；`detail` 不得含绝对路径。非法迁移与坏输入同走 `rejected_precondition`——**不得**借 `category` 把治理结论塞进错误通道（治理结论走 `GateDecision` 三态）。
- **测试与证据**：`test/evolution.test.ts` 54 例（状态机全边、环/断链、幂等提案、三态闸门、判负与近失）；daemon 侧 `test/evolve/evolution-e2e.test.ts` 另有用例（归 17 卷）。fake 边界：内存记录；不证明沙箱执行、不证明库接线、不证明灰度结果。V 级：V2。
- **规模**：575 → ≤575 行（**零增长**）；触 600 时按 §3.3 拆 `evolution/lineage.ts`、`evolution/gate.ts`、`evolution/authorize.ts`，facade 保留，拆前须批示。
- **迁移与删除边界**：零行为迁移；若拆件，`index.ts` 与 daemon 的 import 路径须同步改，且新目录 `src/evolution/` 会新增一个目录平面（不违反 25/600，但要登记）。

### 5.7 纯求值（目标-新增，6 件）

六件全部**未实施**，分两族同步纯函数：`rule/` 五件（`Rule Profile` 求值）与 `work-readiness.ts` 一件（开工五门；80-§7.2 2h 点名该路径）。两族**不得互相替代**：规则求值答「这条规则在这份输入上得出什么结论」，五门答「这张单能不能开工」。目录用**单数** `rule/`（80-§6.9），此前写作 `rules/` 属与上位不一致，已按「以 §6.9 为准」更正并登记为 81 改动项（§六-18）。

〔v0.5 对齐要点〕80-§6.1 现已给出：`typecheck`/`evaluate` 两入口（第四参是 `tightening: RuleLimitTightening`，**不是** `limits: RuleLimits`）；`RuleLimits` **七项全必填**（`maxNodes`/`maxDepth`/`maxListItems`/`maxStringCodePoints`/`maxDecimalDigits`/`maxDecimalScale`/`maxSteps`），`type RuleLimitTightening = Partial<RuleLimits>`（未给=不收紧；更松即 `rejected_precondition`，不得静默取更松者）；**另三项档内固定、不在 `RuleLimits` 内**（模式输入长度、模式匹配步数、量词嵌套层数），调用侧既不得放宽也不得收紧，塞进 `RuleLimits` 即映射缺陷；`Diagnostic` 用 `location`/`expected?`/`actual?`（不写 `path`、不收进 `safeDetails`），判别联合把 `phase='limit'` 收窄到 `code='E-RULE-003'` 且 `limitsApplied: RuleLimits` 必填、其余 phase `limitsApplied?: never`；登记码 **18 个** = `E-RULE-001`–`014` + `E-RULE-020` + `W-RULE-001`/`W-RULE-002`/`W-RULE-005`。因此 §六-1 只剩**四条**残余问题（`RuleProfile` 空接口、`profileRef` 两套命名、`inputsDigest` 规范化入口、`E-RULE-020` 与 `Err(rejected_version)` 双落点），且第三条残余新增一项：`W-RULE-001`/`W-RULE-002` 需要「策略条目状态」而 `RuleInput` 没有该字段（§六-14）。

共同纪律（六件同形，逐条适用）：输入=**已解析值 + 带版本引用**；输出=**判决 + 逐门/逐步诊断**；**同步纯函数**——不读宿主时间、网络、模型、文件，不落任何记录；异步解析、记录装配、接线与强制点一律归调用方或端口层。**核心失败留在 `Ok`、只有前置/版本/墙钟才走 `Err`**——`refused`、`unknown`、`不可开工`、`gaps` 非空都不是 `Err`（80-§5.7 末条、§6.1 末条、§6.4 末节）。

共同上位：80-§6.1 `TS-PORT-RULE-01`、80-§6.0 端口表（`RuleEvaluator`=新建，纯函数落 core）、80-§6.4 `TS-PORT-WORK-03` 与末节 `TS-PORT-RES-01`、80-§6.9（落点）、80-§7.2 2h/2i、80-§5.7（错误两轴）、80-§2.1 core 目标语义、80-§13.1 D13/D18/D24；76-§6.3（节点封闭集）、76-§6.4（类型系统与四条硬规则）、76-§6.5（缺失/空/假/零/未知 + `absenceTolerant` + `defaultOf`）、76-§6.6（算子表）、76-§6.7（三值与短路）、76-§6.8（`DEF-RULE-06` 结果字段）、76-§6.9（限额）、76-§6.10（线性 NFA 子集）、76-§6.11（确定性禁令）、76-§6.12（诊断码）。

#### `F-core-work-readiness` · `packages/core/src/work-readiness.ts`

- **路径/处置**：`packages/core/src/work-readiness.ts`；**目标-新增**（未实施）。80-§7.2 2h 显式给出该路径，属合法目标新增；它与 80-§6.9 末段「新文件进既有子目录」的示例（`core/src/work/`）存在口径差异，本卷按 2h 的**显式路径**执行并登记（§六-19）。
- **上位**：80-§7.2 2h（文件路径；五组输入；五门不得被并发四闸替代；风险不进五门；纯函数求值）；80-§6.4 `TS-PORT-WORK-03`（端口签名、`ReadinessRequest`/`GateResult`/`ReadinessCondition`/`RecReadinessJudgment` 的 TS 形状与五门角色映射，本件是其纯核）；77-§4.4.1（`REC-WORK-04` 13 字段与三值 `verdict`）；80-§6.4 末节（「合同 → 计划锁 → 五门」顺序与 `resource_baseline`）。
- **现有职责**：N/A（新件，现状无此文件）。
- **目标职责**：导出同步纯函数 `judgeReadiness` 与实现入参 `ReadinessResolved`（字段按 80-§6.4 的解析层定义），输出**完整的 `RecReadinessJudgment`（13 字段，不增不减）**：
  - `judgeReadiness(req: ReadinessRequest, resolved: ReadinessResolved): RecReadinessJudgment`（同步、无 `Result`）：进入纯核前五组引用已解析、`resourceBaseline` 已现算、结构已校验；`Err` 面在 daemon 的 `engine/work/readiness.ts`，本件不产生 `ClassifiedError`。
  - `ReadinessResolved` 的家就是**本文件**，不迁入 contract、不是公共端口；包根以 `export type` 暴露给 daemon 的装配层，不能因此把它当成跨框架规范。纯核不 import `rule/*`，规则结果只经解析层带入。
- **13 字段逐条（来源分三类：产出 / 透传 / 组装）**：
  1. `contractRef: VersionRef<Qid>` —— **透传** `req.contractRef`（权门前半）。
  2. `decidedBy: SubjectRef` —— **透传** `resolved.decidedBy`：合同指定且当前有效任命的承接者，由 daemon 解析；本件不从五门挑选、不接受自报，逐门判断者仍在各自 `judgedBy`。
  3. `authorityRef: VersionRef<Qid> | DefinitionRef` —— **透传** `req.authorityRef`。
  4. `gateResults: readonly GateResult[]` —— 本件**产出**：恰五门各一条；`gate`/`criterionRef`/`basisRefs`/`judgedBy`/`role`/`authorityRef` 由 `resolved.gates` **透传**，`verdict` 由本件判（逐门三值）。
  5. `verdict: ReadinessVerdict` —— 本件**产出**，按下方聚合规则。
  6. `scopeJudged: { judged: string; notJudged: string }` —— **透传** `resolved.scopeJudged`，且必须写明「不判验收、价值与后续变更」；为空即记录不合格。
  7. `conditions?: readonly ReadinessCondition[]` —— 本件**汇总**：把各门给出的附条件项按门序拼成数组；每项四字段 `condition`/`ownerRef`/`dueAt`/`onMiss`（`'pause'|'forward'|'reject'`）**全部由入参给**，本件不得自造责任者或到期时点。
  8. `judgeRole: readonly { gate: ReadinessGate; role: ReadinessJudgeRole }[]` —— 本件**产出**：恰五门、每门一项，值为 `gateResults[i].role` 的**逐门投影**；两处逐门同值，不一致即记录不合格。
  9. `decidedAt: Timestamp` —— **透传** `req.decidedAt`（判断时点；≠ 生效时点；本件不读宿主时钟）。
  10. `repudiationTriggers: readonly string[]` —— **透传** `resolved.repudiationTriggers`（触发重判条件；本件不改写、不排序以外不加工）。
  11. `resourceBaseline: ResourceBaseline` —— **透传** `resolved.resourceBaseline`（`subjectRef`/`quotaRef`/`entries`/`asOf`/`gaps`）；本件只读不改、不重算、不据 `gaps` 之外的推测补值。
  12. `dissentPosition: DissentPosition` —— **透传** `resolved.dissentPosition`。
  13. `decisionFacet: DecisionFacet` —— 本件**组装**：`decidedBy`/`authorityRef`/`scopeJudged`/`dissentPosition` 与顶层同名字段**同值**（facet 是权威值、顶层是只读投影，80-§4.4 第 2 条）；`basisRefs` = 五门 `basisRefs` 的并集（去重、按门序）；`rationale` = 由门结论派生的**确定性短文本**（形如「五门：authority=可开工; capability=附条件开工; …」，不得自由创作、不得含档内容/路径/秘密）；`effectiveState`/`effectiveTime?` **透传** `resolved`（生效是写入期事实，判定时点无法推出）。
- **五门与角色（门集与顺序固定）**：`authority`/`capability`/`resource`/`information`/`prohibition` 不得增删或换位。角色解析按 80-§6.4：`authorizer`/`assignee`/`resource_owner`/`info_holder`/`prohibition_owner`；能力门只有资格由独立位置认定时才可用 `qualifier`。英→中映射不变，记录 payload 只写六个中文角色，英文仅供 TS 判别。
- **聚合规则**：任一门 `不可开工` → 整体 `不可开工`；否则任一门 `附条件开工` → 整体 `附条件开工`；五门全 `可开工` → `可开工`。每个附条件项必须有完整四字段并进入 `conditions`；缺详情、缺门、重门或角色越界是解析层的 `rejected_precondition`，**不得**伪造成业务上的 `不可开工` 记录。
- **`RuleOutcome` 如何进门**：只由解析层带入，纯核不 import `rule/*`。`true`/`false` 支持通过/不通过；`unknown` 是输入不足，`refused` 是求值中止，二者不合并、不得判 `可开工`；`refused` 使该门与整单 `不可开工`。端口先把结果落为 `REC-EVT-01` 操作观察，`basisRefs` 保存该事件 `RecordRef`，`GateResult` 不加第二槽位。
- **顺序**：合同 → 计划锁（同事务写 `REC-WORK-05.resource_reservations`）→ 五门（读锁后现算的 `resourceBaseline`）→ 出工段。计划锁不等于五门通过；没有计划/预留记录时按未知缺口处理，不得当作资源充足。本件不执行锁、不派出工段。
- **非职责**：不解析引用、不落 `REC-WORK-04`、不写资源账目、不判风险与验收、不做并发四闸、不读公司目录/平台、不产事件、不读时钟。
- **内部结构与诊断**：五个门函数 + 聚合器 + 组装器；恰五门、`judgeRole` 与逐门 `role` 一致、facet 与顶层投影一致。结构不符由端口拒收，不落判断记录。诊断复用 `RuleOutcome.diagnostics` 与 `ResourceBaseline.gaps`；结构化内部 reason 可映射事件 note，**不自造 `E-READY-*`**。
- **导出面/依赖**：导出 `judgeReadiness`；`ReadinessResolved` 定义在本件并由包根 `export type` 提供给 daemon 装配层，**不是公共端口或跨框架规范**。依赖只有 contract 类型；不 import `flows`/`decide`/`rule/*`/`resources/*`。
- **IO/状态/错误**：零 IO、无状态、可重入，同输入必同输出（含 rationale 与条件顺序）；不抛 `ClassifiedError`、不返 `Err`。缺版本、引用解析失败、资源 `Err` 与非法结构均在端口层拦截，根本不调纯核；诊断不含凭据、路径或档内容片段。
- **测试与规模**：`F-core-test-work-readiness`（目标-新增）用手写引用/结果/基线覆盖五门聚合、附条件、缺详情拒收、角色、资源未知与 `refused`；不证明端口解析、记录落盘或真实目录。目标 ≤400 行，未实施。
- **迁移与删除边界**：① 本件与 `ReadinessResolved` 按 80-§6.4 落盘；② 13 字段与聚合规则一次完成并配测试；③ 未接线的纯核先做包级验证；④ 由 `engine/work/readiness.ts` 负责解析/证据/记录装配，先五门后并发四闸；⑤ 包根导出与实现同批，禁止先做只有五门结论、没有完整记录的半成品。§六-2/4/15 的设计缺口已关闭，剩余只是实现与验证未做。

#### `F-core-rule-typecheck` · `packages/core/src/rule/typecheck.ts`

- **路径/处置**：`core/src/rule/typecheck.ts`；**目标-新增**（未实施）。80-§6.9 把 `typecheck` 单列为 `rule/` 的示例文件之一；本卷据此从「`evaluate.ts` 内两个入口」拆为独立件（§3.3）。
- **上位**：80-§6.1 的 `typecheck(profile, decl)` 签名与 `TypecheckReceipt` 四字段；76-§6.5 第 3 条（类型错误在求值前拒）、76-§6.7 两条防滥用规则（被短路的分支也要静态检查）；76-§6.3 节点封闭集、76-§6.4 类型系统与四条硬规则。
- **现有职责**：N/A（新件）。
- **目标职责**：导出 `typecheckRule(profile: RuleProfile, decl: RuleInputDecl): Result<TypecheckReceipt, ClassifiedError>`（端口方法名是 `typecheck`，core 导出名加 `Rule` 后缀避免包根同名，§四.13）。逐项：
  - **遍历整棵树**，包括会被短路的分支；字段路径必须**静态可解析**（只允许档内声明过的段，禁计算/索引/通配）。
  - 产出的码**只限 `typecheck` 相位**：`E-RULE-004`/`005`/`006`/`011`/`013` 与 `W-RULE-005`；**不产** `W-RULE-001`/`W-RULE-002`（都需要策略条目状态，`RuleInput` 没有该字段，§六-14）、**不产** `E-RULE-010`（`eval` 相位的枚举词表检查）、**不产** `E-RULE-001`/`002`/`014`（`parse` 相位）、`E-RULE-003`（`limit` 相位）、`E-RULE-020`（`policy` 相位）。
  - **`TypecheckReceipt` 四字段**：`profileRef`（**取自档自身**的 `semanticDigest`/`version`，调用方不另传；与 `RuleProfileRef` 的 `profileId`/`version`/`digest` 命名对齐见 §六-1 残余②）、`inputDeclDigest`（`semanticDigest`）、`limitsApplied`（**七项全量**，只报告可收紧项，档内固定三项不出现）、`diagnostics`（按 `location` 字典序再按 `code` 稳定排序）。
  - `profile` 是**已装载的只读值**（深冻结、无 getter），不是 id；`profileRef` 与 `profile` 实际不一致（自查发现的摘要不符）⇒ `Err(rejected_precondition)`。
  - 诊断字段只用 `location`/`expected?`/`actual?`/`messageKey`/`messageArgs` 等 80-§6.1 定义项，**不写 `path`**、不把细节塞进 `safeDetails` 之类的容器。
- **非职责**：不求值（不产 `RuleOutcome`）、不解析档文本（`parse` 相位归装载层与 contract）、不编译模式（`E-RULE-014` 已在 parse 拒；本件只做类型面检查）、不选档、不判授权/验收、不落盘、不产事件。
- **内部结构**：`typecheckTree`（遍历 + 委派 `operators.typecheckNode`）+ `Context`（diagnostics 缓冲、`limitsApplied`）+ `sortDiagnostics` + `toReceipt`。**不持有步数计数**（步数是 `eval` 相位的事）。
- **导出面/依赖**：只导出 `typecheckRule`；类型从 contract 引（`RuleProfile`/`RuleInputDecl`/`TypecheckReceipt`/`Diagnostic`/`ClassifiedError`），不重复声明。依赖 `./operators.ts`、`./values.ts`（类型/标度检查）、contract 类型与规范化入口（`inputDeclDigest`，入口未指定见 §六-1 残余③）。
- **IO 与注入**：零 IO；无时钟、无随机、无 ID。
- **状态/并发/恢复**：纯函数、可重入、无缓存；同档同声明必同 `receipt`（含诊断顺序）。
- **错误/秘密/可观测（只有一条 `Err`）**：类型错误 ⇒ `Err({ failure:'rejected_precondition', category:'CONFIG_INVALID', subcause:'rule-typecheck' })`，**不进 `evaluate`**；其余全部语义结论都在 `Ok`（成功时 `diagnostics` 可含 `W-RULE-005`）。诊断只含码、`location`、限额数值、`expected`/`actual` 短文本；不回输入值、不回档内容片段、不回宿主路径。
- **测试与证据**：`F-core-test-rule-typecheck`（目标-新增）。fake 边界=手写档 AST 与 `RuleInputDecl`；不证明 contract 类型齐备（§六-1）、不证明真实档从磁盘装载。
- **规模**：≤250 行。
- **迁移与删除边界**：随 `rule/` 五件一起落，顺序见 §七 批次 2（`values` → `pattern` → `operators` → `typecheck` → `evaluator`）；`typecheck` 与 `evaluator` **同日落地**，不得只落一个。

#### `F-core-rule-evaluator` · `packages/core/src/rule/evaluator.ts`

- **路径/处置**：`core/src/rule/evaluator.ts`；**目标-新增**（未实施）。80-§6.9 的示例名即 `evaluator.ts`。
- **上位**：80-§6.1 的 `evaluate` 签名（第四参 `tightening`）与 `RuleOutcome` 七字段；76-§6.8 `DEF-RULE-06` 的四值语义；76-§6.9 的七项可收紧限额与三项档内固定；76-§6.11 确定性。
- **现有职责**：N/A（新件）。
- **目标职责**：导出 `evaluateRule(profile: RuleProfile, ref: RuleProfileRef, input: RuleInput, tightening: RuleLimitTightening): Result<RuleOutcome, ClassifiedError>`。逐项：
  - **前置**：`profile` 已 `typecheckRule` 通过；`ref` 的 `profileId`/`version`/`digest` 与 `profile` 实际一致，`digest` 是 `semanticDigest`；`input` 是纯数据（无函数、无 getter、无类实例、无 `Date`）。
  - **限额收紧**：生效值逐项 = `min(档内声明, tightening[项])`；`tightening` 未给该项 = 取档内声明（不收紧）；给得更**松** = `Err(rejected_precondition)`，**不得静默取更松者**；试图传入三项档内固定值（模式输入长度/模式匹配步数/量词嵌套层数）= 映射缺陷 ⇒ `Err(rejected_precondition)`。`RuleLimits` **七项全必填**，`RuleLimitTightening` 是 `Partial<RuleLimits>`——不得把七项写成可选后再补默认值。
  - **`limitsApplied` 必填**：回报七项**实际生效值**（证明调用方没有放宽）；缺此项即无法对账。
  - **结果值四值不合并**：`outcome` ∈ `'true'|'false'|'unknown'|'refused'`。`unknown` = **输入不足**（显式缺失且档声明 `absenceTolerant`、或未知值传播）；`refused` = **求值中止**（除零、溢出/标度超限、空聚合、枚举码不在词表、模式超限、步数超限）。二者**不是** `false` 的别名，也都不折算布尔；`refused` 留在 `Ok`。调用方不得把 `outcome` 先折成布尔再判。
  - **`RuleOutcome` 七字段**：`outcome`/`profileRef`/`inputsDigest`/`steps`/`limitsApplied`/`diagnostics`/`trace?`；`profileRef.digest` 与 `inputsDigest` **必须**是 `semanticDigest`（带 `canonicalizationId`/`version`），**禁** `byteDigest`（sha8 更不得顶替）；`steps` 是整数（由限额决定，不由机器速度决定）；`trace` 截断必须标 `truncated:true`，不得静默截断、不得把截断片段当完整轨迹。
  - **诊断码封闭（18 个）**：只取 76-§6.12 登记码；本件可能产生的相位是 `eval`（`E-RULE-007`/`008`/`009`/`010`/`012`）与 `limit`（`E-RULE-003`，且该诊断**必带** `limitsApplied`）；`E-RULE-020`（`policy`）按下方口径；`parse`/`typecheck` 相位的码不在本件产生。**不得**把规模类一律写成 `limit`（`E-RULE-012` 是步数、归 `eval`），**不得**把 `'structure'`/`'refResolve'`/`'io'` 当兜底桶（`'io'` 本纯函数不得产生）。
- **`E-RULE-020` 与 `Err(rejected_version)` 的界（80-§6.1 已定）**：档本身不可解析 / 版本无法成立 ⇒ `Err({failure:'rejected_version', category:'EVOLVE_REJECT', subcause:'rule-version'})`；档已解析但档内引用/被引条目版本不一致或被撤回 ⇒ `Ok` + `refused` + `E-RULE-020`（`phase='policy'`）。两条都不得折算 `false`，也不得在 `Ok` 里返回 `Err` 形状。
- **非职责**：不解析档文本、不选档、不做 `typecheck`（类型错误必须先被 `typecheckRule` 拒）、不判授权/验收、不落盘、不产事件、不做策略方向表（`W-RULE-001`/`W-RULE-002` 需要条目状态，不属本件，§六-14）、不做公司目录结构校验（80-§10.6/D17 已定 `repo-validate` 留 company，**不下沉 core**；§六-13 已关闭）。
- **内部结构**：`EvalContext`（步数计数、诊断缓冲、`limitsApplied`、档引用）+ `evaluateTree`（委派 `operators.evaluateNode`）+ `refuse(code, location)`（立即中止并产 `refused`，**不抛**）+ `toOutcome`（组装七字段）+ `sortDiagnostics`（先 `location` 字典序、再码）。`inputsDigest` 由 `createRuleEvaluator({canonicalizer})` 对原始 JSON 输入快照计算（80-§6.1，Int/Dec 保留 `DecimalString` 词法），与 `TS-SCALAR-08` 同源；**不得**私造第二套规范化，也不得先把数值转成 `number` 或 `bigint` 再摘要。
- **导出面/依赖**：只导出 `evaluateRule`；类型从 contract 引（`RuleProfile`/`RuleProfileRef`/`RuleInput`/`RuleLimits`/`RuleLimitTightening`/`RuleOutcome`/`Diagnostic`/`ClassifiedError`）。依赖：contract 类型、`./operators.ts`、`./values.ts`、`node:crypto`（摘要）。禁止 import `flows`/`decide`/`models`。
- **IO 与注入**：零 IO；不取时钟、不取随机、不取 ID；`RuleInput.observedAt` 由调用方给，本件不读宿主时间。
- **状态/并发/恢复**：纯函数、可重入、无缓存；同档同输入同限额必同输出（76-§6.11）。
- **错误/秘密/可观测（三类 `Err`，其余全在 `Ok`）**：① `tightening` 更松或触碰档内固定三项 ⇒ `rejected_precondition`/`CONFIG_INVALID`/`rule-tightening`；② 档不可解析或版本无法成立 ⇒ `rejected_version`/`EVOLVE_REJECT`（见上）；③ 宿主墙钟护栏触发 ⇒ `Err({failure:'timeout', category:'STALL', subcause:'host-clock-guard'})`，**不得**折算 `false`、不得进 `RuleOutcome`。其余语义失败一律 `Ok` + `refused`/`unknown` + 诊断码。诊断只含码、`location`、限额数值与 `messageKey/messageArgs`；不回输入值、不回档内容片段、不回宿主路径。
- **测试与证据**：`F-core-test-rule-evaluator`（目标-新增）。fake 边界=手写档 AST 与手写 `RuleInput`；不证明 contract 类型齐备（§六-1）、不证明 77 采纳求值结果、不证明真实档装载、不证明 `semanticDigest` 跨实现（82 `GAP-82-06`）。
- **规模**：≤320 行。
- **迁移与删除边界**：在 `typecheck` 同日落地（批次 2），`index.ts` 再导出在批次 4；若 contract 最终不采纳该端口，`rule/` 五件整体不落地，不留半成品。

#### `F-core-rule-values` · `packages/core/src/rule/values.ts`

- **路径/处置**：`core/src/rule/values.ts`；**目标-新增**（未实施；包内实现细节，不做包根再导出）。
- **上位**：76-§6.4 的封闭类型集（`Bool`/`Int`/`Dec(s)`/`Str`/`Ts`/`Dur`/`Enum`/`List(T)`/`Rec`）与四条硬规则；76-§6.6 的算术与比较语义；76-§6.9 的十进制限额（34 位有效数字、9 位标度）。
- **现有职责**：N/A（新件）。
- **目标职责**：提供值的**表示与精确运算**——封闭值的判别表示（含 `unknown` 与 `null` 的独立表示，76-§6.5）、`Dec` 的标度化精确加减乘除与取模、比较（`Dec` 按精确数值跨标度、`Ts` 按瞬时、`Dur` 按总时长、`Str` 按码点序且归一策略由档声明）、显式转换白名单（只有 `dec(Int)` 与 `int(Dec)`，后者仅小数部分为零，否则**错误而非舍入**）、有效数字与标度检查。
- **非职责**：不解析文本、不做 IO、不实现模式匹配、不做类型检查策略（那在 `operators`）、不做隐式转换（76-§6.4 第 1 条硬规则）；**不承担 `DecimalString` 的交换语义**（那是 resources 面，见 §3.4 与 §六-17）。
- **内部结构**：封闭值判别联合；`Dec` 只保留「值 + 标度」的业务表示，**禁浮点**。`add`/`sub`/`mul`/`div` 调 `../decimal.ts` 的同一有理数实现；`mod` 由该实现的 `div`/`mul`/`sub` 与显式取整组合，不另造浮点算法；`compare` 按类型分派；`convert` 只接受白名单两项；`checkLimits` 检查 34 位与 9 位；另提供**码点工具**（`codePoints`/`compareCodePoints`）供 `pattern.ts` 单向使用。所有失败以错误码返回，由 `operators`/`evaluator` 转成诊断。
- **导出面/依赖**：值类型与运算函数仅供包内 `operators`/`typecheck`/`evaluator` 使用（**不加入包根导出**）；依赖 contract 值类型与 `../decimal.ts`，**不依赖 `pattern.ts`**——`pattern` 单向依赖本件的码点工具，反向依赖会成环。不得恢复本地 BigInt 四则实现。
- **IO 与注入**：零。
- **状态/并发/恢复**：纯函数；BigInt 不可变，无共享状态。
- **错误/秘密/可观测**：返回码 `E-RULE-004`（类型/转换）、`E-RULE-008`（溢出/标度/空列表聚合）；不抛；不含秘密。
- **测试与证据**：**无专属测试文件**——用例并入 `typecheck.test.ts` 与 `evaluator.test.ts`（同为档语义测试）；`pattern.test.ts` 只测模式。fake 边界=手写值；不证明 34 位/9 位的跨实现一致，不证明 BigInt 性能（§八-6）。
- **规模**：≤250 行。
- **迁移与删除边界**：随 `rule/` 五件一起落地；删除边界同 `evaluator`。

#### `F-core-rule-operators` · `packages/core/src/rule/operators.ts`

- **路径/处置**：`core/src/rule/operators.ts`；**目标-新增**（未实施；包内实现细节）。
- **上位**：76-§6.3 的封闭节点集；76-§6.4 的「静态类型检查先于求值」「字段路径必须静态可解析」；76-§6.5 的缺失/空/假/零/未知与 `defaultOf` 告警；76-§6.6 的算子全表；76-§6.7 的三值真值表与两条防滥用规则。
- **现有职责**：N/A（新件）。
- **目标职责**：两段式，且**两段产出的码严格分相位**（80-§6.1 固定映射）——`typecheckNode`（对整棵树做静态检查，**包括会被短路的分支**；只产 `E-RULE-004`/`005`/`006`/`011`/`013` 与 `W-RULE-005`，`defaultOf` 告警在此时给；**不产** `E-RULE-010`，那是 `eval` 相位的「枚举码不在词表」）与 `evaluateNode`（按节点分派：算术、比较、字符串、列表、量词、谓词、条件；`and`/`or` 按三值表与短路规则；`all`/`any` 按 76-§6.7 的短路与未知合并；产出 `E-RULE-007`/`008`/`009`/`010`/`012`）。`E-RULE-002`（算子不在本档）与 `E-RULE-014`（被禁止的构造）属 `parse` 相位，**不由本件产**；`E-RULE-003` 属 `limit` 相位、`E-RULE-020` 属 `policy` 相位，同样不在本件；`W-RULE-001`/`W-RULE-002` 也**不产**（需要策略条目状态，§六-14）。字段路径解析只允许 `input(root).fieldPath` 与 `var(name)`，解析不到即 `E-RULE-013`。`matches` 委派 `pattern.ts`；字符串 `contains` 由本件按**码点**做子串查找，**不**走模式子集。本件**返回诊断与步数增量**，`TypecheckReceipt`/`RuleOutcome` 的组装在 `typecheck.ts`/`evaluator.ts`（本件不构造外层结果类型）。
- **非职责**：不提供 76-§6.6 末尾列出的「刻意不提供」算子（`implies`、字符串替换/分割、正则捕获与回填、`now()`、`env()`、`random()`、任意数学函数、浮点）；不做隐式转换；不吞掉被短路分支的类型错误。
- **内部结构**：`typecheckNode`、`evaluateNode`、`applyBinary`/`applyUnary`、`applyQuantifier`、`applyPredicate`、`resolveFieldPath`；错误在**被求值的**子树上发生时立即中止并记 `refused`，**不得**记 `false`（76-§6.7 第 2 条）。
- **导出面/依赖**：`typecheckNode`/`evaluateNode` 供 `typecheck`/`evaluator` 使用（**不加入包根导出**）；依赖 contract 节点类型、`./values.ts`、`./pattern.ts`。
- **IO 与注入**：零。
- **状态/并发/恢复**：纯函数；诊断缓冲与步数计数由调用方传入的上下文持有，不跨调用。
- **错误/秘密/可观测**：全部以诊断码表达；`W-RULE-005` 只表示「对缺失赋了缺省」，**不**表示判定通过；不含秘密。
- **测试与证据**：并入 `typecheck.test.ts`（静态面：被短路分支的类型错仍拒、`defaultOf` 告警）与 `evaluator.test.ts`（求值面：三值表、短路、量词、运行时错误→`refused`）。不证明宿主语言求值行为（本件不调用 `eval`）。
- **规模**：≤350 行。
- **迁移与删除边界**：随 `rule/` 五件一起落地。

#### `F-core-rule-pattern` · `packages/core/src/rule/pattern.ts`

- **路径/处置**：`core/src/rule/pattern.ts`；**目标-新增**（未实施；包内实现细节）。
- **上位**：76-§6.10（`DEF-RULE-08`）的允许/禁止构造、`matchingModel = linear-nfa`、整串锚定语义；76-§6.9 的**三项档内固定**限额（模式输入长度 100 000 码点、模式匹配步数 1 000 000、量词嵌套层数）；76-§6.12 的 `E-RULE-009`/`E-RULE-014`。
- **现有职责**：N/A（新件）。
- **目标职责**：只实现 `matches(x, pattern, fixedLimits)`——**整串匹配**，线性时间自动机模型；允许字面字符、字符类（含范围与取反）、`.`（默认不含换行）、`^`/`$`、量词 `? * + {m} {m,} {m,n}`（`m,n ≤ 1000`）、分组与选择、转义类 `\d`/`\w`/`\s` 及取反。禁止反向引用、环视、原子组、条件组、递归、子例程、占有量词、内联模式开关（大小写等必须以参数声明）、除 `^`/`$` 外的零宽断言。
- **三项档内固定限额（不得进 `RuleLimits`）**：模式输入长度、模式匹配步数、量词嵌套层数由**档内声明**随 `profileRef` 锁定；`fixedLimits` 由调用方从档里取出后传入，**调用侧既不得放宽也不得收紧**（`evaluator` 已对「试图收紧/放宽这三项」返回 `rejected_precondition`）。本件不得接受来自 `RuleLimitTightening` 的值。
- **非职责**：不实现 `contains`（子串查找是码点级操作，在 `operators` 侧）；不做替换、捕获回填、分割；**不调用宿主 `RegExp`**（宿主语义既不能保证线性时间，也不保证与线性 NFA 的接受/拒绝完全一致）。
- **内部结构**：解析（拒绝禁止构造 → `E-RULE-014`）→ 编译为 NFA（含量词展开的状态数上限与**量词嵌套层数**检查）→ 模拟（带步数计数，超档内步数上限 → `E-RULE-009`）；输入长度超档内上限同样 `E-RULE-009`。步数计数与 `evaluate` 的**总步数**是两本账：本件的步数只记本算子，总步数由 `EvalContext` 汇总（两本账不得互相折算）。
- **导出面/依赖**：`compilePattern`/`matchWhole`（仅供 `operators` 使用）；依赖 contract 的诊断类型、`./values`（字符串码点处理）。
- **IO 与注入**：零。
- **状态/并发/恢复**：纯函数；编译结果不缓存（缓存会引入跨调用状态与内存增长，且与「同输入同输出」无关）。
- **错误/秘密/可观测**：模式文本可能来自档，**不得**回显整条模式到诊断（只回位置与码），避免把档内容带进出站面；`E-RULE-009` 回报实际步数与档内限额。
- **测试与证据**：`F-core-test-rule-pattern`（目标-新增）。fake 边界=手写模式与文本、手写档内三项限额；不证明与任何第三方正则实现等价（只证明与 76-§6.10 子集的接受/拒绝一致），不证明最坏情况性能（步数上限是语义护栏，不是性能基准）。
- **规模**：≤200 行。
- **迁移与删除边界**：随 `rule/` 五件一起落地；若 76-§6.10 的子集扩项或改三项固定值，先改 76 再改本件。

### 5.8 资源、规格与权威的纯逻辑（目标-新增，12 件）

十二件全部**未实施**，对应 80-§6.9 落点表的 core 子域与 `decimal.ts` 共享算法。共同点：**只做同步纯判定/派生**；端口签名（`Promise<Result<…>>`）在 contract，读盘/扫包/租约与围栏持久化/记录追加在 `assembly/spec/`、`assembly/auth/`、`store/src/lease/`、`store/src/records/`、`store/src/resources/`；core 不新增公共概念、不新增诊断码空间、不写任何 `REC-*`。三组之间**互不 import**（`authority/` 五件互不 import；`resources/*` 只 import `./quota.ts`；`spec/importer → spec/registry` 是唯一例外）；`rule/values.ts` 与 `resources/quota.ts` 分别引用 `../decimal.ts`，共享算法而不共享业务语义。

#### `F-core-decimal` · `packages/core/src/decimal.ts`

- **路径/处置**：`packages/core/src/decimal.ts`；**目标-新增**（未实施）。`DecimalArithmetic` 的唯一实现，禁止第二份十进制算法。
- **上位**：76-§1.2.1（`DEF-SYN-08`）、80-§5.11；`DecimalString` 的语法归 76-§1.2，资源/成本/规则的调用归各自文件。
- **职责**：以符号、分子、分母（`bigint`）表达有理数，提供 `parse`/`add`/`sub`/`mul`/`div`/`compare`；`add` 等同 `DecimalArithmetic`，各方法返回 `Result<DecimalString, ClassifiedError>`，`compare` 返回 `Result<-1|0|1, ClassifiedError>`。`DecimalOptions = { scale?: number; mode?: 'half-even'|'floor'|'ceiling' }`，`scale` 为整数 0..9、缺省 9，`mode` 缺省 `half-even`。约分后按声明精度舍入。
- **非职责**：不读文件、不取时钟、不做单位/币种/时区换算、不做授权、不读写台账、不解析 Rule Profile、不提供近似值。不得导出第二套 `addDecimal`/`subDecimal` 实现。
- **内部结构**：`DecimalParts` 有理数结构；解析保留词法（不补零、不去尾零）；对齐、约分、half-even/floor/ceiling 舍入；`MAX_WORKING_DIGITS=128`；输出 ≤34 位有效数字且标度 ≤9。`compare` 精确比较，故 `1.20=1.2`，但 `semanticDigest` 可不同。
- **导出与依赖**：`parse`/`add`/`sub`/`mul`/`div`/`compare`；只 `import type` contract 的 `DecimalOptions`/`DecimalString`/`ClassifiedError`，值依赖 `classified`。无 IO、无第三方库、无浮点兜底。数值本体不得经 `Number()`/`parseFloat()`/`Math.*`；下标、`scale`、字符串长度可用普通整数。
- **IO 与注入**：零 IO；所有输入由调用方给。
- **状态/并发/恢复**：纯函数、无状态、可重入；同一输入逐字节一致。
- **错误/秘密/可观测**：非法词法/负数时长/除零 ⇒ `rejected_precondition`（除零子因 `decimal-divide-by-zero`）；输出超 34 位或中间超 128 位 ⇒ `unsupported` + `decimal-overflow`，不静默截断。非法单位换算在调用方拒绝，本件不报业务缺口。错误不含原始秘密或本机路径。
- **测试与证据**：`F-core-test-decimal`（目标-新增）。固定 76-§1.2.1 向量：`0.1+0.2=0.3`、`1.20=1.2`、`-1.5` 在 `scale=0, half-even` 为 `-2`、`2.5` 为 `2`、`1/3` 在 `scale=9` 为 `0.333333333`；另覆盖除零、34 位输出溢出、128 位中间溢出、非法指数、负值 floor/ceiling、原始词法保留。V2 纯函数；不证明跨实现或真机性能。
- **规模**：≤350 行；测试 ≤300 行。
- **迁移**：由 `rule/values.ts` 与 `resources/quota.ts` 调用；先落本件和测试，再接两调用方，最后才允许 barrel 导出；不得先删各自旧算法造成空窗。

#### `F-core-test-decimal` · `packages/core/test/decimal.test.ts`

- **路径/处置**：`packages/core/test/decimal.test.ts`；**目标-新增**（未实施）。包级 `typecheck` 含 `test/**/*.ts`，不是独立服务。
- **覆盖**：76-§1.2.1 全部共同向量、精度/舍入/除零/溢出/单位拒绝、`bigint` 中间值不被截断、`Number`/`parseFloat` 不出现。并做与 `rule/values.ts`、`resources/quota.ts` 的同输入一致性断言，证明只有一个算法入口。
- **夹具/断言**：固定字符串与 `ClassifiedError` 三轴；不把 big integer 转成 Number；不证明跨语言互操作或生产性能。
- **规模**：≤300 行。

#### `F-core-resources-quota` · `packages/core/src/resources/quota.ts`

- **路径/处置**：`core/src/resources/quota.ts`；**目标-新增**（未实施）。80-§6.9 给 `core/src/resources/` 的落点，本卷按「额度与逐项派生」/「基线与缺口」拆两件。
- **上位**：80-§6.4 末节 `TS-PORT-RES-01`（`ResourceLimit` 三态、`ResourceEntry` 六字段、缺省=未知、`finite` 三值齐备才给 `remaining`）；80-§4.1 `TS-SCALAR-04`（`DecimalString` 格式：可选负号、无前导零、禁指数、≤34 位有效数字、标度缺省 ≤9）；77-§4.4.1（`resource_baseline` 子结构）/§4.5.1（`REC-WORK-05.resource_reservations` 逐项 `{resource_ref, amount, unit, period, quota_ref}`）。
- **现有职责**：N/A（新件）。
- **目标职责**：提供资源额度的**规范化**与占用的**精确累计**，全部同步纯函数：
  - `normalizeLimit(defn)` → `ResourceLimit`：`finite`（`amount: DecimalString`）/`unbounded`（**必须由定义显式声明**；缺声明一律 `unknown`，**不得**默认「无上限」）/`unknown`（带 `reason?`）。
  - `deriveEntry({ resourceRef, unit, limit, reserved?, consumed? })` → `ResourceEntry`：`remaining` **只在** `limit.kind==='finite'` 且 `reserved`/`consumed` 都有值时给出，且必须满足 `remaining = limit.amount − reserved − consumed`；任一占用缺省 ⇒ **不给 `remaining`**（缺省是**未知**，不是 0）。
  - **跨环累计不重复**：`accumulateReservations`（按 `(resource_ref, period, quota_ref)` 去重）、`accumulateActuals`（按记录 `recordId` 去重）、`applyReleases`（按 `recordId` 去重，且单次释放不得超过对应预留）——同一记录只计一次；重复行不累加、不取最后一次。
  - **精确十进制**：只调 `../decimal.ts` 的 `add`/`sub`/`compare`，不再实现 `addDecimal`/`subDecimal`/`compareDecimal`。`DecimalOptions` 的 `scale`/`mode` 必须显式传递；格式错误、除零、输出/中间精度超限由共享 `DecimalArithmetic` 返回 `ClassifiedError`，不得修正或回退到浮点。
- **非职责**：不读记录、不查库、不写预留/实际/释放、不判「是否充足」（判门在端口与 `work-readiness`）、不做单位换算、不产生 `ResourceGap`（缺口判定在 `baseline.ts`）、不新增 `E-RES-*` 诊断码、不实现第二份十进制算法。
- **内部结构**：`LimitDefn` 判别（显式 `unbounded` 标记 vs 未声明）；去重表以稳定键构造（不用 `Map` 插入顺序做判定）；`ResourceEntry` 构造器拒绝「三值齐备但等式不成立」的输入（返回结构错误，不静默改写）。`DecimalParts` 只在 `../decimal.ts` 内出现。
- **导出面/依赖**：`normalizeLimit`/`deriveEntry`/`accumulateReservations`/`accumulateActuals`/`applyReleases`；`import type` contract 的 `ResourceLimit`/`ResourceEntry`/`DecimalString`/`DefinitionRef`，相对导入仅 `../decimal.ts`。**零值依赖、零 IO**。不 import `rule/values.ts`（§3.4）。
- **IO 与注入**：零 IO；`asOf` 不参与本件的算术（只由基线装配记录）。
- **状态/并发/恢复**：纯函数、无状态、可重入；同一输入逐字段一致（含 `entries` 顺序由 `resourceRef` 稳定排序）。
- **错误/秘密/可观测**：不抛错；不合法输入返回 `{ ok:false, reason }`（包内形状，不外泄）；不带金额以外的敏感数据；不在日志/诊断里回显额度定义原文。共享算法的 `Err` 逐字段透传，不改写成“额度为 0”。
- **测试与证据**：`F-core-test-resources-quota`（目标-新增）。fake 边界=手写额度定义、手写预留/实际/释放行；共享 76-§1.2.1 向量并断言与 `F-core-test-decimal` 同输入同结果；不证明真实 store 投影、不证明并发下的重复计数（记录侧去重由 store 的单写者保证）、不证明真机性能。
- **规模**：≤300 行。
- **迁移与删除边界**：随 `resources/` 两件一起落（批次 5）；删除边界同 `baseline`。共享 `core/src/decimal.ts` 已定为唯一入口，本件不得恢复自有算法；`rule/values.ts` 也复用同一实现。

#### `F-core-resources-baseline` · `packages/core/src/resources/baseline.ts`

- **路径/处置**：`core/src/resources/baseline.ts`；**目标-新增**（未实施）。
- **上位**：80-§6.4 末节（`ResourceBaseline` 结构、`ResourceGap` 四型、五条判定口径、错误三条、「`gaps` 非空仍返回 `Ok`」）；77-§4.4.1（`resource_baseline` 是**只读派生物**，不得当事实源）；80-§6.9（`store/src/resources/` 是投影 `resource_ledger` 的家）。
- **现有职责**：N/A（新件）。
- **目标职责**：`deriveResourceBaseline(input)` → `ResourceBaseline`（`subjectRef`/`quotaRef`/`entries`/`asOf`/`gaps`）+ `detectResourceGaps(input)`。输入**全是已读事实**：额度定义、`REC-WORK-05.resource_reservations` 项、`REC-EVD-01`/`REC-EVD-05` 的实际项、`REC-EVD-06` 的释放项、`asOf`、以及调用方给出的「记录不可读」标志。逐项：
  - **四型缺口**：`quota-unreadable`（额度定义不可解析）/`over-reserved`（预留 > 有限额度）/`unreconciled-actual`（实际与记录对不上，或实际缺失）/`reservation-record-missing`（记录里查无预留）。
  - **`finite` 缺占用即未知**：`limit.kind==='finite'` 而 `reserved` 或 `consumed` 任缺 ⇒ **必须**给对应缺口（预留缺 ⇒ `reservation-record-missing`；实际缺 ⇒ `unreconciled-actual`；两者都缺就两条都给），且该 entry **不给 `remaining`**；资源门不得据它判通过。
  - **`unbounded` 须明示**：只有定义显式声明无上限才可出 `{kind:'unbounded'}`；未声明一律 `{kind:'unknown'}` 并给 `quota-unreadable`。
  - **`unknown` 不得当充足**：`limit.kind==='unknown'` ⇒ `remaining` 必须缺省，**不得**渲染成 0 或「剩余=全部额度」。
  - **空不等于充足**：`entries` 为空数组只表示「未声明任何资源」，**不得**解读为「资源充足」。
  - **等式只在三值齐备时校验**：三值缺一先按缺口处理、不进等式；不得「有值才算、没值就跳过并当 0」。
  - **`gaps` 非空仍返回成功**：本件返回结构值（不是 `Result`），缺口是**结论的一部分**，不是异常。
- **非职责**：不读库/不读记录/不写 `resource_ledger`（投影归 store 的同事务 hook，可由记录重建）、不写任何 `REC-*`、不判任何门、不做「剩余=全部额度」的兜底、不新增 `REC-*` 与诊断码。
- **内部结构**：额度归一（调 `quota.normalizeLimit`）→ 逐资源累计（调 `quota.accumulate*`）→ 逐项派生（调 `quota.deriveEntry`）→ 缺口检测 → 稳定排序（`entries` 按 `resourceRef`、`gaps` 按 `resourceRef` 再按 `kind`）。`input` 的三个事实源以**记录引用**携带，本件只做聚合，不解析引用。
- **导出面/依赖**：`deriveResourceBaseline`/`detectResourceGaps`；依赖 `./quota.ts` 与 contract 类型（`ResourceBaseline`/`ResourceEntry`/`ResourceGap`/`SubjectRef`/`DefinitionRef`/`Timestamp`/`RecordRef`）。**不** import `rule/*`、不 import `work-readiness`。
- **IO 与注入**：零 IO；`asOf` 由调用方给（端口不读宿主时间）。
- **状态/并发/恢复**：纯函数；同一 `(subjectRef, quotaRef, asOf)` 重算**逐字段一致**（80-§6.4 末）。
- **错误/秘密/可观测**：三条例外**由端口层**表达为 `Err`——额度定义不可解析 `rejected_version`、主体不一致 `rejected_precondition`、记录侧不可读 `unavailable`；本件只对应地产出：`quota-unreadable` 缺口、`{ok:false, reason:'subject-mismatch'}`（**不产出基线**）、全部占用记未知 + `unreconciled-actual` 缺口。**不得**在记录不可读时返回「剩余=全部额度」。
- **测试与证据**：`F-core-test-resources-baseline`（目标-新增）。fake 边界=手写记录行与手写额度定义；不证明真实 `resource_ledger` 投影、不证明计划锁写预留的同事务性、不证明五门据基线作出的判决（那在 `work-readiness` 与其端口）。
- **规模**：≤300 行。
- **迁移与删除边界**：批次 5；`store/src/resources/`（物理表 `resource_ledger` 与同事务 hook）**属 03 卷**；逻辑投影名 `resourceLedger` 已在 80-§6.3 的 `TargetTableProjectionName` 中登记，实现与建表随 MIG-01。名字已登记不等于可用，未建表前只能读原记录，不得宣称投影可用；本件不依赖投影是否存在（只吃记录）。删除边界：删两文件即回退（无调用方）。

#### `F-core-spec-registry` · `packages/core/src/spec/registry.ts`

- **路径/处置**：`core/src/spec/registry.ts`；**目标-新增**（未实施）。80-§6.9 给 `core/src/spec/` 的落点（注册表、装载编排、导入六步纯逻辑）。
- **上位**：80-§6.1 `TS-PORT-SPEC-01`（`SpecEntry` 五字段、`register`/`resolve`/`list` 三方法、幂等与冲突口径）；76-§8 七条版本轴；D75-09。
- **现有职责**：N/A（新件）。
- **目标职责**：注册表的**值语义**（不是单例）：`registerSpec(entries, entry)` → 新集合或冲突；`resolveSpec(entries, name, version)`；`listSpecs(entries)`（不可变视图）。逐项：
  - 同 `(name, version)` 重复注册且 `semanticDigest` 一致 = **幂等成功**（返回原集合，不新增条目）；摘要不一致 = 拒（冲突）。
  - `resolve` **只接受完整 `version`**，**不做「最新版本」解析**（80 明写）。
  - 排序：`list` 按 `(name, version 字典序)` 稳定输出，不依赖插入顺序。
  - `digest` 只用 `semanticDigest`（`sha8`/`byteDigest` 不得顶替）。
- **非职责**：不读盘、不扫包、不持久化、不激活（**导入 ≠ 激活**，激活归 `TS-PORT-AUTH-03`）、不做依赖闭包、不解析定义内容。
- **内部结构**：`SpecEntry` 判别与不可变集合；冲突检测用稳定键 `name@version`；`resolve` 精确匹配。
- **导出面/依赖**：`registerSpec`/`resolveSpec`/`listSpecs`；`import type` contract 的 `SpecEntry`/`Digest`/`SemVer`/`ClassifiedError`。
- **IO 与注入**：零 IO。
- **状态/并发/恢复**：纯函数；集合不可变，调用方持有「当前注册表」并在需要时替换。
- **错误/秘密/可观测**：未登记/版本不符 ⇒ `Err({failure:'rejected_version', category:'EVOLVE_REJECT', subcause:'spec-unresolved'})`（**不是** `CONFIG_INVALID`：配置能读到，是版本不成立）；摘要冲突 ⇒ `rejected_version` + `subcause:'spec-digest-mismatch'`。不回显定义正文。
- **测试与证据**：`F-core-test-spec-registry`（目标-新增）。fake 边界=手写 `SpecEntry`；不证明真实注册表持久化、不证明 summary 计算入口（归 contract）。
- **规模**：≤150 行。
- **迁移与删除边界**：批次 6；`spec/loader.ts`/`spec/importer.ts` 只经本件做冲突检测（单向依赖）。

#### `F-core-spec-loader` · `packages/core/src/spec/loader.ts`

- **路径/处置**：`core/src/spec/loader.ts`；**目标-新增**（未实施）。
- **上位**：80-§6.1 `TS-PORT-SPEC-02`（`DefinitionSource`/`DefinitionBundle`、四条前置/后置/错误/幂等）；76-§2.8（纯配置否定约束）、§4.3；D75-04。
- **现有职责**：N/A（新件）。
- **目标职责**：`assembleDefinitionBundle(parts, expectedDigest?)` → `DefinitionBundle` 或 `Err`。`parts` 是**已读字节 + 来源 + 两套摘要**（`byteDigest`/`semanticDigest`），**读盘、解归档、路径 containment 全在 `assembly/spec/assemble.ts`**。逐项：
  - 逐 part 校验：`semanticDigest` 必须按 contract 的规范化入口计算（本件只比对，不自造规范化）；`expectedDigest` 给定时必须匹配整包语义摘要。
  - **纯配置否定约束**：含可执行内容、秘密形态、绝对路径的 part ⇒ 拒（`definition-not-pure`）。秘密形态检测**复用 contract 的 `findSecretShaped`**（不自写正则）；绝对路径判定用**纯字符串**规则（`/` 前缀、盘符、`..` 段），**禁** `node:path`。
  - **只读装载、不激活、不写回源、不执行 part**。
  - `bundle` 的 part 顺序按 `(partType, locator)` 稳定排序，不依赖扫描顺序。
- **非职责**：不读文件、不展开归档、不扫包、不判路径 containment（需文件系统事实）、不注册、不导入、不激活。
- **内部结构**：`PartFact` 校验器 + 否定约束检查器 + 摘要比对器 + 稳定排序装配器。
- **导出面/依赖**：`assembleDefinitionBundle`；`import type` contract 的 `DefinitionBundle`/`Digest`/`ClassifiedError`；值依赖 contract 的 `findSecretShaped`（允许边内、纯函数）；`node:crypto` 仅用于对**已给字节**重算摘要做自洽校验。
- **IO 与注入**：零 IO；字节与 locator 由调用方给。
- **状态/并发/恢复**：纯函数；同 `(parts, expectedDigest)` 同 bundle（含 part 顺序）。
- **错误/秘密/可观测**：摘要不符 ⇒ `rejected_version` + `subcause:'digest-mismatch'`；纯配置违规 ⇒ `rejected_precondition` + `subcause:'definition-not-pure'`。诊断不回显秘密命中片段原文，只回 `kind` 与偏移（偏移只对原文有意义）。
- **测试与证据**：`F-core-test-spec-importer`（与本件共用一件测试：装载是导入的前置，用例分组写）。fake 边界=手写字节与摘要；不证明真实目录/归档读取、不证明路径 containment（在 assembly）。
- **规模**：≤250 行。
- **迁移与删除边界**：批次 6；若 `assembly/spec/` 侧尚未落地，本件仍可用手写 `parts` 测试，**不得**为省一步把读盘塞进 core。

#### `F-core-spec-importer` · `packages/core/src/spec/importer.ts`

- **路径/处置**：`core/src/spec/importer.ts`；**目标-新增**（未实施）。
- **上位**：80-§6.1 `TS-PORT-SPEC-03`（`plan`/`apply` 两方法、`ImportPlan` 六步、`ImportReceipt`、幂等键 `(bundleDigest, targetId)`、整体回滚）；76-§2.8 六步；75-§四。
- **现有职责**：N/A（新件）。
- **目标职责**：**只实现 `plan`**——`planImport(bundle, target, registry)` → `ImportPlan`（六步可审清单：校验 → 冲突检测 → 映射 → 暂存 → 提交 → 回执），每步给「输入引用、判定结论、将写对象」。逐项：
  - 冲突检测读 `registry`（经 `./registry.ts`）：同名不同摘要 ⇒ `Err`（`import-conflict`）；同摘要已存在 ⇒ 计划标记 `reused:true`（幂等，不产生第二次写入意图）。
  - 幂等键由 `(bundleDigest, targetId)` **纯计算**得出，写入计划供 `apply` 使用。
  - **导入 ≠ 激活**：计划里不得含「启用/生效」步骤；激活是 `TS-PORT-AUTH-03`。
  - 任一步判定失败 ⇒ 整个计划不成立（不产「部分计划」）；回滚由 `apply` 侧（store/assembly）负责，本件只保证计划不自相矛盾。
- **非职责**：**不实现 `apply`**（写 store、写 `REC-RCP-01` 投影、事务回滚都在 daemon/store）、不读盘、不注册、不激活、不判决议摘要。
- **内部结构**：六步编排器（纯函数链）+ 冲突查询 + 幂等键计算 + 计划序列化形状（包内）。
- **导出面/依赖**：`planImport`；依赖 `./registry.ts` 与 contract 类型（`DefinitionBundle`/`ImportPlan`/`ImportReceipt`/`ClassifiedError`/`Qid`）。
- **IO 与注入**：零 IO；`target` 与 `registry` 由调用方给。
- **状态/并发/恢复**：纯函数；同输入同计划（含六步顺序与引用集合）。
- **错误/秘密/可观测**：`import-conflict` ⇒ `rejected_version`/`EVOLVE_REJECT`（与 `spec-digest-mismatch` 同族：内容与既有条目版本不成立）；输入 bundle 非纯配置 ⇒ `rejected_precondition`；计划不回显定义正文。
- **测试与证据**：`F-core-test-spec-importer`（目标-新增）：六步顺序、冲突、幂等复用、失败即无计划、计划不含激活步。fake 边界=手写 bundle/注册表；不证明 `apply` 的事务与回滚、不证明回执投影。
- **规模**：≤250 行。
- **迁移与删除边界**：批次 6；`apply` 的落点归 17（`assembly/spec/assemble.ts`）与 03（store 写域），本卷不登记其实现。

#### `F-core-authority-requirement` · `packages/core/src/authority/requirement.ts`

- **路径/处置**：`core/src/authority/requirement.ts`；**目标-新增**（未实施）。80-§6.9 给 `core/src/authority/` 的落点（需求、候选、激活判定、授予链、失能）。
- **上位**：80-§6.2 `TS-PORT-AUTH-01`（`requirementsFor(factDomain)` 签名、`AuthorityRequirement` 字段归 76 `DEF-AUTHREQ-01`、空数组语义、`authority-domain-unknown`）；76-§`DEF-AUTHREQ-01`；69-§3.3；D75-05。
- **现有职责**：N/A（新件）。
- **目标职责**：`requirementsFor(catalog, factDomain)` → `readonly AuthorityRequirement[]`：按事实域取出**已解析**的需求声明；只读、确定性排序（按需求 id）；返回项带版本引用（由调用方给）。
- **非职责**：不判「需求是否已被满足」、不解析权威引用、不读公司目录、不写 `REC-*`、不缓存（目录由调用方注入）。
- **内部结构**：域→需求列表的稳定索引；未知域显式拒。
- **导出面/依赖**：`requirementsFor`；`import type` contract 的 `AuthorityRequirement`/`VersionRef`/`ClassifiedError`。
- **IO 与注入**：零 IO。
- **状态/并发/恢复**：纯函数；同目录同域同结果。
- **错误/秘密/可观测**：未登记域 ⇒ `Err({failure:'rejected_version', category:'EVOLVE_REJECT', subcause:'authority-domain-unknown'})`（未登记＝引用不成立，与 `spec-unresolved` 同族）；空数组 = 「该域无需求声明」，**不是**「无需权威」——调用方不得据此跳过权门。
- **测试与证据**：并入 `F-core-test-authority-activation`（需求是激活判定的输入，用例分组写）。fake 边界=手写需求目录；不证明真实定义装载。
- **规模**：≤150 行。
- **迁移与删除边界**：批次 7；与其他四件互不 import。

#### `F-core-authority-candidates` · `packages/core/src/authority/candidates.ts`

- **路径/处置**：`core/src/authority/candidates.ts`；**目标-新增**（未实施）。
- **上位**：80-§6.2 `TS-PORT-AUTH-02`（`candidates`/`describe` 签名、`CandidateEndpoint` 字段归 78、**不含「已授权」标记**、错误口径「不可达 ≠ 无候选」）；78-§1.3/§1.4。
- **现有职责**：N/A（新件）。
- **目标职责**：`listCandidateEndpoints(directory, factDomain)` → `{ candidates, unavailable }`；`describeCandidate(profile)` → 描述（带探测时间戳）。逐项：
  - **可达 ≠ 可用**：本件不产出「可用」判定，也不产出「已授权」标记；候选只是**候选**。
  - **不可达与无候选必须可分辨**：输入显式带 `reachable:false` 时返回 `unavailable:true`（对应端口的 `Err(unavailable)`）与空候选；真的没有候选时返回 `unavailable:false` + 空数组（对应 `Ok([])`）。**不得**把二者折叠成同一个空数组。
  - 排序稳定：先「供给确认时间」、再 `endpointId`。
- **非职责**：不探测端点、不写 `REC-AUTH-04`/`REC-EVT-02`、不判授权、不判能力、不做候选排序之外的推荐。
- **内部结构**：目录快照的稳定索引 + 可达性标记传递 + 排序器。
- **导出面/依赖**：`listCandidateEndpoints`/`describeCandidate`；`import type` contract 的 `CandidateEndpoint`/`CandidateEndpointProfile`/`ClassifiedError`。
- **IO 与注入**：零 IO；目录快照由调用方给（探测在 daemon）。
- **状态/并发/恢复**：纯函数；同快照同结果。
- **错误/秘密/可观测**：不抛；不可达以 `unavailable:true` 表达（不是 `Err`——`Err` 在端口）；不含凭据、不含端点密钥。
- **测试与证据**：并入 `F-core-test-authority-activation`（候选是激活的输入）。fake 边界=手写目录快照；不证明真实探测、不证明 78 绑定档案形状。
- **规模**：≤180 行。
- **迁移与删除边界**：批次 7；不 import 同子域其他件。

#### `F-core-authority-activation` · `packages/core/src/authority/activation.ts`

- **路径/处置**：`core/src/authority/activation.ts`；**目标-新增**（未实施）。
- **上位**：80-§6.2 `TS-PORT-AUTH-03`（`activate`/`current`、`ActivationRequest` 五要素、CAS 前置、错误三条、「治理代次 ≠ 技术围栏」）；77-§3.7；`RUN-AUTH-01`/`RUN-AUTH-02`；80-§8.3（CAS）。
- **现有职责**：N/A（新件）。
- **目标职责**：`decideActivation(current: ActivationView, req: ActivationRequest)` → `Result<ActivationDecision, ClassifiedError>`：只做**判定**——① `authorityRef` 可解析且权源足够（否则 `rejected_authority`）；② `(factDomain, generation)` 与 `current` 的 `expectedGeneration` CAS 一致（否则 `rejected_version`）；③ 无互认围栏且需并发双写（否则 `unsupported`）；通过 ⇒ `{ kind:'activate', factDomain, endpointId, generation, scope, validity }`。幂等：同 `(factDomain, generation)` 重复判定返回同一决定（不产第二次写入意图）。
- **非职责**：**不持久化**（CAS 落 `REC-AUTH-07` 在 store 的写域）、不写 `fenceToken`（`generation` 是**治理代次**，不得写进围栏）、不改端点、不发通知、不做跨域聚合。
- **内部结构**：前置检查链 + CAS 比较 + 决定构造器；决定形状**包内**，由端口映射成 `ActivationReceipt`。
- **导出面/依赖**：`decideActivation`；`import type` contract 的 `ActivationRequest`/`ActivationView`/`ActivationReceipt`/`FenceToken`/`ClassifiedError`。
- **IO 与注入**：零 IO；`current` 由调用方给。
- **状态/并发/恢复**：纯函数；并发安全由 store 的 CAS 保证，不由本件保证（本件只判「应当 CAS 成功」）。
- **错误/秘密/可观测**：三条 `Err` 如实：`rejected_authority`（无权重）/`rejected_version`（代次冲突）/`unsupported`（无互认围栏）；错误不含凭据引用以外的身份细节，不含端点密钥。
- **测试与证据**：`F-core-test-authority-activation`（目标-新增）：CAS 成功/失败、代次与围栏不混写、无权重、无围栏、幂等。fake 边界=手写 `ActivationView`；不证明真实 CAS 持久化、不证明 78 绑定档案。
- **规模**：≤180 行。
- **迁移与删除边界**：批次 7；`store/src/lease/`（围栏/租约持久面）与 `assembly/auth/assemble.ts` 属 03/17，本卷只登记接缝（§5.12）。

#### `F-core-authority-grant` · `packages/core/src/authority/grant.ts`

- **路径/处置**：`core/src/authority/grant.ts`；**目标-新增**（未实施）。
- **上位**：80-§6.2 `TS-PORT-AUTH-05`（`grant`/`exercise`/`withdraw`/`chain` 四方法、`GrantRequest`/`WithdrawalRequest` 字段、「行使不得反向扩大授予」「撤回只发通知不算完成」）；77-§3.1–§3.3；`RUN-AUTH-01`–`RUN-AUTH-03`。
- **现有职责**：N/A（新件）。
- **目标职责**：三条纯判定：`checkGrant(chain, req)`（授予者有权授予；转授必须有父授予且 `delegable=true`；范围包含、目的/条件/期限合规）、`checkExercise(grant, action)`（行使在目的/范围/条件/期限内，**不得反向扩大**）、`checkWithdrawal(grant, req)`（`inFlightInventory` 与 `credentialActions` 齐备才成立；未清点即 `rejected_precondition`）。幂等键判定（授予 `(grantor, grantee, scope, term)`、行使 `(grantRef, actionRef)`、撤回 `(grantRef, reason, effectiveAt)`）也在此纯计算。
- **非职责**：不追加 `REC-AUTH-01/02/03`（store 写域）、不发撤回通知、不判「运行时仍暴露」的事实（那要靠观测面）、不做跨授予的全局一致性。
- **内部结构**：父链遍历（环/断链 fail-closed）+ 范围包含判定 + 期限/条件检查 + 幂等键构造。
- **导出面/依赖**：`checkGrant`/`checkExercise`/`checkWithdrawal`/`grantIdempotencyKey` 等；`import type` contract 的 `RecGrantEdge`/`GrantRequest`/`ExerciseRequest`/`WithdrawalRequest`/`Qid`/`ClassifiedError`。
- **IO 与注入**：零 IO；链由调用方给（读记录在 store）。
- **状态/并发/恢复**：纯函数；链的读取一致性由调用方保证。
- **错误/秘密/可观测**：父链断/过期/已撤回/禁配 ⇒ `rejected_authority`；版本不符 ⇒ `rejected_version`；在途未清点 ⇒ `rejected_precondition`。不回显凭据值，只回引用。
- **测试与证据**：`F-core-test-authority-grant`（目标-新增）：转授范围、父链环/断链、行使越界、撤回在途未清点、幂等键稳定。fake 边界=手写授予链；不证明记录落盘、不证明运行时撤回收口。
- **规模**：≤300 行。
- **迁移与删除边界**：批次 7；不 import 同子域其他件。

#### `F-core-authority-incapacity` · `packages/core/src/authority/incapacity.ts`

- **路径/处置**：`core/src/authority/incapacity.ts`；**目标-新增**（未实施）。
- **上位**：80-§6.2 `TS-PORT-AUTH-07`（`determine`/`recoveryPreconditions`、`IncapacityRequest` 九项、「judgedBy 不得自设」「不自行转移权威」）；77-§3.8；77-§11.1 `degraded`。
- **现有职责**：N/A（新件）。
- **目标职责**：`determineIncapacity(req)` → `Result<IncapacityDecision, ClassifiedError>`：校验 `judgedBy` 由**预设继任/再指定程序**指定（`designatedBy` 可解析且 ≠ `subject`），`scopeAndTerm` 必填，`evidence` 有时间窗；通过 ⇒ 决定（`freezeEffect` 为冻结清单内动作）。无宪制依据 ⇒ 返回 `{ kind:'opinion-only' }`（只能作意见记录，**不是**判决），不产 `Err` 的「无权重」路径之外的结论。`recoveryPreconditions(subject, records)` → `readonly RecoveryPrecondition[]`（恢复前提，含复审期限）。
- **非职责**：不转移权威（转移是 `TS-PORT-AUTH-03`）、不写 `REC-AUTH-08`、不发通知、不判「冻结清单」内容（清单由定义给）。
- **内部结构**：九项前置检查 + 决定/意见二态构造 + 恢复前提提取（稳定排序）。
- **导出面/依赖**：`determineIncapacity`/`recoveryPreconditions`；`import type` contract 的 `IncapacityRequest`/`RecIncapacityDetermination`/`RecoveryPrecondition`/`SubjectRef`/`ClassifiedError`。
- **IO 与注入**：零 IO。
- **状态/并发/恢复**：纯函数；同输入同结果。
- **错误/秘密/可观测**：范围/期限未定 ⇒ `rejected_precondition`；无宪制依据 ⇒ `rejected_authority`（并同时允许意见记录路径，二者由调用方择一落账）；不含个人隐私细节以外的证据原文（只回引用）。
- **测试与证据**：`F-core-test-authority-grant`（与本件共用一件测试：失能与授予同属权威生命周期，用例分组写）。fake 边界=手写判定请求；不证明真实继任程序、不证明通知。
- **规模**：≤250 行。
- **迁移与删除边界**：批次 7；不 import 同子域其他件。

### 5.9 测试代码（17 件，全部 `仅测试`）

统一口径：测试只对**当前实现的行为回归**负责。所有条目的 R/E/W 映射一律写 `N/A`——82 尚未给出需求/证据/见证映射，**不得**声称某个 R/E/W 已通过；V 级一律 `V2 局部行为回归`，不冒充 V3–V6（真实进程、跨实现、真机、生产回放）。fake 边界统一为「内存对象 + 内联文本」，不接真实平台、真实库、真实模型。

测试件的四个面按统一规则处理，不逐条重复：**导出面 = N/A**（测试文件不是包入口，无对外符号）；**IO = 仅测试层**（可读源码与夹具，可读 `models.example.yaml`，不写任何文件）；**状态/并发 = N/A**（测试自身无状态机、无锁、无恢复）；**错误语义 = N/A**（测试不定义错误分类，失败即断言红）。**上位**按下表逐件对应到被测件，不另写第二份归属：

| 测试 F-ID | 上位（被测件 F-ID） | 测试 F-ID | 上位（被测件 F-ID） |
|---|---|---|---|
| `F-core-test-helpers` | `F-core-decide`、`F-core-flows` | `F-core-test-golden` | `F-core-golden`、`F-core-decide` |
| `F-core-test-breaker` | `F-core-breaker` | `F-core-test-hrsync` | `F-core-hrsync` |
| `F-core-test-budget` | `F-core-budget` | `F-core-test-judge-gates` | `F-core-judge-gates` |
| `F-core-test-costclose` | `F-core-costclose`、`F-core-cost-insights` | `F-core-test-judge` | `F-core-judge` |
| `F-core-test-costguard` | `F-core-costguard` | `F-core-test-models` | `F-core-models` |
| `F-core-test-decide` | `F-core-decide`、`F-core-flows` | `F-core-test-pricing` | `F-core-pricing` |
| `F-core-test-dispositions` | `F-core-dispositions` | `F-core-test-queue` | `F-core-queue` |
| `F-core-test-evolution` | `F-core-evolution` | `F-core-test-secrets` | `F-core-secrets` |
| `F-core-test-flows` | `F-core-flows` | — | — |

#### `F-core-test-helpers` · `packages/core/test/helpers.ts`

- **路径/处置**：`test/helpers.ts`；现有 → 目标-保留（仅测试）。
- **覆盖**：`DecisionInput`/`IssueRecord`/`InvokeIntent` 的安全构造器（`exactOptionalPropertyTypes` 下显式 `undefined` 不落键）；固定时刻 `T0=2026-10-16T00:00:00.000Z`；默认全绿环境（L0 新单、泳道无主、四闸宽裕、断路器净、意图新鲜）；`now` 默认 `T0+60s`，停摆阈值默认 1 小时。
- **fake 边界**：纯内存构造，零 IO（`Date.parse` 只解析常量）。
- **不证明**：构造器默认值等于生产默认值；不证明任何决策正确性。
- **R/E/W/V**：R/E/W = N/A（82 未给）；V2。
- **规模**：67 → ≤80 行。
- **迁移**：若 `decide` 拆件，仅改 import 路径。

#### `F-core-test-breaker` · `packages/core/test/breaker.test.ts`

- **路径/处置**：`test/breaker.test.ts`；现有 → 目标-保留（仅测试）。
- **覆盖**：空状态、连续同签名累加、异签名重置、N 参数化触发、冷却窗口、成功复位、开单动作携带。
- **fake 边界**：内存 `BreakerState`；无时钟注入（冷却用显式数值）。
- **不证明**：daemon 的接入顺序、崩溃后计数连续、真实 worker 错误分布。
- **R/E/W/V**：N/A；V2。
- **规模**：140 → ≤160 行。

#### `F-core-test-budget` · `packages/core/test/budget.test.ts`

- **路径/处置**：`test/budget.test.ts`；现有 → 目标-保留（仅测试）。
- **覆盖**：行流折叠（票/人两视图 + 桥重建）、重复预留拒、票级帽、岗级帽、refusal 行、结算冲销、无预留可结的配置错误、金额精度边界。
- **fake 边界**：内存 `BudgetRow[]`；不连库。
- **不证明**：事务原子性、并发双花、崩溃点①的恢复、真实 store 行形状。
- **R/E/W/V**：N/A；V2。
- **规模**：576 → ≤576 行（零增长；该文件本身接近 600，新增用例须先拆或先删冗余用例，不得越线）。

#### `F-core-test-costclose` · `packages/core/test/costclose.test.ts`

- **路径/处置**：`test/costclose.test.ts`；现有 → 目标-保留（仅测试）。
- **覆盖**：三路取价（快照 exact/carry → 桥 → unpriced）、补账巡检、对账段、微小补账合并展示、日报装配、财务分析四规则（间接覆盖 `cost-insights`）。
- **fake 边界**：内存 usage 格、快照行、记录行。
- **不证明**：落库、并发重放安全、真实价目精度、`cost-insights` 四条规则的独立边界值。
- **R/E/W/V**：N/A；V2。
- **规模**：291 → ≤320 行。

#### `F-core-test-costguard` · `packages/core/test/costguard.test.ts`

- **路径/处置**：`test/costguard.test.ts`；现有 → 目标-保留（仅测试）。
- **覆盖**：本地日键（含跨月/跨年与午夜边界）、档位排序与最高达标档、预算 0 且有消耗、全量折叠（人×模型×日）、格价折算。
- **fake 边界**：内存记录；时区取宿主（与生产同源，故不构成隔离）。
- **不证明**：跨时区一致、投影落库、在途预留分量。
- **R/E/W/V**：N/A；V2。
- **规模**：140 → ≤160 行。

#### `F-core-test-decide` · `packages/core/test/decide.test.ts`

- **路径/处置**：`test/decide.test.ts`；现有 → 目标-保留（仅测试）。
- **覆盖**：四闸顺序（断路器前置 → 泳道 → 人 → 每拍 → 在途）、10 类动作分支、未知流/未知态、意图去重与幂等键、停摆告警、审批与证据闸。
- **fake 边界**：`helpers.ts` 构造的内存快照；无真实平台。
- **不证明**：开工五门（本件不实现）、daemon 的 tick 顺序、真实 CLI 行为。
- **R/E/W/V**：N/A；V2。
- **规模**：508 → ≤530 行。

#### `F-core-test-dispositions` · `packages/core/test/dispositions.test.ts`

- **路径/处置**：`test/dispositions.test.ts`；现有 → 目标-保留（仅测试）。
- **覆盖**：`ErrorCategory` 11 类逐类处置断言、断路器计数类集合、查表缺省。
- **fake 边界**：纯查表，无输入构造。
- **不证明**：任何执行点按表动作（生产零 import）。
- **R/E/W/V**：N/A；V2。
- **规模**：80 → ≤90 行。

#### `F-core-test-evolution` · `packages/core/test/evolution.test.ts`

- **路径/处置**：`test/evolution.test.ts`；现有 → 目标-保留（仅测试）。
- **覆盖**：状态机全边与非法迁移、`parent_id` 环/断链 fail-closed、幂等提案、三态闸门（含判据类资产恒 `escalate`）、判负与近失诊断。
- **fake 边界**：内存 `CandidateRecord[]`。
- **不证明**：沙箱执行、库接线、灰度/切权结果、真实改动检测。
- **R/E/W/V**：N/A；V2。
- **规模**：576 → ≤576 行（零增长；同 `budget` 的越线纪律）。

#### `F-core-test-flows` · `packages/core/test/flows.test.ts`

- **路径/处置**：`test/flows.test.ts`；现有 → 目标-保留（仅测试）。
- **覆盖**：默认表三层（L0/L1/L2）、锚点解析、类型流/层级流优先级、前向/回滚边、非法迁移拒绝。
- **fake 边界**：纯内存表。
- **不证明**：平台真实状态名、公司覆盖表来自真实目录、与 77 状态机的映射。
- **R/E/W/V**：N/A；V2。
- **规模**：233 → ≤260 行。

#### `F-core-test-golden` · `packages/core/test/golden.test.ts`

- **路径/处置**：`test/golden.test.ts`；现有 → 目标-保留（仅测试）。
- **覆盖**：6 个夹具逐一回放，断言零失败；夹具字段与 `GoldenTrace` 形状一致。
- **fake 边界**：静态 JSON 夹具 + 内存重放。
- **不证明**：裁决正确性、trace 采集真实、跨版本兼容、夹具格式已升 contract。
- **R/E/W/V**：N/A；V2。
- **规模**：80 → ≤95 行。

#### `F-core-test-hrsync` · `packages/core/test/hrsync.test.ts`

- **路径/处置**：`test/hrsync.test.ts`；现有 → 目标-保留（仅测试）。
- **覆盖**：七值域分类、增删改比对、台账状态索引、幂等键稳定性、渲染文本、平台集合。
- **fake 边界**：手写 `CompanySnapshot`。
- **不证明**：真实平台同步、台账写入、身份合并。
- **R/E/W/V**：N/A；V2。
- **规模**：143 → ≤165 行。

#### `F-core-test-judge-gates` · `packages/core/test/judge-gates.test.ts`

- **路径/处置**：`test/judge-gates.test.ts`；现有 → 目标-保留（仅测试）。
- **覆盖**：三帽边界、降级原因计数、按址熔断开/复位/当日判定、拍闸、角色闸（高帽拒）。
- **fake 边界**：手写状态与帽值。
- **不证明**：真实调用序列、跨重启连续、模型侧行为。
- **R/E/W/V**：N/A；V2。
- **规模**：214 → ≤240 行。

#### `F-core-test-judge` · `packages/core/test/judge.test.ts`

- **路径/处置**：`test/judge.test.ts`；现有 → 目标-保留（仅测试）。
- **覆盖**：词表注册期七个坏形（空、重复、未批算子、空枚举、重复枚举等）、指纹稳定性与顺序无关、判决解析三闸。
- **fake 边界**：手写词表与判决字符串。
- **不证明**：注册闸在生产被调用（事实是未被调用）、真实模型输出分布。
- **R/E/W/V**：N/A；V2。
- **规模**：192 → ≤215 行。

#### `F-core-test-models` · `packages/core/test/models.test.ts`

- **路径/处置**：`test/models.test.ts`；现有 → 目标-保留（仅测试）。
- **覆盖**：全形解析、各坏形的行号定位、目录命中与未登记明报、`estimateCost` 边界与精度口径、指纹稳定性、示例文件合法性（读 `models.example.yaml`）。
- **fake 边界**：内联 YAML + 一个真实语料文件（`readFileSync`，仅测试层）。
- **不证明**：真实部署配置、档位选择策略、摘要与 `TS-SCALAR-08` 的兼容。
- **R/E/W/V**：N/A；V2。
- **规模**：396 → ≤420 行。

#### `F-core-test-pricing` · `packages/core/test/pricing.test.ts`

- **路径/处置**：`test/pricing.test.ts`；现有 → 目标-保留（仅测试）。
- **覆盖**：价目解析与坏形、覆盖校验、exact/carry 取价、stale 天数、四桶折算（含 unpriced）、桥的三级回退、模型归一键。
- **fake 边界**：内联 YAML + 内存快照行。
- **不证明**：真实快照表、告警投递、币种。
- **R/E/W/V**：N/A；V2。
- **规模**：255 → ≤280 行。

#### `F-core-test-queue` · `packages/core/test/queue.test.ts`

- **路径/处置**：`test/queue.test.ts`；现有 → 目标-保留（仅测试）。
- **覆盖**：优先级 clamp、年龄加成两档封顶、置顶恒首、同分 FIFO、排序稳定性。
- **fake 边界**：内存条目。
- **不证明**：daemon 携带态重建、真实队列顺序、不抢占语义。
- **R/E/W/V**：N/A；V2。
- **规模**：115 → ≤135 行。

#### `F-core-test-secrets` · `packages/core/test/secrets.test.ts`

- **路径/处置**：`test/secrets.test.ts`；现有 → 目标-保留（仅测试）。
- **覆盖**：已知值替换（长度降序、短值不换、去重）、三类形状检测、总闸顺序、已替换标记不被二次改写、ULID 不误报。
- **fake 边界**：内联文本与假秘密。
- **不证明**：真实凭据形态、正则最坏时间、覆盖所有出站面（事实只有一处生产调用）。
- **R/E/W/V**：N/A；V2。
- **规模**：77 → ≤90 行。

### 5.10 测试夹具（6 件，全部 `仅测试`）

统一说明：夹具是**手写 trace**，不是生产采集；它们只证明「`decide` 与记录一致」，不证明裁决正确、不证明格式已冻结、不证明可跨版本回放。夹具无版本字段，因此格式变更时只能整体替换——这是已知限制，登记在 §八-7。

六个夹具的共同栏位（不逐行重复）：**处置**均为现有 → 目标-保留（仅测试）；**上位**=`F-core-golden`（回放器）与 `F-core-decide`（被回放的决策）；**职责**=提供一条可重放的动作序列，**非职责**=不提供采集、不提供 schema 版本、不提供跨档迁移；**内部结构**=一份 `GoldenTrace` JSON（初始快照 + 期望动作序列）；**导出面/依赖**=N/A（数据文件，无 import）；**IO**=被 `golden.test.ts` 以 `node:fs` 只读；**状态/错误**=N/A（静态数据，无运行期语义）。

| 稳定 ID | 文件 | 覆盖的场景 | 断言形状 |
|---|---|---|---|
| `F-core-golden-normal-dispatch-chain` | `test/golden/normal-dispatch-chain.json` | L0 新单从 fresh 到派发的最短链 | 每拍一个期望动作，`intentKey` 稳定 |
| `F-core-golden-breaker-trip-chain` | `test/golden/breaker-trip-chain.json` | 同单同错连击到熔断 | 末拍为开单/挂起，前序为错误计数 |
| `F-core-golden-breaker-half-open-chain` | `test/golden/breaker-half-open-chain.json` | 冷却后试探与复位 | 冷却前后动作不同，复位后回到正常派发 |
| `F-core-golden-dedup-chain` | `test/golden/dedup-chain.json` | 同意图重复投递 | 第二拍为 `noop`，幂等键相同 |
| `F-core-golden-gates-approval-chain` | `test/golden/gates-approval-chain.json` | 审批闸未过到通过 | 未过为提审/挂起，过后为派发 |
| `F-core-golden-person-gate-chain` | `test/golden/person-gate-chain.json` | 人闸阻塞与放行 | 阻塞为等待，放行为派发 |

每件的规模上限：≤40 行（JSON 每行一个字段，保持可读）；迁移边界：若 `Action` 联合增删成员，六个夹具必须同步更新，且更新属**契约变更**，须在 82 登记；删除边界：删夹具等于删覆盖，须同步删或改 `golden.test.ts` 的对应用例，不得留空跑。

### 5.11 新增测试（10 件，目标-新增）

统一口径与 §5.9 相同：**只对当前（未来）实现的行为回归负责**；V 级一律 `V2 局部行为回归`，不冒充 V3–V6；fake 边界=内存对象 + 内联文本/字符串，不接真实平台、真实库、真实模型、真实目录。以下每件都写「覆盖 / fake 边界 / 不证明 / R/E/W/V / 规模 / 迁移」。

〔与 82 的关系〕82 的 TR 行已把 `F-core-work-readiness` 列为若干场景的**主承载**（如 TR-R-07、TR-R-31、TR-W-01、TR-W-04、TR-I-05、TR-I-14、TR-E-03、TR-E-04、TR-E-11、TR-G-03），并给 `V1·SEM`/`V2·CASE` 级别——这意味着**场景归属已定**，但**逐用例断言清单未给**。因此本节的 R/E/W 一律写 `N/A`（不得声称某条 TR 已通过），只标「用例覆盖该场景的判定面」。`resources/`、`spec/`、`authority/` 三组在 82 中**尚无对应 TR 行与主承载登记**，属 82 的未同步项（§六-18）。

#### `F-core-test-rule-typecheck` · `packages/core/test/rule/typecheck.test.ts`

- **路径/处置**：`test/rule/typecheck.test.ts`；**目标-新增**（未实施）。
- **覆盖**：整棵树静态检查（**含被短路的分支**：`false and X` 的 `X` 类型错仍被拒）；必需输入缺失（`E-RULE-005`）与未声明容忍的可选缺失（`E-RULE-006`）；字段路径不可静态解析（`E-RULE-013`）；类型不符（`E-RULE-004`）；`defaultOf` 产 `W-RULE-005` 且**不**表示判定通过；`TypecheckReceipt` 四字段齐全、`limitsApplied` **七项**、`inputDeclDigest`/`profileRef.digest` 为语义摘要；诊断按 `location` → `code` 稳定排序；`typecheck` **不产** `E-RULE-010`/`E-RULE-001`/`002`/`014`/`003`/`020` 与 `W-RULE-001`/`002`。
- **fake 边界**：手写档 AST 与 `RuleInputDecl`；无文件、无网络、无时钟。
- **不证明**：contract 类型齐备（§六-1）、真实档从磁盘装载、`semanticDigest` 跨实现（82 `GAP-82-06`）、跨语言一致。
- **R/E/W/V**：R/E/W = N/A；V2。
- **规模**：≤300 行。
- **迁移**：与 `rule/typecheck.ts` 同步落地；contract 未就绪前不写。

#### `F-core-test-rule-evaluator` · `packages/core/test/rule/evaluator.test.ts`

- **路径/处置**：`test/rule/evaluator.test.ts`；**目标-新增**（未实施）。
- **覆盖**：四值不合并（同一输入的不同失败路径分别得 `false`/`unknown`/`refused` 与 `true`）；**`unknown`（输入不足）与 `refused`（求值中止）分别断言、不得互借**；`absenceTolerant` 显式声明后得 `unknown`；`null`/`false`/`0`/空串四者互不折算；三值真值表与短路；除零（`E-RULE-007`）、溢出/标度/空聚合（`E-RULE-008`）、枚举码不在词表（`E-RULE-010`）、步数超限（`E-RULE-012`）、限额超限（`E-RULE-003`，且该诊断带 `limitsApplied`）；`tightening` 缺省=不收紧、更严=取 min、更松=`Err(rejected_precondition)`、传三项档内固定值=`Err(rejected_precondition)`；`limitsApplied` 七项实际值；`RuleOutcome` 七字段；`trace` 截断标 `truncated:true`；`E-RULE-020` 走 `Ok` + `refused` 而版本不可成立走 `Err`；同输入两次求值结果与 `steps` 完全相同。
- **fake 边界**：手写档 AST 与手写 `RuleInput`；无文件、无网络、无时钟。
- **不证明**：77 采纳求值结果、真实档装载、`semanticDigest` 跨实现、性能、宿主墙钟护栏的真实触发（只能用手写时钟桩验证 `Err` 形状）。
- **R/E/W/V**：R/E/W = N/A；V2。
- **规模**：≤420 行。
- **迁移**：与 `rule/evaluator.ts` 同步落地；`typecheck.test.ts` 与它同日绿。

#### `F-core-test-rule-pattern` · `packages/core/test/rule/pattern.test.ts`

- **路径/处置**：`test/rule/pattern.test.ts`；**目标-新增**（未实施）。
- **覆盖**：允许构造（字面、字符类与取反、`.`、`^`/`$`、五类量词、分组与选择、`\d`/`\w`/`\s`）逐一接受；禁止构造（反向引用、环视、原子组、条件组、递归、占有量词、内联开关、`\b`）逐一拒为 `E-RULE-014`；`matches` 是**整串**匹配（`abc` 不匹配 `xabcx`）；输入超档内长度上限与步数超档内上限均为 `E-RULE-009`；量词界 `m,n ≤ 1000` 与**量词嵌套层数**的档内上限；空模式与空输入；Unicode 码点（非 UTF-16 单元）行为；三项档内固定值**只能来自档**（传入收紧参数不改变行为）。
- **fake 边界**：手写模式与文本、手写档内三项上限；不调用宿主 `RegExp`，因此测试本身也不得用 `RegExp` 做对照（对照用硬编码期望）。
- **不证明**：与 PCRE/JavaScript 正则的等价性；最坏情况性能；跨实现一致。
- **R/E/W/V**：R/E/W = N/A；V2。
- **规模**：≤280 行。
- **迁移**：与 `pattern.ts` 同步；若 76-§6.10 扩项或改三项固定值，先改 76 再改用例。

#### `F-core-test-work-readiness` · `packages/core/test/work-readiness.test.ts`

- **路径/处置**：`test/work-readiness.test.ts`；**目标-新增**（未实施）。
- **覆盖**：五组输入各一条最小通过路径（权/能力/资源/信息/禁止）；**13 字段齐全且逐字段有断言**（`contractRef`/`decidedBy`/`authorityRef`/`gateResults` 恰五门/`verdict`/`scopeJudged`/`conditions`/`judgeRole` 逐门/`decidedAt`/`repudiationTriggers`/`resourceBaseline`/`dissentPosition`/`decisionFacet`）；**三值不合并**——五门全过=`可开工`、仅有非硬门附条件=`附条件开工`、任一硬门不过=`不可开工`，三者互不折算；**聚合规则**（任一不可开工⇒整体不可开工；否则任一附条件⇒附条件；全过⇒可开工）；`judgeRole` 与 `gateResults.role` 逐门同值，故意错一处 ⇒ fail-closed；`附条件开工` 缺 `conditions` ⇒ 整体不可开工（本卷口径，§六-2b）；`RuleOutcome.refused` 只落该门 `不可开工` 且**不产第四个 verdict 值**；`unknown`（输入不足）与 `refused` 分别断言；`resourceBaseline.gaps` 非空时资源门**不得**判 `可开工`（含 `reservation-record-missing` 的未知额度场景）；`decisionFacet` 与顶层同名字段同值、`rationale` 非空且确定性；风险引用**不进输入**（类型层拒绝）；同输入两次判决逐字相同（含 `conditions` 与 `rationale`）。
- **fake 边界**：手写 `ReadinessRequest`、手写 `ReadinessResolved`（五门判据 + `RuleOutcome`）、手写 `ResourceBaseline`；无公司目录、无文件、无时钟。
- **不证明**：端口层的异步解析与三条例外（`Err`）、`REC-WORK-04` 落账、daemon 的先后序（先五门后四闸）、真实公司目录里的授权/资格/资源引用、`TS-PORT-RES-01` 的真实读记录。
- **R/E/W/V**：R/E/W = N/A（82 已给场景归属与 V 级，未给逐用例断言）；V2。
- **规模**：≤360 行。
- **迁移**：与 `work-readiness.ts` 同步落地；contract 的 `ReadinessResolved`（§六-2c）未就绪前不写；不接线。

#### `F-core-test-resources-quota` · `packages/core/test/resources/quota.test.ts`

- **路径/处置**：`test/resources/quota.test.ts`；**目标-新增**（未实施）。
- **覆盖**：`finite`/`unbounded`/`unknown` 三态归一（**未声明无上限一律 unknown**，不得默认 unbounded）；`deriveEntry` 在 `reserved` 或 `consumed` 缺省时**不给 `remaining`**（缺省≠0）；三值齐备时等式 `remaining = limit − reserved − consumed` 成立与不成立两向；**跨环累计不重复**（同一预留记录出现两次只计一次；同一实际/释放记录只计一次；释放不得超预留）；`DecimalString` 精确加减与比较（大数、负零、跨标度、`0.1+0.2` 类边界不用浮点）；非法格式（前导零、指数、标度超限）返回结构化失败**不修正**。
- **fake 边界**：手写额度定义与记录行；无库、无文件。
- **不证明**：真实 `resource_ledger` 投影、store 的单写者去重、`DecimalString` 跨实现一致（§六-17/§八-20）。
- **R/E/W/V**：R/E/W = N/A（82 无对应 TR 行）；V2。
- **规模**：≤300 行。
- **迁移**：与 `quota.ts` 同步落地。

#### `F-core-test-resources-baseline` · `packages/core/test/resources/baseline.test.ts`

- **路径/处置**：`test/resources/baseline.test.ts`；**目标-新增**（未实施）。
- **覆盖**：四型缺口逐一触发（`quota-unreadable`/`over-reserved`/`unreconciled-actual`/`reservation-record-missing`）；`finite` 且占用缺省 ⇒ 对应缺口 + 无 `remaining`；`entries` 空数组**不等于**充足；`limit.kind='unknown'` ⇒ 无 `remaining` 且不得渲染「剩余=全部」；`gaps` 非空时函数仍返回成功结构（不是 `Err`）；记录不可读标志 ⇒ 全部占用未知 + 缺口，**不**返回「全部额度可用」；主体不一致 ⇒ `{ok:false,'subject-mismatch'}` 且不产基线；同一 `(subjectRef, quotaRef, asOf)` 重算逐字段一致（含 `entries`/`gaps` 顺序）。
- **fake 边界**：手写记录行、额度定义、`asOf`；无库、无文件。
- **不证明**：真实投影表、计划锁写预留的同事务性、五门据基线的判决。
- **R/E/W/V**：R/E/W = N/A；V2。
- **规模**：≤300 行。
- **迁移**：与 `baseline.ts` 同步落地；`store/src/resources/` 未落地不影响本件（只吃记录）。

#### `F-core-test-spec-registry` · `packages/core/test/spec/registry.test.ts`

- **路径/处置**：`test/spec/registry.test.ts`；**目标-新增**（未实施）。
- **覆盖**：注册→解析往返；同 `(name, version)` 同摘要幂等（集合不变）；同键不同摘要拒（`spec-digest-mismatch`）；未登记/版本不符 ⇒ `rejected_version` + `spec-unresolved`（**非** `CONFIG_INVALID`）；不做「最新版本」解析（只给 `name` 不给版本即不成立）；`list` 稳定排序；返回值不可变（调用方改不动内部集合）。
- **fake 边界**：手写 `SpecEntry`；无文件、无库。
- **不证明**：真实注册表持久化、摘要计算入口（contract）、真实定义装载。
- **R/E/W/V**：R/E/W = N/A；V2。
- **规模**：≤150 行。
- **迁移**：与 `spec/registry.ts` 同步。

#### `F-core-test-spec-importer` · `packages/core/test/spec/importer.test.ts`

- **路径/处置**：`test/spec/importer.test.ts`；**目标-新增**（未实施）。本件同时覆盖 `spec/loader.ts`（装载是导入的前置）。
- **覆盖**：装载侧——摘要不符（`digest-mismatch`）、纯配置违规（含可执行内容 / 秘密形态 / 绝对路径，`definition-not-pure`）、part 稳定排序、只读不激活；导入侧——六步顺序可审、同名不同摘要冲突（`import-conflict`）、同摘要已存在 `reused:true`、幂等键 `(bundleDigest, targetId)` 稳定、任一步失败即无计划、计划中**不含激活步**。
- **fake 边界**：手写 `parts`（字节 + 摘要 + locator）、手写注册表；无文件、无网络。
- **不证明**：`apply` 的事务与回滚、`REC-RCP-01` 回执投影、真实目录/归档读取、路径 containment（在 `assembly/spec/`）。
- **R/E/W/V**：R/E/W = N/A；V2。
- **规模**：≤300 行。
- **迁移**：与 `spec/loader.ts`、`spec/importer.ts` 同步。

#### `F-core-test-authority-activation` · `packages/core/test/authority/activation.test.ts`

- **路径/处置**：`test/authority/activation.test.ts`；**目标-新增**（未实施）。本件同时覆盖 `authority/requirement.ts` 与 `authority/candidates.ts`（二者是激活判定的输入）。
- **覆盖**：需求侧——按域取出、空数组=「无需求声明」而非「无需权威」、未登记域 `authority-domain-unknown`；候选侧——候选不含「已授权」标记、**不可达 vs 无候选可分辨**（`unavailable:true` vs 空数组）、稳定排序；激活侧——CAS 成功/代次冲突（`rejected_version`）、无权重（`rejected_authority`）、无互认围栏（`unsupported`）、`generation` **不写进** `fenceToken`、同 `(factDomain, generation)` 幂等。
- **fake 边界**：手写需求目录、候选快照、`ActivationView`；无网络、无库。
- **不证明**：真实 CAS 持久化（`REC-AUTH-07`）、78 绑定档案、探测结果落 `REC-AUTH-04`/`REC-EVT-02`。
- **R/E/W/V**：R/E/W = N/A；V2。
- **规模**：≤300 行。
- **迁移**：与三件同步；`store/src/lease/`、`assembly/auth/` 未落地不影响本件。

#### `F-core-test-authority-grant` · `packages/core/test/authority/grant.test.ts`

- **路径/处置**：`test/authority/grant.test.ts`；**目标-新增**（未实施）。本件同时覆盖 `authority/incapacity.ts`（失能与授予同属权威生命周期）。
- **覆盖**：授予侧——父授予缺失、父链环/断链、`delegable=false` 仍转授、范围越界、期限/条件不符、幂等键稳定；行使侧——越出目的/范围/条件/期限、**反向扩大授予**；撤回侧——`inFlightInventory`/`credentialActions` 未清点即 `rejected_precondition`、「只发通知」不成立为完成；失能侧——`judgedBy` 自设被拒、`designatedBy` 不可解析、`scopeAndTerm` 缺失 ⇒ `rejected_precondition`、无宪制依据 ⇒ 仅意见（`opinion-only`）且**不**产裁定、`recoveryPreconditions` 稳定排序。
- **fake 边界**：手写授予链、判定请求、恢复记录；无库、无通知。
- **不证明**：`REC-AUTH-01/02/03/08` 落账、运行时撤回收口、真实继任程序、通知送达。
- **R/E/W/V**：R/E/W = N/A；V2。
- **规模**：≤320 行。
- **迁移**：与两件同步。

### 5.12 跨卷目标件登记（不在本包，只写接缝）

本节只登记**与 core 直接接壤、且常被误当成 core 件**的目标文件。它们的契约（字段表、端口签名、状态机、测试面）**归各自卷**，本卷**不复制、不另起 F-ID、不在此实现**；这里只写「core 侧怎么消费/被消费」与「越界会坏在哪」。

| 目标件 | 归属卷与 F-ID | 与 core 的接缝 | core 侧禁止 |
|---|---|---|---|
| `packages/contract/src/ports/intent.ts` | 01-contract `F-contract-port-intent`（80-§6.6 `TS-PORT-API-01`、§12.3 指定路径） | 提供 `IntentKey`/`IntentReceipt`/`IntentSubmissionPort`；`IntentKey` 第四位恒 `ticket ?? dedupKey`，与 `decide.intentKeyOf` **逐位一致**（见 `F-core-decide`） | 不在 core 另立 `IntentKey` 结构或第二套键公式；不把 `IntentKey` 的字段序与 `intentKeyOf` 的串序互比 |
| `packages/contract/src/ports/secret.ts` | 01-contract `F-contract-port-secret`（80-§11.2.1、§12.3 指定路径） | `KnownSecretSet.redact`/`find` 必须复用 `contract/src/secrets.ts` 三函数；`core/src/secrets.ts` 只是这三函数的具名再导出 shim | 不在 core 持有 `SecretMaterial`、不实现 `SecretProvider`、不实现或转发 `KnownSecretSet.redactKnown`、不校验 `use ∈ allowedUses` |
| `packages/contract/src/secrets.ts` | 01-contract（80-§11.2-3 指定「整模块迁入」） | 本卷 `F-core-secrets` 的**实现迁入地**；`core/test/secrets.test.ts` 是迁移验收口径 | 不在 core 留第二份正则/标记语义；迁移后不得反向 import core |
| `packages/contract/src/ports/rule.ts` | 01-contract（80-§6.9 类型落点） | `RuleProfile`（体形状归 76）/`RuleProfileRef`/`RuleInputDecl`/`RuleInput`/`RuleLimits`/`RuleLimitTightening`/`RuleOutcome`/`TypecheckReceipt`/`Diagnostic` 的唯一家 | 不在 core 复制字段表或另立同名类型（`rule/` 只 `import type`） |
| `packages/contract/src/ports/spec.ts` | 01-contract（80-§6.9 类型落点） | `SpecEntry`/`DefinitionBundle`/`ImportPlan`/`ImportReceipt` 的家；`core/src/spec/` 只提供纯决策 | 不在 core 定义包/归档形状、不在 core 做路径 containment |
| `packages/contract/src/ports/authority.ts` | 01-contract（80-§6.9 类型落点） | `AuthorityRequirement`（字段归 76）/`CandidateEndpoint`（字段归 78）/`ActivationRequest`/`GrantRequest`/`IncapacityRequest` 的家 | 不在 core 定义端点档案或授予字段表；`authority/` 只吃已解析值 |
| `packages/contract/src/ports/resources.ts` | 01-contract（80-§6.4 末、§6.9 类型落点） | `ResourceBaselineRequest`/`ResourceLimit`/`ResourceEntry`/`ResourceBaseline`/`ResourceGap` 与 `ResourceAccountant` 端口的家（**只两个只读方法**，无 `reserve`/`actual`/`release`） | 不在 core 新增写口、不新增 `REC-*`、不复制缺口词表 |
| `packages/contract/src/ports/work.ts` | 01-contract（80-§6.9 类型落点） | `ReadinessRequest`/`GateResult`/`ReadinessCondition`/`RecReadinessJudgment` 的家 | `ReadinessResolved` 已定在 `core/src/work-readiness.ts`，**不在这里另建**；13 字段表只在 contract，core 不复制 |
| `apps/daemon/src/assembly/intent/ingress.ts` | 17-daemon `F-daemon-intent-ingress`（80-§6.6、§3.6 第 6 步） | `implements IntentSubmissionPort`；调 `WorkIntake.reserve` → 刷投影 → `engine.ingest`；是 `REC-WORK-01` 的唯一**调用**方 | core 不参与「先记录后入队」的顺序，也不提供 ingress；`decide` 不感知回执 |
| `apps/daemon/src/assembly/intent/receipt-store.ts` | 17-daemon `F-daemon-intent-receipt-store`（80-§6.6/§6.3） | `intent_receipts` 投影的唯一维护者；派生 `status` 三值/`outcome` 五值 | core 不派生回执、不判 TTL；`intentKeyOf` 只供查重，不是回执键 |
| `apps/daemon/src/assembly/api/assemble.ts` | 17-daemon `F-daemon-api-assemble`（80-§9.4） | 装配 `:8788`：只收 `ingress`（只暴露 `submit`/`receipt` 两方法）、`ledgerPath`、`company`、`config`；`emitIntent`/`getIntentReceipt` 原样转发；只读台账走 `openLedgerReadonly({path, expectedSchemaVersion, readOnly:true, queryOnly:true})`（80-§8.2） | core 不提供 API 适配、不打开台账、不装配进程；`ledgerPath` 是路径字符串，不进 core |
| `apps/daemon/src/assembly/spec/assemble.ts` | 17-daemon（80-§6.9 落点） | 读盘与包扫描：目录/归档读取、**路径 containment**、把字节 + locator + 摘要交给 `assembleDefinitionBundle` | core 不读盘、不展开归档、不用 `node:path`；读失败不得由 core 补默认值 |
| `apps/daemon/src/assembly/auth/assemble.ts` | 17-daemon（80-§6.9 落点） | 权威端口的包装与接线：`wkey` 仍是凭据不是授权；`gateway` 不承载授权判定 | core 不做凭据供给、不持有 `SecretMaterial`、不写租约 |
| `apps/daemon/src/engine/work/readiness.ts` | 17-daemon（80-§6.9 `WORK-01…11` 子目录） | `TS-PORT-WORK-03` 的端口实现：解析五组引用（`Err` 在此）→ 调 `judgeReadiness`（不返 `Err`）→ 装 `REC-WORK-04` | core 不解析引用、不落记录、不读公司目录；纯核不得被端口语义改写 |
| `packages/store/src/resources/` | 03-store（80-§6.9 落点） | 投影表 `resource_ledger` 与同事务 hook；可由记录重建；**投影不是事实源** | core 不写投影、不建表、不做事务；`resource_ledger` 表名须先按 80-§8.1 提案登记 |
| `packages/store/src/lease/` | 03-store（80-§6.9 落点） | 写者租约与围栏的持久面；`FenceToken` 单调递增、每次 acquire/renew 都换 | core 不持久化租约、不比较围栏代、不把治理代次 `generation` 写进 `fenceToken` |

〔结论〕**本卷对这十六件的全部义务就是上表**：不复制字段表、不复制端口签名、不为它们新增测试（测试归 01/03/17），也不把它们的未实现算作 core 的缺口。core 侧真正的缺口只有 `F-core-secrets` 的替换（`secrets.ts` shim 化）与 §六 各条；新增的四个纯逻辑子域只承担「判定/派生」，不承担端口的 IO 与记录。

〔说明〕`intent_receipts` 的持久化原语属 03-store（`ProjectionName='intentReceipts'`），本卷不登记；daemon 的 `intent/`、`spec/`、`auth/`、`work/` 目录预算与域平面额度归 17，本卷的 25/600 只管 `packages/core`。`resource_ledger` 已登记为目标第 18 个投影（逻辑名 `resourceLedger`，80-§6.3），随 `MIG-01` 建表；**当前未建表、未接 hook**，不得把已登记写成已实现。

〔跨卷一致性复核〕① 意图组件以 17 的 `F-daemon-intent-ingress`/`F-daemon-intent-receipt-store` 为准，03-store 当前不再使用 `F-daemon-assembly-*` 别名。② 82-§10.3 已使用单数 `core/src/rule/` 并包含 `spec/`、`authority/`、`resources/`；`GAP-82-02` 已改为设计闭合、实现未做。本卷与 82 均按 **73** 件目标计数，§六-18 仅保留审计编号，不再是待办。

---

## 六、需回写 75–80 的缺口

本节保留 19 条审查编号，登记「对象 / 现文事实 / 处置 / 未证边界」。**1–19 均已完成设计对账**：1–8、10–19 的设计缺口已关闭，9 明确由包级类型门禁覆盖；没有一条允许以文档结论冒充实现证据。后续实施遇到上位字段冲突仍须停手回写，不在本附录私设第二套；未实现的文件、迁移、真实调用和共同向量仍以「目标/未证」计。

**1. 已关闭（设计面）：`TS-PORT-RULE-01` 的档、引用、摘要与版本边界**

- 对象：80-§6.1 `RuleEvaluator`；76-§6.8 `DEF-RULE-06`；`TS-REF-06`。
- 现文事实（**已回写**）：80-§6.1 现已给出 `typecheck`/`evaluate` 两入口与 `Result<RuleOutcome, ClassifiedError>`/`Result<TypecheckReceipt, ClassifiedError>`；第四参是 `tightening: RuleLimitTightening`（`Partial<RuleLimits>`）；`RuleLimits` **七项全必填**（`maxNodes`/`maxDepth`/`maxListItems`/`maxStringCodePoints`/`maxDecimalDigits`/`maxDecimalScale`/`maxSteps`），另三项（模式输入长度/模式匹配步数/量词嵌套层数）**档内固定、不进该类型**；`Diagnostic` 用 `location`/`expected?`/`actual?`，判别联合把 `phase='limit'` 收窄到 `code='E-RULE-003'` 且 `limitsApplied` 必填；`RuleDiagnosticCode` **18 个**（`E-RULE-001`–`014` + `E-RULE-020` + `W-RULE-001`/`W-RULE-002`/`W-RULE-005`）；`RuleOutcome` **七字段**且 `profileRef.digest`/`inputsDigest` 必须是 `semanticDigest`；并写死「两段不合并」「四值不压布尔」「`refused` 留 `Ok`」「码→相位固定映射」「`profileRef` 取自档自身」。**v0.2 列的 (a)(b)(c) 三条、「缺 `profileRef`/`inputsDigest`/`steps`」「`result` vs `outcome`」「5 必填 + 2 可选」「17 个码」「`path`/`safeDetails`」均已关闭。**
- **现行关闭口径**：80-§6.1 已把 76-§6.2–§6.11 机械映射为完整 `RuleProfile`，含 `inputDecl`、封闭 `RuleNode`、类型系统、算子、限额、模式模型、确定性声明、诊断码与用例引用；不再是空接口，也不引入第二规则语言。
- `RuleProfileRef = ProfileRef`，不再使用 `bindingId` 别名；档自身的 `semanticDigest` 必须等于引用 digest。`inputsDigest`/`inputDeclDigest` 统一经 §4.5 `Canonicalizer` 产生语义摘要，core 不自造规范化。
- `E-RULE-020` 与 `Err(rejected_version)` 的边界已定：档本身不可解析/版本不成立 → `Err`；已解析档的内部引用版本不符或撤回 → `Ok(refused)` + `E-RULE-020`。`Int` 与 `Dec` 以 `DecimalString` 保留词法，只在 `core/src/decimal.ts` 内转成 `bigint` 运算，不把 `number` 当数值本体。
- 本条不再阻塞 `rule/` 五件的文件设计；实现、共同向量与性能验证仍未执行。

**2. 已关闭（设计面）：`TS-PORT-WORK-03` 的解析输入、角色与失败路径**

- 80-§6.4 已给 `Readiness Resolved` 实现类型及唯一落点 `core/src/work-readiness.ts`；它不是公共端口、也不迁入 contract。daemon 的 `engine/work/readiness.ts` 负责异步解析与记录装配，core 只做同步纯核。
- `decidedBy` 是合同指定且当前有效任命的承接者，不从五门挑选、不接受自报；各门 `judgedBy` 保留具名判断者。默认角色与独立 `qualifier` 的使用条件均已明确。
- `baseline()` 的 `Err` 原样成为端口失败，不调纯核、不伪造 `不可开工`；附条件缺四字段等结构错误在纯核前 `rejected_precondition`。
- 纯核只消费已解析 `RuleOutcome`；端口先把结果落为 `REC-EVT-01` 操作观察，并由 `basisRefs` 引用，`GateResult` 不再另加槽位。`refused` 仍只导致该门与整单 `不可开工`，不是第四种门结论。
- 剩余只是实现与证据未做，不再有本节所列六项设计待定。

**3. 已关闭（设计面）：core 组件与纯实现文件的归属**

- 80-§2.1 的 core 行已列出既有纯逻辑族，以及 `decimal`、`rule/`、`work-readiness.ts`、`spec/`、`authority/`、`resources/` 的目标纯核；脱敏迁 contract 的边界不变。
- §6.0 是端口状态矩阵、§6.8 是既有内部端口清单，**都不承担逐文件清单**；纯实现件的唯一落点表是 §6.9，不能要求把它们伪装成新增公共端口。
- 本卷目标为 **35** 个 src 文件（18 现有 + 17 新增），原「34 个」已随 decimal 补齐而失效。micro-judge 等现有纯函数可由既有 `QueueJudgeHook` 等内部端口消费，不另造公共端口。

**4. 已关闭（设计面）：`REC-WORK-04` 的唯一装配归属**

- `engine/work/readiness.ts` 负责异步解析、资源/规则端口、规则证据事件、调用 core 纯核，并经 `RecordWriter` 写完整 `REC-WORK-04`；core 不落记录。
- `decidedBy` 来自合同与有效任命；`decidedAt` 来自 `ReadinessRequest`；`rationale` 由门序与结论派生为确定性短文本，不自由创作；`effectiveState/effectiveTime` 来自当前权威激活，不由纯核猜测；facet 与顶层投影同值。
- 条件责任者/期限、异议位置、判断范围与重判触发均从权威引用解析，不由模型补写。13 字段仍不增不减，剩余只是实现未做。

**5. 已关闭（设计面）：金额与摘要的形态及迁移归属**

- 公共金额是 `DecimalString` + 行内显式币种，目标存储为 TEXT，不是 REAL，也不是全库隐式单币种；目标精确算术唯一在 `core/src/decimal.ts`。`Money.usd:number` 只保留为现状/旧记录兼容，不是目标计算载体。
- 03-D4 已指定 MIG-03 的快照、干跑、旧 REAL 只读导出、精确转换、逐行对账、单写切换与授权退役顺序；**禁止新旧双写**。旧浮点行标 `reconstructed` 与实际限制，无法证明的原词法记 unknown + `REC-LOSS-01`。
- `sha8` 只作展示，身份/判等用完整 `semanticDigest`；新旧读路径及损失均已写明。剩余只是迁移实现与核验未做。

**6. 已关闭（设计面）：平台流表的公司来源与回退**

- 80-§7.2 已指定运行时唯一来源为挂载公司的 `CompanySnapshot.workflows` 与对应 `FieldProvisionMap`：优先该类型 `typeFlows[type]`，否则该公司显式 `stateFlow`；同键不合并，不用内建表兜底。两者均缺 ⇒ `rejected_precondition` + `CONFIG_INVALID`。
- 内建 L0/L1/L2 只作迁移期显式复制进公司定义的模板材料，旧公司未迁移只保留旧行为并登记损失。面板与 `decide` 读同一快照，平台流与 77 工作态不得互相结清。
- 本条不要求 core 读公司目录；装载/校验在 daemon/company 边界，core 仍只消费注入的 `FlowTable`。

**7. 已关闭（设计面）：脱敏强制点、证明方式与退役窗口**

- 80-§11.2.1「调用边界」已指定九个出站/落笔强制点：出站统一 `KnownSecretSet.redact`，内部提示/任务书/REPORT 用 `redactKnown`；未调对应方法不得出站，`find` 只诊断不作拒绝门禁。
- 82-MIG-03 规定每个强制点用 fake `KnownSecretSet` 验证**确实调用了对应方法**并检查输出，不只测正则；不能以“算法在 contract”推导“所有路径已覆盖”。
- `core` 的脱敏 shim 只在全仓零旧 import 后退役并跑全量回归；迁移前保留兼容，不另设第二算法。当前九处接线与证据仍未完成。

**8. 已关闭（设计面）：公司日界来源与签名**

- 78-§7.5 已指定 `CompanyZone` 来自 `company.yaml` 的 `calendar.zone`（IANA）与可选 `calendar.offsetMinutes`；本地日功能缺 zone ⇒ `CONFIG_INVALID`，不得读宿主时区；两者都给以 IANA 为准并记诊断。
- 新调用统一 `companyDayKey(ms, zone)`；`foldUsageDaily` 的目标输入改为调用方已算好的日键，随 `usage_daily` 重建另立实现单，不在这轮暗改签名。`localDateKey` 仅作旧记录过渡；UTC 日键不冒充公司本地日。`Intl`/tzdata 跨宿主共同向量仍未执行。

**9. 已明确（工程门禁）：core 测试类型由包级类型检查覆盖**

- 根 `typecheck` 继续覆盖 src，**不能**声称覆盖 `packages/core/test/**`。82-MIG-03 另要求 `mise exec -- bun --filter @studio-next/core typecheck`，其 tsconfig 含 `src/**/*.ts` 与 `test/**/*.ts`，覆盖现有 17 + 新增 11 共 **28** 个测试件及子目录。
- 不必为同一份源码重复扩张根 program；包级命令是该包的验收前置，不得用 vitest 运行绿代替类型绿。本次只写目标门禁，未修改根 tsconfig 或脚本。

**10. 已关闭（设计面）：golden 仅作测试证据格式，不设生产 trace 端口**

- `core/golden.ts` 与六夹具只用于确定性回放测试，**不是**生产采集、外部交换协议或完整证据面，故不需要新增公共端口或记录类型。现有生产证据仍以 REC/记录投影为准。
- 若未来需要从生产采集并跨实现交换 trace，须另立提案定义来源、版本、脱敏与存储，不得把现有 golden 夹具直接升格。当前不得声称「可回放生产记录」。

**11. `FailureClass` 与 `ErrorCategory` 的映射端口（已由 80-§5.7 关闭）**

- 对象：77-§11.1（14 值）；80-§5.7（两轴一个载体）；80-§6.0 端口表。
- 现文事实（**已回写**）：80-§5.7 已把两套词表装进同一个 `ClassifiedError`（`failure` 处置轴 + `category` 观测轴），给了**唯一处置表**（14 行「处置 / 不得」）、**缺省 `category` 推导表**（含仅在显式泳道上下文才可写 `NO_LANE`）、**`Err` 可达 6 类 `category`**、旧 `category` 分支的缺省档规则与迁移期双写要求。
- 本卷据此：`dispositions.ts` 降为缺省档（见该件条目）——**本条关闭**，不再需要独立「映射端口」。
- 残余（并入 §六-16）：内部事件域（`GATE_FAIL`/`WORKER_DEAD`/`QA_BACK`/`DISPATCH_FAIL`/`LLM_FAIL` 等）**不在 `Err` 面**，它们与 `failure` 的对应、以及断路器计数口径仍未写。

**12. 已关闭（设计面）：micro-judge 是内部策略与既有内部端口，不新增公共端口**

- `core/judge.ts`/`judge-gates.ts` 是纯函数库；daemon 的 `QueueJudgeHook`（80-§6.8、§7.2 2f）已是内部调用边界。三帽、降级枚举与按址熔断属于该实现的版本化策略，不自动升格为公共规范，也不新增第 56 个公共端口。
- 目标在 daemon 装配 `QueueJudgeHook` 时先执行 `assertJudgeVocab`，失败即 `CONFIG_INVALID`，不得等首次模型调用才暴露词表漂移；core 不做模块级副作用。现有「生产未调用」仍是实现缺口，不宣称已强制。
- 策略变更需伴随版本与回归证据；不需要把内部实现细节改写成公司规范。

**13. `repo-validate` 的边界（已关闭：只有规则求值在 core，非整个文件下沉）**

- 对象：80-§10.6 表（`packages/company/src/repo-validate.ts` 1021 行）、80-§2.1 包表、80-§2.3 第 3 条；80-§13.1 **D17**；`core/src/rule/`。
- 现文事实（**已回写**）：80-§10.6 现写「**留 `company`**：按『目录规则族』在本包内拆（字节/路径/归档/纯配置校验各一件）；**不下沉 `core`**——`core` 只承担 `RuleProfile` 求值，不接管目录校验」；80-§2.1 的 `company` 行同结论；§2.3 第 3 条的措辞也已收窄为「下沉的只是『规则求值』这一层，落 `core`（`RuleEvaluator` 纯函数），两者的输入/输出边界在 §6.1 划清」。
- **本条关闭**：**非整个 `repo-validate` 下沉**——字节/路径/归档/纯配置校验留 `company`，core 只做 `RuleProfile` 的表达式求值。本卷不新建「语法校验」组件，`rule/` 五件只做 `RuleProfile` 求值（目录按 80-§6.9 用单数；此前写作 `rules/` 属笔误，已更正）；`repo-validate` 的拆件归 `company` 自己的卷（04-company）。
- 残余（不属本卷）：`company` 的拆件清单与阈值归 04 卷；本卷不登记。

**14. 已关闭（设计面）：两个策略告警由策略消费方产生**

- 80-§6.1 已明确：`W-RULE-001` 与 `W-RULE-002` 由读取方向表和覆盖面的**策略消费方**产生；纯 `RuleEvaluator` 只返回求值四值及 `W-RULE-005`，不向 `RuleInput` 偷塞策略条目。
- `typecheck` 相位的 `W-RULE-001` 是诊断登记位置，不是要求 core 凭空获得条目状态；`policy` 相位的 `W-RULE-002` 与“允许”必须在日志上可区分。
- 本条无需给 `RuleInput` 加字段，也不阻塞 `rule/` 五件设计；策略消费方及诊断联调仍未实现。

**15. 已关闭（设计面）：五门消费预求值结果，不在纯核内复用 `RuleEvaluator`**

- 采用 80-§6.4 的方案：`engine/work/readiness.ts` 先调 `RuleEvaluator` 并把 `RuleOutcome` 保存为 `REC-EVT-01` 操作观察；`core/src/work-readiness.ts` 只消费已解析结果，**不 import `rule/*`**，也不新增编译层或 `E-READY-*` 码空间。
- `GateResult.basisRefs` 保存上述事件 `RecordRef`，因此不必也不应再加 `RuleOutcome` 槽位；非规则门由原始依据记录支撑。值用于判定、引用用于证据，不互相替代。
- 本条不再要求给 `GateResult` 改形，也不要求重写为规则组合层；实现与跨层验证仍未执行。

**16. 已关闭（设计面）：内部事件折算与断路器签名**

- 80-§5.7 已定目标签名 `failure + subcause`，同一工作/attempt 的同一事件只计一次。`GATE_FAIL` 与 `QA_BACK` 是正常业务不通过/返工，按 `rejected_state` 处理且不计技术断路；`WORKER_DEAD` 为 `unavailable/worker-dead`；`DISPATCH_FAIL` 保留原 `failure`，缺失时才用 `unavailable/dispatch-unclassified` 且不得双计。
- `LLM_FAIL` 与 `judgeLlmFail` 默认 `unavailable/llm-unavailable`（缺省 `STALL`，不得从 `Err` 选 `LLM_FAIL`）；超时先对账，只有已声明并验证过的降级才可 `degraded`。
- 旧自由串只作现状兼容，不再作为目标判等键。实现、计数去重与迁移验证仍未做，不预称「断路器已按 `failure` 计数」。

**17. 已关闭（设计面）：`DecimalString` 的唯一精确算术入口**

- 76-§1.2.1 与 80-§5.11 已定十进制有理数、`bigint`、0..9 标度、默认 `half-even`、34 位输出与 128 位中间精度上限，以及除零/超精度错误；禁止 `Number()`/`parseFloat()` 兜底。
- 唯一实现归 `core/src/decimal.ts`；`rule/values.ts` 与 `resources/quota.ts` 复用 `../decimal.ts`，不得各留第二套算法。求值器的 `Dec` 与交换标量仍是不同语义，共用算术不等于共用类型。
- 剩余只是实现与跨实现共同向量未执行；不得再写成“无上位入口”，也不得预记跨实现一致。

**18. 已关闭（设计面）：82 的 MIG-03、资源端口与追溯已同步**

- 82-§10.3 已使用单数 `core/src/rule/`，并纳入 `spec/`、`authority/`、`resources/`；`GAP-82-02` 已收窄为“设计闭合、实现与验证未做”，资源评估由 `TS-PORT-RES-01` 主承。
- 82 的追溯行已登记 `F-core-resources-*`、`F-core-spec-*`、`F-core-authority-*` 等真实文件 ID；资源账目仍由记录与投影承载，`ResourceAccountant` 只读评估，不因此声称账目已实现。
- 本条不再要求回写 82；保留原编号仅为审计追溯。

**19. 已关闭（设计面）：`work-readiness.ts` 的唯一路径已定**

- 对象：80-§6.9 的目录约束与 §7.2 2h 的显式路径。
- 现文事实：80 已明确 `packages/core/src/work-readiness.ts` 是五门纯核的唯一目标文件；`core/src/work/` 不再作为备选路径。80-§6.9 的“新文件进既有子目录”只约束其中点名的端口实现，不推翻 §7.2 2h 的显式落点。
- 本卷承接：`F-core-work-readiness` 及其测试/barrel 条目均以直属文件为准；不得再创建 `core/src/work/readiness.ts` 或第二个 F-ID。
- 剩余边界：设计路径已关闭，目标文件仍未实现；目录阈值与包间边仍按现状 guard 验收，不因本条目关闭而预记通过。

〔附注〕跨卷命名一致性（03 的 `F-daemon-assembly-*` vs 17 的 `F-daemon-*`）已并入 §5.12 末段，不在本条重复登记。

---

## 七、迁移顺序与删除边界

本轮**不动任何代码、测试、配置或脚本**。下列顺序是后续实施单的**建议批次**，每批都必须有自己的实现单与证据。

| 批次 | 内容 | 前置 | 回退 |
|---|---|---|---|
| 0 | 本卷过审；§六 的 **19** 条按「改上位卷」或「接受现状」逐条裁决（其中 11、13 已关闭，只需确认关闭成立；1、2、5、8 已收窄为「残余」） | — | 只改文档 |
| 1 | 类型面：contract 的 `ports/rule.ts`（完整 `RuleProfile` + `Canonicalizer` + `profileRef`）、`ports/work.ts`（13 字段）、`ports/resources.ts`、`ports/spec.ts`、`ports/authority.ts`；core 的 `decimal.ts` 与 `work-readiness.ts`（`ReadinessResolved` **不迁 contract**） | 80-§6.1/§6.2/§6.4/§5.11 已定（§六-1/2/17）；不伪造空接口或第二个规范化入口 | 回退对应类型件即回退整批 |
| 2 | `src/rule/values.ts` → `pattern.ts` → `operators.ts` → `typecheck.ts` → `evaluator.ts` 五件落盘（**不接线**、不进 barrel；`typecheck`/`evaluator` 同日） | 批次 1 的规则类型 | 删五文件即回退（无调用方） |
| 3 | `test/rule/typecheck.test.ts`、`evaluator.test.ts`、`pattern.test.ts` 落盘；包级 `tsc` + vitest 通过 | 批次 2 | 删三文件 |
| 4 | `src/work-readiness.ts` + `test/work-readiness.test.ts` 落盘（**不接线**）：13 字段、五门角色、聚合规则一次写完 | 批次 1 的 readiness 类型；§六-2/§六-4/§六-15 已裁决 | 删两文件（无调用方） |
| 5 | `src/resources/quota.ts`、`baseline.ts` + `test/resources/quota.test.ts`、`baseline.test.ts` 落盘（**不接线**） | 批次 1 的资源类型；§六-17 已指定 `src/decimal.ts` 为唯一算术实现，两个资源件只复用，不保留本地第二算法 | 删四文件 |
| 6 | `src/spec/registry.ts`、`loader.ts`、`importer.ts` + `test/spec/registry.test.ts`、`importer.test.ts` 落盘（**不接线**） | 批次 1 的 spec 类型；`findSecretShaped` 已在 contract | 删五文件 |
| 7 | `src/authority/requirement.ts`、`candidates.ts`、`activation.ts`、`grant.ts`、`incapacity.ts` + `test/authority/activation.test.ts`、`grant.test.ts` 落盘（**不接线**） | 批次 1 的 authority 类型；§六-12 不阻塞（micro-judge 是另一面） | 删七文件 |
| 8 | `src/index.ts` 加 **14 条**再导出（按子域分批：`decimal` 1、`rule` 2、`work-readiness` 1、`resources` 2、`spec` 3、`authority` 5）；头注改为文档锚 | 对应子域的批次全绿；且确认无人从包根依赖旧头注文本 | 删对应行即回退 |
| 9 | `PACKAGE_STATUS` 退役（**须批示**）：先复算全仓零消费者，再删常量与注释 | 批示 + 复算 | 加回两行常量即回退 |
| 10 | `secrets` 迁 contract 五步：contract 落实现 → core 转具名再导出 → `test/secrets.test.ts` 改 import（断言不动）→ 调用方直连 contract → shim 处置 | 80-§11.2-3；每步单独过包级 `tsc` | 每步可单独回退；**不得**先删实现再加 re-export |
| 11 | **归 01 卷执行**：`contract/src/secrets.ts`、`src/daykey.ts`（`DAY_MS`/`dayKeyOf`/`companyDayKey`/`CompanyZone`）、`src/ports/intent.ts`、`src/ports/secret.ts` 落盘；本卷只在接线侧消费，不提交这四件 | 01 的 M2/M2c；80-§12.3 指定路径 | 回退 contract 四件即回退本批（core 无改动） |
| 12 | 补 `ClassifiedError.failure`：core 五处构造器（`budget.budgetInvalid`、`judge.configInvalidJudge`、`judge-gates.assertJudgeRoleLow`、`evolution.ChangeRejectedError`、`pricing` 的 `configInvalid` 路径）加 `failure:'rejected_precondition'`，并加「`Err` 不得选五个内部事件 `category`」的负向测试 | 批次 0 裁决 §四.5；80-§5.7 已回写；`kernel.ts` 的 `ClassifiedError` 先加字段（归 01） | 逐个构造器回退；负向测试随之删除 |
| 13 | `judgeLlmFail` 整改为 `unavailable/llm-unavailable`（缺省 `STALL`） | 80-§5.7 已明确内部事件折算与 `Err.category` 边界（§六-16）；不得从 `Err` 选 `LLM_FAIL`，也不得静默降级 | 还原构造器一行 |

〔顺序约束〕批次 1 是 2–7 的类型前置；2–7 之间**互不依赖**（`work-readiness` 不 import `rule/*`、`resources/*`；`authority/` 互不 import；`spec/` 只内部单向），可按泳道并行，但**每条泳道必须自带测试**。批次 8 必须在对应子域**全部**通过包级 `tsc` + vitest 之后，且一次只加该子域的再导出。批次 11 是 12/13 的类型前置（`failure` 字段与端口类型在 contract），但不阻塞 2–7（纯函数件不吃 `failure`）；批次 12 可在 11 之后任意时刻做，**不得**与 2–7 混在同一次提交（两轴迁移会污染纯函数的「零行为变更」证据）。

〔不属本卷批次〕`store/src/resources/`（`resource_ledger` 投影与同事务 hook）、`store/src/lease/`、`assembly/spec/assemble.ts`、`assembly/auth/assemble.ts`、`engine/work/readiness.ts` 的落盘分别归 03/17；它们不改变本卷第 6–7 批的「未实现」判定（80-§6.9 末尾：目录存在与否不改端口状态）。

现有 45 件的处置为「44 件零行为迁移 + 1 件替换（`secrets.ts`，批次 10，语义冻结）」：不改签名、不改默认值、不改错误码、不改导出符号（例外：`index.ts` 的再导出与常量分属批次 8/9；`secrets.ts` 的实现位置属批次 10；`Err` 载荷加 `failure` 属批次 12，**只加字段、不改 `category`/`subcause`**，故仍算非行为迁移——旧读方读 `category` 不变）。这意味着：

- **不做**的改动：不拆 `decide`/`evolution`（§3.3 只是预置线）；不改 `Money` 形态（D17 已定「只留内存形态」，列迁移归 store，§六-5）；不改 `localDateKey` 签名（D17 已定它只作旧记录过渡，签名变更须立单，§六-8）；不改 `fingerprint` 位数；不把 `dispositions`/`golden` 接进生产；不删 `normalizeModelKey`；不改 judge 阈值；不在 core 保留第二份脱敏实现；不新建「目录语法校验」件（§六-13 已关闭）；**不在 core 建资源表/租约表/投影**（§六-17 与 §5.12）；**不新增 `REC-*` 与 `E-RES-*`/`E-READY-*` 码空间**。
- **删除边界**：本卷无文件删除。唯一删除面是 `PACKAGE_STATUS` 常量，条件=批示 + 零消费者复算 + 确认没有文档把它当能力证据（2026-10-27 复算：无）；`secrets.ts` 只换实现位置，文件本身退役须另行批示。
- **新增件的删除边界**：28 件在未接线前删除是纯回退；一旦加了再导出（批次 8），删除须先移除再导出，否则包根断。`decimal.ts` 是 76-§1.2.1 与 80-§5.11 已指定的唯一精确算术实现；`rule/values.ts` 与 `resources/quota.ts` 只复用它，不再保留“等上位后再删本地算法”的过渡件。
- **不得以重构冒充升级**：批次 2–8、10–13 不提升任何能力声明；`PACKAGE_STATUS` 退役也不代表「包已就绪」，`secrets` 迁到 contract 也不代表「出站已覆盖」，补 `failure` 也不代表「断路器已按 `failure` 计数」（§六-16），`resources/` 落地也不代表「资源账目已实现」（只有只读评估，账目仍是记录 + 投影）。

---

## 八、未证与不可声称清单

以下各条在取得证据前**不得**在文档、面板或提交信息里写成「已具备/已覆盖/已验证」。

1. **`dispositions` 的处置表未被任何生产代码消费**：daemon 的注释声称按表执行，但零 import。可声称的只有「表存在且自测通过」。
2. **`golden` 的回放只在测试内发生**：6 个夹具是手写 trace，不来自生产采集；不能声称「可回放生产记录」。
3. **`evolution` 的提案/谱系/闸门未接生产**：`proposeCandidate`/`lineage`/`gate`/`applyGateDecision`/`makerRuling`/`decisionToStatus` 只被 daemon 的 e2e 测试使用；生产只有状态迁移与判负两个函数被调用。
4. **`secrets` 的出站覆盖未成立**：算法虽已定为 contract 唯一实现（80-§11.2-3），但迁移未做、生产只有 hr-sync 装配一处调用（经 core 再导出）；不能声称「所有出站文本已脱敏」。正则的最坏时间也未测（长文本、嵌套引号、极长 base62 段）。
5. **`cost-insights` 的四规则无专属用例**：只有经 `costclose.test.ts` 的间接覆盖；阈值边界（恰等于 5 USD、恰等于 3 倍、7 天窗口端点）是否都被断言，未核。
6. **`rule/values` 的十进制一致性与性能未证**：34 位有效数字、9 位标度、半偶舍入的跨实现一致需要共同用例（76-§8.4/§8.5）；BigInt 在大列表上的开销未测。**另**：它与 `resources/` 的 `DecimalString` 是两套语义（求值器的值 vs 交换标量），不得互相折算或互借实现（§3.4）。
7. **夹具与摘要无版本字段**：6 个 golden 夹具没有版本键，格式变更只能整体替换；`models.fingerprint` 是 sha8，无法回答「用哪套规范化算的」。跨版本回放与跨实现比对均未证。
8. **`judge` 的注册闸生产未调用**：`assertJudgeVocab` 只在测试中被调用；不能声称「词表在装配期已被强制」。
9. **`budget` 只证明了纯折叠**：事务原子性、并发双花、崩溃点①（reserve 双行后、launch 前）的恢复全部在 store/daemon，core 侧无证据。
10. **core 的测试类型不在主门禁内**：`bun run typecheck` 不覆盖 `packages/core/test/**`（79-D10）；现有 17 件与新增 **11** 件（共 **28** 件）同样如此，须另跑包级类型检查。
11. **包根 barrel 无行为覆盖**：17 个现有测试全部用相对路径 import `../src/xxx.ts`；`index.ts` 的 `export *` 只有 `tsc` 能发现名称冲突。目标态 **31** 条 `export *` 同样不会有行为覆盖。
12. **`PACKAGE_STATUS` 退役后没有替代的包状态声明**：这不妨碍运行（零消费者），但对外表达会缺一栏；若需要，应由 82 的发布/证据面承接，不由 core 自封。
13. **`work-readiness` 未实施**：`packages/core/src/work-readiness.ts` 与 `test/work-readiness.test.ts` 均未落盘、未接线；不能声称「开工五门已具备」。80-§6.4 已给 13 字段、`ReadinessResolved`、角色/失败路径、记录装配与规则证据归属（§六-2/4/15 设计面关闭）；**仍缺实现与验证**，不是待补概念。
14. **`secrets` 的迁移未实施**：现状仍是 core 自有实现 + 单一出口（`index.ts:82` 的 `export *`），`contract/src/secrets.ts` 尚不存在；不能声称「脱敏已是单一实现」。`KnownSecretSet.redactKnown` 同样不存在于 contract——不能声称「集合侧已复用三函数」。
15. **出站脱敏的强制点未实现**：九处出站面没有逐点挂接，也没有「未调用即失败」的证明手段；不能声称「覆盖成立」。
16. **`ClassifiedError.failure` 全仓尚未加上**：`packages/contract/src/ports/kernel.ts:98`–`:101` 现形仍是 `{ category, subcause, detail? }`，全仓无一处 `Err` 构造带 `failure`。因此本卷 §四.5、§5.2 `breaker`、§5.3 `budget`、§5.4 `judge`、§5.6 `evolution` 列出的两轴迁移项**一条都未实施**；不能声称「处置已按 `failure`」。另：`judge.judgeLlmFail` 的 `category='LLM_FAIL'` 仍是现存缺陷（§六-16）。
17. **意图通道端到端未落地**：`apps/daemon/src/assembly/api/assemble.ts`、`assembly/intent/ingress.ts`、`assembly/intent/receipt-store.ts` 均不存在（`assembly/` 下只有 `channels`/`demo`/`hrsync`/`jobs-seed`/`notify`/`platform`/`render`/`serve.ts`/`serveconfig`/`sources`）；`intent_receipts` 投影在 `packages/store/src` 与 `apps/daemon/src` 内**零命中**。§5.12 的意图三件全部是**目标件**，不能声称「对外 API 已能收单」。
18. **跨卷九件未落盘**（四件既有交叉引用 + 五件 80-§6.9 新点名）：`contract/src/secrets.ts`、`src/daykey.ts`、`src/ports/intent.ts`、`src/ports/secret.ts` 均不存在（`packages/contract/src/ports` 现只有 `company.ts`/`executor.ts`/`gateway.ts`/`index.ts`/`invoke.ts`/`kernel.ts`/`models.ts`/`notifier.ts`/`platform.ts`）；80-§6.9 新点名的 `contract/src/ports/rule.ts`、`ports/work.ts`、`ports/resources.ts`、`ports/spec.ts`、`ports/authority.ts` **同样不存在**。**设计形状已补齐**：`RuleProfile` 已按 76 映射完整字段，`ReadinessResolved` 已落在 core（§六-1/2）；`secrets` shim 化与 `companyDayKey` 消费的实现仍未做。这里缺的是文件与验证，不再把它们误记为类型空缺。
19. **四个纯逻辑子目录与三处他卷落点均不存在**（2026-10-27 实测）：`ls packages/core/src/*/` 无匹配——`core/src` 只有 18 个直属 `.ts`，**没有** `rule/`、`spec/`、`authority/`、`resources/`；`packages/store/src` 无 `resources/`、无 `lease/`；`apps/daemon/src/assembly` 无 `spec/`、无 `auth/`；`apps/daemon/src/engine` 无 `work/readiness.ts`。80-§6.9 是**目标落点**，不能读成现状。
20. **精确算术实现与跨实现一致性未证**：`core/src/decimal.ts` 已由 76-§1.2.1/80-§5.11 指定为唯一实现，`rule/values.ts` 与 `resources/quota.ts` 只能复用（§六-17 设计面关闭）；文件尚未实现，共同向量未执行，不能声称本实现或跨实现已一致。
21. **82 的路径与追溯已对齐、实现未做**：82-§10.3 使用单数 `core/src/rule/` 并含 `spec/`、`authority/`、`resources/`；追溯含相应 F-ID，计数与本卷均为 73。`GAP-82-02` 是设计闭合、实现与验证未做，不再写「资源无端口」（§六-18）。

---

## 九、对主索引完成判据的自检

按 81-§六 的八条逐项对照本卷：

1. **路径可枚举、可复算**：§二 四张表给出 45 件的完整路径与 `ls`/`wc` 复算方式；§三给出 **28 件新增**与 1 件替换的完整路径与计数（44 + 1 + 28 = **73**；其中 **35** 生产源码、**28** 测试、6 夹具、4 配置）。
2. **每件都有内部结构、依赖、IO、错误、测试、迁移**：§五 的 **67 个具名条目** + 夹具表（6 件）逐件覆盖 73 件，缺失面写 `N/A` 并给理由。§5.12 另登记 **16 个跨卷目标件**的接缝（`contract/src/secrets.ts`、`ports/{intent,secret,rule,spec,authority,resources,work}` 类型面、`store/src/{resources,lease}`、`assembly/{spec,auth}`、`core/src/work-readiness.ts`、意图三件）：只写「core 怎么消费/被消费」，**不复制字段表、不新增 F-ID、不计入 73 的分母**——它们的契约归 01/02/03/17。
3. **新增件能回到 76/80 的 ID**：`decimal` 对 76-§1.2.1/80-§5.11；`rule/` 五件对 80-§6.1 `TS-PORT-RULE-01` 与 76-§6.3–§6.12；`work-readiness` 对 80-§6.4 `TS-PORT-WORK-03`、80-§7.2 2h、77-§4.4.1；`resources/` 两件对 80-§6.4 末 `TS-PORT-RES-01`、80-§4.1 `TS-SCALAR-04`、77-§4.4.1/§4.5.1；`spec/` 三件对 80-§6.1 `TS-PORT-SPEC-01/02/03`、76-§2.8；`authority/` 五件对 80-§6.2 `TS-PORT-AUTH-01`…`07`、77-§3.1–§3.8。残余缺口在 §六逐项标明，不能用目标文件存在代替接口/实现证据。
4. **超限件有拆分清单、未提高阈值**：core 无超限件、无 `lineBaseline` 条目；新增件规模上限最大 **420**（`src/work-readiness.ts` 400、`test/rule/evaluator.test.ts` 420），均小于 600；`evolution.ts` 给的是触阈后的预置拆分线，且明确「未实施」。
5. **无端口族通配引用、无来源不明的 `REC-*`、无虚构依赖、无虚构能力**：全文引用的端口 ID 逐个具名——`TS-PORT-RULE-01`、`TS-PORT-WORK-03`、`TS-PORT-RES-01`、`TS-PORT-SPEC-01/02/03`、`TS-PORT-AUTH-01`…`07`、`TS-PORT-API-01`、`TS-PORT-EFF-01`，全部逐字来自 80-§6，不写「某族端口」这类通配；`REC-WORK-04`/`REC-WORK-05`/`REC-EVD-01/05/06`/`REC-AUTH-01/02/03/04/07/08` 逐字来自 77；依赖只列实测四项 + `node:crypto`；§八 集中列出不可声称项（21 条），其中算术入口与 82 同步已经关闭设计缺口，**仍未取得实现/跨实现证据**。
6. **现有/目标/未证分清**：每条都有处置标签（含「目标-替换」的 `secrets.ts`）；`dispositions`/`golden`/`secrets`/`evolution`/`work-readiness`/`rule`/`spec`/`authority`/`resources` 的接线程度按实测写：**35** 个目标 src 中 18 现有、**17** 目标新增（含 `decimal.ts`），四个子目录与两个直属新件均不存在（§八-19），不越级。
7. **覆盖保留/拆分/新增/替换/退役及测试/配置**：44 保留 + 1 替换 + **28** 新增 + 0 拆分 + 0 文件退役（另有一个常量目标-退役）；测试 **28** 件（17 现有 + **11** 新增）、夹具 6 件、配置 4 件均在册；`index.ts` 目标 **31** 条 `export *`（17 + **14**）已逐条列出。
8. **政策项与工程选择分开**：§六 的 **19** 条保留原编号作审计索引，现均有明确设计处置；1–8、10–19 的设计缺口已关闭，9 由包级类型门禁覆盖。§七 的批次是工程顺序（0–13），实际实现、迁移和验证仍须另立单、另取证。本卷不把未决政策写成已定事实，也不把设计闭合写成能力已具备。

以上八条成立的前提下，本卷可作为 `packages/core` 的实现单依据；但它**不是**完成证明，也不证明任何一条真实能力已上线。
