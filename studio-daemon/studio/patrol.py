"""patrol — 战役巡逻引擎（Type=战役 · 研究中 的永驻母亲单）
每轮：到点检查 → （可选）跑基准命令存快照 → LLM 岛带 WebFetch 巡逻源清单/对比快照
→ 战役单贴进展 → 值得做的孵化成子单（正常轨道，制作人审批）。
spec 文件 kernel/campaigns/<单号>.yaml 是战役的大脑，制作人随时可改。"""
import json, subprocess, time, yaml
from pathlib import Path
from .config import CONFIG

CAMP = CONFIG._root.parent / "kernel" / "campaigns"
CAMP.mkdir(parents=True, exist_ok=True)

DEFAULT_SPEC = """\
theme: {theme}
every_h: 24            # 巡逻间隔（小时）
sources: []            # 巡逻源清单（URL，LLM 会用 WebFetch 逐个抓取）
baseline_cmd: ""       # 可选：基准命令（跑分/统计），输出追加进快照序列
repo: ""               # baseline_cmd 的执行目录
child_type: 业务       # 孵化子单的 Type
child_track: "B 常规"  # 孵化子单的轨道
patrol_brief: ""       # 巡逻任务书补充（对比什么、什么值得开单）
"""


def _yt():
    from .yt import YT
    return YT("agent-pm")


def _spec(iid: str) -> dict:
    f = CAMP / f"{iid}.yaml"
    if not f.exists():
        return yaml.safe_load(DEFAULT_SPEC.format(theme=iid))
    return yaml.safe_load(f.read_text(encoding="utf-8")) or {}


def _state(iid: str) -> dict:
    f = CAMP / f"{iid}.state.json"
    return json.loads(f.read_text()) if f.exists() else {"last": 0, "count": 0}


def _save_state(iid, st):
    (CAMP / f"{iid}.state.json").write_text(json.dumps(st, ensure_ascii=False))


def _snap_path(iid) -> Path:
    return CAMP / f"{iid}.snapshots.jsonl"


def _due(iid, spec) -> bool:
    st = _state(iid)
    return (time.time() - st.get("last", 0)) >= float(spec.get("every_h") or 24) * 3600


def _log(line):
    with open(CONFIG.logs_dir / f"daemon-{time.strftime('%F')}.log", "a",
              encoding="utf-8") as f:
        f.write(f"{time.strftime('%F %T')} [patrol] {line}\n")


def patrol_tick() -> dict:
    from .locks import lock, LockBusy
    from . import statemachine as sm
    try:
        lock(CONFIG, "patrol").acquire(f"patrol-{int(time.time())}", 120)
    except LockBusy:
        return {"result": "LOCK-HELD", "actions": []}
    yt = _yt()
    out = {"result": "IDLE", "actions": []}
    try:
        camps = []
        for pid in CONFIG.projects:
            camps += [c for c in yt.list(pid, "Type:战役 状态:新单,研究中")]
        if not camps:
            return out
        out["result"] = "OK"
        for row in camps:
            try:
                out["actions"].append(_patrol_one(yt, row))
            except Exception as e:
                _log(f"ERROR {row['id']} {e}")
                out["actions"].append(f"ERROR {row['id']} {e}")
        return out
    finally:
        lock(CONFIG, "patrol").release()
        _log("TICK " + json.dumps(out, ensure_ascii=False))


def _patrol_one(yt, row) -> str:
    iid = row["id"]
    if row["state"] == "新单":  # 激活：进研究中（战役专用边）
        yt.transition(iid, "研究中")
        yt.comment(iid, "战役激活，巡逻引擎接管。spec 见 kernel/campaigns/ 对应文件。")
        return f"ACTIVATED {iid}"
    if not _due(iid, _spec(iid)):
        return f"SKIP {iid} 未到点"
    spec = _spec(iid)
    snap_text = ""
    if spec.get("baseline_cmd"):
        p = subprocess.run(["bash", "-c", spec["baseline_cmd"]],
                           cwd=spec.get("repo") or None,
                           capture_output=True, text=True, timeout=900)
        rec = {"ts": time.strftime("%F %T"), "exit": p.returncode,
               "out": (p.stdout + p.stderr)[-2000:]}
        with open(_snap_path(iid), "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        snaps = _snap_path(iid).read_text(encoding="utf-8").splitlines()[-3:]
        snap_text = "\n".join(snaps)
    from .llm import ask
    res = ask(
        f"你是虚拟工作室的战役巡逻员，负责永驻战役「{spec.get('theme', iid)}」。\n"
        f"任务书：{spec.get('patrol_brief', '')}\n"
        f"巡逻源（用 WebFetch 逐个抓取，失败就跳过）：{json.dumps(spec.get('sources', []), ensure_ascii=False)}\n"
        f"最近基准快照：\n{snap_text or '（无基准）'}\n\n"
        "产出（只输出 JSON）：{\"progress\":\"≤120字进展\",\"findings\":[\"≤80字发现\"...],"
        "\"children\":[{\"summary\":\"子单标题\",\"description\":\"需求描述\","
        "\"gate_cmd\":\"一条 bash 冻结验收命令\"}]}（children 最多2条，没有确凿可做的就空数组）",
        600)
    try:
        data = json.loads(res[res.index("{"):res.rindex("}") + 1])
    except Exception:
        data = {"progress": f"巡逻解析失败：{(res or '')[:100]}", "findings": [], "children": []}
    note = [f"巡逻 #{_state(iid)['count'] + 1} {time.strftime('%F %T')}",
            f"进展：{data.get('progress', '')}"]
    note += [f"发现：{f}" for f in data.get("findings", [])]
    kids = []
    for ch in (data.get("children") or [])[:2]:
        if not (ch.get("summary") and ch.get("gate_cmd")):
            continue
        kid = yt.new(iid.split("-")[0], f"[{iid}] {ch['summary'][:60]}", ch.get("description", ""),
                     lane=row["lane"], typ=spec.get("child_type", "业务"),
                     track=spec.get("child_track", "B 常规"))
        yt.gate_freeze(kid, ch["gate_cmd"])
        yt.comment(kid, f"来源：战役 {iid} 巡逻孵化")
        kids.append(kid)
        note.append(f"孵化子单：{kid}")
    yt.comment(iid, "\n".join(note))
    from .metrics import append_event
    append_event(iid.split("-")[0], iid, "PATROL", "patrol", 0,
                 f"{len(kids)} 子单；{data.get('progress', '')[:60]}")
    st = _state(iid); st.update(last=time.time(), count=st["count"] + 1)
    _save_state(iid, st)
    return f"PATROL {iid} +{len(kids)}kids"
