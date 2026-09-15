"""evolve — 单子知识库自进化循环（PM 可拓展类型，制作人批准后生效）
流程：内部改进单上 opengames 评论 `evolve-schema <需求描述>` → LLM 起草案
→ 评论贴出 SCHEMA-PROPOSED 补丁 → opengames 回 `approve` → 应用：
YouTrack 类型枚举注册 + ticket-types.yaml 更新 + git commit + 事件留痕。
红线：无 approve 绝不应用；补丁过不了机器校验绝不应用。"""
import json, re, subprocess, time, yaml
from pathlib import Path
from .config import CONFIG
from .llm import ask

SCHEMA = CONFIG._root.parent / "kernel" / "schema" / "ticket-types.yaml"
MARK_PROPOSED, MARK_APPLIED = "SCHEMA-PROPOSED", "SCHEMA-APPLIED"


def _yt():
    from .yt import YT
    return YT("agent-pm")


def _log(line: str):
    p = CONFIG.logs_dir / f"daemon-{time.strftime('%F')}.log"
    with open(p, "a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%F %T')} [evolve] {line}\n")


def scan(yt=None) -> list[str]:
    """扫内部改进单上的 evolve-schema 提案；返回本轮动作摘要（由 pm_tick 调用）。"""
    yt = yt or _yt()
    actions = []
    try:
        tickets = yt.list("STUDIO", "Type:内部改进 状态:草稿,新单,已排期,开发中")
    except Exception:
        return actions
    for row in tickets:
        iid = row["id"]
        try:
            actions.append(_process(yt, iid))
        except Exception as e:
            _log(f"ERROR {iid} {e}")
    return [a for a in actions if a]


def _process(yt, iid: str) -> str | None:
    cs = yt.comments(iid)
    producer_txt = [c["text"].strip() for c in cs if c["author"] == CONFIG.producer]
    proposed = any(c.startswith(MARK_PROPOSED) for c in cs)
    applied = any(c.startswith(MARK_APPLIED) for c in cs)
    if applied:
        return None
    desc = next((t[len("evolve-schema"):].strip() for t in producer_txt
                 if t.startswith("evolve-schema")), None)
    if desc is None:
        return None
    if not proposed:
        return _propose(yt, iid, desc)
    if any(t.split()[0] == "approve" for t in producer_txt):
        return _apply(yt, iid, desc)
    return f"PENDING-APPROVE {iid}"


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
    return f"PROPOSED {iid} {name}"


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
    _log(f"enum-register {name} -> HTTP {r.status_code}")
    return r.status_code in (200, 201)


def _apply(yt, iid: str, desc: str) -> str:
    cs = yt.comments(iid)
    mark = next(c for c in cs if c["text"].startswith(MARK_PROPOSED))["text"]
    m = re.match(rf"{MARK_PROPOSED} (\S+)", mark)
    name = m.group(1)
    yml_block = mark.split("```yaml", 1)[1].split("```", 1)[0].strip() if "```yaml" in mark else ""
    edge_m = re.search(r"type_edges 追加：(\[\[.*\]\])", mark)
    edges = json.loads(edge_m.group(1)) if edge_m else []
    data = yaml.safe_load(SCHEMA.read_text(encoding="utf-8"))
    if name in data["types"]:
        return f"ALREADY {iid}"
    block = yaml.safe_load(yml_block) if yml_block else {}
    _validate(name, block, edges)
    _ensure_enum(name)
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
    # 热重载状态机
    from . import statemachine as sm
    sm._S = sm._load_schema()
    sm.TYPE_EDGES = sm._type_edges()
    return f"APPLIED {iid} {name}"
