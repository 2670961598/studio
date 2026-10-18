"""STUDIO-112 制作人门户：/api/dashboard（概览）、/api/dashboard/{pid}（项目聚合）、
/api/report/{name}（报告正文）——数据必须真接 events.jsonl/reports 留底/板面，不写死。"""
import json
import time
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from studio import web
from studio.config import CONFIG

TODAY = time.strftime("%F")


@pytest.fixture
def client(tmp_config):
    return TestClient(web.app, base_url="http://127.0.0.1:8787")


def _ev(pid, issue, event, ts, **kw):
    return {"ts": ts, "pid": pid, "issue": issue, "event": event,
            "actor": "t", "attempt": 0, **kw}


def _write_events(rows):
    CONFIG.events_path.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")


def _write_report(name, md="# 报告\n正文"):
    d = CONFIG.events_path.parent / "reports"
    d.mkdir(parents=True, exist_ok=True)
    (d / name).write_text(md, encoding="utf-8")


def test_项目仪表盘聚合(client, fake_yt):
    fake_yt.counters["GAMES"] = 0                      # 假库默认只预置 POLY/STUDIO 计数
    s1 = fake_yt.create("STUDIO", "在途单", "d", {"State": "已派发", "Type": "需求"})
    s2 = fake_yt.create("STUDIO", "待批单", "d", {"State": "待批", "Type": "需求"})
    fake_yt.create("GAMES", "别项目的单", "d", {"State": "已派发"})   # 不得串项目
    _write_events([
        _ev("STUDIO", "STUDIO-1", "DISPATCH", f"{TODAY} 09:00:00", tokens=1000, cost_usd=0.1),
        _ev("STUDIO", "STUDIO-1", "MERGE", f"{TODAY} 10:00:00"),
        _ev("STUDIO", "STUDIO-2", "GATE_FAIL", f"{TODAY} 11:00:00"),
        _ev("GAMES", "GAMES-1", "DISPATCH", f"{TODAY} 09:30:00", tokens=9999, cost_usd=9.9),
    ])
    _write_report(f"daily-{TODAY}.md", "# 工作室运营日报\n指标行")
    _write_report("games-2026-01-01.md", "# GAMES 专岗")             # 归属 GAMES，不进 STUDIO

    r = client.get("/api/dashboard/STUDIO")
    assert r.status_code == 200
    d = r.json()
    ids = [b["id"] for b in d["board"]]
    assert ids == sorted([s1, s2]) and all("yt" in b for b in d["board"])
    assert d["queue"] == 2 and d["counts"]["已派发"] == 1
    assert d["today"]["deliver"] == 1 and d["today"]["dispatch"] == 1
    assert d["today"]["delivered"][0]["issue"] == "STUDIO-1"
    # 趋势 14 日窗口、末日只含本项目的三类事件
    assert len(d["series"]) == 14
    last = d["series"][-1]
    assert (last["dispatch"], last["close"], last["gate_fail"]) == (1, 1, 1)
    assert last["tokens"] == 1000 and last["cost_usd"] == 0.1
    # 成本 7 日合计按项目隔离；按单 TOP 归集
    assert d["cost"]["d7"]["tokens"] == 1000
    assert d["cost"]["d30"]["cost_usd"] == pytest.approx(0.1)
    assert d["cost"]["top"][0]["issue"] == "STUDIO-1"
    # 报告清单只收本项目前缀
    names = [x["name"] for x in d["reports"]]
    assert f"daily-{TODAY}.md" in names and "games-2026-01-01.md" not in names


def test_项目隔离_GAMES(client, fake_yt):
    _write_events([_ev("GAMES", "GAMES-1", "CLOSE", f"{TODAY} 12:00:00", tokens=5)])
    d = client.get("/api/dashboard/GAMES").json()
    assert d["today"]["deliver"] == 1 and d["series"][-1]["tokens"] == 5
    _write_report("games-2026-02-02.md")
    assert any(x["kind"] == "games" for x in d["reports"]) or d["reports"] == []


def test_未知项目404(client, fake_yt):
    assert client.get("/api/dashboard/NOPE").status_code == 404


def test_板面不可达时降级不炸(client, tmp_config, monkeypatch):
    """无 fake_yt（真 YT 不可达）：board 空 + board_err 留痕，其余面板照常出数。"""
    import studio.web as W

    def boom(pid):
        raise RuntimeError("yt down")
    monkeypatch.setattr(W, "_dash_board", boom)
    _write_events([_ev("STUDIO", "STUDIO-1", "CLOSE", f"{TODAY} 08:00:00")])
    r = client.get("/api/dashboard/STUDIO")
    assert r.status_code == 200
    d = r.json()
    assert d["board"] == [] and "RuntimeError" in d["board_err"]
    assert d["today"]["deliver"] == 1


def test_概览三卡与收件箱(client, fake_yt):
    fake_yt.counters["GAMES"] = 0
    g1 = fake_yt.create("GAMES", "等制作人批", "d", {"State": "待批", "Type": "需求"})
    p1 = fake_yt.create("POLY", "已派发单", "d", {"State": "已派发"})
    st1 = fake_yt.create("STUDIO", "[自评] 提案", "d", {"State": "草稿", "Type": "提案"})
    _write_events([_ev("POLY", p1, "MERGE", f"{TODAY} 15:00:00", tokens=10, cost_usd=0.01)])

    r = client.get("/api/dashboard")
    assert r.status_code == 200
    d = r.json()
    assert [p["pid"] for p in d["projects"]] == ["STUDIO", "GAMES", "POLY", "SNEXT"]
    poly = [p for p in d["projects"] if p["pid"] == "POLY"][0]
    assert poly["today_deliver"] == 1 and poly["cost7"]["tokens"] == 10
    assert len(poly["spark"]) == 7
    inbox_ids = [x["id"] for x in d["inbox"]]
    assert g1 in inbox_ids and st1 in inbox_ids              # 待批 + 提案草稿
    assert p1 not in inbox_ids                                # 已派发不打扰制作人
    assert all(x["yt"] for x in d["inbox"])


def test_报告正文与防穿越(client, tmp_config):
    _write_report(f"daily-{TODAY}.md", "# 工作室运营日报\n指标行")
    r = client.get(f"/api/report/daily-{TODAY}.md")
    assert r.status_code == 200 and "运营日报" in r.json()["content"]
    assert r.json()["kind"] == "daily"
    assert client.get("/api/report/../../../etc/passwd").status_code in (404, 301)
    assert client.get("/api/report/daily-evil.md").status_code == 404
    assert client.get("/api/report/nope.md").status_code == 404
