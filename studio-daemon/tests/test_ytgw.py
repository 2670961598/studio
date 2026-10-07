"""ytgw — STUDIO-77 wkey 签发补全：三类执行体（交付/explore worker + patrol 巡逻岛）
统一凭证、白名单动作、署名记账。核心断言：worker 与 patrol 凭证分储互不越面、
fail-closed（空 key/错 key/坏 reg 一律拒）、patrol 凭证随轮换作废。"""
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from studio.config import CONFIG                     # noqa: E402
from studio import ytgw                             # noqa: E402


def _pin_worker(iid: str, wkey: str):
    import json as _json
    (CONFIG.workers_dir / f"{iid}.json").write_text(
        _json.dumps({"issue": iid, "pid": -1, "wkey": wkey}), encoding="utf-8")


def _pin_patrol(iid: str, wkey: str):
    import json as _json
    d = CONFIG._root.parent / "kernel" / "campaigns"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{iid}.state.json").write_text(
        _json.dumps({"last": 0, "count": 0, "wkey": wkey}), encoding="utf-8")


class Test签发:
    def test_形态与唯一性(self):
        a, b = ytgw.sign(), ytgw.sign()
        for k in (a, b):
            assert k.startswith("wk-") and len(k) == 3 + 32   # wk- + 32 hex
        assert a != b


class Test校验:
    def test_worker凭证空key错key拒(self, tmp_config):
        _pin_worker("STUDIO-77", "wk-x")
        assert ytgw.verify("STUDIO-77", "wk-x", "worker")
        assert not ytgw.verify("STUDIO-77", "", "worker")          # 空 key fail-closed
        assert not ytgw.verify("STUDIO-77", "wk-y", "worker")      # 错 key
        assert not ytgw.verify("STUDIO-99", "wk-x", "worker")      # 无 reg

    def test_worker坏reg拒(self, tmp_config):
        (CONFIG.workers_dir / "STUDIO-77.json").write_text("{broken", encoding="utf-8")
        assert not ytgw.verify("STUDIO-77", "wk-x", "worker")

    def test_patrol凭证读战役state(self, tmp_config):
        _pin_patrol("POLY-14", "wk-p")
        assert ytgw.verify("POLY-14", "wk-p", "patrol")
        assert not ytgw.verify("POLY-14", "wk-q", "patrol")
        assert not ytgw.verify("POLY-15", "wk-p", "patrol")        # 无 state

    def test_两类凭证不越面(self, tmp_config):
        """白名单按执行体隔离：worker key 打不进 patrol 动作面，反之亦然。"""
        _pin_worker("STUDIO-77", "wk-w")
        _pin_patrol("STUDIO-77", "wk-p")
        assert not ytgw.verify("STUDIO-77", "wk-w", "patrol")
        assert not ytgw.verify("STUDIO-77", "wk-p", "worker")

    def test_patrol轮换旧key作废(self, tmp_config):
        _pin_patrol("POLY-14", "wk-old")
        _pin_patrol("POLY-14", "wk-new")     # 下轮重签覆盖 → 旧 key 自动作废
        assert not ytgw.verify("POLY-14", "wk-old", "patrol")
        assert ytgw.verify("POLY-14", "wk-new", "patrol")


class Testworker动作:
    def test_评论署名与记账(self, tmp_config, fake_yt, monkeypatch):
        from studio.yt import YT
        _pin_worker("STUDIO-77", "wk-1")
        calls = []
        monkeypatch.setattr(YT, "comment", lambda self, i, t: calls.append((i, t)))
        r = ytgw.worker_comment("STUDIO-77", "wk-1", "阶段完成")
        assert r["ok"] and r["signed"]
        assert calls[0] == ("STUDIO-77", "[STUDIO·STUDIO-77·worker] 阶段完成")
        assert "GW_COMMENT" in CONFIG.events_path.read_text(encoding="utf-8")

    def test_错key网关拒绝(self, tmp_config, fake_yt):
        _pin_worker("STUDIO-77", "wk-1")
        with pytest.raises(ytgw.GatewayRefused):
            ytgw.worker_comment("STUDIO-77", "nope", "x")

    def test_patrol_key打不进worker面(self, tmp_config, fake_yt):
        _pin_patrol("STUDIO-77", "wk-p")
        with pytest.raises(ytgw.GatewayRefused):
            ytgw.worker_comment("STUDIO-77", "wk-p", "越面")


class Testpatrol动作:
    def test_评论署名patrol(self, tmp_config, fake_yt, monkeypatch):
        from studio.yt import YT
        _pin_patrol("POLY-14", "wk-p")
        calls = []
        monkeypatch.setattr(YT, "comment", lambda self, i, t: calls.append((i, t)))
        ytgw.patrol_comment("POLY-14", "wk-p", "巡逻 #1")
        assert calls[0][1].startswith("[POLY·POLY-14·patrol] 巡逻 #1")
        assert "GW_COMMENT" in CONFIG.events_path.read_text(encoding="utf-8")

    def test_worker_key打不进patrol面(self, tmp_config, fake_yt):
        _pin_worker("STUDIO-77", "wk-w")
        with pytest.raises(ytgw.GatewayRefused):
            ytgw.patrol_comment("STUDIO-77", "wk-w", "越面")

    def test_孵化一体_冻结验收_来源署名_记账(self, tmp_config, fake_yt):
        from studio.yt import YT
        yt = YT("agent-8")
        iid = yt.new("POLY", "战役：gw本体", "d", lane="-", typ="战役", state="运行中")
        _pin_patrol(iid, "wk-p")
        kid = ytgw.patrol_derive(iid, "wk-p", "[X] 补文档", "d", lane="-", typ="需求",
                                 track="L2 常规", state="新单", gate="test -f docs/a.md")
        assert yt.f(kid, "验收命令") == "test -f docs/a.md"       # 冻结验收照旧
        assert yt.parents(kid) == [iid]                            # Subtask 链照旧
        assert any(c["text"].startswith(f"[POLY·{iid}·patrol] 来源：战役")
                   for c in yt.comments(kid))
        assert "GW_DERIVE" in CONFIG.events_path.read_text(encoding="utf-8")

    def test_编制三字段请求体ftype不错位(self, tmp_config, fake_yt, requests_mock):
        """POLY-58 实录（STUDIO-103）：派单人在真库是 SimpleIssueCustomField
        （字符串，STUDIO-84 实测 200），patrol_derive 曾误传 SingleEnumIssueCustomField
        → 真库拒写、出生编制降级留痕。假后端只锁字段名不锁 $type（conftest 契约，
        类型错真库 400/500 不等），故在请求体层直接断言三字段 $type，防再错位。"""
        from studio.yt import YT
        yt = YT("agent-8")
        iid = yt.new("POLY", "战役：gw编制", "d", lane="-", typ="战役", state="运行中")
        _pin_patrol(iid, "wk-p")
        kid = ytgw.patrol_derive(iid, "wk-p", "[X] 补文档", "d", lane="-", typ="需求",
                                 track="L2 常规", state="新单", gate="test -f docs/a.md")
        ft = {}
        for r in requests_mock.request_history:   # POST /api/issues/{kid} = set_field 请求
            if r.method == "POST" and r.path.lower() == f"/api/issues/{kid.lower()}":
                for cf in r.json().get("customFields", []):
                    if cf["name"] in ("等级", "部门", "派单人"):   # 同端点还有冻验/父单回写
                        ft[cf["name"]] = cf["$type"]
        assert ft == {"等级": "SimpleIssueCustomField",               # STUDIO-60 实测
                      "部门": "SingleEnumIssueCustomField",
                      "派单人": "SimpleIssueCustomField"}             # STUDIO-84 实测（本单）

    def test_等级违规DeriveRefused原样上抛(self, tmp_config, fake_yt):
        """拒建语义不变：DeriveRefused 由 ytgw 透传，调用方跳过该子单留痕。
        （子等级须严格低于父：父 L2 常规=3，子同级 3≥3 即拒。）"""
        from studio.yt import YT, DeriveRefused
        yt = YT("agent-8")
        iid = yt.new("POLY", "战役：gw违规", "d", lane="-", typ="需求",
                     state="运行中", track="L2 常规")   # 有级别父单（战役=级别无 才豁免）
        _pin_patrol(iid, "wk-p")
        with pytest.raises(DeriveRefused):
            ytgw.patrol_derive(iid, "wk-p", "[X] 越级子单", "d", lane="-", typ="需求",
                               track="L2 常规", state="新单", gate="test -f a")
