# 81-files/06 · `packages/gateway` 逐文件契约

> 版本：v0.6，2026-10-27（**文件 ID 归位 + 计数回到本包真实 12 件**：daemon 的 `effect-gateway.ts` 由 16 的 `F-DAEMON-ENGINE-TOOLS-EFFECT-GATEWAY` 拥有，本卷只引用行为契约；同时重核 80 锚点为 §5.2 `:716-717` / §6.6 `:1655-1656`、`:1993` / §6.9 `:2259`，proof 字节统一 JCS 五键，对端 uid 只走 `PeerCredentialVerifier`）。v0.4→v0.5：`unknownRef` 必填、回执三情形、关闭两条过期登记。v0.2→v0.3：错误两轴 / `Result` 化 / 定稿签名 / 秘密供给面 / stdio 归 daemon。
> 版本：v0.7，2026-10-27。**现行收口**：目标 `gateWrite` 第四参 `options?: {effectAction?: EffectAction}` 与 `VerifiedWkey.author` 对齐 80；动作编解码只在现有 `packages/gateway/src/actions.ts`，不新增文件。`EffectGateway` 仅处理九个平台控制写；补内部 `EffectWriter`、`REC-EVT-01` 效果尝试先行、同键并发与崩溃恢复、不可核回执只能 unknown；不再把回执唯一写成外部恰好一次，也不再用 `mintControlKey` 叠双闸。G-3～G-6 仅设计面关闭，全部实现未做。
> 性质：**自然语言级文件与实现设计呈审稿**，不是现行文件树、实现单或完成证明。
> 上位：75-§五 文件契约模板与 §三 D75-03/07/13/15；76-§1.5/§1.5.2（签名结构 ≠ 展示落款）、§1.7、§3.12 `DEF-AUTH-01/02`；77-§1.3/§1.4（幂等键）、§2.4 `REC-RCP-01`、§2.6 `REC-EVT-01`、§2.7/§2.8 `REC-EVT-02/03`、§3.4 `REC-AUTH-04`、§11.1（14 类失败）、§11.2（幂等/重试/部分成功）；78-§五 `BIND-EFF-01`、§7.4.1（`SEC-*` 清单与 `SEC-WKEY-<ticketId>`）、§9.6（未知回执接缝）；79-§4.4/§5.2/§5.5/§6.5；80-§2.1/§2.3、**§5.7（错误两轴、`Result`、拒绝通道五条）**、§5.8（秘密安全的错误）、§6.2（`TS-PORT-AUTH-04/05/06`）、§6.3（`TS-PORT-REC-01/02/06`）、§6.6 `TS-PORT-EFF-01`、§8.4（重试先查回执）、§8.5（跨进程围栏）、§8.6（时钟/随机注入）、§9.4（`assembleApi`，仅作风控对照）、§11.1（凭据 ≠ 授权六条）、§11.2（脱敏迁 `contract`）、§11.2.1（`SecretCatalogEntry`/`SecretProvider`/`KnownSecretSet`）、§11.4.1（stdio 只作传输、验签在 daemon）、§12.2（dist 闭包）、§6.9（端口实现落点；EFF-01 的“类型 `contract/src/ports/effects.ts` + 编排 `engine/tools/effect-gateway.ts`”在此表）、§12.3（81 的输入）、§12.5（U80-02/04/05/15/17/18）；81-§四（标签与 R/E/W/V）。
> 边界：本附录只把 80 的组件与接口落到文件；**不新增公共概念、端口、状态、允许边或依赖版本**。发现 80/76/77 缺口只列回写对象，不在此私设一套。
> 门禁：本文所有「目标/新增/拆分/替换/退役」均为设计处置，**尚未执行**；不得据此直接改源码、manifest、lock 或 guards。
> 标签：`现有` / `库级·未接` / `目标-保留` / `目标-拆分` / `目标-新增` / `目标-替换` / `目标-退役` / `仅测试` / `未证`（81-§四）。
>
> **v0.3 相对 v0.2 的九处口径修正**（不改任何计数结论：现有 11 件、目标 14 件——**“目标 14 件”自 v0.6 起作废**，见下行 v0.6 ②）：① 运行期拒绝由 `{allowed:false, reason}` 改为 `Result<GateDecision, ClassifiedError>`——80-§5.7 拒绝通道第 3 条点名“不得把拒绝塞进成功返回值”，且同节把 `GateWriteResult` 直接列为 `Result` 形态的例子；② `ClassifiedError` 补 `failure` 处置轴、`category` 降为观测轴，网关 14 个 `gw-*` 码全部降格为 `subcause`（名称保留，见 §4.0 映射表与 §七 G-1）；③ `EffectGateway` 按 80-§6.6 定稿签名重写（`apply(effect): Promise<Result<EffectOutcome, ClassifiedError>>`），类型家交叉引用 01-contract v0.2 的 `contract/src/ports/effects.ts`（本附录不写第二份契约）；④ 秘密来源改 `SEC-GW-SIGNING` 与 `SEC-WKEY-<ticketId>`（80-§11.2.1/§11.4.1），worker 永不持 `gatewaySecret`；⑤ 脱敏只从 `contract` 取（80-§11.2 第 3 条 + D16），不得新增 `gateway→core`；⑥ stdio 只作传输层、验签/nonce/吊销/审计/平台写全在 daemon（U80-17）；⑦ 消费点复算为 **12 文件 / 18 条 import**（v0.2 写 8 处，漏 `studio-tools` 两件与三个 daemon 测试）；⑧ §三 补 §3.3 上游落点交叉引用表，避免与 01/02/03/17 各自写第二份文件契约；⑨ §七 由 8 条重排为 **G-1…G-14**，补 80-§11.1 三处字段漂移、80 卷内 §5.2 与 §6.6 的 `EffectOutcome` 漂移、以及 `openLedgerReadonly` 拼写跨卷漂移的登记（该拼写项已于 v0.4 关闭，见 G-14 末注）。
>
> **v0.4 相对 v0.3 的四处补正**（不改计数结论：现有 11 件、目标 14 件——**同 v0.3，自 v0.6 作废**；G 编号仍为 G-1…G-14，不新增编号）：① `EffectOutcome` 补 `unknownRef?: Qid`，**`status:'unknown'` 时必填**（对齐 80 的 `IntentReceipt.unknownRef` 先例），且 `registerUnknown` 失败即不得返回 `Ok(unknown)`——回写 80-§6.6（并入 G-3；**v0.5 已升级为两分支强制引用，以 v0.5 ① 为准**）；② 新增 **§8.7 回执三情形**（缺失/迟到/冲突），各给证据与对账路径，`unknown` 既不等于拒绝也不等于成功；③ G-14 关闭 `openLedgerReadonly` 拼写登记（03-store 已统一为小写 d + 对象入参，现存同名写法全是过期指控或整改指令，归 04/13 owner）；④ G-7 关闭 `KnownSecretSet` 增量面疑问（80-§11.2.1 已定：装配期生成、运行期只读、变更整体重建，归 daemon；gateway 不持集合、不自建第二秘密集）。
>
> **v0.5 相对 v0.4 的七处对齐**（件数结论改为“目标 14 = 本包 13 + 跨包 1”——**该件数自 v0.6 作废，见下行 v0.6 ②**；G 编号仍 G-1…G-14）：① `EffectOutcome` 改为 80-§5.2 `:699-704` 的判别联合 `applied{receiptRef:Qid} | unknown{unknownRef:Qid; reason?}`，**两分支都必填**；先落记录再 `Ok`，登记失败即 `Err(unavailable, STALL, unknown-record-unwritten)`；② 意图域写未知**缺 `intentRef` 即拒**（`Err(rejected_precondition, CONFIG_INVALID, unknown-scope-intent-missing)`），非意图域不强制（80-§6.6 `:1948`）；③ 目标共享**一个** `WkeyAuthority`：`createGateway` 接受注入的 authority，不因每 ticket 各起一套 nonce/吊销集（80-§11.4.1 第 6 条；进程内共享为目标，跨进程 store 未证）；④ 新增 `verifySealed`（或 `consumeNonce:false`）：完整检查但**不写 `seenNonces`**，注册不烧原 nonce，`(ticket,nonce)` 只允许一个活跃会话；⑤ `encodeAction` 与既有 `parseAction` 都收在本包，stdio **不复写** `@action` 解析；daemon 每次实际写现签 `scope[action]` 的一次性 key，不回传 worker；⑥ 现状事实与目标分开写：**现在** `verify` 一次成功即烧 nonce（MCP 复用会撞 `replay`），**目标**注册走 challenge-proof、不消费原 nonce；与 15 的四类帧一致但**不复制协议**；⑦ 关闭 G-2（`effects.ts` 与 daemon `engine/tools/effect-gateway.ts` 均由 80-§6.9 `:2259` 点名）、收窄 G-3（只剩字段表）、更新 G-8（进程内共享已定）。
>
> **v0.6 相对 v0.5 的七处修正**（**v0.3/v0.4/v0.5 版本注记里的“目标 14 件”“本包 13 + 跨包 1”一律作废**，以本行 ② 为准；G 编号仍 G-1…G-14）：① **文件 ID 归位**——`apps/daemon/src/engine/tools/effect-gateway.ts` 的唯一 ID 是 **`F-DAEMON-ENGINE-TOOLS-EFFECT-GATEWAY`**（16-§4.12 已有完整条目；测试件 `F-DAEMON-ENGINE-TEST-TOOLS-EFFECT-GATEWAY`）。本卷**不再**用 `F-gateway-effect`/`F-gateway-test-effect` 指该路径，不把它列进 §三 目标件表、不分配 ID、不计件；§四 只保留**行为契约**（流水线/错误/证据/测试面）。`packages/gateway` **不另造 `EffectGateway` 第二实现**，只保留 `wkey`/`actions`/`signature`/`gateWrite` 内核。② **计数回到本包真实**：目标 **12 件** = 生产 5 + 测试 4 + 配置 3（含 1 条件件 `tsconfig.build.json`）；跨包引用不计文件数。③ **80 锚点重核**：`EffectOutcome` §5.2 `:716-717`；`EffectRequest` 与“先落记录再 `Ok`” §6.6 `:1655-1656`；意图域 `intentRef` §6.6 `:1993`；EFF-01 落点 §6.9 `:2259`（v0.5 的 `:699-704`/`:1609-1611`/`:1948`/`:2214` 作废）。④ **proof 字节统一 JCS 五键**：`registerProof` 的 HMAC 输入是 `studio-next/jcs@1` 序列化的**恰五键** `{protocol:'studio-next/stdio-register@1', challenge, helperId, pid, wkeyRef}` 的 UTF-8 字节，`alg='hmac-sha256-v1'` 绑死“规范化 + 域串 + SHA-256”；**不得**写“版本化上下文‖challenge‖…”拼接。⑤ **对端 uid 只走 `PeerCredentialVerifier`**：Node 24 无内建 `getpeereid`/`SO_PEERCRED`，不得写成直接调用；无已验证适配即 `unverified`。⑥ **秘密用途不混**：本卷与 helper 注册（`matrix-register` 建号）都不涉及 `SEC-MX-BOT-PASSWORD`；建号只用 HR 面秘密（`SEC-MX-HR-SHARED`），bot 口令只作登录，两值不得互换，本包不持任何 `SEC-*` 原值。⑦ **已关闭的设计缺口与真实未证分开**：`EffectDescriptor`/`EffectTarget` 字段表、`EffectRequest` 的凭据载体、`partial` 逐项清单、`RecordQuery.idempotencyKey` 均已由 80 定稿（G-3～G-6 设计面关闭），代码仍未实现；跨进程 nonce/吊销共享 store 仍未定义（G-8 后半）。现行文件计数、路径与行为契约以本版及后续 v0.7 为准。
>
> **本版性质不变**：目标项一律未执行；无运行证据；§十 不写 PASS。

---

## 〇、范围、复算口径与核查方式

### 0.1 覆盖

| 类别 | 件数 | 复算方式 |
|---|---|---|
| 生产源码 `src/*.ts`（排除 `*.test.ts`） | 5 | `ls packages/gateway/src/*.ts` 去掉 4 个 `*.test.ts` |
| 源码同目录测试 `src/*.test.ts` | 4 | `ls packages/gateway/src/*.test.ts` |
| 独立测试目录 `test/**` | 0 | `ls packages/gateway/test` → 不存在 |
| 测试夹具 / fake 模块 | 0 | `find packages/gateway -path '*fixture*' -o -path '*fake*'` → 空 |
| 包配置件 | 2 | `package.json`、`tsconfig.json` |
| 文档性配置（README / vitest.config / .env 示例等） | 0 | 目录内无此类文件 |

合计 **11 件**（由 `find packages/gateway -type f -not -path '*/node_modules/*' | wc -l` 复算，排除 `node_modules` 软链）。

排除：`node_modules/**`（`zod` 与 `@studio-next/contract` 的 workspace 软链，仅作依赖证据，不展开其源码）、`dist`（不存在）、`.git`、根 `package.json`/`tsconfig.json`/`bun.lock`/guards（归 `81-files/19`）、`apps/daemon` 与 `packages/studio-tools` 的消费面（归 `81-files/15/17`，本附录只登记调用契约）。

### 0.2 行数（2026-10-27 `wc -l`，仅作规模核对，不作能力证据）

`wkey.ts` 198｜`gateway.ts` 94｜`actions.ts` 67｜`signature.ts` 41｜`index.ts` 23｜`wkey.test.ts` 249｜`gateway.test.ts` 174｜`actions.test.ts` 103｜`signature.test.ts` 45｜`package.json` 19｜`tsconfig.json` 5。其中 `src` 九个 `.ts` 合计 **994 行**，含两个配置件共 1018 行；无一件进入 `lineBaseline`，无一件逼近 `maxLinesPerFile=600`。

### 0.3 本次核查做到与未做

做到：逐行读完 5 个生产文件与 4 个测试文件；读完 `package.json`/`tsconfig.json`；核对 `@studio-next/contract` 的 `ports/gateway.ts`、`ports/platform.ts`、`ports/kernel.ts`、`schemas/errors.ts`（并确认 `src` 内无 `Result` 定义、`ClassifiedError` 无 `failure` 字段）；核对全部 **12 个消费文件 / 18 条 import**（8 个生产文件 + 4 个测试文件，见 §二.3）；核对 `scripts/guards/boundary-rules.mjs` 的层位、允许边、阈值与基线；核对 79 的构建闭包与 80 的 `TS-PORT-EFF-01` 原文；核对 80-§5.7（错误两轴、`Result`、拒绝通道五条、`Err` 可达 6 个 category）、§5.8、§6.2/§6.3（`AUTH-04/05/06`、`REC-01/02/06` 签名与错误行）、§6.6、§8.4/§8.5/§8.6、§11.1（六条）、§11.2（D16）、§11.2.1、§11.4.1、§12.2/§12.3/§12.5 原文；核对 77-§2.4/§2.6/§2.7/§2.8/§3.4/§11.1/§11.2、78-§7.4.1/§9.6、76-§1.5.2，以及 `redactOutbound`/`KnownSecretSet`/`SEC-WKEY-<ticketId>` 的实际落位（前者在 `packages/core/src/secrets.ts`，后两者代码无落位）；核对 01-contract v0.2 的 `F-contract-port-effects`（`contract/src/ports/effects.ts`）与 17 v0.2 的 `assembleApi` 新签名，用作跨卷一致性对照。

**未做**：未运行 `bun run typecheck`、未运行 `vitest`、未启动 daemon/MCP/任何服务、未做跨进程或真机探针。因此本文不提供“当前测试为绿”“类型通过”一类运行证据；测试覆盖只描述**测试代码断言了什么**，不描述其执行结果。

---

## 一、包身份、层位与当前事实边界

### 1.1 身份

| 项 | 值 | 依据 |
|---|---|---|
| 包名 / 版本 | `@studio-next/gateway` / `0.1.0`，`private: true` | `packages/gateway/package.json:2-4` |
| 描述 | “写路径收口闸——wkey 签发/校验/吊销 + 动作词结构化校验 + 署名注入（纯逻辑零 IO）” | 同上 `:6` |
| 层位 | **1**（与 `core`/`adapters`/`localplatform`/`yt`/`taiga` 同层，仅高于 `contract`=0） | `scripts/guards/boundary-rules.mjs:89` |
| 允许入边 | `daemon → gateway`（`:115`）、`studio-tools → gateway`（`:128`） | 同上 |
| 允许出边 | **仅** `gateway → contract`（`:137`） | 同上 |
| 模块形态 | `type: "module"`，ESM，Node 24 原生 type-stripping 直跑 `.ts` | 79-§4 |
| 入口 | `main: "src/index.ts"`，`exports["."]: "./src/index.ts"` | 79-§4.4 之「源码态」 |
| 分发 | 目标进入 dist 闭包（条件：`studio-tools` 走分发时），见 §六 `F-gateway-manifest` | 79-§6.5 |
| 包级门禁 | `typecheck: tsc --noEmit -p tsconfig.json`；`test: vitest run` | `package.json:11-14` |

〔事实〕网关是**纯面**：`src` 的全部 import 为 `node:crypto`（`wkey.ts:21`）、`zod`（`wkey.ts:22`、`actions.ts:15`）、`@studio-next/contract`（四个文件），加内部相对 import；无 `fs`/`net`/`child_process`/`process.env`/`Date.now()`。与 79-§3.6 的纯面清单一致。

〔结论〕这条“只依赖 contract”的边是**硬约束**，不是当前习惯：网关一旦要持久化 nonce/吊销、要写回执、要做脱敏，都必须以 **contract 中的端口 + 构造方注入** 取得能力；不得改为 `gateway → store`、`gateway → core`、`gateway → company`（新边=提案流，75-D75-03）。当前这些端口**尚不存在**（见 §七）。

### 1.2 当前能力边界（防止把设计读成已实现）

| 断言 | 现状 | 证据 |
|---|---|---|
| 平台写“全收口” | **部分成立**：daemon 侧 `FlowPlatform` 九写面已包 `gateWrite`；`panel/external` 仍有直写平台与直写台账的待迁移违例 | `gated-platform.ts:119-141`；80-§11.2 末段 |
| worker 侧经 MCP 调闸 | **库级·未接**：`studio-tools` 有 `createStudioToolsServer`，但 daemon 无 stdio 入口装配；`worker-key.ts` 只负责签发/注入/吊销 | `studio-tools/src/server.ts:227`；`serve.ts:43` 自述“仍欠 studio-tools stdio 入口”；全仓 `grep createStudioToolsServer apps/` 为空 |
| 关单吊销对所有写者生效 | **仅同进程同实例**：吊销集在 authority 闭包内；跨进程/跨实例不可见 | `wkey.ts:118-119`；`worker-key.ts:42-46` 自述 |
| 重启后吊销仍生效 | **否**：进程重启即丢失 `revokedTickets` 与 `seenNonces` | `wkey.ts:19` 自述“均在内存（拟稿：生产换 store）” |
| 凭据 = 授权 | **不成立且不得如此表述**：wkey 只是技术边界证明 | 80-§11.1；77-§3.4 `REC-AUTH-04` |
| 署名 = 数字签名 | **不成立**：`[公司·部门·岗位·级别]` 是展示落款，不是 76-§1.5.2 的密码学签名结构，不证明真实性或授权 | `signature.ts:5`；76-§1.5.2 |
| 未知回执 / 幂等键 / 预期版本 | **网关层完全没有**：`gateWrite` 只返回同步布尔+码，无回执、无幂等键、无 version 前置 | `gateway.ts:31-35` |
| 效果分级 E0–E6 | 网关只承担 **E2 的一部分**（wkey + 动作白名单），E3–E6 无实现 | 78-§5.4；`BIND-EFF-01` |

---

## 二、现有件全集

### 2.1 生产源码（5 件）

| 文件 | 行数 | 一句话职责 | 直接依赖 |
|---|---|---|---|
| `src/wkey.ts` | 198 | 按单凭据：HMAC token 的签发/校验/吊销 + 控制面全开 key | `node:crypto`、`zod`、contract |
| `src/actions.ts` | 67 | 首行 `@action <verb> <json>` 的结构化解析 + 中文自由批示判定 | `zod`、contract |
| `src/signature.ts` | 41 | `[公司·部门·岗位·级别]` 落款与 `SignedBody` 组装 | contract |
| `src/gateway.ts` | 94 | 门面：`gateWrite = 中文短路 → verify → parseAction → 签名` | 上述三件 + contract |
| `src/index.ts` | 23 | 包根：四模块星号再导出 + 待批事项清单 | 上述四件 |

### 2.2 测试（4 件，全部与源码同目录）

| 测试文件 | 行数 | `test` 数 | `describe` 数 | 覆盖对象 |
|---|---|---|---|---|
| `src/wkey.test.ts` | 249 | 20 | 5 | `createWkeyAuthority`、`issueControlKey`、七个拒绝码、构造期错、secret 卫生 |
| `src/gateway.test.ts` | 174 | 13 | 3 | `createGateway` 全链、控制面通道互斥、构造期分类 |
| `src/actions.test.ts` | 103 | 13 | 2 | `parseAction`、`isFreeformChinese` |
| `src/signature.test.ts` | 45 | 6 | 2 | `composeSignature`、`signedBody` |

合计 52 个 `test()`（由 `grep -c '^  test(' src/*.test.ts` 复算）。测试内假物只有：可拨假钟（`fakeClock`，`wkey.test.ts:15`、`gateway.test.ts:16`）、固定 ASCII 32 字节 secret、固定 nonce 字符串、伪造 token（直接重算 HMAC）。**无 fake 网关、无内存 store、无进程隔离件**。

### 2.3 消费点（**12 个文件 / 18 条 import**：生产 8 文件 / 测试 4 文件；用于判定“导出面不得随意收窄”）

复算命令：`grep -rn "@studio-next/gateway" --include=*.ts apps packages`（排除 `node_modules`）→ 18 行，落在 12 个文件。

| # | 消费文件（import 行） | 用到的导出 | 用途 | 类 |
|---|---|---|---|---|
| 1 | `apps/daemon/src/assembly/platform/wire.ts:14` | `createGateway`、`CONTROL_TICKET`、`type SignatureContext` | 控制面实例 + `createGatedPlatform` | 生产 |
| 2 | `apps/daemon/src/assembly/serve.ts:74-75` | `createGateway`、`CONTROL_TICKET`、`type SignatureContext` | worker key 签发/吊销实例（只用 `issue`/`revoke` 面） | 生产 |
| 3 | `apps/daemon/src/cli/external.ts:7-8` | `CONTROL_TICKET`、`createGateway`、`type SignatureContext` | 外部 CLI 装配（固定使用 `DEV_GATEWAY_SECRET`） | 生产 |
| 4 | `apps/daemon/src/engine/worker-key.ts:54` | `type Gateway` | 按单签发、credentials 包装、终局吊销 | 生产 |
| 5 | `apps/daemon/src/engine/tools/gated-platform.ts:43-44` | `composeSignature`、`signedBody`、`type Gateway`/`GateRejectReason`/`SignatureContext` | 九写面过闸 + daemon 侧身份署名 + 拒绝码转 `EXTERNAL_REJECT` 上抛 | 生产 |
| 6 | `apps/daemon/src/engine/split/materialize.ts:35` | `signedBody` | 拆分交付的评论署名 | 生产 |
| 7 | `packages/studio-tools/src/tools.ts:20` | `type Gateway` | 工具后端类型（**v0.2 漏登**） | 生产 |
| 8 | `packages/studio-tools/src/server.ts:37` | `type Gateway`、`GateRejectReason` | 六工具 `gateWrite` + 拒绝码→人读提示表 `GATE_DENY_HINTS` | 生产 |
| 9 | `apps/daemon/test/engine/worker-key.test.ts:19` | `CONTROL_TICKET`、`createGateway` | 按单签发/吊销的生命周期断言 | 测试 |
| 10 | `apps/daemon/test/engine/gated-platform.test.ts:21-22` | `CONTROL_TICKET`、`createGateway`、`type Gateway` | 九写面过闸的假实现注入 | 测试 |
| 11 | `apps/daemon/test/engine/worker-key-lifecycle.test.ts:28-29` | `CONTROL_TICKET`、`createGateway`、`type Gateway` | 终局吊销与 credentials 回收 | 测试 |
| 12 | `packages/studio-tools/src/server.test.ts:17-18` | `createGateway`、`type Gateway` | MCP 工具面测试（属 15 附录） | 测试 |

〔结论〕导出面中 `createGateway`/`CONTROL_TICKET`/`composeSignature`/`signedBody` 及类型 `Gateway`/`GateRejectReason`/`SignatureContext` 已被跨包消费，**不得在无替代时删除或改名**。`createWkeyAuthority`/`WkeyAuthority` 目前仅包内与包内测试消费（全仓 `grep` 无外部 import）；`issueControlKey` 另经 `Gateway.issueControlKey` 被 daemon 测试使用（`daemon/test/engine/gated-platform.test.ts:254,383`）——它们属“可收窄的底层面”，但 `issueControlKey` 收窄前须先改该测试。

〔结论〕**`Result` 化的连带迁移面**（v0.3 新增，供 15/17 排期）：`gateWrite` 从 `{allowed:boolean}` 改为 `Result<GateDecision, ClassifiedError>` 会同时打破 4 处消费面——① 第 5 行的 `gate()`（读 `verdict.allowed` / `verdict.reason`，并把码转 `EXTERNAL_REJECT`）；② 第 8 行的 `GATE_DENY_HINTS`（键仍可保留，值不变；读取路径从 `verdict.reason` 改为 `err.subcause`）；③ `gateway.test.ts` 的 13 条判定断言；④ `gated-platform.test.ts` / `server.test.ts` 的既有正负例。故该改动**必须与 15/17 同批**，不得只在 gateway 包内改完就合入。**`GateRejectReason` 这个名字必须保留**（两个生产文件按名 import）：其语义由“拒绝原因”降格为“`subcause` 取值集”，不新增第二个公开名。

### 2.4 配置件（2 件）

`package.json`（19 行）、`tsconfig.json`（5 行）。无 README、无 vitest 配置、无 `.env.example`、无构建配置。

---

## 三、目标件全集与处置总表

| 稳定 ID | 目标路径 | 处置 | 上位锚 | 依据 |
|---|---|---|---|---|
| `F-gateway-wkey` | `src/wkey.ts` | 目标-保留（内核不动，补边界） | 77 `REC-AUTH-04`；80-§6.6 内核；`BIND-EFF-01` E2 | 80-§2.1“不变” |
| `F-gateway-actions` | `src/actions.ts` | 目标-保留 | 24-§二；`GATEWAY_ACTIONS` | — |
| `F-gateway-signature` | `src/signature.ts` | 目标-保留（补字段约束） | contract `SignedBody`；80-§6.6 | — |
| `F-gateway-facade` | `src/gateway.ts` | 目标-保留（构造期校验前移 + 拒绝通道 `Result` 化） | 80-§5.7（拒绝通道）、§6.6（内核）、§11.1 六条；78 `BIND-EFF-01`；77 `REC-AUTH-04` | — |
| `F-gateway-index` | `src/index.ts` | 目标-保留（导出面分级） | 80-§2.1 | — |
| `F-gateway-test-wkey` | `src/wkey.test.ts` | 仅测试（保留） | — | — |
| `F-gateway-test-actions` | `src/actions.test.ts` | 仅测试（保留） | — | — |
| `F-gateway-test-signature` | `src/signature.test.ts` | 仅测试（保留） | — | — |
| `F-gateway-test-facade` | `src/gateway.test.ts` | 仅测试（保留，修一处卫生） | — | — |
| `F-gateway-manifest` | `package.json` | 目标-保留（分发面条件替换） | 79-§4.4/§6.5 | — |
| `F-gateway-tsconfig` | `tsconfig.json` | 目标-保留 | 79-§4.4 | — |
| `F-gateway-tsconfig-build` | `tsconfig.build.json` | **目标-新增（条件件）** | 79-§5.2 | 仅当 gateway 纳入 dist 闭包 |

〔注〕`apps/daemon/src/engine/tools/effect-gateway.ts` 与其测试件**不在本表**：它们由 16 拥有（`F-DAEMON-ENGINE-TOOLS-EFFECT-GATEWAY` / `F-DAEMON-ENGINE-TEST-TOOLS-EFFECT-GATEWAY`，16-§4.12 已有完整条目）。本附录 §四 只引用其**行为契约**（流水线/错误/证据/测试面），不分配 ID、不计件、不写第二份文件契约；`packages/gateway` 也**不另造** `EffectGateway` 第二实现，只保留 `wkey`/`actions`/`signature`/`gateWrite` 内核。

〔结论〕计数：现有 11 = src 生产 5 + src 测试 4 + `test/` 0 + 配置 2。目标 **12** = src 生产 5 + src 测试 4 + `test/` 0 + 配置 3（+1 条件件 `tsconfig.build.json`）。**跨包引用不计文件数**（daemon 的 `effect-gateway.ts` 与其测试件归 16，见 §3.3）。

〔结论〕处置计数（本包 12 件）：保留 11、本包新增 1（`tsconfig.build.json`，条件件）、拆分 0、退役 0、替换 0（`package.json` 内部字段的条件性替换单列为“替换面 1”，文件身份不变）。跨包引用 2 件**不计处置、不计件数**。

〔结论〕**不拆分**的理由是实测而非偏好：最大件 249 行（测试）/198 行（生产），目录 9 件，既无 `lineBaseline` 条目也无逼近阈值的件；按 81-§3.1 不追齐文件名，不做无收益的目录手术。目标 12 件仍远低于 `maxFilesPerDirectory=25`（`boundary-rules.mjs:149`）与 `maxLinesPerFile=600`（`:152`），且不新增子目录（gateway 无域平面基线，`domainPlaneBaselines` 仅覆盖 daemon 四域）。

### 3.3 上游落点交叉引用（**不重复写条目**）

本附录的目标件只覆盖 `packages/gateway/**`。以下目标文件由别的附录拥有，本附录只登记**接缝**，不写第二份文件契约（80-§12.3「81 不得自己设计接口」）：

| 目标文件 | 拥有者 | 与本包的关系 | 本附录只写什么 |
|---|---|---|---|
| `contract/src/ports/effects.ts` | 01-contract v0.2（`F-contract-port-effects`） | `EffectGateway`/`EffectRequest`/`EffectOutcome`/`EffectDescriptor`/`EffectTarget` 的类型家 | §四 **行为契约**的用法与流水线；不定义字段。80-§6.9 `:2259` 已点名该文件（G-2 关闭） |
| `apps/daemon/src/engine/tools/effect-gateway.ts` | 16-daemon-engine（**ID `F-DAEMON-ENGINE-TOOLS-EFFECT-GATEWAY`**，16-§4.12 已有完整条目；80-§6.9 `:2259` 指定实现落点） | `EffectGateway` 的**外层四层编排**（权源解析 / effect 分类 / fence 注入 / 未知对账）；本包只提供内核三段，**不另造第二实现** | §四 作为**行为契约**（流水线、错误、证据、测试面）；**不写**该文件的函数表、装配与 ID，文件级归属与装配顺序归 16/17。测试件 `F-DAEMON-ENGINE-TEST-TOOLS-EFFECT-GATEWAY` 同归 16 |
| `contract/src/ports/intent.ts` | 01-contract（80-§12.3 指定） | 无直接依赖；`:8788` 的 `emitIntent`/`getIntentReceipt` 归 daemon 装配 | 仅在 §八 说明“网关不承担外部意图通道” |
| `contract/src/ports/secret.ts` | 01-contract（80-§12.3 指定） | `SEC-GW-SIGNING` 的 `SecretCatalogEntry`/`SecretProvider`/`KnownSecretSet` | §八.1/§八.3 的**取值要求**（`allowedUses` 必含 `gateway-sign`；`SEC-WKEY-<ticketId>` 只作脱敏登记），不定义类型 |
| `contract/src/ports/kernel.ts` 的 `Result`/`FailureClass` 增补 | 01-contract（G-16 已关闭：14 值 `FailureClass` 的形状由 80-§4.1/§5.7 定稿） | 本包全部 `Result` 化的前置；**仍缺** `ClassifiedError.failure` 字段 | §4.0 的映射表；不定义 `Result` 形状 |
| `contract/src/secrets.ts`（`redactOutbound` 等三函数迁入） | 01-contract（80-§11.2-3 + D16） | 出站脱敏唯一来源 | §八.3 的调用点；**不得**新增 `gateway→core` |
| `apps/daemon/src/assembly/api/assemble.ts` + `IntentIngress` | 17-daemon v0.2 | 与本包无 import 关系 | 只在 §八 说明“`:8788` 的平台写最终仍回 daemon 侧过网关”，不写其契约 |
| `core/src/secrets.ts`（迁移后只剩具名 re-export） | 02-core | 无（禁止新增边） | 只登记“迁移后不得再由 gateway import `core`” |

〔结论〕**本节的意义**：“类型家未定”在 v0.2 里是阻塞项；v0.3 降为“须 80 补一行确认”；**v0.6 起重核锚点**——类型在 `contract/src/ports/effects.ts`（80-§6.9 `:2259`），外层四层编排在 daemon `engine/tools/effect-gateway.ts`（同表），本包只保留内核三段。该文件的**唯一 ID 归 16**（`F-DAEMON-ENGINE-TOOLS-EFFECT-GATEWAY`，测试件 `F-DAEMON-ENGINE-TEST-TOOLS-EFFECT-GATEWAY`），本卷不复用 `F-gateway-*` 编号、不列件、不计数。与 16/17 的交界是：16 负责文件、函数表与装配顺序，本卷负责流水线、错误与测试面的**行为契约**。

---

## 四、逐文件契约：生产源码（末段为**跨包行为契约引用**，不是本卷文件）

### 4.0 四个非包根件的共同不变量（先定，再逐件；`index.ts` 只是再导出，不承担以下行为）

1. **零 IO**：不读盘、不连网、不起子进程、不读 `process.env`；唯一系统能力是 `node:crypto` 与注入的时钟。
2. **两级错误 = 两个通道 + 两个轴**（80-§5.7；`gateway.ts:7-9` 的旧措辞只覆盖了“通道”，没有第二轴）：
   - **构造期非法**（坏 secret / 坏 `ctx` / 坏 `author` / 空 `ticket`）→ `throw configInvalid(...)`；`configInvalid` 固定 `failure:'rejected_precondition'` + `category:'CONFIG_INVALID'`（80-§5.7 末段）。`throw` 只用于“这次调用没有返回值、不能继续”的场合。
   - **运行期预期拒绝** → **必须经 `Result<…, ClassifiedError>` 的 `Err` 返回**，不得抛，也不得返回 `{ok:false}` / `{allowed:false}` 这种“把拒绝塞进成功返回值”的形状（80-§5.7 拒绝通道第 3 条；该条同时把 `GateWriteResult` 列为 `Result` 形态的示例）。
   - **`failure` 是处置轴、`category` 是观测轴**：重试/断路/对账/升级一律读 `failure`；`category` 只喂事件 note 与告警分桶。`Err` 可达 `category` **只有 6 个**（`CONFIG_INVALID`/`EVOLVE_REJECT`/`EXTERNAL_REJECT`/`STALL`/`MERGE_CONFLICT`/`NO_LANE`），其余 5 个是内部熔断域，构造器拒收。
   - **`subcause` 保持现码原样**：14 个 `gw-*` 一字不改（声明式证据是 `studio-tools/server.ts:71-86` 的 `GATE_DENY_HINTS` 逐项覆盖）；人读文案归调用方。
   - **唯一不走 `Err` 的“拒绝”**：自由中文回退是**路由信号**不是失败类，留 `Ok`（映射表末行）——符合 80-§5.7 第 3 条“结论/信号不是失败类”。
   - **包内谓词不算拒绝通道**：`WkeyVerifyResult`/`ActionParseResult` 的 `{ok:false, reason}` 保留原形——它们是**包内判定函数**（不跨包）、`reason` 就是 `subcause` 的来源，且返回值不是一个“看起来成功的结果对象”；门面（`gateWrite`）负责把它们翻成 `Err`。这是 80-§5.7 的边界，不是例外。
   - **现状缺口**：`contract` 的 `ClassifiedError` 只有 `category/subcause/detail`（`ports/kernel.ts:98-102`），全仓无 `Result` 定义（`grep "type Result<" packages/contract/src` 空）。`FailureClass` 的 14 值形状已由 80-§4.1/§5.7 定稿（01-contract G-16 关闭），**剩的只是把 `failure` 字段加到 `ClassifiedError`**。因此本件的目标形态**不能先于 `contract` 落地**；过渡期先做 §九 第 1 步（纯实现内、不改签名）。

   **`gw-* → FailureClass` 建议映射**（**建议值，待 80-§5.7 回写**；本附录不造第三个轴）：

   | `subcause`（现码，不改） | `failure`（77 原值） | 缺省 `category` | 处置（77-§11.1/§11.2） |
   |---|---|---|---|
   | `gw-verify-malformed` | `rejected_authority` | `EXTERNAL_REJECT` | 不重试；先取有效凭据 |
   | `gw-verify-bad-signature` | `rejected_authority` | `EXTERNAL_REJECT` | 不重试；按事故面排查 |
   | `gw-verify-revoked` | `rejected_authority` | `EXTERNAL_REJECT` | 不重试（77 明列“已撤回/过期”） |
   | `gw-verify-expired` | `rejected_authority` | `EXTERNAL_REJECT` | 不重试（同上） |
   | `gw-verify-ticket-mismatch` | `rejected_authority` | `EXTERNAL_REJECT` | 不重试（超范围） |
   | `gw-verify-scope` | `rejected_authority` | `EXTERNAL_REJECT` | 不重试（超范围） |
   | `gw-verify-replay` | `rejected_authority` | `EXTERNAL_REJECT` | 不重试（凭据已消费） |
   | `gw-action-not-an-action` | `rejected_precondition` | `CONFIG_INVALID` | 补齐后重提；须**新**凭据（nonce 已烧） |
   | `gw-action-bad-format` | `rejected_precondition` | `CONFIG_INVALID` | 同上 |
   | `gw-action-bad-json` | `rejected_precondition` | `CONFIG_INVALID` | 同上 |
   | `gw-action-bad-args` | `rejected_precondition` | `CONFIG_INVALID` | 同上 |
   | `gw-action-mismatch` | `rejected_precondition` | `CONFIG_INVALID` | 同上（申报与实文一致后再提） |
   | `gw-action-unknown-verb` | `rejected_forbidden` | `EXTERNAL_REJECT` | 不重试（表外动作=落入禁止） |
   | `gw-freeform-chinese` | **不是 Err** | — | `Ok({kind:'freeform'})`，只是路由信号 |

   〔结论〕映射的**唯一未决点**：5 个 `gw-action-*`（除 `unknown-verb`）按 80-§5.7 缺省落 `CONFIG_INVALID`，而现状 `gated-platform.ts:104` 一律上抛 `EXTERNAL_REJECT`。二者只能择一：要么 80 给 `rejected_precondition` 加一条“运行期请求形状错”的显式覆盖，要么按缺省落 `CONFIG_INVALID` 并接受事件 note 口径变化。**本附录不代选**（§七 G-1）。
3. **fail-closed**：任何形状/签名/时效/绑定/重放判定失败都拒绝；不猜、不修、不降级；未知动作词不映射到相近动作。
4. **秘密只进 HMAC**：`secret` 不得出现在错误消息、返回码、日志、事件、测试断言的可读串中；错误文案只报**路径/长度/格式类别**，不回显输入值（`wkey.ts:85,90,126`；`ttlToMs` 明确不回显 ttl 原文）。
5. **顺序即语义**：`verify` 的判定顺序（形状→签名→payload→吊销→过期→单号→scope→nonce）与 `gateWrite` 的顺序（中文短路→verify→parse→mismatch→署名）都是冻结行为，改动须批示；测试逐条钉住顺序（`wkey.test.ts:144-151` 钉“吊销先于过期”）。
6. **一个进程一个 `WkeyAuthority`**（80-§11.4.1 第 6 条）：签发面（engine 派工）、验签面（stdio/工具）、吊销面（关单）必须走**同一实例**，否则 `seenNonces`/`revokedTickets` 互不可见 = 吊销失效、同一 token 每实例各成功一次。目标形态：`createGateway(opts)` 接受**已构造**的 `authority`（不传才自建，仅单实例测试用），daemon 装配期造一个再注入所有消费者。**进程内共享是目标；跨进程/多机共享需 nonce 与吊销集落共享 store，未证**（§七 G-8）。
7. **验签与消费分离**（80-§11.4.1 第 4 条）：`verify` 是“判定 + 消费 nonce”，工具面注册需要“**只判定、不消费**”的入口（`verifySealed` 或 `{consumeNonce:false}`）——否则一次注册就把 wkey 烧掉，后续真实写调用全撞 `replay`。**被消费的是 challenge，不是 wkey 的 nonce**。

---

### F-gateway-wkey · `packages/gateway/src/wkey.ts`（198 行）

- **处置**：目标-保留。内核三段（`issue`/`verify`/`revoke`）语义不变；目标只补**限制与持久化接缝**，不重写算法。旧路径=同路径，不迁移。
- **归属**：实现层凭据载体；上位 77-§3.4 `REC-AUTH-04`（逻辑字段：类别/引用/绑定授予/允许操作/有效期/吊销态/知悉范围）、80-§11.1（凭据 ≠ 授权）、78-§5.4（`BIND-EFF-01` E2 的闸门现状）。**不是** 76-§1.5.2 的数字签名结构，也不承担 `REC-AUTH-04.bound_grant` 的授予校验。
- **职责**：把“一次受限写”编码成短命、按单绑定、可吊销的 HMAC token，并对其做全链 fail-closed 校验；提供控制面自用的全开 key。**非职责**：不判断调用方是否有权做该动作（`DEF-AUTH-02` 四态归公司权源）；不判断内容正确；不写台账；不落回执；不做速率限制；不做密钥轮换编排。
- **内部结构**（类型/常量/函数，输入→输出）：
  - `WkeyRejectReason`：7 码 `malformed`/`bad-signature`/`revoked`/`expired`/`ticket-mismatch`/`scope`/`replay`。**已知文档漂移**：文件头 `:10` 写“八种拒绝码”，实际 7 个——属注释缺陷，目标改正措辞，不改码集。
  - `VerifiedWkey`：`{ticket, scope, exp, nonce}`，只回读四个权威字段，内部版本号 `v` 不外泄（`wkey.ts:158`）。
  - `WkeyVerifyCheck`：`now`（必填，epoch ms）、`ticket?`（提供才做单号绑定）、`action?`（提供才做 scope 判定）。省略 `ticket` 的用法只允许控制面自检；写路径必须提供。
  - `WkeyVerifyResult`：`{ok:true, claims}` ｜ `{ok:false, reason}`；判别联合，无第三态。
  - `ControlKey`：`string & {__controlKey}` 品牌类型（全仓唯一品牌，79-§2.1 已登记）；**运行期不存在**，跨用只靠 `CONTROL_TICKET` 绑定拦（见 `gateway.test.ts:117-124`）。
  - 常量：`CONTROL_TICKET='__control__'`、`CONTROL_TTL_DEFAULT='15m'`、`HMAC_LEN=32`、`TTL_UNITS`（s/m/h/d）、`TTL_RE=/^([1-9][0-9]*)(s|m|h|d)$/`、`B64U_RE=/^[A-Za-z0-9_-]+$/`。
  - 内部 schema：`ClaimsInputSchema`（`strictObject`：ticket/scope/nonce，**不含 ttl**）、`PayloadSchema`（`strictObject`：`v:1`/ticket/scope/exp/nonce）。schema 只做形状闸，不承担语义。
  - `ttlToMs(ttl): number`：非法即 `configInvalid('gw-bad-ttl')`；`n*unit` 必须 `Number.isSafeInteger`；**无政策上限**（只防溢出，不防“一年有效”）。
  - `b64uEncode(bytes): string`：对 token 的**编码后字节**签 MAC，避免 JSON 规范化歧义（`wkey.ts:5-6`）。
  - `createWkeyAuthority(secret, clock): WkeyAuthority`：构造期校验 `byteLength===0`（`gw-secret-empty`）与 `<32`（`gw-secret-too-short`）。
  - `issue(claims): string`：schema → `exp = clock() + ttlToMs(ttl)` → `payloadB64u.macB64u`。**不校验 `ticket` 是否等于实例绑定**（authority 无“实例票”概念），也**不查 nonce 重**；payload 五键 `v:1/ticket/scope/exp/nonce`——**无 `iat`、无主体、无授予引用**，加字段须升 `v`（走批示）。
  - `verify(token, check)`：① 单点两段 + 字符集；② 重算 MAC + `timingSafeEqual`（**先比长度，异长返回 `bad-signature` 而非抛**）；③ 才解析 payload（不解析未认证明文）；④ `revoked`；⑤ `now>=exp` 即 `expired`；⑥ `ticket-mismatch`；⑦ `scope`；⑧ `replay`（**只有走到这一步才 `seenNonces.add`**）。
  - **目标新增 `verifySealed(token, check)`（未实现）**：与 `verify` 同一条全链（形状/签名/payload/吊销/过期/单号/scope），但**不写 `seenNonces`**，返回同样的 `VerifiedWkey`。80-§11.4.1 第 4 条把它列为 stdio 注册的必要条件：注册要“证明持有该 wkey”，而 wkey 的 nonce 是**一调用一签发**语义，用 `verify` 去注册会把 nonce 烧掉、后续真实写全撞 `replay`。等价形态 `verify(token, check, {consumeNonce:false})` 亦可，但**必须是同一实现的两条入口**，不得两份检查逻辑。**被消费的是 challenge，不是 wkey 的 nonce**。
  - `revoke(ticket)`：加入 `revokedTickets`，幂等，无返回值。
  - `issueControlKey(authority, {ttl?})`：内部 `randomUUID()` 造 nonce，`scope=[...GATEWAY_ACTIONS]`，`ticket=CONTROL_TICKET`，`ttl=15m` 缺省。
- **导出与依赖**：导出 10 个名字（`WkeyRejectReason`/`VerifiedWkey`/`WkeyVerifyCheck`/`WkeyVerifyResult`/`ControlKey`/`CONTROL_TICKET`/`CONTROL_TTL_DEFAULT`/`WkeyAuthority`/`createWkeyAuthority`/`issueControlKey`；其中 6 个是纯类型、4 个是运行期值）。允许 import：`node:crypto`、`zod`、`@studio-next/contract`（`GATEWAY_ACTIONS`/`configInvalid`/类型）。禁止：`fs`、`store`、`core`、`company`、任何 `process.env`。
- **IO 与注入**：`createHmac`/`timingSafeEqual`/`randomUUID`（`node:crypto`）、`Buffer`；**时钟注入**用于 `issue`；`verify` 的 `now` 由调用方给（同一 clock 由门面透传）。**未注入**：控制面 key 的 nonce 熵源（`randomUUID` 硬编码）——测试无法构造确定性控制 key，也无法在测试中制造 nonce 碰撞。
- **状态 / 并发 / 恢复**：
  - 状态 = 每个 authority 实例两个 `Set`（`seenNonces`、`revokedTickets`），**只存字符串、不存 `exp`**，无 TTL 清理、无容量上限、无持久化、无 `dispose`。**存储不可注入**——80-§11.1 第 4 条要求“nonce 存储与 clock 必须可注入”，当前只满足 clock。
  - 单线程内 `verify` 无 `await`，因此“检查+加入”在同一 tick 内是原子的，同实例并发不会双花 nonce；**跨实例/跨进程不成立**：同一 secret 的两个实例各有独立集合，一个 token 可在每个实例各成功一次。
  - **目标：进程内共享一个实例**（80-§11.4.1 第 6 条）。现状 `createGateway` 每次调用都 `createWkeyAuthority(secret, clock)`（`gateway.ts:65`），于是“engine 签发”“stdio 验签”“关单吊销”各持一套集合——**吊销在 worker 面不可见**、同一 token 每实例各成功一次。目标由 `createGateway` 接受注入的 authority（§四 F-gateway-facade），本件仍只管单实例语义。**跨进程/多机共享 store 未证**（G-8）。
  - 进程重启 → 两集合清空 → 已吊销但未过期的 token **重新可用**（这是当前最重的安全性质，见 §七 G-8）。
  - `verify` 消费 nonce 后，若上层解析失败**不退**（`gateway.test.ts:98-104` 钉住）：客户端必须“一调用一签发”。
  - 无事务、无锁、无 fencing；fencing 与租约属 `TS-PORT-AUTH-04`，不在此件。
- **错误 / 秘密 / 观测**：
  - 构造期子码：`gw-secret-empty`、`gw-secret-too-short`、`gw-bad-claims`、`gw-bad-ttl`；均经 `configInvalid` 抛（80-§5.7：固定 `failure:'rejected_precondition'` + `CONFIG_INVALID`）。
  - 运行期只用 7 个纯码，无文案、无事件、无日志、无计数。**观测缺口**：拒绝率、重放尝试、吊销次数都无法从本件获得；调用方（`studio-tools`）把码转 `ToolError`，是否落 `REC-EVT-01` 归 15/17。**目标**：本件不产 `ClassifiedError`，只产 `WkeyRejectReason`；`failure` 由门面按 §4.0 映射表补（**单一口径**，不在两处各定一套）。
  - 秘密边界：`secret` 进闭包后不零化、不可轮换、无 `revokeAll`；错误消息只报长度；`ttl` 原文不回显。测试的 secret 卫生用例只覆盖**构造错与两个 verify 返回值的 JSON**（`wkey.test.ts:200-222`），**不构成**“全路径无泄漏”的证明（未覆盖 `issue` 抛错路径的 message 全文、未覆盖异常栈、未覆盖调用方日志）。
  - **无上限**：`ticket`/`nonce`/`scope` 数组长度与元素长度均无上限 → token 体积无上限；`scope` 允许重复动词（不校验唯一性），`includes` 线性查找。
- **测试与证据**：`F-gateway-test-wkey`（20 个用例）：往返回读、token 形态（恰一段点、两段 base64url、payload 五键）、不同 nonce 互不干扰、ttl 四单位换算、表外动词签发期拒、payload/mac 篡改、异密签发、过期边界、单号绑定与跳过、scope 内外、重放与“失败不消费”、吊销（含他单不牵连与幂等）、吊销先于过期、七类形状畸形、空/短 secret、非法 ttl 八例、claims 空字段、secret 卫生、控制面 scope/单号/TTL 边界/随机 nonce/一刀切吊销。**不证明**：跨进程吊销、重启后语义、内存增长、时序侧信道、模糊测试下的解析健壮性、超大输入、密钥轮换。V 层定位：V2（源码行为）；V3/V4/V5 **未执行**。R/E/W 映射归 82，本附录不代填。
- **规模 / 迁移**：目标 ≤220 行（现 198）。迁移顺序：先补**注释漂移**（7 vs 8）、**`revoke` 的空串/空白拒绝**（80-§11.1 第 2 条）与**输入上限**（`ticket`/`nonce` 长度、`scope` 数量、TTL 政策上限——阈值属政策项，须批示，不在本附录定值）→ 再补 `makeNonce` 注入（控制面 key 确定性）→ 持久化接缝（见 §七 G-8，须先有 80 端口）。**不得**先把 `Set` 换成 store 调用（会新增 `gateway → store` 边）。

---

### F-gateway-actions · `packages/gateway/src/actions.ts`（67 行）

- **处置**：目标-保留（格式与拒绝码不变）+ **目标新增 `encodeAction`**（与 `parseAction` 成对，`actions.ts` 是唯一实现）。旧路径=同路径。
- **归属**：实现层；上位 24-§二（工具集=白名单的机器化）、contract `ports/gateway.ts:13`（`GATEWAY_ACTIONS` 六动词）、18-§二.3（状态推进永不在表内）、80-§11.4.1 第 4 条（“`encodeAction`/`decodeAction` 集中在网关”）。**不**承载 77 的 `REC-WORK-09`（状态迁移），也不承载任何 effect 分类（`BIND-EFF-01`）。
- **职责**：一条 `@action` 指令的**双向**编解码——`parseAction`（文本→`{action,args}`）与 `encodeAction`（`{action,args}`→文本）；对非结构化中文只**标记**回退。**非职责**：不校验参数语义（无 per-verb schema）、不校验正文大小、不消毒、不署名、不判断该动作是否被授权、不执行。
- **内部结构**：
  - `ActionRejectReason`：`not-an-action`/`bad-format`/`unknown-verb`/`bad-json`/`bad-args`。
  - `ActionParseResult`：`{ok:true, action, args}` ｜ `{ok:false, reason, needsLlmFallback?: true}`。
  - `ACTION_LINE_RE=/^@action[ \t]+(\S+)[ \t]+(.+)$/`：分隔符只认空格/Tab；`@action` 大小写敏感；必须占**首行**。
  - `ArgsSchema = z.record(z.string(), z.unknown())`：JSON 对象即可；数组/`null`/标量在 `safeParse` 失败 → `bad-args`。
  - `CJK_RE=/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/`：扩展 A + 基本区 + 兼容表意；**不含**假名、标号、全角符号。
  - `isFreeformChinese(text): boolean`：纯判定，不解析。
  - `parseAction(text): ActionParseResult`：取首个 `\n` 前的一段 → 前缀非 `@action` 则 `not-an-action`（整段含 CJK 才附 `needsLlmFallback`）→ 正则不匹配 `bad-format` → 动词白名单 → `JSON.parse` → 对象校验。
  - **`encodeAction(action, args): string`（目标-新增，未实现）**：`@action <verb> <json>` 单行，verb 必须 ∈ `GATEWAY_ACTIONS`（表外即构造期 `configInvalid('gw-bad-claims')` 同级路径，**不落**运行期拒绝码），`args` 必须可 JSON 序列化且为对象。**与 `parseAction` 往返一致**（`parseAction(encodeAction(a))` 得同一 action/args，键序不保证）。存在理由：`tool → action` 的映射只有一份，stdio/HTTP 两面都调它——**不得**在工具面复写一份 `@action` 拼装或映射表（两份映射必然漂移，`tool→action` 授权会被绕过）。
- **导出与依赖**：导出 5 个名字（`ActionRejectReason`/`ActionParseResult`/`isFreeformChinese`/`parseAction`/`encodeAction`）。允许 import：`zod`、contract。禁止：任何 IO、任何其他网关件（保持叶子）。
- **IO 与注入**：无。无时钟、无 ID、无随机。
- **状态 / 并发**：零状态、纯函数；`GATEWAY_ACTIONS` 是冻结常量，运行期不可变。
- **错误 / 秘密 / 观测**：五码，无文案、无日志。**不回声原文**（`bad-json` 不带 JSON 片段）——这是有意的：坏输入可能含秘密。**已知边界**：`@action` 行里的 JSON 参数若含凭据（如误贴 wkey），网关不会拦截也不会脱敏，落库/日志风险归调用方与 `redactOutbound` 出口（80-§11.2）。
- **测试与证据**：`F-gateway-test-actions`（13 例 + 目标新增往返例）：三组合法、六动词全覆盖、未知/大小写/相近词、状态推进动词拒、坏 JSON 三型、非对象四型、格式残缺与“非行首不认”、首行为准、嵌套/数组/空格、CJK 判定正反、中文回退标记、“结构化但坏了不回退”；**目标补**：`parseAction(encodeAction(a,args))` 对六动词逐个往返一致、表外动词 `encodeAction` 拒、`args` 为数组/`null`/标量时拒。**不证明**：LLM 回退真的能解析（无模型、无上层路由）、与 MCP schema 的一致性（归 15）、超长行与不可见字符、CRLF 之外的行分隔、键序稳定性。
- **规模 / 迁移**：目标 ≤110 行（现 67，`encodeAction` + 往返测试不算行）。目标内改动仅：`encodeAction` 落地 + 如需 per-verb 参数 schema，必须先在 contract 定义动作参数并走批示（`GATEWAY_ACTIONS` 是 contract 冻结表，本件不得私加）。

---

### F-gateway-signature · `packages/gateway/src/signature.ts`（41 行）

- **处置**：目标-保留（补字段约束与术语澄清）。旧路径=同路径。
- **归属**：实现层展示面；上位 contract `ports/platform.ts:63`（`SignedBody` v1.2：`author`=工号，`signature` 由实现拼装）、80-§6.6（daemon 侧身份注入须在 EffectGateway 签名中保留）、77-§2.6 `REC-EVT-01`（`actor_ref` 必须是实际主体）。**明确不是** 76-§1.5.2 的签名结构（八字段：`scheme`/`keyRef`/`signerRef`/`signedDigestRef`/`scope`/`createdAt`/`verificationState`/`value`），也不产出 `value` 一类密码学材料。
- **职责**：把四个身份位拼成固定落款，并组装 `{author, body, signature}`。**非职责**：不改写正文（`body` 原样）、不判定身份真实性、不查人事档案、不决定展示位置（拼进评论尾行归平台适配器，25-§3.2）、不做权限判断。
- **内部结构**：
  - `SignatureContext`：`{company, dept, role, level:number}`，四段全填充。
  - `composeSignature(ctx): string`：`[${company}·${dept}·${role}·${String(level)}]`，中点 U+00B7。
  - `signedBody(ctx, author: PersonId, body): SignedBody`：`author===''` → `gw-signature-empty-author`。
  - 内部 `assertContext`：空串三连 → `gw-signature-empty-field`；`level` 非整数或 `<1` → `gw-signature-bad-level`。
- **导出与依赖**：导出 3 个名字。仅依赖 contract（`configInvalid`、`PersonId`、`SignedBody`）。零 IO、零状态。
- **错误 / 秘密 / 观测**：三个 `gw-signature-*` 子码，经 `configInvalid` 抛（构造/写时）。错误消息只报字段类别与 level 数值（level 非秘密）。无日志、无事件。
- **已知缺陷（现有，非目标能力）**：
  1. **只校验空串，不校验分隔符与换行**：`company`/`dept`/`role` 含 `·`、`[`、`]` 或 `\n` 时，落款不再可解析为四段（测试 `signature.test.ts:15-20` 只断言正常输入恰三个中点）。这是格式完整性缺口。
  2. **`author` 只拒空串**：不拒空白；contract 的 `PersonId = string`（`ports/kernel.ts:9`）无品牌，服务身份 `'daemon'` 与真实工号在类型上不可区分（消费事实：`engine.ts:504` 的 `ENGINE_CONFIG_DEFAULTS.actor='daemon'`，经 `serve.ts:784-791` 的 `daemonIdentity` 注入）。
  3. **级别无上限且可渲染成非数字**：`level=999` 通过；`level=1e21`（`Number.isInteger(1e21)===true`）也通过，`String()` 渲染为 `1e+21`，落款不再是“数字直写”的可解析形态（`signature.ts:40`）。
  4. **`dept` 语义未定**：测试注入 `'平台部'`（`signature.test.ts:8`），生产注入部门**路径**（`serve.ts:787` 的 `snapshot.departments[0]?.path`，缺省 `ENGINE_CONFIG_DEFAULTS.deptFallback='departments/工程部'`）。同一字段两种形态，落款口径不一致——须批示定“名称 or 路径”，并回写 76/78。
  5. **空白不等于空**：`' '`/`'\t'` 通过空串检查（`signature.ts:37-40`）；`author` 同理（`:32`）。
  6. **生产身份位是服务占位**：`role='daemon'`、`author='daemon'`（`serve.ts:788,791`），署名不是“任职者”；`ctx` 是热重载活对象，署名随最后一次 mutate，不是写入时刻的人事核验。
- **测试与证据**：`F-gateway-test-signature`（6 例）：格式与中点计数、空字段三例、级别四例（0/负/小数/NaN）、三字段与正文不改写、空工号、空正文放行。**不证明**：平台侧实际渲染、评论尾行拼装、特殊字符注入、超长字段、身份真实性。V2；V3/V4 未执行。
- **规模 / 迁移**：目标 ≤60 行。迁移顺序：先在**本件**补“字段不得含分隔符/换行、`author` 不得为纯空白”的拒绝（实现内的输入约束，不新增公共概念；80-§11.1 第 2 条对空白输入的统一口径），再等 §七 G-9 的身份类型裁决后决定是否收窄 `author`。

---

### F-gateway-facade · `packages/gateway/src/gateway.ts`（94 行）

- **处置**：目标-保留（成为 `EffectGateway` 的可信内核；构造期校验前移；拒绝通道 `Result` 化）。旧路径=同路径。
- **归属**：实现层门面；上位 80-§5.7（拒绝通道五条、两轴错误）、80-§6.6（`TS-PORT-EFF-01` 包裹 `createGateway().gateWrite`，三段保留为内核）、80-§11.1 六条（凭据 ≠ 授权、构造期验、先校验后消费 nonce、`author` 取自已授权身份）、80-§5.8（秘密安全的错误）、17-§7（写入全收口，控制面不豁免）、78-§5.4（E2 闸门现状）。
- **职责**：按单组装“鉴权 → 结构化 → 署名”，给出唯一允许/拒绝判定，且**拒绝时绝不放行底层写**。**非职责**：不调用平台、不判断授权四态、不做 effect 分类、不写回执、不做幂等、不校验预期版本、不重试、不度量。
- **内部结构**：
  - `GateRejectReason`：模板字面量联合 `gw-verify-${WkeyRejectReason}` ｜ `gw-action-${ActionRejectReason}` ｜ `gw-action-mismatch` ｜ `gw-freeform-chinese`（7+5+2=14 个取值）。**v0.3 起语义降格为“`subcause` 取值集”**，名字保留（`gated-platform.ts:44`、`server.ts:37` 按名 import；`GATE_DENY_HINTS` 逐项覆盖，是“码集未漂移”的第二道钉）。`gw-freeform-chinese` 不在 `subcause` 面内使用——它只作为 `Ok` 里的判别值出现。
  - `GateDecision`（**目标-新增形状，非新公共概念**，只是 `Ok` 载荷）：`{ kind:'allowed'; action; args; signed }` ｜ `{ kind:'freeform'; needsLlmFallback:true }`。前者表示“可写”（不表示外部已写、不表示已验收）；后者是路由信号，不是鉴权结论。
  - `GateWriteResult`（**目标-替换形状**）：`Result<GateDecision, ClassifiedError>`。现值为 `{allowed:true,…}|{allowed:false, reason, needsLlmFallback?}`——后者正是 80-§5.7 拒绝通道第 3 条禁止的“拒绝塞进成功返回值”，且该条把 `GateWriteResult` 列为 `Result` 形态的示例，故必须改。替换后：14 个码中的 13 个落 `Err.subcause`，`gw-freeform-chinese` 落 `Ok.kind==='freeform'`（映射见 §4.0）。
  - `GatewayOptions`：`{secret, clock, ticket, ctx, author, authority?}`。`ticket` 即本实例收口的单号（verify 绑定锚），控制面用 `CONTROL_TICKET`。**目标**：`secret` 由装配方从 `SEC-GW-SIGNING`（`SecretCatalogEntry`，`allowedUses` 必含 `gateway-sign`）取得后注入，本件不读 env、不读文件（80-§11.2.1）；`author` 必须来自**已授权身份**（`AuthorityActivation`/`REC-AUTH-*` 解析结果），不得取请求体自报字段（80-§11.1 第 5 条）；**`authority?` 是已构造的 `WkeyAuthority`（80-§11.4.1 第 6 条）**——给了就**复用**，不给才用 `secret`+`clock` 自建（仅单实例测试用）。daemon 装配期造一个 authority，engine 签发、stdio 验签、关单吊销、各按单 `createGateway` **全部注入同一实例**；**不得**每 ticket 各起一套 `seenNonces`/吊销集。
  - `Gateway`：`gateWrite`、`issue`、`issueControlKey`、`revoke`、只读 `authority`。`gateWrite` **保持同步**（11 处生产消费全是同步调用；`EffectGateway.apply` 才是异步包装），签名目标为 `gateWrite(token, action, payload, options?: { effectAction?: EffectAction }): GateWriteResult`。第四参只承载高层效果类别；普通 `@action` 调用省略，高层效果路径必填，不得借省略绕开高层 scope 校验。
  - `createGateway(opts)`（**目标：构造期一次验完，验过才进入可消费 nonce 的路径**）：
    1. `opts.authority ?? createWkeyAuthority(secret, clock)`；自建路径下空/短 secret 先抛 `gw-secret-*`；注入路径下 `secret` 可缺省（**不得**用注入的 authority 配一个不同的 secret 再自建第二个实例）；
    2. `ticket` 空或纯空白 → `gw-empty-ticket`（80-§11.1 第 2 条对 `revoke(keyId)` 的同一口径，见下条）；
    3. `ctx` 三字段非空 + `level` 为 `>=1` 整数 → 直接调 `composeSignature(ctx)` 复用 `signature.ts` 的 `assertContext`（**单一口径**，不复制校验）；
    4. `author` 非空且非纯空白 → 否则 `gw-signature-empty-author`；
    5. 全部经 `configInvalid` 抛（`failure:'rejected_precondition'` + `CONFIG_INVALID`）。
    现状：只做 1、2；3/4 缺失，坏 `ctx`/`author` 要等 nonce 烧掉后由 `signedBody` 抛（见下“现有缺陷”）。`authority?` 注入形态**未实现**（现状每次新建，`gateway.ts:65`）。
  - `gateWrite(token, action, payload, options?)`（顺序不变，返回形态改）：
    0) `!payload.startsWith('@action') && isFreeformChinese(payload)` → `Ok({kind:'freeform'})`（**不 verify、不烧 nonce**）；
    1) `authority.verify(token,{now:clock(),ticket:opts.ticket,action,effectAction:options?.effectAction,author:opts.author})` → 失败即 `Err(failure per §4.0, subcause:'gw-verify-*')`；`VerifiedWkey.author` 必须与构造时已授权的作者一致，不能只验 token 形状；
    2) `parseAction(payload)` → 失败即 `Err(…, subcause:'gw-action-*')`；
    3) `parsed.action!==action` → `Err(…, subcause:'gw-action-mismatch')`；
    4) `Ok({kind:'allowed', action, args, signed: signedBody(ctx, author, payload)})`——**目标**：因构造期上下文与作者校验已在 `createGateway` 验过，此处 `signedBody` 只剩纯拼装，不再抛。高层效果路径必须给 `options.effectAction`，且 claims 同时含它与实际 `action`；缺任一层即拒。
- **导出与依赖**：导出 4 个类型（`GateRejectReason`/`GateWriteResult`/`GatewayOptions`/`Gateway`）+ `GateDecision` + `createGateway` + 再导出 `CONTROL_TICKET`。允许 import：本包三件 + contract。禁止：任何 IO、任何 store/company/core、任何 `process.env`（秘密经注入，不经环境读取）。
- **IO 与注入**：仅 `clock`；secret/ctx/author 由构造方给。**每个实例只服务一个 ticket**——但该绑定只作用于 `gateWrite` 的 verify；`issue`/`revoke` 透传任意单号（见 §8.1）。跨单复用会被 `ticket-mismatch` 拦，这是结构性约束而非提示。
- **状态 / 并发 / 恢复**：全部状态在 `authority` 闭包（见 F-gateway-wkey）。门面自身无状态。同一实例的 `gateWrite` 不可重入问题不大（同步），但**同一 token 第二次必 replay**。**注入共享 authority 后**，“不可跨 ticket”只约束 `gateWrite` 的 verify 绑定，吊销/已见 nonce 是全进程可见的（这正是目标）；**跨进程仍不共享**（G-8）。
- **错误 / 秘密 / 观测**：
  - 目标形态下运行期**只返 `Err`、不抛**；构造期**只抛 `configInvalid`**。`Result` 的 `E` 里只放 `failure`/`category`/`subcause`，`detail` 只写字段名与类别，不得含 token/nonce/secret/绝对路径（80-§5.8）。
  - **现有缺陷（重要）**：文件头 `:7-8` 声称构造期会拦“坏署名上下文”，实际 `createGateway` **不校验** `ctx`/`author`；空公司/空工号要等到**通过 verify 与 parse 之后**才由 `signedBody` 抛出 `CONFIG_INVALID`——此时 nonce 已被消费，调用方拿到“配置错 + 凭据已作废”，属最坏的错误时序。`gated-platform.ts:122` 用 `composeSignature(opts.ctx)` 在装配期补了这道；`studio-tools` 只接收已构造的 Gateway 实例，无从补；`EffectGateway` 必须在自身构造期校验。目标：把 3/4 前移到 `createGateway` 构造期（纯实现内改动，不改导出面）。
  - **自由中文短路在鉴权之前**（`gateway.ts:14-17,74-77`）：未验 token 即返回回退标记；不烧 nonce、不产生拒绝事件，也不构成鉴权结论。`Result` 化后它仍在 `Ok` 侧，**不得**被读成“已通过鉴权”。
  - 无日志、无事件、无计数；拒绝只活在返回值里（观测缺口见 §8.4）。
- **测试与证据**：`F-gateway-test-facade`（13 例）：合法写全字段相等（含“正文不改写”）、鉴权五路由（malformed/expired/revoked/ticket-mismatch/scope）、重放、动作词四路由 + 非结构化非中文、申报/实文分叉、中文回退不烧 key 且同 token 可复用、结构化路径烧 nonce 不退、控制面九动作逐个放行、控制/按单 key 互斥、控制面吊销、控制面自定义 TTL、secret 卫生、构造期两例。**目标补**：`Err.failure`/`subcause` 的双轴断言（14 码逐条）、`Ok.kind==='freeform'` 不被当鉴权结论、构造期坏 `ctx`/坏 `author` 各一例且**断言 nonce 未被消费**。**不证明**：跨进程、并发、`signed.body` 被错误落库的风险（无集成断言）、`authority` 被生产代码绕过（无静态断言）。
  - 卫生：`gateway.test.ts:70` 用 `n-${Math.random()}` 造 nonce。与 80-§8.6“不得用 `Math.random()` 生成安全相关值”相冲突（此处仅测试，但同一文件声称覆盖卫生面）。目标测试改用递增计数器。
- **规模 / 迁移**：目标 ≤140 行（+46 行来自构造期校验与 `Result` 包装，`GateDecision` 为纯类型）。顺序：① **先做构造期校验前移**（纯实现内、不改导出、不改签名，零消费点影响）；② 再 `Result` 化——**必须与 `contract` 的 `Result`/`failure` 同单**，且与 15/17 的两个消费点同批（`gated-platform.ts` 的 `gate()` 读 `verdict.allowed/reason`、`server.ts` 的 `GATE_DENY_HINTS` 读取路径）；③ 最后接入 daemon 侧 EffectGateway（**文件归 16**：`F-DAEMON-ENGINE-TOOLS-EFFECT-GATEWAY`，行为契约见 §四），**不得**先把 `gateWrite` 改成异步——它是全部消费点的同步契约。

---

### F-gateway-index · `packages/gateway/src/index.ts`（23 行）

- **处置**：目标-保留；导出面**分级**（不删除被消费符号）。旧路径=同路径。
- **归属**：实现层包根；上位 80-§2.1（gateway 包职责不变）、79-§4.4（源码态入口）。
- **职责**：把四件再导出为包面；用头注登记待批事项。**非职责**：不做装配、不做单例、不读配置、不初始化任何状态（无副作用是这个文件的硬要求：`serve.ts` 在多个入口 import 它）。
- **内部结构**：`export * from './wkey.ts' | './actions.ts' | './signature.ts' | './gateway.ts'`。`CONTROL_TICKET` 同时经 `wkey.ts` 与 `gateway.ts` 到达包根：按 TS 的星号再导出规则，两条路径指向**同一绑定**时不算歧义；若未来两处来源分裂，包根会变成歧义导出（甚至编译红），必须显式择一。本文未复跑 `tsc`，此条只作规则说明，不作“当前编译通过”的证据。
- **导出与依赖**：包面现值 = 10（wkey）+ 4（actions）+ 3（signature）+ 6（facade 独有；`CONTROL_TICKET` 与 wkey 重复不计）= 23 个不同名字。目标分级：
  - **承诺面**（跨包已消费）：`createGateway`、`CONTROL_TICKET`、`composeSignature`、`signedBody`、`Gateway`、`GateRejectReason`、`SignatureContext`、`GateWriteResult`、`GatewayAction` 相关类型。
  - **审计/测试面**（包内为主）：`createWkeyAuthority`、`issueControlKey`、`WkeyAuthority`、`WkeyVerifyCheck`、`VerifiedWkey`、`WkeyRejectReason`、`ControlKey`、`CONTROL_TTL_DEFAULT`、`parseAction`、`isFreeformChinese`、`ActionParseResult`、`ActionRejectReason`。
  - 分级手段只能靠**注释与文档**（TS 无 `@internal` 强制）；若要用子路径导出隔离，须先确认无消费者并走提案（会改 `exports`）。
- **IO 与状态**：无。**必须保持无副作用**：任何顶层 `createGateway`/读 env/读盘都会让 7 处生产 import 产生隐式单例。
- **错误 / 观测**：N/A（纯再导出）。
- **测试与证据**：无专属测试；由四件测试与消费包间接覆盖。**不证明**导出面无环、无重复身份。目标可加一条“导出名清单快照”断言（防止无意增删），但属新增测试，须归 `F-gateway-test-facade` 或新测试，不得塞进生产件。
- **规模 / 迁移**：目标 ≤40 行。头注 5 条待批（`index.ts:14-18`：nonce 持久化与 MCP 复用相容、ttl/secret 定值、级别展示形态、中文短路与任务书顺序偏差、`CONTROL_TICKET` 命名）**迁出**到 82/实现单的决策登记，不在包根长期充当决策台账。迁移顺序：先迁决策 → 再写导出分级注释 → 最后（若确需）改 `exports`。

---

### 行为契约 · `EffectGateway`（文件归 16：`F-DAEMON-ENGINE-TOOLS-EFFECT-GATEWAY`；本卷不分配 ID、不计件）

- **处置**：**非本卷文件**——文件级处置（目标-新增，路径 `apps/daemon/src/engine/tools/effect-gateway.ts`）归 16，ID 为 `F-DAEMON-ENGINE-TOOLS-EFFECT-GATEWAY`（16-§4.12）；本卷**只写行为契约**（流水线、错误、证据、测试面），不分配 ID、不计件。**落点已由 80 定死**：类型在 `contract/src/ports/effects.ts`（80-§6.9 `:2259`，G-2 关闭），外层四层编排在 daemon `engine/tools/`（同表），本包只提供内核三段（`wkey`/`actions`/`signature`/`gateWrite`），**不另造 `EffectGateway` 第二实现**。函数表与装配顺序归 16/17。**前置条件**：G-3～G-6 已由 80-§4.3.1/§6.3/§6.6 给出目标形状与查询/凭据路径，当前阻断只剩**代码未实现**，不是接口空白；不得把已定的结构再写成“待补”，也不得在包内另建一套。
- **归属**：实现层（daemon 侧编排）；上位 80-§6.6 `TS-PORT-EFF-01`（定稿签名与错误行）、80-§5.2（`EffectOutcome` 两分支都带引用）、80-§2.3 `:129`（本包只做“可信内核”）、80-§5.7（错误两轴、`Rejected`/`partial` 走 `Err`、`unknown` 留 `Ok`）、80-§8.4（重试先查回执、超时=未知、`partial`≠`unknown`）、80-§8.5（跨进程围栏三选一）、80-§11.1（凭据 ≠ 授权）、80-§11.4（代理 ≠ 凭据 ≠ 沙箱）；77-§1.3/§1.4、§2.4 `REC-RCP-01`、§2.7/§2.8 `REC-EVT-02/03`、§11.1/§11.2；78-§五 `BIND-EFF-01`（E2 执行位置）、78-§9.6（未知回执三情形）。
- **职责**：在 `gateWrite` 内核之外加四层——权源引用解析、效果准入、围栏校验、回执与未知对账——使“允许写”升级为“这次外部效果有回执或明确未知”。**非职责**：不签发凭据（内核）、不判定授权四态（`AuthorityGrantPort`/`DEF-AUTH-02`）、不判定风险档（`REC-WORK-11`）、不判 E 级（`BIND-EFF-01` 是绑定层，分类不由网关做）、不直调平台（平台写归 daemon 的 `FlowPlatform`）、不写台账（回执经 `RecordWriter`）、不自建脱敏实现（出站文本经 `contract` 的 `redactOutbound`，见 §8.3/G-7）。
- **定稿签名（照 80-§4.3.1 与 §6.6 现行原文）**：
  - `apply(effect: EffectRequest): Promise<Result<EffectOutcome, EffectError>>`
  - `EffectRequest = { authorityRef: VersionRef<string>; effect: EffectDescriptor; credentialRef?: VersionRef<string>; fence?: FenceToken; idempotencyKey: string; target: EffectTarget }`
  - `EffectDescriptor = { action: ControlEffectAction; args: Readonly<Record<string, unknown>>; effectClass: EffectClass; origin: EffectOrigin; partialItems?: readonly EffectPartialItem[] }`；`EffectTarget = { bindingRef: DefinitionRef; objectRef?: ExternalRef; workRef?: Qid }`。
  - `EffectAction = GatewayAction | ControlEffectAction` 是凭据 scope 的并集；本端口的 `effect.action` 只收九个平台控制写。`comment`/`article` 由工具路由翻译为 `comments.add`/`kb.upsert`；`heartbeat`/`evidence-write`/`kb-search`/`budget-query` 各有后端，不在此冒充平台写。高层 `effect.action` 与映射后的实际 `gatewayAction` 都必须在 `claims.scope` 内；不能只凭 `comment` 获得控制写权限。
  - `EffectError = ClassifiedError & { partialItems?: readonly EffectPartialItem[] }`；`failure='partial'` 时逐项给 `key/status`：`applied` 必带 `receiptRef`、`unknown` 必带 `unknownRef`、`failed` 必带 `error`。
  - 工厂注入 `EffectCredentialBroker.forCall(req)` 与 **`EffectWriter`**：`credentialRef` 已给时解析活跃签发，未给时按 action、target、origin 现签；token 只在 daemon 内存，不进入请求、帧、日志或记录。writer 归既有 `engine/tools/gated-platform.ts`，负责九个平台写与回执核验，不再重复过闸；`committed` 必带原生外部引用与执行后版本，`void`/仅排队/不可核应答只能回 `unknown`。
  - `EffectOutcome = { status:'applied'; receiptRef: Qid } | { status:'unknown'; unknownRef: Qid; reason?: string }`
    - **两个分支都必填引用**：`applied.receiptRef` 指向 `REC-RCP-01`（`RecordWriter.append` 返回的 `recordId`）；`unknown.unknownRef` 指向 `REC-EVT-03`（`TS-PORT-REC-06 registerUnknown` 返回的 `Qid`）。`reason` 只是诊断文本，**不得**替代引用、不得装秘密、不得用来判重试。
    - 这是**判别联合的必填字段**，不是“可选 + 文档要求”：`Ok({status:'applied'})` 与 `Ok({status:'unknown'})` 在类型层就不可构造。
  - **先落记录再 `Ok`**（80-§6.6 `:1656`）：`applied` 必须先取得外部回执并写入 `REC-RCP-01` 才返回；`unknown` 必须先写出 `REC-EVT-03` 才返回。**回执/未知未落地不得回报**——`applied` 宁报 `Err` 或 `Ok(unknown)`+已登记的 `unknownRef`；`unknown` 登记失败即下条。
  - **登记失败 → `Err(unavailable, category:'STALL', subcause:'unknown-record-unwritten')`**（80-§6.6 `:1656`，与 §5.2 `:717` 同一口径）：**不得**返回无引用的 `Ok(unknown)`，不得写“待补”，不得让上层直接重发（三情形的证据与对账路径见 §8.7）。
  - **`rejected`/`partial` 不是成功 status**：走 `Err(rejected_authority|rejected_forbidden|partial)`；**`unknown` 留 `Ok`**（“外部做了什么不知道”不是拒绝，也不能当失败重试）。
  - **意图域强制 `intentRef`，非意图域不强制**（80-§6.6 `:1993`）：当这次未知**归属于某条意图**（对应 `REC-WORK-01`，或该 `REC-EVT-03` 关联/将关联意图回执）时，`registerUnknown` 的 `unknown_scope.intentRef` **必填**，缺失即 `Err({failure:'rejected_precondition', category:'CONFIG_INVALID', subcause:'unknown-scope-intent-missing'})`——**不接受“先写未知、回头补链”**。平台读侧查询、观测、导入与对账等**非意图域**的未知，`intentRef` 缺省合法，**不得**被这条规则拒收（也不进 `intent_receipts` 派生范围）。判定点在本件：写路径由 `EffectGateway` 触发，故它必须知道“这次效果属于哪条意图”；不知道就按非意图域登记，不得猜。
- **内部结构**：
  - `createEffectGateway(deps)` → `EffectGateway`。`deps` 与 80 端口逐项对应（**不得**自造能力）：

    | dep | 80 端口 | 本件用途 | 现状 |
    |---|---|---|---|
    | `kernel` | 本包 `Gateway` | 三段内核（verify → parse → sign） | 现有 |
    | `credentialBroker` | daemon 内部 `EffectCredentialBroker.forCall` | 已给 `credentialRef` 时解析活跃签发；未给时按 action/target/origin 现签；返回 `EffectCredential` 只在 daemon 内存 | 未实现 |
    | `credentials` | `TS-PORT-AUTH-06 CredentialCatalogPort.resolve` | `credentialRef` → 引用侧（提供方/绑定/范围/到期/吊销态）；**不含凭据值**，供 broker 使用 | 未实现 |
    | `grants` | `TS-PORT-AUTH-05 AuthorityGrantPort.exercise` | 登记“这次行使”，**不授予**；`authorityRef` 的授予边由读面解析 | 未实现 |
    | `lease` | `TS-PORT-AUTH-04 WriterLeasePort` | `fence` 有效性与代次 | 未实现 |
    | `writer` | daemon 内部 `EffectWriter`（非公共端口） | 九个平台写与回执核验；归既有 `gated-platform.ts`，不再重复过闸 | 未实现 |
    | `receipts` | `TS-PORT-REC-01 RecordWriter.append` | **先写 `REC-EVT-01` 效果尝试**，再写 `REC-RCP-01`；同一 `idempotencyKey` | 未实现 |
    | `reader` | `TS-PORT-REC-02 RecordReader.get/query` | 解析 `authorityRef`、回执与既有 attempt 先查 | 未实现 |
    | `reconcile` | `TS-PORT-REC-06 ReconciliationPort.registerUnknown` | `unknown` 登记（`REC-EVT-03`）、未完成 attempt 的恢复对账 | 未实现 |
    | `clock` | 80-§8.6 注入 | 时间与回执窗口 | 未实现 |

  - `apply(effect)` 的流水线（顺序冻结）：
    1. **回执与 attempt 先查**：按 `RecordQuery.idempotencyKey` 精确查。已有同效果回执→返回原 `applied`；同键不同效果→`rejected_idempotency`，附首次引用。有 attempt 无结局→只返回/登记对账中的未知，不得再次执行。
    2. **权源、凭据与围栏**：解析 `authorityRef`，调 `credentialBroker.forCall(effect)`，检查 fence 与双层 scope；跨进程无互认围栏→`unsupported`。任何一步失败均不得触达平台。
    3. **编码与内核**：`packages/gateway/src/actions.ts` 唯一映射并编码，调 `kernel.gateWrite(token, gatewayAction, payload, {effectAction:effect.action})`。`args.op` 不是授权依据；适配器不得另写映射。
    4. **效果尝试先行**：平台调用前，经 `receipts.append` 追加 `REC-EVT-01`（`event_kind='动作'`、`source_kind='操作记录'`），`payload_summary` 只含效果标识、键、摘要、目标、主体与时刻，不含秘密/完整参数。唯一索引防同键双尝试；`deduped=true` 回到第 1 步，**不得**调 writer。
    5. **实际执行**：仅对新 attempt 调 `writer.write`。它必须返回可核 `committed` 或 `unknown`；`void`、排队或缺原生版本的应答不得被改成 `committed`。`Err` 只允许表示确定未产生外部效果的拒绝。
    6. **回执**：`committed` 先落 `REC-RCP-01`（`acknowledges=attemptRef`、`ack_kind='已执行'`、原生版本/外部引用、`retryable`/`side_effect_possible` 必填），再返回 `applied`；写回执失败按未知处理。
    7. **未知**：外部结果不明、已发送后异常或回执写失败，先登记 `REC-EVT-03`（`lineage.parentRefs` 链 attempt；意图域必须有 `unknown_scope.intentRef`），再返回 `Ok({status:'unknown',unknownRef})`。登记失败→`Err(unavailable/STALL/unknown-record-unwritten)`，不得让上层直接重发。
  - **`partial` 与辅助**：每个 partial 项有独立键、attempt、回执/未知；缺一项即转 `unavailable` 对账，无外部事务证明不得宣称多动作原子。内部辅助：`admitAuthority`、`checkCredentialScope`、`checkFence`、`findReceipt`、`recordAttempt`、`writeReceipt`、`registerUnknown`、`toOutcome`、`mapKernelReject`。
- **导出与依赖**：在 daemon 侧导出 `createEffectGateway`，类型只从 `contract` 再导出。依赖 `contract` + `@studio-next/gateway`；禁止直连 `store`、具体平台包、`panel`/`api`、`node:child_process`、`process.env`。平台 IO 只经注入 writer，本件不做网络/文件/子进程。
- **状态 / 事务 / 幂等 / 并发 / 恢复**：事实全在记录端口后。同键并发由唯一索引收敛为**一个持久化尝试**，不是“回执唯一就保证一次外部效果”。REC-06 重启扫描“有 attempt、无回执/未知”并登记未知、冻结该键；只承诺一个持久化尝试最多主动调用一次平台，**不承诺**外部物理效果恰好一次。迟到结果经对账消解，不重算验收。
- **错误 / 秘密 / 观测**：
  - `Err` 的 `failure` 取 77 的 14 类原值：`conflict`（同键异内容）、`rejected_authority`（权源/凭据）、`rejected_version`（`authorityRef` 或 fence 代次）、`unsupported`（未知凭据引用、无互认围栏）、`rejected_forbidden`（凭据范围不覆盖）、`partial`（部分完成）、`unavailable`（端口不可达）。内核 13 个拒绝码的映射见 §4.0——**不再另定一套**。
  - 观测：每次 `apply` 至少产出一条回执引用或未知登记引用；秘密只以 `secretId` 形式出现在装配日志里（`SEC-GW-SIGNING`），值不进 `Err`/日志/回执（80-§5.8）。
- **测试与证据**：`F-DAEMON-ENGINE-TEST-TOOLS-EFFECT-GATEWAY`（16 拥有；本卷只登记测试面）。内存记录/权源/围栏 fake + 真 HMAC 内核 + **计数 fake writer**。用例至少：① 同键同效果返回既有回执；② 同键不同效果拒绝且带首次引用；③ 权源/凭据/fence/内核拒绝均使 writer 零调用；④ **平台调用前必有已提交 attempt**；⑤ 同键并发只有一个 attempt、writer 至多一次；⑥ 已有 attempt 无结局不得二次执行；⑦ `void`/排队/缺版本的 writer 应答只能 unknown，不得报 applied；⑧ committed 先落回执再返回；⑨ 回执失败、超时与已发送异常先登记未知；⑩ `registerUnknown` 失败回 `unavailable/STALL/unknown-record-unwritten`；⑪ 意图域缺 `intentRef` 拒 ↔ 非意图域缺省可登记；⑫ 崩溃恢复由 REC-06 将未完成 attempt 转未知并冻结，而非重放；⑬ `partial` 逐项独立 attempt/引用；⑭ `Ok({status:'applied'})` 与 `Ok({status:'unknown'})` 在类型层不可构造。**不证明**真实 store/CAS、跨进程围栏、真实平台回执、物理效果恰好一次或真实对账。V2；V3/V4 未执行。
- **规模 / 迁移**：目标 ≤300 行；测试 ≤420 行。G-3～G-6 设计面已定；先落 `contract` 的 `Result`/`failure`/`effects.ts` 与 store 幂等写，再由 16 实现并做 fake 验证；17 把 `gated-platform` 迁成只做平台调用/回执核验的内部 writer，迁移期冻结旧写口、独占交接、对账迟到结果，**不得**以 `mintControlKey` 再包一层形成双闸双写，也不得先删旧写口。

---

## 五、逐文件契约：测试件（**4 件**，全部 `仅测试`；daemon 侧 EffectGateway 测试件归 16，本节末条只作外部引用）

共同口径：测试只对**源码行为**负责，不对实现细节负责；不得用 LLM 打桩；fake 仅限时钟与固定材料。现有四个文件都不启动进程、不建库、不发网络请求；EffectGateway 的测试面（daemon 侧）见本节末条与 §四，本卷不为其另写文件契约。

### F-gateway-test-wkey · `src/wkey.test.ts`（249 行，20 例）

- **处置**：仅测试，保留。**覆盖**：见 §四 F-gateway-wkey“测试与证据”。
- **fake 边界**：`fakeClock`（可变 epoch ms）、两把固定 32 字节 ASCII secret、固定 nonce、手工用 `createHmac` 重签伪造 token。HMAC 本身是**真实**实现。
- **明确不证明**：跨进程吊销可见性、进程重启后的语义、`Set` 增长、TTL 政策合理性、密钥轮换、时序攻击、模糊输入、超大 token。测试里“secret 卫生”只查构造错与两个返回值的 JSON 串，**不是**全路径无泄漏证明。
- **缺口**：无“同 secret 两个实例互不共享 nonce/吊销”的用例——而这正是当前生产装配的真实形态（`wire.ts:14` 与 `serve.ts:74` 各建一个实例）。目标补这条**负向**用例，用于把 §七 G-8 固定成可回归事实；同批补 `revoke('')`/`revoke('  ')` 必拒（80-§11.1 第 2 条）与“`issue` 同 nonce 可签多张、首张消费后其余全撞 `replay`”的语义钉。
- **规模**：目标 ≤300 行；只增不减证据价值，不加无断言的“演示用例”。

### F-gateway-test-actions · `src/actions.test.ts`（103 行，13 例）

- **处置**：仅测试，保留。**覆盖**：结构化成功、六动词、未知动词、状态推进拒、坏 JSON、非对象、格式残缺/非行首、首行为准、嵌套与数组、CJK 正反、回退标记、坏结构不回退。
- **fake 边界**：无 fake；纯输入输出。
- **明确不证明**：上层 LLM 回退可用、MCP 工具 schema 一致、超长/不可见字符/CRLF 混合、正文体积上限。**不证明**中文自由批示能被正确执行（本件只标记）。
- **规模**：目标 ≤150 行。

### F-gateway-test-signature · `src/signature.test.ts`（45 行，6 例）

- **处置**：仅测试，保留（目标补两类负向：分隔符/换行注入、空白工号）。
- **fake 边界**：无 fake；固定四身份位。
- **明确不证明**：平台渲染与评论尾行拼装、特殊字符安全、身份真实性、等级语义。
- **缺口**：没有“字段含 `·` / `]` / 换行”的用例——这正是 §四 F-gateway-signature 缺陷 1 的回归面。
- **规模**：目标 ≤80 行。

### F-gateway-test-facade · `src/gateway.test.ts`（174 行，13 例）

- **处置**：仅测试，保留；修一处卫生（`Math.random()` nonce → 递增计数器），并补三类目标行为用例：① 构造期坏 `ctx`/坏 `author` 各一例且**断言 nonce 未被消费**（`wkey.test.ts` 之外的第二个回归面）；② `Result` 化后逐码断言 `Err.failure`/`Err.subcause`（14 码逐条，映射表见 §4.0）；③ `Ok({kind:'freeform'})` 不被当鉴权结论、且同 token 仍可复用。
- **fake 边界**：可拨假钟 + 固定 secret；**同一进程同一 Gateway 实例**（因此吊销可见是测试构造的结果，不是跨进程能力）。
- **明确不证明**：MCP/stdio 真实链路、跨进程吊销、并发、`signed.body` 的落库纪律、`gateway: false` 的生产误配、`authority` 未被绕过、`failure` 的处置语义是否被上层正确执行（那是 15/17 的测试面）。
- **规模**：目标 ≤280 行（+20 行为 `Result` 形态与 `failure` 断言）。

### 外部引用 · EffectGateway 测试面（文件归 16：`F-DAEMON-ENGINE-TEST-TOOLS-EFFECT-GATEWAY`；本卷不写文件契约、不计件）

- **处置**：**非本卷文件**——`apps/daemon/test/engine/tools/effect-gateway.test.ts` 的目标-新增处置与 ID 归 16；本卷只登记它与被测件的**同批关系**：与被测件同批落地（同在 daemon 侧），**不得**先于 `contract/src/ports/effects.ts` 与 `Result`/`failure` 落位（G-1；G-2 已关闭）。
- **fake 边界**：内存端口 fake（`RecordWriter`/`RecordReader`/`ReconciliationPort`/`CredentialCatalogPort`/`WriterLeasePort`/`AuthorityGrantPort`）+ **真实**内核 `createGateway`（不 fake HMAC，且注入与生产同形态的共享 `WkeyAuthority`）；关键断言是“fake 平台写被调用 0 次”“未鉴权时不写回执”“未知未登记时不返回 `Ok`”这类结构性证据，而非日志文本。
- **用例**：见 §四 行为契约的 14 条（①～⑭），其中 ⑨“超时 → `Ok({status:'unknown', unknownRef})` 而非 `Err(timeout)`”、⑧“回执写失败 → 先登记再 `Ok(unknown)`”、⑪“登记失败 → `Err(unavailable, STALL)`”是三条最容易写反的负向；⑫/⑬ 是意图域与非意图域的成对断言（缺 `intentRef` 一拒一放），必须成对钉住——只写 `⑫` 会把“所有未知都强制意图链”写成规则。三者共同保证：`unknown` 一定带 `unknownRef`（`REC-EVT-03`），不存在“未知且无对账入口”的返回。
- **明确不证明**：真实 store 事务与 CAS、真实平台回执、跨进程围栏、真实对账、daemon 装配顺序。V2；V3–V6 未执行。
- **规模**：≤380 行。

---

## 六、逐文件契约：配置件（2 现有 + 1 目标）

### F-gateway-manifest · `packages/gateway/package.json`（19 行）

- **处置**：目标-保留；分发面**条件替换**（仅当 gateway 纳入 dist 闭包）。旧路径=同路径。
- **归属**：实现层清单；上位 79-§4.4（两态导出）、79-§6.5（闭包链 `dsh-bridge → contract → gateway → studio-tools`）、79-§5.2（`tsconfig.build.json`）、D75-07。
- **内容（现有）**：`name/version/private/type/description/main/exports/scripts/dependencies`。`dependencies` 仅 `@studio-next/contract: workspace:*` 与 `zod: ^4.0.0`；无 `devDependencies`；无 `types`、无 `files`、无 `publishConfig`、无 build 脚本。
- **职责**：声明包身份、源码态入口、两条包级脚本、两个依赖。**非职责**：不承载版本发布策略（`private` 只表示不发布，不等于“可发布”，79-§6.1）。
- **事实与风险**：
  - `test: vitest run` 依赖根 `vitest`（`package.json` 根 `devDependencies`）而非本包声明；包级单跑的前提是根已装依赖。**未证**：在只安装本包的隔离环境中该脚本的行为。
  - `zod: ^4.0.0` 的实锁为 `4.6.7`（`node_modules/.bun/zod@4.6.7`，79-§十）。本附录不提议改版本；版本与许可归 79 的 `DEP-` 条目。
  - `main`/`exports` 指向 `src/index.ts`：这是**源码态**，只对仓内承诺（79-§4.4）。
- **目标（条件）**：若 `studio-tools` 确认为对外包，则 gateway 作为其依赖闭包必须提供 JS + `.d.ts`：
  - `exports["."]` 改为 `{ types: './dist/index.d.ts', default: './dist/index.js' }`，`main` 同步，增 `files: ["dist"]`；
  - 保留 `typecheck` 脚本；新增 `build` 脚本属**构建面**，其脚本形态与门禁顺序归 19/79，不在本附录写命令；
  - 同一单内：根 `tsconfig.json` 把 `packages/gateway/src/**` 移出 `include`，根 `typecheck` 显式串接本包 `tsc --noEmit -p packages/gateway/tsconfig.json`（79-§4.4）。
  - **不得**引入 `paths` 回指 `src`，**不得**引入 project references（79-§4.4 末）。
  - 若 `studio-tools` 不对外，则本件**不做任何改动**（79-§6.5 明确这是连带结果）。
- **规模 / 迁移**：字段只增条件项（`types`/`files`），依赖与脚本语义不变；迁移是包级原子动作，必须先有 dist 产物与 `--listFiles` 拓扑证据，再改 `exports`。

### F-gateway-tsconfig · `packages/gateway/tsconfig.json`（5 行）

- **处置**：目标-保留。旧路径=同路径。
- **内容（现有）**：`extends ../../tsconfig.base.json`；`include: ["src/**/*.ts"]`；无 `exclude`、无覆盖项。
- **归属**：实现层类型门禁；上位 79-§4.4、`tsconfig.base.json`（strict 全开、`erasableSyntaxOnly`、`verbatimModuleSyntax`、`isolatedModules`、`allowImportingTsExtensions`、`noEmit`、`types:["node"]`）。
- **职责**：让本包可单独 `tsc --noEmit -p` 检查。**非职责**：不发射产物（`noEmit: true` 继承自 base）；不做路径映射；不引入 DOM。
- **事实**：当前根 `tsconfig.json:4` 的 `include: ["packages/*/src/**/*.ts"]` 已覆盖本包，故**当下**根门禁与包级门禁检查同一份源码（双重检查，非双身份）。切换 dist 后必须让本包退出根 program，否则 `src` 与 `dist` 两类身份并存（79-§4.4 禁止）。
- **目标**：切换 dist 时本文件保持 `include: ["src/**/*.ts"]` **不变**（源码类型检查不随分发形态消失）；变化只在根 program 与根脚本（归 19）。
- **测试 / 证据**：N/A（配置件）；其有效性只能由 `tsc --noEmit -p` 退出码证明，本次**未执行**。

### F-gateway-tsconfig-build · `packages/gateway/tsconfig.build.json`（目标-新增，条件件）

- **处置**：目标-新增；**仅当** gateway 纳入 dist 闭包时创建。当前不创建。
- **归属**：实现层构建配置；上位 79-§5.2（逐键覆盖清单）、79-§6.5（闭包顺序）、D75-07（独立 `tsc` 发射，非 `bun build --compile`）。
- **职责**：从 `tsconfig.base.json` 继承并覆盖为“可发射”：显式 `noEmit:false`、产物目录、`rootDir` 指向 `src`、`declaration:true`、声明与源码同构、`include` 限 `src/**/*.ts`（排除测试）、不携带 `declarationMap`（不随包发 `src` 时无意义，79-§5.4）。**非职责**：不改模块系统（NodeNext 保持）、不做后处理改写 `.d.ts` 里的 `.ts` 说明符（U1 未证，见 79-§5.5 末；默认不做）。
- **依赖与边界**：只允许解析 `contract` 的 `dist/*.d.ts`；`--listFiles` 不得出现本包之外的 workspace 源码（79-§5.6 拓扑断言）。**不得**用 `paths` 把依赖引回 `src`。
- **错误 / 观测**：构建失败即“未切换”，不得以退出码 0 单独作为产物正确证据（79-§5.4 的三个陷阱；§5.6 的五条判据须同时成立）。
- **测试 / 证据**：构建闸的指纹与 `--listFiles` 断言、`dist/index.d.ts` 可被消费者 `tsc` 解析、`dist` 与 `src` 同构——全部**未执行**，属 82 的构建验证。
- **规模 / 迁移**：单文件，仅配置键。迁移顺序：`contract` 先切 → gateway 再切（79-§6.5 的闭包链），同单改 `exports`/根 program/根脚本。

---

## 七、缺口、未证与需回写（不自造补洞）

> G 编号：G-1…G-14（v0.5 未新增编号）。**G-1、G-3、G-4 阻塞实现**（G-2 已关闭）；G-5～G-7 阻塞 `EffectGateway` 的完整语义；G-8 的**跨进程**半个、G-9 阻塞跨进程与身份正确性；其余为政策项、实现内缺陷、未证与跨卷漂移。

### G-1 错误两轴的落地前提与 `gw-* → failure` 映射（回写 80-§5.7，连带 01-contract G-16）

〔事实〕`contract` 的 `ClassifiedError` 只有 `category/subcause/detail`（`ports/kernel.ts:98-102`），**无 `failure`**；全仓 `packages/contract/src` **无 `Result` 定义**（`grep` 只命中 `ResultStats`）；`configInvalid` 只设 `category='CONFIG_INVALID'`（`schemas/errors.ts:54-60`）。80-§5.7 已给两轴、14 类处置表、缺省 `category` 表与“拒绝通道五条”，但**没有**逐条覆盖网关的 13 个运行码（7 `gw-verify-*` + 5 `gw-action-*` + `gw-action-mismatch`）与 8 个构造子码。

〔事实〕§4.0 的映射表是**本附录的建议值**：其中 7 个 verify 码与 `gw-action-unknown-verb` 落 `EXTERNAL_REJECT`（与现状 `gated-platform.ts:104` 一致），但 5 个 action 码按 80 缺省落 `CONFIG_INVALID`（与现状不一致）——二者只能择一。

〔需回写〕80-§5.7：① 给“运行期请求形状错”一个明确归属（新增覆盖行，或确认落 `CONFIG_INVALID` 并说明事件 note 口径变化）；② 逐行给出这 13 个码的 `failure`（或明确“由实现附录定、80 只冻结 `FailureClass` 词表”，现状是两种读法都成立）；③ 构造期 8 个子码的 `failure` 统一为 `rejected_precondition` 是否要写进 §5.7 表（`configInvalid` 已固定，但 `gw-signature-*` 走同一函数）。01-contract：承接 `Result` 与 `ClassifiedError.failure` 的类型增补（其 G-16 已登记）。**时序**：`Result` 化与 `contract` 加字段必须同单，不得先改 `gateway`。

### G-2 **已关闭**：`EffectGateway` 的类型与实现落点（80-§6.9 `:2259` 已定；文件 ID 归 16）

〔已定〕80-§6.9 `:2259` 的 EFF-01 行点名：类型落 `contract/src/ports/effects.ts`，实现落点是 **`gateway`（验签/动作/署名内核）+ `engine/tools/effect-gateway.ts`（权源解析、effect 分类、fence 注入、未知对账）**，并注明“不改 `gateway` 包层位；外层编排在 engine/tools”。这与 80-§2.3 `:129`“gateway 升级为 `EffectGateway` 的可信内核”一致——**本包不含 `EffectGateway` 文件，也不另造第二实现**。

〔本附录的对应处置（v0.6）〕该文件的**唯一 ID 是 16 的 `F-DAEMON-ENGINE-TOOLS-EFFECT-GATEWAY`**（测试件 `F-DAEMON-ENGINE-TEST-TOOLS-EFFECT-GATEWAY`，16-§4.12 已有完整条目）；本卷**不用** `F-gateway-effect`/`F-gateway-test-effect` 指该路径，不列件、不计数，§四 只保留行为契约（流水线/错误/证据/测试面）。包内计数因此回到 **12 件**（§三 结论、§十 已同步）。**不再需要回写 80**。

### G-3 `EffectDescriptor`/`EffectTarget` 字段已闭合（原缺口已关闭）

〔已关闭（设计面）〕80-§4.3.1 已定义 `EffectDescriptor{action,args,effectClass,origin,partialItems?}` 与 `EffectTarget{bindingRef,objectRef?,workRef?}`。`EffectAction = GatewayAction | ControlEffectAction` 的九个控制效果与 `GATED_WRITE_METHODS` 对齐，授权范围可逐动作判断，不再只有 `comment`。80-§6.6 另规定 `EffectOutcome` 两分支必带引用。当前只剩 `contract/src/ports/effects.ts` 与实现未落地，不是字段缺口。

### G-4 凭据与正文来源已闭合（原缺口已关闭）

〔已关闭（设计面）〕`EffectRequest` 只携带逻辑 `credentialRef` 与结构化 `args`，不要求也不允许内嵌 token 或 `@action` 正文。daemon 的 `EffectCredentialBroker.forCall` 负责解析活跃签发或按 action/target/origin 现签一次性凭据；`packages/gateway/src/actions.ts` 负责唯一编码。`WkeyClaims.scope` 同时含 `EffectAction` 与实际 `gatewayAction`，两层不符即拒。token 只在 daemon 内存，不能进入请求、帧、日志或记录。当前只剩实现未做。

### G-5 `partial` 的结构化清单已闭合（原缺口已关闭）

〔已关闭（设计面）〕`EffectError = ClassifiedError & { partialItems?: readonly EffectPartialItem[] }`，`failure='partial'` 时逐项携带 `key/status/receiptRef?/unknownRef?/error?`。`applied` 必带 `receiptRef`、`unknown` 必带 `unknownRef`、`failed` 必带 `ClassifiedError`，缺项则整体 `unavailable` 对账。`partial` 与 `unknown` 不混用，不再需要把清单塞进 `detail` 字符串。

### G-6 “回执先查”的索引已闭合（原缺口已关闭）

〔已关闭（设计面）〕80-§6.3 `RecordQuery` 已含 `idempotencyKey?: string`，只做精确索引查重，不是模糊过滤或第二幂等键。`RecordReader.query` 与只读视图都按该键查；`GET /v1/requests/status` 另以公司/来源/类型/`ticket ?? dedupKey` 查询当前投影，不把它当回执重放入口。当前只剩实现未做。

### G-7 出站脱敏的迁移与调用点（`KnownSecretSet` 增量面已由 80-§11.2.1 裁定，回写 80-§11.2，连带 19）

〔事实〕80-§11.2 第 3 条 + D16 **已定**：整个 `secrets` 模块迁 `contract`（三函数 + 三正则 + `REDACT_MARK`/`MIN_KNOWN_LENGTH`），`core` 只做具名 re-export，`api`/`panel`/`gateway`/`studio-tools` 经 `contract` 复用，**禁止** `gateway→core`/`api→core` 新边。前稿把它写成“三选一未决”是对 80 的误读，v0.2 已改正——依赖边冲突的解法就是“迁 contract”，不是新增边。

〔事实〕现状 `redactOutbound` 仍在 `packages/core/src/secrets.ts`；gateway 不 import 任何脱敏；`KnownSecretSet` 与 `SEC-WKEY-<ticketId>` 无代码落位。

〔边界（已定，不是开放项）〕`KnownSecretSet` 的**装配与重建归 daemon**：80-§11.2.1 明写它由装配期用 `SecretMaterial[]` 生成、运行期**只读**；per-ticket wkey 活跃期进集合、`CLOSE` 移除并留 24h 去重窗；轮换/吊销变化时**整体重建**，不设增量 API。故接口里没有登记/移除方法、字段全 `readonly`，正是设计意图——可变面只存在于 daemon 的装配期，不在 `contract`，也不在本包。**gateway 不持集合、不拿 catalog 全量秘密、不自建第二秘密集**：它只在**出站文本**处调 `contract` 的 `redactOutbound(text, knowns)`，已知值数组由调用方（daemon 装配面）注入；不读 `SecretProvider`、不缓存值。（此前“两种读法 / 80 未裁决”的表述作废。）

〔需回写〕80：① 迁移落位与顺序（`contract` 先落 → `core` 改 re-export → 全仓 import 归口）；② `EffectGateway` 在哪个出口调用脱敏（回执 note / 错误 `detail` / 通知），入站 token 不脱敏；③ `SEC-GW-SIGNING.allowedUses` 必须含 `gateway-sign` **与** `outbound-redaction`（80 未明写后者，但 `gatewaySecret` 属“已知值”，脱敏集合必须能挡它）。19：迁移后的出站九处强制点纳入扫描清单。**`KnownSecretSet` 的增量面不再列为回写**——80-§11.2.1 已定归属与重建方式，本附录不代定，不新增边。

### G-8 重放 nonce 与吊销集合：进程内共享已定，持久化端口仍缺（回写 80，连带 77）

〔事实〕`seenNonces`/`revokedTickets` 仅在内存（`wkey.ts:118-119`，头注 `:19` 自述“拟稿：生产换 store”）；`createGateway` 每次新建 authority（`gateway.ts:65`），因此 engine 签发、stdio 验签、关单吊销各持一套集合，互不可见；`worker-key.ts:42-46` 已把“跨进程吊销不可见”作为疑点上报；`serve.ts` 与 `wire.ts` 各建一个 `CONTROL_TICKET` 实例。后果：① 重启后已吊销但未过期的 token 复活；② 同 secret 的不同实例各自允许同一 token 一次；③ `seenNonces` 随每次写增长，无清理。

〔已定（v0.5，80-§11.4.1 第 6 条）〕**进程内只持一个 `WkeyAuthority`**：daemon 装配期造一个（可注入 clock/store），`createGateway` 接受已构造的 authority，stdio 验签、engine 签发、关单吊销都走同一实例。这一半**不再是缺口**，是目标形态（本包侧改动见 §四 F-gateway-facade 的 `authority?` 与 F-gateway-wkey 的“进程内共享”条）。**未实现**。

〔仍开放〕跨进程/多机：nonce 与吊销集必须落**共享 store**，端口本身 80 未定义；80-§11.1 第 4 条只要求“存储与 clock 可注入，缺省内存 + 墙钟仅单进程开发可用”。`REC-AUTH-04.revocation_state`（“已吊销”必须可核）与 `BIND-EFF-01` E2 闸门真实性仍以此为前置。

〔需回写〕80：定义重放/吊销持久化端口（语义至少：`(ticket, nonce)` insert-if-absent、按 `exp` 清理、注入方、失败时 fail-closed）；77：明确 `revocation_state=未知` 时写路径必须拒（当前无此概念）。**不得**在 gateway 直接 import store。

### G-9 署名主体语义与 80-§11.1 的三处字段漂移（回写 76/77/80）

〔事实〕`SignedBody.author` 是 `PersonId`（`ports/kernel.ts:9` 为裸 `string`），生产注入 `'daemon'`（`engine.ts:504` 的 `ENGINE_CONFIG_DEFAULTS.actor`，经 `serve.ts:784-791` 的 `daemonIdentity` 进入 `createGateway`）；落款 `role` 也是字面量 `'daemon'`、`dept` 是部门路径。`REC-EVT-01.actor_ref` 要求“实际主体，不得只写工具名”（77-§2.6），服务身份与自然人共用同一字段，且不绑定 `REC-AUTH-04.bound_grant`。

〔已关闭（设计面）〕80-§11.1 已改为：`nonce` 归逐次签发，构造期只校验 `ctx`/`author`/秘密边界；`revoke(ticket)` 而非 `keyId`；`WkeyClaims.author` 为必填授权身份，`EffectCredentialBroker` 从当前激活/授予解析，服务主体以 `SignatureContext.actingCapacity='service'` 表达，不能用 `'daemon'` 作为无授权通用身份或绕过 `REC-AUTH-04.bound_grant`。`RecordEnvelope.actor.actingCapacity` 已可区分服务与任职，不必再新增 `actor_kind`。现状的裸 `author='daemon'` 与未绑定授权是**实现缺口**，不是上位概念缺失。

### G-10 控制面九写面已改为显式效果（原缺口已关闭）

〔已关闭（设计面）〕80-§4.3.1 的 `ControlEffectAction` 覆盖 `issues.create`/`issues.transition`/`issues.setField`/`comments.add`/`fields.provision`/`kb.upsert`/`links.link`/`guards.install`/`guards.uninstall` 九个高层效果，与 `GATED_WRITE_METHODS` 对齐。`EffectDescriptor.action` 使用 `EffectAction`，`packages/gateway/src/actions.ts` 唯一映射到实际 `@action`；`WkeyClaims.scope` 同时包含 `EffectAction` 与映射后的 `gatewayAction`，不能只凭 `comment` 获得控制写。`GATEWAY_ACTIONS` 现有六动词没有被假称为已扩，控制效果另立目标词表。当前只剩实现与迁移未做。

### G-11 待制作人批示的定值（不是技术空白）

`index.ts:14-18` 五项：nonce 单次有效 vs MCP 复用窗口；ttl 格式与 secret 门限（现为 `>=32B`）是否定稿；级别展示形态（数字 vs `L` 前缀）；中文短路与“先 verify 后 parse”的任务书字面偏差；`CONTROL_TICKET='__control__'` 命名。另有三项由本附录核对新增：TTL 政策上限、`author` 是否允许服务身份、`revoke('')` 是拒还是“撤全部”（80-§11.1 第 2 条已定“拒”，故这条已**不是**开放项——只待实现）。**这些是政策选择，不得由本附录代决，也不得当成“技术待补”。**

### G-12 实现内缺陷（不是上位缺口，随实现单修）

1. `wkey.ts:10` 写“八种拒绝码”，实为 7 种。
2. `gateway.ts:7-8` 声称构造期拦“坏署名上下文”，实际未校验；`signedBody` 在 nonce 消费后才抛。
3. `signature.ts:36-40` 只拒空串，不拒分隔符/换行注入。
4. `gateway.test.ts:70` 用 `Math.random()` 造 nonce（80-§8.6 禁止）。
5. `wkey.ts:175` 的 `revoke('')` 不设防（`createGateway` 拦空单号，但直接调 authority 可写入空串）；80-§11.1 第 2 条要求空串/纯空白/非字符串一律 `Err(rejected_precondition)`。
6. `issueControlKey` 的 nonce 熵源不可注入（`wkey.ts:191` 的 `randomUUID()`），控制 key 无法确定性测试。
7. token payload 无 `iat`：无法审计签发时刻，也无法按 `exp` 清理 nonce（`wkey.ts:71-77`）。
8. `Gateway.issue`/`revoke` 不受实例 `ticket` 约束（`gateway.ts:69-71`）：按单实例可签/吊销他单凭据。
9. nonce 存储未注入（80-§11.1 第 4 条）；`seenNonces` 是闭包内 `Set`，不可替换。
10. `level` 无上界：`1e21` 通过 `Number.isInteger` 并渲染为 `1e+21`（`signature.ts:40`）。
11. `author` 只拒空串不拒空白（`signature.ts:32`），与 80-§11.1 第 2 条对 `revoke` 的“纯空白”口径不一致。

### G-13 明确未证（不得写成支持）

- 跨进程/跨实例吊销与新实例重放；重启后的吊销语义；`Set` 增长对长跑 daemon 的影响（对应 **U80-04** 跨进程写者围栏，未证）。**进程内共享 authority 也未实现**（`createGateway` 仍每次新建，`gateway.ts:65`）。
- `verifySealed` / `consumeNonce:false` **不存在**：注册路径目前只能用会烧 nonce 的 `verify`，因此“注册后还能写”这条断言无实现可测（80-§11.4.1 第 4/7 条，U80-17）。
- 脱敏迁移未执行（`redactOutbound` 仍在 `core`）；`KnownSecretSet`/`SEC-WKEY-<ticketId>` 无落位；`contract/src/ports/secret.ts` 不存在（**U80-18**）。
- 凭据主体绑定、`iat`、签发/吊销的实例票约束均无实现；补 `iat` 须升 payload `v`（§8.1）。
- `timingSafeEqual` 之外的整体时序（token 形状早退路径存在长度侧信道：非法长度比合法 token 更快返回；是否可接受未评估）。
- 真实 MCP stdio 链路：stdio 版工具服务、challenge-proof 四类帧与 `call`/`verdict`、daemon 侧保留 per-ticket wkey、按动作现签内部 key **均未实现**；worker 侧验签边界未证（**U80-17**）；`_meta['studio-wkey']` 只是 legacy 路径（`server.ts:92-97`）。**真机探针全部未跑**：socket 目录 `0700`/文件 `0600`、宿主注入的 `PeerCredentialVerifier` 与 `peer-verified` 判定（对端 uid **只**由该适配给出；Node 24 **无**内建 `getpeereid`/`SO_PEERCRED`，不得写成直接调用；无已验证适配即 `unverified`）、stdout 纯净性、challenge 过期与 ack 丢失重连。
- 真实 YouTrack/Taiga 写入经网关后的回执与幂等（无 `EffectGateway`、无回执；`REC-EVT-03` 的 `intentRef` 面亦未证，**U80-15**）。
- 意图通道与 `:8788` 迁移（**U80-15**）；迁移期的并发 DDL（**U80-16**）虽不属本包，但 `EffectGateway` 的回执写入依赖其只读/独占窗口决定。
- 构建切换（无 dist、无 `--listFiles` 证据）；非 TS 消费者对 `.d.ts` 的 `.ts` 说明符兼容（**U80-02**）。
- 任何 V3/V4/V5/V6 层验证。

### G-14 跨卷漂移登记（不在本附录修）

| 漂移 | 位置 | 现状 | 应回改到 |
|---|---|---|---|
| `EffectOutcome` 形状 | 80-§5.2 `:716-717` vs §6.6 `:1655` | **已一致（v0.5 复核，v0.6 重核锚点）**：两处都是 `applied{receiptRef:Qid}` 与 `unknown{unknownRef:Qid; reason?}` 二选一 | 无需回改；v0.4 及以前登记的“`§5.2` 带 `reason:string`”“两处都缺 `unknownRef`”两条作废 |
| 回执查询面 | `docs/81-files/14-api.md:247` 的“缺口-API-01” | M2 预留键但查询面未挂载 | 与本卷 G-6 同源，应在 80-§6.3 一次解决 |
| `assembleApi` 签名 | `docs/81-files/17-...:186/715`（v0.2） | 已与 80-§9.4 对齐（只收 `ingress` 的 `submit`/`receipt`，不收 `engine`） | **已对齐**，本附录仅确认，不重复登记为漂移 |

〔结论〕以上三行中只有第 2 行仍需回改（经 G-6）；第 1 行已核实一致、第 3 行早已对齐，登记在此是为了**不让本附录引用一个已被改掉的旧签名**。

〔已关闭（v0.4）〕原登记的 **`openLedgerReadOnly`（`Only` 大写）拼写**项作废：`03-store` 现已在 `:701` 把“函数名 `openLedgerReadonly`（小写 d）+ 对象入参 `ReadOnlyLedgerOpen`、类型名 `ReadOnlyLedgerOpen`/`ReadOnlyLedger`（大写 O）”写成明文规则，不再有把函数写成 `openLedgerReadOnly` 的定义处。`grep -rn "openLedgerReadOnly" docs/` 的剩余命中全部是“禁用 / 整改指令 / 对 17 的过期指控”语境（`04-company:1048/1110/1152`、`13-panel:85`、`17:2017` 自述已过期），归 04/13/17 owner 处置，本包不再登记。

---

## 八、专项回答：凭据 / 署名 / 脱敏 / 错误 / nonce / 工具面 / 回执对账

**跨件四条**：

- **写收口**：daemon 侧九写面已包（`gated-platform.ts`），读面直通不触闸。命令面 `cli/external.ts` 过闸但用固定 `DEV_GATEWAY_SECRET`；`panel/external` 直写平台/台账（80-§9.4 五步迁移、§11.2 末）。网关的“teeth”依赖这两处收敛；本附录只登记，不处置（归 13/14/17）。
- **未知回执**：`gateWrite` 的 `Ok({kind:'allowed'})` 只表示“放行”，不表示外部已写。回执、幂等键、未知登记与对账全部归 `EffectGateway`（80-§8.4、77-§2.4/§2.8）；未知未消解前不得宣称成功、不得重派（`Ok({status:'unknown', unknownRef})` 不是“完成”）。**两分支都必填引用**（80-§5.2）：`applied.receiptRef` → `REC-RCP-01`、`unknown.unknownRef` → `REC-EVT-03`；先落记录再 `Ok`，登记失败即 `Err(unavailable, STALL, unknown-record-unwritten)`。缺失 / 迟到 / 冲突三情形的证据与路径见 §8.7。
- **动作词与授权分离**：六动词全是 worker 面，状态推进永不在表内（18-§二.3）；`scope` 是允许动作的上限，不是授权；有 `comment` 不等于有权评论（80-§11.1）。控制面九写面借道 `comment` 属 G-10。**编解码只有一份**：`parseAction`/`encodeAction` 都在本包（`actions.ts`），stdio/HTTP 两面都调它（80-§11.4.1 第 4 条）。
- **秘密不出境**：worker 永不持 `gatewaySecret`；工具面只收 per-ticket wkey（§8.6）。**帧里只允许 `wkeyRef` 这一个秘密相关引用**——不是 wkey 原文，也不是任何 `SEC-*` 的值；判据是**原值**，不是“帧里出现 `SEC-` 字样”。

### 8.1 凭据：wkey 是 bearer 技术边界，不是能力证明

| 维度 | 现状 | 证据 |
|---|---|---|
| 形态 | `base64url(payload).base64url(HMAC-SHA256)`；payload 是**明文 JSON**（ticket/scope/exp/nonce），无 `iat`、无主体、无授予引用 | `wkey.ts:5-8,129-131` |
| 类别 / 引用 | 无 `credential_class`、无 `logical_reference`；token 自身即值 | 77-§3.4 |
| 绑定授予 | 无 `bound_grant`；`scope` 只是“允许动作上限” | 80-§11.1 |
| 有效期 | 只有到期 `exp`，无签发时刻；TTL 仅签发输入（worker 缺省 24h、控制面 15m、无政策上限） | `wkey.ts:7-9,60-61,83-92`；`worker-key.ts:65` |
| 吊销态 | 只有“有效/已吊销”两态（内存 Set）；缺 已轮换 / 过期（作为状态）/ 未知 | `wkey.ts:118-119` |
| 主体绑定 | 无。持有者皆可用（bearer），不绑定 worker/agent/进程 | `wkey.ts:71-77` |
| 知悉范围 | 无 `exposure_scope`；env 注入 + 红名单在 daemon 侧 | `worker-key.ts:22-24,62` |
| 签发 / 吊销面 | `Gateway.issue`/`revoke` **不受实例 `ticket` 约束**；实例绑定只作用于 `verify` | `gateway.ts:69-71` |
| 生产实例 | `wire.ts:14` 的控制面实例签发并验证 control key（同实例闭环）；`serve.ts:74` 实例只签发/吊销 worker key，**永不验 worker key**；per-ticket 验签实例未接 | `serve.ts:74`、`wire.ts:14`；`worker-key.ts` 头注 |
| 秘密来源 | 现状：`DEV_GATEWAY_SECRET`（仓库内公开缺省）/ `serve.ts` 的 `gatewaySecret`；**目标**：`SEC-GW-SIGNING`（`SecretCatalogEntry`，`kind='hmac'`，`allowedUses` 必含 `gateway-sign` **与** `outbound-redaction`）经 `SecretProvider.load` 取得，本包只收注入值 | 80-§11.2-5、§11.2.1；`serve.ts:411` |

〔结论〕对照 `REC-AUTH-04` 七字段，网关现只覆盖 `permitted_operations`（且只是上限）与 `valid_window` 的一半（只有 exp）；`bound_grant`/`exposure_scope`/`credential_class`/`logical_reference` 全缺，`revocation_state` 只有两态。凭据 ≠ 授权不变；权源解析与授予校验归 `EffectGateway`（80-§6.6 后置）。

〔目标 / 未证 / 回写〕构造期补 `ctx`/`author` 校验（80-§11.1 第 1 条，`nonce` 一项见 G-9 的字段漂移）；token 加 `iat` 须升 payload `v` 走批示，不得在 `v:1` 私加字段；跨进程吊销与签发/验签分实例见 **G-8、G-9**；`SEC-GW-SIGNING` 的 `allowedUses` 缺 `outbound-redaction` 会让 `gatewaySecret` 无法进脱敏集合（G-7）。

### 8.2 署名：展示落款，不是 76-§1.5.2 的签名结构

〔现状〕`[公司·部门·岗位·级别]`，中点 U+00B7；生产注入 `{company: snapshot.name, dept: departments[0]?.path ?? 'departments/工程部', role: 'daemon', level: Math.max(1, snapshot.level)}`、`author: 'daemon'`（`serve.ts:784-791`）；`ctx` 是 L1 热重载活对象，逐调用读取；`body` = payload 原文，不改写、不截断、不归一化。

〔对照〕76-§1.5.2 的签名结构要求 `scheme`/`keyRef`/`signerRef`/`signedDigestRef`/`scope`/`createdAt`/`verificationState`/`value` 八项——本落款与其中**任何一项**无对应，不含密钥材料，也不覆盖任何摘要。77-§2.6 要求 `actor_ref` 是“实际主体，不得只写工具名”，但生产事件侧 actor 是 `'daemon'`；自然人/岗位身份只存在于落款文本，无法机器读取。任何把 `signed` 当“已验收/已授权”的读法都是越级；`Ok({kind:'allowed'})` 里的 `signed` 同样不能当回执。

〔缺陷（实现内）〕① 只拒空串：纯空白、含 `·`/`[`/`]`/换行均通过；② `level` 只查 `Number.isInteger && >=1`，`1e21` 与 `2**53` 均通过并经 `String()` 渲染成 `1e+21` / `9007199254740992`；③ 无上界；④ 生产 `role` 是字面量 `'daemon'`，与服务身份混同；⑤ `dept` 生产用路径、测试用名称，口径未定；⑥ 构造期快照 + 热重载 mutate，署名为“写入时读到的组织位”，不是写入时刻的人事档案核验；⑦ 80-§5.8 要求的“署名工号/落款来自 daemon 侧身份入参、调用方不得自带 author”在 `gated-platform.ts:31` 注释成立，但**类型上** `signedBody(ctx, author, body)` 是公开导出、可被任意调用方自带 author——本件不擅自收窄（会破 `materialize.ts:35`），只登记。

〔目标 / 回写〕本件补分隔符/换行/空白/上界拒绝（实现内约束）；身份分型与 `actor_ref` 见 **G-9**，不在本附录新增身份类型。

### 8.3 脱敏：放置已由 80 决定，缺的是迁移与调用点

〔上位（已定，不是三选一）〕80-§11.2 第 3 条 + D16：整个 `secrets` 模块迁 `contract`——`redactOutbound`/`redactKnownSecrets`/`findSecretShaped`、三正则、`REDACT_MARK`、`MIN_KNOWN_LENGTH` 一并搬家；`core` 只做具名 re-export；`api`/`panel`/`gateway`/`studio-tools` 一律经 `contract` 复用；**禁止**新增 `gateway→core`、`api→core` 边。前稿把它写成“三选一未决”是误读，v0.2 已改正（见 **G-7**）。

〔现状〕三个函数仍在 `packages/core/src/secrets.ts`；gateway 不 import 任何脱敏；`KnownSecretSet` 只有语义（80-§11.2.1、78-§7.4.1），代码无落位；`SEC-WKEY-<ticketId>` 的“活跃期登记 / `CLOSE` 移除”无实现（**语义已定、实现归 daemon 装配面**，见 G-7 边界）；`redactOutbound` 当前只在 hr-sync 装配调用（`assembly/hrsync/assemble.ts:59`）。

〔三条边界〕
1. **入站不脱敏**：`token` 与 payload 是校验对象，先验签后谈脱敏（80-§11.2 第 4 条）——先替换会把合法凭据改成 `<redacted:N>`，验签永远失败。
2. **出站才脱敏**：事件 note、日志、通知、对外 API、HR 同步、REPORT、导出物（80-§11.2.1 的九处强制点）。网关自身不落盘、不打日志，故“网关日志泄密”面为零；但 `Ok.kind==='allowed'` 里的 `signed.body` 是原文，调用方整包写日志即泄漏。
3. **凭据值自身入 known set**：per-ticket wkey 活跃期进 `KnownSecretSet`（`SEC-WKEY-<ticketId>`，`valueProvider={type:'local-mint',ticketId}` 的**唯一例外项**），`CLOSE` 移除并留一个去重窗兜底；`gatewaySecret`（`SEC-GW-SIGNING`）永不进 worker、不随 `TaskBrief.credentials` 下发（80-§11.4.1）。

〔目标 / 回写〕`EffectGateway` 只在**出站文本**（回执 note、错误 `detail`、通知）调用 `contract` 的 `redactOutbound`；不脱敏入站；不自建第二套正则；不把 `<redacted:N>` 当“已安全”的证明；`find → redact → 出站` 顺序固定，未跑扫描不得出站。迁移顺序与调用点见 **G-7**（回写 80/19）。

### 8.4 错误：从“只有码”到“两个轴 + 一个拒绝通道”

〔现状〕两级：构造期 `throw configInvalid`（`category=CONFIG_INVALID`、`subcause=gw-*`，8 个子码）；运行期判别联合（14 值 = 7 `gw-verify-*` + 5 `gw-action-*` + `gw-action-mismatch` + `gw-freeform-chinese`），无文案、无事件、无计数。**运行期拒绝走的是 `{allowed:false, reason}`**——即“拒绝塞进成功返回值”。

〔对照（80-§5.7）〕① 预期拒绝必须走 `Result<T, ClassifiedError>` 的 `Err`；② `Err` 必须带 `failure`（处置轴）与 `category`（观测轴），`Err` 可达 `category` 只有 6 个；③ `configInvalid` 固定 `rejected_precondition` + `CONFIG_INVALID`；④ “结论/信号”可留 `Ok`，但不得给拒绝开“成功包装”。网关的 `GateWriteResult` 被 80-§5.7 直接举为 `Result` 形态的例子，故**必须改**；映射见 §4.0。

〔对照 77-§11.1 的六件套〕每个失败要带：类别、可否重试、是否可能已有副作用、对账入口、证据引用、责任位置。网关能直接给出的只有“类别 + 子因”；`retryable`/`side_effect_possible` 由 `failure` 经 77-§11.1 表推出（不另存字段），对账入口与证据引用归 `EffectGateway` 的回执/未知登记，责任位置归调用方（15/17）。**现状**：`studio-tools` 的 `GATE_DENY_HINTS` 只给人读文案，机器侧只有码。

〔缺口〕`contract` 的 `ClassifiedError` 仍无 `failure` 字段（14 值形状已定，01-contract G-16 只关了这一半）——网关即使想按 80 返回也**没有承载字段**（**G-1**）。

〔顺序即信息面〕① 自由中文短路在 verify **之前**：不经任何鉴权即返回回退标记，不烧 nonce、不产生拒绝事件——它是路由信号，不得当鉴权结论；② 结构化路径 verify 成功即烧 nonce，`gw-action-*`/`gw-action-mismatch` 都发生在烧之后（`gateway.test.ts:98-104`）；③ `ctx`/`author` 未在构造期验，坏值要等 nonce 烧后才抛 `CONFIG_INVALID`（最坏时序，目标已前移）；④ 拒绝码不回声输入，`configInvalid` 只报长度/字段类别/level 数值。

〔目标〕构造期补齐（80-§11.1 第 1 条）；运行码→`failure` 的映射按 §4.0（**待 80 回写**，G-1）；错误载体只回 `failure`/`category`/`subcause` + 字段名，不含 token/nonce/secret/绝对路径（80-§5.8）。

### 8.5 nonce：单次有效是“进程内、全局、不可清理”的单次

〔现状〕每个 authority 一个全局 `Set<string>`（不按 ticket/action 分区）；只有 verify **完整成功**才 `add`；集合不存 exp，无清理、无上限；重启清空；同 secret 的多个实例互不可见。

〔语义交互〕freeform 不烧；verify 全过才烧；parse/`mismatch` 失败烧；控制面一写一签（`issueControlKey` 的 nonce 是 `randomUUID`，**不可注入**）；worker 一 attempt 一签（`makeNonce` 可注入，缺省 `randomUUID`）；`issue` 不查重——nonce 由调用方给，同 nonce 可签多张 token，第一张用过即令其余全撞 `replay`（拒绝服务面，不是绕过面）。

〔与 80-§11.1 第 3/4 条对照〕“先校验后消费 nonce”：现状已满足（8 步顺序，失败不 `add`）；“nonce 存储与 clock 必须可注入”：`clock` 已注入，**存储未注入**；跨进程防重不得依赖进程内 `Set`，当前正是。

〔风险〕① 重启后 exp 内可重放（worker 缺省 24h；无 TTL 政策上限时窗口可更长）；② 已消费 nonce 永不释放，长跑 daemon 内存单调增长；③ token 内 nonce 明文可读，日志里贴 token 等于贴 nonce；④ 跨实例同 token 各成功一次。

〔目标 / 回写〕**G-8**：端口语义至少 `(ticket, nonce)` insert-if-absent + 按 `exp` 清理 + fail-closed + 不 import store；端口形状由 80 定，本附录不私建。

### 8.6 工具面：stdio 只是传输层，验签在 daemon（80-§11.4.1 / U80-17）

〔事实〕`studio-tools` 现状只有进程内 `InMemoryTransport`（`server.test.ts:15`），**无 stdio 实现**；wkey 经 `initialize` 的 `_meta['studio-wkey']` 或宿主直注（`server.ts:92-97`）；daemon 无 stdio 入口装配（`serve.ts:43` 自述欠此件）。本包与工具面的接口只有两个：`createGateway` 造出的 `Gateway` 实例（注入 `createStudioToolsServer`）与 `actions.ts` 的编解码（`parseAction`/`encodeAction`）。

〔现状（事实，不是目标）〕**当前 `verify` 一次成功即烧 nonce**（`wkey.ts:169-171`），且同 token 二次必 `replay`——这就是“wkey 只过一次闸”的现状；MCP 侧复用同一 wkey 多次调工具会撞重放，属**已知缺口**，写在 `wkey.ts:11-14` 的头注里，不是“已解决”。因此工具面现状只能“一调用一签发”，注册/复用都还没有可用的不消费验签入口。

〔目标边界（照 80-§11.4.1 与 15 的同一协议；本附录只登记接缝，**不复制协议**）〕
1. **worker 永不持 `gatewaySecret`**：全局 secret 发给 worker 等于把整仓写权发出去，且不能按单吊销。worker 只收 per-ticket wkey 与范围（`ticketId`/`companyId`/允许动作词/到期），经每单 env **`STUDIO_TOOLS_WKEY`**（`WORKER_WKEY_ENV_KEY`）随 `launch` 注入；`_meta['studio-wkey']` **只作 legacy 兼容**，不宣传。**两条通道都止于进程内**：回给 daemon 的帧只带 `wkeyRef` 引用。
2. **验签在 daemon**：HMAC 验签、nonce 单次有效、吊销集合、审计、平台写**全部**集中在 daemon/网关；worker 侧不做验签，也没有可信的 nonce 账本。daemon 侧必须持**共享** `WkeyAuthority`（§4.0 不变量 6），否则吊销在 worker 面不可见。
3. **stdio 只是传输**：不提供授权、不提供防重放；不得用 worker 自己的内存 nonce 表当跨进程防重（重启即失效、多 worker 不共享）。**stdout 只许 JSON-RPC 协议帧**，日志/诊断一律 stderr——混写会把帧流污染成不可解析。
4. **helper 先注册（challenge-proof，四类帧归 15）**：本地 socket（`run/daemon.sock` 或 `STUDIO_DAEMON_SOCK`，不得写死本机绝对路径）上 `register{helperId,pid,wkeyRef}` → `registerChallenge{challenge,alg,expiresAt}` → `registerProof{proof}` → `registerAck`，此后 `call{reqId,tool,args}` 收 `verdict{reqId,verdict,result?,failure?}`；未注册一律拒。**`proof` 的字节口径不是任意拼接**：HMAC 输入 = `studio-next/jcs@1` 序列化的**恰五键** `{protocol:'studio-next/stdio-register@1', challenge, helperId, pid, wkeyRef}` 的 UTF-8 字节（JCS 按键名字典序输出为 `challenge`/`helperId`/`pid`/`protocol`/`wkeyRef`；`pid` 是 JSON number，其余为原文 ASCII；无空白、无平台换行），`alg:'hmac-sha256-v1'` 绑死“JCS 规范化 + 域串 + SHA-256”整套，换任一环必须换 `alg`。**不得**写 `上下文‖challenge‖helperId‖wkeyRef‖pid` 这类字符串拼接。`proof` 只含 HMAC 结果、不含 wkey 原文。**帧形状、状态机、超时与断连语义归 15/17，本附录不复写**（15 已按 80 逐字落地；其规范器共用问题见 15-§八 G-21）。
5. **注册验签用 `verifySealed`，不烧 nonce**：`verifySealed`（或 `verify(...,{consumeNonce:false})`）跑完整链但不写 `seenNonces`，**被消费的是 challenge，不是 wkey 的 nonce**——否则一次注册就把 wkey 烧掉，后续真实写全撞 `replay`；`registerAck` 丢失后重连只需新 challenge + 新 proof，不得把 nonce 永久锁死。**同一 `(ticket, nonce)` 只允许一个活跃会话**，第二个注册即 `ok:false`；登记表 `(ticket, nonce, attempt)` 由 daemon 内存持有至 attempt 终结（终态/关单/超时即删），只存内存、不落盘、不写台账、不进日志。
6. **每次实际写由 daemon 现签**：`call` 里 daemon 按 `scope[action]` **现签一个只含该动作的一次性 wkey**（一调用一签发），用它过 `gateWrite`；该 key **不回传 helper、不进 `verdict`**。**不得**改成复用 worker 那把 wkey，也不得把内部 key 放进响应。
7. **`allow` 不冒充 `applied`**：`verdict` 必须带**脱敏后**的 `EffectOutcome`（`applied{receiptRef}` / `unknown{unknownRef}`）或 `ClassifiedError` 的 `failure`/`category`/`subcause`；不得只回 `allow`，不得回平台原文。
8. **秘密不入帧，用途不混**：`SEC-*` 的值（`SEC-GW-SIGNING`、`SEC-WKEY-<ticketId>`，以及公司面 `SEC-MX-HR-SHARED`/`SEC-TG-*` 等）永不随 JSON-RPC/stdio 帧、`initialize._meta`、任务书下发；帧里允许出现的秘密相关字段**只有 `wkeyRef`**（逻辑引用，由 `ticketId` 派生），判据是**原值**而不是字段名。**用途不得互换**：`matrix-register` 建号只用 HR 面秘密 `SEC-MX-HR-SHARED`，`SEC-MX-BOT-PASSWORD` 只作 bot 登录、**不用于建号**，也不在本包任何路径出现（80-§11.2.1 / U80-18）。socket 路径/权限/注册信息不进日志。
9. **本包不承担**：`register`/`call`/`verdict` 帧、socket 生命周期、helper 监督、`tool→action` 映射表的分发——归 daemon（17）与 `studio-tools`（15）；`EffectGateway` 的文件与实现归 16（`F-DAEMON-ENGINE-TOOLS-EFFECT-GATEWAY`），本包不另造第二实现；本包只提供 `gateWrite` 判定面与 `parseAction`/`encodeAction` 这一份编解码。**不得**把 verify 实现复制到 worker 侧，也不得在工具面复写 `@action` 拼装。

〔结论 / 未证〕现状与本目标之间的全部差距**未实现**（U80-17）：stdio 服务、challenge-proof 注册、`verifySealed`、共享 `WkeyAuthority`、daemon 保留 per-ticket wkey、按动作现签内部 key——全部按目标登记，不得写成“已有”。`import { createGateway } from '@studio-next/gateway'` 出现在 `studio-tools` 的**测试**里（`server.test.ts:17`），不等于工具面已有 daemon 侧验签。

### 8.7 回执三情形：缺失 / 迟到 / 冲突（`unknown` 不是第三种结局，是等待对账的状态）

`Ok({status:'unknown', unknownRef})` 只声明“这次外部效果的结果不可判定”——它既**不是拒绝**（不能走 `Err` 让上层当失败处理），也**不是成功**（不能宣称完成）。三种形态都必须留下可引用证据，并指向同一条对账入口（`REC-EVT-03` → `TS-PORT-REC-06`），且**都不许自动重发**（80-§8.4、78-§9.6）。

| 情形 | 证据（必须可引用） | 对账路径 | 禁止 |
|---|---|---|---|
| **缺失**（写超时 / 无回执） | 无 `REC-RCP-01` + 时间窗与游标 + `idempotencyKey` + 请求摘要 | 先 `registerUnknown` 落 `REC-EVT-03`（`owner`/`review_by` 必填；**意图域必带 `unknown_scope.intentRef`**，缺链即 `Err(rejected_precondition, unknown-scope-intent-missing)`）→ 返回 `Ok({status:'unknown', unknownRef})` → 对账按平台侧查询消解（78-§9.6 第 1 条） | 不得当拒绝或成功；不得直接重发同一效果（重试必须先查回执） |
| **迟到**（回执或副作用后到） | 迟到回执（同 `idempotencyKey` 或同 effect 指纹）+ 原 `REC-EVT-03` 引用 | 对账把迟到回执挂到原未知记录上并消解未知，`external_ref` 补平台单号；**只消解未知，不重算验收、不二次派工**（80-§8.4 第 4 条） | 不得因“结果已到”倒推验收结论或补写“已执行”以外的判定 |
| **冲突**（同键异内容 / 回执版本或摘要不符） | 两份回执（或回执 + 平台回读）与摘要/版本差异 | 视为 `conflict`：按 77-§1.4/§11.2 拒绝后到者、附首次结果引用；版本不符先读回再判（78-§9.6 第 2 条）；裁决前不写新回执 | 不得覆盖先到回执；不得把冲突降级成 `unknown` 蒙混 |

〔平台侧的两种“不明”〕① **5xx/429**：按平台给的重试策略走，仍不明 → 归“缺失”，登记 `REC-EVT-03`，不得无限重试（78-§9.6 第 3 条）；② **平台不可达**：该事实域的候选端点 `candidateState=unavailable`，写路径据此判未知并登记，**不得把“不可达”当“无变化”**（78-§9.6 第 4 条）。

〔三条共同的硬约束〕① 三情形都以 `REC-EVT-03` 为唯一对账锚点，`unknownRef` 必填；② `registerUnknown` 失败或拿不到 `Qid` 时**没有对账入口**——此时不得返回 `Ok(unknown)`，返回 `Err(unavailable, category:'STALL', subcause:'unknown-record-unwritten')`（§四 行为契约第 7 步、80-§6.6 `:1656`）；③ `partial` **不是** `unknown`：前者是“确定执行了一部分”，走 `Err(partial)` + 逐项清单（G-5），后者是“外部做了什么不知道”。

---

## 九、迁移顺序（设计序，非施工单）

1. **零风险修正**（不改导出、不改签名、不改语义）：`wkey.ts` 注释 7/8；`revoke('')`/纯空白拒绝（80-§11.1 第 2 条）；`signature.ts` 分隔符/换行/空白拒绝；`gateway.ts` 构造期 `composeSignature`/`author`/`ticket` 校验前移；`gateway.test.ts` 去掉 `Math.random()` 并补“坏 ctx 不消费 nonce”。**此步可独立合入**。
2. **限制补齐**（需批示定值）：`ticket`/`nonce`/`scope` 上限、TTL 政策上限、`level` 上界、控制 key nonce 注入、`issue`/`revoke` 是否受实例票约束（语义变更）。
3. **错误两轴 + `Result` 化**（阻塞于 G-1，**必须与 `contract` 同单**）：`contract` 加 `Result` 与 `ClassifiedError.failure`（`FailureClass` 14 值本身已定稿，缺的只是 `Err` 载体与字段）→ 本件 `gateWrite` 返回 `Result<GateDecision, ClassifiedError>` → **同批**改 15/17 的两个消费点（`gated-platform.ts` 的 `gate()`、`server.ts` 的 `GATE_DENY_HINTS` 读取路径）与 13 条判定断言。**不得**先改 gateway 再等 contract。
4. **共享 authority + 验签不消费**（80-§11.4.1 第 4/6 条，**纯本包改动、可先做**）：`createWkeyAuthority` 增 `verifySealed`；`createGateway` 接受注入的 `authority`（不传才自建）；daemon 装配期改成造一个再注入所有消费者。**前置**：daemon 侧装配点归 17，本包只改签名；**不得**把两个实例同时留在生产路径上。
5. **持久化接缝**（阻塞于 G-8 的跨进程部分）：80 定义端口 → 构造方注入 → gateway 只依赖 contract → 再做“重启/跨进程”负向测试。
6. **脱敏归口**（阻塞于 G-7，归 80/19）：`contract` 落 `secrets` 模块 → `core` 改具名 re-export → `EffectGateway`/通知出口调用；不新增 `gateway→core` 边。
7. **EffectGateway 的行为契约**（文件与施工归 **16**：`F-DAEMON-ENGINE-TOOLS-EFFECT-GATEWAY`，落 `apps/daemon/src/engine/tools/effect-gateway.ts`；阻塞于 G-3～G-6，脱敏接入阻塞于第 6 步，类型落 01-contract 的 `ports/effects.ts`）：本卷只提供流水线/错误/证据/测试面；先 fake 测试与端口编排，不接生产；再改 daemon 侧注入；最后才评估 `gated-platform` 的退化。
8. **分发切换**（条件，阻塞于 79 的 `contract` 先切与 studio-tools 对外决定）：`tsconfig.build.json` → dist 产物与拓扑证据 → `exports`/根 program/根脚本同单改。

**禁止的捷径**：不得先删 `panel/external` 或 `gated-platform` 再补替代；不得把 `Set` 换成 `store` 直调；不得为过测试放宽拒绝码；不得把 `createGateway` 改成异步以“顺便”接 EffectGateway；不得在 `contract` 具备 `failure` 之前先改 `gateWrite` 的返回形状（会造成“声明了 `Err` 却没有承载字段”的第二套）；不得用 `verifySealed` 之外的办法“绕过 nonce 检查去注册”（那是把验签削弱成签名比对）。

---

## 十、完成度自评（本附录，不是全卷结论）

| 项 | 状态 |
|---|---|
| 现有件枚举与计数可复算（11 件） | 完成（`find`/`wc -l` 口径见 §〇） |
| 目标件枚举与计数（本包 **12 件**：保留 11、本包新增 1＝条件件 `tsconfig.build.json`） | 完成；跨包引用 2 件（16 的 `F-DAEMON-ENGINE-TOOLS-EFFECT-GATEWAY` 与其测试件，80-§6.9 `:2259`）**不计件**，见 §3.3 |
| 每个文件含职责/非职责、内部结构、依赖、IO、状态、错误、测试、规模 | 完成（配置件以“字段+边界”替代运行期字段） |
| 超限件与拆分 | 不适用：无超限件、无基线条目；已给不拆依据 |
| 目标件的 ID 归位 | 完成：本包唯一目标新件是 `F-gateway-tsconfig-build`（条件件）；EffectGateway 文件与测试件的 ID 归 16（`F-DAEMON-ENGINE-TOOLS-EFFECT-GATEWAY` / `F-DAEMON-ENGINE-TEST-TOOLS-EFFECT-GATEWAY`），本卷只引其行为契约（80-§5.2 `:716-717`、§6.6 `:1655-1656`、§6.9 `:2259`；G-2 已关闭），**不用** `F-gateway-effect` |
| 消费面复算 | 完成：**12 文件 / 18 条 import**（§二.3），`Result` 化的连带迁移面已点名（15/17 同批） |
| `Result` / 两轴错误对齐 | 完成设计层：`GateDecision` + `Result<GateDecision, ClassifiedError>` + 14 码映射表（建议值）；**阻断**于 G-1（`contract` 仍无 `failure` 字段与 `Result` 定义） |
| 现有/目标/未证分离 | 完成；未执行项逐条列在 §七 G-13 |
| 凭据 / 署名 / 脱敏 / 错误 / nonce / 工具面 / 回执对账七专题 | 完成（§八 逐项对照 76/77/78/80；脱敏放置按 80-§11.2 第 3 条 + D16；stdio 与 challenge-proof 按 80-§11.4.1 且协议归 15；回执三情形按 78-§9.6 + 80-§8.4） |
| 与 80 的偏差 | 无“我们私设一套”的偏差；登记 **G-1…G-14**：阻塞实现的实为 3 条（G-1、G-3、G-4；**G-2 已关闭**）、阻塞 `EffectGateway` 完整语义 3 条（G-5～G-7）、跨进程/身份正确性 2 条（G-8 的跨进程半个仍开、G-9）、政策项 1 条（G-11）、实现内缺陷 1 组（G-12）、未证清单（G-13）与 3 条跨卷登记（G-14，其中 1 条已对齐；拼写项已于 v0.4 关闭）。v0.6 的文件 ID 归位（daemon 件归 16）与计数回到 12 件**不构成**与 80 的偏差 |
| 运行证据 | **无**：未跑 typecheck/test，未启动服务；本文不提供“测试为绿”结论 |

〔结论〕本附录只证明“文件级设计已被逐件核对并可追溯”，不证明实现可行、不证明当前能力、不证明全卷一致；这些分别归编写后的独立审查、82 的验证层与制作人批复。**§十 不写 PASS，也不以“已完成”替代“已实现”。**
