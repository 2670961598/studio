#!/bin/bash
# Single shared :8789 overview instance for all companies (ref=786; 787 单实例+仅环回).
# 787：overview CLI 自带单实例锁 + 缺省仅环回；对外需制作人批（OVERVIEW_ALLOW_LAN=1 + 网关/只读 token）。
# NOTE: current CLI accepts only one --db. Multi-company progress/finance per-company
# ledger wiring is a follow-up; until then finance/progress may degrade — see docs/90-§九.
set -euo pipefail
cd "<DEPLOY_WORKSPACE>"
exec "<NODE_BIN>" apps/daemon/src/cli/main.ts overview \
  --company "<COMPANY_DIR_1>" \
  --company "<COMPANY_DIR_2>" \
  --port 8789 \
  --host 127.0.0.1
