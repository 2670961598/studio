# 47 · 对外 MCP 服务探索——让外部 agent 反过来调用我们（提案流②探索产物）

> 制作人 2026-10-19 三问之二（45-§二升为一等产品面考量后的派单探索）。性质：**事实调研与
> 候选方案**——只探索不决定，任何结论性选择权归制作人（45 状态修订令）。按 20-§十三 流程：
> 本文（②探索）→ 宰相复验 → 制作人拍板 → ⑤spike → ⑥过审。
>
> 事实纪律：MCP 相关主张逐条对照 modelcontextprotocol.io 官方规范核实，链接+核实日期随条
> 标注（**全部核实于 2026-10-19**）；业界先例真搜真看（官方文档/GitHub 仓/官方博客），检索
> 执行日 2026-10-19；查不到的一律标「未核实」，宁缺毋假。仓库代码现状引用均为本仓亲读。

---

## 一、问题陈述

StudioNext 要作为一个 **MCP server** 提供给外部 agent（Claude Code / ZCode / Cursor 等）：
外部 agent 通过 MCP 工具调用我们的接口——**查公司（概览/组织/人员）、查单据、查台账、
派单（投递需求）**。这使公司成为「agent 生态里可雇佣、可审计的节点」（45-§二），与公司包
规范（docs/40/43）合成对外故事的两半：资产格式 + 可雇佣接口。

要回答的四个子问题：
1. **架构**：MCP 面放在哪个进程、什么传输组合、离三事实源多远、工程量与风险如何？
2. **工具面与 scope**：只读/落单/派工三级怎么切？scope 表怎么定义（对照 wkey 六动词）？
3. **认证与审计**：静态 token / 按-agent 签发+TTL+可吊销 / OAuth（MCP 授权规范）怎么选？
4. **威胁模型**：外部 agent=不可信调用方，入站攻击面有哪些、与 docs/43-条款2 什么关系？

不新增事实源、不新增第二写入者是对外一切方案的硬前提（02-F2-01、45-§四）。

---

## 二、事实基座

### 2.1 MCP 官方规范核实（modelcontextprotocol.io，核实日 2026-10-19）

**版本与传输**：
- 最新规范版本为 **2026-07-28**（`/specification/latest` 即指向它；规范正文声明权威要求
  基于 schema.ts 2026-07-28）。链接：https://modelcontextprotocol.io/specification/latest
- 官方定义的标准传输只有两个：**stdio**（客户端启动的子进程标准流上的换行分隔消息）与
  **Streamable HTTP**（单一 MCP 端点只收 POST；响应为单 JSON 对象或**请求作用域**的 SSE
  流）。自定义传输允许但必须保留 JSON-RPC 消息模式与按请求元数据模型；跑在可靠双向字节流
  （Unix socket/TCP）上的自定义传输 SHOULD 复用 stdio 帧。链接：
  https://modelcontextprotocol.io/specification/2026-07-28/basic/transports
- 旧 HTTP+SSE 传输（2024-11-05 版）**自 2025-03-26 起弃用**，官方明言「New implementations
  SHOULD NOT adopt it」。链接（同上页 Deprecated 节）。
- **2026-07-28 是一次大改版**（changelog 逐条核实，
  https://modelcontextprotocol.io/specification/2026-07-28/changelog ）：
  1. 移除协议级会话与 `Mcp-Session-Id`；移除 GET 流端点与 `Last-Event-ID` 断线续传；
  2. 协议**无状态化**：删除 `initialize` 握手，每个请求在 `_meta`
     （`io.modelcontextprotocol/protocolVersion` / `clientCapabilities`）自带版本与能力；
     新增 `server/discover` RPC 供版本探测；跨调用状态一律用服务端铸造的显式 handle 承载；
  3. 长活通知改走 `subscriptions/listen`（POST 响应即 SSE 长流，按类型订阅）；
  4. 服务器→客户端交互（sampling/elicitation/roots）改走 MRTR（`InputRequiredResult`，
     客户端带 `inputResponses` 重试原请求）；
  5. Streamable HTTP 要求标准头镜像（`MCP-Protocol-Version`/`Mcp-Method`/`Mcp-Name`/
     工具参数级 `Mcp-Param-*`），头体不一致 MUST 400+`HeaderMismatch`(-32020)。
  ——旧时代（2025-03-26～2025-11-25，initialize 握手+会话）与新规范并存，靠版本协商
  回退兼容；**这对我们意味着：对外 MCP 面从第一天就要做「双时代客户端」兼容决策**。

**Streamable HTTP 安全条款**（逐条核实，
https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http ）：
- 服务器 **MUST 校验 `Origin` 头**（防 DNS rebinding，非法 Origin→403）；
- 本地运行的 server **SHOULD 只绑 localhost**（127.0.0.1）而非 0.0.0.0；
- **SHOULD 对所有连接做认证**。

**授权规范**（逐条核实，
https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization ）：
- HTTP 传输 SHOULD 遵循本规范；**stdio SHOULD NOT 走 OAuth，凭据从环境取**；
- MCP server=**OAuth 2.1 resource server**；Bearer 用 RFC 6750；**MUST 实现 RFC 9728
  Protected Resource Metadata**（`/.well-known/oauth-protected-resource`）；客户端 MUST
  实现 RFC 8707 resource 参数（token 与资源绑定，**MUST NOT token passthrough**——只收
  发给自己的 token，也不转发任何别的 token）；
- 客户端注册三选一：Client ID Metadata Documents（推荐）/ 预注册 / Dynamic Client
  Registration（RFC 7591，**已降级为弃用**、仅向后兼容）；
- **step-up 授权**：403 + `WWW-Authenticate: Bearer error="insufficient_scope",
  scope="…"` 挑战缺失 scope，客户端取并集重新授权——这是「按需提权」的协议化通道。

**工具定义**（逐条核实，
https://modelcontextprotocol.io/specification/2026-07-28/server/tools ）：
- 工具名 1-128 字符、大小写敏感、字符集 SHOULD 限 `[A-Za-z0-9_.-]`（`company.get` 合法）；
  `inputSchema`/`outputSchema` 为 JSON Schema（缺省 2020-12）；结构化输出走
  `structuredContent`；错误两级：协议错（如 -32601 Unknown tool）vs 工具执行错
  （`isError:true`，喂回模型自纠）；
- `tools/list` 支持分页（cursor）与缓存（`ttlMs`/`cacheScope`），SHOULD 确定性顺序；
- **工具集可以按「请求所携带的授权」变化**（规范原文：The set MAY vary by the
  authorization presented on the request — since credentials are per-request input, not
  connection state）——**scope 化工具面有协议级支持**，不是我们发明；
- 服务器安全义务（MUST）：校验全部工具输入、实现访问控制、**限流工具调用**、消毒输出；
  annotations（若用）客户端 **MUST 视为不可信**。

**官方安全最佳实践**（逐条核实，
https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices ），
可直接入威胁模型的条目：confused deputy（代理+静态 client ID+consent cookie 组合）、
token passthrough 反模式（禁止）、SSRF（OAuth 发现 URL 指内网/云元数据）、**state handle
劫持**（无状态协议下 handle=名字不是能力，每次调用都要校验调用者授权）、本地 server 妥协
（stdio+一键安装=以客户端同权限执行任意命令）、mix-up（RFC 9207 iss）、localhost redirect
冒充、**scope 最小化**（渐进式最小权限、避免 omnibus scope、401 挑战带 scope、记录提权
事件）。

**registry 信任模型**：docs/41-卡2 已核实（2026-10-19，同日有效）：官方 registry 只存
元数据（server.json，反向 DNS 命名空间+OIDC/DNS 认证），安全扫描外包包仓与聚合方，
「上架≠安全背书」；不支持 self-host。

### 2.2 业界先例（全部真搜核实，检索日 2026-10-19）

| 平台 | 官方 MCP | 形态/传输 | 认证 | 只读/scope 实践 |
|---|---|---|---|---|
| **GitHub** | ✅ github/github-mcp-server | 远程 HTTP `https://api.githubcopilot.com/mcp/`（OAuth 一键或 PAT Bearer）+ 本地 Docker stdio（PAT 或 OAuth） | OAuth / PAT 双轨 | **toolsets 分组**（issues/pull_requests/repos…，默认仅 context,repos,issues,pull_requests,users，按需开省上下文）；**全局 `--read-only`**（优先于 --tools，写工具全跳过）；每工具带 OAuth Challenge Scopes；repo 文档称按经典 PAT 的 scope 自动过滤工具面（见未核实清单②） |
| **YouTrack**（JetBrains） | ✅ 2025.3+ 内建远程 MCP（2025-10-28 官宣） | `<站点>/mcp` HTTP | OAuth（CIMD；**不支持 DCR**）/ 永久 token Bearer / mcp-remote 代理三种 | 权限模型=**「以认证用户本人的 YouTrack 权限」逐请求生效**；无专用只读模式，用 URL 参数 `tools`（白名单）/`ignoreTools`（黑名单）过滤；工具覆盖 issue/article/project/group/user/log_work |
| **Linear** | ✅ 官方远程 server | `https://mcp.linear.app/mcp`（读写）+ **专用只读端点 `/mcp/readonly`**；SSE 弃用兜底 | OAuth 2.1+DCR / API key Bearer / Okta 企业认证 | 只读三路：readonly 端点 / 只请求 `read` scope（「底层 token 到不了写 API」）/ 只读 API key；每 workspace 独立认证上下文 |
| **Plane** | ✅ makeplane/plane-mcp-server（MIT） | stdio（uvx）+ 托管 HTTP `https://mcp.plane.so/http/mcp`（OAuth）与 `.../http/api-key/mcp`（PAT）；SSE 仅向后兼容 | OAuth / API key 双轨 | 30 工具/207 操作（每资源一工具+action 参数）；**无 scope/只读模型**（如实记录：未提供） |

来源：docs.github.com 设置页（set-up-the-github-mcp-server）、github/github-mcp-server README、
JetBrains 官方博客与 YouTrack MCP 文档（model-context-protocol-server.html）、linear.app/docs/mcp、
makeplane/plane-mcp-server README（详见文末来源总目）。

**平台型共性归纳**（四家对照）：
1. **官方托管 HTTP 端点 + OAuth，同时保留 token 直连与 stdio 本地形态**——双轨/三轨是普遍
   实践，没有一家只做 OAuth；
2. **只读隔离各有做法**：专用只读端点（Linear）> 全局 flag（GitHub）> URL 工具白名单
   （YouTrack）；Plane 缺位；
3. **权限主流=「用户本人账号权限的投影」**（YouTrack 明说、GitHub PAT scope、Linear
   workspace 上下文）——**我们没有外部用户账号概念**：外部 agent 的凭据是制作人签发的
   主体，权限来自签发时的 scope 决定。这在四家先例中没有直接对应（最接近=服务 token/PAT
   模式），是我们必须自定的一块（详见 §四）；
4. 「**落单不派工**」（外部触发只投递、不直接驱动执行）在四家先例中无对应物——它们都是
   「act as user 全权写」；这是 StudioNext 特有的产品边界（packages/api 头注铁律）。

### 2.3 本仓代码现状（亲读核实）

- **:8788 对外面已有 v0.9 首刀**：实现在 `packages/panel/src/external/`（server.ts 571 行，
  Hono）——GET 信息端点（company/org/people/projects/issues/finance/reports/agent-card，
  公开）+ `POST /v1/requests`（`X-SN-Token` 头 + **只落单不派工** + 幂等键 + 配额
  429）+ SSE 订阅 501 占位。`packages/api` 仍是 skeleton 占位（TODO 明列「MCP server
  暴露面」）。**即：对外面的家在 api 包、实体暂居 panel/external，MCP 面落位前要先理顺
  归属**。
- **内部 MCP server 已在仓**：`packages/studio-tools`（SDK `@modelcontextprotocol/server`
  2.3.1）——六工具= GATEWAY_ACTIONS 一一对应，wkey 从 initialize `_meta['studio-wkey']`
  捕获或构造注入，每调用经 `gateway.gateWrite`。**SDK 双时代支持已实测**：本仓
  node_modules 内 SDK 2.3.1 的 dist 含 `server/discover`/`PerRequestHTTPServerTransport`/
  `SUPPORTED_PROTOCOL_VERSIONS`/`ScopeChallenge`/`requireScopes`/Origin 校验等导出，且
  错误串明示「per-request envelope is required on protocol revision 2026-07-28」——
  新规范工程上已可用，且同 SDK 兼容 legacy initialize 时代。
- **wkey 机制**（`packages/gateway`）：HMAC-SHA256 紧凑 token，claims
  `{v,ticket,scope,exp,nonce}`；scope 封闭枚举=GATEWAY_ACTIONS 六动词
  （comment/heartbeat/article/kb-search/evidence-write/budget-query），**表外动作进不了
  token**；TTL；nonce 单次有效；`revoke(ticket)` 关单即吊销（authority 在内存）。
  两个在案疑点与本单直接相关：①nonce 单次有效 vs MCP 会话复用相容性未批；②吊销集
  内存化——跨进程不可见（`worker-key.ts` 头注明示「teeth 依赖 authority 落 store」）。
- **worker key 签发**（`apps/daemon/src/engine/worker-key.ts`）：`mintWorkerKey` scope=六动词
  **全集**（v0 不细分）——docs/43-条款7 已裁定「六动词全集从缺省降为显式选择」，即 scope
  细分化是既定方向。
- **契约冻结的工具名**：`EXTERNAL_AI_TOOLS` 十名（25-§4.2）：
  `company.get / org.get / people.get / progress.get / finance.get / request.create /
  explore.trigger / task.create / intel.submit / events.subscribe`——触发类只落单不派工。
- **凭证三档**（01-C3-03）：公开（无 token 只读公开视图）/ 伙伴（ak-id.secret，库存哈希
  +last4，可 scope/吊销/TTL）/ 签名（HMAC+时间戳+nonce）。

### 2.4 A2A 与 MCP 的分工现状（docs/41-卡3 基础上更新核实）

- 分工口径未变且更巩固：**MCP=agent↔工具/资源，A2A=agent↔agent，互补不竞争**（LF 治理
  双方；社区一致口径）。A2A 于 LF 治理首年（2026-04-09 公告）已**超 150 家组织**、进入
  主要云平台、有企业生产使用。
  来源：https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year
- 对我们的含义：docs/24「对外 MCP server 为主协议面 + A2A 只做 exporter（名片从
  org-config 生成）」的骨架**不需要改**；:8788 `/v1/agent-card` 已落地名片面，A2A 侧
  无新动作。

---

## 三、架构方案（四案，不互斥；含对比矩阵）

### 方案 A · packages/api 内嵌 MCP 面（:8788 同进程双协议）

- **拓扑**：不新增进程。:8788 的 Hono 应用上加挂 MCP 端点（如 `POST /mcp`），REST 与
  MCP 同进程同端口；SDK 的 `McpHttpHandler`/`PerRequestHTTPServerTransport` 可桥接 Hono。
- **传输组合**：仅 Streamable HTTP（stdio 归方案 D）。Origin 校验/限流/鉴权与 REST 中间件
  同层复用。
- **与三事实源的距离**：与现行 :8788 完全同构——SQLite 台账只读投影 + 公司目录快照只读 +
  落单走既有幂等落单管线（不新增写入者）。MCP 工具 handler 直接复用 `views.ts` 投影层
  与触发面逻辑，「工具面与现有 API 同源，不另立逻辑」（45-§二）自然达成。
- **工程量**：小-中。工具注册×10、Bearer/凭证中间件扩展、`tools/list` 按 scope 收窄
  （规范支持）、审计落 events 接线。
- **风险**：①REST 与 MCP 同进程——限流/配额必须统一口径，否则 MCP 面成为绕过 REST 配额
  的旁路；②MCP 规范刚经历 2026-07-28 大改，双时代兼容的发布节奏与 REST 耦合；③api 包
  （skeleton）与 panel/external（实体）的归属要先收口（一次搬家，一次性成本）。

### 方案 B · 独立 MCP server 进程（复用 api/core 逻辑）

- **拓扑**：`studio-next mcp-serve` 独立 bin（或 packages/api 出第二入口），独立端口
  （如 :8790，端口表 25 要改）或 unix socket；daemon 看护面扩员或独立 launchd。
- **传输组合**：Streamable HTTP + stdio 双传输齐备（独立进程天然两种都能起）。
- **与三事实源的距离**：读面同 A（store 并发读=WAL 多读者可行；公司目录共享挂载）；
  写面同 A（落单仍走幂等管线——本地可函数直调，跨进程落单可仍投 :8788）。
- **工程量**：中。比 A 多出：进程部署/看护、鉴权与审计逻辑必须抽共享包防两处漂移、端口
  文档修订。
- **风险**：①鉴权/审计两处实现是最大风险（用共享包+契约测试钉死可缓）；②未来对外托管
  （别人的公司跑我们平台上）时 B 最干净——进程边界即信任边界；③近期（单机制作人本机/
  局域网形态）收益不明显，属「为远程发布形态提前付账」。

### 方案 C · 网关前置统一鉴权再分流（信任边界前置）

- **拓扑**：前置一层统一入站闸（鉴权→scope 判定→限流→审计落账），后面挂 REST 面、MCP
  面、（未来）A2A exporter 与 webhook 入站。业务 handler 不再见原始 token。
- **传输组合**：闸内分流任意；闸本身是 HTTP 反向角色（stdio 形态不经闸，见 D 注）。
- **与三事实源的距离**：审计最强——入站凭证事件单点落 events（「外部调用全落 events 可
  回放」从各面自证变成闸结构性保证）；写面同 A/B。
- **工程量**：大。本质是把 gateway 包从「worker 写路径闸」（17-§7）泛化为「对外统一入站
  闸」——wkey 机制要扩「外部主体」维度、吊销集必须落 store、scope 表外部化；且要与
  17-§7 网关定位文档化切分（写路径收口 vs 入站收口）。
- **风险**：①v1 只有 1-2 个面时前置层是额外跳板=过度设计风险；②token 泄露面最小化、
  审计单点是长跑最正的形态——**它是 A/B 的演进终态而非起点**。

### 方案 D · 纯 stdio 本机形态（`studio-next mcp` 子命令）

- **拓扑**：daemon bin 出子命令，宿主（Claude Code/ZCode）按 stdio 拉起子进程；每宿主
  一进程，daemon 不看护（宿主生命周期即进程生命周期）。
- **传输组合**：仅 stdio。凭据走 env（规范明言 stdio SHOULD NOT OAuth、凭据从环境取；
  现行 `withInitWkeyCapture` 的 initialize `_meta` 通道属 legacy 时代——stdio 新形态应
  直接读 env，studio-tools 已支持构造注入）。
- **与三事实源的距离**：本机直读 store/快照（同机文件）；落单可进程内直调幂等管线。
- **工程量**：最小。SDK stdio transport 成熟；studio-tools 已示范同 SDK 接线。
- **风险**：①只覆盖本机场景——「外部/远程 agent」的主叙事不成立；②多进程=吊销不可见
  （内存吊销集疑点在此放大，必须先落 store 才有 teeth）；③每宿主一进程→台账并发写与
  store 锁竞争要核（events 追加写 + WAL 可行但要测）。
- **优点**：最快见效——制作人自己的 Claude Code/ZCode 先用上，工具面在真实宿主上打磨，
  再上 HTTP 面时工具定义已稳定（先内后外，与 24-§四「两家以上 CLI 挂同一 server 行为
  一致」验收同构）。

### 对比矩阵

| 维度 | A 内嵌 :8788 | B 独立进程 | C 网关前置 | D 纯 stdio |
|---|---|---|---|---|
| 进程拓扑 | 沿用 :8788，零新进程 | +1 常驻进程（新端口） | +1 前置闸（或并入 daemon） | 宿主按需拉起，无常驻 |
| 传输 | Streamable HTTP | HTTP+stdio 双全 | 闸后分流 | stdio |
| 事实源距离 | 与现 :8788 同构 | 同构（并发读需核） | 同构+审计单点最强 | 本机直读，落单进程内 |
| 工程量 | 小-中 | 中 | 大 | 最小 |
| 鉴权复用 | 直接复用 :8788 中间件 | 需抽共享包 | 全部收口单点 | env token，最简 |
| 主要风险 | 配额旁路/包归属 | 两处逻辑漂移 | 过度设计 | 只本机/吊销不可见 |
| 适用阶段 | v1.x 首发 | 远程托管前 | 多面成群后（终态） | 立即可做（先行磨工具面） |

**组合关系**：D 与 A/B 不互斥（同一工具面实现、不同传输壳）；C 是 A/B 的演进终态。
排序参考（不构成结论）：**D 先行磨工具面 → A 作 v1.x 主发布形态 → C 作为多面成群后的
统一信任边界演进；B 在「对外托管服务」立项时再评估**。理由：D/A 工程量最小且直接骑在
已落地的 :8788 骨架与仓内 SDK 之上；C 的价值随对外面数量增长而增长，现在做是提前付账。

---

## 四、工具面与 scope 模型选项

### 4.1 三级切分与工具映射（基线，45-§二）

| 级 | 工具（EXTERNAL_AI_TOOLS 十名） | 语义 |
|---|---|---|
| ①只读 | company.get / org.get / people.get / progress.get / finance.get | 公开视图投影（views.ts 三档序列化，public 档） |
| ②落单 | request.create / explore.trigger / task.create / intel.submit | **只落单不派工**：幂等键→查重→落单→绑锚（派单人锚=主 PM，等级封顶）→署名 |
| ③派工与收割 | （默认无对应工具；events.subscribe 属①/②之间的订阅面） | 高权限，默认不授——现行契约里**根本没有**外部派工动词（api 头注铁律），「三级」的第三级是「显式不存在」而非「锁着的高权工具」 |

注意与 wkey 六动词的关系：GATEWAY_ACTIONS（comment/heartbeat/article/kb-search/
evidence-write/budget-query）是**内部 worker 写平台面**的动词表；EXTERNAL_AI_TOOLS 是
**外部只读+投递面**——两张表、一个机制思想（封闭枚举+表外拒收+签发时显式选择）。
外部 scope 表是**新增枚举**（契约包新常量，走批示），不是 GATEWAY_ACTIONS 的扩容。

### 4.2 scope 粒度三选项

**选项一：三级档位包**（`read` / `order` / `subscribe` 三字符串，tier 即 scope）
- 优：宿主配置最简（对标 Linear `read` scope 的简洁）；与 45-§二叙事一一对应；token 里
  scope 数组短。
- 劣：档内粗细不均——`people.get`（人员档案，可能含敏感字段）与 `company.get`（公开
  概览）同档；想只给「查进度」必须连人员一起给；提权粒度=整档跳级。

**选项二：逐工具细粒度**（`company:read` / `people:read` / `issues:read` / `request:create`
/ …，十工具各一）
- 优：最小权限精确；403 `insufficient_scope scope="request:create"` 挑战可精准（step-up
  协议原生支持）；审计里每次调用的授权意图清楚（官方 scope 最小化最佳实践同向：避免
  omnibus、记录提权）。
- 劣：scope 串数量膨胀（十枚起步，工具面还会长）；宿主 consent UI 负担与 token 申请摩擦；
  层级归并语义要自己钉（Linear/GitHub 都没做到纯逐工具）。

**选项三：混合——域分组动作后缀**（`<域>:<动作>`，tier 是预置组合）
- 形态：scope 词表=域×动作矩阵的子集（`company:read`、`people:read`、`issues:read`、
  `issues:create`…），另设 `read`=`全部 *.get` 的预置别名（签发时展开记录，token 内存
  展开后的细表）。
- 优：配置体验=选项一，授权精度=选项二；与 GitHub「toolsets 分组+read-only flag 双维」
  先例同构；与 docs/43-条款7「六动词全集从缺省降为显式选择」的既定方向同构；升级平滑
  （`read` 别名弃用即退化到选项二）。
- 劣：别名展开规则与层级包含语义必须文档冻结（规范提醒：servers MUST account for scope
  hierarchies）；比选项一多一点实现与说明成本。

**工具面随 scope 收窄**：2026-07-28 规范明文允许 `tools/list` 按请求授权变化——无论选
哪档，都应实现「没授权的工具不出现在 tools/list」（外部 agent 的模型根本看不见越权工具，
而非看得见调不动）。这与 fail-closed 是互补的两道闸。

---

## 五、认证与审计选项

### 选项 a · 静态 token（现行 X-SN-Token 延伸）

- 形态：伙伴档 ak-id.secret（C3-03）；MCP HTTP 面从 `Authorization: Bearer` 头取值，
  stdio 面从 env 取（规范口径）。
- 安全性：无 TTL；吊销=删库存行（下次请求即失效，但持有者可无限期使用直到被发现）；
  粒度=token 级；无签发留痕链。
- 工程量：最小（:8788 已有该中间件，MCP 面复用即可）。
- 定位：起步门槛最低，但「可吊销/TTL」是 45-§二自己写下的安全前提——静态 token 不满足
  留痕要求，只宜作过渡。

### 选项 b · 按-agent 签发 + TTL + 可吊销（wkey 机制复用/泛化）

- 形态：复用 gateway 的 HMAC token 机制，但**泛化主体维度**——wkey 的 claims 是
  `{ticket, scope, exp, nonce}`（按单短命）；外部 agent 是**长命主体**，需要
  `ticket`→`agent:<主体id>` 的语义扩展或独立 token 家族（契约层新 claims 形状，走批示）。
  TTL 天级+到期重签；吊销=agent 级一刀（对标 revoke(ticket)）。
- 两个前置依赖（均为在案挂账，外部面把优先级顶上来）：
  ① **吊销集/nonce 集落 store**——跨进程可见才有 teeth（gateway 包挂账项）；② **nonce
  单次有效 vs 长会话复用**的相容口径——外部 agent 是多调用长会话，「一调用一签发」不可
  行，须按「复用窗口」（如 token 生命周期内 nonce 不重复消费）或去 nonce 化改判 exp+吊销
  （拟稿批示件）。
- 安全性：可吊销、有 TTL、签发/吊销全程留痕；HMAC 本地验证零外部依赖（局域网形态友好，
  不需要 TLS 之外的公网 AS）。
- 工程量：中。机制全在仓（gateway 包纯逻辑零 IO），泛化+落 store 是两刀。
- 业界对位：GitHub PAT / Linear API key / YouTrack 永久 token / Plane PAT——**token 直连
  轨在四家先例里全部存在**，我们比它们多做了 TTL+吊销（YouTrack/Plane 的 token 均为
  长命静态，Linear API key 支持权限档）。

### 选项 c · OAuth（MCP 授权规范全量）

- 形态：MCP server=OAuth 2.1 resource server——`.well-known/oauth-protected-resource`
  （RFC 9728，MUST）+ 一个授权服务器（自建或 daemon 内嵌；SDK 已导出 OAuth metadata/
  Bearer 校验/ScopeChallenge 相关设施）+ step-up scope 挑战 + RFC 8707 resource 绑定。
- 安全性：协议级最强——consent 由宿主 UI 承载、token 生命周期/刷新托管、提权有标准流、
  token 受众绑定防串用；与 Claude Code 等宿主的 OAuth 原生体验对齐。
- 工程量：大。AS 是全新面（即使 SDK 有设施，AS 端点/用户 consent 页/密钥管理都是新资产）；
  **局域网形态是坑**——OAuth 生产要求 HTTPS，本机/局域网 http 部署要么自签要么豁免，
  先例的远程端点全在公网域下；stdio 形态规范明言不走 OAuth。
- 业界对位：四家全部「OAuth+token 双轨」——**没有任何一家只做 OAuth**；OAuth 是远程托管
  形态的主轨，token 是本地/脚本形态的副轨。

**审计共同层**（三选项共用，不随认证档位降级）：外部主体台账独立（24-§三）；MCP 每次工具
调用落 events（actor=agent 主体，correlation 链到落单）；401/403/429 拒绝也留痕；token
本体永不入任何文本面（红名单纪律同 wkey）。

**组合排序参考（不构成结论）**：b 起步（HTTP 面与 stdio 面同吃 token 直连轨）→ c 在
「远程公网托管形态」立项时上（届时 b 的 token 轨保留为副轨，与四家先例同构）→ a 只作
b 落地前的过渡。触发 c 的信号：出现第一个非局域网的外部消费者。

---

## 六、入站威胁模型草案（实现单前出正式版，本节为底稿）

**总纲**：外部 agent=不可信调用方（45-§二）；入站文本与公司包文本**同罪假设**
（docs/43-条款2 同构——消毒只防形态不防语义，不是安全边界）。

| # | 威胁 | 攻击面 | 缓解（机制非自律） |
|---|---|---|---|
| T1 | **钓鱼派单/内容投毒**：外部投递的单据描述/评论/intel 情报内嵌提示注入，最终被**我们的 worker LLM** 当上下文消费（对内攻击链） | request.create / task.create / intel.submit 的自由文本字段 | ①入站正文按 untrusted 渲染（复用 43-条款2 消毒管线，装载时消毒→改为**每次调用时**消毒）；②任务书组装时外部单正文强制声明性中和；③（决策点）外部单是否加制作人准入闸——现行设计已含半闸：只落单+派单人锚=主 PM，外部单进主循环前有 PM 归拢环节 |
| T2 | **洪泛/配额耗尽**：垃圾单/高频调用烧台账与 PM 带宽 | 全部工具，尤其 ② 档四个 | servers MUST rate limit（规范义务）；:8788 现行 per-token 配额扩展到 MCP 面；幂等键防重；外部主体独立计费口径 |
| T3 | **越权/scope 逃逸**：低权 token 试调高权工具、伪造 scope 声明 | tools/call 全部 | fail-closed（无凭证 401/坏凭证 403）；`tools/list` 按 scope 收窄（越权工具不可见）；scope 封闭枚举表外拒收；token audience 校验（MUST NOT token passthrough——只认我们签发的 token） |
| T4 | **工具描述投毒（反向）**：我们自己的工具 description 是喂给外部 agent 模型的指令——被篡改=对外投放注入；同时外部 agent 的能力自述不可作放行依据 | tools/list 的 description 字段 | 工具描述进版本管理+变更走批示（哈希钉住思路，41-卡2 mcp-scan 同构）；描述文本与实现声明分字段（43 字段分类铁则同构）；外部 agent 自述能力永不放行（41-坑3） |
| T5 | **DNS rebinding/Origin 攻击**：网页借 rebinding 打本机/局域网 MCP 面 | Streamable HTTP 面 | MUST Origin 校验（规范；非法→403）；本机形态绑 localhost；局域网形态显式绑定+token 必带 |
| T6 | **SSRF**：webhook 回调/订阅投递地址指向内网/云元数据 | /v1/subscriptions、回调类 | api 头注既有计划：出站白名单+硬禁内网/回环（规范 SSRF 节同向：禁私网段/元数据端点/TOCTOU） |
| T7 | **state handle 劫持**：无状态协议下游标/订阅 id 被 guesses 后跨主体重放 | 分页 cursor、订阅 id | handle=名字不是能力（规范明言）：服务端按签发主体绑定校验，每次调用验归属（`<agent_id>:<handle>` 键式）；高熵不透明 id+有界生命期 |
| T8 | **token 窃取/长命滥用** | 认证层 | TTL+可吊销（选项 b 前提）；泄露响应=吊销+重签+台账可回放定位影响面 |
| T9 | **工具面静默变更（我们侧 rug-pull）**：外部 agent 信任的工具集被静默改动 | tools/list | listChanged 变更通知+工具版本化；对外变更走公告/批示（生态信誉问题，41-坑1 教训） |
| T10 | **confused deputy**：我们的 server 将来若反代第三方 API，静态 client ID+consent cookie 组合可被骗授权 | 远期（我们暂无反代场景） | 记录在案；若做反派必须 per-client consent（官方最佳实践 MUST 项） |

与 docs/43 的关系声明：条款2（untrusted 渲染）是 T1/T4 的同一根水管——消毒管线共享、
入口语义不同（装载时 vs 调用时）；条款7（凭据按类别+wkey scope 显式选择）是 T3/T8 的
机制源头。**对外 MCP 面不新发明安全机制，复用条款机制+本表新增的限流/收窄两件**。

---

## 七、决策点清单（制作人拍板项）

1. **架构起点**：D 先行+A 主发布（排序参考）？还是直上 B/C？C 的启动时机判据（几个面
   才值得前置闸）？
2. **scope 粒度**：选项一/二/三（排序参考=三）；`tools/list` 按 scope 收窄是否 v1 就做
   （参考：是——工程小、防御价值高）。
3. **认证起步档**：a 过渡 / b 直上 / c 一步到位（排序参考=b）；c 的触发信号（首个公网
   消费者？）是否就此写死。
4. **外部单准入**：外部投递的单据是否需要制作人/PM 准入后才进主循环（现状=只落单+主 PM
   锚，已是半闸）；还是完全自动排队。
5. **工具面首发范围**：十工具全量，还是①档五查+`request.create` 六件先行（explore/
   task/intel/events 后补）。
6. **传输与绑定**：:8788 复用（A）还是新端口（B）；局域网绑定口径（0.0.0.0+token 还是
   仅 localhost）；stdio 子命令名（`studio-next mcp`）。
7. **订阅通道**：`events.subscribe` 用 MCP 原生 `subscriptions/listen`（2026-07-28 新规）
   还是复用 :8788 SSE 计划——两者关系要一刀（SSE 501 占位现在的去向）。
8. **外部主体凭据形状**：wkey 泛化（agent 维度 claims）还是独立 token 家族；nonce 语义
   （复用窗口/去 nonce 化）批示件何时上——**这是 b 档的硬前置**。
9. **双时代兼容策略**：外部 HTTP 面同时接 2025 时代（initialize）与 2026-07-28（无状态）
   客户端，还是只做新时代+SDK 自动回退——依赖宿主支持矩阵（未核实③）。
10. **工具描述治理**：description 版本化+变更批示是否进 v1（T4 缓解的落地时点）。

## 八、未核实清单（宁缺毋假，留待⑤spike/宰相复验补）

1. **ToolAnnotations 具体字段面**：readOnlyHint/destructiveHint/idempotentHint/
   openWorldHint 四提示在 2026-07-28 规范页只写了「annotations 存在且客户端 MUST 视为
   不可信」；具体字段与默认值在 schema.ts（GitHub raw 获取受本机网络限制失败），仓内
   SDK 2.3.1 类型中 `ToolAnnotations` 存在但未逐字段核对——**未核实**。
2. **GitHub「按 PAT scope 自动过滤工具」**：来自 github-mcp-server 仓 docs 的检索摘要，
   未直接打开对应文档页核对原文——**未核实**（方向可信，细节待验）。
3. **宿主客户端对 2026-07-28 的支持矩阵**：Claude Code / ZCode / Cursor 各自当前支持的
   MCP 协议版本（新时代 vs legacy initialize 时代）未逐一实测——直接影响决策点 9。
4. **宿主对 OAuth 资源服务器元数据（RFC 9728）的支持度**：Cursor 等非 Anthropic 宿主的
   OAuth 发现兼容性未实测——影响选项 c 的兼容面。
5. **Plane 托管端点所用协议版本**（2025-11-25 还是 2026-07-28 形态）未查明——只影响
   先例对比的精确性，不影响本仓决策。
6. **MCP registry 收录 remote server 的元数据细目**：docs/41-卡2 已核 preview 期总体
   形态；若未来我们要上架 registry，发布细节（server.json 字段全表）需再核。
7. **A2A 150 组织公告的成员/云平台逐项名单**未核——只用作「分工格局稳固」的方向证据。

---

## 附 · 来源总目（本单新增核实，检索日 2026-10-19）

- MCP 官方规范：specification/latest（版本索引）｜2026-07-28/basic/transports（传输总览）
  ｜…/transports/streamable-http（HTTP 面+Origin/localhost/头镜像/兼容）｜…/changelog
  （2026-07-28 九大改+弃用清单）｜…/basic/authorization（OAuth 2.1/RFC 9728/8707/6750/
  9207/step-up/token 禁令）｜…/server/tools（工具定义/分页/按授权收窄/MUST 限流）｜
  docs/2026-07-28/tutorials/security/security_best_practices（confused deputy/token
  passthrough/SSRF/state handle/scope 最小化）
- GitHub：docs.github.com set-up-the-github-mcp-server（远程端点/OAuth/PAT）｜
  github/github-mcp-server README（toolsets/默认集/--read-only 优先级/Docker stdio）
- YouTrack：blog.jetbrains.com/youtrack 2025-10-28（远程 MCP 官宣）｜jetbrains.com/help/
  youtrack server/model-context-protocol-server.html（端点/三种认证/用户权限投影/tools
  过滤参数/mcp-remote）
- Linear：linear.app/docs/mcp（/mcp 与 /mcp/readonly 端点/OAuth 2.1+DCR/API key/Okta/
  read scope 三路只读）
- Plane：github.com/makeplane/plane-mcp-server README（stdio uvx+托管 HTTP 双端点/30 工具
  207 操作/无 scope 模型）
- A2A：linuxfoundation.org 2026-04-09 公告（150+组织/云平台/企业生产）｜
  agentcommunicationprotocol.dev/about/mcp-and-a2a（互补分工口径）
- 本仓代码（亲读）：packages/panel/src/external/{index,server,views}.ts｜packages/api/src/
  index.ts｜packages/gateway/src/{gateway,wkey}.ts｜packages/studio-tools/src/server.ts｜
  apps/daemon/src/engine/worker-key.ts｜node_modules 内 @modelcontextprotocol/server 2.3.1 dist
  （server/discover、PerRequestHTTPServerTransport、ScopeChallenge 等导出实测存在）
- 本仓文档：docs/45（§二三问原文与状态修订）｜docs/24（AI 接入面三层）｜docs/25（§4.1
  GATEWAY_ACTIONS/§4.2 EXTERNAL_AI_TOOLS）｜docs/02（F2 数据边界）｜docs/41（卡2 registry/
  卡3 A2A）｜docs/43（条款2/条款7）
