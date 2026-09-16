# [全局] 本机开发环境与工具链

> 状态：草稿 ｜ 采集：STUDIO-14，2026-09-17 ｜ 层：机器级（macOS Darwin 25.3）
> 敏感值（token/password/端点 URL）已脱敏，只记结构与用途。

## 1. Claude Code 运行环境

- 执行层 = 独立 `claude -p` 进程（GLM 兼容端点，端点与 key 由 `~/.claude/settings.json` 注入，**值不记录**）。
- `~/.claude/CLAUDE.md`：**不存在**（采集时点）——本机未设 Claude Code 全局约定文件，详见 [global-agents-spec.md](global-agents-spec.md)。
- 工人以 `--dangerously-skip-permissions` 运行，对仓库完全读写；范围红线靠"C 轨/L0 超范围=升轨 + QA 加测"兜底（源：kernel/intel/claude-code-worker.md）。

## 2. ~/bin/ 工具脚本清单

| 脚本 | 用途 | 关键行为 |
|---|---|---|
| `~/bin/yt` | YouTrack 命令行助手 v2（多项目/分轨/断言） | 账号用 `YT_ACCT` 切、项目用 `-P` 切；`list/get/new/next-state/attempt/gate/heartbeat/comment` 等；`next-state` 按（轨道×类型）迁移矩阵校验，违规拒绝 |
| `~/bin/run-gate` | 冻结验收命令执行器（唯一可信的"完成"判定） | 读单据"验收命令"字段，在泳道仓库当前工作区执行，证据落盘 `kernel/evidence/<PID>/<单号>-<attempt>.json/.log`；退出码即闸门结论 |
| `~/bin/studio-lock` | 工作室目录锁 v2（tick/泳道/QA 通用） | `mkdir` 原子获取 + TTL 新鲜度 + 显式 release + `beat` 续期；锁目录 `kernel/locks/`；v2 修复了 v1 瞬逝 pid 与 TOCTOU 竞态 |
| `~/bin/studio-worker` | Claude Code 工人进程调度器（架构 v2 执行层） | `launch/status/kill/list`；从单据字段机器组装自包含任务书，后台拉起 claude，登记 `kernel/workers/<单号>.json`；REPORT 落盘是"完成"的唯一信号 |
| `~/bin/studio-clean` | 工作区清扫/隔离 | 只处理**无锁脏树**：stash 进隔离区 + hard reset + clean（保护 Library/Logs/Temp/obj/Build 等）；有锁不动，记 `quarantine.log` |
| `~/bin/studio-daemon-launch.sh` | daemon 看护循环（launchd 入口） | bash while 循环拉起 `python -m studio.daemon run`；健康检查 `/api/state` 连续 3 次失败 → `kill -9` 重启（详见 [framework-deploy-ops.md](framework-deploy-ops.md)） |
| `~/bin/github-hosts-fix.sh`（+ `-install.sh`） | 无 VPN 修复 GitHub 访问 | 从官方 IP 池实测选可达 IP，幂等写 `/etc/hosts` 标记块（环境辅助，非工作室循环部件） |

## 3. ~/.config/polymatch3/ 工作室配置结构

### youtrack.json（token 分文件收敛，chmod 600）
```
{ url: <REDACTED>,
  admin_token: <REDACTED>,            # 仅本机交互/守护操作使用
  agents: {                            # 每账号：id / ringId / password / token（全部 <REDACTED>）
    agent-core, agent-game, agent-qa, agent-pm } }
```
在册 agent 账号 4 个（core/game/qa/pm）；worker 身份 agent-dev/designer/artist/inspector/scout 的账号与 token 按需增补（上岗流程见 kernel/skills/AGENTS.md"新账号上岗"节）。

### studio.json（工作室运行配置）
```
{ lanes: {                            # 泳道 = 仓库+base分支+账号
    core:   { path: /Volumes/BigDisk/UnityProject/MatchThree/Match3, base_branch: main,     yt_acct: agent-core },
    game:   { path: /Volumes/BigDisk/UnityProject/Match-GLM/Match3,   base_branch: game/main, yt_acct: agent-game },
    studio: { path: /Volumes/BigDisk/Studio,                          base_branch: master,   yt_acct: agent-pm } },
  qa: { yt_acct: agent-qa }, pm: { yt_acct: agent-pm }, producer: { login: opengames },
  params: { tick_lock_ttl_min: 240, heartbeat_timeout_min: 90, max_attempts: 3, lane_lock_ttl_min: 120 },
  locks_dir / logs_dir: ~/.config/polymatch3/{locks,logs} }   # bash 内核期遗留，现行锁/日志在 kernel/
```
三参数（心跳超时 90min / attempt 上限 3 / lane TTL 120min）与 studio-daemon `studio/config.py` 内置值一致——daemon 侧未读此节，改参数需两处同步（风险备注见文末）。

### 其他
- `logs/`：bash 内核期 tick 日志与 quarantine.log（历史考古用；现行日志在 `kernel/logs/daemon-<日期>.log`）。

## 4. 项目注册表

`kernel/youtrack-ids.json`（git 管理）：projects（POLY/STUDIO）、state/type/track/confidence 四个枚举 bundle id、字段清单（轨道/置信度/attempt/验收命令/期望输出哈希/来源/单件成本）、状态全集、notes（text 字段需 TextFieldValue 结构、看板 API 404 需 UI 建板等实操教训）。

## 风险与备注（采集时点）

- studio.json `params` 节与 daemon `config.py` 常量为**双源**，存在漂移可能。
- `~/.claude/CLAUDE.md` 与全局 AGENTS.md 均不存在——若未来设立，请刷新 [global-agents-spec.md](global-agents-spec.md)。
