# 模型多源路由（task-51 MVP；提案 task-48 方案 A）

> 状态：**设计 + 核心切片已落**（models.yaml `sources[]` 解析/归一、优先级/预算/冷却/half-open
> 纯逻辑、状态持久化序列化、单测）。task-135 收尾批 1 已落：quota 池化打分、
> `allowBudgetDowngrade` 配置面、同 dispatch 内一次换源、热切即时补种 price snapshot（§9）。
> 不新增契约/schema/事件词；不引外部依赖。

## 1. 配置（models.yaml）

旧单源格式严格兼容（行为=现状）：`tiers.<t>.provider/model/price`。多源：

```yaml
tiers:
  high:
    sources:
      - id: glm-zcode                 # 同档唯一
        provider: glm
        model: GLM-5.3
        priority: 10                  # 越小越优先；缺省按书写序
        price: {inputPerM: 1.1111, outputPerM: 3.8889, cacheReadPerM: 0.2778}
        # task-135 quota 池化：kind=monthly|rolling|five_hour|unbounded；remainingUsd=申报剩余
        #（可为负=超用申报；缺省回退 limitUsd）；resetAt 到期（rolling）重置回 limitUsd；weight=同
        # priority 组内打分权重（缺省 1）。limitUsd:0 且无 remainingUsd=仅登记不参与（严格兼容）。
        quota: {kind: monthly, limitUsd: 500, remainingUsd: 120.5, resetAt: 1799000000000, weight: 2}
        cooldown: {baseMs: 60000, maxMs: 28800000, circuitAfter: 3}
        enabled: true
      - id: go-kimi
        provider: opencode-go
        model: kimi-k3.1-pro
        priority: 20
        price: {inputPerM: 2, outputPerM: 10, cacheReadPerM: 0.2, cacheCreationPerM: 2}
    # 注意：同档 sources[] 与旧三键不得混写（CONFIG_INVALID）
  mid: {provider: glm, model: GLM-5.3, price: {...}}      # 单源档原样
  low: {provider: glm, model: GLM-5.3-Flash, price: {...}}
roles: {main_worker: mid, verifier: high}
```

- 解析：`parseModelsYaml` 校验后归一 `ModelsConfig.sources?[tier]`；旧消费面（overlay/目录）取首源派生
  `tiers[t].provider/model/price`；`modelSourcesOf(models,tier)` 统一返回源列表（旧格式→`id=default,priority=0`）。
- 指纹/热切：sources 全量进入配置内容（实现切片需把 sources 纳入 fingerprint；已设计，未改本切片）。
- `enabled=false` 源不参与选择；单源/单 enabled=退化为现状。

## 2. 选择算法

1. 取该 tier 的 sources，过滤 `enabled=false`；按 `priority` 升序分组，**组内按 quota 池化打分**
   （score=有效剩余额度×weight，降序——task-135）；组间/并列以 `id` 稳定排序。
   - quota 缺省/不配 → 全员 0 分 → 组内退回 `id` 稳定序=**现状字节级一致**（严格兼容）；
   - quota 参与且有效剩余 ≤0（含负数超用申报）→ 跳过该源并记因
     `<id>:quota-exhausted(remaining=$…)`；全部耗尽并入 `ALL_SOURCES_UNAVAILABLE` 可读 fail-closed；
   - 有效剩余：`remainingUsd` 优先（缺省回退 `limitUsd`>0）；`resetAt` 已到（rolling）→ 视为重置回
     `limitUsd`；`kind: unbounded` 或 `limitUsd:0` 且无 `remainingUsd`（仅登记）→ 不参与打分也从不停用。
2. 过滤冷却未到期；到期源可作为 **half-open** 候选尝试一次。
3. **预算预检**（在 dispatch 前）：
   - 任务剩余预算 = `TaskBrief.budgetCap`（或 jobs `budget_cap`）× 已用/预留折叠；
   - 公司当日剩余 = 公司预算日闭口径（现有 cost/budget 目录）剩余；
   - 用**候选源价格**估算本次成本；超任一帽→`BUDGET_EXCEEDED` **HOLD/ESCALATE**，
     **不静默跳到更便宜源，也不擅自降档**；只有显式 `allowBudgetDowngrade=true`（daemon.yaml，
     task-135 接配置；缺省 false）才继续后续源，且**后续源也全超帽时收尾仍判 `BUDGET_EXCEEDED`**
     （全源超帽=HOLD，§5；混合原因——冷却/额度耗尽+超帽——仍 `ALL_SOURCES_UNAVAILABLE` 不冒认）。
4. 选中源后：`DISPATCH` note 携 `routing=<id>`、`routing-price=…`（只读审计；同 dispatch 换源时另携
   `routing-fallbackFrom=<id>`）；实际价格归属该源。
5. 无可用/预算不足/全失败：fail-closed 可读原因；不无限重试。

## 3. 失败分类与降级

| 类 | 处理 |
| --- | --- |
| 429 / quota / allowance exhausted | 冷却当前源（优先 `Retry-After`/reset；缺省 15m、上限 8d），同一次派发换下一源（未发首段前） |
| 5xx | 指数退避（base 1m，×2，max 10m），换源 |
| timeout / network | 指数退避（base 60s，×2，max 8h；源 cooldown 可覆盖），换源 |
| 401/403 | 冷却 + 告警（配置/密钥问题不静默当可用），换源前留痕 |
| 400 / 请求畸形 / 安全拒答 | **不换源**（换源也坏）；fail-closed/交上层 |
| parse/流中断 | 换源（冷却当前源，下一 attempt/重试选下一源；不自动重跑同一源） |
| 全部失败 | `ALL_SOURCES_UNAVAILABLE` 可读错误 + ESCALATE/DAILY_ALARM（去重） |

在途 worker 不换源；只有新 attempt/新派发重新选择。`400/拒答` 不消耗冷却。

## 4. 冷却/半开/持久化

- 每源状态：`consecutiveFailures / cooldownUntil / lastFailureClass / lastFailureAt / lastSuccessAt / halfOpen`。
- 冷却缺省（可按 source.cooldown 覆盖）：**429/quota base 15m / cap 8d**、**5xx base 1m / cap 10m**、**其余可换源类（timeout/network/auth/parse）base 60s / cap 8h**；
  429 有 Retry-After/reset 优先；base×2^(n-1) 到 cap；连续失败触发 circuit open。
- half-open：冷却到期下一请求尝试一次；成功清零，失败继续指数冷却。
- 持久化：`daemon_kv` 键 `model-routing.state.<tier>`（JSON version=1）；坏值保守重置为空状态，不崩；
  重启不清健康状态（MVP 可保守重置）。
- 选择/状态纯函数位于 `apps/daemon/src/engine/routing/router.ts`，零 IO。

## 5. 预算联动（重点）

- 任务级：`TaskBrief.budgetCap`/jobs budget_cap 与已预留折叠后的剩余；估算=源价格 ×（任务书字符→tokens，
  与 budget-gate 同源系数）；超帽 HOLD。
- 公司级：日闭/cost_guard 剩余参与；超帽 HOLD/ESCALATE。
- 默认 **不升贵源**（第一个可用源超预算即 HOLD；不因为第一源超限就去选更贵/更便宜源）；
  `allowBudgetDowngrade` 显式开启才允许降档，且验收口径必须注明。
  - **配置面已接（task-135）**：daemon.yaml `allowBudgetDowngrade: true|false`（布尔校验，非布尔启动拒）；
    缺省不配=false=现状 HOLD 不降档。链路：daemon.yaml → `parseDaemonConfig` → `ServeConfig` →
    `buildServeEngineConfig` → `EngineConfig.allowBudgetDowngrade` → execute 选源预算预检。
    true 且全源超帽 → 仍 HOLD：router 在该 tier 全部源**均因预算被跳过**时收尾返回
    `BUDGET_EXCEEDED`（首源口径 source/estimated；非 `ALL_SOURCES_UNAVAILABLE`），execute 既有
    F4 据此落 `MODEL_ROUTING_BUDGET_HOLD` note（注明 allowBudgetDowngrade=true 全源超帽；
    按 ticket+source 去重）——task-135 收尾修复（此前 router 误归 `ALL_SOURCES_UNAVAILABLE`，
    HOLD note 不可达=死分支）。
- 价格：`work_records.model=source.provider/model`（实际源）；`price_snapshot` 按源登记；日闭 delta≈0，
  混合源日需注明各源占比。

## 6. 审计/可观测

- 复用既有事件词：DISPATCH note `routing=<id>;routing-price=…[;routing-fallbackFrom=<id>][;routing-skipped=…]`；
  源休息/全失败/launch 换源→ESCALATE/DAILY_ALARM（`MODEL_ROUTING_FAILOVER`/`MODEL_ROUTING_BUDGET_HOLD`）；
  不新增事件名。
- healthz/面板只读：每 tier 的源列表（priority/enabled/cooldownUntil/lastFailureClass/lastSuccessAt）；
  不扩 schema（从 routing state + models config 读）。
- 热切：models.yaml 重载原子替换 sources/fingerprint；在途 worker 不换源，下一 spawn/attempt 使用新列表。

## 7. 回退

- sources 只配一个/全部 `enabled:false`→ 选择退化为现状单源（或 fail-closed，可查）。
- `modelRouting.enabled=false`（设计开关）→ 只用第一源，不降级/不冷却。
- 不改契约/schema/事件词/四要件；失败不阻断收割/验收主链。

## 8. 验证清单（实现单）

- 优先级选择/预算超帽 HOLD（任务+公司）/allowBudgetDowngrade 显式降档；
- 429 冷却→下一源、冷却跳过、half-open 成功恢复/失败再冷却；
- 5xx/超时/网络/解析降级；400/拒答不换源；全失败 ALL_SOURCES_UNAVAILABLE+HOLD；
- 单源退化；热切原子；daemon_kv 重启恢复/坏值重置；
- 价格归属 work_records/price snapshot；日闭 COST_RECON；
- 本地 daemon E2E：两源 429→第二源成功、耗尽切换、全失败可读；gate/CLOSE 不回归；typecheck/定向/verify:v2/无 skip。

## 9. 实现状态（task-56 dispatch 接线；task-66 返工修订 2026-11-17；task-135 收尾批 1）

- F1（task-66）：per-source `--patch` / session-id 等附加选项统一插在 `--json` **之前**（默认 cmd 含 --json 时不再尾插）；
- F2：execute 在 launch 前捕获 dsh 的 overlay/model，launch 成功/失败 finally 清回（argv 在 spawn 快照，在途不串）；
- F3：预算 remaining 用引擎预算折叠 `cap − settled − reserved`（issue/person/company scope）；allowBudgetDowngrade **已接配置**（task-135：daemon.yaml 布尔键，缺省 false=现状 HOLD 不降档，链路见 §5）；
- F4：预算预检拒绝先落 `ESCALATE` note `MODEL_ROUTING_BUDGET_HOLD;…`（tier/cap/remaining/estimated/source），再 fail-closed，不新增事件词；**按 ticket+source 去重**（同票同源一次 HOLD，连续 tick 重试不刷屏）。含 allowBudgetDowngrade=true 全源超帽（router 收尾判 `BUDGET_EXCEEDED`，本口径可达——task-135 收尾修复）。


已落：
- dispatch 选源 → per-source overlay（DshAdapter launch 尾插 `--patch`，在途 argv 快照）→ launch；
- source-aware budget reserve（选源价目刷入本次 catalog）；任务 cap + 公司日预算(cost_guard.dailyBudgetUsd.company−当日 cost_daily) 预检；超帽 HOLD（`MODEL_ROUTING_FAIL;BUDGET_EXCEEDED`），不降档；
- harvest 回填（四要件**成功后才** recordSuccess；失败按分类 recordFailure 冷却 + ESCALATE `MODEL_ROUTING_FAILOVER`；状态 daemon_kv；launch 成功≠收割成功，不在 dispatch 提前记 success）；下一 attempt 选下一源（同一次 dispatch 内 launch 失败不自动重试——**限制**）；
- per-source price snapshot 启动播种（source_ticket=`seed-routing:<date>:<tier>:<id>`；同日幂等/异常告警不拒启）；
- models.yaml 热切：sources 随 applyModelsUpdate 原子替换（在途不换源）；fingerprint 已含 sources（core canonicalize 全对象）；
- host E2E 脚本 `scripts/qa/model-routing-e2e.sh`（E2E 覆盖 failover/fail-all/budget/single；budget 场景 cap=1+超大整数源价，F4 落 `ESCALATE MODEL_ROUTING_BUDGET_HOLD;` 可读事件，断言 DISPATCH=0+BUDGET_EXCEEDED；单测覆盖预算 precheck 全不可用）（**task-59 第10跑最终 B 口径**：E2E 只验路由本体——failover=dispatch≥2+primary/secondary routing notes+cooldown；fail-all=dispatch≥2+恰两条 MODEL_ROUTING_FAILOVER+worker argv primary/secondary；**ALL_SOURCES_UNAVAILABLE 由 router 单测覆盖**（`全部冷却/禁用 → ALL_SOURCES_UNAVAILABLE 可读`），不在 E2E 硬等；四要件/CLOSE 由单测+生产验收覆盖，不冒充三层全过）（failover/fail-all/budget/single 四场景；宿主需非嵌套 seatbelt；显式 `seatbeltTier: workspace-write` + `.AIWS` 写根；**`OUT/root` 先 realpath**（macOS `/tmp`→`/private/tmp`，否则 seatbelt profile 写域与真实路径不一致导致 worker EPERM/REPORT 缺失——task-59 宿主根因）；worker 记录 argv/sourceHit 供复验）。
未完成/风险（MVP 明示）：
- healthz 已加只读 `routing.sources[]`（available/cooldownUntil/lastFailureClass/lastSuccessAt）；面板专用视图未接；
- ~~同一次 dispatch 内 launch 失败的自动换源未做~~ **已落（task-135 批 1）**：launch 抛错（=未产生首段
  输出）且失败类可换源（429/quota/5xx/timeout/network/auth/parse；400/拒答不换，§3）→ recordSourceFailure
  冷却+kvSet → ESCALATE `MODEL_ROUTING_FAILOVER`（同票同源去重）→ 重选（预算按落账后折叠重算，
  gateDispatch 不重跑——reserve 未结，adopt「一笔预留服务 N 次尝试」语义覆盖）→ 重绑 overlay/model →
  重试 launch 一次（每 dispatch 至多 1 次换源、每源至多 1 次）；全灭=DISPATCH_FAIL 可读 fail-closed；
  单测 `test/v2/routing/execute-failover.test.ts`（fake adapter：换源成功/全灭/400 不换）；
- source price snapshot 的“实际源归属”在 harvest 依赖 adapter setModel + 新播种快照；混合源日需日闭按源汇总注明；
- ~~hot swap 新源 price snapshot 不即时补种~~ **已落（task-135 批 1）**：播种口径收口
  `engine/routing/seed.ts`（启动 executor-face 与热切 models-hot-swap 共用；同 provider/model 当日已有
  行即幂等跳过，异常告警不回滚不拒启）；SCHEMA_EVOLVE note 携 `sourcesSeeded=N`；单测
  `test/v2/serve/models-hot-swap.test.ts`（新源即时补种+同日重复热切零重复行）；
- quota 池化为**申报口径**（remainingUsd/resetAt 人工或上游申报，不主动探测）；负值=超用申报按耗尽处理；
- host E2E 未在 builder 会话跑（嵌套 seatbelt 阻塞 dsh detect），需 Lead/verifier 宿主复跑脚本
  （launch-failover 与 harvest 路径互斥：脚本 fail-all 断言仍恰两条 harvest-path FAILOVER，不受影响）。

本切片（task-51）已落：
- `packages/core/src/models.ts`：sources schema/归一/fingerprint 待补；`modelSourcesOf`；
- `apps/daemon/src/engine/routing/router.ts`：选择/预算预检/失败分类/冷却/half-open/序列化；
- `apps/daemon/test/v2/routing/model-routing.test.ts` 5/5。
未落（需下一刀，建议拆为独立实现单）：
1. dispatch/executor 接线：按 tier 选 source→生成/选择 per-source dsh overlay→adapter model 声明→launch；
2. 失败回填到 router（从 harvest/execute 错误分类）；
3. per-source 价格注入 budget-gate 与 price_snapshot；
4. fingerprint 纳入 sources、热切原子替换；
5. healthz/面板源状态、真机 E2E（两源/耗尽/全失败）。
未完成这些前不宣称 task-51 完成；建议另立「路由 dispatch 接线」实现单，或本单续作第二切片。
