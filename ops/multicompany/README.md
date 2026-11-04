# ops/multicompany —— 多公司开公司/守护模板（ref=786，2026-11-05）

> 文档依据：`docs/90-§九`（多公司开公司 runbook）、`docs/36-§8`（创建/路由约定）、`docs/04-§七`（端口）。
> 本目录只放**占位符模板**（无真实路径/凭据）；实际安装时复制到主机外部配置目录（如 `~/.config/studio-next/`、`<workRoot>/companies/<slug>/ops/`），**不把填好的版本入仓**。
> 与既有 `ops/launchd/`（studio-dev 单公司 697/708）的关系：本目录是**每公司模板**；studio-dev 继续用 `ops/launchd/` 兼容 label `io.studionext.daemon`，新公司用 `io.studionext.<slug>`。

## 文件

| 文件 | 用途 |
|---|---|
| `guardian.example.json` | 每公司 guardian 配置；复制为 `~/.config/studio-next/guardian-<slug>.json` |
| `io.studionext.slug.plist.example` | launchd 模板；复制为 `~/Library/LaunchAgents/io.studionext.<slug>.plist`，Label 替换为 `io.studionext.<slug>` |
| `start.example.sh` | 每公司 daemon 启动包装（0600）；加载 `<companyRoot>/credentials/daemon.env` 后 exec daemon |
| `daemon.example.yaml` | 每公司 daemon.yaml 示例（localfile/Taiga 二选一；staged 用 localfile） |
| `companies.registry.example.yaml` | 框架运营注册表（`<workRoot>/registry.yaml`，不入 git） |
| `overview.example.sh` | 共享 `:8789` overview 启动示例（多 `--company`；当前只支持一个 `--db`） |

## 占位符

| 占位符 | 取值 |
|---|---|
| `<slug>` / `__SLUG__` | 公司 slug（`^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$`；也是 `/<slug>/` 路由） |
| `<companyRoot>` / `<COMPANY_ROOT>` | `<workRoot>/<slug>`（公司根：`company/`、`var/`、`.AIWS`、`credentials/`、`ops/` 的父） |
| `<companyDir>` / `<COMPANY_DIR>` | `<companyRoot>/company`（公司 git 目录） |
| `<deployWorkspace>` / `<DEPLOY_WORKSPACE>` | 共享部署树（如 `<workRoot>/StudioNext-deploy`；只跑已验证 commit） |
| `<mainRepo>` / `<MAIN_REPO>` | 框架主仓（部署树来源） |
| `<deployState>` / `<DEPLOY_STATE>` | `<DEPLOY_WORKSPACE>.deploy-state.json` |
| `<nodeBin>` / `<NODE_BIN>` | `command -v node` |
| `<home>` / `<HOME>` | 运行用户 home |
| `<apiPort>` / `<API_PORT>` | 每公司唯一环回端口：studio-dev 8788、profit 8792、新公司 8793+ |
| `<logDir>` / `<LOGDIR>` | `~/Library/Logs/studio-next/<slug>` |
| `<level>` | 2–9（选 `templates/company-<level>-level`） |

## 安装（部署窗口，按 docs/90-§九 第 6 步）

```sh
# 1) 先确认共享部署树/state 已 active（deploy.mjs status）
node <mainRepo>/scripts/ops/deploy.mjs status --deploy <deployWorkspace> --json
# 2) 填模板（在外部配置目录，不提交）
cp ops/multicompany/guardian.example.json ~/.config/studio-next/guardian-<slug>.json
cp ops/multicompany/io.studionext.slug.plist.example ~/Library/LaunchAgents/io.studionext.<slug>.plist
cp ops/multicompany/start.example.sh <companyRoot>/ops/start.sh && chmod 700 <companyRoot>/ops/start.sh
# 3) 凭据（0600；值从安全源取，不写入历史/不打印）
install -m 600 /dev/null <companyRoot>/credentials/daemon.env   # 再编辑填入
# 4) 语法/权限检查
node -e "JSON.parse(require('fs').readFileSync(process.env.HOME+'/.config/studio-next/guardian-<slug>.json','utf8'));console.log('json ok')"
plutil -lint ~/Library/LaunchAgents/io.studionext.<slug>.plist
bash -n <companyRoot>/ops/start.sh
# 5) 若旧 daemon 在跑：先优雅停（确认 pid/cwd），再 bootstrap
launchctl bootout gui/$(id -u)/io.studionext.<slug> 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/io.studionext.<slug>.plist
launchctl kickstart -k gui/$(id -u)/io.studionext.<slug>
curl -s http://127.0.0.1:<apiPort>/healthz
```

## 验收 / 回滚

- 验收：`launchctl print gui/$(id -u)/io.studionext.<slug>` 为 running；`healthz` 200；`guardian.jsonl` 有 `preflight-ok→daemon-start`；kill -9 后 ≤70s 自愈；只有本公司 pid 变化。
- 部署：共享部署树切到已验证 commit 后，`deploy.mjs deploy --ref <sha>`（默认重启 studio-dev label），再逐 `launchctl kickstart -k gui/$(id -u)/io.studionext.<slug>`；逐公司 healthz。
- 回滚：`launchctl bootout gui/$(id -u)/io.studionext.<slug>`；恢复旧启动方式；`deploy.mjs deploy --ref <previousCommit>` 后逐 label kickstart；不重写历史。
- 安全：guardian.json **不内联**密码/密钥；由 `ops/start.sh` 加载 0600 `credentials/daemon.env`；模板不含真实路径/凭据；`registry.yaml` 放 `<workRoot>`，不入 git。
