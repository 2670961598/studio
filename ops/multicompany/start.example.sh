#!/bin/bash
# Per-company daemon launcher (ref=786). Install as <COMPANY_ROOT>/ops/start.sh (chmod 600/700).
# Secrets live ONLY in <COMPANY_ROOT>/credentials/daemon.env (chmod 600) — never in git/guardian.json.
set -euo pipefail
COMPANY_ROOT="<COMPANY_ROOT>"
ENV_FILE="$COMPANY_ROOT/credentials/daemon.env"
[ -r "$ENV_FILE" ] || { echo "missing credentials file: $ENV_FILE" >&2; exit 78; }
set -a; . "$ENV_FILE"; set +a
cd "<DEPLOY_WORKSPACE>"
exec "<NODE_BIN>" apps/boot/src/main.ts "$COMPANY_ROOT/company/daemon.yaml"
