# 模型多源路由（task-51 MVP；提案 task-48 方案 A）

> 状态：**设计 + 核心切片已落**（models.yaml `sources[]` 解析/归一、优先级/预算/冷却/half-open
> 纯逻辑、状态持久化序列化、单测）。**dispatch/executor 实际换源、失败回填、真机 E2E 未在本切片完成**
>（见 §9 状态与拆分建议）。不新增契约/schema/事件词；不引外部依赖。

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
        quota: {kind: monthly, limitUsd: 0, resetAt: null}   # MVP 只登记/审计，不主动探测
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

1. 取该 tier 的 sources，过滤 `enabled=false`；按 `priority` 升序 + `id` 稳定排序。
2. 过滤冷却未到期；到期源可作为 **half-open** 候选尝试一次。
3. **预算预检**（在 dispatch 前）：
   - 任务剩余预算 = `TaskBrief.budgetCap`（或 jobs `budget_cap`）× 已用/预留折叠；
   - 公司当日剩余 = 公司预算日闭口径（现有 cost/budget 目录）剩余；
   - 用**候选源价格**估算本次成本；超任一帽→`BUDGET_EXCEEDED` **HOLD/ESCALATE**，
     **不静默跳到更便宜源，也不擅自降档**；只有显式 `allowBudgetDowngrade=true` 才继续后续源。
4. 选中源后：`DISPATCH` note 携 `modelsrc=<id>`、`price=…`（只读审计）；实际价格归属该源。
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
- 价格：`work_records.model=source.provider/model`（实际源）；`price_snapshot` 按源登记；日闭 delta≈0，
  混合源日需注明各源占比。

## 6. 审计/可观测

- 复用既有事件词：DISPATCH note `modelsrc=<id>;fallbackFrom=<id>`；源休息/全失败→ESCALATE/DAILY_ALARM；
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

## 9. 实现状态/拆分建议

本切片已落：
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
