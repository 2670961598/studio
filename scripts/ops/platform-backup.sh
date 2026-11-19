#!/bin/bash
# platform-backup.sh —— Taiga/Matrix/chatd 每日备份（ops，2026-11-17 制作人批准计划任务；
#                        2026-11-19 M4.5 增 chatd SQLite 面）
#
# 设计：
#   - Taiga：docker exec taiga-docker-taiga-db-1 pg_dumpall -U taiga | gzip → taiga-pg-<ts>.sql.gz
#   - Matrix：容器内 sqlite3 backup API 生成一致性快照 → docker cp → gzip matrix-hs-<ts>.db.gz；
#             另从 /data 打包 homeserver.yaml/signing key/日志配置 → matrix-config-<ts>.tgz（600）
#   - chatd（M4.5）：宿主机 <companyDir>/var/workbench/chat.db 用 sqlite3 在线 backup
#             （`.backup`，等价 Matrix 容器内做法——页级快照，热库/WAL 安全）→ 拷贝上
#             PRAGMA integrity_check → gzip chatd-<slug>-<ts>.db.gz（600）。**文件缺失=SKIP
#             不报错**（公司未装 sidecar/未初始化是正常态）；同一 run 同 slug 冲突才 fail。
#   - 每个产物 gzip -t / size / 行数 sanity；失败非零退出、保留 .err 日志；
#   - 保留最近 7 天**仅限本脚本清单**（manifest），绝不删除非本脚本产物；
#   - mkdir 原子锁 + pid 存活检测（同一天重复/并发安全）；日志+摘要 JSON 落 <backupDir>/backup.log。
#
# 用法：platform-backup.sh [--dry-run] [--backup-dir DIR] [--keep-days N] [--chatd-db <chat.db>]...
#   环境：PLATFORM_BACKUP_DIR（缺省 $HOME/backups/studio-next；生产建议显式指向备份盘，如 <backupDir>）
#         PLATFORM_BACKUP_CHATD_DBS（冒号分隔多个 chat.db；与 --chatd-db 合并去重）
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
用法：platform-backup.sh [--dry-run] [--backup-dir DIR] [--keep-days N] [--chatd-db <chat.db>]...
  --dry-run        只打印将执行命令，不创建目录/不写备份/不取锁
  --backup-dir     备份目录（缺省 $PLATFORM_BACKUP_DIR 或 $HOME/backups/studio-next）
  --keep-days      保留天数（缺省 7；仅清理本脚本 manifest 记录的产物）
  --chatd-db       chatd SQLite 路径（可重复；缺省布局 <companyDir>/var/workbench/chat.db；
                   文件缺失=SKIP 不报错；建议每公司一条）
环境：PLATFORM_BACKUP_DIR、PLATFORM_BACKUP_CHATD_DBS（冒号分隔，与 --chatd-db 合并去重）
USAGE
}

CHATD_DBS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --backup-dir) BACKUP_DIR="${2:-}"; shift 2 ;;
    --keep-days) KEEP_DAYS="${2:-}"; shift 2 ;;
    --chatd-db) CHATD_DBS+=("${2:-}"); shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "platform-backup: 未知参数 $1" >&2; usage >&2; exit 2 ;;
  esac
done
case "$BACKUP_DIR" in '') echo "platform-backup: backup-dir 不能为空" >&2; exit 2 ;; esac
case "$KEEP_DAYS" in ''|*[!0-9]*) echo "platform-backup: keep-days 须为正整数" >&2; exit 2 ;; esac
[ "$KEEP_DAYS" -ge 1 ] || { echo "platform-backup: keep-days 须 >=1" >&2; exit 2; }

# —— chatd 库清单（M4.5）：--chatd-db 重复项 + env 冒号清单 → 合并去重校验 ——
NL=$'\n'
CHATD_SEEN=""
CHATD_DB_LIST=""
if [ -n "${PLATFORM_BACKUP_CHATD_DBS:-}" ]; then
  oldIFS=$IFS; IFS=:
  for d in $PLATFORM_BACKUP_CHATD_DBS; do CHATD_DBS+=("$d"); done
  IFS=$oldIFS
fi
for d in ${CHATD_DBS[@]+"${CHATD_DBS[@]}"}; do
  case "$d" in '') echo "platform-backup: --chatd-db 不能为空" >&2; exit 2 ;; esac
  case "$d" in /*) ;; *) echo "platform-backup: --chatd-db 须为绝对路径：$d" >&2; exit 2 ;; esac
  case "$CHATD_SEEN" in *"$d"$NL*) continue ;; esac
  CHATD_SEEN="$CHATD_SEEN$d$NL"
  CHATD_DB_LIST="$CHATD_DB_LIST$d$NL"
done

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

# chatd 库名 slug（M4.5）：<companyDir>/var/workbench/chat.db → <companyDir 名>（三层上溯）；
# 布局不符（直接指到别处）→ 中性名 chatd，绝不因命名猜错而 fail。
chatd_slug() {
  local slug
  slug="$(basename "$(dirname "$(dirname "$(dirname "$1")")")")"
  case "$slug" in ''|'.'|'/'|'var'|'workbench') echo chatd ;;
  *) echo "$slug" ;;
  esac
}

# chatd 单库在线备份（M4.5）：缺失 SKIP；sqlite3 .backup（页级快照，热库/WAL 安全）→
# 拷贝上 integrity_check → gzip 600 → manifest（与 Taiga/Matrix 同格式/同一保留策略）。
backup_chatd_db() {
  local db="$1" slug gz tmp size
  if [ ! -f "$db" ]; then
    log_line "SKIP chatd db=${db}（缺失=未安装/未初始化，不算失败）"
    echo "platform-backup: SKIP chatd ${db}（缺失）"
    CHATD_SKIPPED=$((CHATD_SKIPPED + 1))
    return 0
  fi
  command -v sqlite3 >/dev/null 2>&1 || fail "sqlite3 不在 PATH（chatd 备份需要）"
  slug="$(chatd_slug "$db")"
  gz="${BACKUP_DIR}/chatd-${slug}-${TS}.db.gz"
  tmp="${BACKUP_DIR}/.chatd-${slug}-${TS}-$$.db"
  [ -e "$gz" ] && fail "chatd ${slug} 目标已存在（同一 run 内同 slug 冲突）：${gz}"
  sqlite3 "$db" ".backup '${tmp}'" || { rm -f "$tmp"; fail "chatd ${slug} sqlite3 .backup 失败：${db}"; }
  [ -f "$tmp" ] || fail "chatd ${slug} .backup 未产出文件：${tmp}"
  [ "$(sqlite3 "$tmp" 'PRAGMA integrity_check;' 2>/dev/null)" = "ok" ] || { rm -f "$tmp"; fail "chatd ${slug} integrity_check 失败（备份副本损坏）"; }
  gzip -c "$tmp" > "$gz" || { rm -f "$tmp" "$gz"; fail "chatd ${slug} gzip 失败"; }
  rm -f "$tmp"
  gzip -t "$gz" || fail "chatd ${slug} gzip 校验失败：${gz}"
  chmod 600 "$gz"
  size="$(stat -f%z "$gz" 2>/dev/null || stat -c%s "$gz")"
  [ "$size" -gt 0 ] || fail "chatd ${slug} 备份为空：${gz}"
  printf '%s|%s\n' "$START_EPOCH" "$(basename "$gz")" >> "$MANIFEST"
  log_line "OK chatd slug=${slug} file=$(basename "$gz") size=${size} mode=600"
  echo "platform-backup: OK chatd slug=${slug} file=$(basename "$gz") size=${size}"
  CHATD_BACKED=$((CHATD_BACKED + 1))
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
  chatd(M4.5)：每库 sqlite3 <db> ".backup <tmp>" → integrity_check → gzip chatd-<slug>-${TS}.db.gz（600）；缺失=SKIP
  retention: 仅删 ${MANIFEST} 中记录且 mtime 超过 ${KEEP_DAYS} 天的本脚本产物
EOF
  while IFS= read -r db; do
    [ -n "$db" ] || continue
    echo "  chatd db=${db} slug=$(chatd_slug "$db") → ${BACKUP_DIR}/chatd-$(chatd_slug "$db")-${TS}.db.gz$([ -f "$db" ] || echo '（缺失→SKIP）')"
  done <<< "$CHATD_DB_LIST"
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

# —— chatd SQLite（M4.5；宿主机在线 .backup；缺失=SKIP 不报错） ——
CHATD_BACKED=0
CHATD_SKIPPED=0
while IFS= read -r db; do
  [ -n "$db" ] || continue
  backup_chatd_db "$db"
done <<< "$CHATD_DB_LIST"

# —— 保留策略：仅清理 manifest 内、超过 KEEP_DAYS 的本脚本产物 ——
NOW="$(date +%s)"
KEEP_SECONDS=$((KEEP_DAYS * 86400))
TMP_MANIFEST="${MANIFEST}.tmp.$$"
DELETED=0
: > "$TMP_MANIFEST"
while IFS='|' read -r epoch name; do
  [ -n "${epoch:-}" ] || continue
  case "$name" in
    taiga-pg-*.sql.gz|taiga-pg-*.err|matrix-hs-*.db.gz|matrix-config-*.tgz|chatd-*.db.gz) ;;
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
SUMMARY="{\"ok\":true,\"ts\":\"${TS}\",\"backupDir\":\"${BACKUP_DIR}\",\"taiga\":{\"file\":\"$(basename "$TAIGA_GZ")\",\"size\":${TAIGA_SIZE},\"lines\":${TAIGA_LINES}},\"matrix\":{\"file\":\"$(basename "$MATRIX_GZ")\",\"size\":${MATRIX_SIZE}},\"matrixConfig\":{\"file\":\"$(basename "$MATRIX_CONFIG")\",\"size\":${CONFIG_SIZE}},\"chatd\":{\"backed\":${CHATD_BACKED},\"skipped\":${CHATD_SKIPPED}},\"retentionDeleted\":${DELETED},\"durationMs\":$(((END_EPOCH - START_EPOCH) * 1000))}"
log_line "SUMMARY ${SUMMARY}"
printf '%s\n' "$SUMMARY"
