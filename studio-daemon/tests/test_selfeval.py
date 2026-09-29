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


class Test打回自动复盘:
    """STUDIO-43：QA 打回/断路单自动沉淀四段复盘进知识库——人类反馈回流断链补齐。"""

    def test_打回触发复盘并标记防重(self, fake_yt, tmp_config, monkeypatch):
        import json as _json, time as _t
        from studio.yt import YT
        from studio import metrics as M
        yt = YT("agent-pm")
        iid = yt.new("POLY", "被退单", "d", lane="games", typ="需求", track="L2 常规")
        ts = _t.strftime("%F %T")
        CONFIG.events_path.write_text("\n".join(_json.dumps(
            {"ts": ts, "pid": "POLY", "issue": iid, "event": "QA_BACK",
             "actor": "a", "attempt": 1, "note": "x"}, ensure_ascii=False) for _ in range(2)) + "\n",
            encoding="utf-8")
        from studio import llm as _llm
        monkeypatch.setattr(_llm, "reviewed_ask",
                            lambda prompt, timeout=400: "## 现象\n闸门复跑失败缺关键词段\n## 根因\n任务书未强调\n## 解法\n模板提醒\n## 预防\n注入复盘"
## 根因
## 解法
## 预防
                            )
        # self_eval 会走完整流程——直测 _postmortem_scan
        done = M._postmortem_scan(yt, M._events(7))
        assert done == [iid]
        assert any(c["text"].startswith("复盘已沉淀") for c in yt.comments(iid))
        # 再扫：标记防重
        assert M._postmortem_scan(yt, M._events(7)) == []

    def test_岛失败静默跳过(self, fake_yt, tmp_config, monkeypatch):
        from studio.yt import YT
        from studio import metrics as M
        import json as _json, time as _t
        yt = YT("agent-pm")
        iid = yt.new("POLY", "岛失败单", "d", lane="games", typ="需求", track="L2 常规")
        CONFIG.events_path.write_text(_json.dumps(
            {"ts": _t.strftime("%F %T"), "pid": "POLY", "issue": iid, "event": "QA_BACK",
             "actor": "a", "attempt": 1, "note": ""}, ensure_ascii=False) + "\n", encoding="utf-8")
        from studio import llm as _llm
        monkeypatch.setattr(_llm, "reviewed_ask", lambda p, timeout=400: None)
        assert M._postmortem_scan(yt, M._events(7)) == []      # 不炸、不开单
