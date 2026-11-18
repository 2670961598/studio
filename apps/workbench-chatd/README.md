# workbench-chatd（Phase1 模块 A / P1-1b 骨架 + 模块 C 最小刀）

聊天 sidecar 骨架：**Unix socket（0700）+ token 鉴权 + NDJSON 端点**。
存储两模式：缺省**内存 mock**（P1-1b 原语义，重启即空）；设 `WORKBENCH_CHATD_DB` 即
**node:sqlite 持久化**（模块 C 最小刀/P1-2 前半：rooms/messages/read/inbox 最小集落库，重启恢复）。
零第三方依赖，Node ≥24 原生 type-stripping 直跑（不引构建链）。施工依据：
`docs/sentinel-logs/Phase1实现拆解-2026-11-17.md` 模块 A/模块 C、`docs/sentinel-logs/提案-Phase1聊天服务-2026-11-17.md` §1.1。

## 边界（C-mini 只做这些）

- **存储**：内存 mock（缺省，向后兼容）或 node:sqlite（`src/store/`：schema 版本表 `chatd_meta`+顺序迁移、
  init 幂等、DB 文件 0600、messages append-only 由 schema 触发器 ABORT 保证）。send/read/ack 写路径落库、
  重启 hydrate 恢复；read 游标覆盖写（单调不回退）。**不接 vendor collab**（P1-2 后半）、不建 wake 租约/dead-letter。
- **不接生产**：launchd 仅模板（`launchd/`，不加载）；不写公司目录、不迁 Matrix 数据。
- **协议冻结**：`workbench-transport/v1`（唯一冻结源 `packages/workbench-transport/src/types.ts`）。本包**不 import**
  该包（分层宪法 20-§十五：新包间边=提案流），wire DTO/错误码以镜像对齐，由契约测试（真客户端）背书。
  两种存储模式的端点响应形状完全一致（health 的 `server` 后缀标模式：`+mock`/`+sqlite`）。

## 启动 / 停止

```bash
node --experimental-strip-types apps/workbench-chatd/src/main.ts [--memory]
```

`--memory` 显式强制内存模式（优先于 env）；缺省不传参 = 按 env 决定。

| env | 默认 | 说明 |
|---|---|---|
| `WORKBENCH_CHATD_SOCKET` | `$TMPDIR/workbench-chatd.sock` | Unix socket 绝对路径；生产约定 `<companyDir>/var/workbench/chat.sock` |
| `WORKBENCH_CHATD_TOKEN` | （空） | transport token；**生产必配**。未配置默认 **fail-closed**：`config_invalid` exit 1。形如 `__...__` 的占位符（模板未替换）同样拒启 |
| `WORKBENCH_CHATD_ALLOW_NO_AUTH` | （空） | 免鉴权显式豁免：仅精确值 `1` 生效，允许未配 token 启动（**仅供 mock/dev/测试**，启动打 `auth_disabled` 告警）。未设/其他值=不豁免（fail-closed）；配了 token 时本开关不降低鉴权 |
| `WORKBENCH_CHATD_DB` | （空） | SQLite 数据库**绝对路径**（C-mini）：设置即持久化模式（父目录按需 0700 创建，文件 0600；schema 见 `src/store/sqlite.ts`）；缺省/空=内存 mock。`--memory` 可强制覆盖回内存 |
| `WORKBENCH_CHATD_DELAY_MS` | `0` | 每请求人工延迟（测试/观测旋钮；生产保持 0） |
| `WORKBENCH_CHATD_DRAIN_TIMEOUT_MS` | `5000` | SIGTERM 后在途请求 drain 上限 |
| `WORKBENCH_CHATD_LOG` | `info` | `debug|info|warn|error`；日志=stderr 单行 JSON |

- **就绪信号**：stderr 出现 `{"event":"ready",...}`（socket 已 chmod 0700 可用）。
- **优雅停机**：SIGTERM/SIGINT → 停止接受新连接 → 在途请求完成或超时（drain 期间新帧回
  `WB_UNAVAILABLE` draining, retryable=true）→ 拆连接 → 清 socket 文件 → exit 0。
- **崩溃残留**：kill -9 不清 socket 文件；下次启动探测无监听者（ECONNREFUSED）自动清理后重绑；
  有活监听者则拒绝启动（防双实例）。非法配置 exit 1（`config_invalid`）——含未配 token 且未显式
  `WORKBENCH_CHATD_ALLOW_NO_AUTH=1`（默认 fail-closed）与 `__...__` 占位符 token。
- 日志纪律：token 值永不落日志（有测试断言）。

## 协议

NDJSON 帧，与 `workbench-transport/v1` 一致：

- 请求：`{"id":"...","method":"health","params":{...}}`（每行一帧）
- 响应：`{"id":"...","ok":true,"result":{...}}` 或 `{"id":"...","ok":false,"error":{"code":"WB_...","message":"...","retryable":false}}`
- 帧本身非法（非 JSON/非对象/缺 id/缺 method/params 非对象/未知方法）→ `WB_PROTOCOL`（无法定位 id 时 id=`unknown`）。

方法（9 个冻结方法全实现，mock 语义与 P1-1a 已验收的 transport mock-sidecar 一致）：
`health` / `rooms.list` / `rooms.create` / `messages.send` / `messages.list` / `read` / `inbox` / `wakes.claim` / `wakes.ack`。
幂等键（`idempotencyKey`）replay 语义：send/read/claim/ack 同键返回首次结果并 `replayed:true`。

**鉴权（v1 冻结码表的已知缺口）**：v1 错误码表无 UNAUTHENTICATED。无/错 token 以
`WB_INVALID_ARGUMENT`（`retryable:false`，message 前缀 `unauthenticated:`）承载，见 `src/server.ts` 头注；
后续协议若引入专用鉴权码须走版本升级，不得静默改码。token 比对为 sha256 摘要后常时比较。
**启动侧 fail-closed**：生产必配 `WORKBENCH_CHATD_TOKEN`；免鉴权仅限 mock/dev/测试且须显式
`WORKBENCH_CHATD_ALLOW_NO_AUTH=1`（启动仍告警 `auth_disabled`），不配 token 又不豁免 → `config_invalid` exit 1。

## 测试

本包测试用 **node:test**（仓 vitest 在本 worktree 不可用且本包刻意不进 v2 门禁）；
文件后缀 `.nt.ts`，**不匹配** vitest 默认 include（`*.test.ts`/`*.spec.ts`），不会被 Lead 侧根 vitest 吞掉。

```bash
# 全部（起停/drain/kill-9 重启/占用拒绝；0700/token 拒绝/放行/不落日志；端点 DTO+错误码；真客户端契约；SQLite 持久化）
node --experimental-strip-types --test apps/workbench-chatd/test/*.nt.ts

# 单文件
node --experimental-strip-types --test apps/workbench-chatd/test/lifecycle.nt.ts
```

契约测试经子进程驱动器 `packages/workbench-transport/test/support/chatd-driver.ts`（真
`WorkbenchTransport` 客户端打真 socket；两包文件互不 import，不构成 import 边），覆盖
happy 全端点、`WB_TIMEOUT` 超时、SIGKILL 断连 `WB_UNAVAILABLE` + 自动重连。

## launchd 模板

`launchd/io.studionext.workbench-chat.plist.template`——占位符 `__COMPANY__ / __NODE_BIN__ /
__DEPLOY_WORKSPACE__ / __COMPANY_VAR__ / __LOG_DIR__ / __WORKBENCH_CHATD_TOKEN__`。
占位符 `__WORKBENCH_CHATD_TOKEN__` 未替换即启动会被 `config_invalid` 拒绝（防呆，有测试）。
**P1-1b 仅生成不加载**；生产接入选 P1-2+ 另行批示。
