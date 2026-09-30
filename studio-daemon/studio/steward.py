"""steward — 框架管家岗哨（STUDIO-83，宰相派单 2026-09-30）
每 30 分钟扫 framework/explore 泳道的在途派发单，收割后（证据就绪/复验通过/合并审待批）
自动校验证据文件存在性+复验结论：
- 合格且已到终验位 → 评论 @宰相(ZCode) 终验提醒（宰相只需看板批终验，不再逐拍跟踪）
- 不合格 → 评论退回要点
纪律：
- 只评论不动状态（状态推进归 pm_tick/org 引擎）；确定性检查零 LLM（同 supervise）
- 幂等锚点=证据文件 tag（同证据只提醒/退回一次；新收割=新证据=新tag，自动复检）
- 派单人终验收铁律不碰：管家只做证据预检+提醒，不代批不代关"""
import hashlib, json, re, time
from pathlib import Path
from .config import CONFIG
from .locks import lock, LockBusy
from .yt import YT

# 辖区：框架管家只看施工泳道 framework/explore（org.yaml 工程部；core/game/games 归各自泳道流程）
STEWARD_LANES = ("framework", "explore")
# 收割后三态：证据就绪（收割过闸）/ 复验通过（QA 复验绿）/ 待批（须为合并审——立项批无证据可查）
SCAN_STATES = ("证据就绪", "复验通过", "待批")
MERGE_MARK = "复验通过，进入合并审"     # pm_tick 结构性槽位路标（orchestrator._handle 同源字符串）
QA_PASS_MARK = "复验通过 证据="         # QA 复验留痕评论锚（证据路径随其后）
CHANCELLOR = "宰相(ZCode)"             # org.yaml STUDIO.leader（终验提醒收件人）
SIGN = "框架管家"                       # 署名协议个体名（org.yaml：[项目·个体名·部门] 正文）


def _log(line):
    with open(CONFIG.logs_dir / f"daemon-{time.strftime('%F')}.log", "a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%F %T')} [steward] {line}\n")


def _event(pid, iid, event, note=""):
    from .metrics import append_event
    append_event(pid, iid, event, "agent-8", 0, note)


def _ev_files(iid: str) -> list[Path]:
    """单名下全部证据 JSON（kernel/evidence/<pid>/<iid>-*.json），新→旧。"""
    d = CONFIG.evidence_dir / iid.split("-")[0]
    return sorted(d.glob(f"{iid}-*.json"), key=lambda p: p.stat().st_mtime, reverse=True)


def _ev_tag(ev: dict | None) -> str:
    """幂等锚点：证据文件名去后缀（如 STUDIO-83-qa-1234）；无证据=「无证据」。"""
    return Path(ev["log"]).stem if ev else "无证据"


def verify_evidence(iid: str, frozen_cmd: str) -> tuple[bool, list[str], dict | None]:
    """收割证据三查（纯盘上事实，不碰 YouTrack，零 LLM）：
    1) 存在性：证据 JSON + 同名 .log 在盘（宪章 §0.2 空证据=无证据）
    2) 完整性：log_sha256_16 与日志实文重算一致（证据落盘后被动过即红）
    3) 结论复验：记录 exit==0（结论绿）且 cmd 与单据冻结验收命令一致（无漂移——
       证据必须是按现行冻结命令跑出来的）
    返回 (ok, 退回要点, 最新证据 dict)；无证据文件 → (False, [缺失], None)。"""
    files = _ev_files(iid)
    if not files:
        return False, [f"证据文件缺失：{CONFIG.evidence_dir / iid.split('-')[0]}/ 下无 {iid}-*.json"], None
    try:
        ev = json.loads(files[0].read_text(encoding="utf-8"))
    except Exception as e:
        return False, [f"证据 JSON 不可读（{files[0].name}: {type(e).__name__}）"], None
    points = []
    log = Path(ev.get("log") or "")
    if not log.exists():
        points.append(f"证据日志缺失：{log}")
    else:
        sha = hashlib.sha256(log.read_bytes()).hexdigest()[:16]
        if sha != ev.get("log_sha256_16"):
            points.append(f"证据日志哈希不一致（记录 {ev.get('log_sha256_16')} ≠ 实算 {sha}）——证据可能被改动")
    if ev.get("exit") != 0:
        points.append(f"证据结论为红（exit={ev.get('exit')}）")
    if (frozen_cmd or "").strip() and (ev.get("cmd") or "").strip() != frozen_cmd.strip():
        old = (ev.get("cmd") or "")[:40]
        points.append(f"验收命令漂移：证据按旧命令跑（{old!r} ≠ 现冻结 {frozen_cmd[:40]!r}）")
    return (not points), points, ev


def _qa_conclusion(yt, iid) -> list[str]:
    """复验结论核对（仅终验位调用）：QA「复验通过 证据=<路径>.json」评论在卷，
    且其声称的证据文件真实在盘——结论必须有实据背书。"""
    cs = [c["text"] for c in yt.comments(iid)
          if c["author"] == "agent-8" and c["text"].startswith(QA_PASS_MARK)]
    if not cs:
        return ["QA 复验结论缺失（无「复验通过 证据=」留痕评论）"]
    m = re.search(r"证据=(\S+?\.json)", cs[-1])       # 评论格式：证据=<log路径去.log>.json
    if not m or not Path(m.group(1)).exists():
        return [f"QA 复验证据不在盘：{m.group(1) if m else cs[-1][:60]}"]
    return []


def _already(yt, iid, tag: str) -> bool:
    """幂等：同 tag 的管家评论已存在（提醒/退回共用锚——同证据只说一次）。"""
    return any(SIGN in c["text"][:40] and f"管家校验 {tag}" in c["text"]
               for c in yt.comments(iid))


def _remind(pid, iid, ev) -> str:
    tag = _ev_tag(ev)
    return "\n".join([
        f"[{pid}·{SIGN}·工程部] @{CHANCELLOR} 终验提醒：{iid} 收割校验合格，请看板终验",
        f"- 证据：{_ev_files(iid)[0].relative_to(CONFIG.evidence_dir)}"
        f"（exit={ev.get('exit')} commit={ev.get('commit', '-')} branch={ev.get('branch', '-')}）",
        "- 复验：日志在盘且哈希一致｜结论 exit=0｜验收命令与冻结值一致｜QA 复验留痕在卷",
        f"- 管家校验 {tag}（同证据只提醒一次；退回重做后新证据自动复检）",
    ])


def _back(pid, iid, points, tag: str) -> str:
    lines = [f"[{pid}·{SIGN}·工程部] 管家退回要点：{iid} 收割校验不合格"]
    lines += [f"- {p}" for p in points]
    lines.append(f"- 管家校验 {tag}（证据修复重新收割后自动复检）")
    return "\n".join(lines)


def _check_one(yt, pid, row) -> str | None:
    from .orchestrator import dept_lane, SPECIAL, _level
    iid, st = row["id"], row["state"]
    if row["type"] in SPECIAL:
        return None                                    # 治理/情报各族自有引擎，管家不碰
    lane = dept_lane(yt, iid, row["lane"])
    if lane not in STEWARD_LANES:
        return None
    merge_review = st == "待批" and any(
        c["text"].startswith(MERGE_MARK) for c in yt.comments(iid))
    if st not in ("证据就绪", "复验通过") and not merge_review:
        return None                                    # 已派发归 pm_tick；立项批/方案审无收割证据
    ok, points, ev = verify_evidence(iid, yt.f(iid, "验收命令") or "")
    tag = _ev_tag(ev)
    if st == "复验通过" or merge_review:
        points += _qa_conclusion(yt, iid)              # 终验位加核复验结论（QA 留痕+实据）
        ok = not points
    if _already(yt, iid, tag):
        return None                                    # 同证据已提醒/退回过：不刷屏
    if not ok:
        yt.comment(iid, _back(pid, iid, points, tag))
        _event(pid, iid, "STEWARD_BACK", "; ".join(points)[:120])
        return f"STEWARD-BACK {iid} {'；'.join(points)[:80]}"
    if (st == "复验通过" or merge_review) and not _level(row).startswith(("L0", "L1")):
        yt.comment(iid, _remind(pid, iid, ev))         # L0/L1 自动合并无终验位，不打扰宰相
        _event(pid, iid, "STEWARD_REMIND", f"{CHANCELLOR} 终验提醒 tag={tag}")
        return f"STEWARD-REMIND {iid}"
    return None                                        # 证据就绪且合格：等 QA 复验，静默


def steward_tick() -> dict:
    """岗哨主拍（daemon cron 每 30 分钟；错峰 9/39 分位避开 pm/patrol/evolve）。"""
    lk = lock(CONFIG, "steward")
    _owner = f"steward-{int(time.time())}"
    try:
        lk.acquire(_owner, 60)
    except LockBusy:
        return {"result": "LOCK-HELD", "actions": []}
    yt = YT("agent-8")
    out = {"result": "IDLE", "actions": []}
    try:
        for pid in CONFIG.projects:
            try:
                board = yt.list(pid, "状态:" + ",".join(SCAN_STATES))
            except Exception as e:
                _log(f"ERROR board {pid} {e}")
                out["actions"].append(f"ERROR board {pid} {e}")
                continue
            for row in board:
                try:
                    a = _check_one(yt, pid, row)
                    if a:
                        out["actions"].append(a)
                except Exception as e:
                    _log(f"ERROR {row['id']} {e}")
                    out["actions"].append(f"ERROR {row['id']} {e}")
        if out["actions"]:
            out["result"] = "ERROR" if all(a.startswith("ERROR") for a in out["actions"]) else "OK"
        return out
    finally:
        lk.release(_owner)
        _log("TICK " + json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    print(json.dumps(steward_tick(), ensure_ascii=False, indent=1))
