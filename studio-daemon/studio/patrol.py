"""patrol — 战役巡逻引擎（Type=战役 · 运行中 的永驻母亲单）
每轮：到点检查 → （可选）跑基准命令存快照 → 框架预取巡逻源文本 → LLM 岛纯文本推理/对比快照
→ 战役单贴进展 → 值得做的孵化成子单（正常轨道，制作人审批）。
spec 文件 kernel/campaigns/<单号>.yaml 是战役的大脑，制作人随时可改。"""
import json, re, subprocess, time, yaml
import requests
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
sources: []            # 巡逻源清单（URL，框架 requests 预取文本进岛提示词）
baseline_cmd: ""       # 可选：基准命令（跑分/统计），输出追加进快照序列
repo: ""               # 巡逻岛工作目录 + baseline_cmd 执行目录；空=回退泳道映射的仓库路径
child_type: 需求       # 孵化子单的 Type（v2）
child_track: "L2 常规"  # 孵化子单的级别（L0/L1 会被强制升 L2）
child_level: 2         # 孵化子单的等级（V3 编制字段；缺省 2，巡逻子单一律 ≥2 红线不变）
child_dept: 工程部      # 孵化子单的部门（V3 编制字段；施工默认按工程部派发）
dispatcher: 巡逻引擎    # 孵化子单的派单人（V3 编制字段；缺省巡逻引擎）
patrol_brief: ""       # 巡逻任务书补充（对比什么、什么值得开单）
"""


def _child_level(spec: dict) -> int:
    """孵化子单等级（STUDIO-99 V3 编制）：spec.child_level 可配、缺省 2；
    红线一律 ≥2（对齐 child_track 的 L0/L1 强制升 L2）；坏值回退缺省。"""
    try:
        return max(2, int(spec.get("child_level") or 2))
    except (TypeError, ValueError):
        return 2


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


# STUDIO-104：claude CLI 内置网页抓取工具被本机网络策略封禁（STUDIO-37 九连败
# 实录：岛逐源重试拖满 600s → ISLAND-FAIL 退避循环），巡逻源改由框架 shell 层
# requests 预取进提示词——岛对源零网络依赖，纯文本推理。
_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")


def _prefetch_sources(sources) -> tuple[list, list]:
    """巡逻源预取：requests.get 逐源抓取（普通浏览器 UA，timeout=10），
    每源截前 8000 字符文本（去 HTML 标签粗筛）。返回 (成功块, 失败留痕)；
    源级失败只跳过留痕——单源死不再拖垮整轮（本事故主教训）。"""
    ok, fails = [], []
    for u in sources or []:
        u = str(u).strip()
        if not u:
            continue
        try:
            r = requests.get(u, timeout=10, headers={"User-Agent": _UA})
            r.raise_for_status()
            text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", r.text)).strip()
            ok.append({"url": u, "text": text[:8000]})
        except Exception as e:
            fails.append(f"源 {u} 预取失败跳过（{type(e).__name__}）")
    return ok, fails


def _sources_prompt(sources, blocks) -> str:
    """预取源文本拼进岛提示词（STUDIO-104）：成功块逐源贴文本，岛对源不做
    任何网络访问；有源但全失败 → 明示「本轮源全不可用」按空发现处理。"""
    if not sources:
        return "巡逻源：（未配置）\n"
    if not blocks:
        return ("巡逻源：本轮源全不可用（框架预取全部失败）——按空发现处理："
                "findings 留空，不要臆测源内容，只按仓库与快照汇报。\n")
    parts = ["巡逻源（框架已预取，直接读下方文本，对源不再做任何网络访问）："]
    for b in blocks:
        parts.append(f"【源 {b['url']}】\n{b['text']}")
    return "\n".join(parts) + "\n"


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
    from . import ytgw
    # STUDIO-104：源预取进提示词——岛对源零网络动作、无网络等待，也不再放开
    # allow_web（省权限面；抓取工具本就被环境封禁）。
    # 2026-10-24 修订（POLY-19/20 两日 13 次连败实录）：240s 只对"源预取型"巡逻
    # 成立；开放型审计（测试盲区/双仓接缝对账）靠 Read/Grep 在仓内漫游核实，
    # 240s 结构性不够（含 git log 快照进提示词后仍满超时）。放宽到 480s——
    # 网络等待依旧为零，超时只吃真实工具核实时间。
    src_blocks, src_fails = _prefetch_sources(spec.get("sources", []))
    # STUDIO-77：巡逻岛 YouTrack 操作纳入 wkey 网关——本轮签发凭证钉进战役 state
    # （下轮签发即轮换，旧 key 自动作废），岛产物（进展评论/孵化子单）全走网关：
    # 署名 [项目·单号·patrol] + GW_* 记账；框架诊断类评论（激活/空壳/岛无响应）
    # 不属岛产物，仍由引擎直发 yt.comment。
    wkey = ytgw.sign()
    st = _state(iid)
    st["wkey"] = wkey
    _save_state(iid, st)
    res = ask(cwd=repo or None, prompt=
        f"你是虚拟工作室的战役巡逻员，负责永驻战役「{spec.get('theme', iid)}」。\n"
        f"战役仓库（本地，已是你的工作目录）：{repo or '（未配置——不要凭空猜测仓库位置，只报告无法定位）'}。\n"
        f"用 Read/Glob/Grep 工具在该仓库内核实事实，禁止凭想象描述仓库内容。\n"
        f"YouTrack 纪律：板面操作不归你（进展/子单由框架网关代发）；禁止读取任何凭证文件（youtrack.json/token）。\n"
        f"任务书：{spec.get('patrol_brief', '')}\n"
        f"{_sources_prompt(spec.get('sources', []), src_blocks)}"
        f"最近基准快照：\n{snap_text or '（无基准）'}\n\n"
        "产出（只输出 JSON）：{\"progress\":\"≤120字进展\",\"findings\":[\"≤80字发现\"...],"
        "\"children\":[{\"summary\":\"子单标题\",\"description\":\"需求描述\","
        "\"gate_cmd\":\"一条 bash 冻结验收命令\"}]}（children 最多2条，没有确凿可做的就空数组）。"
        "gate_cmd 纪律：只允许 test/grep/wc/cat/ls/diff/dotnet/python 与 git 只读子命令的 && 链"
        "（≤2段；禁管道、重定向、$()、反引号、分号），否则会被消毒器拒掉——"
        "基准阈值类断言写成 grep -c 计数或 dotnet test --filter 形式。",
        timeout_sec=480,
        acct=(iid.split("-")[0], iid, "patrol"))   # STUDIO-107：巡逻岛成本记到战役母亲单
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
    note += src_fails   # STUDIO-104：预取失败源留痕（"源 X 预取失败跳过"）
    kids = []
    child_track = spec.get("child_track", "L2 常规")
    if child_track.startswith(("L0", "L1")):
        child_track = "L2 常规"          # 安全红线：巡逻孵化的子单一律 ≥L2（必经制作人批）
    # STUDIO-99（V3 适配 P0-1）：出生自带编制——等级/部门/派单人随孵化写入子单，
    # 全部 spec 可配、缺省兜底；存量单不回填（渐进启用：增量合规、存量零迁移）。
    # 三值经 ytgw.patrol_derive 一体盖章（derive+编制+冻验+署名+记账）。
    child_level = _child_level(spec)
    child_dept = str(spec.get("child_dept") or "").strip() or "工程部"
    dispatcher = str(spec.get("dispatcher") or "").strip() or "巡逻引擎"
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
        # STUDIO-77：derive+冻结验收+来源署名经 ytgw 一体代办（岛持本轮 wkey）
        try:
            kid = ytgw.patrol_derive(iid, wkey, f"[{iid}] {ch['summary'][:60]}",
                                     ch.get("description", ""), lane=row["lane"],
                                     typ=child_type, track=child_track, state=entry,
                                     gate=gate, level=child_level, dept=child_dept,
                                     dispa=dispatcher)
        except DeriveRefused as e:
            note.append(f"跳过子单「{ch['summary'][:30]}」：{e}")
            continue
        except Exception as e:
            # 单点容错（STUDIO-37 实录：哨兵泳道 400 炸整轮，state 不落盘 → 每小时
            # 无断路重烧 FULL 调用，违宪章§0.6）：HTTPError/任何异常只废该子单，
            # 本轮其余产出照常评论 + state 落盘
            # （STUDIO-77 合并：直发三步已并 ytgw.patrol_derive 一体，容错边界不变）
            _log(f"ERROR {iid} 孵化子单「{ch['summary'][:40]}」失败 "
                 f"{type(e).__name__}: {e}")
            note.append(f"跳过子单「{ch['summary'][:30]}」：孵化异常"
                        f"({type(e).__name__}: {str(e)[:80]})")
            continue
        kids.append(kid)
        note.append(f"孵化子单：{kid}")
    ytgw.patrol_comment(iid, wkey, "\n".join(note))
    from .metrics import append_event, settle_cost
    append_event(iid.split("-")[0], iid, "PATROL", "patrol", 0,
                 f"{len(kids)} 子单；{data.get('progress', '')[:60]}")
    settle_cost(yt, iid)            # STUDIO-107：本轮巡逻岛 token 累计进战役单件成本
    st = _state(iid); st.update(last=time.time(), count=st["count"] + 1)
    _save_state(iid, st)
    return f"PATROL {iid} +{len(kids)}kids"
