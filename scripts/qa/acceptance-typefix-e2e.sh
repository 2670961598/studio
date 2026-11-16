#!/usr/bin/env bash
# acceptance-typefix-e2e.sh —— task-53 验收闸类型归一 E2E 夹具（本地真实 daemon；不碰生产）
#
# 场景（同一夹具，observe/enforce 各一次）：
#  - scheduled 单：mirror/platform type=task，PATROL note 携 job=<report job>，jobs.payload.type=report
#    → 类型闸按 job 归一为 report-like；enforce 下应 DISPATCH→GATE_PASS→QA_PASS→CLOSE，且该单 ACCEPTANCE_* = 0；
#  - 功能类 task：无 PATROL/job 来源、无 acceptance_criteria
#    → observe 恰好 1 条 ACCEPTANCE_MISSING 且放行；enforce 恰 1 条 ACCEPTANCE_BLOCKED 且无 DISPATCH/work_record。
# 夹具用 fake claude worker（写 REPORT.md/summary.json，result 事件 complete）→ 闭环收割。
# 证据落 /tmp/typefix-e2e2/<mode>/（daemon.log/ledger/config/issues/counts）。
set -euo pipefail
ROOT_REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_BASE="${OUT_BASE:-/tmp/typefix-e2e2}"
export PATH="${PATH:-/usr/bin:/bin}:/opt/homebrew/bin"
export STUDIO_GATEWAY_SECRET="${STUDIO_GATEWAY_SECRET:-$(openssl rand -hex 24)}"
command -v bun >/dev/null || { echo "FAIL: bun 不在 PATH" >&2; exit 2; }
command -v sqlite3 >/dev/null || { echo "FAIL: sqlite3 不在 PATH" >&2; exit 2; }
rm -rf "$OUT_BASE"
mkdir -p "$OUT_BASE"
PASS=0
for MODE in observe enforce; do
  ROOT="$OUT_BASE/$MODE"; mkdir -p "$ROOT/var" "$ROOT/platform"
  cat > "$ROOT/worker.mjs" <<'WORKER'
#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
if (process.argv.includes('--version')) { console.log('2.1.300 (Claude Code)'); process.exit(0) }
mkdirSync('deliverables', { recursive: true })
writeFileSync('REPORT.md', '# acceptance typefix E2E REPORT\nscheduled flow verified\n')
writeFileSync('summary.json', '{"summary":"scheduled acceptance e2e"}\n')
setTimeout(() => { console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'done', usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.001 })) }, 1200)
WORKER
  chmod +x "$ROOT/worker.mjs"
  cat > "$ROOT/agent.yaml" <<YAML
executors:
  claude:
    default: true
    cmd: ['$ROOT/worker.mjs']
YAML
  # 建两单（本地 localfile 平台）；scheduled 单模拟 scheduler 物化：PATROL+jobs.payload.type=report
  ( cd "$ROOT_REPO" && bun -e '
import { createLocalPlatform } from "./packages/localplatform/src/index.ts"
const p = createLocalPlatform(process.argv[1])
const sched = await p.issues.create({ title: "scheduled report-like (platform type=task)", type: "task", level: 1, dept: "departments/研发部", assignee: "PRIME-0", initialState: "新单" })
const func = await p.issues.create({ title: "functional task (no acceptance)", type: "task", level: 1, dept: "departments/研发部", assignee: "PRIME-0", initialState: "新单" })
console.log(JSON.stringify({ sched: sched.id, func: func.id }))
' "$ROOT/platform" > "$ROOT/issues.json" )
  SCHED="$(python3 -c "import json;print(json.load(open('$ROOT/issues.json'))['sched'])")"
  FUNC="$(python3 -c "import json;print(json.load(open('$ROOT/issues.json'))['func'])")"
  ( cd "$ROOT_REPO" && bun -e '
import { openLedger } from "./packages/store/src/index.ts"
import { makeUlid } from "./apps/daemon/src/engine/tools/id.ts"
const [db, ticket] = process.argv.slice(1)
const l = openLedger(db)
l.upsertJob({ job_id: "daily-report-研发部", company: "demo", dept: "departments/研发部", cron: "0 18 * * *", role: "PRIME-0", level: 2, model_tier: "low", payload: { type: "report" }, next_run_at: 0 })
const ts = Date.now()
l.appendEvent({ id: makeUlid(ts), ts, company: "demo", issue: ticket, event: "PATROL", actor: "daemon", attempt: 1, level: 1, dept: "departments/研发部", tokens: { input: 0 }, note: `intent=scheduler|schedule|demo|daily-report-研发部@${ts};job=daily-report-研发部;cron=0 18 * * *;role=PRIME-0;dedup=daily-report-研发部@${ts};来源=scheduler` })
l.close()
' "$ROOT/var/ledger.sqlite" "$SCHED" )
  python3 - "$ROOT" "$SCHED" "$FUNC" "$MODE" <<'PY'
import json,sys
root,sched,func,mode=sys.argv[1:]
sel=[{'ticket':sched,'executor':'claude','source':'ticket','registeredBy':'typefix-e2e','reason':'E2E claude'},{'ticket':func,'executor':'claude','source':'ticket','registeredBy':'typefix-e2e','reason':'E2E claude'}]
cfg=f"""db: {root}/var/ledger.sqlite
platform: localfile
platformDir: {root}/platform
company: demo
rootDir: {root}/var
tickMs: 200
jobs: false
autoApprove: true
agentYaml: {root}/agent.yaml
acceptance: 'test -s REPORT.md && test -s summary.json'
acceptanceEnforce: {mode}
acceptanceEnforceSince: 0
dispatchSelections: '{json.dumps(sel)}'
apiPort: 0
"""
open(root+'/daemon.yaml','w').write(cfg)
PY
  ( cd "$ROOT_REPO" && node apps/boot/src/main.ts "$ROOT/daemon.yaml" > "$ROOT/daemon.log" 2>&1 & echo $! > "$ROOT/pid" )
  # 等待 scheduled 单闭环与功能单预期；最多 40s
  for _ in $(seq 1 80); do
    sleep 0.5
    SQL_SCHED=$(sqlite3 "$ROOT/var/ledger.sqlite" "select count(*) from events where issue='$SCHED' and event='CLOSE';" 2>/dev/null || echo 0)
    SQL_FUNC_BLOCK=$(sqlite3 "$ROOT/var/ledger.sqlite" "select count(*) from events where issue='$FUNC' and (note like 'ACCEPTANCE_BLOCKED%' or note like 'ACCEPTANCE_MISSING%');" 2>/dev/null || echo 0)
    SQL_FUNC_CLOSE=$(sqlite3 "$ROOT/var/ledger.sqlite" "select count(*) from events where issue='$FUNC' and event='CLOSE';" 2>/dev/null || echo 0)
    if [ "$MODE" = enforce ] && [ "$SQL_SCHED" -ge 1 ] && [ "$SQL_FUNC_BLOCK" -ge 1 ]; then break; fi
    if [ "$MODE" = observe ] && [ "$SQL_SCHED" -ge 1 ] && [ "$SQL_FUNC_BLOCK" -ge 1 ] && [ "$SQL_FUNC_CLOSE" -ge 1 ]; then break; fi
  done
  pid="$(cat "$ROOT/pid")"; kill "$pid" 2>/dev/null || true; sleep 0.5
  DB="$ROOT/var/ledger.sqlite"
  {
    echo "mode=$MODE sched=$SCHED func=$FUNC"
    echo "scheduled_acceptance_events=$(sqlite3 "$DB" "select count(*) from events where issue='$SCHED' and note like 'ACCEPTANCE_%';")"
    echo "scheduled_dispatch=$(sqlite3 "$DB" "select count(*) from events where issue='$SCHED' and event='DISPATCH';")"
    echo "scheduled_gate_pass=$(sqlite3 "$DB" "select count(*) from events where issue='$SCHED' and event='GATE_PASS';")"
    echo "scheduled_close=$(sqlite3 "$DB" "select count(*) from events where issue='$SCHED' and event='CLOSE';")"
    echo "functional_acceptance_events=$(sqlite3 "$DB" "select count(*) from events where issue='$FUNC' and note like 'ACCEPTANCE_%';")"
    echo "functional_missing=$(sqlite3 "$DB" "select count(*) from events where issue='$FUNC' and note like 'ACCEPTANCE_MISSING%';")"
    echo "functional_blocked=$(sqlite3 "$DB" "select count(*) from events where issue='$FUNC' and note like 'ACCEPTANCE_BLOCKED%';")"
    echo "functional_dispatch=$(sqlite3 "$DB" "select count(*) from events where issue='$FUNC' and event='DISPATCH';")"
    echo "functional_work_records=$(sqlite3 "$DB" "select count(*) from work_records where issue='$FUNC';")"
    echo "functional_close=$(sqlite3 "$DB" "select count(*) from events where issue='$FUNC' and event='CLOSE';")"
  } | tee "$ROOT/counts.txt"
  SA=$(awk -F= '/^scheduled_acceptance_events=/{print $2}' "$ROOT/counts.txt")
  SD=$(awk -F= '/^scheduled_dispatch=/{print $2}' "$ROOT/counts.txt")
  SG=$(awk -F= '/^scheduled_gate_pass=/{print $2}' "$ROOT/counts.txt")
  SC=$(awk -F= '/^scheduled_close=/{print $2}' "$ROOT/counts.txt")
  FA=$(awk -F= '/^functional_acceptance_events=/{print $2}' "$ROOT/counts.txt")
  FB=$(awk -F= '/^functional_blocked=/{print $2}' "$ROOT/counts.txt")
  FM=$(awk -F= '/^functional_missing=/{print $2}' "$ROOT/counts.txt")
  FD=$(awk -F= '/^functional_dispatch=/{print $2}' "$ROOT/counts.txt")
  FW=$(awk -F= '/^functional_work_records=/{print $2}' "$ROOT/counts.txt")
  FC=$(awk -F= '/^functional_close=/{print $2}' "$ROOT/counts.txt")
  [ "$SD" -ge 1 ] && [ "$SG" -ge 1 ] && [ "$SC" -ge 1 ] && [ "$SA" -eq 0 ] || { echo "FAIL[$MODE]: scheduled 未闭环或无验收事件断言失败" >&2; exit 1; }
  if [ "$MODE" = enforce ]; then
    [ "$FA" -eq 1 ] && [ "$FM" -eq 0 ] && [ "$FB" -eq 1 ] && [ "$FD" -eq 0 ] && [ "$FW" -eq 0 ] || { echo "FAIL[enforce]: 功能类未按预期拦截" >&2; exit 1; }
  else
    # observe：不产生 ACCEPTANCE_BLOCKED，任一验收告警（dispatch 或 close）且流程放行/CLOSE
    [ "$FA" -ge 1 ] && [ "$FB" -eq 0 ] && [ "$FC" -ge 1 ] || { echo "FAIL[observe]: 功能类未按预期告警放行" >&2; exit 1; }
  fi
  echo "PASS[$MODE]"
  PASS=$((PASS+1))
done
echo "ALL PASS ($PASS/2)；证据：$OUT_BASE/{observe,enforce}/"
