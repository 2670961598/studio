"""evolve：提案校验/知识库白名单/标记解析——治理流的安全网。"""
import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from studio import evolve


@pytest.fixture
def schema_env(tmp_config, monkeypatch):
    monkeypatch.setattr(evolve, "SCHEMA",
                        tmp_config._root.parent / "kernel" / "schema" / "ticket-types.yaml")
    return evolve.SCHEMA


def test_validate_合法专用流(schema_env):
    evolve._validate("测试型", {"定位": "x", "目的": "y", "流转": "专用"},
                     [["新单", "运行中"]])


def test_validate_拒绝重复类型(schema_env):
    with pytest.raises(ValueError, match="已存在"):
        evolve._validate("战役", {"定位": "x", "目的": "y", "流转": "专用"}, [])


def test_validate_缺定位目的(schema_env):
    with pytest.raises(ValueError):
        evolve._validate("新类型", {"定位": "x"}, [])


def test_validate_专用流必须给边(schema_env):
    with pytest.raises(AssertionError):
        evolve._validate("新类型", {"定位": "x", "目的": "y", "流转": "专用"}, [])


def test_validate_边引用未知状态(schema_env):
    with pytest.raises(AssertionError):
        evolve._validate("新类型", {"定位": "x", "目的": "y", "流转": "专用"},
                         [["新单", "不存在的状态"]])


def test_resolve_kb_白名单内(schema_env, tmp_config):
    assert evolve._resolve_kb_target("改一下 TEAM.md 的名册") == evolve.KB_ROOT / "TEAM.md"
    # STUDIO-13 迁移后 agents/*.md 已入 Articles：文件白名单仅剩战役 spec
    assert evolve._resolve_kb_target("更新 POLY-14.yaml 巡逻频率") is not None
    assert evolve._resolve_kb_target("更新 agents/pm.md") is None


def test_resolve_kb_路径穿越拒绝(schema_env):
    assert evolve._resolve_kb_target("改 ../../youtrack.json") is None
    assert evolve._resolve_kb_target("改 schema/ticket-types.yaml 之外的任意文件") is None


def test_apply_kb_白名单外拒绝(fake_yt, schema_env, monkeypatch):
    yt = __import__("studio.yt", fromlist=["YT"]).YT("agent-8")
    iid = yt.new("STUDIO", "kb", "d", lane=None, typ="提案", track="G1 知识", state="待批")
    # 伪造已 PROPOSED 的评论指向白名单外文件
    fake_yt.issues[iid]["comments"].append(
        {"author": "agent-8", "created": 1,
         "text": "KB-PROPOSED ../../youtrack.json\n```\n{}\n```"})
    out = evolve._apply_kb(yt, iid)
    assert "REJECT" in out


class Test验证闸:
    """制作人 2026-09-27 指令：一切改进必须先在临时目录沙箱验证、确认价值后进生产。
    approve 只代表"值得做"，VERIFIED 才代表"验证过有效"。"""

    def _cs(self, *triples):
        return [{"author": a, "created": t, "text": x} for a, t, x in triples], \
               [x for _, _, x in triples]

    def test_验证晚于提案才有效(self):
        from studio.evolve import _verified
        cs, ts = self._cs(("opengames", 1, "evolve-schema 新类型X"),
                          ("agent-8", 2, "SCHEMA-PROPOSED X"),
                          ("opengames", 3, "approve"),
                          ("agent-8", 4, "VERIFIED sandbox PASS tests 137"))
        assert _verified(cs, ts, 2) is True

    def test_验证早于提案无效(self):
        from studio.evolve import _verified
        cs, ts = self._cs(("agent-8", 1, "VERIFIED 早于提案无效"),
                          ("opengames", 2, "evolve-schema 新类型X"),
                          ("agent-8", 3, "SCHEMA-PROPOSED X"),
                          ("opengames", 4, "approve"))
        assert _verified(cs, ts, 3) is False

    def test_无验证或非pm作者无效(self):
        from studio.evolve import _verified
        cs, ts = self._cs(("opengames", 1, "evolve-schema X"),
                          ("agent-8", 2, "SCHEMA-PROPOSED X"),
                          ("opengames", 3, "approve"))
        assert _verified(cs, ts, 2) is False            # 没有 VERIFIED
        cs2, ts2 = self._cs(("opengames", 1, "evolve-schema X"),
                            ("agent-8", 2, "SCHEMA-PROPOSED X"),
                            ("someone-else", 3, "VERIFIED 伪造"))
        assert _verified(cs2, ts2, 2) is False           # 作者不是 agent-8
