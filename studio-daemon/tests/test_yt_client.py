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
