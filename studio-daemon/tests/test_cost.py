"""STUDIO-107 单据级 token 成本记账：ask usage 解析 / 事件落账 / 单件成本汇总。
覆盖：ask() 从 --output-format json 的 stdout 解析 usage 落账（LLM 事件）；
reviewed_ask 审查链 acct 穿透；events 汇总 → YouTrack「单件成本」字段
（text 优先 / float 回退 / 评论兜底）。"""
import json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from studio.config import CONFIG                     # noqa: E402
from studio import llm                               # noqa: E402
from studio.metrics import (append_event, ticket_cost, cost_line,   # noqa: E402
                            settle_cost)


class FakeP:
    returncode = 0
    stderr = ""
    stdout = '{"result":"ok"}'


def _ask_ok(monkeypatch, usage=None, cost=None, result="ok"):
    """替身 claude：stdout = --output-format json 的 result 信封（含 usage）。"""
    FakeP.stdout = json.dumps({"type": "result", "result": result,
                               "usage": usage or {}, "total_cost_usd": cost,
                               "duration_ms": 1234, "num_turns": 1})
    monkeypatch.setattr(llm, "_llm_fail_log", lambda *a, **k: None)   # 不写生产日志
    monkeypatch.setattr(llm.subprocess, "run", lambda *a, **k: FakeP())


def _last_event() -> dict:
    return json.loads(CONFIG.events_path.read_text(encoding="utf-8")
                      .strip().splitlines()[-1])


# ---------------- 例1：ask usage 解析 ----------------

def test_ask_usage解析与落账(tmp_config, monkeypatch):
    """acct 给定：usage（input/output/cache）随返回解析入账 LLM 事件。"""
    _ask_ok(monkeypatch, {"input_tokens": 300, "output_tokens": 200,
                          "cache_creation_input_tokens": 100,
                          "cache_read_input_tokens": 5000}, 0.05)
    assert llm.ask("x", acct=("STUDIO", "STUDIO-107", "agent-8")) == "ok"
    ev = _last_event()
    assert ev["event"] == "LLM" and ev["issue"] == "STUDIO-107"
    assert ev["actor"] == "agent-8" and "model=" in ev["note"]
    assert ev["tokens"] == 500                      # input+output（与 worker 三元组同口径）
    assert ev["usage"] == {"input_tokens": 300, "output_tokens": 200,
                           "cache_creation_input_tokens": 100,
                           "cache_read_input_tokens": 5000}
    assert ev["cost_usd"] == 0.05 and ev["duration_ms"] == 1234


def test_ask_无acct不落账(tmp_config, monkeypatch):
    """acct 缺省（老调用形状）：行为不变，不写账本。"""
    _ask_ok(monkeypatch, {"input_tokens": 1, "output_tokens": 2}, 0.01)
    assert llm.ask("x") == "ok"
    assert not CONFIG.events_path.exists()


def test_ask_无usage留白(tmp_config, monkeypatch):
    """CLI 未回 usage（字段漂移/异常形态）：tokens/usage 留白不造零。"""
    _ask_ok(monkeypatch, {}, None)
    assert llm.ask("x", acct=("STUDIO", "T-1", "agent-8")) == "ok"
    ev = _last_event()
    assert "tokens" not in ev and "usage" not in ev and "cost_usd" not in ev


# ---------------- 例2：事件落账通道穿透 ----------------

def test_reviewed_ask_审查链acct穿透(monkeypatch):
    """主稿与 Flash 审查（及重试）全部调用同一 acct——成本不漏归集。"""
    seen = []

    def fake_ask(prompt, timeout=240, **kw):
        seen.append(kw.get("acct"))
        if prompt.startswith("你是语义审查器"):
            return '{"verdict":"pass","issues":[],"corrected":""}'
        return "RAW"

    monkeypatch.setattr(llm, "ask", fake_ask)
    acct = ("STUDIO", "STUDIO-107", "agent-8")
    assert llm.reviewed_ask("任务", acct=acct) == "RAW"
    assert seen == [acct, acct]                     # 主调用 + 审查调用
    seen.clear()
    assert llm.reviewed_ask("任务") == "RAW"         # 缺省不进 kwargs（替身兼容）
    assert seen == [None, None]


def test_parse_directive_acct穿透(monkeypatch):
    seen = []

    def fake_reviewed(p, timeout=240, **kw):
        seen.append(kw.get("acct"))
        return '{"directive":"approve","level":"none","confidence":1}'   # JSON 文本

    monkeypatch.setattr(llm, "reviewed_ask", fake_reviewed)
    out = llm.parse_directive("批准", "ctx", acct=("STUDIO", "T-2", "agent-8"))
    assert out and out["directive"] == "approve"
    assert seen == [("STUDIO", "T-2", "agent-8")]


def test_dod_gen_ticket_id天然归集(monkeypatch):
    """dod_gen/extra_test_gen 从 ticket.id 推 acct（调用方零改动）；无 id 不传。"""
    accts = []

    def fake_ask(prompt, timeout=240, **kw):
        accts.append(kw.get("acct"))
        if prompt.startswith("你是语义审查器"):
            return None                              # 审查失败 → 放行原稿
        return "test -f docs/x.md"

    monkeypatch.setattr(llm, "ask", fake_ask)
    llm.dod_gen({"id": "STUDIO-107", "summary": "s", "description": "d", "fields": {}})
    assert accts[0] == ("STUDIO", "STUDIO-107", "agent-8")
    llm.dod_gen({"summary": "s", "description": "d", "fields": {}})   # 老形状
    assert accts[2] is None


# ---------------- 例3：单件成本汇总与落板 ----------------

def _seed_events(iid: str = "STUDIO-107"):
    """给 iid 造三笔成本账（LLM 岛 + worker 过闸 + worker 退回）+ 一笔他单噪声。"""
    append_event("STUDIO", iid, "LLM", "agent-8", 0, "model=glm-5.3-flash",
                 tokens=500, cost_usd=0.05,
                 usage={"input_tokens": 300, "output_tokens": 200})
    append_event("STUDIO", iid, "GATE_PASS", "agent-8", 0, "evidence x",
                 tokens=54418, cost_usd=16.48, duration_ms=2683795)
    append_event("STUDIO", iid, "GATE_FAIL", "agent-8", 1, "退回重做",
                 tokens=1000, cost_usd=0.5)
    append_event("STUDIO", "STUDIO-999", "LLM", "agent-8", 0, "噪声", tokens=99)


def test_单件成本汇总(tmp_config):
    """LLM 岛 + worker 多 attempt 全部累加到单；他单噪声不混入。"""
    _seed_events()
    c = ticket_cost("STUDIO-107")
    assert c == {"tokens": 500 + 54418 + 1000,        # 55918
                 "cost_usd": round(0.05 + 16.48 + 0.5, 4),
                 "llm_calls": 1, "worker_runs": 2}
    line = cost_line(c)
    assert "tokens=55918" in line and "cost_usd=17.03" in line
    assert "llm_calls=1" in line and "worker_runs=2" in line
    assert ticket_cost("STUDIO-404") == {"tokens": 0, "cost_usd": None,
                                         "llm_calls": 0, "worker_runs": 0}


def test_单件成本落板_字段与events对得上(tmp_config, fake_yt):
    """汇总写 YouTrack「单件成本」字段（157-21）：值即 events 汇总。"""
    from studio.yt import YT
    yt = YT("agent-8")
    iid = yt.new("STUDIO", "成本单", "d", typ="需求", track="L2 常规")
    _seed_events(iid)
    assert settle_cost(yt, iid)["tokens"] == 55918
    v = yt.f(iid, "单件成本")
    assert v and v == cost_line(ticket_cost(iid))    # 字段=events 汇总，逐项对得上
    assert "tokens=55918" in v and "cost_usd=17.03" in v


def test_单件成本落板_float回退(tmp_config):
    """真库字段字型未知（老宪章记 float）：text 写失败 → float 回退只写 cost_usd；
    无 cost 可写（全留白单）→ 评论兜底。"""

    class StubYT:
        def __init__(self):
            self.calls = []

        def set_text(self, iid, name, text):
            raise RuntimeError("incompatible-issue-custom-field-name-单件成本")

        def set_field(self, iid, name, value, ftype):
            self.calls.append(("field", name, value, ftype))
            return {"idReadable": iid}

        def comment(self, iid, text):
            self.calls.append(("comment", text))
            return {"id": 0}

    _seed_events()
    stub = StubYT()
    settle_cost(stub, "STUDIO-107")
    assert stub.calls == [("field", "单件成本", 17.03, "SimpleIssueCustomField")]
    stub2 = StubYT()
    settle_cost(stub2, "STUDIO-404")                # 无任何账记：cost_usd=None
    assert stub2.calls and stub2.calls[0][0] == "comment"
    assert "评论兜底" in stub2.calls[0][1]


def test_单件成本落板_字段缺失评论兜底(tmp_config, fake_yt):
    """项目无该字段（假库 500 形态）：不炸链，评论兜底留痕。"""
    from studio.yt import YT
    fake_yt.field_types.pop("单件成本")
    yt = YT("agent-8")
    iid = yt.new("STUDIO", "缺字段单", "d", typ="需求", track="L2 常规")
    _seed_events(iid)
    settle_cost(yt, iid)
    cs = [c["text"] for c in yt.comments(iid)]
    assert any(t.startswith("单件成本（字段不可用，评论兜底）：tokens=55918") for t in cs)


def test_时间线附tokens与COST合计(tmp_config):
    """面板 /api/timeline：事件附 tokens，末尾 COST 合计行（STUDIO-107）。"""
    from fastapi.testclient import TestClient
    from studio.web import app
    _seed_events()
    cli = TestClient(app, base_url="http://127.0.0.1:8787")   # Host 白名单姿势同 test_web
    r = cli.get("/api/timeline/STUDIO-107")
    assert r.status_code == 200
    rows = r.json()
    cost = [x for x in rows if x["kind"] == "COST"]
    assert cost and cost[0]["tokens"] == 55918
    assert "tokens=55918" in cost[0]["detail"] and "cost_usd=17.03" in cost[0]["detail"]
    assert any(x.get("tokens") == 500 for x in rows)     # LLM 事件带 tokens
    rows999 = [x for x in cli.get("/api/timeline/STUDIO-404").json()
               if x["kind"] == "COST"]
    assert rows999 == []                                  # 无成本单不造合计行


def test_日报按单归集成本(tmp_config):
    from studio.reports import _cost_notes, _events_all
    _seed_events()
    evs = _events_all()
    notes = _cost_notes(evs)
    assert any(n.startswith("- STUDIO-107：tokens=55918 cost_usd=17.03") for n in notes)
    assert notes[-1].startswith("- 合计：tokens=56017")      # 55918+99 噪声也入合计
