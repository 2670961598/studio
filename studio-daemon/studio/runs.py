"""runs — 运行记录器：APScheduler 事件 → runs.jsonl（append-only），平台历史数据的唯一来源"""
import json, re, time
from pathlib import Path
from .config import CONFIG

def _runs_path() -> Path:
    """调用时解析（不模块级缓存）：CONFIG.events_path 可被测试 tmp_config/实验场
    STUDIO_ROOT 换根——模块级常量曾让 /api/runs 读到生产账本（test_runs_空 暴露）。"""
    return CONFIG.events_path.parent / "runs.jsonl"

JOB_NAMES = {"pm-poly": "子PM·POLY", "pm-studio": "子PM·STUDIO", "qa": "全局QA", "self-eval": "自评引擎",
             "patrol": "战役巡逻", "evolve-scan": "schema自进化", "evolve": "schema自进化",
             "report-daily": "运营日报", "report-weekly": "运营周报", "report-monthly": "运营月报"}


def append_run(job: str, outcome: str, duration_ms: int = 0, summary: str = ""):
    rec = {"ts": time.strftime("%F %T"), "job": job, "name": JOB_NAMES.get(job, job),
           "outcome": outcome, "duration_ms": int(duration_ms), "summary": summary[:200]}
    with open(_runs_path(), "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


class DurationTracker:
    """岗哨耗时配对器：APScheduler 的执行事件不携带耗时——SUBMITTED/EXECUTED
    （或 ERROR）按 job_id 配对自测。max_instances=1 保证同 job 同时至多一个在途，
    dict 键安全。MISSED 从未真正起跑，drop 掉防脏配对。"""

    def __init__(self):
        self._t: dict[str, float] = {}

    def submitted(self, job_id: str):
        self._t[job_id] = time.time()

    def settle(self, job_id: str) -> int:
        t0 = self._t.pop(job_id, None)
        return int((time.time() - t0) * 1000) if t0 else 0

    def drop(self, job_id: str):
        self._t.pop(job_id, None)


def list_runs(job: str | None = None, limit: int = 100) -> list[dict]:
    if not _runs_path().exists():
        return []
    out = []
    for ln in _runs_path().read_text(encoding="utf-8").splitlines():
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
    if _runs_path().exists() and list_runs(limit=1):
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
            with open(_runs_path(), "a", encoding="utf-8") as f:
                f.write(json.dumps({"ts": ts, "job": job, "name": JOB_NAMES.get(job, job),
                                    "outcome": outcome, "duration_ms": 0,
                                    "summary": summary}, ensure_ascii=False) + "\n")
            n += 1
    return n
