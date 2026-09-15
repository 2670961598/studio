# 架构 v2：执行层切换为独立 Claude Code 进程（2026-09-16 实装并验证）

来源：制作人指示 + 当晚全流程实测。置信度：高（POLY-11/12 两张真实单走通全链路）。

## 变更

- **执行层**：worker 不再是 ZCode 会话内 spawn 的子 agent，而是 `claude -p --dangerously-skip-permissions` 独立进程（GLM-5.3，端点与 key 在 `~/.claude/settings.json`，由制作人 API key 付费）。
- **监督层**：ZCode 定时任务会话 = 子PM（派发/收割/记账）＋主程（G2 核验）＋主策（DoD 校验）＋全局QA（独立终验）。
- **调度器**：`~/bin/studio-worker`（launch/status/kill/list）——从单据字段机器组装自包含任务书，后台拉起 claude，登记 kernel/workers/<单号>.json；REPORT 文件落盘是"完成"的唯一信号。

## 实测记录（2026-09-16 凌晨）

- POLY-11（C轨文档）：前台路径验证——工人建分支提交 a9d7fa3、心跳×3、REPORT 落盘、冻结验收 exit=0；PM run-gate 复跑 GATE-PASS，推待测试。
- POLY-12（C轨文档）：**全后台 wrapper 路径验证**——派发后 90 秒 DONE，WORKER-EXIT=0，G2 绿，推待测试。
- 两次 QA 终验由 QA cron 自动完成（C轨→已批准）。

## 工程教训（已固化进脚本）

1. `yt gate` 原用字符串拼接 JSON，验收命令含双引号即坏——已改 jq 构造（2026-09-16 修）。
2. bash 在 C locale 下变量名后紧跟全角字符（`$TITLE（`）会被粘进变量名——heredoc 中变量一律 `${VAR}` 写法。
3. 后台拉起必须走**独立 wrapper 脚本**（`nohup bash wrap.sh &`，内含 cd/checkout/claude/退出码落日志）；直接在复合命令里 `nohup claude ... &` 曾出现一次 15 秒静默死亡（无尸检材料），wrapper 模式三连验证稳定。
4. 验收命令里的路径大小写要与仓库实际一致（APFS 大小写不敏感卷会掩盖 `Docs/` vs `docs/` 的错误，换卷即红）。

## 权限与成本模型

- worker 进程对仓库完全读写（--dangerously-skip-permissions），与原 spawn 模式等同；范围红线靠"C轨超范围=升轨 + QA 加测"兜底。
- 成本双轨：监督层（ZCode 会话）走 coding plan 订阅；执行层（claude 进程）走制作人 BigModel API key 按量计费。预算线（budget-YYYY-MM）需把执行层 token 纳入记账口径（events.jsonl 的 tokens/cost_cny 字段）。

## 对宪章的修订（待开内部改进单追认）

- §0 实测约束中"`claude -p` CLI 认证 403（子进程会话不成立）"作废。
- §1 程序/策划/美术 worker 的形态由"被 spawn"改为"独立 claude 进程（studio-worker 派发）"。
- §5 第 7 步派工措辞改为 studio-worker 机器派发。
