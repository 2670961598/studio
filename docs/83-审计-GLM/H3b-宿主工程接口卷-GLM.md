# H3b 横向审计：宿主平台 × DSH 决策 × TS 工程 × 运行时接口（78 / 78a / 79 / 80）

> 元信息：GLM-5.3 · ZCode 子代理 · 2026-10-27 · H3b 横向（技术细节层：78 宿主平台与工作区 × 78a DSH 决策 × 79 TS 工程与依赖 × 80 运行时与公共接口）。
> 审计对象：`docs/78-技术细节-宿主平台与工作区绑定.md`（1982 行）、`docs/78a-DSH承载权责与岗位运行时-决策方案.md`（734 行）、`docs/79-技术细节-TypeScript工程与依赖选型.md`（1691 行）、`docs/80-技术细节-StudioNext运行时与公共接口.md`（4052 行）。
> 参照：75-§六 依赖条目模板、75-§七 D1–D6、75-§十 实锁基线；真实仓（根/各包 `package.json`、`bun.lock`、`.mise.toml`、`tsconfig*`、import 图、vendor 锁、`node_modules/.bun` 残留）只读核对；76/77/69/81/82 按引用锚点抽核。
> 纪律遵守：只读；未改/建任何仓内文件（本报告除外）；无 git 写；未跑测试套件（仅 `node -e`/`bun -e` 版本探针两条，属只读事实核验）；未安装依赖。
> 结论口径：P0=事实不符/卷间冲突/接口无承载；P1=模板缺项/不完备；P2=表述。

---

## 摘要

**总判：四卷整体质量高，79 的事实层零错误；唯一实质 P0 是 80-§6.9 与 81-files/01 对 7 个端口类型文件路径的未登记冲突（含 81 内部自相矛盾）；两条 P1 是 PRM 生成器接口链断裂与 69-§四「工作空间」端口/六区路径接口无落点。**

1. **78a↔78 一致（①项通过）**：78 是 78a 的**具体化而非另起一套**。78-§0.5 以逐行采纳表记录处置（方案 C 全采纳、PRM 九段、九职责、E0–E6、矩阵、N1–N10、决策 1–10 中改决策 2），四条实质修正（无插件时启动器校验、沙箱=launch 形态+OS、审计独立只是目标、导出≠可信）全部有仓内锚点支撑（`dsh.ts`、`seatbelt.ts`）。PRM 九段名与 78a-§5.2 逐一对应且字段为超集；E0–E6 语义同构；岗位族七行矩阵同构。
2. **79 依赖矩阵事实层零错误（②项通过）**：21 条 DEP 逐条按 75-§六九字段写齐（ID/使用位置/版本[声/锁分列]/用途与不可替代性/兼容与边界/安全与许可/替代与退出/规范影响/证据）；抽核**全部属实**——锁版本与 `bun.lock` 行号逐一吻合（TS 5.9.3、zod 4.6.7、yaml 2.9.1、hono 4.13.13、croner 9.1.0、execa 双代 10.1.1/9.6.1、simple-git 3.36.0、MCP 2.3.1、undici-types 7.24.6、esbuild 0.28.2）；import 图断言精确（croner 恰在 `scheduler.ts:42`、adapters 8 处 execa import、daemon 零 execa/zod、panel 恰 3 处 company import、hono 仅 panel、MCP 在 api 仅注释）；「1257 处相对 import 全带 .ts」「test/ 185 文件/147 不在任何 program」「140 个 npmmirror URL」「drizzle 锁零条目+残留目录」「vendor 三件版本与许可」全部复核为真；Node 24.21.0/sqlite 3.53.4/strip 与 Bun 3.51.0/transform/报 26.3.0 两条探针由本审计独立复现。79 对 AGENTS.md 的工程约束（Node 24 LTS 原生 strip、不引构建链、只写可擦除语法、strict 全开、Bun 仅作壳）完全一致，并把 AGENTS 自身的过期表述（store+drizzle、engines 过宽、8787/8791）如实登记为 D1–D16 漂移而非掩盖。
3. **80 接口覆盖完整、但路径层有一处 P0（③项半通过）**：50 类 `REC-*` 与 77 清单逐族逐 ID 相等（CMD2/DEC1/RCP1/COR1/EVT3/AUTH8/WORK11/EVD8/EXC2/OBL3/MEM3/OBS2/LIFE5=50），§4.7 record→port 50 行无空档，§4.8 另承载 76 侧 REC-MIG-01/REC-LOSS-01 并给出与 REC-LIFE-04 拆名理由；55 个 TS-PORT 在 81-files/01 **全部有 F-ID 承载**（81 自核 `grep -c '^#### TS-PORT-'`=55，本审计独立提取亦得 55）。但 80-§6.9 指名的 7 个端口类型文件（rule/command/evidence/memory/observation/migration/obligation.ts）与 81-files/01 的实际分组（并入 spec/work/effects/lifecycle.ts）冲突，且 81-files/02/16/17 三册引用的恰是 80 的旧路径——同一端口的类型被两处指认为不同文件。
4. **ID/术语一致（④项基本通过）**：BIND-/TS-/DEP-/F- 前缀归属与 75-§2.1 相符，78a 零 ID 分配自守；78→80 的全部节号锚点（§6.6 BIND-01/StateMapping/EFF-01、§11.2.1 秘密五型、§11.4.1 wkey、§3.4 第 10 条 matrixSessionFactory）与 80→78 的锚点（§1.3/§1.4/§9.6）双向解析成功；78↔80↔81 的秘密口径（SecretKind 五值、SecretUse 六值、SEC-MX-BOT-PASSWORD 恰两用途、SEC-WKEY-<ticketId>）三方一致且 81 登记了 G-29 关闭史；82-§12.3 确已登记 P-78-01..16。

计数：**P0 × 1，P1 × 3，P2 × 2**。以下逐条。

---

## 分级问题

### P0-1　80-§6.9 与 81-files/01 的端口类型文件路径冲突（7 处），且 81 内部 01↔02/16/17 互相矛盾

- 【定位】80-§6.9 落点表；81-files/01 §2.1/§4.1 的 F-contract-port-spec/effects/work/lifecycle 行；81-files/02:1254、16:1889、16:2045、17:92。
- 【引文】80-§6.9：「RULE-01 `RuleEvaluator`｜`contract/src/ports/rule.ts`」「CMD-01 / DEC-01｜`contract/src/ports/command.ts`」「EVD-01…05｜`contract/src/ports/evidence.ts`」「MEM-01｜`memory.ts`」「OBS-01｜`observation.ts`」「MIG-01｜`migration.ts`」「OBL-01…｜`obligation.ts`」。81-files/01：「F-contract-port-spec｜`src/ports/spec.ts`｜…`TS-PORT-RULE-01`（`RuleEvaluator`）」「F-contract-port-work｜…`TS-PORT-CMD-01`…」「F-contract-port-effects｜…EVD-01/02、MEM-01、OBS-01、MIG-01」「F-contract-port-lifecycle｜…EVD-03/04/05、OBL-01」。
- 【问题/真实情况】同一端口的类型被指认为两个不同文件：80-§6.9 为 7 个端口域指名了独立文件（rule/command/evidence/memory/observation/migration/obligation.ts），81-files/01 实际把它们折叠进 spec/work/effects/lifecycle.ts（`src/ports` 新文件恰 11 件）。同时 81-files/02-core:1254 把 `contract/src/ports/rule.ts` 标为「80-§6.9 类型落点」、16:1889 引 `ports/command.ts`、16:2045/2057/2069 引 `ports/evidence.ts`、17:92 引 `ports/migration.ts`——与 01 册自己的 F-ID 表冲突。80-§6.9 自定规则「81 若与本表不一致，以本表为准并登记为 81 的改动项」，但两卷均无该偏差的登记（81/01 版本注 v0.4–v0.10 只登记了 G-28/29/30 与 BIND-01 同步）。
- 【影响】类型文件路径出现双事实源；80 设立落点表的目的（「避免每个端口自选一个目录导致同名异处或双轨实现」）在文档层即被打破。缓解因素：55 个端口在 81 全有承载，缺的是路径唯一性而非覆盖面；BIND-01 一行双方已同步一致。
- 【建议】二选一并留痕：①80-§6.9 改表按 81/01 的 11 文件分组重写类型落点列；②81/01 按本表拆出 7 个文件（计数随之改）。无论哪种，须在 80-§6.9 或 81/01 版本注登记该偏差关闭项，并同步 02/16/17 三册的路径引用。

### P1-1　PRM 生成器接口链断裂：78 请求 80 出签名，80 无定义，81 无承载

- 【定位】78-§17.2 表（「PRM 字段（§3.2）｜生成器的接口签名、纯面/IO 面的切分」）；78-§3.3/§3.4（生成位置「框架侧（daemon）」、G1–G8）；80-§6 全集（55 端口无 PRM）；81-files/12 F-dsh-bridge-position-index（「不生成 PRM（78-§3.3 归 daemon）」）；81-files/16/17（grep `prm` 零命中）。
- 【引文】81/12：「非职责：不生成 PRM（78-§3.3 归 daemon）」；80 全卷 PRM 仅以「不进 PRM」的否定式出现，无生成端口或类型。
- 【问题/真实情况】PRM 是 78a 推荐架构的「窄腰」，78 把生成器职责明确给了 daemon 侧并要求 80 出接口签名；80 的 55 端口与 §11 各面均无 PRM 生成器；81/12 明示不生成、归 daemon，但 daemon 两册（16/17）没有任何 PRM 生成器文件条目。G1–G8（单向编译/幂等/只收紧/段绑定/撤回可传/不猜不填/可复算/显式降级）在 75–81 链上无施工承载。
- 【影响】BIND-PRM-01 是 binding 索引里唯一标「blocking」损失的「目标」绑定之一；生成器无接口、无落点，意味着 78 的窄腰设计在 80/81 层尚未闭合，后续立实现单时该件无契约可引。
- 【建议】80 补一个 PRM 生成端口（或显式声明「PRM 生成属 BIND-PRM-01 绑定件、不设公共 TS-PORT」并写明理由与验证归属）；81 在 16 或 17 册补 daemon 侧生成器文件条目（引用 78-§3.2/§3.3，G1–G8 作验收口径）。

### P1-2　69-§四「工作空间」端口在 80 无对应；78 请求的「六区路径解析接口」未落；无 69→80 显式映射表

- 【定位】69-§4.1 端口表「工作空间｜提供受限读、写、产物、临时区和交接材料」；78-§17.2「六区路径（§7.2）｜路径解析接口；不得把绝对路径写进公共类型」；80-§6（55 端口无 Workspace 类端口）、80-§11.3（仅路径三段纪律）。
- 【引文】78-§17.2：「路径解析接口；**不得**把绝对路径写进公共类型」；80-§11.3：「containment／realpath／写入原子性」三条纪律，无接口。
- 【问题/真实情况】80 的 55 端口可语义映射 69-§四 的 11 类端口（定义目录→SPEC/RULE、定义与权威登记→AUTH-03/04、授权与决定→AUTH-05/DEC-01、协作与工作→WORK/BIND、执行能力→EXEC/CAP、产物与证据→EVD、历史与记忆→MEM/REC、信任与秘密→§11.2.1 类型+AUTH-06、入口与通知→API-01/NOTI-01、观察与基础服务→OBS-01+§8.6 注入），但：①80 未给出 69-§四→TS-PORT 的显式映射表，对应关系只能推断；②「工作空间」是唯一无任何 TS 端口承载的 69 端口（受限读写散在 78 BIND-WS-01、adapters seatbelt、80-§11.3 通用纪律）；③78 明确向 80 请求的「六区路径解析接口」在 80 无落点。
- 【影响】跨卷对账时无法机械核验「69-§四 11 端口全覆盖」；工作空间的责任边界（69 称其为端口）在 80 层退化为一节通用纪律，六区（78-§7.2）没有程序化解析面。
- 【建议】80 补一张「69-§四 11 端口 → 55 TS-PORT/类型/声明式豁免」的显式映射表；对工作空间二选一：补一个薄端口（如 `WorkspaceScopePort`：六区解析+containment+realpath），或显式声明「由 78-BIND-WS-01 + §11.3 承载、不设 TS 端口」并写明理由，同时回写 78-§17.2 该行的处置结论。

### P1-3　79-§9.2 DEP-HONO 条目缺「api 声明未用」标注（75-§六「使用位置」字段不完整）

- 【定位】79-§9.2 DEP-HONO：「使用位置：panel 的 `server.ts`、`overview/server.ts`、`external/server.ts`、`static.ts`」；真实 `packages/api/package.json` dependencies 含 `hono ^4.6.0`。
- 【引文】79-§9.2 DEP-MCP-SERVER 对照：「api `^2.0.0`（未用）」——同卷对同类情形有正确写法。
- 【问题/真实情况】api 包在 manifest 声明 hono 但 `src` 零 import（仅 `index.ts:35` 注释提及）；本审计 grep 证实 hono 的 import 只在 panel 四文件。DEP-MCP-SERVER 条目对 api 的装饰性声明做了标注，DEP-HONO 没有；§9.1 总表「声」列也未列包归属。§10.1-2 虽把 api 的全部装饰性依赖（含 hono）登记为清理目标，但 §9.2 单条不自足。
- 【影响】按 75-§六「使用位置：哪个包/文件」的字段要求缺项；单读依赖矩阵会漏掉 api/hono 这条待清理边（须跳到 §10.1 才能看到）。
- 【建议】DEP-HONO 补一句「api 声明未用（§10.1-2）」，与 DEP-MCP-SERVER 同款写法。

### P2-1　78a 未随 78 的采纳回标：决策 2 改期与 §8.2 新建组件清单的处置

- 【定位】78a-§9.1 P1 行：「3 个岗位：执行/复核/协调；3 个 preset」；78-§0.5：「决策 2 的「首批三个 preset」改为「先做执行岗 + 复核岗，协调岗次批」」。另 78a-§8.2 五个 `studio-next-*` 新建组件。
- 【问题/真实情况】78 修改了 78a 的决策 2 与组件清单处置（position→BIND-POS-01、evidence→BIND-EVD-01、worktree→§7 六区、gateway→E2 现行网关；`studio-next-org-context` 在 78 无显式处置行；五个组件名均未被 78 采用——81/12 以「实现选择：78 未定名」自行定名 `studio-next-position` 并登记 G1）。78a 正文无任何回标指针。
- 【影响】低——78a 头部自declare「工作稿…若 78 采纳，由 78 分配 ID」，78-§0.5 采纳表完整可查；但单读 78a 者会以为首批三岗、组件名将落地。
- 【建议】78a 头部加一行指针：「本稿已由 78-§0.5 采纳并修正（决策 2 改期、§8.2 组件由 78/81 另行定名）」。

### P2-2　AGENTS.md §三「根 tsconfig 覆盖全部包」与 79-§12-D10 精细口径的粗细差

- 【定位】AGENTS.md §三：「bun run typecheck（等价 `tsc --noEmit`，根 `tsconfig.json` 覆盖全部包）」；79-§12-D10：「根 program 已覆盖全部 `src`…真正缺口是 `test/`：147 个不在任何 program」。
- 【问题/真实情况】本审计复核：根 `tsconfig.json:4` include 仅 `apps/*/src/**/*.ts` 与 `packages/*/src/**/*.ts`（真实文件确认）；`test/` 185 个 `.ts` 中 147 个不在任何 program（逐包计数与 79 完全一致：daemon 86/company 21/panel 18/store 16/taiga 3/contract 2/adapters 14/core 17/prompt 6/dsh-bridge 2 含 smoke 排除）。AGENTS 的「覆盖全部包」是 src 层面的简化表述，79 已如实把缺口登记为 D10 并明令「不得写成 17 包全串」。两文不冲突，但 AGENTS 作为 worker 第一上下文会传递过宽的门禁保证；79-D4/D5 登记的 AGENTS「store+drizzle」过期句同理（真实仓 store 无 drizzle 依赖、`bun.lock` 零条目，AGENTS 目录表仍写 drizzle）。
- 【影响】后来者据 AGENTS 以为 test 目录也在门禁内；drizzle 句误导 store 有 ORM 层。
- 【建议】AGENTS §三补「测试目录门禁缺口见 79-§12-D10」；§二 store 行删「+ drizzle」（79-D5 已建议，改 AGENTS 需制作人确认——维持 79 的处置路径即可，此处仅登记）。

---

## 覆盖声明

**已精读**：75 全文；78a 全文（734 行）；78 全文（1982 行，含 §0–§18 与附录结论）；79 的 §0/§一/§九（总表+21 条逐条）/§十/§十一/§十二/§十三/§十四/§十五/§十六/附录（其余章节按结构通读+锚点抽读）；80 的 §0/§一–§三（抽读）/§4.4–§4.8/§5 抽读/§6.0–§6.1/§6.6 抽读/§6.9 全表/§11.2–§11.4 抽读/§12 全节/§13 抽读。

**真仓逐项核对（全部属实，除 P1-3 所列缺口）**：根与 17 个 workspace `package.json`；`bun.lock` 的 11 组锁版本与行号锚点；`.mise.toml`；根/daemon/`tsconfig.base.json`（逐行核对 79-§1.3 表的行号）；hono/execa/simple-git/croner/MCP/zod/company 的 import 图；vendor 锁与 LICENSES 目录；drizzle 残留目录；1257 处 `.ts` import 计数；185 个 test 文件逐包计数；140 个 npmmirror URL 计数；`node -e`/`bun -e` 两条只读版本探针（Node 24.21.0/sqlite 3.53.4/strip；Bun 3.51.0/transform/26.3.0——均与 79-§1.1 一致）。

**交叉卷抽核**：77 的 50 类 REC 清单（逐族提取比对，与 80-§4.4 完全相等）；77-§0.5/§4.8/§1.7 锚点存在；76-§8.3 REC-MIG-01、§8.4 REC-LOSS-01、§7.7 状态族、deploymentTighteningOnly 存在；69-§四 端口表与 §五/§六/§七通读；81-files 19 册清单、01 册的 F-ID 端口分组与版本注（v0.4–v0.10）、12 册 position 插件条目、02/16/17 的路径引用；82-§12.3 的 P-78 登记与 GAP-82-03/04（存在性核验）。

**四项审计任务的判定**：①78a↔78：具体化关系成立，无另起一套（通过）。②79 依赖：模板齐、版本实、约束与 AGENTS 一致（通过；P1-3 一处条目缺注）。③80 接口：REC 50+2 覆盖完整、55 端口在 81 全有承载、69-§四映射隐式可推但工作空间无落点（半通过；P0-1 路径冲突、P1-1/P1-2）。④ID/术语：前缀归属、双向节号锚点、秘密/E 级/四态词表三方一致（通过）。

---

## 未能判定项

| # | 事项 | 原因 |
|---|---|---|
| 1 | 79-§9.2 各包「包内 LICENSE 文件有无」的断言（如 simple-git 无 LICENSE、TypeScript 含 LICENSE.txt、MCP Apache-2.0） | 未逐一打开 `node_modules` 内包清单核对；79 给出了证据路径（tarball 目录清单），本审计仅核了 vendor 三件许可文本 |
| 2 | 78a/78 引用的 DSH `0.2.0-rc.2` 随包 README 契约事实（扩展点、沙箱模式、事件类型、hooks 限制） | DSH 是 PATH 外部 CLI、非 npm 依赖，本机无可核对的包体；两卷均已自标「未做真机探针」，与本审计「未证」口径一致 |
| 3 | 80-§2.1/§12.8 对 `scripts/guards/boundary-rules.mjs` 的断言（38 条允许边、`lineBaseline` 22 条、域平面基线数值） | 本审计未逐行比对边界规则文件（时间盒限定于四卷+直接依赖事实） |
| 4 | 78-§13.5/§17.4 关于 82 的全部断言（GAP-82-03 关闭、TR-E/W 行、MIG 波次编排的逐条正确性） | 仅核了存在性与 P-78 登记；82 卷内容属其他审计维度（H3-c 等），未逐条审 |
| 5 | 79-§一 的 Node eval/stdin 擦除差异两行与 76-§6 规则语言细节 | 未复跑 eval 探针（避免不必要执行面）；79 自标 U6 待官方核对，处理诚实 |

---

*本报告为红队审计意见，不构成对四卷的批准；P0/P1 清零前 78/79/80 不得据此立实现单。*
