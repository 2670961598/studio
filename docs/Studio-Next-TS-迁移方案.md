# Studio Next · TypeScript 迁移方案（呈批稿）

> v1.0 ｜ 起草：Kimi（主 PM）｜ 2026-10-15 初稿，10-16 修订
> 缘起：制作人 2026-10-15 提议——转 TypeScript + 打包工具，新建目录从零开发。
> 「先定方案与前沿调查，单子与执行后议」。
> 依据：5 路前沿调研（2026-10-15）+ 蓝图 v1.4 + 十视角复查（2026-10-16）。
> **v1.0 修订（制作人 2026-10-16 定调）：新栈与既有实现零兼容义务——只继承思路与进化路线，
> 不继承任何代码与实现细节。** 由此：①"既有测试语料对等共跑"降级为"契约包=新系统规格测试"
> （不以任何既有行为为标尺）；②影子双跑对等取消，切换=一次性切权+回滚预案；③存量数据
> （events/工时单等）改为**归档导入**（进 SQLite 供查询），不是兼容义务；④YouTrack 实例
> 与单据流是共享基础设施、照常延续，不属于"兼容"问题。
> 本文件批准前不产生任何执行力。

---

## 1. 主 PM 意见：有条件赞成

**方向赞成，但赞成的理由需要校正，方式需要约束。**

**先把一个说法证伪**：「Python 做这个已经慢慢被抛弃」——**不成立**。
Stack Overflow 2026 调查 AI 用语言 Python 39% 居首；微软 Agent Framework 1.0（2026-04 GA）
首发 Python+.NET；LangGraph/CrewAI/Temporal Python 全在活跃线。Python 没有退场。

**但转 TS 的三个真实理由是成立的**：
1. **生态同栈**：CLI/harness 层确实是 TS 的世界——dsh、gemini-cli、opencode、MCP 官方
   TS SDK（周下载 76.7M）。我们的 V5 适配器层要和这些工具深度互操作，同语言成本最低
2. **分发形态**：宪章 §12.7 分布式路线（多 NUC）需要"一个文件扔过去就跑"——
   `bun build --compile` 单文件可执行是目前最成熟的方案，其他语言栈没有对等物
3. **AI 编码亲和**：GitHub Octoverse 2025 官方归因——TS 成为平台第一语言，因为
   "typed languages make agent-assisted coding more reliable in production"。
   我们的代码 100% 由 agent 写，类型系统是免费的护栏

**三个约束条件**（少一个我都不赞成）：
- **约束一：不做 big-bang 重写。** 前沿调研里唯一"从零重写成功"的一手复盘（ACM Queue 2026-04）
  靠的是：parity 当设计约束、数据走 export/import 契约、旧客户最后迁移、硬性时间底线。
  失败红旗清单第一条就是"语言+架构+基础设施一起换"——我们必须用切片纪律对冲
- **约束二：daemon 跑 Node LTS，不跑 Bun。** Bun 1.4 的 node:child_process 兼容仅 105/116
  （我们的核心负载正是子进程编排），且长驻服务有 Prisma 生产事故前科（内存泄漏/连接池死锁）。
  Bun 只做开发加速与打包器，核心层禁用 Bun 专有 API
- **约束三：上线前实现冻结是正确的，但冻结语义要说清**——冻结期只修 P0 级 bug，
  新功能全部去新栈；冻结期越长修复积压越多，所以切片节奏要快

---

## 2. 目标形态：Studio Next（TS 新栈）

**新目录**：独立仓（框架代码与公司目录彻底分离；
对外发布时进 GitHub 新仓，沿用 public+MIT 与 §10 公私边界）。

**Monorepo（bun workspaces + catalog，不引 turbo/nx）**：

```
studio-next/
├── apps/
│   └── daemon/            # Node 24 LTS 长驻（唯一常驻进程；Node 26 转 LTS 后跟进）
├── packages/
│   ├── contract/          # 语言无关契约：cases.json + 双 runner + JSON Schema（§4）
│   ├── core/              # 状态机/调度/收割/闸门/记账（纯逻辑，零 IO 依赖）
│   ├── adapters/          # executor 适配器：claude/kimi-code/dsh/codex（V5 四原语）
│   ├── yt/                # YouTrack 客户端 + 活动流轮询
│   ├── store/             # node:sqlite + drizzle（WAL、migration、快照）
│   └── panel/             # Hono + SSE 面板（/company 页落这里）
└── .nvmrc + engines 钉死
```

**包职责**：core=调度/状态/收割、adapters=CLI 调用层、yt=平台对接、store=台账、
panel=面板、api=对外 API、contract=契约与规格测试。

## 3. 运行时与生态选型（调研结论，一句一项）

| 项 | 选型 | 理由（信源 §8） |
|---|---|---|
| daemon 运行时 | **Node 24 LTS**（Node 26 于 2026-10-28 转 LTS 后跟进） | 长驻进程最稳；Bun 子进程兼容最弱 |
| TS 执行 | Node 原生 type-stripping + `tsc --noEmit` 门禁；开 `erasableSyntaxOnly`（禁 enum/namespace/decorator） | 2026 工具链换代窗口（TS 7 Corsa），不锁 bundler |
| SQLite | **node:sqlite**（RC，零原生依赖）+ **drizzle** migration | Bun 已 18/18 通过其测试，双运行时兼容 |
| 调度 | **自建 SQLite 调度表**（next_run_at/last_run_at，启动扫 due 槽补跑）+ croner 只做表达式解析 | 没有任何库实现 APScheduler 的 misfire 补跑语义（实锤） |
| 状态机 | **自研表驱动 FSM + zod 校验** | 状态外置本来就是表驱动；不引 xstate |
| schema 校验 | **zod 4** | 稳定、Standard Schema 收敛 |
| 面板 | **Hono（streamSSE，Node 上跑）** | SSE 单向推 worker 流，浏览器自动重连；不用 WebSocket |
| 子进程 | **execa**（`killDescendants:true` + `forceKillAfterDelay`） | 唯一内建进程组杀法；禁裸 exec |
| 打包分发 | 需要时 **bun build --compile**（产物跑 Bun，仅分发场景） | 四方案中最成熟，支持交叉编译 |
| MCP | 锁 **v2 线**：新包 `@modelcontextprotocol/server|client`@2.x（spec 2026-07-28 stable）；旧包 `sdk`@1.32.x = legacy v1 线（实测 npm 官方源 2026-10-16） | 复查更正后定稿 |

**协议蓝本（重要）**：抄 **Codex App Server** 的 JSON-RPC 模型——thread=YouTrack 单、
turn=一次派工、item 带 started/delta/completed 生命周期、**审批=服务端发起的请求**。
我们的状态外置模型与它天然同构。协议先行、生成客户端（学 opencode 的 OpenAPI→SDK），
面板/worker/网关都是协议客户端。Cordis 只借思想（service+inject+可逆 effect），
不引其库（API 未稳定）。

## 4. 迁移策略：契约先行 + 切片绞杀 + 一次性切权

> v1.0 修订（2026-10-16）：本节按"零兼容"重读——契约包保留但定位改为**新系统的规格测试**
> （不以既有行为为标尺）；既有测试不做对等翻译，只做可复用资产盘点；**影子对等双跑取消**；
> 切片顺序保留；切权=一次性停机切换+回滚预案（上线前实现冻结态可随时拉回）。

**第 0 步 · 契约冻结（一切的前提）**
我们最大的资产是状态全部外置（YouTrack+文件）。把 **YouTrack 写入格式 + 文件产物格式
+ SQLite schema 定义成版本化、语言无关的互操作契约**（JSON Schema 描述）——
任何实现栈都只是同一契约的客户端。台账尚未落地，
现在正是定约成本最低的时间窗。

**既有测试语料的处置（不逐条翻译）**：
- 纯算法/纯函数 → 抽成**语言无关语料**（cases.json：稳定 id + 恰好一个 in + out/err，
  `__NULL__` 哨兵消歧），**一份语料 + vitest runner** 为主；既有测试 runner 仅用于可复用资产盘点（非对等证明）
- 依赖 CLI/YouTrack/LLM 的 → 转**黑盒契约测试**（输入=票面/事件，输出=外部可观测动作：
  YouTrack 写入、worker 命令、面板响应），golden trace 录音回放
- parity 指**行为等价**，不是测试用例 1:1 映射（JPMorgan Codex 移植论文同此结论）
- 迁移执行本身交给 worker（Airbnb LLM 流水线：状态机推进+错误回灌+机器状态戳，
  3.5K 测试 6 周 97%——这正是我们公司最擅长的活）

**切片顺序（strangler，每片 expand→migrate→contract，contract 未完成不准合并）**：
1. 契约包 contract（cases.json 双 runner 跑通）
2. 面板 panel（Hono 只读复刻 8787，可灰度回滚）
3. 一个定时岗（最简单的 supervise 巡检岗）
4. 其余 14 岗 + SQLite 调度表
5. orchestrator 主循环（派单/收割/合并）
6. LLM 岛 + 网关 ytgw
7. 全量切权，上线前实现退役进归档

**切片切权（v1.0 零兼容版）**：新栈不走影子对等；每切片以契约测试+沙箱验证+崩溃注入为准入；
全量切权=一次性停机切换 + 冻结态作回滚预案（冻结不动，随时可拉回）。

## 5. 验收口径（go/no-go）

1. contract 套件在 TS 新栈全绿（既有测试侧仅作资产盘点参考）
2. shadow 对照零分歧连续 3 天（每切片）
3. 崩溃注入回归集全绿（5 个 kill 点，蓝图 §4.7）
4. 端到端：一票真实单据在新栈走完 新单→派发→证据→合并→关单
5. **时间盒**：第 1-3 切片（契约+面板+首岗）两周内端到端跑通；跑不通则回到本方案重议，
   不硬推

## 6. 风险清单（诚实陈列）

| 风险 | 等级 | 对冲 |
|---|---|---|
| 第二系统效应（重写陷阱） | 高 | 切片纪律 + contract 合并闸 + 时间盒（§4/§5） |
| node:sqlite 仅 RC 非 stable | 中 | 封装隔离；备选 better-sqlite3 一行切换 |
| TS 工具链换代窗口（TS 7/bundler 未定） | 中 | Node 原生 type-stripping 起步，bundler 后定 |
| 冻结期修复积压 | 中 | 冻结只修 P0；切片快节奏；在途单先收官 |
| 迁移并行期双份依赖/补丁/观测 | 中 | 切片快速推进，不许长期并存 |
| Bun 生态风险（Anthropic 单一持有+Rust 重写） | 低 | 核心不碰 Bun 专有 API，Bun 只当工具 |
| claude -p 计费口径变更（2026-06 Agent SDK credit 分离） | 待核实 | 另开单核实，与本方案独立 |

## 7. 与蓝图 v1.4 的关系

蓝图（V4 公司架构/V5 适配器/V6 自进化/V7 对外存在）的**设计全部不变，变的是实现栈**：
- V4a SQLite 台账直接在 Studio Next 的 store 包落地（schema 即契约）
- V5 适配器协议以 TS 为参考实现（四原语不变；dsh 接入同栈红利直接兑现）
- 身份注入包/人事台账/监控两面等公司层设计，在 panel 包与 store 包中实现
- 上线前实现冻结：只修 P0；在途单收官后进入维护态

## 8. 信源（前沿调研 2026-10-15，五路）

- Python 地位：SO 2026 调查；microsoft/autogen README；MAF 1.0 GA；LangGraph/CrewAI/Temporal releases；GitHub Octoverse 2025（TS 登顶的官方归因）
- 运行时与打包：Node 发布日程与 SEA 文档；Bun 1.4 博客（兼容表实锤 child_process 105/116）；Prisma Compute 生产复盘；Rolldown 1.0；tsup 维护态
- harness 架构：OpenAI Codex App Server 官方博客与仓库；dsh/Cordis 文档；gemini-cli hooks 文档（fail-open 坑）；opencode server/SDK；Claude Code headless 文档与 issue #25180/#53584；MCP TS SDK README
- 迁移纪律：ACM Queue 2026-04 重写复盘；Fowler ParallelChange；Airbnb LLM 测试迁移；voxgig 语言无关测试语料；arXiv 2604.11518（Codex Rust→Python 移植，parity≠1:1）；RepoMirror 一夜移植实录；Why Big Rewrites Fail 红旗清单
- 生态选型：node:sqlite 文档（RC）；SQG 驱动 benchmark；croner/node-cron 文档；APScheduler userguide（补跑语义）；execa termination 文档

**待核实标注**：Node SEA stability 等级；TS 7 GA 时间（来源冲突）；drizzle-kit 在纯 node:sqlite 下是否仍需 better-sqlite3；claude -p 计费变更口径。

---

## 9. 待制作人拍板

1. 总体方向：TS 新栈 + 三约束（不 big-bang / Node 跑 daemon / 上线前实现冻结语义）——是否认可
2. Studio Next 落点：独立仓（框架代码与公司目录分离）+ 新泳道——是否认可
3. 时间盒：首三切片两周端到端，跑不通回议——是否认可
4. 蓝图 v1.4 是否同步升级为 v1.5（实现栈段落改写）——建议批准后由我执行
