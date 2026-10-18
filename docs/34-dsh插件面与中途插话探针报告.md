# 34 · dsh 插件面与中途插话探针报告（0.2.0-rc.2 真机）

> 2026-10-18 ｜ cli 泳道探针工兵出品。制作人需求原话：「别的 agent 发消息了，跟他同单子的其他 agent
> 如果活着，我们就将这条消息临时插入进去」——向**运行中**的 dsh 会话注入一条临时消息，像聊天一样。
> 方法：全部结论来自真机实测（`/opt/homebrew/bin/dsh` 0.2.0-rc.2）+ 装机明文源码交叉核；B 段插件全部真机跑通。
> **本单未改任何 packages/ 代码**。证据落 `/Volumes/BigDisk/probe-evidence/dsh-plugin/`（索引 `INDEX.md`）。
> 凭证路径沿用 docs/31 §7：kimi-coding provider + `KIMI_API_KEY` env（OAuth 15 分钟窗口，跑前 `kimi -p hi` 刷新）；
> 恒 `DSH_TELEMETRY_MODE=DISABLED`；令牌/进程 token 零落盘（A3 服务器日志已脱敏）。

---

## 0. 摘要（一句话版）

**「中途插话」在 dsh 上是一等公民能力，但只在两个程序化通道上**：web profile 的 HTTP RPC
（`POST /api/session/prompt` 带 `mode:"steer"`，**步粒度、turn 中**）与 SDK/ACP 的 stdio JSON-RPC
（`session/prompt`，**turn 粒度、turn 间**）；headless 的 stdin `-` 模式结构性不可插话（EOF 前不启动）。
插件面完整可用：本地相对路径插件、pnpm 安装型插件、MCP stdio 接线全部真机跑通，插件可注册工具、
监听全事件总线、并在进程内对任意活 agent 调 `steer/followup/inject` 三原语。
**对 daemon 最干净的接法**：适配器 vNext 给 dsh 加一条「长驻宿主」launch 形态（web 或 sdk profile），
把 ExecutorAdapter 端口从「一次性子进程」升出一个可选的 `interrupt(h, message, mode)` 通道（§4）。

### 三个最关键的事实

1. **内核三原语**（dsh-agent-loop 源码 + 真机双验）：每个活 agent 有三个消息入口——
   `followup(msg)`＝排队**下一个 turn**（独占新 turn 的开头消息）；`steer(msg)`＝插到**下一个步边界**
   （turn 中、下一次 LLM 调用前，且「有 next-step 挂起时 turn 不结束」）；`inject(msg)`＝步边界上下文但不唤醒。
   inbox 是**持久投影**（落在 session 事件流，跨进程存活）。
2. **外部通道只有两条**，且粒度不同：web HTTP RPC 的 `mode:"steer"` 走 `agent.steer()`（turn 中），
   SDK/ACP jsonrpc 的 `session/prompt` 只走 `agent.followup()`（turn 间，但同进程自动续 turn，无需重启）。
   headless 的 `-` stdin 在源码层是 `for await (chunk of process.stdin)` **读到 EOF 才建会话**——中途写管道
   只会把文本拼进初始任务，任务根本没启动。
3. **插件是万能后门**：一个 20 行的本地插件（相对路径 + insert 条目，零构建链）就能注册模型可调用的工具、
   监听 `agent/created`/`session/event`/`agent/pre-step`（每步触发）——进程内还能经 `ctx.agents` 拿任意活
   agent 调三原语。这给 daemon 一条「自带注入通道」的变通路（§4 方案 C）。

---

## 1. 机制核：三原语与两条 turn 续命规则（源码 + 真机交叉）

`ReactLoopAgent`（`@deepseek-ai/dsh-agent-loop/lib/index.js`）：

```js
followup(input) { this.send(input, "next-turn", true); }   // 排下一 turn，唤醒
steer(input)    { this.send(input, "next-step", true); }   // 插下一【步】边界，唤醒
inject(input)   { this.send(input, "next-step", false); }  // 插下一步边界，不唤醒
```

turn 主循环的两条续命规则（`turn()` 源码，A3 真机流逐条吻合）：

- 每步开吃（`preStep` → `inbox.claim(target)`）：**吃光全部 next-step**，turn 的第一步额外吃 **一条** next-turn；
- turn 想结束（`turnEnds`）时若 `inbox.nextStep.length > 0` **则不结束**——steer 进来的消息必然被当前 turn
  的下一个步边界消化（A3：插话落在 turn=1 的两个 bash 之间，seq21，单 turn completed）。

inbox 持久性：pending 消息以 `inbox/splice` 事件落 session 日志（zstd），进程崩溃后 resume 仍在队列。
SDK 面文档原话「durable enqueue receipt」与此一致（A2：`session/prompt` 立即返回 `messageId`）。

---

## 2. A 段判定表：五条插话路径

| # | 路径 | 判定 | 粒度/时机 | 真机事实（证据） |
|---|---|---|---|---|
| A1 | headless stdin `-` | **不可行** | — | 管道保持打开：10s+6s **零事件**（连 session 事件都没有，EOF 后 22ms 才出首事件）；中途写入的第二行被**拼进初始任务文本**（单 turn 单 step，模型把插话行当任务原文复述）。源码：`readStdin()` 读到 EOF 才 `createAgent`（`A1-stdin-probe.log/.mjs`） |
| A2 | SDK jsonrpc（`dsh --profile sdk`，stdio） | **可行（turn 间）** | turn 粒度：当前 turn 结束后，**同进程自动**开新 turn 消费，worker 不重启不空转 | turn1 运行中（bash sleep 20 执行中）发 `session/prompt`#2 → 立即回 `messageId`（durable enqueue）；turn1 completed → **2ms 内** turn2 开、`user/message` seq25＝插话原文（id 与回执一致）→ turn2 回复 `MIDTALK-SIDECAR-MARK`。协议仅 3 方法：`initialize`/`session/prompt`/`shutdown`；通知面 `session.event`/`session.status`/`subagent.*`（`A2-sdk-jsonrpc-probe.log` 等 4 件） |
| A3 | web HTTP RPC（`dsh --profile web`，:13089 实测） | **可行（turn 中，推荐）** | **步粒度**：下一次 LLM 调用前插入，当前 turn 内消化，任务不中断 | `POST /api/session/prompt`（信封 `{type:"client-request",rpcId,method,payload:{args:{request:{requestId,sessionId,mode,content}}}}`，cookie 鉴权经 `GET /?token=` 换取）`mode:"steer"` → 插话落 turn=1 步边界（seq21，两个 bash 之间），终答带 `STEER-SEEN-IN-TURN1`，**单 turn completed**；`mode:"queue"` 对照 → 消息成 turn2 开头（followup 语义）；`session/updateQueue` action:"steer" 可把已排队消息**提升**为 turn 中插入（seq23 落 turn1 内）。另有 `session/cancel`（打断当前 turn 保留队列）、`session/projections`（实时读 inbox 队列/tokenUsage/turnOutline）（`A3-*` 7 件） |
| A4 | 插件/事件总线（进程内） | **可行（全能力）** | 三原语任意调 + 每步钩子 | 本地插件真机监听 `agent/created`、`session/event(turn/start|turn/end)`、`agent/pre-step`（每步触发，witness 时序实录）；`ctx.tools.register` 假工具被模型调用成功；进程内经 `ctx.agents` 可对任意活 agent 调 steer/followup/inject（webhook 插件即此模式：`ctx.agents.create` + `followup`） |
| A5 | `--session-id` 续跑 | 对照组：**turn 间（跨进程）** | 与 A2 的 followup 同语义，但需**重起进程** + cwd 逐字节一致 | docs/31 §7 P-05 已证（turn:2、cacheReadTokens 4608 前缀缓存命中）。边界一句话：**A3 steer＝turn 中；A2 followup＝turn 间（同进程自动）；A5 resume＝turn 间（跨进程手动）**。headless 单次 launch 的多 turn 是模型自主循环，外部无注入口 |

**注意**：web 与 sdk 两条通道都是**长驻进程**形态（daemon 得管生命周期）；headless 一次性形态没有任何外部注入口。
ACP（`dsh --profile acp`，Zed 的 Agent Client Protocol）源码与 SDK 同走 `followup`——turn 间粒度，JSON-RPC stdio。

---

## 3. B 段：插件开发面结论（全部真机跑通）

### 3.1 插件包的两种装法与一条铁律

| 装法 | 做法 | 实测 |
|---|---|---|
| 本地相对路径 | 插件文件放 patch 文件旁（锚定其目录），patch 条目 `- insert: [{name: ./probe-min/lib/index.js, config:…}]`；`--patch extra.yml` 运行时 overlay 同理 | ✅ B1：apply 执行、config 注入生效、假工具被模型调用 |
| pnpm 安装 | `dsh plugin --profile <p> add <npm 包\|本地路径>`（pnpm 10.33 透传，169ms，本地路径装成 `link:`） | ✅ B2：装完 warning「declares no dsh.bundle — plain dependency, not a profile layer」，须 insert 条目按包名引用才激活（实测激活） |

**insert 语法铁律**（首跑踩坑实录）：patch 条目**无 id ≠ 插入**（报 `id is required for non-insert patches`）；
正确形态是 `- insert: [<完整 entry>]`（无 id＝追加到根表；带 id＝塞进某 group 条目的 config 数组）。
`dsh.bundle` 声明（patch/icon/locale 元数据）是「可选 profile 层」的入场券——我们长期插件建议带上。

插件模块约定：ESM + 具名导出 `name/Config/inject/apply`（`Config` 用 schemastery；
loader 用自带解析上下文 import，bare specifier 指装机树——独立 `node` 直接 import 会解析失败，正常）。
工具 output schema 用 DSL 形态（**逐属性 `required:true`，顶层 `required` 数组不被支持**——第二个实测坑）。

### 3.2 插件能扩展哪些面（入口速查）

| 面 | 入口 | 备注 |
|---|---|---|
| 工具 | `ctx.tools.register(defineTool({name,description,parameters,output,execute,…}))` | ✅ 真机；MCP 工具亦落同一注册表（名 `mcp__<server>__<tool>`） |
| 工具管线 | waterfall：`tools/pre-execute`（allow/deny/cancel/**ask**）/`tools/execute`（around：超时重试）/`tools/post-execute`（改写结果）/`tools/ptc-dispatch-log` | 审批/熔断/度量的挂点 |
| Agent 生命周期 | `agent/created`、`agent/disposed`、`agent/status`、`agent/error`、`agent/assistant-stream`、`agent/inbox/claimed|inserted|discarded`、`agent/turn-stopping` | ✅ 三类真机触发 |
| 步/请求干预 | waterfall：`agent/pre-step`（**改写即将进入本步的消息**）、`agent/request`（换 LLM 调用配置）、`agent/request-error`（接管恢复） | `agent/pre-step` 即「turn 中改上下文」的插件级入口 |
| 会话事件 | `ctx.on("session/event", (session, event))`（全量日志事件流） | 收割侧可挂 |
| Agent 注册表 | `ctx.agents.create/get`——程序化造 agent 并 `followup`（webhook 插件即此模式）；对任意活 agent 调三原语 | 进程内注入通道 |
| LLM 路由 | `llm-pi-ai.config.providers.*`（apiKeyEnv/baseURL/api/models）+ `agent-default-model` | docs/31 §7 已证 |
| 凭据 | provider `apiKeyEnv`（role=credential-ref，永不进 dump） | 与 v1.4 env 通道对齐 |
| 提示词 | system-prompt 插件 `personaPrefix/personaSuffix`；agent-instructions `instructionFileCandidates` 等 | docs/31 §3.6 已证 |
| MCP | insert 条目挂 `@deepseek-ai/dsh-mcp-client`：stdio（`command/args/env/cwd`）或 streamable-http（`url/headers`）；一实例一 server；`failOnStartupError`/`reconnect` 可配 | ✅ B3：手写零依赖 stdio server，模型真实调用 `mcp__probe-mcp__probe_time` 并复述返回 |
| 配置注入 | patch 层 `!!js` 表达式可读 `process.env`（按单注入配置的官方通道） | docs/31 A2 已证 |
| 自定义投影 | `ctx.sessionProjections.register`（如 todos）——台账侧可投影 dsh 内部状态 | 源码面 |

### 3.3 程序化驱动速查（web RPC）

- 启动：`dsh --profile web --port <p> --no-open`；stdout 打 `http://127.0.0.1:<p>/?token=<进程令牌>`。
- 鉴权：`GET /?token=` → 303 + `Set-Cookie dsh-auth-<sha>`（HttpOnly，30 天，绑定 authority）；API 仅认 cookie。
- 调用：`POST /api/<service>/<method>`，`Content-Type: application/json`，信封
  `{type:"client-request", rpcId, method:"<service>/<method>", payload:{args:{request:{…}}}}`。
- 会话控制面：`session/create`（cwd+sessionId）、`session/prompt`（mode queue/steer）、`session/updateQueue`
  （edit/remove/steer）、`session/cancel`、`session/projections`（inbox 实时队列/tokenUsage/turnOutline——
  daemon 收割可直接用）、`session/follow`（流，走 `/api/remote.mux` WebSocket）。
- 端点命名铁律：**两段斜杠式**（`session/prompt`），点号式 404。

---

## 4. 对适配器/daemon 的建议（中途插话接线方案）

> 需求映射：同单其他 agent 的消息 → 注入给「活着」的 worker。判据＝Handle 存活 + 消息必达（durable）+
> 尽量不中断当前 turn。三个方案按推荐序：

**方案 A（推荐进端口演进）：web-宿主形态 + HTTP steer。** daemon 对 dsh 泳道改用
「一 worker 一长驻 `dsh --profile web`（或一宿主多会话，port 由 OS 分配）」的 launch 形态：
launch 时起进程、抓 token 行换 cookie、`session/create` 建 worker 会话、任务走 `session/prompt(mode:"queue")`；
插话走 `mode:"steer"`（turn 中、步粒度）；收割走 `session/projections`（tokenUsage/turnOutline 现成），
事件流走 `/api/remote.mux` WS 或 `session/follow`。**端口面**：ExecutorAdapter 加一个可选
`interrupt?(h: Handle, message: string, mode?: 'steer'|'queue'): Promise<void>`（capabilities 加
`mid_turn_inject: boolean`，dsh=true、claude/codex/kimi 按各自实探）；headless 一次性形态保留为
低开销默认（不适合插话的单子照旧）。**涉契约改动走批示**（docs/25 冻结面）。

**方案 B（最小改动）：SDK-宿主形态 + jsonrpc followup。** `dsh --profile sdk` 长驻，
daemon 持 stdio 双向流（我们已会用 Node 驱动，A2 脚本即客户端）：插话＝turn 粒度（当前 turn 完成即达，
大多数「队友留言」场景够用），且 `session.event` 通知天然是收割事件源。比 A 少一个 HTTP 面，
但拿不到 steer（步粒度）与 web 的现成控制面；stdio 双工对 daemon 的进程管理要求略高。

**方案 C（变通，不改端口）：探针插件自带注入通道。** 写一个 studio 插件（B1 已证 20 行起步），
在 headless 进程内开本地 socket/HTTP 微端点，收到外部消息后对 `ctx.agents` 里的活 agent 调
`steer/followup`——headless 一次性形态也能获得 turn 中插话。缺点：自造轮子（鉴权/生命周期/端口管理），
且 dsh 无官方契约背书；只在前两案不可行时兜底。

**配套纪律**：插话消息属「临时注入」非任务书变更——落台账事件（inject 事实）但不改 TaskBrief 指纹；
daemon 侧 throttle（同单消息合并防抖）与队列可视（`session/projections.inbox`）都有现成面。

---

## 5. 遗留

1. **turn 中打断的取消面**：`session/cancel`（web）与 agent `cancel(keepInbox)` 未真机实测（源码面清晰）；
   「插话打断当前 turn 重来」的产品语义（steer 不打断、cancel+重发才打断）留给适配器设计单。
2. **streamable-http MCP** 只证了 stdio 面；http 形态（url/headers）未起 server 实测（配置面同源）。
3. **web 宿主的多 worker 合宿**（一 web 进程多 session 的隔离面/资源面）未压测——方案 A 落地前补一轮。
4. **plugin-manager 的 UI 面**（settings-plugin-inventory）未探——长期插件分发（公司目录 provisioning 模板化
   进 profile patch）已有 B1/B2 两条装载路径，分发面 v0 不阻塞。
5. dsh 版本面 0.2.0-rc.2：三原语与 RPC 形态均无版本契约声明（serverInfo 0.0.1）——锁版本纪律下可接受，
   升版时插话面须回归（建议进 adapters 探针集：A2/A3 脚本改参数化即可复用）。

---

## 证据与副作用

- 证据目录：`/Volumes/BigDisk/probe-evidence/dsh-plugin/`（`INDEX.md` 索引 24 件：A 段 12、B 段 7、工件 5）
- 副作用自查：docker 基线逐名 diff 一致（taiga×9/matrix/youtrack 未碰）；dsh web 进程已杀；
  探针插件/pnpm link/sdk profile/overlay 全部清除；`~/.dsh/profiles/headless|web` 还原模板态
  （headless 保留 docs/31 §7 的 kimi 激活层——本单前置既有）。
- 本单未改 packages/ 任何代码；方案落地走 §4 + 契约批示流另派实现单。
