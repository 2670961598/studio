# 错误分类与供给级配额门控（task-157 / FIX-03；Kimi 总审 P0-03）

> 状态：**最小可验收切片**（制作人批「先做 3 张之一」）。不改契约枚举/事件词/`DecisionCode`，
> 不改 models.yaml / daemon.yaml，不改四要件与验收语义。纯逻辑落 core 子域
> `packages/core/src/supply/`（零 IO、时间入参）；daemon 只做接线。
> 前置阅读：`docs/quality/model-routing.md`（§3 失败分类、§4 冷却/半开、§6 note 形状）。

## 0. 背景、范围与不做

- 事故（`docs/sentinel-logs/GLM额度耗尽应急切换-2026-11-26.md`）：GLM 三模型同额度池，一源 429
  `code=1310「…限额将在 2026-11-27 14:24:57 重置」`后，同 provider 其他源仍被逐个派发再 429；
  派发失败不落事件 → 每轮镜像 rescan 重新候选、重跑绑定段、刷「派发失败」；16 次 CIRCUIT_BREAK
  自动开 8 张 bug 单。病根三处：① 错误只有字符串启发式分类，无「何时可重试」语义；② 冷却是
  **源级**，而额度是 **供给池级**（同 provider/account 共享）；③ reset 时间已在错误里，却没人用。
- 本单做三件事：**统一错误分类**（§1）、**供给池级配额门控 + 恢复单探针**（§2）、**审计/可观测**
  （§3）；测试见 §5。
- 不做（归 task-143/144）：订阅账本/实时用量探针、account 维度池键、池全量扫描、契约 error kind
  枚举、`blocked_quota` 事件词、公司级能力派单。池键本切片=provider（§2.1）。

## 1. 错误分类矩阵（core `supply/error-kind.ts`）

分类函数 `classifySupplyError(err, now, { tzOffsetMs? })` → `{ kind, retryability, retryable,
quotaWindow?, resetAt?, providerCode?, evidence }`。`evidence`：`status|code|message`（有正向证据）
或 `default`（无证据——路由面按既有缺省 `server` 冷却，收割面按 `quality` 归因，见 §1.2）。

### 1.1 派发/上游面

| 输入特征（按判定序） | ErrorKind | Retryability | router FailureClass | 处置 |
| --- | --- | --- | --- | --- |
| 网络码 ECONNREFUSED/ENOTFOUND/EAI_AGAIN/ECONNRESET/ETIMEDOUT…；`closed handle` 类 | network | retryable | network | 源指数退避+换源（现行为） |
| 缺凭据文案（`KIMI_API_KEY … not set`/`no-credential`/`API key missing`/`no token provided`——裸 `token` 仅在无 4xx 校验态时采信，带 4xx 状态的 `input token missing` 归 bad_request）；缺 adapter/未知 provider；地区限制（`unsupported_country`/not available in your region，含 403 地区） | config | fatal_config | **config（新增）** | 源冷却（general 档）+换源+告警；`retryable=false` |
| 408 / `timeout|timed out|ETIMEDOUT|exit=124` | timeout | retryable | timeout | 指数退避+换源 |
| 429 且 overloaded 证据（`[overloaded]`、`the server is overloaded`） | overload | retryable | server | server 档退避+换源 |
| 429 且 **窗口/reset 证据**：GLM `1310`（每周/每月）/`1308`（5h）、Kimi `weekly (7-day)`/`5-hour usage limit`、`GoUsageLimitError`、`usage limit`/`usage cap`/`额度`/`配额`/`exceeded_current_quota` | quota | **wait_reset** | quota | 源冷却+**池阻塞**（§2.2） |
| 429 无任何窗口/reset/限速证据（含裸 `{status:429}`、仅通用理由短语 `429 Too Many Requests`） | quota（window=unknown） | wait_reset | quota | 同上；blockedUntil=回退冷却 |
| 429 且限速证据（无窗口证据）：GLM `1302`、`rate limit`、`throttl`、`requests per second/minute/day`、`速率限制`/`频率限制` | rate_limit | retryable | rate_limit | 源冷却（Retry-After 优先）；**不入池**。HTTP 理由短语 `Too Many Requests` 是一切 429 的通用文案、不作限速证据（归上一行） |
| 401/403（非地区限制） | auth | fatal_config | auth | 源冷却+告警+换源（现行为）；`retryable=false` |
| 502/503/504/529 | overload | retryable | server | server 档退避+换源 |
| 其余 5xx | server | retryable | server | 同上 |
| 其余 4xx：安全拒答/内容审核 | refusal | terminal | refusal | 不换源不冷却（现行为） |
| 其余 4xx | bad_request | terminal | bad_request | 同上 |
| `parse|JSON` 文案 | parse | retryable | parse | 指数退避+换源 |
| 无证据 | （default） | — | server | 现行为（源冷却 60s 起） |

`retryable` 口径：`retryable=true` ⇔ Retryability=`retryable`（同请求原样可再派）；`wait_reset`
在 reset 前为 false（note 携 `resetAt`），`fatal_config`/`quality`/`terminal` 恒 false。

### 1.2 收割面（GATE_FAIL 归因；core `classifyHarvestFailure`）

| 输入 | ErrorKind | retryable |
| --- | --- | --- |
| detail 以 `WORKER_DEAD` 起（看门狗消亡面） | worker_dead | true |
| detail 以 `CONFIG_INVALID` 起 | config | false |
| `foldTerminalError` 有供给类正向证据（§1.1 任一行） | 该 kind | 按行 |
| 闸门 `exit=124(timeout)` | timeout | true |
| 其余（四要件缺：验收红/REPORT 缺/worker 跑完但没做完） | quality | false |

四要件判定、回滚、断路连击**一字不动**——本表只决定 note 尾段 `errorKind/retryable` 与路由回填的
冷却口径。

### 1.3 resetAt 解析（`parseQuotaResetAt`；quota/rate_limit 类使用——rate_limit 的 reset 只喂源冷却（Retry-After 同式），不入池）

优先级：① 文案绝对时间 `YYYY-MM-DD HH:mm[:ss]`（GLM「限额将在 … 重置」；**按 UTC+8 解析**，
`tzOffsetMs` 可注入——哨查日志与 API 重置时刻同为北京时间帧）② 文案相对时长
（`resets in 17m`/`try again in 20s`/`in 2 hours`）③ `Retry-After`（`err.retryAfterMs` 或秒数）
④ 都没有 → 无 resetAt（§2.2 回退）。**不采用**源配置声明 `sources[].quota.resetAt`：USD 账本
窗口≠API 配额窗口，无证据不延长阻塞，交探针按源冷却收敛（§2.4/§6）；如需引入走提案。
解析结果 ≤ now 视为无效（时钟漂移/文案陈旧）→ 走 ④（daemon 不注入 `tzOffsetMs`，恒缺省 UTC+8）。窗口词：`5-hour|5h|five_hour|1308`→
five_hour；`每周|weekly|7-day|1310`→week；`每月|monthly`→month；同时出现「每周/每月」（GLM 模板
文案）取 week——标签只作审计，门控以 resetAt 为准。

## 2. 供给级配额门控（core `supply/supply-quota.ts` + daemon `routing/quota-gate.ts`）

### 2.1 池与状态

- 池键 = `quotaPoolKeyOf(provider)`（provider 小写去空白）。account 维度不建模：note 携 `account=-`。
- 状态 `SupplyQuotaState = { pools: { [pool]: { windows: { [window]: { blockedUntil, resetAt?, sourceId,
  recordedAt, providerCode? } }, probe?: { ticket, claimedAt, leaseUntil } } } }`。
- 持久化：`daemon_kv` 键 `model-routing.quota`（`{version:1, pools}`；坏值保守重置为空=全开），
  与 `model-routing.state`（源级冷却）并存、各自序列化。

### 2.2 阻塞登记（`recordQuotaBlock`）

- 触发：任一**路由源**（DISPATCH 尾 `routing=<id>` 的在途单/launch）失败且分类为 quota。
  源级冷却照旧登记（`recordSourceFailure`；有 resetAt 时 `cooldownMs=min(maxMs, resetAt−now)`，
  与 Retry-After 同式），**另**登记池阻塞：`blockedUntil = resetAt ?? now + 源冷却Ms`（回退=现行为）。
- 观测位：launch 换源面=拍错误行 `派发失败 <t>：DISPATCH_FAIL：<首错>；换源不可用（ALL_SOURCES_UNAVAILABLE;
  tier=… 全部源不可用（冷却/禁用/额度耗尽）：<id>:cooldown(until=…)、<id>:quota-window(…)）`
  （现行为形状）＋`MODEL_ROUTING_FAILOVER`；收割面=GATE_FAIL＋`MODEL_ROUTING_FAILOVER`（§3）。
- 新阻塞清除该池探针认领；同池其他**未到期**窗口保留（多窗叠加时以最晚者为约束窗）。
- `quotaPoolVerdict(state, pool, ticket, now)` → `open | blocked | probe-other | probe-mine |
  probe-claimable`（有记录、全部窗口已到期=恢复期）。

### 2.3 决策级门控（state-diff；`quotaGateVerdict`）

- 位置：`decideWorkCandidate` 出 dispatch 后、**占泳道/入队前**。与 execute 的路由激活条件同源
  （`modelRouting`+`catalog` 在场、本档 sources 非空、`executorArmed || 绑定适配器名==='dsh'`；
  续跑计划按 `resumeDispatchFace` 取名；人位未定（无 assignee 且 autoAssign 无解）=不拦）；
  任一条不满足=不拦（交 execute 级兜底 §2.5）。
- 次序：门控在 `decideWorkCandidate` 出 dispatch 之后——泳道/人位 hold（`HOLD_LANE_BUSY`/
  `HOLD_PERSON_BUSY`）更前置；并发余量用尽时他单先撞这两码，配额 hold 仅在可派发时可见。
- 判定（本档 enabled 源）：任一源 `open`/`probe-mine` → 放行；否则全部 `blocked`/`probe-other` →
  **hold**：不占泳道、不跑绑定段、不入 dispatchQ、不烧 attempt、不 reserve 预算、不计断路连击；
  `probe-claimable` → 本单**认领探针**后放行（§2.4）。
- 观测：`decisions.push({ code:'HOLD_QUOTA_WAIT', actionType:'hold', quota:{…} })`——daemon 本地
  观测码（`TickDecisionEntry.code` 加宽为 `DecisionCode | 'HOLD_QUOTA_WAIT'`；core `DecisionCode`
  不动，台账无新事件词）。每阻塞期落一条 ESCALATE（§3），日志行按签名去重（§3）。
- 候选再评估：hold 不写 `seenKeys` → 每轮镜像 rescan（`mirrorRescanEveryTicks`）重新候选；
  窗口到期后 ≤ 一轮 rescan 内恢复。

### 2.4 恢复期单探针

- 窗口到期（`now ≥ blockedUntil`）池进恢复期；**首个**到达的候选单 `claimQuotaProbe`
  （`probe={ticket, claimedAt, leaseUntil=now+60min}`，持久化）后放行；同拍/后续候选见
  `probe-other` → hold（可换他池的源不受影响）。
- 认领池=本档 enabled 源里首个可认领池（`claimPool`；非全池扫描）。
- 放开：探针单收割成功（四要件齐）且**池不在阻塞期** → `resolveQuotaOpen` 删池记录=全开；池仍在
  阻塞期（阻塞登记晚于本单派发）则不动——在途旧单成功≠恢复证据。探针失败且 quota → 重新阻塞
  （新 resetAt/回退；`MODEL_ROUTING_FAILOVER` 去重键含 resetAt，探针再败另留一条）；探针失败非 quota
  → 释放认领，池停留恢复期（下一位候选再认领）。
- 认领释放：派发未成（`executeDispatch` !ok）→ 释放；派发成功但选中源不在被认领池 → 释放；探针单被
  看门狗咬合（kill 面/消亡面 GATE_FAIL）→ 释放（续租面不动）；
  租约到期自动可认领（worker 长跑/回收面/崩溃重启的兜底——弱保证至多「每租约窗一探针」）。

### 2.5 execute 级兜底（`selectModelSource`）

`SelectInput` 新增 `quota?`/`probeTicket?`：`blocked` 源跳过并记因
`<id>:quota-window(window=…;resetAt=…;until=…)`，`probe-other` 跳过记因
`<id>:quota-probe-pending(ticket=…)`；`probe-mine`/`probe-claimable` 放行。决策级未拦到的面
（直调 executeDispatch、门控镜像条件不成立）在此 fail-closed 为 `ALL_SOURCES_UNAVAILABLE`
可读原因（现行为形状，note 尾追加 §3 段）。探针派发 DISPATCH note 尾携
`;routing-quota-probe=1;routing-quota-pool=<provider>`。
- **派发即认领**（`quotaProbeNote`，选中路由源后 launch 前）：选中源所在池在恢复期且本单未持认领
  （决策级门控未开、或决策级认领了他池而 execute 按选择序落到此池）→ 经同一 core 转移
  `claimQuotaProbe` 认领（非 `probe-claimable`=不变，不冒认他单在途）；选中源不在认领池 →
  释放他池认领。**单探针不变量不依赖决策级镜像面**；认领点唯一在 core 状态转移。

### 2.6 兼容与退化（§4）

- 无 `modelRouting`/本档无 sources/路由面未开 → 门控与分类接线零行为。
- 无 resetAt：源冷却数值与现状逐字一致（`quota 15m/8d`、源 `cooldown.baseMs` 覆盖、`server 60s`），
  池阻塞期=该冷却；到期单探针。`rate_limit` 不入池。
- 现有 `MODEL_ROUTING_FAILOVER`/`MODEL_ROUTING_BUDGET_HOLD`/`CIRCUIT_BREAK` note 形状不动，新增
  字段只**追加在末尾**；panel 正则锚不受影响。

## 3. 审计/可观测（不新增事件词）

| 面 | 形状（追加段均在末尾） |
| --- | --- |
| ESCALATE（每池每窗口每 resetAt 每 tier 一条） | `MODEL_ROUTING_QUOTA_HOLD;tier=<t>;provider=<p>;account=-;quotaWindow=<w>[;resetAt=<iso>];blockedUntil=<iso>[;probeTicket=<t>];sources=<id,…>;ticket=<首见单>（同池窗口未到：决策级 hold 不占泳道不烧 attempt；恢复期单探针——task-157）`；去重键 `quota-hold|<pool>|<w>|<resetAt>|<tier>` |
| ESCALATE `MODEL_ROUTING_FAILOVER`（launch 换源/harvest 回填） | 尾追加 `;errorKind=<k>;retryable=<b>[;quotaWindow=<w>;resetAt=<iso>][;providerCode=<c>];provider=<p>;account=-` |
| GATE_FAIL（收割面） | 尾追加 `;errorKind=<k>;retryable=<b>[;quotaWindow;resetAt][;provider][;account=-]`（§1.2；看门狗消亡面同款 `errorKind=worker_dead`） |
| DISPATCH（探针派发） | 尾追加 `;routing-quota-probe=1;routing-quota-pool=<p>` |
| hold 日志行（serve 每拍；每单按签名 `provider|window|resetAt|blockedUntil|probeTicket` 去重） | `[serve] tick#N hold：<ticket> code=HOLD_QUOTA_WAIT tier=<t> provider=<p> quotaWindow=<w> resetAt=<iso|-> blockedUntil=<iso>[ probe=<t>] sources=<id,…>（hold 无台账事件；此行=唯一逐拍观测面，签名去重）` |
| healthz `routing.quota[]`（加法列；引擎钟） | `{ provider, state: blocked|recovering|probe, window, blockedUntil, resetAt?, probeTicket?, sources[] }`——blocked=约束窗未到期；probe=恢复期且有活租约认领；recovering=恢复期无认领。只列有记录的池，provider 升序 |

## 4. 与既有机制的边界

- **断路器**：hold 不入账；首次 quota 失败=一次 GATE_FAIL（现行为）；探针失败才再入一击，窗口内
  不再累计——CIRCUIT_BREAK 风暴的触发条件（每 rescan 一击）被结构性移除。
- **预算 gate**：hold 在 reserve 之前，零预留；探针派发照常过预算闸。
- **task-141 跨执行器换源/同 dispatch 换源**：不受影响——换源重选 `selectRouted` 同样跳过阻塞池，
  只会换到**他池**源。
- **half-open**（源级冷却到期）与恢复期探针（池级）叠加：两者都要求「先试一个」。

## 5. 测试

- core（落 `packages/core/test/v2/supply/`——V2 新套件唯一入口 `test/v2`，plan/04 §1.9.2；非 v2
  路径会被 `old-test-ledger` 判为台账外旧测试件而红）：
  `error-kind.test.ts`（分类矩阵：401/403、429×三窗口（含 GLM 1310/1308、Kimi
  weekly/5-hour、相对/绝对 reset、UTC+8 假设）、1302 限速、502/529/overloaded、缺凭据/缺 adapter/
  地区、timeout、网络、400/拒答、无证据；收割面 worker_dead/quality/timeout/CONFIG_INVALID）；
  `supply-quota.test.ts`（阻塞登记、verdict 五态、认领/租约/释放、探针成功放开、
  多窗叠加、序列化坏值保守重置、TTL 修剪）。
- daemon：`test/v2/routing/quota-gate.test.ts`（引擎级 fake adapter，固定时钟 10 例：① 同池他源不再被派发、
  换源只换他池、FAILOVER 尾段、kv/healthz；② reset 前零无效重试（HOLD_QUOTA_WAIT 不占泳道/不烧
  attempt/不落 GATE_FAIL/不刷屏）＋跨单共享；③ 恢复期单探针（2 槽泳道＋并发 5 才可见 probe-other
  hold，见 §2.3 次序）与成功放开；④ 探针再败按新 reset 重阻塞；⑤ 无 reset 退化为现冷却；
  ⑥ 收割面 429（GATE_FAIL/FAILOVER 尾段）；⑦ 1302/overloaded 不入池；⑧ 派发即认领单元；
  ⑨ 重启续接（同台账新引擎照 hold、零新 launch；坏 kv 保守重置=全开照常派发）；
  ⑩ 看门狗消亡面咬合探针单（GATE_FAIL 尾段 `errorKind=worker_dead`；咬合即释放认领、下拍再认领→
  成功→池开））；既有 `model-routing.test.ts`/
  `execute-failover.test.ts`/`breaker-half-open.test.ts` 等回归不变。
- 禁 skip/only/todo/retry；固定时钟。

## 6. 风险与未做（如实）

- 绝对时间按 UTC+8 解析（GLM 文案北京时间帧）；他 provider 若用 UTC 文案需注入 `tzOffsetMs`。
- 决策级门控若与 execute 路由激活条件出现漂移（人位未定/选择链拒派/直调 executeDispatch）→ 退化为
  execute 级 fail-closed（现行为形状：每轮 rescan 一次 `ALL_SOURCES_UNAVAILABLE` 拍错误行，不占泳道）；
  单探针不变量由「派发即认领」（§2.5）兜住，不随漂移失效。
- 恢复期若可认领池的源**全部**仍在源级冷却（他类失败遗留）→ 每拍认领→派发失败→释放（2 次 kv 写/拍，
  =现行为噪声）；冷却到期即成探针。
- 无 reset 的 quota 失败：池阻塞期=源冷却，到期放一个探针；探针再败则源冷却按 failures 指数退避
  （15m→30m→…→maxMs），池阻塞随之拉长——每冷却窗至多一探针 attempt，可接受但不为零。
- 探针单 60min 租约内未收割时其他单可再认领（弱保证）；account 维度/实时探针归 task-143/144。
- config 类错误仍为源级冷却（未池化）；同 provider 多源缺凭据会各失败一次后进入冷却。
- 429 `[overloaded]` 由 quota 改判 overload/server（§1.1，有意变更：冷却由 15m 档改 60s 起退避、不入池）。
- 尾段覆盖面=§1.2 两处（收割 `failHarvest`、看门狗消亡面）；孤儿回退（recovery/orphan-recovery）与
  合并面（merge/merge-run）的 GATE_FAIL 属回退/合并载体，**未加**尾段（不在本单范围，后续单）。
- 阻塞期 ESCALATE 去重表（routingWarnings）不持久化：重启后每个阻塞期再留一条（非每拍，可接受）。
- config 类按文案启发式判定（`CONFIG_PATTERNS`）：token 仅认带凭据限定词的（auth/access/api/
  bearer/refresh token）；裸 `token … missing` 仅在无 4xx 校验态时采信——带 4xx 状态的
  `input token missing` 归 bad_request（现行为）。config 类仍为源级冷却（未池化）。
