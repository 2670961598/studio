# AGENTS.md —— 给来这仓干活的 agent（包括你自己）

本仓是 **Studio Next**：一个 AI 公司框架的 monorepo。你是被派来干活的 worker，
这份文件是你醒来时的第一份上下文。读完它再动手。

## 一、这个项目是什么

Studio Next 把「一家公司」建模成代码外部的一个 git 目录（下称**公司目录**），框架负责：
唤起执行体（executor）→ 组装上下文（L0-L5 → AGENTS.md + 任务书）→ 收口流程写入（网关）
→ 收割证据与账目（SQLite 台账）→ 面板与对外 API 呈现。

三条事实源，任何设计不得混淆：

| 事实源 | 管什么 | 谁写 |
|---|---|---|
| YouTrack | 流程流转 + 工作知识 | 只经框架网关（wkey） |
| 公司 git 目录 | 组织 / 人事 / 章程 / 报表 / 提示词片段 | daemon（唯一写入者，挂单 commit） |
| SQLite 台账 | 事件 / 工时 / 成本 / 报表快照——**可重建投影** | daemon |

## 二、目录结构

```
apps/daemon/          唯一常驻进程（Node 24 LTS）：主循环、调度、看护
packages/contract/    契约包：cases.json + JSON Schema + runner（规格测试的唯一标尺）
packages/core/        纯逻辑：状态机 / 主循环决策 / 收割 / 闸门 / 预算 / 断路（零 IO）
packages/store/       node:sqlite + drizzle：schema、migration、快照、重建脚本
packages/yt/          YouTrack 客户端：活动流游标、字段映射、网关凭据
packages/adapters/    executor 适配器：dsh（默认）/ claude / codex / kimi，四原语实现
packages/company/     公司目录：schema 校验、挂载、报表聚合、定时岗调度源
packages/prompt/      L0-L5 组装器 → AGENTS.md + 任务书 + 分层指纹
packages/panel/       Hono：:8787 监控 / :8789 公司概览（<slug> 路由）
packages/api/         Hono：:8788 对外 API（只落单不派工，默认局域网）
templates/            公司目录模板（studio-next init 的脚手架）
docs/                 设计文档库——施工依据，冲突以文档为准
```

## 三、怎么开发

- 依赖：`bun install`（bun workspaces；`workspaces: ["apps/*","packages/*"]`）
- 运行时：**daemon 跑 Node 24 LTS**（原生 type-stripping 直接执行 .ts，不引构建链）
- 类型门禁：`bun run typecheck`（等价 `tsc --noEmit`，根 `tsconfig.json` 覆盖全部包）
- 类型纪律：`strict` + 全量严格开关；**只写可擦除语法**（禁 enum / namespace / 参数属性 / 装饰器）
- 起进程：`bun run daemon`（骨架阶段只打印启动横幅就退出）
- 端口约定：8787 监控（内部）｜8788 对外 API（默认局域网）｜8789 公司概览

## 四、怎么测试

- 统一用 `vitest`：`bun run test`
- 分层：契约测试（`packages/contract`，规格标尺）> 单测（core 纯函数，分支全覆盖）> 集成
  （fake YouTrack + fake CLI harness）> 端到端（真实单据）> 崩溃注入（5 个 kill 点）
- 包级独立：`adapters` / `contract` 有独立测试套，可单独开泳道单独跑——改适配器不碰主循环
- 测试只对**契约与冻结验收口径**负责，不对实现细节负责；不许用 LLM 打桩

## 五、纪律要点（违规即返工）

1. **文档先行**：先有文档、后有代码。实现单必须引用设计文档章节号；实现与文档冲突时，
   **停手改文档**（走批示流），不默许代码漂移
2. **契约测试**：只有契约包说了算。实现可换，契约不随便动；验收命令冻结后禁改
3. **证据断言**：无证据 = 无完成。完成只认落盘证据（终态事件 + 非空输出 + REPORT 落盘 + 闸门 exit=0）
4. **唯一写入者**：每个事实源有且仅有一个写入者（机制保证，不是自律）
5. **不伪造、不隐瞒**：失败如实分类上报；伪造证据是事故
6. **密钥永不入库**；出站内容过密钥扫描；仓库里不得出现本机路径 / IP / 真实凭证
7. **不杀活 worker、不动在途单的泳道**；不 force push、不重写历史
8. **顺序铁律**：抽象 → 文档 → 过审 → 代码 → 测试 → 合并 → 发布，倒序或跳级视为废件
9. **提案流铁律**（20-§十三，核心准则不妥协——**适用于框架本体开发**；框架上开办的公司
   由各自章程自定流程，框架提供本流为可选模板）：重大改动六步——提案→探索→前沿对比→
   方案（含「不做什么」）→独立 workspace 全功能验证 spike→制作人过审，才可立实现单。
   **验证不过=不应用**；「被修到能跑」≠「验证通过」，特判/跳断言/收缩行为一概判负

## 六、先读什么

| 想干什么 | 先读 |
|---|---|
| 搞清方向与施工法 | `docs/07-总纲领与工作方法.md`、`docs/20-工程总规程.md` |
| 看总体设计与选型 | `docs/17-整体技术设计.md`、`docs/16-技术实现与里程碑.md` |
| 动公司目录 / 组织 / 人事 | `docs/04-公司目录与等级体系.md` |
| 动 executor / 状态机 / 调度 | `docs/18-地基-executor包与状态机与调度.md` |
| 动提示词组装 / 身份注入 | `docs/01-需求-公司面.md`（C2 节）、`docs/17-§5` |
| 动台账 / 数据模型 | `docs/02-需求-框架面.md`（F2 节）、`docs/17-§3` |
| 动 YouTrack 对接 | `docs/03-YouTrack-对接方案.md` |
| 搞清职责边界（哪些不做） | `docs/06-职责边界.md` |
