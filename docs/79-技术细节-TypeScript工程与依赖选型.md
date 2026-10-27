# 79 · 技术细节：TypeScript 工程与依赖选型

> 版本：v0.3（返修二），2026-10-27。v0.1 为初稿；v0.2 按独立审查裁决修正构建拓扑、
> 构建/测试顺序、eval 口径、DSH 装载口径与依赖证据细节。v0.3 按 80 最新稿与真实 manifest 定点校正：
> 错误模型改为 `failure` 处置 / `category` 观测 / `subcause` 细目（现状仍是 `category` 单轴）；
> `boot` 入口为 `./src/boot.ts` 并单列、daemon 包根按 80-§3.2 三步收敛、`studio-tools` 目标增 `./stdio`；
> 根 `typecheck` 只串显式已切包（当前切换集为空）；证据命令统一经 `mise exec --` 选择版本。
> 本版未改任何仓内文件。
> 性质：**自然语言级技术细节呈审稿**。不是现行契约、不是实现单、不是发布说明、不是能力证明。
> 上位：`docs/75-技术细节-总纲与工程决策.md`（工程决策 D75-07/D75-08/D75-09/D75-10 与本文直接相关）；
> 语义上位：`docs/69`–`docs/72`；现状基线：`docs/73`。
> 同组：`docs/76`（公共语义与纯配置）、`docs/77`（运行记录与行为契约）、`docs/78`（宿主/平台/传输/存储绑定）、
> `docs/80`（组合根与公共 TS 接口）、`docs/81`（逐文件契约）、`docs/82`（验证、迁移与追溯）。
> 门禁：制作人审核前不得据此立实现单。本卷列出的目标配置**都不是已创建文件**；本卷不创建、不修改任何生产 TS/JS、
> 构建配置、测试脚本、依赖清单或锁文件。

---

## 〇、本卷的位置、证据方法与边界

### 0.1 本卷独占什么

本卷只回答「Studio Next 用哪套 TypeScript/Node/Bun 工程纪律、哪个第三方包、以什么证据支撑」。具体对象字段归 76，
运行协议归 77，宿主绑定归 78，公共 TS 接口与组合根归 80，逐文件契约归 81，验证执行与迁移波次归 82。

| # | 本卷独占 | 不写 |
|---|---|---|
| 1 | Node 24 原生可擦除 TS 与 Bun 的分工；NodeNext/ESM/严格开关的实际含义 | 任何公司语义 |
| 2 | 仓内 TS 书写惯例（interface/type/守卫/unknown/optional/class/factory/branded） | 具体业务字段与状态机 |
| 3 | 信任边界：Zod、YAML、外部响应、错误分类、注入面 | 记录 payload 与失败协议内容（归 77） |
| 4 | 导入规则、动态 import 白名单、源码态/构建态接口边界 | 包间允许边的判定（归 20-§十五 与本仓 guard） |
| 5 | 源码/分发双轨构建的目标形态与陷阱 | 真实构建文件、真实产物 |
| 6 | package exports/dist 切换策略、npm/DSH 能力包发布面 | 公开许可决定、发布时点（归制作人） |
| 7 | 依赖矩阵（DEP-）、清理目标、安全与复现 | manifest/lock 实际改动 |

### 0.2 四类标记与四态（沿用 75-§0.1）

- 〔事实〕：仓内文件、锁文件、官方资料或本次真实探针支持；给路径/版本/URL。
- 〔结论〕：由 63–72 的不变量或 Node/TS 的机械规则推出；可被反例推翻。
- 〔选择〕：本卷选定但可替换的工程方案。
- 〔假设〕：性能/成本/效果判断；未证前不得当事实。

状态词：**已有**（真实存在且限于已证范围）、**库级存在/未接运行链**、**目标**（尚未实现）、**未证**（须探针与负向结果）。

〔口径〕本卷出现的「判负 / 返工 / 必须」若未特别标注「现行门禁」，一律指**目标审查口径**（供 82 落门禁的判据），
不代表仓内已有该门禁。仓内现行的机械门禁只有根 `mise exec -- bun run typecheck`（现状脚本体是 `tsc --noEmit`，
只跑根 program）与 `mise exec -- bun run test`（后者前置 `scripts/guards/boundaries.mjs`）。当前切换集为空，
根 `typecheck` 没有包级串接；`src/*.test.ts` 已在根 program 内，`test/` 目录不在（见 §12-D10）。

### 0.3 证据方法与本次口径

本卷的证据只有三类，且必须分开陈述：

1. **仓内静态证据**：`package.json`、`bun.lock`、`tsconfig*.json`、`.mise.toml`、源码 import 图、`scripts/guards/boundary-rules.mjs`。
2. **本地运行时探针**：用 mise 选择的 `node 24.21.0` / `bun 1.4.3` 与仓内 `typescript 5.9.3` 实跑（只读探针，探针目录已删）。
3. **官方资料**：Node 24 文档、TypeScript 5.7 release notes、Bun 文档、npm registry 元数据。

〔选择〕**命令口径**：本卷所有 `node` / `bun` / `tsc` 证据命令一律写成 `mise exec -- <cmd>`（例如
`mise exec -- bun run typecheck`、`mise exec -- node ./node_modules/typescript/bin/tsc -p …`），由 `.mise.toml` 选择版本。
裸 `bun`/`node`（交互 shell 的 PATH 解析）只算开发便利，**其输出不作证据**；证据记录必须同时带 `mise exec -- node -v`、
`mise exec -- bun -v`、`mise exec -- tsc -v` 三项，与 `.mise.toml` 不一致即作废。

〔事实〕**本次取证 shell 未激活 mise，裸 `node -v` 是系统 PATH 上的 v25.6.1**；`.mise.toml:4-5` 钉的是
`node 24.21.0` / `bun 1.4.3`。因此本卷所有与 Node 行为有关的结论，都通过 `mise exec -- node` 选择
Node 24.21.0 执行，**不把 Node 25 的结果当目标环境证据，也不把安装机器的实际路径/主机名写进规范**。
Node 25 只用于对照（例如它会对 `node:sqlite` 打 ExperimentalWarning，而 24.21.0 不打）。

〔事实〕版本口径以锁文件为准，不采用「latest」：默认版本见 `bun.lock` 的 `"typescript"`(475 行)、`"vitest"`(485 行)、
`"zod"`(497 行)、`"yaml"`(493 行)、`"hono"`(401 行)、`"croner"`(375 行)、`"execa"`(389 行)、
`"@studio-next/daemon/execa"`(499 行)、`"simple-git"`(451 行)、`"@modelcontextprotocol/server"`(249 行)、
`"@types/node"`(351 行)。75-§十 的简写（Zod 4.6.x、YAML 2.9.x 等）只作索引，逐项实锁以本卷 §九为准。

### 0.4 与 75–82 的唯一边界

| 主题 | 本卷（79） | 相邻卷 |
|---|---|---|
| 对象字段的 TS 映射 | 只给纪律（怎样写类型），不给字段 | 76 给语义，80 给 `TS-` 接口 |
| 运行失败 | 只给错误通道形状（`failure` 处置轴 / `category` 观测轴 / `subcause` 细目、tagged union vs throw） | 77 给失败路径与终局（`FailureClass` 词表） |
| 宿主/存储/传输 | 只给运行时版本与兼容边界 | 78 给绑定字段与损失 |
| 包与文件 | 只给依赖与构建约束 | 81 给逐文件契约 |
| 验证 | 只给「哪类证据证明什么」 | 82 给 V0–V6 与执行登记 |

本卷不新造 `TS-` ID（归 80），不新造 `MIG-` ID（归 82），只新造 `DEP-` ID（75-§2.1 已把 `DEP-` 划给本卷）。

---

## 一、运行时分工：Node 24.21 执行，Bun 1.4.3 作壳

### 1.1 基线事实

〔事实〕工具链钉在 `.mise.toml:3-5`：`node = "24.21.0"`、`bun = "1.4.3"`，注释写明「主仓与所有 worktree 泳道自动继承同一版本」。
〔事实〕根 `package.json`：`"type": "module"`(:8)、`"packageManager": "bun@1"`(:9)、`workspaces: ["apps/*","packages/*"]`(:10-13)、
`engines.node: ">=24"`(:14-16)、`"daemon": "node apps/daemon/src/index.ts"`(:21)、`"typecheck": "tsc --noEmit"`(:18)。
现状切换集为空，根 `typecheck` 只跑根 program；目标形态见 §4.4：**只串显式已切包**的 `tsc --noEmit -p`。
〔事实〕`apps/daemon` 的 `scripts.start` 仍是 `node src/index.ts`，`main`/`exports["."]` 也指 `src/index.ts`；
目标按 80-§3.2 三步收敛（先删包根并改入口脚本 → `index.ts` 纯再导出 → 零消费者后退役），根脚本改
`node apps/daemon/src/cli/main.ts serve`，`bin` 保持 `cli/main.ts`。
〔事实〕`bun.lock` 为文本锁，`lockfileVersion: 2`、`configVersion: 1`；全部 140 个 tarball URL 指向
`https://registry.npmmirror.com/`（本次对锁文件按主机名统计）。

本次探针（只读，2026-10-27，均经 `mise exec --` 选择版本）：

| 运行时（来源） | 版本 | `process.features.typescript` | 内建 SQLite | 备注 |
|---|---|---|---|---|
| Node（mise） | 24.21.0 | `strip` | 3.53.4（`process.versions.sqlite`） | `require('node:sqlite')` 无 ExperimentalWarning |
| Node（系统 PATH，非 mise） | 25.6.1 | `strip` | 不取（非目标环境） | 打 ExperimentalWarning；**不作验证环境** |
| Bun（mise） | 1.4.3 | `transform` | 3.51.0 | `process.versions.node` 报 `26.3.0`（兼容层） |

〔结论〕三者不是「同一运行时的三个版本」。Bun 报 `transform` 意味着它会**改写**而非仅擦除类型（`enum` 在 Bun 下可跑，
在 Node 24 下报错），且 SQLite 内建版本不同（3.51.0 vs 3.53.4）。因此 **Bun 下的绿灯不能证明 Node 下可跑**；
反过来，Node 下的行为才是 daemon 的事实。

### 1.2 Node 24 原生擦除 TS 的准确规则

〔事实〕Node 官方文档（<https://nodejs.org/docs/latest-v24.x/api/typescript.html>）规定：

1. 默认执行**只含可擦除语法**的 `.ts`；非可擦除语法（`enum`、含运行时代码的 `namespace`、参数属性、import alias）
   需要 `--experimental-transform-types`，否则报 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。
2. 装饰器不转换（TC39 Stage 3），直接解析失败。
3. **Node 不读 `tsconfig.json`**；依赖 `tsconfig` 的能力（`paths`、降级语法转换）一概不支持；`paths` 的最近替代是 `#` 开头的
   subpath imports。
4. 扩展名在 `import` / `import()` / `require()` 中**必须**写全：`import './file.ts'`。
5. `type` 关键字必须显式：`import type {...}`；`verbatimModuleSyntax` 可让 tsc 与之一致。
6. `.tsx` 不支持。
7. **Node 拒绝处理 `node_modules` 目录下的 TypeScript 文件**（`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`）。

本次探针逐条复核（`mise exec -- node`，24.21.0；下表 `node …` 均省写前缀）：

| 探针 | 结果 |
|---|---|
| `node main.ts`（文件扩展名为 `.ts`，相对 import 写 `./dep.ts`） | 通过，打印 `file-ts-ok 1` |
| 相对 import 漏写扩展名（`./dep`） | `ERR_MODULE_NOT_FOUND` |
| 深引 `./node_modules/fake/index.ts` | `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` |
| 包名 `import 'fake'`（包内只有 `index.ts`） | `Cannot find package .../index.js`（解析层不认 `.ts` 主入口） |
| `.ts` 里写 `enum E { A = 1 }` | 失败（非可擦除） |
| `.ts` 里写 `namespace N { export const x = 1 }` | 失败（含运行时代码） |
| `node -e "const x: number = 1"`（默认，不带 `--input-type`） | 通过（本次复跑，v24.21.0） |
| 显式 `--input-type=module` 的 `-e` / stdin | **未被擦除**：`SyntaxError: Missing initializer in const declaration` |
| 显式 `--input-type=commonjs` 的 `-e` | **未被擦除**（同上）；追加 `--experimental-strip-types` 不改变结果 |
| 同上，但执行目录内的 `.ts` **文件**（非 eval/stdin） | 正常擦除 |

〔口径〕上表关于 eval/stdin 的两行是**已复现的调用差异**，不是「Node eval 完全不支持 TS」：默认 `-e` 可擦除，
一旦显式指定 `--input-type`（module 或 commonjs），eval/stdin 就走不经擦除的路径，追加 `--experimental-strip-types`
也不恢复。官方文档的预期表述与上游 issue 状态本卷未核（U6）。因此**生产验证一律用文件**，不把 eval/stdin 当证据通道；
§8 的 E2/E3/E4 也不依赖 eval 的类型擦除能力。

〔结论〕仓内「相对路径一律写 `.ts`」不是风格偏好，而是 Node 的硬要求；因此**源码轨不能改写成 `.js` 说明符**，
分发轨只能靠编译期重写（§五）。

〔事实〕仓内 1257 处相对 import 全部带 `.ts` 扩展名（`grep -rhoE "from '(\.{1,2}/[^']*\.ts)'"` 统计，排除 node_modules），
零处漏扩展名（同次反向检查无命中）。这条纪律是**已有**且机械可查的。

### 1.3 NodeNext / ESM / 严格开关

〔事实〕`tsconfig.base.json` 的现有取值与含义：

| 开关 | 现值（行） | 作用 | 备注 |
|---|---|---|---|
| `target` / `lib` | `ES2024` / `["ES2024"]`（4-5） | 输出目标与内建类型 | Node 24 支持 ES2024 语法面 |
| `module` / `moduleResolution` | `nodenext` / `nodenext`（6-7） | 按 Node 语义解析 `exports`/扩展名 | 与 Node 24 的 ESM 解析一致 |
| `types` | `["node"]`（8） | 只引入 `@types/node`，不引入全局 DOM | 防止误用 `window`/`document` |
| `strict` | `true`（11） | 严格族总开关 | — |
| `noUncheckedIndexedAccess` | `true`（12） | 索引访问结果含 `undefined` | 迫使行/映射访问显式收窄 |
| `exactOptionalPropertyTypes` | `true`（13） | `x?: T` 不接受显式 `undefined` | 见 §2.1「optional 与 null」 |
| `noImplicitOverride` / `noFallthroughCasesInSwitch` | `true`（14-15） | 覆写与 switch 穿透 | — |
| `noUnusedLocals` / `noUnusedParameters` | `true`（16-17） | 死代码即红 | 对「只写设计不写代码」的文档仓无影响 |
| `erasableSyntaxOnly` | `true`（20） | 禁 `enum`/`namespace`/参数属性/装饰器 | 与 Node strip 对齐的机械保证 |
| `verbatimModuleSyntax` | `true`（21） | import/export 原样保留，类型导入必须 `type` | 与 Node「必须写 type」对齐 |
| `isolatedModules` | `true`（22） | 单文件可独立转译 | 保证无跨文件类型推断依赖 |
| `allowImportingTsExtensions` | `true`（25） | 放行 `.ts` 说明符 | 与 emit 的关系见 §5.3 |
| `noEmit` | `true`（28） | 只做类型门禁 | **构建配置必须显式覆盖**，见 §5.4 |
| `skipLibCheck` / `resolveJsonModule` / `forceConsistentCasingInFileNames` | `true`（29-31） | 跳过 `.d.ts` 内部检查 / JSON 导入 / 大小写一致 | — |

〔结论〕`strict` 族 + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` 三者共同决定本仓的类型书写下限：
任何「行对象上随手点属性」「可选字段显式传 undefined」「索引后不判空」都会编译失败。这不是偏好，是**目标语义的守卫**：
76/77 要求「字段有来源、空值、默认」，若类型层允许隐式 `undefined` 与任意索引，守卫会退化为注释。

〔选择〕不新增第二套宽松配置（例如给测试单独放宽 `strict`）。理由：测试断言的是语义，放宽即改变标尺；
包级 `tsconfig.json` 一律 `extends ../../tsconfig.base.json` 且只在 `include`/`exclude` 上有差异（事实：17 个包级 tsconfig 均如此，2 apps + 15 packages）。

〔事实〕`tsconfig.json:4` 的根门禁只覆盖 `apps/*/src/**/*.ts` 与 `packages/*/src/**/*.ts`；`apps/daemon/tsconfig.json` 也只 `include: ["src/**/*.ts"]`。
测试目录的覆盖缺口登记在 §12。

### 1.4 Bun 的边界

〔事实〕Bun 在本仓承担的**已有**职责，全部可从脚本与文档读出：`bun install`（workspaces 依赖安装）、
`bun run typecheck|test|guard:boundaries`（任务壳）、`bun apps/daemon/src/cli/main.ts …`（开发期直跑 CLI，见 `README.md` Quickstart 4–7 步）；
上述命令的**证据形态**必须写成 `mise exec -- bun …`（§0.3）。
注意 `bun run daemon` 实际执行的是 `node apps/daemon/src/index.ts`（`package.json:21`）——**脚本壳已把运行时交回 Node**；
目标按 80-§3.2 改指 `node apps/daemon/src/cli/main.ts serve`。

〔结论〕Bun 的定位是「装包 + 跑脚本 + 开发便利」，不是出厂验证环境。三条硬理由：

1. `process.features.typescript = transform`（本次探针）：Bun 会转换 `enum` 等语法，Node 24 不会。用 Bun 跑通不代表 Node 跑通。
2. 内建 SQLite 版本不同（Bun 3.51.0 vs Node 24.21.0 的 3.53.4）：`node:sqlite` 的行为（尤其 `STRICT` 表、JSON 函数、错误码）
   不保证等价；ledger 是唯一投影，版本差异属可观测风险。
3. Bun 自报 `process.versions.node = 26.3.0`（兼容层），会绕过 `engines.node: ">=24"` 这类声明式检查，让「在 Bun 下能跑」
   冒充「在受支持的 Node 上能跑」。

〔选择〕目标纪律：
- 生产入口（`apps/daemon`、`apps/boot`、任何 daemon 子进程）**只用 `node` 启动**；
- README/脚本里允许 `mise exec -- bun <file.ts>` 作为开发便利，但同一命令在验收时必须再以 `mise exec -- node` 跑一遍（§8 证据矩阵的「双跑」项）；裸 `bun` 的输出不作证据；
- 任何以 Bun 特有 API（`Bun.*`）写成的代码**一律拒收**——本次全仓 grep `\bBun\.` 零命中，属**已有**约束，目标继续冻结；
- 不用 `bun build --compile` 作为分发等价物（§7.6）。

〔未证〕Bun 1.4.3 对 `node:child_process` 的兼容面（转写方案文档记为 105/116 项）在 1.4.3 上的实际数字未复核；
本卷只据此得出「Bun 不宜承担子进程编排」的保守结论，不引用具体分数。

### 1.5 版本不符的检测与退出

〔目标〕三层检测，逐层给出可执行判据（当前均未实现）：

1. **安装期**：`engines.node` 收紧到 `>=24.21 <25`（现为 `>=24`，见 §12 漂移）并配合 `devEngines`/`.mise.toml`；Bun 侧钉 `1.4.3`。
2. **启动期**：daemon 组合根读 `process.versions.node` 与 `process.features.typescript`，不满足即 fail-fast（写明期望值与实际值），
   不做「尽力继续」。
3. **验收期**：所有证据命令经 `mise exec --` 打印运行时版本（`mise exec -- node -v`、`mise exec -- bun -v`、`mise exec -- tsc -v`）并与 `.mise.toml` 对照；不一致的证据作废。

〔结论〕不满足就拒绝启动，而不是降级运行：因为 strip/transform 的差异会改变**语义**（`enum` 从报错变成可跑），
降级会把「环境错」伪装成「实现对」。

---

## 二、仓内 TypeScript 惯例

### 2.1 稳定习惯（已有，统计口径：本次全仓 grep，排除 node_modules）

| 习惯 | 证据 | 为什么是稳定习惯 |
|---|---|---|
| **对象形状用 `interface`** | 648 处 `export interface`（vs 157 处 `export type`） | 对象可扩展、报错名稳定、`implements` 可用；端口面（`ExecutorAdapter`、`Gateway`）与记录形状（`WorkRecord`）都是 interface |
| **联合/派生用 `type`** | `type WkeyVerifyResult = {ok:true;claims} \| {ok:false;reason}`（`packages/gateway/src/wkey.ts`）、`type MountResult`（`packages/contract/src/ports/company.ts`） | 联合、条件、映射、`z.infer` 派生只能 `type`；用 interface 表达联合会失去穷尽性 |
| **type-only import 显式** | `verbatimModuleSyntax: true`（base:21）+ Node 文档要求 | 不写 `type` 会被 Node 当值导入并在运行期报错；这既是风格也是运行前提 |
| **`as const` + 联合 + 守卫** | 162 处 `as const`；`ERROR_CATEGORIES`（contract/schemas/errors.ts）→ `typeof [number]`（受 `ErrorCategory` 护栏约束）；`EXECUTOR_ERROR_CODES` → `isExecutorErrorCode` | 一份运行时值域 + 一份类型 + 一个守卫，三者同源，禁止手写重复枚举；`category` 只是观测值域，处置仍读 `failure`（§3.4） |
| **`unknown` + 收窄** | 14 处 `z.unknown()`；DB 行用 `SqlRow = Record<string, unknown>` 再经 `str/optStr` 收窄（`packages/store/src/row-helpers.ts`） | 外部输入与 DB 行的类型在边界处必须是 `unknown`；`any` 会静默穿透所有守卫 |
| **无 `enum`/`namespace`/参数属性/装饰器/`any`** | 本次 grep 零命中（`^\s*(export )?(const )?enum`、`namespace`、`: any`、`as any`、装饰器） | `erasableSyntaxOnly` 已机械禁止；零命中说明不是靠自觉 |
| **只读输入、版本化输出** | `readonly` 成员（端口/配置类型）+ `v: z.literal(1)` 载荷版本（wkey PayloadSchema） | 76 要求「引用必须指版本」；类型层的对应物是「输出带版本字面量，输入只读」 |
| **纯净面不持状态** | `core` 零 IO；`prompt`/`gateway` 只依赖 contract（本次 import 图） | 纯函数才可进契约、可重放、可对拍 |

**optional 与 null**（本仓最容易被写错的一条）：

- 〔事实〕`exactOptionalPropertyTypes: true`（base:13）；全仓 `| null` 出现 283 次、`??` 1513 次、`?.` 2186 次。
- 〔结论〕语义分工固定：`x?: T` = 「构造时可以不出现」（缺席）；`x: T | null` = 「字段一定存在，但值可以是空」（SQLite 列、
  外部响应里显式 null）。二者不可互换——`exactOptionalPropertyTypes` 会让 `{x: undefined}` 不能赋给 `{x?: T}`，
  这正是我们要的：**缺席与空值必须由数据形状区分，而不是靠调用方猜**。
- 〔结论〕`optStr/optNum`（`row-helpers.ts`）把 SQLite 的 `NULL` 与 `undefined` 统一收成 `undefined`，是「一处收窄、全域受益」的范例；
  新代码不得在业务层重复写 `v === null ? … : …`。

**精确 optional 与条件展开**（`exactOptionalPropertyTypes` 的配套写法）：

〔目标〕可选字段只在**确实可能缺席**时出现；需要「有值才带键」时用条件展开，而不是塞 `undefined`：

```ts
// 目标写法（示意，不是已存在代码）
const brief = {
  ticket,
  ...(note === undefined ? {} : { note }),
} satisfies TaskBrief
```

〔结论〕这条规则的作用是让序列化/指纹稳定：`JSON.stringify({a: undefined})` 会丢键，但对象形状/哈希可能已经把它算进去，
出现「同语义不同字节」。76 的摘要与 77 的幂等键都要求字节稳定，因此类型层必须禁掉这种隐式差异。

**只读输入/输出版本化**：

- 输入类型（`TaskBrief`、`ServeConfig`、`MountOptions`）字段只读或整体 `readonly`，实现不得就地改写调用方对象；
- 输出记录带显式版本（`v: 1`、`schema_version`、`PORT_VERSION = 'v0'`），版本字面量进类型，避免「同名字段不同义」；
- 〔事实〕`packages/contract/src/ports/index.ts:6` 的 `PORT_VERSION = 'v0' as const` 与 `:7` 的 `PortGrade` 联合就是该惯例的最小样本。
  〔目标〕保持 `v0`，**全部端口仍按 `experimental` 计**（80-§0.3）；本卷不预支 `beta`/`stable`，任何文档、面板或对外 API
  都不得把 `v0` 写成稳定承诺。80 新增的 `contract/src/ports/{intent,secret,resources}.ts` 类型也在此约束内。

**class 与 factory 的选择**：

| 场景 | 选择 | 证据 |
|---|---|---|
| 需要持有跨调用状态、实现端口接口、有方法族 | `class`（`DshAdapter implements ExecutorAdapter`、`YtHttpClient`） | `packages/adapters/src/dsh.ts`、`packages/yt/src/http.ts` |
| 纯函数集合、无内部状态、需要易测/易注入 | 工厂函数返回闭包或普通对象（`createPanelApp`、`createStudioToolsServer`、`openSqlite`、`createUsageFace`） | `panel/src/server.ts`、`studio-tools/src/server.ts`、`store/src/driver.ts` |
| 只需要数据 + 守卫 | 类型 + `as const` 数组 + `isX()` | `contract/schemas/errors.ts`、`ports/platform.ts` |

〔结论〕判据只有一条：**有没有必须被封装的、跨调用的可变状态**。有则 class（并实现端口），没有则 factory/纯函数。
不用 class 表达「命名空间」，也不用 factory 假装有状态。

### 2.2 局部选择（不得升格为仓规）

| 局部选择 | 现状 | 边界 |
|---|---|---|
| `satisfies` | 22 处，绝大多数在测试里（如 `… satisfies EventRecord`、`… satisfies GateDecision`），生产代码少量 | 用途固定为「字面量保持窄类型同时校验形状」。允许在测试构造样本时用，允许在常量表上配 `as const satisfies readonly X[]`；**不要求**每个对象字面量都加 `satisfies`，也不允许用它替代类型标注 |
| branded ID | 全仓 1 处：`ControlKey = string & { readonly __controlKey: unique symbol }`（`gateway/src/wkey.ts`） | 只在「两类同构字符串混用会造成真实越权」处使用（控制面全开 scope 的 key 与按单 key）。普通票据号、工号、slug 不 brand——它们靠构造器与校验收口，不靠类型幻觉 |
| `z.object` 而非 `z.strictObject` | 仅 2 处，均在 `packages/contract/src/cases-schema.ts`（`CaseEntrySchema`、`CaseManifestSchema`） | 契约清单是仓内 authoring 工件、且要容忍未来字段；业务输入一律 `strictObject`（77 处），外部响应一律 `looseObject`。该例外**不推广** |
| interface 里写方法 vs 函数属性 | 端口面用方法签名（`detect(): Promise<DetectResult>`） | 影响 `implements` 与 bivariance；新端口沿用方法签名，不新造第二种风格 |

〔结论〕**不把局部习惯升格**：一条写法若只出现过一两次且有具体理由，它就是局部选择，写进 REVIEW 说明即可，
不进 §2.1、不改 tsconfig、不加 lint 规则。

### 2.3 不过度类型体操

〔选择〕禁止的类型技巧（目标规则）：

- 超过两层的条件类型嵌套、递归映射类型、模板字面量类型做「编译期字符串运算」；
- 用类型系统表达业务不变量（例如用泛型参数追踪状态迁移）——状态迁移归 77 的显式状态表与运行期守卫；
- `infer` 链、`const` 断言链构造「零运行时代码的 DSL」；
- 为「看起来安全」而给每个函数加泛型；泛型只在**调用方决定类型**时使用（`assertRecord<T>`、`z.ZodType<T>`）。

〔结论〕理由是可维护性而非美学：类型体操的报错不可读，而本仓的错误处理要求「失败如实分类上报」（AGENTS 纪律 5）。
类型层报错若无法直读，等于把分类责任推给下一个人。

〔事实〕现实反例就在仓里：`studio-tools/src/server.ts` 的 `McpSchemaOf<T>` 类型桥注明了「经 helper 包装会坍缩泛型」，
并明确写了「zod 类型补齐后应删除本类型与三处内联桥」。这说明类型体操在本仓已有明确的**退出计划**，而不是长期资产。

### 2.4 审查口径

〔目标〕以下算违规（目标审查口径，不是现行新增门禁；仓内现行门禁见 §0.2）：`any`、`as unknown as X` 双跳、`@ts-ignore`、`@ts-expect-error` 无说明、
`enum`/`namespace`（运行时代码）、装饰器、参数属性、相对 import 漏 `.ts`、跨包深引未在 `exports` 声明的路径、
把 `strict` 关掉的包级 tsconfig、用 `satisfies` 掩盖缺失字段。

以下不算违规（允许）：`satisfies` 校验字面量、单处 branded 类型、`z.object` 的契约清单例外、
在测试里用 `expect.any(...)` 放宽断言。

---

## 三、信任边界与解析纪律

### 3.1 五类边界与对应处理

〔结论〕仓内所有「不可信输入」只有五类，每类有且只有一个收口点：

| 类别 | 真实入口（已有） | 收口方式 | 拒绝形态 |
|---|---|---|---|
| 公司目录 YAML（定义包） | `company/validator.ts`、`company/multifile.ts`、`dependencies.ts`、`hooks.ts`、`groups.ts`、`cost-guard.ts` | `yaml@2` 的 `LineCounter` + `parseDocument` + zod `strictObject` | `MountResult = {ok:false, issues:[{file,line,rule,fix}]}` |
| 外部 HTTP 响应（平台） | `yt/src/http.ts` 的 `request(schema, req)`；`taiga` 同构 | 调用方传 zod schema，响应体先 `unknown` 再 parse | 平台错误类：**现状只带 `category/subcause`**（400/401/403→`CONFIG_INVALID`，404/409/429/5xx→`EXTERNAL_REJECT`，细目 `bad-request`/`auth-rejected`/`not-found`/`conflict`/`rate-limited`/`server-error`）；目标补 `failure` 处置轴（409→`conflict`、429/5xx→`unavailable`，§3.4），404 按 80-§5.7「不存在不是失败类」处置 |
| CLI argv | `apps/daemon/src/cli/*`（`argv.ts` 手写解析） | 手写 token 解析 + 显式数值夹取 | 打印用法 + `exitCode=1` |
| SQLite 行 | `store/src/row-helpers.ts` 的 `SqlRow` | 读：`str/optStr/optNum` 收窄；写：`assertRecord(schema, …)` | `configInvalid('<prefix>:<path>', …)` |
| 宿主 config（`agent.yaml`、`daemon.yaml`） | `adapters/src/agentconfig.ts`、`daemon/src/assembly/serve.ts` | `yaml@2` + zod `strictObject`（agent.yaml）；daemon.yaml 目前是**零依赖手写扁平 YAML 子集** | 经 `configInvalid(...)`：`category='CONFIG_INVALID'` + subcause（`agentconfig/parse\|shape\|missing-section\|no-executors\|cap-drift\|unknown-executor`）；目标另填 `failure='rejected_precondition'` |

〔结论〕边界数固定为五，任何第六类输入（例如未来 DSH 插件配置、MCP 工具参数）必须映射到其中之一，
不得在业务函数里临时 `JSON.parse` 后直接点属性。

### 3.2 Zod 的选择规则

〔事实〕本仓 Zod 用法分布（本次统计）：`z.strictObject` 77 处、`z.object` 2 处（契约清单）、
`z.looseObject` 6+ 处（全部在 `packages/yt/src/*` 的外部响应）、`z.unknown` 14 处。
〔事实〕`zod@4.6.7` 的 `~standard.jsonSchema` 类型存在（`node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/standard-schema.d.ts:86`），
`z.toJSONSchema` 也已导出（同包 `v4/classic/external.d.ts:11`）。这支撑 `studio-tools` 把 zod schema 交给 MCP SDK 转 JSON Schema 的**已有**做法。

规则（〔选择〕，目标固化）：

1. **业务输入默认 `strictObject`**：未知键=拒收。理由：76 要求「未知必需扩展拒绝」，而 YAML 里多写一个拼错的键是最常见的
   静默失效源（`enabled: ture` 之类）。
2. **外部响应默认 `looseObject`**：平台会加字段，未知字段保留但不获得语义（77「外部未知」）。**不得**把 `looseObject` 用于
   公司目录或自身台账。
3. **解析后窄化**：`safeParse` 成功即得到窄类型；失败必须转成结构化错误，不得把 zod 的 `ZodError` 直接抛给上层。
   **现状**只能填 `category×subcause`；**目标**按 §3.4 填 `failure`/`category`/`subcause` 三键（缺 `failure` 即不合格）。
   已有范例：`row-helpers.ts` 的 `assertRecord` 只取首个 issue 的路径拼 subcause。
4. **业务对象不重复弱校验**：同一对象不在「装载」和「写入」两处各写一套宽松 schema。事实依据：store 只在写口 `assertRecord`，
   读口用 `str/optStr` 收窄——读口不再跑 zod。目标继续如此：**校验一次，之后靠类型**。
5. **不引入 Ajv 作为运行时第二事实源**：冻结 JSON Schema 是交换工件与参考 authoring，运行时判定仍走 zod（或手写规则）。
   理由与证据见 §9 的 `DEP-AJV`。
6. **JSON Schema 只离线生成、只做冻结**：允许从 zod **离线**生成冻结 JSON Schema，并做「源码 ↔ 冻结工件」的漂移检查；
   **禁止** `z.fromJSONSchema()` 反向生成，**禁止**运行时重新生成权威工件（`z.fromJSONSchema()` 是实验能力，75-D75-08 已禁）。

### 3.3 YAML 的边界

〔事实〕仓内 YAML 用法两类：`parse()`（整段读，`agentconfig`、`dependencies`、`git-import`）与
`parseDocument()` + `LineCounter`（要行号定位，`validator`、`multifile`、`hooks`、`groups`、`cost-guard`、`type-inbox`、`state-hygiene`）。
〔事实〕`validator.ts` 头注明写「行号定位：yaml@2 LineCounter + AST 节点 range，zod 路径回爬取最近祖先节点行」。

〔目标〕限制（当前未实现，必须补齐）：

1. **别名/锚点**：只允许「同文档内、有限次数」的别名；出现递归别名、跨文档别名一律拒绝（YAML bomb 的入口）。
2. **规模上限**：单文件字节数、节点数、嵌套深度设上限，超限=结构错误（不是崩溃）。
3. **不执行任何标签**：只接受核心 schema 的标量；`!!js/*`、自定义 tag、`<<` 合并键的行为必须显式定义（拒收或按字面量）。
4. **行号必须进诊断**：任何 YAML 拒绝都要给 `file:line`，否则 `DirectoryIssue` 的 `line` 会退化成 0，面板与 CLI 的修法提示失效。
5. **daemon.yaml 的扁平子集是临时形态**：`serve.ts` 头注已承认「真 YAML 装载归后续刀」；目标是用同一套 `yaml@2` +
   行号，不得长期维持两套 YAML 语义。

〔结论〕YAML 是**数据**不是代码；「模板求值」「条件展开」若出现在定义包里，按 75-§4.3 判负（目标审查口径）。

### 3.4 错误模型：`failure`（处置）× `category`（观测）× `subcause`（细目）

〔事实〕**现状是单轴**：`packages/contract/src/ports/kernel.ts:98` 的 `ClassifiedError` 只有
`{ category: ErrorCategory; subcause: string; detail?: string }`；`ErrorCategory` 的 11 值定义在同文件 `:85`–`:96`，
运行时投影在 `packages/contract/src/schemas/errors.ts` 的 `ERROR_CATEGORIES`（11 类）与 `EXECUTOR_ERROR_CODES`（3 码），
并有编译期护栏 `ErrorCategoryProjectionComplete`（数组漏项即编译红）。`ClassifiedErrorSchema`（`errors.ts:44`）同样是
`category/subcause/detail` 三键、无 `failure`。统一抛错通道是 `configInvalid(subcause, detail?)`（`errors.ts:54`）：
构造 `Error` 并挂 `category/subcause/detail`，返回类型 `never`。
**现状没有 `failure` 字段，也没有 80-§5.7 的目标构造器**（本卷暂称 `classified(...)`，命名与落点归 81）：
处置只能靠 `category` 或 `subcause` 文本反推——这正是要修的目标，不是现状已满足。`ErrorCategory` **不是**处置源，
现状之所以看起来像处置源，是因为缺了 `failure` 这一轴。
〔事实〕预期失败用 tagged union：`MountResult`、`WkeyVerifyResult`、`SplitParseResult`、`PluginInstallAction`（6 值联合）。

〔目标〕按 80-§5.7 改为**两轴一个载体，职责不得互换**：

```ts
// 目标形状（示意；现状无 failure 字段）
type FailureClass =            // 77-§11.1 的 14 值，snake_case 原样
  | 'rejected_precondition' | 'rejected_authority' | 'rejected_forbidden' | 'rejected_state'
  | 'rejected_version' | 'rejected_idempotency' | 'unsupported' | 'unavailable'
  | 'unverified' | 'partial' | 'conflict' | 'timeout' | 'cancelled' | 'degraded'

interface ClassifiedError {
  failure: FailureClass        // 处置轴：重试/断路/对账/升级/判等只读它
  category: ErrorCategory      // 观测轴：只喂事件 note 与告警分桶，不驱动业务处置
  subcause: string             // 实现细目（config-yaml-nested、digest-mismatch…）
  detail?: string              // 人读补充；过脱敏，不含秘密与绝对路径（§7.4）
}
```

〔目标〕构造器 `classified(...)` 的职责（行为按 80-§5.7，实现归 81）：

1. **`failure` 必填**，词表冻结为 77 的 14 类；不造第 15 个，不用连字符/驼峰改写（`rejectedPrecondition`、
   `rejected precondition` 一律判负）。
2. **`category` 由构造器按缺省表填**，领域代码只在有明确上下文时显式覆盖：合并域写 `MERGE_CONFLICT`；
   只有手里有 lane 标识的泳道/派工闸才可写 `NO_LANE`（缺省不是 `NO_LANE`）。其余映射照 80-§5.7，不在本卷复制第二张表。
3. **构造器拒收** `GATE_FAIL`/`WORKER_DEAD`/`QA_BACK`/`DISPATCH_FAIL`/`LLM_FAIL` 这 5 个故障域：`Err` 可达的
   `category` 只有 `CONFIG_INVALID`/`EVOLVE_REJECT`/`EXTERNAL_REJECT`/`STALL`/`MERGE_CONFLICT`/`NO_LANE` 六个。
4. **`subcause` 非空**且是机器可比对键；`detail` 只给人读。空串等同丢失分类（`errors.ts` 现有注释，目标保持）。
5. **`configInvalid(...)` 目标固定** `failure:'rejected_precondition'` + `category:'CONFIG_INVALID'`；内部编程错误
   （断言失败、不可达分支）另用 `subcause:'internal-bug'`，不新造 `failure`。

形态选择（〔选择〕；与 80-§5.7 的三种返回形态一一对应）：

| 情形 | 形态 | 判据 |
|---|---|---|
| 调用方**必须分支处理**的预期失败（校验不通过、写闸拒绝、平台拒绝） | `Result<T, ClassifiedError>` / 既有 tagged union `{ok:true,…} \| {ok:false,…}` | 返回值出现在正常类型流里，编译器强制分支 |
| 违反前置条件、无法继续（配置非法、不变式破坏） | `throw` 带 `failure/category/subcause` 的 `ClassifiedError` | 调用方不该「局部处理」，而应让整条链失败并落账 |
| 外部可重试失败（429/5xx/网络） | 分类后的 `ClassifiedError` + 上层按 `failure` 决策（退避/对账/只补未完） | 重试策略归 core/engine，不在边界层自旋 |
| 不可恢复的编程错误 | 原生 `Error`（`TypeError` 等） | 不包装、不吞 |

〔结论〕**禁止用字符串错误码替代 `failure×category×subcause`**，也禁止把 tagged union 的 `ok:false` 再抛成异常
（一处失败两种形态会让 77 的「失败分类上报」无法机械核对）。同样**禁止把 `category` 当处置判据**：
`timeout`/`unavailable`/`partial`/`cancelled` 分别对应先对账/退避/只补未完/不重试，压成「整体重试」即判负；
也不得因 `category='STALL'` 就给 `conflict` 开改进单。
〔结论〕**旧 `category` 分支保留为缺省档**，只在 `failure` 缺位时生效；新代码先读 `failure`（80-§5.7）。
迁移期事件 note **双写** `failure` 与 `category`，旧读方继续读 `category`；旧 `Err` 的 `failure` 由构造器按
`subcause` 白名单补，补不出写 `rejected_precondition` + `subcause:'unknown-failure'` 并单列告警——这只是过渡补值，
**不得**写进契约。

〔事实〕`EXECUTOR_ERROR_CODES` 已冻结 `AUTH`/`MISSING_CREDENTIAL`/`EXTERNAL_RATE_LIMIT`，并明确「词表只增不改，加码走批示」。
〔选择〕该词表属于**实现内部**，是 executor 域 `subcause` 的受冻结值域，**不是**第三路由键；它一旦被写进台账/契约，
就变成可观测接口，改动需按迁移处理。

### 3.5 注入面：时间、ID、随机、fetch、CLI、fs

〔事实〕仓内已有注入点（本次 grep）：`now: () => number` 11 处、`clock` 相关标识约 1000 处（含变量名与注释）、
`FetchLike`（`packages/contract/src/ports/models.ts` 与 `matrix` 共用）、`YtHttpClient(baseUrl, token, fetchLike)`、
`execa` 仅在适配器内直接使用（4 文件）、`node:child_process` 在 daemon 12 处（多为测试与沙箱）。
〔事实〕生产 `src` 里几乎不出现 `Math.random()`（零命中于 src），`Date.now()` 158 处（多数在装配与日志），
`process.env` 145 处（凭据与端口开关）。

〔目标〕六条注入纪律：

1. **时间**：业务判定只接受 `now()`/`clock` 参数；模块顶层不读 `Date.now()`。已有范例：`createPricingFace(db, now)`、
   `WkeyVerifyCheck.now`。例外：日志时间戳可在装配层取。
2. **ID**：单据号/事件 id 由调用方或 `node:crypto` 生成器产生，不在纯函数里生成。已有范例：`randomUUID()` 在适配器边界，
   core 只接收 id。
3. **随机**：纯逻辑不得用随机数；需要的「抖动」由注入的 `random()` 提供，测试可确定化。
4. **fetch**：一律注入 `FetchLike`，不直接引用全局 `fetch`（便于测试与出站白名单）。
5. **CLI/子进程**：只在适配器与 assembly 层出现；core/prompt/gateway 不得 import `node:child_process`、`execa`。
6. **fs**：只在 company/store/panel/assembly/evolve 出现；纯面（core/prompt/gateway/contract）零 fs——本次 import 图已满足，
   目标用静态检查固定（见 §10.3）。

〔结论〕注入不是测试技巧，而是 78 的绑定可替换性的前提：换宿主/换传输时，只替换注入实现，不改业务分支。

### 3.6 纯面清单

〔事实〕本次 import 图：`contract` 只依赖 zod；`core` 依赖 contract + zod + yaml；`gateway` 依赖 contract + zod；
`prompt` 运行时 import 只有 contract（manifest 另声明 company 与 zod：company 是零 import 的休眠边，zod 零使用，见 §10.1）；
`matrix`/`taiga` 只依赖 contract；`localplatform` 只依赖 contract。
〔结论〕纯面（零 IO）为 `contract`、`core`、`gateway`、`prompt`。`core` 引入 `yaml`（价目表/模型表解析）属于**输入解析**，
不构成 IO；`prompt` 运行期零外部 IO，是最干净的层。
〔目标〕纯面禁止新增：`node:fs`、`node:http`、`node:child_process`、`execa`、`hono`、任何网络/时钟全局。
〔事实〕`packages/core/src/secrets.ts` 是纯函数（零 IO、knowns 只做值比对），是「安全逻辑可以纯」的范例。
〔事实〕**现状 `packages/core/src/index.ts:82` 是 `export * from './secrets.ts'`**——整模块通配转发，**不是**具名 re-export。
具名转发是迁移目标的形态，不是现状。
〔目标〕该模块的归属是 `contract/src/secrets.ts`（80-§11.2-3）：三个运行时导出 `redactOutbound`/`redactKnownSecrets`/`findSecretShaped`
连同 `SecretShapeFinding`、三条正则、`REDACT_MARK`、`MIN_KNOWN_LENGTH` 整模块迁入，并进入 `contract` 公共面；
`core` 只做具名 re-export（`export *` 不用），不留第二套实现或第二份正则。`<redacted:N>` 标记形与
`packages/core/test/secrets.test.ts` 的断言是冻结验收口径，迁移不改语义。`core→contract` 是既有允许边（§6.1 L1/L2），
迁移不新增依赖；`api`/`panel`/`gateway`/`studio-tools` 经 `contract` 复用（对应的边已在允许表内），
不得为取脱敏新增到 `core` 的导入。

### 3.7 缺口与未证

〔未证〕YAML 别名/深度上限目前**没有**实现证据（`validator.ts` 只做形状与行号）；ReDoS 面未做模糊测试；
zod 解析在超大输入下的耗时未测。以上归 82 的 V4（故障与安全）执行，本卷只登记为必须验证项。

---

## 四、模块与导入规则

### 4.1 NodeNext 的解析规则（已有，机械可查）

〔事实〕包间导入一律用包名：`@studio-next/contract`、`@studio-next/daemon/serve`、`@studio-next/panel/overview`、`@studio-next/panel/external`。
仓内**两个包**有跨包子路径：`daemon` 2 条（`./engine`、`./serve`）与 `panel` 4 条（`./overview`、`./external`、`./inbox`、`./judge`）；
其余 15 个包只有 `"."`（本次逐包读 `exports`）。
〔事实〕包内导入一律相对路径 + `.ts`（1257 处，无例外）。
〔事实〕`boundary-rules.mjs:102-142` 的允许边与各包 `package.json` 声明做「并集一致」；`packageLayers`（79-96）给出层位。

规则：

1. 相对导入必须带 `.ts`；不得写 `./x`、`./x.js`、目录导入（`./x/`）。
2. 跨包只能走 `exports` 里声明的子路径；未声明的深引（`@studio-next/panel/src/views.ts`）按目标审查口径判负（现行无该机械门禁）。
3. 包内不得用 `paths` 别名（base 未配置 `paths`，Node 也不读）；需要短名就开子目录 + `index.ts`。
4. 只导出**接口面**：`src/index.ts` 是包的公开面，内部文件不得被跨包直接引用（`apps/boot` 引用 `daemon/serve` 是已冻结的例外）。
5. 类型环：只允许 `import type` 形成的类型边；运行期环判负（现状由 `mise exec -- bun run test` 前置的边界 guard 与单测覆盖）。

### 4.2 import attributes

〔事实〕仓内唯一使用处是测试：`import manifest from '../../contract/cases.json' with { type: 'json' }`
（`packages/yt/src/plat-cases.test.ts`、`packages/localplatform/src/plat-cases.test.ts`）。
〔事实〕TS 5.7 起，`module: nodenext` 下 JSON 导入**必须**带 `with { type: "json" }`，否则报错（release notes 明列）。

〔选择〕
- 生产代码尽量不在运行期 import JSON；确需时（例如模板清单）走 `readFile + JSON.parse + zod`，以便给 `file:line` 与错误分类。
- 构建轨注意：`rewriteRelativeImportExtensions` **只重写 `.ts/.tsx/.mts/.cts` 相对说明符**，不碰 `.json`；
  因此 JSON 说明符在源码与产物中保持一致，无需额外处理（但 `with` 属性必须保留——tsc 会保留，Node 24 支持）。

### 4.3 动态 import 白名单

〔事实〕生产 `src` 只有 1 处动态 import：`apps/daemon/src/assembly/serve.ts:1495`
`const { loadCompanyDirectory, readDirectoryFiles } = await import('@studio-next/company')`（公司目录装载的惰性引入）。
其余 `await import(...)` 全部在测试里（`node:fs`、`../../src/...`、`@studio-next/company`）。

〔选择〕白名单三条，逐条给理由：

1. **装配层的惰性重依赖**（如上例）：只在某个配置分支需要时加载，缩短 daemon 冷启动；
2. **测试内的按需引入**：避免测试文件顶层副作用；
3. **不用于绕开依赖方向**：动态 import 不得用来制造「表外依赖边」——guard 扫的是字面量，`import()` 同样计入，
   所以白名单不放松边界纪律。

〔结论〕**禁止计算说明符**（`import(someVar)`）：TS 的 rewrite 会为此注入运行期 helper（`__rewriteRelativeImportExtension`），
产物多一段隐式逻辑；且静态分析失效。当前 src 零命中，目标冻结为零。

### 4.4 源码态与构建态的接口边界

〔结论〕一个包有两个「公开面」，必须分别说清：

| 面 | 载体 | 消费者 | 约束 |
|---|---|---|---|
| 源码态 | `src/index.ts` + `exports` 指向 `./src/*.ts` | 仓内其他包（Node 24 直跑 / vitest） | 只对仓内承诺；不得对外发布 |
| 构建态 | `dist/index.js` + `dist/index.d.ts` + `exports` 指向 `./dist/*.js` | npm/DSH 消费者（Node 24 不 strip `node_modules` 下的 TS） | 一旦切换即为对外契约，类型与运行时必须同版本 |

〔结论〕「不 strip `node_modules` 下的 TS」不等于「任何安装方式都不能跑 TS」：pnpm 的本地路径安装是 `link:`（docs/34-§3.1 B2 真机），
Node 默认按 realpath 解析（未加 `--preserve-symlinks`），实体在 `node_modules` **之外**，因此可擦除 TS 仍能运行。
正因为结果**取决于安装方式**，插件包不能靠 `.ts` 分发；`dist` 是唯一与安装方式无关的保证（§6.1、§7.2）。

〔选择〕两态**不能同时**作为 `exports["."]` 的默认解析目标；切换是包级原子动作（§6.1）。理由见 §6.3 的失败模式。

〔选择〕**切换包的 `src` 退出根 program**（本卷采用的唯一合法形态，取代「src 与 dist 两套类型身份并存」）：
- 根 `tsconfig.json` 的 `include` 从通配改为**未切包枚举**（或对已切包加 `exclude`），使根 `tsc --noEmit` 只检查
  未切包 `src` 与跨包调用面；切换包的源码类型由该包自己的 `tsconfig.json`（`tsc --noEmit -p packages/<pkg>/tsconfig.json`）负责。
- **凡 `src` 退出根 program 的包，必须把该包的 `tsc --noEmit -p packages/<pkg>/tsconfig.json` 显式串入根 `typecheck`**：
  包级检查是根门禁的**必需组成**，不是手动建议；漏跑一个已切包即视为门禁失效（脚本退出码必须反映）。
  根门禁不因 `src` 退出 program 而少测。
- **当前切换集为空**：根 `tsconfig.json:4` 仍覆盖 `apps/*/src/**/*.ts` 与 `packages/*/src/**/*.ts`，
  根 `"typecheck": "tsc --noEmit"` **没有**任何包级串接。因此现状下 32 个 `src/*.test.ts` 已在根 program 内；
  它们不是缺口。切换后这些文件由包级 `tsc -p` 承接（包级 `tsconfig.json` 至少 `include: src/**/*.ts`；少数包还含 `test/**`，见 D10）。
- **`test/` 目录是另一个门禁缺口**（§12-D10），既不进根 program，也不在该包 `tsconfig.json` 的 `include`（多数包如此）。
  本条**不**要求把 17 个包的 `test/` 一并串入，也不得把「已切四个带 `test/` 的包」写成现状——当前一个包都没切。
- 依赖侧一律读切换包 `exports.types` 指向的 `dist/*.d.ts`；dist 的新鲜度由构建闸（指纹 + `--listFiles`，§5.6）保证。
- **禁止同一包 `src` 与 `dist` 双类型身份混用**：不得让一部分消费者解析 `src`、另一部分解析 `dist`；同一进程内也不得
  同时加载同一包的两种形态（需要两者时，源码套件与 dist smoke 分进程/分套件执行）；也不得用 `paths` 把运行期解析引回 `src`（§6.3）。
  不需要引入 project references（§6.4）——包级 `tsc --noEmit -p` 只是逐包检查，不建立增量构建图。

〔目标〕切换一个包时需同步改三处（同一单内）：
1. 根 `tsconfig.json`：把该包从 `include` 移除（或加入 `exclude`），未切包仍留在根 program；
2. 该包 `package.json` 的 `exports`/`main`/`types` 指向 `dist`（§6.2），`files` 按 §7.1；
3. 该包自己的 `tsconfig.json` 仍 `include: ["src/**/*.ts"]`（源码类型检查不随分发形态消失）。
同时把该包显式加进根 `typecheck` 的已切包串接（增删切换包时同步）。

〔目标〕根脚本形态（示意，不是已创建文件）：
- **现状**：`"typecheck": "tsc --noEmit"`（切换集为空，仅根 program）。
- **切换后**：`"typecheck": "tsc --noEmit && tsc --noEmit -p packages/<pkg>/tsconfig.json && …"`（每个已切包一段），
  或按当前切换集逐包显式串接 `mise exec -- bun run --filter '@studio-next/dsh-bridge' typecheck` 等；
  **候选首链四包**是 `@studio-next/dsh-bridge`、`@studio-next/contract`、`@studio-next/gateway`、`@studio-next/studio-tools`，
  它们是「计划切换集」，**不是**当前切换集。不得用会命中全部 workspace 的 `@studio-next/*` 代替已切包清单。
门禁顺序不变：先 `mise exec -- node ./node_modules/typescript/bin/tsc -p packages/<pkg>/tsconfig.build.json --listFiles`
（E2，产生 dist），再 `mise exec -- bun run typecheck`（根 program + 已切包包级检查，缺一即红），再测试；
与 §6.1 的 build → typecheck → test 一致。

〔未证〕该策略尚未在仓内实测（当前无切换包）：U13 验证构建产物与 `--listFiles` 拓扑，U14 验证双加载。
运行时风险必须 spike：同一包若同时被 `import '@studio-next/x'`（dist）与相对路径/源码入口加载，
会出现两份模块实例——`instanceof`、私有 `class`、branded 类型在运行期不成立。本卷只**禁止**双身份，
未证明仓内不存在双加载路径；登记为 §15 的 U14（归 82）。

### 4.5 循环依赖

〔事实〕现状：`store` 的 devDependency 是 `core`（测试用），运行期 `store` 只依赖 `contract`；`company` 运行期依赖 `store`；
`panel` 运行期依赖 `store` + `company`（但 company 被错放在 devDependencies，见 §10.1）。方向表与 manifest 有一处不一致，
但运行期无环。
〔目标〕新增边必须同时满足：方向表允许、manifest 声明、无运行期环。三者缺一即为「影子依赖」，按 §10.3 处理。

---

## 五、源码/分发双轨构建（目标设计，未创建任何构建文件）

### 5.1 双轨是什么

〔结论〕本仓同时需要两种运行方式，且**只能有一份源码**：

- **源码轨**：Node 24 直接执行 `src/**/*.ts`（strip），用于仓内开发、测试、daemon 运行；
- **分发轨**：`tsc` 发射 `dist/**/*.js` + `dist/**/*.d.ts`，用于 npm/DSH 消费者。

〔结论〕分发轨不可省略的原因不是偏好，而是 Node 的硬规则：`node_modules` 下的 `.ts` 会被拒绝（§1.2 探针）。
只要一个包要离开本仓，就必须有 JS。

### 5.2 目标构建配置（**目标设计，不是已创建文件**）

〔目标〕每个需要分发的包新增一份 `tsconfig.build.json`，从 `tsconfig.base.json` 继承，只在下列键上覆盖：

```jsonc
// 目标设计（示意）。本卷不创建此文件；实际落位与命名归 81。
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    // 1) 必须显式关掉继承来的 noEmit——否则整条构建是空跑（见 §5.4 探针）
    "noEmit": false,

    // 2) 产物与声明
    "declaration": true,
    "declarationMap": false,          // 默认即 false；只有随包发 src 时才考虑 true
    "outDir": "dist",
    "rootDir": "src",

    // 3) 源码里是 .ts 说明符，发射时重写成 .js（TS 5.7+）
    "rewriteRelativeImportExtensions": true,
    "allowImportingTsExtensions": true, // 5.9.3 下可与 rewrite 共存，见 §5.3

    // 4) 默认不开；若开，.map 的 sources 必须过 §7.4 的泄漏检查（不得含本机路径）
    "sourceMap": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "test/**/*.ts"]   // 测试不进产物
}
```

逐项说明（自然语言）：

- `noEmit: false`：基类是 `noEmit: true`（`tsconfig.base.json:28`）。**不覆盖就等于没构建**——tsc 会以 0 退出且不产任何文件。
  这是本仓最容易踩的坑，因为「exit 0」会被误读成「构建成功」。
- `declaration: true`：能力包必须带 `.d.ts`。TS 的默认值是「false，除非 composite」（本次从 `typescript.js` 的
  `optionDeclarations` 读出），所以必须显式开。
- `declarationMap` 默认 `false`（同源读出）。只有**同时随包发布 `src/`** 时才有意义；否则 `.d.ts.map` 指向包内不存在的文件，
  编辑器会跳空。若要开，`files` 必须包含 `src/`，且要过 §7.4 的本机路径/秘密检查。
- `outDir` + `rootDir`：`rootDir` 默认「由输入文件列表推导」（同源读出），不显式写会导致 `dist/src/...` 这类多余层级。
  目标形状固定为 `dist/index.js`、`dist/cli/main.js` 等，与 `src` 同构。
- **`rootDir: "src"` 是构建拓扑的硬前提**：tsc 会把 `import` 解析到的**所有**输入文件纳入 program。若某个 workspace 依赖的
  `exports` 还指着 `src/*.ts`，该文件就在本包 `rootDir` 之外 → `TS6059`（File is not under 'rootDir'），或产物里出现
  `dist/../packages/<dep>/src` 之类的层级。因此**依赖必须先切 dist**（§6.1）；不得靠放宽 `rootDir`、加 `paths` 或
  `skipLibCheck` 绕开——那只是让产物带上一份别包的源码副本，发布后再也说不清哪份在跑。
- **依赖 dist 缺失或陈旧 = 构建失败**：构建前置检查依赖包的 `dist` 存在且指纹与源码一致；不满足即停，不得静默回落到源码。
  `exports` 指 dist 时运行时本就不会回落，这正是要用 dist 的原因——回落只可能发生在构建配置里，必须显式禁掉。
- `rewriteRelativeImportExtensions: true`：把相对 `.ts` 说明符改写成对应 JS 扩展名（`.ts→.js`、`.mts→.mjs`、`.cts→.cjs`）。
  官方只对**相对路径**生效：包名、`paths` 别名、`#` imports 都不重写（TS 5.7 release notes 明列）。
- `exclude` 测试：`src/**/*.test.ts` 与 `test/**/*.ts` 都排除。理由：测试不进产物，且测试文件常引入 `vitest`，
  进产物会逼着把 vitest 变成运行时依赖。

### 5.3 TS 5.9.3 的选项交互（易被旧文案写错的地方）

〔事实〕仓内实锁 `typescript@5.9.3`（`bun.lock:475`）。直接读该版本编译器源码：

- 诊断 5096 的触发条件已包含 `rewriteRelativeImportExtensions`：
  `if (options.allowImportingTsExtensions && !(options.noEmit || options.emitDeclarationOnly || options.rewriteRelativeImportExtensions))`
  （`node_modules/typescript/lib/typescript.js:129305`）。也就是说**开着 rewrite 时，`allowImportingTsExtensions` 与发射可以共存**。
- 计算选项 `allowImportingTsExtensions` 的取值是
  `!!(compilerOptions.allowImportingTsExtensions || compilerOptions.rewriteRelativeImportExtensions)`（同文件 21900-21903 行）：
  只要开了 rewrite，`.ts` 说明符就已被放行。

〔结论〕旧文案「`allowImportingTsExtensions` 必须配 `noEmit` 或 `emitDeclarationOnly`，所以不能构建」**对 5.9.3 不成立**。
正确表述是：`allowImportingTsExtensions` 的**独立**使用仍受该限制；一旦 `rewriteRelativeImportExtensions: true`，
它可以与 `declaration`/普通 JS 发射同时开启。本仓目标配置因此两项都写 `true`（写 `allowImportingTsExtensions` 是为了让
源码轨（`noEmit` 门禁）与构建轨共用同一份源码语义，不必两套说明符）。

〔结论〕源码轨与构建轨**共用 `.ts` 说明符**，是这套组合的关键收益：若源码写 `.js` 说明符，Node 直跑会 `ERR_MODULE_NOT_FOUND`
（本次探针：`./dep` 与 `./dep.js` 都不存在），所以只有一条路——源码写 `.ts`，发射时重写。

### 5.4 三个陷阱（都有本次探针证据）

**陷阱一：`noEmit` 被继承。** 基线 `noEmit: true`；构建配置忘写 `noEmit: false` → tsc 退出 0、`dist/` 不存在。
判据不能只看退出码，必须看产物清单（§5.6）。

**陷阱二：`noEmit` 与 `emitDeclarationOnly` 同时为真 → 零产出但退出 0。**
本次探针：配置 `declaration:true + emitDeclarationOnly:true + noEmit:true + outDir:dist2` 实跑 `tsc -p`，
结果 `EXIT=0` 且 `dist2` 目录**根本未创建**，无任何告警。这直接证明了任务书里的那句话：
**不能把 `noEmit` + `emitDeclarationOnly` 的零产出写成构建成功**。

**陷阱三：`.d.ts` 里的说明符不会被重写。**
本次探针（TS 5.9.3，`declaration:true` + `rewriteRelativeImportExtensions:true`）：

| 产物 | 内容 |
|---|---|
| `dist/a.js` | `import { b } from "./b.js"`（已重写） |
| `dist/a.d.ts` | `import { type B } from './b.ts'`（**仍是 `.ts`**） |
| `node dist/a.js` | 正常执行 |

〔事实〕成因可从源码读出：JS 发射走 `transformModule` 的 `rewriteModuleSpecifier`（`typescript.js:117725`/`97423`），
而声明发射的 `rewriteModuleSpecifier2` 只在 bundled emit 时改名（`typescript.js:119060-119070`），**不做 `.ts→.js` 重写**。

〔事实〕TS 的声明解析对 `.ts` 说明符有内建降级（resolver 层证据）：`shouldAllowImportingTsExtension` 在声明文件里恒为真
（`typescript.js:46596-46598`），`loadNodeModuleFromDirectory(Declaration, …)`（同文件 `:46592-46593`）与扩展名映射中
`.ts`/`.d.ts` 的 Declaration 分支（`:45483-45487`）会把 `./b.ts` 落到同级 `b.d.ts`；本次三组 `module`/`moduleResolution`
消费者探针（§5.5）也全绿。
〔结论〕在已跑的三组 `module`/`moduleResolution` 消费者配置下，TS 侧**不需要**默认后处理步骤，也不需要打包器；
`checkJs`/JSDoc 同属 TS 语言服务但本卷未单列验证（U1），不能据此宣称「所有 TS 消费者都已证」。
**纯 JS 消费者与 bundler** 对 `.d.ts` 里 `.ts` 说明符的处理仍是 spike 项（U1）；只有出现具体反例时才另议后处理，
且必须是独立、幂等、可回退的步骤。

### 5.5 声明内说明符与消费者兼容

本次已做的最小探针（`/tmp` 临时目录，用仓内 tsc，已删除）：

| 消费者配置 | 结果 |
|---|---|
| `module: nodenext` + `moduleResolution: nodenext`，`import { av } from '../dist/a.js'` | 通过 |
| `module: node16` + `moduleResolution: node16` | 通过 |
| `module: esnext` + `moduleResolution: bundler` | 通过 |

〔结论〕上面三组 **`module` / `moduleResolution` 组合**的消费者探针全绿，且源码级证据给出声明降级路径（§5.4）。
`checkJs`/JSDoc 走同一 resolver 家族，但本卷**未单列验证**，不得写成「三配置全绿 = 所有 TS 消费者已证」；
它归 U1 的 spike 清单，验证前不下「TS 消费者全部兼容」的结论。

〔未证/spike〕以下仍须在独立 workspace 里逐项 spike（归 82 的 V2/V3），未过不得宣布「可发布」。
其中 `checkJs`/JSDoc 虽属 TS 语言服务，本卷未单列，按同样方式补跑：

1. **非 TS 的文本型消费者**读 `.d.ts`（API 提取器、只做文本/AST 解析的文档工具）遇到 `.ts` 说明符的行为；
2. `exports` 中 `types` 指向 `./dist/index.d.ts`、而 `index.d.ts` 再引 `./x.ts` 时，上述工具的可解析率；
3. 打包器（esbuild/rollup/webpack）解析 `.d.ts` 说明符的行为（它们不承担类型解析，但可能做路径改写）；
4. **后处理只在出现具体反例时才评估**（把 `.d.ts` 里的 `.ts` 确定性改写成 `.js`）；它不是默认步骤，若做必须是幂等、可校验、
   可回退的独立步骤，且不能改写用户可见的语义；
5. 若未来选择「随包发 `src/`」，`.d.ts` 的 `.ts` 说明符能否直接指向包内源码，以及 `declarationMap` 的 sources 是否泄漏本机路径。

### 5.6 产物形状与源码轨的一致性

〔目标〕
- `dist` 与 `src` 同构；`exports` 的每个子路径都指向 `dist/<同名>.js`，且同级有 `<同名>.d.ts`；
- `package.json` 的 `files` 只含 `dist`、必要的数据/文档/许可文件（§7.1），**不含** `src`（除非刻意随包发源码并接受 §5.5-5 的检查）；
- `dist` 进 `.gitignore`（现状 `.gitignore` 已有 `dist`，**已有**），产物只由构建产生，不手工提交；
- 构建前后各算一次源码指纹（`sha256` 排序文件表），产物与指纹一起登记，防止「dist 比 src 旧」；
- **拓扑断言**：E2 额外跑 `tsc -p … --listFiles`，断言输出中不出现本包之外的 `packages/*/src/**` 或 `apps/*/src/**`。
  出现即说明依赖未切 dist 或解析回落源码——按构建失败处理，不得用放宽 `rootDir`/`paths` 掩盖。

〔结论〕「构建成功」的判据是**五条同时成立**：退出码 0、`dist` 文件清单非空且与预期集合一致、`dist/index.js` 可被 Node 24 直接
`import`、`dist/index.d.ts` 能被消费者 tsc 解析、`--listFiles` 不含本包之外的 workspace 源码。只看退出码就是陷阱一/二。

### 5.7 不做什么（构建面）

- 不引入 bundler 作为库构建（`tsc` 足够，且保留逐文件模块边界；bundler 会把内部模块合成一个文件，破坏子路径导出）；
- 不用 `emitDeclarationOnly` 当「先出类型后补 JS」的两步构建（本仓没有这种需求，且易与 `noEmit` 组合出零产出）；
- 不把测试编进产物，不把 `vitest` 变成运行时依赖；
- 不为构建新增 `paths`、`baseUrl`（Node 不读，rewrite 也不处理，必然出错）。

---

## 六、package exports 与 dist 切换策略

### 6.1 先切谁：构建拓扑是硬前提

〔事实〕现状：17 个 workspace 包全部 `private: true`，`main`/`exports` 指向 `src/*.ts`（`boot` 是 `main: "src/boot.ts"`、
`exports["."]: "./src/boot.ts"`，不是 `src/index.ts`）；`daemon` 还有 `bin: ./src/cli/main.ts`。

〔结论〕两条判据必须分开：
- `private` 只表示不发布，**不等于可以发布**；
- 「全部 private」也不构成「都该切 dist」。

〔结论〕**硬前提**：一个包可切 dist ⇔ 它**全部 workspace 依赖已切 dist 或零 workspace 依赖**。理由不是流程偏好，而是
tsc 的 program 构造：`rootDir: "src"` 下，依赖的 `src/*.ts` 一旦被解析进 program 就越界（TS6059）或污染产物（§5.2）。
所以切 dist 的集合 = **真正对外包 + 其 workspace 依赖闭包**；闭包之外的仓内私有包一律维持 src。

〔选择〕首条可证链（零 workspace 依赖起步，逐级证明机制）：

`dsh-bridge`（零依赖） → `contract`（仅 zod） → `gateway`（contract） → `studio-tools`（contract + gateway）

`dsh-bridge` 必须**最先**：它是唯一零 workspace 依赖的对外包，任何失败都能定位在本包。`studio-tools` 必须**最后**：
它同时依赖 contract 与 gateway，不能与二者并列先切；链上每一级都只在上一级 `dist` 存在且拓扑断言通过后才开始。

〔结论〕链上只有 `dsh-bridge` 与 `studio-tools` 是「真正对外」的直接理由；`contract` / `gateway` 进入 dist 是硬前提的
**连带结果**（studio-tools 的依赖闭包），不是各自独立的分发决定。若 studio-tools 最终不对外，则 contract/gateway 不必切。
`daemon` / `boot` 不在分发集合内，维持 src；CLI 分发另审（§7.7）。

〔结论〕**80 的新增设计不改变这条链**：
- `RunServeOpts.matrixSessionFactory` 的工厂类型定义在 daemon 的 `run-serve-opts.ts`，由 boot 构造并注入，
  **不新增 `daemon→matrix` 包边**（80-§3.4 第 10 条）；DAG 的 L6/L7 与 §10.2 的 daemon 依赖表因此不变。
- 80 新增的 `contract/src/ports/{intent,secret,resources}.ts` 等**仍是 `contract` 源码面**，不构成「新包」也不构成切 dist 的理由；
  `contract` 只因闭包（`studio-tools`）而切，且切换前公共面必须先冻结（80-§12.2-5）。
- `PORT_VERSION` 仍 `v0`、全部端口 `experimental`（80-§0.3）；切换 dist 不改变端口等级，也不构成稳定承诺。

〔事实〕按真实边（各包 manifest，2026-10-27 逐包读取）校正后的完整目标 DAG（同层且无 src 有效边可并行；先层 → 后层）。
口径：`devDependencies` 里的 workspace 包若被本包 `src` import，按**运行期边**计入 DAG（panel→company 即此类）：

| 层 | 包 | workspace 依赖（运行期） | 备注 |
|---|---|---|---|
| L0 | `dsh-bridge` | — | 零依赖 |
| L1 | `contract` | — | 仅 zod |
| L2 | `core`、`gateway`、`localplatform`、`matrix`、`yt`、`taiga`、`adapters` | `contract` | 其余依赖全是外部包 |
| L3 | `store`、`studio-tools` | store: contract；studio-tools: contract + gateway | store 的 `core` 只被 `test` 用，不进构建图 |
| L4 | `company` | contract + store | 运行期边 |
| L5 | `prompt`、`api`、`panel` | prompt: company + contract；api: company + store + contract；panel: contract + store + company（**运行期**） | panel→company 在 `devDependencies`，但 src 有 3 处 import（§10.1），按运行期边处理；三者互无 src 边，可并行 |
| L6 | `daemon` | adapters、api、company、contract、core、gateway、localplatform、panel、prompt、store、taiga、yt（+ dev studio-tools） | 依赖覆盖前面各层 |
| L7 | `boot` | contract、daemon、matrix | 最后 |

〔事实〕`prompt` 的 company 是零 import 的休眠边（manifest 声明仍在，§10.1 第 8 项）；排 L5 是保守取法——
若只按 import 图，它本可与 L4 并行。`panel` 则相反：manifest 把 company 放 devDependencies，但 src 真引用了 3 处，必须按运行期边排到 company 之后。

〔结论〕与线性草图相比有两处按真实边的校正：草图把 `dsh-bridge` 排在 `contract` 之后，但它零 workspace 依赖，应在 **L0**；
草图把 `studio-tools` 与 `prompt/panel/api` 并列，但它只依赖 contract + gateway，应在 **L3**。二者都不与 contract/gateway 同层，
也不在 company 之后——它们是首条可证链的首尾，不是同一层。

〔结论〕DAG 覆盖全部 17 个包，用途是给出**任何**切换方案的拓扑边界；本卷实际主张切换的只有 §6.5 表中的
`dsh-bridge`、`studio-tools` 及其依赖闭包（contract、gateway），其余层位只在「未来某包纳入分发」时才被走到。

〔结论〕不能只给四个包就宣称「全仓任意顺序可行」：漏掉 `company → panel/prompt/api → daemon → boot` 这一段，
任何把 daemon/boot 也纳入分发的尝试都会在 `rootDir` 检查上失败（本卷结论是它们不纳入分发，§7.7）。
若未来纳入构建，`daemon`/`boot` 永远在最后（L6/L7），且必须先完成 L0–L5。`studio-tools` 虽在 L3，但在首条可证链里排最后。

〔结论〕一刀切切 dist 仍是**负收益**：闭包外的仓内私有包若也切，typecheck 会读陈旧 `dist/*.d.ts`，
忘了重建就变成「用旧类型检查新代码」——这比不切更危险（§6.3）。

**切换后的构建/测试顺序（硬前提）**

〔结论〕`exports` 一旦指 dist，**未构建时的 typecheck 与测试都会失败**，不只是 typecheck：
- 根 `tsc --noEmit` 按 `exports.types` 读 `dist/*.d.ts`，缺失即 TS2307；
- vitest 解析包名同样走 `exports`，缺失即 `Cannot find package` 或解析失败。

〔目标〕顺序固定为：**先 build 已切包 → 再 typecheck → 再跑测试**（当前切换集为空，故现状只需 typecheck 与测试，无 build 步骤），
且源码态与 dist 态分开取证：
1. 已切包：`mise exec -- node ./node_modules/typescript/bin/tsc -p tsconfig.build.json`（E2，含 `--listFiles` 拓扑断言）→
   `mise exec -- bun run typecheck`（根 program + 每个已切包的 `tsc --noEmit -p packages/<pkg>/tsconfig.json`，§4.4；
   两者都是门禁必需项）→ 该包测试（此时测试里对**其他已切包**的 import 经 `exports` 解析到 dist，对**未切包**的 import
   仍是 src；两态同时被覆盖，所以必须先 build）。
2. 源码 smoke：`mise exec -- node <pkg>/src/index.ts`（仅仓内、非分发证据）；dist smoke：`mise exec -- node <pkg>/dist/index.js`（E3）。
   两者分别执行、分别留证，**不得**用源码 smoke 代替 dist smoke。裸 `bun`/`node` 的 smoke 输出不作证据。
3. 测试通过不等于产物可用；E1（源码/测试）与 E3/E4（产物）不可互替（§8.1）。

### 6.2 exports 形状规则

〔目标〕

1. `exports` 的每个条目先写 `types`，再写 `import`（顺序影响解析器优先级，TS 文档建议 `types` 在前）：

```jsonc
// 目标设计（示意），不是已创建文件；以 panel 的 4 条子路径为例
{
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".":          { "types": "./dist/index.d.ts",          "import": "./dist/index.js" },
    "./overview": { "types": "./dist/overview/index.d.ts", "import": "./dist/overview/index.js" },
    "./external": { "types": "./dist/external/index.d.ts", "import": "./dist/external/index.js" },
    "./inbox":    { "types": "./dist/inbox.d.ts",          "import": "./dist/inbox.js" },
    "./judge":    { "types": "./dist/judge.d.ts",          "import": "./dist/judge.js" },
    "./package.json": "./package.json"
  }
}
```

2. `main` 只作旧解析器兜底，必须与 `exports["."]` 指向同一实现；不允许 `main` 指 src 而 `exports` 指 dist。
3. **子路径完整枚举**：现状的 `daemon`（`./engine`、`./serve`）与 `panel`（`./overview`、`./external`、`./inbox`、`./judge`）
   必须在切换时逐个映射到同名 dist 产物；漏一个就是断边（`apps/boot` 依赖 `daemon/serve`）。
   `studio-tools` 的目标面除 `"."` 外还含 **`./stdio` → `./dist/stdio.js`**（`stdio` 入口是目标，现状只有
   `InMemoryTransport` 测试，见 80-§11.4.1/U80-17）；切换时同样必须显式映射，不得用通配代替。
4. 不加通配 `"./*"` 导出：它会把内部文件变成公开面，等于取消边界。
5. `exports` 里不出现 `src`（除非刻意双轨，见 §6.3 的否定）。
6. `types` 与 `import` 必须同目录同名（或显式给 `types`）；不要出现「JS 在 dist、类型在 types/」的分离布局——两者会漂移。

〔结论〕Node 与 TS 的解析必须一致：Node 按 `exports` 找 `import`，TS 按 `exports` 找 `types`。二者任一缺失，
就会出现「运行能跑、类型报错」或反之。验收必须双跑（§8）。

### 6.3 三种失败模式（必须写进审查口径）

1. **陈旧 dist**：`exports` 指 dist，开发者改 src 后不构建 → 仓内其他包与 typecheck 全部读到旧类型，测试却可能仍绿（若测试只走源码相对导入）。
   防御：闭包外的包维持 src；切 dist 的包必须有「构建后指纹 + 陈旧检测」。**依赖 dist 缺失或陈旧 = 直接失败**，
   不得静默回落到源码（回落会让 CI 绿而发布坏）；§5.6 的 `--listFiles` 拓扑断言是这条的机械判据。
2. **双轨混用**：`exports` 用条件导出把 `development` 指 src、`import` 指 dist（TS 5.7 release notes 提到的临时做法）。
   本仓**明确不采用**：它要求所有消费者带 `--conditions`，且一旦有人漏带就解析到 `.ts`，而 Node 在 `node_modules` 下拒绝 strip。
3. **`paths` 混两轨**：用 `paths` 让 TS 解析 src、Node 解析 dist。`paths` 只影响 TS，且 rewrite 不处理别名；
   只要有人从运行时角度看，就会得到两个不同的模块实例（甚至两份全局状态）。**禁止**。

### 6.4 project references：默认不引

〔选择〕默认不引入 `composite` / `references` / `tsc -b`。

理由：本仓的根门禁已经不是「一次 `tsc --noEmit` 覆盖全部 src」，而是「未切包 src + 依赖侧 `dist/*.d.ts`
+ 已切包包级 `tsc --noEmit -p`」（§4.4），且没有增量构建需求；引入 references 会带来 `composite` 强制 `declaration`、
构建顺序、`.tsbuildinfo` 产物与「必须先 build 才能 typecheck」的耦合，而这些已由固定波次 + 根脚本串接承担。

〔目标〕触发条件（满足任一再走提案）：

1. 根门禁（根 program + 全部已切包包级检查）稳定超过约 2 分钟，或 CI 成为瓶颈（需实测基线，本卷不给数字承诺）；
2. dist 轨包数量 ≥3、声明文件之间存在跨包类型依赖，**且该拓扑无法由固定单链/固定波次表达**（本方案首链
   `dsh-bridge → contract → gateway → studio-tools` 是全序单链，**不因包数≥3 自动引入 references**）；
3. 编辑器在单文件修改后出现可感知延迟，且已排除 `skipLibCheck`/体积因素；
4. 需要「按包发布、按包版本」的独立构建产物（而不是整仓一次构建）。

〔结论〕references 不是「更专业」，而是「有构建图才需要」。没有构建图时引入，只会多一层状态。

### 6.5 目标口径表

| 包 | `exports["."]` 目标 | 子路径 | `files` 白名单 | 备注 |
|---|---|---|---|---|
| dsh-bridge | `./dist/index.js` | — | `dist`、`cordis.patch.yml`、`README.md`、`LICENSE` | patch 内 `name` 同步改 `./dist/index.js`；**README/LICENSE 现状不存在**，属随切换新增，许可由制作人未决（不默认沿用根 MIT） |
| studio-tools | `./dist/index.js` | **`./stdio` → `./dist/stdio.js`**（目标） | `dist`、`README.md`、`LICENSE` | 现状无 `bin`、无 `stdio` 入口、无 `StdioServerTransport`（只有 `InMemoryTransport` 测试）；「由外部宿主经 stdio 拉起」是**目标**（80-§11.4.1/U80-17），不是现状；README 已有、LICENSE 不存在，许可由制作人未决 |
| contract | 现状 `./src/index.ts`；目标 `./dist/index.js`（仅当 studio-tools 切 dist） | — | `dist`（或 `src`）+ `cases.json` + `CASES.md` | 若发 `src`，见 §5.5-5；**若 studio-tools 切 dist，contract 必须同切**（硬前提，§6.1），二者不能一 src 一 dist；80 新增的 `ports/{intent,secret,resources}.ts` 不改变这一点 |
| gateway | 现状 `./src/index.ts`；目标 `./dist/index.js`（仅当 studio-tools 切 dist） | — | `dist` + `README.md` + `LICENSE` | 依赖闭包的连带结果，不是独立对外决定；README/LICENSE 属新增、许可由制作人未决 |
| daemon | **无包根**（现状 `./src/index.ts`；按 80-§3.2 三步删除） | `./engine`、`./serve` | 不发布 | 包根退场后只剩两个子路径；根脚本改 `node apps/daemon/src/cli/main.ts serve`，`bin` 保持 `cli/main.ts`（公共 CLI 唯一入口）；CLI 分发另审（§7.7） |
| boot | `./src/boot.ts`（现状与目标一致；不是 `src/index.ts`） | — | 不发布 | `main: "src/boot.ts"`、`exports["."]: "./src/boot.ts"`；无 `bin`、无启动 script，只作为库被调用（80-§3.1） |
| 其余 11 个（core/store/company/prompt/adapters/yt/taiga/matrix/localplatform/panel/api） | `./src/index.ts` | `panel` 四条子路径按现状（§6.2）；其余无 | 不发布 | 闭包之外，维持仓内 |

〔事实〕`dsh-bridge` 的**现有测试**把源码形态钉死了：`packages/dsh-bridge/test/bridge.test.ts` 断言
`pkg.exports['.'] === './src/index.ts'`、`pkg.dsh.bundle.patch === './cordis.patch.yml'`、补丁内含 `name: ./src/index.ts`。
〔事实〕本次实查：17 个 workspace 的 `package.json` **全部没有 `license` 字段**，包内也没有 `LICENSE` 文件
（仓根 `LICENSE` 是仓级 MIT，不等于包级许可）；`README.md` 只有 `matrix` 与 `studio-tools` 有。
`studio-tools` 的 `./stdio` 目标**没有对应源码或产物**（`packages/studio-tools/src/` 无 `stdio.ts`），不得写成已有能力。
〔结论〕切 dist 是一个**连带改动**：测试契约、patch 文件、`files`、`exports`、产物检查必须同一单内完成，不能只改 `package.json`；
README/LICENSE 属新增交付物，许可文本与公开范围须先由制作人定，不得默认沿用根 MIT。

---

## 七、npm / DSH 能力包发布面

### 7.1 `files` 白名单

〔目标〕能力包只发四类文件，白名单式列举，**不用 `.npmignore` 黑名单**（黑名单会随新增目录默默泄漏）：

1. `dist/**`（JS + `.d.ts`；若开 `declarationMap`，含 `.d.ts.map`，且必须同时发 `src/`）；
2. 数据文件（如 `cordis.patch.yml`、`cases.json`）；
3. 人读文档（`README.md`）；
4. 许可与声明（`LICENSE`、第三方声明）。

〔结论〕`src/` 默认不发。例外只有「随包发源码以支持 declarationMap/调试」，且必须过 §7.4 的检查。
〔事实〕能力包的 README/LICENSE 现状大多**不存在**（`matrix` 与 `studio-tools` 有 README；全部包无 LICENSE、无 `license` 字段）；
它们随切换新增，许可待制作人决定——本卷不把它们写成「已有文件」。

### 7.2 DSH 补丁指向 dist

〔事实〕现状 `packages/dsh-bridge/cordis.patch.yml` 的 `name: ./src/index.ts`，注释说明「相对路径 name 锚定本文件所在目录」。
〔结论〕切 dist 的理由不是「宿主绝对不能加载 TS」：真机里的本地路径安装经 pnpm 成 `link:`，realpath 在 `node_modules` 外，
可擦除 `.ts` 能跑（docs/34-B2）；但 registry 实体安装落在 `node_modules` 内，Node 24 拒绝 strip（§1.2 探针）。
同一条链路的结果取决于安装方式，不能作为分发承诺，`dist` 才能让行为与安装方式无关（§4.4）。
〔目标〕切 dist 后：`name: ./dist/index.js`，`dsh.bundle.patch` 仍指 `./cordis.patch.yml`（补丁文件本身不发到别处）；
`apps/daemon/src/engine/instructions-store.ts` 生成的运行时 overlay 也要指向同一产物（现状是 4 级相对路径推导 `BRIDGE_SRC_REL`）。

〔结论〕「路径消费」必须改成**显式产物契约**：由 dsh-bridge 暴露「插件入口路径」的解析器（读自身 `exports` 或 `dsh.bundle`），
daemon 只消费解析结果并做存在性 + 版本检查；不得继续用 `path.join('..','..','..','..','packages','dsh-bridge','src','index.ts')`
这种布局推断（`instructions-store.ts:72`），它把 monorepo 目录形状变成了隐式接口。

### 7.3 `npm pack --dry-run --json` 清单检查

〔目标〕每次发布候选必须保存 `npm pack --dry-run --json` 的**原始 JSON**作为证据，并逐项核对：

| 检查 | 通过判据 |
|---|---|
| 文件集合 | 与 §7.1 白名单完全一致；无 `src/**`（除非刻意）、无 `test/**`、无 `.tsbuildinfo`、无 `.map`（除非声明要发） |
| 入口存在 | `dist/index.js`、`dist/index.d.ts` 均在列表中 |
| 体积 | 单文件与总体积有上限；异常膨胀=误打包 |
| 数据文件 | `cordis.patch.yml` 在列，且内容 `name` 指向 `./dist/index.js` |
| 许可 | `LICENSE` 在列且 `license` 字段存在；**现状 17 个 workspace 全部没有 `license` 字段、包内也没有 LICENSE**，故这是「随切换新增」而非已有 |
| 依赖 | `dependencies` 与产物实际 import 一致（无装饰性依赖） |

〔未证〕本卷未运行 `npm pack`（不安装、不改依赖、不产生工件）；清单字段以 npm 官方输出为准，实际核对归 82。

### 7.4 秘密、本机路径、map sources、lockfile

〔目标〕发布前四项扫描（缺一不得发布）：

1. **秘密**：出站内容过 `redactOutbound` 逻辑（形状 + 已知值；归属 `contract/src/secrets.ts`，`core` 仅具名转发，§3.6）；扫描范围包括 README、补丁 YAML、`.d.ts` 注释。
   〔事实〕该模块已存在（现 `packages/core/src/secrets.ts`）且为纯函数，可用于离线扫描；〔目标〕迁移后扫描脚本从 `contract` 公共面取用，替换串仍是 `<redacted:N>`。
2. **本机路径**：产物与文档中不得出现 `/Users/...`、`/Volumes/...`、盘符、内网 IP、主机名、真实 MXID/账号。
   〔事实〕AGENTS 纪律 6 已要求「仓库里不得出现本机路径 / IP / 真实凭证」。
3. **map sources**：若发布 `.map`/`.d.ts.map`，`sources` 不得是绝对路径，`sourceRoot` 不得指向构建机布局；
   否则等于公开构建机目录结构。
4. **lockfile**：`npm-shrinkwrap.json` **存在就会随包发布**（这正是 §7.5 不采用它的原因）；`package-lock.json`、
   `pnpm-lock.yaml`、`yarn.lock`、`bun.lockb` 不进包。`bun.lock` 是仓内文本锁，靠 `files` 白名单排除
   （不能依赖 npm 的默认排除表覆盖它）。

### 7.5 npm-shrinkwrap 与依赖声明

〔选择〕能力包**不引入** `npm-shrinkwrap.json`。它与其他锁文件不同：npm 打包时会把它随包发布（存在即带），
一旦引入，消费者就被钉死在我们这一棵树上。

理由：能力包是**库**不是应用。shrinkwrap 会把整棵传递依赖钉死，导致消费者无法与自己的依赖树合并（重复实例、peer 冲突）。
库的正确做法是声明**兼容范围**（`peerDependencies` 用于宿主提供的能力，`dependencies` 用于自带能力），并把实际验证版本写进 README/证据。

〔结论〕必须分三类说，不能笼统说「lockfile 不发」：
1. `npm-shrinkwrap.json` **会**随包发布（存在即带）——本方案因此不采用；
2. `package-lock.json`、`pnpm-lock.yaml`、`yarn.lock`、`bun.lockb` **不会**进包；
3. `bun.lock` 是仓内文本锁，靠 `files` 白名单排除。
任何「依赖已锁定」的说法必须说明是哪一层：仓内锁定（`bun.lock`）≠ 包内锁定（shrinkwrap）。

〔目标〕依赖兼容声明：
- 对 Node 用 `engines.node`（当前根为 `>=24`，见 §12 漂移）；
- 对宿主（DSH）用 `peerDependencies` + 精确锁策略（75-D75-09 的结构化 SemVer 只在**公共声明**层面生效；
  npm 的 range 语法是实现内部约定，不上升为跨框架规范）。

### 7.6 Bun compile 不是能力包等价方案

〔事实〕Bun 1.4.3 的 `node:sqlite` 内建 SQLite 3.51.0、`process.versions.node` 报 26.3.0、`process.features.typescript=transform`（本次探针）。
〔结论〕`bun build --compile` 产出的是**换运行时的单文件**：SQLite 版本、模块解析、类型转换语义都与「Node 24 + node:sqlite 3.53.4」不同。
它可以作为「独立 CLI 分发」的候选，但**不是** npm 库的等价物，也不能用来证明 Node 下可跑。

〔目标〕若未来要做单文件 CLI：
1. 单独提案（换运行时=换绑定，归 78）；
2. 证明 SQLite 行为等价（含 WAL、`busy_timeout`、`STRICT`、JSON 函数、错误码）；
3. 证明子进程/信号/退出码语义等价；
4. 证明升级路径（旧版本产生的台账能被新版本打开）。

### 7.7 独立 CLI 分发的另审条件

〔结论〕`daemon` 的 `bin` 现在指向 `src/cli/main.ts`，只在本仓 + Node 24 下成立。要真正分发 CLI，必须另行决定：

- 运行时（Node 单文件？Bun compile？两者都发？）；
- SQLite 引擎（node:sqlite 的 experimental 状态：Node 24 文档标 Stability 1.2，且 Node 25 会打 ExperimentalWarning）；
- 升级与回滚（台账 schema_version、二进制与台账的兼容矩阵）；
- 许可与公开范围（制作人决定，见 §8.3）。

在这些决定之前，「CLI 可分发」不得写进 README 的能力面。

---

## 八、证据链与验证矩阵

### 8.1 六类证据，各自证明什么

| # | 证据 | 证明 | **不能**证明 |
|---|---|---|---|
| E1 | 源码测试（vitest；本包 src + 其他已切包的 dist；当前切换集为空 ⇒ 全部 src） | 纯逻辑与集成行为符合契约 | 产物可运行、包可安装 |
| E2 | 构建（`tsc -p tsconfig.build.json` + `--listFiles`） | 源码可发射出 JS + `.d.ts`，且未拉入别包源码 | 产物语义正确、消费者可用 |
| E3 | dist 直引（`node -e "import('./dist/index.js')"`） | 产物在 Node 24 下可加载 | 包名解析、`exports` 正确 |
| E4 | 临时 `node_modules` 安装 + 消费者 `tsc` | `exports`/`types` 与消费者解析一致 | DSH 宿主真实装载 |
| E5 | `npm pack --dry-run --json` 清单 | 包内容=白名单 | 内容语义正确 |
| E6 | DSH 宿主探针（真实 `dsh` 装载 **dist 形态**插件） | 宿主侧真实可用（V5） | 其他宿主/其他版本；源码/`link:` 形态的真机结果（docs/31/34） |

〔结论〕六类证据不可互相替代。尤其：E1 全绿 + E2 成功 ≠ 可发布；E5 清单干净 ≠ 装载成功。

### 8.2 每类的命令、判据与回退

〔目标〕（命令形态为目标；本卷未执行，除注明「已跑」者）

1. **E1 源码测试**
   - 命令：`mise exec -- bun run test`（= `node scripts/guards/boundaries.mjs` + `vitest run --passWithNoTests`）。
   - 判据：退出码 0；guard 无违例；测试数>0（`--passWithNoTests` 只防「零测试假绿」，不能当通过证据）。
   - 回退：失败即停，不通过「跳过用例」变绿。
   - 〔事实〕本卷**未运行**该套件（只跑了类型门禁），测试状态不在本卷声明范围。
   - 〔目标〕切 dist 的包必须先 build 再跑该包测试（§6.1 末）：测试对已切包的 import 经 `exports` 解析到 `dist`，
     未构建时 `vitest` 会解析失败——这不是测试缺陷，是顺序错误。源码 smoke 与 dist smoke 分开执行、分别留证。

2. **E2 构建**
   - 命令：`mise exec -- node ./node_modules/typescript/bin/tsc -p packages/<pkg>/tsconfig.build.json`（显式 Node 24）。
   - 拓扑断言：同一配置加 `--listFiles` 再跑一次，输出中**不得出现本包之外的 `packages/*/src/**` 或 `apps/*/src/**`**；
     出现即依赖未切 dist（TS6059 或产物污染），按构建失败处理。
   - 判据：退出码 0 **且** `dist` 文件集合与预期一致 **且** `dist/*.d.ts` 非空 **且** `--listFiles` 拓扑断言通过。
   - 前置：本包全部 workspace 依赖的 `dist` 已存在且指纹与源码一致；缺失或陈旧即失败，不得静默用源码顶替。
   - 回退：删除 `dist` 重跑；不得用 `emitDeclarationOnly` 的空跑冒充。
   - 〔未证〕目标配置尚未创建，且当前切换集为空，故本类无本仓证据。

3. **E3 dist 直引**
   - 命令：`mise exec -- node --input-type=module -e "await import('./packages/<pkg>/dist/index.js')"`（只 import JS，不依赖 eval 的类型擦除）。
   - 判据：正常退出。失败按错误码定位路径：
     `ERR_MODULE_NOT_FOUND` = 产物缺文件或 `exports` 指向不存在的路径；
     `ERR_UNKNOWN_FILE_EXTENSION` = 解析到了非 JS 扩展（如 `.ts` 在 strip 被禁用时，或 `.tsx`）；
     `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` = 仍在引 `node_modules` 下的 `.ts`（说明未切 dist）。
   - 回退：检查 `exports`/`rewrite` 是否漏配。

4. **E4 临时安装 + 消费者 tsc**
   - 做法：把 `npm pack` 产物装进 `/tmp` 下的干净工程（不联仓），用 `mise exec -- tsc --noEmit` + `mise exec -- node` 双跑。
   - 判据：`tsc` 无 TS5097/TS2307；`node` 能 import；`exports` 的每个子路径都能解析。
   - 回退：按 §5.5 的 spike 结论处置；后处理不是默认步骤，只在出现具体反例时评估（且须幂等、可回退）。
   - 〔未证〕本卷未做。

5. **E5 pack 清单**
   - 命令：`mise exec -- npm pack --dry-run --json`（在包目录；npm 由 mise 的 Node 提供）。
   - 判据：§7.3 表格逐项通过。
   - 回退：改 `files`，不改 `.npmignore`。

6. **E6 DSH 宿主探针**
   - 做法：在真实 `dsh 0.2.0-rc.2` 下用 `dsh plugin --profile <p> add <包>` 或 `--patch <file>` 装载，制造一次 agent 创建。
   - 判据：`studio-next-bridge` 段被注册（无撞名错误）、`STUDIO_NEXT_INSTRUCTIONS` 指向的文件内容出现在系统提示、
     stdout 不被诊断输出污染。
   - 回退：`required: false` 的降级路径只允许出现在显式配置里，默认行为必须可解释。
   - 〔事实〕docs/31 与 docs/34 已有真机证据（宿主 0.2.0-rc.2 的注入、插件面、中途插话、pnpm `link:` 安装）；
     本卷**未复跑**，且不把这些证据当作 **dist 形态**的证据（它们是源码/`link:` 形态）。dist 形态的宿主装载仍待 E6。
   - 〔事实〕仓内只有 `packages/dsh-bridge/test/smoke/` 的手动冒烟脚本，且它不在类型门禁内
     （`packages/dsh-bridge/tsconfig.json` 显式 `exclude: ["test/smoke/**/*.ts"]`）。

### 8.3 状态声明纪律

〔结论〕
- **dist 形态的 V5 未复跑就不得声称 dist 可用**。docs/31/34 的源码/`link:` 真机证据不能替代 E6；
  本卷所有「可发布/消费者兼容」只到「有探针路径 + 已跑过的局部探针」（§5.5 的三组 `module`/`moduleResolution` 组合；
  `checkJs`/JSDoc 与 bundler 未跑，见 U1）。
- **全部 private ≠ 可以 publish**。`private: true` 只是防止误发；公开许可、公开范围、命名、支持窗由制作人决定（75-D1/D3/D6）。
- 本仓根 `LICENSE` 是 MIT、`package.json` `license: "MIT"`（**事实**），但这不等于「每个能力包都已选择公开许可」；
  能力包是否沿用 MIT、是否另加声明，仍待决。

---

## 九、依赖矩阵（DEP-）

### 9.1 总表

判定口径：`声`=manifest 声明范围；`锁`=`bun.lock` 实锁；`用`=本次 import 图是否有真实使用（src/test 分列）。
许可证来源：包内 `package.json` 的 `license` 字段，并标注包内是否含 LICENSE 文件。

| DEP-ID | 包/运行时 | 声 | 锁 | 运行时/开发 | 使用 | 许可 | 结论 |
|---|---|---|---|---|---|---|---|
| DEP-NODE | Node | `>=24`（根 engines） | 24.21.0（mise） | 运行时 | daemon/boot/CLI | Node 许可（MIT 类） | 保留，收紧版本 |
| DEP-BUN | Bun | `bun@1`（packageManager） | 1.4.3（mise） | 开发 | 装包/脚本 | MIT | 保留为壳 |
| DEP-TSC | typescript | `^5.9.0` | 5.9.3 | 开发 | 类型门禁/构建 | Apache-2.0 | 保留 |
| DEP-TYPES-NODE | @types/node | `^24.0.0` | 24.19.2 | 开发 | 全部 | MIT | 保留 |
| DEP-VITEST | vitest | `^3.0.0` | 3.2.7 | 开发 | 测试 | MIT | 保留 |
| DEP-ZOD | zod | `^4.0.0`（多包） | 4.6.7 | 运行时 | 广泛 | MIT | 保留 |
| DEP-YAML | yaml | `^2.0.0`/`^2.6.0` | 2.9.1 | 运行时 | company/core/adapters | ISC | 保留 |
| DEP-HONO | hono | `^4.6.0` | 4.13.13 | 运行时 | panel | MIT | 保留 |
| DEP-CRONER | croner | `^9.0.0` | 9.1.0 | 运行时 | daemon | MIT | 保留 |
| DEP-EXECA-10 | execa | `^10.0.0`（adapters） | 10.1.1 | 运行时 | adapters | MIT | 保留 |
| DEP-EXECA-09 | execa | `^9.4.0`（daemon） | 9.6.1 | 运行时 | **零使用** | MIT | 目标移除 |
| DEP-SIMPLEGIT | simple-git | `^3.27.0`（company/daemon/adapters） | 3.36.0 | 运行时 | company src；daemon test；adapters **零** | MIT（包内无 LICENSE 文件） | 收缩：company 保留，adapters 移除，daemon 移 dev |
| DEP-MCP-SERVER | @modelcontextprotocol/server | `^2.3.1`/`^2.0.0` | 2.3.1（+core 2.3.1） | 运行时（studio-tools）/开发（daemon、api） | studio-tools src；daemon test | Apache-2.0 | 保留 |
| DEP-NODESQLITE | `node:sqlite`（内建） | 无（Node 内建） | 3.53.4 | 运行时 | store | Node 许可 | 保留，登记 experimental |
| DEP-DRIZZLE | drizzle-orm | 无 | **无**（store 内残留 0.44.7，未入锁） | — | 零 | Apache-2.0（0.44.7 包内） | 不采用 |
| DEP-AJV | ajv | 无 | 无 | — | 零 | MIT（registry） | 不采用 |
| DEP-SEMVER | semver（node-semver） | 无 | 无 | — | 零（自写受限解析） | ISC（registry） | 默认不采用 |
| DEP-DSH | @deepseek-ai/dsh | 无（PATH 上的外部 CLI） | 0.2.0-rc.2（代码常量） | 运行时（外部） | adapters/dsh | MIT（registry） | 保留，宿主绑定 |
| DEP-NODESTDLIB | `node:*` 标准库 | 无 | Node 24.21.0 | 运行时 | 全仓 | Node 许可 | 首选 |
| DEP-SYSTEMGIT | 系统 `git` | 无（外部二进制） | 未锁（宿主决定） | 运行时 | company（simple-git 调用） | GPL-2.0（git 本体） | 保留，外部依赖 |
| DEP-VITE-ESBUILD | vite / esbuild | 无（传递） | 7.3.7 / 0.28.2 | 开发（传递） | 零直接 import | MIT / MIT | 仅测试链 |
| DEP-VENDOR-BROWSER | Vue/Naive UI/ECharts（进仓 vendor） | 无（非 npm 依赖） | 3.5.44 / 2.45.3 / 6.1.0 | 运行时（浏览器） | panel 页面 | MIT/MIT/Apache-2.0 | 保留，见 §9.2 |

### 9.2 逐条

#### DEP-NODE —— Node 24.21.0

- **使用位置**：daemon 与 boot 的唯一运行时；CLI 的正式启动器；`node:sqlite`/`node:http`/`node:crypto` 提供方。
- **版本**：manifest `engines.node: ">=24"`（根 `package.json:14-16`）；mise 钉 `24.21.0`（`.mise.toml:4`）。
- **用途与不可替代性**：ESM + ESM 语义、原生 type stripping、`node:sqlite`、`node:http`。Bun 不是替代（§1.4）。
- **兼容与边界**：`process.features.typescript='strip'`；不读 tsconfig；拒绝 `node_modules` 下 TS；`.tsx` 不支持；
  `node:sqlite` 在 Node 24 文档标 **Stability 1.2**，Node 25 会打 ExperimentalWarning（本次探针）。
- **安全与许可**：Node 本体许可（MIT 类，附带第三方声明）；无动态求值面。
- **替代与退出**：无（换运行时=换绑定，另审）。升级路径：24.x 内跟随 mise；跨大版本需重跑 §8 的 E1–E3。
- **规范影响**：实现内部；但「Node 版本」会进 78 的绑定档案。
- **证据**：<https://nodejs.org/docs/latest-v24.x/api/typescript.html>；<https://nodejs.org/docs/latest-v24.x/api/sqlite.html>；
  本地探针（24.21.0）。

#### DEP-BUN —— Bun 1.4.3

- **使用位置**：`mise exec -- bun install`、`mise exec -- bun run <script>`、开发期 `mise exec -- bun <file.ts>`；notebook 脚本 `packages/panel/scripts/vendor-pull.mjs`（零依赖 node 脚本，可由 bun 跑）。
- **版本**：`packageManager: "bun@1"`（`package.json:9`）；mise 钉 `1.4.3`（`.mise.toml:5`）；证据一律经 `mise exec --`（§0.3）。
- **用途与不可替代性**：workspaces 安装速度、任务壳、`workspace:*` 解析。此三者 Node 侧无等价物（npm/pnpm 是另一个工具，不在本仓选型内）。
- **兼容与边界**：`process.features.typescript='transform'`（会转换语法）；报 `node 26.3.0`；内建 SQLite 3.51.0。
- **安全与许可**：MIT；默认不执行依赖生命周期脚本（见 §11.1）。
- **替代与退出**：可换成 npm/pnpm（成本=改 lock、改脚本、重验 workspace 解析）；不承诺。
- **规范影响**：无（纯实现）。
- **证据**：<https://bun.com/docs/pm/lifecycle>；<https://bun.com/docs/pm/workspaces>；本地探针（1.4.3）。

#### DEP-TSC —— typescript 5.9.3

- **使用位置**：根 `typecheck`（现状仅根 program；切换集为空，目标只串显式已切包）与未来构建；每个包的 `typecheck` 脚本。
- **版本**：`^5.9.0` → 5.9.3（`bun.lock:475`）。
- **用途与不可替代性**：类型门禁（`strict` 全开）、`.d.ts` 发射、`rewriteRelativeImportExtensions`。
- **兼容与边界**：`erasableSyntaxOnly` 需 ≥5.8，`verbatimModuleSyntax` 需 ≥5.0（本仓按 5.9.3 使用）；`rewriteRelativeImportExtensions` 需 ≥5.7；
  `.d.ts` 不重写 `.ts` 说明符（本次源码 + 探针）。
- **安全与许可**：Apache-2.0（包内 `LICENSE.txt`）；编译器自身在构建期执行，属可信工具链。
- **替代与退出**：不可替代（类型门禁是本仓契约的一部分）。升级=重跑类型门禁 + 检查 §5.3 的选项交互。
- **规范影响**：无。
- **证据**：<https://www.typescriptlang.org/tsconfig/erasableSyntaxOnly.html>；
  <https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-7.html>；
  `node_modules/typescript/lib/typescript.js:129305`、`:21900-21903`、`:119060-119070`（声明降级见 `:46596-46598`、`:45483-45487`）；探针。

#### DEP-TYPES-NODE —— @types/node 24.19.2

- **使用位置**：全部 TS 文件（`types: ["node"]`）。
- **版本**：`^24.0.0` → 24.19.2（`bun.lock:351`），依赖 `undici-types >=7.24.0 <7.24.7`（锁 7.24.6）。
- **用途**：`node:sqlite`（`sqlite.d.ts` 实测存在）、`node:http`、`node:crypto`、`node:test` 等类型。
- **兼容与边界**：必须与运行时大版本对齐（24.x）；跨大版本会出现「类型有、运行无」或反之。
- **安全与许可**：MIT（包内 `LICENSE` 由 DefinitelyTyped 提供）。
- **替代与退出**：无。
- **规范影响**：无。
- **证据**：`bun.lock:351`；本地包 `@types+node@24.19.2/node_modules/@types/node/sqlite.d.ts`。

#### DEP-VITEST —— vitest 3.2.7

- **使用位置**：根 `test` 脚本；各包 `test` 脚本；`src/*.test.ts` 与 `test/**`。
- **版本**：`^3.0.0` → 3.2.7（`bun.lock:485`），依赖 vite `^5||^6||^7`（锁 7.3.7）、esbuild（锁 0.28.2）。
- **用途**：单测/契约测试/集成测试。不可替代：AGENTS 已把 vitest 定为统一测试器。
- **兼容与边界**：Node `^18||^20||>=22`；在本仓跑 `.ts` 源（不经 tsc）。
- **安全与许可**：MIT；测试运行器会执行被测代码（本来就要执行）。
- **替代与退出**：可换 `node:test`（成本=重写断言风格）；不提议。
- **规范影响**：无（测试工具不进公共规范，75-§8-5）。
- **证据**：`bun.lock:485`；`package.json:20`。

#### DEP-ZOD —— zod 4.6.7

- **使用位置**：contract（4 文件）、company（6）、core（2）、gateway（2）、store（5）、yt（8）、adapters（1）、studio-tools（2）。
- **版本**：各包 `^4.0.0` → 4.6.7（`bun.lock:497`）；MCP SDK 依赖 `zod ^4.2.0`（同锁）。
- **用途**：五类边界的形状校验；`~standard.jsonSchema` 供 MCP SDK 转 JSON Schema（**库级存在**，studio-tools 已用）。
- **兼容与边界**：`z.strictObject`/`z.looseObject` 语义已用。JSON Schema 生成只允许**离线**：由 zod 生成冻结工件并做
  「源码 ↔ 工件」漂移检查；`z.toJSONSchema` 存在但**禁止**用于反向生成规范（75-D75-08）。**禁止** `z.fromJSONSchema()`
  反向生成，**禁止**运行时重新生成权威工件。
- **安全与许可**：MIT（包内 `LICENSE`）；无 eval。
- **替代与退出**：可换手写守卫（成本高、易漏）；不提议。退出条件：若 zod 大版本破坏 `~standard`，MCP 工具面需重验。
- **规范影响**：不进入公共规范；它是 76 的**参考 authoring**，冻结工件是 JSON Schema。
- **证据**：<https://zod.dev/json-schema>；本地 `zod@4.6.7` 的 `standard-schema.d.ts:86`、`external.d.ts:11`。

#### DEP-YAML —— yaml 2.9.1

- **使用位置**：company（13 处）、core（2）、adapters（1）。
- **版本**：`^2.0.0`（adapters）/`^2.6.0`（company、core）→ 2.9.1（`bun.lock:493`）。
- **用途**：`LineCounter` + `parseDocument`（行号诊断）、`parse`（小文件）。不可替代：行号定位是 `DirectoryIssue.line` 的前提。
- **兼容与边界**：`type: commonjs`（有 ESM 入口，NodeNext 可解析）；`engines.node >= 14.6`。
- **安全与许可**：ISC（包内 `LICENSE`）；不执行标签；别名/深度上限须自建（§3.3）。
- **替代与退出**：可换 `js-yaml`（无行号 AST 等价物，且 DSH 自身用 js-yaml 与我们无关）；不提议。
- **规范影响**：无。
- **证据**：`bun.lock:493`；`validator.ts` 头注（行号方案）；<https://eemeli.org/yaml/>。

#### DEP-HONO —— hono 4.13.13

- **使用位置**：panel 的 `server.ts`、`overview/server.ts`、`external/server.ts`、`static.ts`；`hono/streaming` 的 `streamSSE`。
- **版本**：`^4.6.0` → 4.13.13（`bun.lock:401`）。
- **用途**：内部监控/概览/对外 API 的路由与 SSE。不可替代性：`streamSSE` + Web 标准 Request/Response 模型，
  让「零 `@hono/node-server`」的 `node:http` 适配器成为可能（panel/server.ts 头注明写）。
- **兼容与边界**：`engines.node >= 16.9`；只用 Web 标准 API；不使用 Node 专用适配器。
- **安全与许可**：MIT（包内 `LICENSE`）。
- **替代与退出**：可换 `node:http` 手写路由（成本=重写三个 server）；不提议。
- **规范影响**：无。
- **证据**：`bun.lock:401`；`packages/panel/src/server.ts` 头注（不引 `@hono/node-server` 的理由）。

#### DEP-CRONER —— croner 9.1.0

- **使用位置**：`apps/daemon/src/engine/scheduler.ts:42`（唯一直接 import）。
- **版本**：`^9.0.0` → 9.1.0（`bun.lock:375`）。
- **用途**：cron 表达式解析与下次触发计算（定时岗）。不可替代性：需要 5/6 段（含秒）语义 + 时区，且 `company` 侧只做形状闸。
- **兼容与边界**：`engines.node >= 18`；零依赖（锁里无 dependencies）。
- **安全与许可**：MIT（包内 `LICENSE`）；纯计算，无 IO。
- **替代与退出**：可换手写 cron（成本=语义风险）；不提议。退出条件：若需分布式调度，语义要重审（归 78）。
- **规范影响**：无（调度策略不进公共规范；定时岗的语义归 76/77）。
- **证据**：`bun.lock:375`；`scheduler.ts:42`。

#### DEP-EXECA-10 —— execa 10.1.1

- **使用位置**：`packages/adapters/src/dsh.ts`、`claude.ts`、`codex.ts`、`kimi.ts`（4 文件，8 处 import，含 `type Subprocess`）。
- **版本**：`^10.0.0` → 10.1.1（`bun.lock:389`）。
- **用途**：执行体 CLI 的启动、流式 stdout/stderr、信号与退出码。不可替代性：四原语需要「流 + 取消 + 退出码」的稳定封装；
  `node:child_process` 手写可行但重复度高。
- **兼容与边界**：`engines.node >= 22`（10.x 起）；10.x 不再依赖 `cross-spawn`（锁里无该依赖，对比 9.6.1 有）。
- **安全与许可**：MIT（包内 `license`）；会执行外部命令——参数注入面在适配器（argv 数组形式，不经 shell）。
- **替代与退出**：可换 `node:child_process`（成本=重写流/取消）；不提议。
- **规范影响**：无。
- **证据**：`bun.lock:389`；`dsh.ts:83-84` 等 4 处 import。

#### DEP-EXECA-09 —— execa 9.6.1（daemon，零使用）

- **使用位置**：**无**（`apps/daemon` 的 `src` 与 `test` 均零 import）。
- **版本**：`^9.4.0` → 9.6.1（`bun.lock:499` 的别名条目 `@studio-next/daemon/execa`）。
- **用途**：无。它使同一 workspace 内出现两代 execa（9.6.1 + 10.1.1），并多带 `cross-spawn` 子树。
- **兼容与边界**：`engines.node ^18.19||>=20.5`；与 10.x 的 API 差异存在，但因零使用而不构成行为风险，只构成**依赖面噪音**。
- **安全与许可**：MIT（包内 `license`）。
- **替代与退出**：**目标移除**（§10.1）。移除后锁文件应只剩 10.1.1 一份。
- **规范影响**：无。
- **证据**：`bun.lock:499`；`grep -rl "from 'execa'" apps/daemon/src apps/daemon/test` 零命中。

#### DEP-SIMPLEGIT —— simple-git 3.36.0

- **使用位置**：company `src`（`init.ts`、`git-import.ts`、`repo-validate.ts`、`create.ts`，4 文件）与 `test`（4 文件）；
  daemon `test`（`industry-templates.e2e.test.ts`）；adapters **零**。
- **版本**：三包均 `^3.27.0` → 3.36.0（`bun.lock:451`）。
- **用途**：公司目录的 git 初始化/导入/校验（目录是事实源，必须有 git 语义）。不可替代性：要读 commit、状态、远端，手写 plumbing 成本高。
- **兼容与边界**：无 `engines`；无 `type`（CJS 主入口，NodeNext 可解析）；依赖 `@kwsites/*`、`debug`。
- **安全与许可**：`package.json` 声明 MIT，但**包内无 LICENSE 文件**（本次核对 tarball 内容）；发布/合规引用时应回上游仓库核对。
- **替代与退出**：可换 `node:child_process` 调 `git`（成本=重写错误处理）；不提议。
- **规范影响**：无；但系统 `git` 成为外部依赖（DEP-SYSTEMGIT）。
- **证据**：`bun.lock:451`；`company/src/{init,git-import,repo-validate,create}.ts`；包内目录清单（无 LICENSE）。

#### DEP-MCP-SERVER —— @modelcontextprotocol/server 2.3.1

- **使用位置**：studio-tools `src`（`McpServer`、`InMemoryTransport`、`Transport`、工具注册）；daemon `test`；api 仅声明未用。
- **版本**：studio-tools `^2.3.1` → 2.3.1；api `^2.0.0`（未用）；daemon devDep `^2.3.1`（测试用）→ 2.3.1（`bun.lock:249`）。
- **用途**：MCP 协议实现（tools/list、tools/call、initialize `_meta`）。不可替代性：自己实现 JSON-RPC + MCP 语义成本高且易漂移。
- **兼容与边界**：`engines.node >= 20`；依赖 `@modelcontextprotocol/core 2.3.1` 与 `zod ^4.2.0`；
  `StandardSchemaWithJSON` 的类型面与 zod 4.6.7 有已知类型缺口（`studio-tools/server.ts` 有显式类型桥与退出计划）。
- **安全与许可**：Apache-2.0（包内 `LICENSE`）；协议层会解析外部输入（工具参数），必须走 zod 校验（已如此）。
- **替代与退出**：可换自实现 JSON-RPC（成本高）；不提议。退出条件：协议大版本变更。
- **规范影响**：不进入公共规范；MCP 是 78 的绑定之一。
- **证据**：`bun.lock:249`；`studio-tools/src/server.ts:27-39`；包内 `package.json`（Apache-2.0）。

#### DEP-NODESQLITE —— `node:sqlite`

- **使用位置**：`packages/store/src/driver.ts`（唯一打开点）、`migrations.ts`、`records.ts`、`usage.ts`、`cost.ts`、`pricing.ts`、`probes.ts`。
- **版本**：Node 24.21.0 内建，`process.versions.sqlite = 3.53.4`。
- **用途**：台账（唯一投影）。不可替代性：零原生依赖、与 Node 同生命周期；`better-sqlite3` 需要编译与 ABI 匹配。
- **兼容与边界**：Node 24 文档标 **Stability 1.2**（本次抓取 `Stability: 1.2`）；Node 25 打 ExperimentalWarning（探针）；
  `DatabaseSync` 全同步；WAL/`busy_timeout` 已在 `driver.ts` 对齐。
- **安全与许可**：随 Node 分发（SQLite 为 public domain）；SQL 全部参数化（现状）。
- **替代与退出**：`better-sqlite3`（一行切换，`driver.ts` 已把引擎触点收口）。退出证据：需重跑迁移与重建演练。
- **规范影响**：不进入公共规范；进 78 的存储绑定，并附「可重建投影」的证明边界。
- **证据**：<https://nodejs.org/docs/latest-v24.x/api/sqlite.html>；`store/src/driver.ts`；探针。

#### DEP-DRIZZLE —— drizzle-orm（不采用）

- **使用位置**：无。`bun.lock` 零条目；`node_modules/.bun/drizzle-orm@0.44.7` 是**残留安装物**，不是依赖。
- **版本**：无声明、无锁（残留 0.44.7；registry 当前 0.45.4，仅作对照，**不采用 latest**）。
- **用途**：曾计划做 schema/migration。不可替代性：**无**——`driver.ts` 头注记录了探测结论：稳定线无 `node:sqlite` 驱动，
  驱动只在 1.0.0-RC 线；`drizzle-kit` 对 `node:sqlite` 无支持，migration 反正要手写。
- **兼容与边界**：RC 线不稳定；ORM 会引入第二套 schema 事实源，与「SQLite 是可重建投影」冲突。
- **安全与许可**：Apache-2.0。
- **替代与退出**：已退出（当前实现=手写薄 migration + `schema_version` 表）。**不得**因「以后可能有用」重新加回。
- **规范影响**：无。
- **证据**：`store/src/driver.ts` 头注；`grep -c drizzle bun.lock` = 0；本地残留目录。

#### DEP-AJV —— ajv（不采用）

- **使用位置**：无。
- **版本**：无（registry 当前 8.20.0，仅作对照）。
- **用途**：曾考虑做 JSON Schema 运行时校验。不可替代性：**无**——76 的交换工件是冻结 JSON Schema，但运行时判定由 zod/手写规则承担；
  引入 Ajv 会造成「schema 一份、zod 一份」的双事实源。
- **兼容与边界**：两种模式要分开说——**普通运行时编译**把 schema 编译成校验函数（`Function` 构造，动态代码执行）；
  **standalone 模式**生成的是**需要被加载的 JS 模块文件**（构建期产物，运行期 `import` 该模块，不再 `Function`）。
  前者与「定义包无执行内容」冲突，后者把「数据」变成「代码工件」，两者都不符合冻结 JSON Schema 的定位；
  schema 编译也是 ReDoS/资源耗尽的入口（见其 security 文档）。
- **安全与许可**：MIT（registry 元数据）。
- **替代与退出**：不引入。若未来需要非 TS 消费者校验，用「生成→冻结→独立 runner」而非把 Ajv 塞进 daemon。
- **规范影响**：**影响公共规范**：冻结 JSON Schema 是交换工件，Ajv 不是它的权威解释器（75-D75-08）。
- **证据**：<https://ajv.js.org/standalone.html>、<https://ajv.js.org/security.html>；`package.json` 无此依赖。

#### DEP-SEMVER —— node-semver（默认不采用）

- **使用位置**：无。公司目录的插件版本约束用自写受限解析：`company/src/dependencies.ts` 的 `VERSION_SPEC_RE`、
  `parseVersionSpec`、`parsePlainVersion`、`satisfiesSpec`（只接受 `^x.y[.z]` 与 `x.y[.z]`）。
- **版本**：无（registry 当前 7.8.5，仅作对照）。
- **用途**：需要的是「结构化版本比较 + 显式子集」，不是 npm 全量 range。
- **兼容与边界**：npm range 语法庞大（`||`、`-`、`x`、预发布、build），且 npm 的边角语义不是跨框架规范（75-D75-09）；
  自写子集可精确表达「`^0.x` 锁 minor、`^0.0` 锁 patch」这类冻结策略，并用 17 个契约用例钉住
  （`contract/cases.json` 的 `C-deps-001..017`；`company/test/deps-cases.test.ts` 断言 `total === 17`）。
- **安全与许可**：ISC（registry 元数据）。
- **替代与退出**：若未来要支持 `~`/`>=`/预发布，优先**扩展自写解析的显式子集**并升版策略；仍不引 npm range。
- **规范影响**：影响公共规范：公共声明只使用「精确锁 / 包含下界 / 排除上界 / 显式预发布策略」的结构化 SemVer。
- **证据**：<https://semver.org/>；`dependencies.ts` 的版本段与头注；`company/test/deps-cases.test.ts`。

#### DEP-DSH —— @deepseek-ai/dsh 0.2.0-rc.2

- **使用位置**：**不是 npm 依赖**，是 PATH 上的外部 CLI。`adapters/src/dsh.ts` 的 `DSH_DEFAULT_CMD = ['dsh','--profile','headless','--json']`，
  `LOCKED_VERSION = '0.2.0-rc.2'` 供 `detect()` 比对；插件侧由 `packages/dsh-bridge` 提供。
- **版本**：代码常量锁 `0.2.0-rc.2`；registry 元数据（本次抓取）：`license: MIT`、`type: module`、`bin.dsh = lib/bin.js`、
  `exports` 含 `./lib/*` 与 `./profile-boot`。
- **用途**：默认执行体（D5 定位）。不可替代性：AGENTS 已把 dsh 定为默认参考绑定。
- **兼容与边界（装载面）**：docs/31/34 有真机注入证据，但本地路径经 pnpm 装成 `link:`（docs/34-B2），
  Node 按 realpath 解析后实体在 `node_modules` **之外**，因此可擦除 `.ts` 能跑；这**不是**「实体安装在 `node_modules` 里也能跑」，
  也不能反过来说「宿主绝对不能加载 TS」。实体安装（registry tarball）不能依赖 TS 直载，`dist` 是与安装方式无关的保证（§4.4、§7.2）。
  插件装载有两种路径（bundle/profile 与运行时 `--patch`）；宿主内部版本（cordis 等）只作外部事实，不复刻。
- **安全与许可**：MIT（registry `license`）；执行体是黑盒，凭据只经 env 透传，不落配置/日志（现状）。
- **替代与退出**：claude/codex/kimi 三家适配器已存在；换默认执行体另审（75-D5）。
- **规范影响**：进 78 的宿主绑定；不进公共规范。
- **证据**：<https://registry.npmjs.org/@deepseek-ai/dsh>；`dsh.ts` 的常量；`docs/31`、`docs/34` 真机报告；`dsh-bridge` 头注。

#### DEP-NODESTDLIB —— Node 标准库

- **使用位置**：`node:path`（最广）、`node:fs`/`node:fs/promises`、`node:crypto`、`node:os`、`node:url`、`node:http`、`node:net`、
  `node:stream`/`node:stream/web`、`node:child_process`、`node:sqlite`。
- **版本**：随 Node 24.21.0。
- **用途**：一切 IO 与系统能力。不可替代性：零第三方依赖即可完成（D75-10 的首选）。
- **兼容与边界**：只用 `node:` 前缀导入（现状零裸 `'path'`/`'fs'` 导入）；不用已在 Node 24 标记 deprecated 的 API。
- **安全与许可**：随 Node。
- **替代与退出**：无。
- **规范影响**：无。
- **证据**：本次 import 统计（`from 'node:*'`）。

#### DEP-SYSTEMGIT —— 系统 `git`

- **使用位置**：company 的 git 操作（经 simple-git）；`apps/daemon/test` 的 e2e。
- **版本**：不锁（宿主决定）；simple-git 调用 `git` 可执行文件。
- **用途**：公司目录的版本化（唯一写入者的 commit 语义）。
- **兼容与边界**：PATH 上必须有 `git`；版本差异影响 `worktree`、`sparse-checkout` 等命令；Windows 路径/换行需另测。
- **安全与许可**：git 本体 GPL-2.0（作为外部程序调用，不链接）；不随包分发。
- **替代与退出**：可换 `isomorphic-git`（纯 JS，但性能/兼容面不同）；不提议。
- **规范影响**：进 78 的工作区绑定。
- **证据**：`company/src/init.ts` 等；`boundary-rules.mjs` 未涉及。

#### DEP-VITE-ESBUILD —— vite 7.3.7 / esbuild 0.28.2（传递）

- **使用位置**：仅 vitest 的依赖链；第一方代码零直接 import。
- **版本**：`bun.lock:481`、`:385`。
- **用途**：测试期转换与打包。
- **兼容与边界**：vite 的 peer 里含可选的 `@types/node`、`yaml`（不影响本仓）。
- **安全与许可**：MIT / MIT。
- **替代与退出**：随 vitest 升级；不单独管理。
- **规范影响**：无。
- **证据**：锁文件条目。

#### DEP-VENDOR-BROWSER —— 进仓的前端产物

- **使用位置**：`packages/panel/vendor/`（`vue.esm-browser.prod.js`、`naive-ui.prod.mjs`、`echarts.esm.min.js`），
  页面经 importmap 直引，零构建、零 CDN。
- **版本**：Vue 3.5.44、Naive UI 2.45.3、ECharts 6.1.0（`vendor/vendor.lock.json` 记录 version/bytes/sha256/source）。
- **用途**：监控页前端壳。不可替代性：离线可开、无运行时 npm 依赖（docs/37 路线 I）。
- **兼容与边界**：`naive-ui` 裸导入只有 `vue`；`echarts` 已内联 zrender；升级须重算 sha256（`scripts/vendor-pull.mjs` 校验字节与哈希）。
- **安全与许可**：MIT / MIT / Apache-2.0，许可文本在 `packages/panel/vendor/LICENSES/`（本次核对三个文件均存在）。
- **替代与退出**：可改回 CDN 或构建链（两条都被 docs/37 否过）；不提议。
- **规范影响**：无。
- **证据**：`packages/panel/vendor/README.md`、`vendor.lock.json`、`packages/panel/scripts/vendor-pull.mjs`。

### 9.3 不采用项汇总

| 候选 | 不采用理由 | 是否可能重开 |
|---|---|---|
| drizzle-orm | 无 `node:sqlite` 稳定驱动；ORM 造成第二事实源 | 稳定线支持 `node:sqlite` 且迁移工具可用时再评估（需提案） |
| ajv | 运行时第二事实源；standalone 代码生成 | 仅作离线 runner 时可另议（不进 daemon） |
| semver | npm range 语义超出公共规范所需 | 扩展自写子集，不引包 |
| tsx / ts-node | Node 24 原生 strip 已足够 | 不重开 |
| @hono/node-server | panel 用自写 `node:http` 适配器（约 60 行）换取零额外依赖与可控 SSE | 不重开，除非需要 HTTP/2 等 |
| express / axios / dotenv / uuid / 日期库 | D75-10 默认不引；标准库足够 | 需提案 |
| bun build --compile | 换运行时与 SQLite | 独立 CLI 分发另审 |

### 9.4 版本语法

〔结论〕两套语法必须分开：

- **安装层**（`package.json` 的 `^x.y`）：npm 语义，属实现内部，不上升为规范。锁文件负责实际解析。
- **公共声明层**（76 的工件、78 的绑定档案）：只用结构化 SemVer（精确版本、包含下界、排除上界、显式预发布策略），
  能表达 `0.2.0-rc.2`，不写 `^`/`~`/`latest`（75-D75-09）。

〔结论〕不把 `latest` 当目标：本卷所有版本都给了「声明范围 + 实锁」两列，任何「最新版」表述只作对照，不作依据。

---

## 十、依赖清理目标（只写设计，不改 manifest/lock）

### 10.1 逐项处置

| # | 现状（证据） | 性质 | 目标处置 | 理由 |
|---|---|---|---|---|
| 1 | `panel` 把 `@studio-next/company` 放 `devDependencies`，但 `src` 有 3 处 import | **错位** | 移到 `dependencies` | 运行时依赖不能只装给开发者；生产安装会缺包 |
| 2 | `api` 声明 `hono`、`zod`、`@modelcontextprotocol/server`、`company`、`store`、`contract`，`src` 零 import（仅 `PACKAGE_NAME`/`PACKAGE_STATUS` 常量） | **装饰性依赖** | 随 D75-11 的职责迁移决定；在真实端点落地前不保留「占位依赖」 | `api` 与 `panel/external` 的边界尚未裁决；先留依赖会让人误以为已接线 |
| 3 | `adapters` 声明 `simple-git`，`src`+`test` 零 import | **死依赖** | 移除 | 零使用；移除后不影响任何边 |
| 4 | `daemon` 声明 `execa ^9.4.0`，`src`+`test` 零 import | **死依赖 + 两代并存** | 移除 | 去掉 9.6.1 与 `cross-spawn` 子树，锁里只留 10.1.1 |
| 5 | `daemon` 声明 `zod ^4.0.0`，`src`+`test` 零 import | **死依赖** | 移除 | 形状校验在 company/store/gateway，daemon 不直接解析 |
| 6 | `daemon` 声明 `simple-git`，仅 `test/cli/industry-templates.e2e.test.ts` 使用 | **分类错误** | 移到 `devDependencies` | 测试用包不该进运行时安装面 |
| 7 | `daemon` 声明 `@studio-next/api`、`@studio-next/yt`，`src`+`test` 零 import | **休眠边** | 暂留；移除需同时改 `boundary-rules.mjs` 的允许边（提案流） | 方向表自称「与 manifest 并集一致」，单边删除会破坏该一致性 |
| 8 | `prompt` 声明 `@studio-next/company`，`src`+`test` 零 import | **休眠边** | 同上（表内有 `["prompt","company"]`） | 同上 |
| 9 | `daemon` devDeps 的 `@modelcontextprotocol/server`（test 用）、`@studio-next/studio-tools`（test 用） | **正确** | 保留 | 只在测试里用 |
| 10 | `store` devDep `@studio-next/core`（test 用）、`company` devDep `@studio-next/localplatform`（test 用） | **正确** | 保留 | — |
| 11 | `prompt` 声明 `zod ^4.0.0`，`src`+`test` 零 import | **死依赖** | 移除 | 形状校验不在 prompt；移除后 prompt 只剩 contract（company 是休眠边） |

〔事实〕第 7/8 项的「表声明」见 `scripts/guards/boundary-rules.mjs:102-142`；注释明说「daemon→api/prompt/yt 为已声明休眠边，一并冻结为允许」。
〔结论〕清理 dead dependency 与清理边界表是两件事：前者改 manifest，后者走提案。不得为了「表格干净」私自删边。

### 10.2 目标 manifest 形状（示意，不落盘）

```jsonc
// 目标设计（示意）：packages/adapters/package.json
{
  "dependencies": {
    "@studio-next/contract": "workspace:*",
    "execa": "^10.0.0",
    "yaml": "^2.6.0",     // 建议与 company/core 对齐下限；现状 ^2.0.0
    "zod": "^4.0.0"
  }
}
```

```jsonc
// 目标设计（示意）：apps/daemon/package.json
// 不新增 @studio-next/matrix：matrixSessionFactory 由 boot 构造注入，类型定义在 daemon 内（80-§3.4 第 10 条）
{
  "dependencies": {
    "@studio-next/adapters": "workspace:*",
    "@studio-next/api": "workspace:*",        // 休眠边，保留至裁决
    "@studio-next/company": "workspace:*",
    "@studio-next/contract": "workspace:*",
    "@studio-next/core": "workspace:*",
    "@studio-next/gateway": "workspace:*",
    "@studio-next/localplatform": "workspace:*",
    "@studio-next/panel": "workspace:*",
    "@studio-next/prompt": "workspace:*",
    "@studio-next/store": "workspace:*",
    "@studio-next/taiga": "workspace:*",
    "@studio-next/yt": "workspace:*",         // 休眠边
    "croner": "^9.0.0"
  },
  "devDependencies": {
    "@modelcontextprotocol/server": "^2.3.1",
    "@studio-next/studio-tools": "workspace:*",
    "simple-git": "^3.27.0"                   // 仅测试
  }
}
```

### 10.3 一致性检查（目标新增，非现有能力）

〔目标〕现有 guard 只查「层位/允许边/尺寸/平面」，**不查 manifest 与 import 图是否一致**。目标新增三项检查（归 81 落文件、82 落证据）：

1. 每个 `dependencies` 条目在 `src` 至少有 1 处 import（否则报「死依赖」）；
2. 每个 `src` 里出现的包名都在 `dependencies`（否则报「影子依赖」）；
3. `devDependencies` 的条目不得出现在 `src`（否则报「分类错误」，如现状 panel→company）。

〔结论〕三项都是机械可判，不需要 AST 级分析：`grep` 字面量即可覆盖现状（相对导入 + 包名导入）。

### 10.4 迁移顺序与回退

〔目标〕顺序：先修分类错误（panel→company、daemon simple-git→dev），再删死依赖（adapters simple-git、daemon execa/zod），
最后处理休眠边（需提案）。每步单独提交、单独验证 `mise exec -- bun install` 后 `typecheck` + 受影响的包测试；
回退=还原该步 manifest 并重装（`bun.lock` 随提交回退）。

〔结论〕不一次性重排全部 manifest：死依赖删除会让锁文件大幅变化，混在语义改动里无法定位回归。

---

## 十一、安全与构建复现

### 11.1 依赖安装脚本

〔事实〕Bun 默认**不执行**依赖的生命周期脚本，只对内置白名单（且仅 npm 源）执行；`package.json` 一旦显式声明
`trustedDependencies` 会**替换**该白名单，`[]` 表示全部禁止。本仓根 `package.json` 与全部 workspace 均无该字段，
`bun.lock` 也零命中（本次 `grep`），仓内无 `bunfig.toml`/`.npmrc`。
〔未证〕Bun 是否在安装后把该列表写进锁文件、对 `git:`/`file:` 源的行为、1.4.3 的确切语义，本卷未复核；
不据此做任何「已记录/已锁定」的声明。
〔结论〕当前等价于「按 Bun 内置白名单执行」——即**不可控的第三方白名单**。
〔目标〕显式声明 `trustedDependencies`（哪怕为空数组），把「谁会执行安装脚本」变成仓库内可见的决定；
需要原生二进制的包（若将来引入）单独列入并记录理由。CI 用 `mise exec -- bun install --frozen-lockfile`（或 `mise exec -- bun ci`）。

### 11.2 registry 与锁

〔事实〕`bun.lock` 全部 140 个 tarball URL 指向 `registry.npmmirror.com`，每条带 `sha512-…` 完整性。
〔结论〕两件事必须同时说清：
1. **可用性**：锁文件依赖镜像可达；镜像不可达时 `--frozen-lockfile` 会失败（这是特性，不是 bug）。
2. **信任**：镜像是第三方分发点；完整性校验能防篡改，但不能证明「上游发布者是谁」。发布能力包时不得把镜像 URL 写进包内文档或脚本。
〔目标〕CI 记录 `bun --version` + 锁文件摘要；任何 registry 切换（含回官方源）作为独立变更并重跑安装验证。

### 11.3 不可信 schema 与代码

〔目标〕
- 定义包只含数据；不执行 YAML 标签、不 eval、不做模板求值（75-§4.3）。
- 规则求值（Rule Profile）**无 eval**：只允许封闭算子集合 + 显式数据；出现 `eval`/`new Function` 按目标审查口径判负
  （现行无该门禁；本次全仓 grep 两者零命中，属**已有**约束）。
- 正则：所有面向外部输入的正则必须线性（禁嵌套量词回溯）。现状需复核：`core/secrets.ts` 的三条模式（现实现，
  目标归属 `contract/src/secrets.ts`，§3.6）、
  `company/validator.ts` 的 `SLUG_RE`、`dependencies.ts` 的 `VERSION_SPEC_RE`。目标是为每条正则写一个长输入负测（§15）。
- 路径：`isSafeRelativeOutputPath`（`validator.ts:64`）已禁绝对路径、`..`、反斜杠、盘符；所有写盘口应统一走它或等价闸。
- 秘密：出站统一过 `redactOutbound`（目标由 `contract` 公共面提供，`core` 具名转发）；已知值按长度降序替换（防短前缀截断）。
- 依赖：新增依赖必须过 75-D75-10（用途、版本、许可、替代、退出）并在 §9 增加 DEP 条目。

### 11.4 无 `Bun.*`、无新默认依赖

〔事实〕`\bBun\.` 全仓零命中。〔结论〕目标冻结为零；任何 `Bun.*` 出现按目标审查口径判负（现行无该门禁），
它会把代码绑死在非目标运行时。
〔结论〕「新默认依赖」= 未在 §9 登记的包。默认拒绝；确需新增时先补 DEP 条目（含许可与退出），再改 manifest。

### 11.5 复现性等级

〔选择〕三级，逐级给判据：

| 等级 | 条件 | 当前 |
|---|---|---|
| R1 可重装 | 同一个 `bun.lock` + 同一 registry 可达 → 依赖树一致 | **已有**（锁+完整性） |
| R2 可重建 | R1 + 同一 Node/Bun/TS 版本（mise）+ 构建脚本确定性 | **目标**（构建脚本未建） |
| R3 可复算 | R2 + 产物指纹与源码指纹一起登记，任何人可重算并比对 | **目标**（未做） |

〔结论〕未达 R3 之前，不得声称「构建可复现」；只能声称「依赖可重装」。

---

## 十二、当前漂移登记（只登记，交 82）

| # | 漂移 | 证据 | 性质 | 影响 | 建议处置（归 82） |
|---|---|---|---|---|---|
| D1 | `tsconfig.base.json:27-28` 注释「本骨架只做类型门禁，不出产物；打包分发另走 `bun build --compile`」 | 同文件；D75-07 明确「默认独立 tsc 发射，bun compile 只能另审」 | **工程口径冲突** | 照此执行会换运行时与 SQLite，且与双轨构建方案矛盾 | 改注释为「tsc 发射」，`bun compile` 降为另审候选 |
| D2 | 根 `engines.node: ">=24"` 与 mise 钉 `24.21.0` 不一致 | `package.json:14-16`、`.mise.toml:4` | 声明过宽 | Node 25/26 会被视为受支持（而本次探针显示 25 的 sqlite 行为已变） | 收紧为 `>=24.21 <25` 或等价，并在 82 记录一次跨版本验证 |
| D3 | `packageManager: "bun@1"` 与钉死 1.4.3 不一致 | `package.json:9`、`.mise.toml:5` | 声明过宽 | 不同 Bun 小版本的 workspace/安装行为可能不同 | 改 `bun@1.4.3` |
| D4 | `README.md` 目录说明写 `store` 为「node:sqlite + drizzle」 | `README.md` 目录树；`store/src/driver.ts` 头注（drizzle 已移除） | **文档过期** | 让人以为有 ORM 层 | 改文档；AGENTS.md 同句一并改 |
| D5 | `AGENTS.md` 写 `store` 「node:sqlite + drizzle：schema、migration、快照、重建脚本」 | `AGENTS.md` §二 | 同上 | 同上 | 同上（AGENTS 是项目说明，改需制作人确认） |
| D6 | `panel` 端口注释写 `:8787`，实际默认监听 `8791` | `packages/panel/package.json` description；`apps/daemon/src/cli/panel.ts:21`（`let port = 8791`）；`panel/src/judge.ts` 头注「文档逻辑名 :8787、端口实值 :8791」 | 文档/实现双口径 | 运维与面板文档对不上 | 统一为「逻辑名 :8787 / 实值 :8791」或反之，二选一写死 |
| D7 | `store/src/driver.ts` 头注写 drizzle RC 版本（1.0.0-rc.4）与「最新 0.45.4」 | 同文件 | 时间快照 | 被当成现状能力 | 标注「2026-10-16 探测快照」，或改为不含版本号的结论句 |
| D8 | 本地 `node_modules/.bun/drizzle-orm@0.44.7` 残留，但 `bun.lock` 无该条目 | 目录 vs 锁 | 环境漂移 | 有人可能误以为它是依赖 | 不作为证据；必要时 `mise exec -- bun install` 清理并复核 |
| D9 | 同一 workspace 内 execa 两代（daemon 9.6.1 / adapters 10.1.1） | `bun.lock:389`、`:499`；daemon 零使用 | 依赖噪音 | 锁体积、审计面、升级困惑 | §10.1 第 4 项移除 |
| D10 | `test/` 目录未进任何类型 program | `tsconfig.json:4` 只含 `apps/*/src/**/*.ts` 与 `packages/*/src/**/*.ts`；`apps/daemon/tsconfig.json` 只 `include` src；17 个包级 tsconfig 中只有 `adapters`/`core`/`prompt` 的 `include` 含 `test/**/*.ts`，`dsh-bridge` 含但 `exclude` 了 `test/smoke/**` | **门禁缺口（`test/` 目录）** | **现状切换集为空**，根 program 已覆盖全部 `src`：32 个 `src/*.test.ts` **已在门禁内**，不是缺口；切换后这些文件由包级 `tsc -p`（`include` 至少含 `src/**/*.ts`）承接。真正缺口是 `test/`：10 个 workspace 有 `test/` 共 **185 个 `.ts`**，其中仅 adapters 14 / core 17 / prompt 6 / dsh-bridge 1 入包级 program；**147 个不在任何 program**（daemon 86、company 21、panel 18、store 16、taiga 3、contract 2，另加 dsh-bridge 被 `exclude` 的 smoke 1） | 82 立「`test/` 目录纳入门禁」项；可先加独立 `typecheck:test` 脚本。**不得**写成「17 包全串」或「已切四个带 test 包」 |
| D11 | `apps/daemon` 的 `main`/`exports["."]` 指向 `src/index.ts`（横幅占位、`process.exit(0)`），真实主循环在 `assembly/serve.ts`，`bin` 指向 `src/cli/main.ts` | `apps/daemon/src/index.ts`；`apps/daemon/package.json`；80-§3.1/§3.2 | 入口语义混乱 | 「启动 daemon」可能是打印横幅就退出；公共 CLI 实际只有 `cli/main.ts` | 按 80-§3.2 **唯一方案**三步收敛：删 `main`/`exports["."]` 并把根脚本改 `node apps/daemon/src/cli/main.ts serve` → `index.ts` 纯再导出 → 零消费者后退役；**不是**「组合根或无副作用二选一」 |
| D12 | `dsh-bridge` 的测试把 `exports` 钉在 `./src/index.ts`、补丁 `name: ./src/index.ts` | `packages/dsh-bridge/test/bridge.test.ts` | 分发形态锁死 | 切 dist 必须同步改测试与补丁 | 82 记录为「dist 切换的连带改动」 |
| D13 | daemon 以 4 级相对路径推导 dsh-bridge 源（`BRIDGE_SRC_REL`） | `apps/daemon/src/engine/instructions-store.ts:72` | 布局即接口 | 仓外部署/重排目录即失效 | §7.2 的显式产物契约 |
| D14 | `README.md` Quickstart 用裸 `bun <file.ts>` 跑 CLI，而正式运行时是 Node | `README.md` 步骤 4–7 | 验证环境混用 | Bun 的 transform/sqlite 差异可能掩盖 Node 侧问题；裸命令还可能选到非 mise 版本 | 文档标注「开发便利」并给 `mise exec -- node` 等价命令 |
| D15 | `adapters` 的 `yaml` 下限 `^2.0.0` 低于 company/core 的 `^2.6.0` | 各包 `package.json` | 声明不一致 | 解析行为（行号/AST）可能按版本分叉 | 统一下限 |
| D16 | 证据命令口径未统一：README 与部分文档仍写裸 `bun`/`node`，而版本唯一源是 `.mise.toml:4-5` | 本卷 §0.3；`README.md` Quickstart；根 `package.json` scripts | 取证口径 | 交互 shell 的 `node -v` 是系统 PATH 的 v25.6.1，裸命令输出会被误当目标环境证据 | 82 的证据模板强制 `mise exec --`，并记录 `node -v`/`bun -v`/`tsc -v` 三项；脚本本身不需要内嵌 mise |

〔结论〕以上全部只登记，不在本卷修改任何文件。D1–D6 属「文档与实现不一致」，优先处理；D10 属门禁缺口，最影响后续质量。

---

## 十三、不做什么

1. 不把 Bun 当 daemon 运行时，不用 `bun build --compile` 冒充 Node 等价分发（§1.4、§7.6）。
2. 不要求宿主加载 `node_modules` **内**的 TypeScript（Node 明确拒绝，§1.2）；也不拿 `link:` 安装能跑当作实体安装能跑（§4.4）。
3. 不为了「统一」把全部包切成 dist：闭包外的私有包维持 src（§6.1）。
4. 不在依赖未切 dist 时强行构建，也不用放宽 `rootDir`/`paths`/`skipLibCheck` 绕开 `TS6059` 与 `--listFiles` 拓扑断言（§5.2、§6.1）。
5. 不引 `paths`/`baseUrl`，不用条件导出混两轨（§6.3）。
6. 不默认引入 project references（§6.4）。
7. 不引 Ajv 作运行时第二事实源，不反向从 JSON Schema 生成 zod，不在运行时重新生成权威工件（§3.2、§9.2）。
8. 不引 npm range 作为公共规范的版本语法（§9.4）。
9. 不把 `noEmit + emitDeclarationOnly` 的零产出写成构建成功（§5.4）。
10. 不把「全部 private」当「可发布」，不代制作人决定公开许可（§8.3）。
11. 不把 `ErrorCategory` 当处置源：处置只读 `failure`；`category` 只做观测与告警分桶（§3.4）。
12. 不把候选四包写成当前切换集，也不把根 `typecheck` 写成「17 包全串」或「已切四个带 `test/` 的包」；当前切换集为空（§4.4、§12-D10）。
13. 不把 `studio-tools` 的 `./stdio` 入口或 `dist/stdio.js` 写成现状：它是目标，仓内无 `stdio.ts`（§6.2、§6.5）。
14. 不用裸 `bun`/`node` 的输出作证据；证据命令一律 `mise exec --`（§0.3）。
15. 不在本卷创建/修改任何生产 TS/JS、构建配置、测试脚本、manifest、lock（本卷只写这一份 Markdown）。

---

## 十四、选型反例（写出来是为了下次不再讨论）

| 反例 | 为什么看起来合理 | 为什么不行 |
|---|---|---|
| 「既然用 Bun 装包，就用 Bun 跑 daemon」 | 一条命令搞定，启动快 | `transform` 语义 + SQLite 3.51.0 + 报 node 26.3.0；与生产 Node 24 行为不同（§1.4） |
| 「单文件可执行最适合分发」 | 一个文件扔过去就跑（转写方案文档的原动力） | 换运行时=换绑定；SQLite/子进程/信号全部要重证；不是 npm 库的等价物（§7.6） |
| 「用 drizzle 做 migration 更专业」 | ORM + migration 工具链成熟 | 稳定线无 `node:sqlite` 驱动；RC 线不稳；migration 反正手写；引入第二事实源（§9.2 DEP-DRIZZLE） |
| 「JSON Schema 都用 Ajv 跑一遍才放心」 | 规范就是 JSON Schema | 冻结工件不是运行时解释器；普通编译走 `Function`、standalone 生成需加载的 JS 模块；zod 与 Ajv 会双事实源（§3.2） |
| 「版本约束用 npm range 最省事」 | 生态通用 | range 语义庞大且非跨框架规范；`0.x` 语义与我们的冻结策略冲突（§9.4） |
| 「源码同时发 src 和 dist，用条件导出切换」 | 开发调试方便 | 需要所有消费者带 `--conditions`；漏带就解析到 `.ts`，Node 拒绝 strip；造成双模块实例（§6.3） |
| 「用 tsx 跑测试更接近生产」 | 避免 vitest 的转换差异 | Node 24 原生 strip 已是生产语义；多一层运行时反而引入第三种语义（§9.3） |
| 「测试太慢，关掉 strict 或 skipLibCheck 就行」 | 局部提速 | 放宽标尺=改变语义；`skipLibCheck` 已在基线，不能再往下放（§1.3） |
| 「先切 dist，反正能 build」 | 一步到位 | 拓扑不成立就 build 不了：依赖仍指 `src` 时 `rootDir` 越界（TS6059）或产物被依赖源码污染；即使能 build，typecheck 与测试也会读陈旧 `dist/*.d.ts`（§5.2、§6.1、§6.3） |
| 「declarationMap 无脑开」 | 点进源码方便 | 不随包发 src 时 map 指向不存在的文件；发了则可能泄漏本机路径（§5.2、§7.4） |

---

## 十五、未验证项登记（未证 ≠ 支持）

| # | 未证项 | 需要的证据 | 归属 |
|---|---|---|---|
| U1 | `.d.ts` 内 `.ts` 说明符对 **`checkJs`/JSDoc**、非 TS 文本消费者与打包器的兼容（`module`/`moduleResolution` 三组组合已证，§5.5） | 独立 workspace：`checkJs`/JSDoc、esbuild/rollup/webpack、API 提取器、纯文本解析器各跑一遍 | 82 V2/V3 |
| U2 | 是否需要后处理 `.d.ts` 说明符（**只在 U1 出现具体反例时**） | 若 U1 失败，给出确定性改写步骤 + 幂等/回滚证据 | 82 |
| U3 | `npm pack` 实际清单 | `npm pack --dry-run --json` 原始输出 + §7.3 核对表 | 82 |
| U4 | 临时安装 + 消费者 tsc 全绿 | E4 证据 | 82 |
| U5 | DSH 宿主对 **dist 形态**的装载（V5） | E6 证据；docs/31/34 的源码/`link:` 真机证据已存在，本卷未复跑 | 82 V5 |
| U6 | Node 24 显式 `--input-type` 的 eval/stdin 不擦除：官方预期与上游 issue 状态 | 官方文档/issue 原文核对；调用差异本身已复现（默认 `-e` 可擦，显式 `--input-type` 不可） | 82 |
| U7 | YAML 别名/深度/规模上限的实际行为 | 构造 YAML bomb 负测 | 82 V4 |
| U8 | 正则长输入（ReDoS） | 每条正则的 1MB 级输入负测 + 超时 | 82 V4 |
| U9 | `node:sqlite` 在 Node 24 的长跑稳定性（WAL/锁/崩溃恢复） | 48h 级运行 + 崩溃注入 | 82 V4/V5 |
| U10 | Windows 路径/换行/seatbelt 等价性 | 目标平台矩阵 | 82 |
| U11 | simple-git 许可的上游原文 | 上游仓库 LICENSE（包内无该文件） | 本卷/82 |
| U12 | Bun 1.4.3 的 `node:child_process` 兼容面具体数字 | 官方兼容表或自测 | 82 |
| U13 | 构建配置（`tsconfig.build.json`）在本仓的真实产物 | 创建后跑 E2/E3，含 `--listFiles` 拓扑断言与依赖 dist 陈旧检测 | 82 |
| U14 | 「切换包 `src` 退出根 program」后是否仍存在 src/dist 双加载（两份模块实例） | 同进程内「包名 import（dist）+ 相对/源码入口」场景，断言 `instanceof`、私有 `class`、branded 类型；扫描仓内所有导入路径 | 82 |

---

## 十六、与 76/77/78/80/81/82 的接口

### 16.1 与 76（公共语义与纯配置）

- 76 定义对象字段；本卷只给「字段如何落成 TS 类型」的纪律（interface/联合/optional/null/版本字面量），不新增字段。
- **Zod 是参考 authoring**：76 的语义以文字为准，冻结 JSON Schema 是交换投影；运行时不得重新生成权威工件（75-D75-08）。
  本卷补充的工程约束是：生成过程必须可重放、生成漂移必须可检测、非 TS runner 必须能独立校验。
- 版本语法：76 的结构化 SemVer ↔ 本卷 §9.4 的「安装层/声明层分离」。

### 16.2 与 77（运行记录与行为契约）

- 77 定义失败路径与终局（`FailureClass` 14 值）；本卷只固定**错误通道形状**：`failure` 处置轴 / `category` 观测轴 /
  `subcause` 细目、tagged union vs throw、`configInvalid` 的目标补 `failure`（§3.4）。`ErrorCategory` 不得当处置源。
- 77 的幂等键/摘要要求字节稳定 → 本卷 §2.1 的「精确 optional 与条件展开」是它的类型级前提。
- 77 的「外部未知」→ 本卷 §3.2 的 `looseObject` 边界；「未知必需扩展拒绝」→ `strictObject`。

### 16.3 与 78（宿主/平台/传输/存储绑定）

- 78 给绑定字段与损失；本卷给**运行时事实**：Node 24.21（strip、sqlite 3.53.4）、Bun 1.4.3（transform、sqlite 3.51.0）、
  DSH 0.2.0-rc.2（MIT，外部 CLI）、系统 git。
- 「可用/已验证」的判定归 78/82；本卷只声明「哪类证据能证明什么」（§8.1）。

### 16.4 与 80（组合根与公共 TS 接口）

- 80 出 `TS-` ID 与接口签名；本卷给书写纪律与依赖可用性。80 不得使用未在 §9 登记的第三方包。
- 80 的 `daemon/src/index.ts` 定位（D75-11）与本卷 §12-D11 是同一处漂移，处置归 80；80-§3.2 已给**唯一收敛方案**
  （删包根 → 纯再导出 → 退役），本卷不再保留「组合根或无副作用二选一」的读法。
- 80-§3.4 第 10 条的 `matrixSessionFactory` 只构造行为、不传秘密值，**不新增 `daemon→matrix` 边**；80 新增的
  `contract/src/ports/{intent,secret,resources}.ts` 不改变 §6.1 的切换闭包，`PORT_VERSION` 仍 `v0`/`experimental`。
- `core` 的具名 re-export 是 **80-§11.2-3 的目标形态**，不是现状（现状 `core/src/index.ts:82` 是 `export *`）。
- 纯面清单（§3.6）是 80 划 IO 边界的输入。

### 16.5 与 81（逐文件契约）

- 81 的每个文件条目必须能回答：导入哪些包（§4）、错误通道（§3.4）、注入面（§3.5）、是否纯面（§3.6）、
  是否进构建（§5.2）、是否在 `files` 白名单（§7.1）。
- 81 若新增构建文件（`tsconfig.build.json`）或 `files` 字段，其契约必须引用本卷 §5/§7，不得自行另定。

### 16.6 与 82（验证、迁移与追溯）

- 本卷 §8 的证据矩阵 → 82 的 V0–V6 执行登记；§12 的 16 条漂移 → 82 的迁移/整改条目；§15 的 14 项未证 → 82 的待验证清单。
- 82 的构建波次必须按 §6.1 的 DAG（L0→L7）排，不得跳层；每层完成以 E2（含 `--listFiles` 拓扑断言）为闸。
- 82 不得把本卷的**目标设计**当成已完成项；本卷所有「目标」在 82 中必须仍是「未执行」，直到有对应证据。
- 许可与发布范围（§8.3）不在 82 自行决定，仍归制作人。

---

## 附：本卷引用的仓内证据索引

- 工具链：`.mise.toml:3-5`（`node`/`bun` 版本唯一源）、`package.json:8-21`、`bun.lock`（lockfileVersion 2 / configVersion 1）。
- 类型门禁：`tsconfig.base.json:3-31`、`tsconfig.json:3-5`、17 个包级 `tsconfig.json`（2 apps + 15 packages；
  只有 `adapters`/`core`/`prompt` 的 `include` 含 `test/**/*.ts`，`dsh-bridge` 含但 `exclude` 了 `test/smoke/**`）。
- 边界宪法：`scripts/guards/boundary-rules.mjs:24-96`（层位）、`:102-142`（允许边）、`:149-152`（阈值）、`:159-182`（行数基线）、`:193-200`（包内反向边）。
- 信任边界：`packages/contract/src/schemas/errors.ts`（`ClassifiedErrorSchema:44`、`configInvalid:54`）、
  `packages/contract/src/ports/kernel.ts:85-102`（`ErrorCategory`/`ClassifiedError` 现状）、
  `packages/store/src/row-helpers.ts`、`packages/company/src/validator.ts`、`packages/company/src/dependencies.ts`、
  `packages/adapters/src/agentconfig.ts`、`packages/yt/src/http.ts`、`packages/panel/src/external/server.ts`。
- 分发面：`packages/dsh-bridge/package.json`、`packages/dsh-bridge/cordis.patch.yml`、`packages/dsh-bridge/test/bridge.test.ts`、
  `apps/daemon/src/engine/instructions-store.ts:71-110`、`packages/studio-tools/package.json`（无 `./stdio`、无 `bin`）。
- 运行时入口：`apps/daemon/src/cli/main.ts`（公共 CLI 唯一入口）、`apps/daemon/src/assembly/serve.ts`、`apps/daemon/src/index.ts`（现状横幅）、
  `apps/boot/src/boot.ts`（`@studio-next/boot` 的 `main`/`exports["."]`；同目录 `main.ts` 不是包入口）。
- 秘密归属：`packages/core/src/index.ts:82`（现状 `export *`）、`packages/core/src/secrets.ts`。
- 前端产物：`packages/panel/vendor/README.md`、`vendor.lock.json`、`packages/panel/scripts/vendor-pull.mjs`。
