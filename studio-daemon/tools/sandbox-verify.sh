#!/bin/bash
# sandbox-verify — 验证闸（制作人 2026-09-27 指令：一切改进/建议必须先在临时目录
# 验证、确认价值后才准进生产，杜绝 AI 一拍脑袋）。
# STUDIO-90 双洞修复（2026-09-30，76/80/81 三单 worker 独立复现）：
#   洞① timeout 静默失效：macOS 无 GNU timeout，eval 必败 127——VERIFY_CMD 从未
#      真跑（80 单 verify_exit=127 实录）；VERIFY_CMD 为空时 VERIFY_OK=0 假记"通过"
#      （76 单实录）。修：timeout/gtimeout 探测兜底 + 退出码直取不经管道 + 为空显式记"跳过"。
#   洞② worker 运行期不可用：裸 clone 取源仓 HEAD——施工期 HEAD=feature 分支（补丁
#      已在其中），双重 apply 必 FAIL（79 单实录）。修：显式克隆基线分支。
# 用法: tools/sandbox-verify.sh <patch.diff> [额外验证命令（在沙箱 studio-daemon 目录跑）]
#       环境变量 SANDBOX_BASE 覆盖基线分支（默认 master）
# 流程: 临时目录克隆生产仓基线分支 → git apply 补丁 → 生产 venv 跑全套 pytest →
#       （可选）跑针对性验证命令 → 输出 verdict JSON。
# 裁定 PASS：补丁可应用 + 测试全绿 + 验证命令 exit 0（未提供验证命令时该闸记"跳过"，
# 仅测试定裁定）。沙箱目录保留（不删）：PASS 留给复核，FAIL 留给排障；路径打进 verdict。
set -uo pipefail
PATCH="${1:?用法: sandbox-verify.sh <patch.diff> [验证命令]}"
VERIFY_CMD="${2:-}"
BASE="${SANDBOX_BASE:-master}"
PROD="/Volumes/BigDisk/Studio"
PY="$PROD/studio-daemon/.venv/bin/python"     # 复用生产 venv（studio 包按路径导入，不装进 venv）
TS=$(date +%Y%m%d-%H%M%S)
SB="/tmp/studio-verify-$TS"

# 洞②：显式克隆基线分支。裸 clone 取源仓 HEAD，worker 施工期 HEAD=feature 分支
# （补丁已在其中）→ git apply --check 必 FAIL；基线不存在时 clone 失败走 CLONE-FAIL 兜底。
git clone -q --branch "$BASE" "$PROD" "$SB" || { echo '{"verdict":"CLONE-FAIL"}'; exit 2; }
# apply 必须在仓库根：子目录执行时新文件前缀解析有歧义（kernel/org.yaml 实录：patch 含而未落盘）
(cd "$SB" && git apply --check "$PATCH" 2>&1 && git apply "$PATCH")
apply_rc=$?
cd "$SB/studio-daemon" || exit 2
[ $apply_rc -ne 0 ] && { printf '{"verdict":"APPLY-FAIL","sandbox":"%s"}\n' "$SB"; exit 1; }


TESTS_OUT=$("$PY" -m pytest tests/ -q 2>&1 | tail -1)
TESTS_OK=0
echo "$TESTS_OUT" | grep -qE "^[0-9]+ passed" && echo "$TESTS_OUT" | grep -qv " failed" && TESTS_OK=1

# 洞①之一：GNU timeout 探测（macOS Homebrew 装的是 gtimeout）。两者皆无→放弃时限
# 直接跑（verdict 的 timeout 字段留痕），绝不因 127 让验证命令从未执行。
# 注：不用 timeout(){ "$@"; } 影子函数兜底——那会把首个参数"300"当命令执行。
TIMEOUT_BIN=""
if command -v timeout >/dev/null 2>&1; then TIMEOUT_BIN="timeout 300"
elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT_BIN="gtimeout 300"
fi

# 洞①之二：退出码直取自命令替换（不经 tail/tr 管道，pipefail 之外零歧义）；
# 失败原文先留全量再 tail -3 取尾，verdict 从尾部截 300 字符保关键词（"command not
# found" 类错误必可见）。未提供 VERIFY_CMD 显式记"跳过"，不再借 VERIFY_OK=0 记"通过"。
VERIFY_STATUS="skipped"     # skipped / executed
VERIFY_OUT=""
VERIFY_OK=0
if [ -n "$VERIFY_CMD" ]; then
  VERIFY_STATUS="executed"
  if [ -n "$TIMEOUT_BIN" ]; then
    VERIFY_RAW=$(eval $TIMEOUT_BIN "$VERIFY_CMD" 2>&1)
  else
    VERIFY_RAW=$(eval "$VERIFY_CMD" 2>&1)
  fi
  VERIFY_OK=$?
  VERIFY_OUT=$(printf '%s' "$VERIFY_RAW" | tail -3 | tr '\n' ' ')
fi

if [ "$TESTS_OK" = 1 ] && [ "$VERIFY_OK" = 0 ]; then V="PASS"; else V="FAIL"; fi
python3 - "$SB" "$TESTS_OUT" "$V" "$VERIFY_OK" "$VERIFY_OUT" "$VERIFY_STATUS" "$TIMEOUT_BIN" << 'PYEOF'
import json, sys
sb, tests, v, vok, vout, vstatus, tbin = sys.argv[1:8]
print(json.dumps({"verdict": v, "sandbox": sb, "tests": tests,
                  "verify": vstatus,
                  "verify_exit": (None if vstatus == "skipped" else int(vok)),
                  "verify_out": (vout or "")[-300:],
                  "timeout": (tbin if tbin else "none(直接跑，无时限)"),
                  "rule": "PASS 才准进生产（git am/apply 后提交）；FAIL 排障后重来"}, ensure_ascii=False))
PYEOF
[ "$V" = "PASS" ]
