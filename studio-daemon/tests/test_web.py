"""web：端点冒烟 + 调度器未运行时的安全降级。"""
import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from fastapi.testclient import TestClient
from studio import web


@pytest.fixture
def client(tmp_config):
    return TestClient(web.app, base_url="http://127.0.0.1:8787")


def test_根页面(client):
    r = client.get("/")
    assert r.status_code == 200 and "vue.global.prod.js" in r.text


def test_schema_api(client):
    r = client.get("/api/schema")
    assert r.status_code == 200
    d = r.json()
    assert set(d["types"]) >= {"需求", "提案", "战役", "疑问"}
    assert "五族" in d["team"] or "团队公约" in d["team"]


def test_jobs_无调度器时安全(client):
    assert client.get("/api/jobs").json() == []


def test_runs_空(client):
    assert client.get("/api/runs").json() == []


def test_transcript_404(client):
    assert client.get("/api/transcript/NOPE-1").status_code == 404


def test_job_ctl_未知job_404(client):
    assert client.post("/api/jobs/nope/trigger").status_code in (404, 503)
