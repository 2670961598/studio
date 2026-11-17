# tier→executor 映射 + Kimi 模型归属（task-100）

- daemon.yaml 可选 `tierExecutors`（JSON 字符串，档位 high|mid|low → ENU-88 执行器 dsh|claude|codex|kimi；非法档/非法执行器拒启）。
- 派发档位面：配置名在注册表且非 `-judge` 位时优先选该执行器，note `;tier=<tier>@<executor>（tierExecutors 配置）`；未配/未注册回退现 `<family>-<tier>` 逻辑（零漂移）。
- Kimi 模型归属：`KimiAdapter` 从真实 wire `usage.record.model` 捕获 `ResultStats.model`（如 `kimi-code/kimi-for-coding`），work_records.model 随账；未捕获保持 undefined（不猜）。
- 订阅制成本口径：KimiCode 订阅按 **0 边际成本** 记 cost.usd=0，模型名照实登记为 unpriced（价目/日闭报告标注），不改 contract/事件词。
- dev 配置建议：agent.yaml 注册 `kimi` executor（cmd 本机 KimiCode CLI，version 2.1.1）；daemon.yaml `tierExecutors: '{"high":"kimi","mid":"dsh","low":"dsh"}'`，seatbeltWriteRoots 加 `~/.kimi-code`/`~/.kimi`，authorization 追加制作人令备注。

## 选择链登记面（task-114）

- 公司级 `tierExecutors` 配置同时作为**显式选择登记面**：`DispatchSelectionDeps.tierExecutors`（执行器家族集合，serve 从 daemon.yaml 注入；未配=空集零漂移）。
- `resolveDispatchSelection`：请求执行器非主绑定、该单**无任何选择链登记**、且 ∈ tierExecutors 集合 → 放行，`source='tier-config'`、`chainId='tier-config:default'`，note 明示“公司 tierExecutors 配置=显式登记面（非 ticket/岗位登记）”。
- 单登记/岗位登记优先级与 mismatch 拒派不变；未配置执行器仍 `dispatch/selection-unregistered`（NEG-RUN-05 不变）。
