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
    """以任意身份直写假后端评论（模拟 opengames 批示；单调时间戳保证排序）。"""
    yt._backend.issues[iid]["comments"].append(
        {"author": author, "text": text, "created": yt._backend.now_ms()})


class TestBase前进自愈:
    def _hotfix_on_base(self, lanes, path="hotfix.txt", content="框架热修\n"):
        repo = Path(CONFIG.lane("core")["path"])
        base = CONFIG.lane("core")["base_branch"]
        subprocess.run(["git", "-C", str(repo), "checkout", base],
                       check=True, capture_output=True)
        (repo / path).write_text(content, encoding="utf-8")
        subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(repo), "commit", "-m", "hotfix: base 前进"],
                       check=True, capture_output=True)

    def test_热修入base_收割自动同步合并非飞线(self, env, lanes):
        """框架热修直入 base（不经 feature）后收割：自动同步合并放行，不退回。"""
        yt = env
        iid = yt.new("POLY", "h", "d", lane="core", typ="需求", track="L0 自动")
        orch.pm_tick()                              # 派发
        simulate_worker(yt, iid, lanes)             # worker 完成，feature 领先
        self._hotfix_on_base(lanes)                 # base 期中前进（与 feature 无冲突）
        r = orch.pm_tick()
        assert any(a.startswith("HARVEST") for a in r["actions"]), r
        repo = Path(CONFIG.lane("core")["path"])
        mb = subprocess.run(["git", "-C", str(repo), "merge-base", "--is-ancestor",
                             CONFIG.lane("core")["base_branch"], f"feature/{iid}"],
                            capture_output=True)
        assert mb.returncode == 0, "同步合并后 base 必须重新成为 feature 祖先"

    def test_同步合并真冲突_仍按飞线退回(self, env, lanes):
        """base 改了 feature 也改的文件且内容冲突：merge --abort，ORPHAN 退回。"""
        yt = env
        iid = yt.new("POLY", "c", "d", lane="core", typ="需求", track="L0 自动")
        orch.pm_tick()
        simulate_worker(yt, iid, lanes)
        # 热修改 docs/out.md 本体（worker 也改了它 → 内容冲突）
        self._hotfix_on_base(lanes, path="docs/out.md", content="# base 改的\n没关键词\n")
        r = orch.pm_tick()
        assert any(a.startswith("ORPHAN") for a in r["actions"]), r
        assert state(yt, iid) == "已派发"           # 退回重做位
        dirty = subprocess.run(["git", "-C", str(Path(CONFIG.lane('core')['path'])),
                                "status", "--porcelain"], capture_output=True, text=True).stdout
        assert not dirty.startswith("UU"), "冲突必须被 abort 干净"


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


class Test断路恢复:
    def test_制作人批准后_attempt清零_不再振荡(self, env, lanes):
        """盲区2：断路→待批→approve-plan→必须真派发而不是弹回待批。"""
        yt = env
        iid = yt.new("POLY", "L2断路恢复", "d", lane="core", typ="需求", track="L2 常规")
        fake_yt_backend_comment(yt, iid, "opengames", "approve-plan")
        orch.pm_tick(); orch.pm_tick(); orch.pm_tick()   # 新单→待批 / 批示拍 / 派发拍
        assert state(yt, iid) == "已派发"
        for _ in range(3):                       # 三连红到断路
            simulate_worker(yt, iid, lanes, ok=False)
            orch.pm_tick()
        assert state(yt, iid) == "待批" and int(yt.f(iid, "attempt") or 0) >= 3
        fake_yt_backend_comment(yt, iid, "opengames", "approve-plan")   # 制作人再给机会
        r = orch.pm_tick()
        assert any("APPROVED" in a for a in r["actions"]), r
        assert int(yt.f(iid, "attempt") or 0) == 0, "批准必须清零断路计数"
        r2 = orch.pm_tick()
        assert any(a.startswith("DISPATCH") for a in r2["actions"]), r2  # 真派发而非振荡
        assert state(yt, iid) == "已派发"


class TestMerge冲突自愈:
    def test_冲突残局_下轮隔离并退回(self, env, lanes):
        """盲区1：merge 冲突中断留下 unmerged index → 下轮 reset 自愈、单有归宿。"""
        yt = env
        iid = yt.new("POLY", "冲突单", "d", lane="core", typ="需求", track="L0 自动")
        orch.pm_tick()
        simulate_worker(yt, iid, lanes)          # 改 docs/out.md
        repo = Path(CONFIG.lane("core")["path"])
        # base 上制造同文件冲突提交
        subprocess.run(["git", "-C", str(repo), "checkout", "main"], check=True, capture_output=True)
        (repo / "docs" / "out.md").write_text("# base 冲突版本\n", encoding="utf-8")
        subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(repo), "commit", "-m", "base move"],
                       check=True, capture_output=True)
        # 推到 复验通过 → 触发 merge（会冲突）
        orch.pm_tick(); orch.pm_tick()           # harvest→证据就绪→复验通过
        orch.pm_tick()                           # merge 尝试（冲突 → 异常被吞或失败路径）
        dirty = subprocess.run(["git", "-C", str(repo), "status", "--porcelain"],
                               capture_output=True, text=True).stdout
        if dirty.strip():
            # 冲突残局存在：下一轮 pm_tick 必须能自愈（reset 隔离）
            orch2 = orch.pm_tick()
            dirty2 = subprocess.run(["git", "-C", str(repo), "status", "--porcelain"],
                                    capture_output=True, text=True).stdout
            assert not dirty2.strip(), f"残局未自愈: {dirty2}"
        # 无论冲突与否，单据不允许漂在空中
        st = state(yt, iid)
        assert st in ("已交付", "已派发", "复验通过"), st
