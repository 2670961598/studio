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

## 787 多公司 P0 加固（2026-11-05）

**一键配置校验**（新公司 staging/active 前、每次改公司配置后跑）：
```sh
node scripts/ops/multicompany-check.mjs \
  --registry <WORKROOT>/registry.yaml --work-root <WORKROOT> --strict-paths --json
# 0=无违例；1=违例（逐条 rule/slug/problem/fix）；只读
```

### 1) seatbelt 写根按公司隔离（P0-1；v4 支持嵌套/扁平布局）
- `daemon.yaml` 的 `seatbeltWriteRoots` **只允许** `["<CROOT>/.AIWS", "<CROOT>/company/workspaces", "~/.dsh", "/private/tmp", "/private/var/folders"]`；
  **禁止** `<WORKROOT>/.AIWS` 全局树/其它公司根（daemon 启动解析期即 CONFIG_INVALID；脚本 `multicompany-check` 同步判）。
- **787 v2（F1/F2）**：写根先 **canonical（最长存在前缀 realpath + 后缀）** 再判定——symlink 目标越界（如 link→/etc、父目录 symlink）、`..` 逃逸、
  大小写绕过均拒绝；白名单按**规范根 isUnder**（只认 `<CROOT>/.AIWS` 子树与 `<companyDir>/workspaces` 子树），
  不再按任意 segment 判定（`company/docs/.AIWS`、`x/workspaces/y` 一律拒）。错误含原始值+realpath；脚本与 daemon 共用同一校验函数。
- **布局自动判定（v4）**：`dirname(companyDir)/daemon.yaml` 存在=**嵌套布局**（studio-dev，写根 `<CROOT>/.AIWS`）；
  否则 `companyDir/daemon.yaml` 存在=**扁平布局**（profit，`companyDir` 即公司根，写根 `<companyDir>/.AIWS`）。
  扁平布局下 `<WORKROOT>/.AIWS`（全局共享）与兄弟公司根一律拒（cross-company）。
- 存量迁移：profit 从全局 `<WORKROOT>/.AIWS` 改为 `<WORKROOT>/studio-profit/.AIWS`；
  studio-dev 已是嵌套本公司根，无需改。迁移时先用旧值回退保服务，改配置后重启该 label，再跑 multicompany-check。

### 2) 凭据隔离（P0-2）
- guardian JSON **不放凭据**：`daemon.envFile: "<CROOT>/credentials/daemon.env"`（0600；含 `TAIGA_PASSWORD`/
  `MATRIX_BOT_PASSWORD`/`MATRIX_HR_SHARED_SECRET`/`STUDIO_GATEWAY_SECRET` 等）；
- guardian 启动校验：envFile 缺失/非普通文件/权限含 group/other 读位 → **fail-closed**；envFile 同名键覆盖 inline；
- 平滑迁移：先建 `credentials/daemon.env`（0600）→ guardian JSON 加 `daemon.envFile` → 重启该 label；
  旧 inline env 仍兼容（迁移窗口内不阻塞），但新模板禁止内联敏感键。

### 3) 多 label 批量部署（P0-3）
```sh
# labels.json: [{"label":"io.studionext.daemon","healthUrl":"http://127.0.0.1:8788/healthz"},
#               {"label":"io.studionext.profit","healthUrl":"http://127.0.0.1:8792/healthz"}]
node scripts/ops/deploy.mjs deploy --repo <REPO> --deploy <DEPLOY> --ref <COMMIT> \
  --labels-file labels.json --health-timeout-ms 180000
```
- 行为：一次树切换 → **逐 label** `launchctl kickstart -k` → 逐 healthz（pid≠该 label 部署前 pid）→ 任一失败回滚树/state；
- 不带 `--labels-file` 时与 719 release CLI 完全兼容（单 label 路径不变）。

### 4) overview 单实例 + 鉴权边界（P0-4）
- overview CLI 自带 **单实例锁**（`<logDir>/overview.<port>.lock`；死 pid 自动清）；第二实例启动即拒；
- 缺省 `--host 127.0.0.1` **仅环回**；对外监听必须 `OVERVIEW_ALLOW_LAN=1`（制作人批准），
  且**对外需网关/只读 token 方案**（当前 v0 不做内置鉴权；不得直接暴露 8789）。
- 只保留一个 8789 实例；各公司 panel 可选/按端口表另分配，禁止多 overview 进程。

### 5) 容量/存储初值（P0-5）
- 新公司 `maxInflight ≤4`（模板默认 4；调大须容量门+留痕）；
- `.AIWS` 配额 **5–10GiB**、滚动保留 **7–14 天**；开公司 Step 0 记 df/du 基线，日常按 registry 巡检。

### 6) 已知缺陷修复（787 附带）
- `ops/launchd/README.md` 安装 sed 曾把 `__WORKROOT__` 替换成字面量 `<workRoot>` → `processPattern` 永不匹配、
  利润 watchdog 静默失明；已改为真实 `$WORKROOT` 并加占位符残留检查（拒绝安装）。
