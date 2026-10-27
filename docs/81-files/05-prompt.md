# 81-files · 05 · `packages/prompt`：L0–L5、指纹、裁剪、消毒

> 〔历史版本 v0.2〕2026-10-27。v0.2 相对 v0.1 的实质修订六处：① **错误面**——本包不设 `Result`/`Err` 通道，构造期非法统一走 `contract` 的 `configInvalid(subcause, detail)`（`failure='rejected_precondition'`、`category='CONFIG_INVALID'`，80-§5.7），并给出稳定 subcause 表（§3.2）；v0.1“目标不引入错误类别、保持裸 `Error`”的表述作废。② 秘密件由 v0.1 的 `secret-guard`（自建子串扫描、要求 `find`/`redact` 双方法）**改名并收窄**为 `secret-boundary`：只做 `contract` 两个既有纯函数的薄适配，**不写文本、不复制正则**；v0.1 的“脱敏后重算层指纹”设计一并撤销（本包不改写正文，见 §3.7、§6.4）。③ **指纹口径**——`sha8` 与组合指纹只作展示/日志关联，**不是**内容身份（`TS-SCALAR-08`，`80:350`）；身份是 `semanticDigest`，本包**不生产**。④ 缺口表按 80/77 的真实 ID 重写为 G1–G18，删去 v0.1 关于“contract 秘密件未登记”（G1 旧义）等**已被 81-01 v0.2 / 80-§11.2.1 定案**的旧说法。⑤ 消费链重核：续跑版任务书**已接线**、任务书后**已追加读面节**、`fwkVersion:'v0.5-demo'` 是字面量、`budgetCapUsd` 未传。⑥ 锚点行号更正（v0.1 引 80-§6.8/§6.9 为 `80:1367`/`80:1385`，与现卷实际位置不符；v0.2 当时记为 `80:1913-1930`/`80:1932*`，**该组行号在 v0.3 复取时已再次漂移**，现为 `80:1957-1970`/`80:1976`，以 v0.3 记录为准）。
> 〔当前版本 v0.4〕2026-10-27（**只改文档，未改代码**）。v0.4 相对 v0.3 的修订四处：① **判据改为 `set.redactKnown(text) !== text`**——80-§11.2.1 已冻结 `KnownSecretSet` 的两个脱敏方法分工（接口 `80:3092-3099`、分工表 `80:3104-3108`），并把“内部供给 = 提示词、任务书（`TaskBrief` 正文）”逐点点名划给 `redactKnown`（调用边界表 `80:3155-3161`），故 v0.3 的“`redact` 改动即拒”作废；`redact`（已知值 + 形状兜底）**归出站面**，本包不持该能力、不调它。② **形状误伤不再阻断**：`redactKnown` 不做形状兜底，40/64 位 hex（commit sha、`payload_hash`）与 32+ 位 base62 不再让产出被拒；`find` 明标“只做诊断/测试断言”，`find(text).length > 0` **不得**成为拒绝条件（`80:3108`、`80:3164`）——v0.3 §3.7-4 的“形状兜底在判据内 / 上线阻塞”整段**删除**。③ **G1 关闭、M5 解阻**：v0.3 记的两问（prompt 出口是否属强制点、判据粒度是否只能覆盖已知值）都已由 80 的调用边界表答定；“无命中不等于绝对安全”与“`load` 成功 ≠ 有权调用”按 `80:3165`/`80:3168-3172` 归位到 §6.6。④ **锚点复取**：80-§11.2.1 现为 `80:3042`（v0.3 记 `80:2774`）、接口 `80:3092-3099`、分工表 `80:3104-3108`、判据句 `80:3110`、调用边界 `80:3155-3161`、`find` 非门禁 `80:3164`、无命中不等于安全 `80:3165`、provider/redactor 非事实源 `80:3168-3172`；U80-18 仍在 `80:3364`、D23 `80:3476`。另：80-§6.8 现为 `80:2175`（prompt 行 `80:2183`）、§6.9 现为 `80:2194`（`TaskBrief` 行 `80:2237`）——v0.2/v0.3 记的 `80:1957`/`80:1965`/`80:1976`/`80:1981` **已全部漂移**，本版按现卷重写。
> 〔历史版本 v0.3〕2026-10-27〔② 的判据口径已被 v0.4 按 80-§11.2.1 推翻，见上行〕。v0.3 相对 v0.2 的修订三处：① **入参收窄为能力对象**——`secret-boundary` 不再接受 `SecretBoundaryInput`（v0.2 的 `knownValues: readonly string[]` 是**明文派生**），改为**直接持有装配期构建的同一个 `KnownSecretSet`**，只调它的 `redact`/`find`；本包不派生明文数组、不读 `SecretMaterial[]`、不打开 provider/env/文件、不缓存清单（`SecretBoundaryInput` **删除**，不另立替代接口）。② **判据随之改为 `set.redact(text) !== text`**（80-§11.2.1 已冻结“有没有东西被改过”用这一句，`80:2842`）；代价是 `redact` = `redactOutbound`，**含形状兜底**（`LONG_TOKEN_RE` 命中 32+ 连续 `[A-Za-z0-9_-]`），因此 40/64 位 hex（commit sha、`payload_hash`）也会让判据成立、整份产出被拒——§3.7-4 由“形状只计数不阻断”改写为“形状在本包判据内”的**成本与阻塞**，并入 **G1** 待 80 裁决；`knownValueHit` 删除，`SecretBoundaryReport` 去掉不可观测的 `knownHits`、`knownValueCount` 改 `secretIdCount`。③ **陈旧引用更正**（逐条核对后只改实际存在的）：80-§6.8/§6.9/§11.2/§11.2.1/U80-18 的行号按现卷重取（`80:1957`/`80:1965`/`80:1976`/`80:1981`/`80:2759`/`80:2761`/`80:2774`/`80:3056`）；§4.7 旧用例 5（“已标记文本不算命中”）按 `redactKnownSecrets` 现行实现**纠错**——该函数无负前瞻，负前瞻只在 `ASSIGNMENT_RE` 上；`F-contract-*`/`F-DAEMON-ENGINE-PROMPT-ASSEMBLY`/`work-readiness`/17 附录三件的归属经核对**原本正确，不改**；`openLedgerReadonly` 不在本卷范围，无需改。
> 性质：**自然语言级逐文件设计呈审稿**。所有“目标/新增/拆分/替换/退役”都是设计处置，**尚未实施**；本文不是实现单、不是完成证明。
> 上位：75 的文件/依赖模板与工程决策（D75-13/14/15）；76 的公共语义；77 的记录与行为；78 的宿主/通道/秘密绑定；79 的工程与依赖；80 的包层、公共接口与安全边界（§2.1 包语义、§5.7 错误两轴、§11.2/§11.2.1 秘密面）。
> 范围：`packages/prompt` 的全部 `src`、`test`、`package.json`、`tsconfig.json`。不含 `node_modules`、生成物与本文档自身。
> 证据口径：2026-10-27 对范围内 14 个文件**逐文件全文读取**，并对唯一生产消费者（`apps/daemon/src/engine/prompt-assembly.ts`，经 `@studio-next/prompt` 单点导入）及其上游 `apps/daemon/src/assembly/serve.ts` 的装配器构造、下游 `apps/daemon/src/engine/engine.ts` 的落盘与记账做了核对；行号为本次读取口径。**未运行** `bun install`、`tsc`、`vitest`、任何 daemon/服务；未做真实进程或真机探针。测试存在与断言内容不等于测试已绿，更不等于真实能力。

---

## 一、盘点：现有件、目标件与计数

### 1.1 现有件全集（14 件 = src 6 + test 6 + config 2）

| F-ID | 路径 | 类别 | 行数 | 处置 |
|---|---|---|---|---|
| `F-prompt-index` | `packages/prompt/src/index.ts` | 生产（barrel） | 57 | 目标-保留 |
| `F-prompt-layers` | `packages/prompt/src/layers.ts` | 生产（层模型/构建/指纹） | 555 | 目标-保留（含条件拆分预案） |
| `F-prompt-assemble` | `packages/prompt/src/assemble.ts` | 生产（AGENTS.md 组装） | 91 | 目标-保留 |
| `F-prompt-brief` | `packages/prompt/src/brief.ts` | 生产（任务书两模板） | 148 | 目标-保留 |
| `F-prompt-sanitize` | `packages/prompt/src/sanitize.ts` | 生产（不可信输入隔离） | 68 | 目标-保留 |
| `F-prompt-trim` | `packages/prompt/src/trim.ts` | 生产（超长裁剪） | 196 | 目标-保留 |
| `F-prompt-test-helpers` | `packages/prompt/test/helpers.ts` | 测试基建 | 106 | 目标-保留（仅测试） |
| `F-prompt-test-layers` | `packages/prompt/test/layers.test.ts` | 测试 | 180 | 目标-保留（仅测试） |
| `F-prompt-test-assemble` | `packages/prompt/test/assemble.test.ts` | 测试 | 100 | 目标-保留（仅测试） |
| `F-prompt-test-brief` | `packages/prompt/test/brief.test.ts` | 测试 | 153 | 目标-保留（仅测试） |
| `F-prompt-test-sanitize` | `packages/prompt/test/sanitize.test.ts` | 测试 | 77 | 目标-保留（仅测试） |
| `F-prompt-test-trim` | `packages/prompt/test/trim.test.ts` | 测试 | 191 | 目标-保留（仅测试） |
| `F-prompt-package-json` | `packages/prompt/package.json` | 配置（manifest） | 20 | 目标-保留（依赖清理） |
| `F-prompt-tsconfig` | `packages/prompt/tsconfig.json` | 配置（类型门禁） | 5 | 目标-保留 |

计数可复算（本次实际执行 `wc -l`）：`src` 6 件——`assemble.ts` 91、`brief.ts` 148、`index.ts` 57、`layers.ts` 555、`sanitize.ts` 68、`trim.ts` 196；`test` 6 件——`assemble.test.ts` 100、`brief.test.ts` 153、`helpers.ts` 106、`layers.test.ts` 180、`sanitize.test.ts` 77、`trim.test.ts` 191；配置 2 件——`package.json` 20、`tsconfig.json` 5。

### 1.2 目标件全集（16 件 = src 7 + test 7 + config 2）

| 变化 | 件数 | 明细 |
|---|---|---|
| 目标-保留 | 14 | 上表全部 |
| 目标-新增 | 2 | `F-prompt-secret-boundary`（`src/secret-boundary.ts`）、`F-prompt-test-secret-boundary`（`test/secret-boundary.test.ts`） |
| 目标-拆分 | 0 | 本包**无** `lineBaseline` 超限件；`layers.ts` 555 行 < 600，未入 `scripts/guards/boundary-rules.mjs:159` 基线表。条件拆分预案见 §3.2 |
| 目标-替换 | 0 | — |
| 目标-退役 | 0 | 无文件退役；仅有 1 处“导出面退役”（`assemble.ts` 末尾对 `LAYER_ORDER` 的重复再导出，见 §3.3） |

目标计数：6+1=7 个 `src`，6+1=7 个 `test`，配置 2，共 **16**。目录预算：`src` 直下 7 件 ≤ 25；`test` 直下 7 件 ≤ 25（`maxFilesPerDirectory=25`，`boundary-rules.mjs:149`）。若触发 §3.2 条件拆分，新增 `src/layers/` 子目录 2 件，直下仍为 7 件（facade 占原文件位），仍然合规。

〔v0.2 更名记录〕v0.1 拟新增的 `secret-guard.ts` / `secret-guard.test.ts` **撤销，两个文件从未落盘**，本卷不保留该 F-ID（不留“已退役件”，因为从未存在）。撤销理由三条：① 它自建“已知值子串扫描 + 自定 `find`/`redact` 双方法闸”，与 80-§11.2-3“**整个 `secrets` 模块迁 `contract`**、`core` 不得留第二套实现或第二份正则”冲突；② 它要求 `assemble`/`brief` 在改写正文后**重算层指纹**，等于在包内造第二套“内容身份”，违 `TS-SCALAR-08`（`80:350`）；③ 80-§11.2.1 已把 `redact`/`find` 定义为 `KnownSecretSet` 的能力，包内不该再包一层同名方法。替代件 `secret-boundary` 只做**拒绝**、不写文本，见 §3.7。

### 1.3 现状的真实接线（〔事实〕，不扩张为能力）

- **唯一生产消费者**：`apps/daemon/src/engine/prompt-assembly.ts:39` 从包根导入 `assembleAgentsMd`、`buildLayers`、`renderTaskBrief` 及两个 result 类型（`AssembleResult`、`BriefRenderResult`）；本仓 `apps`/`packages` 的 `src` 中 `@studio-next/prompt` **只此一处**导入（全仓 grep 核实；`packages/prompt/src/index.ts:39` 的 `PACKAGE_NAME` 字面量不是 import）。装配器由 `assembly/serve.ts:1122-1129` 的 `makeAssembler()` 构造，落盘在 `engine/engine.ts:997`（native）与 `:1002`（`writeInstructions`，0600 临时指令文件）。
- **L0/L4 的取值来源是 demo 常量**：`serve.ts:1124` 传 `fwkVersion: 'v0.5-demo'`、`frameworkPrompts` 是硬编码中文串；`acceptance` 由 `const acceptance = config.acceptance !== undefined ? [config.acceptance] : ACCEPTANCE`（`serve.ts:1000`）决定，缺省走 demo 常量 `ACCEPTANCE`（`:867` 头注）；`docRefs` 是两条硬编码章节名（`:1128`）。因此 L0 的 `W-` 段与 L4 的验收/引用在**运行链上是常量**，不是版本权威、不是单据冻结值（G8/G14）。
- **未被生产链调用**：`trimLayers`、`isCommandShapedLine`、`sanitizeUntrusted`、`serializeCapabilities` 在包外**零调用**；`sanitizeUntrusted` 仅在 `layers.ts:257/273` 内部按 `untrusted` 标志触发，而 daemon 从不设该标志。`AssembleResult.sanitized` / `layerBytes` / `layerFingerprints` 也**无包外读取**。
- **装配器只填了层模型的一部分**（`prompt-assembly.ts:141-171`）：L1 `sections: []`（`:145`）；L3 只有 `position` 一节（`:154`）；L5 不传 `plugins`（`:161-170`）；`lessons: ctx.lessons ?? []`（`:163`）；`acceptance: ctx.acceptance`、`docRefs: ctx.docRefs` 是配置常量（`:159-160`）。因此 L1 使命/方向/战役、L3 六节、L5 插件摘要、L4 教训在**真实派发路径上均未出现**——这是“库级存在、未接运行链”，不是“已支持”。
- **续跑版任务书已接线**（v0.1 未记）：`prompt-assembly.ts:177-188` 按 `input.resume !== undefined` 切 `'resume'` 并传 `resume` 三元组；首版/续跑版都在真实链路上。任务书后**已追加**读面节 `renderReadViewSection(input.readView)`（`:192-195`，`engine/read-tiers.ts` 提供）——这段文本**不经过** `prompt` 包的任何断言。
- **`budgetCapUsd` 未传**（`:177-188` 无该字段）：运行链上 `TaskBrief.budgetCap` 从未出现，预算只是 engine 的 reserve/adopt 估计（`engine.ts:1102` 的 `budget=` 段），与 `brief.ts` 的预算行是两回事。
- **生产侧只用两个字段**：引擎读 `assembled.agentsMd.text`、`assembled.agentsMd.fingerprint` 与 `assembled.brief.text`，并自行另算 `size`（UTF-8 字节）与 `payload_hash`（**全量** sha256，非 sha8；`engine.ts:1099-1100`）；`fingerprint` 只进 `DISPATCH` 事件的 `note`（`fp=…`，`:1102`）。C2-10 的“检测事件”与 C2-11 的“各层字节清单落盘”在运行链上**没有落点**。
- **运行链上不存在任何秘密闸**（〔事实〕）：`assembleAgentsMd(layers)`（`prompt-assembly.ts:170`）与 `renderTaskBrief(briefKind, {...})`（`:178`）都不传秘密清单；`redactOutbound` 在本仓的生产调用只有 `assembly/hrsync/assemble.ts:59`（HR 同步文本），**不覆盖** AGENTS.md 与任务书。因此“秘密不入提示词”目前只有**类型结构**一层（层源与 `TaskBrief` 无凭据字段），**没有**运行期强制。另注：`engine.ts:1102` 的 `DISPATCH` note 里带 `wkey=env:…:nonce=${minted.nonce}`（nonce 原值），这是台账 note 面，不在本包的出站面内，但属 G17 的口径缺口。
- **任务书文本位有外部可写来源**：`objective: input.issue.title`（`:157`、`:182`）取自平台单据标题，`acceptance`/`docRefs` 在真单刀后来自单据字段；这两类都**不是**受信文，而当前按受信插入（G6）。
- **包根是唯一入口**：`package.json:7-10` 的 `main`/`exports["."]` 都指 `./src/index.ts`；`index.ts` 是纯 barrel，无副作用。工作区下 Node 按 realpath 解析，实体在 `node_modules` 之外，故 24 可剥离 TS（79-§1.2 的 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` 不触发）；这是**开发/工作区**事实，不构成对外分发能力。

---

## 二、上位锚点与“不新造”声明

| 本文使用的口径 | 唯一展开位置（本次核对的实际行号） | 本文只做什么 |
|---|---|---|
| prompt 的层位（L4）与目标语义“补‘秘密不入装配’的可证明边界” | 80-§2.1 表第 4 行（`80:123`） | 决定文件落点与边界，不重定义包语义 |
| `PromptAssembler` 保留为内部机制件 | 80-§6.8（`80:2175`，表内 prompt 行 `80:2183`） | 说明本包只提供纯函数。**注意**：80 该行写“`engine/prompt-assembly.ts`（类型在 `prompt`）”，与源码不符——`PromptAssembler` 接口定义在 `apps/daemon/src/engine/prompt-assembly.ts:88`，`prompt` 包不含该类型（G15，回写 80） |
| 秘密不得进入 prompt/任务书/历史/指纹 | 77-§3.4（`77:624`）、80-§11.2 第 2 条（`80:2759`）、75-D75-13（`75:186`） | 把“类型结构排除”加一层“运行期拒绝”；不改凭据通道、不改写正文 |
| 秘密的**来源**（catalog / provider / `secretId` / 轮换吊销 / known set 三态） | 78-§7.4（`78:939`）、78-§7.4.1（`78:953`，三态 `78:1000-1005`）、78-§7.4 第 4–8 条（`78:1015-1075`） | 只**消费** `KnownSecretSet` 的能力（判据用 `redactKnown`、诊断用 `find`）与只读字段 `state`/`secretIds`/`missingSecretIds`；**不取任何明文值**、不读 env/文件、不定义 `secretId`、不解释 `state` 的能力语义 |
| `KnownSecretSet` 的形态、`redactKnown`/`redact`/`find` 三分工、`find` 不作门禁、fail-closed | 80-§11.2（`80:2753`，第 2/3 条 `80:2759`/`80:2761`）、§11.2.1（`80:3042`；接口 `80:3092-3099`；分工表 `80:3104-3108`；判据句 `80:3110`；调用边界 `80:3155-3161`；`find` 非门禁 `80:3164`；无命中不等于安全 `80:3165`）、79-§3.6（`79:404`） | 决定本包的闸位与拒绝条件（**只用 `redactKnown`**）；**不复制**算法、不新增端口、不派生清单、不调 `redact` |
| 错误两轴与构造期非法 | 80-§5.7（`80:686`，`configInvalid` 固定 `rejected_precondition`+`CONFIG_INVALID`） | 复用 `contract` 既有 `configInvalid`；不新增 category |
| 短哈希不得作身份 | 80-§4.1 `TS-SCALAR-08`（`80:350`）；`Money` 受限 `TS-SCALAR-09`（`80:351`） | 只声明本包指纹是展示/关联；**不生产** `semanticDigest`、不换算 `Money` |
| 任务书不是合同、`TaskBrief` 只是派发材料 | 80-§6.9（`80:2194`，表内该行 `80:2237`） | 明确本包输出不证明授权/验收/结清 |
| AGENTS.md/persona 是软限制，不得作为授权证据 | 78-§2.4（`78:321`）、78-§2.5（`78:334`） | 明确本包不产生任何“已授权”证据 |
| 纯面零 IO（core/prompt/gateway/contract） | 79-§3.6（`79:404-412`） | 约束新增件同样零 fs/子进程/网络 |
| manifest 死依赖与休眠边 | 79-§10.1 第 8 项（`79:1350`）、第 11 项（`79:1353`） | 只写处置，不改 manifest |
| 不发布、`exports` 保持 src | 79-§6.5（`79:812`） | 明确不建 dist、不引 project references |
| L0–L5 分层语义、C2-06/08/09/10/11/12 验收口径 | `docs/01-需求-公司面.md` C2 节、`docs/17-§5`、`docs/04-§六` | **仅沿用**既有需求/设计口径；76–80 未给这些层单独的对象 ID，本文不替它们造 ID（G5） |
| `prompts/` 是上下文资产、AGENTS.md 是运行产物 | 70-§7.1（`70:833`） | 明确 L1 内容源不是权源 |

〔结论〕本文**不新增**公共概念、`TS-PORT-*`、`REC-*`、状态、错误类别、允许边或依赖版本。构造期非法**复用** `contract/src/schemas/errors.ts:54` 既有的 `configInvalid(subcause, detail?)`（它抛 `Error & ClassifiedError`，`category='CONFIG_INVALID'`；80-§5.7 的目标态再补 `failure='rejected_precondition'`），因此是“把已有通道接上”，不是“新造错误面”。L0–L5 的字段语义在 76–80 中没有独立对象，这是**已存在的归属缺口**（G5），不是本文可以就地补一套 schema 的理由。

〔结论·秘密面〕本文**不自造**秘密清单形状与脱敏算法：清单只有一种来路——daemon 装配期按 78-§7.4/80-§11.2.1 构建的 `KnownSecretSet`；判定只有一种语义——该集合的 `redactKnown`（=`redactKnownSecrets`，只把已知值换成 `<redacted:N>`：`MIN_KNOWN_LENGTH=6`、长值优先、去重，**不做形状兜底**），`find`（=`findSecretShaped`）**只作形状诊断**，`redact`（=`redactOutbound`，已知值 + 形状兜底）是**出站总闸**、不属本包判据面。本包只做一件事：**在装配出口对“`redactKnown` 会改动这份文本”即拒绝**；不做替换、不改写、不重算指纹、**不摊出明文值**。因此本文**不接受** `readonly string[]` 裸值清单、也**不接受**任何“从 `SecretMaterial[]` 派生明文数组”的中间形状（v0.2 的 `SecretBoundaryInput` 即属此类，v0.3 删除），更**不复制**任何正则/阈值/标记拼接。

### 2.1 本卷不承担的跨卷件（避免重复记账）

下列目标件在 80 已指定归属或已在同批附录登记，本文**不**为其写逐文件条目，只声明本包的依赖方向与前置关系：

| 目标件 | 归属 | 与 prompt 的关系 | 前置/顺序 |
|---|---|---|---|
| `contract/src/secrets.ts`（`redactOutbound`/`redactKnownSecrets`/`findSecretShaped`/`SecretShapeFinding`/三条正则/`REDACT_MARK`/`MIN_KNOWN_LENGTH`，自 `core` 整模块迁入） | 81-01 `F-contract-secrets`（79-§3.6、80-§11.2-3） | **不在本包 import 面**：它是 `KnownSecretSet` 实现的复用源（装配期，daemon 侧）；本包只经集合的 `redactKnown`/`find` 间接用它 | **必须先落**（作为集合实现的前置）；未落前本包不得新增 `prompt→core` 边、也不得在包内复制正则（§6.1） |
| `contract/src/ports/secret.ts`（`SecretKind`/`SecretUse`/`ValueProvider`/`SubjectScope`/`SecretCatalogEntry`/`SecretMaterial`/`SecretProvider`/`KnownSecretSet`） | 81-01 `F-contract-port-secret`（80-§11.2.1、78-BIND-WS-01） | `secret-boundary` **只取 `KnownSecretSet` 一个类型**（`import type`），且**只调它的 `redactKnown`（判据）与 `find`（诊断）** 与只读字段 `state`/`secretIds`/`missingSecretIds`；**不**接触 `SecretMaterial` 的任何字段，**不**调 `redact`（出站面能力，本包不持有） | 同上，必须同批或更早；集合的**实例**由 daemon 装配期构造 |
| `contract/src/ports/intent.ts`（`IntentSubmissionPort`/`IntentReceipt`/`IntentKey`/`IntentSubmitResult`） | 81-01 `F-contract-port-intent`（80-§6.6 `TS-PORT-API-01`、§12.3） | 无（意图通道不产生提示词文本；摘要 `note` 由 daemon 侧消费，见 G6） | 无排序要求 |
| `core/src/work-readiness.ts`（81-02 `F-core-work-readiness`）、`assembly/intent/{ingress,receipt-store}.ts`（81-17 `F-daemon-intent-ingress`/`F-daemon-intent-receipt-store`）、`assembly/api/assemble.ts`（81-17 `F-daemon-api-assemble`） | 81-02 / 81-17（80-§6.6、§12.3） | 无（不产层、不产任务书） | 无 |
| `apps/daemon/src/engine/prompt-assembly.ts`（`PromptAssembler`、`createDefaultAssembler`；本包唯一生产消费者） | 81-16 `F-DAEMON-ENGINE-PROMPT-ASSEMBLY` | 调用 `buildLayers`/`assembleAgentsMd`/`renderTaskBrief`；M4 起还要**把装配期已建好的 `KnownSecretSet` 原样传进** `opts`（daemon 提供值，本包只读） | M4 与本包同批（本包提供判定，daemon 提供集合） |
| `apps/daemon/src/engine/read-tiers.ts`（`renderReadViewSection`） | 81-16 | 其输出**追加在任务书之后**（`prompt-assembly.ts:192-195`），不经本包任何断言或秘密判定 | M4 的 `scanned` 判定只覆盖本包产出，**不含**这段 —— 属 G18 的连带面 |

〔说明〕上表存在的目的只有一个：让“prompt 输出必须过秘密闸”这条**在 80 已有落点**的要求，不因为本卷缺乏类型而退化成“本文自造一套”。反过来说，本卷 §3.7 的实现**没有**这些前置就无法开工，属**顺序阻塞**（§八 M2）。

---

## 三、生产件逐文件

### 3.1 `F-prompt-index`

- **路径/处置**：`packages/prompt/src/index.ts`；目标-保留；57 行；目标预算 ≤ 80 行。
- **上位**：80-§2.1 第 4 行（包语义）；不承载任何记录/绑定。
- **职责**：包根 barrel——导出包名/状态常量，并以 `export *` 汇出 `sanitize`、`layers`、`assemble`、`trim`、`brief` 五个模块的公共符号；本身不做组装。
- **非职责**：不组装、不裁剪、不读盘、不探测通道、不判定“能力已具备”、不设错误包装（不把子模块抛的 `configInvalid` 转成返回值）。`PACKAGE_STATUS = 'partial'`（`:42`）只是包状态字面量，**不是**运行时能力证明；文件头 TODO 的 `[x]` 只表示“代码存在并有单测”，不表示已接线（`trim`/`sanitize` 即反例）。
- **内部结构**：2 个常量（`PACKAGE_NAME`、`PACKAGE_STATUS`）+ 5 条 `export *`。无类型、无函数、无状态。
- **导出与依赖**：自身无独立 import 语句；5 条 `export *` 在运行时会加载对应五个模块，故 barrel 的加载面=这五个模块，不额外引入包外依赖。目标仍不得从 `index.ts` 引 daemon、fs、env。**目标明确不导出 `secret-boundary`**：它是包内硬化面（§3.7），调用方经 `assembleAgentsMd`/`renderTaskBrief` 的 `opts` 传 `KnownSecretSet` 实例接入，不经 barrel；若将来要对外，须先由 80 定义公共形状，不自升。
- **IO 与注入**：N/A——barrel 无 IO、无时间/ID/随机。
- **状态/并发**：模块级常量不可变；并发导入无副作用。
- **错误与观测**：无错误路径；无日志、无捕获、无改写——下游模块抛的 `configInvalid` 原样穿透到调用方（daemon 按 80-§5.7 分类）。唯一可观测面是导入图的解析结果。
- **测试与证据**：无直接测试；由 `F-prompt-test-layers` 等经 `../src/*.ts` 直接导入，不经过 barrel；真正的 barrel 解析由 daemon 的 `@studio-next/prompt` 导入间接覆盖（未运行）。**不证明**包可对外分发，也不证明导出面没有多余绑定（无“导出面快照”测试，见 G11 同类门禁缺口）。
- **规模与迁移**：新增公共函数必须先进具体模块再由本文件汇出，不得把实现写进 barrel。目标导出面**净变化 = −1**：删除 `assemble.ts` 末尾重复再导出 `LAYER_ORDER` 造成的一处多余绑定（同一来源，语义无歧义，但扩大导出面；以 grep 确认包外无 `from './assemble.ts'` 取它的消费者），并**不新增**任何 `export *`（§3.3）。行数不变。

### 3.2 `F-prompt-layers`

- **路径/处置**：`packages/prompt/src/layers.ts`；目标-保留；555 行，硬上限 600（`maxLinesPerFile`），**余量仅 45 行**。
- **上位**：`docs/17-§5` 装配管线、`docs/01` C2-06/C2-08/C2-11/C2-12（需求口径）；80-§2.1（包语义）。文件头自注“LayerSource / PromptLayer / TrimmableRegion / LayerId 拟升 contract”——**该升格未决**，本文按“留在 prompt 内部”设计，升格须 80 与提案流，不在本附录决定。
- **职责**：定义六层标识与冻结顺序；生成层/裁剪区定界标记；计算内容 sha8 与六段分层指纹；定义六种内容源与层记录；把“单源”构建成“单层”，把“六源”构建成“六层”并做齐序断言。它是本包唯一的“层语义”持有者。
- **非职责**：不解析公司目录文件、不选择 AGENTS.md 通道、不裁剪、不消毒秘密、不写盘、不记账、不决定谁有权派工。`protected` 是**声明性**标记，本文件不执行保护，执行面在 `trim.ts` 的“只动显式 trim 区”。

**L0–L5 逐层契约（按现实现逐行核对；不新增对象 ID）**

| 层 | 内容源与身份（现实现） | 信任级（现） | 可空性（现） | 冻结 / 可裁 | 指纹段 | fail-closed（现） |
|---|---|---|---|---|---|---|
| L0 | `L0FrameworkSource{fwkVersion, frameworkPrompts}`；`source='config-home/prompts@fwk-<ver>'`；identity=框架版本 | 受信（无 `untrusted` 开关，整段原样） | 正文为空**无断言**，只产出标题行 | `protected=true`，无 trim 区，整层永不裁 | `W-<fwkVersion>`（**不含内容 sha8**） | 走私层/trim 标记 ⇒ 拒收 |
| L1 | `L1CompanySource{snapshot, sections[]}`；四节固定序 mission→direction→campaign→identity；`source='<slug>/prompts/company.md + org-config'`；identity=`''` | **逐节** `untrusted?`（可标） | 四节**全可缺**；缺则整节不出现，无占位 | `protected=false`；仅 `campaign` 为可裁区 | `co.<sha8(content)>` | 节重复、走私标记 ⇒ 拒收 |
| L2 | `L2OrgSource{deptConfig, signature?}`；部门正文 + 固定署名说明 + 可选本单署名 | 受信（整段原样，无 `untrusted`） | `signature` 可缺 | `protected=true`（署名层），无 trim 区，永不裁 | `org.<sha8>`（**不含 identity**） | 走私标记（`deptConfig`/`signature`）⇒ 拒收 |
| L3 | `L3PersonSource{person, sections[]}`；六节固定序 position→duties→work_history→skills→profile→self_narrative；identity=工号 | **逐节** `untrusted?` | 六节**全可缺** | `protected=false`；仅 `work_history` 可裁；`profile` 数字在区外结构性保留 | `p.<工号>.<sha8>` | 节重复、走私标记 ⇒ 拒收 |
| L4 | `L4TaskSource{ticket, attempt, objective, acceptance[], docRefs[], lessons[], scope?}`；identity=`<单号>.<尝试>` | 受信：`objective`/`acceptance`/`docRefs` 原样；`lessons` 渲染时**不传 `untrusted`**，故恒受信 | `acceptance`/`docRefs` **必须非空**；`lessons`/`scope` 可空 | `protected=true`；仅 `lessons` 可裁（C2-09 的显式例外）；验收 fenced `bash` 块永不裁 | `t.<单号>.<尝试>`（**不含内容 rev**） | 验收空、引用空、走私标记 ⇒ 拒收 |
| L5 | `L5ToolSource{adapter, version, capabilities, plugins?}`；能力 JSON 固定五键序（`budget_cap,cancel_turn,session_resume,agents_md,cost_native`）；identity=`<adapter>@<ver>` | 受信（能力 JSON 由本文件序列化，`plugins` 原样） | `plugins` 可缺 | `protected=false`，无 trim 区，永不裁 | `ex.<adapter>@<ver>` | 走私标记（能力 JSON/`plugins`）⇒ 拒收 |

读法（每条都是事实约束，不是建议）：

- **顺序与完整性**：`buildLayers` 要求源数=6、层数=6、逐位等于 `LAYER_ORDER`；`assembleAgentsMd` 再守一次（`combinedFingerprint` 自身不判序）。六层**不可缺省、不可重排、不可重复**。
- **信任级只有一档**：`untrusted?: boolean` 是二态（受信 / 不可信），**没有**分级信任模型；不得对外称“分级信任”。标 `untrusted` 的段走 `sanitizeUntrusted`，未标的段**原样**进入——默认是受信，这本身是风险面（G6/G7）。
- **“受信”只表示“未消毒”，不表示“内容可信”**（v0.2 明确）：上表的“受信”是**机制**描述（该段不过 `sanitizeUntrusted`）。L4 的 `objective` 运行链取自平台单据标题（§1.3），L4 的 `acceptance` 真单刀后取自单据字段——它们都是外部可写文本，却落在“受信”档。这不是本文件能改的口径（G6），但任何“L4 是受信数据”的推论都不成立。
- **“可空”与“内容缺失”不可区分**（L1/L3）：`sections: []` 既可能是“公司真没写”，也可能是“解析器没产出”（现无解析器，G3/G4）。本文件不记录空因，故空层**不能**作为“已装配”的证据。
- **`protected` 是声明不是执行**：本文件只置标志、不阻止改写；执行面在 `trim.ts`（只动显式 trim 区，且**不读** `protected`）与目标 `secret-boundary`（§3.7：它在出口对**整份文本**判已知值，命中即拒；它不读 `protected`，也不区分“保护段/可脱敏段”）。因此 `protected=true` 不产生任何机制保证。
- **指纹不是身份**（v0.2 明确）：`sha8` 是 8 位截断、无密钥、非签名；`combinedFingerprint` 是 6 段字符串的 `/` 拼接。按 `TS-SCALAR-08`（`80:350`），二者**只作展示与日志关联**：不得当作内容身份、去重键、缓存键或比对依据，也不得用“指纹相同”论证“内容未变”。内容身份是 `contract` 的 `semanticDigest`（必带 `canonicalizationId`），**本包不生产**（G14）。
- **每层不能证明什么**：L0 不证明框架正文完整/可信（`W` 段取版本号，改内容不改版本则指纹不变；运行链该版本是 `serve.ts:1124` 的字面量 `'v0.5-demo'`）；L1/L3 不证明内容来自真实公司目录（运行链 L1 恒空、L3 仅 `position`，§1.3）；L2 不证明署名真伪（`signature` 由调用方给，真实性归网关）；L4 不证明验收已“冻结”——记录落点**有**（`REC-WORK-03.acceptance_criteria`，`77:883`），但当前取 `serve.ts:1000` 的配置/常量值，属**接线缺口** G8，不是“无记录类型”；L4 也不证明教训信任级（G7）；L5 不证明能力声明为真（adapter 自报，本包不探测）。**任何一层都不证明模型会遵守。**

- **内部结构**（全部导出，除两个私有断言）：
  - `LayerId = 'L0'|'L1'|'L2'|'L3'|'L4'|'L5'`（`:36`）；`LAYER_ORDER` 冻结序（`:39`）；`layerMarkerBegin/End` 产出 `<!-- LAYER:Lx:BEGIN -->` / `END`（`:41-47`）。
  - `TrimmableKind = 'work_history'|'lessons'|'campaign'`（`:59`）；`trimMarkerBegin/End` 产出 `<!-- studio:trim:<kind>:begin|end -->`（`:61-67`）；`TrimmableRegion{kind, lines}`（`:70-74`）。
  - `sha8(content): string`——sha256 十六进制前 8 位（`:81-83`）；`layerFingerprint(id, identity, content)`（`:91-106`）：L0 `W-<identity>`、L1 `co.<sha8>`、L2 `org.<sha8>`、L3 `p.<identity>.<sha8>`、L4 `t.<identity>`、L5 `ex.<identity>`；`combinedFingerprint(layers)` 按数组顺序 `/` 拼接（`:109-111`，**内部不再断言顺序**，顺序由 `assemble` 先守）。
  - 六个源：`L0FrameworkSource{fwkVersion, frameworkPrompts}`、`L1CompanySource{snapshot, sections}`、`L2OrgSource{deptConfig, signature?}`、`L3PersonSource{person, sections}`、`L4TaskSource{ticket, attempt, objective, acceptance[], docRefs[], lessons[], scope?}`、`L5ToolSource{adapter, version, capabilities, plugins?}`；联合 `LayerSource` 以 `kind` 判别（`:118-211`）。
  - 节模型：`CompanyPromptSection{kind∈mission|direction|campaign|identity, lines[], untrusted?}`；`PersonFactSection{kind∈position|duties|work_history|skills|profile|self_narrative, lines[], untrusted?}`。
  - `PromptLayer{id, content, source, identity, fingerprint, protected, sanitized, trimmables}`（`:217-233`）。
  - 私有：`ANY_LAYER_MARKER`/`ANY_TRIM_MARKER` 两个无 `/g` 正则（`:50-53`，故 `.test` 无跨调用 `lastIndex` 状态）；`assertNoSmuggledMarkers`（`:240-247`）；`renderSection`（`:250-261`，受信原样、不可信走消毒并返回计数）；`renderTrimmableSection`（`:264-284`，先消毒再包 trim 区，区行数=非空行）。
  - 六个 builder（`:286-511`）：L0 拼标题+框架正文、`source='config-home/prompts@fwk-<ver>'`；L1 按 mission→direction→campaign→identity 固定序过滤，重复即拒，仅 campaign 进 trim 区；L2 拼部门正文+固定署名说明+可选本单署名，`protected=true`；L3 按六节固定序，仅 work_history 进 trim 区；L4 强制 acceptance/docRefs 非空，验收命令进 fenced `bash` 块，仅 lessons 进 trim 区，`protected=true`；L5 `serializeCapabilities` 固定五键序（`budget_cap,cancel_turn,session_resume,agents_md,cost_native`）。
  - `buildLayer(src)` 以 `kind` switch 分派（`:514-529`，**无 default**）；`assertLayerSequence(layers)` 断言长度=6 且逐位相等（`:532-545`）；`buildLayers(sources)` 断言源数=6 → map → 再断言层序（`:548-555`）。
- **导出与依赖**：导出上述全部符号；import 仅 `node:crypto`（纯计算）与 `@studio-next/contract` 的**类型**（`AttemptNo`、`CompanySnapshot`、`PersonRef`、`TicketId`、`ExecutorCapabilities`）以及内部 `./sanitize.ts`。允许边只有 `prompt→contract`（以及冻结但零 import 的 `prompt→company`）。**禁止** fs、`node:child_process`、env、网络。
- **IO 与注入**：零盘 IO、零网络、零子进程、零 env、零时间/随机。所有身份（框架版本、工号、单号、尝试号、adapter@ver）与全部内容均由参数注入；sha8 只依赖内容字节（UTF-8）。
- **状态/事务/幂等/并发**：纯函数；每次调用独立；同输入同输出（模块级正则无 `/g`、无缓存）。无事务、无重试、无取消。`buildLayers` 对同一 `sources` 双跑逐字节相等（由 `F-prompt-test-layers` 的同源双跑与 `F-prompt-test-assemble` 的双跑覆盖，未运行）。
- **错误与观测**（现有 14 个 `throw` 中的 9 个在此文件）：走私层标记、走私 trim 标记、L1 节重复、L3 节重复、L4 验收为空、L4 文档引用为空、层数≠6、层序不符。现状全部是**裸 `Error`**：`catch` 方只能读 `message`，拿不到类别——这是**现状事实**，不是目标态。
  - **目标（v0.2 定）**：全部改走 `contract` 的 `configInvalid(subcause, detail?)`（`packages/contract/src/schemas/errors.ts:54`，抛 `Error & ClassifiedError`，`category='CONFIG_INVALID'`；80-§5.7 目标态再补 `failure='rejected_precondition'`）。本包**不设** `Result`/`Err` 通道：它是纯函数，构造期非法即抛；调用方（daemon）按 80-§5.7 分类，`Err` 侧可达类别集合不受本包影响。
  - subcause 是稳定字面量（不含变量、正文片段、层号之外的业务信息）。**下表是本包的包级唯一一份**（`layers`/`assemble`/`brief`/`trim` 四处共用，不各维护一份）；新增一行必须同时改本表与对应测试：

    | subcause | 所在文件 | 触发条件 | `detail` 可携带 |
    |---|---|---|---|
    | `prompt-layer-marker-smuggled` | `layers.ts`、`assemble.ts` | 输入正文含层定界标记（layers 构建期 / assemble 渲染期各一处） | `where` 定位串（常量、节名或层 id） |
    | `prompt-trim-marker-smuggled` | `layers.ts` | 输入正文含 trim 标记 | `where` |
    | `prompt-section-duplicate` | `layers.ts` | L1/L3 同一节出现两次 | 层 id + 节 kind |
    | `prompt-acceptance-empty` | `layers.ts`、`brief.ts` | L4 `acceptance` 为空（层构建 / 任务书渲染各一处） | 层 id 或 `'brief'` |
    | `prompt-docrefs-empty` | `layers.ts`、`brief.ts` | 同上，`docRefs` 为空 | 层 id 或 `'brief'` |
    | `prompt-layer-count` | `layers.ts` | 层数≠6（`assertLayerSequence`）或源数≠6（`buildLayers`，同因两处） | 实际数、期望 6 |
    | `prompt-layer-order` | `layers.ts` | 逐位不等于 `LAYER_ORDER` | 位次、实际/期望 id |
    | `prompt-layer-kind-unknown` | `layers.ts` | 运行期 `kind` 不在六个判别值内（目标加 `default`，见“语义债 3”） | 非法值（字面量） |
    | `prompt-trim-marker-shape` | `trim.ts` | trim 区标记不是恰好一对、或 begin 在 end 之后（§3.6 目标不变量） | 层 id + 可裁 kind |
    | `prompt-brief-attempt-invalid` | `brief.ts` | `attempt < 1` | 实际值 |
    | `prompt-brief-resume-missing` | `brief.ts` | `kind='resume'` 但 `ctx.resume` 缺失 | `'brief'` |
    | `prompt-known-secret` | `assemble.ts`、`brief.ts` | `set.redactKnown` 会改动该文本（**只**换已知值，不做形状兜底，§3.7-1 判定）；含两处出口自检 | 层 id、字段名、`'assemble-selfcheck'`、`'brief-selfcheck'` |

  - `detail` **不得**含：层正文、章节正文、用户输入、秘密值，以及任何片段/前缀/偏移/哈希。定位串只回答“哪一层、哪一节、第几位”。
  - 无日志、无事件、无计数器：本包不写观测面，事件归 daemon（G10）。
- **秘密面**：本文件不做任何秘密检测，也不把 `TaskBrief.credentials` 纳入任何源类型——该字段由 daemon 在 launch 前另行附加，结构上不经过本文件（§6.4）。
- **测试与证据**：`F-prompt-test-layers`（15 个 `it`）覆盖六层齐序、走私标记拒收、空验收/空引用拒收、节重复/乱序确定性、六段指纹格式、改一层只动一段、双跑同 bytes、L5 固定键序、protected/trim 区声明。**不证明**真实公司目录内容能被正确解析（本文件根本没有解析器）、不证明真实 executor 的 prompt cache 行为、不证明指纹能防篡改（sha8 无密钥、非签名）。
- **已知语义债（保留，不在本文件私改）**：
  1. L4 指纹段 `t.<单号>.<att>` **不含内容 rev**：L4 内容变化而单号/尝试不变时指纹不变；`trim` 裁 lessons 后 t 段也不变。`layers.test.ts:138-144` 已把该行为钉住并注明“疑点已记录”。这是 C2-08 字面口径，改格式需批示，不得在代码里擅自加 rev。**v0.2 补充**：正因如此，`t` 段更不能当 L4 的内容身份（`TS-SCALAR-08`）；要内容身份须由 `contract` 的 `semanticDigest` 承担（G14）。
  2. L0 的 W 段取框架版本号而非 L0 内容 sha8；文件头已注明“拟稿待批”。运行链上该版本是 `'v0.5-demo'` 字面量（`serve.ts:1124`），故“改内容不改版本则指纹不变”在今天是**必然**而非假设。
  3. `buildLayer`/`layerFingerprint` 的 switch 依赖 TS 穷尽性；Node 剥类型执行时 JS 调用方可传未知 `kind`/`id`，当前会**静默返回 `undefined`**（随后在下游报一个无关的 TypeError）。**目标**：两处加运行期 `default`，抛 `configInvalid('prompt-layer-kind-unknown', <非法值>)`，不动类型与正常路径；测试 4.2 同步补负例。
  4. `assemble.ts:55` 复制了一份层标记正则；**目标**：由本文件导出唯一判定函数 `containsLayerMarker(text): boolean`（复用 `ANY_LAYER_MARKER`），`assemble.ts` 改用它，消除双份正则漂移。**不得**反过来让本文件引 `assemble.ts`（会成环）。
- **规模与迁移**：555/600。目标新增只有两处：导出 `containsLayerMarker`（约 4 行，复用现有 `ANY_LAYER_MARKER`）与两处 `default` 分支（各约 2 行）——落地后约 563 行，**余量降到 37**。**硬规则**：任何新增语义不得落进本文件；新增超过 45 行即触发下列**条件拆分**（不是当前目标处置）：
  - `src/layers/model.ts`：`LayerId`、`LAYER_ORDER`、标记常量与函数、`sha8`、`layerFingerprint`、`combinedFingerprint`、`serializeCapabilities`、六个源接口与 `PromptLayer`（约 200 行）。
  - `src/layers/build.ts`：`assertNoSmuggledMarkers`、`renderSection`、`renderTrimmableSection`、六个 builder、`buildLayer`、`assertLayerSequence`、`buildLayers`（约 360 行）。
  - `src/layers.ts` 保留为**纯再导出 facade**，导出符号集合不变；`assemble.ts`/`trim.ts`/测试的 import 路径先在兼容期保留 facade，再按需直引子文件；顺序=先抽 model → 再抽 build → 再改内部 import → 最后评估是否把 facade 退役。目录：`src` 直下仍 7 件，`src/layers/` 2 件。

### 3.3 `F-prompt-assemble`

- **路径/处置**：`packages/prompt/src/assemble.ts`；目标-保留；91 行；预算 ≤ 130（目标态 ≤ 140）。
- **上位**：`docs/17-§5`、`docs/04-§六`；80-§2.1（`80:123`“补秘密不入装配的可证明边界”）；80-§11.2/§11.2.1；78-§2.5（AGENTS.md 是上下文通道，不是控制）。
- **职责**：把**已构建好的六层**渲染成一份 AGENTS.md 文本：首行“生成物勿手改”横幅、次行分层指纹注释、随后按 L0→L5 逐层用成对定界标记包裹；汇总各层指纹、各层字符/字节清单、不可信隔离剥离计数；**并对最终文本执行一次只读的秘密边界检查**（§3.7），命中已知值即拒绝产出。输出是**纯文本与清单**，落盘归 daemon。
- **非职责**：不写文件、不选落点/通道、不覆盖/备份既有 AGENTS.md、不裁剪、不判授权、**不实现**秘密算法也不改写文本（70-§7.1 意义上的“生成物”本文件只负责拼装）。`AGENTS_MD_BANNER` 只是标记，**不构成**任何防篡改保证。
- **内部结构**：`AGENTS_MD_BANNER`（`:25-26`）；`LayerByteEntry{id, chars, bytes}`（`:29-35`，chars=UTF-16 code units，bytes=UTF-8）；`AssembleResult{text, fingerprint, layerFingerprints, sanitized, layerBytes}`（`:38-49`）；模块级 `utf8Encoder = new TextEncoder()`（`:51`，无状态）；私有 `assertContentFreeOfLayerMarkers`（`:54-60`）；`assembleAgentsMd(layers): AssembleResult`（`:63-88`）；末尾 `export { LAYER_ORDER }`（`:91`，冗余再导出，目标删除）。
- **导出与依赖**：导出上列符号；import `LAYER_ORDER`、`assertLayerSequence`、`combinedFingerprint`、`layerMarkerBegin/End`、`containsLayerMarker`（目标从 layers 取）与两个类型，全部来自 `./layers.ts`；另 import `configInvalid`（**运行期**，来自 `@studio-next/contract`——这是既有 `prompt→contract` 边的运行期化，**不新增边**）、`import type { KnownSecretSet }`（**仅类型**，擦除后无运行期依赖）与 `./secret-boundary.ts`。**不** import `redactOutbound`/`redactKnownSecrets`/`findSecretShaped`——算法经集合能力（`set.redactKnown`/`set.find`）间接使用，本包 import 面上不出现第二处算法入口。不得引 `core`/`gateway`/`node:fs`/env。
- **IO 与注入**：零 IO；`TextEncoder` 为确定性全局；无时间/ID/随机。秘密边界入参由调用方注入——注入的是**装配期已建好的 `KnownSecretSet` 对象本身**，本文件不读 env/文件、不持有清单、不派生明文数组、不缓存跨调用引用。
- **状态/并发**：纯函数；`layerFingerprints` 每次新建普通对象；`layerBytes` 每次新建数组。同一层数组双跑输出逐字节相等。
- **文本形状（确定性的具体口径）**：`[横幅, '<!-- 分层指纹: <fp> -->', '', ...blocks.map(b => b + '\n')].join('\n')`；每块=`BEGIN\n<content>\nEND`。因此总字节 = 六层正文 + 标记/横幅/空行开销；**`AssembleResult` 不回报该开销**，`trim.ts` 的预算也不含它（§3.6）。
- **错误与观测**：现状 1 个 `throw`——某层正文含层定界标记（`:56`），消息含层 id、不含正文；层数/层序错误由 `assertLayerSequence` 抛出。目标全部改走 `configInvalid`：本文件的两处用 `prompt-layer-marker-smuggled`（`detail`=层 id），秘密命中用 `prompt-known-secret`（`detail`=层 id 或 `'assemble-selfcheck'`），见 §3.2 包级 subcause 表。无日志、无事件；`sanitized` 只是计数，daemon 未消费（§1.3），故“记事件”在当前链路上**未发生**（G10）。
- **测试与证据**：`F-prompt-test-assemble`（9 个 `it`）：横幅与指纹行位置、六层标记成对且有序、层数不齐拒组装、正文走私拒组装、L1+L3 共 3 行剥离的汇总、无不可信段时 `sanitized=0`、chars/bytes 口径（中文 bytes>chars）、双跑相等、`fingerprint` 与逐层映射一致。**不证明**落盘、不证明 compact 后重注入、不证明模型会遵守内容。
- **目标变更（v0.2 定稿、v0.3 收窄判据入参、v0.4 判据改 `redactKnown`；撤销 v0.1 的“改写 + 重算指纹”设计）**：
  1. 层标记判定改调 `layers.ts` 导出的唯一判定函数 `containsLayerMarker`（去重正则，§3.2 债 4）。
  2. 签名改为 `assembleAgentsMd(layers, opts?)`，`opts.secretBoundary` 的类型**就是** `contract` 的 `KnownSecretSet`（80-§11.2.1），本包**不另立包装接口**：

     ```ts
     import type { KnownSecretSet } from '@studio-next/contract'   // 仅类型；擦除后无运行期依赖

     // 不新增接口：opts.secretBoundary 的类型就是 KnownSecretSet（80-§11.2.1）
     //   readonly secretIds / state / missingSecretIds      只读字段，仅回传
     //   redactKnown(text): string                          只换已知值、不做形状兜底（判据用）
     //   find(text): readonly SecretShapeFinding[]          只报形状（只诊断，不作门禁）
     //   redact(text): string                               出站总闸（本包不调、不持有）
     ```

     由 daemon 装配期（`buildServeRuntime` 第 6 步前后，80-§11.2.1 / 17-§1.6）构建**一个**集合实例，`assemble` 与 `brief` **共用同一引用**。本包**不**从 `SecretMaterial[]` 派生任何数组、**不**把 `knownValues` 摊成 `readonly string[]`（v0.2 的 `SecretBoundaryInput` 已删除，见文首 v0.3 记录）。结果新增 `secretBoundary: SecretBoundaryReport`（字段定义见 §3.7）：**只回报计数与状态，不含值、片段、偏移、前缀、哈希**。
  3. 判定规则（三段，全部**只读**；**一律经 `./secret-boundary.ts`，本文件不直接调 `contract` 的脱敏函数、也不直接触碰集合方法**）：
     - **命中**：对每层 `content` 调 `assertNoKnownSecret(content, <层 id>, set)`，判据是 `set.redactKnown(content) !== content`（80-§11.2.1 分工表把“内部供给 = 提示词”划给 `redactKnown`，`80:3155-3161`；判据句 `80:3110`）；命中即抛 `configInvalid('prompt-known-secret', <层 id>)`。不替换、不改写入参、不重算 `fingerprint`——因此 `text` 恒等于六层内容 + 包装，`fingerprint` 与 `layerFingerprints` 描述的就是 worker 真正看到的文本，不存在“脱敏后指纹漂移”问题。拼好的 `text` 再整体跑一次同一判定（`where='assemble-selfcheck'`），命中同样拒绝。
     - **形状计数（仅观测）**：对每层与最终文本调 `secretShapeCounts(text, set)`（内部即 `set.find`），按 kind 累加、丢弃 `at`。它**不参与**阻断判定——阻断已完全由上一段的 `set.redactKnown` 决定；`shapeHits` 只进 `SecretBoundaryReport` 供 daemon 观测，`find(text).length > 0` **不是**拒绝条件（`80:3108`、`80:3164`）。
     - **`state` 不解释**：`known-set-partial`/`known-set-empty` 是否允许装配是装配根（daemon）的职责（80-§11.2.1-3）；本文件只把它**原样回传**，不在包内做“state≠complete 就拒”的二次裁决——那会与 80 的“拒启动/不装配该能力”分层冲突。
  4. **本包不提供 `redact` 档**：提示词里没有“可以静默改写的区”——`acceptance`/`docRefs` 改了就成篡改验收，其余层改了就是伪造上下文。因此全篇一律“命中即拒”，v0.1 的“保护区/可脱敏段切分”**不需要也不实现**（切分逻辑本身会引入第二套标记解析，与 §3.6 的已知边界 3 同类风险）。这与 80 的分工一致：`redactKnown` 只换已知值、不写形状标记，`redact` 是出站总闸、本包不调用（`80:3104-3108`）。
  5. **过渡形态（明确且可验收）**：迁移期 `opts.secretBoundary` **可选**，缺省时结果 `scanned: false`，且**不阻断**；此时 `engine.ts:997`/`:1002` **不得落盘**（`scanned=false` 的产物出站等于没有边界）。这是唯一允许的中间态，且有负向用例钉住（§4.3）；**M5 翻必填并删除可选分支**。之所以允许它而不是 v0.1 的“必传 + `assertGateUsable`”：`KnownSecretSet` 与构建侧在 daemon 尚未落地（80-§11.2.1 自述未实现、`80:3364` U80-18），强行必传会让整条派发链在同批内无法编译，等于把“验证可分步”变成“不可交付”。
  6. 删除末尾 `export { LAYER_ORDER }`（导出面退役；包根仍从 `layers.ts` 导出同一绑定，调用方零影响；以 grep 确认无 `from './assemble.ts'` 取它的消费者，本次已核：包外零引用）。
- **规模与迁移**：91 行；目标 ≤140（新增约 30–40 行：集合入参 + 逐层只读判定 + 结果字段 + 自检）。迁移顺序见 §八 M3→M4→M5；**不得**在 M4 之前让 `scanned:false` 的产物落盘，**不得**在 M5 之后仍保留可选分支；M5 不再有外部裁决前置（G1 已由 80-§11.2.1 调用边界表关闭）。

### 3.4 `F-prompt-brief`

- **路径/处置**：`packages/prompt/src/brief.ts`；目标-保留；148 行；预算 ≤ 200。
- **上位**：`docs/17-§5`（首次版/续跑版）、`docs/17-§3`/B4（summary.json sidecar）、75-D75-14（版本引用钉身份）；80-§6.9（`TaskBrief` 不是合同）；78-§2.5（通道说明只是说明）。
- **职责**：把派发上下文渲染成任务书 markdown，并**同时**产出与 `contract` 的 `TaskBrief` 形状对齐的对象（executor 输入）；续跑版把上次 `summary.json` 的结论/改动文件/打回理由与本轮续跑缘由注入“前情摘要”节。
- **非职责**：不读 `summary.json`（内容由调用方解析后注入）、不写 `briefPath`、不选择通道、不把前情摘要截到 300 字（文件头已标注该上限未实现）、不附凭据、不判预算（`budgetCapUsd` 只是正文与 `TaskBrief.budgetCap` 的声明，是否执行由 engine 的预算闸决定）。
- **内部结构**：`BriefKind='first'|'resume'`（`:22`）；`BriefContext{ticket, attempt, workspace, briefPath, agentsChannel, acceptance[], docRefs[], objective, budgetCapUsd?, resume?{sessionId, summaryPath, summary: SummarySidecar, note?}}`（`:25-51`）；`BriefRenderResult{kind, text, taskBrief}`（`:54-60`）；私有 `channelNote(c)` 三分支文案（`:63-72`）；`renderTaskBrief(kind, ctx)`（`:75-148`）。
- **渲染顺序（固定）**：标题（单号/尝试/首次|续跑）→ 目标 → （仅续跑）前情摘要：上次会话与摘要文件、结论、改动文件（空则显式“无改动文件——纯分析/评审单”）、可选打回理由、可选本次续跑缘由 → 验收口径 fenced `bash` → 文档章节引用列表 → 持久指令通道说明 → 工位（workspace/briefPath）→ 可选预算上限。结尾补一个换行。
- **`TaskBrief` 构造**：显式逐字段 `ticket/attempt/briefPath/workspace/AGENTS_MD`；`budgetCap` 仅在 `budgetCapUsd !== undefined` 时带；`resume` 仅在续跑且 `resume` 在场时带 `{sessionId, summaryPath}`。**从不**带 `credentials`——这是“凭据不进提示词/任务书”的结构性一环（`contract/src/ports/kernel.ts:67-90` 的注释已冻结该语义）。
- **导出与依赖**：导出 `BriefKind`、`BriefContext`、`BriefRenderResult`、`renderTaskBrief`；import 仅 `@studio-next/contract` 的类型（`AttemptNo`、`SummarySidecar`、`TaskBrief`、`TicketId`、`KnownSecretSet`）＋目标新增的运行期 `configInvalid` 与 `./secret-boundary.ts`。**不** import `redactOutbound`/`redactKnownSecrets`/`findSecretShaped`。无 fs、无 env、无时间。
- **IO 与注入**：零 IO；`summary` 与 `note` 由调用方注入；`workspace`/`briefPath` 只是字符串插入，**本文件不校验路径 containment**（路径安全归 daemon/78）。
- **状态/并发**：纯函数；同输入同输出；无事务/重试/取消。
- **错误与观测**：现状 4 个 `throw`——验收为空（`:77`）、文档引用为空（`:80`）、`attempt<1`（`:82`）、续跑缺 `resume`（`:94`，不静默降级）。消息不含正文。目标改走 `configInvalid`：前三个用 §3.2 表的 `prompt-acceptance-empty`/`prompt-docrefs-empty`/`prompt-brief-attempt-invalid`，第四个用 `prompt-brief-resume-missing`；新增秘密命中用 `prompt-known-secret`。无日志、无事件。
- **已知缺口（重要，目标需处置）**：
  1. **前情摘要按受信文本插入**：`summary.conclusion`、`changed_files`、`rejection_reason` 与 `ctx.resume.note` 原样进入任务书，未按 C2-10 包裹/消毒，也未做标记走私检查。上一轮 worker 或外部意图可以把“忽略上文并 push”一类文本写成结论，直接进入下一轮的一等指令位。文档只对“网页可编辑内容”提出隔离要求，**未定义** `summary.json`/意图 `note` 的信任级——这是 §七 的 G6，本文不擅自把既有测试语义改掉。
  2. **`objective` 也不是受信文**：运行链上它是 `input.issue.title`（平台单据标题，谁能建单谁就能写），当前原样进 L4 `objective`（§1.3）。同一缺口家族，但归属与 C2-10 不同（平台侧输入），一并记 G6。
  3. **前情摘要 ≤300 字未实现**（文件头自注）；当前不截断，也不计数。
  4. `channelNote` 文案含 `claude<2.1.277` 回退说明，属**拟稿措辞**；真实版本判定在 adapters/78，不在本文件。
  5. **`budgetCapUsd` 与 `TS-SCALAR-09` 冲突**（v0.2 新发现）：`BriefContext.budgetCapUsd?: number` 被塞进 `TaskBrief.budgetCap: Money{usd:number}` 并渲染成 `$<usd>`；`Money.usd` 只允许内存计算与旧记录兼容，**不得进公共签名/记录契约**（`80:351`）。本文件不自行改类型、不做 Decimal 换算，登记为 G16。运行链当前不传该字段（§1.3），故冲突尚未实际发生。
- **测试与证据**：`F-prompt-test-brief`（13 个 `it`）覆盖首版四要素、无前情节、空验收/空引用/非法 attempt 拒、续跑注入五要素、空改动文件显式行、缺 resume 拒、`TaskBrief` 逐字段对齐且无 `resume`/`budgetCap` 多余键、续跑+预算按需带、预算正文、三通道文案、双跑相等。**不证明**真实续跑可恢复会话、不证明真实 `summary.json` 形状（只用类型夹具）、不证明注入文本会被模型当资料而非指令。
- **目标变更（v0.2，按 G6 未决前“只加断言、不改语义”原则）**：
  1. **秘密边界（只读、只拒）**：签名改为 `renderTaskBrief(kind, ctx, opts?)`，`opts.secretBoundary` 与 §3.3 是**同一个类型、同一个模块、同一个实例**（daemon 对 AGENTS.md 与任务书传同一份 `KnownSecretSet`）：**渲染前**对下方枚举的文本位逐个调 `assertNoKnownSecret(text, <字段名>, set)`（判据 `set.redactKnown(text) !== text`，命中即 `configInvalid('prompt-known-secret', <字段名>)`），**渲染后**对最终 `text` 再调一次（`detail='brief-selfcheck'`，§3.7-5），最后对最终 `text` 调 `secretShapeCounts(text, set)` 只计数回传。**不替换**——因此 `text` 与 `taskBrief` 必然同源，不存在 v0.1 设计的“脱敏后 context 与 taskBrief 分叉”风险。`scanned:false` 时同 §3.3-5：daemon 不得落盘，M5 翻必填。
     - 枚举面（固定七处、不递归）：`objective`、`acceptance[]`、`docRefs[]`、`resume.note`、`resume.summary.conclusion`、`resume.summary.changed_files[]`、`resume.summary.rejection_reason`。
     - `workspace`/`briefPath`/`sessionId`/`summaryPath` 是路径与标识位，不入枚举；是否含秘密归 daemon/78 的路径闸。**出口自检是它们的兜底**：路径里若出现已知值，`brief-selfcheck` 同样拒绝——这是对枚举面的补漏，不是对路径语义的二次解释，也不把参数级校验挪进本包。
  2. **标记走私断言**：对最终 `text` 跑 `containsLayerMarker` 与 trim 标记判定，命中即 `configInvalid('prompt-layer-marker-smuggled', 'brief')`——防止前情摘要里写一行 `<!-- LAYER:L4:BEGIN -->` 伪造层边界。它对现有夹具全部通过（既有夹具无标记），属纯增量。
  3. **信任级处置需批示**：前情摘要与 `note` 是否走 `sanitizeUntrusted`（会改文本、需整段更新 `brief.test.ts` 期望）归 G6；本文**不擅自**改语义，只登记口径与两条候选路径（① 引用块 + “资料·非指令”声明；② 仅剥离命令形态行）。
  4. **300 字上限**：若确认，截断在**渲染前**做并留计数（不得静默）；阈值由批示定，本文不代定。
  5. **`budgetCap`**：不改类型、不做换算；按 G16 的结论再动（若 80 改 `TaskBrief.budgetCap` 为 `{amount: DecimalString; currency}`，本文件的渲染行同步改，属另一刀）。
- **规模与迁移**：148 行；目标 ≤200（新增：入参形状复用 + 七处只读判定 + 出口自检 + 标记断言）。迁移顺序见 §八 M4/M5：先做标记走私断言（对现有输入全部通过，不依赖秘密前置）→ 再接只读秘密判定与出口自检（需 M2 的 `contract` 落位）→ 再按批示决定 `summary` 是否走消毒（M8）→ 最后接 300 字口径。

### 3.5 `F-prompt-sanitize`

- **路径/处置**：`packages/prompt/src/sanitize.ts`；目标-保留；68 行；预算 ≤ 100。
- **上位**：`docs/17-§5` 末行、`docs/01` C2-10；78-§2.4（软限制不得当控制）。
- **职责**：把不可信段做**上下文重构**——逐行判定命令形态、以占位标记替换、整段引用块包裹、加“内容非指令”声明，并返回剥离行数供调用方记账。
- **非职责**：不是沙箱、不是权限控制、不是秘密脱敏、不保证模型服从；不解析 markdown 围栏结构；不剥离行内命令（只判行首）。
- **内部结构**：`UNTRUSTED_DECLARATION`（`:25-26`）、`STRIPPED_PLACEHOLDER='【已剥离命令形态行】'`（`:29`）；私有 `COMMAND_LINE_SHAPES` 四条无 `/g` 正则——三反引号围栏行、`rm -rf`、`$(`、反引号（`:32-37`）；`isCommandShapedLine(line)` 先 `trimStart` 再 `.some(test)`（`:40-43`）；`SanitizeResult{text, stripped}`（`:46-49`）；`sanitizeUntrusted(text)`（`:55-68`）。
- **判定口径与已知漏剥（文件头已如实记录）**：围栏**内部**不以四形态开头的行不剥（首行围栏已被替换，残行不构成可执行块——拟稿判断）；`curl … | sh`、`sudo …`、管道注入等未枚举形态**不剥**；只剥整行，不做行内替换；缩进不豁免。
- **导出与依赖**：导出上列符号；**零 import**（无 contract、无 node 内置）。
- **IO 与注入**：零 IO；纯字符串变换；无时间/随机。
- **状态/并发**：纯函数；正则无 `/g`，`.test` 无 `lastIndex` 残留；并发调用互不影响。
- **错误与观测**：**无 throw**；任何输入都返回结果（空串→仅声明行+一个 `> `）。不计日志、不报事件；`stripped` 只交调用方。**秘密面：不检测秘密**；若输入含秘密，会被原样引用块保留——这不是本文件的缺陷，而是分工：`sanitize` 只重构“命令形态”，秘密判定在 `assemble`/`brief` 出口（§3.7），且那里的判定在**消毒之后**运行，故被引用块包住的秘密同样会被拒绝。**不变量**：`sanitizeUntrusted` 的输出永不含未声明的指令位（只加声明与引用），但其文本**仍需过秘密闸**方可出站。
- **测试与证据**：`F-prompt-test-sanitize`（7 个 `it`）：四形态各剥一行计 4、前导空白不豁免、`rm` 普通叙述不误伤、全段引用块+头注、C2-10 验收句保留但被“非指令”声明中和、空串结构与计数、双跑相等。**不证明**真实模型会忽略被包裹内容——这是 V2/V5 的真实进程/真机问题；本测试只证明**文本形态**符合约定。
- **目标变更**：规则集**不自行扩张**。若要覆盖 `curl|sh`/`sudo`，必须先在 `docs/01` C2-10 明确口径（属需求变更），本文只登记为缺口。可做的内部硬化：把四条正则与占位符的对应关系显式化（供测试逐条断言），不改变输出。
- **规模与迁移**：68 行；目标 ≤100。无迁移。

### 3.6 `F-prompt-trim`

- **路径/处置**：`packages/prompt/src/trim.ts`；目标-保留；196 行；预算 ≤ 240。
- **上位**：`docs/17-§5` 裁剪优先级、`docs/01` C2-09（阶梯与“输出裁剪清单且不丢红线与验收口径”）。
- **职责**：在给定“层正文总字符预算”下，按固定阶梯裁剪**显式声明**的三个 trim 区，返回新层集、裁剪清单、总量与是否达标；裁后重算受影响层的 `fingerprint` 与 `trimmables.lines`。
- **非职责**：不组装 AGENTS.md、不知道标记/横幅/daemon 追加块的开销、不增删层、不裁 trim 区外内容、不判 `protected`、不记日志、不决定预算值（预算由调用方给）。
- **内部结构**：`DEFAULT_KEEP_RECENT_N=3`（`:31`，拟稿默认，文件头注明数据试算未做）；`TrimOptions{keepRecentN?}`；`TrimRule='L3_WORK_HISTORY_KEEP_RECENT_N'|'L4_LESSONS_HALVE'|'L1_CAMPAIGN_ONE_LINE'`；`TrimCut{layer, rule, totalLines, keptLines, removedChars}`；`TrimResult{layers, cuts, totalChars, budgetChars, withinBudget}`（`:33-64`）。私有：`cutRegion`（`:70-95`，用 `indexOf` 找首对标记、按非空行切、无可裁返回 null）、`applyCut`（`:98-125`，不可变替换并联动指纹）、`totalCharsOf`（`:127-128`）；入口 `trimLayers(layers, budgetChars, opts?)`（`:138-195`）。
- **阶梯（固定）**：预算内→零裁直通；超预算→① L3 `work_history` 保留末尾 N 个非空行（旧→新序；`N=0` 显式全裁，避开 `slice(-0)` 陷阱）→ 仍超→② L4 `lessons` 保前 `ceil(k/2)` → 仍超→③ L1 `campaign` 保首个非空行；每阶后达标即停；三阶后仍超→`withinBudget=false`，**不裁红线硬凑**。
- **导出与依赖**：导出上列符号；import `./layers.ts` 的 `layerFingerprint`、`trimMarkerBegin/End` 与类型；零外部依赖。
- **IO 与注入**：零 IO；预算与 N 均参数注入；无时间/随机。
- **状态/并发**：纯函数；不修改入参（`layers.map(l=>l)` 起手，裁时整体替换层对象）；返回新数组；并发安全。
- **错误与秘密/观测**：**无 throw**。“无该区/区空/策略未减少行”一律静默返回 `null`，不产生 `cuts` 条目；唯一失败信号是 `withinBudget=false`。无日志/事件；裁剪清单是否落账由 daemon 决定（当前**无调用方**，故未落账）。
- **已知语义边界（必须显式，不得当成已满足）**：
  1. **预算口径是“层正文之和”，不是成品提示词预算**：不含 AGENTS.md 横幅、指纹行、12 个层标记、块间换行，也不含 daemon 在任务书后追加的 wkey 指引/哨兵段/读面节。因此 `withinBudget=true` 不代表发出去的字节在预算内。
  2. **`protected` 未被本文件读取**：保护完全依赖 builder 不把不可裁内容放进 trim 区。当前 L4 `protected=true` 却有 `lessons` 区（C2-09 明确允许的例外），故不能简单写“protected 层一律不裁”。
  3. **区结构假设“每个 kind 至多一对标记且顺序正确”**：`cutRegion` 只取第一个 begin 与其后第一个 end；重复/嵌套/反序标记会产生错误切片而不报错。
  4. `removedChars` 是“标记间正文长度差”，不含标记本身；可为正而被后续格式化抵消的边界未测。
- **测试与证据**：`F-prompt-test-trim`（12 个 `it`）：预算内直通、默认 N=3、第一阶只裁 work_history 且保留末尾、画像数字结构性保留、N≥行数时不无中生有、第二阶减半且验收 fenced 块逐字节不变、第三阶只留战役首行且使命/方向/身份不动、三阶顺序、极端预算 `withinBudget=false`、L0/L2 逐字节不变、裁后标记仍成对且 `removedChars>0`、指纹联动（L3/L1 变、L4 不变）、入参不可变。夹具用等长 40 字符行使阶次确定，**不证明**真实 token 预算、不证明真实模型在裁剪后仍能完成任务。
- **目标变更（内部硬化，不改公开签名）**：
  1. 进入裁剪前断言每个 kind 的标记**恰好一对且 begin 在 end 前**；不满足即 `configInvalid('prompt-trim-marker-shape', <层 id + kind>)`（§3.2 表）。这是把“已知边界 3”从静默错误改成显式拒绝。
  2. 断言“protected 层的可裁区仅限 C2-09 声明的例外集合（L4 `lessons`）”；出现 L0/L2 区即拒（同一 subcause，`detail` 标层 id）。不改现有构建输出。
  3. 在类型注释里把“层正文预算 ≠ 成品字节预算”写死；是否引入“含包装开销”的第二种预算属 80/82 的口径决定（G9），本文不新增字段。
  4. **明确不做层序断言**：本文件假定入参已过 `assertLayerSequence`，`trimLayers` 不重跑；这是刻意的（重跑会把“层序”这一层语义复制到第二个文件），代价是直接调用 `trimLayers` 的代码必须自己守序——测试 4.6 已把该假设写成前置夹具，不写成“`trimLayers` 会校验”。
  5. 秘密面：本文件**不做**任何秘密检查，也不改写入站文本的秘密语义（裁剪只动 trim 区内的行，若区内有秘密，`assemble`/`brief` 的 `prompt-known-secret` 会在**其后**拒绝）。因此“先 trim 后 assemble”的顺序是安全的；“先 assemble 后 trim”则会让 trim 产出未经秘密判定的文本——**顺序固定为 `trimLayers → assembleAgentsMd`**（§八 M6）。
- **规模与迁移**：196 行；目标 ≤240。**接线迁移属 daemon（16/17）**：派发前 `buildLayers → trimLayers → assembleAgentsMd`，预算来自配置；本包只加不变量。回退=不调用 `trimLayers`（与今天行为一致）。**当前零调用**（§1.3），故 `withinBudget` 从未在生产路径上被读取（G9）。

### 3.7 `F-prompt-secret-boundary`（目标-新增）

- **路径/处置**：`packages/prompt/src/secret-boundary.ts`；**目标-新增**（当前不存在）；预估 60–100 行；预算 ≤120。测试件 `F-prompt-test-secret-boundary`（§4.7）。
- **前置未就绪（顺序阻塞）**：本件只需要**一个类型 + 它的两处能力**——`contract/src/ports/secret.ts` 的 `KnownSecretSet`（80-§11.2.1）。该文件**当前不存在**（80-§11.2.1 自述“目标，未实现”；`80:3364` U80-18），但已在 81-01 登记（`F-contract-port-secret`），因此本件不自造类型、不新增接口。集合的**实例**由 daemon 装配期构造（78-§7.4.1 的 provider 取 `SecretMaterial[]`），其内部实现复用 `contract/src/secrets.ts`（`F-contract-secrets`，80-§11.2-3）；**本包不 import 那个模块的任何一个函数**——这是 v0.3 相对 v0.2 的收窄，也是“prompt 不掌握算法”的机械体现。用哪两处能力由 80 的调用边界表定死：本件属“内部供给”面，判据用 `redactKnown`、诊断用 `find`；`redact` 是出站总闸，本件**不调、不持有**（`80:3155-3161`）。仓内不得出现第二条路径：**禁止** `prompt→core` 边（`boundary-rules.mjs:126-127` 只允许 `prompt→company`/`prompt→contract`），**禁止**在包内复制 `BEARER_RE`/`ASSIGNMENT_RE`/`LONG_TOKEN_RE`、`MIN_KNOWN_LENGTH`、`REDACT_MARK`（80-§11.2-3“不得留第二套实现或第二份正则”），**禁止**把集合摊成明文数组、另开 provider、读 env 或任何文件。
- **上位**：80-§2.1 第 4 行（`80:123`，prompt 目标“补‘秘密不入装配’的可证明边界”）；80-§11.2-2/-3（`80:2759`/`80:2761`）；80-§11.2.1（`80:3042`；接口 `80:3092-3099`；三分工表 `80:3104-3108`；判据句 `80:3110`；调用边界表 `80:3155-3161`；`find` 非门禁 `80:3164`；无命中不等于安全 `80:3165`）；78-§7.4.1（`78:953`，`SEC-*` 稳定命名空间与三态 `78:1000-1005`）；77-§3.4（`77:624`）；75-D75-13（`75:186`）。**不新造**公共端口/记录/状态：本件是包内实现件，不是 `TS-PORT-*`，不从 `index.ts` 导出（§3.1）。
- **职责（一句话）**：把“这份产出会不会被集合的 `redactKnown` 改动”变成**可判定的布尔**——会改动即让调用方拒绝出站；另给**只含计数**的形状观测。本件自身不写任何文本、不产出 `<redacted:N>`、不重定义标记语义（`<redacted:N>` 的形态与 `N` 的含义原样继承 `contract`）。
- **非职责**（逐条都是设计边界，不是待办）：
  - **不改写文本**：不替换、不生成 `<redacted:N>`、不重算指纹。改写会让“验收命令被静默改掉”“指纹与内容不一致”两个问题同时出现（v0.1 设计的撤销理由，§1.2）。
  - **不实现算法、也不调用算法**：不复制正则、不重写阈值/标记形/负前瞻/长值优先；不新增 `SecretShapeFinding` 的 kind；**不 import** `redactKnownSecrets`/`findSecretShaped`/`redactOutbound`——算法只在集合内部，本件只握集合。
  - **不是秘密来源**：不读 env/文件/网络，不持有 catalog/provider，不定义 `secretId`，不做轮换/吊销/重建，不缓存清单，**不派生 `knownValues`**（v0.3 起连派生点都不存在：集合不暴露值）。
  - **不解释 `state`**：`complete`/`known-set-empty`/`known-set-partial` 的能力语义（是否可启动、是否可派工）是装配根职责（80-§11.2.1-3）；本件只原样回传。
  - **不提供“只判形状”的入口，也不拆 `redact`**：判据只用集合的 `redactKnown`（只换已知值、不做形状兜底），形状只经 `find` 计数；本件**不拆解**任何算法——拆解需要知道匹配长度/前缀，而那等于复制正则。`find` 的命中**永不**参与拒绝（`80:3108`、`80:3164`），因此“闸通过”与“形状干净”是两件事，不得互相冒充。
  - **不证明无泄漏**（§九）。
- **内部结构**（签名级；**两个函数导出 + 一个类型**；不新增任何接口）：
  - **入参类型不新造**：直接用 `import type { KnownSecretSet } from '@studio-next/contract'`（80-§11.2.1）。**没有** `SecretBoundaryInput` 这一层包装——包装的必然内容就是把值摊成数组，正是 v0.3 要删掉的东西；包装去掉后，“派生明文”在类型上**无法表达**，不靠纪律。
  - `interface SecretBoundaryReport { readonly scanned: boolean; readonly state: KnownSecretSet['state']; readonly missingSecretIds: readonly string[]; readonly secretIdCount: number; readonly shapeHits: Readonly<Record<'bearer'|'assignment'|'long-token', number>> }`——`scanned=false` 当且仅当入参缺失（迁移期），其余字段零值/原样回传；`secretIdCount = set.secretIds.length`（**id 计数，不是值计数**）；`shapeHits` **只诊断、不参与判定**（`80:3104-3108`、`80:3164`）。**无 `knownHits`**：命中即抛，成功路径恒 0，写出来只会被读成“已知值命中数”并可被反向用来推断“有没有藏值”；口径只到布尔（`80:3110`），不加计数字段。
  - `assertNoKnownSecret(text: string, where: string, set: KnownSecretSet): void`——判据只有一句 `set.redactKnown(text) !== text`；命中即 `configInvalid('prompt-known-secret', where)`（§3.2 表），不返回布尔，避免调用方忘记分支。**为什么用比较而不做子串扫描**：扫描要自己实现阈值、长值优先与去重，等于第二套语义；比较法把口径一并继承，且不得优化成 `includes`、不得改成“先 `find` 再判”（`find` 命中不是泄漏，改成它即换掉判据，判负）。**`redactKnown(text) !== text` 只说明“命中了已知值”**（`80:3110`），不等于“文本干净”之外的任何结论——见 §3.7-4。
  - `secretShapeCounts(text: string, set: KnownSecretSet): SecretBoundaryReport['shapeHits']`——调 `set.find(text)`，按 `kind` 累加；**丢弃 `at`**（80-§11.2-3：偏移只对替换前原文有效，不得对外发布）。本函数的输出**不参与**任何拒绝判定。
  - **不进本文件**：层与字段的枚举/循环留在调用方（`assemble.ts` 逐层、`brief.ts` 七处），故本件不引 `./layers.ts`、不引 `./brief.ts`，模块图无环。
- **判定口径（必须显式，不得当成已满足）**：
  1. **判据是“`redactKnown` 会改动”，不是“含某个子串”**：`set.redactKnown(text) !== text` 即命中（80 的分工表把“内部供给 = 提示词、任务书”划给 `redactKnown`，`80:3155-3161`；判据句 `80:3110`）。这继承的是 `redactKnownSecrets` 的**整条链**：已知值（`≥MIN_KNOWN_LENGTH=6`、长值优先、去重），**不做形状兜底**。因此本件能证明的准确命题是“**这份产出不含长度 ≥6、且已声明 `secretId` 的已知值**”，不是“产出里没有秘密”——清单只覆盖声明的 `secretId`，未声明的凭据不会被拦（§6.4）。
  2. **短值不拦**：`MIN_KNOWN_LENGTH=6` 是 80-§11.2-3 冻结阈值，短于 6 的已知值不被替换，本件于是也判不出。**继承的取舍**，不改阈值；测试要钉住“短值文本 → `set.redactKnown` 不改动 → 不抛”，防止有人误以为拦住了短秘密。
  3. **已标记文本**：`(?!<redacted:)` 负前瞻只在 `ASSIGNMENT_RE` 上（`packages/core/src/secrets.ts:50`），作用是“已知值先换后，形状兜底不得二次改写标记”。**它不保护已知值替换**——`redactKnownSecrets` 本身无负前瞻，若把 `<redacted:12>` 当作已知值登记，它仍会被再次替换。v0.2 用例 5（“已标记文本不算命中”）因此是**错的**，v0.3 改为按实现口径写用例（§4.7）。`<redacted:N>` 的形态与 `N`（原值长度）的含义**原样继承** `contract`，本包不重定义、也不因判据换档而改动 regex 或既有测试口径（`80:3110`）。
  4. **形状不参与判据（v0.4，与 v0.3 相反）**：`redact` = `redactOutbound`，含三条形状正则（`BEARER_RE`/`ASSIGNMENT_RE`/`LONG_TOKEN_RE`），是**出站面**的能力；本包不调它，因此 40/64 位 hex（commit sha、`payload_hash`/`digest`）、32+ 位 base62 **都不会**让产出被拒——这正是 80 把内部文本面划给 `redactKnown` 的理由：示例、夹具、教训文本必须原样可见（`80:3106`）。形状只经 `find` 统计进 `shapeHits`，**不得**据此拒绝（`80:3108`、`80:3164`）。**代价写在这一侧**：本闸只认已声明的已知值，未知来源的凭据（不在集合里、形状也不认识的编码变形）不会被拦——那是清单完整性问题，不是本件可补的。
  5. **自检（两处出口各一次）**：`assemble` 拼装后、`brief` 渲染后，对最终整篇文本再跑一次 `assertNoKnownSecret(text, 'assemble-selfcheck' | 'brief-selfcheck', set)`——命中说明有路径绕过了逐层/逐字段检查（或落在未枚举的文本位，如 `workspace`/`briefPath`/`sessionId`/`summaryPath`），属内部不变量被破坏，必须拒绝而不是忽略。
  6. **“命中即拒”的唯一运维代价（必须写明，不得当不存在）**：**轮换窗**——集合不区分“当前有效值”与“已吊销但仍留脱敏窗的历史值”（78-§7.4-4 要求旧值至少再留 24h 去重窗，80-§11.2.1-3 要求整体重建）；旧值若本来就写在 L3 `work_history`/L4 `lessons` 里，轮换后 24h 内派发会被一律拒绝，本包无法自愈。处置方向（历史文本先过脱敏、或在轮换窗内豁免历史段）属 78/82 与 80，本文**不私自**引入第二份清单、第二档行为或新接口。**v0.4 说明**：v0.3 记账的“第二笔代价（形状误伤 40/64 位 hex）”已随判据改为 `redactKnown` **消失**，不再构成本闸的阻碍；本卷因此可往下走到 M5（G1 已由 80-§11.2.1 调用边界表关闭），但“可上线”仍受 G18（集合实现与 daemon 接线未落位）与上一条轮换窗处置约束。
- **导出与依赖**：导出 `SecretBoundaryReport`（类型）、`secretShapeCounts`、`assertNoKnownSecret`（**两个函数 + 一个类型**；`knownValueHit` 与 `SecretBoundaryInput` 在 v0.3 删除）。import：`@studio-next/contract` 的 `KnownSecretSet`（**仅类型**，`import type`）与 `configInvalid`（**运行期**）。**不** import `redactKnownSecrets`/`findSecretShaped`/`redactOutbound`/`SecretMaterial`——算法与取值面都在集合内部。**全部是既有 `prompt→contract` 边**，不新增边；**不**从 `index.ts` 再导出（内部硬化面）。**禁止** `node:fs`/`env`/网络/`core`/`gateway`。
- **IO 与注入**：零 IO；`set` 由调用方注入（装配期实例，同一进程内存）；不读 env、不读文件、不打开 provider、不写日志、不发事件、不持有引用超过调用期。
- **状态/事务/幂等/并发/恢复**：纯函数（对入参只读）；不改入参，不改集合；无缓存、无重试、无取消、无恢复语义（N/A：无 IO 与长事务）。同文本同集合双跑结果相同。集合若在别处整体重建（轮换/吊销/`wkey` CLOSE 即移出），本件不感知也不缓存——每次调用读当次引用，故不存在“旧集合被记住”的风险（重建语义归 78-§7.4-4/80-§11.2.1；`local-mint` 是唯一例外项）。
- **错误与秘密/观测**：唯一错误通道是 `configInvalid('prompt-known-secret', where)`；`detail` **只含**层 id / 字段名 / `'assemble-selfcheck'` / `'brief-selfcheck'`，**不拼**任何其它信息（计数走 `SecretBoundaryReport`，不进错误消息；`at` 检查都不外传）。不拼接底层异常的 `message`（可能含值）。无日志、无事件、无指标——是否落事件、如何只记“命中 N 次 + kind”，归 daemon（77 事件 + 78-§7.4 出口表）。
- **测试与证据**：见 §4.7（目标 12–14 个 `it`，已列 12 条）。**不证明**：清单完整性；未知秘密不存在（`redactKnown` 只认已声明 `secretId` 的值，短值 <6 不判、编码变形不认）；“闸通过”能推出“无秘密”（只能推出“无长度 ≥6 的已声明已知值”，`80:3165`）；已写盘文件不含秘密；第三方 executor 不落日志；其余出口（出站 5 点、内部落笔 4 点，`80:3155-3161`；现状只有 `hrsync/assemble.ts:59` 一处已在用 `redactOutbound`）。
- **R/E/W/V**：R（反例）与 E/W（预期/见证）编号归 82，本包不自行编号；V 层：V0/V1（文本与纯函数行为）由单测覆盖，V2 **未**覆盖（无真实 `KnownSecretSet` 实现可用），V3–V6 未执行。
- **规模与迁移**：新增 60–100 行，预算 ≤120。三个迁移步 + 后续取证（全部在 `contract/src/ports/secret.ts` 与集合实现落位之后；编号同 §八）：
  1. **M3 建件 + 测试，零调用**：`assemble`/`brief` 未改，包行为零变（既有 56 个用例逐字节不变）。
  2. **M4 接线（可选入参）+ daemon 传参**：`assembleAgentsMd`/`renderTaskBrief` 接受 `opts.secretBoundary`（类型=`KnownSecretSet`），缺省时产 `scanned:false`；`prompt-assembly.ts` 同批把**装配期已建好的集合实例原样传入**（来源=78 部署侧 catalog/provider；本附录不含该实现，也不含把值摊成数组的任何步骤），并把 `state`/`missingSecretIds`/`secretIdCount` 落自己的证据面；`engine.ts:997`/`:1002` 在 `scanned=false` 时拒绝写盘。M4 的缺省仍是“不扫描 → 不落盘”，故 M4 不得翻必填。
  3. **M5 翻必填（无外部前置）**：删除可选分支与 `scanned:false` 路径；`scanned` 字段保留为恒 `true`（保留字段是为了让消费方代码不必再改一次，不是因为还允许 false）。v0.3 记的“前置 G1 裁决”**已解除**——80 已把提示词/任务书划入内部供给面并指定 `redactKnown`（`80:3155-3161`），判据不再连带形状兜底，故翻必填不会把“含 40 位 hex 就拒派发”设成默认态。
  4. **后续**：调用边界表的其余强制点逐项取证（出站 5 点归 `redact`、内部落笔 4 点归 `redactKnown`，`80:3155-3161`；取证归 11/14/17 附录）；清单来源的部署侧落地归 78。
- **未证/假设**：`KnownSecretSet`/`SecretProvider` 无实现（80-§11.2.1 自述、U80-18）；`redactKnown` 的最坏时间未测；假阴性（短秘密、编码变形、未声明 `secretId`）口径归 80；假阳性（已知值短、常见词被登记为秘密）需 82 负向基线；`<redacted:N>` 的 `N` 泄露原值长度是已认定的取舍（80-§11.2），不得当零泄漏；若 80-§11.2.1 改动 `KnownSecretSet` 的成员（新增能力、或改 `redactKnown`/`redact` 的覆盖范围），本件需同步——但 `contract` 内部对 `redactKnownSecrets` 的搬家**不改本件 import 面**（本件不 import 它）。

---

## 四、测试件逐文件

> 所有测试均为**纯内存、参数注入**；无 fs、无子进程、无网络、无真实 executor。测试通过只证明“当前纯函数对给定夹具的回归”，不证明真实进程/真机/跨实现能力（75-D75-15、81-§四）。
> R/E/W 反例与本包的对应关系**不由本文编号**：归 82 追溯。每个测试文件条目末尾都写一行 `R/E/W/V: N/A + 理由`——本包不承担 64-§四 R1–R31 与 E/W 主答，自行编号会造出第二套追溯表。验证层级：本包测试只覆盖 V0/V1（文本与结构）与部分 V2（纯函数行为契约）；V2 要求的“真实适配器/真实进程回放”以及 V3–V6 均**未执行**。
> 计数：现有 56 个 `it`（layers 15、assemble 9、brief 13、sanitize 7、trim 12）；目标新增 **27** 个（4.2 一条未知 kind —— 另有“只断言 throw”升级为断言 category+subcause 的用例，属改写不算新增；4.3 **五**条；4.4 五条；4.6 四条；4.7 **十二**条），落地后 **83** 个。**秘密边界的单元判定与集成判定分开放**：单元在 4.7（`secret-boundary.test.ts`），集成在 4.3/4.4（各自模块的出口），避免一个测试文件同时依赖两个模块的语义。

### 4.1 `F-prompt-test-helpers`

- **路径/处置**：`packages/prompt/test/helpers.ts`；仅测试；106 行；预算 ≤160。
- **职责**：提供标准六源与标准六层夹具，供其余五个测试文件复用；使“改一层只动一段”有对照面；目标再提供两个**集合替身**夹具（v0.3 起入参是 `KnownSecretSet`，不再是裸值数组）：`CLEAN_BOUNDARY`（`secretIds: []`、`state: 'complete'`、`missingSecretIds: []`、空已知值）与 `boundaryWith(values)`（同上但带指定已知值），两者都实现 `redactKnown`/`find`（以及作为出站面完整性的 `redact`）三个方法，避免各文件各写一份替身。**替身纪律**：`redactKnown` 直接转发 `contract` 的 `redactKnownSecrets`、`redact` 直接转发 `redactOutbound`、`find` 直接转发 `findSecretShaped`，**不得自写子串扫描**——替身自写就等于把被测口径换掉，测出来的是替身而不是实现；**不得**让 `redactKnown` 转调 `redact`（那会把形状兜底偷偷塞回判据，与本卷 §3.7-4 相反）。
- **导出**：`FWK_VERSION='0.1.0'`；`SNAPSHOT`（`slug/name/level=2/charter/platform/departments:[]/people:[]/jobs:[]`）；`PERSON`（`E001/张三/zhangsan/level 3/工程部`）；`CAPS`（`budget_cap:true,cancel_turn:true,session_resume:false,agents_md:'user_level',cost_native:false`）；`standardSources(): LayerSource[]`（L1 四节、L3 六节含 6 条 work_history、L4 四条 lessons、L5 带一个插件）；`standardLayers()`（`buildLayers(standardSources())`）；目标加 `CLEAN_BOUNDARY`、`boundaryWith(values)`。
- **依赖**：`@studio-next/contract` 的类型 + `../src/layers.ts`（目标再加 `../src/secret-boundary.ts` 的**类型**）；不 import 其他测试。
- **IO/状态**：无 IO；每次调用**新建**对象（`standardSources` 内部构造），但注意 `standardSources()` 返回的对象会被调用方原地改写（如 `assemble.test.ts` 的 `untrustedSources`、`trim.test.ts` 的 `controlledSources`）——因每次调用都是新对象，互不污染。
- **证据边界**：夹具的 `SNAPSHOT.departments/people/jobs` 为空，**不能**代表真实公司目录；`work_history` 行序“旧→新”是拟稿口径，不是文档冻结；秘密夹具**一律** `test-` 前缀的假值（80-§11.6），不得出现真实 token/密码，也不得出现形似真实凭据的 32+ 字符随机串（否则 `shapeHits` 计数会污染其它用例）。
- **R/E/W/V**：N/A——本文件是夹具，不承担 64-§四 R1–R31 与 E/W 主答，本文不自行编号；V 层只到 V0（编译/导入）。
- **规模与迁移**：106 行，预算 ≤160；随源类型变化同步；若 `LayerSource` 升 contract（G2），本文件 import 路径需改（属升格迁移，不在本文决定）。

### 4.2 `F-prompt-test-layers`

- **路径/处置**：`packages/prompt/test/layers.test.ts`；仅测试；180 行；15 个 `it`、3 个 `describe`；预算 ≤240。
- **覆盖**：六层齐序与三字段非空；源乱序/缺层/多层拒；层标记走私拒；trim 标记走私拒；空验收/空引用拒；L1/L3 节重复拒、节乱序渲染一致；六段指纹逐字格式与正则；双跑同 bytes；改 L3 只动 p 段；改 L1 只动 co 段、改框架版本只动 W 段；t 段“内容变而指纹不变”的冻结字面义；单层直算与 builder 一致；protected 五层标志；trim 区归属；L5 固定键序与指纹。
- **fake 边界**：全部输入为内存对象；`SNAPSHOT` 空部门/空人员；无真实公司目录、无平台、无 executor。
- **不证明**：真实目录解析、真实 vcs 修订、指纹抗篡改、prompt cache、跨进程一致性；“六段格式正确”不证明指纹可用作内容身份（`TS-SCALAR-08`）。
- **缺口与目标负例**：现无“未知 `kind`”的运行期拒绝用例（无该分支）。`buildLayer`/`layerFingerprint` 加 `default` 后**必须**补：未知 `kind` → `configInvalid` 且 `subcause='prompt-layer-kind-unknown'`。**同时把所有既有的拒收用例从“只断言 throw”升级为断言 `category='CONFIG_INVALID'` + 精确 subcause**（§3.2 表），否则“错误面统一”这件事没有任何证据。
- **R/E/W/V**：N/A——R 与 E/W 编号归 82，本文不自行编号；V 层：V0/V1 覆盖（文本与结构），V2 部分（纯函数行为契约），V2 的“真实适配器回放”与 V3–V6 未执行。
- **规模与迁移**：180 行，目标 ≤240；仅随源类型签名变化而改夹具/断言，不重写用例；若 `LayerSource` 升 contract，只改 import 路径。

### 4.3 `F-prompt-test-assemble`

- **路径/处置**：`packages/prompt/test/assemble.test.ts`；仅测试；100 行；9 个 `it`、3 个 `describe`；预算 ≤180。
- **覆盖**：横幅与指纹注释行位置；六层标记成对且 begin 位置单调；五层拒组装；正文走私拒组装；`untrustedSources()` 构造 L1 加围栏+`rm -rf /`、L3 加反引号行，汇总 `sanitized=3` 且成品不含 `rm -rf /`；无不可信段时 `sanitized=0`；`layerBytes` 的 id 顺序与 chars/bytes 口径；双跑 `text/fingerprint/layerFingerprints` 全等；完整指纹=逐层拼接。
- **fake 边界**：不可信内容是**字符串夹具**，不是真实网页/档案；消毒只到文本层；秘密边界夹具是**集合替身**（§4.1），不是 catalog/provider，**不证明**真实集合的构建、轮换或吊销行为。
- **不证明**：写盘、文件权限、通道选择、compact 后磁盘重注入、真实模型行为；不证明“清单外无秘密”（`redactKnown` 只认已声明 `secretId` 的值）；不证明“闸通过 ⇒ 产出无秘密”（只到“无长度 ≥6 的已声明已知值”，§3.7-4）。
- **缺口与目标用例**（5 条，必须都写）：
  1. **缺省不扫描仍逐字节等旧**：不传 `opts` 时 `secretBoundary.scanned=false`、`text`/`fingerprint` 与旧夹具逐字节相同——这是迁移期的回归基线。
  2. **已知值命中即拒**：把 `boundaryWith(['test-secret-value'])` 传入、L1 正文含该串 → 抛错且 `subcause='prompt-known-secret'`、`detail='L1'`；**断言错误消息不含该值**。
  3. **形状不介入判据（v0.4 与 v0.3 相反，必须按新口径写）**：正文含 40 位 hex（如 `a`×40）→ **不抛**，输出逐字节保留该串，且 `shapeHits['long-token'] >= 1`；同样的文本再断言 `set.find(text).length > 0` 不影响结论（`find` 不是门禁，`80:3164`）。**对照**：26 位 ULID → 不抛、`shapeHits` 三键全 0。这条用例的 purpose 是钉住“内部供给面不因形状兜底误伤 commit sha / `payload_hash`”，任何人想恢复“形状也阻断”必须先改 80 的分工表（`80:3104-3108`），而不是偷偷把断言收紧。
  4. **只读不写**：命中路径下断言抛出的错误消息与任何返回值都不含 `<redacted:`；未命中路径下 `text` 逐字节不含 `<redacted:`——证明本包不产标记。
  5. **拼装后自检**：把已知值设为 `AGENTS_MD_BANNER` 的一段 → 逐层检查全过、最终文本命中 → 拒，`detail='assemble-selfcheck'`（这条用例存在的意义：证明自检真的在跑，而不是死代码）。
- **R/E/W/V**：N/A——R/E/W 编号归 82；V0/V1 覆盖，V2 部分，V3–V6 未执行。
- **规模与迁移**：100 行，目标 ≤180；新增 4 条用例；不修改既有断言含义（第 1 条就是“旧断言原样通过”的显式化）。

### 4.4 `F-prompt-test-brief`

- **路径/处置**：`packages/prompt/test/brief.test.ts`；仅测试；153 行；13 个 `it`、5 个 `describe`；预算 ≤220。
- **覆盖**：首版四要素与工位两行；首版无前情节；空验收/空引用/`attempt=0` 拒；续跑五要素注入；空改动文件显式行且无打回理由行；缺 `resume` 拒；`TaskBrief` 首版逐字段相等且无多余键；续跑+预算按需带；预算正文；native/append 两分支文案；双跑相等。
- **fake 边界**：`SUMMARY` 是内存 `SummarySidecar`；`sessionId/summaryPath` 是假串；`<home>/.dsh/AGENTS.md` 是示例路径（用户级 DSH 说明文件的占位写法，仅字符串，不触碰磁盘，**不写任何本机绝对路径**）；秘密夹具同 4.3（集合替身）。
- **不证明**：真实 `summary.json` 读取/校验（校验在 contract `validateSummarySidecar`，本测试不调用）、真实续跑、真实通道落点；不证明注入文本会被模型当资料而非指令。
- **缺口与目标用例**（5 条）：
  1. 缺省不传 `opts` → `secretBoundary.scanned=false`，`text` 与旧夹具逐字节相同。
  2. `objective` 含已知值 → 拒（`detail='objective'`）；`acceptance[]` 含已知值 → 拒（`detail='acceptance'`）——两条都要，证明“验收位与目标位同一规则、都不改写”。
  3. 前情摘要注入一行 `<!-- LAYER:L4:BEGIN -->` → 拒（`subcause='prompt-layer-marker-smuggled'`，`detail='brief'`）。
  4. 形状不介入判据（v0.4 与 v0.3 相反）：40 位 hex 写进 `summary.conclusion` → **不抛**，`text` 保留原文（证明本包不改写、不产标记），且 `shapeHits['long-token'] >= 1`；对照一条（同一处改写成 26 位 ULID → 不抛、`shapeHits` 三键全 0）。**另一条**：`summary.conclusion` 含 `boundaryWith([...])` 里的已知值 → 抛 `prompt-known-secret`、`detail='summary.conclusion'`（证明摘要位也在枚举内、判据只认已知值）。
  5. **出口自检兜底**：把已知值设为 `briefPath` 里的一段（七处枚举都不含它）→ 逐字段检查全过、最终文本命中 → 拒，`detail='brief-selfcheck'`。这条用例存在的意义：证明自检真的兜住了“未枚举文本位”，而不是只在已枚举字段上重复一遍。
- **R/E/W/V**：N/A——R/E/W 编号归 82；V0/V1 覆盖，V2 部分，V3–V6 未执行。
- **规模与迁移**：153 行，目标 ≤220；新增 5 条用例；若摘要改走不可信通道（G6 批示），旧期望文本必须整段更新，不得只改断言凑绿。

### 4.5 `F-prompt-test-sanitize`

- **路径/处置**：`packages/prompt/test/sanitize.test.ts`；仅测试；77 行；7 个 `it`、3 个 `describe`；预算 ≤110。
- **覆盖**：四形态各剥一行（计 4）且成品不含 `rm -rf`/`curl`/`whoami`；前导空白/制表符不豁免；`rm` 叙述与行内 `rm -rf` 不误伤；全段引用+头注；C2-10 验收句保留在引用块内且声明“非指令”；空串结构与计数；双跑相等。
- **fake 边界**：注入文本是人工构造；“中和”只到文本结构层。
- **不证明**：模型真的不执行引用块内文本；不证明围栏内部/`curl|sh`/`sudo` 等未枚举形态被处理（明确不剥）。
- **缺口**：无“秘密值不被当命令处理”的用例——不属本文件职责（`sanitize` 不判秘密，§3.5）；秘密判定在 4.3/4.4 的出口用例覆盖。另一条真实缺口：无“反引号在行中被误判/不判”的边界用例，属规则集口径（C2-10 未定），本文不擅自加。
- **R/E/W/V**：N/A——R/E/W 编号归 82；V0/V1 覆盖（文本形态），V2 的“模型真的忽略引用块”归 V5 真机，未执行；V3–V6 未执行。
- **规模与迁移**：77 行，目标 ≤110；规则集不变则不改用例；若 C2-10 扩形态，先加口径再逐条加正反例。

### 4.6 `F-prompt-test-trim`

- **路径/处置**：`packages/prompt/test/trim.test.ts`；仅测试；191 行；12 个 `it`、5 个 `describe`；预算 ≤260。
- **覆盖**：见 §3.6 测试行；另含“受控夹具等长行”以消除字数估算脆弱性。
- **fake 边界**：预算用 `charsOf` 现算，不是真实 token/字节预算；`controlledSources` 直接改写标准源数组（每次新建）；层集是内存对象，不经过 daemon。
- **不证明**：成品字节预算、真实任务分布下的裁剪效果、模型在裁剪后仍可完成任务；不证明 `trimLayers` 会校验层序（它**不**校验，见 §3.6-4）。
- **缺口与目标负例**（4 条，不变量落地后补）：
  1. **重复标记**（同一 kind 两对 begin/end）→ `prompt-trim-marker-shape`。
  2. **反序标记**（end 在 begin 前）→ 同上。
  3. **只有 begin 没有 end** → 同上。
  4. **L0/L2 出现 trim 区**（非法例外）→ 同上，`detail` 含层 id。
  既有 12 条用例的预算算术与阶次断言**一字不改**；上述四条都是新增，不允许把旧用例改成“碰巧通过”。
- **R/E/W/V**：N/A——R/E/W 编号归 82；V0/V1 覆盖（文本与结构），V2 部分（纯函数行为契约），V3–V6 未执行。
- **规模与迁移**：191 行，目标 ≤260；新增不变量只加负例；若引入包装开销预算（G9），另建用例并保留旧口径对照。

### 4.7 `F-prompt-test-secret-boundary`（目标-新增）

- **路径/处置**：`packages/prompt/test/secret-boundary.test.ts`；**目标-新增**；预估 100–140 行；预算 ≤160；仅测试。
- **前置**：整件依赖 `contract/src/ports/secret.ts`（`KnownSecretSet` 类型）已落地，且测试能拿到 `contract/src/secrets.ts` 的两个纯函数来构造**集合替身**（§4.1；`F-contract-port-secret` + `F-contract-secrets`，§3.7 前置 = §八 M2）。前置未落时本文件**无法通过 typecheck**，因此它是 M3 的一部分，不能提前写。
- **覆盖（目标 12–14 个 `it`，全部是单元级；集成用例在 4.3/4.4）**：
  1. **无改动即不抛**：`assertNoKnownSecret('', 'L1', CLEAN_BOUNDARY)` 与 `assertNoKnownSecret('普通中文句子', 'L1', CLEAN_BOUNDARY)` 均返回 `void`。
  2. **已知值命中**：`assertNoKnownSecret('前 test-known-value 后', 'L1', boundaryWith(['test-known-value']))` 抛错，`category='CONFIG_INVALID'`、`subcause='prompt-known-secret'`、`detail='L1'`；断言 `error.message` **不含** `test-known-value`；同文本双跑结论相同。
  3. **短值不拦**（继承阈值）：`'abcde'` + `boundaryWith(['abcde'])` → 不抛（5 字符 < `MIN_KNOWN_LENGTH=6`）。purpose 是**防止误以为拦住了短秘密**，不是缺陷记录。
  4. **长值优先/去重**：`boundaryWith(['abcdefabcdef','abcdef'])` 对 `'abcdefabcdef'` 判命中，且 `set.redactKnown` 只产出**一个**标记（比较法天然继承，本用例不断言标记形细节，只断言“改动发生”）。
  5. **已标记文本的真相（v0.3 纠错，v0.4 保持）**：`'密码 <redacted:12> 错误'` 在 `CLEAN_BOUNDARY` 下 → `set.redactKnown` 不改动、不抛（`<redacted:12>` 不是已知值，也不含 32+ 连续段）；但若把 `<redacted:12>` 本身登记为已知值 → `redactKnownSecrets` **会**再次替换它（该函数无负前瞻，负前瞻只在 `ASSIGNMENT_RE` 上，属出站面）。两条都写，钉住 v0.2 的错误断言；`<redacted:N>` 的 `N`=原值长度这一语义**不变**。
  6. **形状：`long-token`**：40 位 hex → `find` 报 `long-token=1`；32 位 base62 → `long-token=1`；26 位 ULID → `long-token=0`。
  7. **形状：`bearer`/`assignment`**（阈值按实现写：`BEARER_RE` 要 12+ 值字符、`ASSIGNMENT_RE` 要 8+）：`Authorization: Bearer test-token-value` → `bearer>=1`；`password=testvalue123` → `assignment>=1`；正常中文句子 → 三键全 0。**不要**用 `Bearer xxx` / `password=xxx` 作夹具——低于阈值不命中，会把用例写成“永远为 0”。
  8. **返回值无定位信息**：`secretShapeCounts` 的结果对象**只有三个 kind 键**（`Object.keys` 断言），不含 `at`/`text`/`length`。
  9. **形状不阻断（v0.4 与 v0.3 相反，必须写）**：40 位 hex 文本 + `CLEAN_BOUNDARY` → `assertNoKnownSecret` **不抛**，且 `find(text).length > 0`（证明命中形状不等于拒绝，`80:3108`、`80:3164`）；同一文本 + `boundaryWith(['test-aaa111'])`（已知值不在文本里）→ 仍不抛。**再一条**：把 40 位 hex 的**前 12 位**注册为已知值 → 抛（证明判据只认已知值，与形状无关）。
  10. **纯函数**：调用后集合替身的已知值数组与调用前 `toEqual` 相等（未被排序/去重/改写）；`set` 对象本身未被替换。
  11. **无缓存**：同一文本先传 `boundaryWith(['test-aaa111'])`、再传 `boundaryWith(['test-zzz999'])`，两次结论各自正确（证明不记忆上一份集合）。
  12. **`scanned`/report 形状**：`SecretBoundaryReport` 的键集合恰为 `scanned`/`state`/`missingSecretIds`/`secretIdCount`/`shapeHits`（`Object.keys` 断言）——**没有** `knownHits`/`knownValueCount`/任何值字段；`secretIdCount === set.secretIds.length`；`shapeHits` 的任何取值都不改变 `assertNoKnownSecret` 的结论（同一文本、仅改 `find` 返回 → 结论不变）。
- **fake 边界**：集合替身（§4.1）的 `redactKnown`/`redact`/`find` **直接转发** `contract` 的三个纯函数，不自写扫描；夹具秘密一律 `test-` 前缀、长度 ≥6，且**不含** 32+ 连续字母数字（否则 `find` 会同时报 `long-token`，让用例意图混乱——例外是 6/9 两处**故意**使用 40 位 hex 的用例）；替身**不是** `SecretProvider`/catalog，不证明真实集合的构建、轮换、吊销与 `local-mint` 行为。
- **不证明**：清单完整性；未知秘密不存在（`redactKnown` 只认已声明 `secretId` 的值，短值 <6 与编码变形都不判）；“闸通过 ⇒ 无秘密”（`80:3165`）；已写盘文件（本包不写盘）；第三方 executor 日志；其余强制点（出站 5 点、内部落笔 4 点，`80:3155-3161`）；`<redacted:N>` 的长度侧信道；假阳性/假阴性率（需 82 负向基线）；`contract` 迁移前后的字节等价（那份验收口径是 `packages/core/test/secrets.test.ts` 原样通过，归 81-01）。
- **R/E/W/V**：N/A——R/E/W 编号归 82，本文不自行编号；V 层：V0/V1 覆盖，V2 **仅**纯函数行为（无真实 `KnownSecretSet` 实现可回放），V3–V6 未执行。
- **规模与迁移**：新增 100–140 行，上限 160；与 `src/secret-boundary.ts` 同批落地（§八 **M3**），此时 `assemble`/`brief` 未改、旧 56 个 `it` 必须逐字节通过；集成断言随 **M4/M5** 落到 4.3/4.4，不塞回本文件。

---

## 五、配置件逐文件

### 5.1 `F-prompt-package-json`

- **路径/处置**：`packages/prompt/package.json`；目标-保留（依赖清理）；20 行；预算 ≤25。
- **现状字段（〔事实〕）**：`name=@studio-next/prompt`、`version=0.1.0`、`private=true`、`type=module`、`description`、`main=src/index.ts`、`exports["."]=./src/index.ts`、`scripts.typecheck=tsc --noEmit -p tsconfig.json`、`scripts.test=vitest run`；`dependencies` 三条：`@studio-next/company: workspace:*`（`src`+`test` **零 import**）、`@studio-next/contract: workspace:*`（仅 `import type`）、`zod: ^4.0.0`（**零使用**）。
- **职责**：声明工作区包身份、入口、包级类型/测试命令与依赖面。**非职责**：不声明构建产物（不发布，79-§6.5）；不声明许可（包级许可未决，79-§6.5/§7）；不声明 `files` 白名单（非能力包）。
- **目标处置**：
  1. **移除 `zod`**：79-§10.1 第 11 项判定为死依赖；形状校验不在 prompt。移除属 manifest 清理，不改任何边。
  2. **保留 `@studio-next/company`（休眠边）**：79-§10.1 第 8 项要求与 `boundary-rules.mjs:126` 的允许边一致；单边删除会破坏“manifest 与方向表并集一致”，须提案流，本文不删。
  3. `@studio-next/contract` 保留，且**性质变化**：目标是 `configInvalid` 的**运行期**依赖（v0.1 时只有 `import type`）；`KnownSecretSet` 仍是**纯类型**（`import type`），`redactKnownSecrets`/`findSecretShaped` **不**进本包 import 面（v0.3 收窄，§6.1）。它已在 `dependencies`（不在 devDependencies），故 **manifest 无需改动**；但审查时要认这一点——`prompt→contract` 从“类型边”变成“类型 + 运行期边”，仍是同一条允许边（`boundary-rules.mjs:127`），不触发方向表变更、不需要提案。这一条只在 §八 M4 之后成立；M3（零调用）阶段仍是纯类型边。
  4. `main`/`exports` 保持 `./src/index.ts`：prompt 不切 dist、不做能力包（79-§6.5“其余 12 个不发布”）；Node 24 在工作区按 realpath 可剥离 TS，registry 安装则不可——因 `private:true` 不发布，此限制不构成对外承诺。
- **IO/状态/错误**：N/A——manifest 不执行任何运行时代码；无 IO、无状态、无错误路径。可观测面仅是包管理器/tsc 对声明的解析结果。
- **验证与证据**：以 `bun install` 后 `bun run typecheck` + `bun run test` 为证据；**本附录未执行**。回退：恢复 `zod` 行即可（无代码引用，零行为差）。
- **迁移顺序**：单独一刀只改 manifest；不与新增文件混提；改后核对 `bun.lock` 与 `node_modules` 解析（不改 lock 内容的说明由实施单负责）。**注意顺序**：`zod` 移除（M1）与 `contract` 运行期化（M3）是两刀，不得混提——前者可用 `typecheck`+`test` 单独验证，后者需要 `contract` 的 `ports/secret.ts` 前置。

### 5.2 `F-prompt-tsconfig`

- **路径/处置**：`packages/prompt/tsconfig.json`；目标-保留；5 行；预算 ≤8。
- **内容**：`extends ../../tsconfig.base.json`；`include: ["src/**/*.ts","test/**/*.ts"]`。继承 NodeNext、strict 全开、`erasableSyntaxOnly`、`verbatimModuleSyntax`、`noEmit`、`allowImportingTsExtensions`（`tsconfig.base.json:1-33`）。
- **职责**：包级类型门禁，且**把 test 纳入**（与 core/adapters 先例一致）。**非职责**：不产生构建产物；不参与根 program 的 include（根 `tsconfig.json:4` 只含 `packages/*/src/**/*.ts`）。
- **已知门禁缺口（〔事实〕）**：根 `package.json:18` 的 `typecheck` 只跑根 `tsc --noEmit`，**没有**串接 `packages/prompt` 的包级脚本；因此 `test/**` 的类型错误不会被根脚本发现。这是 79-D10 已登记的缺口，处置归 82（可先加 `typecheck:test`），**本文不改脚本**。prompt 不是“切 dist 包”，其 `src` 仍在根 program 内，故不需要“src 退出根 program + 包级 typecheck 并入根脚本”的切换动作；但 test 门禁仍需 82 统一处理。
- **禁止**：不得加 `paths` 回指 `src`、不得引 `composite`/`references`/`tsc -b`（79-§6.4）。
- **导出与依赖/IO/状态/错误**：N/A——本文件只被 `tsc` 读取，不执行；无导出符号、无 IO、无状态、无错误路径。它影响的只是类型门禁覆盖范围。
- **规模与迁移**：5 行，目标 ≤8；`extends`/`include` 保持不变，不因新增文件改 include（`src/**`、`test/**` 已覆盖）。test 门禁并入根脚本属 82 的脚本变更，不在本文件内完成。
- **验证**：`tsc --noEmit -p packages/prompt/tsconfig.json`（未执行）。

---

## 六、跨文件横向契约

### 6.1 分层与导入（只减不增）

- 包层位 L4（`boundary-rules.mjs:83`）；允许出边仅 `prompt→contract`、`prompt→company`（`:126-127`）。现状 `src` 对 company 零 import，对 contract 仅 `import type`。
- 新增 `secret-boundary.ts` **不新增任何包边**，但**改变既有边的性质**：它从 `@studio-next/contract` 引 `configInvalid`（**运行期**）与 `KnownSecretSet`（**类型**，`import type`）。`prompt→contract` 早已是允许边（`boundary-rules.mjs:127`），因此不需要改方向表、不需要提案；但**不得**以“反正只是 contract”为由去引任何 `core`/`gateway` 面——`prompt→core` 无此边（`:126` 只有 company，`:127` 只有 contract）。**v0.3 收窄**：`redactKnownSecrets`/`findSecretShaped`/`SecretMaterial` 一概不进本包 import 面——算法与取值都在 `KnownSecretSet` 内部。
- **禁止**的替代路径（每条都会被判负）：`prompt→core` 取现成的 `packages/core/src/secrets.ts`；在包内复制三条正则或标记拼接；用 `import type` 假装零运行期依赖（类型擦除后调用会运行期崩）；把集合摊成 `readonly string[]` 再自行扫描（v0.2 的 `SecretBoundaryInput` 即此路）。
- `src` 直下 7 件；不新增域平面散件。若 `layers.ts` 触发拆分，只允许 `src/layers/` 子目录 2 件，`layers.ts` 留 facade。
- 包内方向：`assemble`/`trim` → `layers` → `sanitize`；`assemble`/`brief` → `secret-boundary`（单向，`secret-boundary` **不**引 `layers`/`brief`/`sanitize`）；`brief` 其余独立；`index` 只汇出（且**不**汇出 `secret-boundary`）。禁止反向（如 `layers` 引 `assemble`）。`secret-boundary` 若被反向依赖会造出 `brief→secret-boundary→brief` 的环，因此它的入参**只收 `KnownSecretSet` 与字符串**（不打包层对象、不打包 `layers`/`brief` 的类型）。

### 6.2 IO、确定性与并发

- 全包零 fs / 零子进程 / 零网络 / 零 env / 零时间 / 零随机；唯一运行时内置是 `node:crypto` 的 sha256 与全局 `TextEncoder`。
- 所有易变输入（框架版本、公司快照、部门正文、人事事实、单号/尝试、adapter@ver、预算、`KnownSecretSet`）均参数注入；落盘、通道、事件、记账、`state` 与 `missingSecretIds` 的处置全部归 daemon。
- 确定性口径：同输入同文本、同指纹、同 `SecretBoundaryReport`；双跑断言已在 layers/assemble/brief/sanitize/trim 测试中各存在（未运行），4.7 再补一条“同文本双跑结论相同”。**注意**：集合的内容（已取得哪些值）**不属于**“同输入”的稳定部分（它随部署轮换变化），因此任何“指纹相同 ⇒ 结论相同”的推理在跨轮换时不成立——指纹不覆盖集合；本包也不缓存集合。
- 并发：纯函数无共享可变状态；模块级正则均无 `/g`；无缓存、无重试、无取消、无恢复语义（N/A + 理由：无 IO 与长事务）。

### 6.3 错误面清单（现状裸 `Error` → 目标 `configInvalid`）

| 文件:行 | 现状（裸 `Error`） | 目标 `subcause` | 消息/`detail` 含 | 不含 |
|---|---|---|---|---|
| `layers.ts:242` | 输入正文含层定界标记 | `prompt-layer-marker-smuggled` | `where` 定位串 | 正文内容 |
| `layers.ts:245` | 输入正文含 trim 标记 | `prompt-trim-marker-smuggled` | `where` | 正文 |
| `layers.ts:323` | L1 同一节重复 | `prompt-section-duplicate` | 层 id + 节 kind | 节内容 |
| `layers.ts:401` | L3 同一节重复 | `prompt-section-duplicate` | 层 id + 节 kind | 节内容 |
| `layers.ts:431` | L4 验收口径为空 | `prompt-acceptance-empty` | 层 id | — |
| `layers.ts:434` | L4 文档引用为空 | `prompt-docrefs-empty` | 层 id | — |
| `layers.ts:534` | 层数≠6 | `prompt-layer-count` | 实际层数、期望 6 | — |
| `layers.ts:540` | 层序不符 | `prompt-layer-order` | 位次、实际/期望 id | — |
| `layers.ts:550` | 内容源数≠6 | `prompt-layer-count` | 实际数 | — |
| `assemble.ts:56` | 层正文含层标记 | `prompt-layer-marker-smuggled` | 层 id | 正文 |
| `brief.ts:77` | 验收为空 | `prompt-acceptance-empty` | `'brief'` | — |
| `brief.ts:80` | 文档引用为空 | `prompt-docrefs-empty` | `'brief'` | — |
| `brief.ts:82` | `attempt<1` | `prompt-brief-attempt-invalid` | 实际值 | — |
| `brief.ts:94` | 续跑缺 `resume` | `prompt-brief-resume-missing` | `'brief'` | — |
| `secret-boundary.ts`（目标） | `set.redactKnown` 会改动文本（**只**换已知值，不做形状兜底） | `prompt-known-secret` | 层 id / 字段名 / `'assemble-selfcheck'` / `'brief-selfcheck'` | **值、片段、偏移、哈希、底层异常 message** |
| `trim.ts`（目标） | trim 区标记畸形 | `prompt-trim-marker-shape` | 层 id + 可裁 kind | 正文 |
| `layers.ts`（目标） | 运行期未知 `kind` | `prompt-layer-kind-unknown` | 非法字面值 | 正文 |

〔结论〕目标**不引入** `Result<T,E>`、不新增错误类别：全部走 `contract` 既有的 `configInvalid`（`category='CONFIG_INVALID'`，80-§5.7 目标态 `failure='rejected_precondition'`），调用方（daemon）负责分类与事件。**v0.1 的“本包不引入错误类别、保持裸 `Error`”作废**——裸 `Error` 让 `catch` 方只能读字符串，等于强迫每个调用点解析文案，这与 80-§5.7“错误两轴”直接相抵。现状的 14 处 `throw` 是**待迁移清单**，不是设计目标。

### 6.4 秘密与观测

**来源链（唯一）**：部署侧 `SecretCatalog`/`SecretProvider`（78-§7.4）→ daemon 装配期按 `subjectScope` 过滤、取 `SecretMaterial` → 构建 `KnownSecretSet`（80-§11.2.1，单实例）→ **daemon 把这个对象原样**注入 `assemble`/`brief`（`opts.secretBoundary`，同一引用、同一进程内存）。**链上没有“摊出明文”的一步**：`KnownSecretSet` 只暴露 `secretIds`/`state`/`missingSecretIds` 与 `redactKnown`/`redact`/`find` 三个方法（`80:3092-3099`，值在工厂闭包里，不以属性/参数/返回值出现，`80:3102`），本包因此连明文都拿不到。本包**只消费其中两个能力**：`redactKnown`（判据）与 `find`（诊断）；`redact` 属**出站面**（对外 API、通知、导出、日志、面板），本包不持有、不调用（`80:3155-3161`）。本包**不在链上生产任何一环**：不读 env/文件、不持有 catalog、不派生 `secretId`、不打开 provider、不做轮换/吊销/重建、不缓存。`hrKnownSecrets` 是过渡期字面量（80-§11.2.1-1 记为装配兜底），**不是**本包的来源。

**强制出口（本包承担的两处）**：AGENTS.md 文本（进 `engine.ts:997`/`:1002` 落盘）与任务书文本/`TaskBrief`（进 executor）。这两处被 80 归为**内部供给面**，判定方法指定为 `redactKnown`（`80:3161`）：两处的判定都是**只读**——`set.redactKnown(text) !== text` 即拒绝产出，**不改写**。因此本包不发生“脱敏后指纹/字节重算”这类问题——输出要么逐字节等于层内容 + 包装，要么不产出；也不发生“含 commit sha 就被拒”的误伤（形状兜底不在 `redactKnown` 里）。

〔v0.4 澄清·出口口径，替代 v0.2/v0.3 的 G1 记账〕80-§11.2.1 的调用边界表把面分成三类：出站 5 点（日志、API 错误体、外部响应、Matrix 通知、导出物）→ `redact`；内部落笔 4 点（事件 `note`/`last_error`、REPORT、DSH 事件、人工复核材料）→ `redactKnown`；**内部供给 2 点（提示词、任务书 `TaskBrief` 正文）→ `redactKnown`**（`80:3155-3161`）。本卷承担的正是第三类的那两点，故 v0.2/v0.3 记的“prompt 出口不在九处强制点、需 80 回写一句（G1）”与“判据粒度待裁”两问**均已关闭**：方法由 80 点名，不需要本卷自选，也不需要新增“只判已知值”的能力——`redactKnown` 本来就是它。另注 `find`：80 明文规定它只做诊断/测试断言，`find(text).length > 0` **不得**成为拒绝条件（`80:3108`、`80:3164`）。

**边界（不得越级声称）**：

- 现有结构性保证：`brief.ts` 逐字段构造 `TaskBrief`，**从不**带 `credentials`；层源类型无凭据字段；`objective`/`acceptance`/`docRefs` 等文本位由调用方注入。
- 现有缺口：L0/L1/L3/L4/L5 正文与续跑摘要**没有任何运行期秘密闸**（§1.3）；`sanitized` 计数未被消费。
- 本包的判定能证明的是“**这份产出不含长度 ≥`MIN_KNOWN_LENGTH=6`、且已声明 `secretId` 的已知值**”（`set.redactKnown` 未改动）。**不能**证明“无秘密”：清单只覆盖声明的 `secretId`；短值不判（§3.7-2）；未声明的凭据、编码变形、非常规形一律不认；`known-set-empty`/`known-set-partial` 时集合可能为空或不全，本包只回传 `state`，是否允许出站归装配根。形状只作诊断（`find`）：它的命中**不构成**拒绝理由，它的零命中**也不构成**安全证明（`80:3164`、`80:3165`）。
- `<redacted:N>` 在本包**不产生**（本包不写文本），标记语义原样继承 `contract`（不重定义、不外传）；下游不得把它当可还原编码。
- `KnownSecretSet` 是**脱敏派生集合**，不是秘密权威副本，也不构成 `REC-*`；prompt 对它只读、不缓存、不持久化、不派生任何数组。

**观测**：本包不写日志、不发事件、不打指标；错误消息里不出现值/片段/偏移（§6.3）。`SecretBoundaryReport` 是**返回值**，是否落事件、如何只记“命中 N 次 + kind”归 daemon（77 事件 + 78-§7.4 出口表）。**形状计数不得当泄漏证据**，也不得反过来当“无泄漏”的证明；daemon 若想按 `shapeHits` 告警，那是观测面动作，**不得**回灌成拒绝条件（`80:3164`：`find` 不是门禁）。

### 6.5 指纹与裁剪的记账边界

- 指纹是**展示与关联**，不是内容身份、不是签名、不是版本权威（`TS-SCALAR-08`，`80:350`）：`sha8` 无密钥且 8 位截断；L0 用框架版本号；L4 无内容 rev（已知语义债）。`layerFingerprints` 只回“改一层只动一段”的对照，不证明层未被篡改，也不得作去重键/缓存键/比对依据——身份一律是 `contract` 的 `semanticDigest`（G14）。
- 因为本包**不改写文本**，`text` 恒等于“六层内容 + 包装”，`fingerprint` 与 `layerFingerprints` 天然与 `text` 同源：不存在“脱敏后指纹未重算”不一致的可能（v0.1 设计需要重算，正是因为它在改写；§1.2 已撤销）。**代价**是：命中已知秘密时整份产出作废，而不是“悄悄换成标记继续发”。
- `trim` 只改正文并重算受影响层指纹；L4 的 t 段因此不随裁剪变化——冻结格式的结果，不是 bug 修复点。**顺序 = `trimLayers → assembleAgentsMd`**：先裁后闸，闸看到的就是最终文本；若反过来，裁掉的正文永远不会被判定，等于给“先塞秘密再裁掉”留了绕过路径。
- `trim` 的预算不含包装开销；daemon 的预算闸另用 `briefChars`（`engine.ts:1025`，`assembled.brief.text.length`）计算，与 `trim` 的总量口径**不同**。两者不得互相冒充（G9）。
- `sanitize`（命令形态剥离）与秘密判定是两件事、两个位置：`sanitize` 在开层时按 `untrusted` 标志运行，秘密判定在出口运行；**不得**用 `sanitize` 的 `stripped` 计数冒充秘密命中数。

### 6.6 提示词不是授权

- L0–L5、AGENTS.md、任务书、persona 都是**上下文**（78-§2.4 判为软限制）；它们不产生授权、不构成验收、不证明资格。
- `TaskBrief.credentials` 是凭据通道（77-§3.4），不是权源；`brief.ts` 不构造它，daemon 在 launch 前另行附加（`engine.ts:1052-1055`），适配器透传，prompt 全程不接触。
- 测试只证明文本形态；不能证明“模型会遵守”，也不能作为“已满足某授权条件”的证据。
- **秘密闸通过 ≠ 有权调用**：`KnownSecretSet` 存在、`redactKnown` 未改动、`scanned=true` 都只是“文本面能出站”，与权域、资格、平台写许可无任何推导关系（78-§7.4.1 与 80-§11.2.1 同一口径：`load` 成功 ≠ 有权调用，provider 与 redactor 都不是授权或秘密事实源，`80:3168-3172`）。反之，本包**拒绝**也只说明文本面不过闸，不构成“越权”结论、不产生 `REC-*`、不改变单的状态。
- **提示词通过扫描 ≠ 授权或安全证明**（本节的结论，不是修辞）：① 授权读岗位/权责链（§3.5 与 `TS-PORT-AUTH-*`），不读提示词、不读 `scanned`；② 安全上本闸只覆盖“已声明 `secretId`、长度 ≥6 的已知值”，清单外凭据、短值、编码变形全不判（`80:3165`“无命中 ≠ 绝对安全”）；③ `scanned=true` 只记录“本包按 `redactKnown` 跑过一遍”这个事实，既不等于“产出无秘密”，也不等于“该 worker 有权做这件事”。任何对外表述不得把这三件事合并成一句。

---

## 七、缺口与需回写清单（不得由本附录私补）

| # | 缺什么 | 现状证据 | 应回写 | 影响 |
|---|---|---|---|---|
| G1 | ~~prompt 出口是否属“强制脱敏点”未裁决，且判据粒度未定~~ **已关闭（v0.4）**：80-§11.2.1 的调用边界表把“内部供给 = 提示词、任务书（`TaskBrief` 正文）”逐点点名划给 `redactKnown`，并明文写 `find` 不得当门禁；v0.3 记的两问（① prompt 出口是否在强制点内、② 是否需要“只判已知值”的新能力）都已由 80 答定——②的答案是“已有，就是 `redactKnown`”，**不需要**新增接口 | 80 调用边界表 `80:3155-3161`（内部供给 → `redactKnown`；出站 5 点 → `redact`；内部落笔 4 点 → `redactKnown`）；分工表 `80:3104-3108`；判据句 `80:3110`；`find` 非门禁 `80:3164`；无命中不等于安全 `80:3165` | 无需回写（80 已定）；本卷只须保持口径一致 | **关闭**：§3.7 判据改为 `redactKnown`，§3.7-4 的“形状兜底误伤 40/64 位 hex / 上线阻塞”整段删除；**M5 不再被本条阻塞** |
| G2 | **层类型的归属未定**：`LayerSource`/`PromptLayer`/`TrimmableRegion`/`LayerId` 留在 `prompt` 还是升 `contract` | `layers.ts:12-13` 自注“拟升”；80-§6.8（`80:2175`）只保留 `PromptAssembler`，未提这些类型 | 80-§6.8/§12.3（明确归属）、若升格走提案流 | 跨包公共类型与版本；本卷按“留在包内”设计，升格会改本卷 6 处签名 |
| G3 | **L1 内容源解析器无归属**：`prompts/company.md` 的使命/方向/战役/身份如何变成 `CompanyPromptSection[]` | 模板有 `templates/*/prompts/company.md`；`prompt-assembly.ts:145` 恒传 `sections: []` | 80-§2.1（组件归属）或 04-company 附录 | L1 真实内容从未进入提示词（§1.3） |
| G4 | **L3 六节解析器无归属**：`people/<工号>.md` 的六节如何变成 `PersonFactSection[]` | `prompt-assembly.ts:154` 只传 `position` 一节 | 同 G3 | 画像/技能/做过的事从未进入提示词 |
| G5 | 76 是否应为“提示词节/档案节”提供 `DEF-*` 对象；若是运行产物，应由 80 明确“非公司定义” | 76 全卷无对应对象；70-§7.1（`70:833`）只说 `prompts/` 不是权源 | 76 或 80 | 避免把运行时文本反写成公司规范 |
| G6 | **外部可写文本的信任级未定**：① `summary.json` 的 conclusion/changed_files/rejection_reason 与意图 `note`；② `objective` 来自平台单据标题（`prompt-assembly.ts:157`）；③ 真单刀后 `acceptance` 来自单据字段 | `brief.ts:96-113` 原样插入；C2-10 只覆盖“网页可编辑内容”；`prompt-assembly.ts:157/182` 用 `issue.title` | 01-C2-10（口径扩到摘要/意图/单据标题）、77（来源记录）或 80 | 上一轮文本或任意建单人可往下一轮一等指令位写字；目标建议走 `sanitizeUntrusted`，**需批示** |
| G7 | L4 教训 `lessons` 的来源与信任级；`untrusted` 在 L4 源上不存在 | `L4TaskSource.lessons` 无 `untrusted`；daemon 恒传 `[]`（`prompt-assembly.ts:163`） | 77-§8（记忆端口 `TS-PORT-MEM-01`）、80-§6.6（`MemoryStore`） | 知识库接入时无法声明信任级 |
| G8 | **验收口径是接线缺口，不是缺记录类型**：`REC-WORK-03.acceptance_criteria` 已有定义，但运行链取配置常量 | `77:883`（字段定义）；`serve.ts:1000` 的 `acceptance` 取值与 `:867` 的 demo 常量（本次复取 `serve.ts:1000` 仍为 `config.acceptance !== undefined ? [config.acceptance] : ACCEPTANCE`）；`80:2237` 说 `TaskBrief` 不是合同 | 16/17（接线）、80（口径） | L4 验收“按单冻结”未落地 |
| G9 | `trimLayers` 零生产调用；且**三种预算口径并存**：层正文 chars（`trim`）、AGENTS.md UTF-8 bytes（`engine.ts:1099`）、任务书 chars（`engine.ts:1025`） | 全仓 grep `trimLayers` 包外零调用；无配置项 | 16/17（接线）、80/82（预算口径归一） | C2-09 只有库与单测；`withinBudget` 从未被读 |
| G10 | `AssembleResult.sanitized` / `layerBytes` / `layerFingerprints` 无落点；C2-10 检测事件与 C2-11 字节清单未记账 | `engine.ts:1099-1100` 只算 `size`/`payload_hash`；三字段包外零读取 | 16/17（记账）、77（事件类型） | “已记事件/清单”只停在返回值 |
| G11 | 包级 test 类型门禁未并入根脚本（79-D10） | 根 `package.json` 的 `typecheck` 只跑根 `tsc`；根 `tsconfig.json:4` 只含 `packages/*/src/**` | 82 | `test/**` 类型错误可漏；本卷新增的两件测试都在 `test/`，**正落在盲区** |
| G12 | 真实 executor 的 prompt cache breakpoint 支持度、compact 重注入行为未证 | `index.ts:35` TODO 未勾 | 78/82（探针） | 无法声称“抗压缩”已成立 |
| G13 | C2-09 末级“L3 自述/L5 长文档转按需检索”是**检索机制**，不是文本裁剪，无归属 | `index.ts:34` TODO 未勾；`trim.ts` 三阶之后只能 `withinBudget=false` | 77（`RecordReader`/检索面）、80 | 预算极端时无第四阶 |
| G14 | **内容身份摘要无实现归属**：`semanticDigest` 的 canonicalization（JCS）未证；本包只产 `sha8` | 80-§4.1 `TS-SCALAR-08`（`80:350`）+ U80-01（JCS 未证）；本包 `sha8` 用法见 §6.5 | 82（探针/实现归属）、80 | 任何“指纹=内容身份”“按指纹去重”的说法都不成立 |
| G15 | **80 事实错误**：80-§6.8 表内写 `PromptAssembler` “`engine/prompt-assembly.ts`（类型在 `prompt`）”（`80:2183`；v0.2/v0.3 记 `80:1965`，行号已漂移） | 源码：`PromptAssembler` 接口定义在 `apps/daemon/src/engine/prompt-assembly.ts:88`；`prompt` 包无该类型（包内 grep 零命中） | 80-§6.8（改这一行） | 会让读者以为 prompt 承担装配器契约 |
| G16 | **`TaskBrief.budgetCap` 与标量口径冲突**：`Money.usd: number` 只允许内存计算，不得进公共签名/记录契约 | 80-§4.1 `TS-SCALAR-09`（`80:351`）；`brief.ts` 把 `budgetCapUsd: number` 映射成 `budgetCap` 并渲染 `$<n>` | 80（`TaskBrief` 字段改 `{amount: DecimalString; currency}` 或明确豁免）、01-contract | 一旦真单传预算就写出不合口径的公共形状；本包不自行换算 |
| G17 | `DISPATCH` 事件 note 携带 `wkey` nonce 原值 | `engine.ts:1102` 的 `note` 含 `wkey=env:…:nonce=${minted.nonce}`；80-§11.1 第 6 条只禁 `Result.E`/日志/错误 `message`，未提台账 note | 16/77（note 面口径）、80-§11.1（补一句“台账 note 同禁”） | 台账长期存 nonce 原值；不在本包范围，但不得被本包“已开闸”掩盖 |
| G18 | **secret-boundary 的顺序依赖未被排期**：需要 `contract/src/ports/secret.ts` 落位（81-01 登记、未实现）＋ daemon 侧集合构建（含 `redactKnown` 方法本身）与 `scanned=false` 拒写 | 80-§11.2.1 自述未实现；`80:3364` U80-18（明文记“`redactKnown` 作为 `KnownSecretSet` 方法尚不存在”）；`packages/contract/src/ports/` 现无 `secret.ts`（本次 `ls` 复核）；`serve.ts` 仅有 `hrKnownSecrets` 字面量 | 82（波次排序）、16/17（装配根） | 顺序错则本包只能“建件零调用”，或被迫引入第二实现；G1 关闭不改变本条——**判据口径已定，但集合与接线仍未落位** |

---

## 八、迁移顺序、验证与回退

> 全部步骤均为**目标设计**；每一步单独提交、单独验证；不得把多步合成“重写”。验证命令沿用仓内既有口径（`bun run typecheck`、`bun run test`、`bun run guard:boundaries`），本附录**未执行**。

| 步 | 动作 | 触及文件 | 验证证据 | 回退 |
|---|---|---|---|---|
| M0 | 本文过审。**需先有结论的**：G2（层类型归属）、G5（76 是否给 prompt 节对象）、G6（摘要/单据标题信任级）、G15（80-§6.8 那一行的更正）、G16（`budgetCap` 口径）。G1 已由 80-§11.2.1 关闭，**不再阻塞本文过审** | 无代码 | 文档审查记录 | — |
| M1 | manifest 移除 `zod` | `package.json` | `bun install` 后 `typecheck`+`test`；lock 差异核对 | 恢复该行 |
| M2 | **外部前置（不在本包）**：`contract/src/ports/secret.ts` 落位（81-01 的 `F-contract-port-secret`；集合实现复用 `F-contract-secrets`；G18）——集合须含 `redactKnown`/`redact`/`find` 三个方法（`80:3092-3099`） | `packages/contract/src/**`（另一附录） | `packages/core/test/secrets.test.ts` 原样通过；`core` 只留具名 re-export；`KnownSecretSet` 的 `redactKnown`/`redact`/`find` 均有实现且可由测试构造替身；**`redactKnown` 不得等于 `redact`**（前者不做形状兜底） | 不落位则 M3 不可开 |
| M3 | 新增 `secret-boundary.ts` + `secret-boundary.test.ts`（**零调用**：`assemble`/`brief` 未改，行为零变） | 2 个新文件 | 新测试全绿；既有 56 个 `it` 零变；`guard:boundaries` 行数/目录不超；**确认无 `prompt→core` 边**、无 `redactKnownSecrets`/`findSecretShaped` import | 删两文件 |
| M4 | `assemble`/`brief` 接 `opts.secretBoundary`（可选，类型=`KnownSecretSet`）+ 结果回 `secretBoundary`；`layers.ts` 导出 `containsLayerMarker`；删除 `assemble.ts` 冗余再导出；**daemon 同批**把集合实例原样传参并在 `scanned=false` 时拒绝写盘 | `assemble.ts`、`brief.ts`、`layers.ts`、`apps/daemon/src/engine/{prompt-assembly.ts,engine.ts}`、`assembly/serve.ts`（后三者另一附录） | 不传 `opts` 时输出逐字节等旧；已知值命中 / 形状不阻断（40 位 hex 原样保留 + `shapeHits>=1`）/ 自检 / `scanned=false` 四类用例；daemon 侧“`scanned=false` 不落盘”负向用例 | 去掉 `opts` 与结果字段（回到 M3） |
| M5 | 翻必填：删除 `scanned=false` 分支，`scanned` 恒 `true`；daemon 未传参即编译失败。**无外部前置**（G1 已由 `80:3155-3161` 关闭，判据是 `redactKnown`，不含形状兜底） | `assemble.ts`、`brief.ts` + 测试 | 类型面无可选参数残留；`scanned` 恒真；判据路径上只出现 `redactKnown`（grep 确认无 `set.redact(` 调用） | 回 M4（**不得**长期停留） |
| M6 | daemon 在派发前调用 `trimLayers`，预算来自配置；顺序固定 `trimLayers → assembleAgentsMd` | daemon（另一附录） | 超预算夹具下 `cuts` 落账、验收块逐字节不变；同时命中秘密与超预算的复合夹具 | 停止调用（回到今天行为） |
| M7 | L1/L3 内容源解析器落地（G3/G4 定归属后） | 归属包（company 或新件） | 解析正反例；空节/重复节拒；真实模板快照对拍 | 回到空节/单节 |
| M8 | 续跑摘要/`note`/单据标题的信任级处置（G6 定后） | `brief.ts`、`layers.ts`（L4 `objective`）+ 测试 | 注入句被标注为非指令；旧夹具按新口径整段更新 | 恢复原样插入 |
| M9 | 指纹语义债（L4 rev、W 段）与内容身份（G14）如需修改 | `layers.ts` + 测试 | 需先有批示；新旧指纹对照表；`semanticDigest` 归属明确 | 保留冻结式 |
| M10 | `TaskBrief.budgetCap` 口径（G16 定后） | `brief.ts` + `contract`（另一附录） | 公共形状不含 `Money.usd`；渲染不自行换算 | 不传该字段（现状） |

**完成判据（本包层）**：M3/M4 后 `src` 7 件、`test` 7 件；`src`/`test` 直下均 ≤25；无文件 >600 行（`layers.ts` 555、`assemble.ts` ≤140、`brief.ts` ≤200、`secret-boundary.ts` ≤120）；`prompt→contract` 是唯一包边（company 仍零 import），且已从 **type-only 变为 type + 运行期**（运行期只有 `configInvalid`）；`secret-boundary` 不从 `index.ts` 导出；新增件零 fs/env/网络、零 `SecretMaterial` 读取、零明文派生；既有 56 个 `it` 不因重构改变语义（旧夹具不含秘密、也不含 32+ 连续 token，判定不触发），新增 **27** 个 `it` 覆盖：`redactKnown` 改动即拒（assemble/brief 各一）、形状**不**阻断（40 位 hex 原样保留 + ULID 对照 + `find` 命中不改变结论）、两处出口自检（`assemble-selfcheck`/`brief-selfcheck`）、标记走私、`scanned=false`、trim 标记畸形。以上是**目标验收**，当前**一条都未验证**（M2 未落位；G1 已关闭，M5 无额外前置）。

> 顺序铁律（v0.2 修订）：M2 → M3 → M4 → M5 是硬序列。M3 可以在 M2 之后立即落地（零调用、零行为变）；M4 起才让 `prompt→contract` 变运行期边，因此 M4 必须与 daemon 侧同批。**允许**的中间态只有一个：M4 的“可选 + `scanned:false` + daemon 拒写”，且有负向用例；**不允许**的中间态是“可选 + 缺省照常落盘”——那等于把默认态设成 fail-open，判负。M5 之后库里不得再出现 `scanned=false` 的路径。
>
> 顺序铁律（v0.3 追加，v0.4 修正）：M5 曾被视为“必须等 80 对判据粒度作出裁决”的步骤；**该前置已解除**（80 已把内部供给面指定给 `redactKnown`，`80:3155-3161`）。仍然成立的是**反方向的纪律**：M5 只能删分支、不得同时改判据；若有人把判据从 `redactKnown` 换回 `redact`（或私自给 `redactKnown` 加形状兜底）来“凑过用例”，判负——判据的唯一源是 80-§11.2.1 的分工表（`80:3104-3108`）。

---

## 九、未证与不做

**未证（不得写成支持）**：

1. AGENTS.md 在真实 executor（dsh/claude/codex/kimi）中的注入、compact 后重注入与 prompt cache 行为——本包只产文本；`index.ts:35` 自注未测。
2. `trimLayers`、`sanitizeUntrusted`、`assertNoKnownSecret`/`secretShapeCounts` 在生产派发中的任何效果——`trim`/`sanitize` 当前**零调用**，`secret-boundary` 连文件都还不存在。
3. 真实公司目录（`prompts/company.md`、`people/*.md`）能被正确映射为层内容——没有解析器（G3/G4）。
4. 指纹能证明内容未被篡改或用作内容身份——`sha8` 无密钥、8 位截断、非签名；L4 无内容 rev；`TS-SCALAR-08` 明禁（G14）。
5. **秘密“不出现”**——只能做到“这份产出里不含集合 `redactKnown` 认识的已知值”。以下五项**未证**，不得写成支持：① 清单完整性（只覆盖声明的 `secretId`；`known-set-empty`/`known-set-partial` 也合法）；② 短值不判（<6 字符）；③ 未知秘密不存在（未声明的凭据、编码变形、非常规形都不判；`find` 只认 bearer/assignment/long-token 三形且**不作门禁**）；④ **“闸通过 ⇒ 无秘密”不成立**——`redactKnown` 未改动只等于“没有已声明、≥6 字符的已知值”，`80:3165` 明文“无命中 ≠ 绝对安全”；⑤ 已落盘的历史文件不含秘密（本包不读盘）、第三方 executor/适配器/平台不记录。
6. 本包**不产生** `<redacted:N>`：判定为命中即拒绝，不写出标记。因此“标记里的 `N` 泄露长度”这个取舍在本包不发生——但也不能因本包不写标记就声称“产出无长度侧信道”，因为其它出口（走 `redact` 的出站面）仍在写标记（80-§11.2 的取舍未变）。
7. 出口**未全覆盖**：本包只承担 80 调用边界表的“内部供给”两点（提示词、任务书，`80:3161`）；出站 5 点与内部落笔 4 点都不在本包（分别归 `redact` 与 daemon 的落笔点）；G17（`DISPATCH` note 带 nonce）仍在本包之外。任何“出站已完全脱敏”的说法都是越级。
8. 任何测试已在本次审查中执行——**本次未运行** `tsc`/`vitest`/`bun install`/daemon；外部前置 M2（`contract/src/ports/secret.ts` 与集合实现）未落位，故 §3.3/§3.4/§3.7 的目标改动连类型检查都没跑过。
9. 跨实现互操作、真实进程回放、V3–V6——均未执行；本包测试只到 V0/V1 与部分 V2（纯函数行为）。
10. **本包不生产内容身份摘要**：`semanticDigest`/`canonicalizationId` 归 `contract`（`TS-SCALAR-08`），JCS 规范化本身在 80 仍列 U80-01 未证。§6.5 的“指纹只作展示”不是谦辞，是口径。
11. **“命中即拒”对派发可用性的一笔代价（v0.4 只剩一笔）**：轮换/吊销后旧值在 24h 去重窗内仍进集合（78-§7.4-4），若旧值存在于 L3/L4 历史文本，派发会被连续拒绝。v0.3 记的第二笔（形状兜底误伤 40/64 位 hex）已随判据改为 `redactKnown` **消失**。仍**未设计、未测**的是：续跑/重试语义、告警面、人工处置路径与该轮换窗的豁免口径——不得声称“只是安全上收紧、无可用性代价”。
12. **“提示词通过扫描 ≠ 授权或安全证明”**（§6.6 的结论在本节复述）：`scanned=true` 只说明本包按 `redactKnown` 跑过一遍；它不证明产出无秘密（见第 5 条）、不证明持有权（授权读岗位/权责链）、不产生 `REC-*`、不改变单的状态。

**明确不做（本附录范围内）**：

- 不写生产代码、可执行 schema、构建/测试脚本；不改 manifest/lock；不装依赖；不 git 操作；不启动服务。
- 不把 `LayerSource` 升格为 contract（G2 未决）、不新增 `TS-PORT-*`、不新增错误类别或状态；**不**定义 `SecretCatalogEntry`/`SecretProvider`/`KnownSecretSet`/`SecretMaterial` 的任何字段（那是 78-§7.4/80-§11.2.1 的落点，81-01 已登记），也**不**在 `contract` 另起路径。
- **不**复制脱敏算法（三条正则、`MIN_KNOWN_LENGTH`、`<redacted:N>` 拼接、负前瞻）；**不给** `SecretShapeFinding` 加 kind；**不**接受裸值数组形式的“秘密清单”入参，也**不**接受任何“从 `SecretMaterial[]` 摊出明文”的包内包装类型（v0.2 的 `SecretBoundaryInput` 已在 v0.3 删除，见文首）；入参**只有** `KnownSecretSet` 本身（§3.7）。**不**改判据口径：判据只有 `redactKnown`（内部面），`redact` 归出站面、`find` 只诊断——三者不得互换、不得合并（`80:3104-3108`）。
- 不拆 `layers.ts`（未超限）；不新建域平面散件；不提高任何阈值。
- 不替制作人决定：`known-set-partial` 在派发期的处置、摘要/单据标题的信任级（G6）、300 字上限、L4 指纹是否加内容 rev、`budgetCap` 的公共形状（G16）、包级许可。**G1 已不在本列**——80-§11.2.1 已定（`80:3155-3161`），不属于待裁事项。
