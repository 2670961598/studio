# V2·13 · 技术细节：TypeScript 工程与依赖

> 头注：**v2，替代 docs/79**（docs/79 转历史·非现行，头注标「历史·非现行，由 v2/13 替代」）。
> 版本：v2.1-final｜日期：2026-10-28（原 v2.0-draft 2026-10-27）｜编写：最高宰相（TypeScript 工程与依赖卷撰写子代理·GLM-5.3）｜修订依据：2026-10-28 制作人开工令（docs/49）＋修订令摘要 2026-10-28 修订令 §1.1-§1.8 与 §1.7 测试口径（明细见卷末「修订记录（2026-10-28）」）｜性质：V2 细节九卷之一的现行规范草案——**运行时与工具链约束、依赖登记与工程决策文档，本卷不写任何生产代码**。
> 上位：v2/00（宪法与写作纪律/冻结门）、v2/09（全库 ID 族与决策主表总册——本卷 DEP-/DEC-13-/TOOL- 三族登记于此）、v2/05（分域权威表）。现状事实源（只读引用）：AGENTS.md §三/§四、根 `package.json`、`.mise.toml`、`scripts/guards/boundary-rules.mjs`。
> 平级与下游：v2/10（zod 作参考 authoring 的语义面）、v2/11（记录形状与错误通道载体）、v2/12（宿主/系统 git/存储绑定面）、v2/14（运行时端口与装配落点）、v2/15（安全面：出站扫描/密钥）、v2/16（构建文件与 `files` 白名单的逐文件落位）、v2/17（未证项执行与验证矩阵）。
> 主要输入：v1 docs/79 v0.3（素材，按 84b §5.1 重映射不默认继承；其依赖矩阵经 GLM H3b 对 bun.lock/import 图/双运行时探针逐条复核**全部属实**——版本照录）；docs/75 §六（依赖条目模板）与 §十（实锁基线索引）；84 裁决三（**MIT 已拍**）；84b 抉择 8（全量重写、不写生产代码——本卷是工程约束非代码）；H3b-P1-3/P2-2、DSF L3-H（P1×4+P2×8+P3×1）、C4a/C4b（根与依赖侧）、G1（D 裸号族/DEP 族/版本口径）。
> 状态：**final——DSF 复查已过（F8，2026-10-30，v2/17 §六.2/§七）；制作人 2026-10-30 签认定稿（v2/17 §六.1、docs/49）；施工按 `docs/49` 2026-10-28 开工令 §3 与 F8 并行**（F8 外部签认不阻断施工）。
> 本卷主问题：**运行时与工具链受哪些机械约束、每个第三方依赖以什么证据准入与登记、分层宪法在工程面如何机械落位、测试分层如何防止自证、许可证口径是什么。**

---

## 〇、读法与边界

### 0.1 职责边界

| 关系 | 本卷义务 | 本卷不做 |
|---|---|---|
| 对 v2/09 | DEP-/DEC-13-/TOOL- 三族唯一登记处；枚举与 ID 总表归 09 | 不重述他卷 ID 字面量 |
| 对 v2/10 | zod 的工程用法约束（DEC-13-11） | 对象字段与 schema 语义归 10 |
| 对 v2/11 | 错误通道构造器的工程依赖面 | `failure/category/subcause` 记录形状与 14 值词表归 11 |
| 对 v2/12 | DEP-DSH/DEP-SYSTEMGIT/DEP-NODE 的版本与许可事实 | 绑定损失、探针清单、能力替换归 12 |
| 对 v2/14 | 工具链约束是运行时装配的前提 | 端口定义与端口-文件映射归 14 |
| 对 v2/15 | 出站扫描的依赖侧（redact 纯函数） | fail-closed 清单与秘密面归 15 |
| 对 v2/16 | 双轨构建与 `files` 白名单的约束规则 | 逐文件契约与 MIG 波次归 16 |
| 对 v2/17 | 未证项登记（§八） | 执行与验证矩阵归 17 |
| 对 AGENTS.md | 以其 §三/§四为现状事实，**统一口径粗细**（§1.4） | 不改 AGENTS.md 本体（其修订按 v2/00 §一；**施工时点＝MIG-04 入口前**——plan/03 §十三，docs/86 B6） |

### 0.2 标注与版本口径

- 〔事实〕＝仓内文件/锁文件/官方资料/已复现探针支持，附路径或版本锚点；〔选择〕＝可替换的工程方案；〔结论〕＝由上位规范或运行时机械规则推出；**目标（未证）**＝机制未建成，禁止「已保证/机制保证」语气。
- **版本口径**：一切依赖版本以 `bun.lock` 实锁为准（H3b 已逐行核对，本卷照录），「manifest 声明范围」与「实锁」两列分列不得混写；75-§十 的简写（Zod 4.6.x 等）只作索引；不采用 `latest`，registry 当前版本仅在「不采用项」作对照。运行时/工具版本以 `.mise.toml` 为唯一源。
- **证据命令口径**：本卷一切 `node`/`bun`/`tsc` 证据命令一律写 `mise exec -- <cmd>`；裸命令（交互 shell PATH 解析）只算开发便利，其输出不作证据。取证 shell 裸 `node` 是系统 PATH 的 v25.6.1（`node:sqlite` 3.51.2、打 ExperimentalWarning）——非目标环境，不作验证证据。
- 统计口径：本卷引用的仓内统计全部注明口径（src/test 分列、命令范围）；v1 中不可复现的计数（`satisfies`/`now:`/`process.env`/`node:child_process` 处数）**不照录**（治 L3H-10）。

### 0.3 前缀族

- `DEP-`：第三方包、运行时、外部二进制与工具——**唯一主表在本卷 §二**（沿用 v1 名称式 ID；G1 已核全库零撞号；v1 的 DEP-EXECA-10/09 双条归并为 DEP-EXECA 一条，22→21，与 v2/00 §四口径一致）。
- `DEC-13-NN`：工程类决策（卷域编号，收编入 v2/09 决策总表时 ID 不变；制作人六项 D1-D6 的重编号归 v2/09，本卷只给工程类）。
- `TOOL-NN`：工具链约束条目（本卷引入，登记 v2/09 ID 总表）。
- 迁移 `MIG-`、验证 `V-` 归 v2/16/v2/17，本卷只引用不新造。

---

## 一、运行时与工具链约束（TOOL- 族）

### 1.1 运行时分工（TOOL-01）

〔事实〕工具链钉在 `.mise.toml:3-5`：`node = "24.21.0"`、`bun = "1.4.3"`（随仓走，主仓与所有 worktree 泳道自动继承）。双运行时探针（H3b 与 DSF L3-H 各自独立复现，结论一致）：

| 运行时 | 版本 | `process.features.typescript` | 内建 SQLite | 备注 |
|---|---|---|---|---|
| Node（mise） | 24.21.0 | `strip`（只擦除） | 3.53.4 | `node:sqlite` 无 ExperimentalWarning |
| Bun（mise） | 1.4.3 | `transform`（会改写语法） | 3.51.0 | 自报 `process.versions.node` 26.3.0（兼容层） |

〔结论〕**Node 24.21.0 是唯一执行运行时**（daemon/boot/CLI 一切生产入口只用 `node` 启动）；**Bun 1.4.3 只作包管与脚本壳**（`bun install`、`bun run <script>`、开发期直跑便利）。三条硬理由（均已有探针证据）：

1. `transform` 与 `strip` 语义不同：`enum` 在 Bun 下可跑、在 Node 24 下报错——**Bun 的绿灯不能证明 Node 可跑**；Node 下的行为才是 daemon 的事实。
2. 内建 SQLite 版本不同（3.51.0 vs 3.53.4）：台账是唯一投影，`STRICT` 表/JSON 函数/错误码不保证等价。
3. Bun 自报 node 26.3.0 会绕过 `engines.node` 声明性检查（见 TOOL-05）。

〔选择〕配套冻结：任何 `Bun.*` API 一律拒收（全仓 grep `\bBun\.` 零命中，**已有**约束）；`bun build --compile` 产出是换运行时的单文件，**不是** Node 等价分发，只作独立 CLI 分发的另审候选（DEC-13-12）。

### 1.2 可擦除语法清单（TOOL-02）

〔事实〕Node 24 官方规则（nodejs.org latest-v24.x typescript 文档）＋本仓探针逐条复现：

- **允许**（可擦除）：类型标注、`interface`、`type` 别名与联合、泛型、`as` 断言、`satisfies`——擦除后不改变运行时语义的构造。
- **禁止**（非可擦除，需 `--experimental-transform-types`，本仓不用）：`enum`；含运行时代码的 `namespace`；参数属性（constructor 属性简写）；import alias。装饰器不转换（TC39 Stage 3），直接解析失败。`.tsx` 不支持。
- **硬要求**：相对 import 必须写全 `.ts` 扩展名（漏写即 `ERR_MODULE_NOT_FOUND`）；类型导入必须显式 `import type`；Node 不读 `tsconfig.json`（`paths` 等一律无效，最近替代是 `#` subpath imports）；**Node 拒绝处理 `node_modules` 目录下的 TS**（`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`）。
- 〔事实〕全仓 1257 处相对 import 全部带 `.ts` 扩展名、零漏（grep 口径：排除 node_modules，正则统计＋反向检查；两族审计均复现）。

〔事实〕`tsconfig.base.json` 的 `erasableSyntaxOnly: true` 是上述禁令的**机械保证**（编译期即红），不是靠自觉；全仓 grep `enum`/运行时 `namespace`/参数属性/装饰器/`: any` 零命中（**已有**）。AGENTS.md §三「只写可擦除语法（禁 enum / namespace / 参数属性 / 装饰器）」与本条口径一致。

### 1.3 tsc 类型门禁（TOOL-03）

〔事实〕单一基线 `tsconfig.base.json`，全量严格开关（行号见 v1 §1.3，DSF 逐行核对一致）：`strict`＋`noUncheckedIndexedAccess`＋`exactOptionalPropertyTypes`＋`noImplicitOverride`＋`noFallthroughCasesInSwitch`＋`noUnusedLocals`/`noUnusedParameters`＋`erasableSyntaxOnly`＋`verbatimModuleSyntax`＋`isolatedModules`＋`allowImportingTsExtensions`＋`noEmit`＋`skipLibCheck`/`resolveJsonModule`/`forceConsistentCasingInFileNames`；`target/lib` ES2024、`module/moduleResolution` nodenext、`types: ["node"]`（不引 DOM）。

〔选择〕**不设第二套宽松配置**：包级 `tsconfig.json` 一律 `extends ../../tsconfig.base.json`，只在 `include`/`exclude` 有差异（现状 17 份均如此）；测试不放宽 `strict`（测试断言的是语义，放宽即改变标尺）；`skipLibCheck` 已在基线，不得再往下放。根门禁 `bun run typecheck`（= `tsc --noEmit`，只跑根 program——覆盖口径见 §1.4）。

### 1.4 类型门禁覆盖三态口径（TOOL-06，统一粗细）

〔事实〕AGENTS.md §三「根 `tsconfig.json` 覆盖全部包」是 **src 层面的简化表述**。统一口径为三态（H3b-P2-2、DSF L3H-01、C4b-P2-4 三方核实一致）：

| 覆盖面 | 事实 | 门禁调用 |
|---|---|---|
| 根 program | 覆盖 `apps/*/src/**/*.ts` 与 `packages/*/src/**/*.ts` 全部 src，含 32 个 `src/*.test.ts` | `bun run typecheck`＝根 `tsc --noEmit`，exit 0（已有） |
| `test/` 目录 | 全仓 185 个 `.ts`（`*.test.ts` 177＋夹具/冒烟 8）；**147 个不在任何 program**（daemon 86/company 21/panel 18/store 16/taiga 3/contract 2＋dsh-bridge smoke 1） | 无 |
| 包级 program | 仅 4 个包级 tsconfig `include` 含 `test/**`（adapters/core/prompt/dsh-bridge，后者 exclude 了 smoke），已列入 38 个文件 | **零调用**；且 3 包当前红（core 36 / adapters 6 / prompt 19 个 TS 错，样本 `core/test/judge.test.ts:13` 的 TS1543 JSON import attribute） |

〔结论〕「入 program」≠「已覆盖」：包级 program 无任何门禁调用且 3/4 已红。**处置写死两段：先修红（core/adapters/prompt 各一条，含 5 处缺 `with { type: "json" }` 的 `cases.json` 导入：`contract/test/schemas.test.ts:33`、`contract/test/contract.test.ts:7`、`core/test/judge.test.ts:13`、`company/test/deps-cases.test.ts:11`、`company/test/dir-cases.test.ts:8`）→ 再串 `typecheck:test` 门禁**。全部为目标（未证），落位 v2/16/17；不得写成「17 包全串」或「已切四个带 test 包」。AGENTS.md §三的对应修订（补 test 门禁缺口口径、§二 store 行删「+ drizzle」）登记为 V2 定稿后统一办理项，**施工时点按 plan/03 §十三：MIG-04 入口前（docs/86 B6）**；本卷不改 AGENTS.md 本体。

〔2026-10-28 口径同步〕测试政策以 **`docs/plan/04` 为准**（修订令 §1.7）：V2 开工 tag 之前已有＝旧测试、之后新增＝V2 新测试；**旧测试不作为施工门**（须逐文件台账登记，37 红逐条归属），MIG-02 不再以「61 个 TS 错清零／全量回归绿」为出口；G2 门＝源码 typecheck＋guard＋V2 新套件。故本节的「先修红→串 `typecheck:test`」降为 test 面类型门的**目标项**，不作为施工出口判据；上述 36/6/19 与 61 计数只作现状事实记录，判据以 plan/04 为准。

### 1.5 包管、版本唯一源与版本不变量（TOOL-04/05/07）

**包管（TOOL-04）**：〔事实〕bun workspaces（`workspaces: ["apps/*","packages/*"]`）；`bun.lock` 文本锁（`lockfileVersion: 2`），140 个 tarball URL 全指 `registry.npmmirror.com`、每条带 `sha512` 完整性。〔结论〕镜像要分两层说：可用性（锁依赖镜像可达，不可达时 `--frozen-lockfile` 失败是特性）与信任（镜像是第三方分发点，完整性校验防篡改但不证明上游发布者）——发布能力包时不得把镜像 URL 写进包内文档或脚本。〔目标（未证）〕显式声明 `trustedDependencies`（哪怕空数组）：现状仓内无该字段（事实），等价于按 Bun 内置白名单执行安装脚本——不可控的第三方白名单；CI 用 `mise exec -- bun install --frozen-lockfile`。

**版本唯一源与三层检测（TOOL-05）**：〔事实〕`.mise.toml:4-5` 是 node/bun 版本唯一源；根 `engines.node: ">=24"`、`packageManager: "bun@1"` 均比 mise 钉死的宽（漂移，目标收紧 `>=24.21 <25` 与 `bun@1.4.3`）。〔结论〕**`engines` 只是声明性提示，不构成检测**：实测 bun 1.4.3 对 `engines.node: ">=99"` 的工程 `install` 退出码 0 且零提示；npm 也只打 EBADENGINE 警告、退出码 0（DSF L3-H 探针）。版本不变量的真闸三层：①安装期＝统一 `mise exec --`（版本由 mise 选定）＋ `.mise.toml` 随仓走；②启动期＝进程入口读 `process.versions.node` 与 `process.features.typescript`，不满足即 fail-fast（写明期望与实际）——**目标（未证）**；③验收期＝证据记录带 `mise exec -- node -v`/`bun -v`/`tsc -v` 三项并与 `.mise.toml` 对照，不一致即作废。不满足就拒绝启动，不降级运行（strip/transform 差异会改变语义，降级会把「环境错」伪装成「实现对」）。

**证据通道（TOOL-07）**：〔事实〕eval/stdin 有已复现的调用差异——默认 `node -e` 可擦除类型，显式 `--input-type`（module/commonjs）则不经擦除路径（加 `--experimental-strip-types` 不恢复）；官方预期表述与上游 issue 状态未核（归 v2/17）。〔结论〕生产验证一律用 `.ts` 文件，不把 eval/stdin 当证据通道；README Quickstart 的裸 `bun <file.ts>` 属开发便利，验收时须以 `mise exec -- node` 等价重跑（登记 v2/17）。

**无构建链开发态（TOOL-08）**：〔事实〕daemon 由 Node 24 原生 type-stripping 直接执行 `.ts`（`bun run daemon` 脚本体实为 `node apps/daemon/src/index.ts`——脚本壳已把运行时交回 Node）；不引 tsx/ts-node/bundler。测试执行器 vitest 的 bin 首行 shebang 为 `#!/usr/bin/env node`（`bun run test` 的 bin 派发语义未直接证明——EVCH-1b node 直跑测试为目标，登记 v2/17；治 L3H-08）。

### 1.6 源码/分发双轨约束（摘要；逐文件落位归 v2/16）

〔结论〕双轨不可省：**源码轨**＝Node 24 直跑 `src/**/*.ts`（仓内开发/测试/daemon）；**分发轨**＝`tsc` 发射 `dist/**/*.js`＋`*.d.ts`（npm/DSH 消费者）。硬理由是 Node 拒绝 `node_modules` 下的 TS（TOOL-02）；`link:` 本地安装 realpath 在 `node_modules` 外、TS 能跑，但结果取决于安装方式——不作分发承诺，`dist` 是唯一与安装方式无关的保证。约束清单（详细论证与陷阱见 docs/79 §五–§七，历史素材；施工口径以下列为准）：

1. **切换硬前提**：一个包可切 dist ⇔ 其全部 workspace 依赖已切 dist 或零 workspace 依赖（`rootDir:"src"` 拓扑）；首条可证链 `dsh-bridge → contract → gateway → studio-tools`（L0 起逐级，`studio-tools` 最后）；闭包外的仓内私有包维持 src，一刀切切 dist 是负收益。
2. **切换是包级原子动作**：同一单内同步改根 `tsconfig.json` include、该包 `exports`/`files`、包级 tsconfig（仍 `include: ["src/**/*.ts"]`），并把包级 `tsc --noEmit -p` 显式串入根 `typecheck`——**当前切换集为空**，不得把候选首链写成已切。
3. **构建配置契约**：`tsconfig.build.json` `extends ../../tsconfig.base.json`（**不是**包级 tsconfig——须显式写 `include`/`exclude`，防把测试编进产物逼 vitest 成运行时依赖；治 L3H-05）＋显式 `noEmit:false`/`declaration:true`/`rewriteRelativeImportExtensions:true`。三个已证陷阱：`noEmit` 被继承＝退出 0 零产出；`noEmit`+`emitDeclarationOnly` 同真＝零产出退出 0；`.d.ts` 内说明符不重写（TS 5.9.3 源码＋探针）。
4. **三种失败形态禁绝**：src/dist 双身份混用（双模块实例）、条件导出混两轨（`development` 指 src）、`paths` 混两轨。陈旧 dist＝直接失败：构建闸含源码指纹登记与比对（`dist/.build-stamp.json` 形态：sourceSha256/tsconfigSha256/node/tsc/builtAt，构建前重算比对，不等即失败）——**目标（未证）**，落 v2/16/17（治 L3H-04）；`--listFiles` 只作拓扑断言（产物不含本包外 workspace 源码），不作新鲜度证据。
5. **dsh-bridge 路径消费**：现状 daemon 以 4 级相对路径推导插件源（`instructions-store.ts:72`，布局即接口，漂移）。目标二选一并写死「是否新增包边」：①数据面——dsh-bridge 把入口路径写进 `package.json#dsh`/补丁 YAML，daemon 只读文件不 import（保持冻结的零模块入边）；②提案加边 `["daemon","dsh-bridge"]`（同步 manifest/方向表/基线，走 §3.1 提案流）。私自改边表或退回路径推断都判负（治 L3H-03）。
6. **发布面**：`files` 白名单四类（dist/数据文件/README/LICENSE），不用 `.npmignore` 黑名单；`exports` 每条目 `types` 先于 `import`、子路径完整枚举、无 `"./*"` 通配；**ESM-only**（不提供 `require` 入口，CJS 消费者须 `await import()`；CJS 负测归 v2/17——DEC-13-13）；**CJS 拒绝面**：CJS 消费者经 `exports.require` 拒绝（`ERR_ESM_ONLY`，包根 `require-reject.cjs` 只抛错、消息含包名与 use import），不走 dist/CJS 构建；不引 `npm-shrinkwrap.json`（存在即随包发布，会把消费者钉死）；发布候选保存 `npm pack --dry-run --json` 原始 JSON 逐项核对（体积上限与 npm 必带文件例外表由 v2/16 定数值）；发布前四项扫描（秘密/本机路径/map sources/锁文件不进包）——秘密面与 v2/15 对齐。分发复现三级（值集 v2/09 ENU-133，ID 族＝09 §一-63）：REP-1 可重装（**已有**：锁＋完整性）→ REP-2 可重建（目标）→ REP-3 可复算（目标）；未达 REP-3 不得声称「构建可复现」。

---

## 二、依赖矩阵（DEP- 族，唯一主表）

### 2.1 准入与登记规则

1. **默认拒绝新依赖**：未在 §二登记的包不得进 manifest（DEC-13-09）；新增先补 DEP 条目（九字段齐）再改 manifest。
2. **模板**（75-§六，九字段）：ID/名称｜使用位置（哪个包/文件、src/test 分列、**未用须标注**）｜版本（声明范围/bun.lock 实锁/来源分列）｜用途与不可替代性｜兼容与边界｜安全与许可｜替代与退出｜规范影响｜证据。
3. **版本与许可**：实锁照录 `bun.lock`（行号锚点）；许可取包内 `license` 字段并注明包内有无 LICENSE 文件；运行时外部物（git/DSH）单列。
4. **使用包清单以 import 图为准**（H3b 逐条复核过），声明未用的按「装饰性依赖」标注并挂 §2.6 清理项。

### 2.2 总表（21 条）

| ID | 对象 | 声明 | 实版本（来源） | 性质 | 使用包 | 许可 | 结论 |
|---|---|---|---|---|---|---|---|
| DEP-NODE | Node | `>=24`（根 engines） | 24.21.0（.mise.toml:4） | 运行时 | daemon/boot/CLI | Node 许可（MIT 类） | 保留；声明收紧 |
| DEP-BUN | Bun | `bun@1`（packageManager） | 1.4.3（.mise.toml:5） | 开发 | 装包/脚本壳 | MIT | 保留为壳 |
| DEP-TSC | typescript | `^5.9.0` | 5.9.3（bun.lock:475） | 开发 | 类型门禁/构建 | Apache-2.0 | 保留 |
| DEP-TYPES-NODE | @types/node | `^24.0.0` | 24.19.2（bun.lock:351） | 开发 | 全部（`types:["node"]`） | MIT | 保留 |
| DEP-VITEST | vitest | `^3.0.0` | 3.2.7（bun.lock:485） | 开发 | 测试 | MIT | 保留（§四） |
| DEP-ZOD | zod | `^4.0.0`（多包） | 4.6.7（bun.lock:497） | 运行时 | 8 包（见逐条） | MIT | 保留 |
| DEP-YAML | yaml | `^2.0.0`/`^2.6.0` | 2.9.1（bun.lock:493） | 运行时 | company/core/adapters | ISC | 保留 |
| DEP-HONO | hono | `^4.6.0` | 4.13.13（bun.lock:401） | 运行时 | panel；**api 声明未用** | MIT | 保留；api 清理 |
| DEP-CRONER | croner | `^9.0.0` | 9.1.0（bun.lock:375） | 运行时 | daemon（scheduler.ts:42 唯一） | MIT | 保留 |
| DEP-EXECA | execa | `^10.0.0`（adapters）；`^9.4.0`（daemon） | 10.1.1（:389）；9.6.1（:499，daemon **零使用**） | 运行时 | adapters 4 文件 | MIT | 保留 10.x；9.x 目标移除 |
| DEP-SIMPLEGIT | simple-git | `^3.27.0`（3 包） | 3.36.0（bun.lock:451） | 运行时 | company src；daemon/adapters 见逐条 | MIT（**包内无 LICENSE 文件**） | 收缩 |
| DEP-MCP-SERVER | @modelcontextprotocol/server | `^2.3.1`/`^2.0.0` | 2.3.1（bun.lock:249） | 运行时（studio-tools）/开发 | studio-tools src；daemon test；api **未用** | Apache-2.0 | 保留 |
| DEP-NODESQLITE | node:sqlite | 无（内建） | 3.53.4（Node 内建，`process.versions.sqlite`） | 运行时 | store | 随 Node（SQLite public domain） | 保留；experimental 登记 |
| DEP-DRIZZLE | drizzle-orm | 无 | **无锁**（本地残留 0.44.7 安装物） | — | 零 | Apache-2.0 | 不采用 |
| DEP-AJV | ajv | 无 | 无（registry 8.20.0 仅对照） | — | 零 | MIT（registry） | 不采用 |
| DEP-SEMVER | node-semver | 无 | 无（registry 7.8.5 仅对照） | — | 零（自写受限解析） | ISC（registry） | 默认不采用 |
| DEP-DSH | @deepseek-ai/dsh | 无（PATH 外部 CLI） | 0.2.0-rc.2（代码常量 LOCKED_VERSION） | 运行时（外部） | adapters/dsh | MIT（registry，联网复核归 v2/17） | 保留；绑定面归 v2/12 |
| DEP-NODESTDLIB | `node:*` 标准库 | 无 | 随 Node 24.21.0 | 运行时 | 全仓 | 随 Node | 首选 |
| DEP-SYSTEMGIT | 系统 git | 无（外部二进制） | 未锁（宿主决定） | 运行时（外部） | company（经 simple-git） | GPL-2.0（外部调用，不链接不分发） | 保留；外部依赖 |
| DEP-VITE-ESBUILD | vite/esbuild | 无（传递） | 7.3.7（:481）/ 0.28.2（:385） | 开发（传递） | 仅 vitest 链，零直接 import | MIT/MIT | 仅测试链 |
| DEP-VENDOR-BROWSER | Vue/Naive UI/ECharts（进仓 vendor） | 无（非 npm） | 3.5.44 / 2.45.3 / 6.1.0（vendor.lock.json） | 运行时（浏览器） | panel 页面（importmap 直引） | MIT/MIT/Apache-2.0（LICENSES/ 三文件已核） | 保留 |

### 2.3 逐条（九字段）

#### DEP-NODE —— Node 24.21.0
- **使用位置**：daemon/boot 唯一运行时、CLI 正式启动器；`node:sqlite`/`node:http`/`node:crypto` 提供方。**使用包**：apps/daemon、apps/boot。
- **版本**：声明 `engines.node: ">=24"`（根 package.json:14-16，过宽——目标收紧 `>=24.21 <25`）；实 24.21.0（.mise.toml:4）。
- **用途与不可替代性**：ESM 语义、原生 type stripping、`node:sqlite`。Bun 不是替代（§1.1 三理由）。
- **兼容与边界**：`process.features.typescript='strip'`；不读 tsconfig；拒 node_modules 下 TS；`.tsx` 不支持；`node:sqlite` Node 24 文档标 Stability 1.2（实验性登记，长跑稳定性归 v2/17）。
- **安全与许可**：Node 本体许可（MIT 类，附第三方声明）；无动态求值面。
- **替代与退出**：无（换运行时＝换绑定，另审归 v2/12）。升级 24.x 内随 mise；跨大版本重跑验证。
- **规范影响**：实现内部；Node 版本进 v2/12 绑定档案。
- **证据**：nodejs.org latest-v24.x typescript/sqlite 文档；双族探针（24.21.0）。

#### DEP-BUN —— Bun 1.4.3
- **使用位置/使用包**：`mise exec -- bun install`、`bun run <script>`、开发期直跑；根 scripts 四项。
- **版本**：声明 `packageManager: "bun@1"`（过宽）；实 1.4.3（.mise.toml:5）。
- **用途与不可替代性**：workspaces 安装、任务壳、`workspace:*` 解析——Node 侧无等价物（npm/pnpm 是另一工具，不在选型内）。
- **兼容与边界**：`transform` 语义、报 node 26.3.0、内建 SQLite 3.51.0（§1.1）；1.4.3 的 `node:child_process` 兼容面数字未复核——只据此得「Bun 不承担子进程编排」的保守结论。
- **安全与许可**：MIT；默认不执行依赖生命周期脚本（按内置白名单——见 TOOL-04 trustedDependencies 目标）。
- **替代与退出**：可换 npm/pnpm（成本＝换锁、改脚本、重验 workspace 解析）；不承诺。
- **规范影响**：无（纯实现）。
- **证据**：bun.com docs pm/lifecycle、pm/workspaces；探针 1.4.3。

#### DEP-TSC —— typescript 5.9.3
- **使用位置/使用包**：根 `typecheck` 与目标构建轨；每包 `typecheck` 脚本。
- **版本**：声明 `^5.9.0`；实锁 5.9.3（bun.lock:475）。
- **用途与不可替代性**：类型门禁（TOOL-03）、`.d.ts` 发射、`rewriteRelativeImportExtensions`。类型门禁是本仓契约的一部分，不可替代。
- **兼容与边界**：`erasableSyntaxOnly` 需 ≥5.8、rewrite 需 ≥5.7（本仓按 5.9.3 用）；rewrite 开启时 `allowImportingTsExtensions` 可与发射共存（编译器源码 `typescript.js:129305`、`:21900-21903` 已核）；声明发射不重写 `.ts` 说明符（`:119060-119070`，消费者兼容探针三组 module/moduleResolution 组合全绿，bundler/checkJs 未证归 v2/17）。
- **安全与许可**：Apache-2.0（包内 LICENSE.txt）；构建期执行，属可信工具链。
- **替代与退出**：无。升级＝重跑门禁＋复核选项交互。
- **规范影响**：无。
- **证据**：typescriptlang.org tsconfig 文档与 5.7 release notes；本地编译器源码行号。

#### DEP-TYPES-NODE —— @types/node 24.19.2
- **使用位置/使用包**：全部 TS 文件（`types: ["node"]`）。
- **版本**：声明 `^24.0.0`；实锁 24.19.2（bun.lock:351；传递 undici-types 锁 7.24.6）。
- **用途与不可替代性**：`node:sqlite`（sqlite.d.ts 实测存在）、`node:http` 等类型。
- **兼容与边界**：须与运行时大版本对齐（24.x），跨代会出现「类型有运行无」。
- **安全与许可**：MIT（DefinitelyTyped）。
- **替代与退出**：无。
- **规范影响**：无。
- **证据**：bun.lock:351；本地包 sqlite.d.ts。

#### DEP-VITEST —— vitest 3.2.7
- **使用位置/使用包**：根 `test` 与各包测试；`src/*.test.ts` 与 `test/**`。
- **版本**：声明 `^3.0.0`；实锁 3.2.7（bun.lock:485；依赖 vite `^5||^6||^7`→7.3.7、esbuild→0.28.2）。
- **用途与不可替代性**：五层测试统一执行器（§四；AGENTS §四已定）。
- **兼容与边界**：直接跑 `.ts` 源不经 tsc；`--passWithNoTests` 只防零测试假绿，**不作通过证据**。
- **安全与许可**：MIT；测试运行器执行被测代码（本来就要执行）。
- **替代与退出**：可换 `node:test`（成本＝重写断言风格）；不提议。
- **规范影响**：无（测试工具不进公共规范）。
- **证据**：bun.lock:485；根 package.json:20。

#### DEP-ZOD —— zod 4.6.7
- **使用位置/使用包**：contract（4 文件）、company（6）、core（2）、gateway（2）、store（5）、yt（8）、adapters（1）、studio-tools（2）。
- **版本**：声明 `^4.0.0`（多包）；实锁 4.6.7（bun.lock:497；MCP SDK 依赖 `zod ^4.2.0` 同锁）。
- **用途与不可替代性**：信任边界形状校验（业务输入 `strictObject` 77 处、外部响应 `looseObject`、契约清单 `z.object` 例外 2 处）；`~standard.jsonSchema`/`z.toJSONSchema` 供 MCP SDK 转 JSON Schema——**已有**（studio-tools 生产已用：`server.ts:60`、`tools.ts:333`，测试覆盖 tools/list；治 L3H-12）。
- **兼容与边界**：JSON Schema 生成**只许离线**生成冻结工件＋漂移检查；**禁止** `z.fromJSONSchema()` 反向生成、禁止运行时重新生成权威工件（DEC-13-11）。
- **安全与许可**：MIT（包内 LICENSE）；无 eval。
- **替代与退出**：手写守卫（成本高易漏，不提议）；zod 大版本破坏 `~standard` 时 MCP 工具面重验。
- **规范影响**：不进公共规范；是 v2/10 语义的**参考 authoring**，冻结工件是 JSON Schema。
- **证据**：zod.dev/json-schema；本地 standard-schema.d.ts:86、external.d.ts:11。

#### DEP-YAML —— yaml 2.9.1
- **使用位置/使用包**：company（13 处）、core（2）、adapters（1）。
- **版本**：声明 `^2.0.0`（adapters）/`^2.6.0`（company/core）——下限不一致，目标统一 `^2.6.0`（§2.6）；实锁 2.9.1（bun.lock:493）。
- **用途与不可替代性**：`LineCounter`＋`parseDocument`（行号诊断——`DirectoryIssue.line` 的前提）、`parse`（小文件）。js-yaml 无行号 AST 等价物。
- **兼容与边界**：`type: commonjs`（NodeNext 可解析）；不执行标签；**别名/锚点与规模上限须自建**（YAML bomb 负测归 v2/17）。
- **安全与许可**：ISC（包内 LICENSE）。
- **替代与退出**：js-yaml（无行号方案，不提议）。
- **规范影响**：无。
- **证据**：bun.lock:493；company/validator.ts 头注（行号方案）。

#### DEP-HONO —— hono 4.13.13
- **使用位置/使用包**：panel 四文件（`server.ts`、`overview/server.ts`、`external/server.ts`、`static.ts`；含 `hono/streaming` 的 `streamSSE`）；**api 声明未用**（api/package.json dependencies 含 `hono ^4.6.0`、src 零 import、仅 `index.ts:35` 注释提及——装饰性依赖，清理项 §2.6-2；治 H3b-P1-3）。
- **版本**：声明 `^4.6.0`（panel 与 api）；实锁 4.13.13（bun.lock:401）。
- **用途与不可替代性**：三面 server 的路由与 SSE；`streamSSE`＋Web 标准 Request/Response 使「零 `@hono/node-server`」的自写 `node:http` 适配器成立（panel/server.ts 头注）。
- **兼容与边界**：只用 Web 标准 API；`engines.node >= 16.9`。
- **安全与许可**：MIT（包内 LICENSE）。
- **替代与退出**：`node:http` 手写路由（成本＝重写三个 server）；不提议。`@hono/node-server` 不重开（§2.4）。
- **规范影响**：无。
- **证据**：bun.lock:401；panel/src/server.ts 头注。

#### DEP-CRONER —— croner 9.1.0
- **使用位置/使用包**：daemon，唯一直接 import `apps/daemon/src/engine/scheduler.ts:42`。
- **版本**：声明 `^9.0.0`；实锁 9.1.0（bun.lock:375）。
- **用途与不可替代性**：cron 解析与下次触发（定时岗）；需 5/6 段含秒语义＋时区，company 侧只做形状闸。
- **兼容与边界**：`engines.node >= 18`；零依赖（锁内无 dependencies）；纯计算无 IO。
- **安全与许可**：MIT（包内 LICENSE）。
- **替代与退出**：手写 cron（语义风险）；不提议。分布式调度须重审（归 v2/12）。
- **规范影响**：无（调度语义归 v2/10/11）。
- **证据**：bun.lock:375；scheduler.ts:42。

#### DEP-EXECA —— execa 10.1.1（adapters）/ 9.6.1（daemon 零使用）
- **使用位置/使用包**：adapters 四文件（`dsh.ts`、`claude.ts`、`codex.ts`、`kimi.ts`——执行器名值集 v2/09 ENU-88；8 处 import 含 `type Subprocess`）；**daemon 声明 `^9.4.0` 但 src＋test 零 import**。
- **版本**：声明 `^10.0.0`（adapters）/`^9.4.0`（daemon）；实锁 10.1.1（bun.lock:389）与 9.6.1（bun.lock:499 别名条目 `@studio-next/daemon/execa`）。
- **用途与不可替代性**：执行体 CLI 的启动、流式 stdout/stderr、信号与退出码——四原语需要「流＋取消＋退出码」稳定封装。
- **兼容与边界**：10.x 需 `engines.node >= 22` 且不再依赖 `cross-spawn`；9.6.1 与 10.x 两代并存是**依赖面噪音**（锁体积/审计面/升级困惑），零使用故无行为风险。
- **安全与许可**：MIT；执行外部命令——参数注入面在适配器收口（argv 数组形式，不经 shell）。
- **替代与退出**：`node:child_process`（成本＝重写流/取消）；不提议。daemon 的 9.x **目标移除**（§2.6-4），移除后锁内只剩 10.1.1 一份。
- **规范影响**：无。
- **证据**：bun.lock:389/:499；grep `from 'execa'` 于 apps/daemon 零命中。

#### DEP-SIMPLEGIT —— simple-git 3.36.0
- **使用位置/使用包**：company src 4 文件（`init.ts`/`git-import.ts`/`repo-validate.ts`/`create.ts`）＋company test 4 文件；daemon **仅 test**（`industry-templates.e2e.test.ts`）；adapters 声明但 **src＋test 零使用**。
- **版本**：声明 `^3.27.0`（company/daemon/adapters 三包）；实锁 3.36.0（bun.lock:451）。
- **用途与不可替代性**：公司目录 git 初始化/导入/校验（目录是事实源，必须有 git 语义——读 commit/状态/远端）。
- **兼容与边界**：无 `engines`；CJS 主入口（NodeNext 可解析）；依赖 `@kwsites/*`、`debug`。
- **安全与许可**：包 `package.json` 声明 MIT，但**包内无 LICENSE 文件**（tarball 清单核对）——发布/合规引用前回上游仓库核对（归 v2/17）。系统 `git` 因此成为外部依赖（DEP-SYSTEMGIT）。
- **替代与退出**：`node:child_process` 调 git（重写错误处理）；不提议。
- **规范影响**：无。
- **证据**：bun.lock:451；company/src 四文件；包内目录清单。

#### DEP-MCP-SERVER —— @modelcontextprotocol/server 2.3.1
- **使用位置/使用包**：studio-tools src（`McpServer`/`InMemoryTransport`/`Transport`/工具注册）；daemon **test**（devDep）；**api 声明 `^2.0.0` 未用**。
- **版本**：声明 `^2.3.1`（studio-tools、daemon dev）/`^2.0.0`（api）；实锁 2.3.1（bun.lock:249；core 2.3.1）。
- **用途与不可替代性**：MCP 协议实现（tools/list、tools/call、initialize `_meta`）——自实现 JSON-RPC＋MCP 语义成本高且易漂移。
- **兼容与边界**：`engines.node >= 20`；依赖 `@modelcontextprotocol/core 2.3.1` 与 `zod ^4.2.0`；`StandardSchemaWithJSON` 类型面与 zod 4.6.7 有已知类型缺口（studio-tools 有显式类型桥与退出计划）。`./stdio` 入口是**目标**（现状无 `stdio.ts`、无 `bin`，只有 InMemoryTransport 测试）——归 v2/14。
- **安全与许可**：Apache-2.0（包内 LICENSE）；协议层解析外部输入（工具参数），必须走 zod 校验（已如此）。
- **替代与退出**：自实现 JSON-RPC（成本高）；退出条件＝协议大版本变更。
- **规范影响**：不进公共规范；MCP 工具面归 v2/14。
- **证据**：bun.lock:249；studio-tools/src/server.ts:27-39。

#### DEP-NODESQLITE —— node:sqlite（内建）
- **使用位置/使用包**：store（`driver.ts` 唯一打开点＋migrations/records/usage/cost/pricing/probes）。
- **版本**：无声明；实 3.53.4（Node 24.21.0 内建，`process.versions.sqlite`）。
- **用途与不可替代性**：台账（唯一投影，可重建）；零原生依赖、与 Node 同生命周期。`better-sqlite3` 需编译与 ABI 匹配。
- **兼容与边界**：Node 24 文档标 **Stability 1.2**（实验性登记）；Node 25 打 ExperimentalWarning（非目标环境）；`DatabaseSync` 全同步；WAL/`busy_timeout` 已在 driver 对齐；长跑稳定性（WAL/锁/崩溃恢复）归 v2/17。
- **安全与许可**：随 Node 分发（SQLite public domain）；SQL 全参数化（现状）。
- **替代与退出**：`better-sqlite3`（引擎触点已收口在 driver，一行切换）；切换须重跑迁移与重建演练。
- **规范影响**：不进公共规范；进 v2/12 存储绑定（附可重建投影证明边界）。
- **证据**：nodejs.org latest-v24.x sqlite 文档；store/src/driver.ts；探针。

#### DEP-DRIZZLE —— drizzle-orm（不采用）
- **使用位置**：无（`bun.lock` 零条目；本地 `node_modules/.bun/drizzle-orm@0.44.7` 是残留安装物，不是依赖，不作证据）。
- **版本**：无声明无锁（registry 0.45.4 仅对照）。
- **用途与不可替代性**：**无**——稳定线无 `node:sqlite` 驱动（只在 1.0.0-RC 线）；`drizzle-kit` 不支持 `node:sqlite`；migration 反正手写；ORM 会引入第二套 schema 事实源，与「SQLite 是可重建投影」冲突。
- **兼容与边界**：RC 线不稳定。
- **安全与许可**：Apache-2.0。
- **替代与退出**：已退出（现状＝手写薄 migration＋`schema_version` 表）；**不得**因「以后可能有用」加回。
- **规范影响**：无。
- **证据**：store/src/driver.ts 头注（探测结论）；`grep -c drizzle bun.lock` = 0。

#### DEP-AJV —— ajv（不采用）
- **使用位置**：无。
- **版本**：无（registry 8.20.0 仅对照）。
- **用途与不可替代性**：**无**——冻结 JSON Schema 是交换工件与参考 authoring，运行时判定由 zod/手写规则承担；引入即「schema 一份、zod 一份」双事实源。
- **兼容与边界**：普通运行时编译用 `Function` 构造（动态代码执行，与「定义包无执行内容」冲突）；standalone 模式生成需加载的 JS 模块（把数据变成代码工件）；schema 编译是 ReDoS/资源耗尽入口。
- **安全与许可**：MIT（registry）。
- **替代与退出**：不引入；未来非 TS 消费者校验用「生成→冻结→独立 runner」。
- **规范影响**：**影响公共规范**——冻结 JSON Schema 是交换工件，Ajv 不是其权威解释器（DEC-13-11）。
- **证据**：ajv.js.org standalone/security；manifest 无此依赖。

#### DEP-SEMVER —— node-semver（默认不采用）
- **使用位置**：无。插件版本约束用自写受限解析（company/src/dependencies.ts：`VERSION_SPEC_RE`/`parseVersionSpec`/`satisfiesSpec`，只收 `^x.y[.z]` 与 `x.y[.z]`），17 个契约用例钉住（`contract/cases.json` C-deps-001..017）。
- **版本**：无（registry 7.8.5 仅对照）。
- **用途与不可替代性**：**无**——需要的是「结构化版本比较＋显式子集」，不是 npm 全量 range（`||`/`-`/`x`/预发布/build 边角语义非跨框架规范）；自写子集能精确表达 `^0.x` 锁 minor 这类冻结策略。
- **兼容与边界**：npm range 语义庞大且与冻结策略冲突。
- **安全与许可**：ISC（registry）。
- **替代与退出**：未来要支持 `~`/`>=`/预发布时**扩展自写子集并升版策略**，仍不引包。
- **规范影响**：影响公共规范：公共声明只用结构化 SemVer（DEC-13-10）。
- **证据**：semver.org；dependencies.ts 版本段与头注；company/test/deps-cases.test.ts。

#### DEP-DSH —— @deepseek-ai/dsh 0.2.0-rc.2
- **使用位置/使用包**：**不是 npm 依赖**，PATH 上的外部 CLI。adapters/src/dsh.ts 的 `DSH_DEFAULT_CMD=['dsh','--profile','headless','--json']`、`LOCKED_VERSION='0.2.0-rc.2'` 供 `detect()` 比对；插件侧由 packages/dsh-bridge 提供。
- **版本**：代码常量锁 `0.2.0-rc.2`；registry 元数据（license MIT、`type: module`、`bin.dsh`、exports 面）联网复核归 v2/17。
- **用途与不可替代性**：默认执行体（制作人 D5 定位：DSH 为主、其他也可但明示牺牲——84 裁决一）。
- **兼容与边界**：docs/31/34 有真机注入证据（源码/`link:` 形态）；实体安装（registry tarball）不能依赖 TS 直载，dist 是与安装方式无关的保证（§1.6-1）；绑定细节与损失归 v2/12。
- **安全与许可**：MIT（registry）；执行体是黑盒，凭据只经 env 透传不落配置/日志（现状）。
- **替代与退出**：claude/codex/kimi（执行器名值集 v2/09 ENU-88）三家适配器已存在；换默认执行体另审。
- **规范影响**：进 v2/12 宿主绑定；不进公共规范。
- **证据**：registry.npmjs.org/@deepseek-ai/dsh（元数据）；dsh.ts 常量；docs/31/34 真机报告。

#### DEP-NODESTDLIB —— Node 标准库
- **使用位置/使用包**：全仓。`node:path`（最广）、`node:fs`/`fs/promises`、`node:crypto`、`node:os`、`node:url`、`node:http`、`node:net`、`node:stream`/`stream/web`、`node:child_process`、`node:sqlite`。
- **版本**：随 Node 24.21.0。
- **用途与不可替代性**：一切 IO 与系统能力；零第三方依赖即完成（DEC-13-09 的首选）。
- **兼容与边界**：只用 `node:` 前缀导入（现状零裸 `'path'`/`'fs'` 导入）；不用 Node 24 已标 deprecated 的 API。
- **安全与许可**：随 Node。
- **替代与退出**：无。
- **规范影响**：无。
- **证据**：import 统计（`from 'node:*'`）。

#### DEP-SYSTEMGIT —— 系统 git
- **使用位置/使用包**：company 的 git 操作（经 simple-git）；daemon test 的 e2e。
- **版本**：不锁（宿主决定）。
- **用途与不可替代性**：公司目录的版本化（唯一写入者的 commit 语义）。
- **兼容与边界**：PATH 须有 git；版本差异影响 `worktree`/`sparse-checkout`；Windows 路径/换行另测（归 v2/17）。
- **安全与许可**：git 本体 GPL-2.0——作为外部程序调用，不链接、不随包分发。
- **替代与退出**：`isomorphic-git`（纯 JS，性能/兼容面不同）；不提议。
- **规范影响**：进 v2/12 工作区绑定。
- **证据**：company/src/init.ts 等。

#### DEP-VITE-ESBUILD —— vite 7.3.7 / esbuild 0.28.2（传递）
- **使用位置/使用包**：仅 vitest 依赖链；第一方代码零直接 import。
- **版本**：无直接声明；实锁 7.3.7（bun.lock:481）/0.28.2（:385）。
- **用途与不可替代性**：测试期转换与打包（vitest 自带）。
- **兼容与边界**：vite peer 含可选 `@types/node`/`yaml`（不影响本仓）。
- **安全与许可**：MIT/MIT。
- **替代与退出**：随 vitest 升级，不单独管理。
- **规范影响**：无。
- **证据**：锁文件条目。

#### DEP-VENDOR-BROWSER —— 进仓前端产物
- **使用位置/使用包**：`packages/panel/vendor/`（`vue.esm-browser.prod.js`、`naive-ui.prod.mjs`、`echarts.esm.min.js`），页面经 importmap 直引——零构建、零 CDN、离线可开。
- **版本**：无 npm 声明；实 3.5.44 / 2.45.3 / 6.1.0（`vendor/vendor.lock.json` 记 version/bytes/sha256/source）。
- **用途与不可替代性**：监控页前端壳；无运行时 npm 依赖（docs/37 路线 I）。
- **兼容与边界**：`naive-ui` 裸导入只有 `vue`；`echarts` 已内联 zrender；升级须重算 sha256（`scripts/vendor-pull.mjs` 校验字节与哈希）。
- **安全与许可**：MIT/MIT/Apache-2.0，许可文本在 `packages/panel/vendor/LICENSES/`（三文件已核对存在）。
- **替代与退出**：CDN 或构建链（两条已被 docs/37 否决）；不提议。
- **规范影响**：无。
- **证据**：vendor/README.md、vendor.lock.json、scripts/vendor-pull.mjs。

### 2.4 不采用与不重开项

| 候选 | 不采用理由 | 重开条件 |
|---|---|---|
| drizzle-orm | 稳定线无 node:sqlite 驱动；第二事实源 | 稳定线支持且迁移工具可用（需提案） |
| ajv | 运行时第二事实源；standalone 代码生成 | 仅作离线 runner 可另议（不进 daemon） |
| node-semver | npm range 语义超出公共规范所需 | 扩展自写子集，不引包 |
| tsx / ts-node | Node 24 原生 strip 已足够 | 不重开 |
| @hono/node-server | panel 用自写 node:http 适配器换零额外依赖与可控 SSE | 需要 HTTP/2 等再议 |
| express / axios / dotenv / uuid / 日期库 | 标准库足够（DEC-13-09） | 需提案 |
| bun build --compile | 换运行时与 SQLite | 独立 CLI 分发另审（§1.6） |

### 2.5 版本语法分层

〔结论〕两套语法分开：**安装层**（manifest 的 `^x.y`，npm 语义）属实现内部，不上升为规范，实际解析以锁文件为准；**公共声明层**（v2/10 工件、v2/12 绑定档案）只用结构化 SemVer——精确版本、包含下界、排除上界、显式预发布策略（能表达 `0.2.0-rc.2`），不写 `^`/`~`/`latest`（DEC-13-10）。锁不满足区间或策略即拒绝，不取「最新」。

### 2.6 manifest 一致性与清理目标（只登记，不改 manifest/lock）

现状分类（全部有 import 图证据）与目标处置：

| # | 现状 | 性质 | 处置 |
|---|---|---|---|
| 1 | panel 把 `@studio-next/company` 放 devDependencies，src 有 3 处 import | 分类错误 | 移到 dependencies |
| 2 | api 声明 hono/zod/MCP/company/store/contract，src 零 import | 装饰性依赖 | 随 api 职责迁移裁决（v2/14）决定；端点落地前不留占位依赖 |
| 3 | adapters 声明 simple-git，src＋test 零 import | 死依赖 | 移除 |
| 4 | daemon 声明 execa ^9.4.0，零 import（双代并存） | 死依赖 | 移除（DEP-EXECA） |
| 5 | daemon 声明 zod ^4.0.0，零 import | 死依赖 | 移除 |
| 6 | daemon 声明 simple-git 仅 test 用 | 分类错误 | 移 devDependencies |
| 7 | daemon 声明 api/yt、prompt 声明 company，零 import | 休眠边 | 暂留——移除须同步改 boundary-rules 允许边（提案流）；不得为表格干净私自删边 |
| 8 | adapters 的 yaml 下限 ^2.0.0 低于 company/core 的 ^2.6.0 | 声明不一致 | 统一 ^2.6.0 |

〔目标（未证）〕新增 manifest↔import 图一致性检查三项（死依赖/影子依赖/分类错误），检查口径＝**最小语法锚定**（锚定 `from '<pkg>'`、`import('<pkg>')`、`export … from '<pkg>'` 三类语法并剥离注释/字符串），**不是裸 grep**——裸包名 grep 会把注释里的包名误判（`api/src/index.ts:35` 注释提及 MCP 会假阴性、`store/src/index.ts:78` 注释会假阳性；治 L3H-06）。迁移顺序：先修分类错误→再删死依赖→最后休眠边（提案）；每步单独提交、单独验证，回退＝还原 manifest 重装。

---

## 三、分层宪法在工程面的落位

### 3.1 机械源与修订纪律

〔事实〕`scripts/guards/boundary-rules.mjs` 是分层宪法的**唯一冻结源**（DEV-47/studio-dev-90；宪法正文＝docs/20-§十五，冲突以本文件为准并回改文档）；由 `scripts/guards/boundaries.mjs`（执行引擎）与 `boundaries.test.mjs`（测试面）共用；根 `test` 脚本前置串接 `bun run guard:boundaries`（root package.json:20）——「bun run test 前置串接」是**已有**机制。C4b 对该文件全部陈述实测一致（7 层/13 纵边/16 包层/38 包间边/22 行数基线/25/600 阈/域平面基线）。

〔结论〕修订纪律（采机械源头注口径；治 C4b-P3-1 解读差）：**层位表/允许边/阈值/平面基线/行数基线值的上调与新增＝判据类资产修订＝提案流＋制作人批**（20-§九/§十五）；**基线值下降与条目除名随任意提交顺带办理**（不必提案流）。

### 3.2 daemon 纵轴（包内七层）

〔事实〕`daemonLayers` 七层（数字大者靠上，跨层只准沿 `allowedVerticalEdges` 自上而下，13 条纵边）：`root(6) → cli(5) → assembly(4) → control/evolve/engine(3) → engine/tools(2)`。src 根平面唯一允许散文件 `index.ts`；五域子目录封闭（engine/control/evolve/cli/assembly，新顶层目录＝违例）。域平面基线（contrib 模式，只减不增）：engine 13、control 2、evolve 5、assembly 1；cli/ 不冻结（一命令一模块生长，受通用目录阈约束）；`engine/tools` 直属文件 >10 触发升格 `packages/base` 提示（toolsPromotionFileCount=10）。

〔结论〕工程面含义：daemon 包内依赖方向**单向** `cli → assembly → control/evolve/engine → engine/tools`；新特性＝开 `<域>/<特性>/` 子文件夹，不在域平面加散文件。

### 3.3 包间横轴（16 包层、38 允许边）

〔事实〕`packageLayers`：`daemon(5)` > `panel/api/prompt/studio-tools(4)` > `company(3)` > `store(2)` > `adapters/core/gateway/localplatform/matrix/yt/taiga/dsh-bridge(1)` > `contract(0)`。`allowedPackageEdges` 38 条，**只准高层引低层**，与各包 package.json 声明依赖**并集一致**（daemon→api/prompt/yt 为已声明休眠边，一并冻结为允许）；未列出的跨包依赖＝违例。dsh-bridge 特记：**仓内零模块入边**——daemon 以路径引用消费（`BRIDGE_SRC_REL`，§十五.七不扫）；其目标形态二选一见 §1.6-5。另有包内反向静态边表 `forbiddenImportSpecs`（BC-T1：taiga transport 禁反向引 `../fieldmap.ts`，域映射以结构化类型注入）。

〔结论〕包间依赖单向链：`daemon/cli 装配层 → assembly → engine → packages(≤1 层) → contract(0)`——任何反向边与未冻结层间边即 `guard:boundaries` 违例（先红测试闸再谈合并）。动态 import 同样计入边界扫描（不得以 `import()` 制造表外边）。

### 3.4 尺寸阈与基线棘轮

〔事实〕`maxFilesPerDirectory = 25`（目录直属文件数，超限须切子域）；`maxLinesPerFile = 600`（测试文件在内，不留豁免面）；`lineBaseline` 22 条棘轮（立宪时已超限件的冻结行数，wc -l 口径；最大 `engine.ts` 2337、`ledger.ts` 1684、`serve.ts` 1627）。

〔结论〕棘轮规则：基线内件超基线值＝违例；降至 ≤600 可随任意提交除名；上调/新增＝提案流；**每里程碑对账点核对净变化——只许净减**（清偿义务）。

### 3.5 新包四边登记

〔结论〕新增 workspace 包须在**同一单内**完成四项登记，缺一即 guard 违例或影子依赖：

1. **层位**：入 `packageLayers`（层位决定它能引谁、被谁引）；
2. **允许边**：出入两侧边入 `allowedPackageEdges`（方向＝高层→低层单向；与既有休眠边口径一致地声明是否休眠）；
3. **manifest 声明**：该包 package.json 的 dependencies/devDependencies 与允许边一致（devDependencies 里的 workspace 包若被 src import 按运行期边计——panel→company 教训，§2.6-1）；
4. **一致性验证**：guard 执行引擎＋`boundaries.test.mjs` 测试面同步绿（两处共用同一规则源，改表不同步即测试红）；import 图与三表零违例（§2.6 一致性检查口径）。

层位/允许边/阈值/基线的上调与新增走提案流（§3.1）；「为了过 guard 私改边表」与「绕开 guard 用动态 import」同判。

---

## 四、测试分层约束

〔事实〕AGENTS §四已定：统一 vitest（`bun run test`）；分层为**契约测试（packages/contract，cases.json＋JSON Schema＋runner——规格测试唯一标尺）> 单测（core 纯函数，分支全覆盖）> 集成（fake YouTrack＋fake CLI harness）> 端到端（真实单据）> 崩溃注入（5 个 kill 点）**；`adapters`/`contract` 有独立测试套，可单独开泳道单独跑（改适配器不碰主循环）。

〔结论〕工程约束（本卷落位）：

1. **不许用 LLM 打桩**：fake 一律确定性构造（fake YouTrack/fake CLI harness）；LLM 生成的桩输出不可复现，违反「测试只对契约与冻结验收口径负责」。
2. **测试不钉实现细节**：只对契约与冻结验收口径负责——实现可换、契约不随便动、验收命令冻结后禁改。
3. **测试绿≠能力证明**：fake 全绿、文档可读、多 agent 一致各自不能替代真机与跨实现验证（V 层唯一主表 v2/17）；EVCH-1（源码测试证据）与产物证据（dist/安装/宿主装载：EVCH-2/EVCH-3）不可互替（§1.6；证据通道层级族＝09 §一-62）。
4. **零测试假绿**：`--passWithNoTests` 只防「零测试」假绿；退出码 0 须同时 guard 无违例、测试数 >0。
5. **切 dist 的包先 build 再跑测试**：`exports` 指 dist 后 vitest 走 `exports` 解析，未构建即解析失败——顺序错误不是测试缺陷（当前切换集为空，§1.6-2）。
6. **Node 侧第二条腿**：`bun run test` 的测试入口派发语义未直接证明（vitest bin shebang `#!/usr/bin/env node` 为据）——EVCH-1b「`mise exec -- node node_modules/vitest/vitest.mjs run` 同套件直跑」为目标（未证），与 EVCH-1 分别留证（治 L3H-08）。

---

## 五、许可证

1. **仓级 MIT 已拍**（84 裁决三：「MIT 许可证没问题的」；终裁簿补注「框架仓 MIT 已拍」）。〔事实〕根 `package.json` `license: "MIT"`、仓根 LICENSE 文件存在。84b 抉择 8：79/82 的许可口径**按 MIT 写，不再作为待决项**。
2. **能力包**：〔事实〕现状 17 个 workspace 全部 `private: true`、无 `license` 字段、包内无 LICENSE 文件。〔结论〕随 dist 切换单新增 `LICENSE`（MIT）与 `license` 字段——**不再是待决项**（治 L3H-07 的「许可门无出口」）；`files` 白名单第四类即许可与声明文件。`private` 只防误发，**不等于可发布**：公开范围、命名、支持窗仍归制作人。
3. **仓库公开时点**：维持「待完善版」不变（84 裁决三，制作人保留）。
4. **第三方许可注意点**：simple-git 包内无 LICENSE 文件（上游核对归 v2/17）；Apache-2.0 项（typescript、MCP SDK、ECharts、drizzle 不采用仅对照）随 NOTICE 类声明处置；系统 git GPL-2.0 为外部程序调用，不链接、不随包分发（DEP-SYSTEMGIT）；vendor 三件许可文本已进仓核对。
5. **出站纪律**：仓库与产物不得出现本机路径/内网 IP/真实凭证/真实 MXID（AGENTS 纪律 6）；发布前四项扫描（§1.6-6），秘密扫描走脱敏纯函数（面归 v2/15）。

---

## 六、工程决策表（DEC-13- 族，工程类子集；D 决策总表归 v2/09）

| ID | 决策 | 状态 | 旧 ID 映射 | 依据 |
|---|---|---|---|---|
| DEC-13-01 | Node 24 LTS 唯一执行运行时；Bun 仅装包/脚本壳；无 `Bun.*` API | 已定（现状已有） | D75-07 部分 | §1.1；AGENTS §三 |
| DEC-13-02 | 只写可擦除语法（禁 enum/运行时 namespace/参数属性/装饰器/.tsx）；`.ts` 扩展名全写；`import type` 显式 | 已定（机械保证 `erasableSyntaxOnly`） | 79-§1.2 | §1.2；AGENTS §三 |
| DEC-13-03 | tsc strict 全量严格开关、单一基线、包级只 extends base、测试不放宽 | 已定（现状已有） | 79-§1.3 | §1.3 |
| DEC-13-04 | 开发态零构建链：Node 原生 strip 直跑，不引 tsx/ts-node/bundler | 已定 | D75-07 部分；79-§9.3 | §1.5 |
| DEC-13-05 | bun workspaces＋bun.lock 文本锁；镜像两层口径（可用性/信任）；显式 `trustedDependencies` 为目标 | 已定＋目标（未证） | 79-§11.1/§11.2 | §1.5 |
| DEC-13-06 | vitest 统一；五层测试（契约>单测>集成>e2e>崩溃注入）；fake 禁 LLM 打桩 | 已定 | AGENTS §四 | §四 |
| DEC-13-07 | guard:boundaries 分层宪法门禁（方向冻结＋25/600＋域平面＋棘轮），`bun run test` 前置串接 | 已定（现状已有） | 20-§十五 | §三 |
| DEC-13-08 | 版本唯一源 `.mise.toml`；`engines` 仅为声明性提示**非检测**；真闸＝启动 fail-fast（目标）＋验收三项打印 | 已定（规范面）＋目标（未证） | 79-§1.5 修正（治 L3H-02） | §1.5 |
| DEC-13-09 | 依赖最小化与证据优先：新依赖默认拒绝；准入九字段；`node:*` 首选 | 已定 | D75-10 | §二 |
| DEC-13-10 | 版本语法分层：安装层 npm range 内部化；公共声明层结构化 SemVer（精确锁/含下界/排上界/显式预发布） | 已定 | D75-09 | §2.5 |
| DEC-13-11 | 冻结交换工件、拒绝双事实源：zod 仅参考 authoring；禁 Ajv 入运行时、禁 `z.fromJSONSchema()`、禁运行时重生成权威工件 | 已定 | D75-08 | §2.3 DEP-ZOD/AJV |
| DEC-13-12 | 源码/分发双轨：能力包 dist 由独立 tsc 发射；切换＝拓扑硬前提＋包级原子动作；禁双身份/条件导出/`paths` 混轨；`bun build --compile` 另审非等价 | 已定（切换集为空，机制目标未证） | D75-07 主体 | §1.6 |
| DEC-13-13 | 分发面 ESM-only：`exports` 只给 `types`/`import`；CJS 消费者须 `await import()` | 已定（负测归 v2/17） | 新立（治 L3H-11） | §1.6-6 |
| DEC-13-14 | 框架仓 MIT（已拍）；能力包随切换补 MIT LICENSE；公开时点「待完善版」不变 | **已拍** | D3 工程落位 | §五；84 裁决三 |

注：制作人六项边界（D1 纯配置/D2 权威迁移/D3 公开许可/D4 规范维护/D5 DSH 定位/D6 符合覆盖）的 DEC- 重编号归 v2/09 主表；其中 D3 的工程落位＝DEC-13-14，D5 的依赖面＝DEP-DSH（绑定面 v2/12）。v1 79-§十二 的漂移登记（D1-D16 裸号）在 V2 按本表与 §1.4/§1.5/§2.6 重新落位，不再保留裸号（治 G1-P0-2）。

---

## 七、不做什么（工程面否定式）

1. 不把 Bun 当 daemon 运行时；不用 `bun build --compile` 冒充 Node 等价分发；不写任何 `Bun.*`。
2. 不写非可擦除语法（enum/运行时 namespace/参数属性/装饰器）；不漏 `.ts` 扩展名；不用 `paths`/`baseUrl`。
3. 不设第二套宽松 tsconfig；不为提速关 `strict` 或再放 `skipLibCheck`。
4. 不用裸 `bun`/`node` 输出作证据；不把 Bun 绿灯当 Node 证明；不用 eval/stdin 作证据通道。
5. 不把 `engines` 当检测闸（仅声明性提示）；版本不变量靠 mise＋fail-fast＋验收三项。
6. 不引未登记依赖；默认拒绝新包（§2.4 清单）；不引 Ajv/`z.fromJSONSchema`/运行时重生成工件；不引 npm range 作公共声明层语法。
7. 不把 `private` 当可发布；不把「全部 private」当「都该切 dist」；不在依赖未切 dist 时强行构建；不用放宽 `rootDir`/`skipLibCheck` 绕拓扑断言。
8. 不私改方向表/阈值/基线上调（提案流）；不以动态 import 制造表外边；不为删休眠边单改 manifest。
9. 不把测试绿当能力证明；不用 LLM 打桩 fake；不把「入 program」当「已覆盖」（三态口径 §1.4）。
10. 不在仓库与产物出现本机路径/IP/真实凭证；不把镜像 URL 写进包内文档；不引 `npm-shrinkwrap.json`。

---

## 八、未证项登记（移交 v2/17；未证 ≠ 支持）

| # | 未证项 | 需要的证据 |
|---|---|---|
| 1 | test 门禁三包红修复＋`typecheck:test` 串接（core 36/adapters 6/prompt 19；5 处 JSON import attribute）——**判据以 plan/04 为准**：旧测试不作施工门，改为「逐文件台账＋V2 新套件类型门」 | 修红后逐包 0 错＋新脚本进根门禁（目标项；不作 MIG-02 出口判据） |
| 2 | 启动期版本 fail-fast | 进程入口读 `process.versions.node`/`features.typescript` 与期望比对，不满足拒绝启动 |
| 3 | `engines.node` 收紧 `>=24.21 <25` 后的跨版本验证 | 一次跨版本探针记录（v2/17） |
| 4 | `node:sqlite` 长跑稳定性 | 48h 级运行＋崩溃注入（WAL/锁/恢复） |
| 5 | YAML bomb 防线 | 别名/深度/规模上限负测 |
| 6 | 正则 ReDoS 面 | 每条外部输入正则的长输入负测＋超时 |
| 7 | EVCH-1b node 直跑测试 | `mise exec -- node node_modules/vitest/vitest.mjs run` 与 EVCH-1 同套件分别留证 |
| 8 | CJS 消费者负测（ESM-only 断言） | `require('@studio-next/…')` 预期失败形态实测 |
| 9 | dist 构建产物 spike（首链 EVCH-2/EVCH-3） | `tsconfig.build.json` 建后跑构建＋`--listFiles` 拓扑断言＋build-stamp 陈旧检测 |
| 10 | daemon→dsh-bridge 路径消费二选一落地（§1.6-5） | 数据面读文件或提案加边，任一落单并验证 |
| 11 | simple-git 上游 LICENSE；DSH registry 元数据 | 联网核对原文 |
| 12 | Bun 1.4.3 `node:child_process` 兼容面数字 | 官方兼容表或自测 |
| 13 | Node 显式 `--input-type` 的 eval/stdin 不擦除之官方预期 | 官方文档/issue 原文（调用差异已复现） |
| 14 | README Quickstart 裸 `bun` 命令的验证口径标注 | 文档改为「开发便利＋`mise exec -- node` 等价」（v2/16 文件单） |

---

## 九、审计处置表

| 来源 | 条目 | 处置（本卷位置） | 状态 |
|---|---|---|---|
| H3b-②（正面） | 79 依赖矩阵事实层零错误（锁版本行号/import 图/探针逐条属实） | §二照录并保持 DEP 名称式 ID；execa 双代归一为 21 条（与 v2/00 §四 一致） | 已解（采信） |
| H3b-P1-3 | DEP-HONO 缺「api 声明未用」标注 | §2.3 DEP-HONO 使用位置补标注＋§2.6-2 清理项 | 已解 |
| H3b-P2-2 | AGENTS「覆盖全部包」与 test/ 缺口粗细差 | §1.4 三态口径写死；AGENTS 修订（§三补口径、§二 store 删 drizzle）登记为 V2 定稿后统一办理 | 本卷侧已解；AGENTS 侧登记 |
| DSF L3H-01 | 「入 program＝已覆盖」掩盖零执行＋3 包红＋5 处 JSON attribute 反例 | §1.4 三态＋先修红再串门禁；5 处文件列名＋§八-1 | 已解（登记）；修复归 v2/16/17 |
| DSF L3H-02 | `engines` 收紧被当安装期检测（Bun 实测绕过） | TOOL-05/DEC-13-08：降为声明性提示；真闸＝mise＋启动 fail-fast＋验收三项 | 已解（规范面）；fail-fast 目标（未证） |
| DSF L3H-03 | dsh-bridge「解析器」＝表外新边与冻结零入边冲突 | §1.6-5 二选一写死（数据面读文件或提案加边），并声明是否新增包边 | 方向已定；落地归施工单 |
| DSF L3H-04 | 陈旧 dist 机制不可执行（登记位置/比对/退出码未定义） | §1.6-4 build-stamp 形态＋构建前比对＋`--listFiles` 只作拓扑断言 | 方向已定；目标（未证） |
| DSF L3H-05 | tsconfig.build 的 extends 目标 79↔81 冲突 | §1.6-3 定死 `extends ../../tsconfig.base.json`＋显式 include/exclude；v2/16 按此 | 已解 |
| DSF L3H-06 | 裸 grep 分不清注释/import（假阴/假阳反例） | §2.6 一致性检查改「最小语法锚定」 | 已解（口径）；实现归 v2/16 |
| DSF L3H-07 | 发布许可判据依赖卷外决定、无出口 | §五：MIT 已拍（84 裁决三），许可门不再是待决项；技术清单与许可门分列 | 已解（已拍） |
| DSF L3H-08 | 「§8 双跑项」失效引用 | §四-6 删失效引用；E1b node 直跑为目标＋shebang 事实照录 | 已解（登记） |
| DSF L3H-09 | 「组合根」术语两义 | 本卷不用该词指 daemon 入口；启动自检落点归 v2/14/16 | 登记转卷 |
| DSF L3H-10 | 统计数字口径不可复现 | §0.2 统计全带口径注；不可复现计数不照录 | 已解 |
| DSF L3H-11 | 分发面 ESM-only 未声明 | DEC-13-13＋CJS 负测登记 §八-8 | 已解 |
| DSF L3H-12 | zod `~standard` 四态误标（「库级存在」自相矛盾） | §2.3 DEP-ZOD 标**已有**（studio-tools 生产已用，附行号） | 已解 |
| DSF L3H-13 | 总表「锁」列三种语义混装 | §2.2 表头改「实版本（来源注）」，Node 内建/vendor.lock 各注来源 | 已解 |
| G1-P0-2 | 79-§十二 D1-D16 裸号与制作人 D1-D6 撞形 | §六 DEC-13-NN 卷域编号＋旧 ID 映射；D1-D6 重编号归 v2/09 | 已解 |
| G1-正面/纪律 | DEP 族全库零撞号；卷间 vX.Y 幽灵引用风险 | DEP-ID 沿用并保持唯一；本卷版本一律「声明＋实锁」分列照录、不以他卷 vX.Y 指认事实 | 已解（保持） |
| C4b-宪法核对（正面） | 7 层/13 纵边/16 包层/38 边/22 基线/25/600 与机械源实测全一致 | §三照录 boundary-rules.mjs（不引「guard PASS N 文件」自述数字作证据） | 已解（采信） |
| C4b-P2-4/P3-1/P3-2 | test 计数 177 vs 185；基线除名宽严解读差；guard PASS 为附录自述 | §1.4 写死 185=177 `*.test.ts`＋8 夹具；§3.1 采机械源头注宽严口径；PASS 数字不作证据 | 已解 |
| C4a-包侧（正面） | 逐包 manifest 依赖声明与实测逐字吻合（company 五项等） | §2.3 使用包清单照录 | 采信 |
| 84-裁决三 | MIT 确认；公开时点维持待完善版 | §五＋DEC-13-14（已拍）；终裁簿补注 | 已拍 |
| 84b-抉择 8 | 全量重写、不写生产代码 | 本卷仅工程约束文档；不创建/修改任何生产 TS/JS、构建配置、manifest、lock、测试脚本，不装依赖不跑测试 | 遵守 |

---

## 十、修订记录（2026-10-28）

依据：2026-10-28 制作人开工令（docs/49）＋修订令摘要 §1.1-§1.8（尤其 §1.7 测试口径）、§二-F。版本升 v2.1-draft。

1. **头注**：版本 v2.1-draft；编写者称谓改最高宰相；增列修订依据（含 §1.7 测试口径）。
2. **G9/G8/老板证明/root key：本卷无此类句子**（全卷 grep 核过：无裸「宰相」、无「G9」「G8」「root key」「root_delegation」字样；仅头注/修订记录的「最高宰相」为作者称谓），故无治理句需改；本卷只落运行时/工具链/依赖/测试/许可工程面。
3. **§1.4 新增〔2026-10-28 口径同步〕**：测试政策以 `docs/plan/04` 为准——旧/新测试以 V2 开工 tag 为界，旧测试不作施工门（逐文件台账），MIG-02 不以「61 个 TS 错清零/全量回归绿」为出口，G2 门＝源码 typecheck＋guard＋V2 新套件；本节 36/6/19 与 61 计数只作现状事实。
4. **§八 未证项第 1 行**：补「判据以 plan/04 为准」，修红目标降为 test 面类型门目标项、不作 MIG-02 出口。
5. **未改**：DEP- 21 条、TOOL-01..08、DEC-13-01..14、分层宪法（§三）、测试五层（§四）、许可（§五）、§七 否定式、§九 审计处置表原有条目。
6. **2026-10-28 复核修复（M5）**：§1.4 与 §0.1「对 AGENTS.md」行的修订时点补「**MIG-04 入口前**（plan/03 §十三；docs/86 B6）」——与 plan/03 §十三、v2/00 §一 同口径；AGENTS.md 本体仍未改（不在本卷领土）。

---

*本卷完成只表示运行时/工具链约束、依赖登记、分层宪法工程落位、测试分层与许可口径在 v2/00 纪律下字面自洽且与现状事实对齐，不表示任何目标（未证）机制已建成；与 v2 各卷冲突时停手改上位卷（走制作人批示）。DSF 复查（F8）已于 2026-10-30 通过（v2/17 §六.2/§七）；本卷已于 2026-10-30 定稿（final）。*
