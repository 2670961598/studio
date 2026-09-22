"""self_eval 查重回归：09-21/09-22 两天 except:pass 静默吞错，连刷 4 张重复草稿。
契约：查重不可用（连败）→ 停建单 + 事件留痕；首败重试成活 → 照常查重。"""
import json, sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from studio import metrics
from studio.config import CONFIG


M = {"gate_fail_rate": .5, "gate_fail": 5, "gate_pass": 5, "qa_back_rate": 0, "qa_back": 0,
     "breaker_hits": 0, "stall": 0, "window_days": 7, "recent": []}


def _seed_open_draft(yt):
    yt.new("STUDIO", "[自评] 闸门失败率 55%（11/20）——检查 DoD 生成质量与 worker 任务书模板",
           "d", lane=None, typ="提案", track="G1 知识", state="草稿")


class TestSelfEvalDedup:
    def test_同模式草稿在板_不重复建单(self, fake_yt, monkeypatch):
        from studio.yt import YT
        yt = YT("agent-pm")
        _seed_open_draft(yt)
        monkeypatch.setattr(metrics, "compute", lambda d: dict(M))
        assert metrics.self_eval()["drafts"] == []

    def test_查重连败_停建单并留痕(self, fake_yt, monkeypatch, requests_mock):
        from studio.yt import YT
        yt = YT("agent-pm")
        _seed_open_draft(yt)
        monkeypatch.setattr(metrics, "compute", lambda d: dict(M))
        requests_mock.get(f"{CONFIG.yt_url}/api/issues", exc=ConnectionError("stale pool"))
        rep = metrics.self_eval()
        assert rep["drafts"] == [], "查重不可用时不得建单（漏报由巡检兜底）"
        evs = [json.loads(l) for l in CONFIG.events_path.read_text().splitlines()]
        assert any("查重查询失败本轮不建单" in e.get("note", "") for e in evs), evs

    def test_首败重试成活_照常查重(self, fake_yt, monkeypatch, requests_mock):
        from studio.yt import YT
        yt = YT("agent-pm")
        _seed_open_draft(yt)
        monkeypatch.setattr(metrics, "compute", lambda d: dict(M))
        st = {"n": 0}

        def flaky(request, ctx):
            st["n"] += 1
            if st["n"] == 1:
                raise ConnectionError("stale keep-alive")
            return fake_yt.query(request.qs.get("query", [""])[0])
        requests_mock.get(f"{CONFIG.yt_url}/api/issues", json=flaky)
        assert metrics.self_eval()["drafts"] == []
        assert st["n"] == 2, "必须恰好重试一次"
