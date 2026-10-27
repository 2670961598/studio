# L3-Q · 细节层 · 逐文件 E（daemon 装配/CLI/control/evolve、boot、root-guards/templates）横向审计

> 审计员：L3-Q（独立审计，非作者，不为任何结论辩护）。
> 审计日期：2026-10-27。口径：`docs/audit-DSF/_scope-DSF.md` §二–§五（P0–P3、证据纪律、六段结构）。
> 范围（全文逐段读完，非摘读）：
> - **17** = `docs/81-files/17-daemon-assembly-cli-control-evolve.md`（2729 行）
> - **18** = `docs/81-files/18-boot.md`（1177 行）
> - **19** = `docs/81-files/19-root-guards-templates.md`（1695 行）
>
> 位置缩写：`17:186` = 上述 17 卷第 186 行；`18:316`、`19:718` 同。代码引用写全路径。
> 方法：三卷全文通读；对文档的「事实/实测/已有」逐条做机械核对（`find`/`wc -l`/`grep`/`node` 读 `boundary-rules.mjs`/读源码）；只读，未改任何设计文档、源码、配置；只写本报告。

---

## 一、结论

- **P0 = 0；P1 = 6；P2 = 7。** 未发现使根命题/数据或安全边界整体失效的缺陷；本层的真实问题集中在「跨文件交班」与「同一卷内表格 vs 正文的口径漂移」。
- 三卷的**事实核对质量很高**：17 的 63 个 `F-daemon-*` 条目行号/键数、18 的 boot 文件事实、19 的 guards 数据与 22 条基线，抽查基本全中；19 唯一实跑（guard PASS / 627 文件 / 499 范围件）已在本机原样复现。问题不在「数据编造」，在**集合、顺序与前提的漏项**。
- 最严重 3 条：
  1. **Q-02（P1）**：80-§3.6 强制的「授权三段准备」在 17 的 10 步启动序里消失；19 个新增目标件中 5 件（spec/auth/credentials/stdio/migrate）没有任何装配点或生命周期挂点，stdio 面还缺启用开关与停机 close——「装配根」唯一，但不覆盖自己新开的 26% 目标件。
  2. **Q-01（P1）**：同一 `SEC-MX-BOT-PASSWORD` 在 17 与 18 有**两套 `allowedUses`**：17/80/78 为「platform-auth + outbound-redaction，不含 matrix-register」，18 的 §8.3-6 却写「含 matrix-register（建号）」、§4.5.1 又禁止 bot 密码建号——同一卷自相矛盾，落 catalog 时按哪边都会错。
  3. **Q-04（P1）**：17 的「判据类冻结面」只有 3 件（AGENTS.md / cases.json / docs/20），漏了 19 与 20 都认定为「规则数据唯一源 + 判据类资产」的 `scripts/guards/boundary-rules.mjs`——改阈值/方向表/基线不会触发启动自检的 ESCALATE。
- 一句话：本层**可以带着走，但 Q-02/Q-01/Q-04/Q-06 必须在实现前修**；其余 P2 是实现单开工前的一次对齐，不是重写。

---

## 二、发现表（P0 → P2）

| ID | 级别 | 类型 | 位置 | 事实 / 引文 | 为什么错 | 修复路径 |
|---|---|---|---|---|---|---|
| Q-01 | P1 | A+F | 17:206-210；18:299-300、18:316、18:1102；对照 80:3626/3633、78:1017 | 17：「`SEC-MX-BOT-PASSWORD` = **`platform-auth` + `outbound-redaction`**（**不含** `matrix-register`：请求该 use 即 `rejected_forbidden`）」；18:316：「`SEC-MX-BOT-PASSWORD` 的 `matrix-register` 保留未用」；18:1102：「其 `allowedUses` 含 `platform-auth`（登录）与 `matrix-register`（建号）」；18:299-300 又说建号只认 `SEC-MX-HR-SHARED`、「**不得**用 bot 密码建 HR 账号」。80/78 均已写「恰两项、不含 matrix-register」。 | 同一 secretId 在同一层两卷里有两种用途面。按 18:1102 落 catalog 会把**建号用途授予 bot 密码**（安全边界放宽）；按 80 则同一配置拒启动（部署起不来）。18 自身 §4.5.1 与 §8.3-6 也互斥，实现者只能二选一。 | 删 18:316 与 18:1102 的旧口径，统一写「恰两项；请求 matrix-register ⇒ `rejected_forbidden`」；在 `serve-secrets`/catalog 负向用例加「bot 条目含 matrix-register ⇒ `CONFIG_INVALID`」。属删句+补测，不改设计。 |
| Q-02 | P1 | B+C | 17:518-531（10 步表）、17:776-783（buildServeRuntime 装配序）、17:546-553（停机五步）、17:1555/1584/1624/1655/1698（五件签名）、17:646-741（73 键）；80-§3.6（80:393） | 80：「目标态需在第 4 步与第 6 步之间插入**授权三段**的准备」。17 的 10 步表只有 1 读配置/2 开库/3 接管/4 公司目录/5 Taiga 探针/6 buildServeRuntime/7 API/8 源/9 循环/10 停机，无授权步；装配序也无 auth/spec/stdio/migrate。`assembleSpecs`/`assembleAuthority`/`createCredentialCatalog`/`runMigrationWindow`/`createStdioBroker` 在 17 中只有定义与测试行，**无调用点**；`runMigrationWindow` 明写「**不在 serve 主循环里执行**」，而 17 §五的 18 个命令里没有 migrate；stdio 在 73 键里无启用键，停机五步无 broker close。 | 19 个新增目标件有 5 件无法被装配/启停：文件契约写得再细也无法执行，只能成死代码，或被硬塞进主循环（同时违反 17 自己的「不在主循环」与固定 10 步）。80 强制的授权准备被静默丢掉，是「启动顺序与 80 §3.6 一致」的直接反例；「装配根唯一」因此只在形式上成立。 | 在 10 步表插入 5.5（`assembleAuthority` → `EffectGateway` 注入）、6.x（`createCredentialCatalog`/`assembleSpecs`）、7.x（stdio `listen` + 句柄）；停机五步加 stdio close；给 stdio 一个配置开关或明写「恒开」；给 migrate 一个受控入口（CLI 或运维入口），并写进 §4.2 域前言的四条序。 |
| Q-03 | P1 | A+E | 17:186；17:2392；`apps/daemon/src/cli/usage.ts:288-291`；`apps/daemon/src/cli/taiga-cure.ts:73` | 17:186：「CLI 退码**唯一声明源**是 `cli/usage.ts` 的 `USAGE_TAIL`……**`2` 仅两处**——`company validate` 判定器自身错误、`serve` 运行中断」；17:2392 给 `taiga-cure` 的退码却是「0/1/**2**（A2 失败条数 > 0）」；代码 `taiga-cure.ts:73` `return problems > 0 ? 2 : 0`，而 `usage.ts` 的 2 只列两处。 | 「唯一声明源」被同一卷和代码同时否证：退码契约有第三个 2，且不在声明源里。按 17:186 写的验收/对账不会覆盖它；按 17:186「修正」taiga-cure 会把 A2 失败压成 1，破坏 2392 的档案面语义；按 2392 写测试又会被 186 判为「越界退码」。 | 二选一写死：把 taiga-cure 的 2 写进 `USAGE_TAIL`（保留 2392），或把 2392 改成 1 并说明 A2 失败属判定红；加一条「每个 `return 2` 站点都在 `USAGE_TAIL` 声明」的 help-face 断言。 |
| Q-04 | P1 | F+G | 17:1906-1914；`apps/daemon/src/evolve/evolve-guard.ts:102-106`；19:446-447、19:460、19:651；20:112、20:178、20:228、20:255 | 17 的 `FROZEN_FRAMEWORK_ASSETS` 只有 3 件（`AGENTS.md`、`packages/contract/cases.json`、`docs/20-工程总规程.md`），归属写「20-§九（判据类冻结面）」；19 说 `boundary-rules.mjs` 是「**规则数据唯一冻结源**」、其「层位/允许边/阈值/基线**上调与新增**属判据类资产修订，走提案流 + 制作人批」，且 20 的判据类定义含「验收口径/探针/阈值/分歧判据」、指明 `boundary-rules.mjs` 为唯一源。 | 冻结清单漏掉**机械宪法源**：改阈值/基线/允许边不会触发启动自检的 `ESCALATE`，「判据类改 = 制作人亲批」在唯一机械清单上没有落点。17 把 3 件写成判据类全集，与 19/20 的集合不等；代码头注自称「样例集/待批示」，17 未带这个限定，读者会当成完整契约。按 P1 记（自检为观察模式、`authorize` 仍按候选集判负）；若该自检升为阻断模式，本条按 **P0** 处理。 | 把 `scripts/guards/boundary-rules.mjs` 加入 `FROZEN_FRAMEWORK_ASSETS`（并考虑 82 探针矩阵），在 80/20 登记清单变更；17 §8.1 记一条回写。改动是一行清单 + 一条提案。 |
| Q-05 | P1 | A+C | 19:718；`templates/company-2-level/org-config.yaml:55`、`:63`（全仓模板 18 件含「时区」）；19 §2.3/§5.5.1（14 件替换清单）；对照 80-§4.1 | 19:718 自述：「cron 注释写『本地时区（按制作人机器本地时区解析）』，而 80-§4.1 要求公司本地日/时区由**公司目录显式声明**，不得读宿主时区；模板里没有 `timezone` 字段 → W76-5」。但 19 的目标替换 14 件只有 root 6 + 模板 schema 8，**不含**这些注释、也不含 timezone 字段。 | 10 套模板是 `init` 的默认骨架，18 个文件把宿主时区语义写进了默认内容；目标态仍然如此，调度实现按模板写就会用宿主时区，所有跨时区部署的 cron 都会错点。19 已识别却未排进目标集，等于「带着已知错交付」；这是模板层最实质的语义问题，不是文案。 | 把 W76-5 列为模板发布的阻塞项；先在模板注释去掉「按制作人机器本地时区」的断言（改成「待公司目录声明」），待 76 定字段后改 2 级并重生成 3–9；不要由 19 私定键名。 |
| Q-06 | P1 | D+C | 18:405、18:452、18:532、18:587；17:1470；对照 80-§3.4 第 7 条 | 18：「`input` 由收到的 `config` 或 `configPath` **原样组装**，`{ config }` 分支不二次读盘、`{ configPath }` 分支只读一次」；18:452：「`configPath` 分支下 `readFileSync(...)` 读 daemon.yaml（**全流程仅此一次**）」；但 18:532 `main.ts` 传 `{ configPath }`，17:1470 `runServe` 内再 `parseDaemonConfig(readFileSync(...))`；80-§3.4 第 7 条明令「`configPath` 与已解析 `Config` **不得双读**」。 | `{ configPath }` 分支实际读两次（boot 一次 + runServe 一次），正是 80 要关闭的 TOCTOU；18 的「在设计上消失 / 全流程仅此一次」只对 `{ config }` 成立，而仓内唯一启动器 `main.ts` 恰恰走 `{ configPath }`。于是「双读已关闭」是**把目标写成已有**（D 型），且唯一可用入口带 TOCTOU。 | boot 收 `{ configPath }` 时也只在 boot 内解析一次，然后 `runServe({ config }, { deploymentBaseDir: dirname(configPath) })`——boot 绝不把 `configPath` 转发给 runServe；或删掉 boot 的 `configPath` 入参，让 `main.ts` 读+解析后传 `{ config }`。S5 改成断言「boot 不向 runServe 传 configPath」。 |
| Q-07 | P2 | A | 17:462-464；17:528-529；17:531、17:552、17:767、17:1300；17:932；对照 80-§3.6 | F-daemon-serve 职责写「**起唤起源 →（可选）对外 API**」，而 10 步表与 80 是 step 7 API → step 8 sources；17:932 写「HTTP 面先停收新单 → **再 drain 在途** → 关 session → 最后关台账」，而 17:531/552/767/1300 写 **session close 在 `engine.dispose()` 之前**。 | 两处「写死」的顺序在正文与表格间互斥：启动序 API/源的先后、停机序 session/drain 的先后。实现/测试按不同处写会得到不同序，且 17:932 与同卷其余四处相反，验收时无法说清哪套是准。 | 以 10 步表与五步 stop 为唯一权威；改 462-464 为「起唤起源在 API 装配之后」；改 932 括注为「api → session → engine(drain) → ledger」；§4.2 域前言只留一套序。 |
| Q-08 | P2 | C | 17:479-481、17:564；18:216、18:1097；对照 80-§3.4 第 6 条 | 17 的 serve.ts re-export 面清单不含 `RunServeOpts`/`BuildRuntimeOpts`，并写「本文件保留 runServe + `RunServeOpts`/`BuildRuntimeOpts` 的**消费**（类型仍在 `hrsync/run-serve-opts.ts`）」；18 要求「`RunServeOpts` 必须由 `@studio-next/daemon/serve` **再导出**」，boot 测试不得相对路径穿透。 | boot 的唯一合法导入路径缺这个类型导出：实现要么加导出（17 的导出契约没写）、要么相对路径穿透（18 的判负）。这是把已定设计在文件级 silently 缩窄，typecheck 前不可见。 | 在 F-daemon-serve 导出面写死 `export type { RunServeOpts, BuildRuntimeOpts }`（来自 `run-serve-opts.ts`），并在 §6.7 加一条 re-export 类型测试，M-f 门禁加 `typecheck`。 |
| Q-09 | P2 | C+G | 17:948/964/967 vs 17:2363/2584；80:3297；82:633；17:189/428；17:2550/2551/2553/2536、17:1786/1840；17:566-569；19:434 | ① M4 同一卷既有「十一项」（948/964/967）又有「**十项**」（2363/2584），80 明写「共 11 项」，82 亦写十一项；② `evolve/**` `configInvalid` 写 45 处（189/428），实测 **49 处**（`grep -o`：cutover 9/gray 16/postmortem 17/sandbox 7）；③ §7.1 与逐件预算 4 处不一致：receipt-store 220 vs 240、runtime/secrets 120 vs 200、serveconfig「四件/≤120/300/600/150」vs 三件/300/120/600、「四件各 ≤350」vs execute ≤400；④ 「除这 10 件外还有六个独立目标件」：10+6≠19（正解：9 新件 + 6 + 4 hot-reload）；⑤ 19:434「全仓 `test/` 目录 177 件 .ts」，实测 **185**（daemon 86 ✓）。 | 这卷的自我判据是「可复算」。这些数字直接用作验收闸（M4 全绿才可删旧面）、拆分预算与迁移门禁：M4 错数让闸门少验一项（status 端点），预算错数让实现对不上，177/185 让类型门禁缺口的规模失真。属「一致性与验收清晰度」，但必须现在对齐，不能带进实现单。 | 以逐件条目为唯一源重算 §7.1；M4 两处改十一项；45 改 49；「10 件+六件」改成「9 新件 + 6 + 4」；177 改 185；§8.4 给一条可复算命令清单（find/grep 计数），别只写「已复核」。 |
| Q-10 | P2 | B | 78-§12.3（78:1627-1634）；82:744；17:2496；18:474、18:1116-1140；19（无运行面） | 78-§12.3 定义 `TOOL_OUTCOME_UNKNOWN`：崩溃/超时 → 结果标 `unknown` + `REC-EVT-03` + 对账、**不自动重试**；`P-78-12` 未执行。17 §6.6 把 `test/engine/crash-points.ts` 与崩溃注入整体归 16，只登记 U80-19 的四个投影注入点；18 的恢复段只写「重启 → 重取配置 → 重构造工厂 → daemon 重新登录」，§8.4 的 20 个未证项没有一条是崩溃注入/unknown 面；19 无运行面。 | 本层对「boot/装配层是否覆盖 `TOOL_OUTCOME_UNKNOWN`」**没有回答**：既没写承接，也没写 N/A。boot 现状持会话句柄，崩溃后 token/登录态的收口语义空白；交付后没人知道该态归谁，验收也无法判「未覆盖」还是「不该覆盖」。 | 18 在 F-boot-boot 的「状态/恢复」加一行 N/A + 指路（78-§12.3、16 的 crash-points、82 的 P-78-12）；17 在 §6.6 明写「装配层崩溃面 = U80-19 四点；工具副作用未知态归 16/78」；不新增机制。 |
| Q-11 | P2 | D+G | 18:427 + `apps/boot/src/boot.ts:58`、`:240`；17:723；`templates/company-2-level/org-config.yaml:165`；`packages/company/src/init.ts:197-208`；19 §5.4.1 | 18 把 `DEFAULT_PRODUCER_MXID='@opengames:localhost'` 列为「部署缺省，不是授权」，代码以它兜底 `config.matrixProducerMxid`；17 的 `matrixProducerMxid` 缺省却写「无（消费侧推导）」；模板 `yt.project: EXAMPLE`，而 `init` 的七处占位（slug/name/README 标题/template/三个时间戳）不含它。 | 两处公司特定内容：①框架组合根硬编码某公司的制作人 MXID，且与 17 的缺省口径是两个源（谁决定广播目标？）；②`init` 产出的公司保留 `EXAMPLE` 项目短名，与 19 的「init 替换公司身份」不符（当前 `yt` 无消费方，属潜伏，不是立即故障）。 | 去掉 MXID 常量或改为必配（缺省 fail-closed），17/18 统一缺省来源；把 `yt.project` 加入 init 占位替换，或在 19/04 明确列为 init 后必改项并加自检。 |
| Q-12 | P2 | B+E | 17:161-165、17:176-178；`packages/contract/src/ports/kernel.ts:98`；`packages/contract/src/schemas/errors.ts:54`；80:927/936/1008；18:1114；17 §8.1/§8.3/M-a…M-s | 17 的目标错误契约一律用 `ClassifiedError{failure; category; subcause; detail?}`；仓内 `ClassifiedError` 只有 `category`/`subcause`/`detail`（kernel.ts:98），`FailureClass` 全仓不存在，`configInvalid` 只产 `category`+`subcause`（errors.ts:54）。80:927 明说「缺 FailureClass，这是要修的目标」；18 §8.3-18 登记了「两轴构造入口」缺口，17 的 §8.1/§8.3 与迁移步没有这一项。 | 17 的每件错误契约在 contract 加 `failure` 之前**不可落码**；17 的跨卷目标件表与 M-a…M-s 都不含这项，实施者会自己给类型加字段（第二事实源）或阻塞在 typecheck。按 P2 记（上游 80-§5.7 已定目标，17 缺的是登记）；若 01-contract 未排期，则升为 P1 阻塞。 | 17 §〇 跨卷表加 `kernel.ts`（`FailureClass`）与 `schemas/errors.ts`（`configInvalid` 两轴）；§8.1 记一条「上游前提」；M-a 或新增 M-0 写成「contract 两轴先行」；引用 18 §8.3-18。 |
| Q-13 | P2 | B+E | 17:2299-2304；17:1950-1969；`apps/daemon/src/cli/postmortem.ts:72`；`apps/daemon/src/evolve/postmortem.ts:34` | 17 的 postmortem CLI 只列 `[--casebook]`，未写缺省；代码 `casebookRoot: parsed.flags.casebook ?? path.join(process.cwd(), 'docs/casebook')`；evolve 头注称这是「v0 框架级演示 → 仓内 `docs/casebook/` 雏形」；17 的 F 条目未带这个限定，也没有 containment。 | 缺省把公司运营产物写进进程 cwd：在框架仓执行会把案例库写进框架仓，混淆「公司目录/框架仓」两个事实源，与唯一写入者/分离原则冲突；运维在文档里看不到这个缺省。 | 17 写死缺省与写入根（建议要求显式 `--casebook` 指向公司目录的 `docs/casebook`；若保留 cwd 演示，注明仅 demo 并加 containment/告警），usage 旗标表补一行。 |

---

## 三、覆盖核对

### 3.1 本次要求覆盖的对象 / 章节 / ID（已覆盖）

- **17**：§〇（范围/复算/跨卷登记）、§1.1 纵轴与允许边、§1.2 平面/行数预算、§1.3 三域不互引、§1.4 IO/注入、§1.5 错误与观测/退码、§1.6 秘密供给、§1.7 入口与装配点；§二 现有 42 件（行数抽查全中）；§三 处置总表（61/59）；§4.1 根、§4.2 assembly 27 条（含 73 键全表）、§4.3 control 6 条、§4.4 evolve 5 条、§4.5 包清单/tsconfig；§五 CLI 22 条；§6.1–6.7 测试；§7.1–7.3 规模/拆分/M-a…M-s；§8.1 W-1…W-22、§8.2 政策 8 项、§8.3 未证、§8.4 边界；§九 十项自查。
- **18**：§1 范围/证据/标记；§2 现有 5 件与关系图；§3 目标 8 件/58 例/预算；§4.1 层位三边、§4.2 注入面 13 行、§4.3 共享源 9 行、§4.4 矩阵边界与 8 条判负、§4.5.1–4.5.4 秘密/路径/日志/错误、§4.6 启停、§4.7 构建、§4.8 接口对照；§5 F-boot-boot/main/package/tsconfig；§6 F-boot-test 35 例；§7 testkit/guards/assembly/serve；§8.1 G1–G18、§8.2 A1–A12/S1–S7/C1–C3、§8.3 18 项、§8.4 20 项；§9 迁移/回退/完成边界。
- **19**：§0 读法/标记/不做；§1.1–1.4 总量/225 分类/10 套矩阵/核对锚点；§2.1–2.5 计数/新增 3 件/替换 14 件/待分离 6 件/跨卷 6 件；§3.1–3.4 根件 10 件、构建面、门禁分面；§4.1–4.3 guards 3 件 + 目标 3 件 + 阈值/基线/22 条/盲区；§5.1–5.6 模板契约与 11 族逐件；§6 证据矩阵；§7 跨文件/跨卷边界；§8 迁移与回滚；§9 回写 W76/W79/W80/W82/W04/W43/W51；§十 未证；附录 A/B/C。
- **ID 核对**：`F-daemon-*` 63 条（= 61 src 目标件 + 2 包清单/门禁，`grep -c '^F-daemon-'` 复算一致）、`F-boot-*` 8 条、`F-ROOT-*` 10 条、`F-GUARD-*` 6 条、`F-TPL-*` 225 行（聚合核对，见 §3.2）；W-1…W-22 / G1–G18 / A1–A12 / S1–S7 / C1–C3 / U80-* / U-BOOT-01…20 / W76-1…5 / W79-1…5 / W80-1…3 / W82-1…10 / W04、W43、W51。
- **七个重点逐项回答**：
  1. **装配根唯一性**：`buildServeRuntime` 是 `IntentIngress` 的唯一创建点（17:249-255），`assembleApi` 只由 runServe 第 7 步调，boot 只造工厂——形式上唯一；但 Q-02 的 5 件在唯一装配根之外，Q-06 使唯一入口带双读。
  2. **启停序与 80 §3.6**：10 步表与 80 的 10 步逐步对应（1 读配置…10 停机四步），停机四步 relative order 与 80 一致；差异是 80 强制的授权插入缺失（Q-02）与正文两处漂移（Q-07）。
  3. **CLI 只认 `cli/main.ts`**：`bin` 只指 `cli/main.ts`（package.json 实测），18 命令 `switch`（实测 18 个 case + 4 个 help/version 标签），`cli/serve.ts` 是唯一 daemon 启动薄壳；入口层面成立；退码契约有第三处 2（Q-03）。
  4. **control/evolve 越权**：`control/hot-reload` 只读公司目录 + apply 到运行栈，不写框架资产；`evolve/cutover` 写 `assetRoot` 下资产（containment 只挡出根），判负闸的**判据类清单**漏机械规则文件（Q-04）；`asset_kind='criterion'` 的自声明在 core/store（本层外，交 C 组）。
  5. **boot 的崩溃/恢复**：无 `TOOL_OUTCOME_UNKNOWN`、无崩溃注入项、也无 N/A 声明（Q-10）；会话 `close()` 只在 daemon `runtime.stop` 出现，boot 无句柄。
  6. **root-guards 阈值/基线走提案流**：19 §4.3.3/§4.3.6 与 20-§十五 口径一致（上调/新增=提案流+制作人批，降/删随提交），且 19 声明 3 个新增 guard 文件不改基线（`scripts/` 不在 `scopeDirs`，实测一致）；缺口在 Q-04 的机制清单而非治理文字。
  7. **模板公司特定内容**：10 套 level 模板无真实公司身份（`示例公司`/`example-corp` 由 init 的 7 处占位替换，`yt.project: EXAMPLE` 除外，见 Q-11）；行业包（星火/星潮、unity+csharp、游戏/互联网战役）是**有意的行业示例**，走 `company add` 导入而非 `init`（19 §5.1/§5.5.4）；`grep` 模板无 `SEC-`/token/password/本机路径/内网 IP（0 命中），秘密边界成立。公司特定硬编码的真实落点不在模板，在 boot 的 `DEFAULT_PRODUCER_MXID`（Q-11）。

### 3.2 本次机械核对（只读）与结果

- 文件数：`apps/daemon/src/{assembly,cli,control,evolve}`=41 + `index.ts`=42；12/22/2/5；`test/` 6/9/2/6 + 根 2；daemon test 86 `.ts`（85 `.test.ts` + `crash-points.ts`）。
- 17 行号锚点抽查 34 处（`serve.ts` :127/:129/:131/:147/:371/:411/:413/:427/:456/:743/:746/:778/:806/:819/:822/:860/:870/:880/:1040/:1054/:1424/:1431/:1434/:1445/:1470/:1471/:1476/:1495/:1508/:1521/:1553/:1558/:1604/:1608）**全部命中**；`serve.ts` 1627 行；`coerceServeConfig` 73 个 `case`、`ServeConfig` 63 键（=73 含 HR 10 键）；CLI `openLedger` 9 处逐点一致；`configInvalid`：evolve 49（非 45）、assembly 2、control 0、cli 0；CLI `node:fs` 12 件；`node:child_process` 仅 `evolve/sandbox.ts`。
- boot：376/12/635/20/5 行；13 个导出；8 个函数；14 `describe`/35 `it`；`process.env` 直读 5 处（生产 5 行，均现状）；生产 import 只有 `node:fs`/`node:path`/`contract`/`daemon/serve`/`matrix`。
- guards：模块 16 个导出（含 `rules` 汇总对象）、纵边 13、包边 38、`lineBaseline` 22、`packageLayers` 16、`daemonSrcRootDirs` 5、`codeExtensions` 6、`forbiddenImportSpecs` 1、阈值 25/600/10、boot 基线 645、三条 boot 边在 `:104-106`——**全部与 19 §4.1/§4.3 一致**；`node scripts/guards/boundaries.mjs` → 「PASS：扫描 627 文件（范围面代码件 499），0 违例」，exit 0（本机 node v25.6.1，无 bun；与 19 §1.4/§6.4 的声明一致，已复现）。
- 19 基线表抽查 14/22 条（engine 2337、serve 1627、ledger 1683、repo-validate 1021、hot-reload.test 930、scheduler 785、sources 768、dependencies 775、taiga testutil 693、dsh.test 732、validator 612、boot.test 635、records 606、overview/views 629）**全中**；22 条中 17 条余量 0、5 条余量合计 137——与表一致。
- 模板：225 件、部门 config 56、人事档案 91、`org-config` 10、`.gitkeep` 18、jobs 94、旧 schema 8 件（路径逐条命中 19 §5.5.1）、最大单文件 509 行、目录直属最大 6；共享资产 `示例公司` 恰 20 处（10 套 × org name + README 标题）；`SEC-`/token/password/本机路径/内网 IP 0 命中。
- 根件：`package.json` 当前 `engines >=24`、`packageManager bun@1`、`daemon=node apps/daemon/src/index.ts`、`test=bun run guard:boundaries && vitest…`；`.mise.toml` 24.21.0/1.4.3；`.gitignore` 4 行；`bun.lock` 55 `workspace:`/140 `sha512-`/140 镜像 tarball/0 `trustedDependencies`/lock v2；4 个包级 tsconfig 含 `test/**/*.ts`（adapters/core/dsh-bridge/prompt）；17 个 workspace 目录；README 69/AGENTS 89/CHANGELOG 270/LICENSE 21/bun.lock 503。

### 3.3 未覆盖清单（本次没有逐条核的）

- 17 的 22 条 CLI 与 12 条 assembly 逐件行数：抽查约 15 件，未逐件 `wc -l` 全部 63 条；未逐条运行 CLI 行为。
- 17 §6 现有 25 件测试的逐文件行数/用例标题：只核了文件数与部分行数，未跑 vitest。
- 18 的 35 个测试用例：只读不跑；fake/G 项（G7/G14/G15 等）按文档记录接受，未独立复核每条代码路径。
- 19 的 225 个模板表行：全文读过，但**未逐件核字节/行数/字段**；只对 c2/c3/c4/cg/ci 的代表行、总数、jobs/people 合计、8 件旧字面量、`.gitkeep` 尺寸做了文件级核对。
- 19 的 22 条基线：抽查 14 条；未逐条比对全部 22 件当前行数（但 guard PASS 说明无超限）。
- 17 的 W-5/W-7/W-11/W-13/W-14 等回写项、18 的 G1–G18：按文档记录登记，未替代 C 组做跨层裁决。
- 未验证任何「目标态」行为（无实现）；未连接 Matrix/Taiga/DSH；未跑 `bun run typecheck`/`bun run test`（本机无 bun）。

### 3.4 跨层移交（本层只标注，不裁决，交 C 组）

1. **80-§3.6 第 6 步的措辞**：「两者完成后才创建 `IntentIngress` 并 `receipts.rebuild()`」（80 第 389 行附近）与 17 的「rebuild → ingress」顺序不一致；本层按 17 的写法记，80 的句子需 C 组确认主文。
2. **79-§3.5**：CLI 12 件直接 fs、`evolve/sandbox.ts` 是唯一 spawn——17 已登记 W-2/W-3，归属 79/82，不在本层改。
3. **80-§8.2 写命令开库口径**：`jobs catchup`/`cutover`/`gray --check|--close`/`postmortem`/`sandbox`/`company add|create` 七处写面（17 W-11）未定义，属 80/03/82 裁决。
4. **78-§7.4.1**：78:1017 已写 `SEC-MX-BOT-PASSWORD` 恰两项，而 18:316/1102 仍称需对齐/含 matrix-register；「78 已对齐、18 未同步」需 C 组确认后由 18 单方修（Q-01）。
5. **76 的 rule-profile / timezone**：19 W76-4（模板 225 件无 `rule-profile` 承载，`find -iname '*rule*'` 0 命中）与 W76-5（时区）；落点归 76/82，本层只登记（Q-05 是 W76-5 的模板侧后果）。
6. **80-§10.6 的 645/635**：18/19 已一致登记为「实测 635、基线 645」；80 表两列写 645，属 80 的计数，交 C 组。
7. **core 的 `asset_kind='criterion'` 自声明**：判据类升级依赖候选记录自报类型（`packages/core/src/evolution.ts:80`/`:472`），本层只审到 17 的冻结清单；是否设「路径→asset_kind」映射归 core/77。

---

## 四、未证与无法判断

1. **未证（本机限制）**：`bun run typecheck`、`bun run test`、任何包级 `tsc`、vitest 全套均未运行（`bun: not found`）；仅复现了 19 的 guard 实跑（PASS/627/499/0，node v25.6.1，非钉死 24.21.0）。因此本报告不支持任何「类型/测试已过」的结论，也不把 17/18/19 的「已复核」升级为我的证明。
2. **未证（目标态）**：Q-02 的 5 件是否另有未写入文档的调用计划、Q-06 是否计划由 78 部署侧修掉 `main.ts`、Q-04 的清单是否已由「真单刀批示」扩大——三卷均无文字，**无法判断**，只能按「未登记即未定」记。
3. **未证（外部事实）**：Matrix/Taiga/DSH 真实行为、`SEC-*` 真实轮换、homeserver 登录、插件加载——三卷自己声明未证（18 U-BOOT-04…20、17 U80-09…19、19 §十），本报告不补证。
4. **无法判断（分级边界）**：Q-04 若把启动自检升为阻断，是否构成 P0，取决于该自检是否为判据类变更的唯一强制点；本报告按现有代码（观察模式）记 P1，并在条内写明升级条件。Q-12 若 01-contract 未把两轴排期，则升 P1。
5. **未证（数字口径）**：45→49、177→185 的差异是「文档写成时点 vs 本机现点」还是「一直就错」，无法从仓内判断；我只报实测与差值，不推断原因。

---

## 五、给作者的修复顺序（≤7 条）

1. **Q-02**：先把 10 步表 + 停机五步 + §4.2 域前言的序补全（授权 5.5、spec/credentials 6.x、stdio 7.x、migrate 入口、stdio close），再谈实现。这是本层唯一会让「19 件目标件」变成「14 件可执行 + 5 件死代码」的问题。
2. **Q-12**：把 `ClassifiedError.failure`/`FailureClass`/`configInvalid` 两轴作为 17 的 M-0 前置登记（引 18 §8.3-18）。不登记，17 的每一条错误契约都停在 typecheck。
3. **Q-01**：删 18 的两处旧口径，统一为「bot 密码恰两用途、matrix-register 请求即 `rejected_forbidden`」，加 catalog 负向用例。
4. **Q-06**：改 boot 的 `{ configPath }` 分支为「boot 内解析一次 → `runServe({ config }, { deploymentBaseDir })`」，S5 改为断言 boot 不转发 configPath。
5. **Q-04**：把 `scripts/guards/boundary-rules.mjs` 补进冻结清单（一行 + 80/20 回写），并决定自检是否升阻断（升则按 P0 排）。
6. **Q-03 + Q-05**：Q-03 二选一写死退码并加对账断言；Q-05 先把模板注释的宿主时区断言改掉、把 W76-5 标为阻塞，待 76 定字段后重生成。
7. **Q-07/Q-08/Q-09/Q-10/Q-11/Q-13**：一次对齐批次——正文两处顺序改表、serve.ts 导出补 `RunServeOpts`、M4/预算/45/177/19 件复算一处不留、boot 加崩溃 N/A、MXID 与 `yt.project` 去硬编码/补替换、postmortem 写死 casebook 根。

---

## 六、本报告没有做什么（范围限制）

- **只读**：未修改任何设计文档、源码、manifest、lock、guards、模板或测试；未执行 git 写操作；只写了本文件。
- **不是实现单**：本报告不替作者重写 Q-02 的 10 步表、不补 `boundary-rules.mjs` 的清单、不改模板；只给最小修复路径。
- **不是跨层审计**：不裁决 76/77/78/79/80/82 的主文（§3.4 列出移交项）；不重新审计 17/18/19 之外的分卷；不评估 20 的宪法本身，只把它作为判据类资产的对照。
- **不是全量证据**：未跑 typecheck/vitest/真机；未逐件核 225 个模板行；未逐条核 22 条基线的全部文件；未把「文档写得细」当作「实现已验证」。
- **不评价文风**：本报告不把重复、命名、排版问题包装成 P1/P0；P3 级编辑问题未列（例如个别行号 ±1、措辞重复），因为不影响交班与验收。
- **不保证穷尽**：以三卷全文 + 机械核对为限；「未发现」不等于「不存在」，只表示在本次读法与证据下不成立为发现。
