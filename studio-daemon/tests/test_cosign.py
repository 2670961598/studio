"""cosign：联签协议（STUDIO-78 / ORG-DESIGN 部门维度，宪章「跨部门任务联签共担」）。
跨部门单（部门字段多值枚举，或字面值"跨部门"）须涉及部门主管全部评论签字
（首词 cosign/联签/会签，兼容署名前缀 [项目·个体名·部门]）方放行：
- org_decide 联签分支先于豁免/矩阵（单据级结构约束，同 hold 位次）；制作人豁免；
- 签字身份=署名个体名优先、回落 author login（生产 org.yaml agents 无 login，靠署名）；
- 非跨部门单无约束（行为与现状完全一致）；主管缺编部门不拦（名册不全不放行死锁）。
三例冻结验收：①未签齐拒/签齐放行 ②影子接线分歧留痕 ③非跨部门行为不变。"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from studio import approval as ap, orchestrator as orch
from studio.config import CONFIG
from studio.yt import YT

PROD = "opengames"

# 组织桩（对齐生产 kernel/org.yaml 结构：bu 主管/agents 署名档案/accounts 等级锚）
ORG = {
    "accounts": {"agent-9": 9, "agent-8": 8, "agent-4": 4, "agent-3": 3, "agent-1": 1},
    "projects": {"STUDIO": {
        "team_level": 2,
        "leader": {"name": "宰相(ZCode)", "level": 2, "上级": PROD},
        "bu": {"工程部": {"主管": "宰相(ZCode)"},
               "质量部": {"主管": "自评引擎"},
               "情报部": {"主管": "巡逻引擎"}},
        "agents": {"宰相(ZCode)": {"level": 2, "部门": ["工程部"], "login": "agent-9"},
                   "自评引擎": {"level": 1, "部门": ["质量部"], "login": "agent-4"},
                   "巡逻引擎": {"level": 1, "部门": ["情报部"], "login": "agent-3"}},
        "approvals": {"engine": "shadow", "派单人终验收": True},
    }},
}


def C(author, text):
    return {"author": author, "created": 0, "text": text}


def _org(monkeypatch):
    from studio import org
    monkeypatch.setattr(org, "load", lambda force=False: ORG)


# ── 例① 跨部门未签齐拒、签齐放行（豁免/矩阵/终验位全受约束；制作人豁免） ──────────
def test_例1_跨部门未签齐拒_签齐放行(tmp_config, monkeypatch):
    _org(monkeypatch)
    monkeypatch.setattr(CONFIG, "delegated_approvals", {"STUDIO": ["agent-9"]})
    depts = {"工程部", "质量部"}
    cs1 = [C("agent-9", "[STUDIO·宰相(ZCode)·工程部] cosign 工程侧就绪")]  # 仅工程部主管签
    # 豁免账号（宰相全权授权）也被拦——联签是单据级结构约束，先于豁免层
    ok, why = ap.org_decide("STUDIO", "S-1", "agent-9", None, 2, PROD, cs1, False, depts=depts)
    assert not ok and why == "cosign-pending[质量部]", (ok, why)
    # 矩阵账号同样被拦（4 级账号批 2 级单本可过）
    ok, why = ap.org_decide("STUDIO", "S-1", "agent-4", None, 2, PROD, cs1, False, depts=depts)
    assert not ok and why == "cosign-pending[质量部]"
    # 终验收位同样受约束（联签先于派单人终验锁）
    ok, why = ap.org_decide("STUDIO", "S-1", "agent-4", None, 2, "agent-4", cs1, True, depts=depts)
    assert not ok and why == "cosign-pending[质量部]"
    # 制作人豁免（终极派单人，宪章任意介入）
    ok, why = ap.org_decide("STUDIO", "S-1", PROD, None, 2, PROD, cs1, False, depts=depts)
    assert ok and why == "producer"
    # 质量部主管补签（署名个体名识别；词形=联签）→ 豁免/矩阵/终验位三路全放行
    cs2 = cs1 + [C("agent-4", "[STUDIO·自评引擎·质量部] 联签 质量侧就绪")]
    ok, why = ap.org_decide("STUDIO", "S-1", "agent-9", None, 2, PROD, cs2, False, depts=depts)
    assert ok and why == "exempt", (ok, why)
    ok, why = ap.org_decide("STUDIO", "S-1", "agent-4", None, 2, PROD, cs2, False, depts=depts)
    assert ok and why == "matrix-lv4"
    ok, why = ap.org_decide("STUDIO", "S-1", "agent-4", None, 2, "agent-4", cs2, True, depts=depts)
    assert ok and why == "final-owner-only"
    # 词形与身份口径：裸 login 无署名会签✓（agents.login 别名归一）
    cs3 = [C("agent-9", "cosign"), C("agent-4", "会签")]
    ok, why = ap.org_decide("STUDIO", "S-1", "agent-9", None, 2, PROD, cs3, False, depts=depts)
    assert ok and why == "exempt", (ok, why)
    # 主管的 approve 不算联签——签字必须显式（首词 cosign/联签/会签）
    cs4 = [C("agent-9", "cosign"), C("agent-4", "approve 先批了")]
    ok, why = ap.org_decide("STUDIO", "S-1", "agent-9", None, 2, PROD, cs4, False, depts=depts)
    assert not ok and why == "cosign-pending[质量部]", (ok, why)


# ── 例② 影子接线：跨部门单批示被 org 拒 → SHADOW_DIFF 留痕；签齐后分歧消失 ────────
def test_例2_影子接线跨部门联签分歧留痕(fake_yt, tmp_config, monkeypatch):
    _org(monkeypatch)
    monkeypatch.setattr(CONFIG, "delegated_approvals", {"STUDIO": ["agent-8"]})
    yt = YT("agent-8")
    yt._backend = fake_yt
    iid = yt.new("STUDIO", "跨部门联签单", "d", lane="core", typ="需求", track="L0 自动")
    yt.set_field(iid, "等级", 2, "SimpleIssueCustomField")
    yt.set_field(iid, "部门", ["工程部", "质量部"])      # 多值枚举=跨部门
    fake_yt.issues[iid]["comments"].append(
        {"author": "agent-8", "text": "approve", "created": fake_yt.now_ms()})
    CONFIG.events_path.write_text("", encoding="utf-8")
    orch._directives(yt, iid, "L0 自动", "需求", None)   # legacy 允（委托代批）org 拒（联签未齐）
    evs = [l for l in CONFIG.events_path.read_text(encoding="utf-8").splitlines()
           if "SHADOW_DIFF" in l]
    assert evs and "legacy允但org拒（cosign-pending[工程部 质量部]）" in evs[0], evs
    # 两位主管补签（cosign/会签词形）→ 联签分歧消失（org 照矩阵放行）
    for author, text in (("agent-9", "[STUDIO·宰相(ZCode)·工程部] cosign"),
                         ("agent-4", "会签 质量侧无异议")):
        fake_yt.issues[iid]["comments"].append(
            {"author": author, "text": text, "created": fake_yt.now_ms()})
    CONFIG.events_path.write_text("", encoding="utf-8")
    orch._directives(yt, iid, "L0 自动", "需求", None)
    evs2 = CONFIG.events_path.read_text(encoding="utf-8").splitlines()
    assert not any("cosign-pending" in l for l in evs2), evs2


# ── 例③ 非跨部门行为不变；"跨部门"字面值=全部门；主管缺编不拦；hold 优先 ─────────
def test_例3_非跨部门行为不变(tmp_config, monkeypatch):
    _org(monkeypatch)
    cs = []                                               # 无任何签字评论
    # 无部门字段（存量单）：矩阵裁决照旧，无联签约束
    ok, why = ap.org_decide("STUDIO", "S-1", "agent-4", None, 5, PROD, cs, False)
    assert ok and why == "matrix-lv4"
    ok, why = ap.org_decide("STUDIO", "S-1", "agent-4", None, 5, PROD, cs, False, depts=None)
    assert ok and why == "matrix-lv4"
    # 单部门：非跨部门，不启用联签
    ok, why = ap.org_decide("STUDIO", "S-1", "agent-4", None, 5, PROD, cs, False, depts={"工程部"})
    assert ok and why == "matrix-lv4"
    # 字面值"跨部门"（未列明细）→ 全 bu 部门主管联签（org 名册唯一枚举源，语义冻结）
    cs1 = [C("agent-9", "[STUDIO·宰相(ZCode)·工程部] cosign")]
    ok, why = ap.org_decide("STUDIO", "S-1", "agent-4", None, 2, PROD, cs1, False,
                            depts={"跨部门"})
    assert not ok and why == "cosign-pending[情报部 质量部]", (ok, why)
    cs2 = cs1 + [C("agent-4", "会签"), C("agent-3", "联签 情报侧知悉")]
    ok, why = ap.org_decide("STUDIO", "S-1", "agent-4", None, 2, PROD, cs2, False,
                            depts={"跨部门"})
    assert ok and why == "matrix-lv4"
    # 主管缺编部门（名册无此 bu）不拦——组织数据不全不放行死锁
    ok, why = ap.org_decide("STUDIO", "S-1", "agent-4", None, 2, PROD, cs1, False,
                            depts={"工程部", "未知部"})
    assert ok and why == "matrix-lv4", (ok, why)
    # 单据级亲批（hold）优先于联签：锁定下代批全灭，签齐也灭
    cs_hold = cs2 + [C(PROD, "亲批 等我")]
    ok, why = ap.org_decide("STUDIO", "S-1", "agent-4", None, 2, PROD, cs_hold, False,
                            depts={"工程部", "质量部"})
    assert not ok and why == "hold-locked", (ok, why)
