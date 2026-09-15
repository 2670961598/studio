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
    try:
        p = subprocess.run(["git", "-C", repo, *args], capture_output=True,
                           text=True, timeout=120)
    except subprocess.TimeoutExpired as e:
        raise RuntimeError(f"git {' '.join(args)} 超时: {e}") from e
    if check and p.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {p.stderr.strip()}")
    return p


def _release_lane(pid, lane, owner):
    """释放本单名下的 lane 锁（防泄漏；非我持有时静默）。"""
    try:
        lock(CONFIG, f"lane-{pid}-{lane}").release(owner)
    except (PermissionError, Exception):
        pass


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
        _close_proposal_windows(yt, pid)          # 先于空板早退（P3：否则观察窗永不结案）
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

    # ---- 已派发：收割 / 巡检 / 重派闭环（dispatch.md 兜底 1/2/6 的代码化）----
    if st == "已派发":
        w = Worker(iid)
        s = w.status()
        if s.startswith("DONE"):
            return _harvest(yt, pid, iid, lane, w, lv)
        if s.startswith("RUNNING"):
            try:                                   # 长任务续锁（lane TTL 120min < 大单耗时）
                lock(CONFIG, f"lane-{pid}-{lane}").beat()
            except Exception:
                pass
            hb = yt.f(iid, "心跳") or 0
            if hb and (time.time() * 1000 - hb) / 60000 > CONFIG.heartbeat_timeout_min:
                w.kill()
                _recycle(yt, pid, iid, "心跳超时 kill")
                _release_lane(pid, lane, f"worker-{iid}")
                return _redispatch(yt, pid, row, lv, typ)
            return None
        # ARCHIVED（本轮已收割处理，attempt 已计）或 UNKNOWN（尚无工人，如批示刚批）→ 不罚 attempt
        # DEAD（reg 在而进程亡）→ 计 attempt 兜底
        if not s.startswith(("ARCHIVED", "UNKNOWN")):
            _recycle(yt, pid, iid, f"worker 异常 {s[:40]}")
        _release_lane(pid, lane, f"worker-{iid}")
        return _redispatch(yt, pid, row, lv, typ)

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
            try:
                p = subprocess.run(["bash", "-c", extra], cwd=lc["path"],
                                   capture_output=True, text=True, timeout=300)
                extra_ok = p.returncode == 0
            except subprocess.TimeoutExpired:
                extra_ok = False
            note = f"加测={extra} → ok={extra_ok}"
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
def _redispatch(yt, pid, row, lv, typ) -> str:
    """断路判定 + 立即重派（P0-2：无此路径则单永久卡死、attempt 无限刷）。"""
    iid, lane = row["id"], row["lane"]
    flow = sm._flow(lv, typ)
    if int(yt.f(iid, "attempt") or 0) >= CONFIG.max_attempts:
        if flow and "待批" in flow:
            try:
                yt.transition(iid, "待批")
            except ValueError:
                pass
        yt.comment(iid, f"@{CONFIG.producer} attempt≥3 断路，等待批示")
        return f"BREAK {iid}"
    r = _dispatch(yt, pid, iid, lane, already=True)
    return r or f"REDISPATCH-DEFERRED {iid}"


def _dispatch(yt, pid, iid, lane, already: bool = False) -> str | None:
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
        # 重派复用已有分支（退回/断路后 feature/<单号> 已存在），首派才建新枝
        if _git(lc["path"], "rev-parse", "--verify", f"feature/{iid}",
                check=False).returncode == 0:
            _git(lc["path"], "checkout", f"feature/{iid}")
        else:
            _git(lc["path"], "checkout", "-b", f"feature/{iid}")
        Worker(iid).launch(yt.get(iid), lane)
        if not already:
            yt.transition(iid, "已派发")
        yt.heartbeat(iid)
        _event(pid, iid, "DISPATCH", "agent-pm", 0, f"lane={lane}")
        return f"DISPATCH {iid} lane={lane}"
    except Exception:
        lk.release(f"worker-{iid}")
        raise


def lane_of(yt, iid) -> str:
    return yt.f(iid, "泳道") or "core"


def _harvest(yt, pid, iid, lane, w: Worker, lv) -> str:
    report = w.report.read_text() if w.report.exists() else "(REPORT 缺失)"
    lc = CONFIG.lane(lane)
    try:
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
            return f"HARVEST {iid} →证据就绪"
        n = yt.attempt_inc(iid)
        flow = sm._flow(lv, yt.f(iid, "Type"))
        if n >= CONFIG.max_attempts:
            if flow and "待批" in flow:
                yt.transition(iid, "待批")      # 有审批位的级别 → 断路进待批
            yt.comment(iid, f"@{CONFIG.producer} attempt={n}≥3 断路，evidence {res['log']}")
            _event(pid, iid, "GATE_FAIL", "agent-pm", n, "断路")
        else:
            yt.comment(iid, f"GATE-FAIL attempt={n} 退回重做，evidence {res['log']}")
            _event(pid, iid, "GATE_FAIL", "agent-pm", n, res["log"])
        return f"GATE-FAIL {iid} attempt={n}"
    finally:
        w.archive()                              # REPORT 随之归档，防止旧卷反复收割
        _release_lane(pid, lane, f"worker-{iid}")


def _merge(yt, pid, iid, lane) -> str:
    lc = CONFIG.lane(lane)
    lk = lock(CONFIG, f"lane-{pid}-{lane}")
    try:
        lk.acquire(f"merge-{iid}", CONFIG.lane_lock_ttl_min)
    except LockBusy:
        return f"LANE-BUSY {lane}"
    try:
        # 半merge 残局隔离（P1-11：上次冲突中断留下的 unmerged index）
        if _git(lc["path"], "status", "--porcelain", check=False).stdout.strip():
            _git(lc["path"], "reset", "--hard", "HEAD")
            _git(lc["path"], "clean", "-fd")
        _git(lc["path"], "checkout", lc["base_branch"])
        _git(lc["path"], "merge", "--no-ff", f"feature/{iid}", "-m",
             f"merge({iid}): {yt.get(iid)['summary']}")
        res = run_gate(iid, f"verify-{int(time.time())}", lane)
        if res.ok:
            yt.transition(iid, "已交付")
            _event(pid, iid, "MERGE", "agent-pm", 0, f"→{lc['base_branch']} verify绿")
            _event(pid, iid, "CLOSE", "agent-pm", 0, "未push(无批示)")
            return f"DELIVERED {iid}"
        # verify 红：回滚 base 上的 merge commit，退回重做（P2-4）
        _git(lc["path"], "reset", "--hard", "ORIG_HEAD", check=False)
        n = yt.attempt_inc(iid)
        yt.comment(iid, f"merge-verify红回滚 exit={res['exit']} attempt={n}")
        _event(pid, iid, "GATE_FAIL", "agent-pm", n, "merge-verify红")
        try:
            yt.transition(iid, "已派发")
        except ValueError:
            pass
        return f"MERGE-VERIFY-FAIL {iid}"
    finally:
        lk.release(f"merge-{iid}")


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
    """制作人评论首 token 精确匹配（P2-6：子串匹配会误判"上次X批错了"）。"""
    for c in yt.comments(iid):
        if c["author"] == CONFIG.producer:
            toks = c["text"].strip().split()
            if toks and toks[0] == word:
                return True
    return False


def _directives(yt, iid, lv, typ) -> str | None:
    """位置感知批示：第 k 个未消费的 approve 指令作用于流的第 k 个待批位。
    消费留痕（PM 评论"批示已执行"）保证幂等——同一评论不会二次执行。"""
    cs = yt.comments(iid)
    applied = sum(1 for c in cs if c["author"] == "agent-pm"
                  and c["text"].startswith("批示已执行"))
    approvals = [c["text"].strip().split()[0] for c in cs
                 if c["author"] == CONFIG.producer and c["text"].strip()
                 and c["text"].strip().split()[0].startswith("approve")]
    if len(approvals) <= applied:
        # 没有新批示；查非 approve 指令（reject/kill/track）
        for c in cs[-10:]:
            if c["author"] != CONFIG.producer:
                continue
            w = c["text"].strip().split()
            d = w[0] if w else ""
            if d in ("reject", "kill"):
                yt.transition(iid, "已取消")
                return f"{d.upper()} {iid}"
            if d == "track" and len(w) > 1:
                yt.set_field(iid, "轨道", w[1])
                return f"LEVEL {iid} → {w[1]}"
        return None
    d = approvals[applied]                     # 第 applied 个（0基）未消费指令
    slot = sm._flow(lv, typ)
    if not slot or "待批" not in slot:
        return None
    idxs = [i for i, s in enumerate(slot) if s == "待批"]
    cur = idxs[min(applied, len(idxs) - 1)]
    nxt = slot[cur + 1] if cur + 1 < len(slot) else "已交付"
    note = f"{d} → {nxt} (第{applied + 1}批)"
    if nxt == "已交付":
        # 合并批：必须走真实 merge+verify（禁只翻状态）
        _merge(yt, iid.split("-")[0], iid, lane_of(yt, iid))
    else:
        yt.transition(iid, nxt)
    if lv.startswith("L3") and d == "approve-design":
        yt.comment(iid, "方案已批，重新派发实现段")
    yt.comment(iid, f"批示已执行 {d} → {nxt}")
    _event(iid.split("-")[0], iid, "APPROVE", "opengames", 0, note)
    return f"APPROVED {iid} {note}"
