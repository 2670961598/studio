"""orchestrator v2 — 五族分类 × 级别流的确定性状态机
状态 = 机器事实：已派发(进程存在) / 证据就绪(REPORT+gate) / 复验通过(QA复验绿) / 已交付(merge+verify)。
v2 变化：QA 内联进收割链（证据就绪→复验通过），独立 qa 队列退役；L0 全自动；L3 两段派发。
派发前置/失败兜底全部按 kernel/skills/dispatch.md 执行。"""
import json, subprocess, time
from pathlib import Path
from . import statemachine as sm
from .config import CONFIG
from .gates import run_gate
from .locks import lock, LockBusy
from .workers import Worker
from .yt import YT

SPECIAL = {"疑问", "情报", "提案", "复盘", "战役", "事故"}   # 各自引擎/人工，pm 不碰


def _log(pid: str, line: str):
    with open(CONFIG.logs_dir / f"daemon-{time.strftime('%F')}.log", "a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%F %T')} [{pid}] {line}\n")


def _event(pid, issue, event, actor, attempt=0, note=""):
    from .metrics import append_event
    append_event(pid, issue, event, actor, attempt, note)


def _git(repo: str, *args, check=True):
    p = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)
    if check and p.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {p.stderr.strip()}")
    return p


def pm_tick(pid: str = "POLY") -> dict:
    lk = lock(CONFIG, f"tick-{pid}")
    try:
        lk.acquire(f"tick-{int(time.time())}", CONFIG.tick_lock_ttl_min)
    except LockBusy:
        return {"result": "LOCK-HELD", "actions": []}
    yt = YT("agent-pm")
    out = {"result": "IDLE", "actions": []}
    try:
        board = yt.list(pid, "状态:" + ",".join(sm.PM_ACTIONABLE))
        board = [r for r in board if r["type"] not in SPECIAL]
        if not board:
            return out
        out["result"] = "OK"
        dispatched = 0
        for row in board:
            if dispatched >= 3:
                break
            try:
                a = _handle(yt, pid, row)
                if a:
                    out["actions"].append(a)
                    if a.startswith("DISPATCH"):
                        dispatched += 1
            except Exception as e:
                _log(pid, f"ERROR {row['id']} {e}")
                out["actions"].append(f"ERROR {row['id']} {e}")
        _close_proposal_windows(yt, pid)
        return out
    finally:
        (CONFIG.heartbeats_dir / f"{pid}.hb").touch()
        lk.release()
        _log(pid, "TICK " + json.dumps(out, ensure_ascii=False))


def _close_proposal_windows(yt, pid):
    """治理提案的 7 日观察窗到期 → 结案。"""
    if pid != "POLY":
        return
    try:
        from .evolve import close_windows
        close_windows()
    except Exception as e:
        _log(pid, f"evolve-window {e}")


def _level(row) -> str:
    return sm._norm_level(row["track"] if row["track"] != "-" else "")


def _handle(yt: YT, pid: str, row: dict) -> str | None:
    iid, st, lane, typ = row["id"], row["state"], row["lane"], row["type"]
    lv = _level(row)
    flow = sm._flow(lv, typ)

    # ---- 新单：DoD 冻结 + 级别分流 ----
    if st == "新单":
        if not yt.f(iid, "验收命令"):
            from .llm import dod_gen
            gate = dod_gen(yt.get(iid))
            if not gate:
                yt.comment(iid, "DoD 自动生成失败，请制作人补验收命令后重试")
                return f"DOD-MISSING {iid}"
            yt.gate_freeze(iid, gate)
        if lv.startswith("L0"):
            return _dispatch(yt, pid, iid, lane)
        yt.transition(iid, "待批")
        return f"NEW→待批 {iid} [{lv}]"

    # ---- 待批：制作人批示（位置语义）----
    if st == "待批":
        return _directives(yt, iid, lv, typ)

    # ---- 已派发：收割（dispatch.md 兜底 1/2/6）----
    if st == "已派发":
        w = Worker(iid)
        s = w.status()
        if s.startswith("DONE"):
            return _harvest(yt, pid, iid, lane, w, lv)
        if s.startswith("RUNNING"):
            hb = yt.f(iid, "心跳") or 0
            if hb and (time.time() * 1000 - hb) / 60000 > CONFIG.heartbeat_timeout_min:
                w.kill()
                _recycle(yt, pid, iid, "心跳超时 kill")
                return f"TIMEOUT-RECYCLE {iid}"
            return None
        _recycle(yt, pid, iid, f"worker died {s[:60]}")
        return f"WORKER-DIED {iid} →已派发重派"

    # ---- 证据就绪：QA 内联复验（冻结验收复跑 + 加测岛）----
    if st == "证据就绪":
        # L3 第一段（方案）交付：无 approve-design 记录 → 进方案审
        if lv.startswith("L3") and not _has(yt, iid, "approve-design"):
            yt.transition(iid, "待批")
            return f"L3-方案段就绪 {iid} →待批(方案审)"
        res = run_gate(iid, f"qa-{int(time.time())}", lane, acct="agent-qa")
        from .llm import extra_test_gen
        extra = extra_test_gen(yt.get(iid), yt.f(iid, "验收命令") or "")
        extra_ok = True
        note = "加测=生成失败跳过"
        if extra:
            lc = CONFIG.lane(lane)
            p = subprocess.run(["bash", "-c", extra], cwd=lc["path"],
                               capture_output=True, text=True)
            extra_ok = p.returncode == 0
            note = f"加测={extra} → exit={p.returncode}"
        if res.ok and extra_ok:
            yt.transition(iid, "复验通过")
            yt.comment(iid, f"复验通过 证据={res['log'][:-4]}.json commit={res['commit']} {note}")
            _event(pid, iid, "QA_PASS", "agent-qa", 0, note)
            return f"VERIFY-OK {iid} {note[:60]}"
        n = yt.attempt_inc(iid)
        _back_to_dispatch(yt, pid, iid, n, f"复验红 exit={res['exit']} {note}")
        _event(pid, iid, "QA_BACK", "agent-qa", n, note)
        return f"VERIFY-FAIL {iid} attempt={n}"

    # ---- 复验通过：合并（L0/L1 自动；L2/L3 待批=合并审）----
    if st == "复验通过":
        if lv.startswith(("L0", "L1")):
            return _merge(yt, pid, iid, lane)
        yt.transition(iid, "待批")
        return f"READY→待批(合并审) {iid} [{lv}]"

    return None


# ---------------------------------------------------------------- 派发/收割/合并
def _dispatch(yt, pid, iid, lane) -> str:
    if lane == "-" or not lane:
        return f"NO-LANE {iid}"
    lc = CONFIG.lane(lane)
    if int(yt.f(iid, "attempt") or 0) >= CONFIG.max_attempts:
        return f"BREAK {iid} attempt≥3 待制作人"
    lk = lock(CONFIG, f"lane-{pid}-{lane}")
    if lk.check(CONFIG.lane_lock_ttl_min) != "FREE":
        return f"LANE-BUSY {lane}"
    if _git(lc["path"], "status", "--porcelain", check=False).stdout.strip():
        return f"TREE-DIRTY {lane} 跳过"
    lk.acquire(f"worker-{iid}", CONFIG.lane_lock_ttl_min)
    try:
        _git(lc["path"], "checkout", lc["base_branch"])
        _git(lc["path"], "checkout", "-b", f"feature/{iid}")
        Worker(iid).launch(yt.get(iid), lane)
        yt.transition(iid, "已派发")
        yt.heartbeat(iid)
        _event(pid, iid, "DISPATCH", "agent-pm", 0, f"lane={lane}")
        return f"DISPATCH {iid} lane={lane}"
    except Exception:
        lk.release()
        raise


def _harvest(yt, pid, iid, lane, w: Worker, lv) -> str:
    report = w.report.read_text() if w.report.exists() else "(REPORT 缺失)"
    lc = CONFIG.lane(lane)
    _git(lc["path"], "checkout", f"feature/{iid}")
    if _git(lc["path"], "merge-base", "--is-ancestor", lc["base_branch"],
            f"feature/{iid}", check=False).returncode != 0:
        _recycle(yt, pid, iid, "飞线: base 非 feature 祖先")
        return f"ORPHAN {iid}"
    res = run_gate(iid, str(int(yt.f(iid, "attempt") or 0) + 1), lane)
    if res.ok:
        yt.transition(iid, "证据就绪")
        yt.comment(iid, f"{report}\n\n— 代发 claude worker（studio-daemon v2）")
        _event(pid, iid, "GATE_PASS", "agent-pm", 0, f"evidence {res['log']}")
        w.archive()
        lock(CONFIG, f"lane-{pid}-{lane}").release()
        return f"HARVEST {iid} →证据就绪"
    n = yt.attempt_inc(iid)
    if n >= CONFIG.max_attempts:
        yt.transition(iid, "待批")
        yt.comment(iid, f"@{CONFIG.producer} attempt={n}≥3 断路，evidence {res['log']}")
        _event(pid, iid, "GATE_FAIL", "agent-pm", n, "断路")
    else:
        _back_to_dispatch(yt, pid, iid, n, f"GATE-FAIL evidence={res['log']}")
        _event(pid, iid, "GATE_FAIL", "agent-pm", n, res["log"])
    w.archive()
    lock(CONFIG, f"lane-{pid}-{lane}").release()
    return f"GATE-FAIL {iid} attempt={n}"


def _merge(yt, pid, iid, lane) -> str:
    lc = CONFIG.lane(lane)
    lk = lock(CONFIG, f"lane-{pid}-{lane}")
    try:
        lk.acquire(f"merge-{iid}", CONFIG.lane_lock_ttl_min)
    except LockBusy:
        return f"LANE-BUSY {lane}"
    try:
        _git(lc["path"], "checkout", lc["base_branch"])
        _git(lc["path"], "merge", "--no-ff", f"feature/{iid}", "-m",
             f"merge({iid}): {yt.get(iid)['summary']}")
        res = run_gate(iid, f"verify-{int(time.time())}", lane)
        if res.ok:
            yt.transition(iid, "已交付")
            _event(pid, iid, "MERGE", "agent-pm", 0, f"→{lc['base_branch']} verify绿")
            _event(pid, iid, "CLOSE", "agent-pm", 0, "未push(无批示)")
            return f"DELIVERED {iid}"
        n = yt.attempt_inc(iid)
        _back_to_dispatch(yt, pid, iid, n, f"merge-verify红 exit={res['exit']}")
        return f"MERGE-VERIFY-FAIL {iid}"
    finally:
        lk.release()


# ---------------------------------------------------------------- 兜底与批示
def _recycle(yt, pid, iid, why):
    """dispatch.md 兜底：退回已派发（attempt+1），脏树先隔离。"""
    lane = yt.f(iid, "泳道") or "core"
    lc = CONFIG.lane(lane)
    dirty = _git(lc["path"], "status", "--porcelain", check=False).stdout.strip()
    if dirty:
        _git(lc["path"], "stash", "push", "-u", "-m", f"quarantine-{iid}-{int(time.time())}")
        with open(CONFIG.logs_dir / "quarantine.log", "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%F %T')} {iid} {why}\n")
    n = yt.attempt_inc(iid)
    yt.comment(iid, f"兜底退回: {why} attempt={n}")
    _event(pid, iid, "GATE_FAIL", "agent-pm", n, why)


def _back_to_dispatch(yt, pid, iid, n, why):
    """attempt 未断：复验通过/证据就绪 → 已派发（下轮重派）。"""
    try:
        yt.transition(iid, "已派发")
    except ValueError:
        yt.transition(iid, "待批")
    yt.comment(iid, f"退回重做: {why} attempt={n}")


def _has(yt, iid, word) -> bool:
    return any(word in c["text"] for c in yt.comments(iid)
               if c["author"] == CONFIG.producer)


def _directives(yt, iid, lv, typ) -> str | None:
    """位置感知批示：同一"待批"在不同位置接受不同指令（见 schema levels）。"""
    approvals = [c for c in yt.comments(iid) if c["author"] == CONFIG.producer]
    approved = [c["text"].strip().split()[0] for c in approvals if c["text"].strip()]
    pos = approved.count("approve-plan") + approved.count("approve-design")  # 已过的批次数
    for c in yt.comments(iid)[-10:]:
        if c["author"] != CONFIG.producer:
            continue
        w = c["text"].strip().split()
        d = w[0] if w else ""
        if d == "reject" or d == "kill":
            yt.transition(iid, "已取消")
            return f"{d.upper()} {iid}"
        if d == "track" and len(w) > 1:
            yt.set_field(iid, "轨道", w[1])
            return f"LEVEL {iid} → {w[1]}"
        if not d.startswith("approve"):
            continue
        slot = sm._flow(lv, typ)
        if not slot or "待批" not in slot:
            return None
        # 第 pos+1 个待批即当前位置；按级别与位置匹配指令
        idxs = [i for i, s in enumerate(slot) if s == "待批"]
        cur = idxs[min(pos, len(idxs) - 1)]
        nxt = slot[cur + 1] if cur + 1 < len(slot) else "已交付"
        # 指令与位置的一致性（宽进：approve-* 都推进，但记录实际语义）
        yt.transition(iid, nxt)
        note = f"{d} → {nxt} (第{pos+1}批)"
        if lv.startswith("L3") and d == "approve-design":
            yt.comment(iid, "方案已批，重新派发实现段")
            from .llm import ask
            brief = ask(f"根据已批方案为 {iid} 生成实现段任务摘要（≤120字），只输出摘要。", 180) or "按方案文档实现"
            yt.comment(iid, f"实现段要点：{brief}")
        _event(iid.split("-")[0], iid, "APPROVE", "opengames", 0, note)
        return f"APPROVED {iid} {note}"
    return None
