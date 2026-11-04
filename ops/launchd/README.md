# 守护核 launchd 接入与迁移（studio-dev-697；部署隔离 ref=708 更新）

> 目标：daemon 挂了自动拉起、挂死自动重启、异常可告警；守护核自身由 launchd `KeepAlive` 保活。
> 旧代 `com.studio.daemon`（Python 项目）已按制作人令关停（plist 移入 `~/Library/LaunchAgents/disabled/`）；
> **本目录的 `io.studionext.daemon` 是 StudioNext 的守护核**，二者不要混用。
>
> **部署隔离（ref=708，docs/90-§六）**：守护核与 daemon **都从「部署树」运行**（已验证 commit 的独立检出），
> 主工作区只用于施工、可以脏；guardian 启动前跑 `deploy.mjs check` 兜底（部署树不干净/漂移/依赖缺失即拒绝启动）。
> 任何重启（含守护核自动拉起）都不再加载主工作区未提交代码。

## 0. 组成

| 组件 | 文件 | 职责 |
|---|---|---|
| 守护核 | `scripts/guardian.mjs` | 起 daemon 子进程；**启动前跑 `daemon.preflight`**（ref=708 部署隔离校验，失败 fail-closed 告警重试）；按 `intervalMs` 探 `GET /healthz`；连续失败/子进程退出 → SIGTERM→SIGKILL→指数退避重启；crash-loop 刹车；写结构化日志/告警（可选 webhook）。**零业务依赖**：只 node 标准库+fetch；退避/刹车/判据纯函数单源=`packages/core/src/survival/guardian.ts`（零 IO，测试单点） |
| 部署工具 | `scripts/ops/deploy.mjs` | 部署隔离：`check`（guardian preflight）/`deploy`（checkout 目标 commit→tree digest 校验→依赖→重启→healthz）/`status`；**回滚=用旧 ref 重跑** |
| liveness | daemon `GET /healthz`（apiPort，缺省环回 8788） | 200=进程存活∧tick 前进∧events 哈希链摘要正常；异常 503（不谎报） |
| launchd 模板 | `ops/launchd/io.studionext.daemon.plist` | `RunAtLoad+KeepAlive+ThrottleInterval=10` 保 guardian；`WorkingDirectory`=部署树 |
| 配置模板 | `ops/launchd/guardian.example.json` | 守护对象/探针/退避/刹车/日志路径；`daemon.cwd`=部署树、`daemon.preflight`=`deploy.mjs check` |

## 1. 首次准备：部署树（部署窗口、一次性）

> 推荐 **clone**（独立对象库，最稳）；worktree 也可（共享对象，速度快）。
> 部署树必须在**主仓之外**（如 `<workRoot>/StudioNext-deploy`），由 `deploy.mjs` 管理；不要手工改部署树文件。

```sh
# 1) clone 独立部署树（--no-checkout：先不落头指针；注意此时索引为空，git status 会显示
#    「全部文件 staged deletions」——这是尚未 checkout 的预期态，直接跑 deploy 会被 assertClean 拒绝）
git clone --no-checkout <主仓绝对路径> <workRoot>/StudioNext-deploy
# 2) 首次必须显式 checkout 一次到已验证 commit（此后禁止手工 checkout/pull，一律走 deploy.mjs）
git -C <workRoot>/StudioNext-deploy checkout --detach <已验证 commit sha>
# 3) 部署到已验证 commit（digest 校验 + 落 state；首装可加 --skip-install 先演练）
node <主仓>/scripts/ops/deploy.mjs deploy \
  --repo <主仓绝对路径> \
  --deploy <workRoot>/StudioNext-deploy \
  --ref <已验证 commit sha> \
  --skip-restart          # 首装 daemon 尚未切换时可用；真实切换去掉本行
# 4) 确认状态文件（缺省 <部署树>.deploy-state.json；guardian preflight 读它）
node <主仓>/scripts/ops/deploy.mjs status --deploy <workRoot>/StudioNext-deploy
```

依赖：`deploy.mjs` 在 `node_modules` 缺失或 `bun.lock` 变化时自动 `bun install --frozen-lockfile`（部署树内安装；
不同步主工作区 `node_modules`，避免 workspace 包软链回主工作区破坏隔离）。离线/演练可 `--skip-install`，但真实部署不建议。

> **首装顺序不可倒（鸡生蛋，实测于 2026-11-04）**：guardian 的 `daemon.preflight` 读部署状态文件，
> 而状态文件只有 `deploy.mjs deploy` 成功后才会写。因此**必须先跑第 1 节（deploy 落 state），再装守护核/加 preflight**；
> 反过来（guardian 先带 preflight 起、state 尚不存在）会被 fail-closed 挡住——`guardian.jsonl` 记
> `preflight-failed`（`部署状态文件缺失`）、不 spawn daemon，属**预期行为**，不是故障。
> 已有旧守护在跑时的迁移：可先按旧配置让 guardian 起 daemon → 跑 `deploy.mjs deploy --ref <已验证 commit>`
> 落 state（`--skip-restart` 可先不切换）→ 再把 `daemon.preflight` 加进 guardian 配置并 `launchctl kickstart -k`。

## 2. 安装守护核（部署窗口执行；不重启无关进程）

1. **准备配置**（本机生成，不入仓）：
   ```sh
   mkdir -p ~/.config/studio-next ~/Library/Logs/studio-next
   cp <主仓>/ops/launchd/guardian.example.json ~/.config/studio-next/guardian.json
   # 替换：<NODE_BIN> = `command -v node`；<COMPANY_DIR> = 公司目录（含 daemon.yaml）；
   #       <DEPLOY_WORKSPACE> = 部署树绝对路径；<DEPLOY_STATE> = 部署状态文件（<部署树>.deploy-state.json）；
   #       <LOGDIR> = ~/Library/Logs/studio-next
   node -e "JSON.parse(require('fs').readFileSync(process.env.HOME+'/.config/studio-next/guardian.json','utf8'));console.log('config ok')"
   ```
   > 迁移期提示：把旧配置的 `daemon.cwd`/`daemon.command` 从主工作区改到部署树，并新增 `daemon.preflight`。
   > 主工作区（builder 施工面）**不应**再出现在 guardian 配置里。
2. **安装 plist**（占位符替换为部署树内路径）：
   ```sh
   sed -e "s#__NODE__#$(command -v node)#g" \
       -e "s#__GUARDIAN__#<workRoot>/StudioNext-deploy/scripts/guardian.mjs#g" \
       -e "s#__CONFIG__#$HOME/.config/studio-next/guardian.json#g" \
       -e "s#__DEPLOY_WORKSPACE__#<workRoot>/StudioNext-deploy#g" \
       -e "s#__LOGDIR__#$HOME/Library/Logs/studio-next#g" \
       <主仓>/ops/launchd/io.studionext.daemon.plist > ~/Library/LaunchAgents/io.studionext.daemon.plist
   plutil -lint ~/Library/LaunchAgents/io.studionext.daemon.plist
   ```
3. **停旧手工 daemon**（只在部署窗口；先确认没有其他守护在抢同一 apiPort）：
   - 记录 PID：`pgrep -fl 'apps/boot/src/main.ts'`
   - 优雅停：对该 PID `kill -TERM`，等它 drain/退出（**不要 kill -9**）。
4. **加载 launchd**：
   ```sh
   launchctl bootout gui/$(id -u)/io.studionext.daemon 2>/dev/null || true
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/io.studionext.daemon.plist
   launchctl print gui/$(id -u)/io.studionext.daemon | head -30
   ```
5. **验证 READY/healthz**：
   ```sh
   curl -fsS http://127.0.0.1:8788/healthz
   tail -3 ~/Library/Logs/studio-next/guardian.jsonl
   ```
   期望：`/healthz` 200 且 `ok=true`；`guardian.jsonl` 依次有 `preflight-ok` → `daemon-start`。

## 3. 日常部署（部署窗口执行）

```sh
# ① 主仓先 commit 并跑门禁（Lead 负责）；得到已验证 commit sha
# ② 部署树更新到该 commit + 依赖 + 重启守护核 + healthz 验证（脚本一次完成）
node <主仓>/scripts/ops/deploy.mjs deploy \
  --repo <主仓绝对路径> --deploy <workRoot>/StudioNext-deploy \
  --ref <已验证 commit sha>
# ③ 演练/离线可加 --skip-install --skip-restart（只做 checkout+digest 校验）
# ④ 回滚（同一命令换旧 sha；不重写历史）
node <主仓>/scripts/ops/deploy.mjs deploy --repo <主仓> --deploy <部署树> --ref <上一 commit sha>
```

**施工期主工作区可脏**：builder 未提交改动不会进入部署树，daemon 也不会加载它；
`deploy.mjs check`（guardian preflight）只校验部署树干净 + HEAD/`tree` 与 state 一致。

## 4. 演练（部署窗口内完成并留痕）

1. **kill -9 自动恢复**：`kill -9 $(cat ~/Library/Logs/studio-next/daemon.pid)` →
   等 ≤ 70s（探测 3×10s + 退避 2s + 启动）→ `curl /healthz` 200；`guardian.jsonl` 有
   `health-fail`→`daemon-stop`→`daemon-start`（隐形恢复=不留痕，视为失败）。
2. **挂死演练**（不杀进程，只让 tick 停走）时 guardian 同样 45s 内 SIGTERM/SIGKILL 重启。
3. **crash-loop 刹车**：临时把配置 `health.url` 改成错误端口并 `launchctl kickstart -k` 重载 guardian →
   观察 `crash-loop-brake` 告警且重启间隔退到 `brakeMs`（不无限重启）；演练后改回并重载。
4. **部署隔离真机演练（ref=708 必做）**：主工作区留脏改动（任意未提交文件）→
   `deploy.mjs deploy ... --ref <部署树当前 commit>`（或直接 `launchctl kickstart -k` 让 guardian 重启）→
   验证 `/healthz` 200、daemon 命令行为部署树路径、进程 cwd=部署树；**运行代码不含脏改动**；
   然后再走一次「部署树更新到新 commit → 重启生效 → 回滚旧 commit」闭环。
5. **preflight 拒绝演练**：在部署树 `touch` 一个未提交文件 → `launchctl kickstart -k` 重启 guardian →
   `guardian.jsonl` 出 `preflight-failed` 且无 `daemon-start`（旧 daemon 已随 kickstart 停止，**故意保持停止**证明 fail-closed）；
   `git -C <部署树> status` 确认脏后清理再重启恢复。

## 5. 回滚

```sh
# 部署隔离回滚 = 用旧 commit 重新部署（推荐；脚本自动 digest 校验+重启+healthz）
node <主仓>/scripts/ops/deploy.mjs deploy --repo <主仓> --deploy <部署树> --ref <上一 commit sha>
# 整链停（应急）：launchctl bootout gui/$(id -u)/io.studionext.daemon
```
旧代 `com.studio.daemon` 不恢复（已关停）；如需历史对照，plist 在 `~/Library/LaunchAgents/disabled/`。

## 6. 运维要点

- **单点写者**：同一 apiPort/库只允许一个 daemon；手工再起会与 guardian 抢端口（禁止）。
- **部署树只读**：不要手工 `git checkout/pull` 或改部署树文件；部署只走 `deploy.mjs`（否则 state 与事实脱节，preflight 会拒绝启动）。
- **日志**：`guardian.jsonl`（结构化，事件守卫用）、`daemon.log`（子进程 stdout/stderr）、
  `alerts.jsonl`（告警副本）、`guardian.err.log`（launchd 层异常）。
- **不动手 kill guardian**：它由 launchd 保活；要停就 `launchctl bootout`（整链停）。
- 故障处置按 `docs/90-§五 运维 runbook RB-01..RB-06`；部署形态见 `docs/90-§六`。
