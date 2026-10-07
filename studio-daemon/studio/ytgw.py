"""ytgw — YouTrack 执行体网关（STUDIO-77 wkey 签发补全）
制作人 2026-09-29 定则（agent 用 YouTrack 必经框架）+ 2026-09-30 宰相派单补全：
三类执行体的 YouTrack 操作一律经此网关——wkey 凭证 + 白名单动作 + 署名注入 + 事件记账。

  执行体              凭证（签发 → 钉存）                白名单动作                    接入面
  ──────────────────  ─────────────────────────────────  ────────────────────────────  ──────────────────
  交付泳道 worker     Worker.launch 派单签发 → reg        comment / heartbeat /         HTTP /api/yt/*（web）
  explore 泳道 worker 同一 launch 链（含 explore）        article（web.py 三端点薄壳）  同上
  patrol 巡逻岛       patrol 每轮签发 → 战役 state        comment / derive_child        进程内（岛禁 Bash，
                                                       （框架持 key 代办岛产物）      设计上不可直连）

直连 YouTrack 的路径全部收口：执行体不持有任何 YouTrack token——worker 任务书只教
网关 curl（$STUDIO_WKEY），巡逻岛 prompt 明令「板面不归你 + 禁读凭证文件」。
框架控制面（orchestrator/patrol 引擎自身的诊断评论、状态迁移、字段写入）不属执行体
动作，仍走 YT 直连；状态推进永不入执行体白名单。
凭证形态 wk-<32hex>；verify fail-closed（缺 reg/坏 JSON/空 key 一律拒）；
worker 与 patrol 凭证分储不同文件，互相打不进对方动作面（白名单按执行体隔离）。
"""
import json
from .config import CONFIG


class GatewayRefused(Exception):
    """wkey 校验失败：HTTP 面转 403；进程内调用方自行兜底（patrol 炸轮留 ERROR）。"""


def sign() -> str:
    """签发 wkey：wk-<32hex>（Worker.launch 派单 / patrol 每轮，同一形态同一入口）。"""
    import secrets
    return "wk-" + secrets.token_hex(16)


def _workers_wkey(iid: str) -> str | None:
    """worker 凭证读取：活 reg 优先，归档 done.json 随存（收割后凭证仍可审计回放）。"""
    for f in (CONFIG.workers_dir / f"{iid}.json", CONFIG.workers_dir / f"{iid}.done.json"):
        if f.exists():
            try:
                return json.loads(f.read_text(encoding="utf-8")).get("wkey")
            except Exception:
                return None                 # 坏 JSON = 不可信 = 拒（fail-closed）
    return None


def _camp_wkey(iid: str) -> str | None:
    """巡逻岛凭证读取：本轮钉进战役 state（路径对齐 patrol._camp_dir——跟 _root 走，
    tmp_config 换根后测试不会读写到生产 kernel）；下轮签发即轮换，旧 key 自动作废。"""
    f = CONFIG._root.parent / "kernel" / "campaigns" / f"{iid}.state.json"
    if not f.exists():
        return None
    try:
        return json.loads(f.read_text(encoding="utf-8")).get("wkey")
    except Exception:
        return None


def verify(iid: str, key: str, kind: str = "worker") -> bool:
    """wkey 校验（fail-closed）：worker=workers reg；patrol=战役 state。
    两类凭证分储不同文件——worker key 过不了 patrol 面，反之亦然（动作面隔离）。"""
    want = _workers_wkey(iid) if kind == "worker" else _camp_wkey(iid)
    return bool(key) and bool(want) and want == key


def _require(iid: str, key: str, kind: str):
    if not verify(iid, key, kind):
        raise GatewayRefused(f"{kind} wkey 校验失败 {iid or '(空单号)'}")


def _pid(iid: str) -> str:
    return iid.split("-")[0]


# ---------------------------------------------------------------- worker 类（HTTP 面）
def worker_comment(iid: str, key: str, text: str) -> dict:
    """worker 评论——署名自动注入 [项目·单号·worker]（账号共用、单上身份不混淆）。"""
    _require(iid, key, "worker")
    from .yt import YT
    from .metrics import append_event
    YT("agent-8").comment(iid, f"[{_pid(iid)}·{iid}·worker] {text}")
    append_event(_pid(iid), iid, "GW_COMMENT", "gateway", 0, (text or "")[:60])
    return {"ok": True, "signed": True}


def worker_heartbeat(iid: str, key: str) -> dict:
    _require(iid, key, "worker")
    from .yt import YT
    YT("agent-8").heartbeat(iid)
    return {"ok": True}


def worker_article(iid: str, key: str, title: str, content: str) -> dict:
    """worker 草稿文章（探索/情报产物；路径 草稿/单号/标题）。"""
    _require(iid, key, "worker")
    from .yt import YT
    from .metrics import append_event
    path = f"草稿/{iid}/{(title or '未命名')[:40]}"
    YT("agent-8").wiki_create(path, f"[{_pid(iid)}·{iid}·worker] 草稿\n\n{content}", _pid(iid))
    append_event(_pid(iid), iid, "GW_ARTICLE", "gateway", 0, path[:60])
    return {"ok": True, "path": path}


# ---------------------------------------------------------------- patrol 类（进程内代办）
def patrol_comment(iid: str, key: str, text: str) -> None:
    """巡逻岛产物评论：网关署名 [项目·单号·patrol] + 记账（替代旧直发 yt.comment）。"""
    _require(iid, key, "patrol")
    from .yt import YT
    from .metrics import append_event
    YT("agent-8").comment(iid, f"[{_pid(iid)}·{iid}·patrol] {text}")
    append_event(_pid(iid), iid, "GW_COMMENT", "gateway", 0, (text or "")[:60])


def patrol_derive(iid: str, key: str, summary: str, desc: str, *, lane, typ, track,
                  state: str, gate: str,
                  level: int = 2, dept: str = "工程部", dispa: str = "巡逻引擎") -> str:
    """巡逻岛孵化子单（derive + V3 编制 + 冻结验收命令 + 来源署名 + 记账，一体完成）。
    STUDIO-99（V3 适配 P0-1）：等级/部门/派单人出生自带——值由 patrol 引擎按战役 spec
    （child_level/child_dept/dispatcher）解析后传入；存量单不回填（渐进启用）。
    编制字段是项目级自定义字段（GAMES/POLY 有、个别项目可无）：逐字段 best-effort，
    写不进只留注记（STUDIO-94 父单回写同款——降级层绝不反噬孵化主链）。
    DeriveRefused 原样上抛（调用方跳过该子单、父单已留痕），其余异常上抛由
    调用方单点容错（STUDIO-37：只废该子单，不炸整轮）——行为对齐直发链，只是收口进网关。"""
    _require(iid, key, "patrol")
    from .yt import YT
    from .metrics import append_event
    t = YT("agent-8")
    kid = t.derive(iid, summary, desc, lane=lane, typ=typ, track=track, state=state)
    miss = []
    for name, val, ftype in (("等级", level, "SimpleIssueCustomField"),
                             ("部门", dept, "SingleEnumIssueCustomField"),
                             ("派单人", dispa, "SingleEnumIssueCustomField")):
        try:
            t.set_field(kid, name, val, ftype)
        except Exception:
            miss.append(name)
    if miss:
        t.comment(kid, f"编制字段「{'、'.join(miss)}」写入不可用（项目无此字段？），"
                       "V3 编制缺位留痕——存量口径，不回填。")
    t.gate_freeze(kid, gate)
    t.comment(kid, f"[{_pid(iid)}·{iid}·patrol] 来源：战役 {iid} 巡逻孵化")
    append_event(_pid(iid), iid, "GW_DERIVE", "gateway", 0, f"{kid} {summary[:40]}")
    return kid
