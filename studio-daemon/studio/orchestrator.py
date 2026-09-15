"""orchestrator — 确定性状态机（吸收 sub-pm.md 十二步与 qa-gate.md 的可代码化部分）
LLM 只出现在三个岛上：DoD 生成 / QA 加测生成 / Epic 拆解(v2)；其余全部确定性代码。
任何一步失败：记日志、跳过该单、绝不抢跑——宁可空转。"""
import json, re, subprocess, time
from pathlib import Path
from . import statemachine
from .config import CONFIG
from .gates import run_gate
from .locks import lock, LockBusy
from .workers import Worker
from .yt import YT

ROLE_MAP = {"核心": "agent-dev", "业务": "agent-dev", "缺陷": "agent-dev",
            "策划": "agent-designer", "美术": "agent-artist"}


def _log(pid: str, line: str):
    p = CONFIG.logs_dir / f"daemon-{time.strftime('%F')}.log"
    with open(p, "a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%F %T')} [{pid}] {line}\n")


def _event(pid, issue, event, actor, attempt=0, note=""):
    from .metrics import append_event
    append_event(pid, issue, event, actor, attempt, note)


def _git(repo: str, *args, check=True) -> subprocess.CompletedProcess:
    p = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)
    if check and p.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {p.stderr.strip()}")
    return p


# ---------------------------------------------------------------- PM tick
def pm_tick(pid: str = "POLY") -> dict:
    lk = lock(CONFIG, f"tick-{pid}")
    try:
        lk.acquire(f"tick-{int(time.time())}", CONFIG.tick_lock_ttl_min)
    except LockBusy:
        return {"result": "LOCK-HELD"}
    yt = YT("agent-pm")
    out = {"result": "IDLE", "actions": []}
    try:
        board = yt.list(pid, "状态:" + ",".join(statemachine.PM_ACTIONABLE))
        if not board:
            out["result"] = "IDLE"
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
            except Exception as e:  # 单张失败不拖垮整个 tick
                _log(pid, f"ERROR {row['id']} {e}")
                out["actions"].append(f"ERROR {row['id']} {e}")
        return out
    finally:
        (CONFIG.heartbeats_dir / f"{pid}.hb").touch()
        lk.release()
        _log(pid, "TICK " + json.dumps(out, ensure_ascii=False))


def _handle(yt: YT, pid: str, row: dict) -> str | None:
    iid, st, lane = row["id"], row["state"], row["lane"]
    trk = row["track"] if row["track"] != "-" else "B 常规"
    tr = statemachine._norm(trk)

    # ---- 草稿：等制作人 promote，不动 ----
    if st == "草稿":
        return None

    # ---- 新单：DoD 冻结 + 进排期 ----
    if st == "新单":
        t = yt.get(iid)
        gate = t["fields"].get("验收命令")
        if not gate:
            from .llm import dod_gen
            gate = dod_gen(t)
            if not gate:
                yt.comment(iid, "DoD 缺失且自动生成失败，请制作人补验收命令")
                return f"DOD-MISSING {iid}"
            yt.gate_freeze(iid, gate)
        to = "已排期" if tr == "C" else "排期待审"
        yt.transition(iid, to)
        return f"NEW→{to} {iid}"

    # ---- 审批态：批示解析（只认制作人评论）----
    if st in ("排期待审", "方案待审", "待合并", "代码待审", "待终验收", "已取消"):
        return _directives(yt, iid, st, tr)

    # ---- 已排期：G1 断言（先全部通过再占 lane 锁，避免断言失败泄漏锁）+ 派工 ----
    if st == "已排期":
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
            yt.transition(iid, "开发中")
            yt.heartbeat(iid)
            _event(pid, iid, "DISPATCH", "agent-pm", 0, f"{trk}→claude worker lane={lane}")
            return f"DISPATCH {iid} lane={lane}"
        except Exception:
            lk.release()
            raise

    # ---- 开发中：收割 / 巡检 ----
    if st == "开发中":
        w = Worker(iid)
        s = w.status()
        if s.startswith("DONE"):
            return _harvest(yt, pid, iid, lane, w)
        if s.startswith("RUNNING"):
            hb = yt.f(iid, "心跳") or 0
            if hb and (time.time() * 1000 - hb) / 60000 > CONFIG.heartbeat_timeout_min:
                w.kill()
                _back(yt, pid, iid, f"心跳超时 worker={s}")
                return f"TIMEOUT-RECYCLE {iid}"
            return None
        # DEAD
        _back(yt, pid, iid, f"worker died {s}")
        return f"WORKER-DIED {iid} →已排期"

    # ---- 已批准(B/C)：合并尾段 ----
    if st == "已批准" and tr in ("B", "C"):
        lc = CONFIG.lane(lane)
        lk = lock(CONFIG, f"lane-{pid}-{lane}")
        try:
            lk.acquire(f"merge-{iid}", CONFIG.lane_lock_ttl_min)
        except LockBusy as e:
            return f"LANE-BUSY {lane} {e}"
        try:
            _git(lc["path"], "checkout", lc["base_branch"])
            _git(lc["path"], "merge", "--no-ff", f"feature/{iid}", "-m",
                 f"merge({iid}): {yt.get(iid)['summary']}")
            yt.transition(iid, "合并中")
            res = run_gate(iid, f"verify-{int(time.time())}", lane)
            yt.transition(iid, "合并验证")
            if res.ok:
                yt.transition(iid, "已关闭")
                _event(pid, iid, "MERGE", "agent-pm", 0, f"merge→{lc['base_branch']} verify绿")
                _event(pid, iid, "CLOSE", "agent-pm", 0, "未push(无批示)")
                return f"MERGE-OK {iid}"
            _back(yt, pid, iid, f"merge-verify红 exit={res['exit']}")
            return f"MERGE-VERIFY-FAIL {iid}"
        finally:
            lk.release()

    # ---- 合并中/合并验证：续尾 ----
    if st == "合并中":
        yt.transition(iid, "合并验证")
        return f"RESUME 合并中→合并验证 {iid}"
    if st == "合并验证":
        res = run_gate(iid, f"verify-{int(time.time())}", lane)
        if res.ok:
            to = "待终验收" if tr == "A" else "已关闭"
            yt.transition(iid, to)
            _event(pid, iid, "CLOSE" if to == "已关闭" else "STAGE", "agent-pm", 0, "verify绿")
            return f"VERIFY-OK {iid}→{to}"
        _back(yt, pid, iid, f"verify红 exit={res['exit']}")
        return f"VERIFY-FAIL {iid}"

    return None


def _harvest(yt: YT, pid: str, iid: str, lane: str, w: Worker) -> str:
    report = w.report.read_text() if w.report.exists() else "(REPORT 缺失)"
    lc = CONFIG.lane(lane)
    _git(lc["path"], "checkout", f"feature/{iid}")
    if not _git(lc["path"], "merge-base", "--is-ancestor", lc["base_branch"],
                f"feature/{iid}", check=False).returncode == 0:
        _back(yt, pid, iid, "飞线: base 不是 feature 祖先")
        return f"ORPHAN-BRANCH {iid}"
    res = run_gate(iid, str(int(yt.f(iid, "attempt") or 0) + 1), lane)
    if res.ok:
        yt.transition(iid, "待测试")
        yt.comment(iid, f"{report}\n\n— 代发 claude worker（studio-daemon）")
        _event(pid, iid, "GATE_PASS", "agent-pm", 0, f"evidence {res['log']}")
        w.archive()
        lock(CONFIG, f"lane-{pid}-{lane}").release()
        return f"HARVEST {iid} →待测试"
    n = yt.attempt_inc(iid)
    if n >= CONFIG.max_attempts:
        yt.transition(iid, "排期待审")
        yt.comment(iid, f"@{CONFIG.producer} attempt={n}≥3 断路退审，evidence {res['log']}")
    else:
        yt.transition(iid, "已排期")
        yt.comment(iid, f"GATE-FAIL attempt={n} evidence {res['log']}")
    _event(pid, iid, "GATE_FAIL", "agent-pm", n, f"evidence {res['log']}")
    w.archive()
    lock(CONFIG, f"lane-{pid}-{lane}").release()
    return f"GATE-FAIL {iid} attempt={n}"


def _back(yt: YT, pid: str, iid: str, why: str):
    n = yt.attempt_inc(iid)
    try:
        yt.transition(iid, "已排期")
    except ValueError:
        yt.transition(iid, "排期待审")
    yt.comment(iid, f"退回: {why}")
    _event(pid, iid, "GATE_FAIL", "agent-pm", n, why)


def _directives(yt: YT, iid: str, st: str, tr: str) -> str | None:
    for c in yt.comments(iid)[-10:]:
        if c["author"] != CONFIG.producer:
            continue
        txt = c["text"].strip()
        d = txt.split()[0] if txt else ""
        if d in statemachine.DIRECTIVES and st in statemachine.DIRECTIVES[d]:
            to = statemachine.DIRECTIVES[d][st].get(tr)
            if to and to != st:
                yt.transition(iid, to)
                return f"DIRECTIVE {d} {iid}→{to}"
        if d == "reject":
            yt.transition(iid, "已取消")
            return f"REJECT {iid}"
        if d == "kill":
            yt.transition(iid, "已取消")
            return f"KILL {iid}"
        if d == "track" and len(txt.split()) > 1:
            yt.set_field(iid, "轨道", txt.split()[1] + (" 常规" if txt.split()[1].upper() == "B" else ""))
            return f"TRACK {iid} {txt}"
    return None


# ---------------------------------------------------------------- QA tick
def qa_tick() -> dict:
    lk = lock(CONFIG, "qa")
    try:
        lk.acquire(f"qa-{int(time.time())}", 120)
    except LockBusy:
        return {"result": "LOCK-HELD"}
    ytq = YT("agent-qa")
    out = {"result": "IDLE", "actions": []}
    try:
        claims = []
        for pid in CONFIG.projects:
            claims += ytq.list(pid, "状态:待测试")
        if not claims:
            return out
        out["result"] = "OK"
        for row in claims[:3]:
            try:
                out["actions"].append(_qa_one(ytq, row))
            except Exception as e:
                _log(row["id"].split("-")[0], f"QA-ERROR {row['id']} {e}")
                out["actions"].append(f"QA-ERROR {row['id']} {e}")
        return out
    finally:
        lk.release()
        _log("QA", "TICK " + json.dumps(out, ensure_ascii=False))


def _qa_one(ytq: YT, row: dict) -> str:
    iid, lane = row["id"], row["lane"]
    lc = CONFIG.lane(lane)
    if _git(lc["path"], "status", "--porcelain", check=False).stdout.strip():
        return f"QA-SKIP {iid} 树脏"
    # 先认领（待测试→测试中），之后 PASS/FAIL 的出边才在矩阵内
    ytq.transition(iid, "测试中")
    _git(lc["path"], "checkout", f"feature/{iid}")
    res = run_gate(iid, f"qa-{int(time.time())}", lane, acct="agent-qa")
    gate = ytq.f(iid, "验收命令")
    from .llm import extra_test_gen
    extra = extra_test_gen(ytq.get(iid), gate)
    extra_ok = True
    if extra:
        p = subprocess.run(["bash", "-c", extra], cwd=lc["path"],
                           capture_output=True, text=True)
        extra_ok = p.returncode == 0
        extra_note = f"加测={extra} → exit={p.returncode}"
    else:
        extra_note = "加测=生成失败跳过"
    tr = statemachine._norm(row["track"] if row["track"] != "-" else "B 常规")
    if res.ok and extra_ok:
        to = {"A": "代码待审", "B": "待合并", "C": "已批准"}[tr]
        ytq.transition(iid, to)
        ytq.comment(iid, f"QA-PASS 证据={res['log'][:-4]}.json commit={res['commit']} {extra_note}")
        _event(row["id"].split("-")[0], iid, "QA_PASS", "agent-qa", 0, extra_note)
        return f"QA-PASS {iid}→{to}"
    n = ytq.attempt_inc(iid)
    ytq.transition(iid, "已排期")
    ytq.comment(iid, f"QA-FAIL attempt={n} 证据={res['log'][:-4]}.json {extra_note}")
    debt = ytq.new(row["id"].split("-")[0], f"{iid} 遗留：QA 打回项",
                   f"来源 {iid}，QA 证据 {res['log'][:-4]}.json", lane=lane,
                   typ="技术债", track=row["track"])
    _event(row["id"].split("-")[0], iid, "QA_BACK", "agent-qa", n, f"遗留单 {debt}")
    return f"QA-FAIL {iid} attempt={n} 遗留={debt}"
