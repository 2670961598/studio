# agy 适配器（Antigravity CLI / Gemini 源）——登记不启用（team task-140；task-147 落仓前置已落）

> **状态：登记不启用。** 适配器、工厂表、ENU-88 值集已落；`registerBuiltins(createRegistry())` 缺省仍恰四家
> （dsh/claude/codex/kimi，default=dsh）。task-147（2026-11-27）补齐落仓前置：ENU-88 主表登记（v2/09 §二；提案
> `sentinel-logs/提案-ENU88-执行器枚举新增agy-2026-11-27.md`）、契约冻结件重冻结（§九）、env 三道闸加固（§四）、
> daemon `tierExecutors` / `primaryExecutor` 校验改引契约值集（§七）。两单**均未改** models.yaml / daemon.yaml /
> agent.yaml 任何生产文件，未新增依赖，未发起任何真实 agy 调用。
>
> 依据：docs/18-§一（executor 四原语＋detect 三态）、docs/17-§6（收割口径：终态事件＋非空输出）、
> docs/25-§二/§3.1（TaskBrief.credentials 短命按单凭据；usage 归一）、docs/43-附录A-1（env 白名单）、
> docs/20-§十五（BC-S2 尺寸阈「先拆后加」）、docs/v2/07 §一（选择链：选择不是授权）。
>
> **证据边界**：本页「行为」一栏全部由 fake agy 夹具测试背书（§八）；「真 CLI 面」只有 task-140 事实单的
> 实测样本与对 v1.5.18 安装包的**只读静态核对**——两者分层列在 §二，未证面见 §九。

## 一、目的与定位

把 agy 接成第五家 executor：与四家同构的四原语（launch / stream / resultStats / kill）＋ detect 三态，
使其可经 agent.yaml 登记、被 resolver 解析、过选择链闸；**启用与否归装配面**，登记本身零行为漂移。

代码地图（分片文件不进 `index.ts`，kimi-wire.ts 同例）：

| 文件 | 职责 |
| --- | --- |
| `packages/adapters/src/agy.ts` | 适配器本体：伴生状态、launch、单对象终稿消费、watchdog、kill 升级链、终态合成 |
| `packages/adapters/src/agy-argv.ts` | 纯函数：缺省命令、版本地板、env 三道闸（宿主封闭允许集／注入通道封闭枚举／高危拒收终检；合成入口 `buildAgyEnv`）、argv 组装 |
| `packages/adapters/src/agy-json.ts` | 纯函数：终稿解析、失败分类、脱敏、stderr `AGY_ERROR` 行摘要 |
| `packages/adapters/src/patches.ts` | agent.yaml `patches` 家族专属解析：`agyOptionsFromPatches`；`dshModelFromPatches` 自 agentconfig.ts **原样迁出**（引用路径经 re-export 保持不变） |
| `packages/adapters/src/agentconfig.ts` | `BUILTIN_FACTORIES.agy`、resolver 可达；`overrides` 点名 agy 结构拒收 |
| `packages/contract/src/records/asset.ts`、`ports/executor.ts` | ENU-88 值集与 `ExecutorFamily` 加 `agy` |
| `packages/adapters/test/fake-cli/fake-agy.mjs` | 假 agy：按场景回放 stdout/stderr/退出码/挂起，落 `agy-fake-report.json` 直证 argv/env |

能力声明（配置镜像须逐字段一致，漂移即 `agentconfig/cap-drift`）：

| 能力 | 值 | 取舍 |
| --- | --- | --- |
| `budget_cap` | false | CLI 无预算帽旗标；预算管控走框架断路 |
| `cancel_turn` | false | 无单轮取消原语，只能整进程 kill |
| `session_resume` | false | `--conversation`/`--continue` 存在但续跑链路未实测——按不支持；`task.resume` 传入即抛（fail-closed） |
| `agents_md` | `append_system_prompt` | 唯一已证通道：AGENTS.md 全文拼进 `-p`；`native` 不注入（未证）；`user_level` 无 env 面 → `CONFIG_INVALID/agy/agents-md-channel-unsupported` |
| `cost_native` | false | 终稿有 tokens 无成本 → cost 恒 `{usd:0}`（订阅制 0 边际成本，Kimi 同口径），价目折算待批 |

## 二、事实源分层

| 层 | 内容 |
| --- | --- |
| **实测**（task-140 真机探针，v1.5.18） | headless 正常收尾在 stdout 打一份 JSON：成功 `{status:"SUCCESS", response, conversation_id, duration_seconds, num_turns, usage}`，失败 `{status:"ERROR", error}`；样本 usage：input 12297 / output 121 / thinking 119 / cache_read 0 / total 12418（thinking 已含在 output 内）；`--model "Gemini 4 Neon (High)"` 可用；`--mode auto` 当前账号不可用（warning 后回退 default）；无代理即 auth 失败；错误样本见 §五 |
| **静态核对**（v1.5.18 安装包字符串表，未调用） | headless 缺省超时由 5min 改为无上限，除非给 `--print-timeout`；到点自退＝退出码 3 ＋ stderr `AGY_ERROR` 行（点名被终止任务）＋ `[agy] print timeout after …` 行；结果带可选 `finished_reason`（`print_timeout` / `interrupted` / `error`）；`--mode` 在 headless 不受支持；二进制引用 `GEMINI_API_KEY` 路由与 `ALL_PROXY`/`all_proxy` |
| **未证** | 见 §九 探钢单（`--version` 输出形态、`--print-timeout` 单位、残稿 JSON 同屏组合、env 白名单充分性、API-key 路由、`--add-dir` 幂等、续跑链路、额度数值） |

## 三、鉴权 · 代理 · 模型 · 额度

- **鉴权**：凭据走本机 OAuth（安装后 `agy` 交互登录一次，落在 HOME 下本机文件），**无已证的 env 凭据面**。
  detect 只探版本不发网（鉴权失败在首跑以 `errorCode: 'AUTH'` 明报）。宿主的 `GEMINI_API_KEY` / `GOOGLE_API_KEY`
  不透传（允许集外；API-key 路由未证）。凭据键不交叉且比对**大小写不敏感**（task-147）：`GEMINI_` / `GOOGLE_` /
  `ANTIGRAVITY_`、`ANTHROPIC` / `OPENAI` / `CLAUDE` / `CODEX`、`DEEPSEEK_` / `GLM_` / `KIMI_` / `DSH_` 前缀键与
  凭据形后缀键（`*_API_KEY` / `*TOKEN` / `*SECRET` / `*PASSWORD`…）经注入通道出现或混入合并 env →
  `CONFIG_INVALID/agy/env-key-rejected`（只报键名，值不入账）。
- **代理（硬依赖）**：Google 域本机直连被拦，**detect 与 launch 都带代理**。来源有二：daemon 宿主 env 的
  `HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY`/`NO_PROXY`（大小写两形，经白名单放行）或构造选项 `proxyEnv` 钉扎。
  代理**出口地区**还须受支持（实测非美出口报 `location not supported`）。
- **模型**：`--model <名>` 透传自然语言串（实测如 `"Gemini 4 Neon (High)"`），未配则走 CLI 缺省；配置名回填
  `ResultStats.model`（终稿无 model 字段——不是 CLI 上报值）。`agy-<tier>` 名可解析，但 models.yaml 未登记
  agy 源，档位**不映射**模型。
- **额度**：订阅请求额度（实测口径约 1500 次/日，**待实测确认**）；额度/限速文案 → `errorCode: 'EXTERNAL_RATE_LIMIT'`。

## 四、argv / env 设计

```
agy -p '<任务书全文>' '\n\n--- AGENTS.md ---\n<AGENTS.md 全文>'   # append 通道时拼接
    --output-format json --dangerously-skip-permissions
    [--model '<名>'] [--add-dir <task.workspace>] [--print-timeout <秒>]
```

- 位置参数序固定：`-p` 任务串 → `--output-format json` → `--dangerously-skip-permissions` → `--model` →
  `--add-dir` → `--print-timeout`。**永不下发 `--mode`**（`--mode auto` 实测不可用；headless 亦报不支持）。
- `cwd = task.workspace`，`stdin: ignore`，`stdout`/`stderr` 走管道，`reject: false`（退出码只记录不抛），
  `killDescendants: true`（kill 信号直达整组），`forceKillAfterDelay: false`（升级链自持，契约 graceMs 才是宽限）。
- **env = 宿主封闭允许集 ∪ proxyEnv ∪ task.credentials**（唯一合成入口 `buildAgyEnv`），且 `extendEnv: false`
  （否则 execa 缺省并入宿主全量 env）。**三道闸**（task-147 加固；语义＝封闭允许集＋封闭枚举＋高危拒收，
  **与 dsh 凭据键域闸不同型**——多出合并后终检、比对大小写不敏感）：
  - ① 宿主允许集（`filterAgyEnv`：键 lower-case 后比对，原样收录）：`PATH` `HOME` `LANG` `TZ` `TMPDIR` `LC_*` ＋
    代理键（`HTTPS_PROXY` `HTTP_PROXY` `ALL_PROXY` `NO_PROXY` 及小写镜像）；其余宿主键一概不透传。理由：`agy` 是
    bash 包装 → Go 二进制，用户目录/临时目录只读 HOME/TMPDIR，OAuth 凭据在 HOME 下。
  - ② 注入通道封闭枚举（`assertAgyInjectKeys`）：`proxyEnv` 只收代理键八个字面形态（`Https_Proxy` 这类混合
    大小写写了不生效的形态同拒），`task.credentials`（v1.4 短命按单凭据）只收 `STUDIO_TOOLS_WKEY`；枚举外键
    `CONFIG_INVALID/agy/env-key-rejected`、子进程不起，值不记录不打印。`HOME` / `PATH` / `NODE_OPTIONS` / `DYLD_*` /
    `SHELL` / 各家凭据键经通道出现即拒——**不设「经 proxyEnv 补键」旁门**。
  - ③ 高危拒收终检（`assertAgyEnvSafety(env, 宿主基准)`：合并后兜底，fail-closed）：键 lower-case 后命中拒收表
    （加载器/解释器注入键、Gemini/Google 凭据键、他家执行体凭据/配置键、凭据形后缀）即拒；`HOME` / `PATH` 逐字节
    核对仍是宿主原值（漏传基准按空基准判——HOME/PATH 在场即拒）。verifier 12 例探针（含大小写变体）三道闸全拒。
  - ⚠ 子进程是全权（`--dangerously-skip-permissions`）：任务书 credentials 注入即对模型工具可见——agy 缺省无
    env 凭据面，**生产不应向 agy 任务注入 credentials**。
- 构造选项（`AgyAdapterOptions`）：`model`（非空单行）、`printTimeoutSec`（正整数）、`proxyEnv`（形状坏＝非对象/
  数组/值非字符串 → `CONFIG_INVALID/agy/option-invalid`，报文只带键名与类型不带值；非代理键 → 构造期即
  `agy/env-key-rejected`，不起子进程）。agent.yaml
  `patches` 只认 `model` 与 `print-timeout-sec`，形状坏即 `CONFIG_INVALID/agentconfig/agy-patch-shape`
  （配置写了没生效比报错更难查）。

## 五、终稿解析与错误分类

非流式：`stream()` 全量缓冲 stdout 至 EOF、等子进程落定后一次性 yield（终局前消费方看不到事件——形态固有，
不伪造 step 事件）。`stream()` 一会话只许消费一次。

| 终稿 | 归一事件 | `completed` | 备注 |
| --- | --- | --- | --- |
| `status=SUCCESS`＋response 非空＋无 `finished_reason` | `log(response)` ＋ `turn_end(completed, usage)` | true | `conversation_id` → `Handle.executorSessionId`（对账面，续跑未接线）；`num_turns` → `ResultStats.turns` |
| `finished_reason` 在场（残稿） | `log` ＋ `turn_end(completed:false)` | false | **不计完成**；CLI 上报的 usage 照记（真账） |
| `status=ERROR` | `log("agy ERROR(kind): …")` ＋ `turn_end(error, errorCode?, usage?)` | false | 分类见下表；并入 stderr `AGY_ERROR` 行摘要 |
| stdout 空而 stderr 有 `AGY_ERROR` 行 | 按结构化行分类 | false | CLI 未产终稿但报了结构化错 |
| 坏 JSON / 形状坏 | `log` ＋ `turn_end(completed:false)` | false | 非零退出 → `进程退出码 N（…；stderr: <脱敏片段>）`；退出码 0 → `stdout 终稿不可解析（…）` |
| 被杀（kill） | 无事件 | — | aborted 口径，四家同构；tokens 零值不编造 |

失败分类（**实测样本归纳，非保证面**；匹配次序 region → eligibility → auth → quota → network → timeout → other，
未知文本落 other 不猜）。`errorCode` 只用 `EXECUTOR_ERROR_CODES` 冻结词表，词表外无码、文本承载：

| kind | 判据（正则摘要） | `errorCode` | 实测样本 / 处置提示 |
| --- | --- | --- | --- |
| region | location/region/country not supported | — | `location not supported`——换受支持地区的代理出口 |
| eligibility | eligib / entitlement / verify your account | — | `Eligibility check failed: Your current account is not eligible for Antigravity…`——账号订阅/验证态；复现属上游 entitlement 问题 |
| auth | authenticat / unauthorized / 401 / log-in / oauth | `AUTH` | `authentication failed or timed out`——本机 agy 登录一次；仍败查代理可达 |
| quota | usage limit / quota / rate limit / 429 | `EXTERNAL_RATE_LIMIT` | 额度/限速 |
| network | dial tcp / connection refused·reset / no such host / proxy / i/o timeout / tls·x509 / unavailable / 502–504 | — | 查代理 |
| timeout | timed out / timeout / deadline | — | 上游超时或 `--print-timeout` 到点 |
| other | 其余 | — | 未分类样本，原文脱敏后保留 |

脱敏：错误文本与诊断片段进事件前过 `sanitizeAgyText`——Bearer / JWT / `AIza` / `ya29.` / `sk-`·`rk-`·`pk-` 键 /
JSON token 值 / URL 口令 / 长 hex·base64 一律打码，剥 ANSI、折叠空白、截断；`AGY_ERROR` 行只取前 8 个标量字段
拼 `key=value`，键名属凭据面（token/secret/key/authorization/credential/cookie）值一律 `[REDACTED]`。

## 六、超时：`--print-timeout` 与 watchdog

- CLI 侧 headless 缺省**无上限**（静态核对）→ 建议钉 `print-timeout-sec`。适配器下发 `--print-timeout <秒>`，
  并自带兜底 watchdog：`printTimeoutSec + 4s` 仍存活 → SIGTERM 整组 → 2s → SIGKILL 整组；触发即 timeout 面
  （`turn_end(completed:false)`，零账）。CLI 若按 `--print-timeout` 自退（残稿面），watchdog 不干预。
- **`--print-timeout` 的单位按「整数秒」处理是未证假设**；`0`/负数/缺省不下发。真机探针未做（§九）。
- `kill(h, graceMs)`：SIGTERM 整组 → `graceMs` → SIGKILL 整组；幂等；已退出的会话无可杀（不标 killed，
  终态事件如实保留）。`budget_cap=false`：单任务预算靠框架断路，不靠 CLI。

## 七、启用示例与回退

启用分三步，缺一不可；任一步缺失即回退（见每步末）。

1. **agent.yaml 登记**（生产文件，本单未动）：

   ```yaml
   executors:
     dsh: { default: true }
     agy:
       patches:
         model: "Gemini 4 Neon (High)"
         print-timeout-sec: 900
   ```

   `registerBuiltins` 的 `overrides` **不能**点名 agy（`CONFIG_INVALID/agentconfig/agy-override-ignored`）——
   agy 只认 agent.yaml 显式登记。未登记 → 注册表无 agy，`resolve('agy')` 报 `executor/unknown`，default 仍是 dsh。
2. **代理就位**：daemon 宿主 env 带受支持地区的代理（§三）。缺代理 → 首跑 `AUTH` 面。
3. **派发放行**：agy 非主绑定，直连须有选择链登记——按单/按岗 `registerSelection`（`source: ticket|position`）；
   无登记 → `dispatch/selection-unregistered`（NEG-RUN-05）。daemon.yaml `tierExecutors` / `primaryExecutor` 的校验
   自 task-147 起改引契约 `EXECUTOR_VALUES`——`agy` 在**解析层**是合法值；档位面只在注册表有 agy 时才选它
   （未登记回退现 `<family>-<tier>` 逻辑，零漂移），`primaryExecutor: agy` 属启用动作（本页未做）。

回退：从 agent.yaml 删去 `agy` 段即回到四家缺省（代码零改动；重载/重启 daemon 后生效）；在途 agy 任务按既有
kill/超时面收口，未收终稿不记完成。凭据/代理值不进 agent.yaml（patches 无代理键——见 §九 ⑩）。

## 八、测试面与门禁

全部走 fake agy 夹具（`--fake-agy-scenario <场景文件>`；场景=`stdout/stderr/exit/hang/ignoreTerm/version`），
夹具落 `agy-fake-report.json`（argv、cwd、env 键名、代理值）供直证；**不 skip / only / todo / retry**。

| 文件 | 覆盖 |
| --- | --- |
| `packages/adapters/test/v2/agy-adapter.test.ts` | 成功面归一；argv 全量直证（含「永不 `--mode`」）；env 白名单正反断言＋宿主密钥值不入任何事件；credentials 封闭枚举键透传与枚举外键拒收；七类失败分类与残稿面；watchdog 与自退；kill 升级链；detect 三态；ENOENT 面；选项形状闸；patches → argv；AGENTS_MD 三通道；stream 单消费 |
| `packages/adapters/test/v2/agy-env.test.ts` | env 三道闸纯函数直证（task-147）：允许集收录/不透传；两条注入通道的封闭枚举（verifier 12 例探针逐例＋大小写变体＋拒收表逐条至少一例纯前缀/纯后缀键——规则逐条变异即有用例红）；合并后终检（HOME/PATH 宿主原值核对、漏传基准 fail-closed）；报文只带键名不带值；适配器面构造期 `proxyEnv` 键闸与形状闸（非对象/数组/值非字符串）、launch 注入非法键 spawn 前拒收无报告落盘 |
| `packages/adapters/test/v2/agy-json.test.ts` | 分类正则（实测样本、优先次序、脱敏）、`sanitizeAgyText`、`AGY_ERROR` 摘要、`parseAgyJson` 全分支 |
| `packages/adapters/test/v2/agy-registry.test.ts` | 零行为漂移（恰四家）、overrides 拒收、resolver 可达、wireRegistry 登记、cap-drift、seatbelt 拒收、patches 形状闸、ENU-88 与选择链 |
| `apps/daemon/test/v2/serve/tier-executors.test.ts`、`primary-executor.test.ts` | daemon.yaml 两键校验以契约 `EXECUTOR_VALUES` 为唯一源（逐个合法值可解析、非法值/大小写变体拒启、报文列出值集） |

门禁命令：`bun run typecheck`、`bun run typecheck:v2`、adapters 包两套 vitest（v2 配置＋包级独立套）、
`node scripts/guards/boundaries.mjs`、`node scripts/verify/v0-doc-check.mjs`、`node scripts/scan-repo-secrets.mjs --json`。
逐次退出码随施工报告记录，本页不固化易变的计数。

## 九、已知边界 · 缺口 · 探钢单

**缺口（① ② ④ 已由 task-147 落仓前置闭合；③ 留档）**

1. ~~docs/v2/09 的 ENU-88 行仍是四家终稿~~ → **已登记**（task-147 提案流）：ENU-88 值集 `dsh｜claude｜codex｜kimi｜agy`，
   行内注明「登记不启用，启用与档位模型接线另单」；§九 修订记录第 16 条。
2. ~~`apps/daemon/src/assembly/serve/config.ts` 的 `tierExecutors` / `primaryExecutor` 校验硬编码四家~~ → **已改引契约**
   `EXECUTOR_VALUES`（`@studio-next/contract/records`）：本文件不再手写枚举；`primaryExecutor` 报文动态列出值集
   （自称 ENU-88 现在属实）。可解析≠已启用：启用仍归 agent.yaml 登记与装配批示（§七）。
3. models.yaml 未登记 agy 源：`agy-<tier>` 可解析但无档位模型；成本恒 0 待价目裁决。
4. ~~contract 冻结工件漂移~~ → **已重冻结**（task-147，提案批后经唯一写路径 `contract:check --write`）：
   `records/asset.schema.json` 两处执行器枚举含 `"agy"`，`index.json` 该件 bytes 17440→17494、sha256 `730a1225…`→
   `ae231de7…`（generatedAt / sourceCommit 随写）；与批前仓外预演差异逐字节一致（仅 generatedAt 时点）。
   `bun run contract:check` exit 0。`index.sourceCommit`＝重冻结时的 HEAD（落地提交的父提交，与既往工件同约定）。

**探钢单（真机一次性验证；Gemini 在施工机受代理出口地区限制而不可用，故本单全程 fake 夹具）**

| # | 未证面 | 当前处置 |
| --- | --- | --- |
| ① | `--version` 输出形态 | 取首个点分数字串；解析不到 → `agy-version-unparsed`（不静默放行） |
| ② | `--print-timeout` 单位/格式、`0` 语义 | 按正整数秒下发；非正整数不下发 |
| ③ | print 超时的残稿 JSON 形态（`finished_reason` 与 stdout/stderr 的同屏组合） | 「在场即采信」，不依赖组合假设 |
| ④ | env 白名单真机充分性 | 不够用时改 `filterAgyEnv` 允许集（代码面，带测试）；`proxyEnv` 自 task-147 起只收代理键，无补键旁门 |
| ⑤ | `GEMINI_API_KEY` 路由 | 不透传宿主值；未启用 |
| ⑥ | `--add-dir` 与 cwd 同目录是否幂等 | 两项都下发 |
| ⑦ | `--conversation` / `--continue` 续跑链路 | `session_resume=false` |
| ⑧ | 额度数值与 quota 文案样本 | 约 1500 次/日待实测；分类靠正则 |
| ⑨ | eligibility / region 的稳定处置 | 只给提示，不自动重试 |
| ⑩ | 代理钉扎的配置面（patches 是否收 `proxy-env`） | 未开放——代理 URL 可内嵌口令，待密钥政策裁决 |
| ⑪ | `--mode plan` 只读模式、seatbelt 端子（sandbox-exec 包装） | 永不下发 `--mode`；显式放宽 → `agentconfig/seatbelt-unenforceable` |
| ⑫ | `user_level` AGENTS.md 通道的 env 面 | `CONFIG_INVALID`，不静默降级 |
