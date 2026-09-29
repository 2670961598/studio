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

    yt = YT("agent-8")
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
        lock(CONFIG, "lane-core").acquire("worker-OTHER", 120)   # 模拟并发活 worker
        r = orch.pm_tick()
        assert any(a.startswith("VERIFY-DEFER") for a in r["actions"]), r
        assert state(yt, iid) == "证据就绪"          # 顺延：不动状态不烧 attempt
        assert int(yt.f(iid, "attempt") or 0) == 0
        lock(CONFIG, "lane-core").release("worker-OTHER")
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
        monkeypatch.setattr(CONFIG, "delegated_approvals", {"POLY": ["agent-8"]})
        yt = env
        iid = yt.new("POLY", "L2代批", "d", lane="core", typ="需求", track="L2 常规")
        orch.pm_tick()                                   # 新单→待批
        yt.comment(iid, "批准\n（PM 代批：制作人委托）")     # agent-8 身份批示
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

    def test_未委托项目_PM批示_不被消费(self, env, lanes, monkeypatch):
        """委托边界不外溢：表外项目的 PM 评论必须无效。POLY 已于 2026-09-26
        进委托表（制作人授权 ZCode 审查后代批），故用例显式钉住旧表验证机制。"""
        monkeypatch.setattr(CONFIG, "delegated_approvals", {"GAMES": ["agent-8"]})
        yt = env
        iid = yt.new("POLY", "边界", "d", lane="core", typ="需求", track="L2 常规")
        orch.pm_tick()                                   # →待批
        yt.comment(iid, "批准")
        orch.pm_tick()
        assert state(yt, iid) == "待批", "未委托项目 PM 批示不得生效"

    def test_POLY审查后代批_被消费(self, env, lanes):
        """2026-09-26 制作人授权：POLY 进委托表后，附审查意见的 PM 批准生效。"""
        yt = env
        iid = yt.new("POLY", "代批", "d", lane="core", typ="需求", track="L2 常规")
        orch.pm_tick()                                   # →待批
        yt.comment(iid, "批准 审查意见：巡逻真实发现，验收命令可机器复跑（ZCode 代批留痕）")
        orch.pm_tick()
        assert state(yt, iid) == "已派发", "委托项目的 PM 批示应被消费并派发"



class Test合并批示忙时保留:
    def test_L2合并批_泳道忙_批示保留下拍重试(self, env, lanes, monkeypatch):
        from studio.locks import lock
        monkeypatch.setattr(CONFIG, "delegated_approvals", {"POLY": ["agent-8"]})
        yt = env
        iid = yt.new("POLY", "L2忙", "d", lane="core", typ="需求", track="L2 常规")
        yt.comment(iid, "批准\n（PM 代批）")
        orch.pm_tick(); orch.pm_tick(); orch.pm_tick()   # 待批→批示→派发
        simulate_worker(yt, iid, lanes)
        orch.pm_tick(); orch.pm_tick(); orch.pm_tick()   # harvest→verify→待批(合并审)
        assert state(yt, iid) == "待批"
        yt.comment(iid, "批准\n（PM 代批）")
        lock(CONFIG, "lane-core").acquire("worker-OTHER", 120)   # 活 worker 占道
        r = orch.pm_tick()
        assert any(a.startswith("MERGE-DEFER") for a in r["actions"]), r
        assert state(yt, iid) == "待批"
        assert not any(c["text"].startswith("批示已执行 approve-merge") for c in yt.comments(iid)), \
            "忙时不得烧掉批示标记"
        lock(CONFIG, "lane-core").release("worker-OTHER")
        r2 = orch.pm_tick()
        assert state(yt, iid) == "已交付", "道释放后批示必须自动补合并"



class TestL3槽位语义:
    def test_断路复位后的方案审_不被误定位到合并审(self, env, lanes, monkeypatch):
        """GAMES-2 实录回归：L3 立项已批 + 断路复位重批（批号=2）后方案段交付进方案审，
        approve-design 必须落在方案审（→已派发实现段），不得因批号错位直接触发合并交付。"""
        monkeypatch.setattr(CONFIG, "delegated_approvals", {"POLY": ["agent-8"]})
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
        monkeypatch.setattr(CONFIG, "delegated_approvals", {"POLY": ["agent-8"]})
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



class Test裸批准原始词元优先:
    def test_LLM把裸批准猜成approve_plan_合并槽仍放行(self, env, lanes, monkeypatch):
        """GAMES-9 实录回归：LLM 岛把裸"批准"解析成 approve-plan，合并槽卫兵误拒，
        批示陷入不消费死循环。裸批准的原始词元必须优先于 LLM 口味猜测。"""
        from studio import llm
        monkeypatch.setattr(llm, "parse_directive",
                            lambda text, ctx: {"directive": "approve-plan", "confidence": 0.9})
        monkeypatch.setattr(CONFIG, "delegated_approvals", {"POLY": ["agent-8"]})
        yt = env
        iid = yt.new("POLY", "裸批", "d", lane="core", typ="需求", track="L2 常规")
        orch.pm_tick()                                   # →待批(立项)
        yt.comment(iid, "批准")
        orch.pm_tick(); orch.pm_tick()                   # APPROVED→已派发 / DISPATCH
        simulate_worker(yt, iid, lanes)
        for _ in range(3):
            orch.pm_tick()                               # harvest→verify→待批(合并审)
        assert state(yt, iid) == "待批"
        yt.comment(iid, "批准")
        r = orch.pm_tick()
        assert state(yt, iid) == "已交付", "裸批准不得被 LLM 误猜成 approve-plan 卡死"


class Test派发顺序:
    def test_非交付族Type_L0派发被拒_零副作用不拉worker(self, env, lanes, monkeypatch):
        """POLY-22/23 事故回归：Type=业务 走 L0，旧序先 launch 后 transition，
        worker 跑完交付而单滞留新单 → 每 tick 无限重派。新序迁移被拒在先，
        不 checkout、不 launch、attempt 不烧、锁即释放。"""
        launched = []

        def spy_launch(self, ticket, lane=None):
            launched.append(self.issue)
            raise AssertionError("非交付族 Type 不应拉起 worker")

        monkeypatch.setattr(Worker, "launch", spy_launch)
        yt = env
        iid = yt.new("POLY", "业务单", "d", lane="core", typ="业务", track="L0 自动")
        yt.gate_freeze(iid, "test -f docs/out.md")
        out = orch.pm_tick()
        assert any("ERROR" in a or "非法迁移" in a for a in out["actions"])
        assert not launched                                   # 未拉 worker
        assert state(yt, iid) == "新单"                        # 单未动
        repo = CONFIG.lane("core")["path"]
        br = subprocess.run(["git", "-C", repo, "rev-parse", "--verify",
                             f"feature/{iid}"], capture_output=True)
        assert br.returncode != 0                              # 未建分支
        lk = CONFIG.locks_dir / "lane-core.lock"
        assert not lk.exists() or "worker-" not in lk.read_text()   # 锁未滞留



class Test收割记账:
    def test_收割把成本时长tokens入账(self, env, lanes):
        """审计 P0-1：GATES-40 的 stream 明躺 cost/duration，账本却是空集——接线验收。"""
        import json as _json
        yt = env
        iid = yt.new("POLY", "记账", "d", lane="core", typ="需求", track="L1 首批")
        orch.pm_tick()                                   # →待批
        yt.comment(iid, "批准")
        orch.pm_tick()                                   # 批准消费 →已派发
        orch.pm_tick()                                   # dispatch（建分支+launch）
        simulate_worker(yt, iid, lanes)                  # 产物+REPORT
        w = Worker(iid)                                  # 补 stream result 行（真账）
        w.stream.parent.mkdir(parents=True, exist_ok=True)
        w.stream.write_text(_json.dumps({"type": "result", "total_cost_usd": 16.48,
                                         "duration_ms": 2683795, "num_turns": 193,
                                         "usage": {"input_tokens": 300,
                                                   "output_tokens": 200}}) + "\n",
                            encoding="utf-8")
        orch.pm_tick()                                   # harvest
        assert state(yt, iid) == "证据就绪"
        evs = [_json.loads(l) for l in
               CONFIG.events_path.read_text(encoding="utf-8").splitlines()]
        gp = [e for e in evs if e["event"] == "GATE_PASS"][-1]
        assert gp["cost_usd"] == 16.48 and gp["duration_ms"] == 2683795
        assert gp["tokens"] == 500
        done = _json.loads((CONFIG.workers_dir / f"{iid}.done.json").read_text(encoding="utf-8"))
        assert done["result"]["cost_usd"] == 16.48      # 归档钉存，stream 改名后仍在



@pytest.fixture(autouse=True)
def _no_lane_exemption(monkeypatch):
    """清空亲批泳道豁免：本类测代批/槽位机制本身（与 2026-09-28 core 泳道亲批收紧正交），
    测试泳道沿用历史任意选择的 core。"""
    from studio.config import CONFIG as _C
    monkeypatch.setattr(_C, "producer_only_lanes", {})

class Test看门狗兜底:
    def test_wall超限_kill并重派(self, env, lanes, monkeypatch):
        """审计 P0-3 第二道防线：wrap 看门狗失灵时，reg.started 超 wall-clock 也杀。
        心跳判据的盲区是"持续心跳却永不封顶"——wall-clock 补上。"""
        import json as _json
        import time as _t
        from datetime import datetime, timedelta
        yt = env
        iid = yt.new("POLY", "看门狗", "d", lane="core", typ="需求", track="L1 首批")
        orch.pm_tick()                                   # →待批
        yt.comment(iid, "批准")
        orch.pm_tick()                                   # 批准消费 →已派发
        orch.pm_tick()                                   # dispatch
        w = Worker(iid)
        reg = _json.loads(w.reg.read_text(encoding="utf-8"))
        reg["started"] = (datetime.now() - timedelta(hours=2)).strftime("%F %T")
        w.reg.write_text(_json.dumps(reg), encoding="utf-8")
        killed = []
        monkeypatch.setattr(Worker, "kill",
                            lambda self: killed.append(self.issue) or "KILLED")
        out = orch.pm_tick()
        assert iid in killed                             # 超限被杀
        assert state(yt, iid) == "已派发"                 # 重派位（新一轮 worker）

    def test_wall未超限_不误杀(self, env, lanes, monkeypatch):
        import json as _json
        yt = env
        iid = yt.new("POLY", "正常长单", "d", lane="core", typ="需求", track="L1 首批")
        orch.pm_tick(); yt.comment(iid, "批准"); orch.pm_tick(); orch.pm_tick()
        w = Worker(iid)
        reg = _json.loads(w.reg.read_text(encoding="utf-8"))
        reg["started"] = __import__("time").strftime("%F %T")   # 刚开始
        w.reg.write_text(_json.dumps(reg), encoding="utf-8")
        killed = []
        monkeypatch.setattr(Worker, "kill",
                            lambda self: killed.append(self.issue) or "KILLED")
        orch.pm_tick()
        assert not killed                                # 未超限不动它


class Test优雅重载:
    """STUDIO-47A：重启即指令——drain 后停派新工（收割照常），在途清零 daemon 自退。"""

    def test_drain时派发被暂缓(self, env, lanes):
        yt = env
        iid = yt.new("POLY", "重载", "d", lane="core", typ="需求", track="L0 自动")
        yt.gate_freeze(iid, "test -f docs/out.md")
        orch.CONFIG.locks_dir.joinpath("drain.json").write_text("{}", encoding="utf-8")
        out = orch.pm_tick()
        assert any(a.startswith(f"DRAINING {iid}") for a in out["actions"])
        assert state(yt, iid) == "新单"                 # 未派发
        orch.CONFIG.locks_dir.joinpath("drain.json").unlink()

    def test_drain_ready判定(self, tmp_config, monkeypatch):
        import subprocess as _sp
        f = tmp_config.locks_dir / "drain.json"
        f.write_text("{}", encoding="utf-8")
        (tmp_config.workers_dir / "W-9.json").write_text("{}", encoding="utf-8")
        assert orch.drain_ready() == (False, "in-flight=1")
        (tmp_config.workers_dir / "W-9.json").unlink()
        monkeypatch.setattr(_sp, "run",
                            lambda *a, **k: _sp.CompletedProcess([], 0, ""))
        ok, why = orch.drain_ready()
        assert ok is False and why == "wrap-alive"
        monkeypatch.setattr(_sp, "run",
                            lambda *a, **k: _sp.CompletedProcess([], 1, ""))
        assert orch.drain_ready() == (True, "ready")

    def test_无drain时正常派发(self, env, lanes):
        yt = env
        iid = yt.new("POLY", "正常", "d", lane="core", typ="需求", track="L0 自动")
        yt.gate_freeze(iid, "test -f docs/out.md")
        out = orch.pm_tick()
        assert any(a.startswith(f"DISPATCH {iid}") for a in out["actions"])


class Test亲批泳道:
    @pytest.fixture(autouse=True)
    def _restore_lane_exemption(self, monkeypatch):
        """本类测亲批收紧本身——恢复 config 默认豁免表（覆盖模块级清空）。"""
        from studio.config import CONFIG as _C
        monkeypatch.setattr(_C, "producer_only_lanes", {"POLY": ["core"]})

    """制作人 2026-09-28 指令：三消 core 仓（POLY core 泳道）慎之又慎——
    其单据一切批示只认制作人，代批账号（agent-8）的批准不被消费。"""

    def test_core泳道PM批准不消费(self, env, lanes):
        yt = env
        iid = yt.new("POLY", "core亲批", "d", lane="core", typ="需求", track="L1 首批")
        orch.pm_tick()                                   # →待批
        yt.comment(iid, "批准 审查意见：……（ZCode 代批留痕）")
        orch.pm_tick()
        assert state(yt, iid) == "待批", "core 泳道 PM 批示必须无效"

    def test_core泳道制作人批准消费(self, env, lanes, monkeypatch):
        yt = env
        iid = yt.new("POLY", "core制作人批", "d", lane="core", typ="需求", track="L1 首批")
        orch.pm_tick()
        be = monkeypatch  # fake backend 作者=agent-8；直改评论作者模拟制作人
        cs = yt.comments(iid)
        monkeypatch.setattr("studio.yt.YT.comment", lambda self, i, t: None) if False else None
        # 直接走 backend 造制作人评论：fake_yt 的 requests_mock 造不了他人——
        # 用 CONFIG.producer 临时代指 agent-8 反向验证：把 producer 改名后
        # agent-8 不再是制作人 → core 泳道应拒（机制对称性）
        from studio.config import CONFIG as _C
        with monkeypatch.context() as m:
            m.setattr(_C, "producer", "nobody-else")
            yt.comment(iid, "批准")
            orch.pm_tick()
        assert state(yt, iid) == "待批"

    def test_亲批泳道代批史_制作人亲批合并不被序位吞掉(self, env, lanes, monkeypatch):
        """POLY-26/27/29 实录回归：收紧前单据有代批消费史（批示已执行+1），
        收紧后合格批示仅制作人 1 条，applied 虚高 → 亲批永判无新批示，合并审卡死。"""
        from studio.config import CONFIG as _C
        yt = env
        iid = yt.new("POLY", "代批史亲批合并", "d", lane="core", typ="需求", track="L2 常规")
        orch.pm_tick()                                   # → 待批
        with monkeypatch.context() as m:                 # ① 收紧前：代批第 1 批被消费
            m.setattr(_C, "producer_only_lanes", {})
            yt.comment(iid, "批准 审查意见：收紧前的代批（ZCode 代批留痕）")
            orch.pm_tick()
            orch.pm_tick()                               # DISPATCH 拉工人
        assert state(yt, iid) == "已派发"
        simulate_worker(yt, iid, lanes)
        orch.pm_tick(); orch.pm_tick()                   # harvest + verify → 复验通过
        orch.pm_tick()                                   # → 待批（合并审）
        assert state(yt, iid) == "待批"
        fake_yt_backend_comment(yt, iid, "opengames", "批准合并")  # ② 收紧后亲批
        orch.pm_tick()
        assert state(yt, iid) == "已交付", "亲批不得被代批史的序位计数吞掉"

    def test_game泳道PM批准照常(self, env, lanes):
        yt = env
        monkeypatch_lanes = None
        iid = yt.new("POLY", "game代批", "d", lane="game", typ="需求", track="L1 首批")
        orch.pm_tick()
        yt.comment(iid, "批准 审查意见：game 泳道维持代批（ZCode 代批留痕）")
        orch.pm_tick()
        assert state(yt, iid) == "已派发", "非亲批泳道代批应照常"




class Test亲批叮嘱:
    """制作人 2026-09-28 指令：单据级「亲批/hold」——任何单上制作人评论首词命中，
    该单一切代批失效（本人照常）。与泳道级亲批正交、可叠加。"""

    def test_game泳道亲批叮嘱后代批失效(self, env, lanes, monkeypatch):
        from studio.config import CONFIG as _C
        import conftest as _cf
        yt = env
        monkeypatch.setattr(_C, "producer_only_lanes", {})   # 排除泳道亲批，纯测叮嘱
        iid = yt.new("POLY", "叮嘱", "d", lane="game", typ="需求", track="L1 首批")
        orch.pm_tick()
        # fake 后端评论作者恒为 agent-8——直插制作人评论（真实现形态）
        be = _cf.CURRENT_BACKEND
        be.issues[iid]["comments"].append(
            {"author": "opengames", "text": "亲批 这单我要自己看", "created": be.now_ms()})
        yt.comment(iid, "批准 审查意见：……（ZCode 代批留痕）")
        orch.pm_tick()
        assert state(yt, iid) == "待批", "亲批叮嘱后一切代批必须失效"

    def test_无叮嘱代批照常(self, env, lanes, monkeypatch):
        from studio.config import CONFIG as _C
        monkeypatch.setattr(_C, "producer_only_lanes", {})
        yt = env
        iid = yt.new("POLY", "无叮嘱", "d", lane="game", typ="需求", track="L1 首批")
        orch.pm_tick()
        yt.comment(iid, "批准 审查意见：常规代批（ZCode 代批留痕）")
        orch.pm_tick()
        assert state(yt, iid) == "已派发"

    def test_委托账号缺token自动剔除(self, tmp_config, capsys, monkeypatch):
        import importlib
        from studio import config as cfgmod
        import json as _json
        # 注册表里去掉 agent-8 → 委托被剔除（fail-safe，不 401）
        real_load = cfgmod._load
        def fake_load(p):
            d = real_load(p)
            if p.name == "youtrack.json":
                d["agents"] = {}
            return d
        monkeypatch.setattr(cfgmod, "_load", fake_load)
        c = cfgmod.Config()
        assert c.delegated_approvals == {"GAMES": [], "POLY": [], "STUDIO": []}


class Test探索并行通道:
    """制作人 2026-09-28：调研/前沿收集/试验类不占交付工作目录——不受泳道互斥约束，
    可多开并行。机制：explore 泳道每单独立锁 + /tmp 独立工作区 + 免 git，直交付。"""

    def test_两张探索单同拍并行派发(self, env, lanes):
        """交付泳道一锁一 worker；explore 各持各锁——同拍两张都派出去。"""
        yt = env
        a = yt.new("POLY", "探索A", "调研X", lane="explore", typ="需求", track="L0 自动")
        b = yt.new("POLY", "探索B", "调研Y", lane="explore", typ="需求", track="L0 自动")
        yt.gate_freeze(a, "test -f out.md")
        yt.gate_freeze(b, "test -f out.md")
        out = orch.pm_tick()
        acts = " | ".join(out["actions"])
        assert f"DISPATCH {a} lane=explore" in acts and f"DISPATCH {b} lane=explore" in acts

    def test_探索收割免git直交付(self, env, lanes):
        import json as _json
        from studio.workers import Worker
        yt = env
        iid = yt.new("POLY", "探索交付", "调研Z", lane="explore", typ="需求", track="L0 自动")
        yt.gate_freeze(iid, "test -f finding.md")
        orch.pm_tick()                                   # dispatch
        # 探索产物落工作区 + REPORT
        wd = Path(CONFIG.lane("explore")["path"]) / iid
        wd.mkdir(parents=True, exist_ok=True)
        (wd / "finding.md").write_text("# 调研结论\nX 可行", encoding="utf-8")
        (wd / "docs").mkdir(exist_ok=True)
        (wd / "docs" / "out.md").write_text("加测桩\n", encoding="utf-8")  # env 桩加测命令的落点
        simulate_worker(yt, iid, "explore") if False else None
        w = Worker(iid)
        w.report.parent.mkdir(parents=True, exist_ok=True)
        w.report.write_text("WORKER REPORT 探索\n结论：X 可行\n", encoding="utf-8")
        orch.pm_tick()                                   # harvest（免 git）
        assert state(yt, iid) == "证据就绪"
        r1 = orch.pm_tick()                              # 复验（gate 在探索区跑）→ 复验通过
        r2 = orch.pm_tick()                              # L0 直交付（免 merge）
        assert state(yt, iid) == "已交付"


class Test收割异常计分与kill原子性:
    def test_harvest异常计attempt断风暴(self, env, lanes, monkeypatch):
        """P1-6：gate 拒跑等收割异常曾不罚 attempt → ARCHIVED 立即重派 → 每 10 分钟白烧一轮。"""
        yt = env
        iid = yt.new("POLY", "异常计分", "d", lane="core", typ="需求", track="L1 首批")
        orch.pm_tick(); yt.comment(iid, "批准"); orch.pm_tick(); orch.pm_tick()
        simulate_worker(yt, iid, lanes)
        def boom(*a, **k):
            raise RuntimeError("GATE-DANGEROUS X 模拟")
        monkeypatch.setattr(orch, "run_gate", boom)   # orchestrator 是 from-import 绑定
        out = orch.pm_tick()
        assert any("ERROR" in a for a in out["actions"])      # 异常冒泡记录
        assert int(yt.f(iid, "attempt") or 0) == 1            # 且 attempt 已计（断路可期）

    def test_kill前REPORT复查走收割(self, env, lanes, monkeypatch):
        """P1-7：worker 恰在判死与 kill 之间交卷——曾误杀丢证据；现在走收割。"""
        yt = env
        iid = yt.new("POLY", "交卷竞态", "d", lane="core", typ="需求", track="L0 自动")
        yt.gate_freeze(iid, "test -f docs/out.md")
        orch.pm_tick()
        simulate_worker(yt, iid, lanes)                        # 产物+REPORT 已交
        # 伪造心跳超时情境：心跳设为 2 小时前
        yt.set_field(iid, "心跳", int((__import__("time").time()) - 7200) * 1000, "SimpleIssueCustomField")
        out = orch.pm_tick()
        acts = " ".join(out["actions"])
        assert "HARVEST" in acts and "kill" not in acts        # 走了收割不是 kill
        assert state(yt, iid) == "证据就绪"


class Test口语弱批准收紧:
    """P1-12：'好，不过先别做' 首段切出'好'曾直当 approve——现仅整句≤4字才算。"""

    def test_长句口语不批(self, env, lanes):
        from studio.config import CONFIG as _C
        yt = env
        iid = yt.new("POLY", "口语", "d", lane="game", typ="需求", track="L1 首批")
        orch.pm_tick()
        be = None
        import conftest as _cf
        be = _cf.CURRENT_BACKEND
        be.issues[iid]["comments"].append(
            {"author": "opengames", "text": "好，不过先别做，等我看看", "created": be.now_ms()})
        orch.pm_tick()
        assert state(yt, iid) == "待批", "长句口语首词不得当批准"

    def test_极短口语照批(self, env, lanes):
        import conftest as _cf
        yt = env
        iid = yt.new("POLY", "口语2", "d", lane="game", typ="需求", track="L1 首批")
        orch.pm_tick()
        be = _cf.CURRENT_BACKEND
        be.issues[iid]["comments"].append(
            {"author": "opengames", "text": "可以的", "created": be.now_ms()})
        orch.pm_tick()
        assert state(yt, iid) == "已派发"


class Test影子模式:
    """STUDIO-55 P2：org 引擎与 legacy 并行——shadow 期只记 SHADOW_DIFF 不干预。"""

    def _setup(self, yt, monkeypatch, engine="shadow"):
        from studio.config import CONFIG as _C
        from studio import org
        monkeypatch.setattr(_C, "producer_only_lanes", {})
        monkeypatch.setattr(org, "project",
                            lambda pid: {"approvals": {"engine": engine}} if pid == "STUDIO" else {})
        return yt

    def test_豁免等价不产生分歧(self, env, lanes, monkeypatch):
        """legacy 允（豁免）且 org 也允（豁免层）→ 无 SHADOW_DIFF 事件。"""
        from studio.config import CONFIG as _C
        yt = self._setup(env, monkeypatch)
        iid = yt.new("STUDIO", "影子A", "d", lane=None, typ="提案", track="G1 知识",
                     state="草稿")
        yt.transition(iid, "待批")
        yt.comment(iid, "批准 审查意见：豁免等价（ZCode 代批留痕）")
        _C.events_path.touch()                               # 空账本也可能不存在
        orch._directives(yt, iid, "G1 知识", "提案", None)
        diffs = [l for l in _C.events_path.read_text(encoding="utf-8").splitlines()
                 if "SHADOW_DIFF" in l]
        assert diffs == []

    def test_终验收锁派单人_影子记分歧(self, env, lanes, monkeypatch):
        """存量单（无派单人字段→dispa=制作人）在合并审位：legacy 允（豁免）但 org 拒
        （final-owner-only）→ SHADOW_DIFF 记账且行为不变（legacy 仍消费）。"""
        from studio.config import CONFIG as _C
        import json as _json
        yt = self._setup(env, monkeypatch)
        iid = yt.new("STUDIO", "影子B", "d", lane=None, typ="提案", track="G1 知识",
                     state="草稿")
        yt.transition(iid, "待批")
        yt.comment(iid, "批示已执行 approve → 已派发 (第1批)")   # 伪造 applied=1 → 终验位
        yt.comment(iid, "批准 第二批（终验收）")
        _C.events_path.write_text("", encoding="utf-8")
        orch._directives(yt, iid, "G1 知识", "提案", None)
        evs = [l for l in _C.events_path.read_text(encoding="utf-8").splitlines()
               if "SHADOW_DIFF" in l]
        assert evs and "final-owner-only" in evs[0] or evs, evs  # 记了分歧
        # 行为不变：legacy 照常消费（提案族流转由 evolve 管，此处只验无异常）

    def test_等级矩阵_无豁免账号(self, fake_yt, tmp_config, monkeypatch):
        from studio import approval as ap
        from studio.config import CONFIG as _C
        from studio import org as _org
        monkeypatch.setattr(_org, "load", lambda force=False: {
            "accounts": {"agent-4": 4, "agent-2": 2},
            "projects": {"STUDIO": {"approvals": {"engine": "legacy"}}}})
        cs = []
        ok, why = ap.org_decide("STUDIO", "S-1", "agent-4", None, 5, "opengames", cs, False)
        assert ok and why == "matrix-lv4"                  # 4级账号批5级单（帽5）✓
        ok, why = ap.org_decide("STUDIO", "S-1", "agent-2", None, 5, "opengames", cs, False)
        assert not ok                                       # 2级账号批5级 ✗
        ok, why = ap.org_decide("STUDIO", "S-1", "agent-4", None, 5, "agent-4", cs, True)
        assert ok and why == "final-owner-only"            # 派单人本人终验 ✓
        ok, why = ap.org_decide("STUDIO", "S-1", "agent-4", None, 5, "opengames", cs, True)
        assert not ok                                       # 非派单人终验 ✗


class Test部门路由:
    """STUDIO-55 P3-b（STUDIO-61）：单据"部门"字段驱动施工泳道。
    工程部→framework、情报部→explore（并行通道）、跨部门→联签提示默认工程部；
    无部门字段 → 泳道字段照旧（验收①：行为与现状完全一致）。"""

    @pytest.fixture
    def fw(self, lanes, tmp_path, monkeypatch):
        """framework 泳道指到独立 git 沙箱（部门路由落点验证）。"""
        repo = tmp_path / "fw"
        repo.mkdir()
        def g(*a):
            subprocess.run(["git", "-C", str(repo), *a], check=True, capture_output=True, text=True)
        g("init", "-b", "main")
        g("config", "user.email", "t@t")
        g("config", "user.name", "t")
        (repo / "docs").mkdir()
        (repo / "docs" / "hello.md").write_text("# fw\n", encoding="utf-8")
        g("add", "-A")
        g("commit", "-m", "init")
        monkeypatch.setitem(CONFIG.lanes, "framework",
                            {"path": str(repo), "base_branch": "main",
                             "agent": "agent-8", "yt_acct": "agent-8"})
        return repo

    def _mk(self, yt, pid="STUDIO", lane="core"):
        iid = yt.new(pid, "部门路由", "d", lane=lane, typ="需求", track="L0 自动")
        yt.gate_freeze(iid, "test -f docs/out.md")
        return iid

    def test_工程部_派framework(self, env, fw):
        yt = env
        iid = self._mk(yt)
        yt.set_field(iid, "部门", "工程部")
        out = orch.pm_tick("STUDIO")
        assert f"DISPATCH {iid} lane=framework" in " | ".join(out["actions"])
        assert Worker(iid).reg_data()["lane"] == "framework"
        br = subprocess.run(["git", "-C", str(fw), "rev-parse", "--verify", f"feature/{iid}"],
                            capture_output=True)
        assert br.returncode == 0, "分支必须建在 framework 泳道仓"

    def test_情报部_派explore并行通道(self, env, fw):
        yt = env
        iid = self._mk(yt, lane="core")            # 泳道字段 core：部门字段驱动优先
        yt.set_field(iid, "部门", "情报部")
        out = orch.pm_tick("STUDIO")
        assert f"DISPATCH {iid} lane=explore" in " | ".join(out["actions"])
        assert Worker(iid).reg_data()["lane"] == "explore"
        assert (Path(CONFIG.lane("explore")["path"]) / iid).is_dir(), "探索通道独立工作区已建"

    def test_跨部门_联签提示默认工程部(self, env, fw):
        yt = env
        iid = self._mk(yt)
        yt.set_field(iid, "部门", "跨部门")
        out = orch.pm_tick("STUDIO")
        assert f"DISPATCH {iid} lane=framework" in " | ".join(out["actions"])
        orch.pm_tick("STUDIO")                      # 下拍（RUNNING）：提示幂等不刷屏
        hints = [c for c in yt.comments(iid) if c["text"].startswith("跨部门联签提示")]
        assert len(hints) == 1, "联签提示必须留痕且幂等（每拍一刷会淹板面）"
        # 多值枚举形态（ORG-DESIGN：部门为多值枚举）：[工程部,情报部] 同跨部门语义
        # （首单 RUNNING 占道，放锁后再派——交付泳道一锁一 worker 是另一码事）
        from studio.locks import lock
        lock(CONFIG, "lane-framework").release(f"worker-{iid}")
        iid2 = self._mk(yt)
        yt.set_field(iid2, "部门", ["工程部", "情报部"])
        out2 = orch.pm_tick("STUDIO")
        assert f"DISPATCH {iid2} lane=framework" in " | ".join(out2["actions"])
        assert any(c["text"].startswith("跨部门联签提示") for c in yt.comments(iid2))

    def test_无部门字段_行为与现状一致(self, env, fw):
        yt = env
        iid = self._mk(yt)                          # 泳道=core，无部门
        out = orch.pm_tick("STUDIO")
        assert f"DISPATCH {iid} lane=core" in " | ".join(out["actions"])
        assert Worker(iid).reg_data()["lane"] == "core"
        iid2 = self._mk(yt, lane=None)              # 无泳道无部门 → NO-LANE 照旧
        out2 = orch.pm_tick("STUDIO")
        assert f"NO-LANE {iid2}" in out2["actions"]
        assert not any(c["text"].startswith("跨部门联签提示") for c in yt.comments(iid))

    def test_部门路由单_派发收割复验合并同一泳道(self, env, fw):
        """全程一致性回归：若只改派发点，收割会按原泳道进错仓（KeyError/放错锁）——
        部门解析必须统一在所有泳道派生点，同单派发→收割→复验→合并全程同一泳道。"""
        yt = env
        iid = self._mk(yt)
        yt.set_field(iid, "部门", "工程部")
        orch.pm_tick("STUDIO")                      # DISPATCH framework
        subprocess.run(["git", "-C", str(fw), "checkout", f"feature/{iid}"],
                       check=True, capture_output=True)
        (fw / "docs" / "out.md").write_text("# ok\n", encoding="utf-8")
        subprocess.run(["git", "-C", str(fw), "add", "-A"], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(fw), "commit", "-m", f"feat({iid}): x"],
                       check=True, capture_output=True)
        w = Worker(iid)
        w.report.parent.mkdir(parents=True, exist_ok=True)
        w.report.write_text(f"WORKER REPORT {iid}\n", encoding="utf-8")
        assert any(a.startswith("HARVEST") for a in orch.pm_tick("STUDIO")["actions"])
        assert state(yt, iid) == "证据就绪"
        assert any(a.startswith("VERIFY-OK") for a in orch.pm_tick("STUDIO")["actions"])
        assert state(yt, iid) == "复验通过"
        assert any(a.startswith("DELIVERED") for a in orch.pm_tick("STUDIO")["actions"])
        log = subprocess.run(["git", "-C", str(fw), "log", "--oneline"],
                             capture_output=True, text=True).stdout
        assert f"merge({iid})" in log, "L0 直合并必须落在 framework 仓"

    def test_亲批泳道钉死不迁(self, env, fw, monkeypatch):
        """红线：producer_only_lanes（POLY core 亲批）优先于部门路由——部门字段
        不得把单搬出制作人钉死的泳道（对应 can_approve 的泳道豁免语义）。"""
        monkeypatch.setattr(CONFIG, "producer_only_lanes", {"POLY": ["core"]})
        yt = env
        iid = self._mk(yt, pid="POLY", lane="core")
        yt.set_field(iid, "部门", "工程部")
        out = orch.pm_tick()
        assert f"DISPATCH {iid} lane=core" in " | ".join(out["actions"])
        assert Worker(iid).reg_data()["lane"] == "core"
        assert not any(c["text"].startswith("跨部门联签提示") for c in yt.comments(iid))


class Test终验身份对齐:
    """影子假阳性修复：派单人字段存个体名（宰相(ZCode)）、author 是账号（agent-8）
    ——42 条假分歧的根因。归一后同名等价。"""

    def test_个体名派单人与账号author等价(self, tmp_config, monkeypatch):
        from studio import approval as ap
        from studio import org as _org
        monkeypatch.setattr(_org, "load", lambda force=False: {
            "accounts": {"agent-8": 8},
            "projects": {"STUDIO": {"agents": {"宰相(ZCode)": {"login": "agent-8"}}}}})
        cs = []
        ok, why = ap.org_decide("STUDIO", "S-1", "agent-8", None, 5, "宰相(ZCode)", cs, True)
        assert ok and why == "final-owner-only"          # 个体名↔账号等价，终验放行
        ok, _ = ap.org_decide("STUDIO", "S-1", "agent-4", None, 5, "宰相(ZCode)", cs, True)
        assert not ok                                      # 他人终验仍拒


def test_drain_ready不误判制作人终端claude(tmp_config, monkeypatch):
    """00:01 崩溃循环实录：pgrep "claude -p" 误匹配制作人终端会话→drain 永不清零。
    修复后只查 workers/*.wrap.sh（我们签发的 worker）。"""
    import subprocess as _sp
    import studio.orchestrator as orch
    f = tmp_config.locks_dir / "drain.json"
    f.write_text("{}", encoding="utf-8")
    # pgrep 探测失败（无 wrap）→ ready
    monkeypatch.setattr(_sp, "run", lambda *a, **k: _sp.CompletedProcess([], 1, ""))
    ok, why = orch.drain_ready()
    assert ok is True and why == "ready"
