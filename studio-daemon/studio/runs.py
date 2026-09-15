"""runs — 运行记录器：APScheduler 事件 → runs.jsonl（append-only），平台历史数据的唯一来源"""
import json, re, time
from pathlib import Path
from .config import CONFIG

RUNS = CONFIG.events_path.parent / "runs.jsonl"

JOB_NAMES = {"pm-poly": "子PM·POLY", "pm-studio": "子PM·STUDIO", "qa": "全局QA", "self-eval": "自评引擎",
             "patrol": "战役巡逻", "evolve-scan": "schema自进化", "evolve": "schema自进化"}


def append_run(job: str, outcome: str, duration_ms: int = 0, summary: str = ""):
    rec = {"ts": time.strftime("%F %T"), "job": job, "name": JOB_NAMES.get(job, job),
           "outcome": outcome, "duration_ms": int(duration_ms), "summary": summary[:200]}
    with open(RUNS, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def list_runs(job: str | None = None, limit: int = 100) -> list[dict]:
    if not RUNS.exists():
        return []
    out = []
    for ln in RUNS.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(ln)
        except Exception:
            continue
        if job and r.get("job") != job:
            continue
        out.append(r)
    return out[-limit:][::-1]


def last_run(job: str) -> dict | None:
    runs = list_runs(job, limit=1)
    return runs[0] if runs else None


def seed_from_logs():
    """把 daemon 日志里历史 TICK 行导入 runs.jsonl（只导一次，幂等按时间戳去重）。"""
    if RUNS.exists() and list_runs(limit=1):
        return 0
    n = 0
    for lg in sorted(CONFIG.logs_dir.glob("daemon-*.log")):
        for ln in lg.read_text(encoding="utf-8", errors="replace").splitlines():
            m = re.match(r"(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) \[(POLY|QA)\] TICK (\{.*\})$", ln.strip())
            if not m:
                continue
            ts, who, body = m.groups()
            try:
                data = json.loads(body)
            except Exception:
                continue
            job = "pm-poly" if who == "POLY" else "qa"
            outcome = "ok" if data.get("result") in ("OK", "IDLE") else data.get("result", "?").lower()
            summary = "; ".join(data.get("actions", []))[:200] or data.get("result", "")
            with open(RUNS, "a", encoding="utf-8") as f:
                f.write(json.dumps({"ts": ts, "job": job, "name": JOB_NAMES.get(job, job),
                                    "outcome": outcome, "duration_ms": 0,
                                    "summary": summary}, ensure_ascii=False) + "\n")
            n += 1
    return n
