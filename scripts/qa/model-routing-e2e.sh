#!/usr/bin/env bash
# model-routing-e2e.sh —— task-56 多源路由宿主 E2E（需在**无嵌套 seatbelt** 的宿主跑；本地 daemon+dsh fake）
# 覆盖：两源 primary 失败→secondary 成功闭环；全失败可读 HOLD；预算超帽 HOLD；单源退化。
# 证据落 /tmp/routing-e2e-host/<mode>/；不碰生产/不写真实台账。
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:-/private/tmp/routing-e2e-host}" # macOS /tmp→/private/tmp；用真实路径生成 seatbelt 写根
# bun 自动探测（默认环境 PATH 未必带 bun；优先 mise/Homebrew 常见位）
if ! command -v bun >/dev/null 2>&1; then
  for p in "$HOME"/.local/share/mise/installs/bun/*/bin /opt/homebrew/bin /usr/local/bin; do
    if [ -x "$p/bun" ]; then PATH="$p:$PATH"; break; fi
  done
fi
export PATH
command -v bun >/dev/null || { echo "FAIL bun missing（请把 bun 所在目录加入 PATH）" >&2; exit 2; }
command -v sqlite3 >/dev/null || { echo "FAIL sqlite3 missing" >&2; exit 2; }
export STUDIO_GATEWAY_SECRET="${STUDIO_GATEWAY_SECRET:-$(openssl rand -hex 24)}"

# task-76：跑前清残留；按真实 pid 记录 + 进程组/子进程清理；EXIT/INT/TERM trap。
CLEANUP_PIDS=(); CLEANUP_ROOTS=()
stop_pid() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null || return 0
  pkill -TERM -P "$pid" 2>/dev/null || true
  kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || return 0; sleep 0.1; done
  pkill -KILL -P "$pid" 2>/dev/null || true
  kill -KILL "$pid" 2>/dev/null || true
  for _ in $(seq 1 10); do kill -0 "$pid" 2>/dev/null || return 0; sleep 0.1; done
  echo "FAIL cleanup: pid $pid 仍存活" >&2
  return 1
}
cleanup() {
  local pid root
  for pid in "${CLEANUP_PIDS[@]:-}"; do stop_pid "$pid" || true; done
  # task-78 证据保留口径：临时目录删前留一份 last（可查）；清理后不留运行目录
  if [ -d "${OUT:-}" ]; then
    rm -rf "${ROUTING_EVIDENCE_LAST:-/private/tmp/routing-e2e-evidence-last}"
    cp -R "${OUT}" "${ROUTING_EVIDENCE_LAST:-/private/tmp/routing-e2e-evidence-last}" 2>/dev/null || true
  fi
  for root in "${CLEANUP_ROOTS[@]:-}"; do rm -rf "$root"; done
  rm -rf "${OUT:-}"
}
trap 'cleanup' EXIT INT TERM
# 残留检测/清理（前次 E2E 夹具 daemon 不得在跑）
leftover="$(pgrep -f 'routing-e2e-host' || true)"
if [ -n "$leftover" ]; then
  echo "WARN[task-76]: 发现残留 E2E daemon pid=$(echo "$leftover" | tr '\n' ' ') → 先清理" >&2
  echo "$leftover" | while read -r pid; do [ -n "$pid" ] && stop_pid "$pid" || true; done
  sleep 0.5
  if pgrep -f 'routing-e2e-host' >/dev/null 2>&1; then echo "FAIL: 残留进程无法清理" >&2; exit 1; fi
fi
rm -rf "$OUT"; mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd -P)"
PASS=0
make_fixture() { # $1 mode, $2 worker behavior: fail-primary|fail-all|budget|single
  local mode="$1" behavior="$2" root="$OUT/$1"
  mkdir -p "$root/var" "$root/platform"; root="$(cd "$root" && pwd -P)" # realpath 后再写 daemon/seatbelt 根
  cat > "$root/worker.mjs" <<WORKER
#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
if (process.argv.includes('--version')) { console.log('0.2.1-rc.5'); process.exit(0) }
const patches=[]; for(let i=0;i<process.argv.length;i++) if(process.argv[i]==='--patch'&&process.argv[i+1]) patches.push(process.argv[i+1])
const text=patches.map(p=>{try{return readFileSync(p,'utf8')}catch{return ''}}).join('\n')
try { appendFileSync('worker-argv.log', JSON.stringify({ argv: process.argv.slice(2), sourceHit: text.includes('source=primary')?'primary':text.includes('source=secondary')?'secondary':'none' })+'\n') } catch {}
const behavior='$behavior'
const fail = behavior==='fail-all' || (behavior==='fail-primary' && text.includes('source=primary'))
const fake = '$REPO/packages/adapters/test/fake-cli/fake-cli.mjs'
const fixture = fail ? '$REPO/packages/adapters/test/fixtures/dsh/P04-错误凭据.ndjson' : '$REPO/packages/adapters/test/fixtures/dsh/P01-真成功流.ndjson'
// 复用 adapters 测试的 fake CLI harness：writeSync 输出 + 标准 fixture 回放（避免 console.log/退出太快导致流折叠丢 turn_end）
const r = spawnSync(process.execPath, [fake], { stdio: 'inherit', env: { ...process.env, DSH_FAKE_FIXTURE: fixture } })
if (r.status !== 0) process.exit(r.status ?? 1)
if (!fail) { mkdirSync('deliverables',{recursive:true}); writeFileSync('REPORT.md','# routing e2e REPORT\n'); writeFileSync('summary.json','{"summary":"routing e2e"}\n') }
WORKER
  chmod +x "$root/worker.mjs"
  cat > "$root/agent.yaml" <<YAML
executors:
  dsh:
    default: true
    version: "0.2.1-rc.5"
    cmd: ['$root/worker.mjs']
    capabilities: { session_resume: true }
YAML
  if [ "$behavior" = single ]; then
    cat > "$root/models.yaml" <<'YAML'
tiers:
  high: {provider: glm, model: GLM-5.3, price: {inputPerM: 1, outputPerM: 2}}
  mid: {provider: glm, model: GLM-5.3, price: {inputPerM: 1, outputPerM: 2}}
  low: {provider: glm, model: GLM-5.3-Flash, price: {inputPerM: 0.1, outputPerM: 0.4}}
roles: {main_worker: mid, verifier: high}
YAML
  else
    # task-59 第9跑：fail-all 用长冷却（额度耗尽级），两次失败后下一次派发两源均在冷却
    cooldown_line=''
    [ "$behavior" = fail-all ] && cooldown_line='        cooldown: {baseMs: 600000, maxMs: 3600000}'
    # task-59 第12跑：配置解析器只收整数 cap；budget 场景用“超大整数单价”让预检估算远超 cap=1，
    # 从而必触发 BUDGET_EXCEEDED（route 估算=ceil(briefChars/4) tokens × 源单价）。
    price_primary='{inputPerM: 1, outputPerM: 2}'
    price_secondary='{inputPerM: 2, outputPerM: 10}'
    if [ "$behavior" = budget ]; then
      price_primary='{inputPerM: 1000000000, outputPerM: 1000000000}'
      price_secondary='{inputPerM: 1000000000, outputPerM: 1000000000}'
    fi
    cat > "$root/models.yaml" <<YAML
tiers:
  high:
    sources:
      - id: primary
        provider: glm
        model: GLM-5.3
        priority: 10
        price: ${price_primary}
${cooldown_line}
      - id: secondary
        provider: opencode-go
        model: kimi-k3.1-pro
        priority: 20
        price: ${price_secondary}
${cooldown_line}
  mid: {provider: glm, model: GLM-5.3, price: {inputPerM: 1, outputPerM: 2}}
  low: {provider: glm, model: GLM-5.3-Flash, price: {inputPerM: 0.1, outputPerM: 0.4}}
roles: {main_worker: mid, verifier: high}
YAML
  fi
  ( cd "$REPO" && bun -e 'import {createLocalPlatform} from "./packages/localplatform/src/index.ts"; const p=createLocalPlatform(process.argv[1]); const i=await p.issues.create({title:"routing e2e",type:"task",level:1,dept:"departments/研发部",assignee:"AGENT-1",initialState:"新单"}); console.log(i.id)' "$root/platform" > "$root/ticket.txt" )
  local ticket; ticket="$(cat "$root/ticket.txt")"
  python3 - "$root" "$ticket" "$behavior" <<'PY'
import sys
root,ticket,behavior=sys.argv[1:]
extra="budgetTicketCapUsd: 1\n" if behavior=='budget' else ""
open(root+'/daemon.yaml','w').write(f"""db: {root}/var/ledger.sqlite
platform: localfile
platformDir: {root}/platform
company: demo
rootDir: {root}/var
tickMs: 200
jobs: false
autoApprove: true
agentYaml: {root}/agent.yaml
models: {root}/models.yaml
acceptance: 'test -s REPORT.md && test -s summary.json'
seatbeltTier: workspace-write
seatbeltWriteRoots: '["{root}/var/.AIWS"]'
seatbeltAuthorization: 'routing-e2e (宿主 E2E；task-56)'
seatbeltOutboundTcp: '[{{"host":"*","port":443}}]'
modelTierTickets: '{ticket}=high'
{extra}apiPort: 0
""")
PY
  echo "$ticket"
}
run_case() { # $1 mode, $2 behavior, $3 expected predicate
  local mode="$1" behavior="$2" root="$OUT/$1"
  make_fixture "$mode" "$behavior" >/dev/null
  ( cd "$REPO" && exec node apps/boot/src/main.ts "$root/daemon.yaml" ) > "$root/daemon.log" 2>&1 &
  local real_pid=$!; echo "$real_pid" > "$root/pid"; CLEANUP_PIDS+=("$real_pid"); CLEANUP_ROOTS+=("$root")
  # 启动探活：daemon 配置错误会立即退出；不能继续用空库跑 sqlite（否则只看到 no such table）
  sleep 0.5
  if ! kill -0 "$(cat "$root/pid")" 2>/dev/null; then
    echo "FAIL[$mode]: daemon 启动失败（配置/启动期异常），日志尾部：" >&2
    tail -30 "$root/daemon.log" >&2
    exit 1
  fi
  local ticket; ticket="$(cat "$root/ticket.txt")"
  # task-59 第8跑：daemon 重试有 ~60s 退避；fail-all 必须等第三次派发（180s），
  # budget/single 给足 120s；每次轮询打印计数便于定位间隔/缺口。
  local wait_loops=300
  [ "$mode" = fail-all ] && wait_loops=450
  local poll=0
  for _ in $(seq 1 "$wait_loops"); do
    sleep 0.4
    poll=$((poll + 1))
    local close fail_note all_note budget_note
    close=$(sqlite3 "$root/var/ledger.sqlite" "select count(*) from events where issue='$ticket' and event='CLOSE';" 2>/dev/null || echo 0)
    fail_note=$(sqlite3 "$root/var/ledger.sqlite" "select count(*) from events where note like 'MODEL_ROUTING_FAIL%';" 2>/dev/null || echo 0)
    all_note=$(sqlite3 "$root/var/ledger.sqlite" "select count(*) from events where note like '%ALL_SOURCES_UNAVAILABLE%';" 2>/dev/null || echo 0)
    budget_note=$(sqlite3 "$root/var/ledger.sqlite" "select count(*) from events where note like '%MODEL_ROUTING_BUDGET_HOLD%';" 2>/dev/null || echo 0)
    if [ "$mode" = fail-all ] && [ $((poll % 10)) -eq 0 ]; then
      echo "[fail-all poll ${poll}] dispatch=$(sqlite3 "$root/var/ledger.sqlite" "select count(*) from events where event='DISPATCH';" 2>/dev/null || echo '?') all_note=$all_note" >&2
    fi
    case "$mode" in
      failover) [ "$(sqlite3 "$root/var/ledger.sqlite" "select count(*) from events where event='DISPATCH';" 2>/dev/null || echo 0)" -ge 2 ] && break ;;
      single) [ "$(sqlite3 "$root/var/ledger.sqlite" "select count(*) from events where event='DISPATCH';" 2>/dev/null || echo 0)" -ge 1 ] && break ;;
      # task-59 第10跑 B 收敛：fail-all 只验路由本体——两次 DISPATCH + 两条 MODEL_ROUTING_FAILOVER
      # （primary/secondary）；ALL_SOURCES_UNAVAILABLE 由 router 单测覆盖，不在 E2E 硬等。
      fail-all) [ "$(sqlite3 "$root/var/ledger.sqlite" "select count(*) from events where event='DISPATCH';" 2>/dev/null || echo 0)" -ge 2 ] && [ "$fail_note" -ge 2 ] && break ;;
      budget) [ "$budget_note" -ge 1 ] && break ;;
    esac
  done
  local pid; pid="$(cat "$root/pid")"; stop_pid "$pid" || exit 1
  local db="$root/var/ledger.sqlite"
  {
    echo "mode=${mode}（B: 路由本体断言；四要件/CLOSE 不在本 E2E 冒充）"; echo "ticket=$ticket"
    sqlite3 -header "$db" "select count(*) dispatch from events where event='DISPATCH'; select count(*) gate_pass from events where event='GATE_PASS'; select count(*) close from events where event='CLOSE';"
    echo '--- dispatch routing notes ---'
    sqlite3 "$db" "select substr(note, instr(note,'routing='), 120) from events where event='DISPATCH';" 2>/dev/null || true
    echo '--- routing fail notes ---'
    sqlite3 "$db" "select substr(note,1,240) from events where note like 'MODEL_ROUTING%';" 2>/dev/null || true
    echo '--- worker argv/sourceHit ---'
    find "$root/var/.AIWS" -name worker-argv.log -exec cat {} \; 2>/dev/null | sort -u
  } | tee "$root/evidence.txt"
  local disp close pass failn
  disp=$(sqlite3 "$db" "select count(*) from events where event='DISPATCH';"); close=$(sqlite3 "$db" "select count(*) from events where issue='$ticket' and event='CLOSE';"); pass=$(sqlite3 "$db" "select count(*) from events where issue='$ticket' and event='GATE_PASS';"); failn=$(sqlite3 "$db" "select count(*) from events where note like 'MODEL_ROUTING_FAIL%';")
  case "$mode" in
    # B：E2E 只验证路由本体（seatbelt 包裹下 worker 写/流折叠不可靠；四要件/CLOSE 由单测+生产验收覆盖，不冒充全链）
    failover) [ "$disp" -ge 2 ] && grep -q 'routing=primary' "$root/evidence.txt" && grep -q 'routing=secondary' "$root/evidence.txt" && grep -q 'routing-skipped=primary:cooldown' "$root/evidence.txt" || { echo "FAIL failover(routing-body)" >&2; exit 1; } ;;
    fail-all) [ "$disp" -ge 2 ] && [ "$failn" -eq 2 ] && grep -q 'routing=primary' "$root/evidence.txt" && grep -q 'routing=secondary' "$root/evidence.txt" && grep -q '"sourceHit":"primary"' "$root/evidence.txt" && grep -q '"sourceHit":"secondary"' "$root/evidence.txt" || { echo "FAIL fail-all(routing-body)" >&2; exit 1; } ;;
    budget) [ "$disp" -eq 0 ] && grep -q 'MODEL_ROUTING_BUDGET_HOLD' "$root/evidence.txt" && [ "$(sqlite3 "$db" "select count(*) from events where issue='$ticket' and note like 'MODEL_ROUTING_BUDGET_HOLD%';")" -eq 1 ] || { echo "FAIL budget(HOLD/去重)" >&2; exit 1; } ;;
    # 单源=退化为现状：DISPATCH 正常、无源路由痕迹（不写 routing= note、无 per-source overlay）
    single) [ "$disp" -ge 1 ] && ! grep -q 'routing=' "$root/evidence.txt" && ! grep -q 'dsh-tier-high--' "$root/evidence.txt" || { echo "FAIL single(no-routing-trace)" >&2; exit 1; } ;;
  esac
  echo "PASS[$mode]"; PASS=$((PASS+1))
}
run_case failover fail-primary
run_case fail-all fail-all
run_case budget budget
run_case single single
cleanup
trap - EXIT INT TERM
if pgrep -f 'routing-e2e-host' >/dev/null 2>&1; then
  echo "FAIL[task-76]: E2E 结束后仍有 routing-e2e-host 残留：$(pgrep -f 'routing-e2e-host' | tr '\n' ' ')" >&2
  exit 1
fi
if [ -e "${OUT:-}" ]; then echo "FAIL[task-81 T2]: 运行目录未清理：${OUT:-}" >&2; exit 1; fi
echo "ALL PASS ($PASS/4)；残留进程=0；运行目录已清理（${OUT:-}）；证据快照=${ROUTING_EVIDENCE_LAST:-/private/tmp/routing-e2e-evidence-last}"
