# @studio-next/studio-tools —— 内部 MCP server（工具能力层对内）

> docs/24-§二 第一块：**工具集 = 网关白名单的机器化**。worker 经 MCP 调网关工具；
> AGENTS.md（prompt 包 L5）只教「什么时候用哪个」，「怎么调」由 MCP schema 承担——
> **格式错误由协议层拒绝，不再靠模型自觉**。状态推进永不在工具集。

## 工具表（单一事实源：`src/tools.ts` 的 `STUDIO_TOOLS`）

六工具与契约包 `GATEWAY_ACTIONS`（`packages/contract/src/ports/gateway.ts`，docs/25-§4.1）
**同名同序一一对应**；两表对齐由测试钉死（`tools.test.ts` 静态断言 +
`server.test.ts` 的 tools/list 广告面断言），不一致即红。新增工具 = 动 GATEWAY_ACTIONS =
动契约（走批示流）。

| 工具 | 对应 GatewayAction | 什么时候用（description 摘要） | deps 后端 |
|---|---|---|---|
| `comment` | comment | 给单据追加网关署名评论（进展/结论回执/留痕） | —（网关署名回执） |
| `heartbeat` | heartbeat | 长任务定期报「还活着」，防看护误判僵死 | —（网关署名回执） |
| `article` | article | 知识库文章 upsert（经验/教训沉淀为 markdown） | —（网关署名回执） |
| `kb-search` | kb-search | 干活前先查现成知识，避免重复踩坑 | `deps.searchKb` |
| `evidence-write` | evidence-write | 完成证据落盘（无证据=无完成） | `deps.writeEvidence` |
| `budget-query` | budget-query | 花前先看本单预算视图 | `deps.queryBudget` |

AGENTS.md 生成器请引用 `studioToolSummaries()`（name + action + title + description +
inputSchema 的 JSON Schema 摘要），不要手抄本表。

## 组装

```typescript
import { createStudioToolsServer } from '@studio-next/studio-tools'

const server = createStudioToolsServer({
  gateway, // @studio-next/gateway 的写路径收口闸（唯一执行后端）
  deps,    // { writeEvidence, searchKb, queryBudget }——IO 注入，本包不持有
})

// MCP 初始化时注入 wkey（24-§二）：connect 自动从 initialize 参数
// _meta['studio-wkey'] 捕获；宿主直注走 opts.wkey（daemon 派工/HTTP 鉴权头形态）
const [clientT, serverT] = InMemoryTransport.createLinkedPair()
await server.connect(serverT)
```

## 鉴权与错误口径（fail-closed）

- **wkey 注入**：① initialize 参数 `_meta['studio-wkey']`（握手期捕获，stdio 形态唯一
  通道）；② 构造 `opts.wkey` 宿主直注。两者都过网关 HMAC 校验，无信任差异。
- **无 key / 坏 key**：全工具 fail-closed——无 key 返回
  `{ category:'auth', subcause:'missing-wkey' }`（不碰网关不烧 nonce）；坏 key 由网关
  拒绝码原样透传 `{ category:'gateway', subcause:'gw-verify-<子码>' }`。
- **两级错误分类**（机器可读冻结面）：`category` ∈ auth / gateway / deps / internal；
  `subcause` 见 `TOOL_SUBCAUSES`（gateway 族=网关拒绝码原样）。
- **坏输入**：协议层拒（typed inputSchema，strictObject 多余字段即拒），isError 结果，
  不进 handler、不碰网关。
- **每次调用**：schema 化参数重组为单行 `@action <verb> <json>` 经 `gateway.gateWrite`
  （鉴权→结构化校验→署名注入）；**状态推进永不在工具集**。

## 测试与验收

```bash
cd packages/studio-tools && bun run typecheck && bun run test
```

- 43 例：六工具 happy path（真网关链路断言 gateWrite 收到正确 action/payload）、
  无 key/坏 key/异密/scope 外/过期/重放 fail-closed、协议层 schema 拒、deps 失败分类、
  两表对齐双钉。
- 不起真 stdio：`InMemoryTransport` + 手搓极简 JSON-RPC 客户端驱动真实协议层；
  未引 `@modelcontextprotocol/client`（新依赖纪律：仅 `@modelcontextprotocol/server`）。

## CLI 挂载样例（【拟稿待核】——形态按 docs/27 探针清单 P 系列口径真机核实前不得当实锤）

### dsh 插件（【拟稿待核】dsh 0.2.0-rc.2 的插件/mcp 配置形态未见文档实锤）

```jsonc
// 拟稿：dsh mcp 插件配置（挂载键名与位置待 dsh 真机核实后回改）
{
  "mcpServers": {
    "studio-tools": {
      "command": "node",
      "args": ["<repo>/apps/daemon/src/cli/studio-tools-stdio.ts"], // stdio 入口：后续单（工厂已备）
      "env": { "STUDIO_TOOLS_WKEY": "<daemon 派工时按单签发注入>" } // 【拟稿】宿主直注通道键名待批
    }
  }
}
```

### claude `--mcp-config`（【拟稿待核】标准 MCP config 形态，真机行为两 CLI 一致性属 24-§四.3 验收）

```jsonc
// claude --mcp-config studio-tools.json
{
  "mcpServers": {
    "studio-tools": {
      "command": "node",
      "args": ["<repo>/apps/daemon/src/cli/studio-tools-stdio.ts"], // 同上：stdio 入口后续单
      "env": { "STUDIO_TOOLS_WKEY": "<按单 wkey>" }
    }
  }
}
```

注：stdio 入口（`serveStdio` 接线）不在本原型单——本单交付工厂与工具面；入口单须复用
`createStudioToolsServer`，不得另起注册面（广告面一致性测试会拦）。

## 依赖与版本

- `@modelcontextprotocol/server` **^2.3.1**（docs/16-§二 锁 2.x 线；实锁 2.3.1，
  2026-10-16 官方源复核——独立复核 NA3 曾误判 2.x 不存在，宰相已终审确认实存）
- zod 复用仓内 ^4.0.0 解析（实锁 4.6.7，满足 MCP 包 ^4.2.0 需求）
- 类型桥：zod ≥4.2 运行时已实现 `~standard.jsonSchema`，但其类型声明只声明 validate 面；
  `server.ts` 内 `McpSchemaOf` 三处内联桥只弥合类型层（zod 类型补齐后删除）。

## 拟稿待批点（本单声明，批示前不定稿）

1. **wkey nonce 单次有效 vs MCP 会话复用**（沿 gateway/wkey.ts 头注疑点）：现行语义
   一 wkey 过一次闸，MCP 侧复用即 `gw-verify-replay`（测试已钉现行行为）；
   相容方案（每调用现签 / verify 复用窗口）待批示。
2. `evidence-write` 大正文内联 `@action` payload 过闸，体积上限未定。
3. initialize `_meta` 的 wkey 键名 `studio-wkey` 与宿主直注 env 键 `STUDIO_TOOLS_WKEY` 定名。
4. dsh 插件挂载形态（上节拟稿）——待 dsh 真机核实（P 系列）。
