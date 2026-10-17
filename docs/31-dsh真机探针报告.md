# 31 · dsh 真机探针报告（0.2.0-rc.2 装机实测）

> 2026-10-18 ｜ 探针工兵出品，制作人定调「以实际情况为主，不臆想、不只看文档；实测满足需求后再正式开发进工程」。
> 方法：全部结论来自本机实测（`/opt/homebrew/bin/dsh`，0.2.0-rc.2，→ `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh`）与**装机自带的插件源码**（dsh 以明文 JS 发行，源码即真机事实）。原始输出全部落盘 `/tmp/dsh-probe2/`（索引见其 `INDEX.md`），本文每条事实标注证据文件。
> 对照物：`docs/27-探针与真机核实清单.md` A1-A6 拟稿、`packages/adapters/src/dsh.ts`、`packages/adapters/src/streams.ts`。**本单未改任何 packages/ 代码**——修正走 §5 清单，过审后另派实现单。
> 凭证缺口声明：本机 env / macOS keychain / ~/.dsh 三处均无 DEEPSEEK_API_KEY（证据 `B0-env-scan.txt`），**B 段真成功流（原案 7/8/9）未执行**；事件形态学降级取证自装机源码（`dsh-headless/lib/json-stream-*.js` 等），待凭证到位后以 P-01 真流复核回填 golden fixture。

---

## 0. 摘要（一句话版）

dsh 真机的 `--json` 事件面、AGENTS.md 通道、续跑约束与我们的适配器假设**大面积不合**：顶层事件是 `session/status/thinking/text/tool_call/tool_result/final/error` 八类（`step_end` 等是 `status` 事件的 `phase` 值，不是顶层类型）；`turn_end` 无 `completed` 布尔，判定字段是 `reason.kind`；usage 字段是 camelCase（`inputTokens`），我们三种拼法全不命中；AGENTS.md 通道是原生文件发现 + profile patch 配置键，**不存在任何 `DSH_AGENTS_MD`/`DSH_APPEND_SYSTEM_PROMPT_FILE` 环境变量**；`--session-id` 续跑真实存在且可用，但要求 **cwd 逐字节一致**；当前 `dsh.ts` 的 launch **没有传任务串**（真机任务=位置参数或 stdin），真机上每一次 launch 都会以 usage error 退出——适配器需要一轮系统性修正（§5），修正量集中在 `streams.ts` 的 dsh 解析器与 `dsh.ts` 的 launch/agentsMdEnv。

### 三处最颠覆假设的发现

1. **事件形态三层全错**（A3/A6 连锁）：我们假设 `{"type":"step_end",...}`/`{"type":"turn_end","completed":true}`/snake_case usage；真机是 `{"type":"status","phase":"step_end"}` 包装、`{"type":"status","phase":"turn_end","reason":{"kind":"completed"}}`、camelCase `usage.inputTokens`。按现 `parseDsh`，真机流**所有结构化事件全部降级为 log 原文**——`isCompleted()` 在真机上永远返回 false（turn_end 识别不出）→ 收割判定整体失效。
2. **launch 没传任务串，真机必失败**：任务串是**位置参数**（多词空格连接）或 `-` 读 stdin；`dsh.ts` spawn 的是 `dsh --profile headless --json` 后缀全无 + `stdin:'ignore'`——真机行为是 stdin 读到空 → `"a task is required"` → 顶层 `error` 事件 + exit 1（源码 `B7-headless-startup.js:76-80`、`B7-headless-index.js:300-301`）。fake CLI 全绿掩盖了这一点。
3. **AGENTS.md 通道 env 映射整个证伪 + 续跑真实存在**：`DSH_AGENTS_MD`/`DSH_APPEND_SYSTEM_PROMPT_FILE` 在全配置面（594KB schema + 全量 dump）零命中——真实通道是 (a) 原生 cwd→项目根发现 `AGENTS.md`>`CLAUDE.md`（+`.local` 覆盖），(b) 机器全局 `~/.dsh/AGENTS.md`，(c) profile patch 的 `instructionFileCandidates` 配置键，(d) system-prompt 插件 `personaPrefix/personaSuffix` 内联字符串（**无文件追加通道**）。同时 `--session-id` 续跑真实可用（capabilities.session_resume:false 与真机面落差坐实），但有 cwd 一致等硬约束。

---

## 1. 探针环境与版本面（A5 顺带核实）

| 项 | 实测 | 证据 |
|---|---|---|
| 二进制 | `/opt/homebrew/bin/dsh` → `../lib/node_modules/@deepseek-ai/dsh/lib/bin.js`（npm 全局装，非镜像渠道待查） | `ls -la`（本机） |
| 版本输出 | `0.2.0-rc.2`，无 `v` 前缀，单行，exit=0 | `A5-version-output.txt` |
| detect() 兼容性 | `dsh.ts` 正则 `/v?(\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?)/` 命中 `0.2.0-rc.2`；与 `LOCKED_VERSION='0.2.0-rc.2'` 精确相等 → ok:true、无 gap | 对照 `dsh.ts:154-163` |
| 本体旗标面 | `--profile/--from-default-profile/--patch/--dump-config(-schema/-default)`；`--dump-*` **必须带 `--profile`**（裸跑报 `error: --profile <name> is required`，exit=1——宰相已探得缺该细节） | `A0-dsh-help.txt`、`A2-schema.stderr` 首跑记录 |

**结论（A5）**：证实。detect() 对真机版本输出解析正确，锁版本比对通过。

---

## 2. A 段事实表（无凭证面，探针 1-6）

### A1. profile 树（`--dump-config --profile headless`，证据 `A1-dump-config-headless.json`）

约 80 个 `@deepseek-ai/dsh-*` 插件（cordis 插件架构，patch 层叠合）。与我们直接相关的关键面：

| 关注点 | 实测事实 | 证据位 |
|---|---|---|
| 模型配置 | `agent-default-model` 插件：`provider: deepseek-official, model: deepseek-flash`。**headless app 级无 `--model` 旗标**（`A6-app-help.txt` 只有 `--json/--session-id/-h`）——改模型只能走 profile patch 或 providers 扩展 | A1 L51-55、A6 |
| 凭证注入位 | 两处：`llm-deepseek`（`dsh-llm-deepseek-api-key`）插件 config `apiKeyEnv`（role=credential-ref，默认 `DEEPSEEK_API_KEY`）；`credentials`（`dsh-credentials-local`）管持久层。llm providers 通用扩展点（config14）：每 provider `apiKeyEnv/baseURL/api(openai-completions|openai-responses|anthropic-messages)/models[]` | schema config14/config56、`B0-llm-deepseek-api-key.js` |
| AGENTS.md 面 | `agent-instructions` 插件（config：`maxBytes:65536`、`maxSourceBytes:1MB`）；`skill`/`skill-filesystem`/`commands` 另立 | A1 L179-182 |
| 预算帽 | **无任何 budget/cost/spend/quota 配置键**（594KB schema 全文检索仅 maxTokens/maxRounds——前者是逐请求上限，后者在 disabled 的 ralph 插件里） | schema 全文检索 |
| 沙箱/审批 | `sandbox-policy`：`mode: process.env.DSH_PERMISSION_MODE ?? 'workspace-write'`、`workspaceRoot: process.cwd()`；`approval`：非 danger-full-access 时 `ask` | A1 L127-147 |
| 遥测 | `session-telemetry-otel`：`mode: process.env.DSH_TELEMETRY_MODE || 'FEEDBACK_ONLY'`，默认外发 `https://dsh-otel-collector.deepseeksvc.com/v1/logs`；合法值仅 `FEEDBACK_ONLY|DISABLED`（插件源码枚举） | A1 L108-124、otel 源码 |
| 会话持久化 | `session-persistence-jsonl`：root=`dshHome('sessions')`；`session-query-sqlite`（:memory:）+ projcache 存 `storages/session_projcache` | A1 L78-96 |
| MCP 面 | 栈内有 `mcp-resources`；**`dsh-mcp-client`（真正连 MCP server 的插件）不在 headless 默认栈**，其 config 支持 stdio（`command/args/env/cwd`）与 streamable-http（`url/headers`）两 transport——studio-tools 挂载入口 = cordis.patch.yml 增 mcp-client 条目（见 §5-9） | A1 L346-347、mcp-client 源码 Config |

### A2. 配置 schema（证据 `A2-dump-config-schema.json`，594KB）

- 结构：顶层 `items`（entry 数组）+ 75 个 `$defs`；entry 形态 `{id, name, disabled?, config?, inject?}`；patch 形态含 id 定向覆盖/disable/insert。
- dump 树里允许 `!!js` 表达式（如 `ctx.get('profileContext')`、`process.env.DSH_PERMISSION_MODE`）——**patch 层可读进程 env**，这是「按单注入配置」的官方通道。
- 环境变量全集（dump+schema 交叉检索）：仅 `DSH_PERMISSION_MODE / DSH_TOOLS_MODE / DSH_TELEMETRY_MODE / DSH_TELEMETRY_OTLP_URL` 四个。**无 DSH_AGENTS_MD、无 DSH_APPEND_SYSTEM_PROMPT_FILE、无任何 prompt/instruction 相关 env**（A1 证伪的机器证据）。
- `--dump-default-config` 与全量 dump **逐字节相同**（`A2c-diff` 为空）：user 层（cordis.patch.yml）为空 `[]`，本机 headless profile 是纯模板态，无历史漂移。

### A3. profile 实体结构（证据 `A3-profile-files.txt`、`A3-dsh-home-tree.txt`）

```
~/.dsh/profiles/headless/
  cordis.yml          # 根 entry 表：[]（树全由 bundle patch 叠成，勿手改）
  cordis.patch.yml    # 用户 patch 层：[]（我们的注入落点）
  package.json        # dsh.profile.bundles: [@deepseek-ai/dsh-base, @deepseek-ai/dsh-headless]
  pnpm-workspace.yaml # nodeLinker: hoisted（plugin add 的装法）
```

层级顺序：base bundle → headless bundle patch → cordis.patch.yml → `--patch` 临时覆盖（可重复）。**改插件栈/模型/MCP 的机制**：编辑 cordis.patch.yml 或运行时 `--patch extra.yml`，或 `dsh plugin --profile headless add <pkg>` 装 pnpm 插件包。

### A4. 无凭证真失败行为（证据 `A4-nocred-run.ndjson/.stderr`）——第一份真失败 golden

`dsh --profile headless --json "say hi"`（无凭证）：

- **exit=1**；stdout 是完整 NDJSON（6 行）：

```json
{"type":"session","sessionId":"session-0ec30278-155a-46f7-bdcf-2ba8f08c2081","cwd":"/private/tmp/dsh-probe2"}
{"type":"status","phase":"turn_start","turn":1}
{"type":"status","phase":"step_start","turn":1,"step":1}
{"type":"status","phase":"step_end","turn":1,"step":1}
{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"error","error":{"message":"llm-deepseek: no API key for provider route \"deepseek-official\"; store DEEPSEEK_API_KEY …","code":"MISSING_CREDENTIAL"}}}
{"type":"final","text":""}
```

- stderr 单行人类可读：`dsh: MISSING_CREDENTIAL: llm-deepseek: …`。
- **失败面也是结构化流**：凭证失败不是崩、不是空 stdout——照走 session→turn→step→turn_end(reason.kind=error)→final("")。收割器分类面：`turn_end.reason.error.code`（如 `MISSING_CREDENTIAL`）+ exit 1 + final 空。
- 副作用：失败运行**照样持久化会话**（`~/.dsh/sessions/<cwd 消毒串>/<sessionId>/session.v4.jsonl.zstd` + lock + projcache）。daemon 侧长期要考虑 ~/.dsh/sessions 的回收（v0 可不管，如实记录）。

### A5. 未知 session-id（证据 `A5-bad-session.ndjson/.stderr`）

`--session-id nonexistent-probe-id`：**exit=1，stdout 完全为空（0 事件）**，stderr 单行 `dsh: session "nonexistent-probe-id" does not exist; omit --session-id to start a new Session`。失败发生在 session 创建之前——收割器不得假设「有流才有失败」。

### A6. 插件面（证据 `A6-plugin-help*.txt`）

- `dsh plugin --help`（无 profile）：exit=1 `required option '--profile <name>'`。
- `dsh plugin --profile headless --help`：**原样打出 pnpm 10.33.0 帮助**——`dsh plugin` 就是 `pnpm` 透传（cwd=profile 目录）。装包：`dsh plugin --profile headless add <package>`。
- headless app 帮助（`A6-app-help.txt`）全文坐实：任务串=位置参数（`[task...]`，多词空格连接，`-` 读 stdin）；`--json` NDJSON；`--session-id <id>` adopt 持久会话，未知 id 报错。

---

## 3. B 段：缺凭证记录 + 装机代码级形态学

**凭证盘点（`B0-env-scan.txt` + keychain 查询）**：进程 env 无 `DEEPSEEK_API_KEY`（也无任何 dsh/anthropic/openai/kimi 变量）；macOS keychain 无 dsh/deepseek 条目；`~/.dsh` 无 `.credentials.yaml`。→ **缺凭证，B7/B8/B9 真成功流未跑**。缺口：一枚 `DEEPSEEK_API_KEY` 真值（或往 `~/.dsh/.credentials.yaml` 写一条，0600）。

降级取证——以下结论全部来自**装机发行的同版源码**（`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-headless/lib/*`，副本在 `/tmp/dsh-probe2/B7-*.js`），比文档强、比臆测强，但仍需真流复核：

### 3.1 事件全集（`json-stream` 源码逐行核）

顶层 `type` 八类：

| type | 形态 | 归一建议（对照 StreamEvent） |
|---|---|---|
| `session` | `{sessionId, cwd}`（**首事件**，流开始前写） | session_id 证据（Handle 应收存 dsh 侧 `session-<uuid>`） |
| `status` | `phase` ∈ `turn_start{turn}` / `step_start{turn,step}` / `step_end{turn,step,usage?}` / `turn_end{turn,reason}` | step_start/step_end/turn_end 三映射 |
| `thinking` | `{text}`（reasoning 块） | log（或弃——**8KB/条截断帽**下非交付物） |
| `text` | `{text}`（**已提交**的 assistant 文本块） | log（isCompleted 的 hasOutput 应认它） |
| `tool_call` | `{callId, tool, input}`（input=解析后 JSON 或原文） | log/扩展 |
| `tool_result` | `{callId, status:"completed"\|"error", result}` | log/扩展 |
| `final` | `{text}`（**终答，不受截断帽**；汇总=最后一个非空 assistant 文本） | log（或专用） |
| `error` | `{message}`（**预运行失败**：usage error/未知 session/缺服务；`--json` 下 commander 错误也走这条） | turn_end(completed:false)+error 的等价物，需映射 |

**截断契约**：每字符串 8KB、每行 32KB（超限降标量、再降 `{type,truncated}`，带 `truncated:true`）——唯独 `final` 不设帽。收割器不得假设单行有界。

### 3.2 usage 字段名（step_end 专属）

`{inputTokens, outputTokens, totalTokens?, cacheReadTokens?, cacheWriteTokens?, reasoningTokens?}`——camelCase；且 **step_end 的 usage 只在「该 step 所有 attempt 都报了 usage」才出现**（不完整则整条省略，宁缺毋假）。`turn_end` **不带 usage**（reason 里无账）——我们 streams.ts「turn_end usage 兜底」的假设无源可依。

### 3.3 完成判定与退出码（`index.js` runner 源码）

- `turn_end.reason.kind` 枚举（agent-loop 源码）：`completed` / `error`（带 `error:{message,code}`）/ `blocked` / `aborted` / `max-tokens`。
- **exit=0 当且仅当 `reason.kind==='completed'`**；其余（含 error）一律 exit 1；预运行失败 exit 1。
- final 文本 = 本次 run 区间内**最后一个非空** assistant 文本块聚合（可能为空串——如 A4）。

### 3.4 resume（`--session-id`）的真实约束（`resolveAgent/assertAdoptable` 源码）

1. 未知 id → 立即失败（stdout 0 事件，§A5）。
2. **cwd 必须与会话记录的 cwd 完全一致**（`header.cwd !== cwd` → error）——续跑必须在同一 workspace 路径起进程。
3. 不能 adopt subagent/fork 会话、不能 adopt 跑在 agent preset 下的会话。
4. 需要 sessionPersistence 服务（headless 栈有，`session-persistence-jsonl`）。
5. 会话 id 形态 `session-<uuid>`（brandString 包装）；**续跑会话跨进程持久在 `~/.dsh/sessions/<cwd>/<id>/`**（zstd 压缩日志）。

### 3.5 凭证优先级（`credentials-local` + `llm-deepseek-api-key` 源码头注）

```
进程 env（DEEPSEEK_API_KEY=… dsh ← 显式意图，最高）
  > $DSH_HOME/.credentials.yaml（Models 页写的托管层，0600 强制，chmod 600）
  > <invocation cwd>/.env（只读回退）
  > $DSH_HOME/.env（只读回退）
```

- 认证头是 **`x-api-key`**（非 Bearer）。
- 凭据值标 `volatile` + role `credential-ref`——**永不进 dump/config 树**（与「密钥永不入库」同构，好消息）。
- 我们 v1.4 的 env 通道（TaskBrief.credentials → launch env）与最高优先级层严丝合缝，**通道选对了**。

### 3.6 AGENTS.md 通道与身份注入（`agent-instructions`/`system-prompt` 源码）

- 发现算法：从 cwd **向上**找 project root（默认 markers=`[".git"]`），root→cwd 逐目录扫候选 `["AGENTS.md","CLAUDE.md"]`（同目录 AGENTS 优先），每目录再叠 `["AGENTS.local.md","CLAUDE.local.md"]`；另读**机器全局 `~/.dsh/AGENTS.md`**（用户层）。
- 全部可通过 patch 配置键覆盖：`instructionFileCandidates`/`localInstructionFileCandidates`/`projectRootMarkers`/`maxBytes`(64KB)。
- system-prompt 插件：`personaPrefix`（默认 "You are a coding agent powered by the {{model}} model."）+ `personaSuffix`（"Your working directory is {{cwd}}."）+ `includeHarnessIdentity/includeRuntimeContext` 开关——**内联字符串，非文件**；无 append-file 通道。

---

## 4. C 段：与 docs/27 A1-A6 / dsh.ts / streams.ts 假设逐条对照

| # | 我们的假设（出处） | 真机事实 | 判定 |
|---|---|---|---|
| A1 | env 变量 `DSH_AGENTS_MD` / `DSH_APPEND_SYSTEM_PROMPT_FILE`（dsh.ts `agentsMdEnv()`，自拟） | 两变量在全配置面零命中；真实通道=原生发现（launch cwd 向上）+ `~/.dsh/AGENTS.md` + patch `instructionFileCandidates` + `personaPrefix/Suffix` 内联 | **证伪** |
| A2 | `agents_md:'native'`＝原生读 workspace 根 AGENTS.md（dsh.ts capabilities） | 原生发现坐实且更强：AGENTS.md>CLAUDE.md 同序 + .local 覆盖 + ~/.dsh 全局层；launch cwd=task.workspace 即命中，无需 env | **证实（且保守了）** |
| A3 | isCompleted「输出非空」≈存在非空 log（dsh.ts 头注拟稿） | 正文事件是 `text`/`final` 型（现解析器降级成 JSON 原文 log——非空仍成立，但语义脏）；终态是 `turn_end.reason.kind==='completed'`，非 `completed` 布尔——**现 isCompleted 在真机恒 false** | **证伪（修正项 P0）** |
| A4 | 「dsh 被 kill 后 exit=0 且 final 空」（17-§6 已知坑，fake 无法模拟） | 未测（缺凭证无法起真任务再 kill）——源码侧 exit=0 仅 reason.kind=completed，kill 面存疑维持开口，**待凭证后 P-08 复现** | **未证（维持原坑注）** |
| A5 | detect() 版本正则与锁版本比对（dsh.ts） | `0.2.0-rc.2` 原样输出，正则命中、精确相等 | **证实** |
| A6 | `session_resume:false`、launch 无 resume 分支（dsh.ts capabilities） | `--session-id` 真实存在、可 adopt 持久会话；约束：cwd 一致/非 subagent/未知 id 0 事件即败 | **证伪（能力升级候选）** |

streams.ts dsh 解析器细目对照（全部实测/源码级）：

| 假设 | 真机 | 判定 |
|---|---|---|
| 顶层 `type:step_start/step_end/turn_end/log` | 顶层八类；step/turn 状态在 `type:status+phase`；**无顶层 log 型**（正文=text/final） | 证伪 |
| `step` 字段是 string | 是 **number**（`asString` 直接失配→降级 log） | 证伪 |
| `turn_end.completed:boolean` | `turn_end.reason.kind`（枚举五种）+ `reason.error.{message,code}` | 证伪 |
| usage `input_tokens/output_tokens/cached_tokens`（或 input/output/cached） | `inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens/reasoningTokens/totalTokens`——**四种拼法零命中** | 证伪 |
| turn_end 可带 usage（兜底账） | turn_end 恒无 usage；usage 只在 step_end 且「完整才出现」 | 证伪 |
| （未假设） | 顶层 `error` 事件（预运行失败也走 NDJSON）；行级截断 8KB/32KB+`truncated:true`；final 无帽；`session` 首事件带 sessionId/cwd | 新增事实 |

---

## 5. 适配器修正清单（不改代码，供宰相过审后派实现单）

> 优先级 P0=不改真机必坏；P1=账目/判定正确性；P2=能力与策略面。

1. **[P0] launch 传任务串**（dsh.ts）：`DSH_DEFAULT_CMD` 后追加任务文本为**单个位置参数**（commander 自动 join，传一个完整串即可），或改 `stdin:'pipe'` 写任务后 end（`-` 模式）。任务文本来源（TaskBrief 现只有 briefPath）：读文件内容传递，或契约面补 prompt 字段——**涉契约改动走批示**。注意任务串以 `-` 开头会被当 stdin 旗标——需 `--` 分隔或前置校验。
2. **[P0] parseDsh 事件形态重写**（streams.ts）：八类顶层 type 映射（status+phase 三态、text/final→log、error→completed:false 的 turn_end 等价映射或契约扩展、thinking→log）；step/turn 按 number 解析；completed 判定 `reason.kind==='completed'`；error 信息从 `reason.error` 提取（MISSING_CREDENTIAL 等 code 进 turn_end.error）。契约测试同步重建 golden（A4 流即第一份真失败 fixture，`/tmp/dsh-probe2/A4-nocred-run.ndjson`）。
3. **[P0] toUsage 字段名**（streams.ts）：补 `inputTokens/outputTokens/cacheReadTokens`（→cached）映射；`cacheWriteTokens/reasoningTokens/totalTokens` 记录但契约 TokenCounts 无位——弃或走批示。resultStats 的 turn_end 兜底分支删除（真机无此账）。
4. **[P1] isCompleted**（dsh.ts）：hasOutput 判定改认 `text`/`final` 型非空（归一后仍是 log，但须在解析正确的前提下）；completed 判定同 P0-2。
5. **[P1] agentsMdEnv 重写**（dsh.ts）：native=不注入（证实）；user_level 通道改「写 `~/.dsh/AGENTS.md`」或 profile patch `instructionFileCandidates`（**机器全局层，多公司共机有串染风险——建议走 per-company profile patch**）；append_system_prompt 无文件通道——近义面是 `personaPrefix/personaSuffix`（内联串，受 patch 注入）或干脆并入 workspace AGENTS.md 落点。L0-L5 装配侧（packages/prompt）需要按此重排通道策略。
6. **[P1] session id 收存**（dsh.ts）：Handle 侧从流首 `session` 事件收 dsh 的 `session-<uuid>`（现自造 UUID 与 dsh 侧脱钩，续跑/对账两不便）；rawLines 证据面已够。
7. **[P2] capabilities**（dsh.ts）：`session_resume:false→true` 候选（真机可用；启用时 launch 补 `--session-id` 分支 + **cwd 一致硬约束**落调度纪律）；`budget_cap:false` 维持（真无帽，框架断路兜底）；`agents_md:'native'` 维持。
8. **[P2] daemon 起 dsh 的 env 纪律**：注入 `DSH_TELEMETRY_MODE=DISABLED`（默认 FEEDBACK_ONLY 外发 deepseeksvc.com——出站内容管制面）；`DSH_PERMISSION_MODE` 按单面拍板（默认 workspace-write+approval ask；headless 下 approval 交互行为**未证**，凭证后补测）；`DEEPSEEK_API_KEY` 走既有 v1.4 credentials env 通道（优先级最高层，已对齐）。
9. **[P2] studio-tools MCP 挂载入口**：非 pnpm 面——cordis.patch.yml 增 `dsh-mcp-client` 条目（stdio：`command/args/env/cwd`；或 streamable-http：`url/headers`）。模板化进公司目录 provisioning 时按 profile patch 生成。
10. **[P2] ~/.dsh/sessions 回收**：每 run（含失败）落 zstd 日志+projcache；v0 不处理，台账侧知悉，v0.6 配额面再议。

---

## 6. 遗留与待办

1. **凭证到位后的复核单**（P-01/P-04/P-05/P-07/P-08 按 docs/27 原案）：真成功流 golden 回填（B7-B9 原案）、kill 面复现（A4 坑）、AGENTS.md 通道矩阵实测（P-07：真机复述标记串）、approval 交互行为、截断行为实测复核。
2. §5-1 的任务文本来源若涉 contract（TaskBrief 加 prompt 字段）——走 docs/25 契约变更批示流。
3. dsh 安装源核实（docs/27 §4.1 遗留#2）：本机为 npm 全局路径，镜像源渠道未在本单范围。
4. 事件八类中 `thinking/tool_call/tool_result` 是否值得进 contract StreamEvent（现为 log 透传）——收割粒度需求方（core）拍板。

> 原始证据目录 `/tmp/dsh-probe2/` 保留供审查（含 INDEX.md 索引与副作用记录）。
