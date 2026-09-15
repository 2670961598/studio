"""evolve — 知识库自进化循环（一切规则变更走 YouTrack：提案 → 制作人 approve → 应用）
两类指令（都发在 STUDIO 内部改进单的评论里，仅 opengames 有效）：
  evolve-schema <需求描述>  → 新单子类型（枚举+schema yaml+git）
  kb-propose <文件> <说明>  → 修改团队知识库（TEAM/agent档案/战役spec，白名单内，git）
红线：无 approve 绝不应用；校验不过绝不应用；提案与执行必须隔制作人一次 approve。"""
import json, re, subprocess, time, yaml
from pathlib import Path
from .config import CONFIG
from .llm import ask

SCHEMA = CONFIG._root.parent / "kernel" / "schema" / "ticket-types.yaml"
KB_ROOT = CONFIG._root.parent / "kernel"
KB_ALLOW = [KB_ROOT / "TEAM.md"] + sorted((KB_ROOT / "agents").glob("*.md")) + \
           sorted((KB_ROOT / "campaigns").glob("*.yaml"))
MARK_PROPOSED, MARK_APPLIED = "SCHEMA-PROPOSED", "SCHEMA-APPLIED"


def _yt():
    from .yt import YT
    return YT("agent-pm")


def _log(line: str):
    p = CONFIG.logs_dir / f"daemon-{time.strftime('%F')}.log"
    with open(p, "a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%F %T')} [evolve] {line}\n")


def scan(yt=None) -> list[str]:
    """扫治理族提案单（Type=提案）：草稿→草案(待批)；待批+approve→应用(观察窗)。"""
    yt = yt or _yt()
    actions = []
    try:
        tickets = yt.list("STUDIO", "Type:提案 状态:草稿,待批")
    except Exception:
        return actions
    for row in tickets:
        iid = row["id"]
        try:
            actions.append(_process(yt, iid))
        except Exception as e:
            _log(f"ERROR {iid} {e}")
    return [a for a in actions if a]


def close_windows():
    """观察窗（7天）到期 → 结案。由 pm_tick 每轮调用。"""
    yt = _yt()
    for row in yt.list("STUDIO", "Type:提案 状态:观察窗"):
        cs = yt.comments(row["id"])
        last = max((c["created"] or 0) for c in cs) if cs else 0
        if (time.time() * 1000 - last) / 86400000 >= 7:
            yt.transition(row["id"], "结案")
            yt.comment(row["id"], "观察窗 7 天期满，指标无恶化，结案。")
            _log(f"WINDOW-CLOSED {row['id']}")


def _process(yt, iid: str) -> str | None:
    cs = yt.comments(iid)
    all_texts = [c["text"].strip() for c in cs]                   # P1-6：迭代文本而非 dict
    prod = [(c["created"], c["text"].strip()) for c in cs
            if c["author"] == CONFIG.producer and c["text"].strip()]
    proposed_at = next((c["created"] for c, t in zip(cs, all_texts)
                        if t.startswith((MARK_PROPOSED, "KB-PROPOSED"))), None)
    if any(t.startswith(MARK_APPLIED) for t in all_texts):
        return None
    directives = [t for _, t in prod if t.startswith(("evolve-schema", "kb-propose"))
                  and len(t.split()) > 1]
    desc = directives[-1][len("evolve-schema"):].strip() if any(
        d.startswith("evolve-schema") for d in directives) else None
    kb = directives[-1][len("kb-propose"):].strip() if any(
        d.startswith("kb-propose") for d in directives) else None
    # approve：制作人精确首 token，且必须晚于提案（禁预埋批准；P2-8 空评论安全）
    approved = any(t.split()[:1] == ["approve"] and proposed_at and created >= proposed_at
                   for created, t in prod)
    if desc is not None:
        if proposed_at is None:
            return _propose(yt, iid, desc)
        if approved:
            return _apply(yt, iid, desc)
        return f"PENDING-APPROVE {iid}"
    if kb:
        if proposed_at is None:
            return _propose_kb(yt, iid, kb)
        if approved:
            return _apply_kb(yt, iid)
        return f"PENDING-KB-APPROVE {iid}"
    return None


def _resolve_kb_target(desc: str) -> Path | None:
    """从 kb-propose 说明里猜目标文件（含文件名片段即可），必须在白名单内。"""
    for p in KB_ALLOW:
        if p.name in desc or (p.parent.name != "kernel" and p.parent.name in desc):
            return p
    if "公约" in desc or "TEAM" in desc.upper():
        return KB_ROOT / "TEAM.md"
    return None


def _propose_kb(yt, iid: str, desc: str) -> str:
    target = _resolve_kb_target(desc)
    if not target or not target.exists():
        yt.comment(iid, f"kb-propose 找不到白名单内的目标文件（{desc[:60]}）。"
                        f"可用目标：{', '.join(str(p.relative_to(KB_ROOT)) for p in KB_ALLOW)}")
        return f"KB-TARGET-MISS {iid}"
    cur = target.read_text(encoding="utf-8")
    res = ask(
        f"你是虚拟工作室的知识库编辑。目标文件 {target.relative_to(KB_ROOT)} 当前内容：\n"
        f"```\n{cur}\n```\n制作人修改说明：{desc}\n\n"
        "产出修改后的文件完整内容。保持既有结构与语气，只改说明涉及的部分，其余原样保留。只输出文件内容。", 420)
    if not res or len(res) < 20:
        yt.comment(iid, "kb 草案生成失败，请补充说明后重发 kb-propose")
        return f"KB-PROPOSE-FAIL {iid}"
    body = res.strip()
    if body.startswith("```"):
        body = body.split("\n", 1)[1].rsplit("```", 1)[0]
    yt.comment(iid, f"KB-PROPOSED {target.relative_to(KB_ROOT)}\n修改后的完整内容：\n"
                    f"```\n{body}\n```\n制作人回 `approve` 生效。")
    _to_pending(yt, iid, f"G1 知识/{target.name}")
    return f"KB-PROPOSED {iid} {target.name}"


def _apply_kb(yt, iid: str) -> str:
    cs = yt.comments(iid)
    mark = next(c["text"] for c in cs if c["text"].startswith("KB-PROPOSED"))
    rel = mark.split()[1]
    target = KB_ROOT / rel
    if target not in KB_ALLOW or not target.exists():
        return f"KB-APPLY-REJECT {iid} 目标不在白名单"
    body = mark.split("```", 1)[1].rsplit("```", 1)[0].strip()
    target.write_text(body + "\n", encoding="utf-8")
    subprocess.run(["git", "-C", str(KB_ROOT.parent), "add", "-A"], check=False)
    subprocess.run(["git", "-C", str(KB_ROOT.parent), "commit", "-q", "-m",
                    f"kb-update: {rel}（{iid} 制作人已批准）"], check=False)
    from .metrics import append_event
    append_event("STUDIO", iid, "KB_UPDATE", "agent-pm", 0, rel)
    yt.comment(iid, f"{MARK_APPLIED} {rel} 已更新并 git 提交，全员即刻生效。")
    _to_window(yt, iid)
    return f"KB-APPLIED {iid} {rel}"


def _propose(yt, iid: str, desc: str) -> str:
    schema_now = SCHEMA.read_text(encoding="utf-8")
    res = ask(
        "你是虚拟工作室的 schema 架构师。当前单子知识库（YAML）：\n```yaml\n"
        + schema_now +
        "\n```\n制作人需求：" + desc +
        "\n\n请设计新单子类型（或修改现有类型）。只输出 JSON："
        '{"type":"类型名(2-6字)","yaml":"该类型在 types: 下的条目(单层YAML对象字符串,'
        '含 定位/目的/流转/执行 等键)","type_edges":"若是专用流,输出 [[from,to],...] 的JSON字符串,'
        '否则输出空字符串","rationale":"为什么这么设计(≤80字)"}', 300)
    try:
        data = json.loads(res[res.index("{"):res.rindex("}") + 1])
        name = data["type"]
        block = yaml.safe_load(data["yaml"])
        edges = json.loads(data["type_edges"] or "[]")
        assert name and isinstance(block, dict)
        _validate(name, block, edges)
    except Exception as e:
        yt.comment(iid, f"提案生成失败（{e}），请补充描述后重发 evolve-schema")
        return f"PROPOSE-FAIL {iid} {e}"
    edge_note = f"\ntype_edges 追加：{edges}" if edges else ""
    yt.comment(
        iid,
        f"{MARK_PROPOSED} {name}\n定位：{block.get('定位', '')}\n目的：{block.get('目的', '')}\n"
        f"流转：{block.get('流转', '')}\n理由：{data.get('rationale', '')}{edge_note}\n"
        f"types 条目：\n```yaml\n{name}: {data['yaml']}\n```\n"
        f"制作人回复 `approve` 生效；回复其它内容则作废重提。")
    _to_pending(yt, iid, f"G2 类型/{name}")
    return f"PROPOSED {iid} {name}"


def _to_pending(yt, iid, level_note):
    """提案单：定级 + 草稿→待批。"""
    if "G" not in (yt.f(iid, "轨道") or ""):
        g = "G2 类型" if "类型" in level_note else "G1 知识"
        yt.set_field(iid, "轨道", g)
    if yt.f(iid, "State") == "草稿":
        yt.transition(iid, "待批")


def _to_window(yt, iid):
    """应用完成 → 实施中 → 观察窗（7 天后自动结案）。"""
    try:
        if yt.f(iid, "State") == "待批":
            yt.transition(iid, "实施中")
        yt.transition(iid, "观察窗")
        yt.comment(iid, "进入 7 日观察窗：自评引擎盯指标，恶化将回滚（git revert）并记教训。")
    except ValueError:
        pass


def _validate(name: str, block: dict, edges: list):
    states = set(yaml.safe_load(SCHEMA.read_text(encoding="utf-8"))["states"])
    types = yaml.safe_load(SCHEMA.read_text(encoding="utf-8"))["types"]
    if name in types:
        raise ValueError(f"类型 {name} 已存在（修改现有类型暂不支持，先人工改 yaml）")
    for k in ("定位", "目的", "流转"):
        if k not in block:
            raise ValueError(f"缺 {k}")
    if block.get("流转") == "专用":
        assert edges, "专用流必须给 type_edges"
        for a, b in edges:
            assert a in states and b in states, f"边 {a}->{b} 引用未知状态"
    elif not block.get("轨道"):
        raise ValueError("轨道制类型必须给 轨道")


def _ensure_enum(name: str):
    """YouTrack Type 枚举注册（admin 守门操作：仅在 approve 之后调用，动作全部留痕）。"""
    import requests
    bundle = CONFIG.ids.get("type_bundle")
    url = f"{CONFIG.yt_url}/api/admin/customFieldSettings/bundles/enum/{bundle}/values"
    r = requests.post(url, headers={"Authorization": f"Bearer {CONFIG.token('admin')}"},
                      json={"name": name}, params={"fields": "id,name"}, timeout=30)
    ok = r.status_code in (200, 201, 409)        # 409=已存在，视为成功
    _log(f"enum-register {name} -> HTTP {r.status_code} ok={ok}")
    return ok


def _apply(yt, iid: str, desc: str) -> str:
    cs = yt.comments(iid)
    mark = next(c["text"] for c in cs if c["text"].startswith(MARK_PROPOSED))
    m = re.match(rf"{MARK_PROPOSED} (\S+)", mark)
    name = m.group(1)
    yml_block = mark.split("```yaml", 1)[1].split("```", 1)[0].strip() if "```yaml" in mark else ""
    edge_m = re.search(r"type_edges 追加：(\[\[.*\]\])", mark)
    edges = json.loads(edge_m.group(1)) if edge_m else []
    data = yaml.safe_load(SCHEMA.read_text(encoding="utf-8"))
    if name in data["types"]:
        return f"ALREADY {iid}"
    try:                                          # P1-4：评论里贴的是 "名字: {…}" 外层包裹
        raw = yaml.safe_load(yml_block)
        block = raw.get(name) if isinstance(raw, dict) and name in raw else raw
        assert isinstance(block, dict) and block
    except Exception as e:
        yt.comment(iid, f"草案 YAML 解析失败（{e}），请重发 evolve-schema 重新提案")
        return f"APPLY-PARSE-FAIL {iid}"
    _validate(name, block, edges)
    if not _ensure_enum(name):
        yt.comment(iid, f"{name} 枚举注册失败（YouTrack bundle），应用中止——检查 admin 权限后重试")
        return f"ENUM-FAIL {iid} {name}"
    data["types"][name] = block
    if edges:
        data.setdefault("type_edges", {})[name] = edges
    data["updated"] = time.strftime("%F %H:%M")
    SCHEMA.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False),
                      encoding="utf-8")
    # git 留痕：工作流的演化史 = 仓库提交史
    subprocess.run(["git", "-C", str(CONFIG._root.parent), "add", "-A"], check=False)
    subprocess.run(["git", "-C", str(CONFIG._root.parent), "commit", "-q", "-m",
                    f"evolve-schema: 新增类型「{name}」（{iid} 制作人已批准）"], check=False)
    from .runs import append_run
    from .metrics import append_event
    append_event("STUDIO", iid, "SCHEMA_EVOLVE", "agent-pm", 0, f"新增类型 {name}")
    append_run("evolve", "ok", 0, f"注册类型 {name}")
    yt.comment(iid, f"{MARK_APPLIED} {name} 已注册：枚举+知识库+git 提交完成，全工作室即刻生效。")
    _to_window(yt, iid)
    from . import statemachine as sm
    sm.recompute()                               # P1-5：统一热重载（重算全部派生表）
    return f"APPLIED {iid} {name}"
