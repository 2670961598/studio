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
│   ├── panel/              # Hono 面板：:8791 监控 / :8789 公司概览（<slug> 路由）
│   └── api/                # :8788 对外 API（只落单不派工，默认局域网）
├── templates/company-2-level/   # 2 级公司目录模板（studio-next init 的脚手架）
└── docs/                   # 设计文档库（施工依据）
```

## Quickstart

以下命令在仓内均可直接跑通（现状即所得；未接线面的诚实清单见 `apps/daemon/src/assembly/serve.ts` 头注）。

```bash
# 1. 安装依赖（bun workspaces；daemon 跑 Node 24 LTS——原生 type-stripping 直跑 .ts）
bun install

# 2. 类型门禁（合同要求：CI 必跑）
bun run typecheck

# 3. 测试（边界门禁 + 单测 + 契约测试）
bun run test

# 4. CLI 命令面（全命令清单；单命令 -h/--help 看分面；--version 看版本）
bun apps/daemon/src/cli/main.ts --help

# 5. 从模板生成一家公司（<slug>=小写字母/数字/连字符，如 my-company；--template 收模板
#    目录路径，缺省仓根 templates/company-2-level——不是模板名）
bun apps/daemon/src/cli/main.ts init my-company

# 6. 一条命令创建并接线一家公司（init→provision→建号→jobs→插件→报告→daemon.yaml 骨架，
#    幂等；studio-dev-103 S4A）
bun apps/daemon/src/cli/main.ts company create my-company

# 7. 起常驻主循环（七相位引擎；配置样例内嵌于 serve --help——company create 已顺产骨架）
bun apps/daemon/src/cli/main.ts serve --config var/daemon.yaml
```

> 注：`bun run daemon` 仍是骨架占位（横幅即退）——常驻进程走上面第 7 步的 `serve`；
> CLI 入口 `apps/daemon/src/cli/main.ts` 亦即 package.json bin `studio-next` 的落点。

## 文档

设计文档库在 `docs/`，开工顺序与依据链以 `docs/20-工程总规程.md` 为准：
**抽象 → 文档 → 过审 → 代码 → 测试**，倒序或跳级视为废件。

## 许可

MIT，见 `LICENSE`。
