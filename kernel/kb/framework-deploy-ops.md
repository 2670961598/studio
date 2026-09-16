# [框架] 部署与运维（launchd/看护/控制台）

> 状态：草稿 ｜ 采集：STUDIO-14，2026-09-17
> 源：~/Library/LaunchAgents/com.studio.daemon.plist、~/bin/studio-daemon-launch.sh、studio-daemon/studio/{daemon,web}.py

## 1. 部署拓扑

```
launchd（com.studio.daemon，RunAtLoad + KeepAlive）
  └── ~/bin/studio-daemon-launch.sh        # bash 看护循环
        └── .venv/bin/python -m studio.daemon run   # cwd: /Volumes/BigDisk/Studio/studio-daemon
              ├── APScheduler（SQLite jobstore: studio-daemon/jobs.sqlite）
              │     pm-poly / pm-studio / evolve-scan / patrol / self-eval（错峰 cron）
              └── uvicorn + FastAPI 控制台 http://127.0.0.1:8787（Vue 静态页）
```

选型理由（宪章 §4 / 看护脚本注释）：bash 在 launchd 下稳定，Python 挂死也能靠健康检查重启——**看护层不用被看护的东西**。

## 2. launchd 配置（com.studio.daemon.plist）

- Label `com.studio.daemon`；ProgramArguments 指向 ~/bin/studio-daemon-launch.sh；`RunAtLoad=true`、`KeepAlive=true`（进程退出即重拉）。
- 日志：`~/Library/Logs/studio-daemon.log`（stdout+看护日志）/ `.err`。
- EnvironmentVariables：PATH 含 /opt/homebrew/bin 与 ~/bin；HOME 显式注入。

加载/卸载（运维常规）：`launchctl load|unload ~/Library/LaunchAgents/com.studio.daemon.plist`。

## 3. bash 看护循环（studio-daemon-launch.sh）

无限循环：拉起 daemon → 等端口就绪（最多 60s，轮询 `/api/state`）→ 持续监护（每 20s 健康检查一次）→ **连续 3 次失败 `kill -9`** → 等 PID 退出 → 10s 后重启。对应 dispatch.md 兜底 #8（daemon 自身崩）：tick 锁 TTL（240min）兜底防双活，状态全外置故重启无损。

## 4. 控制台（web.py，:8787）

| 端点 | 用途 |
|---|---|
| `/` | Vue 仪表盘（static/index.html） |
| `/api/overview` | 板面快照（外链 YouTrack）+ 最近 40 事件 + 7 日指标 + 自评 + 锁 + 心跳 |
| `/api/jobs` + `POST /api/jobs/{id}/{pause,resume,trigger}` | 调度器 job 状态与手动触发（TRIGGER_MAP 白名单 5 job） |
| `/api/runs` | runs.jsonl 运行历史（含手动触发留痕） |
| `/api/schema` | 单子知识库 + TEAM.md + agents 档案摘要（前端知识页） |
| `/api/workers`、`/api/transcript/{单号}` | 工人注册表（含 stream-json 的 cost/turns）与对话直播回放 |
| `/api/state` | 健康检查入口（看护脚本消费；含调度器活性） |

本机防护（web.py middleware）：Host 白名单（拒 DNS rebinding，421）+ 跨站 POST 拦截（CSRF，403）。ZCode = 制作人驾驶舱。

## 5. 日志与产物地图（运维排障入口）

| 位置 | 内容 |
|---|---|
| `~/Library/Logs/studio-daemon.log/.err` | daemon stdout/stderr + 看护循环日志 |
| `kernel/logs/daemon-<日期>.log` | pm_tick / patrol / evolve 每 tick 的 TICK 行与 ERROR |
| `kernel/workers/<单号>.{json,REPORT.md,prompt.md,stream.jsonl,wrap.sh}` | 工人注册/报告/任务书/直播流；归档后缀 `.done.json` / `.archived-*` / `.a<attempt>` |
| `kernel/evidence/<PID>/<单号>-<tag>.{json,log}` | run-gate 证据（G2~G5 唯一依据，含 log_sha256_16） |
| `kernel/locks/*.lock/`、`kernel/heartbeats/*.hb` | 目录锁（owner/pid/ts）与心跳 |
| `kernel/metrics/events.jsonl`、`runs.jsonl`、`digest/` | 记账流水 / 调度历史 / 日报与自评产物 |

## 6. 常规运维动作（事实记录）

- **手动跑一岗**（调试/冒烟）：`python -m studio.daemon tick pm|selfeval`；`board` 打印板面快照（daemon.py main）。
- **看锁**：`~/bin/studio-lock list` 或控制台 /api/overview 的 locks 节。
- **杀工人**：`~/bin/studio-worker kill <单号>`（进程组 SIGTERM）或控制台；PM 会按兜底自动 attempt+1 重派。
- **脏树清扫**：`~/bin/studio-clean <lane>`（只动无锁脏树，stash 隔离可恢复）。
- 上列动作中，改板面类的手动操作仍受红线约束（状态迁移只走矩阵；完成只认 run-gate）。

## 源

- /Users/xieqingxin/Library/LaunchAgents/com.studio.daemon.plist（全文）
- /Users/xieqingxin/bin/studio-daemon-launch.sh（全文 30 行）
- /Volumes/BigDisk/Studio/studio-daemon/studio/daemon.py、web.py
- /Volumes/BigDisk/Studio/kernel/skills/dispatch.md（兜底 #8）
