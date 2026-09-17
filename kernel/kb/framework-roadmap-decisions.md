# [框架] 路线图与决策记录

> 状态：草稿 ｜ 采集：STUDIO-14，2026-09-17
> 源：studio-daemon/ROADMAP.md、git 提交史（master@ed49a28 时点；2026-09-17 增补至 15cf624）、kernel/intel/、docs/STUDIO-AUDIT.md

## 1. 路线图（studio-daemon/ROADMAP.md）

原则：**简约但不简单**——每期只加"能让循环更快/更稳/更省钱"的东西。

### v1（已交付）
- 确定性状态机（Python 真源 + 修复 B 轨关单缺边）
- pm/qa tick 全代码化：批示解析、DoD LLM 岛、G1 派工、收割 G2、QA 认领-复测-加测、合并尾段
- claude worker：wrap.sh + stream-json 直播落盘、进程组 kill
- 自评引擎：7 日指标 → 异常模式 → STUDIO 内部改进草稿单（元循环）
- FastAPI 仪表盘 :8787（板面/工人/事件/指标/直播流）
- APScheduler（SQLite jobstore，max_instances=1）+ launchd 保活

### v2 候选（已验证可行，按价值排序）
1. YouTrack Commands API（一次原子改多字段/多单 + /assist 预检防幻觉命令）
2. 服务端状态机 workflow（JS）下沉 YouTrack，UI 手滑也拦得住
3. Webhook 事件驱动（近实时循环 + 保留低频对账轮询幂等去重）
4. Epic 拆解 + depends-on DAG（llm.epic_split 已留口）
5. claude 会话续命（--resume 续跑中断 worker）
6. Hooks 熔断（PreToolUse 服务端强制拦 git push）
7. 成本台账（YouTrack work items + events tokens/cost_cny 双轨）
8. Inspector/Scout/版本日官/日报官 吸收为 daemon job（脱离 ZCode 会话依赖）

### 长期
- 自评升级：/api/activities 全量流水 → 真周期时间分布（不止事件计数）
- 多项目泛化：projects.json/roster.json 落地，PID 参数化（P5 第二项目）
- 看门狗四查并入 daemon 自检 job

## 2. 关键决策记录（按时间，来源标注）

| 时点 | 决策 | 依据/留痕 |
|---|---|---|
| 2026-09-15 | 架构 v1：cron 触发的 ZCode 会话当子 PM（子进程/嵌套派工不成立是当时实测约束） | CHARTER.md §0 |
| 2026-09-15 | 平台实证：ZCode 定时任务与会话的绑定关系 | kernel/intel/zcode-cron-binding.md |
| 2026-09-16 | **架构 v2**：执行层切换为独立 `claude -p` 进程（GLM 兼容端点），studio-worker 派发，REPORT 落盘交付；"子进程会话不成立"作废 | kernel/intel/claude-code-worker.md（POLY-11/12 两单实测） |
| 2026-09-16 | **架构 v4（现行）**：studio-daemon Python 常驻承载全部循环，确定性状态机 + LLM 岛 + 自评 + 巡逻 + schema 自进化；旧 ZCode 会话 cron 退役 | kernel/skills/AGENTS.md 头注；sub-pm.md / qa-gate.md 退役标注 |
| 2026-09-16 | 单子知识库 v2：轨道制（A/B/C×23 态）→ **五族分类 × AI 原生状态流 × 影响级别（L0-L3/G1-G4）**；状态=机器事实 | kernel/schema/ticket-types.yaml |
| 2026-09-16 | LLM 岛分级：Flash 小模型管批示解析/DoD/加测，大模型留给重活 | git 7c164fc；批示解析 LLM 化 ee9f75b |
| 2026-09-16 | 首次交叉审核（基石铁律落地）：四硬伤+余项全修三轮收尾；**审核期间制作人同分支提交会漂移基线**的流程教训 | docs/STUDIO-AUDIT.md（STUDIO-11） |
| 2026-09-17 | LLM 岛输出加 Flash 语义审查兜底（reviewed_ask：宁可放过不可误杀）；消毒器分号改分段符+双引号内容保护 | git 094e1ee（STUDIO-12）、18bd758 |
| 2026-09-17 | 制作人评论区批注注入 worker prompt（关键缺口修复） | git ed49a28 |
| 2026-09-17 | **P0 修复**：launchd PATH 缺 ~/.local/bin → 守护进程内 claude 不可达（LLM 岛全灭且静默、worker exit 127 必死）；叠加恒真 gate 误用 `test -f /dev/null`（字符设备恒假）→ 必然 GATE-FAIL 断路。修复：`_claude_bin()` 候选位解析 + 失败限速日志、wrap 脚本写 claude 绝对路径、DIRECTIVE_ALIASES 补口语批准词、dod_gen 明令恒真断言用 `test -e`、plist PATH 前置 ~/.local/bin（bootout/bootstrap 重载） | git 15cf624 |

## 3. 情报库现状（kernel/intel/，采集时点 4 份）

| 文件 | 内容 |
|---|---|
| claude-code-worker.md | 架构 v2 实测记录 + 工程教训（yt gate jq 构造、C locale 变量名、后台 wrapper 模式、路径大小写）+ 成本双轨模型 |
| unity6-lts.md | Unity 6.x LTS 动向速览（STUDIO-3，置信度高） |
| zcode-cron-binding.md | ZCode 定时任务与会话绑定关系实证（架构 v1 考古） |
| scout-topics.md | Scout 题材清单（一行一题，制作人随时改） |

## 4. 已知未决项（采集时点快照）

- dispatch.md 标注：L3 方案先行段"任务书差异化待实现"；Epic 拆解岛"已备未接线"；死循环烧钱的 --max-turns 拉闸"规划中未实现"；教训库"规划中"。
- 预算台账（budget-YYYY-MM）尚未建立（version-day.md 第 3 步提示制作人建立）。
- Inspector/Scout 账号等 token（手册就绪未上岗）。
- studio.json params 节与 daemon config.py 常量双源（见 [global-dev-env-toolchain.md](global-dev-env-toolchain.md)）。

## 源

- /Volumes/BigDisk/Studio/studio-daemon/ROADMAP.md（全 27 行）
- git log master（ed49a28 及此前 15 笔）
- /Volumes/BigDisk/Studio/kernel/intel/*.md、/Volumes/BigDisk/Studio/docs/STUDIO-AUDIT.md
