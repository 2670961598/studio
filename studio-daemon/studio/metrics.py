"""metrics — 记账 + 自评引擎（元循环：工作室评估自己的表现，给自己开内部改进单）
events.jsonl append-only，与 bash 内核格式兼容；自评每日跑，异常模式 → STUDIO 草稿单。"""
import json, re, time
from pathlib import Path
from .config import CONFIG


def append_event(pid: str, issue: str, event: str, actor: str, attempt: int = 0,
                 note: str = "", tokens: int | None = None, cost_cny: float | None = None):
    rec = {"ts": time.strftime("%F %T"), "pid": pid, "issue": issue, "event": event,
           "actor": actor, "attempt": int(attempt), "note": note}
    if tokens is not None:
        rec["tokens"] = tokens
    if cost_cny is not None:
        rec["cost_cny"] = cost_cny
    with open(CONFIG.events_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def _events(days: int = 7) -> list[dict]:
    if not CONFIG.events_path.exists():
        return []
    cutoff = time.time() - days * 86400
    out = []
    for ln in CONFIG.events_path.read_text(encoding="utf-8").splitlines():
        try:
            e = json.loads(ln)
            if time.mktime(time.strptime(e["ts"], "%Y-%m-%d %H:%M:%S")) >= cutoff:
                out.append(e)
        except Exception:
            continue
    return out


def compute(days: int = 7) -> dict:
    """AI 版 DORA：单量、闸门拦截率、QA 打回率、断路次数、stall、worker 死亡。"""
    evs = _events(days)
    def n(t): return sum(1 for e in evs if e["event"] == t)
    gate_pass, gate_fail = n("GATE_PASS"), n("GATE_FAIL")
    qa_pass, qa_back = n("QA_PASS"), n("QA_BACK")
    return {
        "window_days": days,
        "dispatch": n("DISPATCH"), "gate_pass": gate_pass, "gate_fail": gate_fail,
        "qa_pass": qa_pass, "qa_back": qa_back,
        "merge": n("MERGE"), "close": n("CLOSE"), "stall": n("STALL"),
        "quarantine": n("QUARANTINE"),
        "gate_fail_rate": round(gate_fail / (gate_pass + gate_fail), 3) if gate_pass + gate_fail else 0.0,
        "qa_back_rate": round(qa_back / (qa_pass + qa_back), 3) if qa_pass + qa_back else 0.0,
        "breaker_hits": sum(1 for e in evs if e["event"] == "GATE_FAIL" and int(e.get("attempt", 0)) >= 3),
        "recent": evs[-30:],
    }


def _finding_key(f: str) -> str:
    """异常模式归一键：剥掉数字/百分比/括号——'闸门失败率 55%' 与 '46%' 同键，跨天可查重。"""
    return re.sub(r"[\d%（）()．.]+", "", f)[:16]


def self_eval() -> dict:
    """元循环：指标 → 异常模式 → 内部改进草稿单（≤2/日，量化证据，制作人择优 promote）。
    查重：同模式草稿未结案（State=草稿）不重复建——否则每天一跑就堆一摞重复提案。"""
    m = compute(7)
    findings = []
    if m["gate_fail_rate"] > 0.3 and m["gate_fail"] >= 3:
        findings.append(f"闸门失败率 {m['gate_fail_rate']:.0%}（{m['gate_fail']}/{m['gate_pass'] + m['gate_fail']}）"
                        f"——检查 DoD 生成质量与 worker 任务书模板")
    if m["qa_back_rate"] > 0.3 and m["qa_back"] >= 2:
        findings.append(f"QA 打回率 {m['qa_back_rate']:.0%}——worker 自检纪律或加测覆盖不足")
    if m["breaker_hits"] >= 1:
        findings.append(f"断路触发 {m['breaker_hits']} 次（attempt≥3）——相关单需人工复盘")
    if m["stall"] >= 3:
        findings.append(f"STALL {m['stall']} 次——审批等待或卡单回收策略需调")
    from .yt import YT
    yt = YT("agent-pm")
    open_keys = set()
    try:
        for r in yt.list("STUDIO", "State:草稿"):
            if r["type"] == "提案" and r["summary"].startswith("[自评]"):
                open_keys.add(_finding_key(r["summary"]))
    except Exception:
        pass                                    # 查重失败不阻断（宁可重复不可漏报）
    created = []
    for f in findings[:2]:
        if _finding_key(f) in open_keys:
            continue                            # 同模式草稿已在板上等制作人，不刷屏
        iid = yt.new("STUDIO", f"[自评] {f[:40]}", f"来源：studio-daemon 每日自评\n\n{f}\n\n"
                     f"指标窗口：{m['window_days']} 天\n处理建议：分析 events.jsonl 对应事件，"
                     f"改进对应手册/模板/参数。",
                     lane=None, typ="提案", track="G1 知识", state="草稿")
        yt.set_text(iid, "来源", "self-eval " + time.strftime("%F %T"))
        created.append(iid)
        append_event("STUDIO", iid, "SELF_EVAL", "studio-daemon", 0, f[:60])
    report = {"ts": time.strftime("%F %T"), "metrics": {k: v for k, v in m.items() if k != "recent"},
              "findings": findings, "drafts": created}
    (CONFIG.digest_dir / f"self-eval-{time.strftime('%F')}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2))
    return report
