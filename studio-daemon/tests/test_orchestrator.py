"""orchestrator v2：全流程闭环（假YouTrack + 真git + 假claude工人）。
覆盖：L0 全自动、L2 两批、批示位置语义、复验退回、重派分支复用、approve-merge 必须真合并。"""
import subprocess, sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from studio import orchestrator as orch
from studio.config import CONFIG
from studio.workers import Worker
from studio.yt import YT


@pytest.fixture
def env(fake_yt, lanes, monkeypatch):
    """假claude：launch 只登记（分支/REPORT由 simulate_worker 造）；dod/加测固定。"""
    from studio import llm
    monkeypatch.setattr(llm, "dod_gen",
                        lambda t: "test -f docs/out.md && grep -q 关键 docs/out.md")
    monkeypatch.setattr(llm, "extra_test_gen", lambda t, g: "test -f docs/out.md")

    def fake_launch(self, ticket, lane=None):
        self.reg.parent.mkdir(parents=True, exist_ok=True)
        self.reg.write_text(__import__("json").dumps(
            {"issue": self.issue, "pid": -1, "lane": lane or "core",
             "branch": f"feature/{self.issue}", "repo": CONFIG.lane(lane or "core")["path"],
             "report": str(self.report), "stream": str(self.stream),
             "started": "test"}))
        return -1
    monkeypatch.setattr(Worker, "launch", fake_launch)

    def fake_status(self):
        if self.report.exists():
            return f"DONE {self.report}"
        if not self.reg.exists():
            done = CONFIG.workers_dir / f"{self.issue}.done.json"
            return "ARCHIVED" if done.exists() else "UNKNOWN"
        return "RUNNING -1 0min"
    monkeypatch.setattr(Worker, "status", fake_status)

    yt = YT("agent-pm")
    yt._backend = fake_yt          # 供 fake_comment 以任意身份直写（opengames 批示模拟）
    return yt


def simulate_worker(yt, iid, lanes, ok=True):
    """假claude干活：在 feature 分支提交产物 + 写REPORT（每轮内容唯一，避免 nothing to commit）。"""
    import time as _t
    repo = Path(CONFIG.lane("core")["path"])
    subprocess.run(["git", "-C", str(repo), "checkout", f"feature/{iid}"],
                   check=True, capture_output=True)
    out = repo / "docs" / "out.md"
    stamp = _t.time_ns()
    out.write_text(f"# ok\n关键\n{stamp}\n" if ok else f"# 空的\n{stamp}\n", encoding="utf-8")
    subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-m", f"feat({iid}): x"],
                   check=True, capture_output=True)
    w = Worker(iid)
    w.report.parent.mkdir(parents=True, exist_ok=True)
    w.report.write_text(f"WORKER REPORT {iid}\n身份: agent-dev\n分支: feature/{iid}\n", encoding="utf-8")


def state(yt, iid):
    return yt.f(iid, "State")


class TestL0全自动:
    def test_建单到交付_零审批(self, env, lanes):
        yt = env
        iid = yt.new("POLY", "L0单", "d", lane="core", typ="需求", track="L0 自动")
        assert orch.pm_tick()["actions"] == [f"DISPATCH {iid} lane=core"]
        assert state(yt, iid) == "已派发"
        simulate_worker(yt, iid, lanes)
        assert "HARVEST" in orch.pm_tick()["actions"][0]
        assert state(yt, iid) == "证据就绪"
        assert "VERIFY-OK" in orch.pm_tick()["actions"][0]
        assert state(yt, iid) == "复验通过"
        assert "DELIVERED" in orch.pm_tick()["actions"][0]
        assert state(yt, iid) == "已交付"
        repo = Path(CONFIG.lane("core")["path"])
        log = subprocess.run(["git", "-C", str(repo), "log", "--oneline", "-3"],
                             capture_output=True, text=True).stdout
        assert f"merge({iid})" in log            # 真合并发生


class TestL2两批:
    def _to_waiting(self, env, lanes):
        iid = env.new("POLY", "L2单", "d", lane="core", typ="需求", track="L2 常规")
        r = orch.pm_tick()
        assert state(env, iid) == "待批"          # 第一批：立项
        return iid

    def test_立项批后派发(self, env, lanes):
        yt = env
        iid = self._to_waiting(env, lanes)
        fake_yt_backend_comment(yt, iid, "opengames", "approve-plan")
        r = orch.pm_tick()
        assert "APPROVED" in r["actions"][0]           # 批示拍：翻状态
        assert state(yt, iid) == "已派发"
        assert "DISPATCH" in orch.pm_tick()["actions"][0]   # 派发拍：拉工人

    def test_approve_merge_必须真合并(self, env, lanes):
        yt = env
        iid = self._to_waiting(env, lanes)
        fake_yt_backend_comment(yt, iid, "opengames", "approve-plan")
        orch.pm_tick(); orch.pm_tick(); simulate_worker(yt, iid, lanes)
        orch.pm_tick(); orch.pm_tick()            # harvest + verify → 复验通过
        assert state(yt, iid) == "复验通过"
        r = orch.pm_tick()
        assert state(yt, iid) == "待批"           # 第二批：合并审
        fake_yt_backend_comment(yt, iid, "opengames", "approve-merge")
        orch.pm_tick()
        assert state(yt, iid) == "已交付"
        repo = Path(CONFIG.lane("core")["path"])
        log = subprocess.run(["git", "-C", str(repo), "log", "--oneline"],
                             capture_output=True, text=True).stdout
        assert f"merge({iid})" in log, "approve-merge 必须产生真实 merge commit"


def fake_yt_backend_comment(yt, iid, author, text):
    """以任意身份直写假后端评论（模拟 opengames 批示）。"""
    yt._backend.issues[iid]["comments"].append(
        {"author": author, "text": text, "created": 999})


class Test复验退回与重派:
    def test_gate_fail_退回后重派_分支复用(self, env, lanes):
        yt = env
        iid = yt.new("POLY", "r", "d", lane="core", typ="需求", track="L0 自动")
        orch.pm_tick()
        simulate_worker(yt, iid, lanes, ok=False)     # 产物不含关键词 → gate 红
        r = orch.pm_tick()
        assert "GATE-FAIL" in r["actions"][0]
        assert state(yt, iid) == "已派发"             # 退回重做（attempt+1）
        # 下轮重派：分支已存在，必须 checkout 复用而不是 checkout -b 报错
        r2 = orch.pm_tick()
        assert any(a.startswith("DISPATCH") for a in r2["actions"]), r2
        simulate_worker(yt, iid, lanes, ok=True)
        orch.pm_tick(); orch.pm_tick(); orch.pm_tick()
        assert state(yt, iid) == "已交付"


class Test断路:
    def test_attempt3_冻结待批(self, env, lanes, monkeypatch):
        yt = env
        iid = yt.new("POLY", "b", "d", lane="core", typ="需求", track="L0 自动")
        for _ in range(3):
            orch.pm_tick()                             # 派发
            simulate_worker(yt, iid, lanes, ok=False)  # 每次都红
            orch.pm_tick()                             # harvest fail
        # 第三次失败断路：L0 无待批位 → 冻结在已派发，@制作人，不再自动重派
        assert state(yt, iid) == "已派发"
        assert int(yt.f(iid, "attempt") or 0) >= 3
        r = orch.pm_tick()
        assert not any(a.startswith("DISPATCH") for a in r["actions"]), r
        assert any("BREAK" in a for a in r["actions"]), r
