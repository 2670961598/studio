# 81-files/15 · `packages/studio-tools` 逐文件契约

> 版本：**v0.6**，2026-10-27（v0.1 同日初稿；v0.2 按 80 最新定稿接口重做一致性修订；v0.3 事实修正与内部矛盾收口——解包核实 MCP 2.3.1 确有 `./stdio` 子路径、env 收窄为两键、`deps` 改为 fail-closed 三方法、删掉不存在的 `unregister` 帧、启动失败改稳定 `subcause`、`daemon-link` 错误面按两轴重写、G-11 收窄到 socket 帧上限。**v0.4 按 80-§11.4.1 最新帧集重写 stdio 口径**：`register` 恰三键、`registerAck` **不带 `reqId`**、`call` **恰三键且不带 `wkey`**、`verdict` 四键；`wkeyRef` 定为逻辑引用 `SEC-WKEY-<ticketId>`（非秘密、不可转授）；注册绑定连接、重连必须重注册；关闭 G-04/G-13/G-14，新增 G-15/G-16 两个真实未决。**v0.5 按 80-§11.4.1 最新正文把 stdio 注册重写为三步 challenge-proof 握手**：`register{helperId,pid,wkeyRef}` 只是申请 → `registerChallenge{challenge,alg:'hmac-sha256-v1',expiresAt}` → `registerProof{proof}` → `registerAck{ok,reason?}`；`proof` = HMAC-SHA256(wkey, 版本化上下文‖challenge‖helperId‖wkeyRef‖pid)，常量时间比较（**该拼接口径已由 v0.6 的 JCS 五键字节取代**，保留此句只作沿革）；daemon 用 `verifySealed` 完整验签但**不消费 nonce**，被消费的是**一次性、短 TTL、绑连接**的 challenge；同一 `(ticket,nonce)` 只允许一个活跃会话；`call` 不带 wkey，由 daemon 按 scope **内部现签**一次性调用 key，`verdict` 带 `result`/`failure`（`allow ≠ applied`）；`encodeAction`/`decodeAction` 集中 gateway。关闭 G-12/G-15/G-16，新增 G-17~G-20。**v0.6 按 80-§11.4.1 最新正文冻结 proof 字节与连接鉴权口径**：proof 输入改为 **`studio-next/jcs@1` 序列化的五键对象**（`protocol:'studio-next/stdio-register@1'`/`challenge`/`helperId`/`pid`/`wkeyRef`，字典序、无空白、UTF-8 字节）后取 `HMAC-SHA256(wkey 原文, 该字节)`，`alg:'hmac-sha256-v1'` 即“JCS + 域串 + SHA-256”整套，**关闭 G-18**（改键序/加空白/换域串/换算法/改一字节必拒；固定**假**向量归 82）；连接鉴权改为两层——`0700`/`0600`/`umask 0077`/拒符号链接**只是部署边界**，对端 uid 只由宿主注入的 `PeerCredentialVerifier` 给出（Node 24 **无** `getpeereid`/`SO_PEERCRED` 内建 API，**不得**直接调用），无已验证适配即 `unverified`、不得记 `peer-verified`；核心信任=challenge-proof+活跃签发+scope，恶意同 uid 靠 OS 用户/容器隔离（**G-20 按此改写**）；ack 丢失后旧连接清理完可重注册，不因 active session 永久锁死。G-17/G-19 只保留真实未实现）。
> 性质：**自然语言级文件与实现设计呈审稿**，不是现行文件树、实现单或完成证明。
> 上位：75-§五 文件契约模板与 §三 D75-03/D75-07/D75-13；76/77 的公共语义（按 ID 引用，77-§11.1 的 14 类失败）；78 `BIND-EDGE-MCP-01`、§7.4.1（`SEC-*` 命名）、§11.4；79 `DEP-MCP-SERVER`、§3.2、§6.1、§6.5、§7.1、§10.1 第 9 项；80-§2.1、§2.3、§5.7（`ClassifiedError` 两轴）、§5.8、§5.10、§6.6（`Notifier`/`IntentSubmissionPort`）、§8.1、§8.2（`openLedgerReadonly`）、§11.2.1（`SecretCatalogEntry`/`Provider`/`KnownSecretSet`）、**§11.4.1（stdio 与 daemon 侧验签）、U80-17、U80-18**、§12.2、§12.5。
> 边界：本附录只把 80 的组件与接口落到 `packages/studio-tools` 的文件；**不新增公共概念、TS 端口、`REC-*`、状态、允许边或依赖版本**。发现 80/78 缺件时只登记回写项（§八），不在此私设补洞。**跨卷目标件（`contract/src/ports/intent.ts`、`contract/src/ports/secret.ts`、`core/src/work-readiness.ts`、`apps/daemon/src/assembly/intent/{ingress,receipt-store}.ts`、`apps/daemon/src/assembly/api/assemble.ts` 等）不属本卷，只登记依赖与接口形状（§5.7），不在此另立 F-ID、不复制其字段表**——否则就是跨卷重复与第二事实源。
> 门禁：本文所有「目标/新增/替换/退役」均为设计处置，尚未执行；不得据此直接改源码、manifest、lock 或 guards。
> 标签：`现有` / `库级·未接` / `目标-保留` / `目标-拆分` / `目标-新增` / `目标-替换` / `目标-退役` / `仅测试` / `未证`（81-§四）。
> 证据口径：本附录**未运行** typecheck、测试、socket 或任何真实服务；下文「43 例」是静态计数（`it`/`it.each` 行数 × 展开数），不是通过证据。静态 import/行数/键名核查只作结构核对（`git ls-files`、`wc -l`、`grep`，2026-10-27）。
> 本版必读：**80-§11.4.1 已给 stdio 的 daemon 侧验签、helper 注册协议与 socket 约定**——v0.1 的「G-03 跨进程验签方案未定」作废；stdio 目标改为「已定协议、未实现、未证（U80-17）」。同时 v0.1 把 `TOOL_ERROR_CATEGORIES` 四族与 `ClassifiedError` 的关系写成「未定义」，本版按 80-§5.7 两轴模型重写，并把**逐拒绝码 → `failure` 的映射**列为 78 回写项（§八 G-05）。**v0.5 起**：§4.9/§4.10/§4.11 按「三步注册 + `prove` 回调 + `verdict` 带 `result`/`failure`」重写，**v0.4 的「注册一帧 + 无 `registerChallenge`/`registerProof`」版本作废**；同时废止「daemon 不留 wkey 副本」（80-§11.4.1 第 5 条要求 daemon 内存保留本单 wkey 至 attempt 结束）与「各 gateway 各建 authority」（第 6 条要求进程内单一共享 `WkeyAuthority`）。**v0.6 起**：§4.9/§4.10/§4.11 的 `proof` 改为 `studio-next/jcs@1` 五键规范化字节（不是“上下文‖challenge‖…”的任意拼接），`alg:'hmac-sha256-v1'` 同时冻结规范化、域串与算法；socket 权限只算部署边界，对端 uid 一律经宿主注入的 `PeerCredentialVerifier`，无适配即 `unverified`。

---

## 〇、范围、计数与复算口径

覆盖 `packages/studio-tools` 的全部第一方文件（`git ls-files packages/studio-tools` 恰为 8 条）。

| 类别 | 件数 | 路径复算 |
|---|---|---|
| 生产源码 `src/*.ts`（非测试） | 3 | `src/index.ts`、`src/tools.ts`、`src/server.ts` |
| 测试源码（与生产同目录） | 2 | `src/server.test.ts`、`src/tools.test.ts` |
| 包配置件 | 2 | `package.json`、`tsconfig.json` |
| 包文档 | 1 | `README.md` |
| 测试目录 `test/` | 0 | 不存在（`ls packages/studio-tools/test` 报无此目录） |
| 夹具目录 `test/fixtures/` | 0 | 不存在；夹具全部内联在测试文件里 |
| `LICENSE` / `dist` / 包级 vitest 配置 / `stdio` 入口 | 0 / 0 / 0 / 0 | 均不存在；全包无 `StdioServerTransport`、无 `node:net`、无 socket 客户端 |
| 合计 | **8** | `git ls-files packages/studio-tools` 恰 8 条 |

行数为 2026-10-27 实测（`wc -l`）：`index.ts` 20、`tools.ts` 335、`server.ts` 264、`server.test.ts` 440、`tools.test.ts` 141、`package.json` 21、`tsconfig.json` 5、`README.md` 118；合计 1344 行。行数只作规模核对，不作能力证据。

**目标件全集**（总数 13 = 保留 8 + 新增 5；拆分 0、替换 0、退役 0、仅测试增 1）：

| F-ID | 目标路径 | 处置 |
|---|---|---|
| `F-studio-tools-index` | `packages/studio-tools/src/index.ts` | 目标-保留 |
| `F-studio-tools-tools` | `packages/studio-tools/src/tools.ts` | 目标-保留（错误面与注入后端形状随 §八 波次改） |
| `F-studio-tools-server` | `packages/studio-tools/src/server.ts` | 目标-保留（闸口类型放宽、错误两轴、消毒、超时） |
| `F-studio-tools-stdio` | `packages/studio-tools/src/stdio.ts` | 目标-新增（协议已定，实现未做=未证） |
| `F-studio-tools-daemon-link` | `packages/studio-tools/src/daemon-link.ts` | 目标-新增（受控 IPC 客户端：注册、逐调用裁决、拒绝即默认） |
| `F-studio-tools-test-server` | `packages/studio-tools/src/server.test.ts` | 目标-保留 / 仅测试 |
| `F-studio-tools-test-tools` | `packages/studio-tools/src/tools.test.ts` | 目标-保留 / 仅测试 |
| `F-studio-tools-test-stdio` | `packages/studio-tools/src/stdio.test.ts` | 目标-新增 / 仅测试（帧协议与 fail-closed；不证 daemon 权威） |
| `F-studio-tools-manifest` | `packages/studio-tools/package.json` | 目标-保留（内容随 §七 波次改；新增 `./stdio` 子路径导出，无 `bin`） |
| `F-studio-tools-tsconfig` | `packages/studio-tools/tsconfig.json` | 目标-保留 |
| `F-studio-tools-tsconfig-build` | `packages/studio-tools/tsconfig.build.json` | 目标-新增（条件：dist 切换时） |
| `F-studio-tools-readme` | `packages/studio-tools/README.md` | 目标-保留（修正状态、入口、env、计数与非声明） |
| `F-studio-tools-license` | `packages/studio-tools/LICENSE` | 目标-新增（条件：制作人定包级许可） |

`src` 直属件：现状 5 → 目标 8（+`stdio.ts`、+`daemon-link.ts`、+`stdio.test.ts`），仍 ≤25；单文件上限 600 行不变，`lineBaseline` 不新增本包条目。

**跨卷引用（不属本卷，不给 F-ID，只在 §5.7 写依赖与形状）**：`contract/src/ports/intent.ts`（`IntentSubmissionPort`/`IntentKey`/`IntentReceipt`/`WebhookIntentPayload`）、`contract/src/ports/secret.ts`（`SecretCatalogEntry`/`SecretProvider`/`SecretMaterial`/`KnownSecretSet`）、`contract` 迁入的 `redactOutbound`/`redactKnownSecrets`/`findSecretShaped`、`core/src/work-readiness.ts`（开工五门纯求值）、`apps/daemon/src/assembly/intent/{ingress,receipt-store}.ts`、`apps/daemon/src/assembly/api/assemble.ts`。归属分别是 `81-files/01`、`81-files/02`、`81-files/17`；本包**不 import 它们**（除经 `contract` 的公共导出，且仅当目标需要脱敏）。

排除项：`packages/studio-tools/node_modules/`（安装生成物；其中 `zod` 为指向根 `.bun` 的符号链接，`@studio-next/*` 为 workspace 链接，`@modelcontextprotocol/server` 为实锁 2.3.1 包体）、`.git`、根 `package.json`/`tsconfig*.json`/`bun.lock`/`scripts/guards/**`（归 `81-files/19`）、第三方源文件、历史设计文档。`apps/daemon/test/engine/worker-key-lifecycle.test.ts` 是**本包的外部消费者**，归 `81-files/16`，本附录只登记它对本文文件的依赖事实，不展开其契约。

---

## 一、包身份与边界

### 1.1 身份

| 项 | 值 | 依据 |
|---|---|---|
| 包名 / 版本 | `@studio-next/studio-tools` / `0.1.0`，`private: true` | `package.json` |
| 层位 | **层位 4**（与 `panel`/`api`/`prompt` 同层；上承 `daemon` 5，下接 `gateway` 1、`contract` 0） | `scripts/guards/boundary-rules.mjs` `packageLayers`；80-§2.1 |
| 80 的目标语义 | 「内部 MCP server（worker 面工具）——不变；工具集与 `GATEWAY_ACTIONS` 同表纪律」 | 80-§2.1「层 4 · studio-tools」行 |
| 绑定 | `BIND-EDGE-MCP-01`（方向=出；只产网关动作；禁状态推进与授权变更） | 78-§11.1、§11.4 |
| 现状能力 | **库级·未接**：`src` 生产链零消费者；**无 stdio 入口**（全包无 `node:net`、无 `StdioServerTransport`）；daemon 只在测试里用 | 80-§2.1；78-§11.4「现状：库级」；U80-17 |
| 模块形态 | `type: "module"`，ESM，Node 24 原生 type-stripping 直跑 `.ts` | 79-§1.2、§1.3 |
| 入口（现状） | `main: "src/index.ts"`、`exports: { ".": "./src/index.ts" }`；**无 `./stdio` 子路径** | 79-§4.4 源码态 |
| 发布 / 构建（现状） | 不发布；无 `files`、无 `license`、无 `bin`、无 `dist`、无 build 脚本 | `package.json`；79-§6.5 |
| 目标入口 | 库面仍走包根（`exports["."]`）；stdio 面走**子路径导出** `exports["./stdio"]`（宿主/MCP 客户端按路径拉起 helper），**不设 `bin`**——helper 由 client `spawn`，不是全局命令 | 80-§11.4.1 第 4 条；79-§6.5（需回写，§八 G-07） |
| 目标分发 | `exports["."] → ./dist/index.js`、`exports["./stdio"] → ./dist/stdio.js`；`files = dist + README.md + LICENSE`；许可待制作人定 | 79-§6.5 目标口径表（子路径待补） |
| 目标凭据面 | ①**每单 env**——键名 **`STUDIO_TOOLS_WKEY`**（80-§11.4.1 第 1 条已定名；= `apps/daemon/src/engine/worker-key.ts:62` 的 `WORKER_WKEY_ENV_KEY`，源码注释的“拟稿定名”待 `81-files/16` 落定稿；适配器白名单与既有测试已钉死该值）优先；②`initialize._meta['studio-wkey']` **仅 legacy**，不宣传；③**永不**收 `gatewaySecret`（`SEC-GW-SIGNING`）；④凭据**只到进程、不进帧**——回给 daemon 的帧只带逻辑引用 `wkeyRef` | 80-§11.4.1 第 1、4 条；§11.2.1；78-§7.4.1 |

### 1.2 允许边与禁止边

〔事实〕生产源码的实际 import 只有四类：`zod`（值）、`@modelcontextprotocol/server`（值）、`@studio-next/gateway`（**type-only**）、`@studio-next/contract`（**type-only**）。测试另加 `vitest`、`node:crypto`、`@modelcontextprotocol/server` 的 `InMemoryTransport`。全包**零 Node 内建 import**（无 `node:fs`/`node:net`/`node:process`）。

〔结论〕允许边（不新增；与 `allowedPackageEdges` 一致）：

| 边 | 状态 | 说明 |
|---|---|---|
| `studio-tools → gateway` | 声明存在，**运行期零 import**（仅类型） | `Gateway`/`GateRejectReason` 类型；实例由宿主注入 |
| `studio-tools → contract` | 声明存在，**运行期零 import**（仅类型） | `GatewayAction`/`SignedBody` |
| `daemon → studio-tools` | 冻结边；现状只在 `apps/daemon/test/**` 使用（daemon 侧为 `devDependencies`） | 79-§10.1 第 9 项判定「正确，保留」 |
| `studio-tools → daemon/panel/api/company/store/core/prompt/adapters/*` | **禁止** | 包层位 4 只能下行到 1/0；反向或平级新边=提案流 |
| `gateway → studio-tools` | **禁止** | 会把层位 1 抬到 4；网关是被注入的内核，不认识 MCP |
| `studio-tools` 内 `server.ts → tools.ts` | 允许（同包单向） | `tools.ts` 不得反向 import `server.ts`（现无） |
| `studio-tools` 内 `stdio.ts → server.ts`／`daemon-link.ts` | 目标允许（同包单向，仅入口引用） | `server.ts`/`tools.ts` **不得**反向 import `stdio.ts`/`daemon-link.ts`：库面不许因被 import 就拉起 socket 或进程副作用 |
| `studio-tools → core` | **禁止**（`allowedPackageEdges` 无此条；core 层 1 < 本包层 4，但方向未登记） | 目标需要 `redactOutbound`/`findSecretShaped` 时必须从 **`contract`** 取（80-§12.2 第 3 条：三个纯函数整模块迁 `contract`，`core` 只具名 re-export）。**不得**在本包另写第二份正则或脱敏实现 |

〔结论〕包的**运行期闭包**现状只有 `@modelcontextprotocol/server` + `zod`；两个 workspace 依赖只承担类型/`.d.ts` 面。目标有两处变化，都**不新增包边**：①`server.ts` 的错误消毒若需要 `redactOutbound`，`studio-tools → contract` 从 type-only 变为**值 import**（边已在表内，但 `contract` 的运行期导出面因此扩大，归 80-§12.2 第 5 条与 `81-files/01`）；②`stdio.ts`/`daemon-link.ts` 需要 `node:net`、`node:process`、`node:crypto`（`helperId`/`reqId` 生成）、`node:readline`（socket 逐行帧），外加 MCP SDK 的 `./stdio` 子路径（`StdioServerTransport`，不是 Node 内建）。Node 内建不是包边，但会让本包从「纯库」变成「有进程面」，因此**不得**被 `index.ts` 转发。这一点影响 §七 的 dist 切换：切换仍需 contract/gateway 先有 `dist/*.d.ts`（79-§6.1 硬前提），且 `dist/stdio.js` 必须能独立被 `node` 拉起（不依赖本包外的 src）。

### 1.3 依赖清单与 79 裁决

| 依赖 | manifest 范围 / 实锁 | 归属 | 用途 | 79 裁决与边界 |
|---|---|---|---|---|
| `@modelcontextprotocol/server` | `^2.3.1` / 2.3.1 | 运行时 | `McpServer`、`Transport`、`InMemoryTransport`（测试）；目标 `./stdio` 子路径的 `StdioServerTransport`/`serveStdio` | `DEP-MCP-SERVER` 保留；Apache-2.0；要求 Node ≥20；包内含**可选** Ajv provider 文件（不得被读成「本仓引入 Ajv」） |
| `zod` | `^4.0.0` / 4.6.7 | 运行时 | 六工具输入/输出 schema；`z.toJSONSchema` 摘要 | 79-§3 保留；MCP 要求 `^4.2.0`，实锁 4.6.7 满足；`~standard.jsonSchema` 类型缺口即 `McpSchemaOf` 桥的退出条件 |
| `@studio-next/contract` | `workspace:*` / 同仓 | 运行时清单、实际 type-only | `GATEWAY_ACTIONS`（测试侧的对照真源）、`GatewayAction`、`SignedBody` | 不得改到 `devDependencies`：类型会进入本包 `.d.ts`，消费者需要解析 |
| `@studio-next/gateway` | `workspace:*` / 同仓 | 运行时清单、实际 type-only | `Gateway`、`GateRejectReason` | 同上；实例永远由宿主构造注入，本包不自建网关（不持有 secret） |

〔已核〕`F-studio-tools-stdio` 需要的 **`./stdio` 子路径在实锁 2.3.1 中存在**（v0.2 初稿写「未核」，本版已解包核对，不再需要 readline 自实现备选）：`@modelcontextprotocol/server@2.3.1` 的 `package.json` `exports["./stdio"]` 指向 `dist/stdio.{mjs,cjs}` + `dist/stdio.d.mts`；`dist/stdio.d.mts:114` 导出 `StdioServerTransport`、`serveStdio` 与类型 `ServeStdioOptions`/`StdioServerHandle`。`StdioServerTransport` 的构造签名是 `(stdin?: Readable, stdout?: Writable, options?: { maxBufferSize?: number })`，**`maxBufferSize` 缺省 10 MB，单条消息超限即 emit error 并 close**——这是 SDK 自带的长正文上界，不是本包的策略；本包不得静默上调它（要改须走提案流并同步 79 的 `DEP-MCP-SERVER` 记录）。

〔未证〕本包未验证「MCP SDK 与业务侧共用同一份 zod 实例」在运行期的稳定性：实锁只有一份 `zod@4.6.7`（`bun.lock:497`），但安装形态变化可能产生第二份；`StandardSchemaWithJSON` 是结构协议而非 `instanceof`，故风险主要是类型与错误消息，不是注册失败。归 82 的 V4 取证，不计入「已支持」。

---

## 二、现有件全集：真实导出与调用锚

| 文件 | 行数 | 值导出（运行时） | 类型导出 | 生产消费者 |
|---|---|---|---|---|
| `src/index.ts` | 20 | 无自有符号（`export *` 两文件） | 同左 | 无（仅测试/包外） |
| `src/tools.ts` | 335 | `TOOL_ERROR_CATEGORIES`、`TOOL_SUBCAUSES`、6 个 `*Input`、6 个 `*Output`、6 个 `*Tool`、`STUDIO_TOOLS`、`STUDIO_TOOL_NAMES`、`studioToolSummaries` | `ToolErrorCategory`、`ToolError`、`KbHit`、`WriteEvidenceOutcome`、`StudioToolsDeps`、`ToolEnv`、`ToolArgsOf`、`ToolOkOf`、`ToolFieldsOf`、`StudioToolSpec`、`StudioToolSummary` | 无 |
| `src/server.ts` | 264 | `WKEY_META_KEY`、`withInitWkeyCapture`、`createStudioToolsServer` | `StudioToolsServerOptions`、`StudioToolsServer` | 无 |
| `src/server.test.ts` | 440 | —（测试） | — | — |
| `src/tools.test.ts` | 141 | —（测试） | — | — |

〔目标〕导出面的三处处置（都不改工具集、不改 `GATEWAY_ACTIONS`）：

| 现状导出 | 目标处置 | 理由 |
|---|---|---|
| `TOOL_ERROR_CATEGORIES` / `ToolErrorCategory` | **目标-退役**（从公共面移除） | 四族（`auth`/`gateway`/`deps`/`internal`）是**观测分组**，不是 80-§5.7 的 11 值 `category`，也不是 77 的 14 类 `failure`。同时存在三套「category」会被下游当映射用。目标错误体改为两轴（§5.5），四族不再有承载位；若要保留分组，只能作 `subcause` 的实现前缀（如 `tool-auth-*`），**不得**再叫 category |
| `ToolError{category,subcause,message}` | **目标-替换**为 `ClassifiedError` 形状 `{failure,category,subcause,detail?}` | 80-§5.7「两轴一个载体」；`message` 是明文文案，不是机器分类，且会把后端 `err.message` 带进结果面（§5.5 消毒） |
| `WKEY_META_KEY` | 目标-保留，但**降级为 legacy** | 80-§11.4.1 第 1 条：`_meta` 只作兼容，正式通道是每单 env；常量本身不删（兼容期需要） |

以上是**破坏性变更**：MCP 客户端若按 `error.category ∈ {auth,gateway,deps,internal}` 分支，必须改为读 `failure` + `subcause`。不得为兼容而双形状并存（「有 `failure` 就走新分支、没有就走旧」），那会让两套语义长期共存（80-§9.4 对 HTTP 面同一条纪律）。

外部调用锚（唯一）：`apps/daemon/test/engine/worker-key-lifecycle.test.ts:30-31`（`createStudioToolsServer`/`StudioToolsServer`）、`:25-26`（`InMemoryTransport`）；`apps/daemon/package.json` 的 `devDependencies` 两条。生产 `apps/daemon/src` 对 `@studio-next/studio-tools` **零 import**（仅注释提及），与 78-§11.4「库级」一致。

---

## 三、目标件处置总表

| F-ID | 处置 | 迁移顺序 | 阻塞/条件 |
|---|---|---|---|
| `F-studio-tools-index` | 目标-保留 | 保持 | 若新增 `stdio.ts`/`daemon-link.ts`，**不得**从 index 再导出（入口有副作用：socket、进程） |
| `F-studio-tools-tools` | 目标-保留 | M3 改错误面 | 错误体两轴化 + 注入后端映射 80-§11.4.1 四行；`article` 仍零外部效果 |
| `F-studio-tools-server` | 目标-保留 | M3 | 闸口类型放宽为包内 `ToolGate`（同步或异步 `gateWrite`）、错误消毒、超时/取消、`_meta` 降 legacy |
| `F-studio-tools-stdio` | 目标-新增 | M4 | 前置：daemon 侧 socket 服务与三步握手服务端存在（归 `81-files/17`）、结果面落地（§八 G-19）、`./stdio` 子路径导出（G-07） |
| `F-studio-tools-daemon-link` | 目标-新增 | M4 | 同上；未注册一律拒，daemon 不可达一律拒（fail-closed） |
| `F-studio-tools-test-server` | 目标-保留 / 仅测试 | M2 追加 | 新增负向用例后若逼近 600 行，按 §七 预案 |
| `F-studio-tools-test-tools` | 目标-保留 / 仅测试 | M3 随错误面改 | 四族断言改为两轴断言；`good` 样本随 `GATEWAY_ACTIONS` 扩表先红 |
| `F-studio-tools-test-stdio` | 目标-新增 / 仅测试 | M4 | 只证帧协议与 fail-closed；真机/跨进程归 82 V5 |
| `F-studio-tools-manifest` | 目标-保留 | M5 才改 | dist 切换、`./stdio` 子路径、许可；**不设 `bin`** |
| `F-studio-tools-tsconfig` | 目标-保留 | 保持 | dist 切换后仍须 `include: src/**/*.ts`（79-§6.1） |
| `F-studio-tools-tsconfig-build` | 目标-新增 | M5 | 条件：dist 切换单启动；须排除 `**/*.test.ts` |
| `F-studio-tools-readme` | 目标-保留 | M1（无代码） | 只改陈述，不改能力 |
| `F-studio-tools-license` | 目标-新增 | M5 | 条件：制作人定包级许可（75-§七 D3） |

**不拆分**的依据：本包无 `lineBaseline` 条目（`boundary-rules.mjs` 的 `lineBaseline` 无 `packages/studio-tools/*`），最大生产件 335 行 < 600，`src` 直属件现状 5、目标 8，均 < 25。因此不设 `F-*-split-*`，也不为「以后可能变大」预建深层子目录；若未来新增件使 `src` 超过 25 件或单文件超过 600 行，按 81-§3.3 先开 `src/<子域>/` 或拆分，**不得**上调阈值或把新超限件塞进基线（80-§2.2 的目录纪律）。新增的 `daemon-link.ts` 与 `stdio.ts` 是**同一子域的两件**（传输入口 / IPC 客户端），不是「域平面散件」——本包无 `domainPlaneBaselines` 条目（只有 daemon 有），但也**不因此**允许无限摊平：`src` 直属上限仍是 25。

---

## 四、逐文件契约

### 4.1 `F-studio-tools-tools`

- **路径/处置**：`packages/studio-tools/src/tools.ts`；目标-保留。旧路径同名，不迁移。
- **归属与上位锚**：实现层；80-§2.1「工具集与 `GATEWAY_ACTIONS` 同表」、78 `BIND-EDGE-MCP-01`「覆盖=六个工具」、80-§5.10（zod 定位）、**80-§5.7（两轴错误：`failure` 处置轴 + `category` 观测轴）**、**80-§11.4.1（`StudioToolsDeps` 分流：平台写/活性观察/材料目录/`REC-02`/`REC-03`）**、77-§6.2（`REC-EVD-02` 证据项，仅作 evidence-write 的上位，不等于本文件产出记录）。工具**语义**仍以 `GATEWAY_ACTIONS` 与 78 的边定义为准，本文件只是投影。
- **职责**：六工具的唯一登记表——名字、人读标题/描述、输入/输出 schema、纯执行体 `run`；同时给出注入后端形状（`StudioToolsDeps`）、执行环境（`ToolEnv`）、两级错误分类与供 prompt L5 使用的摘要。
- **非职责**：不鉴权（归 `server.ts` 的 `runTool` 前置）、不注册协议（归 `server.ts`）、不写平台/知识库/证据目录（`run` 只调注入后端或只回传署名字段）、不推进单据状态、不判授权/验收/结清、不校验证据内容真伪、不算预算、不检索。`run` 的 `signed` 参数只证明“网关已放行并落款”，**不证明外部效果已发生**。
- **内部结构**：
  - 常量：`TOOL_ERROR_CATEGORIES = ['auth','gateway','deps','internal']`（**现有**；目标-退役，理由见 §二）。`TOOL_SUBCAUSES`（现有 5 个具名值：`authMissingWkey='missing-wkey'`、`depsEvidenceWrite='evidence-write-failed'`、`depsKbSearch='kb-search-failed'`、`depsBudgetQuery='budget-query-failed'`、`internalUnexpected='unexpected'`）；这 5 个**值**目标保留（它们是稳定实现细目，正好符合 `subcause` 的定位），变的只是承载字段从 `category` 换成 `failure`+`category` 两轴。私有 `DenyOutput`（现有 `ok:false` + `error{category 四族, subcause≥1, message}`；目标 `ok:false` + `error{failure, category 11 值, subcause≥1, detail?}`，见 §5.5）。
  - 类型：`ToolErrorCategory`（目标-退役）、`ToolError{category,subcause,message}`（目标-替换为 `ClassifiedError` 形状，但**不以 `ClassifiedError` 之名导出**——它由 `contract` 定义，本包只 import type 并使用，避免第二套同名类型）；`KbHit{path≥1, score:number, snippet?:string}` + 私有 `KbHitSchema`；`WriteEvidenceOutcome{bytes}`；`StudioToolsDeps{writeEvidence(path,content)→{bytes}; searchKb(query)→KbHit[]; queryBudget(issue)→Record<string,unknown>}`（包内接口，**不是** `TS-PORT-*`；80-§11.4.1 已给四行映射，见下）；`ToolEnv{gateway:ToolGate; deps:StudioToolsDeps; wkey():string|undefined}`；**`ToolGate`（目标，包内结构类型，非公共端口）**= `{ gateWrite(token:string, action:GatewayAction, payload:string): GateWriteResult & { outcome?: EffectOutcome } | Promise<GateWriteResult & { outcome?: EffectOutcome }> }`——库面注入的真 `Gateway` 结构满足它（同步返回是联合的子类型），stdio helper 注入的 `daemon-link.gate` 返回 Promise 但入参是结构化 `(tool,args)`（帧里没有 `token`），形状差与替代方案见 §八 G-17；`runTool` 因此统一 `await` 闸结果。目标再给放行分支加**可选** `outcome?: EffectOutcome`（stdio 写面由 daemon 代执行，结果只能从这里回传；类型本体归 `contract`，现状无导出=§八 G-19，本包只用结构形状）：`outcome` 在时 `runTool` **跳过** `spec.run`、直接按 `applied{receiptRef}`/`unknown{unknownRef}` 组装回执；不在时才走 `run`；`allow` 无 `outcome` 不得当成功（§4.9）。这**不新增包边**（`Gateway`/`GateWriteResult` 仍是 type-only import），也不把 `daemon-link` 变成第二个网关；私有 `ToolInputMap`/`ToolOutputMap`；`ToolArgsOf<A>`（zod 输出）、`ToolOkOf<A>`（`ok:true` 分支）、`ToolFieldsOf<A>`（去掉 `ok`/`action`）；`StudioToolSpec<A>{name,title,description,input,output,run(args,env,signed)}`。
  - **`StudioToolsDeps` 与 80 端口的映射（不得绕过，80-§11.4.1 表逐行）**：`comment`/`article` 先由 daemon 翻译成 `comments.add`/`kb.upsert`，再走 `TS-PORT-EFF-01 EffectGateway.apply`；`heartbeat` 经共享 `WkeyAuthority` 验签后由 daemon 经 `TS-PORT-REC-01` 写活性观察，不是平台写；`writeEvidence(path,content)` → worker **只写本单 `evidence/` 沙箱目录**（containment 强制），收割归 `TS-PORT-EVD-01` 且**只读**；`searchKb(query)` → `TS-PORT-REC-02 RecordReader.query`（带 `knowledgeScope` 与必填 `limit`/`order`，超范围不可见，`nextCursor` 原样返回）；`queryBudget(issue)` → 只读投影（`TS-PORT-REC-03`），不可写。这些是**目标映射**，现状 `StudioToolsDeps` 三个函数没有这些约束（无 scope、无 containment、无只读保证）——属缺陷登记（§八 G-01/G-08），不得写成「已满足」。
  - 预算视图不承载金额口径：`budget-query` 的 `view` 是**不透明只读视图**，本包不定义 `Money`，也不把 `{usd:number}` 当公共金额形状（公共金额用 `DecimalString` + 币种，归 `core`/`company`，80-§4.1）。`KbHit.score` 是相关度，不是金额。
  - 六输入（全部 `strictObject`，多余键拒收）：`comment{issue≥1, body≥1}`；`heartbeat{issue≥1}`；`article{path≥1, markdown（允许空串）}`；`kb-search{query≥1}`；`evidence-write{path≥1, content≥1}`；`budget-query{issue≥1}`。必填即全部字段；无默认值、无 transform、无 refine。
  - 六输出：`ok:true` 分支分别为 `comment/heartbeat{issue,author≥1,signature≥1}`、`article{path,author,signature}`、`kb-search{hits:KbHit[]}`、`evidence-write{path,bytes:int≥0}`、`budget-query{view:Record<string,unknown>}`；`ok:false` 分支共用 `DenyOutput`（`z.discriminatedUnion('ok', …)`）。
  - 六个 `*Tool` 规格：`CommentTool`（署名评论）、`HeartbeatTool`（活性心跳）、`ArticleTool`（知识库 upsert）、`KbSearchTool`、`EvidenceWriteTool`、`BudgetQueryTool`；`run` 的实际行为：前三个**只用 `signed.author/signature` 组装回执，零 IO**；后三个分别调用 `deps.searchKb`/`writeEvidence`/`queryBudget`，并把结果浅拷贝成回执（`[...hits]`、`{...view}`）。
  - `STUDIO_TOOLS`（按 `comment/heartbeat/article/kb-search/evidence-write/budget-query` 固定顺序的 `as const` 元组）、`STUDIO_TOOL_NAMES`（映射出 `GatewayAction[]`）、`StudioToolSummary{name,action,title,description,inputSchema}`、`studioToolSummaries()`（`z.toJSONSchema` 生成摘要）。
- **导出与依赖**：见 §二 表。允许 `zod`（值）、`@studio-next/gateway`/`@studio-next/contract`（**仅 type**）；禁止 import `./server.ts`、Node 内建、任何平台包或 daemon。层位随包，不得借类型获得跨域能力。
- **IO 与注入**：**零 IO**——无 fs/网络/子进程/SQLite/时钟/随机/env。IO 全部经 `ToolEnv.deps` 与 `ToolEnv.gateway` 由构造方注入；`run` 不读 `process.env`。`studioToolSummaries()` 的输出受 zod 版本影响（`$schema`/`required` 顺序等），不是字节稳定工件（75-§4.2、D75-08）：只作 prompt 摘要，不得当冻结 schema。
- **状态/事务/并发**：无可变状态；schema 与工具表是模块级常量；`run` 纯函数式（除注入后端副作用）。无幂等键、无事务边界、无锁、无重试、无超时、无取消——后端 Promise 永不 resolve 时，工具调用会悬挂；这是目标缺口（§八 G-01），不是现状保证。**幂等**：一次 `tools/call` 没有自己的幂等键，客户端重发就是第二次调用；目标不在此层造键，而由 `TS-PORT-EFF-01 EffectGateway.apply` 的幂等键承担（80-§6.6），本包只透传 `signed` 与 args。`evidence-write` 的重复写由后端 containment + 覆盖语义决定，本包不保证「写两次只留一份」。
- **错误与观测**：`run` 抛错不在本文件分类，由 `server.ts` 归 `deps`（三后端工具）或 `internal`；schema 失败在协议层，不进 `run`。本文件**没有**日志、事件、台账、指标；秘密不经过本文件（`signed` 只含署名与正文，不含 wkey）。目标错误面按 80-§5.7 两轴：`failure`（77 的 14 类，决定重试/断路/对账）+ `category`（11 值，只做观测）+ `subcause`（稳定细目）。**本包只定义 `subcause` 的取值与默认 `category`，不定义 `failure` 的逐值来源**：`failure` 必须由产生错误的那一层给（网关门面给拒绝性质、`SecretProvider` 给取用失败性质、后端端口给 `unavailable`/`timeout` 等）。现状 `GateWriteResult` 只有 `{allowed:false, reason}`、无 `failure`，因此工具面现在**无法**填出合法两轴——这是 78 的回写项（§八 G-05），不是本包可自行补的映射。
- **测试与证据**：`F-studio-tools-test-tools` 覆盖表对齐、输入拒收、输出判别并集、摘要形态；`F-studio-tools-test-server` 覆盖真实调用链。**不证明**：平台写入发生、后端实现存在、schema 跨版本稳定、描述对模型有效、`signed.args` 与实际执行参数一致（`run` 用的是 zod 后的 `args`，不是网关解析出的 `gated.args`；当前无 transform 故相等，未来加 transform 会产生分叉且无测试）。
- **规模与迁移**：335 行，预算 ≤600；目标不拆。若新增工具，必须同单改 `contract` 的 `GATEWAY_ACTIONS`（R27：清单沉默不得自动扩权），本文件只跟表；不得在此私加“内部专用工具”。

### 4.2 `F-studio-tools-server`

- **路径/处置**：`packages/studio-tools/src/server.ts`；目标-保留。
- **归属与上位锚**：实现层；78 `BIND-EDGE-MCP-01`（认证/广告面/边界/现状/损失）、80-§2.1、80-§5.7/§5.8（错误两轴与秘密边界）、**80-§11.4.1（stdio 只作传输层、验签在 daemon 侧、`_meta` 仅 legacy）**、80-§8.1（写者边界）、80-§12.2（dist 切换前不得与 `GATEWAY_ACTIONS` 漂移）。
- **职责**：把 `STUDIO_TOOLS` 注册进一个 `McpServer` 实例；为每次 `tools/call` 提供唯一公共闸（凭据 fail-closed → `gateway.gateWrite` → `run` → 结构化回执）；从 MCP `initialize` 的 `_meta` 捕获 wkey；暴露 `connect/close/wkeyInjected` 生命周期面。
- **非职责**：不是 transport 实现（只包装注入的 `Transport`）；不是网关（不签发/不验签/不持有 secret）；不是平台写入器（`gateWrite` 只验签+署名，不产生外部效果）；不是会话授权（wkey 是技术许可，不是公司授权，78-§11.4）；不管理 deps 生命周期；不落任何记录。
- **内部结构**：
  - `WKEY_META_KEY = 'studio-wkey'`（拟稿定名，待批准）；`SERVER_INFO_DEFAULT = {name:'studio-tools', version:'0.1.0'}`（与 `package.json` 版本手工同步，无测试钉住——漂移风险）；`DEPS_BACKED = Set{'kb-search','evidence-write','budget-query'}`；`GATE_DENY_HINTS`（`Readonly<Record<GateRejectReason,string>>`，14 键：7 个 `gw-verify-*`、5 个 `gw-action-*`、`gw-action-mismatch`、`gw-freeform-chinese`；键集由 TS 的 `Record` 完整性保证，值是人读提示）。
  - 私有类型桥 `McpSchemaOf<T extends z.ZodType> = StandardSchemaWithJSON<z.output<T>, z.output<T>>`：zod 4.6.7 的**类型声明**未覆盖 MCP 需要的 JSON Schema 面；桥只在三处 `registerTool` 实参位内联使用。退出条件：zod 类型补齐后删除本类型与三处 `as unknown as`（79-§3.2、79 `DEP-MCP-SERVER`）。注意 `server.ts` 的 `import { z } from 'zod'` 只用于类型位置，`verbatimModuleSyntax` 下仍会保留为运行时 import；目标可降为 type-only，但须验证 `.d.ts` 发射（未证）。
  - `StudioToolsServerOptions{gateway, deps, wkey?, serverInfo?}`；目标把 `gateway` 的**类型**从 `Gateway` 放宽为包内 `ToolGate`（字段名不变，避免无谓的公共面破坏；`Gateway` 结构上仍可用）：库面注入真 `Gateway`，stdio helper 注入 `stdio.ts` 的薄适配（内部转 `daemon-link.gate(tool,args)`，形状差与替代方案见 §八 G-17）。`gateway` 仍是**只读注入**，本包不构造；`ToolGate` 不导出到包根（只在 `.d.ts` 里作为注入位的参数类型出现，属必要暴露，**不得再扩方法**——唯一例外是放行分支的可选 `outcome`（§八 G-19），须随 M4 同批裁决）。`StudioToolsServer{mcp:McpServer; connect(transport):Promise<void>; close():Promise<void>; readonly wkeyInjected:boolean}`。
  - `withInitWkeyCapture(inner,onWkey)`：返回一个 `Transport` 代理；仅在**第一条** `method==='initialize'` 的消息上读 `params._meta[WKEY_META_KEY]`，值为非空字符串才回调；`seenInitialize` 置位后不再捕获；`start/close/send/sessionId/onerror/onclose` 原样转发；`onmessage` 的 setter 把下游处理器存起并把 `inner.onmessage` 设为拦截器。入/出消息字节不改写。**目标降为 legacy**：当构造期已给 `wkey`（stdio 入口从每单 env 取）时，`connect` **不包装**捕获器，`_meta` 值一律忽略（否则后到握手会覆盖 env 通道，形成「旧通道改写新通道」）；只有未给 `wkey` 的库面调用才包装。捕获来源只记类别（`env`/`meta`/`none`）到 stderr，不记值。
  - 私有 `okResult(action,fields)`：`{ok:true, action, ...fields}` 同时作为 `content[0].text`（JSON 串）与 `structuredContent`，`isError` 缺省；私有 `denyResult(error)`：现状 `{ok:false, error}` + `isError:true`；**目标** `error` 为 `{failure,category,subcause,detail?}`（80-§5.7 两轴），`detail` 必须过脱敏且不含绝对路径（§5.5/§5.6）；私有 `encodePayload(action,args)`：**目标**调网关集中实现的 `encodeAction(action,args)`（单行 `@action <verb> <json>`；80-§11.4.1 要求编解码集中在网关）；`packages/gateway` 现状**没有** `encodeAction`/`decodeAction`、也没有纯子路径导出，未落地前由构造方注入，本文件**不得**再拼第二份格式（§八 G-17）；私有 `runTool(spec,args,env)`：0) `env.wkey()` 为空 → 拒绝（`subcause:'missing-wkey'`，`failure:'rejected_authority'`，与 80-§9.4 的 401 同轴；不碰网关、不烧 nonce）；1) `gateWrite(token, spec.name, payload)`（`await`；`env.gateway` 只要求 `ToolGate` 的这一个方法），`allowed:false` → 拒绝，`subcause` 为网关原码、`failure` 由网关给（目标）；现状网关不带 `failure`，工具面**不得猜**，映射待 §八 G-05（见 §5.5）；2) 放行分支带 `gated.outcome` 时**跳过** `spec.run`、直接 `okResult(action,{outcome:gated.outcome})`（stdio 写面由 daemon 代执行；`allow` 无 `outcome` 只准按 `unsupported`/`verdict-without-result` 拒绝，§4.9/§八 G-19）；否则 `await spec.run(args, env, gated.signed)` → `okResult`；异常按 `DEPS_BACKED` 分 `deps` 类（`subcause`=`<tool>-failed`，`failure` 取后端 `ClassifiedError`，后端没给则 `unavailable`）或 `internal`（`subcause:'internal-bug'`、`failure:'rejected_precondition'`、`category:'CONFIG_INVALID'`——80-§5.7 第 752 行把「编程错误/不可继续」固定到这两个值，并明确**不造第 15 个 failure**；同时必须写一条事件 note，不得只留在工具回执里）。
  - **超时/取消（目标）**：`gateWrite` 是同步纯函数；`spec.run` 的三个 deps 后端是 `Promise`。目标给 `StudioToolsDeps` 的每个方法加可选 `signal?: AbortSignal` 或统一由 `runTool` 侧 `Promise.race` 一个 `timeoutMs`（取值来自 `ServeConfig`/构造注入，**不在本包写死数字**），超时映射 `failure:'timeout'`+`category:'STALL'`，且**必须先对账**（不重试）。注入面未定时**不做**，也不在文档里承诺「已可取消」。
  - `createStudioToolsServer(opts)`：创建 `cell:{token}`、`env{wkey:()=>cell.token}`、`new McpServer(opts.serverInfo ?? SERVER_INFO_DEFAULT)`；用 `register` 逐条注册六个规格（顺序固定）；返回 `{mcp, connect: transport => mcp.connect(withInitWkeyCapture(transport, wkey => cell.token = wkey)), close: () => mcp.close(), get wkeyInjected()}`。
- **导出与依赖**：见 §二。运行时 import：`@modelcontextprotocol/server`（值）、`zod`（值但仅类型使用）、`./tools.ts`（值 `TOOL_SUBCAUSES` 与六规格）；类型 import：MCP 的 `CallToolResult`/`Implementation`/`JSONRPCMessage`/`MessageExtraInfo`/`StandardSchemaWithJSON`/`ToolCallback`/`Transport`、`@studio-next/gateway`、`@studio-next/contract`。禁止 import gateway 的**值**（`createGateway` 会引入 secret 处理与签发能力）。
- **IO 与注入**：唯一的 IO 面是注入的 `Transport`（`connect`）与注入的 `deps`/`gateway`；无 fs/网络/时钟/随机/子进程/env。时钟、nonce、secret 全在宿主构造的 Gateway 里，本文件不生成。`serverInfo` 可注入以支持多版本并存测试。
- **状态/并发/恢复**：`cell.token` 是**每 server 实例一份**的可变单元；`seenInitialize` 是**每 transport 包装一份**。因此：同一 server 对象被多个连接 `connect` 时，后到的握手会覆盖先到的 token，且先连接的在途调用会读到新 token（last-handshake-wins）；无锁、无版本、无 fencing。**目标收窄**：stdio 面是「一进程一连接一 server」，多连接复用同一实例属**不支持用法**（写入 README 与 `connect` 注释），不得靠 last-handshake-wins 当会话切换；env 优先时根本不包装捕获器，覆写路径不存在。`close()` 只关 MCP，**不吊销** wkey（吊销在 daemon/网关，80-§11.4.1 第 2 条），目标额外清空本进程内的 `cell.token` 并尽力 abort 在途 deps（有 signal 时）。无重连语义（见 `F-studio-tools-test-server` 未证项）。无超时：`deps` 或 `gateWrite` 悬挂即调用悬挂（目标见上「超时/取消」，未定则不做）。
- **错误与观测**：运行期拒绝**不抛**，一律转 MCP 结果（`isError:true` + 结构化 `ok:false`）；构造期非法（缺失 gateway/deps）由 TypeScript 与运行时属性访问自然失败——**目标**改为经 `configInvalid(...)` 抛 `ClassifiedError`（`failure:'rejected_precondition'`、`category:'CONFIG_INVALID'`），与 80-§5.7 的构造期口径一致；现状不一致是缺陷（§八 G-05 第 3 项）。`denyResult` 现状把 `err.message` 原样拼入 `message`：可能含绝对路径、后端内部细节，违反 80-§5.8 的秘密/路径边界；**目标**：`detail` 先过 `redactOutbound`/`findSecretShaped`（从 `contract` 取，**不得**从 `core`、**不得**自写正则），并做路径替换（只留逻辑名），无法消毒就不带 `detail`。**无日志/事件/指标**：调用成功与拒绝只在返回值里，不回台账、不发通知；目标至少要有一条调用事件（工具名、`failure`/`subcause`、`traceId` 本包不生成——`traceId` 归 daemon/API 面，MCP 面不伪造）。
- **测试与证据**：`F-studio-tools-test-server` 22 例覆盖：六工具 happy path、`tools/list` 广告面、无 key/非字符串 key、五类坏 key、协议层拒坏输入、三后端失败归类、宿主直注与握手覆写。**不证明**：真实 stdio、真实 executor 挂载、跨进程吊销、`withInitWkeyCapture` 的重连/多连接语义、`close()` 效果、并发、超时、长正文、路径 containment、错误消息消毒、平台写入（本文件根本没有写原语）。目标两轴错误体落地的同批，这 22 例中所有 deny 断言会先红（`category` 值域从四族变 11 值、新增 `failure`）——这是**期望的失败**，必须同批改用例，不得为保绿而保留旧形状。
- **规模与迁移**：264 行，预算 ≤600；目标不拆。stdio 绑定**不并入**本文件：传输与进程生命周期在 `stdio.ts`、IPC 裁决在 `daemon-link.ts`，本文件只多一个 `ToolGate` 注入位与超时/消毒代码（预计 +60~90 行，仍 <600）。`McpSchemaOf` 的删除是**内部**退出，不改变导出签名，不构成替换件。迁移顺序：M2 加负向用例（不复用旧断言）→ M3 改错误体/消毒/构造期 `configInvalid`/`ToolGate` 放宽（超时需 80 定 `signal` 或注入面，未定则不在 M3 做，也**不占** M4 的 stdio 波次）。

### 4.3 `F-studio-tools-index`

- **路径/处置**：`packages/studio-tools/src/index.ts`；目标-保留。
- **归属与上位锚**：实现层；79-§4.4 源码态入口；80-§12.2（dist 后的 `exports["."]` 由本文件发射）。
- **职责**：包的唯一公共出口，`export * from './tools.ts'` 与 `'./server.ts'`；文件本身零逻辑、零副作用。
- **非职责**：不装配 server（不读 env/不建 gateway/不连 transport）、不注册工具、不做初始化、不导出测试入口、**不导出 `stdio.ts`/`daemon-link.ts`**（两者含进程与 socket 副作用）。
- **内部结构**：两条 `export *`；头部注释记录组成、协议依据与待批项（`_meta` 键名已定为 legacy、大正文上限未定、`evidence-write` containment 责任方未定）。无类型、常量、函数。
- **导出与依赖**：转发两文件的全部符号；只依赖两个同包模块。禁止 `export * from './stdio.ts'`（入口若被 import 会拉起 stdio 副作用）、禁止 `export * from './daemon-link.ts'`（会拉起 socket 客户端），也禁止 default export。
- **IO 与注入**：N/A（零 IO、零注入）。
- **状态/并发**：无状态；ESM 模块单例语义只影响 schema/表常量的身份。
- **错误与观测**：N/A（不执行逻辑，不产生错误/日志）。
- **测试与证据**：无直接测试；`server.test.ts`/`tools.test.ts` 都从具体文件导入而非从包根，故**没有**“包根导出完整性”测试。这是缺口：`export *` 新增文件时会静默扩大公共面，且删符号不会红。目标：改为显式命名导出，并加一条包根冒烟（只 import 包根，断言 `STUDIO_TOOLS`/`createStudioToolsServer` 在、`stdio` 符号**不在**）——属实现选择，不是上位强制；但「不得从包根漏出 stdio」是硬约束（§1.2）。
- **规模与迁移**：20 行；预算 ≤600；不拆。dist 切换后本文件发射为 `dist/index.js`，其再导出路径由 tsc 重写；`.d.ts` 的 `.ts` 说明符问题属 79-§5.5 U1/U2（80 `U80-02`），未证。

### 4.4 `F-studio-tools-test-server`

- **路径/处置**：`packages/studio-tools/src/server.test.ts`；目标-保留 / 仅测试（与生产同目录）。
- **归属与上位锚**：验证层；78 `BIND-EDGE-MCP-01` 的认证/广告面/边界；80-§12.3（测试覆盖注入点）；82 的 V2/V4 登记对象（本附录不写 82）。
- **职责**：以**进程内真实协议层**（`InMemoryTransport` + 手搓 JSON-RPC 客户端）验证 server 工厂：注册面、握手捕获、fail-closed、拒绝码透传、协议层 schema 拒、deps 失败分类、注入优先级。
- **非职责**：不验证真实 stdio 进程、不验证 dsh/claude 挂载、不验证跨进程吊销、不验证平台写入、不验证性能/并发/超时；不测 `withInitWkeyCapture` 的重连语义；不测 `close()` 的副作用。
- **内部结构（夹具与 helper，全部内联，无外部夹具文件）**：
  - 常量 `SECRET`（32 字节全 7，测试专用非真实秘密）、`SIG_CTX`（演示公司/平台部/工程师/3）、`EXPECT_SIG='[演示公司·平台部·工程师·3]'`。
  - `GateCall{action,payload}`；`recordingGateway(inner)`：包装真 Gateway，记录 `gateWrite` 入参后委托，**鉴权语义全走真实现**（不是 fake 网关）。
  - `DepsLog{evidence,queries,budgets}`；`fakeDeps(log, failures?)`：三后端的纯内存 fake，可注入 `Error` 以验证分类；`writeEvidence` 返回 `content.length`，`searchKb` 返回固定一条命中，`queryBudget` 返回固定视图。
  - `Fixture{server,calls,log,issueKey(scope?,ttl?),tick(minutes)}`；`makeFixture(opts?)`：固定时钟 `1_000_000_000_000`、固定票号 `T-1`、`createGateway` 真实现；`issueKey` 每次用 `randomUUID()` 生成 nonce；`tick` 推进注入时钟。
  - `RawToolResult`、`MiniClient{callTool,listTools,close}`；`connectClient(server, initMeta?)`：`InMemoryTransport.createLinkedPair()`，手写 pending map 与 id 递增；只发四种消息：`initialize`（协议版本 `2025-06-18`）、`notifications/initialized`、`tools/call`、`tools/list`；不覆盖 resources/prompts/采样等协议面。
  - 断言 helper：`expectOk`（`isError` 假 + `{ok:true,action}` + 返回 structuredContent）、`expectDeny`（`isError` 真 + `{ok:false,error{category,subcause}}`）、`expectGateCall`（action 相符、payload 以 `@action <verb> ` 开头、无换行、JSON 段与参数 `toEqual`）。
- **覆盖清单（22 例，静态计数 = 6+1+2+5+2+3+3）**：happy path 6（comment/heartbeat/article/kb-search/evidence-write/budget-query，全部断言 `gateWrite` 的 action 与单行 payload）；`tools/list` 1（名字同序、描述长度 >8、`inputSchema.type==='object'`）；无 key 2（六工具全 `missing-wkey` 且网关/deps 零调用；`_meta` 非字符串被忽略）；坏 key 5（`gw-verify-malformed`/`bad-signature`/`scope`/`expired`/`replay`）；协议层 schema 拒 2（空 body、多余字段 → `isError` 且网关零调用）；deps 失败 3（`evidence-write-failed`/`kb-search-failed`/`budget-query-failed`）；注入通道 3（`wkeyInjected` false→true、`opts.wkey` 直注、握手覆写初值）。
- **目标追加（M2，预计 +80~120 行）**：① deny 体形状：`error` 含 `failure`/`category`/`subcause`，且 `category` 只取 6 个可达值（`CONFIG_INVALID`/`EVOLVE_REJECT`/`EXTERNAL_REJECT`/`STALL`/`MERGE_CONFLICT`/`NO_LANE`），出现 `GATE_FAIL`/`WORKER_DEAD`/`QA_BACK`/`DISPATCH_FAIL`/`LLM_FAIL` 即判负；② 消毒：后端抛含绝对路径/疑似 token 的错误，`detail` 必须被替换或缺失；③ env 优先：构造期给 `wkey` 时，`initialize._meta` 的异值**不覆写**；④ `close()` 后 `cell.token` 为空、`wkeyInjected=false`；⑤ 超时（若 80 定了注入面）：后端悬挂 → `failure:'timeout'` 且不重试；⑥ 构造期缺 `gateway`/`deps` → 抛 `ClassifiedError`（`CONFIG_INVALID`），不是 TypeError。
- **覆盖不到的拒绝码**：`gw-verify-revoked`、`gw-verify-ticket-mismatch`、`gw-action-not-an-action`、`gw-action-bad-format`、`gw-action-unknown-verb`、`gw-action-bad-json`、`gw-action-bad-args`、`gw-action-mismatch`、`gw-freeform-chinese`。其中 revoked 只在 daemon 的 `worker-key-lifecycle.test.ts` 以**同进程共享 Gateway** 形态覆盖（跨进程不可见）；其余在本包**无覆盖**，是否由 gateway 包自身用例覆盖须以 `81-files/06` 的实测为准，本附录未核其用例清单。**并且**：这 14 个拒绝码各自应映射到哪个 `failure`（77 的 14 类之一）**没有任何上位表**——测试在当前代码下只能断言 `subcause`={网关原码}，断言不了 `failure`（§八 G-05）。
- **fake 边界**：Gateway 是**真纯逻辑**（无 IO），deps 是 **fake**，transport 是 SDK 的 **InMemory**（真协议编解码，假传输）。因此测试证明“协议 + 真网关内核”的组合行为，不证明“真实平台/真实文件/真实子进程”。`fakeDeps` 不受 `knowledgeScope`、不做 containment、不做只读校验，所以它对 80-§11.4.1 四行映射**只证形状不证约束**；按 80-§6.6「`fakes.ts` 只许 demo/测试」，这些 fake **不得**进入 `buildServeRuntime`，也不得作为真实公司激活的注入。
- **不证明**：`opts.wkey` 用例用**另一 fixture**签发的 token（同 secret/票号/时钟），因此只证明“同密钥即可用”，不证明 daemon 派工接线；`randomUUID` nonce 未断言；`article` 用例证明 `gateWrite` 收到 markdown，但不证明知识库发生 upsert；`comment/heartbeat/article` 的回执来自 `signed`，不证明平台存在该评论/心跳/文章。**也不证明**：env→`opts.wkey` 的投递链（该链在 `worker-key.ts` + adapters，属 `81-files/16`）。
- **证据层级**：V0/V1（静态/结构）→ 由 `tools.test`；V2（行为契约，进程内）→ 本文件；V4（故障/安全）→ 部分（坏 key、deps 抛错、协议拒），**缺**跨进程、并发、超时、大正文、路径越界、吊销可见性；V5（真机）→ **未执行**；V3/V6 → N/A（无第二实现、无自治评估）。
- **规模与迁移**：440 行；预算 ≤600；目标追加用例预计 +80~120 行，逼近 600 时预案是拆出 `src/server.credentials.test.ts`（仅测试，仍属 `src` 平面，`src` 总件数升到 9 仍 ≤25），**不**上调阈值。拆前先按「凭据/注入」与「协议/错误」两个面判断是否真到 600，不预拆。

### 4.5 `F-studio-tools-test-tools`

- **路径/处置**：`packages/studio-tools/src/tools.test.ts`；目标-保留 / 仅测试。
- **归属与上位锚**：验证层；80-§2.1/78 `BIND-EDGE-MCP-01` 的“同表”纪律；80-§5.10（`strictObject` 的边界分类）；82 的 V0/V1 登记对象。
- **职责**：钉死 `STUDIO_TOOLS` 与 `GATEWAY_ACTIONS` 的同名同序、六工具输入 schema 的收/拒、deny 分支的错误面冻结、摘要形态与 `required` 形态。
- **非职责**：不启动 MCP server、不碰网关、不碰 deps、不测协议层；不证明描述质量或 schema 跨版本稳定。
- **内部结构（夹具与 helper）**：`good: Record<GatewayAction, Record<string,unknown>>`（六工具合法样本，兼作“契约动作集合完整”的编译期钉子：缺一个动作会少键）；`deny`（一个合法 deny 样本；**目标**改为两轴形状 `{failure,category,subcause}`）；其余为内联断言，无 helper 函数。
- **覆盖清单（21 例，静态计数 = 3+12+4+2）**：对齐 3（名字同序+长度、title/description 齐备且不含 `'怎么调'`、工具名不含状态词）；输入 12（`it.each` 六动作各 1 + comment 空 body/缺 issue + heartbeat 空/错型 + article 空 path/多余字段 + kb-search 非串/多余字段 + evidence-write 空 content + budget-query 空对象）；输出 4（deny 过判别并集、非冻结 `category` 拒、四族常量、ok 分支缺字段拒）；摘要 2（六摘要的 `name/action/description/inputSchema`、comment 的 `required` 顺序）。**目标改动**：输出 4 例中的「非冻结 category 拒」「四族常量」两例按 §二 退役 `TOOL_ERROR_CATEGORIES` 后**必然红**，改为「`category` 只收 11 值」「`failure` 必填且只收 77 的 14 值」「`detail` 可选且不含绝对路径」三条；总例数 21 → 22，仍是静态可复算计数。
- **fake 边界**：无 fake——纯 zod 与静态常量；`GATEWAY_ACTIONS` 来自 `@studio-next/contract`，是本测试的**唯一真源**（不是本包自证）。
- **不证明**：`z.toJSONSchema` 的字节稳定性、`$schema` 版本、`additionalProperties:false` 的实际形状（只断言 `type/properties/required`）、MCP 广告面（由 `server.test` 覆盖）、网关接受、后端存在。
- **脆弱锚点**：`tools.test.ts:105` 在“输出 schema”的 `it` 里调用 `BudgetQueryInput`（源码注释自称“邻 schema 烟囱”），与用例名不符；`tools.test.ts:139` 断言 `required` 数组**顺序**恰好 `['issue','body']`（zod 发射顺序变化即红）；`description` 禁 `'怎么调'` 子串、工具名禁 `state|transition|move|close|resolve` 子串，均为字面匹配，可能误伤合法新名。
- **证据层级**：V0/V1；V2 仅“schema 行为”这一薄层；V3/V4/V5/V6 N/A（本文件不起进程、不碰网络/文件、无跨实现与自治语义）。
- **规模与迁移**：141 行；预算 ≤600；不拆。若 `GATEWAY_ACTIONS` 扩表，本文件的 `good` 记录与 `it.each` 会先红——这是设计意图，不修测试通过。

### 4.6 `F-studio-tools-manifest`

- **路径/处置**：`packages/studio-tools/package.json`；目标-保留（内容分波次改）。
- **归属与上位锚**：实现/构建层；79-§4.4（两态导出）、§6.5（目标 exports/files）、§7.1（files 白名单）、`DEP-MCP-SERVER`；75 D75-07（JS+`.d.ts` 分发）。
- **职责**：声明包身份、ESM 形态、源码态入口、两个脚本（`typecheck`/`test`）与四条依赖。
- **非职责**：不声明发布（`private:true`）、不声明 `bin`、不声明 `files`/`license`/`publishConfig`/`engines`；这些是目标缺项，不是现状能力。
- **内部结构**：`name/version/private/type/description/main/exports{.}/scripts{typecheck,test}/dependencies{4}`。`description` 里写死「六工具与 GATEWAY_ACTIONS 一一对应、wkey 初始化注入 fail-closed、typed schema 拒坏输入」——与代码一致，但扩表时需同步；**目标**：`description` 不得再写「初始化注入」为唯一通道（env 优先、`_meta` legacy）。
- **导出与依赖**：`exports["."]="./src/index.ts"`；依赖四条的裁决见 §1.3。`scripts.test = "vitest run"` 与根 `bun run test`（`vitest run --passWithNoTests`）并存；包级 `typecheck` 与根 `tsc --noEmit` 覆盖同一批 `src/**/*.ts`（含测试），当前是**重复覆盖**而非缺口。
- **IO 与注入**：N/A（manifest 不执行）。构建/测试工具链由根脚本提供。
- **状态与并发**：N/A。版本 `0.1.0` 与 `SERVER_INFO_DEFAULT.version` 手工同步，无自动校验。
- **错误与观测**：N/A。缺 `engines` 字段不构成运行期约束（根 `engines.node>=24` 已覆盖 MCP 的 `>=20`）。
- **测试与证据**：没有针对 manifest 的测试（对比 `dsh-bridge` 有 exports/patch 断言）。因此 `exports` 指向、`files`、`license` 变更不会被本包测试发现，只会被根构建/发布流程发现。
- **规模与迁移**：21 行。**M5（dist 切换）**：`main`/`types`/`exports["."]` 改 `dist`，**新增 `exports["./stdio"] → "./dist/stdio.js"`**，加 `files:["dist","README.md","LICENSE"]`、`license` 字段（值待制作人）；**不设 `bin`**（helper 由 MCP client 按显式路径 spawn，不是全局命令——v0.1 把「缺 `bin`」当缺口是错的，真正缺的是子路径导出，见 §八 G-07）。若将来要把 helper 做成可执行命令，才需要 `bin` + `chmod`，那属另一次批示，不在本卷。daemon 的 `devDependencies` 两条（`@modelcontextprotocol/server`、`@studio-next/studio-tools`）**不动**：stdio 入口在本包，daemon 生产 `src` 仍零 import；若将来 daemon 要内置 socket 服务端并复用本包类型，才需重判 79-§10.1 第 9 项（§八 G-07）。

### 4.7 `F-studio-tools-tsconfig`

- **路径/处置**：`packages/studio-tools/tsconfig.json`；目标-保留。
- **归属与上位锚**：构建层；79-§1.3（NodeNext/ESM/严格开关）、§2.1（仓内稳定习惯）、§4.1（解析规则）、§6.1（切换后包级 typecheck 仍须在）、`81-files/19` 的根 program 约束。
- **职责**：包级类型门禁——`extends ../../tsconfig.base.json`、`include:["src/**/*.ts"]`（含测试）。
- **非职责**：不发射产物（继承 `noEmit:true`）、不设 `outDir/rootDir`、不设 `paths`、不设 project references、不覆盖严格开关。
- **内部结构**：两条键（`extends`、`include`）+ 一条注释。无 `compilerOptions` 覆盖——这是正确的“不逐包放松”。`node:net`/`node:process` 所需的类型来自根 `tsconfig.base.json` 的 `types:["node"]`（79-§1.3），**不需要**在本包加 `types` 或开 `DOM`；新增 stdio 件不得借此引入 `lib.dom`（那会让 `fetch`/`WebSocket` 之类在本包“看起来可用”）。
- **导出与依赖**：N/A（配置）。
- **IO 与注入**：N/A（tsconfig 是被 tsc 读取的静态配置，不执行、不产生运行期 IO）。
- **状态与并发**：N/A（配置无运行期状态；并发只体现在多个 tsc 进程各读一份，无共享写）。
- **错误与观测**：`tsc --noEmit -p` 的退出码即门禁结果；当前根 `tsc --noEmit` 与本文件覆盖同一批文件，任一红都可见。
- **测试与证据**：本附录未运行 `tsc`；配置正确性只按 79 的静态约束核对，未取运行证据。
- **规模与迁移**：5 行。dist 切换时**保持不变**（79-§6.1 第 3 条：包级 `tsconfig.json` 仍 include `src`），另建 `F-studio-tools-tsconfig-build`；根 `tsconfig.json` 需把本包移出 `include`（归 `81-files/19`），根 `typecheck` 脚本需串接本包检查（归 19）——本附录只登记依赖，不越权修改。

### 4.8 `F-studio-tools-readme`

- **路径/处置**：`packages/studio-tools/README.md`；目标-保留（陈述修正，非能力升级）。
- **归属与上位锚**：实现说明/人读文档；78 `BIND-EDGE-MCP-01`、80-§2.1、79-§6.5；不得把 README 当规范或能力证明（75-§0.2）。
- **职责**：说明包定位、六工具表、组装示例、鉴权与错误口径、测试边界、依赖版本、拟稿待批点。
- **非职责**：不是契约（工具表真源是 `contract` 的 `GATEWAY_ACTIONS`）、不是安装手册、不证明挂载可用。
- **内部结构（现有章节）**：标题与定位引文；「工具表」表（工具/动作/何时用/deps 后端）；「组装」TS 示例（`createStudioToolsServer` + `InMemoryTransport`）；「鉴权与错误口径」五条；「测试与验收」（43 例、不起真 stdio、不引 client）；「CLI 挂载样例」两段 `jsonc`（dsh 插件、claude `--mcp-config`，均标【拟稿待核】/【拟稿】）；「依赖与版本」；「拟稿待批点」四条。
- **导出与依赖**：N/A（文档）；示例引用 `@studio-next/studio-tools` 包根。
- **IO 与注入**：N/A（纯文档，无运行期 IO 与注入面）。
- **状态与并发**：N/A（纯文档，无运行期状态）。
- **错误与观测**：文档里的挂载样例把路径写成 `<repo>/apps/daemon/src/cli/studio-tools-stdio.ts` 并设 `env.STUDIO_TOOLS_WKEY`——**该文件不存在**，且本包**不读 env**（只有 `_meta` 与 `opts.wkey` 两条现状通道）。这是 README 最危险的陈述：照抄会得到一个“启动但永远 `missing-wkey`”的挂载。**目标**：路径改为本包 stdio 子路径（`@studio-next/studio-tools/stdio` 或 `.../dist/stdio.js`），并说明「env 通道由 `stdio.ts` 读取、`_meta` 是 legacy」；在 `stdio.ts` 未落地前，样例必须标「入口不存在」，不得给出可复制命令。
- **测试与证据**：README 的「43 例」与静态计数一致（server 22 + tools 21 [=15 单例 + 6 展开]）；「不起真 stdio」「不引 `@modelcontextprotocol/client`」经 import 核查为真（全包无 `node:net`、无 client 包）；「实锁 2.3.1 / zod 4.6.7」与 `bun.lock` 一致。其余（挂载形态、env 键名、大正文上限、nonce 会话复用）均未证。
- **规模与迁移**：118 行。**M1** 目标修订：① 首段加状态标签「库级·未接，生产链零消费者，无 stdio 入口（U80-17）」；② 工具表逐项加「是否产生外部效果」列（comment/heartbeat/article=否，仅署名回执；三后端=只经注入 deps）；③ 挂载样例改为「目标形态 + 当前不可用」两段，删掉不存在的路径与「照抄即用」语气；④ 删「43 例」硬编码，改为复算公式（22 + 15 + 6）；⑤ 修正 `article` 描述里的「可复复用的」错字（源码 `tools.ts` 同批改，属 M3 文案，不改 schema）；⑥ 鉴权口径改为「env 优先 / `_meta` legacy / 不收 `gatewaySecret`」；⑦ 错误口径改为两轴（`failure`+`category`+`subcause`），并注明逐拒绝码的 `failure` 映射待 78（G-05）；⑧ 把「拟稿待批点」升为明确阻塞项并指向 §八。README 不得写成“stdio 已接”。

### 4.9 `F-studio-tools-stdio`（目标-新增）

- **路径/处置**：`packages/studio-tools/src/stdio.ts`；目标-新增；**现状不存在**（全包无 `node:net`、无 `StdioServerTransport`），按 80-§12.5 `U80-17` 记「未实现、未证」。v0.1 的「方案未定、不得实现」作废：80-§11.4.1 已给协议（helper 先做三步 challenge-proof 注册、逐调用裁决、stdio 只作传输层），本文件按该协议写契约，**但落地仍有三项外部前置**（见下「前置与分段」）。
- **归属与上位锚**：绑定层实现；78 `BIND-EDGE-MCP-01`（传输=stdio、现状 blocking）；**80-§11.4.1 第 1–4 条**（env 优先、daemon 侧验签、stdio 只作传输、helper 注册协议 + 本地 socket `run/daemon.sock`/`STUDIO_DAEMON_SOCK`）；`U80-17`（探针清单）；79-§6.5（子路径导出需回写）。
- **职责**：把 MCP 客户端经 stdio 拉起的 helper 进程接到**同一个** `createStudioToolsServer` 注册面，并且**只做三件事**：① 传输绑定（stdin/stdout ↔ `Transport`）；② 凭据取件（每单 env 优先；`_meta` legacy 由 `server.ts` 处理）；③ 进程生命周期（三步注册 → 服务 → 关闭/退出），并在注册时用**本进程内存里的本单 wkey 算一次 `registerProof`**（输入是 `studio-next/jcs@1` 序列化的五键对象，HMAC 的 message 就是那串字节；算完即弃中间值）。它**不验签**：每次 `tools/call` 的放行判定经 `daemon-link` 送 daemon，由 daemon 侧完整验签/查吊销/审计（80-§11.4.1 第 2 条、第 4 条）。
- **非职责（硬约束）**：不构造 Gateway、**不读也不接受 `gatewaySecret`（`SEC-GW-SIGNING`）**、不签发 wkey、不读台账、不直写公司目录/证据目录、不自建 nonce 表（worker 内存 nonce 不能防重放，80-§11.4.1 第 3 条）、不解析 CLI 业务参数、不新增工具或注册面、不从 `index.ts` 导出、不把 wkey/socket 路径写日志。
- **内部结构与输入输出**：
  - 入口 `runStdio(opts)`（导出供测试注入；模块底部有「被当主模块执行」的自执行守卫，`argv[1]` 与 `import.meta.url` 比对）：输入 `{env, stdin, stdout, stderr, wkeyRef?, makeLink?}`；`env` **只读两键**——`STUDIO_TOOLS_WKEY`（每单凭据，**80-§11.4.1 第 1 条已定名**；= `worker-key.ts:62` 的 `WORKER_WKEY_ENV_KEY`，源码注释的“拟稿定名”待 `81-files/16` 落定稿）、`STUDIO_DAEMON_SOCK`（socket 路径覆盖；缺省相对 daemon 工作目录的 `run/daemon.sock`，**不得**写死绝对路径）。`wkeyRef` **不是 env 键、不是秘密**：按 80-§11.4.1 第 4 条它是**逻辑引用** `SEC-WKEY-<ticketId>`，由凭据范围里的 `ticketId` 派生——本文件只对 env 里的 token 做**结构性解码**取 `ticket` 字段（`gateway/src/wkey.ts` 冻结的 `base64url(payloadJson).base64url(mac)` 形状；**不验签、不信任 payload 其余字段、不据此授权**），解码失败即 `stdio-config-invalid`。`opts.wkeyRef` 仅为测试/宿主覆盖位，注入值仍必须是逻辑引用，**注入 wkey 原文即判负**。凭据本体只留在进程内：只用于满足 `createStudioToolsServer` 的 presence 门，**不进任何帧、日志或结果**。
  - 组装顺序（**三步注册，缺一不得服务**，与 80-§11.4.1 第 4 条逐字对齐）：`makeLink(env)` → `link.register({helperId, pid, wkeyRef}, prove)`：link 发 `register`（**恰三键、不带 `reqId`**；`register` 只是**申请**，不构成证明）→ 收 `registerChallenge{challenge, alg:'hmac-sha256-v1', expiresAt}` → 调本层传入的 `prove` 算 `proof`：对象**恰五键** `{protocol:'studio-next/stdio-register@1', challenge, helperId, pid, wkeyRef}` 先按 **`studio-next/jcs@1`**（RFC 8785 基线，76-§1.5.1）序列化成 UTF-8 字节（JCS 按键名字典序输出为 `challenge`/`helperId`/`pid`/`protocol`/`wkeyRef`；`pid` 是 JSON number、`challenge`/`wkeyRef` 是原文 ASCII；无空白、无平台换行），再 `proof = base64url(HMAC-SHA256(key = wkey 原文, message = 该字节))`（`node:crypto`；算完即弃中间值）。`alg:'hmac-sha256-v1'` 同时冻结「JCS 规范化 + 域串 `studio-next/stdio-register@1` + SHA-256 HMAC」整套，换任一环必须换 `alg` 版本；**不得**用 `a+b+c` 拼接、空格分隔或 `JSON.stringify` 默认键序。→ 发 `registerProof{proof}` → 收 `registerAck`。`ok:false`/challenge 过期/超时 ⇒ stderr 一行原因 + 非零退出，**不接 transport**；`ok:true` ⇒ `createStudioToolsServer({gateway: linkAsToolGate, deps, wkey: env.STUDIO_TOOLS_WKEY})` → `connect(new StdioServerTransport(stdin, stdout))` → 静默服务。JCS 规范化器必须与 daemon **共用同一份实现**（不得本地私写键排序/转义；§八 G-18 已关闭，规范化器落地见 G-21）。注入的 `wkey` **只满足 `server.ts` 的 presence 门**（无 env 凭据即 `stdio-config-invalid` 非零退出），`link` 的裁决**不使用它**，也绝不进 `detail`/stderr/任何帧。`linkAsToolGate` 是 stdio 内的薄适配：`daemon-link` 按 80 的 `call` 帧只收 `{reqId,tool,args}`，而 `server.ts` 的 `ToolGate.gateWrite` 传的是 `@action <verb> <json>` 行——适配层必须用**网关的** `decodeAction`（80-§11.4.1「`encodeAction`/`decodeAction` 集中在网关」）还原 `args`，不得自写第二份解析（§八 G-17）；`daemon-link` 绝不解析 `@action`。
  - `deps` 的构造：**本文件不提供生产 deps**，也不提供“能返回数据”的替身。stdio 模式下**写路径由 daemon 代为执行**（80-§11.4.1：daemon 按 `scope[action]` **现签一次性调用 key** 过 `gateWrite`，结果经 `verdict.result` 回传**脱敏后**的 `EffectOutcome`），helper 侧不执行 `run`、不碰平台、不持那个内部 key。读面（`kb-search`/`budget-query`）在 `verdict.result` 里**没有承载位**（该字段只有 `applied{receiptRef}`/`unknown{unknownRef}` 两态，§八 G-19），因此 (a) 段的 `deps` 只能是 **fail-closed 三方法**：一律 `Err({failure:'unsupported', category:'EVOLVE_REJECT', subcause:'result-channel-unavailable'})`，永不返回数据、不产生成功回执（`stdio.test` 例⑨ 钉住）。G-19 关闭后三个方法才改为 daemon 代理，形态由 80 定，本文件不预设字段。
  - 生命周期：`SIGINT`/`SIGTERM` → `server.close()` → `link.close()`（尽力而为；80 的帧集**没有** `unregister` 帧，注销=关闭 socket，本文件不自造帧）→ `exit(0)`；socket 断开 → `link` 状态回 `expectRegister`，此后每次调用本地即拒（`failure:'unavailable'`），**不排队重放**、不自动重建会话。断连时 daemon 清掉该连接的 session/未用 challenge/pending（80-§11.4.1 第 4 条）；challenge 过期**不续期**，要新 challenge 只能重新 `register`；`registerAck` 丢失时重连发**新** challenge + 新 proof 即可，**不得**因 ack 丢失被锁死（被消费的是 challenge，不是 wkey 的 nonce）。
- **导出与允许依赖**：导出仅 `runStdio`（及文件内私有类型的类型导出，若测试需要）；允许依赖 `./server.ts`、`./daemon-link.ts`、`@modelcontextprotocol/server`（含 `./stdio` 子路径）、`node:process`、`node:crypto`、`node:url`、`node:fs`（**仅 `lstat`**，连前拒符号链接）、`@studio-next/contract`（**仅 type**）。禁止依赖 `./tools.ts`（除类型）、`./index.ts`、`@studio-next/gateway` **包根的值**（会连 `createGateway`/`createWkeyAuthority`/secret 面一起拉进 worker 运行时图；`decodeAction` 的取法见下）、任何平台包。**不进入包根导出**，只经 `exports["./stdio"]` 子路径暴露；`node:crypto` 只用于 `helperId` 与 `registerProof`（HMAC），`node:url` 只用于主模块守卫，`node:fs` 只用于 `lstat`（不读写任何文件）。动作词编解码**不得**在本文件复制一份：目标用网关的 `decodeAction`，但**只能经纯子路径**（如 `@studio-next/gateway/actions`，79/06 尚未给导出）或由构造方注入；未定前 M4 (a) 采用**注入式** `decodeAction`（与 `gate` 同批传入），不自建第二份解析（§八 G-17）。`proof` 的 **JCS 规范化**同理只能走共用实现（`node:crypto` 只做 HMAC，不做键排序/转义）；仓内**没有**可导入的 `studio-next/jcs@1` 导出实现（`packages/core` 两处私有 `canonicalize` 未导出、也未标该 ID），归 §八 G-21。
- **IO 与注入**：stdin/stdout（协议帧，**stdout 只许 JSON-RPC**）、stderr（人读日志，单行、无值）、env 两键（`STUDIO_TOOLS_WKEY`/`STUDIO_DAEMON_SOCK`，见上「内部结构与输入输出」）、进程信号、退出码、unix socket（经 `daemon-link`）。时间/随机只用于 `helperId`（`node:crypto.randomUUID()`）与日志；**没有任何 `Date.now()` 参与裁决**。测试注入：`makeLink`、三条流、`env` 全可替换。
- **状态/事务/幂等/并发/恢复**：单进程、单 MCP 连接、**单次注册**；**无事务**（本层不写任何库）。幂等：一次 `tools/call` 不承诺幂等，重发即第二次调用；幂等键在 `EffectGateway`（80-§6.6）。并发：MCP 客户端可并发多调用，`daemon-link` 用 `reqId` 多路复用；每次 `call` 由 **daemon** 依次查「会话 `registered` → 票据吊销/过期 → `tool→action` 在 `wkey` 的 scope 内 → `reqId` 同连接内未重复」，再按 `scope[action]` **现签一次性调用 key** 过 `gateWrite`（该 key **不回传** helper、不进 `verdict`）。worker 侧因此不消费 wkey 的 nonce：daemon 用 `verifySealed`（完整验签、**不写 `seenNonces`**）判凭据，被消费的只有 challenge（原 G-15 关闭）。**同一 `(ticket, nonce)` 只允许一个活跃会话**，第二个会话注册即 `ok:false`。`allow` **只表示授权通过、不冒充 `applied`**：回执必须带 `result`（`applied{receiptRef}`/`unknown{unknownRef,reason?}`）或 `failure`（`ClassifiedError` 两轴），否则不得渲染成成功（80-§11.4.1「`allow` 不冒充 `applied`」）。恢复：socket 断 → 不重试、不重放，状态回 `expectRegister`；**重连（含 daemon 重启、helper 崩溃后重启）必须走完整三步注册**，注册态与 `wkeyRef` 都不跨连接复用；进程重启 → 重新注册、重新拿凭据（凭据由宿主投递，本文件不缓存到磁盘）。
- **错误与秘密/观测**：启动期失败**非零退出**，stderr 一行给出**稳定 `subcause`**（建议 `stdio-config-invalid`/`stdio-daemon-unreachable`/`stdio-register-denied`/`stdio-transport-init-failed`，实现单定稿并进测试），**不得**用同一码混四类，也不得把原文、路径或 wkey 拼进 `subcause`；不打印 wkey、不打印 socket 路径、不打印注册表（80-§11.4.1：socket 路径与权限、注册信息不得进日志，只记 `helperId` 与结果）。运行期拒绝走 MCP 结果（`isError:true` + 两轴 `error`），**不得**因 stdio 改成抛异常把帧流打断；`detail` 的消毒在 `server.ts` 的 `denyResult` 一处执行（`contract` 的 `redactOutbound`），本文件**不重复实现**、也不得放宽。**未注册一律 deny**：本地先判 `link.state!=='registered'` 即不发送、不触达平台，`subcause:'helper-unregistered'`；**注册态绑定连接**（daemon 侧按 peer 句柄记，不能挪到另一条连接），**不是**帧里自报的 `helperId`/`pid`。连接鉴权分两层，**不得混写**：① **部署边界**——目录 `0700`、socket 文件 `0600`、`umask 0077`、`lstat` 拒符号链接；这一层只回答“谁有权限连进来”，**不产生**“对端 uid 已核”的事实，`0600` 也**不能**当授权证明；② **对端身份（可选、宿主绑定）**——Node 24 **没有** `getpeereid`/`SO_PEERCRED` 内建 API，**不得**写成 Node 直接调用；只有宿主注入**已验证的** `PeerCredentialVerifier`（`kind:'host-bound'`；native addon / 系统调用封装 / supervisor 代验后交结论）且 `verify` 返回 `uid === daemon uid` 时，该连接才记 `peer-verified`；没有适配、适配装不上或验证未成功 ⇒ 一律 `unverified`，日志/审计/上报**不得**出现 `peer-verified` 或“peer uid 已核”。**核心信任=challenge-proof + 活跃签发 + scope**，`peer-verified` 只是额外加固、`unverified` **不降低也不放宽**这三件；**同 uid ≠ 员工身份/已授权**：同 OS 用户下任意进程都能连，`0700`/`0600` 只挡别的用户，恶意/误连进程只能靠 **OS 用户隔离或容器/VM 隔离**（daemon 与 helper 分用户跑、或 worker 进独立容器），这超出本协议能力，**不得**宣称 socket 权限已解决。注册被拒或断连即退回 `expectRegister`，重连必须走完整三步；旧连接清理会同时清掉 session/未用 challenge/pending，**须等旧连接清理完成才可重新注册**；`registerAck` 丢失后重连可重新注册，**不会因 active session 永久锁死**（80-§11.4.1 第 4 条）。帧面只允许出现 `wkeyRef` 这一个**逻辑引用**：`register` 恰三键（`helperId`/`pid`/`wkeyRef`）、`call` 恰三键（`reqId`/`tool`/`args`）、`registerChallenge` 恰三键（`challenge`/`alg`/`expiresAt`）、`registerProof` 恰一键（`proof`）、`registerAck` 至多两键（`ok`/`reason`）；**任何帧都不得出现 wkey 原文或 `SEC-*` 原值**——`wkeyRef` 是合法引用、不算泄漏，判据是**原值**而不是字段名里有没有 `SEC-` 字样（`stdio.test` ⑮ 钉住）。
- **前置与分段（M4 拆三段，缺一不得宣称完成）**：**(a) 传输+三步注册+裁决**可先落（前置：daemon 侧 socket 服务归 `81-files/17`；`WkeyAuthority.verifySealed`、单实例共享 authority、签发登记表归 `gateway`/`81-files/06`/`16`，以及两进程共用的 `studio-next/jcs@1` 规范化器（§八 G-21）与三件固定**假**向量（归 82）——现状都没有）；**(b) 结果面**：80 已定 `verdict` 带 `result`（`EffectOutcome` 二态）或 `failure`（两轴），但 (i) `contract` 当前**没有** `EffectOutcome`/`Qid` 导出，(ii) daemon 代执行与「内部现签一次性调用 key」未实现，(iii) 读面数据（`hits`/`view`/`bytes`）在 `result` 里**没有承载位**——三件合为 §八 G-19；未关前 (a) 段 `deps` 一律 fail-closed，`allow` 不得被渲染成 `applied`。**(c) 子路径导出**：`package.json` 需 `exports["./stdio"]`，归 79-§6.5 回写（G-07）。
- **测试与证据**：`F-studio-tools-test-stdio` 以 **fake link + `PassThrough` 三条流** 做 V2 接线测试（`daemon-link` 另用真 unix socket 替身，见 §4.11）：无 env → 非零退出且 stdout 零帧；注册顺序固定（`register` → `registerChallenge` 三键 → `registerProof` 一键 → `registerAck`），`registerAck{ok:false}` → 非零退出且无 `initialize` 帧；challenge 过期/复用/换连接挪用 → 拒绝并断连（**不续期**）；ack 丢失后重连（**旧连接清理完成后**）发**新** challenge + 新 proof 可成功；proof 必须按 JCS 五键规范化字节重算——**改一字节、换键序、加空白、换域串、换 `alg` 一律拒**；每次调用转发 `{reqId, tool, args}`（**恰三键、无 `wkey`**）且 `reqId` 唯一；`verdict:'deny'` → `isError` + 原码 + 两轴 `failure`；`verdict:'allow'` 但**无 `result`** → 不得当成功（fail-closed，锁 G-19）；`verdict.result` 的 `applied{receiptRef}`/`unknown{unknownRef}` 与 `failure` 两轴可原样透传且**过脱敏**；socket 断 → 后续调用本地拒；`SIGTERM` → `server.close()` + `link.close()`（关 socket，不发 `unregister` 帧）；**stdout 行级解析全部是 JSON-RPC**。**不证明**：真 daemon 的三步注册与 `verifySealed`（完整验签但不消费 nonce）、同 `(ticket,nonce)` 单活跃会话、challenge 绑连接、socket 目录 `0700`/文件 `0600`/`umask 0077`/符号链接拒绝、宿主 `PeerCredentialVerifier` 的真实适配与 `peer-verified` 判定（无适配时一律 `unverified`，本卷不得声称已核 uid）、真 MCP 客户端、真管道分帧、长正文、并发会话——全部 V5（82 的探针，`U80-17`）。
- **规模与迁移**：预计 120~160 行（<600）；`src` 直属 8 件（<25）。回退：删两个文件 + 撤 `exports["./stdio"]`，库面零影响（`index.ts` 不导出）。**不得**在 README 或本卷写「stdio 已接」直到 (a)(b)(c) 全绿且有 V5 证据。

### 4.10 `F-studio-tools-daemon-link`（目标-新增）

- **路径/处置**：`packages/studio-tools/src/daemon-link.ts`；目标-新增；现状不存在（未实现、未证，`U80-17`）。与 `stdio.ts` 同批落地，拆开是因为**职责不同**：`stdio.ts` 管协议帧与进程，本文件管「受控 IPC 的一条连接 + 注册状态机 + 逐调用裁决」。
- **归属与上位锚**：绑定层实现；**80-§11.4.1 第 2、3、4 条**（验签在 daemon、stdio 只作传输、helper 先注册）；78-§11.4 的损失项（跨进程吊销不可见；「wkey 单次有效 vs 会话复用」已由 `verifySealed` + challenge 一次性解决，见 G-15 关闭）；`U80-17`。**本文件不是公共端口**：80-§6.6 的端口清单里没有「IPC 客户端」这一件（`TS-PORT-EFF-01`/`TS-PORT-EVD-01`/`TS-PORT-REC-01..06` 等都是 daemon 侧端口），它是 stdio 绑定内部的 IPC 客户端；不得被 `index.ts` 导出，也不得被其他包 import。
- **职责**：维护到 daemon 的**一条** unix socket 连接；完成**三步注册握手**（`register{helperId,pid,wkeyRef}` 恰三键、不带 `reqId` → 收 `registerChallenge{challenge,alg,expiresAt}` → 调 `prove` 算 proof、发 `registerProof{proof}` → 收 `registerAck{ok,reason?}`）；把每次闸请求转成一行 `call{reqId,tool,args}`、等一行 `verdict{reqId,verdict,reason?,result?,failure?}`；把「未注册 / 断连 / 超时 / 协议帧畸形 / challenge 过期」全部收敛成**拒绝**（fail-closed）。**它不验签、不查吊销、不自建 nonce 表、不缓存裁决结论**，也不持有 wkey 原文（只拿 `wkeyRef` 逻辑引用，把 `challenge` 交给调用方传入的 `prove`）。
- **非职责**：不构造 `Gateway`（无 secret、无 HMAC 实现）、**不计算 `proof`**（本文件没有 wkey，只把 `challenge` 交给调用方传入的 `prove`）、不执行工具（`run` 在 `server.ts`/`tools.ts`）、不写台账、不重试裁决（「重试」由调用方按 `failure` 决定，见 80-§5.7 处置表）、不自动重连、不把帧内容写日志（`args` 可能含证据正文/业务数据，`challenge`/`proof` 也不入日志）、不解析 `@action` 行（那是 `server.ts` 的序列化格式，解析它=第二份实现，见 §八 G-17）。
- **内部类型与函数（全部文件私有，除测试需要的类型）**：
  - 帧形状**逐字对齐 80-§11.4.1 最新正文**（单行 JSON；**注册三帧都不带 `reqId`**——一条连接只注册一次；只有 `call`/`verdict` 带 `reqId`）：
    ```text
    helper → daemon: {"type":"register","helperId":string,"pid":number,"wkeyRef":string}
    daemon → helper: {"type":"registerChallenge","challenge":string,"alg":"hmac-sha256-v1","expiresAt":string}
    helper → daemon: {"type":"registerProof","proof":string}
    daemon → helper: {"type":"registerAck","ok":true} | {"type":"registerAck","ok":false,"reason":string}

    helper → daemon: {"type":"call","reqId":string,"tool":string,"args":unknown}
    daemon → helper: {"type":"verdict","reqId":string,"verdict":"allow"|"deny","reason"?:string,
                     "result"?:{"status":"applied","receiptRef":string}|{"status":"unknown","unknownRef":string,"reason"?:string},
                     "failure"?:{"failure":string,"category":string,"subcause"?:string}}
    ```
    `register` **恰三键**（**只是申请、不构成证明**）、`registerChallenge` **恰三键**（`alg` **只接受** `'hmac-sha256-v1'`，其它值即拒并断连）、`registerProof` **恰一键**、`registerAck` **至多两键**、`call` **恰三键且不含 `wkey`**；`verdict` 允许 `reason`/`result`/`failure`，**不得**回平台原文或任何 `SEC-*` 原值。帧里允许出现的秘密相关字段**只有 `wkeyRef` 这个逻辑引用**。**不得**自造第二套字段名（如 `action`/`signature`/`author`），也不得给注册三帧补 `reqId`。
  - `DaemonLinkState = 'expectRegister' | 'expectProof' | 'registered' | 'closed'`；固定迁移 `expectRegister →(发 register、收 challenge) expectProof →(发 proof、收 ok:true) registered`，`closed` 后一切调用本地拒。**乱序/多键/超长/过期 ⇒ 拒绝并断连**：例如 `expectRegister` 未收 challenge 就发 `registerProof`、challenge 过期后再交 proof、收到多余键的帧，都不得“跳过”或“补一步”，直接断开并把状态打到 `closed`（不是回到可用态）。challenge **只对发出它的那条连接有效**（换连接挪用即拒），且**过期不续期**。
  - `createDaemonLink(opts): DaemonLink`，`opts` 含 `socketPath`（**取自** `STUDIO_DAEMON_SOCK` 或相对 `run/daemon.sock`；**不得**写死绝对路径，也不得把该路径写日志）、`now`（仅用于 challenge 过期与调用超时判定，测试注入）、`log`（stderr 单行）、`connect?`（测试注入 socket 工厂）。**本文件不注入 `PeerCredentialVerifier`**：对端身份是 daemon 侧（宿主绑定）的事，helper 只负责证明持有 wkey（§八 G-20）。
  - `DaemonLink = { state(): DaemonLinkState; register(r: HelperRegistration, prove: RegistrationProver): Promise<Result<void, ClassifiedError>>; gate(tool: string, args: unknown): Promise<Result<VerdictOutcome, ClassifiedError>>; close(): Promise<void> }`；`HelperRegistration = {helperId: string; pid: number; wkeyRef: string}`（**恰三键**，`wkeyRef` 由 `stdio.ts` 派生后传入，本文件不推导）；`RegisterChallenge = {challenge: string; alg: 'hmac-sha256-v1'; expiresAt: string}`（恰三键）；`RegistrationProver = (c: RegisterChallenge) => string`（**本文件不接触 wkey**：proof 由 `stdio.ts` 用本进程内存的本单 wkey、按 `studio-next/jcs@1` 五键字节算得；link 只把 `challenge` 交过去、只转发 proof 字符串）。`gate` **不带 token**（帧里没有 wkey），回 `VerdictOutcome`（包内私有）：`{verdict:'allow'; result: EffectOutcome} | {verdict:'deny'; reason?: string; failure?: {failure: string; category: string; subcause?: string}}`；`EffectOutcome` 与两轴类型本体应归 `contract`（80-§5.2/§5.7），现状**无导出**，本文件只用结构形状并标 `未证`（§八 G-19）。`verdict:'allow'` 但**无 `result`** 时**不得**返回 `Ok`：转 `Err({failure:'unsupported', category:'EVOLVE_REJECT', subcause:'verdict-without-result'})`——G-19 关闭前这是唯一合法行为。`allow` 只表授权通过、**不冒充 `applied`**；是否真的生效只由 `result.status` 决定。
  - 帧读写：`node:readline`（或等价按 `\n` 切分）逐行解析；单行超限即拒并断连（上限取部署常量，**不在本包写死数字**；`call.args` 上限同此一条，见 §八 G-11）；`reqId` 由 `node:crypto.randomUUID()` 生成，pending map 一一对应；**未知 `reqId` 的帧丢弃并记一条 warn**（不抛，避免一条脏帧打断整个会话）；`verdict` 乱序到达按 `reqId` 归位。
- **导出与允许依赖**：仅导出 `createDaemonLink` 与测试需要的类型（`DaemonLink`、`DaemonLinkState`、`HelperRegistration`、`RegisterChallenge`、`VerdictOutcome`）；允许 `node:net`、`node:readline`、`node:crypto`、`node:process`、`@studio-next/contract`（**仅 type**：`ClassifiedError`/`EffectOutcome`——后者现状无导出，§八 G-19）。**不** import `@studio-next/gateway`（本文件不验签、不解析 `@action`，没有需要的类型）；**不得** import `./server.ts`（会成环），不得 import `./tools.ts`（除类型）。
- **IO 与注入**：unix socket（唯一网络面，且是本地域套接字，不是 TCP）、stdout 不写、stderr 单行、`now`/`connect`/`log` 注入。无 fs、无环境读取（`socketPath` 由 `stdio.ts` 传入，本文件不自己读 env）。**不落盘**：不把 `challenge`/`proof`/`wkeyRef` 写到任何文件。
- **状态/事务/幂等/并发/恢复**：无事务（不写库）。**注册是前置且绑定连接**：`gate` 在 `state!=='registered'` 时**不发送**，直接 `Err({failure:'unavailable', category:'STALL', subcause:'helper-unregistered'})`；连接身份由 **daemon 侧按 peer 句柄**记（本文件不判断；`0700`/`0600`/`umask 0077`/`lstat` **只是部署边界**，**不产生** uid 已核事实；对端 uid 只由宿主注入的 `PeerCredentialVerifier` 给出，无已验证适配即 `unverified`，见 §4.9/§八 G-20），**不是**帧里自报的 `helperId`/`pid`；同 uid **不等于**员工身份/已授权，核心信任=challenge-proof+活跃签发+scope（恶意同 uid 靠 OS 用户/容器隔离）。注册态只对发起它的那条连接有效；断连时 daemon 清 session/challenge/pending，本文件同步清 pending 并回 `expectRegister`；challenge 过期**不续期**；ack 丢失后**须等旧连接清理完成**再重连，发**新** challenge + 新 proof（不烧 nonce、**不会因 active session 永久锁死**）。并发：多个 in-flight `call` 共享一条连接，靠 `reqId` 多路复用；daemon 对每个 `call` 依次查「session `registered` → 票据吊销/过期 → `tool→action` 在 scope 内 → `reqId` 同连接未重复」，再按 `scope[action]` **内部现签**一次性调用 key 过 `gateWrite`（key **不回传**、不进 `verdict`）；本文件**不做**这些判断，也不缓存结论。超时：每个 `call` 有独立 deadline（取部署注入），超时 → `Err({failure:'timeout', category:'STALL', subcause:'verdict-timeout'})`，**且该 `reqId` 之后到达的 `verdict` 只记日志、不改变已返回结果**（迟到副作用归 daemon 对账，`REC-06`）。断连：pending 全部以 `timeout`/`unavailable` 结束，**不自动重连**（避免静默重放）；daemon 重启、helper 崩溃后重建的连接**必须重新走三步注册**，注册态与 `wkeyRef` 都不跨连接复用、不复制给另一连接/进程、不落盘转授（80-§11.4.1 第 4 条「重连必须重注册」「不能转授」）。
- **错误与秘密/观测**：错误一律 `ClassifiedError`——`failure` 取 77 的 14 类（本文件只用到 `unavailable`/`timeout`/`rejected_authority`/`unsupported`），`category` 只取 80-§5.7 允许的 6 个可达值（`STALL`/`EXTERNAL_REJECT`/`EVOLVE_REJECT`…），**两轴不得互换**；`detail` **不含**帧原文、socket 路径、wkey、`challenge`/`proof`。日志只记 `helperId`/`reqId`/`verdict`/`reason`（`reason` 用网关原码，不含 token），**不记 `challenge`/`proof`/`args`**。注册被拒（`ok:false`）**不**重试：重试等同继续用被拒身份。`verdict.result` 里的 `receiptRef`/`unknownRef` 是逻辑引用（`Qid`），可透传；`verdict.failure` 原码透传为两轴、不再二次改写。**无引用判负**：`result` 缺 `receiptRef`/`unknownRef`（含 `status:'unknown'` 却无 `unknownRef`）一律转 `Err({subcause:'effect-outcome-unreferenced'})`，不得当成功（80-§5.2）。
- **测试与证据**：由 `F-studio-tools-test-stdio` 覆盖（同一子域，避免为两个薄件各开一份测试）：临时目录里的真 unix socket + 手写 daemon 替身回帧，断言 ①未注册即拒且零帧发出；②三步握手顺序（register 三键 → challenge 三键且 `alg` 绑 `'hmac-sha256-v1'` → proof 一键 → ack 至多两键），proof 按 JCS 五键字节重算，**改一字节/换键序/加空白/换域串/换 alg 必拒**；③`reqId` 回显归位、乱序不掉包、未知 `reqId` 丢弃；④`deny` 两轴原码透传；⑤`allow` 无 `result` → `verdict-without-result`（不得当成功）；⑥协议畸形帧/超长行 → 断连 + 后续全拒；⑦超时 → `timeout` 且迟到帧不改结论；⑧日志不含 wkey/socket 路径/challenge/proof。**不证明**：daemon 侧真验签（`verifySealed` 不消费 nonce）、同 `(ticket,nonce)` 单活跃会话、challenge 绑连接的真实行为、socket 权限、宿主 `PeerCredentialVerifier`/`peer-verified`（默认 `unverified`）、跨进程非 ABA、真实 MCP 客户端——V5 探针（`U80-17`），归 82。
- **规模与迁移**：预计 180~240 行（<600）；`src` 直属 8 件（<25）。**上游未决（v0.6 复核）**：①结果面（§八 G-19：`contract` 无 `EffectOutcome`/`Qid`；daemon 代执行与「内部现签一次性 key」未实现；读面数据无承载位）——未关前 `allow` 只到 `verdict-without-result`；②`studio-next/jcs@1` 规范化器**无共用实现**（§八 G-21；字节规则已冻结，G-18 已关闭）；③daemon 侧 socket 服务、`WkeyAuthority.verifySealed`、进程内单实例共享 authority、签发登记表均未实现（归 `81-files/17`/`06`/`16`）；④`PeerCredentialVerifier` 无已验证适配，连接默认 `unverified`（G-20）。**已关闭（v0.5/v0.6）**：G-12、G-15、G-16、G-18（proof 字节已冻结）；`register`/`registerAck` 不带 `reqId`、`wkeyRef = SEC-WKEY-<ticketId>`、env 键名 `STUDIO_TOOLS_WKEY` 仍成立（原 G-04/G-13/G-14 关闭）。**目标仍未实现、未证**。回退：删除本文件与 `stdio.ts` 同批，库面零影响。

### 4.11 `F-studio-tools-test-stdio`（目标-新增 / 仅测试）

- **路径/处置**：`packages/studio-tools/src/stdio.test.ts`；目标-新增；仅测试（与生产同目录，理由同 §七.3：移出 `src` 会退出根 program 的覆盖）。
- **归属与上位锚**：验证层；80-§11.4.1 的帧协议与「未注册一律 deny」；`U80-17` 的 V2 子集；82 的 V2/V5 登记对象（本附录不写 82）。
- **职责**：钉死 `stdio.ts` + `daemon-link.ts` 的**接线与拒绝面**：三步注册先于服务（`register` → `registerChallenge` → `registerProof` → `registerAck`）、未注册即拒、challenge 一次性/过期即拒、`reqId` 归位、`deny` 两轴原码透传、`allow` 无 `result` 不得当成功、stdout 只含 JSON-RPC、退出码分类、断连后全拒。
- **非职责**：不验证 daemon 侧验签/吊销/审计（归 `81-files/17`/82）、不验证 socket 权限，也不验证宿主 `PeerCredentialVerifier`/`peer-verified`（无适配即 `unverified`；V5）、不验证真 MCP 客户端、不验证防重放；`verifySealed` 与「同 `(ticket,nonce)` 单活跃会话」只能由 fake daemon 的**替身逻辑**模拟，不构成证据。
- **内部结构与夹具（全部内联）**：
  - `fakeDaemon(socketPath)`：在 `mkdtemp` 临时目录建真 unix socket 的**替身 daemon**，实现 80-§11.4.1 的**六条帧**并按需注入：收 `register` → 回 `registerChallenge`（`randomBytes(32)` base64url、`alg:'hmac-sha256-v1'`、`expiresAt`）；收 `registerProof` → 用测试专用 wkey 与 **`studio-next/jcs@1` 五键字节**（`protocol`/`challenge`/`helperId`/`pid`/`wkeyRef`，字典序、无空白）重算 HMAC 并 `timingSafeEqual` 比较（异长直接拒、不抛；**改一字节/换键序/加空白/换域串/换 `alg` 必拒**）→ 回 `registerAck{ok,reason?}`；测试内的 JCS 规范化器必须与 `prove` 侧同一实现，落地前用测试内最小版并标注“不证明字节正确性”，**固定假向量归 82**；收 `call` → 回 `verdict`（可带 `result`/`failure`）。可注入「拒绝注册」「不回 ack 即断」「challenge 过期」「challenge 复用」「不回帧（超时）」「回畸形行」「半帧后断连」七种故障。它**必须对收到的帧做字段白名单断言**：`register` 恰三键（`helperId`/`pid`/`wkeyRef`）、`registerProof` 恰一键（`proof`）、`call` 恰三键（`reqId`/`tool`/`args`）且**不含 `wkey`/任何 `SEC-*` 原值**；注册三帧都**不带 `reqId`**。多出字段、缺字段、出现 wkey 原文即测试失败。它是 fake，**不证明**真 daemon 任何能力（包括 `verifySealed` 不消费 nonce、单 `(ticket,nonce)` 会话、challenge 绑连接）。
  - `fakeLink()`：纯内存 `DaemonLink` 替身（不碰 socket），供 `runStdio` 的接线测试；`register(r, prove)` 走内存里的固定 challenge 并**调用 `prove`**（可断言 stdio 确实把 challenge 交了过来、且没有把 wkey 交给 link），`gate` 可注入固定 `VerdictOutcome`（`deny` 两轴 / `allow` 带或**不带** `result` 两种都要能造）。
  - `captureStreams()`：`PassThrough` 三条流 + `stdout` 行级收集器（每行 `JSON.parse`，失败即断言失败）。
  - `fakeDeps()`：与 `server.test.ts` 同形的三后端内存 fake（**不复制第二份**：从 `server.test.ts` 抽出共享 helper 会跨文件耦合测试；本文件自建最小版，字段更少，避免「测试互引」）。
- **覆盖清单（目标 15 例，静态计数）**：① 无 `STUDIO_TOOLS_WKEY` → 非零退出、stdout 零帧；② 三步注册顺序固定——先发 `register` 三键、收 challenge 三键（`challenge`/`alg`/`expiresAt`，`alg` 只收 `'hmac-sha256-v1'`）后才发 proof，`registerAck` 之前不得出现 `initialize`；③ `registerAck{ok:false,reason}` → 非零退出、无 `initialize` 帧；④ challenge 过期（`now` 越过 `expiresAt`）→ 不交 proof、非零退出并断连；challenge 复用（同值第二次 proof）或换连接挪用 → 替身 daemon 拒并断连，**不续期**；⑤ ack 丢失（不回 ack 即断）→ **旧连接清理完成后**重连取**新** challenge（值与旧不同）+ 新 proof 可成功，**不因 active session 永久锁死**；⑥ proof 字节与长度：按 JCS 五键规范化字节重算，**改一字节/换键序/加空白/换域串/换 `alg` 必拒**；proof 错/异长 → `timingSafeEqual` 判否、`registerAck{ok:false}`，异长**不抛** `RangeError`；helper 侧非零退出；⑦ 注册成功 → 才允许 `tools/call`；未 `registered` 时本地拒、socket 零字节；⑧ `verdict:'deny'` → `isError` + `subcause` 原码 + 两轴 `failure` 透传；⑨ `verdict:'allow'` 无 `result` → `unsupported`/`verdict-without-result`（**先红**，锁 G-19）；带 `applied{receiptRef}`/`unknown{unknownRef}` → 透传、脱敏、限长；`unknown` 无引用 → 判负；⑩ `reqId` 唯一、乱序 `verdict` 按 `reqId` 归位、未知 `reqId` 帧丢弃不抛；⑪ 超时 → `failure:'timeout'`，迟到 `verdict` 不改结论；⑫ 畸形帧/超长行 → 断连 + 后续全拒；⑬ `SIGTERM` → `server.close()` + `link.close()`（80 帧集**没有** `unregister` 帧；断言 socket 连接关闭、不发明新帧）；⑭ stdout 全行 JSON-RPC（含错误路径）；⑮ **帧字段白名单**：`register` 恰三键、`registerChallenge` 恰三键、`registerProof` 恰一键、`registerAck` 至多两键、`call` 恰三键且无 `wkey`/`SEC-*` 原值、`verdict` 允许 `result`/`failure` 且无 `wkey`/`SEC-*` 原值（`wkeyRef` 是**合法引用**，不得当泄漏）（由 `fakeDaemon` 的接收侧断言，见上）。
- **不证明**：真 daemon、真 MCP 客户端、真进程 spawn、socket `0700`/`0600`/`umask 0077`/符号链接拒绝、宿主 `PeerCredentialVerifier`/`peer-verified`（默认 `unverified`）、JCS 固定**假**向量（归 82）、**daemon 侧按连接绑定注册态、「重连必须重注册」、`verifySealed` 不消费 nonce、同 `(ticket,nonce)` 单活跃会话、challenge 绑连接的真实行为**、跨进程吊销可见性、防重放、长正文、并发会话、`StdioServerTransport` 在真实管道上的分帧行为（`InMemoryTransport` 与 `PassThrough` 都不等同于操作系统管道）。
- **证据层级**：V2（进程内，含真 unix socket 的替身与三步握手）；V4 仅「challenge 过期/复用、proof 错（含改一字节）、超时、畸形、断连」子集；V5 全缺（真宿主拉起、真 revoke、真 socket 权限、宿主 `PeerCredentialVerifier` 适配、JCS 固定假向量、长正文、并发）；V3/V6 N/A。
- **规模与迁移**：预计 200~260 行（<600）；随 `stdio.ts`/`daemon-link.ts` 同批落地。**先红后绿**：G-19 未关时第 ⑨ 例必须红或显式 `todo`，**不得**删掉该例来保绿——它是这个面「`allow` 不可当成功」的唯一机械证据。

### 4.12 `F-studio-tools-tsconfig-build`（目标-新增，条件）

- **路径/处置**：`packages/studio-tools/tsconfig.build.json`；目标-新增；仅当 M5 dist 切换立项时创建。
- **归属与上位锚**：构建层；79-§5（双轨构建、`noEmit` 继承陷阱、`.d.ts` 不重写 `.ts`）、§6.1（切换三处同步）、§6.5（目标 exports）。
- **职责**：从 `src` 发射 `dist/**/*.js` + `dist/**/*.d.ts`，形状与 `src` 同构；`rootDir:src`、`outDir:dist`、显式 `noEmit:false`、`declaration:true`；排除 `**/*.test.ts`（测试不进分发）。
- **非职责**：不做打包（不引 bundler）、不改 `exports`（由 manifest 同单改）、不引入 project references、不设 `paths` 回 `src`、不承担运行时兼容承诺。
- **内部结构**：`extends ./tsconfig.json` + 上述 `compilerOptions` + `exclude`。`module/moduleResolution` 沿用 `nodenext`；按 TS 5.9.3 的选项交互，必须同时 `allowImportingTsExtensions:true` 与 `rewriteRelativeImportExtensions:true` 才能既沿用源码的 `.ts` 说明符又发射 JS（79-§5.3）；`.d.ts` 内说明符是否被消费者解析仍是 U1/U2 未证（79-§5.5、80 `U80-02`）。
- **导出与依赖**：N/A（配置）。构建前置：`dsh-bridge → contract → gateway` 的 dist 已存在且拓扑断言通过（79-§6.1）；本包最后切。
- **IO 与注入**：构建只读源码、写 `dist`；不联网、不执行源码。
- **状态与并发**：构建是单次批处理；产物新鲜度靠构建闸（指纹 + `--listFiles`，79-§5.6），不靠时间戳。
- **错误与观测**：五条判据（退出码 0、产物清单非空且符合预期、`dist/index.js` 可被 Node 24 import、`dist/index.d.ts` 可被消费者 tsc 解析、`--listFiles` 不含本包外 workspace 源码）同时成立才算成功（79-§5.6）；只看退出码会踩 `noEmit` 继承陷阱。
- **测试与证据**：未创建、未运行；`81-files/19` 的根脚本需串接本包 `typecheck`（79-§6.1）。V4 需验证双加载（同一包 src/dist 两份实例）不存在（80 `U80-02`/79 U13/U14）。
- **规模与迁移**：约 15~25 行。回退：删本文件 + `exports` 改回 `src` + 根 program 恢复 include，三者同单。

### 4.13 `F-studio-tools-license`（目标-新增，条件）

- **路径/处置**：`packages/studio-tools/LICENSE`；目标-新增；内容待制作人决定。
- **归属与上位锚**：发布/合规层；79-§6.5（files 白名单含 LICENSE，现状不存在、许可待决）、75-§七 D3（公开与许可不由本组代决）。
- **职责**：包级许可文本，使 `files` 白名单与 npm/DSH 分发合规。
- **非职责**：不继承仓根 MIT（79-§6.5 明确“不等于包级许可”）；不声明公开范围或维护责任。
- **内部结构**：N/A（文本未定）；不得含本机路径/作者隐私信息。
- **导出与依赖**：N/A（纯文本文件，不导出符号、不声明依赖）。
- **IO 与状态**：N/A（静态文本，无运行期 IO、状态或并发）。
- **错误与观测**：N/A（静态文本，不执行、不产生错误/日志）。
- **测试与证据**：无。许可选择是**政策待决**（制作人），不是技术空白；未定前不得设 `license` 字段或写“MIT”。
- **规模与迁移**：依赖 M5；若 studio-tools 最终不对外，本文件与 dist 切换一并取消（79-§6.1：若 studio-tools 不对外，contract/gateway 也不必切）。注意：stdio 子路径导出**不能**在没有 `dist` 的情况下对外（`src` 态子路径会把源码路径泄给消费者），因此 stdio 面与 M5 有耦合——若 M5 不立项，stdio 只能在 monorepo 内用（宿主按绝对路径引 `.ts`），对外能力仍算**未交付**。

---

## 五、跨件一致性与目标装配链

### 5.1 同表纪律的机制强度

- 真源：`packages/contract/src/ports/gateway.ts` 的 `GATEWAY_ACTIONS`（六动词，顺序固定）。
- 镜像：`tools.ts` 的 `STUDIO_TOOLS`/`STUDIO_TOOL_NAMES`。
- 唯一防漂移机制是**测试**：`tools.test.ts`（静态同序）+ `server.test.ts`（`tools/list` 广告面）。没有 guard 规则扫描两表；因此“contract 改表但本包未跟”会在测试红，而“本包在某分支先改”不会被 guard 拦。这是可接受的现状强度，但不得描述为“机制保证两表永不漂移”。
- 目标不新增工具。新增=改 contract（批示流）+ 改本包表 + 改测试样本；README 与 `description` 同步。

### 5.2 调用链（现状库级 / 目标双模）

现状（进程内，唯一被测试覆盖的形态）：

```
宿主（测试：daemon test）──构造──> createGateway(secret, clock, ticket, ctx, author)
        │                                   │
        └── createStudioToolsServer({gateway, deps, wkey?})
                    │
 worker/MCP client ──initialize(_meta['studio-wkey'])──> withInitWkeyCapture ──> cell.token
                    │
                    └──tools/call──> runTool
                          0 无 token → missing-wkey（不碰网关、不碰 deps）
                          1 gateWrite(token, action, '@action <verb> <json>')
                              ├─ 拒 → subcause=<gw-* 原码>
                              └─ 允 → signed = [公司·部门·岗位·级别] + author
                          2 run(args, env, signed)
                              ├─ comment/heartbeat/article：只回 signed 字段（零 IO）
                              └─ kb-search/evidence-write/budget-query：调 deps
                          3 okResult/denyResult → MCP 结果
```

目标（stdio helper，**未实现**）：凭据来自每单 env（`STUDIO_TOOLS_WKEY`），**只到进程、不进帧**；helper 先 `register{helperId,pid,wkeyRef}`（`wkeyRef`=`SEC-WKEY-<ticketId>` 逻辑引用，注册绑定该 socket 连接、重连须重走三步），收 `registerChallenge{challenge,alg,expiresAt}` 后，用本进程内存的本单 wkey 对 `{protocol:'studio-next/stdio-register@1',challenge,helperId,pid,wkeyRef}` 的 `studio-next/jcs@1` 规范化字节算 `proof = base64url(HMAC-SHA256(wkey, 该字节))` 回 `registerProof`，`registerAck{ok:true}` 后才服务（daemon 用 `verifySealed` 完整验签、**不消费 nonce**，被消费的是 challenge）；此后每次 `call{reqId,tool,args}`（**不带 wkey**）由 `daemon-link` 经 unix socket 送 daemon，daemon 依次查会话/吊销/过期/scope/`reqId` 后**内部现签**一次性调用 key 过 `gateWrite`（key 不回传），回 `verdict{reqId,verdict,reason?,result?,failure?}`；`allow` 只表授权通过，是否生效看 `result.status`（`applied{receiptRef}`/`unknown{unknownRef}`），**没有 `result` 的 `allow` 只能当失败处理**。两种形态共用同一个 `createStudioToolsServer` 注册面——**不得**为 stdio 另起一套工具表或注册逻辑。

〔结论〕**`gateWrite` 不是写入**：它只验签、校验动作词、返回署名。`comment/heartbeat/article` 目前没有任何平台调用；`evidence-write` 的落盘由宿主注入的 `writeEvidence` 完成。因此"工具调用成功"最多证明"网关放行 + 后端返回"，不证明平台/知识库/公司目录发生了外部效果。目标映射已由 80-§11.4.1 给出：`comment`/`article` 先翻译为 `comments.add`/`kb.upsert` 再走 `EffectGateway.apply`；`heartbeat` 由 daemon 经 `RecordWriter` 记录活性观察，**不是**平台写；执行者仍在 daemon/网关侧，**未接线**（§八 G-02）：本包不代设执行端口。

### 5.3 写者与路径边界（目标硬约束）

- **80-§11.4.1 的目标映射**：`writeEvidence(path, content)` → worker **只写本单材料目录**（工作区内的 `evidence/` 沙箱路径，containment 强制），**不是**任意落盘；收割归 daemon 的 `TS-PORT-EVD-01`，且它是**只读收割**（只读材料、产出证据记录），不得被写成“任意写盘工具”，也不得反向接收 worker 的写入结果。
- **80-§11.3 三段（缺一不可）**：① containment——`path.resolve` 后的绝对路径必须在允许根内，`path.relative` 不以 `..` 开头；② realpath——符号链接解析后再判 containment（防 `link → /etc`）；③ 原子写——临时文件 + `rename` 原子替换，不得“先 truncate 再写”。路径不推授权：能读不等于有权读，`companyDir` 之外的读一律拒。
- **现状事实**：`evidence-write` 把 `path` 原样交给注入后端，本包**不做**任何 containment/realpath/符号链接检查；测试里的 `fakeDeps` 也不做。因此本包与它的测试都**不能**证明“路径已受控”（75-D75-13 要求在“该层或后端”做，但未指派到具体层）。
- **责任方未指派**：80 把沙箱位置定在 worker 工作区，工作区所有权归 78；但“谁执行校验”（helper 侧、daemon 侧端口实现、还是工作区绑定层）三卷都未逐层写死 → §八 G-08。本包**不擅自**加检查（会在错误的位置形成第二套路径策略），也不得在 README 写“已 containment”。
- **读面与未接线写面**：`kb-search`/`budget-query` 是读面（`RecordReader.query` / 只读投影）；`article` 名义 upsert，但本包**无写原语**，目标落 `EffectGateway.apply`，执行者在 daemon/网关侧且**未接线**（§八 G-02）。因此“调用成功”最多证明“网关放行 + 注入后端返回”，不证明平台/知识库/证据目录发生外部效果。

### 5.4 凭据与秘密

- **投递面（目标）**：①**每单 env 优先**——键名 **`STUDIO_TOOLS_WKEY`**（80-§11.4.1 第 1 条已定名；= `worker-key.ts:62` 的 `WORKER_WKEY_ENV_KEY`，源码注释的“拟稿”待 `81-files/16` 落定稿；adapters 白名单与既有测试都钉死该值）；②`initialize._meta['studio-wkey']` **仅 legacy**（`server.ts` 的 `WKEY_META_KEY`，常量不删，兼容期用；构造期已给 `wkey` 时不包装捕获器）；③**永不**收 `gatewaySecret`（`SEC-GW-SIGNING`）——worker 侧没有 HMAC secret，验签/吊销/审计在 daemon（80-§11.4.1 第 1、2 条）；④**只到进程、不进帧**：回给 daemon 的帧只带逻辑引用 `wkeyRef`，`catalog` 秘密（`SEC-*` 的值）永不随 JSON-RPC/stdio 帧、`_meta`、任务书下发（第 4 条「catalog 秘密不进帧」）。
- **持有面（80-§11.4.1 第 5、6 条）**：daemon **在内存保留本单 wkey 至 attempt 结束**（v0.4 的「daemon 不留副本」**作废**），用于 `verifySealed` 与按 `scope[action]` 现签一次性调用 key；worker 只持**本单** `STUDIO_TOOLS_WKEY`，不持其它票据、不持 `gatewaySecret`、不持 `catalog` 里任何 `SEC-*` 值。`proof` 只含 HMAC 结果（base64url），**不含 wkey 原文**，中间串算完即弃。`WkeyAuthority` 在进程内必须**单一共享**（现状 `createGateway` 每次新建，`packages/gateway/src/gateway.ts:65`；未改=未证），否则同一 `(ticket,nonce)` 的单活跃会话约束失效。`proof` 的输入是 **`studio-next/jcs@1` 五键规范化字节**（`protocol`/`challenge`/`helperId`/`pid`/`wkeyRef`），**不是**字符串拼接；`alg:'hmac-sha256-v1'` 同时绑死规范化、域串 `studio-next/stdio-register@1` 与 SHA-256。对端 uid 只由宿主注入的 `PeerCredentialVerifier` 给出（Node 24 无内建 `getpeereid`/`SO_PEERCRED`），无已验证适配即 `unverified`；**核心信任不靠 uid**，靠 challenge-proof + 活跃签发 + scope。
- **键名已定（原 G-04 关闭）**：80-§11.4.1 最新正文写的键名就是 `STUDIO_TOOLS_WKEY`（不再是早期例子里的 `STUDIO_WKEY`），与 `worker-key.ts:62`、adapters 白名单、既有测试同值。本卷按该名写；剩余动作只是 `81-files/16` 把源码注释的“拟稿定名，待批示”改为定稿，不是口径分歧。
- **`wkeyRef` 不是秘密**：按 80-§11.4.1 第 4 条它是**逻辑引用**（`SEC-WKEY-<ticketId>`，由凭据里的 `ticketId` 派生），**不是** wkey 原文、密码/token 或可转授句柄；daemon 用自己的内存凭据验签，验签**不依赖 helper 送来的任何字节**。解析不到活跃签发、或引用不属于该连接所报主体 ⇒ `registerAck{ok:false}`。helper 不得自造引用、不得冒用他人票据引用，也不得把它落地转授（80-§11.4.1「不能转授」）。
- **`wkey` 的秘密身份**：per-ticket `wkey` 是 80-§11.2.1 里 `local-mint` 的**唯一例外**——不进静态 catalog、不落盘；**活跃期才进** `KnownSecretSet`（`secretId` 按 `SEC-WKEY-<ticketId>` 派生，与 `wkeyRef` 同名不同物：前者是 daemon 侧秘密登记项，后者是帧里的逻辑引用），`CLOSE`（关单/吊销）即**移除**，移除后按吊销规则仍留一个去重窗的兜底窗口（80-§11.2.1 第 2 条、轮换/吊销第 3、4 条）。**`KnownSecretSet` 属 daemon 装配期产物**，本包不构造、不持有；对 `server.ts` 它是**不透明字符串**（只用于 presence 门），`stdio.ts` 仅为其派生 `wkeyRef` 做一次**不验签的结构性解码**（失败即 `stdio-config-invalid`），`daemon-link` 侧根本拿不到它。
- **秘密不进回执**：回执里的凭据派生字段只有 `author`/`signature`（署名由网关给）；`SignedBody{author,body,signature}` 不含 token。`wkey` 不写日志、不进 MCP 结果、不进 `detail`。
- **消毒两处**：①`denyResult` 的 `detail`（现状把 `err.message` 原样拼入，可能含绝对路径、内部标识、疑似 token）；②`stdio.ts`/`daemon-link.ts` 的 stderr 日志（单行，只记 `helperId`/`reqId`/`verdict`/`reason`，**不记帧原文、socket 路径、wkey**）。两处都调 `contract` 的 `redactOutbound`/`findSecretShaped`（80-§11.2-3 把 `secrets` 整模块迁 `contract/src/secrets.ts`，含 `redactKnownSecrets`、`SecretShapeFinding`、三条正则、`REDACT_MARK`、`MIN_KNOWN_LENGTH`）；**禁止** `studio-tools → core` 取函数，也**禁止**在本包另写正则或脱敏实现（§1.2）。
- **顺序与 fail-closed**：`find` 判 → `redact` 改 → 才允许出站（80-§11.2.1 调用边界第 2 条）；未跑扫描不得出站。**认证入站不脱敏**：`wkey` 是校验对象、不是脱敏对象，不得先脱敏再验签（会把合法凭据改成 `<redacted:N>`，验签永远失败）。**帧里的 `wkeyRef` 同理不得脱敏**——它是 daemon 用来取凭据的逻辑引用，被改写即注册失败；脱敏只作用于人读日志与 `detail`，不作用于任何帧字段。
- **“已知值不足 ≠ 安全”**：本包拿不到 `KnownSecretSet`（daemon 侧才有），只有形状兜底；短值（<6）与非常规形会漏过，却仍返回“看起来已处理”的文本（80-§11.2.1 第 4 条，判负）。因此本包**不得**宣称“无泄漏/已完全脱敏”，只能声称“过了一次脱敏函数”。
- **现状缺口**：`denyResult` 未消毒、无日志/事件/指标、MCP 面不产 `traceId`（`traceId` 归 daemon/API 装配面，本包不得伪造）→ §八 G-06。

### 5.5 错误面：MCP 结果 / 网关拒绝 / `ClassifiedError` / 77 失败类

| 面 | 取值与形状 | 归属与不得混用 |
|---|---|---|
| MCP 工具结果 | `ok:true{action,…}`；`{ok:false,error:{failure,category,subcause,detail?}}` + `isError:true` | 形状由本包定，`failure`/`category` 值域归 77/80。目标即“`ok:false` 携带 `ClassifiedError` 形状”，但**不是** `Err` 通道（MCP 结果没有 `Result`），也**不落记录**。现状 `error{category∈auth/gateway/deps/internal, subcause, message}` 目标-退役 |
| 网关拒绝（14 码） | `gw-verify-malformed`/`-bad-signature`/`-revoked`/`-expired`/`-ticket-mismatch`/`-scope`/`-replay`；`gw-action-not-an-action`/`-bad-format`/`-unknown-verb`/`-bad-json`/`-bad-args`；`gw-action-mismatch`；`gw-freeform-chinese` | 归 `gateway` 包（`WkeyRejectReason` 7 值、`ActionRejectReason` 5 值，facade 加 `gw-` 前缀后 12 个，再加 `gw-action-mismatch`/`gw-freeform-chinese` = `GATE_DENY_HINTS` 14 键）。本包只**原码透传**为 `subcause`，不改写、不折叠同类；`failure` 由网关给（目标）或待映射（现状，G-05） |
| 契约错误 | `ClassifiedError{failure: FailureClass; category: ErrorCategory; subcause: string; detail?: string}`；`category` 11 值冻结，`Err` 只可达 6 值（`CONFIG_INVALID`/`EVOLVE_REJECT`/`EXTERNAL_REJECT`/`STALL`/`MERGE_CONFLICT`/`NO_LANE`） | 类型归 `contract`、语义归 80-§5.7。`failure` 是处置轴、`category` 是观测轴、`subcause` 是稳定细目；三者**不得互换**，也不得把 `failure` 塞进 `category` |
| 77 失败类（14 类） | `rejected_precondition`/`rejected_authority`/`rejected_forbidden`/`rejected_state`/`rejected_version`/`rejected_idempotency`/`unsupported`/`unavailable`/`unverified`/`partial`/`conflict`/`timeout`/`cancelled`/`degraded` | 77-§11.1 冻结词表，保留下划线原值。本包不扩词表、**不造第 15 个 failure**（80-§5.7） |

〔结论〕**四族退役的落点**：`auth`/`gateway`/`deps`/`internal` 原是观测分组，不是 11 值 `category`，也不是 14 类 `failure`。退役后的目标取值：`missing-wkey` → `failure:'rejected_authority'` + `category:'EXTERNAL_REJECT'`；网关拒绝 → `subcause`=原码、`failure` 取网关给的值；三后端抛错 → `failure` 取后端 `ClassifiedError`，后端没给则 `unavailable`（`category:'STALL'`）；编程错误 → `subcause:'internal-bug'`、`failure:'rejected_precondition'`、`category:'CONFIG_INVALID'`，并写一条事件 note（80-§5.7 第 752 行）。`TOOL_SUBCAUSES` 的 5 个**值**保留（它们是稳定实现细目），退役的是 `TOOL_ERROR_CATEGORIES` 与 `ToolError.message`。

〔结论〕**逐拒绝码 → `failure` 的映射本包不猜**：现状 `gateway` 的 `GateWriteResult = {allowed:true,signed} | {allowed:false,reason,needsLlmFallback?}` **不带 `failure`**，14 个码各自应对应 77 的哪一类没有任何上位表。M3 之前，本包只能断言 `subcause`=原码，断言不了 `failure`；若在工具面私设映射，就会产生第二套语义。→ §八 G-05（建议 78/80 给表，或让网关在拒绝时直接带 `failure`）。

〔结论〕**`ok:false` 不是失败记录**：MCP 结果里的 `failure` 只对客户端分类，不落 `REC-*`；要落记录须由 77 定义（§八 G-09）。同理 `failure:'unsupported'` 的 `verdict-without-result`（§4.9 前置 (b)）不是平台拒绝，而是“通道缺结果”的如实拒绝。

### 5.6 记录与证据（77）

- `evidence-write` 的产物只对应 `REC-EVD-02`（单个可复核材料）的**材料面**；`REC-EVD-02` 还要求形成时间、来源、主体等字段，本包**不产出**这些字段，也不写台账。
- `REC-EVD-01`（收割批次）由 daemon 的收割相位产生，不是工具；80-§11.4.1 明确 `TS-PORT-EVD-01` 是**只读收割**。
- `article`/`kb-search`/`budget-query`/`heartbeat` 没有对应的 `REC-*` 定义（77 未逐工具定义）；本附录不编造映射 → §八 G-09。
- **stdio 面不写记录**：helper 只在 stderr 打单行日志，不落台账、不发通知；`REC-OBS-02`（投递/观测故障）只由 daemon 写（80-§6.6）。
- **通知不走广播面**：MCP 通知的目标固定为 `mcp-session`（只回当前 worker 会话），**不经 `NotifyBroadcastFace`**（80-§6.6）；本包不实现 `Notifier`，也不发广播。若将来要经 `Notifier`，`Notification` 必须保持 `{kind,title,body,from?,links?}`（`from` 是**展示字符串**，不是授权主体，不得改成对象）；带投递身份时用 `NotificationEnvelope{notificationId,message,targets,dedupKey?}`（80-§6.6 正文；本批指令与 `01-contract` 摘要简写为 `id`，同义，**非 qid**）。

### 5.7 跨卷依赖索引（不属本卷，只登记形状与边界）

| 跨卷件 | 归属卷 | 与本包的关系 | 本包 import | 本卷落点/约束 |
|---|---|---|---|---|
| `contract/src/secrets.ts`（`redactOutbound`/`redactKnownSecrets`/`findSecretShaped`/`SecretShapeFinding`/三正则/`REDACT_MARK`/`MIN_KNOWN_LENGTH`） | `81-files/01`（80-§11.2-3） | 目标**值 import**：`server.ts` 的 `detail` 消毒、stdio/daemon-link 日志 | 是（目标） | §4.2/§5.4；**禁止** `studio-tools→core`、禁止第二份正则 |
| `contract/src/ports/secret.ts`（`SecretCatalogEntry`/`SecretProvider`/`SecretMaterial`/`KnownSecretSet`） | `81-files/01`（80-§11.2.1） | 本包**不持有** `KnownSecretSet`；wkey 的活跃期登记在 daemon | 否 | §5.4；不得在 worker 侧重建集合或复制值 |
| `contract/src/ports/gateway.ts`（`GATEWAY_ACTIONS`/`GateWriteResult`/`GateRejectReason`） | `81-files/01`/`06` | 现状 type-only；`gateWrite` 由宿主注入 | 是（type） | §4.2/§5.5；`GateWriteResult` 缺 `failure`（G-05） |
| `contract/src/ports/record.ts`（`RecordQuery`/`RecordPage{items,nextCursor}`/`ProjectionName`/`TxReceipt`） | `81-files/01`（目标件，现状无此文件） | `kb-search` 的目标映射是 `RecordReader.query`，但工具入参只有 `query`、没有必填的 `limit`/`order`/`cursor`，出参 `hits: KbHit[]` 不透传 `nextCursor` | 否（经注入 deps 调，不 import） | §4.1/§八 G-01；**不**在工具面造分页 |
| `contract/src/ports/effects.ts`（`BindingProfile` 20 字段/`StateMapping`/`ExportScope`） | `81-files/01`（80-§6.6 `TS-PORT-BIND-01`） | 无（工具面不映射平台状态） | 否 | N/A；档案归 daemon 装配（`81-files/17`） |
| `core/src/work-readiness.ts`（开工五门纯求值） | `81-files/02` | 无（工具面不判开工） | 否 | N/A；不得在工具面复制五门 |
| `apps/daemon/src/assembly/intent/ingress.ts`（`IntentIngress`）/`receipt-store.ts` | `81-files/17` | 无（意图入口与工具面是两条链） | 否 | N/A；不复制 `IntentKey`/`IntentReceipt`/`intent_receipts` 字段 |
| `apps/daemon/src/assembly/api/assemble.ts`（`assembleApi(deps:{ingress,ledgerPath,company,config})`） | `81-files/17` | 无 | 否 | N/A；HTTP 错误体同用两轴，但 `traceId` 由装配面给 |
| `apps/daemon/src/engine/worker-key.ts`（`STUDIO_TOOLS_WKEY`、wkey 签发/吊销） | `81-files/16` | 本包的**外部消费者/凭据来源**：env 键名、per-ticket 生命周期 | 否（只读同名环境变量，不 import） | §5.4；改名与吊销语义以该卷为准 |
| `apps/daemon/src/engine/worker-key-lifecycle.test.ts` | `81-files/16` | 唯一外部调用锚（`createStudioToolsServer`/`StudioToolsServer`/`InMemoryTransport`） | 否 | §二；本卷不展开其契约 |

〔结论〕本包**只** import `contract`（type，目标值 import 脱敏函数）与 `gateway`（type）；上表其余件一律不 import、不复制字段。任何一行若要求本包 import，即等于新增包边，须走提案流（§1.2）。

---

## 六、测试与证据矩阵

| 断言面 | 承载测试 | 层级 | 证明 | 不证明 |
|---|---|---|---|---|
| 六工具与 `GATEWAY_ACTIONS` 同序 | `tools.test` 3 例 + `server.test` tools/list 1 例 | V0/V1 + V2 | 表镜像与广告面一致 | 两表在运行期永不失配（无 guard） |
| 输入拒坏/收对 | `tools.test` 12 例 | V0/V1 | `strictObject` 的拒收语义 | 协议层真的调用它（`server.test` 2 例补） |
| deny 两轴形状（目标） | `tools.test` 4→5 例 | V0/V1 | `failure` 必填、`category` 只收 11 值、`detail` 可选且不含绝对路径 | 运行时拒绝只落在 6 个可达 `category`；`failure` 与 14 个拒绝码的对应 |
| 六工具 happy path | `server.test` 6 例 | V2 | `gateWrite` 收到正确 action/单行 payload；回执形状 | 平台/知识库/证据目录发生效果 |
| fail-closed 无 key | `server.test` 2 例 | V2 | 网关/deps 零调用；目标 `failure:'rejected_authority'` | 真实 stdio/真实宿主的行为 |
| 坏 key 拒绝码 | `server.test` 5 例 | V2 | malformed/bad-signature/scope/expired/replay 原码透传为 `subcause` | 其余 9 码；逐码 `failure`（G-05） |
| 协议层拒坏输入 | `server.test` 2 例 | V2 | `isError` 且不进 handler | 所有 MCP 客户端的错误呈现 |
| deps 失败归类 | `server.test` 3 例 | V2 | 三后端抛错 → `failure`（后端给；没给则 `unavailable`）+ `category:'STALL'` | 生产后端存在/超时/部分成功；`detail` 消毒效果 |
| 凭据注入通道 | `server.test` 3 例 | V2 | `_meta` 捕获、`opts.wkey`、覆写 | 多连接、重连、env、daemon 派工接线 |
| stdio 三步注册先于服务 | `stdio.test` 例①②③④⑤⑥ | V2（fake link + 替身 socket） | 无 env / 未注册即非零退出且 stdout 零帧；challenge 过期/复用/换连接挪用即断连；ack 丢失后（旧连接清理完）重连取新 challenge 可成功；proof 错/异长/改一字节/换键序/换域串被拒 | 真 daemon 的 `verifySealed`、同 `(ticket,nonce)` 单会话、challenge 真绑连接（V5） |
| stdio `deny` 两轴与未注册 | `stdio.test` 例⑦⑧⑭ | V2 | `deny`→`isError`+原码+两轴；未注册本地拒、socket 零字节；stdout 全行 JSON-RPC | 跨进程吊销、防重放、真管道分帧 |
| stdio 超时/畸形/断连 | `stdio.test` 例⑪⑫ | V2 / V4 子集 | `timeout` 不改结论；畸形帧/超长行断连后全拒 | 迟到副作用对账（归 daemon `REC-06`） |
| `allow` 结果面（G-19 锁） | `stdio.test` 例⑨（**先红**） | V2 | `allow` 无 `result` 必须 `unsupported`/`verdict-without-result`，不得伪成功；`applied`/`unknown` 透传且脱敏、限长 | daemon 真代执行与现签；`contract` 的 `EffectOutcome` 导出；`result` 形状/大小上限（G-19） |
| daemon-link 并发归位 | `stdio.test` 例⑩ | V2 | `reqId` 回显归位、乱序不掉包、未知 `reqId` 丢弃 | 多 helper 并发、连接复用、ABA |
| daemon-link 验签口径（daemon 侧） | **无**（只到 fake） | V5 缺 | — | `verifySealed` 不消费 nonce、单 `(ticket,nonce)` 会话、challenge 一次性 |
| 连接身份/peer 凭据（宿主注入） | **无**（只到 fake） | V5 缺 | — | `PeerCredentialVerifier` 的 `host-bound` 适配与 `peer-verified` 判定；无适配时一律 `unverified`，`0700`/`0600` 不构成 uid 已核事实（G-20） |
| stdio 生命周期收口 | `stdio.test` 例⑬ | V2 | `SIGTERM` → `server.close()` + `link.close()`（关 socket），不发 `unregister` 帧 | 真进程信号投递、daemon 侧注销审计 |
| stdio 帧字段白名单 | `stdio.test` 例⑮（`fakeDaemon` 接收侧断言） | V2 | 注册三帧不带 `reqId`；`register` 三键、`challenge` 三键、`proof` 一键、`ack` 至多两键、`call` 三键且无 `wkey`/`SEC-*` 原值、`verdict` 允许 `result`/`failure` 且无原值（`wkeyRef` 是**合法引用**，不算泄漏） | daemon 真按连接绑定/重连重注册的行为（V5） |

〔边界声明〕`Notification` 与 MCP 通知目标 `mcp-session` 不经 `NotifyBroadcastFace`（80-§6.6）是**契约边界**，不是测试断言：本包没有通知单测，也不需要为它新增（通知投递归 daemon）。同理，`traceId` 不属 MCP 面，测试里不出现也不代表缺失。

R/E/W 追溯（只列有直接关系的；其余 N/A）：

- **R7**（执行能力退化/不可用→明示不能，不得降标冒充完成）：工具面以 `ok:false` + 两轴分类拒绝，不返回伪成功；`deps` 抛错不得被吞成空结果；`allow` 但无结果载荷时必须 `unsupported`（§4.9 前置 (b)），不得编造 `signed`。`searchKb` 返回空数组是后端语义（`Ok([])`），不是本包可判的“不可用”。
- **R12**（外部伪造意图/证据）：异密签发的 wkey → `gw-verify-bad-signature`；未注册 helper 一律 `deny`；但 wkey 是**技术许可**，通过验签不等于公司授权（78-§11.4/80-§11.1）。
- **R27**（清单沉默不得自动扩权）：工具集封闭；新增工具必须改 `contract` 表（批示流），不得在本包私加，也不得为 stdio 另起第二套注册面。
- **W3/W9**（自检/内部验收不等于独立验收）：`evidence-write` 只落材料；工具 `ok` 不等于验收通过、更不等于结清（77-§6.4）。
- **W10**（只报有利证据）：拒绝必须如实分类返回；本包无日志/事件/指标，审计依赖调用方另记（G-06）。
- **E2**（外部网关）：本包是 E2 的**调用方**，不是闸本身；stdio 面也只把裁决送回 daemon，不自建闸；网关拒绝即拒绝，无旁路。
- **V0/V1**：本附录的静态核查与 `tools.test`；**V2**：`server.test` 的进程内协议行为 +（目标）`stdio.test` 的 fake link/替身 socket 接线；**V3**：N/A（无第二实现）；**V4**：仅进程内故障子集（坏 key、deps 抛错、协议拒、超时、畸形帧、断连），缺跨进程/并发/长正文/路径越界/吊销可见性；**V5**：缺（真宿主拉起、真 daemon 验签、socket 0600、长正文、并发会话）；**V6**：N/A（本包无自治评估语义）。

〔结论〕本包测试绿只能证明“进程内协议 + 真网关内核 + fake 后端”的组合回归，以及（目标）stdio 帧协议对 fake daemon 的接线；不能证明真实工具面可用（`U80-17` 的 V5 探针全缺，78-§11.4 的 blocking 仍未解）。

---

## 七、规模预算与迁移波次

### 7.1 预算

| 约束 | 现状 | 目标 | 判定 |
|---|---|---|---|
| 目录直属文件 ≤25（`src`） | 5 | 8（+`stdio.ts`/`daemon-link.ts`/`stdio.test.ts`） | 通过；`src` 直下上限仍是 25，不为新件预开子目录 |
| 单文件 ≤600 行 | 最大 440（测试）、335（生产） | 预计生产 ≤360、测试 ≤540 | 通过；`server.test` 逼近 600 时按 §4.4 预案拆（`src` 升到 9 件仍 ≤25） |
| `lineBaseline` | 无本包条目 | 不得新增 | 不拆、不提阈值 |
| 域平面基线 | 不适用（仅 daemon） | 不新增域 | 新增三件属同一子域（传输入口 / IPC 客户端 / 其测试） |
| 包层位/边 | 4；→gateway/contract | 不变（stdio 只加 `node:*` 内建，不是包边） | 不新增边 |
| 包总量 | 1344 行 | 预计 ~2000（±10%） | 只作规模核对，不作能力证据 |

### 7.2 波次（全部为设计处置，未执行）

1. **M0（本附录）**：只写文档；不改源码/manifest/测试。
2. **M1（文档修正，无行为变化）**：按 §4.8 的八项改 README 的状态标签、工具表“是否产生外部效果”列、挂载样例（目标形态 + 当前不可用）、计数复算公式、错字、鉴权口径、错误口径、阻塞项指向；删掉不存在的入口路径与“照抄即用”语气。可独立回退。
3. **M2（测试加固，无行为变化）**：`server.test.ts` 追加 §4.4 目标追加的 ①–④、⑥（deny 两轴形状、消毒、env 优先不覆写、`close()` 后清空、构造期 `ClassifiedError`）；⑤ 超时依赖 80 定注入面，未定不做。`tools.test.ts` 的 4 例输出断言改为 5 例两轴断言。**先红后绿**：先让新断言暴露现状，再在 M3 修实现；不得为保绿删例。预计 +80~120 行。
4. **M3（最小行为修正，仍不接生产）**：错误体两轴化 + 四族退役（§二/§5.5）、`detail` 消毒（`contract` 的 `redactOutbound`/`findSecretShaped`）、构造期 `configInvalid`、`StudioToolsServerOptions.gateway` 放宽为 `ToolGate`（含 `await`）、`_meta` 降 legacy。**未定不做**：后端超时/取消（需 80 定 `AbortSignal` 或超时注入面）、`SERVER_INFO_DEFAULT` 版本改由 manifest 注入（涉 79 构建约束）。**不得**在本波次假装“stdio 已接”。
5. **M4（stdio，三段，缺一不得宣称完成）**：**(a)** `daemon-link.ts` + `stdio.ts` + `stdio.test.ts`（前置：daemon 侧 socket 服务与三步握手服务端，归 `81-files/17`；语义前置：`WkeyAuthority.verifySealed` 不消费 nonce + 进程内单实例共享 authority + 签发登记表，归 `81-files/06`/`16`；proof 的 `studio-next/jcs@1` 规范化器需两侧同一实现（G-21；字节规则已冻结、G-18 关闭），对端 uid 只能由宿主 `PeerCredentialVerifier` 提供、默认 `unverified`（G-20）；(a) 只按「三步注册 + `call{reqId,tool,args}`」写，不得把注册压成一步、不得自选 nonce 语义）；**(b)** 结果面（§八 G-19）：`contract` 先导出 `EffectOutcome`/`Qid`、daemon 落地代执行与内部现签，`allow` 才可带 `result`；关闭前 `allow` 路径锁在 `unsupported/verdict-without-result`，第⑨例保持红或显式 `todo`；**(c)** `exports["./stdio"]` 子路径（依赖 M5 的 dist；若 M5 不立项，只能在 monorepo 内按绝对路径引 `.ts`，对外能力仍算未交付）。**(a) 单独完成不得写成 stdio 已接。**
6. **M5（dist 切换，前置全部满足才启动）**：按 79-§6.1 顺序 `dsh-bridge → contract → gateway → studio-tools`；同单改 `package.json` 的 exports/files/license、加 `tsconfig.build.json`、根 `tsconfig.json` 移出本包、根 `typecheck` 串接本包；跑五条构建判据（79-§5.6）。回退=三处同单改回。

### 7.3 不做

- 不拆 `tools.ts`/`server.ts`（无超限、无职责错位证据）。
- 不把测试移出 `src`：现状 `src/*.test.ts` 被根 program 与包级 typecheck 同时覆盖；移到 `test/` 会退出根 `packages/*/src/**` 的覆盖，需要另建包级 include，收益不明。dist 构建配置排除 `**/*.test.ts` 即可。
- 不为 stdio 预建空文件、空测试、空 `bin`，也不做全局命令（helper 由 MCP 客户端按显式路径 `spawn`）。
- 不改 `tools.ts` 的工具语义来“让测试更好看”；不为保绿删 `stdio.test` 第⑨例。
- 不在本包私设 14 个拒绝码 → `failure` 的映射表，不改 `GATEWAY_ACTIONS`，不加第七个工具（R27）。
- 不宣传 OAuth 形态、不把 `_meta` 重新宣传为主通道（80-§11.4.1 第 1 条）。

---

## 八、未证与需回写（主 agent 处理）

编号 `G-81-15-*`（本附录内部登记号，不是上位 ID；上位 ID 在括号内）。

| 编号 | 缺口 | 归属卷/对象 | 为什么必须回写 | 建议决定 |
|---|---|---|---|---|
| G-01 | `StudioToolsDeps` 是包内接口，不是 80 的任何公共端口（对应关系只有 §4.1 那四行：`TS-PORT-EFF-01`/`TS-PORT-EVD-01`/`TS-PORT-REC-02`/`TS-PORT-REC-03`）：三个后端无端口、无 `knowledgeScope`、无 containment、无只读保证、无错误分类义务；`searchKb(query)` 也没有目标端口的必填 `limit`/`order`（`RecordPage` 还要 `nextCursor`） | 80-§6（端口全集）、§6.6 `TS-PORT-REC-02`、§11.4.1 四行映射 | 文件契约不能把包内接口冒充公共端口；本附录不得私设 `TS-PORT-TOOL-*`；不补 `limit`/`order`/游标就等于“只有进参没有出参的分页”（80-§6.6 判缺陷） | 80 决定：为工具后端开端口，或明文限定“工具面只产签名意图、后端由宿主代持”；两者都要回答工具是否透传 `nextCursor` |
| G-02 | `comment/heartbeat/article` 目前**零外部效果**；落单执行者未接线（daemon `EffectGateway.apply`？宿主回放？） | 80-§6.6 `TS-PORT-EFF-01`、§11.4.1 | 工具“成功”会被误读为已写平台；当前无任何回传通道，也没有幂等键承载位 | 80 定执行者与回传通道；在此之前文档必须写“不产生外部效果”（本卷已写） |
| G-03 | **stdio 协议已由 80-§11.4.1 定**（helper 先注册、逐调用 `call`→`verdict`、验签/吊销/审计在 daemon、stdout 只许 JSON-RPC），**不再是“方案未定”**；剩余的是**未实现、未证** | 80-§12.5 `U80-17`、82 | 82 需要一份可执行的 V5 探针清单，否则“已定协议”会被误读成“已可用” | 82 按 `U80-17` 排 V5（真 daemon 验签、socket 0600/同用户、重放、吊销、未注册、真 MCP 客户端）；本卷不新增决策 |
| G-04 | **已关闭（v0.4）**：原登记「80-§11.4.1 举例 `STUDIO_WKEY` vs 仓内 `STUDIO_TOOLS_WKEY`」的键名冲突。v0.4 复核 80 最新正文，第 1 条已写成 **`STUDIO_TOOLS_WKEY`**（并锚 `worker-key.ts:62`），口径一致 | 80-§11.4.1、`81-files/16` | 不成立——不再有两套名字；剩余只是 16 把源码注释的“拟稿定名”改为定稿 | 无决策需求；`81-files/16` 顺手落注释定稿即可 |
| G-05 | `GateWriteResult` 只有 `{allowed:false,reason}`、**不带 `failure`**；14 个拒绝码 → 77 的 14 类 `failure` 无上位映射表；`StudioToolsServerOptions` 构造期错误也不抛 `ClassifiedError` | 80-§5.7、`gateway/src/wkey.ts`、78-§11.4 | 下游无法稳定分诊；本包若私设映射就会造第二套语义；构造期与运行期两套错误形态并存 | 78/80 给逐码 `failure` 表，或让 `GateWriteResult` 的拒绝分支直接带 `failure`；构造期统一 `configInvalid`（本包 M3 执行后者） |
| G-06 | `denyResult` 原样拼接后端 `err.message`（可能含绝对路径/内部标识/疑似 token）；本包**无日志/事件/指标**；MCP 面不产 `traceId` | 80-§5.8、§11.2.1（脱敏纯函数迁 `contract`）、82 | 违反秘密与路径边界；且拒绝没有审计面，`W10` 只能靠调用方另记 | 80 定 MCP 面审计与 `traceId` 责任（或明文“工具面不入审计”）；`81-files/01` 先落 `contract/src/secrets.ts` 迁移，本包 M3 才可调用 |
| G-07 | 79-§6.5 的目标 exports 只给 `exports["."]`，**缺 `exports["./stdio"]`**；`files`/`license` 也待补。**`bin` 不是缺口**（helper 由 MCP 客户端按路径 `spawn`，不是全局命令；v0.1 的 bin 缺口撤销） | 79-§6.5、§10.1 第 9 项 | manifest 改动的合法性依赖该裁决；没有子路径导出，stdio 无法对外（只能 monorepo 内按绝对路径引 `.ts`） | 79 补 `exports["./stdio"]` 与 `files`/`license` 行；daemon 的两条 `devDependencies` **不动**（生产 `src` 零 import） |
| G-08 | `evidence-write` 的 `path` 无 containment/realpath/符号链接检查；**谁负责未指派**（helper / daemon 侧端口实现 / 工作区绑定层） | 78 工作区绑定、80-§11.3/§11.4.1、75-D75-13 | “worker 给路径、后端直接写”会形成越界写面；本包加检查会形成第二套路径策略 | 78 明确 `evidence/` 沙箱所有权与校验层（三选一并写死）；本包只传路径与内容，不自建检查 |
| G-09 | 六工具缺逐工具记录映射（`article`/`kb-search`/`budget-query`/`heartbeat`）；`evidence-write` 只覆盖 `REC-EVD-02` 的材料面；`ok:false` 是否入记录未定 | 77-§6/§8 | 附录不得自造 `REC-*`；否则证据链断裂或出现“伪记录” | 77 逐工具定（记哪类、谁写）或明文“工具面不入记录”；两种都要覆盖 `ok:false` |
| G-10 | `StandardSchemaWithJSON` 类型桥（`McpSchemaOf`）的退出条件只有“zod 类型补齐”，无版本/触发条件；`server.ts` 的 zod 值导入仅类型使用 | 79-§3.2、`DEP-MCP-SERVER` | 升级 zod 时无人知道何时删桥、何时复验 `tools/list` 与 `.d.ts` 发射 | 79 登记退出条件与复验清单（`tools/list` 广告面 + 包级 typecheck + dist 判据） |
| G-11 | 跨进程缺口未全进 80-§12.5：`U80-17` 已覆盖重放/吊销/未注册/全局 secret/stdout 污染，**仍缺**多 helper 并发、同一 wkey 的会话复用、**受控 IPC 单帧上限**（stdio 传输层的长正文上界已由 SDK 给：`StdioServerTransport.maxBufferSize` 缺省 10 MB、超限即 error+close，见 §1.3；未定的是 `daemon-link` 的 socket 帧/`call.args` 上限，以及 `verdict.result` 的脱敏与长度上限） | 80-§12.5、82 | 82 无法据此排 V4/V5；帧上限与并发直接决定背压策略 | 80 在 `U80-17` 补列三项；82 建对应负向探针 |
| G-12 | **已关闭（v0.5）**：原登记「`verdict` 帧只有 `{reqId,verdict,reason?}`、没有结果载荷」。80-§11.4.1 最新正文已给 `verdict` 增 `result`（`{status:'applied',receiptRef}`/`{status:'unknown',unknownRef,reason?}`）与 `failure`（两轴），并写明 `allow` 不冒充 `applied`——该项不成立 | 80-§11.4.1 第 4 条、80-§5.2 | 帧形状已有承载位；但 `contract` 无 `EffectOutcome` 导出、daemon 代执行未实现、读面无承载位 → 另立 G-19 | 无决策需求；本卷按新帧写，G-19 未关前 `allow` 无 `result` 只准失败。`result` 的脱敏与长度上限并入 G-11 的帧上限 |
| G-13 | **已关闭（v0.4）**：`wkeyRef` 的来源与语法已由 80-§11.4.1 第 4 条定稿——**逻辑引用**，按 `SEC-WKEY-<ticketId>` 由凭据范围里的 `ticketId` 派生；不是 wkey 原文/密码/token/秘密值，也是不可转授句柄；daemon 用自己的内存凭据验签，不依赖 helper 送来的任何字节；解析不到活跃签发即 `registerAck{ok:false}` | 80-§11.4.1 第 4 条、78-§7.4.1 | 不成立——引用格式与解析责任都已写死 | 无决策需求；本卷按 `SEC-WKEY-<ticketId>` 实现，`stdio.test` ⑮ 断言帧里只有引用、没有值 |
| G-14 | **已关闭（v0.4）**：原登记「`register` 无 `reqId` 而 `registerAck` 带 `reqId`，两侧无法对号」。80-§11.4.1 最新帧集**两侧都不带 `reqId`**：一条连接只注册一次，`registerAck` 天然对应该连接；只有 `call`/`verdict` 带 `reqId` | 80-§11.4.1 第 4 条 | 不成立——不存在错配面；实现不得再给 `register`/`registerAck` 补 `reqId` | 无决策需求；本卷按定稿实现，`stdio.test` ⑮ 反证 |
| G-15 | **已关闭（v0.5）**：原登记「`call` 不带 wkey + 每调用验签 + nonce 单次有效」三者冲突。80-§11.4.1 已定：daemon 用 `WkeyAuthority.verifySealed` **完整验签但不消费 nonce**（`timingSafeEqual`、异长直接拒、不写 `seenNonces`），被消费的是**一次性、短 TTL、绑连接**的 challenge；同一 `(ticket,nonce)` 只允许一个活跃会话，第二个会话注册即 `ok:false` | 80-§11.4.1 第 3、4 条、`gateway/src/wkey.ts` | 不成立——验签与防重放已分离为「challenge（消费）+ 活跃签发表（单会话）」两处 | 实现前置：`verifySealed`、进程内单实例共享 `WkeyAuthority`（现状 `gateway.ts:65` 每次新建）、签发登记表均未落地（归 `81-files/06`/`16`）；本卷只写契约 |
| G-16 | **已关闭（v0.5）**：原登记「`@action` 行 vs 结构化 `args` 的形状差」。80-§11.4.1 已定 `encodeAction`/`decodeAction` **集中在 gateway**，工具面与 HTTP 面共用；stdio 适配层用 `decodeAction` 还原 `args`，`daemon-link` 只收发结构化 `call{reqId,tool,args}`，不再有第二份解析 | 80-§11.4.1 第 4 条、`gateway/src/actions.ts` | 不成立——解析归属已唯一；但 `packages/gateway` 现状**没有**这两个函数、也无纯子路径导出 → 另立 G-17 | 无决策需求；取用方式见 G-17，未落地前只做注入式，绝不私拼第二份格式 |
| G-17 | **（新，v0.5）**`encodeAction`/`decodeAction` 在 `packages/gateway` **尚不存在**：`src/actions.ts` 只有 `parseAction`/`isFreeformChinese`/`ActionRejectReason`；包根 `index.ts` 的值导出会把 `createGateway`/`createWkeyAuthority`/secret 面一起拉进 worker 运行时图，而 `package.json` 没有纯子路径（如 `./actions`）导出 | 80-§11.4.1 第 4 条、79-§6.5、`81-files/06` | 没有唯一实现，适配层只能自拼或复制解析，必然漂移并扩大注入面（帧里可塞任意串） | `81-files/06` 落 `encodeAction`/`decodeAction` 并给纯子路径导出；未落地前 M4 用**注入式** `decodeAction`，`stdio.ts` **不得**从 gateway 包根值导入；`daemon-link` 永不解析 `@action` |
| G-18 | **已关闭（v0.6）**：原登记「`proof` 输入串的字节级规范化未定」。80-§11.4.1 已冻结：输入是 **`studio-next/jcs@1`**（RFC 8785 基线，76-§1.5.1）序列化的**恰五键**对象 `{protocol:'studio-next/stdio-register@1', challenge, helperId, pid, wkeyRef}` 的 UTF-8 字节（JCS 字典序 `challenge`/`helperId`/`pid`/`protocol`/`wkeyRef`；`pid` 为 JSON number、其余为原文 ASCII，无空白/换行），`proof = base64url(HMAC-SHA256(wkey 原文, 该字节))`；`alg:'hmac-sha256-v1'` 即“该规范化 + 域串 + SHA-256”整套，换任一环必须换 `alg` | 80-§11.4.1 第 4 条、76-§1.5.1 | 不成立——字节输入与域分隔已冻结，不再允许 `a+b+c`、空格分隔或 `JSON.stringify` 默认键序 | 无决策需求；改键序/加空白/换域串/换算法/改一字节必须拒（§4.11 ⑥）。实现前置：共用规范化器与固定**假**向量尚未落地 → G-21 / 82 |
| G-19 | **（v0.5 新增，v0.6 复核仍在）**结果面三缺：①`packages/contract/src` **没有** `EffectOutcome`/`Qid` 导出（2026-10-27 复核仍零命中；80-§5.2 已定义形状），`verdict.result` 与 `ToolGate.outcome` 只能用结构形状；②daemon「代执行 + 按 `scope[action]` 内部现签一次性调用 key」未实现，`allow` 之后无人执行；③读面数据（`hits`/`view`/`bytes`）在 `result` 两态里**没有承载位** | 80-§5.2、§11.4.1 第 4 条、`81-files/01`、`81-files/17` | 不解三件，stdio 面永远停在 `verdict-without-result`；私造结果字段就是第二套公共语义 | `81-files/01` 导出 `EffectOutcome`/`Qid`；`81-files/17` 落 daemon 代执行与现签；80 决定读面结果怎么回（新增 `result` 变体或明文“走其它通道”）。未关前 `allow` 无 `result` 一律 `unsupported/verdict-without-result` |
| G-20 | **（v0.5 新增，v0.6 改写）**对端凭据**无已验证适配**：80-§11.4.1 已定宿主注入 `PeerCredentialVerifier`（`kind:'host-bound'` 或 `'none'`、`verify(handle)`），但 Node 24 **没有** `getpeereid`/`SO_PEERCRED` 内建 API（`net.Socket` 不暴露对端凭据），**不得**直接调用；仓内无此接口、无 peer 句柄来源、无 native 适配 | 80-§11.4.1 第 4 条、`81-files/17` | 无适配时连接只能是 `unverified`；写成“已核 uid”是伪造。`0700`/`0600`/`umask 0077`/`lstat` 只是**部署边界**（只挡别的 OS 用户），**不产生** uid 已核事实；同 uid ≠ 员工身份/已授权 | 默认 `kind:'none'`（`unverified`）即可运行，**不默认新增 native addon**；只有宿主确实提供已验证适配且 `uid === daemon uid` 才升 `peer-verified`；核心信任=challenge-proof+活跃签发+scope；恶意/误连同 uid 进程由 **OS 用户隔离或容器/VM 隔离**解决，不得宣称 socket 权限已解决。82 真机取证前一律标未证 |
| G-21 | **（新，v0.6）**`studio-next/jcs@1` **规范化器无共用实现**：76-§1.5.1 只给规则与 `vectors-published`（无实现运行记录）；`packages/core` 两处私有 `canonicalize`（`judge.ts:149`、`models.ts:294`）未导出、未标该 ID，也不保证 RFC 8785 的数值/转义细节；`packages/contract` 无可导入实现 | 76-§1.5.1、§12.1、80-§11.4.1 第 4 条、`81-files/01` | helper 与 daemon 各写一份就会永久验签失败；私写会引入第二套规范化语义，`proof` 无法跨实现复现 | `81-files/01`（或实现单）落一份纯函数、带 `canonicalizationId='studio-next/jcs@1'`，两侧共用；跑 76 公布的向量与 82 的三件固定**假**向量（JCS 字节一致、`alg`+域串绑定、改一字节必拒）；在此之前 `proof` 标「字节规则已冻结、实现未证」，不得声称已支持 |

跨卷观察（不在本附录修）：①`packages/gateway/src/wkey.ts:10` 头注写“八种拒绝码”，实际 `WkeyRejectReason` 是 7 值；`server.ts` 的 `GATE_DENY_HINTS` 按 7+5+2=14 键完整覆盖——该漂移归 `81-files/06`。②`81-files/01` 的摘要把 `NotificationEnvelope` 的键写成 `id`，80-§6.6 正文是 `notificationId`；两者同义但应统一措辞，归 `81-files/01`（本卷按 80 正文写 `notificationId`）。③**78 与 80 对 per-ticket wkey 的脱敏集合口径不一致**：78-§7.4.1 表把 wkey 记为“**不在 known set 里**——活跃期泄漏面未覆盖”，80-§11.2.1 第 2 条则规定 wkey **活跃期入** `KnownSecretSet`（`SEC-WKEY-<ticketId>`）、`CLOSE` 移除并留一个去重窗。两者影响“wkey 原文出现在日志时能否被已知值脱敏”；本卷按 80（新）写 §5.4，但须由 78/80 统一后回写 `81-files/16`（wkey 生命周期）。

---

## 九、本附录的判负边界

以下说法一律判负，不得由本文推导：

1. “stdio 已接/可用”——只有 (a) 传输+注册+裁决 也不算：结果通道（G-19）、子路径导出（G-07）、V5 证据都缺（§4.9 前置 (b)(c)、`U80-17`）。
2. “studio-tools 已接入生产”——生产 `src` 零消费者，无 stdio 入口（78-§11.4 blocking 未解）。
3. “工具调用成功=评论/心跳/文章已写平台”——前三工具零 IO，只回署名字段；`EffectGateway.apply` 未接线（G-02）。
4. “`gateWrite` 通过=已授权/已验收/已结清”——它只验技术凭据、校验动作词、落款；wkey 是技术许可，不是公司授权。
5. “`evidence-write` 成功=完成 / 路径已 containment”——只证明后端返回字节数；证据四要件与验收归 77/daemon，路径校验责任方未定（G-08）。
6. “43 例通过”——本附录没跑测试；43 只是静态计数（22+15+6），且测试绿不证明真机（75-§九）。
7. “两表由机制保证不漂移”——只有测试断言，无 guard。
8. “stdio 只是缺一个文件 / 方案未定”——协议已定（80-§11.4.1，含三步注册与 `verifySealed`）；缺的是实现、结果面、子路径与 V5 证据（G-03/G-07/G-19）。
9. “dist 切换已做/可随时做”——未创建 `tsconfig.build.json`、未改 exports、未验证五条构建判据。
10. “四族 `category` = `ClassifiedError` = 77 失败类”——三套不同；四族目标-退役，逐码 `failure` 映射待 78（G-05）。
11. “`call` 帧带 `wkey`，或注册三帧/`registerAck` 带 `reqId`”——80-§11.4.1 定稿：`register` 恰三键、`call` 恰三键（无凭据）、注册三帧都不带 `reqId`，只有 `call`/`verdict` 带 `reqId`；出现即实现缺陷（§4.10/§4.11 ⑮）。
12. “`register` 一帧就完成注册 / `register` 通过即身份已证”——`register` 只是**申请**；必须 `registerChallenge` → `registerProof` → `registerAck{ok:true}` 才算注册。把 register 当证明、跳过 proof、或把三步压成一帧，一律判负。
13. “注册态可跨连接复用/重连免注册/`wkeyRef` 可转授/challenge 可续期或复用”——注册绑定连接（daemon 按 peer 句柄记；`0700`/`0600` 只是部署边界），challenge **一次性、短 TTL、只对该连接有效**，过期不续期；**旧连接清理完成后**才能重注册，断开与重启后必须重走三步（80-§11.4.1 第 4 条）。
14. “`allow` 就是成功 / 工具已生效”——`allow` 只表授权通过；没有 `result`（`applied{receiptRef}`/`unknown{unknownRef}`）或 `failure` 的 `verdict` 不得渲染成成功（§4.9/§4.10/G-19）。
15. “`proof` 里带 wkey 原文 / `proof` 可用任意拼接算 / `proof` 可复用”——`proof` 只是 HMAC 结果，原文不出进程、中间值算完即弃；输入必须是 **`studio-next/jcs@1` 五键字节**（`a+b+c`、空格分隔、`JSON.stringify` 默认键序一律判负），同一 challenge 的 proof 用第二次即拒（§4.11 ④⑥）。
16. “同 uid 即员工身份 / 连上 socket 即已授权 / `peer-verified` 已成立”——`0700`/`0600`/`umask 0077` 只挡别的 OS 用户；对端 uid 只由宿主 `PeerCredentialVerifier` 给出，**无已验证适配即 `unverified`**，不得记 `peer-verified`；核心信任=challenge-proof+活跃签发+scope，恶意/误连同 uid 靠 OS 用户/容器隔离（80-§11.4.1 第 4 条、G-20）。
17. “`wkeyRef` 出现在帧里=泄漏”——它是合法逻辑引用（`SEC-WKEY-<ticketId>`），判据是**原值**是否出现，不是字段名里有没有 `SEC-` 字样（§4.9/§4.11 ⑮）。
18. “`studio-next/jcs@1` 已可跨实现 / 已支持”——76 只有 `vectors-published`，仓内**无共用规范化器**（G-21）；在 76 向量与 82 三件固定**假**向量跑通前，只能声称“字节规则已冻结”，不得声称已实现/已支持。

另两条同样判负：①“`ok:false` 就是 77 的失败记录”——MCP 结果不落记录（§5.5/G-09）；②“工具面已完全脱敏/无泄漏”——本包只有形状兜底，`KnownSecretSet` 在 daemon，短值与非常规形会漏（§5.4）。

本附录只把 `packages/studio-tools` 的现有职责与目标处置写到文件级；能力、性能、跨进程与真机行为均未验证。

---

## 十、12 条定稿接口对齐核对表

本表逐条回答“该定稿接口是否落到本卷”。不适用的一律不给 F-ID、不复制字段、不新增动词；需要本包 import 的跨卷件已在 §5.7 列明。

| # | 定稿接口 | 适用性 | 本卷落点 | 若不适用：归属卷 |
|---|---|---|---|---|
| 1 | `RuleEvaluator` 两步不合并（`typecheck`/`evaluate`）、`TypecheckReceipt`、17 个诊断码相位映射 | **不适用** | — | 纯函数归 `81-files/02`，端口/类型归 `81-files/01`；本包不调规则求值，不复制诊断码 |
| 2 | `ClassifiedError{failure,category,subcause,detail?}` 两轴；HTTP 体 `{error:{failure,category,subcause},traceId}` | **部分适用** | §4.1（`DenyOutput`）、§4.2（`denyResult`）、§5.5、§4.9/§4.10（stdio 错误） | MCP 面不带 `traceId`（归 daemon/API 装配）；HTTP 体归 `81-files/14`/`17` |
| 3 | `WorkIntake.reserve` / `IntentIngress` / `intent_receipts` 投影 / `IntentKey` / 四态重投 / TTL | **不适用** | §5.7 仅登记为跨卷 | `81-files/01`（类型）、`81-files/17`（实现）；本包不收意图、不 import |
| 4 | `assembleApi(deps:{ingress,ledgerPath,company,config})` | **不适用** | §5.7 | `81-files/17`（装配）、`81-files/14`（路由）；本包不装配 API |
| 5 | `BindingProfile` 20 字段 / `mapState` / `StateMapping` | **不适用** | §5.7 | 类型归 `81-files/01`（`ports/effects.ts`）、档案归 `81-files/17`；本包不映射平台态 |
| 6 | 秘密：`SecretCatalogEntry`/`SecretProvider`/`KnownSecretSet`；`secrets.ts` 整模块迁 `contract` | **部分适用** | §5.4、§5.7、§4.2/§4.9（消毒） | 只消费 `contract/src/secrets.ts` 的纯函数（目标值 import）；不持有 `KnownSecretSet`、不 import `ports/secret.ts`（`81-files/01`） |
| 7 | stdio 已定协议：env 凭据（`STUDIO_TOOLS_WKEY`，只到进程不进帧）/ `run/daemon.sock` 或 `STUDIO_DAEMON_SOCK` / 三步注册 `register{helperId,pid,wkeyRef}`（仅申请）→`registerChallenge{challenge,alg,expiresAt}`→`registerProof{proof}`→`registerAck{ok,reason?}`（注册三帧均无 `reqId`）/ `call{reqId,tool,args}`→`verdict{reqId,verdict,reason?,result?,failure?}` / `proof`=base64url(HMAC-SHA256(wkey 原文, `studio-next/jcs@1` 序列化五键 `{protocol:'studio-next/stdio-register@1',challenge,helperId,pid,wkeyRef}` 的 UTF-8 字节))、常时比较，`alg:'hmac-sha256-v1'` 绑死规范化+域串+算法；daemon `verifySealed` 完整验签不消费 nonce、challenge 一次性短 TTL 绑连接、同 `(ticket,nonce)` 单活跃会话 / 调用由 daemon 内部现签一次性 key，`allow` 不冒充 `applied` / socket `0700`+`0600`+`umask 0077`+`lstat` 拒符号链接**仅部署边界**；对端 uid 只由宿主 `PeerCredentialVerifier` 给出（Node 24 无 `getpeereid`/`SO_PEERCRED` 内建 API），无已验证适配即 `unverified`、不得记 `peer-verified` / 注册绑定连接、重连须重走三步、未注册一律 deny / 不持 `gatewaySecret` | **适用** | §4.9、§4.10、§4.11、§5.3、§5.4 | 未实现=未证（`U80-17`）；上游未决：G-17（gateway 无 `encodeAction`/`decodeAction` 与纯子路径）、G-19（`contract` 无 `EffectOutcome`/`Qid`、daemon 代执行未实现、读面无承载位）、G-20（无已验证 `PeerCredentialVerifier` 适配，默认 `unverified`）、G-21（`studio-next/jcs@1` 无共用规范化器）；G-12/G-15/G-16/G-18 已由该条定稿关闭，G-04/G-13/G-14 同 |
| 8 | `Notification{kind,title,body,from?,links?}`（`from` 是展示字符串）/ `NotificationEnvelope{id,message,targets,dedupKey?}` | **适用（边界声明）** | §5.6 | 本包不发通知：MCP 通知目标 `mcp-session`、不经 `NotifyBroadcastFace`；信封键按 80 正文为 `notificationId` |
| 9 | `ProjectionName` / `RecordReader.query`→`{items,nextCursor}` / `ReadOnlyLedger.query` / `TxReceipt` abort / `MigrationPlan` 的 artifact 引用是 string | **部分适用** | §5.7、§4.1、§八 G-01 | `kb-search` 映射 `RecordReader.query`，但工具入参无 `limit`/`order`/`cursor`、出参不透传 `nextCursor`；`ProjectionName`/`TxReceipt`/`MigrationPlan` 不属本包（`81-files/01`/`03`） |
| 10 | `repo-validate` 留 `company` / 五门在 `core/src/work-readiness.ts` / fakes 只 demo/test / UTC 日键 | **部分适用** | §4.4（fake 边界）、§5.7 | 本包 `fakeDeps` 仅 test/demo，不得进生产装配（80-§6.6）；其余不属本包（`81-files/02`/`04`/`01`） |
| 11 | `external` 配置键集 / API 两态启动 | **不适用** | — | `81-files/17`（`ServeConfig`）、`81-files/14`（API）；本包不读配置、不启动监听 |
| 12 | `unknown` 平台状态 ≠ 77 异常 `unknown` | **不适用** | — | 本包无平台状态映射（`mapState` 不属本包）；不参与 77 状态判定（`81-files/17`/`77`） |

〔结论〕本卷**没有**因这 12 条新增公共概念、TS 端口、`REC-*`、状态、依赖边或依赖版本；本地新增的 `ToolGate`/`DaemonLink`/`DaemonLinkState`/`HelperRegistration`/`RegisterChallenge`/`RegistrationProver`/`VerdictOutcome` 均为包内或文件私有类型，不经包根导出（`EffectOutcome`/`Qid`/`ClassifiedError` 的**类型本体归 `contract`**，本卷只用结构形状，见 §八 G-19）。第 2、6、7、8、9、10 条的落地位置已在上表给出，其余六条明确不适用并指向归属卷。
