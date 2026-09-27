#!/bin/bash
# sandbox-verify — 验证闸（制作人 2026-09-27 指令：一切改进/建议必须先在临时目录
# 验证、确认价值后才准进生产，杜绝 AI 一拍脑袋）。
# 用法: tools/sandbox-verify.sh <patch.diff> [额外验证命令（在沙箱 studio-daemon 目录跑）]
# 流程: 临时目录克隆生产仓 → git apply 补丁 → 生产 venv 跑全套 pytest →
#       （可选）跑针对性验证命令 → 写 verdict.json。
# 裁定 PASS：补丁可应用 + 测试全绿 + 验证命令 exit 0。
# 沙箱目录保留（不删）：PASS 留给复核，FAIL 留给排障；路径打进 verdict。
set -uo pipefail
PATCH="${1:?用法: sandbox-verify.sh <patch.diff> [验证命令]}"
VERIFY_CMD="${2:-}"
PROD="/Volumes/BigDisk/Studio"
PY="$PROD/studio-daemon/.venv/bin/python"     # 复用生产 venv（studio 包按路径导入，不装进 venv）
TS=$(date +%Y%m%d-%H%M%S)
SB="/tmp/studio-verify-$TS"

git clone -q "$PROD" "$SB" || { echo '{"verdict":"CLONE-FAIL"}'; exit 2; }
cd "$SB/studio-daemon" || exit 2

apply_out=$(git apply --check "$PATCH" 2>&1) && git apply "$PATCH"
if [ $? -ne 0 ]; then
  printf '{"verdict":"APPLY-FAIL","sandbox":"%s","detail":%s}\n' "$SB" "$(printf '%s' "$apply_out" | head -c 200 | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
  exit 1
fi

TESTS_OUT=$("$PY" -m pytest tests/ -q 2>&1 | tail -1)
TESTS_OK=0
echo "$TESTS_OUT" | grep -qE "^[0-9]+ passed" && echo "$TESTS_OUT" | grep -qv " failed" && TESTS_OK=1

VERIFY_OUT="(未提供额外验证命令)"
VERIFY_OK=0
if [ -n "$VERIFY_CMD" ]; then
  VERIFY_OUT=$(eval timeout 300 "$VERIFY_CMD" 2>&1 | tail -3 | tr '\n' ' ')
  VERIFY_OK=$?
fi

if [ "$TESTS_OK" = 1 ] && [ "$VERIFY_OK" = 0 ]; then V="PASS"; else V="FAIL"; fi
python3 - "$SB" "$TESTS_OUT" "$V" "$VERIFY_OK" "$VERIFY_OUT" << 'PYEOF'
import json, sys
sb, tests, v, vok, vout = sys.argv[1:6]
print(json.dumps({"verdict": v, "sandbox": sb, "tests": tests,
                  "verify_exit": int(vok), "verify_out": vout[:300],
                  "rule": "PASS 才准进生产（git am/apply 后提交）；FAIL 排障后重来"}, ensure_ascii=False))
PYEOF
[ "$V" = "PASS" ]
