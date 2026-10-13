"""web — 管理平台 API（运维驾驶舱；板面只读快照并外链 YouTrack，不重复建设）"""
import json, time
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from .config import CONFIG
from . import statemachine
from . import ytgw

app = FastAPI(title="studio-daemon")

# 敏感值脱敏（审计 P3：worker 若 cat 过凭证文件，token 即上面板/对话流）
_TOKEN_RE = None


def _redact(obj):
    """递归脱敏：perm-xxx 形态的 YouTrack token 替换为 ***REDACTED***。
    形态独特（perm- 前缀 + 20 以上 base64ish），不会误杀 commit/sha。"""
    global _TOKEN_RE
    import re as _re
    if _TOKEN_RE is None:
        _TOKEN_RE = _re.compile(r"perm-[A-Za-z0-9+/=_\-]{20,}")
    if isinstance(obj, str):
        return _TOKEN_RE.sub("perm-***REDACTED***", obj)
    if isinstance(obj, list):
        return [_redact(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _redact(v) for k, v in obj.items()}
    return obj


@app.middleware("http")
async def _guard(request, call_next):
    """本机防护（P1-8 + 审计 P2）：拒 DNS rebinding（Host 白名单）；
    跨站请求一律拒（GET 也拒——防恶意网页先读 /api/token 再 POST）；
    POST 须带 X-Studio-Token（Sec-Fetch-Site 单层防线挡不住旧浏览器/非浏览器客户端）。"""
    host = (request.headers.get("host") or "").lower()
    port = str(CONFIG.web_port)                 # 实验场换端口后白名单必须跟着走
    if host not in (f"127.0.0.1:{port}", f"localhost:{port}"):
        return JSONResponse({"error": "bad host"}, status_code=421)
    if request.headers.get("sec-fetch-site") not in (None, "same-origin", "same-site", "none"):
        return JSONResponse({"error": "cross-site blocked"}, status_code=403)
    if request.method == "POST" and request.url.path.startswith("/api/yt/"):
        pass   # YouTrack 网关走独立 wkey 认证（worker 凭证），不吃面板令牌
    elif request.method == "POST" and request.headers.get("x-studio-token") != CONFIG.panel_token:
        return JSONResponse({"error": "bad token"}, status_code=403)
    return await call_next(request)
STATIC = CONFIG._root / "static"

def _resume_payload(issue: str) -> dict:
    """接管续聊数据（STUDIO-47B）：活 reg 或归档 done.json 里钉存的 session_id + 当时仓。"""
    import json as _json
    for f in (CONFIG.workers_dir / f"{issue}.json",
              CONFIG.workers_dir / f"{issue}.done.json"):
        if f.exists():
            try:
                d = _json.loads(f.read_text(encoding="utf-8"))
            except Exception:
                continue
            sid = ((d.get("result") or {}).get("session_id")) or ""
            return {"issue": issue, "session_id": sid,
                    "repo": d.get("repo") or "", "archive": f.name.endswith(".done.json"),
                    "cmd": (f"cd \"{d.get('repo')}\" && claude --resume {sid}" if sid else "")}
    raise HTTPException(404, f"无 worker 记录 {issue}")


@app.get("/api/timeline/{issue}")
def api_timeline(issue: str):
    """单据全链路时间线（STUDIO-42）：events 账本 + worker 记账聚合——
    失败单一眼定位卡在哪段（派发→施工时长→闸门→QA→合并）。
    STUDIO-107：事件附 tokens，末尾附 COST 合计行（LLM 岛+worker 单件成本汇总）。"""
    import json as _json
    from .reports import _events_all
    from .metrics import ticket_cost, cost_line
    evs = [e for e in _events_all() if e.get("issue") == issue]
    out = [{"ts": e["ts"], "kind": e["event"], "attempt": e.get("attempt", 0),
            "detail": (e.get("note") or "")[:100],
            **({"cost_usd": e["cost_usd"]} if e.get("cost_usd") is not None else {}),
            **({"tokens": e["tokens"]} if e.get("tokens") is not None else {}),
            **({"duration_ms": e["duration_ms"]} if e.get("duration_ms") is not None else {})}
           for e in evs]
    for f in (CONFIG.workers_dir / f"{issue}.done.json",
              CONFIG.workers_dir / f"{issue}.json"):
        if f.exists():
            try:
                d = _json.loads(f.read_text(encoding="utf-8"))
            except Exception:
                continue
            r = d.get("result") or {}
            if r.get("cost_usd") is not None or d.get("started"):
                out.append({"ts": d.get("started") or "", "kind": "WORKER",
                            "attempt": 0, "branch": d.get("branch"),
                            "cost_usd": r.get("cost_usd"),
                            "duration_ms": r.get("duration_ms"),
                            "turns": r.get("turns")})
    c = ticket_cost(issue)
    if c["tokens"] or c["llm_calls"] or c["worker_runs"]:
        out.append({"ts": "合计", "kind": "COST", "attempt": 0,
                    "detail": cost_line(c),
                    "cost_usd": c.get("cost_usd"),
                    "tokens": c["tokens"]})
    return _redact(sorted(out, key=lambda x: x["ts"]))


@app.get("/api/resume-cmd/{issue}")
def api_resume_cmd(issue: str):
    """接管命令（复制用）：claude --resume 恢复该 worker 历史对话，手动继续。"""
    return _redact(_resume_payload(issue))


@app.post("/api/resume-terminal/{issue}")
def api_resume_terminal(issue: str):
    """在 Terminal.app 新窗口打开续聊会话（本机单人场景；失败回落复制命令）。"""
    import subprocess as _sp
    pl = _resume_payload(issue)
    if not pl["session_id"]:
        return {"ok": False, "note": "该单无 session_id（旧归档），用命令行手动续"}
    apple = ('tell application "Terminal" to do script "'
             + pl["cmd"].replace('"', '\\"') + '"')
    try:
        r = _sp.run(["osascript", "-e", apple], capture_output=True, text=True, timeout=15)
        if r.returncode == 0:
            return {"ok": True, "note": "Terminal 已打开续聊会话"}
        return {"ok": False, "note": f"osascript 失败（Terminal 忙/权限），请复制命令：{pl['cmd']}"}
    except Exception as e:
        return {"ok": False, "note": f"唤起失败请复制命令：{pl['cmd']}（{type(e).__name__}）"}




# ---- YouTrack 执行体网关（HTTP 面）----
# STUDIO-77 起网关实现在 ytgw（三类执行体统一：交付/explore worker 走本 HTTP 面，
# patrol 巡逻岛走进程内代办）；这里只做薄壳：GatewayRefused → 403。
# 白名单动作 = worker_comment/worker_heartbeat/worker_article/worker_kb_search 四端点，
# 新增动作先过 ytgw。


@app.post("/api/yt/comment")
def gw_comment(req: dict):
    """worker 评论——署名自动注入 [项目·单号·worker]（账号共用、单上身份不混淆）。"""
    try:
        return ytgw.worker_comment(req.get("iid", ""), req.get("key", ""),
                                   req.get("text", ""))
    except ytgw.GatewayRefused:
        return JSONResponse({"error": "bad worker key"}, status_code=403)


@app.post("/api/yt/heartbeat")
def gw_heartbeat(req: dict):
    try:
        return ytgw.worker_heartbeat(req.get("iid", ""), req.get("key", ""))
    except ytgw.GatewayRefused:
        return JSONResponse({"error": "bad worker key"}, status_code=403)


@app.post("/api/yt/article")
def gw_article(req: dict):
    """草稿文章发布（探索/情报产物；路径 草稿/单号/标题）。"""
    try:
        return ytgw.worker_article(req.get("iid", ""), req.get("key", ""),
                                   req.get("title", ""), req.get("content", ""))
    except ytgw.GatewayRefused:
        return JSONResponse({"error": "bad worker key"}, status_code=403)


@app.get("/api/yt/kb-search")
def gw_kb_search(iid: str = "", key: str = "", q: str = "", project: str = ""):
    """知识检索（只读，STUDIO-101）：wkey 同 comment/heartbeat/article 通道（GET 无 body，
    凭证走查询串）；命中「标题或正文含 q」返回 top5 {path, id, excerpt}。中间件只拦
    POST 面板令牌，本端点的门就是 wkey 本身——缺失/错误一律 403。"""
    try:
        return ytgw.worker_kb_search(iid, key, q, project)
    except ytgw.GatewayRefused:
        return JSONResponse({"error": "bad worker key"}, status_code=403)

@app.post("/api/restart")
def api_restart(reason: str = ""):
    """优雅重载（STUDIO-47A）：写 drain 标志→停派新工→等在途收割完→daemon 自退→看护拉起。"""
    import json as _json, time as _t
    from . import orchestrator as _orch
    (_orch.CONFIG.locks_dir / _orch.DRAIN_FILE).write_text(
        _json.dumps({"ts": _t.strftime("%F %T"), "reason": reason or "面板触发"},
                    ensure_ascii=False), encoding="utf-8")
    return {"ok": "draining", "in_flight": _orch.in_flight(),
            "note": "在途 worker 收割完成后自动重启；期间不派新工"}


TRIGGER_MAP = {  # 立即执行的路由表（job id → 可调用）——与 _sched 装配对齐
    #（审计 P2 曾指出硬编码漏岗：report-* 与 pm-games 缺席，手动触发"未知 job"实录）
    "pm-poly": ("studio.orchestrator", "pm_tick", {"pid": "POLY"}),
    "pm-studio": ("studio.orchestrator", "pm_tick", {"pid": "STUDIO"}),
    "pm-games": ("studio.orchestrator", "pm_tick", {"pid": "GAMES"}),
    "self-eval": ("studio.metrics", "self_eval", {}),
    "patrol": ("studio.patrol", "patrol_tick", {}),
    "evolve-scan": ("studio.evolve", "scan", {}),
    "orggov-scan": ("studio.orggov", "scan", {}),
    "report-daily": ("studio.reports", "daily_report", {}),
    "report-weekly": ("studio.reports", "weekly_report", {}),
    "report-monthly": ("studio.reports", "monthly_report", {}),
    "steward": ("studio.steward", "steward_tick", {}),   # STUDIO-83 框架管家（与 _sched 装配对齐）
}


def _yt_url(issue: str) -> str:
    return f"{CONFIG.yt_url}/issue/{issue}"


# ---------------------------------------------------------------- 数据组装
def _overview() -> dict:
    from .yt import YT
    from .metrics import compute
    board = []
    for pid in CONFIG.projects:
        board += YT("agent-8").list(pid, "状态:" + ",".join(statemachine.PM_ACTIONABLE))
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
    """worker 记账数据：活 stream 的 result 事件，或归档时钉进 done.json 的副本。"""
    rs = w.result_stats()
    if rs:
        return rs
    done = CONFIG.workers_dir / f"{w.issue}.done.json"
    if done.exists():
        try:
            return json.loads(done.read_text(encoding="utf-8")).get("result") or {}
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
    from . import orchestrator as _orch
    return {"now": time.strftime("%F %T"),
            "sched_alive": runtime.SCHED is not None and runtime.SCHED.running,
            "draining": _orch.drain_requested(), "in_flight": _orch.in_flight(),
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
            import time as _t
            t0 = _t.time()                       # 手动触发也计时（审计 P0-1 断点B）
            try:
                r = getattr(importlib.import_module(mod), fn)(**kw)
                s = "; ".join(r.get("actions", []))[:200] if isinstance(r, dict) else str(r)[:200]
                from .runs import append_run
                append_run(job_id, "ok", int((_t.time() - t0) * 1000),
                           "[手动] " + (s or "完成"))
            except Exception as e:
                from .runs import append_run
                append_run(job_id, "error", int((_t.time() - t0) * 1000),
                           f"[手动] {type(e).__name__}: {e}"[:200])
        threading.Thread(target=_run, daemon=True).start()
        return {"ok": f"{job_id} 已后台触发，结果稍后见运行历史"}
    raise HTTPException(400, "action?")


@app.get("/api/runs")
def api_runs(job: str = "", limit: int = 100):
    from .runs import list_runs
    return list_runs(job or None, limit)


@app.get("/api/schema")
def api_schema():
    """单子知识库（类型×流转唯一事实源）+ 团队公约/编制档案（YouTrack Articles）供前端展示。"""
    import yaml as _y
    from . import statemachine as sm
    from .yt import YT
    p = CONFIG._root.parent / "kernel" / "schema" / "ticket-types.yaml"
    try:
        data = _y.safe_load(p.read_text(encoding="utf-8"))
    except Exception as e:
        return {"error": str(e)}
    team, agents_kb = "", {}
    try:                                              # 知识库已迁 Articles（STUDIO-13）；不可达时降级为空
        t = YT("agent-8")
        team = t.wiki_get("全局/团队公约")
        agents_kb = {path.split("/", 1)[1]: a["content"][:400]
                     for path, a in t.wiki_all().items() if path.startswith("编制/")}
    except Exception:
        pass
    return {"updated": data.get("updated"), "types": data.get("types", {}),
            "type_edges": {k: [list(e) for e in v] for k, v in sm.TYPE_EDGES.items()},
            "team": team, "agents_kb": agents_kb}


@app.get("/api/workers")
def api_workers():
    return _redact(_workers())


@app.get("/api/token")
def api_token():
    """POST 令牌（供本机前端 ctl 用；跨站 GET 已被 middleware 拒）。"""
    return {"token": CONFIG.panel_token}


@app.get("/api/transcript/{issue}")
def api_transcript(issue: str):
    return _redact(_transcript(issue))


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
