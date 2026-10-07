"""approval 泛化（STUDIO-102 / V3 适配 P1-2 前置，行为中性）：
projects.{pid} 各读各段 + 无段项目回退全局缺省（=现行为）。
- 夹具：多项目 org.yaml 桩（STUDIO+GAMES 两段，agents 各带 login——生产段暂无
  login 字段，桩里带上是为把「按 pid 查本段」的分辨率拉满）；
- 各读各段：engine_mode/threshold/_dispa_logins/agent_profile/org_decide 终验锁
  均按本单 pid 段解析，不向邻段借 login（跨段冒充=越权面）；
- 无段项目（POLY）：engine=legacy、签字阈值=代码缺省、派单人查无此人=原名兜底、
  agent_profile={}——与泛化前现行为逐一相等（对生产 org.yaml 直证：旧硬编码读
  STUDIO 段也得不出 login，因生产 agents 无该字段）；
- 源级冻结断言：approval/orggov/signoff 无 .get("STUDIO") 裸读取（缺省参数不算）。"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import yaml
from studio import approval as ap, org, orggov, signoff
from studio.config import CONFIG
from studio.yt import YT

PROD = "opengames"
REAL_ORG = Path(__file__).resolve().parent.parent.parent / "kernel" / "org.yaml"

# 多项目组织桩（对齐生产 kernel/org.yaml 结构；GAMES 段=迁移草案形态样例）
ORG_MULTI = {
    "accounts": {"agent-9": 9, "agent-8": 8, "agent-4": 4, "agent-1": 1},
    "projects": {
        "STUDIO": {
            "team_level": 2,
            "leader": {"name": "宰相(ZCode)", "level": 2},
            "bu": {"工程部": {"主管": "宰相(ZCode)", "职能": "开发/修bug/重构"}},
            "agents": {"宰相(ZCode)": {"level": 2, "部门": ["工程部"], "login": "agent-9"}},
            "approvals": {"engine": "shadow", "派单人终验收": True,
                          "全流程签字": {"阈值": 4}},
        },
        "GAMES": {
            "team_level": 1,
            "leader": {"name": "游戏官(GA)", "level": 1},
            "bu": {"玩法部": {"主管": "游戏官(GA)", "职能": "玩法/数值"}},
            "agents": {"游戏官(GA)": {"level": 1, "部门": ["玩法部"], "login": "agent-1"},
                       "画师(GA)": {"level": 1, "部门": ["玩法部"], "login": "agent-4"}},
            "approvals": {"engine": "org", "派单人终验收": True,
                          "全流程签字": {"阈值": 2}},
        },
    },
}


def _org(monkeypatch, data=None):
    monkeypatch.setattr(org, "load", lambda force=False: data or ORG_MULTI)


# ── 各读各段 ─────────────────────────────────────────────────────────────────
def test_各读各段_engine与签字阈值按pid(tmp_config, monkeypatch):
    _org(monkeypatch)
    assert ap.engine_mode("STUDIO") == "shadow"
    assert ap.engine_mode("GAMES") == "org"              # 各段各值，互不覆盖
    assert signoff.threshold("STUDIO") == 4
    assert signoff.threshold("GAMES") == 2
    assert not signoff.required("GAMES", 1) and signoff.required("GAMES", 2)
    assert org.producer_final("STUDIO") and org.producer_final("GAMES")


def test_各读各段_派单人login映射不串段(tmp_config, monkeypatch):
    _org(monkeypatch)
    assert ap._dispa_logins("宰相(ZCode)", "STUDIO") == {"宰相(ZCode)", "agent-9"}
    assert ap._dispa_logins("游戏官(GA)", "GAMES") == {"游戏官(GA)", "agent-1"}
    # 本段查无此人 → 原名兜底，绝不借邻段 login（跨段冒充=越权面）
    assert ap._dispa_logins("宰相(ZCode)", "GAMES") == {"宰相(ZCode)"}
    assert ap._dispa_logins("游戏官(GA)", "STUDIO") == {"游戏官(GA)"}


def test_各读各段_agent_profile按pid(tmp_config, monkeypatch):
    _org(monkeypatch)
    p = org.agent_profile("游戏官(GA)", "GAMES")
    assert p["部门"] == ["玩法部"] and p["level"] == 1 and p["职责"] == ["玩法/数值"]
    assert org.agent_profile("宰相(ZCode)", "STUDIO")["level"] == 2   # 本段照旧可查
    assert org.agent_profile("宰相(ZCode)", "GAMES") == {}   # GAMES 段查无此人


def test_各读各段_org_decide终验锁按pid解析(tmp_config, monkeypatch):
    _org(monkeypatch)
    monkeypatch.setattr(CONFIG, "delegated_approvals", {"GAMES": ["agent-1"]})
    cs = []
    # GAMES 段：派单人=游戏官(GA)（agents.login=agent-1）→ 本人 login 终验位放行
    ok, why = ap.org_decide("GAMES", "G-1", "agent-1", None, 1, "游戏官(GA)", cs, True)
    assert ok and why == "final-owner-only"
    # 泛化核心断言：GAMES 单的派单人=宰相(ZCode)（STUDIO 段个体）——旧硬编码读
    # STUDIO 段会把 agent-9 也认成派单人本人；按 pid 读后 GAMES 查无此人 → 拒。
    # 行为中性说明：生产 org.yaml agents 无 login 字段，旧代码同样只剩原名，结果一致。
    ok, why = ap.org_decide("GAMES", "G-1", "agent-9", None, 1, "宰相(ZCode)", cs, True)
    assert not ok and why == "final-owner-only", (ok, why)
    # STUDIO 单照旧：宰相派单 agent-9 终验（本段 login 解析，行为不变）
    ok, why = ap.org_decide("STUDIO", "S-1", "agent-9", None, 1, "宰相(ZCode)", cs, True)
    assert ok and why in ("final-owner-only", "exempt"), (ok, why)


def test_signatures按本单项目段解析dispa(fake_yt, tmp_config, monkeypatch):
    """signoff 七环签字 merge 铁律走 _dispa_logins：GAMES 单用 GAMES 段 login
    认派单人本人；同 dispa 在无段项目（POLY）只剩原名，login 签字不算本人。"""
    _org(monkeypatch)
    monkeypatch.setattr(CONFIG, "delegated_approvals",
                        {"GAMES": ["agent-1"], "POLY": ["agent-1"]})
    be = fake_yt
    be.counters["GAMES"] = 0
    yt = YT("agent-8")
    yt._backend = be
    iid = be.create("GAMES", "t", "d", {})
    be.issues[iid]["comments"].append(
        {"author": "agent-1", "text": "sign-merge 本人终验", "created": be.now_ms()})
    sigs = signoff.signatures(yt, iid, None, dispa="游戏官(GA)")
    assert sigs["merge"] == {"agent-1"}                 # GAMES 段 login → 派单人本人
    iid2 = be.create("POLY", "t", "d", {})
    be.issues[iid2]["comments"].append(
        {"author": "agent-1", "text": "sign-merge 我也来签", "created": be.now_ms()})
    sigs2 = signoff.signatures(yt, iid2, None, dispa="游戏官(GA)")
    assert sigs2["merge"] == set()                      # POLY 无段：原名集合，login 不匹配


# ── 无段项目回退现行为（对生产 org.yaml 直证零变化）──────────────────────────
def test_无段项目回退现行为_对生产org逐一相等(tmp_config, monkeypatch):
    real = yaml.safe_load(REAL_ORG.read_text(encoding="utf-8"))
    assert set(real.get("projects") or {}) == {"STUDIO"}   # 前置：生产尚无 GAMES/POLY 段
    _org(monkeypatch, real)
    # engine：无段 → legacy（org_decide 影子接线不激活 = 现行为；若回退读 STUDIO 段
    # 的 shadow 反而是行为变化——这正是「选不改变现行为的那种」的落点）
    assert ap.engine_mode("POLY") == "legacy"
    assert ap.engine_mode("GAMES") == "legacy"
    # 签字阈值：无段 → 代码缺省 4（=生产 STUDIO 段现值，行为不变）
    assert signoff.threshold("POLY") == 4 == signoff.threshold("STUDIO")
    # 派单人 login：无段查无此人 → {原名}；生产 STUDIO 段 agents 无 login 字段，
    # 旧硬编码读同一段也得不出 login → 泛化前后逐字相等
    assert ap._dispa_logins("宰相(ZCode)", "POLY") == {"宰相(ZCode)"}
    assert ap._dispa_logins("宰相(ZCode)", "STUDIO") == {"宰相(ZCode)"}
    # 铁律开关/人事档案：无段 → False/{}（现行为）
    assert org.producer_final("POLY") is False
    assert org.agent_profile("宰相(ZCode)", "POLY") == {}
    assert org.approve_ceiling("宰相(ZCode)", "POLY") == 0


# ── 源级冻结断言（diff 级验收的代码化：防裸 STUDIO 段读取回归）────────────────
def test_源级无裸STUDIO段读取():
    for mod in (ap, orggov, signoff):
        src = Path(mod.__file__).read_text(encoding="utf-8")
        assert '.get("STUDIO"' not in src, (mod.__name__, "裸 STUDIO 段读取残留")
        assert ".get('STUDIO'" not in src, (mod.__name__, "裸 STUDIO 段读取残留")
        assert '["STUDIO"]' not in src, (mod.__name__, "裸 STUDIO 下标读取残留")
