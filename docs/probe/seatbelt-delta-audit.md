# seatbelt 增量独立审计（v2-seatbelt-delta）

> 审计对象：tag `v2-seatbelt-delta`（`c8f687d`）；增量基线：F8 通过 tag `v2-f8-passed`（`15063ad`）；增量代码面：`fbe634f`（`15063ad..c8f687d`）
> 性质：**只读独立审计**（fresh teammate，不继承 Lead 上下文，不采信施工侧结论）——只新增本报告，未修改任何生产码/测试/契约，未 `git commit`。
> 审计时间：2026-10-30 16:00–16:35（Asia/Shanghai）；审计时仓库工作区干净（`git status --short` 空），HEAD=`c8f687d`，tag `v2-seatbelt-delta`=`c8f687d`、`v2-f8-passed`=`15063ad`。
> 复现环境：macOS 26.3 arm64（Darwin 25.3.0）、Node **v25.6.1**、`dsh`/`sandbox-exec` 在 PATH；**本机无 `bun`**——`bun run verify:v2` 无法逐字执行，按 `package.json` 展开为等价 node/tsc/vitest 命令逐项复跑（见 §五）。计时与施工侧不同（施工侧 118/115/114s；本机 178.93s / 87.88s），计时不属判定口径。
> 只读纪律：独立探针脚本置于 `/tmp/audit-seatbelt-probe.mts`、`/tmp/audit-engine-probe.mts`（不入仓）；本审计只新增本报告（审计期间另有并行成员新增的仓内文件，不属本审计、未参考）。

---

## 一、判定总表（声称 vs 实测 vs 判定）

| # | 增量件声称（`docs/plan/f8-dsf-delta-seatbelt.md`） | 独立实测 | 判定 |
|---|---|---|---|
| 1 | 不写三键＝`undefined`＝引擎 `resolveSeatbeltGrant(undefined)`＝**read-only**；缺省不放宽（§三-1） | 解析产物 `undefined`；resolver 省略 grant 绑 read-only 计划；engine 缺省派发 DISPATCH note=`;seatbelt=read-only;roots=0;`；无任何缺省/隐藏写域根 | **过** |
| 2 | tier 两值封闭；read-only 给 roots/auth 拒；workspace-write 缺键/空数组/非 JSON/相对路径/off/未知一律拒（§三-2） | 套件 10 条解析用例 + 独立探针 43 项全过（含键序/重复键/非字符串原文/嵌套数组项等套件外补充）；failure 全部为显式 CONFIG_INVALID 拒绝 | **过**（附 3 条解析边界观测，见 §二-2） |
| 3 | 同一 grant 进 `wireExecutorFace` 与 `createEngine`，不存在第二写面；workspace-write 在无端子 fake 上 `DISPATCH_FAIL`、不静默降级（§三-3） | 源码唯一消费点核实；`runtime.dispatchSeatbelt === config.seatbelt`（同一引用）；claude+workspace-write 在装配期即拒（证明 grant 确已进 resolver）；引擎侧 widening 对无端子 fake 拒派且零 DISPATCH 台账；无静默降级 | **过**（附 2 条「有条件」观测：端子检查为名字面；profile 写域=授权面全宽＋无 DSH_HOME 重定向——见 §二-3） |
| 4 | 14 tests「真跑配置→runtime→engine 面，不是只测解析」（§三 + §四-4） | 14/14 通过且计数属实；但结构为 10 解析 + 2 runtime/engine 行为 + 1 **纯源码文本锚** + 1 e2e；e2e 用 **fake 冒名 `dsh`**（端子检查按名字面通过），resolver 行为面在增量套件内**无行为测试**，另有 1 处空转断言 | **有条件**（见 §二-4） |
| 5 | 增量树 `verify:v2` 1581 tests 全绿；`verify:docs` 6/6；`guard` 0 违例；§五证据行 `105 files / 1581 tests` | 全门复跑全绿：**106 files / 1581 tests**（2 次独立整跑）、docs 6/6、guard 930 files/0 违例、manifest 5/5、旧台账 7/7、双 typecheck 0；**证据行「105 files」为错**——基线 105 件 + 新增 1 件＝106 件（`git ls-tree` 实测） | **过**（附证据数字更正：105→106） |
| 6 | PRB-04 未执行、fake 无端子、authorization 经既有 `noteText` 归一（非逐字节原文）——均如实登记（§三末段） | 三项登记均核实存在且与行为一致；但增量件**未登记**本通道在生产形态下的两项既有前提（profile=授权面、无 DSH_HOME 重定向）与两项语义敞口（根 `/` 可被授权、authorization 含 ` #` 会被注释截断）；另有 1 处**存量**文档漂移（`docs/v2/12:295`） | **过**（附未登记项清单，见 §二-6） |

**总判定：有条件通过。** 增量的事实性声明（缺省最严、负例 fail-closed、单源 grant、全门绿）经独立复算成立；条件全部是「文档更正 / 边界登记 / 测试补强」，不涉及生产码返工。**不建议**把本增量直接表述为「生产可用的 workspace-write 通道」——实际拦截与 dsh 在 seatbelt 下的真实启动面均未证（PRB-04 未执行），见 §二-3/§二-6。

---

## 二、逐项证据

### 0. 增量面与基线核对

- `git rev-parse v2-f8-passed v2-seatbelt-delta` → `15063ad656a879e158a24f73cddc0b341cd51100` / `c8f687d727062eea33b1616c8b268f2065c46e9c`；HEAD=`c8f687d`。
- `git diff --stat 15063ad..fbe634f` → 恰 8 件（config/executor-face/runtime/coerce/usage/新增测试/ws-escape 源锚/plan-05 注），与增量件 §二表逐项一致。
- `c8f687d`（tag 指向）与 `c23f249` 均为 **docs-only**（3 件/1 件）；故 tag 树的代码面 = `fbe634f`，与增量件对象一致。
- `git diff 15063ad..c8f687d --stat` → 仅 `apps/daemon/src|test` + `docs/plan`（含新增检查单/runbook），**无 `packages/` 变更**（契约/store/adapters 均未动）、无 `docs/v2` 变更、无 `docs/plan/f8-*` 基线文档变更 → 「未改记录类/端口/契约；未改 F8 基线文档」成立。事件词表/记录列未动：`apps/daemon/src/engine/engine.ts` 不在增量 diff 内（DISPATCH note 的 `seatbeltNote` 段在 F8 基线即已存在）。

### 1. 不写三键是否真 read-only；有无隐藏缺省放宽 —— **过**

独立证据：

| 证据 | 实测 |
|---|---|
| 解析面：`parseDaemonConfig(BASE).seatbelt` | `undefined`（不是隐性 `{tier:'read-only'}`）——探针 A1；套件同断言（`seatbelt-config.test.ts:79`） |
| 配置缺省面：`DEFAULT_SERVE_CONFIG` | 键集无任何 `seatbelt*`（探针 A3/F1）；`ServeConfig.seatbelt` 缺省 undefined（`serve/config.ts:240`） |
| 守卫面：`resolveSeatbeltGrant(undefined)` | `DEFAULT_SEATBELT_PLAN`＝read-only/零根/无授权，且对象与根数组均已冻结（探针 E6/E7；`packages/adapters/src/seatbelt.ts:170-178,190-191`） |
| 装配面：`dispatchAdapterResolver(undefined)` | `builtinResolver(name, undefined)` → `BUILTIN_DEFAULT_FACTORIES` → dsh 工厂拿 `DEFAULT_SEATBELT_PLAN`，`dshAdapterOptions` 恒给 `writeRootsOverride: []`（`packages/adapters/src/agentconfig.ts:350-356,528-545`） |
| 引擎面：缺省派发 | 真实 `buildServeRuntime`+`engine.tick()`：DISPATCH 成功且 note 含 `;seatbelt=read-only;roots=0;workspace=`（探针 3a；套件 `seatbelt-config.test.ts:248`）；显式 `seatbeltTier: read-only` 同样 read-only（探针 3e） |
| 装配源唯一性 | 非测试代码中 `config.seatbelt` 仅 3 处：`serve/executor-face.ts:90`、`serve/runtime.ts:368`、`serve/runtime.ts:582`（grep 全仓）；无第二处配置读取/缺省注入 |
| 缺省无写域根 | `DEFAULT_SERVE_CONFIG` 无 seatbelt 键；无任何代码给 `config.seatbelt` 赋缺省 widening 值 |

结论：**read-only 缺省是真事实，不是注释口径**；「不传=不圈定」路径在档位面（`resolveSeatbeltGrant`）、注册面、引擎面三层都不存在。

### 2. 负例逐条核验 —— **过**（附 3 条解析边界观测）

套件 10 条解析用例覆盖：`off`/大小写/未知值、read-only 给 roots/auth、workspace-write 缺 roots/auth、空数组/非 JSON/非数组 JSON/非字符串项/相对路径/裸 YAML 列表/空白 authorization（`seatbelt-config.test.ts:126-195`）。独立探针 43 项（缺省 3＋程序面原始类型 4＋配置负例 22＋配置正例 5＋二道守门/冻结计划 8＋缺省键面 1）中，套件外补测的 B/C 系列 26 项全部按 fail-closed 拒绝：

| 独立探针用例（/tmp，43 项全过） | 结果 |
|---|---|
| `seatbeltTier: off` / `no-sandbox` / `WORKSPACE-WRITE` / `read-only `（尾空格） | 全拒：`seatbeltTier 须为 read-only\|workspace-write` |
| read-only 给 roots / 给 auth / 只给 roots / 只给 auth（tier 缺省） | 全拒：`read-only 档（含未声明 tier 的缺省档）…` |
| workspace-write 缺 roots / 缺 auth / 只给其一 | 全拒 |
| roots=`'[]'` / `'not-json'` / `'{}'` / `'[1]'` / `'[""]'` / `'["relative/path"]'` / `'[[...]]'`（嵌套数组项） | 全拒 |
| roots 裸 YAML `["/abs"]` / 未加引号标量 `/abs` | 全拒（前者明报「须为引号包裹的 JSON 数组字符串」） |
| authorization=`'   '` | 全拒：`seatbeltAuthorization 须非空白` |
| **键序**：roots 写在 `seatbeltTier: read-only` 之前 | 仍拒（交叉校验在循环后统一收口，键序不构成绕过；`serve/config.ts:523-526`） |
| **重复键**：`read-only` 后写 `workspace-write` | 后值生效且缺 roots 被拒（不静默取宽容值） |
| 程序面原始类型（绕过 YAML 的形态）：tier=数字/布尔、roots=对象、authorization=数字 | 全拒（`str()` 非空字符串校验） |
| 二道守门 `resolveSeatbeltGrant` 直调：read-only+roots / widening 空根 / 相对根 / 缺 auth / `off` | 全拒，错误码 `seatbelt/read-only-write-roots`、`widening-without-roots`、`write-root-invalid`、`widening-unauthorized`、`tier-invalid` |

三条**边界观测（不构成放宽，记录备查）**：

1. **JSON 数组只认「单引号包裹」形态**：`seatbeltWriteRoots: '["/abs"]'` 可用；`seatbeltWriteRoots: "[\"/abs\"]"`（双引号包裹）会被 `parseScalar` 剥外层引号但不反转义内层 `\"`，最终按「非 JSON」拒绝（探针 D3）。错误信息与 usage 的例子均用单引号，实际可发现；但增量件/usage 的「引号包裹」措辞有歧义，建议改为「单引号包裹」。
2. **authorization 含 ` #` 会被当行内注释静默截断**：`seatbeltAuthorization: 制作人 批 单 #1 策略A` 解析为 `制作人 批 单`（`serve/config.ts:355` `valueRaw.split(' #')[0]`；探针 D5/C 系列之外）。方向是「更短、仍非空」，不构成放宽，但**授权留痕原文会静默变短**（不是逐字节原文，delta 件已把「非逐字节原文」写为边界，但没点名该截断形态）。建议 DSF 记录，并在部署文档提示授权文本避免 ` #`。
3. **写域根可显式为 `/`**：`seatbeltWriteRoots: '["/"]'` 被配置面与 `resolveSeatbeltGrant` 接受（实测 `{"tier":"workspace-write","writeRoots":["/"],"authorization":"…"}`）。这是**显式**全盘写域，不是隐藏缺省/静默补全；但档位语义（`workspace-write`）没有根最小化校验，等于「显式全权放宽」。属既有档位语义敞口（`packages/adapters/src/seatbelt.ts` 未限制根范围），本次配置通道把它变成 YAML 可达面——建议 DSF 在边界记录或后续单中加「禁止 `/`/系统目录」校验或文档禁令。

### 3. 同一 grant 是否真进 resolver 与 engine；有无第二写面/静默降级 —— **过**（附 2 条有条件观测）

**装配单源性（源码 + 行为双重）：**

- 唯一 resolver 生产调用点：`serve/executor-face.ts:90` `wireRegistry(registry, agentConf, dispatchAdapterResolver(config.seatbelt))`；全仓非测试 `dispatchAdapterResolver(` 调用仅此 1 处（另两处是定义/内部复核）。
- 引擎注入：`serve/runtime.ts:368` `createEngine({... dispatchSeatbelt: config.seatbelt})`（缺省不注入）；`runtime.ts:582` 返回观测位；`engine.ts:758` 派发前 `resolveWorkerDispatchSeatbelt({..., executor: adapter.name, grant: deps.dispatchSeatbelt})`（F8 基线已有，增量只负责把配置值送到这里）。
- 无第二配置读取：`config.seatbelt` 仅上述 3 处消费（grep）；`parseDaemonConfig` 唯一赋值点 `serve/config.ts:525-526`；无其他 YAML 键/环境变量能构造写域。
- 行为证明（探针 2a）：`buildServeRuntime` 产物 `runtime.dispatchSeatbelt === config.seatbelt`（**同一引用**，非仅深相等）。
- **resolver 行为证明（增量套件缺失、本次独立补证）**：构造 `agent.yaml: executors.claude` + `daemon.yaml` workspace-write，经生产装配函数 `wireExecutorFace` → 装配期即抛 `CONFIG_INVALID/agentconfig/seatbelt-unenforceable`（探针 1a）。只有 grant 真正到达 resolver 才会触发该拒绝（read-only 时 claude 可正常构造，探针 1b）——**证明 config.seatbelt 确实进 `dispatchAdapterResolver`**。
- 引擎行为证明：workspace-write + 无端子 fake → `DISPATCH_FAIL` + `dispatch/seatbelt-unknown-executor` + **零 DISPATCH 台账**（探针 3b；套件 `seatbelt-config.test.ts:263` 同断言）；不存在「静默降级为 read-only 照跑」。失败路径 `fail()` 归还泳道/在途（`engine.ts:694-699`）。

**两条「有条件」观测：**

1. **端子检查是「名字面」而非「实例面」**：`assertWideningEnforceable` 用 `dispatchAdapterResolver(grant)(executor)` 按注册名重解析内置家族工厂、再 `factory(undefined)` 做端子检查（`dispatch-seatbelt.ts:346-362`），并不校验引擎实际要 launch 的 registry 实例。实测：registry 注册 `createFakeAdapter({name:'dsh'})`（无端子）+ workspace-write → 端子检查按名字 `dsh` 通过，派发**成功**且台账记 `seatbelt=workspace-write;auth=…`（探针 3c）。该夹具模式在 F8 即已存在且有注释（`ws-escape.test.ts:104`「名字取 'dsh'：放宽档的端子核查面按内置家族名判（fake 只替代端口）」）——**不是增量引入的漏洞**；生产 serve 的注册路径只有两条：demo 缺省 fake（名 `fake`，放宽必拒）与 `wireRegistry`（全部经同一 resolver 构造，名字可解析），当前无生产绕过面。但「无端子即拒派」应被读作「注册名→内置家族面」的保证，**不能**读作「实际适配器实例有端子」的保证；未来若出现自定义 registry 注册，需重新评估。
2. **profile 写域=授权面全宽，无逐 attempt 收窄；配置通道不含 dshHomeRedirect**：`dshAdapterOptions` 恒把 `writeRootsOverride: [...plan.writeRoots]` 传给 dsh（`agentconfig.ts:536-545`），dsh 侧 `writeRootsOverride` 覆写后不再并入 task.workspace/extra/dshHomeRedirect（`dsh.ts:446-465`）；而 `coerceSeatbeltGrant` 产物只有 `{tier, writeRoots, authorization}`，**没有 dshHomeRedirect**。后果：配置通道的 workspace-write 在**每次 attempt 的 profile 里放行的是整组授权根**（dispatch 闸只校验「本 attempt 工位 ⊆ 授权面」，`dispatch-seatbelt.ts:160-171`），且 dsh 的 `$DSH_HOME`（dsh boot 必写 `profiles/<name>/…`，`dsh.ts:124-126` 头注真机结论）不会被重定向进授权面——生产上要么部署侧把 `DSH_HOME` 安排在授权根内（或把含凭据的 `~/.dsh` 也纳入授权根，后者违反最小化），要么 worker 在写 `$DSH_HOME` 时失败。该「收窄腿」缺口在 F8 代码头注已如实登记（`dispatch-seatbelt.ts:48-50`「收窄腿归 LANE-X 后续单」），但**增量件并未登记**；增量件 §三「生产需 agent.yaml 挂 dsh 家族」把生产前提说得过窄。建议 DSF 把「本增量只交付配置通道/计划/留痕收口；逐 attempt 收窄与 DSH_HOME 重定向未随本增量接线；read-only 缺省下 dsh worker 实际启动行为未证」写入增量结论。

### 4. 14 tests 是否真覆盖配置→runtime→engine —— **有条件**

计数属实：`vitest run … seatbelt-config.test.ts` → **14 passed**；`it` 位置实测 14 条（79/84/91/105/126/134/149/163/182/191/248/263/286/301 行）。逐条分类：

| 面 | 用例 | 评价 |
|---|---|---|
| 配置解析（正/负） | 10 条（79–195） | 真解析；负例逐条断言拒绝，非空转 |
| 配置→runtime→engine 行为 | 2 条（248 缺省 read-only；263 widening 拒派+零台账） | **真行为**：经 `buildServeRuntime` + 真 `engine.tick()` + 台账 note 断言；缺省/放宽两条路径都有判别力 |
| 配置→resolver | 1 条（286「装配源锚」） | **仅源码文本锚**（`readFileSync` + `toContain`），不能证明行为；增量的 resolver 行为面在本套件内未覆盖 |
| 端到端 | 1 条（301） | 走 `parseDaemonConfig → createEngine(dispatchSeatbelt) → tick → 台账 note`，**真行为**；但 registry 里注册的是 `createFakeAdapter({name:'dsh'})`（313 行），端子检查按名字面通过、实际 launch 的是无端子 fake——**证明的是「计划/留痕/note 路径」，不是「真 dsh 适配器收到/执行 seatbelt」** |

测试质量问题：

- **空转断言**：91 行用例在 `expect(cfg.seatbelt).toEqual({...})` 之后又断言 `expect(cfg.seatbelt?.tier).toBe('workspace-write')`（101-102 行），前者已完全覆盖后者；且注释写「与 07-08 守门同源：解析产物可被 `resolveSeatbeltGrant` 直接接受」，但**并未调用** `resolveSeatbeltGrant`——注释与断言不符，属空转/误导。
- **弱断言**：301 行用例的 `expect(note).toContain(';roots=')`、`toContain(';scope=')`（345-346 行）——这两个键在 widening 分支恒出现（空列表也渲染键名），判别力弱；`auth=` 原文与 `workspaces/<id>/att1` 两项是有效断言。
- **静态锚**：286 行用例只校验源码字符串；作为防回退锚可保留，但不能计入「行为覆盖」。
- **增量套件缺口**：①配置→resolver 无行为断言（本次用探针 1a 补证可行：agentYaml `claude` + workspace-write 装配期 CONFIG_INVALID，纯内存、无 spawn，建议补入套件）；②无「配置 grant → 真实 dsh 适配器 profile」面（收窄腿/DSH_HOME 未接线，补测需 fake CLI + profile 断言，属可选）；③authorization 归一未在该套件经配置通道验证（F8 `ws-escape.test.ts:222` 已有单元级归一测试；本次探针 3d 验证了配置→引擎 note：`auth=批,wait=999,新行` 且全 note 只有一个官方 `;wait=` 锚）。

判定：**有条件**——覆盖主体（配置解析、runtime 装配、引擎裁决）成立，但 resolver 行为面与真实适配器面未被套件覆盖，且有 1 处空转断言；建议补 1 条 hermetic 行为测试并替换空转断言（不阻塞封版，条件见 §四）。

### 5. 全 V2 门 / docs / guard 复跑 —— **过**（附证据数字更正）

本机无 bun，按 `package.json#verify:v2` 链逐命令等价复跑（同一二进制来源：仓内 `node_modules/.bin`）：

| 命令 | 结果 |
|---|---|
| `node scripts/guards/boundaries.mjs` | **PASS**：扫描 930 文件（范围面代码件 773），**0 违例**，exit 0 |
| `node_modules/.bin/tsc --noEmit` | exit **0** |
| `node_modules/.bin/tsc --noEmit -p tsconfig.v2.json` | exit **0** |
| `node_modules/.bin/vitest run --config vitest.v2.config.ts`（第 1 次整跑） | **106 files / 1581 tests passed，exit 0**（178.93s） |
| 同上（第 2 次整跑，独立重复） | **106 files / 1581 tests passed，exit 0**（87.88s） |
| `node scripts/verify/v2-suite-manifest.mjs` | **PASS** 5/5（include 仅 test/v2、retry 0、无 skip/only、无 `--passWithNoTests`） |
| `node scripts/verify/old-test-ledger.mjs` | **PASS** 7/7（旧测试 209 件、红 13/20 逐条有归属） |
| `node scripts/verify/v0-doc-check.mjs`（`verify:docs`） | **PASS**：V0 六项 **6/6**（审计首跑：docs/v2 18 卷＋docs/plan 16 卷；审计末复跑 docs/plan 17 卷仍 6/6——并行成员新增文件，不计入本审计；真悬空 0） |

**证据数字更正（唯一实测到的不一致）**：增量件 §五写「**105 files** / 1581 tests」。实测：**106 files** / 1581 tests。交叉核实：`git ls-tree -r --name-only 15063ad | grep 'test/v2/.*\.test\.ts$'` → **105 件**；HEAD → **106 件**；`git diff --name-status 15063ad..HEAD` 中 V2 测试仅 `A seatbelt-config.test.ts` 与 `M ws-escape.test.ts`。用例数 1567+14=1581 与声明一致；**文件数应随新增 1 件同步 +1，§五的「105」是基线陈旧数字**。该错误仅在证据文本，不影响门禁结论；但 DSF 记录应写 106/1581（或注明 §五待施工侧更正）。

另：施工侧「连续 3 次」本次独立只做了 **2 次整跑**（均绿、无 flake）；未逐字复跑第 3 次，不代认「3 次」次数本身。`verify:v2` 链逐环节 exit 0 已复现，等价结论：**增量树全门绿成立**。

### 6. 边界登记（PRB-04 / fake 无端子 / authorization 归一）—— **过**（附未登记项）

已登记且核实一致：

| 边界 | 登记位置 | 实测一致性 |
|---|---|---|
| PRB-04 未执行：不证内核实际拦截 | 增量件 29 行；`packages/adapters/src/seatbelt.ts:84-92`；`seatbelt-config.test.ts:17-19`；`docs/v2/12:360`「未执行」；`docs/v2/15` SEC-FC-05「实际拦截能力未探＝按不支持处理」 | 一致；本次审计未执行 PRB-04（无真实 dsh 派发探针），不把「配置面收口」读作「写域封死」 |
| fake executor 无 seatbelt 端子 → 拒派、不静默降级 | 增量件 28 行；测试头注 18-20 行；`ws-escape.test.ts:104` 说明名字面核查 | 一致（探针 3b）；「生产需 agent.yaml 挂 dsh 家族」方向正确，但前提不完整（见 §二-3 观测 2） |
| authorization 进 DISPATCH note 经既有 `noteText` 归一，不是逐字节原文 | 增量件 29 行；`dispatch-seatbelt.ts:288-290`（`noteText` 压平 `;`/换行/连续空白）；`ws-escape.test.ts:222-233`；该文件创建于增量前的 `7b38e3c`（「既有」属实） | 一致；本次经**配置通道→引擎**实测：authorization=`批;wait=999\n新行` → note 中 `auth=批,wait=999,新行`，且 `;wait=` 锚仅官方队列锚 1 个（探针 3d） |
| 未改记录类/端口/契约；未改 F8 基线文档 | 增量件 30 行 | diff 核实成立（见 §二-0）；DISPATCH note 增段（`seatbeltNote`）在 F8 基线即存在，非增量新增记录形态 |

**增量件未登记的边界/漂移（供 DSF 决策，均非本增量代码缺陷）：**

1. **生产前提未登记**（§二-3 观测 2）：profile 写域=授权面全宽、无逐 attempt 收窄；配置通道无 `dshHomeRedirect`；read-only 缺省下 dsh `$DSH_HOME` 写入不在白名单 → dsh worker 在 seatbelt 下的实际启动行为未证。F8 代码头注已登记「收窄腿」缺口，但增量件 §三把生产前提写成「挂 dsh 家族」即够，偏窄。
2. **根 `/` 可被显式授权**（§二-2 观测 3）：档位语义无根最小化；`workspace-write` 的「点名根」可为全盘根。
3. **authorization ` #` 静默截断**（§二-2 观测 2）：授权留痕原文会被行内注释规则缩短（不改变合法性判断，但影响证据保真）。
4. **存量文档漂移（非增量引入）**：`docs/v2/12-技术细节-宿主平台与工作区绑定.md:295` 仍写「文件写·任务派工面｜**未证**：内置工厂不传 seatbelt（缺省不圈定）…」。该句在 F8（IMPL-07-08 缺省翻转 + 07-09 派发闸）后已不成立，增量更使其过时；`verify:docs` 只做 ID/节号机械校验，不会发现此类「语义漂移」。**V2 final 说明不得引用该旧句作为现状**；建议在 final 文档轮修订（本增量按纪律不回改 F8 基线文档）。
5. **存量代码注释漂移（P3）**：`dispatch-seatbelt.ts:51-54` 头注称「引擎派发相位的接线不在本单领土……『校验失败不启』的闸尚未接到主循环」，但 `engine.ts:758` 已在同一提交 `7b38e3c` 接上该闸，且 F8 测试覆盖（`ws-escape.test.ts`「接线面·真引擎」）。属 F8 基线注释滞后，非增量问题，供最终清理时顺手更正。
6. **取证环境口径**：施工侧证据在 bun 下、本审计在 Node v25.6.1（仓 `engines: node>=24`）下复跑；本报告如实标注，不宣称复现了施工侧计时。

---

## 三、不一致 / 空转 / 文档漂移清单（按严重度）

| # | 类型 | 位置 | 事实 | 判定影响 | 建议 |
|---|---|---|---|---|---|
| 1 | 证据数字错 | 增量件 §五（`f8-dsf-delta-seatbelt.md:43`） | 「105 files / 1581 tests」→ 实测 **106 files / 1581 tests**（基线 105＋新增 1 件） | P3 文档；不影响门禁 | 施工侧更正为 106；DSF 记录按实测写 |
| 2 | 空转断言 | `seatbelt-config.test.ts:101-102` | `toEqual` 后再断言同字段 `.tier`；注释称走 `resolveSeatbeltGrant` 交叉校验但未调用 | P3 测试质量 | 改为 `expect(resolveSeatbeltGrant(cfg.seatbelt)).toEqual(...)` |
| 3 | 覆盖缺口 | 增量套件 286 行（源锚）、301 行（fake 冒名 dsh） | resolver 行为面仅源码文本锚；e2e 的 `dsh` 是无端子 fake（名字面具端子） | P2 证据强度 | 补 1 条 agentYaml `claude`+workspace-write 装配期拒（hermetic）；可选补 dsh fake-CLI profile 断言 |
| 4 | 未登记边界 | 增量件 §三 28-30 行 | profile=授权面全宽/无逐 attempt 收窄；配置通道无 `dshHomeRedirect`；read-only 下 dsh `$DSH_HOME` 写面未证 | P2 边界完整性 | 写入增量结论/后续单；不得宣称「生产即可用 widening」 |
| 5 | 语义敞口 | `serveconfig/coerce.ts`（根校验）/`seatbelt.ts` 档位语义 | 显式根 `/` 被接受（全盘写域）；无根最小化 | P2 安全语义 | DSF 记录；后续单禁止 `/`/系统目录或文档明令 |
| 6 | 取证保真 | `serve/config.ts:355` | authorization 含 ` #` 被注释规则静默截断 | P3 证据文本 | 文档提示；或对授权文本禁用行内注释形态 |
| 7 | 存量文档漂移 | `docs/v2/12…:295` | 「内置工厂不传 seatbelt（缺省不圈定）」已过时（F8 起缺省 read-only、派发闸接线） | P2 定稿风险 | final 文档轮修订；V2 final 说明不得引用该句 |
| 8 | 存量注释漂移 | `dispatch-seatbelt.ts:51-54` | 称引擎闸未接线，实际 `engine.ts:758` 已接（同提交 `7b38e3c`） | P3 可读性 | 顺手更正（非增量必须） |
| 9 | 环境口径 | 本报告 §〇 | 本机无 bun、Node v25.6.1、计时与施工侧不同；独立 2 次整跑而非 3 次 | P3 透明度 | 已在报告中如实标注 |

---

## 四、DSF 增量审查建议

**结论建议：增量通过（有条件）。** 不建议因增量代码本身打回（缺省最严、负例 fail-closed、单源 grant、全门绿均独立复算成立）；条件应写入 DSF 增量结论，其中 C1/C2 建议在定稿前完成，C3 可列为封版后补强。

- **C1（文档更正）**：施工侧更正增量件 §五「105 files」→ **106 files / 1581 tests**（或 DSF 记录按实测 106/1581 写）。
- **C2（边界登记，必须）**：增量结论明列本增量只证明「配置通道解析/装配/计划/留痕收口」，并保留以下边界：①PRB-04 未执行——不证内核实际拦截；②profile 写域=授权面（无逐 attempt 收窄），配置通道无 `dshHomeRedirect`，生产 workspace-write 需部署侧 `DSH_HOME` 安排在授权根内；不能把「生产需 agent.yaml 挂 dsh 家族」当作充分条件；③显式根可为 `/`（全盘写域，未做根最小化）；④authorization 中 ` #` 会被注释规则截断（note 归一之外的另一处原文改写）。若 DSF 的验收口径是「生产可用 workspace-write」，现有证据不足，应不接受该强口径；若口径是「配置通道/计划/留痕收口」，则增量声明与证据相符。
- **C3（测试补强，建议但不阻塞）**：①新增 agentYaml `claude` + `seatbeltTier: workspace-write` → 装配期 `CONFIG_INVALID/agentconfig/seatbelt-unenforceable`（本次探针 1a 已验证可行，纯内存无 spawn，可补进 `seatbelt-config.test.ts`）；②把 101-102 行空转断言替换为 `resolveSeatbeltGrant` 交叉校验；③可选：dsh fake-CLI 下校验 `profile` 写域=grant 根（收窄腿未接前仅能证「授权面」而非「attempt 面」）。
- **C4（定稿文档）**：V2 final 说明/检查单不得引用 `docs/v2/12:295` 旧句；在 final 文档轮修正（本增量按纪律未回改 F8/final 文档）。
- **C5（后续单）**：per-launch/逐 attempt 写域收窄 + `dshHomeRedirect` 接线（LANE-X「收窄腿」）、根 `/` 与系统目录禁令、authorization 原文保真——建议各自立单，不在本增量内扩面。

---

## 五、复现命令与输出摘录

```text
# 基线与范围
git rev-parse v2-f8-passed v2-seatbelt-delta
  → 15063ad656a879e158a24f73cddc0b341cd51100 / c8f687d727062eea33b1616c8b268f2065c46e9c
git diff --stat 15063ad..fbe634f      → 8 files（与增量件 §二表一致）
git diff 15063ad..c8f687d --stat      → 11 files（8 文件 + 3 docs）
git status --short（审计开始时）      → 空
git ls-tree -r --name-only 15063ad | grep -E '^(apps|packages)/[^/]+/test/v2/.*\.test\.ts$' | wc -l → 105
git ls-tree -r --name-only HEAD     | grep -E '^(apps|packages)/[^/]+/test/v2/.*\.test\.ts$' | wc -l → 106

# 门禁（本机无 bun：按 package.json#verify:v2 逐命令等价复跑）
node scripts/guards/boundaries.mjs
  → 边界门禁 PASS：扫描 930 文件（范围面代码件 773），0 违例
node_modules/.bin/tsc --noEmit                                   → exit 0
node_modules/.bin/tsc --noEmit -p tsconfig.v2.json               → exit 0
node_modules/.bin/vitest run --config vitest.v2.config.ts        → 106 files / 1581 tests passed, exit 0（178.93s）
node_modules/.bin/vitest run --config vitest.v2.config.ts        → 106 files / 1581 tests passed, exit 0（87.88s，第 2 次独立整跑）
node scripts/verify/v2-suite-manifest.mjs                        → PASS 5/5
node scripts/verify/old-test-ledger.mjs                          → PASS 7/7
node scripts/verify/v0-doc-check.mjs                             → PASS 6/6（docs/v2 18 卷＋docs/plan 16 卷）
node_modules/.bin/vitest run --config vitest.v2.config.ts apps/daemon/test/v2/security/seatbelt-config.test.ts
  → 14 tests passed

# 独立探针（均在 /tmp，不入仓）
node /tmp/audit-seatbelt-probe.mts   → pass=43 fail=0（缺省/负例/键序/重复键/非字符串原文/二道守门/冻结计划）
node /tmp/audit-engine-probe.mts     → pass=9 fail=0（resolver 行为、runtime 同引用、缺省 read-only、无端子拒派、
                                        fake 冒名 dsh 名字面、authorization 归一）
```

关键探针原始输出摘录：

- `1a agent.yaml 挂 claude + workspace-write：装配期即拒（agentconfig/seatbelt-unenforceable）` → **PASS**
- `2a runtime.dispatchSeatbelt 与 config.seatbelt 同一引用（===）` → **PASS**
- `3b workspace-write + 无端子 fake：DISPATCH_FAIL + 零 DISPATCH 台账（fail-closed）` → **PASS**
- `3c fake 冒名 dsh + workspace-write：派发成功且台账记 workspace-write（端子检查=名字面，非实例面）` → **PASS**
- `3d authorization 分号/换行归一：note 内 auth=批,wait=999,新行；;wait= 锚仅 1 个（官方队列锚）` → **PASS**
- 根 `/` 探针：`config channel accepts root / : {"tier":"workspace-write","writeRoots":["/"],"authorization":"全盘授权测试"}`；`resolve accepts root / : {...writeRoots:["/"]...}`（仅记录，不改判）
- 双引号 JSON 探针：`seatbeltWriteRoots: "[\"/abs\"]"` → 被拒（parseScalar 不反转义内层引号；单引号形态可用）
- authorization ` #` 截断探针：`auth after parse: "制作人 批 单"`（原文 `制作人 批 单 #1 策略A`）

> 备注：本报告只读审计结论；未执行 PRB-04（写域实际拦截探针），未启动真实 dsh 派发，未修改任何生产码/测试/契约，未 commit。增量件 §五的「3 次」次数未独立复跑，本机独立整跑为 2 次（均绿）。
