"""web — 管理平台 API（运维驾驶舱；板面只读快照并外链 YouTrack，不重复建设）"""
import json, time
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from .config import CONFIG
from . import statemachine

app = FastAPI(title="studio-daemon")


@app.middleware("http")
async def _guard(request, call_next):
    """本机防护（P1-8）：拒 DNS rebinding（Host 白名单）与跨站 POST（CSRF）。"""
    host = (request.headers.get("host") or "").lower()
    if host not in ("127.0.0.1:8787", "localhost:8787"):
        return JSONResponse({"error": "bad host"}, status_code=421)
    if request.method == "POST" and request.headers.get("sec-fetch-site") not in (None, "same-origin", "same-site", "none"):
        return JSONResponse({"error": "cross-site blocked"}, status_code=403)
    return await call_next(request)
STATIC = CONFIG._root / "static"

TRIGGER_MAP = {  # 立即执行的路由表（job id → 可调用）
    "pm-poly": ("studio.orchestrator", "pm_tick", {"pid": "POLY"}),
    "pm-studio": ("studio.orchestrator", "pm_tick", {"pid": "STUDIO"}),
    "self-eval": ("studio.metrics", "self_eval", {}),
    "patrol": ("studio.patrol", "patrol_tick", {}),
    "evolve-scan": ("studio.evolve", "scan", {}),
}


def _yt_url(issue: str) -> str:
    return f"{CONFIG.yt_url}/issue/{issue}"


# ---------------------------------------------------------------- 数据组装
def _overview() -> dict:
    from .yt import YT
    from .metrics import compute
    board = []
    for pid in CONFIG.projects:
        board += YT("agent-pm").list(pid, "状态:" + ",".join(statemachine.PM_ACTIONABLE))
    for b in board:
        b["yt"] = _yt_url(b["id"])
    evs = []
    if CONFIG.events_path.exists():
        evs = [json.loads(x) for x in
               CONFIG.events_path.read_text(encoding="utf-8").splitlines()[-40:] if x.strip()]
    se = {}
    files = sorted((CONFIG.events_path.parent / "digest").glob("self-eval-*.json"))
    if files:
        try:
            se = json.loads(files[-1].read_text())
        except Exception:
            pass
    locks = {p.name.replace(".lock", ""): (p / "owner").read_text().strip()
             for p in CONFIG.locks_dir.glob("*.lock") if (p / "owner").exists()}
    hbs = {p.name: time.strftime("%m-%d %H:%M", time.localtime(p.stat().st_mtime))
           for p in CONFIG.heartbeats_dir.glob("*.hb")}
    return {"now": time.strftime("%F %T"), "board": board, "events": evs[::-1],
            "metrics": {k: v for k, v in compute(7).items() if k != "recent"},
            "self_eval": se, "locks": locks, "heartbeats": hbs,
            "youtrack": CONFIG.yt_url}


def _jobs() -> list[dict]:
    from . import runtime
    from .runs import last_run
    SCHED = runtime.SCHED
    if not SCHED:
        return []
    out = []
    for j in SCHED.get_jobs():
        lr = last_run(j.id) or {}
        out.append({
            "id": j.id, "trigger": str(j.trigger),
            "next_run": j.next_run_time.strftime("%F %T") if j.next_run_time else None,
            "state": "paused" if j.next_run_time is None else "active",
            "last_ts": lr.get("ts"), "last_outcome": lr.get("outcome"),
            "last_summary": lr.get("summary", ""), "last_duration_ms": lr.get("duration_ms", 0),
        })
    out.sort(key=lambda x: x["id"])
    return out


def _workers() -> list[dict]:
    from .workers import Worker
    out = []
    seen = set()
    files = sorted(CONFIG.workers_dir.glob("*.done.json")) + sorted(CONFIG.workers_dir.glob("*.json"))
    for p in files:
        issue = p.name.replace(".done.json", "").replace(".json", "")
        if issue in seen:
            continue
        seen.add(issue)
        try:
            w = Worker(issue)
            d = w.reg_data() or {}
            rd = _result_data(w)
            out.append({"issue": issue, "status": w.status(), "started": d.get("started", "?"),
                        "branch": d.get("branch", "?"), "has_stream": w.stream.exists(),
                        "done": p.name.endswith(".done.json"), **rd})
        except Exception as e:
            out.append({"issue": issue, "status": f"ERR {e}", "started": "?",
                        "branch": "?", "has_stream": False, "done": False})
    return out[::-1]


def _result_data(w) -> dict:
    """从 stream.jsonl 的 result 事件提取 cost/turns/session_id。"""
    if not w.stream.exists():
        return {}
    try:
        for ln in reversed(w.stream.read_text(encoding="utf-8", errors="replace").splitlines()[-10:]):
            e = json.loads(ln)
            if e.get("type") == "result":
                return {"cost_usd": e.get("total_cost_usd"), "turns": e.get("num_turns"),
                        "duration_ms": e.get("duration_ms"), "session_id": e.get("session_id"),
                        "is_error": e.get("is_error", False)}
    except Exception:
        pass
    return {}


def _transcript(issue: str) -> dict:
    f = CONFIG.workers_dir / f"{issue}.stream.jsonl"
    if not f.exists():
        raise HTTPException(404, f"无对话记录 {issue}")
    msgs = []
    for ln in f.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            e = json.loads(ln)
        except Exception:
            continue
        t = e.get("type")
        if t == "assistant":
            for c in (e.get("message") or {}).get("content", []):
                if not isinstance(c, dict):
                    continue
                if c.get("type") == "text":
                    msgs.append({"role": "ai", "kind": "text", "text": c.get("text", "")})
                elif c.get("type") == "tool_use":
                    msgs.append({"role": "ai", "kind": "tool", "name": c.get("name"),
                                 "input": json.dumps(c.get("input", {}), ensure_ascii=False)[:400]})
        elif t == "user":
            for c in (e.get("message") or {}).get("content", []):
                if isinstance(c, dict) and c.get("type") == "tool_result":
                    content = c.get("content")
                    txt = content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)
                    msgs.append({"role": "tool", "kind": "result", "text": str(txt)[:400],
                                 "ok": not c.get("is_error")})
        elif t == "result":
            msgs.append({"role": "sys", "kind": "result",
                         "text": e.get("result", "")[:600], "cost_usd": e.get("total_cost_usd"),
                         "turns": e.get("num_turns")})
    return {"issue": issue, "messages": msgs, "count": len(msgs)}


# ---------------------------------------------------------------- API
@app.get("/api/overview")
def api_overview():
    try:
        return _overview()
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/state")
def api_state_alias():
    """看护脚本的健康检查入口（含调度器活性）。"""
    from . import runtime
    import json as _j
    return {"now": time.strftime("%F %T"),
            "sched_alive": runtime.SCHED is not None and runtime.SCHED.running,
            "started": runtime.STARTED}


@app.get("/api/jobs")
def api_jobs():
    return _jobs()


@app.post("/api/jobs/{job_id}/{action}")
def api_job_ctl(job_id: str, action: str):
    from . import runtime
    from .runs import append_run
    SCHED = runtime.SCHED
    if not SCHED:
        raise HTTPException(503, "调度器未运行（手动模式）")
    if action == "pause":
        SCHED.pause_job(job_id); return {"ok": f"{job_id} paused"}
    if action == "resume":
        SCHED.resume_job(job_id); return {"ok": f"{job_id} resumed"}
    if action == "trigger":
        import importlib
        import threading
        if job_id not in TRIGGER_MAP:
            raise HTTPException(404, "未知 job")

        def _run():
            mod, fn, kw = TRIGGER_MAP[job_id]
            try:
                r = getattr(importlib.import_module(mod), fn)(**kw)
                s = "; ".join(r.get("actions", []))[:200] if isinstance(r, dict) else str(r)[:200]
                from .runs import append_run
                append_run(job_id, "ok", 0, "[手动] " + (s or "完成"))
            except Exception as e:
                from .runs import append_run
                append_run(job_id, "error", 0, f"[手动] {type(e).__name__}: {e}"[:200])
        threading.Thread(target=_run, daemon=True).start()
        return {"ok": f"{job_id} 已后台触发，结果稍后见运行历史"}
    raise HTTPException(400, "action?")


@app.get("/api/runs")
def api_runs(job: str = "", limit: int = 100):
    from .runs import list_runs
    return list_runs(job or None, limit)


@app.get("/api/schema")
def api_schema():
    """单子知识库（类型×流转唯一事实源）供前端展示。"""
    import yaml as _y
    from . import statemachine as sm
    p = CONFIG._root.parent / "kernel" / "schema" / "ticket-types.yaml"
    try:
        data = _y.safe_load(p.read_text(encoding="utf-8"))
    except Exception as e:
        return {"error": str(e)}
    return {"updated": data.get("updated"), "types": data.get("types", {}),
            "type_edges": {k: [list(e) for e in v] for k, v in sm.TYPE_EDGES.items()},
            "team": (CONFIG._root.parent / "kernel" / "TEAM.md").read_text(encoding="utf-8"),
            "agents_kb": {f.stem: f.read_text(encoding="utf-8")[:400]
                          for f in sorted((CONFIG._root.parent / "kernel" / "agents").glob("*.md"))}}


@app.get("/api/workers")
def api_workers():
    return _workers()


@app.get("/api/transcript/{issue}")
def api_transcript(issue: str):
    return _transcript(issue)


# ---------------------------------------------------------------- 静态与首页
@app.get("/vendor/{name}")
def vendor(name: str):
    f = STATIC / "vendor" / name
    if not f.exists():
        raise HTTPException(404)
    return FileResponse(f)


@app.get("/", response_class=HTMLResponse)
def index():
    return FileResponse(STATIC / "index.html")
