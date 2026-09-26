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
    # sources 默认非空：空壳战役会被短路（PATROL-NOSPEC），进岛用例必须带源
    (d / f"{iid}.yaml").write_text(
        f"theme: 测试\nevery_h: 1\nrepo: {repo}\nsources:\n  - https://example.com\n"
        f"baseline_cmd: ''\n"
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
        "sources:\n  - https://example.com\n"
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


def test_岛无响应走独立分支不误标解析失败(fake_yt, tmp_config, monkeypatch):
    """POLY-19/20 教训：岛 600s 超时返回 None → 空串 rindex 抛 ValueError 被误标
    "解析失败"。修复后：PATROL-ISLAND-FAIL + ERROR 日志 + 短退避，计数不推进。"""
    import time as _t
    from studio.yt import YT
    from studio import llm
    yt = YT("agent-pm")
    iid = yt.new("POLY", "战役：测试5", "d", lane="-", typ="战役", state="运行中")
    _camp_files(iid)                        # every_h=1（短周期：退避=正常节奏）
    monkeypatch.setattr(llm, "ask", lambda *a, **k: None)
    out = patrol._patrol_one(yt, {"id": iid, "state": "运行中", "lane": "-"})
    assert out.startswith("PATROL-ISLAND-FAIL")
    st = patrol._state(iid)
    assert st["count"] == 0                 # 巡逻计数不推进（白跑不算巡逻）
    assert st["last"] > _t.time() - 3600 * 25 + 3600   # last 已推进（退避后到期）
    texts = [c["text"] for c in yt.comments(iid)]
    assert any("无响应" in t for t in texts)
    assert not any("解析失败" in t for t in texts)     # 不再误标


def test_长周期战役岛无响应只退避2小时(fake_yt, tmp_config, monkeypatch):
    """every_h=168 的战役（POLY-19/20）一次岛超时绝不烧整周：2h 后即重试。"""
    import time as _t
    from studio.yt import YT
    from studio import llm
    yt = YT("agent-pm")
    iid = yt.new("POLY", "战役：测试6", "d", lane="-", typ="战役", state="运行中")
    d = CONFIG._root.parent / "kernel" / "campaigns"
    (d / f"{iid}.yaml").write_text(
        "theme: 测试\nevery_h: 168\nrepo: ''\nsources:\n  - https://example.com\n"
        "baseline_cmd: ''\nchild_type: 需求\nchild_track: \"L2 常规\"\npatrol_brief: b\n",
        encoding="utf-8")
    (d / f"{iid}.state.json").write_text('{"last":0,"count":0}')
    monkeypatch.setattr(llm, "ask", lambda *a, **k: None)
    patrol._patrol_one(yt, {"id": iid, "state": "运行中", "lane": "-"})
    st = patrol._state(iid)
    due_in = st["last"] + 168 * 3600 - _t.time()
    assert 7000 < due_in <= 7210            # ≈2 小时后重试，而非 168 小时


def test_空壳战役短路不烧岛(fake_yt, tmp_config, monkeypatch):
    """GAMES-32~39 实录：无 repo 无 sources 的战役每天白烧 FULL 调用。短路留言。"""
    from studio.yt import YT
    from studio import llm
    yt = YT("agent-pm")
    iid = yt.new("POLY", "战役：测试7", "d", lane="-", typ="战役", state="运行中")
    d = CONFIG._root.parent / "kernel" / "campaigns"
    (d / f"{iid}.yaml").write_text(
        "theme: 空壳\nevery_h: 24\nrepo: ''\nsources: []\nbaseline_cmd: ''\n"
        "child_type: 需求\nchild_track: \"L2 常规\"\npatrol_brief: b\n", encoding="utf-8")
    (d / f"{iid}.state.json").write_text('{"last":0,"count":0}')
    called = []
    monkeypatch.setattr(llm, "ask",
                        lambda *a, **k: called.append(1) or "{}")
    out = patrol._patrol_one(yt, {"id": iid, "state": "运行中", "lane": "-"})
    assert out == f"PATROL-NOSPEC {iid}"
    assert not called                        # 一次 LLM 调用都没发生
    assert any("未配置" in c["text"] for c in yt.comments(iid))

