#!/bin/bash
# studio-daemon 启动入口（launchd 与手动共用）
cd "$(dirname "$0")"
exec .venv/bin/python -m studio.daemon run
