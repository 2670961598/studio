"""patrol — 战役巡逻引擎（Type=战役 · 运行中 的永驻母亲单）
每轮：到点检查 → （可选）跑基准命令存快照 → LLM 岛带 WebFetch 巡逻源清单/对比快照
→ 战役单贴进展 → 值得做的孵化成子单（正常轨道，制作人审批）。
spec 文件 kernel/campaigns/<单号>.yaml 是战役的大脑，制作人随时可改。"""
import json, subprocess, time, yaml
from pathlib import Path
from .config import CONFIG

def _camp_dir() -> Path:
    """战役 spec/state 落盘目录。调用时解析（不模块级缓存）：
    测试的 tmp_config 换 _root 后这里必须跟着走——模块级常量曾让测试
    读写到生产 kernel/campaigns（POLY-101.state.json 污染实录）。"""
    d = CONFIG._root.parent / "kernel" / "campaigns"
    d.mkdir(parents=True, exist_ok=True)
    return d

DEFAULT_SPEC = """\
theme: {theme}
every_h: 24            # 巡逻间隔（小时）
sources: []            # 巡逻源清单（URL，LLM 会用 WebFetch 逐个抓取）
baseline_cmd: ""       # 可选：基准命令（跑分/统计），输出追加进快照序列
repo: ""               # 巡逻岛工作目录 + baseline_cmd 执行目录；空=回退泳道映射的仓库路径
child_type: 需求       # 孵化子单的 Type（v2）
child_track: "L2 常规"  # 孵化子单的级别（L0/L1 会被强制升 L2）
patrol_brief: ""       # 巡逻任务书补充（对比什么、什么值得开单）
"""


def _repo(spec: dict, lane: str) -> str:
    """战役仓库解析：spec.repo 优先；空则回退泳道 lane 的 path。
    POLY-14 #5：仓库不进岛上下文时，岛在 daemon cwd 里瞎摸，
    把 studio-daemon（Python）误判成战役仓库——巡逻全废。"""
    r = str(spec.get("repo") or "").strip()
    if r:
        return r
    if lane and lane != "-":
        lc = CONFIG.lanes.get(lane)
        if lc:
            return lc.get("path") or ""
    return ""


def _yt():
    from .yt import YT
    return YT("agent-8")


def _spec(iid: str) -> dict:
    f = _camp_dir() / f"{iid}.yaml"
    if not f.exists():
        return yaml.safe_load(DEFAULT_SPEC.format(theme=iid))
    return yaml.safe_load(f.read_text(encoding="utf-8")) or {}


def _state(iid: str) -> dict:
    f = _camp_dir() / f"{iid}.state.json"
    return json.loads(f.read_text()) if f.exists() else {"last": 0, "count": 0}


def _save_state(iid, st):
    tmp = _camp_dir() / f"{iid}.state.json.tmp"
    tmp.write_text(json.dumps(st, ensure_ascii=False))
    import os as _os
    _os.replace(tmp, _camp_dir() / f"{iid}.state.json")   # 原子写（P2-15）


def _snap_path(iid) -> Path:
    return _camp_dir() / f"{iid}.snapshots.jsonl"


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
    lk = lock(CONFIG, "patrol")
    _owner = f"patrol-{int(time.time())}"
    try:
        lk.acquire(_owner, 120)
    except LockBusy:
        return {"result": "LOCK-HELD", "actions": []}
    yt = _yt()
    out = {"result": "IDLE", "actions": []}
    try:
        camps = []
        for pid in CONFIG.projects:
            camps += [c for c in yt.list(pid, "Type:战役 状态:新单,运行中")]
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
        lk.release(_owner)
        _log("TICK " + json.dumps(out, ensure_ascii=False))


def _patrol_one(yt, row) -> str:
    iid = row["id"]
    if row["state"] == "新单":  # 激活：进运行中（战役专属边）
        yt.transition(iid, "运行中")
        yt.comment(iid, "战役激活，巡逻引擎接管。spec 见 kernel/campaigns/ 对应文件。")
        return f"ACTIVATED {iid}"
    if not _due(iid, _spec(iid)):
        return f"SKIP {iid} 未到点"
    spec = _spec(iid)
    repo = _repo(spec, row.get("lane") or "-")
    if not repo and not spec.get("sources"):
        # 空壳战役（GAMES-32~39 实录）：无仓库无巡逻源，岛只会回"未配置"，
        # every_h=24 意味着每天白烧 FULL 调用。短路留言，正常推进窗口，等 spec 补齐。
        yt.comment(iid, f"战役未配置（repo 与 sources 均为空）：本轮跳过，不消耗巡逻岛。"
                        f"请补 kernel/campaigns/{iid}.yaml（theme/every_h/repo/sources/patrol_brief）。")
        st = _state(iid); st.update(last=time.time(), count=st["count"] + 1)
        _save_state(iid, st)
        return f"PATROL-NOSPEC {iid}"
    snap_text = ""
    if spec.get("baseline_cmd"):
        p = subprocess.run(["bash", "-c", spec["baseline_cmd"]],
                           cwd=repo or None,
                           capture_output=True, text=True, timeout=900)
        rec = {"ts": time.strftime("%F %T"), "exit": p.returncode,
               "out": (p.stdout + p.stderr)[-2000:]}
        with open(_snap_path(iid), "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        snaps = _snap_path(iid).read_text(encoding="utf-8").splitlines()[-3:]
        snap_text = "\n".join(snaps)
    from .llm import ask, _sanitize_cmd
    from .yt import DeriveRefused
    res = ask(allow_web=True, cwd=repo or None, prompt=
        f"你是虚拟工作室的战役巡逻员，负责永驻战役「{spec.get('theme', iid)}」。\n"
        f"战役仓库（本地，已是你的工作目录）：{repo or '（未配置——不要凭空猜测仓库位置，只报告无法定位）'}。\n"
        f"用 Read/Glob/Grep 工具在该仓库内核实事实，禁止凭想象描述仓库内容。\n"
        f"任务书：{spec.get('patrol_brief', '')}\n"
        f"巡逻源（用 WebFetch 逐个抓取，失败就跳过）：{json.dumps(spec.get('sources', []), ensure_ascii=False)}\n"
        f"最近基准快照：\n{snap_text or '（无基准）'}\n\n"
        "产出（只输出 JSON）：{\"progress\":\"≤120字进展\",\"findings\":[\"≤80字发现\"...],"
        "\"children\":[{\"summary\":\"子单标题\",\"description\":\"需求描述\","
        "\"gate_cmd\":\"一条 bash 冻结验收命令\"}]}（children 最多2条，没有确凿可做的就空数组）。"
        "gate_cmd 纪律：只允许 test/grep/wc/cat/ls/diff/dotnet/python 与 git 只读子命令的 && 链"
        "（≤2段；禁管道、重定向、$()、反引号、分号），否则会被消毒器拒掉——"
        "基准阈值类断言写成 grep -c 计数或 dotnet test --filter 形式。",
        timeout_sec=600)
    if res is None:
        # 岛整体失败（600s 超时/非零退出）≠ 解析失败——POLY-19/20 教训：
        # None 折叠成空串后 rindex("}") 必抛 ValueError，被误标"解析失败"，
        # 且解析失败也推进 state → every_h=168 的战役一次超时烧掉整周窗口。
        # 独立分支：ERROR 日志（进日报异常段）+ 短退避 2h 重试，不推进巡逻计数。
        every_s = float(spec.get("every_h") or 24) * 3600
        backoff = 7200 if every_s > 7200 else every_s
        _log(f"ERROR {iid} 巡逻岛无响应（超时/失败），退避 {backoff // 60} 分钟后重试")
        yt.comment(iid, f"巡逻 #{_state(iid)['count'] + 1} {time.strftime('%F %T')}\n"
                        f"巡逻岛无响应（LLM 超时或失败），本轮作废，"
                        f"{backoff // 60} 分钟后重试（不烧整轮窗口）。")
        from .metrics import append_event
        append_event(iid.split("-")[0], iid, "PATROL", "patrol", 0,
                     "岛无响应（超时/失败），短退避重试")
        st = _state(iid)
        st.update(last=time.time() - every_s + backoff)
        _save_state(iid, st)
        return f"PATROL-ISLAND-FAIL {iid}"
    # 剥 code fence 再提取 JSON（LLM 常用 ```json ... ``` 包裹）
    _body = (res or "").strip()
    if _body.startswith("```"):
        _body = _body.split("\n", 1)[1] if "\n" in _body else _body[3:]
        if _body.rstrip().endswith("```"):
            _body = _body.rstrip()[:-3]
    try:
        data = json.loads(_body[_body.index("{"):_body.rindex("}") + 1])
    except Exception as e:
        data = {"progress": f"巡逻解析失败({type(e).__name__}: {str(e)[:80]})：{(_body or '')[:100]}",
                "findings": [], "children": []}
    note = [f"巡逻 #{_state(iid)['count'] + 1} {time.strftime('%F %T')}",
            f"进展：{data.get('progress', '')}"]
    note += [f"发现：{f}" for f in data.get("findings", [])]
    kids = []
    child_track = spec.get("child_track", "L2 常规")
    if child_track.startswith(("L0", "L1")):
        child_track = "L2 常规"          # 安全红线：巡逻孵化的子单一律 ≥L2（必经制作人批）
    for ch in (data.get("children") or [])[:2]:
        if not (ch.get("summary") and ch.get("gate_cmd")):
            continue
        gate = _sanitize_cmd(str(ch["gate_cmd"]).strip())
        if not gate:
            note.append(f"跳过子单「{ch['summary'][:30]}」：验收命令未过消毒")
            continue
        child_type = spec.get("child_type", "需求")
        # H3: 情报流起点是"发现"；提案流起点是"草稿"（进治理队列等制作人，不进派发流）
        entry = {"情报": "发现", "提案": "草稿"}.get(child_type, "新单")
        # STUDIO-60：孵化走 derive——子单挂原生 Subtask link（父单文本降级兼容）；
        # 等级违规拒建时跳过该子单（父单已评论留痕），不炸整轮巡逻
        try:
            kid = yt.derive(iid, f"[{iid}] {ch['summary'][:60]}", ch.get("description", ""),
                            lane=row["lane"], typ=child_type,
                            track=child_track, state=entry)
        except DeriveRefused as e:
            note.append(f"跳过子单「{ch['summary'][:30]}」：{e}")
            continue
        except Exception as e:
            # 单点容错（STUDIO-37 实录：哨兵泳道 400 炸整轮，state 不落盘 → 每小时
            # 无断路重烧 FULL 调用，违宪章§0.6）：HTTPError/任何异常只废该子单，
            # 本轮其余产出照常评论 + state 落盘
            _log(f"ERROR {iid} 孵化子单「{ch['summary'][:40]}」失败 "
                 f"{type(e).__name__}: {e}")
            note.append(f"跳过子单「{ch['summary'][:30]}」：孵化异常"
                        f"({type(e).__name__}: {str(e)[:80]})")
            continue
        yt.gate_freeze(kid, gate)
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
