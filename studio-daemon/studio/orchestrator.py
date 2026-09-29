"""orchestrator v2 — 五族分类 × 级别流的确定性状态机
状态 = 机器事实：已派发(进程存在) / 证据就绪(REPORT+gate) / 复验通过(QA复验绿) / 已交付(merge+verify)。
v2 变化：QA 内联进收割链（证据就绪→复验通过），独立 qa 队列退役；L0 全自动；L3 两段派发。
派发前置/失败兜底全部按 YouTrack Articles 手册/dispatch 执行（STUDIO-13 迁移，旧 kernel/skills/ 已删）。"""
import json, re, subprocess, time
from pathlib import Path
from . import statemachine as sm
from .config import CONFIG
from .gates import run_gate
from .locks import lock, LockBusy
from .workers import Worker
from .yt import YT

SPECIAL = {"疑问", "情报", "提案", "复盘", "战役", "事故"}   # 各自引擎/人工，pm 不碰

# ---- 部门路由（STUDIO-55 P3-b / STUDIO-61，制作人 2026-09-29 派单）----
# 单据"部门"字段驱动施工泳道（ORG-DESIGN：部门有自己的泳道/资源）：
# 工程部→framework、情报部→explore（并行通道）、跨部门（多值枚举或字面值）→
# 联签提示默认工程部。无部门字段/未知部门 → 泳道字段照旧（行为与现状完全一致）；
# 亲批泳道（producer_only_lanes）钉死不迁——部门路由不得把单搬出制作人红线泳道。
DEPT_LANES = {"工程部": "framework", "情报部": "explore"}
COSIGN_MARK = "跨部门联签提示"      # 幂等锚点：提示评论每单只发一次（pm_tick 每 10 分钟一拍）


def _log(pid: str, line: str):
    with open(CONFIG.logs_dir / f"daemon-{time.strftime('%F')}.log", "a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%F %T')} [{pid}] {line}\n")


def _event(pid, issue, event, actor, attempt=0, note="", **acct):
    from .metrics import append_event
    append_event(pid, issue, event, actor, attempt, note, **acct)


def _git(repo: str, *args, check=True):
    try:
        p = subprocess.run(["git", "-C", repo, *args], capture_output=True,
                           text=True, timeout=120)
    except subprocess.TimeoutExpired as e:
        raise RuntimeError(f"git {' '.join(args)} 超时: {e}") from e
    if check and p.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {p.stderr.strip()}")
    return p


# ---- 优雅重载（STUDIO-47A，制作人 2026-09-28 需求）----
# 重启即指令：收到后停派新工（drain），在途 worker 自然收割完，daemon 自我退出，
# 看护拉起新代码，从外置状态原地续跑——框架与项目零中断。

DRAIN_FILE = "drain.json"


def drain_requested() -> bool:
    return (CONFIG.locks_dir / DRAIN_FILE).exists()


def in_flight() -> int:
    """在途 worker 数（reg 文件在=未收割；done=已归档不算）。"""
    return len([f for f in CONFIG.workers_dir.glob("*.json")
                if not f.name.endswith(".done.json")])


def drain_ready() -> tuple[bool, str]:
    """drain 完成判定：无在途 reg 且无 claude 进程（LLM 岛短进程也等掉，防孤儿写半截）。"""
    import subprocess as _sp
    if not drain_requested():
        return False, "no-drain"
    n = in_flight()
    if n:
        return False, f"in-flight={n}"
    try:
        # 只查我们签发的 worker wrap（kernel/workers/*.wrap.sh）——裸查 "claude -p"
        # 会误匹配制作人终端里的 claude 会话，曾致 drain 永不清零（00:01 崩溃循环实录）
        r = _sp.run(["pgrep", "-f", "workers/.*wrap.sh"], capture_output=True)
        if r.returncode == 0:
            return False, "wrap-alive"
    except Exception:
        pass
    return True, "ready"


def _release_lane(pid, lane, owner):
    """释放本单名下的 lane 锁（防泄漏；非我持有时静默）。
    锁名只按 lane（审计 P0-4）：lane 在全局 lanes 表注册，同名必同物理仓——
    曾带 pid 前缀导致 GAMES/POLY 对同一 checkout 各持各的锁，跨项目互斥全失。"""
    try:
        lock(CONFIG, f"lane-{lane}").release(owner)
    except (PermissionError, Exception):
        pass


def pm_tick(pid: str = "POLY") -> dict:
    lk = lock(CONFIG, f"tick-{pid}")
    try:
        lk.acquire(f"tick-{int(time.time())}", CONFIG.tick_lock_ttl_min)
    except LockBusy:
        return {"result": "LOCK-HELD", "actions": []}
    yt = YT("agent-8")
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
    lane = dept_lane(yt, iid, lane)   # P3-b 部门路由：同单全程同一泳道（收割/复验/合并/放锁一致）
    lv = _level(row)
    flow = sm._flow(lv, typ)

    # ---- 草稿：等制作人 promote/kill（Inspector/Scout/自评 的产出位）----
    if st == "草稿":
        cs0 = yt.comments(iid)
        hold = _producer_hold(cs0)
        for c in cs0:
            if (hold and c["author"] != CONFIG.producer) \
                    or not CONFIG.can_approve(pid, c["author"], lane):
                continue
            w = c["text"].strip().split()
            d0 = w[0] if w else ""
            if d0 == "promote":
                to = "发现" if typ == "情报" else "新单"
                yt.transition(iid, to)
                return f"PROMOTED {iid} →{to}"
            if d0 in ("kill", "reject"):
                yt.transition(iid, "已取消")
                return f"{d0.upper()}-DRAFT {iid}"
        return None

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
        # STUDIO-79 全流程逐环签字：高等级单立项位预告（幂等，低等级不发）
        from . import signoff
        signoff.brief_comment(yt, iid, org_level(yt, iid))
        yt.transition(iid, "待批")
        return f"NEW→待批 {iid} [{lv}]"

    # ---- 待批：制作人批示（位置语义）----
    if st == "待批":
        return _directives(yt, iid, lv, typ, lane)

    # ---- 已派发：收割 / 巡检 / 重派闭环（dispatch.md 兜底 1/2/6 的代码化）----
    if st == "已派发":
        w = Worker(iid)
        s = w.status()
        if s.startswith("DONE"):
            return _harvest(yt, pid, iid, lane, w, lv)
        if s.startswith("RUNNING"):
            # 长任务续锁（lane TTL 120min < 大单耗时；按盘上 owner 校验）
            lock(CONFIG, f"lane-{lane}").beat(f"worker-{iid}")
            # wall-clock 兜底（审计 P0-3）：wrap 内看门狗是主杀手，此处第二道防线——
            # 防 worker 持续心跳却永不封顶（心跳制 90min ≠ 宪章 45min 上限）
            try:
                started = time.mktime(time.strptime(
                    (w.reg_data() or {}).get("started") or "", "%Y-%m-%d %H:%M:%S"))
            except ValueError:
                started = 0.0
            if started and time.time() - started > CONFIG.worker_wall_timeout_s:
                if w.report.exists():               # 恰好交卷：走收割不误杀（P1-7）
                    return _harvest(yt, pid, iid, lane, w, lv)
                w.kill()
                if not w.wait_dead():               # 等死再动树；超时则下拍再重派
                    w.kill(escalate=True)           # SIGTERM 拒退→SIGKILL（P0：僵死进程曾卡道 20min+）
                    if not w.wait_dead():
                        return f"KILL-PENDING {iid} 等待进程退出"
                _recycle(yt, pid, iid,
                         f"wall-clock 超限 kill（>{CONFIG.worker_wall_timeout_s // 60}min）")
                _release_lane(pid, lane, f"worker-{iid}")
                return _redispatch(yt, pid, row, lv, typ)
            hb = yt.f(iid, "心跳") or 0
            if hb and (time.time() * 1000 - hb) / 60000 > CONFIG.heartbeat_timeout_min:
                if w.report.exists():               # 恰好交卷：走收割不误杀（P1-7）
                    return _harvest(yt, pid, iid, lane, w, lv)
                w.kill()
                if not w.wait_dead():
                    w.kill(escalate=True)           # SIGTERM 拒退→SIGKILL（同上）
                    if not w.wait_dead():
                        return f"KILL-PENDING {iid} 等待进程退出"
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
        if lv.startswith("L3") and not _has(yt, iid, "approve-design", lane):
            yt.transition(iid, "待批")
            # 结构性槽位标记：进的是哪个待批位由转换本身声明，与批示词解析解耦
            yt.comment(iid, "方案段就绪，进入方案审")
            return f"L3-方案段就绪 {iid} →待批(方案审)"
        if lane != "explore":
            # 复验与活 worker 抢共享树必误红（GAMES-5/6 实录：闸门跑在别人分支上 4 连退回）。
            # 泳道忙 → 顺延不烧 attempt；闲 → 持锁切到本单分支再跑闸门与加测。
            lk = lock(CONFIG, f"lane-{lane}")
            if lk.check(CONFIG.lane_lock_ttl_min) != "FREE":
                return f"VERIFY-DEFER {iid} 泳道忙，复验顺延"
            try:
                lk.acquire(f"qa-{iid}", CONFIG.lane_lock_ttl_min)
            except LockBusy:
                return f"VERIFY-DEFER {iid} 泳道忙，复验顺延"
        try:
            lc = CONFIG.lane(lane)
            if lane != "explore":
                _git(lc["path"], "checkout", f"feature/{iid}")
            res = run_gate(iid, f"qa-{int(time.time())}", lane, acct="agent-4")
            from .llm import extra_test_gen
            extra = extra_test_gen(yt.get(iid), yt.f(iid, "验收命令") or "")
            extra_ok = True
            note = "加测=生成失败跳过"
            if extra:
                try:
                    _cwd = str(Path(lc["path"]) / iid) if lane == "explore" else lc["path"]
                    p = subprocess.run(["bash", "-c", extra], cwd=_cwd,
                                       capture_output=True, text=True, timeout=300)
                    extra_ok = p.returncode == 0
                except subprocess.TimeoutExpired:
                    extra_ok = False
                note = f"加测={extra} → ok={extra_ok}"
        finally:
            if lane != "explore":
                lk.release(f"qa-{iid}")
        if res.ok and extra_ok:
            yt.transition(iid, "复验通过")
            yt.comment(iid, f"复验通过 证据={res['log'][:-4]}.json commit={res['commit']} {note}")
            _event(pid, iid, "QA_PASS", "agent-4", 0, note)
            return f"VERIFY-OK {iid} {note[:60]}"
        n = yt.attempt_inc(iid)
        _back_to_dispatch(yt, pid, iid, n, f"复验红 exit={res['exit']} {note}")
        _event(pid, iid, "QA_BACK", "agent-4", n, note)
        return f"VERIFY-FAIL {iid} attempt={n}"

    # ---- 复验通过：合并（L0/L1 自动；L2/L3 待批=合并审）----
    if st == "复验通过":
        if lv.startswith(("L0", "L1")):
            return _merge(yt, pid, iid, lane)
        # STUDIO-79：高等级单进终验收位附签字快照（低等级 snap 为空，评论正文不变）
        from . import signoff
        snap = signoff.snapshot_note(yt, iid, lane, org_level(yt, iid))
        yt.transition(iid, "待批")
        yt.comment(iid, "复验通过，进入合并审" + (f"｜{snap}" if snap else ""))     # 结构性槽位标记（同上，与批示词解耦）
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
                yt.comment(iid, "断路退审：回到第1批位（制作人可重批授权或 kill）")
            except ValueError:
                pass
        cs2 = [c["text"] for c in yt.comments(iid)][-3:]
        if not any("断路" in t for t in cs2):     # 幂等：不每 tick 刷屏
            yt.comment(iid, f"@{CONFIG.producer} attempt≥3 断路，等待批示")
        return f"BREAK {iid}"
    r = _dispatch(yt, pid, iid, lane, already=True)
    return r or f"REDISPATCH-DEFERRED {iid}"


def _dept_set(val) -> set[str]:
    """部门字段归一：缺省/单枚举(str)/多值枚举([{name:…}] 或 [str]) → 部门名集合。
    （部门为多值枚举——ORG-DESIGN 单据模型；YouTrack 单值回 str、多值回 list[dict]。）"""
    if not val:
        return set()
    out = set()
    for v in (val if isinstance(val, (list, tuple)) else [val]):
        name = ((v.get("name") or "") if isinstance(v, dict) else str(v)).strip()
        if name and name != "-":
            out.add(name)
    return out


def dept_lane(yt, iid, raw_lane: str, hint: bool = False) -> str:
    """_dispatch 前置部门解析：部门集合映射施工泳道。所有泳道派生点统一走这里
    （_handle/_recycle/lane_of/supervise 交付核对），保证同单派发→收割→复验→合并→
    放锁全程同一泳道。无部门字段/未知部门 → raw_lane 原样（验收①：行为与现状
    完全一致）。hint=True（仅派发路）跨部门单留联签提示评论。"""
    depts = _dept_set(yt.f(iid, "部门"))
    if not depts or raw_lane in CONFIG.producer_only_lanes.get(iid.split("-")[0], []):
        return raw_lane
    if len(depts) > 1 or "跨部门" in depts:          # 跨部门：联签提示，默认工程部
        if hint:
            _cosign_hint(yt, iid, depts)
        return "framework"
    return DEPT_LANES.get(next(iter(depts))) or raw_lane


def _cosign_hint(yt, iid, depts):
    """跨部门联签提示（ORG-DESIGN：上级派跨部门任务由涉及部门共同决定、联签共担）。
    幂等：锚点评论已存在则不重复，防 pm_tick 每 10 分钟一拍刷屏。"""
    if any(c["text"].startswith(COSIGN_MARK) for c in yt.comments(iid)):
        return
    yt.comment(iid, f"{COSIGN_MARK}：本单涉及 {'+'.join(sorted(depts))}，"
                    "需所涉部门主管联签共担；施工默认按工程部派发（framework 泳道）")


def _dispatch(yt, pid, iid, lane, already: bool = False) -> str | None:
    # 前置部门解析（P3-b）：部门字段驱动施工泳道。解析置于 NO-LANE 判定之前——
    # 部门可补位无泳道单；无部门字段时 lane 原样，后续判定序与现状完全一致。
    lane = dept_lane(yt, iid, lane, hint=True)
    if lane == "-" or not lane:
        return f"NO-LANE {iid}"
    if drain_requested():                       # 优雅重载：只停新派发，收割/复验照常
        return f"DRAINING {iid}（优雅重载中，暂缓派发）"
    lc = CONFIG.lane(lane)
    if int(yt.f(iid, "attempt") or 0) >= CONFIG.max_attempts:
        return f"BREAK {iid} attempt≥3 待制作人"
    if lane == "explore":
        # 探索并行通道（制作人 2026-09-28：调研/前沿收集/试验类不占交付工作目录，
        # 不受泳道互斥约束）：每单独立锁 + /tmp 独立工作区 + 免 git——发散任务可多开
        wd = Path(lc["path"]) / iid
        wd.mkdir(parents=True, exist_ok=True)
        lk = lock(CONFIG, f"explore-{iid}")
        try:
            if not already:
                yt.transition(iid, "已派发")
            Worker(iid).launch(yt.get(iid), lane)
            yt.heartbeat(iid)
            _event(pid, iid, "DISPATCH", "agent-8", 0, f"lane={lane} 并行通道")
            return f"DISPATCH {iid} lane=explore(并行)"
        except Exception:
            lk.release(f"worker-{iid}")
            raise
    lk = lock(CONFIG, f"lane-{lane}")
    if lk.check(CONFIG.lane_lock_ttl_min) != "FREE":
        return f"LANE-BUSY {lane}"
    if _git(lc["path"], "status", "--porcelain", check=False).stdout.strip():
        # 锁已 FREE（上面过检）→ 脏树 = worker 残留（完成只认提交，未提交即垃圾）。
        # 自愈：复位 base + 清未跟踪，评论留证后继续派发。GAMES server/ 残留曾卡道 15h。
        _git(lc["path"], "checkout", lc["base_branch"], check=False)
        _git(lc["path"], "reset", "--hard", lc["base_branch"], check=False)
        _git(lc["path"], "clean", "-fd", check=False)
        if _git(lc["path"], "status", "--porcelain", check=False).stdout.strip():
            return f"TREE-DIRTY {lane} 自愈失败，需人工"
        yt.comment(iid, f"泳道自愈：无活 worker（锁 FREE）下脏树残留，"
                        f"已 reset+clean 复位 {lc['base_branch']} 后派发")
    lk.acquire(f"worker-{iid}", CONFIG.lane_lock_ttl_min)
    try:
        if not already:
            # 先迁移后拉起：非交付族 Type（如 业务）在此即被拒，零副作用返回；
            # 旧序（先 launch 后 transition）曾造成 POLY-22/23 事故——worker 跑完交付、
            # 单滞留新单，每 tick 无限重派。迁移成功而 launch 失败则走已派发 UNKNOWN 自愈路。
            yt.transition(iid, "已派发")
        _git(lc["path"], "checkout", lc["base_branch"])
        # 重派复用已有分支（退回/断路后 feature/<单号> 已存在），首派才建新枝
        if _git(lc["path"], "rev-parse", "--verify", f"feature/{iid}",
                check=False).returncode == 0:
            _git(lc["path"], "checkout", f"feature/{iid}")
        else:
            _git(lc["path"], "checkout", "-b", f"feature/{iid}")
        Worker(iid).launch(yt.get(iid), lane)
        yt.heartbeat(iid)
        _event(pid, iid, "DISPATCH", "agent-8", 0, f"lane={lane}")
        return f"DISPATCH {iid} lane={lane}"
    except Exception:
        lk.release(f"worker-{iid}")
        raise


def lane_of(yt, iid) -> str:
    return dept_lane(yt, iid, yt.f(iid, "泳道") or "core")   # P3-b：合并路径同部门解析


def _harvest(yt, pid, iid, lane, w: Worker, lv) -> str:
    report = w.report.read_text() if w.report.exists() else "(REPORT 缺失)"
    rs = w.result_stats()          # stream 改名归档前取记账三元组（审计 P0-1 断点C）
    if lane == "explore":
        # 探索通道收割：无 git 概念——闸门跑在 /tmp 探索区（断言探索产物），产物即 REPORT
        try:
            res = run_gate(iid, str(int(yt.f(iid, "attempt") or 0) + 1), lane)
            if res.ok:
                yt.transition(iid, "证据就绪")
                yt.comment(iid, f"{report}\n\n— 代发 claude worker（studio-daemon 探索通道）")
                _event(pid, iid, "GATE_PASS", "agent-8", 0, f"evidence {res['log']}",
                       tokens=rs.get("tokens"), cost_usd=rs.get("cost_usd"),
                       duration_ms=rs.get("duration_ms"))
                return f"HARVEST {iid} →证据就绪(探索)"
            n = yt.attempt_inc(iid)
            yt.comment(iid, f"GATE-FAIL attempt={n} 退回重做，evidence {res['log']}")
            _event(pid, iid, "GATE_FAIL", "agent-8", n, res["log"])
            return f"GATE-FAIL {iid} attempt={n}"
        finally:
            w.archive()
    lc = CONFIG.lane(lane)
    acct = dict(tokens=rs.get("tokens"), cost_usd=rs.get("cost_usd"),
                duration_ms=rs.get("duration_ms"))
    try:
        _git(lc["path"], "checkout", f"feature/{iid}")
        if _git(lc["path"], "merge-base", "--is-ancestor", lc["base_branch"],
                f"feature/{iid}", check=False).returncode != 0:
            # base 期中前进（框架热修直入 master 等）≠ 飞线：先自动同步合并，冲突才是真飞线
            m = _git(lc["path"], "merge", lc["base_branch"], "--no-edit", check=False)
            if m.returncode == 0:
                yt.comment(iid, f"base 期中前进，已自动同步合并 {lc['base_branch']} → feature/{iid}（非飞线）")
            else:
                _git(lc["path"], "merge", "--abort", check=False)
                _recycle(yt, pid, iid, "飞线: base 非 feature 祖先且同步合并冲突")
                return f"ORPHAN {iid}"
        res = run_gate(iid, str(int(yt.f(iid, "attempt") or 0) + 1), lane)
        if res.ok:
            yt.transition(iid, "证据就绪")
            yt.comment(iid, f"{report}\n\n— 代发 claude worker（studio-daemon v2）")
            _event(pid, iid, "GATE_PASS", "agent-8", 0, f"evidence {res['log']}", **acct)
            return f"HARVEST {iid} →证据就绪"
        n = yt.attempt_inc(iid)
        flow = sm._flow(lv, yt.f(iid, "Type"))
        if n >= CONFIG.max_attempts:
            try:
                if flow and "待批" in flow:
                    yt.transition(iid, "待批")  # 有审批位的级别 → 断路进待批
                    yt.comment(iid, "断路退审：回到第1批位（制作人可重批授权或 kill）")
            except ValueError:
                pass                             # 迁移异常不吞掉断路评论
            yt.comment(iid, f"@{CONFIG.producer} attempt={n}≥3 断路，evidence {res['log']}")
            _event(pid, iid, "GATE_FAIL", "agent-8", n, "断路", **acct)
        else:
            yt.comment(iid, f"GATE-FAIL attempt={n} 退回重做，evidence {res['log']}")
            _event(pid, iid, "GATE_FAIL", "agent-8", n, res["log"], **acct)
        return f"GATE-FAIL {iid} attempt={n}"
    except Exception:
        # 收割异常（gate 拒跑/HTTP 抖动等）也计 attempt（审计 P1-6）：
        # 曾"异常冒泡→ARCHIVED 不罚→下拍立即重派"= 无断路的重派风暴，每 10 分钟白烧一轮 worker
        n = yt.attempt_inc(iid)
        yt.comment(iid, f"收割异常计 attempt={n}（断路保护生效，不再无罚重派）")
        _event(pid, iid, "GATE_FAIL", "agent-8", n, "harvest-exception")
        raise
    finally:
        w.archive()                              # REPORT 随之归档，防止旧卷反复收割
        _release_lane(pid, lane, f"worker-{iid}")


def _merge(yt, pid, iid, lane) -> str:
    if lane == "explore":
        # 探索通道"合并"=交付：产物是 REPORT/评论/Article，无 git 合并概念
        yt.transition(iid, "已交付")
        yt.comment(iid, "探索交付：REPORT 与证据已落盘（/tmp 探索区产物随生命周期自然过期，"
                        "沉淀物请入知识库/板面）")
        _event(pid, iid, "MERGE", "agent-8", 0, "explore-direct")
        return f"DELIVERED {iid} (探索直交付)"
    lc = CONFIG.lane(lane)
    lk = lock(CONFIG, f"lane-{lane}")
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
        try:
            _git(lc["path"], "merge", "--no-ff", f"feature/{iid}", "-m",
                 f"merge({iid}): {yt.get(iid)['summary']}")
        except RuntimeError as e:                # 冲突：隔离+退回重做，不留无限重试循环
            _git(lc["path"], "reset", "--hard", "HEAD", check=False)
            _git(lc["path"], "clean", "-fd", check=False)
            n = yt.attempt_inc(iid)
            yt.comment(iid, f"merge 冲突已隔离退回重做 attempt={n}: {str(e)[:120]}")
            _event(pid, iid, "GATE_FAIL", "agent-8", n, "merge-conflict")
            try:
                yt.transition(iid, "已派发")
            except ValueError:
                pass
            return f"MERGE-CONFLICT {iid} attempt={n}"
        res = run_gate(iid, f"verify-{int(time.time())}", lane)
        if res.ok:
            yt.transition(iid, "已交付")
            _event(pid, iid, "MERGE", "agent-8", 0, f"→{lc['base_branch']} verify绿")
            _event(pid, iid, "CLOSE", "agent-8", 0, "未push(无批示)")
            return f"DELIVERED {iid}"
        # verify 红：回滚 base 上的 merge commit，退回重做（P2-4）
        _git(lc["path"], "reset", "--hard", "ORIG_HEAD", check=False)
        n = yt.attempt_inc(iid)
        yt.comment(iid, f"merge-verify红回滚 exit={res['exit']} attempt={n}")
        _event(pid, iid, "GATE_FAIL", "agent-8", n, "merge-verify红")
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
    lane = dept_lane(yt, iid, yt.f(iid, "泳道") or "core")   # P3-b：隔离仓=部门解析后泳道
    lc = CONFIG.lane(lane)
    dirty = _git(lc["path"], "status", "--porcelain", check=False).stdout.strip()
    if dirty:
        _git(lc["path"], "stash", "push", "-u", "-m", f"quarantine-{iid}-{int(time.time())}")
        with open(CONFIG.logs_dir / "quarantine.log", "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%F %T')} {iid} {why}\n")
    n = yt.attempt_inc(iid)
    yt.comment(iid, f"兜底退回: {why} attempt={n}")
    _event(pid, iid, "GATE_FAIL", "agent-8", n, why)


def _back_to_dispatch(yt, pid, iid, n, why):
    """attempt 未断：复验通过/证据就绪 → 已派发（下轮重派）。"""
    try:
        yt.transition(iid, "已派发")
    except ValueError:
        yt.transition(iid, "待批")
    yt.comment(iid, f"退回重做: {why} attempt={n}")


def org_level(yt, iid) -> int | None:
    """单据等级：YouTrack 等级字段优先，双轨回退轨道映射。"""
    from .org import level_of
    try:
        return level_of(yt.f(iid, "轨道") or "", yt.f(iid, "等级"))
    except Exception:
        return None


def _final_position(yt, iid, lv, typ) -> bool:
    """终验收位判定（影子期近似）：L2/L3 流的第二待批位（合并审）即终验收；
    首待批为立项批。结构上以「批示已执行」计数近似（applied 值在调用处可得）。
    简化：合并审=终验收——L2 的第2待批/L3 的第3待批。"""
    applied = sum(1 for c in yt.comments(iid) if c["author"] == "agent-8"
                  and c["text"].startswith("批示已执行"))
    return applied >= 1                                     # 已过立项批 → 当前位=终验收


HOLD_WORDS = ("亲批", "hold")   # 制作人单据级叮嘱（2026-09-28）：评论首词命中即本单一律亲批


def _producer_hold(cs) -> bool:
    """制作人在本单留过「亲批/hold」叮嘱 → 一切代批失效（制作人本人照常有效）。"""
    return any(c["author"] == CONFIG.producer
               and (c["text"].strip().split() or [""])[0] in HOLD_WORDS for c in cs)


def _has(yt, iid, word, lane=None) -> bool:
    """授权批示人评论首 token 精确匹配（P2-6：子串匹配会误判"上次X批错了"）。"""
    for c in yt.comments(iid):
        if CONFIG.can_approve(iid.split("-")[0], c["author"], lane):
            toks = c["text"].strip().split()
            if toks and toks[0] == word:
                return True
    return False


DIRECTIVE_ALIASES = {
    "approve": "approve", "approve-plan": "approve-plan", "approve-merge": "approve-merge",
    "approve-design": "approve-design", "approve-push": "approve-push",
    "批准": "approve", "同意": "approve", "通过": "approve", "批": "approve",
    "批准合并": "approve-merge", "同意合并": "approve-merge", "通过合并": "approve-merge",
    "reject": "reject", "kill": "kill", "否决": "reject", "取消": "kill", "杀": "kill",
    "promote": "promote", "转正": "promote",
    "track": "track",
}


# 口语弱批准（P1-12）：单看首词歧义太大（"好，不过先别做"）——
# 仅当整句去标点后 ≤4 字（"好"/"可以的"/"ok 了"）才视作 approve
ORAL_APPROVES = {"可以", "可以的", "好", "好的", "行", "嗯", "没问题", "ok"}


def _oral_approve(text: str) -> bool:
    import re as _re
    bare = _re.sub(r"[，。！？,.!?;；\s]", "", text or "")
    return bool(bare) and len(bare) <= 4 and bare in ORAL_APPROVES


def _normalize_directive(word: str) -> str:
    """中英文批示词归一化——中文无空格分词，先按标点切首段再查表。"""
    import re as _re
    clean = _re.sub(r"[，,。.!！？?；;\s]+$", "", word.strip())
    # 中文标点切分取首段（"批准，仔细审核" → "批准"）
    first_seg = _re.split(r"[，,。.!！？?；;\s]", clean)[0].strip()
    for candidate in (first_seg, clean, clean.lower()):
        if candidate in DIRECTIVE_ALIASES:
            return DIRECTIVE_ALIASES[candidate]
    return word


def _directives(yt, iid, lv, typ, lane=None) -> str | None:
    """位置感知批示：第 k 个未消费的 approve 指令作用于流的第 k 个待批位。
    消费留痕（PM 评论"批示已执行"）保证幂等——同一评论不会二次执行。"""
    cs = yt.comments(iid)
    applied = sum(1 for c in cs if c["author"] == "agent-8"
                  and c["text"].startswith("批示已执行"))
    approvals: list[tuple[str, int]] = []   # (指令, 评论时间戳)——时间锚定配对见下
    hold = _producer_hold(cs)
    from . import approval as _ap
    from . import signoff as _so
    _shadow = _ap.engine_mode(iid.split("-")[0]) == "shadow"
    _dispa = yt.f(iid, "派单人") or CONFIG.producer      # 无派单人字段的存量单：终验保守归制作人
    _depts = _dept_set(yt.f(iid, "部门"))   # STUDIO-78 联签分支：跨部门单主管全签方放行
    _lv = _ap.org and org_level(yt, iid)
    _at_final = _final_position(yt, iid, lv, typ)
    for c in cs:
        if (hold and c["author"] != CONFIG.producer) \
                or not CONFIG.can_approve(iid.split("-")[0], c["author"], lane) or not c["text"].strip():
            if _shadow and c["text"].strip() and c["author"] != CONFIG.producer:
                _o_ok, _o_why = _ap.org_decide(iid.split("-")[0], iid, c["author"], lane,
                                               _lv, _dispa, cs, _at_final, depts=_depts)
                if _o_ok:
                    _event(iid.split("-")[0], iid, "SHADOW_DIFF", "shadow", 0,
                           f"legacy拒但org允（{_o_why}）author={c['author']}")
            continue
        if _shadow and c["author"] != CONFIG.producer:
            _o_ok, _o_why = _ap.org_decide(iid.split("-")[0], iid, c["author"], lane,
                                           _lv, _dispa, cs, _at_final, depts=_depts)
            if not _o_ok:
                _event(iid.split("-")[0], iid, "SHADOW_DIFF", "shadow", 0,
                       f"legacy允但org拒（{_o_why}）author={c['author']}")
        if c["text"].lstrip().startswith(("批示已执行", "制作人批示", "断路退审")):
            continue                    # PM 留痕评论禁当批示（代批后防自批准循环）
        if _so.is_sign_comment(c["text"]):
            continue                    # STUDIO-79 签字评论不当批示（防 LLM 岛把 sign-merge 猜成 approve-merge）
        w0 = c["text"].strip().split()[0]
        norm0 = _normalize_directive(w0)
        if c["author"] != CONFIG.producer:
            # 委托代批账号（agent-8）的评论绝大多数是系统留痕（WORKER REPORT 转发、
            # 复验通过证据、泳道自愈……正文常含 approve/批准字样）——降级中的 LLM 岛
            # 会把它们猜成批示挤占槽位计数（GAMES-9 实录）。故非制作人评论只认
            # 首词明确的批示，确定性解析、不进 LLM。
            if norm0.startswith("approve"):
                approvals.append(("approve" if norm0 == "approve" else norm0, c["created"]))
            elif _oral_approve(c["text"]):            # P1-12：口语批准须整句极短
                approvals.append(("approve", c["created"]))
            continue
        # 裸"批准/同意"的原始词元是批示人的明确意图——LLM 猜的 approve-plan/merge
        # 口味不得覆盖（GAMES-9 实录：裸批准被猜成 approve-plan，合并槽卫兵误拒死循环）
        if norm0 == "approve":
            approvals.append(("approve", c["created"]))
            continue
        if _oral_approve(c["text"]):            # P1-12：极短口语批准（≤4字）同义 approve
            approvals.append(("approve", c["created"]))
            continue
        from .llm import parse_directive
        parsed = parse_directive(c["text"], f"{iid} 级别={lv} 类型={typ} 当前态={yt.f(iid, 'State')}")
        if parsed and parsed.get("directive", "").startswith("approve"):
            approvals.append((parsed["directive"], c["created"]))
        elif norm0.startswith("approve"):
            approvals.append((norm0, c["created"]))
    last_mark = max((c["created"] for c in cs if c["author"] == "agent-8"
                    and c["text"].startswith("批示已执行")), default=0)
    # 亲批泳道收紧/单据级叮嘱会追溯滤掉曾被消费的代批，applied 虚高会把后来
    # 亲批的序位吞掉（POLY-26/27/29 实录：代批史+1、合格批示仅制作人 1 条 →
    # 1≤1 永判无新批示，合并审卡死五小时）。已消费批示必然早于其留痕——以
    # 「最近留痕之前的合格批示数」为 applied 上限；健康流两者相等，行为不变。
    applied = min(applied, sum(1 for _, ts in approvals if ts < last_mark))
    if len(approvals) <= applied:
        # 没有新批示；查非 approve 指令（reject/kill/track）
        for c in cs[-10:]:
            if (hold and c["author"] != CONFIG.producer) \
                    or not CONFIG.can_approve(iid.split("-")[0], c["author"], lane):
                continue
            w = c["text"].strip().split()
            d = _normalize_directive(w[0]) if w else ""
            if d in ("reject", "kill"):
                yt.transition(iid, "已取消")
                return f"{d.upper()} {iid}"
            if d == "track" and len(w) > 1:
                yt.set_field(iid, "轨道", w[1])
                return f"LEVEL {iid} → {w[1]}"
        return None
    d = approvals[applied][0]                  # 第 applied 个（0基）未消费指令
    slot = sm._flow(lv, typ)
    if not slot or "待批" not in slot:
        return None
    idxs = [i for i, st_ in enumerate(slot) if st_ == "待批"]
    # 槽位定位：看最新路标——断路退审=重消费同位；批示已执行=前进一位；无路标=第1位
    cur = 0
    cur = 0
    for c in cs:                               # cs 为时间序；后写的定位标记胜出
        t_ = c["text"].strip()
        if c["author"] != "agent-8":
            continue
        if t_.startswith("断路退审：回到第"):
            try:
                cur = max(0, int(re.search(r"第(\d+)批", t_).group(1)) - 1)
            except Exception:
                cur = 0
        elif t_.startswith("方案段就绪，进入方案审"):
            cur = min(1, len(idxs) - 1)        # 结构性槽位声明：方案审=第2个待批位
        elif t_.startswith("复验通过，进入合并审"):
            cur = len(idxs) - 1                 # 结构性槽位声明：合并审=末个待批位
        elif t_.startswith("批示已执行"):
            m_ = re.search(r"第(\d+)批", t_)
            if m_:                             # 批号=第N个批示；断路复位过的单与槽位
                cur = min(int(m_.group(1)), len(idxs) - 1)   # 错位，结构标记优先纠正
    cur = min(cur, len(idxs) - 1)
    # 制作人的批准=新授权：断路计数清零（否则 attempt≥3 与重派判定死循环振荡）
    if int(yt.f(iid, "attempt") or 0) >= CONFIG.max_attempts:
        yt.set_field(iid, "attempt", 0, "SimpleIssueCustomField")
        yt.comment(iid, f"制作人批示即新授权，attempt 已清零（原值≥{CONFIG.max_attempts}）")
    cur = idxs[cur]
    nxt = slot[cur + 1] if cur + 1 < len(slot) else "已交付"
    # 名实校验：合并批位只认 approve-merge/approve-design/裸 approve（防重复 approve-plan 误触合并）
    if nxt == "已交付" and slot.count("待批") > 1 and d == "approve-plan":
        yt.comment(iid, f"指令 {d} 与当前批位（合并批）不符，未消费；请用 approve-merge 或 kill")
        return f"DIRECTIVE-MISMATCH {iid} {d}"
    # STUDIO-79 全流程逐环签字：终验收位前置校验（宪章§12.2/§12.3）——
    # 高等级单七环签字不齐 → 合并批示不消费（无留痕、不 advance），板面幂等留缺环清单
    if nxt == "已交付":
        _ok, _missing, _note = _so.final_gate(yt, iid.split("-")[0], iid, lane,
                                              org_level(yt, iid))
        if not _ok:
            _so.pending_comment(yt, iid, _missing)
            return f"SIGNOFF-PENDING {iid} {_note}"
    note = f"{d} → {nxt} (第{applied + 1}批)"
    if nxt == "已交付":
        # 合并批：必须走真实 merge+verify（禁只翻状态）；失败如实留痕
        m = _merge(yt, iid.split("-")[0], iid, lane_of(yt, iid))
        if "LANE-BUSY" in m:
            # 泳道被活 worker 占用是暂态：批示保留不消费，下拍重试（原实现会白烧标记）
            return f"MERGE-DEFER {iid} 泳道忙，批示保留待下拍"
        if "DELIVERED" not in m:
            yt.comment(iid, f"批示已执行 {d}（合并未成：{m}，已回退重做；复验通过后需重新批准合并） (第{applied + 1}批)")
            _event(iid.split("-")[0], iid, "APPROVE", "opengames", 0, f"{d} 合并失败回退: {m}")
            return f"APPROVED-MERGE-FAILED {iid} {m}"
    else:
        yt.transition(iid, nxt)
    if lv.startswith("L3") and d == "approve-design":
        yt.comment(iid, "方案已批，重新派发实现段")
    yt.comment(iid, f"批示已执行 {d} → {nxt} (第{applied + 1}批)")
    _event(iid.split("-")[0], iid, "APPROVE", "opengames", 0, note)
    return f"APPROVED {iid} {note}"
