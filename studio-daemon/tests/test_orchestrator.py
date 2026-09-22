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


class Test复验竞态防护:
    """GAMES-5/6 事故（09-22）回归：复验与活 worker 抢共享树，闸门跑在别人分支上 4 连误红退回。"""

    def test_泳道忙_复验顺延不烧attempt(self, env, lanes):
        from studio.locks import lock
        yt = env
        iid = yt.new("POLY", "v", "d", lane="core", typ="需求", track="L0 自动")
        orch.pm_tick()                             # 派发
        simulate_worker(yt, iid, lanes)
        orch.pm_tick()                             # harvest → 证据就绪
        assert state(yt, iid) == "证据就绪"
        lock(CONFIG, "lane-POLY-core").acquire("worker-OTHER", 120)   # 模拟并发活 worker
        r = orch.pm_tick()
        assert any(a.startswith("VERIFY-DEFER") for a in r["actions"]), r
        assert state(yt, iid) == "证据就绪"          # 顺延：不动状态不烧 attempt
        assert int(yt.f(iid, "attempt") or 0) == 0
        lock(CONFIG, "lane-POLY-core").release("worker-OTHER")
        r2 = orch.pm_tick()
        assert any(a.startswith("VERIFY-OK") for a in r2["actions"]), r2

    def test_复验先切回本单分支再跑闸门(self, env, lanes):
        """树停在 base 时复验必须先切 feature/<本单>——事故里闸门跑在 feature/GAMES-4/6/7 上。"""
        yt = env
        iid = yt.new("POLY", "b1", "d", lane="core", typ="需求", track="L0 自动")
        orch.pm_tick()
        simulate_worker(yt, iid, lanes)            # 产物只提交在 feature/{iid}
        orch.pm_tick()                             # harvest → 证据就绪
        repo = Path(CONFIG.lane("core")["path"])
        subprocess.run(["git", "-C", str(repo), "checkout", "main"],
                       check=True, capture_output=True)   # 别的收割把树切回 base
        r = orch.pm_tick()
        assert any(a.startswith("VERIFY-OK") for a in r["actions"]), r
        branch = subprocess.run(["git", "-C", str(repo), "rev-parse", "--abbrev-ref", "HEAD"],
                                capture_output=True, text=True).stdout.strip()
        assert branch == f"feature/{iid}", "闸门必须落在本单分支"


class Test脏树自愈:
    def test_worker残留未跟踪_自愈复位后照常派发(self, env, lanes):
        """GAMES server/ 残留卡道 15h 回归：锁 FREE 下脏树=残留垃圾，自愈留证不再永久跳过。"""
        yt = env
        iid = yt.new("POLY", "t", "d", lane="core", typ="需求", track="L0 自动")
        repo = Path(CONFIG.lane("core")["path"])
        (repo / "server" / "data").mkdir(parents=True)
        (repo / "server" / "data" / "x.json").write_text("{}", encoding="utf-8")
        r = orch.pm_tick()
        assert any(a.startswith("DISPATCH") for a in r["actions"]), r
        assert not (repo / "server").exists(), "未跟踪残留必须被清"
        assert any("泳道自愈" in c["text"] for c in yt.comments(iid))


class TestPM代批:
    """制作人委托代批（config.delegated_approvals）：委托项目内 PM 批示等效制作人；
    未委托项目 PM 批示无效；PM 留痕评论不得被当成批示（防自批准循环）。"""

    def test_委托项目_PM批准_全流程交付(self, env, lanes, monkeypatch):
        monkeypatch.setattr(CONFIG, "delegated_approvals", {"POLY": ["agent-pm"]})
        yt = env
        iid = yt.new("POLY", "L2代批", "d", lane="core", typ="需求", track="L2 常规")
        orch.pm_tick()                                   # 新单→待批
        yt.comment(iid, "批准\n（PM 代批：制作人委托）")     # agent-pm 身份批示
        r = orch.pm_tick()
        assert any("APPROVED" in a for a in r["actions"]), r
        orch.pm_tick()                                   # 派发
        simulate_worker(yt, iid, lanes)
        orch.pm_tick(); orch.pm_tick(); orch.pm_tick()   # harvest→verify→待批(合并审)
        assert state(yt, iid) == "待批"
        yt.comment(iid, "批准\n（PM 代批：制作人委托）")
        r2 = orch.pm_tick()
        assert state(yt, iid) == "已交付"
        repo = Path(CONFIG.lane("core")["path"])
        log = subprocess.run(["git", "-C", str(repo), "log", "--oneline"],
                             capture_output=True, text=True).stdout
        assert f"merge({iid})" in log, "代批合并批必须产生真实 merge commit"

    def test_未委托项目_PM批示_不被消费(self, env, lanes):
        """默认委托表只含 GAMES——POLY 的 PM 评论必须无效（授权边界不外溢）。"""
        yt = env
        iid = yt.new("POLY", "边界", "d", lane="core", typ="需求", track="L2 常规")
        orch.pm_tick()                                   # →待批
        yt.comment(iid, "批准")
        r = orch.pm_tick()
        assert state(yt, iid) == "待批", "未委托项目 PM 批示不得生效"


class Test合并批示忙时保留:
    def test_L2合并批_泳道忙_批示保留下拍重试(self, env, lanes, monkeypatch):
        from studio.locks import lock
        monkeypatch.setattr(CONFIG, "delegated_approvals", {"POLY": ["agent-pm"]})
        yt = env
        iid = yt.new("POLY", "L2忙", "d", lane="core", typ="需求", track="L2 常规")
        yt.comment(iid, "批准\n（PM 代批）")
        orch.pm_tick(); orch.pm_tick(); orch.pm_tick()   # 待批→批示→派发
        simulate_worker(yt, iid, lanes)
        orch.pm_tick(); orch.pm_tick(); orch.pm_tick()   # harvest→verify→待批(合并审)
        assert state(yt, iid) == "待批"
        yt.comment(iid, "批准\n（PM 代批）")
        lock(CONFIG, "lane-POLY-core").acquire("worker-OTHER", 120)   # 活 worker 占道
        r = orch.pm_tick()
        assert any(a.startswith("MERGE-DEFER") for a in r["actions"]), r
        assert state(yt, iid) == "待批"
        assert not any(c["text"].startswith("批示已执行 approve-merge") for c in yt.comments(iid)), \
            "忙时不得烧掉批示标记"
        lock(CONFIG, "lane-POLY-core").release("worker-OTHER")
        r2 = orch.pm_tick()
        assert state(yt, iid) == "已交付", "道释放后批示必须自动补合并"


class TestL3槽位语义:
    def test_断路复位后的方案审_不被误定位到合并审(self, env, lanes, monkeypatch):
        """GAMES-2 实录回归：L3 立项已批 + 断路复位重批（批号=2）后方案段交付进方案审，
        approve-design 必须落在方案审（→已派发实现段），不得因批号错位直接触发合并交付。"""
        monkeypatch.setattr(CONFIG, "delegated_approvals", {"POLY": ["agent-pm"]})
        yt = env
        iid = yt.new("POLY", "L3方案", "d", lane="core", typ="需求", track="L3 特护")
        orch.pm_tick()                                   # 新单→待批(立项)
        yt.comment(iid, "批准\n（PM 代批）")               # 第1批：立项
        orch.pm_tick()                                   # APPROVED→已派发
        orch.pm_tick()                                   # DISPATCH 方案段
        for _ in range(3):                               # 三连红 → 断路退审回第1批位
            simulate_worker(yt, iid, lanes, ok=False)
            orch.pm_tick()                               # GATE-FAIL
            orch.pm_tick()                               # 重派
        assert state(yt, iid) == "待批"
        yt.comment(iid, "批准\n（PM 代批）")               # 第2批：复位重批（批号≠槽位）
        orch.pm_tick()                                   # →已派发
        orch.pm_tick()                                   # DISPATCH
        simulate_worker(yt, iid, lanes)                  # 方案段交付（绿）
        orch.pm_tick()                                   # harvest→证据就绪
        orch.pm_tick()                                   # L3→待批(方案审)
        assert state(yt, iid) == "待批"
        yt.comment(iid, "approve-design\n（PM 代批：方案审通过）")
        r = orch.pm_tick()
        assert state(yt, iid) == "已派发", "approve-design 应进实现段而非合并交付"
        # 实现段闭环：交付→复验→合并审→批准→真实合并
        orch.pm_tick()
        simulate_worker(yt, iid, lanes)
        for _ in range(3):
            orch.pm_tick()
        assert state(yt, iid) == "待批"                   # 合并审
        yt.comment(iid, "批准\n（PM 代批）")
        orch.pm_tick()
        assert state(yt, iid) == "已交付"
        repo = Path(CONFIG.lane("core")["path"])
        log = subprocess.run(["git", "-C", str(repo), "log", "--oneline"],
                             capture_output=True, text=True).stdout
        assert f"merge({iid})" in log


class TestL3批示词误解析容忍:
    def test_LLM岛误写approve_merge_槽位仍按结构标记走(self, env, lanes, monkeypatch):
        """GAMES-3 实录回归：LLM 岛把 approve-design 批示误解析成 approve-merge，
        槽位定位必须依赖结构性转换标记（方案段就绪/复验通过），不依赖批示词。"""
        from studio import llm
        monkeypatch.setattr(llm, "parse_directive",
                            lambda text, ctx: {"directive": "approve-merge", "confidence": 0.9})
        monkeypatch.setattr(CONFIG, "delegated_approvals", {"POLY": ["agent-pm"]})
        yt = env
        iid = yt.new("POLY", "L3误解析", "d", lane="core", typ="需求", track="L3 特护")
        orch.pm_tick()                                   # →待批(立项)
        yt.comment(iid, "批准\n（PM 代批）")
        orch.pm_tick(); orch.pm_tick()                   # APPROVED→已派发 / DISPATCH
        simulate_worker(yt, iid, lanes)
        orch.pm_tick()                                   # harvest→证据就绪
        orch.pm_tick()                                   # 方案段就绪→待批(方案审)+结构标记
        assert state(yt, iid) == "待批"
        yt.comment(iid, "approve-design\n（PM 代批：方案审通过）")
        r = orch.pm_tick()                               # 被误解析为 approve-merge → 仍落方案审
        assert state(yt, iid) == "已派发", "误解析不得把方案审变成合并交付"
        orch.pm_tick()                                   # DISPATCH 实现段
        simulate_worker(yt, iid, lanes)
        for _ in range(3):
            orch.pm_tick()                               # harvest→verify→复验通过→待批(合并审)+结构标记
        assert state(yt, iid) == "待批"
        yt.comment(iid, "批准\n（PM 代批）")
        orch.pm_tick()
        assert state(yt, iid) == "已交付", "末轮必须按合并审结构标记真合并"
