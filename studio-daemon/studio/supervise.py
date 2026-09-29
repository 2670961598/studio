"""supervise — 工作室健康巡检（只读）。产出异常清单 JSON 供监督员（ZCode cron）处置。

设计纪律：
- 只读——不改板面、不动 git、不杀进程；处置留给监督员按证据判断
- 全部确定性检查，不调 LLM（快、免费、可重复）
- 单项检查失败只记 check-error，不拖垮整体输出

检查项（历史事故驱动）：
1. daemon 存活（P0: launchd 环境类事故的发现面）
2. LLM 岛近期失败痕迹（P0: claude 不可达曾静默 10 小时——ask 失败现在会写日志）
3. 已派发单：worker 进程/直播流停滞/断路冻结
4. 待批单：疑似未消费的制作人批准（POLY-17 事故形态）
5. tick 日志同类动作 ≥3 次（飞线/GATE-FAIL 类系统性死循环）
"""
import json
import re
import subprocess
import time
from pathlib import Path

from .config import CONFIG

TODAY_LOG = CONFIG.logs_dir / f"daemon-{time.strftime('%F')}.log"
STREAM_STALL_MIN = 20          # RUNNING 但直播流无增长超过此分钟数 = 疑似停滞
TRANSIENT_STUCK_MIN = 120      # 证据就绪/复验通过 停留超过此分钟数 = 疑似卡住
LOOP_THRESHOLD = 3             # 同 (动作类型, 单号) 出现次数
_APPROVE_ALIASES = {"approve", "approve-plan", "approve-merge", "approve-design",
                    "批准", "同意", "通过", "批", "可以", "可以的", "好的", "好",
                    "行", "嗯", "没问题", "ok"}
_PM_MARKERS = ("批示已执行", "断路退审", "方案段就绪", "复验通过，进入合并审", "收割异常计")  # C5：v2 新槽位路标补齐


def _anomalies_daemon(out):
    try:
        r = subprocess.run(["curl", "-s", "--max-time", "5",
                            f"http://127.0.0.1:{CONFIG.web_port}/api/state"],
                           capture_output=True, text=True)
        if r.returncode != 0 or '"sched_alive":true' not in r.stdout.replace(" ", ""):
            out.append({"sev": "high", "issue": "-", "kind": "daemon-down",
                        "detail": f"api/state 异常 rc={r.returncode} {r.stdout[:120]}"})
    except Exception as e:
        out.append({"sev": "high", "issue": "-", "kind": "daemon-down", "detail": repr(e)})


def _anomalies_llm(out):
    """今天日志近 2h 的 [llm] ask FAILED 行——claude 不可达/超时类事故的显性痕迹。"""
    try:
        if not TODAY_LOG.exists():
            return
        cut = time.time() - 7200
        hits = []
        for line in TODAY_LOG.read_text(encoding="utf-8").splitlines():
            if "[llm] ask FAILED" not in line:
                continue
            m = re.match(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})", line)
            if m and time.mktime(time.strptime(m.group(1), "%Y-%m-%d %H:%M:%S")) >= cut:
                hits.append(line.split("] ", 1)[-1][:160])
        if hits:
            out.append({"sev": "high", "issue": "-", "kind": "llm-island-fail",
                        "detail": f"近2h {len(hits)} 次: {hits[-1]}"})
    except Exception as e:
        out.append({"sev": "low", "issue": "-", "kind": "check-error", "detail": f"llm: {e!r}"})


def _first_seg(text: str) -> str:
    return re.split(r"[，,。.!！？?；;\s]", text.strip(), maxsplit=1)[0].strip().lower()


def _anomalies_tickets(out):
    from .yt import YT
    from . import statemachine as sm
    from .workers import Worker
    yt = YT("agent-8")
    now_ms = time.time() * 1000
    for pid in CONFIG.projects:   # C4：曾漏 GAMES（09-22 上线后一直不在巡检范围）
        try:
            board = [r for r in yt.list(pid, "State:" + ",".join(sm.PM_ACTIONABLE))]
        except Exception as e:
            out.append({"sev": "mid", "issue": pid, "kind": "board-query-fail", "detail": repr(e)})
            continue
        for row in board:
            iid, st = row["id"], row["state"]
            try:
                if st == "已派发":
                    att = int(yt.f(iid, "attempt") or 0)
                    if att >= CONFIG.max_attempts:
                        out.append({"sev": "mid", "issue": iid, "kind": "breaker-frozen",
                                    "detail": f"attempt={att}≥{CONFIG.max_attempts} 断路，待制作人重批或 kill"})
                        continue
                    s = Worker(iid).status()
                    reg = CONFIG.workers_dir / f"{iid}.json"
                    stream = CONFIG.workers_dir / f"{iid}.stream.jsonl"
                    if s.startswith("RUNNING") and stream.exists():
                        age_min = (time.time() - stream.stat().st_mtime) / 60
                        if age_min > STREAM_STALL_MIN:
                            out.append({"sev": "high", "issue": iid, "kind": "worker-stalled",
                                        "detail": f"worker 自称 RUNNING 但直播流 {int(age_min)}min 无增长"})
                    elif s.startswith(("DEAD", "UNKNOWN")) and reg.exists():
                        out.append({"sev": "low", "issue": iid, "kind": "worker-gone",
                                    "detail": f"{s}，等下轮 tick 兜底回收/重派"})
                elif st == "待批":
                    cs = yt.comments(iid)
                    last_marker = -1
                    for i, c in enumerate(cs):
                        if c["author"] == "agent-8" and c["text"].startswith(_PM_MARKERS):
                            last_marker = i
                    _lane = None
                    try:
                        _lane = yt.f(iid, "泳道")
                    except Exception:
                        pass
                    unconsumed = [c for c in cs[last_marker + 1:]
                                  if CONFIG.can_approve(iid.split("-")[0], c["author"], _lane)
                                  and _first_seg(c["text"]) in _APPROVE_ALIASES]
                    if unconsumed:
                        u = unconsumed[-1]
                        out.append({"sev": "high", "issue": iid, "kind": "approval-unconsumed",
                                    "detail": f"疑似批准未被消费: 「{u['text'][:60]}」——LLM岛/解析链可能故障"})
                elif st in ("证据就绪", "复验通过"):
                    last = cs_last_ms = max((c["created"] or 0) for c in yt.comments(iid)) \
                        if yt.comments(iid) else 0
                    if last and (now_ms - last) / 60000 > TRANSIENT_STUCK_MIN:
                        out.append({"sev": "mid", "issue": iid, "kind": "transient-stuck",
                                    "detail": f"{st} 停留超过 {TRANSIENT_STUCK_MIN}min（正常应 ~10-20min 推进）"})
            except Exception as e:
                out.append({"sev": "low", "issue": iid, "kind": "check-error", "detail": repr(e)})


def _anomalies_loops(out):
    """近 3h tick 日志中同 (动作, 单号) ≥LOOP_THRESHOLD 次 = 系统性循环。"""
    try:
        if not TODAY_LOG.exists():
            return
        cut = time.strftime("%F %T", time.localtime(time.time() - 10800))
        counts = {}
        for line in TODAY_LOG.read_text(encoding="utf-8").splitlines():
            if "TICK" not in line or line[:19] < cut:
                continue
            for a in re.findall(r'"((?:ORPHAN|GATE-FAIL|ERROR|APPROVED-MERGE-FAILED|LANE-BUSY|TREE-DIRTY)[^"]*)"', line):
                key = (a.split()[0], next((w for w in a.split() if re.match(r"^[A-Za-z]+-\d+$", w)), "-"))
                counts[key] = counts.get(key, 0) + 1
        for (kind, iid), n in sorted(counts.items()):
            if n >= LOOP_THRESHOLD:
                out.append({"sev": "high", "issue": iid, "kind": "action-loop",
                            "detail": f"近3h {kind} ×{n}——系统性故障形态（对照飞线/GATE-FAIL 历史事故）"})
    except Exception as e:
        out.append({"sev": "low", "issue": "-", "kind": "check-error", "detail": f"loops: {e!r}"})


def _anomalies_conformance(out):
    """框架符合性：不只查故障，还查行为是否符合设计预期。
    - 自评草稿重复（同模式 >1 张 = 查重失效/自评刷屏）
    - gate 审计：在途单验收命令为空 / 恒假形态 / 过不了消毒白名单
    - 交付完整性：已交付单必须能在泳道仓找到 merge(iid) 提交
    - 批注注入：RUNNING worker 的任务书必须含制作人批注节"""
    from .yt import YT
    from . import statemachine as sm
    from .metrics import _finding_key
    from .llm import _sanitize_cmd
    yt = YT("agent-8")
    BAD_GATES = {"test -f /dev/null"}            # 历史事故形态：字符设备上 -f 恒假
    for pid in CONFIG.projects:   # C4：曾漏 GAMES（09-22 上线后一直不在巡检范围）
        try:
            board = yt.list(pid, "State:" + ",".join(sm.PM_ACTIONABLE))
        except Exception as e:
            out.append({"sev": "mid", "issue": pid, "kind": "board-query-fail", "detail": repr(e)})
            continue
        # 自评草稿查重
        keys = {}
        for r in board:
            if r["state"] == "草稿" and r["type"] == "提案" and r["summary"].startswith("[自评]"):
                keys.setdefault(_finding_key(r["summary"]), []).append(r["id"])
        for k, iids in keys.items():
            if len(iids) > 1:
                out.append({"sev": "mid", "issue": ",".join(iids), "kind": "duplicate-drafts",
                            "detail": f"自评同模式草稿 ×{len(iids)}（{k}…）——需去重"})
        for row in board:
            iid, st = row["id"], row["state"]
            try:
                if st in ("新单", "待批", "已派发"):
                    gate = (yt.f(iid, "验收命令") or "").strip()
                    if not gate:
                        out.append({"sev": "high", "issue": iid, "kind": "gate-missing",
                                    "detail": "在途单无冻结验收命令（DoD 生成链可能故障）"})
                    elif gate in BAD_GATES or _sanitize_cmd(gate) is None:
                        out.append({"sev": "high", "issue": iid, "kind": "gate-invalid",
                                    "detail": f"验收命令不可用/恒假形态: {gate[:60]}"})
                if st == "已派发":
                    from .workers import Worker
                    if Worker(iid).status().startswith("RUNNING"):
                        prompt = CONFIG.workers_dir / f"{iid}.prompt.md"
                        if prompt.exists() and "## 制作人批注" not in prompt.read_text(encoding="utf-8"):
                            out.append({"sev": "high", "issue": iid, "kind": "producer-notes-missing",
                                        "detail": "任务书缺制作人批注节（注入链回归）"})
            except Exception as e:
                out.append({"sev": "low", "issue": iid, "kind": "check-error", "detail": repr(e)})
        # 交付完整性：已交付单必有真实 merge 提交
        try:
            for r in yt.list(pid, "State:已交付"):
                iid, lane = r["id"], yt.f(r["id"], "泳道") or "core"
                try:
                    lc = CONFIG.lane(lane)
                except Exception:
                    continue
                g = subprocess.run(["git", "-C", lc["path"], "log", "--oneline",
                                    f"--grep=merge({iid})", lc["base_branch"]],
                                   capture_output=True, text=True, timeout=30)
                if g.returncode == 0 and f"merge({iid})" not in g.stdout:
                    out.append({"sev": "mid", "issue": iid, "kind": "merge-missing",
                                "detail": f"已交付但 {lc['base_branch']} 上无 merge({iid}) 提交"})
        except Exception as e:
            out.append({"sev": "low", "issue": pid, "kind": "check-error", "detail": f"delivered: {e!r}"})


def run() -> dict:
    out = []
    for fn in (_anomalies_daemon, _anomalies_llm, _anomalies_tickets, _anomalies_loops,
               _anomalies_conformance):
        try:
            fn(out)
        except Exception as e:
            out.append({"sev": "low", "issue": "-", "kind": "check-error", "detail": repr(e)})
    return {"ok": not any(a["sev"] == "high" for a in out), "anomalies": out}


if __name__ == "__main__":
    print(json.dumps(run(), ensure_ascii=False, indent=1))
