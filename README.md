# Studio —— 虚拟软件工作室框架

一个**一人公司**式的 AI 软件开发工作室框架：唯一人类是制作人（opengames），其余编制全部是 AI agent——由常驻 Python 守护进程（studio-daemon）驱动，把 YouTrack 当作「抽象层控制面」（单据、状态机、知识库），把本机文件系统当作「执行层证据面」（锁、报告、门控、记账），实现「状态外置、机器断言、状态驱动」的全自动派工闭环。

> 宪章（唯一事实源）：[CHARTER-V3.md](CHARTER-V3.md)（v1/v2 存档于 `CHARTER.md` / `CHARTER-V2.md`）
> AI 干活守则：[AGENTS.md](AGENTS.md)

## 六条基本法

1. **状态外置**：一切进行态在 YouTrack / 文件里，任何进程崩溃后无损接手。
2. **机器断言**：「完成」只认落盘证据（命令 + 输出 + exit code），不认任何 agent 自述；空证据 = 无证据。
3. **状态驱动**：状态是唯一控制面。派单只看单子当前在什么状态；批注是上下文，不是命令。
4. **一人一公司**：制作人只有一位，所有设计以「最少人工触点」为纲。
5. **两级承包**：一单一 agent 一命；大需求拆单上板，不搞 agent 套 agent。
6. **不浪费**：干活本身不计成本，但一分钱不许多花——见即修。

## 架构组成

```
Studio/
├── CHARTER-V3.md          # 宪章 v3（组织架构制，唯一事实源）
├── AGENTS.md              # 给所有在本园区干活的 AI 的角色约定与守则
├── kernel/                # 组织与状态事实层
│   ├── org.yaml           #   组织架构唯一事实源：部门/人事档案/批干矩阵/渐进启用
│   ├── schema/            #   单型状态机迁移表（ticket-types.yaml，YouTrack workflow 同源）
│   ├── campaigns/         #   长期单（战役）spec：巡逻引擎的大脑（yaml）
│   ├── metrics/           #   记账：events.jsonl（成本/耗时）、runs.jsonl（岗哨）、reports/（日/周/月报）
│   ├── intel/             #   情报档案（worker 手册、主题侦察、绑定方案）
│   └── youtrack-ids.json  #   YouTrack 项目 id 映射
├── studio-daemon/         # 执行层：常驻守护进程 + 驾驶舱 + 全套单元测试
│   ├── studio/            #   24 个核心模块（见下表）
│   ├── tests/             #   pytest 测试套件（290 例，全绿）
│   ├── tools/             #   sandbox-verify.sh（验证闸）、lab-init.sh（实验场）等
│   ├── static/            #   驾驶舱前端（Vue 单页）
│   └── run.sh             #   启动入口
├── docs/                  # 审计报告、组织架构设计、V2/V3 决策记录
└── projects/              # 各项目工作区（gitignore，不入框架仓；如 GAMES 游戏平台）
```

### studio-daemon 核心模块

| 模块 | 职责 |
|---|---|
| `daemon.py` | 入口：APScheduler 装配 + uvicorn 仪表盘；支持 `run` / `tick <岗>` / `board` 子命令 |
| `orchestrator.py` | 五族分类 × 级别流的确定性状态机：已派发 / 证据就绪 / 复验通过 / 已交付 |
| `workers.py` | Claude Code 工人进程管理：组装自包含任务书 → `claude -p --output-format stream-json` 直播落盘 |
| `statemachine.py` / `ytguard.py` | 框架侧状态机 + YouTrack 平台级状态 guard（双保险，三层同禁越表迁移） |
| `ytgw.py` | YouTrack 执行体网关：agent 用 YouTrack 必经框架（wkey 白名单：comment/heartbeat/article） |
| `gates.py` | 冻结验收执行器：跑冻结验收命令，证据 JSON 落盘 |
| `approval.py` / `orggov.py` | 批示解析与组织架构治理引擎（批/干错位一格、联签、派单人终验收） |
| `patrol.py` | 战役巡逻引擎：定时巡逻 → LLM 推理 → 孵化子单 |
| `evolve.py` | 知识库/规则自进化：提案 → 制作人 approve → 沙箱验证 → 应用 |
| `steward.py` | 管家岗哨：在途单证据自动校验 + 终验提醒 |
| `supervise.py` | 健康巡检（只读、确定性、不调 LLM） |
| `reports.py` | 日报/周报/月报：落盘事实生成，正文入 YouTrack Articles |
| `metrics.py` / `runs.py` | 记账与岗哨记录（duration_ms / tokens / cost 全接线） |
| `web.py` | 运维驾驶舱 API（默认 8787 端口）：板面快照、agent 状态、证据链下载、敏感值脱敏 |
| `llm.py` | LLM 调用封装（消毒器：防提示注入直达 shell） |
| `signoff.py` / `screen_words.py` | 署名协议与门控危险词过滤 |

## 工作原理

### YouTrack 接线（抽象层）

- YouTrack 跑在本机（`127.0.0.1:8080`），承载**单据与流程**：需求单 / bug 单 / 知识单 / 探索单 / 长期单 / merge 单 / 内部改进单七族状态机（`kernel/schema/ticket-types.yaml` 同源生成平台 workflow）。
- 每个项目一条泳道，daemon 按项目错峰轮询增量活动流（如 POLY 0 分位、STUDIO 4 分位、GAMES 7 分位）。
- agent 不直接操作 YouTrack：一切执行体动作经 `ytgw` 网关（白名单 + 署名注入 `[项目·个体名·部门]` + 事件记账），平台级 `ytguard` 与框架 `statemachine` 双保险禁越表迁移。
- 知识库 = YouTrack Articles，按项目分区；干活 agent 不直接写，由长期单定时整理入库。

### 守护进程调度（执行层）

- `run.sh`（launchd KeepAlive 拉起）启动 APScheduler：pm 岗按项目错峰每 10 分钟轮询板面派工；治理族岗（self-eval / patrol / evolve / 报告）按宪章节奏运行；全部 `max_instances=1` 防自身重叠。
- 环境变量支持实验场隔离：`STUDIO_ROOT`（换 kernel 状态根）、`STUDIO_PORT`（默认 8787）、`STUDIO_PROJECTS`（限定项目）、`STUDIO_GOVERNANCE=0`（关治理岗防双写生产板）。

### worker 派发闭环

1. **状态即触发**：单子进入某状态 → daemon 派对应角色，任务书注入全量上下文（流转史、批注、冻结验收口径、知识库文章、历史教训），agent 自行决定如何推进。
2. **预查闸**：派工前先派 Flash 小模型做预查（严格 JSON `{pass, reason}`），不过则不开始。
3. **预算帽**：单次派工带 `--max-budget-usd` 与 45 分钟看门狗；全程记账入 `events.jsonl`。
4. **完成只认证据**：worker 落盘 REPORT + gate 跑冻结验收命令；QA 内联复验；merge 由快速模型执行，冲突复杂自动开 merge 单交主力模型。
5. **验证闸**：一切框架改进先在独立临时目录沙箱验证（`tools/sandbox-verify.sh`：补丁可应用 + 测试全绿 + 针对性验证），杜绝一拍脑袋。

## 使用方法

### 启动守护进程

```bash
cd studio-daemon
./run.sh                      # 常驻模式（launchd 与手动共用入口）
# 或调试/冒烟：
.venv/bin/python -m studio.daemon board          # 打印板面快照
.venv/bin/python -m studio.daemon tick pm        # 手动跑一次 pm 岗
```

驾驶舱：浏览器打开 `http://127.0.0.1:8787`（agent 运行状态、定时任务、证据链）。

### 跑测试

```bash
cd studio-daemon
.venv/bin/python -m pytest tests/ -q
```

当前基线：**290 passed**（全绿，零 LLM 打桩）。

### 凭证配置（不入库）

守护进程读取 `~/.config/polymatch3/youtrack.json`（YouTrack url + admin_token + 各 agent token，文件权限 600，已被 `.gitignore` 与架构红线双重排除，**绝不入仓**）。面板令牌经环境变量 `STUDIO_PANEL_TOKEN` 或首用自动生成持久化到凭证目录。

## 许可证

[MIT](LICENSE) © 2026 Ye QingXin
