"""dailies — 项目日巡三岗（STUDIO-109，制作人 2026-10-12 定则：定时任务全部归框架）
ZCode 侧四个定时岗收官迁移：games-daily（GAMES 专岗）/ poly-daily（三消专岗）/
pm-daily（宰相巡检四件事 08:30：daemon 健康/影子分歧/断路单/队列积压）。
运营日报/周报/月报已由 reports 引擎产出（daily/weekly/monthly）——本模块补三份
项目与巡检专报，运营日报区从此全覆盖（缺口核对结论，见 STUDIO-109 单据）。
共性纪律（红线，宪章 §4.4/§11）：
- 零批示零状态迁移零建单：只用 list/comments/comment/wiki_create；
  transition/set_field/new 一律不碰——批单权绝不进岗位
- 产出进 Articles「运营日报/」区（wiki_create 幂等，重跑=更新），本地 reports/ 留底
- 异常评论 @制作人（板面可见）：日指纹幂等（同单同异常当日只说一次，日跑不刷屏）
- LLM 只做摘要不做裁决（FLASH：快、便宜）；岛失败确定性兜底（首段事实顶上）；
  数据全部来自落盘事实，没有数据写「无」，绝不编造（同 reports 引擎铁律）"""
import json, subprocess, time
from pathlib import Path
from .config import CONFIG

# 岗位署名（宪章 §12.4 署名协议：[项目·个体名·部门]，个体名=org.yaml agents 段键）
SIGN_GAMES = ("GAMES", "GAMES专岗", "质量部")
SIGN_POLY = ("POLY", "三消专岗", "质量部")
SIGN_PM = ("STUDIO", "巡检引擎", "质量部")

# 巡检阈值（呈报口径，超阈才评论@制作人；只提醒不催促——core 亲批节奏归制作人）
CORE_BACKLOG_ALARM = 5      # core 泳道 新单+待批 ≥5 → 评论最老积压单
DAEMON_ERR_ALARM = 5        # 近 24h 岗哨 error ≥5 → 健康异常（记日报+记账）


def _yt():
    from .yt import YT
    return YT("agent-8")


def _log(job: str, line: str):
    with open(CONFIG.logs_dir / f"daemon-{time.strftime('%F')}.log", "a",
              encoding="utf-8") as f:
        f.write(f"{time.strftime('%F %T')} [dailies:{job}] {line}\n")


def _event(event: str, note: str, iid: str = "-", pid: str = "STUDIO"):
    from .metrics import append_event
    append_event(pid, iid, event, "agent-8", 0, note[:160])


# ---------------------------------------------------------------- 事实采集
def _recent_events(hours: float) -> list[dict]:
    """events.jsonl 近 N 小时切片（带 _t epoch）；坏行跳过。"""
    p = CONFIG.events_path
    if not p.exists():
        return []
    cutoff = time.time() - hours * 3600
    out = []
    for ln in p.read_text(encoding="utf-8").splitlines():
        try:
            e = json.loads(ln)
            e["_t"] = time.mktime(time.strptime(e["ts"], "%Y-%m-%d %H:%M:%S"))
            if e["_t"] >= cutoff:
                out.append(e)
        except Exception:
            continue
    return out


def _recent_runs(hours: float) -> list[dict]:
    """runs.jsonl 近 N 小时岗哨记录（ts 字符串解析过滤）。"""
    p = CONFIG.events_path.parent / "runs.jsonl"
    if not p.exists():
        return []
    cutoff = time.time() - hours * 3600
    out = []
    for ln in p.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(ln)
            if time.mktime(time.strptime(r["ts"], "%Y-%m-%d %H:%M:%S")) >= cutoff:
                out.append(r)
        except Exception:
            continue
    return out


def _counts(evs: list[dict]) -> dict:
    def n(t):
        return sum(1 for e in evs if e.get("event") == t)
    gp, gf = n("GATE_PASS"), n("GATE_FAIL")
    qp, qb = n("QA_PASS"), n("QA_BACK")
    return {"dispatch": n("DISPATCH"), "gate_pass": gp, "gate_fail": gf,
            "qa_pass": qp, "qa_back": qb, "merge": n("MERGE"), "close": n("CLOSE"),
            "breaker": sum(1 for e in evs
                           if e.get("event") == "GATE_FAIL" and int(e.get("attempt", 0)) >= 3),
            "gate_fail_rate": round(gf / (gp + gf), 3) if gp + gf else 0.0}


def _fmt_counts(m: dict) -> str:
    return (f"派发 {m['dispatch']} ｜ 闸门 ✓{m['gate_pass']} ✗{m['gate_fail']}"
            f"（失败率 {m['gate_fail_rate']:.0%}）｜ QA ✓{m['qa_pass']} ✗{m['qa_back']}"
            f" ｜ 断路 {m['breaker']} ｜ 合并 {m['merge']} ｜ 关单 {m['close']}")


def _breaker_issues(evs: list[dict]) -> list[str]:
    """近窗断路单（GATE_FAIL attempt≥3）去重，稳定序。"""
    seen = []
    for e in evs:
        if e.get("event") == "GATE_FAIL" and int(e.get("attempt", 0)) >= 3:
            iid = e.get("issue") or "-"
            if iid != "-" and iid not in seen:
                seen.append(iid)
    return seen


def _campaigns_dir() -> Path:
    """战役 spec/state 目录（调用时解析：测试换 _root 后必须跟着走，patrol 同理）。"""
    return CONFIG._root.parent / "kernel" / "campaigns"


def _git_brief(repo: str) -> list[str]:
    """仓状态三行：分支 / 最近 3 提交 / 脏文件数（git 只读；仓不存在写「不可达」）。"""
    def g(*a):
        return subprocess.run(["git", "-C", repo, *a], capture_output=True,
                              text=True, timeout=30)
    if not Path(repo).exists():
        return [f"- 仓库不可达：{repo}"]
    try:
        br = g("rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
        logs = [l for l in g("log", "--oneline", "-3").stdout.splitlines() if l.strip()]
        dirty = len(g("status", "--porcelain").stdout.splitlines())
        out = [f"- 分支 {br}｜脏文件 {dirty}"]
        out += [f"  {l}" for l in logs] or ["  （无提交）"]
        return out
    except Exception as e:
        return [f"- 仓库状态读取失败（{type(e).__name__}）：{repo}"]


def _flash_digest(topic: str, facts: list[str]) -> str | None:
    """FLASH 摘要岛：≤100 字运营摘要（面向制作人，只依据给的事实）。
    岛失败返回 None——调用方用首段事实确定性兜底，岗哨不因岛失败停摆。"""
    from .llm import ask, FLASH
    return ask(f"为下述{topic}写一句 ≤100 字的运营摘要（给制作人看的结论性概述，"
               f"只依据给出的事实，不编造、不展开建议）：\n" + "\n".join(facts[:24]),
               120, model=FLASH)


def _quality_profile() -> str:
    """GAMES 质量档案扫描：projects/GAMES/repo/docs/game-quality.json 档案计数
    （ZCode GAMES 专岗知识库迭代的回填对象——125 款档案是质量战役的粮）。
    防御性解析：list→长度；dict→最长 list 值；不可读写「无」。"""
    f = CONFIG._root.parent / "projects" / "GAMES" / "repo" / "docs" / "game-quality.json"
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        return "（档案文件缺失或不可读）"
    if isinstance(data, list):
        return f"{len(data)} 款"
    if isinstance(data, dict):
        best = max((v for v in data.values() if isinstance(v, list)), key=len, default=[])
        return f"{len(best)} 款（{len(data)} 键）" if best else f"{len(data)} 键"
    return "（档案结构未知）"


def _supervise_lines() -> list[str]:
    """复用 supervise 只读巡检引擎（ZCode 保留健康检查岗同款三查+）：
    daemon 存活/LLM 岛失败/worker 停滞/批准未消费/动作死循环/框架符合性。"""
    try:
        from .supervise import run as supervise_run
        sv = supervise_run()
        lines = [f"- {a['sev']}｜{a['kind']}｜{a['issue']}：{str(a.get('detail', ''))[:80]}"
                 for a in sv.get("anomalies", [])]
        return lines or ["- （巡检无异常）"]
    except Exception as e:
        return [f"- （巡检引擎失败：{type(e).__name__}）"]


# ---------------------------------------------------------------- 发布与告警
def _emit(job: str, sign: tuple, kind: str, md: str) -> dict:
    """本地 reports/ 留底 + Articles 运营日报区发布（幂等）+ 记账。"""
    day = time.strftime("%F")
    d = CONFIG.events_path.parent / "reports"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{kind}-{day}.md").write_text(md, encoding="utf-8")
    wiki = "失败:未发布"
    try:
        _yt().wiki_create(f"运营日报/{kind}-{day}", md, "STUDIO")
        wiki = "ok"
    except Exception as e:
        wiki = f"失败:{type(e).__name__}"
    _event(f"{job.upper().replace('-', '_')}", f"{kind}-{day} wiki:{wiki}")
    return {"result": "OK", "actions": [f"{kind}-{day} 本地✓ 知识库:{wiki}"]}


def _alarm(yt, iid: str, sign: tuple, lines: list[str]) -> str | None:
    """异常评论 @制作人（板面可见）；日指纹幂等（同单当日只说一次）。"""
    pid, who, dept = sign
    day = time.strftime("%F")
    fp = f"日巡告警 {day}"
    try:
        if any(who in (c["text"] or "")[:60] and fp in c["text"] for c in yt.comments(iid)):
            return None
        yt.comment(iid, "\n".join([f"[{pid}·{who}·{dept}] @{CONFIG.producer} {fp}", *lines]))
    except Exception as e:
        _log("alarm", f"ERROR comment {iid} {e}")
        return None
    _event("DAILY_ALARM", f"{iid} {'；'.join(lines)[:80]}", iid=iid, pid=pid)
    return f"ALARM {iid}"


# ---------------------------------------------------------------- 三岗
def games_daily() -> dict:
    """GAMES 专岗日跑：质量档案扫描 + 战役状态核对 → Articles 运营日报 GAMES 段。"""
    day = time.strftime("%F")
    yt = _yt()
    evs = [e for e in _recent_events(24) if e.get("pid") == "GAMES"]
    m = _counts(evs)
    # 战役状态核对：板面在役战役 × campaigns state（巡逻轮次/距上轮时长）
    camp_lines = ["- （板面无在役战役）"]
    try:
        camps = yt.list("GAMES", "Type:战役 状态:新单,运行中,暂停")
    except Exception as e:
        camps = []
        camp_lines = [f"- （战役查询失败：{type(e).__name__}）"]
    if camps:
        camp_lines = []
        for c in camps:
            iid = c["id"]
            stf = _campaigns_dir() / f"{iid}.state.json"
            try:
                st = json.loads(stf.read_text(encoding="utf-8"))
                ago = (time.time() - float(st.get("last", 0))) / 3600
                camp_lines.append(f"- {iid} {c.get('state')}：已巡逻 {st.get('count', 0)} 轮，"
                                  f"上轮 {ago:.0f}h 前｜{c.get('summary', '')[:40]}")
            except Exception:
                camp_lines.append(f"- {iid} {c.get('state')}：（无 state 文件或不可读——未开跑）"
                                  f"｜{c.get('summary', '')[:40]}")
    facts = [f"质量（近24h）：{_fmt_counts(m)}",
             f"质量档案：{_quality_profile()}",
             *(camp_lines[:3] or ["- （无战役）"])]
    digest = _flash_digest("GAMES 专岗日报事实", facts) or facts[0]
    lines = [f"# GAMES 专岗日报 {day}", "",
             f"## 摘要", f"- {digest}", "",
             "## 质量档案扫描（game-quality.json）", f"- {_quality_profile()}", "",
             "## 质量面（近 24h）", f"- {_fmt_counts(m)}", "",
             "## 战役状态核对", *(camp_lines or ["- 无"]), "",
             "> 自动生成 by studio-daemon dailies:games-daily（ZCode 定时岗迁移，STUDIO-109）；"
             "幂等重跑覆盖。"]
    out = _emit("games-daily", SIGN_GAMES, "games", "\n".join(lines) + "\n")
    # 异常@制作人：断路单逐单提醒（真异常）；闸门失败率偏高锚定最近失败单
    for iid in _breaker_issues(evs):
        a = _alarm(yt, iid, SIGN_GAMES,
                   [f"{iid} 近 24h 断路（attempt≥3），等待制作人批示（重批授权或 kill）。"])
        if a:
            out["actions"].append(a)
    if m["gate_fail"] >= 3 and m["gate_fail_rate"] > 0.5:
        fails = [e.get("issue") for e in evs if e.get("event") == "GATE_FAIL" and e.get("issue")]
        if fails:
            a = _alarm(yt, fails[-1], SIGN_GAMES,
                       [f"GAMES 闸门失败率 {m['gate_fail_rate']:.0%}"
                        f"（{m['gate_fail']}/{m['gate_pass'] + m['gate_fail']}）——请关注验收命令与 worker 自检。"])
            if a:
                out["actions"].append(a)
    _log("games-daily", json.dumps(out, ensure_ascii=False))
    return out


def poly_daily() -> dict:
    """三消专岗日跑：双仓状态 + core 积压清点 + 审查呈报摘要 → Articles。"""
    day = time.strftime("%F")
    yt = _yt()
    # ① 双仓状态：campaigns/POLY-*.yaml 登记的 repo 去重（core=MatchThree、game=Match-GLM）
    repos: dict[str, str] = {}
    try:
        import yaml
        for f in sorted(_campaigns_dir().glob("POLY-*.yaml")):
            try:
                spec = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
            except Exception:
                continue
            r = str(spec.get("repo") or "").strip()
            if r and r not in repos:
                repos[r] = f.stem
    except Exception:
        pass
    repo_lines = []
    for r, src in repos.items():
        repo_lines.append(f"### {r}（{src} 巡逻仓）")
        repo_lines += _git_brief(r)
    # ② core 积压清点 + ③ 审查呈报（一次查询，按状态/泳道分组）
    backlog, review = ["- （无）"], ["- （无）"]
    try:
        rows = yt.list("POLY", "状态:新单,待批,已派发,证据就绪,复验通过")
    except Exception as e:
        rows = []
        backlog = [f"- （板面查询失败：{type(e).__name__}）"]
    core = [r for r in rows if r.get("lane") == "core"]
    waiting = [r for r in core if r["state"] in ("新单", "待批")]
    if core:
        by: dict[str, int] = {}
        for r in core:
            by[r["state"]] = by.get(r["state"], 0) + 1
        backlog = [f"- core 泳道在途 {len(core)} 单（" +
                   "，".join(f"{k}×{v}" for k, v in sorted(by.items())) + "）"]
        backlog += [f"- {r['id']} {r['state']}｜{r.get('summary', '')[:44]}" for r in waiting]
        if not waiting:
            backlog.append("- （无新单/待批积压）")
    pending = [r for r in rows if r["state"] == "待批"]
    if pending:
        review = [f"- {r['id']}（{r.get('lane', '-')} 泳道）｜{r.get('summary', '')[:48]}"
                  for r in pending]
    evs = [e for e in _recent_events(24) if e.get("pid") == "POLY"]
    m = _counts(evs)
    facts = [f"质量（近24h）：{_fmt_counts(m)}",
             f"core 积压：{len(core)} 单（新单+待批 {len(waiting)}）",
             f"待批呈报：{len(pending)} 单"]
    digest = _flash_digest("三消专岗日报事实", facts) or facts[0]
    lines = [f"# 三消专岗日报 {day}", "",
             "## 摘要", f"- {digest}", "",
             "## 双仓状态", *(repo_lines or ["- （campaigns 未登记仓）"]), "",
             "## core 积压清点（亲批泳道）", *backlog, "",
             "## 审查呈报（待批）", *review, "",
             "## 质量面（近 24h）", f"- {_fmt_counts(m)}", "",
             "> 自动生成 by studio-daemon dailies:poly-daily（ZCode 定时岗迁移，STUDIO-109）；"
             "幂等重跑覆盖。"]
    out = _emit("poly-daily", SIGN_POLY, "poly", "\n".join(lines) + "\n")
    if len(waiting) >= CORE_BACKLOG_ALARM:
        oldest = waiting[0]
        a = _alarm(yt, oldest["id"], SIGN_POLY,
                   [f"core 泳道（制作人亲批）新单+待批积压 {len(waiting)} 单 ≥{CORE_BACKLOG_ALARM}，"
                    f"最老：{oldest['id']}｜{oldest.get('summary', '')[:44]}。呈报节奏供制作人参考。"])
        if a:
            out["actions"].append(a)
    _log("poly-daily", json.dumps(out, ensure_ascii=False))
    return out


def pm_daily() -> dict:
    """宰相巡检四件事（08:30）：daemon 健康/影子分歧/断路单/队列积压 → 宰相日报。"""
    day = time.strftime("%F")
    yt = _yt()
    runs = _recent_runs(24)
    # ① daemon 健康：岗哨 outcome 表 + 日志 ERROR 计数（细节归并归 report-daily）
    by: dict[str, dict] = {}
    for r in runs:
        s = by.setdefault(r.get("job", "?"), {"ok": 0, "bad": 0})
        if r.get("outcome") in ("ok", "idle"):
            s["ok"] += 1
        elif r.get("outcome") != "missed":
            s["bad"] += 1
    missed = sum(1 for r in runs if r.get("outcome") == "missed")
    err_total = sum(s["bad"] for s in by.values())
    health = [f"- {job}：ok×{s['ok']}" + (f"，error×{s['bad']}" if s["bad"] else "")
              for job, s in sorted(by.items())] or ["- （无岗哨记录）"]
    health = [f"- 近 24h 岗哨 error {err_total} 次、missed {missed} 次（阈值 {DAEMON_ERR_ALARM}）",
              *health, "- 巡检引擎（supervise）：", *_supervise_lines()]
    # ② 影子分歧 ③ 断路单
    evs = _recent_events(24)
    diffs = [(e.get("issue"), str(e.get("note", ""))[:60])
             for e in evs if e.get("event") == "SHADOW_DIFF" and e.get("issue")]
    diff_lines = [f"- {i}：{n}" for i, n in diffs] or ["- 无"]
    breakers = _breaker_issues(evs)
    br_lines = [f"- {i}" for i in breakers] or ["- 无"]
    # ④ 队列积压：各项目 新单+待批 计数
    q_lines = []
    for pid in CONFIG.projects:
        try:
            rows = yt.list(pid, "状态:新单,待批")
        except Exception as e:
            q_lines.append(f"- {pid}：（查询失败 {type(e).__name__}）")
            continue
        q_lines.append(f"- {pid}：新单+待批 {len(rows)} 单"
                       + (f"｜{'、'.join(r['id'] for r in rows[:4])}" if rows else ""))
    facts = [f"daemon 健康：error {err_total} / missed {missed}（阈值 {DAEMON_ERR_ALARM}）",
             f"影子分歧 {len(diffs)} 次", f"断路单 {len(breakers)} 张",
             *(l.lstrip("- ") for l in q_lines)]
    digest = _flash_digest("宰相巡检四件事事实", facts) or facts[0]
    lines = [f"# 宰相巡检日报 {day}", "",
             "## 摘要", f"- {digest}", "",
             "## ① daemon 健康（近 24h）", *health, "",
             "## ② 影子分歧（SHADOW_DIFF）", *diff_lines, "",
             "## ③ 断路单（attempt≥3）", *br_lines, "",
             "## ④ 队列积压（新单+待批）", *q_lines, "",
             "> 自动生成 by studio-daemon dailies:pm-daily（宰相巡检四件事迁移，STUDIO-109）；"
             "幂等重跑覆盖。"]
    out = _emit("pm-daily", SIGN_PM, "pm", "\n".join(lines) + "\n")
    # 异常@制作人：影子分歧与断路单逐单提醒（真异常，板面可见）
    for iid, note in diffs:
        a = _alarm(yt, iid, SIGN_PM,
                   [f"影子分歧（{note}）——org 分权引擎与 legacy 判定不一致，请宰相/制作人知悉。"])
        if a:
            out["actions"].append(a)
    for iid in breakers:
        a = _alarm(yt, iid, SIGN_PM,
                   [f"{iid} 断路（attempt≥3，近 24h），等待制作人批示（重批授权或 kill）。"])
        if a:
            out["actions"].append(a)
    if err_total >= DAEMON_ERR_ALARM:
        out["actions"].append(f"HEALTH-WARN 近24h岗哨error×{err_total}（≥{DAEMON_ERR_ALARM}，详见日报）")
    _log("pm-daily", json.dumps(out, ensure_ascii=False))
    return out


if __name__ == "__main__":
    import sys as _sys
    _job = {"games": games_daily, "poly": poly_daily, "pm": pm_daily}.get(
        _sys.argv[1] if len(_sys.argv) > 1 else "", pm_daily)
    print(json.dumps(_job(), ensure_ascii=False, indent=1))
