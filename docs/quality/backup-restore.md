# 平台备份与恢复（Taiga/Matrix/chatd/core；ops，2026-11-17；2026-11-20 M5-2 增无 Docker 支持与 core 事实源）

> **状态（2026-11-24，M5-4a）**：Taiga/Matrix（Docker 栈）章节=历史归档，非新装默认路径；chatd/台账/公司
> 目录备份=现役默认（`--local-only`）。新装默认=localfile＋chatd 零 Docker（plan/08）；兼容键未删——回滚零成本。

> 制作人 2026-11-17 批准「Taiga/Matrix 每日自动备份」。执行体=`scripts/ops/platform-backup.sh`；
> 计划任务草案=`scripts/ops/io.studionext.platform-backup.plist`（每日 04:30；安装由 Lead/ops 在窗口执行）。
> 备份目录缺省 `$HOME/backups/studio-next`（生产建议显式用 `--backup-dir` 或 `PLATFORM_BACKUP_DIR` 指向备份盘 `<backupDir>`）。

## 1. 产物与命名

| 产物 | 内容 | 权限 |
|---|---|---|
| `taiga-pg-<YYYYMMDD-HHMMSS>.sql.gz` | `pg_dumpall -U taiga` 全库（cluster dump，含 taiga DB） | 600 |
| `taiga-pg-<...>.err` | pg_dumpall stderr（成功时 0B 也保留，便于排查） | 600 |
| `matrix-hs-<...>.db.gz` | Synapse `/data/homeserver.db` 的 SQLite backup API 快照（`integrity_check=ok`），gzip | 600 |
| `matrix-config-<...>.tgz` | `/data/homeserver.yaml`、`localhost.log.config`、**`localhost.signing.key`**（含密钥，勿外发） | 600 |
| `chatd-<slug>-<...>.db.gz` | 公司 chatd SQLite 在线备份（`.backup`＋integrity_check；M4.5；缺库=SKIP） | 600 |
| `core-platform-<slug>-<...>.tgz` | `<companyDir>/platform` jsonl 树整树 tar（保留 `platform/` 相对结构；M5-2 第二刀；缺目录=SKIP） | 600 |
| `core-ledger-<slug>-<...>.db.gz` | `<companyDir>/ledger.sqlite` 台账在线备份（`.backup`＋integrity_check；M5-2 第二刀；缺文件=SKIP） | 600 |
| `core-company-<slug>-<...>.tgz` | `<companyDir>/company` 公司 git 目录整树 tar（M5-2 第二刀；缺目录=SKIP） | 600 |
| `backup.log` | 每次运行的 START/OK/FAIL/SUMMARY（JSON行）文本日志 | 600 |
| `.platform-backup-manifest` | 本脚本产物清单（epoch\|文件名）；保留策略只依据此清单 | 600 |

## 2. 校验（脚本内已做；人工复核同法）

```sh
gzip -t taiga-pg-*.sql.gz
gzip -dc taiga-pg-*.sql.gz | wc -l          # 真机 ~52k 行；0=失败
gzip -t matrix-hs-*.db.gz
tar -tzf matrix-config-*.tgz                # 应含 homeserver.yaml/signing key/log config
tar -tzf core-platform-*.tgz                # 应以 platform/ 开头（M5-2 第二刀）
gzip -t core-ledger-*.db.gz && tar -tzf core-company-*.tgz  # 后者应以 company/（含 .git/）开头
ls -l backup.log                            # 末尾 SUMMARY {"ok":true,...}
```

## 3. 保留策略

- 默认保留 **最近 7 天**；仅删除 `.platform-backup-manifest` 中记录的产物（按 manifest 记录的 epoch 判定），
  **绝不删除非本脚本产物**（人工备份/其它文件不动）。
- 同一天重复跑安全（新时间戳产物；manifest 追加）；并发由 `<backupDir>/.platform-backup.lock` 原子目录锁 +
  pid 存活检测阻止；崩溃残留死 pid 锁下一次自动清理。
- 失败时保留 `.err`/部分产物供排查，脚本非零退出（不静默）。

## 4. 计划任务（launchd 草案）

```sh
# 1) 部署/安装脚本后（__REPO__ = 部署树路径，__BACKUP_DIR__ = 备份目录）
sed -e 's#__REPO__#<部署树路径>#g' \
    -e 's#__BACKUP_DIR__#<backupDir>#g' \
  scripts/ops/io.studionext.platform-backup.plist > ~/Library/LaunchAgents/io.studionext.platform-backup.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/io.studionext.platform-backup.plist
launchctl print gui/$(id -u)/io.studionext.platform-backup | grep -E 'state|last exit'  # 核对
# 2) 手动触发一次（安装后立即验证）
launchctl kickstart -k gui/$(id -u)/io.studionext.platform-backup
tail -20 <backupDir>/backup.log
```

- `StartCalendarInterval` = 每日 **04:30**（本地时区；Mac 休眠错过时 launchd 在唤醒后补跑一次）。
- 卸载：`launchctl bootout gui/$(id -u)/io.studionext.platform-backup`；不删历史备份。

## 5. 恢复步骤

### Taiga（破坏性；先二次备份当前库）

1. 选目标 `taiga-pg-<ts>.sql.gz`，`gzip -t` 通过；核对大小/行数（或与同日 `backup.log` 的 SUMMARY 对账）。
2. 维护窗口：停 Taiga 应用/worker（保留 DB 容器）；对当前 DB 做一次额外备份（`pg_dumpall`）并记录。
3. 恢复 cluster：
   ```sh
   gzip -dc taiga-pg-<ts>.sql.gz | docker exec -i taiga-docker-taiga-db-1 psql -U taiga -d postgres
   ```
   （`pg_dumpall` 输出含 role/DB 创建；若目标库已存在，按 dump 顺序可能需先落新 volume/清库——恢复演练前先 `pg_dumpall` 当前态并保留）
4. 启动 Taiga 应用/worker，核对数据库版本/项目/成员；失败按二次备份回滚。

### Matrix（Synapse）

1. 选 `matrix-hs-<ts>.db.gz` + `matrix-config-<ts>.tgz`；`gzip -t`/`tar -tzf` 通过；signing key 必须与备份时一致（否则客户端会验签失败）。
2. 维护窗口停 Synapse（保留容器）；对当前 `/data/homeserver.db` 做副本。
3. 恢复：
   ```sh
   gzip -dc matrix-hs-<ts>.db.gz > /tmp/homeserver.db.restore
   docker cp /tmp/homeserver.db.restore matrix-synapse:/data/homeserver.db
   docker exec matrix-synapse chown <uid>:<gid> /data/homeserver.db   # 与容器内原属主一致
   tar -xzf matrix-config-<ts>.tgz -C /tmp/matrix-config-restore
   # 核对 homeserver.yaml 后按需 docker cp 回 /data；signing key 权限 600
   ```
4. 启 Synapse；核对 `/health`、联邦/消息/成员；失败恢复当前副本。

> **安全**：备份含 Taiga 业务数据、Matrix 消息 DB 与 signing key；`matrix-config-*.tgz`/DB 均 600，备份目录建议 700；
> 不提交 git、不发外网、不做云同步。恢复演练每季度一次，演练后记录到台账。

## 6. 失败处置

- 脚本非零退出：看 `<backupDir>/backup.log` 的 `FAIL` 行与对应 `.err`；修复后重跑（同一天安全）。
- 容器未运行/`docker exec` 失败：先检查 Docker Desktop/容器状态（不要盲目重启 Docker——见 docs/90 平台事故记录）；
  备份任务失败不会修改既有备份；Lead 按告警处置并登记。
- `gzip -t`/行数/size 失败：产物视为不可用，不要用于恢复；保留现场并重跑。
- launchd `last exit` 非 0：`launchctl print ...` + `backup.launchd.err` 排查；必要时 `bootout` 后重新 `bootstrap`。

## 7. 无 Docker 部署（M5-2 第一刀，2026-11-20）

背景：Docker Desktop 已弃用（外部盘重挂导致存储层 EIO，Taiga/Matrix 容器损坏且不再使用）；
备份脚本自 2026-11-20 起支持无 Docker 环境，计划任务无需重装或改动。

### 7.1 触发方式

| 方式 | 语义 |
|---|---|
| **自动探测（默认）** | docker CLI 缺失，或 `docker info` 失败（daemon 未装/未运行/不可达）→ 视为不可用 |
| **显式 `--skip-docker`** | 操作者强制跳过（适用于 docker info 可通但容器已弃用/损坏的机器）；计划任务在 ProgramArguments 追加 `<string>--skip-docker</string>` 即可 |

判定为「不可用/跳过」时：

- Taiga、Matrix DB、Matrix-config 三段 **SKIP**：不备份、**不算失败**；`backup.log` 逐段明报
  `SKIP <段名> reason=docker-unavailable`（显式标志为 `reason=skip-docker-flag`）；
- SUMMARY JSON 记 `"docker":{"skipped":true,"reason":"...","sections":["taiga","matrix","matrix-config"]}`；
- **chatd 段照常**（`--chatd-db`/`PLATFORM_BACKUP_CHATD_DBS` 的在线 `.backup`→integrity_check→gzip 600）；
  manifest 与 7 天保留策略照旧（只清理本脚本 manifest 记录的产物）；
- 退出码以 chatd/其余面为准：chatd 成功=0；**Docker 不可用本身不产生非零退出**。

docker 可用且未显式跳过时，行为与原版逐字节一致（docker preflight 失败——CLI 在但容器未运行——仍按 §6 fail）。

### 7.2 巡检口径

```sh
# 不可用日的正常形态：三行 SKIP + chatd OK + SUMMARY ok:true
grep -E 'SKIP (taiga|matrix|matrix-config)' <backupDir>/backup.log | tail -3
tail -1 <backupDir>/backup.log        # SUMMARY 应含 "docker":{"skipped":true,...} 且 ok:true
ls <backupDir>/chatd-*.db.gz          # chatd 产物照常产出
```

- 长期无 Docker 的机器：SKIP 行是**预期常态**，不是告警；异常=非零退出或 SUMMARY `ok:false`。
- 恢复 Taiga/Matrix 数据（§5）仍用历史备份；`docker` 命令面仅恢复演练时需要。
- 若 `docker info` 挂起（罕见，损坏 VM 极端态）：显式加 `--skip-docker` 绕过探测。

### 7.3 core 事实源备份（M5-2 第二刀，2026-11-20）

背景：Docker 退役后，生产自研事实源全在外部数据盘（单点）——`<companyDir>/platform`（单子平台
jsonl 树）、`<companyDir>/ledger.sqlite`（SQLite 台账）、`<companyDir>/company`（公司 git 目录，
daemon 唯一写入者）。本刀起随每日任务逐公司备份三面：

| 面 | 产物 | 方式 |
|---|---|---|
| platform | `core-platform-<slug>-<ts>.tgz` | `tar -czf - -C <companyDir> platform`（保留 `platform/` 相对结构） |
| ledger.sqlite | `core-ledger-<slug>-<ts>.db.gz` | `sqlite3 .backup` 在线热备 → `integrity_check=ok` → gzip（与 chatd 同法） |
| company | `core-company-<slug>-<ts>.tgz` | `tar -czf - -C <companyDir> company`（git 目录整树） |

- `<slug>` = 公司目录名（如 `studio-dev`）；**缺目录/缺文件=SKIP 不算失败**（该公司未部署该面
  是正常态），SUMMARY 记 `core.skipped`；**同一 run 两个不同目录同名（同 slug 冲突）=用法错
  exit 2**，绝不静默覆盖。
- 三面产物全 600、入同一 `.platform-backup-manifest`、同 7 天保留策略；SUMMARY 增
  `"core":{"backed":N,"skipped":M}`；退出码不受 SKIP 影响。
- 指定公司：`--core-company <companyDir>`（可重复）或 env `PLATFORM_BACKUP_CORE_COMPANIES`
  （冒号分隔多公司目录；与 flag 合并去重）。

安装侧提示（已装 launchd 实例**不重装**，改参数后 `bootout`+`bootstrap` 生效）：在 ProgramArguments
的脚本参数后追加（每公司一条）：

```xml
<string>--core-company</string><string>&lt;companyDir&gt;</string>
```

巡检与恢复（示意；恢复 ledger 前先停 daemon，恢复后对账台账事件数）：

```sh
ls <backupDir>/core-*.tgz <backupDir>/core-*.db.gz    # 巡检：core 产物照常产出
tar -xzf core-platform-<slug>-<ts>.tgz -C <companyDir>   # 回 platform/（相对结构直落）
gzip -dc core-ledger-<slug>-<ts>.db.gz > <companyDir>/ledger.sqlite
tar -xzf core-company-<slug>-<ts>.tgz -C <companyDir>   # 回 company/ git 目录
```


## 七、无 Docker/外置盘部署的 TCC 要点（2026-11-21 增补）

- 备份计划任务**不能**由 launchd 直接 `/bin/bash` 启动：bash/sqlite3 子进程无外置卷 TCC 授权，`sqlite3 .backup` 失败（实测 `FAIL chatd ... .backup 失败`）。
- 修法同 profit daemon：**launchd → node（FDA）→ spawn('/bin/bash',[script,...])**，见 `scripts/ops/backup-wrapper.mjs`；plist ProgramArguments = node + wrapper + 脚本实例路径。
- 首跑核对（2026-11-21 06:17）：`SUMMARY ok:true, docker.skipped=true, chatd.backed=1, core.backed=3, durationMs=56000`（Docker 已退役，SKIP 属预期）。
