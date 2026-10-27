# C4b · 附录对代码事实核对（daemon / boot / 根）——独立红队审计报告

> 审计员：GLM-5.3 · ZCode 子代理（连接 C4b）
> 日期：2026-10-27
> 对象：`docs/81-技术细节-StudioNext逐文件蓝图.md`（统一写法与处置规则）+ `docs/81-files/16-daemon-engine.md`、`17-daemon-assembly-cli-control-evolve.md`、`18-boot.md`、`19-root-guards-templates.md`
> 真实源码基线：dev HEAD `868844d`（含 v0.5 真单刀合入），工作树只读实测
> 纪律：只读；除本报告外未改/建任何文件；未跑测试/门禁/git 写；工具调用分段限流
> 总判：**四份附录的事实密度与准确度极高——文件清单零漏列、零虚构，关键文件锚点抽核 60+ 处全部命中；仅 4 条 P2 级计数口径瑕疵，无 P0/P1。**

---

## 一、摘要

| 维度 | 结论 |
|---|---|
| 文件清单（漏列 P1 / 虚构 P0） | **零漏列、零虚构**。engine 68 件、test/engine 60+1 件、assembly/cli/control/evolve 41+1 件、boot 5 件、根 10 件 + guards 3 件 + templates 225 件，全部与 Glob/find 实测一致；任务提示的 v0.5 新文件 `engine/merge/{merge-run,merge-lease}.ts` 等**已全部收录**且逐件成条（16-§4.5），无「过时」漏列 |
| 关键文件描述（失实 P0） | engine.ts / serve.ts / boot.ts / boundary-rules.mjs / core decide 的导出名、行号锚、行数、注释原文**逐一对上**（详见表二～表五）；未发现一处失实描述 |
| 分层宪法陈述（16/17/19） | 与 `scripts/guards/boundary-rules.mjs` 实测**全部一致**（7 层/13 纵边/16 包层/38 包间边/22 行数基线/25/600 阈/域平面 engine 13/tools 升格阈 10），处置建议无一违反「只减不增/新件进子域/基线改动走提案流」 |
| 81-§三处置标记 | 每文件条目均带〔现有/目标-保留/拆分/新增/替换/退役/仅测试/未证〕标记；四卷覆盖 保留/拆分/新增/替换/退役 全谱（17 含两件退役：`src/index.ts`、`cli/external.ts`；19 明言「本文无退役件」） |
| 81-§五 5.4 专项 / §六判据 | 逐份判定见 §五；八条判据中可机械复核的六条（1/2/3/4/6/7）全部满足，5/8 属设计判断域，未见违反 |
| 分级问题 | **P0=0；P1=0；P2=4；P3=2（观察项）** |

四份附录一个突出的共同优点：**目标件与现状件零混淆**。所有「目标-新增」均显式标注「文件不存在」并给出复算命令（如 16-§4.12「39 件全部不存在，`find … = 68`」），本次实测全部属实（`contract/src/ports/{intent,secret}.ts`、`core/src/work-readiness.ts`、`core/src/resources/`、`store/src/{records,memory,resources}/`、`assembly/{intent,api,spec,auth,migrate,stdio,runtime}/`、`engine/{tick,dispatch,breaker,work}/`、`scripts/guards/manifest*` 均不存在）。这是「不把规划当能力」纪律的机械兑现。

---

## 二、逐份核对表

### 表 2-1 · 附录 16（daemon engine，2651 行）

| 附录声明 | 实测 | 判定 |
|---|---|---|
| 源码 68 件 / 15476 行；域平面 13；子域 19（55 件）；测试 60 `*.test.ts`+1 夹具；直下 25（24+夹具）；测试子域 16；非 TS 0 | `find`/`wc` 全部一致（68/15476/13/19/60/25/16/0） | ✅ |
| 19 个子域逐域件数（cost-close 1…tools 2，合计 55） | 逐域比对一致（1/4/5/2/3/6/4/6/1/6/4/1/1/3/3/1/1/1/2=55） | ✅ |
| 超大件：engine.ts 2337 / merge-run 582 / sources 479 / taxonomy 465 / fakes 451；测试基线件 scheduler 785 / sources 768 | `wc -l` 全部一致 | ✅ |
| `engine.ts` 导出锚 ：319/:501/:531/:601/:644/:672/:709；函数锚 ：781/:786/:826/:848/:856/:880/:1146/:1183/:1215/:1224/:1361/:1425/:1476/:1570/:2284；键 ：701/:702/:752/:1572；内联 import `:635`；`:310/:312/:313/:314` | 逐条 sed 比对**全部命中**（含 `engine.ts:635` 的 `mergeRun?: import('./merge/merge-run.ts').MergeRunContext` 原文） | ✅ |
| `errors.push(` 实测 23 处；相对导入唯一目标 36 条 | grep 计数 23 / 36，一致 | ✅ |
| 类型环 11 边（engine.ts:310/314、:312、:313；merge-run.ts:80/84/86/87；merge-lease.ts:17；merge-fallback.ts:11；tick-report/types.ts:16） | 逐边验证**全部存在且方向正确**；SCC「恰一分量五节点」未程序化重跑（见 §六） | ✅（边集） |
| `boundary-rules.mjs:62` 域平面 13、`:160/:167/:170` 三条基线、`:30/:31` 层位 | 行号与内容全部一致 | ✅ |
| fakes 被 44 个测试 import；三处生产调用点 `wire.ts:147`/`serve.ts:975`/`cli/external.ts:94` 及守卫差异 | grep=44；三处调用点及 `serve.ts:463-470`（platform 枚举收紧注释原文）、`serve.ts:1541/1547/1548` 横幅、`external.ts:95` console.warn 全部属实 | ✅ |
| judge/worker-key/gate/notify/sites129/output-account 等逐件行数与内部锚（约 30 处抽核） | 全部一致（含 `kernel.ts:85-99` ErrorCategory、`decide.ts:319-322` intentKeyOf、`views.ts:321` dayKeyOf、`output-account.ts:67-77` 宿主时区反例、`route.ts:83` CIRCUIT_BREAK 死支、`gray.ts:93` INCIDENT_EVENT_NAMES） | ✅ |
| §1.2 包依赖面（gateway 3 件、prompt 唯一、company 4 件、adapters 4 件、taiga 唯一 taiga-face） | grep 实测逐包一致（`sentinel/sentinels.ts` 的「@studio-next/taiga」仅出现在注释，非 import，「唯一」成立） | ✅ |
| 「被 40 个测试文件直接 import（grep -rl engine/engine test 计数 41 含 test/control/hot-reload）」 | test/engine 内 40 件 ✅；但全 test 树 grep 实测 **42**（含 `test/cli/industry-templates.e2e.test.ts:29` 直接 import，附录漏计） | ⚠️ P2-1 |
| gate「被 41 个测试文件经 engine.ts 使用」 | 提及 `engine/gate` 的测试文件实测 **40**；41 无法按任何自然口径复算 | ⚠️ P2-2 |

### 表 2-2 · 附录 17（assembly/cli/control/evolve + manifest，2729 行）

| 附录声明 | 实测 | 判定 |
|---|---|---|
| 生产 42 件（assembly 12/2651 行、cli 22/2282、control 2/759、evolve 5/2413、index.ts 36）＝ 8141 行；域内测试 23 件 6798 行；根级 2 件 271 行 | 全部一致（逐文件 `wc -l` 比对：assembly 12 件、cli 22 件、control/evolve 各件、测试 25 件行数**逐一命中**，含 serve.ts 1627、hot-reload 624、stop-channel 135、cutover 459、evolve-guard 244、gray 550、postmortem 590、sandbox 570、hot-reload.test 930、evolution-e2e 652、gray.test 625） | ✅ |
| `serve.ts` 结构锚 ：147/:371/:411/:413/:427/:456/:746/:778/:806/:822/:860/:870/:880/:1434/:1445；启动序列 ：1470/:1471/:1476/:1495/:1508/:1521/:1553/:1558/:1608-1626；错误锚 ：435/:440/:443/:498/:506/:520/:524/:543/:680/:688/:703/:715/:729/:1040/:1054/:1248/:1261；`stop()` :1399-1404 | 逐条 sed 比对**全部命中**（含 `:463-470` 枚举收紧、`:1495` 动态 import、`:1604-1607` 拍等待、停机注释「先停源→drain→关台账」） | ✅ |
| package.json（1253 字节，exports 三键、bin、scripts.start）与 tsconfig.json（161 字节）；根 `daemon` 脚本 | stat/内容全部一致 | ✅ |
| §1.4 IO 纪律：cli 12 件引 node:fs（逐名列举）；spawn 仅 evolve/sandbox；Date.now 于 stop-channel/reload/stop；serve.ts :1476 裸时钟 | 12 件名单**逐名一致**；spawn 一致；Date.now 三文件一致；serve.ts 侧「三处」口径见 P2-3 | ✅/⚠️ |
| §1.5 `configInvalid` 覆盖：evolve 45 处、assembly 仅 2 处（serve.ts:1040/:1054） | evolve 调用数（含括号）实测 45（字符串 49 = 45 调用 + 4 条 import）；assembly 2 处命中 | ✅ |
| 纵轴 13 条纵边、`daemonSrcRootFiles=["index.ts"]`、平面基线、`lineBaseline` 相关 5 条 | 与 boundary-rules.mjs 逐条一致 | ✅ |
| main.ts「18 命令 switch + help/version 面」 | 字母命令 case 实测 19 个＝18 命令 + `help`，「18 命令（不含 help）」口径成立；`external` 退役后 17 亦成立 | ✅ |
| index.ts「零 export、36 行、BANNER+3 行 console+exit(0)」 | grep export=0，36 行，内容一致 | ✅ |
| boot 三文件/test 目录归 18 卷、engine 归 16 卷的排除口径 | 目录划分与实际相符 | ✅ |

### 表 2-3 · 附录 18（boot，1177 行）

| 附录声明 | 实测 | 判定 |
|---|---|---|
| 5 个常规文件：boot.ts 376 / main.ts 12 / boot.test.ts 635 / package.json 20 / tsconfig.json 5 | 全部一致 | ✅ |
| boot.ts 锚：:47/:55（两 env 常量）、:144（bot 密码）、:197（cwd 基准）、:239/:285（deptMap 双读）、:249（snap.slug）、:292（config.company）、:322（HR secret 次选名）、:336（自读 yaml）、:347（装配登录） | 逐条 sed 比对**全部命中**（含 `env[A] ?? env['MATRIX_SHARED_SECRET']` 原文） | ✅ |
| 13 个导出（含两 env 常量）；14 describe / 35 it | grep 计数 13 / 14 / 35，一致 | ✅ |
| `run-serve-opts.ts` 现状仅三键（matrixSource/matrixRoomFace/hrMatrixFace）；`runServe(configPath, opts?)` 现签名 | 三键与位置签名逐字一致 | ✅ |
| 「boot.ts 只用 daemon/serve，engine 只出现在测试导入」 | boot.ts import 面实测：contract(仅类型)/daemon/serve/matrix，无 engine；`boot.test.ts:23` checkMentionPayload 属实 | ✅ |
| boundary-rules `:104-:106` 三条 boot 边、`:161` 基线 645 | 行号与内容一致 | ✅ |
| 现状缺陷清单 11 条（双读 TOCTOU、roles 宽松、env 空串短路、cwd 基准、deptMap/slug 双源、hrMatrix 无 hrSync 静默、双轨秘密、无 logout、注释归属、假秘密命名） | 抽核 5 条（G1 双读、G6 双读/双源、env 回退、cwd 基准）全部属实；其余与已核代码形态一致 | ✅ |

### 表 2-4 · 附录 19（root/guards/templates，1695 行）

| 附录声明 | 实测 | 判定 |
|---|---|---|
| 总量 238＝根配置 6 + 根文档 4 + guards 3 + 模板 225 | 一致 | ✅ |
| 根件行数：package.json 28 / tsconfig 5 / tsconfig.base 33 / .mise 5（Node 24.21.0、Bun 1.4.3）/ .gitignore 4（node_modules/dist/*.log/.DS_Store）/ bun.lock 503 / README 69 / AGENTS 89 / CHANGELOG 270 / LICENSE 21 | `wc -l`/内容**全部一致**（含 scripts 四项、devDeps 三项、`daemon=node apps/daemon/src/index.ts`） | ✅ |
| bun.lock：lockfileVersion 2 / configVersion 1 / workspaces 18 / packages 157 / sha512 140 / `workspace:` 55 / 无 trustedDependencies | 程序化解析逐项一致 | ✅ |
| guards：规则数据 16 类导出、7 层纵轴、13 纵边、16 层位包、38 包间边、22 行数基线、1 反向边（BC-T1）；引擎 13 导出、5 检查器 | Node 实测：rules 对象 15 键 + `rules` 聚合＝模块 16 导出；13/16/38/22/1 全对；boundaries.mjs export=13、check* 函数 5 个（vertical/horizontal/planes/sizes/intraReverse） | ✅ |
| 模板 225 分类：org-config 10、.studio-next 10、README 10、charter 10、prompts 10、部门 config 56、人员 md 91、dependencies 2（仅 game/internet）、plugins 6（2×3）、.gitkeep 18、docs 2（仅 game/internet） | 逐族 find 计数**全部一致** | ✅ |
| 10 套模板矩阵（9/16/19/26/32/31/35/25/16/16；部门 56；人员 91；jobs 94；org-config 行数 181/169/202/348/442/428/509/371/149/198；2-level/game/internet 用 `org-config/v1`，其余 `studio-next/org@1`） | 每套文件数逐一致；2-level 181/8-level 509 抽核一致；`grep -l org-config/v1` 恰命中 6 件（2-level/game/internet 的 org-config+.studio-next） | ✅ |
| `contract/cases.json` dir 域 3 条 `org-config/v1` | grep=3，一致 | ✅ |
| 根 program 含 `src/**/*.test.ts` 当前 32 件；`apps/daemon/test` 86 件；17 份包级 tsconfig，4 份含 test（adapters/core/dsh-bridge/prompt） | 32/86/17/4 全部一致（dsh-bridge 的 test/smoke exclude 也与附录 §6 表呼应） | ✅ |
| 「全仓 test/ 目录下共 177 件 `.ts`」 | `.test.ts` 口径实测 177；但全部 `.ts` 实测 **185**（含 crash-points/helpers/corpus/ulid/smoke 等 8 件非 .test.ts） | ⚠️ P2-4 |

---

## 三、分层宪法核对（AGENTS §三 · guard:boundaries）

机械源 `scripts/guards/boundary-rules.mjs`（219 行）实测，与三份附录的陈述逐项对齐：

| 宪法要素 | boundary-rules.mjs 实测 | 附录陈述 | 判定 |
|---|---|---|---|
| 纵轴层位 root 6/cli 5/assembly 4/control·evolve·engine 3/engine-tools 2 | `daemonLayers`（:29-37） | 16-§2.2（引 :30/:31）、17-§1.1（引 :24-59） | ✅ |
| 13 条纵边（root→assembly；cli→5；assembly→4；control/evolve/engine→engine/tools）；**无 root→engine** | `allowedVerticalEdges` 计 13 | 17-§1.1「冻结的纵边共 13 条」、16-§2.2「无 ["root","engine"]（:55 daemonSrcRootDirs…保证）」 | ✅ |
| 25 文件/600 行阈 | `maxFilesPerDirectory=25`、`maxLinesPerFile=600` | 16-§2.1（20-§三.1/三.2 引用）、17-§1.2、19-§4.1 | ✅ |
| 域平面基线 engine 13/control 2/evolve 5/assembly 1 只减不增 | `domainPlaneBaselines`（:61-66，engine:13 恰在 :62） | 16-§1.1/§2.1（「13＝顶格，只减不增」并据此把 39 个新件全部排进子域）、17-§1.2（「assembly 直下仍 1」等） | ✅ 且处置不违宪 |
| `lineBaseline` 棘轮（22 条；engine.ts:2337、serve.ts:1627、hot-reload 624、boot.test 645、scheduler 785、sources 768 等） | 逐条一致；:160/:161/:167/:170 行号引用全中 | 16-§1.1（「拆完从基线除名（下降不需提案）」）、17-§1.2/§7.1（「全部只许下降」）、18-§6（「目标拆分后删除该基线条目」） | ✅ 且方向一致 |
| tools 升格阈 10 | `toolsPromotionFileCount=10` | 16-§2.1 第 4 条（现 2 件未触发） | ✅ |
| 修订纪律（上调/新增＝提案流） | 头注明文 | 16/17/19 均按此写；17 对退役 `index.ts` 改 `daemonSrcRootFiles` 取**更严**口径（见 P3-1），保守方向不违宪 | ✅ |
| 「三域不互引」非机械门禁 | 同层域内互引自由、无同层冻结边 | 17-§1.3 如实承认「是文档纪律，不是机械门禁」并登记 W-5 回写——**诚实且准确** | ✅ |

处置建议违宪检查：16 的 39 新件全进子域（域平面仍 13）、test/engine 直下 25 顶格不动；17 的 19 新件全进子目录、`cli/external.ts` 退役使 cli 22→21；19 的 3 个 guard 新件不触既有阈值、模板预算自约束（templates 不在 guard 扫描面——附录如实说明）。**未发现任何一条处置建议以提阈/塞基线/越平面方式绕开宪法。**

---

## 四、分级问题

### P0（虚构 / 关键描述失实）

无。

### P1（漏列 / 过时）

无。特别核验：任务预警的 v0.5 真单刀新件 `engine/merge/merge-run.ts`（582 行）、`merge-lease.ts`、`merge-gate.ts`、`merge-brief.ts`、`merge-fallback.ts`、`default-deps.ts` 六件在 16-§4.5 **逐件成条**，类型环分析（§1.3）正是围绕 merge-run/merge-lease 展开，配套测试 `merge/merge-run.test.ts` 等 4 件亦在 §4.9.2 全列——附录成稿于合入后，非过时稿。

### P2（计数/口径瑕疵，不改判定的 Minor）

**P2-1**【定位】16-§4.1 F-DAEMON-ENGINE-ENGINE「测试与证据」＋§12 锚表：「实测 `grep -rl engine/engine test` 计数 41 含 `test/control/hot-reload`」
【真实情况】`grep -rl "engine/engine" apps/daemon/test` 实测 **42** 件＝test/engine 40 + `test/control/hot-reload.test.ts:43` + `test/cli/industry-templates.e2e.test.ts:29`（后者直接 `import { ENGINE_CONFIG_DEFAULTS, createEngine … } from '../../src/engine/engine.ts'`）。主体数字「40 个测试文件」（test/engine 口径）准确；41 为漏计 cli 一件的中间数。
【影响】极小：不影响任何职责/处置判断；但「可复算」承诺下该数复算不出。
【建议】改为「test/engine 内 40 件；全 test 树 42 件（另含 control/hot-reload 与 cli/industry-templates 两件跨域直引）」。

**P2-2**【定位】16-§4.4 F-DAEMON-ENGINE-GATE「测试与证据」：「`gate.ts` 被 41 个测试文件经 `engine.ts` 使用」
【真实情况】提及 `engine/gate` 的测试文件实测 **40**；经 `engine.ts` 使用 gate 的测试（即 import engine/engine 者）为 42。41 在两种口径下均无法复算。
【影响】极小（同上）。
【建议】按 40（直接提及）或 42（经 engine 使用）二选一并写明口径。

**P2-3**【定位】17-§4.2 F-daemon-serve「IO 与注入」：「`Date.now()` 三处（:1476 接管、:1604 拍 deadline、:1605 轮询比较）」
【真实情况】`serve.ts` 含 `Date.now` 字样 **5** 行：:926（`opts?.clock ?? ((): number => Date.now())` 缺省时钟）、:1476、:1604、:1605、:1606（`Math.min(50, deadline - Date.now())`，同属拍间隔等待块）。所列三处行号全部属实，但「三处」计数口径偏小；:926 恰是附录同条自己声明的「clock 只在 buildServeRuntime 内部生成」的实现点，宜并列。
【影响】小：结论「runServe 无法注入假时钟（W-4）」不受影响，反被 :926 强化。
【建议】改为「五处字样：:926 缺省时钟、:1476 接管、:1604/:1605/:1606 拍等待块」。

**P2-4**【定位】19-§3.4「类型门禁的真实分面」：「全仓 `test/` 目录下共 177 件 `.ts`，其中 `apps/daemon/test` 86 件」
【真实情况】全部 `.ts` 实测 **185**（含 `test/engine/crash-points.ts`、core/panel/prompt 的 `helpers.ts`、panel `corpus.ts`、store `ulid.ts`、dsh-bridge/taiga 的 smoke 等 8 件非 `*.test.ts`）；177 恰为 `*.test.ts` 口径。86 件（85 .test.ts + 夹具）准确——17-§〇 的同族口径「86 个 .ts（85 个 .test.ts + crash-points.ts）」就写对了。
【影响】小：缺口结论（`test/` 目录不进根 typecheck，归 79-D10/W82-8）不变；仅口径字样与数字不匹配。
【建议】把「177 件 `.ts`」改为「177 件 `*.test.ts`（另有 8 件夹具/冒烟 `.ts`，合计 185）」。

### P3（观察项，不计缺陷）

**P3-1** 17-§1.2 与 M-i：「退役 `index.ts` 须同步改 `daemonSrcRootFiles` 基线（提案流）」。`boundary-rules.mjs` 头注只把「层位表/允许边/阈值/平面基线/行数基线值的**上调与新增**」定为提案流，「基线值下降与条目除名随任意提交顺带办理」。附录取更严解释（除名也走提案流）——方向保守、不违反宪法，但与机械源注释的宽严边界存在解读差，落地时不必被「必须提案流」束缚（按制作人裁定即可）。

**P3-2** 16-§1.2 依赖表自标「示例，非全列」、19-§1.4 锚表声明「本次只执行了只读命令（guard PASS 627 文件/0 违例）且本机 node v25.6.1 无 bun」——两处自我设限的口径声明如实、可复核（本次审计因纪律未重跑 guard，该 PASS 为附录自述，见 §六）。

---

## 五、81-§三处置标记 / §五专项 / §六判据 逐份判定

### §三（处置与迁移规则）

| 卷 | 标记齐备性 | 判定 |
|---|---|---|
| 16 | 68 个现有件逐件带〔现有/库级-未接/仅测试〕+ 目标处置；39 个目标件全标〔目标-新增，文件不存在〕；5 个接缝件用 `S-ENGINE-*` 不占 F-ID | ✅ |
| 17 | §三处置总表覆盖全部 42 现有件 + 19 目标件（含 2 退役、0 替换的显式声明）；每条目另有处置行 | ✅ |
| 18 | §3.1 目标表（8 件）+ 计数表（新增 4/退役 1/保留 4/替换 0/生产新增 0） | ✅ |
| 19 | §2.1 计数表（新增 3/替换 14/拆分 0（已执行口径）/退役 0）+ 每条目「路径/处置」；6 个插件文件以「保留+待分离」登记不偷计为拆分 | ✅ |

81-§3.2 的两条具体拆分令（`ServeConfig` 独立、`RunServeOpts` 唯一源补通知注入；`EngineConfig`/`Inflight` 先迁 `engine/tick/types.ts` 解环再拆）在 17（serveconfig/runtime/intent 落点）与 16（§8.2 五步硬序）中均被忠实执行为设计；81-§3.3「api 真实装配在 assembly/api/assemble.ts、由 runServe 同进程注入、不得直调 ingest」在 16-§4.10.5 与 17-§4.2 第 7 步双卷一致（无两套说法）。

### §五 5.4 专项（daemon/boot/root 五问）

| 专项问题 | 落点与判定 |
|---|---|
| 入口/组合根/配置分类/主循环七相位/事务与恢复 | 17-§1.7 四入口表＋启动 10 步表（现状 9 步生效+2 缺失的诚实标注）；16-§4.0.2 七相位矩阵（锚到 engine.ts:1582-2236）与 §6 六段写/幂等键表/恢复五点——**全部与实测锚一致** ✅ |
| 三域不互引、root/CLI/assembly 方向 | 17-§1.1/§1.3，与 mjs 一致且如实承认非机械门禁 ✅ |
| 目标拆分与 facade、25/600/域平面只减不增 | 16-§2.3/§8、17-§7.1（全部超限件给拆分清单且只降）✅ |
| 模板每文件与纯配置迁移、根构建与脚本、guards 唯一规则源与机械门禁 | 19-§4.1（规则数据 vs 执行引擎 vs 测试面的分工如实）＋§5（225 件族契约+逐件表；纯配置/能力包分离缺口登记 W76 与 §2.4 不私定路径）✅ |
| 不将根 AGENTS/README 旧事实悄悄改成目标事实 | 19-§3.2 对 README/AGENTS 的改动全部列为「目标替换（内容纠偏）」并单列「改 AGENTS.md 需制作人确认（79-D5）」，未在附录内冒充已完成 ✅ |

### §六（八条完成判据）

1. 路径可枚举可复算：✅（四卷均给复算命令，本次全部复算成功，除 P2-1/P2-2 两处计数瑕疵）
2. 每文件有内部结构/依赖/IO/错误/测试/迁移：✅（16 九面/17 条目字段对齐 75-§五/18 十二项/19 十二项+族契约压缩且声明「不因表格压缩就少字段」）
3. 目标新增件回到 76/77/78/80 ID：✅（每条目标件带「归属/上位」列；16-§4.12 B 组逐件标 CMD-01/WORK-01…EFF-01）
4. 超限件有拆分清单、未提阈/未新增域平面散件：✅（engine.ts→4 组 12 件；serve.ts→10 件；hot-reload→4 件；三个超限测试件→按域拆；全部预算 ≤600 且「预算值只在拆分落地后写入基线」的声明明确）
5. 无 TS-PORT-* 通配、无虚构依赖/能力：✅（TS-PORT-* 仅作上位引用不作本卷 ID；「库级/未接」「未证」面（judge 多数址、mergeRun 真单刀、真 Taiga）全部如实标注）
6. 现有/目标/未证不混写：✅（「39 件全部不存在」「20 行不等于 20 件新增」等自我纠偏口径密集且属实）
7. 覆盖保留/拆分/新增/替换/退役/测试/配置/模板：✅（19 对 .gitignore/bun.lock/.mise 等配置件与 225 模板逐件覆盖；排除项仅生成物与第三方）
8. 政策项与工程选择分开：✅（17-§8.2「需制作人决定」vs §8.3「未证」分列；19-§九 W79/W82 回写清单；18-§8.2/§8.3 同构）

---

## 六、覆盖声明与未能判定项

### 本次已覆盖

- 81 主蓝图全文（197 行）；16 全文主体（1-2000、2292-2651，含 §12 锚点表逐锚核验）；17（1-800 全读 + §六测试表/§七迁移表 + 全部章节标题与关键抽核）；18（1-800 全读，含 §4/§5 生产件条目与现状缺陷清单）；19（1-470、656-760 + 计数/锚点全核）。
- 真实源码：`apps/daemon/src/{engine,assembly,cli,control,evolve}` 全目录清单与全部逐文件行数；`apps/daemon/test/**` 清单与行数；`apps/boot/**` 全件；根 10 文件；`scripts/guards/*` 全件逐段；`templates/**` 全计数与 schema 抽核；`boundary-rules.mjs` 全文；`contract/cases.json`、`contract/src/ports/*`、`core/src/decide.ts`、`panel/src/views.ts` 相关锚。
- 共核验 **约 150 项**可机械复核声明（清单、计数、行数、行号锚、导出、注释原文、存在/不存在），命中 146，瑕疵 4（均 P2）。

### 未能判定项（如实声明）

1. **Tarjan SCC 未程序化重跑**：16-§1.3「全域恰 1 个强连通分量、5 节点 11 边」——11 条边逐一验证存在且方向/种类（import type vs 运行时）与附录一致，SCC 结论与该边集相容，但未独立跑 Tarjan 复算分量数。
2. **上位卷行号锚未核**：16-§12 引用的 `docs/80-…:2031-2083`、`docs/77-…:781-1210`、`docs/82-…:808/812` 等上位卷锚点属 C4a/其他连接的核对范围，本连接未核。
3. **17 中段（约 800-2435 行）与 19 中段（约 470-656、760-1695 行）未逐行通读**：该区间以逐件契约与目标态设计为主，抽样核对的声明（§4.3 control、§4.4 evolve 的件数与行数、19-§5.4 族表结构、19-§6 测试矩阵的文件名）均吻合；如仍有隐患，最可能藏在未抽中的逐件「内部结构」行号锚里，风险等级低（同卷已核锚点命中率 100%）。
4. **18-§7-§9（目标测试件/迁移顺序）与各卷目标态条款**：纯设计处置、不涉现状事实，本连接（事实核对）未逐条审其设计优劣，归 H 系列设计审查。
5. **guard 门禁运行结果**：19-§1.4 自述 `node scripts/guards/boundaries.mjs → PASS（627 文件/0 违例）`——本次审计按纪律未跑任何门禁/测试，该 PASS 为附录自述，未独立复现。
6. **模板 YAML 语义计数（jobs 94、部门/岗位 jobs 集合 56/56 一致等）**：附录声明以 bun 隔离仓 yaml@2.9.1 解析得出；本次仅核文件族计数与 schema 字面量，未重跑 YAML 语义解析（其「不能用 grep 复算 jobs」的警告本身是正确的——`people[]` 的 `- id:` 会混入）。

---

## 七、结论

四份附录（16/17/18/19）+ 81 主蓝图构成的「逐文件蓝图」在 C4b 事实核对维度**通过**：文件全集零漏零虚、关键锚点惊人地精确（engine.ts 20+ 锚、serve.ts 35+ 锚逐条命中）、分层宪法陈述与机械源逐字一致、目标件/现状件隔离纪律执行到位。仅存的 4 条 P2 均为「数字口径」级瑕疵（41→42、41→40、三处→五处、177 的 .ts/.test.ts 口径），不撼动任何处置决策，建议随下一版附录顺带修正。特别值得记录的两点红队确认：① v0.5 真单刀新文件（engine/merge/*）已被 16 卷完整收录并成为其类型环分析的核心对象，无过时风险；② 17-§1.3 主动承认「三域不互引非机械门禁」并登记回写项——这种把文档纪律与机械门禁分开的诚实写法正是该文档体系的价值所在。
