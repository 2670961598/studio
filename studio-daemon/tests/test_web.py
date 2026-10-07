"""web：端点冒烟 + 调度器未运行时的安全降级。"""
import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from fastapi.testclient import TestClient
from studio import web
from studio.config import CONFIG


@pytest.fixture
def client(tmp_config):
    return TestClient(web.app, base_url="http://127.0.0.1:8787")


def test_根页面(client):
    r = client.get("/")
    assert r.status_code == 200 and "vue.global.prod.js" in r.text


def test_schema_api(client, fake_yt):
    g = fake_yt.article_create("STUDIO", "全局", "")       # 父节点
    fake_yt.article_create("STUDIO", "团队公约", "# 团队公约 —— 名册与红线", parent=g)
    b = fake_yt.article_create("STUDIO", "编制", "")
    fake_yt.article_create("STUDIO", "worker", "# 执行层 worker 档案", parent=b)
    r = client.get("/api/schema")
    assert r.status_code == 200
    d = r.json()
    assert set(d["types"]) >= {"需求", "提案", "战役", "疑问"}
    assert "团队公约" in d["team"]                          # 公约自 Articles 拉取（STUDIO-13）
    assert d["agents_kb"].get("worker", "").startswith("# 执行层")


def test_jobs_无调度器时安全(client):
    assert client.get("/api/jobs").json() == []


def test_runs_空(client):
    assert client.get("/api/runs").json() == []


def test_transcript_404(client):
    assert client.get("/api/transcript/NOPE-1").status_code == 404


def test_job_ctl_未知job_404(client, monkeypatch):
    monkeypatch.setenv("STUDIO_PANEL_TOKEN", "pt-test-123")
    assert client.post("/api/jobs/nope/trigger",
                       headers={"X-Studio-Token": "pt-test-123"}).status_code in (404, 503)


class TestCSRF与脱敏:
    """审计 P2/P3：POST 令牌防线 + 对话流/worker 数据 token 脱敏。"""

    def test_POST无令牌403_有令牌过闸(self, client, monkeypatch):
        monkeypatch.setenv("STUDIO_PANEL_TOKEN", "pt-test-123")
        r = client.post("/api/jobs/pm-poly/pause")
        assert r.status_code == 403 and r.json()["error"] == "bad token"
        r2 = client.post("/api/jobs/pm-poly/pause", headers={"X-Studio-Token": "pt-test-123"})
        assert r2.status_code == 503            # 过了闸，路由内因调度器未运行 503

    def test_跨站GET也拒_防读token后二段攻击(self, client):
        r = client.get("/api/token", headers={"Sec-Fetch-Site": "cross-site"})
        assert r.status_code == 403
        assert client.get("/api/token").status_code == 200

    def test_workers与transcript脱敏(self, client, tmp_path):
        import json as _json
        (CONFIG.workers_dir / "W-1.json").write_text(_json.dumps(
            {"issue": "W-1", "pid": -1,
             "branch": "perm-abc123def456ghi789jkl012mno"}), encoding="utf-8")
        w = client.get("/api/workers").json()
        assert "perm-abc123" not in str(w) and "REDACTED" in str(w)


def test_restart端点写drain(client, monkeypatch):
    monkeypatch.setenv("STUDIO_PANEL_TOKEN", "pt-test-123")
    from studio import orchestrator as orch
    r = client.post("/api/restart", headers={"X-Studio-Token": "pt-test-123"})
    assert r.json()["ok"] == "draining"
    assert (CONFIG.locks_dir / "drain.json").exists()
    st = client.get("/api/state").json()
    assert st["draining"] is True and "in_flight" in st
    (CONFIG.locks_dir / "drain.json").unlink()


class Test接管续聊:
    """STUDIO-47B：worker 会话可接管——claude --resume <session_id>（制作人手动继续某次对话）。"""

    def test_有session返回接管命令(self, client):
        import json as _json
        (CONFIG.workers_dir / "W-7.done.json").write_text(_json.dumps(
            {"issue": "W-7", "repo": "/tmp/r", "result": {"session_id": "sid-123"}}), encoding="utf-8")
        r = client.get("/api/resume-cmd/W-7").json()
        assert r["session_id"] == "sid-123"
        assert r["cmd"] == 'cd "/tmp/r" && claude --resume sid-123'

    def test_无记录404_旧归档无session(self, client):
        import json as _json
        assert client.get("/api/resume-cmd/NOPE-9").status_code == 404
        (CONFIG.workers_dir / "W-8.done.json").write_text(_json.dumps(
            {"issue": "W-8", "result": {}}), encoding="utf-8")
        r = client.get("/api/resume-cmd/W-8").json()
        assert r["cmd"] == "" and "session_id" in r

    def test_终端唤起失败回落复制(self, client, monkeypatch):
        import json as _json
        monkeypatch.setenv("STUDIO_PANEL_TOKEN", "pt-t")
        (CONFIG.workers_dir / "W-9.done.json").write_text(_json.dumps(
            {"issue": "W-9", "repo": "/tmp/r", "result": {"session_id": "s9"}}), encoding="utf-8")
        import subprocess as _sp
        monkeypatch.setattr(_sp, "run",
                            lambda *a, **k: _sp.CompletedProcess([], 1, "", "busy"))
        r = client.post("/api/resume-terminal/W-9",
                        headers={"X-Studio-Token": "pt-t"}).json()
        assert r["ok"] is False and "复制命令" in r["note"] and "claude --resume s9" in r["note"]


def test_时间线聚合(client):
    """STUDIO-42：events+worker 记账按单聚合，排序输出，脱敏。"""
    import json as _json
    CONFIG.events_path.write_text(
        _json.dumps({"ts": "2026-09-29 10:00:00", "pid": "G", "issue": "T-99",
                     "event": "DISPATCH", "actor": "a", "attempt": 0, "note": "lane=games"}) + "\n" +
        _json.dumps({"ts": "2026-09-29 11:00:00", "pid": "G", "issue": "T-99",
                     "event": "GATE_PASS", "actor": "a", "attempt": 0, "note": "ev x",
                     "cost_usd": 2.5, "duration_ms": 60000}) + "\n", encoding="utf-8")
    (CONFIG.workers_dir / "T-99.done.json").write_text(_json.dumps(
        {"issue": "T-99", "started": "2026-09-29 09:00:00", "branch": "feature/T-99",
         "result": {"cost_usd": 2.5, "duration_ms": 60000, "turns": 7}}), encoding="utf-8")
    r = client.get("/api/timeline/T-99").json()
    kinds = [x["kind"] for x in r]
    assert kinds == ["WORKER", "DISPATCH", "GATE_PASS"]      # 按时间排序
    assert r[0]["cost_usd"] == 2.5 and r[0]["turns"] == 7
    assert client.get("/api/timeline/NONE-1").json() == []


class TestYouTrack网关:
    """制作人 2026-09-29 定则：agent 用 YouTrack 必经框架——worker 持派单签发的 wkey，
    网关白名单放行（comment/heartbeat/article）+ 署名自动注入 [项目·单号·worker] + 记账；
    无 key/错 key/白名单外动作一律 403。worker 从此不持有任何 token。"""

    def _wreg(self, iid="W-77"):
        import json as _json
        f = CONFIG.workers_dir / f"{iid}.json"
        f.write_text(_json.dumps({"issue": iid, "pid": -1, "wkey": "k77"}), encoding="utf-8")
        return iid

    def test_错key与无key拒(self, client):
        iid = self._wreg()
        assert client.post("/api/yt/comment", json={"iid": iid, "key": "bad", "text": "x"}).status_code == 403
        assert client.post("/api/yt/comment", json={"iid": iid, "text": "x"}).status_code == 403

    def test_评论署名注入(self, client, fake_yt, monkeypatch):
        from studio import web as _w
        from studio.yt import YT
        iid = self._wreg()
        calls = []
        monkeypatch.setattr(YT, "comment", lambda self, i, t: calls.append((i, t)))
        r = client.post("/api/yt/comment", json={"iid": iid, "key": "k77", "text": "阶段完成"}).json()
        assert r["ok"] and r["signed"]
        assert calls and calls[0][1].startswith("[W·W-77·worker] 阶段完成")

    def test_心跳放行(self, client, fake_yt, monkeypatch):
        from studio.yt import YT
        iid = self._wreg()
        calls = []
        monkeypatch.setattr(YT, "heartbeat", lambda self, i: calls.append(i))
        assert client.post("/api/yt/heartbeat", json={"iid": iid, "key": "k77"}).json()["ok"]
        assert calls == [iid]

    def test_状态推进不在白名单(self, client):
        """网关无 transition/set_field 端点——状态推进只归 daemon（状态是唯一控制面焊死）。"""
        import requests as _rq
        assert client.post("/api/yt/transition", json={}).status_code in (404, 405)

    def test_kb检索命中与未命中(self, client, fake_yt):
        """STUDIO-101 知识检索：标题/正文含 q 命中 top5（excerpt≤200、标题命中排前）；
        未命中 200 空数组——只读端点，空结果不是错误。"""
        iid = self._wreg()
        g = fake_yt.article_create("W", "手册", "")
        fake_yt.article_create("W", "worker", "# 执行层档案\n干活先过验证闸。", parent=g)
        fake_yt.article_create("W", "无关", "别的内容")
        r = client.get("/api/yt/kb-search",
                       params={"iid": iid, "key": "k77", "q": "验证闸"}).json()
        assert r["ok"] and r["project"] == "W"
        assert [x["path"] for x in r["results"]] == ["手册/worker"]   # 标题未中、正文中
        assert len(r["results"][0]["excerpt"]) <= 200 and "验证闸" in r["results"][0]["excerpt"]
        r2 = client.get("/api/yt/kb-search",
                        params={"iid": iid, "key": "k77", "q": "不存在的词"}).json()
        assert r2["ok"] and r2["results"] == []

    def test_kb检索缺key错key拒(self, client, fake_yt):
        """wkey 缺失/错误一律 403——GET 无 body，凭证走查询串，门就是 wkey 本身。"""
        iid = self._wreg()
        assert client.get("/api/yt/kb-search", params={"iid": iid, "q": "x"}).status_code == 403
        assert client.get("/api/yt/kb-search",
                          params={"iid": iid, "key": "bad", "q": "x"}).status_code == 403
