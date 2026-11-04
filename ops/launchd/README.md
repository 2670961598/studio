# 守护核 launchd 接入与迁移（studio-dev-697）

> 目标：daemon 挂了自动拉起、挂死自动重启、异常可告警；守护核自身由 launchd `KeepAlive` 保活。
> 旧代 `com.studio.daemon`（Python 项目）已按制作人令关停（plist 移入 `~/Library/LaunchAgents/disabled/`）；
> **本目录的 `io.studionext.daemon` 是 StudioNext 的守护核**，二者不要混用。

## 0. 组成

| 组件 | 文件 | 职责 |
|---|---|---|
| 守护核 | `scripts/guardian.mjs` | 起 daemon 子进程；按 `intervalMs` 探 `GET /healthz`；连续失败/子进程退出 → SIGTERM→SIGKILL→指数退避重启；crash-loop 刹车；写结构化日志/告警（可选 webhook）。**零业务依赖**：只 node 标准库+fetch；退避/刹车/判据纯函数单源=`packages/core/src/survival/guardian.ts`（零 IO，测试单点） |
| liveness | daemon `GET /healthz`（apiPort，缺省环回 8788） | 200=进程存活∧tick 前进∧events 哈希链摘要正常；异常 503（不谎报） |
| launchd 模板 | `ops/launchd/io.studionext.daemon.plist` | `RunAtLoad+KeepAlive+ThrottleInterval=10` 保 guardian |
| 配置模板 | `ops/launchd/guardian.example.json` | 守护对象/探针/退避/刹车/日志路径 |

## 1. 安装（部署窗口执行；不重启无关进程）

1. **准备配置**（本机生成，不入仓）：
   ```sh
   mkdir -p ~/.config/studio-next ~/Library/Logs/studio-next
   cp ops/launchd/guardian.example.json ~/.config/studio-next/guardian.json
   # 替换：<NODE_BIN> = `command -v node`；<WORKSPACE> = 本仓绝对路径；
   #       <COMPANY_DIR> = 公司目录（含 daemon.yaml）；<LOGDIR> = ~/Library/Logs/studio-next
   node -e "JSON.parse(require('fs').readFileSync(process.env.HOME+'/.config/studio-next/guardian.json','utf8'));console.log('config ok')"
   ```
2. **安装 plist**（替换占位符后写入 LaunchAgents）：
   ```sh
   sed -e "s#__NODE__#$(command -v node)#g" \
       -e "s#__GUARDIAN__#$PWD/scripts/guardian.mjs#g" \
       -e "s#__CONFIG__#$HOME/.config/studio-next/guardian.json#g" \
       -e "s#__WORKSPACE__#$PWD#g" \
       -e "s#__LOGDIR__#$HOME/Library/Logs/studio-next#g" \
       ops/launchd/io.studionext.daemon.plist > ~/Library/LaunchAgents/io.studionext.daemon.plist
   plutil -lint ~/Library/LaunchAgents/io.studionext.daemon.plist
   ```
3. **停旧手工 daemon**（只在部署窗口；先确认没有其他守护在抢同一 apiPort）：
   - 记录 PID：`pgrep -fl 'apps/daemon/src/index.ts'`
   - 优雅停：对该 PID `kill -TERM`，等它 drain/退出（**不要 kill -9**）。
4. **加载 launchd**：
   ```sh
   launchctl bootout gui/$(id -u)/io.studionext.daemon 2>/dev/null || true
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/io.studionext.daemon.plist
   launchctl print gui/$(id -u)/io.studionext.daemon | head -30
   ```
5. **验证 READY/healthz**：
   ```sh
   curl -fsS http://127.0.0.1:8788/healthz | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.ok,j.tick,j.chain)})"
   cat ~/Library/Logs/studio-next/guardian.jsonl | tail -3
   ```
   期望：`/healthz` 200 且 `ok=true`；`guardian.jsonl` 有 `daemon-start`。

## 2. 演练（部署窗口内完成并留痕）

1. **kill -9 自动恢复**：`kill -9 $(cat ~/Library/Logs/studio-next/daemon.pid)` →
   等 ≤ 70s（探测 3×10s + 退避 2s + 启动）→ `curl /healthz` 200；`guardian.jsonl` 有
   `health-fail`→`daemon-stop`→`daemon-start`（隐形恢复=不留痕，视为失败）。
2. **挂死演练**（不杀进程，只让 tick 停走）时 guardian 同样 45s 内 SIGTERM/SIGKILL 重启。
3. **crash-loop 刹车**：临时把配置 `health.url` 改成错误端口并 `launchctl kickstart -k` 重载 guardian →
   观察 `crash-loop-brake` 告警且重启间隔退到 `brakeMs`（不无限重启）；演练后改回并重载。

## 3. 回滚

```sh
launchctl bootout gui/$(id -u)/io.studionext.daemon
# 手工启动（临时）：node apps/daemon/src/index.ts serve --config <companyDir>/daemon.yaml &
```
旧代 `com.studio.daemon` 不恢复（已关停）；如需历史对照，plist 在 `~/Library/LaunchAgents/disabled/`。

## 4. 运维要点

- **单点写者**：同一 apiPort/库只允许一个 daemon；手工再起会与 guardian 抢端口（禁止）。
- **日志**：`guardian.jsonl`（结构化，事件守卫用）、`daemon.log`（子进程 stdout/stderr）、
  `alerts.jsonl`（告警副本）、`guardian.err.log`（launchd 层异常）。
- **不动手 kill guardian**：它由 launchd 保活；要停就 `launchctl bootout`（整链停）。
- 故障处置按 `docs/90-§五 运维 runbook RB-01..RB-06`。
