"""metrics — 记账 + 自评引擎（元循环：工作室评估自己的表现，给自己开内部改进单）
events.jsonl append-only，与 bash 内核格式兼容；自评每日跑，异常模式 → STUDIO 草稿单。"""
import json, re, time
from pathlib import Path
from .config import CONFIG


def append_event(pid: str, issue: str, event: str, actor: str, attempt: int = 0,
                 note: str = "", tokens: int | None = None, cost_cny: float | None = None,
                 cost_usd: float | None = None, duration_ms: int | None = None):
    rec = {"ts": time.strftime("%F %T"), "pid": pid, "issue": issue, "event": event,
           "actor": actor, "attempt": int(attempt), "note": note}
    if tokens is not None:
        rec["tokens"] = tokens
    if cost_cny is not None:
        rec["cost_cny"] = cost_cny
    if cost_usd is not None:                   # worker stream 的 total_cost_usd 原币种入账
        rec["cost_usd"] = cost_usd
    if duration_ms is not None:
        rec["duration_ms"] = duration_ms
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


def _postmortem_scan(yt, evs) -> list[str]:
    """QA 打回自动复盘（STUDIO-43，制作人批准 2026-09-29）：打回/断路单自动沉淀
    现象→根因→解法→预防进知识库——人类反馈回流 evals 的断链补齐。
    防刷屏：已有「复盘已沉淀」标记的单不重开；每日 ≤2 张；岛失败静默跳过。"""
    from collections import Counter
    hits = Counter()
    for e in evs:
        if e.get("event") == "QA_BACK" or (
                e.get("event") == "GATE_FAIL" and int(e.get("attempt") or 0) >= 3):
            hits[e.get("issue")] += 1
    done = []
    for iid, n in hits.most_common(2):
        try:
            cs = yt.comments(iid)
        except Exception:
            continue
        if any((c["text"] or "").startswith("复盘已沉淀") for c in cs):
            continue                       # 查重：同单只复盘一次
        from .llm import reviewed_ask
        chain = "\n".join(f"{c['author']}: {(c['text'] or '')[:160]}" for c in cs[-12:])
        md = reviewed_ask(
            f"为下述单据的打回/断路写复盘（四段：## 现象/## 根因/## 解法/## 预防，"
            f"每段≤80字，结论具体可执行）。打回次数={n}。\n单据评论链：\n{chain}", 400)
        if not md or len(md) < 40:
            continue                       # 岛失败不炸，跳过
        pid = iid.split("-")[0]
        yt.wiki_create(f"复盘/{iid}", f"# 复盘 {iid}\n\n{md}", pid)
        yt.comment(iid, f"复盘已沉淀：知识库「复盘/{iid}」（现象→根因→解法→预防，"
                        f"打回 {n} 次自动触发，STUDIO-43）")
        append_event(pid, iid, "POSTMORTEM", "self-eval", 0, f"打回{n}次自动复盘")
        done.append(iid)
    return done


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
    yt = YT("agent-8")
    open_keys: set | None = None                # None = 查重不可用（09-21/09-22 两天
    for _retry in range(2):                     # 静默吞错连刷重复草稿的教训）
        try:
            open_keys = set()
            for r in yt.list("STUDIO", "State:草稿"):
                if r["type"] == "提案" and r["summary"].startswith("[自评]"):
                    # 键必须落在同一基准上：剥掉板面 summary 的 [自评] 前缀再归一——
                    # 前缀5字符会让 [:16] 截断后两边永远对不上（33/34/35/36 连刷的根因）
                    open_keys.add(_finding_key(r["summary"].removeprefix("[自评] ")))
            break
        except Exception as e:
            if _retry:                          # 重试仍败：留痕并停建——漏报有巡检兜底，刷屏扰制作人
                append_event("STUDIO", "-", "SELF_EVAL", "studio-daemon", 0,
                             f"查重查询失败本轮不建单: {type(e).__name__} {str(e)[:80]}")
                open_keys = None
    created = []
    for f in findings[:2]:
        if open_keys is None:
            continue
        if _finding_key(f) in open_keys:
            continue                            # 同模式草稿已在板上等制作人，不刷屏
        iid = yt.new("STUDIO", f"[自评] {f[:40]}", f"来源：studio-daemon 每日自评\n\n{f}\n\n"
                     f"指标窗口：{m['window_days']} 天\n处理建议：分析 events.jsonl 对应事件，"
                     f"改进对应手册/模板/参数。",
                     lane=None, typ="提案", track="G1 知识", state="草稿")
        yt.set_text(iid, "来源", "self-eval " + time.strftime("%F %T"))
        created.append(iid)
        append_event("STUDIO", iid, "SELF_EVAL", "studio-daemon", 0, f[:60])
    postmortems = []
    try:
        postmortems = _postmortem_scan(yt, evs)     # STUDIO-43：打回自动复盘（每日随自评）
    except Exception as e:
        append_event("STUDIO", "-", "SELF_EVAL", "studio-daemon", 0,
                     f"复盘扫描失败: {type(e).__name__} {str(e)[:60]}")
    report = {"ts": time.strftime("%F %T"), "metrics": {k: v for k, v in m.items() if k != "recent"},
              "findings": findings, "drafts": created, "postmortems": postmortems}
    (CONFIG.digest_dir / f"self-eval-{time.strftime('%F')}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2))
    return report
