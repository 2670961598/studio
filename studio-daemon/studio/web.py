"""web — 一页仪表盘（只读 v1 + 手动 tick 入口，127.0.0.1）
板面 / 工人(含直播流尾部) / 事件流 / 自评报告 / 指标。"""
import json, time
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from .config import CONFIG
from . import statemachine

app = FastAPI(title="studio-daemon")


def _state() -> dict:
    from .yt import YT
    from .metrics import compute
    from .workers import Worker
    yt = YT("agent-pm")
    board = []
    for pid in CONFIG.projects:
        board += yt.list(pid, "状态:" + ",".join(statemachine.PM_ACTIONABLE))
    workers = []
    for p in sorted(CONFIG.workers_dir.glob("POLY-*.json")) + sorted(CONFIG.workers_dir.glob("STUDIO-*.json")):
        try:
            w = Worker(p.stem.replace(".done", ""))
            d = w.reg_data() or {}
            workers.append({"issue": d.get("issue", p.stem), "status": w.status(),
                            "started": d.get("started", "?"), "branch": d.get("branch", "?")})
        except Exception as e:
            workers.append({"issue": p.name, "status": f"ERR {e}", "started": "?", "branch": "?"})
    evs = []
    if CONFIG.events_path.exists():
        evs = [json.loads(x) for x in
               CONFIG.events_path.read_text(encoding="utf-8").splitlines()[-30:] if x.strip()]
    se = {}
    files = sorted(CONFIG.digest_dir.glob("self-eval-*.json"))
    if files:
        try:
            se = json.loads(files[-1].read_text())
        except Exception:
            pass
    locks = {p.name.replace(".lock", ""): (p / "owner").read_text().strip()
             for p in CONFIG.locks_dir.glob("*.lock") if (p / "owner").exists()}
    hb = {p.name: time.strftime("%m-%d %H:%M", time.localtime(p.stat().st_mtime))
          for p in CONFIG.heartbeats_dir.glob("*.hb")}
    return {"now": time.strftime("%F %T"), "board": board, "workers": workers,
            "events": evs, "metrics": {k: v for k, v in compute(7).items() if k != "recent"},
            "self_eval": se, "locks": locks, "heartbeats": hb}


@app.get("/api/state")
def api_state():
    try:
        return _state()
    except Exception as e:
        return {"error": str(e), "now": time.strftime("%F %T")}


@app.get("/api/stream/{issue}")
def api_stream(issue: str, lines: int = 40):
    f = CONFIG.workers_dir / f"{issue}.stream.jsonl"
    if not f.exists():
        raise HTTPException(404, f"no stream for {issue}")
    tail = f.read_text(encoding="utf-8", errors="replace").splitlines()[-lines:]
    out = []
    for ln in tail:
        try:
            e = json.loads(ln)
            t = e.get("type", "?")
            if t == "assistant":
                parts = [c.get("message", {}).get("content") if isinstance(c, dict) else c
                         for c in (e.get("message") or {}).get("content", [])]
                out.append({"t": t, "text": str(parts)[:300]})
            elif t == "result":
                out.append({"t": "RESULT", "text": e.get("result", "")[:300],
                            "cost_usd": e.get("total_cost_usd"), "turns": e.get("num_turns")})
            else:
                out.append({"t": t, "text": ""})
        except Exception:
            out.append({"t": "raw", "text": ln[:200]})
    return {"issue": issue, "events": out}


@app.post("/api/tick/{role}")
def api_tick(role: str):
    from .orchestrator import pm_tick, qa_tick
    from .metrics import self_eval
    fn = {"pm": lambda: pm_tick("POLY"), "qa": qa_tick, "selfeval": self_eval}.get(role)
    if not fn:
        raise HTTPException(404, "role?")
    return fn()


PAGE = """<!doctype html><html><head><meta charset=utf-8><title>虚拟工作室</title>
<style>body{font:13px/1.5 -apple-system,Menlo,monospace;background:#111;color:#cde;margin:2em}
h2{color:#8cf;border-bottom:1px solid #333}table{border-collapse:collapse;margin-bottom:2em}
td,th{border:1px solid #2a2a3a;padding:3px 8px}th{color:#8cf}tr:hover{background:#1a1a2e}
.tag{padding:0 6px;border-radius:8px;background:#2a3a5a}.bad{background:#5a2a2a}.good{background:#2a5a2a}
#hd{display:flex;gap:2em}a{color:#8cf}</style></head><body>
<h1>虚拟工作室 · studio-daemon</h1><div id=hd></div><div id=bd></div><div id=wk></div>
<div id=ev></div><div id=se></div>
<script>let S;async function r(){S=await (await fetch('/api/state')).json();render();setTimeout(r,5000)}
function tb(rows,head){return '<table><tr>'+head.map(h=>'<th>'+h+'</th>').join('')+'</tr>'+
rows.map(x=>'<tr>'+x.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</table>'}
function render(){if(S.error){document.body.innerHTML='<h1>⚠ '+S.error+'</h1>';return}
document.getElementById('hd').innerHTML='<b>'+S.now+'</b> 锁:'+JSON.stringify(S.locks)+' 心跳:'+JSON.stringify(S.heartbeats)+' 7日: 派'+S.metrics.dispatch+' 过闸'+S.metrics.gate_pass+' 打回'+S.metrics.qa_back+' 关'+S.metrics.close;
document.getElementById('bd').innerHTML='<h2>板面（活动单）</h2>'+tb(S.board.map(t=>[t.id,t.state,t.track,t.lane,t.type,t.summary]),['单号','状态','轨道','泳道','Type','标题']);
document.getElementById('wk').innerHTML='<h2>工人</h2>'+tb(S.workers.map(w=>['<a href=# onclick="stream(\\''+w.issue+'\\');return false">'+w.issue+'</a>',w.status,w.started,w.branch]),['单号','状态','开工','分支']);
document.getElementById('ev').innerHTML='<h2>事件（最近30）</h2>'+tb(S.events.reverse().map(e=>[e.ts,e.pid,e.issue,e.event,e.actor,e.note]),['时间','项目','单','事件','角色','备注']);}
async function stream(i){const r=await (await fetch('/api/stream/'+i)).json();
alert(i+'\\n'+r.events.map(e=>e.t+': '+String(e.text).slice(0,120)).join('\\n'))}
r()</script></body></html>"""


@app.get("/", response_class=HTMLResponse)
def index():
    return PAGE
