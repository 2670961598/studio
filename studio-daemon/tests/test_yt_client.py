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


def test_建单_泳道哨兵视为无泳道(fake_yt, yt):
    """STUDIO-37 实录：lane="-"（list() 对无泳道单的缺省值）不是任何项目的
    枚举值，带上建单必 400——哨兵=无泳道，不带字段；合法枚举值照常带。"""
    iid = yt.new("STUDIO", "t", "d", lane="-", typ="提案", track="G1 知识", state="草稿")
    assert fake_yt.issues[iid]["fields"].get("泳道") is None
    ok = yt.new("POLY", "t", "d", lane="framework", typ="需求", track="L2 常规")
    assert fake_yt.issues[ok]["fields"]["泳道"] == "framework"


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


# ---- STUDIO-93：link_subtask 新端点契约（三重实测照抄，405 漏修补丁） ----
def test_link_subtask_请求形态_类型id_内部id_方向(fake_yt, yt, requests_mock):
    """URL=/api/issues/{child}/links/{类型数字id}/issues?direction=inward，body={"id": 父单
    内部数字id}——类型名进 URL（真库 404）与 idReadable 进 body（真库 400）一次也不能发。"""
    parent = yt.new("POLY", "p", "d", typ="提案", track="G3 编制", state="草稿")
    kid = yt.derive(parent, "k", "d2", typ="需求", track="L2 常规", state="新单")
    posts = [r for r in requests_mock.request_history
             if r.method == "POST" and "/links/" in r.path]
    assert len(posts) == 1                                 # 建链恰好一次
    p = posts[0]
    ltid = fake_yt.link_types["Subtask"]
    assert p.path == f"/api/issues/{kid}/links/{ltid}/issues".lower()   # path 记录为小写
    assert p.qs["direction"] == ["inward"]
    assert p.json() == {"id": fake_yt.issues[parent]["id"]}   # 内部 id，非 idReadable


def test_link_subtask_类型id只查一次_缓存(fake_yt, yt, requests_mock):
    """issueLinkTypes 进程内缓存一次：多次建链只发一次 GET，不每链一查。"""
    parent = yt.new("POLY", "战役", "d", typ="提案", track="G3 编制", state="草稿")
    k1 = yt.derive(parent, "k1", "d", typ="需求", track="L2 常规", state="新单")
    k2 = yt.derive(parent, "k2", "d", typ="需求", track="L2 常规", state="新单")
    gets = [r for r in requests_mock.request_history if "issuelinktypes" in r.path]
    assert len(gets) == 1
    assert set(yt.subtasks(parent)) == {k1, k2}


def test_link_subtask_幂等跳过_零新建链请求_parents往返(fake_yt, yt, requests_mock):
    def _link_posts():
        return [r for r in requests_mock.request_history
                if r.method == "POST" and "/links/" in r.path]
    parent = yt.new("POLY", "p", "d", typ="提案", track="G3 编制", state="草稿")
    kid = yt.new("POLY", "k", "d", typ="需求", track="L2 常规", state="新单")
    yt.link_subtask(parent, kid)
    assert yt.parents(kid) == [parent]                     # 往返：子侧 INWARD
    assert yt.subtasks(parent) == [kid]                    # 父侧 OUTWARD 镜像
    yt.link_subtask(parent, kid)                           # 已挂 → 幂等跳过（检查本身仅 1 次 GET）
    assert len(_link_posts()) == 1                         # 零新建链 POST


def test_旧links端点POST_405契约锁(fake_yt, yt):
    """旧端点 POST /api/issues/{id}/links 真机无 POST（405，POLY-45 实弹）——
    假库照抄 405：客户端若回归旧形态，测试层当场炸红，不再静默容错。"""
    r = yt.s.post(f"{yt.base}/api/issues/POLY-1/links", json={
        "linkType": {"name": "Subtask"}, "direction": "INWARD",
        "issues": [{"idReadable": "POLY-2"}]})
    assert r.status_code == 405


# ---- STUDIO-94：derive 父单回写项目适配（Simple 字型 + 缺失降级不炸链，84③ 漏修） ----
def test_派生父单回写_STUDIO_Simple字型(fake_yt, yt, requests_mock):
    """STUDIO-94①：STUDIO「父单」= kotlin.Any 字型（STUDIO-89 实测）——回写走
    SimpleIssueCustomField 裸值（非 TextFieldValue 包裹），真库 200 的形态不能偏。"""
    parent = yt.new("STUDIO", "战役", "d", lane=None, typ="提案", track="G3 编制", state="草稿")
    kid = yt.derive(parent, "落地", "d2", lane=None, typ="需求", track="L2 常规", state="新单")
    cfs = [cf for r in requests_mock.request_history
           if r.method == "POST" and r.path == f"/api/issues/{kid}".lower()
           for cf in r.json().get("customFields", []) if cf["name"] == "父单"]
    assert len(cfs) == 1                                 # 父单回写恰好一次
    assert cfs[0]["$type"] == "SimpleIssueCustomField"   # kotlin.Any 字型
    assert cfs[0]["value"] == parent                     # 裸值，非 {"$type": "TextFieldValue"}
    assert yt.f(kid, "父单") == parent                   # 写读往返一致
    assert yt.parents(kid) == [parent]                   # links 主轨照挂


def test_派生父单字段缺失_降级注记不炸链(fake_yt, yt):
    """STUDIO-94②（84③ 事故复现，POLY-46 实弹）：项目无「父单」字段 → 真库 500
    incompatible-issue-custom-field-name。derive 不抛、正常返回、Subtask link 仍在、
    kid 评论降级注记——降级兼容层不得反噬派生主链。"""
    fake_yt.field_types.pop("父单")                      # FakeBackend 移除字段模拟 POLY
    parent = yt.new("POLY", "战役", "d", typ="提案", track="G3 编制", state="草稿")
    kid = yt.derive(parent, "落地", "d2", typ="需求", track="L2 常规", state="新单")
    assert yt.parents(kid) == [parent]                   # link 主轨恒成立
    assert yt.f(kid, "父单") is None                     # 字段缺失：未写入
    assert any("父单文本回写不可用" in c["text"] for c in yt.comments(kid))  # 降级注记
