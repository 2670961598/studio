# 平台备份与恢复（Taiga/Matrix；ops，2026-11-17）

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
| `backup.log` | 每次运行的 START/OK/FAIL/SUMMARY（JSON行）文本日志 | 600 |
| `.platform-backup-manifest` | 本脚本产物清单（epoch\|文件名）；保留策略只依据此清单 | 600 |

## 2. 校验（脚本内已做；人工复核同法）

```sh
gzip -t taiga-pg-*.sql.gz
gzip -dc taiga-pg-*.sql.gz | wc -l          # 真机 ~52k 行；0=失败
gzip -t matrix-hs-*.db.gz
tar -tzf matrix-config-*.tgz                # 应含 homeserver.yaml/signing key/log config
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
