# L3-H · 细节层横向审计：79 TypeScript 工程与依赖选型（DSF）

> 审计对象：`docs/79-技术细节-TypeScript工程与依赖选型.md` v0.3（返修二），1702 行，全文分四段读完。
> 口径：`docs/audit-DSF/_scope-DSF.md`；轴＝横向层内（L3 技术细节层，只审 79 的自洽与交班；跨层问题标注后交 C 组）。
> 类型：A 矛盾／B 缺口／C 漂移／D 过度声明／E 不可执行·不可验证／F 权责失真／G 工程治理。
> 审计日期：2026-10-27。纪律：只读；未改任何设计文档、源码、配置、manifest、锁文件；只写本报告。
> 位置写法：`79:213`＝`docs/79-…:213`；`80-§5.7`＝稳定节号；代码与锁写 `路径:行`。
> 证据分两层：**机械核对**（可复现的 grep/tsc/运行时探针，命令与结果见第三、四节）与**判断**（写“为什么错”列）。
> 交班抽查（只作证据，不代替对 76/77/78/80/81/82 各卷的审计）：75-§2.1、D75-07～D75-11；77-§11.1；80-§3.1/§3.2/§5.7/§12.2/§12.5；81-files/01、81-files/19；82-§二/§十/§十三；`scripts/guards/boundary-rules.mjs`；17 个 workspace manifest；`bun.lock`；根与 17 个包级 `tsconfig*.json`；`.mise.toml`。

---

## 一、结论

1. 共 **13 条：P0 0 条、P1 4 条、P2 8 条、P3 1 条**。
2. 未发现达到 P0 门槛的问题。79 最硬的一批声明经复核**成立**：Node 24.21.0 的 8 项 strip 探针逐条复现；Bun 1.4.3 报 `transform`/`26.3.0`/SQLite 3.51.0；`bun.lock` 被引的 13 处行号、140 个 `registry.npmmirror.com` tarball、`lockfileVersion 2`；17 个 manifest 的依赖与 exports；`typescript.js` 的 7 处行号；1257 处 `.ts` 说明符零漏；17 个包级 tsconfig 的 include；D10 的 185/147/32 与“10 个 workspace 有 test/”计数——全部复现。这不是一份靠“文档说支持”撑起来的卷。
3. 最严重 3 条：
   - **L3H-01**：D10 把 test/ 缺口算成“38 个已入包级 program、147 个未入”，但那四个 program **没有任何门禁调用**，其中三个实测红（core 36／adapters 6／prompt 19 个 TS 错；样本 `TS1543` 恰是 §4.2 自称的 JSON attribute 规则）。82 若按 D10 排“test/ 纳入门禁”，第一步就是 61 个错且无分级前提。
   - **L3H-02**：§1.5 的“安装期检测”判据是收紧 `engines.node`，而 §1.4 自己承认 Bun 会绕过 `engines` 这类声明式检查；实测 bun 1.4.3 对 `engines.node: ">=99"` **exit 0 且零提示**，npm 只 5 条 EBADENGINE 警告、exit 0。版本不变量在设计的第 1 层就不是闸。
   - **L3H-03**：§7.2 要求 daemon 消费 dsh-bridge 暴露的“插件入口路径解析器”，等于新增 `daemon→dsh-bridge` 模块边；但边界表把它冻结为“仓内零模块入边”、`allowedPackageEdges` 里没有这条边，§4.5 又规定新边必须“方向表允许”。dist 切换第一刀的收口路径与宪法表冲突。
4. 可带着走（不必现在修）：§1.2/§1.3 的 Node/TS 约束与版本探针、§5 的双轨构建与三陷阱、§6.1 的闭包拓扑与 DAG、§9 的 DEP 矩阵形态、§12 的漂移登记方式、§十五 的 14 项未证——方向与证据都成立。问题集中在“**门禁是否真执行**”和“**少数交班细节**”，不是设计整体不成立。

---

## 二、发现表

### P0（必须现在修）

无。逐条核对后未发现使根命题、I 不变量、权责链或数据/安全边界在文本上自相否定的硬矛盾。79 的“目标/未证/选择”分区基本诚实；§8.3 把许可与发布范围让给制作人，§3.4/§6.1 把行为与落点让给 80/81，未发现代决。

### P1（导致错误实现／无法验收／关键场景无出口）

| ID | 级别 | 类型 | 位置 | 事实／引文 | 为什么错 | 修复路径 |
|---|---|---|---|---|---|---|
| L3H-01 | P1 | B／E／D | `79:1570`（§12-D10）；`79:46-48`（§0.2）；`79:553-557`（§4.4）；`79:507-509`（§4.2）；`packages/*/package.json` 的 `typecheck` 脚本 | 事实一：D10 只登记“10 个 workspace 有 `test/` 共 185 个 `.ts`，仅 adapters 14／core 17／prompt 6／dsh-bridge 1 入包级 program；147 个不在任何 program”，并给处置“82 立「`test/` 目录纳入门禁」项；可先加独立 `typecheck:test` 脚本”。事实二：本次逐包实跑 `mise exec -- node ./node_modules/typescript/bin/tsc --noEmit -p <pkg>/tsconfig.json`：`core` 36、`adapters` 6、`prompt` 19 个 `error TS`，其余 14 包 0；根 `mise exec -- bun run typecheck` exit 0（只跑根 program）。事实三：样本 `packages/core/test/judge.test.ts(13,22): error TS1543: Importing a JSON file into an ECMAScript module requires a 'type: "json"' import attribute when 'module' is set to 'NodeNext'`——正是 §4.2 “TS 5.7 起…必须带 `with`，否则报错”的规则。事实四：17 个包各自都有 `"typecheck": "tsc --noEmit -p tsconfig.json"`，但无任何门禁调用它们。 | 判断：D10 的字面数字对，但“入包级 program”被当成“已覆盖”的替代物，掩盖了两个更硬的事实：这些 program **零执行**，且 3/4 **已红**。D10 的处置若照做，`typecheck:test` 一接就红 61 个错，82 的波次没有“先修红再串门禁”的前提，也无法判“纳入完成”。另：§4.2 只列了 2 处带 `with { type: 'json' }` 的 `cases.json` 导入（yt/localplatform）；仓内另有 5 处同类导入**没有** attribute（`contract/test/schemas.test.ts:33`、`contract/test/contract.test.ts:7`、`core/test/judge.test.ts:13`、`company/test/deps-cases.test.ts:11`、`company/test/dir-cases.test.ts:8`），其中 `core/test/judge.test.ts:13` 已被 TS1543 判红——这 5 处卷内没有登记。 | ①D10 增一段实测：三包命令+错误数+TS1543 样本，把处置拆两段——“先修红（core/adapters/prompt 各立一条）→ 再接 `typecheck:test`”；②把“入包级 program”改为“已列入 program、无门禁调用、当前红/绿”三态；③§4.2 补一句“仓内另有 5 处 `cases.json` 导入缺 attribute（列文件），其中 `core/test/judge.test.ts:13` 已判 TS1543”，并说明它们是否在本次门禁缺口范围内。 |
| L3H-02 | P1 | A／D | `79:213-216`（§1.5 三层检测）；`79:197-198`（§1.4 第 3 条）；`79:1562`（§12-D2）；`79:92-94`（根脚本） | 事实一：§1.5 第 1 层判据＝“`engines.node` 收紧到 `>=24.21 <25` 并配合 `devEngines`/`.mise.toml`”。事实二：§1.4 第 3 条写“Bun 自报 `process.versions.node = 26.3.0`…会绕过 `engines.node: ">=24"` 这类声明式检查”。事实三（本次探针，`/tmp` 最小工程，`engines.node: ">=99"`）：`bun 1.4.3 install` → `BUN_EXIT=0`，输出仅“No packages! Deleted empty lockfile / done”，无任何 engine 提示；`npm install --dry-run` → `NPM_EXIT=0`，5 条 `EBADENGINE` 警告。事实四：根脚本 `"daemon": "node apps/daemon/src/index.ts"`（`package.json:21`）由 PATH 解析 `node`；同一份 79 说取证 shell 的裸 `node` 是 v25.6.1，且 Node 25 的 `node:sqlite` 是 3.51.2 并打 ExperimentalWarning（本次复核同）。 | 判断：同一卷内 A 说“engines 是会被绕过的声明式检查”、B 把收紧 engines 当作“安装期检测的可执行判据”。即便实现，第 1 层也不产生任何拒绝；而第 2 层是目标、第 3 层靠人肉对照版本，于是“daemon 跑 Node 24”的不变量在三个层里都没有机械保证。这不是“未实现”，是**判据本身不成立**。 | ①§1.5 第 1 层改为真闸：CI/本地统一 `mise exec --` + 一个 `scripts/verify-runtime.mjs`（比对 `process.versions.node`/`features.typescript` 与 `.mise.toml`，exit 非 0）；npm 侧另加 `.npmrc engine-strict=true`。②明写“`engines` 只是声明式提示，不构成检测”（与 §1.4 一致），D2 同步。③§1.4 补一句“根脚本的 `node` 由 PATH 决定，故安装/启动一律经 mise 或 verify-runtime 前置”。 |
| L3H-03 | P1 | A／G | `79:940-942`（§7.2）；`79:587-589`（§4.5）；`scripts/guards/boundary-rules.mjs:94`、`:102-142`（允许边）；`apps/daemon/src/engine/instructions-store.ts:72` | 事实一：§7.2 结论写“‘路径消费’必须改成**显式产物契约**：由 dsh-bridge 暴露「插件入口路径」的解析器（读自身 `exports` 或 `dsh.bundle`），daemon 只消费解析结果”。事实二：`boundary-rules.mjs:94` 记 `"dsh-bridge": 1, // 仓内零模块入边——daemon 以路径引用消费（BRIDGE_SRC_REL，§十五.七不扫）`；`allowedPackageEdges`（`:102-142`，38 条）中没有 `["daemon","dsh-bridge"]`，也没有 `["boot","dsh-bridge"]`。事实三：§4.5 规定“新增边必须同时满足：方向表允许、manifest 声明、无运行期环”，§10.1 第 7 项还说删边都要走提案。 | 判断：让 daemon“消费解析器”的最直接实现就是 `import { resolveBridgeEntry } from '@studio-next/dsh-bridge'`——这正是表外新边，会被 `guard:boundaries` 判违例；为了让它过，只能私下改边表（绕过提案流）或退回路径推断（§7.2 明确要消灭的形态）。§7.2 给了机制却没给合法通道，第一刀 dist 切换（dsh-bridge 是链首）无法按写法落地。 | 二选一并写死：①**数据面**——dsh-bridge 把入口路径写进 `package.json#dsh`/`cordis.patch.yml`，daemon 只读文件不 import（保持零模块入边，`BRIDGE_SRC_REL` 换成语义化定位但仍是路径读）；②**提案加边**——新增 `["daemon","dsh-bridge"]`，同步 manifest、方向表、基线，并在 §7.2 引 §4.5 三条件作前置。无论哪种，都在 §7.2 明写“本改动是否新增包边”。 |
| L3H-04 | P1 | E／B | `79:558`（§4.4）；`79:649-650`（§5.2）；`79:736`（§5.6）；`79:868-870`（§6.3） | 事实一：§5.6 只写“构建前后各算一次源码指纹（`sha256` 排序文件表），产物与指纹一起登记，防止「dist 比 src 旧」”；§5.2 写“构建前置检查依赖包的 `dist` 存在且指纹与源码一致”。事实二：§4.4 写“dist 的新鲜度由构建闸（指纹 + `--listFiles`，§5.6）保证”。事实三：§5.6 的“构建成功五条”不含任何陈旧判据；`--listFiles` 在 §5.6 被定义为拓扑断言（“断言输出中不出现本包之外的 workspace 源码”）。 | 判断：**构建前后各算一次**只能证明“构建期间源码没变”，不能证明“dist 不比 src 旧”——后者必须与“上一次成功构建登记的指纹”比较。而这份登记的位置、格式、比对时机、失败退出码全未定义（“一起登记”登到哪、谁来比、比不过 exit 几，都没写），所以这个机制不可执行、也不可验收。把 `--listFiles` 算作新鲜度证据是第二处错位：它只证明 program 拓扑，对“dist 是否陈旧”零信息。§6.3 把“陈旧 dist”列为三大失败模式之首，防御却是空的。 | 定义 `dist/.build-stamp.json`：`{sourceSha256, tsconfigSha256, node, tsc, builtAt}`；E2 前置＝“重建算 `sourceSha256` 并与 stamp 比对，不等即 exit 非 0 且报差异文件表”；§5.6 五条改六条（加“stamp 与当前源码一致”）；把 `--listFiles` 只留在拓扑断言里，§4.4 删掉“指纹 + `--listFiles` 保证新鲜度”的合并表述。 |

### P2（一致性／清晰度／重复／可维护性，可后修）

| ID | 级别 | 类型 | 位置 | 事实／引文 | 为什么错 | 修复路径 |
|---|---|---|---|---|---|---|
| L3H-05 | P2 | A／C | `docs/81-files/01-contract.md:687`；`79:607-632`（§5.2）；`79:1676`（§16.5） | 事实一：81 的 `F-contract-tsconfig-build` 写“`extends ./tsconfig.json`，**必须显式覆盖** `noEmit:false`、`declaration:true`、`declarationMap:false`、`outDir:./dist`、`rootDir:./src`、`rewriteRelativeImportExtensions:true`”。事实二：79-§5.2 的目标模板写 `"extends": "../../tsconfig.base.json"` 且带 `include:["src/**/*.ts"]`、`exclude:["src/**/*.test.ts","test/**/*.ts"]`。事实三：79-§16.5 写“81 若新增构建文件（`tsconfig.build.json`）…必须引用本卷 §5/§7，不得自行另定”。事实四：`adapters`/`core`/`prompt` 的包级 include 含 `test/**/*.ts`（17 个 tsconfig 实测）。 | 判断：`extends ./tsconfig.json` 会把包级 include 一起继承；对 `contract` 今天无害（其 src 无 test），但这是**唯一已落地的构建契约模板**，照抄到上列三包就会把测试编进 dist，进而逼 `vitest` 变运行时依赖——正是 79-§5.2 自己列的坑。79 说“从 base 继承”、81 说“从包级继承”，两者只能有一个是契约。 | 要么 81 条目改为 `extends ../../tsconfig.base.json` 并显式写 `include`/`exclude`；要么 79-§5.2 明确“允许 extends 包级 tsconfig，但必须显式覆盖 `include`/`exclude`”，并让 81 补这两键。二者取一后，在 §16.5 加一句“extends 目标是构建契约的一部分”。 |
| L3H-06 | P2 | E／D | `79:1485-1491`（§10.3）；`79:1428`（§10.1 第 2 项）；`81-files/19:161-163`；`packages/api/src/index.ts:35`；`packages/store/src/index.ts:78` | 事实一：§10.3 结论写“三项都是机械可判，不需要 AST 级分析：`grep` 字面量即可覆盖现状（相对导入 + 包名导入）”。事实二：81-files/19 已把这三项落成 `manifest-rules.mjs`/`manifests.mjs`/`manifests.test.mjs`，并写“执行引擎：…**不做 AST**”。事实三（反例，两个方向）：`packages/api/src/index.ts:35` 的 TODO 注释里写着 `@modelcontextprotocol/server`，而该依赖正是 §10.1 第 2 项判定要删的装饰性依赖——裸包名 grep 会把它当“已使用”（假阴性）；`packages/store/src/index.ts:78` 的注释写“`@studio-next/core` 仅测试 devDependency”，而 store 的 core 在 §10.1 第 10 项被判“正确”——裸包名 grep 会让检查 3 把这处判成“分类错误”（假阳性）。 | 判断：grep 无法区分 `import`／`export * from`／`import type`／`require`／字符串与注释；79 断言“不需要 AST”并不成立，而 81 已把这个断言固化进实现，缺陷会被继承。当前 `api` 的依赖若被第 1 条检查漏掉，§10.1 的清理与 §10.3 的门禁会给出相反结论，且都没法自证。 | 二选一：①用 TS AST（`ts.createSourceFile` 扫 `ImportDeclaration`/`ImportType`/`CallExpression(import())`/`ExportDeclaration`）出“包名→文件行”表；②退一步先剥注释与字符串（可用现成 strip-comments 或手写状态机），再锚定 `from '<pkg>'`、`import('<pkg>')`、`export … from '<pkg>'` 三类语法。同时删掉 79-§10.3 与 81-§2.2 的“不需要 AST／不做 AST”，改成“需要最小语法锚定”。 |
| L3H-07 | P2 | B／E | `79:946-957`（§7.3）；`79:896-901`（§6.5 首链两包）；`79:908-912`（§6.5 事实）；`79:1082-1090`（§8.3） | 事实一：§7.3 的发布判据含“许可：`LICENSE` 在列且 `license` 字段存在”，并注明“现状 17 个 workspace 全部没有 `license` 字段、包内也没有 LICENSE，故这是「随切换新增」”。事实二：§6.5 说 `dsh-bridge`/`gateway`/`studio-tools` 的 README/LICENSE“属新增、许可由制作人未决（不默认沿用根 MIT）”。事实三：§7.3 的“体积：单文件与总体积有上限”无任何数字；“文件集合与 §7.1 白名单完全一致”与 npm 必带 `package.json`/`README`/`LICENSE` 的事实冲突（`files` 白名单不控制这三类）。 | 判断：发布面有一条判据依赖卷外决定（制作人许可），但 79 没有为它立任何 D/U 编号、责任位置或关闭条件，§7.3 因此永远无法判绿——不是“未实现”，是“无出口”。另外两条判据（体积、集合完全一致）无阈值/无例外表，验收时说不清。 | ①在 §12 或 §15 立一条 `DEP-PUBLISH-LICENSE`（内容：17 包无 license/LICENSE；阻塞 §7.3 的“许可”行；决定人＝制作人；关闭条件＝许可文本入选并写入 §7.1）；②§7.3 分“技术清单”（可判）与“许可门”（待决）；③体积给数字（如单文件 ≤1 MiB、总 ≤5 MiB）或改“异常增长 >20% 即复核”；④“完全一致”加例外：“npm 必带的 package.json 与 files 外自动包含的 README/LICENSE 不计入偏差”。 |
| L3H-08 | P2 | G／B | `79:202`（§1.4 第 2 条）；`79:864`（§6.2 末）；`79:1036-1042`（§8.2 E1） | 事实一：§1.4 写“同一命令在验收时必须再以 `mise exec -- node` 跑一遍（**§8 证据矩阵的「双跑」项**）”；§6.2 末也写“验收必须双跑（§8）”。事实二：§8 的表（`79:1021-1030`）没有“双跑”行；§8.2 的 E1 唯一命令是 `mise exec -- bun run test`（= `node scripts/guards/boundaries.mjs` + `vitest run --passWithNoTests`），没有 node 直跑测试入口的第二条命令。事实三：`node_modules/.bin/vitest` 首行是 `#!/usr/bin/env node`。 | 判断：被两处引用的“§8 双跑项”不存在，是失效引用；实际是否由 Node 执行取决于 `bun run` 的 bin 派发语义（本次未直接证明，见第四节），79 既没写这个事实、也没给显式 node 直跑的 E1b。于是“Bun 绿灯 ≠ Node 可跑”这条第 1 条硬理由，在测试证据上没有对应的第二条腿。 | 二选一：①在 §8 增 `E1b`：`mise exec -- node node_modules/vitest/vitest.mjs run`（或等价），并写明与 E1 同套件、同夹具、分别留证；②删掉两处“§8 双跑项”引用，改为“§1.5 第 3 层要求所有证据命令打印 `node -v`/`bun -v`/`tsc -v`”，并补一句 `bun run <script>` 的 bin 派发事实（以 `node_modules/.bin/vitest` 的 shebang 为据）。 |
| L3H-09 | P2 | C | `79:214`（§1.5 第 2 层）；`80:139`（§3.1 末） | 事实一：79 写“**启动期**：daemon 组合根读 `process.versions.node` 与 `process.features.typescript`，不满足即 fail-fast”。事实二：80-§3.1 写“**boot 是组合根，不是包层**；它零入边、允许出边三条、不得被任何包 import”（`80:139`）。 | 判断：“组合根”在 80 是 `apps/boot` 的定位词，在 79 被安到 daemon 进程入口上；同一术语两义，且 79-§16.4 自己引 80-§3.2 说 daemon 包根收敛归 80。读者无法判断 fail-fast 应该落在 boot、daemon 还是 CLI。 | 79:214 改为“daemon 进程入口（组合根在 `apps/boot`，80-§3.1）在启动时读…”，并在 §16.4 加一句“启动期自检的落点由 80-§3.1 决定”。 |
| L3H-10 | P2 | D／E | `79:285`（§2.2）；`79:442-447`（§3.5） | 事实（复现口径见第三节；除注明者均为全仓 `--include='*.ts' apps packages`，排除 node_modules）：`satisfies` 按词边界 28 次／26 行（src 9 行、test 17 行；带双侧空格的 ` satisfies ` 20 次），79 写“22 处”；`now: () => number` 实测 7 处，79 写“11 处”；`process.env` 实测 149 次，79 写“145 处”；`node:child_process` 在 daemon 实测 18 文件／20 行，79 写“12 处”；`Math.random` 在 `apps/*/src packages/*/src` 实测 1 处（`packages/gateway/src/gateway.test.ts:70`，测试文件），79 写“零命中于 src”。其余统计全部精确复现（1257／648／157／162／283／1513／2186／77／2／14），说明这是口径问题而非编造。 | 判断：79 的证据方法就是“统计即证据”，且多处只写“本次 grep”不给命令与范围；四个数字与一处绝对断言对不上（若确为更早快照，应给日期与 commit，否则不可复现），会让下游（82 的 V0、81 的逐文件契约）在引用时无法复算。属于可带着走，但应改口径。 | 每个统计后加最小命令与范围（`src only`／含 test／含注释）；不能复现的四个数字直接删掉或改成定性（“生产代码少量”）；`Math.random` 改为“src 仅测试文件 1 处（`gateway.test.ts:70`），生产 0 处”。 |
| L3H-11 | P2 | B | `79:836-861`（§6.2 `exports` 形状）；`79:1025-1028`（§8.1 E3/E4） | 事实：§6.2 的目标形状只给 `types` 与 `import` 两个条件（`"." : {types, import}`、`"./overview": {types, import}`…），`main` 只作旧解析器兜底；17 个 workspace 全部 `"type": "module"`，`dist` 因此是 ESM。79 通篇没有写“分发面 ESM-only”，E3/E4 的验收也没有 CJS 消费者项。 | 判断：对 CJS 消费者，`require('@studio-next/…')` 不匹配 `import` 条件，会得到 `ERR_PACKAGE_PATH_NOT_EXPORTED`（Node 24 语义；本次未跑消费者，标未证）。这不一定是错的选择（DSH 是 ESM、TS 消费者可用），但它是**发布面的硬限制**，既没写进 §6.2 也没进 §7.3 清单，读者会默认“npm 包谁都能用”。 | 在 §6.2 加一条：“分发面 ESM-only：`exports` 只给 `types`/`import`，不提供 `require` 入口；CJS 消费者须 `await import()`。”并在 E4 加一条 CJS `require` 负测（断言预期失败）或另立“要 CJS 就双产物+条件导出，需提案”。 |
| L3H-12 | P2 | A／D | `79:1192`（§9.2 DEP-ZOD）；`79:340-341`（§3.2）；`packages/studio-tools/src/server.ts:60`、`tools.ts:333` | 事实一：§9.2 写“`~standard.jsonSchema` 供 MCP SDK 转 JSON Schema（**库级存在**，studio-tools 已用）”。事实二：§3.2 写“`zod@4.6.7` 的 `~standard.jsonSchema` 类型存在…这支撑 `studio-tools` 把 zod schema 交给 MCP SDK 转 JSON Schema 的**已有**做法”。事实三：`packages/studio-tools/src/server.ts:60` 定义 `McpSchemaOf`、`tools.ts:333` 调 `z.toJSONSchema(...)`，且 `server.test.ts` 覆盖 tools/list。 | 判断：按 75-§0.1，`库级存在/未接运行链`＝“类型或函数存在，但生产链未接或没有运行证据”；本对象已有生产用法与测试，应标“已有”。“库级存在，studio-tools 已用”这句话内部就自相矛盾，且与 §3.2 的“已有做法”冲突——四态在本卷唯一一次使用就用错。 | 79:1192 改为“**已有**：studio-tools 生产代码已用（`server.ts:60`、`tools.ts:333`），`server.test.ts` 覆盖 tools/list 的 JSON Schema 输出”。 |

### P3（编辑／小一致性问题，不阻塞）

| ID | 级别 | 类型 | 位置 | 事实／引文 | 为什么错 | 修复路径 |
|---|---|---|---|---|---|---|
| L3H-13 | P3 | C／E | `79:1101`（§9.1 表头）；`79:1116`、`79:1121`、`79:1124`；`79:1143` | 事实一：§9.1 表头定义“`锁`＝`bun.lock` 实锁”，但 DEP-NODESQLITE 的“锁”填 `3.53.4`（Node 内建 SQLite 版本）、DEP-NODESTDLIB 填 `24.21.0`（Node 版本）、DEP-VENDOR-BROWSER 填 `3.5.44/2.45.3/6.1.0`（`vendor.lock.json` 版本）。事实二：§9.2 DEP-BUN 写“notebook 脚本 `packages/panel/scripts/vendor-pull.mjs`”。 | 判断：同一列承载三种不同的“锁”；`notebook` 疑为 `Node` 的笔误。不影响任何结论，但列语义漂移会让“锁”这一列无法机械核对。 | 表头改为“锁/实版本（来源注）”，三行分别注 `Node 内建`／`Node 版本`／`vendor.lock.json`；`notebook` 改 `Node`。 |

### 2.1 跨层移交（交 C 组，不计本层 P 级）

| 编号 | 对象 | 事实 | 为什么不在本层判 |
|---|---|---|---|
| C-L3H-01 | 79-§8 的 E1–E6 与 82 的 V0–V6 没有交叉表 | 79-§8 给了六类证据与命令/判据；82-§二 的 V0–V6 与 §十三 的标准命令没有 E1–E6 的位置（82:924 只有一句“79-§5/§6/§9/§十五”引用）。 | 已在 `L3-A` 的 L3A-08 立项（82 侧无账号）；本卷只确认 79 侧证据可执行，不重复判 82。 |
| C-L3H-02 | `contract` 分发文件的 `exchange` 目录 | 81-files/01:468 的 `files=["dist","cases.json","CASES.md","exchange","README.md","LICENSE"]` 含 `exchange`，79-§7.1 的四类白名单只有 `dist`/数据文件/README/许可，未提 `exchange`（也未提 `exchange` 属于哪一类）。 | 属 81 的逐文件契约与 79-§7.1 的枚举差；本层只登记为“白名单枚举不闭合”，归 C 组对齐 79/81。 |
| C-L3H-03 | DEP-DSH 的 registry 元数据与 `0.2.0-rc.2` 真实性 | 79-§9.2 写“registry 元数据（本次抓取）：`license: MIT`、`type: module`、`bin.dsh = lib/bin.js`、`exports` 含 `./lib/*` 与 `./profile-boot`”。本次未联网核实。 | 宿主绑定归 78；79 只引外部事实，C 组若要判“绑定版本真实性”应与 78-§13.5 合并审。 |

---

## 三、覆盖核对

### 3.1 已覆盖（对象／章节／ID）

- **全文**：79 §〇～§十六 + 附录证据索引，1702 行逐段读完；未跳读目录或摘要。
- **DEP-ID**：§9.1 全部 22 行（DEP-NODE／BUN／TSC／TYPES-NODE／VITEST／ZOD／YAML／HONO／CRONER／EXECA-10／EXECA-09／SIMPLEGIT／MCP-SERVER／NODESQLITE／DRIZZLE／AJV／SEMVER／DSH／NODESTDLIB／SYSTEMGIT／VITE-ESBUILD／VENDOR-BROWSER），逐条核“使用位置/版本/用途/兼容边界/许可/替代退出/证据”七项是否齐；§9.2 的每一条都与 manifest、`bun.lock`、`node_modules` 包元数据或源码交叉核对。
- **依赖面**：17 个 workspace 的 `dependencies`/`devDependencies`/`exports`/`main`/`bin` 全读；外部直接依赖清点为 `@modelcontextprotocol/server`、`croner`、`execa`、`hono`、`simple-git`、`yaml`、`zod` + 根 devDeps `@types/node`/`typescript`/`vitest`，与 DEP 矩阵一一对应，无漏登。
- **锁与工具链**：`bun.lock` 行号 249/351/375/385/389/401/451/475/481/485/493/497/499 逐行核对；`lockfileVersion:2`/`configVersion:1`；140 个 tarball 全 `registry.npmmirror.com`；`.mise.toml:4-5`；根 `package.json:8-21`。
- **类型门禁**：`tsconfig.base.json` 全部开关与行号；根 `tsconfig.json:4`；17 个包级 tsconfig 的 include/exclude；`mise exec -- bun run typecheck`（exit 0）；17 个 `tsc --noEmit -p` 逐包实跑（见 3.2）。
- **构建面**：§五 的三陷阱与 TS 5.9.3 源码行（`typescript.js:129305`、`:21900-21903`、`:119060-119070`、`:46596-46598`、`:45483-45487`、`:117725`、`:97423` 全部命中）；`noEmit` 继承与 `rewriteRelativeImportExtensions` 的行为；`dist` 在 `.gitignore`。
- **代码事实**：`kernel.ts:85`/`:96`/`:98`；`errors.ts:44`/`:54`；`core/src/index.ts:82`；`ports/index.ts:6-7`；`instructions-store.ts:72`；`serve.ts:1495`；`boundary-rules.mjs:24-96`/`:102-142`/`:149-152`/`:159-182`/`:193-200`；`dsh-bridge/test/bridge.test.ts` 的 exports/patch 断言；`cordis.patch.yml`；`studio-tools/src/` 无 `stdio.ts`；`vendor.lock.json` 三件与 `LICENSES/`；`vendor-pull.mjs`；README/AGENTS 的 store 描述与 Quickstart。
- **统计复现**：见 3.2；与 79 一致的项在结论第 2 点列出，不一致的项归 L3H-10。
- **探针**：Node 24.21.0 的 8 项 strip 探针；Bun 1.4.3 的 3 项运行时值；engines 两枚；源码轨跨包 import；17 包 typecheck。
- **交班引用**：75-§2.1/D75-07～11；77-§11.1（14 类 `FailureClass` 与 79-§3.4 逐个同名）；80-§3.1/§3.2/§5.7/§12.2/§12.5；81-files/01、19；82-§二/§十/§十三。

### 3.2 机械核对命令与结果（可复现）

```text
# 版本（.mise.toml 选中）
mise exec -- node -v                  → v24.21.0
mise exec -- bun -v                   → 1.4.3
mise exec -- node -e "console.log(process.versions.sqlite, process.features.typescript)" → 3.53.4 strip
mise exec -- bun -e "console.log(process.versions.node, process.versions.sqlite, process.features.typescript)" → 26.3.0 3.51.0 transform

# 根门禁
mise exec -- bun run typecheck        → exit 0（只跑根 program）

# 包级门禁（本次逐包实跑）
mise exec -- node ./node_modules/typescript/bin/tsc --noEmit -p packages/core/tsconfig.json      → exit 2，36 个 error TS
mise exec -- node ./node_modules/typescript/bin/tsc --noEmit -p packages/adapters/tsconfig.json  → exit 2， 6 个 error TS
mise exec -- node ./node_modules/typescript/bin/tsc --noEmit -p packages/prompt/tsconfig.json    → exit 2，19 个 error TS
其余 14 包（含 apps/boot、apps/daemon、dsh-bridge、contract、gateway、studio-tools）→ 0 个 error TS

# Node 24 strip 探针（/tmp 临时目录，已删）
node main.ts（import './dep.ts'）        → file-ts-ok 1
node noext.ts（import './dep'）          → ERR_MODULE_NOT_FOUND
node enumfile.ts（enum）                 → ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX
node nsfile.ts（namespace）              → ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX
node deep.ts（./node_modules/fake/index.ts）→ ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING
node a.tsx                               → SyntaxError: Unexpected token '<'
node -e "const x: number = 1"            → 通过
node --input-type=module -e "const x: number = 1" → SyntaxError（未擦除；加 --experimental-strip-types 同）

# 源码轨跨包（工作区符号链接 → realpath 在 node_modules 外）
mise exec -- node -e "import('./packages/gateway/src/index.ts')" → OK exports=9

# engines 检测（/tmp 最小工程，engines.node: ">=99"）
bun 1.4.3 install                     → BUN_EXIT=0，无 engine 提示
npm install --dry-run                 → NPM_EXIT=0，5 条 EBADENGINE 警告

# 统计（与 79 对比）
export interface 648 / export type <Name> 157 / as const 162 / "| null" 283 / "??" 1513 / "?." 2186
z.strictObject 77 / z.object( 2 / z.unknown() 14 / relative .ts imports 1257（漏扩展名 0）
test/ 目录 .ts 185；不在任何 program 147（daemon 86/company 21/panel 18/store 16/taiga 3/contract 2 + dsh smoke 1）；src/*.test.ts 32
```

### 3.3 未覆盖清单（本卷内）

- 79-§9.2 对**未安装**第三方包的 registry 元数据（`@deepseek-ai/dsh`、`ajv`、`semver`、`drizzle-orm 0.45.4`）——未联网核实。
- `npm pack --dry-run --json` 的真实清单（E5 未跑）。
- `vitest` 全套（E1 未跑；79 自述也未跑）。
- E2/E3/E4/E6 的 dist 形态证据（当前切换集为空，无 dist 可跑）。
- Windows/换行/`bun build --compile`/Bun 生命周期脚本的确切语义。
- `docs/34` 的 pnpm `link:` 真机原文（79 转引，本次只复核了仓内 bun 工作区符号链接可跑 TS）。
- 79-§15 的 U1–U14 逐项未证内容（本报告只核“这些未证项存在且未被写成已证”，不替 82 执行）。

---

## 四、未证与无法判断

1. **外部 registry 声明**：`@deepseek-ai/dsh` 的 `0.2.0-rc.2`、`license: MIT`、`bin.dsh=lib/bin.js`、`exports ./lib/*`；`ajv 8.20.0`、`semver 7.8.5`、`drizzle-orm 0.45.4`——本次未联网，均按“未证”处理，不据此加减分。
2. **Node 24 文档的 “Stability 1.2”**：79 写“本次抓取”。本次只复现了 `node:sqlite` 在 24.21.0 下无 ExperimentalWarning、`process.versions.sqlite=3.53.4`；未抓官方原文。
3. **`bun run <script>` 对 bin shebang 的派发语义**：实测 `node_modules/.bin/vitest` 首行为 `#!/usr/bin/env node`，但未直接证明 `bun run test` 最终由 node 执行测试入口（L3H-08 只按“需补 E1b”处理，不据此断定 E1 就在 Bun 下跑）。
4. **Bun 对 workspace 成员 `engines` 的处理**：最小工程复现了**根** `engines` 被忽略；workspace 成员场景因沙箱 `EPERM`（bun 写临时目录）未能跑成，标未证。
5. **CJS `require` 的失败形态**：`ERR_PACKAGE_PATH_NOT_EXPORTED` 是 Node 语义推断，本次未构造 CJS 消费者实跑（L3H-11 已标未证）。
6. **E5/E6/真实 vitest**：未执行；不影响本报告的文本级结论。
7. **`docs/34` 的 pnpm `link:` 真机结论**：只作转引，未复核原文。
8. **D10 的三包红是否为“长期状态”**：本次只证明当前树如此；未查 git 历史判断红是否新引入（本报告不依赖这一点）。

---

## 五、给作者的修复顺序（≤7 条）

1. **先修 D10（L3H-01）**：它是 82 排 test 门禁波次的输入；把“入 program＝已覆盖”改成三态，并把“先修红 → 再串门禁”写死；同时补 §4.2 的 5 处无 attribute 反例。理由：不修这条，82 的第一步就会红 61 个错且无人认领。
2. **修 §1.5 第 1 层与 D2（L3H-02）**：删掉“engines 收紧＝安装期检测”的判据，换成 `verify-runtime.mjs`/`engine-strict` 一类真闸，并在 §1.4 补“脚本的 node 由 PATH 决定”。理由：这是“Node 24”不变量的唯一机械入口。
3. **修 §7.2 与 §4.5 的边冲突（L3H-03）**：二选一（数据面暴露 / 提案加边），并把“是否新增包边”写进 §7.2。理由：dsh-bridge 是 dist 首刀，路径不合法就切不动。
4. **修 §5.6/§6.3 的陈旧 dist 机制（L3H-04）**：落 `dist/.build-stamp.json` + E2 前置比对 + 六条判据；§4.4 删掉“`--listFiles` 保证新鲜度”。理由：这是 dist 轨道唯一的安全阀。
5. **对齐 79-§5.2 与 81-files/01:687（L3H-05）**，并修 §1.4 的“§8 双跑项”失效引用（L3H-08）。理由：这两条是“构建契约”的交班点，越早定越少返工。
6. **重做 §10.3 的检查口径（L3H-06）**：改成最小语法锚定（或 AST），同步删 81-files/19 的“不做 AST”。理由：这是“依赖最小化”的唯一门禁，口径错了等于没有。
7. **收尾 P2/P3（L3H-07/09/10/11/12/13）**：发布许可立项、组合根术语、统计口径、ESM-only 声明、四态改写、锁列语义——可一批改，不阻塞。

---

## 六、本报告没有做什么（范围限制）

- **只审 79**。76/77/78/80/81/82 只作“79 的引用是否成立”的证据抽查，不对它们各自的完整性下结论；81-files/01、19 的引用只用于证明 79 的交班是否被如实承接，不代替对 81 的审计。
- **不做纵向链审计**（V 组）：79 的 `DEP-` 与 75-D75-10、78 的绑定档案、82 的 V4 之间的纵向一致，只在必要时点出，不作链条结论。
- **不给实现方案**：所有“修复路径”都是最小改动建议，不是实现单；不创建 `tsconfig.build.json`、`verify-runtime.mjs`、`manifest` guard 或任何代码。
- **不改任何文件**：本次只读；未改文档、源码、配置、manifest、锁；`/tmp` 探针目录属临时环境，不属仓。
- **不替代 82 的验证**：本报告没有跑 `vitest` 全套、`npm pack`、dist 构建、DSH 宿主装载、Windows 矩阵；这些仍是 79-§15 的 U1–U14 与 82 的 V2–V6 范围。
- **不评价文风**：P3 只留 1 条，且只涉及可机械核对的列语义与笔误。
