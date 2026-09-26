#!/bin/bash
# lab-init — 把框架克隆成实验场（独立 kernel 状态/独立面板端口/独立项目域/治理岗关闭）
# 用法: tools/lab-init.sh /path/to/Studio-Lab [源仓目录，默认 /Volumes/BigDisk/Studio]
# 原则：实验场绝不碰生产——不共享 kernel（锁/证据/战役/日志全独立），
#       不跑治理岗（self-eval/patrol/evolve/报告会写生产板面），不杀生产进程。
set -euo pipefail
DST="${1:?用法: lab-init.sh <目标目录> [源仓]}"
SRC="${2:-/Volumes/BigDisk/Studio}"
[ -e "$DST" ] && { echo "目标已存在: $DST（换一个空目录）"; exit 1; }

git clone -q "$SRC" "$DST"
cd "$DST/studio-daemon"
python3 -m venv .venv
.venv/bin/pip install -q apscheduler sqlalchemy uvicorn fastapi requests pyyaml pytest requests-mock

# 运行时文件不入库（token 只在 ~/.config；项目 ID 映射从生产拷一份起步）
for f in youtrack-ids.json; do
  if [ -f "$SRC/kernel/$f" ] && [ ! -f "../kernel/$f" ]; then
    cp "$SRC/kernel/$f" "../kernel/$f"
  fi
done

cat > run-lab.sh <<'EOF'
#!/bin/bash
# 实验场启动：STUDIO_ROOT 指向本克隆 → kernel 状态全隔离；治理岗关闭
cd "$(dirname "$0")"
export STUDIO_ROOT="$(cd .. && pwd)"
export STUDIO_PORT="${STUDIO_PORT:-8788}"
export STUDIO_PROJECTS="${STUDIO_PROJECTS:-}"   # 留空=不装 pm 岗（纯引擎/测试）；有沙箱项目再填
export STUDIO_GOVERNANCE=0
exec .venv/bin/python -m studio.daemon run
EOF
chmod +x run-lab.sh

echo "实验场就绪: $DST"
echo "  冒烟:  cd $DST/studio-daemon && .venv/bin/python -m pytest tests/ -q"
echo "  运行:  ./run-lab.sh   （面板 http://127.0.0.1:8788；治理岗关闭，不写生产板）"
echo "  回流:  生产仓执行 git fetch $DST && git merge <分支>，照纪律 pytest 全绿 → pkill 拉起"
