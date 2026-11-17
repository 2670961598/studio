# tier→executor 映射 + Kimi 模型归属（task-100）

- daemon.yaml 可选 `tierExecutors`（JSON 字符串，档位 high|mid|low → ENU-88 执行器 dsh|claude|codex|kimi；非法档/非法执行器拒启）。
- 派发档位面：配置名在注册表且非 `-judge` 位时优先选该执行器，note `;tier=<tier>@<executor>（tierExecutors 配置）`；未配/未注册回退现 `<family>-<tier>` 逻辑（零漂移）。
- Kimi 模型归属：`KimiAdapter` 从真实 wire `usage.record.model` 捕获 `ResultStats.model`（如 `kimi-code/kimi-for-coding`），work_records.model 随账；未捕获保持 undefined（不猜）。
- 订阅制成本口径：KimiCode 订阅按 **0 边际成本** 记 cost.usd=0，模型名照实登记为 unpriced（价目/日闭报告标注），不改 contract/事件词。
- dev 配置建议：agent.yaml 注册 `kimi` executor（cmd 本机 KimiCode CLI，version 2.1.1）；daemon.yaml `tierExecutors: '{"high":"kimi","mid":"dsh","low":"dsh"}'`，seatbeltWriteRoots 加 `~/.kimi-code`/`~/.kimi`，authorization 追加制作人令备注。
