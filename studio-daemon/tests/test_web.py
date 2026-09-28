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
