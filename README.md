# Studio Next

Studio Next 是一个 **AI 公司框架**：把「一家公司」建模成代码外部的一个 git 目录，由框架负责唤起
执行体（executor）、组装上下文、收口流程写入、收割证据与账目，让 agent 组成的公司按单据自转。

- **公司 = 目录**：组织/人事/章程/报表/提示词片段全部在公司的 git 目录内，加一家公司 = 加一个目录，零改码
- **框架 = 周边设施**：唤起、配置托管、上下文准备、流程流转、证据收割、台账与监控；执行体内部是黑盒
- **事实源三条**：流程与工作知识在 YouTrack｜组织人事在公司 git 目录｜台账是可重建的 SQLite 投影
- **规矩写在文档里**：设计文档库（`docs/`）是施工依据，代码沿「文档章节号」回溯

## 目录结构

```
.
├── apps/daemon/            # 唯一常驻进程（Node 24 LTS）
├── packages/
│   ├── contract/           # 契约包：cases.json + JSON Schema + runner（规格测试）
│   ├── core/               # 状态机/主循环/收割/闸门/预算/断路（纯逻辑，零 IO）
│   ├── store/              # node:sqlite + drizzle：台账、migration、快照
│   ├── yt/                 # YouTrack 客户端（活动流游标/网关凭据/护栏）
│   ├── adapters/           # executor 适配器：dsh（默认）/ claude / codex / kimi
│   ├── company/            # 公司目录：schema 校验、挂载、报表聚合、定时岗调度源
│   ├── prompt/             # L0-L5 提示词组装器 → AGENTS.md + 任务书 + 分层指纹
│   ├── panel/              # Hono 面板：:8787 监控 / :8789 公司概览（<slug> 路由）
│   └── api/                # :8788 对外 API（只落单不派工，默认局域网）
├── templates/company-2-level/   # 2 级公司目录模板（studio-next init 的脚手架）
└── docs/                   # 设计文档库（施工依据）
```

## Quickstart

> 占位：依赖尚未安装，命令均为目标形态，实现进度见里程碑（`docs/16-技术实现与里程碑.md`）。

```bash
# 1. 安装依赖（bun workspaces）
bun install

# 2. 类型门禁（合同要求：CI 必跑）
bun run typecheck

# 3. 测试（单测 + 契约测试）
bun run test

# 4. 起常驻进程
bun run daemon

# 5. 从模板生成一家公司（目标形态，暂未实现）
bun run studio-next init ./my-company --template company-2-level
```

## 文档

设计文档库在 `docs/`，开工顺序与依据链以 `docs/20-工程总规程.md` 为准：
**抽象 → 文档 → 过审 → 代码 → 测试**，倒序或跳级视为废件。

## 许可

MIT，见 `LICENSE`。
