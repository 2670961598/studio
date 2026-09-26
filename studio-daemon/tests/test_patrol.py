"""patrol 巡逻引擎：仓库定位回归网。
历史事故 POLY-14 #5：战役仓库不进岛上下文（无 cwd、prompt 无路径），
岛在 daemon 目录落根，把 studio-daemon（Python）误判成战役仓库，巡逻全废。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from studio import patrol                            # noqa: E402
from studio.config import CONFIG                     # noqa: E402


class TestRepoResolve:
    def test_spec_repo优先(self, tmp_config):
        assert patrol._repo({"repo": "/tmp/camp"}, "game") == "/tmp/camp"

    def test_spec_repo空白串回退泳道(self, tmp_config, monkeypatch):
        monkeypatch.setitem(CONFIG.lanes, "game", {"path": "/tmp/game"})
        assert patrol._repo({"repo": "  "}, "game") == "/tmp/game"

    def test_无repo无泳道为空(self, tmp_config):
        assert patrol._repo({}, "-") == ""
        assert patrol._repo({}, "") == ""

    def test_泳道未登记为空不炸(self, tmp_config):
        assert patrol._repo({}, "no-such-lane") == ""


def _camp_files(iid, repo=""):
    d = CONFIG._root.parent / "kernel" / "campaigns"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{iid}.yaml").write_text(
        f"theme: 测试\nevery_h: 1\nrepo: {repo}\nsources: []\nbaseline_cmd: ''\n"
        f"child_type: 需求\nchild_track: \"L2 常规\"\npatrol_brief: 查仓库\n", encoding="utf-8")
    (d / f"{iid}.state.json").write_text('{"last":0,"count":0}')   # last=0 强制到期


def test_巡逻带仓库路径与cwd(fake_yt, tmp_config, monkeypatch):
    from studio.yt import YT
    from studio import llm
    monkeypatch.setitem(CONFIG.lanes, "game", {"path": "/tmp/game"})
    yt = YT("agent-pm")
    iid = yt.new("POLY", "战役：测试", "d", lane="game", typ="战役", state="运行中")
    _camp_files(iid)                       # spec 无 repo → 回退 game 泳道路径
    calls = {}

    def fake_ask(prompt, timeout_sec=240, allow_web=False, model=llm.FULL, cwd=None):
        calls["p"], calls["cwd"] = prompt, cwd
        return '{"progress":"ok","findings":[],"children":[]}'

    monkeypatch.setattr(llm, "ask", fake_ask)
    out = patrol._patrol_one(yt, {"id": iid, "state": "运行中", "lane": "game"})
    assert out.startswith("PATROL")
    assert "/tmp/game" in calls["p"]            # 路径进了岛上下文
    assert calls["cwd"] == "/tmp/game"          # 岛 cwd 落在战役仓库


def test_巡逻spec_repo优先于泳道(fake_yt, tmp_config, monkeypatch):
    from studio.yt import YT
    from studio import llm
    monkeypatch.setitem(CONFIG.lanes, "game", {"path": "/tmp/game"})
    yt = YT("agent-pm")
    iid = yt.new("POLY", "战役：测试2", "d", lane="game", typ="战役", state="运行中")
    _camp_files(iid, repo="/tmp/camp")
    calls = {}

    def fake_ask(prompt, timeout_sec=240, allow_web=False, model=llm.FULL, cwd=None):
        calls["cwd"] = cwd
        return '{"progress":"ok","findings":[],"children":[]}'

    monkeypatch.setattr(llm, "ask", fake_ask)
    patrol._patrol_one(yt, {"id": iid, "state": "运行中", "lane": "game"})
    assert calls["cwd"] == "/tmp/camp"


def test_巡逻无仓库时cwd为None且prompt声明不可猜(fake_yt, tmp_config, monkeypatch):
    from studio.yt import YT
    from studio import llm
    yt = YT("agent-pm")
    iid = yt.new("POLY", "战役：测试3", "d", lane="-", typ="战役", state="运行中")
    _camp_files(iid)
    calls = {}

    def fake_ask(prompt, timeout_sec=240, allow_web=False, model=llm.FULL, cwd=None):
        calls["p"], calls["cwd"] = prompt, cwd
        return '{"progress":"ok","findings":[],"children":[]}'

    monkeypatch.setattr(llm, "ask", fake_ask)
    patrol._patrol_one(yt, {"id": iid, "state": "运行中", "lane": "-"})
    assert calls["cwd"] is None
    assert "不要凭空猜测" in calls["p"]


def test_提案子单出生态为草稿(fake_yt, tmp_config, monkeypatch):
    """治理族子单（Type=提案）出生即「草稿」：进制作人治理队列，绝不进派发流。"""
    from studio.yt import YT
    from studio import llm
    yt = YT("agent-pm")
    iid = yt.new("POLY", "战役：测试4", "d", lane="-", typ="战役", state="运行中")
    d = CONFIG._root.parent / "kernel" / "campaigns"
    (d / f"{iid}.yaml").write_text(
        "theme: 前沿\n"
        "every_h: 1\n"
        "repo: ''\n"
        "sources: []\n"
        "baseline_cmd: ''\n"
        "child_type: 提案\n"
        'child_track: "G1 知识"\n'
        "patrol_brief: 广域扫热点\n", encoding="utf-8")
    (d / f"{iid}.state.json").write_text('{"last":0,"count":0}')
    monkeypatch.setattr(llm, "ask", lambda *a, **k:
                        '{"progress":"ok","findings":[],"children":['
                        '{"summary":"引入X设计","description":"见链接",'
                        '"gate_cmd":"test -f docs/a.md"}]}')
    out = patrol._patrol_one(yt, {"id": iid, "state": "运行中", "lane": "-"})
    assert "+1kids" in out
    kids = yt.list("POLY", "Type:提案 状态:草稿")
    assert len(kids) == 1 and "引入X设计" in kids[0]["summary"]

