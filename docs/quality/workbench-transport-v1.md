# WorkbenchTransport v1（P1-1a 冻结基线）

- 包：`packages/workbench-transport/`（零运行时依赖；Unix domain socket + NDJSON）。
- 协议：`workbench-transport/v1`；帧=单行 JSON，`{id,method,params?}` / `{id,ok,result|error}`。
- 方法冻结：`health`、`rooms.list`、`rooms.create`、`messages.send`、`messages.list`、`read`、`inbox`、`wakes.claim`、`wakes.ack`。
- 错误码冻结：`WB_UNAVAILABLE/WB_TIMEOUT/WB_NOT_CONNECTED/WB_PROTOCOL/WB_INVALID_ARGUMENT/WB_ROOM_NOT_FOUND/WB_MESSAGE_NOT_FOUND/WB_WAKE_NOT_FOUND/WB_WAKE_NOT_CLAIMABLE/WB_IDEMPOTENCY_CONFLICT/WB_INTERNAL`。
- claim/ack 语义：claim 只对本人 wake；`claimed|acked` 重复 claim 分别回 `alreadyClaimed`/`WB_WAKE_NOT_CLAIMABLE`；ack 幂等回 `alreadyAcked`；两者均支持 `idempotencyKey` replay（`replayed=true`）。
- 重连：在途请求遇断开统一 `WB_UNAVAILABLE`（retryable）；下一次请求自动重连（一次即时重连，退避策略归上层）。
- 测试（vitest v2）：`packages/workbench-transport/test/v2/transport.test.ts` 覆盖健康/房间/消息/read/inbox、claim→ack、重复 claim/ack、socket 断开在途错误+重连、超时、稳定错误码、连接失败。
- mock sidecar：`test/support/mock-sidecar.ts`（仅测试；支持 `dropConnections`/`setDelay`）。
- P1-1b 对接点：chatd 骨架按本包 `types.ts` 实现 Unix socket 服务端；P1-1a 不启服务/不接 daemon/不改 contract。
