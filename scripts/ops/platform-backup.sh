#!/bin/bash
# platform-backup.sh —— Taiga/Matrix 每日备份（ops，2026-11-17 制作人批准计划任务）
#
# 设计：
#   - Taiga：docker exec taiga-docker-taiga-db-1 pg_dumpall -U taiga | gzip → taiga-pg-<ts>.sql.gz
#   - Matrix：容器内 sqlite3 backup API 生成一致性快照 → docker cp → gzip matrix-hs-<ts>.db.gz；
#             另从 /data 打包 homeserver.yaml/signing key/日志配置 → matrix-config-<ts>.tgz（600）
#   - 每个产物 gzip -t / size / 行数 sanity；失败非零退出、保留 .err 日志；
#   - 保留最近 7 天**仅限本脚本清单**（manifest），绝不删除非本脚本产物；
#   - mkdir 原子锁 + pid 存活检测（同一天重复/并发安全）；日志+摘要 JSON 落 <backupDir>/backup.log。
#
# 用法：platform-backup.sh [--dry-run] [--backup-dir DIR] [--keep-days N]
#   环境：PLATFORM_BACKUP_DIR（缺省 $HOME/backups/studio-next；生产建议显式指向备份盘，如 <backupDir>）
#   退出：0=成功；1=备份/校验/锁失败；2=用法错误。
set -euo pipefail
umask 077

BACKUP_DIR="${PLATFORM_BACKUP_DIR:-$HOME/backups/studio-next}"
KEEP_DAYS=7
DRY_RUN=0
TAIGA_DB_CONTAINER="taiga-docker-taiga-db-1"
MATRIX_CONTAINER="matrix-synapse"

usage() {
  cat <<'USAGE'
用法：platform-backup.sh [--dry-run] [--backup-dir DIR] [--keep-days N]
  --dry-run        只打印将执行命令，不创建目录/不写备份/不取锁
  --backup-dir     备份目录（缺省 $PLATFORM_BACKUP_DIR 或 $HOME/backups/studio-next）
  --keep-days      保留天数（缺省 7；仅清理本脚本 manifest 记录的产物）
环境：PLATFORM_BACKUP_DIR
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --backup-dir) BACKUP_DIR="${2:-}"; shift 2 ;;
    --keep-days) KEEP_DAYS="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "platform-backup: 未知参数 $1" >&2; usage >&2; exit 2 ;;
  esac
done
case "$BACKUP_DIR" in '') echo "platform-backup: backup-dir 不能为空" >&2; exit 2 ;; esac
case "$KEEP_DAYS" in ''|*[!0-9]*) echo "platform-backup: keep-days 须为正整数" >&2; exit 2 ;; esac
[ "$KEEP_DAYS" -ge 1 ] || { echo "platform-backup: keep-days 须 >=1" >&2; exit 2; }

TS="$(date +%Y%m%d-%H%M%S)"
TAIGA_GZ="${BACKUP_DIR}/taiga-pg-${TS}.sql.gz"
TAIGA_ERR="${BACKUP_DIR}/taiga-pg-${TS}.err"
MATRIX_TMP_DB="/tmp/matrix-hs-${TS}-$$.db"
MATRIX_GZ="${BACKUP_DIR}/matrix-hs-${TS}.db.gz"
MATRIX_CONFIG="${BACKUP_DIR}/matrix-config-${TS}.tgz"
LOCK_DIR="${BACKUP_DIR}/.platform-backup.lock"
MANIFEST="${BACKUP_DIR}/.platform-backup-manifest"
LOG="${BACKUP_DIR}/backup.log"

log_line() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG"; }
fail() {
  log_line "FAIL $*"
  echo "platform-backup: FAIL $*" >&2
  exit 1
}
cleanup() {
  local code=$?
  if [ -d "$LOCK_DIR" ] && [ "$(cat "$LOCK_DIR/pid" 2>/dev/null || true)" = "$$" ]; then rm -rf "$LOCK_DIR"; fi
  exit "$code"
}
trap cleanup EXIT

if [ "$DRY_RUN" = 1 ]; then
  cat <<EOF
platform-backup dry-run：backupDir=${BACKUP_DIR} keepDays=${KEEP_DAYS} ts=${TS}
  docker exec ${TAIGA_DB_CONTAINER} pg_dumpall -U taiga | gzip > ${TAIGA_GZ} 2> ${TAIGA_ERR}
  gzip -t ${TAIGA_GZ}; gzip -dc ${TAIGA_GZ} | wc -l
  docker exec -i ${MATRIX_CONTAINER} python3 - ${MATRIX_TMP_DB} (sqlite3 backup API + integrity_check)
  docker cp ${MATRIX_CONTAINER}:${MATRIX_TMP_DB} ${BACKUP_DIR}/matrix-hs-${TS}.db
  gzip ${BACKUP_DIR}/matrix-hs-${TS}.db; gzip -t ${MATRIX_GZ}
  docker exec ${MATRIX_CONTAINER} tar -czf - -C /data homeserver.yaml localhost.signing.key localhost.log.config > ${MATRIX_CONFIG}
  chmod 600 ${MATRIX_CONFIG}; tar -tzf ${MATRIX_CONFIG}
  retention: 仅删 ${MANIFEST} 中记录且 mtime 超过 ${KEEP_DAYS} 天的本脚本产物
EOF
  exit 0
fi

mkdir -p "$BACKUP_DIR"
command -v docker >/dev/null 2>&1 || fail "docker CLI 不在 PATH"
docker inspect -f '{{.State.Running}}' "$TAIGA_DB_CONTAINER" 2>/dev/null | grep -q true || fail "Taiga DB 容器未运行：${TAIGA_DB_CONTAINER}"
docker inspect -f '{{.State.Running}}' "$MATRIX_CONTAINER" 2>/dev/null | grep -q true || fail "Matrix 容器未运行：${MATRIX_CONTAINER}"
# 原子目录锁（macOS bash 3.2 无 flock）；死 pid/异常残留锁自动清理一次
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  old_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
    fail "另一备份进程仍在运行（lock pid=${old_pid}）"
  fi
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR" || fail "无法获取备份锁：${LOCK_DIR}"
fi
printf '%s\n' "$$" > "$LOCK_DIR/pid"
touch "$MANIFEST"

START_EPOCH="$(date +%s)"
log_line "START ts=${TS} dir=${BACKUP_DIR} keepDays=${KEEP_DAYS}"

# —— Taiga ——
if ! docker exec "$TAIGA_DB_CONTAINER" pg_dumpall -U taiga 2>"$TAIGA_ERR" | gzip > "$TAIGA_GZ"; then
  fail "Taiga pg_dumpall 失败（stderr=${TAIGA_ERR}）"
fi
gzip -t "$TAIGA_GZ" || fail "Taiga gzip 校验失败：${TAIGA_GZ}"
TAIGA_SIZE="$(stat -f%z "$TAIGA_GZ" 2>/dev/null || stat -c%s "$TAIGA_GZ")"
[ "$TAIGA_SIZE" -gt 0 ] || fail "Taiga 备份为空：${TAIGA_GZ}"
chmod 600 "$TAIGA_GZ"
TAIGA_LINES="$(gzip -dc "$TAIGA_GZ" | wc -l | tr -d ' ')"
[ "$TAIGA_LINES" -ge 1 ] || fail "Taiga dump 行数异常=0：${TAIGA_GZ}"
printf '%s|%s\n' "$START_EPOCH" "$(basename "$TAIGA_GZ")" >> "$MANIFEST"
touch "$TAIGA_ERR"; printf '%s|%s\n' "$START_EPOCH" "$(basename "$TAIGA_ERR")" >> "$MANIFEST"
log_line "OK taiga file=$(basename "$TAIGA_GZ") size=${TAIGA_SIZE} lines=${TAIGA_LINES}"

# —— Matrix DB（容器内 SQLite backup API，避免热拷 WAL） ——
if ! docker exec -i "$MATRIX_CONTAINER" python3 - "$MATRIX_TMP_DB" <<'PY'
import sqlite3, sys
src = sqlite3.connect('/data/homeserver.db')
dst = sqlite3.connect(sys.argv[1])
try:
    src.backup(dst)
    check = dst.execute('PRAGMA integrity_check').fetchone()
    if not check or check[0] != 'ok':
        raise SystemExit('integrity_check failed: %r' % (check,))
finally:
    dst.close(); src.close()
PY
then
  fail "Matrix sqlite backup API 失败（容器内 ${MATRIX_TMP_DB}）"
fi
docker cp "${MATRIX_CONTAINER}:${MATRIX_TMP_DB}" "${BACKUP_DIR}/matrix-hs-${TS}.db" >/dev/null || fail "docker cp Matrix 备份失败"
docker exec "$MATRIX_CONTAINER" rm -f "$MATRIX_TMP_DB" >/dev/null 2>&1 || true
gzip -f "${BACKUP_DIR}/matrix-hs-${TS}.db" || fail "Matrix gzip 失败"
gzip -t "$MATRIX_GZ" || fail "Matrix gzip 校验失败：${MATRIX_GZ}"
chmod 600 "$MATRIX_GZ"
MATRIX_SIZE="$(stat -f%z "$MATRIX_GZ" 2>/dev/null || stat -c%s "$MATRIX_GZ")"
[ "$MATRIX_SIZE" -gt 0 ] || fail "Matrix 备份为空：${MATRIX_GZ}"
printf '%s|%s\n' "$START_EPOCH" "$(basename "$MATRIX_GZ")" >> "$MANIFEST"
log_line "OK matrix file=$(basename "$MATRIX_GZ") size=${MATRIX_SIZE}"

# —— Matrix 配置（含 signing key，600；仅本地/勿外发） ——
if ! docker exec "$MATRIX_CONTAINER" tar -czf - -C /data homeserver.yaml localhost.signing.key localhost.log.config > "$MATRIX_CONFIG"; then
  rm -f "$MATRIX_CONFIG"
  fail "Matrix 配置打包失败"
fi
chmod 600 "$MATRIX_CONFIG"
tar -tzf "$MATRIX_CONFIG" >/dev/null || fail "Matrix 配置 tgz 校验失败"
CONFIG_SIZE="$(stat -f%z "$MATRIX_CONFIG" 2>/dev/null || stat -c%s "$MATRIX_CONFIG")"
[ "$CONFIG_SIZE" -gt 0 ] || fail "Matrix 配置备份为空"
printf '%s|%s\n' "$START_EPOCH" "$(basename "$MATRIX_CONFIG")" >> "$MANIFEST"
log_line "OK matrix-config file=$(basename "$MATRIX_CONFIG") size=${CONFIG_SIZE} mode=600"

# —— 保留策略：仅清理 manifest 内、超过 KEEP_DAYS 的本脚本产物 ——
NOW="$(date +%s)"
KEEP_SECONDS=$((KEEP_DAYS * 86400))
TMP_MANIFEST="${MANIFEST}.tmp.$$"
DELETED=0
: > "$TMP_MANIFEST"
while IFS='|' read -r epoch name; do
  [ -n "${epoch:-}" ] || continue
  case "$name" in
    taiga-pg-*.sql.gz|taiga-pg-*.err|matrix-hs-*.db.gz|matrix-config-*.tgz) ;;
    *) continue ;; # 非本脚本命名：保留（不写回清单）
  esac
  if [ $((NOW - epoch)) -gt "$KEEP_SECONDS" ]; then
    rm -f "${BACKUP_DIR}/${name}" && DELETED=$((DELETED + 1))
  else
    printf '%s|%s\n' "$epoch" "$name" >> "$TMP_MANIFEST"
  fi
done < "$MANIFEST"
mv "$TMP_MANIFEST" "$MANIFEST"
log_line "OK retention deleted=${DELETED} keepDays=${KEEP_DAYS}"

END_EPOCH="$(date +%s)"
SUMMARY="{\"ok\":true,\"ts\":\"${TS}\",\"backupDir\":\"${BACKUP_DIR}\",\"taiga\":{\"file\":\"$(basename "$TAIGA_GZ")\",\"size\":${TAIGA_SIZE},\"lines\":${TAIGA_LINES}},\"matrix\":{\"file\":\"$(basename "$MATRIX_GZ")\",\"size\":${MATRIX_SIZE}},\"matrixConfig\":{\"file\":\"$(basename "$MATRIX_CONFIG")\",\"size\":${CONFIG_SIZE}},\"retentionDeleted\":${DELETED},\"durationMs\":$(((END_EPOCH - START_EPOCH) * 1000))}"
log_line "SUMMARY ${SUMMARY}"
printf '%s\n' "$SUMMARY"
