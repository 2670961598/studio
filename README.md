# Studio Next

Studio Next 是一个面向 AI Agent 组织的运行时框架。

它把「一家公司」建模为受版本控制的公司目录，由常驻 daemon 负责调度、派发、执行、验收与记账；执行体（DSH、Claude Code、Codex、Kimi 等）可替换，组织、流程与记录是持久资产。

> 当前状态：V2 规范已于 2026-10-30 定稿（tag `v2-final`）。核心框架进入生产化收尾阶段：V2 定稿基线为 106 个测试文件、1583 条用例全绿；真实运行验证、安全加固与平台适配仍在推进。

## 目录

- [它解决什么问题](#它解决什么问题)
- [核心设计](#核心设计)
- [架构](#架构)
- [关键能力](#关键能力)
- [仓库结构](#仓库结构)
- [快速开始](#快速开始)
- [验证](#验证)
- [当前状态与边界](#当前状态与边界)
- [文档](#文档)
- [项目沿革](#项目沿革)
- [贡献](#贡献)
- [License](#license)
- [联系](#联系)

## 它解决什么问题

单个 Agent 可以完成一个任务，但很难独立承担一条持续运转的业务链路。真实公司需要的不只是「更聪明的执行者」，还包括：

- 谁有权发起、谁负责执行、谁验收；
- 任务如何拆解、派发、续跑与回收；
- 产出如何留证、审计、回滚；
- 成本、权限、并发与失败如何处理；
- 人员或执行体更换后，组织知识如何保留。

Studio Next 将这些内容从「提示词约定」变成可运行、可检查的机制：公司目录承载组织与制度，台账承载事实与账目，daemon 承载运行，执行体只负责执行。

## 核心设计

1. **公司即目录**
   公司是一个 git 目录：`org-config.yaml` 定义组织，`charter.md` 定义章程与红线，`departments/` 保存部门与人事档案，`reports/` 保存产出，`.AIWS/` 保存员工工作区。组织与制度可审查、可迁移、可回滚。

2. **三条事实源，各自唯一写入者**
   - 协作平台：只经框架网关写入；
   - 公司 git 目录：daemon 是唯一写入者；
   - SQLite 台账：daemon 写入，可重建投影。

3. **执行体可替换**
   DSH（DeepSeek Harness）是默认执行体，同时适配 Claude Code、Codex、Kimi 等。执行体是劳动力，组织与流程才是持久资产。

4. **交付靠流程与证据，不靠「不犯错」**
   任务从建单、派发、执行、验收、复验到合并，形成完整链路；验收命令真实执行，关键结果落台账；失败必须显式分类，不允许静默降级。

5. **可自优化、可自恢复**
   框架包含自优化守护与自主存活设计：提示词、岗位、工作面、插件与前沿对比可定期审计；守护核、分层存活与自修复阶梯用于降低长期运行风险。

## 架构

```text
┌──────────────────────── 一家公司（一个 git 目录）────────────────────────┐
│ org-config.yaml   组织：部门 / 岗位 / 等级 / 定时岗 / 类型流               │
│ charter.md        章程与红线                                              │
│ departments/      部门与人事档案                                          │
│ reports/          部门产出物（报表 / 巡逻 / 审计）                         │
│ .AIWS/            员工工作区（按单建工位，家保留归档）                     │
└───────────────────────────────────────────────────────────────────────────┘
          ▲ 挂载 / 指纹监听                  ▼ 事件 / 收割 / 账目
┌──────────────────────────── daemon（常驻进程）───────────────────────────┐
│ 主循环七相位：采集 → state-diff → 派发 → 收割 → 合并 → 回收 → 落账        │
│ 治理面：断路器 / 泳道租约 / 人闸 / 意图幂等 / 验收闸门 / 写者围栏          │
└───────────────────────────────────────────────────────────────────────────┘
          ▼ 派发（任务书 = 目标 + 冻结验收 + 文档引用 + 开工自检）
┌──────────────────────────── 执行体（可替换）─────────────────────────────┐
│ dsh / claude / codex / kimi                                                │
│ 工位沙箱（seatbelt 写域 / 网域圈定）· 会话续跑 · 证据四要件                 │
└───────────────────────────────────────────────────────────────────────────┘
```

一次典型交付：

```text
建单 → daemon 评估 → 工位派发 → worker 执行 → 真实验收 → 复验
     → 验收位批示 → 合并交付 → 台账落账
```

## 关键能力

- **组织建模**：部门、岗位、职级、任免、定时岗、类型流；
- **任务运行**：建单、意图去重、工位派发、会话续跑、在途接管、回收；
- **质量与证据**：冻结验收命令、证据四要件、复验、批示链、失败分类；
- **安全与权限**：网关写入、写者围栏、seatbelt 写域/网域、秘密扫描；
- **运行观测**：SQLite 台账、监控面板、公司概览、只读 API；
- **平台适配**：Taiga、YouTrack、LocalFile、Matrix 等接入面；
- **自我维护**：自优化轨道、自主存活阶梯、灰度切换与复盘。

## 仓库结构

```text
apps/daemon/        常驻进程：engine / control / evolve / cli
apps/boot/          Matrix 等外部装配的组合根
packages/contract/  契约：cases.json、JSON Schema、runner
packages/core/      纯逻辑：状态机 / 主循环决策 / 收割 / 闸门 / 预算 / 断路
packages/store/     node:sqlite + drizzle：schema / 迁移 / 快照 / 重建
packages/taiga/     协作平台客户端：活动流 / 字段映射 / 网关凭据
packages/adapters/  执行器适配：dsh / claude / codex / kimi
packages/company/   公司目录：schema 校验 / 挂载 / 报表 / 定时岗
packages/prompt/    L0-L5 组装器 → AGENTS.md + 任务书 + 分层指纹
packages/panel/     Hono 面板：监控与公司概览
packages/api/       对外 API（gated-only）
packages/matrix/    Matrix 源 / 通知 / 房间 / 人事面
templates/          公司目录模板（2-9 级 + 行业模板）
docs/               设计与施工文档（docs/v2、docs/plan 等）
```

## 快速开始

环境要求：Node.js 24+、bun、Git。

```bash
# 安装依赖
bun install

# 类型检查与 V2 套件
bun run typecheck
bun run verify:v2

# 创建一家公司（init + 建号 + 建库 + 播种定时岗）
node apps/daemon/src/cli/main.ts company create my-company \
  --template templates/company-3-level

# 启动 daemon
bun run daemon -- --config my-company/var/daemon.yaml
```

其他入口：

```bash
node apps/daemon/src/cli/main.ts --help        # CLI 全命令
node apps/daemon/src/index.ts --help           # daemon 入口
node apps/daemon/src/cli/main.ts serve --help  # serve 配置项
```

端口约定：

- `8791` 监控面板
- `8788` 对外 API（默认只落单、不派工）
- `8789` 公司概览

## 部署形态（运行代码隔离）

> 2026-11-04 事故后确立（ref=708，完整设计见 `docs/90-§六`）：**主工作区只用于施工、可以脏；
> 运行中的 daemon 只执行「部署树」里的已提交/已验证代码**——任何重启（含守护核自动拉起）都不会加载工作区未提交改动。

- **部署树**：主仓之外的独立检出，固定在已验证 commit。首次准备（一次）：
  `git clone --no-checkout <主仓路径> <部署树路径>` → `git -C <部署树路径> checkout --detach <已验证 commit sha>`
  （`--no-checkout` 后索引为空、`git status` 会显示全部文件 staged deletions，属预期态；**必须先显式 checkout 一次**，
  否则 `deploy` 会按「部署树不干净」拒绝。此后禁止手工 checkout/pull，一律走 `deploy.mjs`）。
  依赖在部署树内 `bun install --frozen-lockfile`（不同步主工作区 `node_modules`，避免 workspace 软链指回主工作区）。
- **部署**：`node scripts/ops/deploy.mjs deploy --repo <主仓路径> --deploy <部署树路径> --ref <已验证 commit sha>`
  （checkout→tree digest 校验→依赖→`launchctl kickstart` 重启守护核→`/healthz` 验证→落 `deploy-state`）。
- **兜底**：guardian 起 daemon 前跑 `deploy.mjs check`（`daemon.preflight`）；部署树不干净/HEAD 漂移/digest 不符/依赖缺失 →
  **拒绝启动**（fail-closed，`preflight-failed` 告警重试）。
- **回滚**：同一命令 `--ref <上一 commit sha>`（不重写历史）。
- launchd 安装、部署与演练步骤见 `ops/launchd/README.md`；多公司（如 studio-profit）部署形态见 `docs/90-§六 6.8`。

## 验证

```bash
bun run typecheck       # 源码类型检查
bun run typecheck:v2    # V2 套件类型检查
bun run verify:v2       # 边界 + 类型 + V2 测试 + manifest + 旧测试台账
bun run verify:docs     # V2 文档一致性检查
bun run guard:boundaries
```

V2 定稿时基线：`106` 个测试文件、`1583` 条用例通过，tag `v2-final`。

## 当前状态与边界

- V2 规范已定稿（`v2.1-final`），F8 / DSF 复查已通过；
- V2 门禁与文档门禁可复算；
- 真实生产运行仍在收尾，以下能力尚未宣称完成：
  - seatbelt 内核实际拦截（PRB-04 未执行）；
  - API 触发认证与部分只读数据源；
  - OPS 实际执行面（当前以记录为主）；
  - PB-3 / PB-5 探针；
  - 真实 Matrix / Taiga 实例的写路径验证。
- 旧测试（V2 开工前）只作观察位，不属于 V2 门禁。

因此：**适合本地运行、研究与二次开发；不建议直接作为无人值守的生产系统。**

## 文档

| 内容 | 位置 |
|---|---|
| V2 规范（18 卷） | `docs/v2/` |
| 施工方案与实现单 | `docs/plan/` |
| 制作人决策与裁决 | `docs/49-制作人决策包.md` |
| 工程总规程与分层宪法 | `docs/20-工程总规程.md` |
| 自主存活架构 | `docs/90-自主存活架构.md` |
| 自优化守护程序 | `docs/88-自优化守护程序.md` |
| 验证矩阵与追溯 | `docs/v2/17-验证矩阵与追溯.md` |

## 项目沿革

```text
AutoAgent（2026，Python / MCP 原型）
    → Studio（v3）
    → StudioNext（V2，TypeScript / DSH 运行时）
```

- AutoAgent：<https://github.com/2670961598/autoagent-framework>
- Studio Next：<https://github.com/2670961598/studio>

## 贡献

欢迎提交 Issue 与 Pull Request。开始前请先阅读：

1. `docs/20-工程总规程.md`（分层宪法与门禁）；
2. `docs/v2/` 中对应主题卷；
3. `docs/plan/04-测试与验收策略.md`（测试口径）。

要求：

- 不伪造证据，不静默降级；
- 不修改冻结验收命令与契约工件；
- 代码变更需通过类型检查、边界门禁与 V2 套件；
- 文档与实现冲突时，先走文档修订，不默许代码漂移。

## License

MIT

## 联系

- 作者：叶青鑫
- Email：yeqingxin@mail.nwpu.edu.cn
- Email：yeqingxin0126@foxmail.com

欢迎就 AI Agent 组织、运行时治理、公司目录与交付验证等方向交流。
