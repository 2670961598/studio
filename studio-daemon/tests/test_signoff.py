"""signoff：全流程逐环签字协议（STUDIO-79 / 宪章 §12.2「全流程逐环确认」、§12.3 铁律）。
七环（理解→拆分→方案→执行→测试→回归→merge）逐环签字 + 终验前置校验：
高等级单（等级≥阈值，org.yaml approvals.全流程签字.阈值=4）签字不齐 → 合并批示不消费、
板面幂等留缺环清单；低等级单不启用（行为与现状完全一致）；merge 环=派单人本人。"""
import subprocess, sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from studio import orchestrator as orch, signoff
from studio.config import CONFIG
from studio.workers import Worker
from studio.yt import YT


@pytest.fixture
def env(fake_yt, lanes, monkeypatch):
    """假 claude 工人（同 test_orchestrator.env：launch 只登记，产物由 _worker 造）。"""
    from studio import llm
    monkeypatch.setattr(llm, "dod_gen",
                        lambda t: "test -f docs/out.md && grep -q 关键 docs/out.md")
    monkeypatch.setattr(llm, "extra_test_gen", lambda t, g: "test -f docs/out.md")

    def fake_launch(self, ticket, lane=None):
        self.reg.parent.mkdir(parents=True, exist_ok=True)
        self.reg.write_text(__import__("json").dumps(
            {"issue": self.issue, "pid": -1, "lane": lane or "core",
             "branch": f"feature/{self.issue}", "repo": CONFIG.lane(lane or "core")["path"],
             "report": str(self.report), "stream": str(self.stream), "started": "test"}))
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
    yt._backend = fake_yt
    return yt


def _comment(yt, iid, author, text):
    """以任意身份直写假后端评论（制作人批示 / 宰相署名签字模拟）。"""
    yt._backend.issues[iid]["comments"].append(
        {"author": author, "text": text, "created": yt._backend.now_ms()})


def _worker(yt, iid, ok=True):
    """假 claude 干活：feature 分支提交产物 + 写 REPORT（内容每轮唯一）。"""
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
    w.report.write_text(f"WORKER REPORT {iid}\n身份: agent-dev\n分支: feature/{iid}\n",
                        encoding="utf-8")


def _state(yt, iid):
    return yt.f(iid, "State")


def _mk(yt, level=4, track="L2 常规", dispa=None):
    """建单：等级字段优先（新轨），可带派单人（无则终验保守归制作人）。"""
    iid = yt.new("STUDIO", "高等级单", "d", lane="core", typ="需求", track=track)
    if level is not None:
        yt.set_field(iid, "等级", level, "SimpleIssueCustomField")
    if dispa:
        yt.set_field(iid, "派单人", dispa)
    return iid


def _to_merge_review(yt, iid):
    """新单 → 合并审（立项批+施工+复验），停在终验收位（L2 第2个待批）。"""
    orch.pm_tick("STUDIO")                              # 新单→待批（高等级：签字协议预告）
    _comment(yt, iid, "opengames", "approve-plan")
    orch.pm_tick("STUDIO")                              # 批示拍：→已派发
    orch.pm_tick("STUDIO")                              # 派发拍：拉工人
    _worker(yt, iid)
    for _ in range(3):                                  # harvest→verify→待批(合并审)
        orch.pm_tick("STUDIO")
    assert _state(yt, iid) == "待批"


# ---------------------------------------------------------------- 词法与配置
def test_七环词法与署名前缀():
    assert signoff.STAGES == ("理解", "拆分", "方案", "执行", "测试", "回归", "merge")
    assert signoff.parse_sign("sign-理解 口径已对齐") == "理解"
    assert signoff.parse_sign("[STUDIO·宰相(ZCode)·工程部] sign-方案 已审") == "方案"  # 署名协议前缀
    assert signoff.parse_sign("签-merge 终验完成") == "merge"
    assert signoff.parse_sign("签字-回归 全量绿") == "回归"
    assert signoff.parse_sign("sign-不存在的环") is None        # 未知环名拒收（机器断言，不猜）
    assert signoff.parse_sign("sign-理解附带文字") is None       # 首词精确匹配，不认后缀粘连
    assert signoff.parse_sign("批准 sign-理解") is None          # 非首词不算签字
    assert signoff.parse_sign("") is None
    assert signoff.is_sign_comment("sign-执行 ok")
    assert not signoff.is_sign_comment("approve-merge")


def test_阈值配置与等级判定():
    """事实源 kernel/org.yaml：approvals.全流程签字.阈值=4（L3 特护双轨锚点）。"""
    assert signoff.threshold("STUDIO") == 4
    assert signoff.required("STUDIO", 4) and signoff.required("STUDIO", 9)
    assert not signoff.required("STUDIO", 3)            # L2 常规（等级3）不启用
    assert not signoff.required("STUDIO", None)         # 等级未知：不启用（终验位仍有批示把关）
    assert signoff.threshold("无此项目") == 4            # 无配置回退默认


# ---------------------------------------------------------------- 终验前置校验
class Test终验前置校验:
    def test_缺环_批示不消费_幂等留痕(self, env, lanes):
        """验收例①：高等级单七环未签，合并批示被前置校验挡下——批示不消费
        （状态滞留终验收位）、板面留缺环清单、缺环集不变不刷屏。"""
        yt = env
        iid = _mk(yt, level=4)
        _to_merge_review(yt, iid)
        snap = [c["text"] for c in yt.comments(iid) if c["text"].startswith("复验通过，进入合并审")]
        assert snap and "全流程签字协议：缺环[" in snap[0]          # 进终验位即附快照
        _comment(yt, iid, "opengames", "approve-merge")
        r1 = orch.pm_tick("STUDIO")
        assert any("SIGNOFF-PENDING" in a for a in r1["actions"]), r1
        assert _state(yt, iid) == "待批"                          # 批示未被消费
        marks = [c["text"] for c in yt.comments(iid)
                 if c["text"].startswith("终验前置校验")]
        assert len(marks) == 1
        assert "缺环[理解 拆分 方案 执行 测试 回归 merge]" in marks[0]
        assert any("SIGNOFF-PENDING" in a for a in orch.pm_tick("STUDIO")["actions"])
        marks2 = [c["text"] for c in yt.comments(iid)
                  if c["text"].startswith("终验前置校验")]
        assert len(marks2) == 1, "缺环集不变 → 缺环评论不刷屏"

    def test_七环签齐_终验放行真合并(self, env, lanes):
        """验收例②：宰相（委托代批 agent-8，署名前缀）签 1-6 环 + 派单人（制作人）
        签 merge 环 → approve-merge 放行，真实 merge commit 落盘。"""
        yt = env
        iid = _mk(yt, level=4)
        _to_merge_review(yt, iid)
        for s in ("理解", "拆分", "方案", "执行", "测试", "回归"):
            _comment(yt, iid, "agent-8", f"[STUDIO·宰相(ZCode)·工程部] sign-{s} 已确认")
        _comment(yt, iid, "opengames", "sign-merge 派单人终验收")
        _comment(yt, iid, "opengames", "approve-merge")
        r = orch.pm_tick("STUDIO")
        assert any("APPROVED" in a for a in r["actions"]), r
        assert _state(yt, iid) == "已交付"
        repo = Path(CONFIG.lane("core")["path"])
        log = subprocess.run(["git", "-C", str(repo), "log", "--oneline"],
                             capture_output=True, text=True).stdout
        assert f"merge({iid})" in log, "签字齐全后 approve-merge 必须产生真实 merge commit"

    def test_低等级单_协议不启用_行为不变(self, env, lanes):
        """验收例③：等级 3（L2 常规双轨）无任何签字照常交付——存量单行为与现状
        完全一致（无预告、无快照、无前置校验）。"""
        yt = env
        iid = _mk(yt, level=None)                      # 无等级字段 → 轨道映射 L2 常规=3 < 4
        _to_merge_review(yt, iid)
        assert not any(c["text"].startswith(("全流程签字协议", "终验前置校验"))
                       for c in yt.comments(iid))
        _comment(yt, iid, "opengames", "approve-merge")
        r = orch.pm_tick("STUDIO")
        assert any("APPROVED" in a for a in r["actions"]), r
        assert _state(yt, iid) == "已交付"


class Test签字权限:
    def test_merge环_仅派单人本人(self, env, lanes):
        """铁律 §12.3（终验收=派单人本人）：宰相虽可签 1-6 环，merge 环非派单人
        签了也无效（fail-closed）；派单人补签即齐。"""
        yt = env
        iid = _mk(yt, level=4)                         # 无派单人字段 → 终验保守归制作人
        _to_merge_review(yt, iid)
        for s in signoff.STAGES:                       # 宰相全签（含 merge）
            _comment(yt, iid, "agent-8", f"sign-{s} 代签")
        _comment(yt, iid, "opengames", "approve-merge")
        r = orch.pm_tick("STUDIO")
        assert any("SIGNOFF-PENDING" in a for a in r["actions"]), r
        mark = [c["text"] for c in yt.comments(iid)
                if c["text"].startswith("终验前置校验")][-1]
        assert "缺环[merge]" in mark                   # 仅缺 merge：宰相 1-6 环有效
        _comment(yt, iid, "opengames", "sign-merge 本人终验")
        r2 = orch.pm_tick("STUDIO")
        assert any("APPROVED" in a for a in r2["actions"]), r2
        assert _state(yt, iid) == "已交付"

    def test_hold亲批锁定_代签失效_制作人亲签有效(self, env, lanes):
        """制作人「亲批」叮嘱后一切代批失效（沿 _producer_hold 语义）——宰相即便
        是派单人，其签字也全灭；制作人本人签字照常有效。"""
        yt = env
        iid = _mk(yt, level=4, dispa="agent-8")        # 派单人=宰相
        _to_merge_review(yt, iid)
        _comment(yt, iid, "opengames", "亲批 本单我亲自盯，所有环节我亲自确认")
        for s in signoff.STAGES:
            _comment(yt, iid, "agent-8", f"sign-{s} 派单人签")
        _comment(yt, iid, "opengames", "approve-merge")
        r = orch.pm_tick("STUDIO")
        assert any("SIGNOFF-PENDING" in a for a in r["actions"]), r
        mark = [c["text"] for c in yt.comments(iid)
                if c["text"].startswith("终验前置校验")][-1]
        assert "缺环[理解 拆分 方案 执行 测试 回归 merge]" in mark   # hold：代签七环全灭
        for s in signoff.STAGES:
            _comment(yt, iid, "opengames", f"sign-{s} 制作人亲签")
        r2 = orch.pm_tick("STUDIO")
        assert any("APPROVED" in a for a in r2["actions"]), r2
        assert _state(yt, iid) == "已交付"

    def test_重复签字幂等_越权账号忽略(self, env, lanes):
        """同环重复签字只计一次；无批示资格的账号（agent-2，不在委托表）签字无效。"""
        yt = env
        iid = _mk(yt, level=4)
        _to_merge_review(yt, iid)
        _comment(yt, iid, "opengames", "sign-理解 口径对齐")
        _comment(yt, iid, "opengames", "sign-理解 再确认一次")   # 重复：仍只算 1 环
        _comment(yt, iid, "agent-2", "sign-拆分 我也签一个")     # 越权：不计数
        sigs = signoff.signatures(yt, iid, "core")
        assert sigs["理解"] == {"opengames"} and sigs["拆分"] == set()


class Test批示隔离与预告:
    def test_签字评论不当批示(self, env, lanes):
        """签字评论绝不进批示解析（防 LLM 岛把 sign-merge 猜成 approve-merge）：
        纯签字评论后状态不动、无 APPROVED 动作。"""
        yt = env
        iid = _mk(yt, level=4)
        _to_merge_review(yt, iid)
        _comment(yt, iid, "opengames", "sign-merge 派单人终验收")
        r = orch.pm_tick("STUDIO")
        assert all("APPROVED" not in a for a in r["actions"])
        assert _state(yt, iid) == "待批"

    def test_立项预告_高等级发一次_幂等(self, env, lanes):
        """高等级单进待批前发一次七环清单（锚点幂等）；低等级单不发。"""
        yt = env
        iid = _mk(yt, level=4)
        orch.pm_tick("STUDIO")                          # 新单→待批
        marks = [c["text"] for c in yt.comments(iid)
                 if c["text"].startswith("全流程签字协议")]
        assert len(marks) == 1 and "sign-理解" in marks[0] and "sign-merge" in marks[0]
        assert signoff.brief_comment(yt, iid, 4) is False      # 幂等：锚点已存在不再发
        iid2 = _mk(yt, level=3)
        orch.pm_tick("STUDIO")
        assert not any(c["text"].startswith("全流程签字协议")
                       for c in yt.comments(iid2)), "低等级单不预告"
