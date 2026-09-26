"""reports — 运营报告引擎：日报/周报/月报（本地 md 落盘 + YouTrack 知识库发文）
宪章 §8 承诺的落地：正文全部入知识库 Articles，本地 reports/ 留底，幂等可重跑。
数据全部来自落盘事实：events.jsonl（记账）、runs.jsonl（岗哨）、daemon 日志（ERROR 段）、
git log（框架变更）、self-eval digest（自评）。没有数据就写「无」，绝不编造。"""
import json, re, subprocess, time
from pathlib import Path
from .config import CONFIG


def _yt():
    from .yt import YT
    return YT("agent-pm")


def _reports_dir() -> Path:
    d = CONFIG.events_path.parent / "reports"
    d.mkdir(parents=True, exist_ok=True)
    return d


# ---------------------------------------------------------------- 事实采集
def _events_all() -> list[dict]:
    """events.jsonl 全量读取，附 _t（epoch）便于切片；坏行跳过。"""
    p = CONFIG.events_path
    if not p.exists():
        return []
    out = []
    for ln in p.read_text(encoding="utf-8").splitlines():
        try:
            e = json.loads(ln)
            # 注意：strptime 不认 %F/%T（strftime 的 glibc 扩展），必须写全格式
            e["_t"] = time.mktime(time.strptime(e["ts"], "%Y-%m-%d %H:%M:%S"))
            out.append(e)
        except Exception:
            continue
    return out


def _slice(evs: list[dict], start_ts: float, end_ts: float) -> list[dict]:
    return [e for e in evs if start_ts <= e["_t"] < end_ts]


def _metrics(evs: list[dict]) -> dict:
    def n(t):
        return sum(1 for e in evs if e.get("event") == t)
    gp, gf = n("GATE_PASS"), n("GATE_FAIL")
    qp, qb = n("QA_PASS"), n("QA_BACK")
    return {"dispatch": n("DISPATCH"), "gate_pass": gp, "gate_fail": gf,
            "qa_pass": qp, "qa_back": qb, "merge": n("MERGE"), "close": n("CLOSE"),
            "stall": n("STALL"), "patrol": n("PATROL"),
            "gate_fail_rate": round(gf / (gp + gf), 3) if gp + gf else 0.0,
            "qa_back_rate": round(qb / (qp + qb), 3) if qp + qb else 0.0}


def _day_bounds(day: str) -> tuple[float, float]:
    start = time.mktime(time.strptime(day, "%Y-%m-%d"))
    return start, start + 86400


def _runs_of(day_prefix: str) -> list[dict]:
    """runs.jsonl 里属于某天（或某前缀）的岗哨记录。"""
    p = CONFIG.events_path.parent / "runs.jsonl"
    if not p.exists():
        return []
    out = []
    for ln in p.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(ln)
        except Exception:
            continue
        if str(r.get("ts", "")).startswith(day_prefix):
            out.append(r)
    return out


def _err_digest(day: str, top: int = 5) -> list[str]:
    """daemon 日志 ERROR 归一聚类：×N + 一条样本。归一键剥掉时间戳/单号/数字。"""
    f = CONFIG.logs_dir / f"daemon-{day}.log"
    if not f.exists():
        return []
    groups: dict[str, list[str]] = {}
    for ln in f.read_text(encoding="utf-8", errors="replace").splitlines():
        if "ERROR" not in ln:
            continue
        body = re.sub(r"^\S+ \S+ ", "", ln.strip())
        key = re.sub(r"\d+", "N", re.sub(r"[A-Za-z]+-\d+", "T", body))[:72]
        groups.setdefault(key, []).append(body[:120])
    out = []
    for key, samples in sorted(groups.items(), key=lambda kv: -len(kv[1]))[:top]:
        out.append(f"- （×{len(samples)}）{samples[0]}")
    return out


def _git_log(since_day: str, until_day: str | None = None) -> list[str]:
    """框架仓提交史（报告反映的是「本实例所在仓」——实验场报实验场，生产报生产）。"""
    args = ["git", "-C", str(CONFIG._root.parent), "log", "--oneline",
            f"--since={since_day}"]
    if until_day:
        args.append(f"--until={until_day}")
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=30)
        return [l for l in r.stdout.splitlines() if l.strip()]
    except Exception:
        return []


def _selfeval_findings(day: str) -> list[str]:
    f = CONFIG.digest_dir / f"self-eval-{day}.json"
    if not f.exists():
        return []
    try:
        return list(json.loads(f.read_text(encoding="utf-8")).get("findings", []))
    except Exception:
        return []


def _patrol_notes(evs: list[dict]) -> list[str]:
    out = []
    for e in evs:
        if e.get("event") == "PATROL":
            out.append(f"- {e.get('issue')}：{str(e.get('note', ''))[:80]}")
    return out


def _proposal_queue() -> list[str]:
    """治理队列快照（草稿/待批 提案）——报告的核心读者是制作人，待决事项置顶。"""
    try:
        rows = _yt().list("STUDIO", "Type:提案 状态:草稿,待批")
        return [f"- {r['id']} {str(r.get('summary', ''))[:48]}（{r.get('state')}）"
                for r in sorted(rows, key=lambda x: x["id"])]
    except Exception as e:
        return [f"- （板面查询失败：{type(e).__name__}）"]


# ---------------------------------------------------------------- 组装与发布
def _fmt_metrics(m: dict) -> str:
    return (f"派发 {m['dispatch']} ｜ 闸门 ✓{m['gate_pass']} ✗{m['gate_fail']}"
            f"（失败率 {m['gate_fail_rate']:.0%}）｜ QA ✓{m['qa_pass']} ✗{m['qa_back']}"
            f"（打回率 {m['qa_back_rate']:.0%}）｜ 合并 {m['merge']} ｜ 关单 {m['close']}"
            f" ｜ 巡逻 {m['patrol']} ｜ 卡单 {m['stall']}")


def _runs_summary(runs: list[dict]) -> list[str]:
    if not runs:
        return ["- （无岗哨记录）"]
    by: dict[str, dict] = {}
    for r in runs:
        s = by.setdefault(r.get("job", "?"), {"ok": 0, "bad": []})
        if r.get("outcome") in ("ok", "idle", "missed"):
            s["ok"] += 1
        else:
            s["bad"].append(f"{r.get('ts', '')[11:]} {r.get('summary', '')[:60]}")
    out = []
    for job, s in sorted(by.items()):
        line = f"- {job}：ok×{s['ok']}"
        if s["bad"]:
            line += f"，异常×{len(s['bad'])}（{'；'.join(s["bad"][:2])}）"
        out.append(line)
    return out


def _publish(wiki_path: str, md: str) -> str:
    try:
        _yt().wiki_create(wiki_path, md, "STUDIO")
        return "ok"
    except Exception as e:
        return f"失败:{type(e).__name__}"


def _emit(kind: str, name: str, md: str) -> dict:
    f = _reports_dir() / name
    f.write_text(md, encoding="utf-8")
    wiki = _publish(f"运营{kind}/{name.split('.', 1)[0].split('-', 1)[1]}", md)
    from .metrics import append_event
    append_event("STUDIO", "-", f"REPORT_{kind.upper()}", "reports", 0,
                 f"{name} wiki:{wiki}")
    return {"result": "OK", "actions": [f"{kind} {name} 本地✓ 知识库:{wiki}"]}


def daily_report() -> dict:
    """每日 21:30：当天全貌（指标/岗哨/异常/自评/巡逻/变更/待决）。"""
    day = time.strftime("%F")
    evs = _events_all()
    s, e = _day_bounds(day)
    m = _metrics(_slice(evs, s, e))
    lines = [f"# 工作室运营日报 {day}", "",
             "## 指标（当日）", _fmt_metrics(m), "",
             "## 岗哨运行", *_runs_summary(_runs_of(day)), "",
             "## 异常（daemon ERROR 归并）", *(_err_digest(day) or ["- 无"]), "",
             "## 自评发现", *(_selfeval_findings(day) or ["- 无"]), "",
             "## 战役巡逻", *(_patrol_notes(_slice(evs, s, e)) or ["- 无"]), "",
             "## 框架变更（git）", *(_git_log(day)[:10] or ["- 无"]), "",
             "## 待决提案（等制作人）", *_proposal_queue(), "",
             "> 自动生成 by studio-daemon reports，幂等重跑覆盖。"]
    return _emit("日报", f"daily-{day}.md", "\n".join(lines) + "\n")


def weekly_report() -> dict:
    """每周一 09:30：上 7 个完整日 vs 再前 7 日（环比），框架演进与待决。"""
    today = time.strftime("%F")
    evs = _events_all()
    t0 = time.mktime(time.strptime(today, "%Y-%m-%d"))
    cur = _metrics(_slice(evs, t0 - 7 * 86400, t0))
    prev = _metrics(_slice(evs, t0 - 14 * 86400, t0 - 7 * 86400))

    def delta(k):
        d = cur[k] - prev[k]
        return f"（环比 {'+' if d >= 0 else ''}{d}）" if k in ("dispatch", "close") else ""

    def rate_delta(k):
        d = cur[k] - prev[k]
        arrow = "↓改善" if d < 0 else ("↑恶化" if d > 0 else "→持平")
        return f"（上周 {prev[k]:.0%}，{arrow}）"

    iso = time.strftime("%G-W%V")
    lines = [f"# 工作室运营周报 {iso}（{today} 生成）", "",
             "## 指标（近 7 日 vs 前 7 日）",
             f"- 派发 {cur['dispatch']}{delta('dispatch')} ｜ 关单 {cur['close']}{delta('close')}",
             f"- 闸门失败率 {cur['gate_fail_rate']:.0%}{rate_delta('gate_fail_rate')}"
             f" ｜ QA 打回率 {cur['qa_back_rate']:.0%}{rate_delta('qa_back_rate')}",
             f"- 合并 {cur['merge']} ｜ 巡逻 {cur['patrol']} ｜ 卡单 {cur['stall']}", "",
             "## 异常 TOP（7 日归并）", *(_err_digest(today, top=8) or ["- 无"]), "",
             "## 框架演进（git，7 日）",
             *(_git_log(time.strftime("%F", time.localtime(t0 - 7 * 86400)), today)[:20] or ["- 无"]), "",
             "## 待决提案（等制作人）", *_proposal_queue(), "",
             "> 自动生成 by studio-daemon reports，幂等重跑覆盖。"]
    return _emit("周报", f"weekly-{iso}.md", "\n".join(lines) + "\n")


def monthly_report() -> dict:
    """每月 1 日 09:40：近 30 日 + 四周切片趋势。"""
    today = time.strftime("%F")
    evs = _events_all()
    t0 = time.mktime(time.strptime(today, "%Y-%m-%d"))
    m = _metrics(_slice(evs, t0 - 30 * 86400, t0))
    weeks = []
    for i in range(4):
        ws = t0 - (i + 1) * 7 * 86400
        we = t0 - i * 7 * 86400
        w = _metrics(_slice(evs, ws, we))
        weeks.append(f"- {time.strftime('%m-%d', time.localtime(ws))}~"
                     f"{time.strftime('%m-%d', time.localtime(ws + 6 * 86400))}："
                     f"派发 {w['dispatch']} ｜ 关单 {w['close']} ｜ 闸门失率 {w['gate_fail_rate']:.0%}")
    mon = today[:7]
    lines = [f"# 工作室运营月报 {mon}", "",
             "## 指标（近 30 日）", _fmt_metrics(m), "",
             "## 周趋势（远→近）", *weeks, "",
             "## 框架演进（git，30 日）",
             *( [f"- {l}" for l in _git_log(time.strftime(
                 "%F", time.localtime(t0 - 30 * 86400)), today)[:30]] or ["- 无"]), "",
             "## 待决提案（等制作人）", *_proposal_queue(), "",
             "> 自动生成 by studio-daemon reports，幂等重跑覆盖。"]
    return _emit("月报", f"monthly-{mon}.md", "\n".join(lines) + "\n")
