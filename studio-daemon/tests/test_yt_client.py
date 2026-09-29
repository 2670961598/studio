"""yt 客户端（跑在假 YouTrack 上）：字段三态/无泳道建单/gate 引号/迁移校验/attempt。"""
import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from studio.yt import YT


@pytest.fixture
def yt(fake_yt):
    return YT("agent-8")


def test_建单_无泳道_STUDIO(fake_yt, yt):
    iid = yt.new("STUDIO", "t", "d", lane=None, typ="提案", track="G1 知识", state="草稿")
    assert iid.startswith("STUDIO-")
    assert "泳道" not in fake_yt.issues[iid]["fields"]


def test_建单_字段齐全(fake_yt, yt):
    iid = yt.new("POLY", "t", "d", lane="core", typ="需求", track="L0 自动")
    f = fake_yt.issues[iid]["fields"]
    assert f["State"] == "新单" and f["attempt"] == 0 and f["泳道"] == "core"


def test_字段三态读取_数字文本枚举(fake_yt, yt):
    iid = yt.new("POLY", "t", "d")
    yt.attempt_inc(iid)
    assert yt.f(iid, "attempt") == 1                       # 数字态
    yt.gate_freeze(iid, 'test -f "a b.md" && grep -q x "a b.md"')  # 历史bug：引号
    assert '"a b.md"' in yt.f(iid, "验收命令")             # 文本态原样往返
    assert yt.f(iid, "State") == "新单"                    # 枚举态


def test_迁移_合法与非法(fake_yt, yt):
    iid = yt.new("POLY", "t", "d", typ="需求", track="L2 常规")
    with pytest.raises(ValueError):
        yt.transition(iid, "已交付")                       # 新单跳态
    assert yt.transition(iid, "待批") == ("新单", "待批")
    with pytest.raises(ValueError):
        yt.transition(iid, "复验通过")                     # 待批跳到复验
    yt.transition(iid, "已派发")
    yt.transition(iid, "证据就绪")
    yt.transition(iid, "复验通过")
    yt.transition(iid, "待批")
    yt.transition(iid, "已交付")


def test_attempt_断路计数(fake_yt, yt):
    iid = yt.new("POLY", "t", "d")
    assert yt.attempt_inc(iid) == 1
    assert yt.attempt_inc(iid) == 2
    assert yt.attempt_inc(iid) == 3


def test_心跳毫秒(fake_yt, yt):
    import time as _t
    iid = yt.new("POLY", "t", "d")
    yt.heartbeat(iid)
    hb = fake_yt.issues[iid]["fields"]["心跳"]
    assert abs(_t.time() * 1000 - hb) < 60000


def test_评论与列表(fake_yt, yt):
    iid = yt.new("POLY", "t", "d", typ="需求", track="L0 自动")
    yt.comment(iid, "hello")
    yt.comment(iid, "world")
    cs = yt.comments(iid)
    assert [c["text"] for c in cs] == ["hello", "world"]
    rows = yt.list("POLY", "状态:新单")
    assert any(r["id"] == iid and r["track"] == "L0 自动" for r in rows)


# ---- 派生链（STUDIO-60：原生 issue links 替父单文本字段） ----
def test_派生挂subtask链_父单降级兼容(fake_yt, yt):
    """派生走原生 links（子侧 INWARD/父侧 OUTWARD 镜像）；「父单」文本字段
    回写（降级兼容老读方）；无 links 的老单降级读文本字段。"""
    parent = yt.new("POLY", "重构战役", "d", typ="提案", track="G3 编制", state="草稿")
    kid = yt.derive(parent, "落地一", "d2", typ="需求", track="L2 常规", state="新单")
    assert yt.parents(kid) == [parent]                     # links 主轨：子侧 INWARD
    assert yt.subtasks(parent) == [kid]                    # 父侧 OUTWARD 镜像
    assert yt.f(kid, "父单") == parent                     # 文本字段回写（降级兼容）
    assert yt.parent_of(kid) == parent                     # 解析优先 links
    old = yt.new("POLY", "老单", "d", typ="需求", track="L2 常规")
    yt.set_text(old, "父单", "POLY-999")                   # 老单：只有文本字段
    assert yt.parent_of(old) == "POLY-999"                 # 无 links → 降级读文本


def test_派生等级违规拒建评论留痕(fake_yt, yt):
    """org_level 双轨校验 子<父：同级拆单拒建（不留半成品）+ 父单评论留痕；
    等级字段（新轨）优先于轨道映射（双轨）。"""
    from studio.yt import DeriveRefused
    parent = yt.new("POLY", "p", "d", typ="需求", track="L2 常规")   # 轨道档=3
    with pytest.raises(DeriveRefused):
        yt.derive(parent, "同级拆单", "d", typ="需求", track="L2 常规")  # 3≮3 违规
    assert yt.subtasks(parent) == []                       # 没建出任何子单
    assert any("拒建" in c["text"] for c in yt.comments(parent))      # 评论留痕
    yt.set_field(parent, "等级", 8, "SimpleIssueCustomField")         # 新轨：等级字段优先
    kid = yt.derive(parent, "高阶父再拆", "d", typ="提案", track="G1 知识", state="草稿")
    assert yt.parents(kid) == [parent]                     # 5<8 放行
