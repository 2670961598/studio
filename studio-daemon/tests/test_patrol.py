"""patrol 巡逻引擎：仓库定位回归网。
历史事故 POLY-14 #5：战役仓库不进岛上下文（无 cwd、prompt 无路径），
岛在 daemon 目录落根，把 studio-daemon（Python）误判成战役仓库，巡逻全废。"""
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from studio import patrol                            # noqa: E402
from studio.config import CONFIG                     # noqa: E402


class _FakeResp:
    """requests 响应替身：text 可含 HTML，status≥400 时 raise_for_status 抛错。"""

    def __init__(self, text="", status=200):
        self.text = text
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


@pytest.fixture(autouse=True)
def _stub_prefetch_net(monkeypatch):
    """STUDIO-104：源预取进提示词后 _patrol_one 会真发 requests——测试一律打桩
    （默认预取成功返回空文本），个别预取用例在测试体内显式覆盖 get 行为。"""
    monkeypatch.setattr(patrol, "requests",
                        SimpleNamespace(get=lambda *a, **k: _FakeResp("")))


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
    yt = YT("agent-8")
    iid = yt.new("POLY", "战役：测试", "d", lane="game", typ="战役", state="运行中")
    _camp_files(iid)                       # spec 无 repo → 回退 game 泳道路径
    calls = {}

    def fake_ask(prompt, timeout_sec=240, allow_web=False, model=llm.FULL, cwd=None, acct=None):
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
    yt = YT("agent-8")
    iid = yt.new("POLY", "战役：测试2", "d", lane="game", typ="战役", state="运行中")
    _camp_files(iid, repo="/tmp/camp")
    calls = {}

    def fake_ask(prompt, timeout_sec=240, allow_web=False, model=llm.FULL, cwd=None, acct=None):
        calls["cwd"] = cwd
        return '{"progress":"ok","findings":[],"children":[]}'

    monkeypatch.setattr(llm, "ask", fake_ask)
    patrol._patrol_one(yt, {"id": iid, "state": "运行中", "lane": "game"})
    assert calls["cwd"] == "/tmp/camp"


def test_巡逻无仓库时cwd为None且prompt声明不可猜(fake_yt, tmp_config, monkeypatch):
    from studio.yt import YT
    from studio import llm
    yt = YT("agent-8")
    iid = yt.new("POLY", "战役：测试3", "d", lane="-", typ="战役", state="运行中")
    _camp_files(iid)
    calls = {}

    def fake_ask(prompt, timeout_sec=240, allow_web=False, model=llm.FULL, cwd=None, acct=None):
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
    yt = YT("agent-8")
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


def test_孵化子单走subtask链(fake_yt, tmp_config, monkeypatch):
    """STUDIO-60：巡逻孵化走 derive——子单挂原生 Subtask link + 父单文本降级兼容。
    战役（运营族 级别:无）豁免等级梯，但链路必须建。"""
    from studio.yt import YT
    from studio import llm
    yt = YT("agent-8")
    iid = yt.new("POLY", "战役：测试8", "d", lane="-", typ="战役", state="运行中")
    _camp_files(iid)
    monkeypatch.setattr(llm, "ask", lambda *a, **k:
                        '{"progress":"ok","findings":[],"children":['
                        '{"summary":"补文档","description":"d",'
                        '"gate_cmd":"test -f docs/a.md"}]}')
    out = patrol._patrol_one(yt, {"id": iid, "state": "运行中", "lane": "-"})
    assert "+1kids" in out
    kids = yt.list("POLY", "Type:需求 状态:新单")
    assert len(kids) == 1
    assert yt.parents(kids[0]["id"]) == [iid]              # 原生 links 挂上
    assert yt.f(kids[0]["id"], "父单") == iid              # 文本字段降级兼容回写


# ---- STUDIO-99：出生自带编制（V3 适配 P0-1，等级/部门/派单人 spec 可配缺省兜底）----

def test_孵化子单出生自带编制_缺省兜底(fake_yt, tmp_config, monkeypatch):
    """spec 不写三键 → 子单出生即带 等级=2 / 部门=工程部 / 派单人=巡逻引擎
    （等级=2 即 ≥L2 红线值；V3 四维裁决/批干矩阵/逐环签字从此有粮）。"""
    from studio.yt import YT
    from studio import llm
    yt = YT("agent-8")
    iid = yt.new("POLY", "战役：编制缺省", "d", lane="-", typ="战役", state="运行中")
    _camp_files(iid)                       # spec 无三键 → 全走缺省兜底
    monkeypatch.setattr(llm, "ask", lambda *a, **k:
                        '{"progress":"ok","findings":[],"children":['
                        '{"summary":"补文档","description":"d",'
                        '"gate_cmd":"test -f docs/a.md"}]}')
    out = patrol._patrol_one(yt, {"id": iid, "state": "运行中", "lane": "-"})
    assert "+1kids" in out
    kids = yt.list("POLY", "Type:需求 状态:新单")
    assert len(kids) == 1
    assert yt.f(kids[0]["id"], "等级") == 2
    assert yt.f(kids[0]["id"], "部门") == "工程部"
    assert yt.f(kids[0]["id"], "派单人") == "巡逻引擎"


def test_孵化编制spec三项可覆盖(fake_yt, tmp_config, monkeypatch):
    """spec 三键全写 → 子单照单全收；child_level 低于 2 强制升 2（≥L2 红线不破）。"""
    from studio.yt import YT
    from studio import llm
    yt = YT("agent-8")
    iid = yt.new("POLY", "战役：编制覆盖", "d", lane="-", typ="战役", state="运行中")
    d = CONFIG._root.parent / "kernel" / "campaigns"
    (d / f"{iid}.yaml").write_text(
        "theme: 编制\n"
        "every_h: 1\n"
        "repo: ''\n"
        "sources:\n  - https://example.com\n"
        "baseline_cmd: ''\n"
        "child_type: 需求\n"
        'child_track: "L2 常规"\n'
        "child_level: 4\n"
        "child_dept: 情报部\n"
        "dispatcher: 宰相(ZCode)\n"
        "patrol_brief: b\n", encoding="utf-8")
    (d / f"{iid}.state.json").write_text('{"last":0,"count":0}')
    monkeypatch.setattr(llm, "ask", lambda *a, **k:
                        '{"progress":"ok","findings":[],"children":['
                        '{"summary":"覆盖单","description":"d",'
                        '"gate_cmd":"test -f docs/a.md"}]}')
    patrol._patrol_one(yt, {"id": iid, "state": "运行中", "lane": "-"})
    kids = yt.list("POLY", "Type:需求 状态:新单")
    assert len(kids) == 1
    assert yt.f(kids[0]["id"], "等级") == 4
    assert yt.f(kids[0]["id"], "部门") == "情报部"
    assert yt.f(kids[0]["id"], "派单人") == "宰相(ZCode)"
    assert patrol._child_level({"child_level": 1}) == 2      # 红线：<2 强制升 2
    assert patrol._child_level({"child_level": "x"}) == 2    # 坏值回退缺省


def test_提案型子单草稿态同样携带编制(fake_yt, tmp_config, monkeypatch):
    """Type=提案 出生即「草稿」（进治理队列不进派发流），编制三字段照带——
    出生自带编制不挑 Type：提案流的新单同样生而合规。"""
    from studio.yt import YT
    from studio import llm
    yt = YT("agent-8")
    iid = yt.new("POLY", "战役：编制提案", "d", lane="-", typ="战役", state="运行中")
    d = CONFIG._root.parent / "kernel" / "campaigns"
    (d / f"{iid}.yaml").write_text(
        "theme: 提案编制\n"
        "every_h: 1\n"
        "repo: ''\n"
        "sources:\n  - https://example.com\n"
        "baseline_cmd: ''\n"
        "child_type: 提案\n"
        'child_track: "G1 知识"\n'
        "patrol_brief: b\n", encoding="utf-8")
    (d / f"{iid}.state.json").write_text('{"last":0,"count":0}')
    monkeypatch.setattr(llm, "ask", lambda *a, **k:
                        '{"progress":"ok","findings":[],"children":['
                        '{"summary":"引入X设计","description":"d",'
                        '"gate_cmd":"test -f docs/a.md"}]}')
    out = patrol._patrol_one(yt, {"id": iid, "state": "运行中", "lane": "-"})
    assert "+1kids" in out
    kids = yt.list("POLY", "Type:提案 状态:草稿")
    assert len(kids) == 1                                   # 草稿态照旧（治理队列）
    assert yt.f(kids[0]["id"], "等级") == 2                 # 编制照带（缺省兜底）
    assert yt.f(kids[0]["id"], "部门") == "工程部"
    assert yt.f(kids[0]["id"], "派单人") == "巡逻引擎"


def test_子单孵化异常单点容错(fake_yt, tmp_config, monkeypatch):
    """STUDIO-37 实录：孵化子单炸 400（哨兵泳道等 HTTPError）曾炸出 _patrol_one、
    state 不落盘 → 每小时无断路重烧整轮巡逻。修复后：坏子单只跳过留痕，
    本轮其余子单照常孵化 + 评论 + state 落盘。"""
    from studio.yt import YT
    from studio import llm
    yt = YT("agent-8")
    iid = yt.new("POLY", "战役：容错", "d", lane="-", typ="战役", state="运行中")
    _camp_files(iid)
    monkeypatch.setattr(llm, "ask", lambda *a, **k:
                        '{"progress":"ok","findings":[],"children":['
                        '{"summary":"坏子单","description":"d",'
                        '"gate_cmd":"test -f docs/a.md"},'
                        '{"summary":"好子单","description":"d",'
                        '"gate_cmd":"test -f docs/b.md"}]}')
    real_derive = yt.derive

    # STUDIO-77 合并对齐：孵化已收口 ytgw.patrol_derive（网关内部自建 YT 实例），
    # 实例级桩打不进网关调用面——桩上移类级，故障注入语义不变（坏子单照旧 400）
    def flaky_derive(self, parent, summary, *a, **k):
        if "坏子单" in summary:
            raise RuntimeError("400 Bad Request: 泳道 '-' 非法值")   # 模拟 HTTP 400
        return real_derive(parent, summary, *a, **k)

    monkeypatch.setattr(YT, "derive", flaky_derive)
    out = patrol._patrol_one(yt, {"id": iid, "state": "运行中", "lane": "-"})
    assert "+1kids" in out                       # 好子单照常孵化
    assert patrol._state(iid)["count"] == 1      # 本轮 state 落盘（不再无断路重烧）
    texts = "\n".join(c["text"] for c in yt.comments(iid))
    assert "孵化异常" in texts                    # 坏子单跳过留痕在父单评论
    kids = yt.list("POLY", "Type:需求 状态:新单")
    assert len(kids) == 1 and "好子单" in kids[0]["summary"]


def test_岛无响应走独立分支不误标解析失败(fake_yt, tmp_config, monkeypatch):
    """POLY-19/20 教训：岛 600s 超时返回 None → 空串 rindex 抛 ValueError 被误标
    "解析失败"。修复后：PATROL-ISLAND-FAIL + ERROR 日志 + 短退避，计数不推进。"""
    import time as _t
    from studio.yt import YT
    from studio import llm
    yt = YT("agent-8")
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
    yt = YT("agent-8")
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
    yt = YT("agent-8")
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



# ---- STUDIO-77：巡逻岛 YouTrack 操作纳入 wkey 网关 ----

def test_巡逻岛产物走网关_署名与凭证钉存(fake_yt, tmp_config, monkeypatch):
    """STUDIO-77：岛签发 wkey 钉战役 state（可审计、下轮轮换）；进展评论/孵化子单
    经 ytgw 署名 [pid·iid·patrol] 并记 GW_* 事件；子单验收命令照冻。"""
    from studio.yt import YT
    from studio import llm
    yt = YT("agent-8")
    iid = yt.new("POLY", "战役：gw", "d", lane="-", typ="战役", state="运行中")
    _camp_files(iid)
    monkeypatch.setattr(llm, "ask", lambda *a, **k:
                        '{"progress":"p1","findings":["f1"],"children":['
                        '{"summary":"补文档","description":"d",'
                        '"gate_cmd":"test -f docs/a.md"}]}')
    out = patrol._patrol_one(yt, {"id": iid, "state": "运行中", "lane": "-"})
    assert "+1kids" in out
    texts = [c["text"] for c in yt.comments(iid)]
    assert any(t.startswith(f"[POLY·{iid}·patrol] 巡逻 #") for t in texts)
    kids = yt.list("POLY", "Type:需求 状态:新单")
    assert len(kids) == 1 and yt.f(kids[0]["id"], "验收命令") == "test -f docs/a.md"
    assert any(c["text"].startswith(f"[POLY·{iid}·patrol] 来源：战役")
               for c in yt.comments(kids[0]["id"]))
    st = patrol._state(iid)
    assert st.get("wkey", "").startswith("wk-") and len(st["wkey"]) == 3 + 32
    evs = CONFIG.events_path.read_text(encoding="utf-8")
    assert "GW_COMMENT" in evs and "GW_DERIVE" in evs


def test_空壳战役框架评论不经网关署名(fake_yt, tmp_config, monkeypatch):
    """STUDIO-77 白名单边界：空壳短路留言是框架诊断（岛没跑、无凭证）——不经网关、
    不署名 [·patrol]，战役 state 也不签发 wkey。"""
    from studio.yt import YT
    from studio import llm
    yt = YT("agent-8")
    iid = yt.new("POLY", "战役：gw2", "d", lane="-", typ="战役", state="运行中")
    d = CONFIG._root.parent / "kernel" / "campaigns"
    (d / f"{iid}.yaml").write_text(
        "theme: 空壳\nevery_h: 24\nrepo: ''\nsources: []\nbaseline_cmd: ''\n"
        "child_type: 需求\nchild_track: \"L2 常规\"\npatrol_brief: b\n", encoding="utf-8")
    (d / f"{iid}.state.json").write_text('{"last":0,"count":0}')
    monkeypatch.setattr(llm, "ask", lambda *a, **k: "{}")
    out = patrol._patrol_one(yt, {"id": iid, "state": "运行中", "lane": "-"})
    assert out == f"PATROL-NOSPEC {iid}"
    assert any("未配置" in c["text"] for c in yt.comments(iid))
    assert not any(c["text"].startswith("[") for c in yt.comments(iid))
    assert "wkey" not in patrol._state(iid)


def test_巡逻岛prompt明令禁读凭证(fake_yt, tmp_config, monkeypatch):
    """STUDIO-77 直连收口：岛 prompt 必须明示「板面不归你 + 禁读 youtrack.json/token」
    ——岛有 Read 工具，纪律行是岛侧唯一可教的收口面。"""
    from studio.yt import YT
    from studio import llm
    yt = YT("agent-8")
    iid = yt.new("POLY", "战役：gw3", "d", lane="-", typ="战役", state="运行中")
    _camp_files(iid)
    calls = {}

    def fake_ask(prompt, timeout_sec=240, allow_web=False, model=llm.FULL, cwd=None, acct=None):
        calls["p"] = prompt
        return '{"progress":"ok","findings":[],"children":[]}'

    monkeypatch.setattr(llm, "ask", fake_ask)
    patrol._patrol_one(yt, {"id": iid, "state": "运行中", "lane": "-"})
    assert "不归你" in calls["p"] and "youtrack.json" in calls["p"]


# ---- STUDIO-104：源预取进提示词（框架 requests 替代岛内置抓取工具）----

def test_源预取成功注入岛提示词(fake_yt, tmp_config, monkeypatch):
    """预取成功：源文本去 HTML 标签后直接进岛 prompt（岛对源零网络指令），
    ask 不再放开 allow_web；超时 2026-10-24 自 240 放宽至 480（POLY-19/20 实录：
    网络等待已零，但开放型审计的仓内工具漫游核实超 240s）。"""
    from studio.yt import YT
    from studio import llm
    yt = YT("agent-8")
    iid = yt.new("POLY", "战役：预取", "d", lane="-", typ="战役", state="运行中")
    _camp_files(iid)
    monkeypatch.setattr(patrol, "requests", SimpleNamespace(
        get=lambda u, **k: _FakeResp("<html><body>hello patrol</body></html>")))
    calls = {}

    def fake_ask(prompt, timeout_sec=240, allow_web=False, model=llm.FULL, cwd=None, acct=None):
        calls.update(p=prompt, t=timeout_sec, w=allow_web)
        return '{"progress":"ok","findings":[],"children":[]}'

    monkeypatch.setattr(llm, "ask", fake_ask)
    patrol._patrol_one(yt, {"id": iid, "state": "运行中", "lane": "-"})
    assert "hello patrol" in calls["p"]            # 预取文本进岛 prompt
    assert "<body>" not in calls["p"]              # HTML 标签粗筛掉
    assert "https://example.com" in calls["p"]     # 源 URL 随块进 prompt
    assert "WebFetch" not in calls["p"]            # 岛 prompt 零抓取指令残留（验收断言）
    assert calls["w"] is False and calls["t"] == 480   # 不放开网络权限；超时 240→480（2026-10-24 开放型审计修订）


def test_源级失败跳过留痕(fake_yt, tmp_config, monkeypatch):
    """STUDIO-37 主教训：单源死不拖垮整轮——坏源跳过并在父单评论留痕
    （「源 X 预取失败跳过」），好源照常进岛 prompt。"""
    from studio.yt import YT
    from studio import llm
    yt = YT("agent-8")
    iid = yt.new("POLY", "战役：预取失败", "d", lane="-", typ="战役", state="运行中")
    d = CONFIG._root.parent / "kernel" / "campaigns"
    (d / f"{iid}.yaml").write_text(
        "theme: 预取失败\nevery_h: 1\nrepo: ''\nsources:\n"
        "  - https://bad.example.com\n  - https://good.example.com\n"
        "baseline_cmd: ''\nchild_type: 需求\nchild_track: \"L2 常规\"\npatrol_brief: b\n",
        encoding="utf-8")
    (d / f"{iid}.state.json").write_text('{"last":0,"count":0}')
    calls = {}

    def flaky_get(u, **k):
        if "bad" in u:
            raise RuntimeError("timed out")
        return _FakeResp("good source text")

    monkeypatch.setattr(patrol, "requests", SimpleNamespace(get=flaky_get))
    monkeypatch.setattr(llm, "ask",
                        lambda prompt, *a, **k: calls.update(p=prompt) or
                        '{"progress":"ok","findings":[],"children":[]}')
    out = patrol._patrol_one(yt, {"id": iid, "state": "运行中", "lane": "-"})
    assert out.startswith("PATROL") and "ISLAND-FAIL" not in out   # 单源死不废整轮
    assert "good source text" in calls["p"]         # 好源照常进 prompt
    assert "bad.example.com" not in calls["p"]      # 坏源不进 prompt（只在评论留痕）
    texts = "\n".join(c["text"] for c in yt.comments(iid))
    assert "源 https://bad.example.com 预取失败跳过" in texts   # 留痕进父单评论


def test_全部源失败岛按空发现处理(fake_yt, tmp_config, monkeypatch):
    """有源但预取全失败：岛照常被调（不走 ISLAND-FAIL），prompt 明示
    「本轮源全不可用」按空发现处理，禁止臆测源内容。"""
    from studio.yt import YT
    from studio import llm
    yt = YT("agent-8")
    iid = yt.new("POLY", "战役：全失败", "d", lane="-", typ="战役", state="运行中")
    _camp_files(iid)
    calls = {}

    def dead_get(u, **k):
        raise RuntimeError("connection refused")

    monkeypatch.setattr(patrol, "requests", SimpleNamespace(get=dead_get))
    monkeypatch.setattr(llm, "ask",
                        lambda prompt, *a, **k: calls.update(p=prompt) or
                        '{"progress":"ok","findings":[],"children":[]}')
    out = patrol._patrol_one(yt, {"id": iid, "state": "运行中", "lane": "-"})
    assert out.startswith("PATROL")                # 正常巡逻（非 ISLAND-FAIL 退避）
    assert "本轮源全不可用" in calls["p"]           # 岛被明确告知源全不可用
    assert "空发现" in calls["p"]                   # 按空发现处理指令在
    texts = "\n".join(c["text"] for c in yt.comments(iid))
    assert "源 https://example.com 预取失败跳过" in texts   # 全失败同样逐源留痕


def test_prefetch契约_浏览器头超时与截断(monkeypatch):
    """_prefetch_sources 契约：普通浏览器 UA、timeout=10、去标签后每源截前
    8000 字符；空串源跳过不抓。"""
    seen = {}

    def spy_get(u, **k):
        seen.update(url=u, **k)
        return _FakeResp("<p>" + "x" * 20000 + "</p>")

    monkeypatch.setattr(patrol, "requests", SimpleNamespace(get=spy_get))
    ok, fails = patrol._prefetch_sources(["https://example.com/a", "  "])
    assert not fails and len(ok) == 1               # 空串源静默跳过
    assert seen["url"] == "https://example.com/a"
    assert seen["timeout"] == 10
    assert "Mozilla" in seen["headers"]["User-Agent"]
    assert len(ok[0]["text"]) == 8000               # 截前 8000 字符
