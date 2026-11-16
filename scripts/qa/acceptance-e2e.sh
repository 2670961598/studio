#!/usr/bin/env bash
# acceptance-e2e.sh —— 验收口径 CLOSE 全链本地真机 E2E（task-43 F2 可复现脚本）
#
# 前置：仓根执行；依赖 node(24) + bun；不触碰生产，仅用临时目录/随机 apiPort。
# 链路：本地真实 daemon（localfile fake 平台，acceptanceEnforce: enforce）启动后建一张
#       「已交付」功能单（description 含 acceptance 验收块）→ 验收闸 HOLD（无验收结论，
#       不 CLOSE）→ `acceptance record --status pass` → 下一拍 CLOSE 放行。
# 用法：STUDIO_GATEWAY_SECRET=<>=32B 临时值> bash scripts/qa/acceptance-e2e.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
E2E="$(mktemp -d "${TMPDIR:-/tmp}/sn-accept-e2e-XXXXXX")"
export E2E
mkdir -p "$E2E/var" "$E2E/platform"
cat > "$E2E/daemon.yaml" <<YAML
db: $E2E/var/ledger.sqlite
platform: localfile
platformDir: $E2E/platform
company: demo
rootDir: $E2E/var
tickMs: 200
jobs: false
mirrorRescanEveryTicks: 1
maxActionsPerTick: 5
autoApprove: true
acceptanceEnforce: enforce
apiPort: 0
YAML
cleanup() { if [ -f "$E2E/pid" ]; then kill "$(cat "$E2E/pid")" 2>/dev/null || true; fi }
trap cleanup EXIT
cd "$ROOT"
STUDIO_GATEWAY_SECRET="${STUDIO_GATEWAY_SECRET:-local-e2e-secret-1234567890abcdef}" \
  node apps/boot/src/main.ts "$E2E/daemon.yaml" > "$E2E/daemon.log" 2>&1 &
echo $! > "$E2E/pid"
for _ in $(seq 1 50); do grep -q 'tick#1 ' "$E2E/daemon.log" 2>/dev/null && break; sleep 0.2; done
bun -e '
import { createLocalPlatform } from "./packages/localplatform/src/index.ts"
const desc = "<!-- acceptance: {\"criteria\":[{\"id\":\"A1\",\"check\":\"CLOSE 前需验收结论\",\"evidence\":\"台账 APPROVE;REPORT.md\"}],\"risk_level\":\"low\"} -->"
const p = createLocalPlatform(process.env.E2E + "/platform")
const i = await p.issues.create({ title: "验收 E2E 单", description: desc, type: "devtask", dept: "departments/工程部", level: 2, assignee: "AGENT-1", initialState: "已交付" })
console.log("created", i.id)
'
sleep 1.5
HOLD=$(bun -e '
import { openLedger } from "./packages/store/src/index.ts"
const l = openLedger(process.env.E2E + "/var/ledger.sqlite")
const ev = l.queryEvents({ company: "demo" })
console.log(ev.filter((e) => e.event === "ESCALATE" && (e.note ?? "").includes("ACCEPTANCE_HOLD")).length + " " + ev.filter((e) => e.event === "CLOSE").length)
l.close()
')
set -- $HOLD
if [ "${1:-0}" -lt 1 ] || [ "${2:-0}" -ne 0 ]; then echo "FAIL: 缺验收未 HOLD 或已 CLOSE（HOLD=$1 CLOSE=$2）" >&2; exit 1; fi
echo "PASS: 缺验收结论 → ACCEPTANCE_HOLD（未 CLOSE）"
bun apps/daemon/src/cli/main.ts acceptance record --db "$E2E/var/ledger.sqlite" --company demo --ticket LOCAL-1 \
  --status pass --by verifier --evidence 'REPORT.md;verify:v2 exit0' --signoff lead-verifier >/dev/null
sleep 1.5
CLOSE=$(bun -e '
import { openLedger } from "./packages/store/src/index.ts"
const l = openLedger(process.env.E2E + "/var/ledger.sqlite")
const ev = l.queryEvents({ company: "demo" })
console.log(ev.filter((e) => e.event === "CLOSE").length)
l.close()
')
if [ "${CLOSE:-0}" -lt 1 ]; then echo "FAIL: record pass 后未 CLOSE" >&2; exit 1; fi
echo "PASS: record pass → CLOSE 放行"
echo "EVIDENCE: $E2E (daemon.log/ledger.sqlite/platform)"
